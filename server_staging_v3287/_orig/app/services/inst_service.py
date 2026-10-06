"""v3.210 ③ — AI 곡 "(Inst.)" 버전 생성 서비스 (sunoapi.org vocal-removal).

경로 확정(PLAN v3.210 0단계 findings ③):
- 자체 보컬 분리(demucs/torch) 부활 금지 — Dockerfile v199 가드 준수.
- sunoapi.org `POST /api/v1/vocal-removal/generate` 에 **audioUrl 방식**
  (자체 MinIO presigned URL, ≤20MB) 단일 경로 — Suno측 원본이 14일 만료라
  구곡의 taskId/audioId 경로는 신뢰 불가(PLAN 권고).
- 폴링 `GET /api/v1/vocal-removal/record-info?taskId=` (successFlag
  PENDING/SUCCESS/…-FAILED, response.instrumentalUrl) — 기존 generate
  record-info 폴링 관행(suno_generator.py) 동일 패턴.
- 산출 instrumentalUrl 도 14일 만료 → 즉시 다운로드해 MinIO 이관.
- 신규 트랙 자동 발매: 제목 "{원제} (Inst.)", 커버·장르·무드·아티스트/캐릭터
  스냅샷 원곡 상속, lyrics 없음, is_public 원곡 동일, source_track_id 기록.
- 실패·타임아웃 시 선차감 ⭐ 자동 환불 — generate.py refund_generation_points
  패턴(원자 refunded 클레임, 정확히 1회, never raises).

작업 상태는 `inst_jobs` 컬렉션(라우트에서 원자 클레임으로 생성):
  {_id, track_id, user_id, status: processing|completed|failed, active,
   point_ref, point_cost, refunded, result_track_id, error_message,
   suno_task_id, suno_request_body(민감 질의문자열 마스킹)+hash,
   requested_at, responded_at, suno_response, created_at, updated_at}

로그 추적자: `[inst] track=<원곡> job=<job>` — 외부 호출 전후·폴링 상태·환불
전부 logger 기록. API 키/presigned 서명 질의문자열은 절대 로그·저장 금지.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import secrets
import subprocess
import tempfile
from datetime import datetime, timezone

import httpx
from bson import ObjectId

from ..config import settings
from ..database.minio import get_minio
from .media_urls import public_presign

logger = logging.getLogger(__name__)

# v3.214: Suno 게이트웨이가 긴 presigned URL(IAM 세션 토큰 포함 ~1900자)을 거부함을
# 실증(짧은 공개 URL은 즉시 성공) — 짧은 토큰 보호 리다이렉트 URL을 audioUrl로 전달하고,
# 게이트웨이의 fetch가 우리 라우트(/api/tracks/inst-audio/...)에서 presigned로 302 된다.
# (v3.215 배포 시 베이스 착오로 유실 → v3.216 복원 — 재발 방지: _orig 는 반드시 라이브 서버에서 pull)
_PUBLIC_API_BASE = "https://api.maidol.ai.kr"

# 원곡 오디오 크기 상한 — sunoapi.org vocal-removal audioUrl 스펙(≤20MB, 공식 문서).
MAX_SOURCE_AUDIO_SIZE = 20 * 1024 * 1024

# 폴링: 5초 간격 × 60회 = 최대 5분 — 일반 generate 폴링(suno_generator.py:300)과 동일.
INST_POLL_INTERVAL_SEC = 5
INST_MAX_POLLS = 60

# v3.215 ③ — Inst 라우드니스 정규화 (실측: 원곡 -13.9 LUFS vs Inst -21.2 LUFS = 7.3LU 격차).
#   목표 -14 LUFS(스트리밍 표준 ≈ 원곡 실측), TP -1.5 클립 방지, 320k 재인코딩 손실 최소화.
#   1-pass loudnorm (PLAN: 2-pass 불요) — best-effort, 실패 시 원본 그대로 저장.
INST_LOUDNORM_FILTER = "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json"
INST_LOUDNORM_TIMEOUT_SEC = 180

# record-info successFlag terminal 실패 집합 (suno_generator.SUNO_TERMINAL_ERROR_STATUSES 관행).
INST_TERMINAL_ERROR_STATUSES = {
    "FAILED",
    "CREATE_TASK_FAILED",
    "GENERATE_AUDIO_FAILED",
    "CALLBACK_EXCEPTION",
    "SENSITIVE_WORD_ERROR",
}


def _normalize_inst_loudness(audio_bytes: bytes, track_id: str, job_id: str) -> bytes:
    """v3.215 ③ — 분리 결과 mp3 라우드니스 정규화 (blocking, best-effort).

    ffmpeg 1-pass `loudnorm=I=-14:TP=-1.5:LRA=11` + 48kHz/320k mp3 재인코딩.
    print_format=json 으로 stderr 에 찍히는 측정치(input_i/tp → output_i/tp)를
    `[inst] loudnorm applied` 로그에 기록한다.

    실패(ffmpeg 부재·비정상 종료·빈 산출물)는 파이프라인 실패 사유가 아니며
    원본 bytes 를 그대로 반환한다 — 로그 `[inst] loudnorm skipped`. Never raises.
    """
    try:
        from .mv_generator import _get_ffmpeg_path

        ffmpeg = _get_ffmpeg_path()
        if not ffmpeg:
            logger.warning(
                "[inst] loudnorm skipped track=%s job=%s reason=ffmpeg-not-available",
                track_id, job_id,
            )
            return audio_bytes
        with tempfile.TemporaryDirectory(prefix="inst_loudnorm_") as tmp_dir:
            in_path = os.path.join(tmp_dir, "in.mp3")
            out_path = os.path.join(tmp_dir, "out.mp3")
            with open(in_path, "wb") as f:
                f.write(audio_bytes)
            cmd = [
                ffmpeg, "-y", "-i", in_path,
                "-af", INST_LOUDNORM_FILTER,
                "-ar", "48000", "-b:a", "320k", "-vn",
                out_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, timeout=INST_LOUDNORM_TIMEOUT_SEC)
            if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
                tail = (proc.stderr or b"").decode("utf-8", errors="replace")[-300:]
                logger.warning(
                    "[inst] loudnorm skipped track=%s job=%s rc=%s stderr_tail=%s",
                    track_id, job_id, proc.returncode, tail,
                )
                return audio_bytes
            # loudnorm print_format=json — stderr 말미의 JSON 블록에서 측정/적용 값 추출
            stats = {}
            try:
                stderr_text = (proc.stderr or b"").decode("utf-8", errors="replace")
                start = stderr_text.rfind("{")
                end = stderr_text.rfind("}")
                if 0 <= start < end:
                    stats = json.loads(stderr_text[start:end + 1])
            except Exception:
                stats = {}
            with open(out_path, "rb") as f:
                normalized = f.read()
            logger.info(
                "[inst] loudnorm applied track=%s job=%s target=I-14/TP-1.5 "
                "input_i=%s input_tp=%s output_i=%s output_tp=%s bytes=%d→%d (48kHz/320k)",
                track_id, job_id,
                stats.get("input_i", "?"), stats.get("input_tp", "?"),
                stats.get("output_i", "?"), stats.get("output_tp", "?"),
                len(audio_bytes), len(normalized),
            )
            return normalized
    except Exception as exc:
        logger.warning(
            "[inst] loudnorm skipped track=%s job=%s error=%s", track_id, job_id, str(exc)[:200],
        )
        return audio_bytes


def _strip_url_query(url: str) -> str:
    """presigned URL 의 서명 질의문자열 제거 — 저장/로그용 마스킹."""
    if not url:
        return url
    return url.split("?", 1)[0]


async def refund_instrumental_points(mongo_db, job_id: str) -> bool:
    """실패한 Inst. 생성의 선차감 ⭐를 정확히 1회 환불.

    generate.py `refund_generation_points` 패턴 복제 — inst_jobs doc 의
    `refunded` 플래그를 find_one_and_update 로 원자 클레임(absent/False → True)
    하므로 이중 환불이 구조적으로 불가능하다. 배경 루프에서 호출되므로 반드시
    루프-로컬 `mongo_db` 를 받아 refund_points 에도 그대로 주입. Never raises.
    """
    try:
        from .points_service import POINT_COSTS, refund_points

        claimed = await mongo_db.inst_jobs.find_one_and_update(
            {
                "_id": ObjectId(job_id),
                "point_ref": {"$ne": None},
                "refunded": {"$ne": True},
            },
            {"$set": {"refunded": True}},
        )
        if not claimed:
            return False
        user_id = claimed.get("user_id")
        point_ref = claimed.get("point_ref")
        cost = int(claimed.get("point_cost") or POINT_COSTS["instrumental"])
        if not user_id or not point_ref:
            return False
        await refund_points(user_id, "instrumental", cost, point_ref, db=mongo_db)
        logger.info(
            "[inst] [star-econ] refund track=%s job=%s user=%s amount=+%d",
            claimed.get("track_id"), job_id, user_id[:8], cost,
        )
        return True
    except Exception:
        logger.exception("[inst] [star-econ] refund failed job=%s", job_id)
        return False


async def _mark_job(mongo_db, job_id: str, fields: dict) -> None:
    fields = dict(fields)
    fields["updated_at"] = datetime.now(timezone.utc)
    await mongo_db.inst_jobs.update_one({"_id": ObjectId(job_id)}, {"$set": fields})


async def _run_pipeline(mongo_db, job_id: str, track_id: str) -> dict:
    """Inst. 생성 본 파이프라인 (루프-로컬 mongo_db 필수).

    반환: {"track_id": <신규 트랙 id str>, "inherited_beats": bool}
    실패는 ValueError(사용자 메시지) 로 raise — 래퍼가 failed 마킹+환불.
    """
    if not settings.suno_api_key:
        raise ValueError("SUNO_API_KEY가 설정되지 않았습니다.")

    src = await mongo_db.tracks.find_one({"_id": ObjectId(track_id)})
    if not src:
        raise ValueError("원곡을 찾을 수 없습니다.")
    audio_object = src.get("audio_url")
    if not audio_object:
        raise ValueError("원곡 오디오 파일이 없습니다.")

    # 1) 원곡 오디오의 자체 presigned URL (외부 접근 가능한 public 클라이언트 —
    #    reference 업로드곡 uploadUrl 전달과 동일 경로 generate.py:472 관행).
    presigned = public_presign(audio_object, bucket=settings.minio_bucket_music)
    if not presigned:
        raise ValueError("원곡 오디오 URL 발급에 실패했습니다.")
    # v3.214: 게이트웨이에는 짧은 리다이렉트 URL 전달(긴 presigned 거부 실증) —
    # 토큰·오디오 오브젝트를 job 에 저장하고 tracks.py 의 inst-audio 라우트가 302 한다.
    audio_token = secrets.token_urlsafe(24)
    await _mark_job(mongo_db, job_id, {"audio_token": audio_token, "audio_object": audio_object})
    presigned = f"{_PUBLIC_API_BASE}/api/tracks/inst-audio/{job_id}/{audio_token}"
    logger.info(
        "[inst] audio-url ready track=%s job=%s url=%s", track_id, job_id, presigned,
    )

    base_url = settings.suno_api_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }

    # 2) vocal-removal 생성 요청 — audioUrl 방식(separate_vocal).
    body = {
        "audioUrl": presigned,
        "type": "separate_vocal",
        "callBackUrl": "https://api.maidol.ai.kr/api/health",  # 필수 필드 — 폴링 방식이라 내용 미사용. localhost는 게이트웨이가 작업 등록 자체를 거부(v3.214 실사고)해 실도달 URL 사용.
    }
    requested_at = datetime.now(timezone.utc)
    # 창작 기록 관행(v3.200 F1) — 요청 전문·해시 캡처. presigned 서명 질의문자열은
    # 저장 전 마스킹(경로만 보존), 해시는 마스킹본 기준.
    try:
        from .creation_log import request_body_hash

        body_masked = dict(body, audioUrl=_strip_url_query(presigned))
        await _mark_job(mongo_db, job_id, {
            "suno_request_body": body_masked,
            "suno_request_body_hash": request_body_hash(body_masked),
            "requested_at": requested_at,
            "engine": "suno:vocal-removal",
        })
    except Exception as _cl_exc:
        logger.warning("[inst] request capture failed track=%s job=%s: %s", track_id, job_id, _cl_exc)

    logger.info("[inst] submit vocal-removal track=%s job=%s", track_id, job_id)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_url}/api/v1/vocal-removal/generate", headers=headers, json=body,
        )
        resp.raise_for_status()
        result = resp.json()
    if result.get("code") != 200:
        raise ValueError(f"Suno 보컬 분리 요청 오류: {result.get('msg', 'Unknown error')}")
    task_id = (result.get("data") or {}).get("taskId")
    if not task_id:
        raise ValueError("Suno 보컬 분리 taskId 를 받지 못했습니다.")
    logger.info("[inst] submitted track=%s job=%s taskId=%s", track_id, job_id, task_id)
    await _mark_job(mongo_db, job_id, {"suno_task_id": task_id})

    # 3) record-info 폴링 (기존 생성 폴링 관행 — 5s 간격, 매 30초 상태 로그).
    instrumental_url = None
    responded_at = None
    status_data = None
    flag = ""
    for poll_attempt in range(INST_MAX_POLLS):
        await asyncio.sleep(INST_POLL_INTERVAL_SEC)
        async with httpx.AsyncClient(timeout=30) as client:
            status_resp = await client.get(
                f"{base_url}/api/v1/vocal-removal/record-info",
                headers=headers,
                params={"taskId": task_id},
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()
        data_obj = status_data.get("data") or {}
        # 공식 문서 필드: successFlag (안전망으로 status 도 수용)
        flag = str(data_obj.get("successFlag") or data_obj.get("status") or "")
        err_msg = data_obj.get("errorMessage") or ""
        if poll_attempt % 6 == 0 or flag not in ("PENDING", ""):
            logger.info(
                "[inst] poll track=%s job=%s attempt=%d/%d flag=%s err=%s",
                track_id, job_id, poll_attempt, INST_MAX_POLLS, flag or "?", (err_msg or "")[:120],
            )
        if flag in INST_TERMINAL_ERROR_STATUSES or flag.endswith(("_FAILED", "_ERROR", "_EXCEPTION")):
            logger.warning(
                "[inst] terminal error track=%s job=%s flag=%s err=%s",
                track_id, job_id, flag, (err_msg or "")[:200],
            )
            raise ValueError(f"보컬 분리에 실패했습니다{': ' + err_msg if err_msg else ''}")
        if flag == "SUCCESS":
            responded_at = datetime.now(timezone.utc)
            response_obj = data_obj.get("response") or {}
            instrumental_url = response_obj.get("instrumentalUrl")
            break

    if not instrumental_url:
        raise ValueError(
            f"보컬 분리 시간이 초과되었습니다 (last_flag={flag or '?'}, "
            f"polls={INST_MAX_POLLS}, ~{INST_MAX_POLLS * INST_POLL_INTERVAL_SEC // 60}min)."
        )
    logger.info(
        "[inst] SUCCESS track=%s job=%s taskId=%s url=%s",
        track_id, job_id, task_id, _strip_url_query(instrumental_url),
    )
    # 창작 기록 관행 — 응답 전문(마지막 record-info)·응답 시각 보존 (URL 서명 마스킹).
    try:
        _resp_saved = dict(status_data or {})
        _d = dict(_resp_saved.get("data") or {})
        _r = dict(_d.get("response") or {})
        for _k in ("originUrl", "instrumentalUrl", "vocalUrl"):
            if _r.get(_k):
                _r[_k] = _strip_url_query(_r[_k])
        _d["response"] = _r
        _resp_saved["data"] = _d
        await _mark_job(mongo_db, job_id, {
            "suno_response": _resp_saved, "responded_at": responded_at,
        })
    except Exception as _cl_exc:
        logger.warning("[inst] response capture failed track=%s job=%s: %s", track_id, job_id, _cl_exc)

    # 4) instrumental 다운로드 → (v3.215 ③) 라우드니스 정규화 → MinIO 즉시 이관
    #    (Suno측 14일 만료 대비). 정규화는 best-effort — 실패 시 원본 그대로 저장.
    #    audio_sha256·duration 은 최종 저장본(정규화 성공 시 재인코딩본) 기준.
    async with httpx.AsyncClient(timeout=120) as client:
        audio_resp = await client.get(instrumental_url)
        audio_resp.raise_for_status()
        audio_bytes = audio_resp.content
    audio_bytes = await asyncio.to_thread(
        _normalize_inst_loudness, audio_bytes, track_id, job_id,
    )
    audio_sha256 = hashlib.sha256(audio_bytes).hexdigest()

    uploader_id = src["uploader_id"]
    new_track_id = ObjectId()
    dest_object_name = f"tracks/{uploader_id}/{str(new_track_id)}.mp3"
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=dest_object_name,
        data=io.BytesIO(audio_bytes),
        length=len(audio_bytes),
        content_type="audio/mpeg",
    )
    logger.info(
        "[inst] minio migrated track=%s job=%s dest=%s bytes=%d sha256=%s",
        track_id, job_id, dest_object_name, len(audio_bytes), audio_sha256[:12],
    )

    # 5) duration 추출 (upload-from-generation mutagen 관행 — best-effort).
    duration_sec = 0
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        from mutagen import File as MutagenFile

        audio = MutagenFile(tmp_path)
        if audio and audio.info:
            duration_sec = int(audio.info.length)
        os.unlink(tmp_path)
    except Exception:
        pass

    # 6) 신규 트랙 자동 발매 — 원곡 메타 상속 (PLAN 확정 스펙 ③).
    #    beats 는 동일 오디오 타임라인(보컬만 제거)이므로 원곡 completed 시 승계,
    #    아니면 pending (래퍼가 배경 추출 트리거 — v44 관행).
    now = datetime.now(timezone.utc)
    inherit_beats = bool(src.get("beats_status") == "completed" and src.get("beats"))
    if inherit_beats:
        beats_fields = {
            "beats_status": "completed",
            "tempo": src.get("tempo"),
            "beats": src.get("beats") or [],
            "downbeats": src.get("downbeats") or [],
            "beats_started_at": src.get("beats_started_at"),
            "beats_completed_at": src.get("beats_completed_at"),
            "beats_error": None,
        }
    else:
        beats_fields = {
            # v3.244 — 스위치 OFF 면 "skipped"
            "beats_status": "pending" if settings.beats_extraction_enabled else "skipped",
            "tempo": None,
            "beats": [],
            "downbeats": [],
            "beats_started_at": None,
            "beats_completed_at": None,
            "beats_error": None,
        }

    doc = {
        "_id": new_track_id,
        "title": f"{(src.get('title') or '').strip()} (Inst.)".strip(),
        "uploader_id": uploader_id,
        "uploader_nickname": src.get("uploader_nickname", ""),
        "ai_model": src.get("ai_model") or "suno",
        "prompt": None,
        "ai_model_version": None,
        "genre": src.get("genre") or [],
        "mood": src.get("mood") or [],
        "tags": src.get("tags") or [],
        "categories": src.get("categories") or [],
        "bpm": src.get("bpm"),
        "key": src.get("key"),
        "duration_sec": duration_sec or src.get("duration_sec") or 0,
        "language": None,
        "lyrics": None,  # 연주곡 — 가사 없음
        "audio_url": dest_object_name,
        "cover_image_url": src.get("cover_image_url"),  # 커버 원곡 상속
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": bool(src.get("is_public", True)),  # PLAN 기본안: 원곡과 동일
        "generation_id": None,
        "variant_index": None,
        "track_type": "standard",
        # 아티스트·캐릭터 표시 원곡 상속 (v214/v236 필드 관행)
        "user_character_snapshot": src.get("user_character_snapshot"),
        "artist_name": src.get("artist_name"),
        "character_id": src.get("character_id"),
        "persona_id": src.get("persona_id"),
        "persona_model": src.get("persona_model"),
        "lyrics_id": None,
        "source_meta": src.get("source_meta"),
        # v3.210 ③ — Inst. 파생 관계 기록 (이미-존재 검사·앱 표시 근거)
        "source_track_id": str(track_id),
        "inst_job_id": str(job_id),
        "audio_sha256": audio_sha256,
        "created_at": now,
        "updated_at": now,
        **beats_fields,
    }
    await mongo_db.tracks.insert_one(doc)
    logger.info(
        "[inst] published track=%s job=%s new_track=%s title=%s public=%s inherit_beats=%s",
        track_id, job_id, str(new_track_id), doc["title"], doc["is_public"], inherit_beats,
    )

    await _mark_job(mongo_db, job_id, {
        "status": "completed",
        "active": False,
        "result_track_id": str(new_track_id),
        "error_message": None,
    })

    # v3.215 ④ — Inst 완성 = 작곡 디렉터 사다리 1곡 카운트 (일반 곡 생성과 사다리 공유).
    # suno_generator.py:553 패턴 — 배경 루프이므로 루프-로컬 db 필수, best-effort
    # (on_generation_completed 는 절대 raise 하지 않지만 import 실패까지 방어).
    try:
        from .fatigue_service import on_generation_completed

        await on_generation_completed(uploader_id, db=mongo_db, director="composer")
    except Exception as _ft_exc:
        logger.warning(
            "[inst] fatigue hook failed track=%s job=%s: %s", track_id, job_id, _ft_exc,
        )

    return {"track_id": str(new_track_id), "inherited_beats": inherit_beats}


def run_instrumental_generation_in_background(job_id: str, track_id: str) -> None:
    """배경 스레드 진입점 — generate.py `_run_music_generation` 래퍼 관행.

    자체 이벤트 루프 + 루프-로컬 motor client 생성(메인 루프 클라이언트 접근 금지).
    실패 시: inst_jobs failed 마킹 + ⭐ 환불(원자 클레임) — 절대 raise 안 함.
    성공 시: beats 미승계면 배경 추출, 검색 인덱싱 훅 (모두 best-effort).
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    outcome = None
    try:
        import motor.motor_asyncio

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]

        loop.run_until_complete(_mark_job(mongo_db, job_id, {"status": "processing"}))
        try:
            outcome = loop.run_until_complete(_run_pipeline(mongo_db, job_id, track_id))
        except Exception as e:
            err_msg = str(e)[:500]
            logger.exception("[inst] failed track=%s job=%s: %s", track_id, job_id, err_msg)
            try:
                loop.run_until_complete(_mark_job(mongo_db, job_id, {
                    "status": "failed",
                    "active": False,
                    "error_message": err_msg,
                }))
            except Exception as _mark_exc:
                logger.warning("[inst] failed-mark error track=%s job=%s: %s", track_id, job_id, _mark_exc)
            # 실패·타임아웃 시 별 환불 + 상태 기록 (원자 클레임 — 정확히 1회)
            try:
                loop.run_until_complete(refund_instrumental_points(mongo_db, job_id))
            except Exception as _refund_exc:
                logger.exception("[inst] refund hook error job=%s: %s", job_id, _refund_exc)
    finally:
        loop.close()

    # 발매 후속 훅 — 각자 자체 루프를 만드는 sync 헬퍼라 루프 종료 후 호출.
    if outcome and outcome.get("track_id"):
        new_tid = outcome["track_id"]
        if not outcome.get("inherited_beats") and settings.beats_extraction_enabled:  # v3.244
            try:
                from .beat_extraction import run_track_beat_extraction_in_background

                run_track_beat_extraction_in_background(new_tid)
            except Exception as _bt_exc:
                logger.warning("[inst] beats hook failed new_track=%s: %s", new_tid, _bt_exc)
        try:
            from .embedding_service import enrich_and_index_track_in_background

            enrich_and_index_track_in_background(new_tid)
        except Exception as _ix_exc:
            logger.warning("[inst] index hook failed new_track=%s: %s", new_tid, _ix_exc)
