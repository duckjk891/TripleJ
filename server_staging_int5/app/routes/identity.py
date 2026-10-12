"""v3.333 [IdentityVerify] 본인확인 API + 소셜 가입 마무리(온보딩) 상태 — 기본 꺼짐(준비본).

  GET  /api/identity/config            무인증 — {enabled, provider}
  GET  /api/identity/onboarding        로그인 — 소셜 가입 마무리 필요 여부(필수 동의 누락·생년월일 없음)
  POST /api/identity/start             로그인 — {purpose, return_url?} → {request_id, url}
  GET  /api/identity/page/{rid}        인증 페이지(공급자 화면)
  POST /api/identity/callback/{rid}    공급자 결과 수신 → 서버 대 서버 검증 → users 반영
  GET  /api/identity/result/{rid}      로그인(본인 요청만) — {status, under_14, error, merge_candidate}
  GET  /api/identity/merge/preview     로그인 — 같은 사람 계정 두 개 카드 + blocked_reason   [AccountMerge 2026-10-12]
  POST /api/identity/merge/confirm     로그인 — {rid, keep_user_id} → {status:'merged'|'running', token?, user?}
  POST /api/identity/merge/decline     로그인 — {rid} → {status:'declined'} (본인확인 반영 안 함)
  GET  /api/identity/merge/status      로그인 — {status:'running'|'merged'|..., token?, user?}

스위치(.env, 재기동으로 반영 — 기본 모두 꺼짐 → 기존 동작 그대로):
  IDENTITY_VERIFY_PROVIDER   ''(꺼짐) | mock(점검용) | <pg>
  SOCIAL_ONBOARDING_ENABLED  true 면 앱이 소셜 가입자에게 '가입 마무리'(필수 동의 + 본인확인/생년월일)를 띄운다
  ACCOUNT_MERGE_ENABLED      true 면 DI 중복을 duplicate 오류 대신 merge_candidate(계정 통합 제안)로 처리
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
from ..services import account_merge as am
from ..services import identity_verify as iv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/identity", tags=["identity"])

REQUEST_TTL = timedelta(minutes=15)
_ALLOWED_RETURN_PREFIXES = ("aidol://", "https://app.maidol.ai.kr/", "https://maidol.ai.kr/guardian/")
GUARDIAN_MIN_AGE = 19  # [Guardian] 보호자 = 성인(만 19세 이상)
_schema_ready = False


def _public_base() -> str:
    return (os.getenv("PUBLIC_API_BASE") or "https://api.maidol.ai.kr").rstrip("/")


def _onboarding_enabled() -> bool:
    return (os.getenv("SOCIAL_ONBOARDING_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on")


def _merge_enabled() -> bool:
    """ACCOUNT_MERGE_ENABLED=true 이거나, ACCOUNT_MERGE_ENABLED_FROM(ISO 시각, 처리방침 시행일) 이 지났으면 켜짐 — 재기동 없이 자동 시작."""
    if (os.getenv("ACCOUNT_MERGE_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on"):
        return True
    since = _parse_since("ACCOUNT_MERGE_ENABLED_FROM")
    return bool(since and datetime.now(timezone.utc) >= since)


MERGE_TTL = timedelta(hours=24)  # 통합 제안 유효 시간 — 지나면 다시 본인확인


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
    # [Guardian 2026-10-12] 보호자 본인확인 — 요청↔보호자 동의 연결, 보호자 인증 결과(해시만)
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS consent_id UUID")
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS reason TEXT")
    await conn.execute("ALTER TABLE guardian_consents ADD COLUMN IF NOT EXISTS guardian_verified_at TIMESTAMPTZ")
    await conn.execute("ALTER TABLE guardian_consents ADD COLUMN IF NOT EXISTS guardian_di_hash TEXT")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_ci_hash ON users(ci_hash) WHERE ci_hash IS NOT NULL")
    # [AccountMerge 2026-10-12] 통합 제안 동안 본인확인 결과를 보류(해시·생년월일·성별) + 상대 계정
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS merge_with UUID")
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS pending_ci_hash TEXT")
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS pending_birth_date DATE")
    await conn.execute("ALTER TABLE identity_verifications ADD COLUMN IF NOT EXISTS pending_gender TEXT")
    await am.ensure_schema(conn)
    _schema_ready = True
    logger.info("[identity] schema ensured")


# ── 설정·온보딩 상태 ─────────────────────────────────────────────────────────

@router.get("/config")
async def identity_config():
    return {"enabled": iv.enabled(), "provider": iv.provider_name() if iv.enabled() else None,
            "social_onboarding_enabled": _onboarding_enabled(),
            "account_merge_enabled": _merge_enabled()}  # [AccountMerge] 앱 ⭐ 본인인증 유도 팝업은 true 일 때만


def _parse_since(name: str) -> Optional[datetime]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        logger.warning("[identity] bad %s", name)
        return None


async def _identity_required(conn, user_id, row) -> bool:
    """[EmailIdentity 2026-10-12] IDENTITY_REQUIRED_SINCE 이후 가입한 계정(가입 방법 무관)은 본인확인 전까지 가입 마무리.
    기존 회원은 그대로(⭐ 유도 팝업 대상). 예외: 운영·공식 계정, 보호자가 본인확인 후 동의한 어린이 계정."""
    since = _parse_since("IDENTITY_REQUIRED_SINCE")
    if not since or not iv.enabled() or (row and row["is_verified"]):
        return False
    u = await conn.fetchrow("SELECT created_at, role FROM users WHERE id = $1", user_id)
    if not u or not u["created_at"] or u["created_at"] < since or (u["role"] or "user") != "user":
        return False
    guardian_ok = await conn.fetchval(
        """SELECT 1 FROM guardian_consents WHERE child_user_id = $1 AND status = 'agreed'
           AND guardian_verified_at IS NOT NULL LIMIT 1""", user_id)
    return not guardian_ok


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
    identity_required = await _identity_required(conn, user_id, row)
    enabled = _onboarding_enabled()
    # [EmailIdentity 2026-10-12] 신규 가입은 이메일·소셜 모두 휴대폰 본인확인 필수 — 앱(구 빌드 포함)은
    # birth_date_missing 일 때 「휴대폰 본인확인」을 띄우므로, 본인확인 전이면 생년월일을 '확인 안 됨'으로 알린다.
    required = enabled and (bool(missing) or birth_missing or identity_required)
    if required:
        logger.info("[identity] onboarding required user=%s missing=%s birth_missing=%s identity=%s minor=%s",
                    _u8(user_id), missing, birth_missing, identity_required, is_minor)
    return {
        "enabled": enabled,
        "required": required,
        "missing_consents": missing,
        "birth_date_missing": birth_missing or (identity_required and iv.enabled()),
        "identity_required": identity_required,
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
<body><h2>{message}</h2><p>잠시 후 MAIDOL로 돌아가요.</p>
<p><a href="https://app.maidol.ai.kr/" style="display:inline-block;margin-top:12px;padding:12px 20px;border-radius:12px;background:#a855f7;color:#fff;text-decoration:none;font-weight:700">MAIDOL로 돌아가기</a></p>
<script>setTimeout(function(){{try{{window.close()}}catch(e){{}}setTimeout(function(){{location.replace("https://app.maidol.ai.kr/")}},600)}},1200)</script></body></html>"""
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
            "SELECT id FROM users WHERE ci_hash = $1 AND id <> $2 AND COALESCE(account_status,'') NOT IN ('withdrawn','merged') LIMIT 1",
            h, user_id,
        )
        if dup and _merge_enabled():
            # [AccountMerge] 같은 사람 계정 — 결과는 보류하고 앱 통합 화면에서 남길 계정을 고르게 한다
            await conn.execute(
                """UPDATE identity_verifications SET merge_with = $2, pending_ci_hash = $3,
                          pending_birth_date = $4, pending_gender = $5 WHERE id = $1""",
                row["id"], dup, h, result.birth_date, result.gender,
            )
            logger.info("[identity] merge candidate rid=%s user=%s other=%s", row["id"][:8], _u8(user_id), _u8(dup))
            return {"status": "merge_candidate", "under_14": is_under_14(result.birth_date),
                    "error": "같은 분 명의의 계정이 있어요. MAIDOL로 돌아가 계정을 하나로 합쳐 주세요."}
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
        if row["purpose"] == "guardian":
            outcome = await _apply_guardian_result(conn, row, provider.name, result)
        else:
            outcome = await _apply_result(conn, row, provider.name, result)
    except iv.IdentityVerifyError as e:
        outcome = {"status": "failed", "error": str(e)}
        logger.warning("[identity] verify failed rid=%s err=%s", rid[:8], str(e)[:80])
    except Exception:
        logger.exception("[identity] callback error rid=%s", rid[:8])
        outcome = {"status": "failed", "error": "본인확인 처리 중 문제가 생겼어요. 다시 시도해 주세요."}
    await conn.execute(
        "UPDATE identity_verifications SET status=$2, error=$3, under_14=$4, reason=$5, completed_at=now() WHERE id=$1",
        rid, outcome["status"], outcome.get("error"), outcome.get("under_14"), outcome.get("reason"),
    )
    ret = row["return_url"]
    if ret:
        sep = "&" if "?" in ret else "?"
        return RedirectResponse(url=f"{ret}{sep}{urlencode({'rid': rid, 'status': outcome['status']})}", status_code=303)
    if outcome["status"] == "merge_candidate":
        return _done_page("본인확인이 끝났어요. MAIDOL로 돌아가 계정을 하나로 합쳐 주세요.")
    return _done_page("본인확인이 끝났어요." if outcome["status"] == "verified" else (outcome.get("error") or "본인확인에 실패했어요."))


