"""
MV Draft/Resume routes — create MV jobs, manage scenes, generate images/videos.
"""

import io
import logging
import math
import os
from datetime import datetime, timedelta
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.redis import get_redis
from ..services.mv_pipeline import (
    run_phase1_and_phase2,
    run_phase2_images,
    run_phase3_videos,
    run_phase4_concatenate,
    run_phase5_merge_audio,
    _v51_run_cascade,
    _v51_get_scene_idx,
    _v51_set_scene_fields,
    _v51_get_scene,
    _v52_event_cascade,
    _v52_get_affected_scenes,
    _v52_cancel_event_cascade,
)
from ..services.mv_generator import generate_scene_image
from ..services.media_urls import browser_image_url, browser_video_url, public_presign

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mv", tags=["MV"])

# Active processing statuses — used to prevent concurrent phase runs
ACTIVE_STATUSES = {
    "splitting", "generating_images", "generating_videos", "concatenating", "merging_audio",
}


# ── Request Models ───────────────────────────────────────────────────────────

class CreateMVRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    scene_prompt: Optional[str] = None
    character_object_name: Optional[str] = None
    # v99+: 커버에 쓴 캐릭터 기준 통일 — "real"(실사, 기존) | "virtual"(가상화).
    # 미전송/그 외 값은 "real" 로 정규화 (하위호환: 기존 동작 100% 동일).
    character_variant: Optional[str] = "real"
    # v212: 아티스트 다중화 — include_my_character 시 사용할 아티스트 지정 (kind 무관).
    # 미지정이면 기존 variant 대표 해석 경로 (additive — 구 클라이언트 무영향).
    character_id: Optional[str] = None
    video_model: Optional[str] = "veo"  # "veo", "kling", "seedance", or "grok" (v66)
    audio_generation_id: Optional[str] = None
    # v209: MV촬영실 — 이미 발매된 「내 트랙」(파일 업로드 트랙 포함)을 곡 소스로 지정.
    # 본인 소유(uploader_id) 검증 필수 — 실패 시 403. report_blinded 트랙 차단.
    # audio 해석은 mv_pipeline._resolve_audio_object_name 의 tracks 폴백이 담당.
    track_id: Optional[str] = None
    scenario_models: Optional[List[str]] = None  # for scenario generation (e.g. ["gpt-4o-mini", "claude-opus-4-6"])
    prompt_models: Optional[List[str]] = None    # for image prompt generation (e.g. ["gpt-4o-mini", "gpt-5.4"])
    video_prompt_model: Optional[str] = None     # for video prompt generation (e.g. "claude-opus-4-7")
    # ── Drama scenario controls (PLAN.md v30) ─────────────────────────────
    scenario_style: Optional[str] = "drama"  # ("drama", "mood", "literal", "ai_auto") — currently only drama is implemented
    vocal_gender: Optional[str] = None       # ("female", "male", "neutral") — 시나리오 character1에 강제 사용
    relationship: Optional[str] = None       # ("ex_lover", "friend", "colleague", "family", None) — character2 관계
    include_my_character: Optional[bool] = False  # "내 캐릭터 포함" 체크 여부
    location_id: Optional[str] = None        # v42: user-saved location anchor (Mode B)
    # ── v49: 사용자 사건 시드 (PLAN.md v49) ─────────────────────────────────
    # 사용자가 시나리오에 포함되기를 원하는 핵심 사건/헤프닝을 짧게 입력. ≤300자 trim.
    # 빈 문자열 / 공백만 / None 모두 None 으로 정규화 (= 시드 없음, v48 까지의 흐름 유지).
    # 본문은 PII 가능성 → server.log 에 길이(len)만 기록, 본문 절대 출력 금지.
    user_event_seed: Optional[str] = None
    # v55: 씬+자산 공통 이미지 생성 모델. "nb_pro" (default) | "gpt_image_2".
    image_model: Optional[str] = "nb_pro"
    # v55: 커버 생성 시 사용된 모델 — 프론트가 generate-cover 응답값을 그대로 전달.
    cover_image_model: Optional[str] = None
    # v63: 커버 이미지 인물을 character1 주인공 자산으로 사용할지 여부.
    # True + 커버 PNG 있음 + "내 캐릭터 포함" off 일 때만 발동.
    # 효과: Phase 0 에서 vision LLM 으로 외형 description 추출 → character1_meta 주입,
    # Phase 1.5 에서 커버 PNG 를 character1 자산 시트의 ref 로 사용.
    use_cover_person_as_character1: Optional[bool] = True


# v55: image model enum + validator.
ALLOWED_IMAGE_MODELS = {"nb_pro", "gpt_image_2"}


def _normalize_image_model(raw: Optional[str], default: str = "nb_pro") -> Optional[str]:
    """Return validated image_model string, or None if input is invalid (caller → 400).

    Empty/whitespace/None → `default` ("nb_pro" by default).
    """
    if raw is None:
        return default
    v = raw.strip()
    if not v:
        return default
    if v in ALLOWED_IMAGE_MODELS:
        return v
    return None


class SelectModelRequest(BaseModel):
    model: str  # which model's result to use


class GenerateImagesRequest(BaseModel):
    scene_numbers: Optional[List[int]] = None


class GenerateVideosRequest(BaseModel):
    scene_numbers: Optional[List[int]] = None
    video_model: Optional[str] = None  # override job's video_model if provided


class SaveDraftRequest(BaseModel):
    audio_generation_id: Optional[str] = None
    # v209: 「내 트랙」 곡 소스 임시저장 — 검증 통과 시 job.audio_track_id 로 저장.
    track_id: Optional[str] = None
    audio_file_name: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    tags: Optional[str] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None


class MergeAudioRequest(BaseModel):
    audio_object_name: str


class AttachMVRequest(BaseModel):
    """v211 — 곡에 붙이기. 타겟 파라미터 없음: 부착 대상 = job 자신의 소스 곡
    (audio_track_id / audio_generation_id) 뿐 — 타곡 지정 원천 불가.
    replace=True 면 같은 곡에 기부착된 타 job 을 해제하고 교체."""
    replace: Optional[bool] = False


# ── v51: Scene edit + cascade request bodies ────────────────────────────────

class PatchSceneRequest(BaseModel):
    description: Optional[str] = None
    image_prompt: Optional[str] = None
    video_prompt: Optional[str] = None
    # v56 — Korean sibling fields. 사용자는 한국어만 편집, 영어는 cascade 가 자동 번역.
    description_ko: Optional[str] = None
    image_prompt_ko: Optional[str] = None
    video_prompt_ko: Optional[str] = None


class CascadeRegenerateRequest(BaseModel):
    # v51: "description" | "image_prompt" | "video_prompt"
    # v56: + "description_ko" | "image_prompt_ko" | "video_prompt_ko"
    trigger_field: str


# ── v52: Scenario event edit + cascade request body ─────────────────────────

class PatchScenarioEventRequest(BaseModel):
    """v52 — scenario_events[order-1] 의 5개 필드 부분 수정.

    모두 Optional — 사용자가 보낸 필드만 갱신한다. 빈 body → 400.
    props 는 list[str]. 다른 필드는 string.
    """
    trigger: Optional[str] = None
    protagonist_action: Optional[str] = None
    motivation: Optional[str] = None
    emotion_shift: Optional[str] = None
    props: Optional[List[str]] = None


# ── v53: Scenario top-level edit + events array replace + full cascade ──────

class PatchScenarioRequest(BaseModel):
    """v53 — 시나리오 상위 6개 필드 부분 수정.

    모두 Optional — 사용자가 보낸 필드만 갱신한다. 빈 body → 400.
    character_states / narrative_arc 는 dict (sub-key 자유).
    narrative / premise / central_conflict / emotional_core 는 string.
    """
    narrative: Optional[str] = None
    premise: Optional[str] = None
    character_states: Optional[dict] = None
    central_conflict: Optional[str] = None
    emotional_core: Optional[str] = None
    narrative_arc: Optional[dict] = None


class PatchScenarioEventsArrayRequest(BaseModel):
    """v53 — scenario_events 배열 통째 교체 (추가/삭제/대량 수정).

    events: 빈 list 불가 (최소 1개). 각 event 는 5 필드 + (선택) user_edited_fields.
    order 는 백엔드가 1, 2, 3, ... 자동 재계산.
    """
    events: List[dict]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _validate_object_id(job_id: str) -> ObjectId:
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="유효하지 않은 작업 ID입니다.")
    return ObjectId(job_id)


async def _get_job_with_ownership(mongo_db, oid: ObjectId, user_id: str) -> dict:
    job = await mongo_db.mv_jobs.find_one({"_id": oid})
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if job.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="이 작업에 접근할 권한이 없습니다.")
    return job


async def _invalidate_track_cache(track_id) -> None:
    """v211 — 부착/떼기/교체/삭제 시 트랙 상세 캐시 무효화 (tracks.py :744-745 관행).

    상세 응답이 has_music_video 를 포함한 채 redis `cache:track:v3` 600s 캐시되므로
    부착 상태 변화 시 즉시 반영을 위해 delete. best-effort — 실패해도 본 동작 유지.
    """
    if not track_id:
        return
    try:
        redis = get_redis()
        await redis.delete(f"cache:track:{track_id}")
        await redis.delete(f"cache:track:v3:{track_id}")
    except Exception as e:
        logger.warning("[MVAttach] cache invalidate failed track=%s: %s", track_id, e)


# v173: 로컬 _presign 제거 — 브라우저 노출 URL 은 중앙 헬퍼로 위임.
# 이미지 필드 → browser_image_url (proxy/presign 모드), 비디오 필드 → browser_video_url
# (항상 public presign), 외부 API(Grok) 전달용 → public_presign.


def _serialize_assets(assets_meta) -> dict:
    """v61 — Mongo `mv_jobs.assets` 를 GET 응답용으로 직렬화.

    각 자산에 presigned image_url 포함. None/non-dict 입력 시 빈 dict.
    옛 잡(assets 없음) 은 빈 dict 반환 — byte-level backward compatible.
    """
    if not isinstance(assets_meta, dict):
        return {}
    out = {}
    for key, asset in assets_meta.items():
        if not isinstance(asset, dict):
            continue
        obj = asset.get("object_name")
        created_at = asset.get("created_at")
        out[key] = {
            "type": asset.get("type"),
            "name": asset.get("name"),
            "description": asset.get("description", ""),
            "gender": asset.get("gender"),
            "age": asset.get("age", ""),
            "personality_tags": asset.get("personality_tags") or [],
            "personality_text": asset.get("personality_text", ""),
            "source": asset.get("source"),
            "object_name": obj,
            "image_url": browser_image_url(obj),
            "created_at": (
                created_at.isoformat() if hasattr(created_at, "isoformat") else None
            ),
        }
    return out


def _scene_to_dict(scene: dict) -> dict:
    """Convert scene doc to response dict with presigned URLs."""
    result = {
        "scene_number": scene.get("scene_number"),
        "description": scene.get("description", ""),
        "image_prompt": scene.get("image_prompt") or scene.get("description", ""),
        "video_image_prompt": scene.get("video_image_prompt", ""),
        "video_prompt": scene.get("video_prompt", ""),
        "description_ko": scene.get("description_ko", ""),
        # v56 — Korean siblings of image_prompt / video_prompt.
        # Empty default for old docs; GET handler runs lazy translation when missing.
        "image_prompt_ko": scene.get("image_prompt_ko", "") or "",
        "video_prompt_ko": scene.get("video_prompt_ko", "") or "",
        "lyrics_segment": scene.get("lyrics_segment", ""),
        "image_object_name": scene.get("image_object_name"),
        "image_url": browser_image_url(scene.get("image_object_name")),
        "image_source": scene.get("image_source"),
        "video_object_name": scene.get("video_object_name"),
        "video_url": browser_video_url(scene.get("video_object_name")),
        "video_with_audio_url": browser_video_url(scene.get("video_with_audio_object")),
        "video_synclabs_url": browser_video_url(scene.get("video_synclabs_object")),
        "video_with_audio_synclabs_url": browser_video_url(scene.get("video_with_audio_synclabs_object")),
        "video_status": scene.get("video_status", "pending"),
        "video_error": scene.get("video_error"),
        "sync_error": scene.get("sync_error"),
        "video_source": scene.get("video_source"),
    }
    # Section-aware fields (present when music structure analysis was used)
    if scene.get("use_seconds") is not None:
        result["use_seconds"] = scene["use_seconds"]
    if scene.get("section"):
        result["section"] = scene["section"]
    if scene.get("section_mood"):
        result["section_mood"] = scene["section_mood"]
    if scene.get("scene_type"):
        result["scene_type"] = scene["scene_type"]
    if scene.get("section_start") is not None:
        result["section_start"] = scene["section_start"]
    if scene.get("section_end") is not None:
        result["section_end"] = scene["section_end"]
    if scene.get("clip_mood"):
        result["clip_mood"] = scene["clip_mood"]
    # v45: scene → event mapping (index into job.scenario_events). May be None.
    if "event_index" in scene:
        result["event_index"] = scene.get("event_index")
    # v51: scene-level edit + cascade tracking. Backward-compat: old docs may
    # not have these keys → default values returned so frontend can read safely.
    result["user_edited_fields"] = scene.get("user_edited_fields") or []
    result["cascade_status"] = scene.get("cascade_status") or "idle"
    result["cascade_progress"] = scene.get("cascade_progress") or 0
    result["cascade_started_at"] = scene.get("cascade_started_at")
    result["cascade_completed_at"] = scene.get("cascade_completed_at")
    result["cascade_id"] = scene.get("cascade_id")
    result["cancel_requested"] = bool(scene.get("cancel_requested"))
    return result


# ── v209: track 곡 소스 공용 검증 (create_mv / save_draft 재사용) ────────────

async def _validate_user_track_source(mongo, raw_track_id, current_user, ctx: str):
    """「내 트랙」 곡 소스 track_id 검증 — (error_response, audio_track_id, duration_sec) 반환.

    분기: ObjectId 무효 400 / 미존재 404 / 타인 소유 403 / report_blinded 403 /
    audio_url 부재 400. 통과 시 (None, track_id 문자열, duration_sec|None).
    ctx 는 로그 표기용 ("create" | "save-draft").
    """
    raw = (raw_track_id or "").strip()
    if not ObjectId.is_valid(raw):
        logger.warning("[MV] %s invalid track_id=%r user=%s", ctx, raw_track_id, current_user["id"])
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."}), None, None
    track_doc = await mongo.tracks.find_one(
        {"_id": ObjectId(raw)},
        {"uploader_id": 1, "audio_url": 1, "report_blinded": 1, "duration_sec": 1, "duration": 1},
    )
    if not track_doc:
        logger.warning("[MV] %s track not found track_id=%s user=%s", ctx, raw, current_user["id"])
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."}), None, None
    owner_ok = track_doc.get("uploader_id") == current_user["id"]
    logger.info("[MV] %s track_id=%s owner_ok=%s user=%s", ctx, raw, owner_ok, current_user["id"])
    if not owner_ok:
        return JSONResponse(status_code=403, content={"error": "본인 트랙만 MV로 만들 수 있습니다."}), None, None
    if track_doc.get("report_blinded"):
        logger.warning("[MV] %s track blinded track_id=%s user=%s", ctx, raw, current_user["id"])
        return JSONResponse(
            status_code=403,
            content={"error": "신고 처리로 숨겨진 트랙은 MV를 만들 수 없습니다."},
        ), None, None
    if not track_doc.get("audio_url"):
        logger.warning("[MV] %s track has no audio_url track_id=%s", ctx, raw)
        return JSONResponse(status_code=400, content={"error": "트랙에 오디오 파일이 없습니다."}), None, None
    try:
        _raw_dur = track_doc.get("duration_sec") or track_doc.get("duration")
        duration_sec = float(_raw_dur) if _raw_dur else None
    except (TypeError, ValueError):
        duration_sec = None
    return None, raw, duration_sec


