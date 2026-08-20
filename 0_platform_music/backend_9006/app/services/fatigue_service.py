"""
Director Fatigue system (StarEcon v158).

곡이 최종 완성(completed)될 때마다 그날의 완성 카운트가 올라가고, 카운트에
비례한 쿨다운이 시작된다. 쿨다운 중에는 새 **작곡** 지시가 429 로 게이트된다
(작사/커버/캐릭터는 미게이트). 생성 진행 중 대기에는 어떤 과금/게이트도 없다.

사다리 (그날 n곡째 완성 → 쿨다운):
    1곡 → 2h / 2곡 → 4h / 3곡 → 8h / 4곡+ → 12h

KST 자정 리셋: day 불일치 시 lazy 리셋 — 완성 카운트 0 + 잔여 쿨다운 해제.

Collection: `director_fatigue`
    { user_id (unique), day: '%Y%m%d' (KST), completed_count: int,
      cooldown_until: datetime(UTC) | None, updated_at }

모든 함수는 best-effort (절대 raise 하지 않는 쪽이 안전한 곳은 삼킴) 이며,
배경 루프 호출자는 루프-로컬 motor db 를 `db` 파라미터로 주입해야 한다
(suno_generator 의 완성 훅 등 — 메인 루프 get_mongo() 클라이언트 사용 금지).
"""

import logging
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument

from ..database.mongodb import get_mongo
from .points_service import POINT_COSTS, _kst_day

logger = logging.getLogger(__name__)

# 스킵 1회당 단축 분 (⭐5 또는 광고권 1장 = 30분)
SKIP_MINUTES = 30
SKIP_POINT_COST = POINT_COSTS["fatigue_skip"]

# 완성 카운트 → 쿨다운 시간(시) 사다리. 4곡째 이상은 12h 고정.
_LADDER_HOURS = {1: 2, 2: 4, 3: 8}
_LADDER_MAX_HOURS = 12

_indexes_ready = False


def _ladder(count: int) -> timedelta:
    """그날 `count`곡째 완성 시 적용할 쿨다운 길이."""
    if count <= 0:
        return timedelta(0)
    return timedelta(hours=_LADDER_HOURS.get(count, _LADDER_MAX_HOURS))


def ladder_spec() -> dict:
    """FE 노출용 사다리 사양 {완성곡수: 쿨다운시간(h)}."""
    return {"1": 2, "2": 4, "3": 8, "4+": 12}


def _db(db=None):
    return db if db is not None else get_mongo()


async def _ensure_indexes(db=None):
    global _indexes_ready
    if _indexes_ready:
        return
    await _db(db).director_fatigue.create_index("user_id", unique=True)
    _indexes_ready = True


def _as_utc(dt):
    """Mongo 가 돌려준 naive datetime 을 UTC aware 로 정규화."""
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _load(user_id: str, db=None) -> dict:
    """유저 피로 doc 로드 + KST day 불일치 시 lazy 리셋.

    리셋 = completed_count 0 + cooldown_until 해제 (자정에 쿨다운도 해제).
    doc 이 없으면 저장 없이 오늘자 빈 상태를 돌려준다 (완성/스킵 시점에 upsert).
    """
    mongo = _db(db)
    await _ensure_indexes(db)
    today = _kst_day()
    doc = await mongo.director_fatigue.find_one({"user_id": user_id})
    if doc is None:
        return {"user_id": user_id, "day": today, "completed_count": 0, "cooldown_until": None}
    if doc.get("day") != today:
        # KST 자정 경과 — 카운트/쿨다운 모두 해제 (lazy 저장)
        await mongo.director_fatigue.update_one(
            {"user_id": user_id},
            {"$set": {
                "day": today,
                "completed_count": 0,
                "cooldown_until": None,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        logger.info(
            "[fatigue] daily reset user=%s old_day=%s -> %s (count+cooldown cleared)",
            user_id[:8], doc.get("day"), today,
        )
        return {"user_id": user_id, "day": today, "completed_count": 0, "cooldown_until": None}
    doc["cooldown_until"] = _as_utc(doc.get("cooldown_until"))
    return doc


async def on_generation_completed(user_id: str, db=None) -> None:
    """곡 최종 완성 훅 — 그날 완성 카운트 +1, 사다리 쿨다운 시작.

    suno_generator 배경 루프에서 호출되므로 반드시 루프-로컬 db 를 넘겨야
    한다. best-effort — 어떤 실패도 생성 완료 흐름에 영향을 주지 않는다.
    """
    if not user_id:
        return
    try:
        mongo = _db(db)
        doc = await _load(user_id, db)
        new_count = int(doc.get("completed_count", 0)) + 1
        now = datetime.now(timezone.utc)
        cooldown_until = now + _ladder(new_count)
        await mongo.director_fatigue.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "day": _kst_day(),
                    "completed_count": new_count,
                    "cooldown_until": cooldown_until,
                    "updated_at": now,
                },
                "$setOnInsert": {"user_id": user_id, "created_at": now},
            },
            upsert=True,
        )
        logger.info(
            "[fatigue] completed user=%s today_count=%d cooldown_until=%s",
            user_id[:8], new_count, cooldown_until.isoformat(),
        )
    except Exception:
        logger.exception("[fatigue] on_generation_completed failed user=%s", (user_id or "?")[:8])


