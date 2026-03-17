"""
AI Music Video Generator using Google Veo 2 REST API.
Generates music videos from cover images and song metadata.

Uses httpx to call the Veo 2 API directly (avoids google-genai SDK
which requires Python >= 3.9).
"""
import base64

import httpx

from ..config import settings

VEO2_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "veo-2.0-generate-001:predictLongRunning"
)

VEO2_OPERATION_URL = (
    "https://generativelanguage.googleapis.com/v1beta/{}"
)


async def start_mv_generation(
    title: str,
    genre: str = None,
    mood: str = None,
) -> str:
    """Start Veo 2 video generation (text-to-video). Returns operation_name.

    Note: Veo 2 does not support image input (inlineData/fileUri).
    The cover image context is incorporated into the text prompt instead.
    """

    # Build prompt
    prompt_parts = [
        "Create a cinematic music video visual for the song titled \"{}\".".format(title),
    ]
    if genre:
        prompt_parts.append("Genre: {}.".format(genre))
    if mood:
        prompt_parts.append("Mood/atmosphere: {}.".format(mood))
    prompt_parts.append(
        "The video should have smooth, cinematic camera movements and "
        "visually striking abstract or scenic imagery that matches the "
        "music's feel. Do NOT show any human faces or people."
    )

    prompt = " ".join(prompt_parts)

    payload = {
        "instances": [
            {
                "prompt": prompt,
            }
        ],
        "parameters": {
            "aspectRatio": "16:9",
            "durationSeconds": 8,
            "personGeneration": "dont_allow",
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            VEO2_GENERATE_URL,
            headers={"x-goog-api-key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Veo 2 API error (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    operation_name = data.get("name")
    if not operation_name:
        raise ValueError("Veo 2 응답에서 operation name을 찾을 수 없습니다.")

    return operation_name


async def check_mv_status(operation_name: str) -> dict:
    """Check generation status.

    Returns {"done": bool, "video_uri": str or None, "error": str or None}
    """
    url = VEO2_OPERATION_URL.format(operation_name)

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

    # Check for error in response
    error = data.get("error")
    if error:
        return {
            "done": True,
            "video_uri": None,
            "error": error.get("message", "알 수 없는 오류가 발생했습니다."),
        }

    # Extract video URI
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
