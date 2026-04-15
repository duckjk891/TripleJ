from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class TrackCreate(BaseModel):
    title: str
    genre: List[str] = []
    mood: List[str] = []
    tags: List[str] = []
    ai_model: Optional[str] = None
    prompt: Optional[str] = None
    ai_model_version: Optional[str] = None
    bpm: Optional[int] = None
    key: Optional[str] = None
    language: Optional[str] = None
    lyrics: Optional[str] = None
    is_public: bool = True


class TrackUploadForm(BaseModel):
    """Describes the expected form fields for track upload."""
    title: str
    genre: Optional[str] = None       # comma-separated
    mood: Optional[str] = None        # comma-separated
    tags: Optional[str] = None        # comma-separated
    ai_model: Optional[str] = None
    prompt: Optional[str] = None
    bpm: Optional[int] = None
    key: Optional[str] = None
    language: Optional[str] = None
    lyrics: Optional[str] = None
    is_public: bool = True


class TrackResponse(BaseModel):
    id: str
    title: str
    uploader_id: str
    uploader_nickname: str
    genre: List[str] = []
    mood: List[str] = []
    tags: List[str] = []
    ai_model: Optional[str] = None
    prompt: Optional[str] = None
    duration_sec: int = 0
    audio_url: Optional[str] = None
    cover_image_url: Optional[str] = None
    play_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    is_public: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TrackInDB(TrackResponse):
    waveform_data: List[float] = []
