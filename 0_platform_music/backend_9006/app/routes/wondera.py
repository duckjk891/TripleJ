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


def _clean_wondera_error(text: str) -> str:
    """Wondera 에러 응답 정리 — Cloudflare 차단 등 HTML 응답이면 사람이 읽을
    메시지로 치환 (원문은 로그에만 남김)."""
    stripped = (text or "").lstrip()
    if stripped.startswith("<!DOCTYPE") or stripped.startswith("<html") or "Just a moment" in stripped:
        return "Wondera 서비스에 연결할 수 없습니다 (외부 접속 차단). 관리자 확인이 필요합니다."
    return stripped[:300]


def _wondera_headers():
    # 공식 문서(2026-07 확인) 기준 인증: Authorization: Bearer <API_KEY>
    return {
        "Authorization": "Bearer {}".format(settings.wondera_api_key),
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
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 업로드 실패: {}".format(_clean_wondera_error(resp.text))})

    result = resp.json()
    logger.info("Wondera: vocal uploaded, id=%s", result.get("data", {}).get("id"))
    return result


class GenerateRequest(BaseModel):
    lyrics: str
    model: str = "auto"  # auto, wondera-2.1, wondera-2.2, wondera-o1, wondera-o2
    number: Optional[int] = 2  # 생성할 곡 수 (1~3)
    prompt: Optional[str] = None  # 스타일 설명 (최대 1024자)
    reference_id: Optional[str] = None  # 참고 음악 파일 ID
    vocal_id: Optional[str] = None  # 참고 보컬 파일 ID
    melody_id: Optional[str] = None  # 참고 멜로디 파일 ID
    enable_stream: Optional[bool] = False  # 스트리밍 URL 반환


@router.post("/generate")
async def generate_song(
    body: GenerateRequest,
    current_user=Depends(get_current_user),
):
    """Generate song via Wondera API."""
    if not settings.wondera_api_key:
        return JSONResponse(status_code=503, content={"error": "Wondera API 키가 설정되지 않았습니다."})

    # 필수값 검증 — 가사 (공백만 입력도 거부)
    if not body.lyrics or not body.lyrics.strip():
        return JSONResponse(status_code=400, content={"error": "가사는 필수 입력입니다."})
    if body.number is not None and not (1 <= body.number <= 3):
        return JSONResponse(status_code=400, content={"error": "생성 곡 수(number)는 1~3 사이여야 합니다."})

    # 파라미터 조합 검증
    if body.prompt and body.reference_id:
        return JSONResponse(status_code=400, content={"error": "prompt와 reference_id는 동시에 사용할 수 없습니다."})
    if body.prompt and body.melody_id:
        return JSONResponse(status_code=400, content={"error": "prompt와 melody_id는 동시에 사용할 수 없습니다."})
    if body.reference_id and body.melody_id:
        return JSONResponse(status_code=400, content={"error": "reference_id와 melody_id는 동시에 사용할 수 없습니다."})
    if body.melody_id and body.vocal_id:
        return JSONResponse(status_code=400, content={"error": "melody_id와 vocal_id는 동시에 사용할 수 없습니다."})

    payload = {
        "lyrics": body.lyrics,
        "model": body.model,
    }
    if body.number is not None:
        payload["number"] = body.number
    if body.prompt:
        payload["prompt"] = body.prompt
    if body.reference_id:
        payload["reference_id"] = body.reference_id
    if body.vocal_id:
        payload["vocal_id"] = body.vocal_id
    if body.melody_id:
        payload["melody_id"] = body.melody_id
    if body.enable_stream:
        payload["enable_stream"] = body.enable_stream

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "{}/song/generate".format(WONDERA_API_BASE),
            headers={**_wondera_headers(), "Content-Type": "application/json"},
            json=payload,
        )

    if resp.status_code != 200:
        logger.error("Wondera generate failed: %s", resp.text[:500])
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 생성 실패: {}".format(_clean_wondera_error(resp.text))})

    result = resp.json()
    # 응답 형식 이중 대응: 구형 {data:{task_id}} / 공식 문서형 {id, status, ...}
    task_id = result.get("data", {}).get("task_id") if isinstance(result.get("data"), dict) else None
    task_id = task_id or result.get("id")
    logger.info("Wondera: song generate started, task_id=%s", task_id)
    return result


ALLOWED_PURPOSES = {"reference", "vocal", "melody"}


@router.post("/upload-file")
async def upload_wondera_file(
    file: UploadFile = File(...),
    purpose: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Upload file to Wondera API with specified purpose (reference, vocal, melody)."""
    if not settings.wondera_api_key:
        return JSONResponse(status_code=503, content={"error": "Wondera API 키가 설정되지 않았습니다."})

    if purpose not in ALLOWED_PURPOSES:
        return JSONResponse(
            status_code=400,
            content={"error": "purpose는 reference, vocal, melody 중 하나여야 합니다."},
        )

    contents = await file.read()

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "{}/files/upload".format(WONDERA_API_BASE),
            headers=_wondera_headers(),
            files={"file": (file.filename, contents, "audio/mpeg")},
            data={"purpose": purpose},
        )

    if resp.status_code != 200:
        logger.error("Wondera file upload failed: %s", resp.text[:500])
        return JSONResponse(
            status_code=resp.status_code,
            content={"error": "Wondera 파일 업로드 실패: {}".format(_clean_wondera_error(resp.text))},
        )

    result = resp.json()
    file_data = result.get("data", {})
    logger.info("Wondera: file uploaded, id=%s, purpose=%s", file_data.get("id"), purpose)
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
        return JSONResponse(status_code=resp.status_code, content={"error": "Wondera 조회 실패: {}".format(_clean_wondera_error(resp.text))})

    return resp.json()
