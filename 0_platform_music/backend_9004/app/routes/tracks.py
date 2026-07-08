import io
import json
import logging
import math
import mimetypes
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.redis import get_redis
from ..database.minio import get_minio
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/tracks")

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".ogg", ".flac", ".m4a"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB


def _serialize_track(doc: dict) -> dict:
    """Convert MongoDB document to JSON-serializable dict."""
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    # Add aliases for frontend compatibility
    doc["artist_id"] = doc.get("uploader_id")
    doc["artist_name"] = doc.get("uploader_nickname", "AI")
    doc["cover_image"] = doc.get("cover_image_url")
    return doc


async def _find_completed_mv(mongo, generation_id: str) -> Optional[dict]:
    """Find a completed MV job linked to the given generation_id."""
    if not generation_id:
        return None
    mv_job = await mongo.mv_jobs.find_one({
        "audio_generation_id": generation_id,
        "status": "completed",
        "result_music_video_url": {"$exists": True, "$ne": None},
    })
    return mv_job


def _mv_presigned_url(object_name: Optional[str]) -> Optional[str]:
    """Generate a presigned URL for an MV object in the images bucket."""
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        return minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
    except Exception:
        return None


def _serialize_tracks(docs: list) -> list:
    return [_serialize_track(d) for d in docs]


