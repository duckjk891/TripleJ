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

from bson import ObjectId
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

# v55: image model enum — Nano Banana Pro (default) / GPT Image 2.
ALLOWED_IMAGE_MODELS = {"nb_pro", "gpt_image_2"}


def _normalize_image_model(raw: Optional[str]) -> Optional[str]:
    """Return validated image_model string, or None if input is invalid.

    Empty/whitespace/None → default ("nb_pro"). Any other unknown value → None
    so the route can return 400.
    """
    if raw is None:
        return "nb_pro"
    v = raw.strip()
    if not v:
        return "nb_pro"
    if v in ALLOWED_IMAGE_MODELS:
        return v
    return None

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
    # Permanent original photo object name (uploaded via /upload-original-photo).
    original_photo_object_name: Optional[str] = None
    # v55: 마지막 사용한 이미지 생성 모델 (frontend 가 generate-sheet/refine 응답에서 받은 값을 그대로 전송).
    image_model: Optional[str] = None


# ── GET /api/character/personality-tags ─────────────────────────────────────


@router.get("/personality-tags")
async def get_personality_tags():
    """Return curated default personality tag list for character setup UI."""
    return {"tags": DEFAULT_PERSONALITY_TAGS}


# ── POST /api/character/upload-original-photo ──────────────────────────────
#
# Separate endpoint for uploading the user's original face photo to a
# *permanent* MinIO location. The /generate-sheet endpoint only writes to
# a /temp/... path that is never linked back to the saved character
# document, so a permanent path is required for re-use across sheet
# regenerations.


@router.post("/upload-original-photo")
async def upload_original_photo(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload original face photo. Saves to MinIO at a permanent path
    (`characters/{user_id}/original.{ext}`) and upserts
    `characters.original_photo_object_name`.
    """
    # Validate ext
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    # Validate size
    contents = await file.read()
    if len(contents) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 파일이 비어 있습니다."},
        )
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"
    user_id = current_user["id"]

    # Permanent path. Extension is preserved from the upload so downstream
    # consumers can sniff content correctly.
    object_name = "characters/{}/original{}".format(user_id, ext)

    minio_client = get_minio()
    try:
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=mime_type,
        )
    except Exception as e:
        logger.warning("upload_original_photo: MinIO put failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 업로드에 실패했습니다."},
        )

    # Upsert characters.original_photo_object_name. We deliberately do NOT
    # require a previously-saved character — the user can upload an original
    # photo before saving the sheet, or re-upload later to replace it.
    mongo = get_mongo()
    await mongo.characters.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "original_photo_object_name": object_name,
                "updated_at": datetime.utcnow(),
            },
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
            },
        },
        upsert=True,
    )

    return {
        "object_name": object_name,
        "message": "원본 사진이 업로드되었습니다.",
    }


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
    image_model: str = Form("nb_pro"),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet.

    Optional outfit images (top_image, bottom_image, shoes_image) can be
    attached to override the corresponding outfit sections in the prompt.
    """
    # v55: image_model 검증 (잘못된 값 → 400, 누락/공백 → "nb_pro").
    norm_image_model = _normalize_image_model(image_model)
    if norm_image_model is None:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 image_model 입니다. (nb_pro, gpt_image_2)"},
        )

    if not settings.google_api_key and norm_image_model == "nb_pro":
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if norm_image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
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

    # v41: LoRA system removed — sheet generation is Nano Banana only.
    user_id = current_user["id"]

    try:
        from ..services.character_generator import generate_character_sheet

        logger.info(
            "generate-sheet: image_model=%s user=%s",
            norm_image_model,
            user_id,
        )
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
            image_model=norm_image_model,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Save original photo to MinIO (temp scratch — the *permanent* original
    # is uploaded separately via /upload-original-photo).
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
        "image_model": norm_image_model,  # v55 — echo back so client can persist
        "message": "캐릭터 시트가 생성되었습니다.",
    }


# ── POST /api/character/refine ─────────────────────────────────────────────


