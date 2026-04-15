import asyncio
import io
import logging
import os
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vocal-repair")

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB


class EnhanceRequest(BaseModel):
    method: str = "both"  # "lalal", "demucs", "both"


@router.post("/upload")
async def upload_voice(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload a voice recording for vocal repair."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(status_code=400, content={"error": "허용되지 않는 오디오 형식입니다."})

    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB 이하여야 합니다."})

    user_id = current_user["id"]
    doc_id = str(uuid_lib.uuid4())
    object_name = "vocal-repair/{}/{}/original{}".format(user_id, doc_id, ext)

    # Save to MinIO
    minio_client = get_minio()
    import mimetypes
    mime_type = mimetypes.guess_type(file.filename or "")[0] or "audio/wav"
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=mime_type,
    )

    # Save metadata to MongoDB
    mongo_db = get_mongo()
    doc = {
        "_id": doc_id,
        "user_id": user_id,
        "original_object": object_name,
        "original_filename": file.filename,
        "original_ext": ext,
        "enhanced_lalal_object": None,
        "enhanced_demucs_object": None,
        "status": "uploaded",  # uploaded -> enhancing -> completed -> failed
        "progress": 0,
        "created_at": datetime.now(timezone.utc),
    }
    await mongo_db.vocal_repairs.insert_one(doc)

    return {"id": doc_id, "message": "업로드 완료", "status": "uploaded"}


@router.post("/{repair_id}/enhance")
async def start_enhance(
    repair_id: str,
    body: EnhanceRequest = EnhanceRequest(),
    current_user=Depends(get_current_user),
):
    """Start vocal enhancement using LALAL.AI, Demucs, or both."""
    if body.method not in ("lalal", "demucs", "both"):
        return JSONResponse(status_code=400, content={"error": "method는 lalal, demucs, both 중 하나여야 합니다."})

    if body.method in ("lalal", "both") and not settings.lalal_api_key:
        return JSONResponse(status_code=503, content={"error": "LALAL.AI API 키가 설정되지 않았습니다."})

    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})

    if doc["status"] == "enhancing":
        return JSONResponse(status_code=409, content={"error": "이미 처리 중입니다."})

    # Update status
    await mongo_db.vocal_repairs.update_one(
        {"_id": repair_id},
        {"$set": {"status": "enhancing", "progress": 5}},
    )

    # Run in background
    asyncio.create_task(_run_enhance(repair_id, doc, mongo_db, body.method))

    return {"message": "보컬 다듬기를 시작합니다.", "status": "enhancing", "method": body.method}


async def _run_enhance(repair_id: str, doc: dict, mongo_db, method: str):
    """Background task for vocal enhancement pipeline."""
    try:
        from ..services.audio_utils import normalize_audio, compress_audio

        # Download original from MinIO
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["original_object"],
        )
        audio_bytes = resp.read()
        resp.close()
        resp.release_conn()

        # Step 1: Normalize
        await mongo_db.vocal_repairs.update_one(
            {"_id": repair_id},
            {"$set": {"progress": 5, "status_detail": "노멀라이즈 중..."}},
        )
        file_name = "voice_{}.wav".format(repair_id[:8])
        normalized = normalize_audio(audio_bytes, doc.get("original_filename", file_name))

        await mongo_db.vocal_repairs.update_one(
            {"_id": repair_id},
            {"$set": {"progress": 15}},
        )

        results = {}

        # Step 2a: LALAL.AI
        if method in ("lalal", "both"):
            try:
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"status_detail": "LALAL.AI 처리 중...", "lalal_status": "processing"}},
                )
                from ..services.lalal_service import enhance_vocal_lalal
                lalal_result = await enhance_vocal_lalal(normalized, file_name)

                # Compress
                lalal_compressed = compress_audio(lalal_result, "lalal_output.wav")

                # Save to MinIO
                lalal_object = "vocal-repair/{}/{}/enhanced_lalal.wav".format(doc["user_id"], repair_id)
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=lalal_object,
                    data=io.BytesIO(lalal_compressed),
                    length=len(lalal_compressed),
                    content_type="audio/wav",
                )
                results["lalal"] = lalal_object
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"enhanced_lalal_object": lalal_object, "lalal_status": "completed"}},
                )
            except Exception as e:
                logger.error("LALAL.AI failed: %s", e)
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"lalal_status": "failed", "lalal_error": str(e)[:300]}},
                )

        # Step 2b: Demucs
        if method in ("demucs", "both"):
            try:
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"status_detail": "Demucs 처리 중...", "demucs_status": "processing"}},
                )
                from ..services.demucs_service import enhance_vocal_demucs
                demucs_result = await enhance_vocal_demucs(normalized, file_name)

                # Compress
                demucs_compressed = compress_audio(demucs_result, "demucs_output.wav")

                # Save to MinIO
                demucs_object = "vocal-repair/{}/{}/enhanced_demucs.wav".format(doc["user_id"], repair_id)
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=demucs_object,
                    data=io.BytesIO(demucs_compressed),
                    length=len(demucs_compressed),
                    content_type="audio/wav",
                )
                results["demucs"] = demucs_object
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"enhanced_demucs_object": demucs_object, "demucs_status": "completed"}},
                )
            except Exception as e:
                logger.error("Demucs failed: %s", e)
                await mongo_db.vocal_repairs.update_one(
                    {"_id": repair_id},
                    {"$set": {"demucs_status": "failed", "demucs_error": str(e)[:300]}},
                )

        # Final status
        overall_status = "completed" if results else "failed"
        await mongo_db.vocal_repairs.update_one(
            {"_id": repair_id},
            {"$set": {
                "status": overall_status,
                "progress": 100,
                "status_detail": "완료",
                "completed_at": datetime.now(timezone.utc),
            }},
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        await mongo_db.vocal_repairs.update_one(
            {"_id": repair_id},
            {"$set": {
                "status": "failed",
                "progress": 0,
                "error_message": str(e)[:500],
            }},
        )


@router.get("/{repair_id}/status")
async def get_status(
    repair_id: str,
    current_user=Depends(get_current_user),
):
    """Get vocal repair status."""
    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})

    return {
        "id": repair_id,
        "status": doc["status"],
        "progress": doc.get("progress", 0),
        "status_detail": doc.get("status_detail"),
        "lalal_status": doc.get("lalal_status"),
        "demucs_status": doc.get("demucs_status"),
        "lalal_error": doc.get("lalal_error"),
        "demucs_error": doc.get("demucs_error"),
        "error_message": doc.get("error_message"),
    }


