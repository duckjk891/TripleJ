"""
Social OAuth 2.0 (Authorization Code) 로그인/회원가입 라우트.

흐름:
  1) GET /api/auth/oauth/{provider}/login
       state 난수 생성 → Redis 단기 저장 → provider 인가 URL 로 302.
       provider 미지원/키미설정 → 503 JSON(친절 안내).
  2) GET /api/auth/oauth/{provider}/callback?code=&state=&error=
       state 검증 → code 교환 → userinfo → 계정 find/link/create
       → JWT 발급 + Redis 세션 → 프론트로 302
         성공: {frontend_url}/oauth/callback#token={jwt}
         실패: {frontend_url}/oauth/callback#error=...

기존 이메일 로그인의 토큰/세션 함수(_create_token, _save_session)를 재사용한다.
민감정보(code/token/secret/JWT 전체/이메일 전체) 로깅 금지 — 마스킹/길이/상태만.
"""

import hashlib
import logging
import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ..config import settings
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..services import oauth_service
from ..services.oauth_service import OAuthError, OAuthNotConfigured
from .auth import _create_token, _save_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/oauth")

OAUTH_STATE_TTL = 300  # 5분


def _mask_uid(uid: str) -> str:
    """provider_user_id 를 로그용으로 마스킹(앞4자 + 길이)."""
    if not uid:
        return "?"
    return f"{uid[:4]}…(len={len(uid)})"


def _frontend_error_redirect(message: str) -> RedirectResponse:
    return RedirectResponse(
        url=f"{settings.frontend_url}/oauth/callback#error={quote(message)}",
        status_code=302,
    )


@router.get("/{provider}/login")
async def oauth_login(provider: str):
    """소셜 로그인 시작 — provider 인가 페이지로 리다이렉트."""
    logger.info("[oauth.login] provider=%s action=start", provider)
    try:
        oauth_service.ensure_configured(provider)
    except OAuthNotConfigured as e:
        logger.warning("[oauth.login] provider=%s result=503_not_configured", provider)
        return JSONResponse(
            status_code=503,
            content={
                "error": str(e),
                "detail": f"{provider} 소셜 로그인은 현재 사용할 수 없습니다. 관리자에게 문의하세요.",
            },
        )
    except OAuthError as e:
        logger.warning("[oauth.login] provider=%s result=400 %s", provider, e)
        return JSONResponse(status_code=400, content={"error": str(e)})

    state = secrets.token_urlsafe(24)
    try:
        redis = get_redis()
        await redis.setex(f"oauth_state:{state}", OAUTH_STATE_TTL, provider)
        url = oauth_service.build_authorize_url(provider, state)
    except Exception as e:
        logger.error("[oauth.login] provider=%s action=start error=%s", provider, e)
        return JSONResponse(
            status_code=500,
            content={"error": "소셜 로그인 시작 중 오류가 발생했습니다."},
        )
    logger.info("[oauth.login] provider=%s action=redirect", provider)
    return RedirectResponse(url=url, status_code=302)


