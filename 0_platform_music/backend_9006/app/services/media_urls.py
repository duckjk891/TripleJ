"""v173: 브라우저/외부 노출 미디어 URL 중앙 헬퍼.

배경 (mixed-content): https 화면에서 내부 host http presigned URL 이 img/video
src 로 내려가면 브라우저가 차단한다. 발급 경로를 이 모듈로 통일해서
.env(MINIO_PUBLIC_HOST/MINIO_PUBLIC_SECURE/MEDIA_URL_MODE)만으로 전환 가능하게 한다.

- public_presign: public 클라이언트(외부 host + secure 설정)로 presign.
  외부 API 서버측 fetch 전달용 + MEDIA_URL_MODE=presign 모드 공용.
  (SigV4 서명에 host/scheme 이 포함되므로 발급 시점에 클라이언트를 교체해야 함 —
  단순 netloc swap 은 서명 불일치 → 403)
- browser_image_url: 브라우저 노출 이미지 전용. mode=proxy 면
  /api/upload/cover-preview/ 상대경로(same-origin → mixed-content 없음),
  mode=presign 이면 public_presign.
- browser_video_url: 브라우저 노출 비디오 전용. 대용량이라 프록시 제외 —
  항상 public_presign.

로그 추적자: `[media-url]` + object_name. 호스트 실값은 debug 레벨에서만 마스킹 출력.
"""

import logging
from datetime import timedelta
from typing import Optional
from urllib.parse import quote

from ..config import settings
from ..database.minio import get_public_minio

logger = logging.getLogger(__name__)

# 브라우저/공개 presign 노출 금지 prefix.
# faces/ = 암호화 얼굴 데이터(백엔드 전용, v135), evidence/ = 신고 증거(어드민 전용, v138).
BLOCKED_PREFIXES = ("faces/", "evidence/")

PRESIGN_EXPIRES = timedelta(hours=24)

# 프록시 모드 상대경로 베이스 (routes/upload.py cover-preview — 무인증, images 버킷 전용).
_PROXY_BASE = "/api/upload/cover-preview/"


def _mask_host(host: str) -> str:
    """호스트 실값 마스킹 (로그용) — 앞 3글자 + 길이만 노출."""
    if not host:
        return "(empty)"
    return f"{host[:3]}***(len={len(host)})"


def _public_endpoint() -> str:
    """public presign endpoint — MINIO_PUBLIC_HOST, 빈 값이면 내부 endpoint 폴백."""
    return (settings.minio_public_host or "").strip() or settings.minio_endpoint


def public_presign(
    object_name: Optional[str],
    bucket: Optional[str] = None,
    expires: timedelta = PRESIGN_EXPIRES,
) -> Optional[str]:
    """public 클라이언트로 presigned GET URL 발급 (기본 images 버킷, 24h).

    외부 API 서버측 fetch 전달용 — 프록시 모드와 무관하게 항상 실제 URL 을 만든다.
    이미 전체 URL 이면 passthrough, 실패 시 None + error 로그.
    """
    if not object_name:
        return None
    if object_name.startswith(("http://", "https://")):
        return object_name
    endpoint = _public_endpoint()
    try:
        client = get_public_minio(
            endpoint=endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_public_secure,
            # region 지정 → bucket location 네트워크 조회 생략 (public host 는
            # 서버 자신에게 도달 불가할 수 있음 — presign 블로킹 방지). MinIO 기본 리전.
            region="us-east-1",
        )
        url = client.presigned_get_object(
            bucket_name=bucket or settings.minio_bucket_images,
            object_name=object_name,
            expires=expires,
        )
        logger.debug(
            "[media-url] presign ok host=%s secure=%s obj=%s",
            _mask_host(endpoint), settings.minio_public_secure, object_name,
        )
        return url
    except Exception as e:
        logger.error(
            "[media-url] presign failed host=%s obj=%s err=%s",
            _mask_host(endpoint), object_name, e,
        )
        return None


def browser_image_url(object_name: Optional[str]) -> Optional[str]:
    """브라우저 노출 이미지 URL (images 버킷 전용).

    - faces/ · evidence/ → None (안전망 — 프록시/presign 양쪽 차단)
    - 이미 http(s):// 전체 URL → passthrough (레거시 저장분)
    - MEDIA_URL_MODE=proxy → /api/upload/cover-preview/ 상대경로 (same-origin)
    - MEDIA_URL_MODE=presign → public_presign
    """
    if not object_name:
        return None
    if object_name.startswith(("http://", "https://")):
        return object_name
    if object_name.startswith(BLOCKED_PREFIXES):
        logger.info("[media-url] blocked prefix obj=%s", object_name)
        return None
    mode = (settings.media_url_mode or "proxy").strip().lower()
    if mode == "presign":
        logger.info("[media-url] mode=presign kind=image obj=%s", object_name)
        return public_presign(object_name)
    # 기본: proxy — URL-quote (경로 구분자 / 는 유지)
    logger.info("[media-url] mode=proxy kind=image obj=%s", object_name)
    return _PROXY_BASE + quote(object_name, safe="/")


def browser_video_url(
    object_name: Optional[str],
    bucket: Optional[str] = None,
) -> Optional[str]:
    """브라우저 노출 비디오 URL — 항상 public_presign.

    대용량 비디오는 프록시(메모리 로드) 제외. 개발 https 화면에서 재생 제한은
    기존 동작과 동일 (REPORT 특이사항).
    """
    if not object_name:
        return None
    if object_name.startswith(BLOCKED_PREFIXES):
        logger.info("[media-url] blocked prefix obj=%s", object_name)
        return None
    logger.info("[media-url] kind=video obj=%s", object_name)
    return public_presign(object_name, bucket=bucket)
