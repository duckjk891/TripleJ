"""
Social OAuth 2.0 (Authorization Code) 로그인/회원가입 라우트.

흐름:
  1) GET /api/auth/oauth/{provider}/login
       state 난수 생성 → Redis 단기 저장 → provider 인가 URL 로 302.
       provider 미지원/키미설정 → 503 JSON(친절 안내).
  2) GET /api/auth/oauth/{provider}/callback?code=&state=&error=
       state 검증 → code 교환 → userinfo → 계정 find/link/create
       → JWT 발급 + Redis 세션 → 프론트로 302
         성공: 웹={frontend_url}/oauth/callback#token={jwt} · 앱(client=app)=aidol://oauth/callback#token={jwt}
         실패: {frontend_url}/oauth/callback#error=...

기존 이메일 로그인의 토큰/세션 함수(_create_token, _save_session)를 재사용한다.
민감정보(code/token/secret/JWT 전체/이메일 전체) 로깅 금지 — 마스킹/길이/상태만.
"""

import hashlib
import logging
import secrets
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ..config import settings
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..services import oauth_service
from ..services.oauth_service import OAuthError, OAuthNotConfigured
from ..services.official import ensure_mutual_follow, social_signup_nickname
from ..services.points_service import credit_points
from ..services.referral_service import normalize_code, resolve_referrer
from .auth import _create_token, _save_session, grant_beta_signup_bonus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/oauth")

OAUTH_STATE_TTL = 300  # 5분

# v3.189(대표 확정): 소셜 로그인은 본인인증 트랙이 아님 — 인증(is_verified 승격,
# verify_bonus ⭐30, 얼굴 등록 게이트 해제)은 별도 휴대폰 본인인증(다날/포트원 PASS,
# 연동 예정)으로만 수행한다. (변경 전: {"naver", "kakao"} 로그인 시 자동 승격)
VERIFIED_PROVIDERS: set = set()

SELECT_COLS = "id, email, nickname, profile_image, role, is_verified, verify_provider, account_status"  # v3.233 account_status(동의 철회 차단)


def _mask_uid(uid: str) -> str:
    """provider_user_id 를 로그용으로 마스킹(앞4자 + 길이)."""
    if not uid:
        return "?"
    return f"{uid[:4]}…(len={len(uid)})"


def _callback_base(client: str) -> str:
    # v3.194: 네이티브 앱(client=app)은 앱 스킴 딥링크로 복귀, 웹은 기존 프론트 URL.
    if client == "app":
        return "aidol://oauth/callback"
    return f"{settings.frontend_url}/oauth/callback"


def _frontend_error_redirect(message: str, client: str = "web") -> RedirectResponse:
    return RedirectResponse(
        url=f"{_callback_base(client)}#error={quote(message)}",
        status_code=302,
    )


@router.get("/{provider}/login")
def _is_provider_default_avatar(url) -> bool:
    """v3.316 소셜 계정의 '사진 없음' 기본 이미지 판별 — 카카오 account_images/default_profile(썸네일 프록시 인코딩 포함)."""
    if not url or not isinstance(url, str):
        return False
    from urllib.parse import unquote
    u = unquote(unquote(url)).lower()
    return "kakaocdn.net" in u and "account_images/default_profile" in u


