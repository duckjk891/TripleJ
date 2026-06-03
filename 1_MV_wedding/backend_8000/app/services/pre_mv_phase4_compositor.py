"""
v17.3 — Pre-MV Phase 4: 씬 영상 concat + 오디오 머지 (자막 X).

9004 mv_pipeline.py L3146~3454 의 Phase 4/5 흐름을 단순화해 이식.

흐름:
  1) 모든 씬의 `video_object_name` 을 MinIO videos 버킷에서 받아 임시 디렉토리에 저장.
     scene_number 순으로 정렬.
  2) ffmpeg concat:
     · 우선 `-c copy` (빠르고 무손실 — 모든 클립의 codec 이 같을 때 가능).
     · 실패 시 `libx264` + `aac` 재인코딩 fallback.
  3) mv_jobs.audio_object_name (audio 버킷) 의 오디오 다운로드 → ffmpeg `-c:v copy -c:a aac`
     로 영상에 머지. `-shortest` 로 영상-오디오 길이 일치.
  4) 최종 mp4 → MinIO videos 버킷의 `pre_mv/{pre_mv_job_id}/result.mp4` 로 업로드.

호출자(라우트) 가 받을 결과: `{result_video_object_name, video_bytes_size, duration_sec}`.

자막은 추가하지 않는다 (사용자 명시 — 식전영상은 깔끔한 영상만).

추적자: pre_mv_job_id, phase=phase4, scene_count, concat_mode, final_bytes, elapsed_ms.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import shutil
import tempfile
import time
from typing import Optional

from ..config import settings
from ..database.minio import get_minio


# v42 — section label entry (e.g., "[Intro]", "[Verse 1 - 메인 보컬]") 매칭.
_SECTION_LABEL_RE = re.compile(r"^\s*\[[^\]]+\]\s*$")

# v42.3 — segments.text 의 앞쪽 `[...]` prefix 추출용 (label + 가사 혼합 케이스).
# 예: "[Intro - 듀엣] 오늘" → group(1)="Intro - 듀엣", group(2)=" 오늘"
_LEADING_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\](.*)$", re.DOTALL)


def _to_srt_time(sec: float) -> str:
    """초 → SRT timecode (HH:MM:SS,mmm)."""
    if sec is None or sec < 0:
        sec = 0.0
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    if ms == 1000:
        ms = 0
        s += 1
    return "{:02d}:{:02d}:{:02d},{:03d}".format(h, m, s, ms)


def generate_srt_from_segments(
    segments: list[dict],
    video_start_offset_sec: float = 0.0,
) -> str:
    """lyric_timestamps_variants[N] segments 를 SRT 텍스트로 변환.

    · section label-only entry ([Intro] 단독) 는 skip.
    · 본문 빈 entry 도 skip.
    · v42.3 — text 가 "[Intro - 듀엣] 오늘" 같이 label+가사 혼합이면 label prefix 만 제거.
    · video_start_offset_sec > 0 면 모든 cue 의 start/end 에서 그 값을 빼서 영상 timeline 에 맞춤.
    · offset 빼고 end<=0 (영상 시작 전에 끝난 라인) → skip.
    · "[This song is a duet ...]" 같은 Suno duet 헤더 entry 도 skip (대괄호 안에 "duet" 같은
      메타 단어만 가득 → 가사 아님). LEADING_SECTION 매치 + 나머지 text 비어있으면 skip.
    """
    out_lines: list[str] = []
    cue_idx = 1
    pad = max(0.0, float(video_start_offset_sec or 0.0))
    for seg in segments or []:
        text = (str(seg.get("text") or "")).strip()
        if not text or _SECTION_LABEL_RE.match(text):
            continue
        # v42.3 — leading [...] prefix 제거
        m = _LEADING_SECTION_RE.match(text)
        if m:
            rest = (m.group(2) or "").strip()
            if not rest:
                continue  # label 만 있는 entry — skip
            text = rest
        start_raw = float(seg.get("start") or 0.0)
        end_raw = float(seg.get("end") or 0.0)
        start = start_raw - pad
        end = end_raw - pad
        if end <= 0 or end <= start:
            continue
        if start < 0:
            start = 0.0
        out_lines.append("{}\n{} --> {}\n{}\n".format(
            cue_idx, _to_srt_time(start), _to_srt_time(end), text,
        ))
        cue_idx += 1
    return "\n".join(out_lines)


def calculate_video_start_offset(
    *,
    aligned_words: list[dict],
    segments_fallback: list[dict],
) -> float:
    """v42 — [Intro] 다음 첫 비-Intro section label 의 start 추출.

    v42.3 — Suno 의 aligned_words 는 section label 도 단어 분할로 들어옴
    (예: '[This ', 'song ', 'is ', 'a ', 'duet '). 정규식 매칭 안 됨.
    따라서 segments 의 text leading `[...]` prefix 로 section 결정으로 전환.
    segments 가 더 안정적인 source (라인 단위 + label prefix 보존).

    aligned_words 인자는 backward-compat 위해 시그니처에만 유지 (실제 사용 X).

    동작:
    · segments 순회하며 text 의 leading `[label]` 추출
    · label.lower() 가 'intro' 로 시작하거나 'song is a duet' 같은 메타 헤더면 건너뜀
    · 첫 비-intro 비-meta label 발견 시 그 segment.start 반환 (= [Verse 1] 등 시작)
    · 못 찾으면 0.0 (fallback)
    """
    found_intro_or_meta = False
    for seg in segments_fallback or []:
        text = (str((seg or {}).get("text") or "")).strip()
        if not text:
            continue
        m = _LEADING_SECTION_RE.match(text)
        if not m:
            continue
        label = m.group(1).strip().lower()
        is_meta = (
            label.startswith("intro")
            or "duet" in label  # "[This song is a duet featuring ...]"
            or "song is a" in label
        )
        if is_meta:
            found_intro_or_meta = True
            continue
        if found_intro_or_meta:
            return float((seg or {}).get("start") or 0.0)

    # 못 찾으면 0 — intro 가 없는 곡 또는 라벨 없는 곡.
    return 0.0

logger = logging.getLogger(__name__)


def get_ffmpeg_path() -> Optional[str]:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def ffmpeg_available() -> bool:
    return get_ffmpeg_path() is not None


async def _download_object(
    *,
    bucket: str,
    object_name: str,
    target_path: str,
) -> None:
    """MinIO 객체 → 로컬 파일. 스트리밍 다운로드."""
    minio_client = get_minio()
    if minio_client is None:
        raise RuntimeError("MinIO 클라이언트가 초기화되지 않았습니다.")
    resp = minio_client.get_object(bucket_name=bucket, object_name=object_name)
    try:
        with open(target_path, "wb") as f:
            for chunk in resp.stream(32 * 1024):
                f.write(chunk)
    finally:
        try:
            resp.close()
            resp.release_conn()
        except Exception:
            pass


async def _run_ffmpeg(
    *,
    args: list[str],
    label: str,
    pre_mv_job_id: str,
) -> tuple[int, str]:
    """ffmpeg 실행. (returncode, stderr_str) 반환."""
    ffmpeg_bin = get_ffmpeg_path()
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg 가 설치되어 있지 않습니다.")
    proc = await asyncio.create_subprocess_exec(
        ffmpeg_bin, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    stderr_text = (stderr or b"").decode(errors="replace")
    logger.info(
        "[PreMVPhase4] %s pre_mv_job_id=%s rc=%d stderr_tail=%s",
        label, pre_mv_job_id, proc.returncode, stderr_text[-300:].replace("\n", " | "),
    )
    return proc.returncode, stderr_text


async def _concat_scenes(
    *,
    pre_mv_job_id: str,
    clip_paths: list[str],
    out_path: str,
) -> str:
    """씬 영상들을 하나의 mp4 로. 우선 copy 모드, 실패 시 재인코딩.

    Returns:
      concat_mode 문자열 ("copy" 또는 "reencode").

    Raises:
      RuntimeError: 모든 모드 실패.
    """
    tmpdir = os.path.dirname(out_path)
    concat_list_path = os.path.join(tmpdir, "concat.txt")
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for cp in clip_paths:
            # ffmpeg concat 데미터 파일 형식 — 경로는 single quote 로 감싸기.
            f.write("file '{}'\n".format(cp.replace("'", r"\'")))

    # 1) copy 모드 (빠름, 무손실, 모든 클립 코덱/타임베이스 같을 때 가능)
    rc, stderr_text = await _run_ffmpeg(
        args=[
            "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c", "copy", out_path,
        ],
        label="concat_copy",
        pre_mv_job_id=pre_mv_job_id,
    )
    if rc == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
        return "copy"

    # 2) 재인코딩 fallback (codec/timebase 불일치 시)
    logger.info(
        "[PreMVPhase4] concat_copy failed pre_mv_job_id=%s — falling back to re-encode",
        pre_mv_job_id,
    )
    rc2, stderr_text2 = await _run_ffmpeg(
        args=[
            "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list_path,
            "-c:v", "libx264", "-preset", "fast",
            "-c:a", "aac",
            "-movflags", "+faststart",
            out_path,
        ],
        label="concat_reencode",
        pre_mv_job_id=pre_mv_job_id,
    )
    if rc2 == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
        return "reencode"

    raise RuntimeError(
        "ffmpeg concat 실패: copy_err={} reencode_err={}".format(
            stderr_text[-200:], stderr_text2[-200:]
        )
    )


async def _merge_audio(
    *,
    pre_mv_job_id: str,
    video_path: str,
    audio_path: str,
    out_path: str,
    video_start_offset_sec: float = 0.0,
    srt_path: Optional[str] = None,
) -> None:
    """영상 + 오디오 머지. video copy + audio aac. `-shortest` 로 종료시점 일치.

    v41 — video_start_offset_sec > 0 면 영상 stream 을 N초 지연 (instrumental intro 동안 검정).
    음악은 0초부터 재생, 영상은 N초부터 시작 → 첫 가사 시점과 영상 시작 sync.
    """
    pad = max(0.0, float(video_start_offset_sec or 0.0))
    pad_args: list[str] = []
    if pad > 0:
        # -itsoffset 은 다음 입력 (-i) 에만 적용. 영상 stream 의 시작 시간을 +pad 초로 이동.
        pad_args = ["-itsoffset", "{:.3f}".format(pad)]
        logger.info(
            "[PreMVPhase4] merge video delayed pre_mv_job_id=%s offset_sec=%.3f",
            pre_mv_job_id, pad,
        )

    # v42 — 자막 burn-in 시 reencode 강제 (subtitles filter 는 copy 모드와 호환 X).
    need_reencode = pad > 0 or bool(srt_path)
    if need_reencode:
        rc = 1  # copy 모드 강제 skip → reencode 분기 진입
        stderr_text = (
            "v42: skipped copy mode (pad>0 or srt subtitles requested)"
        )
    else:
        rc, stderr_text = await _run_ffmpeg(
            args=[
                "-y",
                "-i", video_path,
                "-i", audio_path,
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
                out_path,
            ],
            label="merge_audio",
            pre_mv_job_id=pre_mv_job_id,
        )
    if rc != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
        # video copy 가 잘 안 되는 경우 (codec 이상) 또는 pad/srt 가 있어서 강제 reencode.
        logger.info(
            "[PreMVPhase4] merge copy_failed pre_mv_job_id=%s — falling back to re-encode",
            pre_mv_job_id,
        )
        # v42 — srt_path 있으면 subtitles filter 추가. 폰트는 시스템 default.
        # subtitles filter 는 path 안 쪽 : 와 \ 를 escape 해야 함.
        filter_args: list[str] = []
        if srt_path:
            escaped_srt = (
                srt_path.replace("\\", "\\\\")
                        .replace(":", "\\:")
                        .replace("'", "\\'")
            )
            # v42.1 — 뮤비 스타일 (옵션 B): 반투명 검정 박스 배경.
            # BorderStyle=3 = box background, Outline=8 은 박스 두께 (글자 padding 효과).
            # BackColour 의 alpha = &H80 (50% 투명).
            # v42.2 — MarginV=30 (값이 작을수록 화면 하단에 더 가까움).
            filter_args = [
                "-vf",
                "subtitles='{}':force_style='Alignment=2,MarginV=30,"
                "Fontsize=18,PrimaryColour=&HFFFFFF&,"
                "OutlineColour=&H80000000&,BackColour=&H80000000&,"
                "Outline=8,Shadow=0,BorderStyle=3'".format(escaped_srt),
            ]
            logger.info(
                "[PreMVPhase4] subtitles filter applied pre_mv_job_id=%s srt=%s",
                pre_mv_job_id, srt_path,
            )
        rc2, stderr_text2 = await _run_ffmpeg(
            args=[
                "-y",
                *pad_args,
                "-i", video_path,
                "-i", audio_path,
                *filter_args,
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                "-movflags", "+faststart",
                "-shortest",
                out_path,
            ],
            label="merge_audio_reencode",
            pre_mv_job_id=pre_mv_job_id,
        )
        if rc2 != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
            raise RuntimeError(
                "ffmpeg audio merge 실패: copy_err={} reencode_err={}".format(
                    stderr_text[-200:], stderr_text2[-200:]
                )
            )


async def compose_pre_mv_result(
    *,
    pre_mv_job_id: str,
    scenes: list[dict],
    audio_object_name: Optional[str],
    video_start_offset_sec: float = 0.0,
    srt_text: Optional[str] = None,
) -> dict:
    """씬 영상들을 concat → (오디오 있으면) 머지 → MinIO 업로드.

    Args:
      pre_mv_job_id: tracing.
      scenes: pre_mv_jobs.scenes — 모든 씬이 video_status=completed + video_object_name 보유여야 함.
      audio_object_name: mv_jobs.audio_object_name. None 이면 무음 영상으로 마무리.

    Returns:
      {
        "result_object_name": str,
        "concat_mode": "copy"|"reencode",
        "scene_count": int,
        "size_bytes": int,
        "had_audio": bool,
      }

    Raises:
      RuntimeError: ffmpeg/MinIO 실패.
      ValueError: 입력 검증 실패.
    """
    started = time.time()

    if not ffmpeg_available():
        raise RuntimeError(
            "ffmpeg 가 설치되어 있지 않아 영상을 합칠 수 없습니다."
        )

    completed = [
        s for s in (scenes or [])
        if (s or {}).get("video_status") == "completed"
        and (s or {}).get("video_object_name")
    ]
    if not completed:
        raise ValueError("합칠 완료된 씬 영상이 없습니다.")
    completed.sort(key=lambda s: s.get("scene_number") or 0)

    logger.info(
        "[PreMVPhase4] entry pre_mv_job_id=%s scene_count=%d audio=%s",
        pre_mv_job_id, len(completed), bool(audio_object_name),
    )

    minio_client = get_minio()
    if minio_client is None:
        raise RuntimeError("MinIO 클라이언트가 초기화되지 않았습니다.")

    tmpdir = tempfile.mkdtemp(prefix="pre_mv_phase4_")
    try:
        # 1) 씬 영상 다운로드
        clip_paths: list[str] = []
        for s in completed:
            sn = int(s.get("scene_number") or 0)
            obj = s.get("video_object_name")
            local = os.path.join(tmpdir, "scene_{:03d}.mp4".format(sn))
            try:
                await _download_object(
                    bucket=settings.minio_bucket_videos,
                    object_name=obj,
                    target_path=local,
                )
            except Exception as e:
                logger.warning(
                    "[PreMVPhase4] scene download failed pre_mv_job_id=%s scene=%d "
                    "object=%s err=%s: %s — skipping scene",
                    pre_mv_job_id, sn, obj, type(e).__name__, str(e)[:200],
                )
                continue
            if not os.path.exists(local) or os.path.getsize(local) < 1024:
                logger.warning(
                    "[PreMVPhase4] scene file too small pre_mv_job_id=%s scene=%d",
                    pre_mv_job_id, sn,
                )
                continue
            clip_paths.append(local)

        if not clip_paths:
            raise RuntimeError("씬 영상 다운로드에 모두 실패했습니다.")

        # 2) concat
        concat_out = os.path.join(tmpdir, "concat.mp4")
        if len(clip_paths) == 1:
            shutil.copyfile(clip_paths[0], concat_out)
            concat_mode = "single"
        else:
            concat_mode = await _concat_scenes(
                pre_mv_job_id=pre_mv_job_id,
                clip_paths=clip_paths,
                out_path=concat_out,
            )

        final_local_path = concat_out
        had_audio = False

        # 3) 오디오 머지 (있을 때만)
        if audio_object_name:
            try:
                audio_local = os.path.join(tmpdir, "audio.mp3")
                await _download_object(
                    bucket=settings.minio_bucket_audio,
                    object_name=audio_object_name,
                    target_path=audio_local,
                )
                if not os.path.exists(audio_local) or os.path.getsize(audio_local) < 1024:
                    raise RuntimeError("오디오 파일이 비어 있습니다.")
                merged_path = os.path.join(tmpdir, "merged.mp4")
                # v42 — SRT 파일 임시 디스크에 쓰고 path 전달.
                srt_path: Optional[str] = None
                if srt_text and srt_text.strip():
                    srt_path = os.path.join(tmpdir, "subs.srt")
                    with open(srt_path, "w", encoding="utf-8") as sf:
                        sf.write(srt_text)
                await _merge_audio(
                    pre_mv_job_id=pre_mv_job_id,
                    video_path=concat_out,
                    audio_path=audio_local,
                    out_path=merged_path,
                    video_start_offset_sec=video_start_offset_sec,
                    srt_path=srt_path,
                )
                final_local_path = merged_path
                had_audio = True
            except Exception as e:
                # 오디오 머지 실패는 치명적이지 않음 — 무음 영상으로 fallback.
                logger.warning(
                    "[PreMVPhase4] audio merge failed pre_mv_job_id=%s "
                    "err=%s: %s — using video-only result",
                    pre_mv_job_id, type(e).__name__, str(e)[:200],
                )
                had_audio = False

        # 4) MinIO 업로드 — videos 버킷의 pre_mv/{job_id}/result.mp4
        result_object_name = "pre_mv/{}/result.mp4".format(pre_mv_job_id)
        with open(final_local_path, "rb") as f:
            video_data = f.read()
        if len(video_data) < 1024:
            raise RuntimeError("최종 영상이 비어 있습니다.")

        minio_client.put_object(
            bucket_name=settings.minio_bucket_videos,
            object_name=result_object_name,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        elapsed_ms = int((time.time() - started) * 1000)
        logger.info(
            "[PreMVPhase4] ok pre_mv_job_id=%s scenes=%d concat_mode=%s had_audio=%s "
            "size_bytes=%d elapsed_ms=%d object=%s",
            pre_mv_job_id, len(clip_paths), concat_mode, had_audio,
            len(video_data), elapsed_ms, result_object_name,
        )
        return {
            "result_object_name": result_object_name,
            "concat_mode": concat_mode,
            "scene_count": len(clip_paths),
            "size_bytes": len(video_data),
            "had_audio": had_audio,
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
