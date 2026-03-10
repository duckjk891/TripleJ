from pydantic import BaseModel


class CharacterCreate(BaseModel):
    name: str
    occupation: str
    avatar_id: str
    spawn_location: str


class CharacterPositionUpdate(BaseModel):
    x: int
    y: int


class CharacterActionUpdate(BaseModel):
    action: str


class CharacterResponse(BaseModel):
    id: str
    name: str
    occupation: str
    avatar_id: str
    position: dict
    current_action: str
