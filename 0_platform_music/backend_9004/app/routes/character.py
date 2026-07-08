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
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.points_service import refund_points, spend_points

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/character", tags=["Character"])

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB

# 캐릭터 시트 생성 비용 (실사/가상, 동기/비동기 공통). 요청 시 선차감,
# 생성 실패 시 환불. 잔액 부족이면 402 로 차단.
CHARACTER_POINT_COST = 2
INSUFFICIENT_POINTS_RESPONSE = {
    "error": "포인트가 부족합니다 (필요: {})".format(CHARACTER_POINT_COST)
}

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


# ── Cartoon (가상화) art-style presets ──────────────────────────────────────
#
# 번들 샘플 화풍 reference 이미지 3종. 사용자가 직접 이미지를 업로드하지 않은 경우
# style_preset 으로 이 중 하나를 골라 reference 로 사용한다.
# 실제 저작권 안전 이미지는 infra/style_samples/ 에서 교체 (README 참고).
STYLE_PRESETS = {
    "webtoon": {"label": "웹툰", "art_style_label": "Korean webtoon style", "file": "webtoon.png"},
    "anime": {"label": "애니", "art_style_label": "Japanese anime style", "file": "anime.png"},
    "manga90": {"label": "90년대 만화", "art_style_label": "1990s retro manga style", "file": "manga90.png"},
}

# infra/style_samples/ — character.py 는 app/routes/ 이므로 두 단계 위가 9005 루트.
STYLE_SAMPLES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "infra",
    "style_samples",
)

# 사용자 업로드 화풍일 때 art_style_label.
UPLOADED_STYLE_LABEL = "the art style of the attached style reference image"


def _load_style_preset_bytes(key: str) -> Optional[bytes]:
    """Read a bundled style-sample PNG by preset key, or None if missing."""
    preset = STYLE_PRESETS.get(key)
    if not preset:
        return None
    path = os.path.join(STYLE_SAMPLES_DIR, preset["file"])
    try:
        with open(path, "rb") as f:
            return f.read()
    except Exception as e:
        logger.warning("_load_style_preset_bytes: read failed for %s: %s", key, e)
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
    # 가상화(그림/만화 화풍) 저장 분리: 'real'(기본, 실사 슬롯) | 'virtual'(가상화 슬롯).
    # virtual 이면 sheet_virtual.png 로 저장하고 virtual_* 필드만 갱신(실사 슬롯 무손상).
    variant: Optional[str] = None
    # virtual 저장 시 사용된 화풍 라벨(예: "Korean webtoon style"). real 이면 무시.
    art_style: Optional[str] = None


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


def _load_item_image(object_name: Optional[str]) -> tuple:
    """Load an ad-product item image from MinIO by object_name.

    Used to wire the user's *selected* outfit/footwear product (top/bottom/shoes)
    — stored at `image_object_name` in the images bucket — into character sheet
    generation so the chosen item is actually worn.

    Returns (bytes, mime_type) on success, or (None, None) on any failure
    (missing key, MinIO error, empty/oversized object) — never raises, so the
    request keeps going with that item simply un-referenced.
    """
    name = (object_name or "").strip()
    if not name:
        return None, None
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=name,
        )
        data = resp.read()
        content_type = None
        try:
            content_type = (resp.headers or {}).get("Content-Type")
        except Exception:
            content_type = None
        resp.close()
        resp.release_conn()
    except Exception as e:
        logger.warning("_load_item_image: MinIO read failed for %s: %s", name[:80], e)
        return None, None
    if not data or len(data) == 0 or len(data) > MAX_IMAGE_SIZE:
        logger.warning("_load_item_image: invalid size for %s (%d bytes)", name[:80], len(data or b""))
        return None, None
    mime = content_type or mimetypes.guess_type(name)[0] or "image/jpeg"
    return data, mime


async def _resolve_item_image(
    object_name: Optional[str],
    upload: Optional[UploadFile],
) -> tuple:
    """Resolve an outfit item image: ad-product object_name takes priority,
    then a direct UploadFile. Returns (bytes, mime, source) where source is
    "object_name" | "upload" | None."""
    name = (object_name or "").strip()
    if name:
        data, mime = _load_item_image(name)
        if data:
            return data, mime, "object_name"
    data, mime = await _read_optional_image(upload)
    if data:
        return data, mime, "upload"
    return None, None, None