# ── POST /api/mv/create ─────────────────────────────────────────────────────

@router.post("/create")
async def create_mv(
    body: CreateMVRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Create MV draft + start scene splitting."""
    # v55: image_model 검증 (씬+자산 공통). 잘못된 값 → 400.
    norm_image_model = _normalize_image_model(body.image_model)
    if norm_image_model is None:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 image_model 입니다. (nb_pro, gpt_image_2)"},
        )
    # cover_image_model 은 옵셔널 (생성 시점 스냅샷). 명시되지 않으면 None 유지.
    # 잘못된 값이면 None 으로 폴백 (400 아님 — 스냅샷용이라 관대 처리).
    norm_cover_image_model: Optional[str] = None
    if body.cover_image_model and body.cover_image_model.strip():
        _cand = body.cover_image_model.strip()
        if _cand in ALLOWED_IMAGE_MODELS:
            norm_cover_image_model = _cand
        else:
            logger.warning(
                "[CreateMV] invalid cover_image_model=%r — storing as None",
                body.cover_image_model,
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
    logger.info(
        "[CreateMV] image_model=%s cover_image_model=%s user=%s",
        norm_image_model,
        norm_cover_image_model or "(none)",
        current_user["id"],
    )

    title = body.title.strip()
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "곡 제목을 입력해주세요."},
        )

    if not body.cover_object_name:
        return JSONResponse(
            status_code=400,
            content={"error": "커버 이미지가 필요합니다. 먼저 커버를 생성해주세요."},
        )

    # v210: 곡 소스 부재 가드 — 소스 없는 job 은 phase1/2 (외부 유료 API) 를
    # 무의미하게 발동시키고 오디오 해석 단계에서 반드시 실패한다 (D4 택지 (a)).
    # DB sourceless job 0건 실측 — 기존 정상 경로 diff 0.
    if not body.audio_generation_id and not body.track_id:
        logger.warning("[CreateMV] rejected no-source user=%s", current_user["id"])
        return JSONResponse(
            status_code=400,
            content={"error": "곡 소스가 필요합니다. 곡을 선택한 뒤 다시 시도해주세요."},
        )

    mongo = get_mongo()

    # ── v209: track_id 곡 소스 (MV촬영실 — 내 트랙에서 MV 만들기) ──────────
    # 검증은 _validate_user_track_source 공용 헬퍼 (save_draft 와 재사용).
    # 기존 audio_generation_id 경로는 완전 불변 — track_id 미전송 시 아래 블록 전체 무동작.
    audio_track_id: Optional[str] = None
    track_duration_sec: Optional[float] = None
    if body.track_id:
        _track_err, audio_track_id, track_duration_sec = await _validate_user_track_source(
            mongo, body.track_id, current_user, "create",
        )
        if _track_err is not None:
            return _track_err

    # Validate video model (must come before scene count calculation)
    video_model = body.video_model or "veo"
    if video_model not in ("veo", "kling", "seedance", "grok"):
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 영상 모델입니다. (veo, kling, seedance, grok)"},
        )

    # Validate scenario_style — only "drama" is implemented; others fall back with warning
    scenario_style = (body.scenario_style or "drama").strip().lower()
    if scenario_style not in ("drama", "mood", "literal", "ai_auto"):
        logger.warning(
            "Unknown scenario_style '%s' — falling back to 'drama'", scenario_style,
        )
        scenario_style = "drama"
    elif scenario_style != "drama":
        logger.warning(
            "scenario_style '%s' not yet implemented — falling back to 'drama'",
            scenario_style,
        )
        scenario_style = "drama"

    # Validate vocal_gender / relationship (allow None, but normalize casing)
    vocal_gender = (body.vocal_gender or "").strip().lower() or None
    if vocal_gender and vocal_gender not in ("female", "male", "neutral"):
        logger.warning("Unknown vocal_gender '%s' — using None", vocal_gender)
        vocal_gender = None

    # v46: relationship 정규화 — 한국어 별칭과 영어 enum 모두 받아 영어 enum 으로 정규화.
    # 허용 영어 enum: lover / crush / ex_lover(레거시) / friend / colleague(레거시) / family / none / None
    # 한국어 별칭: 연인 / 짝사랑 / 옛 연인 / 친구 / 동료 / 가족 / 없음
    # 표 매치 실패 시 None 폴백 + warning.
    _RELATIONSHIP_ALIAS = {
        # 영어 (자기 자신 — passthrough)
        "lover": "lover",
        "crush": "crush",
        "ex_lover": "ex_lover",
        "friend": "friend",
        "colleague": "colleague",
        "family": "family",
        "none": "none",
        # 한국어 alias
        "연인": "lover",
        "짝사랑": "crush",
        "옛 연인": "ex_lover",
        "옛연인": "ex_lover",
        "전 연인": "ex_lover",
        "전연인": "ex_lover",
        "친구": "friend",
        "동료": "colleague",
        "가족": "family",
        "없음": "none",
        "단독": "none",
    }
    _rel_raw = body.relationship
    relationship_raw = (_rel_raw or "").strip()
    relationship_key = relationship_raw.lower()
    relationship = _RELATIONSHIP_ALIAS.get(relationship_key) or _RELATIONSHIP_ALIAS.get(relationship_raw)
    if relationship_raw and relationship is None:
        logger.warning(
            "[CreateMV] Unknown relationship raw='%s' — using None (auto-judgment)",
            relationship_raw,
        )
        relationship = None
    elif not relationship_raw:
        relationship = None
    logger.info(
        "[CreateMV] relationship raw='%s' normalized='%s' user=%s",
        relationship_raw or "(empty)",
        relationship or "auto",
        current_user["id"],
    )

    # v49: 사용자 사건 시드 정규화 (≤300자 trim, 빈 문자열/공백만 → None).
    # 본문은 PII 가능성 → 로그에 길이만 출력. 절대 본문 미출력.
    raw_seed = (body.user_event_seed or "").strip()
    if len(raw_seed) > 300:
        raw_seed = raw_seed[:300]
    user_event_seed = raw_seed or None
    logger.info(
        "[CreateMV] user_event_seed len=%d user=%s",
        len(user_event_seed or ""),
        current_user["id"],
    )

    # Compute dynamic scene count based on audio duration and video model
    # Veo: 8s clips, Kling: 10s, Seedance: 10s (≤15s), Grok: 10s (≤10s, v66)
    if video_model == "kling":
        SCENE_CLIP_DURATION = 10
    elif video_model == "seedance":
        SCENE_CLIP_DURATION = 10
    elif video_model == "grok":
        SCENE_CLIP_DURATION = 10
    else:
        SCENE_CLIP_DURATION = 8  # veo default
    # v209: 클라 미전송 시 track 실측 duration_sec 폴백 (generation 경로 기존 동작 불변).
    effective_audio_duration_sec = body.audio_duration_sec
    if (not effective_audio_duration_sec or effective_audio_duration_sec <= 0) and track_duration_sec:
        effective_audio_duration_sec = track_duration_sec
        logger.info(
            "[CreateMV] audio_duration_sec fallback from track_id=%s duration=%.1f",
            audio_track_id, track_duration_sec,
        )
    if effective_audio_duration_sec and effective_audio_duration_sec > 0:
        scene_count = math.ceil(effective_audio_duration_sec / SCENE_CLIP_DURATION)
        scene_count = max(5, min(scene_count, 60))
    else:
        scene_count = 20

    # 커버에 쓴 캐릭터 기준 통일: "virtual" 이면 가상 시트+가상 아이템으로 스냅샷.
    # 미전송/그 외 값은 "real" 로 정규화 (하위호환).
    character_variant = body.character_variant if body.character_variant in ("real", "virtual") else "real"

    user_character_snapshot = None
    if bool(body.include_my_character):
        # v212 — 아티스트 다중화 (PLAN D6): character_id 지정 시 해당 아티스트
        # (kind 무관), 미지정 시 기존 variant 경로를 공용 헬퍼로 해석 (동작 동등).
        from .character import _find_artist_by_cid, resolve_representative_artists

        if body.character_id and body.character_id.strip():
            artist = await _find_artist_by_cid(mongo, current_user["id"], body.character_id)
            if not artist:
                logger.warning(
                    "[MVJob] character_id not found user=%s cid=%s",
                    current_user["id"][:8], body.character_id[:36],
                )
                return JSONResponse(
                    status_code=404,
                    content={"error": "아티스트를 찾을 수 없습니다."},
                )
            snapshot_sheet = artist.get("sheet_object_name")
            snapshot_items = artist.get("used_items") or []
            snapshot_profile = artist
        else:
            reps = await resolve_representative_artists(mongo, current_user["id"])
            rep = reps.get(character_variant)
            if not rep and not reps.get("real") and not reps.get("virtual"):
                return JSONResponse(
                    status_code=400,
                    content={"error": "저장된 내 캐릭터가 없습니다. 먼저 프로필을 설정해주세요."},
                )
            snapshot_sheet = (rep or {}).get("sheet_object_name") or None
            snapshot_items = (rep or {}).get("used_items") or []
            snapshot_profile = rep or reps.get("real") or reps.get("virtual") or {}
            if character_variant == "virtual" and not snapshot_sheet:
                logger.warning(
                    "[MVJob] variant=virtual but no virtual sheet for user=%s — snapshot sheet will be None",
                    current_user["id"],
                )
        # SnapFix — 시트를 불변 경로(character_snapshots/)로 복사해 이후
        # 캐릭터 재생성/삭제로부터 격리 (best-effort, MV 생성은 절대 실패 X).
        _snapfix_copied = None
        if snapshot_sheet:
            from ..services.snapshot_service import snapshot_sheet_copy

            _snapfix_copied = snapshot_sheet_copy(get_minio(), current_user["id"], snapshot_sheet)
        user_character_snapshot = {
            "name": snapshot_profile.get("name") or "",
            "age": snapshot_profile.get("age") or "",
            "gender": snapshot_profile.get("gender") or "",  # v212 additive (무해)
            "personality_tags": snapshot_profile.get("personality_tags") or [],
            "personality_text": snapshot_profile.get("personality_text") or "",
            "sheet_object_name": _snapfix_copied or snapshot_sheet,
            "used_items": snapshot_items,
            # v212 — 사용 아티스트 추적 (legacy 대표는 None)
            "character_id": snapshot_profile.get("character_id"),
        }
        if _snapfix_copied:
            user_character_snapshot["sheet_object_name_origin"] = snapshot_sheet
        logger.info(
            "[MVJob] snapshot variant=%s cid=%s has_sheet=%s items=%d",
            character_variant,
            snapshot_profile.get("character_id") or "(legacy)",
            bool(snapshot_sheet),
            len(snapshot_items),
        )

    # v42: snapshot user-saved location (anchor for Mode B). We persist only
    # id/name/object_name on the job — bytes are loaded lazily in Phase 1.5.
    user_location_snapshot = None
    if body.location_id:
        from .character import _load_user_location

        loc = await _load_user_location(mongo, current_user["id"], body.location_id)
        if loc:
            user_location_snapshot = {
                "id": body.location_id,
                "name": loc.get("name") or "",
                "object_name": loc.get("object_name"),
            }
        else:
            logger.info(
                "create_mv: location_id=%s not found for user=%s — proceeding without location anchor",
                body.location_id, current_user["id"],
            )

    job_doc = {
        "user_id": current_user["id"],
        "title": title,
        "genre": body.genre,
        "mood": body.mood,
        "lyrics": body.lyrics,
        "cover_object_name": body.cover_object_name,
        "scene_count": scene_count,
        "audio_duration_sec": effective_audio_duration_sec,
        "scene_prompt": body.scene_prompt,
        "character_object_name": body.character_object_name,
        "video_model": video_model,
        "audio_generation_id": body.audio_generation_id,
        # v209: 「내 트랙」 곡 소스 — mv_pipeline 오디오/duration 폴백이 읽는다.
        "audio_track_id": audio_track_id,
        "scenario_models": body.scenario_models,
        "prompt_models": body.prompt_models,
        "video_prompt_model": body.video_prompt_model,
        # Drama scenario controls
        "scenario_style": scenario_style,
        "vocal_gender": vocal_gender,
        "relationship": relationship,
        "include_my_character": bool(body.include_my_character),
        # 커버에 쓴 캐릭터 기준 통일: "real" | "virtual" (추적용, 미전송=real).
        "character_variant": character_variant,
        # v212 — 사용 아티스트 추적 (미지정/legacy 는 None)
        "character_id": (user_character_snapshot or {}).get("character_id"),
        "user_character_snapshot": user_character_snapshot,
        # v63: 커버 인물 자산화 흐름 — 기본 True. include_my_character=True 일 땐
        # Phase 0/1.5 가 자동으로 무력화 (user_character 가 1/2순위 우선).
        "use_cover_person_as_character1": bool(body.use_cover_person_as_character1),
        # v42: persist the user-location snapshot so Phase 0/1/1.5 can read it
        "user_location_snapshot": user_location_snapshot,
        # v49: 사용자 사건 시드 (≤300자, None=시드 없음). Phase 0 가 brainstorm/Stage 2 호출에 throughput.
        "user_event_seed": user_event_seed,
        # v55: 씬+자산 공통 이미지 생성 모델 (default "nb_pro").
        "image_model": norm_image_model,
        # v55: 커버 생성 시 사용된 모델 (스냅샷, 미지정 시 None).
        "cover_image_model": norm_cover_image_model,
        "scenario": None,
        "scenario_meta": None,
        "status": "draft",
        "progress": 0,
        "error_message": "",
        "total_scenes": 0,
        "scenes": [],
        "completed_image_count": 0,
        "completed_video_count": 0,
        "result_video_url": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    result = await mongo.mv_jobs.insert_one(job_doc)
    job_id = result.inserted_id

    # SnapFix — 스냅샷 시트 불변 사본 결과 추적 로그 (job id 확정 후).
    if user_character_snapshot is not None and user_character_snapshot.get("sheet_object_name"):
        logger.info(
            "[SnapFix] mv job=%s user=%s copied=%s",
            str(job_id), current_user["id"],
            bool(user_character_snapshot.get("sheet_object_name_origin")),
        )

    # Launch phase 1 + phase 2 combined in background
    background_tasks.add_task(run_phase1_and_phase2, job_id, mongo)

    return {
        "job_id": str(job_id),
        "status": "splitting",
        "message": "MV 작업이 생성되었습니다. 장면 분할 및 이미지 생성이 시작됩니다.",
    }


# ── GET /api/mv/jobs ─────────────────────────────────────────────────────────

@router.get("/jobs")
async def list_mv_jobs(
    page: int = 1,
    limit: int = 20,
    current_user=Depends(get_current_user),
):
    """List user's MV jobs."""
    mongo = get_mongo()
    user_id = current_user["id"]

    skip = (max(page, 1) - 1) * limit
    limit = min(max(limit, 1), 100)

    cursor = mongo.mv_jobs.find(
        {"user_id": user_id},
    ).sort("created_at", -1).skip(skip).limit(limit)
    raw_jobs = await cursor.to_list(length=limit)

    # v211 — 부착 곡 정보 배치 조회 (tracks·generations 각 $in 1회, N+1 회피)
    _att_tids = [
        ObjectId(j["attached_track_id"]) for j in raw_jobs
        if j.get("attached_track_id") and ObjectId.is_valid(j["attached_track_id"])
    ]
    _att_gids = [
        ObjectId(j["attached_generation_id"]) for j in raw_jobs
        if j.get("attached_generation_id") and ObjectId.is_valid(j["attached_generation_id"])
    ]
    _track_map: dict = {}
    _gen_map: dict = {}
    if _att_tids:
        async for _t in mongo.tracks.find({"_id": {"$in": _att_tids}}, {"title": 1}):
            _track_map[str(_t["_id"])] = _t
    if _att_gids:
        async for _g in mongo.generations.find({"_id": {"$in": _att_gids}}, {"title": 1}):
            _gen_map[str(_g["_id"])] = _g

    def _attachment_summary(job: dict) -> dict:
        """state: released/unreleased/none + broken(타겟 실종 — 떼기 유도)."""
        att_tid = job.get("attached_track_id")
        att_gid = job.get("attached_generation_id")
        if att_tid:
            _trk = _track_map.get(att_tid)
            return {
                "state": "released" if _trk else "broken",
                "song_id": att_tid,
                "song_title": (_trk or {}).get("title") or "",
            }
        if att_gid:
            _gen = _gen_map.get(att_gid)
            return {
                "state": "unreleased" if _gen else "broken",
                "song_id": att_gid,
                "song_title": (_gen or {}).get("title") or "",
            }
        return {"state": "none", "song_id": None, "song_title": None}

    jobs = []
    for job in raw_jobs:
        # Get first scene thumbnail
        thumbnail_url = None
        scenes = job.get("scenes", [])
        if scenes:
            for s in scenes:
                if s.get("image_object_name"):
                    thumbnail_url = browser_image_url(s["image_object_name"])
                    break

        # Fall back to cover image if no scene thumbnail yet
        if not thumbnail_url and job.get("cover_object_name"):
            thumbnail_url = browser_image_url(job["cover_object_name"])

        jobs.append({
            "job_id": str(job["_id"]),
            "title": job.get("title", ""),
            "status": job.get("status", "draft"),
            "progress": job.get("progress", 0),
            "total_scenes": job.get("total_scenes", 0),
            "completed_image_count": job.get("completed_image_count", 0),
            "completed_video_count": job.get("completed_video_count", 0),
            "cover_object_name": job.get("cover_object_name"),
            "thumbnail_url": thumbnail_url,
            "result_video_url": browser_video_url(job.get("result_video_url")),
            "result_music_video_url": browser_video_url(job.get("result_music_video_url")),
            "error_message": job.get("error_message", ""),
            # v211 — 소스 곡 + 부착 상태 (내 MV 리스트 배지/버튼 재료)
            "audio_track_id": job.get("audio_track_id"),
            "audio_generation_id": job.get("audio_generation_id"),
            "attached_track_id": job.get("attached_track_id"),
            "attached_generation_id": job.get("attached_generation_id"),
            "attached_at": job.get("attached_at").isoformat() if job.get("attached_at") else None,
            "attachment": _attachment_summary(job),
            "created_at": job.get("created_at", "").isoformat() if job.get("created_at") else None,
            "updated_at": job.get("updated_at", "").isoformat() if job.get("updated_at") else None,
        })

    total = await mongo.mv_jobs.count_documents({"user_id": user_id})

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "limit": limit,
    }


