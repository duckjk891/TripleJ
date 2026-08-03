"""
MAIDOL Referral API (v154) - 앱 추천(리퍼럴).

- GET /api/referral/my-code       (인증)   내 추천코드 조회 — 없으면 lazy 생성(소셜 가입자 커버)
- GET /api/referral/invite/{code} (무인증)  초대 착지 페이지 데이터 — 무효/탈퇴 코드는 404
"""

import logging
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..config import settings
from ..database.postgres import get_pg
from ..services.referral_service import ensure_referral_code, resolve_referrer

router = APIRouter(prefix="/api/referral")

logger = logging.getLogger(__name__)


@router.get("/my-code")
async def my_referral_code(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """내 추천코드 조회 — 코드 없으면 즉시 발급(lazy). invite_url 은 프론트 조립용 상대경로."""
    user_tag = str(current_user["id"])[:8]
    logger.info("[referral] GET /my-code user=%s", user_tag)
    try:
        user_id = uuid.UUID(str(current_user["id"]))
        code = await ensure_referral_code(conn, user_id)
    except Exception:
        logger.exception("[referral] my-code failed user=%s", user_tag)
        return JSONResponse(status_code=500, content={"error": "추천코드 조회에 실패했습니다."})
    logger.info("[referral] my-code ok user=%s code=%s", user_tag, code)
    return {
        "referral_code": code,
        "invite_url": f"/invite/{code}",
        "play_store_url": settings.play_store_url,
    }


@router.get("/invite/{code}")
async def invite_info(code: str, conn=Depends(get_pg)):
    """초대 착지 페이지 데이터 (무인증) — 형식 무효/미존재/탈퇴·정지 유저 코드는 404."""
    code_tag = str(code)[:8] if code else ""
    logger.info("[referral] GET /invite code=%s", code_tag)
    row = await resolve_referrer(conn, code)
    if not row:
        logger.info("[referral] invite not found code=%s", code_tag)
        return JSONResponse(status_code=404, content={"error": "유효하지 않은 초대코드입니다."})
    logger.info(
        "[referral] invite ok code=%s inviter=%s", row["referral_code"], str(row["id"])[:8]
    )
    return {
        "referral_code": row["referral_code"],
        "inviter_nickname": row["nickname"],
        "play_store_url": settings.play_store_url,
    }
