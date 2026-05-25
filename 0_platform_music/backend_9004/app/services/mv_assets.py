"""MV 자산(캐릭터/장소 시트) 사전생성 + 변수 참조 + 24h 정리."""

import asyncio
import base64
import io
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

GEMINI_IMAGE_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)

ASSET_REF_PATTERN = re.compile(r"@(character\d+|location\d+)")


async def _gemini_generate_image(prompt: str, ref_images: list = None) -> bytes:
    """Nano Banana Pro로 이미지 1장 생성. ref_images: [bytes, ...]"""
    request_parts = [{"text": prompt}]
    for img_bytes in (ref_images or []):
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": base64.b64encode(img_bytes).decode("utf-8"),
            }
        })
    payload = {
        "contents": [{"parts": request_parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            GEMINI_IMAGE_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )
    if resp.status_code != 200:
        raise ValueError("Gemini asset image error HTTP {}: {}".format(
            resp.status_code, resp.text[:300]))
    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")
    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])
    raise ValueError("No image in Gemini response")


async def _generate_asset_image(
    prompt: str,
    ref_images: list = None,
    image_model: str = "nb_pro",
    asset_kind: str = "character",
) -> bytes:
    """v55: 자산 시트 이미지 생성 디스패처.

    image_model:
      - "nb_pro" (default): Gemini Nano Banana Pro (`_gemini_generate_image`)
      - "gpt_image_2": OpenAI GPT Image 2 (`openai_image.generate_image`)

    asset_kind: "character" | "location" — 로그용 태그.
    """
    import time as _time

    refs_count = len([b for b in (ref_images or []) if b])
    logger.info(
        "[AssetGen] start image_model=%s asset_kind=%s refs=%d prompt_len=%d",
        image_model,
        asset_kind,
        refs_count,
        len(prompt or ""),
    )
    t0 = _time.monotonic()
    try:
        if image_model == "gpt_image_2":
            # v59: 품질 우선 — 2K 유지. timeout 은 openai_image.py 에서 1800s 로 확장.
            from .openai_image import generate_image as _openai_generate_image

            result = await _openai_generate_image(
                prompt=prompt,
                ref_images=ref_images or None,
                size="2048x2048",
                quality="high",
            )
        else:
            result = await _gemini_generate_image(prompt, ref_images=ref_images)
        elapsed_ms = int((_time.monotonic() - t0) * 1000)
        logger.info(
            "[AssetGen] done image_model=%s asset_kind=%s bytes=%d elapsed_ms=%d",
            image_model,
            asset_kind,
            len(result) if result else 0,
            elapsed_ms,
        )
        return result
    except Exception as e:
        elapsed_ms = int((_time.monotonic() - t0) * 1000)
        logger.exception(
            "[AssetGen] failed image_model=%s asset_kind=%s elapsed_ms=%d err=%s",
            image_model,
            asset_kind,
            elapsed_ms,
            "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)"),
        )
        raise


