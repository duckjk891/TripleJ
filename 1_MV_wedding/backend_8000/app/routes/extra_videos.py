"""
v23.4 — Extra Videos (편집자 공간 — Higgsfield 스타일 영상 B 보드).

prefix: `/api/extra/videos`.

v23.0 스켈레톤 → v23.2 본 생성 → v23.3 멀티턴 refine → **v23.4 continue (이어붙이기)**.
Continue 는 부모 mp4 의 마지막 프레임을 PNG 로 추출해 새 영상의 시작 이미지로 쓴다.
프레임 추출은 `extra_video_frame.extract_last_frame_png` 로 위임 (ffmpeg `-sseof` 사용).

지원 모델: veo / kling / seedance / grok (4 종).
범위: 단일 영상만 — `variant_count` 는 받지만 항상 1 강제.

체인 모델:
  · refine (v23.3): parent_video_id=parent, chain_root_video_id=parent.chain_root
                    → 같은 root 아래 버전 누적.
  · continue (v23.4): parent_video_id=parent, chain_root_video_id=self (new id)
                      → refine 과 별개의 새 root.

로그 prefix: `[ExtraVideosRoute]` / 백그라운드는 `[ExtraVideosRoute][bg]`.
추적자: `extra_video_id`, `mv_job_id`, `user_id`, `is_admin`, `video_model`,
        `source_kind="prev_video_last_frame"` (continue).
민감 정보(키, 본문 전체) 출력 금지. 본문은 길이만 로깅.
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
from ..services.extra_video_frame import extract_last_frame_png
from ..services.extra_video_generator import generate_extra_video
from ..services.extra_video_prompts import CAMERA_MOTION_PRESETS
from ..services.pre_mv_phase4_compositor import ffmpeg_available

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/extra/videos",
    tags=["ExtraVideos"],
)


ALLOWED_VIDEO_MODELS = ("veo", "kling", "seedance", "grok")
ALLOWED_SOURCE_KINDS = ("scene_image", "uploaded", "prev_video_last_frame")

# 모델별 use_seconds 클램프 (generator 와 동일 — 사용자에게도 친절히 알려주기 위해).
_USE_SECONDS_BOUNDS: dict[str, tuple[int, int]] = {
    "veo": (8, 8),           # Veo 3.1 fast 8s 고정
    "kling": (3, 15),
    "seedance": (5, 15),
    "grok": (1, 10),
}


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


def _serialize_extra_video(d: dict) -> dict:
    obj = d.get("object_name") or ""
    return {
        "extra_video_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "mv_job_id": d.get("mv_job_id"),
        "user_id": d.get("user_id"),
        "object_name": obj or None,
        "status": d.get("status", "queued"),
        "video_model": d.get("video_model"),
        "use_seconds": d.get("use_seconds"),
        "variant_count": d.get("variant_count"),
        "source_kind": d.get("source_kind"),
        "source_scene_image_id": d.get("source_scene_image_id"),
        "source_object_name": d.get("source_object_name"),
        "user_text": d.get("user_text") or "",
        "motion_presets": d.get("motion_presets") or [],
        "parent_video_id": d.get("parent_video_id"),
        "chain_root_video_id": d.get("chain_root_video_id"),
        "error_message": d.get("error_message"),
        "created_at": _iso(d.get("created_at")),
        "updated_at": _iso(d.get("updated_at")),
    }


async def _resolve_mv_job(mv_job_id: str, current_user: dict):
    """Return (mv_job_doc, owner_user_id, is_admin) or JSONResponse.

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


