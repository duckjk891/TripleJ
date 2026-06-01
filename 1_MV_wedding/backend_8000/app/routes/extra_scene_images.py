"""
v23.1 — Extra Scene Images (편집자 공간 — Higgsfield 스타일 씬이미지 A 보드).

prefix: `/api/extra/scene-images`.

v23.0 스켈레톤(인증/owner 가드/Mongo CRUD)에 실 본문(이미지 생성 백그라운드 잡 +
MinIO 저장 + 다운로드)을 채운다. 생성 호출은 `extra_scene_image_generator
.generate_extra_scene_image` 으로 위임한다.

로그 prefix: `[ExtraSceneImagesRoute]` / 백그라운드는 `[ExtraSceneImagesRoute][bg]`.
추적자: `extra_scene_image_id`, `mv_job_id`, `user_id`, `is_admin`, `image_model`.
민감 정보(API 키, 본문 전체) 출력 금지. 본문은 길이만 로깅.
"""

from __future__ import annotations

import asyncio
import io
import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.extra_scene_image_generator import (
    MAX_REFS as _GEN_MAX_REFS,
    generate_extra_scene_image,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/extra/scene-images",
    tags=["ExtraSceneImages"],
)


ALLOWED_IMAGE_MODELS = ("gpt_image_2", "nb_pro")


# ── Helpers ──────────────────────────────────────────────────────────────────


def _to_oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def _iso(dt) -> Optional[str]:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt


def _build_preview_url(object_name: Optional[str]) -> Optional[str]:
    if not object_name:
        return None
    return "/api/character/preview/{}".format(object_name)


def _serialize_extra_scene_image(d: dict) -> dict:
    obj = d.get("object_name") or ""
    return {
        "extra_scene_image_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "mv_job_id": d.get("mv_job_id"),
        "user_id": d.get("user_id"),
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "status": d.get("status", "queued"),
        "image_model": d.get("image_model"),
        "user_text": d.get("user_text") or "",
        "refs": d.get("refs") or [],
        "extra_image_object_names": d.get("extra_image_object_names") or [],
        "error_message": d.get("error_message"),
        "created_at": _iso(d.get("created_at")),
        "updated_at": _iso(d.get("updated_at")),
    }


async def _resolve_mv_job(mv_job_id: str, current_user: dict):
    """Return (mv_job_doc, owner_user_id, is_admin) or JSONResponse 400/404/403.

    Mirrors `wedding_photos._resolve_mv_job`.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    oid = _to_oid(mv_job_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 mv_job_id 입니다."},
        )
    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": oid})
    if not job:
        return JSONResponse(
            status_code=404,
            content={"error": "잡을 찾을 수 없습니다."},
        )
    owner_user_id = job.get("user_id")
    is_owner = owner_user_id == user_id
    if not is_owner and not is_admin:
        return JSONResponse(
            status_code=403,
            content={"error": "접근 권한이 없습니다."},
        )
    return job, owner_user_id, is_admin


async def _resolve_extra_scene_image(
    extra_scene_image_id: str, current_user: dict
):
    """Return (doc, owner_user_id, is_admin) or JSONResponse.

    owner+admin 가드. 404 통일(존재하지만 owner 아닌 비-admin 도 404).
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    oid = _to_oid(extra_scene_image_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 extra_scene_image_id 입니다."},
        )
    mongo = get_mongo()
    doc = await mongo.extra_scene_images.find_one({"_id": oid})
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "씬 이미지를 찾을 수 없습니다."},
        )
    owner_user_id = doc.get("user_id")
    is_owner = owner_user_id == user_id
    if not is_owner and not is_admin:
        logger.warning(
            "[ExtraSceneImagesRoute] _resolve owner mismatch user_id=%s "
            "extra_scene_image_id=%s asset_owner=%s",
            user_id, extra_scene_image_id, owner_user_id,
        )
        return JSONResponse(
            status_code=404,
            content={"error": "씬 이미지를 찾을 수 없습니다."},
        )
    return doc, owner_user_id, is_admin


async def _remove_minio_object(object_name: str) -> bool:
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
            "[ExtraSceneImagesRoute] minio remove failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return False


# ── Pydantic body ────────────────────────────────────────────────────────────


class ExtraSceneImageCreate(BaseModel):
    """v23.1 에서 본문이 채워짐. v23.0 은 placeholder 로 응답."""
    mv_job_id: str = Field(..., min_length=1)
    refs: list[dict] = Field(default_factory=list)
    extra_image_object_names: list[str] = Field(default_factory=list)
    user_text: str = Field(default="", max_length=4000)
    image_model: Literal["gpt_image_2", "nb_pro"] = "gpt_image_2"


