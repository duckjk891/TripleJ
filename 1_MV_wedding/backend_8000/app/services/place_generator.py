"""Place image generator — v7.

Builds a simple prompt from `display_name` + `memo` and dispatches to either
OpenAI GPT Image 2 (`gpt_image_2`) or Gemini Nano Banana Pro
(`nb_pro`) for a single 1024x1024 photorealistic place reference image.

No reference images, no people in the frame.

Log prefix: `[PlaceGen]` — every line carries `user_id`, `place_id`,
`image_model` so jobs are greppable by `place_id`.

API key validation must happen *before* calling this service (routes return
503 to the user when the configured key is missing); we still defensively
re-check so background tasks fail fast with a clear error message.
"""
import logging
from typing import Optional

from ..config import settings

logger = logging.getLogger(__name__)


ALLOWED_PLACE_IMAGE_MODELS = {"gpt_image_2", "nb_pro"}


def _build_place_prompt(display_name: str, memo: str) -> str:
    """Assemble the place reference prompt (kept short, deterministic)."""
    name_v = (display_name or "").strip() or "(unspecified)"
    memo_v = (memo or "").strip() or "(none)"
    return (
        "Photorealistic place / location reference image for a wedding music "
        "video.\n"
        "Location: {name}.\n"
        "Additional notes: {memo}.\n"
        "No people in the frame. Aspect: square. Soft, cinematic, natural lighting."
    ).format(name=name_v, memo=memo_v)


async def generate_place_image(
    display_name: str,
    memo: str,
    image_model: str,
    user_id: str,
    place_id: str,
) -> bytes:
    """Generate a single place reference PNG and return raw bytes.

    `image_model`: "gpt_image_2" (default) or "nb_pro". Raises ValueError when
    the requested backend is not configured or when generation fails after the
    underlying helper's retry budget is exhausted.
    """
    model_v = (image_model or "").strip() or "gpt_image_2"
    if model_v not in ALLOWED_PLACE_IMAGE_MODELS:
        logger.warning(
            "[PlaceGen] invalid image_model user_id=%s place_id=%s image_model=%s",
            user_id, place_id, model_v,
        )
        raise ValueError("Unsupported image_model: {}".format(model_v))

    prompt = _build_place_prompt(display_name, memo)
    logger.info(
        "[PlaceGen] entry user_id=%s place_id=%s image_model=%s display_name_len=%d memo_len=%d prompt_len=%d",
        user_id, place_id, model_v,
        len((display_name or "").strip()),
        len((memo or "").strip()),
        len(prompt),
    )

    if model_v == "gpt_image_2":
        if not settings.openai_api_key:
            logger.error(
                "[PlaceGen] openai key missing user_id=%s place_id=%s",
                user_id, place_id,
            )
            raise ValueError("OPENAI_API_KEY is not configured")
        from .openai_image import generate_image

        logger.info(
            "[PlaceGen] dispatch gpt_image_2 user_id=%s place_id=%s",
            user_id, place_id,
        )
        try:
            data = await generate_image(
                prompt=prompt,
                ref_images=None,
                size="1024x1024",
                quality="high",
            )
        except Exception as e:
            logger.exception(
                "[PlaceGen] gpt_image_2 failed user_id=%s place_id=%s: %s: %s",
                user_id, place_id, type(e).__name__, str(e)[:200],
            )
            raise
        logger.info(
            "[PlaceGen] ok user_id=%s place_id=%s image_model=%s bytes=%d",
            user_id, place_id, model_v, len(data or b""),
        )
        return data

    # nb_pro branch — Gemini 3 Pro Image preview via existing helper.
    if not settings.google_api_key:
        logger.error(
            "[PlaceGen] google key missing user_id=%s place_id=%s",
            user_id, place_id,
        )
        raise ValueError("GOOGLE_API_KEY is not configured")
    from .character_generator import _call_gemini_image

    logger.info(
        "[PlaceGen] dispatch nb_pro user_id=%s place_id=%s",
        user_id, place_id,
    )
    try:
        data = await _call_gemini_image(
            prompt,
            [],  # no reference image parts
            role=None,
            style=None,
            user_id=user_id,
        )
    except Exception as e:
        logger.exception(
            "[PlaceGen] nb_pro failed user_id=%s place_id=%s: %s: %s",
            user_id, place_id, type(e).__name__, str(e)[:200],
        )
        raise
    logger.info(
        "[PlaceGen] ok user_id=%s place_id=%s image_model=%s bytes=%d",
        user_id, place_id, model_v, len(data or b""),
    )
    return data
