import logging
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo
from ..models.playlist import PlaylistCreate, PlaylistUpdate, AddTrack

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/playlists")


# v196 ① — 재생목록 트랙 하이드레이션에 필요한 필드만 조회.
# report_blinded 는 가드 판정 전용이며 응답에는 포함하지 않는다.
_TRACK_PROJECTION = {
    "title": 1,
    "uploader_id": 1,
    "uploader_nickname": 1,
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
    is_public 키가 없는 레거시 도큐먼트는 공개로 취급(회귀 방지 — 재생목록은
    레거시 곡을 이미 담고 있으므로 `not is_public` 식을 쓰면 안 된다)."""
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
        "artist_name": doc.get("uploader_nickname", "AI"),
        "cover_image": doc.get("cover_image_url"),
        "uploader_id": doc.get("uploader_id"),
        "uploader_nickname": doc.get("uploader_nickname"),
        "cover_image_url": doc.get("cover_image_url"),
        "duration_sec": doc.get("duration_sec"),
        "is_public": doc.get("is_public", False),
    }


@router.get("/")
async def list_playlists(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    rows = await conn.fetch("""
        SELECT p.id, p.user_id, p.title, p.description, p.is_public, p.created_at,
               (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count
        FROM playlists p WHERE p.user_id = $1 ORDER BY p.created_at DESC
    """, user_id)

    return [
        {
            "id": str(r["id"]),
            "user_id": str(r["user_id"]),
            "title": r["title"],
            "description": r["description"],
            "is_public": r["is_public"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "track_count": r["track_count"],
        }
        for r in rows
    ]


@router.post("/", status_code=201)
async def create_playlist(body: PlaylistCreate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    if not body.title:
        return JSONResponse(status_code=400, content={"error": "플레이리스트 제목은 필수입니다."})

    user_id = uuid.UUID(current_user["id"])
    logger.info(
        "[playlists] create user=%s title_len=%d desc_len=%d",
        current_user["id"], len(body.title or ""), len(body.description or ""),
    )
    row = await conn.fetchrow(
        "INSERT INTO playlists (user_id, title, description, is_public) VALUES ($1, $2, $3, $4) RETURNING id, user_id, title, description, is_public, created_at",
        user_id, body.title, body.description, body.is_public,
    )

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "description": row["description"],
        "is_public": row["is_public"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.get("/{playlist_id}")
async def get_playlist(playlist_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1", pl_uuid)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    user_id = uuid.UUID(current_user["id"])
    if not row["is_public"] and row["user_id"] != user_id:
        return JSONResponse(status_code=403, content={"error": "비공개 플레이리스트입니다."})

    # Get track IDs from PostgreSQL
    track_rows = await conn.fetch(
        "SELECT track_id, position FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position",
        pl_uuid,
    )

    # Cross-query MongoDB for track details
    tracks = []
    hidden_skipped = 0
    viewer_id = str(current_user["id"])
    if track_rows:
        track_ids = [ObjectId(r["track_id"]) for r in track_rows if ObjectId.is_valid(r["track_id"])]
        mongo = get_mongo()
        docs = await mongo.tracks.find(
            {"_id": {"$in": track_ids}}, _TRACK_PROJECTION
        ).to_list(length=len(track_ids))
        docs_map = {str(d["_id"]): d for d in docs}

        for r in track_rows:
            doc = docs_map.get(r["track_id"])
            if not doc:
                continue
            # v196 ① — 타인의 비공개·블라인드 곡은 배열에서 제외(마스킹 아님).
            # 본인 곡은 비공개여도 본인 재생목록에서 계속 보인다.
            if _is_hidden_track(doc) and doc.get("uploader_id") != viewer_id:
                hidden_skipped += 1
                continue
            t = _serialize_track(doc)
            t["position"] = r["position"]
            tracks.append(t)

    logger.info(
        "[playlists] detail id=%s user=%s tracks=%d hidden_skipped=%d",
        _short(playlist_id), _short(viewer_id), len(tracks), hidden_skipped,
    )

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "description": row["description"],
        "is_public": row["is_public"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "tracks": tracks,
    }


@router.put("/{playlist_id}")
async def update_playlist(playlist_id: str, body: PlaylistUpdate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    title = body.title if body.title is not None else row["title"]
    is_public = body.is_public if body.is_public is not None else row["is_public"]
    description = body.description if body.description is not None else row["description"]

    logger.info(
        "[playlists] update id=%s user=%s title_len=%d desc_len=%d",
        playlist_id, current_user["id"], len(title or ""), len(description or ""),
    )

    updated = await conn.fetchrow(
        "UPDATE playlists SET title = $1, is_public = $2, description = $3 WHERE id = $4 RETURNING id, user_id, title, description, is_public, created_at",
        title, is_public, description, pl_uuid,
    )

    return {
        "id": str(updated["id"]),
        "user_id": str(updated["user_id"]),
        "title": updated["title"],
        "description": updated["description"],
        "is_public": updated["is_public"],
        "created_at": updated["created_at"].isoformat() if updated["created_at"] else None,
    }


@router.delete("/{playlist_id}")
async def delete_playlist(playlist_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    await conn.execute("DELETE FROM playlists WHERE id = $1", pl_uuid)
    return {"message": "플레이리스트가 삭제되었습니다."}


@router.post("/{playlist_id}/tracks", status_code=201)
async def add_track(playlist_id: str, body: AddTrack, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    # Verify track exists in MongoDB
    if not ObjectId.is_valid(body.track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    track = await mongo.tracks.find_one({"_id": ObjectId(body.track_id)}, _TRACK_PROJECTION)
    if not track:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # v196 ① — 타인의 비공개·블라인드 곡은 재생목록에 담을 수 없다.
    if _is_hidden_track(track) and track.get("uploader_id") != str(current_user["id"]):
        logger.info(
            "[playlists] add_track private_denied user=%s track=%s",
            _short(current_user["id"]), _short(body.track_id),
        )
        return JSONResponse(status_code=400, content={"error": "다른 사용자의 비공개 곡은 사용할 수 없습니다."})

    # Check duplicate
    existing = await conn.fetchrow(
        "SELECT playlist_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, body.track_id,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 추가된 트랙입니다."})

    # Get next position
    max_pos = await conn.fetchval("SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = $1", pl_uuid)
    position = (max_pos or 0) + 1

    await conn.execute(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)",
        pl_uuid, body.track_id, position,
    )

    # v111: 플레이리스트 추가 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    logger.info(
        "[playlists] add_track ok user=%s track=%s position=%d",
        _short(current_user["id"]), _short(body.track_id), position,
    )
    return {"message": "트랙이 추가되었습니다."}


@router.delete("/{playlist_id}/tracks/{track_id}")
async def remove_track(playlist_id: str, track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    result = await conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, track_id,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "플레이리스트에 해당 트랙이 없습니다."})
    return {"message": "트랙이 제거되었습니다."}
