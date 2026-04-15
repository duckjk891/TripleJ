"""
Music generation service using YuE (via YuEGP for int8 quantization).
Runs as a background process to generate music from lyrics + genre tags.
"""

import asyncio
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import logging
import re

from ..config import settings

logger = logging.getLogger(__name__)


async def _translate_to_english(text: str, mode: str = "general") -> str:
    """Translate Korean text to English using ChatGPT.

    Args:
        text: The text to translate.
        mode: "general" for genre/tags, "lyrics" to preserve section tags.

    Returns the English translation, or the original text on failure.
    """
    if not text or not text.strip():
        return text

    # Skip if no Korean characters present
    if not re.search(r'[\uac00-\ud7a3]', text):
        return text

    # Skip if OpenAI API key is not configured
    if not settings.openai_api_key:
        logger.warning("OpenAI API key not set – skipping Korean→English translation")
        return text

    if mode == "lyrics":
        system_msg = (
            "You are a translator. Translate the given Korean song lyrics to English. "
            "Keep all section tags like [verse], [chorus], [intro], [outro], [bridge], "
            "[prechorus] exactly as they are. Only translate the lyrics text. "
            "Output ONLY the translated lyrics, nothing else."
        )
    else:
        system_msg = (
            "You are a translator. Translate the given Korean text to English. "
            "Output ONLY the English translation, nothing else. "
            "No explanations, no commentary, no quotes."
        )

    try:
        from .lyrics_generator import _get_client

        client = _get_client()
        response = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": text},
            ],
            temperature=0.3,
            max_tokens=500,
        )
        translated = response.choices[0].message.content.strip()
        logger.info("Translated Korean→English: %s → %s", text[:80], translated[:80])
        return translated
    except Exception as exc:
        logger.warning("Translation failed, using original text: %s", exc)
        return text


def _get_yue_dir() -> str:
    """Get YuEGP installation directory."""
    d = settings.yue_model_dir
    if not d:
        d = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "yue_models")
    return d


def _get_output_dir() -> str:
    d = settings.yue_output_dir
    if not d:
        d = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "yue_output")
    os.makedirs(d, exist_ok=True)
    return d


def _build_genre_tags(genre: str = None, mood: str = None, style: str = None, vocal: str = None) -> str:
    """Build genre/style tag string for YuE input.

    YuE expects short English-like tags (e.g. 'pop', 'chill', 'male vocal').
    Long sentences or Korean text in the style field must be filtered out.
    """
    tags = []

    if genre:
        tags.extend([g.strip().lower() for g in genre.split(",")])
    if mood:
        tags.extend([m.strip().lower() for m in mood.split(",")])
    if style:
        for s in style.split(","):
            s = s.strip().lower()
            # Skip overly long strings (not valid YuE tags)
            if len(s) > 30:
                continue
            tags.append(s)

    # Add vocal info
    if vocal == "instrumental":
        tags.append("instrumental")
    elif vocal:
        # Extract gender from vocal preset
        if "male" in vocal:
            tags.append("male vocal")
        elif "female" in vocal:
            tags.append("female vocal")

    # Default tags if empty
    if not tags:
        tags = ["pop", "korean", "vocal"]

    return " ".join(tags)


def _format_lyrics_for_yue(lyrics: str) -> str:
    """Format lyrics with proper section tags for YuE input."""
    if not lyrics:
        return "[verse]\nla la la\n\n[chorus]\noh oh oh\n"

    # YuE expects lowercase section tags
    formatted = lyrics

    # Normalize section tags to lowercase, remove numbered suffixes for YuE compatibility
    def _normalize_tag(m):
        tag = m.group(1).lower().strip()
        # Remove numbers like [Verse 1] -> [verse]
        tag = re.sub(r'\s*\d+$', '', tag)
        # Map compound tags to simple ones (regex \w+ friendly)
        simple_map = {
            'pre-chorus': 'prechorus',
            'pre chorus': 'prechorus',
            'instrumental break': 'instrumental',
            'instrumental': 'instrumental',
        }
        tag = simple_map.get(tag, tag.replace('-', '').replace(' ', ''))
        return f'[{tag}]'

    formatted = re.sub(r'\[([^\]]+)\]', _normalize_tag, formatted)

    # Ensure sections are separated by double newlines
    lines = formatted.split("\n")
    result = []
    for line in lines:
        if line.strip().startswith("[") and result and result[-1].strip():
            result.append("")
        result.append(line)

    formatted = "\n".join(result)

    # Ensure trailing newline for regex matching
    if not formatted.endswith("\n"):
        formatted += "\n"

    # Ensure at least 2 sections exist
    if formatted.count("[") < 2:
        if "[verse]" not in formatted:
            formatted = "[verse]\n" + formatted
        formatted += "\n[chorus]\nla la la\n"

    return formatted