class BulkIds(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=50)


# ── POST / ──────────────────────────────────────────────────────────────────


@router.post("")
async def create_extra_scene_image(
    body: ExtraSceneImageCreate,
    current_user=Depends(get_current_user),
):
    """v23.1 — owner/admin 가드 → 입력 검증 → queued doc 생성 → 백그라운드 잡 시작."""
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    refs_count = len(body.refs or [])
    uploaded_count = len(body.extra_image_object_names or [])
    logger.info(
        "[ExtraSceneImagesRoute] POST / entry user_id=%s is_admin=%s mv_job_id=%s "
        "image_model=%s text_len=%d refs=%d uploaded=%d",
        user_id, is_admin, body.mv_job_id, body.image_model,
        len(body.user_text or ""), refs_count, uploaded_count,
    )

    resolved = await _resolve_mv_job(body.mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    # ── 입력 검증 ─────────────────────────────────────────────────────────
    total_refs = refs_count + uploaded_count
    if total_refs > _GEN_MAX_REFS:
        logger.warning(
            "[ExtraSceneImagesRoute] POST too many refs user_id=%s mv_job_id=%s "
            "refs=%d uploaded=%d max=%d",
            user_id, body.mv_job_id, refs_count, uploaded_count, _GEN_MAX_REFS,
        )
        return JSONResponse(
            status_code=400,
            content={
                "error": "참조 자산은 (멘션 + 업로드) 합산 최대 {}장입니다.".format(
                    _GEN_MAX_REFS,
                ),
            },
        )

    if total_refs == 0 and not (body.user_text or "").strip():
        return JSONResponse(
            status_code=400,
            content={"error": "지시문 또는 참조 이미지 중 1개 이상은 필요합니다."},
        )

    # ── 이미지 모델 키 게이팅 (503) ───────────────────────────────────────
    if body.image_model == "gpt_image_2" and not settings.openai_api_key:
        logger.warning(
            "[ExtraSceneImagesRoute] POST openai key missing user_id=%s mv_job_id=%s",
            user_id, body.mv_job_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 이미지 모델이 구성되어 있지 않습니다."},
        )
    if body.image_model == "nb_pro" and not settings.google_api_key:
        logger.warning(
            "[ExtraSceneImagesRoute] POST google key missing user_id=%s mv_job_id=%s",
            user_id, body.mv_job_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini 이미지 모델이 구성되어 있지 않습니다."},
        )

    # ── doc insert ───────────────────────────────────────────────────────
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    new_oid = ObjectId()
    doc = {
        "_id": new_oid,
        "mv_job_id": body.mv_job_id,
        "user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "status": "queued",
        "object_name": None,
        "image_model": body.image_model,
        "user_text": (body.user_text or ""),
        "refs": body.refs or [],
        "extra_image_object_names": body.extra_image_object_names or [],
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.extra_scene_images.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraSceneImagesRoute] POST insert failed user_id=%s mv_job_id=%s: %s: %s",
            user_id, body.mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 이미지 잡 생성에 실패했습니다."},
        )

    extra_scene_image_id = str(new_oid)
    logger.info(
        "[ExtraSceneImagesRoute] POST queued user_id=%s mv_job_id=%s "
        "extra_scene_image_id=%s image_model=%s",
        user_id, body.mv_job_id, extra_scene_image_id, body.image_model,
    )

    # ── 백그라운드 잡 시작 ────────────────────────────────────────────────
    asyncio.create_task(
        _run_extra_scene_image_generation(
            extra_scene_image_id=extra_scene_image_id,
            mv_job_id=body.mv_job_id,
            owner_user_id=owner_user_id,
            refs=list(body.refs or []),
            extra_image_object_names=list(body.extra_image_object_names or []),
            user_text=body.user_text or "",
            image_model=body.image_model,
        )
    )

    return {
        "extra_scene_image_id": extra_scene_image_id,
        "status": "queued",
    }


# ── Background task ─────────────────────────────────────────────────────────


