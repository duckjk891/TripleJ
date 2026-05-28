"""
v11 — admin 시드 계정. lifespan 부팅 시 1회 실행.
ADMIN_EMAIL 가 없으면 bcrypt(ADMIN_DEFAULT_PASSWORD) 해시로 직접 INSERT.
role='admin', nickname='관리자'. idempotent.

⚠ 보안 경고 (개발 환경 전용):
- 기본 비밀번호 '1' 은 매우 약함. 운영 배포 전 반드시 강한 PW 로 교체.
- 운영에서는 별도 관리자 계정 발급 권장.
"""
import logging

import bcrypt

from ..database.postgres import get_pool

logger = logging.getLogger(__name__)

ADMIN_EMAIL = "admin@aido.com"
ADMIN_NICKNAME = "관리자"
ADMIN_DEFAULT_PASSWORD = "1"


async def seed_admin() -> None:
    """Ensure a single admin seed account exists. Idempotent."""
    logger.info("[AdminSeed] start email=%s nickname=%s", ADMIN_EMAIL, ADMIN_NICKNAME)
    pool = get_pool()
    if pool is None:
        logger.warning("[AdminSeed] postgres pool not ready — skip")
        return

    try:
        async with pool.acquire() as conn:
            existing = await conn.fetchrow(
                "SELECT id, role FROM users WHERE email = $1",
                ADMIN_EMAIL,
            )
            if existing:
                logger.info(
                    "[AdminSeed] admin already exists user_id=%s role=%s",
                    existing["id"],
                    existing["role"],
                )
                return

            password_hash = bcrypt.hashpw(
                ADMIN_DEFAULT_PASSWORD.encode(), bcrypt.gensalt()
            ).decode()
            row = await conn.fetchrow(
                """INSERT INTO users (email, password_hash, nickname, role)
                   VALUES ($1, $2, $3, $4)
                   RETURNING id""",
                ADMIN_EMAIL,
                password_hash,
                ADMIN_NICKNAME,
                "admin",
            )
            # password_hash 는 로그에 절대 노출하지 않음.
            logger.info("[AdminSeed] created admin user_id=%s role=admin", row["id"])
    except Exception as e:
        logger.error(
            "[AdminSeed] seed failed: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
