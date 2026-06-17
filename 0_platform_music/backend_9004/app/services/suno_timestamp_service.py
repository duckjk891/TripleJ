"""
Suno Timestamped Lyrics Service.
Fetches word-level lyrics timestamps from Suno's API.
"""

import logging
import re
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


async def get_suno_timestamps(task_id: str, audio_id: str) -> list[dict]:
    """Fetch timestamped lyrics from Suno API.

    Args:
        task_id: Suno generation task ID
        audio_id: Suno audio/song ID

    Returns:
        List of {"text": str, "start": float, "end": float} segments,
        grouped by natural pauses (similar to Whisper segment format).
    """
    if not settings.suno_api_key:
        logger.warning("Suno API key not set, cannot fetch timestamps")
        return []

    logger.info(
        "[SunoTimestamps] fetch task_id=%s audio_id_len=%d",
        task_id, len(audio_id or ""),
    )

    url = f"{settings.suno_api_url}/api/v1/generate/get-timestamped-lyrics"
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "taskId": task_id,
        "audioId": audio_id,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        # sunoapi.org returns HTTP 200 even on auth/business errors, with
        # an in-body "code" field. Branch on that, not just HTTP status.
        if data.get("code") != 200:
            logger.warning(
                "[SunoTimestamps] task_id=%s non-200 code=%s msg=%s",
                task_id, data.get("code"), data.get("msg"),
            )
            return []

        aligned_words = data.get("data", {}).get("alignedWords", [])
        if not aligned_words:
            logger.warning(
                "[SunoTimestamps] task_id=%s no aligned words returned", task_id,
            )
            return []

        # Convert word-level to segment-level (group words into lines/segments)
        segments = _words_to_segments(aligned_words)
        logger.info(
            "[SunoTimestamps] task_id=%s code=%s segs=%d",
            task_id, data.get("code"), len(segments),
        )
        return segments

    except Exception as e:
        logger.warning(
            "[SunoTimestamps] task_id=%s fetch exception: %s", task_id, str(e)[:200],
        )
        return []


def _words_to_segments(aligned_words: list[dict]) -> list[dict]:
    """Convert word-level timestamps to karaoke-line segments.

    Suno encodes line breaks as ``\\n`` characters INSIDE the word text
    (e.g. ``"느려\\n"``, ``"흘러가\\n\\n"``, or even a section tag glued to the
    next line's first word like ``"[Verse 1: ...]\\n알람 "``). We split on
    those markers so each segment is one karaoke line. Section tags are kept
    faithful to the lyrics (not dropped).

    If the newline-based split is degenerate (one giant line despite many
    words), we fall back to a gap/word-count split so we never emit a single
    huge segment.

    Returns:
        List of {"text": str, "start": float, "end": float}
    """
    if not aligned_words:
        return []

    segments = []
    pieces = []          # text pieces accumulated for the current line
    line_start = None    # startS of the first word contributing to the line
    line_end = None      # endS of the last word contributing to the line

    def _flush():
        if not pieces:
            return
        text = re.sub(r"\s+", " ", "".join(pieces)).strip()
        if text:
            segments.append({
                "text": text,
                "start": line_start if line_start is not None else 0.0,
                "end": line_end if line_end is not None else 0.0,
            })

    for word_data in aligned_words:
        if not word_data.get("success", True):
            continue
        raw = word_data.get("word", "")
        if raw is None:
            continue
        start = float(word_data.get("startS", 0))
        end = float(word_data.get("endS", 0))

        parts = raw.split("\n")
        for idx, part in enumerate(parts):
            if idx > 0:
                # A "\n" boundary: flush the current line and begin a new one.
                _flush()
                pieces = []
                line_start = None
                line_end = None
            if part == "" and idx > 0:
                # Pure newline boundary (e.g. trailing "\n" or blank line) —
                # nothing to add for this empty part.
                continue
            if line_start is None:
                line_start = start
            line_end = end
            pieces.append(part)

    _flush()

    # FALLBACK: never produce a single giant line when there are many words.
    if len(segments) <= 1 and len(aligned_words) > 12:
        fallback = _fallback_segments(aligned_words)
        logger.info(
            "[SunoTimestamps] segmented lines=%d mode=%s",
            len(fallback), "fallback",
        )
        return fallback

    logger.info(
        "[SunoTimestamps] segmented lines=%d mode=%s",
        len(segments), "newline",
    )
    return segments


def _fallback_segments(aligned_words: list[dict]) -> list[dict]:
    """Secondary split used only when newline markers are absent/degenerate.

    Starts a new line on a gap > 0.4s between consecutive words OR after
    ~10 words, whichever comes first, so output is never one huge line.
    """
    segments = []
    current = []
    current_start = None
    prev_end = None
    max_words = 10
    gap_threshold = 0.4

    for word_data in aligned_words:
        if not word_data.get("success", True):
            continue
        word = re.sub(r"\s+", " ", word_data.get("word", "") or "").strip()
        if not word:
            continue
        start = float(word_data.get("startS", 0))
        end = float(word_data.get("endS", 0))

        gap = (start - prev_end) if prev_end is not None else 0.0
        if current and (gap > gap_threshold or len(current) >= max_words):
            segments.append({
                "text": " ".join(current),
                "start": current_start,
                "end": prev_end,
            })
            current = []
            current_start = None

        if current_start is None:
            current_start = start
        current.append(word)
        prev_end = end

    if current:
        segments.append({
            "text": " ".join(current),
            "start": current_start,
            "end": prev_end,
        })

    return segments
