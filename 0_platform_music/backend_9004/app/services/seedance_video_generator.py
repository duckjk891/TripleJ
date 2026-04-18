"""
Seedance 2.0 Video Generation Service via fal.ai.
Image-to-video generation using ByteDance's Seedance 2.0 model.
"""

import base64
import logging
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

FAL_API_URL = "https://queue.fal.run/fal-ai/seedance-2/image-to-video"
FAL_STATUS_URL = "https://queue.fal.run/fal-ai/seedance-2/requests/{request_id}/status"
FAL_RESULT_URL = "https://queue.fal.run/fal-ai/seedance-2/requests/{request_id}"


def _get_fal_headers() -> dict:
    return {
        "Authorization": "Key {}".format(settings.fal_api_key),
        "Content-Type": "application/json",
    }


async def start_scene_video_seedance(
    prompt: str,
    image_bytes: Optional[bytes] = None,
    video_prompt: Optional[str] = None,
    lyrics_segment: str = "",
    scene_type: str = "drama",
    duration: float = 10.0,
    audio_bytes: Optional[bytes] = None,
) -> str:
    """Start image-to-video generation via fal.ai Seedance 2.0.
    Returns request_id for status polling.
    """
    if not settings.fal_api_key:
        raise ValueError("fal.ai API 키가 설정되지 않았습니다.")

    # Build prompt
    mv_context = "A cinematic scene from a professional music video. "

    if video_prompt:
        final_prompt = "{}{}Camera/Motion: {}".format(mv_context, prompt + " ", video_prompt)
    elif scene_type == "lipsync" and lyrics_segment:
        final_prompt = "{}{} The character faces the camera and sings: \"{}\". Preserve composition and colors.".format(
            mv_context, prompt, lyrics_segment
        )
    else:
        final_prompt = "{}{} Smooth cinematic camera movement. Preserve composition and colors.".format(
            mv_context, prompt
        )

    # For lipsync scenes with audio, append lip-sync instruction
    if audio_bytes and scene_type == "lipsync":
        final_prompt += " The character sings along to the provided audio with precise lip synchronization. @Audio1"

    body = {
        "prompt": final_prompt,
    }

    # Add image as data URI
    if image_bytes:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        body["image_url"] = "data:image/png;base64,{}".format(image_b64)

    # Add audio as data URI for lipsync
    if audio_bytes:
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        body["audio_url"] = "data:audio/mpeg;base64,{}".format(audio_b64)

    # Duration: Seedance supports up to 15 seconds
    seedance_duration = max(5, min(15, int(round(duration))))
    body["duration"] = seedance_duration

    headers = _get_fal_headers()

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(FAL_API_URL, headers=headers, json=body)

    if resp.status_code == 429:
        raise ValueError("Seedance API 429: 할당량 초과")

    if resp.status_code not in (200, 201, 202):
        raise ValueError("Seedance API 오류 (HTTP {}): {}".format(resp.status_code, resp.text[:300]))

    data = resp.json()
    request_id = data.get("request_id")
    if not request_id:
        raise ValueError("Seedance 응답에서 request_id를 찾을 수 없습니다: {}".format(str(data)[:300]))

    logger.info("Seedance accepted: request_id=%s", request_id)
    return request_id


async def check_scene_video_status_seedance(request_id: str) -> dict:
    """Check Seedance video generation status.
    Returns {"done": bool, "video_url": str or None, "error": str or None}
    """
    url = FAL_STATUS_URL.format(request_id=request_id)
    headers = _get_fal_headers()

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)

    if resp.status_code != 200:
        return {"done": False, "video_url": None, "error": None}

    data = resp.json()
    status = data.get("status", "")

    if status == "IN_QUEUE" or status == "IN_PROGRESS":
        return {"done": False, "video_url": None, "error": None}

    if status == "COMPLETED":
        # Fetch actual result
        result_url = FAL_RESULT_URL.format(request_id=request_id)
        async with httpx.AsyncClient(timeout=30.0) as client:
            result_resp = await client.get(result_url, headers=headers)

        if result_resp.status_code != 200:
            logger.warning("Seedance result fetch failed (HTTP %d): %s", result_resp.status_code, result_resp.text[:500])
            return {"done": True, "video_url": None, "error": f"결과 조회 실패 HTTP {result_resp.status_code}: {result_resp.text[:200]}"}

        result_data = result_resp.json()
        logger.info("Seedance result data (request_id=%s): keys=%s", request_id, list(result_data.keys()))
        logger.info("Seedance result data (full): %s", str(result_data)[:1000])

        # Try multiple known response formats
        # Format 1: { "video": { "url": "..." } }
        video = result_data.get("video", {})
        video_url = video.get("url") if isinstance(video, dict) else None

        # Format 2: { "video_url": "..." }
        if not video_url:
            video_url = result_data.get("video_url")

        # Format 3: { "videos": [{ "url": "..." }] }
        if not video_url:
            videos = result_data.get("videos", [])
            if videos and isinstance(videos, list):
                first = videos[0]
                if isinstance(first, dict):
                    video_url = first.get("url")

        # Format 4: { "output": "..." } or { "output": { "url": "..." } }
        if not video_url:
            output = result_data.get("output")
            if isinstance(output, str):
                video_url = output
            elif isinstance(output, dict):
                video_url = output.get("url")

        if video_url:
            logger.info("Seedance video URL found: %s", video_url[:100])
            return {"done": True, "video_url": video_url, "error": None}

        logger.warning("Seedance: no video URL found in response. Full data: %s", str(result_data)[:2000])
        return {"done": True, "video_url": None, "error": f"비디오 URL을 찾을 수 없습니다. 응답 키: {list(result_data.keys())}"}

    if status == "FAILED":
        return {"done": True, "video_url": None, "error": "Seedance 비디오 생성 실패: {}".format(
            data.get("error", "알 수 없는 오류")
        )}

    return {"done": False, "video_url": None, "error": None}


async def download_video_seedance(video_url: str) -> bytes:
    """Download video from Seedance URL. Returns mp4 bytes."""
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(video_url)

    if resp.status_code != 200:
        raise ValueError("Seedance 비디오 다운로드 실패 (HTTP {})".format(resp.status_code))

    return resp.content
