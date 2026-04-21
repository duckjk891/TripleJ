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


async def generate_character_sheet_asset(
    name: str,
    gender: str,
    description: str,
    ref_image: Optional[bytes] = None,
) -> bytes:
    """캐릭터 시트 (정면+측면 등 다각도, 흰 배경 1024x1024) 생성."""
    prompt = (
        "Create a photorealistic character sheet of a single person for a music video. "
        "Show 3 angles (front, 3/4 side, profile) on a clean white background. "
        "Subject: {name}, gender: {gender}. {description} "
        "Consistent face, hair, outfit across all angles. "
        "No text, no watermark, no logo. Photorealistic style only."
    ).format(name=name, gender=gender, description=description)
    if ref_image:
        prompt += " Match the appearance of the provided reference image (face, hair, build)."
    return await _gemini_generate_image(prompt, ref_images=[ref_image] if ref_image else None)


async def generate_location_sheet_asset(
    name: str,
    description: str,
) -> bytes:
    """장소 시트 (와이드샷, 사람 없음, 1024x1024) 생성."""
    prompt = (
        "Create a photorealistic establishing shot of a location for a music video. "
        "Wide cinematic shot, no people, atmospheric lighting. "
        "Location: {name}. {description} "
        "16:9 aspect ratio. No text, no watermark."
    ).format(name=name, description=description)
    return await _gemini_generate_image(prompt)


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
