"""v3.286 서버 단위 테스트 — 네트워크 차단 컨테이너에서 가짜 DB/스토리지로 실행(운영 DB 무접촉)."""
import asyncio, sys
from datetime import datetime, timedelta
from bson import ObjectId
import app.routes.character as C
import app.routes.tracks as T
import app.routes.charts as CH

fails = 0
def ok(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: fails += 1

# ── 가짜 Mongo(character_jobs) ──
class Coll:
    def __init__(self, docs): self.docs = {d["_id"]: d for d in docs}
    def _m(self, d, q):
        for k, v in q.items():
            if k == "$or":
                if not any(self._m(d, x) for x in v): return False
                continue
            dv = d.get(k)
            if isinstance(v, dict):
                if "$exists" in v and ((k in d) != v["$exists"]): return False
                if "$lt" in v and not (dv is not None and dv < v["$lt"]): return False
            elif dv != v: return False
        return True
    def find(self, q, proj=None):
        hits = [d for d in self.docs.values() if self._m(d, q)]
        class It:
            def __init__(s): s.i = iter(hits)
            def __aiter__(s): return s
            async def __anext__(s):
                try: return next(s.i)
                except StopIteration: raise StopAsyncIteration
        return It()
    async def find_one(self, q, proj=None):
        for d in self.docs.values():
            if self._m(d, q): return d
        return None
    async def find_one_and_update(self, q, upd):
        for d in self.docs.values():
            if self._m(d, q):
                prev = dict(d)
                for k, v in upd.get("$set", {}).items(): d[k] = v
                for k, v in upd.get("$inc", {}).items(): d[k] = d.get(k, 0) + v
                return prev
        return None
    async def update_one(self, q, upd):
        await self.find_one_and_update(q, upd)
class DB: pass

now = datetime.utcnow()
j_resumable = {"_id": ObjectId(), "status": "processing", "created_at": now - timedelta(minutes=3), "user_id": "u1",
               "resume": {"args": {"user_id": "u1", "mode": "real", "ext": ".jpg", "user_text": "t", "image_model": "gpt_image_2"},
                          "inputs": {"photo": {"obj": "characters/jobs/x/photo", "mime": "image/jpeg"}}}}
j_legacy = {"_id": ObjectId(), "status": "processing", "created_at": now - timedelta(minutes=10), "user_id": "u2"}  # 오늘 대표 job 유형
j_old = {"_id": ObjectId(), "status": "processing", "created_at": now - timedelta(minutes=40), "user_id": "u3",
         "resume": j_resumable["resume"]}
j_twice = {"_id": ObjectId(), "status": "processing", "created_at": now - timedelta(minutes=2), "user_id": "u4",
           "resume": j_resumable["resume"], "resume_count": 1}
j_done = {"_id": ObjectId(), "status": "done", "created_at": now, "user_id": "u5"}
db = DB(); db.character_jobs = Coll([j_resumable, j_legacy, j_old, j_twice, j_done])
C.get_mongo = lambda: db
refunded = []
async def fake_refund(mongo, oid): refunded.append(oid); return True
C.refund_character_job_points = fake_refund
C._load_job_inputs_sync = lambda inputs: {"photo": (b"PHOTO", "image/jpeg")}
started = []
async def fake_durable(persist=True, **kw): started.append((kw["job_id"], persist, kw.get("contents")))
C._run_character_job_durable = fake_durable

async def main():
    r = await C.resume_dead_character_jobs()
    await asyncio.sleep(0)
    ok("재개 1건(25분 이내·입력 보관·첫 재개)", r["resumed"] == 1 and started and started[0][0] == str(j_resumable["_id"]) and started[0][1] is False and started[0][2] == b"PHOTO")
    ok("입력 없는 job(오늘 사고 유형) 즉시 실패+환불", db.character_jobs.docs[j_legacy["_id"]]["status"] == "failed" and j_legacy["_id"] in refunded)
    ok("25분 초과는 재개 안 함 → 실패+환불", db.character_jobs.docs[j_old["_id"]]["status"] == "failed")
    ok("이미 1회 재개된 job 은 재개 안 함 → 실패+환불", db.character_jobs.docs[j_twice["_id"]]["status"] == "failed")
    ok("done job 불변", db.character_jobs.docs[j_done["_id"]]["status"] == "done")
    ok("재개 job resume_count=1", db.character_jobs.docs[j_resumable["_id"]].get("resume_count") == 1)
    ok("집계 failed=3", r["failed"] == 3)

    # durable 래퍼 타임아웃 → 실패+환불(무한 processing 금지)
    import importlib
    C2 = importlib.reload(C)
    jt = {"_id": ObjectId(), "status": "processing", "created_at": now, "user_id": "u6"}
    db2 = DB(); db2.character_jobs = Coll([jt]); C2.get_mongo = lambda: db2
    ref2 = []
    async def fr(m, oid): ref2.append(oid); return True
    C2.refund_character_job_points = fr
    C2.CHAR_JOB_RUN_TIMEOUT_S = 0.05
    async def slow(**kw): await asyncio.sleep(5)
    C2._run_character_job = slow
    await C2._run_character_job_durable(persist=False, job_id=str(jt["_id"]), user_id="u6", mode="real")
    ok("러너 상한 초과 → failed+환불", db2.character_jobs.docs[jt["_id"]]["status"] == "failed" and jt["_id"] in ref2)

asyncio.run(main())

# ── 추천 샘플러: 같은 제작자 감쇠 ──
import random
random.seed(7)
cnt = {0: 0, 1: 0}
for _ in range(4000):
    i = T._weighted_sample_ranks(2, 1, mults=[0.35, 1.0])[0]; cnt[i] += 1
ok("같은 제작자(랭크0) 감쇠 → 랭크1이 더 자주", cnt[1] > cnt[0])
ok("mults=None 기존 동작(상위 우세)", sum(1 for _ in range(2000) if T._weighted_sample_ranks(2, 1)[0] == 0) > 1000)

print("RESULT:", "PASS" if fails == 0 else f"{fails} FAIL")
sys.exit(1 if fails else 0)
