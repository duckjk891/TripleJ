"""
Character API routes — generate, save, retrieve, delete user's AI character sheet.
"""

import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/character", tags=["Character"])

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


class SaveCharacterRequest(BaseModel):
    sheet_object_name: str


# ── POST /api/character/generate-sheet ──────────────────────────────────────


@router.post("/generate-sheet")
async def generate_sheet(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet."""
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    # Validate file
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Generate character sheet
    try:
        from ..services.character_generator import generate_character_sheet

        sheet_bytes = await generate_character_sheet(
            photo_bytes=contents,
            mime_type=mime_type,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Save original photo to MinIO
    user_id = current_user["id"]
    original_object = "characters/temp/{}/original_{}{}".format(
        user_id, uuid_lib.uuid4().hex[:8], ext
    )
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=original_object,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=mime_type,
    )

    # Save generated sheet to MinIO (temp location)
    sheet_object = "characters/temp/{}/{}.png".format(
        user_id, uuid_lib.uuid4().hex
    )
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=sheet_object,
        data=io.BytesIO(sheet_bytes),
        length=len(sheet_bytes),
        content_type="image/png",
    )

    # Build preview URL
    preview_url = "/api/character/preview/{}".format(sheet_object)

    return {
        "object_name": sheet_object,
        "original_object_name": original_object,
        "preview_url": preview_url,
        "message": "캐릭터 시트가 생성되었습니다.",
    }


# ── POST /api/character/save ────────────────────────────────────────────────


@router.post("/save")
async def save_character(
    body: SaveCharacterRequest,
    current_user=Depends(get_current_user),
):
    """Save generated character sheet as the user's character."""
    user_id = current_user["id"]
    minio_client = get_minio()
    mongo = get_mongo()

    # Verify the temp sheet exists in MinIO
    try:
        stat = minio_client.stat_object(
            bucket_name=settings.minio_bucket_images,
            object_name=body.sheet_object_name,
        )
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "캐릭터 시트 이미지를 찾을 수 없습니다."},
        )

    # Copy to permanent location
    permanent_object = "characters/{}/sheet.png".format(user_id)

    # Download from temp and re-upload to permanent (MinIO copy)
    try:
        from minio.commonconfig import CopySource

        minio_client.copy_object(
            bucket_name=settings.minio_bucket_images,
            object_name=permanent_object,
            source=CopySource(
                bucket_name=settings.minio_bucket_images,
                object_name=body.sheet_object_name,
            ),
        )
    except Exception as e:
        logger.warning("MinIO copy failed, fallback to download+upload: %s", e)
        # Fallback: download and re-upload
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=body.sheet_object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=permanent_object,
            data=io.BytesIO(data),
            length=len(data),
            content_type="image/png",
        )

    # Upsert in MongoDB
    await mongo.characters.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "sheet_object_name": permanent_object,
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
            },
        },
        upsert=True,
    )

    return {
        "sheet_object_name": permanent_object,
        "message": "캐릭터가 저장되었습니다.",
    }


# ── GET /api/character/me ───────────────────────────────────────────────────


@router.get("/me")
async def get_my_character(
    current_user=Depends(get_current_user),
):
    """Get current user's saved character."""
    mongo = get_mongo()
    char = await mongo.characters.find_one({"user_id": current_user["id"]})

    if not char:
        return {"character": None}

    # Generate presigned URL
    sheet_url = None
    if char.get("sheet_object_name"):
        try:
            minio_client = get_minio()
            sheet_url = minio_client.presigned_get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=char["sheet_object_name"],
                expires=timedelta(hours=24),
            )
        except Exception:
            sheet_url = "/api/character/preview/{}".format(
                char["sheet_object_name"]
            )

    return {
        "character": {
            "sheet_object_name": char.get("sheet_object_name"),
            "sheet_url": sheet_url,
            "created_at": char.get("created_at", "").isoformat() if char.get("created_at") else None,
            "updated_at": char.get("updated_at", "").isoformat() if char.get("updated_at") else None,
        }
    }


# ── DELETE /api/character/me ────────────────────────────────────────────────


@router.delete("/me")
async def delete_my_character(
    current_user=Depends(get_current_user),
):
    """Delete current user's character."""
    user_id = current_user["id"]
    mongo = get_mongo()
    minio_client = get_minio()

    # Delete from MongoDB
    result = await mongo.characters.delete_one({"user_id": user_id})

    # Delete MinIO objects under characters/{user_id}/
    prefix = "characters/{}/".format(user_id)
    try:
        objects = minio_client.list_objects(
            bucket_name=settings.minio_bucket_images,
            prefix=prefix,
            recursive=True,
        )
        from minio.deleteobjects import DeleteObject

        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        if delete_list:
            errors = minio_client.remove_objects(
                bucket_name=settings.minio_bucket_images,
                delete_object_list=delete_list,
            )
            for err in errors:
                logger.warning("Failed to delete MinIO object: %s", err)
    except Exception as e:
        logger.warning("Failed to clean up MinIO objects for character: %s", e)

    return {"message": "캐릭터가 삭제되었습니다."}


# ── GET /api/character/preview/{object_name:path} ───────────────────────────


@router.get("/preview/{object_name:path}")
async def character_preview(object_name: str):
    """Proxy character sheet image from MinIO for external access."""
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
