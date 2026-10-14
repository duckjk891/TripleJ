"""
Director Fatigue API (StarEcon v158 → v220 전 디렉터 일반화).

- GET  /api/fatigue/status : 오늘 완성 수 / 쿨다운 / 스킵 수단 잔량 조회
    ?director=composer|lyricist|image|artist (미지정=composer — v3.94 하위호환)
    ?all=1 → 4 디렉터 일괄 {"directors": {...}, "skip_wait_count": N}
- POST /api/fatigue/skip   : 쿨다운 30분 스킵 (points=⭐디렉터별 차등 | ad=광고권 1장)
    body {method, director} (director 미지정=composer)
- POST /api/fatigue/skip-bulk : v3.236 ⭐ 일괄 단축 (30분 × units 칸, request_id 멱등)
    body {director, units, request_id(32hex), expected_unit_cost?, expected_total?}
    서버가 남은 시간 필요 칸으로 상한(clamp)·단가 권위. 기존 /skip 은 무변경.

⭐ 스킵 비용은 디렉터별 차등 (fatigue_service.SKIP_POINT_COSTS — 생성비 1/3
반올림 규칙). FE 는 status 의 skip_point_cost 실값을 표기한다.

광고권(`skip_wait_count`)은 AdMob SSV 콜백(rewards.py)이 적립한
`reward_balances` 잔량을 여기서 원자 차감으로 소비한다 (오픈전 체크리스트 B).
디렉터 무관 공용 1장 소비 (v220 — 티켓은 디렉터 구분 없음).
"""

import logging
import math
import re
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from ..auth import get_current_user
from ..database.mongodb import get_mongo
from ..services import fatigue_service
from ..services.points_service import get_balance, refund_points, spend_points

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fatigue", tags=["Fatigue"])

_INVALID_DIRECTOR_RESPONSE = {
    "error": "director 는 composer|lyricist|image|artist 중 하나여야 합니다.",
}


async def fatigue_gate_response(user_id: str, director: str = "composer", db=None):
    """v220 — 공용 디렉터 피로 게이트. 활성 쿨다운이면 429 응답, 아니면 None.

    각 생성 라우트(generate/upload/character)가 ⭐/슬롯 차감 **전** 호출한다.
    응답: {"error":"director_fatigue","director":...} + Retry-After 헤더(남은 초).
    게이트 순서 관행: 스트라이크 403 → 피로 429 → 잔액 402.
    """
    director = fatigue_service.normalize_director(director) or fatigue_service.DEFAULT_DIRECTOR
    remaining = await fatigue_service.check_gate(user_id, db=db, director=director)
    if remaining <= 0:
        return None
    until = datetime.now(timezone.utc) + timedelta(seconds=remaining)
    logger.info(
        "[fatigue:%s] gated user=%s remaining=%ds", director, (user_id or "?")[:8], remaining
    )
    return JSONResponse(
        status_code=429,
        content={
            "error": "director_fatigue",
            "director": director,
            "message": "디렉터가 휴식 중입니다. 쿨다운이 끝난 뒤 다시 시도하거나 스킵을 이용해주세요.",
            "cooldown_remaining_sec": remaining,
            "cooldown_until": until.isoformat(),
        },
        headers={"Retry-After": str(remaining)},
    )


class SkipRequest(BaseModel):
    method: Optional[str] = None    # "points" | "ad"
    director: Optional[str] = None  # v220 — 미지정=composer


async def _skip_wait_count(mongo, user_id: str) -> int:
    """AdMob SSV 적립 광고권 잔량 (rewards.py /balance 와 동일 소스)."""
    doc = await mongo.reward_balances.find_one({"user_id": user_id}, {"skip_wait_count": 1})
    return int((doc or {}).get("skip_wait_count", 0))


async def _status_payload(user_id: str, director: str) -> dict:
    mongo = get_mongo()
    status = await fatigue_service.get_status(user_id, director=director)
    status["skip_wait_count"] = await _skip_wait_count(mongo, user_id)
    return status


