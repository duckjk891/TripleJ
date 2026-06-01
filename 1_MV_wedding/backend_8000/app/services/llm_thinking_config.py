"""v27 — LLM thinking/reasoning 모드 공통 설정.

2026년 시점 공식 사양 (웹검색 확인 결과):

- **Anthropic Claude Opus 4.6/4.7/4.8, Sonnet 4.6**: adaptive thinking 모드 권장
  - 파라미터: `thinking={"type": "adaptive"}`
  - Opus 4.8 은 adaptive 만 지원 (legacy `type:"enabled"` 거부)
  - **CRITICAL**: Opus 4.7+ 는 요청 본문에 `temperature`/`top_p`/`top_k` 가 있으면 400.
- **OpenAI GPT-5.x, o1, o3, o4 (reasoning 모델)**:
  - 파라미터: `reasoning_effort` ∈ {none, low, medium, high, xhigh}
  - **CRITICAL**: temperature/top_p 제거 필수 (400 거부).

호출자는 base kwargs 빌드 → 본 모듈의 헬퍼로 thinking/reasoning 머지 → strip 으로
non-supported sampling 파라미터 제거 → SDK 호출. 글로벌 off 는 `LLM_THINKING_DISABLED=1`.

출처:
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- https://blog.laozhang.ai/en/posts/claude-opus-4-7-temperature-parameter
- https://www.nxcode.io/resources/news/gpt-5-4-api-developer-guide-reasoning-computer-use-2026
"""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# adaptive thinking 을 정식 지원하는 Claude 모델들 (2026-05 기준).
_ADAPTIVE_CLAUDE_MODELS = frozenset({
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
})

# reasoning_effort 를 지원/요구하는 OpenAI 모델 prefix.
_REASONING_OPENAI_PREFIXES = ("gpt-5", "o1", "o3", "o4")

# 사용자 요청 — "다 켜라" → high. xhigh 는 비용/지연 큼.
_DEFAULT_OPENAI_REASONING_EFFORT = "high"


def _is_globally_disabled() -> bool:
    return os.environ.get("LLM_THINKING_DISABLED", "").strip() in ("1", "true", "yes")


def is_adaptive_claude(model: str) -> bool:
    return (model or "").strip() in _ADAPTIVE_CLAUDE_MODELS


def is_reasoning_openai(model: str) -> bool:
    m = (model or "").strip()
    return any(m.startswith(p) for p in _REASONING_OPENAI_PREFIXES)


def claude_thinking_kwargs(model: str) -> dict[str, Any]:
    """Adaptive thinking kwargs for Claude Opus 4.6+/Sonnet 4.6+.

    Returns an empty dict if the model isn't in the adaptive set, or if the
    environment variable `LLM_THINKING_DISABLED=1` is set.
    """
    if _is_globally_disabled():
        return {}
    if is_adaptive_claude(model):
        return {"thinking": {"type": "adaptive"}}
    return {}


def openai_reasoning_kwargs(
    model: str,
    *,
    effort: str = _DEFAULT_OPENAI_REASONING_EFFORT,
) -> dict[str, Any]:
    """reasoning_effort kwargs for GPT-5.x / o-series reasoning models.

    Returns an empty dict for non-reasoning models or when globally disabled.
    """
    if _is_globally_disabled():
        return {}
    if is_reasoning_openai(model):
        return {"reasoning_effort": effort}
    return {}


def strip_unsupported_sampling(kwargs: dict[str, Any], model: str) -> dict[str, Any]:
    """In-place remove `temperature`/`top_p`/`top_k` if the model rejects them.

    Opus 4.7+ and GPT-5+ reject these keys with a 400 even when the value is
    the same as the default — presence alone triggers the rejection. This
    helper sanitizes the caller's kwargs so other parts of the codebase don't
    need to track the moving target of which models accept which params.
    """
    if _is_globally_disabled():
        return kwargs
    if not (is_adaptive_claude(model) or is_reasoning_openai(model)):
        return kwargs
    removed = []
    for k in ("temperature", "top_p", "top_k"):
        if k in kwargs:
            kwargs.pop(k, None)
            removed.append(k)
    if removed:
        logger.info(
            "[ThinkingConfig] stripped sampling params model=%s removed=%s",
            model, removed,
        )
    return kwargs


def apply_thinking_to_anthropic(
    kwargs: dict[str, Any], model: str,
) -> dict[str, Any]:
    """Convenience — strip sampling + merge adaptive thinking. In-place + returns."""
    strip_unsupported_sampling(kwargs, model)
    kwargs.update(claude_thinking_kwargs(model))
    return kwargs


def apply_reasoning_to_openai(
    kwargs: dict[str, Any], model: str,
    *,
    effort: str = _DEFAULT_OPENAI_REASONING_EFFORT,
) -> dict[str, Any]:
    """Convenience — strip sampling + merge reasoning_effort. In-place + returns."""
    strip_unsupported_sampling(kwargs, model)
    kwargs.update(openai_reasoning_kwargs(model, effort=effort))
    return kwargs


# v36-hotfix — adaptive thinking 응답에서 텍스트 추출.
# 빈/단순 호출에선 resp.content = [TextBlock] 이지만, thinking 이 동작한 호출은
# [ThinkingBlock, TextBlock, ...] 처럼 섞여 들어옴. content[0].text 만 접근하던
# 기존 5개 사이트가 `'ThinkingBlock' object has no attribute 'text'` 에러를 던졌다.
def extract_text_from_anthropic_response(resp: Any) -> str:
    """Anthropic Messages API 응답에서 텍스트 블록만 골라 합쳐서 반환.

    Args:
        resp: anthropic.AsyncAnthropic().messages.create() 응답.

    Returns:
        type=="text" 블록들의 .text 를 순서대로 이어붙인 문자열 (strip 됨).
        텍스트 블록이 없으면 빈 문자열.
    """
    blocks = getattr(resp, "content", None) or []
    parts: list[str] = []
    for block in blocks:
        if getattr(block, "type", "") == "text":
            t = getattr(block, "text", "") or ""
            if t:
                parts.append(t)
    return "".join(parts).strip()


# v28 — Gemini Image (Nano Banana Pro = gemini-3-pro-image-preview) thinking.
# generateContent body 의 generationConfig.thinkingConfig.thinkingLevel.
# 값: minimal / low / medium / high. 사용자 "다 켜라" → high.
_DEFAULT_GEMINI_IMAGE_THINKING_LEVEL = "high"


def gemini_image_thinking_config(
    *, level: str = _DEFAULT_GEMINI_IMAGE_THINKING_LEVEL,
) -> dict[str, Any]:
    """Returns the `thinkingConfig` sub-dict to merge into `generationConfig`.

    Returns an empty dict when globally disabled (`LLM_THINKING_DISABLED=1`).
    Caller merges the result into `payload["generationConfig"]`.
    """
    if _is_globally_disabled():
        return {}
    return {"thinkingConfig": {"thinkingLevel": level}}


def apply_thinking_to_gemini_image_payload(
    payload: dict[str, Any],
    *,
    level: str = _DEFAULT_GEMINI_IMAGE_THINKING_LEVEL,
) -> dict[str, Any]:
    """Convenience — in-place merge thinkingConfig into payload.generationConfig.

    Idempotent (overwrites existing thinkingConfig if present).
    """
    cfg = gemini_image_thinking_config(level=level)
    if not cfg:
        return payload
    gen_cfg = payload.setdefault("generationConfig", {})
    gen_cfg.update(cfg)
    return payload
