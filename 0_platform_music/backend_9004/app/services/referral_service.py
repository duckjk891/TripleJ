"""
MAIDOL Referral (v154) - 앱 추천(리퍼럴) 코드 생성/조회/백필.

users.referral_code: 4자리(혼동문자 0/O/1/I/L 제외 31종 charset), 부분 유니크 인덱스.
불변성은 `UPDATE ... WHERE referral_code IS NULL` 조건으로 보장(이미 있으면 덮어쓰기 불가).
전 유저 커버 3중: startup 백필 + register 시 생성 + GET /my-code lazy 생성(소셜 가입자).
코드값은 비밀이 아님 — 로그 허용. 로그 prefix `[referral]` + user id 앞 8자 + code.
"""

import logging
import re
import secrets

import asyncpg

logger = logging.getLogger(__name__)

# 혼동문자 0/O/1/I/L 제외 31종 (대문자+숫자)
REFERRAL_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REFERRAL_CODE_LEN = 4
REFERRAL_CODE_RE = re.compile(r"^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$")

# 코드 충돌(UniqueViolation) 시 재시도 상한 — 31^4=923,521 조합이라 실충돌은 드묾
_MAX_RETRIES = 20


def generate_code() -> str:
    """4자리 추천코드 생성 (secrets — 예측 불가)."""
    return "".join(secrets.choice(REFERRAL_CHARSET) for _ in range(REFERRAL_CODE_LEN))


def normalize_code(code) -> str:
    """입력 추천코드 정규화 — trim + 대문자. 빈값/비문자열은 ''."""
    if not isinstance(code, str):
        return ""
    return code.strip().upper()


async def ensure_referral_code(conn, user_id) -> str:
    """유저의 추천코드 보장 — 이미 있으면 그대로 반환, 없으면 생성(충돌 재시도).

    `WHERE referral_code IS NULL` 조건으로 불변성 보장: 동시 요청이 먼저 발급했으면
    UPDATE 가 0행 매치 → 재조회로 그 값을 반환한다. 재시도 소진/유저 없음이면 raise
    (호출부 best-effort 처리).
    """
    user_tag = str(user_id)[:8]
    logger.info("[referral] ensure enter user=%s", user_tag)

    existing = await conn.fetchval(
        "SELECT referral_code FROM users WHERE id = $1", user_id
    )
    if existing:
        logger.info("[referral] ensure existing user=%s code=%s", user_tag, existing)
        return existing

    for attempt in range(1, _MAX_RETRIES + 1):
        code = generate_code()
        try:
            updated = await conn.fetchval(
                """UPDATE users SET referral_code = $1
                   WHERE id = $2 AND referral_code IS NULL
                   RETURNING referral_code""",
                code, user_id,
            )
        except asyncpg.exceptions.UniqueViolationError:
            # 다른 유저가 같은 코드를 이미 보유 — 새 코드로 재시도
            logger.info(
                "[referral] ensure collision user=%s code=%s attempt=%d",
                user_tag, code, attempt,
            )
            continue
        if updated:
            logger.info(
                "[referral] ensure created user=%s code=%s attempt=%d",
                user_tag, updated, attempt,
            )
            return updated
        # IS NULL 불일치 — 동시 요청이 그 사이 발급(불변 보장). 재조회로 확정값 반환.
        current = await conn.fetchval(
            "SELECT referral_code FROM users WHERE id = $1", user_id
        )
        if current:
            logger.info("[referral] ensure concurrent user=%s code=%s", user_tag, current)
            return current
        logger.warning("[referral] ensure user not found user=%s", user_tag)
        raise RuntimeError(f"referral: user not found ({user_tag})")

    logger.error("[referral] ensure retries exhausted user=%s", user_tag)
    raise RuntimeError(f"referral: code generation retries exhausted ({user_tag})")


async def resolve_referrer(conn, code):
    """유효 추천코드 → 추천인 users row (id, nickname, referral_code). 무효/탈퇴/정지 → None.

    형식 검증(4자리 charset) 후 active 유저만 매치 — 탈퇴(withdrawn)/보호자동의 대기
    (pending_consent)/정지(is_banned) 유저의 코드는 무효 처리.
    """
    normalized = normalize_code(code)
    if not REFERRAL_CODE_RE.match(normalized):
        logger.info("[referral] resolve invalid format code=%s", str(code)[:8] if code else "")
        return None
    row = await conn.fetchrow(
        """SELECT id, nickname, referral_code FROM users
           WHERE referral_code = $1
             AND COALESCE(account_status, 'active') = 'active'
             AND COALESCE(is_banned, FALSE) = FALSE""",
        normalized,
    )
    logger.info(
        "[referral] resolve code=%s found=%s inviter=%s",
        normalized, bool(row), str(row["id"])[:8] if row else "-",
    )
    return row


async def backfill_referral_codes(conn) -> int:
    """referral_code IS NULL 인 전 유저에게 코드 발급 (멱등 — 재기동마다 NULL 만 대상).

    발급 건수 반환. 개별 실패는 로그만 남기고 계속 (startup 을 막지 않음).
    """
    rows = await conn.fetch("SELECT id FROM users WHERE referral_code IS NULL")
    logger.info("[referral] backfill start targets=%d", len(rows))
    issued = 0
    for row in rows:
        try:
            await ensure_referral_code(conn, row["id"])
            issued += 1
        except Exception:
            logger.exception("[referral] backfill failed user=%s", str(row["id"])[:8])
    logger.info("[referral] backfill done n=%d", issued)
    return issued
