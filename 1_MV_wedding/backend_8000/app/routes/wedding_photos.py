"""
v13 — 웨딩사진 잡 (fire-and-poll) + 갤러리/디테일/삭제.

prefix: `/api/mv/jobs/{mv_job_id}/wedding-photos`.

엔드포인트:
  POST   /generate                    — 잡 시작 (queued)
  GET    /jobs/{photo_job_id}         — 폴링
  GET    /                            — 갤러리 (이 mv_job 의 wedding_photo 자산)
  GET    /{photo_id}                  — 디테일 (사용 자산 join)
  DELETE /{photo_id}                  — MinIO + Mongo 정리

권한: 작품 owner OR admin. 비owner/비admin → 403.
로그 prefix: `[PhotoRoute]`. 백그라운드 잡 헬퍼 라인은 `[PhotoJob]`.
민감 정보(API 키, 본문 전체) 출력 금지. 본문은 길이만.
"""

from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
import uuid as uuid_lib
import zipfile
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
from ..models.story import MentionRef
from ..services.wedding_photo_generator import generate_wedding_photo

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/mv/jobs/{mv_job_id}/wedding-photos",
    tags=["WeddingPhotos"],
)


SHEET_SLOTS = ("groom_casual", "groom_wedding", "bride_casual", "bride_wedding")
ALLOWED_IMAGE_MODELS = ("gpt_image_2", "nb_pro")
MAX_USER_TEXT_LEN = 4000


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


def _serialize_wedding_photo_asset(d: dict) -> dict:
    """Shape a wedding_assets (type=wedding_photo) doc for list/context views."""
    obj = d.get("object_name") or ""
    return {
        "photo_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "meta": d.get("meta") or {},
        "created_at": _iso(d.get("created_at")),
    }


def _serialize_photo_job(d: dict) -> dict:
    obj = d.get("photo_object_name") or ""
    return {
        "job_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "photo_id": d.get("photo_id"),
        "status": d.get("status", "queued"),
        "image_model": d.get("image_model"),
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "error_message": d.get("error_message"),
        "created_at": _iso(d.get("created_at")),
        "updated_at": _iso(d.get("updated_at")),
    }


async def _put_minio_bytes(object_name: str, data: bytes, content_type: str) -> None:
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_photos,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )


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
            "[PhotoRoute] minio remove failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return False


async def _load_image_from_photos(object_name: str) -> tuple:
    """Pull a reference image from the MinIO photos bucket.

    Returns (bytes, mime) or (None, None) — never raises.
    """
    if not object_name:
        return None, None
    minio_client = get_minio()
    if minio_client is None:
        logger.warning(
            "[PhotoJob] _load_image_from_photos minio not initialized object=%s",
            object_name,
        )
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
        return data, mime
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PhotoJob] _load_image_from_photos failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None, None


