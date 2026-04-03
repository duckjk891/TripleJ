import asyncio
import logging
import httpx
from ..config import settings

logger = logging.getLogger(__name__)

LALAL_API_BASE = "https://www.lalal.ai"


async def enhance_vocal_lalal(audio_bytes: bytes, file_name: str = "input.wav") -> bytes:
    """Process audio through LALAL.AI Voice Cleaner API."""
    if not settings.lalal_api_key:
        raise ValueError("LALAL_API_KEY가 설정되지 않았습니다.")

    headers = {
        "X-License-Key": settings.lalal_api_key,
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Step 1: Upload file
        upload_headers = {
            **headers,
            "Content-Disposition": 'attachment; filename="{}"'.format(file_name),
            "Content-Type": "application/octet-stream",
        }
        resp = await client.post(
            "{}/api/v1/upload/".format(LALAL_API_BASE),
            headers=upload_headers,
            content=audio_bytes,
        )
        resp.raise_for_status()
        upload_result = resp.json()
        source_id = upload_result.get("id")
        if not source_id:
            raise ValueError("LALAL.AI upload failed: no source id returned. Response: {}".format(str(upload_result)[:300]))

        logger.info("LALAL.AI: uploaded file, source_id=%s", source_id)

        # Step 2: Start voice_clean split
        split_body = {
            "source_id": source_id,
            "presets": {
                "stem": "voice",
                "noise_cancelling_level": 2,
                "dereverb_enabled": True,
            },
        }
        split_resp = await client.post(
            "{}/api/v1/split/voice_clean/".format(LALAL_API_BASE),
            headers={**headers, "Content-Type": "application/json"},
            json=split_body,
        )
        split_resp.raise_for_status()
        split_result = split_resp.json()
        task_id = split_result.get("task_id") or split_result.get("id") or source_id

        logger.info("LALAL.AI: voice_clean started, task_id=%s", task_id)

        # Step 3: Poll for completion
        for attempt in range(120):
            await asyncio.sleep(5)
            check_resp = await client.post(
                "{}/api/v1/check/".format(LALAL_API_BASE),
                headers={**headers, "Content-Type": "application/json"},
                json={"task_ids": [task_id]},
            )
            check_resp.raise_for_status()
            check_result = check_resp.json()

            # Response format: {"result": {"task_id": {"status": "...", ...}}}
            task_data = check_result.get("result", {}).get(task_id, {})
            status = task_data.get("status", "")

            if status == "success":
                break
            elif status in ("error", "cancelled", "server_error"):
                error = task_data.get("error", {}).get("detail", "Unknown error")
                raise ValueError("LALAL.AI processing failed: {}".format(error))

            progress = task_data.get("progress", 0)
            logger.info("LALAL.AI: polling attempt %d, status=%s, progress=%s", attempt + 1, status, progress)
        else:
            raise TimeoutError("LALAL.AI processing timed out")

        # Step 4: Download result
        # Response format: result.tracks = [{"type": "stem"|"back", "label": "...", "url": "..."}]
        tracks = task_data.get("result", {}).get("tracks", [])

        download_url = None
        for track in tracks:
            if track.get("type") == "stem":
                download_url = track.get("url")
                break

        # Fallback: take the first track with a URL
        if not download_url:
            for track in tracks:
                url = track.get("url")
                if url:
                    download_url = url
                    break

        if not download_url:
            logger.warning("LALAL.AI: No download URL found. task_data: %s", str(task_data)[:500])
            raise ValueError("LALAL.AI: Could not find download URL in response: {}".format(str(task_data)[:500]))

        dl_resp = await client.get(download_url)
        dl_resp.raise_for_status()

        logger.info("LALAL.AI: downloaded enhanced audio (%d bytes)", len(dl_resp.content))
        return dl_resp.content
