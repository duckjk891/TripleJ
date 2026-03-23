"""
AI Music Video Generator - Enhanced 20-Scene Pipeline.

Pipeline:
  1. Split lyrics into ~20 scenes (ChatGPT)
  2. Generate scene images (Gemini)
  3. Generate scene videos from images (Veo 3.1)
  4. Concatenate all clips into final video (ffmpeg)

Uses httpx for Google API calls, OpenAI SDK for ChatGPT.
"""

import asyncio
import base64
import io
import json
import logging
import os
import shutil
import tempfile
from datetime import datetime
from typing import List, Optional

import httpx

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

# ── API URLs ──────────────────────────────────────────────────────────────────

GEMINI_IMAGE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)

VEO31_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "veo-3.1-generate-preview:predictLongRunning"
)

VEO_OPERATION_URL = (
    "https://generativelanguage.googleapis.com/v1beta/{}"
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_openai_client():
    """Get or create the AsyncOpenAI client (singleton)."""
    from .lyrics_generator import _get_client
    return _get_client()


def _get_ffmpeg_path() -> Optional[str]:
    """Get ffmpeg binary path. Checks PATH first, then imageio-ffmpeg."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def _ffmpeg_available() -> bool:
    """Check whether ffmpeg is available."""
    return _get_ffmpeg_path() is not None


# ── 1. Split Lyrics into Scenes (ChatGPT) ────────────────────────────────────

SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE = """\
Split the following song lyrics into approximately {scene_count} scenes for a music video.
For each scene, provide a vivid visual description (in English) that captures \
the emotion and meaning of the lyrics segment. The description should be \
suitable as a prompt for AI image/video generation.

IMPORTANT: First, design an overall story arc for the music video:
- Introduction (first 2-3 scenes): Set the scene, introduce the mood/character/setting.
- Development (next scenes): Build the narrative, show progression and emotional deepening.
- Climax (2-3 scenes near the end): Peak emotional moment, most intense visuals.
- Resolution (final 1-2 scenes): Conclude the story, provide emotional closure.

Then distribute the lyrics across these scenes following this narrative structure.
Each scene should naturally flow into the next, creating a cohesive visual story.

MUSIC VIDEO PERFORMANCE SCENES:
- Every 3-4 story scenes, insert a "performance" scene where the main character \
looks directly at the camera and sings/lip-syncs the lyrics passionately.
- Performance scenes should vary in setting/angle: close-up face singing, \
medium shot singing, dramatic wide shot singing, etc.
- Alternate between STORY scenes (narrative, emotional, cinematic) and \
PERFORMANCE scenes (character singing to camera) throughout the video.
- This creates the classic music video feel of switching between storytelling \
and the artist performing.

Output ONLY a JSON array with objects like:
[
  {{"scene_number": 1, "description": "visual description ...", "lyrics_segment": "lyrics text ..."}},
  ...
]

Rules:
- Aim for approximately {scene_count} scenes (minimum {scene_min}, maximum {scene_max}).
- Each scene description should be 1-3 sentences of vivid, cinematic imagery.
- Distribute lyrics evenly across scenes.
- If some sections are instrumental/intro/outro, create atmospheric visual scenes.
- Mark performance scenes clearly in the description (e.g. "close-up of the main character looking at camera, singing emotionally").
- Ensure visual continuity: maintain consistent setting, lighting, and character appearance across scenes.
- Output valid JSON only, no markdown fences, no extra text.
"""

SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE = """\
Generate approximately {scene_count} scenes for a music video based on the given song metadata.
Since no lyrics are provided, create vivid visual scenes that match the title, genre, \
and mood of the song.

IMPORTANT: Design an overall story arc for the music video:
- Introduction (first 2-3 scenes): Set the scene, introduce the mood/character/setting.
- Development (next scenes): Build the narrative, show progression and emotional deepening.
- Climax (2-3 scenes near the end): Peak emotional moment, most intense visuals.
- Resolution (final 1-2 scenes): Conclude the story, provide emotional closure.

Each scene should naturally flow into the next, creating a cohesive visual story.

MUSIC VIDEO PERFORMANCE SCENES:
- Every 3-4 story scenes, insert a "performance" scene where the main character \
looks directly at the camera and sings/performs passionately.
- Performance scenes should vary in setting/angle: close-up face singing, \
medium shot singing, dramatic wide shot singing, etc.
- Alternate between STORY scenes (narrative, emotional, cinematic) and \
PERFORMANCE scenes (character singing to camera) throughout the video.

Output ONLY a JSON array with objects like:
[
  {{"scene_number": 1, "description": "visual description ...", "lyrics_segment": ""}},
  ...
]

Rules:
- Create exactly {scene_count} scenes.
- Each scene description should be 1-3 sentences of vivid, cinematic imagery.
- The scenes should tell a visual story that fits the genre and mood.
- Mark performance scenes clearly in the description (e.g. "close-up of the main character looking at camera, singing emotionally").
- Ensure visual continuity: maintain consistent setting, lighting, and character appearance across scenes.
- Output valid JSON only, no markdown fences, no extra text.
"""


async def split_lyrics_into_scenes(
    lyrics: Optional[str],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scene_count: int = 20,
    user_scene_prompt: Optional[str] = None,
) -> List[dict]:
    """Use ChatGPT to split lyrics into visual scenes.

    Returns list of {"scene_number", "description", "lyrics_segment"}.
    """
    client = _get_openai_client()

    scene_min = max(scene_count - 5, 3)
    scene_max = scene_count + 5
    prompt_vars = {
        "scene_count": scene_count,
        "scene_min": scene_min,
        "scene_max": scene_max,
    }

    if lyrics and lyrics.strip():
        system_prompt = SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE.format(**prompt_vars)
        user_message = "Title: {}\n".format(title)
        if genre:
            user_message += "Genre: {}\n".format(genre)
        if mood:
            user_message += "Mood: {}\n".format(mood)
        user_message += "\nLyrics:\n{}".format(lyrics)
    else:
        system_prompt = SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE.format(**prompt_vars)
        user_message = "Title: {}\n".format(title)
        if genre:
            user_message += "Genre: {}\n".format(genre)
        if mood:
            user_message += "Mood: {}\n".format(mood)

    # Append user scene direction if provided
    if user_scene_prompt and user_scene_prompt.strip():
        system_prompt += (
            "\n\nAdditional user direction for scene imagery: \"{}\"\n"
            "Incorporate this direction into each scene's visual description."
        ).format(user_scene_prompt.strip())

    response = await client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_tokens=4000,
    )

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    scenes = json.loads(raw)

    if not isinstance(scenes, list) or len(scenes) == 0:
        raise ValueError("ChatGPT가 유효한 장면 목록을 생성하지 못했습니다.")

    return scenes


# ── 2. Generate Scene Image (Gemini) ─────────────────────────────────────────


async def generate_scene_image(
    scene_description: str,
    style_prompt: str = "",
    cover_image_bytes: Optional[bytes] = None,
    character_image_bytes: Optional[bytes] = None,
) -> bytes:
    """Generate a single scene image using Gemini. Returns PNG bytes.

    If cover_image_bytes is provided, it is included as a reference so
    that Gemini produces images in a visually consistent style.
    If character_image_bytes is provided, the character appears in the scene.
    """

    prompt_parts = [scene_description]
    if style_prompt:
        prompt_parts.append(style_prompt)
    prompt_parts.append(
        "cinematic widescreen 16:9 aspect ratio, music video still frame, "
        "no text or letters"
    )

    if cover_image_bytes:
        prompt_parts.append(
            "IMPORTANT: Match the visual style, color palette, and artistic "
            "mood of the provided reference image exactly. The scene should "
            "look like it belongs in the same music video as the reference."
        )

    if character_image_bytes:
        prompt_parts.append(
            "IMPORTANT: The provided character reference sheet shows the main character "
            "of this music video. This character MUST appear prominently in this scene, "
            "maintaining their exact appearance (face, hair, features) from the reference. "
            "Photorealistic style only — no anime, cartoon, or illustration."
        )

    prompt = ". ".join(prompt_parts)

    # Build request parts
    request_parts: list = [{"text": prompt}]

    # Include cover image as reference for style consistency
    if cover_image_bytes:
        cover_b64 = base64.b64encode(cover_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": cover_b64,
            }
        })

    # Include character sheet as reference
    if character_image_bytes:
        char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": char_b64,
            }
        })

    payload = {
        "contents": [{"parts": request_parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            GEMINI_IMAGE_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code == 429:
        # Rate limited — wait and retry once
        logger.warning("Gemini 429 rate limit, waiting 30s before retry...")
        await asyncio.sleep(30)
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                GEMINI_IMAGE_URL,
                params={"key": settings.google_api_key},
                json=payload,
            )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini 이미지 생성 실패 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini 응답에 후보가 없습니다.")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("Gemini 응답에서 이미지를 찾을 수 없습니다.")


# ── 3. Start Scene Video Generation ──────────────────────────────────────────

async def start_scene_video(
    scene_description: str,
    image_bytes: Optional[bytes] = None,
) -> str:
    """Start video generation. Tries Veo 3.1 with image, falls back to Veo 2 text-only.

    Returns operation_name.
    """

    prompt = "{}, smooth cinematic camera movement".format(scene_description)

    if image_bytes:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        # referenceImages requires: 16:9 aspect ratio + 8 second duration
        payload = {
            "instances": [
                {
                    "prompt": prompt,
                    "referenceImages": [
                        {
                            "image": {
                                "bytesBase64Encoded": image_b64,
                                "mimeType": "image/png",
                            },
                            "referenceType": "asset",
                        }
                    ],
                }
            ],
            "parameters": {
                "aspectRatio": "16:9",
                "durationSeconds": 8,
            },
        }
    else:
        # Text-only fallback (no image)
        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "aspectRatio": "16:9",
                "durationSeconds": 8,
            },
        }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            VEO31_GENERATE_URL,
            headers={"x-goog-api-key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Veo 3.1 API 오류 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    operation_name = data.get("name")
    if not operation_name:
        raise ValueError("Veo 3.1 응답에서 operation name을 찾을 수 없습니다.")

    logger.info("Veo 3.1 accepted: %s", operation_name)
    return operation_name


# ── 4. Check Scene Video Status ──────────────────────────────────────────────


async def check_scene_video_status(operation_name: str) -> dict:
    """Check Veo video generation status.

    Returns {"done": bool, "video_uri": str or None, "error": str or None}
    """
    url = VEO_OPERATION_URL.format(operation_name)

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            url,
            headers={"x-goog-api-key": settings.google_api_key},
        )

    if resp.status_code != 200:
        return {
            "done": True,
            "video_uri": None,
            "error": "상태 확인 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            ),
        }

    data = resp.json()

    if not data.get("done"):
        return {"done": False, "video_uri": None, "error": None}

    error = data.get("error")
    if error:
        return {
            "done": True,
            "video_uri": None,
            "error": error.get("message", "알 수 없는 오류가 발생했습니다."),
        }

    response_data = data.get("response", {})
    generated = response_data.get("generateVideoResponse", {})
    samples = generated.get("generatedSamples", [])

    if not samples:
        return {
            "done": True,
            "video_uri": None,
            "error": "생성된 비디오가 없습니다.",
        }

    video_uri = samples[0].get("video", {}).get("uri")
    if not video_uri:
        return {
            "done": True,
            "video_uri": None,
            "error": "비디오 URI를 찾을 수 없습니다.",
        }

    return {"done": True, "video_uri": video_uri, "error": None}


# ── 5. Download Video ────────────────────────────────────────────────────────


async def download_video(video_uri: str) -> bytes:
    """Download video from Google's temporary URI. Returns mp4 bytes."""

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(
            video_uri,
            headers={"x-goog-api-key": settings.google_api_key},
        )

    if resp.status_code != 200:
        raise ValueError(
            "비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )

    return resp.content


# ── 6. Concatenate Videos (ffmpeg) ────────────────────────────────────────────


async def concatenate_videos(video_paths: List[str], output_path: str) -> None:
    """Concatenate video clips using ffmpeg.

    Tries copy mode first; falls back to re-encoding if that fails.
    """
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        raise RuntimeError(
            "ffmpeg가 설치되어 있지 않습니다. 비디오 합치기를 할 수 없습니다."
        )

    # Create concat list file
    concat_list_path = output_path + ".concat.txt"
    with open(concat_list_path, "w") as f:
        for vp in video_paths:
            f.write("file '{}'\n".format(vp))

    try:
        # Attempt stream-copy (fast, no re-encode)
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-y",
            "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy",
            output_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.warning(
                "ffmpeg copy mode failed, falling back to re-encode: %s",
                stderr.decode()[:500],
            )
            # Fallback: re-encode with libx264
            proc2 = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list_path,
                "-c:v", "libx264", "-preset", "fast",
                "-movflags", "+faststart",
                output_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr2 = await proc2.communicate()

            if proc2.returncode != 0:
                raise RuntimeError(
                    "ffmpeg 비디오 합치기 실패: {}".format(stderr2.decode()[:500])
                )
    finally:
        # Clean up concat list
        if os.path.exists(concat_list_path):
            os.remove(concat_list_path)


# ── 7. Main Orchestrator ─────────────────────────────────────────────────────


async def _update_job(mongo_db, job_id, update: dict) -> None:
    """Helper to update mv_jobs document."""
    update["updated_at"] = datetime.utcnow()
    await mongo_db.mv_jobs.update_one(
        {"_id": job_id},
        {"$set": update},
    )


async def _generate_single_scene_video(
    scene: dict,
    scene_idx: int,
    image_bytes: bytes,
    tmpdir: str,
) -> Optional[str]:
    """Generate video for a single scene with retry + 429 backoff.

    Returns local file path or None.
    Raises QuotaExhaustedError if all retries fail with 429.
    """

    max_retries = 5
    # Very long backoffs for 429: 3min, 5min, 7min, 10min, 15min
    rate_limit_backoffs = [180, 300, 420, 600, 900]

    consecutive_429 = 0

    for attempt in range(max_retries):
        try:
            operation_name = await start_scene_video(
                scene["description"], image_bytes
            )
            consecutive_429 = 0  # API accepted the request

            # Poll until done (max ~10 minutes per scene)
            for _ in range(120):  # 120 * 5s = 10 min
                await asyncio.sleep(5)
                status = await check_scene_video_status(operation_name)

                if status["done"]:
                    break
            else:
                logger.warning("Scene %d timed out", scene_idx)
                if attempt < max_retries - 1:
                    continue
                return None

            if status.get("error"):
                logger.warning(
                    "Scene %d error: %s", scene_idx, status["error"]
                )
                if attempt < max_retries - 1:
                    continue
                return None

            # Download video
            video_bytes = await download_video(status["video_uri"])
            video_path = os.path.join(tmpdir, "scene_{:03d}.mp4".format(scene_idx))
            with open(video_path, "wb") as f:
                f.write(video_bytes)
            return video_path

        except Exception as e:
            error_str = str(e)
            is_rate_limit = "429" in error_str

            if is_rate_limit:
                consecutive_429 += 1
                backoff = rate_limit_backoffs[min(attempt, len(rate_limit_backoffs) - 1)]
                logger.warning(
                    "Scene %d attempt %d: 429 rate limit — waiting %ds (%.1f min)",
                    scene_idx, attempt + 1, backoff, backoff / 60,
                )
            else:
                consecutive_429 = 0
                backoff = 10 * (attempt + 1)
                logger.warning(
                    "Scene %d attempt %d failed: %s — waiting %ds",
                    scene_idx, attempt + 1, error_str[:200], backoff,
                )

            if attempt < max_retries - 1:
                await asyncio.sleep(backoff)
                continue

            # All retries exhausted
            if consecutive_429 >= max_retries:
                raise _QuotaExhaustedError(
                    "Scene {} — {} consecutive 429 errors".format(
                        scene_idx, consecutive_429
                    )
                )
            return None

    return None


class _QuotaExhaustedError(Exception):
    """Raised when API quota appears fully exhausted."""
    pass


async def run_mv_pipeline(
    job_id,
    title: str,
    genre: Optional[str],
    mood: Optional[str],
    lyrics: Optional[str],
    cover_image_bytes: Optional[bytes],
    mongo_db,
) -> None:
    """Main MV generation orchestrator. Runs as a background task.

    Updates MongoDB mv_jobs document with progress throughout.
    """

    tmpdir = tempfile.mkdtemp(prefix="mv_pipeline_")

    try:
        # ── Step 1: Split lyrics into scenes ──
        await _update_job(mongo_db, job_id, {
            "status": "splitting",
            "progress": 2,
        })

        try:
            scenes = await split_lyrics_into_scenes(lyrics, title, genre, mood)
        except Exception as e:
            logger.error("Failed to split lyrics: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "장면 분할 실패: {}".format(str(e)[:300]),
            })
            return

        total_scenes = len(scenes)
        await _update_job(mongo_db, job_id, {
            "progress": 5,
            "total_scenes": total_scenes,
        })

        logger.info("Job %s: split into %d scenes", job_id, total_scenes)

        # ── Step 2: Generate scene images (sequential) ──
        await _update_job(mongo_db, job_id, {
            "status": "generating_images",
        })

        scene_images: List[Optional[bytes]] = []
        scene_thumbnails: List[str] = []
        minio_client = get_minio()
        progress_per_image = 40.0 / total_scenes  # 5% -> 45%

        for i, scene in enumerate(scenes):
            try:
                img_bytes = await generate_scene_image(
                    scene["description"],
                    cover_image_bytes=cover_image_bytes,
                )
                scene_images.append(img_bytes)

                # Save thumbnail to MinIO
                thumb_object = "mv/thumbnails/{}/{:03d}.png".format(
                    str(job_id), i
                )
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=thumb_object,
                    data=io.BytesIO(img_bytes),
                    length=len(img_bytes),
                    content_type="image/png",
                )
                scene_thumbnails.append(thumb_object)

            except Exception as e:
                logger.warning("Scene %d image generation failed: %s", i, e)
                scene_images.append(None)
                scene_thumbnails.append("")

            # Delay between image requests to avoid Gemini rate limits
            if i < total_scenes - 1:
                await asyncio.sleep(3)

            progress = int(5 + (i + 1) * progress_per_image)
            await _update_job(mongo_db, job_id, {
                "progress": min(progress, 45),
                "scene_thumbnails": scene_thumbnails,
            })

        # Check if enough images were generated
        valid_image_count = sum(1 for img in scene_images if img is not None)
        if valid_image_count < total_scenes * 0.5:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "이미지 생성 실패율이 50%를 초과했습니다. ({}/{} 성공)".format(
                    valid_image_count, total_scenes
                ),
            })
            return

        # ── Step 3 & 4: Generate videos sequentially ──
        await _update_job(mongo_db, job_id, {
            "status": "generating_videos",
            "progress": 45,
        })

        # Process each scene video one at a time to avoid 429 rate limits
        video_paths_map = {}
        completed_count = 0
        consecutive_failures = 0

        for i, (scene, img) in enumerate(zip(scenes, scene_images)):
            if img is None:
                continue

            try:
                video_path = await _generate_single_scene_video(
                    scene, i, img, tmpdir
                )
            except _QuotaExhaustedError as e:
                logger.error("Job %s: Quota exhausted at scene %d: %s", job_id, i, e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": (
                        "API 할당량이 소진되었습니다. 잠시 후 다시 시도해주세요. "
                        "({}/{} 씬 완료)".format(completed_count, total_scenes)
                    ),
                    "completed_scenes": completed_count,
                })
                return

            if video_path:
                video_paths_map[i] = video_path
                completed_count += 1
                consecutive_failures = 0

                # Breathing room for API before next scene
                await asyncio.sleep(15)
            else:
                consecutive_failures += 1
                # If 3 scenes in a row fail, likely quota issue — stop early
                if consecutive_failures >= 3:
                    logger.error(
                        "Job %s: %d consecutive failures, stopping early", job_id, consecutive_failures
                    )
                    await _update_job(mongo_db, job_id, {
                        "status": "failed",
                        "error_message": (
                            "연속 {}개 씬 실패 — API 할당량 소진 추정. "
                            "잠시 후 다시 시도해주세요. ({}/{} 씬 완료)".format(
                                consecutive_failures, completed_count, total_scenes
                            )
                        ),
                        "completed_scenes": completed_count,
                    })
                    return

            # Update progress: 45-85% range
            progress = int(45 + (completed_count / valid_image_count) * 40)
            await _update_job(mongo_db, job_id, {
                "progress": min(progress, 85),
                "completed_scenes": completed_count,
            })

        logger.info(
            "Job %s: %d/%d videos completed", job_id, completed_count, total_scenes
        )

        # Check if enough videos succeeded (30% minimum, at least 3)
        if completed_count < max(total_scenes * 0.3, 3):
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "비디오 생성 실패율이 70%를 초과했습니다. ({}/{} 성공)".format(
                    completed_count, total_scenes
                ),
            })
            return

        if completed_count == 0:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "모든 장면의 비디오 생성에 실패했습니다.",
            })
            return

        # Sort video paths by scene index
        ordered_video_paths = [
            video_paths_map[idx]
            for idx in sorted(video_paths_map.keys())
        ]

        # ── Step 5 & 6: Concatenate videos ──
        await _update_job(mongo_db, job_id, {
            "status": "concatenating",
            "progress": 90,
        })

        if not _ffmpeg_available():
            # If only one video, skip concat
            if len(ordered_video_paths) == 1:
                final_video_path = ordered_video_paths[0]
            else:
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "ffmpeg가 설치되어 있지 않아 비디오를 합칠 수 없습니다.",
                })
                return
        elif len(ordered_video_paths) == 1:
            final_video_path = ordered_video_paths[0]
        else:
            final_video_path = os.path.join(tmpdir, "final_output.mp4")
            try:
                await concatenate_videos(ordered_video_paths, final_video_path)
            except Exception as e:
                logger.error("Concatenation failed: %s", e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "비디오 합치기 실패: {}".format(str(e)[:300]),
                })
                return

        await _update_job(mongo_db, job_id, {"progress": 95})

        # ── Step 7: Upload final video to MinIO ──
        final_object_name = "mv/generated/{}/{}.mp4".format(
            str(job_id), "final"
        )

        with open(final_video_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=final_object_name,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "completed",
            "progress": 100,
            "completed_scenes": completed_count,
            "result_video_url": final_object_name,
        })

        logger.info("Job %s: MV pipeline completed successfully", job_id)

    except Exception as e:
        logger.error("MV pipeline unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "예상치 못한 오류가 발생했습니다: {}".format(str(e)[:300]),
        })

    finally:
        # Clean up temp directory
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
