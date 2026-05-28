"""
v11 — Admin-only routes. Prefix /api/admin. 모든 엔드포인트는 get_current_admin 의존성.

엔드포인트:
- GET    /jobs                       모든 MV jobs + 사용자 email/nickname 조인.
- GET    /users                      사용자 전체 목록 (role 포함).
- PATCH  /users/{user_id}/role       사용자 role 변경 (user|admin).

로그 prefix [AdminRoute]. 추적자: 호출자 user_id, target_user_id, new_role.
"""

import json
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_admin
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from .mv import _serialize_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin")


class RoleUpdate(BaseModel):
    role: Literal["user", "admin"]


def _serialize_user(row) -> dict:
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "role": row["role"] or "user",
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


@router.get("/jobs")
async def list_all_jobs(
    current_user=Depends(get_current_admin),
    conn=Depends(get_pg),
):
    """v12: admin_requested=True 인 MV jobs 만 노출 + users 조인 (email/nickname)."""
    admin_id = current_user.get("id")
    logger.info("[AdminRoute] GET /jobs entry admin_id=%s", admin_id)

    mongo = get_mongo()
    try:
        cursor = mongo.mv_jobs.find({"admin_requested": True}).sort("admin_requested_at", -1)
        jobs = [_serialize_job(d) async for d in cursor]
    except Exception as e:
        logger.error(
            "[AdminRoute] GET /jobs mongo find failed: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="작업 목록을 불러오지 못했습니다.")

    # 유저 정보 한 번에 fetch — user_id 가 UUID 문자열로 들어있다고 가정.
    user_ids_raw = {j.get("user_id") for j in jobs if j.get("user_id")}
    user_map: dict[str, dict] = {}
    if user_ids_raw:
        # asyncpg 는 UUID 객체를 기대하므로 변환 시도. 변환 실패는 skip.
        uuid_list = []
        for uid in user_ids_raw:
            try:
                uuid_list.append(uuid.UUID(str(uid)))
            except (ValueError, TypeError, AttributeError):
                logger.warning("[AdminRoute] GET /jobs invalid user_id skipped: %r", uid)
                continue

        if uuid_list:
            try:
                rows = await conn.fetch(
                    "SELECT id, email, nickname FROM users WHERE id = ANY($1::uuid[])",
                    uuid_list,
                )
                for r in rows:
                    user_map[str(r["id"])] = {
                        "email": r["email"],
                        "nickname": r["nickname"],
                    }
            except Exception as e:
                logger.error(
                    "[AdminRoute] GET /jobs users fetch failed: %s: %s",
                    type(e).__name__,
                    str(e)[:200],
                )

    enriched = []
    for j in jobs:
        uid_str = str(j.get("user_id")) if j.get("user_id") is not None else None
        info = user_map.get(uid_str, {})
        enriched.append({
            **j,
            "user_email": info.get("email"),
            "user_nickname": info.get("nickname"),
        })

    logger.info(
        "[AdminRoute] GET /jobs ok admin_id=%s count=%d count_users=%d",
        admin_id,
        len(enriched),
        len(user_map),
    )
    return {"jobs": enriched}


@router.get("/users")
async def list_users(
    current_user=Depends(get_current_admin),
    conn=Depends(get_pg),
):
    """전체 사용자 목록 (role 포함)."""
    admin_id = current_user.get("id")
    logger.info("[AdminRoute] GET /users entry admin_id=%s", admin_id)

    try:
        rows = await conn.fetch(
            """SELECT id, email, nickname, profile_image, role, created_at, updated_at
               FROM users
               ORDER BY created_at ASC NULLS LAST"""
        )
    except Exception as e:
        logger.error(
            "[AdminRoute] GET /users fetch failed: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="사용자 목록을 불러오지 못했습니다.")

    users = [_serialize_user(r) for r in rows]
    logger.info("[AdminRoute] GET /users ok admin_id=%s count=%d", admin_id, len(users))
    return {"users": users}


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdate,
    current_user=Depends(get_current_admin),
    conn=Depends(get_pg),
):
    """사용자 role 변경. 본인/admin 시드 강등 차단."""
    admin_id = current_user.get("id")
    new_role = body.role
    logger.info(
        "[AdminRoute] PATCH /users/{user_id}/role entry admin_id=%s target_user_id=%s new_role=%s",
        admin_id,
        user_id,
        new_role,
    )

    # 본인 자신 변경 차단.
    if str(admin_id) == str(user_id):
        logger.warning(
            "[AdminRoute] PATCH /role reject self-change admin_id=%s target_user_id=%s",
            admin_id,
            user_id,
        )
        raise HTTPException(status_code=409, detail="본인 자신의 등급은 변경할 수 없습니다.")

    try:
        target_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        logger.warning("[AdminRoute] PATCH /role invalid user_id=%s", user_id)
        raise HTTPException(status_code=400, detail="유효하지 않은 사용자 ID 입니다.")

    target = await conn.fetchrow(
        "SELECT id, email, role FROM users WHERE id = $1",
        target_uuid,
    )
    if not target:
        logger.warning("[AdminRoute] PATCH /role target not found user_id=%s", user_id)
        raise HTTPException(status_code=404, detail="대상 사용자를 찾을 수 없습니다.")

    # admin 시드 계정 강등 차단.
    if target["email"] == "admin" and new_role == "user":
        logger.warning(
            "[AdminRoute] PATCH /role reject seed-demotion admin_id=%s target_user_id=%s",
            admin_id,
            user_id,
        )
        raise HTTPException(status_code=409, detail="관리자 시드 계정은 강등할 수 없습니다.")

    try:
        row = await conn.fetchrow(
            """UPDATE users
               SET role = $1, updated_at = now()
               WHERE id = $2
               RETURNING id, email, nickname, profile_image, role, created_at, updated_at""",
            new_role,
            target_uuid,
        )
    except Exception as e:
        logger.error(
            "[AdminRoute] PATCH /role update failed admin_id=%s target_user_id=%s: %s: %s",
            admin_id,
            user_id,
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="등급 변경에 실패했습니다.")

    # Redis 세션이 살아있다면 role 키 즉시 갱신.
    try:
        redis = get_redis()
        key = f"session:{user_id}"
        session_data = await redis.get(key)
        if session_data:
            session = json.loads(session_data)
            session["role"] = new_role
            ttl = await redis.ttl(key)
            ttl = ttl if (ttl and ttl > 0) else 7 * 24 * 3600
            await redis.setex(key, ttl, json.dumps(session))
            logger.info(
                "[AdminRoute] PATCH /role session refreshed target_user_id=%s new_role=%s",
                user_id,
                new_role,
            )
        else:
            logger.info(
                "[AdminRoute] PATCH /role no live session target_user_id=%s (will pick up on next login)",
                user_id,
            )
    except Exception as e:
        logger.error(
            "[AdminRoute] PATCH /role redis session refresh failed user_id=%s: %s: %s",
            user_id,
            type(e).__name__,
            str(e)[:200],
        )

    updated = _serialize_user(row)
    logger.info(
        "[AdminRoute] PATCH /role ok admin_id=%s target_user_id=%s new_role=%s",
        admin_id,
        user_id,
        new_role,
    )
    return updated
