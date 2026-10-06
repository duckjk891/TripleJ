"""v3.287 재기동 자동 재개 — 네트워크 차단 컨테이너 + 가짜 DB/HTTP (운영 무접촉)."""
import asyncio, sys, copy
from datetime import timedelta
from bson import ObjectId

FAILS = []
def ok(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: FAILS.append(name)

import app.services.gen_jobs as gj

# ── 가짜 Mongo ──────────────────────────────────────────────
def _match(d, q):
    for k, v in q.items():
        if k == "$or":
            if not any(_match(d, x) for x in v): return False
            continue
        dv = d.get(k)
        if isinstance(v, dict):
            for op, ov in v.items():
                if op == "$exists" and ((k in d) != ov): return False
                if op == "$lt" and not (dv is not None and dv < ov): return False
                if op == "$in" and dv not in ov: return False
                if op == "$ne" and dv == ov: return False
        elif dv != v:
            return False
    return True
class Coll:
    def __init__(self): self.docs = {}
    def find(self, q=None, proj=None, **k):
        hits = [d for d in self.docs.values() if _match(d, q or {})]
        class It:
            def __init__(s): s.i = iter(hits)
            def __aiter__(s): return s
            async def __anext__(s):
                try: return next(s.i)
                except StopIteration: raise StopAsyncIteration
        return It()
    async def find_one(self, q, proj=None, **k):
        for d in self.docs.values():
            if _match(d, q): return d
        return None
    async def find_one_and_update(self, q, upd, return_document=None, **k):
        await asyncio.sleep(0)  # 경합 재현용 양보
        for d in self.docs.values():
            if _match(d, q):
                prev = copy.deepcopy(d)
                for kk, vv in upd.get("$set", {}).items(): d[kk] = vv
                for kk, vv in upd.get("$inc", {}).items(): d[kk] = d.get(kk, 0) + vv
                return d if return_document else prev
        return None
    async def update_one(self, q, upd, **k):
        for d in self.docs.values():
            if _match(d, q):
                for kk, vv in upd.get("$set", {}).items(): d[kk] = vv
                class R: matched_count = 1; modified_count = 1
                return R()
        class R0: matched_count = 0; modified_count = 0
        return R0()
    async def delete_one(self, q): pass
    async def create_index(self, *a, **k): pass
class DB:
    def __init__(self):
        self.gen_jobs = Coll(); self.generations = Coll(); self.inst_jobs = Coll()
    def __getitem__(self, k): return getattr(self, k)
db = DB()
gj.get_mongo = lambda: db
async def _noop(*a, **k): return None
gj.ensure_indexes = _noop
refunds = []
async def fake_refund(mongo, job): refunds.append(job["_id"]); return True
gj.refund_once = fake_refund

def gdoc(kind, **kw):
    now = gj.utcnow()
    d = {"_id": ObjectId(), "user_id": "u-test-0001", "kind": kind, "group": gj.group_of(kind),
         "status": "processing", "boot_id": "old-boot", "created_at": now - timedelta(minutes=1),
         "charged": True, "point_cost": 5, "point_ref": "ref", "resume": {"body": {"x": 1}}}
    d.update(kw); db.gen_jobs.docs[d["_id"]] = d; return d

calls = []
seen_ctx = []
async def r_ok(doc):
    calls.append(("ok", doc["_id"])); seen_ctx.append(gj.current_resume_job(doc["kind"]) is not None)
    return {"done": True, "kind": doc["kind"]}
async def r_boom(doc):
    calls.append(("boom", doc["_id"])); raise RuntimeError("boom")
gj.register_resumer("lyrics", r_ok)
gj.register_resumer("cover_refine", r_boom)

async def main():
    # 1) 재개
    d1 = gdoc("lyrics")
    await gj._handle_dead(db, "gen_jobs", d1); await asyncio.sleep(0.05)
    j = db.gen_jobs.docs[d1["_id"]]
    ok("dead_boot+보관입력 → 재개 실행", ("ok", d1["_id"]) in calls)
    ok("재개 후 boot_id 교체·resume_count=1", j["boot_id"] == gj.BOOT_ID and j.get("resume_count") == 1)
    ok("재개 결과 미기록 시 안전망이 done+응답 저장", j["status"] == "done" and (j.get("response") or {}).get("done") is True)
    ok("재개 중 current_resume_job 노출", seen_ctx and seen_ctx[0] is True)
    ok("재개 성공은 환불 없음", d1["_id"] not in refunds)
    # 2) 입력 미보관 → 종전 정리
    d2 = gdoc("lyrics", resume=None)
    await gj._handle_dead(db, "gen_jobs", d2)
    ok("입력 없음 → 실패+환불", db.gen_jobs.docs[d2["_id"]]["status"] == "failed" and d2["_id"] in refunds)
    # 3) 상한 초과 → 정리
    d3 = gdoc("lyrics", boot_id=gj.BOOT_ID, created_at=gj.utcnow() - timedelta(minutes=40))
    await gj._handle_dead(db, "gen_jobs", d3)
    ok("hard_cap → 실패+환불(재개 안 함)", db.gen_jobs.docs[d3["_id"]]["status"] == "failed" and ("ok", d3["_id"]) not in calls)
    # 4) 재개 1회 소진 → 정리
    d4 = gdoc("lyrics", resume_count=1)
    await gj._handle_dead(db, "gen_jobs", d4)
    ok("재개 횟수 소진 → 실패+환불", db.gen_jobs.docs[d4["_id"]]["status"] == "failed")
    # 5) 동시 2경로 → 1회만
    n0 = len(calls)
    d5 = gdoc("lyrics")
    await asyncio.gather(gj._handle_dead(db, "gen_jobs", dict(d5)), gj._handle_dead(db, "gen_jobs", dict(d5)))
    await asyncio.sleep(0.05)
    ok("기동·조회 sweep 동시 → 재개 정확히 1회", sum(1 for c in calls[n0:] if c[1] == d5["_id"]) == 1)
    # 6) 재개 함수 예외 → 실패+환불
    d6 = gdoc("cover_refine")
    await gj._handle_dead(db, "gen_jobs", d6); await asyncio.sleep(0.05)
    ok("재개 실패 → 실패+환불", db.gen_jobs.docs[d6["_id"]]["status"] == "failed" and d6["_id"] in refunds)
    # 7) 과금 전 사망(charged=false, cost>0) → 재개 안 함
    d7 = gdoc("lyrics", charged=False)
    ok("과금 전 사망은 재개 대상 아님", gj.resumable(d7, "gen_jobs") is False)
    # 8) 무과금 영상(재편집) — cost 0 이면 charged 없어도 재개 대상
    gj.register_resumer("video", r_ok)
    d8 = gdoc("video", charged=False, point_cost=0)
    ok("무과금 작업도 재개 대상", gj.resumable(d8, "gen_jobs") is True)
    # 9) 작곡 문서 재개(generations)
    music_calls = []
    async def r_music(doc): music_calls.append(doc.get("suno_task_id")); db.generations.docs[doc["_id"]]["status"] = "completed"
    gj.register_resumer("music", r_music)
    g = {"_id": ObjectId(), "user_id": "u-test-0001", "status": "processing", "boot_id": "old-boot",
         "point_ref": "pr", "refunded": False, "created_at": gj.utcnow(), "suno_task_id": "T-123"}
    db.generations.docs[g["_id"]] = g
    await gj._handle_dead(db, "generations", g); await asyncio.sleep(0.05)
    ok("작곡 dead_boot → 같은 Suno 작업으로 재개", music_calls == ["T-123"] and db.generations.docs[g["_id"]]["status"] == "completed")
asyncio.run(main())

# ── 등록부: 실제 모듈 import 시 6종 등록 ─────────────────────
gj._RESUMERS.clear()
import importlib
import app.routes.generate as G; importlib.reload(G)
import app.routes.upload as U; importlib.reload(U)
import app.routes.tracks as T; importlib.reload(T)
import app.services.inst_service as I; importlib.reload(I)
ok("재개 함수 6종 등록", {"music", "lyrics", "inst", "cover", "cover_refine", "video"} <= set(gj._RESUMERS))

# ── Suno 생성기: 재개 시 제출 생략·같은 taskId 폴링 / 신규 제출 시 taskId 즉시 저장 ─────
import app.services.suno_generator as S
class _Stop(Exception): pass
CAP = {"post": 0, "get_params": [], "updates": []}
class FakeResp:
    def __init__(self, data): self._d = data
    def raise_for_status(self): pass
    def json(self): return self._d
class FakeClient:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, headers=None, json=None, **k):
        CAP["post"] += 1; return FakeResp({"code": 200, "data": {"taskId": "T-NEW"}})
    async def get(self, url, headers=None, params=None, **k):
        CAP["get_params"].append(dict(params or {})); raise _Stop()
