"""
Social OAuth 2.0 (Authorization Code) service.

구글/카카오/네이버 공통 흐름을 한 곳에서 흡수한다:
  build_authorize_url(provider, state)  -> 사용자를 보낼 provider 인가 URL
  exchange_code(provider, code)         -> access_token
  fetch_userinfo(provider, access_token)-> provider 원본 사용자정보(raw)
  normalize_profile(provider, raw)      -> {provider_user_id, email, nickname, profile_image}

규칙: code/access_token/client_secret 는 절대 로깅하지 않는다(길이/상태/마스킹만).
키 미설정이면 OAuthNotConfigured 예외를 던진다(라우트에서 503 으로 변환).
"""

import logging
from typing import Optional
from urllib.parse import urlencode

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# provider 별 엔드포인트 + scope 메타. client_id/secret 은 settings 에서 lazy 조회.
PROVIDERS = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "scope": "openid email profile",
    },
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        # 이메일 미동의 가능성 대비 — 이메일이 없어도 흐름은 진행된다.
        "scope": "account_email profile_nickname profile_image",
    },
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "userinfo_url": "https://openapi.naver.com/v1/nid/me",
        "scope": "",  # 네이버는 기본 scope
    },
}

_HTTP_TIMEOUT = 15.0


class OAuthError(Exception):
    """OAuth 처리 중 일반 오류."""


class OAuthNotConfigured(OAuthError):
    """provider 의 client_id/secret 가 .env 에 설정되지 않음 → 503."""


def is_supported(provider: str) -> bool:
    return provider in PROVIDERS


def _client_id(provider: str) -> str:
    return {
        "google": settings.google_client_id,
        "kakao": settings.kakao_client_id,
        "naver": settings.naver_client_id,
    }.get(provider, "")


def _client_secret(provider: str) -> str:
    return {
        "google": settings.google_client_secret,
        "kakao": settings.kakao_client_secret,
        "naver": settings.naver_client_secret,
    }.get(provider, "")


def ensure_configured(provider: str) -> None:
    """provider 지원 + client_id 설정 여부 검증. 미설정이면 예외."""
    if not is_supported(provider):
        logger.warning("[oauth] provider=%s step=config result=unsupported", provider)
        raise OAuthError(f"지원하지 않는 소셜 로그인 제공자입니다: {provider}")
    if not _client_id(provider):
        logger.warning("[oauth] provider=%s step=config result=not_configured", provider)
        raise OAuthNotConfigured(f"{provider} 소셜 로그인이 아직 설정되지 않았습니다.")


def redirect_uri(provider: str) -> str:
    """provider 콘솔에 등록해야 하는 우리 콜백 URI."""
    return f"{settings.oauth_callback_base}/api/auth/oauth/{provider}/callback"


def build_authorize_url(provider: str, state: str) -> str:
    """사용자를 리다이렉트할 provider 인가 URL 생성."""
    ensure_configured(provider)
    meta = PROVIDERS[provider]
    params = {
        "response_type": "code",
        "client_id": _client_id(provider),
        "redirect_uri": redirect_uri(provider),
        "state": state,
    }
    scope = meta.get("scope")
    if scope:
        params["scope"] = scope
    url = f"{meta['authorize_url']}?{urlencode(params)}"
    logger.info(
        "[oauth] provider=%s step=authorize result=built state_len=%d",
        provider, len(state or ""),
    )
    return url


