"""v3.228 — 디렉터 생성 작업 공통 원장(gen_jobs): 요청 원장 · 중복 생성 차단 · 멈춘 작업 환불.

작사·작곡(연주곡 포함)·이미지(커버·다듬기)·영상 디렉터에 아티스트 디렉터(v3.227) 수준의
"자동 도착 알림 · 중복 생성 차단 · 서버 재시작으로 멈춘 작업 환불 정리"를 공통으로 제공한다.

■ 전제: uvicorn **단일 워커**(Dockerfile CMD 에 --workers 없음).
  - 사용자별 asyncio.Lock 으로 [정리 → 진행 중 확인 → 원장 기록] 을 직렬화한다.
  - 이전 프로세스가 시작한 processing 작업은 절대 끝날 수 없으므로 boot_id 가 다르면
    즉시 '죽은 작업'으로 판정해 실패 + 1회 환불한다.
  - 이 전제가 깨지면(--workers 추가) env GEN_JOBS_BOOT_CHECK=0 으로 boot 판정을 끈다
    (그때는 kind 별 상한 경과로만 판정).

■ 저장소
  - 동기 kind(lyrics · cover · cover_refine · video): 신규 컬렉션 `gen_jobs`
      {_id, user_id, kind, group, request_id|null, status: processing|done|failed, boot_id,
       created_at, updated_at, completed_at, point_action, point_cost, point_ref, charged,
       refunded, error, meta{}, result{}, response{}(재생용 ≤64KB), consume_tracked:true,
       acked_at, swept_reason, late_result}
    원장은 **과금 전에** 만들고(charged=false) 차감 성공 시 charged=true 로 바꾼다.
  - 작곡(music): 기존 `generations` 문서에 boot_id · started_at · consume_tracked ·
    client_request_id · acked_at 를 가산(라우트 generate.py). 초안(point_ref=None)은
    절대 정리·차단 대상이 아니다.
  - 연주곡(inst): 기존 `inst_jobs`(곡별 active claim) 에 boot_id · consume_tracked 가산.

■ 죽은 작업 판정(is_dead): boot_id 불일치(즉시) 또는 kind 별 상한 경과(보조).
  boot_id 가 없는 레거시(배포 전) 문서는 상한 경과로만 판정한다.

■ 환불 정확성: `refunded≠true` 원자 claim AND (charged=true OR point_events 에
  spend:{action}·track_id=point_ref 존재). generations/inst_jobs 는 기존 원자 환불 함수
  (refund_generation_points / refund_instrumental_points) 를 함수 안 lazy import 로 재사용.

■ 킬스위치: env GEN_JOBS_KINDS (기본 "lyrics,music,inst,image,video", 빈 값 = 전부 끔).
  목록에서 빠진 그룹은 원장·409 게이트 없이 기존 동작으로 돌아간다. 죽은 작업 정리·환불
  sweep 은 킬스위치와 무관하게 동작한다(안전 측).

■ 로그: `[GenJobs] …` (user 는 앞 8자리, request_id 는 앞 8자리, 시크릿·원문 금지).
  best-effort 로 /srv/app/logs/gen_jobs.log 에도 남긴다(env GEN_JOBS_LOG_FILE, 빈 값=끔) —
  호스트 볼륨(-v /home/ubuntu/maidol/logs:/srv/app/logs)과 함께 쓰면 컨테이너 재생성 뒤에도
  과금·환불 추적 로그가 남는다([points] 로거 포함).

모든 공개 함수는 never-raise(실패는 경고 로그 + 안전한 기본값)이다. 단, 라우트 흐름을 막지
않기 위해 원장 기록 자체가 실패하면 job=None 으로 기존 동작(원장 없이 진행)으로 폴백한다.
"""
import asyncio
import json
import logging
import os
import re
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Union

from bson import ObjectId
from fastapi.responses import JSONResponse

from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

# ─── 상수 ──────────────────────────────────────────────────────────────────

BOOT_ID = "{}:{}:{}".format(socket.gethostname(), os.getpid(), uuid.uuid4().hex[:8])

# kind → 그룹(동시 1건 단위) · 상한(분) · point action(POINT_COSTS 키 / point_events action 접미사)
KIND_CFG = {
    "lyrics": {"group": "lyrics", "cap_min": 10, "action": "lyrics"},
    "music": {"group": "music", "cap_min": 30, "action": "compose"},
    "inst": {"group": "inst", "cap_min": 30, "action": "instrumental"},
    "cover": {"group": "image", "cap_min": 15, "action": "cover"},
    "cover_refine": {"group": "image", "cap_min": 15, "action": "cover_refine"},
    "video": {"group": "video", "cap_min": 25, "action": "share_video"},
}
SYNC_KINDS = ("lyrics", "cover", "cover_refine", "video")
ALL_KINDS = tuple(KIND_CFG.keys())
ALL_GROUPS = ("lyrics", "music", "inst", "image", "video")

# 회수(recoverable) 하한 — 배포 당일 스테이징 확정 시각(UTC). 실질 경계는 consume_tracked
# (신코드가 쓴 문서)이며, 이 하한은 AND 로 거는 추가 안전장치다.
RECOVERABLE_SINCE_V3228 = datetime(2026, 9, 24, 10, 0, 0)
RECOVERABLE_KIND_LIMIT = 10     # kind 별 done+processing 최대
RECOVERABLE_FAILED_LIMIT = 5    # failed 합계 최대
RECOVERABLE_FAILED_HOURS = 24   # failed 노출 창
RESPONSE_MAX_BYTES = 64 * 1024  # 재생용 응답 저장 상한

SWEPT_ERROR_MSG = "서버 점검으로 작업이 중단됐어요. 사용한 별은 자동으로 환불됐어요."
SWEPT_ERROR_MSG_UNCHARGED = "서버 점검으로 작업이 중단됐어요. 별은 차감되지 않았어요."

