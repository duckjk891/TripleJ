"""
Sync Labs Lip Sync Service.
Generates lip-synced videos using Sync Labs API.

v33: Refactored to use multipart/form-data direct file upload to Sync Labs.
     ngrok/MinIO-temp 의존 제거. httpx 기반 raw API 호출 (SDK 의존 제거).
"""
import asyncio
import logging
import os
import subprocess
import tempfile

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


SYNC_API_BASE = "https://api.sync.so/v2"

SYNC_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB per file
POLLING_ERROR_LIMIT = 6  # 60초 연속 실패면 중단


async def _sync_create_with_files(
    video_bytes: bytes,
    audio_bytes: bytes,
    model: str,
    options: dict | None = None,
) -> str:
    """POST /v2/generate with multipart. Returns job id."""
    if len(video_bytes) > SYNC_MAX_UPLOAD_BYTES:
        raise ValueError(
            "영상이 Sync Labs 업로드 한도(20MB)를 초과합니다: {} bytes. "
            "더 짧은 씬을 사용하거나 외부 URL 방식으로 전환하세요.".format(len(video_bytes))
        )
    if len(audio_bytes) > SYNC_MAX_UPLOAD_BYTES:
        raise ValueError(
            "오디오가 Sync Labs 업로드 한도(20MB)를 초과합니다: {} bytes.".format(len(audio_bytes))
        )
    import json as _json
    headers = {"x-api-key": settings.sync_api_key}
    files = {
        "video": ("scene.mp4", video_bytes, "video/mp4"),
        "audio": ("audio.mp3", audio_bytes, "audio/mpeg"),
    }
    data = {"model": model}
    if options:
        data["options"] = _json.dumps(options)
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{SYNC_API_BASE}/generate",
            headers=headers,
            files=files,
            data=data,
        )
    if resp.status_code not in (200, 201, 202):
        raise ValueError(
            "Sync Labs create 실패 (HTTP {}): {}".format(
                resp.status_code, resp.text[:500]
            )
        )
    body = resp.json()
    job_id = body.get("id") or body.get("generationId")
    if not job_id:
        raise ValueError("Sync Labs 응답에 id 없음: {}".format(str(body)[:300]))
    return job_id


async def _sync_get_status(job_id: str) -> dict:
    """GET /v2/generate/{id}. Returns {'status': str, 'output_url': str|None, 'error': str|None}."""
    headers = {"x-api-key": settings.sync_api_key}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{SYNC_API_BASE}/generate/{job_id}", headers=headers
        )
    if resp.status_code != 200:
        return {
            "status": "POLLING_ERROR",
            "output_url": None,
            "error": "HTTP {}".format(resp.status_code),
        }
    body = resp.json()
    return {
        "status": body.get("status", ""),
        "output_url": body.get("outputUrl") or body.get("output_url"),
        "error": body.get("errorMessage") or body.get("error"),
    }


