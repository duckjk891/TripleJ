"""
v21.2 — Phase 1: scenario_text + scenario_events → scenes[].

v21.5 변경 — LLM 라벨 의존 제거 (event_index + 코드 로직).
  - LLM 응답 스키마에서 `story_slot` / `memory_index` / `ref_sheet_ids` /
    `ref_place_ids` 4개 결정론 필드 제거.
  - 대신 `event_index: int` (0 ~ events.length-1) 단 하나만 받음.
  - 코드가 `events[event_index]` 에서 위 4개 + `section` 을 강제 박음.
  - 검증: 모든 event 한 번 이상 분배 보장 (누락 시 1회 retry → fallback 보충).
  - 정렬: scenes 의 `event_index` 단조 증가 강제 (같은 값 안에서 응답 순서 유지).
  - 시스템 프롬프트: `SCENE_SPLIT_SYSTEM_PROMPT_V215` 신설 — 절대 규칙에
    "결정론 라벨은 시스템이 채운다 — 절대 응답에 박지 마라" 추가.
  - `_build_fallback_scenes_v212` 가 결과 dict 에 `event_index` 키 추가
    (post-process 공통 경로 호환).

v21.4 변경 — LLM 자율 결정 (씬 개수 + 길이 + 총합 ≥ 음악×2).
  - `clips_per_event` 사용자 입력 제거 — LLM 이 각 event 의 풍부도에 맞춰
    1~6 씬을 자율 결정.
  - 씬 길이 가이드라인 5~15초 (v21.3 의 3~15 갱신).
  - 입력에 `music_duration_sec` 추가. system prompt 가 "모든 씬 use_seconds 합
    ≥ music_duration_sec × 2 보장" 명시.
  - 응답 JSON 스키마 확장: `{ "total_use_seconds": float, "scenes": [...] }`.
  - 검증: 응답 scenes 의 use_seconds 합 < music_duration_sec × 1.8 면 1회 retry
    (강조 prompt). retry 미달이면 결과 채택 (LLM 한도로 간주).
  - `_build_fallback_scenes_v212(events, music_duration_sec)` — 결정론 fallback
    이 음악×2 목표로 event 당 평균 5 씬 / 평균 13s 분배 (짧·중·긴 패턴 섞기).
  - 반환 dict 에 `target_total_seconds`, `actual_total_seconds` 키 추가.

v21.3 변경 — LLM 이 각 씬 use_seconds (영상 길이 초) 를 description 호흡에 맞춰
   유동 결정. v21.2 의 균등 8.0s 강제 폐기.
  - 시스템 프롬프트에 길이 가이드라인 추가:
      짧은 정적 컷 / 미세 표정 = 3~5s
      보통 동작 / 한 흐름      = 6~9s
      복잡 액션 / 시간 전환    = 10~15s
    출력 범위 3.0 ~ 15.0 (정수 또는 소수).
  - 응답 JSON shape 에 `use_seconds: number` 필드 추가.
  - splitter 정규화 단계: LLM 응답에서 `use_seconds` 추출 → float 변환 →
    `[3.0, 15.0]` 범위 안전 clamp → 누락/실패 시 `video_clip_default(8.0)` 으로 보강.
  - 모델 한계 클램프는 Phase 3 generator 단에서 처리 (Veo 8 고정, Kling 3-15,
    Seedance 5-15, Grok 1-10) — splitter 는 모델 무관 정규화만.
  - `_build_fallback_scenes_v212` 의 결정론 fallback 은 그대로 — `_fallback_prompts_from_event`
    가 use_seconds 키를 안 주므로 splitter 의 default 보강 경로로 8.0 균등 채움.

v21.2 변경 — 음악 sync 의존 완전 제거 + clips_per_event 균등 분배.
  - Suno alignedWords timing 결함(첫 ~60줄이 0~1.5초에 박힘) 으로 v21.1 의 마커
    기반 use_seconds 가 0.01~0.04s 로 잘못 잡히는 문제 → 음악 sync 자체 폐기.
  - 새 진입점 `split_into_scenes_v212`:
      입력: pre_mv_job_id, scenario_text, scenario_events, clips_per_event ∈ {2,3,4},
           video_clip_default(=8.0).
      출력: {"section_markers": [], "scenes": [...]}.
            scenes 총 개수 = `len(scenario_events) × clips_per_event`.
            (v21.3) 각 씬 use_seconds 는 LLM 결정 (3~15s clamp), 누락 시 video_clip_default.
            section / section_start / section_end 는 호환 위해 키만 유지
            (section = event.story_slot 라벨, start/end = 0.0).
  - LLM 마커 추출 / 검증 / scene_quota / use_seconds 보정은 전부 폐기.
    함수 본체는 호환 위해 유지하되 `# DEPRECATED (v21.2)` 주석 표기.
  - 기존 `split_into_scenes_v21` 은 stub 으로 변환 — 호출 시 명시적 RuntimeError.

출력 scenes[] 원소 shape — 9004 호환 그대로 유지:
  {
    scene_number, description, description_ko,
    image_prompt, image_prompt_ko, video_prompt, video_prompt_ko,
    section, section_start, section_end, use_seconds,
    story_slot, memory_index,
    ref_sheet_ids, ref_place_ids,
    image_object_name, video_object_name,
    image_status, video_status, image_error, video_error,
    image_started_at, image_finished_at, video_started_at, video_finished_at,
    user_edited_fields,
  }

추가 출력: section_markers (호환 위해 빈 배열).
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
# 상수
# ──────────────────────────────────────────────────────────────────────────

# v21.2 — 모든 씬 use_seconds 균등 분배 기준값.
_VIDEO_CLIP_DEFAULT = 8.0
# DEPRECATED (v21.2) — 음악 섹션 기반 quota 계산용. v21.2 에선 사용 X.
_VIDEO_CLIP_MAX_DEFAULT = 10.0  # 영상 모델 4종 평균 한계
_MIN_SCENES_PER_SECTION = 2
_MAX_SCENES_PER_SECTION = 6
_MIN_TOTAL_SCENES = 8
_MAX_TOTAL_SCENES = 30

# story_slot 도메인 (Phase 0 와 동일)
VALID_STORY_SLOTS = (
    "meeting",
    "first_date",
    "memory",
    "proposal",
    "wedding_prep",
    "rituals",
)
_SLOT_ORDER = {slot: idx for idx, slot in enumerate(VALID_STORY_SLOTS)}


# 섹션 라벨 정규식 — `[ Intro]`, `[Intro]`, `[Verse 1]`, `[Chorus 1]`,
# `[Pre-Chorus]`, `[Bridge]`, `[Outro]`, `[Hook]`, `[Interlude]`, ...
_SECTION_LABEL_RE = re.compile(
    r"^\s*\[\s*"
    r"(Intro|Outro|Verse(?:\s*\d+)?|Chorus(?:\s*\d+)?|Pre[-\s]?Chorus|Bridge|Hook|Break|Interlude)"
    r"[^\]]*\]\s*$",
    re.IGNORECASE,
)

# v21.1 — 보컬 라벨은 마커가 아니므로 스킵 (raw alignedWords 스캔 시).
_VOCAL_LABEL_RE = re.compile(r"^\s*\[\s*(Male|Female|Both)\s*\]\s*$", re.IGNORECASE)


# ──────────────────────────────────────────────────────────────────────────
# Section markers
# ──────────────────────────────────────────────────────────────────────────

def _normalize_section_label(raw: str) -> str:
    """`[ Verse 1 ]` → `Verse 1`. 공백 정규화·대소문자 보존하지만 표준 케이스."""
    s = raw.strip().strip("[]").strip()
    # Pre-Chorus / Pre Chorus 통일
    s = re.sub(r"(?i)pre[-\s]?chorus", "Pre-Chorus", s)
    # Verse 1 / verse1 / VERSE 1 → "Verse 1"
    m = re.match(r"(?i)^(Intro|Outro|Verse|Chorus|Bridge|Hook|Break|Interlude)\s*(\d+)?$", s)
    if m:
        head = m.group(1).capitalize()
        num = m.group(2)
        if num:
            return f"{head} {num}"
        return head
    return s


def _extract_expected_markers(lyrics_body: str) -> list[str]:
    """DEPRECATED (v21.2) — 음악 마커 검증 폐기로 호출처 없음.

    가사 본문에서 단독 라인 마커를 정규식으로 추출.

    `_SECTION_LABEL_RE` (re.MULTILINE) 으로 단독 라인 매치 + `_normalize_section_label`.
    Returns: `["Intro", "Verse 1", "Pre-Chorus", "Chorus 1", ...]` (등장 순서).
    """
    if not lyrics_body:
        return []
    expected: list[str] = []
    for raw_line in lyrics_body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _SECTION_LABEL_RE.match(line):
            label = _normalize_section_label(line)
            expected.append(label)
    return expected


def _extract_section_markers_v2(
    aligned_words: list[dict],
    *,
    audio_duration: float | None = None,
) -> list[dict]:
    """DEPRECATED (v21.2) — alignedWords 마커 추출 폐기.

    raw Suno alignedWords 단어 시퀀스에서 섹션 마커 직접 추출.

    Suno alignedWords 의 실제 모양 (예시):
      `'시작됐어\\n\\n['` (idx 71) → `'Verse 2]\\n\\n\\n'` (idx 72) → 다음 가사 라인.
      `'[Both] 우리 '` (idx 24) → 가사 (보컬 라벨 같이 묶여 있음).

    핵심: 섹션 마커는 보통 **두 토큰**에 걸쳐 분할된다.
      - prev_token: 가사 본문 + `\\n\\n[` 로 끝남.
      - next_token: `Intro]\\n\\n\\n`, `Verse 2]\\n\\n\\n`, `Pre-Chorus]\\n\\n\\n` ...

    그래서 알고리즘:
      1) 각 토큰의 `word` 텍스트를 모두 이어붙여 큰 문자열을 만들고,
         각 단어의 startS 도 함께 매핑 (그 문자에서의 위치 → startS).
      2) 정규식 `\\[<label>\\]` 로 매치된 위치 → 그 시점의 startS 를 마커 start 로.
      3) 보컬 라벨 `[Male]` `[Female]` `[Both]` 는 스킵 (정규식 도메인).

    각 마커의 start = 그 라벨이 매치된 위치의 startS, end = 다음 마커의 start.
    """
    if not aligned_words:
        return []

    # 1) char_offset → startS 매핑 만들기.
    full_text_parts: list[str] = []
    char_to_start: list[float] = []  # 길이 = sum(len(word)). idx → 단어 startS.
    last_end_s: float = 0.0
    for w in aligned_words:
        if not isinstance(w, dict):
            continue
        raw = str(w.get("word") or "")
        if not raw:
            continue
        try:
            start_s = float(w.get("startS", 0) or 0)
            end_s = float(w.get("endS", 0) or 0)
        except (TypeError, ValueError):
            start_s = 0.0
            end_s = 0.0
        if end_s > last_end_s:
            last_end_s = end_s
        full_text_parts.append(raw)
        char_to_start.extend([start_s] * len(raw))
    full_text = "".join(full_text_parts)
    if not full_text or not char_to_start:
        return []

    # 2) `[label]` 정규식 — 보컬 라벨 + 섹션 라벨 모두 매치 후 도메인 검사.
    bracket_re = re.compile(r"\[([^\[\]\n]+?)\]")
    positions: list[tuple[float, str]] = []  # (start, normalized_label)
    for m in bracket_re.finditer(full_text):
        inner = (m.group(1) or "").strip()
        if not inner:
            continue
        full_match = "[" + inner + "]"
        # 보컬 라벨 스킵.
        if _VOCAL_LABEL_RE.match(full_match):
            continue
        # 섹션 라벨만 통과.
        if not _SECTION_LABEL_RE.match(full_match):
            continue
        label = _normalize_section_label(full_match)
        # 매치 시작 위치의 startS — char_to_start[m.start()] 사용.
        char_idx = m.start()
        if char_idx >= len(char_to_start):
            char_idx = len(char_to_start) - 1
        start_s = char_to_start[char_idx]
        positions.append((float(start_s), label))

    if not positions:
        return []

    # 3) audio_duration / 마지막 endS 기준 끝점.
    last_end: float = last_end_s
    if audio_duration and audio_duration > last_end:
        last_end = float(audio_duration)

    # 3) (start, label) → [{label, start, end}].
    markers: list[dict] = []
    for idx, (start, label) in enumerate(positions):
        if idx + 1 < len(positions):
            end = positions[idx + 1][0]
        else:
            end = last_end if last_end > start else start + 1.0
        if end <= start:
            end = start + 1.0
        markers.append({"label": label, "start": float(start), "end": float(end)})
    return markers


def _validate_marker_match(
    expected: list[str], extracted: list[dict]
) -> tuple[bool, str]:
    """DEPRECATED (v21.2) — 마커 검증 폐기.

    기대 마커 시퀀스 vs 추출된 마커 시퀀스 일치 검증.

    Returns: (ok, korean_error_message_or_empty_string).
    """
    n = len(expected)
    m = len(extracted)
    base_msg = (
        f"곡 구조 인식에 실패했어요 (기대 {n}개 / 인식 {m}개). "
        "Suno 가사 데이터에 결함이 있어 진행할 수 없어요. "
        "새로 음악을 만들거나 운영자에게 문의해 주세요."
    )
    if n != m:
        return False, base_msg
    extracted_labels = [str(x.get("label") or "") for x in extracted]
    if extracted_labels != expected:
        return False, base_msg
    return True, ""


# ──────────────────────────────────────────────────────────────────────────
# Scene count 계산
# ──────────────────────────────────────────────────────────────────────────

def _decide_scene_count_per_section(
    section_marker: dict,
    *,
    video_clip_max: float = _VIDEO_CLIP_MAX_DEFAULT,
) -> int:
    """DEPRECATED (v21.2) — 섹션 quota 계산 폐기. clips_per_event 균등 분배 사용.

    섹션 길이 / 평균 클립 길이. 2~6 으로 clamp."""
    dur = float(section_marker.get("end") or 0.0) - float(section_marker.get("start") or 0.0)
    if dur <= 0 or video_clip_max <= 0:
        return _MIN_SCENES_PER_SECTION
    n = int(round(dur / video_clip_max))
    if n < _MIN_SCENES_PER_SECTION:
        n = _MIN_SCENES_PER_SECTION
    if n > _MAX_SCENES_PER_SECTION:
        n = _MAX_SCENES_PER_SECTION
    return n


# ──────────────────────────────────────────────────────────────────────────
# Audio duration 추정 (music_spec 우선, lyric_timestamps fallback)
# ──────────────────────────────────────────────────────────────────────────

def _infer_audio_duration(
    music_spec: dict, lyric_timestamps: list[dict]
) -> float:
    """DEPRECATED (v21.2) — 음악 길이 보정 폐기.

    music_spec.duration_minutes 우선, 없으면 lyric_timestamps 마지막 end."""
    if isinstance(music_spec, dict):
        mins = music_spec.get("duration_minutes")
        try:
            if mins:
                return float(mins) * 60.0
        except (TypeError, ValueError):
            pass

    last_end = 0.0
    for seg in (lyric_timestamps or []):
        try:
            e = float(seg.get("end") or 0.0)
        except (TypeError, ValueError):
            e = 0.0
        if e > last_end:
            last_end = e
    return last_end if last_end > 0 else 120.0


# ──────────────────────────────────────────────────────────────────────────
# LLM prompt
# ──────────────────────────────────────────────────────────────────────────

SCENE_SPLIT_SYSTEM_PROMPT_V212 = """역할: 결혼식 식전영상의 씬 디렉터 + 시나리오 → 씬 분할가.

