"""Wedding place (location) image asset routes — v7.

Two ingest paths for a single asset type (`wedding_assets.type == "place"`):

  POST /api/places/upload     — multipart file upload (sync, no job).
  POST /api/places/generate   — JSON, fire-and-poll image generation job.

Lifecycle / management:

  GET    /api/places/jobs/{job_id}  — poll a generate job.
  GET    /api/places                — list current user's place assets.
  PUT    /api/places/{place_id}     — patch display_name / memo.
  DELETE /api/places/{place_id}     — remove asset + MinIO + job docs.

All logs use prefix `[PlaceRoute]` plus traceability fields
(`user_id`, `place_id`, `job_id` when relevant). Background task lines use
`[PlaceJob]`. Sensitive payloads (API keys, raw bytes) are never logged —
only sizes and identifiers.
"""

import asyncio
import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.place_generator import (
    ALLOWED_PLACE_IMAGE_MODELS,
    generate_place_image,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/places", tags=["Places"])


# ── Constants ────────────────────────────────────────────────────────────────

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_DISPLAY_NAME_LEN = 80
MAX_MEMO_LEN = 500


# ── Helpers ──────────────────────────────────────────────────────────────────


def _build_preview_url(object_name: Optional[str]) -> Optional[str]:
    """Reuse the character preview proxy (it accepts arbitrary MinIO keys)."""
    if not object_name:
        return None
    return "/api/character/preview/{}".format(object_name)


def _to_oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def _iso(dt) -> Optional[str]:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt


def _serialize_place_asset(doc: dict) -> dict:
    """Shape a wedding_assets (type=place) doc for API responses."""
    obj = doc.get("object_name") or ""
    meta = doc.get("meta") or {}
    return {
        "place_id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "display_name": doc.get("display_name") or "",
        "memo": meta.get("memo") or "",
        "source": doc.get("source"),
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "image_model": meta.get("image_model"),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


def _serialize_place_job(doc: dict) -> dict:
    """Shape a wedding_place_jobs doc for the polling endpoint."""
    obj = doc.get("object_name") or ""
    return {
        "job_id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "place_id": str(doc.get("place_id")) if doc.get("place_id") is not None else None,
        "status": doc.get("status", "queued"),
        "display_name": doc.get("display_name") or "",
        "image_model": doc.get("image_model"),
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "error_message": doc.get("error_message"),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


async def _put_minio_bytes(object_name: str, data: bytes, content_type: str) -> None:
    """Synchronous MinIO put helper — mirrors character.py."""
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_photos,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


async def _remove_minio_object(object_name: str) -> bool:
    """Best-effort MinIO object delete. Returns True when remove call did not raise."""
    if not object_name:
        return False
    minio_client = get_minio()
    try:
        minio_client.remove_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PlaceRoute] minio remove failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return False


# ── Pydantic bodies ─────────────────────────────────────────────────────────


class GeneratePlaceRequest(BaseModel):
    display_name: str
    memo: Optional[str] = ""
    image_model: Optional[str] = "gpt_image_2"


class UpdatePlaceRequest(BaseModel):
    display_name: Optional[str] = None
    memo: Optional[str] = None


# ── POST /upload ─────────────────────────────────────────────────────────────


@router.post("/upload")
async def upload_place(
    image: UploadFile = File(...),
    display_name: str = Form(...),
    memo: str = Form(""),
    owner_user_id: str = Form(""),
    current_user=Depends(get_current_user),
):
    """Upload a place image — sync path, no background job.

    v13: `owner_user_id` (옵션) — admin role 일 때만 다른 사용자 명의로 등록
    가능. 비admin 이 owner_user_id 를 보내면 403.
    """
    caller_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    name_v = (display_name or "").strip()
    memo_v = (memo or "").strip()
    requested_owner = (owner_user_id or "").strip()

    # Resolve target owner --------------------------------------------------
    if requested_owner and requested_owner != caller_id:
        if not is_admin:
            logger.warning(
                "[PlaceRoute] /upload owner override forbidden caller_id=%s "
                "owner_user_id=%s",
                caller_id, requested_owner,
            )
            return JSONResponse(
                status_code=403,
                content={"error": "다른 사용자 명의로 등록할 권한이 없습니다."},
            )
        user_id = requested_owner
        logger.info(
            "[PlaceRoute] admin_owner admin_id=%s owner_user_id=%s",
            caller_id, user_id,
        )
    else:
        user_id = caller_id

    logger.info(
        "[PlaceRoute] /upload entry user_id=%s caller_id=%s is_admin=%s "
        "display_name_len=%d memo_len=%d filename=%s",
        user_id, caller_id, is_admin,
        len(name_v), len(memo_v), (image.filename or "")[:120],
    )

    # Validation
    if not (1 <= len(name_v) <= MAX_DISPLAY_NAME_LEN):
        logger.warning(
            "[PlaceRoute] /upload invalid display_name user_id=%s len=%d",
            user_id, len(name_v),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름은 1~80자 사이여야 합니다."},
        )
    if len(memo_v) > MAX_MEMO_LEN:
        logger.warning(
            "[PlaceRoute] /upload invalid memo user_id=%s len=%d",
            user_id, len(memo_v),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "메모는 500자 이하여야 합니다."},
        )
    if image is None or not (image.filename or ""):
        return JSONResponse(
            status_code=400, content={"error": "이미지 파일이 필요합니다."},
        )
    ext = os.path.splitext(image.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        logger.warning(
            "[PlaceRoute] /upload invalid ext user_id=%s ext=%s",
            user_id, ext,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "이미지는 jpg/jpeg/png/webp 만 허용됩니다."},
        )
    try:
        data = await image.read()
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /upload read failed user_id=%s: %s: %s",
            user_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=400, content={"error": "이미지를 읽을 수 없습니다."},
        )
    if not data:
        return JSONResponse(
            status_code=400, content={"error": "빈 이미지 파일입니다."},
        )
    if len(data) > MAX_IMAGE_SIZE:
        logger.warning(
            "[PlaceRoute] /upload oversize user_id=%s bytes=%d",
            user_id, len(data),
        )
        return JSONResponse(
            status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    # Pre-issue place_id and store at permanent path.
    place_oid = ObjectId()
    place_id = str(place_oid)
    object_name = "places/{}/{}{}".format(user_id, place_id, ext)
    mime = mimetypes.guess_type(image.filename)[0] or "image/jpeg"

    try:
        await _put_minio_bytes(object_name, data, mime)
        logger.info(
            "[PlaceRoute] /upload minio put ok user_id=%s place_id=%s object=%s bytes=%d",
            user_id, place_id, object_name, len(data),
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /upload minio put failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500, content={"error": "이미지 업로드에 실패했습니다."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    asset_doc = {
        "_id": place_oid,
        "user_id": user_id,
        "type": "place",
        "display_name": name_v,
        "source": "uploaded",
        "object_name": object_name,
        "meta": {
            "memo": memo_v,
            "image_model": None,
        },
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.wedding_assets.insert_one(asset_doc)
        logger.info(
            "[PlaceRoute] /upload mongo insert ok user_id=%s place_id=%s",
            user_id, place_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /upload mongo insert failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        # Cleanup MinIO object.
        await _remove_minio_object(object_name)
        return JSONResponse(
            status_code=500, content={"error": "장소 자산 저장에 실패했습니다."},
        )

    return _serialize_place_asset(asset_doc)


# ── POST /generate ───────────────────────────────────────────────────────────


@router.post("/generate")
async def generate_place(
    body: GeneratePlaceRequest,
    current_user=Depends(get_current_user),
):
    """Kick off a place image generation job and return queued status."""
    user_id = current_user["id"]
    name_v = (body.display_name or "").strip()
    memo_v = (body.memo or "").strip()
    image_model_v = (body.image_model or "gpt_image_2").strip() or "gpt_image_2"
    logger.info(
        "[PlaceRoute] /generate entry user_id=%s display_name_len=%d memo_len=%d image_model=%s",
        user_id, len(name_v), len(memo_v), image_model_v,
    )

    # Validation
    if not (1 <= len(name_v) <= MAX_DISPLAY_NAME_LEN):
        logger.warning(
            "[PlaceRoute] /generate invalid display_name user_id=%s len=%d",
            user_id, len(name_v),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이름은 1~80자 사이여야 합니다."},
        )
    if len(memo_v) > MAX_MEMO_LEN:
        logger.warning(
            "[PlaceRoute] /generate invalid memo user_id=%s len=%d",
            user_id, len(memo_v),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "메모는 500자 이하여야 합니다."},
        )
    if image_model_v not in ALLOWED_PLACE_IMAGE_MODELS:
        logger.warning(
            "[PlaceRoute] /generate invalid image_model user_id=%s image_model=%s",
            user_id, image_model_v,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "image_model은 gpt_image_2/nb_pro 중 하나여야 합니다."},
        )
    if image_model_v == "gpt_image_2" and not settings.openai_api_key:
        logger.warning(
            "[PlaceRoute] /generate openai key missing user_id=%s",
            user_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 이미지 모델이 구성되어 있지 않습니다."},
        )
    if image_model_v == "nb_pro" and not settings.google_api_key:
        logger.warning(
            "[PlaceRoute] /generate google key missing user_id=%s",
            user_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini 이미지 모델이 구성되어 있지 않습니다."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    place_oid = ObjectId()
    place_id = str(place_oid)

    asset_doc = {
        "_id": place_oid,
        "user_id": user_id,
        "type": "place",
        "display_name": name_v,
        "source": "generated",
        "object_name": None,
        "meta": {
            "memo": memo_v,
            "image_model": image_model_v,
        },
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.wedding_assets.insert_one(asset_doc)
        logger.info(
            "[PlaceRoute] /generate asset insert ok user_id=%s place_id=%s image_model=%s",
            user_id, place_id, image_model_v,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /generate asset insert failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500, content={"error": "장소 자산 저장에 실패했습니다."},
        )

    job_doc = {
        "user_id": user_id,
        "place_id": place_oid,
        "type": "generate",
        "status": "queued",
        "image_model": image_model_v,
        "display_name": name_v,
        "memo": memo_v,
        "object_name": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.wedding_place_jobs.insert_one(job_doc)
        job_id = str(result.inserted_id)
        logger.info(
            "[PlaceRoute] /generate job insert ok user_id=%s place_id=%s job_id=%s",
            user_id, place_id, job_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /generate job insert failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        # Best-effort cleanup of the asset doc — it has no object yet.
        try:
            await mongo.wedding_assets.delete_one({"_id": place_oid})
        except Exception:
            pass
        return JSONResponse(
            status_code=500, content={"error": "장소 이미지 잡 생성에 실패했습니다."},
        )

    asyncio.create_task(_run_place_generation(job_id))
    logger.info(
        "[PlaceRoute] /generate task scheduled user_id=%s place_id=%s job_id=%s",
        user_id, place_id, job_id,
    )
    return {"place_id": place_id, "job_id": job_id, "status": "queued"}


# ── GET /jobs/{job_id} ──────────────────────────────────────────────────────


@router.get("/jobs/{job_id}")
async def get_place_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    logger.info(
        "[PlaceRoute] /jobs entry user_id=%s job_id=%s",
        user_id, job_id,
    )
    oid = _to_oid(job_id)
    if oid is None:
        logger.warning(
            "[PlaceRoute] /jobs invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        return JSONResponse(
            status_code=400, content={"error": "유효하지 않은 job_id 입니다."},
        )

    mongo = get_mongo()
    doc = await mongo.wedding_place_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[PlaceRoute] /jobs not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        return JSONResponse(
            status_code=404, content={"error": "잡을 찾을 수 없습니다."},
        )
    if doc.get("user_id") != user_id:
        logger.warning(
            "[PlaceRoute] /jobs forbidden user_id=%s job_id=%s owner=%s",
            user_id, job_id, doc.get("user_id"),
        )
        return JSONResponse(
            status_code=403, content={"error": "권한이 없습니다."},
        )

    body = _serialize_place_job(doc)
    logger.info(
        "[PlaceRoute] /jobs ok user_id=%s job_id=%s place_id=%s status=%s",
        user_id, job_id, body.get("place_id"), body.get("status"),
    )
    return body


# ── GET / (list) ─────────────────────────────────────────────────────────────


@router.get("")
async def list_places(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    logger.info("[PlaceRoute] /list entry user_id=%s", user_id)
    mongo = get_mongo()
    try:
        cursor = mongo.wedding_assets.find(
            {"user_id": user_id, "type": "place"}
        ).sort([("created_at", -1)])
        items = []
        async for doc in cursor:
            items.append(_serialize_place_asset(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /list mongo failed user_id=%s: %s: %s",
            user_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500, content={"error": "장소 자산 조회에 실패했습니다."},
        )

    logger.info(
        "[PlaceRoute] /list ok user_id=%s count=%d",
        user_id, len(items),
    )
    return {"items": items}


# ── PUT /{place_id} ──────────────────────────────────────────────────────────


@router.put("/{place_id}")
async def update_place(
    place_id: str,
    body: UpdatePlaceRequest,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    logger.info(
        "[PlaceRoute] /update entry user_id=%s place_id=%s",
        user_id, place_id,
    )
    oid = _to_oid(place_id)
    if oid is None:
        logger.warning(
            "[PlaceRoute] /update invalid place_id user_id=%s place_id=%s",
            user_id, place_id,
        )
        return JSONResponse(
            status_code=400, content={"error": "유효하지 않은 place_id 입니다."},
        )

    if body.display_name is None and body.memo is None:
        return JSONResponse(
            status_code=400,
            content={"error": "display_name 또는 memo 중 하나는 필요합니다."},
        )

    set_doc: dict = {}
    if body.display_name is not None:
        name_v = (body.display_name or "").strip()
        if not (1 <= len(name_v) <= MAX_DISPLAY_NAME_LEN):
            logger.warning(
                "[PlaceRoute] /update invalid display_name user_id=%s place_id=%s len=%d",
                user_id, place_id, len(name_v),
            )
            return JSONResponse(
                status_code=400,
                content={"error": "장소 이름은 1~80자 사이여야 합니다."},
            )
        set_doc["display_name"] = name_v
    if body.memo is not None:
        memo_v = (body.memo or "").strip()
        if len(memo_v) > MAX_MEMO_LEN:
            logger.warning(
                "[PlaceRoute] /update invalid memo user_id=%s place_id=%s len=%d",
                user_id, place_id, len(memo_v),
            )
            return JSONResponse(
                status_code=400, content={"error": "메모는 500자 이하여야 합니다."},
            )
        set_doc["meta.memo"] = memo_v

    mongo = get_mongo()
    existing = await mongo.wedding_assets.find_one(
        {"_id": oid, "type": "place"}
    )
    if not existing:
        logger.warning(
            "[PlaceRoute] /update not found user_id=%s place_id=%s",
            user_id, place_id,
        )
        return JSONResponse(
            status_code=404, content={"error": "장소 자산을 찾을 수 없습니다."},
        )
    if existing.get("user_id") != user_id:
        logger.warning(
            "[PlaceRoute] /update forbidden user_id=%s place_id=%s owner=%s",
            user_id, place_id, existing.get("user_id"),
        )
        return JSONResponse(
            status_code=403, content={"error": "권한이 없습니다."},
        )

    now = datetime.now(timezone.utc)
    set_doc["updated_at"] = now
    try:
        await mongo.wedding_assets.update_one(
            {"_id": oid, "user_id": user_id, "type": "place"},
            {"$set": set_doc},
        )
        logger.info(
            "[PlaceRoute] /update ok user_id=%s place_id=%s fields=%s",
            user_id, place_id, sorted(set_doc.keys()),
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /update mongo failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500, content={"error": "장소 자산 수정에 실패했습니다."},
        )

    updated = await mongo.wedding_assets.find_one({"_id": oid})
    return _serialize_place_asset(updated or {})


# ── DELETE /{place_id} ──────────────────────────────────────────────────────


@router.delete("/{place_id}")
async def delete_place(
    place_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    logger.info(
        "[PlaceRoute] /delete entry user_id=%s place_id=%s",
        user_id, place_id,
    )
    oid = _to_oid(place_id)
    if oid is None:
        logger.warning(
            "[PlaceRoute] /delete invalid place_id user_id=%s place_id=%s",
            user_id, place_id,
        )
        return JSONResponse(
            status_code=400, content={"error": "유효하지 않은 place_id 입니다."},
        )

    mongo = get_mongo()
    existing = await mongo.wedding_assets.find_one(
        {"_id": oid, "type": "place"}
    )
    if not existing:
        logger.warning(
            "[PlaceRoute] /delete not found user_id=%s place_id=%s",
            user_id, place_id,
        )
        return JSONResponse(
            status_code=404, content={"error": "장소 자산을 찾을 수 없습니다."},
        )
    if existing.get("user_id") != user_id:
        logger.warning(
            "[PlaceRoute] /delete forbidden user_id=%s place_id=%s owner=%s",
            user_id, place_id, existing.get("user_id"),
        )
        return JSONResponse(
            status_code=403, content={"error": "권한이 없습니다."},
        )

    obj = existing.get("object_name") or ""
    if obj:
        removed = await _remove_minio_object(obj)
        logger.info(
            "[PlaceRoute] /delete minio remove user_id=%s place_id=%s object=%s ok=%s",
            user_id, place_id, obj, removed,
        )

    try:
        await mongo.wedding_assets.delete_one({"_id": oid, "user_id": user_id})
        logger.info(
            "[PlaceRoute] /delete asset doc removed user_id=%s place_id=%s",
            user_id, place_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceRoute] /delete asset doc remove failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500, content={"error": "장소 자산 삭제에 실패했습니다."},
        )

    try:
        deleted = await mongo.wedding_place_jobs.delete_many(
            {"place_id": oid, "user_id": user_id}
        )
        logger.info(
            "[PlaceRoute] /delete jobs removed user_id=%s place_id=%s count=%d",
            user_id, place_id, deleted.deleted_count,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PlaceRoute] /delete jobs remove failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )

    return {"ok": True}


# ── Background task: generation job runner ──────────────────────────────────


async def _run_place_generation(job_id: str) -> None:
    """Drive a wedding_place_jobs `generate` job to done/failed."""
    mongo = get_mongo()
    oid = _to_oid(job_id)
    if oid is None:
        logger.warning("[PlaceJob] invalid job_id job_id=%s — skipping", job_id)
        return

    job = await mongo.wedding_place_jobs.find_one({"_id": oid})
    if not job:
        logger.warning("[PlaceJob] job not found job_id=%s — skipping", job_id)
        return

    user_id = job.get("user_id")
    place_oid = job.get("place_id")
    place_id = str(place_oid) if place_oid is not None else None
    image_model_v = job.get("image_model") or "gpt_image_2"
    display_name_v = job.get("display_name") or ""
    memo_v = job.get("memo") or ""

    logger.info(
        "[PlaceJob] start user_id=%s place_id=%s job_id=%s image_model=%s",
        user_id, place_id, job_id, image_model_v,
    )

    now = datetime.now(timezone.utc)
    try:
        await mongo.wedding_place_jobs.update_one(
            {"_id": oid},
            {"$set": {"status": "running", "updated_at": now}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PlaceJob] running mark failed user_id=%s place_id=%s job_id=%s: %s: %s",
            user_id, place_id, job_id, type(e).__name__, str(e)[:200],
        )

    try:
        logger.info(
            "[PlaceJob] calling place_generator user_id=%s place_id=%s job_id=%s",
            user_id, place_id, job_id,
        )
        image_bytes = await generate_place_image(
            display_name=display_name_v,
            memo=memo_v,
            image_model=image_model_v,
            user_id=user_id,
            place_id=place_id,
        )
        logger.info(
            "[PlaceJob] place_generator ok user_id=%s place_id=%s job_id=%s bytes=%d",
            user_id, place_id, job_id, len(image_bytes or b""),
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PlaceJob] generation failed user_id=%s place_id=%s job_id=%s: %s",
            user_id, place_id, job_id, err_text,
        )
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.wedding_place_jobs.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error_message": err_text,
                    "updated_at": finish_now,
                }},
            )
        except Exception:
            logger.exception(
                "[PlaceJob] failed mark write failed user_id=%s place_id=%s job_id=%s",
                user_id, place_id, job_id,
            )
        try:
            await mongo.wedding_assets.update_one(
                {"_id": place_oid, "user_id": user_id, "type": "place"},
                {"$set": {"updated_at": finish_now}},
            )
        except Exception:
            pass
        return

    # Persist bytes — temp first, then copy to permanent.
    temp_object = "places/temp/{}/{}_{}.png".format(
        user_id, place_id, uuid_lib.uuid4().hex,
    )
    permanent_object = "places/{}/{}.png".format(user_id, place_id)
    try:
        await _put_minio_bytes(temp_object, image_bytes, "image/png")
        logger.info(
            "[PlaceJob] temp put ok user_id=%s place_id=%s job_id=%s object=%s bytes=%d",
            user_id, place_id, job_id, temp_object, len(image_bytes),
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PlaceJob] temp put failed user_id=%s place_id=%s job_id=%s: %s",
            user_id, place_id, job_id, err_text,
        )
        await mongo.wedding_place_jobs.update_one(
            {"_id": oid},
            {"$set": {
                "status": "failed",
                "error_message": err_text,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return

    try:
        await _put_minio_bytes(permanent_object, image_bytes, "image/png")
        logger.info(
            "[PlaceJob] permanent put ok user_id=%s place_id=%s job_id=%s object=%s",
            user_id, place_id, job_id, permanent_object,
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PlaceJob] permanent put failed user_id=%s place_id=%s job_id=%s: %s",
            user_id, place_id, job_id, err_text,
        )
        await mongo.wedding_place_jobs.update_one(
            {"_id": oid},
            {"$set": {
                "status": "failed",
                "error_message": err_text,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return

    # Best-effort temp cleanup (don't fail the job).
    await _remove_minio_object(temp_object)

    finish_now = datetime.now(timezone.utc)
    try:
        await mongo.wedding_assets.update_one(
            {"_id": place_oid, "user_id": user_id, "type": "place"},
            {"$set": {
                "object_name": permanent_object,
                "updated_at": finish_now,
            }},
        )
        logger.info(
            "[PlaceJob] asset update ok user_id=%s place_id=%s job_id=%s",
            user_id, place_id, job_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceJob] asset update failed user_id=%s place_id=%s job_id=%s: %s: %s",
            user_id, place_id, job_id, type(e).__name__, str(e)[:200],
        )

    try:
        await mongo.wedding_place_jobs.update_one(
            {"_id": oid},
            {"$set": {
                "status": "done",
                "object_name": permanent_object,
                "error_message": None,
                "updated_at": finish_now,
            }},
        )
        logger.info(
            "[PlaceJob] done user_id=%s place_id=%s job_id=%s",
            user_id, place_id, job_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PlaceJob] done mark failed user_id=%s place_id=%s job_id=%s: %s: %s",
            user_id, place_id, job_id, type(e).__name__, str(e)[:200],
        )
