"""v56 — Anthropic Claude Opus 4.7 기반 한국어/영어 번역 헬퍼.

씬 단위 3 필드 (`description` / `image_prompt` / `video_prompt`) 의 한국어↔영어
자동 동기화에 사용한다. 사용자는 한국어만 편집하며, 백엔드가 영어 prompt 를 자동
생성하여 이미지/영상 LLM 호출에 사용한다.

특징:
- 모델: claude-opus-4-7 (사용자 결정. 한국어 nuance + 시각·영상 prompt 컨텍스트에 최적)
- 빈 입력 → 빈 출력 (LLM 호출 X, 비용 0)
- 1회 retry
- PII 본문 미출력 — 로그엔 길이만

함수:
    translate_ko_to_en(text, context_hint="visual/video prompt") -> str
    translate_en_to_ko(text, context_hint="visual/video prompt") -> str
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

# v56 — 번역 전용 클라이언트 (mv_generator 의 _mv_anthropic_client 와 동일 클래스를
# 재사용해도 무방하나, 의존 cycle 회피를 위해 모듈 로컬 싱글톤 사용).
_translation_anthropic_client: Optional[anthropic.AsyncAnthropic] = None

# v56 — 번역 모델 ID 고정. 변경 시 단일 상수만 갱신.
TRANSLATION_MODEL_ID = "claude-opus-4-7"

# v56 — 최대 출력 토큰. 시각·영상 prompt 는 보통 1~3 문장 (≤500자).
# v75.2 — adaptive thinking 토큰까지 한도에서 차감되므로 8000 으로 상향 (실사용분만 과금).
_TRANSLATION_MAX_TOKENS = 8000


def _get_anthropic_client_for_translation() -> anthropic.AsyncAnthropic:
    """모듈 로컬 싱글톤. settings.anthropic_api_key 사용."""
    global _translation_anthropic_client
    if _translation_anthropic_client is None:
        _translation_anthropic_client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
        )
    return _translation_anthropic_client


def _first_text_block(resp) -> str:
    """v75 — adaptive-thinking 응답의 첫 text 블록 안전 추출. thinking-free 응답에도 호환."""
    try:
        for block in getattr(resp, "content", []) or []:
            if getattr(block, "type", None) == "text":
                return (getattr(block, "text", None) or "")
    except Exception:
        return ""
    return ""


def _build_translation_system_prompt(direction: str, context_hint: str) -> str:
    """direction: 'ko_to_en' or 'en_to_ko'. context_hint: 번역 도메인 힌트."""
    if direction == "ko_to_en":
        return (
            "다음 한국어 텍스트를 자연스럽고 정확한 영어로 번역하세요.\n"
            "컨텍스트: {context}.\n"
            "- 촬영 용어 (shot type / camera angle / lighting / camera motion 등) 는 "
            "표준 영어 영상·사진 용어로 옮기세요.\n"
            "- 캐릭터의 동작·표정·감정 뉘앙스를 정확히 보존하세요.\n"
            "- 추가 설명이나 머리말·꼬리말 없이 번역문만 출력하세요.\n"
            "- 마크다운 코드펜스(```)나 따옴표로 감싸지 마세요."
        ).format(context=context_hint)
    elif direction == "en_to_ko":
        return (
            "Translate the following English text into natural and accurate Korean.\n"
            "Context: {context}.\n"
            "- Render cinematography terms (shot type / camera angle / lighting / "
            "camera motion, etc.) using standard Korean visual/film vocabulary.\n"
            "- Preserve the character's action, expression, and emotional nuance precisely.\n"
            "- Output ONLY the translation, with no preamble, postscript, or quotes.\n"
            "- Do not wrap the output in markdown code fences (```) or quotes."
        ).format(context=context_hint)
    else:
        raise ValueError("invalid direction: {}".format(direction))


async def _call_anthropic_translation(
    direction: str, text: str, context_hint: str,
) -> str:
    """단일 Anthropic 호출. 응답 텍스트 strip 처리."""
    client = _get_anthropic_client_for_translation()
    system_prompt = _build_translation_system_prompt(direction, context_hint)

    # v75 — adaptive thinking + high effort. temperature 제거 (모든 Claude 호출 통일).
    kwargs = {
        "model": TRANSLATION_MODEL_ID,
        "system": system_prompt,
        "messages": [{"role": "user", "content": text}],
        "max_tokens": _TRANSLATION_MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
    }
    logger.info(
        "[ThinkingOn] stage=translation direction=%s model=%s effort=high",
        direction, TRANSLATION_MODEL_ID,
    )

    resp = await client.messages.create(**kwargs)
    # v75 — adaptive thinking 응답은 [ThinkingBlock, TextBlock] 순서. 안전 추출 헬퍼 사용.
    raw = _first_text_block(resp)
    if not raw:
        return ""
    raw = raw.strip()
    # 안전망 — 마크다운 코드펜스가 섞여 들어오면 제거
    if raw.startswith("```"):
        # ```lang\n...\n``` 또는 ```\n...\n```
        first_newline = raw.find("\n")
        if first_newline > 0:
            raw = raw[first_newline + 1 :]
        else:
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    # 따옴표로 감싼 경우 안전망
    if len(raw) >= 2 and raw[0] in ('"', "'") and raw[-1] == raw[0]:
        raw = raw[1:-1].strip()
    return raw


async def _translate_with_retry(
    direction: str, text: str, context_hint: str,
) -> str:
    """1회 retry 포함 호출. 모든 시도 실패 → 빈 문자열 반환 + warning 로그."""
    log_key = "TranslateKoEn" if direction == "ko_to_en" else "TranslateEnKo"
    in_len = len(text or "")

    last_err: Optional[Exception] = None
    for attempt in range(2):
        t0 = time.time()
        try:
            out = await _call_anthropic_translation(direction, text, context_hint)
            elapsed_ms = int((time.time() - t0) * 1000)
            logger.info(
                "[%s] len=%d model=%s elapsed_ms=%d attempt=%d",
                log_key,
                in_len,
                TRANSLATION_MODEL_ID,
                elapsed_ms,
                attempt + 1,
            )
            return out
        except Exception as e:  # noqa: BLE001
            last_err = e
            elapsed_ms = int((time.time() - t0) * 1000)
            logger.warning(
                "[%s] attempt=%d failed: %s elapsed_ms=%d",
                log_key,
                attempt + 1,
                str(e)[:200],
                elapsed_ms,
            )

    # 두 번 모두 실패 → 빈 문자열 반환 (호출자가 폴백 처리)
    logger.error(
        "[%s] failed: %s (in_len=%d)",
        log_key,
        str(last_err)[:200] if last_err else "unknown",
        in_len,
    )
    return ""


async def translate_ko_to_en(
    text: str, context_hint: str = "visual/video prompt",
) -> str:
    """한국어 → 영어 번역.

    빈 입력 (None / 빈 문자열 / 공백만) → 빈 출력 (LLM 호출 X).
    1회 retry. 실패 시 빈 문자열 반환.
    """
    if not text or not text.strip():
        return ""
    return await _translate_with_retry("ko_to_en", text.strip(), context_hint)


async def translate_en_to_ko(
    text: str, context_hint: str = "visual/video prompt",
) -> str:
    """영어 → 한국어 번역.

    빈 입력 → 빈 출력. 1회 retry. 실패 시 빈 문자열.
    """
    if not text or not text.strip():
        return ""
    return await _translate_with_retry("en_to_ko", text.strip(), context_hint)
