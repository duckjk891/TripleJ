from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ---- User ----
class UserCreate(BaseModel):
    username: str
    nickname: str
    profile_image: Optional[str] = None
    bio: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    nickname: str
    profile_image: Optional[str]
    bio: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- MiniHompi ----
class MiniHompiUpdate(BaseModel):
    title: Optional[str] = None
    bgm_url: Optional[str] = None
    skin: Optional[str] = None


class MiniHompiResponse(BaseModel):
    id: int
    owner_id: int
    title: str
    bgm_url: Optional[str]
    skin: str
    today_count: int
    total_count: int

    model_config = {"from_attributes": True}


# ---- Diary ----
class DiaryCreate(BaseModel):
    author_id: int
    title: str
    content: str
    mood: Optional[str] = None
    is_public: bool = True


class DiaryUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    mood: Optional[str] = None
    is_public: Optional[bool] = None


class DiaryResponse(BaseModel):
    id: int
    author_id: int
    title: str
    content: str
    mood: Optional[str]
    is_public: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Photo ----
class PhotoCreate(BaseModel):
    owner_id: int
    image_url: str
    caption: Optional[str] = None
    album_name: str = "default"


class PhotoUpdate(BaseModel):
    caption: Optional[str] = None
    album_name: Optional[str] = None


class PhotoResponse(BaseModel):
    id: int
    owner_id: int
    image_url: str
    caption: Optional[str]
    album_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- MiniHompi + User combined ----
class HompiWithUserResponse(BaseModel):
    id: int
    owner_id: int
    title: str
    bgm_url: Optional[str]
    skin: str
    today_count: int
    total_count: int
    username: str
    nickname: str
    profile_image: Optional[str]
    bio: Optional[str]

    model_config = {"from_attributes": True}


# ---- Diary (body without author_id) ----
class DiaryCreateByPath(BaseModel):
    title: str
    content: str
    mood: Optional[str] = None
    is_public: bool = True


# ---- Photo (body without owner_id) ----
class PhotoCreateByPath(BaseModel):
    image_url: str
    caption: Optional[str] = None
    album_name: str = "default"


# ---- GuestBook ----
class GuestBookCreate(BaseModel):
    author_id: int
    content: str
    is_secret: bool = False


class GuestBookCreateByNickname(BaseModel):
    nickname: str
    content: str
    is_secret: bool = False


class GuestBookUpdate(BaseModel):
    content: Optional[str] = None
    is_secret: Optional[bool] = None


class GuestBookResponse(BaseModel):
    id: int
    minihompi_id: int
    author_id: int
    content: str
    is_secret: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Friend ----
class FriendCreate(BaseModel):
    user_id: int
    friend_id: int
    relation_name: str = "ilchon"


class FriendResponse(BaseModel):
    id: int
    user_id: int
    friend_id: int
    relation_name: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
