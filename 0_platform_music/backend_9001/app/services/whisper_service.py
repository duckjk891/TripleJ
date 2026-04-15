"""Whisper API service for lyrics timestamp extraction."""
import io
import logging
import tempfile
import os
from typing import Optional

from openai import OpenAI
from ..config import settings

logger = logging.getLogger(__name__)


def get_lyrics_timestamps(audio_bytes: bytes, file_format: str = "mp3", lyrics_hint: str = None) -> list[dict]:
    """Extract word/segment timestamps from audio using Whisper API.

    Args:
        audio_bytes: Audio data bytes
        file_format: Audio format (mp3, wav, etc.)
        lyrics_hint: Optional lyrics text to help Whisper recognize mixed languages

    Returns:
        List of {"text": str, "start": float, "end": float}
    """
    client = OpenAI(api_key=settings.openai_api_key)

    # Write to temp file (Whisper API needs a file)
    with tempfile.NamedTemporaryFile(suffix=f".{file_format}", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        with open(temp_path, "rb") as audio_file:
            kwargs = {
                "model": "whisper-1",
                "file": audio_file,
                "response_format": "verbose_json",
                "timestamp_granularities": ["segment"],
            }
            if lyrics_hint:
                # 가사 힌트 + 한국어 유도 프롬프트 (language 파라미터 없이)
                kwargs["prompt"] = "한국어 가사: " + lyrics_hint[:480]
            response = client.audio.transcriptions.create(**kwargs)

        segments = response.segments or []
        result = []
        for seg in segments:
            # Whisper API returns Pydantic objects, not dicts
            text = getattr(seg, "text", "") or ""
            start = getattr(seg, "start", 0) or 0
            end = getattr(seg, "end", 0) or 0
            result.append({
                "text": text.strip(),
                "start": float(start),
                "end": float(end),
            })

        logger.info("Whisper: extracted %d segments from audio", len(result))
        return result
    except Exception as e:
        logger.warning("Whisper: failed to extract timestamps: %s", str(e)[:200])
        return []
    finally:
        os.unlink(temp_path)


def get_full_audio_timestamps(audio_bytes: bytes, file_format: str = "mp3", lyrics_hint: str = None) -> list[dict]:
    """Extract segment timestamps from full audio using Whisper API.

    Args:
        audio_bytes: Full audio data bytes
        file_format: Audio format (mp3, wav, etc.)
        lyrics_hint: Optional lyrics text to help Whisper recognize mixed languages

    Returns:
        List of {"text": str, "start": float, "end": float}
    """
    return get_lyrics_timestamps(audio_bytes, file_format=file_format, lyrics_hint=lyrics_hint)
