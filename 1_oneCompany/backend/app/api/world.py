from fastapi import APIRouter
from app.models.world import SpeedUpdate
from app.services.world_data import WORLD_TREE, get_spawn_locations
from app.services.time_manager import time_manager

router = APIRouter()


@router.get("/tree")
async def get_world_tree():
    """월드 트리 구조"""
    return WORLD_TREE


@router.get("/locations")
async def get_locations():
    """스폰 가능 위치 목록"""
    return get_spawn_locations()


@router.get("/time")
async def get_time():
    """현재 게임 시간"""
    return time_manager.to_dict()


@router.put("/time/speed")
async def set_speed(data: SpeedUpdate):
    """시간 속도 조절"""
    time_manager.set_speed(data.speed)
    return {"message": f"Speed set to {data.speed}x", "speed": data.speed}
