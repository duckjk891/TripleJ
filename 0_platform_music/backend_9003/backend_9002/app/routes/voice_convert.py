"""
Voice Conversion API — convert Suno-generated vocals to user's Kits.AI voice model.

- POST /api/voice-convert/{generation_id}                        Start voice conversion
- GET  /api/voice-convert/{generation_id}/status                 Check conversion status
- GET  /api/voice-convert/{generation_id}/stream                 Stream converted audio
- GET  /api/voice-convert/{generation_id}/download               Download converted audio
- GET  /api/voice-convert/{generation_id}/converted-vocal/stream Stream converted vocal
- GET  /api/voice-convert/{generation_id}/backing/stream         Stream backing (MR)
- POST /api/voice-convert/{generation_id}/preview-mr             Preview pitch-shifted MR
- POST /api/voice-convert/{generation_id}/merge                  Merge with pitch adjustment
- GET  /api/kits/voice-models                                    List Kits voice models
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
        "voice_converted_vocal_url": doc.get("voice_converted_vocal_url"),
        "voice_converted_backing_url": doc.get("voice_converted_backing_url"),
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


# ─── Converted Vocal / Backing Stream + Merge ─────────────

@router.get("/api/voice-convert/{generation_id}/converted-vocal/stream")
async def stream_converted_vocal(generation_id: str, current_user=Depends(get_current_user)):
    """Stream the converted vocal (before merge)."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    vocal_url = doc.get("voice_converted_vocal_url")
    if not vocal_url:
        return JSONResponse(status_code=404, content={"error": "변환된 보컬을 찾을 수 없습니다."})
    minio_client = get_minio()
    resp = minio_client.get_object(bucket_name=settings.minio_bucket_music, object_name=vocal_url)
    return StreamingResponse(resp, media_type="audio/wav")


@router.get("/api/voice-convert/{generation_id}/backing/stream")
async def stream_backing(generation_id: str, current_user=Depends(get_current_user)):
    """Stream the backing track (MR)."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    backing_url = doc.get("voice_converted_backing_url")
    if not backing_url:
        return JSONResponse(status_code=404, content={"error": "MR을 찾을 수 없습니다."})
    minio_client = get_minio()
    resp = minio_client.get_object(bucket_name=settings.minio_bucket_music, object_name=backing_url)
    return StreamingResponse(resp, media_type="audio/wav")


class PreviewMrRequest(BaseModel):
    pitch_shift: float = 0.0


@router.post("/api/voice-convert/{generation_id}/preview-mr")
async def preview_mr_pitched(
    generation_id: str,
    body: PreviewMrRequest,
    current_user=Depends(get_current_user),
):
    """Generate pitch-shifted MR preview using rubberband (server-side)."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})

    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    backing_url = doc.get("voice_converted_backing_url")
    if not backing_url:
        return JSONResponse(status_code=404, content={"error": "MR 파일을 찾을 수 없습니다."})

    # If pitch_shift is 0, just stream the original
    if body.pitch_shift == 0.0:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=backing_url,
        )
        return StreamingResponse(resp, media_type="audio/wav")

    # Download backing from MinIO
    import tempfile
    import subprocess
    import math
    import io

    minio_client = get_minio()
    resp = minio_client.get_object(
        bucket_name=settings.minio_bucket_music,
        object_name=backing_url,
    )
    backing_bytes = resp.read()
    resp.close()
    resp.release_conn()

    # Apply rubberband pitch shift
    with tempfile.TemporaryDirectory() as tmpdir:
        import os
        input_path = os.path.join(tmpdir, "backing.wav")
        output_path = os.path.join(tmpdir, "pitched.wav")

        with open(input_path, "wb") as f:
            f.write(backing_bytes)

        pitch_ratio = math.pow(2, body.pitch_shift / 12.0)

        # Use ffmpeg rubberband filter
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-af", "rubberband=pitch={}".format(pitch_ratio),
             output_path],
            capture_output=True, text=True, timeout=30,
        )

        if proc.returncode != 0 or not os.path.exists(output_path):
            return JSONResponse(
                status_code=500,
                content={"error": "MR 피치 변환 실패: {}".format(proc.stderr[:200])},
            )

        with open(output_path, "rb") as f:
            result_bytes = f.read()

    return StreamingResponse(
        io.BytesIO(result_bytes),
        media_type="audio/wav",
        headers={"Content-Length": str(len(result_bytes))},
    )


class MergeRequest(BaseModel):
    mr_pitch_shift: Optional[float] = 0.0
    vocal_volume: Optional[float] = 1.0
    mr_volume: Optional[float] = 1.0


@router.post("/api/voice-convert/{generation_id}/merge")
async def merge_voice_conversion(
    generation_id: str,
    body: MergeRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Merge converted vocal + pitch-shifted MR into final audio."""
    if not ObjectId.is_valid(generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(generation_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    vc_status = doc.get("voice_conversion_status")
    if vc_status not in ("awaiting_merge", "completed"):
        return JSONResponse(status_code=400, content={"error": "합치기를 할 수 없는 상태입니다. (현재: {})".format(vc_status)})

    background_tasks.add_task(_run_merge, generation_id, body.mr_pitch_shift, body.vocal_volume, body.mr_volume)
    return {"message": "최종 합치기를 시작합니다.", "generation_id": generation_id}


def _run_merge(generation_id: str, mr_pitch_shift: float, vocal_volume: float, mr_volume: float):
    """Wrapper to run async merge in background thread with its own event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        from ..services.kits_service import merge_vocal_and_backing
        loop.run_until_complete(
            merge_vocal_and_backing(generation_id, mongo_db, mr_pitch_shift, vocal_volume, mr_volume)
        )
    except Exception as e:
        print(f"Merge error for {generation_id}: {e}")
        import traceback; traceback.print_exc()
    finally:
        loop.close()


# ─── Kits Voice Models ────────────────────────────────────

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
