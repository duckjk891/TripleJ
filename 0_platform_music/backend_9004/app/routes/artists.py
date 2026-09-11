"""
v2.0: Artists concept replaced by uploaders (users who upload tracks).
These endpoints provide backward compatibility by aggregating data from
MongoDB tracks and PostgreSQL users.
"""

import logging
import math
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..config import settings
from ..database.minio import get_minio
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo
from ..services.media_urls import browser_image_url

router = APIRouter(prefix="/api/artists")
logger = logging.getLogger(__name__)


def _presign_cover(object_name):
    # v173: 브라우저 노출 커버 URL — 중앙 헬퍼(media_urls.browser_image_url) 위임.
    return browser_image_url(object_name)


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    # 프론트(SongItem 등) 호환 별칭
    doc["artist_id"] = doc.get("uploader_id")
    # v238 — tracks/charts 직렬화와 동일: 곡 기록 아티스트명 우선, 없으면 기획사명 폴백
    doc["agency_name"] = doc.get("uploader_nickname") or "AI"
    doc["artist_name"] = doc.get("artist_name") or doc.get("uploader_nickname") or "AI"
    doc["cover_image"] = doc.get("cover_image_url")
    return doc


@router.get("/")
async def list_artists(page: int = 1, limit: int = 20, conn=Depends(get_pg)):
    """List users who have uploaded tracks (creators)."""
    mongo = get_mongo()
    offset = (page - 1) * limit

    # Aggregate distinct uploaders from MongoDB
    pipeline = [
        {"$group": {
            "_id": "$uploader_id",
            "nickname": {"$first": "$uploader_nickname"},
            "track_count": {"$sum": 1},
            "total_plays": {"$sum": "$play_count"},
        }},
        {"$sort": {"total_plays": -1}},
        {"$skip": offset},
        {"$limit": limit},
    ]
    results = await mongo.tracks.aggregate(pipeline).to_list(length=limit)
    total_pipeline = [{"$group": {"_id": "$uploader_id"}}, {"$count": "total"}]
    total_result = await mongo.tracks.aggregate(total_pipeline).to_list(length=1)
    total = total_result[0]["total"] if total_result else 0

    artists = []
    for r in results:
        # Fetch profile info from PostgreSQL
        user_row = None
        try:
            user_row = await conn.fetchrow(
                "SELECT id, nickname, profile_image, bio FROM users WHERE id = $1",
                uuid.UUID(r["_id"]),
            )
        except (ValueError, Exception):
            pass

        artists.append({
            "id": r["_id"],
            "name": user_row["nickname"] if user_row else r["nickname"],
            "image": user_row["profile_image"] if user_row else None,
            "bio": user_row["bio"] if user_row else None,
            "track_count": r["track_count"],
            "total_plays": r["total_plays"],
        })

    return {
        "artists": artists,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{artist_id}")
async def get_artist(artist_id: str, conn=Depends(get_pg)):
    """Get creator profile by user ID."""
    mongo = get_mongo()

    # Aggregate stats from MongoDB
    pipeline = [
        {"$match": {"uploader_id": artist_id}},
        {"$group": {
            "_id": "$uploader_id",
            "nickname": {"$first": "$uploader_nickname"},
            "track_count": {"$sum": 1},
            "total_plays": {"$sum": "$play_count"},
            "total_likes": {"$sum": "$like_count"},
        }},
    ]
    results = await mongo.tracks.aggregate(pipeline).to_list(length=1)

    # Fetch profile from PostgreSQL
    user_row = None
    try:
        user_row = await conn.fetchrow(
            "SELECT id, nickname, profile_image, bio, created_at FROM users WHERE id = $1",
            uuid.UUID(artist_id),
        )
    except (ValueError, Exception):
        pass

    if not results and not user_row:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    stats = results[0] if results else {}
    return {
        "id": artist_id,
        "name": user_row["nickname"] if user_row else stats.get("nickname", ""),
        "image": user_row["profile_image"] if user_row else None,
        "bio": user_row["bio"] if user_row else None,
        "track_count": stats.get("track_count", 0),
        "total_plays": stats.get("total_plays", 0),
        "total_likes": stats.get("total_likes", 0),
        "created_at": user_row["created_at"].isoformat() if user_row and user_row["created_at"] else None,
    }


@router.get("/{artist_id}/tracks")
async def get_artist_tracks(artist_id: str, limit: int = 20, character_id: str = Query(None)):
    """Get tracks by a specific creator.

    v238 — character_id 쿼리 필터(선택): 채널 아티스트 탭에서 "그 아티스트로 만든 곡"만 조회.
    """
    mongo = get_mongo()
    q: dict = {"uploader_id": artist_id, "is_public": True}
    if character_id:
        q["character_id"] = character_id.strip()[:64]
    cursor = mongo.tracks.find(q).sort("play_count", -1).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return [_serialize_track(t) for t in tracks]


@router.get("/{artist_id}/characters")
async def get_artist_characters(artist_id: str, limit: int = Query(20, ge=1, le=50)):
    """v237 — 기획사 채널 '아티스트' 탭: 해당 유저의 아티스트(캐릭터) 공개 목록.

    v238(대표): 시트 이미지 대신 발매 실적 중심 —
      · track_count / album_count: 이 아티스트(character_id)로 발매한 공개 곡·소속 앨범 수
      · latest_cover_image: 최신 발매곡 커버(대표 이미지) — 없으면 null
    공개 범위 최소화 유지: 이름·kind·실적·최신 커버만 (시트/착장/보이스 비공개).
    """
    mongo = get_mongo()
    logger.info("[artists] characters list artist=%s", artist_id[:8])
    cursor = (
        mongo.characters.find(
            {"user_id": artist_id},
            {"character_id": 1, "name": 1, "kind": 1, "created_at": 1},
        )
        .sort("created_at", 1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)

    # 공개 곡 1회 조회 → 파이썬에서 character_id별 그룹(곡 수·최신 커버·트랙 id 집합)
    pub_tracks = await mongo.tracks.find(
        {"uploader_id": artist_id, "is_public": True, "character_id": {"$ne": None}},
        {"character_id": 1, "cover_image_url": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(length=500)
    by_char: dict = {}
    for t in pub_tracks:
        cid = t.get("character_id")
        g = by_char.setdefault(cid, {"count": 0, "latest_cover": None, "track_ids": set()})
        g["count"] += 1
        g["track_ids"].add(str(t["_id"]))
        if g["latest_cover"] is None and t.get("cover_image_url"):
            g["latest_cover"] = t["cover_image_url"]  # created_at DESC — 첫 값이 최신
    # 공개 앨범 1회 조회 → 트랙 소속 기준 아티스트별 distinct 앨범 수
    pub_albums = await mongo.albums.find(
        {"owner_id": artist_id, "is_public": True}, {"track_ids": 1},
    ).to_list(length=200)
    album_count: dict = {cid: 0 for cid in by_char}
    for a in pub_albums:
        tids = set(a.get("track_ids") or [])
        for cid, g in by_char.items():
            if tids & g["track_ids"]:
                album_count[cid] = album_count.get(cid, 0) + 1

    out = []
    for d in docs:
        # 이름 없는 레거시/작업중 문서는 공개 목록에서 제외
        if not (d.get("name") or "").strip():
            continue
        cid = d.get("character_id")
        g = by_char.get(cid) or {}
        out.append({
            "character_id": cid,
            "name": d.get("name") or "",
            "kind": d.get("kind") or "real",
            "track_count": g.get("count", 0),
            "album_count": album_count.get(cid, 0),
            "latest_cover_image": g.get("latest_cover"),
        })
    logger.info("[artists] characters list artist=%s n=%d tracks=%d", artist_id[:8], len(out), len(pub_tracks))
    return {"characters": out}


@router.get("/{artist_id}/albums")
async def get_artist_albums(artist_id: str, limit: int = Query(20, ge=1, le=100)):
    """Public albums owned by a specific creator (newest first)."""
    mongo = get_mongo()
    cursor = (
        mongo.albums.find({"owner_id": artist_id, "is_public": True})
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    out = []
    for d in docs:
        created = d.get("created_at")
        updated = d.get("updated_at")
        created_iso = created.isoformat() if isinstance(created, datetime) else None
        updated_iso = updated.isoformat() if isinstance(updated, datetime) else None
        out.append({
            "id": str(d["_id"]),
            "owner_id": d.get("owner_id"),
            "artist_id": d.get("owner_id"),
            "artist_name": d.get("owner_nickname") or "AI",
            "title": d.get("title") or "",
            "description": d.get("description"),
            "cover_image": _presign_cover(d.get("cover_image_url")),
            "cover_source": d.get("cover_source") or "auto",
            "is_public": bool(d.get("is_public", True)),
            "release_date": created_iso,
            "track_count": len(d.get("track_ids") or []),
            "tracks": None,
            "created_at": created_iso,
            "updated_at": updated_iso,
        })
    return out
