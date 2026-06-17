"""v26 — Anthropic Claude Opus 4.7 기반 한국어/영어 번역 헬퍼.

0_platform_music/backend_9004 의 동일 모듈을 그대로 이식. wedding 백엔드에서는
suno_generator 가 한국어 genre/moods 를 영문 style 태그로 자동 변환하는 데 사용한다.

특징:
- 모델: claude-opus-4-7
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

_translation_anthropic_client: Optional[anthropic.AsyncAnthropic] = None

TRANSLATION_MODEL_ID = "claude-opus-4-7"

_TRANSLATION_MAX_TOKENS = 800


def _get_anthropic_client_for_translation() -> anthropic.AsyncAnthropic:
    """모듈 로컬 싱글톤. settings.anthropic_api_key 사용."""
    global _translation_anthropic_client
    if _translation_anthropic_client is None:
        _translation_anthropic_client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
        )
    return _translation_anthropic_client


def _build_translation_system_prompt(
    direction: str, context_hint: str, preserve_mentions: bool = False,
) -> str:
    """direction: 'ko_to_en' or 'en_to_ko'. context_hint: 번역 도메인 힌트.

    v24.4 — `preserve_mentions=True` 면 ko_to_en 분기에서 `@xxx` 자산 토큰
    보존 규칙 + few-shot 예시 1줄을 system prompt 끝에 부착한다. en_to_ko 는
    호환 위해 인자만 수용하고 본문에는 영향 없음.
    """
    if direction == "ko_to_en":
        base = (
            "다음 한국어 텍스트를 자연스럽고 정확한 영어로 번역하세요.\n"
            "컨텍스트: {context}.\n"
            "- 촬영 용어 (shot type / camera angle / lighting / camera motion 등) 는 "
            "표준 영어 영상·사진 용어로 옮기세요.\n"
            "- 캐릭터의 동작·표정·감정 뉘앙스를 정확히 보존하세요.\n"
            "- 추가 설명이나 머리말·꼬리말 없이 번역문만 출력하세요.\n"
            "- 마크다운 코드펜스(```)나 따옴표로 감싸지 마세요."
        ).format(context=context_hint)
        if preserve_mentions:
            base += (
                "\n- \"@\" 으로 시작하는 토큰 (영문/숫자/언더스코어/하이픈/한글 조합) 은 "
                "자산 식별자입니다. 번역하지 말고 본문에 원형 그대로 보존하세요. "
                "위치만 자연스러운 영문 어순에 맞게 옮기세요."
                "\n- 예시: \"@신랑_캐주얼 이 웃으면서 @웨딩홀 안으로 들어간다\" "
                "→ \"@신랑_캐주얼 smiles while entering @웨딩홀\"."
            )
        return base
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
    preserve_mentions: bool = False,
) -> str:
    """단일 Anthropic 호출. 응답 텍스트 strip 처리."""
    client = _get_anthropic_client_for_translation()
    system_prompt = _build_translation_system_prompt(
        direction, context_hint, preserve_mentions=preserve_mentions,
    )

    kwargs = {
        "model": TRANSLATION_MODEL_ID,
        "system": system_prompt,
        "messages": [{"role": "user", "content": text}],
        "max_tokens": _TRANSLATION_MAX_TOKENS,
    }
    if "opus-4-7" not in TRANSLATION_MODEL_ID:
        kwargs["temperature"] = 0.2

    resp = await client.messages.create(**kwargs)
    if not resp.content:
        return ""
    raw = resp.content[0].text or ""
    raw = raw.strip()
    if raw.startswith("```"):
        first_newline = raw.find("\n")
        if first_newline > 0:
            raw = raw[first_newline + 1 :]
        else:
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    if len(raw) >= 2 and raw[0] in ('"', "'") and raw[-1] == raw[0]:
        raw = raw[1:-1].strip()
    return raw


async def _translate_with_retry(
    direction: str, text: str, context_hint: str,
    preserve_mentions: bool = False,
) -> str:
    """1회 retry 포함 호출. 모든 시도 실패 → 빈 문자열 반환 + warning 로그."""
    log_key = "TranslateKoEn" if direction == "ko_to_en" else "TranslateEnKo"
    in_len = len(text or "")

    last_err: Optional[Exception] = None
    for attempt in range(2):
        t0 = time.time()
        try:
            out = await _call_anthropic_translation(
                direction, text, context_hint,
                preserve_mentions=preserve_mentions,
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            logger.info(
                "[%s] len=%d model=%s elapsed_ms=%d attempt=%d preserve_mentions=%d",
                log_key,
                in_len,
                TRANSLATION_MODEL_ID,
                elapsed_ms,
                attempt + 1,
                1 if preserve_mentions else 0,
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

    logger.error(
        "[%s] failed: %s (in_len=%d)",
        log_key,
        str(last_err)[:200] if last_err else "unknown",
        in_len,
    )
    return ""


async def translate_ko_to_en(
    text: str, context_hint: str = "visual/video prompt",
    preserve_mentions: bool = False,
) -> str:
    """한국어 → 영어 번역.

    빈 입력 (None / 빈 문자열 / 공백만) → 빈 출력 (LLM 호출 X).
    1회 retry. 실패 시 빈 문자열 반환.

    v24.4 — `preserve_mentions=True` 면 `@xxx` 자산 토큰을 보존하라는
    시스템 규칙 + few-shot 1줄이 system prompt 에 추가된다. 기본 False 라
    suno_generator 등 기존 호출자는 무영향.
    """
    if not text or not text.strip():
        return ""
    return await _translate_with_retry(
        "ko_to_en", text.strip(), context_hint,
        preserve_mentions=preserve_mentions,
    )


async def translate_en_to_ko(
    text: str, context_hint: str = "visual/video prompt",
) -> str:
    """영어 → 한국어 번역.

    빈 입력 → 빈 출력. 1회 retry. 실패 시 빈 문자열.
    """
    if not text or not text.strip():
        return ""
    return await _translate_with_retry("en_to_ko", text.strip(), context_hint)
