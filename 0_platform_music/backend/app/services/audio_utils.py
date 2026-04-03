import logging
import os
import subprocess
import tempfile
import numpy as np
import soundfile as sf
import pyloudnorm as pyln

logger = logging.getLogger(__name__)

TARGET_LUFS = -14.0  # Spotify/YouTube standard


def normalize_audio(audio_bytes: bytes, file_name: str = "input.wav") -> bytes:
    """Normalize audio to target LUFS using pyloudnorm."""
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, file_name)
        output_path = os.path.join(tmpdir, "normalized.wav")

        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # Convert to wav first if needed (using ffmpeg)
        wav_path = os.path.join(tmpdir, "converted.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-ar", "44100", "-ac", "1", "-sample_fmt", "s16", wav_path],
            capture_output=True, timeout=60,
        )

        if os.path.exists(wav_path):
            data, rate = sf.read(wav_path)
        else:
            data, rate = sf.read(input_path)

        # Measure loudness
        meter = pyln.Meter(rate)
        loudness = meter.integrated_loudness(data)

        if np.isinf(loudness) or np.isnan(loudness):
            logger.warning("Could not measure loudness, skipping normalization")
            return audio_bytes

        # Normalize
        normalized = pyln.normalize.loudness(data, loudness, TARGET_LUFS)

        # Clip to prevent distortion
        normalized = np.clip(normalized, -1.0, 1.0)

        sf.write(output_path, normalized, rate)

        with open(output_path, "rb") as f:
            result = f.read()

        logger.info("Normalized: %.1f LUFS -> %.1f LUFS (%d bytes)", loudness, TARGET_LUFS, len(result))
        return result


def compress_audio(audio_bytes: bytes, file_name: str = "input.wav") -> bytes:
    """Apply dynamic range compression using ffmpeg."""
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, file_name)
        output_path = os.path.join(tmpdir, "compressed.wav")

        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # ffmpeg compand filter for gentle compression
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-af", "compand=attacks=0.3:decays=0.8:points=-80/-80|-45/-30|-27/-20|-10/-10|0/-5:gain=3",
            output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.warning("ffmpeg compress failed: %s, returning original", result.stderr[:200])
            return audio_bytes

        with open(output_path, "rb") as f:
            compressed = f.read()

        logger.info("Compressed: %d -> %d bytes", len(audio_bytes), len(compressed))
        return compressed