async def exchange_code(provider: str, code: str) -> str:
    """인가코드 -> access_token 교환. token/secret 미로깅."""
    ensure_configured(provider)
    meta = PROVIDERS[provider]
    data = {
        "grant_type": "authorization_code",
        "client_id": _client_id(provider),
        "client_secret": _client_secret(provider),
        "redirect_uri": redirect_uri(provider),
        "code": code,
    }
    headers = {"Accept": "application/json"}
    logger.info(
        "[oauth] provider=%s step=token request code_len=%d",
        provider, len(code or ""),
    )
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.post(meta["token_url"], data=data, headers=headers)
    logger.info(
        "[oauth] provider=%s step=token status=%d", provider, resp.status_code
    )
    if resp.status_code != 200:
        raise OAuthError(f"{provider} 토큰 교환 실패 (status={resp.status_code})")
    try:
        payload = resp.json()
    except Exception as e:
        logger.error("[oauth] provider=%s step=token error=invalid_json %s", provider, e)
        raise OAuthError(f"{provider} 토큰 응답 파싱 실패")
    access_token = payload.get("access_token")
    if not access_token:
        # 토큰 본문은 로깅하지 않고 error 필드만(있으면) 짧게 남긴다.
        logger.warning(
            "[oauth] provider=%s step=token result=no_access_token err=%s",
            provider, payload.get("error"),
        )
        raise OAuthError(f"{provider} access_token 을 받지 못했습니다.")
    logger.info(
        "[oauth] provider=%s step=token result=ok token_len=%d",
        provider, len(access_token),
    )
    return access_token


async def fetch_userinfo(provider: str, access_token: str) -> dict:
    """access_token 으로 provider 사용자정보(raw) 조회."""
    ensure_configured(provider)
    meta = PROVIDERS[provider]
    headers = {"Authorization": f"Bearer {access_token}"}
    logger.info("[oauth] provider=%s step=userinfo request", provider)
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(meta["userinfo_url"], headers=headers)
    logger.info(
        "[oauth] provider=%s step=userinfo status=%d", provider, resp.status_code
    )
    if resp.status_code != 200:
        raise OAuthError(f"{provider} 사용자정보 조회 실패 (status={resp.status_code})")
    try:
        return resp.json()
    except Exception as e:
        logger.error("[oauth] provider=%s step=userinfo error=invalid_json %s", provider, e)
        raise OAuthError(f"{provider} 사용자정보 응답 파싱 실패")


def _s(val) -> Optional[str]:
    """문자열화 + 빈값 정규화."""
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def normalize_profile(provider: str, raw: dict) -> dict:
    """provider 별 응답차를 흡수해 공통 프로필로 정규화.

    반환: {provider_user_id, email, nickname, profile_image}
    provider_user_id 는 필수(없으면 예외), 나머지는 None 가능.
    """
    raw = raw or {}
    if provider == "google":
        result = {
            "provider_user_id": _s(raw.get("id")),
            "email": _s(raw.get("email")),
            "nickname": _s(raw.get("name")),
            "profile_image": _s(raw.get("picture")),
        }
    elif provider == "kakao":
        account = raw.get("kakao_account") or {}
        props = raw.get("properties") or {}
        result = {
            "provider_user_id": _s(raw.get("id")),
            "email": _s(account.get("email")),
            "nickname": _s(props.get("nickname") or (account.get("profile") or {}).get("nickname")),
            "profile_image": _s(
                props.get("profile_image")
                or (account.get("profile") or {}).get("profile_image_url")
            ),
        }
    elif provider == "naver":
        response = raw.get("response") or {}
        result = {
            "provider_user_id": _s(response.get("id")),
            "email": _s(response.get("email")),
            "nickname": _s(response.get("nickname") or response.get("name")),
            "profile_image": _s(response.get("profile_image")),
        }
    else:
        raise OAuthError(f"지원하지 않는 소셜 로그인 제공자입니다: {provider}")

    if not result.get("provider_user_id"):
        logger.warning("[oauth] provider=%s step=normalize result=no_uid", provider)
        raise OAuthError(f"{provider} 사용자 식별자를 받지 못했습니다.")
    logger.info(
        "[oauth] provider=%s step=normalize result=ok has_email=%s has_nick=%s has_img=%s",
        provider,
        bool(result.get("email")),
        bool(result.get("nickname")),
        bool(result.get("profile_image")),
    )
    return result
