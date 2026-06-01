"""
v23.2 — Extra Video Generator (편집자 공간 — B 보드 영상 생성).

`extra_videos` 잡 한 건을 받아서 (source PNG, user_text, motion_presets, video_model,
use_seconds) → 4개 모델(veo/kling/seedance/grok) generator 중 하나에 위임하여 mp4
bytes 를 받고 → MinIO `videos` 버킷의
`extra/{mv_job_id}/videos/{extra_video_id}.mp4` 로 저장한다.

흐름:
  1) `compose_extra_video_prompt(...)` 로 모델별 최종 프롬프트 합성.
  2) MinIO photos 버킷에서 source PNG 다운로드 (Grok 제외 — Grok 은 presigned URL).
  3) `video_model` 분기 → 4 개 generator 위임.
     · veo / kling / seedance: image_bytes 전달.
     · grok: scene dict 의 `image_object_name` 으로 presigned URL.
  4) 반환된 mp4 bytes → MinIO videos 버킷 업로드 → object_name 반환.

추적자: extra_video_id, mv_job_id, user_id, video_model, use_seconds.
민감정보(API 키, prompt 전체) 출력 금지. prompt 는 길이만 로깅.

v23.2 범위: variant_count 는 호출자에서 1 로 강제하므로 본 함수는 단일 영상만 만든다.
v23.4+ 에서 N>1 활성화 시 본 함수를 N 회 부르거나, 모델별 batch 옵션을 도입한다.
"""

from __future__ import annotations

import io
import logging
import time
from typing import Optional

from ..config import settings
from ..database.minio import get_minio
from .extra_video_prompts import compose_extra_video_prompt
from .pre_mv_grok_generator import generate_scene_video_grok
from .pre_mv_kling_generator import generate_scene_video_kling
from .pre_mv_seedance_generator import generate_scene_video_seedance
from .pre_mv_veo_generator import generate_scene_video_veo

logger = logging.getLogger(__name__)


# 모델별 use_seconds 클램프 (4 개 generator 의 내부 값과 일치).
_VEO_FIXED = 8
_KLING_MIN, _KLING_MAX = 3, 15
_SEEDANCE_MIN, _SEEDANCE_MAX = 5, 15
_GROK_MIN, _GROK_MAX = 1, 10


def _clamp_use_seconds(video_model: str, use_seconds: float) -> float:
    """모델별 길이 클램프. Veo 는 8s 고정, 나머지는 min~max."""
    try:
        us = float(use_seconds)
    except (TypeError, ValueError):
        us = 5.0
    if video_model == "veo":
        return float(_VEO_FIXED)
    if video_model == "kling":
        return float(max(_KLING_MIN, min(_KLING_MAX, int(round(us)))))
    if video_model == "seedance":
        return float(max(_SEEDANCE_MIN, min(_SEEDANCE_MAX, int(round(us)))))
    if video_model == "grok":
        return float(max(_GROK_MIN, min(_GROK_MAX, int(round(us)))))
    return us


async def _load_source_png(object_name: str) -> bytes:
    """MinIO photos 버킷에서 PNG bytes 다운로드. 실패 시 ValueError."""
    if not object_name:
        raise ValueError("source_object_name 이 비어 있습니다.")
    client = get_minio()
    if client is None:
        raise ValueError("MinIO 클라이언트가 초기화되지 않았습니다.")
    try:
        resp = client.get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:  # noqa: BLE001
        raise ValueError(
            "source PNG 다운로드 실패 ({}: {})".format(
                type(e).__name__, str(e)[:200]
            )
        )
    if not data or len(data) < 64:
        raise ValueError("source PNG 가 비어 있거나 너무 작습니다.")
    return data


async def _put_video_to_minio(
    *,
    object_name: str,
    data: bytes,
) -> None:
    """mp4 bytes → MinIO videos 버킷 업로드."""
    client = get_minio()
    if client is None:
        raise ValueError("MinIO 클라이언트가 초기화되지 않았습니다.")
    client.put_object(
        bucket_name=settings.minio_bucket_videos,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type="video/mp4",
    )


def _build_scene_dict_for_generator(
    *,
    user_text: str,
    motion_block: str,
    use_seconds: float,
    image_object_name: Optional[str] = None,
) -> dict:
    """4 개 generator 가 받는 scene dict 어댑터.

    각 generator 가 내부적으로 `compose_video_prompt(scene=...)` 를 다시 부르므로,
    pre_mv_video_prompts 의 합성 슬롯들이 채워지도록 우리 user_text 를 그대로 매핑한다.
    """
    scene: dict = {
        "description": (user_text or "").strip(),
        "image_prompt": (user_text or "").strip(),
        "video_prompt": (motion_block or "").strip(),
        "use_seconds": float(use_seconds),
        "ref_sheet_ids": [],
    }
    if image_object_name:
        scene["image_object_name"] = image_object_name
    return scene


def _motion_block_for_scene(motion_presets: Optional[list[str]]) -> str:
    """description 합성용 motion 라인 합본. 알 수 없는 키는 무시."""
    from .extra_video_prompts import CAMERA_MOTION_PRESETS
    out = []
    for key in (motion_presets or []):
        if not isinstance(key, str):
            continue
        line = CAMERA_MOTION_PRESETS.get(key.strip())
        if line:
            out.append(line)
    return " ".join(out)


