import logging
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user, get_current_user_optional
from ..database.postgres import get_pg
from ..services.official import get_official_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/follows")


@router.get("/summary/{user_id}")
async def follow_summary(
    user_id: str,
    current_user=Depends(get_current_user_optional),
    conn=Depends(get_pg),
):
    """공개 팔로우 요약 (무인증 접근 가능).

    follower_count 는 항상 반환, is_following 은 유효 토큰이 있을 때만 판정(없으면 false).
    """
    logger.info(
        "[follows] summary enter target=%s viewer=%s",
        user_id[:8], str(current_user["id"])[:8] if current_user else "anon",
    )

    try:
        target_uuid = uuid.UUID(user_id)
    except ValueError:
        logger.warning("[follows] summary invalid target id target=%s", user_id[:8])
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    target = await conn.fetchrow("SELECT id FROM users WHERE id = $1", target_uuid)
    if not target:
        logger.warning("[follows] summary target not found target=%s", user_id[:8])
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    follower_count = await conn.fetchval(
        "SELECT COUNT(*) FROM follows WHERE followee_id = $1", target_uuid
    )

    is_following = False
    if current_user:
        try:
            viewer_uuid = uuid.UUID(current_user["id"])
        except (ValueError, KeyError, TypeError):
            viewer_uuid = None
        if viewer_uuid and viewer_uuid != target_uuid:
            row = await conn.fetchrow(
                "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2",
                viewer_uuid, target_uuid,
            )
            is_following = row is not None

    logger.info(
        "[follows] summary done target=%s follower_count=%d is_following=%s",
        user_id[:8], follower_count, is_following,
    )
    return {"follower_count": follower_count, "is_following": is_following}


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

    # OfficialSquad — maidol_official 공식 계정은 언팔 불가 (CS 문의 채널 유지)
    official_id = await get_official_id(conn)
    if official_id and str(followee_uuid) == official_id:
        logger.warning("[follows] official unfollow blocked user=%s", str(follower_uuid)[:8])
        return JSONResponse(status_code=403, content={"error": "공식 계정은 언팔로우할 수 없습니다."})

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
