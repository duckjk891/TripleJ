"""v3.356 관련곡 자동 이어듣기 시뮬레이션 — 실제 라우트 함수(개선 전 tracks_orig / 개선 후 tracks)를
가짜 pg·mongo·redis 로 호출한다. 네트워크 차단 컨테이너에서 실행(운영 DB 무접촉):

  docker run --rm --network none -v <stage>:/stage:ro -v <catalog>:/cat.json:ro maidol-app:latest sh -c \
    "cp -r /stage/app/. /srv/app/app/ && cp /stage/_orig/app/routes/tracks.py /srv/app/app/routes/tracks_orig.py \
     && cd /srv/app && PYTHONPATH=/srv/app python /stage/_sim/sim_related.py /cat.json"

catalog JSON = {"tracks":[{id,title,uploader_id,genre,play_count,created_at,is_public,emb:[..] | "[..]"}]}
(인자 없으면 합성 카탈로그 — 하니스 자체 점검용, 결론용 아님)

앱 쪽 재현(services/playback.ts·stores/playerStore.ts):
  recentlyPlayedIds(앞=최근, cap) → exclude = recent[:N] ∪ 큐 현재 위치 ±5. 곡이 시작되면 related(현재곡, limit=1) 1곡을 붙인다.
"""
import asyncio, json, math, random, re, statistics, sys, time
from collections import Counter

import numpy as np
from bson import ObjectId

import app.routes.tracks as T_NEW
import app.routes.tracks_orig as T_OLD
import app.services.related_variety as RV

SONG_SEC = 210  # 곡당 평균 3.5분(시간 버킷 진행용)


# ── 카탈로그 ────────────────────────────────────────────────────────────────
def load_catalog(path):
    raw = json.load(open(path))["tracks"]
    out = []
    for t in raw:
        e = t.get("emb")
        if isinstance(e, str):
            e = json.loads(e)
        out.append({**t, "emb": np.array(e, dtype=np.float32) if e else None,
                    "is_public": t.get("is_public", True)})
    return out


def synthetic_catalog(n=149, dim=128, seed=7):
    rng = np.random.default_rng(seed)
    genres = ["인디", "발라드", "trance", "힙합", "R&B", "댄스", "록", "lofi"]
    gc = {g: rng.normal(size=dim) for g in genres}
    ups = [f"u{i:02d}" for i in range(40)]
    upw = np.array([1 / (i + 1) ** 1.1 for i in range(40)]); upw /= upw.sum()
    uc = {u: rng.normal(size=dim) * 0.6 for u in ups}
    out = []
    for i in range(n):
        g = genres[rng.integers(len(genres))]
        u = ups[rng.choice(40, p=upw)]
        e = gc[g] + uc[u] + rng.normal(size=dim) * 0.9
        out.append({"id": str(ObjectId()), "title": f"t{i}", "uploader_id": u, "genre": g,
                    "play_count": int(rng.integers(0, 400)), "created_at": f"2026-09-{1 + i % 30:02d}",
                    "is_public": True, "emb": e.astype(np.float32)})
    return out


# ── 가짜 DB ─────────────────────────────────────────────────────────────────
class FakePG:
    def __init__(self, cat):
        self.ids = [t["id"] for t in cat if t["emb"] is not None]
        m = np.stack([t["emb"] for t in cat if t["emb"] is not None])
        self.m = m / np.linalg.norm(m, axis=1, keepdims=True)
        self.ix = {tid: i for i, tid in enumerate(self.ids)}

    async def fetchrow(self, sql, tid):
        i = self.ix.get(tid)
        return None if i is None else {"embedding": i}

    async def fetch(self, sql, emb_i, tid, k):
        sims = self.m @ self.m[emb_i]
        order = np.argsort(-sims)
        out = []
        for j in order:
            if self.ids[j] == tid:
                continue
            out.append({"track_id": self.ids[j], "score": float(sims[j])})
            if len(out) >= k:
                break
        return out


def _match(d, q):
    for k, v in q.items():
        dv = d.get(k)
        if k == "_id":
            sid = d["_id"]
            if not isinstance(v, dict):
                if sid != v: return False
                continue
            if "$in" in v and sid not in set(v["$in"]): return False
            if "$nin" in v and sid in set(v["$nin"]): return False
        elif k == "title" and isinstance(v, dict) and "$not" in v:
            if v["$not"].search(dv or ""): return False
        elif isinstance(v, dict) and "$in" in v:
            vals = set(v["$in"])
            if isinstance(dv, (list, tuple)):
                if not vals & set(dv): return False
            elif dv not in vals: return False
        elif isinstance(dv, (list, tuple)) and not isinstance(v, (list, tuple)):
            if v not in dv: return False
        elif dv != v:
            return False
    return True


