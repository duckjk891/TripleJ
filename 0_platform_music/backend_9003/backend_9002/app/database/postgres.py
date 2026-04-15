"""
PostgreSQL async connection using asyncpg directly.
"""

import asyncpg
from typing import AsyncGenerator, Optional

_pool: Optional[asyncpg.Pool] = None


async def init_postgres(dsn: str) -> None:
    """Initialize the asyncpg connection pool."""
    global _pool
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=20)


async def get_pg() -> AsyncGenerator[asyncpg.Connection, None]:
    """FastAPI dependency: yields an asyncpg connection from the pool."""
    async with _pool.acquire() as conn:
        yield conn


async def close_postgres() -> None:
    """Close the connection pool on shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
