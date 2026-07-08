"""VectorSearch backfill: index all public tracks into track_embeddings (pgvector).

Iterates every public track in MongoDB and runs upsert_track_embedding. The
upsert is content-hash gated, so re-running only re-embeds changed tracks.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/backfill_embeddings.py
"""

import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import asyncpg
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.embedding_service import upsert_track_embedding

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s", stream=sys.stdout)
logger = logging.getLogger("backfill_embeddings")


async def _run() -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]
    pg_conn = await asyncpg.connect(settings.postgres_dsn)

    ok = skip = err = 0
    try:
        cursor = db.tracks.find({"is_public": True})
        async for doc in cursor:
            track_id = str(doc["_id"])
            try:
                wrote = await upsert_track_embedding(pg_conn, track_id, doc)
                if wrote:
                    ok += 1
                else:
                    skip += 1
            except Exception as e:
                err += 1
                logger.error("[backfill] track_id=%s failed: %s", track_id, e)

        total_rows = await pg_conn.fetchval("SELECT count(*) FROM track_embeddings")
        logger.info(
            "[backfill] done ok=%d skip=%d err=%d | track_embeddings rows=%d",
            ok, skip, err, total_rows,
        )
    finally:
        await pg_conn.close()
        mongo_client.close()
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_run()))