async def _resolve_mv_job(mv_job_id: str, current_user: dict):
    """Return (mv_job_doc, owner_user_id, is_admin) or raise via JSONResponse.

    Raises if the job is missing or the caller is neither owner nor admin.
    The caller must check the return value for JSONResponse (then early-return)
    OR a dict tuple.
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


# ── Pydantic body ────────────────────────────────────────────────────────────


class WeddingPhotoGenerate(BaseModel):
    groom_sheet_slot: Literal["groom_casual", "groom_wedding"]
    bride_sheet_slot: Literal["bride_casual", "bride_wedding"]
    place_object_name: str
    image_model: Literal["gpt_image_2", "nb_pro"] = "gpt_image_2"
    user_text: str = ""
    user_text_refs: list[MentionRef] = Field(default_factory=list)


# v15 — 멀티턴 수정용. 부모 photo 와 동일 chain_root 그룹에 누적된다.
class WeddingPhotoRefine(BaseModel):
    refine_request: str = Field(..., min_length=1, max_length=1000)
    refine_request_refs: list[MentionRef] = Field(default_factory=list, max_length=32)
    image_model: Literal["gpt_image_2", "nb_pro"] = "gpt_image_2"


# v16 — 일괄 다운로드(ZIP) / 일괄 삭제용 공통 body.
class BulkPhotoIds(BaseModel):
    photo_ids: list[str] = Field(..., min_length=1, max_length=50)


# ── POST /generate ───────────────────────────────────────────────────────────


@router.post("/generate")
async def generate(
    mv_job_id: str,
    body: WeddingPhotoGenerate,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /generate entry user_id=%s is_admin=%s mv_job_id=%s "
        "groom_slot=%s bride_slot=%s image_model=%s text_len=%d refs=%d",
        user_id, is_admin, mv_job_id,
        body.groom_sheet_slot, body.bride_sheet_slot, body.image_model,
        len(body.user_text or ""), len(body.user_text_refs or []),
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    job, owner_user_id, _ = resolved

    # Body validation -----------------------------------------------------
    if len(body.user_text or "") > MAX_USER_TEXT_LEN:
        logger.warning(
            "[PhotoRoute] /generate text too long user_id=%s mv_job_id=%s len=%d",
            user_id, mv_job_id, len(body.user_text or ""),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "지시사항은 4000자 이하여야 합니다."},
        )

    # Image model API key gating ------------------------------------------
    if body.image_model == "gpt_image_2" and not settings.openai_api_key:
        logger.warning(
            "[PhotoRoute] /generate openai key missing user_id=%s mv_job_id=%s",
            user_id, mv_job_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 이미지 모델이 구성되어 있지 않습니다."},
        )
    if body.image_model == "nb_pro" and not settings.google_api_key:
        logger.warning(
            "[PhotoRoute] /generate google key missing user_id=%s mv_job_id=%s",
            user_id, mv_job_id,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini 이미지 모델이 구성되어 있지 않습니다."},
        )

    mongo = get_mongo()

    # Sheet slot existence check -----------------------------------------
    cs_doc = await mongo.wedding_character_sheets.find_one(
        {"user_id": owner_user_id}
    )
    sheets = ((cs_doc or {}).get("sheets") or {})
    groom_slot_doc = sheets.get(body.groom_sheet_slot) or {}
    bride_slot_doc = sheets.get(body.bride_sheet_slot) or {}
    groom_sheet_object = groom_slot_doc.get("sheet_object_name") or ""
    bride_sheet_object = bride_slot_doc.get("sheet_object_name") or ""
    if not groom_sheet_object:
        logger.warning(
            "[PhotoRoute] /generate missing groom sheet user_id=%s mv_job_id=%s slot=%s",
            user_id, mv_job_id, body.groom_sheet_slot,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "신랑 시트가 저장돼 있지 않습니다."},
        )
    if not bride_sheet_object:
        logger.warning(
            "[PhotoRoute] /generate missing bride sheet user_id=%s mv_job_id=%s slot=%s",
            user_id, mv_job_id, body.bride_sheet_slot,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "신부 시트가 저장돼 있지 않습니다."},
        )

    # Place object validation -------------------------------------------
    place_object_name = (body.place_object_name or "").strip()
    if not place_object_name:
        return JSONResponse(
            status_code=400,
            content={"error": "장소가 필요합니다."},
        )
    owner_places_prefix = "places/{}/".format(owner_user_id)
    owner_temp_prefix = "places/temp/{}/".format(owner_user_id)
    owner_upload_prefix = "{}/".format(owner_user_id)
    is_place_asset = place_object_name.startswith(owner_places_prefix)
    is_temp_place = place_object_name.startswith(owner_temp_prefix)
    is_owner_upload = (
        place_object_name.startswith(owner_upload_prefix)
        and not is_place_asset
        and not is_temp_place
    )
    if not (is_place_asset or is_temp_place or is_owner_upload):
        logger.warning(
            "[PhotoRoute] /generate place prefix reject user_id=%s mv_job_id=%s "
            "object=%s owner_user_id=%s",
            user_id, mv_job_id, place_object_name, owner_user_id,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "장소 이미지가 작품 소유자의 자산이 아닙니다."},
        )

    # Resolve place asset id (if applicable) ----------------------------
    place_source = "asset" if is_place_asset else "uploaded"
    place_asset_id: Optional[str] = None
    if is_place_asset:
        try:
            asset_doc = await mongo.wedding_assets.find_one({
                "user_id": owner_user_id,
                "type": "place",
                "object_name": place_object_name,
            })
            if asset_doc:
                place_asset_id = str(asset_doc.get("_id"))
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[PhotoRoute] /generate place asset lookup failed mv_job_id=%s: %s",
                mv_job_id, str(e)[:200],
            )

    # Pre-issue photo_id and pre-insert asset (object_name pending) ----
    photo_oid = ObjectId()
    photo_id = str(photo_oid)
    now = datetime.now(timezone.utc)

    refs_dicts = [r.model_dump() for r in (body.user_text_refs or [])]

    asset_doc = {
        "_id": photo_oid,
        "user_id": owner_user_id,
        "type": "wedding_photo",
        "display_name": "",
        "source": "generated",
        "object_name": None,
        "meta": {
            "mv_job_id": mv_job_id,
            "image_model": body.image_model,
            "groom_sheet_slot": body.groom_sheet_slot,
            "bride_sheet_slot": body.bride_sheet_slot,
            "place_object_name": place_object_name,
            "place_source": place_source,
            "place_asset_id": place_asset_id,
            "user_text": (body.user_text or ""),
            "user_text_refs": refs_dicts,
            # v15 — refine 체인 그룹핑. v1(원본) 은 본인 _id 가 root.
            "based_on_photo_id": None,
            "refine_request": "",
            "refine_request_refs": [],
            "chain_root_photo_id": photo_id,
        },
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.wedding_assets.insert_one(asset_doc)
        logger.info(
            "[PhotoRoute] /generate asset pre-insert ok user_id=%s mv_job_id=%s "
            "photo_id=%s owner=%s",
            user_id, mv_job_id, photo_id, owner_user_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /generate asset pre-insert failed user_id=%s mv_job_id=%s "
            "photo_id=%s: %s: %s",
            user_id, mv_job_id, photo_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "사진 자산 사전 저장에 실패했습니다."},
        )

    job_doc = {
        "mv_job_id": mv_job_id,
        "owner_user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "type": "generate",
        "status": "queued",
        "image_model": body.image_model,
        "groom_sheet_slot": body.groom_sheet_slot,
        "bride_sheet_slot": body.bride_sheet_slot,
        "place_object_name": place_object_name,
        "place_source": place_source,
        "place_asset_id": place_asset_id,
        "user_text": (body.user_text or ""),
        "user_text_refs": refs_dicts,
        "photo_id": photo_id,
        "photo_object_name": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.wedding_photo_jobs.insert_one(job_doc)
        photo_job_id = str(result.inserted_id)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /generate job insert failed user_id=%s mv_job_id=%s "
            "photo_id=%s: %s: %s",
            user_id, mv_job_id, photo_id, type(e).__name__, str(e)[:200],
        )
        # Best-effort rollback of pre-inserted asset doc.
        try:
            await mongo.wedding_assets.delete_one({"_id": photo_oid})
        except Exception:
            pass
        return JSONResponse(
            status_code=500,
            content={"error": "사진 잡 생성에 실패했습니다."},
        )

    asyncio.create_task(_run_wedding_photo_generation(photo_job_id))
    logger.info(
        "[PhotoRoute] /generate queued user_id=%s mv_job_id=%s photo_id=%s "
        "job_id=%s image_model=%s",
        user_id, mv_job_id, photo_id, photo_job_id, body.image_model,
    )
    return {
        "photo_id": photo_id,
        "job_id": photo_job_id,
        "status": "queued",
    }


# ── POST /{photo_id}/refine ─────────────────────────────────────────────────


@router.post("/{photo_id}/refine")
async def refine_wedding_photo(
    mv_job_id: str,
    photo_id: str,
    body: WeddingPhotoRefine,
    current_user=Depends(get_current_user),
):
    """v15 — 멀티턴 수정. 기존 사진 위에 추가 지시로 새 photo 를 생성한다.
    부모 photo 와 동일 chain_root 그룹에 누적된다.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /refine entry user_id=%s is_admin=%s mv_job_id=%s "
        "parent_photo_id=%s body_model=%s refine_len=%d refs=%d",
        user_id, is_admin, mv_job_id, photo_id, body.image_model,
        len(body.refine_request or ""), len(body.refine_request_refs or []),
    )

    # 1) mv_job 검증 + owner/admin 가드.
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    # 2) parent photo 조회.
    parent_oid = _to_oid(photo_id)
    if parent_oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 photo_id 입니다."},
        )

    mongo = get_mongo()
    parent = await mongo.wedding_assets.find_one({
        "_id": parent_oid, "type": "wedding_photo",
    })
    if not parent:
        return JSONResponse(
            status_code=404,
            content={"error": "원본 사진을 찾을 수 없습니다."},
        )
    if parent.get("user_id") != owner_user_id:
        logger.warning(
            "[PhotoRoute] /refine parent owner mismatch user_id=%s mv_job_id=%s "
            "parent_photo_id=%s parent_owner=%s",
            user_id, mv_job_id, photo_id, parent.get("user_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "원본 사진을 찾을 수 없습니다."},
        )
    parent_meta = parent.get("meta") or {}
    if (parent_meta.get("mv_job_id") or "") != mv_job_id:
        logger.warning(
            "[PhotoRoute] /refine parent mv_job mismatch user_id=%s mv_job_id=%s "
            "parent_photo_id=%s parent_mv_job=%s",
            user_id, mv_job_id, photo_id, parent_meta.get("mv_job_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "원본 사진을 찾을 수 없습니다."},
        )

    # 3) parent.object_name 확인 — 생성 미완료면 거부.
    if not (parent.get("object_name") or ""):
        logger.warning(
            "[PhotoRoute] /refine parent object_name missing user_id=%s "
            "mv_job_id=%s parent_photo_id=%s",
            user_id, mv_job_id, photo_id,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "원본 사진 생성이 완료되지 않았습니다."},
        )

    # v15.1 — 모델 락. body.image_model 은 검증만(Pydantic Literal). 실제 사용은
    # 부모 자산의 meta.image_model 강제. 부모값이 비었거나 알 수 없는 값이면
    # fallback "gpt_image_2". 둘이 다르면 warning 만 남기고 locked 로 진행.
    parent_locked_raw = parent_meta.get("image_model")
    if parent_locked_raw in ALLOWED_IMAGE_MODELS:
        locked_model = parent_locked_raw
    else:
        locked_model = "gpt_image_2"
        if parent_locked_raw:
            logger.warning(
                "[PhotoRoute] /refine parent image_model unknown user_id=%s "
                "mv_job_id=%s parent_photo_id=%s parent_model=%s → fallback=%s",
                user_id, mv_job_id, photo_id, parent_locked_raw, locked_model,
            )
        else:
            logger.warning(
                "[PhotoRoute] /refine parent image_model missing user_id=%s "
                "mv_job_id=%s parent_photo_id=%s → fallback=%s",
                user_id, mv_job_id, photo_id, locked_model,
            )
    if body.image_model != locked_model:
        logger.warning(
            "[PhotoRoute] /refine model mismatch (locked to parent) user_id=%s "
            "mv_job_id=%s parent_photo_id=%s body_model=%s model_locked=%s",
            user_id, mv_job_id, photo_id, body.image_model, locked_model,
        )

    logger.info(
        "[PhotoRoute] /refine model resolve user_id=%s mv_job_id=%s "
        "parent_photo_id=%s body_model=%s model_locked=%s",
        user_id, mv_job_id, photo_id, body.image_model, locked_model,
    )

    # 4) image_model 별 키 503 분기 — locked 값 기준.
    if locked_model == "gpt_image_2" and not settings.openai_api_key:
        logger.warning(
            "[PhotoRoute] /refine openai key missing user_id=%s mv_job_id=%s "
            "parent_photo_id=%s model_locked=%s",
            user_id, mv_job_id, photo_id, locked_model,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 이미지 모델이 구성되어 있지 않습니다."},
        )
    if locked_model == "nb_pro" and not settings.google_api_key:
        logger.warning(
            "[PhotoRoute] /refine google key missing user_id=%s mv_job_id=%s "
            "parent_photo_id=%s model_locked=%s",
            user_id, mv_job_id, photo_id, locked_model,
        )
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini 이미지 모델이 구성되어 있지 않습니다."},
        )

    # 5) chain_root 계산 — 부모의 meta.chain_root_photo_id 가 있으면 그 값,
    # 없으면 부모 _id 자체 (v15 이전 회귀 데이터 fallback).
    chain_root_id = (
        parent_meta.get("chain_root_photo_id") or str(parent.get("_id"))
    )

    # 6) 새 photo_id 사전 발급.
    new_photo_oid = ObjectId()
    new_photo_id = str(new_photo_oid)
    now = datetime.now(timezone.utc)

    refine_refs_dicts = [r.model_dump() for r in (body.refine_request_refs or [])]

    # 7) wedding_assets pre-insert (object_name=None, refine 결과 자리표시).
    parent_user_text = parent_meta.get("user_text") or ""
    parent_user_text_refs = parent_meta.get("user_text_refs") or []
    asset_doc = {
        "_id": new_photo_oid,
        "user_id": parent.get("user_id"),
        "type": "wedding_photo",
        "display_name": "",
        "source": "generated",
        "object_name": None,
        "meta": {
            "mv_job_id": mv_job_id,
            "image_model": locked_model,
            "groom_sheet_slot": parent_meta.get("groom_sheet_slot"),
            "bride_sheet_slot": parent_meta.get("bride_sheet_slot"),
            "place_object_name": parent_meta.get("place_object_name"),
            "place_source": parent_meta.get("place_source"),
            "place_asset_id": parent_meta.get("place_asset_id"),
            "user_text": parent_user_text,
            "user_text_refs": parent_user_text_refs,
            "based_on_photo_id": str(parent.get("_id")),
            "refine_request": body.refine_request,
            "refine_request_refs": refine_refs_dicts,
            "chain_root_photo_id": chain_root_id,
        },
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.wedding_assets.insert_one(asset_doc)
        logger.info(
            "[PhotoRoute] /refine asset pre-insert ok user_id=%s mv_job_id=%s "
            "photo_id=%s parent_photo_id=%s chain_root_photo_id=%s",
            user_id, mv_job_id, new_photo_id, photo_id, chain_root_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /refine asset pre-insert failed user_id=%s mv_job_id=%s "
            "photo_id=%s parent_photo_id=%s: %s: %s",
            user_id, mv_job_id, new_photo_id, photo_id,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "사진 자산 사전 저장에 실패했습니다."},
        )

    # 8) wedding_photo_jobs insert (type="refine"). image_model = locked.
    job_doc = {
        "mv_job_id": mv_job_id,
        "owner_user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "type": "refine",
        "status": "queued",
        "image_model": locked_model,
        "groom_sheet_slot": parent_meta.get("groom_sheet_slot"),
        "bride_sheet_slot": parent_meta.get("bride_sheet_slot"),
        "place_object_name": parent_meta.get("place_object_name"),
        "place_source": parent_meta.get("place_source"),
        "place_asset_id": parent_meta.get("place_asset_id"),
        "user_text": parent_user_text,
        "user_text_refs": parent_user_text_refs,
        "based_on_photo_id": str(parent.get("_id")),
        "refine_request": body.refine_request,
        "refine_request_refs": refine_refs_dicts,
        "photo_id": new_photo_id,
        "photo_object_name": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.wedding_photo_jobs.insert_one(job_doc)
        photo_job_id = str(result.inserted_id)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /refine job insert failed user_id=%s mv_job_id=%s "
            "photo_id=%s parent_photo_id=%s: %s: %s",
            user_id, mv_job_id, new_photo_id, photo_id,
            type(e).__name__, str(e)[:200],
        )
        # Best-effort rollback of pre-inserted asset doc.
        try:
            await mongo.wedding_assets.delete_one({"_id": new_photo_oid})
        except Exception:
            pass
        return JSONResponse(
            status_code=500,
            content={"error": "사진 잡 생성에 실패했습니다."},
        )

    # 9) 백그라운드 잡 시작.
    asyncio.create_task(_run_wedding_photo_generation(photo_job_id))
    logger.info(
        "[PhotoRoute] /refine queued user_id=%s mv_job_id=%s photo_id=%s "
        "parent_photo_id=%s chain_root_photo_id=%s job_id=%s "
        "body_model=%s model_locked=%s",
        user_id, mv_job_id, new_photo_id, photo_id, chain_root_id,
        photo_job_id, body.image_model, locked_model,
    )

    # 10) 응답.
    return {
        "photo_id": new_photo_id,
        "job_id": photo_job_id,
        "status": "queued",
    }


