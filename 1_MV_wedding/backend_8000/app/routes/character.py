"""
Wedding character sheet routes.

Keeps the v1 stub at `/api/character/couple` (POST/GET) untouched for backward
compat, and adds the v4 4-sheet feature:

  POST /api/character/sheets/generate    — multipart: face + outfit object names + user_text
  POST /api/character/sheets/save        — JSON: copy temp sheet to permanent, upsert per slot
  POST /api/character/sheets/refine      — multipart: sheet + photo + refine_request
  GET  /api/character/sheets             — return all 4 slots for current user
  GET  /api/character/preview/{path}     — proxy MinIO photo (Bearer header OR ?token=)
  GET  /api/character/outfits            — list catalog items filtered by role/style/category

All logs use prefix `[CharRoute]` plus traceability fields. Sensitive bodies
(file blobs, API keys) are never logged — only sizes / object names.
"""

import asyncio
import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/character", tags=["Character"])


# ── Constants ────────────────────────────────────────────────────────────────

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_IMAGE_MODELS = {"nb_pro", "gpt_image_2"}
ALLOWED_ROLES = {"groom", "bride"}
ALLOWED_STYLES = {"casual", "wedding"}
ALLOWED_OUTFIT_CATEGORIES = {"top", "bottom", "shoes"}


# ── Helpers ──────────────────────────────────────────────────────────────────


def _normalize_image_model(raw: Optional[str]) -> Optional[str]:
    """Return validated image_model string, or None if input is invalid.

    Empty/whitespace/None → default ("gpt_image_2"). Unknown value → None so
    the route can return 400. NOTE: default flipped from reference ("nb_pro").
    """
    if raw is None:
        return "gpt_image_2"
    v = raw.strip()
    if not v:
        return "gpt_image_2"
    if v in ALLOWED_IMAGE_MODELS:
        return v
    return None


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


