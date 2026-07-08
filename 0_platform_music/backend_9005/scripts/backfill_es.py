"""HybridSearch backfill: mirror all public tracks into the ES `tracks` index.

Thin CLI wrapper around app.services.search_service.backfill_es_if_needed(force=True):
ensures the ES `tracks` index (shared nori mapping) and re-upserts every public
track from MongoDB. Self-contained: brings up its own ES + Mongo clients so it can
run even when the API server is down. Idempotent — re-running re-upserts by track_id.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/backfill_es.py
"""

import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from elasticsearch import AsyncElasticsearch
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.search_service import ES_TRACKS_INDEX, backfill_es_if_needed

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s", stream=sys.stdout)
logger = logging.getLogger("backfill_es")


async def _run() -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]
    es = AsyncElasticsearch(hosts=[settings.es_url], request_timeout=30)

    try:
        result = await backfill_es_if_needed(es, db, force=True)
        count = (await es.count(index=ES_TRACKS_INDEX)).get("count")
        logger.info(
            "[backfill.es] done ok=%s reindexed=%d errors=%d | es '%s' docs=%s",
            result.get("ok"), result.get("reindexed", 0), result.get("errors", 0),
            ES_TRACKS_INDEX, count,
        )
    finally:
        await es.close()
        mongo_client.close()
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_run()))
