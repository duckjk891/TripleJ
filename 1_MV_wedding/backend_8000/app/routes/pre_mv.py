"""
v17.2 — 식전영상(Pre-MV) 라우터.

prefix: `/api/pre-mv`. owner OR admin 가드 (mv_jobs.user_id 기준).

엔드포인트:
  POST   /jobs                                 — pre_mv_job 생성 (mv_job.lyric_timestamps_status=ready 필수)
  GET    /jobs                                 — 해당 mv_job_id 의 pre_mv_jobs 목록 (?mv_job_id=...)
  GET    /jobs/{id}                            — 상세 (scene_plan + scenes 포함)
  GET    /jobs/{id}/status                     — 폴링용 경량 응답
  POST   /jobs/{id}/phase0                     — Phase 0 LLM 매핑 (백그라운드)
  POST   /jobs/{id}/phase1                     — Phase 1 씬 분할 (백그라운드)
  POST   /jobs/{id}/phase2                     — Phase 2 씬 이미지 (백그라운드, async semaphore=3)  [v17.2]
  POST   /jobs/{id}/scenes/{n}/regenerate-image — 단일 씬 이미지 재생성  [v17.2]
  GET    /jobs/{id}/scenes/{n}/image            — 씬 이미지 프록시 (Bearer OR ?token=)  [v17.2]
  PATCH  /jobs/{id}/scenes/{n}                 — 씬 텍스트 편집 + user_edited_fields 누적

v17.3 에서 추가될 엔드포인트: phase3/4, regenerate-video, result/stream, DELETE.

로그 prefix: `[PreMVRoute]`. 백그라운드 헬퍼는 `[PreMVRoute]` 그대로 + phase 토큰.
"""