@router.get("/status")
async def fatigue_status(
    director: Optional[str] = None,
    all: Optional[int] = None,
    current_user=Depends(get_current_user),
):
    """오늘 완성 수 / 쿨다운 잔여 / 스킵 비용·광고권 잔량 / 사다리 사양.

    director 미지정=composer (기존 shape 그대로 + director 키).
    all=1 이면 4 디렉터 일괄 (doc 1회 로드 — Map 휴식 티켓용).
    """
    user_id = str(current_user.get("id") or current_user.get("user_id"))
    try:
        if all:
            mongo = get_mongo()
            statuses = await fatigue_service.get_status_all(user_id)
            tickets = await _skip_wait_count(mongo, user_id)
            for st in statuses.values():
                st["skip_wait_count"] = tickets
            active = [d for d, st in statuses.items() if st["cooldown_active"]]
            logger.info(
                "[fatigue] status(all) user=%s active=%s tickets=%d",
                user_id[:8], ",".join(active) or "(none)", tickets,
            )
            return {"directors": statuses, "skip_wait_count": tickets}

        norm = fatigue_service.normalize_director(director)
        if norm is None:
            return JSONResponse(status_code=400, content=dict(_INVALID_DIRECTOR_RESPONSE))
        payload = await _status_payload(user_id, norm)
        logger.info(
            "[fatigue:%s] status user=%s completed=%d remaining=%ds tickets=%d",
            norm, user_id[:8], payload["today_completed"],
            payload["cooldown_remaining_sec"], payload["skip_wait_count"],
        )
        return payload
    except Exception:
        logger.exception("[fatigue] status failed user=%s", user_id[:8])
        return JSONResponse(status_code=500, content={"error": "피로 상태 조회에 실패했습니다."})


@router.post("/skip")
async def fatigue_skip(body: SkipRequest, current_user=Depends(get_current_user)):
    """해당 디렉터의 활성 쿨다운을 30분 단축.

    method: "points"(⭐디렉터별 차등, 반복 가능) | "ad"(광고권 1장).
    director 미지정=composer.
    - 활성 쿨다운 없음 → 409 (무과금)
    - points 잔액 부족 → 402 {"error":"포인트가 부족합니다 (필요: N)"}
    - 광고권 없음 → 402 {"error":"no_skip_tickets"}
    """
    user_id = str(current_user.get("id") or current_user.get("user_id"))
    method = (body.method or "").strip().lower()
    director = fatigue_service.normalize_director(body.director)
    if director is None:
        return JSONResponse(status_code=400, content=dict(_INVALID_DIRECTOR_RESPONSE))
    logger.info(
        "[fatigue:%s] skip request user=%s method=%s", director, user_id[:8], method or "(none)"
    )

    if method not in ("points", "ad"):
        return JSONResponse(
            status_code=400,
            content={"error": "method 는 'points' 또는 'ad' 여야 합니다."},
        )

    mongo = get_mongo()

    # 활성 쿨다운 사전 확인 — 없으면 무과금 409
    remaining = await fatigue_service.check_gate(user_id, director=director)
    if remaining <= 0:
        logger.info("[fatigue:%s] skip denied (no active cooldown) user=%s", director, user_id[:8])
        return JSONResponse(status_code=409, content={"error": "진행 중인 쿨다운이 없습니다."})

    if method == "points":
        # v220 — 디렉터별 차등 비용 (fatigue_service.SKIP_POINT_COSTS)
        cost = fatigue_service.skip_point_cost(director)
        point_ref = uuid_lib.uuid4().hex
        if not await spend_points(user_id, "fatigue_skip", cost, point_ref):
            logger.info(
                "[fatigue:%s] skip denied (insufficient points, need=%d) user=%s",
                director, cost, user_id[:8],
            )
            return JSONResponse(
                status_code=402,
                content={"error": "포인트가 부족합니다 (필요: {})".format(cost)},
            )
        reduced = await fatigue_service.reduce_cooldown(user_id, director=director)
        if reduced is None:
            # 결제와 단축 사이에 쿨다운 만료/해제 — 환불 후 현재 상태 반환
            logger.info(
                "[fatigue:%s] skip refund (cooldown gone) user=%s ref=%s",
                director, user_id[:8], point_ref,
            )
            await refund_points(user_id, "fatigue_skip", cost, point_ref)
        else:
            logger.info(
                "[fatigue:%s] skip ok (points -%d) user=%s -30min", director, cost, user_id[:8]
            )
    else:  # ad
        claim = await mongo.reward_balances.update_one(
            {"user_id": user_id, "skip_wait_count": {"$gte": 1}},
            {"$inc": {"skip_wait_count": -1}},
        )
        if claim.modified_count == 0:
            logger.info("[fatigue:%s] skip denied (no tickets) user=%s", director, user_id[:8])
            return JSONResponse(status_code=402, content={"error": "no_skip_tickets"})
        reduced = await fatigue_service.reduce_cooldown(user_id, director=director)
        if reduced is None:
            # 쿨다운이 이미 사라짐 — 광고권 원복
            logger.info(
                "[fatigue:%s] skip ticket restore (cooldown gone) user=%s", director, user_id[:8]
            )
            await mongo.reward_balances.update_one(
                {"user_id": user_id}, {"$inc": {"skip_wait_count": 1}}
            )
        else:
            logger.info("[fatigue:%s] skip ok (ad ticket) user=%s -30min", director, user_id[:8])

    payload = await _status_payload(user_id, director)
    payload["skipped_minutes"] = fatigue_service.SKIP_MINUTES if reduced is not None else 0
    return payload



