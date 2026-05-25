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

KLING_BASE_URL = "https://api-singapore.klingai.com"
KLING_OMNI_VIDEO_URL = "{}/v1/videos/omni-video".format(KLING_BASE_URL)


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
    prev_scene_image_bytes: Optional[bytes] = None,
    character_image_bytes: Optional[bytes] = None,
    lyrics_segment: str = None,
    scene_type: str = "drama",
    duration: float = 10.0,
    video_prompt: Optional[str] = None,
    description: Optional[str] = None,
) -> str:
    """Start image-to-video generation via Kling Omni Video API.

    Uses image_list at top level (no input wrapper).
    - image_bytes: current scene image as first_frame (auto-applied, no prompt ref)
    - prev_scene_image_bytes: previous scene image for continuity (<<<image_1>>>)
    - character_image_bytes: character sheet for consistency (<<<image_2>>> or <<<image_1>>>)

    Returns task_id for status polling.
    """
    if not settings.kling_access_key or not settings.kling_secret_key:
        raise ValueError("Kling API 키가 설정되지 않았습니다.")

    # v67: Kling 공식 권장 6단계 구조 — Subject → Detail → Movement → Scene → Camera → Lighting
    # 각 슬롯을 sentence-level 로 분리해서 모델이 명확히 인식하도록.

    # [Reference 슬롯] first_frame 은 자동 적용 — non-first_frame ref 만 <<<image_N>>> 색인.
    ref_parts = []
    if prev_scene_image_bytes:
        ref_parts.append("Maintain visual continuity with the previous scene shown in <<<image_1>>>.")
    if character_image_bytes:
        img_idx = 2 if prev_scene_image_bytes else 1
        ref_parts.append("The character in <<<image_{}>>> must appear prominently, maintaining exact appearance.".format(img_idx))
    ref_text = " ".join(ref_parts)

    # 슬롯 텍스트
    subject_detail = (prompt or "").strip()                # [Subject + Detail] — image_prompt
    desc_clean = (description or "").strip()
    movement = "Subject action: {}.".format(desc_clean) if desc_clean else ""
    camera_line = "Camera: {}.".format(video_prompt.strip()) if video_prompt and video_prompt.strip() else "Camera: Smooth cinematic camera movement."
    # Lighting — image_prompt 안의 light 어휘에 의존 (별도 슬롯 비움 가능). 명시 구문은 안전 정책상 안전 어휘만.

    mv_context = "A cinematic music video scene."  # 짧게 + sentence 분리

    if scene_type == "lipsync" and lyrics_segment:
        # Lipsync — 가사 sync + 단일 인물 강조 (Kling 모델 특화). 안전 어휘 유지.
        final_prompt = (
            "{ctx} "
            "Subject: {subject} "
            "{ref} "
            "Action: ONLY the main character appears in this scene; no other people. "
            "The main character softly mouths these lyrics with synchronized lip movements: \"{lyrics}\". "
            "{camera}"
        ).format(
            ctx=mv_context,
            subject=subject_detail,
            ref=ref_text,
            lyrics=lyrics_segment,
            camera=camera_line,
        ).strip()
    else:
        # Drama — 6 슬롯 명시 (Lighting 은 image_prompt 안에 포함된 어휘에 의존)
        movement_line = movement if movement else ""
        final_prompt = (
            "{ctx} "
            "Subject: {subject} "
            "{ref} "
            "{movement} "
            "{camera}"
        ).format(
            ctx=mv_context,
            subject=subject_detail,
            ref=ref_text,
            movement=movement_line,
            camera=camera_line,
        ).strip()
        # 연속 공백 정리
        import re as _re
        final_prompt = _re.sub(r"\s{2,}", " ", final_prompt)

    logger.info(
        "[KlingProm] subject_len=%d movement_len=%d camera_len=%d ref_len=%d type=%s",
        len(subject_detail), len(desc_clean), len(camera_line), len(ref_text), scene_type,
    )

    # Build image_list (TOP LEVEL, no "input" wrapper)
    image_list = []

    # 1. Current scene image -> first_frame (video start frame, auto-applied)
    if image_bytes:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        image_list.append({
            "image_url": "{}".format(image_b64),
            "type": "first_frame",
        })

    # 2. Previous scene image -> reference (no type) -> <<<image_1>>>
    if prev_scene_image_bytes:
        prev_b64 = base64.b64encode(prev_scene_image_bytes).decode("utf-8")
        image_list.append({
            "image_url": "{}".format(prev_b64),
        })

    # 3. Character sheet -> reference (no type) -> <<<image_2>>> or <<<image_1>>>
    if character_image_bytes:
        char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
        image_list.append({
            "image_url": "{}".format(char_b64),
        })

    # Kling duration: 3~15초, 정수 문자열
    kling_duration = max(3, min(15, int(round(duration))))

    body = {
        "model_name": "kling-v3-omni",
        "prompt": final_prompt,
        "mode": "pro",
        "duration": str(kling_duration),
        "aspect_ratio": "16:9",
        "sound": "off",
    }

    if image_list:
        body["image_list"] = image_list  # TOP LEVEL, no "input" wrapper

    headers = _get_auth_header()
    headers["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            KLING_OMNI_VIDEO_URL,
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
    url = "{}/v1/videos/omni-video/{}".format(KLING_BASE_URL, task_id)
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