# ── v56 — Lazy translation for ko/en sibling fields ─────────────────────────
# 옛 잡 (image_prompt_ko / video_prompt_ko 없음) 또는 한 방향만 채워진 씬을
# GET 응답 시점에 자동 번역하여 Mongo 영구 저장 + 응답 포함. 한 번 채워지면
# 다음 GET 부터 캐싱 (재번역 X).

_V56_KO_EN_PAIRS = [
    # (ko_field, en_field, context_hint)
    ("description_ko", "description", "MV scene description"),
    ("image_prompt_ko", "image_prompt", "MV scene image prompt"),
    ("video_prompt_ko", "video_prompt", "MV scene video prompt"),
]


async def _v56_lazy_translate_scenes(mongo_db, oid: ObjectId, scenes: list) -> None:
    """씬 list 를 in-place 갱신. 빈 _ko / 빈 _en 을 자동 번역하고 Mongo $set 영구 저장.

    다중 씬 다중 필드 모두 asyncio.gather 로 병렬 번역. translation.py 가 빈 입력
    → 빈 출력으로 비용 0 보장하므로 안전. 한 번 채워지면 캐싱 (재번역 X).
    """
    import asyncio as _asyncio
    import time as _time
    from ..services.translation import translate_ko_to_en, translate_en_to_ko

    tasks = []  # (scene_idx, field, target_field, coro)

    for idx, scene in enumerate(scenes or []):
        if not isinstance(scene, dict):
            continue
        for ko_field, en_field, hint in _V56_KO_EN_PAIRS:
            ko_val = (scene.get(ko_field) or "").strip()
            en_val = (scene.get(en_field) or "").strip()
            if not ko_val and en_val:
                # en → ko (fill ko)
                tasks.append((idx, ko_field, en_field, translate_en_to_ko(en_val, hint)))
            elif ko_val and not en_val:
                # ko → en (fill en)
                tasks.append((idx, en_field, ko_field, translate_ko_to_en(ko_val, hint)))
            # else: both empty (nothing to translate) or both filled (cache hit, skip)

    if not tasks:
        return

    t0 = _time.time()
    coros = [t[3] for t in tasks]
    results = await _asyncio.gather(*coros, return_exceptions=True)
    elapsed_ms = int((_time.time() - t0) * 1000)

    # Group by scene_idx for batched $set per scene.
    set_by_idx: dict = {}
    fields_by_idx: dict = {}
    for (scene_idx, target_field, source_field, _coro), res in zip(tasks, results):
        if isinstance(res, Exception):
            logger.warning(
                "[GETJob] lazy_translate failed scene_idx=%d target=%s err=%s",
                scene_idx, target_field, str(res)[:200],
            )
            continue
        translated = (res or "").strip()
        if not translated:
            # Translation returned empty (LLM failure or empty input safeguard) — skip persist.
            continue
        # Bounds check: scene_idx must be valid for the in-memory scenes list.
        if not (0 <= scene_idx < len(scenes)):
            continue
        scenes[scene_idx][target_field] = translated
        set_by_idx.setdefault(scene_idx, {})[target_field] = translated
        fields_by_idx.setdefault(scene_idx, []).append(target_field)

    # Persist per scene with positional $set.
    for scene_idx, fields_set in set_by_idx.items():
        update = {"updated_at": datetime.utcnow()}
        for f, v in fields_set.items():
            update["scenes.{}.{}".format(scene_idx, f)] = v
        try:
            await mongo_db.mv_jobs.update_one({"_id": oid}, {"$set": update})
        except Exception as e:
            logger.warning(
                "[GETJob] lazy_translate persist failed scene_idx=%d err=%s",
                scene_idx, str(e)[:200],
            )

    if fields_by_idx:
        logger.info(
            "[GETJob] lazy_translate scenes=%d fields_total=%d elapsed_ms=%d",
            len(fields_by_idx), sum(len(v) for v in fields_by_idx.values()), elapsed_ms,
        )


# ── GET /api/mv/jobs/{job_id} ────────────────────────────────────────────────

@router.get("/jobs/{job_id}")
async def get_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Get full job details with all scenes."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    # v56 — Lazy ko/en translation. In-place mutates scenes list + persists to Mongo.
    # Empty input → empty output (LLM call skipped), so no-op for fully-populated jobs.
    try:
        await _v56_lazy_translate_scenes(mongo, oid, job.get("scenes") or [])
    except Exception as _lazy_err:
        logger.warning("[GETJob] lazy_translate top-level error: %s", str(_lazy_err)[:200])

    scenes_response = [_scene_to_dict(s) for s in job.get("scenes", [])]

    return {
        "job_id": str(job["_id"]),
        "title": job.get("title", ""),
        "genre": job.get("genre"),
        "mood": job.get("mood"),
        "lyrics": job.get("lyrics"),
        "cover_object_name": job.get("cover_object_name"),
        "cover_url": browser_image_url(job.get("cover_object_name")),
        # v61: Phase 1.5 에서 생성된 주인공/장소 자산 — presigned image_url 포함.
        "assets": _serialize_assets(job.get("assets")),
        "status": job.get("status", "draft"),
        "progress": job.get("progress", 0),
        "error_message": job.get("error_message", ""),
        "total_scenes": job.get("total_scenes", 0),
        "completed_image_count": job.get("completed_image_count", 0),
        "completed_video_count": job.get("completed_video_count", 0),
        "scenes": scenes_response,
        "result_video_url": browser_video_url(job.get("result_video_url")),
        "result_object_name": job.get("result_video_url"),
        "result_music_video_url": browser_video_url(job.get("result_music_video_url")),
        "result_music_video_object_name": job.get("result_music_video_url"),
        "retry_info": job.get("retry_info"),
        "synclabs_total": job.get("synclabs_total"),
        "synclabs_completed": job.get("synclabs_completed"),
        "scenario": job.get("scenario"),
        "scenario_meta": job.get("scenario_meta"),
        "scenario_style": job.get("scenario_style", "drama"),
        # v45: Stage 1 brainstorm + Stage 2 separated fields + events.
        # All optional — older jobs (without these) return None/[]/{} so the frontend
        # can fallback to legacy `scenario` body.
        "scenario_narrative": job.get("scenario_narrative"),
        "scenario_premise": job.get("scenario_premise"),
        "scenario_character_states": job.get("scenario_character_states") or {},
        "scenario_central_conflict": job.get("scenario_central_conflict"),
        "scenario_emotional_core": job.get("scenario_emotional_core"),
        "scenario_narrative_arc": job.get("scenario_narrative_arc") or {},
        # v52: scenario_events 응답 시 각 event 의 user_edited_fields 기본값 처리.
        # 옛 도큐먼트 (이 키 없음) → 빈 배열 부여로 backward-compat 보장.
        "scenario_events": [
            (lambda _ev: {**_ev, "user_edited_fields": _ev.get("user_edited_fields") or []})(_e)
            for _e in (job.get("scenario_events") or [])
        ],
        "scenario_brainstorm": job.get("scenario_brainstorm") or {},
        # v46: LLM 자율 판단한 등장인물 관계 (사용자 미명시 시). 명시 시 None.
        "scenario_inferred_relationship": job.get("scenario_inferred_relationship"),
        # v47: Stage 2 가 어떤 brainstorm plot_archetype 을 채택했는지. 옛 잡엔 None.
        "scenario_selected_archetype": job.get("scenario_selected_archetype"),
        # v48: 곡 톤·장르 분석 결과 archetype 가중치 dict (합=1.0). 옛 잡엔 None.
        "scenario_archetype_weights": job.get("scenario_archetype_weights"),
        # v49: 사용자 사건 시드 (≤300자, None=시드 없음). 옛 잡엔 None.
        "user_event_seed": job.get("user_event_seed"),
        # v55: 씬+자산 공통 이미지 생성 모델 (옛 잡엔 "nb_pro" 기본).
        "image_model": job.get("image_model") or "nb_pro",
        # v55: 커버 생성 모델 (옛 잡엔 None — 미스냅샷).
        "cover_image_model": job.get("cover_image_model"),
        # v53: 시나리오 상위 편집 추적 / 전체 cascade 진행 상태. 옛 잡엔 기본값.
        "scenario_user_edited_fields": job.get("scenario_user_edited_fields") or [],
        "cascade_phase": job.get("cascade_phase"),
        "cascade_progress": int(job.get("cascade_progress") or 0),
        "cascade_started_at": (
            job.get("cascade_started_at").isoformat()
            if job.get("cascade_started_at") else None
        ),
        "cascade_completed_at": (
            job.get("cascade_completed_at").isoformat()
            if job.get("cascade_completed_at") else None
        ),
        "cancel_requested": bool(job.get("cancel_requested")),
        "cascade_id": job.get("cascade_id"),
        # scenes_archive 는 GET 응답엔 미노출 (별도 향후 라우트). 길이만 노출.
        "scenes_archive_count": len(job.get("scenes_archive") or []),
        "vocal_gender": job.get("vocal_gender"),
        "relationship": job.get("relationship"),
        "include_my_character": job.get("include_my_character", False),
        "scene_prompt": job.get("scene_prompt"),
        "character_object_name": job.get("character_object_name"),
        "video_model": job.get("video_model", "veo"),
        "music_sections": job.get("music_sections"),
        # v43: 자막 가용 여부 (Suno 트랙=True, 직접 업로드 트랙=False)
        "has_subtitles": bool(
            job.get("has_subtitles")
            if job.get("has_subtitles") is not None
            else (job.get("lyric_timestamps") or job.get("whisper_segments"))
        ),
        # v211 — 부착 상태 (mvStep 6 배지/버튼)
        "attached_track_id": job.get("attached_track_id"),
        "attached_generation_id": job.get("attached_generation_id"),
        "attached_at": job.get("attached_at").isoformat() if job.get("attached_at") else None,
        # Draft form fields (for restoring the upload page)
        "audio_generation_id": job.get("audio_generation_id"),
        # v209: 「내 트랙」 곡 소스 복원 관통 (handleLoadDraft → MV촬영실)
        "audio_track_id": job.get("audio_track_id"),
        "audio_file_name": job.get("audio_file_name"),
        "tags": job.get("tags"),
        "prompt": job.get("prompt"),
        "ai_model": job.get("ai_model"),
        "created_at": job.get("created_at", "").isoformat() if job.get("created_at") else None,
        "updated_at": job.get("updated_at", "").isoformat() if job.get("updated_at") else None,
    }


# ── POST /api/mv/jobs/{job_id}/generate-images ──────────────────────────────

