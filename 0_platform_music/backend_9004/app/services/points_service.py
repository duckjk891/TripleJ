"""
AIMU Points - 사용자 활동 포인트 적립/조회.

차트에 영향을 주는 행위(재생 듣기 / 다운로드)를 로그인 사용자가 하면 +1.
하루 1회 / 곡당 / 행위별로 멱등 적립한다 (재생·다운로드 별개).
비로그인은 적립 없음. 기존 rewards(AdMob) 시스템과는 완전히 별개.

Collections:
  - point_events:   적립 이벤트 로그 (user/action/track/day 유니크 → 일일 중복 차단)
  - point_balances: 사용자별 누적 잔액
"""

import logging
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

_indexes_ready = False


async def ensure_indexes():
    """Lazily create indexes once (called at start of award/balance/history)."""
    global _indexes_ready
    if _indexes_ready:
        return
    mongo = get_mongo()
    # Unique per user+action+track+day → daily/per-track/per-action idempotency
    await mongo.point_events.create_index(
        [("user_id", 1), ("action", 1), ("track_id", 1), ("day", 1)],
        unique=True,
    )
    await mongo.point_events.create_index("user_id")
    await mongo.point_balances.create_index("user_id", unique=True)
    _indexes_ready = True


def _kst_day() -> str:
    """KST today as '%Y%m%d'."""
    return datetime.now(KST).strftime("%Y%m%d")


async def award_point(user_id: str, action: str, track_id: str) -> bool:
    """Best-effort award of +1 point.

    Idempotent per (user, action, track, KST day) via a unique index:
    the first event of the day inserts and credits +1; duplicates are
    silently ignored.  NEVER raises — this runs inside chart/download flows,
    so any failure must not affect the HTTP response or chart logic.
    Returns True if a point was newly awarded, False otherwise.
    """
    logger.info("[points] award user=%s action=%s track=%s", user_id, action, track_id)
    if not user_id:
        return False
    try:
        await ensure_indexes()
        day = _kst_day()
        mongo = get_mongo()
        try:
            await mongo.point_events.insert_one({
                "user_id": user_id,
                "action": action,
                "track_id": track_id,
                "day": day,
                "amount": 1,
                "created_at": datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            logger.info(
                "[points] user=%s action=%s track=%s dup (already earned today)",
                user_id, action, track_id,
            )
            return False
        await mongo.point_balances.update_one(
            {"user_id": user_id},
            {
                "$inc": {"balance": 1},
                "$setOnInsert": {
                    "user_id": user_id,
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
        logger.info("[points] user=%s action=%s track=%s -> +1", user_id, action, track_id)
        return True
    except Exception as exc:  # noqa: BLE001 - never raise inside chart/download flow
        logger.warning(
            "[points] award failed user=%s action=%s track=%s: %s",
            user_id, action, track_id, exc,
        )
        return False


async def spend_points(user_id: str, action: str, amount: int, ref: str) -> bool:
    """Atomically deduct `amount` points from the user's balance.

    The deduction is a single conditional update
    (`balance >= amount` filter + `$inc: -amount`), so a user can never go
    negative and concurrent spends cannot double-deduct past zero.
    Returns True when points were deducted; False when the balance is
    insufficient / the account has no balance doc / any unexpected error
    (an ambiguous failure blocks the paid action, which is the safe side).

    `ref` MUST be unique per attempt (e.g. uuid4().hex or a job id) — it is
    stored in the `track_id` field of `point_events`, which carries a unique
    (user, action, track_id, day) index; a per-attempt ref avoids collisions
    on same-day retries. The event log is best-effort: if it fails the spend
    itself remains valid (warning only).
    """
    if not user_id or amount <= 0:
        return False
    try:
        await ensure_indexes()
        mongo = get_mongo()
        result = await mongo.point_balances.update_one(
            {"user_id": user_id, "balance": {"$gte": amount}},
            {"$inc": {"balance": -amount}},
        )
        if result.modified_count == 0:
            logger.info(
                "[points] spend denied (insufficient) user=%s action=%s amount=%d ref=%s",
                user_id, action, amount, ref,
            )
            return False
        try:
            await mongo.point_events.insert_one({
                "user_id": user_id,
                "action": "spend:{}".format(action),
                "track_id": ref,
                "day": _kst_day(),
                "amount": -amount,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as evt_exc:  # noqa: BLE001 - deduction already applied
            logger.warning(
                "[points] spend event log failed (deduction kept) user=%s action=%s ref=%s: %s",
                user_id, action, ref, evt_exc,
            )
        logger.info(
            "[points] spend user=%s action=%s amount=-%d ref=%s",
            user_id, action, amount, ref,
        )
        return True
    except Exception as exc:  # noqa: BLE001 - ambiguous failure → block the paid action
        logger.warning(
            "[points] spend failed user=%s action=%s amount=%d ref=%s: %s",
            user_id, action, amount, ref, exc,
        )
        return False


async def refund_points(user_id: str, action: str, amount: int, ref: str) -> None:
    """Best-effort refund of a previous spend_points deduction. NEVER raises.

    Credits `amount` back (upsert) and logs a `refund:{action}` event with the
    same per-attempt `ref` used at spend time. Callers are responsible for
    double-refund protection (e.g. an atomic `refunded` flag on the job doc).
    """
    if not user_id or amount <= 0:
        return
    try:
        await ensure_indexes()
        mongo = get_mongo()
        await mongo.point_balances.update_one(
            {"user_id": user_id},
            {
                "$inc": {"balance": amount},
                "$setOnInsert": {
                    "user_id": user_id,
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )
        try:
            await mongo.point_events.insert_one({
                "user_id": user_id,
                "action": "refund:{}".format(action),
                "track_id": ref,
                "day": _kst_day(),
                "amount": amount,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as evt_exc:  # noqa: BLE001 - credit already applied
            logger.warning(
                "[points] refund event log failed (credit kept) user=%s action=%s ref=%s: %s",
                user_id, action, ref, evt_exc,
            )
        logger.info(
            "[points] refund user=%s action=%s amount=+%d ref=%s",
            user_id, action, amount, ref,
        )
    except Exception as exc:  # noqa: BLE001 - never raise
        logger.warning(
            "[points] refund failed user=%s action=%s amount=%d ref=%s: %s",
            user_id, action, amount, ref, exc,
        )


async def get_balance(user_id: str) -> int:
    """Return the user's current point balance (0 if none)."""
    await ensure_indexes()
    mongo = get_mongo()
    doc = await mongo.point_balances.find_one({"user_id": user_id})
    balance = int(doc.get("balance", 0)) if doc else 0
    logger.info("[points] balance user=%s -> %d", user_id, balance)
    return balance


async def get_history(user_id: str, limit: int = 50) -> list:
    """Return the user's recent point events (newest first)."""
    await ensure_indexes()
    mongo = get_mongo()
    cursor = (
        mongo.point_events.find({"user_id": user_id})
        .sort("created_at", -1)
        .limit(limit)
    )
    out = []
    async for doc in cursor:
        created = doc.get("created_at")
        out.append({
            "action": doc.get("action"),
            "track_id": doc.get("track_id"),
            "day": doc.get("day"),
            "amount": doc.get("amount", 1),
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
        })
    logger.info("[points] history user=%s count=%d", user_id, len(out))
    return out
