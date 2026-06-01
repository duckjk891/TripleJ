"""
Redis async connection using redis.asyncio.
"""

from typing import Optional
import redis.asyncio as aioredis

redis_client: Optional[aioredis.Redis] = None


async def init_redis(url: str) -> None:
    """Initialize the async Redis client."""
    global redis_client
    redis_client = aioredis.from_url(url, decode_responses=True)


def get_redis() -> aioredis.Redis:
    """FastAPI dependency: returns the Redis client instance."""
    return redis_client


async def close_redis() -> None:
    """Close the Redis client on shutdown."""
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None
