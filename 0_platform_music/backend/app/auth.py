import json
import os

import jwt
from fastapi import Depends, Header, HTTPException, Request

from .database.redis import get_redis

JWT_SECRET = os.getenv("JWT_SECRET", "music-platform-secret-key-2024")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")


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
        raise HTTPException(status_code=401, detail="세션이 만료되었습니다. 다시 로그인해주세요.")

    session = json.loads(session_data)
    # Ensure role is present in session data
    if "role" not in session:
        session["role"] = "user"
    return session


async def get_admin_user(current_user=Depends(get_current_user)):
    """Validate that the current user is an admin."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return current_user
