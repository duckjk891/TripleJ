"""
Playcount Sync Service

Periodically flushes Redis playcount:buffer:* keys to MongoDB play_count
and updates Redis chart Sorted Sets.

Runs as an APScheduler background job every 60 seconds.
"""

import asyncio
import logging
from datetime import datetime

from bson import ObjectId

from ..database.redis import get_redis
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

SYNC_INTERVAL_SECONDS = 60


async def sync_playcounts():
    """
    Scan all playcount:buffer:* keys in Redis, flush counts to MongoDB,
    and update chart Sorted Sets.
    """
    redis = get_redis()
    mongo = get_mongo()

    if redis is None or mongo is None:
        return

    # Scan for playcount buffer keys
    cursor = 0
    total_synced = 0

    while True:
        cursor, keys = await redis.scan(cursor, match="playcount:buffer:*", count=100)

        for key in keys:
            track_id_str = key.replace("playcount:buffer:", "")
            if not ObjectId.is_valid(track_id_str):
                await redis.delete(key)
                continue

            # Atomically get and delete the count
            count = await redis.getdel(key)
            if not count:
                continue

            count = int(count)
            if count <= 0:
                continue

            # Update MongoDB play_count
            await mongo.tracks.update_one(
                {"_id": ObjectId(track_id_str)},
                {"$inc": {"play_count": count}},
            )

            # Update chart Sorted Sets
            now = datetime.utcnow()
            daily_key = f"chart:daily:{now.strftime('%Y%m%d')}"
            weekly_key = f"chart:weekly:{now.strftime('%Y-W%V')}"
            alltime_key = "chart:alltime"

            pipe = redis.pipeline()
            pipe.zincrby(daily_key, count, track_id_str)
            pipe.zincrby(weekly_key, count, track_id_str)
            pipe.zincrby(alltime_key, count, track_id_str)
            # Ensure TTL is set
            pipe.expire(daily_key, 48 * 3600)
            pipe.expire(weekly_key, 14 * 86400)
            await pipe.execute()

            total_synced += 1

        if cursor == 0:
            break

    if total_synced > 0:
        # Invalidate chart caches
        for chart_type in ("daily", "weekly", "alltime"):
            await redis.delete(f"cache:top100:{chart_type}")
        logger.info(f"Synced playcounts for {total_synced} tracks.")


_task = None


def start_playcount_scheduler():
    """Start playcount sync as a simple asyncio task (no APScheduler).

    Reload-safe: uses a plain asyncio loop instead of APScheduler's
    multiprocessing spawn, which caused CPU spikes under uvicorn --reload.
    """
    global _task
    if _task is not None and not _task.done():
        logger.info("Playcount sync task already running, skipping duplicate start.")
        return _task

    import asyncio

    async def _sync_loop():
        while True:
            try:
                await asyncio.sleep(SYNC_INTERVAL_SECONDS)
                await sync_playcounts()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Playcount sync error: %s", e)

    loop = asyncio.get_event_loop()
    _task = loop.create_task(_sync_loop())
    logger.info(f"Playcount sync task started (interval: {SYNC_INTERVAL_SECONDS}s).")
    return _task
