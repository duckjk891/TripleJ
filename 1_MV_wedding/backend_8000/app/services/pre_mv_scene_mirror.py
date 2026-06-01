"""
v24.1 — Scene patch 시 한국어/영문 mirror 자동 동기화.

`PATCH /api/pre-mv/jobs/{id}/scenes/{n}` 가 본 서비스의 `sync_scene_mirrors` 를
호출해, 사용자가 한쪽 언어만 수정한 텍스트 필드의 반대편(미러)을 LLM 1회 호출로
번역해서 채워준다.

모델 호출은 영문 필드(`description`, `image_prompt`, `video_prompt`) 만 쓰므로,
사용자가 한국어 (`_ko` suffix) 만 편집할 경우 모델 입력이 안 바뀌는 불일치가
생긴다. 본 서비스는 그 불일치를 메우는 LLM 어댑터.

설계 결정 (v24.1):
  · provider 우선순위: Claude Opus 4.7 (anthropic_api_key) → OpenAI gpt-5.4
    (openai_api_key) → 둘 다 비어있으면 빈 dict 반환 (실패 fallback).
  · 호출 횟수: PATCH 당 최대 1회. 동기화 대상 페어가 0개면 함수 자체 호출 안 함
    (라우트에서 가드).
  · 응답 JSON 스키마: {"translations": [{"target_field": str, "value": str}, ...]}.
    검증 실패시 빈 dict.
  · 멘션 토큰(@groom_casual @bride_wedding @seoul_night 등) 보존, 한 단락 텍스트,
    결혼식 본행사 어휘(ceremony / altar / vows) 금지 — 시스템 프롬프트로 강제.

로그 prefix: `[PreMVMirror]`.
"""

from __future__ import annotations

import json
from .llm_thinking_config import extract_text_from_anthropic_response as _xtxt
import logging
import re
import time
from typing import Any, Optional

import anthropic
from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Clients (모듈 싱글톤 — phase0/phase1 패턴과 동일)
# ──────────────────────────────────────────────────────────────────────────

_anthropic_client = None
_openai_client: Optional[AsyncOpenAI] = None


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


# ──────────────────────────────────────────────────────────────────────────
# 상수 / 프롬프트
# ──────────────────────────────────────────────────────────────────────────

_MAX_TOKENS_MIRROR = 4000  # v30 — 1500 → 4000 (OpenAI reasoning_effort=high 시 reasoning 200~400 토큰 + output 마진)

# 영문 필드 → 한국어 필드 매핑 (PATCH 라우트에서도 참조).
ENGLISH_TO_KO_FIELD = {
    "description": "description_ko",
    "image_prompt": "image_prompt_ko",
    "video_prompt": "video_prompt_ko",
}
KO_TO_ENGLISH_FIELD = {v: k for k, v in ENGLISH_TO_KO_FIELD.items()}

# 동기화 가능한 모든 영문/한국어 필드 셋 (라우트 헬퍼용).
ALL_MIRROR_FIELDS = set(ENGLISH_TO_KO_FIELD.keys()) | set(ENGLISH_TO_KO_FIELD.values())


SYSTEM_PROMPT = """역할: 영상 씬 prompt 한국어/영문 양방향 번역가.

입력: 번역 요청 N개. 각 요청은 source_lang, target_lang, target_field, source_text 가 들어 있다.

해야 할 일:
각 source_text 를 target_lang 으로 자연스럽게 번역해라.
출력은 JSON 객체 하나.

규칙:
1. @멘션 토큰 (@groom_casual @bride_wedding @서울야경 등 @ 로 시작하는 모든 식별자) 은 그대로 보존한다. 번역하거나 풀어쓰지 마라.
2. 한 단락 텍스트 — 줄바꿈 없이 한 줄로 출력. 개행/마크다운 금지.
3. description 필드: 한국어는 30~50자, 영문은 10~20단어 권장.
4. image_prompt / video_prompt 필드: 한국어는 40~80자, 영문은 30~50단어 권장.
5. 결혼식 본행사 어휘 금지 — ceremony / altar / vows / wedding rite / 예식 / 식 / 혼인서약 같이 본행사를 가리키는 단어는 절대 쓰지 마라. 이 작품은 식전영상(pre-roll) 이므로 자연스러운 일상 / 데이트 / 회상 컨셉이다.
6. 글래머 / 노출 / 선정적 표현 금지.
7. target_field 는 절대 바꾸지 마라 (요청에 적힌 그대로 응답에 echo).

출력 형식 (JSON 객체 하나, 마크다운 펜스 금지):
{
  "translations": [
    {"target_field": "description", "value": "..."},
    {"target_field": "image_prompt_ko", "value": "..."}
  ]
}

요청에 들어온 페어 수만큼 translations 항목이 있어야 한다. 더도 덜도 안 된다."""


