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
import zipfile
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
from ..services.pre_mv_phase0_mapper import generate_scenario
from ..services.pre_mv_phase1_splitter import split_into_scenes_v212
from ..services.pre_mv_phase2_image_generator import (
    ALLOWED_IMAGE_MODELS,
    generate_scene_image,
)
from ..services.pre_mv_phase4_compositor import (
    compose_pre_mv_result,
    ffmpeg_available,
)
from ..services.pre_mv_scene_mirror import (
    ENGLISH_TO_KO_FIELD,
    sync_scene_mirrors,
)
from ..services.extra_video_frame import extract_scene_last_frame_png
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
        # v21.2 — Phase 1 균등 분배 클립 수. 기존 잡은 None 가능 (default 3 처리).
        # v21.4 — DEPRECATED. 새 잡은 LLM 자율 결정으로 미사용. 호환 위해 키만 노출.
        "clips_per_event": int(doc.get("clips_per_event") or 3),
        # v21.4 — 음악 길이 × 2 / 실제 씬 use_seconds 합. Phase 1 완료 후에만 의미.
        "target_total_seconds": (
            float(doc["target_total_seconds"])
            if doc.get("target_total_seconds") is not None else None
        ),
        "actual_total_seconds": (
            float(doc["actual_total_seconds"])
            if doc.get("actual_total_seconds") is not None else None
        ),
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
        # v21 — scenario_text 본문은 light 응답에서 길이만 노출 (폴링 부하 최소화).
        base["scene_plan_count"] = len(doc.get("scene_plan") or [])
        base["scenes_count"] = len(doc.get("scenes") or [])
        base["scenario_text_len"] = len(doc.get("scenario_text") or "")
        base["scenario_events_count"] = len(doc.get("scenario_events") or [])
        base["section_markers_count"] = len(doc.get("section_markers") or [])
        return base
    # v21 — 시나리오 / 섹션 마커 노출. scene_plan 은 deprecated 이지만 기존 잡 호환 위해 유지.
    base["scenario_text"] = doc.get("scenario_text") or ""
    base["scenario_events"] = doc.get("scenario_events") or []
    base["section_markers"] = doc.get("section_markers") or []
    base["scene_plan"] = doc.get("scene_plan") or []  # deprecated; legacy 잡 호환
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
    # v21.2 — 각 event 마다 만들 클립 수. UI 라디오: 2/3/4 (기본 3).
    # v21.4 — DEPRECATED. LLM 자율 결정 정책으로 받아도 무시. backward compat 위해 Optional 유지.
    clips_per_event: Optional[Literal[2, 3, 4]] = None


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


class DownloadZipBody(BaseModel):
    """v24.2 — 일괄 ZIP 다운로드 body.

    scene_numbers=None/[] → 전체 완료된 씬. 명시되면 그 씬들만(완료 안 된 건 skip).
    """

    scene_numbers: Optional[list[int]] = Field(default=None, max_length=50)


class PatchSceneBody(BaseModel):
    description: Optional[str] = Field(default=None, max_length=2000)
    description_ko: Optional[str] = Field(default=None, max_length=2000)
    image_prompt: Optional[str] = Field(default=None, max_length=4000)
    image_prompt_ko: Optional[str] = Field(default=None, max_length=4000)
    video_prompt: Optional[str] = Field(default=None, max_length=4000)
    video_prompt_ko: Optional[str] = Field(default=None, max_length=4000)


class ChapterRegenerateImagesBody(BaseModel):
    """v35 — 챕터(연속 같은 story_slot) 단위 씬 이미지 재생성 body.

    scene_number = 그 챕터에 속하는 어떤 씬의 번호. 백엔드가 _group_scenes_into_chapters
    로 같은 챕터의 모든 씬을 찾아 직렬 재생성한다.
    """

    scene_number: int = Field(ge=1, le=200)


