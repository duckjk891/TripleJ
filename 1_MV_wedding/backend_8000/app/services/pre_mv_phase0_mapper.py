"""
v17.1 — Phase 0: 스토리 6시점 ⇄ 가사 라인 매핑 (LLM).

입력:
  - story_snapshot: dict (CoupleStory.story = StoryDetails dump 형태)
  - lyrics_snapshot: dict — {"title": str, "body": str, "model": str}
  - lyric_timestamps: list[{"text","start","end"}] (라인 단위)
  - scenario_model: "claude_4_7_opus" | "gpt_latest"

출력:
  list[dict] scene_plan — 각 항목
    {
      "lyric_line": str,
      "lyric_start": float,
      "lyric_end": float,
      "story_slot": str,        # "meeting"|"first_date"|"memories"|"proposal"|"wedding_prep"|"rituals"
      "story_excerpt": str,
      "refs": [MentionRef.dump()],
    }

규칙(시스템 프롬프트로 강제):
  · 가사 한 라인 = scene_plan 한 항목 (라인 수 정확히 일치)
  · 시간 역행 금지 (meeting → first_date → memories → proposal → wedding_prep → rituals)
  · 스토리에 없는 장면 생성 금지 (story_excerpt 는 story 본문에서 인용·요약)
  · @멘션 토큰 그대로 보존

민감 정보 보호: 본문 길이만 로깅, 본문 전체 출력 금지.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional

import anthropic
from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)


VALID_STORY_SLOTS = (
    "meeting",
    "first_date",
    "memories",
    "proposal",
    "wedding_prep",
    "rituals",
)

# 시간 역행 검증용 순서 인덱스
_SLOT_ORDER = {slot: idx for idx, slot in enumerate(VALID_STORY_SLOTS)}


# ──────────────────────────────────────────────────────────────────────────
# Clients (lyrics_generator 패턴 미러링)
# ──────────────────────────────────────────────────────────────────────────

_openai_client: AsyncOpenAI | None = None
_anthropic_client = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


# ──────────────────────────────────────────────────────────────────────────
# 시스템 프롬프트
# ──────────────────────────────────────────────────────────────────────────

PHASE0_SYSTEM_PROMPT = """역할: 두 사람의 결혼식 식전영상을 위한 시나리오 매퍼.

입력으로 받는 자료:
1) 사용자가 작성한 스토리 6시점 — meeting / first_date / memories / proposal / wedding_prep / rituals
2) 그 곡의 가사 라인별 타임스탬프 (한 라인 = start/end 초)
3) 스토리 본문에 박혀있는 @멘션 토큰들 — `@groom_casual`, `@bride_casual`, `@groom_wedding`, `@bride_wedding`, `@장소이름`, `@웨딩사진이름` 등

해야 하는 일:
가사 한 라인이 스토리의 어느 시점(story_slot)을 가리키는지 정확히 매핑하고,
그 시점 본문에서 직접 인용·요약한 짧은 발췌(story_excerpt)와 그 라인에 따라가야 할
참조 자산(@멘션)들의 ref 리스트를 채운다.

# 절대 규칙 (어기면 실패)
1. 가사 한 라인 = scene_plan 한 항목. **출력 항목 수는 입력 라인 수와 정확히 동일해야 한다.**
2. lyric_line, lyric_start, lyric_end 는 입력의 해당 라인 그대로 복사.
3. story_slot 은 다음 6개 중 정확히 하나의 문자열:
   ["meeting","first_date","memories","proposal","wedding_prep","rituals"]
4. story_excerpt 는 해당 story_slot 본문에서 직접 인용 또는 짧게 요약(≤120자).
   **스토리에 없는 장면이나 사실을 새로 만들어내지 마라.**
5. refs 는 그 story_slot 의 *_refs 풀에서 자연스럽게 쓰일 수 있는 항목만 골라 그대로 복사.
   임의로 ref 를 만들거나 다른 slot 의 ref 를 끌어오지 마라.
6. @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름)이
   story_excerpt 안에 있어도 토큰 형태 그대로 보존하라(번역·치환 금지).
7. 시간 역행 금지 — story_slot 순서는 meeting → first_date → memories → proposal → wedding_prep → rituals
   순으로만 진행. 한 번 proposal 로 넘어갔다가 다시 first_date 로 돌아가면 안 된다.
   (단, 같은 slot 이 여러 라인 연속되는 것은 OK.)
8. memories 는 여러 항목이 배열로 들어올 수 있다. 한 라인이 memories 중 어느 항목을
   가리키는지가 분명하면 story_excerpt 에 그 항목 인용 우선.

# 출력 형식
오직 JSON 만 출력. 마크다운 코드펜스 금지. 설명 금지. 다음 shape 의 객체.

