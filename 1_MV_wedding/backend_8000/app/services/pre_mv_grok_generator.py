"""
v17.3 — Pre-MV Phase 3: xAI Grok Imagine Video 어댑터.

9004 의 grok_video_generator.py 이식. Grok 의 image-to-video 는 presigned URL 방식만
받는다 (base64 / data URI 불가). 우리 MinIO 의 `presigned_get_object` 헬퍼로 단기 URL
을 발급해 전달한다.

흐름:
  · MinIO presigned URL 발급 (1시간 만료).
  · POST `api.x.ai/v1/videos/generations` → request_id.
  · GET  `api.x.ai/v1/videos/{request_id}` 폴링 → done 시 video.url.
  · 다운로드 → use_seconds 길이로 trim.

추적자: pre_mv_job_id, scene_number, phase=phase3, video_model=grok, request_id, bytes.
민감정보: xai_api_key 출력 X.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from datetime import timedelta
from typing import Optional

import httpx

from ..config import settings
from ..database.minio import get_minio
from .pre_mv_video_prompts import compose_video_prompt, sanitize_video_prompt

logger = logging.getLogger(__name__)


XAI_VIDEO_URL = "https://api.x.ai/v1/videos/generations"
XAI_STATUS_URL = "https://api.x.ai/v1/videos/{request_id}"

GROK_MODEL = "grok-imagine-video"

_GROK_MIN = 1
_GROK_MAX = 10

_POLL_INTERVAL_SEC = 5.0
_POLL_TIMEOUT_SEC = 600.0

_PRESIGN_EXPIRES = timedelta(hours=1)


def _get_ffmpeg_path() -> Optional[str]:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def _get_xai_headers() -> dict:
    if not settings.xai_api_key:
        raise ValueError("xAI API 키가 설정되지 않았습니다.")
    return {
        "Authorization": "Bearer {}".format(settings.xai_api_key),
        "Content-Type": "application/json",
    }


def _presign_scene_image(scene_object_name: str) -> str:
    """MinIO photos 버킷의 씬 PNG → 1시간 만료 presigned GET URL.

    Raises:
      ValueError: presigned 발급 실패.
    """
    if not scene_object_name:
        raise ValueError("scene_object_name 이 비어 있습니다.")
    client = get_minio()
    if client is None:
        raise ValueError("MinIO 클라이언트가 초기화되지 않았습니다.")
    try:
        return client.presigned_get_object(
            bucket_name=settings.minio_bucket_photos,
            object_name=scene_object_name,
            expires=_PRESIGN_EXPIRES,
        )
    except Exception as e:  # noqa: BLE001
        raise ValueError(
            "presigned URL 발급 실패 ({}: {})".format(type(e).__name__, str(e)[:200])
        )


async def _trim_to_duration(
    *,
    src_bytes: bytes,
    target_sec: float,
    pre_mv_job_id: str,
    scene_number: int,
) -> bytes:
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        return src_bytes
    tmpdir = tempfile.mkdtemp(prefix="pre_mv_grok_trim_")
    try:
        in_path = os.path.join(tmpdir, "in.mp4")
        out_path = os.path.join(tmpdir, "out.mp4")
        with open(in_path, "wb") as f:
            f.write(src_bytes)
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-y", "-i", in_path,
            "-t", "{:.3f}".format(target_sec),
            "-c", "copy", out_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, _ = await proc.communicate()
        if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
            proc2 = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-y", "-i", in_path,
                "-t", "{:.3f}".format(target_sec),
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                "-movflags", "+faststart",
                out_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, _ = await proc2.communicate()
            if proc2.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
                return src_bytes
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def _start_grok(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    prompt: str,
    image_url: str,
    grok_duration: int,
) -> str:
    body = {
        "model": GROK_MODEL,
        "prompt": prompt,
        "image": {"url": image_url},
        "duration": grok_duration,
        "aspect_ratio": "16:9",  # v29 — 명시적 16:9 (xAI default 도 16:9, 안전 마진)
    }
    logger.info(
        "[PreMVGrok] phase=phase3 start request pre_mv_job_id=%s scene_number=%d "
        "prompt_len=%d duration=%d image_url_len=%d",
        pre_mv_job_id, scene_number, len(prompt or ""), grok_duration,
        len(image_url or ""),
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(XAI_VIDEO_URL, headers=_get_xai_headers(), json=body)
    if resp.status_code == 429:
        raise ValueError("Grok API 429: 할당량 초과")
    if resp.status_code not in (200, 201, 202):
        raise ValueError(
            "Grok API 오류 (HTTP {}): {}".format(resp.status_code, resp.text[:300])
        )
    data = resp.json()
    request_id = data.get("request_id") or data.get("id")
    if not request_id:
        raise ValueError(
            "Grok 응답에서 request_id 를 찾을 수 없습니다: {}".format(str(data)[:300])
        )
    logger.info(
        "[PreMVGrok] phase=phase3 accepted pre_mv_job_id=%s scene_number=%d request_id=%s",
        pre_mv_job_id, scene_number, request_id,
    )
    return request_id


async def _poll_until_done(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    request_id: str,
) -> str:
    url = XAI_STATUS_URL.format(request_id=request_id)
    deadline = time.time() + _POLL_TIMEOUT_SEC
    last_log = 0.0
    while True:
        if time.time() > deadline:
            raise TimeoutError("Grok 폴링 타임아웃 (request_id={})".format(request_id))

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url, headers=_get_xai_headers())
        except httpx.HTTPError as e:
            logger.warning(
                "[PreMVGrok] phase=phase3 poll http_error pre_mv_job_id=%s scene_number=%d "
                "err=%s: %s — retrying",
                pre_mv_job_id, scene_number, type(e).__name__, str(e)[:200],
            )
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if resp.status_code != 200:
            if 500 <= resp.status_code < 600:
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                continue
            raise ValueError(
                "Grok 폴링 실패 (HTTP {}): {}".format(resp.status_code, resp.text[:200])
            )

        data = resp.json()
        status = (data.get("status") or "").lower()
        progress = data.get("progress")

        if status in ("pending", "in_progress", "in_queue", ""):
            now_t = time.time()
            if now_t - last_log > 20.0:
                logger.info(
                    "[PreMVGrok] phase=phase3 poll still running pre_mv_job_id=%s "
                    "scene_number=%d request_id=%s progress=%s remaining=%.0fs",
                    pre_mv_job_id, scene_number, request_id, progress,
                    deadline - now_t,
                )
                last_log = now_t
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if status == "done":
            video = data.get("video") or {}
            video_url = video.get("url") if isinstance(video, dict) else None
            if not video_url:
                video_url = data.get("video_url")
            if not video_url:
                raise ValueError(
                    "Grok 응답에 video URL 이 없습니다: {}".format(str(data)[:200])
                )
            return video_url

        if status == "failed":
            err = data.get("error") or data.get("message") or "알 수 없는 오류"
            raise ValueError("Grok 비디오 생성 실패: {}".format(str(err)[:300]))

        if status == "expired":
            raise ValueError("Grok 비디오 URL 이 만료되었습니다.")

        # 알 수 없는 status — 잠시 대기.
        await asyncio.sleep(_POLL_INTERVAL_SEC)


async def _download_video(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    video_url: str,
) -> bytes:
    if not video_url:
        raise ValueError("video_url 이 비어 있습니다.")
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(video_url)
    if resp.status_code != 200:
        raise ValueError(
            "Grok 비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )
    logger.info(
        "[PreMVGrok] phase=phase3 downloaded pre_mv_job_id=%s scene_number=%d bytes=%d",
        pre_mv_job_id, scene_number, len(resp.content or b""),
    )
    return resp.content


async def generate_scene_video_grok(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    scene: dict,
) -> bytes:
    """Phase 3 단일 씬 영상 (Grok) — mp4 bytes.

    scene["image_object_name"] 가 있어야 한다 (MinIO presigned URL 발급용).
    호출 전에 image_status=completed 일 것을 호출자가 보장한다.
    """
    if not settings.xai_api_key:
        raise ValueError("Grok API 키가 설정되지 않았어요. 운영자에게 문의해 주세요.")

    started = time.time()
    image_object_name = (scene or {}).get("image_object_name") or ""
    if not image_object_name:
        raise ValueError("씬 이미지 object_name 이 없습니다 — Phase 2 를 먼저 완료해주세요.")

    target_sec = float(scene.get("use_seconds") or 5.0)
    grok_duration = max(_GROK_MIN, min(_GROK_MAX, int(round(target_sec))))

    raw_prompt = compose_video_prompt(
        video_model="grok",
        scene=scene,
        duration=float(grok_duration),
    )
    # v25 — Layer 2 안전망: 출력 모더레이션 트리거 표현 사전 치환.
    final_prompt = sanitize_video_prompt(raw_prompt)

    image_url = _presign_scene_image(image_object_name)

    logger.info(
        "[PreMVGrok] phase=phase3 entry pre_mv_job_id=%s scene_number=%d "
        "raw_prompt_len=%d safe_prompt_len=%d use_seconds=%.2f grok_dur=%d "
        "image_object=%s presign_url_len=%d",
        pre_mv_job_id, scene_number, len(raw_prompt), len(final_prompt),
        target_sec, grok_duration, image_object_name, len(image_url),
    )

    request_id = await _start_grok(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        prompt=final_prompt,
        image_url=image_url,
        grok_duration=grok_duration,
    )
    video_url = await _poll_until_done(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        request_id=request_id,
    )
    raw_bytes = await _download_video(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        video_url=video_url,
    )
    final = await _trim_to_duration(
        src_bytes=raw_bytes,
        target_sec=target_sec,
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
    )

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[PreMVGrok] phase=phase3 ok pre_mv_job_id=%s scene_number=%d "
        "raw_bytes=%d final_bytes=%d use_seconds=%.2f elapsed_ms=%d",
        pre_mv_job_id, scene_number, len(raw_bytes), len(final),
        target_sec, elapsed_ms,
    )
    return final
