"""
Sync Labs Lip Sync Service.
Generates lip-synced videos using Sync Labs API.
"""
import asyncio
import io
import logging
import os
import subprocess
import tempfile
import uuid
from datetime import timedelta

import httpx

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)


def _get_ngrok_url() -> str:
    """Get the current ngrok public URL if running."""
    try:
        import requests
        resp = requests.get("http://localhost:4040/api/tunnels", timeout=3)
        tunnels = resp.json().get("tunnels", [])
        for t in tunnels:
            if t.get("public_url", "").startswith("https://"):
                return t["public_url"]
        return tunnels[0]["public_url"] if tunnels else ""
    except Exception:
        return ""


def _get_public_minio_client():
    """Get a MinIO client configured with ngrok public URL for presigned URLs."""
    from minio import Minio
    ngrok_url = _get_ngrok_url()
    if not ngrok_url:
        return None
    # Extract host from https://xxx.ngrok-free.dev
    host = ngrok_url.replace("https://", "").replace("http://", "")
    return Minio(host, access_key="aimu_minio_admin", secret_key="aimu_minio_pass_2024", secure=True)


def _presign_public(bucket: str, object_name: str) -> str:
    """Generate a publicly accessible presigned URL using ngrok MinIO client."""
    from datetime import timedelta
    public_client = _get_public_minio_client()
    if public_client:
        return public_client.presigned_get_object(bucket, object_name, expires=timedelta(hours=1))
    # Fallback: local presigned URL (won't work externally)
    minio_client = get_minio()
    return minio_client.presigned_get_object(bucket, object_name, expires=timedelta(hours=1))


async def generate_lipsync(
    image_bytes: bytes,
    audio_bytes: bytes,
    model: str = "lipsync-2",
) -> bytes:
    """Generate lip-synced video from a face image and audio.

    1. Convert image to short still video (ffmpeg)
    2. Upload image video and audio to temporary public URLs
    3. Call Sync Labs API to generate lip sync
    4. Poll for completion
    5. Download and return result video bytes

    Returns video bytes (mp4).
    """
    if not settings.sync_api_key:
        raise ValueError("SYNC_API_KEY가 설정되지 않았습니다.")

    os.environ["SYNC_API_KEY"] = settings.sync_api_key

    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Save image and create still video
        image_path = os.path.join(tmpdir, "face.png")
        video_path = os.path.join(tmpdir, "face_video.mp4")
        audio_path = os.path.join(tmpdir, "audio.mp3")

        with open(image_path, "wb") as f:
            f.write(image_bytes)
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        # Get audio duration
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            capture_output=True, text=True, timeout=30,
        )
        audio_duration = float(probe.stdout.strip()) if probe.stdout.strip() else 10.0

        # Convert image to still video (same duration as audio)
        subprocess.run(
            ["ffmpeg", "-y", "-loop", "1", "-i", image_path,
             "-t", str(audio_duration),
             "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
             "-r", "25", video_path],
            capture_output=True, timeout=60,
        )

        if not os.path.exists(video_path):
            raise RuntimeError("Failed to create still video from image")

        logger.info("SyncLabs: created still video (%.1fs) from image", audio_duration)

        # Step 2: Upload to MinIO for public URLs
        minio_client = get_minio()
        job_id = uuid.uuid4().hex[:12]

        video_object = "sync-temp/{}/input.mp4".format(job_id)
        audio_object = "sync-temp/{}/audio.mp3".format(job_id)

        with open(video_path, "rb") as f:
            video_bytes_data = f.read()
        with open(audio_path, "rb") as f:
            audio_bytes_read = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=video_object,
            data=io.BytesIO(video_bytes_data),
            length=len(video_bytes_data),
            content_type="video/mp4",
        )
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object,
            data=io.BytesIO(audio_bytes_read),
            length=len(audio_bytes_read),
            content_type="audio/mpeg",
        )

        # Generate publicly accessible presigned URLs via ngrok
        video_url = _presign_public(settings.minio_bucket_music, video_object)
        audio_url = _presign_public(settings.minio_bucket_music, audio_object)

        logger.info("SyncLabs: video_url=%s", video_url[:100])
        logger.info("SyncLabs: audio_url=%s", audio_url[:100])

        # Step 3: Call Sync Labs API
        try:
            from sync import Sync
            from sync.common import Audio, GenerationOptions, Video

            sync_client = Sync()

            response = sync_client.generations.create(
                input=[
                    Video(url=video_url),
                    Audio(url=audio_url),
                ],
                model=model,
                options=GenerationOptions(sync_mode="cut_off"),
            )

            sync_job_id = response.id
            logger.info("SyncLabs: job created, id=%s", sync_job_id)

        except Exception as e:
            logger.error("SyncLabs: failed to create job: %s", e)
            raise ValueError("Sync Labs 립싱크 생성 실패: {}".format(str(e)[:300]))

        # Step 4: Poll for completion
        output_url = None
        loop = asyncio.get_event_loop()
        for attempt in range(120):  # 10 min timeout
            await asyncio.sleep(10)

            try:
                generation = await loop.run_in_executor(
                    None, lambda: sync_client.generations.get(sync_job_id)
                )
                status = generation.status

                if status == "COMPLETED":
                    output_url = generation.output_url
                    logger.info(
                        "SyncLabs: job %s completed, output=%s",
                        sync_job_id, output_url[:100] if output_url else "None",
                    )
                    break
                elif status in ("FAILED", "REJECTED"):
                    raise ValueError("Sync Labs 립싱크 실패: status={}".format(status))

                logger.info("SyncLabs: polling attempt %d, status=%s", attempt + 1, status)

            except Exception as e:
                if "실패" in str(e):
                    raise
                logger.warning("SyncLabs: poll error (attempt %d): %s", attempt + 1, e)
        else:
            raise TimeoutError("Sync Labs 립싱크 시간 초과 (10분)")

        # Step 5: Download result
        if not output_url:
            raise ValueError("Sync Labs: no output URL in completed response")

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            dl_resp = await client.get(output_url)
            dl_resp.raise_for_status()
            result_bytes = dl_resp.content

        logger.info("SyncLabs: downloaded result video (%d bytes)", len(result_bytes))

        # Cleanup temp files from MinIO
        try:
            minio_client.remove_object(settings.minio_bucket_music, video_object)
            minio_client.remove_object(settings.minio_bucket_music, audio_object)
        except Exception:
            pass

        return result_bytes


