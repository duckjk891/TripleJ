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

v3.230 S2 (대표 결정 D5):
  - 본인 곡 재생·다운로드는 모든 차트에서 제외(쓰기 시 셋 미가산 + 읽기 시 업로더 id 제거).
    play_count·download_count·재생 ⭐ 적립·play_logs/download_logs(is_owner 기록)는 현행 유지.
  - TOP100 의 "24h" = 롤링 24시간(최근 24개 시간 셋 ∪ 오늘 일간 셋). 시간 셋 TTL 26h.
  - 동점 정렬 = score → listeners_1h → listeners_24h → track_id. 점수 0·비공개·삭제 곡 제외.
  - 빈 차트 폴백: TOP100 = 주간 점수 → 총 재생수, 일/주/월간 = 총 재생수. 좋아요는 반영하지 않음.

v3.253 크루 플리 혜택:
  - record-play 가 선택 body 필드 source={type:'club_playlist', playlist_id, club_id} 를 받는다.
    검증 전부 통과(인증·플리 실존·club_id 일치·비멤버·30초 dedup 통과·일 상한 30) 시에만
    크루 RP +2 조용한 적립 — 응답 shape 불변({"ok": True}), 검증 실패·예외는 무시(재생 기록은 기존대로).
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

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
    # v236 — 곡에 기록된 아티스트명 우선, 없으면 기획사명(닉네임) 폴백 (tracks._serialize_track 동일)
    doc["agency_name"] = doc.get("uploader_nickname", "AI")
    doc["artist_name"] = doc.get("artist_name") or doc.get("uploader_nickname", "AI")
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
    # v3.253 크루 플리 혜택 — 선택. {type:'club_playlist', playlist_id, club_id} 외 형태는 전부 무시
    # (Any: 구·비정상 클라이언트가 무엇을 보내도 record-play 는 422 없이 기존대로 동작해야 한다).
    source: Optional[Any] = None


# v3.229 P — 재생 기록 중복 방지. 같은 사용자(비로그인은 클라이언트 IP 해시)×같은 곡이
# PLAY_DEDUP_SEC 안에 다시 기록되면 play_count·ES·play_logs 를 올리지 않는다(앱 재마운트·
# 연타·큐 재시작 이중 호출 흡수). 30초 = 가장 짧은 곡 길이보다 짧게 잡아 "끝까지 듣고 다시
# 재생"은 항상 집계되게 한다. 리스너 셋(sadd)·포인트(award_point)는 원래 멱등이라 그대로 수행.
PLAY_DEDUP_SEC = 30


def _play_client_key(request: Optional[Request]) -> Optional[str]:
    """비로그인 중복 방지 키 — nginx X-Forwarded-For/X-Real-IP 우선, 없으면 소켓 주소. IP 원문 대신 해시."""
    if request is None:
        return None
    try:
        ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        ip = ip or (request.headers.get("x-real-ip") or "").strip()
        if not ip and request.client:
            ip = request.client.host or ""
    except Exception:
        ip = ""
    if not ip:
        return None
    return "ip:" + hashlib.sha256(ip.encode("utf-8")).hexdigest()[:16]


async def _play_dedup_hit(redis, who: Optional[str], track_id: str) -> bool:
    """True = 창 안 재호출(집계 생략). Redis 장애·식별 불가면 False(현행대로 집계 — fail-open)."""
    if not who or redis is None:
        return False
    try:
        fresh = await redis.set(f"playdedup:{who}:{track_id}", "1", ex=PLAY_DEDUP_SEC, nx=True)
        return not fresh
    except Exception as e:
        logger.warning("[PlayCount] dedup check failed track=%s: %s", track_id[:8], e)
        return False


# v3.230 S2 — 본인 곡 차트 제외·롤링 24시간.
HOURLY_SET_TTL = 26 * 3600      # 시간 셋 보존(롤링 24h + 여유 2h). 구 2h.
ROLLING_HOURS = 24
TRACK_OWNER_CACHE_TTL = 3600    # track:owner:{id} — 업로더는 바뀌지 않음


