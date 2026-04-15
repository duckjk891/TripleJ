"""
v2.0: Artists concept replaced by uploaders (users who upload tracks).
These endpoints provide backward compatibility by aggregating data from
MongoDB tracks and PostgreSQL users.
"""

import math
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..database.postgres import get_pg
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/artists")


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


@router.get("/")
async def list_artists(page: int = 1, limit: int = 20, conn=Depends(get_pg)):
    """List users who have uploaded tracks (creators)."""
    mongo = get_mongo()
    offset = (page - 1) * limit

    # Aggregate distinct uploaders from MongoDB
    pipeline = [
        {"$group": {
            "_id": "$uploader_id",
            "nickname": {"$first": "$uploader_nickname"},
            "track_count": {"$sum": 1},
            "total_plays": {"$sum": "$play_count"},
        }},
        {"$sort": {"total_plays": -1}},
        {"$skip": offset},
        {"$limit": limit},
    ]
    results = await mongo.tracks.aggregate(pipeline).to_list(length=limit)
    total_pipeline = [{"$group": {"_id": "$uploader_id"}}, {"$count": "total"}]
    total_result = await mongo.tracks.aggregate(total_pipeline).to_list(length=1)
    total = total_result[0]["total"] if total_result else 0

    artists = []
    for r in results:
        # Fetch profile info from PostgreSQL
        user_row = None
        try:
            user_row = await conn.fetchrow(
                "SELECT id, nickname, profile_image, bio FROM users WHERE id = $1",
                uuid.UUID(r["_id"]),
            )
        except (ValueError, Exception):
            pass

        artists.append({
            "id": r["_id"],
            "name": user_row["nickname"] if user_row else r["nickname"],
            "image": user_row["profile_image"] if user_row else None,
            "bio": user_row["bio"] if user_row else None,
            "track_count": r["track_count"],
            "total_plays": r["total_plays"],
        })

    return {
        "artists": artists,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{artist_id}")
async def get_artist(artist_id: str, conn=Depends(get_pg)):
    """Get creator profile by user ID."""
    mongo = get_mongo()

    # Aggregate stats from MongoDB
    pipeline = [
        {"$match": {"uploader_id": artist_id}},
        {"$group": {
            "_id": "$uploader_id",
            "nickname": {"$first": "$uploader_nickname"},
            "track_count": {"$sum": 1},
            "total_plays": {"$sum": "$play_count"},
            "total_likes": {"$sum": "$like_count"},
        }},
    ]
    results = await mongo.tracks.aggregate(pipeline).to_list(length=1)

    # Fetch profile from PostgreSQL
    user_row = None
    try:
        user_row = await conn.fetchrow(
            "SELECT id, nickname, profile_image, bio, created_at FROM users WHERE id = $1",
            uuid.UUID(artist_id),
        )
    except (ValueError, Exception):
        pass

    if not results and not user_row:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    stats = results[0] if results else {}
    return {
        "id": artist_id,
        "name": user_row["nickname"] if user_row else stats.get("nickname", ""),
        "image": user_row["profile_image"] if user_row else None,
        "bio": user_row["bio"] if user_row else None,
        "track_count": stats.get("track_count", 0),
        "total_plays": stats.get("total_plays", 0),
        "total_likes": stats.get("total_likes", 0),
        "created_at": user_row["created_at"].isoformat() if user_row and user_row["created_at"] else None,
    }


@router.get("/{artist_id}/tracks")
async def get_artist_tracks(artist_id: str, limit: int = 20):
    """Get tracks by a specific creator."""
    mongo = get_mongo()
    cursor = mongo.tracks.find({"uploader_id": artist_id, "is_public": True}).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return [_serialize_track(t) for t in tracks]
