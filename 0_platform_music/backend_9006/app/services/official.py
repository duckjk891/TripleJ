"""OfficialSquad — maidol_official 공식 계정 해석/시드 서비스.

CS 오류신고 → maidol_official DM 문의 채널의 백엔드 기반. 공식 계정은
`official_account_email` 로 users 에 단일 시드(role=admin, is_verified=true,
account_status=active)되며, 모든 유저와 양방향 맞팔 관계를 유지한다(가입 시
자동 맞팔 + startup 백필). 언팔 가드(follows.py)와 DM 인증 면제(dm_service)의
판정 기준으로 쓰인다.

해석된 공식 user_id 는 모듈 레벨 캐시(`_official_id`)에 담아 매 요청 DB 조회를
피한다. startup 의 ensure_official_account 가 채우고, 이후 요청은 get_official_id
/ is_official 로 캐시를 읽는다(콜드 캐시면 email 로 lazy 조회 후 캐시).

로그 prefix [official] — user_id 앞 8자만, 비밀번호/해시 원문 미로그(길이 무관).
"""

import logging
import secrets
import uuid

import bcrypt

from ..config import settings

logger = logging.getLogger(__name__)

# 해석된 공식 계정 user_id(str) 캐시 — startup 시드/최초 lazy 조회로 채워짐.
_official_id: str | None = None


def _short(value) -> str:
    return str(value)[:8] if value else "?"


def _hash_password(raw: str) -> str:
    """official_account_password(플레이스홀더) 해시. 빈값이면 랜덤 시크릿으로
    해시(로그인 불가 — DM 대응은 어드민 API 전용). 비밀번호 원문 미로그."""
    pw = raw or secrets.token_urlsafe(32)
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


async def ensure_official_account(conn) -> str:
    """공식 계정을 email 로 조회, 없으면 시드 INSERT 후 user_id(str) 반환 + 캐시.

    멱등 — 재기동마다 기존 계정을 재사용한다(중복 생성 없음).
    """
    global _official_id
    email = settings.official_account_email
    logger.info(
        "[official] ensure_official_account enter nickname=%s",
        settings.official_account_nickname,
    )
    row = await conn.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if row:
        _official_id = str(row["id"])
        logger.info("[official] existing account resolved id=%s", _short(_official_id))
        return _official_id

    password_hash = _hash_password(settings.official_account_password)
    row = await conn.fetchrow(
        """INSERT INTO users (email, password_hash, nickname, role, is_verified,
                              verified_at, account_status)
           VALUES ($1, $2, $3, 'admin', TRUE, now(), 'active')
           RETURNING id""",
        email, password_hash, settings.official_account_nickname,
    )
    _official_id = str(row["id"])
    logger.info("[official] account created id=%s", _short(_official_id))
    return _official_id


async def get_official_id(conn=None) -> str | None:
    """캐시된 공식 user_id 반환. 콜드 캐시면 conn 으로 email lazy 조회 후 캐시.

    conn 미제공 + 콜드 캐시면 None(호출부가 503 등으로 처리).
    """
    global _official_id
    if _official_id:
        return _official_id
    if conn is None:
        return None
    try:
        row = await conn.fetchrow(
            "SELECT id FROM users WHERE email = $1", settings.official_account_email
        )
    except Exception:
        logger.exception("[official] get_official_id lazy lookup failed")
        return None
    if row:
        _official_id = str(row["id"])
        logger.info("[official] lazy resolved id=%s", _short(_official_id))
    return _official_id


def is_official(user_id) -> bool:
    """캐시된 공식 id 와 일치 여부(동기, DB 미접근). 콜드 캐시면 항상 False —
    호출부는 필요 시 get_official_id(conn) 으로 보강한다."""
    return bool(_official_id) and str(user_id) == _official_id


def is_reserved_nickname(nickname) -> bool:
    """예약 닉네임(maidol_official) 여부 — 대소문자·앞뒤공백 변형 방어(strip+casefold)."""
    if not nickname:
        return False
    return (
        str(nickname).strip().casefold()
        == settings.official_account_nickname.strip().casefold()
    )


async def ensure_mutual_follow(conn, user_id, provider: str = "local") -> None:
    """(user ↔ official) 양방향 follows 를 멱등 삽입. best-effort — 호출부가 예외 처리.

    공식 계정 미해석(콜드 캐시 + conn 조회 실패)이면 skip(가입 흐름 계속).
    자기 자신(공식==user)은 무시.
    """
    official_id = await get_official_id(conn)
    if not official_id:
        logger.warning(
            "[official] mutual-follow skip (official unresolved) user=%s", _short(user_id)
        )
        return
    if str(user_id) == official_id:
        return
    try:
        u = uuid.UUID(str(user_id))
        o = uuid.UUID(official_id)
    except (ValueError, TypeError):
        logger.warning("[official] mutual-follow skip (bad uuid) user=%s", _short(user_id))
        return

    # 방향① user → official
    await conn.execute(
        """INSERT INTO follows (follower_id, followee_id)
           SELECT $1, $2
           WHERE NOT EXISTS (
               SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2
           )""",
        u, o,
    )
    # 방향② official → user
    await conn.execute(
        """INSERT INTO follows (follower_id, followee_id)
           SELECT $1, $2
           WHERE NOT EXISTS (
               SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2
           )""",
        o, u,
    )
    logger.info("[official] mutual-follow user=%s provider=%s", _short(user_id), provider)