def _rolling_hour_keys(now: datetime, hours: int = ROLLING_HOURS) -> list[str]:
    """now(KST) 가 속한 시각부터 과거로 hours 개의 시간 키(YYYYMMDDHH). 현재 시각 포함."""
    base = now.replace(minute=0, second=0, microsecond=0)
    return [(base - timedelta(hours=i)).strftime("%Y%m%d%H") for i in range(hours)]


async def _track_owner(mongo, redis, track_id: str) -> tuple:
    """(found, owner_id) — found: True=곡 있음 / False=곡 없음 / None=조회 실패(fail-open).
    Redis `track:owner:{id}` 1h 캐시(업로더 없는 곡은 빈 문자열)."""
    ck = f"track:owner:{track_id}"
    if redis is not None:
        try:
            cached = await redis.get(ck)
            if cached is not None:
                return True, (cached or None)
        except Exception as e:
            logger.warning("[ChartOwnerExclude] owner cache read failed track=%s: %s", track_id[:8], e)
    try:
        doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"uploader_id": 1})
    except Exception as e:
        logger.warning("[ChartOwnerExclude] owner lookup failed track=%s: %s — fail-open", track_id[:8], e)
        return None, None
    if doc is None:
        return False, None
    owner = str(doc.get("uploader_id") or "")
    if redis is not None:
        try:
            await redis.setex(ck, TRACK_OWNER_CACHE_TTL, owner)
        except Exception as e:
            logger.warning("[ChartOwnerExclude] owner cache write failed track=%s: %s", track_id[:8], e)
    return True, (owner or None)


# v3.253 크루 플리 혜택 — record-play body.source={type:'club_playlist', playlist_id, club_id}.
# 검증 체인(fail-closed — 전부 통과 시에만 크루 RP +2, 실패·불일치·예외는 조용히 미적립):
#   ① 인증 유저(호출측 보장) ② 플리 실존 + playlist.club_id == club_id (PG 1쿼리)
#   ③ 청취자 비멤버(club_members — 멤버 자기 재생 미적립) ④ 30초 dedup 통과분만(호출측 보장)
#   ⑤ 유저·크루·KST일 상한 +30 RP(Redis crewrp:{club}:{uid}:{yyyymmdd} INCRBY, EXPIRE 2일).
# 곡 소유자 여부는 무관(크루 RP 는 멤버십만 본다 — 아티스트 RP 경로와 독립). 재생 응답 절대 비영향.
async def _crew_source_award(mongo, redis, user_id: str, source) -> None:
    try:
        import uuid as _uuid

        from ..services.recognition import RP_CREW_PLAY, crew_award, crew_play_cap_claim

        if not isinstance(source, dict) or source.get("type") != "club_playlist":
            return
        playlist_id = str(source.get("playlist_id") or "").strip()
        club_id = str(source.get("club_id") or "").strip()
        if not playlist_id or not club_id:
            return
        try:
            pl_uuid = _uuid.UUID(playlist_id)
        except (TypeError, ValueError, AttributeError):
            return
        from ..database import postgres as _pgmod

        pool = getattr(_pgmod, "_pool", None)
        if pool is None:
            return
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT club_id FROM playlists WHERE id = $1", pl_uuid)
        if not row or not row["club_id"] or str(row["club_id"]) != club_id:
            logger.info("[CrewRecog] play source mismatch plid=%s club=%s", playlist_id[:8], club_id[:8])
            return
        member = await mongo.club_members.find_one({"club_id": club_id, "user_id": user_id})
        if member is not None:
            logger.info("[CrewRecog] play member_skip club=%s user=%s", club_id[:8], user_id[:8])
            return
        if not await crew_play_cap_claim(redis, club_id, user_id, RP_CREW_PLAY):
            return
        await crew_award(mongo, club_id, RP_CREW_PLAY, "club_playlist_play", actor=user_id, ref=playlist_id)
    except Exception as e:  # noqa: BLE001 — 재생 응답 절대 비영향
        logger.warning("[CrewRecog] play hook failed user=%s: %s", str(user_id or "?")[:8], e)


