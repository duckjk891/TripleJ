"""[SIWA] Sign in with Apple — iOS 앱 네이티브 로그인 + 탈퇴 시 토큰 해지 + 애플 서버 알림.

흐름(iOS 앱):
  expo-apple-authentication signInAsync → POST /api/auth/apple/native
    {identity_token, authorization_code?, full_name?, ref_code?}
  ① identity_token 검증(애플 공개키 RS256, iss=https://appleid.apple.com, aud=번들 ID)
  ② oauth.py 와 같은 계정 정책(_resolve_account: provider='apple' + sub → 이메일 연동 → 신규)
  ③ 신규 가입 보너스·추천·공식 계정 맞팔 — oauth.py 콜백과 같은 규칙(변경 시 두 곳 함께)
  ④ authorization_code → refresh_token 교환·보관(Mongo apple_tokens) — 탈퇴 시 애플 토큰 해지용(심사 필수)
  ⑤ JWT 발급 → {"token": ...} (앱은 loginWithToken 으로 세션 열기)

설정(.env, 값 로그 금지):
  APPLE_BUNDLE_ID(기본 com.maidol.app) · APPLE_TEAM_ID · APPLE_SIWA_KEY_ID · APPLE_SIWA_KEY_B64(.p8 PEM 의 base64)
  키 미설정이어도 로그인은 동작(④만 건너뜀 — 해지 불가 경고 로그).
"""
from __future__ import annotations

import base64
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services.official import ensure_mutual_follow
from ..services.points_service import credit_points
from ..services.referral_service import normalize_code, resolve_referrer
from .auth import _create_token, _save_session, grant_beta_signup_bonus
from .oauth import _mask_uid, _resolve_account

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/apple")

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"
TOKENS = "apple_tokens"
PROVIDER = "apple"

_jwks_client: Optional[jwt.PyJWKClient] = None


def bundle_id() -> str:
    return (os.environ.get("APPLE_BUNDLE_ID") or "com.maidol.app").strip()


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(APPLE_KEYS_URL, cache_keys=True, lifespan=3600, timeout=10)
    return _jwks_client


def verify_identity_token(token: str, *, jwks: Optional[jwt.PyJWKClient] = None) -> dict:
    """애플 identity_token(JWT) 검증 → claims. 실패 시 jwt.PyJWTError 계열 예외."""
    key = (jwks or _jwks()).get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["RS256"], audience=bundle_id(), issuer=APPLE_ISSUER,
                      options={"require": ["sub", "iss", "aud", "exp"]})


def _siwa_private_key() -> Optional[str]:
    raw = (os.environ.get("APPLE_SIWA_KEY_B64") or "").strip()
    if not raw:
        return None
    try:
        return base64.b64decode(raw).decode()
    except Exception:
        logger.error("[SIWA] APPLE_SIWA_KEY_B64 디코딩 실패(값 형식 확인)")
        return None


def client_secret(now: Optional[int] = None) -> Optional[str]:
    """애플 토큰 API 용 client_secret(ES256 JWT, 5분). 키 미설정이면 None."""
    pem = _siwa_private_key()
    team = (os.environ.get("APPLE_TEAM_ID") or "").strip()
    kid = (os.environ.get("APPLE_SIWA_KEY_ID") or "").strip()
    if not (pem and team and kid):
        return None
    t = int(now or time.time())
    return jwt.encode({"iss": team, "iat": t, "exp": t + 300, "aud": APPLE_ISSUER, "sub": bundle_id()},
                      pem, algorithm="ES256", headers={"kid": kid})