async def _load_image_from_photos(object_name: str) -> tuple:
    """Pull a reference image from the MinIO photos bucket.

    Returns (bytes, mime) or (None, None) if object_name is empty / missing.
    Never raises — only logs warnings. Used for both outfit refs and sheet refs.
    """
    if not object_name:
        return None, None
    minio_client = get_minio()
    if minio_client is None:
        logger.warning("[CharRoute] _load_image_from_photos: minio not initialized object=%s", object_name)
        return None, None
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        mime = mimetypes.guess_type(object_name)[0] or "image/png"
        logger.info(
            "[CharRoute] _load_image_from_photos object=%s bytes=%d mime=%s",
            object_name, len(data or b""), mime,
        )
        return data, mime
    except Exception as e:
        logger.warning(
            "[CharRoute] _load_image_from_photos failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None, None


def _slot_key(role: str, style: str) -> str:
    return "{}_{}".format(role, style)


def _build_preview_url(object_name: str) -> str:
    return "/api/character/preview/{}".format(object_name)


# ── v1 stub kept as-is (backward compat) ────────────────────────────────────


class PartnerSheet(BaseModel):
    name: str
    age: int | None = None
    traits: str | None = None


class CoupleSheet(BaseModel):
    groom: PartnerSheet
    bride: PartnerSheet


@router.post("/couple")
async def save_couple(body: CoupleSheet, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    await mongo.couple_characters.update_one(
        {"user_id": current_user["id"]},
        {
            "$set": {
                "groom": body.groom.model_dump(),
                "bride": body.bride.model_dump(),
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"ok": True}


@router.get("/couple")
async def get_couple(current_user=Depends(get_current_user)):
    mongo = get_mongo()
    doc = await mongo.couple_characters.find_one({"user_id": current_user["id"]})
    if not doc:
        return None
    return {
        "user_id": doc.get("user_id"),
        "groom": doc.get("groom"),
        "bride": doc.get("bride"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
        "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
    }


# ── v4: 4-sheet character feature ────────────────────────────────────────────


class UsedItemPayload(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    image_object_name: Optional[str] = None
    category: Optional[str] = None  # top | bottom | shoes


class SaveSheetRequest(BaseModel):
    sheet_object_name: str
    role: str
    style: str
    used_items: Optional[List[UsedItemPayload]] = None
    image_model: Optional[str] = None
    user_text: Optional[str] = None


# ── v6: async job helpers for sheet generate/refine ─────────────────────────


def _serialize_sheet_job(doc: dict) -> dict:
    """Shape a wedding_sheet_jobs mongo doc for the polling endpoint."""
    sheet_obj = doc.get("sheet_object_name") or ""
    created_at = doc.get("created_at")
    updated_at = doc.get("updated_at")
    return {
        "job_id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "type": doc.get("type"),
        "status": doc.get("status", "queued"),
        "role": doc.get("role"),
        "style": doc.get("style"),
        "image_model": doc.get("image_model"),
        "user_text": doc.get("user_text") or "",
        "sheet_object_name": sheet_obj or None,
        "preview_url": _build_preview_url(sheet_obj) if sheet_obj else None,
        "error_message": doc.get("error_message"),
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
    }


async def _put_minio_bytes(object_name: str, data: bytes, content_type: str) -> None:
    """Best-effort sync MinIO put — used both for input stash and result."""
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_photos,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


async def _stash_upload_to_temp(
    upload: UploadFile,
    user_id: str,
    role_v: str,
    style_v: str,
) -> tuple:
    """Read an UploadFile and write its bytes to a MinIO temp input path.

    Returns (object_name, mime_type, byte_count) or (None, None, 0) when the
    upload is empty/invalid (caller handles 400). Validation rules mirror the
    pre-v6 sync endpoint: ext check + 10 MB cap + non-empty.
    """
    if upload is None or not (upload.filename or ""):
        return None, None, 0
    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return None, None, -1  # caller distinguishes invalid ext from missing
    data = await upload.read()
    if len(data) == 0:
        return None, None, 0
    if len(data) > MAX_IMAGE_SIZE:
        return None, None, -2  # caller distinguishes oversize
    mime = mimetypes.guess_type(upload.filename)[0] or "image/jpeg"
    object_name = "characters/temp/{}/{}_{}/input_{}{}".format(
        user_id, role_v, style_v, uuid_lib.uuid4().hex, ext,
    )
    await _put_minio_bytes(object_name, data, mime)
    return object_name, mime, len(data)


async def _run_sheet_generation(job_id: str) -> None:
    """Background: drive a wedding_sheet_jobs `generate` job to done/failed.

    Lifecycle log lines all carry `[SheetJob]` prefix and include `job_id`,
    `user_id`, `role`, `style`, `image_model` so a full job timeline is
    greppable by job_id.
    """
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning("[SheetJob] invalid job_id job_id=%s — skipping", job_id)
        return

    job = await mongo.wedding_sheet_jobs.find_one({"_id": oid})
    if not job:
        logger.warning("[SheetJob] job not found job_id=%s — skipping", job_id)
        return

    user_id = job.get("user_id")
    role_v = job.get("role")
    style_v = job.get("style")
    image_model = job.get("image_model")
    logger.info(
        "[SheetJob] running job_id=%s user_id=%s role=%s style=%s image_model=%s type=generate",
        job_id, user_id, role_v, style_v, image_model,
    )

    try:
        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {"$set": {"status": "running", "updated_at": datetime.now(timezone.utc)}},
        )

        face_object = job.get("face_object_name") or ""
        top_object = job.get("top_image_object_name") or ""
        bottom_object = job.get("bottom_image_object_name") or ""
        shoes_object = job.get("shoes_image_object_name") or ""

        logger.info(
            "[SheetJob] loading face/outfits job_id=%s user_id=%s role=%s style=%s face=%s top=%s bottom=%s shoes=%s",
            job_id, user_id, role_v, style_v,
            bool(face_object), bool(top_object), bool(bottom_object), bool(shoes_object),
        )

        face_bytes, face_mime = await _load_image_from_photos(face_object)
        if not face_bytes:
            raise ValueError("face image missing from MinIO")
        top_bytes, _top_mime = await _load_image_from_photos(top_object)
        bottom_bytes, _bottom_mime = await _load_image_from_photos(bottom_object)
        shoes_bytes, _shoes_mime = await _load_image_from_photos(shoes_object)

        from ..services.character_generator import generate_character_sheet

        logger.info(
            "[SheetJob] calling generate_character_sheet job_id=%s user_id=%s role=%s style=%s image_model=%s",
            job_id, user_id, role_v, style_v, image_model,
        )
        sheet_bytes = await generate_character_sheet(
            photo_bytes=face_bytes,
            mime_type=face_mime or "image/jpeg",
            top_bytes=top_bytes,
            top_mime=None,
            bottom_bytes=bottom_bytes,
            bottom_mime=None,
            shoes_bytes=shoes_bytes,
            shoes_mime=None,
            user_text=job.get("user_text") or "",
            image_model=image_model,
            role=role_v,
            style=style_v,
            user_id=user_id,
        )
        logger.info(
            "[SheetJob] generate done bytes=%d job_id=%s user_id=%s role=%s style=%s image_model=%s",
            len(sheet_bytes or b""), job_id, user_id, role_v, style_v, image_model,
        )

        sheet_object = "characters/temp/{}/{}_{}/{}.png".format(
            user_id, role_v, style_v, uuid_lib.uuid4().hex,
        )
        await _put_minio_bytes(sheet_object, sheet_bytes, "image/png")
        logger.info(
            "[SheetJob] minio put ok object=%s job_id=%s user_id=%s role=%s style=%s image_model=%s",
            sheet_object, job_id, user_id, role_v, style_v, image_model,
        )

        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "done",
                    "sheet_object_name": sheet_object,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        logger.info(
            "[SheetJob] done job_id=%s user_id=%s role=%s style=%s image_model=%s",
            job_id, user_id, role_v, style_v, image_model,
        )
    except Exception as e:
        logger.exception(
            "[SheetJob] failed job_id=%s user_id=%s role=%s style=%s image_model=%s exc=%s: %s",
            job_id, user_id, role_v, style_v, image_model,
            type(e).__name__, str(e)[:200],
        )
        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "failed",
                    "error_message": str(e)[:500] or type(e).__name__,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


async def _run_sheet_refinement(job_id: str) -> None:
    """Background: drive a wedding_sheet_jobs `refine` job to done/failed."""
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning("[SheetJob] invalid job_id job_id=%s — skipping", job_id)
        return

    job = await mongo.wedding_sheet_jobs.find_one({"_id": oid})
    if not job:
        logger.warning("[SheetJob] job not found job_id=%s — skipping", job_id)
        return

    user_id = job.get("user_id")
    role_v = job.get("role")
    style_v = job.get("style")
    image_model = job.get("image_model")
    logger.info(
        "[SheetJob] running job_id=%s user_id=%s role=%s style=%s image_model=%s type=refine",
        job_id, user_id, role_v, style_v, image_model,
    )

    try:
        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {"$set": {"status": "running", "updated_at": datetime.now(timezone.utc)}},
        )

        source_sheet = (job.get("source_sheet_object_name") or "").strip()
        photo_object = (job.get("photo_object_name") or "").strip()
        refine_request = (job.get("refine_request") or "").strip()

        # Defense in depth: re-validate ownership prefix on the source sheet.
        allowed_prefixes = (
            "characters/temp/{}/".format(user_id),
            "characters/{}/".format(user_id),
        )
        if not source_sheet.startswith(allowed_prefixes):
            raise ValueError("source sheet does not belong to job user")

        logger.info(
            "[SheetJob] loading source/photo job_id=%s user_id=%s role=%s style=%s source=%s photo=%s",
            job_id, user_id, role_v, style_v, source_sheet, photo_object,
        )

        sheet_bytes, _sheet_mime = await _load_image_from_photos(source_sheet)
        if not sheet_bytes:
            raise ValueError("source sheet not found in MinIO")
        photo_bytes, photo_mime = await _load_image_from_photos(photo_object)
        if not photo_bytes:
            raise ValueError("photo not found in MinIO")
        if not refine_request:
            raise ValueError("refine_request is empty")

        from ..services.character_generator import refine_character_sheet

        logger.info(
            "[SheetJob] calling refine_character_sheet job_id=%s user_id=%s role=%s style=%s image_model=%s",
            job_id, user_id, role_v, style_v, image_model,
        )
        refined_bytes = await refine_character_sheet(
            current_sheet_bytes=sheet_bytes,
            photo_bytes=photo_bytes,
            photo_mime=photo_mime or "image/jpeg",
            refine_request=refine_request,
            image_model=image_model,
            role=role_v,
            style=style_v,
            user_id=user_id,
        )
        logger.info(
            "[SheetJob] refine done bytes=%d job_id=%s user_id=%s role=%s style=%s image_model=%s",
            len(refined_bytes or b""), job_id, user_id, role_v, style_v, image_model,
        )

        sheet_object = "characters/temp/{}/{}_{}/{}.png".format(
            user_id, role_v, style_v, uuid_lib.uuid4().hex,
        )
        await _put_minio_bytes(sheet_object, refined_bytes, "image/png")
        logger.info(
            "[SheetJob] minio put ok object=%s job_id=%s user_id=%s role=%s style=%s image_model=%s",
            sheet_object, job_id, user_id, role_v, style_v, image_model,
        )

        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "done",
                    "sheet_object_name": sheet_object,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        logger.info(
            "[SheetJob] done job_id=%s user_id=%s role=%s style=%s image_model=%s",
            job_id, user_id, role_v, style_v, image_model,
        )
    except Exception as e:
        logger.exception(
            "[SheetJob] failed job_id=%s user_id=%s role=%s style=%s image_model=%s exc=%s: %s",
            job_id, user_id, role_v, style_v, image_model,
            type(e).__name__, str(e)[:200],
        )
        await mongo.wedding_sheet_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "failed",
                    "error_message": str(e)[:500] or type(e).__name__,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


@router.post("/sheets/generate")
async def generate_sheet(
    file: UploadFile = File(None),
    face_object_name: str = Form(""),
    top_image_object_name: str = Form(""),
    bottom_image_object_name: str = Form(""),
    shoes_image_object_name: str = Form(""),
    user_text: str = Form(""),
    image_model: str = Form("gpt_image_2"),
    role: str = Form(...),
    style: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Queue an async job to generate a character sheet PNG.

    v6: fire-and-poll — input bytes are stashed to MinIO, a wedding_sheet_jobs
    doc is inserted, and the heavy work runs in `_run_sheet_generation`. The
    client polls `GET /sheets/jobs/{job_id}` for terminal state.

    Post-v6 fix: accepts either a `file` upload OR a pre-uploaded
    `face_object_name` (preferred — produced by /assets/upload). The
    pre-upload path is what the wizard uses so a File object doesn't need to
    survive sessionStorage during the outfit-selection round-trip.
    """
    user_id = current_user["id"]
    role_v = (role or "").strip().lower()
    style_v = (style or "").strip().lower()
    face_object_name_v = (face_object_name or "").strip()
    logger.info(
        "[CharRoute] /sheets/generate entry user_id=%s role=%s style=%s image_model=%s user_text_len=%d top=%s bottom=%s shoes=%s face_object_provided=%s file_provided=%s",
        user_id,
        role_v,
        style_v,
        image_model,
        len((user_text or "").strip()),
        bool(top_image_object_name),
        bool(bottom_image_object_name),
        bool(shoes_image_object_name),
        bool(face_object_name_v),
        bool(file is not None and (file.filename or "")),
    )

    if role_v not in ALLOWED_ROLES:
        logger.warning("[CharRoute] invalid role=%s user_id=%s", role_v, user_id)
        return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
    if style_v not in ALLOWED_STYLES:
        logger.warning("[CharRoute] invalid style=%s user_id=%s", style_v, user_id)
        return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})

    norm_image_model = _normalize_image_model(image_model)
    if norm_image_model is None:
        logger.warning(
            "[CharRoute] invalid image_model=%s user_id=%s role=%s style=%s",
            image_model, user_id, role_v, style_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 image_model 입니다. (nb_pro, gpt_image_2)"},
        )

    if norm_image_model == "nb_pro" and not settings.google_api_key:
        logger.warning(
            "[CharRoute] /sheets/generate missing google_api_key user_id=%s role=%s style=%s",
            user_id, role_v, style_v,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if norm_image_model == "gpt_image_2" and not settings.openai_api_key:
        logger.warning(
            "[CharRoute] /sheets/generate missing openai_api_key user_id=%s role=%s style=%s",
            user_id, role_v, style_v,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # Branch: prefer pre-uploaded face_object_name; fall back to multipart file.
    has_file = file is not None and (file.filename or "") != ""
    if not face_object_name_v and not has_file:
        logger.warning(
            "[CharRoute] /sheets/generate missing face user_id=%s role=%s style=%s",
            user_id, role_v, style_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진이 필요합니다."},
        )

    face_object: Optional[str] = None
    face_mime: Optional[str] = None
    face_size: int = 0

    if face_object_name_v:
        # Ownership enforcement — /assets/upload writes objects at
        # `{user_id}/...` (see backend_8000/app/routes/assets.py).
        owner_prefix = "{}/".format(user_id)
        if not face_object_name_v.startswith(owner_prefix):
            logger.warning(
                "[CharRoute] /sheets/generate ownership reject user_id=%s face_object=%s",
                user_id, face_object_name_v,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "본인이 업로드한 사진만 사용할 수 있습니다."},
            )
        # Verify the object actually exists & is readable (size hint).
        face_bytes_check, face_mime = await _load_image_from_photos(face_object_name_v)
        if not face_bytes_check:
            logger.warning(
                "[CharRoute] /sheets/generate face_object not loadable user_id=%s face_object=%s",
                user_id, face_object_name_v,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "업로드된 얼굴 사진을 찾을 수 없습니다."},
            )
        face_object = face_object_name_v
        face_size = len(face_bytes_check)
        logger.info(
            "[CharRoute] /sheets/generate branch=pre_uploaded user_id=%s role=%s style=%s face_object=%s face_bytes=%d mime=%s",
            user_id, role_v, style_v, face_object, face_size, face_mime,
        )
    else:
        # Legacy multipart-file path — stash into MinIO temp.
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            logger.warning(
                "[CharRoute] invalid face ext=%s user_id=%s role=%s style=%s",
                ext, user_id, role_v, style_v,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )

        try:
            face_object, face_mime, face_size = await _stash_upload_to_temp(
                file, user_id, role_v, style_v,
            )
        except Exception as e:
            logger.exception(
                "[CharRoute] /sheets/generate stash failed user_id=%s role=%s style=%s: %s: %s",
                user_id, role_v, style_v, type(e).__name__, str(e)[:200],
            )
            return JSONResponse(
                status_code=500,
                content={"error": "입력 이미지 임시 저장에 실패했습니다."},
            )

        if face_size == -1:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )
        if face_size == -2:
            return JSONResponse(
                status_code=400,
                content={"error": "이미지 크기는 10MB 이하여야 합니다."},
            )
        if not face_object or face_size == 0:
            return JSONResponse(status_code=400, content={"error": "이미지 파일이 비어 있습니다."})

        logger.info(
            "[CharRoute] /sheets/generate branch=stashed user_id=%s role=%s style=%s face_object=%s face_bytes=%d mime=%s",
            user_id, role_v, style_v, face_object, face_size, face_mime,
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    job_doc = {
        "user_id": user_id,
        "type": "generate",
        "role": role_v,
        "style": style_v,
        "image_model": norm_image_model,
        "user_text": (user_text or "").strip(),
        "face_object_name": face_object,
        "top_image_object_name": (top_image_object_name or "").strip(),
        "bottom_image_object_name": (bottom_image_object_name or "").strip(),
        "shoes_image_object_name": (shoes_image_object_name or "").strip(),
        "status": "queued",
        "progress": 0,
        "sheet_object_name": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.wedding_sheet_jobs.insert_one(job_doc)
    except Exception as e:
        logger.exception(
            "[CharRoute] /sheets/generate mongo insert failed user_id=%s role=%s style=%s: %s: %s",
            user_id, role_v, style_v, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "잡 생성에 실패했습니다."},
        )

    job_id = str(result.inserted_id)
    logger.info(
        "[SheetJob] queued job_id=%s user_id=%s role=%s style=%s image_model=%s type=generate",
        job_id, user_id, role_v, style_v, norm_image_model,
    )

    asyncio.create_task(_run_sheet_generation(job_id))

    return {
        "job_id": job_id,
        "status": "queued",
        "role": role_v,
        "style": style_v,
    }


@router.post("/sheets/save")
async def save_sheet(
    body: SaveSheetRequest,
    current_user=Depends(get_current_user),
):
    """Copy temp sheet → permanent location and upsert per-slot doc."""
    user_id = current_user["id"]
    role_v = (body.role or "").strip().lower()
    style_v = (body.style or "").strip().lower()
    logger.info(
        "[CharRoute] /sheets/save entry user_id=%s role=%s style=%s sheet=%s items=%d",
        user_id, role_v, style_v, body.sheet_object_name, len(body.used_items or []),
    )

    if role_v not in ALLOWED_ROLES:
        return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
    if style_v not in ALLOWED_STYLES:
        return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})
    if not body.sheet_object_name:
        return JSONResponse(status_code=400, content={"error": "sheet_object_name이 필요합니다."})

    minio_client = get_minio()
    mongo = get_mongo()

    # Verify temp object exists.
    try:
        minio_client.stat_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=body.sheet_object_name,
        )
        logger.info(
            "[CharRoute] /sheets/save stat ok user_id=%s role=%s style=%s object=%s",
            user_id, role_v, style_v, body.sheet_object_name,
        )
    except Exception as e:
        logger.warning(
            "[CharRoute] /sheets/save stat failed user_id=%s role=%s style=%s object=%s: %s: %s",
            user_id, role_v, style_v, body.sheet_object_name,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "캐릭터 시트 이미지를 찾을 수 없습니다."},
        )

    permanent_object = "characters/{}/{}_{}/sheet.png".format(user_id, role_v, style_v)

    # Try MinIO server-side copy; fallback to download+upload.
    try:
        from minio.commonconfig import CopySource

        minio_client.copy_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=permanent_object,
            source=CopySource(
                bucket_name=settings.minio_bucket_photos,
                object_name=body.sheet_object_name,
            ),
        )
        logger.info(
            "[CharRoute] /sheets/save copy ok user_id=%s role=%s style=%s dst=%s",
            user_id, role_v, style_v, permanent_object,
        )
    except Exception as e:
        logger.warning(
            "[CharRoute] /sheets/save copy failed (will fallback to download+upload) user_id=%s role=%s style=%s: %s: %s",
            user_id, role_v, style_v, type(e).__name__, str(e)[:200],
        )
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=body.sheet_object_name,
            )
            data = resp.read()
            resp.close()
            resp.release_conn()
            minio_client.put_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=permanent_object,
                data=io.BytesIO(data),
                length=len(data),
                content_type="image/png",
            )
            logger.info(
                "[CharRoute] /sheets/save fallback put ok user_id=%s role=%s style=%s bytes=%d",
                user_id, role_v, style_v, len(data),
            )
        except Exception as e2:
            logger.exception(
                "[CharRoute] /sheets/save fallback failed user_id=%s role=%s style=%s: %s: %s",
                user_id, role_v, style_v, type(e2).__name__, str(e2)[:200],
            )
            return JSONResponse(
                status_code=500,
                content={"error": "캐릭터 시트 저장에 실패했습니다."},
            )

    # Upsert into wedding_character_sheets — only this slot.
    norm_image_model = _normalize_image_model(body.image_model) or "gpt_image_2"
    used_items_data = [item.model_dump() for item in (body.used_items or [])]
    now = datetime.now(timezone.utc)
    slot = _slot_key(role_v, style_v)

    slot_doc = {
        "sheet_object_name": permanent_object,
        "used_items": used_items_data,
        "image_model": norm_image_model,
        "user_text": (body.user_text or "").strip(),
        "updated_at": now,
    }

    try:
        await mongo.wedding_character_sheets.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "sheets.{}".format(slot): slot_doc,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        logger.info(
            "[CharRoute] /sheets/save mongo upsert ok user_id=%s slot=%s",
            user_id, slot,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /sheets/save mongo upsert failed user_id=%s slot=%s: %s: %s",
            user_id, slot, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "캐릭터 시트 메타 저장에 실패했습니다."},
        )

    return {
        "role": role_v,
        "style": style_v,
        "sheet_object_name": permanent_object,
        "preview_url": _build_preview_url(permanent_object),
        "used_items": used_items_data,
        "image_model": norm_image_model,
        "user_text": slot_doc["user_text"],
        "updated_at": now.isoformat(),
        "message": "캐릭터 시트가 저장되었습니다.",
    }


@router.post("/sheets/refine")
async def refine_sheet(
    sheet_object_name: str = Form(...),
    photo: UploadFile = File(None),
    photo_object_name: str = Form(""),
    refine_request: str = Form(...),
    image_model: str = Form("gpt_image_2"),
    role: str = Form(...),
    style: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Queue an async job to refine an existing sheet (v6).

    Input photo is stashed into MinIO and a wedding_sheet_jobs doc is inserted;
    the heavy work runs in `_run_sheet_refinement`. Client polls the job.

    Post-v6 fix: accepts either a `photo` upload OR a pre-uploaded
    `photo_object_name` (preferred — produced by /assets/upload).
    """
    user_id = current_user["id"]
    role_v = (role or "").strip().lower()
    style_v = (style or "").strip().lower()
    sheet_object_name_v = (sheet_object_name or "").strip()
    refine_request_v = (refine_request or "").strip()
    photo_object_name_v = (photo_object_name or "").strip()
    logger.info(
        "[CharRoute] /sheets/refine entry user_id=%s role=%s style=%s image_model=%s request_len=%d sheet_object=%s photo_object_provided=%s photo_file_provided=%s",
        user_id, role_v, style_v, image_model,
        len(refine_request_v), sheet_object_name_v,
        bool(photo_object_name_v),
        bool(photo is not None and (photo.filename or "")),
    )

    if role_v not in ALLOWED_ROLES:
        return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
    if style_v not in ALLOWED_STYLES:
        return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})

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

    if not sheet_object_name_v:
        return JSONResponse(
            status_code=400,
            content={"error": "sheet_object_name이 필요합니다."},
        )
    allowed_prefixes = (
        "characters/temp/{}/".format(user_id),
        "characters/{}/".format(user_id),
    )
    if not sheet_object_name_v.startswith(allowed_prefixes):
        logger.warning(
            "[CharRoute] /sheets/refine ownership reject user_id=%s sheet_object=%s",
            user_id, sheet_object_name_v,
        )
        return JSONResponse(
            status_code=403,
            content={"detail": "본인 시트만 보정할 수 있습니다."},
        )

    if not refine_request_v:
        return JSONResponse(
            status_code=400,
            content={"error": "수정 요청 내용을 입력해주세요."},
        )

    # Branch: prefer pre-uploaded photo_object_name; fall back to multipart photo.
    has_photo_file = photo is not None and (photo.filename or "") != ""
    if not photo_object_name_v and not has_photo_file:
        logger.warning(
            "[CharRoute] /sheets/refine missing photo user_id=%s role=%s style=%s",
            user_id, role_v, style_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "얼굴 사진이 필요합니다."},
        )

    photo_object: Optional[str] = None
    photo_mime: Optional[str] = None
    photo_size: int = 0

    if photo_object_name_v:
        # Ownership prefix check — /assets/upload writes objects at `{user_id}/...`.
        owner_prefix = "{}/".format(user_id)
        if not photo_object_name_v.startswith(owner_prefix):
            logger.warning(
                "[CharRoute] /sheets/refine photo ownership reject user_id=%s photo_object=%s",
                user_id, photo_object_name_v,
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "본인이 업로드한 사진만 사용할 수 있습니다."},
            )
        photo_bytes_check, photo_mime = await _load_image_from_photos(photo_object_name_v)
        if not photo_bytes_check:
            logger.warning(
                "[CharRoute] /sheets/refine photo_object not loadable user_id=%s photo_object=%s",
                user_id, photo_object_name_v,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "업로드된 얼굴 사진을 찾을 수 없습니다."},
            )
        photo_object = photo_object_name_v
        photo_size = len(photo_bytes_check)
        logger.info(
            "[CharRoute] /sheets/refine branch=pre_uploaded user_id=%s role=%s style=%s photo_object=%s photo_bytes=%d mime=%s",
            user_id, role_v, style_v, photo_object, photo_size, photo_mime,
        )
    else:
        # Validate the photo upload up-front (cheap) and stash it.
        photo_ext = os.path.splitext(photo.filename or "")[1].lower()
        if photo_ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )

        try:
            photo_object, photo_mime, photo_size = await _stash_upload_to_temp(
                photo, user_id, role_v, style_v,
            )
        except Exception as e:
            logger.exception(
                "[CharRoute] /sheets/refine stash failed user_id=%s role=%s style=%s: %s: %s",
                user_id, role_v, style_v, type(e).__name__, str(e)[:200],
            )
            return JSONResponse(
                status_code=500,
                content={"error": "입력 이미지 임시 저장에 실패했습니다."},
            )

        if photo_size == -1:
            return JSONResponse(
                status_code=400,
                content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
            )
        if photo_size == -2:
            return JSONResponse(
                status_code=400,
                content={"error": "사진 이미지가 유효하지 않습니다."},
            )
        if not photo_object or photo_size == 0:
            return JSONResponse(
                status_code=400,
                content={"error": "사진 이미지가 유효하지 않습니다."},
            )

        logger.info(
            "[CharRoute] /sheets/refine branch=stashed user_id=%s role=%s style=%s photo_object=%s photo_bytes=%d mime=%s",
            user_id, role_v, style_v, photo_object, photo_size, photo_mime,
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    job_doc = {
        "user_id": user_id,
        "type": "refine",
        "role": role_v,
        "style": style_v,
        "image_model": norm_image_model,
        "user_text": "",
        "source_sheet_object_name": sheet_object_name_v,
        "photo_object_name": photo_object,
        "refine_request": refine_request_v,
        "status": "queued",
        "progress": 0,
        "sheet_object_name": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.wedding_sheet_jobs.insert_one(job_doc)
    except Exception as e:
        logger.exception(
            "[CharRoute] /sheets/refine mongo insert failed user_id=%s role=%s style=%s: %s: %s",
            user_id, role_v, style_v, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "잡 생성에 실패했습니다."},
        )

    job_id = str(result.inserted_id)
    logger.info(
        "[SheetJob] queued job_id=%s user_id=%s role=%s style=%s image_model=%s type=refine",
        job_id, user_id, role_v, style_v, norm_image_model,
    )

    asyncio.create_task(_run_sheet_refinement(job_id))

    return {
        "job_id": job_id,
        "status": "queued",
        "role": role_v,
        "style": style_v,
    }


@router.get("/sheets/jobs/{job_id}")
async def get_sheet_job(job_id: str, current_user=Depends(get_current_user)):
    """Poll the status of a wedding_sheet_jobs entry (v6)."""
    user_id = current_user["id"]
    logger.info(
        "[CharRoute] /sheets/jobs GET entry user_id=%s job_id=%s",
        user_id, job_id,
    )

    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[CharRoute] /sheets/jobs invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 job_id 입니다."},
        )

    mongo = get_mongo()
    try:
        doc = await mongo.wedding_sheet_jobs.find_one({"_id": oid})
    except Exception as e:
        logger.exception(
            "[CharRoute] /sheets/jobs find_one failed user_id=%s job_id=%s: %s: %s",
            user_id, job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "잡 조회에 실패했습니다."},
        )

    if not doc:
        logger.warning(
            "[CharRoute] /sheets/jobs not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        return JSONResponse(status_code=404, content={"error": "잡을 찾을 수 없습니다."})
    if doc.get("user_id") != user_id:
        logger.warning(
            "[CharRoute] /sheets/jobs ownership reject user_id=%s job_id=%s owner=%s",
            user_id, job_id, doc.get("user_id"),
        )
        return JSONResponse(
            status_code=403,
            content={"detail": "접근 권한이 없습니다."},
        )

    body = _serialize_sheet_job(doc)
    logger.info(
        "[CharRoute] /sheets/jobs ok user_id=%s job_id=%s status=%s role=%s style=%s",
        user_id, job_id, body.get("status"), body.get("role"), body.get("style"),
    )
    return body


@router.get("/sheets")
async def get_sheets(current_user=Depends(get_current_user)):
    """Return all 4 sheet slots for the current user."""
    user_id = current_user["id"]
    logger.info("[CharRoute] /sheets list entry user_id=%s", user_id)

    mongo = get_mongo()
    doc = await mongo.wedding_character_sheets.find_one({"user_id": user_id})

    result = {}
    for role_v in ("groom", "bride"):
        for style_v in ("casual", "wedding"):
            slot = _slot_key(role_v, style_v)
            slot_data = ((doc or {}).get("sheets") or {}).get(slot)
            if not slot_data:
                result[slot] = None
                continue
            sheet_obj = slot_data.get("sheet_object_name") or ""
            updated_at = slot_data.get("updated_at")
            result[slot] = {
                "sheet_object_name": sheet_obj,
                "preview_url": _build_preview_url(sheet_obj) if sheet_obj else None,
                "used_items": slot_data.get("used_items") or [],
                "image_model": slot_data.get("image_model") or "gpt_image_2",
                "user_text": slot_data.get("user_text") or "",
                "updated_at": updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
            }

    filled = sum(1 for v in result.values() if v)
    logger.info(
        "[CharRoute] /sheets list ok user_id=%s slots_filled=%d/4",
        user_id, filled,
    )
    return {"sheets": result}


@router.get("/preview/{object_name:path}")
async def character_preview(
    object_name: str,
    current_user=Depends(get_current_user),
):
    """Proxy a MinIO photos-bucket object as image/png.

    Accepts auth via Authorization header OR ?token= query param (handled by
    get_current_user — same as reference). Used for <img src> tags.
    """
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        logger.info(
            "[CharRoute] /preview ok user_id=%s object=%s bytes=%d",
            user_id, object_name, len(data or b""),
        )
        return Response(content=data, media_type="image/png")
    except Exception as e:
        logger.warning(
            "[CharRoute] /preview not found user_id=%s object=%s: %s: %s",
            user_id, object_name, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )


@router.get("/outfits")
async def list_outfits(
    role: str,
    style: str,
    category: str,
    current_user=Depends(get_current_user),
):
    """List catalog items filtered by (role, style, category)."""
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    role_v = (role or "").strip().lower()
    style_v = (style or "").strip().lower()
    cat_v = (category or "").strip().lower()
    logger.info(
        "[CharRoute] /outfits entry user_id=%s role=%s style=%s category=%s",
        user_id, role_v, style_v, cat_v,
    )

    if role_v not in ALLOWED_ROLES:
        return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
    if style_v not in ALLOWED_STYLES:
        return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})
    if cat_v not in ALLOWED_OUTFIT_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": "category는 top/bottom/shoes 중 하나여야 합니다."},
        )

    mongo = get_mongo()
    try:
        cursor = mongo.wedding_outfit_items.find({
            "role": role_v,
            "style": style_v,
            "category": cat_v,
        }).sort([("created_at", 1)])
        items = []
        async for doc in cursor:
            obj = doc.get("image_object_name") or ""
            items.append({
                "id": str(doc.get("_id")) if doc.get("_id") is not None else None,
                "name": doc.get("name") or "",
                "image_object_name": obj,
                "preview_url": _build_preview_url(obj) if obj else None,
                "category": doc.get("category"),
                "role": doc.get("role"),
                "style": doc.get("style"),
            })
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits mongo list failed user_id=%s role=%s style=%s category=%s: %s: %s",
            user_id, role_v, style_v, cat_v, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "의상 카탈로그 조회에 실패했습니다."},
        )

    logger.info(
        "[CharRoute] /outfits ok user_id=%s role=%s style=%s category=%s items=%d",
        user_id, role_v, style_v, cat_v, len(items),
    )
    return {"items": items}


