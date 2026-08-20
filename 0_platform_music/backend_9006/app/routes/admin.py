import json
import logging
import math
import mimetypes
import uuid
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_admin_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..database.minio import get_minio
from ..services import dm_service

router = APIRouter(prefix="/api/admin")

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class RoleUpdate(BaseModel):
    role: str


class BanUpdate(BaseModel):
    is_banned: bool
    reason: Optional[str] = None


class VisibilityUpdate(BaseModel):
    is_public: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


async def _log_admin_action(
    conn,
    admin_id: str,
    action: str,
    target_type: str,
    target_id: str,
    details: Optional[dict] = None,
):
    await conn.execute(
        """INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
           VALUES ($1, $2, $3, $4, $5)""",
        uuid.UUID(admin_id),
        action,
        target_type,
        target_id,
        json.dumps(details) if details else None,
    )


# ---------------------------------------------------------------------------
# 1. GET /dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def dashboard(current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    mongo = get_mongo()

    # PG counts
    total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_signups = await conn.fetchval(
        "SELECT COUNT(*) FROM users WHERE created_at >= $1", today_start
    )

    # Mongo counts
    total_tracks = await mongo.tracks.count_documents({})

    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$play_count"}}}]
    agg = await mongo.tracks.aggregate(pipeline).to_list(length=1)
    total_plays = agg[0]["total"] if agg else 0

    # Recent tracks (last 5)
    cursor = mongo.tracks.find().sort("created_at", -1).limit(5)
    recent_tracks_raw = await cursor.to_list(length=5)
    recent_tracks = [_serialize_track(t) for t in recent_tracks_raw]

    # Recent users (last 5)
    rows = await conn.fetch(
        "SELECT id, email, nickname, role, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT 5"
    )
    recent_users = [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "nickname": r["nickname"],
            "role": r["role"] or "user",
            "is_banned": r["is_banned"] or False,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    return {
        "total_users": total_users,
        "total_tracks": total_tracks,
        "total_plays": total_plays,
        "today_signups": today_signups,
        "recent_tracks": recent_tracks,
        "recent_users": recent_users,
    }


# ---------------------------------------------------------------------------
# 2. GET /users
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    banned: Optional[bool] = Query(None),
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    conditions = []
    params = []
    idx = 1

    if search:
        conditions.append(f"(email ILIKE ${idx} OR nickname ILIKE ${idx})")
        params.append(f"%{search}%")
        idx += 1

    if role:
        conditions.append(f"role = ${idx}")
        params.append(role)
        idx += 1

    if banned is not None:
        conditions.append(f"is_banned = ${idx}")
        params.append(banned)
        idx += 1

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    total = await conn.fetchval(f"SELECT COUNT(*) FROM users{where}", *params)

    offset = (page - 1) * limit
    # SanctionSquad(v145) — violation_count·restricted_until 노출 (제재 상태 가시화).
    # 위반 수는 스칼라 서브쿼리로 N+1 회피.
    rows = await conn.fetch(
        f"SELECT id, email, nickname, profile_image, role, is_banned, ban_reason, "
        f"restricted_until, created_at, "
        f"(SELECT COUNT(*) FROM user_violations v WHERE v.user_id = users.id) AS violation_count "
        f"FROM users{where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}",
        *params, limit, offset,
    )

    users = [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "nickname": r["nickname"],
            "profile_image": r["profile_image"],
            "role": r["role"] or "user",
            "is_banned": r["is_banned"] or False,
            "ban_reason": r["ban_reason"],
            "restricted_until": r["restricted_until"].isoformat() if r["restricted_until"] else None,
            "violation_count": int(r["violation_count"] or 0),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    return {
        "users": users,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------------------
# 3. GET /users/{user_id}
# ---------------------------------------------------------------------------

@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    row = await conn.fetchrow(
        "SELECT id, email, nickname, profile_image, bio, plan, role, is_banned, banned_at, ban_reason, "
        "restricted_until, created_at "
        "FROM users WHERE id = $1",
        uid,
    )
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    # SanctionSquad(v145) — 위반 수 (헤더 배너·/me strikes 와 동일 정의)
    violation_count = await conn.fetchval(
        "SELECT COUNT(*) FROM user_violations WHERE user_id = $1", uid
    )

    mongo = get_mongo()
    pipeline = [
        {"$match": {"uploader_id": user_id}},
        {"$group": {"_id": None, "track_count": {"$sum": 1}, "total_plays": {"$sum": "$play_count"}}},
    ]
    agg = await mongo.tracks.aggregate(pipeline).to_list(length=1)
    track_count = agg[0]["track_count"] if agg else 0
    total_plays = agg[0]["total_plays"] if agg else 0

    return {
        "id": str(row["id"]),
        "email": row["email"],
        "nickname": row["nickname"],
        "profile_image": row["profile_image"],
        "bio": row["bio"],
        "plan": row["plan"],
        "role": row["role"] or "user",
        "is_banned": row["is_banned"] or False,
        "banned_at": row["banned_at"].isoformat() if row["banned_at"] else None,
        "ban_reason": row["ban_reason"],
        "restricted_until": row["restricted_until"].isoformat() if row["restricted_until"] else None,
        "violation_count": int(violation_count or 0),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "track_count": track_count,
        "total_plays": total_plays,
    }


# ---------------------------------------------------------------------------
# 4. PUT /users/{user_id}/role
# ---------------------------------------------------------------------------

@router.put("/users/{user_id}/role")
async def change_user_role(
    user_id: str,
    body: RoleUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if body.role not in ("user", "customer", "admin"):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 역할입니다. (user, customer, admin)"})

    if user_id == current_admin["id"]:
        return JSONResponse(status_code=400, content={"error": "자신의 역할은 변경할 수 없습니다."})

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    result = await conn.execute(
        "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2",
        body.role, uid,
    )
    if result == "UPDATE 0":
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    await _log_admin_action(conn, current_admin["id"], "change_role", "user", user_id, {"role": body.role})

    return {"message": "역할이 변경되었습니다.", "user_id": user_id, "role": body.role}


# ---------------------------------------------------------------------------
# 5. PUT /users/{user_id}/ban
# ---------------------------------------------------------------------------

@router.put("/users/{user_id}/ban")
async def ban_user(
    user_id: str,
    body: BanUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if user_id == current_admin["id"]:
        return JSONResponse(status_code=400, content={"error": "자신을 정지할 수 없습니다."})

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    if body.is_banned:
        result = await conn.execute(
            "UPDATE users SET is_banned = TRUE, banned_at = NOW(), ban_reason = $1, updated_at = NOW() WHERE id = $2",
            body.reason, uid,
        )
    else:
        result = await conn.execute(
            "UPDATE users SET is_banned = FALSE, banned_at = NULL, ban_reason = NULL, updated_at = NOW() WHERE id = $1",
            uid,
        )

    if result == "UPDATE 0":
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    # Delete Redis session on ban
    if body.is_banned:
        redis = get_redis()
        await redis.delete(f"session:{user_id}")

    action = "ban_user" if body.is_banned else "unban_user"
    await _log_admin_action(conn, current_admin["id"], action, "user", user_id, {"reason": body.reason})

    msg = "사용자가 정지되었습니다." if body.is_banned else "사용자 정지가 해제되었습니다."
    return {"message": msg, "user_id": user_id, "is_banned": body.is_banned}


# ---------------------------------------------------------------------------
# 5-2. POST /users/{user_id}/restriction/lift  (SanctionSquad v145)
#      2회 누적 생성 제한(restricted_until)만 즉시 해제 — 위반 이력은 감사용 보존.
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/restriction/lift")
async def lift_user_restriction(
    user_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    row = await conn.fetchrow("SELECT restricted_until FROM users WHERE id = $1", uid)
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    had_restriction = row["restricted_until"] is not None
    await conn.execute(
        "UPDATE users SET restricted_until = NULL, updated_at = NOW() WHERE id = $1", uid
    )
    logger.info(
        "[admin.sanction] restriction lifted admin=%s user=%s had_restriction=%s",
        str(current_admin["id"])[:8], user_id[:8], had_restriction,
    )
    await _log_admin_action(
        conn, current_admin["id"], "lift_restriction", "user", user_id,
        {"had_restriction": had_restriction},
    )
    return {"message": "생성 제한이 해제되었습니다.", "user_id": user_id, "restricted_until": None}


# ---------------------------------------------------------------------------
# 5-3. POST /users/{user_id}/strikes/reset  (SanctionSquad v145)
#      위반 기록 전체 삭제 + 생성 제한 해제 + 자동밴만 해제(수동 밴은 유지).
#      "1회라도 받은 경고까지 없앨 수 있게" — 배너/스트라이크 0 으로 초기화.
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/strikes/reset")
async def reset_user_strikes(
    user_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자 ID입니다."})

    row = await conn.fetchrow(
        "SELECT is_banned, ban_reason FROM users WHERE id = $1", uid
    )
    if not row:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    from ..services.strike_service import BAN_REASON_AUTO
    # 자동밴만 함께 해제 (수동 밴은 admin 이 별도 판단하도록 보존)
    auto_banned = bool(row["is_banned"]) and row["ban_reason"] == BAN_REASON_AUTO

    deleted = await conn.execute(
        "DELETE FROM user_violations WHERE user_id = $1", uid
    )
    if auto_banned:
        await conn.execute(
            "UPDATE users SET restricted_until = NULL, is_banned = FALSE, "
            "banned_at = NULL, ban_reason = NULL, updated_at = NOW() WHERE id = $1",
            uid,
        )
    else:
        await conn.execute(
            "UPDATE users SET restricted_until = NULL, updated_at = NOW() WHERE id = $1", uid
        )

    logger.info(
        "[admin.sanction] strikes reset admin=%s user=%s deleted=%s auto_ban_lifted=%s",
        str(current_admin["id"])[:8], user_id[:8], deleted, auto_banned,
    )
    await _log_admin_action(
        conn, current_admin["id"], "reset_strikes", "user", user_id,
        {"deleted": deleted, "auto_ban_lifted": auto_banned},
    )
    return {
        "message": "위반 기록이 초기화되었습니다.",
        "user_id": user_id,
        "violation_count": 0,
        "restricted_until": None,
        "is_banned": (bool(row["is_banned"]) and not auto_banned),
    }


# ---------------------------------------------------------------------------
# 6. GET /tracks
# ---------------------------------------------------------------------------

@router.get("/tracks")
async def list_tracks(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = Query(None),
    is_public: Optional[bool] = Query(None),
    current_admin=Depends(get_admin_user),
):
    mongo = get_mongo()
    query = {}

    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"uploader_nickname": {"$regex": search, "$options": "i"}},
        ]

    if is_public is not None:
        query["is_public"] = is_public

    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)

    return {
        "tracks": [_serialize_track(t) for t in tracks],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------------------
# 7. DELETE /tracks/{track_id}
# ---------------------------------------------------------------------------

@router.delete("/tracks/{track_id}")
async def delete_track(
    track_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # Remove from MinIO
    audio_url = doc.get("audio_url")
    if audio_url:
        try:
            minio_client = get_minio()
            minio_client.remove_object(settings.minio_bucket_music, audio_url)
        except Exception:
            pass  # Continue even if MinIO removal fails

    # Remove from MongoDB
    await mongo.tracks.delete_one({"_id": ObjectId(track_id)})

    # Clear cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    # 2026-08-20: 상세 조회 캐시가 v3 키로 승격됐는데(tracks.py:1160/1275) 여기서
    # 지우지 않아 삭제된 트랙이 최대 600초 계속 조회되던 버그 수정.
    await redis.delete(f"cache:track:v3:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # v171 — 검색 인덱스 동기화 (best-effort): 관리자 삭제도 사용자 삭제와 동일하게
    # ES 문서 + pgvector 임베딩을 제거해 유령 검색 결과를 남기지 않는다.
    # 어느 쪽이 실패해도 삭제 응답은 불변.
    es_synced = emb_synced = False
    try:
        from ..services.search_service import es_delete_track
        es_synced = await es_delete_track(track_id)
    except Exception as e:
        logger.warning("[admin] track delete es sync failed track=%s: %s", track_id, e)
    try:
        await conn.execute("DELETE FROM track_embeddings WHERE track_id = $1", track_id)
        emb_synced = True
    except Exception as e:
        logger.warning("[admin] track delete embedding sync failed track=%s: %s", track_id, e)
    logger.info("[admin] track delete sync es=%s emb=%s track=%s", es_synced, emb_synced, track_id)

    await _log_admin_action(
        conn, current_admin["id"], "delete_track", "track", track_id,
        {"title": doc.get("title"), "uploader_id": doc.get("uploader_id")},
    )

    return {"message": "트랙이 삭제되었습니다.", "track_id": track_id}


# ---------------------------------------------------------------------------
# 8. PUT /tracks/{track_id}/visibility
# ---------------------------------------------------------------------------

@router.put("/tracks/{track_id}/visibility")
async def toggle_visibility(
    track_id: str,
    body: VisibilityUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    result = await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": {"is_public": body.is_public, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # Clear cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    # 2026-08-20: v3 키 누락 시 비공개 전환이 최대 600초 미반영되던 버그 수정.
    await redis.delete(f"cache:track:v3:{track_id}")

    await _log_admin_action(
        conn, current_admin["id"], "change_visibility", "track", track_id,
        {"is_public": body.is_public},
    )

    msg = "트랙이 공개되었습니다." if body.is_public else "트랙이 비공개되었습니다."
    return {"message": msg, "track_id": track_id, "is_public": body.is_public}


# ---------------------------------------------------------------------------
# TrustSquad(v137) — 신고 큐 / 신고 처리
# 로그 prefix [admin-report] — id 는 앞 8자만, 텍스트 원문 로그 금지(길이만).
# ---------------------------------------------------------------------------

REPORT_STATUSES = ("pending", "actioned", "dismissed")
# v138 — confirm_delete(확정 삭제: 트랙·피드 완전 파기, 자진 삭제 건은 판정만),
#        restore(블라인드 해제 — prev_state 복원) 추가.
REPORT_ACTIONS = ("blind", "delete", "dismiss", "confirm_delete", "restore")
_FEED_EXCERPT_LEN = 100
_URGENT_REASON = "sexual"  # v138 — 성적 사유는 긴급(urgent) 최상단 정렬


def _short(value) -> str:
    return str(value)[:8] if value else "?"


def _parse_jsonb(value):
    """asyncpg JSONB 는 코덱 미설정 시 str — dict/list 로 정규화 (실패 None)."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return value


class ReportActionBody(BaseModel):
    action: str


def _feed_text_excerpt(doc: dict) -> str:
    """피드 blocks 중 첫 text 블록의 앞 100자."""
    for b in doc.get("blocks") or []:
        if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
            return str(b["text"])[:_FEED_EXCERPT_LEN]
    return ""


async def _hydrate_report_targets(mongo, reports: list) -> None:
    """신고 목록에 대상 스냅샷(target) 일괄 첨부 — 타입별 1쿼리 $in.

    트랙: title·cover_image_url·uploader_nickname / 피드: kind·텍스트 첫 100자·
    author_nickname / 댓글: text·author_nickname. 삭제된 대상은 {"deleted": True}.
    """
    ids_by_type = {"track": set(), "feed": set(), "comment": set()}
    for r in reports:
        if r["target_type"] in ids_by_type and ObjectId.is_valid(r["target_id"]):
            ids_by_type[r["target_type"]].add(r["target_id"])

    snap = {}  # (type, id) -> snapshot dict

    if ids_by_type["track"]:
        oids = [ObjectId(t) for t in ids_by_type["track"]]
        docs = await mongo.tracks.find(
            {"_id": {"$in": oids}},
            {"title": 1, "cover_image_url": 1, "uploader_nickname": 1,
             "uploader_id": 1, "is_public": 1, "report_blinded": 1},
        ).to_list(length=len(oids))
        for d in docs:
            snap[("track", str(d["_id"]))] = {
                "title": d.get("title"),
                "cover_image_url": d.get("cover_image_url"),
                "uploader_nickname": d.get("uploader_nickname"),
                "uploader_id": d.get("uploader_id"),
                "is_public": bool(d.get("is_public", False)),
                "report_blinded": bool(d.get("report_blinded", False)),
            }

    if ids_by_type["feed"]:
        oids = [ObjectId(t) for t in ids_by_type["feed"]]
        docs = await mongo.feeds.find(
            {"_id": {"$in": oids}},
            {"kind": 1, "blocks": 1, "author_nickname": 1, "author_id": 1,
             "is_public": 1, "report_blinded": 1},
        ).to_list(length=len(oids))
        for d in docs:
            snap[("feed", str(d["_id"]))] = {
                "kind": d.get("kind") or "feed",
                "text_excerpt": _feed_text_excerpt(d),
                "author_nickname": d.get("author_nickname"),
                "author_id": d.get("author_id"),
                "is_public": bool(d.get("is_public", False)),
                "report_blinded": bool(d.get("report_blinded", False)),
            }

    if ids_by_type["comment"]:
        oids = [ObjectId(t) for t in ids_by_type["comment"]]
        docs = await mongo.feed_comments.find(
            {"_id": {"$in": oids}},
            {"text": 1, "author_nickname": 1, "author_id": 1, "feed_id": 1},
        ).to_list(length=len(oids))
        for d in docs:
            snap[("comment", str(d["_id"]))] = {
                "text": d.get("text"),
                "author_nickname": d.get("author_nickname"),
                "author_id": d.get("author_id"),
                "feed_id": d.get("feed_id"),
            }

    for r in reports:
        live = snap.get((r["target_type"], r["target_id"]))
        if live:
            r["target"] = live
            continue
        # v139fix — live 문서 없음(확정삭제 등) → 접수 시점 증거 스냅샷(target_summary)으로
        # 대상 칸 유지. 삭제 여부는 상태 필드로 확인 가능하므로 대상명은 보존한다.
        ev = r.get("evidence") if isinstance(r.get("evidence"), dict) else None
        ts = ev.get("target_summary") if ev else None
        r["target"] = {**ts, "from_snapshot": True} if ts else {"deleted": True}


@router.get("/reports")
async def list_reports(
    status: Optional[str] = Query("pending"),
    page: int = 1,
    limit: int = 20,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """신고 큐 — status 필터(pending|actioned|dismissed|all) + 대상 스냅샷 하이드레이션."""
    page = max(1, page)
    limit = max(1, min(limit, 100))
    if status in (None, "", "all"):
        status = None
    elif status not in REPORT_STATUSES:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 상태 필터입니다."})

    conditions = ""
    params = []
    if status:
        conditions = " WHERE r.status = $1"
        params.append(status)

    total = await conn.fetchval(f"SELECT COUNT(*) FROM reports r{conditions}", *params)
    idx = len(params) + 1
    # v138 — 성적(sexual) 사유 긴급 최상단 정렬, evidence/resolution 동봉
    rows = await conn.fetch(
        f"""SELECT r.id, r.reporter_id, ru.nickname AS reporter_nickname,
                   r.target_type, r.target_id, r.reason_code, r.reason_text,
                   r.status, r.action, r.resolution, r.evidence,
                   r.created_at, r.handled_at, r.handled_by,
                   hu.nickname AS handled_by_nickname
            FROM reports r
            LEFT JOIN users ru ON ru.id = r.reporter_id
            LEFT JOIN users hu ON hu.id = r.handled_by
            {conditions}
            ORDER BY (r.reason_code = '{_URGENT_REASON}') DESC, r.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}""",
        *params, limit, (page - 1) * limit,
    )

    reports = [
        {
            "id": str(r["id"]),
            "reporter_id": str(r["reporter_id"]),
            "reporter_nickname": r["reporter_nickname"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "reason_code": r["reason_code"],
            "reason_text": r["reason_text"],
            "urgent": r["reason_code"] == _URGENT_REASON,
            "status": r["status"],
            "action": r["action"],
            "resolution": r["resolution"],
            "evidence": _parse_jsonb(r["evidence"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "handled_at": r["handled_at"].isoformat() if r["handled_at"] else None,
            "handled_by": str(r["handled_by"]) if r["handled_by"] else None,
            "handled_by_nickname": r["handled_by_nickname"],
        }
        for r in rows
    ]

    # v139 — 소유자 소명 첨부 (있으면 {text, created_at}, 없으면 None)
    if reports:
        appeal_rows = await conn.fetch(
            "SELECT report_id, text, created_at FROM report_appeals "
            "WHERE report_id = ANY($1::uuid[])",
            [r["id"] for r in rows],
        )
        appeals = {
            str(a["report_id"]): {
                "text": a["text"],
                "created_at": a["created_at"].isoformat() if a["created_at"] else None,
            }
            for a in appeal_rows
        }
        for rep in reports:
            rep["appeal"] = appeals.get(rep["id"])

    mongo = get_mongo()
    await _hydrate_report_targets(mongo, reports)
    logger.info(
        "[admin-report] list admin=%s status=%s page=%d returned=%d total=%d",
        _short(current_admin["id"]), status or "all", page, len(reports), total,
    )

    return {
        "reports": reports,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/reports/{report_id}/action")
async def handle_report(
    report_id: str,
    body: ReportActionBody,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """신고 처리 — track/feed blind(+prev_state 저장), comment delete, dismiss,
    v138: confirm_delete(트랙·피드 완전 파기 — 자진 삭제 건은 판정만), restore.

    - blind: 재공개 잠금 + ES 반영, 원래 is_public 을 prev_state 에 저장(복원용).
    - confirm_delete: 대상 생존 시 파기 함수 재사용 완전 파기(resolution=deleted),
      이미 자진 삭제 시 resolution=removed_by_user 로 절차 종결. 둘 다
      user_violations 기록 + 증거의 original_photo sha256 블랙리스트 등록.
    - restore: blind 로 처리 완료된 신고 대상의 prev_state 복원 + report_blinded
      해제 + ES 재색인/차트 캐시 무효화 → status=dismissed, resolution=restored.
    - 대상 자진 삭제된 신고는 confirm_delete·dismiss 로 판정 가능.
    트랙·피드 delete 는 계속 미지원(400 — confirm_delete 사용).
    이미 처리된 신고 재처리 409. 처리 시 _log_admin_action 감사 로그.
    """
    admin_id = current_admin["id"]
    action = (body.action or "").strip()
    logger.info(
        "[admin-report] action enter report=%s admin=%s action=%s",
        _short(report_id), _short(admin_id), action,
    )

    if action not in REPORT_ACTIONS:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 액션입니다. (blind, delete, dismiss, confirm_delete, restore)"},
        )
    try:
        rid = uuid.UUID(report_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    report = await conn.fetchrow(
        """SELECT id, reporter_id, target_type, target_id, reason_code, status,
                  action, evidence, prev_state
           FROM reports WHERE id = $1""",
        rid,
    )
    if not report:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    # 상태 가드 — restore 는 blind 처리 완료 신고에만, 그 외는 pending 에만.
    if action == "restore":
        if not (report["status"] == "actioned" and report["action"] == "blind"):
            logger.info(
                "[admin-report] restore not_blinded report=%s status=%s action=%s",
                _short(report_id), report["status"], report["action"],
            )
            return JSONResponse(status_code=409, content={"error": "복원할 블라인드 처리가 없습니다."})
    elif report["status"] != "pending":
        logger.info(
            "[admin-report] action already_handled report=%s status=%s",
            _short(report_id), report["status"],
        )
        return JSONResponse(status_code=409, content={"error": "이미 처리된 신고입니다."})

    target_type = report["target_type"]
    target_id = report["target_id"]
    mongo = get_mongo()

    # 타입별 액션 화이트리스트 — 트랙·피드 delete 미지원(confirm_delete 사용),
    # 댓글 blind/confirm_delete/restore 미지원(공개 플래그 없음 — 삭제로 처리).
    if target_type == "comment" and action in ("blind", "confirm_delete", "restore"):
        return JSONResponse(status_code=400, content={"error": "댓글은 블라인드·확정 삭제·복원 대상이 아닙니다. 삭제로 처리해주세요."})
    if action == "delete" and target_type in ("track", "feed"):
        return JSONResponse(
            status_code=400,
            content={"error": "트랙·피드 삭제는 확정 삭제(confirm_delete)로 처리해주세요."},
        )

    async def _invalidate_track_caches(track_oid_str: str):
        """트랙 캐시(v1/v2/v3) + 차트 캐시 무효화 (blind/restore 공용)."""
        redis = get_redis()
        await redis.delete(f"cache:track:{track_oid_str}")
        await redis.delete(f"cache:track:v2:{track_oid_str}")
        # 2026-08-20: 상세 조회가 v3 키를 읽는데(tracks.py:1160) v2 까지만 지워
        # 신고 블라인드된 트랙이 최대 600초 계속 노출되던 버그 수정.
        await redis.delete(f"cache:track:v3:{track_oid_str}")
        # v137 BUG-3 — 차트 캐시(TTL 300s)도 즉시 무효화
        try:
            chart_keys = [k async for k in redis.scan_iter(match="cache:chart:*")]
            if chart_keys:
                await redis.delete(*chart_keys)
            logger.info("[admin-report] chart cache invalidated keys=%d", len(chart_keys))
        except Exception:
            logger.warning("[admin-report] chart cache invalidate failed report=%s", _short(report_id))

    async def _es_reindex_track(track_oid):
        try:
            from ..services.search_service import es_index_track
            updated = await mongo.tracks.find_one({"_id": track_oid})
            es_ok = await es_index_track(updated)
            logger.info(
                "[admin-report] track es_reindex report=%s track=%s ok=%s",
                _short(report_id), _short(target_id), es_ok,
            )
        except Exception as e:
            logger.error(
                "[admin-report] track es_reindex failed report=%s track=%s err=%s",
                _short(report_id), _short(target_id), e,
            )

    # ── 콘텐츠 조치 ─────────────────────────────────────────────────────────
    detail: dict = {"report_id": report_id, "reason_code": report["reason_code"]}
    new_prev_state: Optional[dict] = None  # blind 시 저장
    resolution: Optional[str] = None       # confirm_delete/restore 시 저장

    if action in ("blind", "delete", "restore"):
        if not ObjectId.is_valid(target_id):
            return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다."})
        oid = ObjectId(target_id)

        if action == "blind" and target_type == "track":
            current_doc = await mongo.tracks.find_one({"_id": oid}, {"is_public": 1})
            if not current_doc:
                return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다. (이미 삭제됨 — 확정 삭제/기각으로 처리해주세요)"})
            # v138 — 복원용 원 상태 저장
            new_prev_state = {"is_public": bool(current_doc.get("is_public", False))}
            await mongo.tracks.update_one(
                {"_id": oid},
                {"$set": {"is_public": False, "report_blinded": True,
                          "updated_at": datetime.now(timezone.utc)}},
            )
            # 캐시 무효화 + ES 반영 (is_public=false 재색인 → 검색 필터에서 제외)
            await _invalidate_track_caches(target_id)
            await _es_reindex_track(oid)

        elif action == "blind" and target_type == "feed":
            current_doc = await mongo.feeds.find_one({"_id": oid}, {"is_public": 1})
            if not current_doc:
                return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다. (이미 삭제됨 — 확정 삭제/기각으로 처리해주세요)"})
            new_prev_state = {"is_public": bool(current_doc.get("is_public", False))}
            await mongo.feeds.update_one(
                {"_id": oid},
                {"$set": {"is_public": False, "report_blinded": True,
                          "updated_at": datetime.utcnow()}},
            )

        elif action == "delete" and target_type == "comment":
            comment = await mongo.feed_comments.find_one({"_id": oid})
            if not comment:
                return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다. (이미 삭제됨 — 기각 처리해주세요)"})
            await mongo.feed_comments.delete_one({"_id": oid})
            feed_id = comment.get("feed_id")
            if feed_id and ObjectId.is_valid(feed_id):
                # 음수 방지 가드 (feeds.py 관행 동일)
                await mongo.feeds.update_one(
                    {"_id": ObjectId(feed_id), "comment_count": {"$gt": 0}},
                    {"$inc": {"comment_count": -1}},
                )
            detail["feed_id"] = feed_id

        elif action == "restore":
            # v138 — prev_state 복원 + report_blinded 해제 (트랙·피드)
            coll = mongo.tracks if target_type == "track" else mongo.feeds
            current_doc = await coll.find_one({"_id": oid}, {"report_blinded": 1})
            if not current_doc:
                return JSONResponse(status_code=404, content={"error": "복원할 대상이 이미 삭제되었습니다."})
            prev = _parse_jsonb(report["prev_state"]) or {}
            restored_public = bool(prev.get("is_public", True))
            await coll.update_one(
                {"_id": oid},
                {"$set": {"is_public": restored_public, "report_blinded": False,
                          "updated_at": datetime.now(timezone.utc)}},
            )
            if target_type == "track":
                await _invalidate_track_caches(target_id)
                await _es_reindex_track(oid)
            resolution = "restored"
            detail["restored_is_public"] = restored_public
            logger.info(
                "[admin-report] restore ok report=%s type=%s target=%s is_public=%s",
                _short(report_id), target_type, _short(target_id), restored_public,
            )

    elif action == "confirm_delete":
        # v138 — 확정 삭제: 대상 생존 시 완전 파기, 자진 삭제 시 판정만.
        evidence = _parse_jsonb(report["evidence"]) or {}
        offender_id = None
        target_doc = None
        if ObjectId.is_valid(target_id):
            coll = mongo.tracks if target_type == "track" else mongo.feeds
            target_doc = await coll.find_one({"_id": ObjectId(target_id)})

        if target_doc is not None:
            if target_type == "track":
                from .tracks import purge_track_document
                purge = await purge_track_document(target_doc, conn)
            else:
                from .feeds import purge_feed_document
                purge = await purge_feed_document(mongo, conn, target_doc)
            offender_id = purge.get("owner_id")
            resolution = "deleted"
            detail["purged"] = purge.get("removed") or True
        else:
            # 가해자 자진 삭제 — 스냅샷 근거로 절차 계속("게시자 삭제로 종결")
            offender_id = evidence.get("owner_id")
            resolution = "removed_by_user"

        detail["resolution"] = resolution

        # 위반 기록 + 스트라이크 자동 제재 (v139 — strike_service 로 일원화)
        if offender_id:
            try:
                from ..services.strike_service import apply_strike

                strike = await apply_strike(conn, offender_id, rid, report["reason_code"])
                detail["violation_user_id"] = str(offender_id)
                detail["strike"] = {"count": strike["count"], "tier": strike["tier"]}
            except Exception as e:
                logger.error(
                    "[admin-report] violation record failed report=%s err=%s",
                    _short(report_id), e,
                )
        else:
            logger.warning(
                "[admin-report] confirm_delete no_owner report=%s (증거 스냅샷 없음 — 위반 기록 생략)",
                _short(report_id),
            )

        # 도용 원본 사진 해시 블랙리스트 (원본 사진이 증거에 있을 때만 — 확정 후 발동)
        blacklisted = 0
        for item in evidence.get("items") or []:
            if item.get("kind") == "original_photo" and item.get("sha256"):
                try:
                    await conn.execute(
                        """INSERT INTO face_source_blacklist (sha256, report_id)
                           VALUES ($1, $2) ON CONFLICT (sha256) DO NOTHING""",
                        item["sha256"], rid,
                    )
                    blacklisted += 1
                except Exception as e:
                    logger.error(
                        "[admin-report] blacklist insert failed report=%s err=%s",
                        _short(report_id), e,
                    )
        detail["blacklisted"] = blacklisted
        logger.info(
            "[admin-report] confirm_delete report=%s type=%s target=%s resolution=%s "
            "violation=%s blacklisted=%d",
            _short(report_id), target_type, _short(target_id), resolution,
            _short(offender_id), blacklisted,
        )

    # ── reports 갱신 (상태 가드 — 동시 처리 경쟁 시 409) ─────────────────────
    if action == "restore":
        result = await conn.execute(
            """UPDATE reports SET status = 'dismissed', action = NULL,
                   resolution = $1, handled_at = NOW(), handled_by = $2
               WHERE id = $3 AND status = 'actioned' AND action = 'blind'""",
            resolution, uuid.UUID(admin_id), rid,
        )
        new_status, new_action = "dismissed", None
    else:
        new_status = "dismissed" if action == "dismiss" else "actioned"
        new_action = None if action == "dismiss" else action
        result = await conn.execute(
            """UPDATE reports SET status = $1, action = $2,
                   resolution = COALESCE($3, resolution),
                   prev_state = COALESCE($4::jsonb, prev_state),
                   handled_at = NOW(), handled_by = $5
               WHERE id = $6 AND status = 'pending'""",
            new_status, new_action, resolution,
            json.dumps(new_prev_state) if new_prev_state is not None else None,
            uuid.UUID(admin_id), rid,
        )
    if result == "UPDATE 0":
        return JSONResponse(status_code=409, content={"error": "이미 처리된 신고입니다."})

    await _log_admin_action(
        conn, admin_id, f"report_{action}", target_type, target_id, detail
    )
    logger.info(
        "[admin-report] action ok report=%s admin=%s action=%s type=%s target=%s resolution=%s",
        _short(report_id), _short(admin_id), action, target_type, _short(target_id), resolution,
    )

    if action == "confirm_delete" and resolution == "removed_by_user":
        msg = "게시자 삭제로 종결되었습니다. (위반 기록 존속)"
    else:
        msg = {
            "blind": "콘텐츠가 블라인드 처리되었습니다.",
            "delete": "콘텐츠가 삭제되었습니다.",
            "dismiss": "신고가 기각되었습니다.",
            "confirm_delete": "콘텐츠가 확정 삭제되었습니다.",
            "restore": "블라인드가 해제되고 원 상태로 복원되었습니다.",
        }[action]
    return {
        "message": msg,
        "report_id": report_id,
        "status": new_status,
        "action": new_action,
        "resolution": resolution,
    }


# ---------------------------------------------------------------------------
# TrustSquad(v138) — 양면 뷰(recent-content) / 증거 서빙 / 어드민 이미지 프록시
# ---------------------------------------------------------------------------

def _media_type_for(object_name: str) -> str:
    if object_name.endswith(".json"):
        return "application/json"
    return mimetypes.guess_type(object_name)[0] or "image/png"


@router.get("/users/{user_id}/recent-content")
async def get_user_recent_content(
    user_id: str,
    current_admin=Depends(get_admin_user),
):
    """양면 뷰 우측 — 대상 사용자의 최근 트랙 20건 + 현재 캐릭터 상태.

    캐릭터 시트·원본 사진은 존재 여부 + 어드민 프록시 경로(/api/admin/media/...)로
    반환 (공개 프록시 경유 없이 어드민 인증 하에서만 열람).
    """
    mongo = get_mongo()

    cursor = mongo.tracks.find(
        {"uploader_id": user_id},
        {"title": 1, "cover_image_url": 1, "created_at": 1,
         "is_public": 1, "report_blinded": 1},
    ).sort("created_at", -1).limit(20)
    docs = await cursor.to_list(length=20)
    tracks = [
        {
            "id": str(d["_id"]),
            "title": d.get("title"),
            "cover_image_url": d.get("cover_image_url"),
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
            "is_public": bool(d.get("is_public", False)),
            "report_blinded": bool(d.get("report_blinded", False)),
        }
        for d in docs
    ]

    char = await mongo.characters.find_one(
        {"user_id": user_id},
        {"original_photo_object_name": 1, "sheet_object_name": 1,
         "virtual_sheet_object_name": 1, "name": 1},
    )

    def _admin_path(object_name):
        return f"/api/admin/media/{object_name}" if object_name else None

    character = None
    if char:
        original_photo = char.get("original_photo_object_name") or None
        sheet = char.get("sheet_object_name") or None
        virtual_sheet = char.get("virtual_sheet_object_name") or None
        character = {
            "name": char.get("name"),
            "has_original_photo": bool(original_photo),
            "has_sheet": bool(sheet),
            "has_virtual_sheet": bool(virtual_sheet),
            "original_photo_path": _admin_path(original_photo),
            "sheet_path": _admin_path(sheet),
            "virtual_sheet_path": _admin_path(virtual_sheet),
        }

    logger.info(
        "[admin-report] recent_content admin=%s user=%s tracks=%d character=%s",
        _short(current_admin["id"]), _short(user_id), len(tracks), bool(character),
    )
    return {"user_id": user_id, "tracks": tracks, "character": character}


@router.get("/reports/{report_id}/evidence/{idx}")
async def get_report_evidence_file(
    report_id: str,
    idx: int,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """어드민 전용 증거 파일 서빙 — evidence.items[idx] (이미지/JSON).

    evidence/ 는 공개 프록시·presign 전부 차단되어 있으므로 이 문이 유일한 출구.
    """
    try:
        rid = uuid.UUID(report_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    row = await conn.fetchrow("SELECT evidence FROM reports WHERE id = $1", rid)
    if not row:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    evidence = _parse_jsonb(row["evidence"]) or {}
    items = evidence.get("items") or []
    if idx < 0 or idx >= len(items):
        return JSONResponse(status_code=404, content={"error": "증거 항목을 찾을 수 없습니다."})

    object_name = items[idx].get("object_name") or ""
    if not object_name.startswith("evidence/"):
        # 스냅샷 스키마 위반 방어 — evidence/ 밖 객체는 이 문으로 내보내지 않는다.
        return JSONResponse(status_code=404, content={"error": "증거 항목을 찾을 수 없습니다."})

    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images, object_name=object_name
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception:
        return JSONResponse(status_code=404, content={"error": "증거 파일을 찾을 수 없습니다."})

    logger.info(
        "[admin-report] evidence serve admin=%s report=%s idx=%d kind=%s",
        _short(current_admin["id"]), _short(report_id), idx, items[idx].get("kind"),
    )
    return Response(content=data, media_type=_media_type_for(object_name))


@router.get("/media/{object_name:path}")
async def admin_media_proxy(
    object_name: str,
    current_admin=Depends(get_admin_user),
):
    """어드민 전용 images 버킷 프록시 — recent-content 의 캐릭터 시트·원본 열람용.

    faces/(암호화 얼굴 데이터)는 어드민에게도 원문 노출 금지. 경로 탈출 차단.
    """
    if not object_name or ".." in object_name or object_name.startswith("faces/"):
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images, object_name=object_name
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception:
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})
    return Response(content=data, media_type=_media_type_for(object_name))


# ---------------------------------------------------------------------------
# 9. GET /logs
# ---------------------------------------------------------------------------

@router.get("/logs")
async def list_admin_logs(
    page: int = 1,
    limit: int = 20,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    page = max(page, 1)
    limit = max(1, min(limit, 100))
    logger.info(
        "[admin] logs page=%d limit=%d action=%s target_type=%s",
        page, limit, action, target_type,
    )

    # 동적 WHERE — exact match, 파라미터 바인딩만 사용(SQL 인젝션 금지)
    conditions = []
    params: list = []
    if action:
        params.append(action)
        conditions.append(f"al.action = ${len(params)}")
    if target_type:
        params.append(target_type)
        conditions.append(f"al.target_type = ${len(params)}")
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM admin_logs al {where_sql}", *params
    )
    offset = (page - 1) * limit

    rows = await conn.fetch(
        f"""SELECT al.id, al.admin_id, u.nickname AS admin_nickname, al.action,
                  al.target_type, al.target_id, al.details, al.created_at
           FROM admin_logs al
           JOIN users u ON u.id = al.admin_id
           {where_sql}
           ORDER BY al.created_at DESC
           LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}""",
        *params, limit, offset,
    )

    logs = [
        {
            "id": str(r["id"]),
            "admin_id": str(r["admin_id"]),
            "admin_nickname": r["admin_nickname"],
            "action": r["action"],
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "details": json.loads(r["details"]) if r["details"] else None,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    # v177: user 타입 대상 닉네임#태그 하이드레이션 (additive — 기존 필드·정렬·
    # 페이지네이션 불변). target_id 는 VARCHAR 혼재(track ObjectId·audience 등) —
    # hydrate_users 가 비 uuid 를 안전 skip. 실패/미해석 행은 null.
    user_target_ids = [l["target_id"] for l in logs if l["target_type"] == "user"]
    hydrated = {}
    if user_target_ids:
        try:
            hydrated = await dm_service.hydrate_users(conn, user_target_ids)
        except Exception:
            logger.warning("[admin] logs target hydrate failed", exc_info=True)
    for l in logs:
        info = hydrated.get(l["target_id"]) if l["target_type"] == "user" else None
        l["target_nickname"] = info["nickname"] if info else None
        l["target_code"] = info["code"] if info else None

    return {
        "logs": logs,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }
