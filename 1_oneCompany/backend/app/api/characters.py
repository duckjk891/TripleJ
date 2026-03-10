from typing import List
from fastapi import APIRouter, HTTPException
from app.models.character import CharacterCreate, CharacterPositionUpdate, CharacterActionUpdate, CharacterResponse
from app.services.character_manager import character_manager
from app.services.world_data import get_spawn_locations

router = APIRouter()


@router.get("", response_model=List[CharacterResponse])
async def get_characters():
    """모든 캐릭터 목록"""
    return [c.to_dict() for c in character_manager.get_all()]


@router.get("/{char_id}", response_model=CharacterResponse)
async def get_character(char_id: str):
    """캐릭터 상세"""
    char = character_manager.get(char_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char.to_dict()


@router.post("", response_model=CharacterResponse, status_code=201)
async def create_character(data: CharacterCreate):
    """캐릭터 생성"""
    # spawn_location ID로 좌표 찾기
    locations = get_spawn_locations()
    location = next((l for l in locations if l["id"] == data.spawn_location), None)
    if not location:
        raise HTTPException(status_code=400, detail=f"Invalid spawn location: {data.spawn_location}")

    char = character_manager.create(
        name=data.name,
        occupation=data.occupation,
        avatar_id=data.avatar_id,
        x=location["x"],
        y=location["y"],
    )
    return char.to_dict()


@router.delete("/{char_id}")
async def delete_character(char_id: str):
    """캐릭터 삭제"""
    if not character_manager.delete(char_id):
        raise HTTPException(status_code=404, detail="Character not found")
    return {"message": "Character deleted", "id": char_id}


@router.put("/{char_id}/position", response_model=CharacterResponse)
async def update_position(char_id: str, data: CharacterPositionUpdate):
    """위치 업데이트"""
    char = character_manager.update_position(char_id, data.x, data.y)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char.to_dict()


@router.put("/{char_id}/action", response_model=CharacterResponse)
async def update_action(char_id: str, data: CharacterActionUpdate):
    """행동 업데이트"""
    char = character_manager.update_action(char_id, data.action)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char.to_dict()
