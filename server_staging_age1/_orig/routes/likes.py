import logging
import math
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/likes")


# v196 ① — 좋아요 트랙 하이드레이션에 필요한 필드만 조회.
# report_blinded 는 가드 판정 전용이며 응답에는 포함하지 않는다.
_TRACK_PROJECTION = {
    "title": 1,
    "uploader_id": 1,
    "uploader_nickname": 1,
    "artist_name": 1,  # v3.229 N3 — 가수명(아티스트) 우선 표기
    "character_id": 1,  # v3.229 N4 — 앱 재생 큐 개명 즉시 반영(playerStore character_id 매칭)
    "cover_image_url": 1,
    "duration_sec": 1,
    "is_public": 1,
    "report_blinded": 1,
}


def _short(value) -> str:
    """로그 추적자 — id 앞 8자."""
    return str(value)[:8] if value else "?"


def _is_hidden_track(t: dict) -> bool:
    """v196 ① — tracks.py:49 `_is_hidden_track` 규약 준수.

    명시적 비공개(is_public=False) 또는 신고 블라인드만 숨김으로 판정한다.
    is_public 키가 없는 레거시 도큐먼트는 공개로 취급(회귀 방지)."""
    return (t.get("is_public") is False) or bool(t.get("report_blinded"))


def _serialize_track(doc: dict) -> dict:
    """v196 ① — 화이트리스트 직렬화.

    audio_url·lyrics·prompt·generation_id 등 내부 필드 전량 유출을 차단한다.
    별칭(artist_id/artist_name/cover_image)과 원본 키를 함께 내보내
    프론트 폴백 경로(SongItem)를 무손상 유지한다."""
    if doc is None:
        return None
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title"),
        "artist_id": doc.get("uploader_id"),
        # v3.229 N3 — v236 규칙 통일: 곡의 가수명(아티스트) 우선, 없으면 기획사명(닉네임) 폴백
        "artist_name": doc.get("artist_name") or doc.get("uploader_nickname") or "AI",
        "character_id": str(doc["character_id"]) if doc.get("character_id") else None,  # v3.229 N4 (없으면 null)
        "cover_image": doc.get("cover_image_url"),
        "uploader_id": doc.get("uploader_id"),
        "uploader_nickname": doc.get("uploader_nickname"),
        "cover_image_url": doc.get("cover_image_url"),
        "duration_sec": doc.get("duration_sec"),
        "is_public": doc.get("is_public", False),
    }


@router.get("/check")
async def check_likes(song_ids: str = Query(""), current_user=Depends(get_current_user), conn=Depends(get_pg)):
    # Parse track IDs (support both old integer IDs and new ObjectId strings)
    ids = [s.strip() for s in song_ids.split(",") if s.strip()]
    if not ids:
        return {"liked_ids": []}

    user_id = uuid.UUID(current_user["id"])
    rows = await conn.fetch(
        "SELECT track_id FROM likes WHERE user_id = $1 AND track_id = ANY($2::varchar[])",
        user_id, ids,
    )

    return {"liked_ids": [r["track_id"] for r in rows]}