# ─── v3.236 ⭐ 일괄 단축 (POST /api/fatigue/skip-bulk) ─────────────────────────
# 흐름: 검증(400) → 요청 문서 선점(user_id+request_id 유니크 — 멱등) → 활성 쿨다운 확인(409)
#   → 칸 수 clamp(필요 칸·24) → 가격 확인(409 cost_changed) → spend_points 1회(402)
#   → reduce_cooldown_by 1회(소멸 시 전액 환불 409) → 실제 쓰인 칸 계산·남는 칸 환불 → 200.
# 차감 전 실패(400·402·409 no_active_cooldown·cost_changed)는 요청 문서를 지워 같은 request_id 로
# 다시 시도할 수 있게 한다(과금 0 — 이중 차감 위험 없음). 차감 이후 결과(200·환불 409·500)는 저장해
# 같은 request_id 재요청 시 그대로 재생(replayed:true)한다.

_BULK_REQ_RE = re.compile(r"^[0-9a-f]{32}$")
_BULK_COLL = "fatigue_skip_requests"
_BULK_TTL_SEC = 7 * 24 * 3600
_BULK_STALE_SEC = 120  # 선점(claimed)만 하고 멈춘 요청 문서를 넘겨받는 기준 — 차감 시작 전 단계만
_bulk_indexes_ready = False

_NO_COOLDOWN_MSG = "진행 중인 쿨다운이 없습니다."


def _r8(rid) -> str:
    return str(rid or "-")[:8]


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _bulk_error(status_code: int, code: str, message: str, **extra) -> JSONResponse:
    content = {"error": message, "code": code}
    content.update(extra)
    return JSONResponse(status_code=status_code, content=content)


async def _ensure_bulk_indexes(mongo) -> None:
    global _bulk_indexes_ready
    if _bulk_indexes_ready:
        return
    coll = mongo[_BULK_COLL]
    await coll.create_index(
        [("user_id", 1), ("request_id", 1)], unique=True, name="user_request_unique"
    )
    await coll.create_index("created_at", expireAfterSeconds=_BULK_TTL_SEC, name="created_at_ttl")
    _bulk_indexes_ready = True


async def _safe_status(user_id: str, director: str) -> Optional[dict]:
    try:
        return await _status_payload(user_id, director)
    except Exception:  # noqa: BLE001 — 상태 동봉은 best-effort
        logger.exception("[fatigue:%s] bulk status failed user=%s", director, user_id[:8])
        return None


