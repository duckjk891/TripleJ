import asyncio
import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload")


class GenerateCoverRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    character_object_name: Optional[str] = None


class GenerateMVRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None  # MinIO object name of cover image

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

    # Load character sheet if requested
    character_image_bytes = None
    if body.character_object_name:
        try:
            minio_client = get_minio()
            response = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=body.character_object_name,
            )
            character_image_bytes = response.read()
            response.close()
            response.release_conn()
        except Exception as e:
            logger.warning("Failed to load character image: %s", e)

    try:
        from ..services.cover_generator import generate_cover_image

        image_bytes = await generate_cover_image(
            title=title,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            character_image_bytes=character_image_bytes,
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


@router.post("/generate-mv")
async def generate_mv(
    body: GenerateMVRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Start AI music video generation using the 20-scene pipeline.

    Creates a background job that:
      1. Splits lyrics into ~20 scenes (ChatGPT)
      2. Generates scene images (Gemini)
      3. Generates scene videos from images (Veo 3.1)
      4. Concatenates all clips into a final video (ffmpeg)

    Returns a job_id for polling via /mv-status/{job_id}.
    """
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

    mongo = get_mongo()

    # Optionally load cover image from MinIO
    cover_image_bytes = None
    if body.cover_object_name:
        try:
            minio_client = get_minio()
            response = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=body.cover_object_name,
            )
            cover_image_bytes = response.read()
            response.close()
            response.release_conn()
        except Exception as e:
            logger.warning("Failed to load cover image: %s", e)

    # Create mv_jobs document
    job_doc = {
        "user_id": current_user["id"],
        "title": title,
        "status": "pending",
        "progress": 0,
        "total_scenes": 0,
        "completed_scenes": 0,
        "scene_thumbnails": [],
        "result_video_url": "",
        "error_message": "",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    result = await mongo.mv_jobs.insert_one(job_doc)
    job_id = result.inserted_id

    # Launch pipeline in background
    from ..services.mv_generator import run_mv_pipeline

    background_tasks.add_task(
        run_mv_pipeline,
        job_id=job_id,
        title=title,
        genre=body.genre,
        mood=body.mood,
        lyrics=body.lyrics,
        cover_image_bytes=cover_image_bytes,
        mongo_db=mongo,
    )

    return {
        "job_id": str(job_id),
        "message": "뮤직비디오 생성이 시작되었습니다. (20장면 파이프라인)",
    }


@router.get("/mv-status/{job_id}")
async def mv_status(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Check music video generation job status."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 작업 ID입니다."},
        )

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})

    if not job:
        return JSONResponse(
            status_code=404,
            content={"error": "작업을 찾을 수 없습니다."},
        )

    # Generate presigned URLs for scene thumbnails
    scene_thumbnail_urls = []
    minio_client = get_minio()
    for thumb_name in (job.get("scene_thumbnails") or []):
        if thumb_name:
            try:
                url = minio_client.presigned_get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=thumb_name,
                    expires=timedelta(hours=24),
                )
                scene_thumbnail_urls.append(url)
            except Exception:
                scene_thumbnail_urls.append("")
        else:
            scene_thumbnail_urls.append("")

    # Generate presigned URL for result video
    result_video_url = ""
    if job.get("result_video_url"):
        try:
            result_video_url = minio_client.presigned_get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=job["result_video_url"],
                expires=timedelta(hours=24),
            )
        except Exception:
            result_video_url = "/api/upload/mv-preview/{}".format(
                job["result_video_url"]
            )

    return {
        "status": job.get("status", "pending"),
        "progress": job.get("progress", 0),
        "total_scenes": job.get("total_scenes", 0),
        "completed_scenes": job.get("completed_scenes", 0),
        "scene_thumbnails": scene_thumbnail_urls,
        "result_video_url": result_video_url,
        "object_name": job.get("result_video_url", ""),
        "error_message": job.get("error_message", ""),
    }


@router.get("/mv-preview/{object_name:path}")
async def mv_preview(object_name: str):
    """Proxy music video or scene thumbnail from MinIO for playback."""
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()

        # Determine content type from extension
        if object_name.endswith(".png"):
            media_type = "image/png"
        elif object_name.endswith(".jpg") or object_name.endswith(".jpeg"):
            media_type = "image/jpeg"
        else:
            media_type = "video/mp4"

        return Response(content=data, media_type=media_type)
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "파일을 찾을 수 없습니다."},
        )
