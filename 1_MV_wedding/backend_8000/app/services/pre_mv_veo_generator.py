"""
v17.3 — Pre-MV Phase 3: Google Veo 3.1 영상 생성 어댑터.

9004 의 mv_generator.py L5157~5353 패턴을 이식:
  · `predictLongRunning` (POST) → operation_name → 폴링 → video_uri → 다운로드.
  · referenceImages 에 씬 이미지 PNG base64 첨부.
  · duration 은 8 초 고정 (Veo 3.1 fast 한도). 씬 use_seconds 가 더 짧으면
    ffmpeg 로 정확히 잘라낸다.

공개 함수:
  · `generate_scene_video_veo(...)` — 1회 호출로 씬 영상 mp4 bytes 를 반환한다.
     내부에서 start → poll → download → (필요시) trim 수행.

추적자: pre_mv_job_id, scene_number, phase=phase3, video_model=veo, op_name(앞 16), bytes.
민감정보(google_api_key) 는 출력하지 않는다.
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
from .pre_mv_video_prompts import compose_video_prompt

logger = logging.getLogger(__name__)


# ── API URLs (9004 그대로) ──────────────────────────────────────────────────
VEO31_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "veo-3.1-fast-generate-preview:predictLongRunning"
)
VEO_OPERATION_URL = "https://generativelanguage.googleapis.com/v1beta/{}"

# Veo 3.1 fast: 16:9 + 8s.
_VEO_DURATION = 8
_VEO_ASPECT = "16:9"

# 폴링 한도 — 8s 영상은 보통 30~120s 안에 완료. 안전 마진.
_POLL_INTERVAL_SEC = 4.0
_POLL_TIMEOUT_SEC = 600.0


def _get_ffmpeg_path() -> Optional[str]:
    """ffmpeg 바이너리 경로. PATH → imageio-ffmpeg fallback (9004 패턴)."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