@router.post("/jobs/{job_id}/generate-images")
async def generate_images(
    job_id: str,
    body: GenerateImagesRequest = GenerateImagesRequest(),
    background_tasks: BackgroundTasks = None,
    current_user=Depends(get_current_user),
):
    """Generate images for scenes without images (or regenerate specific scenes)."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("scenes"):
        return JSONResponse(
            status_code=400,
            content={"error": "장면 데이터가 없습니다. 먼저 장면 분할을 실행하세요."},
        )

    if body.scene_numbers is None:
        failed_count = sum(
            1 for s in job.get("scenes", [])
            if not s.get("image_object_name")
        )
        logger.info("[BatchImage] job=%s failed_count=%d", str(oid), failed_count)

    background_tasks.add_task(run_phase2_images, oid, mongo, body.scene_numbers)

    return {
        "job_id": job_id,
        "status": "generating_images",
        "message": "이미지 생성이 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/upload-image ────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/upload-image")
async def upload_scene_image(
    job_id: str,
    scene_number: int,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload custom image for a scene."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes", [])
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break

    if scene_idx is None:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 장면을 찾을 수 없습니다."},
        )

    # Validate file
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    # Save to MinIO
    object_name = "mv/{}/scenes/{:03d}.png".format(str(oid), scene_number)
    minio_client = get_minio()
    content_type = "image/png" if ext == ".png" else "image/jpeg"

    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Update scene
    scenes[scene_idx]["image_object_name"] = object_name
    scenes[scene_idx]["image_source"] = "upload"

    # If scene already has a completed video, reset video_status
    if scenes[scene_idx].get("video_status") == "completed":
        scenes[scene_idx]["video_status"] = "pending"
        scenes[scene_idx]["video_object_name"] = None
        scenes[scene_idx]["video_error"] = None

    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "scene_number": scene_number,
        "image_object_name": object_name,
        "image_url": browser_image_url(object_name),
        "message": "이미지가 업로드되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/regenerate-image ────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/regenerate-image")
async def regenerate_scene_image_endpoint(
    job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    """Regenerate single scene image (synchronous)."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes", [])
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break

    if scene_idx is None:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 장면을 찾을 수 없습니다."},
        )

    # Load cover image for style reference
    cover_image_bytes = None
    if job.get("cover_object_name"):
        try:
            minio_client = get_minio()
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=job["cover_object_name"],
            )
            cover_image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Failed to load cover image: %s", e)

    # Load character image for character reference
    character_image_bytes = None
    if job.get("character_object_name"):
        try:
            if not minio_client:
                minio_client = get_minio()
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=job["character_object_name"],
            )
            character_image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Failed to load character image: %s", e)

    # Resolve @character1/@location1 references → attach matching asset bytes
    from ..services.mv_assets import parse_asset_references, load_asset_from_minio
    scene_refs: list = []
    assets_meta = job.get("assets") or {}
    if assets_meta:
        scene_desc_combined = "{} {}".format(
            scenes[scene_idx].get("image_prompt", "") or "",
            scenes[scene_idx].get("video_image_prompt", "") or "",
        )
        for _key in parse_asset_references(scene_desc_combined):
            _a = assets_meta.get(_key)
            if isinstance(_a, dict) and _a.get("object_name"):
                _b = load_asset_from_minio(_a["object_name"])
                if _b:
                    scene_refs.append(_b)

    # Generate image (synchronous — single image-model call)
    # v55: image_model 은 job 단위 (씬+자산 공통). 옛 도큐먼트는 nb_pro 기본.
    _img_model_regen = (job.get("image_model") or "nb_pro").strip() or "nb_pro"
    try:
        scene_desc = scenes[scene_idx].get("image_prompt") or scenes[scene_idx].get("description", "")
        img_bytes = await generate_scene_image(
            scene_desc,
            cover_image_bytes=cover_image_bytes,
            character_image_bytes=character_image_bytes,
            scene_type=scenes[scene_idx].get("scene_type", "drama"),
            reference_images=scene_refs or None,
            image_model=_img_model_regen,
            scene_number=scene_number,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 생성 실패: {}".format(str(e)[:200])},
        )

    # Save to MinIO
    object_name = "mv/{}/scenes/{:03d}.png".format(str(oid), scene_number)
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(img_bytes),
        length=len(img_bytes),
        content_type="image/png",
    )

    # Update scene
    scenes[scene_idx]["image_object_name"] = object_name
    scenes[scene_idx]["image_source"] = "gemini"

    # Reset video if it was completed (image changed)
    if scenes[scene_idx].get("video_status") == "completed":
        scenes[scene_idx]["video_status"] = "pending"
        scenes[scene_idx]["video_object_name"] = None
        scenes[scene_idx]["video_error"] = None

    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "scene_number": scene_number,
        "image_object_name": object_name,
        "image_url": browser_image_url(object_name),
        "message": "이미지가 재생성되었습니다.",
    }


# ── v51: PATCH scene field (description / image_prompt / video_prompt) ──────

@router.patch("/jobs/{job_id}/scenes/{scene_number}")
async def patch_scene(
    job_id: str,
    scene_number: int,
    body: PatchSceneRequest,
    current_user=Depends(get_current_user),
):
    """v51 — 씬 카드 안의 description / image_prompt / video_prompt 부분 업데이트.

    사용자가 보낸 필드만 갱신하고 user_edited_fields 에 누적(중복 제거).
    Cascade 는 별도 호출 (POST /cascade-regenerate). 여기서는 텍스트 갱신만.
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    # 보내진 필드 추출 (None 이 아닌 것만)
    payload = body.dict(exclude_none=True)
    # v56 — accept both English (legacy v51) and Korean (`_ko`) sibling fields.
    allowed = {
        "description", "image_prompt", "video_prompt",
        "description_ko", "image_prompt_ko", "video_prompt_ko",
    }
    payload = {k: v for k, v in payload.items() if k in allowed}
    if not payload:
        raise HTTPException(
            status_code=400,
            detail="최소 1개 필드(description / image_prompt / video_prompt 또는 *_ko)가 필요합니다.",
        )

    # 씬 위치 찾기
    scenes = job.get("scenes") or []
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break
    if scene_idx is None:
        raise HTTPException(status_code=404, detail="해당 장면을 찾을 수 없습니다.")

    # user_edited_fields 누적 (중복 제거, 순서 유지)
    cur_edited = list(scenes[scene_idx].get("user_edited_fields") or [])
    for k in payload.keys():
        if k not in cur_edited:
            cur_edited.append(k)

    # 필드 업데이트 (positional $set 으로 다른 씬 영향 없음)
    set_fields = {}
    for k, v in payload.items():
        set_fields[k] = v
    set_fields["user_edited_fields"] = cur_edited
    await _v51_set_scene_fields(mongo, oid, scene_idx, set_fields)

    logger.info(
        "[CascadePatch] job=%s scene=%d fields=%s",
        str(oid), scene_number, sorted(payload.keys()),
    )

    # 갱신된 씬 다시 읽어 응답
    updated_scene = await _v51_get_scene(mongo, oid, scene_idx)
    return {
        "scene_number": scene_number,
        "updated_fields": sorted(payload.keys()),
        "user_edited_fields": cur_edited,
        "scene": _scene_to_dict(updated_scene or scenes[scene_idx]),
    }


# ── v51: Cascade regenerate (start background cascade) ──────────────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/cascade-regenerate")
async def cascade_regenerate_scene(
    job_id: str,
    scene_number: int,
    body: CascadeRegenerateRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """v51 — 씬 단위 부분 cascade 시작 (백그라운드).

    trigger_field:
      - "description"  → phase1b → phase2 → phase2.5 (progress 0/33/66/100)
      - "image_prompt" → phase2 → phase2.5 (progress 0/50/100)
      - "video_prompt" → no-op (즉시 completed)

    이미 진행 중인 cascade 가 있으면 409.
    """
    import uuid as _uuid_mv

    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    trigger_field = (body.trigger_field or "").strip()
    # v56 — accept _ko variants. Backend translates ko→en then runs the English cascade.
    _ALLOWED_TRIGGERS = {
        "description", "image_prompt", "video_prompt",
        "description_ko", "image_prompt_ko", "video_prompt_ko",
    }
    if trigger_field not in _ALLOWED_TRIGGERS:
        raise HTTPException(
            status_code=400,
            detail="trigger_field 는 description / image_prompt / video_prompt 또는 *_ko 변형이어야 합니다.",
        )

    # 씬 위치
    scenes = job.get("scenes") or []
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break
    if scene_idx is None:
        raise HTTPException(status_code=404, detail="해당 장면을 찾을 수 없습니다.")

    # 이미 running 인지 체크
    cur_status = (scenes[scene_idx].get("cascade_status") or "idle")
    if cur_status == "running":
        raise HTTPException(status_code=409, detail="이미 이 씬에 cascade 작업이 진행 중입니다.")

    cascade_id = str(_uuid_mv.uuid4())
    # v56 — estimated_phases for ko triggers (translate phase prefixed).
    if trigger_field == "description":
        estimated_phases = ["phase1b", "phase2", "phase2.5"]
    elif trigger_field == "image_prompt":
        estimated_phases = ["phase2", "phase2.5"]
    elif trigger_field == "description_ko":
        estimated_phases = ["translate_description_to_en", "phase1b", "phase2", "phase2.5"]
    elif trigger_field == "image_prompt_ko":
        estimated_phases = ["translate_image_prompt_to_en", "phase2", "phase2.5"]
    elif trigger_field == "video_prompt_ko":
        estimated_phases = ["translate_video_prompt_to_en"]
    else:
        # "video_prompt" (English) — no cascade
        estimated_phases = []

    # 시작 마킹 (running) — 백그라운드 작업 안에서 다시 set 하지만, 즉시
    # 클라이언트가 폴링해도 running 으로 보이도록 여기서도 미리 세팅.
    # v56 — video_prompt (en) only is the truly no-op case. video_prompt_ko triggers a
    # translation phase so it is "running" briefly.
    if trigger_field != "video_prompt":
        await _v51_set_scene_fields(mongo, oid, scene_idx, {
            "cascade_status": "running",
            "cascade_progress": 0,
            "cascade_started_at": datetime.utcnow(),
            "cascade_completed_at": None,
            "cascade_id": cascade_id,
            "cancel_requested": False,
        })

    logger.info(
        "[CascadeRegen] job=%s scene=%d trigger_field=%s cascade_id=%s",
        str(oid), scene_number, trigger_field, cascade_id,
    )

    # 백그라운드 launch
    background_tasks.add_task(_v51_run_cascade, oid, scene_number, mongo, trigger_field)

    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "scene_number": scene_number,
            "cascade_id": cascade_id,
            "trigger_field": trigger_field,
            "estimated_phases": estimated_phases,
        },
    )


# ── v51: Cancel cascade ─────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/cancel-cascade")
async def cancel_scene_cascade(
    job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    """v51 — 진행 중인 cascade 에 취소 신호. 백그라운드 헬퍼가 다음 phase
    진입 시 체크하여 cascade_status="cancelled" 로 마킹.

    이미 completed/cancelled/idle 인 경우 idempotent (현재 상태만 반환).
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes") or []
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break
    if scene_idx is None:
        raise HTTPException(status_code=404, detail="해당 장면을 찾을 수 없습니다.")

    cur_status = scenes[scene_idx].get("cascade_status") or "idle"
    if cur_status == "running":
        await _v51_set_scene_fields(mongo, oid, scene_idx, {"cancel_requested": True})

    logger.info("[CascadeCancel] job=%s scene=%d", str(oid), scene_number)

    # 갱신된 씬 다시 읽어 응답
    updated_scene = await _v51_get_scene(mongo, oid, scene_idx)
    return {
        "scene_number": scene_number,
        "cancel_requested": bool(updated_scene and updated_scene.get("cancel_requested")),
        "cascade_status": (updated_scene or {}).get("cascade_status") or cur_status,
    }


# ── v52: PATCH scenario event field (5-field partial) ───────────────────────

@router.patch("/jobs/{job_id}/scenario/events/{order}")
async def patch_scenario_event(
    job_id: str,
    order: int,
    body: PatchScenarioEventRequest,
    current_user=Depends(get_current_user),
):
    """v52 — scenario_events[order-1] 의 5개 필드 (trigger / protagonist_action /
    motivation / emotion_shift / props) 부분 업데이트.

    사용자가 보낸 필드만 갱신하고 event.user_edited_fields 에 누적(중복 제거).
    Cascade 는 별도 호출 (POST /cascade-regenerate). 여기서는 텍스트 갱신만.
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    # 보내진 필드 추출 (None 이 아닌 것만)
    payload = body.dict(exclude_none=True)
    allowed = {"trigger", "protagonist_action", "motivation", "emotion_shift", "props"}
    payload = {k: v for k, v in payload.items() if k in allowed}
    if not payload:
        raise HTTPException(
            status_code=400,
            detail="최소 1개 필드(trigger / protagonist_action / motivation / emotion_shift / props)가 필요합니다.",
        )

    # order 유효성 + event 위치
    events = job.get("scenario_events") or []
    if order < 1 or order > len(events):
        raise HTTPException(status_code=404, detail="해당 사건(event)을 찾을 수 없습니다.")
    event_idx = order - 1

    # event.user_edited_fields 누적 (중복 제거, 순서 유지)
    cur_edited = list(events[event_idx].get("user_edited_fields") or [])
    for k in payload.keys():
        if k not in cur_edited:
            cur_edited.append(k)

    # 필드 업데이트 — positional $set 으로 다른 event 영향 없음
    update = {"updated_at": datetime.utcnow()}
    for k, v in payload.items():
        update["scenario_events.{}.{}".format(event_idx, k)] = v
    update["scenario_events.{}.user_edited_fields".format(event_idx)] = cur_edited
    await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    logger.info(
        "[EventPatch] job=%s event_order=%d fields=%s",
        str(oid), order, sorted(payload.keys()),
    )

    # 갱신된 event 다시 읽어 응답
    updated_job = await mongo.mv_jobs.find_one(
        {"_id": oid}, {"scenario_events": 1},
    )
    updated_events = (updated_job or {}).get("scenario_events") or []
    updated_event = updated_events[event_idx] if 0 <= event_idx < len(updated_events) else events[event_idx]
    # backward-compat 기본값 부여
    updated_event_resp = {**updated_event, "user_edited_fields": updated_event.get("user_edited_fields") or []}

    return {
        "event_order": order,
        "updated_fields": sorted(payload.keys()),
        "user_edited_fields": cur_edited,
        "event": updated_event_resp,
    }


# ── v52: Cascade regenerate — fan out to mapped scenes ──────────────────────

@router.post("/jobs/{job_id}/scenario/events/{order}/cascade-regenerate")
async def cascade_regenerate_scenario_event(
    job_id: str,
    order: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """v52 — event 단위 cascade 시작. event 에 매핑된 모든 씬 (scene.event_index ===
    order-1) 에 대해 v51 의 cascade(trigger_field="description") 를 순차 실행.

    응답은 즉시 반환 — 실제 cascade 는 백그라운드 task. 매핑된 씬 0개여도 200 +
    affected_scenes=[] 반환 (에러 X — UX 단순화).
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    events = job.get("scenario_events") or []
    if order < 1 or order > len(events):
        raise HTTPException(status_code=404, detail="해당 사건(event)을 찾을 수 없습니다.")

    # 매핑된 씬 식별 (응답에 즉시 포함)
    affected = await _v52_get_affected_scenes(mongo, oid, order)

    # 각 매핑 씬에 대해 미리 cascade_status="running" 으로 마킹 — 프론트가 즉시
    # 폴링해도 running 으로 보이도록. user_edited_fields 에 "description" 있으면
    # 미리 마킹하지 않고 백그라운드에서 즉시 completed 처리.
    if affected:
        for sn in affected:
            sidx = await _v51_get_scene_idx(mongo, oid, sn)
            if sidx is None:
                continue
            scene = await _v51_get_scene(mongo, oid, sidx)
            if not scene:
                continue
            # 이미 description 사용자 편집 씬은 cascade skip — 미리 마킹 X
            if "description" in (scene.get("user_edited_fields") or []):
                continue
            # 이미 running 인 씬은 skip
            if (scene.get("cascade_status") or "idle") == "running":
                continue
            await _v51_set_scene_fields(mongo, oid, sidx, {
                "cascade_status": "running",
                "cascade_progress": 0,
                "cascade_started_at": datetime.utcnow(),
                "cascade_completed_at": None,
                "cancel_requested": False,
            })

    logger.info(
        "[EventCascade] job=%s event_order=%d affected_scenes=%s (accepted)",
        str(oid), order, affected,
    )

    # 백그라운드 launch
    background_tasks.add_task(_v52_event_cascade, oid, order, mongo)

    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "event_order": order,
            "affected_scenes": affected,
        },
    )