입력으로 받는 자료:
1) scenario_text — 한국어 서술 시나리오 본문
2) scenario_events — 시점별 키 사건 리스트 (order, story_slot, memory_index, summary, refs[])
3) music_duration_sec — 곡 전체 길이(초). **참고용** — 강제 목표 아님.

해야 하는 일:
**scenario_events 마다 너 스스로 씬 개수를 결정하라.** event 의 summary / refs 내용이
풍부하면 더 잘게 쪼개고(권장 4~6 씬), 빈약하면 적게(권장 1~3 씬). 입력 events 의 순서를
그대로 보존해서 events[0] 의 씬들이 먼저, 그 다음 events[1] 의 씬들이 나오게 한다.
한 event 안의 씬들은 그 event 의 summary 를 다양한 각도/순간으로 분할한 컷들이다.
음악과 정확한 시간 동기화는 안 한다 — 사용자가 편집기에서 클립 길이를 손편집한다.

핵심 정책: **시나리오 내용을 자연스럽게 최대로 뽑아라.** 같은 장면 반복, 억지 변주,
강제 늘림 같은 품질 저하가 생길 정도면 거기서 멈춰라. music_duration_sec 은 참고용일 뿐:
- 시나리오가 풍부해 자연스럽게 그 길이 이상 나오면 좋다 (사용자 편집 여유분).
- 시나리오 한계로 짧아지면 그대로 OK — 품질 떨어지는 것보다 자연스러운 게 우선.
음악 길이 도달 자체가 목적이 아니다. 자연스러운 한도까지만 뽑아라.

# 출력 씬 shape (한 씬당)
{
  "section": str,           # 그 event 의 story_slot 라벨 그대로 (시간 의미 없음)
  "story_slot": "meeting"|"first_date"|"memory"|"proposal"|"wedding_prep"|"rituals",
  "memory_index": int|null, # story_slot=="memory" 일 때만, event.memory_index 그대로
  "description": str,       # 영문 (10~15단어, 절대 25단어 넘기지 마라)
  "description_ko": str,    # 한국어 (30~50자, 절대 70자 넘기지 마라)
  "image_prompt": str,      # 영문 (30~50단어, 절대 70단어 넘기지 마라)
  "image_prompt_ko": str,   # 한국어 (40~70자, 절대 90자 넘기지 마라)
  "video_prompt": str,      # 영문 (30~50단어, 절대 70단어 넘기지 마라)
  "video_prompt_ko": str,   # 한국어 (40~70자, 절대 90자 넘기지 마라)
  "use_seconds": number,    # 이 씬의 영상 길이 (초). 5.0 ~ 15.0 사이 정수 또는 소수.
                            # description 의 호흡을 충분히 보여줄 길이를 골라라.
  "ref_sheet_ids": [str],   # 이 씬에서 등장하는 캐릭터 시트 asset_id 들
  "ref_place_ids": [str]    # 이 씬에서 등장하는 place/wedding_photo asset_id 들
}

# 절대 규칙
1. 모든 씬은 결혼식 식전영상용 드라마 씬. 립싱크 / 노래 부르는 장면 / 카메라 정면 응시 클로즈업 금지.
2. @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름) 은
   image_prompt / video_prompt 본문에 그대로 보존하라(번역·치환 금지).
3. image_prompt — 인물 2명(신랑+신부)이 등장한다면 reference 시트와 일치해야 함을 명시.
   장소·소품·계절·시간대를 scenario_text/event.summary 에서 추출해 박아라.
4. video_prompt — 카메라 워크(dolly/handheld/wide/close-up 등), 미세 동작, 감정 톤만 묘사.
5. ref_sheet_ids / ref_place_ids — 그 씬 텍스트에 등장한 @멘션이 가리키는 asset_id 들만 채워라.
   입력 events 의 refs 풀에 없는 id 를 만들지 마라.
6. 결혼식 본행사 어휘 금지: ceremony, altar, vows being read, officiant 등.
7. 글래머 표현 금지: provocative / sensual / lingerie 등.
8. 같은 event 안의 인접 씬은 시각적 연속성을 가져야 한다 (이 룰을 따르면 비디오 prompt 앞에
   "Continuing seamlessly from the previous scene," 가 자동으로 prepend 된다 — 너는 그냥 의상·장소를
   일관되게 묘사하면 된다). 같은 story_slot 의 인접 event 끼리도 마찬가지.
9. **씬 개수 결정 가이드라인** — 각 event 의 summary / refs 내용 풍부도에 맞춰 1~6 씬 자율 결정.
   · 한 줄 요약 / 단순 한 장면: **1 ~ 2 씬**
   · 보통 흐름 (시작·전개·여운 등): **3 ~ 4 씬**
   · 풍부한 멀티 액션 / 시간 흐름 / 여러 ref 등장: **5 ~ 6 씬**
   같은 event 의 씬들끼리 너무 비슷한 컷이 되지 않게 각도·순간·동선을 분산하라.
