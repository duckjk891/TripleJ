"""v76.3: 사용자 업로드 음원을 sunoapi 가 잘 받는 표준 형식으로 ffmpeg 정규화.

기준 출력:
  - 컨테이너: mp3
  - 채널: stereo (2)
  - 샘플레이트: 44100Hz
  - 비트레이트: 192kbps
  - duration 무손실 (전체 보존)

호출:
  normalize_audio_bytes(in_bytes, in_ext) -> (out_bytes_mp3, meta_dict)
  meta_dict = {duration_s, in_codec, in_channels, in_sample_rate, in_bitrate, out_size}

사유:
  - sunoapi /voice/validate 는 mono/저비트레이트/sine-tone 같은 비표준 음원에 대해
    "processing_validate_fail err=Internal Error" 를 generic 으로 반환. (cf. v76.2 분석)
  - 일관된 stereo 44.1kHz 192kbps mp3 로 normalize 하면 sunoapi 수락률이 개선됨.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Tuple

logger = logging.getLogger(__name__)

# ffmpeg/ffprobe 위치 — PATH 또는 사용자 로컬 bin.
_FFMPEG = shutil.which("ffmpeg") or "/home/duckjk89/.local/bin/ffmpeg"
_FFPROBE = shutil.which("ffprobe") or "/home/duckjk89/.local/bin/ffprobe"


def _ffprobe_meta(path: str) -> dict:
    """ffprobe → {codec, channels, sample_rate, bit_rate, duration_s}.

    값이 없으면 0 또는 빈 문자열로 채움.
    """
    try:
        proc = subprocess.run(
            [
                _FFPROBE,
                "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=codec_name,channels,sample_rate,bit_rate:format=duration,bit_rate",
                "-of", "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            logger.warning("[audio_norm] ffprobe non-zero rc=%d stderr=%s", proc.returncode, (proc.stderr or "")[:200])
            return {}
        data = json.loads(proc.stdout or "{}")
        stream = (data.get("streams") or [{}])[0]
        fmt = data.get("format") or {}

        def _to_int(v) -> int:
            try:
                return int(v)
            except Exception:
                return 0

        def _to_float(v) -> float:
            try:
                return float(v)
            except Exception:
                return 0.0

        return {
            "codec": str(stream.get("codec_name") or ""),
            "channels": _to_int(stream.get("channels")),
            "sample_rate": _to_int(stream.get("sample_rate")),
            "bit_rate": _to_int(stream.get("bit_rate") or fmt.get("bit_rate")),
            "duration_s": _to_float(fmt.get("duration")),
        }
    except Exception:
        logger.exception("[audio_norm] ffprobe failed path=%s", path)
        return {}


def normalize_audio_bytes(in_bytes: bytes, in_ext: str) -> Tuple[bytes, dict]:
    """업로드 음원 bytes 를 표준 mp3 (stereo/44.1k/192k) 로 정규화.

    Args:
        in_bytes: 원본 음원 raw bytes.
        in_ext: 원본 확장자 (".mp3" / ".wav" / ".m4a" 등). 임시파일 suffix 로 사용.

    Returns:
        (out_mp3_bytes, meta) 튜플.
        meta = {
            "duration_s": float,
            "in_codec": str,
            "in_channels": int,
            "in_sample_rate": int,
            "in_bitrate": int,
            "out_size": int,
        }

    Raises:
        ValueError: ffmpeg 호출 자체가 실패한 경우 (stderr 첫 200자 포함).
    """
    if not in_bytes:
        raise ValueError("audio normalize failed: empty input")

    safe_ext = in_ext if in_ext and in_ext.startswith(".") else ".bin"
    in_fp = tempfile.NamedTemporaryFile(suffix=safe_ext, delete=False)
    out_fp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    in_path = in_fp.name
    out_path = out_fp.name
    in_fp.close()
    out_fp.close()

    try:
        with open(in_path, "wb") as f:
            f.write(in_bytes)

        # 입력 메타 (정규화 전).
        in_meta = _ffprobe_meta(in_path)

        # ffmpeg: stereo / 44.1k / 192k mp3, 전체 duration 보존.
        cmd = [
            _FFMPEG,
            "-y",
            "-i", in_path,
            "-vn",
            "-ac", "2",
            "-ar", "44100",
            "-b:a", "192k",
            "-f", "mp3",
            out_path,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except Exception as e:
            logger.exception("[audio_norm] ffmpeg subprocess crashed")
            raise ValueError(f"audio normalize failed: subprocess error {str(e)[:200]}")

        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip().replace("\n", " ")
            head = stderr[:200]
            logger.error("[audio_norm] ffmpeg rc=%d stderr=%s", proc.returncode, head)
            raise ValueError(f"audio normalize failed: {head}")

        with open(out_path, "rb") as f:
            out_bytes = f.read()

        out_meta = _ffprobe_meta(out_path)
        duration_s = float(out_meta.get("duration_s") or in_meta.get("duration_s") or 0.0)

        meta = {
            "duration_s": duration_s,
            "in_codec": in_meta.get("codec") or "",
            "in_channels": int(in_meta.get("channels") or 0),
            "in_sample_rate": int(in_meta.get("sample_rate") or 0),
            "in_bitrate": int(in_meta.get("bit_rate") or 0),
            "out_size": len(out_bytes),
        }

        logger.info(
            "[audio_norm] in_ext=%s in_size=%d in_codec=%s in_ch=%d in_sr=%d in_br=%d -> out_size=%d duration=%.1fs",
            safe_ext,
            len(in_bytes),
            meta["in_codec"] or "?",
            meta["in_channels"],
            meta["in_sample_rate"],
            meta["in_bitrate"],
            meta["out_size"],
            meta["duration_s"],
        )

        return out_bytes, meta

    finally:
        for p in (in_path, out_path):
            try:
                if p and os.path.exists(p):
                    os.unlink(p)
            except Exception:
                logger.warning("[audio_norm] tempfile cleanup failed path=%s", p)