async def _safe_balance(user_id: str) -> Optional[int]:
    try:
        return await get_balance(user_id)
    except Exception:  # noqa: BLE001
        logger.exception("[fatigue] bulk balance failed user=%s", user_id[:8])
        return None


async def _bulk_release(coll, doc_id, director: str, user_id: str, rid: str, reason: str) -> None:
    """차감 전 종료 — 요청 문서 삭제(같은 request_id 재시도 허용). 실패해도 흐름 무영향."""
    try:
        await coll.delete_one({"_id": doc_id, "charged": {"$ne": True}})
    except Exception:  # noqa: BLE001
        logger.exception(
            "[fatigue:%s] bulk release failed user=%s rid=%s reason=%s",
            director, user_id[:8], _r8(rid), reason,
        )


async def _bulk_store(coll, doc_id, state: str, http_status: int, body: dict,
                      director: str, user_id: str, rid: str) -> None:
    """차감 이후 결과 저장(재생용). 실패해도 응답은 그대로 — 경고만."""
    try:
        await coll.update_one(
            {"_id": doc_id},
            {"$set": {
                "state": state,
                "http_status": http_status,
                "response": body,
                "finished_at": datetime.now(timezone.utc),
            }},
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "[fatigue:%s] bulk store failed user=%s rid=%s state=%s",
            director, user_id[:8], _r8(rid), state,
        )


async def _bulk_replay(prev: dict, user_id: str, director: str, rid: str) -> JSONResponse:
    body = dict(prev.get("response") or {})
    status_code = int(prev.get("http_status") or 200)
    body["replayed"] = True
    body["request_id"] = rid
    if status_code == 200:
        # 결과 필드(units_applied·points_spent …)는 원래 값, 상태·잔액은 지금 값으로 갱신
        fresh = await _safe_status(user_id, director)
        if fresh:
            body.update(fresh)
        bal = await _safe_balance(user_id)
        if bal is not None:
            body["balance"] = bal
    logger.info(
        "[fatigue:%s] bulk replay user=%s rid=%s state=%s http=%d",
        director, user_id[:8], _r8(rid), prev.get("state"), status_code,
    )
    return JSONResponse(status_code=status_code, content=body)