# ── v52: Cancel event cascade — fan out to mapped scenes ────────────────────

@router.post("/jobs/{job_id}/scenario/events/{order}/cancel-cascade")
async def cancel_scenario_event_cascade(
    job_id: str,
    order: int,
    current_user=Depends(get_current_user),
):
    """v52 — event 의 매핑된 씬들에 일괄 취소 신호. running 인 씬만 cancel_requested=True
    로 마킹 (idempotent).
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    events = job.get("scenario_events") or []
    if order < 1 or order > len(events):
        raise HTTPException(status_code=404, detail="해당 사건(event)을 찾을 수 없습니다.")

    cancelled = await _v52_cancel_event_cascade(mongo, oid, order)
    return {
        "event_order": order,
        "cancelled_scenes": cancelled,
    }


# ── v53: PATCH scenario top-level fields (B1) ───────────────────────────────

# 시나리오 상위 6개 필드 (narrative / premise / character_states / central_conflict /
# emotional_core / narrative_arc) 부분 수정. 사용자가 보낸 필드만 갱신하고
# scenario_user_edited_fields 에 누적(중복 제거). Cascade 자동 시작 X — 별도
# `/scenario/cascade-regenerate` 호출.

_V53_SCENARIO_TOP_FIELDS = (
    "narrative",
    "premise",
    "character_states",
    "central_conflict",
    "emotional_core",
    "narrative_arc",
)


def _v53_normalize_scenario_payload(payload: dict) -> dict:
    """B1 — 입력 dict 검증 + 정규화. dict 가 아닌 값은 400.

    string 필드: trim 만 (빈 문자열도 허용 — 사용자 의도 보존).
    dict 필드: 비-dict 시 400. dict 안의 키/값 검증은 가벼움 (자유 schema).
    """
    out = {}
    for k in ("narrative", "premise", "central_conflict", "emotional_core"):
        if k in payload and payload[k] is not None:
            v = payload[k]
            if not isinstance(v, str):
                raise HTTPException(
                    status_code=400,
                    detail="필드 '{}' 는 문자열이어야 합니다.".format(k),
                )
            out[k] = v
    for k in ("character_states", "narrative_arc"):
        if k in payload and payload[k] is not None:
            v = payload[k]
            if not isinstance(v, dict):
                raise HTTPException(
                    status_code=400,
                    detail="필드 '{}' 는 dict 이어야 합니다.".format(k),
                )
            out[k] = v
    return out


@router.patch("/jobs/{job_id}/scenario")
async def patch_scenario(
    job_id: str,
    body: PatchScenarioRequest,
    current_user=Depends(get_current_user),
):
    """v53 — 시나리오 상위 6개 필드 부분 갱신.

    사용자가 보낸 필드만 Mongo `scenario_<field>` 키에 매핑하여 갱신하고
    scenario_user_edited_fields 에 누적(중복 제거).
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    payload = body.dict(exclude_none=True)
    normalized = _v53_normalize_scenario_payload(payload)
    if not normalized:
        raise HTTPException(
            status_code=400,
            detail="최소 1개 필드(narrative / premise / character_states / central_conflict / emotional_core / narrative_arc)가 필요합니다.",
        )

    cur_edited = list(job.get("scenario_user_edited_fields") or [])
    for k in normalized.keys():
        if k not in cur_edited:
            cur_edited.append(k)

    update = {
        "scenario_user_edited_fields": cur_edited,
        "updated_at": datetime.utcnow(),
    }
    for k, v in normalized.items():
        update["scenario_" + k] = v

    await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    logger.info(
        "[ScenarioPatch] job=%s fields=%s",
        str(oid), sorted(normalized.keys()),
    )

    updated = await mongo.mv_jobs.find_one(
        {"_id": oid},
        {
            "scenario_narrative": 1, "scenario_premise": 1,
            "scenario_character_states": 1, "scenario_central_conflict": 1,
            "scenario_emotional_core": 1, "scenario_narrative_arc": 1,
            "scenario_user_edited_fields": 1,
        },
    ) or {}

    return {
        "updated_fields": sorted(normalized.keys()),
        "scenario_user_edited_fields": cur_edited,
        "scenario_narrative": updated.get("scenario_narrative"),
        "scenario_premise": updated.get("scenario_premise"),
        "scenario_character_states": updated.get("scenario_character_states") or {},
        "scenario_central_conflict": updated.get("scenario_central_conflict"),
        "scenario_emotional_core": updated.get("scenario_emotional_core"),
        "scenario_narrative_arc": updated.get("scenario_narrative_arc") or {},
    }


# ── v53: PATCH scenario events array (B2) ───────────────────────────────────


def _v53_normalize_events_array(events: list) -> list:
    """B2 — events 배열 정규화. order 자동 재계산 + 빈 값 안전 처리.

    각 event 의 trigger / protagonist_action / motivation / emotion_shift 가 None 이면
    빈 string. props 가 None 이면 빈 list. 그 외 키 (user_edited_fields 등) 는 그대로 보존.
    section / order 외 unknown 키도 그대로 통과 (forward-compat).
    """
    out = []
    for i, ev in enumerate(events):
        if not isinstance(ev, dict):
            raise HTTPException(
                status_code=400,
                detail="events[{}] 는 dict 이어야 합니다.".format(i),
            )
        norm = dict(ev)
        norm["order"] = i + 1  # 자동 재계산
        for k in ("trigger", "protagonist_action", "motivation", "emotion_shift"):
            v = norm.get(k)
            if v is None:
                norm[k] = ""
            elif not isinstance(v, str):
                raise HTTPException(
                    status_code=400,
                    detail="events[{}].{} 는 문자열이어야 합니다.".format(i, k),
                )
        props = norm.get("props")
        if props is None:
            norm["props"] = []
        elif isinstance(props, list):
            # 항목이 string 이 아닌 것은 str() 강제. 빈 문자열은 허용.
            norm["props"] = [p if isinstance(p, str) else str(p) for p in props]
        else:
            raise HTTPException(
                status_code=400,
                detail="events[{}].props 는 list[str] 이어야 합니다.".format(i),
            )
        # user_edited_fields 보존 (없으면 빈 list)
        uef = norm.get("user_edited_fields")
        norm["user_edited_fields"] = uef if isinstance(uef, list) else []
        out.append(norm)
    return out


@router.patch("/jobs/{job_id}/scenario/events")
async def patch_scenario_events_array(
    job_id: str,
    body: PatchScenarioEventsArrayRequest,
    current_user=Depends(get_current_user),
):
    """v53 — scenario_events 배열 통째 교체.

    빈 list → 400 (최소 1개). order 필드는 백엔드가 1, 2, 3... 자동 재계산.
    scenario_user_edited_fields 에 "events" 자동 추가 (사용자 명시 편집).
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    events = body.events
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events 는 list 이어야 합니다.")
    if len(events) == 0:
        raise HTTPException(status_code=400, detail="최소 1개 event 가 필요합니다.")

    normalized_events = _v53_normalize_events_array(events)

    cur_edited = list(job.get("scenario_user_edited_fields") or [])
    if "events" not in cur_edited:
        cur_edited.append("events")

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenario_events": normalized_events,
            "scenario_user_edited_fields": cur_edited,
            "updated_at": datetime.utcnow(),
        }},
    )

    logger.info(
        "[ScenarioEventsPatch] job=%s events_count=%d",
        str(oid), len(normalized_events),
    )

    return {
        "events": normalized_events,
        "events_count": len(normalized_events),
        "scenario_user_edited_fields": cur_edited,
    }


# ── v53: POST cascade-regenerate (B3) — full scenario cascade ───────────────


_V53_CASCADE_TERMINAL_PHASES = {None, "completed", "cancelled", "failed"}


@router.post("/jobs/{job_id}/scenario/cascade-regenerate")
async def cascade_regenerate_scenario(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """v53 — 전체 cascade (Phase 0/1/1b/2/2.5/Final) 백그라운드 시작.

    409: 이미 진행 중인 cascade 가 있을 때.
    400: 시나리오 도큐먼트 자체 없음 (scenario_narrative/scenario 둘 다 None).
    """
    import uuid as _uuid_mv

    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    # 진행 중 체크
    cur_phase = job.get("cascade_phase")
    if cur_phase not in _V53_CASCADE_TERMINAL_PHASES:
        raise HTTPException(
            status_code=409,
            detail="이미 진행 중인 cascade 가 있습니다. (cascade_phase=" + str(cur_phase) + ")",
        )

    # 시나리오 자체 없음
    has_narrative = bool((job.get("scenario_narrative") or "").strip())
    has_legacy_scenario = bool((job.get("scenario") or "").strip())
    if not has_narrative and not has_legacy_scenario:
        raise HTTPException(status_code=400, detail="시나리오가 없습니다. 먼저 시나리오를 생성해주세요.")

    cascade_id = str(_uuid_mv.uuid4())

    # 시작 마킹 (events_extract phase 부터). 사용자가 events 도 직접 편집했으면
    # background helper 가 자동으로 phase 0 skip → "scene_split" 으로 진입.
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "cascade_phase": "events_extract",
            "cascade_progress": 0,
            "cascade_started_at": datetime.utcnow(),
            "cascade_completed_at": None,
            "cascade_id": cascade_id,
            "cancel_requested": False,
            "updated_at": datetime.utcnow(),
        }},
    )

    logger.info(
        "[ScenarioCascade] job=%s start cascade_id=%s",
        str(oid), cascade_id,
    )

    # 백그라운드 launch — _v53_full_cascade 는 mv_pipeline 에 정의됨
    from ..services.mv_pipeline import _v53_full_cascade
    background_tasks.add_task(_v53_full_cascade, oid, mongo)

    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "cascade_id": cascade_id,
            "estimated_phases": 5,  # events_extract / scene_split / scene_image / scene_video_prompt / video_invalidate
        },
    )


# ── v53: POST cancel-cascade (B5) — full scenario cascade cancel ────────────

@router.post("/jobs/{job_id}/scenario/cancel-cascade")
async def cancel_scenario_cascade(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v53 — 전체 cascade 진행 중 cancel_requested=True 마킹. 다음 phase 진입 시
    background helper 가 cascade_status="cancelled" 로 마감. idempotent.
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    cur_phase = job.get("cascade_phase")
    cancelled = False
    if cur_phase not in _V53_CASCADE_TERMINAL_PHASES:
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {"$set": {"cancel_requested": True, "updated_at": datetime.utcnow()}},
        )
        cancelled = True

    logger.info("[ScenarioCascadeCancel] job=%s phase=%s", str(oid), cur_phase)

    return {
        "cancelled": cancelled,
        "cascade_phase": cur_phase,
    }


# ─────────────────────────────────────────────────────────────────────────────
# v54 — user_edited_fields 보존 정책 통합 (reset / summary)
#
# 3 레벨 (씬 / event / scenario top-level) 의 user_edited_fields 를 일괄 또는
# 부분적으로 해제 + 모든 레벨 요약 조회.
#
# 추적자: [UserEditedReset] / [UserEditedSummary]
# ─────────────────────────────────────────────────────────────────────────────


class UserEditedResetRequest(BaseModel):
    scope: str  # "all" | "scene" | "event" | "scenario"
    target: Optional[int] = None  # scene_number (scope=scene) or event_order (scope=event); None for scenario
    fields: Optional[List[str]] = None  # 특정 필드만 해제. 미지정 시 해당 entity 전체 해제.


@router.post("/jobs/{job_id}/user-edited/reset")
async def reset_user_edits(
    job_id: str,
    body: UserEditedResetRequest,
    current_user=Depends(get_current_user),
):
    """v54 — 사용자 편집 표시 일괄 / 부분 해제.

    Body:
      - scope="all"          : 모든 레벨 일괄 해제 (target / fields 무시).
      - scope="scene"+target : 씬 N (scene_number) 의 user_edited_fields 해제 (fields 부분 / 전체).
      - scope="event"+target : event order=N 의 user_edited_fields 해제 (fields 부분 / 전체).
      - scope="scenario"     : scenario_user_edited_fields 해제 (fields 부분 / 전체).

    Response: {"cleared": int}
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scope = (body.scope or "").strip()
    if scope not in {"all", "scene", "event", "scenario"}:
        return JSONResponse(status_code=400, content={"error": "scope 가 필요합니다. (all|scene|event|scenario)"})

    cleared = 0
    set_fields = {"updated_at": datetime.utcnow()}

    if scope == "all":
        # 모든 레벨 일괄 해제
        scenario_uef = job.get("scenario_user_edited_fields") or []
        cleared += len(scenario_uef)
        set_fields["scenario_user_edited_fields"] = []

        for i, ev in enumerate(job.get("scenario_events") or []):
            uef = ev.get("user_edited_fields") or []
            if uef:
                cleared += len(uef)
                set_fields["scenario_events.{}.user_edited_fields".format(i)] = []

        for i, sc in enumerate(job.get("scenes") or []):
            uef = sc.get("user_edited_fields") or []
            if uef:
                cleared += len(uef)
                set_fields["scenes.{}.user_edited_fields".format(i)] = []

    elif scope == "scenario":
        cur = list(job.get("scenario_user_edited_fields") or [])
        if body.fields:
            new_list = [f for f in cur if f not in set(body.fields)]
            cleared = len(cur) - len(new_list)
            set_fields["scenario_user_edited_fields"] = new_list
        else:
            cleared = len(cur)
            set_fields["scenario_user_edited_fields"] = []

    elif scope == "scene":
        if not isinstance(body.target, int):
            return JSONResponse(status_code=400, content={"error": "scope=scene 은 target (scene_number) 이 필요합니다."})
        scenes = job.get("scenes") or []
        scene_idx = None
        for i, s in enumerate(scenes):
            if s.get("scene_number") == body.target:
                scene_idx = i
                break
        if scene_idx is None:
            return JSONResponse(status_code=404, content={"error": "씬을 찾을 수 없습니다."})
        cur = list(scenes[scene_idx].get("user_edited_fields") or [])
        if body.fields:
            new_list = [f for f in cur if f not in set(body.fields)]
            cleared = len(cur) - len(new_list)
            set_fields["scenes.{}.user_edited_fields".format(scene_idx)] = new_list
        else:
            cleared = len(cur)
            set_fields["scenes.{}.user_edited_fields".format(scene_idx)] = []

    elif scope == "event":
        if not isinstance(body.target, int):
            return JSONResponse(status_code=400, content={"error": "scope=event 은 target (event_order) 이 필요합니다."})
        events = job.get("scenario_events") or []
        event_idx = body.target - 1  # order is 1-based
        if event_idx < 0 or event_idx >= len(events):
            return JSONResponse(status_code=404, content={"error": "event 를 찾을 수 없습니다."})
        cur = list(events[event_idx].get("user_edited_fields") or [])
        if body.fields:
            new_list = [f for f in cur if f not in set(body.fields)]
            cleared = len(cur) - len(new_list)
            set_fields["scenario_events.{}.user_edited_fields".format(event_idx)] = new_list
        else:
            cleared = len(cur)
            set_fields["scenario_events.{}.user_edited_fields".format(event_idx)] = []

    if cleared > 0 or scope == "all":
        await mongo.mv_jobs.update_one({"_id": oid}, {"$set": set_fields})

    logger.info(
        "[UserEditedReset] job=%s scope=%s target=%s cleared=%d",
        str(oid), scope, body.target, cleared,
    )

    return {"cleared": cleared}


