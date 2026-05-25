"""
v66 — Grok Imagine Video Generation Service (xAI direct API).

xAI 공식 image-to-video endpoint 경유:
  POST https://api.x.ai/v1/videos/generations          → request_id
  GET  https://api.x.ai/v1/videos/{request_id}         → status / video.url

응답:
  status: pending | done | failed | expired
  progress: 0~100
  status=done 시 video.url 임시 (즉시 다운로드 필수)

Seedance/Kling 와 동일 인터페이스 (mv_pipeline 분기에 끼우기 쉬움):
  start_scene_video_grok(...)              -> request_id
  check_scene_video_status_grok(request_id) -> {done, video_url, error}
  download_video_grok(video_url)           -> bytes
"""

import logging
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

XAI_VIDEO_URL = "https://api.x.ai/v1/videos/generations"
XAI_STATUS_URL = "https://api.x.ai/v1/videos/{request_id}"

GROK_MODEL = "grok-imagine-video"


def _get_xai_headers() -> dict:
    if not settings.xai_api_key:
        raise ValueError("xAI API 키가 설정되지 않았습니다. (.env 의 XAI_API_KEY)")
    return {
        "Authorization": "Bearer {}".format(settings.xai_api_key),
        "Content-Type": "application/json",
    }


async def start_scene_video_grok(
    prompt: str,
    image_url: Optional[str] = None,
    video_prompt: Optional[str] = None,
    lyrics_segment: str = "",
    scene_type: str = "drama",
    duration: float = 10.0,
    description: Optional[str] = None,
) -> str:
    """Start image-to-video generation via xAI Grok Imagine Video.

    Args:
        prompt:    image_prompt (cinematic description)
        image_url: 입력 씬 이미지의 접근 가능한 URL (MinIO presigned 등)
        video_prompt: 카메라 모션 텍스트
        lyrics_segment: lipsync 가사
        scene_type: drama | lipsync
        duration:  요청 영상 길이 (초). xAI 한도 10초.
        description: v60 행동/감정/맥락 슬롯

    Returns:
        request_id (status polling 용)
    """
    if not settings.xai_api_key:
        raise ValueError("xAI API 키가 설정되지 않았습니다.")
    if not image_url:
        raise ValueError("Grok image-to-video 는 image_url 이 필요합니다.")

    # v67: Grok 권장 — image-to-video 시 이미지 묘사 X, 모션·카메라·스타일에 집중.
    # 앞 20단어 우선 (Grok 의 attention prior). image_prompt 는 ref 이미지에 이미
    # 시각적으로 반영되어 있으므로 prompt 텍스트에서 묘사 반복은 최소화.
    desc_clean = (description or "").strip()
    camera_text = (video_prompt or "").strip()

    if scene_type == "lipsync" and lyrics_segment:
        # 앞부분: 모션 + 가사 (Grok 의 앞 20단어 우선 활용)
        final_prompt = (
            "Softly mouth these lyrics: \"{lyrics}\". "
            "{camera} "
            "Style: cinematic music video, soft natural lighting, preserve composition and colors. "
            "Avoid glamour portrait framing."
        ).format(
            lyrics=lyrics_segment,
            camera=("Camera: " + camera_text + "." if camera_text else "Camera: gentle steady framing on the face."),
        )
    else:
        # 앞부분: 행동·모션 (description) + 카메라
        motion_first = desc_clean if desc_clean else "Natural cinematic motion in the scene."
        camera_line = ("Camera: " + camera_text + ".") if camera_text else "Camera: smooth cinematic movement."
        final_prompt = (
            "{motion} "
            "{camera} "
            "Style: cinematic music video, soft natural lighting, preserve composition and colors. "
            "Avoid glamour portrait framing."
        ).format(
            motion=motion_first,
            camera=camera_line,
        )

    import re as _re
    final_prompt = _re.sub(r"\s{2,}", " ", final_prompt).strip()

    # 앞 20단어 로깅 — Grok attention prior 검증 용도
    _first20 = " ".join(final_prompt.split()[:20])
    logger.info(
        "[GrokProm] motion_len=%d camera_len=%d type=%s first20='%s'",
        len(desc_clean), len(camera_text), scene_type, _first20,
    )
    logger.info(
        "[Grok] start prompt_len=%d desc_len=%d vp_len=%d type=%s duration=%.1f",
        len(final_prompt), len(desc_clean), len(camera_text), scene_type, duration,
    )

    # xAI 의 image-to-video duration 한도 10초.
    grok_duration = max(1, min(10, int(round(duration))))

    body = {
        "model": GROK_MODEL,
        "prompt": final_prompt,
        "image": {"url": image_url},
        "duration": grok_duration,
    }

    headers = _get_xai_headers()
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(XAI_VIDEO_URL, headers=headers, json=body)

    if resp.status_code == 429:
        raise ValueError("Grok API 429: 할당량 초과")
    if resp.status_code not in (200, 201, 202):
        raise ValueError(
            "Grok API 오류 (HTTP {}): {}".format(resp.status_code, resp.text[:300])
        )

    data = resp.json()
    request_id = data.get("request_id") or data.get("id")
    if not request_id:
        raise ValueError("Grok 응답에서 request_id 를 찾을 수 없습니다: {}".format(str(data)[:300]))

    logger.info("[Grok] accepted: request_id=%s duration=%d", request_id, grok_duration)
    return request_id


