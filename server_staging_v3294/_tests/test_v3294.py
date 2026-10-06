"""v3.294 차단 필터·크루장 글 삭제·차단 목록 — 격리 컨테이너 + 가짜 DB."""
import asyncio, sys, json
from datetime import datetime
from bson import ObjectId
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.routes.feeds as feeds
import app.routes.dm as dm

def _match(d, q):
    for k, v in q.items():
        if k == "$or":
            if not any(_match(d, x) for x in v): return False
            continue
        dv = d.get(k)
        if isinstance(v, dict):
            for op, ov in v.items():
                if op == "$nin" and dv in ov: return False
                if op == "$ne" and dv == ov: return False
                if op == "$lt" and not (dv < ov): return False
        elif dv != v: return False
    return True
class Cur:
    def __init__(s, docs): s.docs = docs
    def sort(s, *a, **k): return s
    def skip(s, n): s.docs = s.docs[n:]; return s
    def limit(s, n): s.docs = s.docs[:n]; return s
    async def to_list(s, length=None): return list(s.docs)
class Coll:
    def __init__(s): s.docs = []
    def find(s, q=None, proj=None): return Cur([d for d in s.docs if _match(d, q or {})])
    async def find_one(s, q, proj=None):
        for d in s.docs:
            if _match(d, q): return d
        return None
    async def count_documents(s, q): return len([d for d in s.docs if _match(d, q)])
    async def delete_one(s, q):
        s.docs = [d for d in s.docs if not _match(d, q)]
    async def delete_many(s, q):
        class R: deleted_count = 0
        return R()
class DB:
    def __init__(s):
        for n in ("feeds", "feed_comments", "dm_blocks", "clubs", "notifications"): setattr(s, n, Coll())
    def __getitem__(s, k): return getattr(s, k)
db = DB()
feeds.get_mongo = lambda: db; dm.get_mongo = lambda: db
class Conn:
    async def execute(s, *a): pass
    async def fetch(s, *a): return []
conn = Conn()

ME, OTHER, BAD = "u-me", "u-other", "u-bad"
async def main():
    club = {"_id": ObjectId(), "owner_id": ME}; db.clubs.docs.append(club)
    post = {"_id": ObjectId(), "kind": "club", "club_id": str(club["_id"]), "author_id": OTHER, "blocks": []}
    db.feeds.docs.append(post)
    r = await feeds.delete_feed(str(post["_id"]), current_user={"id": ME}, conn=conn)
    ok("크루장은 크루 게시판 남의 글 삭제 가능", isinstance(r, dict) and not any(d["_id"] == post["_id"] for d in db.feeds.docs))
    post2 = {"_id": ObjectId(), "kind": "club", "club_id": str(club["_id"]), "author_id": ME, "blocks": []}
    db.feeds.docs.append(post2)
    r = await feeds.delete_feed(str(post2["_id"]), current_user={"id": OTHER}, conn=conn)
    ok("크루장 아닌 사람은 남의 글 삭제 403", getattr(r, "status_code", None) == 403)
    normal = {"_id": ObjectId(), "kind": "feed", "author_id": OTHER, "blocks": []}
    db.feeds.docs.append(normal)
    r = await feeds.delete_feed(str(normal["_id"]), current_user={"id": ME}, conn=conn)
    ok("일반 글은 작성자만 삭제(403)", getattr(r, "status_code", None) == 403)
    # 차단 목록·필터
    db.dm_blocks.docs.append({"blocker_id": ME, "blocked_id": BAD, "created_at": datetime(2026, 10, 6)})
    ok("내 차단 id 로드", await feeds._my_blocked_ids(db, ME) == [BAD])
    ok("비로그인은 빈 목록", await feeds._my_blocked_ids(db, None) == [])
    f = {"_id": ObjectId(), "kind": "feed", "author_id": OTHER, "blocks": []}; db.feeds.docs.append(f)
    fid = str(f["_id"])
    for a in (BAD, OTHER, BAD):
        db.feed_comments.docs.append({"_id": ObjectId(), "feed_id": fid, "author_id": a, "content": "x", "created_at": datetime(2026, 10, 6)})
    orig_ser = feeds._serialize_comment
    feeds._serialize_comment = lambda d: {"id": str(d["_id"]), "author_id": d["author_id"]}
    r = await feeds.list_feed_comments(fid, page=1, limit=20, conn=conn, current_user={"id": ME})
    authors = [c["author_id"] for c in (r.get("comments") or [])] if isinstance(r, dict) else None
    ok("차단한 사람 댓글 숨김", authors == [OTHER])
    r2 = await feeds.list_feed_comments(fid, page=1, limit=20, conn=conn, current_user=None)
    ok("비로그인은 전부 보임", isinstance(r2, dict) and len(r2.get("comments") or []) == 3)
    feeds._serialize_comment = orig_ser
    async def fake_hydrate(conn, ids): return {BAD: {"id": BAD, "nickname": "나쁜닉", "profile_image": None, "code": "1234"}}
    dm.dm_service.hydrate_users = fake_hydrate
    r = await dm.list_blocks(current_user={"id": ME}, conn=conn)
    ok("차단 목록 응답(닉네임·시각)", isinstance(r, dict) and r["blocks"][0]["nickname"] == "나쁜닉" and r["blocks"][0]["blocked_at"].startswith("2026-10-06"))
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
