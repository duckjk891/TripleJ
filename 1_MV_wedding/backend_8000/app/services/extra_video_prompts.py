"""
v24.3 — Extra Video Prompts (편집자 공간 — B 보드 영상 생성용 프롬프트, 옵션 B).

식전영상의 phase3 시네마틱 wedding/lighting 보강 템플릿(`compose_video_prompt`)을
**우회**하고, 사용자가 자유로이 입력한 한글 user_text 를 영문으로 번역한 뒤
카메라 모션 프리셋 라인과 단순 결합한 prompt 를 모델에 전달한다.

옵션 B 사양 (v24.3):
- user_text 영문 번역 (한글 detect fast-path 적용 — 영문 입력은 LLM 호출 skip).
- motion_block = 카메라 모션 프리셋 라인 합본.
- 최종 = f"{user_text_en}. Camera: {motion_block}" → `sanitize_video_prompt` 통과.
- 보강 prefix 없음. UI 에는 한글 그대로 유지.

추적자: prompt_len, motion_count, 번역 elapsed_ms 만 로깅. preview 는 80 chars 까지.
민감정보(API 키, 전체 prompt) 출력 금지.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Optional

from .pre_mv_video_prompts import sanitize_video_prompt
from .translation import translate_ko_to_en

logger = logging.getLogger(__name__)


# ── 카메라 모션 프리셋 (11종) ──────────────────────────────────────────────
# UI 에서 토글로 선택되며, 영문 한 줄씩 prompt 뒤쪽에 "Camera: ..." 형태로 결합.
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


_HANGUL_RE = re.compile(r"[가-힣]")
_MENTION_RE = re.compile(r"@[A-Za-z0-9_\-가-힣]+")


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


async def compose_extra_video_prompt(
    *,
    video_model: str,
    user_text: str,
    motion_presets: Optional[list[str]],
    use_seconds: float,
    image_object_name: Optional[str] = None,  # noqa: ARG001 — 호환 위해 잔존
    refs: Optional[list[dict]] = None,
) -> str:
    """편집자 공간 — 모델별 영상 API 에 들어갈 최종 prompt 문자열 (옵션 B).

    Args:
      video_model:        "veo" | "kling" | "seedance" | "grok".
      user_text:          사용자가 입력한 자유 지시문 (한/영 혼용 가능).
      motion_presets:     CAMERA_MOTION_PRESETS 키 리스트. 빈 리스트 가능.
      use_seconds:        영상 길이(초). 모델별 클램프는 호출자(generator)에서 처리.
      image_object_name:  (사용 안 함, 옵션 B 단순 결합) — 호환을 위해 시그니처 유지.

    Returns:
      모델 호출용 영문 prompt 문자열. 1단락.
    """
    motion_lines = _resolve_motion_lines(motion_presets)
    user_block = (user_text or "").strip()

    logger.info(
        "[ExtraVideoPrompt] entry video_model=%s user_text_len=%d "
        "motion_count=%d use_seconds=%.2f",
        video_model, len(user_block), len(motion_lines), float(use_seconds),
    )

    # ── 1) 한→영 번역 (한글 detect fast-path + v24.4 @멘션 보존) ─────────
    user_text_en = ""
    before_len = len(user_block)
    elapsed_ms = 0
    retried = 0
    fallback_used = 0
    src_set: set[str] = set()
    dst_set: set[str] = set()
    if user_block:
        src_set = set(_MENTION_RE.findall(user_block))
        if not _HANGUL_RE.search(user_block):
            # 영문/숫자/기호만 — LLM 호출 skip. 멘션도 그대로 보존됨.
            user_text_en = user_block
        else:
            t0 = time.time()
            try:
                translated = await translate_ko_to_en(
                    user_block,
                    context_hint="video generation prompt",
                    preserve_mentions=True,
                )
            except Exception as e:  # noqa: BLE001
                translated = ""
                logger.warning(
                    "[ExtraVideoPrompt] translate raised: %s",
                    str(e)[:200],
                )
            elapsed_ms = int((time.time() - t0) * 1000)
            if translated and translated.strip():
                user_text_en = translated.strip()
            else:
                # 번역 실패 폴백 — 원본 그대로. 한글이 모델로 갈 수 있으나
                # 빈 prompt 보다는 사용자 의도 보존이 낫다.
                user_text_en = user_block
                logger.warning(
                    "[ExtraVideoPrompt] translation empty/failed — fallback to "
                    "original user_text (len=%d)",
                    len(user_block),
                )

            # v24.4 — post-validation: src/dst 멘션 set 비교 → 누락 시 1회 재시도.
            dst_set = set(_MENTION_RE.findall(user_text_en))
            missing = src_set - dst_set
            if missing:
                retry_hint = (
                    "video generation prompt — preserve these @-tokens verbatim: "
                    + ", ".join(sorted(missing))
                )
                t1 = time.time()
                try:
                    translated2 = await translate_ko_to_en(
                        user_block,
                        context_hint=retry_hint,
                        preserve_mentions=True,
                    )
                except Exception as e:  # noqa: BLE001
                    translated2 = ""
                    logger.warning(
                        "[ExtraVideoPrompt] translate retry raised: %s",
                        str(e)[:200],
                    )
                retry_elapsed_ms = int((time.time() - t1) * 1000)
                retried = 1
                if translated2 and translated2.strip():
                    user_text_en = translated2.strip()
                logger.info(
                    "[ExtraVideoPrompt] translate retry elapsed_ms=%d",
                    retry_elapsed_ms,
                )
                dst_set = set(_MENTION_RE.findall(user_text_en))
                missing = src_set - dst_set

            # v24.4 — 그래도 missing 잔존 시 텍스트 끝에 fallback 부착.
            if missing:
                user_text_en = (
                    user_text_en.rstrip()
                    + " (assets: "
                    + " ".join(sorted(missing))
                    + ")"
                )
                fallback_used = 1
                logger.warning(
                    "[ExtraVideoPrompt] mention fallback applied missing=%d",
                    len(missing),
                )
                dst_set = set(_MENTION_RE.findall(user_text_en))

        logger.info(
            "[ExtraVideoPrompt] translated user_text len=%d→%d elapsed_ms=%d",
            before_len, len(user_text_en), elapsed_ms,
        )

    missing_final = src_set - dst_set
    refs_count = len(refs or [])
    logger.info(
        "[ExtraVideoPrompt] mentions src=%d dst=%d missing=%d retried=%d "
        "fallback=%d refs_count=%d",
        len(src_set), len(dst_set), len(missing_final),
        retried, fallback_used, refs_count,
    )

    # ── 2) motion_block 합본 ────────────────────────────────────────────
    motion_block = " ".join(motion_lines).strip()

    # ── 3) 최종 prompt 합성 (옵션 B — 보강 prefix 없음) ──────────────────
    if user_text_en and motion_block:
        # user_text_en 끝의 마침표 중복 정리.
        head = user_text_en.rstrip()
        if head.endswith("."):
            head = head[:-1].rstrip()
        combined = "{}. Camera: {}".format(head, motion_block)
    elif user_text_en:
        combined = user_text_en
    elif motion_block:
        combined = "Camera: {}".format(motion_block)
    else:
        combined = "Natural cinematic motion."

    # v24.4 — refs 가 있고 비어있지 않으면 짧은 ref 메타 라인 부착 (모델이
    # 텍스트로 ref 정보를 인지하도록). display_name 이 있는 ref 만 사용.
    if refs:
        meta_items: list[str] = []
        for r in refs:
            if not isinstance(r, dict):
                continue
            dn = (r.get("display_name") or "").strip()
            if not dn:
                continue
            ty = (r.get("type") or "").strip()
            meta_items.append("@" + dn + " (" + ty + ")")
        if meta_items:
            combined = combined.rstrip() + " Refs: " + ", ".join(meta_items) + "."

    # ── 4) sanitize 통과 ────────────────────────────────────────────────
    final = sanitize_video_prompt(combined)

    preview = final[:80]
    logger.info(
        "[ExtraVideoPrompt] composed video_model=%s prompt_len=%d "
        "motion_count=%d preview=%s",
        video_model, len(final), len(motion_lines), preview,
    )
    return final