BUSY_MSG = {
    "lyrics": "이미 가사를 쓰는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
    "music": "이미 곡을 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
    "inst": "이미 Inst. 버전을 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
    "image": "이미 이미지를 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
    "video": "이미 영상을 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.",
}
FAILED_REQ_MSG = "이 요청은 이미 실패로 끝났어요. 다시 시도해 주세요."

_REQ_RE = re.compile(r"^[0-9a-f]{32}$")
_DEFAULT_KINDS_ENV = "lyrics,music,inst,image,video"
_KIND_ALIASES = {"cover": "image", "cover_refine": "image", "compose": "music",
                 "instrumental": "inst", "share_video": "video"}


def _parse_groups(raw: Optional[str]) -> frozenset:
    if raw is None:
        raw = _DEFAULT_KINDS_ENV
    out = set()
    for tok in raw.split(","):
        t = tok.strip().lower()
        if not t:
            continue
        t = _KIND_ALIASES.get(t, t)
        if t in ALL_GROUPS:
            out.add(t)
    return frozenset(out)


ENABLED_GROUPS = _parse_groups(os.getenv("GEN_JOBS_KINDS"))
BOOT_CHECK = os.getenv("GEN_JOBS_BOOT_CHECK", "1").strip() != "0"

# ─── 파일 로그(best-effort) ────────────────────────────────────────────────