async def generate_character_sheet_asset(
    name: str,
    gender: str,
    description: str,
    ref_image: Optional[bytes] = None,
    age: Optional[str] = None,
    personality_tags: Optional[list] = None,
    personality_text: Optional[str] = None,
    image_model: str = "nb_pro",
) -> bytes:
    """v63 — 4섹션 1x4 풀바디 + 얼굴 3분할 디테일 캐릭터 시트 생성.

    character_generator 의 마스터 prompt spec 을 인라인으로 가져온 1-step 변형.
    ref_image 가 있으면 외형 baseline 으로 첨부 (커버 인물 / 사용자 PNG 케이스).
    ref 없으면 description + spec 만으로 LLM 추론.
    """
    age_val = (age or "").strip()
    tags_clean = [t.strip() for t in (personality_tags or []) if isinstance(t, str) and t.strip()]
    text_clean = (personality_text or "").strip()
    pers_frag = ""
    if tags_clean or text_clean:
        pers_frag = ", ".join(tags_clean)
        if text_clean:
            pers_frag = "{} — {}".format(pers_frag, text_clean) if pers_frag else text_clean

    prompt_lines = [
        "Generate a professional photorealistic character design sheet for a music video.",
        "",
        "## OVERALL COMPOSITION (FIXED LAYOUT — strict)",
        "1:1 (square) canvas, 4K resolution, neutral grey studio background (#808080), "
        "photorealistic style only. The canvas is divided into FOUR vertical sections "
        "(1x4 layout), arranged from left to right:",
        "",
        "[SECTION 1 — RIGHT 45° FULL BODY]",
        "- Full body view from a 45-degree angle facing right",
        "- Character stands upright in a neutral A-pose (arms relaxed at sides)",
        "",
        "[SECTION 2 — LEFT 45° FULL BODY]",
        "- Full body view from a 45-degree angle facing left",
        "- Same posture / proportions / lighting as Section 1 (mirrored only)",
        "",
        "[SECTION 3 — BACK FULL BODY]",
        "- Full body view from directly behind, upright neutral standing posture",
        "- Clearly show hair back, outfit back, and silhouette",
        "",
        "[SECTION 4 — FACE DETAIL STACK (vertical 3-split)]",
        "- Top    : face from a 45-degree angle facing right (head only, zoomed in)",
        "- Middle : face from a 45-degree angle facing left  (head only, zoomed in)",
        "- Bottom : face from directly behind                (head only, zoomed in)",
        "- Equal vertical spacing, consistent scale and alignment",
        "",
        "## GLOBAL LAYOUT RULES",
        "- Consistent character proportions across all four sections",
        "- No perspective distortion between sections",
        "- Strict alignment and equal spacing between sections",
        "- Clean separation between sections",
        "- No text, no watermark, no logo anywhere on the canvas",
        "",
        "## CHARACTER SPECIFICATION",
        "[Identity]",
        "- Name: {name}".format(name=name or "(unspecified)"),
        "- Gender: {gender}".format(gender=gender or "neutral"),
    ]
    if age_val:
        prompt_lines.append("- Age: {}".format(age_val))
    prompt_lines.append("")
    prompt_lines.append("[Body / Pose]")
    prompt_lines.append(
        "- Natural proportions consistent with age and gender; A-pose; arms relaxed at "
        "sides; weight evenly distributed; head upright facing the canvas plane."
    )
    prompt_lines.append("")
    prompt_lines.append("[Appearance — description]")
    if description and description.strip():
        prompt_lines.append("- {}".format(description.strip()))
    else:
        prompt_lines.append("- Design the face shape, jaw, eyes, brows, nose, lips, skin, "
                            "hair (color/length/style), build, and outfit so they read as "
                            "a cohesive single character. Keep all four sections identical "
                            "in those traits.")
    if pers_frag:
        prompt_lines.append("")
        prompt_lines.append("[Personality / Vibe]")
        prompt_lines.append(
            "- {pers}".format(pers=pers_frag)
        )
        prompt_lines.append(
            "- Reflect subtly in expression, micro-pose, and styling — NOT in dramatic poses."
        )
    prompt_lines.append("")
    if ref_image:
        prompt_lines.append("## REFERENCE IMAGE — TREAT AS GROUND TRUTH FOR APPEARANCE")
        prompt_lines.append(
            "- A reference image is attached. The character in all four sections MUST "
            "preserve the SAME face shape, eyes, nose, mouth, hair (color/length/style), "
            "skin tone, and body build as the reference. If the [Appearance — description] "
            "above conflicts with the reference, FOLLOW THE REFERENCE."
        )
    else:
        prompt_lines.append("## NOTE — no reference image")
        prompt_lines.append(
            "- Invent a single cohesive appearance from the [Appearance — description] "
            "above and keep it identical across all four sections."
        )
    prompt_lines.append("")
    prompt_lines.append(
        "Output: a single photorealistic character sheet image following the layout above. "
        "Photographic style only — no illustration, no anime, no stylized rendering."
    )

    prompt = "\n".join(prompt_lines)
    return await _generate_asset_image(
        prompt,
        ref_images=[ref_image] if ref_image else None,
        image_model=image_model,
        asset_kind="character",
    )