# ── v5: user-added outfit catalog (CRUD scoped to current user) ──────────────


def _serialize_outfit_doc(doc: dict) -> dict:
    """Shape a wedding_outfit_items mongo doc for the v5 API responses."""
    obj = doc.get("image_object_name") or ""
    created_at = doc.get("created_at")
    return {
        "id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "name": doc.get("name") or "",
        "role": doc.get("role"),
        "style": doc.get("style"),
        "category": doc.get("category"),
        "image_object_name": obj,
        "preview_url": _build_preview_url(obj) if obj else None,
        "product_url": doc.get("product_url") or "",
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        "created_by": doc.get("created_by"),
    }


@router.post("/outfits")
async def create_outfit(
    image: UploadFile = File(...),
    name: str = Form(...),
    role: str = Form(...),
    style: str = Form(...),
    category: str = Form(...),
    product_url: str = Form(""),
    current_user=Depends(get_current_user),
):
    """Create a user-added outfit catalog item (visible globally via list_outfits)."""
    user_id = current_user["id"]
    name_v = (name or "").strip()
    role_v = (role or "").strip().lower()
    style_v = (style or "").strip().lower()
    cat_v = (category or "").strip().lower()
    product_url_v = (product_url or "").strip()
    logger.info(
        "[CharRoute] /outfits POST entry user_id=%s role=%s style=%s category=%s name_len=%d product_url_len=%d",
        user_id, role_v, style_v, cat_v, len(name_v), len(product_url_v),
    )

    # Input validation
    if not (1 <= len(name_v) <= 80):
        logger.warning(
            "[CharRoute] /outfits POST invalid name user_id=%s name_len=%d role=%s style=%s category=%s",
            user_id, len(name_v), role_v, style_v, cat_v,
        )
        return JSONResponse(status_code=400, content={"error": "아이템명은 1~80자 사이여야 합니다."})
    if role_v not in ALLOWED_ROLES:
        logger.warning(
            "[CharRoute] /outfits POST invalid role user_id=%s role=%s",
            user_id, role_v,
        )
        return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
    if style_v not in ALLOWED_STYLES:
        logger.warning(
            "[CharRoute] /outfits POST invalid style user_id=%s style=%s",
            user_id, style_v,
        )
        return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})
    if cat_v not in ALLOWED_OUTFIT_CATEGORIES:
        logger.warning(
            "[CharRoute] /outfits POST invalid category user_id=%s category=%s",
            user_id, cat_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "category는 top/bottom/shoes 중 하나여야 합니다."},
        )
    if len(product_url_v) > 500:
        logger.warning(
            "[CharRoute] /outfits POST product_url too long user_id=%s len=%d",
            user_id, len(product_url_v),
        )
        return JSONResponse(status_code=400, content={"error": "구매처 URL은 500자 이하여야 합니다."})

    # Image validation
    ext = os.path.splitext(image.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        logger.warning(
            "[CharRoute] /outfits POST invalid image ext user_id=%s ext=%s role=%s style=%s category=%s",
            user_id, ext, role_v, style_v, cat_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )
    image_bytes = await image.read()
    if len(image_bytes) == 0:
        logger.warning(
            "[CharRoute] /outfits POST empty image user_id=%s role=%s style=%s category=%s",
            user_id, role_v, style_v, cat_v,
        )
        return JSONResponse(status_code=400, content={"error": "이미지 파일이 비어 있습니다."})
    if len(image_bytes) > MAX_IMAGE_SIZE:
        logger.warning(
            "[CharRoute] /outfits POST image too large user_id=%s bytes=%d role=%s style=%s category=%s",
            user_id, len(image_bytes), role_v, style_v, cat_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )
    mime_type = mimetypes.guess_type(image.filename or "")[0] or "image/jpeg"

    # MinIO put
    object_name = "outfits/user/{}/{}{}".format(user_id, uuid_lib.uuid4().hex, ext)
    minio_client = get_minio()
    try:
        logger.info(
            "[CharRoute] /outfits POST minio put begin user_id=%s object=%s bytes=%d mime=%s role=%s style=%s category=%s",
            user_id, object_name, len(image_bytes), mime_type, role_v, style_v, cat_v,
        )
        minio_client.put_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
            data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type=mime_type,
        )
        logger.info(
            "[CharRoute] /outfits POST minio put ok user_id=%s object=%s role=%s style=%s category=%s",
            user_id, object_name, role_v, style_v, cat_v,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits POST minio put failed user_id=%s object=%s role=%s style=%s category=%s: %s: %s",
            user_id, object_name, role_v, style_v, cat_v, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "이미지 저장에 실패했습니다."})

    # Mongo insert
    now = datetime.now(timezone.utc)
    new_doc = {
        "role": role_v,
        "style": style_v,
        "category": cat_v,
        "name": name_v,
        "image_object_name": object_name,
        "product_url": product_url_v,
        "source": "user",
        "created_by": user_id,
        "created_at": now,
        "updated_at": now,
    }
    mongo = get_mongo()
    try:
        logger.info(
            "[CharRoute] /outfits POST mongo insert begin user_id=%s role=%s style=%s category=%s",
            user_id, role_v, style_v, cat_v,
        )
        result = await mongo.wedding_outfit_items.insert_one(new_doc)
        new_doc["_id"] = result.inserted_id
        logger.info(
            "[CharRoute] /outfits POST mongo insert ok user_id=%s item_id=%s role=%s style=%s category=%s",
            user_id, str(result.inserted_id), role_v, style_v, cat_v,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits POST mongo insert failed user_id=%s object=%s role=%s style=%s category=%s: %s: %s",
            user_id, object_name, role_v, style_v, cat_v, type(e).__name__, str(e)[:200],
        )
        # Best-effort cleanup of orphan MinIO object
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=object_name,
            )
            logger.info(
                "[CharRoute] /outfits POST minio cleanup ok user_id=%s object=%s",
                user_id, object_name,
            )
        except Exception as e2:
            logger.warning(
                "[CharRoute] /outfits POST minio cleanup failed user_id=%s object=%s: %s: %s",
                user_id, object_name, type(e2).__name__, str(e2)[:200],
            )
        return JSONResponse(status_code=500, content={"error": "아이템 저장에 실패했습니다."})

    return _serialize_outfit_doc(new_doc)


