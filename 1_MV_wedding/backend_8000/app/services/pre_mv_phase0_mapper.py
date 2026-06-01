"""
v21 — Phase 0: 스토리 6시점 → 한국어 서술 시나리오 + 키 이벤트 리스트.

기존 v17~v20 의 `generate_scene_plan` (가사 라인 1:1 매핑) 은 폐기. 새 진입점
`generate_scenario` 는 가사·timestamp 와 무관하게 사용자 스토리만으로 단편
시나리오를 만들고, 시점별 키 사건 목록을 함께 반환한다.

입력:
  - story_snapshot: dict (CoupleStory.story 또는 그 상위 — couple/story/vow/wedding_context)
  - scenario_model: "claude_4_7_opus" | "gpt_latest"

출력:
  {
    "scenario_text": str,              # 한국어 서술체 본문 (5~6 페이지 분량, 약 3000~5000자)
    "scenario_events": [
      {
        "order": int,
        "story_slot": str,             # "meeting"|"first_date"|"memory"|"proposal"|"wedding_prep"|"rituals"
        "memory_index": int | None,    # story_slot == "memory" 일 때만 0..N-1, 그 외 None
        "summary": str,                # 5W1H 요약 (1~2 문장)
        "refs": [MentionRef.dump()],
      }, ...
    ],
  }

규칙(시스템 프롬프트로 강제):
  · scenario_text 안의 @멘션 토큰 그대로 보존.
  · story_slot 6 종 고정 — 시간 역행 금지 (stable sort 로 보정).
  · 스토리에 없는 사건 생성 금지.

backward-compat:
  · `generate_scene_plan` stub 유지 — 호출 시 RuntimeError ("v21 deprecated").

민감 정보 보호: 본문 길이만 로깅, 본문 전체 출력 금지.
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


# v21 — story_slot 도메인. "memories"(복수형) 였던 기존 매핑 라인 모드와 달리
# 시나리오 이벤트에서는 메모리 항목 하나하나가 별개 이벤트로 분리되므로
# 단수 "memory" 를 사용한다.
VALID_STORY_SLOTS = (
    "meeting",
    "first_date",
    "memory",
    "proposal",
    "wedding_prep",
    "rituals",
)

# 시간 역행 검증/정렬용 인덱스
_SLOT_ORDER = {slot: idx for idx, slot in enumerate(VALID_STORY_SLOTS)}


# ──────────────────────────────────────────────────────────────────────────
# Clients
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

PHASE0_SYSTEM_PROMPT = """역할: 두 사람의 결혼식 식전영상을 위한 단편 시나리오 작가.

입력으로 받는 자료:
1) 사용자가 작성한 스토리 6시점 — meeting / first_date / memories[] / proposal / wedding_prep / rituals
2) 두 사람의 이름 / 분위기·서약 메모
3) 스토리 본문에 박혀있는 @멘션 토큰들 — `@groom_casual`, `@bride_casual`, `@groom_wedding`, `@bride_wedding`, `@장소이름`, `@웨딩사진이름` 등

해야 하는 일:
다음 두 가지를 함께 출력한다.

(1) scenario_text — 한국어 서술체 본문. 5~6 페이지 분량, 약 3000~5000자.
   - 사용자 입력의 5W1H 디테일(언제·어디서·누가·무엇을·왜·어떻게)을 풍부하게 묘사한다.
   - @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름)은
     본문 안에서 토큰 형태 그대로 보존하라(번역·치환 금지).
   - 시간 순서: meeting → first_date → memory_1 → memory_2 → ... → proposal → wedding_prep.
     (rituals 시점은 다른 시점에 녹여 묘사할 수 있다.)
   - 스토리에 없는 사건을 생성하지 마라. 입력에 있는 정보만 풍부하게 묘사.

(2) scenario_events — 시점별 키 사건 리스트. 각 항목 shape:
   {
     "order": int,              # 1 부터 시작, 시간 순서대로 증가
     "story_slot": "meeting"|"first_date"|"memory"|"proposal"|"wedding_prep"|"rituals",
     "memory_index": int|null,  # story_slot=="memory" 일 때만 0..N-1, 그 외 null
     "summary": str,            # 5W1H 요약 1~2 문장 (≤200자)
     "refs": [
       {"type":"sheet"|"place"|"wedding_photo", "asset_id":str, "display_name":str, "object_name":str|null}
     ]
   }

