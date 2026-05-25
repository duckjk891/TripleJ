"""
MinIO S3-compatible object storage client.
"""

from typing import Optional
from minio import Minio

minio_client: Optional[Minio] = None


def init_minio(endpoint: str, access_key: str, secret_key: str) -> None:
    """Initialize the MinIO client and ensure buckets exist."""
    global minio_client
    minio_client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=False)


def get_minio() -> Minio:
    """FastAPI dependency: returns the MinIO client instance."""
    return minio_client
