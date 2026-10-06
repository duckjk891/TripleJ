"""v3.293 주간 미션 — 격리 컨테이너 + 가짜 DB (운영 무접촉)."""
import asyncio, copy, sys
from datetime import datetime, timezone, timedelta
from bson import ObjectId
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.services.weekly_missions as wm

def _match(d, q):
    for k, v in q.items():
        dv = d.get(k)
        if isinstance(v, dict):
            for op, ov in v.items():
                if op == "$exists" and ((k in d) != ov): return False
        elif dv != v: return False
    return True
class Coll:
    def __init__(s): s.docs = {}
    async def create_index(s, *a, **k): pass
    async def find_one(s, q, proj=None):
        for d in s.docs.values():
            if _match(d, q): return d
        return None
    def find(s, q):
        hits = [d for d in s.docs.values() if _match(d, q)]
        class It:
            def __init__(i): i.i = iter(hits)
            def __aiter__(i): return i
            async def __anext__(i):
                try: return next(i.i)
                except StopIteration: raise StopAsyncIteration
        return It()
    async def find_one_and_update(s, q, upd, upsert=False, return_document=None):
        await asyncio.sleep(0)
        for d in s.docs.values():
            if _match(d, q):
                for k, v in upd.get("$addToSet", {}).items():
                    d.setdefault(k, [])
                    if v not in d[k]: d[k].append(v)
                for k, v in upd.get("$set", {}).items(): d[k] = v
                return d
        if upsert:
            d = {"_id": ObjectId(), **{k: v for k, v in q.items() if not isinstance(v, dict)}}
            for k, v in upd.get("$setOnInsert", {}).items(): d[k] = v
            for k, v in upd.get("$set", {}).items(): d[k] = v
            for k, v in upd.get("$addToSet", {}).items(): d[k] = [v]
            s.docs[d["_id"]] = d; return d
        return None
    async def update_one(s, q, upd):
        for d in s.docs.values():
            if _match(d, q):
                for k in upd.get("$unset", {}): d.pop(k, None)
                for k, v in upd.get("$set", {}).items(): d[k] = v
class DB:
    def __init__(s): s.weekly_mission_progress = Coll(); s.characters = Coll(); s.notifications = Coll()
    def __getitem__(s, k): return getattr(s, k)
db = DB(); wm.get_mongo = lambda: db
grants = []; fail_grant = {"on": False}
async def fake_grant(uid, action, amount, note="", db=None):
    if fail_grant["on"]: return False
    grants.append((uid, action, amount)); return True
wm.grant_points = fake_grant
notified = []
import app.routes.notifications as rn
async def fake_push(mongo, **kw): notified.append(kw)
rn.push_notification = fake_push

async def main():
    U = "u-test-0001"
    db.characters.docs[1] = {"user_id": U, "character_id": "a" * 32}
    ok("본인 아티스트 판별", await wm.is_own_artist(db, U, "A" * 32) is True)
    ok("타인/없는 아티스트는 제외", await wm.is_own_artist(db, "u-other", "a" * 32) is False and await wm.is_own_artist(db, U, None) is False)
    mon = datetime(2026, 10, 5, 1, 0, tzinfo=timezone.utc)  # KST 월 10:00
    await wm.record_progress(U, "artist_songs", "t1", now=mon)
    await wm.record_progress(U, "artist_songs", "t1", now=mon)
    st = await wm.weekly_status(U, now=mon)
    ok("같은 곡 중복 기록은 1회", st["missions"][0]["count"] == 1)
    await wm.record_progress(U, "artist_songs", "t2", now=mon)
    ok("2곡까진 보상 없음", not grants)
    await asyncio.gather(wm.record_progress(U, "artist_songs", "t3", now=mon), wm.record_progress(U, "artist_songs", "t4", now=mon))
    ok("3곡 달성 → ⭐15 정확히 1회(동시 기록)", grants == [(U, "weekly_mission_artist_songs", 15)])
    ok("달성 알림 1회", len(notified) == 1 and notified[0]["extra"]["amount"] == 15 and notified[0]["ntype"] == "star")
    await wm.record_progress(U, "artist_songs", "t5", now=mon)
    ok("달성 후 추가 곡은 재보상 없음", len(grants) == 1)
    st = await wm.weekly_status(U, now=mon)
    ok("현황: 3/3·보상 완료", st["missions"][0]["count"] == 3 and st["missions"][0]["rewarded"] is True)
    ok("마감 = 다음 월요일 00:00 KST", st["ends_at"].startswith("2026-10-11T15:00"))
    # 다음 주(일→월 경계, KST)
    sun_night = datetime(2026, 10, 11, 14, 59, tzinfo=timezone.utc)  # KST 일 23:59
    next_mon = datetime(2026, 10, 11, 15, 0, tzinfo=timezone.utc)   # KST 월 00:00
    ok("일요일 23:59 KST 는 같은 주", wm.week_key(sun_night) == wm.week_key(mon))
    ok("월요일 00:00 KST 부터 새 주", wm.week_key(next_mon) != wm.week_key(mon))
    st2 = await wm.weekly_status(U, now=next_mon)
    ok("새 주는 0부터", st2["missions"][0]["count"] == 0 and not st2["missions"][0]["rewarded"])
    # 커버 미션 — 지급 실패 시 다음 진행에서 재시도
    fail_grant["on"] = True
    for r in ("c1", "c2", "c3"):
        await wm.record_progress(U, "artist_covers", r, now=mon)
    st = await wm.weekly_status(U, now=mon)
    ok("지급 실패 → 보상 미완료 유지", st["missions"][1]["rewarded"] is False and not any(g[1].endswith("covers") for g in grants))
    fail_grant["on"] = False
    await wm.record_progress(U, "artist_covers", "c4", now=mon)
    ok("다음 진행에서 ⭐5 재지급", (U, "weekly_mission_artist_covers", 5) in grants)
    ok("알 수 없는 미션 무시", await wm.record_progress(U, "nope", "x", now=mon) is None)
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
