"""앱 화면 사용 분석 수집 — 화면별 체류시간·세션·이탈률 (관리자 대시보드 '사용 분석').

앱(utils/screenAnalytics.ts)이 화면을 떠날 때마다 '화면 방문 1건'을 배치로 보낸다.
비회원도 수집하도록 인증은 선택 — 식별은 앱 설치 단위 device_id(무작위, 개인정보 아님).

요청 { device_id, platform, app_version, events: [
    { type: 'screen', session_id, screen, started_at(ISO), duration_ms, seq },
    { type: 'session_start' | 'session_end', session_id, ts(ISO), duration_ms? } ] }
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

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
EVENT_TYPES = {"screen", "session_start", "session_end"}

_index_ready = False


class AnalyticsEvent(BaseModel):
    type: str
    session_id: str = Field(..., max_length=64)
    screen: Optional[str] = Field(None, max_length=64)
    started_at: Optional[str] = None
    ts: Optional[str] = None
    duration_ms: Optional[int] = None
    seq: Optional[int] = None


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
        docs.append(doc)

    if docs:
        coll = get_mongo().analytics_events
        try:
            await _ensure_indexes(coll)
        except Exception:
            logger.warning("[analytics] index ensure failed", exc_info=True)
        await coll.insert_many(docs, ordered=False)
    return {"received": len(docs)}
