"""Kits.AI voice conversion service.

Pipeline:
  1. Download Suno output from MinIO
  2. Vocal separation via Kits API
  3. Voice conversion (vocal -> user's voice model) via Kits API
  4. Merge converted vocal + backing track via ffmpeg
  5. Upload result to MinIO
  6. Update MongoDB generation document
"""
import asyncio
import io
import logging
import os
import shutil
import tempfile
from datetime import datetime

import httpx

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)


def _get_ffmpeg_path():
    """Get ffmpeg binary path. Checks PATH, miniconda fallback, then imageio-ffmpeg."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    # Miniconda fallback
    miniconda_path = "/home/duckjk89/miniconda3/bin/ffmpeg"
    if os.path.isfile(miniconda_path):
        return miniconda_path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def _kits_headers():
    """Return authorization headers for Kits API."""
    return {
        "Authorization": f"Bearer {settings.kits_api_key}",
    }


async def _poll_kits_job(job_type: str, job_id: int, mongo_db=None, generation_id: str = None, progress_range: tuple = (0, 100)) -> dict:
    """Poll a Kits API job until success or error.

    job_type: 'vocal-separations' or 'voice-conversions'
    Returns the final job data dict.
    """
    base_url = settings.kits_api_url.rstrip("/")
    headers = _kits_headers()
    url = f"{base_url}/{job_type}/{job_id}"

    start_progress, end_progress = progress_range

    for attempt in range(120):  # 120 * 5s = 10 min max
        await asyncio.sleep(5)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        status = data.get("status", "")

        if status == "success":
            # Update progress to end of range
            if mongo_db is not None and generation_id:
                await _update_vc_progress(mongo_db, generation_id, end_progress, "converting")
            return data

        if status == "error":
            error_msg = data.get("errorMessage", "Unknown error from Kits API")
            raise ValueError(f"Kits {job_type} job {job_id} failed: {error_msg}")

        # Still running — update progress
        if mongo_db is not None and generation_id:
            interp_progress = int(start_progress + (attempt / 120) * (end_progress - start_progress))
            await _update_vc_progress(mongo_db, generation_id, min(interp_progress, end_progress - 1), "converting")

    raise TimeoutError(f"Kits {job_type} job {job_id} timed out after 10 minutes")


async def _update_vc_progress(mongo_db, generation_id: str, progress: int, status: str, extra: dict = None):
    """Update voice conversion progress fields in MongoDB generations collection."""
    from bson import ObjectId
    update = {
        "voice_conversion_status": status,
        "voice_conversion_progress": progress,
        "updated_at": datetime.utcnow(),
    }
    if extra:
        update.update(extra)
    await mongo_db.generations.update_one(
        {"_id": ObjectId(generation_id)},
        {"$set": update},
    )


async def get_voice_models() -> list:
    """Fetch voice models from Kits API."""
    base_url = settings.kits_api_url.rstrip("/")
    headers = _kits_headers()

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "{}/voice-models".format(base_url),
            headers=headers,
            params={"myModels": "true", "perPage": "100"},
        )
        resp.raise_for_status()
        return resp.json()


async def convert_voice(
    generation_id: str,
    voice_model_id: int,
    mongo_db,
    conversion_strength: float = 0.5,
    model_volume_mix: float = 0.5,
    pitch_shift: int = 0,
) -> dict:
    """Full voice conversion pipeline for a generation.

    Steps:
      a. Download Suno output from MinIO
      b. Vocal separation via Kits API
      c. Download separated vocal + backing
      d. Voice conversion on vocal via Kits API
      e. Download converted vocal
      f. Merge converted vocal + backing via ffmpeg
      g. Upload to MinIO
      h. Update MongoDB
    """
    base_url = settings.kits_api_url.rstrip("/")
    headers = _kits_headers()
    tmpdir = tempfile.mkdtemp(prefix="kits_vc_")

    try:
        # ── Step a: Download Suno output from MinIO ──
        await _update_vc_progress(mongo_db, generation_id, 5, "converting")

        minio_client = get_minio()
        source_object = f"generated/{generation_id}/suno_output.mp3"

        try:
            response = minio_client.get_object(
                bucket_name=settings.minio_bucket_music,
                object_name=source_object,
            )
            audio_bytes = response.read()
            response.close()
            response.release_conn()
        except Exception as e:
            raise ValueError(f"MinIO에서 원본 오디오를 다운로드할 수 없습니다: {e}")

        # Save to temp file
        input_path = os.path.join(tmpdir, "input.mp3")
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        logger.info("VC %s: Downloaded source audio (%d bytes)", generation_id, len(audio_bytes))

        # ── Step b: Vocal Separation ──
        await _update_vc_progress(mongo_db, generation_id, 10, "converting")

        sep_job = None
        for _retry in range(3):
            async with httpx.AsyncClient(timeout=120) as client:
                with open(input_path, "rb") as f:
                    files = {"inputFile": ("input.mp3", f, "audio/mpeg")}
                    resp = await client.post(
                        "{}/vocal-separations".format(base_url),
                        headers=headers,
                        files=files,
                    )
                    if resp.status_code == 429:
                        wait = 60 * (_retry + 1)
                        logger.warning("VC %s: 429 rate limit on vocal-separations, waiting %ds", generation_id, wait)
                        await _update_vc_progress(mongo_db, generation_id, 10, "converting",
                            {"voice_conversion_error": "API 요청 제한 (429) — {}초 후 재시도".format(wait)})
                        await asyncio.sleep(wait)
                        continue
                    resp.raise_for_status()
                    sep_job = resp.json()
                    break
        if not sep_job:
            raise ValueError("Kits API 요청 제한(429)으로 보컬 분리를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.")

        sep_job_id = sep_job.get("id")
        logger.info("VC %s: Vocal separation job started, id=%s", generation_id, sep_job_id)

        # Poll separation job (progress 10-35)
        sep_result = await _poll_kits_job(
            "vocal-separations", sep_job_id, mongo_db, generation_id, (10, 35)
        )

        vocal_url = sep_result.get("vocalAudioFileUrl")
        backing_url = sep_result.get("backingAudioFileUrl")

        if not vocal_url or not backing_url:
            raise ValueError("보컬/반주 분리 결과 URL이 없습니다.")

        logger.info("VC %s: Separation done. Downloading vocal + backing...", generation_id)

        # ── Step c: Download separated files ──
        await _update_vc_progress(mongo_db, generation_id, 38, "converting")

        vocal_path = os.path.join(tmpdir, "vocal.wav")
        backing_path = os.path.join(tmpdir, "backing.wav")

        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            vocal_resp = await client.get(vocal_url)
            vocal_resp.raise_for_status()
            with open(vocal_path, "wb") as f:
                f.write(vocal_resp.content)

            backing_resp = await client.get(backing_url)
            backing_resp.raise_for_status()
            with open(backing_path, "wb") as f:
                f.write(backing_resp.content)

        logger.info("VC %s: Downloaded vocal (%d) + backing (%d)",
                     generation_id, len(vocal_resp.content), len(backing_resp.content))

        # ── Step d: Voice Conversion ──
        await _update_vc_progress(mongo_db, generation_id, 42, "converting")

        conv_job = None
        for _retry in range(3):
            async with httpx.AsyncClient(timeout=120) as client:
                with open(vocal_path, "rb") as f:
                    files = {"soundFile": ("vocal.wav", f, "audio/wav")}
                    form_data = {
                        "voiceModelId": str(voice_model_id),
                        "conversionStrength": str(conversion_strength),
                        "modelVolumeMix": str(model_volume_mix),
                        "pitchShift": str(pitch_shift),
                    }
                    resp = await client.post(
                        "{}/voice-conversions".format(base_url),
                        headers=headers,
                        files=files,
                        data=form_data,
                    )
                    if resp.status_code == 429:
                        wait = 60 * (_retry + 1)
                        logger.warning("VC %s: 429 rate limit on voice-conversions, waiting %ds", generation_id, wait)
                        await asyncio.sleep(wait)
                        continue
                    resp.raise_for_status()
                    conv_job = resp.json()
                    break
        if not conv_job:
            raise ValueError("Kits API 요청 제한(429)으로 음성 변환을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.")

        conv_job_id = conv_job.get("id")
        logger.info("VC %s: Voice conversion job started, id=%s", generation_id, conv_job_id)

        # Poll conversion job (progress 42-75)
        conv_result = await _poll_kits_job(
            "voice-conversions", conv_job_id, mongo_db, generation_id, (42, 75)
        )

        converted_vocal_url = conv_result.get("outputFileUrl")
        if not converted_vocal_url:
            raise ValueError("음성 변환 결과 URL이 없습니다.")

        # ── Step e: Download converted vocal ──
        await _update_vc_progress(mongo_db, generation_id, 78, "converting")

        converted_vocal_path = os.path.join(tmpdir, "converted_vocal.wav")
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            cv_resp = await client.get(converted_vocal_url)
            cv_resp.raise_for_status()
            with open(converted_vocal_path, "wb") as f:
                f.write(cv_resp.content)

        logger.info("VC %s: Downloaded converted vocal (%d bytes)", generation_id, len(cv_resp.content))

        # ── Step f: Merge converted vocal + backing via ffmpeg ──
        await _update_vc_progress(mongo_db, generation_id, 82, "merging")

        ffmpeg_bin = _get_ffmpeg_path()
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg가 설치되어 있지 않습니다. 오디오 합치기를 할 수 없습니다.")

        output_path = os.path.join(tmpdir, "voice_converted.mp3")

        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-y",
            "-i", converted_vocal_path,
            "-i", backing_path,
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2[out]",
            "-map", "[out]",
            "-codec:a", "libmp3lame", "-b:a", "192k",
            output_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg 합치기 실패: {stderr.decode()[:500]}")

        logger.info("VC %s: Merged audio via ffmpeg", generation_id)

        # ── Step g: Upload to MinIO ──
        await _update_vc_progress(mongo_db, generation_id, 90, "uploading")

        with open(output_path, "rb") as f:
            result_bytes = f.read()

        result_object = f"generated/{generation_id}/voice_converted.mp3"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=result_object,
            data=io.BytesIO(result_bytes),
            length=len(result_bytes),
            content_type="audio/mpeg",
        )

        # Also save the separated backing track for potential future use
        with open(backing_path, "rb") as f:
            backing_bytes = f.read()
        backing_object = f"generated/{generation_id}/backing.wav"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=backing_object,
            data=io.BytesIO(backing_bytes),
            length=len(backing_bytes),
            content_type="audio/wav",
        )

        logger.info("VC %s: Uploaded result to MinIO: %s", generation_id, result_object)

        # ── Step h: Update MongoDB ──
        await _update_vc_progress(mongo_db, generation_id, 100, "completed", {
            "voice_converted_url": result_object,
            "voice_converted_backing_url": backing_object,
            "voice_model_id": voice_model_id,
            "voice_conversion_completed_at": datetime.utcnow(),
        })

        logger.info("VC %s: Voice conversion pipeline completed", generation_id)
        return {"voice_converted_url": result_object}

    except Exception as e:
        logger.error("VC %s: Pipeline failed: %s", generation_id, e)
        await _update_vc_progress(mongo_db, generation_id, 0, "failed", {
            "voice_conversion_error": str(e)[:500],
        })
        raise

    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
