from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, List, Dict


class WorldNode(BaseModel):
    id: str
    name: str
    type: str  # 'world' | 'area' | 'room' | 'object'
    state: Optional[str] = None
    children: List[WorldNode] = []
    position: Optional[Dict] = None


class SpawnLocation(BaseModel):
    id: str
    name: str
    x: int
    y: int


class GameTimeResponse(BaseModel):
    hour: int
    minute: int
    day: int
    display: str
    speed: int
    paused: bool


class SpeedUpdate(BaseModel):
    speed: int


class AvatarResponse(BaseModel):
    id: str
    name: str
    color: int