@router.get("/jobs/{job_id}/user-edited/summary")
async def get_user_edited_summary(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v54 — 모든 레벨의 user_edited_fields 요약.

    Response:
      {
        "scenario": ["narrative", "events"],
        "events": {"3": ["trigger"], "7": ["motivation"]},
        "scenes": {"5": ["image_prompt"], "12": ["description"]}
      }
    """
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenario_uef = list(job.get("scenario_user_edited_fields") or [])

    events_dict = {}
    for ev in (job.get("scenario_events") or []):
        order = ev.get("order")
        uef = ev.get("user_edited_fields") or []
        if isinstance(order, int) and uef:
            events_dict[str(order)] = list(uef)

    scenes_dict = {}
    for sc in (job.get("scenes") or []):
        sn = sc.get("scene_number")
        uef = sc.get("user_edited_fields") or []
        if isinstance(sn, int) and uef:
            scenes_dict[str(sn)] = list(uef)

    logger.info(
        "[UserEditedSummary] job=%s scenario=%d events=%d scenes=%d",
        str(oid), len(scenario_uef), len(events_dict), len(scenes_dict),
    )

    return {
        "scenario": scenario_uef,
        "events": events_dict,
        "scenes": scenes_dict,
    }


# ── Single-scene video generation helpers ───────────────────────────────────

async def _generate_single_scene_video(job_id, scene_number, mongo_db):
    """Generate video for a single scene."""
    from bson import ObjectId
    job = await mongo_db.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return

    scenes = job.get("scenes", [])
    scene_idx = None
    scene = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            scene = s
            break

    if scene is None or not scene.get("image_object_name"):
        return

    # Recalculate section_start/section_end if missing for this scene
    if scene.get("section_start") is None:
        scenes_sorted = sorted(scenes, key=lambda x: x.get("scene_number", 0))
        cumulative = 0.0
        for s in scenes_sorted:
            use_sec = s.get("use_seconds", 10.0)
            s["section_start"] = round(cumulative, 3)
            s["section_end"] = round(cumulative + float(use_sec), 3)
            cumulative += float(use_sec)
        # Update the reference — scene is already in scenes list
        scene = scenes_sorted[scene_idx] if scene_idx < len(scenes_sorted) else scene
        # Also find correct scene after sorting
        for s in scenes_sorted:
            if s.get("scene_number") == scene_number:
                scene = s
                break

    try:
        from ..database.minio import get_minio
        from ..config import settings
        minio_client = get_minio()

        # Load scene image
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=scene["image_object_name"],
        )
        image_bytes = resp.read()
        resp.close(); resp.release_conn()

        # Load previous scene image (if exists)
        prev_scene_image_bytes = None
        if scene_idx > 0:
            prev_scene = scenes[scene_idx - 1]
            prev_img_obj = prev_scene.get("image_object_name")
            if prev_img_obj:
                try:
                    resp = minio_client.get_object(
                        bucket_name=settings.minio_bucket_images,
                        object_name=prev_img_obj,
                    )
                    prev_scene_image_bytes = resp.read()
                    resp.close(); resp.release_conn()
                except Exception:
                    pass

        # Load character sheet
        character_image_bytes = None
        char_obj = job.get("character_object_name")
        if char_obj:
            try:
                resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=char_obj,
                )
                character_image_bytes = resp.read()
                resp.close(); resp.release_conn()
            except Exception:
                pass

        # Generate video_prompt if missing (Phase 2.5 on-demand)
        scene_video_prompt = scene.get("video_prompt")
        if not scene_video_prompt:
            try:
                from ..services.mv_generator import generate_video_prompts_from_images
                scene_video_prompt = await generate_video_prompts_from_images(
                    image_bytes=image_bytes,
                    image_prompt=scene.get("video_image_prompt") or scene.get("image_prompt", ""),
                    scene_type=scene.get("scene_type", "drama"),
                    lyrics_segment=scene.get("lyrics_segment", ""),
                    scene_number=scene.get("scene_number", 0),
                    model=job.get("video_prompt_model") or "gemini-2.5-pro",
                    video_model=job.get("video_model", "veo"),
                    has_character=bool(job.get("character_object_name")),
                )
                # Save it back to MongoDB
                scenes[scene_idx]["video_prompt"] = scene_video_prompt
                await mongo_db.mv_jobs.update_one(
                    {"_id": ObjectId(job_id)},
                    {"$set": {"scenes": scenes}},
                )
            except Exception as e:
                logger.warning("On-demand video_prompt generation failed: %s", e)
                scene_video_prompt = "Smooth cinematic camera movement."

        # Generate video via selected model
        from ..services.kling_video_generator import start_scene_video_kling, check_scene_video_status_kling, download_video_kling
        from ..services.seedance_video_generator import start_scene_video_seedance, check_scene_video_status_seedance, download_video_seedance
        from ..services.mv_generator import start_scene_video, check_scene_video_status, download_video
        from ..services.grok_video_generator import (
            start_scene_video_grok,
            check_scene_video_status_grok,
            download_video_grok,
        )
        from datetime import timedelta
        import asyncio

        video_model = job.get("video_model", "veo")
        scene_desc = scene.get("video_image_prompt") or scene.get("image_prompt") or scene.get("description", "")

        if video_model == "seedance":
            logger.info(
                "[SeedAudioOff_single] job=%s scene=%d type=%s",
                job_id, scene_number, scene.get("scene_type"),
            )
            task_id = await start_scene_video_seedance(
                prompt=scene_desc,
                image_bytes=image_bytes,
                video_prompt=scene_video_prompt,
                lyrics_segment=scene.get("lyrics_segment", ""),
                scene_type=scene.get("scene_type", "drama"),
                duration=float(scene.get("use_seconds", 10)),
                audio_bytes=None,
            )
        elif video_model == "veo":
            task_id = await start_scene_video(
                scene_desc, image_bytes,
                video_prompt=scene_video_prompt,
                lyrics_segment=scene.get("lyrics_segment", ""),
                scene_type=scene.get("scene_type", "drama"),
                description=scene.get("description", ""),  # v67
            )
        elif video_model == "grok":
            # v173: xAI 서버측 fetch — 반드시 public presign (프록시 URL 금지).
            image_url = public_presign(
                scene["image_object_name"],
                expires=timedelta(hours=1),
            )
            logger.info(
                "[GrokSingle] job=%s scene=%d video_model=%s",
                job_id, scene_number, video_model,
            )
            task_id = await start_scene_video_grok(
                prompt=scene_desc,
                image_url=image_url,
                video_prompt=scene_video_prompt,
                lyrics_segment=scene.get("lyrics_segment", ""),
                scene_type=scene.get("scene_type", "drama"),
                duration=float(scene.get("use_seconds", 10)),
                description=scene.get("description", ""),
            )
        else:  # kling
            task_id = await start_scene_video_kling(
                prompt=scene_desc,
                image_bytes=image_bytes,
                prev_scene_image_bytes=prev_scene_image_bytes,
                character_image_bytes=character_image_bytes,
                lyrics_segment=scene.get("lyrics_segment", ""),
                scene_type=scene.get("scene_type", "drama"),
                duration=float(scene.get("use_seconds", 10)),
                video_prompt=scene_video_prompt,
            )

        # Poll for completion (max 10 min)
        for attempt in range(120):
            await asyncio.sleep(5)
            if video_model == "seedance":
                status_result = await check_scene_video_status_seedance(task_id)
            elif video_model == "veo":
                status_result = await check_scene_video_status(task_id)
            elif video_model == "grok":
                status_result = await check_scene_video_status_grok(task_id)
            else:
                status_result = await check_scene_video_status_kling(task_id)

            if status_result.get("done"):
                video_url = status_result.get("video_url") or status_result.get("video_uri")
                if video_url:
                    # Download and save to MinIO
                    if video_model == "seedance":
                        video_bytes = await download_video_seedance(video_url)
                    elif video_model == "veo":
                        video_bytes = await download_video(video_url)
                    elif video_model == "grok":
                        video_bytes = await download_video_grok(video_url)
                    else:
                        video_bytes = await download_video_kling(video_url)
                    video_object = "mv/{}/scenes/{:03d}_video.mp4".format(job_id, scene_number)
                    minio_client.put_object(
                        bucket_name=settings.minio_bucket_images,
                        object_name=video_object,
                        data=io.BytesIO(video_bytes),
                        length=len(video_bytes),
                        content_type="video/mp4",
                    )
                    scenes[scene_idx]["video_object_name"] = video_object
                    scenes[scene_idx]["video_status"] = "completed"
                    scenes[scene_idx]["video_error"] = None

                    # [DISABLED] Phase 3.5: 자동 Sync Labs 제거 — 사용자가 retry-sync로 수동 선택
                    # Kling 원본 영상을 유지하고, 음악만 합침

                    # ── Merge video with audio segment ──────────────────
                    try:
                        from ..services.mv_pipeline import _resolve_audio_object_name as _resolve_audio
                        audio_obj_name = await _resolve_audio(job, mongo_db)
                        if audio_obj_name and scene.get("section_start") is not None:
                            audio_resp = minio_client.get_object(
                                bucket_name=settings.minio_bucket_music,
                                object_name=audio_obj_name,
                            )
                            full_audio = audio_resp.read()
                            audio_resp.close(); audio_resp.release_conn()

                            # Read the final video (may have been replaced by Sync Labs)
                            vid_resp = minio_client.get_object(
                                bucket_name=settings.minio_bucket_images,
                                object_name=video_object,
                            )
                            final_vid_bytes = vid_resp.read()
                            vid_resp.close(); vid_resp.release_conn()

                            import tempfile, subprocess
                            with tempfile.TemporaryDirectory() as tmpdir:
                                vid_path = os.path.join(tmpdir, "video.mp4")
                                aud_path = os.path.join(tmpdir, "audio.mp3")
                                out_path = os.path.join(tmpdir, "merged.mp4")

                                with open(vid_path, "wb") as f:
                                    f.write(final_vid_bytes)
                                with open(aud_path, "wb") as f:
                                    f.write(full_audio)

                                start = scene["section_start"]
                                end = scene["section_end"]

                                # 가사 자막 생성 (v43: lyric_timestamps backward-shim, has_subtitles 가드)
                                from ..services.subtitle_generator import generate_scene_lyrics_ass
                                from ..services.mv_pipeline import _get_scene_timestamps, _read_lyric_timestamps
                                timestamps = None
                                if scene.get("lyrics_segment") and (job.get("has_subtitles") or _read_lyric_timestamps(job)):
                                    _ws = _read_lyric_timestamps(job)
                                    timestamps = _get_scene_timestamps(_ws, float(start), float(end))
                                ass_content = generate_scene_lyrics_ass(scene, timestamps=timestamps)
                                if ass_content:
                                    ass_path = os.path.join(tmpdir, "lyrics.ass")
                                    with open(ass_path, "w", encoding="utf-8") as f:
                                        f.write(ass_content)
                                    ass_filter = ass_path.replace("\\", "/").replace(":", "\\:")
                                    subprocess.run(
                                        ["ffmpeg", "-y",
                                         "-i", vid_path,
                                         "-ss", str(start), "-to", str(end), "-i", aud_path,
                                         "-vf", "ass={}".format(ass_filter),
                                         "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                                         "-c:a", "aac",
                                         "-map", "0:v:0", "-map", "1:a:0",
                                         "-shortest", out_path],
                                        capture_output=True, timeout=60,
                                    )
                                else:
                                    subprocess.run(
                                        ["ffmpeg", "-y",
                                         "-i", vid_path,
                                         "-ss", str(start), "-to", str(end), "-i", aud_path,
                                         "-c:v", "copy", "-c:a", "aac",
                                         "-map", "0:v:0", "-map", "1:a:0",
                                         "-shortest", out_path],
                                        capture_output=True, timeout=30,
                                    )

                                if os.path.exists(out_path):
                                    with open(out_path, "rb") as f:
                                        merged = f.read()
                                    merged_object = "mv/{}/scenes/{:03d}_video_audio.mp4".format(job_id, scene_number)
                                    minio_client.put_object(
                                        bucket_name=settings.minio_bucket_images,
                                        object_name=merged_object,
                                        data=io.BytesIO(merged),
                                        length=len(merged),
                                        content_type="video/mp4",
                                    )
                                    scenes[scene_idx]["video_with_audio_object"] = merged_object
                    except Exception as merge_err:
                        logger.warning(
                            "Scene %d: Failed to merge audio with video: %s",
                            scene_number, str(merge_err)[:200],
                        )

                else:
                    error = status_result.get("error", "영상 URL 없음")
                    scenes[scene_idx]["video_status"] = "failed"
                    scenes[scene_idx]["video_error"] = error
                break
        else:
            scenes[scene_idx]["video_status"] = "failed"
            scenes[scene_idx]["video_error"] = "영상 생성 시간 초과"

    except Exception as e:
        scenes[scene_idx]["video_status"] = "failed"
        scenes[scene_idx]["video_error"] = str(e)[:300]

    # Update MongoDB
    await mongo_db.mv_jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
    )


def _run_single_scene_video(job_id, scene_number):
    """Synchronous wrapper to run single scene video generation in a background thread."""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        loop.run_until_complete(_generate_single_scene_video(job_id, scene_number, mongo_db))
    except Exception as e:
        print(f"Single scene video error: {e}")
        import traceback; traceback.print_exc()
    finally:
        loop.close()


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video ────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/generate-video")
async def generate_single_scene_video_endpoint(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Generate video for a single scene in the background."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes", [])
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break

    if scene_idx is None:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 장면을 찾을 수 없습니다."},
        )

    # Check that the scene has an image
    if not scenes[scene_idx].get("image_object_name"):
        return JSONResponse(
            status_code=400,
            content={"error": "이미지가 없는 장면입니다. 먼저 이미지를 생성하세요."},
        )

    # Prevent duplicate generation
    if scenes[scene_idx].get("video_status") == "generating":
        return JSONResponse(
            status_code=409,
            content={"error": "이 장면의 영상이 이미 생성 중입니다."},
        )

    # Update video_status to "generating"
    scenes[scene_idx]["video_status"] = "generating"
    scenes[scene_idx]["video_error"] = None
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "updated_at": datetime.utcnow(),
        }},
    )

    # Launch background task
    background_tasks.add_task(_run_single_scene_video, str(oid), scene_number)

    return {
        "job_id": job_id,
        "scene_number": scene_number,
        "video_status": "generating",
        "message": "씬 영상 생성이 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/generate-videos ──────────────────────────────

@router.post("/jobs/{job_id}/generate-videos")
async def generate_videos(
    job_id: str,
    body: GenerateVideosRequest = GenerateVideosRequest(),
    background_tasks: BackgroundTasks = None,
    current_user=Depends(get_current_user),
):
    """Start/resume video generation. Pauses on 429 instead of failing."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("scenes"):
        return JSONResponse(
            status_code=400,
            content={"error": "장면 데이터가 없습니다."},
        )

    # Check that at least some scenes have images
    scenes_with_images = [s for s in job["scenes"] if s.get("image_object_name")]
    if not scenes_with_images:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지가 생성된 장면이 없습니다. 먼저 이미지를 생성하세요."},
        )

    # Determine video_model: request override > job setting > default
    video_model = body.video_model or job.get("video_model", "veo")

    # Update job's video_model if overridden
    if body.video_model and body.video_model != job.get("video_model"):
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {"$set": {"video_model": video_model, "updated_at": datetime.utcnow()}},
        )

    if body.scene_numbers is None:
        failed_count = sum(
            1 for s in job.get("scenes", [])
            if (not s.get("video_object_name")) or s.get("video_status") == "failed"
        )
        logger.info("[BatchVideo] job=%s failed_count=%d", str(oid), failed_count)

    background_tasks.add_task(run_phase3_videos, oid, mongo, body.scene_numbers, video_model)

    return {
        "job_id": job_id,
        "status": "generating_videos",
        "message": "비디오 생성이 시작되었습니다. (모델: {})".format(video_model),
    }