async def _exchange_and_store(user_id: str, code: str) -> None:
    """authorization_code → refresh_token 보관(탈퇴 시 해지용). best-effort, 토큰 값 로그 금지."""
    secret = client_secret()
    if not secret:
        logger.warning("[SIWA] 키 미설정 — refresh_token 보관 생략(탈퇴 시 애플 해지 불가) user=%s", user_id[:8])
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(APPLE_TOKEN_URL, data={
                "client_id": bundle_id(), "client_secret": secret, "code": code, "grant_type": "authorization_code",
            })
        if r.status_code != 200:
            logger.warning("[SIWA] code 교환 실패 status=%d err=%s user=%s", r.status_code, (r.json() or {}).get("error") if r.headers.get("content-type", "").startswith("application/json") else "-", user_id[:8])
            return
        rt = (r.json() or {}).get("refresh_token")
        if not rt:
            logger.warning("[SIWA] code 교환 응답에 refresh_token 없음 user=%s", user_id[:8])
            return
        await get_mongo()[TOKENS].update_one(
            {"user_id": user_id},
            {"$set": {"refresh_token": rt, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        logger.info("[SIWA] refresh_token 보관 user=%s", user_id[:8])
    except Exception:
        logger.exception("[SIWA] code 교환 오류 user=%s", user_id[:8])


async def revoke_for_user(user_id: str) -> bool:
    """회원 탈퇴 시 호출 — 보관된 애플 토큰을 해지하고 문서를 지운다. never raises. 해지했으면 True."""
    try:
        doc = await get_mongo()[TOKENS].find_one({"user_id": str(user_id)})
        if not doc:
            return False
        secret = client_secret()
        if not secret:
            logger.warning("[SIWA] 키 미설정 — 애플 토큰 해지 불가 user=%s", str(user_id)[:8])
            return False
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(APPLE_REVOKE_URL, data={
                "client_id": bundle_id(), "client_secret": secret,
                "token": doc["refresh_token"], "token_type_hint": "refresh_token",
            })
        await get_mongo()[TOKENS].delete_many({"user_id": str(user_id)})
        logger.info("[SIWA] revoke status=%d user=%s", r.status_code, str(user_id)[:8])
        return r.status_code == 200
    except Exception:
        logger.exception("[SIWA] revoke 오류 user=%s", str(user_id)[:8])
        return False


class NativeBody(BaseModel):
    identity_token: str
    authorization_code: Optional[str] = None
    full_name: Optional[str] = None
    ref_code: Optional[str] = None


@router.post("/native")
async def apple_native_login(body: NativeBody, conn=Depends(get_pg)):
    try:
        claims = verify_identity_token(body.identity_token)
    except Exception as e:
        logger.warning("[SIWA] identity_token 검증 실패 type=%s", type(e).__name__)
        return JSONResponse(status_code=401, content={"error": "애플 로그인 확인에 실패했어요. 다시 시도해 주세요."})

    sub = str(claims["sub"])
    # 애플은 email_verified 를 "true"/True 로 준다. 확인된 이메일만 기존 계정 연동에 쓴다(가리기 릴레이 포함).
    ev = claims.get("email_verified")
    email = claims.get("email") if (ev is True or str(ev).lower() == "true") else None
    nickname = (body.full_name or "").strip() or None

    try:
        action, row = await _resolve_account(conn, PROVIDER, sub, email, nickname, None)
    except Exception:
        logger.exception("[SIWA] 계정 처리 오류 uid=%s", _mask_uid(sub))
        return JSONResponse(status_code=500, content={"error": "로그인 처리 중 오류가 발생했어요."})

    if row["account_status"] == "suspended":
        logger.info("[SIWA] blocked_suspended user=%s", str(row["id"])[:8])
        return JSONResponse(status_code=403, content={"error": "account_suspended"})

    user_id = str(row["id"])
    role = row["role"] or "user"

    # oauth.py 콜백과 같은 신규 가입 규칙 — 변경 시 두 곳 함께
    if action == "signup":
        try:
            await credit_points(user_id, "signup_bonus", 50, ref="-", day="-")
            logger.info("[star-econ] signup_bonus +50 user=%s provider=apple", user_id[:8])
        except Exception:
            logger.exception("[star-econ] signup_bonus failed user=%s provider=apple", user_id[:8])
        await grant_beta_signup_bonus(user_id, source=PROVIDER)
        ref_code = normalize_code(body.ref_code) if body.ref_code else None
        if ref_code:
            try:
                referrer_row = await resolve_referrer(conn, ref_code)
                if not referrer_row:
                    logger.info("[referral] apple signup invalid code=%s user=%s", ref_code, user_id[:8])
                elif str(referrer_row["id"]) == user_id:
                    logger.warning("[referral] apple self-referral blocked user=%s", user_id[:8])
                else:
                    referrer_id = str(referrer_row["id"])
                    await conn.execute(
                        "UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL",
                        referrer_row["id"], row["id"],
                    )
                    await credit_points(referrer_id, "referral_inviter", 50, ref=user_id, day="-")
                    await credit_points(user_id, "referral_joiner", 50, ref=referrer_id, day="-")
                    logger.info("[referral] apple reward inviter=%s joiner=%s code=%s", referrer_id[:8], user_id[:8], ref_code)
            except Exception:
                logger.exception("[referral] apple reward failed user=%s code=%s", user_id[:8], ref_code)
        try:
            await ensure_mutual_follow(conn, user_id, provider=PROVIDER)
        except Exception:
            logger.exception("[official] apple mutual-follow failed user=%s", user_id[:8])

    if body.authorization_code:
        await _exchange_and_store(user_id, body.authorization_code)

    try:
        token = _create_token(user_id, row["email"], row["nickname"], role)
        await _save_session(user_id, row["email"], row["nickname"], row["profile_image"], role=role)
    except Exception:
        logger.exception("[SIWA] token 발급 오류 user=%s", user_id[:8])
        return JSONResponse(status_code=500, content={"error": "로그인 처리 중 오류가 발생했어요."})

    logger.info("[SIWA] native action=%s uid=%s user_id=%s private_relay=%s",
                action, _mask_uid(sub), user_id[:8], str(claims.get("is_private_email", "")).lower() == "true")
    return {"token": token, "action": action}


@router.post("/notifications")
async def apple_server_notification(request: Request):
    """애플 서버 알림(Sign in with Apple 설정의 Server-to-Server Notification Endpoint).

    payload={"payload": <애플 서명 JWT>}. consent-revoked·account-delete 면 보관 토큰만 지운다
    (MAIDOL 계정 자체는 사용자가 앱에서 탈퇴해야 삭제 — 자동 삭제 안 함). 항상 200.
    """
    try:
        body = await request.json()
        claims = verify_identity_token(str(body.get("payload") or ""))
        import json as _json
        events = claims.get("events")
        if isinstance(events, str):
            events = _json.loads(events)
        etype = (events or {}).get("type")
        sub = str((events or {}).get("sub") or "")
        logger.info("[SIWA] server notification type=%s uid=%s", etype, _mask_uid(sub) if sub else "-")
        if etype in ("consent-revoked", "account-delete") and sub:
            pg_row = None
            try:
                from ..database.postgres import _pool
                async with _pool.acquire() as c:
                    pg_row = await c.fetchrow("SELECT id FROM users WHERE provider = $1 AND provider_user_id = $2", PROVIDER, sub)
            except Exception:
                logger.exception("[SIWA] notification user lookup failed")
            if pg_row:
                await get_mongo()[TOKENS].delete_many({"user_id": str(pg_row["id"])})
    except Exception as e:
        logger.warning("[SIWA] server notification 처리 실패 type=%s", type(e).__name__)
    return {"ok": True}