async def oauth_login(provider: str, request: Request):
    """소셜 로그인 시작 — provider 인가 페이지로 리다이렉트."""
    # v3.194: 네이티브 앱은 ?client=app 로 진입 → state 에 실어 콜백까지 전달.
    client = "app" if request.query_params.get("client") == "app" else "web"
    # v3.224: 초대 링크(?ref=) 추천코드를 소셜 가입까지 전달 — state 에 동봉(형식 검증은
    # 가입 시점 resolve_referrer 가 수행). '|' 포함 방지로 영숫자만 유지.
    ref_code = "".join(ch for ch in normalize_code(request.query_params.get("ref")) if ch.isalnum())[:12]
    logger.info("[oauth.login] provider=%s client=%s ref=%s action=start", provider, client, ref_code or "-")
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
        await redis.setex(f"oauth_state:{state}", OAUTH_STATE_TTL, f"{provider}|{client}|{ref_code}")
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
    client = "web"  # v3.194: state 파싱 후 app/web 확정 (파싱 전 오류는 web 기본)

    logger.info(
        "[oauth.callback] provider=%s action=received has_code=%s has_state=%s err=%s",
        provider, bool(code), bool(state), error,
    )

    # provider 가 에러를 돌려준 경우(사용자 동의 거부 등)
    if error:
        logger.warning("[oauth.callback] provider=%s action=provider_error err=%s", provider, error)
        return _frontend_error_redirect(f"{provider}_oauth_denied", client)

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
        # v3.194: 저장 형식 "provider|client" (구 형식 "provider" 도 방어적 파싱).
        # v3.224: "provider|client|ref" (구 "provider|client"·"provider" 도 방어적 파싱)
        _parts = stored.split("|")
        stored_provider = _parts[0]
        stored_client = _parts[1] if len(_parts) > 1 else ""
        ref_code = _parts[2] if len(_parts) > 2 else ""
        client = "app" if stored_client == "app" else "web"
        if stored_provider != provider:
            logger.warning(
                "[oauth.callback] provider=%s action=state_provider_mismatch stored=%s",
                provider, stored_provider,
            )
            return JSONResponse(status_code=400, content={"error": "state 제공자 불일치."})
    except Exception as e:
        logger.error("[oauth.callback] provider=%s action=state_check error=%s", provider, e)
        return _frontend_error_redirect("oauth_state_error", client)

    # 토큰 교환 → 사용자정보 → 정규화
    try:
        access_token = await oauth_service.exchange_code(provider, code)
        raw = await oauth_service.fetch_userinfo(provider, access_token)
        profile = oauth_service.normalize_profile(provider, raw)
    except OAuthNotConfigured as e:
        logger.warning("[oauth.callback] provider=%s action=not_configured", provider)
        return _frontend_error_redirect(str(e), client)
    except OAuthError as e:
        logger.error("[oauth.callback] provider=%s action=oauth_error %s", provider, e)
        return _frontend_error_redirect("oauth_exchange_failed", client)
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=unexpected %s", provider, e)
        return _frontend_error_redirect("oauth_internal_error", client)

    provider_uid = profile["provider_user_id"]
    email = profile.get("email")
    nickname = profile.get("nickname")
    profile_image = profile.get("profile_image")
    # v3.316 (대표 10-09): 카카오 '기본 프로필'(사진 미설정 계정의 공용 이미지)은 저장하지 않는다 —
    # 모두 같은 그림이 되어 앱의 랜덤 색 + 이니셜 기본 아바타가 가려졌다. 실제 사진만 가져온다.
    if _is_provider_default_avatar(profile_image):
        logger.info("[oauth] provider default avatar skipped provider=%s", provider)
        profile_image = None

    # 본인인증 트랙(naver/kakao) 추출값 — 값 자체는 로깅 금지
    birth_date = None
    if profile.get("birth_date"):
        try:
            birth_date = date.fromisoformat(profile["birth_date"])
        except ValueError:
            birth_date = None
    gender = profile.get("gender")

    try:
        action, row = await _resolve_account(
            conn, provider, provider_uid, email, nickname, profile_image,
            birth_date=birth_date, gender=gender,
        )
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=db_error %s", provider, e)
        return _frontend_error_redirect("oauth_account_error", client)

    # v3.233 — 보호자 동의 철회(suspended) 계정은 소셜 로그인도 차단(이메일 로그인 403 과 같은 정책).
    if row["account_status"] == "suspended":
        logger.info("[oauth.callback] provider=%s action=blocked_suspended user=%s", provider, str(row["id"])[:8])
        return _frontend_error_redirect("account_suspended", client)

    user_id = str(row["id"])
    role = row["role"] or "user"
    db_email = row["email"]
    db_nickname = row["nickname"]
    db_profile_image = row["profile_image"]

    # StarEconSquad(v158) — 소셜 신규가입 보너스 ⭐+50 (best-effort — 실패해도
    # 로그인 흐름 계속). day="-" + ref="-" → (유저, signup_bonus) 영구 1회 멱등
    # (이메일 가입 +50 과 같은 키 → 어느 경로든 1회만).
    if action == "signup":
        try:
            await credit_points(user_id, "signup_bonus", 50, ref="-", day="-")
            logger.info("[star-econ] signup_bonus +50 user=%s provider=%s", user_id[:8], provider)
        except Exception:
            logger.exception("[star-econ] signup_bonus failed user=%s provider=%s", user_id[:8], provider)

        # v3.224: 베타 기간 가입 추가 ⭐50 (이메일 가입·기존 회원 소급과 동일 키 — 1인 1회)
        await grant_beta_signup_bonus(user_id, source=provider)

        # v3.224: 소셜 가입 추천 보상 — 이메일 가입(auth.register ReferralSquad)과 동일 규칙.
        # referred_by 기록 + ⭐50×2, day="-" 멱등(어느 경로든 영구 1회). best-effort: 무효 코드·
        # 실패여도 로그인은 계속(이메일 가입과 달리 이미 계정 생성 후라 400 불가).
        if ref_code:
            try:
                referrer_row = await resolve_referrer(conn, ref_code)
                if not referrer_row:
                    logger.info("[referral] oauth signup invalid code=%s user=%s", ref_code, user_id[:8])
                elif str(referrer_row["id"]) == user_id:
                    logger.warning("[referral] oauth self-referral blocked user=%s", user_id[:8])
                else:
                    referrer_id = str(referrer_row["id"])
                    await conn.execute(
                        "UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL",
                        referrer_row["id"], row["id"],
                    )
                    await credit_points(referrer_id, "referral_inviter", 50, ref=user_id, day="-")
                    await credit_points(user_id, "referral_joiner", 50, ref=referrer_id, day="-")
                    logger.info(
                        "[referral] oauth reward inviter=%s joiner=%s code=%s provider=%s",
                        referrer_id[:8], user_id[:8], ref_code, provider,
                    )
            except Exception:
                logger.exception("[referral] oauth reward failed user=%s code=%s", user_id[:8], ref_code)

        # OfficialSquad — 소셜 신규가입 유저 ↔ maidol_official 자동 양방향 맞팔
        # (best-effort — 실패해도 로그인 흐름 계속. startup 백필로도 커버됨)
        try:
            await ensure_mutual_follow(conn, user_id, provider=provider)
        except Exception:
            logger.exception("[official] oauth mutual-follow failed user=%s provider=%s", user_id[:8], provider)

    try:
        token = _create_token(user_id, db_email, db_nickname, role)
        await _save_session(user_id, db_email, db_nickname, db_profile_image, role=role)
    except Exception as e:
        logger.exception("[oauth.callback] provider=%s action=token_error %s", provider, e)
        return _frontend_error_redirect("oauth_token_error", client)

    logger.info(
        "[oauth.callback] provider=%s action=%s uid=%s user_id=%s role=%s",
        provider, action, _mask_uid(provider_uid), user_id, role,
    )
    return RedirectResponse(
        url=f"{_callback_base(client)}#token={token}",
        status_code=302,
    )