@router.post("/skip-bulk")
async def fatigue_skip_bulk(request: Request, current_user=Depends(get_current_user)):
    """v3.236 — ⭐로 활성 쿨다운을 30분 × units 칸 한 번에 단축 (⭐ 전용, 광고권 제외).

    body: {"director": str(필수), "units": int 1..24, "request_id": 32hex(필수),
           "expected_unit_cost"?: int, "expected_total"?: int}
    - 서버 clamp: 적용 칸 = min(units, ceil(잔여초/1800), 24), 총 ⭐ = 칸 × 디렉터 단가
    - expected_unit_cost 와 서버 단가가 다르거나, 총 ⭐ 가 expected_total 보다 크면 409 cost_changed (무과금)
    - 활성 쿨다운 없음 409 no_active_cooldown (무과금) · 잔액 부족 402 insufficient_points (무과금)
    - 같은 request_id 재요청 = 저장된 결과 재생(replayed:true, 추가 차감 0) · 처리 중이면 409 skip_in_progress
    """
    user_id = str(current_user.get("id") or current_user.get("user_id"))

    # ── 1. 입력 검증 (400, 무과금) ──
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, dict):
        return _bulk_error(400, "invalid_body", "요청 형식이 올바르지 않습니다.")
    raw_director = body.get("director")
    director = (
        fatigue_service.normalize_director(raw_director)
        if isinstance(raw_director, str) and raw_director.strip() else None
    )
    if director is None:
        return _bulk_error(400, "invalid_director", _INVALID_DIRECTOR_RESPONSE["error"])
    units = body.get("units")
    if not _is_int(units) or not (1 <= units <= fatigue_service.MAX_BULK_UNITS):
        return _bulk_error(
            400, "invalid_units",
            "units 는 1~{} 사이 정수여야 합니다.".format(fatigue_service.MAX_BULK_UNITS),
        )
    raw_rid = body.get("request_id")
    rid = raw_rid.strip().lower() if isinstance(raw_rid, str) else ""
    if not _BULK_REQ_RE.match(rid):
        return _bulk_error(400, "invalid_request_id", "request_id 는 32자리 16진수여야 합니다.")
    expected_total = body.get("expected_total")
    expected_unit_cost = body.get("expected_unit_cost")
    for v in (expected_total, expected_unit_cost):
        if v is not None and (not _is_int(v) or v < 0):
            return _bulk_error(
                400, "invalid_expected", "expected_total·expected_unit_cost 는 0 이상 정수여야 합니다."
            )
    logger.info(
        "[fatigue:%s] bulk request user=%s rid=%s units=%d expected_unit=%s expected_total=%s",
        director, user_id[:8], _r8(rid), units, expected_unit_cost, expected_total,
    )

    mongo = get_mongo()
    coll = mongo[_BULK_COLL]
    try:
        await _ensure_bulk_indexes(mongo)
    except Exception:  # noqa: BLE001 — 멱등 보장 불가 → 과금 전에 거절
        logger.exception("[fatigue:%s] bulk index failed user=%s rid=%s", director, user_id[:8], _r8(rid))
        return _bulk_error(503, "temporarily_unavailable", "잠시 후 다시 시도해 주세요.")

    # ── 2. 요청 문서 선점 (멱등) ──
    doc_id = None
    for _attempt in range(2):
        now = datetime.now(timezone.utc)
        try:
            ins = await coll.insert_one({
                "user_id": user_id,
                "request_id": rid,
                "director": director,
                "units_req": units,
                "state": "processing",
                "phase": "claimed",
                "charged": False,
                "created_at": now,
            })
            doc_id = ins.inserted_id
            break
        except DuplicateKeyError:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("[fatigue:%s] bulk claim failed user=%s rid=%s", director, user_id[:8], _r8(rid))
            return _bulk_error(503, "temporarily_unavailable", "잠시 후 다시 시도해 주세요.")
        try:
            prev = await coll.find_one({"user_id": user_id, "request_id": rid})
        except Exception:  # noqa: BLE001
            logger.exception("[fatigue:%s] bulk lookup failed user=%s rid=%s", director, user_id[:8], _r8(rid))
            return _bulk_error(503, "temporarily_unavailable", "잠시 후 다시 시도해 주세요.")
        if prev is None:
            continue  # 방금 해제됨 — 한 번 더 선점 시도
        if prev.get("director") != director or prev.get("units_req") != units:
            logger.info(
                "[fatigue:%s] bulk denied (request_id conflict) user=%s rid=%s prev=%s/%s",
                director, user_id[:8], _r8(rid), prev.get("director"), prev.get("units_req"),
            )
            return _bulk_error(
                409, "request_id_conflict", "같은 요청 번호로 다른 내용이 이미 처리됐어요. 다시 시도해 주세요.",
                request_id=rid,
            )
        if prev.get("state") in ("done", "failed"):
            return await _bulk_replay(prev, user_id, director, rid)
        # processing — 차감 시작 전(claimed)인데 오래 멈춘 문서만 넘겨받는다
        created = prev.get("created_at")
        if isinstance(created, datetime) and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        stale = isinstance(created, datetime) and (now - created).total_seconds() > _BULK_STALE_SEC
        if stale and prev.get("phase") == "claimed" and not prev.get("charged"):
            try:
                res = await coll.delete_one({
                    "_id": prev["_id"], "state": "processing", "phase": "claimed",
                    "charged": {"$ne": True},
                })
                if res.deleted_count == 1:
                    logger.warning(
                        "[fatigue:%s] bulk stale takeover user=%s rid=%s", director, user_id[:8], _r8(rid)
                    )
                    continue
            except Exception:  # noqa: BLE001
                logger.exception("[fatigue:%s] bulk takeover failed user=%s rid=%s",
                                 director, user_id[:8], _r8(rid))
        if stale:
            logger.warning(
                "[fatigue:%s] bulk stale processing user=%s rid=%s phase=%s charged=%s",
                director, user_id[:8], _r8(rid), prev.get("phase"), prev.get("charged"),
            )
        else:
            logger.info("[fatigue:%s] bulk denied (in progress) user=%s rid=%s",
                        director, user_id[:8], _r8(rid))
        return _bulk_error(
            409, "skip_in_progress", "이전 요청을 처리하고 있어요. 잠시 후 다시 확인해 주세요.",
            request_id=rid,
        )
    if doc_id is None:
        return _bulk_error(
            409, "skip_in_progress", "이전 요청을 처리하고 있어요. 잠시 후 다시 확인해 주세요.",
            request_id=rid,
        )

    # ── 3. 처리 ──
    cost = fatigue_service.skip_point_cost(director)
    total = 0
    charged = False
    reduced = None
    point_ref = "fsb_{}".format(rid)
    try:
        remaining = await fatigue_service.check_gate(user_id, director=director)
        if remaining <= 0:
            await _bulk_release(coll, doc_id, director, user_id, rid, "no_active_cooldown")
            logger.info("[fatigue:%s] bulk denied (no active cooldown) user=%s rid=%s",
                        director, user_id[:8], _r8(rid))
            return _bulk_error(409, "no_active_cooldown", _NO_COOLDOWN_MSG,
                               status=await _safe_status(user_id, director), request_id=rid)

        needed = fatigue_service.skip_units_needed(remaining)
        units_eff = max(1, min(units, needed, fatigue_service.MAX_BULK_UNITS))
        total = units_eff * cost
        if units_eff != units:
            logger.info(
                "[fatigue:%s] bulk clamp user=%s rid=%s units=%d->%d remaining=%ds",
                director, user_id[:8], _r8(rid), units, units_eff, remaining,
            )
        if (expected_unit_cost is not None and expected_unit_cost != cost) or (
            expected_total is not None and total > expected_total
        ):
            await _bulk_release(coll, doc_id, director, user_id, rid, "cost_changed")
            logger.info(
                "[fatigue:%s] bulk denied (cost changed) user=%s rid=%s unit=%d total=%d "
                "expected_unit=%s expected_total=%s",
                director, user_id[:8], _r8(rid), cost, total, expected_unit_cost, expected_total,
            )
            return _bulk_error(
                409, "cost_changed", "단축 가격이 바뀌었어요. 다시 확인해 주세요.",
                unit_cost=cost, units_applicable=units_eff, total=total,
                status=await _safe_status(user_id, director), request_id=rid,
            )

        # 차감 시작 표식 — 이후 멈춘 문서는 넘겨받지 않는다(이중 차감 방지)
        await coll.update_one({"_id": doc_id}, {"$set": {"phase": "charging", "points_total": total}})
        if not await spend_points(user_id, "fatigue_skip", total, point_ref):
            await _bulk_release(coll, doc_id, director, user_id, rid, "insufficient_points")
            balance = await _safe_balance(user_id)
            logger.info(
                "[fatigue:%s] bulk denied (insufficient points, need=%d balance=%s) user=%s rid=%s",
                director, total, balance, user_id[:8], _r8(rid),
            )
            return _bulk_error(
                402, "insufficient_points", "포인트가 부족합니다 (필요: {})".format(total),
                need=total, balance=balance, unit_cost=cost, units_applicable=units_eff,
                status=await _safe_status(user_id, director), request_id=rid,
            )
        charged = True
        try:
            await coll.update_one({"_id": doc_id}, {"$set": {"charged": True, "phase": "charged"}})
        except Exception:  # noqa: BLE001 — 표식 실패는 흐름 무영향(phase=charging 이라 takeover 없음)
            logger.exception("[fatigue:%s] bulk mark charged failed user=%s rid=%s",
                             director, user_id[:8], _r8(rid))

        reduced = await fatigue_service.reduce_cooldown_by(
            user_id, units_eff * fatigue_service.SKIP_MINUTES, director=director
        )
        if reduced is None:
            # 차감과 단축 사이에 휴식이 끝남 — 전액 환불
            await refund_points(user_id, "fatigue_skip", total, point_ref)
            logger.info(
                "[fatigue:%s] bulk refund (cooldown gone) user=%s rid=%s amount=%d",
                director, user_id[:8], _r8(rid), total,
            )
            body_out = {
                "error": _NO_COOLDOWN_MSG, "code": "no_active_cooldown",
                "refunded": total, "status": await _safe_status(user_id, director),
                "request_id": rid, "replayed": False,
            }
            await _bulk_store(coll, doc_id, "failed", 409, body_out, director, user_id, rid)
            return JSONResponse(status_code=409, content=body_out)
    except Exception:  # noqa: BLE001 — 예외 격리: 차감했는데 단축 확정 전이면 환불
        logger.exception("[fatigue:%s] bulk failed user=%s rid=%s charged=%s",
                         director, user_id[:8], _r8(rid), charged)
        if charged and reduced is None:
            await refund_points(user_id, "fatigue_skip", total, point_ref)
            logger.info("[fatigue:%s] bulk refund (error) user=%s rid=%s amount=%d",
                        director, user_id[:8], _r8(rid), total)
            body_out = {
                "error": "휴식 단축에 실패했어요. 사용한 ⭐은 돌려드렸어요.", "code": "skip_failed",
                "refunded": total, "request_id": rid, "replayed": False,
            }
            await _bulk_store(coll, doc_id, "failed", 500, body_out, director, user_id, rid)
            return JSONResponse(status_code=500, content=body_out)
        if not charged:
            await _bulk_release(coll, doc_id, director, user_id, rid, "error")
            return _bulk_error(500, "skip_failed", "휴식 단축에 실패했어요. 다시 시도해 주세요.", request_id=rid)
        raise  # 도달 불가(단축 확정 이후 단계는 아래에서 개별 격리)

    # ── 4. 단축 확정 이후 — 각 단계 개별 격리(여기서는 환불·실패 응답 없음) ──
    before_until, after_until = reduced
    try:
        cut_sec = max(0.0, (before_until - after_until).total_seconds()) if before_until else 0.0
        used = int(math.ceil(cut_sec / float(fatigue_service.SKIP_MINUTES * 60) - 1e-9))
    except Exception:  # noqa: BLE001
        used = units_eff
    used = max(1, min(units_eff, used))
    refund_amt = (units_eff - used) * cost
    if refund_amt > 0:
        await refund_points(user_id, "fatigue_skip", refund_amt, point_ref)
        logger.info(
            "[fatigue:%s] bulk refund (race — cooldown shorter) user=%s rid=%s units=%d->%d amount=%d",
            director, user_id[:8], _r8(rid), units_eff, used, refund_amt,
        )
    payload = await _safe_status(user_id, director)
    if payload is None:
        now = datetime.now(timezone.utc)
        rem = max(0, int((after_until - now).total_seconds())) if after_until else 0
        payload = {
            "director": director,
            "cooldown_active": rem > 0,
            "cooldown_until": after_until.isoformat() if rem > 0 else None,
            "cooldown_remaining_sec": rem,
            "skip_point_cost": cost,
            "skip_minutes": fatigue_service.SKIP_MINUTES,
            "skip_units_needed": fatigue_service.skip_units_needed(rem),
            "skip_total_cost": fatigue_service.skip_units_needed(rem) * cost,
            "skip_max_units": fatigue_service.MAX_BULK_UNITS,
        }
    payload.update({
        "units_requested": units,
        "units_applied": used,
        "unit_cost": cost,
        "points_spent": used * cost,
        "points_refunded": refund_amt,
        "skipped_minutes": used * fatigue_service.SKIP_MINUTES,
        "balance": await _safe_balance(user_id),
        "request_id": rid,
        "replayed": False,
    })
    await _bulk_store(coll, doc_id, "done", 200, payload, director, user_id, rid)
    logger.info(
        "[fatigue:%s] bulk ok user=%s rid=%s units=%d->%d total=%d spent=%d remaining=%ds",
        director, user_id[:8], _r8(rid), units, used, total, used * cost,
        payload.get("cooldown_remaining_sec", -1),
    )
    return payload