async def check_scene_video_status_grok(request_id: str) -> dict:
    """Check Grok video generation status.

    Returns:
        {"done": bool, "video_url": str or None, "error": str or None}
    """
    url = XAI_STATUS_URL.format(request_id=request_id)
    headers = _get_xai_headers()

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)

    if resp.status_code != 200:
        logger.warning(
            "[Grok] status check HTTP %d (request_id=%s): %s",
            resp.status_code, request_id, resp.text[:300],
        )
        return {"done": False, "video_url": None, "error": None}

    data = resp.json()
    status = (data.get("status") or "").lower()
    progress = data.get("progress")

    if status in ("pending", "in_progress", "in_queue", ""):
        logger.info("[Grok] still pending request_id=%s progress=%s", request_id, progress)
        return {"done": False, "video_url": None, "error": None}

    if status == "done":
        # xAI 응답: {"status": "done", "video": {"url": "...", "duration": N}, "model": "..."}
        video = data.get("video") or {}
        video_url = video.get("url") if isinstance(video, dict) else None
        if not video_url:
            # 일부 응답은 video_url 평면 키일 수도
            video_url = data.get("video_url")
        if video_url:
            logger.info("[Grok] done request_id=%s url=%s", request_id, video_url[:100])
            return {"done": True, "video_url": video_url, "error": None}
        logger.warning(
            "[Grok] done but no video URL request_id=%s data=%s",
            request_id, str(data)[:500],
        )
        return {
            "done": True,
            "video_url": None,
            "error": "비디오 URL을 찾을 수 없습니다. 응답: {}".format(str(data)[:200]),
        }

    if status == "failed":
        err = data.get("error") or data.get("message") or "알 수 없는 오류"
        logger.warning("[Grok] failed request_id=%s err=%s", request_id, str(err)[:300])
        return {
            "done": True,
            "video_url": None,
            "error": "Grok 비디오 생성 실패: {}".format(str(err)[:300]),
        }

    if status == "expired":
        logger.warning("[Grok] expired request_id=%s", request_id)
        return {
            "done": True,
            "video_url": None,
            "error": "Grok 비디오 URL 이 만료되었습니다 (생성 후 다운로드 누락).",
        }

    # 모르는 status
    logger.warning("[Grok] unknown status='%s' request_id=%s", status, request_id)
    return {"done": False, "video_url": None, "error": None}


async def download_video_grok(video_url: str) -> bytes:
    """Download Grok-generated video bytes.

    xAI 의 video.url 은 임시 URL — 즉시 다운로드해서 MinIO 저장 필요.
    """
    if not video_url:
        raise ValueError("video_url 이 비어 있습니다.")
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(video_url)
    if resp.status_code != 200:
        raise ValueError(
            "Grok 비디오 다운로드 실패 (HTTP {}): {}".format(resp.status_code, resp.text[:200])
        )
    logger.info("[Grok] downloaded %d bytes", len(resp.content))
    return resp.content
