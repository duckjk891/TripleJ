"""
v76: Suno V5_5 voice cloning routes.

엔드포인트 (prefix /api/voice-clone):
  POST   /create                           — 소스 음성 업로드 + validate 요청
  POST   /{clone_id}/verify                — 검증 문구 음성 업로드 + generate 요청
  GET    /list                             — 사용자 클론 목록
  GET    /{clone_id}                       — 단일 클론
  DELETE /{clone_id}                       — 삭제 (Mongo + MinIO)
  POST   /{clone_id}/regenerate-phrase     — 검증 문구 재생성
  POST   /callback/validate?clone_id=...   — Suno → 우리 (검증 콜백, 인증 없음)
  POST   /callback/generate?clone_id=...   — Suno → 우리 (생성 콜백, 인증 없음)

기존 routes/voice_persona.py 와는 무관 (구버전 워크플로). 컬렉션: voice_clones.
"""
from __future__ import annotations

import io
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..services import voice_clone_service as svc
from ..services.audio_normalize import normalize_audio_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice-clone", tags=["voice-clone"])

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".webm", ".ogg"}  # v76.8: 마이크 녹음(webm/opus) 허용 — normalize 가 mp3 로 변환
ALLOWED_AUDIO_CT = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "audio/wave", "audio/m4a", "audio/x-m4a", "audio/mp4",
}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB
ALLOWED_STYLE_MODES = {"sing", "speak", "rap"}


# ── Response models ─────────────────────────────────────────────────────────


class CreateResponse(BaseModel):
    clone_id: str
    validate_task_id: str
    status: str


class VerifyResponse(BaseModel):
    clone_id: str
    generate_task_id: str
    status: str


class ListResponse(BaseModel):
    clones: list[dict]


class CloneResponse(BaseModel):
    clone_id: str
    status: str
    voice_name: str
    description: Optional[str] = None
    voice_id: Optional[str] = None
    validate_info: Optional[dict] = None
    error_message: Optional[str] = None


class DeleteResponse(BaseModel):
    deleted: bool


class RegenerateResponse(BaseModel):
    validate_task_id: str


class CallbackAck(BaseModel):
    ok: bool


# ── helpers ─────────────────────────────────────────────────────────────────