def _store_temp_sheet(
    user_id: str,
    contents: bytes,
    mime_type: str,
    ext: str,
    sheet_bytes: bytes,
) -> dict:
    """Persist the original photo + generated sheet to MinIO temp paths.

    Shared by the sync generate-sheet(-cartoon) handlers and the async job
    runner. Paths mirror the original inline logic exactly:
      - characters/temp/{user_id}/original_{hex8}{ext}
      - characters/temp/{user_id}/{hex32}.png
    Raises on MinIO failure (callers decide how to surface the error).
    Returns {object_name, original_object_name, preview_url}.
    """
    minio_client = get_minio()

    original_object = "characters/temp/{}/original_{}{}".format(
        user_id, uuid_lib.uuid4().hex[:8], ext
    )
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=original_object,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=mime_type,
    )

    sheet_object = "characters/temp/{}/{}.png".format(user_id, uuid_lib.uuid4().hex)
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=sheet_object,
        data=io.BytesIO(sheet_bytes),
        length=len(sheet_bytes),
        content_type="image/png",
    )

    return {
        "object_name": sheet_object,
        "original_object_name": original_object,
        "preview_url": "/api/character/preview/{}".format(sheet_object),
    }


@router.post("/generate-sheet")
async def generate_sheet(
    file: UploadFile = File(...),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    current_user=Depends(get_current_user),
):
    """Upload a reference photo and generate a photorealistic character sheet.

    Outfit items can be supplied two ways (object_name takes priority over upload):
      - `*_object_name`: MinIO object_name of a selected ad-product item image
        (the `image_object_name` from the product), loaded from the images bucket.
      - `*_image`: a direct UploadFile.
    Each resolved item overrides the corresponding outfit section in the prompt.
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

    # Resolve outfit items: ad-product object_name takes priority over upload.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # v41: LoRA system removed — sheet generation is Nano Banana only.
    user_id = current_user["id"]

    # Points — 검증 통과 후 생성 시작 전 2포인트 선차감 (부족 시 402 차단).
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    try:
        from ..services.character_generator import generate_character_sheet

        logger.info(
            "[character.gen] mode=real image_model=%s user=%s items=top:%s/bottom:%s/shoes:%s",
            norm_image_model, user_id, top_src, bottom_src, shoes_src,
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
        # Points — 생성 실패 시 선차감분 환불.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Save original photo + generated sheet to MinIO temp paths (the *permanent*
    # original is uploaded separately via /upload-original-photo).
    try:
        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)
    except Exception:
        # Points — MinIO 저장 실패도 사용자에게는 생성 실패 → 환불 후 기존 500 동작 유지.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        raise

    return {
        "object_name": stored["object_name"],
        "original_object_name": stored["original_object_name"],
        "preview_url": stored["preview_url"],
        "image_model": norm_image_model,  # v55 — echo back so client can persist
        "message": "캐릭터 시트가 생성되었습니다.",
    }


# ── GET /api/character/style-samples ────────────────────────────────────────


@router.get("/style-samples")
async def list_style_samples():
    """Return the 3 bundled cartoon art-style presets for the 가상화 UI."""
    return {
        "samples": [
            {
                "key": key,
                "label": preset["label"],
                "art_style": preset["art_style_label"],
                "preview_url": "/api/character/style-sample/{}".format(key),
            }
            for key, preset in STYLE_PRESETS.items()
        ]
    }


# ── GET /api/character/style-sample/{key} ───────────────────────────────────


@router.get("/style-sample/{key}")
async def get_style_sample(key: str):
    """Serve a bundled style-sample PNG by preset key."""
    data = _load_style_preset_bytes(key)
    if data is None:
        return JSONResponse(
            status_code=404,
            content={"error": "화풍 샘플을 찾을 수 없습니다."},
        )
    return Response(content=data, media_type="image/png")


# ── POST /api/character/generate-sheet-cartoon ──────────────────────────────


@router.post("/generate-sheet-cartoon")
async def generate_sheet_cartoon(
    file: UploadFile = File(...),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    style_preset: str = Form(""),
    style_image: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
):
    """Generate a CARTOON / illustration-style character sheet (가상화).

    Style reference resolution:
      - If `style_image` is uploaded → use its bytes (art_style = uploaded label).
      - Else if `style_preset` in {webtoon, anime, manga90} → load bundled sample.
      - Else → 400.
    Outfit items resolve like /generate-sheet (`*_object_name` ad-product image
    takes priority over `*_image` upload) and are converted into the chosen style.
    """
    user_id = current_user["id"]

    # image_model 검증 (실사와 동일 규칙).
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

    # Validate main face photo.
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    contents = await file.read()
    if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
        )
    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve outfit items: ad-product object_name takes priority over upload.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # Resolve style reference: uploaded image takes priority over preset.
    style_ref_bytes, style_ref_mime = await _read_optional_image(style_image)
    if style_ref_bytes:
        art_style_label = UPLOADED_STYLE_LABEL
        art_style_key = "uploaded"
    else:
        preset_key = (style_preset or "").strip()
        preset = STYLE_PRESETS.get(preset_key)
        if not preset:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "화풍을 선택하거나 화풍 이미지를 업로드해주세요. "
                             "(style_preset: webtoon|anime|manga90 또는 style_image)"
                },
            )
        style_ref_bytes = _load_style_preset_bytes(preset_key)
        if style_ref_bytes is None:
            logger.error(
                "generate-sheet-cartoon: bundled style sample missing key=%s user=%s",
                preset_key, user_id,
            )
            return JSONResponse(
                status_code=500,
                content={"error": "화풍 샘플 이미지를 로드하지 못했습니다."},
            )
        style_ref_mime = "image/png"
        art_style_label = preset["art_style_label"]
        art_style_key = preset_key

    logger.info(
        "[character.gen] mode=cartoon image_model=%s art_style=%s user=%s "
        "items=top:%s/bottom:%s/shoes:%s",
        norm_image_model, art_style_label, user_id, top_src, bottom_src, shoes_src,
    )

    # Points — 검증 통과 후 생성 시작 전 2포인트 선차감 (부족 시 402 차단).
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    try:
        from ..services.character_generator import generate_character_sheet_cartoon

        sheet_bytes = await generate_character_sheet_cartoon(
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
            art_style_label=art_style_label,
            style_ref_bytes=style_ref_bytes,
            style_ref_mime=style_ref_mime,
        )
    except Exception as e:
        logger.error(
            "generate-sheet-cartoon failed: user=%s art_style=%s err=%s",
            user_id, art_style_label, str(e)[:200],
        )
        # Points — 생성 실패 시 선차감분 환불.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": "가상화 캐릭터 시트 생성 실패: {}".format(str(e)[:200])},
        )

    # Temp original + generated sheet — mirrors /generate-sheet behavior.
    try:
        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)
    except Exception:
        # Points — MinIO 저장 실패도 사용자에게는 생성 실패 → 환불 후 기존 500 동작 유지.
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        raise

    return {
        "object_name": stored["object_name"],
        "original_object_name": stored["original_object_name"],
        "preview_url": stored["preview_url"],
        "image_model": norm_image_model,
        "art_style": art_style_label,
        "art_style_key": art_style_key,
        "message": "가상화 캐릭터 시트가 생성되었습니다.",
    }


# ── Async job pattern (job accept + background runner + polling) ────────────
#
# 캐릭터 시트 생성은 3~6분+ 걸려 프론트 고정 타임아웃에 걸리므로, 접수 즉시
# job_id 를 반환하고 백그라운드에서 생성 후 프론트가 GET /job/{job_id} 로
# 폴링하는 비동기 패턴을 제공한다 (동기 엔드포인트는 하위호환으로 유지).
# Mongo 컬렉션: `character_jobs`. status: processing → done | failed.


async def refund_character_job_points(mongo, job_oid) -> bool:
    """Refund the pre-deducted character points of a failed job, exactly once.

    Atomically claims the job's `refunded` flag (absent/False → True) via
    find_one_and_update, so the async runner and the startup stale-recovery
    can never both refund the same job. Jobs without a `point_ref`
    (pre-points era, or claim already taken) are skipped. Never raises.
    Returns True when a refund was actually issued.
    """
    try:
        claimed = await mongo.character_jobs.find_one_and_update(
            {"_id": job_oid, "point_ref": {"$ne": None}, "refunded": {"$ne": True}},
            {"$set": {"refunded": True}},
        )
        if not claimed:
            return False
        user_id = claimed.get("user_id")
        point_ref = claimed.get("point_ref")
        if not user_id or not point_ref:
            return False
        await refund_points(user_id, "character", CHARACTER_POINT_COST, point_ref)
        return True
    except Exception as e:  # noqa: BLE001 - refund must never break callers
        logger.warning(
            "[CharJob] refund claim failed job=%s: %s", str(job_oid), str(e)[:200]
        )
        return False


async def _run_character_job(
    job_id: str,
    user_id: str,
    mode: str,
    contents: bytes,
    mime_type: str,
    ext: str,
    top_bytes: Optional[bytes],
    top_mime: Optional[str],
    bottom_bytes: Optional[bytes],
    bottom_mime: Optional[str],
    shoes_bytes: Optional[bytes],
    shoes_mime: Optional[str],
    user_text: str,
    image_model: str,
    art_style_label: Optional[str] = None,
    art_style_key: Optional[str] = None,
    style_ref_bytes: Optional[bytes] = None,
    style_ref_mime: Optional[str] = None,
):
    """Background runner for async character sheet jobs.

    Generates the sheet (real or cartoon), stores results to MinIO temp paths,
    and updates the `character_jobs` document. Never raises — any failure marks
    the job as failed with a truncated error message.
    """
    mongo = get_mongo()
    oid = ObjectId(job_id)
    try:
        if mode == "cartoon":
            from ..services.character_generator import generate_character_sheet_cartoon

            sheet_bytes = await generate_character_sheet_cartoon(
                photo_bytes=contents,
                mime_type=mime_type,
                top_bytes=top_bytes,
                top_mime=top_mime,
                bottom_bytes=bottom_bytes,
                bottom_mime=bottom_mime,
                shoes_bytes=shoes_bytes,
                shoes_mime=shoes_mime,
                user_text=user_text,
                image_model=image_model,
                art_style_label=art_style_label,
                style_ref_bytes=style_ref_bytes,
                style_ref_mime=style_ref_mime,
            )
        else:
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
                user_text=user_text,
                image_model=image_model,
            )

        stored = _store_temp_sheet(user_id, contents, mime_type, ext, sheet_bytes)

        now = datetime.utcnow()
        update_fields = {
            "status": "done",
            "object_name": stored["object_name"],
            "original_object_name": stored["original_object_name"],
            "preview_url": stored["preview_url"],
            "image_model": image_model,
            "updated_at": now,
            "completed_at": now,
        }
        if mode == "cartoon":
            update_fields["art_style"] = art_style_label
            update_fields["art_style_key"] = art_style_key
        await mongo.character_jobs.update_one({"_id": oid}, {"$set": update_fields})
        logger.info(
            "[CharJob] job=%s mode=%s status=done object=%s",
            job_id, mode, stored["object_name"],
        )
    except Exception as e:
        logger.error(
            "[CharJob] job=%s mode=%s status=failed err=%s",
            job_id, mode, str(e)[:200],
        )
        try:
            await mongo.character_jobs.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error": str(e)[:200],
                    "updated_at": datetime.utcnow(),
                }},
            )
        except Exception as e2:
            logger.error(
                "[CharJob] job=%s failed-state write also failed: %s",
                job_id, str(e2)[:200],
            )
        # Points — 실패한 job 의 선차감분 환불 (refunded 플래그로 1회 보장).
        if await refund_character_job_points(mongo, oid):
            logger.info("[CharJob] job=%s points refunded", job_id)


@router.post("/generate-sheet-async")
async def generate_sheet_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    current_user=Depends(get_current_user),
):
    """Async variant of /generate-sheet — same form fields, returns a job_id
    immediately; generation runs in the background. Poll GET /job/{job_id}."""
    # Validation — identical to the sync handler.
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

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    contents = await file.read()
    if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
        )
    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve ALL bytes inside the handler — UploadFile objects are closed
    # after the response is sent, so nothing may be read in the background.
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    user_id = current_user["id"]

    # Points — 검증 통과 후 job 접수 전 2포인트 선차감 (부족 시 402, job 미생성).
    # ref 는 시도당 유니크 (point_events 유니크 인덱스와의 재시도 충돌 회피),
    # job doc 에 point_ref 로 저장해 실패/stale 복구 시 환불에 사용.
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    mongo = get_mongo()
    now = datetime.utcnow()
    result = await mongo.character_jobs.insert_one({
        "user_id": user_id,
        "mode": "real",
        "status": "processing",
        "image_model": norm_image_model,
        "point_ref": point_ref,
        "refunded": False,
        "created_at": now,
        "updated_at": now,
    })
    job_id = str(result.inserted_id)

    logger.info(
        "[CharJob] job=%s mode=real status=processing image_model=%s user=%s "
        "items=top:%s/bottom:%s/shoes:%s",
        job_id, norm_image_model, user_id, top_src, bottom_src, shoes_src,
    )

    background_tasks.add_task(
        _run_character_job,
        job_id=job_id,
        user_id=user_id,
        mode="real",
        contents=contents,
        mime_type=mime_type,
        ext=ext,
        top_bytes=top_bytes,
        top_mime=top_mime,
        bottom_bytes=bottom_bytes,
        bottom_mime=bottom_mime,
        shoes_bytes=shoes_bytes,
        shoes_mime=shoes_mime,
        user_text=user_text.strip(),
        image_model=norm_image_model,
    )

    return {"job_id": job_id, "status": "processing"}


@router.post("/generate-sheet-cartoon-async")
async def generate_sheet_cartoon_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    top_image: Optional[UploadFile] = File(None),
    bottom_image: Optional[UploadFile] = File(None),
    shoes_image: Optional[UploadFile] = File(None),
    top_object_name: Optional[str] = Form(None),
    bottom_object_name: Optional[str] = Form(None),
    shoes_object_name: Optional[str] = Form(None),
    user_text: str = Form(""),
    image_model: str = Form("nb_pro"),
    style_preset: str = Form(""),
    style_image: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
):
    """Async variant of /generate-sheet-cartoon — same form fields, returns a
    job_id immediately; generation runs in the background. Poll GET /job/{job_id}."""
    user_id = current_user["id"]

    # Validation — identical to the sync cartoon handler.
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

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    contents = await file.read()
    if len(contents) == 0 or len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 하며 비어있을 수 없습니다."},
        )
    mime_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    # Resolve ALL bytes inside the handler (UploadFile closes after response).
    top_bytes, top_mime, top_src = await _resolve_item_image(top_object_name, top_image)
    bottom_bytes, bottom_mime, bottom_src = await _resolve_item_image(bottom_object_name, bottom_image)
    shoes_bytes, shoes_mime, shoes_src = await _resolve_item_image(shoes_object_name, shoes_image)

    # Resolve style reference in the handler: uploaded image beats preset.
    style_ref_bytes, style_ref_mime = await _read_optional_image(style_image)
    if style_ref_bytes:
        art_style_label = UPLOADED_STYLE_LABEL
        art_style_key = "uploaded"
    else:
        preset_key = (style_preset or "").strip()
        preset = STYLE_PRESETS.get(preset_key)
        if not preset:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "화풍을 선택하거나 화풍 이미지를 업로드해주세요. "
                             "(style_preset: webtoon|anime|manga90 또는 style_image)"
                },
            )
        style_ref_bytes = _load_style_preset_bytes(preset_key)
        if style_ref_bytes is None:
            logger.error(
                "generate-sheet-cartoon-async: bundled style sample missing key=%s user=%s",
                preset_key, user_id,
            )
            return JSONResponse(
                status_code=500,
                content={"error": "화풍 샘플 이미지를 로드하지 못했습니다."},
            )
        style_ref_mime = "image/png"
        art_style_label = preset["art_style_label"]
        art_style_key = preset_key

    # Points — 검증 통과 후 job 접수 전 2포인트 선차감 (부족 시 402, job 미생성).
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(user_id, "character", CHARACTER_POINT_COST, point_ref):
        return JSONResponse(status_code=402, content=dict(INSUFFICIENT_POINTS_RESPONSE))

    mongo = get_mongo()
    now = datetime.utcnow()
    result = await mongo.character_jobs.insert_one({
        "user_id": user_id,
        "mode": "cartoon",
        "status": "processing",
        "image_model": norm_image_model,
        "art_style": art_style_label,
        "art_style_key": art_style_key,
        "point_ref": point_ref,
        "refunded": False,
        "created_at": now,
        "updated_at": now,
    })
    job_id = str(result.inserted_id)

    logger.info(
        "[CharJob] job=%s mode=cartoon status=processing image_model=%s art_style=%s "
        "user=%s items=top:%s/bottom:%s/shoes:%s",
        job_id, norm_image_model, art_style_label, user_id, top_src, bottom_src, shoes_src,
    )

    background_tasks.add_task(
        _run_character_job,
        job_id=job_id,
        user_id=user_id,
        mode="cartoon",
        contents=contents,
        mime_type=mime_type,
        ext=ext,
        top_bytes=top_bytes,
        top_mime=top_mime,
        bottom_bytes=bottom_bytes,
        bottom_mime=bottom_mime,
        shoes_bytes=shoes_bytes,
        shoes_mime=shoes_mime,
        user_text=user_text.strip(),
        image_model=norm_image_model,
        art_style_label=art_style_label,
        art_style_key=art_style_key,
        style_ref_bytes=style_ref_bytes,
        style_ref_mime=style_ref_mime,
    )

    return {"job_id": job_id, "status": "processing"}


# ── GET /api/character/job/{job_id} ─────────────────────────────────────────


@router.get("/job/{job_id}")
async def get_character_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Poll an async character sheet job. Own jobs only — invalid/unknown/
    others' ids all return 404 (no existence leak). Recommended interval: 5s."""
    not_found = JSONResponse(
        status_code=404,
        content={"error": "작업을 찾을 수 없습니다."},
    )
    if not ObjectId.is_valid(job_id):
        return not_found

    mongo = get_mongo()
    job = await mongo.character_jobs.find_one({"_id": ObjectId(job_id)})
    if not job or job.get("user_id") != current_user["id"]:
        return not_found

    # debug level — 5s polling would flood info logs.
    logger.debug("[CharJob] poll job=%s status=%s", job_id, job.get("status"))

    def _iso(v):
        return v.isoformat() if isinstance(v, datetime) else None

    resp = {
        "job_id": job_id,
        "mode": job.get("mode"),
        "status": job.get("status"),
        "created_at": _iso(job.get("created_at")),
        "updated_at": _iso(job.get("updated_at")),
    }
    for key in ("object_name", "original_object_name", "preview_url",
                "image_model", "art_style", "art_style_key", "error"):
        if job.get(key) is not None:
            resp[key] = job[key]
    if job.get("completed_at") is not None:
        resp["completed_at"] = _iso(job.get("completed_at"))
    return resp


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

    # 가상화 분리: variant='virtual' 이면 별도 슬롯(sheet_virtual.png)에 저장하고
    # virtual_* 필드만 갱신 — 실사 슬롯(sheet_object_name 등)은 절대 건드리지 않는다.
    variant = (body.variant or "real").strip().lower()
    if variant not in ("real", "virtual"):
        return JSONResponse(
            status_code=400,
            content={"error": "variant 는 'real' 또는 'virtual' 이어야 합니다."},
        )
    is_virtual = variant == "virtual"

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

    # Copy to permanent location (separate slot for virtual).
    if is_virtual:
        permanent_object = "characters/{}/sheet_virtual.png".format(user_id)
    else:
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

    if is_virtual:
        # virtual 슬롯: 실사 필드(sheet_object_name/used_items/name/age/...) 절대 미변경.
        set_fields = {
            "user_id": user_id,
            "virtual_sheet_object_name": permanent_object,
            "virtual_art_style": (body.art_style or "").strip(),
            "virtual_used_items": used_items_data,
            "updated_at": datetime.utcnow(),
        }
    else:
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

    if is_virtual:
        logger.info(
            "save_character: variant=virtual user=%s art_style=%s",
            user_id, set_fields["virtual_art_style"],
        )
        return {
            "variant": "virtual",
            "virtual_sheet_object_name": permanent_object,
            "virtual_art_style": set_fields["virtual_art_style"],
            # 실사 슬롯은 그대로 — 클라이언트 확인용으로 함께 반환.
            "sheet_object_name": saved.get("sheet_object_name") or "",
            "message": "가상화 캐릭터가 저장되었습니다.",
        }

    return {
        "variant": "real",
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

    virtual_sheet_object_name = char.get("virtual_sheet_object_name") or ""
    virtual_sheet_url = None
    if virtual_sheet_object_name:
        virtual_sheet_url = "/api/character/preview/{}".format(virtual_sheet_object_name)

    return {
        "character": {
            "sheet_object_name": char.get("sheet_object_name"),
            "sheet_url": sheet_url,
            "used_items": char.get("used_items", []),
            # 가상화(그림/만화 화풍) 슬롯 (없으면 빈값).
            "virtual_sheet_object_name": virtual_sheet_object_name,
            "virtual_sheet_url": virtual_sheet_url,
            "virtual_art_style": char.get("virtual_art_style") or "",
            "virtual_used_items": char.get("virtual_used_items", []),
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