# ── 보호자 본인확인(만 14세 미만 회원의 법정대리인) ─────────────────────────────

def _age(bd, today=None) -> int:
    from datetime import date as _d
    t = today or _d.today()
    return t.year - bd.year - ((t.month, t.day) < (bd.month, bd.day))


async def _apply_guardian_result(conn, row, provider_name: str, result: "iv.IdentityResult") -> dict:
    """보호자 인증 결과 반영 — 성인·아이 본인 아님 확인 후 guardian_consents 에 인증 표시(해시만 저장)."""
    if _age(result.birth_date) < GUARDIAN_MIN_AGE:
        logger.info("[identity.guardian] not adult rid=%s", row["id"][:8])
        return {"status": "failed", "reason": "not_adult", "error": "보호자(법정대리인)는 만 19세 이상 성인만 본인확인할 수 있어요."}
    h = iv.ci_hash(result.ci)
    child_hash = await conn.fetchval("SELECT ci_hash FROM users WHERE id = $1", row["user_id"])
    if h and child_hash and h == child_hash:
        logger.warning("[identity.guardian] same person as child rid=%s", row["id"][:8])
        return {"status": "failed", "reason": "same_person", "error": "자녀 본인이 아닌 보호자가 본인확인을 해 주세요."}
    upd = await conn.execute(
        """UPDATE guardian_consents SET guardian_verified_at = now(), guardian_di_hash = $2, method = $3
           WHERE id = $1 AND status = 'pending'""",
        row["consent_id"], h, provider_name,
    )
    if not upd.endswith(" 1"):
        return {"status": "failed", "reason": "consent_closed", "error": "이미 처리됐거나 만료된 보호자 동의 요청이에요."}
    logger.info("[identity.guardian] verified rid=%s child=%s", row["id"][:8], _u8(row["user_id"]))
    return {"status": "verified", "under_14": False}


