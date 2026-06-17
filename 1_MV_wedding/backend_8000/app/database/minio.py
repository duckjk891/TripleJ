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


# voice-clone(v76): presign 전용 외부 클라이언트
_public_minio_client: Optional[Minio] = None
_public_minio_endpoint: Optional[str] = None


def get_public_minio(endpoint: str, access_key: str, secret_key: str, secure: bool = False) -> Minio:
    """presign 전용. 외부 접근 가능한 endpoint 로 만든 별도 클라이언트 (캐싱)."""
    global _public_minio_client, _public_minio_endpoint
    if _public_minio_client is None or _public_minio_endpoint != endpoint:
        _public_minio_client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        _public_minio_endpoint = endpoint
    return _public_minio_client
