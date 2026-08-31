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


async def ping_pg() -> None:
    """v204 readiness(/api/ready) — 풀에서 커넥션을 빌려 SELECT 1.

    get_pg 는 FastAPI 의존성용 제너레이터라 직접 호출이 어색하므로,
    readiness 체크는 이 소함수로 풀 상태를 확인한다. 실패 시 예외 전파.
    """
    async with _pool.acquire() as conn:
        await conn.fetchval("SELECT 1")


async def close_postgres() -> None:
    """Close the connection pool on shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