{
  "scene_plan": [
    {
      "lyric_line": "...",
      "lyric_start": 0.0,
      "lyric_end": 2.5,
      "story_slot": "meeting",
      "story_excerpt": "@groom_casual 와 @bride_casual 가 4월 회식 야근에 처음 마주쳤다",
      "refs": [
        {"type":"sheet","asset_id":"groom_casual","display_name":"신랑 평상복","object_name":null}
      ]
    },
    ...
  ]
}

refs 항목 shape: {type:"sheet"|"place"|"wedding_photo", asset_id:str, display_name:str, object_name:str|null}.
입력의 *_refs 풀에 있던 ref 만 그대로 복사하여 사용. 새로 만들지 마라.
"""


# ──────────────────────────────────────────────────────────────────────────
# 사용자 메시지 빌더
# ──────────────────────────────────────────────────────────────────────────

def _collect_story_block(story_snapshot: dict) -> str:
    """6시점 본문 + 각 시점의 *_refs 풀을 LLM 입력 텍스트로 직렬화."""
    s = story_snapshot or {}

    def _refs_repr(refs: list) -> str:
        if not refs:
            return "(없음)"
        parts = []
        for r in refs:
            if not isinstance(r, dict):
                continue
            t = r.get("type") or "?"
            aid = r.get("asset_id") or "?"
            dn = r.get("display_name") or "?"
            parts.append(f"{{type:{t}, asset_id:{aid}, display_name:{dn}}}")
        return "[" + ", ".join(parts) + "]"

    lines: list[str] = ["[스토리 6시점 — 가사 라인이 가리킬 후보들]"]

    meeting = s.get("meeting") or ""
    meeting_refs = s.get("meeting_refs") or []
    lines.append("")
    lines.append("## meeting (첫 만남)")
    lines.append(meeting or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(meeting_refs)}")

    first_date = s.get("first_date") or ""
    first_date_refs = s.get("first_date_refs") or []
    lines.append("")
    lines.append("## first_date (첫 데이트)")
    lines.append(first_date or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(first_date_refs)}")

    memories = s.get("memories") or []
    memories_refs = s.get("memories_refs") or []
    lines.append("")
    lines.append("## memories (함께 쌓인 추억)")
    if memories:
        for idx, m in enumerate(memories):
            lines.append(f"  - memories[{idx}]: {m}")
            mref = (memories_refs[idx] if idx < len(memories_refs) else []) or []
            lines.append(f"    refs 풀: {_refs_repr(mref)}")
    else:
        lines.append("(비어있음)")

    proposal = s.get("proposal") or ""
    proposal_refs = s.get("proposal_refs") or []
    lines.append("")
    lines.append("## proposal (결혼을 결심한 순간)")
    lines.append(proposal or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(proposal_refs)}")

    wedding_prep = s.get("wedding_prep") or ""
    wedding_prep_refs = s.get("wedding_prep_refs") or []
    lines.append("")
    lines.append("## wedding_prep (웨딩 준비 — 드레스/촬영)")
    lines.append(wedding_prep or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(wedding_prep_refs)}")

    rituals = s.get("rituals") or ""
    rituals_refs = s.get("rituals_refs") or []
    lines.append("")
    lines.append("## rituals (둘만의 단어·장소)")
    lines.append(rituals or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(rituals_refs)}")

    return "\n".join(lines)


def _collect_lyric_lines_block(lyric_timestamps: list[dict]) -> str:
    """라인별 timestamp 를 LLM 입력 텍스트로 직렬화. 라인 인덱스를 명시해 매핑 강제."""
    if not lyric_timestamps:
        return "(가사 라인 없음)"
    out = ["[가사 라인 — 각 라인이 어느 story_slot 을 가리키는지 매핑하라]"]
    for idx, seg in enumerate(lyric_timestamps):
        text = (seg.get("text") or "").strip()
        start = seg.get("start")
        end = seg.get("end")
        out.append(f"line[{idx}] start={start} end={end}: {text}")
    return "\n".join(out)


def _build_user_message(
    story_snapshot: dict,
    lyrics_snapshot: dict,
    lyric_timestamps: list[dict],
) -> str:
    story_block = _collect_story_block(story_snapshot)
    lyrics_block = _collect_lyric_lines_block(lyric_timestamps)

    title = (lyrics_snapshot or {}).get("title") or "(제목 없음)"
    return (
        f"곡 제목: {title}\n"
        f"가사 라인 수: {len(lyric_timestamps)}\n\n"
        f"{story_block}\n\n"
        f"{lyrics_block}\n\n"
        "[요구]\n"
        "위 가사 라인 각각을 story_slot 6개 중 하나로 매핑하고, "
        "그 slot 본문에서 짧게 인용한 story_excerpt 와 자연스럽게 따라갈 ref 들을 채워라. "
        "출력은 JSON 한 덩어리만. 마크다운 코드펜스·설명·서두 금지."
    )


# ──────────────────────────────────────────────────────────────────────────
# 모델 디스패치
# ──────────────────────────────────────────────────────────────────────────

def _resolve_model_id(scenario_model: str) -> tuple[str, str]:
    """scenario_model 별칭 → (provider, model_id) 반환.

    provider: "claude" | "openai".
    """
    if scenario_model == "claude_4_7_opus":
        return ("claude", settings.wedding_lyrics_default_model or "claude-opus-4-7")
    if scenario_model == "gpt_latest":
        return ("openai", settings.openai_model_advanced or "gpt-5.4")
    raise ValueError(
        f"unknown scenario_model: {scenario_model} (allowed: claude_4_7_opus, gpt_latest)"
    )


def _max_tokens_for_lines(line_count: int) -> int:
    """라인 수에 비례한 안전 토큰. JSON 출력은 라인당 ~120 토큰 예상.
    상한 — Claude Opus 4.7 32k, GPT 16k 안에서 안전 마진.
    """
    base = 1500
    per_line = 200
    cap = 16000
    return min(cap, max(base, line_count * per_line))


async def _call_claude(model_id: str, user_message: str, max_tokens: int) -> str:
    client = _get_anthropic_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "system": PHASE0_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
    }
    # opus-4-7 은 temperature 받지 않음(기본값 사용)
    if "opus-4-7" not in model_id:
        kwargs["temperature"] = 0.4
    resp = await client.messages.create(**kwargs)
    return (resp.content[0].text or "").strip()


async def _call_openai(model_id: str, user_message: str, max_tokens: int) -> str:
    client = _get_openai_client()
    # GPT-5.x 계열은 max_completion_tokens, temperature/response_format 지원.
    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": PHASE0_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as e:
        # 일부 모델은 max_completion_tokens 미지원 → fallback to max_tokens
        if "max_completion_tokens" in str(e):
            kwargs.pop("max_completion_tokens", None)
            kwargs["max_tokens"] = max_tokens
            resp = await client.chat.completions.create(**kwargs)
        else:
            raise
    return (resp.choices[0].message.content or "").strip()


# ──────────────────────────────────────────────────────────────────────────
# 응답 파싱 + 검증
# ──────────────────────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _strip_code_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        # remove leading fence line
        if "\n" in s:
            s = s.split("\n", 1)[1]
        else:
            s = s[3:]
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


def _parse_response(raw: str) -> list[dict]:
    cleaned = _strip_code_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        # JSON 부분만 추출 시도 (모델이 앞뒤에 텍스트 붙였을 가능성)
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise ValueError(f"LLM 응답을 JSON 으로 파싱할 수 없습니다: {e}") from e

    if isinstance(parsed, list):
        # 모델이 scene_plan key 없이 바로 리스트 반환한 케이스
        return parsed

    if not isinstance(parsed, dict):
        raise ValueError("LLM 응답이 객체가 아닙니다.")

    plan = parsed.get("scene_plan")
    if plan is None:
        # 혹시 다른 키 이름 사용했을 수 있음
        for k in ("plan", "scenes", "items"):
            if k in parsed and isinstance(parsed[k], list):
                plan = parsed[k]
                break
    if not isinstance(plan, list):
        raise ValueError("scene_plan 배열을 찾을 수 없습니다.")
    return plan


def _coerce_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _normalize_refs(raw_refs: Any) -> list[dict]:
    """ref 항목을 MentionRef 스키마 호환 dict 로 정규화. 무효한 항목은 drop."""
    if not isinstance(raw_refs, list):
        return []
    out: list[dict] = []
    for r in raw_refs:
        if not isinstance(r, dict):
            continue
        t = r.get("type")
        aid = r.get("asset_id")
        dn = r.get("display_name")
        if t not in ("sheet", "place", "wedding_photo"):
            continue
        if not aid or not dn:
            continue
        out.append({
            "type": t,
            "asset_id": str(aid),
            "display_name": str(dn),
            "object_name": r.get("object_name") or None,
        })
    return out


def _validate_and_align(
    plan: list[dict],
    lyric_timestamps: list[dict],
) -> list[dict]:
    """모델 출력의 라인을 lyric_timestamps 와 정확히 정렬한다.

    - 라인 수가 맞으면 그대로 사용 (lyric_line/start/end 는 입력으로 강제 덮어쓰기).
    - 라인 수가 안 맞으면 ValueError.
    - story_slot 유효성 검증 + 시간 역행 보정(역행 발견 시 직전 slot 으로 fallback).
    """
    expected_n = len(lyric_timestamps)
    actual_n = len(plan)
    if actual_n != expected_n:
        raise ValueError(
            f"scene_plan 라인 수 불일치: expected={expected_n} actual={actual_n}"
        )

    aligned: list[dict] = []
    last_slot_idx = -1
    last_slot = VALID_STORY_SLOTS[0]
    for i, seg in enumerate(lyric_timestamps):
        item_raw = plan[i] if isinstance(plan[i], dict) else {}
        slot = item_raw.get("story_slot") or ""
        if slot not in _SLOT_ORDER:
            slot = last_slot if last_slot_idx >= 0 else VALID_STORY_SLOTS[0]
        else:
            slot_idx = _SLOT_ORDER[slot]
            # 시간 역행 보정 — 이전보다 뒤로 가면 last_slot 유지
            if slot_idx < last_slot_idx:
                slot = last_slot
            else:
                last_slot_idx = slot_idx
                last_slot = slot

        excerpt = (item_raw.get("story_excerpt") or "").strip()
        if len(excerpt) > 240:
            excerpt = excerpt[:240]

        aligned.append({
            "lyric_line": (seg.get("text") or "").strip(),
            "lyric_start": _coerce_float(seg.get("start"), 0.0),
            "lyric_end": _coerce_float(seg.get("end"), 0.0),
            "story_slot": slot,
            "story_excerpt": excerpt,
            "refs": _normalize_refs(item_raw.get("refs")),
        })

    return aligned


# ──────────────────────────────────────────────────────────────────────────
# Public entry
# ──────────────────────────────────────────────────────────────────────────

async def generate_scene_plan(
    *,
    pre_mv_job_id: str,
    story_snapshot: dict,
    lyrics_snapshot: dict,
    lyric_timestamps: list[dict],
    scenario_model: str,
) -> list[dict]:
    """Phase 0 진입점. 위 docstring 참조.

    Raises:
        ValueError: 모델 출력 검증 실패 (라인 수 불일치 등) → 1회 재시도 후에도 실패 시 호출자에서 처리.
        Exception: 외부 API 호출 실패.
    """
    lines_in = len(lyric_timestamps)
    if lines_in == 0:
        raise ValueError("lyric_timestamps 가 비어있습니다.")

    provider, model_id = _resolve_model_id(scenario_model)

    # 키 게이팅
    if provider == "claude" and not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 가 설정되어 있지 않습니다.")
    if provider == "openai" and not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY 가 설정되어 있지 않습니다.")

    user_message = _build_user_message(
        story_snapshot=story_snapshot,
        lyrics_snapshot=lyrics_snapshot,
        lyric_timestamps=lyric_timestamps,
    )
    max_tokens = _max_tokens_for_lines(lines_in)

    logger.info(
        "[PreMVScenario] entry pre_mv_job_id=%s model=%s provider=%s lines_in=%d "
        "user_msg_len=%d max_tokens=%d",
        pre_mv_job_id, model_id, provider, lines_in, len(user_message), max_tokens,
    )

    started = time.time()
    raw: Optional[str] = None
    last_err: Optional[Exception] = None

    # 1회 호출 + 검증 실패 시 1회 재시도
    for attempt in (1, 2):
        try:
            if provider == "claude":
                raw = await _call_claude(model_id, user_message, max_tokens)
            else:
                raw = await _call_openai(model_id, user_message, max_tokens)
            plan = _parse_response(raw)
            aligned = _validate_and_align(plan, lyric_timestamps)
            elapsed_ms = int((time.time() - started) * 1000)
            logger.info(
                "[PreMVScenario] ok pre_mv_job_id=%s model=%s attempt=%d "
                "lines_in=%d lines_out=%d elapsed_ms=%d",
                pre_mv_job_id, model_id, attempt, lines_in, len(aligned), elapsed_ms,
            )
            return aligned
        except Exception as e:
            last_err = e
            logger.warning(
                "[PreMVScenario] attempt=%d failed pre_mv_job_id=%s model=%s "
                "err=%s: %s",
                attempt, pre_mv_job_id, model_id,
                type(e).__name__, str(e)[:200],
            )
            if attempt == 2:
                break
            # 두 번째 시도엔 강제 지시 추가
            user_message = (
                user_message
                + "\n\n[★ 재시도 강제]\n"
                + f"이전 출력이 검증 실패했다(err={type(e).__name__}). "
                + f"이번에는 반드시 scene_plan 항목 수를 정확히 {lines_in} 개로 작성하고, "
                + "오직 JSON 한 객체만 출력하라."
            )

    elapsed_ms = int((time.time() - started) * 1000)
    logger.exception(
        "[PreMVScenario] all attempts failed pre_mv_job_id=%s model=%s elapsed_ms=%d",
        pre_mv_job_id, model_id, elapsed_ms,
    )
    raise last_err or RuntimeError("Phase 0 매핑 실패")
