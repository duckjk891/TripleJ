"""OpenAI GPT Image 2 wrapper.

Provides `generate_image(prompt, ref_images, size, quality)` that returns PNG
bytes — same shape as the Gemini Nano Banana Pro helper inside
`character_generator._call_gemini_image`. When `ref_images` is empty/None it
calls the text-to-image endpoint (`/v1/images/generations`); when one or more
reference images are supplied it falls back to the multi-ref edits endpoint
(`/v1/images/edits`).

Snapshot model id `gpt-image-2-2026-04-21` is used to avoid alias rolling.
"""
import asyncio
import base64
import io
import logging
import time
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Snapshot model id (avoid `gpt-image-2` alias rolling).
OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21"

OPENAI_GEN_URL = "https://api.openai.com/v1/images/generations"
OPENAI_EDIT_URL = "https://api.openai.com/v1/images/edits"

# Multi-ref ceiling per OpenAI spec.
MAX_REF_IMAGES = 10


def _png_size(size: str) -> str:
    """Normalize size to one of the supported strings; fall back to 2048x2048."""
    if size in ("1024x1024", "1024x1792", "1792x1024", "2048x2048", "auto"):
        return size
    return "2048x2048"


async def _decode_first_image(data: dict) -> bytes:
    """Decode the first image from an OpenAI images API response."""
    images = data.get("data") or []
    if not images:
        raise ValueError("OpenAI image response missing 'data'")
    first = images[0] or {}
    b64 = first.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    # Fallback: response_format=url path — fetch the URL.
    url = first.get("url")
    if url:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                raise ValueError(
                    "OpenAI image URL download failed (HTTP {})".format(r.status_code)
                )
            return r.content
    raise ValueError("OpenAI image response missing b64_json/url")


async def _call_generations(
    prompt: str, size: str, quality: str
) -> bytes:
    """POST /v1/images/generations — text-to-image."""
    headers = {
        "Authorization": "Bearer {}".format(settings.openai_api_key),
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": _png_size(size),
        "quality": quality,
        "n": 1,
    }
    # user requested very generous timeout — GPT Image 2 high quality can take 5+ min;
    # 3600s (60 min) margin to outlast any realistic backend stall.
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=3600.0) as client:
        resp = await client.post(OPENAI_GEN_URL, headers=headers, json=payload)
    elapsed_s = time.monotonic() - start
    logger.info(
        "[OpenAIImage] generations http=%d size=%s elapsed_s=%.1f",
        resp.status_code, payload["size"], elapsed_s,
    )
    if resp.status_code != 200:
        raise ValueError(
            "OpenAI generations error HTTP {}: {}".format(
                resp.status_code, resp.text[:300]
            )
        )
    return await _decode_first_image(resp.json())


async def _call_edits(
    prompt: str, ref_images: list, size: str, quality: str
) -> bytes:
    """POST /v1/images/edits — text + multi-ref (multipart)."""
    headers = {
        "Authorization": "Bearer {}".format(settings.openai_api_key),
    }
    # Use multipart/form-data with multiple image[] parts.
    files = []
    for idx, ref in enumerate(ref_images):
        if not ref:
            continue
        files.append(
            ("image[]", ("ref_{}.png".format(idx), io.BytesIO(ref), "image/png"))
        )
    data = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": _png_size(size),
        "quality": quality,
        "n": "1",
    }
    # user requested very generous timeout — GPT Image 2 high quality can take 5+ min;
    # edits + multi-ref + 2K runs even slower, so 3600s (60 min) margin.
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=3600.0) as client:
        resp = await client.post(
            OPENAI_EDIT_URL, headers=headers, data=data, files=files
        )
    elapsed_s = time.monotonic() - start
    logger.info(
        "[OpenAIImage] edits http=%d refs=%d size=%s elapsed_s=%.1f",
        resp.status_code,
        len(files),
        data["size"],
        elapsed_s,
    )
    if resp.status_code != 200:
        raise ValueError(
            "OpenAI edits error HTTP {}: {}".format(
                resp.status_code, resp.text[:300]
            )
        )
    return await _decode_first_image(resp.json())


async def generate_image(
    prompt: str,
    ref_images: Optional[list] = None,
    size: str = "2048x2048",
    quality: str = "high",
) -> bytes:
    """Generate a single image via OpenAI GPT Image 2 and return PNG bytes.

    - When `ref_images` is empty/None: uses /v1/images/generations.
    - When one or more `ref_images` (list[bytes]) are supplied: uses
      /v1/images/edits with multi-ref attachments (max 10 — anything beyond
      is dropped with a warning).

    The interface mirrors `_call_gemini_image` in character_generator so callers
    can dispatch on `image_model` with a single-line branch.
    """
    if not settings.openai_api_key:
        # Do not log the key. Just fail loudly.
        raise ValueError("OPENAI_API_KEY is not configured")

    refs = [b for b in (ref_images or []) if b]
    if len(refs) > MAX_REF_IMAGES:
        logger.warning(
            "[OpenAIImage] ref_images=%d exceeds max=%d — truncating",
            len(refs),
            MAX_REF_IMAGES,
        )
        refs = refs[:MAX_REF_IMAGES]

    mode = "edits" if refs else "generations"
    logger.info(
        "[OpenAIImage] mode=%s refs=%d prompt_len=%d",
        mode,
        len(refs),
        len(prompt or ""),
    )

    # Single retry on transient failure.
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            if refs:
                return await _call_edits(prompt, refs, size, quality)
            return await _call_generations(prompt, size, quality)
        except Exception as e:  # noqa: BLE001
            last_err = e
            # httpx.ReadTimeout / TimeoutException 등은 str(e) 가 빈 문자열일 수 있어
            # 클래스명을 항상 포함시킴.
            err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
            logger.warning(
                "[OpenAIImage] attempt=%d failed: %s",
                attempt + 1,
                err_text,
            )
            if attempt == 0:
                await asyncio.sleep(2.0)
                continue
            break

    # All retries exhausted.
    msg = "OpenAI image generation failed after retry: {}".format(
        "{}: {}".format(type(last_err).__name__, str(last_err)[:200] or "(no message)")
        if last_err else "unknown"
    )
    logger.error("[OpenAIImage] failed: %s", msg)
    raise ValueError(msg)
