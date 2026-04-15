from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: str
    password: str
    nickname: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    nickname: str
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    plan: str = "free"
    created_at: Optional[datetime] = None


class UserInDB(UserResponse):
    password_hash: str