10. **use_seconds 길이 결정 가이드라인** — 각 씬의 description / video_prompt 내용 호흡에 맞춰
    다음 범위에서 골라라:
    · 짧은 정적 컷 / 미세 표정 / 한 호흡: **5 ~ 7초**
    · 보통 동작 / 한 흐름 (걷기·웃음·시선 교환 등): **8 ~ 11초**
    · 복잡한 액션 / 시간 전환 / 다중 동작 (춤·돌발 사건·여러 움직임 합성): **12 ~ 15초**
    범위는 5.0 ~ 15.0. 정수 또는 소수 모두 가능 (예: 6, 9.5, 13).
    모델 한계 클램프(Veo 8 고정 / Kling 3-15 / Seedance 5-15 / Grok 1-10) 는
    시스템이 알아서 처리하니, 너는 'description 내용을 충분히 표현할 길이' 만 결정해라.
    같은 event 안의 씬들이 다 같은 호흡일 필요 없다 — 짧은 컷 + 긴 컷 섞어라.
11. **총합 정책** — 시나리오 내용을 자연스럽게 최대로 뽑아라. music_duration_sec 은 참고용.
    내용이 풍부해 자연스럽게 늘어나면 좋고, 시나리오 한계로 짧아지면 그대로 OK.
    품질 저하 (같은 장면 반복, 억지 변주, 의미 없는 씬 추가) 생길 정도면 절대 늘리지 마라.

# 출력 형식
오직 JSON 한 덩어리.  마크다운 코드펜스 금지.
{
  "total_use_seconds": number,   # 너가 만든 모든 씬 use_seconds 의 합 (자체 검산)
  "scenes": [ {... 위 shape ...}, ... ]
}

scenes 의 항목 수 = 자율 결정 (events × 1~6 사이). events 순서 보존.
"""


# v21.4-hotfix — retry 부록 (사용 안 함, 보존만). 사용자 정책 변경: 음악×2 강제 폐기.
_SCENE_SPLIT_RETRY_EMPHASIS_V214 = """
[참고] 시나리오를 더 자연스럽게 뽑을 여지가 있어 보인다. 품질을 깨지 않는 한도에서만
씬 분할을 조금 더 풍부하게 가져가도 좋다. 억지로 늘릴 필요는 없다.
"""


# v21.5 — LLM 라벨 의존 제거. event_index 만 받고 코드가 story_slot/refs 박는다.
SCENE_SPLIT_SYSTEM_PROMPT_V215 = """역할: 결혼식 식전영상의 씬 디렉터 + 시나리오 → 씬 분할가.

입력으로 받는 자료:
1) scenario_text — 한국어 서술 시나리오 본문
2) scenario_events — 시점별 키 사건 리스트 (index 0~N-1, story_slot, memory_index, summary, refs[])
3) music_duration_sec — 곡 전체 길이(초). **참고용** — 강제 목표 아님.

해야 하는 일:
**scenario_events 마다 너 스스로 씬 개수를 결정하라.** event 의 summary / refs 내용이
풍부하면 더 잘게 쪼개고(권장 4~6 씬), 빈약하면 적게(권장 1~3 씬). 입력 events 의 순서를
그대로 보존해서 events[0] 의 씬들이 먼저, 그 다음 events[1] 의 씬들이 나오게 한다.
한 event 안의 씬들은 그 event 의 summary 를 다양한 각도/순간으로 분할한 컷들이다.
음악과 정확한 시간 동기화는 안 한다 — 사용자가 편집기에서 클립 길이를 손편집한다.

핵심 정책: **시나리오 내용을 자연스럽게 최대로 뽑아라.** 같은 장면 반복, 억지 변주,
강제 늘림 같은 품질 저하가 생길 정도면 거기서 멈춰라. music_duration_sec 은 참고용일 뿐:
- 시나리오가 풍부해 자연스럽게 그 길이 이상 나오면 좋다 (사용자 편집 여유분).
- 시나리오 한계로 짧아지면 그대로 OK — 품질 떨어지는 것보다 자연스러운 게 우선.
음악 길이 도달 자체가 목적이 아니다. 자연스러운 한도까지만 뽑아라.

# 출력 씬 shape (한 씬당) — v21.5 결정론 필드 제거
{
  "event_index": int,       # 0 ~ events_count-1. 이 씬이 어느 event 의 컷인지.
  "description": str,       # 영문 (10~15단어, 절대 25단어 넘기지 마라)
  "description_ko": str,    # 한국어 (30~50자, 절대 70자 넘기지 마라)
  "image_prompt": str,      # 영문 (30~50단어, 절대 70단어 넘기지 마라)
  "image_prompt_ko": str,   # 한국어 (40~70자, 절대 90자 넘기지 마라)
  "video_prompt": str,      # 영문 (30~50단어, 절대 70단어 넘기지 마라)
  "video_prompt_ko": str,   # 한국어 (40~70자, 절대 90자 넘기지 마라)
  "use_seconds": number     # 이 씬의 영상 길이 (초). 5.0 ~ 15.0 사이 정수 또는 소수.
                            # description 의 호흡을 충분히 보여줄 길이를 골라라.
}

# 절대 규칙
1. 모든 씬은 결혼식 식전영상용 드라마 씬. 립싱크 / 노래 부르는 장면 / 카메라 정면 응시 클로즈업 금지.
2. @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름) 은
   image_prompt / video_prompt 본문에 그대로 보존하라(번역·치환 금지).
3. image_prompt — 인물 2명(신랑+신부)이 등장한다면 reference 시트와 일치해야 함을 명시.
   장소·소품·계절·시간대를 scenario_text/event.summary 에서 추출해 박아라.
4. video_prompt — 카메라 워크(dolly/handheld/wide/close-up 등), 미세 동작, 감정 톤만 묘사.
5. **story_slot, memory_index, ref_sheet_ids, ref_place_ids, section 은 절대 응답에 박지 마라.
   event_index 만 박아라. 시스템이 events[event_index] 를 보고 자동으로 채운다.**
   refs 풀 / asset_id 가 어떤지 신경 쓸 필요 없다 — events.refs 에서 코드가 추출한다.
6. **모든 event 에 최소 1 씬은 분배해라** (event_index 0 ~ events_count-1 모두 한 번 이상 등장).
7. **event_index 는 단조 증가**. events[0] 씬들이 먼저, events[1] 씬들이 다음... 순서로 박아라.
   같은 event 안의 씬들은 같은 event_index 를 공유한다.
8. 결혼식 본행사 어휘 금지: ceremony, altar, vows being read, officiant 등.
9. 글래머 표현 금지: provocative / sensual / lingerie 등.
10. 같은 event 안의 인접 씬은 시각적 연속성을 가져야 한다 (이 룰을 따르면 비디오 prompt 앞에
    "Continuing seamlessly from the previous scene," 가 자동으로 prepend 된다 — 너는 그냥 의상·장소를
    일관되게 묘사하면 된다). 같은 story_slot 의 인접 event 끼리도 마찬가지.
11. **씬 개수 결정 가이드라인** — 각 event 의 summary / refs 내용 풍부도에 맞춰 1~6 씬 자율 결정.
    · 한 줄 요약 / 단순 한 장면: **1 ~ 2 씬**
    · 보통 흐름 (시작·전개·여운 등): **3 ~ 4 씬**
    · 풍부한 멀티 액션 / 시간 흐름 / 여러 ref 등장: **5 ~ 6 씬**
    같은 event 의 씬들끼리 너무 비슷한 컷이 되지 않게 각도·순간·동선을 분산하라.
12. **use_seconds 길이 결정 가이드라인** — 각 씬의 description / video_prompt 내용 호흡에 맞춰
    다음 범위에서 골라라:
    · 짧은 정적 컷 / 미세 표정 / 한 호흡: **5 ~ 7초**
    · 보통 동작 / 한 흐름 (걷기·웃음·시선 교환 등): **8 ~ 11초**
    · 복잡한 액션 / 시간 전환 / 다중 동작 (춤·돌발 사건·여러 움직임 합성): **12 ~ 15초**
    범위는 5.0 ~ 15.0. 정수 또는 소수 모두 가능 (예: 6, 9.5, 13).
    같은 event 안의 씬들이 다 같은 호흡일 필요 없다 — 짧은 컷 + 긴 컷 섞어라.
13. **총합 정책** — 시나리오 내용을 자연스럽게 최대로 뽑아라. music_duration_sec 은 참고용.
    내용이 풍부해 자연스럽게 늘어나면 좋고, 시나리오 한계로 짧아지면 그대로 OK.
    품질 저하 (같은 장면 반복, 억지 변주, 의미 없는 씬 추가) 생길 정도면 절대 늘리지 마라.

14. **v25 — 영상 출력 모더레이션 안전 어휘 (CRITICAL — 위반 시 영상 모델이 422 거부)**
    하위 영상 모델 (Seedance / Kling / Grok — 셋 다) 은 GENERATED frame / audio 를 자동
    스캔해 위반 시 hard rejection 한다. image_prompt / video_prompt / description 어느
    슬롯에도 아래 트리거 표현을 절대 박지 마라:
      "alone faces camera directly", "alone faces camera", "alone facing camera",
      "mouth open", "singing with mouth open", "singing the chorus joyfully",
      "sparkling eyes", "expressive eyes", "bright expressive eyes",
      "bright smile", "joyful expression", "joyful gesture",
      "hair lifted by a gentle breeze", "hair lifting in the wind", "hair lifting",
      "slight head sway", "rhythmic shoulder movement", "shoulder sway",
      "hands lightly raised in a joyful gesture",
      "eyes closed, breathing in the scent",
      "drowning in a soft pink-petal storm",
      "K-pop MV grade", "K-pop MV".
    안전 대체 표현 권장: "framed in a medium close-up", "softly mouthing the lyrics",
    "soft warm expression", "subtle smile", "natural pose",
    "soft breeze drifts in the air", "hands resting naturally",
    "surrounded by gently drifting petals", "with a gentle expression",
    "cinematic pastel grade".
    인물 외모 강조 (매력/매혹/유혹/광고 모델 컷) 어휘 금지. 카메라 동작과 인물 동작은
    별도 문장으로 분리. 영화 한 장면처럼 묘사 (조명·의상·배경 등 충분한 시각 context 제공).

