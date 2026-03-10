import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import JWT_SECRET, JWT_ALGORITHM, get_current_user
from ..database import get_db, dict_row

router = APIRouter(prefix="/api/auth")


class RegisterRequest(BaseModel):
    email: str
    password: str
    nickname: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _create_token(user_id, email, nickname):
    token = jwt.encode(
        {"id": user_id, "email": email, "nickname": nickname, "exp": datetime.now(timezone.utc) + timedelta(days=7)},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    # PyJWT 1.x returns bytes, 2.x returns str
    return token.decode("utf-8") if isinstance(token, bytes) else token


@router.post("/register", status_code=201)
def register(body: RegisterRequest, db=Depends(get_db)):
    if not body.email or not body.password or not body.nickname:
        return {"error": "이메일, 비밀번호, 닉네임은 필수입니다."}

    existing = db.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if existing:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={"error": "이미 등록된 이메일입니다."})

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    cur = db.execute("INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)", (body.email, hashed, body.nickname))
    db.commit()
    user_id = cur.lastrowid

    token = _create_token(user_id, body.email, body.nickname)
    return {
        "message": "회원가입이 완료되었습니다.",
        "token": token,
        "user": {"id": user_id, "email": body.email, "nickname": body.nickname},
    }


@router.post("/login")
def login(body: LoginRequest, db=Depends(get_db)):
    if not body.email or not body.password:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": "이메일과 비밀번호를 입력해주세요."})

    row = db.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
    if not row:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    user = dict_row(row)
    if not bcrypt.checkpw(body.password.encode(), user["password"].encode()):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    token = _create_token(user["id"], user["email"], user["nickname"])
    return {
        "message": "로그인 성공",
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "nickname": user["nickname"], "profile_image": user["profile_image"]},
    }


@router.get("/me")
def me(current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT id, email, nickname, profile_image, created_at FROM users WHERE id = ?", (current_user["id"],)).fetchone()
    if not row:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})
    return dict_row(row)
