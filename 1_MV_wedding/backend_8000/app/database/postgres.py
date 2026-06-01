"""
PostgreSQL async connection using asyncpg directly.
"""

import logging
import asyncpg
from typing import AsyncGenerator, Optional

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def init_postgres(dsn: str) -> None:
    """Initialize the asyncpg connection pool and run idempotent migrations."""
    global _pool
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=20)

    # v11 — idempotent migration: ensure users.role column exists.
    try:
        async with _pool.acquire() as conn:
            await conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'"
            )
        logger.info("[Postgres] migration ok — users.role column ensured (default 'user')")
    except Exception as e:
        logger.error(
            "[Postgres] migration failed — users.role ALTER TABLE: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )


def get_pool() -> Optional[asyncpg.Pool]:
    """Return the asyncpg pool (or None if not yet initialized)."""
    return _pool


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