async def _resolve_extra_video(extra_video_id: str, current_user: dict):
    """Return (doc, owner_user_id, is_admin) or JSONResponse.

    owner+admin 가드. 404 통일.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    oid = _to_oid(extra_video_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 extra_video_id 입니다."},
        )
    mongo = get_mongo()
    doc = await mongo.extra_videos.find_one({"_id": oid})
    if not doc:
        return JSONResponse(
            status_code=404,
            content={"error": "영상을 찾을 수 없습니다."},
        )
    owner_user_id = doc.get("user_id")
    is_owner = owner_user_id == user_id
    if not is_owner and not is_admin:
        logger.warning(
            "[ExtraVideosRoute] _resolve owner mismatch user_id=%s "
            "extra_video_id=%s asset_owner=%s",
            user_id, extra_video_id, owner_user_id,
        )
        return JSONResponse(
            status_code=404,
            content={"error": "영상을 찾을 수 없습니다."},
        )
    return doc, owner_user_id, is_admin


async def _remove_minio_video_object(object_name: str) -> bool:
    if not object_name:
        return False
    minio_client = get_minio()
    try:
        minio_client.remove_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=object_name,
        )
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraVideosRoute] minio video remove failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return False


# ── Pydantic body ────────────────────────────────────────────────────────────


class ExtraVideoCreate(BaseModel):
    """v23.2 — POST /api/extra/videos 본문.

    `variant_count` 는 받지만 backend 에서 항상 1 로 강제한다 (N>1 은 v23.4+).
    """
    mv_job_id: str = Field(..., min_length=1)
    source_kind: Literal["scene_image", "uploaded", "prev_video_last_frame"]
    source_scene_image_id: Optional[str] = None
    source_object_name: Optional[str] = None
    user_text: str = Field(default="", max_length=4000)
    motion_presets: list[str] = Field(default_factory=list, max_length=11)
    video_model: Literal["veo", "kling", "seedance", "grok"] = "veo"
    use_seconds: int = Field(default=5, ge=1, le=20)
    variant_count: int = Field(default=1, ge=1, le=4)


class BulkIds(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=50)


class ExtraVideoRefine(BaseModel):
    """v23.3 — 멀티턴 수정 본문.

    video_model 은 parent 에 lock 되므로 body 에서 받지 않는다.
    use_seconds 가 None 이면 parent.use_seconds 를 그대로 이어받는다.
    """
    user_text: str = Field(..., min_length=1, max_length=4000)
    motion_presets: list[str] = Field(default_factory=list, max_length=11)
    use_seconds: Optional[float] = Field(default=None, ge=1, le=20)


class ExtraVideoContinue(BaseModel):
    """v23.4 — Continue 본문.

    - `video_model`: None 이면 parent.video_model 에 lock. 지정하면 자유 변경 가능
      (Continue 는 새 root 흐름이므로 모델 교차 허용).
    - `use_seconds`: None 이면 parent.use_seconds carry. 지정 시 모델별 클램프.
    """
    user_text: str = Field(default="", max_length=4000)
    motion_presets: list[str] = Field(default_factory=list, max_length=11)
    video_model: Optional[Literal["veo", "kling", "seedance", "grok"]] = None
    use_seconds: Optional[float] = Field(default=None, ge=1, le=20)


# ── POST / ──────────────────────────────────────────────────────────────────


@router.post("")
async def create_extra_video(
    body: ExtraVideoCreate,
    current_user=Depends(get_current_user),
):
    """v23.2 — B 영상 생성 잡 생성.

    - owner/admin 가드 (mv_job + source asset).
    - 모델별 API 키 게이팅 (503).
    - 모델별 use_seconds 클램프 (Veo 8 고정, Kling 3~15, Seedance 5~15, Grok 1~10).
    - variant_count 는 받지만 항상 1 로 강제 (v23.2).
    - asyncio.create_task 로 백그라운드 생성 시작.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] POST / entry user_id=%s is_admin=%s mv_job_id=%s "
        "source_kind=%s video_model=%s use_seconds=%d variant_count=%d "
        "motion_count=%d text_len=%d",
        user_id, is_admin, body.mv_job_id, body.source_kind, body.video_model,
        body.use_seconds, body.variant_count, len(body.motion_presets or []),
        len(body.user_text or ""),
    )

    # ── mv_job + owner 가드 ──────────────────────────────────────────────
    resolved = await _resolve_mv_job(body.mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()

    # ── source resolution ───────────────────────────────────────────────
    source_object_name: Optional[str] = None
    source_scene_image_id: Optional[str] = body.source_scene_image_id

    if body.source_kind == "scene_image":
        if not source_scene_image_id:
            return JSONResponse(
                status_code=400,
                content={"error": "source_scene_image_id 가 필요합니다."},
            )
        scene_oid = _to_oid(source_scene_image_id)
        if scene_oid is None:
            return JSONResponse(
                status_code=400,
                content={"error": "유효하지 않은 source_scene_image_id 입니다."},
            )
        try:
            scene_doc = await mongo.extra_scene_images.find_one({"_id": scene_oid})
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "[ExtraVideosRoute] POST scene lookup failed user_id=%s "
                "extra_scene_image_id=%s: %s: %s",
                user_id, source_scene_image_id, type(e).__name__, str(e)[:200],
            )
            return JSONResponse(
                status_code=500,
                content={"error": "씬 이미지 조회에 실패했습니다."},
            )
        if not scene_doc:
            return JSONResponse(
                status_code=404,
                content={"error": "씬 이미지를 찾을 수 없습니다."},
            )
        # owner + 같은 mv_job 가드.
        if scene_doc.get("user_id") != owner_user_id and not is_admin:
            logger.warning(
                "[ExtraVideosRoute] POST scene owner mismatch user_id=%s "
                "extra_scene_image_id=%s asset_owner=%s",
                user_id, source_scene_image_id, scene_doc.get("user_id"),
            )
            return JSONResponse(
                status_code=404,
                content={"error": "씬 이미지를 찾을 수 없습니다."},
            )
        if scene_doc.get("mv_job_id") != body.mv_job_id:
            return JSONResponse(
                status_code=400,
                content={"error": "씬 이미지가 같은 잡에 속해 있지 않습니다."},
            )
        if (scene_doc.get("status") or "") != "completed":
            return JSONResponse(
                status_code=400,
                content={"error": "씬 이미지가 아직 완성되지 않았습니다."},
            )
        source_object_name = scene_doc.get("object_name") or ""
        if not source_object_name:
            return JSONResponse(
                status_code=400,
                content={"error": "씬 이미지의 저장 경로를 찾을 수 없습니다."},
            )

    elif body.source_kind == "uploaded":
        # v23.2.1 — /api/assets/upload 가 반환하는 object_name 형식 = "{user_id}/{timestamp}_{...}".
        # owner 가드: prefix segment[0] == 요청자 user_id (본인 업로드) 또는 mv_job 의 owner_user_id (admin
        # 이 owner 의 자산을 가져오는 경우). 기존 "extra/{mv_job_id}/uploads/" 강제 prefix 는 폐기.
        uploaded = (body.source_object_name or "").strip()
        if not uploaded:
            return JSONResponse(
                status_code=400,
                content={"error": "source_object_name 이 필요합니다."},
            )
        first_segment = uploaded.split("/", 1)[0] if "/" in uploaded else ""
        allowed_owners = {user_id, owner_user_id}
        if first_segment not in allowed_owners:
            logger.warning(
                "[ExtraVideosRoute] POST uploaded owner-prefix reject user_id=%s "
                "mv_job_id=%s first_segment=%s got=%s",
                user_id, body.mv_job_id, first_segment, uploaded[:120],
            )
            return JSONResponse(
                status_code=403,
                content={"error": "업로드한 자산의 소유자가 아니에요."},
            )
        source_object_name = uploaded

    else:
        # prev_video_last_frame — v23.4 에서 활성화.
        return JSONResponse(
            status_code=400,
            content={
                "error": "source_kind=prev_video_last_frame 은 v23.4 에서 지원돼요."
            },
        )

    # ── 모델 키 게이팅 (503) ─────────────────────────────────────────────
    vm = body.video_model
    if vm == "veo" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Veo(Gemini) API 키가 설정되지 않았어요."},
        )
    if vm == "kling" and (
        not settings.kling_access_key or not settings.kling_secret_key
    ):
        return JSONResponse(
            status_code=503,
            content={"error": "Kling API 키가 설정되지 않았어요."},
        )
    if vm == "seedance" and not settings.fal_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Seedance(fal.ai) API 키가 설정되지 않았어요."},
        )
    if vm == "grok" and not settings.xai_api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요."
            },
        )

    # ── use_seconds 클램프 ───────────────────────────────────────────────
    lo, hi = _USE_SECONDS_BOUNDS.get(vm, (1, 20))
    clamped_use_seconds = max(lo, min(hi, int(body.use_seconds)))

    # ── motion_presets 검증 (unknown 키는 무시) ─────────────────────────
    requested_motions = [m for m in (body.motion_presets or []) if isinstance(m, str)]
    known_motions = [m for m in requested_motions if m in CAMERA_MOTION_PRESETS]
    if len(known_motions) != len(requested_motions):
        unknown = [m for m in requested_motions if m not in CAMERA_MOTION_PRESETS]
        logger.info(
            "[ExtraVideosRoute] POST drop_unknown_motions user_id=%s mv_job_id=%s "
            "unknown=%s",
            user_id, body.mv_job_id, unknown[:8],
        )

    # ── variant_count: v23.2 에선 무조건 1 강제 ─────────────────────────
    requested_variant_count = int(body.variant_count or 1)
    effective_variant_count = 1
    if requested_variant_count != 1:
        logger.info(
            "[ExtraVideosRoute] POST variant_count forced 1 user_id=%s mv_job_id=%s "
            "requested=%d",
            user_id, body.mv_job_id, requested_variant_count,
        )

    # ── doc insert ──────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    new_oid = ObjectId()
    new_id = str(new_oid)
    doc = {
        "_id": new_oid,
        "mv_job_id": body.mv_job_id,
        "user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "status": "queued",
        "object_name": None,
        "video_model": vm,
        "use_seconds": clamped_use_seconds,
        "variant_count": effective_variant_count,
        "requested_variant_count": requested_variant_count,
        "source_kind": body.source_kind,
        "source_scene_image_id": source_scene_image_id,
        "source_object_name": source_object_name,
        "user_text": (body.user_text or ""),
        "motion_presets": known_motions,
        # v23.3 멀티턴 refine 그룹핑. v1 은 본인 _id 가 root.
        "parent_video_id": None,
        "chain_root_video_id": new_id,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.extra_videos.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] POST insert failed user_id=%s mv_job_id=%s: %s: %s",
            user_id, body.mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "영상 잡 생성에 실패했습니다."},
        )

    logger.info(
        "[ExtraVideosRoute] POST queued user_id=%s mv_job_id=%s "
        "extra_video_id=%s video_model=%s use_seconds=%d motion_count=%d",
        user_id, body.mv_job_id, new_id, vm, clamped_use_seconds,
        len(known_motions),
    )

    # ── 백그라운드 잡 시작 ──────────────────────────────────────────────
    asyncio.create_task(
        _run_extra_video_generation(
            extra_video_id=new_id,
            mv_job_id=body.mv_job_id,
            owner_user_id=owner_user_id,
            source_kind=body.source_kind,
            source_object_name=source_object_name or "",
            user_text=body.user_text or "",
            motion_presets=known_motions,
            video_model=vm,
            use_seconds=float(clamped_use_seconds),
        )
    )

    return {
        "extra_video_id": new_id,
        "status": "queued",
    }


# ── Background task ─────────────────────────────────────────────────────────


async def _run_extra_video_generation(
    *,
    extra_video_id: str,
    mv_job_id: str,
    owner_user_id: str,
    source_kind: str,
    source_object_name: str,
    user_text: str,
    motion_presets: list[str],
    video_model: str,
    use_seconds: float,
) -> None:
    """Drive an extra_videos doc from queued → video_generating → completed/failed."""
    mongo = get_mongo()
    oid = _to_oid(extra_video_id)
    if oid is None:
        logger.warning(
            "[ExtraVideosRoute][bg] invalid extra_video_id=%s — skipping",
            extra_video_id,
        )
        return

    logger.info(
        "[ExtraVideosRoute][bg] start extra_video_id=%s mv_job_id=%s user_id=%s "
        "video_model=%s source_kind=%s use_seconds=%.2f motion_count=%d "
        "user_text_len=%d",
        extra_video_id, mv_job_id, owner_user_id, video_model, source_kind,
        use_seconds, len(motion_presets or []), len(user_text or ""),
    )

    now = datetime.now(timezone.utc)
    try:
        await mongo.extra_videos.update_one(
            {"_id": oid},
            {"$set": {"status": "video_generating", "updated_at": now}},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraVideosRoute][bg] video_generating mark failed "
            "extra_video_id=%s: %s: %s",
            extra_video_id, type(e).__name__, str(e)[:200],
        )

    try:
        result = await generate_extra_video(
            extra_video_id=extra_video_id,
            mv_job_id=mv_job_id,
            user_id=owner_user_id,
            source_kind=source_kind,
            source_object_name=source_object_name,
            user_text=user_text,
            motion_presets=list(motion_presets or []),
            video_model=video_model,
            use_seconds=float(use_seconds),
        )
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.exception(
            "[ExtraVideosRoute][bg] generation failed extra_video_id=%s "
            "mv_job_id=%s video_model=%s: %s",
            extra_video_id, mv_job_id, video_model, err_text,
        )
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.extra_videos.update_one(
                {"_id": oid},
                {"$set": {
                    "status": "failed",
                    "error_message": err_text,
                    "updated_at": finish_now,
                }},
            )
        except Exception:
            logger.exception(
                "[ExtraVideosRoute][bg] failed-mark write failed extra_video_id=%s",
                extra_video_id,
            )
        return

    video_object_name = result.get("video_object_name") or ""
    finish_now = datetime.now(timezone.utc)
    try:
        await mongo.extra_videos.update_one(
            {"_id": oid},
            {"$set": {
                "status": "completed",
                "object_name": video_object_name or None,
                "error_message": None,
                "updated_at": finish_now,
            }},
        )
        logger.info(
            "[ExtraVideosRoute][bg] completed extra_video_id=%s mv_job_id=%s "
            "video_model=%s object=%s",
            extra_video_id, mv_job_id, video_model, video_object_name,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute][bg] completed mark failed extra_video_id=%s "
            "mv_job_id=%s: %s: %s",
            extra_video_id, mv_job_id, type(e).__name__, str(e)[:200],
        )


# ── GET / ───────────────────────────────────────────────────────────────────


@router.get("")
async def list_extra_videos(
    mv_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] GET list entry user_id=%s is_admin=%s mv_job_id=%s",
        user_id, is_admin, mv_job_id,
    )
    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    _, owner_user_id, _ = resolved

    mongo = get_mongo()
    items: list[dict] = []
    try:
        cursor = mongo.extra_videos.find({
            "user_id": owner_user_id,
            "mv_job_id": mv_job_id,
        }).sort("created_at", -1)
        async for doc in cursor:
            items.append(_serialize_extra_video(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] GET list mongo failed user_id=%s mv_job_id=%s: %s: %s",
            user_id, mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "영상 목록 조회에 실패했습니다."},
        )

    logger.info(
        "[ExtraVideosRoute] GET list ok user_id=%s mv_job_id=%s count=%d",
        user_id, mv_job_id, len(items),
    )
    return {"items": items}


# ── GET /{id} ───────────────────────────────────────────────────────────────


@router.get("/{extra_video_id}")
async def get_extra_video(
    extra_video_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] GET detail entry user_id=%s is_admin=%s extra_video_id=%s",
        user_id, is_admin, extra_video_id,
    )
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    body = _serialize_extra_video(doc)
    logger.info(
        "[ExtraVideosRoute] GET detail ok user_id=%s extra_video_id=%s "
        "mv_job_id=%s status=%s",
        user_id, extra_video_id, body.get("mv_job_id"), body.get("status"),
    )
    return body


# ── DELETE /{id} ────────────────────────────────────────────────────────────


@router.delete("/{extra_video_id}")
async def delete_extra_video(
    extra_video_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] DELETE entry user_id=%s is_admin=%s extra_video_id=%s",
        user_id, is_admin, extra_video_id,
    )
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    obj = doc.get("object_name") or ""
    if obj:
        removed = await _remove_minio_video_object(obj)
        logger.info(
            "[ExtraVideosRoute] DELETE minio remove user_id=%s extra_video_id=%s "
            "object=%s ok=%s",
            user_id, extra_video_id, obj, removed,
        )

    mongo = get_mongo()
    try:
        await mongo.extra_videos.delete_one({"_id": doc["_id"]})
        logger.info(
            "[ExtraVideosRoute] DELETE doc removed user_id=%s extra_video_id=%s",
            user_id, extra_video_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] DELETE mongo failed user_id=%s extra_video_id=%s: %s: %s",
            user_id, extra_video_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "영상 삭제에 실패했습니다."},
        )

    return {"ok": True}


# ── POST /bulk-delete ───────────────────────────────────────────────────────


