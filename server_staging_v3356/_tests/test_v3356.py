"""v3.356 단위 테스트 — 네트워크 차단 컨테이너, 가짜 DB(운영 무접촉). _sim/sim_related.py 의 가짜 DB 재사용."""
import asyncio, random, sys
sys.argv = ["x"]
sys.path.insert(0, "/stage/_sim")
import sim_related as S  # noqa: E402  (모듈 import 시 main 실행 안 되게 아래 가드)
import app.services.related_variety as RV
import app.routes.tracks as T

fails = 0
def ok(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: fails += 1

# ── 순수 함수 ──
random.seed(1)
ok("weighted_pick 가중 0 은 안 뽑음", all(RV.weighted_pick([0, 1, 0, 2], 2) in ([1, 3], [3, 1]) for _ in range(50)))
ok("weighted_pick 전부 0 → 빈 목록", RV.weighted_pick([0, 0], 1) == [])
ok("weighted_pick need 초과 시 가능한 만큼", sorted(RV.weighted_pick([1, 1], 5)) == [0, 1])
cnt = sum(1 for _ in range(4000) if RV.weighted_pick([1, 3], 1) == [1])
ok("weighted_pick 비율 ≈ 3:1", 2850 < cnt < 3150)
ok("hub_mult 개인 1/(1+c)", RV.hub_mult("a", {"a": 3}, "u:x") == 0.25 and RV.hub_mult("b", {"a": 3}, "u:x") == 1.0)
ok("hub_mult 전체 평균 정규화", abs(RV.hub_mult("a", {"a": 4, "b": 2, "c": 0}, "g") - 1 / (1 + 4 / 2)) < 1e-9)
docs = [{"uploader_id": "X"}, {"uploader_id": "Y"}]
ok("apply_block strict", RV.apply_block([1, 1], docs, "X") == [0.0, 1])
ok("apply_block strict 전부 막히면 0", RV.apply_block([1, 1], [docs[0], docs[0]], "X") == [0.0, 0.0])
ok("apply_block 비strict 전부 막히면 원래 가중", RV.apply_block([1, 1], [docs[0], docs[0]], "X", strict=False) == [1, 1])
ok("blocked_uploader 2연속만", RV.blocked_uploader("X", "X") == "X" and RV.blocked_uploader("X", "Y") is None and RV.blocked_uploader("X", None) is None)
ok("previous_track_id 기준곡 건너뜀", RV.previous_track_id(["s", "p", "q"], "s") == "p" and RV.previous_track_id(["s"], "s") is None)
ok("scope_for", RV.scope_for({"id": "u1"}) == "u:u1" and RV.scope_for(None) == "g")


class BrokenRedis:
    def pipeline(self): raise ConnectionError("down")


async def main():
    cat = S.synthetic_catalog()
    S.PG = S.FakePG(cat)
    mongo = S.FakeMongo(cat)
    T.get_mongo = lambda: mongo
    T.logger.disabled = True
    RV.logger.disabled = True
    ids = [t["id"] for t in cat]
    up = {t["id"]: t["uploader_id"] for t in cat}

    # Redis 장애 → 감쇠 없이 정상 응답
    T.get_redis = lambda: BrokenRedis()
    r = await T.get_related_tracks(ids[0], exclude=None, limit=1, pg=S.PG, current_user=None)
    ok("Redis 장애에도 1곡 응답", len(r["tracks"]) == 1)
    def _raise(): raise RuntimeError("no redis")
    T.get_redis = _raise
    r = await T.get_related_tracks(ids[0], exclude=None, limit=1, pg=S.PG, current_user={"id": "u"})
    ok("get_redis 예외에도 1곡 응답", len(r["tracks"]) == 1)

    # 카운터 기록(로그인=개인+전체)
    fr = S.FakeRedis(); T.get_redis = lambda: fr
    RV.EXPLORE_P = 0.0
    r = await T.get_related_tracks(ids[0], exclude=None, limit=2, pg=S.PG, current_user={"id": "u9"})
    keys = list(fr.h)
    ok("로그인 카운터 개인+전체 기록", any(":u:u9:" in k for k in keys) and any(":g:" in k for k in keys)
       and sum(sum(h.values()) for h in fr.h.values()) == 4)

    # 같은 제작자 3연속 차단: 직전 곡·기준곡이 같은 제작자 → 그 제작자 곡 안 나옴(다른 후보 있을 때)
    by_up = {}
    for t in ids: by_up.setdefault(up[t], []).append(t)
    big = max(by_up, key=lambda u: len(by_up[u]))
    seed, prev = by_up[big][0], by_up[big][1]
    same = 0
    for i in range(200):
        r = await T.get_related_tracks(seed, exclude=f"{seed},{prev}", limit=1, pg=S.PG, current_user=None)
        same += up[r["tracks"][0]["id"]] == big
    ok(f"3연속 차단(제작자 {big} {len(by_up[big])}곡) 200회 중 0", same == 0)
    # 직전 곡이 다른 제작자면 같은 제작자도 허용(감쇠만)
    other = next(t for t in ids if up[t] != big)
    same = 0
    for i in range(300):
        r = await T.get_related_tracks(seed, exclude=f"{seed},{other}", limit=1, pg=S.PG, current_user=None)
        same += up[r["tracks"][0]["id"]] == big
    ok(f"2연속은 허용(300회 중 {same})", same > 0)

    # 탐색 100% → source explore, 기준곡·제외곡 미포함
    RV.EXPLORE_P = 1.0
    ex = ids[1:60]
    r = await T.get_related_tracks(ids[0], exclude=",".join(ex), limit=3, pg=S.PG, current_user=None)
    got = [t["id"] for t in r["tracks"]]
    ok("탐색 출처·제외 준수", r["source"] == "explore" and len(got) == 3 and not (set(got) & (set(ex) | {ids[0]})))

    # hub 감쇠: 한 곡을 개인 카운터로 20회 뽑힌 것으로 만들면 그 곡 선택이 크게 준다
    RV.EXPLORE_P = 0.0
    fr.h.clear()
    from collections import Counter
    c0 = Counter(); c1 = Counter()
    for i in range(300):
        fr.h.clear()
        r = await T.get_related_tracks(ids[5], exclude=None, limit=1, pg=S.PG, current_user={"id": "h"})
        c0[r["tracks"][0]["id"]] += 1
    hub = c0.most_common(1)[0][0]
    for i in range(300):
        fr.h.clear()
        fr.h[RV._key("u:h", RV._buckets()[0])] = {hub: 20}
        r = await T.get_related_tracks(ids[5], exclude=None, limit=1, pg=S.PG, current_user={"id": "h"})
        c1[r["tracks"][0]["id"]] += 1
    ok(f"hub 감쇠 {c0[hub]}→{c1[hub]}/300", c1[hub] < c0[hub] * 0.3)

    print("\n" + ("ALL PASS" if fails == 0 else f"{fails} FAIL"))

asyncio.run(main())