async def check_gate(user_id: str, db=None) -> int:
    """작곡 게이트 — 활성 쿨다운 남은 초를 반환 (없으면 0).

    조회 실패 시 0 (게이트 오픈 — 피로 시스템 장애가 작곡을 막지 않는다).
    """
    if not user_id:
        return 0
    try:
        doc = await _load(user_id, db)
        until = doc.get("cooldown_until")
        if not until:
            return 0
        remaining = (until - datetime.now(timezone.utc)).total_seconds()
        return max(0, int(remaining))
    except Exception:
        logger.exception("[fatigue] check_gate failed user=%s (gate open)", (user_id or "?")[:8])
        return 0


async def get_status(user_id: str, db=None) -> dict:
    """피로 상태 조회 (API /api/fatigue/status 의 코어 payload)."""
    doc = await _load(user_id, db)
    until = doc.get("cooldown_until")
    now = datetime.now(timezone.utc)
    remaining = max(0, int((until - now).total_seconds())) if until else 0
    active = remaining > 0
    return {
        "today_completed": int(doc.get("completed_count", 0)),
        "cooldown_active": active,
        "cooldown_until": until.isoformat() if (until and active) else None,
        "cooldown_remaining_sec": remaining,
        "skip_point_cost": SKIP_POINT_COST,
        "skip_minutes": SKIP_MINUTES,
        "ladder": ladder_spec(),
    }


async def reduce_cooldown(user_id: str, minutes: int = SKIP_MINUTES, db=None):
    """활성 쿨다운을 `minutes`분 단축 (바닥은 now — 음수 잔여 없음).

    aggregation-pipeline update 로 원자 실행: cooldown_until =
    max(now, cooldown_until - minutes). 활성 쿨다운이 없으면 None 을
    반환한다 (과금 호출자는 이 경우 환불해야 함). 성공 시 갱신된 doc 반환.
    """
    if not user_id:
        return None
    mongo = _db(db)
    await _ensure_indexes(db)
    now = datetime.now(timezone.utc)
    updated = await mongo.director_fatigue.find_one_and_update(
        {"user_id": user_id, "cooldown_until": {"$gt": now}},
        [{
            "$set": {
                "cooldown_until": {
                    "$max": [now, {"$subtract": ["$cooldown_until", minutes * 60 * 1000]}]
                },
                "updated_at": now,
            }
        }],
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        logger.info("[fatigue] reduce no-op (no active cooldown) user=%s", user_id[:8])
        return None
    updated["cooldown_until"] = _as_utc(updated.get("cooldown_until"))
    logger.info(
        "[fatigue] reduce user=%s -%dmin new_until=%s",
        user_id[:8], minutes,
        updated["cooldown_until"].isoformat() if updated.get("cooldown_until") else None,
    )
    return updated
