"""
Rebuild Redis chart data from MongoDB play_logs and download_logs.
Called on server startup to recover data lost during Redis restart.
"""

import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))


def _time_keys(now: datetime) -> dict:
    year, week, _ = now.isocalendar()
    return {
        "hourly": now.strftime("%Y%m%d%H"),
        "daily": now.strftime("%Y%m%d"),
        "weekly": f"{year}-W{week:02d}",
        "monthly": now.strftime("%Y%m"),
    }


def _period_start(now: datetime, period: str) -> datetime:
    """Get the start datetime for a given period."""
    if period == "hourly":
        return now.replace(minute=0, second=0, microsecond=0)
    elif period == "daily":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "weekly":
        # Monday 00:00
        days_since_monday = now.weekday()
        monday = now - timedelta(days=days_since_monday)
        return monday.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return now


async def rebuild_redis_from_mongo(mongo, redis):
    """Rebuild all Redis chart sets from MongoDB logs."""
    now = datetime.now(KST)
    keys = _time_keys(now)

    logger.info("Starting Redis chart data recovery from MongoDB...")

    # Define periods and their time boundaries
    periods = {
        "hourly": {"start": _period_start(now, "hourly"), "ttl": 2 * 3600},
        "daily": {"start": _period_start(now, "daily"), "ttl": 2 * 86400},
        "weekly": {"start": _period_start(now, "weekly"), "ttl": 8 * 86400},
        "monthly": {"start": _period_start(now, "monthly"), "ttl": 32 * 86400},
    }

    total_plays = 0
    total_downloads = 0

    for period_name, period_info in periods.items():
        start_time = period_info["start"]
        ttl = period_info["ttl"]
        period_key = keys[period_name]

        # --- Recover play logs ---
        play_cursor = mongo.play_logs.find({"played_at": {"$gte": start_time}})
        play_logs = await play_cursor.to_list(length=None)

        # Group by track_id -> set of user_ids
        play_groups = {}
        for log in play_logs:
            tid = log["track_id"]
            uid = log["user_id"]
            if tid not in play_groups:
                play_groups[tid] = set()
            play_groups[tid].add(uid)

        # Write to Redis
        pipe = redis.pipeline()
        for tid, user_ids in play_groups.items():
            listener_key = f"chart:listeners:{period_name}:{period_key}:{tid}"
            pipe.delete(listener_key)  # Clear existing to avoid stale data
            if user_ids:
                pipe.sadd(listener_key, *user_ids)
                pipe.expire(listener_key, ttl)
            # Track index
            pipe.sadd(f"chart:tracks:{period_name}:{period_key}", tid)

        if play_groups:
            pipe.expire(f"chart:tracks:{period_name}:{period_key}", ttl)

        await pipe.execute()
        total_plays += len(play_logs)

        # --- Recover download logs ---
        dl_cursor = mongo.download_logs.find({"downloaded_at": {"$gte": start_time}})
        dl_logs = await dl_cursor.to_list(length=None)

        dl_groups = {}
        for log in dl_logs:
            tid = log["track_id"]
            uid = log["user_id"]
            if tid not in dl_groups:
                dl_groups[tid] = set()
            dl_groups[tid].add(uid)

        pipe = redis.pipeline()
        for tid, user_ids in dl_groups.items():
            dl_key = f"chart:downloads:{period_name}:{period_key}:{tid}"
            pipe.delete(dl_key)
            if user_ids:
                pipe.sadd(dl_key, *user_ids)
                pipe.expire(dl_key, ttl)
            pipe.sadd(f"chart:dl_tracks:{period_name}:{period_key}", tid)

        if dl_groups:
            pipe.expire(f"chart:dl_tracks:{period_name}:{period_key}", ttl)

        await pipe.execute()
        total_downloads += len(dl_logs)

    # Clear chart cache so fresh data is served
    for ct in ["top100", "hot100", "daily", "weekly", "monthly"]:
        await redis.delete(f"cache:chart:{ct}")

    # Create indexes on MongoDB collections (idempotent)
    await mongo.play_logs.create_index([("played_at", -1)])
    await mongo.play_logs.create_index([("user_id", 1), ("track_id", 1), ("played_at", -1)])
    await mongo.download_logs.create_index([("downloaded_at", -1)])
    await mongo.download_logs.create_index([("user_id", 1), ("track_id", 1), ("downloaded_at", -1)])

    logger.info(f"Redis recovery complete: {total_plays} play logs, {total_downloads} download logs processed")