def _stream_from_minio(object_name: str, content_type: str = "audio/wav", as_attachment: bool = False, filename: str = None):
    """Helper to stream file from MinIO."""
    minio_client = get_minio()
    resp = minio_client.get_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
    )
    headers = {}
    if as_attachment and filename:
        headers["Content-Disposition"] = 'attachment; filename="{}"'.format(filename)
    return StreamingResponse(resp, media_type=content_type, headers=headers)


@router.get("/{repair_id}/original/stream")
async def stream_original(repair_id: str, current_user=Depends(get_current_user)):
    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc or not doc.get("original_object"):
        return JSONResponse(status_code=404, content={"error": "원본 파일을 찾을 수 없습니다."})
    import mimetypes
    mime = mimetypes.guess_type(doc["original_object"])[0] or "audio/wav"
    return _stream_from_minio(doc["original_object"], mime)


@router.get("/{repair_id}/enhanced/stream")
async def stream_enhanced(repair_id: str, method: str = "demucs", current_user=Depends(get_current_user)):
    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})

    object_key = "enhanced_lalal_object" if method == "lalal" else "enhanced_demucs_object"
    obj = doc.get(object_key)
    if not obj:
        return JSONResponse(status_code=404, content={"error": "{} 결과를 찾을 수 없습니다.".format(method)})
    return _stream_from_minio(obj, "audio/wav")


@router.get("/{repair_id}/original/download")
async def download_original(repair_id: str, current_user=Depends(get_current_user)):
    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc or not doc.get("original_object"):
        return JSONResponse(status_code=404, content={"error": "원본 파일을 찾을 수 없습니다."})
    import mimetypes
    mime = mimetypes.guess_type(doc["original_object"])[0] or "audio/wav"
    filename = doc.get("original_filename") or "original{}".format(doc.get("original_ext", ".wav"))
    return _stream_from_minio(doc["original_object"], mime, as_attachment=True, filename=filename)


@router.get("/{repair_id}/enhanced/download")
async def download_enhanced(repair_id: str, method: str = "demucs", current_user=Depends(get_current_user)):
    mongo_db = get_mongo()
    doc = await mongo_db.vocal_repairs.find_one({"_id": repair_id, "user_id": current_user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})

    object_key = "enhanced_lalal_object" if method == "lalal" else "enhanced_demucs_object"
    obj = doc.get(object_key)
    if not obj:
        return JSONResponse(status_code=404, content={"error": "{} 결과를 찾을 수 없습니다.".format(method)})
    filename = "enhanced_{}_{}.wav".format(method, repair_id[:8])
    return _stream_from_minio(obj, "audio/wav", as_attachment=True, filename=filename)


@router.get("/list")
async def list_repairs(current_user=Depends(get_current_user)):
    """List user's vocal repairs."""
    mongo_db = get_mongo()
    cursor = mongo_db.vocal_repairs.find(
        {"user_id": current_user["id"]},
        sort=[("created_at", -1)],
    ).limit(20)
    repairs = []
    async for doc in cursor:
        repairs.append({
            "id": doc["_id"],
            "status": doc["status"],
            "progress": doc.get("progress", 0),
            "original_filename": doc.get("original_filename"),
            "lalal_status": doc.get("lalal_status"),
            "demucs_status": doc.get("demucs_status"),
            "created_at": doc.get("created_at"),
        })
    return {"repairs": repairs}
