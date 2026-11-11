"""v3.428 MV 영상 모델 — Veo 사용 중지(11-11 대표 확정: 씨댄스·클링만).

- 고를 수 있는 모델: seedance(기본), kling
- 예전 요청·저장된 작업의 "veo"·"grok"·빈 값은 seedance 로 바꿔 계속 동작하게 한다.
"""
from typing import Optional

MV_VIDEO_MODELS = ("seedance", "kling")
MV_DEFAULT_VIDEO_MODEL = "seedance"
MV_LEGACY_VIDEO_MODELS = ("veo", "grok")


def normalize_video_model(value: Optional[str]) -> str:
    v = (value or "").strip().lower()
    return v if v in MV_VIDEO_MODELS else MV_DEFAULT_VIDEO_MODEL


def is_known_video_model(value: Optional[str]) -> bool:
    v = (value or "").strip().lower()
    return (not v) or v in MV_VIDEO_MODELS or v in MV_LEGACY_VIDEO_MODELS