async def generate_lipsync(
    image_bytes: bytes,
    audio_bytes: bytes,
    model: str = "lipsync-2",
) -> bytes:
    """Generate lip-synced video from a face image and audio.

    1. Convert image to short still video (ffmpeg)
    2. POST video+audio bytes directly to Sync Labs /v2/generate (multipart)
    3. Poll /v2/generate/{id} for completion
    4. Download and return result video bytes (mp4)
    """
    if not settings.sync_api_key:
        raise ValueError("SYNC_API_KEY가 설정되지 않았습니다.")

    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Save image and create still video
        image_path = os.path.join(tmpdir, "face.png")
        video_path = os.path.join(tmpdir, "face_video.mp4")
        audio_path = os.path.join(tmpdir, "audio.mp3")

        with open(image_path, "wb") as f:
            f.write(image_bytes)
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        # Get audio duration
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            capture_output=True, text=True, timeout=30,
        )
        audio_duration = float(probe.stdout.strip()) if probe.stdout.strip() else 10.0

        # Convert image to still video (same duration as audio)
        subprocess.run(
            ["ffmpeg", "-y", "-loop", "1", "-i", image_path,
             "-t", str(audio_duration),
             "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
             "-r", "25", video_path],
            capture_output=True, timeout=60,
        )

        if not os.path.exists(video_path):
            raise RuntimeError("Failed to create still video from image")

        logger.info("SyncLabs: created still video (%.1fs) from image", audio_duration)

        with open(video_path, "rb") as f:
            video_bytes_data = f.read()

        # Step 2: Call Sync Labs API with direct multipart upload
        try:
            sync_job_id = await _sync_create_with_files(
                video_bytes=video_bytes_data,
                audio_bytes=audio_bytes,
                model=model,
                options={"sync_mode": "cut_off"},
            )
            logger.info("SyncLabs: job created, id=%s", sync_job_id)
        except Exception as e:
            logger.error("SyncLabs: failed to create job: %s", e)
            if isinstance(e, ValueError):
                raise
            raise ValueError("Sync Labs 립싱크 생성 실패: {}".format(str(e)[:300]))

        # Step 3: Poll for completion (120 attempts * 10s = 20 min)
        output_url = None
        consecutive_errors = 0
        for attempt in range(120):
            await asyncio.sleep(10)
            s = await _sync_get_status(sync_job_id)
            status = s["status"]

            if status == "POLLING_ERROR":
                consecutive_errors += 1
                if consecutive_errors >= POLLING_ERROR_LIMIT:
                    raise ValueError(
                        "Sync Labs 상태 조회 {}회 연속 실패 (마지막: {}). job_id={}".format(
                            consecutive_errors, s.get("error"), sync_job_id
                        )
                    )
                logger.warning(
                    "SyncLabs poll attempt=%d POLLING_ERROR (%d/%d): %s",
                    attempt + 1, consecutive_errors, POLLING_ERROR_LIMIT, s.get("error")
                )
                continue

            # 정상 응답 시 연속 에러 카운터 리셋
            consecutive_errors = 0

            if status == "COMPLETED":
                output_url = s["output_url"]
                logger.info(
                    "SyncLabs: job %s completed, output=%s",
                    sync_job_id,
                    output_url[:100] if output_url else "None",
                )
                break
            if status in ("FAILED", "REJECTED"):
                raise ValueError(
                    "Sync Labs 립싱크 실패: {}".format(s.get("error") or status)
                )
            logger.info(
                "SyncLabs poll attempt=%d status=%s", attempt + 1, status
            )
        else:
            raise TimeoutError("Sync Labs 립싱크 시간 초과 (20분)")

        # Step 4: Download result
        if not output_url:
            raise ValueError("Sync Labs: no output URL in completed response")

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            dl_resp = await client.get(output_url)
            dl_resp.raise_for_status()
            result_bytes = dl_resp.content

        logger.info("SyncLabs: downloaded result video (%d bytes)", len(result_bytes))
        return result_bytes


