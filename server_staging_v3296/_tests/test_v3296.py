"""v3.296 크루 장르·검색·추천·수정 — 격리 컨테이너 + 가짜 DB."""
import asyncio, re, sys
from datetime import datetime
from bson import ObjectId
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.routes.clubs as clubs

def _cmp(dv, op, ov):
    if op == "$ne": return dv != ov
    if op == "$lt": return dv is not None and dv < ov
    if op == "$in": return (any(x in ov for x in dv) if isinstance(dv, list) else dv in ov)
    if op == "$nin": return dv not in ov
    if op == "$regex": return isinstance(dv, str) and re.search(ov, dv, re.I) is not None
    if op == "$options": return True
    if op == "$exists": return (dv is not None) == ov
    raise Exception(op)
def _match(d, q):
    for k, v in q.items():
        if k == "$or":
            if not any(_match(d, x) for x in v):
                return False
            continue
        if k == "$and":
            if not all(_match(d, x) for x in v):
                return False
            continue
        dv = d.get(k)
        if isinstance(v, dict):
            if "$regex" in v:
                if not _cmp(dv, "$regex", v["$regex"]): return False
                continue
            for op, ov in v.items():
                if not _cmp(dv, op, ov): return False
        elif isinstance(dv, list):
            if v not in dv: return False
        elif dv != v: return False
    return True
class Cur:
    def __init__(s, docs): s.docs = docs
    def sort(s, spec, *a):
        if isinstance(spec, list):
            for key, dirn in reversed(spec):
                s.docs.sort(key=lambda d: (d.get(key) is None, d.get(key) if not isinstance(d.get(key), ObjectId) else str(d.get(key))), reverse=dirn < 0)
        return s
    def limit(s, n): s.docs = s.docs[:n]; return s
    async def to_list(s, length=None): return list(s.docs)
    def __aiter__(s): s._i = iter(s.docs); return s
    async def __anext__(s):
        try: return next(s._i)
        except StopIteration: raise StopAsyncIteration
class Coll:
    def __init__(s): s.docs = []
    def find(s, q=None, proj=None): return Cur([d for d in s.docs if _match(d, q or {})])
    async def find_one(s, q, proj=None):
        for d in s.docs:
            if _match(d, q): return d
    async def update_one(s, q, upd):
        for d in s.docs:
            if _match(d, q):
                d.update(upd.get("$set", {}))
class DB:
    def __init__(s):
        for n in ("clubs", "club_members", "club_join_requests", "tracks"): setattr(s, n, Coll())
    def __getitem__(s, k): return getattr(s, k)
db = DB(); clubs.get_mongo = lambda: db
async def no_pending(mongo, ids, uid): return set()
async def no_roles(mongo, ids, uid): return {}
clubs._pending_map = no_pending; clubs._memberships_map = no_roles
async def wf_none(*a, **k): return None
clubs.word_filter_response = wf_none
async def get_club(mongo, cid, viewer=None):
    for d in db.clubs.docs:
        if str(d["_id"]) == cid: return d, None
    return None, "404"
clubs.get_club_or_404 = get_club

ME = "u-me"
def club(name, genres, mc, owner="u-x", desc=""):
    d = {"_id": ObjectId(), "name": name, "description": desc, "genres": genres, "member_count": mc, "owner_id": owner, "created_at": datetime(2026, 10, 1)}
    db.clubs.docs.append(d); return d
async def main():
    ok("장르 정규화(목록 밖 제거·중복 제거·최대 3)", clubs.normalize_club_genres(["록", "록", "없는장르", "재즈", "힙합", "댄스"]) == ["록", "재즈", "힙합"])
    ok("곡 장르 별칭 매핑", clubs.track_genre_to_club("Dance Pop") == "댄스" and clubs.track_genre_to_club("붐뱁") == "힙합" and clubs.track_genre_to_club("City pop") == "시티팝" and clubs.track_genre_to_club("캐롤") is None)
    a = club("시티팝 모임", ["시티팝", "재즈"], 5, desc="밤 드라이브 음악")
    b = club("힙합 크루", ["힙합"], 9)
    c = club("록 스피릿", ["록"], 20)
    mine = club("내가 가입한 재즈", ["재즈"], 50)
    db.club_members.docs.append({"club_id": str(mine["_id"]), "user_id": ME})
    r = await clubs.list_clubs(sort="members", limit=20, before=None, q="드라이브", genre=None, current_user=None)
    ok("검색: 소개 부분 일치", [x["name"] for x in r["clubs"]] == ["시티팝 모임"])
    r = await clubs.list_clubs(sort="members", limit=20, before=None, q=None, genre="재즈", current_user=None)
    ok("장르 필터 + 인원순", [x["name"] for x in r["clubs"]] == ["내가 가입한 재즈", "시티팝 모임"])
    r = await clubs.list_clubs(sort="members", limit=20, before=None, q="(", genre=None, current_user=None)
    ok("특수문자 검색 안전(정규식 이스케이프)", r["clubs"] == [])
    r = await clubs.list_clubs(sort="new", limit=20, before=None, q=None, genre="없는장르", current_user=None)
    ok("잘못된 장르 400", getattr(r, "status_code", None) == 400)
    ok("응답에 genres 포함", "genres" in clubs._serialize_club(a))
    for g in (["재즈"], "Jazz", ["시티팝"], ["R&B"]):
        db.tracks.docs.append({"_id": ObjectId(), "uploader_id": ME, "genre": g})
    r = await clubs.recommended_clubs(limit=10, current_user={"id": ME})
    names = [x["name"] for x in r["clubs"]]
    ok("추천: 내 곡 장르 우선(겹침 많은 순)", names[0] == "시티팝 모임" and r["my_genres"][0] == "재즈")
    ok("추천: 가입한 크루 제외", "내가 가입한 재즈" not in names)
    ok("추천: 부족분은 인기 크루로 채움", set(names) == {"시티팝 모임", "힙합 크루", "록 스피릿"})
    r = await clubs.recommended_clubs(limit=10, current_user={"id": "u-new"})
    ok("곡 없는 사용자 → 인기순", [x["name"] for x in r["clubs"]][0] == "내가 가입한 재즈" and r["my_genres"] == [])
    own = club("내 크루", [], 1, owner=ME)
    r = await clubs.update_club(str(own["_id"]), clubs.ClubUpdate(genres=["EDM", "기타"], description="새 소개"), current_user={"id": ME}, conn=None)
    ok("크루장 장르·소개 수정", isinstance(r, dict) and r["genres"] == ["EDM", "기타"] and own["description"] == "새 소개")
    r = await clubs.update_club(str(a["_id"]), clubs.ClubUpdate(genres=["록"]), current_user={"id": ME}, conn=None)
    ok("크루장 아니면 403", getattr(r, "status_code", None) == 403)
    r = await clubs.update_club(str(own["_id"]), clubs.ClubUpdate(), current_user={"id": ME}, conn=None)
    ok("수정 항목 없으면 400", getattr(r, "status_code", None) == 400)
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
