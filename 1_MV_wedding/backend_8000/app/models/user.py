"""
User-related Pydantic v2 models for the Wedding MV Studio.
Slimmed down for couple accounts (no business / catalog fields).
"""

from pydantic import BaseModel


class UserCreate(BaseModel):
    email: str
    password: str
    nickname: str


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdate(BaseModel):
    nickname: str | None = None
    profile_image: str | None = None
    bio: str | None = None
