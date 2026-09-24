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
    local, _, domain = e.rpartition("@")
    if domain == "maidol.co.kr" and ("test" in local):  # 사내 QA 계정(test1~4, webtest*) — 계정은 유지, 통계만 제외
        return True
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


# ---------------------------------------------------------------------------
# 가입·유입 — 가입 방식(이메일/구글/카카오), 추천 가입, 가입 플랫폼(웹/iOS/안드로이드)
# 일반 사용자(role=user)만, 테스트 도메인 제외.
# ---------------------------------------------------------------------------
PROVIDER_LABELS = {"local": "이메일", "google": "구글", "kakao": "카카오", "apple": "애플", "naver": "네이버"}


@router.get("/acquisition")
async def acquisition(days: int = 30, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    if days < 1 or days > 365:
        return JSONResponse(status_code=400, content={"error": "기간은 1~365일이어야 합니다."})
    since = datetime.combine(
        datetime.now(KST).date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=KST
    ).astimezone(timezone.utc)

    rows = await conn.fetch(
        """SELECT u.id::text AS id, u.email, COALESCE(u.provider, 'local') AS provider,
                  u.created_at, (u.created_at AT TIME ZONE 'Asia/Seoul')::date AS d,
                  u.referred_by::text AS referred_by, i.nickname AS inviter
           FROM users u LEFT JOIN users i ON i.id = u.referred_by
           WHERE u.role = 'user' AND COALESCE(u.account_status, 'active') <> 'withdrawn'"""
    )
    users = [r for r in rows if not _is_test_email(r["email"])]
    recent = [r for r in users if r["created_at"] >= since]

    def by_provider(rs):
        out: dict = {}
        for r in rs:
            out[r["provider"]] = out.get(r["provider"], 0) + 1
        return [
            {"provider": p, "label": PROVIDER_LABELS.get(p, p), "count": n}
            for p, n in sorted(out.items(), key=lambda x: -x[1])
        ]

    # 최근 7일 접속자의 로그인 방식 (계정 = 로그인 방식 1:1)
    redis = get_redis()
    today = datetime.now(KST).date()
    week_keys = [f"{DAU_KEY_PREFIX}{(today - timedelta(days=i)).strftime('%Y%m%d')}" for i in range(7)]
    week_active = set(await redis.sunion(*week_keys))
    active_users = [r for r in users if r["id"] in week_active]

    # 추천인별
    inviters: dict = {}
    for r in recent:
        if r["referred_by"]:
            k = r["inviter"] or "(삭제된 계정)"
            inviters[k] = inviters.get(k, 0) + 1

    # 가입 플랫폼 — 앱 사용 분석(analytics_events)에 처음 잡힌 플랫폼 기준
    platforms: dict = {}
    recent_ids = [r["id"] for r in recent]
    known = {}
    if recent_ids:
        async for doc in get_mongo().analytics_events.aggregate([
            {"$match": {"user_id": {"$in": recent_ids}}},
            {"$sort": {"received_at": 1}},
            {"$group": {"_id": "$user_id", "platform": {"$first": "$platform"}}},
        ]):
            known[doc["_id"]] = doc["platform"] or "unknown"
    for uid in recent_ids:
        p = known.get(uid, "unknown")
        platforms[p] = platforms.get(p, 0) + 1

    daily: dict = {}
    for r in recent:
        key = r["d"].isoformat()
        row = daily.setdefault(key, {"date": key, "total": 0, "referred": 0})
        row["total"] += 1
        row[r["provider"]] = row.get(r["provider"], 0) + 1
        if r["referred_by"]:
            row["referred"] += 1

    return {
        "days": days,
        "totals": {
            "users": len(users),
            "signups": len(recent),
            "referred": sum(1 for r in recent if r["referred_by"]),
            "active_7d": len(active_users),
        },
        "signup_methods": by_provider(recent),
        "all_methods": by_provider(users),
        "active_methods": by_provider(active_users),
        "inviters": [{"inviter": k, "count": v} for k, v in sorted(inviters.items(), key=lambda x: -x[1])],
        "platforms": [{"platform": k, "count": v} for k, v in sorted(platforms.items(), key=lambda x: -x[1])],
        "daily": sorted(daily.values(), key=lambda x: x["date"], reverse=True),
    }


# ---------------------------------------------------------------------------
# 단계별 이탈(퍼널) · 이동 경로 — analytics_events 세션별 화면 순서 기준
# ---------------------------------------------------------------------------
# 각 단계는 화면 목록(그중 하나를 보면 도달). 세션 안에서 순서대로 도달해야 다음 단계로 인정.
FUNNELS = [
    {"key": "song", "label": "곡 만들기", "steps": [
        ("가사 입력", ["LyricsInput"]),
        ("가사 결과", ["LyricsResult"]),
        ("곡 생성 설정", ["MusicGeneration"]),
        ("곡 생성 중", ["MusicLoading"]),
        ("곡 결과", ["MusicResult"]),
    ]},
    {"key": "artist", "label": "아티스트 만들기", "steps": [
        ("아티스트 입력", ["ArtistInput"]),
        ("코디(착장)", ["ArtistCody"]),
        ("생성 중", ["ArtistLoading"]),
        ("결과", ["ArtistResult"]),
    ]},
    {"key": "create_entry", "label": "창작 시작", "steps": [
        ("차트(첫 화면)", ["Chart"]),
        ("작업실", ["Map", "Studio"]),
        ("대화", ["Dialogue"]),
        ("창작 화면 진입", ["LyricsInput", "ArtistInput", "CoverGeneration", "VideoDirector", "VoiceCloneWizard"]),
    ]},
    {"key": "listen", "label": "음악 듣기", "steps": [
        ("차트(첫 화면)", ["Chart"]),
        ("플레이어(재생)", ["Player"]),
    ]},
]
APP_CLOSED = "__closed__"


async def _session_paths(days: int) -> list:
    coll = get_mongo().analytics_events
    since = _since_utc_naive(days)
    return await coll.aggregate([
        {"$match": {"type": "screen", "started_at": {"$gte": since}}},
        {"$sort": {"started_at": 1, "seq": 1}},
        {"$group": {
            "_id": "$session_id",
            "screens": {"$push": "$screen"},
            "durations": {"$push": "$duration_ms"},
            "started_at": {"$first": "$started_at"},
            "device": {"$first": "$device_id"},
            "platform": {"$first": "$platform"},
            "user": {"$max": "$user_id"},
        }},
        {"$sort": {"started_at": -1}},
    ]).to_list(length=None)


def _dedupe(screens: list) -> list:
    out = []
    for s in screens:
        if not out or out[-1] != s:
            out.append(s)
    return out


@router.get("/funnels")
async def funnels(days: int = 7, current_admin=Depends(get_admin_user)):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})
    sessions = await _session_paths(days)
    result = []
    for f in FUNNELS:
        steps = f["steps"]
        reached = [0] * len(steps)
        devices = [set() for _ in steps]
        leak: list = [dict() for _ in steps]  # 단계 k 에서 멈춘 세션이 다음에 간 곳
        for s in sessions:
            path = _dedupe(s["screens"])
            k, last_pos = 0, -1
            for i, scr in enumerate(path):
                if k < len(steps) and scr in steps[k][1]:
                    reached[k] += 1
                    devices[k].add(s["device"])
                    k += 1
                    last_pos = i
            if 0 < k < len(steps):
                nxt = path[last_pos + 1] if last_pos + 1 < len(path) else APP_CLOSED
                leak[k - 1][nxt] = leak[k - 1].get(nxt, 0) + 1
        rows = []
        for i, (name, screens) in enumerate(steps):
            prev = reached[i - 1] if i else reached[0]
            dropped = reached[i] - (reached[i + 1] if i + 1 < len(steps) else reached[i])
            rows.append({
                "step": name,
                "screens": screens,
                "sessions": reached[i],
                "devices": len(devices[i]),
                "from_prev_rate": round(reached[i] / prev * 100, 1) if (i and prev) else (100.0 if reached[i] else None),
                "from_start_rate": round(reached[i] / reached[0] * 100, 1) if reached[0] else None,
                "dropped": dropped if i + 1 < len(steps) else 0,
                "dropped_to": [
                    {"screen": scr, "count": c}
                    for scr, c in sorted(leak[i].items(), key=lambda x: -x[1])[:4]
                ],
            })
        result.append({"key": f["key"], "label": f["label"], "steps": rows})
    return {"days": days, "sessions": len(sessions), "funnels": result, "closed_key": APP_CLOSED}


