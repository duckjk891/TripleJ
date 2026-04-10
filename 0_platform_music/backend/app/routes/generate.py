"""
AI Music Generation API
- POST /api/generate/lyrics   : Generate lyrics via ChatGPT
- POST /api/generate/         : Submit music generation request (saves + starts YuE)
- GET  /api/generate/         : List user's generation history
- GET  /api/generate/{id}     : Get single generation status/result
- DELETE /api/generate/{id}   : Delete generation record
"""
import asyncio
import io
import math
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Request, UploadFile
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
    model: Optional[str] = "yue"  # AI 모델 ID
    persona_id: Optional[str] = None  # Suno Voice Persona ID
    negative_tags: Optional[str] = None      # Styles to exclude
    style_weight: Optional[float] = None     # 0.0-1.0, style adherence
    weirdness: Optional[float] = None        # 0.0-1.0, creative deviation
    audio_weight: Optional[float] = None     # 0.0-1.0, reference audio influence
    persona_model: Optional[str] = None      # "style_persona" or "voice_persona"
    reference_audio_url: Optional[str] = None       # presigned URL for reference audio
    reference_audio_name: Optional[str] = None      # original filename
    reference_audio_duration: Optional[float] = None  # duration in seconds


# ─── Helpers ─────────────────────────────────────────────────

def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at", "completed_at", "voice_conversion_completed_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    doc["model"] = doc.get("model", "yue")
    return doc


# ─── Background task for YuE music generation ───────────────

def _run_music_generation(generation_id: str, lyrics: str, genre: str, mood: str, style: str, vocal: str, duration: int, model: str = "yue", title: str = None, persona_id: str = None, negative_tags: str = None, style_weight: float = None, weirdness: float = None, audio_weight: float = None, persona_model: str = None, bpm: int = None, key: str = None, reference_audio_url: str = None):
    """Wrapper to run async music generation in background."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio

        # Create a new motor client for this event loop
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]

        if model == "suno":
            from ..services.suno_generator import generate_music_suno

            loop.run_until_complete(
                generate_music_suno(
                    generation_id=generation_id,
                    lyrics=lyrics,
                    genre=genre,
                    mood=mood,
                    style=style,
                    vocal=vocal,
                    title=title,
                    mongo_db=mongo_db,
                    persona_id=persona_id,
                    negative_tags=negative_tags,
                    style_weight=style_weight,
                    weirdness=weirdness,
                    audio_weight=audio_weight,
                    persona_model=persona_model,
                    bpm=bpm,
                    key=key,
                    reference_audio_url=reference_audio_url,
                )
            )
        else:
            from ..services.music_generator import generate_music

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
                    model=model,
                )
            )
    except Exception as e:
        print(f"Music generation error for {generation_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        loop.close()


ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
MAX_REFERENCE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_REFERENCE_DURATION = 480  # 8 minutes in seconds


# ─── Routes ─────────────────────────────────────────────────

@router.post("/upload-reference/")
async def upload_reference_audio(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload a reference audio file for Suno upload-cover generation."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 오디오 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_REFERENCE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "파일 크기는 50MB 이하여야 합니다."},
        )

    # Extract audio duration using mutagen
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(io.BytesIO(contents))
        if audio is None or audio.info is None:
            return JSONResponse(
                status_code=400,
                content={"error": "오디오 파일을 읽을 수 없습니다."},
            )
        duration_sec = audio.info.length
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"error": f"오디오 파일 분석 실패: {str(e)[:200]}"},
        )

    if duration_sec > MAX_REFERENCE_DURATION:
        return JSONResponse(
            status_code=400,
            content={"error": f"오디오 길이는 최대 8분(480초)까지 허용됩니다. (현재: {duration_sec:.1f}초)"},
        )

    # Upload to MinIO
    minio_client = get_minio()
    content_type = mimetypes.guess_type(file.filename or "")[0] or "audio/mpeg"
    object_name = f"reference/{current_user['id']}/{uuid_lib.uuid4().hex}{ext}"

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Generate presigned URL (24h)
    upload_url = minio_client.presigned_get_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        expires=timedelta(hours=24),
    )

    return {
        "upload_url": upload_url,
        "object_name": object_name,
        "filename": file.filename,
        "duration_sec": round(duration_sec, 2),
    }


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
        "model": body.model or "yue",
        "persona_id": body.persona_id,
        "negative_tags": body.negative_tags,
        "style_weight": body.style_weight,
        "weirdness": body.weirdness,
        "audio_weight": body.audio_weight,
        "persona_model": body.persona_model,
        "reference_audio_url": body.reference_audio_url,
        "reference_audio_name": body.reference_audio_name,
        "reference_audio_duration": body.reference_audio_duration,
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

    # Start music generation if requested
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
            model=body.model or "yue",
            title=body.title,
            persona_id=body.persona_id,
            negative_tags=body.negative_tags,
            style_weight=body.style_weight,
            weirdness=body.weirdness,
            audio_weight=body.audio_weight,
            persona_model=body.persona_model,
            bpm=body.bpm,
            key=body.key,
            reference_audio_url=body.reference_audio_url,
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
        model=doc.get("model", "yue"),
        title=doc.get("title"),
        persona_id=doc.get("persona_id"),
        negative_tags=doc.get("negative_tags"),
        style_weight=doc.get("style_weight"),
        weirdness=doc.get("weirdness"),
        audio_weight=doc.get("audio_weight"),
        persona_model=doc.get("persona_model"),
        bpm=doc.get("bpm"),
        key=doc.get("key"),
        reference_audio_url=doc.get("reference_audio_url"),
    )

    return {"message": "음악 생성이 시작되었습니다.", "id": gen_id}


@router.get("/models/")
async def list_models(current_user=Depends(get_current_user)):
    """List available AI music generation models."""
    return {"models": [
        {
            "id": "yue",
            "name": "YuE",
            "description": "오픈소스 음악 생성 AI (보컬 + 반주)",
            "supports_vocal": True,
            "supports_instrumental": True,
            "max_duration": 120,
            "default": True,
        },
        {
            "id": "suno",
            "name": "Suno",
            "description": "AI 음악 생성 서비스 (고품질 보컬 + 반주)",
            "supports_vocal": True,
            "supports_instrumental": True,
            "max_duration": 240,
            "default": False,
        },
    ]}


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
