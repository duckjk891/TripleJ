"""
Music Platform - Database Connection Module (v2.0)

Provides connection managers for:
- PostgreSQL (asyncpg + SQLAlchemy async)
- MongoDB (motor)
- Redis (redis.asyncio)
- Elasticsearch (elasticsearch async) -- 2단계
- MinIO (minio-py)
"""

from .postgres import init_postgres, get_pg, close_postgres
from .mongodb import init_mongodb, get_mongo, close_mongodb
from .redis import init_redis, get_redis, close_redis
from .minio import init_minio, get_minio

__all__ = [
    "init_postgres", "get_pg", "close_postgres",
    "init_mongodb", "get_mongo", "close_mongodb",
    "init_redis", "get_redis", "close_redis",
    "init_minio", "get_minio",
]
