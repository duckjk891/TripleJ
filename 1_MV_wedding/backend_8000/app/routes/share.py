"""
Share link stub — GET /api/share/{token}
v1: returns dummy payload (no auth required).
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/share")


@router.get("/{token}")
async def get_shared(token: str):
    return {
        "token": token,
        "message": "sharing not configured yet",
    }