@router.get("/")
async def list_tracks(
    page: int = 1,
    limit: int = 20,
    genre: str = None,
    mood: str = None,
    tag: str = None,
    sort: str = "play_count",
):
    mongo = get_mongo()
    query = {"is_public": True}

    if genre:
        query["genre"] = genre
    if mood:
        query["mood"] = mood
    if tag:
        query["tags"] = tag

    sort_field = sort if sort in ("play_count", "like_count", "created_at") else "play_count"
    sort_dir = -1

    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort(sort_field, sort_dir).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)

    return {
        "tracks": _serialize_tracks(tracks),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# VectorSearch — number of semantic candidates pulled from pgvector before
# the public-filter + pagination is applied. Generous so paging works.
_SEMANTIC_TOP_K = 100

# HybridSearch (B3) — obvious music-search filler phrases stripped from the
# *embedding* query only (the ES side handles fillers via the ko_search analyzer).
# Keeps the semantic vector focused on the mood/topic ("설레일때 듣는 노래" →
# "설레일때") instead of being pulled toward energetic/"노래" neighbours. Order
# matters: longer phrases first so "듣고싶어" is removed before "듣". Conservative —
# if stripping empties the query we fall back to the original text.
_VEC_FILLER_PHRASES = [
    "듣고싶은", "듣고싶어", "들을때", "들을래", "들으면", "들으며",
    "듣는", "들을", "들어", "듣기", "노래", "음악", "곡", "트랙", "사운드",
    "추천곡", "추천", "플레이리스트", "플리", "리스트", "모음", "좋은", "최고",
]


def _strip_vec_fillers(q: str) -> str:
    """Lightweight filler strip for the embedding query (B3).

    Removes obvious music-search plumbing words/phrases so the semantic vector
    centers on the mood/topic. Never raises; returns the original query if the
    result would be empty (meaning the query was *all* filler). The raw query is
    still passed unchanged to ES, whose ko_search analyzer does the real work.
    """
    if not q:
        return q
    stripped = q
    for ph in _VEC_FILLER_PHRASES:
        stripped = stripped.replace(ph, " ")
    stripped = " ".join(stripped.split()).strip()
    if not stripped:
        logger.info("[tracks.search] vec filler strip emptied q_len=%d, using original", len(q))
        return q
    if stripped != q:
        logger.info("[tracks.search] vec filler strip q_len=%d -> q_len=%d", len(q), len(stripped))
    return stripped


async def _regex_search_tracks(mongo, q: str, page: int, limit: int) -> dict:
    """Original MongoDB regex search. Used as the semantic-search fallback."""
    query = {
        "is_public": True,
        "$or": [
            {"title": {"$regex": q, "$options": "i"}},
            {"tags": {"$regex": q, "$options": "i"}},
            {"prompt": {"$regex": q, "$options": "i"}},
            {"uploader_nickname": {"$regex": q, "$options": "i"}},
        ],
    }
    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort("play_count", -1).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return {
        "tracks": _serialize_tracks(tracks),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/search")
async def search_tracks(
    q: str = Query(None),
    page: int = 1,
    limit: int = 20,
    pg=Depends(get_pg),
):
    """Hybrid track search: pgvector (semantic) + Elasticsearch BM25 (nori +
    fuzzy), fused with Reciprocal Rank Fusion (RRF).

    Response shape is unchanged: {tracks, pagination}. Both backends return up to
    _SEMANTIC_TOP_K ranked track_ids; rrf_fuse merges them, matching public
    tracks are fetched from MongoDB, re-ordered to the fused rank, then paginated.

    Graceful degrade:
      - both vector + ES available  -> mode=hybrid
      - only vector available       -> mode=vec
      - only ES available           -> mode=es
      - neither yields results/works -> mode=regex (original MongoDB regex)
    Empty q -> 400 (unchanged).
    """
    if not q:
        return JSONResponse(status_code=400, content={"error": "검색어를 입력해주세요."})

    mongo = get_mongo()
    q_len = len(q)

    from ..services.embedding_service import search_similar
    from ..services.search_service import es_search, rrf_fuse

    # --- pgvector (semantic) candidates, with cosine cutoff ---
    # search_similar returns [(track_id, score)] where score = cosine similarity
    # (0~1, higher = closer). We keep only candidates above settings.search_min_cosine
    # so irrelevant queries (whose nearest neighbours are still far) get dropped.
    floor = settings.search_min_cosine
    vec_ids: list = []
    vec_ok = False
    vec_top1: float = 0.0
    try:
        vec_q = _strip_vec_fillers(q)
        matches = await search_similar(pg, vec_q, _SEMANTIC_TOP_K)
        if matches:
            vec_top1 = matches[0][1]
        vec_ids = [tid for tid, score in matches if score >= floor]
        vec_ok = True
    except Exception as e:
        logger.warning("[tracks.search] vec backend failed q_len=%d: %s", q_len, e)

    # --- Elasticsearch BM25 candidates (best-effort, never raises) ---
    es_ids: list = []
    es_ok = False
    try:
        es_ids = await es_search(q, _SEMANTIC_TOP_K)
        es_ok = True
    except Exception as e:
        logger.warning("[tracks.search] es backend failed q_len=%d: %s", q_len, e)

    # --- determine mode from what produced usable signal ---
    if vec_ids and es_ids:
        mode = "hybrid"
    elif vec_ids:
        mode = "vec"
    elif es_ids:
        mode = "es"
    elif vec_ok:
        # The vector backend ran but every candidate fell below the cosine floor,
        # and ES (lexical) found nothing either -> the query is plainly unrelated
        # to the catalog. Return an explicit empty result; do NOT regex-fall back.
        logger.info(
            "[tracks.search] mode=cutoff floor=%.3f vec_kept=0 es=0 vec_top1=%.4f n=0 total=0 (no match)",
            floor, vec_top1,
        )
        return {
            "tracks": [],
            "pagination": {"page": page, "limit": limit, "total": 0, "totalPages": 0},
        }
    else:
        # Vector backend itself failed AND ES yielded nothing -> we cannot judge
        # relevance, so degrade to the original regex fallback.
        logger.info(
            "[tracks.search] mode=regex q_len=%d reason=no_candidates vec_ok=%s es_ok=%s",
            q_len, vec_ok, es_ok,
        )
        return await _regex_search_tracks(mongo, q, page, limit)

    try:
        fused_ids = rrf_fuse(
            vec_ids,
            es_ids,
            vec_weight=settings.rrf_vec_weight,
            es_weight=settings.rrf_es_weight,
        )
        rank_by_id = {tid: i for i, tid in enumerate(fused_ids)}
        object_ids = [ObjectId(tid) for tid in fused_ids if ObjectId.is_valid(tid)]

        cursor = mongo.tracks.find({"_id": {"$in": object_ids}, "is_public": True})
        docs = await cursor.to_list(length=len(object_ids))

        # Preserve fused RRF order.
        docs.sort(key=lambda d: rank_by_id.get(str(d["_id"]), len(rank_by_id)))

        total = len(docs)
        start = (page - 1) * limit
        page_docs = docs[start:start + limit]

        logger.info(
            "[tracks.search] mode=%s floor=%.3f vec_kept=%d es=%d n=%d total=%d",
            mode, floor, len(vec_ids), len(es_ids), len(page_docs), total,
        )
        return {
            "tracks": _serialize_tracks(page_docs),
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": math.ceil(total / limit) if limit else 0,
            },
        }
    except Exception as e:
        logger.warning("[tracks.search] mode=regex q_len=%d reason=fuse_error: %s", q_len, e)
        return await _regex_search_tracks(mongo, q, page, limit)


class TrackUpdateBody(BaseModel):
    title: Optional[str] = None
    genre: Optional[List[str]] = None
    mood: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    is_public: Optional[bool] = None
    cover_image_url: Optional[str] = None


@router.get("/my")
async def get_my_tracks(
    page: int = 1,
    limit: int = 20,
    sort: str = "created_at",
    current_user=Depends(get_current_user),
):
    """Get current user's uploaded tracks (including hidden ones)."""
    mongo = get_mongo()
    query = {"uploader_id": current_user["id"]}

    sort_field = sort if sort in ("created_at", "play_count", "like_count") else "created_at"

    total = await mongo.tracks.count_documents(query)
    cursor = (
        mongo.tracks.find(query)
        .sort(sort_field, -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    tracks = await cursor.to_list(length=limit)

    return {
        "tracks": _serialize_tracks(tracks),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.delete("/{track_id}")
async def delete_track(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Delete own track, its audio file from MinIO, and clear Redis cache."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 삭제할 수 있습니다."})

    # Delete audio file from MinIO
    audio_url = doc.get("audio_url")
    if audio_url:
        try:
            minio_client = get_minio()
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_music,
                object_name=audio_url,
            )
        except Exception:
            pass  # Continue even if MinIO deletion fails

    # Delete from MongoDB
    await mongo.tracks.delete_one({"_id": ObjectId(track_id)})

    # Clear Redis cache (both legacy v1 and current v2 keys)
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"cache:track:v2:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # v69 — cascade: pull this track id from owner's albums, then delete
    # any albums that ended up empty.
    affected = await mongo.albums.update_many(
        {"track_ids": track_id, "owner_id": current_user["id"]},
        {"$pull": {"track_ids": track_id}},
    )
    deleted = await mongo.albums.delete_many({
        "owner_id": current_user["id"],
        "track_ids": {"$size": 0},
    })
    logger.info(
        "[TrackDelete] cascade track=%s affected_albums=%d deleted_albums=%d",
        track_id, affected.modified_count, deleted.deleted_count,
    )

    return {"message": "트랙이 삭제되었습니다."}


@router.put("/{track_id}")
async def update_track(
    track_id: str,
    body: TrackUpdateBody,
    current_user=Depends(get_current_user),
):
    """Update own track metadata."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 수정할 수 있습니다."})

    # Build update dict from non-None fields
    update_data = {k: v for k, v in body.dict().items() if v is not None}
    if not update_data:
        return JSONResponse(status_code=400, content={"error": "수정할 항목이 없습니다."})

    update_data["updated_at"] = datetime.now(timezone.utc)

    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": update_data},
    )

    # Clear Redis cache (both legacy v1 and current v2 keys)
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"cache:track:v2:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # Fetch and return updated document
    updated_doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    return _serialize_track(updated_doc)


@router.get("/{track_id}/music-video")
async def get_track_music_video(track_id: str):
    """Return presigned URL for the track's music video, or 404 if none exists."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"generation_id": 1})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    mv_job = await _find_completed_mv(mongo, doc.get("generation_id"))
    if not mv_job:
        return JSONResponse(status_code=404, content={"error": "뮤직비디오를 찾을 수 없습니다."})

    mv_url = _mv_presigned_url(mv_job.get("result_music_video_url"))
    if not mv_url:
        return JSONResponse(status_code=404, content={"error": "뮤직비디오 파일을 찾을 수 없습니다."})

    return {"has_music_video": True, "music_video_url": mv_url}


# v44 — Beat extraction status & retry for tracks
def _serialize_track_beats_payload(doc: dict) -> dict:
    started = doc.get("beats_started_at")
    completed = doc.get("beats_completed_at")
    return {
        "status": doc.get("beats_status") or "pending",
        "tempo": doc.get("tempo"),
        "beats": doc.get("beats") or [],
        "downbeats": doc.get("downbeats") or [],
        "started_at": started.isoformat() if isinstance(started, datetime) else None,
        "completed_at": completed.isoformat() if isinstance(completed, datetime) else None,
        "error": doc.get("beats_error"),
    }


@router.get("/{track_id}/beats")
async def get_track_beats(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Return beat extraction status + data for a track. Public tracks accessible to anyone authenticated."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    is_owner = doc.get("uploader_id") == current_user["id"]
    if not is_owner and not doc.get("is_public", True):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    return _serialize_track_beats_payload(doc)


@router.post("/{track_id}/beats/retry")
async def retry_track_beats(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Reset and re-trigger beat extraction for a track (owner only)."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})
    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 재시도할 수 있습니다."})
    if not doc.get("audio_url"):
        return JSONResponse(status_code=400, content={"error": "오디오 파일이 없습니다."})

    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": {
            "beats_status": "pending",
            "beats_error": None,
            "beats_started_at": None,
            "beats_completed_at": None,
            "tempo": None,
            "beats": [],
            "downbeats": [],
        }},
    )

    import asyncio as _asyncio
    from ..services.beat_extraction import detect_beats_for_track
    _asyncio.create_task(detect_beats_for_track(track_id))

    return {"message": "비트 재추출이 시작되었습니다.", "status": "pending"}


@router.get("/stream-proxy/{track_id}")
async def stream_track_proxy(track_id: str):
    """모바일 클라이언트용: MinIO 오디오를 직접 프록시 스트리밍"""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"audio_url": 1})
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
        )
        content_type = "audio/mpeg"
        if doc["audio_url"].endswith(".wav"):
            content_type = "audio/wav"
        elif doc["audio_url"].endswith(".ogg"):
            content_type = "audio/ogg"
        elif doc["audio_url"].endswith(".flac"):
            content_type = "audio/flac"
        elif doc["audio_url"].endswith(".m4a"):
            content_type = "audio/mp4"

        return StreamingResponse(
            response,
            media_type=content_type,
            headers={"Accept-Ranges": "bytes"},
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})