# ── POST /api/mv/jobs/{job_id}/concatenate ───────────────────────────────────

@router.post("/jobs/{job_id}/concatenate")
async def concatenate(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Manually trigger video concatenation."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    completed_videos = [
        s for s in job.get("scenes", [])
        if s.get("video_status") == "completed" and s.get("video_object_name")
    ]

    if not completed_videos:
        return JSONResponse(
            status_code=400,
            content={"error": "합칠 완료된 비디오가 없습니다."},
        )

    background_tasks.add_task(run_phase4_concatenate, oid, mongo)

    return {
        "job_id": job_id,
        "status": "concatenating",
        "message": "비디오 합치기가 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/merge-audio ────────────────────────────────────

@router.post("/jobs/{job_id}/merge-audio")
async def merge_audio(
    job_id: str,
    body: MergeAudioRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Merge audio track with the final video to create a music video."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("result_video_url"):
        return JSONResponse(
            status_code=400,
            content={"error": "합칠 영상이 없습니다. 먼저 영상 생성을 완료하세요."},
        )

    background_tasks.add_task(run_phase5_merge_audio, oid, mongo, body.audio_object_name)

    return {
        "job_id": job_id,
        "status": "merging_audio",
        "message": "뮤직비디오 음악 합치기가 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/save-draft ─────────────────────────────────────

@router.post("/jobs/{job_id}/save-draft")
async def save_draft(
    job_id: str,
    body: SaveDraftRequest,
    current_user=Depends(get_current_user),
):
    """Save additional form fields so the upload page can be fully restored."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    await _get_job_with_ownership(mongo, oid, current_user["id"])

    update_fields = {"updated_at": datetime.utcnow()}
    # Only set fields that were provided (not None)
    for field in (
        "audio_generation_id", "audio_file_name",
        "genre", "mood", "tags", "prompt", "ai_model",
    ):
        val = getattr(body, field, None)
        if val is not None:
            update_fields[field] = val

    # v209: track 곡 소스 임시저장 — create_mv 와 동일 기준 검증 후 audio_track_id 로 반영.
    # (tester 실증 버그: track_id 가 조용히 폐기되어 불러오기 시 오디오 해석 실패)
    if body.track_id:
        _track_err, _valid_track_id, _ = await _validate_user_track_source(
            mongo, body.track_id, current_user, "save-draft",
        )
        if _track_err is not None:
            return _track_err
        update_fields["audio_track_id"] = _valid_track_id

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": update_fields},
    )

    return {
        "job_id": job_id,
        "message": "임시저장이 완료되었습니다.",
    }


# ── v211: MV 곡 부착 (attach / detach) ──────────────────────────────────────
# 부착 = mv_jobs 참조형 단일 소스 (attached_track_id / attached_generation_id /
# attached_at). 전 구간 무과금 메타데이터 — 외부 API 호출 0.

async def _resolve_attach_target(mongo, job: dict, current_user):
    """job 의 소스 곡 → 부착 타겟 확정.

    Returns (error_response | None, target: dict | None)
      target = {"track_id": str|None, "generation_id": str|None,
                "song_title": str, "state": "released"|"unreleased"}
    가드: 소스 부재 400 / track 소스 재검증(_validate_user_track_source 재사용) /
    generation 실존 404·소유 403. generation 에 result_track_id 기존재·트랙
    실존 시 즉시 track 부착(=발매됨) 으로 승격.
    """
    src_track_id = job.get("audio_track_id")
    src_gen_id = job.get("audio_generation_id")
    if not src_track_id and not src_gen_id:
        logger.warning("[MVAttach] no-source job=%s", str(job["_id"]))
        return JSONResponse(
            status_code=400,
            content={"error": "이 MV에는 연결할 소스 곡이 없습니다."},
        ), None

    if src_track_id:
        # track 소스 — 소유/blinded 재검증 (v209 헬퍼 재사용; audio_url 조건은 무해 통과)
        err, valid_track_id, _dur = await _validate_user_track_source(
            mongo, src_track_id, current_user, "attach",
        )
        if err is not None:
            return err, None
        trk = await mongo.tracks.find_one(
            {"_id": ObjectId(valid_track_id)}, {"title": 1},
        )
        return None, {
            "track_id": valid_track_id,
            "generation_id": None,
            "song_title": (trk or {}).get("title") or "",
            "state": "released",
        }

    # generation 소스
    if not ObjectId.is_valid(src_gen_id):
        logger.warning("[MVAttach] invalid source gen_id=%r job=%s", src_gen_id, str(job["_id"]))
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 생성 ID입니다."}), None
    gen = await mongo.generations.find_one(
        {"_id": ObjectId(src_gen_id)},
        {"user_id": 1, "title": 1, "result_track_id": 1},
    )
    if not gen:
        logger.warning("[MVAttach] source generation not found gen=%s job=%s", src_gen_id, str(job["_id"]))
        return JSONResponse(status_code=404, content={"error": "소스 곡(생성물)을 찾을 수 없습니다."}), None
    if gen.get("user_id") != current_user["id"]:
        logger.warning("[MVAttach] source generation not owned gen=%s user=%s", src_gen_id, current_user["id"])
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."}), None

    # 기발매 곡이면 즉시 track 부착 (배지 ✅발매됨) — 트랙 실종 시 generation 부착 폴백
    result_track_id = gen.get("result_track_id")
    if result_track_id and ObjectId.is_valid(str(result_track_id)):
        trk = await mongo.tracks.find_one(
            {"_id": ObjectId(str(result_track_id))}, {"title": 1},
        )
        if trk:
            return None, {
                "track_id": str(result_track_id),
                "generation_id": src_gen_id,
                "song_title": trk.get("title") or gen.get("title") or "",
                "state": "released",
            }
        logger.warning(
            "[MVAttach] result_track_id=%s missing — fallback to generation attach gen=%s",
            result_track_id, src_gen_id,
        )
    return None, {
        "track_id": None,
        "generation_id": src_gen_id,
        "song_title": gen.get("title") or "",
        "state": "unreleased",
    }


@router.post("/jobs/{job_id}/attach")
async def attach_mv_job(
    job_id: str,
    body: AttachMVRequest = AttachMVRequest(),
    current_user=Depends(get_current_user),
):
    """v211 — 완성 MV 를 자신의 소스 곡에 붙인다 (곡당 MV 1개)."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") != "completed" or not job.get("result_music_video_url"):
        logger.warning(
            "[MVAttach] rejected not-completed job=%s status=%s has_final=%s",
            job_id, job.get("status"), bool(job.get("result_music_video_url")),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "완성된 MV만 곡에 붙일 수 있습니다."},
        )

    err, target = await _resolve_attach_target(mongo, job, current_user)
    if err is not None:
        return err

    # 곡당 1개 가드 — 같은 곡(track 또는 그 generation)에 기부착된 타 job 검사.
    song_ors = []
    if target["track_id"]:
        song_ors.append({"attached_track_id": target["track_id"]})
    if target["generation_id"]:
        song_ors.append({"attached_generation_id": target["generation_id"]})
    conflict = await mongo.mv_jobs.find_one(
        {"_id": {"$ne": oid}, "$or": song_ors},
        {"title": 1, "attached_track_id": 1},
    )
    if conflict:
        if not body.replace:
            logger.info(
                "[MVAttach] conflict job=%s conflicting_job=%s replace=false",
                job_id, str(conflict["_id"]),
            )
            return JSONResponse(
                status_code=409,
                content={
                    "error": "이 곡에는 이미 다른 MV가 붙어 있습니다.",
                    "conflicting_job_id": str(conflict["_id"]),
                    "conflicting_title": conflict.get("title") or "",
                },
            )
        # replace — 기존 job 부착 해제 후 교체
        await mongo.mv_jobs.update_one(
            {"_id": conflict["_id"]},
            {"$set": {
                "attached_track_id": None,
                "attached_generation_id": None,
                "attached_at": None,
                "updated_at": datetime.utcnow(),
            }},
        )
        await _invalidate_track_cache(conflict.get("attached_track_id"))
        logger.info(
            "[MVAttach] replaced old attachment job=%s (cleared %s)",
            job_id, str(conflict["_id"]),
        )

    now = datetime.utcnow()
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "attached_track_id": target["track_id"],
            "attached_generation_id": target["generation_id"],
            "attached_at": now,
            "updated_at": now,
        }},
    )
    await _invalidate_track_cache(target["track_id"])
    logger.info(
        "[MVAttach] attached job=%s track=%s gen=%s state=%s user=%s",
        job_id, target["track_id"], target["generation_id"], target["state"],
        current_user["id"][:8],
    )

    return {
        "job_id": job_id,
        "attachment": {
            "state": target["state"],
            "song_id": target["track_id"] or target["generation_id"],
            "song_title": target["song_title"],
            "attached_track_id": target["track_id"],
            "attached_generation_id": target["generation_id"],
            "attached_at": now.isoformat(),
        },
        "message": "곡에 붙었습니다." if target["state"] == "released"
                   else "곡에 붙었습니다. 발매 시 자동 반영됩니다.",
    }


@router.post("/jobs/{job_id}/detach")
async def detach_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v211 — 부착 해제."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if not job.get("attached_track_id") and not job.get("attached_generation_id"):
        return JSONResponse(status_code=400, content={"error": "부착된 곡이 없습니다."})

    prev_track_id = job.get("attached_track_id")
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "attached_track_id": None,
            "attached_generation_id": None,
            "attached_at": None,
            "updated_at": datetime.utcnow(),
        }},
    )
    await _invalidate_track_cache(prev_track_id)
    logger.info(
        "[MVAttach] detached job=%s prev_track=%s prev_gen=%s user=%s",
        job_id, prev_track_id, job.get("attached_generation_id"), current_user["id"][:8],
    )
    return {"job_id": job_id, "message": "부착이 해제되었습니다."}


# ── POST /api/mv/jobs/{job_id}/cancel ──────────────────────────────────────────

@router.post("/jobs/{job_id}/cancel")
async def cancel_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Cancel an in-progress MV generation. Pipeline checks this flag between scenes."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    current_status = job.get("status", "")
    if current_status not in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=400,
            content={"error": f"현재 상태({current_status})에서는 중지할 수 없습니다."},
        )

    # Set cancelled flag — pipeline loops check this between iterations
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "cancel_requested": True,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "job_id": job_id,
        "message": "중지 요청이 전송되었습니다. 현재 처리 중인 씬 완료 후 중지됩니다.",
    }


# ── DELETE /api/mv/jobs/{job_id} ─────────────────────────────────────────────

@router.delete("/jobs/{job_id}")
async def delete_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Delete job and all associated MinIO objects."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "처리 중인 작업은 삭제할 수 없습니다."},
        )

    minio_client = get_minio()

    # Delete all objects under mv/{job_id}/ prefix
    prefix = "mv/{}/".format(str(oid))
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
        logger.warning("Failed to clean up MinIO objects for job %s: %s", job_id, e)

    # v211 — 부착 중이던 job 삭제 = 부착 자동 소멸(참조형 저장의 구조적 보장).
    # 트랙 상세 캐시(has_music_video 포함)만 즉시 무효화.
    if job.get("attached_track_id"):
        await _invalidate_track_cache(job.get("attached_track_id"))
        logger.info(
            "[MVAttach] job deleted while attached job=%s track=%s",
            job_id, job.get("attached_track_id"),
        )

    # Delete MongoDB document
    await mongo.mv_jobs.delete_one({"_id": oid})

    return {
        "job_id": job_id,
        "message": "작업이 삭제되었습니다.",
    }


# ── GET /api/mv/models ───────────────────────────────────────────────────────