@router.get("/outfits/mine")
async def list_my_outfits(
    role: Optional[str] = None,
    style: Optional[str] = None,
    category: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    """List the current user's own outfit items, optionally filtered."""
    user_id = current_user["id"]
    role_v = (role or "").strip().lower() if role is not None else None
    style_v = (style or "").strip().lower() if style is not None else None
    cat_v = (category or "").strip().lower() if category is not None else None
    logger.info(
        "[CharRoute] /outfits/mine entry user_id=%s role=%s style=%s category=%s",
        user_id, role_v, style_v, cat_v,
    )

    query: dict = {"created_by": user_id}
    if role_v is not None:
        if role_v not in ALLOWED_ROLES:
            logger.warning(
                "[CharRoute] /outfits/mine invalid role user_id=%s role=%s",
                user_id, role_v,
            )
            return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
        query["role"] = role_v
    if style_v is not None:
        if style_v not in ALLOWED_STYLES:
            logger.warning(
                "[CharRoute] /outfits/mine invalid style user_id=%s style=%s",
                user_id, style_v,
            )
            return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})
        query["style"] = style_v
    if cat_v is not None:
        if cat_v not in ALLOWED_OUTFIT_CATEGORIES:
            logger.warning(
                "[CharRoute] /outfits/mine invalid category user_id=%s category=%s",
                user_id, cat_v,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "category는 top/bottom/shoes 중 하나여야 합니다."},
            )
        query["category"] = cat_v

    mongo = get_mongo()
    items = []
    try:
        cursor = mongo.wedding_outfit_items.find(query).sort([("created_at", -1)])
        async for doc in cursor:
            items.append(_serialize_outfit_doc(doc))
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits/mine mongo list failed user_id=%s role=%s style=%s category=%s: %s: %s",
            user_id, role_v, style_v, cat_v, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "아이템 조회에 실패했습니다."})

    logger.info(
        "[CharRoute] /outfits/mine ok user_id=%s role=%s style=%s category=%s items=%d",
        user_id, role_v, style_v, cat_v, len(items),
    )
    return {"items": items}


