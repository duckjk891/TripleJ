"""v3.297 [Reputation] 배지 · 피드백 온도(대표 선택 10-06 — 문토·당근 매너온도 응용).

GET /api/reputation/{user_id} — 공개(비로그인 가능). 기존 활동 데이터에서 계산만 한다(별도 적립 없음).
- 피드백 온도: 36.5 시작 + 남긴 댓글(곡·피드) 0.2°씩(최대 +15) + 누른 좋아요(곡·피드) 0.05°씩(최대 +10)
  − 인정된 신고(내 콘텐츠 blind 처리) 2°씩. 0~99 로 자름, 소수 1자리.
- 배지: 첫 발매 · 꾸준한 창작자(10곡) · 인기곡 보유(재생 100 또는 좋아요 10) · 아티스트 데뷔 · 크루장 ·
  소통왕(댓글 20) · 주간 미션 달성 · 따뜻한 피드백(40° 이상).
- Redis 10분 캐시(실패 시 무캐시로 계산). 조회 실패 항목은 0 으로 강등(응답은 항상 200).
"""
import json
import logging
import uuid

from fastapi import APIRouter, Depends

from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reputation")

BASE_TEMP = 36.5
CACHE_SEC = 600

BADGES = [
    # key, label, icon(Feather), 설명
    ("first_release", "첫 발매", "music", "첫 곡을 발매했어요"),
    ("prolific", "꾸준한 창작자", "layers", "곡을 10곡 이상 발매했어요"),
    ("hit", "인기곡 보유", "trending-up", "재생 100회 또는 좋아요 10개를 넘긴 곡이 있어요"),
    ("artist_debut", "아티스트 데뷔", "user-check", "나만의 AI 아티스트를 만들었어요"),
    ("crew_leader", "크루장", "flag", "크루를 운영하고 있어요"),
    ("commenter", "소통왕", "message-circle", "다른 사람 작품에 댓글을 20개 이상 남겼어요"),
    ("mission", "주간 미션 달성", "award", "주간 미션을 완료한 적이 있어요"),
    ("warm", "따뜻한 피드백", "sun", "피드백 온도 40° 이상"),
]


def compute_temperature(comments: int, likes_given: int, upheld_reports: int) -> float:
    t = BASE_TEMP + min(15.0, 0.2 * max(0, comments)) + min(10.0, 0.05 * max(0, likes_given)) - 2.0 * max(0, upheld_reports)
    return round(max(0.0, min(99.0, t)), 1)


def earned_badges(stats: dict, temperature: float) -> list:
    earned = {
        "first_release": stats.get("tracks", 0) >= 1,
        "prolific": stats.get("tracks", 0) >= 10,
        "hit": bool(stats.get("hit")),
        "artist_debut": stats.get("artists", 0) >= 1,
        "crew_leader": bool(stats.get("crew_leader")),
        "commenter": stats.get("comments", 0) >= 20,
        "mission": bool(stats.get("mission")),
        "warm": temperature >= 40.0,
    }
    return [{"key": k, "label": label, "icon": icon, "desc": desc} for k, label, icon, desc in BADGES if earned.get(k)]


async def _safe(coro, default, what: str, uid: str):
    try:
        return await coro
    except Exception:
        logger.exception("[Reputation] %s failed user=%s", what, uid[:8])
        return default


async def collect_stats(mongo, conn, uid: str) -> dict:
    stats = {}
    stats["tracks"] = await _safe(mongo.tracks.count_documents({"uploader_id": uid}), 0, "tracks", uid)
    stats["hit"] = bool(await _safe(mongo.tracks.find_one(
        {"uploader_id": uid, "$or": [{"play_count": {"$gte": 100}}, {"like_count": {"$gte": 10}}]}, {"_id": 1},
    ), None, "hit", uid))
    stats["artists"] = await _safe(mongo.characters.count_documents(
        {"user_id": uid, "character_id": {"$nin": [None, ""]}}), 0, "artists", uid)
    stats["crew_leader"] = bool(await _safe(mongo.clubs.find_one(
        {"owner_id": uid, "report_blinded": {"$ne": True}}, {"_id": 1}), None, "crew", uid))
    tc = await _safe(mongo.track_comments.count_documents({"author_id": uid}), 0, "track_comments", uid)
    fc = await _safe(mongo.feed_comments.count_documents({"author_id": uid}), 0, "feed_comments", uid)
    stats["comments"] = int(tc) + int(fc)
    stats["mission"] = bool(await _safe(mongo.weekly_mission_progress.find_one(
        {"user_id": uid, "rewarded_at": {"$exists": True}}, {"_id": 1}), None, "mission", uid))
    likes = 0
    upheld = 0
    if conn is not None:
        try:
            u = uuid.UUID(uid)
            likes += int(await conn.fetchval("SELECT COUNT(*) FROM likes WHERE user_id = $1", u) or 0)
        except Exception:
            logger.exception("[Reputation] likes failed user=%s", uid[:8])
        try:
            likes += int(await conn.fetchval("SELECT COUNT(*) FROM feed_likes WHERE user_id = $1", uid) or 0)
        except Exception:
            logger.exception("[Reputation] feed_likes failed user=%s", uid[:8])
        try:
            upheld = int(await conn.fetchval(
                "SELECT COUNT(*) FROM reports WHERE status = 'actioned' AND evidence->>'owner_id' = $1", uid,
            ) or 0)
        except Exception:
            logger.exception("[Reputation] reports failed user=%s", uid[:8])
    stats["likes_given"] = likes
    stats["upheld_reports"] = upheld
    return stats


@router.get("/{user_id}")
async def get_reputation(user_id: str, conn=Depends(get_pg)):
    uid = str(user_id or "").strip()[:64]
    if not uid:
        return {"temperature": BASE_TEMP, "badges": [], "base": BASE_TEMP}
    ck = f"reputation:v1:{uid}"
    redis = None
    try:
        redis = get_redis()
        cached = await redis.get(ck) if redis is not None else None
        if cached:
            return json.loads(cached)
    except Exception:
        logger.warning("[Reputation] cache read failed user=%s", uid[:8])
    stats = await collect_stats(get_mongo(), conn, uid)
    temp = compute_temperature(stats["comments"], stats["likes_given"], stats["upheld_reports"])
    out = {"temperature": temp, "base": BASE_TEMP, "badges": earned_badges(stats, temp)}
    logger.info(
        "[Reputation] user=%s temp=%.1f comments=%d likes=%d upheld=%d badges=%s",
        uid[:8], temp, stats["comments"], stats["likes_given"], stats["upheld_reports"],
        [b["key"] for b in out["badges"]],
    )
    try:
        if redis is not None:
            await redis.set(ck, json.dumps(out, ensure_ascii=False), ex=CACHE_SEC)
    except Exception:
        logger.warning("[Reputation] cache write failed user=%s", uid[:8])
    return out
