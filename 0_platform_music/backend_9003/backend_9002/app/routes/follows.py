import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/follows")


@router.post("/{user_id}", status_code=201)
async def follow_user(user_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        followee_uuid = uuid.UUID(user_id)
        follower_uuid = uuid.UUID(current_user["id"])
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    if follower_uuid == followee_uuid:
        return JSONResponse(status_code=400, content={"error": "자기 자신을 팔로우할 수 없습니다."})

    # Check if target user exists
    target = await conn.fetchrow("SELECT id FROM users WHERE id = $1", followee_uuid)
    if not target:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    # Check if already following
    existing = await conn.fetchrow(
        "SELECT follower_id FROM follows WHERE follower_id = $1 AND followee_id = $2",
        follower_uuid, followee_uuid,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 팔로우 중입니다."})

    await conn.execute(
        "INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)",
        follower_uuid, followee_uuid,
    )

    return {"message": "팔로우했습니다."}


@router.delete("/{user_id}")
async def unfollow_user(user_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        followee_uuid = uuid.UUID(user_id)
        follower_uuid = uuid.UUID(current_user["id"])
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    result = await conn.execute(
        "DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2",
        follower_uuid, followee_uuid,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "팔로우하지 않은 사용자입니다."})

    return {"message": "언팔로우했습니다."}


@router.get("/followers")
async def get_followers(page: int = 1, limit: int = 20, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    offset = (page - 1) * limit

    rows = await conn.fetch("""
        SELECT u.id, u.nickname, u.profile_image, f.created_at as followed_at
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.followee_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3
    """, user_id, limit, offset)

    total = await conn.fetchval("SELECT COUNT(*) FROM follows WHERE followee_id = $1", user_id)

    return {
        "followers": [
            {
                "id": str(r["id"]),
                "nickname": r["nickname"],
                "profile_image": r["profile_image"],
                "followed_at": r["followed_at"].isoformat() if r["followed_at"] else None,
            }
            for r in rows
        ],
        "total": total,
    }


@router.get("/following")
async def get_following(page: int = 1, limit: int = 20, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    offset = (page - 1) * limit

    rows = await conn.fetch("""
        SELECT u.id, u.nickname, u.profile_image, f.created_at as followed_at
        FROM follows f
        JOIN users u ON f.followee_id = u.id
        WHERE f.follower_id = $1
        ORDER BY f.created_at DESC
        LIMIT $2 OFFSET $3
    """, user_id, limit, offset)

    total = await conn.fetchval("SELECT COUNT(*) FROM follows WHERE follower_id = $1", user_id)

    return {
        "following": [
            {
                "id": str(r["id"]),
                "nickname": r["nickname"],
                "profile_image": r["profile_image"],
                "followed_at": r["followed_at"].isoformat() if r["followed_at"] else None,
            }
            for r in rows
        ],
        "total": total,
    }