@router.post("/bulk-delete")
async def bulk_delete_extra_videos(
    body: BulkIds,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] bulk_delete entry user_id=%s is_admin=%s count=%d",
        user_id, is_admin, len(body.ids or []),
    )

    mongo = get_mongo()
    deleted = 0
    failed: list[dict] = []
    for raw_id in body.ids:
        try:
            oid = _to_oid(raw_id)
            if oid is None:
                failed.append({"extra_video_id": raw_id, "reason": "invalid_id"})
                continue
            doc = await mongo.extra_videos.find_one({"_id": oid})
            if not doc:
                failed.append({"extra_video_id": raw_id, "reason": "not_found"})
                continue
            if doc.get("user_id") != user_id and not is_admin:
                failed.append({"extra_video_id": raw_id, "reason": "forbidden"})
                logger.warning(
                    "[ExtraVideosRoute] bulk_delete skip forbidden user_id=%s "
                    "extra_video_id=%s asset_owner=%s",
                    user_id, raw_id, doc.get("user_id"),
                )
                continue

            obj = doc.get("object_name") or ""
            if obj:
                removed = await _remove_minio_video_object(obj)
                logger.info(
                    "[ExtraVideosRoute] bulk_delete minio remove user_id=%s "
                    "extra_video_id=%s object=%s ok=%s",
                    user_id, raw_id, obj, removed,
                )
            await mongo.extra_videos.delete_one({"_id": oid})
            deleted += 1
        except Exception as e:  # noqa: BLE001
            failed.append({"extra_video_id": raw_id, "reason": str(e)[:200]})
            logger.exception(
                "[ExtraVideosRoute] bulk_delete one failed user_id=%s extra_video_id=%s",
                user_id, raw_id,
            )

    logger.info(
        "[ExtraVideosRoute] bulk_delete ok user_id=%s deleted=%d failed=%d",
        user_id, deleted, len(failed),
    )
    return {"deleted_count": deleted, "failed": failed}


# ── GET /{id}/download ──────────────────────────────────────────────────────


@router.get("/{extra_video_id}/download")
async def download_extra_video(
    extra_video_id: str,
    current_user=Depends(get_current_user),
):
    """단일 mp4 다운로드. attachment 응답."""
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] download entry user_id=%s is_admin=%s extra_video_id=%s",
        user_id, is_admin, extra_video_id,
    )
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    obj = doc.get("object_name") or ""
    if not obj:
        return JSONResponse(
            status_code=404,
            content={"error": "아직 생성 중입니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=obj,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraVideosRoute] download minio missing user_id=%s extra_video_id=%s "
            "object=%s: %s: %s",
            user_id, extra_video_id, obj, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "영상을 찾을 수 없습니다."},
        )

    id_short = (extra_video_id or "")[:8]
    filename = "extra-video-{}.mp4".format(id_short)
    logger.info(
        "[ExtraVideosRoute] download ok user_id=%s extra_video_id=%s "
        "bytes=%d filename=%s",
        user_id, extra_video_id, len(data or b""), filename,
    )
    return StreamingResponse(
        io.BytesIO(data),
        media_type="video/mp4",
        headers={
            "Content-Disposition": 'attachment; filename="{}"'.format(filename),
        },
    )


# ── GET /{id}/stream — G5 (audioStreamUrl 패턴) ─────────────────────────────


