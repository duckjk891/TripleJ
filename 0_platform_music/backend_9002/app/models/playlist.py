from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class PlaylistCreate(BaseModel):
    title: str
    is_public: bool = True


class PlaylistUpdate(BaseModel):
    title: Optional[str] = None
    is_public: Optional[bool] = None


class PlaylistResponse(BaseModel):
    id: str
    user_id: str
    title: str
    is_public: bool = True
    created_at: Optional[datetime] = None
    track_count: int = 0
    tracks: Optional[List[dict]] = None


class AddTrack(BaseModel):
    track_id: str