async def generate_music(
    generation_id: str,
    lyrics: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    vocal: str = None,
    duration_segments: int = 2,
    bpm: int = None,
    key: str = None,
    mongo_db=None,
    model: str = "yue",
) -> dict:
    """
    Generate music using YuE model.
    This runs as a background task and updates MongoDB with progress.

    Returns dict with output file paths.
    """
    from bson import ObjectId

    yue_dir = _get_yue_dir()
    output_dir = _get_output_dir()
    job_id = str(uuid.uuid4())[:8]
    job_output = os.path.join(output_dir, job_id)
    os.makedirs(job_output, exist_ok=True)

    # Build genre tags and format lyrics
    genre_tags = _build_genre_tags(genre, mood, style, vocal)
    formatted_lyrics = _format_lyrics_for_yue(lyrics)

    # Translate Korean → English for YuE (only calls API if Korean is detected)
    genre_tags = await _translate_to_english(genre_tags, mode="general")
    formatted_lyrics = await _translate_to_english(formatted_lyrics, mode="lyrics")

    # Write genre file
    genre_file = os.path.join(job_output, "genre.txt")
    with open(genre_file, "w", encoding="utf-8") as f:
        f.write(genre_tags)

    # Write lyrics file
    lyrics_file = os.path.join(job_output, "lyrics.txt")
    with open(lyrics_file, "w", encoding="utf-8") as f:
        f.write(formatted_lyrics)

    # Update status to processing
    if mongo_db is not None:
        await mongo_db.generations.update_one(
            {"_id": ObjectId(generation_id)},
            {
                "$set": {
                    "status": "processing",
                    "progress": 10,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    try:
        # Determine model based on lyrics language (after translation)
        has_korean = any("\uac00" <= c <= "\ud7a3" for c in (formatted_lyrics or ""))
        has_japanese = any("\u3040" <= c <= "\u30ff" for c in (formatted_lyrics or ""))

        if has_korean or has_japanese:
            # Fallback: if translation failed/was skipped, use multilingual model
            stage1_model = "m-a-p/YuE-s1-7B-anneal-jp-kr-cot"
        else:
            stage1_model = "m-a-p/YuE-s1-7B-anneal-en-cot"

        # Build YuEGP command
        infer_script = os.path.join(yue_dir, "inference", "infer.py")
        if not os.path.exists(infer_script):
            # Try alternative path structure
            infer_script = os.path.join(yue_dir, "infer.py")

        # Use conda yuegp environment Python
        python_bin = settings.yue_python or "python3"

        cmd = [
            python_bin, infer_script,
            "--cuda_idx", "0",
            "--stage1_model", stage1_model,
            "--stage2_model", "m-a-p/YuE-s2-1B-general",
            "--genre_txt", genre_file,
            "--lyrics_txt", lyrics_file,
            "--run_n_segments", str(duration_segments),
            "--output_dir", job_output,
            "--max_new_tokens", "3000",
            "--stage2_batch_size", "4",
            "--profile", str(settings.yue_vram_profile),
        ]

        # Add SDPA flag for non-Ampere GPUs (like RTX 2080 Ti)
        cmd.append("--sdpa")

        # Update progress
        if mongo_db is not None:
            await mongo_db.generations.update_one(
                {"_id": ObjectId(generation_id)},
                {"$set": {"progress": 20, "updated_at": datetime.now(timezone.utc)}},
            )

        # Run YuE inference
        env = os.environ.copy()
        env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=os.path.join(yue_dir, "inference") if os.path.exists(os.path.join(yue_dir, "inference")) else yue_dir,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode("utf-8", errors="replace")[-2000:]
            if mongo_db is not None:
                await mongo_db.generations.update_one(
                    {"_id": ObjectId(generation_id)},
                    {
                        "$set": {
                            "status": "failed",
                            "error_message": f"YuE inference failed: {error_msg}",
                            "progress": 0,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
            return {"error": error_msg}

        # Find output audio files
        audio_files = []
        for ext in ("*.wav", "*.mp3"):
            audio_files.extend(Path(job_output).rglob(ext))

        if not audio_files:
            if mongo_db is not None:
                await mongo_db.generations.update_one(
                    {"_id": ObjectId(generation_id)},
                    {
                        "$set": {
                            "status": "failed",
                            "error_message": "No audio output generated",
                            "progress": 0,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
            return {"error": "No audio output generated"}

        # Upload to MinIO
        from ..database.minio import get_minio
        minio_client = get_minio()
        bucket = settings.minio_bucket_music

        uploaded_urls = []
        for audio_path in audio_files:
            object_name = f"generated/{generation_id}/{audio_path.name}"
            minio_client.fput_object(
                bucket, object_name, str(audio_path),
                content_type="audio/wav" if audio_path.suffix == ".wav" else "audio/mpeg",
            )
            uploaded_urls.append(object_name)

        # Pick the best output (mixed track preferred)
        result_path = None
        for f in audio_files:
            if "mix" in f.stem.lower() or "vocal_instrumental" in f.stem.lower():
                result_path = f
                break
        if not result_path:
            result_path = audio_files[0]

        result_object = f"generated/{generation_id}/{result_path.name}"

        # Update generation as completed
        if mongo_db is not None:
            await mongo_db.generations.update_one(
                {"_id": ObjectId(generation_id)},
                {
                    "$set": {
                        "status": "completed",
                        "progress": 100,
                        "result_audio_url": result_object,
                        "output_files": uploaded_urls,
                        "completed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

        return {
            "status": "completed",
            "result_audio_url": result_object,
            "output_files": uploaded_urls,
        }

    except Exception as e:
        if mongo_db is not None:
            await mongo_db.generations.update_one(
                {"_id": ObjectId(generation_id)},
                {
                    "$set": {
                        "status": "failed",
                        "error_message": str(e)[:500],
                        "progress": 0,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )
        return {"error": str(e)}
