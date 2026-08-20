"""
Elasticsearch async connection (2단계).
"""

from typing import Optional
from elasticsearch import AsyncElasticsearch

from ..config import settings

es_client: Optional[AsyncElasticsearch] = None


async def init_elasticsearch(url: str) -> None:
    """Initialize the async Elasticsearch client.

    v189: ES 인증(xpack.security) 활성 — `settings.es_basic_auth` 가 None 이면
    미전달(기존 동작), 설정돼 있으면 basic auth 로 접속한다(URL 크리덴셜 금지).
    """
    global es_client
    es_client = AsyncElasticsearch(
        hosts=[url], request_timeout=30, basic_auth=settings.es_basic_auth
    )


def get_es() -> AsyncElasticsearch:
    """FastAPI dependency: returns the Elasticsearch client instance."""
    return es_client


async def close_elasticsearch() -> None:
    """Close the Elasticsearch client on shutdown."""
    global es_client
    if es_client:
        await es_client.close()
        es_client = None
