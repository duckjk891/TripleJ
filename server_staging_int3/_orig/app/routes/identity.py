"""v3.333 [IdentityVerify] 본인확인 API + 소셜 가입 마무리(온보딩) 상태 — 기본 꺼짐(준비본).

  GET  /api/identity/config            무인증 — {enabled, provider}
  GET  /api/identity/onboarding        로그인 — 소셜 가입 마무리 필요 여부(필수 동의 누락·생년월일 없음)
  POST /api/identity/start             로그인 — {purpose, return_url?} → {request_id, url}
  GET  /api/identity/page/{rid}        인증 페이지(공급자 화면)
  POST /api/identity/callback/{rid}    공급자 결과 수신 → 서버 대 서버 검증 → users 반영
  GET  /api/identity/result/{rid}      로그인(본인 요청만) — {status, under_14, error}

스위치(.env, 재기동으로 반영 — 기본 모두 꺼짐 → 기존 동작 그대로):
  IDENTITY_VERIFY_PROVIDER   ''(꺼짐) | mock(점검용) | <pg>
  SOCIAL_ONBOARDING_ENABLED  true 면 앱이 소셜 가입자에게 '가입 마무리'(필수 동의 + 본인확인/생년월일)를 띄운다
로그 규칙: request_id 앞 8자, 사용자 앞 8자, 생년월일·CI·이름 값 금지.
"""

import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..models.user import REQUIRED_CONSENT_KEYS, is_under_14
from ..services import identity_verify as iv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/identity", tags=["identity"])

REQUEST_TTL = timedelta(minutes=15)
_ALLOWED_RETURN_PREFIXES = ("aidol://", "https://app.maidol.ai.kr/")
_schema_ready = False


def _public_base() -> str:
    return (os.getenv("PUBLIC_API_BASE") or "https://api.maidol.ai.kr").rstrip("/")


