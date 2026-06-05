"""
v17.3 — Pre-MV Phase 3: Kling 3.0 Omni 영상 생성 어댑터.

9004 의 kling_video_generator.py 그대로 이식. JWT(HS256) 토큰 + image_list 패턴.

흐름:
  · `_generate_jwt_token` — access_key 로 30분 만료 JWT 서명.
  · POST `/v1/videos/omni-video` (api-singapore.klingai.com) → task_id.
  · GET  `/v1/videos/omni-video/{task_id}` 폴링 → video_url.
  · 다운로드 → use_seconds 길이로 trim.

image_list[]:
  · index 0 → 씬 PNG (`type=first_frame`).
  · index 1 → (옵션) 캐릭터 시트 — 신랑 또는 신부. <<<image_1>>> 로 prompt 에서 참조 가능.
  · index 2 → (옵션) 추가 캐릭터 시트. <<<image_2>>>.

추적자: pre_mv_job_id, scene_number, phase=phase3, video_model=kling, task_id, bytes.
민감정보: JWT 토큰은 길이만, kling_access_key/secret_key 는 출력 X.
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
import jwt

from ..config import settings
from .pre_mv_video_prompts import compose_video_prompt, sanitize_video_prompt

logger = logging.getLogger(__name__)


KLING_BASE_URL = "https://api-singapore.klingai.com"
KLING_OMNI_VIDEO_URL = "{}/v1/videos/omni-video".format(KLING_BASE_URL)

# Kling Omni duration 정수, 3~15s.
_KLING_MIN = 3
_KLING_MAX = 15

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


def _generate_jwt_token(access_key: str, secret_key: str) -> str:
    """30분 만료 JWT 토큰 (9004 패턴)."""
    now = int(time.time())
    payload = {"iss": access_key, "exp": now + 1800, "nbf": now - 5}
    headers = {"alg": "HS256", "typ": "JWT"}
    token = jwt.encode(payload, secret_key, algorithm="HS256", headers=headers)
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token


def _auth_header() -> dict:
    if not settings.kling_access_key or not settings.kling_secret_key:
        raise ValueError("Kling API 키가 설정되지 않았습니다.")
    token = _generate_jwt_token(
        settings.kling_access_key,
        settings.kling_secret_key,
    )
    return {"Authorization": "Bearer {}".format(token)}


async def _trim_to_duration(
    *,
    src_bytes: bytes,
    target_sec: float,
    pre_mv_job_id: str,
    scene_number: int,
) -> bytes:
    """target_sec 보다 길면 잘라낸다. ffmpeg 없으면 원본 반환."""
    ffmpeg_bin = _get_ffmpeg_path()
    if not ffmpeg_bin:
        return src_bytes

    tmpdir = tempfile.mkdtemp(prefix="pre_mv_kling_trim_")
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
        _, stderr = await proc.communicate()
        if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
            logger.info(
                "[PreMVKling] phase=phase3 trim copy_failed pre_mv_job_id=%s scene_number=%d "
                "rc=%s — fallback re-encode",
                pre_mv_job_id, scene_number, proc.returncode,
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
            _, _ = await proc2.communicate()
            if proc2.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
                return src_bytes
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def _start_kling(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    prompt: str,
    scene_image_bytes: Optional[bytes],
    char_ref_bytes_list: list[bytes],
    kling_duration: int,
    end_frame_bytes: Optional[bytes] = None,
) -> str:
    """v24 — top-level image_tail (data URI base64) 시도 → 4xx with "image_tail"
    이면 fallback `image_list[].type="last_frame"` 으로 재시도.
    """
    image_list: list[dict] = []

    # 1) 씬 이미지 → first_frame (auto-applied)
    if scene_image_bytes:
        b64 = base64.b64encode(scene_image_bytes).decode("utf-8")
        image_list.append({"image_url": b64, "type": "first_frame"})

    # 2) 캐릭터 시트들 — <<<image_1>>>, <<<image_2>>> 순.
    for ref in char_ref_bytes_list[:2]:
        if not ref:
            continue
        b64 = base64.b64encode(ref).decode("utf-8")
        image_list.append({"image_url": b64})

    # v45 — mode "pro" (1080p) → "4K" (3840×2160). image_list + image_tail +
    # 16:9 + duration 5/10 + sound=off 모두 4K 모드와 호환.
    # cost 2.5×, 생성 시간 1.5~2× — wedding MV 최종 quality 우선.
    body: dict = {
        "model_name": "kling-v3-omni",
        "prompt": prompt,
        "mode": "4K",
        "duration": str(kling_duration),
        "aspect_ratio": "16:9",
        "sound": "off",
    }
    if image_list:
        body["image_list"] = list(image_list)

    # v24 — top-level image_tail (data URI). dry-run 4xx 시 fallback.
    tail_b64: Optional[str] = None
    if end_frame_bytes:
        tail_b64 = base64.b64encode(end_frame_bytes).decode("utf-8")
        body["image_tail"] = "data:image/png;base64,{}".format(tail_b64)

    headers = _auth_header()
    headers["Content-Type"] = "application/json"
    token_len = len(headers.get("Authorization", "")) - len("Bearer ")  # 길이만

    logger.info(
        "[PreMVKling] phase=phase3 start request pre_mv_job_id=%s scene_number=%d "
        "prompt_len=%d duration=%d images=%d jwt_len=%d image_tail_attached=%s",
        pre_mv_job_id, scene_number, len(prompt or ""), kling_duration,
        len(image_list), token_len, bool(tail_b64),
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(KLING_OMNI_VIDEO_URL, headers=headers, json=body)

    # v24 — image_tail 키가 거부되면(4xx + 응답에 "image_tail" 언급) fallback:
    # image_list 에 type="last_frame" 으로 추가하고 재시도.
    if (
        tail_b64 is not None
        and 400 <= resp.status_code < 500
        and "image_tail" in (resp.text or "")
    ):
        logger.warning(
            "[PreMVKling] phase=phase3 image_tail key path REJECTED — falling back to "
            "image_list[type=last_frame] pre_mv_job_id=%s scene_number=%d status=%d",
            pre_mv_job_id, scene_number, resp.status_code,
        )
        body.pop("image_tail", None)
        fallback_list = list(image_list)
        fallback_list.append({"image_url": tail_b64, "type": "last_frame"})
        body["image_list"] = fallback_list
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(KLING_OMNI_VIDEO_URL, headers=headers, json=body)
        logger.info(
            "[PreMVKling] phase=phase3 image_tail fallback path used pre_mv_job_id=%s "
            "scene_number=%d status=%d images=%d",
            pre_mv_job_id, scene_number, resp.status_code, len(fallback_list),
        )
    elif tail_b64 is not None and resp.status_code == 200:
        logger.info(
            "[PreMVKling] phase=phase3 image_tail key path used pre_mv_job_id=%s "
            "scene_number=%d",
            pre_mv_job_id, scene_number,
        )

    if resp.status_code == 429:
        raise ValueError("Kling API 429: 할당량 초과")
    if resp.status_code != 200:
        raise ValueError(
            "Kling API 오류 (HTTP {}): {}".format(resp.status_code, resp.text[:300])
        )

    data = resp.json()
    task_id = (data.get("data") or {}).get("task_id")
    if not task_id:
        raise ValueError(
            "Kling 응답에서 task_id 를 찾을 수 없습니다: {}".format(str(data)[:300])
        )

    logger.info(
        "[PreMVKling] phase=phase3 accepted pre_mv_job_id=%s scene_number=%d task_id=%s",
        pre_mv_job_id, scene_number, task_id,
    )
    return task_id


async def _poll_until_done(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    task_id: str,
) -> str:
    url = "{}/v1/videos/omni-video/{}".format(KLING_BASE_URL, task_id)
    deadline = time.time() + _POLL_TIMEOUT_SEC
    last_log = 0.0
    while True:
        if time.time() > deadline:
            raise TimeoutError("Kling 폴링 타임아웃 (task_id={})".format(task_id))

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url, headers=_auth_header())
        except httpx.HTTPError as e:
            logger.warning(
                "[PreMVKling] phase=phase3 poll http_error pre_mv_job_id=%s scene_number=%d "
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
                "Kling 폴링 실패 (HTTP {}): {}".format(resp.status_code, resp.text[:200])
            )

        data = resp.json()
        task_data = data.get("data") or {}
        task_status = task_data.get("task_status", "")

        if task_status in ("submitted", "processing"):
            now_t = time.time()
            if now_t - last_log > 20.0:
                logger.info(
                    "[PreMVKling] phase=phase3 poll still running pre_mv_job_id=%s "
                    "scene_number=%d task_id=%s status=%s remaining=%.0fs",
                    pre_mv_job_id, scene_number, task_id, task_status,
                    deadline - now_t,
                )
                last_log = now_t
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            continue

        if task_status == "succeed":
            videos = (task_data.get("task_result") or {}).get("videos") or []
            if videos and isinstance(videos, list):
                first = videos[0]
                if isinstance(first, dict) and first.get("url"):
                    return first["url"]
            raise ValueError("Kling 응답에 video URL 이 없습니다.")

        if task_status == "failed":
            raise ValueError(
                "Kling 비디오 생성 실패: {}".format(
                    task_data.get("task_status_msg", "알 수 없는 오류")
                )
            )

        # 알 수 없는 status — 잠시 대기 후 다시.
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
            "Kling 비디오 다운로드 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:200]
            )
        )
    logger.info(
        "[PreMVKling] phase=phase3 downloaded pre_mv_job_id=%s scene_number=%d bytes=%d",
        pre_mv_job_id, scene_number, len(resp.content or b""),
    )
    return resp.content


async def generate_scene_video_kling(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    scene: dict,
    image_bytes: Optional[bytes],
    char_ref_bytes_list: Optional[list[bytes]] = None,
    char_ref_modes: Optional[list[str]] = None,
    end_frame_bytes: Optional[bytes] = None,
) -> bytes:
    """Phase 3 단일 씬 영상 (Kling) — mp4 bytes 반환.

    Args:
      pre_mv_job_id, scene_number: tracing.
      scene:        pre_mv_jobs.scenes[N-1].
      image_bytes:  씬 PNG bytes (first_frame).
      char_ref_bytes_list: 캐릭터 시트 1~2장. None 또는 빈 리스트 가능.
      char_ref_modes:
        v39 — char_ref_bytes_list 와 같은 순서로 각 시트의 매칭 모드 지정.
        · "explicit" — 사용자가 명시한 ref. full-match (얼굴+옷 모두 따름).
        · "face_only" — fallback default 시트. face-only (옷은 scene 자유 변주).
        prompt 의 identity guidance 안내문 자동 생성에 쓰인다.
      end_frame_bytes:
        v24 — chapter FFLF 연쇄. 다음 씬의 Phase 2 PNG. body 의 top-level
        `image_tail` (base64 data URI) 로 전달. dry-run 실패 시 fallback 으로
        `image_list[].type="last_frame"` 으로 자동 전환.
    """
    if not settings.kling_access_key or not settings.kling_secret_key:
        raise ValueError("Kling API 키가 설정되지 않았습니다.")

    started = time.time()
    target_sec = float(scene.get("use_seconds") or 5.0)
    kling_duration = max(_KLING_MIN, min(_KLING_MAX, int(round(target_sec))))
    has_last_frame = bool(end_frame_bytes)

    raw_prompt = compose_video_prompt(
        video_model="kling",
        scene=scene,
        duration=float(kling_duration),
        has_last_frame=has_last_frame,
    )

    # v39 — identity guidance 자동 inject (image_N 별 face-only/full-match 명시).
    refs = list(char_ref_bytes_list or [])
    modes = list(char_ref_modes or [])
    identity_lines: list[str] = []
    for i in range(min(len(refs), 2)):
        if not refs[i]:
            continue
        n = i + 1  # <<<image_N>>> 은 1-based (image_list[0]=first_frame, [1]=ref1, [2]=ref2)
        mode = modes[i] if i < len(modes) else "explicit"
        if mode == "face_only":
            identity_lines.append(
                "<<<image_{n}>>> is a FACE-ONLY identity reference: match the face, "
                "head shape, hair, and body proportions exactly, but the OUTFIT, "
                "accessories, and styling must follow the scene description rather "
                "than the reference's wardrobe.".format(n=n)
            )
        else:
            identity_lines.append(
                "<<<image_{n}>>> is a FULL-MATCH reference: match face, hair, body, "
                "AND wardrobe/accessories exactly as in the reference image.".format(n=n)
            )
    if identity_lines:
        identity_block = "Character identity guidance: " + " ".join(identity_lines)
        raw_prompt = raw_prompt + " " + identity_block

    # v25 — Layer 2 안전망: 출력 모더레이션 트리거 표현 사전 치환.
    final_prompt = sanitize_video_prompt(raw_prompt)
    logger.info(
        "[PreMVKling] phase=phase3 entry pre_mv_job_id=%s scene_number=%d "
        "raw_prompt_len=%d safe_prompt_len=%d use_seconds=%.2f kling_dur=%d "
        "image_bytes=%d char_refs=%d last_frame_bytes=%d",
        pre_mv_job_id, scene_number, len(raw_prompt), len(final_prompt),
        target_sec, kling_duration, len(image_bytes or b""), len(refs),
        len(end_frame_bytes or b""),
    )

    task_id = await _start_kling(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        prompt=final_prompt,
        scene_image_bytes=image_bytes,
        char_ref_bytes_list=refs,
        kling_duration=kling_duration,
        end_frame_bytes=end_frame_bytes,
    )
    video_url = await _poll_until_done(
        pre_mv_job_id=pre_mv_job_id,
        scene_number=scene_number,
        task_id=task_id,
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
        "[PreMVKling] phase=phase3 ok pre_mv_job_id=%s scene_number=%d "
        "raw_bytes=%d final_bytes=%d use_seconds=%.2f elapsed_ms=%d",
        pre_mv_job_id, scene_number, len(raw_bytes), len(final),
        target_sec, elapsed_ms,
    )
    return final
