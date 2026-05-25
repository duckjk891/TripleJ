from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: str
    password: str
    nickname: str
    company_name: Optional[str] = Field(default=None, max_length=100)
    display_title: Optional[str] = Field(default="대표", max_length=20)


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
    company_name: Optional[str] = None
    display_title: Optional[str] = None
    created_at: Optional[datetime] = None


class UserInDB(UserResponse):
    password_hash: str


class ProfileUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=100)
    display_title: Optional[str] = Field(default=None, max_length=20)
    bio: Optional[str] = Field(default=None, max_length=500)
