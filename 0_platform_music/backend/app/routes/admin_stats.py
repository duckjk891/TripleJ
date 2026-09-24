"""어드민 대시보드 접속·가입 지표 (KST 일자 기준).

접속자 = 그날 인증된 API 요청을 한 번이라도 보낸 로그인 사용자 수.
auth.get_current_user(_optional) 가 Redis SET `stats:dau:YYYYMMDD` 에 user_id 를 기록한다.
비회원(토큰 없음) 접속은 식별자가 없어 포함되지 않는다.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import DAU_KEY_PREFIX, get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
MAX_DAYS = 90


@router.get("/active-users")
async def active_users(
    days: int = 14,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})

    redis = get_redis()
    today = datetime.now(KST).date()
    dates = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    keys = [f"{DAU_KEY_PREFIX}{d.strftime('%Y%m%d')}" for d in dates]

    pipe = redis.pipeline()
    for k in keys:
        pipe.scard(k)
    counts = await pipe.execute()

    week_keys = keys[-7:]
    week_active = len(await redis.sunion(*week_keys)) if week_keys else 0

    since_utc = datetime.combine(dates[0], datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
    rows = await conn.fetch(
        """SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS d, COUNT(*) AS n
           FROM users WHERE created_at >= $1 GROUP BY d""",
        since_utc,
    )
    signups = {r["d"]: int(r["n"]) for r in rows}
    total_users = await conn.fetchval("SELECT COUNT(*) FROM users")

    daily = [
        {"date": d.isoformat(), "active": int(c or 0), "signups": signups.get(d, 0)}
        for d, c in zip(dates, counts)
    ]
    return {
        "today": daily[-1],
        "yesterday": daily[-2] if len(daily) > 1 else None,
        "week_active": week_active,
        "total_users": total_users,
        "daily": daily,
        "note": "로그인 사용자 기준 (비회원 미포함), KST 일자",
    }


def _since_utc_naive(days: int) -> datetime:
    """KST 기준 days 일 전 자정 → Mongo 비교용 naive UTC."""
    start = datetime.combine(datetime.now(KST).date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=KST)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# 기능별 사용량 — 서버에 이미 남는 기능 로그 기준 (앱 수정 없이 집계)
# (key, 라벨, 컬렉션, 시각 필드, 사용자 필드, 추가 조건)
# ---------------------------------------------------------------------------
FEATURES = [
    ("play", "음악 재생", "play_logs", "played_at", "user_id", None),
    ("generate", "곡 생성", "generations", "created_at", "user_id", None),
    ("upload", "곡 등록", "tracks", "created_at", "uploader_id", None),
    ("lyrics", "가사 작성", "lyrics_assets", "created_at", "user_id", None),
    ("inst", "반주 생성", "inst_jobs", "created_at", "user_id", None),
    ("voice_clone", "내 목소리", "voice_clones", "created_at", "user_id", None),
    ("character", "캐릭터 생성", "character_jobs", "created_at", "user_id", None),
    ("cover", "커버 촬영", "cover_sessions", "created_at", "user_id", None),
    ("mv", "뮤직비디오", "mv_jobs", "created_at", "user_id", None),
    ("outfit_view", "착장 선택", "ad_impressions", "timestamp", "user_id", None),
    ("outfit_click", "착장 상품 클릭", "ad_clicks", "timestamp", "user_id", None),
    ("wish", "위시 담기", "ad_wish_events", "timestamp", "actor_user_id", None),
    ("search", "검색", "search_logs", "created_at", None, None),
    ("download", "다운로드", "download_logs", "downloaded_at", "user_id", None),
    ("feed", "피드 작성", "feeds", "created_at", "author_id", None),
    ("dm", "DM 전송", "dm_messages", "created_at", "sender_id", None),
    ("attendance", "출석체크", "point_events", "created_at", "user_id", {"action": "attendance"}),
]


@router.get("/features")
async def feature_usage(days: int = 7, current_admin=Depends(get_admin_user)):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})
    mongo = get_mongo()
    since = _since_utc_naive(days)
    result = []
    for key, label, coll, tfield, ufield, extra in FEATURES:
        match = {tfield: {"$gte": since}}
        if extra:
            match.update(extra)
        group = {"_id": None, "count": {"$sum": 1}}
        if ufield:
            group["users"] = {"$addToSet": f"${ufield}"}
        try:
            agg = await mongo[coll].aggregate([{"$match": match}, {"$group": group}]).to_list(length=1)
        except Exception:
            logger.warning("[admin-stats] feature agg failed coll=%s", coll, exc_info=True)
            agg = []
        row = agg[0] if agg else {}
        users = [u for u in row.get("users", []) if u] if ufield else None
        result.append({
            "key": key,
            "label": label,
            "count": int(row.get("count", 0)),
            "users": len(users) if users is not None else None,
        })
    result.sort(key=lambda r: -r["count"])
    return {"days": days, "features": result}


# ---------------------------------------------------------------------------
# 가입 코호트 리텐션 — 가입일 기준 D1/D7 재방문 (접속자 SET 기준)
# ---------------------------------------------------------------------------
def _is_test_email(email: str) -> bool:
    e = (email or "").lower()
    domain = e.split("@")[-1]
    return "test" in domain or domain.endswith((".invalid", ".local")) or domain == "example.com"


@router.get("/retention")
async def retention(days: int = 30, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    if days < 2 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 2~{MAX_DAYS}일이어야 합니다."})
    today = datetime.now(KST).date()
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), tzinfo=KST)
    rows = await conn.fetch(
        """SELECT id::text AS id, email, (created_at AT TIME ZONE 'Asia/Seoul')::date AS d
           FROM users WHERE created_at >= $1""",
        since.astimezone(timezone.utc),
    )
    cohorts: dict = {}
    excluded = 0
    for r in rows:
        if _is_test_email(r["email"]):
            excluded += 1
            continue
        cohorts.setdefault(r["d"], []).append(r["id"])

    redis = get_redis()
    offsets = (1, 7)
    out = []
    tot = {o: [0, 0] for o in offsets}  # offset -> [eligible, returned]
    for d in sorted(cohorts):
        ids = cohorts[d]
        row = {"date": d.isoformat(), "signups": len(ids)}
        for o in offsets:
            target = d + timedelta(days=o)
            if target > today:
                row[f"d{o}"] = None
                continue
            flags = await redis.smismember(f"{DAU_KEY_PREFIX}{target.strftime('%Y%m%d')}", ids)
            back = sum(1 for f in flags if f)
            row[f"d{o}"] = back
            tot[o][0] += len(ids)
            tot[o][1] += back
        out.append(row)

    summary = {
        f"d{o}_rate": round(tot[o][1] / tot[o][0] * 100, 1) if tot[o][0] else None for o in offsets
    }
    summary.update({f"d{o}_base": tot[o][0] for o in offsets})
    return {"days": days, "summary": summary, "cohorts": out, "excluded_test_accounts": excluded}


# ---------------------------------------------------------------------------
# 화면 분석 — 앱 수집(analytics_events) 기준: 화면별 조회·체류, 세션, 이탈률
# ---------------------------------------------------------------------------
BOUNCE_MAX_MS = 10_000


@router.get("/screens")
async def screen_analytics(days: int = 7, current_admin=Depends(get_admin_user)):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})
    coll = get_mongo().analytics_events
    since = _since_utc_naive(days)
    base = {"type": "screen", "started_at": {"$gte": since}}

    screens = await coll.aggregate([
        {"$match": base},
        {"$group": {
            "_id": "$screen",
            "views": {"$sum": 1},
            "total_ms": {"$sum": "$duration_ms"},
            "devices": {"$addToSet": "$device_id"},
        }},
    ]).to_list(length=500)

    sessions = await coll.aggregate([
        {"$match": base},
        {"$sort": {"started_at": 1}},
        {"$group": {
            "_id": "$session_id",
            "screens": {"$sum": 1},
            "total_ms": {"$sum": "$duration_ms"},
            "last_screen": {"$last": "$screen"},
            "device": {"$first": "$device_id"},
            "user": {"$max": "$user_id"},
        }},
    ]).to_list(length=None)

    exits: dict = {}
    for s in sessions:
        exits[s["last_screen"]] = exits.get(s["last_screen"], 0) + 1

    screen_rows = []
    for s in screens:
        views = int(s["views"])
        screen_rows.append({
            "screen": s["_id"],
            "views": views,
            "visitors": len(s["devices"]),
            "total_min": round(s["total_ms"] / 60000, 1),
            "avg_sec": round(s["total_ms"] / views / 1000, 1) if views else 0,
            "exits": exits.get(s["_id"], 0),
            "exit_rate": round(exits.get(s["_id"], 0) / views * 100, 1) if views else 0,
        })
    screen_rows.sort(key=lambda r: -r["total_min"])

    n = len(sessions)
    bounces = sum(1 for s in sessions if s["screens"] <= 1 or s["total_ms"] < BOUNCE_MAX_MS)
    return {
        "days": days,
        "summary": {
            "sessions": n,
            "devices": len({s["device"] for s in sessions}),
            "logged_in_sessions": sum(1 for s in sessions if s.get("user")),
            "avg_session_sec": round(sum(s["total_ms"] for s in sessions) / n / 1000, 1) if n else 0,
            "avg_screens": round(sum(s["screens"] for s in sessions) / n, 1) if n else 0,
            "bounce_rate": round(bounces / n * 100, 1) if n else None,
        },
        "screens": screen_rows,
        "definitions": {
            "bounce": "화면 1개만 보거나 10초 안에 끝난 세션의 비율",
            "exit_rate": "그 화면을 본 횟수 중 세션이 거기서 끝난 비율",
            "session": "앱을 열어 백그라운드로 30분 이상 나가기 전까지",
        },
    }