class Cursor:
    def __init__(self, docs): self.docs = docs
    def sort(self, key, direction):
        self.docs = sorted(self.docs, key=lambda d: d.get(key), reverse=direction < 0)  # FakeMongo 가 None 없이 채움
        return self
    def limit(self, n): self.docs = self.docs[:n]; return self
    async def to_list(self, length=None): return [dict(d) for d in self.docs[:length]]
    def __aiter__(self):
        self._it = iter(self.docs); return self
    async def __anext__(self):
        try: return dict(next(self._it))
        except StopIteration: raise StopAsyncIteration


class Coll:
    def __init__(self, docs): self.docs = docs
    def find(self, q=None, proj=None):
        # 실제 Mongo 자연 순서 ≈ 삽입 순서
        return Cursor([d for d in self.docs if _match(d, q or {})])
    async def find_one(self, q, proj=None):
        for d in self.docs:
            if _match(d, q): return dict(d)
        return None


class FakeMongo:
    def __init__(self, cat):
        docs = []
        for t in cat:
            docs.append({"_id": ObjectId(t["id"]), "title": t.get("title") or "", "uploader_id": t.get("uploader_id"),
                         "genre": t.get("genre"), "play_count": t.get("play_count") or 0,
                         "created_at": t.get("created_at") or "", "is_public": t.get("is_public", True)})
        self.tracks = Coll(docs)
        self.albums = Coll([])


class FakeRedis:
    def __init__(self): self.h = {}
    def pipeline(self): return FakePipe(self)


class FakePipe:
    def __init__(self, r): self.r, self.ops = r, []
    def hgetall(self, k): self.ops.append(("hgetall", k)); return self
    def hincrby(self, k, f, n): self.ops.append(("hincrby", k, f, n)); return self
    def expire(self, k, s): self.ops.append(("expire", k)); return self
    async def execute(self):
        out = []
        for op in self.ops:
            if op[0] == "hgetall":
                out.append(dict(self.r.h.get(op[1], {})))
            elif op[0] == "hincrby":
                h = self.r.h.setdefault(op[1], {})
                h[op[2]] = h.get(op[2], 0) + op[3]; out.append(h[op[2]])
            else:
                out.append(True)
        return out


class Clock:
    t = 1_790_000_000.0
    @classmethod
    def time(cls): return cls.t


# ── 앱 재현 ─────────────────────────────────────────────────────────────────
class App:
    def __init__(self, recent_cap, excl_n):
        self.recent, self.queue, self.cap, self.excl_n = [], [], recent_cap, excl_n
    def note(self, tid):
        if self.recent and self.recent[0] == tid: return
        self.recent = [tid] + [x for x in self.recent if x != tid]
        self.recent = self.recent[:self.cap]
    def exclude(self):
        ci = len(self.queue) - 1
        win = self.queue[max(0, ci - 5): ci + 6]
        return list(dict.fromkeys(self.recent[:self.excl_n] + win))


async def related(variant, tid, excl, user):
    if variant["server"] == "old":
        r = await T_OLD.get_related_tracks(tid, exclude=",".join(excl) or None, limit=1, pg=PG)
    else:
        r = await T_NEW.get_related_tracks(tid, exclude=",".join(excl) or None, limit=1, pg=PG, current_user=user)
    return (r["tracks"][0]["id"], r["source"]) if r.get("tracks") else (None, r.get("source"))


async def session_chain(variant, app, start, n, user, srcs):
    plays = [start]
    app.queue = [start]; app.note(start)
    cur = start
    for _ in range(n - 1):
        nxt, src = await related(variant, cur, app.exclude(), user)
        srcs[src] += 1
        if not nxt:
            break
        Clock.t += SONG_SEC
        app.queue.append(nxt); app.note(nxt)
        plays.append(nxt); cur = nxt
    return plays


def metrics(plays, up):
    c = Counter(plays)
    top = c.most_common(3)
    same = sum(1 for a, b in zip(plays, plays[1:]) if up.get(a) and up.get(a) == up.get(b))
    run, best = 1, 1
    for a, b in zip(plays, plays[1:]):
        run = run + 1 if up.get(a) and up.get(a) == up.get(b) else 1
        best = max(best, run)
    trans = max(1, len(plays) - 1)
    return {"n": len(plays), "uniq": len(c), "uniq_ratio": len(c) / max(1, len(plays)),
            "top1": top[0][1] if top else 0, "top3": sum(x[1] for x in top),
            "same_up": same / trans, "max_run": best}


def agg(rows):
    keys = rows[0].keys()
    return {k: statistics.mean(r[k] for r in rows) for k in keys} | {"max_run_worst": max(r["max_run"] for r in rows)}


VARIANTS = [
    ("A 현행(서버 v3.286 · exclude 30)", {"server": "old", "excl": 30, "cap": 40}),
    ("B exclude 70 만", {"server": "old", "excl": 70, "cap": 80}),
    ("C 서버 개선 만(exclude 30)", {"server": "new", "excl": 30, "cap": 40}),
    ("D 서버 개선 + exclude 70 (제안)", {"server": "new", "excl": 70, "cap": 80}),
    ("D-탐색 없음", {"server": "new", "excl": 70, "cap": 80, "explore": 0.0}),
    ("D-hub 감쇠 없음", {"server": "new", "excl": 70, "cap": 80, "nohub": True}),
]


