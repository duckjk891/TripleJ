"""
Asset upload route — POST /api/assets/upload
Real MinIO put_object (no LLM/processing). Bucket selected by `kind`.
"""

import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio

router = APIRouter(prefix="/api/assets")

KIND_TO_BUCKET = {
    "photo": settings.minio_bucket_photos,
    "audio": settings.minio_bucket_audio,
    "video": settings.minio_bucket_videos,
}


@router.post("/upload")
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form(...),
    current_user=Depends(get_current_user),
):
    if kind not in KIND_TO_BUCKET:
        raise HTTPException(
            status_code=400,
            detail="kind는 photo, audio, video 중 하나여야 합니다.",
        )

    bucket = KIND_TO_BUCKET[kind]
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일은 업로드할 수 없습니다.")

    safe_name = file.filename or "asset"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    object_name = f"{current_user['id']}/{timestamp}_{uuid.uuid4().hex[:8]}_{safe_name}"

    minio_client = get_minio()
    try:
        minio_client.put_object(
            bucket_name=bucket,
            object_name=object_name,
            data=io.BytesIO(data),
            length=len(data),
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MinIO 업로드 실패: {e}")

    return {
        "object_name": object_name,
        "bucket": bucket,
        "kind": kind,
        "size": len(data),
        "content_type": file.content_type,
    }