class GuardianStartBody(BaseModel):
    consent_token: str
    return_url: Optional[str] = None   # 보호자 페이지 복귀 주소(https://maidol.ai.kr/guardian/ 로 시작할 때만)


async def _pending_consent(conn, token: str):
    return await conn.fetchrow(
        """SELECT id, child_user_id, status, requested_at, guardian_verified_at, method FROM guardian_consents
           WHERE consent_token = $1""", (token or "").strip())


@router.post("/guardian/start")
async def guardian_identity_start(body: GuardianStartBody, conn=Depends(get_pg)):
    """보호자 동의 페이지에서 호출 — 로그인 없음(consent_token 이 자격). → {request_id, url}"""
    try:
        provider = iv.get_provider()
    except iv.IdentityNotConfigured:
        return JSONResponse(status_code=503, content={"error": "본인확인은 준비 중이에요.", "code": "identity_not_configured"})
    await _ensure_schema(conn)
    gc = await _pending_consent(conn, body.consent_token)
    if not gc or gc["status"] != "pending":
        return JSONResponse(status_code=404, content={"error": "유효하지 않거나 이미 처리된 보호자 동의 요청이에요."})
    rid = secrets.token_urlsafe(18)
    ret = (body.return_url or "").strip()
    if not ret.startswith("https://maidol.ai.kr/guardian/"):
        ret = "https://maidol.ai.kr/guardian/?" + urlencode({"token": body.consent_token.strip(), "identity": "done"})
    await conn.execute(
        """INSERT INTO identity_verifications (id, user_id, purpose, provider, return_url, consent_id)
           VALUES ($1, $2, 'guardian', $3, $4, $5)""",
        rid, gc["child_user_id"], provider.name, ret, gc["id"],
    )
    logger.info("[identity.guardian] start rid=%s child=%s provider=%s", rid[:8], _u8(gc["child_user_id"]), provider.name)
    return {"request_id": rid, "url": f"{_public_base()}/api/identity/page/{rid}"}