@router.get("/{extra_video_id}/stream")
async def stream_extra_video(
    extra_video_id: str,
    current_user=Depends(get_current_user),
):
    """mp4 스트리밍 — `<video src>` 용. Bearer header OR ?token= 둘 다 지원
    (auth.get_current_user 가 처리). pre_mv 의 result/scene video 패턴 그대로.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] stream entry user_id=%s is_admin=%s extra_video_id=%s",
        user_id, is_admin, extra_video_id,
    )
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    doc, _owner_user_id, _ = resolved

    obj = doc.get("object_name") or ""
    if not obj:
        return JSONResponse(
            status_code=404,
            content={"error": "아직 영상이 준비되지 않았습니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=obj,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[ExtraVideosRoute] stream minio missing user_id=%s extra_video_id=%s "
            "object=%s: %s: %s",
            user_id, extra_video_id, obj, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "영상을 찾을 수 없습니다."},
        )

    def _stream():
        try:
            for chunk in resp.stream(64 * 1024):
                yield chunk
        finally:
            try:
                resp.close()
                resp.release_conn()
            except Exception:
                pass

    logger.info(
        "[ExtraVideosRoute] stream ok user_id=%s extra_video_id=%s object=%s",
        user_id, extra_video_id, obj,
    )
    return StreamingResponse(_stream(), media_type="video/mp4")


# ── POST /{id}/refine — v23.3 ───────────────────────────────────────────────


@router.post("/{extra_video_id}/refine")
async def refine_extra_video(
    extra_video_id: str,
    body: ExtraVideoRefine,
    current_user=Depends(get_current_user),
):
    """v23.3 — 멀티턴 수정 잡 생성.

    - owner/admin 가드 + parent 도큐먼트 로드.
    - parent.status != completed 면 422.
    - video_model 은 parent 에 lock (body 에서 받지 않음).
    - source 는 parent 와 동일 (source_kind/source_object_name/source_scene_image_id carry).
    - chain_root_video_id = parent.chain_root_video_id 또는 parent._id (legacy 폴백).
    - variant_count=1 강제.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] refine entry user_id=%s is_admin=%s "
        "extra_video_id=%s motion_count=%d text_len=%d use_seconds=%s",
        user_id, is_admin, extra_video_id,
        len(body.motion_presets or []), len(body.user_text or ""),
        ("none" if body.use_seconds is None else str(body.use_seconds)),
    )

    # 1) owner + parent 로드 ────────────────────────────────────────────────
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    parent, owner_user_id, _ = resolved

    parent_id_str = str(parent.get("_id"))
    parent_status = parent.get("status") or ""
    parent_mv_job_id = parent.get("mv_job_id") or ""
    parent_video_model = parent.get("video_model") or ""

    # 2) parent.status != completed → 422 ───────────────────────────────────
    if parent_status != "completed":
        logger.warning(
            "[ExtraVideosRoute] refine parent not completed user_id=%s "
            "extra_video_id=%s parent_status=%s",
            user_id, extra_video_id, parent_status,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상이 완료된 상태여야 해요."},
        )

    # 3) video_model lock — parent 값을 그대로 사용 ─────────────────────────
    if parent_video_model not in ALLOWED_VIDEO_MODELS:
        logger.warning(
            "[ExtraVideosRoute] refine parent video_model unknown user_id=%s "
            "extra_video_id=%s parent_video_model=%s",
            user_id, extra_video_id, parent_video_model,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상의 모델 정보가 없어요. 새로 만들어 주세요."},
        )
    locked_model = parent_video_model

    # 4) 모델 키 게이팅 (503) — locked 값 기준 ─────────────────────────────
    if locked_model == "veo" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Veo(Gemini) API 키가 설정되지 않았어요."},
        )
    if locked_model == "kling" and (
        not settings.kling_access_key or not settings.kling_secret_key
    ):
        return JSONResponse(
            status_code=503,
            content={"error": "Kling API 키가 설정되지 않았어요."},
        )
    if locked_model == "seedance" and not settings.fal_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Seedance(fal.ai) API 키가 설정되지 않았어요."},
        )
    if locked_model == "grok" and not settings.xai_api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요."
            },
        )

    # 5) source carry — parent 와 동일 ──────────────────────────────────────
    source_kind = parent.get("source_kind") or ""
    source_object_name = parent.get("source_object_name") or ""
    source_scene_image_id = parent.get("source_scene_image_id")
    if source_kind not in ALLOWED_SOURCE_KINDS:
        logger.warning(
            "[ExtraVideosRoute] refine parent source_kind invalid user_id=%s "
            "extra_video_id=%s parent_source_kind=%s",
            user_id, extra_video_id, source_kind,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상의 소스 정보가 잘못되어 있어요."},
        )
    if not source_object_name:
        logger.warning(
            "[ExtraVideosRoute] refine parent source_object_name missing "
            "user_id=%s extra_video_id=%s",
            user_id, extra_video_id,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상의 소스 이미지를 찾을 수 없어요."},
        )

    # 6) use_seconds 결정 + 모델별 클램프 ───────────────────────────────────
    requested_use_seconds = (
        float(body.use_seconds) if body.use_seconds is not None
        else float(parent.get("use_seconds") or 5)
    )
    lo, hi = _USE_SECONDS_BOUNDS.get(locked_model, (1, 20))
    clamped_use_seconds = max(float(lo), min(float(hi), requested_use_seconds))

    # 7) motion_presets 검증 (unknown 키는 무시) ────────────────────────────
    requested_motions = [
        m for m in (body.motion_presets or []) if isinstance(m, str)
    ]
    known_motions = [
        m for m in requested_motions if m in CAMERA_MOTION_PRESETS
    ]
    if len(known_motions) != len(requested_motions):
        unknown = [m for m in requested_motions if m not in CAMERA_MOTION_PRESETS]
        logger.info(
            "[ExtraVideosRoute] refine drop_unknown_motions user_id=%s "
            "extra_video_id=%s unknown=%s",
            user_id, extra_video_id, unknown[:8],
        )

    # 8) chain_root 결정 — parent.chain_root_video_id 또는 parent._id (legacy 폴백)
    chain_root_id = parent.get("chain_root_video_id") or parent_id_str

    # 9) 새 extra_video doc 생성 ────────────────────────────────────────────
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    new_oid = ObjectId()
    new_id = str(new_oid)
    doc = {
        "_id": new_oid,
        "mv_job_id": parent_mv_job_id,
        "user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "status": "queued",
        "object_name": None,
        "video_model": locked_model,
        "use_seconds": clamped_use_seconds,
        "variant_count": 1,
        "requested_variant_count": 1,
        "source_kind": source_kind,
        "source_scene_image_id": source_scene_image_id,
        "source_object_name": source_object_name,
        "user_text": (body.user_text or ""),
        "motion_presets": known_motions,
        # v23.3 멀티턴 refine 그룹핑.
        "parent_video_id": parent_id_str,
        "chain_root_video_id": chain_root_id,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.extra_videos.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] refine insert failed user_id=%s "
            "extra_video_id=%s parent=%s: %s: %s",
            user_id, new_id, parent_id_str, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "영상 수정 잡 생성에 실패했습니다."},
        )

    logger.info(
        "[ExtraVideosRoute] refine queued user_id=%s mv_job_id=%s "
        "extra_video_id=%s parent_video_id=%s chain_root_video_id=%s "
        "video_model=%s use_seconds=%.2f motion_count=%d",
        user_id, parent_mv_job_id, new_id, parent_id_str, chain_root_id,
        locked_model, clamped_use_seconds, len(known_motions),
    )

    # 10) 백그라운드 잡 시작 (v23.2 함수 재사용) ─────────────────────────────
    asyncio.create_task(
        _run_extra_video_generation(
            extra_video_id=new_id,
            mv_job_id=parent_mv_job_id,
            owner_user_id=owner_user_id,
            source_kind=source_kind,
            source_object_name=source_object_name,
            user_text=body.user_text or "",
            motion_presets=known_motions,
            video_model=locked_model,
            use_seconds=float(clamped_use_seconds),
        )
    )

    return {
        "id": new_id,
        "status": "queued",
        "chain_root_video_id": chain_root_id,
        "parent_video_id": parent_id_str,
    }


# ── GET /{id}/chain — v23.3 ─────────────────────────────────────────────────


