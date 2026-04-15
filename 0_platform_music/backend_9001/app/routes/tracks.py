import io
import json
import math
import mimetypes
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.redis import get_redis
from ..database.minio import get_minio

router = APIRouter(prefix="/api/tracks")

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


@router.get("/search")
async def search_tracks(q: str = Query(None), page: int = 1, limit: int = 20):
    if not q:
        return JSONResponse(status_code=400, content={"error": "검색어를 입력해주세요."})

    mongo = get_mongo()

    # MongoDB text search (requires text index on title, prompt, tags, etc.)
    # Fallback to regex if text index not available
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


class TrackUpdateBody(BaseModel):
    title: Optional[str] = None
    genre: Optional[List[str]] = None
    mood: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    is_public: Optional[bool] = None


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

    # Clear Redis cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

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

    # Clear Redis cache
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
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


@router.get("/stream-proxy/{track_id}")
async def stream_track_proxy(track_id: str):
    """모바일 클라이언트용: MinIO 오디오를 직접 프록시 스트리밍"""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"audio_url": 1})
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    audio_url = doc["audio_url"]

    # Determine content type from file extension
    if audio_url.endswith(".wav"):
        content_type = "audio/wav"
    else:
        content_type = "audio/mpeg"

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_url,
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    def iter_audio():
        try:
            for chunk in response.stream(64 * 1024):
                yield chunk
        finally:
            response.close()
            response.release_conn()

    return StreamingResponse(
        iter_audio(),
        media_type=content_type,
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/{track_id}")
async def get_track(track_id: str):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    redis = get_redis()
    mongo = get_mongo()

    # Check Redis cache
    cached = await redis.get(f"cache:track:{track_id}")
    if cached:
        track = json.loads(cached)
        # Increment playcount buffer
        await redis.incr(f"playcount:buffer:{track_id}")
        return track

    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    track = _serialize_track(doc)

    # Attach music video info
    mv_job = await _find_completed_mv(mongo, track.get("generation_id"))
    if mv_job:
        track["has_music_video"] = True
        track["music_video_url"] = _mv_presigned_url(mv_job.get("result_music_video_url"))
    else:
        track["has_music_video"] = False
        track["music_video_url"] = None

    # Increment playcount buffer in Redis
    await redis.incr(f"playcount:buffer:{track_id}")

    # Cache for 10 minutes
    await redis.setex(f"cache:track:{track_id}", 600, json.dumps(track, default=str))

    return track


@router.post("/upload", status_code=201)
async def upload_track(
    file: UploadFile = File(...),
    title: str = Form(...),
    genre: str = Form(None),
    mood: str = Form(None),
    tags: str = Form(None),
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
    }

    mongo = get_mongo()
    await mongo.tracks.insert_one(doc)

    return _serialize_track(doc)


class UploadFromGenerationBody(BaseModel):
    generation_id: str
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    tags: Optional[str] = None
    prompt: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    ai_model: Optional[str] = "YuE"
    use_voice_converted: Optional[bool] = False


@router.post("/upload-from-generation", status_code=201)
async def upload_from_generation(
    body: UploadFromGenerationBody,
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

    # Determine audio source: voice converted or original
    if body.use_voice_converted:
        vc_url = gen_doc.get("voice_converted_url")
        if not vc_url:
            return JSONResponse(status_code=400, content={"error": "보이스 변환된 오디오 파일이 없습니다."})
        source_object_name = vc_url
    else:
        source_object_name = gen_doc["result_audio_url"]

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

    now = datetime.now(timezone.utc)
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
        "created_at": now,
        "updated_at": now,
    }

    await mongo.tracks.insert_one(doc)

    # Update generation with result_track_id
    await mongo.generations.update_one(
        {"_id": ObjectId(body.generation_id)},
        {"$set": {"result_track_id": str(track_id), "updated_at": now}},
    )

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
