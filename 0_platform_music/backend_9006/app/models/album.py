"""Album Pydantic models — v69 (Albums feature revived)."""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


CoverSource = Literal["auto", "upload", "ai", "borrowed"]


class AlbumCreate(BaseModel):
    title: str
    description: Optional[str] = None
    is_public: bool = True
    track_ids: List[str] = Field(default_factory=list, min_length=1)
    cover_source: Literal["auto", "upload", "ai"] = "auto"


class AlbumUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    cover_source: Optional[CoverSource] = None


class AlbumTracksReorder(BaseModel):
    track_ids: List[str]


class AlbumTracksAdd(BaseModel):
    track_ids: List[str]


class AlbumCoverGenerateBody(BaseModel):
    title: str
    description: Optional[str] = None
    track_ids: List[str] = Field(default_factory=list)
    gender: Literal["female", "male", "neutral"] = "neutral"
    image_model: Literal["nb_pro", "gpt_image_2"] = "nb_pro"
    include_character: bool = False


class AlbumResponse(BaseModel):
    id: str
    owner_id: str
    artist_id: str
    artist_name: str
    title: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    cover_source: CoverSource = "auto"
    is_public: bool = True
    release_date: Optional[str] = None  # ISO string of created_at
    track_count: int = 0
    tracks: Optional[List[dict]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AlbumInDB(BaseModel):
    id: str
    owner_id: str
    owner_nickname: str
    title: str
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    cover_object_name: Optional[str] = None
    cover_source: CoverSource = "auto"
    track_ids: List[str] = Field(default_factory=list)
    is_public: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