@router.put("/outfits/{item_id}")
async def update_outfit(
    item_id: str,
    image: UploadFile = File(None),
    name: str = Form(None),
    role: str = Form(None),
    style: str = Form(None),
    category: str = Form(None),
    product_url: str = Form(None),
    current_user=Depends(get_current_user),
):
    """Update a user-owned outfit item. Owner-only."""
    user_id = current_user["id"]
    logger.info(
        "[CharRoute] /outfits PUT entry user_id=%s item_id=%s role=%s style=%s category=%s name_set=%s product_url_set=%s image_set=%s",
        user_id, item_id,
        role, style, category,
        name is not None, product_url is not None,
        image is not None and (image.filename or "") != "",
    )

    # ObjectId validation
    try:
        oid = ObjectId(item_id)
    except Exception as e:
        logger.warning(
            "[CharRoute] /outfits PUT invalid item_id user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=400, content={"error": "잘못된 아이템 ID입니다."})

    mongo = get_mongo()
    try:
        doc = await mongo.wedding_outfit_items.find_one({"_id": oid})
        logger.info(
            "[CharRoute] /outfits PUT mongo find_one done user_id=%s item_id=%s found=%s",
            user_id, item_id, doc is not None,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits PUT mongo find_one failed user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "아이템 조회에 실패했습니다."})

    if not doc:
        logger.warning(
            "[CharRoute] /outfits PUT not found user_id=%s item_id=%s",
            user_id, item_id,
        )
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})
    if doc.get("created_by") != user_id:
        logger.warning(
            "[CharRoute] /outfits PUT ownership reject user_id=%s item_id=%s owner=%s",
            user_id, item_id, doc.get("created_by"),
        )
        return JSONResponse(status_code=403, content={"detail": "본인 아이템만 수정할 수 있습니다."})

    # Build $set payload, validating each present field.
    set_payload: dict = {}

    if name is not None:
        name_v = (name or "").strip()
        if not (1 <= len(name_v) <= 80):
            logger.warning(
                "[CharRoute] /outfits PUT invalid name user_id=%s item_id=%s name_len=%d",
                user_id, item_id, len(name_v),
            )
            return JSONResponse(status_code=400, content={"error": "아이템명은 1~80자 사이여야 합니다."})
        set_payload["name"] = name_v

    if role is not None:
        role_v = (role or "").strip().lower()
        if role_v not in ALLOWED_ROLES:
            logger.warning(
                "[CharRoute] /outfits PUT invalid role user_id=%s item_id=%s role=%s",
                user_id, item_id, role_v,
            )
            return JSONResponse(status_code=400, content={"error": "role은 groom/bride 중 하나여야 합니다."})
        set_payload["role"] = role_v

    if style is not None:
        style_v = (style or "").strip().lower()
        if style_v not in ALLOWED_STYLES:
            logger.warning(
                "[CharRoute] /outfits PUT invalid style user_id=%s item_id=%s style=%s",
                user_id, item_id, style_v,
            )
            return JSONResponse(status_code=400, content={"error": "style은 casual/wedding 중 하나여야 합니다."})
        set_payload["style"] = style_v

    if category is not None:
        cat_v = (category or "").strip().lower()
        if cat_v not in ALLOWED_OUTFIT_CATEGORIES:
            logger.warning(
                "[CharRoute] /outfits PUT invalid category user_id=%s item_id=%s category=%s",
                user_id, item_id, cat_v,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "category는 top/bottom/shoes 중 하나여야 합니다."},
            )
        set_payload["category"] = cat_v

    if product_url is not None:
        product_url_v = (product_url or "").strip()
        if len(product_url_v) > 500:
            logger.warning(
                "[CharRoute] /outfits PUT product_url too long user_id=%s item_id=%s len=%d",
                user_id, item_id, len(product_url_v),
            )
            return JSONResponse(status_code=400, content={"error": "구매처 URL은 500자 이하여야 합니다."})
        set_payload["product_url"] = product_url_v

    # Image swap (optional)
    image_bytes, image_mime = await _read_optional_image(image)
    new_object_name: Optional[str] = None
    if image is not None and image.filename:
        # caller did attempt to send an image — validate strictly
        if image_bytes is None:
            logger.warning(
                "[CharRoute] /outfits PUT invalid image user_id=%s item_id=%s filename=%s",
                user_id, item_id, image.filename,
            )
            return JSONResponse(
                status_code=400,
                content={"error": "이미지가 유효하지 않습니다. (형식/크기 확인)"},
            )
        ext = os.path.splitext(image.filename or "")[1].lower()
        new_object_name = "outfits/user/{}/{}{}".format(user_id, uuid_lib.uuid4().hex, ext)
        minio_client = get_minio()
        try:
            logger.info(
                "[CharRoute] /outfits PUT minio put begin user_id=%s item_id=%s object=%s bytes=%d mime=%s",
                user_id, item_id, new_object_name, len(image_bytes), image_mime,
            )
            minio_client.put_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=new_object_name,
                data=io.BytesIO(image_bytes),
                length=len(image_bytes),
                content_type=image_mime,
            )
            logger.info(
                "[CharRoute] /outfits PUT minio put ok user_id=%s item_id=%s object=%s",
                user_id, item_id, new_object_name,
            )
        except Exception as e:
            logger.exception(
                "[CharRoute] /outfits PUT minio put failed user_id=%s item_id=%s object=%s: %s: %s",
                user_id, item_id, new_object_name, type(e).__name__, str(e)[:200],
            )
            return JSONResponse(status_code=500, content={"error": "이미지 저장에 실패했습니다."})

        # Best-effort delete previous object
        prev_obj = doc.get("image_object_name") or ""
        if prev_obj:
            try:
                minio_client.remove_object(
                    bucket_name=settings.minio_bucket_photos,
                    object_name=prev_obj,
                )
                logger.info(
                    "[CharRoute] /outfits PUT minio remove prev ok user_id=%s item_id=%s prev_object=%s",
                    user_id, item_id, prev_obj,
                )
            except Exception as e:
                logger.warning(
                    "[CharRoute] /outfits PUT minio remove prev failed user_id=%s item_id=%s prev_object=%s: %s: %s",
                    user_id, item_id, prev_obj, type(e).__name__, str(e)[:200],
                )
        set_payload["image_object_name"] = new_object_name

    set_payload["updated_at"] = datetime.now(timezone.utc)

    try:
        logger.info(
            "[CharRoute] /outfits PUT mongo update_one begin user_id=%s item_id=%s fields=%s",
            user_id, item_id, list(set_payload.keys()),
        )
        await mongo.wedding_outfit_items.update_one(
            {"_id": oid},
            {"$set": set_payload},
        )
        logger.info(
            "[CharRoute] /outfits PUT mongo update_one ok user_id=%s item_id=%s",
            user_id, item_id,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits PUT mongo update_one failed user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "아이템 수정에 실패했습니다."})

    try:
        updated_doc = await mongo.wedding_outfit_items.find_one({"_id": oid})
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits PUT post-update find_one failed user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "갱신된 아이템 조회에 실패했습니다."})

    return _serialize_outfit_doc(updated_doc or {})