async def _promote_verification(conn, provider, row, birth_date, gender):
    """기존 계정 재로그인/연동 시 인증 승격.

    provider 가 인증 트랙(naver/kakao)이고 계정이 미인증이면:
      is_verified=TRUE + verified_at/verify_provider 기록,
      birth_date/gender 는 NULL 인 필드만 추출값으로 보충(기존 값 유지).
    이미 인증됐거나 google 이면 아무 것도 하지 않는다.
    """
    if provider not in VERIFIED_PROVIDERS or row["is_verified"]:
        return row
    updated = await conn.fetchrow(
        f"""UPDATE users
            SET is_verified = TRUE, verified_at = now(), verify_provider = $1,
                birth_date = COALESCE(birth_date, $2),
                gender = COALESCE(gender, $3)
            WHERE id = $4
            RETURNING {SELECT_COLS}""",
        provider, birth_date, gender, row["id"],
    )
    logger.info(
        "[oauth] provider=%s action=verify_promote user=%s has_birth=%s has_gender=%s",
        provider, str(row["id"])[:8], bool(birth_date), bool(gender),
    )
    # StarEconSquad(v158) — 본인인증 승격 보너스 ⭐+30 (best-effort).
    # day="-" + ref="-" → (유저, verify_bonus) 영구 1회 멱등 (재승격 시도 무해).
    try:
        await credit_points(str(row["id"]), "verify_bonus", 30, ref="-", day="-")
        logger.info("[star-econ] verify_bonus +30 user=%s provider=%s", str(row["id"])[:8], provider)
    except Exception:
        logger.exception("[star-econ] verify_bonus failed user=%s", str(row["id"])[:8])
    return updated