# 출력 형식
오직 JSON 한 덩어리.  마크다운 코드펜스 금지.
{
  "total_use_seconds": number,   # 너가 만든 모든 씬 use_seconds 의 합 (자체 검산)
  "scenes": [ {... 위 shape ...}, ... ]
}

scenes 의 항목 수 = 자율 결정 (events × 1~6 사이). event_index 단조 증가.
"""


# DEPRECATED (v21.2) — 마커/quota 기반 프롬프트. 호출처 없음 (보존 only).
SCENE_SPLIT_SYSTEM_PROMPT = """역할: 결혼식 식전영상의 씬 디렉터 + 시나리오 → 씬 분할가.

입력으로 받는 자료:
1) scenario_text — 한국어 서술 시나리오 본문
2) scenario_events — 시점별 키 사건 리스트 (order, story_slot, memory_index, summary, refs[])
3) section_markers — 음악 섹션 [{label, start, end}, ...] (Intro/Verse/Chorus/Bridge/Outro)
4) scene_quota — 섹션별 만들어야 할 씬 개수 [{label, count}, ...]

해야 하는 일:
scenario_events 들을 각 음악 섹션에 시간 순서대로 분배하고,
각 섹션 안에서 scene_quota 만큼의 씬을 만든다.

# 출력 씬 shape (한 씬당)
{
  "section": str,           # section_markers 의 label 그대로
  "story_slot": "meeting"|"first_date"|"memory"|"proposal"|"wedding_prep"|"rituals",
  "memory_index": int|null, # story_slot=="memory" 일 때만
  "description": str,       # 영문 한 줄 캡션 (20단어 이내)
  "description_ko": str,    # 위의 한국어 자연 번역
  "image_prompt": str,      # 영문 한 단락 (40~80단어)
  "image_prompt_ko": str,
  "video_prompt": str,      # 영문 한 단락 (40~80단어)
  "video_prompt_ko": str,
  "ref_sheet_ids": [str],   # 이 씬에서 등장하는 캐릭터 시트 asset_id 들
  "ref_place_ids": [str]    # 이 씬에서 등장하는 place/wedding_photo asset_id 들
}

# 절대 규칙
1. 모든 씬은 결혼식 식전영상용 드라마 씬. 립싱크 / 노래 부르는 장면 / 카메라 정면 응시 클로즈업 금지.
2. @멘션 토큰(@groom_casual @bride_casual @groom_wedding @bride_wedding @장소이름 @웨딩사진이름) 은
   image_prompt / video_prompt 본문에 그대로 보존하라(번역·치환 금지).
3. image_prompt — 인물 2명(신랑+신부)이 등장한다면 reference 시트와 일치해야 함을 명시.
   장소·소품·계절·시간대를 scenario_text/event.summary 에서 추출해 박아라.
4. video_prompt — 카메라 워크(dolly/handheld/wide/close-up 등), 미세 동작, 감정 톤만 묘사.
5. ref_sheet_ids / ref_place_ids — 그 씬 텍스트에 등장한 @멘션이 가리키는 asset_id 들만 채워라.
   입력 events 의 refs 풀에 없는 id 를 만들지 마라.
6. 결혼식 본행사 어휘 금지: ceremony, altar, vows being read, officiant 등.
7. 글래머 표현 금지: provocative / sensual / lingerie 등.
8. 시간 역행 금지 — section_markers 시간 순서 ≒ events story_slot 시간 순서.
9. 같은 story_slot 의 인접 씬은 시각적 연속성을 가져야 한다 (이 룰을 따르면 비디오 prompt 앞에
   "Continuing seamlessly from the previous scene," 가 자동으로 prepend 된다 — 너는 그냥 의상·장소를
   일관되게 묘사하면 된다).

# 출력 형식
오직 JSON 한 덩어리.  마크다운 코드펜스 금지.
{
  "scenes": [ {... 위 shape ...}, ... ]
}

