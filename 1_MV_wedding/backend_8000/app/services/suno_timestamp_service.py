"""
Suno Timestamped Lyrics Service.

v17.0 — 9004 `app/services/suno_timestamp_service.py` 패턴 이식.
v21.1 — 반환 타입을 `dict` 로 확장: `{"segments": [...], "aligned_words": [...]}`.
        raw alignedWords 를 보존해 Phase 1 단어 단위 마커 추출에 사용한다.

핵심 동작:
- 입력: suno_task_id + suno_audio_id
- 출력: `{"segments": [...], "aligned_words": [...]}`
  - segments: 라인/세그먼트 단위 결과 — 기존 호환
  - aligned_words: Suno API 응답의 raw alignedWords 배열 (단어 단위)
- 단어 사이 공백 > 0.5s 를 자연스러운 라인 경계로 처리(Whisper segment 와 유사).

이 모듈은 외부 호출 실패 / 키 미설정 / 빈 응답 모두 **빈 dict** (`{"segments": [], "aligned_words": []}`) 반환을 원칙으로 한다.
호출자(mv.py `_run_music_generation`)가 best-effort 로 사용하기 때문이다.
"""

import logging
import re

import httpx

from ..config import settings


_DANGLING_BRACKET_RE = re.compile(r"[\s\n=]*\[\s*$")


logger = logging.getLogger(__name__)


_EMPTY_RESULT: dict = {"segments": [], "aligned_words": []}


async def get_suno_timestamps(task_id: str, audio_id: str) -> dict:
    """Suno API 의 timestamped-lyrics 엔드포인트 호출.

    Args:
        task_id: Suno generation task ID
        audio_id: Suno audio/song ID

    Returns:
        `{"segments": [...], "aligned_words": [...]}`.
        - segments: 라인/세그먼트 리스트. 각 원소 `{"text": str, "start": float, "end": float}`.
        - aligned_words: Suno API 응답의 raw alignedWords 배열 그대로.
        실패 / 키 미설정 / 비어있는 응답 시 모두 `{"segments": [], "aligned_words": []}`.
    """
    if not settings.suno_api_key:
        logger.warning(
            "[SunoTimestamps] suno_api_key not set — skipping fetch suno_task_id=%s",
            task_id,
        )
        return {"segments": [], "aligned_words": []}
    if not task_id or not audio_id:
        logger.warning(
            "[SunoTimestamps] missing identifiers suno_task_id=%s suno_audio_id=%s",
            task_id,
            audio_id,
        )
        return {"segments": [], "aligned_words": []}

    base_url = (settings.suno_api_url or "").rstrip("/")
    url = f"{base_url}/api/v1/generate/get-timestamped-lyrics"
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "taskId": task_id,
        "audioId": audio_id,
    }

    logger.info(
        "[SunoTimestamps] fetch entry suno_task_id=%s suno_audio_id=%s",
        task_id,
        audio_id,
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=body)
            logger.info(
                "[SunoTimestamps] fetch resp suno_task_id=%s status_code=%s",
                task_id,
                resp.status_code,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(
            "[SunoTimestamps] fetch failed suno_task_id=%s suno_audio_id=%s err=%s: %s",
            task_id,
            audio_id,
            type(e).__name__,
            str(e)[:200],
        )
        return {"segments": [], "aligned_words": []}

    if not isinstance(data, dict) or data.get("code") != 200:
        logger.warning(
            "[SunoTimestamps] api non-200 suno_task_id=%s msg=%s",
            task_id,
            (data.get("msg") if isinstance(data, dict) else "n/a"),
        )
        return {"segments": [], "aligned_words": []}

    aligned_words = (data.get("data") or {}).get("alignedWords") or []
    if not aligned_words:
        logger.warning(
            "[SunoTimestamps] no aligned_words suno_task_id=%s suno_audio_id=%s",
            task_id,
            audio_id,
        )
        return {"segments": [], "aligned_words": []}

    segments = _words_to_segments(aligned_words)
    logger.info(
        "[SunoTimestamps] fetch ok suno_task_id=%s suno_audio_id=%s words=%d "
        "segments_count=%d aligned_words_kept=%d",
        task_id,
        audio_id,
        len(aligned_words),
        len(segments),
        len(aligned_words),
    )
    return {"segments": segments, "aligned_words": aligned_words}


def _words_to_segments(aligned_words: list[dict]) -> list[dict]:
    """단어 단위 timestamp 를 라인/세그먼트 단위로 그룹핑.

    Suno 의 alignedWords 는 단어 텍스트에 `\\n` (개행) 이 포함된 경우 그 단어
    뒤에서 가사 라인이 끊긴다. 그래서 라인 분리 기준은:
      1) 단어 raw 텍스트에 `\\n` 포함 → 분리
      2) 또는 인접 단어 사이 무음 간격이 0.5초 초과 → 분리 (안전망)
    개행 기준이 우선이라 한 곡 안의 모든 가사 라인이 정확히 분리된다.

    Returns:
        `[{"text": str, "start": float, "end": float}, ...]`
    """
    if not aligned_words:
        return []

    segments: list[dict] = []
    current_words: list[str] = []
    current_start: float | None = None
    last_end: float | None = None

    n = len(aligned_words)
    for i, word_data in enumerate(aligned_words):
        if not isinstance(word_data, dict):
            continue
        raw = str(word_data.get("word") or "")
        word = raw.strip()
        try:
            start = float(word_data.get("startS", 0) or 0)
            end = float(word_data.get("endS", 0) or 0)
        except (TypeError, ValueError):
            continue

        # success=False 인 단어는 제외 (Suno 가 정렬 실패 표기)
        if not word or word_data.get("success", True) is False:
            continue

        if current_start is None:
            current_start = start

        current_words.append(word)
        last_end = end

        has_linebreak = "\n" in raw
        is_last = i == n - 1
        if not is_last:
            nxt = aligned_words[i + 1]
            try:
                next_start = float((nxt or {}).get("startS", 0) or 0)
            except (TypeError, ValueError):
                next_start = end
            gap = next_start - end
        else:
            gap = 999.0

        if has_linebreak or gap > 0.5 or is_last:
            text = " ".join(current_words).strip()
            if text:
                segments.append({
                    "text": text,
                    "start": current_start,
                    "end": last_end if last_end is not None else end,
                })
            current_words = []
            current_start = None
            last_end = None

    return _fixup_dangling_brackets(segments)


# v22.1 — Suno alignedWords 의 한 단어가 "이야기\n\n[" 형태로 들어오는 경우,
# 분리 후 segment text 끝에 dangling "[" 만 남고 다음 segment 가 "Intro]" 로 시작해
# 가독성이 깨진다. 후처리로 그 "[" 를 떼어 다음 segment text 의 앞에 붙인다.
def _fixup_dangling_brackets(segments: list[dict]) -> list[dict]:
    if not segments:
        return segments
    fixed: list[dict] = []
    pending_prefix = ""
    for seg in segments:
        text = seg.get("text", "") or ""
        if pending_prefix:
            text = pending_prefix + text
            pending_prefix = ""
        m = _DANGLING_BRACKET_RE.search(text)
        if m and m.start() > 0:
            pending_prefix = "["
            text = text[: m.start()].rstrip(" \n=")
        text = text.replace("\n", " ").strip()
        if not text:
            continue
        fixed.append({**seg, "text": text})
    # 마지막에 남은 prefix 가 있으면 마지막 segment 끝에 붙이기 (예외 케이스)
    if pending_prefix and fixed:
        fixed[-1] = {**fixed[-1], "text": (fixed[-1]["text"] + " " + pending_prefix).strip()}
    return fixed
