"""HybridSearch backfill: LLM concept-keyword enrichment for all public tracks.

For every public track in MongoDB:
  1. if `search_keywords` is missing/empty (or --force) → LLM-extract concept
     keywords (gpt-4o-mini) and persist to Mongo `search_keywords`
  2. re-embed into pgvector (upsert_track_embedding — content_hash changes because
     build_track_text now folds in search_keywords)
  3. re-index into the ES `tracks` index (es_index_track — carries `keywords`)

Counts ok / skip / err. Refreshes the ES index at the end.

NOTE: ES must already carry the `keywords` mapping. If the index predates this
change, recreate it first so the field is analyzed:
    curl -X DELETE localhost:9200/tracks
then run this script (it re-indexes every track with keywords). Order matters:
keywords are written to Mongo first, then ES is re-indexed from the enriched doc.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/backfill_search_keywords.py
    ./venv/bin/python scripts/backfill_search_keywords.py --force
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import asyncpg
from elasticsearch import AsyncElasticsearch
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.embedding_service import upsert_track_embedding
from app.services.keyword_service import generate_search_keywords
from app.services.search_service import (
    ES_TRACKS_INDEX,
    ensure_tracks_index,
    es_index_track,
)
from app.database.elasticsearch import init_elasticsearch, close_elasticsearch

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s", stream=sys.stdout)
logger = logging.getLogger("backfill_search_keywords")


async def _run(force: bool) -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]
    pg_conn = await asyncpg.connect(settings.postgres_dsn)

    # es_index_track() uses the module-level get_es() client, so init it here.
    await init_elasticsearch(settings.es_url)
    from app.database.elasticsearch import get_es
    es = get_es()
    await ensure_tracks_index(es)

    ok = skip = err = kw_generated = 0
    try:
        cursor = db.tracks.find({"is_public": True})
        async for doc in cursor:
            track_id = str(doc["_id"])
            try:
                existing = doc.get("search_keywords")
                has_kw = isinstance(existing, list) and len(existing) > 0

                if force or not has_kw:
                    keywords = await generate_search_keywords(doc, track_id=track_id)
                    if keywords:
                        await db.tracks.update_one(
                            {"_id": doc["_id"]}, {"$set": {"search_keywords": keywords}}
                        )
                        doc["search_keywords"] = keywords
                        kw_generated += 1
                        logger.info(
                            "[backfill.kw] track_id=%s title=%r n=%d kw=%s",
                            track_id, str(doc.get("title"))[:40], len(keywords), keywords,
                        )
                    else:
                        logger.warning("[backfill.kw] track_id=%s no keywords produced", track_id)
                else:
                    logger.info("[backfill.kw] track_id=%s already has %d keywords, skip-gen", track_id, len(existing))

                # re-embed (content_hash gated; re-embeds when keywords added)
                await upsert_track_embedding(pg_conn, track_id, doc)
                # re-index into ES from the enriched doc
                await es_index_track(doc)
                ok += 1
            except Exception as e:
                err += 1
                logger.error("[backfill.kw] track_id=%s failed: %s", track_id, e)

        try:
            await es.indices.refresh(index=ES_TRACKS_INDEX)
        except Exception as e:
            logger.warning("[backfill.kw] es refresh failed: %s", e)

        es_count = (await es.count(index=ES_TRACKS_INDEX)).get("count")
        pg_rows = await pg_conn.fetchval("SELECT count(*) FROM track_embeddings")
        logger.info(
            "[backfill.kw] done ok=%d skip=%d err=%d kw_generated=%d | es '%s' docs=%s | pg rows=%d",
            ok, skip, err, kw_generated, ES_TRACKS_INDEX, es_count, pg_rows,
        )
    finally:
        await pg_conn.close()
        await close_elasticsearch()
        mongo_client.close()
    return 0 if err == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="regenerate keywords even if already present")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(args.force)))