@router.get("/paths")
async def paths(days: int = 7, limit: int = 30, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    if days < 1 or days > MAX_DAYS:
        return JSONResponse(status_code=400, content={"error": f"기간은 1~{MAX_DAYS}일이어야 합니다."})
    limit = max(1, min(limit, 100))
    sessions = await _session_paths(days)

    # 자주 일어나는 이동 (A → B), 세션 종료는 '앱 종료'로
    edges: dict = {}
    for s in sessions:
        path = _dedupe(s["screens"]) + [APP_CLOSED]
        for a, b in zip(path, path[1:]):
            edges[(a, b)] = edges.get((a, b), 0) + 1
    top_edges = [
        {"from": a, "to": b, "count": c}
        for (a, b), c in sorted(edges.items(), key=lambda x: -x[1])[:20]
    ]

    recent = sessions[:limit]
    uids = {s["user"] for s in recent if s.get("user")}
    names = {}
    if uids:
        rows = await conn.fetch("SELECT id::text AS id, nickname FROM users WHERE id::text = ANY($1::text[])", list(uids))
        names = {r["id"]: r["nickname"] for r in rows}
    items = []
    for s in recent:
        started = s["started_at"]
        items.append({
            "session_id": s["_id"],
            "started_at": started.replace(tzinfo=timezone.utc).isoformat() if isinstance(started, datetime) else started,
            "platform": s.get("platform"),
            "device": (s.get("device") or "")[-6:],
            "user": names.get(s.get("user")) if s.get("user") else None,
            "duration_sec": round(sum(d or 0 for d in s["durations"]) / 1000),
            "screen_count": len(s["screens"]),
            "path": _dedupe(s["screens"]),
        })
    return {"days": days, "sessions": len(sessions), "top_transitions": top_edges, "recent": items, "closed_key": APP_CLOSED}