async def generate_extra_video(
    *,
    extra_video_id: str,
    mv_job_id: str,
    user_id: str,
    source_kind: str,
    source_object_name: str,
    user_text: str,
    motion_presets: list[str],
    video_model: str,
    use_seconds: float,
) -> dict:
    """편집자 공간 — 단일 B 영상 생성.

    Args:
      extra_video_id:     mongo `_id` (tracing).
      mv_job_id, user_id: tracing.
      source_kind:        "scene_image" | "uploaded" | "prev_video_last_frame".
      source_object_name: MinIO photos 버킷의 PNG object_name (caller 가 resolve).
      user_text:          사용자 자유 지시문.
      motion_presets:     CAMERA_MOTION_PRESETS 키 리스트.
      video_model:        "veo" | "kling" | "seedance" | "grok".
      use_seconds:        클램프 전 길이. 본 함수에서 모델별 클램프 적용.

    Returns:
      {"video_object_name": "extra/{mv_job_id}/videos/{extra_video_id}.mp4"}

    Raises:
      ValueError: 키 누락, MinIO 실패, generator 실패.
      TimeoutError: 모델 폴링 타임아웃.
    """
    started = time.time()
    clamped = _clamp_use_seconds(video_model, use_seconds)

    logger.info(
        "[ExtraVideo] entry extra_video_id=%s mv_job_id=%s user_id=%s "
        "video_model=%s source_kind=%s use_seconds_req=%.2f use_seconds=%.2f "
        "motion_count=%d user_text_len=%d source_object=%s",
        extra_video_id, mv_job_id, user_id, video_model, source_kind,
        float(use_seconds), clamped, len(motion_presets or []),
        len(user_text or ""), source_object_name,
    )

    # 1) prompt 합성 (로그용 — 실제 generator 들이 자기 합성을 다시 하므로 길이만 본다).
    composed_prompt = compose_extra_video_prompt(
        video_model=video_model,
        user_text=user_text,
        motion_presets=motion_presets,
        use_seconds=clamped,
        image_object_name=source_object_name if video_model == "grok" else None,
    )
    logger.info(
        "[ExtraVideo] prompt composed extra_video_id=%s video_model=%s prompt_len=%d",
        extra_video_id, video_model, len(composed_prompt),
    )

    motion_block = _motion_block_for_scene(motion_presets)
    scene_dict = _build_scene_dict_for_generator(
        user_text=user_text,
        motion_block=motion_block,
        use_seconds=clamped,
        image_object_name=source_object_name,
    )

    # 2) 모델 분기 호출 (use scene_number=0 — extra 라 phase3 가 아니므로).
    if video_model == "veo":
        if not settings.google_api_key:
            raise ValueError("Veo(Gemini) API 키가 설정되지 않았어요.")
        image_bytes = await _load_source_png(source_object_name)
        video_bytes = await generate_scene_video_veo(
            pre_mv_job_id="extra:{}".format(mv_job_id),
            scene_number=0,
            scene=scene_dict,
            image_bytes=image_bytes,
        )

    elif video_model == "kling":
        if not settings.kling_access_key or not settings.kling_secret_key:
            raise ValueError("Kling API 키가 설정되지 않았어요.")
        image_bytes = await _load_source_png(source_object_name)
        video_bytes = await generate_scene_video_kling(
            pre_mv_job_id="extra:{}".format(mv_job_id),
            scene_number=0,
            scene=scene_dict,
            image_bytes=image_bytes,
            char_ref_bytes_list=None,
        )

    elif video_model == "seedance":
        if not settings.fal_api_key:
            raise ValueError("Seedance(fal.ai) API 키가 설정되지 않았어요.")
        image_bytes = await _load_source_png(source_object_name)
        video_bytes = await generate_scene_video_seedance(
            pre_mv_job_id="extra:{}".format(mv_job_id),
            scene_number=0,
            scene=scene_dict,
            image_bytes=image_bytes,
        )

    elif video_model == "grok":
        if not settings.xai_api_key:
            raise ValueError(
                "Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요."
            )
        # Grok 은 image_bytes 가 아니라 image_object_name(photos 버킷)으로
        # presigned URL 을 발급해 사용한다 — scene_dict 에 이미 설정해둠.
        video_bytes = await generate_scene_video_grok(
            pre_mv_job_id="extra:{}".format(mv_job_id),
            scene_number=0,
            scene=scene_dict,
        )
    else:
        raise ValueError("지원하지 않는 video_model: {}".format(video_model))

    if not video_bytes or len(video_bytes) < 1024:
        raise ValueError("생성된 영상이 비어 있거나 너무 작습니다.")

    # 3) MinIO videos 버킷 업로드.
    video_object_name = "extra/{}/videos/{}.mp4".format(mv_job_id, extra_video_id)
    try:
        await _put_video_to_minio(
            object_name=video_object_name,
            data=video_bytes,
        )
    except Exception as e:  # noqa: BLE001
        raise ValueError(
            "MinIO 영상 업로드 실패 ({}: {})".format(
                type(e).__name__, str(e)[:200]
            )
        )

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[ExtraVideo] ok extra_video_id=%s mv_job_id=%s video_model=%s "
        "bytes=%d use_seconds=%.2f elapsed_ms=%d object=%s",
        extra_video_id, mv_job_id, video_model, len(video_bytes),
        clamped, elapsed_ms, video_object_name,
    )
    return {"video_object_name": video_object_name}
