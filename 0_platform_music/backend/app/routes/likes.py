import math
import uuid
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/likes")


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


@router.get("/check")
async def check_likes(song_ids: str = Query(""), current_user=Depends(get_current_user), conn=Depends(get_pg)):
    # Parse track IDs (support both old integer IDs and new ObjectId strings)
    ids = [s.strip() for s in song_ids.split(",") if s.strip()]
    if not ids:
        return {"liked_ids": []}

    user_id = uuid.UUID(current_user["id"])
    rows = await conn.fetch(
        "SELECT track_id FROM likes WHERE user_id = $1 AND track_id = ANY($2::varchar[])",
        user_id, ids,
    )

    return {"liked_ids": [r["track_id"] for r in rows]}


@router.get("/")
async def list_likes(page: int = 1, limit: int = 20, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    offset = (page - 1) * limit

    rows = await conn.fetch(
        "SELECT track_id, created_at FROM likes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        user_id, limit, offset,
    )

    total_row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM likes WHERE user_id = $1", user_id)
    total = total_row["cnt"]

    # Cross-query MongoDB for track details
    track_ids = [ObjectId(r["track_id"]) for r in rows if ObjectId.is_valid(r["track_id"])]
    likes_list = []

    if track_ids:
        mongo = get_mongo()
        docs = await mongo.tracks.find({"_id": {"$in": track_ids}}).to_list(length=len(track_ids))
        docs_map = {str(d["_id"]): d for d in docs}

        for r in rows:
            doc = docs_map.get(r["track_id"])
            if doc:
                t = _serialize_track(doc)
                t["liked_at"] = r["created_at"].isoformat() if r["created_at"] else None
                likes_list.append(t)

    return {
        "likes": likes_list,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/{track_id}", status_code=201)
async def like_track(track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    # Verify track exists in MongoDB
    mongo = get_mongo()
    track = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not track:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    user_id = uuid.UUID(current_user["id"])

    # Check if already liked
    existing = await conn.fetchrow(
        "SELECT user_id FROM likes WHERE user_id = $1 AND track_id = $2",
        user_id, track_id,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 좋아요한 트랙입니다."})

    # Insert like in PostgreSQL
    await conn.execute(
        "INSERT INTO likes (user_id, track_id) VALUES ($1, $2)",
        user_id, track_id,
    )

    # Increment like_count in MongoDB
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"like_count": 1}},
    )

    return {"message": "좋아요가 추가되었습니다."}


@router.delete("/{track_id}")
async def unlike_track(track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])

    result = await conn.execute(
        "DELETE FROM likes WHERE user_id = $1 AND track_id = $2",
        user_id, track_id,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "좋아요하지 않은 트랙입니다."})

    # Decrement like_count in MongoDB
    if ObjectId.is_valid(track_id):
        mongo = get_mongo()
        await mongo.tracks.update_one(
            {"_id": ObjectId(track_id), "like_count": {"$gt": 0}},
            {"$inc": {"like_count": -1}},
        )

    return {"message": "좋아요가 취소되었습니다."}