# ──────────────────────────────────────────────────────────────────────────
# LLM 호출 헬퍼
# ──────────────────────────────────────────────────────────────────────────

async def _call_claude(model_id: str, user_message: str) -> str:
    """Claude Opus 4.7 호출 — phase1 패턴 차용."""
    from .llm_thinking_config import apply_thinking_to_anthropic
    client = _get_anthropic_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": _MAX_TOKENS_MIRROR,
        "temperature": 0.3,
    }
    # v27 — adaptive thinking + strip unsupported sampling (Opus 4.7+).
    apply_thinking_to_anthropic(kwargs, model_id)
    logger.info(
        "[SceneMirror] llm claude model=%s thinking=%s",
        model_id, bool(kwargs.get("thinking")),
    )
    resp = await client.messages.create(**kwargs)
    return _xtxt(resp)


async def _call_openai(model_id: str, user_message: str) -> str:
    """OpenAI fallback — JSON object 강제."""
    from .llm_thinking_config import apply_reasoning_to_openai
    client = _get_openai_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "max_completion_tokens": _MAX_TOKENS_MIRROR,
        "response_format": {"type": "json_object"},
    }
    # v27 — reasoning_effort + strip unsupported sampling (GPT-5+).
    apply_reasoning_to_openai(kwargs, model_id)
    logger.info(
        "[SceneMirror] llm openai model=%s reasoning=%s",
        model_id, bool(kwargs.get("reasoning_effort")),
    )
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as e:  # noqa: BLE001
        # 일부 모델은 max_completion_tokens 미지원 — fallback to max_tokens.
        if "max_completion_tokens" in str(e):
            kwargs.pop("max_completion_tokens", None)
            kwargs["max_tokens"] = _MAX_TOKENS_MIRROR
            resp = await client.chat.completions.create(**kwargs)
        else:
            raise
    return (resp.choices[0].message.content or "").strip()


# ──────────────────────────────────────────────────────────────────────────
# Parse / build
# ──────────────────────────────────────────────────────────────────────────

def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        if "\n" in s:
            s = s.split("\n", 1)[1]
        else:
            s = s[3:]
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


def _parse_translations(raw: str, expected_targets: list[str]) -> dict[str, str]:
    """LLM 응답을 {target_field: value} 로 정규화.

    파싱/검증 실패 시 빈 dict. 일부만 성공한 경우 성공한 항목만 반환.
    """
    cleaned = _strip_code_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return {}
        try:
            parsed = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    if not isinstance(parsed, dict):
        return {}
    items = parsed.get("translations")
    if not isinstance(items, list):
        return {}
    out: dict[str, str] = {}
    expected_set = set(expected_targets)
    for it in items:
        if not isinstance(it, dict):
            continue
        tf = it.get("target_field")
        val = it.get("value")
        if not isinstance(tf, str) or not isinstance(val, str):
            continue
        if tf not in expected_set:
            continue
        # 한 줄 강제 — 개행 들어오면 공백으로 치환.
        clean = re.sub(r"\s+", " ", val).strip()
        if not clean:
            continue
        out[tf] = clean
    return out


def _build_user_message(
    pairs_to_sync: list[tuple[str, str, str]],
) -> str:
    """LLM 에게 보낼 user 메시지 — JSON 형식의 번역 요청 리스트.

    pairs_to_sync 각 원소 = (source_field, target_field, source_value).
    source_field / target_field 명에서 _ko 여부로 source_lang / target_lang 결정.
    """
    requests = []
    for src_field, tgt_field, src_value in pairs_to_sync:
        source_lang = "korean" if src_field.endswith("_ko") else "english"
        target_lang = "korean" if tgt_field.endswith("_ko") else "english"
        requests.append({
            "source_lang": source_lang,
            "target_lang": target_lang,
            "target_field": tgt_field,
            "source_text": src_value,
        })
    payload = {"requests": requests}
    return (
        "[scene_mirror_sync]\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n\n[요구]\n"
        + "각 request 의 source_text 를 target_lang 으로 번역해서 target_field 키로 "
        + "translations 배열에 넣어라. JSON 객체 하나만 출력 (마크다운 / 서두 금지)."
    )


