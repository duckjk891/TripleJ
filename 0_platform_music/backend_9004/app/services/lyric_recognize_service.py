"""
[lyric-recognize] Wondera recognize 기반 가사 타임스탬프 파이프라인 (v130 골격).

트랙 오디오(MinIO minio_bucket_music) → Wondera POST /v1/files/upload(purpose: audio)
→ POST /v1/song/recognize({upload_audio_id}) → lyrics_sections(ms) 를 초 단위
세그먼트 [{text,start,end}] 로 변환해 tracks.recognized_timestamps 에 저장.
자막 소비는 share_video._fetch_lyric_segments 폴백(generation 타임스탬프 없을 때)에서.

주의:
- 현재 Wondera 는 Cloudflare 로 한국발 요청이 403 차단 → 실호출은 성공할 수 없고
  LyricRecognizeError(정리된 메시지) → 라우트 502. 차단 해제 후 실검증 예정.
- _call_wondera_upload / _call_wondera_recognize 는 모듈 레벨 분리 —
  테스트에서 monkeypatch(mock) 주입 가능 구조.
- 유료 추정 API — 자동 호출 금지, 소유자 명시 요청만 (라우트에서 통제).
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from bson import ObjectId

from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..routes.wondera import WONDERA_API_BASE, _clean_wondera_error, _wondera_headers

logger = logging.getLogger(__name__)

WONDERA_TIMEOUT = 120.0

# Cloudflare 챌린지(403) 차단 시 사용자 안내 메시지
_BLOCKED_MESSAGE = "현재 Wondera 서비스 접속이 차단되어 있습니다. 차단 해제 후 다시 시도해주세요."


class LyricRecognizeError(Exception):
    """Wondera recognize 파이프라인 실패 (라우트에서 502 로 매핑)."""


def _failure_message(status_code: int, text: str) -> str:
    """Wondera HTTP 실패 → 사용자 노출용 정리 메시지 (HTML 원문 미노출)."""
    if status_code == 403:
        return _BLOCKED_MESSAGE
    return _clean_wondera_error(text)


async def _call_wondera_upload(audio_bytes: bytes, filename: str) -> str:
    """Wondera POST /v1/files/upload (purpose: audio) → upload id.

    모듈 레벨 함수 — 테스트에서 monkeypatch 로 mock 주입 가능.
    """
    async with httpx.AsyncClient(timeout=WONDERA_TIMEOUT) as client:
        resp = await client.post(
            "{}/files/upload".format(WONDERA_API_BASE),
            headers=_wondera_headers(),
            files={"file": (filename, audio_bytes, "audio/mpeg")},
            data={"purpose": "audio"},
        )
    if resp.status_code != 200:
        logger.error("[lyric-recognize] upload failed status=%s body=%s",
                     resp.status_code, resp.text[:500])
        raise LyricRecognizeError(_failure_message(resp.status_code, resp.text))
    result = resp.json()
    # 응답 형식 이중 대응: {data:{id}} / {id} (wondera.py 관행)
    upload_id = None
    if isinstance(result.get("data"), dict):
        upload_id = result["data"].get("id")
    upload_id = upload_id or result.get("id")
    if not upload_id:
        raise LyricRecognizeError("Wondera 업로드 응답에 파일 ID가 없습니다.")
    return str(upload_id)


async def _call_wondera_recognize(upload_id: str) -> dict:
    """Wondera POST /v1/song/recognize → {duration(ms), lyrics_sections:[{start,end,text}(ms)]}.

    모듈 레벨 함수 — 테스트에서 monkeypatch 로 mock 주입 가능.
    """
    async with httpx.AsyncClient(timeout=WONDERA_TIMEOUT) as client:
        resp = await client.post(
            "{}/song/recognize".format(WONDERA_API_BASE),
            headers={**_wondera_headers(), "Content-Type": "application/json"},
            json={"upload_audio_id": upload_id},
        )
    if resp.status_code != 200:
        logger.error("[lyric-recognize] recognize failed status=%s body=%s",
                     resp.status_code, resp.text[:500])
        raise LyricRecognizeError(_failure_message(resp.status_code, resp.text))
    return resp.json()


def _convert_sections(payload: dict) -> list:
    """recognize 응답 lyrics_sections(ms) → [{text, start(초), end(초)}] 변환.

    보정: 빈 text·start<0 스킵, end<=start → start+0.5. ms → s 는 /1000.
    """
    sections = payload.get("lyrics_sections")
    if not isinstance(sections, list):
        return []
    segments = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        text = str(sec.get("text") or "").strip()
        if not text:
            continue
        try:
            start = float(sec.get("start")) / 1000.0
            end = float(sec.get("end")) / 1000.0
        except (TypeError, ValueError):
            continue
        if start < 0:
            continue
        if end <= start:
            end = start + 0.5
        segments.append({"text": text, "start": start, "end": end})
    return segments


def _download_track_audio(audio_url: str) -> bytes:
    """MinIO(minio_bucket_music) 트랙 오디오 다운로드 (blocking — to_thread 로 호출)."""
    from ..config import settings

    minio_client = get_minio()
    response = minio_client.get_object(
        bucket_name=settings.minio_bucket_music,
        object_name=audio_url,
    )
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


async def recognize_track_timestamps(track_id: str) -> dict:
    """트랙 오디오 → Wondera recognize → recognized_timestamps 저장.

    Returns: {"cached": bool, "segments": N}
    Raises: ValueError(트랙 미존재/잘못된 ID — 라우트 404),
            LyricRecognizeError(Wondera 실패 — 라우트 502).
    """
    tid = str(track_id)
    short = tid[:8]
    if not ObjectId.is_valid(tid):
        raise ValueError("track not found")
    mongo = get_mongo()
    track = await mongo.tracks.find_one(
        {"_id": ObjectId(tid)},
        {"audio_url": 1, "recognized_timestamps": 1, "uploader_id": 1},
    )
    if not track:
        raise ValueError("track not found")

    existing = track.get("recognized_timestamps")
    if isinstance(existing, list) and existing:
        logger.info("[lyric-recognize] cached track=%s segments=%d", short, len(existing))
        return {"cached": True, "segments": len(existing)}

    audio_url = track.get("audio_url")
    if not audio_url:
        raise ValueError("track has no audio")

    logger.info("[lyric-recognize] start track=%s step=download", short)
    try:
        audio_bytes = await asyncio.to_thread(_download_track_audio, audio_url)
    except Exception as e:
        raise LyricRecognizeError("트랙 오디오를 불러오지 못했습니다.") from e

    filename = audio_url.rsplit("/", 1)[-1] or "track.mp3"
    logger.info("[lyric-recognize] track=%s step=upload bytes=%d", short, len(audio_bytes))
    upload_id = await _call_wondera_upload(audio_bytes, filename)

    logger.info("[lyric-recognize] track=%s step=recognize", short)
    payload = await _call_wondera_recognize(upload_id)

    segments = _convert_sections(payload)
    logger.info("[lyric-recognize] track=%s step=convert segments=%d", short, len(segments))
    if not segments:
        raise LyricRecognizeError("가사 타임스탬프를 인식하지 못했습니다.")

    await mongo.tracks.update_one(
        {"_id": ObjectId(tid)},
        {"$set": {
            "recognized_timestamps": segments,
            "recognized_at": datetime.now(timezone.utc),
        }},
    )
    logger.info("[lyric-recognize] track=%s step=saved segments=%d", short, len(segments))
    return {"cached": False, "segments": len(segments)}