def _setup_file_log() -> None:
    path = os.getenv("GEN_JOBS_LOG_FILE", "/srv/app/logs/gen_jobs.log").strip()
    if not path:
        return
    try:
        from logging.handlers import RotatingFileHandler

        d = os.path.dirname(path)
        if not d or not os.path.isdir(d) or not os.access(d, os.W_OK):
            return
        h = RotatingFileHandler(path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
        fmt = logging.Formatter("%(asctime)sZ %(levelname)s [%(name)s] %(message)s")
        fmt.converter = time.gmtime
        h.setFormatter(fmt)
        h.setLevel(logging.INFO)
        h._gen_jobs_file = True  # type: ignore[attr-defined]
        # [GenJobs] 원장 로그 + [points] 차감·환불 로그를 같은 파일에(루트 stdout 전파는 그대로 유지)
        for name in (__name__, "app.services.points_service"):
            lg = logging.getLogger(name)
            if not any(getattr(x, "_gen_jobs_file", False) for x in lg.handlers):
                lg.addHandler(h)
                if lg.level == logging.NOTSET or lg.level > logging.INFO:
                    lg.setLevel(logging.INFO)
    except Exception as e:  # noqa: BLE001 — 로그 파일 실패는 기능과 무관
        logger.warning("[GenJobs] file log disabled: %s", str(e)[:120])


_setup_file_log()
logger.info(
    "[GenJobs] module loaded boot=%s groups=%s boot_check=%s (single-worker premise)",
    BOOT_ID, ",".join(sorted(ENABLED_GROUPS)) or "(none)", BOOT_CHECK,
)

# ─── 작은 헬퍼 ─────────────────────────────────────────────────────────────


def u8(user_id) -> str:
    return str(user_id or "")[:8]


def r8(request_id) -> str:
    return str(request_id or "-")[:8]


def utcnow() -> datetime:
    """naive UTC (motor 기본 tz_aware=False 로 읽히는 값과 비교 가능)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def naive(v):
    if isinstance(v, datetime) and v.tzinfo is not None:
        return v.astimezone(timezone.utc).replace(tzinfo=None)
    return v


def iso_z(v) -> Optional[str]:
    v = naive(v)
    if not isinstance(v, datetime):
        return None
    return v.isoformat(timespec="seconds") + "Z"


def group_of(kind: str) -> Optional[str]:
    cfg = KIND_CFG.get(kind)
    return cfg["group"] if cfg else None


def enabled(kind_or_group: str) -> bool:
    g = group_of(kind_or_group) or kind_or_group
    return g in ENABLED_GROUPS


def normalize_request_id(hdr) -> Optional[str]:
    """X-Gen-Request-Id 정규화 — 소문자 32hex 만 인정, 나머지는 None(무시·새 요청 취급)."""
    if not hdr or not isinstance(hdr, str):
        return None
    v = hdr.strip().lower()
    return v if _REQ_RE.match(v) else None


def _oid(v) -> Optional[ObjectId]:
    try:
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str) and ObjectId.is_valid(v):
            return ObjectId(v)
    except Exception:  # noqa: BLE001
        pass
    return None


def _jsonable(obj, max_bytes: int = RESPONSE_MAX_BYTES):
    """Mongo 저장·재생용 정규화(datetime·ObjectId → 문자열). 상한 초과면 None."""
    try:
        s = json.dumps(obj, default=str, ensure_ascii=False)
        if len(s.encode("utf-8")) > max_bytes:
            return None
        return json.loads(s)
    except Exception:  # noqa: BLE001
        return None


# ─── 사용자별 락 ───────────────────────────────────────────────────────────

_LOCKS: dict = {}


def user_lock(user_id: str, group: str) -> asyncio.Lock:
    """사용자×그룹 접수 직렬화 락(단일 워커 전제 — character.py _user_gen_lock 관행)."""
    key = (str(user_id), group)
    lock = _LOCKS.get(key)
    if lock is None:
        if len(_LOCKS) > 5000:
            for k in [k for k, v in _LOCKS.items() if not v.locked()][:2500]:
                _LOCKS.pop(k, None)
        lock = asyncio.Lock()
        _LOCKS[key] = lock
    return lock


# ─── 인덱스 · 기동 sweep (프로세스당 1회) ────────────────────────────────────

_INDEX_READY = False
_BOOT_SWEEP_STARTED = False
_BOOT_SWEEP_TASK = None


async def ensure_indexes(mongo=None) -> None:
    global _INDEX_READY
    if _INDEX_READY:
        return
    _INDEX_READY = True
    mongo = mongo if mongo is not None else get_mongo()
    specs = [
        ("gen_jobs", [("user_id", 1), ("group", 1), ("status", 1), ("created_at", -1)],
         {"name": "user_group_status_created"}),
        ("gen_jobs", [("user_id", 1), ("request_id", 1)],
         {"name": "user_request_id_unique", "unique": True,
          "partialFilterExpression": {"request_id": {"$type": "string"}}}),
        ("generations", [("user_id", 1), ("status", 1), ("created_at", -1)],
         {"name": "user_status_created"}),
        ("generations", [("user_id", 1), ("client_request_id", 1)],
         {"name": "user_client_request_id",
          "partialFilterExpression": {"client_request_id": {"$type": "string"}}}),
        ("inst_jobs", [("user_id", 1), ("active", 1), ("created_at", -1)],
         {"name": "user_active_created"}),
    ]
    for coll, keys, kw in specs:
        try:
            name = await getattr(mongo, coll).create_index(keys, background=True, **kw)
            logger.info("[GenJobs][migration] index ensured coll=%s name=%s", coll, name)
        except Exception as e:  # noqa: BLE001 — 인덱스 실패는 기능을 막지 않음(소규모 컬렉션)
            logger.warning("[GenJobs][migration] index failed coll=%s name=%s: %s",
                           coll, kw.get("name"), str(e)[:200])


def ensure_boot_sweep() -> None:
    """프로세스당 1회 전역 sweep(gen_jobs·generations·inst_jobs) — 첫 호출 시 백그라운드 태스크."""
    global _BOOT_SWEEP_STARTED, _BOOT_SWEEP_TASK
    if _BOOT_SWEEP_STARTED:
        return
    _BOOT_SWEEP_STARTED = True
    try:
        _BOOT_SWEEP_TASK = asyncio.get_running_loop().create_task(_boot_sweep())
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] boot-sweep schedule failed: %s", str(e)[:200])


async def _boot_sweep() -> int:
    n = 0
    try:
        mongo = get_mongo()
        await ensure_indexes(mongo)
        async for d in mongo.gen_jobs.find({"status": "processing"}):
            if dead_reason(d, "gen_jobs"):
                n += int(await _sweep_gen_job(mongo, d))
        async for d in mongo.generations.find({
            "status": {"$in": ["pending", "processing"]},
            "point_ref": {"$ne": None}, "refunded": {"$ne": True},
        }):
            if dead_reason(d, "generations"):
                n += int(await _sweep_generation(mongo, d))
        async for d in mongo.inst_jobs.find({"active": True, "status": {"$in": ["pending", "processing"]}}):
            if dead_reason(d, "inst_jobs"):
                n += int(await _sweep_inst(mongo, d))
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] boot-sweep failed: %s", str(e)[:200])
    logger.info("[GenJobs] boot-sweep n=%d boot=%s", n, BOOT_ID)
    return n


async def _prepare(mongo) -> None:
    await ensure_indexes(mongo)
    ensure_boot_sweep()


# ─── 죽은 작업 판정 ────────────────────────────────────────────────────────

def _kind_of_doc(doc: dict, coll: str) -> str:
    if coll == "generations":
        return "music"
    if coll == "inst_jobs":
        return "inst"
    return doc.get("kind") or "lyrics"


def _start_time(doc: dict, coll: str):
    t = doc.get("started_at")
    if t is None and coll == "generations":
        # 레거시(/start/ 경로는 created_at 이 초안 작성 시각) — 마지막 진행 갱신 시각으로 보수 판정
        t = doc.get("updated_at")
    if t is None:
        t = doc.get("created_at")
    return naive(t)


def dead_reason(doc: dict, coll: str, now: Optional[datetime] = None) -> Optional[str]:
    """진행 중 문서가 '죽은 작업'이면 사유(dead_boot|hard_cap), 살아 있으면 None."""
    if not doc:
        return None
    bid = doc.get("boot_id")
    if BOOT_CHECK and bid and bid != BOOT_ID:
        return "dead_boot"
    kind = _kind_of_doc(doc, coll)
    cap = KIND_CFG.get(kind, {}).get("cap_min", 30)
    st = _start_time(doc, coll)
    now = now or utcnow()
    if isinstance(st, datetime) and (now - st) > timedelta(minutes=cap):
        return "hard_cap"
    return None


def is_dead(doc: dict, kind: str) -> bool:
    coll = "generations" if kind == "music" else ("inst_jobs" if kind == "inst" else "gen_jobs")
    return dead_reason(doc, coll) is not None


# ─── 환불 ─────────────────────────────────────────────────────────────────

async def _spend_event_exists(mongo, user_id: str, action: str, ref: str) -> bool:
    try:
        ev = await mongo.point_events.find_one(
            {"user_id": user_id, "action": "spend:{}".format(action), "track_id": ref},
            {"_id": 1},
        )
        return bool(ev)
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] spend-event lookup failed user=%s: %s", u8(user_id), str(e)[:120])
        return False


async def refund_once(mongo, job: dict) -> bool:
    """gen_jobs 문서의 선차감 ⭐를 정확히 1회 환불. Never raises.

    조건: point_ref 있음 AND refunded≠true 원자 claim AND (charged=true OR spend 이벤트 존재).
    """
    try:
        if not job or not job.get("point_ref"):
            return False
        user_id = job.get("user_id")
        action = job.get("point_action") or KIND_CFG.get(job.get("kind"), {}).get("action")
        ref = job["point_ref"]
        cost = int(job.get("point_cost") or 0)
        if not user_id or not action or cost <= 0:
            return False
        if not job.get("charged"):
            # 과금 직후·charged 기록 전 사망 대비 — 실제 차감 흔적이 있을 때만 환불
            fresh = await mongo.gen_jobs.find_one({"_id": job["_id"]}, {"charged": 1})
            if not (fresh and fresh.get("charged")) and not await _spend_event_exists(mongo, user_id, action, ref):
                return False
        claimed = await mongo.gen_jobs.find_one_and_update(
            {"_id": job["_id"], "refunded": {"$ne": True}},
            {"$set": {"refunded": True, "refunded_at": utcnow()}},
        )
        if not claimed:
            return False
        from .points_service import refund_points

        await refund_points(user_id, action, cost, ref)
        logger.info("[GenJobs] refund kind=%s user=%s job=%s amount=+%d",
                    job.get("kind"), u8(user_id), str(job["_id"]), cost)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[GenJobs] refund failed job=%s", str((job or {}).get("_id")))
        return False


# ─── 개별 sweep ────────────────────────────────────────────────────────────

async def _sweep_gen_job(mongo, doc: dict, reason: Optional[str] = None) -> bool:
    reason = reason or dead_reason(doc, "gen_jobs") or "dead"
    try:
        now = utcnow()
        claimed = await mongo.gen_jobs.find_one_and_update(
            {"_id": doc["_id"], "status": "processing"},
            {"$set": {"status": "failed", "error": "server_restart" if reason == "dead_boot" else "hard_cap",
                      "swept_reason": reason, "completed_at": now, "updated_at": now}},
        )
        if not claimed:
            return False
        refunded = await refund_once(mongo, claimed)
        await mongo.gen_jobs.update_one(
            {"_id": doc["_id"]},
            {"$set": {"error": SWEPT_ERROR_MSG if refunded else SWEPT_ERROR_MSG_UNCHARGED}},
        )
        logger.info("[GenJobs] swept kind=%s user=%s job=%s reason=%s refunded=%s",
                    claimed.get("kind"), u8(claimed.get("user_id")), str(doc["_id"]), reason, refunded)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep gen_job failed job=%s: %s", str(doc.get("_id")), str(e)[:200])
        return False


async def _sweep_generation(mongo, doc: dict, reason: Optional[str] = None) -> bool:
    """작곡: pending/processing + point_ref≠None + refunded≠true 만. 초안(point_ref=None) 불변."""
    reason = reason or dead_reason(doc, "generations") or "dead"
    try:
        now = utcnow()
        claimed = await mongo.generations.find_one_and_update(
            {"_id": doc["_id"], "status": {"$in": ["pending", "processing"]},
             "point_ref": {"$ne": None}, "refunded": {"$ne": True}},
            {"$set": {"status": "failed", "error_message": SWEPT_ERROR_MSG,
                      "swept_reason": reason, "updated_at": now}},
        )
        if not claimed:
            return False
        from ..routes.generate import refund_generation_points

        refunded = await refund_generation_points(mongo, str(doc["_id"]))
        sid = claimed.get("session_id")
        if sid:
            try:
                from .creation_log import append_event

                await append_event(sid, "GEN_RESPONSE", "server", payload={
                    "request_id": str(doc["_id"]),
                    "status": "failed",
                    "error": "server_restart" if reason == "dead_boot" else "hard_cap",
                    "candidates": [],
                })
            except Exception as cl_exc:  # noqa: BLE001 — best-effort(v3.200 "실패도 사실이다")
                logger.warning("[GenJobs] creation-log GEN_RESPONSE failed gen=%s: %s",
                               str(doc["_id"]), str(cl_exc)[:120])
        logger.info("[GenJobs] swept kind=music user=%s job=%s reason=%s refunded=%s",
                    u8(claimed.get("user_id")), str(doc["_id"]), reason, refunded)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep generation failed gen=%s: %s", str(doc.get("_id")), str(e)[:200])
        return False


async def _sweep_inst(mongo, doc: dict, reason: Optional[str] = None) -> bool:
    reason = reason or dead_reason(doc, "inst_jobs") or "dead"
    try:
        now = utcnow()
        claimed = await mongo.inst_jobs.find_one_and_update(
            {"_id": doc["_id"], "active": True, "status": {"$in": ["pending", "processing"]}},
            {"$set": {"status": "failed", "active": False, "error_message": SWEPT_ERROR_MSG,
                      "swept_reason": reason, "updated_at": now}},
        )
        if not claimed:
            return False
        if not claimed.get("point_ref"):
            # 차감 직후·point_ref 기록 전 사망 — 결정적 ref 로 차감 흔적 확인 후 환불 대상에 편입
            cand = "instrumental:{}:{}".format(claimed.get("track_id"), str(doc["_id"]))
            if await _spend_event_exists(mongo, claimed.get("user_id"), "instrumental", cand):
                from .points_service import POINT_COSTS

                await mongo.inst_jobs.update_one(
                    {"_id": doc["_id"], "point_ref": None},
                    {"$set": {"point_ref": cand, "point_cost": POINT_COSTS["instrumental"]}},
                )
        from .inst_service import refund_instrumental_points

        refunded = await refund_instrumental_points(mongo, str(doc["_id"]))
        logger.info("[GenJobs] swept kind=inst user=%s job=%s reason=%s refunded=%s",
                    u8(claimed.get("user_id")), str(doc["_id"]), reason, refunded)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep inst failed job=%s: %s", str(doc.get("_id")), str(e)[:200])
        return False


async def sweep_doc(kind: str, doc: Optional[dict]) -> Optional[dict]:
    """조회 대상 1건 정리. 죽었으면 정리 후 **다시 읽은 문서**, 아니면 원본을 돌려준다."""
    if not doc:
        return doc
    try:
        mongo = get_mongo()
        await _prepare(mongo)
        if kind == "music":
            if (doc.get("status") in ("pending", "processing") and doc.get("point_ref")
                    and not doc.get("refunded") and dead_reason(doc, "generations")):
                if await _sweep_generation(mongo, doc):
                    return await mongo.generations.find_one({"_id": doc["_id"]}) or doc
        elif kind == "inst":
            if (doc.get("active") and doc.get("status") in ("pending", "processing")
                    and dead_reason(doc, "inst_jobs")):
                if await _sweep_inst(mongo, doc):
                    return await mongo.inst_jobs.find_one({"_id": doc["_id"]}) or doc
        else:
            if doc.get("status") == "processing" and dead_reason(doc, "gen_jobs"):
                if await _sweep_gen_job(mongo, doc):
                    return await mongo.gen_jobs.find_one({"_id": doc["_id"]}) or doc
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep_doc failed kind=%s: %s", kind, str(e)[:200])
    return doc


async def sweep_user(user_id: str, groups=None) -> int:
    """이 사용자의 죽은 작업 정리(gen_jobs·generations·inst_jobs). groups=None 이면 전부."""
    n = 0
    try:
        mongo = get_mongo()
        await _prepare(mongo)
        gs = set(groups) if groups else set(ALL_GROUPS)
        sync_groups = [g for g in gs if g in ("lyrics", "image", "video")]
        if sync_groups:
            async for d in mongo.gen_jobs.find(
                {"user_id": user_id, "status": "processing", "group": {"$in": sync_groups}},
            ):
                if dead_reason(d, "gen_jobs"):
                    n += int(await _sweep_gen_job(mongo, d))
        if "music" in gs:
            async for d in mongo.generations.find({
                "user_id": user_id, "status": {"$in": ["pending", "processing"]},
                "point_ref": {"$ne": None}, "refunded": {"$ne": True},
            }):
                if dead_reason(d, "generations"):
                    n += int(await _sweep_generation(mongo, d))
        if "inst" in gs:
            async for d in mongo.inst_jobs.find(
                {"user_id": user_id, "active": True, "status": {"$in": ["pending", "processing"]}},
            ):
                if dead_reason(d, "inst_jobs"):
                    n += int(await _sweep_inst(mongo, d))
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep_user failed user=%s: %s", u8(user_id), str(e)[:200])
    return n


async def sweep_inst_track(track_id: str) -> int:
    """연주곡 claim 전에 이 곡의 죽은 active job 정리(영구 잠김 해소)."""
    n = 0
    try:
        mongo = get_mongo()
        await _prepare(mongo)
        async for d in mongo.inst_jobs.find({"track_id": track_id, "active": True}):
            if d.get("status") in ("pending", "processing") and dead_reason(d, "inst_jobs"):
                n += int(await _sweep_inst(mongo, d))
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] sweep_inst_track failed track=%s: %s", str(track_id)[:8], str(e)[:200])
    return n


# ─── 409 응답 ──────────────────────────────────────────────────────────────

def busy_response(kind: str, job_id, request_id=None, created_at=None, meta=None,
                  code: str = "generation_in_progress", message: Optional[str] = None) -> JSONResponse:
    group = group_of(kind) or kind
    msg = message or BUSY_MSG.get(group) or BUSY_MSG["lyrics"]
    created = naive(created_at)
    elapsed = None
    if isinstance(created, datetime):
        elapsed = max(0, int((utcnow() - created).total_seconds()))
    return JSONResponse(status_code=409, content={
        "error": msg,
        "detail": msg,
        "code": code,
        "kind": kind,
        "job_id": str(job_id) if job_id is not None else None,
        "request_id": request_id,
        "created_at": iso_z(created),
        "elapsed_sec": elapsed,
        "meta": _jsonable(meta or {}, 8 * 1024) or {},
    })


def _busy_from_job(job: dict, code: str = "generation_in_progress", message=None) -> JSONResponse:
    return busy_response(job.get("kind"), job["_id"], job.get("request_id"), job.get("created_at"),
                         job.get("meta"), code=code, message=message)


# ─── 게이트 · 원장 수명주기(동기 kind) ──────────────────────────────────────

async def _find_live_group_job(mongo, user_id: str, group: str) -> Optional[dict]:
    async for d in mongo.gen_jobs.find(
        {"user_id": user_id, "group": group, "status": "processing"},
    ).sort("created_at", -1):
        if not dead_reason(d, "gen_jobs"):
            return d
    return None


def _replay_response(job: dict) -> JSONResponse:
    body = dict(job.get("response") or job.get("result") or {})
    body["replayed"] = True
    body.setdefault("gen_job_id", str(job["_id"]))
    body.setdefault("request_id", job.get("request_id"))
    return JSONResponse(status_code=200, content=_jsonable(body, 1024 * 1024) or {"replayed": True})


async def gate_and_begin(
    user_id: str,
    kind: str,
    request_id: Optional[str],
    meta: Optional[dict] = None,
    point_ref: Union[str, Callable[[str], str], None] = None,
    point_cost: int = 0,
):
    """동기 kind 공용 게이트. 반환 (early_response|None, job|None).

    - 그룹이 킬스위치로 꺼져 있으면 (None, None) → 호출부는 기존 동작.
    - 락 안에서: sweep_user(그룹) → request_id 중복(processing 409 · done 200 재생 · failed 409
      request_already_failed) → 그룹 진행 중(살아 있는 것) 409 → 원장 insert(processing, charged=false).
    - 원장 기록 자체가 실패하면 (None, None) 으로 폴백(기존 동작 — 생성 흐름을 막지 않음).
    피로 429 는 호출 전에, 잔액 402 는 호출 후(spend)에 처리한다(순서 429 → 409 → 402).
    """
    if kind not in SYNC_KINDS or not enabled(kind):
        return None, None
    group = group_of(kind)
    try:
        mongo = get_mongo()
        await _prepare(mongo)
        async with user_lock(user_id, group):
            await sweep_user(user_id, groups=[group])
            if request_id:
                prev = await mongo.gen_jobs.find_one({"user_id": user_id, "request_id": request_id})
                if prev:
                    prev = await sweep_doc(prev.get("kind") or kind, prev)
                    st = prev.get("status")
                    if st == "processing":
                        logger.info("[GenJobs] dup-blocked kind=%s user=%s active=%s req=%s (same request)",
                                    kind, u8(user_id), str(prev["_id"]), r8(request_id))
                        return _busy_from_job(prev), None
                    if st == "done":
                        logger.info("[GenJobs] replay kind=%s user=%s job=%s req=%s",
                                    kind, u8(user_id), str(prev["_id"]), r8(request_id))
                        return _replay_response(prev), None
                    logger.info("[GenJobs] dup-blocked kind=%s user=%s job=%s req=%s (request failed)",
                                kind, u8(user_id), str(prev["_id"]), r8(request_id))
                    return _busy_from_job(prev, code="request_already_failed", message=FAILED_REQ_MSG), None
            live = await _find_live_group_job(mongo, user_id, group)
            if live:
                logger.info("[GenJobs] dup-blocked kind=%s user=%s active=%s active_kind=%s req=%s",
                            kind, u8(user_id), str(live["_id"]), live.get("kind"), r8(request_id))
                return _busy_from_job(live), None
            job_oid = ObjectId()
            ref = point_ref(str(job_oid)) if callable(point_ref) else point_ref
            now = utcnow()
            job = {
                "_id": job_oid,
                "user_id": user_id,
                "kind": kind,
                "group": group,
                "request_id": request_id,
                "status": "processing",
                "boot_id": BOOT_ID,
                "created_at": now,
                "updated_at": now,
                "completed_at": None,
                "point_action": KIND_CFG[kind]["action"],
                "point_cost": int(point_cost or 0),
                "point_ref": ref,
                "charged": False,
                "refunded": False,
                "error": None,
                "meta": _jsonable(meta or {}, 8 * 1024) or {},
                "result": None,
                "response": None,
                "consume_tracked": True,
                "acked_at": None,
            }
            if not request_id:
                job.pop("request_id")  # partial unique index 는 문자열만 — 필드 부재로 저장
            try:
                await mongo.gen_jobs.insert_one(job)
            except Exception as e:  # noqa: BLE001
                if request_id and "duplicate" in str(e).lower():
                    prev = await mongo.gen_jobs.find_one({"user_id": user_id, "request_id": request_id})
                    if prev:
                        return _busy_from_job(prev, code="request_already_failed" if prev.get("status") == "failed"
                                              else "generation_in_progress"), None
                raise
            job.setdefault("request_id", None)
            logger.info("[GenJobs] begin kind=%s user=%s job=%s req=%s",
                        kind, u8(user_id), str(job_oid), r8(request_id))
            return None, job
    except Exception as e:  # noqa: BLE001 — 원장 실패는 생성 흐름을 막지 않음(기존 동작 폴백)
        logger.warning("[GenJobs] gate failed kind=%s user=%s — fallback legacy path: %s",
                       kind, u8(user_id), str(e)[:200])
        return None, None


async def mark_charged(job: Optional[dict]) -> None:
    if not job:
        return
    job["charged"] = True
    try:
        await get_mongo().gen_jobs.update_one(
            {"_id": job["_id"]}, {"$set": {"charged": True, "charged_at": utcnow(), "updated_at": utcnow()}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] mark_charged failed job=%s: %s", str(job["_id"]), str(e)[:200])


async def discard(job: Optional[dict], reason: str = "insufficient_points") -> None:
    """차감 전 종료(402 등) — 원장 잔재를 남기지 않는다(같은 request_id 재사용 가능)."""
    if not job:
        return
    try:
        await get_mongo().gen_jobs.delete_one({"_id": job["_id"], "charged": {"$ne": True}})
        logger.info("[GenJobs] discard kind=%s user=%s job=%s reason=%s",
                    job.get("kind"), u8(job.get("user_id")), str(job["_id"]), reason)
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] discard failed job=%s: %s", str(job["_id"]), str(e)[:200])


async def finish(job: Optional[dict], result: Optional[dict], response: Optional[dict] = None) -> bool:
    """processing → done(결과·재생 응답 저장). 이미 sweep 된 경우 late_result 만 저장 + 경고."""
    if not job:
        return False
    try:
        mongo = get_mongo()
        now = utcnow()
        res = _jsonable(result or {}, RESPONSE_MAX_BYTES) or {}
        resp = _jsonable(response, RESPONSE_MAX_BYTES) if response is not None else None
        r = await mongo.gen_jobs.update_one(
            {"_id": job["_id"], "status": "processing"},
            {"$set": {"status": "done", "result": res, "response": resp,
                      "completed_at": now, "updated_at": now}},
        )
        if getattr(r, "matched_count", 0) or getattr(r, "modified_count", 0):
            logger.info("[GenJobs] done kind=%s user=%s job=%s req=%s",
                        job.get("kind"), u8(job.get("user_id")), str(job["_id"]), r8(job.get("request_id")))
            return True
        await mongo.gen_jobs.update_one(
            {"_id": job["_id"]}, {"$set": {"late_result": res, "updated_at": now}},
        )
        logger.warning("[GenJobs] late-complete kind=%s user=%s job=%s (already swept — result kept as late_result)",
                       job.get("kind"), u8(job.get("user_id")), str(job["_id"]))
        return False
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] finish failed job=%s: %s", str(job["_id"]), str(e)[:200])
        return False


async def fail(job: Optional[dict], error: str, refund: bool = True) -> bool:
    """processing → failed (+ 1회 환불). 이미 sweep 됐어도 환불 claim 은 원자적이라 중복 없음.

    반환: 이번 호출로 환불했는지.
    """
    if not job:
        return False
    refunded = False
    try:
        mongo = get_mongo()
        now = utcnow()
        await mongo.gen_jobs.update_one(
            {"_id": job["_id"], "status": "processing"},
            {"$set": {"status": "failed", "error": (error or "failed")[:300],
                      "completed_at": now, "updated_at": now}},
        )
        if refund:
            refunded = await refund_once(mongo, job)
        logger.info("[GenJobs] failed kind=%s user=%s job=%s refunded=%s",
                    job.get("kind"), u8(job.get("user_id")), str(job["_id"]), refunded)
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] fail() error job=%s: %s", str(job["_id"]), str(e)[:200])
    return refunded


# ─── 직렬화 · 회수 · 확인 ───────────────────────────────────────────────────

_MUSIC_STATUS = {"pending": "processing", "processing": "processing", "completed": "done", "failed": "failed"}
_INST_STATUS = {"pending": "processing", "processing": "processing", "completed": "done", "failed": "failed"}


def _elapsed(doc: dict, coll: str) -> Optional[int]:
    st = _start_time(doc, coll) if coll != "generations" else naive(doc.get("started_at") or doc.get("created_at"))
    if not isinstance(st, datetime):
        return None
    return max(0, int((utcnow() - st).total_seconds()))


def serialize(kind: str, doc: dict) -> dict:
    """Job = {job_id, request_id, kind, status, created_at(ISO Z), elapsed_sec, meta, result|null,
    error|null, refunded, acked}."""
    if kind == "music":
        status = _MUSIC_STATUS.get(doc.get("status"), "unknown")
        gid = str(doc["_id"])
        out = {
            "job_id": gid,
            "request_id": doc.get("client_request_id"),
            "kind": "music",
            "status": status,
            "created_at": iso_z(doc.get("started_at") or doc.get("created_at")),
            "elapsed_sec": _elapsed(doc, "generations") if status == "processing" else None,
            "meta": {"generation_id": gid, "title": doc.get("title"), "vocal": doc.get("vocal"),
                     "persona_model": doc.get("persona_model"), "progress": doc.get("progress")},
            "result": ({"generation_id": gid, "title": doc.get("title"),
                        "result_track_id": doc.get("result_track_id")} if status == "done" else None),
            "error": (doc.get("error_message") or "")[:300] if status == "failed" else None,
            "refunded": bool(doc.get("refunded")) if status == "failed" else None,
            "acked": bool(doc.get("acked_at")),
        }
        return out
    if kind == "inst":
        status = _INST_STATUS.get(doc.get("status"), "unknown")
        return {
            "job_id": str(doc["_id"]),
            "request_id": doc.get("client_request_id"),
            "kind": "inst",
            "status": status,
            "created_at": iso_z(doc.get("created_at")),
            "elapsed_sec": _elapsed(doc, "inst_jobs") if status == "processing" else None,
            "meta": {"track_id": doc.get("track_id")},
            "result": ({"result_track_id": doc.get("result_track_id"), "track_id": doc.get("track_id")}
                       if status == "done" else None),
            "error": (doc.get("error_message") or "")[:300] if status == "failed" else None,
            "refunded": bool(doc.get("refunded")) if status == "failed" else None,
            "acked": bool(doc.get("acked_at")),
        }
    status = doc.get("status") if doc.get("status") in ("processing", "done", "failed") else "unknown"
    return {
        "job_id": str(doc["_id"]),
        "request_id": doc.get("request_id"),
        "kind": doc.get("kind") or kind,
        "status": status,
        "created_at": iso_z(doc.get("created_at")),
        "elapsed_sec": _elapsed(doc, "gen_jobs") if status == "processing" else None,
        "meta": doc.get("meta") or {},
        "result": (doc.get("result") or {}) if status == "done" else None,
        "error": (doc.get("error") or "")[:300] if status == "failed" else None,
        "refunded": bool(doc.get("refunded")) if status == "failed" else None,
        "acked": bool(doc.get("acked_at")),
    }


def parse_kinds(raw: Optional[str]) -> list:
    if not raw:
        return list(ALL_KINDS)
    out = []
    for t in str(raw).split(","):
        t = t.strip().lower()
        if t in KIND_CFG and t not in out:
            out.append(t)
    return out


async def recoverable(user_id: str, kinds=None) -> dict:
    """회수 목록: 응답을 잃었을 수 있는 내 작업(done 미확인 · processing · 최근 실패 미확인).

    - consume_tracked=true(v3.228 신코드 문서) AND acked_at 없음 AND 시작 ≥ RECOVERABLE_SINCE_V3228.
    - kind 별 done+processing 최대 10건, failed(24h·과금됐거나 서버 정리) 합계 최대 5건. 최신순.
    - music done = completed · result_track_id 없음(미발매) · 미확인.
    호출 시 이 사용자의 죽은 작업은 즉시 실패+1회 환불(swept 에 건수).
    """
    kinds = list(kinds) if kinds else list(ALL_KINDS)
    mongo = get_mongo()
    await _prepare(mongo)
    swept = await sweep_user(user_id)
    fail_cut = utcnow() - timedelta(hours=RECOVERABLE_FAILED_HOURS)
    live: list = []
    failed: list = []

    def _key(item):
        return item.get("created_at") or ""

    try:
        sync_kinds = [k for k in kinds if k in SYNC_KINDS]
        if sync_kinds:
            base = {"user_id": user_id, "consume_tracked": True, "acked_at": None,
                    "created_at": {"$gte": RECOVERABLE_SINCE_V3228}}
            for k in sync_kinds:
                cur = mongo.gen_jobs.find({**base, "kind": k, "status": {"$in": ["processing", "done"]}}) \
                    .sort("created_at", -1).limit(RECOVERABLE_KIND_LIMIT)
                async for d in cur:
                    live.append(serialize(k, d))
            cur = mongo.gen_jobs.find({**base, "kind": {"$in": sync_kinds}, "status": "failed",
                                       "updated_at": {"$gte": fail_cut}}).sort("created_at", -1) \
                .limit(RECOVERABLE_FAILED_LIMIT * 3)
            async for d in cur:
                if d.get("charged") or d.get("swept_reason"):
                    failed.append(serialize(d.get("kind"), d))
        if "music" in kinds:
            base = {"user_id": user_id, "consume_tracked": True, "acked_at": None,
                    "point_ref": {"$ne": None}, "created_at": {"$gte": RECOVERABLE_SINCE_V3228}}
            cur = mongo.generations.find({**base, "status": {"$in": ["pending", "processing", "completed"]}}) \
                .sort("created_at", -1).limit(RECOVERABLE_KIND_LIMIT * 3)
            n = 0
            async for d in cur:
                if d.get("status") == "completed" and d.get("result_track_id"):
                    continue  # 발매 = 소비
                live.append(serialize("music", d))
                n += 1
                if n >= RECOVERABLE_KIND_LIMIT:
                    break
            cur = mongo.generations.find({**base, "status": "failed", "updated_at": {"$gte": fail_cut}}) \
                .sort("created_at", -1).limit(RECOVERABLE_FAILED_LIMIT)
            async for d in cur:
                failed.append(serialize("music", d))
        if "inst" in kinds:
            base = {"user_id": user_id, "consume_tracked": True, "acked_at": None,
                    "created_at": {"$gte": RECOVERABLE_SINCE_V3228}}
            cur = mongo.inst_jobs.find({**base, "status": {"$in": ["pending", "processing", "completed"]}}) \
                .sort("created_at", -1).limit(RECOVERABLE_KIND_LIMIT)
            async for d in cur:
                live.append(serialize("inst", d))
            cur = mongo.inst_jobs.find({**base, "status": "failed", "updated_at": {"$gte": fail_cut}}) \
                .sort("created_at", -1).limit(RECOVERABLE_FAILED_LIMIT)
            async for d in cur:
                if d.get("point_ref"):
                    failed.append(serialize("inst", d))
    except Exception as e:  # noqa: BLE001
        logger.warning("[GenJobs] recoverable query failed user=%s: %s", u8(user_id), str(e)[:200])

    failed.sort(key=_key, reverse=True)
    jobs = sorted(live + failed[:RECOVERABLE_FAILED_LIMIT], key=_key, reverse=True)
    logger.info("[GenJobs] recoverable user=%s n=%d processing=%d done=%d failed=%d swept=%d",
                u8(user_id), len(jobs),
                sum(1 for j in jobs if j["status"] == "processing"),
                sum(1 for j in jobs if j["status"] == "done"),
                sum(1 for j in jobs if j["status"] == "failed"), swept)
    return {"jobs": jobs, "count": len(jobs), "swept": swept}


async def get_by_request(user_id: str, request_id: Optional[str]) -> Optional[dict]:
    """본인 gen_jobs(request_id) → 없으면 generations(client_request_id). 없으면 None(404)."""
    rid = normalize_request_id(request_id)
    if not rid:
        return None
    mongo = get_mongo()
    await _prepare(mongo)
    d = await mongo.gen_jobs.find_one({"user_id": user_id, "request_id": rid})
    if d:
        d = await sweep_doc(d.get("kind") or "lyrics", d)
        return serialize(d.get("kind") or "lyrics", d)
    g = await mongo.generations.find_one({"user_id": user_id, "client_request_id": rid},
                                         sort=[("created_at", -1)])
    if g:
        g = await sweep_doc("music", g)
        return serialize("music", g)
    return None


async def ack(user_id: str, kind: str, job_id: str):
    """결과 확인(소비) 영속 표시. 반환 (status_code, body). 환불 없음."""
    not_found = (404, {"error": "작업을 찾을 수 없습니다.", "code": "job_not_found"})
    if kind not in KIND_CFG:
        return not_found
    oid = _oid(job_id)
    if oid is None:
        return not_found
    mongo = get_mongo()
    await _prepare(mongo)
    if kind == "music":
        coll, cname = mongo.generations, "generations"
    elif kind == "inst":
        coll, cname = mongo.inst_jobs, "inst_jobs"
    else:
        coll, cname = mongo.gen_jobs, "gen_jobs"
    doc = await coll.find_one({"_id": oid})
    if not doc or doc.get("user_id") != user_id:
        return not_found
    if cname == "gen_jobs" and doc.get("kind") not in SYNC_KINDS:
        return not_found
    doc = await sweep_doc(kind if cname != "gen_jobs" else (doc.get("kind") or kind), doc)
    processing = (
        (cname == "gen_jobs" and doc.get("status") == "processing")
        or (cname == "generations" and doc.get("status") in ("pending", "processing") and doc.get("point_ref"))
        or (cname == "inst_jobs" and doc.get("active") and doc.get("status") in ("pending", "processing"))
    )
    if processing:
        return 409, {"error": "아직 만드는 중이에요.", "code": "job_processing", "job_id": str(oid)}
    already = bool(doc.get("acked_at"))
    if not already:
        await coll.update_one({"_id": oid, "acked_at": None}, {"$set": {"acked_at": utcnow()}})
    logger.info("[GenJobs] ack kind=%s user=%s job=%s already=%s", kind, u8(user_id), str(oid), already)
    return 200, {"job_id": str(oid), "kind": kind, "acked": True, "already": already}