@router.delete("/outfits/{item_id}")
async def delete_outfit(
    item_id: str,
    current_user=Depends(get_current_user),
):
    """Delete a user-owned outfit item. Owner-only."""
    user_id = current_user["id"]
    logger.info(
        "[CharRoute] /outfits DELETE entry user_id=%s item_id=%s",
        user_id, item_id,
    )

    try:
        oid = ObjectId(item_id)
    except Exception as e:
        logger.warning(
            "[CharRoute] /outfits DELETE invalid item_id user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=400, content={"error": "잘못된 아이템 ID입니다."})

    mongo = get_mongo()
    try:
        doc = await mongo.wedding_outfit_items.find_one({"_id": oid})
        logger.info(
            "[CharRoute] /outfits DELETE mongo find_one done user_id=%s item_id=%s found=%s",
            user_id, item_id, doc is not None,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits DELETE mongo find_one failed user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "아이템 조회에 실패했습니다."})

    if not doc:
        logger.warning(
            "[CharRoute] /outfits DELETE not found user_id=%s item_id=%s",
            user_id, item_id,
        )
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})
    if doc.get("created_by") != user_id:
        logger.warning(
            "[CharRoute] /outfits DELETE ownership reject user_id=%s item_id=%s owner=%s",
            user_id, item_id, doc.get("created_by"),
        )
        return JSONResponse(status_code=403, content={"detail": "본인 아이템만 삭제할 수 있습니다."})

    role_v = doc.get("role")
    style_v = doc.get("style")
    cat_v = doc.get("category")
    obj = doc.get("image_object_name") or ""

    # Best-effort MinIO remove
    if obj:
        minio_client = get_minio()
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=obj,
            )
            logger.info(
                "[CharRoute] /outfits DELETE minio remove ok user_id=%s item_id=%s object=%s role=%s style=%s category=%s",
                user_id, item_id, obj, role_v, style_v, cat_v,
            )
        except Exception as e:
            logger.warning(
                "[CharRoute] /outfits DELETE minio remove failed user_id=%s item_id=%s object=%s role=%s style=%s category=%s: %s: %s",
                user_id, item_id, obj, role_v, style_v, cat_v, type(e).__name__, str(e)[:200],
            )

    try:
        logger.info(
            "[CharRoute] /outfits DELETE mongo delete_one begin user_id=%s item_id=%s role=%s style=%s category=%s",
            user_id, item_id, role_v, style_v, cat_v,
        )
        await mongo.wedding_outfit_items.delete_one({"_id": oid})
        logger.info(
            "[CharRoute] /outfits DELETE mongo delete_one ok user_id=%s item_id=%s",
            user_id, item_id,
        )
    except Exception as e:
        logger.exception(
            "[CharRoute] /outfits DELETE mongo delete_one failed user_id=%s item_id=%s: %s: %s",
            user_id, item_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(status_code=500, content={"error": "아이템 삭제에 실패했습니다."})

    return {"message": "아이템이 삭제되었습니다."}
