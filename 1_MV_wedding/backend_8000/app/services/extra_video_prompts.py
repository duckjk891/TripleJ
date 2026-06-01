"""
v23.2 — Extra Video Prompts (편집자 공간 — B 보드 영상 생성용 프롬프트 어댑터).

식전영상의 phase3 프롬프트 합성 모듈(`pre_mv_video_prompts.compose_video_prompt`)을
재활용하되, 편집자 공간 컨텍스트(자유로운 user_text + 카메라 모션 프리셋)에 맞춰
어댑터 scene dict 를 구성한다.

- 4 개 모델(veo/kling/seedance/grok) 각각의 템플릿을 그대로 사용 (모델별 다른 결과).
- 카메라 모션 프리셋 11종을 영문 한 줄씩 미리 prepend 하여 모델이 motion 의도를
  분명히 받게 한다.
- 식전영상과 달리 편집자 공간 씬 이미지는 "신랑+신부" 가 아닐 수도 있다(예: 풍경,
  업로드 이미지). 따라서 ref_sheet_ids 는 빈 리스트로 전달 → 합성 단계의
  "둘 다 보강" 문구는 기본값으로 들어가나, prefix 가 단지 prepend 문장이므로
  영향이 작다. 향후 v23.4 에서 자동 인식하도록 확장 여지 있음.

추적자: prompt_len 만 로깅 (내용 X), 민감정보 출력 금지.
"""

from __future__ import annotations

import logging
from typing import Optional

from .pre_mv_video_prompts import compose_video_prompt

logger = logging.getLogger(__name__)


# ── 카메라 모션 프리셋 (11종) ──────────────────────────────────────────────
# UI 에서 토글로 선택되며, 영문 한 줄씩 prompt 앞쪽에 prepend.
CAMERA_MOTION_PRESETS: dict[str, str] = {
    "zoom_in": "Slow zoom in.",
    "push_in": "Smooth dolly push in.",
    "pull_out": "Slow dolly pull out.",
    "pan_left": "Camera pans left.",
    "pan_right": "Camera pans right.",
    "crane_up": "Smooth crane up.",
    "crane_down": "Smooth crane down.",
    "tilt": "Soft tilt motion.",
    "bullet_time": "360-degree bullet-time orbit around the subject.",
    "static": "Locked static camera.",
    "tracking": "Tracking shot following the subject.",
}


def _resolve_motion_lines(motion_presets: Optional[list[str]]) -> list[str]:
    """선택된 프리셋 키 → 영문 라인 리스트. 알 수 없는 키는 조용히 무시."""
    out: list[str] = []
    for key in (motion_presets or []):
        if not isinstance(key, str):
            continue
        k = key.strip()
        if not k:
            continue
        line = CAMERA_MOTION_PRESETS.get(k)
        if line:
            out.append(line)
    return out


def compose_extra_video_prompt(
    *,
    video_model: str,
    user_text: str,
    motion_presets: Optional[list[str]],
    use_seconds: float,
    image_object_name: Optional[str] = None,
) -> str:
    """편집자 공간 — 모델별 영상 API 에 들어갈 최종 prompt 문자열.

    Args:
      video_model:        "veo" | "kling" | "seedance" | "grok".
      user_text:          사용자가 입력한 자유 지시문 (한/영 혼용 가능).
      motion_presets:     CAMERA_MOTION_PRESETS 키 리스트. 빈 리스트 가능.
      use_seconds:        영상 길이(초). 모델별 클램프는 호출자(generator)에서 처리.
      image_object_name:  Grok 만 사용 — MinIO photos 버킷의 PNG object_name.
                          나머지 모델은 image_bytes 로 들어가므로 None 이어도 OK.

    Returns:
      모델 호출용 영문 prompt 문자열. 1단락.
    """
    motion_lines = _resolve_motion_lines(motion_presets)
    motion_block = " ".join(motion_lines).strip()
    user_block = (user_text or "").strip()

    # description: 사용자 자유 지시문이 "action / 의도" 자리에 들어간다.
    # video_prompt: 카메라 모션 프리셋(영문 라인) 들이 모이고 prepend.
    # image_prompt: 사용자 자유 지시문 (모델별 합성 단계에서 subject/scene 슬롯에 위치).
    # use_seconds: 호출자가 클램프 후 전달.
    # ref_sheet_ids: 편집자 공간은 빈 리스트 — 합성 단계의 "둘 다" 보강 prepend 만 기본값.
    scene_adapter: dict = {
        "description": user_block,
        "image_prompt": user_block,
        "video_prompt": motion_block,
        "use_seconds": float(use_seconds),
        "ref_sheet_ids": [],
    }
    if image_object_name:
        scene_adapter["image_object_name"] = image_object_name

    final_prompt = compose_video_prompt(
        video_model=video_model,
        scene=scene_adapter,
        duration=float(use_seconds),
    )

    logger.info(
        "[ExtraVideoPrompt] composed video_model=%s prompt_len=%d motion_count=%d "
        "user_text_len=%d use_seconds=%.2f",
        video_model, len(final_prompt), len(motion_lines),
        len(user_block), float(use_seconds),
    )
    return final_prompt