@router.post("/refine")
async def refine_sheet(
    sheet_image: UploadFile = File(...),
    photo: UploadFile = File(...),
    refine_request: str = Form(...),
    image_model: str = Form("nb_pro"),
    current_user=Depends(get_current_user),
):
    """Refine an existing character sheet based on user's modification request."""
    # v55: image_model 검증.
    norm_image_model = _normalize_image_model(image_model)
    if norm_image_model is None:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 image_model 입니다. (nb_pro, gpt_image_2)"},
        )
    if norm_image_model == "nb_pro" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if norm_image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
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
            image_model=norm_image_model,
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
        "image_model": norm_image_model,  # v55
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

    set_fields = {
        "user_id": user_id,
        "sheet_object_name": permanent_object,
        "used_items": used_items_data,
        "name": name_val,
        "age": age_val,
        "personality_tags": personality_tags_val,
        "personality_text": personality_text_val,
        "updated_at": datetime.utcnow(),
    }
    # v40-3: only persist original_photo_object_name when the client supplied
    # one (else leave any existing value intact — the original photo upload
    # endpoint may have already set it).
    if body.original_photo_object_name:
        set_fields["original_photo_object_name"] = body.original_photo_object_name

    # v55: image_model 영속화. 유효한 enum 만 저장, 잘못된 값은 무시(기존값 유지).
    if body.image_model:
        _norm = _normalize_image_model(body.image_model)
        if _norm:
            set_fields["image_model"] = _norm

    await mongo.characters.update_one(
        {"user_id": user_id},
        {
            "$set": set_fields,
            "$setOnInsert": {
                "created_at": datetime.utcnow(),
            },
        },
        upsert=True,
    )

    # Re-read so we can return the (possibly previously-set) original photo
    # object name to the client.
    saved = await mongo.characters.find_one({"user_id": user_id}) or {}

    return {
        "sheet_object_name": permanent_object,
        "name": name_val,
        "age": age_val,
        "personality_tags": personality_tags_val,
        "personality_text": personality_text_val,
        "original_photo_object_name": saved.get("original_photo_object_name") or "",
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

    sheet_url = None
    if char.get("sheet_object_name"):
        sheet_url = "/api/character/preview/{}".format(char["sheet_object_name"])

    return {
        "character": {
            "sheet_object_name": char.get("sheet_object_name"),
            "sheet_url": sheet_url,
            "used_items": char.get("used_items", []),
            "name": char.get("name") or "",
            "age": char.get("age") or "",
            "personality_tags": char.get("personality_tags") or [],
            "personality_text": char.get("personality_text") or "",
            # original photo object name (preserved for compatibility)
            "original_photo_object_name": char.get("original_photo_object_name") or "",
            # v55: 마지막 사용한 이미지 생성 모델. 옛 도큐먼트는 기본 "nb_pro".
            "image_model": char.get("image_model") or "nb_pro",
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


# ── v42: User Location Library (CRUD) ───────────────────────────────────────
#
# 사용자가 등록한 실제 장소 사진을 라이브러리에 보관하고, 커버/MV 생성 시
# Mode B 앵커로 사용한다. Mongo 컬렉션: `character_locations`.
# MinIO 경로: `characters/{user_id}/locations/{loc_id_hex}{ext}`.

LOCATION_NAME_MAX_LEN = 50


async def _load_user_location(mongo, user_id: str, location_id: str) -> Optional[dict]:
    """Load a location document owned by `user_id` and return its bytes + meta.

    Returns dict {name, object_name, image_bytes} on success, or None when
    the id is invalid, the document does not exist, or it belongs to another
    user. Used by upload.py / mv.py to wire user locations into cover and MV
    generation.
    """
    if not location_id or not ObjectId.is_valid(location_id):
        return None
    oid = ObjectId(location_id)
    doc = await mongo.character_locations.find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return None
    object_name = doc.get("object_name")
    if not object_name:
        return None
    image_bytes = None
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        image_bytes = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:
        logger.warning("_load_user_location: MinIO read failed for %s: %s", object_name, e)
        return None
    return {
        "name": doc.get("name") or "",
        "object_name": object_name,
        "image_bytes": image_bytes,
    }


@router.post("/locations")
async def create_user_location(
    file: UploadFile = File(...),
    name: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Upload a real-world location photo to the user's location library."""
    name_val = (name or "").strip()
    if not name_val:
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름을 입력해주세요."},
        )
    if len(name_val) > LOCATION_NAME_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름은 {}자 이하여야 합니다.".format(LOCATION_NAME_MAX_LEN)},
        )

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    contents = await file.read()
    if len(contents) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 파일이 비어 있습니다."},
        )
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"
    user_id = current_user["id"]

    oid = ObjectId()
    loc_id_hex = str(oid)
    object_name = "characters/{}/locations/{}{}".format(user_id, loc_id_hex, ext)

    minio_client = get_minio()
    try:
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=mime_type,
        )
    except Exception as e:
        logger.warning("create_user_location: MinIO put failed: %s", e)
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 업로드에 실패했습니다."},
        )

    mongo = get_mongo()
    now = datetime.utcnow()
    await mongo.character_locations.insert_one({
        "_id": oid,
        "user_id": user_id,
        "name": name_val,
        "object_name": object_name,
        "created_at": now,
    })

    return {
        "id": loc_id_hex,
        "name": name_val,
        "object_name": object_name,
        "preview_url": "/api/character/preview/{}".format(object_name),
    }


@router.get("/locations")
async def list_user_locations(
    current_user=Depends(get_current_user),
):
    """Return the current user's saved location library, newest first."""
    mongo = get_mongo()
    user_id = current_user["id"]
    cursor = mongo.character_locations.find({"user_id": user_id}).sort(
        [("created_at", -1)]
    )
    items = []
    async for doc in cursor:
        object_name = doc.get("object_name") or ""
        created_at = doc.get("created_at")
        items.append({
            "id": str(doc.get("_id")),
            "name": doc.get("name") or "",
            "object_name": object_name,
            "preview_url": "/api/character/preview/{}".format(object_name) if object_name else None,
            "created_at": created_at.isoformat() if created_at else None,
        })
    return {"locations": items}


@router.delete("/locations/{location_id}")
async def delete_user_location(
    location_id: str,
    current_user=Depends(get_current_user),
):
    """Delete a saved location (own only — others' ids return 404)."""
    if not ObjectId.is_valid(location_id):
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 장소 ID입니다."},
        )
    oid = ObjectId(location_id)
    mongo = get_mongo()
    user_id = current_user["id"]
    doc = await mongo.character_locations.find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "장소를 찾을 수 없습니다."},
        )

    # Best-effort MinIO removal (do not fail the request if MinIO is unhappy).
    object_name = doc.get("object_name")
    if object_name:
        try:
            minio_client = get_minio()
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images,
                object_name=object_name,
            )
        except Exception as e:
            logger.warning(
                "delete_user_location: MinIO remove failed for %s: %s",
                object_name, e,
            )

    await mongo.character_locations.delete_one({"_id": oid, "user_id": user_id})
    return {"message": "장소가 삭제되었습니다."}
