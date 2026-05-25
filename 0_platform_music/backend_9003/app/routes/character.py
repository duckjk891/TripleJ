"""
Character API routes — generate, save, retrieve, delete user's AI character sheet.
"""

import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
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

DEFAULT_PERSONALITY_TAGS = [
    "내향적", "외향적", "감성적", "이성적", "유머러스", "진지함",
    "쿨함", "따뜻함", "반항적", "순수함", "냉소적", "낙천적",
]

NAME_MAX_LEN = 50
AGE_MAX_LEN = 30
PERSONALITY_TEXT_MAX_LEN = 500
PERSONALITY_TAG_MAX_LEN = 20
PERSONALITY_TAGS_MAX_COUNT = 20


class UsedItemPayload(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    image_object_name: Optional[str] = None
    product_url: Optional[str] = None
    category: Optional[str] = None  # "상의" | "하의" | "신발"


class SaveCharacterRequest(BaseModel):
    sheet_object_name: str
    used_items: Optional[List[UsedItemPayload]] = None
    name: Optional[str] = None
    age: Optional[str] = None
    personality_tags: Optional[List[str]] = None
    personality_text: Optional[str] = None


# ── GET /api/character/personality-tags ─────────────────────────────────────


@router.get("/personality-tags")
async def get_personality_tags():
    """Return curated default personality tag list for character setup UI."""
    return {"tags": DEFAULT_PERSONALITY_TAGS}


# ── POST /api/character/generate-sheet ──────────────────────────────────────


async def _read_optional_image(upload: Optional[UploadFile]) -> tuple:
    """Read an optional UploadFile and return (bytes, mime_type) or (None, None)."""
    if upload is None or upload.filename is None or upload.filename == "":
        return None, None
    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return None, None
    data = await upload.read()
    if len(data) > MAX_IMAGE_SIZE or len(data) == 0:
        return None, None
    mime = mimetypes.guess_type(upload.filename)[0] or "image/jpeg"
    return data, mime


@router.post("/generate-sheet")
async def generate_sheet(
    file: UploadFile = File(...),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    user_text: str = Form(""),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet.

    Optional outfit images (top_image, bottom_image, shoes_image) can be
    attached to override the corresponding outfit sections in the prompt.
    """
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

    # Read optional outfit images
    top_bytes, top_mime = await _read_optional_image(top_image)
    bottom_bytes, bottom_mime = await _read_optional_image(bottom_image)
    shoes_bytes, shoes_mime = await _read_optional_image(shoes_image)

    # Generate character sheet
    try:
        from ..services.character_generator import generate_character_sheet

        sheet_bytes = await generate_character_sheet(
            photo_bytes=contents,
            mime_type=mime_type,
            top_bytes=top_bytes,
            top_mime=top_mime,
            bottom_bytes=bottom_bytes,
            bottom_mime=bottom_mime,
            shoes_bytes=shoes_bytes,
            shoes_mime=shoes_mime,
            user_text=user_text.strip(),
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


# ── POST /api/character/refine ─────────────────────────────────────────────


@router.post("/refine")
async def refine_sheet(
    sheet_image: UploadFile = File(...),
    photo: UploadFile = File(...),
    refine_request: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Refine an existing character sheet based on user's modification request."""
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    # Read sheet image
    sheet_bytes = await sheet_image.read()
    if len(sheet_bytes) > MAX_IMAGE_SIZE or len(sheet_bytes) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "캐릭터 시트 이미지가 유효하지 않습니다."},
        )

    # Read original photo
    photo_ext = os.path.splitext(photo.filename or "")[1].lower()
    if photo_ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    photo_bytes = await photo.read()
    if len(photo_bytes) > MAX_IMAGE_SIZE or len(photo_bytes) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "사진 이미지가 유효하지 않습니다."},
        )
    photo_mime = mimetypes.guess_type(photo.filename or "")[0] or "image/jpeg"

    if not refine_request.strip():
        return JSONResponse(
            status_code=400,
            content={"error": "수정 요청 내용을 입력해주세요."},
        )

    # Call refine service
    try:
        from ..services.character_generator import refine_character_sheet

        refined_bytes = await refine_character_sheet(
            current_sheet_bytes=sheet_bytes,
            photo_bytes=photo_bytes,
            photo_mime=photo_mime,
            refine_request=refine_request.strip(),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 수정 실패: {}".format(str(e)[:200])},
        )

    # Save refined sheet to MinIO (temp location)
    user_id = current_user["id"]
    sheet_object = "characters/temp/{}/{}.png".format(
        user_id, uuid_lib.uuid4().hex
    )
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=sheet_object,
        data=io.BytesIO(refined_bytes),
        length=len(refined_bytes),
        content_type="image/png",
    )

    preview_url = "/api/character/preview/{}".format(sheet_object)

    return {
        "object_name": sheet_object,
        "preview_url": preview_url,
        "message": "캐릭터 시트가 수정되었습니다.",
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

    name_val = (body.name or "").strip()
    age_val = (body.age or "").strip()
    personality_text_val = (body.personality_text or "").strip()
    raw_tags = body.personality_tags or []
    personality_tags_val = [t.strip() for t in raw_tags if isinstance(t, str) and t.strip()]

    if len(name_val) > NAME_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "이름은 {}자 이하여야 합니다.".format(NAME_MAX_LEN)},
        )
    if len(age_val) > AGE_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "나이는 {}자 이하여야 합니다.".format(AGE_MAX_LEN)},
        )
    if len(personality_text_val) > PERSONALITY_TEXT_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "성격 설명은 {}자 이하여야 합니다.".format(PERSONALITY_TEXT_MAX_LEN)},
        )
    if len(personality_tags_val) > PERSONALITY_TAGS_MAX_COUNT:
        return JSONResponse(
            status_code=400,
            content={"error": "성격 태그는 최대 {}개까지 선택할 수 있습니다.".format(PERSONALITY_TAGS_MAX_COUNT)},
        )
    for tag in personality_tags_val:
        if len(tag) > PERSONALITY_TAG_MAX_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": "각 성격 태그는 {}자 이하여야 합니다.".format(PERSONALITY_TAG_MAX_LEN)},
            )

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
    used_items_data = [item.model_dump() for item in (body.used_items or [])]

    await mongo.characters.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "sheet_object_name": permanent_object,
                "used_items": used_items_data,
                "name": name_val,
                "age": age_val,
                "personality_tags": personality_tags_val,
                "personality_text": personality_text_val,
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
        "name": name_val,
        "age": age_val,
        "personality_tags": personality_tags_val,
        "personality_text": personality_text_val,
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
            "used_items": char.get("used_items", []),
            "name": char.get("name") or "",
            "age": char.get("age") or "",
            "personality_tags": char.get("personality_tags") or [],
            "personality_text": char.get("personality_text") or "",
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
