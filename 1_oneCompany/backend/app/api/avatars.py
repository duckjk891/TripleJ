from fastapi import APIRouter
from app.services.world_data import AVATAR_COLORS

router = APIRouter()


@router.get("")
async def get_avatars():
    """사용 가능 아바타 목록"""
    return AVATAR_COLORS