# 절대 규칙 (어기면 실패)
1. JSON 한 덩어리만 출력. 마크다운 코드펜스 금지. 설명 금지.
2. story_slot 은 위 6개 중 정확히 하나의 문자열.
3. memories 가 입력에 N 개 있으면 events 안에 story_slot="memory", memory_index=0..N-1 의
   N 개 항목이 시간 순서대로 들어가야 한다.
4. 시간 역행 금지 — events 의 story_slot 순서는
   meeting → first_date → memory → proposal → wedding_prep → rituals 로만 진행.
   (memory 끼리는 memory_index 오름차순.)
5. refs 는 그 시점의 *_refs 풀에서 자연스럽게 쓰일 수 있는 항목만 그대로 복사. 임의로 만들지 마라.
6. summary 안에도 @멘션을 보존하라.
7. scenario_text 안의 @멘션 = events.refs 의 display_name 과 같은 것을 가리켜야 한다.
8. 가사·timestamp 는 일체 사용하지 않는다(입력에도 없다).

# 출력 형식 예시
{
  "scenario_text": "@groom_casual 와 @bride_casual 가 처음 마주친 건 ... ...",
  "scenario_events": [
    {
      "order": 1,
      "story_slot": "meeting",
      "memory_index": null,
      "summary": "4월의 회사 회식, 야근 중 처음 마주친 @groom_casual 와 @bride_casual 가 ...",
      "refs": [
        {"type":"sheet","asset_id":"groom_casual","display_name":"신랑 평상복","object_name":null},
        {"type":"sheet","asset_id":"bride_casual","display_name":"신부 평상복","object_name":null}
      ]
    }
  ]
}
"""


# ──────────────────────────────────────────────────────────────────────────
# User message builder
# ──────────────────────────────────────────────────────────────────────────

def _collect_story_block(story_snapshot: dict) -> str:
    """6시점 본문 + 각 시점의 *_refs 풀 + couple/vow/wedding_context 직렬화."""
    s = story_snapshot or {}

    # CoupleStory 형태 ({couple, story, vow, wedding_context}) 또는
    # 평면화된 story 단독 dict ({meeting, first_date, ...}) 둘 다 지원.
    story = s.get("story") if isinstance(s.get("story"), dict) else s
    couple = s.get("couple") or {}
    vow = s.get("vow") or {}
    wedding_context = s.get("wedding_context") or {}

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

    lines: list[str] = []

    # 커플 / 분위기 / 서약 (선택)
    partner_a = (couple or {}).get("partner_a") or {}
    partner_b = (couple or {}).get("partner_b") or {}
    if partner_a or partner_b:
        lines.append("[커플]")
        lines.append(
            f"신랑: {partner_a.get('name','?')} ({partner_a.get('age','?')}살)"
        )
        lines.append(
            f"신부: {partner_b.get('name','?')} ({partner_b.get('age','?')}살)"
        )
        lines.append("")

    if wedding_context:
        tone = wedding_context.get("tone")
        audience = wedding_context.get("audience_line")
        if tone or audience:
            lines.append("[웨딩 분위기·청자 메모]")
            if tone:
                lines.append(f"tone: {tone}")
            if audience:
                lines.append(f"audience_line: {audience}")
            lines.append("")

    if vow:
        keywords = vow.get("keywords") or []
        vline = vow.get("line")
        if keywords or vline:
            lines.append("[서약 메모]")
            if keywords:
                lines.append(f"keywords: {', '.join([str(k) for k in keywords])}")
            if vline:
                lines.append(f"line: {vline}")
            lines.append("")

    lines.append("[스토리 6시점]")

    meeting = (story or {}).get("meeting") or ""
    meeting_refs = (story or {}).get("meeting_refs") or []
    lines.append("")
    lines.append("## meeting (첫 만남)")
    lines.append(meeting or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(meeting_refs)}")

    first_date = (story or {}).get("first_date") or ""
    first_date_refs = (story or {}).get("first_date_refs") or []
    lines.append("")
    lines.append("## first_date (첫 데이트)")
    lines.append(first_date or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(first_date_refs)}")

    memories = (story or {}).get("memories") or []
    memories_refs = (story or {}).get("memories_refs") or []
    lines.append("")
    lines.append("## memories (함께 쌓인 추억)")
    if memories:
        for idx, m in enumerate(memories):
            lines.append(f"  - memories[{idx}]: {m}")
            mref = (memories_refs[idx] if idx < len(memories_refs) else []) or []
            lines.append(f"    refs 풀: {_refs_repr(mref)}")
    else:
        lines.append("(비어있음)")

    proposal = (story or {}).get("proposal") or ""
    proposal_refs = (story or {}).get("proposal_refs") or []
    lines.append("")
    lines.append("## proposal (결혼을 결심한 순간)")
    lines.append(proposal or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(proposal_refs)}")

    wedding_prep = (story or {}).get("wedding_prep") or ""
    wedding_prep_refs = (story or {}).get("wedding_prep_refs") or []
    lines.append("")
    lines.append("## wedding_prep (웨딩 준비 — 드레스/촬영)")
    lines.append(wedding_prep or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(wedding_prep_refs)}")

    rituals = (story or {}).get("rituals") or ""
    rituals_refs = (story or {}).get("rituals_refs") or []
    lines.append("")
    lines.append("## rituals (둘만의 단어·장소)")
    lines.append(rituals or "(비어있음)")
    lines.append(f"refs 풀: {_refs_repr(rituals_refs)}")

    return "\n".join(lines)


def _build_user_message(story_snapshot: dict) -> str:
    story_block = _collect_story_block(story_snapshot)

    return (
        f"{story_block}\n\n"
        "[요구]\n"
        "위 스토리 6시점을 바탕으로 (1) 5~6 페이지 분량(약 3000~5000자)의 한국어 서술체 scenario_text 와 "
        "(2) 시점별 키 사건 리스트 scenario_events 를 만들어라. "
        "@멘션 토큰은 본문/summary 양쪽에 그대로 보존하라. "
        "memories 가 N 개면 events 에도 story_slot=\"memory\" 항목이 N 개 들어가야 한다. "
        "출력은 JSON 한 객체만. 마크다운 코드펜스·서두·설명 금지."
    )


# ──────────────────────────────────────────────────────────────────────────
# Model dispatch
# ──────────────────────────────────────────────────────────────────────────

def _resolve_model_id(scenario_model: str) -> tuple[str, str]:
    """scenario_model 별칭 → (provider, model_id)."""
    if scenario_model == "claude_4_7_opus":
        return ("claude", settings.wedding_lyrics_default_model or "claude-opus-4-7")
    if scenario_model == "gpt_latest":
        return ("openai", settings.openai_model_advanced or "gpt-5.4")
    raise ValueError(
        f"unknown scenario_model: {scenario_model} (allowed: claude_4_7_opus, gpt_latest)"
    )


_MAX_TOKENS = 12000  # v30 — 10000 → 12000 (thinking ON 시 reasoning/thinking 토큰 안전 마진)


async def _call_claude(model_id: str, user_message: str, max_tokens: int) -> str:
    from .llm_thinking_config import apply_thinking_to_anthropic
    client = _get_anthropic_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "system": PHASE0_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
        "temperature": 0.5,
    }
    # v27 — adaptive thinking + strip unsupported sampling (Opus 4.7+).
    apply_thinking_to_anthropic(kwargs, model_id)
    logger.info(
        "[PreMVPhase0] llm claude model=%s max_tokens=%d thinking=%s",
        model_id, max_tokens, bool(kwargs.get("thinking")),
    )
    resp = await client.messages.create(**kwargs)
    return _xtxt(resp)


async def _call_openai(model_id: str, user_message: str, max_tokens: int) -> str:
    from .llm_thinking_config import apply_reasoning_to_openai
    client = _get_openai_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": PHASE0_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    # v27 — reasoning_effort + strip unsupported sampling (GPT-5+).
    apply_reasoning_to_openai(kwargs, model_id)
    logger.info(
        "[PreMVPhase0] llm openai model=%s max_completion_tokens=%d reasoning=%s",
        model_id, max_tokens, bool(kwargs.get("reasoning_effort")),
    )
    try:
        resp = await client.chat.completions.create(**kwargs)
    except Exception as e:
        if "max_completion_tokens" in str(e):
            kwargs.pop("max_completion_tokens", None)
            kwargs["max_tokens"] = max_tokens
            resp = await client.chat.completions.create(**kwargs)
        else:
            raise
    return (resp.choices[0].message.content or "").strip()


# ──────────────────────────────────────────────────────────────────────────
# Response parsing + validation
# ──────────────────────────────────────────────────────────────────────────

_MENTION_RE = re.compile(r"@[A-Za-z0-9_\-가-힣]+")


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


def _parse_response(raw: str) -> dict:
    cleaned = _strip_code_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise ValueError(f"LLM 응답을 JSON 으로 파싱할 수 없습니다: {e}") from e
    if not isinstance(parsed, dict):
        raise ValueError("LLM 응답이 객체가 아닙니다.")
    return parsed


def _normalize_refs(raw_refs: Any) -> list[dict]:
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


def _validate_scenario(
    parsed: dict,
    *,
    expected_memory_count: int,
) -> dict:
    """LLM 응답 검증 + 시간 역행 보정 (stable sort).

    Raises:
        ValueError: 필수 필드 누락 / scenario_text 너무 짧음 / events 비어있음.
    """
    text = parsed.get("scenario_text")
    if not isinstance(text, str) or len(text.strip()) < 200:
        raise ValueError(
            "scenario_text 가 비어있거나 너무 짧습니다(>=200자 권장). "
            f"got_len={len(text or '') if isinstance(text, str) else 0}"
        )
    text = text.strip()

    events_raw = parsed.get("scenario_events")
    if not isinstance(events_raw, list) or not events_raw:
        raise ValueError("scenario_events 가 비어있습니다.")

    # 1) 항목 검증·정규화
    normalized: list[dict] = []
    for idx, ev in enumerate(events_raw):
        if not isinstance(ev, dict):
            continue
        slot = ev.get("story_slot")
        if slot not in _SLOT_ORDER:
            # 도메인 외 slot 은 drop
            logger.debug("[PreMVScenario] drop event idx=%d invalid_slot=%r", idx, slot)
            continue
        mem_idx = ev.get("memory_index")
        if slot == "memory":
            try:
                mem_idx = int(mem_idx) if mem_idx is not None else 0
            except (TypeError, ValueError):
                mem_idx = 0
        else:
            mem_idx = None
        summary = (ev.get("summary") or "").strip()
        if len(summary) > 400:
            summary = summary[:400]

        normalized.append({
            "order": 0,  # 아래에서 재할당
            "story_slot": slot,
            "memory_index": mem_idx,
            "summary": summary,
            "refs": _normalize_refs(ev.get("refs")),
        })

    if not normalized:
        raise ValueError("정규화 후 scenario_events 가 비어있습니다.")

    # 2) memory_index 정규화 — 누락/중복 시 등장 순서대로 0..K-1 채움.
    mem_events = [e for e in normalized if e["story_slot"] == "memory"]
    if mem_events:
        # 입력 memories 가 N 개라도 LLM 이 더 잘게 쪼갰을 수 있으므로
        # 가장 작은 정수부터 stable 하게 재할당하지 않고, 그냥 0..K-1 로 부여.
        for i, e in enumerate(mem_events):
            # 모델이 0..N-1 범위를 정상 출력하면 그대로 두되, 아니면 i 로 보정.
            cur = e["memory_index"]
            if not isinstance(cur, int) or cur < 0:
                e["memory_index"] = i

    # 3) 시간 역행 보정 — stable sort by (_SLOT_ORDER[slot] * 100 + (memory_index or 0))
    def _sort_key(ev: dict) -> int:
        slot_idx = _SLOT_ORDER[ev["story_slot"]]
        mem = ev.get("memory_index") if ev.get("memory_index") is not None else 0
        return slot_idx * 100 + int(mem)

    normalized.sort(key=_sort_key)

    # 4) order 재부여
    for i, e in enumerate(normalized):
        e["order"] = i + 1

    # 5) @멘션 일관성 (warning only — 누락이 있어도 fail 시키지 않는다)
    text_mentions = set(_MENTION_RE.findall(text))
    event_mentions: set[str] = set()
    for e in normalized:
        event_mentions.update(_MENTION_RE.findall(e["summary"] or ""))
        for r in e["refs"]:
            dn = r.get("display_name") or ""
            event_mentions.add(f"@{dn}")
    missing_in_text = event_mentions - text_mentions
    if missing_in_text:
        logger.warning(
            "[PreMVScenario] mentions in events not present in scenario_text: %s",
            sorted(list(missing_in_text))[:8],
        )

    # 6) memory 개수 일관성 (warning only)
    if expected_memory_count > 0:
        actual_mem = sum(1 for e in normalized if e["story_slot"] == "memory")
        if actual_mem != expected_memory_count:
            logger.warning(
                "[PreMVScenario] memory_count mismatch expected=%d actual=%d",
                expected_memory_count, actual_mem,
            )

    return {
        "scenario_text": text,
        "scenario_events": normalized,
    }


# ──────────────────────────────────────────────────────────────────────────
# Public entry (v21)
# ──────────────────────────────────────────────────────────────────────────

async def generate_scenario(
    *,
    pre_mv_job_id: str,
    story_snapshot: dict,
    scenario_model: str,
) -> dict:
    """Phase 0 진입점(v21). 스토리 6시점 → 시나리오 본문 + 키 이벤트.

    Returns:
        {"scenario_text": str, "scenario_events": list[dict]}

    Raises:
        ValueError: 모델 출력 검증 실패.
        RuntimeError: API 키 미설정.
        Exception: 외부 API 호출 실패.
    """
    provider, model_id = _resolve_model_id(scenario_model)

    if provider == "claude" and not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 가 설정되어 있지 않습니다.")
    if provider == "openai" and not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY 가 설정되어 있지 않습니다.")

    # memory 개수 추정 — 검증 단계 warning 용.
    raw_story = (
        story_snapshot.get("story")
        if isinstance(story_snapshot.get("story"), dict)
        else story_snapshot
    )
    memories_in = (raw_story or {}).get("memories") or []
    expected_memory_count = len(memories_in)

    user_message = _build_user_message(story_snapshot=story_snapshot)

    logger.info(
        "[PreMVScenario] entry pre_mv_job_id=%s phase=phase0 model=%s provider=%s "
        "user_msg_len=%d expected_memory_count=%d max_tokens=%d",
        pre_mv_job_id, model_id, provider,
        len(user_message), expected_memory_count, _MAX_TOKENS,
    )

    started = time.time()
    last_err: Optional[Exception] = None

    # 1회 호출 + 검증 실패 시 1회 재시도
    for attempt in (1, 2):
        try:
            if provider == "claude":
                raw = await _call_claude(model_id, user_message, _MAX_TOKENS)
            else:
                raw = await _call_openai(model_id, user_message, _MAX_TOKENS)
            parsed = _parse_response(raw)
            result = _validate_scenario(
                parsed, expected_memory_count=expected_memory_count
            )
            elapsed_ms = int((time.time() - started) * 1000)
            logger.info(
                "[PreMVScenario] ok pre_mv_job_id=%s phase=phase0 model=%s attempt=%d "
                "text_len=%d events_count=%d elapsed_ms=%d",
                pre_mv_job_id, model_id, attempt,
                len(result["scenario_text"]), len(result["scenario_events"]),
                elapsed_ms,
            )
            return result
        except Exception as e:
            last_err = e
            logger.warning(
                "[PreMVScenario] attempt=%d failed pre_mv_job_id=%s phase=phase0 "
                "model=%s err=%s: %s",
                attempt, pre_mv_job_id, model_id,
                type(e).__name__, str(e)[:200],
            )
            if attempt == 2:
                break
            user_message = (
                user_message
                + "\n\n[★ 재시도 강제]\n"
                + f"이전 출력이 검증 실패했다(err={type(e).__name__}). "
                + "이번에는 반드시 JSON 한 객체만 (scenario_text + scenario_events) 로 출력하고, "
                + "scenario_text 는 200자 이상의 한국어 서술, scenario_events 는 "
                + "{order, story_slot, memory_index, summary, refs[]} shape 의 배열로 만들어라."
            )

    elapsed_ms = int((time.time() - started) * 1000)
    logger.exception(
        "[PreMVScenario] all attempts failed pre_mv_job_id=%s phase=phase0 model=%s elapsed_ms=%d",
        pre_mv_job_id, model_id, elapsed_ms,
    )
    raise last_err or RuntimeError("Phase 0 시나리오 생성 실패")


# ──────────────────────────────────────────────────────────────────────────
# Backward-compat stub — v17~v20 의 진입점 (라인 1:1 매핑). v21 에서 폐기.
# 호출처(pre_mv.py) 는 모두 generate_scenario 로 교체되었지만, 외부 코드가 import
# 했을 수 있으니 명시적 에러를 던지는 stub 만 남긴다.
# ──────────────────────────────────────────────────────────────────────────

async def generate_scene_plan(*args, **kwargs):  # pragma: no cover
    raise RuntimeError(
        "generate_scene_plan 은 v21 에서 폐기되었습니다. "
        "대신 generate_scenario(pre_mv_job_id, story_snapshot, scenario_model) 을 호출하세요."
    )
