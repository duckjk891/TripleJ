"""
Kling Video Generation Service.

Uses Kling API (api.klingai.com) for image-to-video generation.
JWT-based authentication with HS256 signing.
"""

import base64
import logging
import time
from typing import Optional

import httpx
import jwt

from ..config import settings

logger = logging.getLogger(__name__)

# ── API URLs ──────────────────────────────────────────────────────────────────

KLING_BASE_URL = "https://api.klingai.com"
KLING_IMAGE2VIDEO_URL = "{}/v1/videos/image2video".format(KLING_BASE_URL)


# ── JWT Token Generation ─────────────────────────────────────────────────────


def _generate_jwt_token(access_key: str, secret_key: str) -> str:
    """Generate a JWT token for Kling API authentication.

    Token is valid for 30 minutes (1800 seconds).
    """
    now = int(time.time())
    payload = {
        "iss": access_key,
        "exp": now + 1800,
        "nbf": now - 5,
    }
    headers = {
        "alg": "HS256",
        "typ": "JWT",
    }
    token = jwt.encode(payload, secret_key, algorithm="HS256", headers=headers)
    # PyJWT < 2.0 returns bytes, newer versions return str
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token


def _get_auth_header() -> dict:
    """Get Authorization header with JWT token."""
    token = _generate_jwt_token(
        settings.kling_access_key,
        settings.kling_secret_key,
    )
    return {"Authorization": "Bearer {}".format(token)}


# ── Start Scene Video (Kling) ────────────────────────────────────────────────


async def start_scene_video_kling(
    prompt: str,
    image_bytes: Optional[bytes] = None,
) -> str:
    """Start image-to-video generation via Kling API.

    Returns task_id for status polling.
    """
    if not settings.kling_access_key or not settings.kling_secret_key:
        raise ValueError("Kling API 키가 설정되지 않았습니다.")

    video_prompt = "{}, smooth cinematic camera movement".format(prompt)

    body = {
        "model_name": "kling-v3",
        "prompt": video_prompt,
        "mode": "std",
        "duration": "10",
    }

    if image_bytes:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        body["image"] = image_b64

    headers = _get_auth_header()
    headers["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            KLING_IMAGE2VIDEO_URL,
            headers=headers,
            json=body,
        )

    if resp.status_code == 429:
        raise ValueError("Kling API 429: 할당량 초과")

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Kling API 오류 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    task_id = data.get("data", {}).get("task_id")
    if not task_id:
        raise ValueError(
            "Kling 응답에서 task_id를 찾을 수 없습니다: {}".format(
                str(data)[:300]
            )
        )

    logger.info("Kling accepted: task_id=%s", task_id)
    return task_id


# ── Check Scene Video Status (Kling) ─────────────────────────────────────────


async def check_scene_video_status_kling(task_id: str) -> dict:
    """Check Kling video generation status.

    Returns {"done": bool, "video_url": str or None, "error": str or None}
    """
    url = "{}/v1/videos/image2video/{}".format(KLING_BASE_URL, task_id)
    headers = _get_auth_header()

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)

    if resp.status_code != 200:
        return {
            "done": True,
            "video_url": None,
            "error": "상태 확인 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            ),
        }

    data = resp.json()
    task_data = data.get("data", {})
    task_status = task_data.get("task_status", "")

    if task_status == "submitted" or task_status == "processing":
        return {"done": False, "video_url": None, "error": None}

    if task_status == "succeed":
        task_result = task_data.get("task_result", {})
        videos = task_result.get("videos", [])
        if videos:
            video_url = videos[0].get("url")
            if video_url:
                return {"done": True, "video_url": video_url, "error": None}

        return {
            "done": True,
            "video_url": None,
            "error": "생성된 비디오 URL을 찾을 수 없습니다.",
        }

    if task_status == "failed":
        return {
            "done": True,
            "video_url": None,
            "error": "Kling 비디오 생성 실패: {}".format(
                task_data.get("task_status_msg", "알 수 없는 오류")
            ),
        }

    # Unknown status — treat as not done
    return {"done": False, "video_url": None, "error": None}


# ── Download Video (Kling) ────────────────────────────────────────────────────


async def download_video_kling(video_url: str) -> bytes:
    """Download video from Kling's URL. Returns mp4 bytes."""

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(video_url)

    if resp.status_code != 200:
        raise ValueError(
            "Kling 비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )

    return resp.content