# ── GET /{photo_id}/chain ───────────────────────────────────────────────────


@router.get("/{photo_id}/chain")
async def get_wedding_photo_chain(
    mv_job_id: str,
    photo_id: str,
    current_user=Depends(get_current_user),
):
    """v15 — anchor photo 가 속한 refine 체인의 모든 버전을 created_at asc 순으로 반환.

    체인 fallback: 구버전 doc 에 chain_root 가 없으면 photo_id 자체를 root 로 간주.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /chain entry user_id=%s is_admin=%s mv_job_id=%s photo_id=%s",
        user_id, is_admin, mv_job_id, photo_id,
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    anchor_oid = _to_oid(photo_id)
    if anchor_oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 photo_id 입니다."},
        )

    mongo = get_mongo()
    anchor = await mongo.wedding_assets.find_one({
        "_id": anchor_oid, "type": "wedding_photo",
    })
    if not anchor:
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    if anchor.get("user_id") != owner_user_id:
        logger.warning(
            "[PhotoRoute] /chain anchor owner mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s asset_owner=%s",
            user_id, mv_job_id, photo_id, anchor.get("user_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    anchor_meta = anchor.get("meta") or {}
    if (anchor_meta.get("mv_job_id") or "") != mv_job_id:
        logger.warning(
            "[PhotoRoute] /chain anchor mv_job mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s anchor_mv_job=%s",
            user_id, mv_job_id, photo_id, anchor_meta.get("mv_job_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )

    chain_root_id = (
        anchor_meta.get("chain_root_photo_id") or str(anchor.get("_id"))
    )
    chain_root_oid = _to_oid(chain_root_id)

    # $or 로 chain_root 가 채워진 후속 버전 + chain_root doc 자체(없는 v1) 둘 다 잡는다.
    or_conditions: list[dict] = [
        {"meta.chain_root_photo_id": chain_root_id},
    ]
    if chain_root_oid is not None:
        or_conditions.append({"_id": chain_root_oid})

    items: list[dict] = []
    try:
        cursor = mongo.wedding_assets.find({
            "type": "wedding_photo",
            "user_id": owner_user_id,
            "meta.mv_job_id": mv_job_id,
            "$or": or_conditions,
        }).sort("created_at", 1)
        async for doc in cursor:
            items.append(_serialize_wedding_photo_asset(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /chain mongo failed user_id=%s mv_job_id=%s photo_id=%s "
            "chain_root_photo_id=%s: %s: %s",
            user_id, mv_job_id, photo_id, chain_root_id,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "웨딩사진 체인 조회에 실패했습니다."},
        )

    logger.info(
        "[PhotoRoute] /chain ok user_id=%s mv_job_id=%s photo_id=%s "
        "chain_root_photo_id=%s count=%d",
        user_id, mv_job_id, photo_id, chain_root_id, len(items),
    )
    return {"items": items}


# ── POST /download (ZIP, bulk) ──────────────────────────────────────────────


@router.post("/download")
async def download_wedding_photos_zip(
    mv_job_id: str,
    body: BulkPhotoIds,
    current_user=Depends(get_current_user),
):
    """v16 — 여러 wedding_photo 자산을 ZIP 으로 묶어 스트리밍한다.

    각 자산: owner/admin 권한 검증, object_name 존재 확인.
    권한 없거나 object_name 비어 있거나 MinIO 로드 실패한 건은 skip 하고 warning 로그.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] download_zip entry user_id=%s is_admin=%s mv_job_id=%s "
        "photo_count=%d",
        user_id, is_admin, mv_job_id, len(body.photo_ids or []),
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()

    buffer = io.BytesIO()
    included = 0
    skipped = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for pid in body.photo_ids:
            oid = _to_oid(pid)
            if oid is None:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip invalid_id user_id=%s "
                    "mv_job_id=%s photo_id=%s",
                    user_id, mv_job_id, pid,
                )
                continue
            try:
                doc = await mongo.wedding_assets.find_one({
                    "_id": oid, "type": "wedding_photo",
                })
            except Exception as e:  # noqa: BLE001
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip mongo_error user_id=%s "
                    "mv_job_id=%s photo_id=%s: %s: %s",
                    user_id, mv_job_id, pid,
                    type(e).__name__, str(e)[:200],
                )
                continue
            if not doc:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip not_found user_id=%s "
                    "mv_job_id=%s photo_id=%s",
                    user_id, mv_job_id, pid,
                )
                continue
            if doc.get("user_id") != owner_user_id and not is_admin:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip forbidden user_id=%s "
                    "mv_job_id=%s photo_id=%s asset_owner=%s",
                    user_id, mv_job_id, pid, doc.get("user_id"),
                )
                continue
            meta = doc.get("meta") or {}
            if (meta.get("mv_job_id") or "") != mv_job_id:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip mv_job_mismatch user_id=%s "
                    "mv_job_id=%s photo_id=%s meta_mv_job=%s",
                    user_id, mv_job_id, pid, meta.get("mv_job_id"),
                )
                continue
            obj = doc.get("object_name") or ""
            if not obj:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip object_name_missing "
                    "user_id=%s mv_job_id=%s photo_id=%s",
                    user_id, mv_job_id, pid,
                )
                continue
            data, _mime = await _load_image_from_photos(obj)
            if not data:
                skipped += 1
                logger.warning(
                    "[PhotoRoute] download_zip skip minio_missing user_id=%s "
                    "mv_job_id=%s photo_id=%s object=%s",
                    user_id, mv_job_id, pid, obj,
                )
                continue
            photo_short = pid[:8]
            zf.writestr("wedding-{}.png".format(photo_short), data)
            included += 1
            logger.info(
                "[PhotoRoute] download_zip add ok user_id=%s mv_job_id=%s "
                "photo_id=%s bytes=%d",
                user_id, mv_job_id, pid, len(data),
            )

    if included == 0:
        logger.warning(
            "[PhotoRoute] download_zip empty user_id=%s mv_job_id=%s skipped=%d",
            user_id, mv_job_id, skipped,
        )
        return JSONResponse(
            status_code=404,
            content={"error": "다운로드 가능한 사진이 없습니다."},
        )

    buffer.seek(0)
    mv_short = (mv_job_id or "")[:8]
    filename = "wedding-photos-{}-{}.zip".format(mv_short, included)
    logger.info(
        "[PhotoRoute] download_zip ok user_id=%s mv_job_id=%s included=%d "
        "skipped=%d filename=%s zip_bytes=%d",
        user_id, mv_job_id, included, skipped, filename,
        buffer.getbuffer().nbytes,
    )
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
        },
    )


