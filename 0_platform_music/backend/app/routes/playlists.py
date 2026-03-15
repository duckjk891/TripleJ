import uuid
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo
from ..models.playlist import PlaylistCreate, PlaylistUpdate, AddTrack

router = APIRouter(prefix="/api/playlists")


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


@router.get("/")
async def list_playlists(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    rows = await conn.fetch("""
        SELECT p.id, p.user_id, p.title, p.is_public, p.created_at,
               (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count
        FROM playlists p WHERE p.user_id = $1 ORDER BY p.created_at DESC
    """, user_id)

    return [
        {
            "id": str(r["id"]),
            "user_id": str(r["user_id"]),
            "title": r["title"],
            "is_public": r["is_public"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "track_count": r["track_count"],
        }
        for r in rows
    ]


@router.post("/", status_code=201)
async def create_playlist(body: PlaylistCreate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    if not body.title:
        return JSONResponse(status_code=400, content={"error": "플레이리스트 제목은 필수입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow(
        "INSERT INTO playlists (user_id, title, is_public) VALUES ($1, $2, $3) RETURNING id, user_id, title, is_public, created_at",
        user_id, body.title, body.is_public,
    )

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "is_public": row["is_public"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.get("/{playlist_id}")
async def get_playlist(playlist_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1", pl_uuid)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    user_id = uuid.UUID(current_user["id"])
    if not row["is_public"] and row["user_id"] != user_id:
        return JSONResponse(status_code=403, content={"error": "비공개 플레이리스트입니다."})

    # Get track IDs from PostgreSQL
    track_rows = await conn.fetch(
        "SELECT track_id, position FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position",
        pl_uuid,
    )

    # Cross-query MongoDB for track details
    tracks = []
    if track_rows:
        track_ids = [ObjectId(r["track_id"]) for r in track_rows if ObjectId.is_valid(r["track_id"])]
        mongo = get_mongo()
        docs = await mongo.tracks.find({"_id": {"$in": track_ids}}).to_list(length=len(track_ids))
        docs_map = {str(d["_id"]): d for d in docs}

        for r in track_rows:
            doc = docs_map.get(r["track_id"])
            if doc:
                t = _serialize_track(doc)
                t["position"] = r["position"]
                tracks.append(t)

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "is_public": row["is_public"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "tracks": tracks,
    }


@router.put("/{playlist_id}")
async def update_playlist(playlist_id: str, body: PlaylistUpdate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    title = body.title if body.title is not None else row["title"]
    is_public = body.is_public if body.is_public is not None else row["is_public"]

    updated = await conn.fetchrow(
        "UPDATE playlists SET title = $1, is_public = $2 WHERE id = $3 RETURNING id, user_id, title, is_public, created_at",
        title, is_public, pl_uuid,
    )

    return {
        "id": str(updated["id"]),
        "user_id": str(updated["user_id"]),
        "title": updated["title"],
        "is_public": updated["is_public"],
        "created_at": updated["created_at"].isoformat() if updated["created_at"] else None,
    }


@router.delete("/{playlist_id}")
async def delete_playlist(playlist_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    await conn.execute("DELETE FROM playlists WHERE id = $1", pl_uuid)
    return {"message": "플레이리스트가 삭제되었습니다."}


@router.post("/{playlist_id}/tracks", status_code=201)
async def add_track(playlist_id: str, body: AddTrack, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    # Verify track exists in MongoDB
    if not ObjectId.is_valid(body.track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    track = await mongo.tracks.find_one({"_id": ObjectId(body.track_id)})
    if not track:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # Check duplicate
    existing = await conn.fetchrow(
        "SELECT playlist_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, body.track_id,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 추가된 트랙입니다."})

    # Get next position
    max_pos = await conn.fetchval("SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = $1", pl_uuid)
    position = (max_pos or 0) + 1

    await conn.execute(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)",
        pl_uuid, body.track_id, position,
    )

    return {"message": "트랙이 추가되었습니다."}


@router.delete("/{playlist_id}/tracks/{track_id}")
async def remove_track(playlist_id: str, track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    result = await conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, track_id,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "플레이리스트에 해당 트랙이 없습니다."})
    return {"message": "트랙이 제거되었습니다."}
