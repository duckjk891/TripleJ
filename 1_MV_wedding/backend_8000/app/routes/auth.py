import json
import logging
import uuid

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..auth import JWT_SECRET, JWT_ALGORITHM, get_current_user
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..models.user import UserCreate, LoginRequest, ProfileUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth")

SESSION_TTL = 7 * 24 * 3600  # 7 days in seconds
ALLOWED_PROFILE_FIELDS = {"nickname", "profile_image", "bio"}


def _create_token(user_id: str, email: str, nickname: str, role: str = "user") -> str:
    payload = {
        "id": user_id,
        "email": email,
        "nickname": nickname,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token.decode("utf-8") if isinstance(token, bytes) else token


async def _save_session(
    user_id: str,
    email: str,
    nickname: str,
    profile_image: str = None,
    role: str = "user",
):
    """Store session data in Redis."""
    redis = get_redis()
    session = {
        "id": user_id,
        "email": email,
        "nickname": nickname,
        "profile_image": profile_image,
        "role": role,
    }
    await redis.setex(f"session:{user_id}", SESSION_TTL, json.dumps(session))


@router.post("/register", status_code=201)
async def register(body: UserCreate, conn=Depends(get_pg)):
    logger.info("[AuthRoute] /register entry email=%s nickname=%s", body.email, body.nickname)
    if not body.email or not body.password or not body.nickname:
        return JSONResponse(status_code=400, content={"error": "이메일, 비밀번호, 닉네임은 필수입니다."})

    existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        logger.info("[AuthRoute] /register conflict email=%s already exists", body.email)
        return JSONResponse(status_code=409, content={"error": "이미 등록된 이메일입니다."})

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    row = await conn.fetchrow(
        """INSERT INTO users (email, password_hash, nickname)
           VALUES ($1, $2, $3)
           RETURNING id, email, nickname""",
        body.email, password_hash, body.nickname,
    )

    user_id = str(row["id"])
    token = _create_token(user_id, body.email, body.nickname, role="user")
    await _save_session(user_id, body.email, body.nickname, role="user")

    logger.info("[AuthRoute] /register ok user_id=%s role=user", user_id)
    return {
        "message": "회원가입이 완료되었습니다.",
        "token": token,
        "user": {
            "id": user_id,
            "email": body.email,
            "nickname": body.nickname,
            "role": "user",
        },
    }


@router.post("/login")
async def login(body: LoginRequest, conn=Depends(get_pg)):
    logger.info("[AuthRoute] /login entry email=%s", body.email)
    if not body.email or not body.password:
        return JSONResponse(status_code=400, content={"error": "이메일과 비밀번호를 입력해주세요."})

    row = await conn.fetchrow(
        "SELECT id, email, password_hash, nickname, profile_image, is_banned, role FROM users WHERE email = $1",
        body.email,
    )
    if not row:
        logger.info("[AuthRoute] /login reject email=%s reason=not_found", body.email)
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        logger.info("[AuthRoute] /login reject email=%s reason=bad_password", body.email)
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if row["is_banned"]:
        logger.info("[AuthRoute] /login reject email=%s reason=banned", body.email)
        return JSONResponse(status_code=403, content={"error": "계정이 정지되었습니다."})

    user_id = str(row["id"])
    role = row["role"] or "user"
    token = _create_token(user_id, row["email"], row["nickname"], role=role)
    await _save_session(user_id, row["email"], row["nickname"], row["profile_image"], role=role)

    logger.info("[AuthRoute] /login ok user_id=%s role=%s", user_id, role)
    return {
        "message": "로그인 성공",
        "token": token,
        "user": {
            "id": user_id,
            "email": row["email"],
            "nickname": row["nickname"],
            "profile_image": row["profile_image"],
            "role": role,
        },
    }


@router.get("/me")
async def me(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = current_user["id"]
    logger.info("[AuthRoute] /me entry user_id=%s role=%s", user_id, current_user.get("role"))
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)
    row = await conn.fetchrow(
        "SELECT id, email, nickname, profile_image, bio, role, created_at FROM users WHERE id = $1",
        user_id,
    )
    if not row:
        logger.warning("[AuthRoute] /me user not found user_id=%s", user_id)
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "role": row["role"] or "user",
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.patch("/me/profile")
async def update_profile(
    body: ProfileUpdate,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    # model_dump(exclude_unset=True): only fields actually sent
    updates = body.model_dump(exclude_unset=True)
    # Whitelist filter to be safe
    updates = {k: v for k, v in updates.items() if k in ALLOWED_PROFILE_FIELDS}
    if not updates:
        raise HTTPException(status_code=400, detail="변경할 필드가 없습니다.")

    set_clauses = []
    values = []
    idx = 1
    for key, val in updates.items():
        set_clauses.append(f"{key} = ${idx}")
        values.append(val)
        idx += 1

    user_id = current_user["id"]
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)
    values.append(user_id)

    query = (
        f"UPDATE users SET {', '.join(set_clauses)}, updated_at = now() "
        f"WHERE id = ${idx} "
        f"RETURNING id, email, nickname, profile_image, bio, role, created_at"
    )
    row = await conn.fetchrow(query, *values)
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "role": row["role"] or "user",
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.post("/logout")
async def logout(current_user=Depends(get_current_user)):
    """Remove session from Redis."""
    redis = get_redis()
    await redis.delete(f"session:{current_user['id']}")
    return {"message": "로그아웃 되었습니다."}