@router.get("/{track_id}")
async def get_track(track_id: str):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    redis = get_redis()
    mongo = get_mongo()

    # Check Redis cache (v2: schema bumped to include cover_character)
    cached = await redis.get(f"cache:track:v2:{track_id}")
    if cached:
        track = json.loads(cached)
        # Increment playcount buffer
        await redis.incr(f"playcount:buffer:{track_id}")
        return track

    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    track = _serialize_track(doc)

    # Look up linked completed mv_job once; reuse for both music_video and cover_character.
    mv_job = None
    try:
        mv_job = await _find_completed_mv(mongo, track.get("generation_id"))
    except Exception:
        logger.exception("[TrackCoverChar] mv_job lookup failed track=%s", track_id)
        mv_job = None

    # Attach music video info
    if mv_job:
        track["has_music_video"] = True
        track["music_video_url"] = _mv_presigned_url(mv_job.get("result_music_video_url"))
    else:
        track["has_music_video"] = False
        track["music_video_url"] = None

    # Build cover_character (only when mv_job opted in and snapshot exists)
    cover_character = None
    try:
        logger.info(
            "[TrackCoverChar] track=%s mv_job=%s include=%s items=%d",
            track_id,
            str(mv_job.get("_id")) if mv_job else None,
            bool(mv_job and mv_job.get("include_my_character")),
            len((mv_job.get("user_character_snapshot") or {}).get("used_items") or []) if mv_job else 0,
        )
        # v71: mv_job 의 snapshot 이 1순위, 없으면 트랙 도큐먼트 자체의 snapshot 으로 fallback
        # (MV 없이 cover 만 만든 곡도 cover_character 노출 가능).
        snap_source = None
        if (
            mv_job
            and mv_job.get("include_my_character") is True
            and mv_job.get("user_character_snapshot")
        ):
            snap_source = mv_job.get("user_character_snapshot")
        elif track.get("user_character_snapshot"):
            snap_source = track.get("user_character_snapshot")
            logger.info("[TrackCoverChar] fallback to track snapshot track=%s", track_id)

        if snap_source:
            snap = snap_source or {}
            cover_character = {
                "name": snap.get("name") or "",
                "age": snap.get("age") or "",
                "personality_tags": snap.get("personality_tags") or [],
                "personality_text": snap.get("personality_text") or "",
                "sheet_preview_path": (
                    "/api/character/preview/" + snap["sheet_object_name"]
                    if snap.get("sheet_object_name") else None
                ),
                "used_items": [
                    {
                        "id": it.get("id"),
                        "name": it.get("name") or "",
                        "image_object_name": it.get("image_object_name") or "",
                        "product_url": it.get("product_url"),
                        "category": it.get("category"),
                    }
                    for it in (snap.get("used_items") or [])
                ],
            }
    except Exception:
        logger.exception("[TrackCoverChar] failed track=%s", track_id)
        cover_character = None

    track["cover_character"] = cover_character

    # Increment playcount buffer in Redis
    await redis.incr(f"playcount:buffer:{track_id}")

    # Cache for 10 minutes (v2 key)
    await redis.setex(f"cache:track:v2:{track_id}", 600, json.dumps(track, default=str))

    return track


