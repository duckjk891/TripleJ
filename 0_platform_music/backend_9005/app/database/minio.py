"""
MinIO S3-compatible object storage client.
"""

from typing import Optional
from minio import Minio

minio_client: Optional[Minio] = None
_public_minio_client: Optional[Minio] = None
_public_minio_endpoint: str = ""


def init_minio(endpoint: str, access_key: str, secret_key: str) -> None:
    """Initialize the MinIO client and ensure buckets exist."""
    global minio_client
    minio_client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=False)


def get_minio() -> Minio:
    """FastAPI dependency: returns the MinIO client instance."""
    return minio_client


def get_public_minio(endpoint: str, access_key: str, secret_key: str, secure: bool = False) -> Minio:
    """v76.2: presign 전용. 외부 접근 가능한 endpoint(host:port) 로 만든 별도 클라이언트.
    SigV4 서명에 host 가 포함되므로 내부 클라이언트(내부 host)로 만든 presign 은 외부에서 403.
    내부용/외부용 두 클라이언트를 분리해서 각 용도별 host 로 서명한 URL 을 만든다.
    같은 endpoint 면 이미 만들어진 인스턴스 재사용 (캐싱).
    """
    global _public_minio_client, _public_minio_endpoint
    if _public_minio_client is None or _public_minio_endpoint != endpoint:
        _public_minio_client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        _public_minio_endpoint = endpoint
    return _public_minio_client
