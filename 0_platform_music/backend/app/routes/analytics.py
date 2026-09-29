"""앱 화면 사용 분석 수집 — 화면별 체류시간·세션·이탈률 (관리자 대시보드 '사용 분석').

앱(utils/screenAnalytics.ts)이 화면을 떠날 때마다 '화면 방문 1건'을 배치로 보낸다.
비회원도 수집하도록 인증은 선택 — 식별은 앱 설치 단위 device_id(무작위, 개인정보 아님).

요청 { device_id, platform, app_version, events: [
    { type: 'screen', session_id, screen, started_at(ISO), duration_ms, seq },
    { type: 'session_start' | 'session_end', session_id, ts(ISO), duration_ms? },
    { type: 'share_compose_open' | 'share_sent' | 'share_link_open' | 'share_cta_tap', session_id, ts(ISO), props{…} } ] }

v3.237 곡 공유 측정 — share 이벤트 4종 + `props`(허용 키·형식만 정제 저장, 그 외 키·타입 불일치·값 형식 오류는 버림).
받는 사람 이름·공유 본문 같은 자유 문자열은 저장 경로가 없다(자유 문자열 키 0 — src 도 앱 진입 화면 목록만).
screen·session_* 처리는 v3.236 과 동일(props 무시).
"""
import logging
import re
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user_optional
from ..database.mongodb import get_mongo
from ..database.redis import get_redis

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

logger = logging.getLogger(__name__)

MAX_EVENTS = 100
MAX_SCREEN_MS = 30 * 60 * 1000  # 방치된 화면이 평균을 왜곡하지 않도록 30분 상한
RETENTION_DAYS = 180
RATE_PER_MIN = 30  # device 당 분당 배치 수
SHARE_EVENT_TYPES = {"share_compose_open", "share_sent", "share_link_open", "share_cta_tap"}  # v3.237
EVENT_TYPES = {"screen", "session_start", "session_end"} | SHARE_EVENT_TYPES

# v3.237 share props 허용 목록 — 키별 검증기(통과 = 저장값, None = 버림)
_RE_TRACK_ID = re.compile(r"^[0-9a-f]{24}$")
_RE_SHARE_ID = re.compile(r"^[0-9a-z]{8}$")
_RE_TEMPLATE_ID = re.compile(r"^[a-z0-9_]{1,32}$")
_RE_THEME = re.compile(r"^[a-z0-9_]{1,16}$")
# 공유 진입 화면(앱 TrackActionSheet 가 연 화면의 라우트명, 모르면 'sheet') — 소문자로 비교·저장. 목록 밖 = 버림.
# (앱 App.tsx 에 등록된 라우트명 전부 + sheet — 앱 고정 식별자라 사용자 입력이 들어갈 수 없다)
SHARE_SRC_VALUES = frozenset(x.lower() for x in (
    "sheet", "AgencyProfile", "AlbumCoverGeneration", "AlbumDetail", "ArtistCody", "ArtistDetail", "ArtistInput",
    "ArtistLoading", "ArtistResult", "AudioSpike", "Chart", "ComposeLyricsPick", "ComposerSelect", "CoverGeneration",
    "CoverLibrary", "Dialogue", "DirectorLineup", "DmChat", "DmInbox", "FaceVerify", "Feed", "FeedCompose",
    "FeedDetail", "GenerationHistory", "InstLoading", "LyricsBook", "LyricsInput", "LyricsLoading",
    "LyricsPromptReview", "LyricsResult", "MainTabs", "Map", "MusicGeneration", "MusicLoading", "MusicResult",
    "MyArtists", "MyMusic", "MyReports", "Notifications", "Player", "Playlist", "Search", "Settings", "ShareCompose",
    "Splash", "StarHistory", "Studio", "TrackUpload", "UserChannel", "VideoDirector", "VoiceCloneWizard",
    "VoiceManage", "music", "search", "settings",
))


def _enum(*vals):
    allowed = frozenset(vals)
    return lambda v: v if isinstance(v, str) and v in allowed else None


def _regex(rx):
    return lambda v: v if isinstance(v, str) and rx.match(v) else None


def _bool(v):
    return v if isinstance(v, bool) else None


