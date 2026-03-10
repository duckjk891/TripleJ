from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import MiniHompi, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    nickname: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")

    db_user = User(
        email=req.email,
        password=req.password,
        username=req.email.split("@")[0],
        nickname=req.nickname,
    )
    db.add(db_user)
    db.flush()

    minihompi = MiniHompi(
        owner_id=db_user.id,
        title=f"{req.nickname}'s MiniHompi",
    )
    db.add(minihompi)
    db.commit()
    db.refresh(db_user)

    return {"message": "회원가입 성공", "user_id": db_user.id}


@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or user.password != req.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {"message": "로그인 성공", "user_id": user.id, "nickname": user.nickname}
