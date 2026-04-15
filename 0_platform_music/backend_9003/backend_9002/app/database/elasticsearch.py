"""
Elasticsearch async connection (2단계).
"""

from typing import Optional
from elasticsearch import AsyncElasticsearch

es_client: Optional[AsyncElasticsearch] = None


async def init_elasticsearch(url: str) -> None:
    """Initialize the async Elasticsearch client."""
    global es_client
    es_client = AsyncElasticsearch(hosts=[url], request_timeout=30)


def get_es() -> AsyncElasticsearch:
    """FastAPI dependency: returns the Elasticsearch client instance."""
    return es_client


async def close_elasticsearch() -> None:
    """Close the Elasticsearch client on shutdown."""
    global es_client
    if es_client:
        await es_client.close()
        es_client = None