@router.post("/upload", status_code=201)
async def upload_track(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    genre: str = Form(None),
    mood: str = Form(None),
    tags: str = Form(None),
    categories: str = Form(None),  # v77: comma-separated 고정 카테고리
    ai_model: str = Form(None),
    prompt: str = Form(None),
    bpm: int = Form(None),
    key: str = Form(None),
    language: str = Form(None),
    lyrics: str = Form(None),
    is_public: bool = Form(True),
    current_user=Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB 이하여야 합니다."})

    # Generate track ID
    track_id = ObjectId()
    uploader_id = current_user["id"]

    # Upload to MinIO
    minio_client = get_minio()
    object_name = f"tracks/{uploader_id}/{str(track_id)}{ext}"
    content_type = mimetypes.guess_type(file.filename or "")[0] or "audio/mpeg"
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Extract duration with mutagen
    duration_sec = 0
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        from mutagen import File as MutagenFile
        audio = MutagenFile(tmp_path)
        if audio and audio.info:
            duration_sec = int(audio.info.length)
        os.unlink(tmp_path)
    except Exception:
        pass

    # Parse comma-separated fields into arrays
    genre_list = [g.strip() for g in genre.split(",") if g.strip()] if genre else []
    mood_list = [m.strip() for m in mood.split(",") if m.strip()] if mood else []
    tags_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    # v77 — categories: comma-separated 받아 화이트리스트 필터.
    from ..constants.categories import filter_categories
    cats_raw = [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    categories_list = filter_categories(cats_raw)

    now = datetime.now(timezone.utc)
    doc = {
        "_id": track_id,
        "title": title,
        "uploader_id": uploader_id,
        "uploader_nickname": current_user.get("nickname", ""),
        "ai_model": ai_model,
        "prompt": prompt,
        "ai_model_version": None,
        "genre": genre_list,
        "mood": mood_list,
        "tags": tags_list,
        "categories": categories_list,
        "bpm": bpm,
        "key": key,
        "duration_sec": duration_sec,
        "language": language,
        "audio_url": object_name,
        "cover_image_url": None,
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": is_public,
        "created_at": now,
        "updated_at": now,
        # v44 — beat extraction status (background task fires after insert)
        "beats_status": "pending",
        "tempo": None,
        "beats": [],
        "downbeats": [],
        "beats_started_at": None,
        "beats_completed_at": None,
        "beats_error": None,
    }

    mongo = get_mongo()
    await mongo.tracks.insert_one(doc)
    logger.info("[tracks] publish track_id=%s cats=%s", str(track_id), categories_list)

    # Points — best-effort +1 for publishing a track (never affects the upload).
    try:
        from ..services.points_service import award_point
        await award_point(uploader_id, "upload", str(track_id))
    except Exception as e:
        logger.warning("[points] upload hook failed: %s", e)

    # v44 — fire-and-forget beat extraction in a fresh event loop
    from ..services.beat_extraction import run_track_beat_extraction_in_background
    background_tasks.add_task(run_track_beat_extraction_in_background, str(track_id))

    # HybridSearch — unified enrich+index hook (best-effort, ordered):
    # concept keywords → Mongo search_keywords → pgvector re-embed → ES mirror.
    from ..services.embedding_service import enrich_and_index_track_in_background
    background_tasks.add_task(enrich_and_index_track_in_background, str(track_id))

    return _serialize_track(doc)


class UploadFromGenerationBody(BaseModel):
    generation_id: str
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    tags: Optional[str] = None
    categories: Optional[List[str]] = None  # v77: 고정 카테고리 (list 또는 comma-string)
    prompt: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    mv_object_name: Optional[str] = None
    ai_model: Optional[str] = "Suno"
    use_voice_converted: Optional[bool] = False
    # v71: MV 안 만들고 cover 만 만든 곡도 cover_character 노출 가능하도록
    # publish 시점의 사용자 캐릭터 snapshot 을 트랙 도큐먼트에 박음.
    # 구조는 mv_jobs.user_character_snapshot 와 동일.
    user_character_snapshot: Optional[dict] = None
    # v74: 두 클립 variant 중 어느 것을 트랙으로 업로드할지 선택
    # 0 = result_audio_url (BC), >=1 = variants[variant_index].audio_url
    variant_index: Optional[int] = 0


@router.post("/upload-from-generation", status_code=201)
async def upload_from_generation(
    body: UploadFromGenerationBody,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Create a track from a completed AI generation."""
    if not ObjectId.is_valid(body.generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 생성 ID입니다."})

    mongo = get_mongo()

    # Find generation and verify ownership
    gen_doc = await mongo.generations.find_one({"_id": ObjectId(body.generation_id)})
    if not gen_doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if gen_doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if gen_doc.get("status") != "completed":
        return JSONResponse(status_code=400, content={"error": "완료된 생성 요청만 업로드할 수 있습니다."})
    if not gen_doc.get("result_audio_url"):
        return JSONResponse(status_code=400, content={"error": "생성된 오디오 파일이 없습니다."})

    # v74 — Determine audio source: voice converted or specific variant
    import logging as _logging
    _log = _logging.getLogger(__name__)
    variant_index = body.variant_index or 0
    if variant_index < 0:
        return JSONResponse(status_code=400, content={"error": "variant_index는 0 이상이어야 합니다."})
    if variant_index > 0 and body.use_voice_converted:
        return JSONResponse(
            status_code=400,
            content={"error": "보이스 변환은 첫 번째 클립(variant 0)에만 사용할 수 있습니다."},
        )

    if body.use_voice_converted:
        vc_url = gen_doc.get("voice_converted_url")
        if not vc_url:
            return JSONResponse(status_code=400, content={"error": "보이스 변환된 오디오 파일이 없습니다."})
        source_object_name = vc_url
    else:
        gen_variants = gen_doc.get("variants") or []
        if variant_index == 0:
            if gen_variants and len(gen_variants) > 0:
                source_object_name = gen_variants[0].get("audio_url") or gen_doc["result_audio_url"]
            else:
                source_object_name = gen_doc["result_audio_url"]
        else:
            if not gen_variants or variant_index >= len(gen_variants):
                _log.warning(
                    "[UploadVariant] gen=%s variant=%d out of range (have=%d)",
                    body.generation_id, variant_index, len(gen_variants),
                )
                return JSONResponse(
                    status_code=400,
                    content={"error": f"variant {variant_index} 범위를 벗어났습니다."},
                )
            source_object_name = gen_variants[variant_index].get("audio_url")
            if not source_object_name:
                return JSONResponse(
                    status_code=400,
                    content={"error": "선택한 variant에 오디오가 없습니다."},
                )

    _log.info(
        "[UploadVariant] gen=%s variant=%d source=%s use_vc=%s",
        body.generation_id, variant_index, source_object_name, bool(body.use_voice_converted),
    )

    track_id = ObjectId()
    uploader_id = current_user["id"]

    # Determine extension from source
    ext = ".wav" if source_object_name.endswith(".wav") else ".mp3"
    dest_object_name = f"tracks/{uploader_id}/{str(track_id)}{ext}"

    # Copy audio file in MinIO (get + put since copy_object requires CopySource)
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=source_object_name,
        )
        audio_data = response.read()
        response.close()
        response.release_conn()

        content_type = "audio/wav" if ext == ".wav" else "audio/mpeg"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=dest_object_name,
            data=io.BytesIO(audio_data),
            length=len(audio_data),
            content_type=content_type,
        )
    except Exception:
        return JSONResponse(status_code=500, content={"error": "오디오 파일 복사에 실패했습니다."})

    # Extract duration with mutagen
    duration_sec = 0
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name
        from mutagen import File as MutagenFile
        audio = MutagenFile(tmp_path)
        if audio and audio.info:
            duration_sec = int(audio.info.length)
        os.unlink(tmp_path)
    except Exception:
        pass

    # Parse comma-separated fields into arrays
    genre_list = [g.strip() for g in body.genre.split(",") if g.strip()] if body.genre else []
    mood_list = [m.strip() for m in body.mood.split(",") if m.strip()] if body.mood else []
    tags_list = [t.strip() for t in body.tags.split(",") if t.strip()] if body.tags else []

    # v77 — categories: body 우선(없으면 generation doc fallback), 항상 화이트리스트 필터.
    # body.categories 는 list 또는 comma-separated string 모두 허용.
    from ..constants.categories import filter_categories
    if isinstance(body.categories, str):
        cats_source = [c.strip() for c in body.categories.split(",") if c.strip()]
    elif isinstance(body.categories, list):
        cats_source = body.categories
    else:
        cats_source = gen_doc.get("categories")
    categories_list = filter_categories(cats_source)

    now = datetime.now(timezone.utc)

    # SnapFix — 발행 시점의 캐릭터 시트를 불변 경로(character_snapshots/)로
    # 복사해 이후 캐릭터 재생성/삭제로부터 곡 표시를 격리한다.
    # best-effort: 복사 실패 시 원본 경로 그대로 저장 — 발행은 절대 실패하지 않는다.
    user_character_snapshot = body.user_character_snapshot
    if user_character_snapshot and user_character_snapshot.get("sheet_object_name"):
        from ..services.snapshot_service import snapshot_sheet_copy

        _origin_sheet = user_character_snapshot.get("sheet_object_name")
        _copied_sheet = snapshot_sheet_copy(minio_client, uploader_id, _origin_sheet)
        if _copied_sheet:
            user_character_snapshot = dict(user_character_snapshot)
            user_character_snapshot["sheet_object_name"] = _copied_sheet
            user_character_snapshot["sheet_object_name_origin"] = _origin_sheet
        logger.info(
            "[SnapFix] track publish user=%s track_id=%s copied=%s",
            uploader_id, str(track_id), bool(_copied_sheet),
        )

    # v44 — Inherit beats from the generation if already extracted, otherwise
    # mark pending and fire background extraction.
    # v74 — beats are extracted only from variant 0 (first clip). For variant>0
    # do not inherit; trigger fresh extraction in background.
    gen_beats_status = gen_doc.get("beats_status")
    inherit_beats = (
        variant_index == 0
        and gen_beats_status == "completed"
        and gen_doc.get("beats")
    )
    if inherit_beats:
        beats_fields = {
            "beats_status": "completed",
            "tempo": gen_doc.get("tempo"),
            "beats": gen_doc.get("beats") or [],
            "downbeats": gen_doc.get("downbeats") or [],
            "beats_started_at": gen_doc.get("beats_started_at"),
            "beats_completed_at": gen_doc.get("beats_completed_at"),
            "beats_error": None,
        }
    else:
        beats_fields = {
            "beats_status": "pending",
            "tempo": None,
            "beats": [],
            "downbeats": [],
            "beats_started_at": None,
            "beats_completed_at": None,
            "beats_error": None,
        }

    doc = {
        "_id": track_id,
        "title": body.title,
        "uploader_id": uploader_id,
        "uploader_nickname": current_user.get("nickname", ""),
        "ai_model": body.ai_model,
        "prompt": body.prompt,
        "ai_model_version": None,
        "genre": genre_list,
        "mood": mood_list,
        "tags": tags_list,
        "categories": categories_list,
        "bpm": gen_doc.get("bpm"),
        "key": gen_doc.get("key"),
        "duration_sec": duration_sec,
        "language": None,
        "lyrics": body.lyrics,
        "audio_url": dest_object_name,
        "cover_image_url": body.cover_object_name,
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": True,
        "generation_id": str(gen_doc["_id"]),
        "variant_index": variant_index,  # v74
        "user_character_snapshot": user_character_snapshot,
        "created_at": now,
        "updated_at": now,
        **beats_fields,
    }

    await mongo.tracks.insert_one(doc)
    _log.info(
        "[UploadVariant] gen=%s variant=%d track_id=%s inserted",
        body.generation_id, variant_index, str(track_id),
    )
    logger.info("[tracks] publish track_id=%s cats=%s", str(track_id), categories_list)

    # Points — best-effort +1 for publishing a track (never affects the upload).
    try:
        from ..services.points_service import award_point
        await award_point(uploader_id, "upload", str(track_id))
    except Exception as e:
        logger.warning("[points] upload hook failed: %s", e)

    # Update generation with result_track_id
    await mongo.generations.update_one(
        {"_id": ObjectId(body.generation_id)},
        {"$set": {"result_track_id": str(track_id), "updated_at": now}},
    )

    # v44 — Trigger background extraction only if we couldn't inherit
    if not inherit_beats:
        from ..services.beat_extraction import run_track_beat_extraction_in_background
        background_tasks.add_task(run_track_beat_extraction_in_background, str(track_id))

    # HybridSearch — unified enrich+index hook (best-effort, ordered):
    # concept keywords → Mongo search_keywords → pgvector re-embed → ES mirror.
    from ..services.embedding_service import enrich_and_index_track_in_background
    background_tasks.add_task(enrich_and_index_track_in_background, str(track_id))

    return _serialize_track(doc)


@router.get("/stream/{track_id}")
async def stream_track(track_id: str):
    """Return a presigned URL for streaming the track from MinIO."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"audio_url": 1})
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    minio_client = get_minio()
    try:
        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
            expires=timedelta(hours=1),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    return {"stream_url": url}


@router.post("/download/{track_id}")
async def download_track(track_id: str, user: dict = Depends(get_current_user)):
    """Download a track file and record it for chart calculation."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"audio_url": 1, "title": 1})
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # Record download for charts
    redis = get_redis()
    user_id = str(user.get("id") or user.get("user_id"))

    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)
    year, week, _ = now.isocalendar()
    keys = {
        "hourly": now.strftime("%Y%m%d%H"),
        "daily": now.strftime("%Y%m%d"),
        "weekly": f"{year}-W{week:02d}",
        "monthly": now.strftime("%Y%m"),
    }

    pipe = redis.pipeline()
    # Download dedup sets (1 user = 1 count per period)
    dl_keys_ttl = [
        (f"chart:downloads:hourly:{keys['hourly']}:{track_id}", 2 * 3600),
        (f"chart:downloads:daily:{keys['daily']}:{track_id}", 2 * 86400),
        (f"chart:downloads:weekly:{keys['weekly']}:{track_id}", 8 * 86400),
        (f"chart:downloads:monthly:{keys['monthly']}:{track_id}", 32 * 86400),
    ]
    for key, ttl in dl_keys_ttl:
        pipe.sadd(key, user_id)
        pipe.expire(key, ttl)

    # Download track index sets
    dl_index_ttl = [
        (f"chart:dl_tracks:hourly:{keys['hourly']}", 2 * 3600),
        (f"chart:dl_tracks:daily:{keys['daily']}", 2 * 86400),
        (f"chart:dl_tracks:weekly:{keys['weekly']}", 8 * 86400),
        (f"chart:dl_tracks:monthly:{keys['monthly']}", 32 * 86400),
    ]
    for key, ttl in dl_index_ttl:
        pipe.sadd(key, track_id)
        pipe.expire(key, ttl)

    await pipe.execute()

    # v111: 다운로드 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    # Save to MongoDB for persistence
    await mongo.download_logs.insert_one({
        "user_id": user_id,
        "track_id": track_id,
        "downloaded_at": now,
    })

    # Increment download_count in MongoDB
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"download_count": 1}},
    )

    # Get presigned URL for download
    minio_client = get_minio()
    try:
        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
            expires=timedelta(hours=1),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title = doc.get("title", "track")
    ext = doc["audio_url"].rsplit(".", 1)[-1] if "." in doc["audio_url"] else "mp3"

    return {"download_url": url, "filename": f"{title}.{ext}"}
