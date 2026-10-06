"""v3.297 배지·피드백 온도 — 격리 컨테이너 + 가짜 DB."""
import asyncio, sys, uuid
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.routes.reputation as rep

ok("기본 36.5", rep.compute_temperature(0, 0, 0) == 36.5)
ok("댓글 10개 +2°", rep.compute_temperature(10, 0, 0) == 38.5)
ok("댓글 상한 +15", rep.compute_temperature(1000, 0, 0) == 51.5)
ok("좋아요 상한 +10", rep.compute_temperature(0, 10000, 0) == 46.5)
ok("인정 신고 1건 −2°", rep.compute_temperature(0, 0, 1) == 34.5)
ok("하한 0", rep.compute_temperature(0, 0, 100) == 0.0)
b = [x["key"] for x in rep.earned_badges({"tracks": 12, "hit": True, "artists": 1, "crew_leader": True, "comments": 25, "mission": True}, 41.0)]
ok("배지 전부 획득", b == ["first_release", "prolific", "hit", "artist_debut", "crew_leader", "commenter", "mission", "warm"])
ok("활동 없으면 배지 없음", rep.earned_badges({}, 36.5) == [])

class C:
    def __init__(s, n=0, one=None, boom=False): s.n, s.one, s.boom = n, one, boom
    async def count_documents(s, q):
        if s.boom: raise RuntimeError("db down")
        return s.n
    async def find_one(s, q, proj=None):
        if s.boom: raise RuntimeError("db down")
        return s.one
class M:
    tracks = C(3, {"_id": 1}); characters = C(1); clubs = C(0, None); track_comments = C(4); feed_comments = C(6)
    weekly_mission_progress = C(0, None)
class Conn:
    async def fetchval(s, q, *a):
        if "FROM likes" in q: return 20
        if "feed_likes" in q: return 20
        if "reports" in q: return 1
class R:
    store = {}
    async def get(s, k): return s.store.get(k)
    async def set(s, k, v, ex=None): s.store[k] = v
r = R(); rep.get_redis = lambda: r; rep.get_mongo = lambda: M()
async def main():
    uid = str(uuid.uuid4())
    out = await rep.get_reputation(uid, conn=Conn())
    # comments 10 → +2, likes 40 → +2, upheld 1 → -2 => 38.5
    ok("집계 온도 38.5", out["temperature"] == 38.5)
    ok("집계 배지(발매·인기·아티스트)", [x["key"] for x in out["badges"]] == ["first_release", "hit", "artist_debut"])
    ok("캐시 저장", any(k.endswith(uid) for k in r.store))
    M.tracks = C(boom=True)
    out2 = await rep.get_reputation(str(uuid.uuid4()), conn=None)
    ok("DB 일부 실패·PG 없음도 200 응답(강등)", "temperature" in out2 and isinstance(out2["badges"], list))
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