def _body_len(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 1000 else None


def _src(v):
    if not isinstance(v, str) or len(v) > 24:
        return None
    low = v.lower()
    return low if low in SHARE_SRC_VALUES else None


SHARE_PROP_RULES = {
    "track_id": _regex(_RE_TRACK_ID),
    "share_id": _regex(_RE_SHARE_ID),
    "template_id": _regex(_RE_TEMPLATE_ID),
    "theme": _regex(_RE_THEME),
    "theme_source": _enum("override", "auto", "default", "fallback"),
    "audience": _enum("own", "other"),
    "edited": _bool,
    "recipient_custom": _bool,
    "body_len": _body_len,
    "outcome": _enum("shared", "copied", "manual", "cancelled", "failed"),
    "src": _src,
    "logged_in": _bool,
    "dest": _enum("signup", "studio"),
}


def sanitize_share_props(props) -> dict:
    """허용 키·형식만 남긴다. dict 아님 = {}. 버린 키는 DEBUG 로그에 키 이름만(값 0)."""
    if not isinstance(props, dict):
        if props is not None:
            logger.debug("[analytics] drop props (not an object) type=%s", type(props).__name__)
        return {}
    out = {}
    for k, v in list(props.items())[:64]:
        rule = SHARE_PROP_RULES.get(k) if isinstance(k, str) else None
        val = rule(v) if rule else None
        if val is None:
            logger.debug("[analytics] drop props key=%s", re.sub(r"[^A-Za-z0-9_]", "?", str(k)[:32]))
            continue
        out[k] = val
    return out

_index_ready = False


class AnalyticsEvent(BaseModel):
    type: str
    session_id: str = Field(..., max_length=64)
    screen: Optional[str] = Field(None, max_length=64)
    started_at: Optional[str] = None
    ts: Optional[str] = None
    duration_ms: Optional[int] = None
    seq: Optional[int] = None
    props: Optional[Any] = None  # v3.237 share 이벤트 전용(Any — 형식 오류로 배치 전체가 422 되지 않게 서버가 정제)


class AnalyticsBatch(BaseModel):
    device_id: str = Field(..., min_length=8, max_length=64)
    platform: Optional[str] = Field(None, max_length=16)
    app_version: Optional[str] = Field(None, max_length=32)
    events: List[AnalyticsEvent]


def _parse_ts(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).replace(tzinfo=None)  # Mongo 관행: naive UTC
    except ValueError:
        return None


async def _ensure_indexes(coll) -> None:
    global _index_ready
    if _index_ready:
        return
    await coll.create_index("received_at", expireAfterSeconds=RETENTION_DAYS * 24 * 3600)
    await coll.create_index([("type", 1), ("started_at", 1)])
    await coll.create_index("session_id")
    _index_ready = True


@router.post("/events")
async def ingest_events(
    body: AnalyticsBatch,
    request: Request,
    current_user=Depends(get_current_user_optional),
):
    if not body.events:
        return {"received": 0}
    if len(body.events) > MAX_EVENTS:
        return JSONResponse(status_code=413, content={"error": f"events 는 최대 {MAX_EVENTS}개입니다."})

    redis = get_redis()
    try:
        minute = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
        rk = f"rl:analytics:{body.device_id}:{minute}"
        n = await redis.incr(rk)
        if n == 1:
            await redis.expire(rk, 120)
        if n > RATE_PER_MIN:
            return JSONResponse(status_code=429, content={"error": "too many requests"})
    except Exception:
        pass

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user_id = str(current_user["id"]) if current_user else None
    docs = []
    for ev in body.events:
        if ev.type not in EVENT_TYPES:
            continue
        doc = {
            "type": ev.type,
            "session_id": ev.session_id,
            "device_id": body.device_id,
            "user_id": user_id,
            "platform": body.platform,
            "app_version": body.app_version,
            "received_at": now,
        }
        if ev.type == "screen":
            started = _parse_ts(ev.started_at)
            if not ev.screen or started is None or ev.duration_ms is None or ev.duration_ms < 0:
                continue
            doc.update({
                "screen": ev.screen,
                "started_at": started,
                "duration_ms": min(int(ev.duration_ms), MAX_SCREEN_MS),
                "seq": ev.seq,
            })
        else:
            doc["started_at"] = _parse_ts(ev.ts) or now
            if ev.duration_ms is not None and ev.duration_ms >= 0:
                doc["duration_ms"] = int(ev.duration_ms)
            if ev.type in SHARE_EVENT_TYPES:
                props = sanitize_share_props(ev.props)
                if props:
                    doc["props"] = props
        docs.append(doc)

    if docs:
        coll = get_mongo().analytics_events
        try:
            await _ensure_indexes(coll)
        except Exception:
            logger.warning("[analytics] index ensure failed", exc_info=True)
        await coll.insert_many(docs, ordered=False)
    return {"received": len(docs)}
