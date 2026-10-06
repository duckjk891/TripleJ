"""v3.287 — 실제 작사 핸들러 재개 모드 통합(가짜 DB·가짜 LLM, 네트워크 차단)."""
import asyncio, sys, copy
from datetime import timedelta
from bson import ObjectId
import app.services.gen_jobs as gj
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
import app.routes.generate as G
import app.services.lyrics_generator as LG
import app.services.fatigue_service as FS

db = DB(); gj.get_mongo = lambda: db
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)

spent = []
async def fake_spend(*a, **k): spent.append(a); return True
G.spend_points = fake_spend
G._kids_filter_on = lambda: False
async def fake_gen(**kw): return {"title": "재개된 노래", "lyrics": "[Verse]\n가사 한 줄", "categories": []}
LG.generate_lyrics = fake_gen
async def nohook(*a, **k): return None
FS.on_generation_completed = nohook
async def fake_fatigue(*a, **k): raise AssertionError("재개 모드에서 피로 게이트 호출됨")
G._fatigue_gate_response = fake_fatigue

now = gj.utcnow()
doc = {"_id": ObjectId(), "user_id": "u-test-0001", "kind": "lyrics", "group": "lyrics", "status": "processing",
       "boot_id": "old-boot", "created_at": now - timedelta(minutes=1), "charged": True, "point_cost": 5,
       "point_ref": "ref-1", "request_id": "a" * 32,
       "resume": {"body": {"prompt": "비 오는 날", "genre": "발라드", "mood": "슬픔", "save": False}}}
db.gen_jobs.docs[doc["_id"]] = doc
async def main():
    await gj._handle_dead(db, "gen_jobs", doc)
    for _ in range(20):
        await asyncio.sleep(0.05)
        if db.gen_jobs.docs[doc["_id"]]["status"] != "processing": break
    j = db.gen_jobs.docs[doc["_id"]]
    ok("작사 재개 → 기존 원장 done", j["status"] == "done")
    ok("재개 응답에 가사·원장 id", (j.get("response") or {}).get("title") == "재개된 노래" and (j.get("response") or {}).get("gen_job_id") == str(doc["_id"]))
    ok("재개는 재과금 0회", spent == [])
asyncio.run(main())
print("LYRICS RESULT:", "PASS" if not FAILS else f"{len(FAILS)} FAIL")
