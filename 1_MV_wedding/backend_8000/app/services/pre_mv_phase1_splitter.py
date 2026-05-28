"""
v17.1 — Phase 1: scene_plan(가사 라인 매핑) → scenes[] 분할 + prompt 합성.

단순화 정책 (PLAN.md v17.1):
  · 우리 환경에 madmom 비트 분석 의존성 없음 → 가사 timestamp 만으로 작업.
  · 가사 라인 1줄 = 씬 1개 (영상모델 8~15초 제약).
  · 인접 라인이 너무 짧으면(예: 1.5s 미만) 다음 라인과 합칠 수 있으나,
    v17.1 골격에서는 1:1 매핑 우선 (합치기는 후속 튜닝 항목).
  · use_seconds = clamp(lyric_end - lyric_start + 마진, 1.5, 15.0).
  · 같은 story_slot 의 인접 씬은 video_prompt 에 "이전 씬에서 이어지는 연속 컷" 명시.

씬 prompt 합성:
  · LLM 1회 호출 (Claude/OpenAI) — 라인별 image_prompt/video_prompt/description 영문+한국어 미러 생성.
  · 9004 SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE 의 단순화 버전.
  · LLM 호출 실패 시 fallback: lyric_line / story_excerpt 기반 결정론적 prompt 생성 (영상은 만들어진다).

출력 scenes[] 원소 shape — PLAN.md v17.1 와 동일:
  {
    scene_number, description, description_ko,
    image_prompt, image_prompt_ko, video_prompt, video_prompt_ko,
    section, section_start, section_end, use_seconds,
    event_index, ref_sheet_ids, ref_place_ids,
    story_slot,
    image_object_name, video_object_name,
    image_status, video_status, image_error, video_error,
    image_started_at, image_finished_at, video_started_at, video_finished_at,
    user_edited_fields,
  }
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
# 길이/구간 계산
# ──────────────────────────────────────────────────────────────────────────

_MIN_USE_SEC = 1.5
_MAX_USE_SEC = 15.0
_TAIL_MARGIN = 0.3   # 라인 끝에 살짝 더 영상 길이 줌


def _compute_use_seconds(start: float, end: float) -> float:
    raw = (end - start) + _TAIL_MARGIN
    if raw < _MIN_USE_SEC:
        return _MIN_USE_SEC
    if raw > _MAX_USE_SEC:
        return _MAX_USE_SEC
    return round(raw, 2)


# ──────────────────────────────────────────────────────────────────────────
# Prompt 합성 LLM
# ──────────────────────────────────────────────────────────────────────────

SCENE_SPLIT_SYSTEM_PROMPT = """역할: 결혼식 식전영상의 씬 디렉터.

입력으로 받는 자료:
- 가사 라인 N 개 (각 라인은 이미 story_slot 과 story_excerpt 가 매핑되어 있다)
- 같은 story_slot 의 인접 씬은 시각적 연속성이 있어야 한다 (인물·장소·연속 컷)

해야 하는 일:
각 가사 라인마다 영상 한 컷의 image_prompt / video_prompt / description 을 영문과 한국어로 만든다.

# 규칙
1. 출력 항목 수는 입력 라인 수와 정확히 동일.
2. 모든 씬은 결혼식 식전영상용 드라마 씬 (립싱크 / 노래 부르는 장면 절대 금지, 카메라를 정면으로 응시하는 클로즈업 금지).
3. @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름)은 image_prompt / video_prompt 본문에 그대로 보존하라(번역·치환 금지).
4. image_prompt — 영문 한 단락(40~80단어). 인물 2명(신랑+신부) 모두 reference 시트와 일치해야 함을 명시.
   장소·소품·계절·시간대를 story_excerpt 에서 추출해 박는다.
5. video_prompt — 영문 한 단락(40~80단어). 카메라 워크(dolly/handheld/wide/close-up 등), 인물의 미세 동작, 감정 톤만 묘사.
   같은 story_slot 의 직전 씬과 같은 위치/같은 의상이면 prompt 앞에 "Continuing seamlessly from the previous scene," 를 붙여라.
