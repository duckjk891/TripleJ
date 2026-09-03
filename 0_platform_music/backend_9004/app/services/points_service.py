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

# StarEcon(v158) — 유료 액션 단가 단일 소스 (⭐). 라우트들은 이 dict 만 참조한다.
# FE 는 GET /api/points/costs 로 조회 → 하드코딩 드리프트 방지.
POINT_COSTS = {
    "lyrics": 5,        # 작사 (generate.py /lyrics/)
    "compose": 15,      # 작곡 (generate.py create/start)
    "cover": 5,         # 커버 이미지 (upload.py, 기존 2 → 5)
    "character": 10,    # 캐릭터 시트 (character.py, 기존 2 → 10)
    "fatigue_skip": 5,  # 디렉터 피로 쿨다운 30분 스킵 (fatigue.py)
    "hire_director": 10,  # v193 AIDOL — 디렉터 영입 (points.py /spend)
    "extra_slot": 15,     # v193 AIDOL — 추가 아티스트 슬롯 개방 (points.py /spend)
    "voice_clone": 5,     # B-9 — 보이스 클로닝 (voice_clone.py /create, failed 전이 시 환불)
}

_indexes_ready = False


async def ensure_indexes(db=None):
    """Lazily create indexes once (called at start of award/balance/history).

    v158: accepts an optional loop-local motor db (`db`) so background-loop
    callers never touch the main-loop-bound global client.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    mongo = db if db is not None else get_mongo()
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


async def award_point(user_id: str, action: str, track_id: str, daily_cap: int = None, db=None) -> bool:
    """Best-effort award of +1 point.

    Idempotent per (user, action, track, KST day) via a unique index:
    the first event of the day inserts and credits +1; duplicates are
    silently ignored.  NEVER raises — this runs inside chart/download flows,
    so any failure must not affect the HTTP response or chart logic.
    Returns True if a point was newly awarded, False otherwise.

    v158: `daily_cap` — when set, no more than `daily_cap` events of this
    (user, action) are credited per KST day (checked via countDocuments just
    before insert; the tiny count→insert race is accepted as best-effort).
    `db` — optional loop-local motor db for background-loop callers
    (defaults to the main-loop get_mongo() client — fully backward compatible).
    """
    logger.info("[points] award user=%s action=%s track=%s", user_id, action, track_id)
    if not user_id:
        return False
    try:
        await ensure_indexes(db)
        day = _kst_day()
        mongo = db if db is not None else get_mongo()
        if daily_cap is not None:
            todays = await mongo.point_events.count_documents(
                {"user_id": user_id, "action": action, "day": day}
            )
            if todays >= daily_cap:
                logger.info(
                    "[star-econ] award capped user=%s action=%s day=%s count=%d cap=%d",
                    user_id[:8], action, day, todays, daily_cap,
                )
                return False
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


async def grant_points(user_id: str, action: str, amount: int, note: str = "", db=None) -> bool:
    """v229 (B-6) — 정액 ⭐ 지급 (이벤트 로그 + 잔액 증가).

    award_point(+1/일일 멱등)와 달리 임의 액수를 1회 지급한다. 멱등성은 호출부가
    보장한다 (예: guardian decide 는 상태 전이가 1회만 성공). NEVER raises.
    Returns True on success.
    """
    if not user_id or amount <= 0:
        return False
    try:
        import uuid as _uuid
        await ensure_indexes(db)
        mongo = db if db is not None else get_mongo()
        await mongo.point_events.insert_one({
            "user_id": user_id,
            "action": action,
            "track_id": "grant_{}".format(_uuid.uuid4().hex[:12]),
            "day": _kst_day(),
            "amount": amount,
            "note": note,
            "created_at": datetime.now(timezone.utc),
        })
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
        logger.info(
            "[points] grant user=%s action=%s +%d note=%s",
            user_id[:8], action, amount, note[:60],
        )
        return True
    except Exception as e:  # noqa: BLE001 — 지급 실패가 호출부 흐름을 깨면 안 됨
        logger.error("[points] grant failed user=%s action=%s: %s", user_id[:8], action, str(e)[:200])
        return False


async def spend_points(user_id: str, action: str, amount: int, ref: str, db=None) -> bool:
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

    v158: `db` — optional loop-local motor db (background-loop callers).
    """
    if not user_id or amount <= 0:
        return False
    try:
        await ensure_indexes(db)
        mongo = db if db is not None else get_mongo()
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


async def refund_points(user_id: str, action: str, amount: int, ref: str, db=None) -> None:
    """Best-effort refund of a previous spend_points deduction. NEVER raises.

    Credits `amount` back (upsert) and logs a `refund:{action}` event with the
    same per-attempt `ref` used at spend time. Callers are responsible for
    double-refund protection (e.g. an atomic `refunded` flag on the job doc).

    v158: `db` — optional loop-local motor db (background-loop callers).
    """
    if not user_id or amount <= 0:
        return
    try:
        await ensure_indexes(db)
        mongo = db if db is not None else get_mongo()
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


async def credit_points(user_id: str, action: str, amount: int, ref: str, day: str = None, db=None) -> bool:
    """Idempotently credit a variable `amount` of points.

    Unlike `award_point` (+1 fixed), this credits an arbitrary positive amount
    and is used for rewards like daily attendance. Idempotency gate = the
    unique (user_id, action, track_id, day) index on `point_events`: the event
    is inserted FIRST; a DuplicateKeyError means it was already credited (or a
    concurrent race), so the balance is NOT touched and False is returned.

    `ref` is stored in the `track_id` field. For a once-per-day reward, pass the
    KST day string as both `ref` and `day` so (user, action, day, day) allows
    exactly one credit per day. Returns True when a new credit was applied.

    v158: `db` — optional loop-local motor db (background-loop callers).
    """
    logger.info("[points] credit user=%s action=%s amount=%d ref=%s", user_id, action, amount, ref)
    if not user_id or amount <= 0:
        return False
    try:
        await ensure_indexes(db)
        day = day or _kst_day()
        mongo = db if db is not None else get_mongo()
        try:
            await mongo.point_events.insert_one({
                "user_id": user_id,
                "action": action,
                "track_id": ref,
                "day": day,
                "amount": amount,
                "created_at": datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            logger.info(
                "[points] credit dup user=%s action=%s ref=%s (already credited)",
                user_id, action, ref,
            )
            return False
        try:
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
        except Exception as bal_exc:  # noqa: BLE001 - event already inserted (dup blocks re-credit)
            logger.warning(
                "[points] credit balance update failed user=%s action=%s ref=%s: %s",
                user_id, action, ref, bal_exc,
            )
        logger.info(
            "[points] credit user=%s action=%s amount=%d ref=%s -> +%d",
            user_id, action, amount, ref, amount,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[points] credit failed user=%s action=%s amount=%d ref=%s: %s",
            user_id, action, amount, ref, exc,
        )
        return False


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