@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    conn=Depends(get_pg),
):
    """provider 콜백 — 토큰 교환 후 계정 find/link/create + JWT 발급."""
    params = request.query_params
    code = params.get("code")
    state = params.get("state")
    error = params.get("error")

    logger.info(
        "[oauth.callback] provider=%s action=received has_code=%s has_state=%s err=%s",
        provider, bool(code), bool(state), error,
    )

    # provider 가 에러를 돌려준 경우(사용자 동의 거부 등)
    if error:
        logger.warning("[oauth.callback] provider=%s action=provider_error err=%s", provider, error)
        return _frontend_error_redirect(f"{provider}_oauth_denied")

    if not code or not state:
        logger.warning("[oauth.callback] provider=%s action=missing_params", provider)
        return JSONResponse(status_code=400, content={"error": "잘못된 콜백 요청입니다."})

    # state 검증(CSRF) + 소비
    try:
        redis = get_redis()
        stored = await redis.get(f"oauth_state:{state}")
        if not stored:
            logger.warning("[oauth.callback] provider=%s action=state_invalid", provider)
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 state 입니다. 다시 시도해주세요."})
        await redis.delete(f"oauth_state:{state}")
        if stored != provider:
            logger.warning(
                "[oauth.callback] provider=%s action=state_provider_mismatch stored=%s",
                provider, stored,
            )
            return JSONResponse(status_code=400, content={"error": "state 제공자 불일치."})
    except Exception as e:
        logger.error("[oauth.callback] provider=%s action=state_check error=%s", provider, e)
        return _frontend_error_redirect("oauth_state_error")

    # 토큰 교환 → 사용자정보 → 정규화
    try:
        access_token = await oauth_service.exchange_code(provider, code)
        raw = await oauth_service.fetch_userinfo(provider, access_token)
        profile = oauth_service.normalize_profile(provider, raw)
    except OAuthNotConfigured as e:
        logger.warning("[oauth.callback] provider=%s action=not_configured", provider)
        return _frontend_error_redirect(str(e))
    except OAuthError as e:
        logger.error("[oauth.callback] provider=%s action=oauth_error %s", provider, e)
        return _frontend_error_redirect("oauth_exchange_failed")
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=unexpected %s", provider, e)
        return _frontend_error_redirect("oauth_internal_error")

    provider_uid = profile["provider_user_id"]
    email = profile.get("email")
    nickname = profile.get("nickname")
    profile_image = profile.get("profile_image")

    try:
        action, row = await _resolve_account(
            conn, provider, provider_uid, email, nickname, profile_image
        )
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=db_error %s", provider, e)
        return _frontend_error_redirect("oauth_account_error")

    user_id = str(row["id"])
    role = row["role"] or "user"
    db_email = row["email"]
    db_nickname = row["nickname"]
    db_profile_image = row["profile_image"]

    try:
        token = _create_token(user_id, db_email, db_nickname, role)
        await _save_session(user_id, db_email, db_nickname, db_profile_image, role=role)
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=token_error %s", provider, e)
        return _frontend_error_redirect("oauth_token_error")

    logger.info(
        "[oauth.callback] provider=%s action=%s uid=%s user_id=%s role=%s",
        provider, action, _mask_uid(provider_uid), user_id, role,
    )
    return RedirectResponse(
        url=f"{settings.frontend_url}/oauth/callback#token={token}",
        status_code=302,
    )


async def _resolve_account(conn, provider, provider_uid, email, nickname, profile_image):
    """계정 find / link / create 정책.

    ① (provider, provider_user_id) 존재 → 그대로 로그인 (action=login)
    ② 없고 email 일치하는 기존 user → provider 연동 UPDATE 후 로그인 (action=link)
    ③ 없으면 신규 INSERT (action=signup), password_hash=NULL
    """
    SELECT_COLS = "id, email, nickname, profile_image, role"

    # ① provider + provider_user_id 로 조회
    row = await conn.fetchrow(
        f"SELECT {SELECT_COLS} FROM users WHERE provider = $1 AND provider_user_id = $2",
        provider, provider_uid,
    )
    if row:
        return "login", row

    # ② email 로 기존 계정 조회 → 연동
    if email:
        row = await conn.fetchrow(
            f"SELECT {SELECT_COLS} FROM users WHERE email = $1", email
        )
        if row:
            updated = await conn.fetchrow(
                f"""UPDATE users
                    SET provider = $1, provider_user_id = $2,
                        profile_image = COALESCE(profile_image, $3)
                    WHERE id = $4
                    RETURNING {SELECT_COLS}""",
                provider, provider_uid, profile_image, row["id"],
            )
            return "link", updated

    # ③ 신규 가입 — 이메일/닉네임 fallback, password_hash 는 NULL
    safe_email = email or f"{provider}_{provider_uid}@social.aidol.local"
    safe_nickname = nickname or f"{provider}_{provider_uid[:8]}"
    created = await conn.fetchrow(
        f"""INSERT INTO users (email, password_hash, nickname, profile_image, provider, provider_user_id)
            VALUES ($1, NULL, $2, $3, $4, $5)
            RETURNING {SELECT_COLS}""",
        safe_email, safe_nickname, profile_image, provider, provider_uid,
    )
    return "signup", created