def _onboarding_enabled() -> bool:
    return (os.getenv("SOCIAL_ONBOARDING_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on")


def _u8(v) -> str:
    return str(v)[:8]


async def _ensure_schema(conn) -> None:
    global _schema_ready
    if _schema_ready:
        return
    await conn.execute(
        """CREATE TABLE IF NOT EXISTS identity_verifications (
             id TEXT PRIMARY KEY,
             user_id UUID NOT NULL,
             purpose TEXT NOT NULL,
             provider TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'pending',
             return_url TEXT,
             error TEXT,
             under_14 BOOLEAN,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             completed_at TIMESTAMPTZ
           )"""
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_identity_verifications_user ON identity_verifications(user_id, created_at DESC)")
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS ci_hash TEXT")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_ci_hash ON users(ci_hash) WHERE ci_hash IS NOT NULL")
    _schema_ready = True
    logger.info("[identity] schema ensured")


# ── 설정·온보딩 상태 ─────────────────────────────────────────────────────────

@router.get("/config")
async def identity_config():
    return {"enabled": iv.enabled(), "provider": iv.provider_name() if iv.enabled() else None,
            "social_onboarding_enabled": _onboarding_enabled()}


@router.get("/onboarding")
async def onboarding_status(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """소셜 가입 마무리 필요 여부. 스위치 꺼짐이면 required=false(앱은 아무것도 띄우지 않음)."""
    user_id = uuid.UUID(str(current_user["id"]))
    row = await conn.fetchrow("SELECT birth_date, is_verified FROM users WHERE id = $1", user_id)
    rows = await conn.fetch(
        """SELECT DISTINCT ON (consent_key) consent_key, agreed FROM user_consents
           WHERE user_id = $1 ORDER BY consent_key, created_at DESC, id DESC""",
        user_id,
    )
    agreed = {r["consent_key"] for r in rows if r["agreed"]}
    # v3.348 — 만 14세 미만(생년월일 기준) 또는 보호자 가입 동의가 완료된 계정은 '만 14세 이상 확인'(age14)을
    # 요구하지 않는다(보호자 동의가 대신함). 종전엔 스위치를 켜는 순간 어린이 계정 전부가 마무리 화면에 막혔다.
    is_minor = bool(row and is_under_14(row["birth_date"]))
    if not is_minor:
        is_minor = bool(await conn.fetchval(
            """SELECT 1 FROM guardian_consents WHERE child_user_id = $1 AND status = 'agreed'
               AND COALESCE(consent_type, 'signup') = 'signup' LIMIT 1""",
            user_id,
        ))
    missing = [k for k in REQUIRED_CONSENT_KEYS if k not in agreed and not (is_minor and k == "age14")]
    birth_missing = not (row and row["birth_date"])
    enabled = _onboarding_enabled()
    required = enabled and (bool(missing) or birth_missing)
    if required:
        logger.info("[identity] onboarding required user=%s missing=%s birth_missing=%s minor=%s",
                    _u8(user_id), missing, birth_missing, is_minor)
    return {
        "enabled": enabled,
        "required": required,
        "missing_consents": missing,
        "birth_date_missing": birth_missing,
        "is_verified": bool(row and row["is_verified"]),
        "is_minor": is_minor,  # v3.348 앱: 마무리 화면에서 age14 항목 숨김
        "identity": {"enabled": iv.enabled(), "provider": iv.provider_name() if iv.enabled() else None},
    }


# ── 본인확인 ────────────────────────────────────────────────────────────────

class StartBody(BaseModel):
    purpose: str = "verify"          # 'signup'(소셜 가입 마무리) | 'verify'(설정에서 본인인증)
    return_url: Optional[str] = None


@router.post("/start")
async def identity_start(body: StartBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        provider = iv.get_provider()
    except iv.IdentityNotConfigured:
        return JSONResponse(status_code=503, content={"error": "본인확인은 준비 중이에요. 조금만 기다려 주세요.",
                                                      "code": "identity_not_configured"})
    await _ensure_schema(conn)
    purpose = body.purpose if body.purpose in ("signup", "verify") else "verify"
    ret = (body.return_url or "").strip()
    if ret and not ret.startswith(_ALLOWED_RETURN_PREFIXES):
        logger.warning("[identity] return_url rejected user=%s", _u8(current_user["id"]))
        ret = ""
    rid = secrets.token_urlsafe(18)
    await conn.execute(
        "INSERT INTO identity_verifications (id, user_id, purpose, provider, return_url) VALUES ($1, $2, $3, $4, $5)",
        rid, uuid.UUID(str(current_user["id"])), purpose, provider.name, ret or None,
    )
    logger.info("[identity] start rid=%s user=%s purpose=%s provider=%s", rid[:8], _u8(current_user["id"]), purpose, provider.name)
    return {"request_id": rid, "url": f"{_public_base()}/api/identity/page/{rid}"}


async def _load_pending(conn, rid: str):
    row = await conn.fetchrow("SELECT * FROM identity_verifications WHERE id = $1", rid)
    if not row:
        return None, "요청을 찾을 수 없어요."
    if row["status"] != "pending":
        return row, "이미 처리된 요청이에요."
    if datetime.now(timezone.utc) - row["created_at"] > REQUEST_TTL:
        await conn.execute("UPDATE identity_verifications SET status='expired', completed_at=now() WHERE id=$1", rid)
        return row, "시간이 지났어요. 다시 시도해 주세요."
    return row, None


def _done_page(message: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>본인확인</title><style>body{{font-family:-apple-system,sans-serif;background:#0d0820;color:#fff;padding:32px;text-align:center}}</style></head>
<body><h2>{message}</h2><p>앱으로 돌아가 주세요.</p><script>setTimeout(function(){{try{{window.close()}}catch(e){{}}}},800)</script></body></html>"""
    )


@router.get("/page/{rid}", response_class=HTMLResponse)
async def identity_page(rid: str, request: Request, conn=Depends(get_pg)):
    try:
        provider = iv.get_provider()
    except iv.IdentityNotConfigured:
        return _done_page("본인확인은 준비 중이에요.")
    await _ensure_schema(conn)
    row, err = await _load_pending(conn, rid)
    if err:
        return _done_page(err)
    callback_url = f"{_public_base()}/api/identity/callback/{rid}"
    if hasattr(provider, "render_page_async"):  # 다날 등 — 서버 대 서버 준비(ITEMSEND) 후 공급자 화면으로 이동
        try:
            return HTMLResponse(await provider.render_page_async(rid, callback_url, f"{_public_base()}/api/identity/back/{rid}",
                                                                 request.headers.get("user-agent", "")))
        except iv.IdentityVerifyError as e:
            return _done_page(str(e))
    return HTMLResponse(provider.render_page(rid, callback_url, row["return_url"] or ""))


@router.api_route("/back/{rid}", methods=["GET", "POST"])
async def identity_back(rid: str, conn=Depends(get_pg)):
    """공급자 화면에서 취소·오류로 돌아온 경우(다날 BackURL) — 요청을 cancelled 로 닫고 앱으로 복귀."""
    await _ensure_schema(conn)
    row = await conn.fetchrow("SELECT status, return_url FROM identity_verifications WHERE id = $1", rid)
    if not row:
        return _done_page("요청을 찾을 수 없어요.")
    if row["status"] == "pending":
        await conn.execute("UPDATE identity_verifications SET status='cancelled', completed_at=now() WHERE id=$1 AND status='pending'", rid)
        logger.info("[identity] cancelled rid=%s", rid[:8])
    ret = row["return_url"]
    if ret:
        sep = "&" if "?" in ret else "?"
        return RedirectResponse(url=f"{ret}{sep}{urlencode({'rid': rid, 'status': 'cancelled'})}", status_code=303)
    return _done_page("본인확인을 취소했어요.")


async def _apply_result(conn, row, provider_name: str, result: "iv.IdentityResult") -> dict:
    """users 반영 — 같은 CI 가 다른 활성 계정에 있으면 duplicate(반영 안 함)."""
    user_id = row["user_id"]
    h = iv.ci_hash(result.ci)
    if h:
        dup = await conn.fetchval(
            "SELECT id FROM users WHERE ci_hash = $1 AND id <> $2 AND COALESCE(account_status,'') <> 'withdrawn' LIMIT 1",
            h, user_id,
        )
        if dup:
            logger.warning("[identity] duplicate ci rid=%s user=%s other=%s", row["id"][:8], _u8(user_id), _u8(dup))
            return {"status": "duplicate", "error": "이미 다른 계정에서 본인확인을 마쳤어요. 그 계정으로 로그인해 주세요."}
    await conn.execute(
        """UPDATE users SET is_verified = TRUE, verified_at = now(), verify_provider = $2,
                  birth_date = $3, gender = COALESCE($4, gender), ci_hash = COALESCE($5, ci_hash)
           WHERE id = $1""",
        user_id, f"identity:{provider_name}", result.birth_date, result.gender, h,
    )
    under14 = is_under_14(result.birth_date)
    try:
        from ..services.points_service import credit_points
        await credit_points(str(user_id), "verify_bonus", 30, ref="-", day="-")  # oauth 본인인증과 같은 1회 보상(멱등)
    except Exception:  # noqa: BLE001
        logger.exception("[identity] verify_bonus failed user=%s", _u8(user_id))
    logger.info("[identity] verified rid=%s user=%s under14=%s gender=%s", row["id"][:8], _u8(user_id), under14, bool(result.gender))
    return {"status": "verified", "under_14": under14}


@router.post("/callback/{rid}")
async def identity_callback(rid: str, request: Request, conn=Depends(get_pg)):
    try:
        provider = iv.get_provider()
    except iv.IdentityNotConfigured:
        return _done_page("본인확인은 준비 중이에요.")
    await _ensure_schema(conn)
    row, err = await _load_pending(conn, rid)
    if err:
        return _done_page(err)
    ctype = request.headers.get("content-type", "")
    payload = dict(await request.form()) if "form" in ctype else (await request.json() if "json" in ctype else {})
    try:
        result = await provider.verify_callback(rid, payload)
        outcome = await _apply_result(conn, row, provider.name, result)
    except iv.IdentityVerifyError as e:
        outcome = {"status": "failed", "error": str(e)}
        logger.warning("[identity] verify failed rid=%s err=%s", rid[:8], str(e)[:80])
    except Exception:
        logger.exception("[identity] callback error rid=%s", rid[:8])
        outcome = {"status": "failed", "error": "본인확인 처리 중 문제가 생겼어요. 다시 시도해 주세요."}
    await conn.execute(
        "UPDATE identity_verifications SET status=$2, error=$3, under_14=$4, completed_at=now() WHERE id=$1",
        rid, outcome["status"], outcome.get("error"), outcome.get("under_14"),
    )
    ret = row["return_url"]
    if ret:
        sep = "&" if "?" in ret else "?"
        return RedirectResponse(url=f"{ret}{sep}{urlencode({'rid': rid, 'status': outcome['status']})}", status_code=303)
    return _done_page("본인확인이 끝났어요." if outcome["status"] == "verified" else (outcome.get("error") or "본인확인에 실패했어요."))


@router.get("/result/{rid}")
async def identity_result(rid: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    await _ensure_schema(conn)
    row = await conn.fetchrow(
        "SELECT user_id, status, error, under_14 FROM identity_verifications WHERE id = $1", rid,
    )
    if not row or str(row["user_id"]) != str(current_user["id"]):
        return JSONResponse(status_code=404, content={"error": "요청을 찾을 수 없어요."})
    return {"status": row["status"], "under_14": row["under_14"], "error": row["error"]}
