"""
v9 — 사용자 입력 텍스트 다듬기.
사용자가 자유롭게 적은 첫 만남/첫 데이트 등의 본문을, 영상 자동 생성용 프롬프트로
쓰기 좋게 한국어 자연체로 다듬는다. @멘션 토큰은 100% 보존.
모델: Claude 4.7 Opus 또는 OpenAI 최신 GPT(설정: openai_model_advanced).
"""

from .llm_thinking_config import extract_text_from_anthropic_response as _xtxt
import logging
import time
from collections import Counter
from typing import Any

import anthropic
from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)

MODEL_ALIAS_TO_ID = {
    "claude_4_7_opus": "claude-opus-4-7",
    "gpt_latest": None,  # → settings.openai_model_advanced (서버 상수)
}

_openai_client: AsyncOpenAI | None = None
_anthropic_client: anthropic.AsyncAnthropic | None = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_anthropic_client() -> anthropic.AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def resolve_model(model_alias: str) -> str:
    if model_alias == "claude_4_7_opus":
        return "claude-opus-4-7"
    if model_alias == "gpt_latest":
        return settings.openai_model_advanced or "gpt-5.4"
    raise ValueError(f"unsupported model_alias: {model_alias}")


def _build_mention_list_block(refs: list[dict]) -> str:
    if not refs:
        return "(없음)"
    seen = []
    for r in refs:
        name = (r.get("display_name") or "").strip()
        if name and name not in seen:
            seen.append(name)
    return "\n".join(f"@{name}" for name in seen) or "(없음)"


def _build_system_prompt() -> str:
    return (
        "역할: 결혼식 뮤직비디오 영상을 만들기 위한 사용자 입력 텍스트를 다듬는 한국어 에디터.\n\n"
        "[엄격 규칙]\n"
        "① 사실 변경·새 정보 추가 금지. 추측·창작 금지. 원문에 없는 사건/사람/장소/시간 추가하지 말 것.\n"
        "② \"@\" 로 시작하는 토큰(예: \"@한강 카페\", \"@평상복 신랑\")은 단어 단위로 100% 그대로 보존.\n"
        "   - 띄어쓰기, 조사(\"@한강 카페에서\"의 \"에서\") 외 문자를 토큰 내부에 끼우지 말 것.\n"
        "   - 같은 토큰이 여러 번 나오면 원문 등장 횟수만큼 유지.\n"
        "③ 육하원칙(누가/언제/어디서/무엇을/어떻게/왜) 기준으로 문장 순서·연결 보강.\n"
        "   - 부족한 정보 보충 금지(추측 금지). 있는 정보만 더 또렷하게.\n"
        "④ 한국어 자연체. 결혼식 영상 내레이션 톤. 과도한 격식체·시적 미사여구 회피.\n"
        "⑤ 길이는 원문의 ±30% 범위. 짧으면 ±30 글자.\n"
        "⑥ 출력은 다듬은 본문 텍스트만. 따옴표·머리말·해설·코드블록·번호 매김 없이.\n"
    )


def _build_user_message(text: str, refs: list[dict], label: str) -> str:
    return (
        f"[입력 라벨] {label or '(없음)'}\n"
        f"[원문]\n{text}\n\n"
        f"[보존해야 할 멘션 목록]\n{_build_mention_list_block(refs)}\n\n"
        f"다듬은 본문 텍스트만 그대로 출력하시오."
    )


def _validate_mention_preservation(original: str, polished: str, refs: list[dict]) -> bool:
    """원본의 각 @<display_name> 토큰이 다듬은 결과에서 원본 등장 횟수 이상 보존됐는지."""
    seen = set()
    ok = True
    for r in refs:
        name = (r.get("display_name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        token = "@" + name
        original_count = original.count(token)
        polished_count = polished.count(token)
        if polished_count < original_count:
            ok = False
            logger.warning(
                "[Polisher] mention dropped name=%s orig=%d polished=%d",
                name, original_count, polished_count,
            )
    return ok


def _max_tokens_for_text(text: str) -> int:
    # v30 — thinking/reasoning ON 시 reasoning 200~400 토큰 소비 → 하한/상한 ×2.
    return min(4096, max(768, len(text) * 4))


async def polish_story_text(
    text: str,
    refs: list[dict],
    model_alias: str,
    label: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    """다듬기 본 로직. model_alias 별로 분기. 응답 dict: {polished_text, model_used, elapsed_ms, refs_preserved}.
    예외 발생 시 호출자(라우트)가 잡아 500 응답."""
    model_id = resolve_model(model_alias)
    text_len = len(text or "")
    ref_count = len(refs or [])
    logger.info(
        "[Polisher] entry user_id=%s model_alias=%s model_id=%s text_len=%d ref_count=%d label=%s",
        user_id, model_alias, model_id, text_len, ref_count, (label or "")[:40],
    )

    system_prompt = _build_system_prompt()
    user_message = _build_user_message(text, refs or [], label or "")
    max_tokens = _max_tokens_for_text(text)

    from .llm_thinking_config import (
        apply_thinking_to_anthropic, apply_reasoning_to_openai,
    )

    started = time.time()
    if model_id.startswith("claude-"):
        client = _get_anthropic_client()
        kwargs: dict[str, Any] = {
            "model": model_id,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_message}],
            "max_tokens": max_tokens,
            "temperature": 0.4,
        }
        # v27 — adaptive thinking + strip unsupported sampling (Opus 4.7+).
        apply_thinking_to_anthropic(kwargs, model_id)
        logger.info(
            "[Polisher] anthropic call begin user_id=%s model=%s max_tokens=%d thinking=%s",
            user_id, model_id, max_tokens, bool(kwargs.get("thinking")),
        )
        resp = await client.messages.create(**kwargs)
        polished = _xtxt(resp)
    else:
        client = _get_openai_client()
        # 모델별 토큰 파라미터 키 결정 — gpt-5 계열은 max_completion_tokens, 그 외는 max_tokens
        openai_kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.4,
        }
        if model_id.startswith("gpt-5"):
            openai_kwargs["max_completion_tokens"] = max_tokens
        else:
            openai_kwargs["max_tokens"] = max_tokens
        # v27 — reasoning_effort + strip unsupported sampling (GPT-5+).
        apply_reasoning_to_openai(openai_kwargs, model_id)

        logger.info(
            "[Polisher] openai call begin user_id=%s model=%s max_tokens_param=%s value=%d reasoning=%s",
            user_id, model_id,
            "max_completion_tokens" if model_id.startswith("gpt-5") else "max_tokens",
            max_tokens, bool(openai_kwargs.get("reasoning_effort")),
        )
        resp = await client.chat.completions.create(**openai_kwargs)
        polished = (resp.choices[0].message.content or "").strip()

    elapsed_ms = int((time.time() - started) * 1000)

    refs_preserved = _validate_mention_preservation(text, polished, refs or [])
    logger.info(
        "[Polisher] ok user_id=%s model=%s elapsed_ms=%d refs_preserved=%s polished_len=%d",
        user_id, model_id, elapsed_ms, refs_preserved, len(polished),
    )

    return {
        "polished_text": polished,
        "model_used": model_id,
        "elapsed_ms": elapsed_ms,
        "refs_preserved": refs_preserved,
    }