@router.post("/record-play")
async def record_play(
    body: RecordPlayRequest,
    request: Request,
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

    _uid_raw = (user or {}).get("id") or (user or {}).get("user_id")
    _who = ("u:" + str(_uid_raw)) if _uid_raw else _play_client_key(request)
    deduped = await _play_dedup_hit(redis, _who, track_id)
    logger.info(
        "[PlayCount] record track=%s user=%s dedup=%s",
        track_id[:8], (str(_uid_raw)[:8] if _uid_raw else ("anon" if _who else "anon-noid")), deduped,
    )

    if not deduped:
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

    # v3.230 S2(D5) — 본인 곡 재생은 차트(리스너 셋) 미가산. play_count·play_logs·재생 ⭐ 적립은 현행 유지.
    # 소유자 조회 실패(Mongo/Redis 장애)는 fail-open(현행대로 가산) — 차트 계산이 읽기 시점에 소유자를
    # 한 번 더 빼므로 차트에는 결국 반영되지 않는다.
    owner_found, owner_id = await _track_owner(mongo, redis, track_id)
    is_owner = bool(owner_id) and owner_id == user_id
    if owner_found is False:
        logger.info("[ChartOwnerExclude] play track=%s user=%s track_missing skip_chart=True", track_id[:8], user_id[:8])
    elif is_owner:
        logger.info("[ChartOwnerExclude] play track=%s user=%s owner=True skip_chart=True", track_id[:8], user_id[:8])
    else:
        # Redis pipeline for atomicity and performance
        pipe = redis.pipeline()

        # --- Listener dedup sets ---
        # v3.230 S2 — hourly TTL 2h→26h: 롤링 24시간(최근 24개 시간 셋 합집합) 계산 원천.
        listener_keys_ttl = [
            (f"chart:listeners:hourly:{keys['hourly']}:{track_id}", HOURLY_SET_TTL),
            (f"chart:listeners:daily:{keys['daily']}:{track_id}", 2 * 86400),
            (f"chart:listeners:weekly:{keys['weekly']}:{track_id}", 8 * 86400),
            (f"chart:listeners:monthly:{keys['monthly']}:{track_id}", 32 * 86400),
        ]
        for key, ttl in listener_keys_ttl:
            pipe.sadd(key, user_id)
            pipe.expire(key, ttl)

        # --- Track index sets (so we know which tracks have plays) ---
        index_keys_ttl = [
            (f"chart:tracks:hourly:{keys['hourly']}", HOURLY_SET_TTL),
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
    # v3.229 P — 창 안 재호출은 재생 이력(play_logs — 관리자 통계·차트 복구 원천)에도 남기지 않는다.
    # v3.230 S2 — is_owner 기록(차트 복구가 같은 기준으로 제외).
    if not deduped:
        await mongo.play_logs.insert_one({
            "user_id": user_id,
            "track_id": track_id,
            "played_at": now,
            "is_owner": is_owner,
        })

        # v3.251 인지도 — 타인 실재생 +2 RP (본인 재생 미지급 — v3.230 차트 기준 재사용,
        # dedup 통과분만 = play_logs 와 동일 게이트. best-effort, 재생 응답 불변)
        if not is_owner:
            try:
                from ..services.recognition import RP_PLAY, award_rp, get_track_character_id
                _cid = await get_track_character_id(mongo, redis, track_id)
                if _cid:
                    await award_rp(mongo, _cid, RP_PLAY, "play", actor=user_id, ref=track_id)
            except Exception as e:
                logger.warning("[Recog] play hook failed track=%s: %s", track_id[:8], e)

        # v3.253 크루 플리 혜택 — source 검증 전부 통과 시에만 크루 RP +2(조용한 적립 —
        # 응답 shape 불변, 검증 실패·예외 무시). 인증 + dedup 통과 분기 안(게이트 명세).
        if body.source is not None:
            await _crew_source_award(mongo, redis, user_id, body.source)

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
    update_time = now.isoformat()

    async def _finalize(ranked: list, basis: str) -> list[dict]:
        ranked = ranked[:limit]
        docs_map = await _fetch_tracks_by_ids(mongo, [item[0] for item in ranked])
        out = _build_chart_response(ranked, docs_map, chart_type, update_time)
        for t in out:
            t["chart_basis"] = basis  # v3.230 — 가산 키: rolling24h|hourly|daily|weekly|monthly|play_count
        return out

    # v3.230 S2(D5) — 빈 차트 폴백 = (top100) 주간 점수 → 총 재생수, (daily/weekly/monthly) 총 재생수.
    # "빈" = 소유자 제외·비공개 제외 후 결과 0곡. hot100 은 현행대로 폴백 없음.
    if chart_type == "top100":
        basis = "rolling24h"
        result = await _finalize(await _calc_top100(redis, mongo, now, keys), basis)
        if not result:
            logger.info("[ChartCalc] top100 empty rolling24h -> fallback weekly")
            basis = "weekly"
            result = await _finalize(await _calc_period(redis, mongo, "weekly", keys["weekly"]), basis)
    elif chart_type == "hot100":
        basis = "hourly"
        result = await _finalize(await _calc_hot100(redis, mongo, now, keys), basis)
    else:
        basis = chart_type
        result = await _finalize(await _calc_period(redis, mongo, chart_type, keys[chart_type]), basis)

    if not result and chart_type != "hot100":
        logger.info("[ChartCalc] %s empty %s -> fallback play_count", chart_type, basis)
        basis = "play_count"
        result = await _finalize(await _fallback_play_count(limit), basis)

    logger.info("[ChartCalc] %s done basis=%s n=%d limit=%d", chart_type, basis, len(result), limit)

    # B-11 — album 소속 배치 첨부 (1쿼리). 캐시에 포함 — 최대 TTL(300s) 지연 허용.
    from .tracks import _attach_album_info
    await _attach_album_info(mongo, result)

    # Cache the result
    await redis.setex(cache_key, CHART_CACHE_TTL, json.dumps(result, default=str))

    return result


# ---------------------------------------------------------------------------
# Chart calculation helpers
# v3.230 S2 — ① 읽기 시점 소유자 제외(셋 멤버에서 곡 업로더 id 를 뺀다 — 배포 전 쌓인 본인 기록도
#   즉시 무효), ② 롤링 24시간(최근 24개 시간 셋 + 오늘 일간 셋 합집합 — 오늘 0시 이후는 항상 최근 24h
#   안이라 전환기에도 과대 집계 없음), ③ 점수 0 곡 제외, ④ 결정적 정렬
#   score → listeners_1h → listeners_24h → track_id, ⑤ 비공개·삭제 곡은 점수 계산 전에 제외해
#   limit 자리를 차지하지 않게. 반환은 자르지 않은 전체 순위(get_chart 가 limit 로 자름).
# ---------------------------------------------------------------------------

def _rank_key(item: tuple):
    tid, score, stats = item[0], item[1], item[2]
    return (-round(score, 6), -int(stats.get("listeners_1h", 0)), -int(stats.get("listeners_24h", 0)), tid)


async def _track_meta(mongo, track_ids) -> dict[str, dict]:
    """{tid: {"owner": uploader_id|"", "public": bool}} — 삭제된 곡은 빠진다."""
    oids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(t)]
    if not oids:
        return {}
    docs = await mongo.tracks.find(
        {"_id": {"$in": oids}}, {"_id": 1, "uploader_id": 1, "is_public": 1}
    ).to_list(length=len(oids))
    return {
        str(d["_id"]): {"owner": str(d.get("uploader_id") or ""), "public": d.get("is_public", True) is not False}
        for d in docs
    }


def _eligible(meta: dict, tid: str) -> bool:
    m = meta.get(tid)
    return bool(m) and m["public"]


def _drop_owner(members, owner: str) -> set:
    s = set(members or ())
    if owner:
        s.discard(owner)
    return s


async def _calc_top100(redis, mongo, now: datetime, keys: dict) -> list[tuple]:
    """TOP100: score = stream*0.4 + download*0.6 (순 이용자, 본인 제외).
    Daytime(08~24시·00시): 롤링24h_score*50% + 1h_score*50%, Nighttime(01~07시): 롤링24h_score*100%.
    """
    hour = now.hour
    is_night = 1 <= hour <= 7
    hours = _rolling_hour_keys(now)
    cur_h = keys["hourly"]
    day = keys["daily"]

    idx_keys = (
        [f"chart:tracks:hourly:{h}" for h in hours]
        + [f"chart:dl_tracks:hourly:{h}" for h in hours]
        + [f"chart:tracks:daily:{day}", f"chart:dl_tracks:daily:{day}"]
    )
    candidates = set(await redis.sunion(*idx_keys) or ())
    if not candidates:
        logger.info("[ChartCalc] top100 no candidates night=%s hours=%d", is_night, len(hours))
        return []

    meta = await _track_meta(mongo, candidates)
    track_list = sorted(t for t in candidates if _eligible(meta, t))
    skipped = len(candidates) - len(track_list)

    pipe = redis.pipeline()
    for tid in track_list:
        pipe.sunion(*([f"chart:listeners:hourly:{h}:{tid}" for h in hours] + [f"chart:listeners:daily:{day}:{tid}"]))
        pipe.sunion(*([f"chart:downloads:hourly:{h}:{tid}" for h in hours] + [f"chart:downloads:daily:{day}:{tid}"]))
        if not is_night:
            pipe.smembers(f"chart:listeners:hourly:{cur_h}:{tid}")
            pipe.smembers(f"chart:downloads:hourly:{cur_h}:{tid}")
    res = await pipe.execute() if track_list else []

    step = 2 if is_night else 4
    scored: list[tuple] = []
    owner_dropped = 0
    for i, tid in enumerate(track_list):
        owner = meta[tid]["owner"]
        raw_l24, raw_d24 = res[i * step], res[i * step + 1]
        l24 = _drop_owner(raw_l24, owner)
        d24 = _drop_owner(raw_d24, owner)
        if len(l24) != len(set(raw_l24 or ())) or len(d24) != len(set(raw_d24 or ())):
            owner_dropped += 1
        score_24 = len(l24) * 0.4 + len(d24) * 0.6
        if is_night:
            l1 = set()
            score = score_24
        else:
            l1 = _drop_owner(res[i * step + 2], owner)
            d1 = _drop_owner(res[i * step + 3], owner)
            score = score_24 * 0.5 + (len(l1) * 0.4 + len(d1) * 0.6) * 0.5
        if score <= 0:
            continue
        stats = {"listeners_24h": len(l24), "listeners_1h": len(l1), "downloads": len(d24)}
        scored.append((tid, score, stats))

    scored.sort(key=_rank_key)
    logger.info(
        "[ChartCalc] top100 night=%s candidates=%d skipped_private_or_missing=%d owner_dropped=%d scored=%d",
        is_night, len(candidates), skipped, owner_dropped, len(scored),
    )
    return scored


async def _calc_hot100(redis, mongo, now: datetime, keys: dict) -> list[tuple]:
    """HOT100: 1h score (stream*0.4 + download*0.6, 본인 제외), only tracks released within last 30 days."""
    hourly_index_key = f"chart:tracks:hourly:{keys['hourly']}"
    hourly_dl_index_key = f"chart:dl_tracks:hourly:{keys['hourly']}"
    stream_ids = await redis.smembers(hourly_index_key)
    dl_ids = await redis.smembers(hourly_dl_index_key)
    track_ids = set(stream_ids or ()) | set(dl_ids or ())

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
        {"_id": 1, "uploader_id": 1, "is_public": 1},
    ).to_list(length=len(oids))
    meta = {
        str(d["_id"]): {"owner": str(d.get("uploader_id") or ""), "public": d.get("is_public", True) is not False}
        for d in recent_docs
    }
    tid_list = sorted(t for t in meta if meta[t]["public"])
    if not tid_list:
        return []

    pipe = redis.pipeline()
    for tid in tid_list:
        pipe.smembers(f"chart:listeners:hourly:{keys['hourly']}:{tid}")
        pipe.smembers(f"chart:downloads:hourly:{keys['hourly']}:{tid}")
    res = await pipe.execute()

    scored = []
    for i, tid in enumerate(tid_list):
        owner = meta[tid]["owner"]
        hourly_stream = len(_drop_owner(res[i * 2], owner))
        hourly_dl = len(_drop_owner(res[i * 2 + 1], owner))
        score = hourly_stream * 0.4 + hourly_dl * 0.6
        if score > 0:
            stats = {"listeners_24h": 0, "listeners_1h": hourly_stream, "downloads": hourly_dl}
            scored.append((tid, score, stats))
    scored.sort(key=_rank_key)
    logger.info("[ChartCalc] hot100 candidates=%d scored=%d", len(track_ids), len(scored))
    return scored


