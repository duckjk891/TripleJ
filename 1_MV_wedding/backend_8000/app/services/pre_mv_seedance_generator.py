"""
v17.3 — Pre-MV Phase 3: Seedance 2.0 (fal.ai) 영상 생성 어댑터.

9004 의 seedance_video_generator.py 이식. data URI 로 씬 PNG 1장 첨부 (Seedance 는
multi-ref 미지원). 강한 글래머 표현 필터 — sanitize_for_seedance 로 사전 검열.

흐름:
  · POST `queue.fal.run/fal-ai/seedance-2/image-to-video` → request_id.
  · GET  `queue.fal.run/fal-ai/seedance-2/requests/{request_id}/status` 폴링 →
    완료 시 GET `.../requests/{request_id}` 에서 video URL.
  · 다운로드 → use_seconds 길이로 trim.

추적자: pre_mv_job_id, scene_number, phase=phase3, video_model=seedance, request_id, bytes.
민감정보: fal_api_key 출력 X.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import shutil
import tempfile
import time
from typing import Optional

import httpx

from ..config import settings
from .pre_mv_video_prompts import compose_video_prompt, sanitize_video_prompt

logger = logging.getLogger(__name__)


FAL_API_URL = "https://queue.fal.run/fal-ai/seedance-2/image-to-video"
FAL_STATUS_URL = "https://queue.fal.run/fal-ai/seedance-2/requests/{request_id}/status"
FAL_RESULT_URL = "https://queue.fal.run/fal-ai/seedance-2/requests/{request_id}"

_SEEDANCE_MIN = 5
_SEEDANCE_MAX = 15

_POLL_INTERVAL_SEC = 5.0
_POLL_TIMEOUT_SEC = 900.0


def _get_ffmpeg_path() -> Optional[str]:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def _get_fal_headers() -> dict:
    if not settings.fal_api_key:
        raise ValueError("fal.ai API 키가 설정되지 않았습니다.")
    return {
        "Authorization": "Key {}".format(settings.fal_api_key),
        "Content-Type": "application/json",
    }


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
    tmpdir = tempfile.mkdtemp(prefix="pre_mv_seed_trim_")
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


async def _start_seedance(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    prompt: str,
    image_bytes: bytes,
    seedance_duration: int,
    end_frame_bytes: Optional[bytes] = None,
) -> str:
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    body: dict = {
        "prompt": prompt,
        "image_url": "data:image/png;base64,{}".format(image_b64),
        "duration": seedance_duration,
        "aspect_ratio": "16:9",  # v29 — 화면 비율 16:9 통일 (default=auto 의존 회피)
    }
    # v24 — end_image_url (data URI) — chapter FFLF 연쇄. 같은 endpoint, body 에만 추가.
    if end_frame_bytes:
        end_b64 = base64.b64encode(end_frame_bytes).decode("utf-8")
        body["end_image_url"] = "data:image/png;base64,{}".format(end_b64)

    logger.info(
        "[PreMVSeed] phase=phase3 start request pre_mv_job_id=%s scene_number=%d "
        "prompt_len=%d duration=%d image_bytes=%d end_image_attached=%s",
        pre_mv_job_id, scene_number, len(prompt or ""), seedance_duration,
        len(image_bytes or b""), bool(end_frame_bytes),
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(FAL_API_URL, headers=_get_fal_headers(), json=body)

    if resp.status_code == 429:
        raise ValueError("Seedance API 429: 할당량 초과")
    if resp.status_code not in (200, 201, 202):
        raise ValueError(
            "Seedance API 오류 (HTTP {}): {}".format(resp.status_code, resp.text[:300])
        )

    data = resp.json()
    request_id = data.get("request_id")
    if not request_id:
        raise ValueError(
            "Seedance 응답에서 request_id 를 찾을 수 없습니다: {}".format(str(data)[:300])
        )
    logger.info(
        "[PreMVSeed] phase=phase3 accepted pre_mv_job_id=%s scene_number=%d request_id=%s",
        pre_mv_job_id, scene_number, request_id,
    )
    return request_id


async def _poll_until_done(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    request_id: str,
) -> str:
    status_url = FAL_STATUS_URL.format(request_id=request_id)
    result_url = FAL_RESULT_URL.format(request_id=request_id)
    deadline = time.time() + _POLL_TIMEOUT_SEC
    last_log = 0.0

    while True:
        if time.time() > deadline:
            raise TimeoutError("Seedance 폴링 타임아웃 (request_id={})".format(request_id))

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(status_url, headers=_get_fal_headers())
        except httpx.HTTPError as e:
            logger.warning(
                "[PreMVSeed] phase=phase3 poll http_error pre_mv_job_id=%s scene_number=%d "
                "err=%s: %s — retrying",
                pre_mv_job_id, scene_number, type(e).__name__, str(e)[:200],
            )
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if resp.status_code != 200:
            # fal 의 status endpoint 가 일시적으로 다른 코드를 줄 수 있음 — 잠시 대기.
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        data = resp.json()
        status = (data.get("status") or "").upper()

        if status in ("IN_QUEUE", "IN_PROGRESS"):
            now_t = time.time()
            if now_t - last_log > 20.0:
                logger.info(
                    "[PreMVSeed] phase=phase3 poll still running pre_mv_job_id=%s "
                    "scene_number=%d request_id=%s status=%s remaining=%.0fs",
                    pre_mv_job_id, scene_number, request_id, status,
                    deadline - now_t,
                )
                last_log = now_t
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if status == "COMPLETED":
            async with httpx.AsyncClient(timeout=30.0) as client:
                result_resp = await client.get(result_url, headers=_get_fal_headers())
            if result_resp.status_code != 200:
                raise ValueError(
                    "Seedance 결과 조회 실패 HTTP {}: {}".format(
                        result_resp.status_code, result_resp.text[:200]
                    )
                )
            result_data = result_resp.json()
            # 9004 와 동일 — 응답 포맷 4가지 trial.
            video = result_data.get("video") or {}
            video_url = video.get("url") if isinstance(video, dict) else None
            if not video_url:
                video_url = result_data.get("video_url")
            if not video_url:
                videos = result_data.get("videos") or []
                if videos and isinstance(videos, list):
                    first = videos[0]
                    if isinstance(first, dict):
                        video_url = first.get("url")
            if not video_url:
                output = result_data.get("output")
                if isinstance(output, str):
                    video_url = output
                elif isinstance(output, dict):
                    video_url = output.get("url")
            if not video_url:
                raise ValueError(
                    "Seedance 응답에서 video URL 을 찾지 못했습니다. keys={}".format(
                        list(result_data.keys())
                    )
                )
            return video_url

        if status == "FAILED":
            raise ValueError(
                "Seedance 비디오 생성 실패: {}".format(str(data.get("error"))[:300])
            )

        # 알 수 없는 상태 — 잠시 대기 후 재시도.
        await asyncio.sleep(_POLL_INTERVAL_SEC)


async def _download_video(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    video_url: str,
) -> bytes:
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(video_url)
    if resp.status_code != 200:
        raise ValueError(
            "Seedance 비디오 다운로드 실패 (HTTP {})".format(resp.status_code)
        )
    logger.info(
        "[PreMVSeed] phase=phase3 downloaded pre_mv_job_id=%s scene_number=%d bytes=%d",
        pre_mv_job_id, scene_number, len(resp.content or b""),
    )
    return resp.content


async def generate_scene_video_seedance(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    scene: dict,
    image_bytes: bytes,
    end_frame_bytes: Optional[bytes] = None,
) -> bytes:
    """Phase 3 단일 씬 영상 (Seedance) — mp4 bytes.

    Args:
      end_frame_bytes:
        v24 — chapter FFLF 연쇄. 같은 endpoint, body 에 `end_image_url` (data URI)
        로 첨부. None 이면 종래와 동일.
    """
    if not settings.fal_api_key:
        raise ValueError("fal.ai API 키가 설정되지 않았습니다.")
    if not image_bytes:
        raise ValueError("Seedance image-to-video 는 씬 이미지가 필요합니다.")

    started = time.time()
    target_sec = float(scene.get("use_seconds") or 5.0)
    seedance_duration = max(_SEEDANCE_MIN, min(_SEEDANCE_MAX, int(round(target_sec))))
    has_last_frame = bool(end_frame_bytes)

    raw_prompt = compose_video_prompt(
        video_model="seedance",
        scene=scene,
        duration=float(seedance_duration),
        has_last_frame=has_last_frame,
    )
    final_prompt = sanitize_video_prompt(raw_prompt)

    logger.info(
        "[PreMVSeed] phase=phase3 entry pre_mv_job_id=%s scene_number=%d "
        "raw_prompt_len=%d safe_prompt_len=%d use_seconds=%.2f seed_dur=%d "
        "image_bytes=%d end_frame_bytes=%d",
        pre_mv_job_id, scene_number, len(raw_prompt), len(final_prompt),
        target_sec, seedance_duration, len(image_bytes or b""),
        len(end_frame_bytes or b""),
    )

    request_id = await _start_seedance(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        prompt=final_prompt,
        image_bytes=image_bytes,
        seedance_duration=seedance_duration,
        end_frame_bytes=end_frame_bytes,
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
        "[PreMVSeed] phase=phase3 ok pre_mv_job_id=%s scene_number=%d "
        "raw_bytes=%d final_bytes=%d use_seconds=%.2f elapsed_ms=%d",
        pre_mv_job_id, scene_number, len(raw_bytes), len(final),
        target_sec, elapsed_ms,
    )
    return final
