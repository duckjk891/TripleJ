import json

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import JWT_SECRET, JWT_ALGORITHM, get_current_user
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..models.user import UserCreate, LoginRequest

router = APIRouter(prefix="/api/auth")

SESSION_TTL = 7 * 24 * 3600  # 7 days in seconds


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


async def _save_session(user_id: str, email: str, nickname: str, profile_image: str = None, role: str = "user"):
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
    if not body.email or not body.password or not body.nickname:
        return JSONResponse(status_code=400, content={"error": "이메일, 비밀번호, 닉네임은 필수입니다."})

    existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 등록된 이메일입니다."})

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    row = await conn.fetchrow(
        "INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING id, email, nickname, role",
        body.email, password_hash, body.nickname,
    )

    user_id = str(row["id"])
    role = row["role"] or "user"
    token = _create_token(user_id, body.email, body.nickname, role)
    await _save_session(user_id, body.email, body.nickname, role=role)

    return {
        "message": "회원가입이 완료되었습니다.",
        "token": token,
        "user": {"id": user_id, "email": body.email, "nickname": body.nickname, "role": role},
    }


@router.post("/login")
async def login(body: LoginRequest, conn=Depends(get_pg)):
    if not body.email or not body.password:
        return JSONResponse(status_code=400, content={"error": "이메일과 비밀번호를 입력해주세요."})

    row = await conn.fetchrow(
        "SELECT id, email, password_hash, nickname, profile_image, role, is_banned FROM users WHERE email = $1",
        body.email,
    )
    if not row:
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if row["is_banned"]:
        return JSONResponse(status_code=403, content={"error": "계정이 정지되었습니다."})

    user_id = str(row["id"])
    role = row["role"] or "user"
    token = _create_token(user_id, row["email"], row["nickname"], role)
    await _save_session(user_id, row["email"], row["nickname"], row["profile_image"], role=role)

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
    row = await conn.fetchrow(
        "SELECT id, email, nickname, profile_image, bio, plan, role, created_at FROM users WHERE id = $1",
        current_user["id"] if not isinstance(current_user["id"], str) else __import__("uuid").UUID(current_user["id"]),
    )
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "plan": row["plan"],
        "role": row["role"] or "user",
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.post("/logout")
async def logout(current_user=Depends(get_current_user)):
    """Remove session from Redis."""
    redis = get_redis()
    await redis.delete(f"session:{current_user['id']}")
    return {"message": "로그아웃 되었습니다."}