async def _run_extra_scene_image_generation(
    *,
    extra_scene_image_id: str,
    mv_job_id: str,
    owner_user_id: str,
    refs: list[dict],
    extra_image_object_names: list[str],
    user_text: str,
    image_model: str,
) -> None:
    """Drive an extra_scene_images doc from queued → generating → completed/failed."""
    mongo = get_mongo()
    oid = _to_oid(extra_scene_image_id)
    if oid is None:
        logger.warning(
            "[ExtraSceneImagesRoute][bg] invalid extra_scene_image_id=%s — skipping",
            extra_scene_image_id,
        )
        return

    logger.info(
        "[ExtraSceneImagesRoute][bg] start extra_scene_image_id=%s mv_job_id=%s "
        "user_id=%s image_model=%s refs=%d uploaded=%d",
        extra_scene_image_id, mv_job_id, owner_user_id, image_model,
        len(refs or []), len(extra_image_object_names or []),
    )

    now = datetime.now(timezone.utc)
    try:
        await mongo.extra_scene_images.update_one(
            {"_id": oid},
            {"$set": {"status": "generating", "updated_at": now}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImagesRoute][bg] generating mark failed "
            "extra_scene_image_id=%s: %s: %s",
            extra_scene_image_id, type(e).__name__, str(e)[:200],
        )

    try:
        result = await generate_extra_scene_image(
            extra_scene_image_id=extra_scene_image_id,
            mv_job_id=mv_job_id,
            user_id=owner_user_id,
            refs=refs,
            extra_image_object_names=extra_image_object_names,
            user_text=user_text,
            image_model=image_model,
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[ExtraSceneImagesRoute][bg] generation failed extra_scene_image_id=%s "
            "mv_job_id=%s image_model=%s: %s",
            extra_scene_image_id, mv_job_id, image_model, err_text,
        )
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.extra_scene_images.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error_message": err_text,
                    "updated_at": finish_now,
                }},
            )
        except Exception:
            logger.exception(
                "[ExtraSceneImagesRoute][bg] failed-mark write failed "
                "extra_scene_image_id=%s",
                extra_scene_image_id,
            )
        return

    object_name = result.get("object_name") or ""
    finish_now = datetime.now(timezone.utc)
    try:
        await mongo.extra_scene_images.update_one(
            {"_id": oid},
            {"$set": {
                "status": "completed",
                "object_name": object_name or None,
                "error_message": None,
                "updated_at": finish_now,
            }},
        )
        logger.info(
            "[ExtraSceneImagesRoute][bg] completed extra_scene_image_id=%s "
            "mv_job_id=%s image_model=%s object=%s",
            extra_scene_image_id, mv_job_id, image_model, object_name,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraSceneImagesRoute][bg] completed mark failed "
            "extra_scene_image_id=%s mv_job_id=%s: %s: %s",
            extra_scene_image_id, mv_job_id, type(e).__name__, str(e)[:200],
        )


# ── GET / ───────────────────────────────────────────────────────────────────


@router.get("")
async def list_extra_scene_images(
    mv_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraSceneImagesRoute] GET list entry user_id=%s is_admin=%s mv_job_id=%s",
        user_id, is_admin, mv_job_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()
    items: list[dict] = []
    try:
        cursor = mongo.extra_scene_images.find({
            "user_id": owner_user_id,
            "mv_job_id": mv_job_id,
        }).sort("created_at", -1)
        async for doc in cursor:
            items.append(_serialize_extra_scene_image(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraSceneImagesRoute] GET list mongo failed user_id=%s "
            "mv_job_id=%s: %s: %s",
            user_id, mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 이미지 목록 조회에 실패했습니다."},
        )

    logger.info(
        "[ExtraSceneImagesRoute] GET list ok user_id=%s mv_job_id=%s count=%d",
        user_id, mv_job_id, len(items),
    )
    return {"items": items}


# ── GET /{id} ───────────────────────────────────────────────────────────────


@router.get("/{extra_scene_image_id}")
async def get_extra_scene_image(
    extra_scene_image_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraSceneImagesRoute] GET detail entry user_id=%s is_admin=%s "
        "extra_scene_image_id=%s",
        user_id, is_admin, extra_scene_image_id,
    )
    resolved = await _resolve_extra_scene_image(extra_scene_image_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    body = _serialize_extra_scene_image(doc)
    logger.info(
        "[ExtraSceneImagesRoute] GET detail ok user_id=%s extra_scene_image_id=%s "
        "mv_job_id=%s status=%s",
        user_id, extra_scene_image_id, body.get("mv_job_id"), body.get("status"),
    )
    return body


# ── DELETE /{id} ────────────────────────────────────────────────────────────


@router.delete("/{extra_scene_image_id}")
async def delete_extra_scene_image(
    extra_scene_image_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraSceneImagesRoute] DELETE entry user_id=%s is_admin=%s "
        "extra_scene_image_id=%s",
        user_id, is_admin, extra_scene_image_id,
    )
    resolved = await _resolve_extra_scene_image(extra_scene_image_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    obj = doc.get("object_name") or ""
    if obj:
        removed = await _remove_minio_object(obj)
        logger.info(
            "[ExtraSceneImagesRoute] DELETE minio remove user_id=%s "
            "extra_scene_image_id=%s object=%s ok=%s",
            user_id, extra_scene_image_id, obj, removed,
        )

    mongo = get_mongo()
    try:
        await mongo.extra_scene_images.delete_one({"_id": doc["_id"]})
        logger.info(
            "[ExtraSceneImagesRoute] DELETE doc removed user_id=%s "
            "extra_scene_image_id=%s",
            user_id, extra_scene_image_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraSceneImagesRoute] DELETE mongo failed user_id=%s "
            "extra_scene_image_id=%s: %s: %s",
            user_id, extra_scene_image_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 이미지 삭제에 실패했습니다."},
        )

    return {"ok": True}


