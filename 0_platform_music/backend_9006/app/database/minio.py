"""
MinIO S3-compatible object storage client.
"""

from typing import Optional
from minio import Minio

from ..config import settings

minio_client: Optional[Minio] = None
_public_minio_client: Optional[Minio] = None
# v173: 캐시 키를 endpoint 단독 → (endpoint, secure) 튜플로 확장.
# secure 값만 바뀌어도 새 클라이언트를 만들어야 함 (stale 인스턴스 버그 픽스).
# v202: 자격증명 모드("iam" vs access_key)도 키에 포함 — 모드 전환 시 낡은
# 클라이언트 재사용 방지.
_public_minio_key: Optional[tuple] = None


def _credentials_kwargs(access_key, secret_key) -> dict:
    """v202: 자격증명 분기 — access_key 가 빈 값(None/"")이면 EC2 IAM 역할
    (IamAwsProvider) 모드, 아니면 기존 access_key/secret_key (로컬 MinIO 모드,
    동작 무변경). IamAwsProvider 는 IAM 분기에서만 지연 import — 로컬 경로 부담 0."""
    if not access_key:
        from minio.credentials import IamAwsProvider
        return {"credentials": IamAwsProvider()}
    return {"access_key": access_key, "secret_key": secret_key}


def _credentials_mode(access_key) -> str:
    """v202: 캐시 키용 자격증명 모드 식별자."""
    return "iam" if not access_key else access_key


def init_minio(endpoint: str, access_key: str, secret_key: str) -> None:
    """Initialize the MinIO client and ensure buckets exist.

    v202: secure/region 은 settings(MINIO_SECURE/S3_REGION)에서 읽는다 —
    시그니처 무변경(main.py·seed_item_store.py 호출부 그대로). 기본값이
    기본값(secure 꺼짐 · MinIO 기본 리전)이라 로컬 .env 무변경 시 동작 동일.
    """
    global minio_client
    minio_client = Minio(
        endpoint,
        secure=settings.minio_secure,
        region=settings.s3_region,
        **_credentials_kwargs(access_key, secret_key),
    )


def get_minio() -> Minio:
    """FastAPI dependency: returns the MinIO client instance."""
    return minio_client


def get_public_minio(
    endpoint: str,
    access_key: str,
    secret_key: str,
    secure: bool = False,
    region: Optional[str] = None,
) -> Minio:
    """v76.2: presign 전용. 외부 접근 가능한 endpoint(host:port) 로 만든 별도 클라이언트.
    SigV4 서명에 host 가 포함되므로 내부 클라이언트(내부 host)로 만든 presign 은 외부에서 403.
    내부용/외부용 두 클라이언트를 분리해서 각 용도별 host 로 서명한 URL 을 만든다.
    같은 (endpoint, secure, region) 조합이면 이미 만들어진 인스턴스 재사용 (캐싱).

    v173: region 지정 시 presign 전 bucket location 네트워크 조회를 생략한다.
    public endpoint 는 서버 자신에게 도달 불가한 경우가 있어(hairpin NAT) 미지정 시
    presign 이 블로킹될 수 있음 — 호출부에서 "us-east-1"(MinIO 기본) 지정 권장.

    v202: access_key 빈 값이면 IamAwsProvider(EC2 IAM 역할) 자격증명 사용.
    캐시 키에 자격증명 모드 포함 — 모드 전환 시 낡은 클라이언트 재사용 방지.
    """
    global _public_minio_client, _public_minio_key
    key = (endpoint, secure, region, _credentials_mode(access_key))
    if _public_minio_client is None or _public_minio_key != key:
        _public_minio_client = Minio(
            endpoint, secure=secure, region=region,
            **_credentials_kwargs(access_key, secret_key),
        )
        _public_minio_key = key
    return _public_minio_client
