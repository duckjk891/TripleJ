"""
MongoDB async connection using motor.
"""

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING


logger = logging.getLogger(__name__)


client: Optional[AsyncIOMotorClient] = None
db: Optional[AsyncIOMotorDatabase] = None


async def init_mongodb(uri: str, db_name: str) -> None:
    """Initialize the motor client and database reference."""
    global client, db
    client = AsyncIOMotorClient(uri)
    db = client[db_name]


def get_mongo() -> AsyncIOMotorDatabase:
    """FastAPI dependency: returns the MongoDB database instance."""
    return db


async def close_mongodb() -> None:
    """Close the motor client on shutdown."""
    global client, db
    if client:
        client.close()
        client = None
        db = None


async def ensure_indexes() -> None:
    """startup 시 호출. 멱등 인덱스 ensure.

    v17.0 — `pre_mv_jobs` 컬렉션 인덱스 추가:
      - `mv_job_id` (단일)
      - `(user_id, status)` (복합)
      - `created_at desc` (정렬용)

    v23.0 — Extra Video Studio 컬렉션 인덱스 추가:
      - `extra_scene_images`: (mv_job_id, created_at desc), (user_id, created_at desc)
      - `extra_videos`: (mv_job_id, created_at desc), (user_id, created_at desc),
                        chain_root_video_id, parent_video_id
    """
    if db is None:
        logger.warning("[Startup] ensure_indexes skipped (db not initialized)")
        return

    try:
        coll = db["pre_mv_jobs"]
        # v17.0 — PLAN 변경 매트릭스 #0.5
        await coll.create_index([("mv_job_id", ASCENDING)], name="pre_mv_jobs_mv_job_id")
        await coll.create_index(
            [("user_id", ASCENDING), ("status", ASCENDING)],
            name="pre_mv_jobs_user_status",
        )
        await coll.create_index(
            [("created_at", DESCENDING)],
            name="pre_mv_jobs_created_at_desc",
        )
        logger.info("[Startup] pre_mv_jobs indexes ensured")
    except Exception as e:
        logger.warning(
            "[Startup] ensure_indexes failed (pre_mv_jobs): %s: %s",
            type(e).__name__,
            str(e)[:200],
        )

    # v23.0 — extra_scene_images
    try:
        coll = db["extra_scene_images"]
        await coll.create_index(
            [("mv_job_id", ASCENDING), ("created_at", DESCENDING)],
            name="extra_scene_images_mv_job_created_desc",
        )
        await coll.create_index(
            [("user_id", ASCENDING), ("created_at", DESCENDING)],
            name="extra_scene_images_user_created_desc",
        )
        logger.info("[Startup] extra_scene_images indexes ensured")
    except Exception as e:
        logger.warning(
            "[Startup] ensure_indexes failed (extra_scene_images): %s: %s",
            type(e).__name__,
            str(e)[:200],
        )

    # v23.0 — extra_videos
    try:
        coll = db["extra_videos"]
        await coll.create_index(
            [("mv_job_id", ASCENDING), ("created_at", DESCENDING)],
            name="extra_videos_mv_job_created_desc",
        )
        await coll.create_index(
            [("user_id", ASCENDING), ("created_at", DESCENDING)],
            name="extra_videos_user_created_desc",
        )
        await coll.create_index(
            [("chain_root_video_id", ASCENDING)],
            name="extra_videos_chain_root",
        )
        await coll.create_index(
            [("parent_video_id", ASCENDING)],
            name="extra_videos_parent",
        )
        logger.info("[Startup] extra_videos indexes ensured")
    except Exception as e:
        logger.warning(
            "[Startup] ensure_indexes failed (extra_videos): %s: %s",
            type(e).__name__,
            str(e)[:200],
        )

    # v33 — mv_drafts (user 1명당 1개 draft 보관용)
    try:
        coll = db["mv_drafts"]
        await coll.create_index(
            [("user_id", ASCENDING)],
            name="mv_drafts_user_unique",
            unique=True,
        )
        logger.info("[Startup] mv_drafts indexes ensured")
    except Exception as e:
        logger.warning(
            "[Startup] ensure_indexes failed (mv_drafts): %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
