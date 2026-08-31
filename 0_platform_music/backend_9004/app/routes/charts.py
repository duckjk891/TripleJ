"""
AIMU Chart System - Melon-style chart algorithm.

Scoring formula: streaming * 40% + download * 60%

Chart types:
  - TOP100: Daytime (08-24 KST) = (24h score * 50% + 1h score * 50%)
            Nighttime (01-07 KST) = 24h score * 100%
            where score = stream_unique * 0.4 + download_unique * 0.6
  - HOT100: 1h score (stream * 0.4 + download * 0.6), songs released within 30 days only
  - Daily:  Today's (stream_unique * 0.4 + download_unique * 0.6)
  - Weekly: This week's (stream_unique * 0.4 + download_unique * 0.6)
  - Monthly: This month's (stream_unique * 0.4 + download_unique * 0.6)
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.redis import get_redis
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/charts")

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

CHART_CACHE_TTL = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc = dict(doc)  # shallow copy to avoid mutating the original
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    # Add aliases for frontend compatibility
    doc["artist_id"] = doc.get("uploader_id")
    doc["artist_name"] = doc.get("uploader_nickname", "AI")
    doc["cover_image"] = doc.get("cover_image_url")
    # B-11 — 소속 앨범 (기본 null, tracks._attach_album_info 배치 첨부가 채움)
    doc.setdefault("album_id", None)
    doc.setdefault("album_title", None)
    return doc


def _now_kst() -> datetime:
    return datetime.now(KST)


def _time_keys(now: datetime) -> dict:
    """Return all Redis key time-component strings for a given KST datetime."""
    # ISO week: YYYY-W## (zero-padded)
    year, week, _ = now.isocalendar()
    return {
        "hourly": now.strftime("%Y%m%d%H"),
        "daily": now.strftime("%Y%m%d"),
        "weekly": f"{year}-W{week:02d}",
        "monthly": now.strftime("%Y%m"),
    }


async def _get_optional_user(
    request: Request,
    authorization: str = Header(None),
) -> Optional[dict]:
    """Like get_current_user but returns None instead of raising 401."""
    try:
        return await get_current_user(request, authorization)
    except Exception:
        return None


async def _fetch_tracks_by_ids(mongo, track_ids: list[str]) -> dict[str, dict]:
    """Batch fetch tracks from MongoDB and return a dict keyed by string id."""
    if not track_ids:
        return {}
    oids = []
    for tid in track_ids:
        if ObjectId.is_valid(tid):
            oids.append(ObjectId(tid))
    if not oids:
        return {}
    docs = await mongo.tracks.find({"_id": {"$in": oids}}).to_list(length=len(oids))
    return {str(d["_id"]): d for d in docs}


def _build_chart_response(
    ranked: list[tuple],
    docs_map: dict[str, dict],
    chart_type: str,
    update_time: str,
) -> list[dict]:
    """Build the final chart response list from ranked (track_id, score, stats) tuples."""
    # Filter first, then assign ranks (no gaps)
    filtered = []
    for item in ranked:
        tid, score = item[0], item[1]
        stats = item[2] if len(item) > 2 else {}
        doc = docs_map.get(tid)
        if not doc:
            continue
        if not doc.get("is_public", True):
            continue
        filtered.append((tid, score, doc, stats))

    result = []
    for rank, (tid, score, doc, stats) in enumerate(filtered, 1):
        t = _serialize_track(doc)
        t["rank"] = rank
        t["score"] = round(score, 2)
        t["change"] = 0  # placeholder for rank change tracking
        t["chart_type"] = chart_type
        t["chart_update_time"] = update_time
        t["listeners_24h"] = stats.get("listeners_24h", 0)
        t["listeners_1h"] = stats.get("listeners_1h", 0)
        t["downloads"] = stats.get("downloads", 0)
        result.append(t)
    return result


# ---------------------------------------------------------------------------
# 1. Record Play API
# ---------------------------------------------------------------------------

class RecordPlayRequest(BaseModel):
    track_id: str


@router.post("/record-play")
async def record_play(
    body: RecordPlayRequest,
    user: Optional[dict] = Depends(_get_optional_user),
):
    """Record a track play for chart calculation.

    Authenticated users get their play counted toward unique listener sets.
    Anonymous requests still increment the legacy play_count but do NOT
    contribute to chart scoring.
    """
    track_id = body.track_id
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    redis = get_redis()

    # Increment legacy play_count in MongoDB regardless of auth status
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"play_count": 1}},
    )

    # v169 — best-effort ES play_count mirror refresh (function_score popularity
    # boost). One extra Mongo read for the post-$inc value, then a partial
    # es.update. MUST NOT affect the play response on any failure.
    try:
        doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"play_count": 1})
        if doc is not None:
            from ..services.search_service import es_update_play_count
            await es_update_play_count(track_id, int(doc.get("play_count") or 0))
    except Exception as _es_exc:
        logger.warning("[search.es.playcount] track=%s hook failed: %s", track_id, _es_exc)

    # Only count for charts if user is authenticated
    if user is None:
        return {"ok": True}

    user_id = str(user.get("id") or user.get("user_id"))
    if not user_id:
        return {"ok": True}

    now = _now_kst()
    keys = _time_keys(now)

    # Redis pipeline for atomicity and performance
    pipe = redis.pipeline()

    # --- Listener dedup sets ---
    listener_keys_ttl = [
        (f"chart:listeners:hourly:{keys['hourly']}:{track_id}", 2 * 3600),
        (f"chart:listeners:daily:{keys['daily']}:{track_id}", 2 * 86400),
        (f"chart:listeners:weekly:{keys['weekly']}:{track_id}", 8 * 86400),
        (f"chart:listeners:monthly:{keys['monthly']}:{track_id}", 32 * 86400),
    ]
    for key, ttl in listener_keys_ttl:
        pipe.sadd(key, user_id)
        pipe.expire(key, ttl)

    # --- Track index sets (so we know which tracks have plays) ---
    index_keys_ttl = [
        (f"chart:tracks:hourly:{keys['hourly']}", 2 * 3600),
        (f"chart:tracks:daily:{keys['daily']}", 2 * 86400),
        (f"chart:tracks:weekly:{keys['weekly']}", 8 * 86400),
        (f"chart:tracks:monthly:{keys['monthly']}", 32 * 86400),
    ]
    for key, ttl in index_keys_ttl:
        pipe.sadd(key, track_id)
        pipe.expire(key, ttl)

    await pipe.execute()

    # Best-effort point award (idempotent / daily-deduped inside the service).
    # MUST NOT affect the play response or chart logic on failure.
    try:
        from ..services.points_service import award_point
        # StarEcon(v158) — 재생 +1 은 하루 5곡 상한 (곡별 멱등은 기존 유지)
        await award_point(user_id, "play", track_id, daily_cap=5)
    except Exception as _pt_exc:
        logger.warning("[points] play hook failed user=%s track=%s: %s", user_id, track_id, _pt_exc)

    # Save to MongoDB for persistence (fire-and-forget style)
    await mongo.play_logs.insert_one({
        "user_id": user_id,
        "track_id": track_id,
        "played_at": now,
    })

    return {"ok": True}


# ---------------------------------------------------------------------------
# Genre chart (declared before /{chart_type} to avoid route shadowing)
# ---------------------------------------------------------------------------

@router.get("/genre/{genre}")
async def genre_chart(genre: str, limit: int = 50):
    mongo = get_mongo()
    cursor = mongo.tracks.find(
        {"is_public": True, "genre": genre}
    ).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    from .tracks import _attach_album_info
    serialized = [_serialize_track(t) for t in tracks]
    await _attach_album_info(mongo, serialized)  # B-11 — 배치 1쿼리
    return serialized


# ---------------------------------------------------------------------------
# Category chart (v77) — fixed 10-item whitelist
# (declared before /{chart_type} to avoid route shadowing)
# ---------------------------------------------------------------------------

@router.get("/categories")
async def list_categories():
    """Return the fixed 10-item category whitelist."""
    from ..constants.categories import CATEGORIES
    return {"categories": CATEGORIES}


@router.get("/category/{category}")
async def category_chart(category: str, limit: int = 50):
    """Tracks whose ``categories`` array contains the given category.

    Mirrors the genre-chart pattern (array membership on the `categories`
    field). A category outside the fixed whitelist returns an empty list.
    """
    from ..constants.categories import CATEGORY_SET

    if category not in CATEGORY_SET:
        logger.info("[charts] category=%s count=%s (not in whitelist)", category, 0)
        return []

    mongo = get_mongo()
    cursor = mongo.tracks.find(
        {"is_public": True, "categories": category}
    ).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    logger.info("[charts] category=%s count=%s", category, len(tracks))
    from .tracks import _attach_album_info
    serialized = [_serialize_track(t) for t in tracks]
    await _attach_album_info(mongo, serialized)  # B-11 — 배치 1쿼리
    return serialized


# ---------------------------------------------------------------------------
# 2. Chart APIs
# ---------------------------------------------------------------------------

VALID_CHART_TYPES = {"top100", "hot100", "daily", "weekly", "monthly"}


@router.get("/{chart_type}")
async def get_chart(chart_type: str, limit: int = 100):
    """Return a chart of the given type.

    Supported chart_type: top100, hot100, daily, weekly, monthly.
    """
    if chart_type not in VALID_CHART_TYPES:
        return JSONResponse(
            status_code=400,
            content={"error": f"chart_type은 {', '.join(sorted(VALID_CHART_TYPES))} 중 하나여야 합니다."},
        )

    # v201-r: limit 클램프 — 422 거부가 아닌 클램프인 이유: 기존 호출자 무영향 +
    # 앱팀 클라이언트가 임의 값을 보내도 안 깨짐. v201 이후 limit 가 캐시 키에
    # 들어가므로 무검증 상태면 ?limit=999999999 류로 Redis 키 무한 생성,
    # 음수 limit 는 음수 슬라이스 오동작. 클램프로 키 공간이 5종×100=최대 500개로 유한.
    limit = max(1, min(limit, 100))

    redis = get_redis()

    # --- Check cache ---
    # v201: limit 를 키에 포함 — 빠지면 먼저 온 요청의 limit 로 잘린 목록이
    # TTL(300s) 동안 다른 limit 요청에도 그대로 서빙된다 (limit=10 이 캐시를
    # 선점하면 limit=100 사용자가 10곡만 받음). 무효화 2곳(admin.py:868,
    # tracks.py:651)은 cache:chart:* 패턴 삭제라 새 형식도 잡는다.
    cache_key = f"cache:chart:{chart_type}:{limit}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    now = _now_kst()
    keys = _time_keys(now)
    mongo = get_mongo()

    if chart_type == "top100":
        ranked = await _calc_top100(redis, now, keys, limit)
    elif chart_type == "hot100":
        ranked = await _calc_hot100(redis, mongo, now, keys, limit)
    elif chart_type == "daily":
        ranked = await _calc_period(redis, "daily", keys["daily"], limit)
    elif chart_type == "weekly":
        ranked = await _calc_period(redis, "weekly", keys["weekly"], limit)
    elif chart_type == "monthly":
        ranked = await _calc_period(redis, "monthly", keys["monthly"], limit)
    else:
        ranked = []

    # Fetch track details
    track_ids = [item[0] for item in ranked]
    docs_map = await _fetch_tracks_by_ids(mongo, track_ids)

    update_time = now.isoformat()
    result = _build_chart_response(ranked, docs_map, chart_type, update_time)

    # B-11 — album 소속 배치 첨부 (1쿼리). 캐시에 포함 — 최대 TTL(300s) 지연 허용.
    from .tracks import _attach_album_info
    await _attach_album_info(mongo, result)

    # Cache the result
    await redis.setex(cache_key, CHART_CACHE_TTL, json.dumps(result, default=str))

    return result


# ---------------------------------------------------------------------------
# Chart calculation helpers
# ---------------------------------------------------------------------------

async def _calc_top100(
    redis, now: datetime, keys: dict, limit: int
) -> list[tuple[str, float]]:
    """TOP100: score = stream*0.4 + download*0.6.
    Daytime: (24h_score * 50% + 1h_score * 50%), Nighttime: 24h_score * 100%.
    """
    hour = now.hour
    is_night = 1 <= hour <= 7

    daily_index_key = f"chart:tracks:daily:{keys['daily']}"
    hourly_index_key = f"chart:tracks:hourly:{keys['hourly']}"
    daily_dl_index_key = f"chart:dl_tracks:daily:{keys['daily']}"
    hourly_dl_index_key = f"chart:dl_tracks:hourly:{keys['hourly']}"

    # Gather all candidate track_ids (from both streaming and download)
    daily_tracks = await redis.smembers(daily_index_key)
    hourly_tracks = await redis.smembers(hourly_index_key) if not is_night else set()
    daily_dl_tracks = await redis.smembers(daily_dl_index_key)
    hourly_dl_tracks = await redis.smembers(hourly_dl_index_key) if not is_night else set()
    all_track_ids = daily_tracks | hourly_tracks | daily_dl_tracks | hourly_dl_tracks

    if not all_track_ids:
        return await _fallback_play_count(limit)

    # Pipeline: for each track, get daily stream, daily download, (hourly stream, hourly download)
    pipe = redis.pipeline()
    track_list = list(all_track_ids)
    for tid in track_list:
        pipe.scard(f"chart:listeners:daily:{keys['daily']}:{tid}")
        pipe.scard(f"chart:downloads:daily:{keys['daily']}:{tid}")
        if not is_night:
            pipe.scard(f"chart:listeners:hourly:{keys['hourly']}:{tid}")
            pipe.scard(f"chart:downloads:hourly:{keys['hourly']}:{tid}")

    counts = await pipe.execute()

    scored: list[tuple[str, float, dict]] = []
    idx = 0
    for tid in track_list:
        daily_stream = counts[idx]; idx += 1
        daily_dl = counts[idx]; idx += 1

        if is_night:
            # Nighttime: 24h only, with 40% stream + 60% download
            score = daily_stream * 0.4 + daily_dl * 0.6
            stats = {"listeners_24h": daily_stream, "listeners_1h": 0, "downloads": daily_dl}
        else:
            hourly_stream = counts[idx]; idx += 1
            hourly_dl = counts[idx]; idx += 1
            # Daytime: (40% stream + 60% download) for both 24h and 1h, then 50/50
            daily_score = daily_stream * 0.4 + daily_dl * 0.6
            hourly_score = hourly_stream * 0.4 + hourly_dl * 0.6
            score = daily_score * 0.5 + hourly_score * 0.5
            stats = {"listeners_24h": daily_stream, "listeners_1h": hourly_stream, "downloads": daily_dl}

        scored.append((tid, score, stats))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


async def _calc_hot100(
    redis, mongo, now: datetime, keys: dict, limit: int
) -> list[tuple[str, float]]:
    """HOT100: 1h score (stream*0.4 + download*0.6), only tracks released within last 30 days."""
    hourly_index_key = f"chart:tracks:hourly:{keys['hourly']}"
    hourly_dl_index_key = f"chart:dl_tracks:hourly:{keys['hourly']}"
    stream_ids = await redis.smembers(hourly_index_key)
    dl_ids = await redis.smembers(hourly_dl_index_key)
    track_ids = stream_ids | dl_ids

    if not track_ids:
        return []

    # Filter: only tracks created within last 30 days
    cutoff = now - timedelta(days=30)
    # Convert cutoff to naive UTC for MongoDB comparison (MongoDB stores naive datetimes)
    cutoff_utc = cutoff.astimezone(timezone.utc).replace(tzinfo=None)

    oids = [ObjectId(tid) for tid in track_ids if ObjectId.is_valid(tid)]
    if not oids:
        return []

    recent_docs = await mongo.tracks.find(
        {"_id": {"$in": oids}, "created_at": {"$gte": cutoff_utc}},
        {"_id": 1},
    ).to_list(length=len(oids))
    recent_ids = {str(d["_id"]) for d in recent_docs}

    if not recent_ids:
        return []

    # Get hourly unique listener + download counts
    pipe = redis.pipeline()
    tid_list = list(recent_ids)
    for tid in tid_list:
        pipe.scard(f"chart:listeners:hourly:{keys['hourly']}:{tid}")
        pipe.scard(f"chart:downloads:hourly:{keys['hourly']}:{tid}")
    counts = await pipe.execute()

    scored = []
    for i, tid in enumerate(tid_list):
        hourly_stream = counts[i * 2]
        hourly_dl = counts[i * 2 + 1]
        score = hourly_stream * 0.4 + hourly_dl * 0.6
        if score > 0:
            stats = {"listeners_24h": 0, "listeners_1h": hourly_stream, "downloads": hourly_dl}
            scored.append((tid, score, stats))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


async def _calc_period(
    redis, period: str, period_key: str, limit: int
) -> list[tuple[str, float]]:
    """Daily/Weekly/Monthly chart: stream_unique * 0.4 + download_unique * 0.6."""
    index_key = f"chart:tracks:{period}:{period_key}"
    dl_index_key = f"chart:dl_tracks:{period}:{period_key}"
    stream_ids = await redis.smembers(index_key)
    dl_ids = await redis.smembers(dl_index_key)
    track_ids = stream_ids | dl_ids

    if not track_ids:
        return await _fallback_play_count(limit)

    pipe = redis.pipeline()
    tid_list = list(track_ids)
    for tid in tid_list:
        pipe.scard(f"chart:listeners:{period}:{period_key}:{tid}")
        pipe.scard(f"chart:downloads:{period}:{period_key}:{tid}")
    counts = await pipe.execute()

    scored = []
    for i, tid in enumerate(tid_list):
        stream_cnt = counts[i * 2]
        dl_cnt = counts[i * 2 + 1]
        score = stream_cnt * 0.4 + dl_cnt * 0.6
        stats = {"listeners_24h": stream_cnt, "listeners_1h": 0, "downloads": dl_cnt}
        scored.append((tid, score, stats))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


async def _fallback_play_count(limit: int) -> list[tuple[str, float]]:
    """Fallback: use MongoDB play_count when no Redis data is available."""
    mongo = get_mongo()
    cursor = mongo.tracks.find({"is_public": True}).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return [(str(t["_id"]), float(t.get("play_count", 0)), {"listeners_24h": 0, "listeners_1h": 0, "downloads": 0}) for t in tracks]