class _GC:
    async def find_one(self, *a, **k): return None
    async def update_one(self, q, upd, **k): CAP["updates"].append(upd.get("$set", {})); return None
class FakeMDB: generations = _GC(); gen_jobs = _GC()
S.settings.suno_api_key = "dummy-no-network"
S.httpx.AsyncClient = FakeClient
async def _nosleep(*a, **k): return None
S.asyncio.sleep = _nosleep
async def run_suno(**kw):
    try:
        await S.generate_music_suno("0123456789abcdef01234567", mongo_db=FakeMDB(), lyrics="[Verse]\n가사", vocal="female_warm", title="t", **kw)
    except _Stop:
        pass
asyncio.run(run_suno(resume_task_id="T-OLD"))
ok("재개: Suno 제출 0회", CAP["post"] == 0)
ok("재개: 같은 taskId 폴링", CAP["get_params"] and CAP["get_params"][0].get("taskId") == "T-OLD")
ok("재개: 요청 캡처 중복 기록 없음", not any("suno_request_body" in u for u in CAP["updates"]))
CAP.update(post=0, get_params=[], updates=[])
asyncio.run(run_suno())
ok("신규: 제출 1회", CAP["post"] == 1)
ok("신규: 제출 즉시 suno_task_id 저장", any(u.get("suno_task_id") == "T-NEW" for u in CAP["updates"]))

# ── 연주곡 파이프라인: 재개 시 제출 생략 ─────
CAP.update(post=0, get_params=[], updates=[])
class _TC:
    async def find_one(self, *a, **k): return {"_id": ObjectId(), "audio_url": "tracks/a.mp3", "title": "x"}
class _IC:
    async def update_one(self, *a, **k): return None
class FakeIDB: tracks = _TC(); inst_jobs = _IC()
I.settings.suno_api_key = "dummy-no-network"
I.httpx.AsyncClient = FakeClient
I.asyncio.sleep = _nosleep
try:
    asyncio.run(I._run_pipeline(FakeIDB(), str(ObjectId()), str(ObjectId()), resume_task_id="IT-1"))
except _Stop:
    pass
ok("연주곡 재개: 제출 0회·같은 taskId 폴링", CAP["post"] == 0 and CAP["get_params"] and CAP["get_params"][0].get("taskId") == "IT-1")

print("RESULT:", "PASS" if not FAILS else f"{len(FAILS)} FAIL")
sys.exit(1 if FAILS else 0)