def configure(v):
    RV.EXPLORE_P = v.get("explore", ORIG_EXPLORE)
    RV.hub_mult = (lambda *a, **k: 1.0) if v.get("nohub") else ORIG_HUB


async def run_scenario(cat, scenario, user_kind, reps, seed):
    pub = [t["id"] for t in cat if t["is_public"] and not T_NEW._INST_TITLE_RE.search(t.get("title") or "")]
    up = {t["id"]: t.get("uploader_id") for t in cat}
    results = {}
    for name, v in VARIANTS:
        configure(v)
        rows, srcs = [], Counter()
        for rep in range(reps):
            random.seed(seed * 1000 + rep); RV._random.seed(seed * 1000 + rep)
            FAKE_REDIS.h.clear(); Clock.t = 1_790_000_000.0
            user = {"id": f"sim{rep}", "role": "user"} if user_kind == "login" else None
            app = App(v["cap"], v["excl"])
            plays = []
            if scenario == "200연속":
                plays = await session_chain(v, app, random.choice(pub), 200, user, srcs)
            else:  # "이틀 362회": 세션 6회(앱 재시작=큐 초기화, 최근 이력은 유지), 세션 사이 3시간 공백
                for s in range(6):
                    plays += await session_chain(v, app, random.choice(pub), 61 if s < 2 else 60, user, srcs)
                    Clock.t += 3 * 3600
            rows.append(metrics(plays, up))
        results[name] = agg(rows) | {"src": dict(srcs)}
    return results


def table(title, res):
    print(f"\n### {title}")
    print("| 방식 | 재생 수 | 고유곡 | 고유 비율 | 최다 반복 곡 | 상위3곡 합 | 같은 제작자 연속 비율 | 최장 같은 제작자 연속(평균/최악) | 출처 비율 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, r in res.items():
        tot = sum(r["src"].values()) or 1
        src = " ".join(f"{k}{v * 100 / tot:.0f}%" for k, v in sorted(r["src"].items(), key=lambda x: -x[1]))
        print(f"| {name} | {r['n']:.0f} | {r['uniq']:.1f} | {r['uniq_ratio'] * 100:.0f}% | {r['top1']:.1f} | {r['top3']:.1f} | "
              f"{r['same_up'] * 100:.1f}% | {r['max_run']:.1f} / {r['max_run_worst']} | {src} |")


async def main():
    global PG, FAKE_REDIS, ORIG_EXPLORE, ORIG_HUB
    real = len(sys.argv) > 1 and sys.argv[1] != "-"
    cat = load_catalog(sys.argv[1]) if real else synthetic_catalog()
    pub = [t for t in cat if t["is_public"]]
    PG = FakePG(cat)
    mongo = FakeMongo(cat)
    FAKE_REDIS = FakeRedis()
    for T in (T_NEW, T_OLD):
        T.get_mongo = lambda: mongo
        T.get_redis = lambda: FAKE_REDIS
        T.logger.disabled = True
    RV.time = Clock
    RV.logger.disabled = True
    ORIG_EXPLORE, ORIG_HUB = RV.EXPLORE_P, RV.hub_mult
    ups = Counter(t.get("uploader_id") for t in pub)
    print(f"카탈로그: 공개 {len(pub)}곡(임베딩 {sum(1 for t in pub if t['emb'] is not None)}), 전체 임베딩 {len(PG.ids)}, "
          f"제작자 {len(ups)}명, 최다 제작자 {ups.most_common(1)[0][1]}곡"
          + ("" if real else " — 합성 카탈로그(하니스 점검용)"))
    # hub 진단: 각 곡의 top-5 최근접 이웃에 몇 번 등장하나(in-degree)
    pub_ids = {t["id"] for t in pub}
    indeg = Counter()
    for t in pub:
        if t["emb"] is None: continue
        rows = await PG.fetch("", PG.ix[t["id"]], t["id"], 8)
        for r in [r for r in rows if r["track_id"] in pub_ids][:5]:
            indeg[r["track_id"]] += 1
    title = {t["id"]: t.get("title") for t in cat}
    print("hub(top-5 이웃 등장 횟수 상위):", ", ".join(f"{title[k]}={v}" for k, v in indeg.most_common(8)))
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    for si, scen in enumerate(("200연속", "이틀 362회")):
        for ki, (kind, label) in enumerate((("login", "로그인(성인)"), ("anon", "비로그인"))):
            res = await run_scenario(cat, scen, kind, reps, seed=11 + si * 2 + ki)
            table(f"{scen} · {label} · 반복 {reps}회 평균", res)


if __name__ == "__main__":
    asyncio.run(main())