async def generate_lipsync_from_video(
    video_bytes: bytes,
    audio_bytes: bytes,
    model: str = "lipsync-2",
) -> bytes:
    """Generate lip-synced video from an existing video and audio.

    Unlike generate_lipsync() which starts from a static image,
    this takes an already-animated video (e.g., from Veo) and
    corrects the lip movements to match the actual audio.

    v33: direct multipart upload to Sync Labs (no MinIO/ngrok).

    Returns video bytes (mp4).
    """
    if not settings.sync_api_key:
        raise ValueError("SYNC_API_KEY가 설정되지 않았습니다.")

    # ── 사전검증: audio_bytes size & ffprobe 메타데이터 ──
    # Sync Labs 422 'Unable to retrieve audio metadata'의 원인을 우리 쪽에서 먼저 거르고
    # 명확한 에러 메시지로 raise하여 진단성을 확보한다.
    if not audio_bytes or len(audio_bytes) < 5120:
        raise ValueError(
            "Sync Labs용 오디오가 너무 작습니다 ({}b). 업로드 전 보컬 분리/세그먼트 결과를 확인하세요.".format(
                len(audio_bytes) if audio_bytes else 0
            )
        )
    if not video_bytes or len(video_bytes) < 1024:
        raise ValueError(
            "Sync Labs용 비디오가 너무 작습니다 ({}b)".format(
                len(video_bytes) if video_bytes else 0
            )
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        audio_path = os.path.join(tmpdir, "audio.mp3")

        with open(video_path, "wb") as f:
            f.write(video_bytes)
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        # ffprobe로 오디오 메타데이터 검증 (duration + streams)
        try:
            import json as _json
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet",
                 "-print_format", "json",
                 "-show_format", "-show_streams",
                 audio_path],
                capture_output=True, text=True, timeout=20,
            )
            if probe.returncode != 0:
                raise ValueError(
                    "Sync Labs용 오디오 ffprobe 실패 (rc={}): {}".format(
                        probe.returncode, (probe.stderr or "")[:300]
                    )
                )
            probe_json = _json.loads(probe.stdout or "{}")
            fmt = probe_json.get("format") or {}
            streams = probe_json.get("streams") or []
            dur_str = fmt.get("duration")
            try:
                duration = float(dur_str) if dur_str else 0.0
            except (TypeError, ValueError):
                duration = 0.0
            if not streams:
                raise ValueError(
                    "Sync Labs용 오디오 스트림이 비어있습니다 (size={}b)".format(len(audio_bytes))
                )
            has_audio_codec = any(
                (s.get("codec_type") == "audio" and s.get("codec_name"))
                for s in streams
            )
            if not has_audio_codec:
                raise ValueError(
                    "Sync Labs용 오디오 codec을 찾을 수 없습니다 (size={}b)".format(len(audio_bytes))
                )
            if duration < 0.3:
                raise ValueError(
                    "Sync Labs용 오디오 duration이 너무 짧습니다 ({:.3f}초, size={}b)".format(
                        duration, len(audio_bytes)
                    )
                )
        except ValueError:
            raise
        except Exception as probe_err:
            logger.warning("SyncLabs (video): audio probe error: %s", probe_err)
            raise ValueError(
                "Sync Labs용 오디오 메타데이터 검증 실패: {}".format(str(probe_err)[:200])
            )

        # Call Sync Labs API via direct multipart upload
        try:
            sync_job_id = await _sync_create_with_files(
                video_bytes=video_bytes,
                audio_bytes=audio_bytes,
                model=model,
                options={"sync_mode": "cut_off"},
            )
            logger.info("SyncLabs (video): job created, id=%s", sync_job_id)
        except Exception as e:
            logger.error("SyncLabs (video): failed to create job: %s", e)
            if isinstance(e, ValueError):
                raise
            raise ValueError("Sync Labs 립싱크 후보정 실패: {}".format(str(e)[:300]))

        # Poll for completion (120 * 10s = 20 min)
        output_url = None
        consecutive_errors = 0
        for attempt in range(120):
            await asyncio.sleep(10)
            s = await _sync_get_status(sync_job_id)
            status = s["status"]

            if status == "POLLING_ERROR":
                consecutive_errors += 1
                if consecutive_errors >= POLLING_ERROR_LIMIT:
                    raise ValueError(
                        "Sync Labs 상태 조회 {}회 연속 실패 (마지막: {}). job_id={}".format(
                            consecutive_errors, s.get("error"), sync_job_id
                        )
                    )
                logger.warning(
                    "SyncLabs (video) poll attempt=%d POLLING_ERROR (%d/%d): %s",
                    attempt + 1, consecutive_errors, POLLING_ERROR_LIMIT, s.get("error")
                )
                continue

            # 정상 응답 시 연속 에러 카운터 리셋
            consecutive_errors = 0

            if status == "COMPLETED":
                output_url = s["output_url"]
                logger.info("SyncLabs (video): job %s completed", sync_job_id)
                break
            if status in ("FAILED", "REJECTED"):
                raise ValueError(
                    "Sync Labs 립싱크 후보정 실패: {}".format(
                        s.get("error") or status
                    )
                )
            logger.info(
                "SyncLabs (video) poll attempt=%d status=%s", attempt + 1, status
            )
        else:
            raise TimeoutError("Sync Labs 립싱크 후보정 시간 초과 (20분)")

        if not output_url:
            raise ValueError("Sync Labs: no output URL")

        # Download result
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            dl_resp = await client.get(output_url)
            dl_resp.raise_for_status()
            result_bytes = dl_resp.content

        logger.info("SyncLabs (video): downloaded result (%d bytes)", len(result_bytes))
        return result_bytes


