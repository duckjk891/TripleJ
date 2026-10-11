import json
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, Request

from .database.redis import get_redis

JWT_SECRET = os.getenv("JWT_SECRET", "music-platform-secret-key-2024")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# 관리자 대시보드 "오늘 접속자" — 인증된 요청을 보낸 사용자를 KST 일자별 Redis SET 에 기록.
DAU_KEY_PREFIX = "stats:dau:"
DAU_TTL = 400 * 24 * 3600
_KST = timezone(timedelta(hours=9))


def dau_key(day: datetime) -> str:
    return f"{DAU_KEY_PREFIX}{day.astimezone(_KST).strftime('%Y%m%d')}"


async def _touch_dau(redis, user_id: str) -> None:
    # 인증 경로를 절대 막지 않도록 실패는 삼킨다.
    try:
        key = dau_key(datetime.now(timezone.utc))
        if await redis.sadd(key, str(user_id)):
            await redis.expire(key, DAU_TTL)
    except Exception:
        pass


# v3.233 보호자 동의 철회 — revoke 가 `session:{uid}` 를 지우고 이 표식을 남긴다(TTL 8일 > JWT 7일).
# 표식은 "세션 없음" 실패 경로에서만 읽는다. 로그인 차단은 users.account_status='suspended'(routes/auth.login).
ACCOUNT_SUSPENDED_KEY = "account_suspended:{uid}"
ACCOUNT_SUSPENDED_TTL = 8 * 24 * 3600
ACCOUNT_SUSPENDED_CODE = "account_suspended"
ACCOUNT_SUSPENDED_MESSAGE = "보호자가 동의를 철회하여 계정 이용이 중지되었습니다. 문의: maidol_official@lotusai.co.kr"
ACCOUNT_SUSPENDED_DETAIL = {"error": ACCOUNT_SUSPENDED_MESSAGE, "code": ACCOUNT_SUSPENDED_CODE}


async def is_account_suspended(redis, user_id) -> bool:
    """동의 철회 표식 확인 — 실패는 False(기존 401 경로 유지)."""
    try:
        return bool(await redis.get(ACCOUNT_SUSPENDED_KEY.format(uid=user_id)))
    except Exception:
        return False


async def get_current_user(request: Request, authorization: str = Header(None)):
    """Validate JWT token and check Redis session.
    Supports both Authorization header and ?token= query parameter.
    """
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ")[1]
    else:
        # Fallback: read token from query parameter
        raw_token = request.query_params.get("token")

    if not raw_token:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다.")

    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=403, detail="토큰이 만료되었습니다.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=403, detail="유효하지 않은 토큰입니다.")

    user_id = payload.get("id")
    if not user_id:
        raise HTTPException(status_code=403, detail="유효하지 않은 토큰입니다.")

    # Check Redis session
    redis = get_redis()
    session_data = await redis.get(f"session:{user_id}")
    if not session_data:
        # v3.233 — 보호자 동의 철회(suspended)로 세션이 지워진 계정은 401 대신 403(앱 안내). 세션이 없는
        # 실패 경로에서만 Redis GET 1회 추가(정상 요청 경로는 조회·동작 불변).
        if await is_account_suspended(redis, user_id):
            raise HTTPException(status_code=403, detail=ACCOUNT_SUSPENDED_DETAIL)
        raise HTTPException(status_code=401, detail="세션이 만료되었습니다. 다시 로그인해주세요.")

    session = json.loads(session_data)
    # Ensure role is present in session data
    if "role" not in session:
        session["role"] = "user"
    await _touch_dau(redis, user_id)
    return session


async def get_current_user_optional(request: Request, authorization: str = Header(None)):
    """Optional authentication: return the session dict when a valid token +
    session exists, otherwise None. Never raises for auth failures."""
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ")[1]
    else:
        raw_token = request.query_params.get("token")

    if not raw_token:
        return None

    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True})
    except jwt.InvalidTokenError:
        return None

    user_id = payload.get("id")
    if not user_id:
        return None

    try:
        redis = get_redis()
        session_data = await redis.get(f"session:{user_id}")
    except Exception:
        return None
    if not session_data:
        return None

    session = json.loads(session_data)
    if "role" not in session:
        session["role"] = "user"
    await _touch_dau(redis, user_id)
    return session


async def get_admin_user(current_user=Depends(get_current_user)):
    """Validate that the current user is an admin."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return current_user