# ── POST /bulk-delete ───────────────────────────────────────────────────────


@router.post("/bulk-delete")
async def bulk_delete_extra_scene_images(
    body: BulkIds,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraSceneImagesRoute] bulk_delete entry user_id=%s is_admin=%s "
        "count=%d",
        user_id, is_admin, len(body.ids or []),
    )

    mongo = get_mongo()
    deleted = 0
    failed: list[dict] = []
    for raw_id in body.ids:
        try:
            oid = _to_oid(raw_id)
            if oid is None:
                failed.append({"extra_scene_image_id": raw_id, "reason": "invalid_id"})
                continue
            doc = await mongo.extra_scene_images.find_one({"_id": oid})
            if not doc:
                failed.append({"extra_scene_image_id": raw_id, "reason": "not_found"})
                continue
            if doc.get("user_id") != user_id and not is_admin:
                failed.append({"extra_scene_image_id": raw_id, "reason": "forbidden"})
                logger.warning(
                    "[ExtraSceneImagesRoute] bulk_delete skip forbidden user_id=%s "
                    "extra_scene_image_id=%s asset_owner=%s",
                    user_id, raw_id, doc.get("user_id"),
                )
                continue

            obj = doc.get("object_name") or ""
            if obj:
                removed = await _remove_minio_object(obj)
                logger.info(
                    "[ExtraSceneImagesRoute] bulk_delete minio remove user_id=%s "
                    "extra_scene_image_id=%s object=%s ok=%s",
                    user_id, raw_id, obj, removed,
                )
            await mongo.extra_scene_images.delete_one({"_id": oid})
            deleted += 1
        except Exception as e:  # noqa: BLE001
            failed.append({"extra_scene_image_id": raw_id, "reason": str(e)[:200]})
            logger.exception(
                "[ExtraSceneImagesRoute] bulk_delete one failed user_id=%s "
                "extra_scene_image_id=%s",
                user_id, raw_id,
            )

    logger.info(
        "[ExtraSceneImagesRoute] bulk_delete ok user_id=%s deleted=%d failed=%d "
        "total_requested=%d",
        user_id, deleted, len(failed), len(body.ids or []),
    )
    return {
        "deleted_count": deleted,
        "failed": failed,
        "total_requested": len(body.ids or []),
    }


# ── GET /{id}/download ──────────────────────────────────────────────────────


@router.get("/{extra_scene_image_id}/download")
async def download_extra_scene_image(
    extra_scene_image_id: str,
    current_user=Depends(get_current_user),
):
    """단일 PNG 다운로드. attachment 응답."""
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraSceneImagesRoute] download entry user_id=%s is_admin=%s "
        "extra_scene_image_id=%s",
        user_id, is_admin, extra_scene_image_id,
    )
    resolved = await _resolve_extra_scene_image(extra_scene_image_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    status = doc.get("status") or ""
    obj = doc.get("object_name") or ""
    if status != "completed" or not obj:
        logger.warning(
            "[ExtraSceneImagesRoute] download not ready user_id=%s "
            "extra_scene_image_id=%s status=%s has_obj=%s",
            user_id, extra_scene_image_id, status, bool(obj),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "아직 생성이 완료되지 않았습니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=obj,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraSceneImagesRoute] download minio missing user_id=%s "
            "extra_scene_image_id=%s object=%s: %s: %s",
            user_id, extra_scene_image_id, obj,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )

    id_short = (extra_scene_image_id or "")[:8]
    filename = "extra-scene-{}.png".format(id_short)
    logger.info(
        "[ExtraSceneImagesRoute] download ok user_id=%s extra_scene_image_id=%s "
        "bytes=%d filename=%s",
        user_id, extra_scene_image_id, len(data or b""), filename,
    )
    return StreamingResponse(
        io.BytesIO(data),
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
        },
    )
