"""
Suno Timestamped Lyrics Service.
Fetches word-level lyrics timestamps from Suno's API.
"""

import logging
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

    url = f"{settings.suno_api_url}/api/v1/generate/get-timestamped-lyrics"
    headers = {
        "api-key": settings.suno_api_key,
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

        if data.get("code") != 200:
            logger.warning("Suno timestamps API error: %s", data.get("msg", "Unknown"))
            return []

        aligned_words = data.get("data", {}).get("alignedWords", [])
        if not aligned_words:
            logger.warning("Suno timestamps: no aligned words returned")
            return []

        # Convert word-level to segment-level (group words into lines/segments)
        segments = _words_to_segments(aligned_words)
        logger.info("Suno timestamps: %d segments from %d words", len(segments), len(aligned_words))
        return segments

    except Exception as e:
        logger.warning("Suno timestamps fetch failed: %s", str(e)[:200])
        return []


def _words_to_segments(aligned_words: list[dict]) -> list[dict]:
    """Convert word-level timestamps to segment-level.

    Groups consecutive words into segments, splitting on pauses > 0.5s
    to match the format expected by the section builder.

    Returns:
        List of {"text": str, "start": float, "end": float}
    """
    if not aligned_words:
        return []

    segments = []
    current_words = []
    current_start = None

    for i, word_data in enumerate(aligned_words):
        word = word_data.get("word", "").strip()
        start = float(word_data.get("startS", 0))
        end = float(word_data.get("endS", 0))

        if not word or not word_data.get("success", True):
            continue

        if current_start is None:
            current_start = start

        current_words.append(word)

        # Check if next word has a gap > 0.5s (natural pause = new segment)
        is_last = (i == len(aligned_words) - 1)
        next_start = float(aligned_words[i + 1].get("startS", 0)) if not is_last else 0
        gap = next_start - end if not is_last else 999

        if gap > 0.5 or is_last:
            segments.append({
                "text": " ".join(current_words),
                "start": current_start,
                "end": end,
            })
            current_words = []
            current_start = None

    return segments
