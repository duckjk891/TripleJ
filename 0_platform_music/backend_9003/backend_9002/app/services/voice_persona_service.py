"""Voice Persona creation service using Suno API 4-step workflow.

Steps:
1. Upload user's voice file to Suno file storage
2. upload-cover API: generate AI cover song reflecting user's voice tone
3. vocal-removal API: extract vocal stem from the cover
4. generate-persona API: create Suno Persona from extracted vocal
"""
import asyncio
import io
import logging
import os
from datetime import datetime, timedelta

import httpx

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)

SUNO_FILE_UPLOAD_URL = "https://sunoapiorg.redpandaai.co/api/file-stream-upload"
CALLBACK_PLACEHOLDER = "https://placeholder.invalid/callback"


async def _update_persona_status(
    mongo_db, persona_id: str, status: str, progress: int, extra: dict = None
):
    """Update voice persona status in MongoDB."""
    from bson import ObjectId

    update = {
        "status": status,
        "progress": progress,
        "updated_at": datetime.utcnow(),
    }
    if extra:
        update.update(extra)
    await mongo_db.voice_personas.update_one(
        {"_id": ObjectId(persona_id)},
        {"$set": update},
    )


async def _poll_suno_task(task_id: str, headers: dict, base_url: str, max_polls: int = 120, interval: int = 5):
    """Poll Suno API for task completion. Returns the full response data on success."""
    consecutive_errors = 0
    for attempt in range(max_polls):
        await asyncio.sleep(interval)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    "{}/api/v1/generate/record-info".format(base_url),
                    headers=headers,
                    params={"taskId": task_id},
                )
                resp.raise_for_status()
                data = resp.json()
            consecutive_errors = 0
        except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
            consecutive_errors += 1
            logger.warning("Poll attempt %d for task %s failed: %s", attempt + 1, task_id, e)
            if consecutive_errors >= 5:
                raise ValueError("Suno API 연속 {} 회 연결 실패: {}".format(consecutive_errors, str(e)[:200]))
            continue

        task_data = data.get("data") or {}
        status = task_data.get("status", "")
        error_msg = task_data.get("errorMessage", "")

        if status == "SUCCESS":
            return task_data
        if "FAILED" in status:
            raise ValueError(
                "Suno task {} failed: {}".format(task_id, error_msg or status)
            )

    raise TimeoutError("Suno task {} timed out after {}s".format(task_id, max_polls * interval))


