import io
import mimetypes
import os
import uuid as uuid_lib
from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/upload")

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/image", status_code=201)
async def upload_image(
    file: UploadFile = File(...),
    type: str = Form(...),        # "cover" (track cover) or "profile" (user profile)
    id: str = Form(...),          # track_id (ObjectId string) or user_id (UUID string)
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    if type not in ("cover", "profile"):
        return JSONResponse(status_code=400, content={"error": "type은 'cover' 또는 'profile'이어야 합니다."})

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 이미지 형식입니다. ({', '.join(ALLOWED_IMAGE_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."})

    minio_client = get_minio()
    content_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    if type == "cover":
        # Track cover image -> stored in images bucket
        if not ObjectId.is_valid(id):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

        object_name = f"covers/{current_user['id']}/{id}{ext}"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )

        # Update MongoDB track's cover_image_url
        mongo = get_mongo()
        await mongo.tracks.update_one(
            {"_id": ObjectId(id)},
            {"$set": {"cover_image_url": object_name}},
        )

        # Return presigned URL for immediate display
        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
        return {"file_url": url, "object_name": object_name}

    else:
        # Profile image -> update PostgreSQL users.profile_image
        object_name = f"profiles/{current_user['id']}{ext}"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )

        user_uuid = uuid_lib.UUID(current_user["id"])
        await conn.execute(
            "UPDATE users SET profile_image = $1 WHERE id = $2",
            object_name, user_uuid,
        )

        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
        return {"file_url": url, "object_name": object_name}


@router.get("/presigned-url")
async def get_presigned_url(
    bucket: str = "images",
    object_name: str = "",
    current_user=Depends(get_current_user),
):
    """Get a presigned URL for an object in MinIO."""
    if not object_name:
        return JSONResponse(status_code=400, content={"error": "object_name은 필수입니다."})

    minio_client = get_minio()
    bucket_name = settings.minio_bucket_images if bucket == "images" else settings.minio_bucket_music

    try:
        url = minio_client.presigned_get_object(
            bucket_name=bucket_name,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})

    return {"url": url}
