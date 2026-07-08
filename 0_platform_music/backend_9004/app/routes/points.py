"""
AIMU Points API - 사용자 활동 포인트 조회.

차트에 영향을 주는 행위(재생 듣기 / 다운로드)를 로그인 사용자가 하면 +1 적립.
하루 1회 / 곡당 / 행위별 멱등. 적립 자체는 charts/tracks 라우트의 best-effort 훅에서 처리.
"""

import logging

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..services import points_service as svc

router = APIRouter(prefix="/api/points")

logger = logging.getLogger(__name__)


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