async def _resolve_account(conn, provider, provider_uid, email, nickname, profile_image,
                           birth_date=None, gender=None):
    """계정 find / link / create 정책.

    ① (provider, provider_user_id) 존재 → 그대로 로그인 (action=login)
       — naver/kakao 재로그인이고 미인증이면 인증 승격 + 인구통계 NULL 보충
    ② 없고 email 일치하는 기존 user → provider 연동 UPDATE 후 로그인 (action=link)
       — 연동 후 동일 승격 규칙 적용
    ③ 없으면 신규 INSERT (action=signup), password_hash=NULL
       — naver/kakao 는 is_verified=TRUE + verified_at/verify_provider/birth_date/gender 저장
    """
    # ① provider + provider_user_id 로 조회
    row = await conn.fetchrow(
        f"SELECT {SELECT_COLS} FROM users WHERE provider = $1 AND provider_user_id = $2",
        provider, provider_uid,
    )
    if row:
        row = await _promote_verification(conn, provider, row, birth_date, gender)
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
            updated = await _promote_verification(conn, provider, updated, birth_date, gender)
            return "link", updated

    # ③ 신규 가입 — 이메일/닉네임 fallback, password_hash 는 NULL
    safe_email = email or f"{provider}_{provider_uid}@social.aidol.local"
    # v3.230b/c — 소셜 프로필 닉네임: 공용 정규화 → 15자 초과면 앞 15자로 자름 → 2자 미만·예약어·금지 문자면
    # 기존 대체 이름 {provider}_{uid8}(≤15자). 가입은 막지 않는다. 원문 로그 금지(길이만).
    fallback_nickname = f"{provider}_{provider_uid[:8]}"
    safe_nickname, nick_reason, nick_truncated = social_signup_nickname(nickname, fallback_nickname)
    logger.info(
        "[SignupNickname] oauth provider=%s result=%s truncated=%s raw_len=%d saved_len=%d",
        provider, "kept" if nick_reason == "ok" else f"fallback:{nick_reason}", nick_truncated,
        len(nickname) if isinstance(nickname, str) else -1, len(safe_nickname),
    )
    verified = provider in VERIFIED_PROVIDERS
    created = await conn.fetchrow(
        f"""INSERT INTO users (email, password_hash, nickname, profile_image, provider, provider_user_id,
                               is_verified, verified_at, verify_provider, birth_date, gender)
            VALUES ($1, NULL, $2, $3, $4, $5,
                    $6, CASE WHEN $6 THEN now() END, $7, $8, $9)
            RETURNING {SELECT_COLS}""",
        safe_email, safe_nickname, profile_image, provider, provider_uid,
        verified,
        provider if verified else None,
        birth_date if verified else None,
        gender if verified else None,
    )
    if verified:
        logger.info(
            "[oauth] provider=%s action=signup_verified user=%s has_birth=%s has_gender=%s",
            provider, str(created["id"])[:8], bool(birth_date), bool(gender),
        )
        # StarEconSquad(v158) — 인증 트랙(naver/kakao) 신규가입은 가입 즉시
        # is_verified=TRUE → verify_bonus ⭐+30 도 함께 지급 (signup_bonus +50 은
        # callback 의 action=="signup" 분기에서 별도 지급 = 의도된 동시 지급).
        try:
            await credit_points(str(created["id"]), "verify_bonus", 30, ref="-", day="-")
            logger.info(
                "[star-econ] verify_bonus +30 user=%s provider=%s (signup)",
                str(created["id"])[:8], provider,
            )
        except Exception:
            logger.exception("[star-econ] verify_bonus failed user=%s (signup)", str(created["id"])[:8])
    return "signup", created