@router.get("/guardian/status/{consent_token}")
async def guardian_identity_status(consent_token: str, conn=Depends(get_pg)):
    """보호자 페이지용 — 보호자 본인확인 완료 여부(개인정보 없음)."""
    await _ensure_schema(conn)
    gc = await _pending_consent(conn, consent_token)
    if not gc:
        return JSONResponse(status_code=404, content={"error": "요청을 찾을 수 없어요."})
    last = await conn.fetchrow(
        "SELECT status, error, reason FROM identity_verifications WHERE consent_id = $1 ORDER BY created_at DESC LIMIT 1", gc["id"])
    verified = gc["guardian_verified_at"] is not None
    return {"consent_status": gc["status"], "guardian_verified": verified, "method": gc["method"],
            "reason": (None if verified else ((last["reason"] or ("cancelled" if last["status"] == "cancelled" else None)) if last else None)),
            "last_attempt": ({"status": last["status"], "error": last["error"]} if last else None)}


@router.get("/result/{rid}")
async def identity_result(rid: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    await _ensure_schema(conn)
    row = await conn.fetchrow(
        "SELECT user_id, status, error, under_14 FROM identity_verifications WHERE id = $1", rid,
    )
    if not row or str(row["user_id"]) != str(current_user["id"]):
        return JSONResponse(status_code=404, content={"error": "요청을 찾을 수 없어요."})
    return {"status": row["status"], "under_14": row["under_14"], "error": row["error"],
            "merge_candidate": row["status"] == "merge_candidate"}


# ── 같은 사람 계정 통합(1인 1계정) [AccountMerge 2026-10-12] ─────────────────────

_MERGE_GONE = {"error": "통합 요청을 찾을 수 없거나 시간이 지났어요. 본인확인을 다시 해 주세요.", "code": "merge_not_found"}


async def _merge_row(conn, rid: str, current_user):
    """본인 요청이고 통합 대상이 있는 본인확인 요청만 — 아니면 None."""
    row = await conn.fetchrow(
        """SELECT id, user_id, status, merge_with, pending_ci_hash, pending_birth_date, pending_gender, completed_at
           FROM identity_verifications WHERE id = $1""", (rid or "").strip())
    if not row or str(row["user_id"]) != str(current_user["id"]) or not row["merge_with"]:
        return None
    return row


def _fresh(row) -> bool:
    return bool(row["completed_at"]) and datetime.now(timezone.utc) - row["completed_at"] <= MERGE_TTL


async def _token_for(conn, user_id) -> dict:
    """T 로 로그인 — 토큰 + 세션(로그인과 같은 방식). 앱은 이어서 /api/auth/me 로 전체 정보를 받는다."""
    from .auth import _create_token, _save_session
    u = await conn.fetchrow(
        """SELECT id, email, nickname, profile_image, role, account_status, birth_date, is_verified
           FROM users WHERE id = $1""", user_id)
    uid = str(u["id"])
    role = u["role"] or "user"
    token = _create_token(uid, u["email"], u["nickname"], role)
    await _save_session(uid, u["email"], u["nickname"], u["profile_image"], role=role)
    return {"token": token, "user": {
        "id": uid, "email": u["email"], "nickname": u["nickname"], "profile_image": u["profile_image"], "role": role,
        "account_status": u["account_status"] or "active", "is_verified": bool(u["is_verified"]),
        "birth_date": u["birth_date"].isoformat() if u["birth_date"] else None}}


async def _merge_finished(conn, rid: str) -> dict:
    """통합 완료 응답 — 남긴 계정(T) 토큰을 주고, 남기지 않은 계정(S) 세션은 지운다."""
    from ..database.mongodb import get_mongo
    j = await get_mongo()[am.JOURNAL].find_one({"_id": rid}, {"source": 1, "target": 1, "status": 1})
    if not j or j.get("status") != "done":
        return {"status": "running"}
    out = await _token_for(conn, uuid.UUID(j["target"]))
    await am.drop_session(j["source"])
    return {"status": "merged", **out}


@router.get("/merge/preview")
async def merge_preview(rid: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    await _ensure_schema(conn)
    row = await _merge_row(conn, rid, current_user)
    if not row or row["status"] != "merge_candidate" or not _fresh(row):
        return JSONResponse(status_code=404, content=_MERGE_GONE)
    cur = row["user_id"]
    cards = [await am.account_card(conn, cur, cur), await am.account_card(conn, row["merge_with"], cur)]
    return {"accounts": [c for c in cards if c], "blocked_reason": await am.blocked_reason(conn, cur, row["merge_with"])}


class MergeConfirmBody(BaseModel):
    rid: str
    keep_user_id: str


@router.post("/merge/confirm")
async def merge_confirm(body: MergeConfirmBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    await _ensure_schema(conn)
    row = await _merge_row(conn, body.rid, current_user)
    if not row:
        return JSONResponse(status_code=404, content=_MERGE_GONE)
    if row["status"] == "merged":
        return await _merge_finished(conn, row["id"])
    if row["status"] != "merge_candidate" or not _fresh(row):
        return JSONResponse(status_code=404, content=_MERGE_GONE)
    cur, other = row["user_id"], row["merge_with"]
    keep = (body.keep_user_id or "").strip()
    if keep not in (str(cur), str(other)):
        return JSONResponse(status_code=400, content={"error": "남길 계정을 다시 골라 주세요.", "code": "invalid_keep"})
    target = uuid.UUID(keep)
    source = other if target == cur else cur
    from ..database.mongodb import get_mongo
    if not await get_mongo()[am.JOURNAL].find_one({"_id": row["id"]}, {"_id": 1}):
        reason = await am.blocked_reason(conn, cur, other)
        if reason:
            return JSONResponse(status_code=409, content={"error": "지금은 계정을 합칠 수 없어요.", "blocked_reason": reason})
    src_email = await conn.fetchval("SELECT email FROM users WHERE id = $1", source)
    verify = {"ci_hash": row["pending_ci_hash"], "gender": row["pending_gender"],
              "birth_date": row["pending_birth_date"].isoformat() if row["pending_birth_date"] else None,
              "verify_provider": f"identity:{iv.provider_name()}" if iv.enabled() else "identity",
              "source_email_hash": am.email_hash(src_email)}
    state = await am.start_journal(row["id"], source, target, cur, verify)
    if state == "done":
        return await _merge_finished(conn, row["id"])
    if state != "new":
        return {"status": "running"}  # 이미 진행 중(두 번 누름) — 앱은 /merge/status 로 확인
    logger.info("[identity] merge confirm rid=%s keep=%s current=%s", row["id"][:8], _u8(target), _u8(cur))
    result = await am.run_merge(conn, row["id"])
    if result.get("status") != "done":
        return {"status": "running"}
    return await _merge_finished(conn, row["id"])


class MergeDeclineBody(BaseModel):
    rid: str


@router.post("/merge/decline")
async def merge_decline(body: MergeDeclineBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """[내 계정이 아니에요] — 통합하지 않고 이번 본인확인은 반영하지 않는다(보류 값 파기)."""
    await _ensure_schema(conn)
    row = await _merge_row(conn, body.rid, current_user)
    if not row or row["status"] != "merge_candidate":
        return JSONResponse(status_code=404, content=_MERGE_GONE)
    from ..database.mongodb import get_mongo
    if await get_mongo()[am.JOURNAL].find_one({"_id": row["id"]}, {"_id": 1}):
        return JSONResponse(status_code=409, content={"error": "이미 통합을 시작했어요.", "code": "merge_started"})
    await conn.execute(
        """UPDATE identity_verifications SET status = 'declined', pending_ci_hash = NULL, pending_birth_date = NULL,
                  pending_gender = NULL WHERE id = $1 AND status = 'merge_candidate'""", row["id"])
    logger.info("[identity] merge declined rid=%s user=%s", row["id"][:8], _u8(row["user_id"]))
    return {"status": "declined"}


@router.get("/merge/status")
async def merge_status(rid: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    await _ensure_schema(conn)
    row = await _merge_row(conn, rid, current_user)
    if not row:
        return JSONResponse(status_code=404, content=_MERGE_GONE)
    if row["status"] == "merge_candidate":
        from ..database.mongodb import get_mongo
        if await get_mongo()[am.JOURNAL].find_one({"_id": row["id"], "status": "running"}, {"_id": 1}):
            await am.resume_pending_merges(conn)
            row = await _merge_row(conn, rid, current_user)
    if row["status"] == "merged":
        return await _merge_finished(conn, row["id"])
    if row["status"] in ("merge_candidate",):
        from ..database.mongodb import get_mongo
        started = await get_mongo()[am.JOURNAL].find_one({"_id": row["id"]}, {"_id": 1})
        return {"status": "running" if started else "merge_candidate"}
    return {"status": row["status"]}
