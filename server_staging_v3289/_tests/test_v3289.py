"""v3.289 목소리 학습 — validate 콜백 자동 재시도 · ready 시 아티스트 자동 연결.
네트워크 차단 컨테이너 + 가짜 DB/Suno (운영 무접촉)."""
import asyncio, copy, sys, types
from datetime import datetime, timedelta, timezone
from bson import ObjectId

FAILS = []
def ok(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: FAILS.append(name)

import app.services.voice_clone_service as svc
import app.routes.voice_clone as vroute

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
                if op == "$nin" and dv in ov: return False
                if op == "$ne" and dv == ov: return False
        elif dv != v:
            return False
    return True
def _apply(d, upd):
    for kk, vv in upd.get("$set", {}).items(): d[kk] = vv
    for kk, vv in upd.get("$inc", {}).items(): d[kk] = d.get(kk, 0) + vv
    for kk in upd.get("$unset", {}): d.pop(kk, None)
class Coll:
    def __init__(self): self.docs = {}
    async def find_one(self, q, proj=None, **k):
        for d in self.docs.values():
            if _match(d, q): return d
        return None
    async def find_one_and_update(self, q, upd, return_document=None, **k):
        await asyncio.sleep(0)
        for d in self.docs.values():
            if _match(d, q):
                prev = copy.deepcopy(d); _apply(d, upd)
                return d if return_document else prev
        return None
    async def update_one(self, q, upd, **k):
        for d in self.docs.values():
            if _match(d, q):
                _apply(d, upd)
                class R: matched_count = 1; modified_count = 1
                return R()
        class R0: matched_count = 0; modified_count = 0
        return R0()
class DB:
    def __init__(self): self.voice_clones = Coll(); self.characters = Coll()
    def __getitem__(self, k): return getattr(self, k)
db = DB()
svc.get_mongo = lambda: db
vroute.get_mongo = lambda: db

refunds = []
async def fake_refund(clone_id, db=None):
    refunds.append(clone_id); return True
svc.refund_clone_points = fake_refund
async def fake_url(clone_id, kind): return f"https://api.example/audio/{clone_id}/{kind}/tok"
svc._issue_short_audio_url = fake_url

validate_calls = []
validate_mode = {"raise": False}
_n = [0]
async def fake_validate(body, *, clone_id=None):
    validate_calls.append((clone_id, body["voiceUrl"], body["vocalStartS"], body["vocalEndS"]))
    await asyncio.sleep(0)
    if validate_mode["raise"]: raise ValueError("validate code=500: Server exception")
    _n[0] += 1
    return {"code": 200, "data": {"taskId": f"NEW-{_n[0]}"}}
svc._call_validate = fake_validate
_real_sleep = asyncio.sleep
svc.asyncio = types.SimpleNamespace(**{k: getattr(asyncio, k) for k in dir(asyncio) if not k.startswith("__")})
async def fast_sleep(s, *a, **k): await _real_sleep(0)
svc.asyncio.sleep = fast_sleep

def clone(**kw):
    now = datetime.now(timezone.utc)
    d = {"_id": ObjectId(), "user_id": "u-test-0001", "status": "validating", "validate_task_id": "T-A",
         "source_object_name": "voice-clones/u-test-0001/x/source.mp3", "vocal_start_s": 0.0,
         "vocal_end_s": 60.0, "language": "ko", "created_at": now, "updated_at": now,
         "link_character_id": None}
    d.update(kw); db.voice_clones.docs[d["_id"]] = d; return d

FAIL_CB = {"code": 200, "msg": "", "data": {"errorCode": 400, "errorMessage": "Invalid voice input. Please check your audio and try again."}}
def fail_cb(task=None):
    p = copy.deepcopy(FAIL_CB)
    if task: p["data"]["taskId"] = task
    return p

async def main():
    # 1) 콜백 첫 실패 → 같은 파일로 1회 재요청, 실패·환불 없음
    c = clone(); cid = str(c["_id"])
    await svc.handle_validate_callback(cid, fail_cb())
    d = db.voice_clones.docs[c["_id"]]
    ok("콜백 첫 실패 → 자동 재요청 1회", len([v for v in validate_calls if v[0] == cid]) == 1)
    ok("재요청은 같은 구간(0~60)", validate_calls[-1][2:] == (0, 60))
    ok("재요청 후 status=validating·새 taskId·환불 없음",
       d["status"] == "validating" and d["validate_task_id"].startswith("NEW-") and cid not in refunds)
    ok("재시도 카운트 1·pending 해제", d.get("validate_retry_count") == 1 and d.get("validate_retry_pending") is False)
    # 2) 새 작업도 실패(taskId 일치) → failed+환불
    await svc.handle_validate_callback(cid, fail_cb(d["validate_task_id"]))
    ok("재시도 작업도 실패 → failed+환불", d["status"] == "failed" and cid in refunds)
    ok("재요청은 총 1회만", len([v for v in validate_calls if v[0] == cid]) == 1)

    # 3) 이전 작업의 늦은 실패 콜백(taskId 불일치) → 무시
    c3 = clone(validate_task_id="T-NEW", validate_retry_count=1); cid3 = str(c3["_id"])
    await svc.handle_validate_callback(cid3, fail_cb("T-OLD"))
    ok("구 작업 실패 콜백(taskId 불일치) 무시", c3["status"] == "validating" and cid3 not in refunds)

    # 4) taskId 없는 실패 콜백이 재시도 직후 도착 → 무시(새 작업 결과 대기)
    c4 = clone(validate_task_id="T-NEW", validate_retry_count=1, validate_retry_at=datetime.now(timezone.utc))
    cid4 = str(c4["_id"])
    await svc.handle_validate_callback(cid4, fail_cb())
    ok("재시도 직후 taskId 없는 실패 콜백 무시", c4["status"] == "validating" and cid4 not in refunds)

    # 5) 콜백·폴링 동시 실패 → 재요청 정확히 1회, failed 아님
    c5 = clone(); cid5 = str(c5["_id"])
    async def poll_fail():
        return await svc._retry_validate_once(cid5, "T-A", "fail", origin="poll")
    r = await asyncio.gather(svc.handle_validate_callback(cid5, fail_cb()), poll_fail())
    ok("콜백·폴링 동시 → 재요청 1회", len([v for v in validate_calls if v[0] == cid5]) == 1)
    ok("동시 경합에서도 failed 아님", c5["status"] == "validating" and cid5 not in refunds)

    # 6) 재요청 자체 실패 → failed+환불, pending 해제
    validate_mode["raise"] = True
    c6 = clone(); cid6 = str(c6["_id"])
    await svc.handle_validate_callback(cid6, fail_cb())
    validate_mode["raise"] = False
    ok("재요청 호출 실패 → failed+환불", c6["status"] == "failed" and cid6 in refunds)
    ok("재요청 실패 시 pending 해제", c6.get("validate_retry_pending") is False)

    # 7) 이미 failed/ready 인 문서에 실패 콜백 → 무시(재요청 없음)
    c7 = clone(status="awaiting_verify"); cid7 = str(c7["_id"])
    n0 = len(validate_calls)
    await svc.handle_validate_callback(cid7, fail_cb())
    ok("validating 아닌 문서의 실패 콜백 무시", c7["status"] == "awaiting_verify" and len(validate_calls) == n0)

    # 8) 성공 콜백은 종전대로 awaiting_verify
    c8 = clone(); cid8 = str(c8["_id"])
    await svc.handle_validate_callback(cid8, {"code": 200, "data": {"validateInfo": "문구"}})
    ok("성공 콜백 → awaiting_verify(회귀)", c8["status"] == "awaiting_verify" and c8["validate_info"] == "문구")

    # 9) ready 시 아티스트 자동 연결
    art = {"_id": ObjectId(), "user_id": "u-test-0001", "character_id": "a" * 32, "voice_preset": "female:소프트"}
    db.characters.docs[art["_id"]] = art
    c9 = clone(status="generating", generate_task_id="G-1", link_character_id="a" * 32); cid9 = str(c9["_id"])
    await svc.handle_generate_callback(cid9, {"code": 200, "data": {"voiceId": "V-1"}})
    ok("ready → 시작한 아티스트에 자동 연결", art.get("persona_id") == cid9 and art.get("persona_model") == "voice_persona")
    ok("자동 연결 시 간편 목소리 해제(상호 배타)", "voice_preset" not in art)
    ok("연결 대상 1회 소진·기록", c9.get("link_character_id") is None and c9.get("linked_character_id") == "a" * 32)
    art["persona_id"] = "other"
    await svc._auto_link_artist_on_ready(cid9)
    ok("두 번째 호출은 재연결 안 함", art["persona_id"] == "other")
    # 10) 연결 대상 없는 클론 → 아무 아티스트도 안 바뀜
    art2 = {"_id": ObjectId(), "user_id": "u-test-0001", "character_id": "b" * 32}
    db.characters.docs[art2["_id"]] = art2
    c10 = clone(status="generating", generate_task_id="G-2"); cid10 = str(c10["_id"])
    await svc.handle_generate_callback(cid10, {"code": 200, "data": {"voiceId": "V-2"}})
    ok("link 없는 클론 ready → 연결 없음", c10["status"] == "ready" and "persona_id" not in art2)
    # 11) 타인 아티스트 cid → 라우트에서 차단
    db.characters.docs[ObjectId()] = {"user_id": "u-other", "character_id": "c" * 32}
    ok("본인 아티스트 cid 허용", await vroute._resolve_link_artist("u-test-0001", "B" * 32) == "b" * 32)
    ok("타인 아티스트 cid 무시", await vroute._resolve_link_artist("u-test-0001", "c" * 32) is None)
    ok("미전달 → None", await vroute._resolve_link_artist("u-test-0001", None) is None)
    # 12) 폴링 경로 ready 도 자동 연결
    art3 = {"_id": ObjectId(), "user_id": "u-test-0001", "character_id": "d" * 32}
    db.characters.docs[art3["_id"]] = art3
    c12 = clone(status="generating", generate_task_id="G-3", link_character_id="d" * 32); cid12 = str(c12["_id"])
    async def fake_record(task): return {"data": {"status": "success", "voiceId": "V-3"}}
    svc.poll_voice_record = fake_record
    await svc._poll_generate_voice_inner(cid12)
    ok("폴링 경로 ready → 자동 연결", art3.get("persona_id") == cid12)

asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
