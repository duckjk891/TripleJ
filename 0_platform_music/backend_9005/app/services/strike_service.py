"""TrustSquad(v139) — 스트라이크 자동 제재 + 생성 기능 제한 게이트.

apply_strike(conn, user_id, report_id, kind)
    user_violations 기록(같은 user+report 조합 기존재 시 INSERT 생략 — 카운트만
    재평가) 후 누적 건수 기준 자동 제재:
      1건: 기록만 / 2건: restricted_until = now+7일 / ≥3건: is_banned + ban_reason
      '커뮤니티 가이드 위반 누적(자동)' + banned_at.
    호출 지점: routes/admin.py confirm_delete · routes/admin_moderation.py purge.

check_generation_allowed(conn, user_id)
    생성 계열(곡·캐릭터·커버·MV) 진입부 공용 게이트 — restricted_until 미래면
    403 {"error": "generation_restricted", "until": iso, "message": ...(KST 해제
    일시)} JSONResponse 반환, 허용이면 None. conn=None 이면 풀에서 직접 획득
    (PG 의존성 없는 라우트용).

로그 prefix [strike] — id 는 앞 8자만.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

BAN_REASON_AUTO = "커뮤니티 가이드 위반 누적(자동)"
RESTRICT_DAYS = 7


def _short(value) -> str:
    return str(value)[:8] if value else "?"


async def apply_strike(conn, user_id, report_id, kind: str) -> dict:
    """위반 기록 + 누적 제재. {count, tier, inserted} 반환.

    같은 (user_id, report_id) 위반이 이미 있으면 중복 INSERT 없이 카운트만
    재평가한다 (confirm_delete·purge 가 동일 신고에 겹칠 때 이중 스트라이크 방지).
    """
    uid = uuid.UUID(str(user_id))
    rid = uuid.UUID(str(report_id)) if report_id else None

    inserted = False
    exists = None
    if rid is not None:
        exists = await conn.fetchval(
            "SELECT 1 FROM user_violations WHERE user_id = $1 AND report_id = $2",
            uid, rid,
        )
    if not exists:
        await conn.execute(
            "INSERT INTO user_violations (user_id, report_id, kind) VALUES ($1, $2, $3)",
            uid, rid, kind,
        )
        inserted = True

    count = await conn.fetchval(
        "SELECT COUNT(*) FROM user_violations WHERE user_id = $1", uid
    )
    count = int(count or 0)

    if count >= 3:
        tier = "ban"
        # 이미 정지된 계정은 원 사유·시각 보존 (재정지 덮어쓰기 방지)
        await conn.execute(
            """UPDATE users SET is_banned = TRUE, banned_at = NOW(), ban_reason = $1,
                   updated_at = NOW()
               WHERE id = $2 AND is_banned IS NOT TRUE""",
            BAN_REASON_AUTO, uid,
        )
        # 밴 즉시 활성 세션 무효화 — 이미 로그인된 세션이 로그아웃 전까지
        # 계속 활동하는 구멍 차단. 다음 요청에서 401 → 재로그인 시도는 밴으로 차단.
        # best-effort: Redis 실패해도 스트라이크 자체는 성공 처리.
        try:
            from ..database.redis import get_redis
            await get_redis().delete(f"session:{user_id}")
            logger.info("[strike] session invalidated on ban user=%s", _short(user_id))
        except Exception as e:
            logger.warning("[strike] session invalidate failed user=%s err=%s", _short(user_id), e)
    elif count == 2:
        tier = "restrict_7d"
        await conn.execute(
            "UPDATE users SET restricted_until = NOW() + INTERVAL '%d days', "
            "updated_at = NOW() WHERE id = $1" % RESTRICT_DAYS,
            uid,
        )
    else:
        tier = "record"

    logger.info(
        "[strike] applied user=%s report=%s kind=%s inserted=%s count=%d tier=%s",
        _short(user_id), _short(report_id), kind, inserted, count, tier,
    )
    return {"count": count, "tier": tier, "inserted": inserted}


async def check_generation_allowed(conn, user_id) -> Optional[JSONResponse]:
    """생성 진입 게이트 — 제한 중이면 403 JSONResponse, 허용이면 None.

    실패(DB 오류 등) 시 차단하지 않는다 — 생성 흐름을 깨지 않는 best-effort.
    """
    try:
        if conn is None:
            from ..database import postgres as _pgmod
            async with _pgmod._pool.acquire() as _conn:
                return await check_generation_allowed(_conn, user_id)

        until = await conn.fetchval(
            "SELECT restricted_until FROM users WHERE id = $1", uuid.UUID(str(user_id))
        )
    except Exception as e:
        logger.warning("[strike] gate check failed user=%s err=%s", _short(user_id), e)
        return None

    if until and until > datetime.now(timezone.utc):
        until_kst = until.astimezone(KST)
        logger.info(
            "[strike] generation blocked user=%s until=%s",
            _short(user_id), until.isoformat(),
        )
        return JSONResponse(
            status_code=403,
            content={
                "error": "generation_restricted",
                "until": until.isoformat(),
                "message": "위반 누적으로 생성 기능이 일시 제한되었습니다. 해제: {} (KST)".format(
                    until_kst.strftime("%Y-%m-%d %H:%M")
                ),
            },
        )
    return None
