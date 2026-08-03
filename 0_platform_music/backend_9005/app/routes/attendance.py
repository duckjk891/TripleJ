"""
AIMU Attendance API - 데일리 체크인(출석체크).

스트릭형 10일 1사이클 + 누적. 하루 1회(KST) 체크인하면 별(포인트)을 지급.
상태 조회(GET /status)와 체크인(POST /check-in) 두 엔드포인트를 제공한다.
"""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..services import attendance_service as svc

router = APIRouter(prefix="/api/attendance")

logger = logging.getLogger(__name__)


@router.get("/status")
async def attendance_status(user: dict = Depends(get_current_user)):
    """오늘 체크인 여부 + 사이클 진행 + 10칸 캘린더 + 별 잔액."""
    try:
        user_id = str(user.get("id") or user.get("user_id"))
        logger.info("[attendance] GET /status user=%s", user_id)
        return await svc.get_status(user_id)
    except Exception:
        logger.exception("[attendance] /status failed")
        return JSONResponse(status_code=500, content={"error": "출석 현황 조회에 실패했습니다."})


@router.post("/check-in")
async def attendance_check_in(user: dict = Depends(get_current_user)):
    """오늘 체크인 처리 + 별 적립 (하루 1회 KST 멱등)."""
    try:
        user_id = str(user.get("id") or user.get("user_id"))
        logger.info("[attendance] POST /check-in user=%s", user_id)
        return await svc.check_in(user_id)
    except Exception:
        logger.exception("[attendance] /check-in failed")
        return JSONResponse(status_code=500, content={"error": "출석체크에 실패했습니다."})
