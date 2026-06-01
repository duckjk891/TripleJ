import json
import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..database.minio import get_minio

router = APIRouter(prefix="/api/admin")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class RoleUpdate(BaseModel):
    role: str


class BanUpdate(BaseModel):
    is_banned: bool
    reason: Optional[str] = None


class VisibilityUpdate(BaseModel):
    is_public: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


async def _log_admin_action(
    conn,
    admin_id: str,
    action: str,
    target_type: str,
    target_id: str,
    details: Optional[dict] = None,
):
    await conn.execute(
        """INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
           VALUES ($1, $2, $3, $4, $5)""",
        uuid.UUID(admin_id),
        action,
        target_type,
        target_id,
        json.dumps(details) if details else None,
    )


# ---------------------------------------------------------------------------
# 1. GET /dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def dashboard(current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    mongo = get_mongo()

    # PG counts
    total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_signups = await conn.fetchval(
        "SELECT COUNT(*) FROM users WHERE created_at >= $1", today_start
    )

    # Mongo counts
    total_tracks = await mongo.tracks.count_documents({})

    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$play_count"}}}]
    agg = await mongo.tracks.aggregate(pipeline).to_list(length=1)
    total_plays = agg[0]["total"] if agg else 0

    # Recent tracks (last 5)
    cursor = mongo.tracks.find().sort("created_at", -1).limit(5)
    recent_tracks_raw = await cursor.to_list(length=5)
    recent_tracks = [_serialize_track(t) for t in recent_tracks_raw]

    # Recent users (last 5)
    rows = await conn.fetch(
        "SELECT id, email, nickname, role, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT 5"
    )
    recent_users = [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "nickname": r["nickname"],
            "role": r["role"] or "user",
            "is_banned": r["is_banned"] or False,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    return {
        "total_users": total_users,
        "total_tracks": total_tracks,
        "total_plays": total_plays,
        "today_signups": today_signups,
        "recent_tracks": recent_tracks,
        "recent_users": recent_users,
    }


# ---------------------------------------------------------------------------
# 2. GET /users
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    banned: Optional[bool] = Query(None),
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    conditions = []
    params = []
    idx = 1

    if search:
        conditions.append(f"(email ILIKE ${idx} OR nickname ILIKE ${idx})")
        params.append(f"%{search}%")
        idx += 1

    if role:
        conditions.append(f"role = ${idx}")
        params.append(role)
        idx += 1

    if banned is not None:
        conditions.append(f"is_banned = ${idx}")
        params.append(banned)
        idx += 1

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    total = await conn.fetchval(f"SELECT COUNT(*) FROM users{where}", *params)

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"SELECT id, email, nickname, profile_image, role, is_banned, ban_reason, created_at "
        f"FROM users{where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}",
        *params, limit, offset,
    )

    users = [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "nickname": r["nickname"],
            "profile_image": r["profile_image"],
            "role": r["role"] or "user",
            "is_banned": r["is_banned"] or False,
            "ban_reason": r["ban_reason"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    return {
        "users": users,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------------------
# 3. GET /users/{user_id}
# ---------------------------------------------------------------------------

@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    row = await conn.fetchrow(
        "SELECT id, email, nickname, profile_image, bio, plan, role, is_banned, banned_at, ban_reason, created_at "
        "FROM users WHERE id = $1",
        uid,
    )
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    mongo = get_mongo()
    pipeline = [
        {"$match": {"uploader_id": user_id}},
        {"$group": {"_id": None, "track_count": {"$sum": 1}, "total_plays": {"$sum": "$play_count"}}},
    ]
    agg = await mongo.tracks.aggregate(pipeline).to_list(length=1)
    track_count = agg[0]["track_count"] if agg else 0
    total_plays = agg[0]["total_plays"] if agg else 0

    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "plan": row["plan"],
        "role": row["role"] or "user",
        "is_banned": row["is_banned"] or False,
        "banned_at": row["banned_at"].isoformat() if row["banned_at"] else None,
        "ban_reason": row["ban_reason"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "track_count": track_count,
        "total_plays": total_plays,
    }


# ---------------------------------------------------------------------------
# 4. PUT /users/{user_id}/role
# ---------------------------------------------------------------------------

@router.put("/users/{user_id}/role")
async def change_user_role(
    user_id: str,
    body: RoleUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if body.role not in ("user", "customer", "admin"):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 역할입니다. (user, customer, admin)"})

    if user_id == current_admin["id"]:
        return JSONResponse(status_code=400, content={"error": "자신의 역할은 변경할 수 없습니다."})

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    result = await conn.execute(
        "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2",
        body.role, uid,
    )
    if result == "UPDATE 0":
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    await _log_admin_action(conn, current_admin["id"], "change_role", "user", user_id, {"role": body.role})

    return {"message": "역할이 변경되었습니다.", "user_id": user_id, "role": body.role}


# ---------------------------------------------------------------------------
# 5. PUT /users/{user_id}/ban
# ---------------------------------------------------------------------------

@router.put("/users/{user_id}/ban")
async def ban_user(
    user_id: str,
    body: BanUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if user_id == current_admin["id"]:
        return JSONResponse(status_code=400, content={"error": "자신을 정지할 수 없습니다."})

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    if body.is_banned:
        result = await conn.execute(
            "UPDATE users SET is_banned = TRUE, banned_at = NOW(), ban_reason = $1, updated_at = NOW() WHERE id = $2",
            body.reason, uid,
        )
    else:
        result = await conn.execute(
            "UPDATE users SET is_banned = FALSE, banned_at = NULL, ban_reason = NULL, updated_at = NOW() WHERE id = $1",
            uid,
        )

    if result == "UPDATE 0":
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    # Delete Redis session on ban
    if body.is_banned:
        redis = get_redis()
        await redis.delete(f"session:{user_id}")

    action = "ban_user" if body.is_banned else "unban_user"
    await _log_admin_action(conn, current_admin["id"], action, "user", user_id, {"reason": body.reason})

    msg = "사용자가 정지되었습니다." if body.is_banned else "사용자 정지가 해제되었습니다."
    return {"message": msg, "user_id": user_id, "is_banned": body.is_banned}


# ---------------------------------------------------------------------------
# 6. GET /tracks
# ---------------------------------------------------------------------------

@router.get("/tracks")
async def list_tracks(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = Query(None),
    is_public: Optional[bool] = Query(None),
    current_admin=Depends(get_admin_user),
):
    mongo = get_mongo()
    query = {}

    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"uploader_nickname": {"$regex": search, "$options": "i"}},
        ]

    if is_public is not None:
        query["is_public"] = is_public

    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)

    return {
        "tracks": [_serialize_track(t) for t in tracks],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------------------
# 7. DELETE /tracks/{track_id}
# ---------------------------------------------------------------------------

@router.delete("/tracks/{track_id}")
async def delete_track(
    track_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # Remove from MinIO
    audio_url = doc.get("audio_url")
    if audio_url:
        try:
            minio_client = get_minio()
            minio_client.remove_object(settings.minio_bucket_music, audio_url)
        except Exception:
            pass  # Continue even if MinIO removal fails

    # Remove from MongoDB
    await mongo.tracks.delete_one({"_id": ObjectId(track_id)})

    # Clear cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    await _log_admin_action(
        conn, current_admin["id"], "delete_track", "track", track_id,
        {"title": doc.get("title"), "uploader_id": doc.get("uploader_id")},
    )

    return {"message": "트랙이 삭제되었습니다.", "track_id": track_id}


# ---------------------------------------------------------------------------
# 8. PUT /tracks/{track_id}/visibility
# ---------------------------------------------------------------------------

@router.put("/tracks/{track_id}/visibility")
async def toggle_visibility(
    track_id: str,
    body: VisibilityUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    result = await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": {"is_public": body.is_public, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # Clear cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")

    await _log_admin_action(
        conn, current_admin["id"], "change_visibility", "track", track_id,
        {"is_public": body.is_public},
    )

    msg = "트랙이 공개되었습니다." if body.is_public else "트랙이 비공개되었습니다."
    return {"message": msg, "track_id": track_id, "is_public": body.is_public}


# ---------------------------------------------------------------------------
# 9. GET /logs
# ---------------------------------------------------------------------------

@router.get("/logs")
async def list_admin_logs(
    page: int = 1,
    limit: int = 20,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    total = await conn.fetchval("SELECT COUNT(*) FROM admin_logs")
    offset = (page - 1) * limit

    rows = await conn.fetch(
        """SELECT al.id, al.admin_id, u.nickname AS admin_nickname, al.action,
                  al.target_type, al.target_id, al.details, al.created_at
           FROM admin_logs al
           JOIN users u ON u.id = al.admin_id
           ORDER BY al.created_at DESC
           LIMIT $1 OFFSET $2""",
        limit, offset,
    )

    logs = [
        {
            "id": str(r["id"]),
            "admin_id": str(r["admin_id"]),
            "admin_nickname": r["admin_nickname"],
            "action": r["action"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "details": json.loads(r["details"]) if r["details"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    return {
        "logs": logs,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }
