"""
Director Fatigue API (StarEcon v158).

- GET  /api/fatigue/status : 오늘 완성 곡수 / 쿨다운 / 스킵 수단 잔량 조회
- POST /api/fatigue/skip   : 쿨다운 30분 스킵 (points=⭐5 | ad=광고권 1장)

광고권(`skip_wait_count`)은 AdMob SSV 콜백(rewards.py)이 적립한
`reward_balances` 잔량을 여기서 원자 차감으로 소비한다 (오픈전 체크리스트 B).
"""

import logging
import uuid as uuid_lib
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


class SkipRequest(BaseModel):
    method: Optional[str] = None  # "points" | "ad"


async def _skip_wait_count(mongo, user_id: str) -> int:
    """AdMob SSV 적립 광고권 잔량 (rewards.py /balance 와 동일 소스)."""
    doc = await mongo.reward_balances.find_one({"user_id": user_id}, {"skip_wait_count": 1})
    return int((doc or {}).get("skip_wait_count", 0))


async def _status_payload(user_id: str) -> dict:
    mongo = get_mongo()
    status = await fatigue_service.get_status(user_id)
    status["skip_wait_count"] = await _skip_wait_count(mongo, user_id)
    return status


@router.get("/status")
async def fatigue_status(current_user=Depends(get_current_user)):
    """오늘 완성 곡수 / 쿨다운 잔여 / 스킵 비용·광고권 잔량 / 사다리 사양."""
    user_id = str(current_user.get("id") or current_user.get("user_id"))
    try:
        payload = await _status_payload(user_id)
        logger.info(
            "[fatigue] status user=%s completed=%d remaining=%ds tickets=%d",
            user_id[:8], payload["today_completed"],
            payload["cooldown_remaining_sec"], payload["skip_wait_count"],
        )
        return payload
    except Exception:
        logger.exception("[fatigue] status failed user=%s", user_id[:8])
        return JSONResponse(status_code=500, content={"error": "피로 상태 조회에 실패했습니다."})


@router.post("/skip")
async def fatigue_skip(body: SkipRequest, current_user=Depends(get_current_user)):
    """활성 쿨다운을 30분 단축. method: "points"(⭐5, 반복 가능) | "ad"(광고권 1장).

    - 활성 쿨다운 없음 → 409 (무과금)
    - points 잔액 부족 → 402 {"error":"포인트가 부족합니다 (필요: 5)"}
    - 광고권 없음 → 402 {"error":"no_skip_tickets"}
    """
    user_id = str(current_user.get("id") or current_user.get("user_id"))
    method = (body.method or "").strip().lower()
    logger.info("[fatigue] skip request user=%s method=%s", user_id[:8], method or "(none)")

    if method not in ("points", "ad"):
        return JSONResponse(
            status_code=400,
            content={"error": "method 는 'points' 또는 'ad' 여야 합니다."},
        )

    mongo = get_mongo()

    # 활성 쿨다운 사전 확인 — 없으면 무과금 409
    remaining = await fatigue_service.check_gate(user_id)
    if remaining <= 0:
        logger.info("[fatigue] skip denied (no active cooldown) user=%s", user_id[:8])
        return JSONResponse(status_code=409, content={"error": "진행 중인 쿨다운이 없습니다."})

    if method == "points":
        cost = fatigue_service.SKIP_POINT_COST
        point_ref = uuid_lib.uuid4().hex
        if not await spend_points(user_id, "fatigue_skip", cost, point_ref):
            logger.info("[fatigue] skip denied (insufficient points) user=%s", user_id[:8])
            return JSONResponse(
                status_code=402,
                content={"error": "포인트가 부족합니다 (필요: {})".format(cost)},
            )
        reduced = await fatigue_service.reduce_cooldown(user_id)
        if reduced is None:
            # 결제와 단축 사이에 쿨다운 만료/해제 — 환불 후 현재 상태 반환
            logger.info("[fatigue] skip refund (cooldown gone) user=%s ref=%s", user_id[:8], point_ref)
            await refund_points(user_id, "fatigue_skip", cost, point_ref)
        else:
            logger.info("[fatigue] skip ok (points) user=%s -30min", user_id[:8])
    else:  # ad
        claim = await mongo.reward_balances.update_one(
            {"user_id": user_id, "skip_wait_count": {"$gte": 1}},
            {"$inc": {"skip_wait_count": -1}},
        )
        if claim.modified_count == 0:
            logger.info("[fatigue] skip denied (no tickets) user=%s", user_id[:8])
            return JSONResponse(status_code=402, content={"error": "no_skip_tickets"})
        reduced = await fatigue_service.reduce_cooldown(user_id)
        if reduced is None:
            # 쿨다운이 이미 사라짐 — 광고권 원복
            logger.info("[fatigue] skip ticket restore (cooldown gone) user=%s", user_id[:8])
            await mongo.reward_balances.update_one(
                {"user_id": user_id}, {"$inc": {"skip_wait_count": 1}}
            )
        else:
            logger.info("[fatigue] skip ok (ad ticket) user=%s -30min", user_id[:8])

    payload = await _status_payload(user_id)
    payload["skipped_minutes"] = fatigue_service.SKIP_MINUTES if reduced is not None else 0
    return payload
