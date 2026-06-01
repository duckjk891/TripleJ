"""
v23.4 — Extra Video Continue: 이전 영상 마지막 프레임 추출 헬퍼.

부모 mp4 (videos 버킷) 의 마지막 프레임을 PNG 로 추출해서 photos 버킷에 저장한다.
저장 경로: `extra/{mv_job_id}/continue_frames/{extra_video_id}.png`.

흐름:
  1) videos 버킷에서 부모 mp4 다운로드 → 임시 파일.
  2) ffmpeg `-sseof -0.5 -i <in.mp4> -vframes 1 -update 1 -f image2 <out.png>`
     로 마지막 0.5 초 시점의 1 프레임 추출.
  3) PNG 를 photos 버킷에 put_object → object_name 반환.

ffmpeg 경로는 `pre_mv_phase4_compositor.get_ffmpeg_path()` 재사용 (v23.0 패턴).

추적자: extra_video_id, mv_job_id, source_kind="prev_video_last_frame".
로그 prefix: `[ExtraVideoFrame]`. 민감 정보 출력 금지.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import tempfile

from ..config import settings
from ..database.minio import get_minio
from .pre_mv_phase4_compositor import get_ffmpeg_path

logger = logging.getLogger(__name__)


async def extract_last_frame_png(
    *,
    extra_video_id: str,
    mv_job_id: str,
    video_object_name: str,
) -> str:
    """videos 버킷의 mp4 → 마지막 프레임 PNG 추출 → photos 버킷 업로드.

    Args:
      extra_video_id:    새 자식(=continue) 영상의 id (PNG 파일명에 사용).
      mv_job_id:         tracing + photos 버킷 경로 prefix.
      video_object_name: 부모 mp4 의 videos 버킷 내부 object_name.

    Returns:
      추출된 PNG 의 photos 버킷 내부 object_name.

    Raises:
      RuntimeError(한국어 메시지): ffmpeg 미설치 / mp4 다운로드 실패 / ffmpeg 실행 실패
                                   / put_object 실패.
    """
    if not video_object_name:
        raise RuntimeError("이전 영상의 저장 경로를 찾을 수 없어요.")

    ffmpeg_bin = get_ffmpeg_path()
    if not ffmpeg_bin:
        logger.warning(
            "[ExtraVideoFrame] ffmpeg not available extra_video_id=%s mv_job_id=%s",
            extra_video_id, mv_job_id,
        )
        raise RuntimeError(
            "ffmpeg 가 설치되지 않았어요. 운영자에게 문의해 주세요."
        )

    minio_client = get_minio()
    if minio_client is None:
        raise RuntimeError("MinIO 클라이언트가 초기화되지 않았어요.")

    tmp_dir = tempfile.mkdtemp(prefix="continue_frame_")
    in_path = os.path.join(tmp_dir, "input.mp4")
    out_path = os.path.join(tmp_dir, "last.png")

    try:
        # 1) videos 버킷에서 mp4 다운로드 ──────────────────────────────────
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_videos,
                object_name=video_object_name,
            )
            try:
                with open(in_path, "wb") as f:
                    for chunk in resp.stream(64 * 1024):
                        f.write(chunk)
            finally:
                try:
                    resp.close()
                    resp.release_conn()
                except Exception:
                    pass
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[ExtraVideoFrame] mp4 download failed extra_video_id=%s "
                "mv_job_id=%s object=%s: %s: %s",
                extra_video_id, mv_job_id, video_object_name,
                type(e).__name__, str(e)[:200],
            )
            raise RuntimeError(
                "이전 영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
            )

        try:
            in_size = os.path.getsize(in_path)
        except OSError:
            in_size = 0
        if in_size < 64:
            logger.warning(
                "[ExtraVideoFrame] mp4 too small extra_video_id=%s mv_job_id=%s "
                "object=%s bytes=%d",
                extra_video_id, mv_job_id, video_object_name, in_size,
            )
            raise RuntimeError(
                "이전 영상이 비어 있거나 손상되어 있어요."
            )

        # 2) ffmpeg 로 마지막 프레임 PNG 추출 ─────────────────────────────
        #    -sseof -0.5  : 파일 끝에서 0.5 초 전 시점으로 seek
        #    -vframes 1   : 1 프레임만
        #    -update 1    : 단일 이미지 출력 (frame index suffix 안 붙임)
        #    -f image2    : 이미지 출력 포맷
        #    -y           : 기존 파일 덮어쓰기
        args = [
            "-y",
            "-sseof", "-0.5",
            "-i", in_path,
            "-vframes", "1",
            "-update", "1",
            "-f", "image2",
            out_path,
        ]
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        stderr_text = (stderr or b"").decode(errors="replace")
        logger.info(
            "[ExtraVideoFrame] ffmpeg extract extra_video_id=%s mv_job_id=%s "
            "rc=%d in_bytes=%d stderr_tail=%s",
            extra_video_id, mv_job_id, proc.returncode, in_size,
            stderr_text[-240:].replace("\n", " | "),
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "이전 영상의 마지막 프레임을 추출하지 못했어요."
            )

        try:
            png_size = os.path.getsize(out_path)
        except OSError:
            png_size = 0
        if png_size < 64:
            logger.warning(
                "[ExtraVideoFrame] png too small extra_video_id=%s mv_job_id=%s "
                "bytes=%d",
                extra_video_id, mv_job_id, png_size,
            )
            raise RuntimeError(
                "이전 영상의 마지막 프레임을 추출하지 못했어요."
            )

        with open(out_path, "rb") as f:
            png_bytes = f.read()

        # 3) photos 버킷에 PNG 업로드 ─────────────────────────────────────
        target_object = "extra/{}/continue_frames/{}.png".format(
            mv_job_id, extra_video_id,
        )
        try:
            minio_client.put_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=target_object,
                data=io.BytesIO(png_bytes),
                length=len(png_bytes),
                content_type="image/png",
            )
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "[ExtraVideoFrame] put_object failed extra_video_id=%s "
                "mv_job_id=%s object=%s: %s: %s",
                extra_video_id, mv_job_id, target_object,
                type(e).__name__, str(e)[:200],
            )
            raise RuntimeError(
                "추출한 프레임을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
            )

        logger.info(
            "[ExtraVideoFrame] ok extra_video_id=%s mv_job_id=%s object=%s "
            "bytes=%d",
            extra_video_id, mv_job_id, target_object, len(png_bytes),
        )
        return target_object

    finally:
        # 임시 디렉토리 청소.
        for p in (in_path, out_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


# ──────────────────────────────────────────────────────────────────────────
# v24 — Pre-MV Phase 3 chapter chain: 씬 영상 마지막 프레임 추출
# ──────────────────────────────────────────────────────────────────────────

async def extract_scene_last_frame_png(
    *,
    pre_mv_job_id: str,
    scene_number: int,
    video_object_name: str,
) -> str:
    """식전영상 씬 mp4 → 마지막 프레임 PNG → photos 버킷 업로드.

    `extract_last_frame_png` 와 동일한 ffmpeg 로직을 재사용한다. 결과 object_name 만
    경로가 다르다.

    Args:
      pre_mv_job_id: tracing + photos 버킷 경로 prefix.
      scene_number:  1-based 씬 번호 (파일명에 사용).
      video_object_name: 씬 mp4 의 videos 버킷 object_name.

    Returns:
      추출된 PNG 의 photos 버킷 내부 object_name:
      `pre_mv/{pre_mv_job_id}/last_frames/{N:03d}.png`.

    Raises:
      RuntimeError(한국어 메시지): ffmpeg 미설치 / mp4 다운로드 실패 / 추출 실패 /
                                   업로드 실패.
    """
    if not video_object_name:
        raise RuntimeError("이전 씬 영상의 저장 경로를 찾을 수 없어요.")

    ffmpeg_bin = get_ffmpeg_path()
    if not ffmpeg_bin:
        logger.warning(
            "[PreMVPhase3Chain] ffmpeg not available pre_mv_job_id=%s scene_number=%d",
            pre_mv_job_id, scene_number,
        )
        raise RuntimeError(
            "ffmpeg 가 설치되지 않았어요. 운영자에게 문의해 주세요."
        )

    minio_client = get_minio()
    if minio_client is None:
        raise RuntimeError("MinIO 클라이언트가 초기화되지 않았어요.")

    tmp_dir = tempfile.mkdtemp(prefix="pre_mv_last_frame_")
    in_path = os.path.join(tmp_dir, "input.mp4")
    out_path = os.path.join(tmp_dir, "last.png")

    try:
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_videos,
                object_name=video_object_name,
            )
            try:
                with open(in_path, "wb") as f:
                    for chunk in resp.stream(64 * 1024):
                        f.write(chunk)
            finally:
                try:
                    resp.close()
                    resp.release_conn()
                except Exception:
                    pass
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[PreMVPhase3Chain] mp4 download failed pre_mv_job_id=%s "
                "scene_number=%d object=%s: %s: %s",
                pre_mv_job_id, scene_number, video_object_name,
                type(e).__name__, str(e)[:200],
            )
            raise RuntimeError(
                "이전 씬 영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
            )

        try:
            in_size = os.path.getsize(in_path)
        except OSError:
            in_size = 0
        if in_size < 64:
            logger.warning(
                "[PreMVPhase3Chain] mp4 too small pre_mv_job_id=%s scene_number=%d "
                "object=%s bytes=%d",
                pre_mv_job_id, scene_number, video_object_name, in_size,
            )
            raise RuntimeError("이전 씬 영상이 비어 있거나 손상되어 있어요.")

        args = [
            "-y",
            "-sseof", "-0.5",
            "-i", in_path,
            "-vframes", "1",
            "-update", "1",
            "-f", "image2",
            out_path,
        ]
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        stderr_text = (stderr or b"").decode(errors="replace")
        logger.info(
            "[PreMVPhase3Chain] ffmpeg extract pre_mv_job_id=%s scene_number=%d "
            "rc=%d in_bytes=%d stderr_tail=%s",
            pre_mv_job_id, scene_number, proc.returncode, in_size,
            stderr_text[-240:].replace("\n", " | "),
        )
        if proc.returncode != 0:
            raise RuntimeError("이전 씬 영상의 마지막 프레임을 추출하지 못했어요.")

        try:
            png_size = os.path.getsize(out_path)
        except OSError:
            png_size = 0
        if png_size < 64:
            logger.warning(
                "[PreMVPhase3Chain] png too small pre_mv_job_id=%s scene_number=%d "
                "bytes=%d",
                pre_mv_job_id, scene_number, png_size,
            )
            raise RuntimeError("이전 씬 영상의 마지막 프레임을 추출하지 못했어요.")

        with open(out_path, "rb") as f:
            png_bytes = f.read()

        target_object = "pre_mv/{}/last_frames/{:03d}.png".format(
            pre_mv_job_id, scene_number,
        )
        try:
            minio_client.put_object(
                bucket_name=settings.minio_bucket_photos,
                object_name=target_object,
                data=io.BytesIO(png_bytes),
                length=len(png_bytes),
                content_type="image/png",
            )
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "[PreMVPhase3Chain] put_object failed pre_mv_job_id=%s "
                "scene_number=%d object=%s: %s: %s",
                pre_mv_job_id, scene_number, target_object,
                type(e).__name__, str(e)[:200],
            )
            raise RuntimeError(
                "추출한 프레임을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
            )

        logger.info(
            "[PreMVPhase3Chain] last_frame_extract ok pre_mv_job_id=%s "
            "scene_number=%d object=%s bytes=%d",
            pre_mv_job_id, scene_number, target_object, len(png_bytes),
        )
        return target_object

    finally:
        for p in (in_path, out_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass
