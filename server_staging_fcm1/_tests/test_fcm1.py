"""[FCM] 앱 푸시(Expo 경유) — 토큰 검증·저장/이관·발송 메시지·DeviceNotRegistered 정리·웹푸시 체인.

실행: 가짜 DB(get_mongo 패치) + httpx.MockTransport — 외부 호출 없음.
  cd server_staging_fcm1 && python _tests/test_fcm1.py   (app.database.mongodb 가 없는 환경이면 _tests/_stub 사용)
"""
import asyncio, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "_stub"))   # app.database.mongodb 스텁
sys.path.insert(0, os.path.dirname(HERE))          # 스테이징 app/

import httpx
import app.services.expo_push as ep
import app.services.webpush as wp

FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)

# ── 가짜 Mongo ──────────────────────────────────────────────────────────────
class Cur:
    def __init__(s, d): s.d = d
    def sort(s, key, direction): s.d = sorted(s.d, key=lambda x: x.get(key), reverse=direction < 0); return s
    def skip(s, n): s.d = s.d[n:]; return s
    async def to_list(s, length=None): return list(s.d)[: length or None]
def match(doc, q):
    for k, v in q.items():
        if isinstance(v, dict) and "$in" in v:
            if doc.get(k) not in v["$in"]: return False
        elif doc.get(k) != v: return False
    return True
class Res:
    def __init__(s, n): s.deleted_count = n
class Coll:
    def __init__(s): s.docs = []; s.seq = 0
    async def create_index(s, *a, **k): return None
    async def update_one(s, q, u, upsert=False):
        for d in s.docs:
            if match(d, q): d.update(u.get("$set", {})); return
        if upsert:
            s.seq += 1; d = {"_id": s.seq, **q, **u.get("$setOnInsert", {}), **u.get("$set", {})}; s.docs.append(d)
    def find(s, q, proj=None): return Cur([d for d in s.docs if match(d, q)])
    async def delete_many(s, q):
        before = len(s.docs); s.docs = [d for d in s.docs if not match(d, q)]; return Res(before - len(s.docs))
    async def count_documents(s, q): return len([d for d in s.docs if match(d, q)])
class DB(dict):
    def __missing__(s, k): s[k] = Coll(); return s[k]
db = DB()
ep.get_mongo = lambda: db
wp.get_mongo = lambda: db

T1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
T2 = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"

async def main():
    # 토큰 형식
    ok("토큰 형식 허용(ExponentPushToken/ExpoPushToken)", ep.valid_token(T1) and ep.valid_token("ExpoPushToken[xyzxyzxyzxyz]"))
    ok("토큰 형식 거부(FCM 원시·빈값·주입)", not ep.valid_token("fcm:abc") and not ep.valid_token("") and not ep.valid_token(T1 + " x"))
    ok("로그 마스킹은 끝 6자만", ep._mask(T1) == "…aaaaaa")

    # 저장·이관·상한
    await ep.save_token("u1", T1, "android")
    await ep.save_token("u1", T1, "android")
    ok("같은 토큰 재등록 = 1건(멱등)", await db[ep.TOKENS].count_documents({"user_id": "u1"}) == 1)
    await ep.save_token("u2", T1, "android")
    ok("계정 전환 시 토큰이 새 사용자로 이관", await db[ep.TOKENS].count_documents({"user_id": "u1"}) == 0
       and await db[ep.TOKENS].count_documents({"user_id": "u2"}) == 1)
    for i in range(7):
        await ep.save_token("u3", f"ExponentPushToken[cccccccccccc{i:02d}]", "android")
        await asyncio.sleep(0.001)
    ok("사용자당 최대 5개 유지", await db[ep.TOKENS].count_documents({"user_id": "u3"}) == ep.MAX_TOKENS_PER_USER)

    # 메시지
    m = ep.build_message(T1, {"title": "MAIDOL", "body": "민지님이 나를 팔로우했어요", "url": "/app", "tag": "maidol-follow"})
    ok("메시지: 채널·소리·data.url", m["channelId"] == "default" and m["sound"] == "default" and m["data"] == {"url": "/app", "tag": "maidol-follow"} and m["to"] == T1)

    # 발송 + DeviceNotRegistered 정리
    await ep.save_token("u2", T2, "android")
    seen = {}
    def handler(req):
        seen["url"] = str(req.url); seen["body"] = json.loads(req.content)
        tickets = []
        for msg in seen["body"]:
            if msg["to"] == T2:
                tickets.append({"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}})
            else:
                tickets.append({"status": "ok", "id": "x"})
        return httpx.Response(200, json={"data": tickets})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        r = await ep.send_to_user("u2", {"title": "MAIDOL", "body": "b", "url": "/app", "tag": "t"}, client=c)
    ok("발송 대상 URL = exp.host", seen.get("url") == ep.EXPO_PUSH_URL)
    ok("사용자 토큰 2개에 발송", len(seen["body"]) == 2)
    ok("결과 집계 ok=1 gone=1", r == {"ok": 1, "gone": 1, "fail": 0})
    ok("DeviceNotRegistered 토큰 삭제", await db[ep.TOKENS].count_documents({"token": T2}) == 0
       and await db[ep.TOKENS].count_documents({"token": T1}) == 1)

    # 서버 오류 → 예외 없이 fail 집계
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(503, text="down"))) as c:
        r = await ep.send_to_user("u2", {"body": "b"}, client=c)
    ok("Expo 503 → never raises, fail=1", r == {"ok": 0, "gone": 0, "fail": 1})
    ok("토큰 없는 사용자 → 호출 없음", await ep.send_to_user("nobody", {"body": "b"}) == {"ok": 0, "gone": 0, "fail": 0})

    # 웹푸시 체인: 웹 구독이 없어도 앱 푸시는 나간다
    called = {}
    async def fake_send(uid, payload, client=None):
        called["uid"] = uid; called["payload"] = payload; return {"ok": 1, "gone": 0, "fail": 0}
    orig = ep.send_to_user
    ep.send_to_user = fake_send
    try:
        await wp.send_to_user("u2", {"title": "MAIDOL", "body": "x", "tag": "maidol-like"})
    finally:
        ep.send_to_user = orig
    ok("webpush.send_to_user → 앱 푸시 체인(웹 구독 0건이어도)", called.get("uid") == "u2" and called["payload"]["tag"] == "maidol-like")

    async def boom(uid, payload, client=None): raise RuntimeError("x")
    ep.send_to_user = boom
    try:
        r = await wp.send_to_user("u2", {"body": "x"})
        ok("앱 푸시 예외가 웹 푸시를 막지 않음", r == {"ok": 0, "gone": 0, "fail": 0})
    finally:
        ep.send_to_user = orig

    # 삭제
    n = await ep.delete_token("u2")
    ok("로그아웃 시 사용자 토큰 전부 삭제", n == 1 and await db[ep.TOKENS].count_documents({"user_id": "u2"}) == 0)

asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL — {FAILS}")
sys.exit(1 if FAILS else 0)