class ChapterRegenerateVideosBody(BaseModel):
    """v40 — 챕터 단위 씬 영상 재생성 body. ChapterRegenerateImagesBody 와 동일 구조.

    scene_number = 그 챕터의 어떤 씬 번호든 OK. 백엔드가 같은 챕터의 모든 씬을
    찾아 직렬 영상 재생성.
    """

    scene_number: int = Field(ge=1, le=200)


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

    # v21.2 — lyrics_body / aligned_words 는 Phase 1 입력 아님. 데이터 보존용으로만 저장.
    #         (v22 가사 timestamp 토글 UI / Phase 4 audio merge plumbing 미래 확장용.)
    lyrics_snapshot = mv_job.get("lyrics") or {}
    lyrics_body_snapshot = (lyrics_snapshot or {}).get("body") or ""
    aligned_words_variants = mv_job.get("suno_aligned_words_variants") or {}
    selected_aligned_words: list[dict] = []
    if isinstance(aligned_words_variants, dict):
        selected_aligned_words = aligned_words_variants.get(str(audio_variant)) or []

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
        "lyrics_snapshot": lyrics_snapshot,
        "lyric_timestamps": selected_ts,
        # v21.2 — Phase 1 입력 아님. 데이터 보존용 (v22 가사 토글 UI 등 미래 확장).
        "lyrics_body": lyrics_body_snapshot,
        "aligned_words": selected_aligned_words,
        "audio_variant": audio_variant,
        "audio_object_name": chosen_audio_object,
        # v21.2 — clips_per_event 균등 분배 정책. 기본값 3.
        "clips_per_event": 3,
        # v21 — Phase 0 신규 출력. (deprecated) scene_plan 도 빈 배열로 둠 (legacy 호환).
        "scenario_text": "",
        "scenario_events": [],
        "section_markers": [],
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
        "audio_variant=%d lyric_lines=%d clips_per_event=3",
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

        # v21 — story_snapshot 만으로 시나리오 본문 + 이벤트 생성. lyric_timestamps 미사용.
        result = await generate_scenario(
            pre_mv_job_id=pre_mv_job_id,
            story_snapshot=doc.get("story_snapshot") or {},
            scenario_model=scenario_model,
        )
        scenario_text = result.get("scenario_text") or ""
        scenario_events = result.get("scenario_events") or []

        now = datetime.now(timezone.utc)
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase0_ready",
                    "progress": 100,
                    "scenario_model": scenario_model,
                    "scenario_text": scenario_text,
                    "scenario_events": scenario_events,
                    # legacy scene_plan 은 v21 에서 폐기 — 빈 배열로 둠 (재실행 시 scenes 초기화는 핸들러에서).
                    "scene_plan": [],
                    "phase0_error": None,
                    "phase0_completed_at": now,
                    "updated_at": now,
                    "phase_progress.phase0.finished_at": now,
                    "phase_progress.phase0.model": scenario_model,
                }
            },
        )
        logger.info(
            "[PreMVRoute] phase=phase0 bg ok pre_mv_job_id=%s model=%s text_len=%d events_count=%d",
            pre_mv_job_id, scenario_model, len(scenario_text), len(scenario_events),
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
        # v21 — cascade reset: scenario_text/events 도 비우고 section_markers 도 리셋.
        update_set["scenes"] = []
        update_set["scenario_text"] = ""
        update_set["scenario_events"] = []
        update_set["section_markers"] = []

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

        # v21.4 — scenario_text / scenario_events + 음악 길이 (mv_job 에서 조회).
        # 음악 sync 의존 폐기 (v21.2). clips_per_event 입력 폐기 (v21.4 — LLM 자율 결정).
        scenario_text = (doc.get("scenario_text") or "").strip()
        scenario_events = doc.get("scenario_events") or []
        if not scenario_text or not scenario_events:
            raise ValueError(
                "scenario_text/events 가 비어있습니다 — Phase 0 먼저 실행이 필요합니다."
            )

        # v21.4 — 음악 길이 조회.
        # 우선순위: 1) mv_jobs.lyric_timestamps_variants[str(variant)] 마지막 end
        #          2) mv_jobs.lyric_timestamps 마지막 end
        #          3) 180.0 fallback.
        audio_variant = int(doc.get("audio_variant") or 1)
        mv_job_id = doc.get("mv_job_id")
        music_duration_sec = 0.0
        music_source = "fallback_180"
        if mv_job_id:
            mv_oid = _to_oid(mv_job_id)
            if mv_oid is not None:
                mv_doc = await mongo.mv_jobs.find_one({"_id": mv_oid})
                if mv_doc:
                    ts_variants = mv_doc.get("lyric_timestamps_variants") or {}
                    selected_ts = None
                    if isinstance(ts_variants, dict):
                        selected_ts = ts_variants.get(str(audio_variant))
                    if not selected_ts:
                        selected_ts = mv_doc.get("lyric_timestamps") or []
                    if isinstance(selected_ts, list) and selected_ts:
                        last = selected_ts[-1]
                        if isinstance(last, dict):
                            try:
                                end_val = float(last.get("end") or 0.0)
                                if end_val > 0:
                                    music_duration_sec = end_val
                                    music_source = (
                                        f"variant_{audio_variant}"
                                        if isinstance(ts_variants, dict)
                                        and ts_variants.get(str(audio_variant))
                                        else "lyric_timestamps_single"
                                    )
                            except (TypeError, ValueError):
                                pass
        if music_duration_sec <= 0:
            music_duration_sec = 180.0
            music_source = "fallback_180"

        logger.info(
            "[PreMVRoute] phase=phase1 bg call splitter pre_mv_job_id=%s "
            "events_count=%d music_duration_sec=%.2f music_source=%s audio_variant=%d",
            pre_mv_job_id, len(scenario_events),
            music_duration_sec, music_source, audio_variant,
        )

        result = await split_into_scenes_v212(
            pre_mv_job_id=pre_mv_job_id,
            scenario_text=scenario_text,
            scenario_events=scenario_events,
            music_duration_sec=music_duration_sec,
        )
        scenes = result.get("scenes") or []
        section_markers = result.get("section_markers") or []  # v21.2 — 항상 [].
        target_total_seconds = float(result.get("target_total_seconds") or 0.0)
        actual_total_seconds = float(result.get("actual_total_seconds") or 0.0)

        now = datetime.now(timezone.utc)
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": "phase1_ready",
                    "progress": 100,
                    "scenes": scenes,
                    "section_markers": section_markers,
                    "phase1_error": None,
                    "phase1_completed_at": now,
                    "updated_at": now,
                    "phase_progress.phase1.finished_at": now,
                    # v21.4 — 새 응답 키 영속화 (UI 표시용).
                    "target_total_seconds": target_total_seconds,
                    "actual_total_seconds": actual_total_seconds,
                    "music_duration_sec": float(music_duration_sec),
                }
            },
        )
        # 챕터별 씬 개수 (story_slot 연속) 로깅.
        chapter_counts: list[int] = []
        prev_slot: Optional[str] = None
        for sc in scenes:
            s = (sc or {}).get("story_slot")
            if s != prev_slot:
                chapter_counts.append(1)
                prev_slot = s
            else:
                chapter_counts[-1] += 1
        logger.info(
            "[PreMVRoute] phase=phase1 bg ok pre_mv_job_id=%s events_count=%d "
            "scenes_count=%d music_duration_sec=%.2f target_total_seconds=%.2f "
            "actual_total_seconds=%.2f total_ratio=%.2fx chapter_counts=%s",
            pre_mv_job_id, len(scenario_events), len(scenes),
            music_duration_sec, target_total_seconds, actual_total_seconds,
            (actual_total_seconds / music_duration_sec) if music_duration_sec > 0 else 0.0,
            chapter_counts,
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
    # v21.4 — clips_per_event 받아도 무시 (LLM 자율 결정). backward compat 로깅만.
    deprecated_clips_per_event = body.clips_per_event
    logger.info(
        "[PreMVRoute] phase=phase1 entry user_id=%s is_admin=%s pre_mv_job_id=%s "
        "force=%s deprecated_clips_per_event=%s",
        user_id, is_admin, pre_mv_job_id, body.force, deprecated_clips_per_event,
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

    # v21 — Phase 1 가드: scenario_text 가 비어있지 않은지 확인 (scene_plan 의존 제거).
    if not (pre_doc.get("scenario_text") or "").strip():
        return JSONResponse(
            status_code=422,
            content={"error": "Phase 0 결과(scenario_text)가 비어있습니다."},
        )
    if not pre_doc.get("scenario_events"):
        return JSONResponse(
            status_code=422,
            content={"error": "Phase 0 결과(scenario_events)가 비어있습니다."},
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    oid = _to_oid(pre_mv_job_id)
    try:
        # v21.4 — clips_per_event 더 이상 저장 안 함 (LLM 자율 결정). 기존 잡 호환은
        # _serialize_pre_mv_job 의 default(3) 처리로 유지.
        set_fields = {
            "status": "phase1_splitting",
            "progress": 0,
            "phase1_error": None,
            "updated_at": now,
            "phase_progress.phase1.started_at": now,
            "phase_progress.phase1.error": None,
            # v21.4 — 이전 결과의 target/actual 초기화 (재시작 시 깨끗한 상태).
            "target_total_seconds": None,
            "actual_total_seconds": None,
        }
        await mongo.pre_mv_jobs.update_one(
            {"_id": oid},
            {"$set": set_fields},
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


# v24 — 챕터 그룹핑 헬퍼.
# v36 — memory slot 은 memory_index 까지 묶음 키로. 다른 추억은 다른 챕터.
#       prev_scene chain 이 추억1 → 추억2 사이로 흐르지 않도록.
def _group_scenes_into_chapters(scenes: list[dict]) -> list[list[int]]:
    """scenes 의 0-based index 리스트를 챕터 단위로 그룹핑.

    챕터 키: (story_slot, memory_index if story_slot=='memory' else None).
    예: story_slot=[m,m(idx0),m(idx0),m(idx1),f,f] → [[0],[1,2],[3],[4,5]]
        (단, slot 자체가 비어있어도 동일 그룹).
    """
    if not scenes:
        return []

    def _chapter_key(s):
        slot = (s or {}).get("story_slot") or ""
        if slot == "memory":
            return (slot, (s or {}).get("memory_index"))
        return (slot, None)

    groups: list[list[int]] = []
    current: list[int] = []
    prev_key = None
    for i, s in enumerate(scenes):
        k = _chapter_key(s)
        if not current:
            current = [i]
            prev_key = k
            continue
        if k == prev_key:
            current.append(i)
        else:
            groups.append(current)
            current = [i]
            prev_key = k
    if current:
        groups.append(current)
    return groups


async def _load_photos_bytes(object_name: Optional[str]) -> Optional[bytes]:
    """photos 버킷 PNG → bytes. 실패해도 None."""
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
            "[PreMVPhase2Chain] photos fetch failed object=%s: %s: %s",
            object_name, type(e).__name__, str(e)[:200],
        )
        return None


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
    prev_scene_image_bytes: Optional[bytes] = None,
    chapter_seq: Optional[int] = None,
    scene_in_chapter: Optional[tuple[int, int]] = None,  # (n, total) within chapter
) -> None:
    """Generate one scene image. Updates scenes[scene_index] in-place via Mongo.

    Failure isolation — 이 씬에서 except 가 나도 다른 씬은 영향 없음.
    호출 후 _refresh_phase2_status 는 호출자가 책임 (배치 끝에서 한 번만).

    v24 — prev_scene_image_bytes 가 주어지면 챕터 안 연쇄 carry 의 이전 씬 PNG.
    generator 에 전달되며 `scenes[i].image_prev_scene_ref_used` 가 True 로 저장된다.
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
        if chapter_seq is not None and scene_in_chapter is not None:
            n_in, n_tot = scene_in_chapter
            logger.info(
                "[PreMVPhase2Chain] chapter_seq=%d scene_in_chapter=%d/%d "
                "scene_number=%d starting prev_carry=%s",
                chapter_seq, n_in, n_tot, scene_number,
                bool(prev_scene_image_bytes),
            )
        try:
            image_bytes = await generate_scene_image(
                pre_mv_job_id=pre_mv_job_id,
                scene_number=scene_number,
                image_model=image_model,
                scene=scene,
                owner_user_id=owner_user_id,
                prev_scene_image_bytes=prev_scene_image_bytes,
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
        prev_used = bool(prev_scene_image_bytes)
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
                        # v24 — 챕터 안 prev_scene carry 가 실제로 적용되었는지.
                        "scenes.{}.image_prev_scene_ref_used".format(scene_index): prev_used,
                        "updated_at": finish_now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase2 scene_bg ok pre_mv_job_id=%s "
                "scene_number=%d image_model=%s object=%s bytes=%d prev_used=%s",
                pre_mv_job_id, scene_number, image_model,
                object_name, len(image_bytes), prev_used,
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


async def _run_chapter_serial(
    *,
    pre_mv_job_id: str,
    image_model: str,
    owner_user_id: str,
    chapter_seq: int,
    chapter_indices: list[int],
    scenes: list[dict],
    target_set: set[int],
    mongo,
    oid,
) -> None:
    """v35 — 챕터 안 직렬 실행 (이전 씬 완료 후 다음 씬 시작). prev_scene carry.

    `_run_phase2` 와 `regenerate_chapter_images` endpoint 두 곳에서 공유.
    챕터 첫 씬: prev_scene_image_bytes=None.
    챕터 둘째 씬부터: 이전 씬의 image_object_name → MinIO fetch → bytes.
    이전 씬이 target_set 에 없으면(이미 완료된 씬) DB 의 기존 object_name 사용.
    """
    in_chapter_total = len(chapter_indices)
    prev_object_name: Optional[str] = None
    for pos, scene_idx in enumerate(chapter_indices):
        if scene_idx not in target_set:
            existing_obj = (scenes[scene_idx] or {}).get("image_object_name")
            if existing_obj:
                prev_object_name = existing_obj
            continue
        prev_bytes: Optional[bytes] = None
        if prev_object_name:
            prev_bytes = await _load_photos_bytes(prev_object_name)
            if not prev_bytes:
                logger.warning(
                    "[PreMVPhase2Chain] prev_scene fetch failed — fallback no_carry "
                    "pre_mv_job_id=%s chapter_seq=%d scene_index=%d prev_obj=%s",
                    pre_mv_job_id, chapter_seq, scene_idx, prev_object_name,
                )
        await _run_single_scene_image(
            pre_mv_job_id=pre_mv_job_id,
            scene_index=scene_idx,
            image_model=image_model,
            owner_user_id=owner_user_id,
            semaphore=None,
            prev_scene_image_bytes=prev_bytes,
            chapter_seq=chapter_seq,
            scene_in_chapter=(pos + 1, in_chapter_total),
        )
        refreshed = await mongo.pre_mv_jobs.find_one(
            {"_id": oid}, {"scenes": 1},
        )
        if refreshed:
            refreshed_scenes = refreshed.get("scenes") or []
            if scene_idx < len(refreshed_scenes):
                prev_object_name = (
                    (refreshed_scenes[scene_idx] or {}).get("image_object_name")
                    or prev_object_name
                )


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

        # v24 — 챕터별 직렬, 챕터끼리 병렬. story_slot 단위 그룹핑.
        all_chapters = _group_scenes_into_chapters(scenes)
        target_set = set(target_indices)
        logger.info(
            "[PreMVPhase2Chain] groups pre_mv_job_id=%s chapters=%d "
            "scenes_total=%d targets=%d slots=%s",
            pre_mv_job_id, len(all_chapters), len(scenes), len(target_indices),
            ",".join((scenes[c[0]] or {}).get("story_slot", "") or "(empty)"
                     for c in all_chapters),
        )

        # v35 — 챕터 직렬 로직은 _run_chapter_serial 로 추출. 챕터 regenerate endpoint 도 공유.
        chapter_tasks = [
            asyncio.create_task(_run_chapter_serial(
                pre_mv_job_id=pre_mv_job_id,
                image_model=image_model,
                owner_user_id=owner_user_id,
                chapter_seq=c_seq + 1,
                chapter_indices=c_indices,
                scenes=scenes,
                target_set=target_set,
                mongo=mongo,
                oid=oid,
            ))
            for c_seq, c_indices in enumerate(all_chapters)
        ]
        await asyncio.gather(*chapter_tasks, return_exceptions=True)

        # 잡 단위 status 갱신
        await _refresh_phase2_status(pre_mv_job_id)
        logger.info(
            "[PreMVRoute] phase=phase2 bg ok pre_mv_job_id=%s image_model=%s "
            "queued_scenes=%d chapters=%d",
            pre_mv_job_id, image_model, len(target_indices), len(all_chapters),
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
#
# ⚠️ v35 이후 deprecated — 챕터 일관성을 깨는 단일 씬 재생성.
# prev_scene_image_bytes 가 carry 안 되어 챕터 내 톤·소품·캐릭터 불일치 발생.
# 신규 호출은 POST /jobs/{id}/chapters/regenerate-images 로 마이그레이션.
# 백워드 호환을 위해 endpoint 자체는 유지.
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
# POST /jobs/{id}/chapters/regenerate-images  (v35)
#
# 챕터 (연속 같은 story_slot) 단위 씬 이미지 재생성. body.scene_number 가
# 속한 챕터의 모든 씬을 직렬로 다시 생성. prev_scene_image_bytes carry 로
# 챕터 내 톤·소품·캐릭터 일관성 보장.
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/chapters/regenerate-images")
async def regenerate_chapter_images(
    pre_mv_job_id: str,
    body: ChapterRegenerateImagesBody,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase2 action=regenerate_chapter entry "
        "user_id=%s is_admin=%s pre_mv_job_id=%s scene_number=%d",
        user_id, is_admin, pre_mv_job_id, body.scene_number,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, owner_user_id, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if body.scene_number < 1 or body.scene_number > len(scenes):
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

    cur_status = pre_doc.get("status") or ""
    allowed = {"phase2_images", "phase2_failed", "phase2_partial", "phase2_ready"}
    if cur_status not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 챕터 이미지를 재생성할 수 없어요.".format(cur_status)},
        )

    gate = await _gate_image_model_key(image_model)
    if gate is not None:
        return gate

    # 챕터 찾기 — scene_number(1-based) → scene_index(0-based) → 그 인덱스를 포함한 챕터
    target_scene_idx = body.scene_number - 1
    all_chapters = _group_scenes_into_chapters(scenes)
    target_chapter: Optional[list[int]] = None
    target_chapter_seq = 0
    for c_seq, c_indices in enumerate(all_chapters):
        if target_scene_idx in c_indices:
            target_chapter = c_indices
            target_chapter_seq = c_seq + 1
            break
    if not target_chapter:
        return JSONResponse(
            status_code=500,
            content={"error": "챕터 그룹핑에서 해당 씬을 찾지 못했습니다."},
        )

    target_slot = (scenes[target_chapter[0]] or {}).get("story_slot") or ""
    logger.info(
        "[PreMVRoute] phase=phase2 chapter resolved pre_mv_job_id=%s "
        "chapter_seq=%d slot=%s scene_count=%d scene_indices=%s",
        pre_mv_job_id, target_chapter_seq, target_slot,
        len(target_chapter), target_chapter,
    )

    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    now = datetime.now(timezone.utc)

    # 챕터의 모든 씬을 pending 으로 마크 (완료된 것도 강등 — force 와 같은 효과).
    # image_object_name 도 None 으로 리셋해 chain carry 가 깔끔하게 새로 시작되게 한다.
    pending_set: dict[str, Any] = {
        "status": "phase2_images",
        "updated_at": now,
    }
    for i in target_chapter:
        pending_set["scenes.{}.image_status".format(i)] = "pending"
        pending_set["scenes.{}.image_error".format(i)] = None
        pending_set["scenes.{}.image_object_name".format(i)] = None
    try:
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": pending_set})
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase2 chapter regenerate pending-mark failed "
            "pre_mv_job_id=%s chapter_seq=%d",
            pre_mv_job_id, target_chapter_seq,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "챕터 재생성 시작에 실패했습니다."},
        )

    target_set = set(target_chapter)
    queued_scene_numbers = [i + 1 for i in target_chapter]

    async def _run_then_refresh() -> None:
        try:
            await _run_chapter_serial(
                pre_mv_job_id=pre_mv_job_id,
                image_model=image_model,
                owner_user_id=owner_user_id,
                chapter_seq=target_chapter_seq,
                chapter_indices=target_chapter,
                scenes=scenes,
                target_set=target_set,
                mongo=mongo,
                oid=oid,
            )
        finally:
            await _refresh_phase2_status(pre_mv_job_id)

    asyncio.create_task(_run_then_refresh())

    logger.info(
        "[PreMVRoute] phase=phase2 chapter regenerate queued user_id=%s "
        "pre_mv_job_id=%s chapter_seq=%d slot=%s queued_scene_numbers=%s",
        user_id, pre_mv_job_id, target_chapter_seq, target_slot,
        queued_scene_numbers,
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "chapter_seq": target_chapter_seq,
        "story_slot": target_slot,
        "queued_scene_numbers": queued_scene_numbers,
        "status": "phase2_images",
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
    field_dump = body.model_dump(exclude_unset=True)

    # 1) 사용자 명시 변경 — prev 와 다르면 적용 + updated_fields 누적.
    for key, val in field_dump.items():
        if val is None:
            continue
        prev = target.get(key)
        if (prev or "") == val:
            continue
        target[key] = val
        updated_fields.append(key)

    if not updated_fields:
        return {
            "scene_number": scene_number,
            "updated_fields": [],
            "mirror_synced_fields": [],
            "mirror_sync_failed": False,
            "scene": target,
        }

    # 2) v24.1 — 한국어/영문 mirror 자동 동기화.
    #
    # 세 쌍 (description, image_prompt, video_prompt) 각각에 대해:
    #   - 사용자가 영문/한국어 둘 다 명시했으면 → mirror 호출 안 함 (사용자 의도 우선).
    #   - 영문만 명시 → 한국어 자동 번역.
    #   - 한국어만 명시 → 영문 자동 번역.
    #   - 둘 다 미명시 → 그 쌍은 그대로.
    pairs_to_sync: list[tuple[str, str, str]] = []  # (source_field, target_field, source_value)
    for en_field, ko_field in ENGLISH_TO_KO_FIELD.items():
        en_in = en_field in field_dump and field_dump.get(en_field) is not None
        ko_in = ko_field in field_dump and field_dump.get(ko_field) is not None
        if en_in and ko_in:
            continue  # 둘 다 사용자 지정 — LLM 호출 skip.
        if en_in and not ko_in:
            src_val = target.get(en_field) or ""
            if src_val.strip():
                pairs_to_sync.append((en_field, ko_field, src_val))
        elif ko_in and not en_in:
            src_val = target.get(ko_field) or ""
            if src_val.strip():
                pairs_to_sync.append((ko_field, en_field, src_val))

    mirror_synced_fields: list[str] = []
    mirror_sync_failed = False

    if pairs_to_sync:
        try:
            translations = await sync_scene_mirrors(
                pre_mv_job_id=pre_mv_job_id,
                scene_number=scene_number,
                pairs_to_sync=pairs_to_sync,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[PreMVRoute] action=patch_scene mirror_sync exception pre_mv_job_id=%s "
                "scene=%d err=%s: %s",
                pre_mv_job_id, scene_number, type(e).__name__, str(e)[:200],
            )
            translations = {}

        if not translations:
            mirror_sync_failed = True
        else:
            # 일부만 성공한 경우 — 성공한 페어만 반영, 누락 페어는 mirror_sync_failed 신호 안 줌
            # (해당 페어는 mirror_synced_fields 에서 빠질 뿐, 사용자 변경분은 정상 저장됨).
            expected_targets = {tgt for _, tgt, _ in pairs_to_sync}
            missing_targets = expected_targets - set(translations.keys())
            if missing_targets:
                # 요청한 페어 일부 누락 — 전체 실패는 아니지만 부분 실패 신호로 처리.
                logger.warning(
                    "[PreMVRoute] action=patch_scene mirror_sync partial pre_mv_job_id=%s "
                    "scene=%d translated=%s missing=%s",
                    pre_mv_job_id, scene_number,
                    ",".join(sorted(translations.keys())),
                    ",".join(sorted(missing_targets)),
                )
            for tgt_field, value in translations.items():
                target[tgt_field] = value
                mirror_synced_fields.append(tgt_field)

    # 3) user_edited_fields 누적 — 사용자가 명시한 필드만 (mirror 갱신은 누적 안 함).
    prev_edits = set(target.get("user_edited_fields") or [])
    for f in updated_fields:
        prev_edits.add(f)
    target["user_edited_fields"] = sorted(prev_edits)

    # 4) Invalidate logic — 사용자 변경 + mirror 갱신 모두 모델 입력 변화 트리거.
    all_changed_fields = set(updated_fields) | set(mirror_synced_fields)
    image_prompt_changed = bool(
        all_changed_fields & {"image_prompt", "image_prompt_ko"}
    )
    video_prompt_changed = bool(
        all_changed_fields & {"video_prompt", "video_prompt_ko"}
    )
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
        "scene=%d user_fields=%s mirror_pairs=%d synced=%s failed=%s "
        "invalidate_image=%s invalidate_video=%s",
        user_id, is_admin, pre_mv_job_id, scene_number,
        ",".join(updated_fields),
        len(pairs_to_sync),
        ",".join(sorted(mirror_synced_fields)) or "-",
        mirror_sync_failed,
        image_prompt_changed, video_prompt_changed,
    )
    return {
        "scene_number": scene_number,
        "updated_fields": updated_fields,
        "mirror_synced_fields": sorted(mirror_synced_fields),
        "mirror_sync_failed": mirror_sync_failed,
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
) -> list[tuple[bytes, bool]]:
    """씬의 ref_sheet_ids 가 가리키는 캐릭터 시트 bytes 들 (최대 max_refs 장).

    v39 — 반환 형식 변경: list[(bytes, is_explicit)].
      · is_explicit=True : 사용자가 ref_sheet_ids 에 명시한 시트 (full-match — 얼굴+옷 모두 따름)
      · is_explicit=False: v37 default fallback 으로 추가된 시트 (face-only — 얼굴만 매칭, 옷은 scene 자유)

    Phase 2 image-side 의 v34 [face-only]/[full-match] 차별을 영상에도 적용.
    Kling 호출 시 prompt 안내문 + image_list 첨부 둘 다에 사용된다.
    실패한 slot 은 조용히 skip — 다른 씬 영향 X.

    v37 — explicit ref 가 groom/bride 한 쪽이라도 비어있으면 default 시트
    (groom_wedding/casual, bride_wedding/casual) 로 face-only fallback 보강.
    """
    explicit_refs = list((scene or {}).get("ref_sheet_ids") or [])
    has_groom = any((r or "").startswith("groom_") for r in explicit_refs)
    has_bride = any((r or "").startswith("bride_") for r in explicit_refs)

    # slot 별 (slot, is_explicit) 순서 유지. explicit 가 앞, fallback 이 뒤.
    slots_with_meta: list[tuple[str, bool]] = [(s, True) for s in explicit_refs]
    if not has_groom:
        slots_with_meta.extend([("groom_wedding", False), ("groom_casual", False)])
    if not has_bride:
        slots_with_meta.extend([("bride_wedding", False), ("bride_casual", False)])

    if not slots_with_meta:
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
    out: list[tuple[bytes, bool]] = []
    seen_slots: set = set()
    for slot, is_explicit in slots_with_meta:
        if slot in seen_slots:
            continue
        seen_slots.add(slot)
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
                out.append((data, is_explicit))
                if not is_explicit:
                    logger.info(
                        "[PreMVRoute] phase=phase3 sheet face-only fallback applied "
                        "scene_number=%s slot=%s",
                        (scene or {}).get("scene_number"), slot,
                    )
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
    start_frame_bytes_override: Optional[bytes] = None,
    end_frame_bytes: Optional[bytes] = None,
    chapter_seq: Optional[int] = None,
    scene_in_chapter: Optional[tuple[int, int]] = None,
    start_frame_source: str = "scene_image",
    end_frame_source: Optional[str] = None,
) -> None:
    """씬 한 개의 영상 생성. 실패해도 isolation — 다른 씬 영향 없음.

    v24:
      start_frame_bytes_override:
        chapter 안에서 이전 씬 영상 last frame 을 ffmpeg 로 추출한 PNG bytes.
        주어지면 image_object_name 대신 이를 start_frame 으로 사용.
      end_frame_bytes:
        chapter 안에서 next_scene 의 Phase 2 PNG bytes (FFLF end).
        None 이면 free end (last frame 미첨부).
      start_frame_source: "scene_image" | "prev_video_last_frame" — mongo 에 기록.
      end_frame_source:   "next_scene_image" | "free" | None.
    """
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
        # v24 — start_frame_bytes_override 가 있으면 그것을 우선 (chapter 안 carry).
        if start_frame_bytes_override is not None:
            image_bytes = start_frame_bytes_override
        else:
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
        if chapter_seq is not None and scene_in_chapter is not None:
            n_in, n_tot = scene_in_chapter
            logger.info(
                "[PreMVPhase3Chain] chapter_seq=%d scene_in_chapter=%d/%d "
                "scene_number=%d starting start=%s end=%s",
                chapter_seq, n_in, n_tot, scene_number,
                start_frame_source, end_frame_source or "(none)",
            )
        logger.info(
            "[PreMVRoute] phase=phase3 scene_bg dispatch pre_mv_job_id=%s "
            "scene_number=%d video_model=%s end_frame_attached=%s",
            pre_mv_job_id, scene_number, video_model, bool(end_frame_bytes),
        )
        # Grok 은 last frame 미지원 — end_frame_bytes 가 들어와도 무시.
        eff_end_frame = end_frame_bytes if video_model != "grok" else None
        try:
            if video_model == "veo":
                video_bytes = await generate_scene_video_veo(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                    end_frame_bytes=eff_end_frame,
                )
            elif video_model == "kling":
                # v39 — _load_char_sheet_bytes_for_scene 반환은 [(bytes, is_explicit), ...]
                char_refs_meta = await _load_char_sheet_bytes_for_scene(
                    owner_user_id=owner_user_id, scene=scene, max_refs=2,
                )
                char_ref_bytes_list = [b for b, _ in char_refs_meta]
                char_ref_modes = [
                    "explicit" if exp else "face_only" for _, exp in char_refs_meta
                ]
                video_bytes = await generate_scene_video_kling(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                    char_ref_bytes_list=char_ref_bytes_list,
                    char_ref_modes=char_ref_modes,
                    end_frame_bytes=eff_end_frame,
                )
            elif video_model == "seedance":
                video_bytes = await generate_scene_video_seedance(
                    pre_mv_job_id=pre_mv_job_id,
                    scene_number=scene_number,
                    scene=scene,
                    image_bytes=image_bytes,
                    end_frame_bytes=eff_end_frame,
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
            # v25 Layer 3 — fal/Seedance 출력 모더레이션 거부 감지
            err_lower = (str(e) or "").lower()
            is_content_policy = (
                "content_policy_violation" in err_lower
                or "sensitive content" in err_lower
            )
            video_error_reason = "content_policy" if is_content_policy else None
            user_error_text = (
                "콘텐츠 정책에 의해 거부되었습니다 (영상 모델 출력 모더레이션). "
                "다른 모델로 재시도하거나 프롬프트를 조정해주세요."
                if is_content_policy else err_text
            )
            logger.exception(
                "[PreMVRoute] phase=phase3 scene_bg generator failed "
                "pre_mv_job_id=%s scene_number=%d video_model=%s "
                "content_policy=%s err=%s",
                pre_mv_job_id, scene_number, video_model,
                is_content_policy, err_text,
            )
            try:
                await mongo.pre_mv_jobs.update_one(
                    {"_id": oid},
                    {
                        "$set": {
                            "scenes.{}.video_status".format(scene_index): "failed",
                            "scenes.{}.video_error".format(scene_index): user_error_text,
                            "scenes.{}.video_error_reason".format(scene_index): video_error_reason,
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
                        # v24 — 챕터 FFLF 연쇄 메타데이터.
                        "scenes.{}.video_start_frame_source".format(scene_index):
                            start_frame_source,
                        "scenes.{}.video_end_frame_source".format(scene_index):
                            end_frame_source,
                        "updated_at": finish_now,
                    }
                },
            )
            logger.info(
                "[PreMVRoute] phase=phase3 scene_bg ok pre_mv_job_id=%s "
                "scene_number=%d video_model=%s object=%s bytes=%d "
                "start_src=%s end_src=%s",
                pre_mv_job_id, scene_number, video_model, object_name,
                len(video_bytes), start_frame_source, end_frame_source or "(none)",
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


async def _run_chapter_video_serial(
    *,
    pre_mv_job_id: str,
    video_model: str,
    owner_user_id: str,
    chapter_seq: int,
    chapter_indices: list[int],
    scenes: list[dict],
    target_set: set[int],
    mongo,
    oid,
) -> None:
    """v40 — 챕터 안 직렬 영상 실행. _run_phase3 와 regenerate_chapter_videos 가 공유.

    v38 기준 동작:
      · start_frame_bytes_override 는 항상 None — 각 씬이 자기 Phase 2 이미지로 start.
      · end_frame_bytes 는 챕터 마지막이 아니면 다음 씬 Phase 2 이미지 (Kling image_tail).
      · target_set 에 없는 씬은 건너뛰되 prev_video_object 로 carry 만 갱신.
    """
    in_chapter_total = len(chapter_indices)
    prev_video_object: Optional[str] = None
    for pos, scene_idx in enumerate(chapter_indices):
        is_last_in_chapter = (pos == in_chapter_total - 1)

        # v38 — start_frame 은 항상 자기 Phase 2 image.
        start_bytes: Optional[bytes] = None
        start_src = "scene_image"

        # end_frame — 챕터 마지막이 아니면 다음 씬 Phase 2 PNG.
        end_bytes: Optional[bytes] = None
        end_src: Optional[str] = None
        if not is_last_in_chapter:
            next_idx = chapter_indices[pos + 1]
            next_scene = scenes[next_idx] or {}
            next_obj = next_scene.get("image_object_name")
            if next_obj:
                end_bytes = await _load_photos_bytes(next_obj)
                end_src = "next_scene_image" if end_bytes else "free"
            else:
                end_src = "free"
        else:
            end_src = "free"

        if scene_idx not in target_set:
            existing_video = (scenes[scene_idx] or {}).get("video_object_name")
            if existing_video:
                prev_video_object = existing_video
            continue

        await _run_single_scene_video(
            pre_mv_job_id=pre_mv_job_id,
            scene_index=scene_idx,
            video_model=video_model,
            owner_user_id=owner_user_id,
            semaphore=None,
            start_frame_bytes_override=start_bytes,
            end_frame_bytes=end_bytes,
            chapter_seq=chapter_seq,
            scene_in_chapter=(pos + 1, in_chapter_total),
            start_frame_source=start_src,
            end_frame_source=end_src,
        )
        refreshed = await mongo.pre_mv_jobs.find_one(
            {"_id": oid}, {"scenes": 1},
        )
        if refreshed:
            refreshed_scenes = refreshed.get("scenes") or []
            if scene_idx < len(refreshed_scenes):
                prev_video_object = (
                    (refreshed_scenes[scene_idx] or {}).get("video_object_name")
                    or prev_video_object
                )


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

        # v24 — Grok 은 last frame 미지원 → 챕터 carry 이득 없음. 기존 평탄 병렬 유지.
        if video_model == "grok":
            logger.info(
                "[PreMVPhase3Chain] grok branch — chapter carry skipped, "
                "flat-parallel pre_mv_job_id=%s targets=%d",
                pre_mv_job_id, len(target_indices),
            )
            semaphore = asyncio.Semaphore(_PHASE3_MAX_CONCURRENT)
            tasks = [
                asyncio.create_task(
                    _run_single_scene_video(
                        pre_mv_job_id=pre_mv_job_id,
                        scene_index=i,
                        video_model=video_model,
                        owner_user_id=owner_user_id,
                        semaphore=semaphore,
                        start_frame_source="scene_image",
                        end_frame_source=None,
                    )
                )
                for i in target_indices
            ]
            await asyncio.gather(*tasks, return_exceptions=True)
        else:
            # v24 — 챕터별 직렬, 챕터끼리 병렬. story_slot 단위 그룹핑.
            all_chapters = _group_scenes_into_chapters(scenes)
            target_set = set(target_indices)
            logger.info(
                "[PreMVPhase3Chain] groups pre_mv_job_id=%s chapters=%d "
                "scenes_total=%d targets=%d slots=%s",
                pre_mv_job_id, len(all_chapters), len(scenes), len(target_indices),
                ",".join((scenes[c[0]] or {}).get("story_slot", "") or "(empty)"
                         for c in all_chapters),
            )

            # v40 — _run_chapter_video_serial 로 추출 (v35 패턴 영상 버전). 새 endpoint 공유.
            chapter_tasks = [
                asyncio.create_task(_run_chapter_video_serial(
                    pre_mv_job_id=pre_mv_job_id,
                    video_model=video_model,
                    owner_user_id=owner_user_id,
                    chapter_seq=c_seq + 1,
                    chapter_indices=c_indices,
                    scenes=scenes,
                    target_set=target_set,
                    mongo=mongo,
                    oid=oid,
                ))
                for c_seq, c_indices in enumerate(all_chapters)
            ]
            await asyncio.gather(*chapter_tasks, return_exceptions=True)

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
#
# ⚠️ v40 이후 deprecated — 챕터 일관성을 깨는 단일 씬 재생성.
# start_frame_bytes_override=None, end_frame_bytes=None 로 호출되어
# 챕터 안 end_frame transition 효과가 무시됨.
# 신규 호출은 POST /jobs/{id}/chapters/regenerate-videos 로 마이그레이션.
# 백워드 호환을 위해 endpoint 자체는 유지.
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

    # v24 W6 — 단일 regenerate 는 carry 포기. start=phase2 이미지 / end=free.
    # 인접 씬 video_status 검증 없이 안전한 fallback 으로 처리.
    async def _single_then_refresh() -> None:
        await _run_single_scene_video(
            pre_mv_job_id=pre_mv_job_id,
            scene_index=scene_index,
            video_model=video_model,
            owner_user_id=owner_user_id,
            semaphore=None,
            start_frame_bytes_override=None,
            end_frame_bytes=None,
            start_frame_source="scene_image",
            end_frame_source="free",
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
# POST /jobs/{id}/chapters/regenerate-videos  (v40)
#
# 챕터 (연속 같은 story_slot + memory_index) 단위 씬 영상 재생성.
# body.scene_number 가 속한 챕터의 모든 씬을 직렬로 다시 생성.
# v38 이후 start=자기 Phase 2 이미지, end=다음 씬 Phase 2 이미지로 transition.
# 이미지 측 v35 챕터 재생성과 동일 패턴.
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/chapters/regenerate-videos")
async def regenerate_chapter_videos(
    pre_mv_job_id: str,
    body: ChapterRegenerateVideosBody,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[PreMVRoute] phase=phase3 action=regenerate_chapter_videos entry "
        "user_id=%s is_admin=%s pre_mv_job_id=%s scene_number=%d",
        user_id, is_admin, pre_mv_job_id, body.scene_number,
    )

    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, owner_user_id, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if body.scene_number < 1 or body.scene_number > len(scenes):
        return JSONResponse(
            status_code=404,
            content={"error": "해당 씬을 찾을 수 없습니다."},
        )

    video_model = pre_doc.get("video_model")
    if not video_model:
        return JSONResponse(
            status_code=409,
            content={"error": "이 잡의 video_model 이 아직 결정되지 않았어요. 먼저 Phase 3 를 시작해주세요."},
        )

    cur_status = pre_doc.get("status") or ""
    allowed = {"phase3_videos", "phase3_failed", "phase3_partial", "phase3_ready"}
    if cur_status not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "현재 상태({})에서는 챕터 영상을 재생성할 수 없어요.".format(cur_status)},
        )

    gate = await _gate_video_model_key(video_model)
    if gate is not None:
        return gate

    # 챕터 찾기 (v36 — memory slot 은 memory_index 까지 구분).
    target_scene_idx = body.scene_number - 1
    all_chapters = _group_scenes_into_chapters(scenes)
    target_chapter: Optional[list[int]] = None
    target_chapter_seq = 0
    for c_seq, c_indices in enumerate(all_chapters):
        if target_scene_idx in c_indices:
            target_chapter = c_indices
            target_chapter_seq = c_seq + 1
            break
    if not target_chapter:
        return JSONResponse(
            status_code=500,
            content={"error": "챕터 그룹핑에서 해당 씬을 찾지 못했습니다."},
        )

    # 챕터 안 씬들이 image_status=completed 인지 확인 (영상 생성 전제).
    not_ready = [
        i + 1 for i in target_chapter
        if (scenes[i] or {}).get("image_status") != "completed"
    ]
    if not_ready:
        return JSONResponse(
            status_code=422,
            content={
                "error": "이 챕터에 이미지가 완성되지 않은 씬이 있어요: {}. "
                         "먼저 씬 이미지를 만들어 주세요.".format(not_ready)
            },
        )

    target_slot = (scenes[target_chapter[0]] or {}).get("story_slot") or ""
    logger.info(
        "[PreMVRoute] phase=phase3 chapter resolved pre_mv_job_id=%s "
        "chapter_seq=%d slot=%s scene_count=%d scene_indices=%s",
        pre_mv_job_id, target_chapter_seq, target_slot,
        len(target_chapter), target_chapter,
    )

    mongo = get_mongo()
    oid = _to_oid(pre_mv_job_id)
    now = datetime.now(timezone.utc)

    # 챕터 모든 씬을 pending 으로 마크 + video_object_name 리셋.
    pending_set: dict[str, Any] = {
        "status": "phase3_videos",
        "updated_at": now,
    }
    for i in target_chapter:
        pending_set["scenes.{}.video_status".format(i)] = "pending"
        pending_set["scenes.{}.video_error".format(i)] = None
        pending_set["scenes.{}.video_object_name".format(i)] = None
    try:
        await mongo.pre_mv_jobs.update_one({"_id": oid}, {"$set": pending_set})
    except Exception:
        logger.exception(
            "[PreMVRoute] phase=phase3 chapter regenerate pending-mark failed "
            "pre_mv_job_id=%s chapter_seq=%d",
            pre_mv_job_id, target_chapter_seq,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "챕터 영상 재생성 시작에 실패했습니다."},
        )

    target_set = set(target_chapter)
    queued_scene_numbers = [i + 1 for i in target_chapter]

    async def _run_then_refresh() -> None:
        try:
            await _run_chapter_video_serial(
                pre_mv_job_id=pre_mv_job_id,
                video_model=video_model,
                owner_user_id=owner_user_id,
                chapter_seq=target_chapter_seq,
                chapter_indices=target_chapter,
                scenes=scenes,
                target_set=target_set,
                mongo=mongo,
                oid=oid,
            )
        finally:
            await _refresh_phase3_status(pre_mv_job_id)

    asyncio.create_task(_run_then_refresh())

    logger.info(
        "[PreMVRoute] phase=phase3 chapter regenerate queued user_id=%s "
        "pre_mv_job_id=%s chapter_seq=%d slot=%s queued_scene_numbers=%s",
        user_id, pre_mv_job_id, target_chapter_seq, target_slot,
        queued_scene_numbers,
    )
    return {
        "pre_mv_job_id": pre_mv_job_id,
        "chapter_seq": target_chapter_seq,
        "story_slot": target_slot,
        "queued_scene_numbers": queued_scene_numbers,
        "status": "phase3_videos",
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

    # v24.2 — 다운로드 파일명 헤더 추가. `<video>` 인라인 재생은 영향 없음.
    download_name = _compute_scene_filename(scenes, scene_number - 1)
    headers = {
        "Content-Disposition": 'attachment; filename="{}"'.format(download_name),
    }
    logger.info(
        "[PreMVRoute] phase=phase3 video stream user_id=%s pre_mv_job_id=%s "
        "scene_number=%d object=%s filename=%s",
        user_id, pre_mv_job_id, scene_number, object_name, download_name,
    )
    return StreamingResponse(_stream(), media_type="video/mp4", headers=headers)


# ──────────────────────────────────────────────────────────────────────────
# v24.2 — 씬 영상 파일명 헬퍼 + ZIP 다운로드 라우트
#
# 파일명 규칙: `{NN}_{story_slot}_{seq_in_slot}.mp4`.
# - NN          = scene_number (1-based, zero-padded width 2).
# - story_slot  = scene.story_slot 키 (영문 고정: meeting/first_date/...).
# - seq_in_slot = 같은 story_slot 연속 묶음(=챕터) 안 a/b/c 순서 (0→a).
#
# 챕터 그룹핑은 `_group_scenes_into_chapters(scenes)` 와 동일.
# ──────────────────────────────────────────────────────────────────────────

def _compute_scene_filename(scenes: list[dict], idx: int) -> str:
    """0-based scene index → 다운로드 파일명.

    idx 가 범위 밖이면 fallback `{NN}_unknown_a.mp4`.
    """
    n = idx + 1
    if not scenes or idx < 0 or idx >= len(scenes):
        return "{:02d}_unknown_a.mp4".format(n)
    scene = scenes[idx] or {}
    slot = (scene.get("story_slot") or "unknown").strip() or "unknown"
    # 같은 슬롯 연속 묶음 안에서 idx 의 순서를 찾는다.
    chapters = _group_scenes_into_chapters(scenes)
    seq_char = "a"
    for ch in chapters:
        if idx in ch:
            pos = ch.index(idx)
            seq_char = chr(ord("a") + pos)
            break
    return "{:02d}_{}_{}.mp4".format(n, slot, seq_char)


# ──────────────────────────────────────────────────────────────────────────
# POST /jobs/{id}/scenes/download-zip  (v24.2 — 일괄 다운로드)
# ──────────────────────────────────────────────────────────────────────────

@router.post("/jobs/{pre_mv_job_id}/scenes/download-zip")
async def download_scenes_zip(
    pre_mv_job_id: str,
    body: DownloadZipBody,
    current_user=Depends(get_current_user),
):
    user_id = current_user.get("id") if isinstance(current_user, dict) else None
    resolved = await _resolve_pre_mv_job(pre_mv_job_id, current_user)
    if isinstance(resolved, JSONResponse):
        return resolved
    pre_doc, _mv_doc, _, _ = resolved

    scenes = pre_doc.get("scenes") or []
    if not scenes:
        return JSONResponse(
            status_code=422,
            content={"error": "잡에 씬이 없어요."},
        )

    # 요청된 씬 번호 결정. None/빈 → 전체. 명시 → 그 번호만.
    requested = body.scene_numbers
    if requested is None or len(requested) == 0:
        target_indices = list(range(len(scenes)))
        mode = "all"
    else:
        target_indices = []
        for n in requested:
            if 1 <= n <= len(scenes):
                target_indices.append(n - 1)
        mode = "selected"

    # completed 만 필터.
    completed_indices = [
        i for i in target_indices
        if (scenes[i] or {}).get("video_status") == "completed"
        and (scenes[i] or {}).get("video_object_name")
    ]

    if not completed_indices:
        logger.info(
            "[PreMVRoute] phase=zip empty user_id=%s pre_mv_job_id=%s mode=%s "
            "requested=%d",
            user_id, pre_mv_job_id, mode, len(target_indices),
        )
        return JSONResponse(
            status_code=422,
            content={"error": "다운로드할 완료된 씬이 없어요."},
        )

    minio_client = get_minio()
    buf = io.BytesIO()
    written = 0
    skipped = 0
    # mp4 는 이미 압축돼 있으므로 ZIP_STORED (재압축 X) — 메모리/CPU 절약.
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
        for i in completed_indices:
            scene = scenes[i] or {}
            object_name = scene.get("video_object_name") or ""
            if not object_name:
                skipped += 1
                continue
            try:
                resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_videos,
                    object_name=object_name,
                )
                data = resp.read()
                resp.close()
                resp.release_conn()
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[PreMVRoute] phase=zip fetch failed user_id=%s "
                    "pre_mv_job_id=%s scene_idx=%d object=%s: %s: %s",
                    user_id, pre_mv_job_id, i, object_name,
                    type(e).__name__, str(e)[:200],
                )
                skipped += 1
                continue
            filename = _compute_scene_filename(scenes, i)
            zf.writestr(filename, data)
            written += 1

    if written == 0:
        return JSONResponse(
            status_code=422,
            content={"error": "다운로드할 완료된 씬이 없어요."},
        )

    buf.seek(0)
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    zip_name = "pre_mv_{}_{}.zip".format(pre_mv_job_id, today)
    headers = {
        "Content-Disposition": 'attachment; filename="{}"'.format(zip_name),
    }

    logger.info(
        "[PreMVRoute] phase=zip ok user_id=%s pre_mv_job_id=%s mode=%s "
        "written=%d skipped=%d bytes=%d",
        user_id, pre_mv_job_id, mode, written, skipped, buf.getbuffer().nbytes,
    )

    def _gen():
        # BytesIO 는 메모리에 이미 빌드됨 — 한 번에 yield. (chunked 도 가능하나 sync.)
        yield buf.getvalue()

    return StreamingResponse(_gen(), media_type="application/zip", headers=headers)


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

        # v42 — [Intro] 다음 첫 다른 section label ([Verse 1] 등) 시작 시점을 offset 으로.
        # v41 은 "첫 가사 시점" 이었으나 사용자가 "[Intro] 다음 [] 지문 부터" 원함.
        # 추가로 lyric_timestamps_variants[audio_variant] 로 SRT 자막도 생성.
        from ..services.pre_mv_phase4_compositor import (
            calculate_video_start_offset,
            generate_srt_from_segments,
        )

        intro_pad_sec = 0.0
        srt_text: Optional[str] = None
        if mv_doc_local:
            ts_variants_local = mv_doc_local.get("lyric_timestamps_variants") or {}
            selected_ts_local = ts_variants_local.get(str(audio_variant)) or []
            if not selected_ts_local:
                selected_ts_local = mv_doc_local.get("lyric_timestamps") or []

            aligned_variants_local = mv_doc_local.get("suno_aligned_words_variants") or {}
            aligned_local = aligned_variants_local.get(str(audio_variant)) or []

            intro_pad_sec = calculate_video_start_offset(
                aligned_words=aligned_local,
                segments_fallback=selected_ts_local if isinstance(selected_ts_local, list) else [],
            )
            if intro_pad_sec > 0:
                logger.info(
                    "[PreMVRoute] phase=phase4 intro_pad pre_mv_job_id=%s "
                    "audio_variant=%d intro_pad_sec=%.3f (after [Intro] section)",
                    pre_mv_job_id, audio_variant, intro_pad_sec,
                )

            if isinstance(selected_ts_local, list) and selected_ts_local:
                srt_text = generate_srt_from_segments(
                    selected_ts_local,
                    video_start_offset_sec=intro_pad_sec,
                )
                cue_count = (srt_text or "").count("-->")
                logger.info(
                    "[PreMVRoute] phase=phase4 subtitle gen pre_mv_job_id=%s "
                    "audio_variant=%d cue_count=%d",
                    pre_mv_job_id, audio_variant, cue_count,
                )

        result = await compose_pre_mv_result(
            pre_mv_job_id=pre_mv_job_id,
            scenes=scenes,
            audio_object_name=audio_object_name,
            video_start_offset_sec=intro_pad_sec,
            srt_text=srt_text,
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
