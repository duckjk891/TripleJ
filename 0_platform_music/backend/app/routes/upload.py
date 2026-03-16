import io
import mimetypes
import os
import uuid as uuid_lib
from datetime import timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/upload")


class GenerateCoverRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None

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


@router.post("/generate-cover")
async def generate_cover(
    body: GenerateCoverRequest,
    current_user=Depends(get_current_user),
):
    """Generate AI cover image using Google Gemini."""
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    title = body.title.strip()
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "곡 제목을 입력해주세요."},
        )

    try:
        from ..services.cover_generator import generate_cover_image

        image_bytes = await generate_cover_image(
            title=title,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
        )

        # Save to MinIO
        object_name = "covers/generated/{}/{}.png".format(
            current_user["id"], uuid_lib.uuid4().hex
        )

        minio_client = get_minio()
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type="image/png",
        )

        return {
            "image_url": "/api/upload/cover-preview/{}".format(object_name),
            "object_name": object_name,
            "message": "커버 이미지가 생성되었습니다.",
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "커버 생성 실패: {}".format(str(e)[:200])},
        )


@router.get("/cover-preview/{object_name:path}")
async def cover_preview(object_name: str):
    """Proxy cover image from MinIO for external access."""
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return Response(content=data, media_type="image/png")
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )
