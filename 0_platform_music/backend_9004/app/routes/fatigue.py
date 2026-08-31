"""
Director Fatigue API (StarEcon v158 → v220 전 디렉터 일반화).

- GET  /api/fatigue/status : 오늘 완성 수 / 쿨다운 / 스킵 수단 잔량 조회
    ?director=composer|lyricist|image|artist (미지정=composer — v3.94 하위호환)
    ?all=1 → 4 디렉터 일괄 {"directors": {...}, "skip_wait_count": N}
- POST /api/fatigue/skip   : 쿨다운 30분 스킵 (points=⭐디렉터별 차등 | ad=광고권 1장)
    body {method, director} (director 미지정=composer)

⭐ 스킵 비용은 디렉터별 차등 (fatigue_service.SKIP_POINT_COSTS — 생성비 1/3
반올림 규칙). FE 는 status 의 skip_point_cost 실값을 표기한다.

광고권(`skip_wait_count`)은 AdMob SSV 콜백(rewards.py)이 적립한
`reward_balances` 잔량을 여기서 원자 차감으로 소비한다 (오픈전 체크리스트 B).
디렉터 무관 공용 1장 소비 (v220 — 티켓은 디렉터 구분 없음).
"""

import logging
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.mongodb import get_mongo
from ..services import fatigue_service
from ..services.points_service import refund_points, spend_points

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