async def _calc_period(redis, mongo, period: str, period_key: str) -> list[tuple]:
    """Daily/Weekly/Monthly chart: stream_unique * 0.4 + download_unique * 0.6 (본인 제외, 달력 기간)."""
    index_key = f"chart:tracks:{period}:{period_key}"
    dl_index_key = f"chart:dl_tracks:{period}:{period_key}"
    stream_ids = await redis.smembers(index_key)
    dl_ids = await redis.smembers(dl_index_key)
    track_ids = set(stream_ids or ()) | set(dl_ids or ())

    if not track_ids:
        logger.info("[ChartCalc] %s no candidates key=%s", period, period_key)
        return []

    meta = await _track_meta(mongo, track_ids)
    tid_list = sorted(t for t in track_ids if _eligible(meta, t))
    if not tid_list:
        return []

    pipe = redis.pipeline()
    for tid in tid_list:
        pipe.smembers(f"chart:listeners:{period}:{period_key}:{tid}")
        pipe.smembers(f"chart:downloads:{period}:{period_key}:{tid}")
    res = await pipe.execute()

    scored = []
    for i, tid in enumerate(tid_list):
        owner = meta[tid]["owner"]
        stream_cnt = len(_drop_owner(res[i * 2], owner))
        dl_cnt = len(_drop_owner(res[i * 2 + 1], owner))
        score = stream_cnt * 0.4 + dl_cnt * 0.6
        if score <= 0:
            continue
        stats = {"listeners_24h": stream_cnt, "listeners_1h": 0, "downloads": dl_cnt}
        scored.append((tid, score, stats))
    scored.sort(key=_rank_key)
    logger.info("[ChartCalc] %s candidates=%d scored=%d", period, len(track_ids), len(scored))
    return scored


async def _fallback_play_count(limit: int) -> list[tuple]:
    """Fallback: use MongoDB play_count when no chart data is available (동점은 _id 순 — 결정적)."""
    mongo = get_mongo()
    cursor = mongo.tracks.find({"is_public": True}).sort([("play_count", -1), ("_id", 1)]).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return [(str(t["_id"]), float(t.get("play_count", 0) or 0), {"listeners_24h": 0, "listeners_1h": 0, "downloads": 0}) for t in tracks]
