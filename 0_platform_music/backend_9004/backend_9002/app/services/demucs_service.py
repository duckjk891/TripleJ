import asyncio
import logging
import os
import tempfile
import subprocess

import soundfile as sf
import torch
import numpy as np

logger = logging.getLogger(__name__)


async def enhance_vocal_demucs(audio_bytes: bytes, file_name: str = "input.wav") -> bytes:
    """Process audio through Demucs for vocal separation (noise/echo removal).
    Uses soundfile for I/O to avoid torchaudio/torchcodec issues.
    """

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_demucs, audio_bytes, file_name)


def _run_demucs(audio_bytes: bytes, file_name: str) -> bytes:
    """Run demucs synchronously in a thread."""
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, file_name)
        wav_path = os.path.join(tmpdir, "converted.wav")
        output_path = os.path.join(tmpdir, "vocals.wav")

        # Write input file
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        logger.info("Demucs: starting processing, file=%s", file_name)

        # Convert to wav using ffmpeg (handles any input format)
        ffmpeg_result = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-ar", "44100", "-ac", "2", "-sample_fmt", "s16", wav_path],
            capture_output=True, timeout=60, text=True,
        )

        if os.path.exists(wav_path):
            read_path = wav_path
        else:
            logger.warning("Demucs: ffmpeg conversion failed (rc=%d): %s", ffmpeg_result.returncode, ffmpeg_result.stderr[:500])
            read_path = input_path

        # Load audio with soundfile (no torchaudio dependency)
        data, sample_rate = sf.read(read_path, dtype="float32")

        # Ensure 2D array [samples, channels]
        if data.ndim == 1:
            data = np.stack([data, data], axis=1)

        # Convert to torch tensor [channels, samples]
        waveform = torch.from_numpy(data.T).float()

        # Load model
        model = get_model("htdemucs")
        model.eval()

        # Resample if needed
        if sample_rate != model.samplerate:
            # Simple resampling via ffmpeg re-conversion
            resampled_path = os.path.join(tmpdir, "resampled.wav")
            resample_result = subprocess.run(
                ["ffmpeg", "-y", "-i", read_path, "-ar", str(model.samplerate), "-ac", "2", "-sample_fmt", "s16", resampled_path],
                capture_output=True, timeout=60, text=True,
            )
            if not os.path.exists(resampled_path):
                raise RuntimeError("ffmpeg resample failed (rc={}): {}".format(resample_result.returncode, resample_result.stderr[:300]))
            data, sample_rate = sf.read(resampled_path, dtype="float32")
            if data.ndim == 1:
                data = np.stack([data, data], axis=1)
            waveform = torch.from_numpy(data.T).float()

        # Normalize
        ref = waveform.mean(0)
        std = ref.std()
        if std == 0:
            std = torch.tensor(1.0)
        waveform = (waveform - ref.mean()) / std

        # Add batch dimension [1, channels, samples]
        waveform = waveform.unsqueeze(0)

        # Apply model
        with torch.no_grad():
            sources = apply_model(model, waveform, device="cpu")

        # De-normalize
        sources = sources * std + ref.mean()

        # Find vocals index
        vocals_idx = model.sources.index("vocals")
        vocals = sources[0, vocals_idx]  # [channels, samples]

        # Convert to numpy and save with soundfile
        vocals_np = vocals.cpu().numpy().T  # [samples, channels]
        vocals_np = np.clip(vocals_np, -1.0, 1.0)

        sf.write(output_path, vocals_np, sample_rate)

        with open(output_path, "rb") as f:
            result = f.read()

        logger.info("Demucs: completed, output size=%d bytes", len(result))
        return result
