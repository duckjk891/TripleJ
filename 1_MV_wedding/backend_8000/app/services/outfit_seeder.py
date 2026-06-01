"""
Wedding outfit catalog seeder.

On startup, if the `wedding_outfit_items` Mongo collection is empty, generate
4 placeholder PNGs per (role, style, category) combo using Pillow, upload them
to MinIO under `outfits/{role}/{style}/{category}/{idx:02d}.png` in the
photos bucket, and insert one doc per item.

Idempotent — controlled by the collection emptiness gate. Never crashes
startup; any error is logged at warning level and the function bails.
"""
import asyncio
import hashlib
import io
import logging
from datetime import datetime, timezone
from typing import Tuple

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)


ROLES = ("groom", "bride")
STYLES = ("casual", "wedding")
CATEGORIES = ("top", "bottom", "shoes")
ITEMS_PER_COMBO = 4
IMAGE_SIZE = (512, 512)


def _deterministic_color(role: str, style: str, category: str, idx: int) -> Tuple[int, int, int]:
    """Produce a (R, G, B) tuple deterministically from (role, style, category, idx)."""
    h = hashlib.md5(
        "{}|{}|{}|{}".format(role, style, category, idx).encode("utf-8")
    ).digest()
    # Keep mid-bright, slightly desaturated values so text on top reads cleanly.
    r = 90 + (h[0] % 130)
    g = 90 + (h[1] % 130)
    b = 90 + (h[2] % 130)
    return r, g, b


def _build_placeholder_png(role: str, style: str, category: str, idx: int) -> bytes:
    """Build a 512x512 PNG placeholder image. Returns raw PNG bytes."""
    # Imported lazily — outer function catches ImportError so missing Pillow
    # only degrades the seeder, not the whole app.
    from PIL import Image, ImageDraw, ImageFont

    bg = _deterministic_color(role, style, category, idx)
    img = Image.new("RGB", IMAGE_SIZE, bg)
    draw = ImageDraw.Draw(img)

    # Inner border.
    border_inset = 16
    draw.rectangle(
        [border_inset, border_inset, IMAGE_SIZE[0] - border_inset, IMAGE_SIZE[1] - border_inset],
        outline=(255, 255, 255),
        width=4,
    )

    label = "{} · {} · {} #{}".format(role, style, category, idx + 1)
    sub_label = "wedding outfit placeholder"

    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    # Center the label.
    try:
        bbox = draw.textbbox((0, 0), label, font=font) if font else (0, 0, 200, 20)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
    except Exception:
        tw, th = 200, 20

    cx = (IMAGE_SIZE[0] - tw) // 2
    cy = (IMAGE_SIZE[1] - th) // 2
    draw.text((cx, cy), label, fill=(255, 255, 255), font=font)
    # Sub label below
    try:
        sbbox = draw.textbbox((0, 0), sub_label, font=font) if font else (0, 0, 200, 16)
        sw = sbbox[2] - sbbox[0]
    except Exception:
        sw = 200
    draw.text(((IMAGE_SIZE[0] - sw) // 2, cy + th + 12), sub_label, fill=(230, 230, 230), font=font)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def seed_outfits() -> None:
    """Seed wedding_outfit_items collection if empty. Logs prefix [OutfitSeed]."""
    logger.info(
        "[OutfitSeed] start roles=%d styles=%d categories=%d items_per_combo=%d",
        len(ROLES),
        len(STYLES),
        len(CATEGORIES),
        ITEMS_PER_COMBO,
    )

    try:
        mongo = get_mongo()
        if mongo is None:
            logger.warning("[OutfitSeed] mongo db not initialized — bail")
            return

        try:
            existing = await mongo.wedding_outfit_items.count_documents({})
        except Exception as e:
            logger.error(
                "[OutfitSeed] count_documents failed: %s: %s",
                type(e).__name__,
                str(e)[:200],
            )
            return

        logger.info("[OutfitSeed] existing rows=%d", existing)
        if existing > 0:
            logger.warning("[OutfitSeed] collection already seeded (count=%d) — skip", existing)
            return

        try:
            # Pillow import sanity check first.
            from PIL import Image, ImageDraw  # noqa: F401
        except ImportError as e:
            logger.warning(
                "[OutfitSeed] Pillow not installed (%s) — cannot generate placeholders, bail",
                e,
            )
            return

        minio_client = get_minio()
        if minio_client is None:
            logger.warning("[OutfitSeed] minio client not initialized — bail")
            return

        bucket = settings.minio_bucket_photos
        total_inserted = 0
        now = datetime.now(timezone.utc)

        for role in ROLES:
            for style in STYLES:
                for category in CATEGORIES:
                    docs = []
                    for idx in range(ITEMS_PER_COMBO):
                        try:
                            png_bytes = _build_placeholder_png(role, style, category, idx)
                        except Exception as e:
                            logger.error(
                                "[OutfitSeed] PIL render failed role=%s style=%s category=%s idx=%d: %s: %s",
                                role,
                                style,
                                category,
                                idx,
                                type(e).__name__,
                                str(e)[:200],
                            )
                            continue

                        object_name = "outfits/{}/{}/{}/{:02d}.png".format(
                            role, style, category, idx
                        )
                        try:
                            minio_client.put_object(
                                bucket_name=bucket,
                                object_name=object_name,
                                data=io.BytesIO(png_bytes),
                                length=len(png_bytes),
                                content_type="image/png",
                            )
                        except Exception as e:
                            logger.error(
                                "[OutfitSeed] MinIO put failed object=%s: %s: %s",
                                object_name,
                                type(e).__name__,
                                str(e)[:200],
                            )
                            continue

                        docs.append({
                            "role": role,
                            "style": style,
                            "category": category,
                            "name": "{} {} {} #{}".format(role, style, category, idx + 1),
                            "image_object_name": object_name,
                            "source": "seed",
                            "created_at": now,
                        })

                    if docs:
                        try:
                            result = await mongo.wedding_outfit_items.insert_many(docs)
                            inserted_n = len(result.inserted_ids or [])
                            total_inserted += inserted_n
                            logger.info(
                                "[OutfitSeed] combo role=%s style=%s category=%s inserted=%d",
                                role,
                                style,
                                category,
                                inserted_n,
                            )
                        except Exception as e:
                            logger.error(
                                "[OutfitSeed] mongo insert_many failed role=%s style=%s category=%s: %s: %s",
                                role,
                                style,
                                category,
                                type(e).__name__,
                                str(e)[:200],
                            )
                    else:
                        logger.warning(
                            "[OutfitSeed] combo role=%s style=%s category=%s yielded 0 docs",
                            role,
                            style,
                            category,
                        )

        logger.info("[OutfitSeed] seeded %d items total", total_inserted)
    except Exception as e:
        logger.exception(
            "[OutfitSeed] unexpected error: %s: %s",
            type(e).__name__,
            str(e)[:200],
        )
        return


# Convenience for callers that want to fire-and-forget without awaiting.
def schedule_seed(loop=None) -> "asyncio.Task":
    """Schedule seed_outfits() on the running loop as a fire-and-forget task."""
    if loop is None:
        loop = asyncio.get_event_loop()
    return loop.create_task(seed_outfits())
