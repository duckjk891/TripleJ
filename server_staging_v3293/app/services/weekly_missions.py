"""v3.293 [WeeklyMission] 주간 미션 — 내 아티스트로 창작하면 ⭐ 보상(대표 확정 2026-10-06 '주간 미션형').

- 주 = KST 월요일 00:00 ~ 다음 월요일 00:00 (week key 'YYYY-Www', ISO 주차).
- artist_songs  : 내 아티스트(본인 소유 character_id)로 AI 생성곡 3곡 발매 → ⭐15 (주 1회)
- artist_covers : 내 아티스트 곡에 AI 커버(이미지 디렉터 세션 산출물) 3개 적용 → ⭐5 (주 1회)
- 같은 곡은 미션별로 1번만 센다($addToSet). 보상은 원자 클레임 1회(rewarded_at 미설정 문서만).
- 호출부(발매·커버 적용)는 best-effort — 실패해도 원래 응답에 영향 없음(never raises).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo import ReturnDocument

from ..database.mongodb import get_mongo
from .points_service import grant_points

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
COLLECTION = "weekly_mission_progress"

MISSIONS = {
    "artist_songs": {
        "title": "내 아티스트로 곡 3곡 발매하기",
        "target": 3,
        "reward": 15,
    },
    "artist_covers": {
        "title": "내 아티스트 곡에 커버 이미지 3개 넣기",
        "target": 3,
        "reward": 5,
    },
}
MISSION_ORDER = ["artist_songs", "artist_covers"]

_indexes_ready = False


def week_key(now: Optional[datetime] = None) -> str:
    n = (now or datetime.now(timezone.utc)).astimezone(KST)
    y, w, _ = n.isocalendar()
    return f"{y}-W{w:02d}"


def week_ends_at(now: Optional[datetime] = None) -> datetime:
    """이번 주 미션 마감(다음 월요일 00:00 KST) — UTC aware."""
    n = (now or datetime.now(timezone.utc)).astimezone(KST)
    monday = (n - timedelta(days=n.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return (monday + timedelta(days=7)).astimezone(timezone.utc)


async def _ensure_indexes(mongo) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await mongo[COLLECTION].create_index([("user_id", 1), ("week", 1), ("mission", 1)], unique=True)
    _indexes_ready = True


async def is_own_artist(mongo, user_id: str, character_id: Optional[str]) -> bool:
    cid = (character_id or "").strip().lower()
    if not user_id or not cid:
        return False
    try:
        return bool(await mongo.characters.find_one({"user_id": user_id, "character_id": cid}, {"_id": 1}))
    except Exception:
        logger.exception("[WeeklyMission] artist lookup failed user=%s cid=%s", str(user_id)[:8], cid[:36])
        return False


async def record_progress(user_id: str, mission: str, ref_id: str, *, now: Optional[datetime] = None) -> Optional[dict]:
    """미션 진행 1건 기록(같은 ref 는 1번만) → 달성 시 1회 보상. never raises. 반환: 갱신 문서(또는 None)."""
    spec = MISSIONS.get(mission)
    if not spec or not user_id or not ref_id:
        return None
    try:
        mongo = get_mongo()
        await _ensure_indexes(mongo)
        wk = week_key(now)
        ts = datetime.now(timezone.utc)
        doc = await mongo[COLLECTION].find_one_and_update(
            {"user_id": user_id, "week": wk, "mission": mission},
            {"$addToSet": {"refs": str(ref_id)},
             "$set": {"updated_at": ts},
             "$setOnInsert": {"user_id": user_id, "week": wk, "mission": mission, "created_at": ts}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        count = len((doc or {}).get("refs") or [])
        logger.info(
            "[WeeklyMission] progress user=%s week=%s mission=%s ref=%s count=%d/%d",
            str(user_id)[:8], wk, mission, str(ref_id)[:24], count, spec["target"],
        )
        if count >= spec["target"] and not (doc or {}).get("rewarded_at"):
            claimed = await mongo[COLLECTION].find_one_and_update(
                {"user_id": user_id, "week": wk, "mission": mission, "rewarded_at": {"$exists": False}},
                {"$set": {"rewarded_at": ts, "reward": spec["reward"]}},
                return_document=ReturnDocument.AFTER,
            )
            if claimed:
                ok = await grant_points(
                    user_id, f"weekly_mission_{mission}", spec["reward"], note=f"{wk} {spec['title']}",
                )
                logger.info(
                    "[WeeklyMission] reward user=%s week=%s mission=%s +%d granted=%s",
                    str(user_id)[:8], wk, mission, spec["reward"], ok,
                )
                if not ok:
                    # 지급 실패 → 클레임 되돌려 다음 진행 때 재시도
                    await mongo[COLLECTION].update_one(
                        {"_id": claimed["_id"]}, {"$unset": {"rewarded_at": "", "reward": ""}},
                    )
                    return claimed
                await _notify_reward(mongo, user_id, spec)
                return claimed
        return doc
    except Exception:
        logger.exception("[WeeklyMission] record failed user=%s mission=%s ref=%s", str(user_id)[:8], mission, str(ref_id)[:24])
        return None


async def _notify_reward(mongo, user_id: str, spec: dict) -> None:
    try:
        from ..routes.notifications import push_notification
        await push_notification(
            mongo,
            user_id=user_id,
            ntype="star",
            actor_id="maidol_system",
            actor_nickname="MAIDOL",
            target_type="star_grant",
            preview=f"주간 미션 달성 — {spec['title']}",
            extra={"amount": spec["reward"]},
        )
    except Exception:
        logger.exception("[WeeklyMission] notify failed user=%s", str(user_id)[:8])


async def weekly_status(user_id: str, *, now: Optional[datetime] = None) -> dict:
    """이번 주 미션 현황 — 앱 표시용."""
    mongo = get_mongo()
    wk = week_key(now)
    docs = {}
    try:
        async for d in mongo[COLLECTION].find({"user_id": user_id, "week": wk}):
            docs[d.get("mission")] = d
    except Exception:
        logger.exception("[WeeklyMission] status load failed user=%s", str(user_id)[:8])
    items = []
    for key in MISSION_ORDER:
        spec = MISSIONS[key]
        d = docs.get(key) or {}
        items.append({
            "key": key,
            "title": spec["title"],
            "target": spec["target"],
            "count": min(len(d.get("refs") or []), spec["target"]),
            "reward": spec["reward"],
            "rewarded": bool(d.get("rewarded_at")),
        })
    return {"week": wk, "ends_at": week_ends_at(now).isoformat(), "missions": items}