@router.get("/{extra_video_id}/chain")
async def get_extra_video_chain(
    extra_video_id: str,
    current_user=Depends(get_current_user),
):
    """v23.3 — anchor 영상이 속한 refine 체인의 모든 버전을 created_at asc 순으로 반환.

    체인 fallback: 구버전 doc 에 chain_root_video_id 가 없으면 anchor 자체를 root 로 간주.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] chain entry user_id=%s is_admin=%s extra_video_id=%s",
        user_id, is_admin, extra_video_id,
    )
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    anchor, owner_user_id, _ = resolved

    chain_root_id = anchor.get("chain_root_video_id") or str(anchor.get("_id"))
    chain_root_oid = _to_oid(chain_root_id)

    # legacy 호환 — chain_root_video_id 가 채워진 후속 버전 + chain_root doc 자체
    # (chain_root_video_id 가 없는 v1 legacy) 둘 다 잡는다.
    or_conditions: list[dict] = [
        {"chain_root_video_id": chain_root_id},
    ]
    if chain_root_oid is not None:
        or_conditions.append({"_id": chain_root_oid})

    mongo = get_mongo()
    items: list[dict] = []
    try:
        cursor = mongo.extra_videos.find({
            "user_id": owner_user_id,
            "$or": or_conditions,
        }).sort("created_at", 1)
        async for doc in cursor:
            items.append(_serialize_extra_video(doc))
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] chain mongo failed user_id=%s extra_video_id=%s "
            "chain_root_video_id=%s: %s: %s",
            user_id, extra_video_id, chain_root_id,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "영상 체인 조회에 실패했습니다."},
        )

    logger.info(
        "[ExtraVideosRoute] chain ok user_id=%s extra_video_id=%s "
        "chain_root_video_id=%s count=%d",
        user_id, extra_video_id, chain_root_id, len(items),
    )
    return {
        "chain_root_video_id": chain_root_id,
        "items": items,
    }


# ── POST /{id}/continue — v23.4 ──────────────────────────────────────────────


@router.post("/{extra_video_id}/continue")
async def continue_extra_video(
    extra_video_id: str,
    body: ExtraVideoContinue,
    current_user=Depends(get_current_user),
):
    """v23.4 — 이전 영상의 마지막 프레임을 시작 이미지로 쓰는 새 영상 생성.

    - owner/admin 가드 + parent 도큐먼트 로드 (`_resolve_extra_video`).
    - parent.status == "completed" 검증 (422 if not).
    - parent.object_name (videos 버킷의 mp4) 검증 (422 if missing).
    - **`extract_last_frame_png(...)` 를 핸들러에서 직접 호출** (fail-fast 안).
      ffmpeg 미설치 시 503, 다른 실패는 422.
    - 새 extra_video doc 생성: source_kind="prev_video_last_frame",
      source_object_name=추출된 PNG, parent_video_id=parent._id,
      chain_root_video_id=new_id (자기 자신 — Continue 는 refine 과 별개 흐름).
    - video_model = body.video_model 우선, 없으면 parent.video_model lock.
    - asyncio.create_task 로 백그라운드 영상 생성 시작.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[ExtraVideosRoute] continue entry user_id=%s is_admin=%s "
        "extra_video_id=%s body_video_model=%s use_seconds=%s "
        "motion_count=%d text_len=%d",
        user_id, is_admin, extra_video_id,
        (body.video_model or "(parent-lock)"),
        ("none" if body.use_seconds is None else str(body.use_seconds)),
        len(body.motion_presets or []), len(body.user_text or ""),
    )

    # 1) owner + parent 로드 ────────────────────────────────────────────────
    resolved = await _resolve_extra_video(extra_video_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    parent, owner_user_id, _ = resolved

    parent_id_str = str(parent.get("_id"))
    parent_status = parent.get("status") or ""
    parent_mv_job_id = parent.get("mv_job_id") or ""
    parent_video_model = parent.get("video_model") or ""
    parent_video_object_name = parent.get("object_name") or ""

    # 2) parent.status != completed → 422 ───────────────────────────────────
    if parent_status != "completed":
        logger.warning(
            "[ExtraVideosRoute] continue parent not completed user_id=%s "
            "extra_video_id=%s parent_status=%s",
            user_id, extra_video_id, parent_status,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상이 완료된 상태여야 해요."},
        )

    # 3) parent.object_name (videos 버킷 mp4) 검증 ─────────────────────────
    if not parent_video_object_name:
        logger.warning(
            "[ExtraVideosRoute] continue parent video missing user_id=%s "
            "extra_video_id=%s",
            user_id, extra_video_id,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "부모 영상의 저장 경로를 찾을 수 없어요."},
        )

    # 4) video_model 결정 — body 우선, 없으면 parent lock ──────────────────
    chosen_model = body.video_model or parent_video_model
    if chosen_model not in ALLOWED_VIDEO_MODELS:
        logger.warning(
            "[ExtraVideosRoute] continue video_model invalid user_id=%s "
            "extra_video_id=%s chosen_model=%s parent_model=%s",
            user_id, extra_video_id, chosen_model, parent_video_model,
        )
        return JSONResponse(
            status_code=422,
            content={"error": "지원되지 않는 영상 모델이에요."},
        )

    # 5) 모델 키 게이팅 (503) ───────────────────────────────────────────────
    if chosen_model == "veo" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Veo(Gemini) API 키가 설정되지 않았어요."},
        )
    if chosen_model == "kling" and (
        not settings.kling_access_key or not settings.kling_secret_key
    ):
        return JSONResponse(
            status_code=503,
            content={"error": "Kling API 키가 설정되지 않았어요."},
        )
    if chosen_model == "seedance" and not settings.fal_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Seedance(fal.ai) API 키가 설정되지 않았어요."},
        )
    if chosen_model == "grok" and not settings.xai_api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요."
            },
        )

    # 6) ffmpeg 사전 체크 (503) — 추출 시도 전에 빠르게 거른다 ─────────────
    if not ffmpeg_available():
        logger.warning(
            "[ExtraVideosRoute] continue ffmpeg missing user_id=%s "
            "extra_video_id=%s",
            user_id, extra_video_id,
        )
        return JSONResponse(
            status_code=503,
            content={
                "error": "ffmpeg 가 설치되지 않았어요. 운영자에게 문의해 주세요."
            },
        )

    # 7) use_seconds 결정 + 모델별 클램프 ───────────────────────────────────
    requested_use_seconds = (
        float(body.use_seconds) if body.use_seconds is not None
        else float(parent.get("use_seconds") or 5)
    )
    lo, hi = _USE_SECONDS_BOUNDS.get(chosen_model, (1, 20))
    clamped_use_seconds = max(float(lo), min(float(hi), requested_use_seconds))

    # 8) motion_presets 검증 (unknown 키는 무시) ────────────────────────────
    requested_motions = [
        m for m in (body.motion_presets or []) if isinstance(m, str)
    ]
    known_motions = [
        m for m in requested_motions if m in CAMERA_MOTION_PRESETS
    ]
    if len(known_motions) != len(requested_motions):
        unknown = [m for m in requested_motions if m not in CAMERA_MOTION_PRESETS]
        logger.info(
            "[ExtraVideosRoute] continue drop_unknown_motions user_id=%s "
            "extra_video_id=%s unknown=%s",
            user_id, extra_video_id, unknown[:8],
        )

    # 9) 새 _id 를 먼저 발급 → 마지막 프레임 PNG 파일명에 사용 ──────────────
    new_oid = ObjectId()
    new_id = str(new_oid)

    # 10) **fail-fast** — 핸들러에서 직접 마지막 프레임 추출 ────────────────
    try:
        png_object_name = await extract_last_frame_png(
            extra_video_id=new_id,
            mv_job_id=parent_mv_job_id,
            video_object_name=parent_video_object_name,
        )
    except RuntimeError as e:
        msg = str(e) or "이전 영상의 마지막 프레임을 추출하지 못했어요."
        logger.warning(
            "[ExtraVideosRoute] continue extract_last_frame failed user_id=%s "
            "extra_video_id=%s parent=%s: %s",
            user_id, new_id, parent_id_str, msg,
        )
        # ffmpeg 미설치 메시지는 503 으로 격상.
        if "ffmpeg" in msg:
            return JSONResponse(status_code=503, content={"error": msg})
        return JSONResponse(status_code=422, content={"error": msg})
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] continue extract_last_frame unexpected "
            "user_id=%s extra_video_id=%s parent=%s: %s: %s",
            user_id, new_id, parent_id_str, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "이전 영상의 마지막 프레임을 추출하지 못했어요."},
        )

    # 11) 새 extra_video doc 생성 ───────────────────────────────────────────
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    new_source_kind = "prev_video_last_frame"
    # Continue 는 refine 과 별개 흐름 — 새 root 로 시작 (chain_root = self).
    chain_root_id = new_id
    doc = {
        "_id": new_oid,
        "mv_job_id": parent_mv_job_id,
        "user_id": owner_user_id,
        "requested_by_user_id": user_id,
        "status": "queued",
        "object_name": None,
        "video_model": chosen_model,
        "use_seconds": clamped_use_seconds,
        "variant_count": 1,
        "requested_variant_count": 1,
        "source_kind": new_source_kind,
        "source_scene_image_id": None,
        "source_object_name": png_object_name,
        "user_text": (body.user_text or ""),
        "motion_presets": known_motions,
        # Continue: parent 관계는 표시하되 chain_root 는 self (refine 과 분리).
        "parent_video_id": parent_id_str,
        "chain_root_video_id": chain_root_id,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await mongo.extra_videos.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[ExtraVideosRoute] continue insert failed user_id=%s "
            "extra_video_id=%s parent=%s: %s: %s",
            user_id, new_id, parent_id_str, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "이어붙이기 잡 생성에 실패했습니다."},
        )

    logger.info(
        "[ExtraVideosRoute] continue queued user_id=%s mv_job_id=%s "
        "extra_video_id=%s parent_video_id=%s chain_root_video_id=%s "
        "video_model=%s use_seconds=%.2f motion_count=%d source_kind=%s "
        "source_object=%s",
        user_id, parent_mv_job_id, new_id, parent_id_str, chain_root_id,
        chosen_model, clamped_use_seconds, len(known_motions),
        new_source_kind, png_object_name,
    )

    # 12) 백그라운드 잡 시작 (기존 함수 재사용) ─────────────────────────────
    asyncio.create_task(
        _run_extra_video_generation(
            extra_video_id=new_id,
            mv_job_id=parent_mv_job_id,
            owner_user_id=owner_user_id,
            source_kind=new_source_kind,
            source_object_name=png_object_name,
            user_text=body.user_text or "",
            motion_presets=known_motions,
            video_model=chosen_model,
            use_seconds=float(clamped_use_seconds),
        )
    )

    return {
        "id": new_id,
        "status": "queued",
        "parent_video_id": parent_id_str,
        "source_object_name": png_object_name,
    }