def _resolve_provider() -> Optional[tuple[str, str]]:
    """provider 우선순위: claude → openai. 둘 다 키 없으면 None."""
    if settings.anthropic_api_key:
        return ("claude", settings.wedding_lyrics_default_model or "claude-opus-4-7")
    if settings.openai_api_key:
        return ("openai", settings.openai_model_advanced or "gpt-5.4")
    return None


# ──────────────────────────────────────────────────────────────────────────
# Public entry
# ──────────────────────────────────────────────────────────────────────────

async def sync_scene_mirrors(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    pairs_to_sync: list[tuple[str, str, str]],
) -> dict[str, str]:
    """각 pair 에서 source_value 를 LLM 으로 번역해서 target_field 결과로 반환.

    예: pairs_to_sync = [("description_ko", "description", "신랑이 코트를 건넨다")]
         → {"description": "The groom offers his coat to the bride."}

    LLM 1회 호출에 다중 pair 합쳐 처리. Claude Opus 4.7 우선, 실패 시 OpenAI fallback.

    Returns:
      {target_field: translated_value, ...}
      LLM 호출 / 파싱 실패 시 빈 dict.
    """
    if not pairs_to_sync:
        return {}

    source_fields = [p[0] for p in pairs_to_sync]
    target_fields = [p[1] for p in pairs_to_sync]

    resolved = _resolve_provider()
    if resolved is None:
        logger.warning(
            "[PreMVMirror] no LLM key configured pre_mv_job_id=%s scene_number=%d "
            "source_fields=%s target_fields=%s",
            pre_mv_job_id, scene_number,
            ",".join(source_fields), ",".join(target_fields),
        )
        return {}

    provider, model_id = resolved
    user_message = _build_user_message(pairs_to_sync)

    # 1차: 우선순위 provider.
    started = time.monotonic()
    try:
        if provider == "claude":
            raw = await _call_claude(model_id, user_message)
        else:
            raw = await _call_openai(model_id, user_message)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        result = _parse_translations(raw, target_fields)
        logger.info(
            "[PreMVMirror] sync ok pre_mv_job_id=%s scene_number=%d "
            "source_fields=%s target_fields=%s model=%s elapsed_ms=%d "
            "translated=%d raw_len=%d",
            pre_mv_job_id, scene_number,
            ",".join(source_fields), ",".join(target_fields),
            model_id, elapsed_ms, len(result), len(raw),
        )
        if result:
            return result
        # 응답은 받았지만 파싱 실패 / 0개 — fallback 시도.
        logger.warning(
            "[PreMVMirror] sync parse_empty pre_mv_job_id=%s scene_number=%d "
            "model=%s — fallback 시도",
            pre_mv_job_id, scene_number, model_id,
        )
    except Exception as e:  # noqa: BLE001
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "[PreMVMirror] sync 1st_call_failed pre_mv_job_id=%s scene_number=%d "
            "model=%s elapsed_ms=%d err=%s: %s",
            pre_mv_job_id, scene_number, model_id, elapsed_ms,
            type(e).__name__, str(e)[:200],
        )

    # 2차 fallback: 반대편 provider (있을 때만).
    if provider == "claude" and settings.openai_api_key:
        fallback_provider = "openai"
        fallback_model = settings.openai_model_advanced or "gpt-5.4"
    elif provider == "openai" and settings.anthropic_api_key:
        fallback_provider = "claude"
        fallback_model = settings.wedding_lyrics_default_model or "claude-opus-4-7"
    else:
        return {}

    started2 = time.monotonic()
    try:
        if fallback_provider == "claude":
            raw2 = await _call_claude(fallback_model, user_message)
        else:
            raw2 = await _call_openai(fallback_model, user_message)
        elapsed2 = int((time.monotonic() - started2) * 1000)
        result2 = _parse_translations(raw2, target_fields)
        logger.info(
            "[PreMVMirror] sync fallback_ok pre_mv_job_id=%s scene_number=%d "
            "source_fields=%s target_fields=%s model=%s elapsed_ms=%d "
            "translated=%d",
            pre_mv_job_id, scene_number,
            ",".join(source_fields), ",".join(target_fields),
            fallback_model, elapsed2, len(result2),
        )
        return result2
    except Exception as e:  # noqa: BLE001
        elapsed2 = int((time.monotonic() - started2) * 1000)
        logger.warning(
            "[PreMVMirror] sync fallback_failed pre_mv_job_id=%s scene_number=%d "
            "model=%s elapsed_ms=%d err=%s: %s",
            pre_mv_job_id, scene_number, fallback_model, elapsed2,
            type(e).__name__, str(e)[:200],
        )
        return {}
