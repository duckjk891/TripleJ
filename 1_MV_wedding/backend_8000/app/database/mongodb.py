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
            "[Startup] ensure_indexes failed: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