def cut_audio_segment(audio_bytes: bytes, start_sec: float, end_sec: float) -> bytes:
    """Cut a segment from audio using ffmpeg. Returns MP3 bytes.

    강화된 검증:
    - 입력 바이트/시간 범위 검증
    - ffmpeg returncode 확인 + stderr 로깅
    - 출력 파일 size 검증
    - ffprobe로 duration 검증 (Sync Labs 메타데이터 추출 실패 방지)
    """
    # ── 1) 입력 검증 ──
    if not audio_bytes or len(audio_bytes) < 1024:
        raise ValueError(
            "cut_audio_segment: 입력 오디오가 너무 작습니다 (size={}b)".format(
                len(audio_bytes) if audio_bytes else 0
            )
        )
    try:
        start_sec = float(start_sec)
        end_sec = float(end_sec)
    except (TypeError, ValueError):
        raise ValueError(
            "cut_audio_segment: start_sec/end_sec가 숫자가 아닙니다 (start={}, end={})".format(
                start_sec, end_sec
            )
        )
    if start_sec < 0:
        raise ValueError("cut_audio_segment: start_sec가 음수입니다 ({})".format(start_sec))
    if end_sec <= start_sec:
        raise ValueError(
            "cut_audio_segment: end_sec({}) <= start_sec({})".format(end_sec, start_sec)
        )
    if end_sec - start_sec < 0.5:
        raise ValueError(
            "cut_audio_segment: 구간이 너무 짧습니다 ({:.3f}초, 최소 0.5초)".format(
                end_sec - start_sec
            )
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "input.mp3")
        output_path = os.path.join(tmpdir, "segment.mp3")

        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # ── 2) ffmpeg: -ss는 -i 앞(fast input seek), -vn/ar/ac로 메타데이터 일관성 확보 ──
        result = subprocess.run(
            ["ffmpeg", "-y",
             "-ss", str(start_sec),
             "-to", str(end_sec),
             "-i", input_path,
             "-vn",
             "-ar", "44100",
             "-ac", "2",
             "-codec:a", "libmp3lame",
             "-b:a", "192k",
             output_path],
            capture_output=True, timeout=30,
        )

        stderr_text = ""
        try:
            stderr_text = (result.stderr or b"").decode("utf-8", errors="replace")
        except Exception:
            stderr_text = ""

        if result.returncode != 0:
            tail = stderr_text[-200:] if stderr_text else ""
            logger.warning("cut_audio_segment: ffmpeg returncode=%s stderr_tail=%s",
                           result.returncode, tail)
            raise RuntimeError(
                "cut_audio_segment: ffmpeg 실패 (rc={}): {}".format(
                    result.returncode, (stderr_text or "")[:500]
                )
            )

        if not os.path.exists(output_path):
            tail = stderr_text[-200:] if stderr_text else ""
            logger.warning("cut_audio_segment: output missing; stderr_tail=%s", tail)
            raise RuntimeError("cut_audio_segment: 출력 파일이 생성되지 않았습니다")

        # ── 3) 출력 크기 검증 ──
        out_size = os.path.getsize(output_path)
        if out_size < 1024:
            tail = stderr_text[-200:] if stderr_text else ""
            logger.warning(
                "cut_audio_segment: cut audio too small size=%d stderr_tail=%s",
                out_size, tail,
            )
            raise RuntimeError(
                "cut_audio_segment: Cut audio too small (size={})".format(out_size)
            )

        # ── 4) ffprobe duration 검증 ──
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet",
                 "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1",
                 output_path],
                capture_output=True, text=True, timeout=15,
            )
            dur_str = (probe.stdout or "").strip()
            duration = float(dur_str) if dur_str else 0.0
        except Exception as probe_err:
            logger.warning("cut_audio_segment: ffprobe error: %s", probe_err)
            duration = 0.0

        if duration < 0.3:
            tail = stderr_text[-200:] if stderr_text else ""
            logger.warning(
                "cut_audio_segment: duration too short (%.3fs), size=%d, stderr_tail=%s",
                duration, out_size, tail,
            )
            raise RuntimeError(
                "cut_audio_segment: 출력 duration이 너무 짧습니다 ({:.3f}초)".format(duration)
            )

        with open(output_path, "rb") as f:
            return f.read()