def _validate_audio_upload(file: UploadFile) -> str:
    """Return file extension or raise HTTPException."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"허용 음원 확장자: {', '.join(sorted(ALLOWED_AUDIO_EXT))}",
        )
    ct = (file.content_type or "").lower()
    if ct and ct not in ALLOWED_AUDIO_CT:
        # 일부 클라가 octet-stream 으로 보내는 경우 허용
        if ct != "application/octet-stream":
            logger.warning("[voice_clone] unexpected content_type=%s ext=%s — accepting", ct, ext)
    return ext


def _content_type_for_ext(ext: str) -> str:
    return {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
    }.get(ext, "application/octet-stream")


async def _save_audio_to_minio(
    user_id: str,
    clone_id: str,
    kind: str,  # "source" | "verify"
    file: UploadFile,
) -> str:
    ext = _validate_audio_upload(file)
    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="음원 크기는 50MB 이하여야 합니다.")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    object_name = f"voice-clones/{user_id}/{clone_id}/{kind}{ext}"
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_audio,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=_content_type_for_ext(ext),
    )
    logger.info(
        "[voice_clone:%s] minio put %s object=%s bytes=%d ct=%s",
        clone_id, kind, object_name, len(contents), _content_type_for_ext(ext),
    )
    return object_name


# ── routes ──────────────────────────────────────────────────────────────────


@router.post("/create", response_model=CreateResponse)
async def create(
    source_file: UploadFile = File(...),
    voice_name: str = Form(...),
    description: str = Form(""),
    vocal_start_s: float = Form(...),
    vocal_end_s: float = Form(...),
    language: str = Form("ko"),
    style_mode: str = Form("sing"),
    current_user=Depends(get_current_user),
):
    """소스 음성 업로드 → /create → /voice/validate 호출."""
    user_id = str(current_user["id"])
    voice_name = (voice_name or "").strip()
    if not voice_name:
        raise HTTPException(status_code=400, detail="voice_name 은 필수입니다.")
    if vocal_end_s <= vocal_start_s:
        raise HTTPException(status_code=400, detail="vocal_end_s 는 vocal_start_s 보다 커야 합니다.")
    if style_mode not in ALLOWED_STYLE_MODES:
        raise HTTPException(status_code=400, detail=f"style_mode 는 {sorted(ALLOWED_STYLE_MODES)} 중 하나여야 합니다.")

    # MinIO 업로드는 clone_id 가 필요 → 먼저 임시 path 로 업로드 후 rename 대신
    # service 에서 clone_id 생성 후 다시 업로드 시키지 말고,
    # 여기서 임시 ObjectId 형태로 path 를 잡되 service insert 와 일치시키기 위해
    # 다음 순서로 진행: (1) Mongo doc 만들기는 service 가 하므로, source 를
    # user_id+filename 기반 임시 path 로 저장 후 service 호출. service 가 doc
    # insert 하면서 그 object_name 을 doc 에 기록.
    import uuid as _uuid
    tmp_id = _uuid.uuid4().hex
    ext = _validate_audio_upload(source_file)
    contents = await source_file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="음원 크기는 50MB 이하여야 합니다.")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    # v76.3: 사용자 음원 → stereo 44.1k 192k mp3 로 ffmpeg 정규화.
    # sunoapi 가 mono/저비트레이트/sine-tone 같은 비표준 음원에 generic Internal Error 를 던지는 문제 회피.
    try:
        norm_bytes, norm_meta = normalize_audio_bytes(contents, ext)
    except ValueError as e:
        logger.warning("[voice_clone] normalize ValueError user=%s err=%s", user_id, e)
        raise HTTPException(
            status_code=422,
            detail="오디오가 너무 짧거나 형식이 잘못되었습니다. 15초 이상의 명확한 보컬 음원을 업로드해주세요.",
        )
    duration_s = float(norm_meta.get("duration_s") or 0.0)
    sample_rate = int(norm_meta.get("in_sample_rate") or 0)
    if duration_s < 5.0 or sample_rate == 0:
        logger.warning(
            "[voice_clone] normalize rejected user=%s duration=%.2f sr=%d",
            user_id, duration_s, sample_rate,
        )
        raise HTTPException(
            status_code=422,
            detail="오디오가 너무 짧거나 형식이 잘못되었습니다. 15초 이상의 명확한 보컬 음원을 업로드해주세요.",
        )
    logger.info(
        "[voice_clone] normalize OK in_ext=%s -> %d bytes duration=%.1fs",
        ext, len(norm_bytes), duration_s,
    )

    # vocal_start_s / vocal_end_s 가 duration 보다 크면 자동 클리핑.
    if vocal_start_s < 0 or vocal_start_s >= duration_s:
        logger.info(
            "[voice_clone] clip vocal_start_s=%.2f -> 0 (duration=%.2f)",
            vocal_start_s, duration_s,
        )
        vocal_start_s = 0.0
    if vocal_end_s > duration_s:
        logger.info(
            "[voice_clone] clip vocal_end_s=%.2f -> %.2f (duration=%.2f)",
            vocal_end_s, duration_s, duration_s,
        )
        vocal_end_s = duration_s
    if vocal_end_s <= vocal_start_s:
        # 클리핑 결과 역전 → 전체 구간으로 보정
        vocal_start_s = 0.0
        vocal_end_s = duration_s

    # 정규화 mp3 를 MinIO 에 저장 (확장자는 항상 .mp3 로 강제).
    object_name = f"voice-clones/{user_id}/{tmp_id}/source.mp3"
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_audio,
        object_name=object_name,
        data=io.BytesIO(norm_bytes),
        length=len(norm_bytes),
        content_type="audio/mpeg",
    )
    logger.info(
        "[voice_clone] create upload user=%s tmp_id=%s object=%s bytes=%d (normalized from ext=%s in_size=%d)",
        user_id, tmp_id, object_name, len(norm_bytes), ext, len(contents),
    )

    try:
        result = await svc.create_voice_clone(
            user_id=user_id,
            voice_name=voice_name,
            description=description or "",
            source_object_name=object_name,
            vocal_start_s=vocal_start_s,
            vocal_end_s=vocal_end_s,
            language=language,
            style_mode=style_mode,
        )
    except ValueError as e:
        logger.warning("[voice_clone] create ValueError user=%s err=%s", user_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[voice_clone] create failed user=%s", user_id)
        raise HTTPException(status_code=500, detail="voice clone 생성 실패")

    return CreateResponse(
        clone_id=result["clone_id"],
        validate_task_id=result["validate_task_id"],
        status="validating",
    )


ALLOWED_SKILL_LEVELS = {"beginner", "intermediate", "advanced", "professional"}


@router.post("/{clone_id}/verify", response_model=VerifyResponse)
async def verify(
    clone_id: str,
    verify_file: UploadFile = File(...),
    singer_skill_level: str = Form(...),
    current_user=Depends(get_current_user),
):
    """v76.7: singer_skill_level 은 sunoapi 스펙대로 string enum."""
    user_id = str(current_user["id"])
    doc = await svc.get_voice_clone(user_id, clone_id)
    if not doc:
        raise HTTPException(status_code=404, detail="voice_clone not found")
    singer_skill_level = (singer_skill_level or "").strip().lower()
    if singer_skill_level not in ALLOWED_SKILL_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"singer_skill_level 은 {sorted(ALLOWED_SKILL_LEVELS)} 중 하나여야 합니다.",
        )

    # v76.8: verify 도 정규화 적용 (마이크 녹음 webm → stereo 44.1k 192k mp3).
    # _save_audio_to_minio 는 raw 저장이라 webm 그대로 들어가서 sunoapi 가 거부 가능.
    ext = _validate_audio_upload(verify_file)
    contents = await verify_file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="음원 크기는 50MB 이하여야 합니다.")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    try:
        norm_bytes, _norm_meta = normalize_audio_bytes(contents, ext)
    except ValueError as e:
        logger.warning("[voice_clone:%s] verify normalize ValueError err=%s", clone_id, e)
        raise HTTPException(
            status_code=422,
            detail="검증 녹음을 처리할 수 없습니다. 5초 이상의 명확한 음원을 사용해주세요.",
        )
    logger.info(
        "[voice_clone:%s] verify normalize OK in_ext=%s -> %d bytes",
        clone_id, ext, len(norm_bytes),
    )
    verify_object = f"voice-clones/{user_id}/{clone_id}/verify.mp3"
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_audio,
        object_name=verify_object,
        data=io.BytesIO(norm_bytes),
        length=len(norm_bytes),
        content_type="audio/mpeg",
    )
    logger.info(
        "[voice_clone:%s] minio put verify object=%s bytes=%d",
        clone_id, verify_object, len(norm_bytes),
    )

    try:
        result = await svc.submit_verify(clone_id, verify_object, singer_skill_level)
    except ValueError as e:
        logger.warning("[voice_clone:%s] verify ValueError err=%s", clone_id, e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[voice_clone:%s] verify failed", clone_id)
        raise HTTPException(status_code=500, detail="verify 실패")

    return VerifyResponse(
        clone_id=result["clone_id"],
        generate_task_id=result["generate_task_id"],
        status="generating",
    )


@router.get("/list", response_model=ListResponse)
async def list_clones(current_user=Depends(get_current_user)):
    user_id = str(current_user["id"])
    clones = await svc.list_voice_clones(user_id)
    return ListResponse(clones=clones)


@router.get("/{clone_id}")
async def get_clone(clone_id: str, current_user=Depends(get_current_user)):
    """v76.2: status 가 진행중(validating/generating)이면 sunoapi 폴링 한번 같이 수행.

    콜백 미수신 환경(9005 외부 미노출)에서도 frontend wizard 가 GET 폴링 1번 = 백엔드 1번 sunoapi 폴링.
    """
    user_id = str(current_user["id"])
    doc = await svc.get_voice_clone(user_id, clone_id)
    if not doc:
        raise HTTPException(status_code=404, detail="voice_clone not found")

    status = (doc.get("status") or "").strip()
    try:
        if status == "validating" and doc.get("validate_task_id") and not doc.get("validate_info"):
            updated = await svc.poll_validate_info(clone_id)
            if updated:
                doc = updated
        elif status == "generating" and doc.get("generate_task_id") and not doc.get("voice_id"):
            updated = await svc.poll_generate_voice(clone_id)
            if updated:
                doc = updated
    except Exception:
        logger.exception("[voice_clone:%s] auto poll on GET failed status=%s", clone_id, status)

    return doc


@router.delete("/{clone_id}", response_model=DeleteResponse)
async def delete_clone(clone_id: str, current_user=Depends(get_current_user)):
    user_id = str(current_user["id"])
    ok = await svc.delete_voice_clone(user_id, clone_id)
    if not ok:
        raise HTTPException(status_code=404, detail="voice_clone not found")
    return DeleteResponse(deleted=True)


@router.post("/{clone_id}/regenerate-phrase", response_model=RegenerateResponse)
async def regenerate_phrase(clone_id: str, current_user=Depends(get_current_user)):
    user_id = str(current_user["id"])
    doc = await svc.get_voice_clone(user_id, clone_id)
    if not doc:
        raise HTTPException(status_code=404, detail="voice_clone not found")
    try:
        result = await svc.regenerate_phrase(clone_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("[voice_clone:%s] regenerate_phrase failed", clone_id)
        raise HTTPException(status_code=500, detail="regenerate 실패")
    return RegenerateResponse(validate_task_id=result["validate_task_id"])


# ── Callback receivers (no auth — Suno calls these) ─────────────────────────


@router.post("/callback/validate", response_model=CallbackAck)
async def callback_validate(clone_id: str, request: Request):
    """Suno validate 콜백. clone_id 는 쿼리, body 는 임의 JSON."""
    if not clone_id:
        raise HTTPException(status_code=400, detail="clone_id is required")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    logger.info(
        "[voice_clone:%s] callback/validate received body_keys=%s",
        clone_id, list(payload.keys()) if isinstance(payload, dict) else "non-dict",
    )
    try:
        await svc.handle_validate_callback(clone_id, payload if isinstance(payload, dict) else {})
    except Exception:
        logger.exception("[voice_clone:%s] handle_validate_callback failed", clone_id)
        # Suno 가 재시도하지 않도록 200 으로 응답
    return CallbackAck(ok=True)


@router.post("/callback/generate", response_model=CallbackAck)
async def callback_generate(clone_id: str, request: Request):
    """Suno generate 콜백."""
    if not clone_id:
        raise HTTPException(status_code=400, detail="clone_id is required")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    logger.info(
        "[voice_clone:%s] callback/generate received body_keys=%s",
        clone_id, list(payload.keys()) if isinstance(payload, dict) else "non-dict",
    )
    try:
        await svc.handle_generate_callback(clone_id, payload if isinstance(payload, dict) else {})
    except Exception:
        logger.exception("[voice_clone:%s] handle_generate_callback failed", clone_id)
    return CallbackAck(ok=True)
