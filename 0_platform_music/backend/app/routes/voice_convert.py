"""
Voice Conversion API — convert Suno-generated vocals to user's Kits.AI voice model.

- POST /api/voice-convert/{generation_id}         Start voice conversion
- GET  /api/voice-convert/{generation_id}/status   Check conversion status
- GET  /api/voice-convert/{generation_id}/stream   Stream converted audio
- GET  /api/voice-convert/{generation_id}/download Download converted audio
- GET  /api/kits/voice-models                      List Kits voice models
"""
import asyncio
import logging
import re
from typing import Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(tags=["VoiceConvert"])


# ─── Request Models ─────────────────────────────────────────

class VoiceConvertRequest(BaseModel):
    voice_model_id: int
    conversion_strength: Optional[float] = 0.5
    model_volume_mix: Optional[float] = 0.5
    pitch_shift: Optional[int] = 0


# ─── Background task wrapper ────────────────────────────────

def _run_voice_convert(
    generation_id: str,
    voice_model_id: int,
    conversion_strength: float,
    model_volume_mix: float,
    pitch_shift: int,
):
    """Wrapper to run async voice conversion in background thread with its own event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]

        from ..services.kits_service import convert_voice

        loop.run_until_complete(
            convert_voice(
                generation_id=generation_id,
                voice_model_id=voice_model_id,
                mongo_db=mongo_db,
                conversion_strength=conversion_strength,
                model_volume_mix=model_volume_mix,
                pitch_shift=pitch_shift,
            )
        )
    except Exception as e:
        print(f"Voice conversion error for {generation_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        loop.close()


# ─── Routes ─────────────────────────────────────────────────

@router.post("/api/voice-convert/{generation_id}")
async def start_voice_conversion(
    generation_id: str,
    body: VoiceConvertRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Start voice conversion for a completed generation."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    if not settings.kits_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Kits.AI API 키가 설정되지 않았습니다."},
        )

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") != "completed":
        return JSONResponse(status_code=400, content={"error": "음악 생성이 완료된 후에만 변환할 수 있습니다."})

    # Check if already converting
    vc_status = doc.get("voice_conversion_status")
    if vc_status == "converting" or vc_status == "merging" or vc_status == "uploading":
        return JSONResponse(status_code=409, content={"error": "이미 변환 중입니다."})

    # Reset voice conversion fields
    await mongo.generations.update_one(
        {"_id": ObjectId(generation_id)},
        {"$set": {
            "voice_conversion_status": "pending",
            "voice_conversion_progress": 0,
            "voice_conversion_error": None,
            "voice_model_id": body.voice_model_id,
        }},
    )

    background_tasks.add_task(
        _run_voice_convert,
        generation_id=generation_id,
        voice_model_id=body.voice_model_id,
        conversion_strength=body.conversion_strength or 0.5,
        model_volume_mix=body.model_volume_mix or 0.5,
        pitch_shift=body.pitch_shift or 0,
    )

    return {
        "message": "음성 변환이 시작되었습니다.",
        "generation_id": generation_id,
        "voice_model_id": body.voice_model_id,
    }


@router.get("/api/voice-convert/{generation_id}/status")
async def get_voice_conversion_status(
    generation_id: str,
    current_user=Depends(get_current_user),
):
    """Check voice conversion status for a generation."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    return {
        "generation_id": generation_id,
        "voice_conversion_status": doc.get("voice_conversion_status"),
        "voice_conversion_progress": doc.get("voice_conversion_progress", 0),
        "voice_conversion_error": doc.get("voice_conversion_error"),
        "voice_converted_url": doc.get("voice_converted_url"),
        "voice_model_id": doc.get("voice_model_id"),
    }


@router.get("/api/voice-convert/{generation_id}/stream")
async def stream_voice_converted(
    generation_id: str,
    current_user=Depends(get_current_user),
):
    """Stream the voice-converted audio file."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    vc_url = doc.get("voice_converted_url")
    if not vc_url:
        return JSONResponse(status_code=404, content={"error": "변환된 오디오가 없습니다."})

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=vc_url,
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title_raw = doc.get("title", "voice_converted") or "voice_converted"
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', title_raw.replace(' ', '_')) or "voice_converted"
    encoded_name = quote(f"{title_raw}_vc.mp3")

    return StreamingResponse(
        response,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f"inline; filename=\"{safe_name}_vc.mp3\"; filename*=UTF-8''{encoded_name}",
        },
    )


@router.get("/api/voice-convert/{generation_id}/download")
async def download_voice_converted(
    generation_id: str,
    current_user=Depends(get_current_user),
):
    """Download the voice-converted audio file."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    vc_url = doc.get("voice_converted_url")
    if not vc_url:
        return JSONResponse(status_code=404, content={"error": "변환된 오디오가 없습니다."})

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=vc_url,
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title_raw = doc.get("title", "voice_converted") or "voice_converted"
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', title_raw.replace(' ', '_')) or "voice_converted"
    encoded_name = quote(f"{title_raw}_vc.mp3")

    return StreamingResponse(
        response,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f"attachment; filename=\"{safe_name}_vc.mp3\"; filename*=UTF-8''{encoded_name}",
        },
    )


@router.get("/api/kits/voice-models")
async def list_kits_voice_models(
    current_user=Depends(get_current_user),
):
    """Proxy Kits.AI voice models list."""
    if not settings.kits_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Kits.AI API 키가 설정되지 않았습니다."},
        )

    try:
        from ..services.kits_service import get_voice_models
        models = await get_voice_models()
        return {"voice_models": models}
    except Exception as e:
        logger.error("Failed to fetch Kits voice models: %s", e)
        return JSONResponse(
            status_code=502,
            content={"error": f"Kits API 오류: {str(e)[:200]}"},
        )
