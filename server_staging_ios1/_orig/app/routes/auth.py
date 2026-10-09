import hashlib
import io
import json
import logging
import mimetypes
import re
import secrets
import unicodedata
import uuid

import bcrypt
import jwt
from bson import ObjectId
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps
from pydantic import BaseModel

from ..auth import (
    ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE, JWT_SECRET, JWT_ALGORITHM, get_current_user,
)
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..models.user import (
    UserCreate, LoginRequest, ProfileUpdate, WithdrawRequest,
    GuardianConsentRequest, GuardianDecision, MeConsentsBody,
    validate_demographics, parse_birth_date, validate_sns_links,
    validate_nationality, is_under_14,
    validate_signup_consents, CONSENT_KEYS, GENDERS, CONSENT_VERSION_MAX_LEN,
    validate_password,
)
from ..services.guardian_notify import send_guardian_consent_notification
from ..services.mailer import (
    send_password_reset_email,
    send_password_reset_social_notice,
)
from ..services.official import (
    NICKNAME_MAX_LEN, NICKNAME_MIN_LEN, clean_nickname, ensure_mutual_follow, is_reserved_nickname,
    nickname_rule_reason,
)
from ..services.guardian_verify import verify_guardian_identity
from ..services.points_service import credit_points
from ..services.referral_service import ensure_referral_code, normalize_code, resolve_referrer
from ..services import kids_policy  # v3.232 어린이 모드(킬 스위치 OFF 면 전부 no-op)
from ..services import guardian_manage  # v3.233 보호자 관리(E5) — 동의 완료 시 관리 링크 발급
from ..services.word_filter import word_filter_response  # v3.232 G1

router = APIRouter(prefix="/api/auth")

logger = logging.getLogger(__name__)

SESSION_TTL = 7 * 24 * 3600  # 7 days in seconds

_DEMO_FIELDS = ("birth_date", "gender", "region")

# GuardSquad — 보호자 동의 토큰 만료 (requested_at 기준 판정)
GUARDIAN_TOKEN_TTL_HOURS = 72

# v160 ①엔터명 정규화 — 접미어 리터럴("엔터"/"Ent." 등 변형은 스코프 외) + DB varchar(100) 정합
COMPANY_NAME_SUFFIX = "엔터테인먼트"
COMPANY_NAME_MAX_LEN = 100
# 보호자 연락처 형식 (숫자/+/-/공백, 8~20자) — 값 자체는 로그 금지
_GUARDIAN_PHONE_RE = re.compile(r"^[0-9+\-\s]{8,20}$")


def _parse_sns_links_value(value) -> list:
    """asyncpg JSONB 는 str 로 올 수 있음 — 안전하게 list 로 정규화 (실패 시 [])."""
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return value if isinstance(value, list) else []


def _normalize_company_name(value):
    """v160 ①엔터테인먼트명 정규화 (설계 1) — trim 후 "엔터테인먼트"로 안 끝나면
    " 엔터테인먼트"(공백 1개+접미어) 추가, 이미 끝나면 중복 없이 그대로(trim 만).
    빈값/None 은 무변경 통과. 값 원문 로그 금지 — appended bool 만.

    반환 (normalized, error): 정규화 결과가 100자(컬럼 제한) 초과면 (None, 에러메시지).
    """
    if value is None:
        return value, None
    trimmed = value.strip()
    if not trimmed:
        return value, None
    appended = not trimmed.endswith(COMPANY_NAME_SUFFIX)
    normalized = f"{trimmed} {COMPANY_NAME_SUFFIX}" if appended else trimmed
    if len(normalized) > COMPANY_NAME_MAX_LEN:
        return None, "엔터테인먼트명이 너무 깁니다. 100자 이내로 입력해주세요."
    logger.info("[auth] company_name normalized appended=%s", appended)
    return normalized, None


# ---------------------------------------------------------------------------
# v3.230 S1 — 닉네임 변경 규칙 (대표 결정 D3 기본값 + TESTPLAN NK-S1/NK-S2 오케스트레이터 결정)
#   정규화: NFC → 공백류 1칸 → 제어(Cc)·서식(Cf, 제로폭 등)·한글 채움 문자 **제거** → 공백 1칸 → 앞뒤 trim.
#   저장값 = 정규화 값. 규칙: 2~15자(코드포인트), 서로게이트·사용자정의 문자 금지, 예약어 차단(공식 계정명 +
#   아래 목록 — 대소문자·공백 무시 완전일치), 중복 금지(정규화·대소문자 무시, 본인·탈퇴 계정 제외),
#   변경 간격 제한 없음. 본인 현재 닉네임과 정규화 후 같으면 규칙·중복 검사 없이 200(no-op — 기존 중복
#   그룹 보호), 대소문자만 다르면 규칙만 검사. 닉네임 원문은 로그 금지(길이만).
# 앱 계약: 400 {"error":"nickname_invalid","reason":…,"message":…} / 409 {"error":"nickname_taken","message":…}
# ---------------------------------------------------------------------------
# v3.230c — NICKNAME_MIN_LEN/MAX_LEN·판정 함수는 services/official.py 공용(import).
# v3.230b — 정규화(clean_nickname)·예약어(is_reserved_nickname)는 services/official.py 공용 구현으로 이동
# (가입·소셜 가입·닉네임 변경 동일 규칙). 아래 이름은 기존 호출부 호환용 별칭.
# 예약어 = 공식 계정명 + official.NICK_EXTRA_RESERVED, 비교 키 = NFKC → 공백류·_·.·- 제거 → casefold(완전일치).
# 예: "maidol official"·"Maidol.Official"·"ＭＡＩＤＯＬ－ｏｆｆｉｃｉａｌ"·"관-리-자" 모두 차단. 저장값은 clean_nickname 그대로.
_NICK_MESSAGES = {
    "empty": "닉네임을 입력해주세요.",
    "length": f"닉네임은 {NICKNAME_MIN_LEN}~{NICKNAME_MAX_LEN}자로 입력해주세요.",
    "chars": "닉네임에 사용할 수 없는 문자가 있어요.",
    "reserved": "사용할 수 없는 닉네임이에요.",
}
NICKNAME_TAKEN_MESSAGE = "이미 사용 중인 닉네임이에요."
# PG 쪽 중복 비교식 — 파이썬 _clean_nickname 과 같은 방향(NFC·제로폭/채움 제거·공백 1칸·trim·lower).
# PG 16 실측(09-25): normalize(…, NFC)·\uXXXX 문자 클래스 동작 확인(읽기 쿼리).
_NICK_PG_REMOVE_CLASS = "[\\u0001-\\u0008\\u000E-\\u001B\\u007F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\u115F\\u1160\\u3164\\uFFA0\\u2800]"
_NICK_DUP_SQL = (
    "SELECT id FROM users"
    " WHERE id <> $2"
    " AND lower(btrim(regexp_replace(regexp_replace(normalize(nickname, NFC), '" + _NICK_PG_REMOVE_CLASS + "', '', 'g'), '\\s+', ' ', 'g'))) = lower($1)"
    " AND COALESCE(account_status, 'active') <> 'withdrawn'"
    " LIMIT 1"
)


_clean_nickname = clean_nickname
_is_reserved = is_reserved_nickname


_nickname_rule_reason = nickname_rule_reason  # v3.230c — 공용 판정(empty→chars→length→reserved)

# v3.230c — 가입(이메일·보호자) 경로 400 문구(기존 가입 400 형식 {"error": 문구} 유지)
SIGNUP_NICK_ERRORS = {
    "empty": "이메일, 비밀번호, 닉네임은 필수입니다.",
    "chars": "사용할 수 없는 닉네임입니다.",
    "length": f"닉네임은 {NICKNAME_MIN_LEN}~{NICKNAME_MAX_LEN}자로 입력해주세요.",
    "reserved": "사용할 수 없는 닉네임입니다.",
}


def _nickname_invalid_response(reason: str):
    return JSONResponse(
        status_code=400,
        content={"error": "nickname_invalid", "reason": reason, "message": _NICK_MESSAGES.get(reason, _NICK_MESSAGES["empty"])},
    )


async def _nickname_taken(conn, nickname: str, user_id) -> bool:
    """정규화·대소문자 무시 중복 여부(본인·탈퇴 계정 제외). users.nickname 유니크 인덱스가 없어
    동시 변경 경합 창은 남는다(최종 확인 후 UPDATE — PLAN 회귀 위험 기록)."""
    row = await conn.fetchrow(_NICK_DUP_SQL, nickname, user_id)
    return row is not None


async def _refresh_session_nickname(user_id: str, nickname: str) -> bool:
    """Redis `session:{uid}` 의 nickname 만 교체 — 남은 TTL 유지, 다른 키 보존.
    이후 업로드·피드·댓글이 current_user["nickname"] 을 복사 저장하므로 필수 단계. 실패는 False(경고)."""
    u8 = str(user_id)[:8]
    try:
        redis = get_redis()
        key = f"session:{user_id}"
        raw = await redis.get(key)
        if not raw:
            logger.warning("[NicknameChange] session missing user=%s — next login picks up new nickname", u8)
            return False
        ttl = await redis.ttl(key)
        session = json.loads(raw)
        session["nickname"] = nickname
        payload = json.dumps(session)
        if ttl is not None and ttl > 0:
            await redis.setex(key, int(ttl), payload)
        elif ttl == -1:
            await redis.set(key, payload)
        else:
            logger.warning("[NicknameChange] session expired during refresh user=%s ttl=%s", u8, ttl)
            return False
        logger.info("[NicknameChange] session refreshed user=%s ttl=%s", u8, ttl)
        return True
    except Exception as e:
        logger.warning("[NicknameChange] session refresh failed user=%s: %s", u8, e)
        return False


