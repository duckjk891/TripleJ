"""
v2.0: Albums concept deprecated in favor of flat track model.
These endpoints are kept as stubs for backward compatibility.
In v2.0, tracks belong directly to uploaders, not albums.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/albums")


@router.get("/")
async def list_albums():
    """Albums are deprecated in v2.0. Returns empty list."""
    return {"albums": [], "pagination": {"page": 1, "limit": 20, "total": 0, "totalPages": 0}}


@router.get("/latest")
async def latest_albums():
    """Albums are deprecated in v2.0."""
    return []


@router.get("/{album_id}")
async def get_album(album_id: str):
    """Albums are deprecated in v2.0."""
    return JSONResponse(status_code=404, content={"error": "v2.0에서 앨범 기능은 지원되지 않습니다."})