async def generate_location_sheet_asset(
    name: str,
    description: str,
    style_ref: Optional[bytes] = None,
    image_model: str = "nb_pro",
) -> bytes:
    """장소 시트 (와이드샷, 사람 없음, 1024x1024) 생성.

    style_ref: 선택적 참조 이미지(예: 사용자 location1). 보조 location2/3 생성 시
    location1 의 라이팅/시간대/색감을 따라가도록 첨부한다.
    """
    prompt = (
        "Create a photorealistic establishing shot of a location for a music video. "
        "Wide cinematic shot, no people, atmospheric lighting. "
        "Location: {name}. {description} "
        "16:9 aspect ratio. No text, no watermark."
    ).format(name=name, description=description)
    if style_ref:
        prompt += (
            " Match the lighting direction, time of day, and dominant color palette "
            "of the reference image (a different but related location in the same MV)."
        )
        return await _generate_asset_image(
            prompt,
            ref_images=[style_ref],
            image_model=image_model,
            asset_kind="location",
        )
    return await _generate_asset_image(
        prompt, ref_images=None, image_model=image_model, asset_kind="location"
    )


def parse_asset_references(prompt: str) -> list:
    """프롬프트에서 @character1, @location1 같은 참조 추출. 중복 제거 + 등장 순서 유지."""
    if not prompt:
        return []
    seen = set()
    out = []
    for m in ASSET_REF_PATTERN.findall(prompt):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


async def upload_asset_to_minio(image_bytes: bytes, job_id, asset_key: str) -> str:
    """자산 이미지를 MinIO에 업로드. object_name 반환."""
    obj_name = "mv_assets/{job_id}/{key}_{uid}.png".format(
        job_id=str(job_id), key=asset_key, uid=uuid.uuid4().hex[:8],
    )
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=obj_name,
        data=io.BytesIO(image_bytes),
        length=len(image_bytes),
        content_type="image/png",
    )
    return obj_name


def load_asset_from_minio(object_name: str) -> Optional[bytes]:
    """MinIO에서 자산 이미지 바이트 로드."""
    if not object_name:
        return None
    try:
        client = get_minio()
        resp = client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = resp.read()
        resp.close()
        resp.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load asset '%s': %s", object_name, e)
        return None


async def cleanup_expired_assets(retention_hours: int = 24) -> int:
    """완료된 MV의 자산을 24h 후 정리. 정리한 자산 개수 반환."""
    mongo = get_mongo()
    if mongo is None:
        return 0
    cutoff = datetime.utcnow() - timedelta(hours=retention_hours)
    minio_client = get_minio()
    cleared = 0
    async for job in mongo.mv_jobs.find({
        "status": {"$in": ["completed", "failed"]},
        "updated_at": {"$lt": cutoff},
        "assets": {"$exists": True, "$ne": None},
        "assets_cleared": {"$ne": True},
    }):
        assets = job.get("assets") or {}
        for key, asset in assets.items():
            obj = asset.get("object_name") if isinstance(asset, dict) else None
            if obj:
                try:
                    minio_client.remove_object(
                        bucket_name=settings.minio_bucket_images,
                        object_name=obj,
                    )
                    cleared += 1
                except Exception as e:
                    logger.warning("Asset MinIO delete failed (%s): %s", obj, e)
        await mongo.mv_jobs.update_one(
            {"_id": job["_id"]},
            {"$set": {"assets_cleared": True, "assets_cleared_at": datetime.utcnow()}},
        )
    if cleared > 0:
        logger.info("cleanup_expired_assets: cleared %d assets", cleared)
    return cleared


async def cleanup_loop(interval_sec: int = 3600):
    """1시간마다 cleanup_expired_assets 호출하는 백그라운드 루프."""
    while True:
        try:
            await cleanup_expired_assets()
        except Exception as e:
            logger.exception("cleanup_loop error: %s", e)
        await asyncio.sleep(interval_sec)