from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.pre_mv_phase0_mapper import generate_scene_plan
from ..services.pre_mv_phase1_splitter import split_into_scenes
from ..services.pre_mv_phase2_image_generator import (
    ALLOWED_IMAGE_MODELS,
    generate_scene_image,
)
from ..services.pre_mv_phase4_compositor import (
    compose_pre_mv_result,
    ffmpeg_available,
)
from ..services.pre_mv_grok_generator import generate_scene_video_grok
from ..services.pre_mv_kling_generator import generate_scene_video_kling
from ..services.pre_mv_seedance_generator import generate_scene_video_seedance
from ..services.pre_mv_veo_generator import generate_scene_video_veo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pre-mv", tags=["PreMV"])


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _to_oid(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def _iso(dt: Any) -> Optional[str]:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt


async def _resolve_mv_job(mv_job_id: str, current_user: dict):
    """Return (mv_job_doc, owner_user_id, is_admin) or a JSONResponse error.

    Pattern mirrors `routes/wedding_photos.py::_resolve_mv_job`.
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


async def _resolve_pre_mv_job(pre_mv_job_id: str, current_user: dict):
    """Return (pre_mv_job_doc, mv_job_doc, owner_user_id, is_admin) or JSONResponse.

    1) pre_mv_jobs 도큐 로드 → 404 if missing.
    2) mv_jobs 도큐 로드 (owner 검증의 근거) → 404 if missing.
    3) owner+admin 가드 → 403 if not allowed.
    """
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 pre_mv_job_id 입니다."},
        )
    mongo = get_mongo()
    pre_doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
    if not pre_doc:
        return JSONResponse(
            status_code=404,
            content={"error": "식전영상 잡을 찾을 수 없습니다."},
        )
    mv_job_id = pre_doc.get("mv_job_id")
    if not mv_job_id:
        return JSONResponse(
            status_code=500,
            content={"error": "식전영상 잡에 mv_job_id 가 없습니다."},
        )
    mv_oid = _to_oid(mv_job_id)
    if mv_oid is None:
        return JSONResponse(
            status_code=500,
            content={"error": "식전영상 잡의 mv_job_id 가 유효하지 않습니다."},
        )
    mv_doc = await mongo.mv_jobs.find_one({"_id": mv_oid})
    if not mv_doc:
        return JSONResponse(
            status_code=404,
            content={"error": "부모 mv_job 을 찾을 수 없습니다."},
        )
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    owner_user_id = mv_doc.get("user_id")
    is_owner = owner_user_id == user_id
    if not is_owner and not is_admin:
        return JSONResponse(
            status_code=403,
            content={"error": "접근 권한이 없습니다."},
        )
    return pre_doc, mv_doc, owner_user_id, is_admin


def _serialize_pre_mv_job(doc: dict, *, light: bool = False) -> dict:
    """Mongo doc → JSON response shape.

    light=True 면 폴링용 경량 응답 — scenes/scene_plan 본체는 길이만, 본문 제외.
    """
    base: dict[str, Any] = {
        "pre_mv_job_id": str(doc.get("_id")) if doc.get("_id") is not None else None,
        "mv_job_id": doc.get("mv_job_id"),
        "user_id": doc.get("user_id"),
        "status": doc.get("status"),
        "progress": doc.get("progress", 0),
        "scenario_model": doc.get("scenario_model"),
        "image_model": doc.get("image_model"),
        "video_model": doc.get("video_model"),
        # v19 — 어느 Suno variant 의 트랙으로 만드는지 (1 또는 2). legacy=1.
        "audio_variant": int(doc.get("audio_variant") or 1),
        "phase0_error": doc.get("phase0_error"),
        "phase1_error": doc.get("phase1_error"),
        "phase2_error": doc.get("phase2_error"),
        "phase3_error": doc.get("phase3_error"),
        "phase4_error": doc.get("phase4_error"),
        "result_video_object_name": doc.get("result_video_object_name"),
        "result_video_generated_at": _iso(doc.get("result_video_generated_at")),
        "error_message": doc.get("error_message"),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }
    if light:
        base["scene_plan_count"] = len(doc.get("scene_plan") or [])
        base["scenes_count"] = len(doc.get("scenes") or [])
        return base
    base["scene_plan"] = doc.get("scene_plan") or []
    base["scenes"] = doc.get("scenes") or []
    base["audio_object_name"] = doc.get("audio_object_name")
    base["phase_progress"] = doc.get("phase_progress") or {}
    base["lyric_timestamps_count"] = len(doc.get("lyric_timestamps") or [])
    return base


# ──────────────────────────────────────────────────────────────────────────
# Pydantic body
# ──────────────────────────────────────────────────────────────────────────

class CreatePreMVJobBody(BaseModel):
    mv_job_id: str
    # v19 — Suno 두 variant 중 식전영상 만들 트랙 선택 (1 또는 2). 기본 1.
    variant: int = Field(default=1, ge=1, le=2)


class StartPhase0Body(BaseModel):
    scenario_model: Literal["claude_4_7_opus", "gpt_latest"] = "claude_4_7_opus"
    force: bool = False


class StartPhase1Body(BaseModel):
    force: bool = False


class StartPhase2Body(BaseModel):
    """v17.2 — Phase 2 (씬 이미지) 시작 body.

    image_model 은 잡 단위로 lock — 부분 재생성은 잡의 image_model 을 그대로 사용.
    force=true 면 이미 done 인 씬도 모두 재생성. false 면 done 은 skip.
    """

    image_model: Literal["gpt_image_2", "nb_pro"] = "gpt_image_2"
    force: bool = False


class StartPhase3Body(BaseModel):
    """v17.3 — Phase 3 (씬 영상) 시작 body.

    video_model 은 잡 단위로 lock — 부분 재생성은 잡의 video_model 을 그대로 사용.
    force=true 면 이미 done 인 씬도 모두 재생성.
    """

    video_model: Literal["veo", "kling", "seedance", "grok"] = "veo"
    force: bool = False


class StartPhase4Body(BaseModel):
    """v17.3 — Phase 4 (concat + audio merge) 시작 body."""

    force: bool = False


class PatchSceneBody(BaseModel):
    description: Optional[str] = Field(default=None, max_length=2000)
    description_ko: Optional[str] = Field(default=None, max_length=2000)
    image_prompt: Optional[str] = Field(default=None, max_length=4000)
    image_prompt_ko: Optional[str] = Field(default=None, max_length=4000)
    video_prompt: Optional[str] = Field(default=None, max_length=4000)
    video_prompt_ko: Optional[str] = Field(default=None, max_length=4000)


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs — pre_mv_job 생성 (멱등)
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs")
async def create_pre_mv_job(
    body: CreatePreMVJobBody,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    mv_job_id = (body.mv_job_id or "").strip()
    audio_variant = int(body.variant or 1)
    logger.info(
        "[PreMVRoute] action=create entry user_id=%s is_admin=%s mv_job_id=%s "
        "audio_variant=%d",
        user_id, is_admin, mv_job_id, audio_variant,
    )

    if not mv_job_id:
        return JSONResponse(
            status_code=400,
            content={"error": "mv_job_id 가 필요합니다."},
        )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    mv_job, owner_user_id, _ = resolved

    # mv_jobs.status 검증 — music_ready 여야 식전영상 작업 가능
    mv_status = mv_job.get("status")
    if mv_status != "music_ready":
        logger.warning(
            "[PreMVRoute] action=create reject mv_status user_id=%s mv_job_id=%s status=%s",
            user_id, mv_job_id, mv_status,
        )
        return JSONResponse(
            status_code=409,
            content={"error": "음악 생성이 완료된 잡에서만 식전영상을 만들 수 있습니다."},
        )

    # v19 — variant 별 timestamps 검증. variant 키가 있어야 진입 허용.
    # 회귀 안전망: lyric_timestamps_variants 가 비어 있으면 단수 lyric_timestamps 를 variant 1 로 인정.
    ts_variants = mv_job.get("lyric_timestamps_variants") or {}
    single_ts = mv_job.get("lyric_timestamps") or []
    ts_status = mv_job.get("lyric_timestamps_status")

    selected_ts: list[dict] = []
    if isinstance(ts_variants, dict) and ts_variants.get(str(audio_variant)):
        selected_ts = ts_variants.get(str(audio_variant)) or []
    elif audio_variant == 1 and single_ts:
        # legacy fallback — variants dict 비어있고 단수 ts 만 있는 잡 (백필 전).
        selected_ts = single_ts

    if not selected_ts or ts_status != "ready":
        variants_present = sorted(list(ts_variants.keys())) if isinstance(ts_variants, dict) else []
        logger.warning(
            "[PreMVRoute] action=create reject timestamps user_id=%s mv_job_id=%s "
            "audio_variant=%d ts_status=%s variants_present=%s single_count=%d",
            user_id, mv_job_id, audio_variant, ts_status,
            variants_present, len(single_ts),
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "선택한 트랙({}번) 의 가사 타임스탬프가 준비되지 않았어요.".format(
                    audio_variant,
                ),
            },
        )

    mongo = get_mongo()

    # 멱등 — 이미 존재하는 pre_mv_job (같은 mv_job_id + audio_variant) 이 있으면 그대로 반환.
    # v19 이전 도큐는 audio_variant 필드가 없으니 1 로 간주.
    existing = await mongo.pre_mv_jobs.find_one({"mv_job_id": mv_job_id})
    if existing:
        existing_variant = int(existing.get("audio_variant") or 1)
        if existing_variant == audio_variant:
            logger.info(
                "[PreMVRoute] action=create idempotent_hit user_id=%s mv_job_id=%s "
                "pre_mv_job_id=%s status=%s audio_variant=%d",
                user_id, mv_job_id, str(existing.get("_id")), existing.get("status"),
                existing_variant,
            )
            return _serialize_pre_mv_job(existing)
        # 다른 variant 로 요청된 경우 — 기존 잡 사용 안내(현재 정책: 한 mv_job 당 한 pre_mv_job).
        logger.warning(
            "[PreMVRoute] action=create reject variant_mismatch user_id=%s mv_job_id=%s "
            "existing_variant=%d requested_variant=%d existing_pre_mv_job_id=%s",
            user_id, mv_job_id, existing_variant, audio_variant, str(existing.get("_id")),
        )
        return JSONResponse(
            status_code=409,
            content={
                "error": "이미 다른 트랙({}번) 으로 식전영상이 만들어지고 있어요.".format(
                    existing_variant,
                ),
            },
        )

    # story_snapshot 로드 (가능하면)
    story_snapshot: dict = {}
    story_id = mv_job.get("story_id")
    if story_id:
        story_oid = _to_oid(story_id)
        if story_oid:
            try:
                story_doc = await mongo.stories.find_one({"_id": story_oid})
                if story_doc:
                    story_snapshot = (story_doc or {}).get("story") or {}
            except Exception as e:
                logger.warning(
                    "[PreMVRoute] action=create story load failed user_id=%s mv_job_id=%s "
                    "story_id=%s: %s: %s",
                    user_id, mv_job_id, story_id, type(e).__name__, str(e)[:200],
                )

    # v19 — variant 에 따른 audio_object_name 선택.
    # audio_variants[variant-1] 가 존재하면 그것, 없으면 단수 audio_object_name 으로 fallback.
    audio_variants_list = mv_job.get("audio_variants") or []
    chosen_audio_object: Optional[str] = None
    if 1 <= audio_variant <= len(audio_variants_list):
        chosen_audio_object = audio_variants_list[audio_variant - 1]
    if not chosen_audio_object:
        chosen_audio_object = mv_job.get("audio_object_name")

    now = datetime.now(timezone.utc)
    new_doc = {
        "mv_job_id": mv_job_id,
        "user_id": owner_user_id,
        "status": "draft",
        "progress": 0,
        "scenario_model": None,
        "image_model": None,
        "video_model": None,
        "story_snapshot": story_snapshot,
        "lyrics_snapshot": mv_job.get("lyrics") or {},
        "lyric_timestamps": selected_ts,
        "audio_variant": audio_variant,
        "audio_object_name": chosen_audio_object,
        "scene_plan": [],
        "scenes": [],
        "final_video_object_name": None,
        "phase_progress": {},
        "phase0_error": None,
        "phase1_error": None,
        "phase2_error": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongo.pre_mv_jobs.insert_one(new_doc)
    except Exception as e:
        logger.exception(
            "[PreMVRoute] action=create insert failed user_id=%s mv_job_id=%s: %s: %s",
            user_id, mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "식전영상 잡 생성에 실패했습니다."},
        )

    new_doc["_id"] = result.inserted_id
    pre_mv_job_id = str(result.inserted_id)
    logger.info(
        "[PreMVRoute] action=create ok user_id=%s mv_job_id=%s pre_mv_job_id=%s "
        "audio_variant=%d lyric_lines=%d",
        user_id, mv_job_id, pre_mv_job_id, audio_variant, len(selected_ts),
    )
    return _serialize_pre_mv_job(new_doc)


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs?mv_job_id=...
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs")
async def list_pre_mv_jobs(
    mv_job_id: str = Query(..., min_length=1),
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] action=list entry user_id=%s is_admin=%s mv_job_id=%s",
        user_id, is_admin, mv_job_id,
    )

    resolved = await _resolve_mv_job(mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved

    mongo = get_mongo()
    items: list[dict] = []
    cursor = mongo.pre_mv_jobs.find({"mv_job_id": mv_job_id}).sort("created_at", -1)
    async for d in cursor:
        items.append(_serialize_pre_mv_job(d, light=True))

    logger.info(
        "[PreMVRoute] action=list ok user_id=%s mv_job_id=%s count=%d",
        user_id, mv_job_id, len(items),
    )
    return {"items": items}


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs/{id}
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs/{pre_mv_job_id}")
async def get_pre_mv_job(
    pre_mv_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved
    logger.info(
        "[PreMVRoute] action=get ok user_id=%s is_admin=%s pre_mv_job_id=%s status=%s",
        user_id, is_admin, pre_mv_job_id, pre_doc.get("status"),
    )
    return _serialize_pre_mv_job(pre_doc)


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs/{id}/status  (폴링 경량)
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs/{pre_mv_job_id}/status")
async def get_pre_mv_job_status(
    pre_mv_job_id: str,
    current_user=Depends(get_current_user),
):
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved
    return _serialize_pre_mv_job(pre_doc, light=True)


# ──────────────────────────────────────────────────────────────────────────
# Phase 0 — 백그라운드 헬퍼
# ──────────────────────────────────────────────────────────────────────────

async def _run_phase0(pre_mv_job_id: str, scenario_model: str) -> None:
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error("[PreMVRoute] phase=phase0 bg invalid id pre_mv_job_id=%s", pre_mv_job_id)
        return

    logger.info(
        "[PreMVRoute] phase=phase0 bg entry pre_mv_job_id=%s model=%s",
        pre_mv_job_id, scenario_model,
    )

    try:
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase0 bg doc missing pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return

        scene_plan = await generate_scene_plan(
            pre_mv_job_id=pre_mv_job_id,
            story_snapshot=doc.get("story_snapshot") or {},
            lyrics_snapshot=doc.get("lyrics_snapshot") or {},
            lyric_timestamps=doc.get("lyric_timestamps") or [],
            scenario_model=scenario_model,
        )

        now = datetime.now(timezone.utc)
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase0_ready",
                    "progress": 100,
                    "scenario_model": scenario_model,
                    "scene_plan": scene_plan,
                    # phase0 재실행 후 scenes 무효화 정책: 호출 시점에서 처리(아래 POST 핸들러).
                    "phase0_error": None,
                    "updated_at": now,
                    "phase_progress.phase0.finished_at": now,
                    "phase_progress.phase0.model": scenario_model,
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase0 bg ok pre_mv_job_id=%s model=%s lines_out=%d",
            pre_mv_job_id, scenario_model, len(scene_plan),
        )
    except Exception as e:
        now = datetime.now(timezone.utc)
        err_msg = str(e)[:500]
        logger.exception(
            "[PreMVRoute] phase=phase0 bg failed pre_mv_job_id=%s model=%s err=%s: %s",
            pre_mv_job_id, scenario_model, type(e).__name__, err_msg,
        )
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase0_failed",
                        "phase0_error": err_msg,
                        "updated_at": now,
                        "phase_progress.phase0.error": err_msg,
                    }
                },
            )
        except Exception as e2:
            logger.exception(
                "[PreMVRoute] phase=phase0 bg failure update_failed pre_mv_job_id=%s: %s: %s",
                pre_mv_job_id, type(e2).__name__, str(e2)[:200],
            )


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/phase0
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/phase0")
async def start_phase0(
    pre_mv_job_id: str,
    body: StartPhase0Body,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase0 entry user_id=%s is_admin=%s pre_mv_job_id=%s "
        "model=%s force=%s",
        user_id, is_admin, pre_mv_job_id, body.scenario_model, body.force,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    cur_status = pre_doc.get("status") or "draft"
    allowed = {"draft", "phase0_failed", "phase0_ready", "phase0_mapping"}
    if cur_status not in allowed:
        logger.warning(
            "[PreMVRoute] phase=phase0 status reject pre_mv_job_id=%s status=%s",
            pre_mv_job_id, cur_status,
        )
        return JSONResponse(
            status_code=409,
            content={"error": f"현재 상태({cur_status})에서는 Phase 0 를 시작할 수 없어요."},
        )

    # phase0 재실행 시 scenes[] 가 차 있으면 force 필요 (PLAN 위험 #4)
    has_scenes = bool(pre_doc.get("scenes"))
    if has_scenes and not body.force:
        logger.warning(
            "[PreMVRoute] phase=phase0 scenes_exist no_force pre_mv_job_id=%s scenes=%d",
            pre_mv_job_id, len(pre_doc.get("scenes") or []),
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "이미 씬이 있어요. Phase 0 를 재실행하면 씬도 초기화됩니다. "
                         "force=true 로 다시 호출해주세요.",
            },
        )

    # 키 게이팅 (사전 검증)
    from ..config import settings
    if body.scenario_model == "claude_4_7_opus" and not settings.anthropic_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Claude 모델이 구성되어 있지 않습니다."},
        )
    if body.scenario_model == "gpt_latest" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 모델이 구성되어 있지 않습니다."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)

    update_set: dict[str, Any] = {
        "status": "phase0_mapping",
        "progress": 0,
        "scenario_model": body.scenario_model,
        "phase0_error": None,
        "updated_at": now,
        "phase_progress.phase0.started_at": now,
        "phase_progress.phase0.model": body.scenario_model,
        "phase_progress.phase0.error": None,
    }
    if has_scenes and body.force:
        # scenes[] 초기화 (PATCH 편집 흔적 포함). user 가 명시적으로 확인했다고 간주.
        update_set["scenes"] = []

    try:
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": update_set})
    except Exception as e:
        logger.exception(
            "[PreMVRoute] phase=phase0 update failed pre_mv_job_id=%s: %s: %s",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Phase 0 시작에 실패했습니다."},
        )

    asyncio.create_task(_run_phase0(pre_mv_job_id, body.scenario_model))

    logger.info(
        "[PreMVRoute] phase=phase0 queued user_id=%s pre_mv_job_id=%s model=%s",
        user_id, pre_mv_job_id, body.scenario_model,
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "status": "phase0_mapping",
        "scenario_model": body.scenario_model,
    }


# ──────────────────────────────────────────────────────────────────────────
# Phase 1 — 백그라운드 헬퍼 + POST
# ──────────────────────────────────────────────────────────────────────────

async def _run_phase1(pre_mv_job_id: str) -> None:
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error("[PreMVRoute] phase=phase1 bg invalid id pre_mv_job_id=%s", pre_mv_job_id)
        return

    logger.info("[PreMVRoute] phase=phase1 bg entry pre_mv_job_id=%s", pre_mv_job_id)

    try:
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase1 bg doc missing pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return

        scene_plan = doc.get("scene_plan") or []
        if not scene_plan:
            raise ValueError("scene_plan 이 비어있습니다 — Phase 0 먼저 실행이 필요합니다.")

        # music_spec — mv_jobs 에서 끌어와 분위기 힌트로 사용
        mv_job_id = doc.get("mv_job_id")
        music_spec: dict = {}
        if mv_job_id:
            mv_oid = _to_oid(mv_job_id)
            if mv_oid:
                mv = await mongo.mv_jobs.find_one({"_id": mv_oid})
                if mv:
                    music_spec = mv.get("music_spec") or {}

        scenes = await split_into_scenes(
            pre_mv_job_id=pre_mv_job_id,
            scene_plan=scene_plan,
            music_spec=music_spec,
        )

        now = datetime.now(timezone.utc)
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase1_ready",
                    "progress": 100,
                    "scenes": scenes,
                    "phase1_error": None,
                    "updated_at": now,
                    "phase_progress.phase1.finished_at": now,
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase1 bg ok pre_mv_job_id=%s scene_count=%d",
            pre_mv_job_id, len(scenes),
        )
    except Exception as e:
        now = datetime.now(timezone.utc)
        err_msg = str(e)[:500]
        logger.exception(
            "[PreMVRoute] phase=phase1 bg failed pre_mv_job_id=%s err=%s: %s",
            pre_mv_job_id, type(e).__name__, err_msg,
        )
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase1_failed",
                        "phase1_error": err_msg,
                        "updated_at": now,
                        "phase_progress.phase1.error": err_msg,
                    }
                },
            )
        except Exception as e2:
            logger.exception(
                "[PreMVRoute] phase=phase1 bg failure update_failed pre_mv_job_id=%s: %s: %s",
                pre_mv_job_id, type(e2).__name__, str(e2)[:200],
            )


@router.post("/jobs/{pre_mv_job_id}/phase1")
async def start_phase1(
    pre_mv_job_id: str,
    body: StartPhase1Body,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase1 entry user_id=%s is_admin=%s pre_mv_job_id=%s force=%s",
        user_id, is_admin, pre_mv_job_id, body.force,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    cur_status = pre_doc.get("status") or "draft"
    allowed = {"phase0_ready", "phase1_failed", "phase1_ready", "phase1_splitting"}
    if cur_status not in allowed:
        logger.warning(
            "[PreMVRoute] phase=phase1 status reject pre_mv_job_id=%s status=%s",
            pre_mv_job_id, cur_status,
        )
        return JSONResponse(
            status_code=409,
            content={"error": f"현재 상태({cur_status})에서는 Phase 1 을 시작할 수 없어요."},
        )

    if not pre_doc.get("scene_plan"):
        return JSONResponse(
            status_code=422,
            content={"error": "Phase 0 결과(scene_plan)가 비어있습니다."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase1_splitting",
                    "progress": 0,
                    "phase1_error": None,
                    "updated_at": now,
                    "phase_progress.phase1.started_at": now,
                    "phase_progress.phase1.error": None,
                }
            },
        )
    except Exception as e:
        logger.exception(
            "[PreMVRoute] phase=phase1 update failed pre_mv_job_id=%s: %s: %s",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Phase 1 시작에 실패했습니다."},
        )

    asyncio.create_task(_run_phase1(pre_mv_job_id))

    logger.info(
        "[PreMVRoute] phase=phase1 queued user_id=%s pre_mv_job_id=%s",
        user_id, pre_mv_job_id,
    )
    return {"pre_mv_job_id": pre_mv_job_id, "status": "phase1_splitting"}


# ──────────────────────────────────────────────────────────────────────────
# Phase 2 — 씬 이미지 (v17.2)
#
# 동시 실행 제한 = 3 (asyncio.Semaphore). 외부 API rate limit + 비용 보호.
# 부분 실패 (`phase2_partial`) → 재생성 가능. 모든 씬 done → `phase2_ready`.
# ──────────────────────────────────────────────────────────────────────────

_PHASE2_MAX_CONCURRENT = 3

# 백그라운드 잡이 켜지는 모든 상태(이 상태에선 phase2 재진입 거부).
_PHASE2_RUNNING_STATUSES = {"phase2_images"}


async def _put_scene_image_to_minio(
    *, pre_mv_job_id: str, scene_number: int, image_bytes: bytes
) -> str:
    """Upload PNG to MinIO photos bucket. Returns the object_name."""
    object_name = "pre_mv/{}/scenes/{:03d}.png".format(pre_mv_job_id, scene_number)
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_photos,
        object_name=object_name,
        data=io.BytesIO(image_bytes),
        length=len(image_bytes),
        content_type="image/png",
    )
    return object_name


async def _gate_image_model_key(image_model: str) -> Optional[JSONResponse]:
    """503 if the required API key for `image_model` is not configured."""
    if image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI 이미지 모델이 구성되어 있지 않습니다."},
        )
    if image_model == "nb_pro" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini 이미지 모델이 구성되어 있지 않습니다."},
        )
    return None


async def _refresh_phase2_status(pre_mv_job_id: str) -> None:
    """After scene-level updates, recompute the job-level phase2 status.

    Rule:
      · 전 씬 image_status=completed → status = phase2_ready
      · 한 씬이라도 failed 가 있고 generating/pending 이 없음 → phase2_partial
      · generating/pending 이 남아 있음 → phase2_images (그대로 유지)
      · scenes 비어있음 → 변경 없음
    """
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        return
    doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
    if not doc:
        return
    scenes = doc.get("scenes") or []
    if not scenes:
        return
    total = len(scenes)
    completed = sum(1 for s in scenes if (s or {}).get("image_status") == "completed")
    failed = sum(1 for s in scenes if (s or {}).get("image_status") == "failed")
    running = sum(
        1 for s in scenes
        if (s or {}).get("image_status") in ("generating", "pending")
    )
    now = datetime.now(timezone.utc)
    progress = int(round((completed / total) * 100)) if total else 0

    if running > 0:
        # 아직 진행 중인 씬이 있으면 phase2_images 유지 + progress 업데이트만.
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {"$set": {"progress": progress, "updated_at": now}},
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase2 refresh progress write_failed "
                "pre_mv_job_id=%s",
                pre_mv_job_id,
            )
        return

    # 모든 씬이 종착 상태 (completed | failed) — 최종 status 결정.
    if failed == 0:
        next_status = "phase2_ready"
    else:
        next_status = "phase2_partial"
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": next_status,
                    "progress": progress,
                    "updated_at": now,
                    "phase_progress.phase2.finished_at": now,
                    "phase_progress.phase2.completed": completed,
                    "phase_progress.phase2.failed": failed,
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase2 refresh status=%s pre_mv_job_id=%s "
            "completed=%d failed=%d total=%d progress=%d",
            next_status, pre_mv_job_id, completed, failed, total, progress,
        )
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase2 refresh status write_failed pre_mv_job_id=%s",
            pre_mv_job_id,
        )


async def _run_single_scene_image(
    *,
    pre_mv_job_id: str,
    scene_index: int,        # 0-based
    image_model: str,
    owner_user_id: str,
    semaphore: Optional[asyncio.Semaphore] = None,
) -> None:
    """Generate one scene image. Updates scenes[scene_index] in-place via Mongo.

    Failure isolation — 이 씬에서 except 가 나도 다른 씬은 영향 없음.
    호출 후 _refresh_phase2_status 는 호출자가 책임 (배치 끝에서 한 번만).
    """
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error(
            "[PreMVRoute] phase=phase2 scene_bg invalid id pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return

    scene_number = scene_index + 1

    async def _do() -> None:
        # 1) doc + scene reload (혹시 PATCH 가 도중에 들어왔어도 최신 상태 사용)
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase2 scene_bg doc missing pre_mv_job_id=%s "
                "scene_number=%d",
                pre_mv_job_id, scene_number,
            )
            return
        scenes = doc.get("scenes") or []
        if scene_index < 0 or scene_index >= len(scenes):
            logger.warning(
                "[PreMVRoute] phase=phase2 scene_bg out of range pre_mv_job_id=%s "
                "scene_number=%d scenes=%d",
                pre_mv_job_id, scene_number, len(scenes),
            )
            return
        scene = dict(scenes[scene_index] or {})

        # 2) generating 마크
        now = datetime.now(timezone.utc)
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "scenes.{}.image_status".format(scene_index): "generating",
                        "scenes.{}.image_error".format(scene_index): None,
                        "scenes.{}.image_started_at".format(scene_index): now,
                        "updated_at": now,
                    }
                },
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase2 scene_bg generating-mark failed "
                "pre_mv_job_id=%s scene_number=%d",
                pre_mv_job_id, scene_number,
            )

        # 3) 실제 생성
        try:
            image_bytes = await generate_scene_image(
                pre_mv_job_id=pre_mv_job_id,
                scene_number=scene_number,
                image_model=image_model,
                scene=scene,
                owner_user_id=owner_user_id,
            )
            if not image_bytes:
                raise ValueError("generator returned empty bytes")
        except Exception as e:  # noqa: BLE001
            err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
            logger.exception(
                "[PreMVRoute] phase=phase2 scene_bg generator failed "
                "pre_mv_job_id=%s scene_number=%d image_model=%s err=%s",
                pre_mv_job_id, scene_number, image_model, err_text,
            )
            finish_now = datetime.now(timezone.utc)
            try:
                await mongo.pre_mv_jobs.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "scenes.{}.image_status".format(scene_index): "failed",
                            "scenes.{}.image_error".format(scene_index): err_text,
                            "scenes.{}.image_finished_at".format(scene_index): finish_now,
                            "updated_at": finish_now,
                        }
                    },
                )
            except Exception:
                logger.exception(
                    "[PreMVRoute] phase=phase2 scene_bg failed-mark write failed "
                    "pre_mv_job_id=%s scene_number=%d",
                    pre_mv_job_id, scene_number,
                )
            return

        # 4) MinIO 업로드
        try:
            object_name = await _put_scene_image_to_minio(
                pre_mv_job_id=pre_mv_job_id,
                scene_number=scene_number,
                image_bytes=image_bytes,
            )
        except Exception as e:  # noqa: BLE001
            err_text = "minio_put_failed: {}: {}".format(
                type(e).__name__, str(e)[:200],
            )
            logger.exception(
                "[PreMVRoute] phase=phase2 scene_bg minio put failed "
                "pre_mv_job_id=%s scene_number=%d err=%s",
                pre_mv_job_id, scene_number, err_text,
            )
            finish_now = datetime.now(timezone.utc)
            try:
                await mongo.pre_mv_jobs.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "scenes.{}.image_status".format(scene_index): "failed",
                            "scenes.{}.image_error".format(scene_index): err_text,
                            "scenes.{}.image_finished_at".format(scene_index): finish_now,
                            "updated_at": finish_now,
                        }
                    },
                )
            except Exception:
                logger.exception(
                    "[PreMVRoute] phase=phase2 scene_bg failed-mark (minio) write_failed "
                    "pre_mv_job_id=%s scene_number=%d",
                    pre_mv_job_id, scene_number,
                )
            return

        # 5) 성공 마크
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "scenes.{}.image_status".format(scene_index): "completed",
                        "scenes.{}.image_object_name".format(scene_index): object_name,
                        "scenes.{}.image_source".format(scene_index): image_model,
                        "scenes.{}.image_generated_at".format(scene_index): finish_now,
                        "scenes.{}.image_finished_at".format(scene_index): finish_now,
                        "scenes.{}.image_error".format(scene_index): None,
                        "updated_at": finish_now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase2 scene_bg ok pre_mv_job_id=%s "
                "scene_number=%d image_model=%s object=%s bytes=%d",
                pre_mv_job_id, scene_number, image_model,
                object_name, len(image_bytes),
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase2 scene_bg success-mark write_failed "
                "pre_mv_job_id=%s scene_number=%d",
                pre_mv_job_id, scene_number,
            )

    if semaphore is None:
        await _do()
    else:
        async with semaphore:
            await _do()


async def _run_phase2(
    *,
    pre_mv_job_id: str,
    image_model: str,
    owner_user_id: str,
    force: bool,
) -> None:
    """Driver — phase2 백그라운드 오케스트레이션.

    · force=False → image_status != completed 인 씬만 (재)생성.
    · force=True  → 모든 씬 재생성 (기존 image_object_name 는 새 PNG 로 덮어쓴다).
    """
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error(
            "[PreMVRoute] phase=phase2 bg invalid id pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return

    logger.info(
        "[PreMVRoute] phase=phase2 bg entry pre_mv_job_id=%s image_model=%s force=%s",
        pre_mv_job_id, image_model, force,
    )

    try:
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase2 bg doc missing pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return
        scenes = doc.get("scenes") or []
        if not scenes:
            raise ValueError("scenes 가 비어있습니다 — Phase 1 먼저 실행이 필요합니다.")

        # 대상 씬 선정 + pending 마크
        target_indices: list[int] = []
        now = datetime.now(timezone.utc)
        for i, s in enumerate(scenes):
            status = (s or {}).get("image_status") or "pending"
            if force or status != "completed":
                target_indices.append(i)

        if not target_indices:
            # 다 끝나 있는데 force 가 아니면 그대로 phase2_ready 로 승격.
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase2_ready",
                        "progress": 100,
                        "phase2_error": None,
                        "updated_at": now,
                        "phase_progress.phase2.finished_at": now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase2 bg no-op (all done) pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return

        # 대상 씬을 pending 으로 표시 (force 인 경우 completed → pending 으로 강등)
        pending_set: dict[str, Any] = {}
        for i in target_indices:
            pending_set["scenes.{}.image_status".format(i)] = "pending"
            pending_set["scenes.{}.image_error".format(i)] = None
            if force:
                pending_set["scenes.{}.image_object_name".format(i)] = None
        pending_set["updated_at"] = now
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": pending_set})

        semaphore = asyncio.Semaphore(_PHASE2_MAX_CONCURRENT)
        tasks = [
            asyncio.create_task(
                _run_single_scene_image(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_index=i,
                    image_model=image_model,
                    owner_user_id=owner_user_id,
                    semaphore=semaphore,
                )
            )
            for i in target_indices
        ]
        # 진행도 갱신은 각 씬 완료 후 batch 한 번만(부하 줄임). 폴링은 5초이므로 충분.
        # 단, 너무 오래 걸릴 때 중간 진행도도 보고 싶어 task 그룹 끝까지 await.
        await asyncio.gather(*tasks, return_exceptions=True)

        # 잡 단위 status 갱신
        await _refresh_phase2_status(pre_mv_job_id)
        logger.info(
            "[PreMVRoute] phase=phase2 bg ok pre_mv_job_id=%s image_model=%s "
            "queued_scenes=%d",
            pre_mv_job_id, image_model, len(target_indices),
        )
    except Exception as e:  # noqa: BLE001
        now = datetime.now(timezone.utc)
        err_msg = str(e)[:500]
        logger.exception(
            "[PreMVRoute] phase=phase2 bg failed pre_mv_job_id=%s err=%s: %s",
            pre_mv_job_id, type(e).__name__, err_msg,
        )
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase2_failed",
                        "phase2_error": err_msg,
                        "updated_at": now,
                        "phase_progress.phase2.error": err_msg,
                    }
                },
            )
        except Exception as e2:  # noqa: BLE001
            logger.exception(
                "[PreMVRoute] phase=phase2 bg failure update_failed pre_mv_job_id=%s: %s: %s",
                pre_mv_job_id, type(e2).__name__, str(e2)[:200],
            )


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/phase2
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/phase2")
async def start_phase2(
    pre_mv_job_id: str,
    body: StartPhase2Body,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase2 entry user_id=%s is_admin=%s pre_mv_job_id=%s "
        "image_model=%s force=%s",
        user_id, is_admin, pre_mv_job_id, body.image_model, body.force,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, mv_doc, owner_user_id, _ = resolved

    cur_status = pre_doc.get("status") or "draft"
    # phase2 진입 가능한 상태들. phase2_ready 는 force=True 일 때만 허용(아래에서 검증).
    allowed = {
        "phase1_ready",
        "phase2_failed",
        "phase2_partial",
        "phase2_ready",
    }
    if cur_status not in allowed:
        logger.warning(
            "[PreMVRoute] phase=phase2 status reject pre_mv_job_id=%s status=%s",
            pre_mv_job_id, cur_status,
        )
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 Phase 2 를 시작할 수 없어요.".format(cur_status)},
        )

    # phase2_ready 에서는 force 가 명시되어야 재실행 허용.
    if cur_status == "phase2_ready" and not body.force:
        logger.warning(
            "[PreMVRoute] phase=phase2 ready_no_force pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "이미 모든 씬 이미지가 완료된 잡입니다. "
                         "전체 재생성을 원하면 force=true 로 다시 호출해주세요.",
            },
        )

    scenes = pre_doc.get("scenes") or []
    if not scenes:
        return JSONResponse(
            status_code=422,
            content={"error": "Phase 1 결과(scenes)가 비어있습니다."},
        )

    # 키 게이팅
    gate = await _gate_image_model_key(body.image_model)
    if gate is not None:
        return gate

    # 잡 단위 image_model lock 정책 (PLAN.md 테스트 #19):
    # 한 번 phase2 시작한 뒤 모델을 바꾸려면 — image_model 이 이미 잡에 박혀있고
    # 새 호출이 다른 모델이면 422 (UI 가 안내 모달로 막을 것). force 여도 모델은 같아야 한다.
    existing_model = pre_doc.get("image_model")
    if existing_model and existing_model != body.image_model:
        logger.warning(
            "[PreMVRoute] phase=phase2 model_lock_violation pre_mv_job_id=%s "
            "existing=%s requested=%s",
            pre_mv_job_id, existing_model, body.image_model,
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "이미 다른 이미지 모델({})로 시작된 잡입니다. "
                         "기존 잡을 사용하거나 새 잡을 만들어 주세요.".format(existing_model),
            },
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)

    update_set: dict[str, Any] = {
        "status": "phase2_images",
        "progress": 0,
        "image_model": body.image_model,
        "phase2_error": None,
        "updated_at": now,
        "phase_progress.phase2.started_at": now,
        "phase_progress.phase2.model": body.image_model,
        "phase_progress.phase2.force": body.force,
        "phase_progress.phase2.error": None,
    }
    try:
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": update_set})
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PreMVRoute] phase=phase2 update failed pre_mv_job_id=%s: %s: %s",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Phase 2 시작에 실패했습니다."},
        )

    # 큐잉할 씬 번호 미리 계산해 응답에 반환(프론트가 즉시 카드 마킹).
    queued_scene_numbers = [
        i + 1 for i, s in enumerate(scenes)
        if body.force or (s or {}).get("image_status") != "completed"
    ]

    asyncio.create_task(
        _run_phase2(
            pre_mv_job_id=pre_mv_job_id,
            image_model=body.image_model,
            owner_user_id=owner_user_id,
            force=body.force,
        )
    )

    logger.info(
        "[PreMVRoute] phase=phase2 queued user_id=%s pre_mv_job_id=%s "
        "image_model=%s queued=%d total=%d",
        user_id, pre_mv_job_id, body.image_model,
        len(queued_scene_numbers), len(scenes),
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "status": "phase2_images",
        "image_model": body.image_model,
        "queued_scene_numbers": queued_scene_numbers,
    }


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/scenes/{n}/regenerate-image  (v17.2)
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/scenes/{scene_number}/regenerate-image")
async def regenerate_scene_image(
    pre_mv_job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase2 action=regenerate_image entry "
        "user_id=%s is_admin=%s pre_mv_job_id=%s scene_number=%d",
        user_id, is_admin, pre_mv_job_id, scene_number,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, owner_user_id, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if scene_number < 1 or scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )

    image_model = pre_doc.get("image_model")
    if not image_model:
        return JSONResponse(
            status_code=409,
            content={"error": "이 잡의 image_model 이 아직 결정되지 않았어요. 먼저 Phase 2 를 시작해주세요."},
        )

    # 상태 가드 — phase2_failed / partial / ready / images 에서 단일 재생성 허용.
    cur_status = pre_doc.get("status") or ""
    allowed = {
        "phase2_images",
        "phase2_failed",
        "phase2_partial",
        "phase2_ready",
    }
    if cur_status not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 씬 이미지를 재생성할 수 없어요.".format(cur_status)},
        )

    # 키 게이팅
    gate = await _gate_image_model_key(image_model)
    if gate is not None:
        return gate

    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    scene_index = scene_number - 1
    now = datetime.now(timezone.utc)

    # pending 마크 + 잡 status 를 phase2_images 로 임시 승격(전 씬 결과 보존).
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase2_images",
                    "scenes.{}.image_status".format(scene_index): "pending",
                    "scenes.{}.image_error".format(scene_index): None,
                    "updated_at": now,
                }
            },
        )
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase2 regenerate pending-mark failed "
            "pre_mv_job_id=%s scene_number=%d",
            pre_mv_job_id, scene_number,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 재생성 시작에 실패했습니다."},
        )

    async def _single_then_refresh() -> None:
        await _run_single_scene_image(
            pre_mv_job_id=pre_mv_job_id,
            scene_index=scene_index,
            image_model=image_model,
            owner_user_id=owner_user_id,
            semaphore=None,
        )
        await _refresh_phase2_status(pre_mv_job_id)

    asyncio.create_task(_single_then_refresh())

    logger.info(
        "[PreMVRoute] phase=phase2 regenerate queued user_id=%s pre_mv_job_id=%s "
        "scene_number=%d image_model=%s",
        user_id, pre_mv_job_id, scene_number, image_model,
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "scene_number": scene_number,
        "image_status": "generating",
        "image_model": image_model,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs/{id}/scenes/{n}/image  (v17.2)
#
# Bearer 헤더 OR ?token= 쿼리 인증(get_current_user 동작). <img src> 호환.
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs/{pre_mv_job_id}/scenes/{scene_number}/image")
async def get_scene_image(
    pre_mv_job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if scene_number < 1 or scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )
    scene = scenes[scene_number - 1] or {}
    object_name = scene.get("image_object_name") or ""
    if not object_name:
        return JSONResponse(
            status_code=404,
            content={"error": "이 씬의 이미지가 아직 준비되지 않았습니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVRoute] phase=phase2 image fetch failed user_id=%s "
            "pre_mv_job_id=%s scene_number=%d object=%s: %s: %s",
            user_id, pre_mv_job_id, scene_number, object_name,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )

    media_type = mimetypes.guess_type(object_name)[0] or "image/png"
    logger.info(
        "[PreMVRoute] phase=phase2 image ok user_id=%s pre_mv_job_id=%s "
        "scene_number=%d bytes=%d",
        user_id, pre_mv_job_id, scene_number, len(data or b""),
    )
    return Response(content=data, media_type=media_type)


# ──────────────────────────────────────────────────────────────────────────
# PATCH /jobs/{id}/scenes/{n}
# ──────────────────────────────────────────────────────────────────────────

@router.patch("/jobs/{pre_mv_job_id}/scenes/{scene_number}")
async def patch_scene(
    pre_mv_job_id: str,
    scene_number: int,
    body: PatchSceneBody,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if scene_number < 1 or scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )

    idx = scene_number - 1
    target = dict(scenes[idx] or {})

    updated_fields: list[str] = []
    image_prompt_changed = False
    video_prompt_changed = False

    field_dump = body.model_dump(exclude_unset=True)
    for key, val in field_dump.items():
        if val is None:
            continue
        prev = target.get(key)
        if (prev or "") == val:
            continue
        target[key] = val
        updated_fields.append(key)
        if key in ("image_prompt", "image_prompt_ko"):
            image_prompt_changed = True
        if key in ("video_prompt", "video_prompt_ko"):
            video_prompt_changed = True

    if not updated_fields:
        return {
            "scene_number": scene_number,
            "updated_fields": [],
            "scene": target,
        }

    # user_edited_fields 누적 (중복 제거)
    prev_edits = set(target.get("user_edited_fields") or [])
    for f in updated_fields:
        prev_edits.add(f)
    target["user_edited_fields"] = sorted(prev_edits)

    # Invalidate logic (PLAN.md v17.1 표 #10):
    #   image_prompt 변경 → image_status=pending + video_status=pending
    #   video_prompt 만 변경 → video_status=pending
    if image_prompt_changed:
        target["image_status"] = "pending"
        target["image_object_name"] = None
        target["image_error"] = None
        target["video_status"] = "pending"
        target["video_object_name"] = None
        target["video_error"] = None
    elif video_prompt_changed:
        target["video_status"] = "pending"
        target["video_object_name"] = None
        target["video_error"] = None

    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    now = datetime.now(timezone.utc)
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    f"scenes.{idx}": target,
                    "updated_at": now,
                }
            },
        )
    except Exception as e:
        logger.exception(
            "[PreMVRoute] action=patch_scene update failed pre_mv_job_id=%s scene=%d: %s: %s",
            pre_mv_job_id, scene_number, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 편집 저장에 실패했습니다."},
        )

    logger.info(
        "[PreMVRoute] action=patch_scene ok user_id=%s is_admin=%s pre_mv_job_id=%s "
        "scene=%d fields=%s",
        user_id, is_admin, pre_mv_job_id, scene_number, ",".join(updated_fields),
    )
    return {
        "scene_number": scene_number,
        "updated_fields": updated_fields,
        "scene": target,
    }


# ──────────────────────────────────────────────────────────────────────────
# v17.3 — Phase 3 (씬 영상, 4개 모델) + Phase 4 (concat + audio merge)
# ──────────────────────────────────────────────────────────────────────────

_PHASE3_MAX_CONCURRENT = 2
_PHASE3_RUNNING_STATUSES = {"phase3_videos"}
_PHASE4_RUNNING_STATUSES = {"phase4_compositing"}

ALLOWED_VIDEO_MODELS = ("veo", "kling", "seedance", "grok")


async def _gate_video_model_key(video_model: str) -> Optional[JSONResponse]:
    """503 if the required API key for `video_model` is not configured."""
    if video_model == "veo" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Veo 영상 모델이 구성되어 있지 않습니다."},
        )
    if video_model == "kling" and (
        not settings.kling_access_key or not settings.kling_secret_key
    ):
        return JSONResponse(
            status_code=503,
            content={"error": "Kling 영상 모델이 구성되어 있지 않습니다."},
        )
    if video_model == "seedance" and not settings.fal_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Seedance 영상 모델이 구성되어 있지 않습니다."},
        )
    if video_model == "grok" and not settings.xai_api_key:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요.",
            },
        )
    return None


async def _put_scene_video_to_minio(
    *, pre_mv_job_id: str, scene_number: int, video_bytes: bytes,
) -> str:
    """Upload mp4 to MinIO videos bucket. Returns the object_name."""
    object_name = "pre_mv/{}/scenes/{:03d}.mp4".format(pre_mv_job_id, scene_number)
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_videos,
        object_name=object_name,
        data=io.BytesIO(video_bytes),
        length=len(video_bytes),
        content_type="video/mp4",
    )
    return object_name


async def _load_scene_image_bytes(object_name: Optional[str]) -> Optional[bytes]:
    """Phase 2 결과 PNG bytes — generator 들이 입력으로 받는다.

    실패해도 None 만 반환 (다른 씬에 영향 X).
    """
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        return data
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVRoute] phase=phase3 image fetch failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None


async def _load_char_sheet_bytes_for_scene(
    *, owner_user_id: str, scene: dict, max_refs: int = 2,
) -> list[bytes]:
    """씬의 ref_sheet_ids 가 가리키는 캐릭터 시트 bytes 들 (최대 2장).

    Kling 호출 시 prompt 의 <<<image_N>>> 참조에 쓰인다.
    실패한 slot 은 조용히 skip — 다른 씬 영향 X.
    """
    refs = list((scene or {}).get("ref_sheet_ids") or [])
    if not refs:
        return []
    mongo = get_mongo()
    try:
        cs_doc = await mongo.wedding_character_sheets.find_one(
            {"user_id": owner_user_id}
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVRoute] phase=phase3 sheet lookup failed user=%s: %s: %s",
            owner_user_id, type(e).__name__, str(e)[:200],
        )
        return []
    sheets = ((cs_doc or {}).get("sheets") or {})
    minio_client = get_minio()
    out: list[bytes] = []
    for slot in refs:
        sd = sheets.get(slot) or {}
        obj = sd.get("sheet_object_name") or ""
        if not obj:
            continue
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=obj,
            )
            data = resp.read()
            resp.close()
            resp.release_conn()
            if data:
                out.append(data)
                if len(out) >= max_refs:
                    break
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[PreMVRoute] phase=phase3 sheet bytes fetch failed slot=%s: %s: %s",
                slot, type(e).__name__, str(e)[:200],
            )
            continue
    return out


async def _refresh_phase3_status(pre_mv_job_id: str) -> None:
    """씬 video_status 들을 집계해 잡 단위 phase3 status 갱신.

    · 전 씬 video_status=completed → status = phase3_ready
    · 하나라도 failed + 진행 중 없음 → phase3_partial
    · 진행 중(generating/pending) 있음 → phase3_videos 유지(progress 만 업데이트)
    """
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        return
    doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
    if not doc:
        return
    scenes = doc.get("scenes") or []
    if not scenes:
        return
    total = len(scenes)
    completed = sum(1 for s in scenes if (s or {}).get("video_status") == "completed")
    failed = sum(1 for s in scenes if (s or {}).get("video_status") == "failed")
    running = sum(
        1 for s in scenes
        if (s or {}).get("video_status") in ("generating", "pending")
    )
    now = datetime.now(timezone.utc)
    progress = int(round((completed / total) * 100)) if total else 0

    if running > 0:
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {"$set": {"progress": progress, "updated_at": now}},
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase3 refresh progress write_failed "
                "pre_mv_job_id=%s",
                pre_mv_job_id,
            )
        return

    next_status = "phase3_ready" if failed == 0 else "phase3_partial"
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": next_status,
                    "progress": progress,
                    "updated_at": now,
                    "phase_progress.phase3.finished_at": now,
                    "phase_progress.phase3.completed": completed,
                    "phase_progress.phase3.failed": failed,
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase3 refresh status=%s pre_mv_job_id=%s "
            "completed=%d failed=%d total=%d progress=%d",
            next_status, pre_mv_job_id, completed, failed, total, progress,
        )
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase3 refresh status write_failed pre_mv_job_id=%s",
            pre_mv_job_id,
        )


async def _run_single_scene_video(
    *,
    pre_mv_job_id: str,
    scene_index: int,        # 0-based
    video_model: str,
    owner_user_id: str,
    semaphore: Optional[asyncio.Semaphore] = None,
) -> None:
    """씬 한 개의 영상 생성. 실패해도 isolation — 다른 씬 영향 없음."""
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error(
            "[PreMVRoute] phase=phase3 scene_bg invalid id pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return

    scene_number = scene_index + 1

    async def _do() -> None:
        # 1) doc + scene reload
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase3 scene_bg doc missing pre_mv_job_id=%s "
                "scene_number=%d",
                pre_mv_job_id, scene_number,
            )
            return
        scenes = doc.get("scenes") or []
        if scene_index < 0 or scene_index >= len(scenes):
            logger.warning(
                "[PreMVRoute] phase=phase3 scene_bg out of range pre_mv_job_id=%s "
                "scene_number=%d scenes=%d",
                pre_mv_job_id, scene_number, len(scenes),
            )
            return
        scene = dict(scenes[scene_index] or {})

        # 2) generating mark
        now = datetime.now(timezone.utc)
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "scenes.{}.video_status".format(scene_index): "generating",
                        "scenes.{}.video_error".format(scene_index): None,
                        "scenes.{}.video_started_at".format(scene_index): now,
                        "updated_at": now,
                    }
                },
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase3 scene_bg generating-mark failed "
                "pre_mv_job_id=%s scene_number=%d",
                pre_mv_job_id, scene_number,
            )

        # 3) inputs
        image_bytes = await _load_scene_image_bytes(scene.get("image_object_name"))
        if not image_bytes and video_model != "grok":
            # Grok 은 presigned URL 만 쓰므로 bytes 없어도 OK; 그 외 모델은 필수.
            err_text = "씬 이미지 다운로드 실패 — Phase 2 결과를 확인해 주세요."
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "scenes.{}.video_status".format(scene_index): "failed",
                        "scenes.{}.video_error".format(scene_index): err_text,
                        "scenes.{}.video_finished_at".format(scene_index): datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
            return

        # 4) 실제 호출 — 모델별 분기
        logger.info(
            "[PreMVRoute] phase=phase3 scene_bg dispatch pre_mv_job_id=%s "
            "scene_number=%d video_model=%s",
            pre_mv_job_id, scene_number, video_model,
        )
        try:
            if video_model == "veo":
                video_bytes = await generate_scene_video_veo(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                )
            elif video_model == "kling":
                char_refs = await _load_char_sheet_bytes_for_scene(
                    owner_user_id=owner_user_id, scene=scene, max_refs=2,
                )
                video_bytes = await generate_scene_video_kling(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                    char_ref_bytes_list=char_refs,
                )
            elif video_model == "seedance":
                video_bytes = await generate_scene_video_seedance(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                )
            elif video_model == "grok":
                video_bytes = await generate_scene_video_grok(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                )
            else:
                raise ValueError("unsupported video_model: {}".format(video_model))
            if not video_bytes:
                raise ValueError("generator returned empty bytes")
        except Exception as e:  # noqa: BLE001
            err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
            logger.exception(
                "[PreMVRoute] phase=phase3 scene_bg generator failed "
                "pre_mv_job_id=%s scene_number=%d video_model=%s err=%s",
                pre_mv_job_id, scene_number, video_model, err_text,
            )
            try:
                await mongo.pre_mv_jobs.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "scenes.{}.video_status".format(scene_index): "failed",
                            "scenes.{}.video_error".format(scene_index): err_text,
                            "scenes.{}.video_finished_at".format(scene_index): datetime.now(timezone.utc),
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
            except Exception:
                logger.exception(
                    "[PreMVRoute] phase=phase3 scene_bg failed-mark write_failed "
                    "pre_mv_job_id=%s scene_number=%d",
                    pre_mv_job_id, scene_number,
                )
            return

        # 5) MinIO 업로드
        try:
            object_name = await _put_scene_video_to_minio(
                pre_mv_job_id=pre_mv_job_id,
                scene_number=scene_number,
                video_bytes=video_bytes,
            )
        except Exception as e:  # noqa: BLE001
            err_text = "minio_put_failed: {}: {}".format(
                type(e).__name__, str(e)[:200],
            )
            logger.exception(
                "[PreMVRoute] phase=phase3 scene_bg minio put failed "
                "pre_mv_job_id=%s scene_number=%d err=%s",
                pre_mv_job_id, scene_number, err_text,
            )
            try:
                await mongo.pre_mv_jobs.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "scenes.{}.video_status".format(scene_index): "failed",
                            "scenes.{}.video_error".format(scene_index): err_text,
                            "scenes.{}.video_finished_at".format(scene_index): datetime.now(timezone.utc),
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
            except Exception:
                logger.exception(
                    "[PreMVRoute] phase=phase3 scene_bg failed-mark (minio) write_failed "
                    "pre_mv_job_id=%s scene_number=%d",
                    pre_mv_job_id, scene_number,
                )
            return

        # 6) success mark
        finish_now = datetime.now(timezone.utc)
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "scenes.{}.video_status".format(scene_index): "completed",
                        "scenes.{}.video_object_name".format(scene_index): object_name,
                        "scenes.{}.video_source".format(scene_index): video_model,
                        "scenes.{}.video_finished_at".format(scene_index): finish_now,
                        "scenes.{}.video_error".format(scene_index): None,
                        "updated_at": finish_now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase3 scene_bg ok pre_mv_job_id=%s "
                "scene_number=%d video_model=%s object=%s bytes=%d",
                pre_mv_job_id, scene_number, video_model, object_name,
                len(video_bytes),
            )
        except Exception:
            logger.exception(
                "[PreMVRoute] phase=phase3 scene_bg success-mark write_failed "
                "pre_mv_job_id=%s scene_number=%d",
                pre_mv_job_id, scene_number,
            )

    if semaphore is None:
        await _do()
    else:
        async with semaphore:
            await _do()


async def _run_phase3(
    *,
    pre_mv_job_id: str,
    video_model: str,
    owner_user_id: str,
    force: bool,
) -> None:
    """Phase 3 백그라운드 오케스트레이션."""
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error(
            "[PreMVRoute] phase=phase3 bg invalid id pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return

    logger.info(
        "[PreMVRoute] phase=phase3 bg entry pre_mv_job_id=%s video_model=%s force=%s",
        pre_mv_job_id, video_model, force,
    )
    try:
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase3 bg doc missing pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return
        scenes = doc.get("scenes") or []
        if not scenes:
            raise ValueError("scenes 가 비어있습니다 — Phase 1 먼저 실행이 필요합니다.")
        # 모든 씬 image_status=completed 보장
        non_ready = [
            (i + 1, (s or {}).get("image_status")) for i, s in enumerate(scenes)
            if (s or {}).get("image_status") != "completed"
        ]
        if non_ready:
            raise ValueError(
                "모든 씬의 이미지가 완료되지 않았습니다 (예: scene {} status={}).".format(
                    non_ready[0][0], non_ready[0][1] or "unknown",
                )
            )

        target_indices: list[int] = []
        now = datetime.now(timezone.utc)
        for i, s in enumerate(scenes):
            v_status = (s or {}).get("video_status") or "pending"
            if force or v_status != "completed":
                target_indices.append(i)

        if not target_indices:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase3_ready",
                        "progress": 100,
                        "phase3_error": None,
                        "updated_at": now,
                        "phase_progress.phase3.finished_at": now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase3 bg no-op (all done) pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return

        # 대상 씬을 pending 으로 표시 (force 면 completed → pending 강등 + object_name 무효화)
        pending_set: dict[str, Any] = {}
        for i in target_indices:
            pending_set["scenes.{}.video_status".format(i)] = "pending"
            pending_set["scenes.{}.video_error".format(i)] = None
            if force:
                pending_set["scenes.{}.video_object_name".format(i)] = None
        pending_set["updated_at"] = now
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": pending_set})

        semaphore = asyncio.Semaphore(_PHASE3_MAX_CONCURRENT)
        tasks = [
            asyncio.create_task(
                _run_single_scene_video(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_index=i,
                    video_model=video_model,
                    owner_user_id=owner_user_id,
                    semaphore=semaphore,
                )
            )
            for i in target_indices
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        await _refresh_phase3_status(pre_mv_job_id)
        logger.info(
            "[PreMVRoute] phase=phase3 bg ok pre_mv_job_id=%s video_model=%s "
            "queued_scenes=%d",
            pre_mv_job_id, video_model, len(target_indices),
        )
    except Exception as e:  # noqa: BLE001
        now = datetime.now(timezone.utc)
        err_msg = str(e)[:500]
        logger.exception(
            "[PreMVRoute] phase=phase3 bg failed pre_mv_job_id=%s err=%s: %s",
            pre_mv_job_id, type(e).__name__, err_msg,
        )
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase3_failed",
                        "phase3_error": err_msg,
                        "updated_at": now,
                        "phase_progress.phase3.error": err_msg,
                    }
                },
            )
        except Exception as e2:  # noqa: BLE001
            logger.exception(
                "[PreMVRoute] phase=phase3 bg failure update_failed pre_mv_job_id=%s: %s: %s",
                pre_mv_job_id, type(e2).__name__, str(e2)[:200],
            )


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/phase3
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/phase3")
async def start_phase3(
    pre_mv_job_id: str,
    body: StartPhase3Body,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase3 entry user_id=%s is_admin=%s pre_mv_job_id=%s "
        "video_model=%s force=%s",
        user_id, is_admin, pre_mv_job_id, body.video_model, body.force,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, owner_user_id, _ = resolved

    cur_status = pre_doc.get("status") or "draft"
    # Phase3 진입 가능한 상태들. phase3_ready 는 force=True 일 때만 허용.
    allowed = {
        "phase2_ready",
        "phase3_failed",
        "phase3_partial",
        "phase3_ready",
    }
    if cur_status not in allowed:
        logger.warning(
            "[PreMVRoute] phase=phase3 status reject pre_mv_job_id=%s status=%s",
            pre_mv_job_id, cur_status,
        )
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 Phase 3 를 시작할 수 없어요.".format(cur_status)},
        )
    if cur_status == "phase3_ready" and not body.force:
        return JSONResponse(
            status_code=422,
            content={
                "error": "이미 모든 씬 영상이 완료된 잡입니다. "
                         "전체 재생성을 원하면 force=true 로 다시 호출해주세요.",
            },
        )

    scenes = pre_doc.get("scenes") or []
    if not scenes:
        return JSONResponse(
            status_code=422,
            content={"error": "Phase 1 결과(scenes)가 비어있습니다."},
        )
    # 모든 씬 image_status=completed 사전 검증.
    not_ready = [
        (i + 1, (s or {}).get("image_status")) for i, s in enumerate(scenes)
        if (s or {}).get("image_status") != "completed"
    ]
    if not_ready:
        return JSONResponse(
            status_code=422,
            content={
                "error": "모든 씬의 이미지가 완료되어야 영상을 만들 수 있어요. "
                         "예: scene {} status={}.".format(
                             not_ready[0][0], not_ready[0][1] or "unknown",
                         ),
            },
        )

    # 키 게이팅
    gate = await _gate_video_model_key(body.video_model)
    if gate is not None:
        return gate

    # 잡 단위 video_model lock — image_model 과 동일 패턴.
    existing_model = pre_doc.get("video_model")
    if existing_model and existing_model != body.video_model:
        return JSONResponse(
            status_code=422,
            content={
                "error": "이미 다른 영상 모델({})로 시작된 잡입니다. "
                         "기존 잡을 사용하거나 새 잡을 만들어 주세요.".format(existing_model),
            },
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)

    update_set: dict[str, Any] = {
        "status": "phase3_videos",
        "progress": 0,
        "video_model": body.video_model,
        "phase3_error": None,
        "updated_at": now,
        "phase_progress.phase3.started_at": now,
        "phase_progress.phase3.model": body.video_model,
        "phase_progress.phase3.force": body.force,
        "phase_progress.phase3.error": None,
    }
    try:
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": update_set})
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PreMVRoute] phase=phase3 update failed pre_mv_job_id=%s: %s: %s",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Phase 3 시작에 실패했습니다."},
        )

    queued_scene_numbers = [
        i + 1 for i, s in enumerate(scenes)
        if body.force or (s or {}).get("video_status") != "completed"
    ]

    asyncio.create_task(
        _run_phase3(
            pre_mv_job_id=pre_mv_job_id,
            video_model=body.video_model,
            owner_user_id=owner_user_id,
            force=body.force,
        )
    )

    logger.info(
        "[PreMVRoute] phase=phase3 queued user_id=%s pre_mv_job_id=%s "
        "video_model=%s queued=%d total=%d",
        user_id, pre_mv_job_id, body.video_model,
        len(queued_scene_numbers), len(scenes),
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "status": "phase3_videos",
        "video_model": body.video_model,
        "queued_scene_numbers": queued_scene_numbers,
    }


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/scenes/{n}/regenerate-video
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/scenes/{scene_number}/regenerate-video")
async def regenerate_scene_video(
    pre_mv_job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase3 action=regenerate_video entry "
        "user_id=%s is_admin=%s pre_mv_job_id=%s scene_number=%d",
        user_id, is_admin, pre_mv_job_id, scene_number,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, owner_user_id, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if scene_number < 1 or scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )

    scene = scenes[scene_number - 1] or {}
    if (scene or {}).get("image_status") != "completed":
        return JSONResponse(
            status_code=422,
            content={"error": "이 씬의 이미지가 아직 완료되지 않았어요. 먼저 씬 이미지를 만들어 주세요."},
        )

    video_model = pre_doc.get("video_model")
    if not video_model:
        return JSONResponse(
            status_code=409,
            content={"error": "이 잡의 video_model 이 아직 결정되지 않았어요. 먼저 Phase 3 를 시작해주세요."},
        )

    cur_status = pre_doc.get("status") or ""
    allowed = {
        "phase3_videos",
        "phase3_failed",
        "phase3_partial",
        "phase3_ready",
    }
    if cur_status not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 씬 영상을 재생성할 수 없어요.".format(cur_status)},
        )

    gate = await _gate_video_model_key(video_model)
    if gate is not None:
        return gate

    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    scene_index = scene_number - 1
    now = datetime.now(timezone.utc)
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase3_videos",
                    "scenes.{}.video_status".format(scene_index): "pending",
                    "scenes.{}.video_error".format(scene_index): None,
                    "updated_at": now,
                }
            },
        )
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase3 regenerate pending-mark failed "
            "pre_mv_job_id=%s scene_number=%d",
            pre_mv_job_id, scene_number,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "씬 영상 재생성 시작에 실패했습니다."},
        )

    async def _single_then_refresh() -> None:
        await _run_single_scene_video(
            pre_mv_job_id=pre_mv_job_id,
            scene_index=scene_index,
            video_model=video_model,
            owner_user_id=owner_user_id,
            semaphore=None,
        )
        await _refresh_phase3_status(pre_mv_job_id)

    asyncio.create_task(_single_then_refresh())
    logger.info(
        "[PreMVRoute] phase=phase3 regenerate queued user_id=%s pre_mv_job_id=%s "
        "scene_number=%d video_model=%s",
        user_id, pre_mv_job_id, scene_number, video_model,
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "scene_number": scene_number,
        "video_status": "generating",
        "video_model": video_model,
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs/{id}/scenes/{n}/video  (Bearer OR ?token=)
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs/{pre_mv_job_id}/scenes/{scene_number}/video")
async def get_scene_video(
    pre_mv_job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if scene_number < 1 or scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )
    scene = scenes[scene_number - 1] or {}
    object_name = scene.get("video_object_name") or ""
    if not object_name:
        return JSONResponse(
            status_code=404,
            content={"error": "이 씬의 영상이 아직 준비되지 않았습니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=object_name,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVRoute] phase=phase3 video fetch failed user_id=%s "
            "pre_mv_job_id=%s scene_number=%d object=%s: %s: %s",
            user_id, pre_mv_job_id, scene_number, object_name,
            type(e).__name__, str(e)[:200],
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
        "[PreMVRoute] phase=phase3 video stream user_id=%s pre_mv_job_id=%s "
        "scene_number=%d object=%s",
        user_id, pre_mv_job_id, scene_number, object_name,
    )
    return StreamingResponse(_stream(), media_type="video/mp4")


# ──────────────────────────────────────────────────────────────────────────
# Phase 4 — concat + audio merge
# ──────────────────────────────────────────────────────────────────────────

async def _run_phase4(pre_mv_job_id: str) -> None:
    """Phase 4 백그라운드 — concat + audio merge → MinIO upload → status=completed."""
    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    if oid is None:
        logger.error(
            "[PreMVRoute] phase=phase4 bg invalid id pre_mv_job_id=%s",
            pre_mv_job_id,
        )
        return

    logger.info("[PreMVRoute] phase=phase4 bg entry pre_mv_job_id=%s", pre_mv_job_id)
    try:
        doc = await mongo.pre_mv_jobs.find_one({"_id": oid})
        if not doc:
            logger.warning(
                "[PreMVRoute] phase=phase4 bg doc missing pre_mv_job_id=%s",
                pre_mv_job_id,
            )
            return

        scenes = doc.get("scenes") or []
        # v19 — audio_variant 에 따라 mv_jobs.audio_variants[idx] 우선, 없으면 fallback.
        audio_variant = int(doc.get("audio_variant") or 1)
        audio_object_name = doc.get("audio_object_name")
        mv_job_id_local = doc.get("mv_job_id")
        if mv_job_id_local:
            mv_oid_local = _to_oid(mv_job_id_local)
            if mv_oid_local is not None:
                try:
                    mv_doc_local = await mongo.mv_jobs.find_one({"_id": mv_oid_local})
                    if mv_doc_local:
                        variants_local = mv_doc_local.get("audio_variants") or []
                        if 1 <= audio_variant <= len(variants_local) and variants_local[audio_variant - 1]:
                            audio_object_name = variants_local[audio_variant - 1]
                        elif not audio_object_name:
                            audio_object_name = mv_doc_local.get("audio_object_name")
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[PreMVRoute] phase=phase4 mv_audio lookup failed "
                        "pre_mv_job_id=%s mv_job_id=%s audio_variant=%d: %s: %s",
                        pre_mv_job_id, mv_job_id_local, audio_variant,
                        type(e).__name__, str(e)[:200],
                    )
        logger.info(
            "[PreMVRoute] phase=phase4 audio_resolve pre_mv_job_id=%s audio_variant=%d "
            "audio_object_name=%s",
            pre_mv_job_id, audio_variant, audio_object_name,
        )

        result = await compose_pre_mv_result(
            pre_mv_job_id=pre_mv_job_id,
            scenes=scenes,
            audio_object_name=audio_object_name,
        )

        now = datetime.now(timezone.utc)
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "completed",
                    "progress": 100,
                    "result_video_object_name": result["result_object_name"],
                    "result_video_generated_at": now,
                    "phase4_error": None,
                    "updated_at": now,
                    "phase_progress.phase4.finished_at": now,
                    "phase_progress.phase4.concat_mode": result["concat_mode"],
                    "phase_progress.phase4.scene_count": result["scene_count"],
                    "phase_progress.phase4.size_bytes": result["size_bytes"],
                    "phase_progress.phase4.had_audio": result["had_audio"],
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase4 bg ok pre_mv_job_id=%s scenes=%d concat=%s "
            "size_bytes=%d had_audio=%s",
            pre_mv_job_id, result["scene_count"], result["concat_mode"],
            result["size_bytes"], result["had_audio"],
        )
    except Exception as e:  # noqa: BLE001
        now = datetime.now(timezone.utc)
        err_msg = str(e)[:500]
        logger.exception(
            "[PreMVRoute] phase=phase4 bg failed pre_mv_job_id=%s err=%s: %s",
            pre_mv_job_id, type(e).__name__, err_msg,
        )
        try:
            await mongo.pre_mv_jobs.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "status": "phase4_failed",
                        "phase4_error": err_msg,
                        "updated_at": now,
                        "phase_progress.phase4.error": err_msg,
                    }
                },
            )
        except Exception as e2:  # noqa: BLE001
            logger.exception(
                "[PreMVRoute] phase=phase4 bg failure update_failed pre_mv_job_id=%s: %s: %s",
                pre_mv_job_id, type(e2).__name__, str(e2)[:200],
            )


@router.post("/jobs/{pre_mv_job_id}/phase4")
async def start_phase4(
    pre_mv_job_id: str,
    body: StartPhase4Body,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase4 entry user_id=%s is_admin=%s pre_mv_job_id=%s force=%s",
        user_id, is_admin, pre_mv_job_id, body.force,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    if not ffmpeg_available():
        return JSONResponse(
            status_code=503,
            content={"error": "ffmpeg 가 설치되어 있지 않아 영상을 합칠 수 없어요. 운영자에게 문의해 주세요."},
        )

    cur_status = pre_doc.get("status") or "draft"
    allowed = {
        "phase3_ready",
        "phase4_failed",
        "completed",
    }
    if cur_status not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 Phase 4 를 시작할 수 없어요.".format(cur_status)},
        )
    if cur_status == "completed" and not body.force:
        return JSONResponse(
            status_code=422,
            content={"error": "이미 식전영상이 완성되었어요. 다시 만들고 싶으면 force=true 로 호출해주세요."},
        )

    scenes = pre_doc.get("scenes") or []
    completed_scenes = [s for s in scenes if (s or {}).get("video_status") == "completed"]
    if not completed_scenes:
        return JSONResponse(
            status_code=422,
            content={"error": "합칠 완료된 씬 영상이 없어요. 먼저 Phase 3 를 완료해주세요."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)
    try:
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase4_compositing",
                    "progress": 0,
                    "phase4_error": None,
                    "updated_at": now,
                    "phase_progress.phase4.started_at": now,
                    "phase_progress.phase4.force": body.force,
                    "phase_progress.phase4.error": None,
                }
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[PreMVRoute] phase=phase4 update failed pre_mv_job_id=%s: %s: %s",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=500,
            content={"error": "Phase 4 시작에 실패했습니다."},
        )

    asyncio.create_task(_run_phase4(pre_mv_job_id))

    logger.info(
        "[PreMVRoute] phase=phase4 queued user_id=%s pre_mv_job_id=%s scenes=%d",
        user_id, pre_mv_job_id, len(completed_scenes),
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "status": "phase4_compositing",
        "scene_count": len(completed_scenes),
    }


# ──────────────────────────────────────────────────────────────────────────
# GET /jobs/{id}/result  (최종 식전영상 스트리밍)
# ──────────────────────────────────────────────────────────────────────────

@router.get("/jobs/{pre_mv_job_id}/result")
async def get_pre_mv_result(
    pre_mv_job_id: str,
    current_user=Depends(get_current_user),
):
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    object_name = pre_doc.get("result_video_object_name") or ""
    if not object_name:
        return JSONResponse(
            status_code=404,
            content={"error": "아직 결과 영상이 준비되지 않았습니다."},
        )

    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=object_name,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[PreMVRoute] phase=phase4 result fetch failed user_id=%s pre_mv_job_id=%s "
            "object=%s: %s: %s",
            user_id, pre_mv_job_id, object_name,
            type(e).__name__, str(e)[:200],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "결과 영상을 찾을 수 없습니다."},
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
        "[PreMVRoute] phase=phase4 result stream user_id=%s pre_mv_job_id=%s object=%s",
        user_id, pre_mv_job_id, object_name,
    )
    return StreamingResponse(_stream(), media_type="video/mp4")
