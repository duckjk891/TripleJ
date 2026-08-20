"""
AIMU Attendance - 데일리 체크인(출석체크).

스트릭형 10일 1사이클 + 누적. 하루 1회(KST) 체크인하면 별(포인트)을 지급한다.
연속 강제 없음 — 하루 빠져도 초기화되지 않고, 접속(체크인)한 날짜 수가 누적된다.
보상: 5일차 = ⭐30, 10일차 = ⭐100, 그 외 = ⭐10. 10일차를 받으면 다음 체크인은
1일차부터 새 사이클을 반복한다.

Collections:
  - point_events / point_balances: 기존 포인트 시스템 재사용(별 잔액·멱등 게이트).
        action="attendance", track_id=day=<KST '%Y%m%d'> → 하루 1회 멱등.
  - attendance_progress (신규, user_id 유니크): 누적 출석일수/마지막 받은 칸 추적.
"""

import logging
from datetime import datetime, timezone

from ..database.mongodb import get_mongo
from . import points_service

logger = logging.getLogger(__name__)

ATTENDANCE_ACTION = "attendance"

_attendance_indexes_ready = False


async def ensure_attendance_indexes():
    """Lazily create the attendance_progress unique index once."""
    global _attendance_indexes_ready
    if _attendance_indexes_ready:
        return
    mongo = get_mongo()
    await mongo.attendance_progress.create_index("user_id", unique=True)
    _attendance_indexes_ready = True


def _reward_for(cycle_day: int) -> int:
    """Star reward for a given cycle position (1~10)."""
    if cycle_day == 5:
        return 30
    if cycle_day == 10:
        return 100
    return 10


def _next_cycle_day(cumulative_count: int) -> int:
    """Next cycle slot (1~10) to claim, given total check-in days.

    10일차(cumulative 10, 20, ...)를 받은 다음은 1일차로 리셋된다.
    """
    return (cumulative_count % 10) + 1


async def get_status(user_id: str) -> dict:
    """오늘 체크인 여부 + 사이클 진행 상태 + 10칸 캘린더 + 별 잔액을 반환."""
    await ensure_attendance_indexes()
    today = points_service._kst_day()
    mongo = get_mongo()
    progress = await mongo.attendance_progress.find_one({"user_id": user_id})
    cumulative = int(progress.get("cumulative_count", 0)) if progress else 0
    last_cycle_day = int(progress.get("last_cycle_day", 0)) if progress else 0
    last_checkin_day = progress.get("last_checkin_day") if progress else None

    checked_today = last_checkin_day == today
    if checked_today:
        cycle_day = last_cycle_day
        claimed_count = last_cycle_day
    else:
        cycle_day = _next_cycle_day(cumulative)
        claimed_count = 0 if cycle_day == 1 else cycle_day - 1

    today_reward = _reward_for(cycle_day)
    calendar = [
        {"day": d, "reward": _reward_for(d), "claimed": d <= claimed_count}
        for d in range(1, 11)
    ]
    balance = await points_service.get_balance(user_id)

    logger.info(
        "[attendance] status user=%s checked_today=%s cycle_day=%d cumulative=%d",
        user_id, checked_today, cycle_day, cumulative,
    )
    return {
        "checked_today": checked_today,
        "cycle_day": cycle_day,
        "cumulative_count": cumulative,
        "today_reward": today_reward,
        "calendar": calendar,
        "balance": balance,
    }


async def check_in(user_id: str) -> dict:
    """오늘 체크인 처리 + 별 적립. 하루 1회(KST) 멱등."""
    logger.info("[attendance] check_in user=%s", user_id)
    await ensure_attendance_indexes()
    today = points_service._kst_day()
    mongo = get_mongo()
    progress = await mongo.attendance_progress.find_one({"user_id": user_id})
    cumulative = int(progress.get("cumulative_count", 0)) if progress else 0
    last_cycle_day = int(progress.get("last_cycle_day", 0)) if progress else 0
    last_checkin_day = progress.get("last_checkin_day") if progress else None

    # 이미 오늘 받음 → 멱등 반환
    if last_checkin_day == today:
        balance = await points_service.get_balance(user_id)
        logger.info(
            "[attendance] check-in user=%s already today cycle_day=%d",
            user_id, last_cycle_day,
        )
        return {
            "success": True,
            "awarded": 0,
            "cycle_day": last_cycle_day,
            "cumulative_count": cumulative,
            "balance": balance,
            "already": True,
        }

    cycle_day = _next_cycle_day(cumulative)
    reward = _reward_for(cycle_day)

    credited = await points_service.credit_points(
        user_id, ATTENDANCE_ACTION, reward, ref=today, day=today,
    )

    # 레이스 중복(DuplicateKey) → 이미 처리된 것으로 간주
    if not credited:
        latest = await mongo.attendance_progress.find_one({"user_id": user_id})
        latest_cycle = int(latest.get("last_cycle_day", cycle_day)) if latest else cycle_day
        latest_cumulative = int(latest.get("cumulative_count", cumulative)) if latest else cumulative
        balance = await points_service.get_balance(user_id)
        logger.info(
            "[attendance] check-in user=%s race dup -> already cycle_day=%d",
            user_id, latest_cycle,
        )
        return {
            "success": True,
            "awarded": 0,
            "cycle_day": latest_cycle,
            "cumulative_count": latest_cumulative,
            "balance": balance,
            "already": True,
        }

    now = datetime.now(timezone.utc)
    await mongo.attendance_progress.update_one(
        {"user_id": user_id},
        {
            "$inc": {"cumulative_count": 1},
            "$set": {
                "last_cycle_day": cycle_day,
                "last_checkin_day": today,
                "updated_at": now,
            },
            "$setOnInsert": {
                "user_id": user_id,
                "created_at": now,
            },
        },
        upsert=True,
    )
    new_cumulative = cumulative + 1
    balance = await points_service.get_balance(user_id)
    logger.info(
        "[attendance] check-in user=%s AWARDED cycle_day=%d reward=%d cumulative=%d balance=%d",
        user_id, cycle_day, reward, new_cumulative, balance,
    )
    return {
        "success": True,
        "awarded": reward,
        "cycle_day": cycle_day,
        "cumulative_count": new_cumulative,
        "balance": balance,
        "already": False,
    }
