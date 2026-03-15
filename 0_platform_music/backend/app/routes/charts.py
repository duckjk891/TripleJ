import json
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..database.redis import get_redis
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/charts")


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    # Add aliases for frontend compatibility
    doc["artist_name"] = doc.get("uploader_nickname", "AI")
    doc["cover_image"] = doc.get("cover_image_url")
    return doc


@router.get("/top100")
async def top100(chart_type: str = "daily"):
    if chart_type not in ("daily", "weekly", "alltime"):
        return JSONResponse(status_code=400, content={"error": "chart_type은 daily, weekly, alltime 중 하나여야 합니다."})

    redis = get_redis()
    mongo = get_mongo()

    # Check cache first
    cache_key = f"cache:top100:{chart_type}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Determine Redis Sorted Set key
    now = datetime.utcnow()
    if chart_type == "daily":
        chart_key = f"chart:daily:{now.strftime('%Y%m%d')}"
    elif chart_type == "weekly":
        chart_key = f"chart:weekly:{now.strftime('%Y-W%V')}"
    else:
        chart_key = "chart:alltime"

    # Get top 100 from Redis Sorted Set (highest score first)
    top_entries = await redis.zrevrange(chart_key, 0, 99, withscores=True)

    if not top_entries:
        # Fallback: query MongoDB directly by play_count
        cursor = mongo.tracks.find({"is_public": True}).sort("play_count", -1).limit(100)
        tracks = await cursor.to_list(length=100)
        result = []
        for rank, track in enumerate(tracks, 1):
            t = _serialize_track(track)
            t["rank"] = rank
            t["chart_type"] = chart_type
            result.append(t)

        ttl = 300 if chart_type == "daily" else 600
        await redis.setex(cache_key, ttl, json.dumps(result, default=str))
        return result

    # Batch fetch track details from MongoDB
    track_ids = [ObjectId(tid) for tid, score in top_entries]
    docs = await mongo.tracks.find({"_id": {"$in": track_ids}}).to_list(length=100)
    docs_map = {str(d["_id"]): d for d in docs}

    result = []
    for rank, (tid, score) in enumerate(top_entries, 1):
        doc = docs_map.get(tid)
        if doc:
            t = _serialize_track(doc)
            t["rank"] = rank
            t["score"] = score
            t["chart_type"] = chart_type
            result.append(t)

    ttl = 300 if chart_type == "daily" else 600
    await redis.setex(cache_key, ttl, json.dumps(result, default=str))
    return result


@router.get("/genre/{genre}")
async def genre_chart(genre: str, limit: int = 50):
    mongo = get_mongo()
    cursor = mongo.tracks.find({"is_public": True, "genre": genre}).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return [_serialize_track(t) for t in tracks]