async def generate_lipsync_from_video(
    video_bytes: bytes,
    audio_bytes: bytes,
    model: str = "lipsync-2",
) -> bytes:
    """Generate lip-synced video from an existing video and audio.

    Unlike generate_lipsync() which starts from a static image,
    this takes an already-animated video (e.g., from Veo) and
    corrects the lip movements to match the actual audio.

    Returns video bytes (mp4).
    """
    if not settings.sync_api_key:
        raise ValueError("SYNC_API_KEY가 설정되지 않았습니다.")

    os.environ["SYNC_API_KEY"] = settings.sync_api_key

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        audio_path = os.path.join(tmpdir, "audio.mp3")

        with open(video_path, "wb") as f:
            f.write(video_bytes)
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        # Upload to MinIO for public URLs
        minio_client = get_minio()
        job_id = uuid.uuid4().hex[:12]

        video_object = "sync-temp/{}/video.mp4".format(job_id)
        audio_object = "sync-temp/{}/audio.mp3".format(job_id)

        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=video_object,
            data=io.BytesIO(video_bytes),
            length=len(video_bytes),
            content_type="video/mp4",
        )
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object,
            data=io.BytesIO(audio_bytes),
            length=len(audio_bytes),
            content_type="audio/mpeg",
        )

        # Generate publicly accessible presigned URLs via ngrok
        video_url = _presign_public(settings.minio_bucket_music, video_object)
        audio_url = _presign_public(settings.minio_bucket_music, audio_object)

        logger.info("SyncLabs (video): video_url=%s", video_url[:100])
        logger.info("SyncLabs (video): audio_url=%s", audio_url[:100])

        # Call Sync Labs API
        try:
            from sync import Sync
            from sync.common import Audio, GenerationOptions, Video

            sync_client = Sync()

            response = sync_client.generations.create(
                input=[
                    Video(url=video_url),
                    Audio(url=audio_url),
                ],
                model=model,
                options=GenerationOptions(sync_mode="cut_off"),
            )

            sync_job_id = response.id
            logger.info("SyncLabs (video): job created, id=%s", sync_job_id)

        except Exception as e:
            logger.error("SyncLabs (video): failed to create job: %s", e)
            raise ValueError("Sync Labs 립싱크 후보정 실패: {}".format(str(e)[:300]))

        # Poll for completion
        loop = asyncio.get_event_loop()
        output_url = None
        for attempt in range(120):
            await asyncio.sleep(10)
            try:
                generation = await loop.run_in_executor(
                    None, lambda: sync_client.generations.get(sync_job_id)
                )
                status = generation.status

                if status == "COMPLETED":
                    output_url = generation.output_url
                    logger.info("SyncLabs (video): job %s completed", sync_job_id)
                    break
                elif status in ("FAILED", "REJECTED"):
                    raise ValueError("Sync Labs 립싱크 후보정 실패: status={}".format(status))

                logger.info("SyncLabs (video): polling attempt %d, status=%s", attempt + 1, status)
            except Exception as e:
                if "실패" in str(e):
                    raise
                logger.warning("SyncLabs (video): poll error (attempt %d): %s", attempt + 1, e)
        else:
            raise TimeoutError("Sync Labs 립싱크 후보정 시간 초과 (20분)")

        if not output_url:
            raise ValueError("Sync Labs: no output URL")

        # Download result
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            dl_resp = await client.get(output_url)
            dl_resp.raise_for_status()
            result_bytes = dl_resp.content

        logger.info("SyncLabs (video): downloaded result (%d bytes)", len(result_bytes))

        # Cleanup temp files
        try:
            minio_client.remove_object(settings.minio_bucket_music, video_object)
            minio_client.remove_object(settings.minio_bucket_music, audio_object)
        except Exception:
            pass

        return result_bytes


def cut_audio_segment(audio_bytes: bytes, start_sec: float, end_sec: float) -> bytes:
    """Cut a segment from audio using ffmpeg. Returns MP3 bytes."""
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "input.mp3")
        output_path = os.path.join(tmpdir, "segment.mp3")

        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-ss", str(start_sec), "-to", str(end_sec),
             "-codec:a", "libmp3lame", "-b:a", "192k",
             output_path],
            capture_output=True, timeout=30,
        )

        if not os.path.exists(output_path):
            raise RuntimeError("Failed to cut audio segment")

        with open(output_path, "rb") as f:
            return f.read()
