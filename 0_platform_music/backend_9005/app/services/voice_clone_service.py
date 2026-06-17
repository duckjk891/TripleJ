"""
v76: Suno V5_5 voice cloning service.

워크플로:
1. create_voice_clone: 사용자 음성 → MinIO 업로드 → presigned URL →
   Suno POST /voice/validate → taskId 수신 → MongoDB voice_clones insert
   (status=validating). 콜백으로 validateInfo(검증 문구) 도착 시
   handle_validate_callback 호출 → status=awaiting_verify.
2. submit_verify: 사용자가 문구 읽은 verify_file 업로드 → presigned →
   Suno POST /voice/generate → status=generating. 콜백으로 voice_id 도착
   → handle_generate_callback → status=ready.
3. poll_voice_record: 콜백 누락 시 record-info GET 으로 상태 폴백.
4. check_voice_available: voice/check-voice (생성된 voice 사용 가능 여부).
5. regenerate_phrase: 검증 문구 재생성 (/voice/regenerate).
6. list/get/delete: CRUD.

기존 routes/voice_persona.py + services/voice_persona_service.py 는 무관 (구버전).
컬렉션: voice_clones (신규).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from bson import ObjectId
from urllib.parse import urlparse, urlunparse

from ..config import settings
from ..database.minio import get_minio, get_public_minio
from ..database.mongodb import get_mongo
from .suno_generator import (
    SUNO_VOICE_CHECK_URL,
    SUNO_VOICE_GENERATE_URL,
    SUNO_VOICE_RECORD_INFO_URL,
    SUNO_VOICE_REGENERATE_URL,
    SUNO_VOICE_VALIDATE_INFO_URL,
    SUNO_VOICE_VALIDATE_URL,
)

logger = logging.getLogger(__name__)

VOICE_CLONES_COLLECTION = "voice_clones"
PRESIGN_HOURS = 24

STATUS_VALIDATING = "validating"          # validate 콜백 대기
STATUS_AWAITING_VERIFY = "awaiting_verify"  # validateInfo 수신, 사용자 verify 업로드 대기
STATUS_GENERATING = "generating"          # generate 콜백 대기
STATUS_READY = "ready"                    # voice_id 확보, 사용 가능
STATUS_FAILED = "failed"
STATUS_EXPIRED = "expired"                # 음악 생성 시 Suno 가 만료 보고 → 자동 플래그


def _suno_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }


def _suno_base() -> str:
    return settings.suno_api_url.rstrip("/")


def _callback_base() -> str:
    """외부에서 접근 가능한 base URL. 비어있으면 더미 (개발환경)."""
    return (settings.public_base_url or "https://localhost").rstrip("/")


def _validate_callback_url(clone_id: str) -> str:
    return f"{_callback_base()}/api/voice-clone/callback/validate?clone_id={clone_id}"


def _generate_callback_url(clone_id: str) -> str:
    return f"{_callback_base()}/api/voice-clone/callback/generate?clone_id={clone_id}"


def _presign(object_name: str) -> str:
    """MinIO presigned GET URL (music bucket, 24h).

    v76.2: SigV4 서명은 host 를 포함하므로 외부 fetch 용 URL 은 처음부터
    외부 host 로 만들어진 별도 MinIO 클라이언트로 서명한다 (단순 netloc swap 은 서명 불일치 → 403).

    - settings.minio_public_host 가 있으면 그 host 로 만든 public client 로 presign
    - 없으면 기존 내부 client 로 presign (구 동작 유지)
    """
    public_host = (getattr(settings, "minio_public_host", "") or "").strip()
    if public_host:
        client = get_public_minio(
            endpoint=public_host,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        url = client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=object_name,
            expires=timedelta(hours=PRESIGN_HOURS),
        )
        logger.info(
            "[voice_clone] presign via public client host=%s object=%s",
            public_host, object_name,
        )
        return url

    minio_client = get_minio()
    return minio_client.presigned_get_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        expires=timedelta(hours=PRESIGN_HOURS),
    )


def _serialize(doc: dict) -> dict:
    """Mongo doc → JSON-safe dict (ObjectId/datetime stringify)."""
    if not doc:
        return doc
    out = dict(doc)
    if "_id" in out:
        out["clone_id"] = str(out.pop("_id"))
    for k, v in list(out.items()):
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ── create / validate ───────────────────────────────────────────────────────


async def _call_validate(body: dict, *, clone_id: Optional[str] = None) -> dict:
    """sunoapi POST /voice/validate 단일 호출 + code 체크.

    Returns: sunoapi result dict (code==200 보장).
    Raises:
        ValueError: 네트워크 실패 ("network: ...") 또는 code!=200 ("validate code=...: ...").
                    "Internal Error" 문자열을 메시지에 포함하면 호출측에서 1회 재시도 가능.
    """
    url = SUNO_VOICE_VALIDATE_URL.format(base=_suno_base())
    tag = f"[voice_clone:{clone_id}]" if clone_id else "[voice_clone]"
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=_suno_headers(), json=body)
    except Exception as e:
        logger.exception("%s _call_validate network error", tag)
        raise ValueError(f"network: {str(e)[:120]}")
    dt = time.monotonic() - t0
    logger.info(
        "%s suno voice/validate POST elapsed=%.2fs status=%d body_len=%d",
        tag, dt, resp.status_code, len(resp.content or b""),
    )
    try:
        resp.raise_for_status()
        result = resp.json()
    except Exception as e:
        logger.exception("%s _call_validate http/json error status=%d", tag, resp.status_code)
        raise ValueError(f"http {resp.status_code}: {str(e)[:120]}")

    if result.get("code") != 200:
        msg = result.get("msg", "Unknown error")
        try:
            _body_snippet = str(result)[:512]
        except Exception:
            _body_snippet = "?"
        logger.error(
            "%s _call_validate code=%s msg=%s resp=%s",
            tag, result.get("code"), msg, _body_snippet,
        )
        raise ValueError(f"validate code={result.get('code')}: {msg}")
    return result


async def create_voice_clone(
    user_id: str,
    voice_name: str,
    description: str,
    source_object_name: str,
    vocal_start_s: float,
    vocal_end_s: float,
    language: str = "ko",
    style_mode: str = "sing",
) -> dict:
    """소스 음성 → Suno voice/validate 요청 → MongoDB insert.

    Returns: {clone_id, validate_task_id}
    """
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    mongo = get_mongo()
    # Mongo 먼저 insert (clone_id 확보 → 콜백 URL 에 포함 가능)
    now = datetime.now(timezone.utc)
    pre_doc = {
        "user_id": user_id,
        "voice_name": voice_name,
        "description": description,
        "source_object_name": source_object_name,
        "vocal_start_s": float(vocal_start_s),
        "vocal_end_s": float(vocal_end_s),
        "language": language,
        "style_mode": style_mode,
        "status": STATUS_VALIDATING,
        "validate_task_id": None,
        "generate_task_id": None,
        "validate_info": None,
        "voice_id": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    ins = await mongo[VOICE_CLONES_COLLECTION].insert_one(pre_doc)
    clone_id = str(ins.inserted_id)

    logger.info(
        "[voice_clone:%s] create start user=%s voice_name=%s source=%s start=%.2f end=%.2f lang=%s",
        clone_id, user_id, voice_name, source_object_name, vocal_start_s, vocal_end_s, language,
    )

    try:
        voice_url = _presign(source_object_name)
    except Exception:
        logger.exception("[voice_clone:%s] presign source failed object=%s", clone_id, source_object_name)
        await _set_status(clone_id, STATUS_FAILED, error_message="소스 음성 presigned URL 생성 실패")
        raise

    # sunoapi.org 스펙: vocalStartS/EndS 는 integer. callBackUrl 은 optional.
    body = {
        "voiceUrl": voice_url,
        "vocalStartS": int(vocal_start_s),
        "vocalEndS": int(vocal_end_s),
        "language": language,
    }
    callback_url = _validate_callback_url(clone_id)
    if callback_url and not callback_url.startswith("https://localhost"):
        body["callBackUrl"] = callback_url

    # 진단 로그: voiceUrl 호스트만 노출 (presigned 토큰 마스킹), body keys, callBack 사용 여부
    try:
        from urllib.parse import urlparse as _urlparse
        _vh = _urlparse(voice_url)
        _voice_host = f"{_vh.scheme}://{_vh.netloc}"
    except Exception:
        _voice_host = "?"
    logger.info(
        "[voice_clone:%s] suno voice/validate request voice_host=%s start=%d end=%d lang=%s callback=%s",
        clone_id, _voice_host, int(vocal_start_s), int(vocal_end_s), language,
        "yes" if "callBackUrl" in body else "no",
    )

    # v76.3: sunoapi 가 generic "Internal Error" 를 던지면 1회 자동 재시도 (총 2회 호출).
    result: dict | None = None
    last_err: ValueError | None = None
    for attempt in range(2):
        try:
            result = await _call_validate(body, clone_id=clone_id)
            break
        except ValueError as e:
            last_err = e
            if attempt == 0 and "Internal Error" in str(e):
                logger.warning(
                    "[voice_clone:%s] retry_validate attempt=1 reason=%s",
                    clone_id, str(e)[:80],
                )
                await asyncio.sleep(3)
                continue
            # 재시도 대상이 아니거나 두번째 시도도 실패 → 종료.
            await _set_status(clone_id, STATUS_FAILED, error_message=f"validate 거부: {str(e)[:200]}")
            raise

    if result is None:
        # 이론상 break 가 안된 경우 — 위 raise 가 실행되었어야 함.
        await _set_status(clone_id, STATUS_FAILED, error_message=f"validate 실패: {str(last_err)[:200] if last_err else 'unknown'}")
        raise ValueError(f"Suno validate 오류: {last_err}")

    validate_task_id = (result.get("data") or {}).get("taskId")
    if not validate_task_id:
        logger.error("[voice_clone:%s] voice/validate missing taskId resp=%s", clone_id, result)
        await _set_status(clone_id, STATUS_FAILED, error_message="taskId 없음")
        raise ValueError("Suno validate 응답에 taskId가 없습니다.")

    await mongo[VOICE_CLONES_COLLECTION].update_one(
        {"_id": ObjectId(clone_id)},
        {"$set": {
            "validate_task_id": validate_task_id,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    logger.info("[voice_clone:%s] validate_task_id=%s status=%s", clone_id, validate_task_id, STATUS_VALIDATING)
    return {"clone_id": clone_id, "validate_task_id": validate_task_id}


async def handle_validate_callback(clone_id: str, payload: dict) -> None:
    """Suno → 우리 콜백 (validate 완료). payload 에서 validateInfo 추출 → DB."""
    logger.info("[voice_clone:%s] validate callback received keys=%s", clone_id, list((payload or {}).keys()))
    mongo = get_mongo()
    data = (payload or {}).get("data") or payload or {}
    validate_info = data.get("validateInfo") or data.get("validate_info") or data
    err_code = data.get("errorCode") or payload.get("errorCode")
    err_msg = data.get("errorMessage") or payload.get("errorMessage") or payload.get("msg")

    if err_code and err_code not in (0, "0", 200, "200"):
        logger.error(
            "[voice_clone:%s] validate callback errorCode=%s errorMessage=%s",
            clone_id, err_code, err_msg,
        )
        await _set_status(clone_id, STATUS_FAILED, error_message=f"validate 실패: {err_msg}")
        return

    await mongo[VOICE_CLONES_COLLECTION].update_one(
        {"_id": ObjectId(clone_id)},
        {"$set": {
            "validate_info": validate_info,
            "status": STATUS_AWAITING_VERIFY,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    logger.info(
        "[voice_clone:%s] status %s -> %s validate_info_keys=%s",
        clone_id, STATUS_VALIDATING, STATUS_AWAITING_VERIFY,
        list(validate_info.keys()) if isinstance(validate_info, dict) else "non-dict",
    )


# ── verify / generate ───────────────────────────────────────────────────────


async def submit_verify(clone_id: str, verify_object_name: str, singer_skill_level: str) -> dict:
    """사용자 verify 음성 → Suno voice/generate 요청."""
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    mongo = get_mongo()
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
    if not doc:
        raise ValueError("voice_clone not found")

    validate_task_id = doc.get("validate_task_id")
    if not validate_task_id:
        raise ValueError("validate_task_id 없음 (validate 미완료)")

    logger.info(
        "[voice_clone:%s] submit_verify start verify_object=%s skill=%s",
        clone_id, verify_object_name, singer_skill_level,
    )

    try:
        verify_url = _presign(verify_object_name)
    except Exception:
        logger.exception("[voice_clone:%s] presign verify failed object=%s", clone_id, verify_object_name)
        await _set_status(clone_id, STATUS_FAILED, error_message="verify presigned URL 실패")
        raise

    body = {
        "taskId": validate_task_id,
        "verifyUrl": verify_url,
        "voiceName": doc.get("voice_name") or "",
        "description": doc.get("description") or "",
        "singerSkillLevel": str(singer_skill_level),
        "callBackUrl": _generate_callback_url(clone_id),
    }
    style_mode = doc.get("style_mode")
    if style_mode:
        body["style"] = style_mode

    url = SUNO_VOICE_GENERATE_URL.format(base=_suno_base())
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=_suno_headers(), json=body)
        dt = time.monotonic() - t0
        logger.info(
            "[voice_clone:%s] suno voice/generate POST elapsed=%.2fs status=%d",
            clone_id, dt, resp.status_code,
        )
        resp.raise_for_status()
        result = resp.json()
    except Exception:
        logger.exception("[voice_clone:%s] voice/generate request failed", clone_id)
        await _set_status(clone_id, STATUS_FAILED, error_message="voice/generate 호출 실패")
        raise

    if result.get("code") != 200:
        msg = result.get("msg", "Unknown error")
        logger.error("[voice_clone:%s] voice/generate code=%s msg=%s", clone_id, result.get("code"), msg)
        await _set_status(clone_id, STATUS_FAILED, error_message=f"generate 거부: {msg}")
        raise ValueError(f"Suno generate 오류: {msg}")

    generate_task_id = (result.get("data") or {}).get("taskId")
    if not generate_task_id:
        logger.error("[voice_clone:%s] voice/generate missing taskId resp=%s", clone_id, result)
        await _set_status(clone_id, STATUS_FAILED, error_message="taskId 없음")
        raise ValueError("Suno generate 응답에 taskId가 없습니다.")

    await mongo[VOICE_CLONES_COLLECTION].update_one(
        {"_id": ObjectId(clone_id)},
        {"$set": {
            "generate_task_id": generate_task_id,
            "verify_object_name": verify_object_name,
            "singer_skill_level": str(singer_skill_level),
            "status": STATUS_GENERATING,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    logger.info(
        "[voice_clone:%s] status %s -> %s generate_task_id=%s",
        clone_id, STATUS_AWAITING_VERIFY, STATUS_GENERATING, generate_task_id,
    )
    return {"clone_id": clone_id, "generate_task_id": generate_task_id}


async def handle_generate_callback(clone_id: str, payload: dict) -> None:
    """Suno → 우리 콜백 (generate 완료). voice_id 추출 → status=ready."""
    logger.info("[voice_clone:%s] generate callback received keys=%s", clone_id, list((payload or {}).keys()))
    mongo = get_mongo()
    data = (payload or {}).get("data") or payload or {}
    voice_id = data.get("voiceId") or data.get("voice_id")
    status_str = (data.get("status") or "").upper()
    err_code = data.get("errorCode") or payload.get("errorCode")
    err_msg = data.get("errorMessage") or payload.get("errorMessage") or payload.get("msg")

    if (err_code and err_code not in (0, "0", 200, "200")) or status_str == "FAILED":
        logger.error(
            "[voice_clone:%s] generate callback failed errorCode=%s errorMessage=%s",
            clone_id, err_code, err_msg,
        )
        await _set_status(clone_id, STATUS_FAILED, error_message=f"generate 실패: {err_msg}")
        return

    if not voice_id:
        logger.warning(
            "[voice_clone:%s] generate callback missing voiceId, payload status=%s",
            clone_id, status_str,
        )
        # voice_id 가 없으면 아직 진행 중일 수도 있음. 상태만 갱신.
        await mongo[VOICE_CLONES_COLLECTION].update_one(
            {"_id": ObjectId(clone_id)},
            {"$set": {"updated_at": datetime.now(timezone.utc)}},
        )
        return

    await mongo[VOICE_CLONES_COLLECTION].update_one(
        {"_id": ObjectId(clone_id)},
        {"$set": {
            "voice_id": voice_id,
            "status": STATUS_READY,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    logger.info(
        "[voice_clone:%s] status %s -> %s voice_id=%s",
        clone_id, STATUS_GENERATING, STATUS_READY, voice_id,
    )


# ── polling fallbacks ───────────────────────────────────────────────────────


async def poll_voice_record(generate_task_id: str) -> dict:
    """GET /voice/record-info — 콜백 누락시 폴링."""
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")
    url = SUNO_VOICE_RECORD_INFO_URL.format(base=_suno_base())
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=_suno_headers(), params={"taskId": generate_task_id})
    dt = time.monotonic() - t0
    logger.info(
        "[voice_clone] suno voice/record-info GET taskId=%s elapsed=%.2fs status=%d",
        generate_task_id, dt, resp.status_code,
    )
    resp.raise_for_status()
    return resp.json()


async def poll_validate_info(clone_id: str) -> dict | None:
    """v76.2: GET /voice/validate-info — 콜백 미수신 환경에서 phrase 폴링.

    doc.status == 'validating' 이고 validate_task_id 가 있을 때 호출.
    sunoapi data.status:
      - 'wait_validating' → validateInfo 채워짐 → doc 갱신 + status=awaiting_verify
      - 'processing_validate' / 'wait_processing' → 아직 → 변경 없이 반환
      - 'fail' / 'processing_validate_fail' → status=failed 로 표시
    Returns: 갱신된 doc (변동 없으면 기존 doc)
    """
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    mongo = get_mongo()
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
    if not doc:
        return None
    task_id = doc.get("validate_task_id")
    if not task_id:
        return doc

    url = SUNO_VOICE_VALIDATE_INFO_URL.format(base=_suno_base())
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=_suno_headers(), params={"taskId": task_id})
        dt = time.monotonic() - t0
        logger.info(
            "[voice_clone:%s] suno voice/validate-info GET taskId=%s elapsed=%.2fs status=%d",
            clone_id, task_id, dt, resp.status_code,
        )
        resp.raise_for_status()
        result = resp.json()
    except Exception:
        logger.exception("[voice_clone:%s] poll_validate_info request failed", clone_id)
        return doc

    data = (result.get("data") or {}) if isinstance(result, dict) else {}
    suno_status = (data.get("status") or "").strip()
    validate_info = data.get("validateInfo") or ""

    if suno_status == "wait_validating" and validate_info:
        now = datetime.now(timezone.utc)
        await mongo[VOICE_CLONES_COLLECTION].update_one(
            {"_id": ObjectId(clone_id)},
            {"$set": {
                "validate_info": validate_info,
                "status": STATUS_AWAITING_VERIFY,
                "updated_at": now,
            }},
        )
        logger.info(
            "[voice_clone:%s] poll validate_info OK suno_status=%s phrase_len=%d -> awaiting_verify",
            clone_id, suno_status, len(validate_info),
        )
        fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
        return _serialize(fresh) if fresh else None

    if suno_status in ("fail", "processing_validate_fail"):
        err_msg = data.get("errorMessage") or f"validate failed ({suno_status})"
        retry_count = int(doc.get("validate_retry_count") or 0)
        # v76.3: 첫 fail (count==0) 시 새 voice/validate POST 로 1회 자동 재시도.
        if retry_count < 1:
            logger.warning(
                "[voice_clone:%s] retry_validate auto on %s count=%d err=%s",
                clone_id, suno_status, retry_count, err_msg,
            )
            source_obj = doc.get("source_object_name")
            if not source_obj:
                logger.error("[voice_clone:%s] retry_validate skipped — no source_object_name", clone_id)
                await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
                fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
                return _serialize(fresh) if fresh else None
            try:
                voice_url = _presign(source_obj)
            except Exception:
                logger.exception("[voice_clone:%s] retry_validate presign failed", clone_id)
                await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
                fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
                return _serialize(fresh) if fresh else None

            new_body = {
                "voiceUrl": voice_url,
                "vocalStartS": int(doc.get("vocal_start_s") or 0),
                "vocalEndS": int(doc.get("vocal_end_s") or 0),
                "language": doc.get("language") or "ko",
            }
            callback_url = _validate_callback_url(clone_id)
            if callback_url and not callback_url.startswith("https://localhost"):
                new_body["callBackUrl"] = callback_url

            try:
                new_result = await _call_validate(new_body, clone_id=clone_id)
            except ValueError as e:
                logger.warning(
                    "[voice_clone:%s] retry_validate call failed err=%s",
                    clone_id, str(e)[:120],
                )
                await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
                fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
                return _serialize(fresh) if fresh else None

            new_task = (new_result.get("data") or {}).get("taskId")
            if not new_task:
                logger.error("[voice_clone:%s] retry_validate missing taskId resp=%s", clone_id, new_result)
                await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
                fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
                return _serialize(fresh) if fresh else None

            now = datetime.now(timezone.utc)
            await mongo[VOICE_CLONES_COLLECTION].update_one(
                {"_id": ObjectId(clone_id)},
                {"$set": {
                    "validate_task_id": new_task,
                    "validate_retry_count": retry_count + 1,
                    "status": STATUS_VALIDATING,
                    "error_message": None,
                    "updated_at": now,
                }},
            )
            logger.info(
                "[voice_clone:%s] retry_validate scheduled new_task=%s count=%d",
                clone_id, new_task, retry_count + 1,
            )
            fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
            return _serialize(fresh) if fresh else None

        # 이미 1회 재시도 했음 → 진짜 fail.
        await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
        logger.warning(
            "[voice_clone:%s] poll validate_info FAIL (after retry) suno_status=%s err=%s",
            clone_id, suno_status, err_msg,
        )
        fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
        return _serialize(fresh) if fresh else None

    logger.info(
        "[voice_clone:%s] poll validate_info pending suno_status=%s",
        clone_id, suno_status or "?",
    )
    return _serialize(doc)


async def poll_generate_voice(clone_id: str) -> dict | None:
    """v76.2: GET /voice/record-info — generate 단계의 voiceId 자동 폴링.

    doc.status == 'generating' 이고 generate_task_id 가 있을 때 호출.
    record-info data.status == 'success' 면 voiceId 저장 + STATUS_READY.
    실패면 STATUS_FAILED.
    """
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    mongo = get_mongo()
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
    if not doc:
        return None
    task_id = doc.get("generate_task_id")
    if not task_id:
        return doc

    try:
        result = await poll_voice_record(task_id)
    except Exception:
        logger.exception("[voice_clone:%s] poll_generate_voice request failed", clone_id)
        return doc

    data = (result.get("data") or {}) if isinstance(result, dict) else {}
    suno_status = (data.get("status") or "").strip()
    voice_id = data.get("voiceId")

    if suno_status == "success" and voice_id:
        now = datetime.now(timezone.utc)
        await mongo[VOICE_CLONES_COLLECTION].update_one(
            {"_id": ObjectId(clone_id)},
            {"$set": {
                "voice_id": voice_id,
                "status": STATUS_READY,
                "updated_at": now,
            }},
        )
        logger.info(
            "[voice_clone:%s] poll generate voice OK voice_id_len=%d -> ready",
            clone_id, len(str(voice_id)),
        )
        fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
        return _serialize(fresh) if fresh else None

    if suno_status in ("fail",):
        err_msg = data.get("errorMessage") or "generate failed"
        await _set_status(clone_id, STATUS_FAILED, error_message=err_msg)
        logger.warning(
            "[voice_clone:%s] poll generate voice FAIL suno_status=%s err=%s",
            clone_id, suno_status, err_msg,
        )
        fresh = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
        return _serialize(fresh) if fresh else None

    logger.info(
        "[voice_clone:%s] poll generate voice pending suno_status=%s",
        clone_id, suno_status or "?",
    )
    return _serialize(doc)


async def check_voice_available(generate_task_id: str) -> bool:
    """POST /voice/check-voice — 사용 가능 여부."""
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")
    url = SUNO_VOICE_CHECK_URL.format(base=_suno_base())
    body = {"task_id": generate_task_id}
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=_suno_headers(), json=body)
    dt = time.monotonic() - t0
    logger.info(
        "[voice_clone] suno voice/check-voice POST taskId=%s elapsed=%.2fs status=%d",
        generate_task_id, dt, resp.status_code,
    )
    resp.raise_for_status()
    result = resp.json()
    is_available = bool((result.get("data") or {}).get("isAvailable"))
    logger.info(
        "[voice_clone] check-voice taskId=%s isAvailable=%s",
        generate_task_id, is_available,
    )
    return is_available


async def check_all_availability(user_id: str) -> dict:
    """사용자의 ready 보이스 전체에 대해 Suno check-voice 호출 → 만료된 보이스 삭제.

    - status==ready & voice_id & generate_task_id 가 모두 있는 클론만 검사.
    - check_voice_available 를 asyncio.gather(return_exceptions=True) 로 동시 호출.
    - True  → 사용 가능, 유지.
    - False → 만료(EXPIRED) → 영구 삭제 (delete_voice_clone 과 동일 경로).
    - Exception(네트워크/API 일시 오류) → 절대 삭제하지 않음. 유지 + warning 로그.

    Returns: {checked, available:[clone_id], expired:[{clone_id,voice_name}], errors}
    """
    logger.info("[voice_clone:check_all] user=%s start", user_id)

    mongo = get_mongo()
    cursor = mongo[VOICE_CLONES_COLLECTION].find({
        "user_id": user_id,
        "status": STATUS_READY,
        "voice_id": {"$nin": [None, ""]},
        "generate_task_id": {"$nin": [None, ""]},
    })
    docs = await cursor.to_list(length=500)

    available: list[str] = []
    expired: list[dict] = []
    errors = 0

    if docs:
        results = await asyncio.gather(
            *[check_voice_available(d.get("generate_task_id")) for d in docs],
            return_exceptions=True,
        )
        for doc, res in zip(docs, results):
            clone_id = str(doc.get("_id"))
            voice_name = doc.get("voice_name") or ""
            if isinstance(res, Exception):
                errors += 1
                logger.warning(
                    "[voice_clone:check_all] user=%s clone=%s transient check error, keeping: %s",
                    user_id, clone_id, str(res)[:200],
                )
                continue
            if res:
                available.append(clone_id)
                continue
            # res is definitively False → expired → 영구 삭제.
            await delete_voice_clone(user_id, clone_id)
            expired.append({"clone_id": clone_id, "voice_name": voice_name})
            logger.info(
                "[voice_clone:check_all] user=%s clone=%s expired -> deleted",
                user_id, clone_id,
            )

    logger.info(
        "[voice_clone:check_all] user=%s checked=%d available=%d expired=%d errors=%d",
        user_id, len(docs), len(available), len(expired), errors,
    )
    return {
        "checked": len(docs),
        "available": available,
        "expired": expired,
        "errors": errors,
    }


async def regenerate_phrase(clone_id: str) -> dict:
    """검증 문구 재생성.

    sunoapi 스펙: POST /voice/regenerate 는 기존 validate task 의 phrase 만 재생성.
    body = {taskId, callBackUrl(optional)}  — voiceUrl/vocalStartS/EndS 등 받지 않음.
    """
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    mongo = get_mongo()
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": ObjectId(clone_id)})
    if not doc:
        raise ValueError("voice_clone not found")

    existing_task_id = doc.get("validate_task_id")
    if not existing_task_id:
        raise ValueError("validate_task_id 없음 — regenerate 불가 (먼저 새 voice clone 생성 필요)")

    logger.info("[voice_clone:%s] regenerate_phrase start existing_task=%s", clone_id, existing_task_id)

    body = {"taskId": existing_task_id}
    callback_url = _validate_callback_url(clone_id)
    if callback_url and not callback_url.startswith("https://localhost"):
        body["callBackUrl"] = callback_url
    url = SUNO_VOICE_REGENERATE_URL.format(base=_suno_base())
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=_suno_headers(), json=body)
        dt = time.monotonic() - t0
        logger.info(
            "[voice_clone:%s] suno voice/regenerate POST elapsed=%.2fs status=%d",
            clone_id, dt, resp.status_code,
        )
        resp.raise_for_status()
        result = resp.json()
    except Exception:
        logger.exception("[voice_clone:%s] voice/regenerate failed", clone_id)
        raise

    if result.get("code") != 200:
        msg = result.get("msg", "Unknown error")
        logger.error("[voice_clone:%s] voice/regenerate code=%s msg=%s", clone_id, result.get("code"), msg)
        # v76.4: sunoapi 가 "이미 phrase 발급 성공한 task" 에 대해 regenerate 거부 (정책).
        # msg 패턴 매칭으로 자동 폴백 — 새 /voice/validate POST 호출해서 새 task 발급 (같은 음원).
        msg_lower = msg.lower()
        if any(k in msg_lower for k in ("not found", "not need", "not require", "does not")):
            source_obj = doc.get("source_object_name")
            if not source_obj:
                raise ValueError(f"Suno regenerate 오류: {msg}")
            logger.warning(
                "[voice_clone:%s] regenerate rejected by sunoapi, falling back to new /voice/validate (source=%s)",
                clone_id, source_obj,
            )
            voice_url = _presign(source_obj)
            new_body = {
                "voiceUrl": voice_url,
                "vocalStartS": int(doc.get("vocal_start_s") or 0),
                "vocalEndS": int(doc.get("vocal_end_s") or 0),
                "language": doc.get("language") or "ko",
            }
            cb_url = _validate_callback_url(clone_id)
            if cb_url and not cb_url.startswith("https://localhost"):
                new_body["callBackUrl"] = cb_url
            new_result = await _call_validate(new_body, clone_id=clone_id)
            new_task = (new_result.get("data") or {}).get("taskId")
            if not new_task:
                raise ValueError("regenerate 폴백: 새 validate task 발급 실패")
            await mongo[VOICE_CLONES_COLLECTION].update_one(
                {"_id": ObjectId(clone_id)},
                {"$set": {
                    "validate_task_id": new_task,
                    "validate_info": None,
                    "status": STATUS_VALIDATING,
                    "error_message": None,
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
            logger.info(
                "[voice_clone:%s] regenerate fallback OK new_task=%s status->%s",
                clone_id, new_task, STATUS_VALIDATING,
            )
            return {"validate_task_id": new_task}
        raise ValueError(f"Suno regenerate 오류: {msg}")

    validate_task_id = (result.get("data") or {}).get("taskId")
    if not validate_task_id:
        raise ValueError("Suno regenerate 응답에 taskId가 없습니다.")

    await mongo[VOICE_CLONES_COLLECTION].update_one(
        {"_id": ObjectId(clone_id)},
        {"$set": {
            "validate_task_id": validate_task_id,
            "validate_info": None,
            "status": STATUS_VALIDATING,
            "error_message": None,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    logger.info(
        "[voice_clone:%s] regenerate task_id=%s status->%s",
        clone_id, validate_task_id, STATUS_VALIDATING,
    )
    return {"validate_task_id": validate_task_id}


# ── CRUD ────────────────────────────────────────────────────────────────────


async def list_voice_clones(user_id: str) -> list[dict]:
    mongo = get_mongo()
    cursor = mongo[VOICE_CLONES_COLLECTION].find(
        {"user_id": user_id}
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=500)
    logger.info("[voice_clone] list user=%s count=%d", user_id, len(docs))
    return [_serialize(d) for d in docs]


async def get_voice_clone(user_id: str, clone_id: str) -> Optional[dict]:
    mongo = get_mongo()
    try:
        oid = ObjectId(clone_id)
    except Exception:
        logger.warning("[voice_clone:%s] invalid clone_id format", clone_id)
        return None
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return None
    return _serialize(doc)


async def delete_voice_clone(user_id: str, clone_id: str) -> bool:
    mongo = get_mongo()
    try:
        oid = ObjectId(clone_id)
    except Exception:
        return False
    doc = await mongo[VOICE_CLONES_COLLECTION].find_one_and_delete(
        {"_id": oid, "user_id": user_id}
    )
    if not doc:
        logger.info("[voice_clone:%s] delete miss user=%s", clone_id, user_id)
        return False

    # MinIO 정리 (실패해도 무시)
    minio_client = get_minio()
    for key in ("source_object_name", "verify_object_name"):
        obj = doc.get(key)
        if not obj:
            continue
        try:
            minio_client.remove_object(settings.minio_bucket_music, obj)
            logger.info("[voice_clone:%s] minio removed %s", clone_id, obj)
        except Exception as e:
            logger.warning("[voice_clone:%s] minio remove failed object=%s err=%s", clone_id, obj, e)
    logger.info("[voice_clone:%s] deleted user=%s", clone_id, user_id)
    return True


async def cleanup_expired(user_id: str) -> dict:
    """이 사용자의 status=='expired' 클론만 일괄 영구삭제.

    ready/진행중 클론은 절대 건드리지 않음.
    Returns: {deleted:int, deleted_ids:[clone_id...], deleted_names:[voice_name...]}.
    """
    logger.info("[voice_clone:cleanup] user=%s start", user_id)
    deleted_ids: list[str] = []
    deleted_names: list[str] = []
    try:
        mongo = get_mongo()
        cursor = mongo[VOICE_CLONES_COLLECTION].find(
            {"user_id": user_id, "status": STATUS_EXPIRED}
        )
        docs = await cursor.to_list(length=500)
        for d in docs:
            deleted_ids.append(str(d.get("_id")))
            deleted_names.append(d.get("voice_name") or "")
        res = await mongo[VOICE_CLONES_COLLECTION].delete_many(
            {"user_id": user_id, "status": STATUS_EXPIRED}
        )
        deleted = int(res.deleted_count)
        logger.info("[voice_clone:cleanup] user=%s deleted=%d", user_id, deleted)
        return {"deleted": deleted, "deleted_ids": deleted_ids, "deleted_names": deleted_names}
    except Exception:
        logger.exception("[voice_clone:cleanup] user=%s failed", user_id)
        raise


# ── internal ────────────────────────────────────────────────────────────────


async def _set_status(clone_id: str, status: str, error_message: Optional[str] = None) -> None:
    mongo = get_mongo()
    update: dict[str, Any] = {"status": status, "updated_at": datetime.now(timezone.utc)}
    if error_message is not None:
        update["error_message"] = error_message
    try:
        await mongo[VOICE_CLONES_COLLECTION].update_one(
            {"_id": ObjectId(clone_id)},
            {"$set": update},
        )
    except Exception:
        logger.exception("[voice_clone:%s] _set_status failed status=%s", clone_id, status)
