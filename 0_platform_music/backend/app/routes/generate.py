"""
AI Music Generation API
- POST /api/generate/lyrics   : Generate lyrics via ChatGPT
- POST /api/generate/         : Submit music generation request (saves + starts YuE)
- GET  /api/generate/         : List user's generation history
- GET  /api/generate/{id}     : Get single generation status/result
- DELETE /api/generate/{id}   : Delete generation record
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/generate")


# ─── Request Models ─────────────────────────────────────────

class LyricsRequest(BaseModel):
    prompt: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    language: Optional[str] = "ko"


class GenerateRequest(BaseModel):
    prompt: str
    title: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    vocal: Optional[str] = None
    duration: Optional[int] = 30  # seconds
    bpm: Optional[int] = None
    key: Optional[str] = None
    instruments: Optional[str] = None
    reference_style: Optional[str] = None
    lyrics: Optional[str] = None
    start_music_gen: Optional[bool] = False  # True to start YuE generation


# ─── Helpers ─────────────────────────────────────────────────

def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at", "completed_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


# ─── Background task for YuE music generation ───────────────

def _run_music_generation(generation_id: str, lyrics: str, genre: str, mood: str, style: str, vocal: str, duration: int):
    """Wrapper to run async music generation in background."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        from ..services.music_generator import generate_music

        # Create a new motor client for this event loop
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        segments = max(1, (duration or 30) // 30)

        loop.run_until_complete(
            generate_music(
                generation_id=generation_id,
                lyrics=lyrics,
                genre=genre,
                mood=mood,
                style=style,
                vocal=vocal,
                duration_segments=segments,
                mongo_db=mongo_db,
            )
        )
    except Exception as e:
        print(f"Music generation error for {generation_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        loop.close()


# ─── Routes ─────────────────────────────────────────────────

@router.post("/lyrics/")
async def generate_lyrics_endpoint(
    body: LyricsRequest,
    current_user=Depends(get_current_user),
):
    """Generate lyrics using ChatGPT API."""
    if not body.prompt.strip():
        return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})

    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    try:
        from ..services.lyrics_generator import generate_lyrics

        result = await generate_lyrics(
            prompt=body.prompt.strip(),
            genre=body.genre,
            mood=body.mood,
            language=body.language or "ko",
        )
        return result
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"가사 생성 실패: {str(e)[:200]}"},
        )


@router.post("/", status_code=201)
async def create_generation(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """
    Create a generation record.
    If start_music_gen=True, also starts YuE background generation.
    """
    if not body.prompt.strip():
        return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})

    mongo = get_mongo()
    now = datetime.now(timezone.utc)

    doc = {
        "user_id": current_user["id"],
        "user_nickname": current_user.get("nickname", ""),
        "prompt": body.prompt.strip(),
        "title": body.title,
        "genre": body.genre,
        "mood": body.mood,
        "style": body.style,
        "vocal": body.vocal,
        "duration": body.duration or 30,
        "bpm": body.bpm,
        "key": body.key,
        "instruments": body.instruments,
        "reference_style": body.reference_style,
        "lyrics": body.lyrics,
        "status": "pending",
        "progress": 0,
        "result_track_id": None,
        "result_audio_url": None,
        "output_files": [],
        "error_message": None,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }

    result = await mongo.generations.insert_one(doc)
    doc["_id"] = result.inserted_id
    gen_id = str(result.inserted_id)

    # Start YuE music generation if requested
    if body.start_music_gen and body.lyrics:
        background_tasks.add_task(
            _run_music_generation,
            generation_id=gen_id,
            lyrics=body.lyrics,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            vocal=body.vocal,
            duration=body.duration or 30,
        )

    return _serialize(doc)


@router.post("/{gen_id}/start/")
async def start_music_generation(
    gen_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Start YuE music generation for an existing generation record."""
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") == "processing":
        return JSONResponse(status_code=409, content={"error": "이미 생성 중입니다."})

    # Update status
    await mongo.generations.update_one(
        {"_id": ObjectId(gen_id)},
        {"$set": {"status": "pending", "progress": 5, "updated_at": datetime.now(timezone.utc)}},
    )

    background_tasks.add_task(
        _run_music_generation,
        generation_id=gen_id,
        lyrics=doc.get("lyrics", ""),
        genre=doc.get("genre"),
        mood=doc.get("mood"),
        style=doc.get("style"),
        vocal=doc.get("vocal"),
        duration=doc.get("duration", 30),
    )

    return {"message": "음악 생성이 시작되었습니다.", "id": gen_id}


@router.get("/")
async def list_generations(
    page: int = 1,
    limit: int = 20,
    status: str = None,
    current_user=Depends(get_current_user),
):
    mongo = get_mongo()
    query = {"user_id": current_user["id"]}
    if status:
        query["status"] = status

    total = await mongo.generations.count_documents(query)
    cursor = (
        mongo.generations.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)

    return {
        "generations": [_serialize(d) for d in docs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{gen_id}")
async def get_generation(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    return _serialize(doc)


@router.delete("/{gen_id}")
async def delete_generation(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    await mongo.generations.delete_one({"_id": ObjectId(gen_id)})
    return {"message": "삭제되었습니다."}


@router.get("/{gen_id}/stream/")
async def stream_generation(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    """Proxy the generated audio file from MinIO so external clients can access it."""
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") != "completed" or not doc.get("result_audio_url"):
        return JSONResponse(status_code=404, content={"error": "완료된 오디오 파일이 없습니다."})

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["result_audio_url"],
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title_raw = doc.get("title", "generated") or "generated"
    import re
    from urllib.parse import quote
    # ASCII-only fallback filename
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', title_raw.replace(' ', '_')) or "generated"
    ext = ".wav" if doc["result_audio_url"].endswith(".wav") else ".mp3"
    content_type = "audio/wav" if ext == ".wav" else "audio/mpeg"
    encoded_name = quote(f"{title_raw}{ext}")

    return StreamingResponse(
        response,
        media_type=content_type,
        headers={
            "Content-Disposition": f"attachment; filename=\"{safe_name}{ext}\"; filename*=UTF-8''{encoded_name}",
        },
    )
