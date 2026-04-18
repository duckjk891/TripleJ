"""
Voice Persona API routes — upload voice sample, create Suno persona, list/delete.

- POST /api/voice-persona/create            Upload voice file + start persona creation
- GET  /api/voice-persona/list              List user's voice personas
- GET  /api/voice-persona/{id}              Get single persona status
- GET  /api/voice-persona/{id}/vocal/stream  Stream vocal audio (preview)
- GET  /api/voice-persona/{id}/cover/stream  Stream cover audio (preview)
- GET  /api/voice-persona/{id}/vocal/download Download vocal audio
- GET  /api/voice-persona/{id}/cover/download Download cover audio
- DELETE /api/voice-persona/{id}            Delete persona
"""
import asyncio
import io
import logging
import os
import re
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice-persona", tags=["VoicePersona"])

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB


def _presign_audio(object_name: Optional[str]) -> Optional[str]:
    """Generate a presigned URL for an audio object in the music bucket."""
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        return minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
    except Exception:
        return None


def _run_persona_creation(
    persona_doc_id: str,
    user_id: str,
    source_audio_object: str,
    name: str,
    description: str,
):
    """Background task wrapper — runs async persona workflow in its own event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]

        from ..services.voice_persona_service import create_voice_persona

        loop.run_until_complete(
            create_voice_persona(
                persona_doc_id=persona_doc_id,
                user_id=user_id,
                source_audio_object=source_audio_object,
                name=name,
                description=description,
                mongo_db=mongo_db,
            )
        )
    except Exception as e:
        print(f"Voice persona creation error for {persona_doc_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        loop.close()


# ── POST /api/voice-persona/create ──────────────────────────────────────────

@router.post("/create")
async def create_persona(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    current_user=Depends(get_current_user),
):
    """Upload a voice sample and start the 4-step persona creation workflow."""

    if not settings.suno_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Suno API 키가 설정되지 않았습니다."},
        )

    # Validate file
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "파일 크기는 50MB 이하여야 합니다."},
        )

    if not name or not name.strip():
        return JSONResponse(
            status_code=400,
            content={"error": "Persona 이름을 입력해주세요."},
        )

    user_id = current_user["id"]

    # Upload to MinIO
    minio_client = get_minio()
    object_name = f"voice-personas/{user_id}/{uuid_lib.uuid4().hex}{ext}"

    content_type_map = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
    }
    content_type = content_type_map.get(ext, "audio/mpeg")

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Create MongoDB document
    mongo = get_mongo()
    now = datetime.utcnow()
    doc = {
        "user_id": user_id,
        "name": name.strip()[:50],
        "description": (description or "").strip()[:200],
        "persona_id": None,
        "status": "pending",
        "progress": 0,
        "error_message": None,
        "source_audio_object": object_name,
        "cover_task_id": None,
        "cover_audio_url": None,
        "separate_task_id": None,
        "vocal_audio_url": None,
        "persona_task_id": None,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    result = await mongo.voice_personas.insert_one(doc)
    doc_id = str(result.inserted_id)

    # Start background task
    background_tasks.add_task(
        _run_persona_creation,
        persona_doc_id=doc_id,
        user_id=user_id,
        source_audio_object=object_name,
        name=name.strip(),
        description=(description or "").strip(),
    )

    return {
        "id": doc_id,
        "name": doc["name"],
        "status": "pending",
        "message": "Voice Persona 생성이 시작되었습니다.",
    }


# ── GET /api/voice-persona/list ─────────────────────────────────────────────

@router.get("/list")
async def list_personas(
    current_user=Depends(get_current_user),
):
    """List all voice personas for the current user."""
    mongo = get_mongo()
    cursor = mongo.voice_personas.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=50)

    personas = []
    for d in docs:
        persona = {
            "id": str(d["_id"]),
            "name": d.get("name", ""),
            "description": d.get("description", ""),
            "persona_id": d.get("persona_id"),
            "status": d.get("status", "unknown"),
            "progress": d.get("progress", 0),
            "error_message": d.get("error_message"),
            "created_at": d.get("created_at", "").isoformat() if d.get("created_at") else None,
            "updated_at": d.get("updated_at", "").isoformat() if d.get("updated_at") else None,
            "has_vocal": bool(d.get("vocal_object_name")),
            "has_cover": bool(d.get("cover_object_name")),
        }
        # Include presigned URLs for completed personas with stored audio
        if d.get("vocal_object_name"):
            persona["vocal_url"] = _presign_audio(d["vocal_object_name"])
        if d.get("cover_object_name"):
            persona["cover_url"] = _presign_audio(d["cover_object_name"])
        personas.append(persona)

    return {"personas": personas}


# ── GET /api/voice-persona/{id} ─────────────────────────────────────────────

@router.get("/{persona_id}")
async def get_persona(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Get a single voice persona status."""
    if not ObjectId.is_valid(persona_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.voice_personas.find_one({"_id": ObjectId(persona_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "Voice Persona를 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    result = {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "description": doc.get("description", ""),
        "persona_id": doc.get("persona_id"),
        "status": doc.get("status", "unknown"),
        "progress": doc.get("progress", 0),
        "error_message": doc.get("error_message"),
        "created_at": doc.get("created_at", "").isoformat() if doc.get("created_at") else None,
        "updated_at": doc.get("updated_at", "").isoformat() if doc.get("updated_at") else None,
        "has_vocal": bool(doc.get("vocal_object_name")),
        "has_cover": bool(doc.get("cover_object_name")),
    }
    if doc.get("vocal_object_name"):
        result["vocal_url"] = _presign_audio(doc["vocal_object_name"])
    if doc.get("cover_object_name"):
        result["cover_url"] = _presign_audio(doc["cover_object_name"])
    return result


# ── Audio streaming/download helpers ────────────────────────────────────────

async def _get_persona_doc(persona_id: str, user_id: str):
    """Fetch and validate persona document ownership."""
    if not ObjectId.is_valid(persona_id):
        return None, JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    mongo = get_mongo()
    doc = await mongo.voice_personas.find_one({"_id": ObjectId(persona_id)})
    if not doc:
        return None, JSONResponse(status_code=404, content={"error": "Voice Persona를 찾을 수 없습니다."})
    if doc.get("user_id") != user_id:
        return None, JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    return doc, None


def _stream_audio(object_name: str, filename: str, as_download: bool = False):
    """Create a StreamingResponse from a MinIO object."""
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=object_name,
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', filename.replace(' ', '_')) or "audio"
    encoded_name = quote(f"{filename}.mp3")
    disposition = "attachment" if as_download else "inline"

    return StreamingResponse(
        response,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}.mp3"; filename*=UTF-8\'\'{encoded_name}',
        },
    )


# ── GET /api/voice-persona/{id}/vocal/stream ──────────────────────────────

@router.get("/{persona_id}/vocal/stream")
async def stream_vocal(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Stream the extracted vocal audio for preview."""
    doc, err = await _get_persona_doc(persona_id, current_user["id"])
    if err:
        return err
    if not doc.get("vocal_object_name"):
        return JSONResponse(status_code=404, content={"error": "보컬 오디오가 없습니다."})
    return _stream_audio(doc["vocal_object_name"], f"{doc.get('name', 'vocal')}_vocal")


# ── GET /api/voice-persona/{id}/cover/stream ──────────────────────────────

@router.get("/{persona_id}/cover/stream")
async def stream_cover(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Stream the AI cover audio for preview."""
    doc, err = await _get_persona_doc(persona_id, current_user["id"])
    if err:
        return err
    if not doc.get("cover_object_name"):
        return JSONResponse(status_code=404, content={"error": "커버 오디오가 없습니다."})
    return _stream_audio(doc["cover_object_name"], f"{doc.get('name', 'cover')}_cover")


# ── GET /api/voice-persona/{id}/vocal/download ────────────────────────────

@router.get("/{persona_id}/vocal/download")
async def download_vocal(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Download the extracted vocal audio."""
    doc, err = await _get_persona_doc(persona_id, current_user["id"])
    if err:
        return err
    if not doc.get("vocal_object_name"):
        return JSONResponse(status_code=404, content={"error": "보컬 오디오가 없습니다."})
    return _stream_audio(doc["vocal_object_name"], f"{doc.get('name', 'vocal')}_vocal", as_download=True)


# ── GET /api/voice-persona/{id}/cover/download ────────────────────────────

@router.get("/{persona_id}/cover/download")
async def download_cover(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Download the AI cover audio."""
    doc, err = await _get_persona_doc(persona_id, current_user["id"])
    if err:
        return err
    if not doc.get("cover_object_name"):
        return JSONResponse(status_code=404, content={"error": "커버 오디오가 없습니다."})
    return _stream_audio(doc["cover_object_name"], f"{doc.get('name', 'cover')}_cover", as_download=True)


# ── DELETE /api/voice-persona/{id} ──────────────────────────────────────────

@router.delete("/{persona_id}")
async def delete_persona(
    persona_id: str,
    current_user=Depends(get_current_user),
):
    """Delete a voice persona."""
    if not ObjectId.is_valid(persona_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.voice_personas.find_one({"_id": ObjectId(persona_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "Voice Persona를 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    # Delete all related MinIO objects
    minio_client = get_minio()
    for key in ("source_audio_object", "vocal_object_name", "cover_object_name"):
        obj = doc.get(key)
        if obj:
            try:
                minio_client.remove_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=obj,
                )
            except Exception as e:
                logger.warning("Failed to delete MinIO object %s: %s", obj, e)

    # Delete from MongoDB
    await mongo.voice_personas.delete_one({"_id": ObjectId(persona_id)})

    return {"message": "Voice Persona가 삭제되었습니다."}