@router.get("/")
async def list_likes(page: int = 1, limit: int = 20, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    offset = (page - 1) * limit

    rows = await conn.fetch(
        "SELECT track_id, created_at FROM likes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        user_id, limit, offset,
    )

    total_row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM likes WHERE user_id = $1", user_id)
    total = total_row["cnt"]

    # Cross-query MongoDB for track details
    track_ids = [ObjectId(r["track_id"]) for r in rows if ObjectId.is_valid(r["track_id"])]
    likes_list = []
    hidden_skipped = 0
    viewer_id = str(current_user["id"])

    if track_ids:
        mongo = get_mongo()
        docs = await mongo.tracks.find(
            {"_id": {"$in": track_ids}}, _TRACK_PROJECTION
        ).to_list(length=len(track_ids))
        docs_map = {str(d["_id"]): d for d in docs}

        for r in rows:
            doc = docs_map.get(r["track_id"])
            if not doc:
                continue
            # v196 ① — 타인의 비공개·블라인드 곡은 목록에서 제외(마스킹 아님).
            # 본인 곡은 비공개여도 본인 좋아요 목록에서 계속 보인다.
            if _is_hidden_track(doc) and doc.get("uploader_id") != viewer_id:
                hidden_skipped += 1
                continue
            t = _serialize_track(doc)
            t["liked_at"] = r["created_at"].isoformat() if r["created_at"] else None
            likes_list.append(t)

    logger.info(
        "[likes] list user=%s returned=%d hidden_skipped=%d",
        _short(viewer_id), len(likes_list), hidden_skipped,
    )

    return {
        "likes": likes_list,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/received")
async def list_received_likes(
    page: int = 1, limit: int = 30,
    current_user=Depends(get_current_user), conn=Depends(get_pg),
):
    """v3.269 [피드백2-33] — 내 곡들이 받은 하트 목록(곡 소유자 시점, 최신순).

    Mongo에서 내 곡 id·제목을 뽑고 PG likes를 users와 조인해 "누가 · 어떤 곡에 · 언제"를
    돌려준다. 응답: {items:[{user:{id,nickname,profile_image}, track_id, track_title, at}], total}
    """
    from ..database.mongodb import get_mongo
    limit = max(1, min(limit, 50))
    offset = (max(1, page) - 1) * limit
    mongo = get_mongo()
    my_tracks = await mongo.tracks.find(
        {"uploader_id": current_user["id"]}, {"title": 1},
    ).to_list(length=1000)
    if not my_tracks:
        return {"items": [], "total": 0}
    title_by_id = {str(t["_id"]): t.get("title") or "" for t in my_tracks}
    ids = list(title_by_id.keys())
    rows = await conn.fetch(
        """
        SELECT l.user_id, l.track_id, l.created_at, u.nickname, u.profile_image
        FROM likes l JOIN users u ON l.user_id = u.id
        WHERE l.track_id = ANY($1::varchar[])
        ORDER BY l.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        ids, limit, offset,
    )
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM likes WHERE track_id = ANY($1::varchar[])", ids,
    )
    logger.info("[likes] received user=%s rows=%d total=%s", _short(current_user["id"]), len(rows), total)
    return {
        "items": [
            {
                "user": {"id": str(r["user_id"]), "nickname": r["nickname"],
                         "profile_image": r["profile_image"]},
                "track_id": r["track_id"],
                "track_title": title_by_id.get(r["track_id"], ""),
                "at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ],
        "total": int(total or 0),
    }


@router.post("/{track_id}", status_code=201)
async def like_track(track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    # Verify track exists in MongoDB
    mongo = get_mongo()
    track = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, _TRACK_PROJECTION)
    if not track:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # v196 ① — 타인의 비공개·블라인드 곡은 좋아요할 수 없다.
    if _is_hidden_track(track) and track.get("uploader_id") != str(current_user["id"]):
        logger.info(
            "[likes] like private_denied user=%s track=%s",
            _short(current_user["id"]), _short(track_id),
        )
        return JSONResponse(status_code=400, content={"error": "다른 사용자의 비공개 곡은 사용할 수 없습니다."})

    user_id = uuid.UUID(current_user["id"])

    # Check if already liked
    existing = await conn.fetchrow(
        "SELECT user_id FROM likes WHERE user_id = $1 AND track_id = $2",
        user_id, track_id,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 좋아요한 트랙입니다."})

    # Insert like in PostgreSQL
    await conn.execute(
        "INSERT INTO likes (user_id, track_id) VALUES ($1, $2)",
        user_id, track_id,
    )

    # Increment like_count in MongoDB
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"like_count": 1}},
    )

    # v3.251 인지도 — 하트 +20 RP (best-effort, 좋아요 응답 불변)
    if track.get("character_id"):
        try:
            from ..services.recognition import RP_LIKE, award_rp
            await award_rp(mongo, str(track["character_id"]), RP_LIKE, "like", actor=str(current_user["id"]), ref=track_id)
        except Exception as e:
            logger.warning("[Recog] like hook failed track=%s: %s", _short(track_id), e)

    # v111: 좋아요 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    logger.info(
        "[likes] like ok user=%s track=%s",
        _short(current_user["id"]), _short(track_id),
    )
    return {"message": "좋아요가 추가되었습니다."}


@router.delete("/{track_id}")
async def unlike_track(track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])

    result = await conn.execute(
        "DELETE FROM likes WHERE user_id = $1 AND track_id = $2",
        user_id, track_id,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "좋아요하지 않은 트랙입니다."})

    # Decrement like_count in MongoDB
    if ObjectId.is_valid(track_id):
        mongo = get_mongo()
        await mongo.tracks.update_one(
            {"_id": ObjectId(track_id), "like_count": {"$gt": 0}},
            {"$inc": {"like_count": -1}},
        )

        # v3.251 인지도 — 하트 취소 -20 RP (RP floor 0 — award_rp 클램프, 강등 허용. best-effort)
        try:
            from ..services.recognition import RP_LIKE, award_rp
            _t = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"character_id": 1})
            if _t and _t.get("character_id"):
                await award_rp(mongo, str(_t["character_id"]), -RP_LIKE, "unlike", actor=str(current_user["id"]), ref=track_id)
        except Exception as e:
            logger.warning("[Recog] unlike hook failed track=%s: %s", _short(track_id), e)

    return {"message": "좋아요가 취소되었습니다."}