# ── POST /bulk-delete ───────────────────────────────────────────────────────


@router.post("/bulk-delete")
async def bulk_delete_wedding_photos(
    mv_job_id: str,
    body: BulkPhotoIds,
    current_user=Depends(get_current_user),
):
    """v16 — 여러 wedding_photo 자산을 일괄 삭제. 각각 owner/admin 검증.

    응답: `{deleted_count, failed: [{photo_id, reason}]}`. 일부 실패해도 200.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] bulk_delete entry user_id=%s is_admin=%s mv_job_id=%s "
        "photo_count=%d",
        user_id, is_admin, mv_job_id, len(body.photo_ids or []),
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()

    deleted = 0
    failed: list[dict] = []
    for pid in body.photo_ids:
        try:
            oid = _to_oid(pid)
            if oid is None:
                failed.append({"photo_id": pid, "reason": "invalid_id"})
                logger.warning(
                    "[PhotoRoute] bulk_delete skip invalid_id user_id=%s "
                    "mv_job_id=%s photo_id=%s",
                    user_id, mv_job_id, pid,
                )
                continue
            doc = await mongo.wedding_assets.find_one({
                "_id": oid, "type": "wedding_photo",
            })
            if not doc:
                failed.append({"photo_id": pid, "reason": "not_found"})
                logger.warning(
                    "[PhotoRoute] bulk_delete skip not_found user_id=%s "
                    "mv_job_id=%s photo_id=%s",
                    user_id, mv_job_id, pid,
                )
                continue
            if doc.get("user_id") != owner_user_id and not is_admin:
                failed.append({"photo_id": pid, "reason": "forbidden"})
                logger.warning(
                    "[PhotoRoute] bulk_delete skip forbidden user_id=%s "
                    "mv_job_id=%s photo_id=%s asset_owner=%s",
                    user_id, mv_job_id, pid, doc.get("user_id"),
                )
                continue
            meta = doc.get("meta") or {}
            if (meta.get("mv_job_id") or "") != mv_job_id:
                failed.append({"photo_id": pid, "reason": "mv_job_mismatch"})
                logger.warning(
                    "[PhotoRoute] bulk_delete skip mv_job_mismatch user_id=%s "
                    "mv_job_id=%s photo_id=%s meta_mv_job=%s",
                    user_id, mv_job_id, pid, meta.get("mv_job_id"),
                )
                continue

            obj = doc.get("object_name") or ""
            if obj:
                removed = await _remove_minio_object(obj)
                logger.info(
                    "[PhotoRoute] bulk_delete minio remove user_id=%s "
                    "mv_job_id=%s photo_id=%s object=%s ok=%s",
                    user_id, mv_job_id, pid, obj, removed,
                )

            await mongo.wedding_assets.delete_one({"_id": oid})

            try:
                jobs_result = await mongo.wedding_photo_jobs.delete_many({
                    "mv_job_id": mv_job_id,
                    "photo_id": pid,
                })
                logger.info(
                    "[PhotoRoute] bulk_delete jobs cleanup user_id=%s "
                    "mv_job_id=%s photo_id=%s count=%d",
                    user_id, mv_job_id, pid, jobs_result.deleted_count,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[PhotoRoute] bulk_delete jobs cleanup failed user_id=%s "
                    "mv_job_id=%s photo_id=%s: %s: %s",
                    user_id, mv_job_id, pid,
                    type(e).__name__, str(e)[:200],
                )

            deleted += 1
        except Exception as e:  # noqa: BLE001
            failed.append({"photo_id": pid, "reason": str(e)[:200]})
            logger.exception(
                "[PhotoRoute] bulk_delete one failed user_id=%s mv_job_id=%s "
                "photo_id=%s",
                user_id, mv_job_id, pid,
            )

    logger.info(
        "[PhotoRoute] bulk_delete ok user_id=%s mv_job_id=%s deleted=%d failed=%d",
        user_id, mv_job_id, deleted, len(failed),
    )
    return {"deleted_count": deleted, "failed": failed}


# ── Background task ────────────────────────────────────────────────────────


async def _run_wedding_photo_generation(photo_job_id: str) -> None:
    """Drive a wedding_photo_jobs `generate` job to done/failed."""
    mongo = get_mongo()
    oid = _to_oid(photo_job_id)
    if oid is None:
        logger.warning(
            "[PhotoJob] invalid photo_job_id job_id=%s — skipping", photo_job_id,
        )
        return

    job = await mongo.wedding_photo_jobs.find_one({"_id": oid})
    if not job:
        logger.warning(
            "[PhotoJob] job not found job_id=%s — skipping", photo_job_id,
        )
        return

    mv_job_id = job.get("mv_job_id")
    owner_user_id = job.get("owner_user_id")
    photo_id = job.get("photo_id")
    image_model = job.get("image_model") or "gpt_image_2"
    photo_oid = _to_oid(photo_id) if photo_id else None
    job_type = job.get("type") or "generate"
    based_on_photo_id = job.get("based_on_photo_id") or ""

    logger.info(
        "[PhotoJob] start job_id=%s mv_job_id=%s photo_id=%s owner_user_id=%s "
        "image_model=%s job_type=%s parent_photo_id=%s",
        photo_job_id, mv_job_id, photo_id, owner_user_id, image_model,
        job_type, based_on_photo_id,
    )

    now = datetime.now(timezone.utc)
    try:
        await mongo.wedding_photo_jobs.update_one(
            {"_id": oid},
            {"$set": {"status": "running", "updated_at": now}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PhotoJob] running mark failed job_id=%s: %s: %s",
            photo_job_id, type(e).__name__, str(e)[:200],
        )

    try:
        # Resolve groom + bride sheet objects + display names.
        cs_doc = await mongo.wedding_character_sheets.find_one(
            {"user_id": owner_user_id}
        )
        sheets = ((cs_doc or {}).get("sheets") or {})
        groom_slot = job.get("groom_sheet_slot") or ""
        bride_slot = job.get("bride_sheet_slot") or ""
        groom_slot_doc = sheets.get(groom_slot) or {}
        bride_slot_doc = sheets.get(bride_slot) or {}
        groom_object = groom_slot_doc.get("sheet_object_name") or ""
        bride_object = bride_slot_doc.get("sheet_object_name") or ""
        if not groom_object or not bride_object:
            raise ValueError(
                "sheet object missing (groom={}, bride={})".format(
                    bool(groom_object), bool(bride_object),
                )
            )

        groom_display_name = (groom_slot_doc.get("display_name") or "").strip()
        bride_display_name = (bride_slot_doc.get("display_name") or "").strip()
        # Style suffix after "_" (groom_casual → casual, bride_wedding → wedding)
        groom_style = groom_slot.split("_", 1)[1] if "_" in groom_slot else ""
        bride_style = bride_slot.split("_", 1)[1] if "_" in bride_slot else ""

        # Place display name + memo (best-effort — uploaded path may not have one).
        place_object_name = job.get("place_object_name") or ""
        place_display_name = ""
        place_memo = ""
        place_asset_id = job.get("place_asset_id")
        if place_asset_id:
            try:
                place_oid = _to_oid(place_asset_id)
                if place_oid is not None:
                    place_doc = await mongo.wedding_assets.find_one({"_id": place_oid})
                    if place_doc:
                        place_display_name = (place_doc.get("display_name") or "").strip()
                        place_memo = ((place_doc.get("meta") or {}).get("memo") or "").strip()
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[PhotoJob] place asset lookup failed job_id=%s: %s: %s",
                    photo_job_id, type(e).__name__, str(e)[:200],
                )

        # Load 3 ref images from MinIO.
        logger.info(
            "[PhotoJob] loading refs job_id=%s mv_job_id=%s photo_id=%s "
            "groom_object=%s bride_object=%s place_object=%s",
            photo_job_id, mv_job_id, photo_id,
            groom_object, bride_object, place_object_name,
        )
        groom_bytes, groom_mime = await _load_image_from_photos(groom_object)
        if not groom_bytes:
            raise ValueError("groom sheet image missing from MinIO")
        bride_bytes, bride_mime = await _load_image_from_photos(bride_object)
        if not bride_bytes:
            raise ValueError("bride sheet image missing from MinIO")
        place_bytes, place_mime = await _load_image_from_photos(place_object_name)
        if not place_bytes:
            raise ValueError("place image missing from MinIO")

        # v15 — refine 분기 — 부모 사진 bytes 로드.
        parent_bytes: Optional[bytes] = None
        parent_mime: str = "image/png"
        mode = "generate"
        if job_type == "refine" and based_on_photo_id:
            mode = "refine"
            parent_oid_local = _to_oid(based_on_photo_id)
            if parent_oid_local is None:
                raise ValueError(
                    "invalid based_on_photo_id: {}".format(based_on_photo_id)
                )
            parent_doc = await mongo.wedding_assets.find_one({
                "_id": parent_oid_local, "type": "wedding_photo",
            })
            if not parent_doc:
                raise ValueError("parent wedding_photo not found")
            parent_object = parent_doc.get("object_name") or ""
            if not parent_object:
                raise ValueError("parent wedding_photo object_name missing")
            parent_bytes, parent_mime_loaded = await _load_image_from_photos(parent_object)
            if not parent_bytes:
                raise ValueError("parent image missing from MinIO")
            parent_mime = parent_mime_loaded or "image/png"
            logger.info(
                "[PhotoJob] refine parent loaded job_id=%s mv_job_id=%s "
                "photo_id=%s parent_photo_id=%s parent_bytes_len=%d",
                photo_job_id, mv_job_id, photo_id, based_on_photo_id,
                len(parent_bytes or b""),
            )

        # Call generator.
        logger.info(
            "[PhotoJob] calling generator job_id=%s mv_job_id=%s photo_id=%s "
            "image_model=%s mode=%s",
            photo_job_id, mv_job_id, photo_id, image_model, mode,
        )
        image_bytes = await generate_wedding_photo(
            groom_bytes=groom_bytes,
            groom_mime=groom_mime or "image/png",
            groom_display_name=groom_display_name,
            groom_style=groom_style,
            bride_bytes=bride_bytes,
            bride_mime=bride_mime or "image/png",
            bride_display_name=bride_display_name,
            bride_style=bride_style,
            place_bytes=place_bytes,
            place_mime=place_mime or "image/png",
            place_display_name=place_display_name,
            place_memo=place_memo,
            image_model=image_model,
            user_text=job.get("user_text") or "",
            user_text_refs=job.get("user_text_refs") or [],
            mv_job_id=mv_job_id,
            photo_id=photo_id,
            user_id=owner_user_id,
            mode=mode,
            parent_bytes=parent_bytes,
            parent_mime=parent_mime,
            refine_request=job.get("refine_request") or "",
            refine_request_refs=job.get("refine_request_refs") or [],
        )
        logger.info(
            "[PhotoJob] generator ok job_id=%s mv_job_id=%s photo_id=%s bytes=%d",
            photo_job_id, mv_job_id, photo_id, len(image_bytes or b""),
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PhotoJob] generation failed job_id=%s mv_job_id=%s photo_id=%s: %s",
            photo_job_id, mv_job_id, photo_id, err_text,
        )
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.wedding_photo_jobs.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error_message": err_text,
                    "updated_at": finish_now,
                }},
            )
        except Exception:
            logger.exception(
                "[PhotoJob] failed-mark write failed job_id=%s", photo_job_id,
            )
        if photo_oid is not None:
            try:
                await mongo.wedding_assets.update_one(
                    {"_id": photo_oid, "type": "wedding_photo"},
                    {"$set": {"updated_at": finish_now}},
                )
            except Exception:
                pass
        return

    # Persist — temp first, then permanent.
    temp_object = "wedding_photos/temp/{}/{}_{}.png".format(
        owner_user_id, photo_id, uuid_lib.uuid4().hex,
    )
    permanent_object = "wedding_photos/{}/{}/{}.png".format(
        owner_user_id, mv_job_id, photo_id,
    )
    try:
        await _put_minio_bytes(temp_object, image_bytes, "image/png")
        logger.info(
            "[PhotoJob] temp put ok job_id=%s photo_id=%s object=%s bytes=%d",
            photo_job_id, photo_id, temp_object, len(image_bytes),
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PhotoJob] temp put failed job_id=%s photo_id=%s: %s",
            photo_job_id, photo_id, err_text,
        )
        await mongo.wedding_photo_jobs.update_one(
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
            "[PhotoJob] permanent put ok job_id=%s photo_id=%s object=%s",
            photo_job_id, photo_id, permanent_object,
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[PhotoJob] permanent put failed job_id=%s photo_id=%s: %s",
            photo_job_id, photo_id, err_text,
        )
        await mongo.wedding_photo_jobs.update_one(
            {"_id": oid},
            {"$set": {
                "status": "failed",
                "error_message": err_text,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return

    # Best-effort temp cleanup.
    await _remove_minio_object(temp_object)

    finish_now = datetime.now(timezone.utc)
    if photo_oid is not None:
        try:
            await mongo.wedding_assets.update_one(
                {"_id": photo_oid, "type": "wedding_photo"},
                {"$set": {
                    "object_name": permanent_object,
                    "updated_at": finish_now,
                }},
            )
            logger.info(
                "[PhotoJob] asset update ok job_id=%s photo_id=%s",
                photo_job_id, photo_id,
            )
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "[PhotoJob] asset update failed job_id=%s photo_id=%s: %s: %s",
                photo_job_id, photo_id, type(e).__name__, str(e)[:200],
            )

    try:
        await mongo.wedding_photo_jobs.update_one(
            {"_id": oid},
            {"$set": {
                "status": "done",
                "photo_object_name": permanent_object,
                "error_message": None,
                "updated_at": finish_now,
            }},
        )
        logger.info(
            "[PhotoJob] done job_id=%s mv_job_id=%s photo_id=%s",
            photo_job_id, mv_job_id, photo_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoJob] done mark failed job_id=%s photo_id=%s: %s: %s",
            photo_job_id, photo_id, type(e).__name__, str(e)[:200],
        )


# ── GET /jobs/{photo_job_id} ────────────────────────────────────────────────


@router.get("/jobs/{photo_job_id}")
async def get_photo_job(
    mv_job_id: str,
    photo_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /jobs entry user_id=%s is_admin=%s mv_job_id=%s job_id=%s",
        user_id, is_admin, mv_job_id, photo_job_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    oid = _to_oid(photo_job_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 job_id 입니다."},
        )

    mongo = get_mongo()
    doc = await mongo.wedding_photo_jobs.find_one({"_id": oid})
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "잡을 찾을 수 없습니다."},
        )
    if doc.get("mv_job_id") != mv_job_id:
        logger.warning(
            "[PhotoRoute] /jobs mv_job mismatch user_id=%s mv_job_id=%s job_id=%s "
            "doc_mv_job=%s",
            user_id, mv_job_id, photo_job_id, doc.get("mv_job_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "잡을 찾을 수 없습니다."},
        )

    body = _serialize_photo_job(doc)
    logger.info(
        "[PhotoRoute] /jobs ok user_id=%s mv_job_id=%s job_id=%s photo_id=%s "
        "status=%s",
        user_id, mv_job_id, photo_job_id, body.get("photo_id"), body.get("status"),
    )
    return body


# ── GET / (gallery) ─────────────────────────────────────────────────────────


@router.get("")
async def list_wedding_photos(
    mv_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /list entry user_id=%s is_admin=%s mv_job_id=%s",
        user_id, is_admin, mv_job_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()
    items: list[dict] = []
    try:
        cursor = mongo.wedding_assets.find({
            "user_id": owner_user_id,
            "type": "wedding_photo",
            "meta.mv_job_id": mv_job_id,
        }).sort("created_at", -1)
        async for doc in cursor:
            items.append(_serialize_wedding_photo_asset(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /list mongo failed user_id=%s mv_job_id=%s: %s: %s",
            user_id, mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "웨딩사진 목록 조회에 실패했습니다."},
        )

    logger.info(
        "[PhotoRoute] /list ok user_id=%s mv_job_id=%s count=%d",
        user_id, mv_job_id, len(items),
    )
    return {"items": items}


# ── GET /{photo_id}/download (single) ───────────────────────────────────────


@router.get("/{photo_id}/download")
async def download_wedding_photo(
    mv_job_id: str,
    photo_id: str,
    current_user=Depends(get_current_user),
):
    """v16 — 단일 PNG 다운로드. attachment 응답."""
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] download_single entry user_id=%s is_admin=%s mv_job_id=%s "
        "photo_id=%s",
        user_id, is_admin, mv_job_id, photo_id,
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    oid = _to_oid(photo_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 photo_id 입니다."},
        )

    mongo = get_mongo()
    doc = await mongo.wedding_assets.find_one({
        "_id": oid, "type": "wedding_photo",
    })
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    if doc.get("user_id") != owner_user_id and not is_admin:
        logger.warning(
            "[PhotoRoute] download_single owner mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s asset_owner=%s",
            user_id, mv_job_id, photo_id, doc.get("user_id"),
        )
        return JSONResponse(
            status_code=403,
            content={"error": "접근 권한이 없습니다."},
        )
    meta = doc.get("meta") or {}
    if (meta.get("mv_job_id") or "") != mv_job_id:
        logger.warning(
            "[PhotoRoute] download_single mv_job mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s meta_mv_job=%s",
            user_id, mv_job_id, photo_id, meta.get("mv_job_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )

    obj = doc.get("object_name") or ""
    if not obj:
        return JSONResponse(
            status_code=404,
            content={"error": "아직 생성 중입니다."},
        )

    data, _mime = await _load_image_from_photos(obj)
    if not data:
        logger.warning(
            "[PhotoRoute] download_single minio missing user_id=%s mv_job_id=%s "
            "photo_id=%s object=%s",
            user_id, mv_job_id, photo_id, obj,
        )
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )

    mv_short = (mv_job_id or "")[:8]
    photo_short = (photo_id or "")[:8]
    filename = "wedding-{}-{}.png".format(mv_short, photo_short)
    logger.info(
        "[PhotoRoute] download_single ok user_id=%s mv_job_id=%s photo_id=%s "
        "bytes=%d filename=%s",
        user_id, mv_job_id, photo_id, len(data), filename,
    )
    return StreamingResponse(
        io.BytesIO(data),
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
        },
    )


# ── GET /{photo_id} (detail) ────────────────────────────────────────────────


@router.get("/{photo_id}")
async def get_wedding_photo(
    mv_job_id: str,
    photo_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /detail entry user_id=%s is_admin=%s mv_job_id=%s photo_id=%s",
        user_id, is_admin, mv_job_id, photo_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    oid = _to_oid(photo_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 photo_id 입니다."},
        )

    mongo = get_mongo()
    doc = await mongo.wedding_assets.find_one({
        "_id": oid, "type": "wedding_photo",
    })
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    if doc.get("user_id") != owner_user_id:
        logger.warning(
            "[PhotoRoute] /detail asset owner mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s asset_owner=%s",
            user_id, mv_job_id, photo_id, doc.get("user_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    meta = doc.get("meta") or {}
    if (meta.get("mv_job_id") or "") != mv_job_id:
        logger.warning(
            "[PhotoRoute] /detail mv_job mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s meta_mv_job=%s",
            user_id, mv_job_id, photo_id, meta.get("mv_job_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )

    # Join sheet slots for groom + bride display_name + object_name.
    cs_doc = await mongo.wedding_character_sheets.find_one(
        {"user_id": owner_user_id}
    )
    sheets = ((cs_doc or {}).get("sheets") or {})
    groom_slot = meta.get("groom_sheet_slot") or ""
    bride_slot = meta.get("bride_sheet_slot") or ""
    groom_slot_doc = sheets.get(groom_slot) or {}
    bride_slot_doc = sheets.get(bride_slot) or {}

    groom_block = {
        "slot": groom_slot,
        "display_name": groom_slot_doc.get("display_name") or "",
        "object_name": groom_slot_doc.get("sheet_object_name") or "",
    }
    bride_block = {
        "slot": bride_slot,
        "display_name": bride_slot_doc.get("display_name") or "",
        "object_name": bride_slot_doc.get("sheet_object_name") or "",
    }

    # Place: join asset doc when place_source == 'asset', otherwise inline.
    place_object_name = meta.get("place_object_name") or ""
    place_source = meta.get("place_source") or "uploaded"
    place_asset_id = meta.get("place_asset_id")
    if place_source == "asset" and place_asset_id:
        place_block = {
            "object_name": place_object_name,
            "display_name": "",
            "memo": "",
            "asset_id": place_asset_id,
        }
        try:
            p_oid = _to_oid(place_asset_id)
            if p_oid is not None:
                p_doc = await mongo.wedding_assets.find_one({"_id": p_oid})
                if p_doc:
                    place_block["display_name"] = p_doc.get("display_name") or ""
                    place_block["memo"] = (
                        (p_doc.get("meta") or {}).get("memo") or ""
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[PhotoRoute] /detail place lookup failed mv_job_id=%s photo_id=%s: %s",
                mv_job_id, photo_id, str(e)[:200],
            )
    else:
        place_block = {
            "object_name": place_object_name,
            "display_name": "(직접 업로드)",
            "memo": "",
            "asset_id": None,
        }

    obj = doc.get("object_name") or ""
    body = {
        "photo_id": str(doc.get("_id")),
        "object_name": obj or None,
        "preview_url": _build_preview_url(obj) if obj else None,
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
        "image_model": meta.get("image_model"),
        "groom": groom_block,
        "bride": bride_block,
        "place": place_block,
        "user_text": meta.get("user_text") or "",
        "user_text_refs": meta.get("user_text_refs") or [],
    }
    logger.info(
        "[PhotoRoute] /detail ok user_id=%s mv_job_id=%s photo_id=%s "
        "image_model=%s",
        user_id, mv_job_id, photo_id, body.get("image_model"),
    )
    return body


# ── DELETE /{photo_id} ──────────────────────────────────────────────────────


@router.delete("/{photo_id}")
async def delete_wedding_photo(
    mv_job_id: str,
    photo_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PhotoRoute] /delete entry user_id=%s is_admin=%s mv_job_id=%s photo_id=%s",
        user_id, is_admin, mv_job_id, photo_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    oid = _to_oid(photo_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 photo_id 입니다."},
        )

    mongo = get_mongo()
    existing = await mongo.wedding_assets.find_one({
        "_id": oid, "type": "wedding_photo",
    })
    if not existing:
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    if existing.get("user_id") != owner_user_id:
        logger.warning(
            "[PhotoRoute] /delete owner mismatch user_id=%s mv_job_id=%s "
            "photo_id=%s asset_owner=%s",
            user_id, mv_job_id, photo_id, existing.get("user_id"),
        )
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )
    meta = existing.get("meta") or {}
    if (meta.get("mv_job_id") or "") != mv_job_id:
        return JSONResponse(
            status_code=404,
            content={"error": "웨딩사진을 찾을 수 없습니다."},
        )

    obj = existing.get("object_name") or ""
    if obj:
        removed = await _remove_minio_object(obj)
        logger.info(
            "[PhotoRoute] /delete minio remove mv_job_id=%s photo_id=%s "
            "object=%s ok=%s",
            mv_job_id, photo_id, obj, removed,
        )

    try:
        await mongo.wedding_assets.delete_one({"_id": oid})
        logger.info(
            "[PhotoRoute] /delete asset doc removed mv_job_id=%s photo_id=%s",
            mv_job_id, photo_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PhotoRoute] /delete asset doc remove failed mv_job_id=%s "
            "photo_id=%s: %s: %s",
            mv_job_id, photo_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "웨딩사진 삭제에 실패했습니다."},
        )

    try:
        deleted = await mongo.wedding_photo_jobs.delete_many({
            "mv_job_id": mv_job_id,
            "photo_id": photo_id,
        })
        logger.info(
            "[PhotoRoute] /delete jobs removed mv_job_id=%s photo_id=%s count=%d",
            mv_job_id, photo_id, deleted.deleted_count,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PhotoRoute] /delete jobs remove failed mv_job_id=%s photo_id=%s: %s: %s",
            mv_job_id, photo_id, type(e).__name__, str(e)[:200],
        )

    return {"ok": True}