6. description — 한 줄 영문 캡션(20단어 이내).
7. *_ko 필드는 위 영문 필드의 한국어 자연 번역(고유명사·@멘션 보존).
8. 결혼식 본행사 어휘 금지: ceremony, altar, vows being read, officiant 등.

# 출력 형식
오직 JSON 한 덩어리. 마크다운 코드펜스 금지. 다음 shape:
{
  "scenes": [
    {
      "scene_number": 1,
      "description": "...",
      "description_ko": "...",
      "image_prompt": "...",
      "image_prompt_ko": "...",
      "video_prompt": "...",
      "video_prompt_ko": "..."
    },
    ...
  ]
}
"""


def _build_user_message(
    *,
    scene_plan: list[dict],
    music_spec: dict,
) -> str:
    genre = (music_spec or {}).get("genre") or "—"
    moods = (music_spec or {}).get("moods") or []
    tone_block = f"장르: {genre}\n분위기: {', '.join([str(m) for m in moods]) or '—'}\n"

    lines: list[str] = ["[가사 라인 매핑 — 각 라인을 한 씬으로 만든다]"]
    for idx, item in enumerate(scene_plan):
        line = (item.get("lyric_line") or "").strip()
        slot = item.get("story_slot") or "?"
        excerpt = (item.get("story_excerpt") or "").strip()
        ref_chips = []
        for r in (item.get("refs") or []):
            if isinstance(r, dict):
                ref_chips.append(f"@{r.get('display_name','?')}({r.get('type','?')})")
        refs_repr = ", ".join(ref_chips) if ref_chips else "(없음)"
        lines.append(
            f"line[{idx}] slot={slot} | lyric: {line}\n"
            f"  story_excerpt: {excerpt}\n"
            f"  refs: {refs_repr}"
        )
    return (
        f"{tone_block}\n"
        f"라인 수: {len(scene_plan)}\n\n"
        + "\n".join(lines)
        + "\n\n[요구]\n오직 JSON 한 덩어리만 출력. 라인 수 = 씬 수."
    )


def _resolve_prompt_model() -> tuple[str, str]:
    """Phase 1 prompt 합성 모델 — Claude 4.7 Opus 우선, 없으면 OpenAI."""
    if settings.anthropic_api_key:
        return ("claude", settings.wedding_lyrics_default_model or "claude-opus-4-7")
    if settings.openai_api_key:
        return ("openai", settings.openai_model_advanced or "gpt-5.4")
    raise RuntimeError("Phase 1 prompt 합성용 LLM 키가 모두 비어있습니다.")


def _max_tokens_for_scene_split(scene_count: int) -> int:
    base = 2000
    per_scene = 350
    cap = 16000
    return min(cap, max(base, scene_count * per_scene))


async def _call_claude(model_id: str, user_message: str, max_tokens: int) -> str:
    client = _get_anthropic_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "system": SCENE_SPLIT_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
    }
    if "opus-4-7" not in model_id:
        kwargs["temperature"] = 0.5
    resp = await client.messages.create(**kwargs)
    return (resp.content[0].text or "").strip()


async def _call_openai(model_id: str, user_message: str, max_tokens: int) -> str:
    client = _get_openai_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": SCENE_SPLIT_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
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


def _parse_scenes_response(raw: str) -> list[dict]:
    cleaned = _strip_code_fence(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
        else:
            raise ValueError(f"LLM scene_split 응답을 JSON 으로 파싱할 수 없습니다: {e}") from e

    if isinstance(parsed, list):
        return parsed
    if not isinstance(parsed, dict):
        raise ValueError("scene_split 응답이 객체가 아닙니다.")
    items = parsed.get("scenes")
    if not isinstance(items, list):
        for k in ("items", "data", "scene_list"):
            if isinstance(parsed.get(k), list):
                items = parsed[k]
                break
    if not isinstance(items, list):
        raise ValueError("scenes 배열을 찾을 수 없습니다.")
    return items


# ──────────────────────────────────────────────────────────────────────────
# fallback prompt 합성 (LLM 실패 시 결정론적 채우기)
# ──────────────────────────────────────────────────────────────────────────

_SLOT_LABEL_EN = {
    "meeting": "their first meeting",
    "first_date": "their first date",
    "memories": "a shared memory",
    "proposal": "the proposal moment",
    "wedding_prep": "wedding preparation",
    "rituals": "their own private place and word",
}
_SLOT_LABEL_KO = {
    "meeting": "첫 만남",
    "first_date": "첫 데이트",
    "memories": "함께 쌓인 추억",
    "proposal": "결혼을 결심한 순간",
    "wedding_prep": "웨딩 준비",
    "rituals": "둘만의 단어·장소",
}


def _fallback_prompts_for_line(item: dict) -> dict:
    slot = item.get("story_slot") or "memories"
    label_en = _SLOT_LABEL_EN.get(slot, "a shared moment")
    label_ko = _SLOT_LABEL_KO.get(slot, "함께한 한순간")
    lyric = (item.get("lyric_line") or "").strip()
    excerpt = (item.get("story_excerpt") or "").strip()
    refs = item.get("refs") or []
    chips = " ".join(["@" + (r.get("display_name") or "") for r in refs if isinstance(r, dict)]).strip()

    image_prompt = (
        f"A cinematic wedding pre-ceremony still depicting {label_en}. "
        f"Both the bride and the groom must match their reference sheets. "
        f"Context: {excerpt or lyric}. {chips}"
    ).strip()
    image_prompt_ko = (
        f"{label_ko} 장면의 결혼식 식전영상 한 컷. 신랑과 신부 모두 reference 시트와 일치해야 한다. "
        f"맥락: {excerpt or lyric}. {chips}"
    ).strip()
    video_prompt = (
        f"A gentle handheld camera move on the couple, soft natural light, intimate atmosphere. "
        f"No singing, no facing the camera. Subtle micro-expressions reflecting {label_en}."
    ).strip()
    video_prompt_ko = (
        f"커플 위로 부드러운 핸드헬드 카메라 워크, 자연광, 사적인 분위기. "
        f"립싱크나 정면 응시 금지. {label_ko} 의 감정이 미세하게 드러나는 표정."
    ).strip()
    description = f"{label_en} — {lyric}"[:200]
    description_ko = f"{label_ko} — {lyric}"[:200]
    return {
        "description": description,
        "description_ko": description_ko,
        "image_prompt": image_prompt,
        "image_prompt_ko": image_prompt_ko,
        "video_prompt": video_prompt,
        "video_prompt_ko": video_prompt_ko,
    }


# ──────────────────────────────────────────────────────────────────────────
# 연속 컷 전치사
# ──────────────────────────────────────────────────────────────────────────

_CONT_EN = "Continuing seamlessly from the previous scene, "
_CONT_KO = "이전 씬에서 이어지는 연속 컷, "


def _maybe_prepend_continuity(prompts: dict, prev_slot: Optional[str], cur_slot: str) -> dict:
    if not prev_slot or prev_slot != cur_slot:
        return prompts
    vp = prompts.get("video_prompt") or ""
    vp_ko = prompts.get("video_prompt_ko") or ""
    if vp and not vp.lower().startswith("continuing"):
        prompts["video_prompt"] = _CONT_EN + vp
    if vp_ko and not vp_ko.startswith("이전 씬"):
        prompts["video_prompt_ko"] = _CONT_KO + vp_ko
    return prompts


# ──────────────────────────────────────────────────────────────────────────
# Public entry
# ──────────────────────────────────────────────────────────────────────────

def _collect_ref_ids(refs: list[dict]) -> tuple[list[str], list[str]]:
    """refs 에서 (ref_sheet_ids, ref_place_ids+wedding_photo_ids) 분리."""
    sheet_ids: list[str] = []
    place_or_photo_ids: list[str] = []
    for r in (refs or []):
        if not isinstance(r, dict):
            continue
        t = r.get("type")
        aid = r.get("asset_id")
        if not aid:
            continue
        if t == "sheet":
            sheet_ids.append(str(aid))
        elif t in ("place", "wedding_photo"):
            place_or_photo_ids.append(str(aid))
    return sheet_ids, place_or_photo_ids


async def split_into_scenes(
    *,
    pre_mv_job_id: str,
    scene_plan: list[dict],
    music_spec: dict,
) -> list[dict]:
    """Phase 1 entry. scene_plan → scenes[].

    Raises:
        ValueError: scene_plan 비어있음.
        Exception: LLM 호출 실패 시에도 fallback 으로 결정론적 prompts 사용,
            치명적 실패만 raise.
    """
    n = len(scene_plan)
    if n == 0:
        raise ValueError("scene_plan 이 비어있습니다.")

    started = time.time()

    # 1) LLM 으로 prompt 합성 (실패하면 fallback)
    prompts_by_idx: list[dict] = []
    try:
        provider, model_id = _resolve_prompt_model()
        user_message = _build_user_message(scene_plan=scene_plan, music_spec=music_spec)
        max_tokens = _max_tokens_for_scene_split(n)

        logger.info(
            "[PreMVSplit] llm entry pre_mv_job_id=%s model=%s provider=%s "
            "scene_count=%d max_tokens=%d",
            pre_mv_job_id, model_id, provider, n, max_tokens,
        )

        if provider == "claude":
            raw = await _call_claude(model_id, user_message, max_tokens)
        else:
            raw = await _call_openai(model_id, user_message, max_tokens)

        parsed = _parse_scenes_response(raw)
        if len(parsed) != n:
            logger.warning(
                "[PreMVSplit] llm count mismatch pre_mv_job_id=%s expected=%d got=%d "
                "— falling back to deterministic prompts",
                pre_mv_job_id, n, len(parsed),
            )
            prompts_by_idx = [_fallback_prompts_for_line(scene_plan[i]) for i in range(n)]
        else:
            for i, item in enumerate(parsed):
                if not isinstance(item, dict):
                    prompts_by_idx.append(_fallback_prompts_for_line(scene_plan[i]))
                    continue
                merged = _fallback_prompts_for_line(scene_plan[i])
                for k in ("description", "description_ko",
                          "image_prompt", "image_prompt_ko",
                          "video_prompt", "video_prompt_ko"):
                    v = item.get(k)
                    if isinstance(v, str) and v.strip():
                        merged[k] = v.strip()
                prompts_by_idx.append(merged)
    except Exception as e:
        logger.warning(
            "[PreMVSplit] llm failed pre_mv_job_id=%s err=%s: %s — falling back",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        prompts_by_idx = [_fallback_prompts_for_line(scene_plan[i]) for i in range(n)]

    # 2) scenes[] 조립 + 연속 컷 보강 + ref id 분리
    scenes: list[dict] = []
    prev_slot: Optional[str] = None
    for i, plan_item in enumerate(scene_plan):
        slot = plan_item.get("story_slot") or "memories"
        prompts = _maybe_prepend_continuity(prompts_by_idx[i], prev_slot, slot)

        start = float(plan_item.get("lyric_start") or 0.0)
        end = float(plan_item.get("lyric_end") or start)
        use_sec = _compute_use_seconds(start, end)
        sheet_ids, place_or_photo_ids = _collect_ref_ids(plan_item.get("refs") or [])

        scenes.append({
            "scene_number": i + 1,
            "description": prompts["description"],
            "description_ko": prompts["description_ko"],
            "image_prompt": prompts["image_prompt"],
            "image_prompt_ko": prompts["image_prompt_ko"],
            "video_prompt": prompts["video_prompt"],
            "video_prompt_ko": prompts["video_prompt_ko"],
            # 음악 섹션 — 라인 단위 모드라 라벨 없음, slot 으로 대체
            "section": slot,
            "section_start": start,
            "section_end": end,
            "use_seconds": use_sec,
            "event_index": i,
            "ref_sheet_ids": sheet_ids,
            "ref_place_ids": place_or_photo_ids,
            "story_slot": slot,
            # 산출 후 채워질 필드
            "image_object_name": None,
            "video_object_name": None,
            "image_status": "pending",
            "video_status": "pending",
            "image_error": None,
            "video_error": None,
            "image_started_at": None,
            "image_finished_at": None,
            "video_started_at": None,
            "video_finished_at": None,
            "user_edited_fields": [],
        })
        prev_slot = slot

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[PreMVSplit] ok pre_mv_job_id=%s scene_count=%d elapsed_ms=%d",
        pre_mv_job_id, len(scenes), elapsed_ms,
    )
    return scenes
