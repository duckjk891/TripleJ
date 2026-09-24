"""어드민 대시보드 접속·가입 지표 (KST 일자 기준).

접속자 = 그날 인증된 API 요청을 한 번이라도 보낸 로그인 사용자 수.
auth.get_current_user(_optional) 가 Redis SET `stats:dau:YYYYMMDD` 에 user_id 를 기록한다.
비회원(토큰 없음) 접속은 식별자가 없어 포함되지 않는다.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import DAU_KEY_PREFIX, get_admin_user
from ..database.postgres import get_pg
from ..database.redis import get_redis

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
MAX_DAYS = 90


@router.get("/active-users")
async def active_users(
    days: int = 14,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})

    redis = get_redis()
    today = datetime.now(KST).date()
    dates = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    keys = [f"{DAU_KEY_PREFIX}{d.strftime('%Y%m%d')}" for d in dates]

    pipe = redis.pipeline()
    for k in keys:
        pipe.scard(k)
    counts = await pipe.execute()

    week_keys = keys[-7:]
    week_active = len(await redis.sunion(*week_keys)) if week_keys else 0

    since_utc = datetime.combine(dates[0], datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
    rows = await conn.fetch(
        """SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS d, COUNT(*) AS n
           FROM users WHERE created_at >= $1 GROUP BY d""",
        since_utc,
    )
    signups = {r["d"]: int(r["n"]) for r in rows}
    total_users = await conn.fetchval("SELECT COUNT(*) FROM users")

    daily = [
        {"date": d.isoformat(), "active": int(c or 0), "signups": signups.get(d, 0)}
        for d, c in zip(dates, counts)
    ]
    return {
        "today": daily[-1],
        "yesterday": daily[-2] if len(daily) > 1 else None,
        "week_active": week_active,
        "total_users": total_users,
        "daily": daily,
        "note": "로그인 사용자 기준 (비회원 미포함), KST 일자",
    }
