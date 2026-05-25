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


async def detect_beats(audio_bytes: bytes, downbeat_every: int = 4) -> dict:
    """
    Detect tempo, beats, and true downbeats from raw audio bytes via madmom.

    v43: switched from librosa.beat_track + naive [::4] stride to madmom's
    RNNDownBeatProcessor + DBNDownBeatTrackingProcessor for real downbeat
    detection. Falls back to librosa onset_strength + plp on madmom failure.

    Returns {"tempo": float, "beats": list[float], "downbeats": list[float]}.
    Empty dict on failure (does not raise).

    The ``downbeat_every`` arg is kept for back-compat but is ignored when
    madmom succeeds (madmom returns true downbeats); used only by the
    librosa fallback.
    """
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, "input.bin")
            wav_path = os.path.join(tmpdir, "beats.wav")

            with open(input_path, "wb") as f:
                f.write(audio_bytes)

            # Resolve ffmpeg binary: prefer system PATH, fall back to imageio-ffmpeg.
            import shutil as _shutil
            ffmpeg_bin = _shutil.which("ffmpeg")
            if not ffmpeg_bin:
                try:
                    import imageio_ffmpeg
                    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                except Exception:
                    ffmpeg_bin = None
            if not ffmpeg_bin:
                logger.warning("detect_beats: ffmpeg binary not available")
                return {}

            # Madmom expects 44.1k mono float32 audio (default for its NN models).
            proc = subprocess.run(
                [
                    ffmpeg_bin, "-y", "-i", input_path,
                    "-ar", "44100", "-ac", "1", "-sample_fmt", "s16",
                    wav_path,
                ],
                capture_output=True, timeout=120,
            )
            if proc.returncode != 0 or not os.path.exists(wav_path):
                logger.warning(
                    "detect_beats: ffmpeg conversion failed: %s",
                    proc.stderr[-200:].decode("utf-8", errors="replace"),
                )
                return {}

            samples, sr = sf.read(wav_path, dtype="float32")
            if samples is None or len(samples) == 0:
                logger.warning("detect_beats: empty audio buffer")
                return {}
            if samples.ndim > 1:
                samples = samples.mean(axis=1).astype("float32")

            # ── Primary: madmom downbeat tracking ──
            try:
                from madmom.audio.signal import Signal as _MmSignal
                from madmom.features.downbeats import (
                    RNNDownBeatProcessor as _RnnDb,
                    DBNDownBeatTrackingProcessor as _DbnDb,
                )

                sig = _MmSignal(samples, sample_rate=int(sr), num_channels=1)
                acts = _RnnDb()(sig)
                # 3/4 + 4/4 grid covers most popular music; fps=100 is madmom default.
                tracker = _DbnDb(beats_per_bar=[3, 4], fps=100)
                result = tracker(acts)  # shape (N, 2): col0=time, col1=beat-in-bar (1 = downbeat)

                if result is None or len(result) == 0:
                    raise RuntimeError("madmom returned empty result")

                all_times = [round(float(t), 3) for t in result[:, 0]]
                downbeat_times = [
                    round(float(t), 3)
                    for t, pos in result
                    if int(round(float(pos))) == 1
                ]

                # tempo = 60 / median beat interval
                if len(all_times) >= 2:
                    intervals = np.diff(np.asarray(all_times, dtype=np.float64))
                    intervals = intervals[intervals > 1e-3]
                    tempo_f = float(60.0 / np.median(intervals)) if len(intervals) else 0.0
                else:
                    tempo_f = 0.0

                logger.info(
                    "detect_beats(madmom): tempo=%.2f, beats=%d, downbeats=%d",
                    tempo_f, len(all_times), len(downbeat_times),
                )
                return {
                    "tempo": round(tempo_f, 2),
                    "beats": all_times,
                    "downbeats": downbeat_times,
                }
            except Exception as madmom_err:
                logger.warning(
                    "detect_beats: madmom failed (%s), falling back to librosa",
                    str(madmom_err)[:200],
                )

            # ── Fallback: librosa onset_strength + plp + naive stride ──
            try:
                import librosa  # local import
            except Exception as e:
                logger.warning("detect_beats: librosa fallback unavailable: %s", e)
                return {}

            y, sr_lr = librosa.load(wav_path, sr=22050, mono=True)
            if y is None or len(y) == 0:
                return {}
            tempo, beat_times = librosa.beat.beat_track(y=y, sr=sr_lr, units="time")
            try:
                tempo_f = float(np.asarray(tempo).reshape(-1)[0])
            except Exception:
                tempo_f = float(tempo) if tempo is not None else 0.0
            beats = [round(float(t), 2) for t in (beat_times if beat_times is not None else [])]
            n = max(int(downbeat_every), 1)
            downbeats = beats[::n] if beats else []
            logger.info(
                "detect_beats(librosa fallback): tempo=%.2f, beats=%d, downbeats=%d",
                tempo_f, len(beats), len(downbeats),
            )
            return {
                "tempo": round(tempo_f, 2),
                "beats": beats,
                "downbeats": downbeats,
            }
    except Exception as e:
        logger.warning("detect_beats: failed: %s", e)
        return {}