scenes 의 항목 수 = sum(scene_quota[].count).
"""


def _build_user_message_v212(
    *,
    scenario_text: str,
    scenario_events: list[dict],
    music_duration_sec: float,
) -> str:
    """v21.4 — LLM 자율 결정 (씬 개수 + 길이) + music_duration_sec 입력.

    section_markers / scene_quota / music_spec / clips_per_event 입력 모두 없음.
    """
    events_block_lines = ["[scenario_events]"]
    for i, ev in enumerate(scenario_events):
        ref_chips = []
        for r in (ev.get("refs") or []):
            if isinstance(r, dict):
                ref_chips.append(
                    f"@{r.get('display_name','?')}({r.get('type','?')}:{r.get('asset_id','?')})"
                )
        refs_repr = ", ".join(ref_chips) if ref_chips else "(없음)"
        mem = ev.get("memory_index")
        mem_str = f" memory_index={mem}" if mem is not None else ""
        events_block_lines.append(
            f"  index={i} order={ev.get('order','?')} slot={ev.get('story_slot','?')}{mem_str}\n"
            f"    summary: {(ev.get('summary') or '').strip()}\n"
            f"    refs: {refs_repr}"
        )

    # v21.5 — events_count + event_index 안내. 결정론 필드 (story_slot/refs) 응답 금지.
    last_event_index = max(0, len(scenario_events) - 1)
    return (
        f"music_duration_sec = {music_duration_sec:.2f} (참고용)\n"
        f"events_count = {len(scenario_events)} (event_index 범위: 0 ~ {last_event_index})\n\n"
        f"[scenario_text]\n{scenario_text}\n\n"
        + "\n".join(events_block_lines) + "\n\n"
        + "[요구]\nJSON 한 객체만 출력. event 마다 1~6 씬으로 자율 분할, 씬 길이 5~15초 자율. "
        f"각 씬에 event_index (정수 0~{last_event_index}) 를 박아라. "
        f"모든 event (index 0~{last_event_index}) 가 최소 1 씬에 한 번 이상 등장. "
        "event_index 단조 증가 (같은 event_index 씬들끼리 연속 묶음). "
        "story_slot / memory_index / ref_sheet_ids / ref_place_ids / section 같은 결정론 필드는 응답에 박지 마라 — 시스템이 채운다. "
        "시나리오 내용을 자연스럽게 최대로 뽑되, 품질 저하 (같은 장면 반복·억지 변주) 생기면 거기서 멈춰라. "
        "응답에 total_use_seconds 필드 포함. 마크다운/서두 금지."
    )


# DEPRECATED (v21.2) — section/quota 기반 메시지. 호출처 없음.
def _build_user_message(
    *,
    scenario_text: str,
    scenario_events: list[dict],
    section_markers: list[dict],
    scene_quota: list[dict],
    music_spec: dict,
) -> str:
    genre = (music_spec or {}).get("genre") or "—"
    moods = (music_spec or {}).get("moods") or []
    tone_block = (
        f"장르: {genre}\n"
        f"분위기: {', '.join([str(m) for m in moods]) or '—'}\n"
    )

    events_block_lines = ["[scenario_events]"]
    for ev in scenario_events:
        ref_chips = []
        for r in (ev.get("refs") or []):
            if isinstance(r, dict):
                ref_chips.append(
                    f"@{r.get('display_name','?')}({r.get('type','?')}:{r.get('asset_id','?')})"
                )
        refs_repr = ", ".join(ref_chips) if ref_chips else "(없음)"
        mem = ev.get("memory_index")
        mem_str = f" memory_index={mem}" if mem is not None else ""
        events_block_lines.append(
            f"  order={ev.get('order','?')} slot={ev.get('story_slot','?')}{mem_str}\n"
            f"    summary: {(ev.get('summary') or '').strip()}\n"
            f"    refs: {refs_repr}"
        )

    sections_block_lines = ["[section_markers]"]
    for m in section_markers:
        sections_block_lines.append(
            f"  label={m.get('label','?')} start={m.get('start')} end={m.get('end')}"
        )

    quota_block_lines = ["[scene_quota]"]
    total_scenes = 0
    for q in scene_quota:
        total_scenes += int(q.get("count") or 0)
        quota_block_lines.append(f"  label={q.get('label','?')} count={q.get('count','?')}")

    return (
        f"{tone_block}\n"
        f"총 씬 목표 수: {total_scenes}\n\n"
        f"[scenario_text]\n{scenario_text}\n\n"
        + "\n".join(events_block_lines) + "\n\n"
        + "\n".join(sections_block_lines) + "\n\n"
        + "\n".join(quota_block_lines) + "\n\n"
        + "[요구]\nJSON 한 객체만 출력. scenes 항목 수 = 총 씬 목표 수. 마크다운/서두 금지."
    )


def _resolve_prompt_model() -> tuple[str, str]:
    """Phase 1 prompt 합성 모델 — Claude 4.7 Opus 우선, 없으면 OpenAI."""
    if settings.anthropic_api_key:
        return ("claude", settings.wedding_lyrics_default_model or "claude-opus-4-7")
    if settings.openai_api_key:
        return ("openai", settings.openai_model_advanced or "gpt-5.4")
    raise RuntimeError("Phase 1 prompt 합성용 LLM 키가 모두 비어있습니다.")


def _max_tokens_for_scene_split(scene_count: int) -> int:
    # v21.3-hotfix — Claude 가 18 씬 × 7 텍스트 필드 출력 시 12600 한도에서 잘림 (stop_reason=max_tokens).
    # per_scene 1500 + cap 32000 으로 확장. Claude opus 4.7 출력 한계 안.
    # 한국어 image_prompt_ko + video_prompt_ko 가 토큰 비용 큼.
    # Anthropic SDK 가 비-스트리밍에서 ~16000 이상 거부 ("streaming required"). 안전선 12000.
    base = 6000
    per_scene = 600
    cap = 12000
    return min(cap, max(base, scene_count * per_scene))


async def _call_claude(
    model_id: str,
    user_message: str,
    max_tokens: int,
    *,
    system_prompt: str = SCENE_SPLIT_SYSTEM_PROMPT,
) -> str:
    from .llm_thinking_config import apply_thinking_to_anthropic
    client = _get_anthropic_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": max_tokens,
        "temperature": 0.5,
    }
    # v27 — adaptive thinking + strip unsupported sampling (Opus 4.7+).
    apply_thinking_to_anthropic(kwargs, model_id)
    logger.info(
        "[PreMVSplit] llm claude model=%s max_tokens=%d thinking=%s",
        model_id, max_tokens, bool(kwargs.get("thinking")),
    )
    resp = await client.messages.create(**kwargs)
    text = _xtxt(resp)
    # v21.3 — Claude stop_reason / usage 추적 (truncation 디버깅용).
    try:
        stop_reason = getattr(resp, "stop_reason", None)
        usage = getattr(resp, "usage", None)
        in_tok = getattr(usage, "input_tokens", None) if usage else None
        out_tok = getattr(usage, "output_tokens", None) if usage else None
        logger.info(
            "[PreMVSplit] claude resp model=%s stop_reason=%s "
            "input_tokens=%s output_tokens=%s text_len=%d",
            model_id, stop_reason, in_tok, out_tok, len(text),
        )
    except Exception:  # pragma: no cover
        pass
    return text


async def _call_openai(
    model_id: str,
    user_message: str,
    max_tokens: int,
    *,
    system_prompt: str = SCENE_SPLIT_SYSTEM_PROMPT,
) -> str:
    from .llm_thinking_config import apply_reasoning_to_openai
    client = _get_openai_client()
    kwargs: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    # v27 — reasoning_effort + strip unsupported sampling (GPT-5+).
    apply_reasoning_to_openai(kwargs, model_id)
    logger.info(
        "[PreMVSplit] llm openai model=%s max_completion_tokens=%d reasoning=%s",
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


# v21.4 — LLM scene 의 use_seconds 안전 clamp 범위. 5.0~15.0 (v21.3 의 3.0→5.0 상향).
_USE_SECONDS_MIN_V213 = 5.0
_USE_SECONDS_MAX_V213 = 15.0


def _coerce_use_seconds_v213(
    raw_value: Any,
    default_value: float,
) -> tuple[float, bool]:
    """LLM 응답의 use_seconds 를 float [3.0, 15.0] 으로 정규화.

    Returns:
        (resolved_seconds, used_default)
          - 정상 float 변환 + 범위 안 → (clamped, False)
          - 범위 밖 → (clamp(min/max), False)
          - None / 변환 실패 / NaN → (default_value, True)
    """
    if raw_value is None:
        return float(default_value), True
    # 문자열 "8s", "8.5", "8 sec" 등 들어올 가능성 — 숫자만 추출.
    candidate: Optional[float] = None
    if isinstance(raw_value, bool):
        # bool 은 int 의 서브클래스 → 사고 방지.
        return float(default_value), True
    if isinstance(raw_value, (int, float)):
        candidate = float(raw_value)
    elif isinstance(raw_value, str):
        m = re.search(r"-?\d+(?:\.\d+)?", raw_value)
        if m:
            try:
                candidate = float(m.group(0))
            except ValueError:
                candidate = None
    if candidate is None:
        return float(default_value), True
    # NaN / Inf 체크.
    if candidate != candidate or candidate in (float("inf"), float("-inf")):
        return float(default_value), True
    # 범위 안전 clamp — 가이드라인 어긴 LLM 보호.
    clamped = max(_USE_SECONDS_MIN_V213, min(_USE_SECONDS_MAX_V213, candidate))
    # 소수점 2자리로 정리 (응답 페이로드 일관성).
    return round(clamped, 2), False


# ──────────────────────────────────────────────────────────────────────────
# Fallback prompts (LLM 실패 시 결정론적 채우기)
# ──────────────────────────────────────────────────────────────────────────

_SLOT_LABEL_EN = {
    "meeting": "their first meeting",
    "first_date": "their first date",
    "memory": "a shared memory",
    "proposal": "the proposal moment",
    "wedding_prep": "wedding preparation",
    "rituals": "their own private place and word",
}
_SLOT_LABEL_KO = {
    "meeting": "첫 만남",
    "first_date": "첫 데이트",
    "memory": "함께 쌓인 추억",
    "proposal": "결혼을 결심한 순간",
    "wedding_prep": "웨딩 준비",
    "rituals": "둘만의 단어·장소",
}


def _fallback_prompts_from_event(event: dict, section_label: str) -> dict:
    slot = event.get("story_slot") or "memory"
    label_en = _SLOT_LABEL_EN.get(slot, "a shared moment")
    label_ko = _SLOT_LABEL_KO.get(slot, "함께한 한순간")
    summary = (event.get("summary") or "").strip()
    refs = event.get("refs") or []
    chips = " ".join(["@" + (r.get("display_name") or "") for r in refs if isinstance(r, dict)]).strip()

    image_prompt = (
        f"A cinematic wedding pre-ceremony still depicting {label_en}. "
        f"Both the bride and the groom must match their reference sheets. "
        f"Context: {summary}. {chips}"
    ).strip()
    image_prompt_ko = (
        f"{label_ko} 장면의 결혼식 식전영상 한 컷. 신랑과 신부 모두 reference 시트와 일치해야 한다. "
        f"맥락: {summary}. {chips}"
    ).strip()
    video_prompt = (
        f"A gentle handheld camera move on the couple, soft natural light, intimate atmosphere. "
        f"No singing, no facing the camera. Subtle micro-expressions reflecting {label_en}."
    ).strip()
    video_prompt_ko = (
        f"커플 위로 부드러운 핸드헬드 카메라 워크, 자연광, 사적인 분위기. "
        f"립싱크나 정면 응시 금지. {label_ko} 의 감정이 미세하게 드러나는 표정."
    ).strip()
    description = f"{label_en} — {summary[:80]}"[:200]
    description_ko = f"{label_ko} — {summary[:80]}"[:200]

    return {
        "section": section_label,
        "story_slot": slot,
        "memory_index": event.get("memory_index"),
        "description": description,
        "description_ko": description_ko,
        "image_prompt": image_prompt,
        "image_prompt_ko": image_prompt_ko,
        "video_prompt": video_prompt,
        "video_prompt_ko": video_prompt_ko,
        "ref_sheet_ids": [r.get("asset_id") for r in refs if isinstance(r, dict) and r.get("type") == "sheet"],
        "ref_place_ids": [r.get("asset_id") for r in refs if isinstance(r, dict) and r.get("type") in ("place", "wedding_photo")],
    }


# ──────────────────────────────────────────────────────────────────────────
# Continuity prefix
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
# Scene quota 결정
# ──────────────────────────────────────────────────────────────────────────

def _build_scene_quota(
    section_markers: list[dict],
    *,
    video_clip_max: float,
    total_min: int = _MIN_TOTAL_SCENES,
    total_max: int = _MAX_TOTAL_SCENES,
) -> list[dict]:
    """DEPRECATED (v21.2) — scene_quota 폐기. clips_per_event 균등 분배 사용.

    섹션별 씬 개수 결정 + 전체 8~30 clamp."""
    quota = []
    for m in section_markers:
        n = _decide_scene_count_per_section(m, video_clip_max=video_clip_max)
        quota.append({"label": m["label"], "count": n})

    total = sum(q["count"] for q in quota)

    # 전체 너무 적으면 마지막 섹션부터 +1
    while total < total_min and quota:
        bumped = False
        for q in quota:
            if q["count"] < _MAX_SCENES_PER_SECTION:
                q["count"] += 1
                total += 1
                bumped = True
                if total >= total_min:
                    break
        if not bumped:
            break

    # 전체 너무 많으면 가장 큰 섹션부터 -1
    while total > total_max and quota:
        biggest = max(quota, key=lambda q: q["count"])
        if biggest["count"] <= _MIN_SCENES_PER_SECTION:
            break
        biggest["count"] -= 1
        total -= 1

    return quota


# ──────────────────────────────────────────────────────────────────────────
# Use seconds 보정
# ──────────────────────────────────────────────────────────────────────────

def _compute_initial_use_seconds(
    section_markers_by_label: dict[str, dict],
    section: str,
    scene_count_in_section: int,
) -> float:
    """DEPRECATED (v21.2) — 모든 씬 use_seconds=8.0 균등 분배 정책으로 폐기."""
    m = section_markers_by_label.get(section)
    if not m:
        return 5.0
    dur = float(m.get("end") or 0.0) - float(m.get("start") or 0.0)
    if dur <= 0 or scene_count_in_section <= 0:
        return 5.0
    return round(dur / scene_count_in_section, 2)


def _adjust_use_seconds_to_audio(
    scenes: list[dict], audio_duration: float
) -> None:
    """DEPRECATED (v21.2) — 음악 길이 보정 폐기.

    씬 use_seconds 합이 audio_duration 과 안 맞으면 마지막 씬 보정 (in-place)."""
    if not scenes or audio_duration <= 0:
        return
    total = sum(float(s.get("use_seconds") or 0.0) for s in scenes)
    diff = audio_duration - total
    if abs(diff) < 0.5:
        return
    last = scenes[-1]
    new_val = float(last.get("use_seconds") or 0.0) + diff
    if new_val < 1.5:
        new_val = 1.5
    last["use_seconds"] = round(new_val, 2)


# ──────────────────────────────────────────────────────────────────────────
# Public entry (v21)
# ──────────────────────────────────────────────────────────────────────────

async def split_into_scenes_v21(*args, **kwargs):  # pragma: no cover
    """DEPRECATED (v21.2) — 음악 sync 의존을 폐기하면서 v21.1 진입점도 폐기.

    호출 시 RuntimeError. 새 진입점: `split_into_scenes_v212`.
    """
    raise RuntimeError(
        "split_into_scenes_v21 는 v21.2 에서 폐기되었습니다. "
        "대신 split_into_scenes_v212(pre_mv_job_id, scenario_text, scenario_events, "
        "clips_per_event) 을 호출하세요."
    )


# DEPRECATED (v21.2) — 보존만. 호출처 없음.
async def _split_into_scenes_v21_legacy(
    *,
    pre_mv_job_id: str,
    scenario_text: str,
    scenario_events: list[dict],
    lyric_timestamps: list[dict],
    music_spec: dict,
    lyrics_body: str = "",
    aligned_words: list[dict] | None = None,
    video_clip_max: float = _VIDEO_CLIP_MAX_DEFAULT,
) -> dict:
    """Phase 1 v21 진입점. scenario → section_markers + scenes[].

    v21.1 — lyrics_body + aligned_words 로부터 마커 검증 후 진행.
    검증 실패 시 ValueError (한국어 메시지) raise.

    Returns:
        {"section_markers": [...], "scenes": [...]}.
    """
    if not scenario_text or not scenario_text.strip():
        raise ValueError("scenario_text 가 비어있습니다.")
    if not scenario_events:
        raise ValueError("scenario_events 가 비어있습니다.")

    started = time.time()
    aligned_words = aligned_words or []

    # 1) audio_duration 추정 + v21.1 단어 단위 마커 검증.
    audio_duration = _infer_audio_duration(music_spec, lyric_timestamps)

    expected_markers = _extract_expected_markers(lyrics_body or "")
    extracted_markers = _extract_section_markers_v2(
        aligned_words, audio_duration=audio_duration
    )
    ok, err_msg = _validate_marker_match(expected_markers, extracted_markers)
    logger.info(
        "[PreMVSplit] phase1_marker_check pre_mv_job_id=%s expected=%d extracted=%d match=%s",
        pre_mv_job_id,
        len(expected_markers),
        len(extracted_markers),
        ok,
    )
    if not ok:
        logger.warning(
            "[PreMVSplit] marker_mismatch pre_mv_job_id=%s expected_labels=%s extracted_labels=%s",
            pre_mv_job_id,
            expected_markers,
            [m.get("label") for m in extracted_markers],
        )
        raise ValueError(err_msg)
    section_markers = extracted_markers

    # 2) scene_quota
    scene_quota = _build_scene_quota(section_markers, video_clip_max=video_clip_max)
    total_target = sum(q["count"] for q in scene_quota)

    logger.info(
        "[PreMVSplit] entry pre_mv_job_id=%s phase=phase1 audio_duration=%.2f "
        "section_count=%d scene_target=%d events_in=%d",
        pre_mv_job_id, audio_duration, len(section_markers), total_target,
        len(scenario_events),
    )

    # 3) LLM 호출 — 실패 시 fallback
    llm_scenes: list[dict] = []
    used_model: str = "fallback"
    try:
        provider, model_id = _resolve_prompt_model()
        used_model = model_id
        user_message = _build_user_message(
            scenario_text=scenario_text,
            scenario_events=scenario_events,
            section_markers=section_markers,
            scene_quota=scene_quota,
            music_spec=music_spec,
        )
        max_tokens = _max_tokens_for_scene_split(total_target)

        logger.info(
            "[PreMVSplit] llm entry pre_mv_job_id=%s phase=phase1 model=%s provider=%s "
            "max_tokens=%d user_msg_len=%d",
            pre_mv_job_id, model_id, provider, max_tokens, len(user_message),
        )

        if provider == "claude":
            raw = await _call_claude(model_id, user_message, max_tokens)
        else:
            raw = await _call_openai(model_id, user_message, max_tokens)

        llm_scenes = _parse_scenes_response(raw)
        if not isinstance(llm_scenes, list) or not llm_scenes:
            raise ValueError("LLM 이 빈 scenes 를 반환했습니다.")
    except Exception as e:
        logger.warning(
            "[PreMVSplit] llm failed pre_mv_job_id=%s phase=phase1 err=%s: %s — falling back",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        llm_scenes = []

    # 4) Fallback — events 를 quota 에 라운드로빈 배분 (LLM 결과가 비거나 부족할 때 보강)
    if not llm_scenes:
        fallback_scenes = _build_fallback_scenes(
            scenario_events=scenario_events,
            section_markers=section_markers,
            scene_quota=scene_quota,
        )
        llm_scenes = fallback_scenes

    # 5) 출력 정규화 + ref id 분리 + use_seconds 계산 + 연속 컷
    section_by_label = {m["label"]: m for m in section_markers}

    # 섹션별 씬 개수 (LLM 출력 기준) — use_seconds 계산용
    section_scene_count: dict[str, int] = {}
    for sc in llm_scenes:
        sec = (sc.get("section") or "").strip()
        if sec not in section_by_label:
            # 매칭 안 되면 가장 가까운 마커 — 일단 첫 마커.
            sec = section_markers[0]["label"]
        section_scene_count[sec] = section_scene_count.get(sec, 0) + 1

    final_scenes: list[dict] = []
    prev_slot: Optional[str] = None
    section_used_count: dict[str, int] = {}

    for i, sc in enumerate(llm_scenes):
        if not isinstance(sc, dict):
            continue
        sec_label = (sc.get("section") or "").strip()
        if sec_label not in section_by_label:
            sec_label = section_markers[0]["label"]
        m = section_by_label[sec_label]
        # 한 섹션의 use_seconds 균등 분할 (마지막 씬에서 audio_duration 보정)
        scenes_in_section = section_scene_count.get(sec_label, 1)
        use_sec = _compute_initial_use_seconds(section_by_label, sec_label, scenes_in_section)
        section_used_count[sec_label] = section_used_count.get(sec_label, 0) + 1

        slot = sc.get("story_slot")
        if slot not in _SLOT_ORDER:
            slot = "memory"
        mem_idx = sc.get("memory_index")
        if slot != "memory":
            mem_idx = None
        else:
            try:
                mem_idx = int(mem_idx) if mem_idx is not None else 0
            except (TypeError, ValueError):
                mem_idx = 0

        # ref id — LLM 이 직접 채웠으면 그대로, 아니면 events 의 refs 에서 채취
        ref_sheet_ids = _coerce_str_list(sc.get("ref_sheet_ids"))
        ref_place_ids = _coerce_str_list(sc.get("ref_place_ids"))
        if not ref_sheet_ids and not ref_place_ids:
            ref_sheet_ids, ref_place_ids = _collect_refs_from_events_for_slot(
                scenario_events, slot, mem_idx
            )

        # prompts (LLM 출력 + fallback merge)
        # LLM 실패시 사용된 fallback 또는 부분 누락 보강
        fallback_payload = _fallback_prompts_from_event(
            _pick_event_for_slot(scenario_events, slot, mem_idx) or {"story_slot": slot, "memory_index": mem_idx},
            sec_label,
        )
        merged = dict(fallback_payload)
        for k in (
            "description", "description_ko",
            "image_prompt", "image_prompt_ko",
            "video_prompt", "video_prompt_ko",
        ):
            v = sc.get(k)
            if isinstance(v, str) and v.strip():
                merged[k] = v.strip()

        prompts = _maybe_prepend_continuity(merged, prev_slot, slot)

        final_scenes.append({
            "scene_number": len(final_scenes) + 1,
            "description": prompts["description"],
            "description_ko": prompts["description_ko"],
            "image_prompt": prompts["image_prompt"],
            "image_prompt_ko": prompts["image_prompt_ko"],
            "video_prompt": prompts["video_prompt"],
            "video_prompt_ko": prompts["video_prompt_ko"],
            "section": sec_label,
            "section_start": float(m.get("start") or 0.0),
            "section_end": float(m.get("end") or 0.0),
            "use_seconds": use_sec,
            "story_slot": slot,
            "memory_index": mem_idx,
            "ref_sheet_ids": ref_sheet_ids,
            "ref_place_ids": ref_place_ids,
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

    # 6) 음악 길이 보정
    _adjust_use_seconds_to_audio(final_scenes, audio_duration)

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[PreMVSplit] ok pre_mv_job_id=%s phase=phase1 model=%s section_count=%d scene_count=%d "
        "elapsed_ms=%d",
        pre_mv_job_id, used_model, len(section_markers), len(final_scenes), elapsed_ms,
    )
    return {
        "section_markers": section_markers,
        "scenes": final_scenes,
    }


# ──────────────────────────────────────────────────────────────────────────
# Helpers — events lookup / refs collection
# ──────────────────────────────────────────────────────────────────────────

def _coerce_str_list(v: Any) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for x in v:
        if x is None:
            continue
        s = str(x).strip()
        if s:
            out.append(s)
    return out


def _pick_event_for_slot(
    events: list[dict], slot: str, memory_index: int | None
) -> Optional[dict]:
    """slot + memory_index 에 가장 잘 맞는 이벤트 1개 픽."""
    if not events or not slot:
        return None
    # memory 는 memory_index 일치 우선
    if slot == "memory":
        for e in events:
            if e.get("story_slot") == "memory" and e.get("memory_index") == memory_index:
                return e
    # 같은 slot 첫 항목
    for e in events:
        if e.get("story_slot") == slot:
            return e
    return None


def _collect_refs_from_events_for_slot(
    events: list[dict], slot: str, memory_index: int | None
) -> tuple[list[str], list[str]]:
    """slot 의 모든 이벤트 refs 를 합쳐 sheet / place(or wedding_photo) 로 분리."""
    sheet_ids: list[str] = []
    place_ids: list[str] = []
    for e in events:
        if e.get("story_slot") != slot:
            continue
        if slot == "memory" and e.get("memory_index") != memory_index:
            continue
        for r in (e.get("refs") or []):
            if not isinstance(r, dict):
                continue
            aid = r.get("asset_id")
            t = r.get("type")
            if not aid:
                continue
            if t == "sheet":
                if aid not in sheet_ids:
                    sheet_ids.append(str(aid))
            elif t in ("place", "wedding_photo"):
                if aid not in place_ids:
                    place_ids.append(str(aid))
    return sheet_ids, place_ids


# ──────────────────────────────────────────────────────────────────────────
# Deterministic fallback scene builder
# ──────────────────────────────────────────────────────────────────────────

def _build_fallback_scenes(
    *,
    scenario_events: list[dict],
    section_markers: list[dict],
    scene_quota: list[dict],
) -> list[dict]:
    """DEPRECATED (v21.2) — `_build_fallback_scenes_v212` 사용.

    LLM 실패 시 — events 를 quota 에 시간 순서로 라운드로빈 배분."""
    if not scenario_events or not section_markers:
        return []

    # events 를 시간 순서로 평탄화 (이미 phase0 에서 정렬되어 들어옴)
    events_flat = list(scenario_events)
    section_label_order = [s["label"] for s in section_markers]
    quota_by_label = {q["label"]: q["count"] for q in scene_quota}

    total_target = sum(quota_by_label.values())

    # events 와 section quota 의 매핑 — 단순 strategy:
    # 1) section_label_order 를 순회하며 quota 만큼 씬을 채운다.
    # 2) events 는 시간 순서로 순환 picker.
    out: list[dict] = []
    event_idx = 0
    n_events = len(events_flat)
    if n_events == 0:
        return []

    for sec_label in section_label_order:
        count = quota_by_label.get(sec_label, 0)
        for _ in range(count):
            ev = events_flat[event_idx % n_events]
            scene = _fallback_prompts_from_event(ev, sec_label)
            out.append(scene)
            event_idx += 1
            if len(out) >= total_target:
                break
        if len(out) >= total_target:
            break
    return out


# ──────────────────────────────────────────────────────────────────────────
# v21.2 — Deterministic fallback (clips_per_event 균등 분배)
# ──────────────────────────────────────────────────────────────────────────

def _build_fallback_scenes_v212(
    events: list[dict],
    music_duration_sec: float,
    *,
    video_clip_default: float = _VIDEO_CLIP_DEFAULT,
) -> list[dict]:
    """v21.4-hotfix — LLM 실패 시 "자연 최대치" 정책으로 결정론 씬 분배.

    전략:
      - event 당 평균 3 씬 (한도 1~6), 평균 10s 패턴 (짧·중·긴 섞기)
      - 음악 길이 무관 — 시나리오 events 자체 풍부도만 보고 결정
      - 결과적으로 음악보다 짧을 수도 / 길 수도 있음 (사용자 정책)

    refs 분배: 각 event 의 refs 를 그 event 의 모든 씬에 동일 적용.
    description / image_prompt / video_prompt 는 `_fallback_prompts_from_event`
    의 단순 템플릿 그대로 (section 라벨 = story_slot).
    """
    if not events:
        return []
    # target_total 은 응답 호환 위해 계산만 유지 (실 분배 로직에 강제 영향 X).
    target_total = max(60.0, float(music_duration_sec or 0.0) * 2.0)
    events_count = len(events)

    # 각 event 당 씬 개수 — 음악×2 / events_count 기반, 1~6 clamp.
    # v21.4-hotfix — 음악 길이 강제 없이 자연스러운 평균 3 씬/event 로 단순 분배.
    # 강제 부족분 보정 없음.
    counts = [3] * events_count

    # 길이 패턴: 짧·중·긴 = [7, 10, 13] (평균 10).
    length_pattern = [7.0, 10.0, 13.0]

    out: list[dict] = []
    for ev_idx, ev in enumerate(events):
        slot = (ev or {}).get("story_slot") or "memory"
        cnt = counts[ev_idx]
        for k in range(cnt):
            scene = _fallback_prompts_from_event(ev, slot)
            scene["use_seconds"] = length_pattern[k % len(length_pattern)]
            # v21.5 — fallback 도 event_index 박음 (post-process 공통 경로).
            scene["event_index"] = ev_idx
            out.append(scene)
    return out


# ──────────────────────────────────────────────────────────────────────────
# v21.2 — Public entry: split_into_scenes_v212
# ──────────────────────────────────────────────────────────────────────────

async def split_into_scenes_v212(
    *,
    pre_mv_job_id: str,
    scenario_text: str,
    scenario_events: list[dict],
    music_duration_sec: float,
    video_clip_default: float = _VIDEO_CLIP_DEFAULT,
    # v21.4 — backward compat: 받아도 무시.
    clips_per_event: Optional[int] = None,
) -> dict:
    """Phase 1 v21.4 진입점 — LLM 자율 결정 (씬 개수 + 길이) + music_duration_sec 입력.

    Returns:
        {
          "section_markers": [],              # 호환 위해 빈 배열만
          "scenes": [...],                    # LLM 자율 결정. event 당 1~6 씬.
          "target_total_seconds": float,      # = music_duration_sec × 2
          "actual_total_seconds": float,      # 실제 씬 use_seconds 합
        }
        - 각 scene 의 use_seconds = LLM 결정 (5~15 clamp), 누락 시 video_clip_default.
        - section / section_start / section_end 는 호환 위해 키만 유지
          (section = event.story_slot 라벨, start/end = 0).
    """
    if not scenario_text or not scenario_text.strip():
        raise ValueError("scenario_text 가 비어있습니다.")
    if not scenario_events:
        raise ValueError("scenario_events 가 비어있습니다.")
    # backward-compat: clips_per_event 받아도 무시.
    if clips_per_event is not None:
        logger.info(
            "[PreMVSplit] entry pre_mv_job_id=%s phase=phase1 deprecated_clips_per_event=%s ignored",
            pre_mv_job_id, clips_per_event,
        )
    music_duration_sec = float(music_duration_sec or 0.0)
    if music_duration_sec <= 0:
        # safety — _run_phase1 가 항상 양수 보장하지만 직접 호출 대비.
        logger.warning(
            "[PreMVSplit] music_duration_sec=%s invalid — falling back to 180.0",
            music_duration_sec,
        )
        music_duration_sec = 180.0

    # v21.4-hotfix — 정책: "자연 최대치"
    # target_total_seconds 는 응답 페이로드 호환 위해 음악×2 로 계산 (UI 표시용 참고값).
    # retry_threshold 는 음악×0.5 미만 (LLM 이 명백히 너무 적게 뽑은 경우만 한 번 더).
    target_total_seconds = music_duration_sec * 2.0
    retry_threshold = music_duration_sec * 0.5

    started = time.time()
    events_count = len(scenario_events)

    logger.info(
        "[PreMVSplit] entry pre_mv_job_id=%s phase=phase1 music_duration_sec=%.2f "
        "target_total_seconds=%.2f events_count=%d",
        pre_mv_job_id, music_duration_sec, target_total_seconds, events_count,
    )

    # 1) LLM 호출 — 실패 시 결정론 fallback. 응답 총합 부족 시 1회 retry.
    llm_scenes: list[dict] = []
    used_model: str = "fallback"
    used_provider: str = "fallback"
    retry_attempted = False
    retry_total_seconds: Optional[float] = None
    try:
        provider, model_id = _resolve_prompt_model()
        used_model = model_id
        used_provider = provider
        user_message = _build_user_message_v212(
            scenario_text=scenario_text,
            scenario_events=scenario_events,
            music_duration_sec=music_duration_sec,
        )
        # max_tokens — events × 6 max 씬 예측. cap 12000 유지.
        scenes_target_estimate = events_count * 6
        max_tokens = _max_tokens_for_scene_split(scenes_target_estimate)

        logger.info(
            "[PreMVSplit] llm entry pre_mv_job_id=%s phase=phase1 events_count=%d "
            "target_total_seconds=%.2f model=%s provider=%s max_tokens=%d "
            "user_msg_len=%d",
            pre_mv_job_id, events_count, target_total_seconds,
            model_id, provider, max_tokens, len(user_message),
        )

        async def _try_call(sys_prompt: str) -> list[dict]:
            if provider == "claude":
                raw_ = await _call_claude(
                    model_id, user_message, max_tokens,
                    system_prompt=sys_prompt,
                )
            else:
                raw_ = await _call_openai(
                    model_id, user_message, max_tokens,
                    system_prompt=sys_prompt,
                )
            parsed_ = _parse_scenes_response(raw_)
            if not isinstance(parsed_, list) or not parsed_:
                raise ValueError("LLM 이 빈 scenes 를 반환했습니다.")
            return parsed_

        # v21.5 — 신규 system prompt (event_index + 결정론 라벨 응답 금지).
        parsed = await _try_call(SCENE_SPLIT_SYSTEM_PROMPT_V215)
        # 응답 총합 계산.
        def _sum_scenes(scenes_list: list[dict]) -> float:
            tot = 0.0
            for s in scenes_list:
                if not isinstance(s, dict):
                    continue
                resolved, _ = _coerce_use_seconds_v213(
                    s.get("use_seconds"), float(video_clip_default),
                )
                tot += float(resolved)
            return tot

        # v21.5 — event_index 누락 검증.
        def _event_indices_in(scenes_list: list[dict]) -> set[int]:
            out: set[int] = set()
            for s in scenes_list:
                if not isinstance(s, dict):
                    continue
                v = s.get("event_index")
                if isinstance(v, bool):
                    continue
                if isinstance(v, int):
                    if 0 <= v < events_count:
                        out.add(v)
                    continue
                # 문자열 정수도 받아준다.
                try:
                    iv = int(v) if v is not None else None
                except (TypeError, ValueError):
                    iv = None
                if iv is not None and 0 <= iv < events_count:
                    out.add(iv)
            return out

        expected_event_indices = set(range(events_count))
        first_event_indices = _event_indices_in(parsed)
        first_missing = expected_event_indices - first_event_indices
        actual_sum = _sum_scenes(parsed)
        logger.info(
            "[PreMVSplit] llm 1st response pre_mv_job_id=%s scenes=%d actual_total=%.2f "
            "target=%.2f retry_threshold=%.2f event_indices=%s missing_events=%s",
            pre_mv_job_id, len(parsed), actual_sum, target_total_seconds, retry_threshold,
            sorted(first_event_indices), sorted(first_missing),
        )

        # v21.5 — retry 조건: event 누락 발생 시 (총합 부족은 부차적).
        retry_missing_after: Optional[set[int]] = None
        if first_missing:
            retry_attempted = True
            try:
                retry_prompt = (
                    SCENE_SPLIT_SYSTEM_PROMPT_V215
                    + "\n\n[중요 보강] 직전 응답에서 event_index = "
                    + str(sorted(first_missing))
                    + " 에 해당하는 씬이 누락됨.\n"
                    + "이번 응답에서는 그 event 들을 빠뜨리지 말고 "
                    + f"event_index 0 ~ {events_count - 1} 모두 한 번 이상 등장하도록 분배하라."
                )
                retry_parsed = await _try_call(retry_prompt)
                retry_event_indices = _event_indices_in(retry_parsed)
                retry_missing_after = expected_event_indices - retry_event_indices
                retry_sum = _sum_scenes(retry_parsed)
                retry_total_seconds = retry_sum
                logger.info(
                    "[PreMVSplit] llm retry response pre_mv_job_id=%s scenes=%d "
                    "actual_total=%.2f event_indices=%s missing_events=%s",
                    pre_mv_job_id, len(retry_parsed), retry_sum,
                    sorted(retry_event_indices), sorted(retry_missing_after),
                )
                # retry 가 1차보다 적은 missing 이면 채택. 같거나 더 많으면 1차 유지.
                if len(retry_missing_after) < len(first_missing):
                    parsed = retry_parsed
                    actual_sum = retry_sum
            except Exception as e:
                logger.warning(
                    "[PreMVSplit] llm retry failed pre_mv_job_id=%s err=%s: %s — keeping 1st",
                    pre_mv_job_id, type(e).__name__, str(e)[:200],
                )

        llm_scenes = parsed
    except Exception as e:
        logger.warning(
            "[PreMVSplit] llm failed pre_mv_job_id=%s phase=phase1 err=%s: %s — falling back",
            pre_mv_job_id, type(e).__name__, str(e)[:200],
        )
        llm_scenes = []

    # 2) Fallback (LLM 실패/부족 시).
    if not llm_scenes:
        llm_scenes = _build_fallback_scenes_v212(
            scenario_events, music_duration_sec,
            video_clip_default=video_clip_default,
        )
        used_model = "fallback"
        used_provider = "fallback"

    # 2.5) v21.5 — event_index 안전 보정 + 누락 event 자동 fallback 보충 + 정렬.
    def _coerce_event_index(value: Any) -> Optional[int]:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            if value != value or value in (float("inf"), float("-inf")):
                return None
            return int(value)
        if isinstance(value, str):
            try:
                return int(value.strip())
            except (TypeError, ValueError):
                return None
        return None

    # 정수 보정 + clamp. 누락 시 직전 ev_idx 또는 0.
    normalized_scenes: list[dict] = []
    prev_resolved_ev_idx: int = 0
    for sc in llm_scenes:
        if not isinstance(sc, dict):
            continue
        raw_ev = sc.get("event_index")
        resolved = _coerce_event_index(raw_ev)
        if resolved is None:
            resolved = prev_resolved_ev_idx
        # clamp 0 ~ events_count-1.
        resolved = max(0, min(events_count - 1, resolved))
        sc["event_index"] = resolved
        prev_resolved_ev_idx = resolved
        normalized_scenes.append(sc)
    llm_scenes = normalized_scenes

    # 누락된 event_index 식별 → fallback 씬 1개씩 자동 추가.
    present_ev_indices: set[int] = {
        sc.get("event_index") for sc in llm_scenes
        if isinstance(sc.get("event_index"), int)
    }
    expected_ev_indices: set[int] = set(range(events_count))
    missing_after_normalize = expected_ev_indices - present_ev_indices
    fallback_added_for_events: list[int] = []
    if missing_after_normalize:
        for mi in sorted(missing_after_normalize):
            ev = scenario_events[mi] or {}
            slot = ev.get("story_slot") or "memory"
            fb_scene = _fallback_prompts_from_event(ev, slot)
            fb_scene["event_index"] = mi
            fb_scene["use_seconds"] = float(video_clip_default)
            llm_scenes.append(fb_scene)
            fallback_added_for_events.append(mi)
        logger.warning(
            "[PreMVSplit] missing events auto-filled pre_mv_job_id=%s missing_events=%s",
            pre_mv_job_id, fallback_added_for_events,
        )

    # event_index 단조 증가로 정렬 (같은 값 안 응답 순서는 stable sort 로 유지).
    llm_scenes.sort(key=lambda s: int(s.get("event_index") or 0))

    # 3) 출력 정규화 — v21.5 단순 경로:
    #   각 씬의 event_index 로 events[ev_idx] 직접 룩업 → story_slot/memory_index/refs/section 강제.
    #   LLM 응답의 story_slot/memory_index/ref_* 필드는 무시 (덮어쓰기).
    final_scenes: list[dict] = []
    prev_slot: Optional[str] = None
    use_seconds_values: list[float] = []
    use_seconds_default_fallback_count = 0
    for sc in llm_scenes:
        if not isinstance(sc, dict):
            continue
        ev_idx_raw = sc.get("event_index")
        ev_idx = int(ev_idx_raw) if isinstance(ev_idx_raw, int) else 0
        ev_idx = max(0, min(events_count - 1, ev_idx))
        ev = scenario_events[ev_idx] or {}

        ev_slot = ev.get("story_slot") or "memory"
        if ev_slot not in _SLOT_ORDER:
            ev_slot = "memory"
        ev_memory_index = ev.get("memory_index")
        if ev_slot != "memory":
            ev_memory_index = None
        else:
            try:
                ev_memory_index = int(ev_memory_index) if ev_memory_index is not None else 0
            except (TypeError, ValueError):
                ev_memory_index = 0

        # v21.5 — refs 는 events.refs 에서 강제 추출 (LLM 응답 ref_* 무시).
        sheet_ids: list[str] = []
        place_ids: list[str] = []
        for r in (ev.get("refs") or []):
            if not isinstance(r, dict):
                continue
            aid = r.get("asset_id")
            t = r.get("type")
            if not aid:
                continue
            if t == "sheet":
                if aid not in sheet_ids:
                    sheet_ids.append(str(aid))
            elif t in ("place", "wedding_photo"):
                if aid not in place_ids:
                    place_ids.append(str(aid))
        ref_sheet_ids = sheet_ids
        ref_place_ids = place_ids

        # prompts — LLM 출력 우선, 누락 시 fallback 보강.
        fallback_payload = _fallback_prompts_from_event(ev, ev_slot)
        merged = dict(fallback_payload)
        for k in (
            "description", "description_ko",
            "image_prompt", "image_prompt_ko",
            "video_prompt", "video_prompt_ko",
        ):
            v = sc.get(k)
            if isinstance(v, str) and v.strip():
                merged[k] = v.strip()

        prompts = _maybe_prepend_continuity(merged, prev_slot, ev_slot)

        # v21.3 — LLM 이 정한 use_seconds 사용. 누락/범위 밖 시 default 보강.
        resolved_use_seconds, used_default = _coerce_use_seconds_v213(
            sc.get("use_seconds"),
            float(video_clip_default),
        )
        use_seconds_values.append(resolved_use_seconds)
        if used_default:
            use_seconds_default_fallback_count += 1

        final_scenes.append({
            "scene_number": len(final_scenes) + 1,
            "description": prompts["description"],
            "description_ko": prompts["description_ko"],
            "image_prompt": prompts["image_prompt"],
            "image_prompt_ko": prompts["image_prompt_ko"],
            "video_prompt": prompts["video_prompt"],
            "video_prompt_ko": prompts["video_prompt_ko"],
            # section 은 story_slot 라벨 그대로 (시간 의미 없음, 호환 키).
            "section": ev_slot,
            "section_start": 0.0,
            "section_end": 0.0,
            "use_seconds": resolved_use_seconds,
            "story_slot": ev_slot,
            "memory_index": ev_memory_index,
            "ref_sheet_ids": ref_sheet_ids,
            "ref_place_ids": ref_place_ids,
            # v21.5 — event_index 도 영속화 (디버깅/검증용).
            "event_index": ev_idx,
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
        prev_slot = ev_slot

    elapsed_ms = int((time.time() - started) * 1000)
    # v21.4 — use_seconds 분포 + 총합 metric.
    if use_seconds_values:
        us_min = min(use_seconds_values)
        us_max = max(use_seconds_values)
        us_mean = sum(use_seconds_values) / len(use_seconds_values)
    else:
        us_min = us_max = us_mean = 0.0
    actual_total_seconds = float(sum(use_seconds_values))
    total_ratio = (
        actual_total_seconds / music_duration_sec if music_duration_sec > 0 else 0.0
    )
    # 챕터별 (story_slot 연속) 씬 개수 계산 — 로그 시.
    chapter_scene_counts: list[int] = []
    prev_chapter_slot: Optional[str] = None
    for sc in final_scenes:
        s = sc.get("story_slot")
        if s != prev_chapter_slot:
            chapter_scene_counts.append(1)
            prev_chapter_slot = s
        else:
            chapter_scene_counts[-1] += 1
    # v21.5 — event_index 분포 + missing events fallback 보충 metric.
    final_ev_indices = sorted({
        sc.get("event_index") for sc in final_scenes
        if isinstance(sc.get("event_index"), int)
    })
    final_missing = sorted(set(range(events_count)) - set(final_ev_indices))
    logger.info(
        "[PreMVSplit] ok pre_mv_job_id=%s phase=phase1 events_count=%d scenes_count=%d "
        "model=%s provider=%s elapsed_ms=%d "
        "music_duration_sec=%.2f target_total_seconds=%.2f actual_total_seconds=%.2f "
        "total_ratio=%.2fx retry_attempted=%s retry_total_seconds=%s "
        "chapter_scene_counts=%s "
        "use_seconds_min=%.2f use_seconds_max=%.2f use_seconds_mean=%.2f "
        "use_seconds_default_fallback_count=%d "
        "event_indices=%s fallback_added_for_events=%s missing_events_after_all=%s",
        pre_mv_job_id, events_count, len(final_scenes),
        used_model, used_provider, elapsed_ms,
        music_duration_sec, target_total_seconds, actual_total_seconds,
        total_ratio, retry_attempted,
        f"{retry_total_seconds:.2f}" if retry_total_seconds is not None else "None",
        chapter_scene_counts,
        us_min, us_max, us_mean, use_seconds_default_fallback_count,
        final_ev_indices, fallback_added_for_events, final_missing,
    )
    return {
        "section_markers": [],
        "scenes": final_scenes,
        "target_total_seconds": float(target_total_seconds),
        "actual_total_seconds": float(actual_total_seconds),
    }


# ──────────────────────────────────────────────────────────────────────────
# Backward-compat stub — v17~v20 의 진입점 (가사 1:1 매핑). v21 에서 폐기.
# ──────────────────────────────────────────────────────────────────────────

async def split_into_scenes(*args, **kwargs):  # pragma: no cover
    raise RuntimeError(
        "split_into_scenes 는 v21 에서 폐기되었습니다. "
        "대신 split_into_scenes_v212(pre_mv_job_id, scenario_text, scenario_events, "
        "clips_per_event) 을 호출하세요."
    )