async def create_voice_persona(
    persona_doc_id: str,
    user_id: str,
    source_audio_object: str,
    name: str,
    description: str,
    mongo_db,
):
    """Execute the 4-step voice persona creation workflow."""
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    base_url = settings.suno_api_url.rstrip("/")
    headers = {
        "Authorization": "Bearer {}".format(settings.suno_api_key),
        "Content-Type": "application/json",
    }
    minio_client = get_minio()

    try:
        # ── Step 1: Upload audio to Suno file storage ──
        await _update_persona_status(mongo_db, persona_doc_id, "uploading", 5)

        # Download audio from MinIO
        resp_minio = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=source_audio_object,
        )
        audio_bytes = resp_minio.read()
        resp_minio.close()
        resp_minio.release_conn()

        # Upload to Suno file storage
        file_ext = os.path.splitext(source_audio_object)[1] or ".mp3"
        file_name = "voice_{}{}".format(persona_doc_id, file_ext)

        mime_map = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
            ".flac": "audio/flac",
        }
        mime_type = mime_map.get(file_ext, "audio/mpeg")

        async with httpx.AsyncClient(timeout=120) as client:
            upload_resp = await client.post(
                SUNO_FILE_UPLOAD_URL,
                headers={"Authorization": "Bearer {}".format(settings.suno_api_key)},
                files={"file": (file_name, audio_bytes, mime_type)},
                data={"uploadPath": "voice-personas", "fileName": file_name},
            )
            upload_resp.raise_for_status()
            upload_result = upload_resp.json()

        if upload_result.get("code") != 200:
            raise ValueError("Suno 파일 업로드 오류: {}".format(upload_result.get("msg", "Unknown")))

        suno_file_url = (
            upload_result["data"].get("fileUrl")
            or upload_result["data"].get("downloadUrl")
        )
        if not suno_file_url:
            raise ValueError("Suno 파일 업로드 응답에서 URL을 찾을 수 없습니다.")

        logger.info("Voice persona %s: audio uploaded to Suno, url=%s", persona_doc_id, suno_file_url[:80])

        # ── Step 2: Upload & Cover ──
        await _update_persona_status(mongo_db, persona_doc_id, "covering", 10)

        cover_body = {
            "uploadUrl": suno_file_url,
            "prompt": description or "A beautiful song in a warm, expressive vocal style",
            "title": "Voice Sample - {}".format(name),
            "style": description or "pop, warm vocal",
            "customMode": True,
            "instrumental": False,
            "model": "V5",
            "callBackUrl": CALLBACK_PLACEHOLDER,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "{}/api/v1/generate/upload-cover".format(base_url),
                headers=headers,
                json=cover_body,
            )
            resp.raise_for_status()
            result = resp.json()

        if result.get("code") != 200:
            raise ValueError("Suno upload-cover 오류: {}".format(result.get("msg", "Unknown")))

        cover_task_id = result["data"]["taskId"]
        await _update_persona_status(
            mongo_db, persona_doc_id, "covering", 20,
            {"cover_task_id": cover_task_id},
        )
        logger.info("Voice persona %s: cover task started, taskId=%s", persona_doc_id, cover_task_id)

        # Poll for cover completion
        cover_data = await _poll_suno_task(cover_task_id, headers, base_url, max_polls=120, interval=5)

        # Extract audio info from cover result
        suno_songs = cover_data.get("response", {}).get("sunoData", [])
        if not suno_songs:
            raise ValueError("Suno cover 결과에서 오디오를 찾을 수 없습니다.")

        # Find first song with a valid audioUrl (some may still be empty)
        cover_audio_url = None
        cover_audio_id = None
        for song in suno_songs:
            url = song.get("audioUrl") or song.get("streamAudioUrl") or ""
            if url:
                cover_audio_url = url
                cover_audio_id = song.get("id")
                break

        if not cover_audio_url:
            raise ValueError("Suno cover 오디오 URL이 없습니다.")

        await _update_persona_status(
            mongo_db, persona_doc_id, "separating", 40,
            {"cover_audio_url": cover_audio_url, "cover_audio_id": cover_audio_id},
        )
        logger.info("Voice persona %s: cover completed, audioId=%s", persona_doc_id, cover_audio_id)

        # ── Step 3: Separate Vocals ──
        # Endpoint: POST /api/v1/vocal-removal/generate
        # Required: taskId, audioId, type, callBackUrl
        separate_body = {
            "taskId": cover_task_id,
            "audioId": cover_audio_id,
            "type": "separate_vocal",
            "callBackUrl": CALLBACK_PLACEHOLDER,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "{}/api/v1/vocal-removal/generate".format(base_url),
                headers=headers,
                json=separate_body,
            )
            resp.raise_for_status()
            result = resp.json()

        if result.get("code") != 200:
            raise ValueError("Suno vocal-removal 오류: {}".format(result.get("msg", "Unknown")))

        separate_task_id = result["data"]["taskId"]
        await _update_persona_status(
            mongo_db, persona_doc_id, "separating", 50,
            {"separate_task_id": separate_task_id},
        )
        logger.info("Voice persona %s: vocal separation started, taskId=%s", persona_doc_id, separate_task_id)

        # Poll for separation completion
        # vocal-removal has its own record-info endpoint and uses successFlag instead of status
        vocal_url = None
        for _attempt in range(60):
            await asyncio.sleep(5)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    "{}/api/v1/vocal-removal/record-info".format(base_url),
                    headers=headers,
                    params={"taskId": separate_task_id},
                )
                resp.raise_for_status()
                sep_result = resp.json()

            sep_data = sep_result.get("data")
            if not sep_data:
                continue

            flag = sep_data.get("successFlag", "")
            if flag == "SUCCESS":
                sep_response = sep_data.get("response") or {}
                vocal_url = sep_response.get("vocalUrl") or sep_response.get("vocal_url")
                break
            if "FAILED" in flag:
                raise ValueError("보컬 분리 실패: {}".format(flag))

        if not vocal_url:
            # timeout
            pass

        if not vocal_url:
            raise ValueError("보컬 분리 결과에서 보컬 URL을 찾을 수 없습니다.")

        await _update_persona_status(
            mongo_db, persona_doc_id, "creating_persona", 70,
            {"vocal_audio_url": vocal_url},
        )
        logger.info("Voice persona %s: vocal separation completed", persona_doc_id)

        # ── Save vocal & cover audio to MinIO for persistent storage ──
        vocal_object_name = "voice-personas/{}/{}/vocal.mp3".format(user_id, persona_doc_id)
        cover_object_name = "voice-personas/{}/{}/cover.mp3".format(user_id, persona_doc_id)

        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as dl_client:
            # Download and store vocal audio
            try:
                vocal_resp = await dl_client.get(vocal_url)
                vocal_resp.raise_for_status()
                vocal_bytes = vocal_resp.content
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=vocal_object_name,
                    data=io.BytesIO(vocal_bytes),
                    length=len(vocal_bytes),
                    content_type="audio/mpeg",
                )
                logger.info("Voice persona %s: vocal audio saved to MinIO (%d bytes)", persona_doc_id, len(vocal_bytes))
            except Exception as e:
                logger.warning("Voice persona %s: failed to save vocal to MinIO: %s", persona_doc_id, e)
                vocal_object_name = None

            # Download and store cover audio
            try:
                cover_resp = await dl_client.get(cover_audio_url)
                cover_resp.raise_for_status()
                cover_bytes = cover_resp.content
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=cover_object_name,
                    data=io.BytesIO(cover_bytes),
                    length=len(cover_bytes),
                    content_type="audio/mpeg",
                )
                logger.info("Voice persona %s: cover audio saved to MinIO (%d bytes)", persona_doc_id, len(cover_bytes))
            except Exception as e:
                logger.warning("Voice persona %s: failed to save cover to MinIO: %s", persona_doc_id, e)
                cover_object_name = None

        # Save object names to MongoDB
        minio_extra = {}
        if vocal_object_name:
            minio_extra["vocal_object_name"] = vocal_object_name
        if cover_object_name:
            minio_extra["cover_object_name"] = cover_object_name
        if minio_extra:
            await _update_persona_status(
                mongo_db, persona_doc_id, "creating_persona", 75, minio_extra,
            )

        # ── Step 4: Generate Persona ──
        # Required: taskId, audioId, name, description
        persona_body = {
            "taskId": cover_task_id,
            "audioId": cover_audio_id,
            "name": name[:50],
            "description": (description or name)[:200],
            "vocalStart": 0,
            "vocalEnd": 30,
            "style": description or "warm vocal",
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "{}/api/v1/generate/generate-persona".format(base_url),
                headers=headers,
                json=persona_body,
            )
            resp.raise_for_status()
            result = resp.json()

        if result.get("code") != 200:
            raise ValueError("Suno generate-persona 오류: {}".format(result.get("msg", "Unknown")))

        persona_result = result.get("data", {})
        suno_persona_id = persona_result.get("personaId") or persona_result.get("persona_id")

        if not suno_persona_id:
            # Some API versions return taskId for async persona creation
            persona_task_id = persona_result.get("taskId")
            if persona_task_id:
                await _update_persona_status(
                    mongo_db, persona_doc_id, "creating_persona", 85,
                    {"persona_task_id": persona_task_id},
                )
                persona_data = await _poll_suno_task(persona_task_id, headers, base_url, max_polls=60, interval=5)
                suno_persona_id = (
                    persona_data.get("response", {}).get("personaId")
                    or persona_data.get("response", {}).get("persona_id")
                    or persona_data.get("personaId")
                )

        if not suno_persona_id:
            raise ValueError("Persona ID를 얻지 못했습니다.")

        # ── Success ──
        await _update_persona_status(
            mongo_db, persona_doc_id, "completed", 100,
            {
                "persona_id": suno_persona_id,
                "completed_at": datetime.utcnow(),
            },
        )
        logger.info("Voice persona %s: COMPLETED, personaId=%s", persona_doc_id, suno_persona_id)

    except Exception as e:
        error_msg = str(e) or repr(e) or type(e).__name__
        logger.error("Voice persona %s: FAILED — %s", persona_doc_id, error_msg)
        import traceback
        traceback.print_exc()
        await _update_persona_status(
            mongo_db, persona_doc_id, "failed", 0,
            {"error_message": error_msg[:500]},
        )
