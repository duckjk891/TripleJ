"""
AIMU Points API - 사용자 활동 포인트 조회.

차트에 영향을 주는 행위(재생 듣기 / 다운로드)를 로그인 사용자가 하면 +1 적립.
하루 1회 / 곡당 / 행위별 멱등. 적립 자체는 charts/tracks 라우트의 best-effort 훅에서 처리.
"""

import logging

from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..services import points_service as svc

router = APIRouter(prefix="/api/points")

logger = logging.getLogger(__name__)


class SpendBody(BaseModel):
    action: str
    ref: str | None = None  # 멱등/추적용 (미지정 시 서버가 uuid 발급)


@router.post("/spend")
async def points_spend(body: SpendBody, user: dict = Depends(get_current_user)):
    """v193 — 별 차감(유료 액션). 단가는 서버 POINT_COSTS 단일 소스(클라 금액 지정 금지).

    잔액 부족 시 402. 차감은 원자적(spend_points) — 음수 잔액 불가.
    """
    user_id = str(user["id"])
    action = (body.action or "").strip()
    cost = svc.POINT_COSTS.get(action)
    if cost is None:
        logger.warning("[points] spend invalid action=%s user=%s", action, user_id[:8])
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 액션입니다."})
    ref = (body.ref or "").strip() or uuid4().hex
    logger.info("[points] POST /spend user=%s action=%s cost=%d ref=%s", user_id[:8], action, cost, ref[:12])
    ok = await svc.spend_points(user_id, action, cost, ref)
    if not ok:
        return JSONResponse(status_code=402, content={"error": "별이 부족합니다."})
    balance = await svc.get_balance(user_id)
    return {"ok": True, "action": action, "spent": cost, "balance": balance}


@router.get("/costs")
async def points_costs():
    """StarEcon(v158) — 유료 액션 단가 단일 소스 노출 (FE 하드코딩 드리프트 방지).

    비용이 있는 액션만 포함: lyrics/compose/cover/character/fatigue_skip.
    인증 불요 (가격표는 공개 정보).
    """
    return {"costs": svc.POINT_COSTS}


@router.get("/balance")
async def points_balance(user: dict = Depends(get_current_user)):
    """Return the authenticated user's current point balance (0 at account creation)."""
    try:
        user_id = str(user.get("id") or user.get("user_id"))
        logger.info("[points] GET /balance user=%s", user_id)
        balance = await svc.get_balance(user_id)
        return {"balance": balance}
    except Exception:
        logger.exception("[points] /balance failed")
        return JSONResponse(status_code=500, content={"error": "포인트 잔액 조회에 실패했습니다."})


@router.get("/history")
async def points_history(
    user: dict = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
):
    """Return the authenticated user's recent point events (newest first)."""
    try:
        user_id = str(user.get("id") or user.get("user_id"))
        logger.info("[points] GET /history user=%s limit=%d", user_id, limit)
        history = await svc.get_history(user_id, limit)
        return {"history": history}
    except Exception:
        logger.exception("[points] /history failed")
        return JSONResponse(status_code=500, content={"error": "포인트 내역 조회에 실패했습니다."})