def _mask_email(email: str) -> str:
    """이메일 로그 마스킹 (앞2자 + 도메인만)."""
    if not email or "@" not in email:
        return "?"
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}"


def _create_token(user_id: str, email: str, nickname: str, role: str = "user") -> str:
    payload = {
        "id": user_id,
        "email": email,
        "nickname": nickname,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token.decode("utf-8") if isinstance(token, bytes) else token


async def _save_session(user_id: str, email: str, nickname: str, profile_image: str = None, role: str = "user"):
    """Store session data in Redis."""
    redis = get_redis()
    session = {
        "id": user_id,
        "email": email,
        "nickname": nickname,
        "profile_image": profile_image,
        "role": role,
    }
    await redis.setex(f"session:{user_id}", SESSION_TTL, json.dumps(session))


async def _record_consents(conn, user_id, entries, version: str):
    """ConsentSquad — user_consents append INSERT + [consent] 로그 (개인정보 값 없음).

    entries: [(consent_key, agreed_bool), ...]
    """
    await conn.executemany(
        "INSERT INTO user_consents (user_id, consent_key, agreed, version) VALUES ($1, $2, $3, $4)",
        [(user_id, key, agreed, version) for key, agreed in entries],
    )
    for key, agreed in entries:
        logger.info(
            "[consent] recorded user=%s key=%s agreed=%s version=%s",
            str(user_id)[:8], key, agreed, version,
        )


def _signup_consent_entries(normalized: dict):
    """가입 시 기록할 5행 — 필수 4종 true + marketing 전달값(false 도 거부 이력으로 기록)."""
    return [
        ("terms", True), ("privacy", True), ("overseas", True), ("age14", True),
        ("marketing", normalized["marketing"]),
    ]


@router.post("/register", status_code=201)
async def register(body: UserCreate, conn=Depends(get_pg)):
    # v3.230b — 닉네임 저장용 정규화(제어·제로폭·채움 제거·공백 1칸·trim)를 먼저 적용하고 이후 전 과정
    # (예약어·INSERT·토큰·세션·응답)에 정규화 값을 쓴다. 기존 가입자 데이터는 건드리지 않는다.
    raw_len = len(body.nickname) if isinstance(body.nickname, str) else -1
    body.nickname = clean_nickname(body.nickname)
    logger.info("[SignupNickname] register raw_len=%d clean_len=%d", raw_len, len(body.nickname))
    if not body.email or not body.password or not body.nickname:
        return JSONResponse(status_code=400, content={"error": "이메일, 비밀번호, 닉네임은 필수입니다."})

    # OfficialSquad — 예약 닉네임 차단(v3.230b 공용 규칙) + v3.230c 길이 2~15. 공용 판정 순서 chars→length→reserved.
    nick_reason = nickname_rule_reason(body.nickname)
    if nick_reason:
        if nick_reason == "reserved":
            logger.warning("[official] reserved nickname blocked email=%s", _mask_email(body.email))
        logger.info("[SignupNickname] register rejected reason=%s clean_len=%d", nick_reason, len(body.nickname))
        return JSONResponse(status_code=400, content={"error": SIGNUP_NICK_ERRORS[nick_reason]})

    pw_err = validate_password(body.password)
    if pw_err:
        return JSONResponse(status_code=400, content={"error": pw_err})

    # ConsentSquad — 필수 동의 4종(terms/privacy/overseas/age14) + version 검증
    consents_norm, consent_err = validate_signup_consents(body.consents)
    if consent_err:
        logger.warning("[consent] register consents_invalid email=%s", _mask_email(body.email))
        return JSONResponse(status_code=400, content={"error": consent_err})

    # ConsentSquad — gender 필수화 (v125): 없거나 무효 → 400
    if body.gender not in GENDERS:
        logger.warning("[auth] register gender_missing email=%s", _mask_email(body.email))
        return JSONResponse(status_code=400, content={"error": "성별을 선택해주세요."})

    existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 등록된 이메일입니다."})

    # ReferralSquad(v154) — 추천코드 선검증 (INSERT 전) — 무효 코드면 가입 자체 거부(계정 미생성).
    # 미입력(빈값)은 정상 가입. 코드값은 비밀 아님 — 로그 허용.
    referrer_row = None
    referral_input = normalize_code(body.referral_code)
    if referral_input:
        logger.info(
            "[referral] register code check code=%s email=%s",
            referral_input, _mask_email(body.email),
        )
        referrer_row = await resolve_referrer(conn, referral_input)
        if not referrer_row:
            logger.info(
                "[referral] register invalid code=%s email=%s",
                referral_input, _mask_email(body.email),
            )
            return JSONResponse(
                status_code=400,
                content={"error": "추천코드가 올바르지 않습니다. 확인 후 다시 시도해주세요."},
            )

    # 인구통계 — 값이 주어진 필드만 검증(gender 는 위에서 필수 확인). 값 자체는 로그 금지.
    demo_err = validate_demographics(body.birth_date, body.gender, body.region)
    if demo_err:
        logger.warning("[auth] register demo_invalid email=%s", _mask_email(body.email))
        return JSONResponse(status_code=400, content={"error": demo_err})

    # GuardSquad — nationality(내/외국인, 선택) 검증
    nat_err = validate_nationality(body.nationality)
    if nat_err:
        logger.warning("[auth] register nationality_invalid email=%s", _mask_email(body.email))
        return JSONResponse(status_code=400, content={"error": nat_err})

    # v160 ①엔터명 정규화 — 접미어 자동 추가(중복 방지) + 100자 가드
    company_name_value, company_err = _normalize_company_name(body.company_name)
    if company_err:
        return JSONResponse(status_code=400, content={"error": company_err})

    birth_date_value, _ = parse_birth_date(body.birth_date)  # 검증 통과 후라 에러 없음

    # GuardSquad — 만14세 미만 게이트 (만나이 기준). register 경로는 항상 거부 —
    # 플래그 ON 이면 보호자 플로우(guardian-consent/request) 사용을 안내한다.
    if is_under_14(birth_date_value):
        logger.info(
            "[guardian] register under14 blocked email=%s flag=%s",
            _mask_email(body.email), settings.guardian_consent_enabled,
        )
        message = (
            "만 14세 미만 가입은 보호자 동의가 필요합니다. 보호자 동의 절차를 이용해주세요."
            if settings.guardian_consent_enabled
            else "만 14세 미만 가입은 보호자 동의 절차 준비 중입니다."
        )
        return JSONResponse(
            status_code=400,
            content={"error": "guardian_consent_required", "message": message},
        )

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    row = await conn.fetchrow(
        """INSERT INTO users (email, password_hash, nickname, company_name, display_title, birth_date, gender, region, nationality, account_status, referred_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
           RETURNING id, email, nickname, company_name, display_title, birth_date, gender, region, nationality, account_status, role""",
        body.email, password_hash, body.nickname,
        company_name_value, body.display_title or "대표",
        birth_date_value, body.gender, body.region, body.nationality,
        referrer_row["id"] if referrer_row else None,
    )

    user_id = str(row["id"])

    # ReferralSquad(v154) — 신규 유저 본인 추천코드 발급 (best-effort — 실패해도
    # startup 백필/my-code lazy 생성으로 커버되므로 가입 흐름은 계속)
    try:
        await ensure_referral_code(conn, row["id"])
    except Exception:
        logger.exception("[referral] register code issue failed user=%s", user_id[:8])

    # ConsentSquad — 동의 이력 5행 기록 (marketing 은 false 도 거부 이력으로 기록)
    await _record_consents(conn, row["id"], _signup_consent_entries(consents_norm), consents_norm["version"])

    role = row["role"] or "user"
    demo_count = sum(1 for f in _DEMO_FIELDS if getattr(body, f) is not None)
    logger.info("[auth] register ok user=%s demo_fields=%d", user_id[:8], demo_count)

    # StarEconSquad(v158) — 첫 가입 보너스 ⭐+50 (best-effort — Mongo 다운이어도
    # 가입 201 유지). day="-" + ref="-" → (유저, signup_bonus) 영구 1회 멱등.
    try:
        await credit_points(user_id, "signup_bonus", 50, ref="-", day="-")
        logger.info("[star-econ] signup_bonus +50 user=%s", user_id[:8])
    except Exception:
        logger.exception("[star-econ] signup_bonus failed user=%s", user_id[:8])

    # v3.224: 베타 기간(~2026-10-30 KST) 가입 추가 ⭐50 — 소셜 가입(oauth.py)·기존 회원 소급과 동일 키.
    await grant_beta_signup_bonus(user_id, source="email")

    # ReferralSquad(v154) — 가입 보상 ⭐50×2 (best-effort — Mongo 다운이어도 가입 201 유지).
    # credit_points 에 day="-" 명시 필수: 생략 시 KST 오늘이 멱등키에 들어가
    # 하루 뒤 재가입류 이중적립 가능. day="-" 로 (유저, 액션, 상대유저ID) 영구 1회 고정.
    referral_applied = False
    if referrer_row is not None:
        try:
            referrer_id = str(referrer_row["id"])
            if referrer_id == user_id:
                # 자기추천 방어 — 가입 시점엔 본인 코드가 없어 구조상 불가(2중 방어)
                logger.warning("[referral] self-referral blocked user=%s", user_id[:8])
            else:
                await credit_points(referrer_id, "referral_inviter", 50, ref=user_id, day="-")
                await credit_points(user_id, "referral_joiner", 50, ref=referrer_id, day="-")
                referral_applied = True
                logger.info(
                    "[referral] reward inviter=%s joiner=%s code=%s",
                    referrer_id[:8], user_id[:8], referral_input,
                )
        except Exception:
            logger.exception(
                "[referral] reward failed inviter=%s joiner=%s code=%s",
                str(referrer_row["id"])[:8], user_id[:8], referral_input,
            )

    # OfficialSquad — 신규 유저 ↔ maidol_official 자동 양방향 맞팔 (best-effort —
    # 공식 미해석/실패해도 가입 흐름 계속. startup 백필로도 커버됨)
    try:
        await ensure_mutual_follow(conn, user_id, provider="local")
    except Exception:
        logger.exception("[official] register mutual-follow failed user=%s", user_id[:8])

    token = _create_token(user_id, body.email, body.nickname, role)
    await _save_session(user_id, body.email, body.nickname, role=role)

    return {
        "message": "회원가입이 완료되었습니다.",
        "referral": {"applied": referral_applied},
        "token": token,
        "user": {
            "id": user_id,
            "email": body.email,
            "nickname": body.nickname,
            "company_name": row["company_name"],
            "display_title": row["display_title"],
            "birth_date": row["birth_date"].isoformat() if row["birth_date"] else None,
            "gender": row["gender"],
            "region": row["region"],
            "nationality": row["nationality"],
            "account_status": row["account_status"] or "active",
            "role": role,
            # v3.232 E1 — 어린이 모드 키 4종(가산, 추가 DB 조회 없음). 기존 키·값 불변.
            **kids_policy.kids_response_fields(user_id, row["birth_date"], False),
        },
    }


@router.get("/signup-config")
async def signup_config():
    """가입 플로우 설정 조회 (무인증) — FE 가 만14세 미만 분기 UI 를 결정."""
    return {"guardian_consent_enabled": settings.guardian_consent_enabled}


@router.post("/login")
async def login(body: LoginRequest, conn=Depends(get_pg)):
    if not body.email or not body.password:
        return JSONResponse(status_code=400, content={"error": "이메일과 비밀번호를 입력해주세요."})

    row = await conn.fetchrow(
        "SELECT id, email, password_hash, nickname, profile_image, company_name, display_title, role, is_banned, account_status, birth_date, is_verified FROM users WHERE email = $1",
        body.email,
    )
    if not row:
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    # v124 — 탈퇴 계정은 일반 실패와 동일 메시지로 차단 (계정 존재 노출 방지)
    if row["account_status"] == "withdrawn":
        logger.info("[withdraw] login blocked withdrawn user=%s", str(row["id"])[:8])
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if not row["password_hash"] or not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        return JSONResponse(status_code=401, content={"error": "이메일 또는 비밀번호가 올바르지 않습니다."})

    if row["is_banned"]:
        return JSONResponse(status_code=403, content={"error": "계정이 정지되었습니다."})

    # GuardSquad — 보호자 동의 대기 계정은 로그인 차단
    if row["account_status"] == "pending_consent":
        logger.info("[guardian] login blocked pending_consent user=%s", str(row["id"])[:8])
        return JSONResponse(status_code=403, content={"error": "보호자 동의 대기 중입니다."})

    # v3.233 — 보호자 동의 철회(suspended) 계정은 로그인 차단(곡·데이터는 보존)
    if row["account_status"] == "suspended":
        logger.info("[guardian] login blocked suspended user=%s", str(row["id"])[:8])
        return JSONResponse(
            status_code=403,
            content={"error": ACCOUNT_SUSPENDED_MESSAGE, "code": ACCOUNT_SUSPENDED_CODE},
        )

    user_id = str(row["id"])
    role = row["role"] or "user"
    token = _create_token(user_id, row["email"], row["nickname"], role)
    await _save_session(user_id, row["email"], row["nickname"], row["profile_image"], role=role)
    # v3.233 E1 — 어린이(킬 스위치 ON)면 보호자 허용값 1회 조회, 그 외 추가 조회 0
    _kids_perms = await kids_policy.response_permissions(user_id, row["birth_date"], conn)

    return {
        "message": "로그인 성공",
        "token": token,
        "user": {
            "id": user_id,
            "email": row["email"],
            "nickname": row["nickname"],
            "profile_image": row["profile_image"],
            "company_name": row["company_name"],
            "display_title": row["display_title"],
            "role": role,
            # v3.232 E1 — 앱이 이메일 로그인 직후 모드를 알 수 있게 가산(SELECT 에 birth_date·is_verified 만 추가).
            **kids_policy.kids_response_fields(user_id, row["birth_date"], row["is_verified"], _kids_perms),
        },
    }


# ---------------------------------------------------------------------------
# v3.207 ⑦ — 비밀번호 재설정 (이메일 6자리 코드, AWS SES / dev 폴백)
# ---------------------------------------------------------------------------
# 정책:
#  - request 는 **항상 동일 200 응답** — 이메일 존재/소셜 여부/rate limit 비노출.
#    소셜 전용 계정(password_hash NULL — :341 로그인 거부 근거와 동일 판정)은
#    코드 미발급, 안내는 메일로만(mailer.send_password_reset_social_notice).
#  - 코드: secrets 6자리, Redis 에 **bcrypt 해시로만** 저장(TTL 15분, 원문 미저장),
#    검증 시도 5회 초과 시 코드 파기. rate limit: 이메일당 1시간 5회.
#  - Redis 키는 이메일 원문 대신 SHA-256 축약 사용(키 공간에 이메일 비노출).
#  - 로그 prefix [pwreset] — 이메일 마스킹(_mask_email), 코드 값 미로그
#    (dev 폴백의 코드 로그는 mailer.py 소관 — 설계된 유일한 예외).

PASSWORD_RESET_CODE_KEY = "pwreset:code:{ekey}"
PASSWORD_RESET_ATTEMPTS_KEY = "pwreset:attempts:{ekey}"
PASSWORD_RESET_RATELIMIT_KEY = "pwreset:rl:{ekey}"
_PASSWORD_RESET_GENERIC = {
    "message": "가입된 이메일이라면 인증 코드를 발송했습니다. 메일함을 확인해주세요."
}
_PASSWORD_RESET_INVALID = "인증 코드가 올바르지 않거나 만료되었습니다."


class PasswordResetRequestBody(BaseModel):
    email: str


class PasswordResetConfirmBody(BaseModel):
    email: str
    code: str
    new_password: str


def _reset_email_key(email: str) -> str:
    """Redis 키용 이메일 식별자 — 소문자 정규화 후 SHA-256 앞 32자."""
    normalized = (email or "").strip().lower()
    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


@router.post("/password-reset/request")
async def password_reset_request(body: PasswordResetRequestBody, conn=Depends(get_pg)):
    """재설정 코드 요청 — 존재/소셜/제한 여부와 무관하게 항상 동일 200 응답."""
    email = (body.email or "").strip()
    masked = _mask_email(email)
    logger.info("[pwreset] request email=%s", masked)
    if not email or "@" not in email:
        # 형식 불량도 동일 응답 — 유효성 피드백으로 존재 탐지 불가
        return _PASSWORD_RESET_GENERIC
    try:
        redis = get_redis()
        ekey = _reset_email_key(email)

        # rate limit — 이메일당 1시간 N회 (초과 시에도 동일 응답, 발급만 skip)
        rl_key = PASSWORD_RESET_RATELIMIT_KEY.format(ekey=ekey)
        req_count = await redis.incr(rl_key)
        if int(req_count) == 1:
            await redis.expire(rl_key, 3600)
        if int(req_count) > settings.password_reset_hourly_limit:
            logger.info("[pwreset] rate-limited email=%s count=%s", masked, req_count)
            return _PASSWORD_RESET_GENERIC

        row = await conn.fetchrow(
            "SELECT id, password_hash, account_status FROM users WHERE LOWER(email) = LOWER($1)",
            email,
        )
        if not row or row["account_status"] == "withdrawn":
            logger.info("[pwreset] no eligible account email=%s", masked)
            return _PASSWORD_RESET_GENERIC

        # 소셜 전용 계정 — 비밀번호 없음(:341 로그인 거부와 동일 근거).
        # 코드 미발급, 안내는 메일로만(API 응답은 동일 유지 — 존재 비노출).
        if not row["password_hash"]:
            logger.info("[pwreset] social-only account email=%s", masked)
            await send_password_reset_social_notice(email)
            return _PASSWORD_RESET_GENERIC

        code = f"{secrets.randbelow(1000000):06d}"
        code_hash = bcrypt.hashpw(code.encode(), bcrypt.gensalt()).decode()
        ttl = settings.password_reset_code_ttl_minutes * 60
        await redis.setex(
            PASSWORD_RESET_CODE_KEY.format(ekey=ekey), ttl, code_hash
        )
        # 새 코드 발급 시 이전 시도 카운터 리셋
        await redis.delete(PASSWORD_RESET_ATTEMPTS_KEY.format(ekey=ekey))

        result = await send_password_reset_email(email, code)
        logger.info(
            "[pwreset] code issued email=%s method=%s ttl=%ds",
            masked, result.get("method"), ttl,
        )
        return _PASSWORD_RESET_GENERIC
    except Exception:
        # 내부 오류도 동일 응답 — 오류 편차로 존재 탐지 불가 (원인은 로그로만)
        logger.exception("[pwreset] request failed email=%s", masked)
        return _PASSWORD_RESET_GENERIC


@router.post("/password-reset/confirm")
async def password_reset_confirm(body: PasswordResetConfirmBody, conn=Depends(get_pg)):
    """코드 검증 + 새 비밀번호 등록 — 시도 5회 제한, 성공 시 코드/카운터 파기."""
    email = (body.email or "").strip()
    masked = _mask_email(email)
    code = (body.code or "").strip()
    logger.info("[pwreset] confirm email=%s", masked)
    if not email or not code:
        return JSONResponse(status_code=400, content={"error": _PASSWORD_RESET_INVALID})

    # 새 비밀번호 규칙 — 가입과 동일(validate_password 재사용)
    pw_err = validate_password(body.new_password)
    if pw_err:
        return JSONResponse(status_code=400, content={"error": pw_err})

    try:
        redis = get_redis()
        ekey = _reset_email_key(email)
        code_key = PASSWORD_RESET_CODE_KEY.format(ekey=ekey)
        attempts_key = PASSWORD_RESET_ATTEMPTS_KEY.format(ekey=ekey)

        # 시도 카운터 — 코드 TTL 과 동일 수명, 초과 시 코드 파기(브루트포스 차단)
        attempts = int(await redis.incr(attempts_key))
        if attempts == 1:
            await redis.expire(
                attempts_key, settings.password_reset_code_ttl_minutes * 60
            )
        if attempts > settings.password_reset_max_attempts:
            await redis.delete(code_key)
            logger.info("[pwreset] attempts exceeded email=%s attempts=%d", masked, attempts)
            return JSONResponse(
                status_code=429,
                content={"error": "시도 횟수를 초과했습니다. 인증 코드를 다시 요청해주세요."},
            )

        stored = await redis.get(code_key)
        if not stored:
            logger.info("[pwreset] code missing/expired email=%s", masked)
            return JSONResponse(status_code=400, content={"error": _PASSWORD_RESET_INVALID})
        stored_hash = stored.decode() if isinstance(stored, bytes) else str(stored)
        if not bcrypt.checkpw(code.encode(), stored_hash.encode()):
            logger.info("[pwreset] code mismatch email=%s attempts=%d", masked, attempts)
            return JSONResponse(status_code=400, content={"error": _PASSWORD_RESET_INVALID})

        row = await conn.fetchrow(
            "SELECT id, password_hash, account_status FROM users WHERE LOWER(email) = LOWER($1)",
            email,
        )
        # 코드가 맞아도 계정이 무효(탈퇴/소셜 전용)면 변경 불가 — 동일 문구
        if not row or row["account_status"] == "withdrawn" or not row["password_hash"]:
            logger.info("[pwreset] account not eligible email=%s", masked)
            return JSONResponse(status_code=400, content={"error": _PASSWORD_RESET_INVALID})

        new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
        await conn.execute(
            "UPDATE users SET password_hash = $1 WHERE id = $2", new_hash, row["id"]
        )
        await redis.delete(code_key)
        await redis.delete(attempts_key)
        logger.info("[pwreset] password updated user=%s", str(row["id"])[:8])
        return {"message": "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요."}
    except Exception:
        logger.exception("[pwreset] confirm failed email=%s", masked)
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.get("/me")
async def me(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    row = await conn.fetchrow(
        "SELECT id, email, nickname, profile_image, bio, plan, role, company_name, display_title, birth_date, gender, region, nationality, account_status, sns_links, is_verified, verify_provider, is_banned, restricted_until, created_at FROM users WHERE id = $1",
        current_user["id"] if not isinstance(current_user["id"], str) else __import__("uuid").UUID(current_user["id"]),
    )
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    # TrustSquad(v139) — 스트라이크 현황 (기존 응답 키 불변, strikes 만 추가)
    violation_count = await conn.fetchval(
        "SELECT COUNT(*) FROM user_violations WHERE user_id = $1", row["id"]
    )

    return {
        "strikes": {
            "count": int(violation_count or 0),
            "restricted_until": row["restricted_until"].isoformat() if row["restricted_until"] else None,
            "is_banned": bool(row["is_banned"]),
        },
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "plan": row["plan"],
        "role": row["role"] or "user",
        "company_name": row["company_name"],
        "display_title": row["display_title"],
        "birth_date": row["birth_date"].isoformat() if row["birth_date"] else None,
        "gender": row["gender"],
        "region": row["region"],
        "nationality": row["nationality"],
        "account_status": row["account_status"] or "active",
        "sns_links": _parse_sns_links_value(row["sns_links"]),
        "is_verified": bool(row["is_verified"]),
        "verify_provider": row["verify_provider"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        # v3.232 E1 — 어린이 모드 키 4종(가산, 이미 읽은 행으로 계산 — 추가 DB 조회 없음)
        **(await _kids_me_fields(row, conn)),
    }


async def _kids_me_fields(row, conn=None) -> dict:
    """v3.232 E1 — /auth/me 가산 키. 킬 스위치 ON 일 때만 DEBUG 로그(생년월일 값 미기록).
    v3.233 — kids_permissions = 보호자 관리 설정(어린이일 때만 1회 조회, 성인·OFF 는 0회)."""
    perms = await kids_policy.response_permissions(str(row["id"]), row["birth_date"], conn)
    fields = kids_policy.kids_response_fields(str(row["id"]), row["birth_date"], row["is_verified"], perms)
    if kids_policy.kids_enabled():
        logger.debug(
            "[kids] me user=%s age_group=%s restricted=%s locked=%s",
            str(row["id"])[:8], fields["age_group"], fields["kids_restricted"], fields["birth_date_locked"],
        )
    return fields


@router.patch("/me/profile")
async def update_profile(
    body: ProfileUpdate,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    # model_dump(exclude_unset=True)로 보낸 필드만 추출
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="변경할 필드가 없습니다.")

    user_id = current_user["id"] if not isinstance(current_user["id"], str) else __import__("uuid").UUID(current_user["id"])

    # v3.232 F7 — 어린이: 지역·SNS·소개글은 조용히 제외(200, 나머지 저장). 킬 스위치 OFF 면 DB 0회로 False.
    # ON 이면 생년월일 1회 조회로 어린이 판정과 E4 잠금 비교를 함께 한다.
    _kids_birth, _kids_child, _kids_birth_ok = await kids_policy.birth_and_child(current_user["id"], conn)
    if _kids_child:
        _kids_stripped = [k for k in ("region", "sns_links", "bio") if k in updates]
        for _k in _kids_stripped:
            updates.pop(_k)
        logger.info("[kids.profile] strip fields=%d user=%s", len(_kids_stripped), str(current_user["id"])[:8])

    # v3.230 S1 — 닉네임 변경: 규칙 검증(400)은 다른 필드보다 먼저, 중복(409)은 UPDATE 직전.
    # 미전달이면 이 블록·응답 모두 현행과 동일(nickname_synced 키 없음).
    nickname_set = "nickname" in updates
    nick_check_dup = False
    _nick_for_filter = None  # v3.232 G1 — 실제로 바뀌는 닉네임만 금칙어 검사
    if nickname_set:
        _u8 = str(current_user["id"])[:8]
        _raw_nick = updates.get("nickname")
        logger.info(
            "[NicknameChange] enter user=%s raw_len=%d other_fields=%d",
            _u8, len(_raw_nick) if isinstance(_raw_nick, str) else -1, len(updates) - 1,
        )
        new_nickname = _clean_nickname(_raw_nick)
        cur_clean = None
        try:
            _cur = await conn.fetchval("SELECT nickname FROM users WHERE id = $1", user_id)
            cur_clean = _clean_nickname(_cur) if isinstance(_cur, str) else None
        except Exception as e:
            logger.warning("[NicknameChange] current lookup failed user=%s: %s — full checks", _u8, e)
        same_exact = bool(cur_clean) and new_nickname == cur_clean
        same_ci = bool(cur_clean) and new_nickname.casefold() == cur_clean.casefold()
        if same_exact:
            logger.info("[NicknameChange] same as current user=%s len=%d -> no-op", _u8, len(new_nickname))
        else:
            nick_reason = _nickname_rule_reason(new_nickname)
            if nick_reason:
                logger.warning(
                    "[NicknameChange] rejected user=%s reason=%s clean_len=%d", _u8, nick_reason, len(new_nickname)
                )
                return _nickname_invalid_response(nick_reason)
        nick_check_dup = not same_ci
        updates["nickname"] = new_nickname
        _nick_for_filter = None if same_exact else new_nickname

    # SnsLinkSquad — sns_links 검증·정규화 (인증잠금 분기와 독립, 인증 유저도 수정 가능).
    # 명시적 null 은 빈 배열(전량 삭제)로 처리. URL 값 자체는 로그 금지.
    sns_links_set = "sns_links" in updates
    sns_links_value = None
    if sns_links_set:
        raw_links = updates.pop("sns_links")
        sns_links_value, sns_err = validate_sns_links(raw_links if raw_links is not None else [])
        if sns_err:
            logger.warning("[profile] sns_links invalid user=%s", str(current_user["id"])[:8])
            return JSONResponse(status_code=400, content={"error": sns_err})

    # v160 ①엔터명 정규화 — company_name 전달 시 접미어 자동 추가 + 100자 가드
    # (명시적 null 은 지우기로 무변경 통과). 값 원문 로그 금지.
    if "company_name" in updates:
        normalized_company, company_err = _normalize_company_name(updates["company_name"])
        if company_err:
            logger.warning("[profile] company_name too long user=%s", str(current_user["id"])[:8])
            return JSONResponse(status_code=400, content={"error": company_err})
        updates["company_name"] = normalized_company

    # v3.232 G1 — 금칙어(1차: 어린이만. 성인은 WORD_FILTER_ALL_USERS=false 면 즉시 통과·DB 0회). 닉네임 규칙 검증 뒤.
    _wf = await word_filter_response(
        current_user["id"], [_nick_for_filter, updates.get("company_name")], "profile", conn=conn, child=_kids_child
    )
    if _wf is not None:
        return _wf

    # GuardSquad — nationality 수정 허용 (자기신고: domestic/foreign/null, 인증잠금과 무관)
    if "nationality" in updates:
        nat_err = validate_nationality(updates["nationality"])
        if nat_err:
            logger.warning("[profile] nationality invalid user=%s", str(current_user["id"])[:8])
            return JSONResponse(status_code=400, content={"error": nat_err})

    # 본인인증 계정은 birth_date/gender 수정 금지 (명시 전달 자체를 차단, 값 유무 무관)
    if "birth_date" in updates or "gender" in updates:
        is_verified = await conn.fetchval(
            "SELECT is_verified FROM users WHERE id = $1", user_id
        )
        if is_verified:
            logger.warning(
                "[profile] update blocked verified_lock user=%s", str(current_user["id"])[:8]
            )
            return JSONResponse(
                status_code=400,
                content={"error": "본인인증으로 확인된 정보는 수정할 수 없습니다."},
            )

    # v3.232 E4 — 킬 스위치 ON: 이미 입력된 생년월일은 변경·삭제 불가(첫 입력·같은 값 재전송은 통과 —
    # 현 앱은 미인증이면 저장 때마다 birth_date 를 보낸다). 인증 계정 잠금(위)이 우선. OFF 면 조회 0회.
    # 같은 날짜의 다른 표기("2000-1-2"·"2000-01-02T00:00:00"·"2000.01.02" 등)는 날짜로 해석해 같으면 통과하고
    # 저장값을 기존 표기(YYYY-MM-DD)로 맞춘다(같은 값 재저장 — 값 변화 0).
    if "birth_date" in updates and kids_policy.kids_enabled() and _kids_birth_ok:
        _cur_birth = _kids_birth
        if _cur_birth is not None:
            _new_birth_raw = updates.get("birth_date")
            _new_birth = kids_policy.parse_birth_date_lenient(_new_birth_raw)
            if _new_birth is not None and _new_birth == _cur_birth:
                if _new_birth_raw != _cur_birth.isoformat():
                    logger.info("[kids.birth_lock] same date alt format normalized user=%s", str(current_user["id"])[:8])
                updates["birth_date"] = _cur_birth.isoformat()
            else:
                logger.warning(
                    "[kids.birth_lock] blocked user=%s op=%s",
                    str(current_user["id"])[:8], "clear" if not _new_birth_raw else "change",
                )
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "생년월일은 가입 후 바꿀 수 없어요. 고객센터로 문의해주세요.",
                        "code": "birth_date_locked",
                    },
                )

    # 인구통계 필드 검증 — 전달된 값만 검사 (명시적 null 은 지우기로 허용). 값 자체는 로그 금지.
    demo_err = validate_demographics(
        updates.get("birth_date"), updates.get("gender"), updates.get("region")
    )
    if demo_err:
        logger.warning("[profile] update demo_invalid user=%s", str(current_user["id"])[:8])
        return JSONResponse(status_code=400, content={"error": demo_err})

    # asyncpg DATE 바인딩은 date 객체 필요 — 검증 통과한 문자열을 변환 (명시적 null 은 그대로 지우기)
    if updates.get("birth_date") is not None:
        updates["birth_date"], _ = parse_birth_date(updates["birth_date"])

    # v3.230 S1 — 중복 닉네임 최종 확인(대소문자·공백 무시, 본인·탈퇴 제외) → 409. 조회 실패는 500 대신
    # 409 가 아닌 오류로 끊는다(중복 가능성을 모른 채 쓰지 않음).
    if nick_check_dup:
        try:
            taken = await _nickname_taken(conn, updates["nickname"], user_id)
        except Exception as e:
            logger.error("[NicknameChange] duplicate check failed user=%s: %s", _u8, e)
            return JSONResponse(status_code=500, content={"error": "닉네임 확인 중 오류가 발생했습니다."})
        if taken:
            logger.info("[NicknameChange] taken user=%s len=%d", _u8, len(updates["nickname"]))
            return JSONResponse(
                status_code=409,
                content={"error": "nickname_taken", "message": NICKNAME_TAKEN_MESSAGE},
            )

    # 동적 SET 절 구성 (파라미터 바인딩 사용, SQL injection 방지)
    set_clauses = []
    values = []
    idx = 1
    for key, val in updates.items():
        set_clauses.append(f"{key} = ${idx}")
        values.append(val)
        idx += 1
    if sns_links_set:
        set_clauses.append(f"sns_links = ${idx}::jsonb")
        values.append(json.dumps(sns_links_value))
        idx += 1
    values.append(user_id)

    if not set_clauses:
        # v3.232 F7 — 어린이가 제외 대상 필드만 보낸 경우(성인은 도달 불가: 빈 요청은 위에서 400) → 저장 없이 현재값 200
        row = await conn.fetchrow(
            "SELECT id, email, nickname, profile_image, bio, plan, role, company_name, display_title, birth_date, gender, region, nationality, account_status, sns_links, created_at, is_verified FROM users WHERE id = $1",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        logger.info("[kids.profile] nothing to update after strip user=%s", str(row["id"])[:8])
    else:
        query = f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ${idx} RETURNING id, email, nickname, profile_image, bio, plan, role, company_name, display_title, birth_date, gender, region, nationality, account_status, sns_links, created_at, is_verified"
        row = await conn.fetchrow(query, *values)
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    demo_count = sum(1 for f in _DEMO_FIELDS if f in updates)
    logger.info(
        "[profile] update ok user=%s fields=%d demo_fields=%d",
        str(row["id"])[:8], len(updates) + (1 if sns_links_set else 0), demo_count,
    )
    if sns_links_set:
        logger.info(
            "[profile] sns_links updated user=%s count=%d",
            str(row["id"])[:8], len(sns_links_value),
        )
    # v3.230 S1 — 닉네임 저장 뒤: ① 세션 닉네임 교체(이후 복사 저장 경로가 새 이름을 쓰게)
    # ② 곡·피드·댓글·앨범 사본 소급(멱등, never raise). 둘 다 실패해도 저장 응답은 200.
    nickname_synced = None
    if nickname_set:
        _uid_str = str(row["id"])
        logger.info("[NicknameChange] db updated user=%s len=%d", _uid_str[:8], len(row["nickname"] or ""))
        session_ok = await _refresh_session_nickname(_uid_str, row["nickname"])
        sync = {}
        try:
            from ..services.nickname_sync import sync_user_nickname

            sync = await sync_user_nickname(get_mongo(), _uid_str, row["nickname"], source="patch")
        except Exception as e:
            logger.warning("[NicknameChange] sync failed user=%s: %s", _uid_str[:8], e)
            sync = {"errors": ["sync"]}
        nickname_synced = {
            "tracks": int(sync.get("tracks", 0)),
            "feeds": int(sync.get("feeds", 0)),
            "comments": int(sync.get("comments", 0)),
            "albums": int(sync.get("albums", 0)),
            "session": bool(session_ok),
            "ok": not sync.get("errors") and bool(session_ok),
        }
        logger.info(
            "[NicknameChange] done user=%s tracks=%d feeds=%d comments=%d albums=%d session=%s errors=%s",
            _uid_str[:8], nickname_synced["tracks"], nickname_synced["feeds"], nickname_synced["comments"],
            nickname_synced["albums"], session_ok, sync.get("errors") or "-",
        )
    # v3.190(대표): 프로필 완성 보상 — 생년월일·성별·지역 3종이 모두 채워지면 영구 1회 ⭐10.
    # (본인인증 verify_bonus ⭐30 과 별개. day="-"+ref="-" → (유저, profile_bonus) 멱등 —
    #  값을 지웠다 다시 채워도 재지급되지 않는다. best-effort: 실패해도 저장 응답은 정상)
    profile_bonus_granted = False
    # v3.232 A5 — 어린이는 지역을 입력할 수 없으므로 완성 조건 = 생년월일 && 성별(성인 조건 불변).
    _bonus_kids = kids_policy.is_child_from_row(row["id"], row["birth_date"])
    if row["birth_date"] and row["gender"] and (row["region"] or _bonus_kids):
        try:
            profile_bonus_granted = await credit_points(
                str(row["id"]), "profile_bonus", 10, ref="-", day="-"
            )
            if profile_bonus_granted:
                if _bonus_kids:
                    logger.info("[star-econ] profile_bonus +10 user=%s kids=1", str(row["id"])[:8])
                else:
                    logger.info("[star-econ] profile_bonus +10 user=%s", str(row["id"])[:8])
        except Exception:
            logger.exception("[star-econ] profile_bonus failed user=%s", str(row["id"])[:8])
    resp = {
        "profile_bonus_granted": profile_bonus_granted,
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "plan": row["plan"],
        "role": row["role"],
        "company_name": row["company_name"],
        "display_title": row["display_title"],
        "birth_date": row["birth_date"].isoformat() if row["birth_date"] else None,
        "gender": row["gender"],
        "region": row["region"],
        "nationality": row["nationality"],
        "account_status": row["account_status"] or "active",
        "sns_links": _parse_sns_links_value(row["sns_links"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        # v3.232 E1 — 어린이 모드 키 4종(가산) · v3.233 보호자 허용값(어린이만 1회 조회)
        **kids_policy.kids_response_fields(
            str(row["id"]), row["birth_date"], row["is_verified"],
            await kids_policy.response_permissions(str(row["id"]), row["birth_date"], conn),
        ),
    }
    if nickname_synced is not None:
        resp["nickname_synced"] = nickname_synced
    return resp


# ---------------------------------------------------------------------------
# ConsentSquad — 동의 이력 조회/기록 (소셜 온보딩, 기능 시점 photo_ai/voice_ai, 마케팅 변경)
# ---------------------------------------------------------------------------

@router.post("/me/consents")
async def record_my_consents(body: MeConsentsBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """동의 append 기록 — body {consents: [{key, agreed}], version}. key 화이트리스트 7종 외 400."""
    version = (body.version or "").strip() if isinstance(body.version, str) else ""
    if not version or len(version) > CONSENT_VERSION_MAX_LEN:
        return JSONResponse(status_code=400, content={"error": "동의 version 정보가 올바르지 않습니다."})
    if not isinstance(body.consents, list) or not body.consents:
        return JSONResponse(status_code=400, content={"error": "consents 항목이 필요합니다."})

    entries = []
    for item in body.consents:
        if not isinstance(item, dict):
            return JSONResponse(status_code=400, content={"error": "consents 항목 형식이 올바르지 않습니다."})
        key = item.get("key")
        agreed = item.get("agreed")
        if key not in CONSENT_KEYS:
            return JSONResponse(status_code=400, content={"error": "허용되지 않은 동의 항목입니다."})
        if not isinstance(agreed, bool):
            return JSONResponse(status_code=400, content={"error": "agreed 는 boolean 이어야 합니다."})
        entries.append((key, agreed))

    user_id = uuid.UUID(str(current_user["id"]))
    await _record_consents(conn, user_id, entries, version)
    return {"recorded": len(entries)}


@router.get("/me/consents")
async def get_my_consents(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """key 별 최신 동의 상태 — {consents: {key: {agreed, version, at}}}."""
    user_id = uuid.UUID(str(current_user["id"]))
    rows = await conn.fetch(
        """SELECT DISTINCT ON (consent_key) consent_key, agreed, version, created_at
           FROM user_consents WHERE user_id = $1
           ORDER BY consent_key, created_at DESC, id DESC""",
        user_id,
    )
    return {
        "consents": {
            r["consent_key"]: {
                "agreed": r["agreed"],
                "version": r["version"],
                "at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        }
    }


# ---------------------------------------------------------------------------
# GuardSquad — 법정대리인 동의 플로우 (만14세 미만 가입, 어댑터는 현재 mock)
# 로그 규칙: token 앞 8자만, guardian_name/guardian_phone 값 금지(길이만).
# ---------------------------------------------------------------------------


def _mask_nickname(nickname: str) -> str:
    """아동 닉네임 마스킹 (첫 글자 + *) — 동의 고지 페이지 표시용."""
    if not nickname:
        return "*"
    return nickname[0] + "*" * max(len(nickname) - 1, 1)


def _consent_expires_at(requested_at: datetime) -> datetime:
    if requested_at.tzinfo is None:
        requested_at = requested_at.replace(tzinfo=timezone.utc)
    return requested_at + timedelta(hours=GUARDIAN_TOKEN_TTL_HOURS)


def _consent_expired(requested_at: datetime) -> bool:
    return datetime.now(timezone.utc) > _consent_expires_at(requested_at)


async def _mark_consent_expired(conn, token: str):
    await conn.execute(
        "UPDATE guardian_consents SET status = 'expired' WHERE consent_token = $1 AND status = 'pending'",
        token,
    )
    logger.info("[guardian] token expired token=%s", token[:8])


@router.post("/guardian-consent/request", status_code=201)
async def guardian_consent_request(body: GuardianConsentRequest, conn=Depends(get_pg)):
    """만14세 미만 가입 요청 — pending 계정 + 동의 레코드 생성 후 notify 어댑터 호출."""
    if not settings.guardian_consent_enabled:
        logger.info("[guardian] request blocked flag_off")
        return JSONResponse(status_code=503, content={"error": "보호자 동의 절차는 준비 중입니다."})

    # v3.230b — 아동 가입 경로도 이메일 가입과 같은 닉네임 정규화·예약어 차단(구: 예약어 검사 없음)
    raw_len = len(body.nickname) if isinstance(body.nickname, str) else -1
    body.nickname = clean_nickname(body.nickname)
    logger.info("[SignupNickname] guardian raw_len=%d clean_len=%d", raw_len, len(body.nickname))
    if not body.email or not body.password or not body.nickname:
        return JSONResponse(status_code=400, content={"error": "이메일, 비밀번호, 닉네임은 필수입니다."})
    nick_reason = nickname_rule_reason(body.nickname)  # v3.230c — 이메일 가입과 동일 판정·문구
    if nick_reason:
        if nick_reason == "reserved":
            logger.warning("[official] reserved nickname blocked (guardian) email=%s", _mask_email(body.email))
        logger.info("[SignupNickname] guardian rejected reason=%s clean_len=%d", nick_reason, len(body.nickname))
        return JSONResponse(status_code=400, content={"error": SIGNUP_NICK_ERRORS[nick_reason]})

    pw_err = validate_password(body.password)
    if pw_err:
        return JSONResponse(status_code=400, content={"error": pw_err})

    # ConsentSquad — 아동 가입 경로도 동일: 필수 동의 4종 + version 검증, gender 필수
    consents_norm, consent_err = validate_signup_consents(body.consents)
    if consent_err:
        logger.warning("[consent] guardian_request consents_invalid email=%s", _mask_email(body.email))
        return JSONResponse(status_code=400, content={"error": consent_err})
    if body.gender not in GENDERS:
        return JSONResponse(status_code=400, content={"error": "성별을 선택해주세요."})

    demo_err = validate_demographics(body.birth_date, body.gender, body.region)
    if demo_err:
        return JSONResponse(status_code=400, content={"error": demo_err})
    nat_err = validate_nationality(body.nationality)
    if nat_err:
        return JSONResponse(status_code=400, content={"error": nat_err})

    # v160 ①엔터명 정규화 — 아동(보호자동의) 가입 경로도 동일 적용
    company_name_value, company_err = _normalize_company_name(body.company_name)
    if company_err:
        return JSONResponse(status_code=400, content={"error": company_err})

    birth_date_value, _ = parse_birth_date(body.birth_date)
    if birth_date_value is None:
        return JSONResponse(status_code=400, content={"error": "birth_date 는 필수입니다."})
    if not is_under_14(birth_date_value):
        return JSONResponse(
            status_code=400,
            content={"error": "만 14세 이상은 일반 회원가입을 이용해주세요."},
        )

    guardian_name = (body.guardian_name or "").strip()
    guardian_phone = (body.guardian_phone or "").strip()
    if not guardian_name:
        return JSONResponse(status_code=400, content={"error": "보호자 이름을 입력해주세요."})
    if not _GUARDIAN_PHONE_RE.match(guardian_phone):
        return JSONResponse(status_code=400, content={"error": "보호자 연락처 형식이 올바르지 않습니다."})

    existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 등록된 이메일입니다."})

    # pending 계정 생성 — 비밀번호 해시 등 정상 저장, 토큰(JWT)은 미발급
    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user_row = await conn.fetchrow(
        """INSERT INTO users (email, password_hash, nickname, company_name, display_title, birth_date, gender, region, nationality, account_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_consent')
           RETURNING id""",
        body.email, password_hash, body.nickname,
        company_name_value, body.display_title or "대표",
        birth_date_value, body.gender, body.region, body.nationality,
    )
    child_user_id = user_row["id"]

    # ConsentSquad — pending 아동 계정에도 동의 이력 5행 기록
    await _record_consents(conn, child_user_id, _signup_consent_entries(consents_norm), consents_norm["version"])

    consent_token = secrets.token_urlsafe(32)
    await conn.execute(
        """INSERT INTO guardian_consents (child_user_id, guardian_name, guardian_phone, consent_token, status, method)
           VALUES ($1, $2, $3, $4, 'pending', 'mock')""",
        child_user_id, guardian_name, guardian_phone, consent_token,
    )
    logger.info(
        "[guardian] request ok child=%s token=%s name_len=%d phone_len=%d",
        str(child_user_id)[:8], consent_token[:8], len(guardian_name), len(guardian_phone),
    )

    notify = await send_guardian_consent_notification(consent_token, guardian_name, guardian_phone)

    return {
        "status": "pending",
        "message": "보호자 동의 요청이 접수되었습니다. 보호자 동의 완료 후 계정이 활성화됩니다.",
        "consent_url": notify.get("consent_url"),  # 테스트모드(mock) — FE 가 바로 표시
    }


@router.get("/guardian-consent/{token}")
async def guardian_consent_notice(token: str, conn=Depends(get_pg)):
    """동의 고지 데이터 조회 (무인증, 보호자 링크) — 아동 닉네임은 마스킹."""
    row = await conn.fetchrow(
        """SELECT gc.consent_token, gc.status, gc.requested_at, gc.decided_at,
                  COALESCE(gc.consent_type, 'signup') AS consent_type, u.nickname
           FROM guardian_consents gc JOIN users u ON u.id = gc.child_user_id
           WHERE gc.consent_token = $1""",
        token,
    )
    if not row:
        logger.info("[guardian] notice token invalid token=%s", token[:8])
        return JSONResponse(status_code=404, content={"error": "유효하지 않은 동의 링크입니다."})

    if row["status"] in ("agreed", "rejected", "revoked"):  # v3.233 revoked(동의 철회)도 처리 완료
        logger.info("[guardian] notice already decided token=%s status=%s", token[:8], row["status"])
        return JSONResponse(status_code=409, content={"error": "이미 처리된 동의 요청입니다.", "status": row["status"]})

    if row["status"] == "expired" or _consent_expired(row["requested_at"]):
        await _mark_consent_expired(conn, token)
        return JSONResponse(status_code=404, content={"error": "동의 링크가 만료되었습니다."})

    # FaceGuardSquad(v135) — consent_type 별 고지 문구 분기 (face_biometric: "1회 동의=계속 이용" 명시)
    consent_type = row["consent_type"] or "signup"
    if consent_type == "face_biometric":
        notice = (
            "자녀의 얼굴 인증(생체정보 처리)에 대한 법정대리인 동의 안내입니다. "
            "한 번 동의하시면 이후 얼굴 인증 이용 시 계속 적용됩니다(언제든 철회 가능)."
        )
        collection_items = [
            "보호자 이름", "보호자 연락처", "동의 여부", "동의 일시",
            "자녀 얼굴 정보(암호화 저장, 대조 목적)",
        ]
    else:
        notice = "만 14세 미만 아동의 회원가입에 대한 법정대리인 동의 안내입니다."
        collection_items = ["보호자 이름", "보호자 연락처", "동의 여부", "동의 일시"]

    logger.info("[guardian] notice ok token=%s type=%s", token[:8], consent_type)
    return {
        "status": "pending",
        "consent_type": consent_type,
        "child_nickname": _mask_nickname(row["nickname"]),
        "requested_at": row["requested_at"].isoformat() if row["requested_at"] else None,
        "expires_at": _consent_expires_at(row["requested_at"]).isoformat() if row["requested_at"] else None,
        "notice": notice,
        "collection_items": collection_items,
    }


@router.post("/guardian-consent/{token}/decide")
async def guardian_consent_decide(token: str, body: GuardianDecision, conn=Depends(get_pg)):
    """보호자 동의/거부 결정 — verify 어댑터(현재 mock) 통과 후 계정 상태 전환."""
    row = await conn.fetchrow(
        """SELECT consent_token, child_user_id, status, requested_at, guardian_name, guardian_phone,
                  COALESCE(consent_type, 'signup') AS consent_type
           FROM guardian_consents WHERE consent_token = $1""",
        token,
    )
    if not row:
        logger.info("[guardian] decide token invalid token=%s", token[:8])
        return JSONResponse(status_code=404, content={"error": "유효하지 않은 동의 링크입니다."})

    if row["status"] in ("agreed", "rejected", "revoked"):  # v3.233 revoked(동의 철회)도 처리 완료
        logger.info("[guardian] decide already decided token=%s status=%s", token[:8], row["status"])
        return JSONResponse(status_code=409, content={"error": "이미 처리된 동의 요청입니다.", "status": row["status"]})

    if row["status"] == "expired" or _consent_expired(row["requested_at"]):
        await _mark_consent_expired(conn, token)
        return JSONResponse(status_code=404, content={"error": "동의 링크가 만료되었습니다."})

    # 보호자 본인인증 어댑터 (현재 mock — 즉시 통과)
    verify = await verify_guardian_identity(token, row["guardian_name"] or "", row["guardian_phone"] or "")
    if not verify.get("verified"):
        logger.warning("[guardian] decide verify failed token=%s", token[:8])
        return JSONResponse(status_code=403, content={"error": "보호자 본인인증에 실패했습니다."})

    new_status = "agreed" if body.agree else "rejected"
    updated = await conn.fetchrow(
        """UPDATE guardian_consents SET status = $1, decided_at = now()
           WHERE consent_token = $2 AND status = 'pending'
           RETURNING id, child_user_id""",
        new_status, token,
    )
    if not updated:  # 동시 요청 등으로 그 사이 상태가 바뀜
        return JSONResponse(status_code=409, content={"error": "이미 처리된 동의 요청입니다."})

    consent_type = row["consent_type"] or "signup"
    manage_url = None  # v3.233 — 가입 동의(agree) 때만 관리 링크 발급(목 모드면 응답에 포함)
    if consent_type == "face_biometric":
        # FaceGuardSquad(v135) — 얼굴 인증 보호자 동의: 계정 상태는 건드리지 않고
        # 아동 계정의 user_consents 에 face_biometric 동의/거부를 append (1회 동의=영구, 철회 가능).
        await _record_consents(
            conn, updated["child_user_id"], [("face_biometric", body.agree)], "guardian"
        )
        if body.agree:
            message = (
                "얼굴 인증 이용 동의가 완료되었습니다. "
                "한 번 동의하시면 이후 얼굴 인증 이용 시 계속 적용됩니다(언제든 철회 가능)."
            )
        else:
            message = "동의가 거부되었습니다. 자녀는 얼굴 인증 기능을 이용할 수 없습니다."
    elif body.agree:
        await conn.execute(
            "UPDATE users SET account_status = 'active' WHERE id = $1",
            updated["child_user_id"],
        )
        message = "동의가 완료되었습니다. 아동 계정이 활성화되었습니다."
        # v229 (B-6) — 보호자 동의 승인 보상 ⭐ (본인인증과 동일 액수, 단일 설정).
        # decide 는 pending→agreed 전이가 1회만 성공하므로 자연 멱등. best-effort.
        if settings.verify_reward_points > 0:
            from ..services.points_service import grant_points
            await grant_points(
                str(updated["child_user_id"]),
                "guardian_consent_reward",
                settings.verify_reward_points,
                note="보호자 동의 승인 보상",
            )
        # v3.233 §2 — 보호자 관리 토큰 발급 + 관리 링크 발송(mock: 응답 manage_url). best-effort —
        # 실패해도 동의·활성화는 끝난 상태(관리 링크는 고객센터 재발송 admin API 로 복구).
        try:
            manage_url = await guardian_manage.issue_manage_link(
                conn, updated["child_user_id"], updated["id"],
                row["guardian_name"] or "", row["guardian_phone"] or "",
            )
        except Exception as e:  # noqa: BLE001
            logger.error(
                "[guardian] manage issue failed token=%s child=%s err=%s",
                token[:8], str(updated["child_user_id"])[:8], type(e).__name__,
            )
    else:
        # 거부 — 계정은 pending_consent 로 비활성 유지 (로그인 403)
        message = "동의가 거부되었습니다. 아동 계정은 활성화되지 않습니다."

    logger.info(
        "[guardian] decide ok token=%s type=%s agree=%s child=%s",
        token[:8], consent_type, body.agree, str(updated["child_user_id"])[:8],
    )
    resp = {"status": new_status, "message": message}
    if manage_url:
        resp["manage_url"] = manage_url
    return resp


# ---------------------------------------------------------------------------
# Profile image (MinIO 저장 + 프록시 서빙)
# ---------------------------------------------------------------------------

ALLOWED_PROFILE_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB
PROFILE_IMAGE_SIZE = 512  # 512x512 정사각


def _process_profile_image(contents: bytes) -> bytes:
    """EXIF 회전 보정 → 중앙 정사각 크롭 → 512x512 리사이즈 → JPEG q88 bytes."""
    img = Image.open(io.BytesIO(contents))
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    img = img.resize((PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE), Image.LANCZOS)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def _delete_profile_object(object_name: str, user_tag: str) -> None:
    """기존 profiles/ 오브젝트 best-effort 삭제 (실패해도 warning 만)."""
    try:
        get_minio().remove_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        logger.info("[profile-img] minio delete ok user=%s", user_tag)
    except Exception:
        logger.warning("[profile-img] minio delete failed user=%s", user_tag)


async def _update_session_profile_image(current_user: dict, profile_image):
    """Redis 세션의 profile_image 갱신 (기존 _save_session 관행 재사용)."""
    await _save_session(
        current_user["id"],
        current_user.get("email"),
        current_user.get("nickname"),
        profile_image,
        role=current_user.get("role", "user"),
    )


@router.post("/me/profile-image")
async def upload_profile_image(
    image: UploadFile = File(...),
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    # v3.232 F7 — 어린이 프로필 사진 업로드 차단(삭제는 허용). 킬 스위치 OFF 면 DB 0회로 통과.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "profile_image", conn)
    if _kids_block is not None:
        return _kids_block
    user_tag = str(current_user["id"])[:8]
    contents = await image.read()
    content_type = image.content_type or ""
    logger.info(
        "[profile-img] enter user=%s content_type=%s size=%d",
        user_tag, content_type, len(contents),
    )

    if content_type not in ALLOWED_PROFILE_IMAGE_TYPES:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 이미지 형식입니다. (jpeg/png/webp)"})
    if len(contents) > MAX_PROFILE_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 5MB 이하여야 합니다."})

    try:
        processed = _process_profile_image(contents)
    except Exception:
        logger.warning("[profile-img] process failed user=%s", user_tag)
        return JSONResponse(status_code=400, content={"error": "이미지를 처리할 수 없습니다."})
    logger.info("[profile-img] processed user=%s bytes=%d", user_tag, len(processed))

    user_id = uuid.UUID(current_user["id"]) if isinstance(current_user["id"], str) else current_user["id"]
    old_image = await conn.fetchval("SELECT profile_image FROM users WHERE id = $1", user_id)

    object_name = f"profiles/{current_user['id']}/{uuid.uuid4().hex}.jpg"
    get_minio().put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(processed),
        length=len(processed),
        content_type="image/jpeg",
    )
    logger.info("[profile-img] minio put ok user=%s", user_tag)

    # 기존 이미지가 우리 스토리지(profiles/)면 best-effort 삭제. 외부 URL(http...)은 무시.
    if old_image and old_image.startswith("profiles/"):
        _delete_profile_object(old_image, user_tag)

    await conn.execute("UPDATE users SET profile_image = $1 WHERE id = $2", object_name, user_id)
    await _update_session_profile_image(current_user, object_name)

    logger.info("[profile-img] done user=%s", user_tag)
    return {"profile_image": object_name}


@router.delete("/me/profile-image")
async def delete_profile_image(
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    user_tag = str(current_user["id"])[:8]
    user_id = uuid.UUID(current_user["id"]) if isinstance(current_user["id"], str) else current_user["id"]
    old_image = await conn.fetchval("SELECT profile_image FROM users WHERE id = $1", user_id)

    if old_image and old_image.startswith("profiles/"):
        _delete_profile_object(old_image, user_tag)

    await conn.execute("UPDATE users SET profile_image = NULL WHERE id = $1", user_id)
    await _update_session_profile_image(current_user, None)

    logger.info("[profile-img] deleted user=%s", user_tag)
    return {"profile_image": None}


@router.get("/profile-image/{object_name:path}")
async def profile_image_proxy(object_name: str):
    """프로필 이미지 MinIO 프록시 (무인증). profiles/ 이외 경로는 404."""
    if not object_name.startswith("profiles/") or ".." in object_name:
        return JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})

    try:
        response = get_minio().get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        media_type = mimetypes.guess_type(object_name)[0] or "image/jpeg"
        return Response(content=data, media_type=media_type)
    except Exception:
        return JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})


@router.post("/logout")
async def logout(current_user=Depends(get_current_user)):
    """Remove session from Redis."""
    redis = get_redis()
    await redis.delete(f"session:{current_user['id']}")
    return {"message": "로그아웃 되었습니다."}


@router.delete("/me")
async def withdraw_account(
    body: WithdrawRequest,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """v124 회원탈퇴 (소프트 삭제) — 개인정보 즉시 파기, 콘텐츠는 '탈퇴한 사용자' 명의 유지.

    처리 순서: ①users 익명화 ②MinIO 프로필 삭제 ③follows 삭제 ④ad_wishlist 삭제
    ⑤Mongo tracks 닉네임 치환 ⑤b본인 피드 일괄 삭제(댓글·좋아요 동반)
    ⑤c남의 피드의 내 댓글 삭제(comment_count 보정) ⑤d내 좋아요 철회(like_count 보정)
    ⑥Redis 세션 삭제. ①실패만 500, 나머지는 warning+계속. (v132 인스타그램 방식 피드 정리)
    """
    user_tag = str(current_user["id"])[:8]
    logger.info("[withdraw] enter user=%s", user_tag)

    if (body.confirm_text or "").strip() != "회원탈퇴":
        logger.info("[withdraw] confirm_text mismatch user=%s", user_tag)
        return JSONResponse(status_code=400, content={"error": "확인 문구가 일치하지 않습니다."})

    user_id = uuid.UUID(current_user["id"]) if isinstance(current_user["id"], str) else current_user["id"]

    # ① users 익명화 UPDATE — 이 단계 실패만 500
    try:
        old_image = await conn.fetchval("SELECT profile_image FROM users WHERE id = $1", user_id)
        await conn.execute(
            """UPDATE users SET
                   email = $2,
                   password_hash = NULL,
                   nickname = '탈퇴한사용자',
                   profile_image = NULL,
                   bio = NULL,
                   company_name = NULL,
                   display_title = NULL,
                   provider = NULL,
                   provider_user_id = NULL,
                   birth_year = NULL,
                   birth_date = NULL,
                   gender = NULL,
                   region = NULL,
                   verify_provider = NULL,
                   nationality = NULL,
                   sns_links = '[]'::jsonb,
                   is_verified = FALSE,
                   account_status = 'withdrawn',
                   updated_at = now()
               WHERE id = $1""",
            user_id,
            f"withdrawn_{uuid.uuid4().hex}@removed.invalid",
        )
        logger.info("[withdraw] users anonymized user=%s", user_tag)
    except Exception:
        logger.exception("[withdraw] users anonymize failed user=%s", user_tag)
        return JSONResponse(status_code=500, content={"error": "탈퇴 처리 중 오류가 발생했습니다."})

    # ② 기존 프로필 이미지 MinIO 삭제 (best-effort)
    if old_image and old_image.startswith("profiles/"):
        _delete_profile_object(old_image, user_tag)

    # ③ follows 양방향 삭제
    try:
        res = await conn.execute(
            "DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1", user_id
        )
        logger.info("[withdraw] follows_deleted=%s user=%s", res.split()[-1], user_tag)
    except Exception:
        logger.warning("[withdraw] follows delete failed user=%s", user_tag)

    # ④ ad_wishlist 삭제
    try:
        res = await conn.execute("DELETE FROM ad_wishlist WHERE user_id = $1", user_id)
        logger.info("[withdraw] wishlist_deleted=%s user=%s", res.split()[-1], user_tag)
    except Exception:
        logger.warning("[withdraw] wishlist delete failed user=%s", user_tag)

    # ⑤ Mongo tracks uploader_nickname 치환 (비정규화 필드 — 표시/검색용)
    try:
        result = await get_mongo().tracks.update_many(
            {"uploader_id": str(user_id)},
            {"$set": {"uploader_nickname": "탈퇴한 사용자"}},
        )
        logger.info("[withdraw] tracks_renamed=%d user=%s", result.modified_count, user_tag)
    except Exception:
        logger.warning("[withdraw] tracks rename failed user=%s", user_tag)

    # ⑤b 본인 피드 일괄 삭제 — 종속 댓글(Mongo)·좋아요(PG) 동반 정리 (v132)
    try:
        mongo = get_mongo()
        own_feed_ids = [
            str(doc["_id"])
            async for doc in mongo.feeds.find({"author_id": str(user_id)}, {"_id": 1})
        ]
        own_comments_deleted = 0
        own_likes_deleted = 0
        if own_feed_ids:
            res_c = await mongo.feed_comments.delete_many({"feed_id": {"$in": own_feed_ids}})
            own_comments_deleted = res_c.deleted_count
            res_l = await conn.execute(
                "DELETE FROM feed_likes WHERE feed_id = ANY($1::varchar[])", own_feed_ids
            )
            own_likes_deleted = res_l.split()[-1]
        res_f = await mongo.feeds.delete_many({"author_id": str(user_id)})
        logger.info(
            "[withdraw] feeds_deleted=%d own_feed_comments_deleted=%d own_feed_likes_deleted=%s user=%s",
            res_f.deleted_count, own_comments_deleted, own_likes_deleted, user_tag,
        )
    except Exception:
        logger.warning("[withdraw] own feeds delete failed user=%s", user_tag)

    # ⑤c 남의 피드에 단 내 댓글 삭제 — comment_count 보정 (v132, ⑤b 이후라 본인 피드 몫은 소거됨)
    try:
        mongo = get_mongo()
        grouped = await mongo.feed_comments.aggregate([
            {"$match": {"author_id": str(user_id)}},
            {"$group": {"_id": "$feed_id", "n": {"$sum": 1}}},
        ]).to_list(length=None)
        res_c = await mongo.feed_comments.delete_many({"author_id": str(user_id)})
        affected = 0
        for g in grouped:
            fid = g["_id"]
            if not ObjectId.is_valid(str(fid)):
                continue
            await mongo.feeds.update_one(
                {"_id": ObjectId(str(fid))}, {"$inc": {"comment_count": -int(g["n"])}}
            )
            affected += 1
        await mongo.feeds.update_many(
            {"comment_count": {"$lt": 0}}, {"$set": {"comment_count": 0}}
        )
        logger.info(
            "[withdraw] my_comments_deleted=%d feeds_affected=%d user=%s",
            res_c.deleted_count, affected, user_tag,
        )
    except Exception:
        logger.warning("[withdraw] my comments delete failed user=%s", user_tag)

    # ⑤d 내가 누른 좋아요 철회 — like_count 보정 (v132)
    try:
        mongo = get_mongo()
        rows = await conn.fetch("SELECT feed_id FROM feed_likes WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM feed_likes WHERE user_id = $1", user_id)
        for row in rows:
            fid = row["feed_id"]
            if not ObjectId.is_valid(str(fid)):
                continue
            await mongo.feeds.update_one(
                {"_id": ObjectId(str(fid))}, {"$inc": {"like_count": -1}}
            )
        await mongo.feeds.update_many(
            {"like_count": {"$lt": 0}}, {"$set": {"like_count": 0}}
        )
        logger.info("[withdraw] my_likes_deleted=%d user=%s", len(rows), user_tag)
    except Exception:
        logger.warning("[withdraw] my likes delete failed user=%s", user_tag)

    # ⑥ Redis 세션 삭제 — 기존 토큰 즉시 무효화
    try:
        deleted = await get_redis().delete(f"session:{current_user['id']}")
        logger.info("[withdraw] session_deleted=%s user=%s", bool(deleted), user_tag)
    except Exception:
        logger.warning("[withdraw] session delete failed user=%s", user_tag)

    logger.info("[withdraw] done user=%s", user_tag)
    return {"message": "탈퇴가 완료되었습니다."}



# v3.224 — 베타 기간 가입 추가 보상 ⭐50 (대표 결정 2026-09-24: 지금~2026-10-30 가입자 + 기존 회원 소급).
# 액션 "beta_signup_bonus", day="-"+ref="-" → (유저, 액션) 영구 1회 멱등 — 가입 경로(이메일·구글·카카오)와
# 소급 스크립트(backfill_beta_bonus_v3224.py)가 같은 키를 쓰므로 어떤 조합이든 1인 1회.
BETA_SIGNUP_BONUS_AMOUNT = 50
BETA_SIGNUP_BONUS_UNTIL_KST = (2026, 10, 30)  # 이 날짜(KST) 23:59:59 까지 가입분 지급


def _beta_signup_bonus_active(now_utc=None) -> bool:
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    kst = _tz(_td(hours=9))
    now_kst = (now_utc or _dt.now(_tz.utc)).astimezone(kst)
    y, m, d = BETA_SIGNUP_BONUS_UNTIL_KST
    return now_kst < _dt(y, m, d, tzinfo=kst) + _td(days=1)


async def grant_beta_signup_bonus(user_id: str, source: str) -> bool:
    """베타 기간 가입 추가 ⭐50 — 기간 밖이면 no-op. best-effort(절대 raise 안 함)."""
    if not _beta_signup_bonus_active():
        logger.info("[star-econ] beta_signup_bonus skip (period ended) user=%s src=%s", user_id[:8], source)
        return False
    try:
        granted = await credit_points(user_id, "beta_signup_bonus", BETA_SIGNUP_BONUS_AMOUNT, ref="-", day="-")
        logger.info("[star-econ] beta_signup_bonus +%d user=%s src=%s granted=%s",
                    BETA_SIGNUP_BONUS_AMOUNT, user_id[:8], source, granted)
        return bool(granted)
    except Exception:
        logger.exception("[star-econ] beta_signup_bonus failed user=%s src=%s", user_id[:8], source)
        return False