async def _trim_to_duration(
    *,
    src_bytes: bytes,
    target_sec: float,
    pre_mv_job_id: str,
    scene_number: int,
) -> bytes:
    """target_sec 가 _VEO_DURATION 보다 짧으면 ffmpeg 로 정확히 잘라낸다.

    실패 시 원본 bytes 를 그대로 반환 (씬을 잃지 않는 정책).
    """
    if target_sec >= float(_VEO_DURATION) - 0.05:
        return src_bytes
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        logger.warning(
            "[PreMVVeo] phase=phase3 trim skipped (no ffmpeg) "
            "pre_mv_job_id=%s scene_number=%d target=%.2fs",
            pre_mv_job_id, scene_number, target_sec,
        )
        return src_bytes

    tmpdir = tempfile.mkdtemp(prefix="pre_mv_veo_trim_")
    try:
        in_path = os.path.join(tmpdir, "in.mp4")
        out_path = os.path.join(tmpdir, "out.mp4")
        with open(in_path, "wb") as f:
            f.write(src_bytes)

        # 우선 copy 모드 — keyframe alignment 문제 시 재인코딩 fallback.
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, "-y", "-i", in_path,
            "-t", "{:.3f}".format(target_sec),
            "-c", "copy", out_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
            logger.info(
                "[PreMVVeo] phase=phase3 trim copy_failed pre_mv_job_id=%s scene_number=%d "
                "rc=%s stderr=%s — falling back to re-encode",
                pre_mv_job_id, scene_number, proc.returncode,
                (stderr or b"").decode(errors="replace")[:200],
            )
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
            _, stderr2 = await proc2.communicate()
            if proc2.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
                logger.warning(
                    "[PreMVVeo] phase=phase3 trim re-encode_failed pre_mv_job_id=%s "
                    "scene_number=%d rc=%s stderr=%s",
                    pre_mv_job_id, scene_number, proc2.returncode,
                    (stderr2 or b"").decode(errors="replace")[:200],
                )
                return src_bytes

        with open(out_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def _start_veo(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    prompt: str,
    image_bytes: Optional[bytes],
) -> str:
    """predictLongRunning 호출 → operation name 반환."""
    image_b64 = base64.b64encode(image_bytes).decode("utf-8") if image_bytes else None
    if image_b64:
        payload = {
            "instances": [
                {
                    "prompt": prompt,
                    "referenceImages": [
                        {
                            "image": {
                                "bytesBase64Encoded": image_b64,
                                "mimeType": "image/png",
                            },
                            "referenceType": "asset",
                        }
                    ],
                }
            ],
            "parameters": {
                "aspectRatio": _VEO_ASPECT,
                "durationSeconds": _VEO_DURATION,
            },
        }
    else:
        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "aspectRatio": _VEO_ASPECT,
                "durationSeconds": _VEO_DURATION,
            },
        }

    logger.info(
        "[PreMVVeo] phase=phase3 start request pre_mv_job_id=%s scene_number=%d "
        "prompt_len=%d image_attached=%s",
        pre_mv_job_id, scene_number, len(prompt or ""), bool(image_b64),
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            VEO31_GENERATE_URL,
            headers={"x-goog-api-key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        # 응답 본문은 stack trace 가 아니라 API 에러 메시지 — 짧게.
        detail = resp.text[:300]
        raise ValueError(
            "Veo 3.1 API 오류 (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    op_name = data.get("name")
    if not op_name:
        raise ValueError(
            "Veo 3.1 응답에 operation name 이 없습니다: {}".format(str(data)[:200])
        )

    logger.info(
        "[PreMVVeo] phase=phase3 accepted pre_mv_job_id=%s scene_number=%d op=%s",
        pre_mv_job_id, scene_number, op_name[:64],
    )
    return op_name


async def _poll_until_done(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    op_name: str,
) -> str:
    """Long-running operation 폴링 → video_uri 반환."""
    deadline = time.time() + _POLL_TIMEOUT_SEC
    url = VEO_OPERATION_URL.format(op_name)
    last_log = 0.0
    while True:
        if time.time() > deadline:
            raise TimeoutError(
                "Veo 폴링 타임아웃 (op={})".format(op_name[:64])
            )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    url,
                    headers={"x-goog-api-key": settings.google_api_key},
                )
        except httpx.HTTPError as e:
            logger.warning(
                "[PreMVVeo] phase=phase3 poll http_error pre_mv_job_id=%s scene_number=%d "
                "err=%s: %s — retrying",
                pre_mv_job_id, scene_number, type(e).__name__, str(e)[:200],
            )
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if resp.status_code != 200:
            # 일시적 5xx 등은 재시도. 4xx 는 즉시 실패.
            if 500 <= resp.status_code < 600:
                logger.warning(
                    "[PreMVVeo] phase=phase3 poll 5xx pre_mv_job_id=%s scene_number=%d "
                    "status=%d — retrying",
                    pre_mv_job_id, scene_number, resp.status_code,
                )
                await asyncio.sleep(_POLL_INTERVAL_SEC)
                continue
            raise ValueError(
                "Veo 폴링 실패 (HTTP {}): {}".format(resp.status_code, resp.text[:200])
            )

        data = resp.json()
        if not data.get("done"):
            now_t = time.time()
            if now_t - last_log > 20.0:
                logger.info(
                    "[PreMVVeo] phase=phase3 poll still running pre_mv_job_id=%s scene_number=%d "
                    "remaining=%.0fs",
                    pre_mv_job_id, scene_number, deadline - now_t,
                )
                last_log = now_t
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        err = data.get("error")
        if err:
            raise ValueError(
                "Veo 생성 실패: {}".format(str(err.get("message") or err)[:300])
            )

        response_data = data.get("response", {}) or {}
        generated = response_data.get("generateVideoResponse", {}) or {}
        samples = generated.get("generatedSamples") or []
        if not samples:
            raise ValueError("Veo 응답에 생성된 비디오가 없습니다.")

        video_uri = (samples[0].get("video") or {}).get("uri")
        if not video_uri:
            raise ValueError("Veo 응답에 video_uri 가 없습니다.")
        return video_uri


async def _download_video(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    video_uri: str,
) -> bytes:
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(
            video_uri,
            headers={"x-goog-api-key": settings.google_api_key},
        )
    if resp.status_code != 200:
        raise ValueError(
            "Veo 비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )
    logger.info(
        "[PreMVVeo] phase=phase3 downloaded pre_mv_job_id=%s scene_number=%d bytes=%d",
        pre_mv_job_id, scene_number, len(resp.content or b""),
    )
    return resp.content


async def generate_scene_video_veo(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    scene: dict,
    image_bytes: Optional[bytes],
) -> bytes:
    """Phase 3 단일 씬 영상 (Veo) — mp4 bytes 반환.

    Args:
      pre_mv_job_id, scene_number: tracing.
      scene:        pre_mv_jobs.scenes[N-1]. image_prompt/description/video_prompt/use_seconds 사용.
      image_bytes:  씬 PNG (MinIO 에서 미리 fetch). None 이어도 동작은 하지만 권장X.

    Returns:
      mp4 bytes (use_seconds 길이로 trim 완료).

    Raises:
      ValueError: API 키 누락, API 오류, 응답 파싱 실패.
      TimeoutError: 폴링 한도 초과.
    """
    if not settings.google_api_key:
        raise ValueError("google_api_key 가 비어 있어 Veo 호출이 불가합니다.")

    started = time.time()
    target_sec = float(scene.get("use_seconds") or _VEO_DURATION)

    final_prompt = compose_video_prompt(
        video_model="veo",
        scene=scene,
        duration=min(float(_VEO_DURATION), max(2.0, target_sec)),
    )

    logger.info(
        "[PreMVVeo] phase=phase3 entry pre_mv_job_id=%s scene_number=%d "
        "prompt_len=%d use_seconds=%.2f image_bytes=%d",
        pre_mv_job_id, scene_number, len(final_prompt), target_sec,
        len(image_bytes or b""),
    )

    op_name = await _start_veo(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        prompt=final_prompt,
        image_bytes=image_bytes,
    )
    video_uri = await _poll_until_done(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        op_name=op_name,
    )
    raw_bytes = await _download_video(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        video_uri=video_uri,
    )
    trimmed = await _trim_to_duration(
        src_bytes=raw_bytes,
        target_sec=target_sec,
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
    )

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[PreMVVeo] phase=phase3 ok pre_mv_job_id=%s scene_number=%d "
        "raw_bytes=%d final_bytes=%d use_seconds=%.2f elapsed_ms=%d",
        pre_mv_job_id, scene_number, len(raw_bytes), len(trimmed),
        target_sec, elapsed_ms,
    )
    return trimmed
