import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wondera", tags=["Wondera"])

WONDERA_API_BASE = "https://api.wondera.ai/v1"


def _wondera_headers():
    return {
        "x-api-key": settings.wondera_api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": "https://platform.wondera.ai",
        "Referer": "https://platform.wondera.ai/",
    }


@router.post("/upload-vocal")
async def upload_vocal(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload vocal file to Wondera API."""
    if not settings.wondera_api_key:
        return JSONResponse(status_code=503, content={"error": "Wondera API 키가 설정되지 않았습니다."})

    contents = await file.read()

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "{}/files/upload".format(WONDERA_API_BASE),
            headers=_wondera_headers(),
            files={"file": (file.filename, contents, "audio/mpeg")},
            data={"purpose": "vocal"},
        )

    if resp.status_code != 200:
        logger.error("Wondera upload failed: %s", resp.text[:500])
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 업로드 실패: {}".format(resp.text[:300])})

    result = resp.json()
    logger.info("Wondera: vocal uploaded, id=%s", result.get("data", {}).get("id"))
    return result


class GenerateRequest(BaseModel):
    lyrics: str
    model: str = "auto"
    prompt: Optional[str] = None
    vocal_id: Optional[str] = None


@router.post("/generate")
async def generate_song(
    body: GenerateRequest,
    current_user=Depends(get_current_user),
):
    """Generate song via Wondera API."""
    if not settings.wondera_api_key:
        return JSONResponse(status_code=503, content={"error": "Wondera API 키가 설정되지 않았습니다."})

    payload = {
        "lyrics": body.lyrics,
        "model": body.model,
    }
    if body.prompt:
        payload["prompt"] = body.prompt
    if body.vocal_id:
        payload["vocal_id"] = body.vocal_id

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "{}/song/generate".format(WONDERA_API_BASE),
            headers={**_wondera_headers(), "Content-Type": "application/json"},
            json=payload,
        )

    if resp.status_code != 200:
        logger.error("Wondera generate failed: %s", resp.text[:500])
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 생성 실패: {}".format(resp.text[:300])})

    result = resp.json()
    logger.info("Wondera: song generate started, task_id=%s", result.get("data", {}).get("task_id"))
    return result


@router.get("/query/{task_id}")
async def query_song(
    task_id: str,
    current_user=Depends(get_current_user),
):
    """Query song generation status from Wondera API."""
    if not settings.wondera_api_key:
        return JSONResponse(status_code=503, content={"error": "Wondera API 키가 설정되지 않았습니다."})

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "{}/song/query/{}".format(WONDERA_API_BASE, task_id),
            headers=_wondera_headers(),
        )

    if resp.status_code != 200:
        logger.error("Wondera query failed: %s", resp.text[:500])
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 조회 실패: {}".format(resp.text[:300])})

    return resp.json()