@router.get("/models")
async def list_video_models():
    """List available video generation models."""
    models = [
        {
            "id": "veo",
            "name": "Veo 3.1",
            "provider": "Google",
            "description": "고품질 8초 영상 생성 (Google Veo 3.1)",
            "duration": "8초",
            "available": bool(settings.google_api_key),
        },
        {
            "id": "kling",
            "name": "Kling V3",
            "provider": "Kling AI",
            "description": "이미지 기반 10초 영상 생성 (Kling AI)",
            "duration": "10초",
            "available": bool(settings.kling_access_key and settings.kling_secret_key),
        },
    ]
    return {"models": models}


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/retry-sync ────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/retry-sync")
async def retry_sync_labs(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Retry Sync Labs lip sync post-processing for a single scene."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    if not settings.sync_api_key:
        return JSONResponse(status_code=503, content={"error": "Sync Labs API 키가 설정되지 않았습니다."})

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다."})
    if str(job.get("user_id", "")) != str(current_user["id"]):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    scenes = job.get("scenes", [])
    scene = None
    for s in scenes:
        if s.get("scene_number") == scene_number:
            scene = s
            break
    if not scene:
        return JSONResponse(status_code=404, content={"error": "씬을 찾을 수 없습니다."})
    if scene.get("scene_type") != "lipsync":
        return JSONResponse(status_code=400, content={"error": "립싱크 씬이 아닙니다."})
    if not scene.get("video_object_name"):
        return JSONResponse(status_code=400, content={"error": "영상이 없습니다. 먼저 영상을 생성해주세요."})

    background_tasks.add_task(_run_retry_sync, str(job_id), scene_number)
    return {"message": "립싱크 재시도를 시작합니다.", "scene_number": scene_number}


def _run_retry_sync(job_id, scene_number):
    """Background wrapper for Sync Labs retry."""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        loop.run_until_complete(_retry_sync_for_scene(job_id, scene_number, mongo_db))
    except Exception as e:
        logger.error("Retry sync error: %s", e, exc_info=True)
    finally:
        loop.close()


async def _retry_sync_for_scene(job_id, scene_number, mongo_db):
    """Retry Sync Labs post-processing for a single scene."""
    from bson import ObjectId as _ObjectId
    job = await mongo_db.mv_jobs.find_one({"_id": _ObjectId(job_id)})
    if not job:
        return

    scenes = job.get("scenes", [])
    scene_idx = None
    scene = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            scene = s
            break
    if scene is None or not scene.get("video_object_name"):
        return

    from ..database.minio import get_minio
    minio_client = get_minio()

    try:
        # Load current video
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=scene["video_object_name"],
        )
        video_bytes = resp.read()
        resp.close(); resp.release_conn()

        # Load audio
        from ..services.mv_pipeline import _resolve_audio_object_name
        from ..services.sync_labs_service import generate_lipsync_from_video, cut_audio_segment

        audio_object_name = await _resolve_audio_object_name(job, mongo_db)
        if not audio_object_name:
            scenes[scene_idx]["sync_error"] = "음악 파일을 찾을 수 없습니다."
            await mongo_db.mv_jobs.update_one({"_id": _ObjectId(job_id)}, {"$set": {"scenes": scenes}})
            return

        audio_resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object_name,
        )
        full_audio = audio_resp.read()
        audio_resp.close(); audio_resp.release_conn()

        # Recalculate section_start/end if missing
        if scene.get("section_start") is None:
            cumulative = 0.0
            sorted_scenes = sorted(scenes, key=lambda s: s.get("scene_number", 0))
            for sc in sorted_scenes:
                use_sec = float(sc.get("use_seconds", 10))
                sc["section_start"] = round(cumulative, 3)
                sc["section_end"] = round(cumulative + use_sec, 3)
                cumulative += use_sec
            # Re-find scene after recalc
            for i, s in enumerate(scenes):
                if s.get("scene_number") == scene_number:
                    scene = s
                    scene_idx = i
                    break

        # ── section_start/end 유효성 가드 ──
        raw_start = scene.get("section_start")
        raw_end = scene.get("section_end")
        if raw_start is None or raw_end is None:
            scenes[scene_idx]["sync_error"] = "씬의 시간 정보(section_start/end)가 없어 Sync Labs를 건너뜁니다."
            scenes[scene_idx]["video_source"] = "kling (sync skipped)"
            await mongo_db.mv_jobs.update_one(
                {"_id": _ObjectId(job_id)},
                {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
            )
            return
        try:
            start_sec = float(raw_start)
            end_sec = float(raw_end)
        except (TypeError, ValueError):
            scenes[scene_idx]["sync_error"] = "section_start/end가 숫자가 아닙니다 (start={}, end={})".format(raw_start, raw_end)
            scenes[scene_idx]["video_source"] = "kling (sync skipped)"
            await mongo_db.mv_jobs.update_one(
                {"_id": _ObjectId(job_id)},
                {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
            )
            return
        if start_sec < 0 or end_sec <= start_sec or (end_sec - start_sec) < 0.5:
            scenes[scene_idx]["sync_error"] = "유효하지 않은 구간 (start={:.3f}, end={:.3f})".format(start_sec, end_sec)
            scenes[scene_idx]["video_source"] = "kling (sync skipped)"
            await mongo_db.mv_jobs.update_one(
                {"_id": _ObjectId(job_id)},
                {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
            )
            return

        # 분리된 보컬이 있으면 Sync Labs에 보컬만 전달, 없으면 전체 구간
        try:
            original_segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)
        except (RuntimeError, ValueError) as cut_err:
            scenes[scene_idx]["sync_error"] = "오디오 구간 컷팅 실패: {}".format(str(cut_err)[:200])
            scenes[scene_idx]["video_source"] = "kling (sync failed)"
            await mongo_db.mv_jobs.update_one(
                {"_id": _ObjectId(job_id)},
                {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
            )
            return

        if scene.get("separated_vocal_object"):
            vocal_resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_music,
                object_name=scene["separated_vocal_object"],
            )
            sync_audio = vocal_resp.read()
            vocal_resp.close()
            vocal_resp.release_conn()
        else:
            sync_audio = original_segment_audio

        # 보컬 분리 결과가 너무 작으면 원본 segment로 fallback
        if not sync_audio or len(sync_audio) < 5120:
            logger.warning(
                "Retry sync: scene %s vocal too small (%db), falling back to original segment",
                scene_number, len(sync_audio) if sync_audio else 0,
            )
            sync_audio = original_segment_audio

        # Call Sync Labs (보컬만 전달하여 립싱크 정확도 향상)
        synced_video = await generate_lipsync_from_video(
            video_bytes=video_bytes,
            audio_bytes=sync_audio,
            model="lipsync-2",
        )

        # 오디오 제거 → 원본 음악(풀믹스) 다시 합치기
        import tempfile, subprocess
        with tempfile.TemporaryDirectory() as tmpdir:
            synced_path = os.path.join(tmpdir, "synced.mp4")
            silent_path = os.path.join(tmpdir, "silent.mp4")
            audio_seg_path = os.path.join(tmpdir, "audio_seg.mp3")
            final_path = os.path.join(tmpdir, "final.mp4")

            with open(synced_path, "wb") as f:
                f.write(synced_video)
            with open(audio_seg_path, "wb") as f:
                f.write(original_segment_audio)

            subprocess.run(["ffmpeg", "-y", "-i", synced_path, "-an", "-c:v", "copy", silent_path],
                          capture_output=True, timeout=30)

            if os.path.exists(silent_path):
                subprocess.run(["ffmpeg", "-y", "-i", silent_path, "-i", audio_seg_path,
                               "-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0",
                               "-shortest", final_path],
                              capture_output=True, timeout=30)

            if os.path.exists(final_path):
                with open(final_path, "rb") as f:
                    final_video = f.read()
            else:
                final_video = synced_video

        # Sync Labs 후 자막 재적용 (v43: has_subtitles 가드, lyric_timestamps backward-shim)
        from ..services.mv_pipeline import _burn_subtitles_on_synced_video, _get_scene_timestamps, _read_lyric_timestamps
        if job.get("has_subtitles") or _read_lyric_timestamps(job):
            _ws = _read_lyric_timestamps(job)
            _scene_ts = _get_scene_timestamps(_ws, float(scene.get("section_start", 0)), float(scene.get("section_end", 0)))
            final_video = _burn_subtitles_on_synced_video(final_video, scene, timestamps=_scene_ts)

        # Save Sync Labs result to SEPARATE file (원본 Kling 영상 유지)
        synclabs_object = "mv/{}/scenes/{:03d}_video_synclabs.mp4".format(job_id, scene_number)
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=synclabs_object,
            data=io.BytesIO(final_video),
            length=len(final_video),
            content_type="video/mp4",
        )

        scenes[scene_idx]["video_synclabs_object"] = synclabs_object
        scenes[scene_idx]["video_source"] = "kling+synclabs"
        scenes[scene_idx]["sync_error"] = None

        # Also save video_with_audio_synclabs (Sync Labs 결과 + 원본 음악)
        synclabs_audio_object = "mv/{}/scenes/{:03d}_video_audio_synclabs.mp4".format(job_id, scene_number)
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=synclabs_audio_object,
            data=io.BytesIO(final_video),
            length=len(final_video),
            content_type="video/mp4",
        )
        scenes[scene_idx]["video_with_audio_synclabs_object"] = synclabs_audio_object

    except Exception as e:
        scenes[scene_idx]["sync_error"] = str(e)[:300]
        scenes[scene_idx]["video_source"] = "kling (sync failed)"

    await mongo_db.mv_jobs.update_one(
        {"_id": _ObjectId(job_id)},
        {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
    )


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/separate-vocal ─────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/separate-vocal")
async def separate_vocal(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Separate vocals from audio segment for lip sync preview."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다."})
    if str(job.get("user_id", "")) != str(current_user["id"]):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    scenes = job.get("scenes", [])
    scene = None
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene = s
            scene_idx = i
            break
    if not scene:
        return JSONResponse(status_code=404, content={"error": "씬을 찾을 수 없습니다."})
    if scene.get("scene_type") != "lipsync":
        return JSONResponse(status_code=400, content={"error": "립싱크 씬이 아닙니다."})

    # section_start/end 필요
    start_sec = scene.get("section_start")
    end_sec = scene.get("section_end")
    if start_sec is None or end_sec is None:
        return JSONResponse(status_code=400, content={"error": "씬의 시간 정보가 없습니다."})

    # 이미 분리된 보컬이 있으면 바로 반환
    if scene.get("separated_vocal_object") and scene.get("separated_original_object"):
        import base64
        minio_client = get_minio()
        orig_resp = minio_client.get_object(settings.minio_bucket_music, scene["separated_original_object"])
        orig_b64 = base64.b64encode(orig_resp.read()).decode(); orig_resp.close(); orig_resp.release_conn()
        vocal_resp = minio_client.get_object(settings.minio_bucket_music, scene["separated_vocal_object"])
        vocal_b64 = base64.b64encode(vocal_resp.read()).decode(); vocal_resp.close(); vocal_resp.release_conn()
        return {
            "original_audio_url": "data:audio/mpeg;base64," + orig_b64,
            "vocal_audio_url": "data:audio/wav;base64," + vocal_b64,
            "scene_number": scene_number,
            "cached": True,
        }

    # 오디오 로드
    from ..services.mv_pipeline import _resolve_audio_object_name
    audio_object_name = await _resolve_audio_object_name(job, mongo)
    if not audio_object_name:
        return JSONResponse(status_code=404, content={"error": "음악 파일을 찾을 수 없습니다."})

    minio_client = get_minio()
    resp = minio_client.get_object(bucket_name=settings.minio_bucket_music, object_name=audio_object_name)
    full_audio = resp.read()
    resp.close()
    resp.release_conn()

    # 구간 자르기
    from ..services.sync_labs_service import cut_audio_segment
    segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)

    # v43: Demucs 제거 — raw segment 를 그대로 사용 (Sync Labs 가 raw audio 를 직접 처리).
    vocal_bytes = segment_audio

    # MinIO에 저장
    original_object = "mv/{}/scenes/{:03d}_original_segment.mp3".format(job_id, scene_number)
    vocal_object = "mv/{}/scenes/{:03d}_vocal_only.wav".format(job_id, scene_number)

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=original_object,
        data=io.BytesIO(segment_audio),
        length=len(segment_audio),
        content_type="audio/mpeg",
    )
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=vocal_object,
        data=io.BytesIO(vocal_bytes),
        length=len(vocal_bytes),
        content_type="audio/wav",
    )

    # 씬에 저장
    scenes[scene_idx]["separated_original_object"] = original_object
    scenes[scene_idx]["separated_vocal_object"] = vocal_object
    await mongo.mv_jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"scenes": scenes}}
    )

    import base64
    return {
        "original_audio_url": "data:audio/mpeg;base64," + base64.b64encode(segment_audio).decode(),
        "vocal_audio_url": "data:audio/wav;base64," + base64.b64encode(vocal_bytes).decode(),
        "scene_number": scene_number,
        "cached": False,
    }


# ── POST /api/mv/jobs/{job_id}/select-scenario ─────────────────────────────

@router.post("/jobs/{job_id}/select-scenario")
async def select_scenario(
    job_id: str,
    body: SelectModelRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """User picks which model's scenario to use when dual models were run."""
    oid = _validate_object_id(job_id)
    mongo = get_mongo()
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenario_results = job.get("scenario_results")
    if not scenario_results:
        return JSONResponse(
            status_code=400,
            content={"error": "선택할 시나리오 결과가 없습니다."},
        )

    # Find the selected model's scenario (new shape: {"meta", "scenario", "model"})
    selected_scenario = None
    selected_meta = None
    for r in scenario_results:
        if r.get("model") == body.model:
            # New drama format stores both meta (dict) and scenario (str)
            selected_scenario = r.get("scenario")
            selected_meta = r.get("meta")
            # Backward-compat: legacy result shape was {"scenario": str, "model": str} only
            if not selected_meta and isinstance(selected_scenario, str):
                selected_meta = {
                    "characters": {},
                    "locations": {},
                    "scenario": selected_scenario,
                }
            break

    if not selected_scenario:
        return JSONResponse(
            status_code=400,
            content={"error": f"모델 '{body.model}'의 시나리오 결과를 찾을 수 없습니다."},
        )

    # v46: select 시점에 v45 scenario_* 필드와 inferred_relationship 도 함께 영속화 →
    # 추후 GET 응답·UI 표시·이벤트 매핑이 모두 일관된 데이터를 보게 한다.
    _set_fields = {
        "scenario": selected_scenario,
        "scenario_meta": selected_meta,
        "selected_scenario_model": body.model,
        "status": "splitting",
        "updated_at": datetime.utcnow(),
    }
    if isinstance(selected_meta, dict):
        _v45_keys = (
            "narrative", "premise", "character_states", "central_conflict",
            "emotional_core", "narrative_arc", "events",
        )
        for _k in _v45_keys:
            if _k in selected_meta:
                _set_fields["scenario_" + _k] = selected_meta.get(_k)
        if "inferred_relationship" in selected_meta:
            _set_fields["scenario_inferred_relationship"] = selected_meta.get("inferred_relationship")
        # v47: selected_archetype 영속화 (Stage 2 의 archetype 채택 결과)
        if "selected_archetype" in selected_meta:
            _set_fields["scenario_selected_archetype"] = selected_meta.get("selected_archetype")
    logger.info(
        "[SelectScenario] job=%s model=%s infer_rel=%s archetype=%s",
        job_id, body.model,
        (selected_meta.get("inferred_relationship") if isinstance(selected_meta, dict) else None) or "null",
        (selected_meta.get("selected_archetype") if isinstance(selected_meta, dict) else None) or "null",
    )
    await mongo.mv_jobs.update_one({"_id": oid}, {"$set": _set_fields})

    # Continue the pipeline (phase 1 scene splitting will use the selected scenario)
    from ..services.mv_pipeline import run_phase1_split, run_phase2_images
    background_tasks.add_task(_continue_after_scenario_select, oid, mongo)

    return {
        "job_id": job_id,
        "selected_model": body.model,
        "message": "시나리오가 선택되었습니다. 씬 분할이 계속됩니다.",
    }


async def _continue_after_scenario_select(job_id, mongo_db):
    """Continue pipeline after user selects a scenario."""
    from ..services.mv_pipeline import run_phase1_split, run_phase2_images, _get_job

    # run_phase1_split will use job["scenario"] which is now set
    await run_phase1_split(job_id, mongo_db)

    job = await _get_job(mongo_db, job_id)
    if not job or job.get("status") == "failed":
        return

    await run_phase2_images(job_id, mongo_db)


# ── POST /api/mv/jobs/{job_id}/select-prompts ──────────────────────────────

@router.post("/jobs/{job_id}/select-prompts")
async def select_prompts(
    job_id: str,
    body: SelectModelRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """User picks which model's prompts to use when dual models were run."""
    oid = _validate_object_id(job_id)
    mongo = get_mongo()
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    prompt_results = job.get("prompt_results")
    if not prompt_results:
        return JSONResponse(
            status_code=400,
            content={"error": "선택할 프롬프트 결과가 없습니다."},
        )

    # Find the selected model's prompts
    selected = None
    for r in prompt_results:
        if r.get("model") == body.model:
            selected = r.get("prompts")
            break

    if not selected:
        return JSONResponse(
            status_code=400,
            content={"error": f"모델 '{body.model}'의 프롬프트 결과를 찾을 수 없습니다."},
        )

    # Apply selected prompts to scenes
    scenes = job.get("scenes", [])
    prompt_by_number = {p["scene_number"]: p for p in selected}
    for scene in scenes:
        p = prompt_by_number.get(scene["scene_number"], {})
        scene["image_prompt"] = p.get("image_prompt", "")
        scene["video_image_prompt"] = p.get("video_image_prompt", "")
        scene["video_prompt"] = ""
        scene["description_ko"] = p.get("description_ko", "")
        scene["description"] = scene["image_prompt"]

    # ── v37: sanitize raw character names → @characterN tokens ──
    from ..services.mv_generator import sanitize_scene_character_tags
    characters_meta = ((job.get("scenario_meta") or {}).get("characters") or {})
    sanitize_scene_character_tags(scenes, characters_meta)

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "selected_prompt_model": body.model,
            "status": "scenes_ready",
            "updated_at": datetime.utcnow(),
        }},
    )

    # Continue with image generation
    from ..services.mv_pipeline import run_phase2_images
    background_tasks.add_task(run_phase2_images, oid, mongo)

    return {
        "job_id": job_id,
        "selected_model": body.model,
        "message": "프롬프트가 선택되었습니다. 이미지 생성이 시작됩니다.",
    }

