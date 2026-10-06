"""
AI Music Generation API
- POST /api/generate/lyrics   : Generate lyrics via ChatGPT
- POST /api/generate/         : Submit music generation request (saves + starts background generation)
- GET  /api/generate/         : List user's generation history
- GET  /api/generate/{id}     : Get single generation status/result
- DELETE /api/generate/{id}   : Delete generation record
"""
import asyncio
import hashlib
import io
import logging
import math
import mimetypes
import os
import secrets
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, Query, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services import gen_jobs as gj  # v3.228 — 요청 원장·중복 차단·멈춘 작업 환불
from ..services.media_urls import public_presign
from ..services.points_service import POINT_COSTS, refund_points, spend_points
from ..services import kids_policy  # v3.232 F5·F6·G4 — 어린이 제한(킬 스위치 OFF 면 no-op)
from ..services.word_filter import word_filter_response  # v3.232 G1

# v3.232 G4 — 어린이 작사 고정 지시문(어린이 요청에만 사용자 프롬프트 뒤에 덧붙인다. 성인 프롬프트 바이트 불변)
KIDS_LYRICS_GUARD = (
    "\n\n[어린이 사용자 안전 지시] 이 노래는 초등학생이 직접 부를 노래입니다. "
    "초등학생이 불러도 괜찮은 쉽고 밝은 표현만 사용하세요. "
    "폭력, 성적인 표현, 욕설·비속어, 음주·흡연·약물, 혐오 표현은 절대 쓰지 마세요."
)


def _kids_filter_on() -> bool:
    return kids_policy.kids_enabled() or bool(getattr(settings, "word_filter_all_users", False))


async def _kids_generation_gate(user_id, body):
    """v3.232 F5·F6+G1 — POST /generate/: 어린이는 내 목소리(voice_persona)·참고 음원(reference_audio_url) 작곡 불가,
    프롬프트·제목 금칙어. create_generation 의 gj.user_lock·⭐ 차감·원장 기록 **전**에 호출. OFF 면 DB 0회로 None."""
    if not _kids_filter_on():
        return None
    child = await kids_policy.is_child_user(user_id)
    if child:
        if (body.persona_model or "").strip().lower() == "voice_persona":
            return kids_policy.child_restricted("voice_clone", user_id)
        if (body.reference_audio_url or "").strip():
            return kids_policy.child_restricted("audio_upload", user_id)
    return await word_filter_response(user_id, [body.prompt, body.title], "generate", child=child)


async def _kids_start_gate(user_id, gen_id: str):
    """v3.232 F5·F6 — POST /generate/{id}/start/: 어린이 && 초안이 voice_persona·참고 음원이면 403.
    gj.user_lock·⭐ 차감 전. 킬 스위치 OFF 면 즉시 None(DB 0회), 어린이가 아니면 Mongo 조회 0."""
    if not kids_policy.kids_enabled():
        return None
    if not await kids_policy.is_child_user(user_id):
        return None
    if not ObjectId.is_valid(gen_id):
        return None  # 기존 400 경로에 맡긴다
    doc = await get_mongo().generations.find_one(
        {"_id": ObjectId(gen_id)}, {"user_id": 1, "persona_model": 1, "reference_audio_url": 1}
    )
    if not doc or doc.get("user_id") != user_id:
        return None  # 기존 404/403 경로에 맡긴다
    if (doc.get("persona_model") or "").strip().lower() == "voice_persona":
        return kids_policy.child_restricted("voice_clone", user_id)
    if (doc.get("reference_audio_url") or "").strip():
        return kids_policy.child_restricted("audio_upload", user_id)
    return None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate")

# v3.277 게스트 작곡 체험 상한(Redis 일일 카운터) — 전역 일일·IP 일일
GUEST_COMPOSE_DAILY_CAP = 50
GUEST_COMPOSE_IP_DAILY_CAP = 3
GUEST_COMPOSE_RETENTION_DAYS = 7  # v3.280(대표): 미가입 체험 곡 보관 기간 — 이후 조회·청취·가져오기 불가(410), 지연 정리


# ─── Request Models ─────────────────────────────────────────

class TranslateTagsRequest(BaseModel):
    tags: list[str]


class LyricsRequest(BaseModel):
    prompt: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    duration_minutes: Optional[int] = 2  # v229(B-12): 1~5 지원 (기존 1~3)
    duet: Optional[bool] = False
    duet_main_vocal_style: Optional[str] = None
    duet_sub_vocal_style: Optional[str] = None
    language: Optional[str] = "ko"
    models: Optional[List[str]] = None  # e.g. ["gpt-4o-mini", "claude-opus-4-6"]
    # ── v229 (B-12) 작사 구조화 필드 — FE buildLyricsRequest가 prompt 문장 대신 전송 ──
    structure: Optional[str] = None       # Suno 섹션 태그 시퀀스 (예: "[Intro] - [Verse 1] - ...")
    english_ratio: Optional[int] = None   # 0~100 — 중간값일 때만 혼합 지시 주입
    has_rap: Optional[bool] = None        # 랩 파트 1섹션 이상 포함
    # v243(대표) — 이야기 필드: 가사 자산에 함께 저장 → 발매 시 '이야기' 섹션 서버측 근거
    story_topic: Optional[str] = None
    story_keywords: Optional[str] = None
    story_perspective: Optional[str] = None
    story_reference: Optional[str] = None
    # v229 (B-2) — true면 생성 즉시 가사 자산으로 저장하고 lyrics_id 반환
    save: Optional[bool] = None


class LyricsSourceSnapshot(BaseModel):
    """v214 — 가사 출처 스냅샷 (Break 1 해법의 서버 반쪽).

    작사실 draft 는 작곡 시 삭제되므로(v209 리스트 오염 방지 설계 유지) FE 가
    삭제 직전 draftId·제목을 여기 동봉 → generation doc 에 동결 → 업로드 시
    tracks.py 가 lyrics_id / source_meta.lyrics_title 로 승계한다.
    """
    lyrics_id: Optional[str] = None   # 삭제될 draft 의 generation id (영수증 — 문서는 죽고 스냅샷은 산다)
    title: Optional[str] = None
    is_mine: Optional[bool] = True


class GenerateRequest(BaseModel):
    prompt: str
    title: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    vocal: Optional[str] = None
    duration: Optional[int] = None  # seconds; v3.203: 필드 생략=자동(연주곡이면 Suno duration 미전달)
    bpm: Optional[int] = None
    key: Optional[str] = None
    instruments: Optional[str] = None
    reference_style: Optional[str] = None
    lyrics: Optional[str] = None
    start_music_gen: Optional[bool] = False  # True to start music generation
    model: Optional[str] = "suno"  # AI 모델 ID (provider 식별자: 'suno' 등)
    suno_model: Optional[str] = None  # v76.10: Suno API 내부 모델 변형 ('V5', 'V5_5'). voice clone 은 V5_5 필요
    persona_id: Optional[str] = None  # Suno Voice Persona ID
    negative_tags: Optional[str] = None      # Styles to exclude
    style_weight: Optional[float] = None     # 0.0-1.0, style adherence
    weirdness: Optional[float] = None        # 0.0-1.0, creative deviation
    audio_weight: Optional[float] = None     # 0.0-1.0, reference audio influence
    persona_model: Optional[str] = None      # "style_persona" or "voice_persona"
    reference_audio_url: Optional[str] = None       # presigned URL for reference audio
    reference_audio_name: Optional[str] = None      # original filename
    reference_audio_duration: Optional[float] = None  # duration in seconds
    duet_main_vocal_style: Optional[str] = None     # 듀엣 주 보컬 느낌
    duet_sub_vocal_style: Optional[str] = None      # 듀엣 상대 보컬 느낌
    categories: Optional[List[str]] = None          # v77: 고정 10종 화이트리스트 카테고리
    # v209+: 솔로/듀엣 여부 — draft 저장 시 보존해 작곡실 인계 유실 방지 (PATCH duet 과 대칭).
    duet: Optional[bool] = None
    # v214 — 가사 출처 스냅샷 (optional). persona_id 는 현행 그대로(voice_id 의미
    # 유지 — clone_id 정규화는 업로드 시점 tracks.py 에서 수행).
    lyrics_source: Optional[LyricsSourceSnapshot] = None
    # v236 — 작곡 시 선택한 아티스트(characters.character_id). 발매 시 tracks 로 승계되어
    # 차트 아티스트명·착장 스냅샷의 근거가 된다 (미선택 작곡은 None — 기획사명 폴백).
    character_id: Optional[str] = None
    # v3.200 — 창작 기록 계층 (Phase 0). 없으면 서버가 세션 자동 생성(구버전 앱 하위호환).
    session_id: Optional[str] = None
    # v3.200 F5 — 이 생성 요청에 들어간 가사의 버전 ID (POST /sessions/{id}/lyrics 반환값)
    lyrics_version_id: Optional[str] = None


class UpdateGenerationRequest(BaseModel):
    """v209 — PATCH /api/generate/{gen_id} (draft 전용 수정) 화이트리스트.

    작사실 「내 작사 리스트」 수정용. draft 시그니처(pending && point_ref==None
    && result_audio_url==None)인 doc 만 수정 허용 — 완료곡/진행곡은 409.
    화이트리스트 외 필드는 Pydantic 기본(extra ignore)으로 조용히 무시된다.
    duration 은 generations doc 실측 필드명(초 단위) 그대로 사용.
    """
    title: Optional[str] = None
    lyrics: Optional[str] = None
    prompt: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    categories: Optional[List[str]] = None
    vocal: Optional[str] = None
    duration: Optional[int] = None
    # v209+: 솔로↔듀엣 전환 저장 (작사실 수정 비대칭 해소 — planner 승인).
    # 주의: GenerateRequest/create doc 에는 duet 필드가 없어(LyricsRequest 에만 존재)
    # 최초 draft 생성 시엔 미저장 — PATCH 로 설정되면 doc 에 키가 생긴다.
    duet: Optional[bool] = None
    duet_main_vocal_style: Optional[str] = None
    duet_sub_vocal_style: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────

def _normalize_lyrics_source(src) -> Optional[dict]:
    """v214 — lyrics_source 정규화 (캡: lyrics_id 64자·title 100자).

    id·title 둘 다 빈값이면 None (출처 없음 = 표기 생략 — 정직).
    """
    if not src:
        return None
    lyrics_id = (src.lyrics_id or "").strip()[:64]
    title = (src.title or "").strip()[:100]
    if not lyrics_id and not title:
        return None
    return {
        "lyrics_id": lyrics_id,
        "title": title,
        "is_mine": bool(True if src.is_mine is None else src.is_mine),
    }


def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    doc.pop("boot_id", None)  # v3.228 — 내부 판정용(응답 비노출)
    for key in ("created_at", "updated_at", "completed_at", "voice_conversion_completed_at",
                "started_at", "acked_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    doc["model"] = doc.get("model", "suno")
    return doc


async def _fatigue_gate_response(user_id: str, director: str = "composer"):
    """StarEcon(v158→v220) — 디렉터 피로 게이트. 활성 쿨다운이면 429 응답, 아니면 None.

    v220: 공용 구현은 routes/fatigue.py `fatigue_gate_response` 로 이동
    (upload/character 라우트와 공유) — 이 래퍼는 기존 compose 호출부 하위호환.
    응답: {"error":"director_fatigue","director":...} + Retry-After 헤더(남은 초).
    게이트 순서는 항상 스트라이크 403 → 피로 429 → 잔액 402.
    """
    from .fatigue import fatigue_gate_response

    return await fatigue_gate_response(user_id, director=director)


async def _voice_expired_response(user_id: str, persona_id):
    """v232 — 작곡 ⭐차감 전 클론 보이스 가용성 선체크 (Suno /voice/check-voice).

    배경: 제3자 Suno API의 클론 보이스는 예고 없이 만료될 수 있음(err 553 —
    2026-09-09 대표 실사고: 생성 2시간 만에 만료 → 곡 생성 실패). 생성 후 실패
    대신 시작 전에 차단해 대기·혼란을 없앤다.

    persona_id 가 본인 소유 클론이면 check-voice 확인 — 만료 시 클론 expired
    플래그 + 학습 ⭐ 1회 자동 환불 후 400 반환. 체크 자체가 실패(네트워크 등)하면
    통과시킨다(생성 루프의 만료 감지가 후방 방어). None=통과.
    """
    if not persona_id:
        return None
    from ..services import voice_clone_service as vcs

    mongo = get_mongo()
    doc = await mongo.voice_clones.find_one({
        "user_id": user_id,
        "$or": [{"voice_id": persona_id}, {"generate_task_id": persona_id}],
    })
    if not doc:
        return None  # 본인 클론 아님(외부/레거시 값) — 체크 대상 아님
    clone_id = str(doc["_id"])
    if doc.get("status") == "expired":
        # v240(대표 확정): 만료는 무환불 — 다시 학습(⭐5)하면 됨. 실패 시에만 환불.
        logger.warning(
            "[star-econ] voice pre-check: already expired user=%s clone=%s (무환불)",
            user_id[:8], clone_id,
        )
        return JSONResponse(
            status_code=400,
            content={"error": "선택한 목소리가 만료되었어요. 목소리를 다시 학습한 뒤 시도해주세요."},
        )
    # v3.263(대표 확정 2026-09-29): v242/v3.258 2시간 하드 타이머 **폐지** —
    # 실측 게이트웨이 수명 ≈ 16~40h. 만료 판정은 아래 check-voice 생존확인만.
    task_id = doc.get("generate_task_id") or persona_id
    try:
        available = await vcs.check_voice_available(task_id)
    except Exception as exc:
        logger.warning(
            "[star-econ] voice pre-check skipped (check error) user=%s clone=%s: %s",
            user_id[:8], clone_id, exc,
        )
        return None
    if available:
        return None
    await mongo.voice_clones.update_one(
        {"_id": doc["_id"], "status": {"$ne": "expired"}},
        {"$set": {
            "status": "expired",
            "expired_at": datetime.now(timezone.utc),
            "expired_reason": "pre-check: check-voice isAvailable=false",
        }},
    )
    logger.warning(
        "[star-econ] voice pre-check: expired -> block user=%s clone=%s (무환불 — 대표 확정)",
        user_id[:8], clone_id,
    )
    return JSONResponse(
        status_code=400,
        content={"error": "선택한 목소리가 만료되어 곡을 만들 수 없어요. 목소리를 다시 학습해주세요."},
    )


async def refund_generation_points(mongo_db, generation_id: str) -> bool:
    """실패한 작곡의 선차감 ⭐를 정확히 1회 환불 (StarEcon v158).

    character.py `refund_character_job_points` 패턴 복제 — generations doc 의
    `refunded` 플래그를 find_one_and_update 로 원자 클레임(absent/False → True)
    하므로 이중 환불이 구조적으로 불가능하다. `point_ref` 없는 doc(과금 전
    생성물)은 스킵. 배경 루프에서 호출되므로 반드시 루프-로컬 `mongo_db` 를
    받아 refund_points 에도 그대로 주입한다. Never raises.
    """
    try:
        claimed = await mongo_db.generations.find_one_and_update(
            {
                "_id": ObjectId(generation_id),
                "point_ref": {"$ne": None},
                "refunded": {"$ne": True},
            },
            {"$set": {"refunded": True}},
        )
        if not claimed:
            return False
        user_id = claimed.get("user_id")
        point_ref = claimed.get("point_ref")
        cost = int(claimed.get("point_cost") or POINT_COSTS["compose"])
        if not user_id or not point_ref:
            return False
        await refund_points(user_id, "compose", cost, point_ref, db=mongo_db)
        logger.info(
            "[star-econ] compose refund gen_id=%s user=%s amount=+%d",
            generation_id, user_id[:8], cost,
        )
        return True
    except Exception:
        logger.exception("[star-econ] compose refund failed gen_id=%s", generation_id)
        return False


# ─── Background task for music generation ────────────────────

def _run_music_generation(generation_id: str, lyrics: str, genre: str, mood: str, style: str, vocal: str, duration: int, model: str = "suno", title: str = None, prompt: str = None, persona_id: str = None, negative_tags: str = None, style_weight: float = None, weirdness: float = None, audio_weight: float = None, persona_model: str = None, bpm: int = None, key: str = None, reference_audio_url: str = None, duet_main_vocal_style: str = None, duet_sub_vocal_style: str = None, suno_model: str = None, session_id: str = None, lyrics_version_id: str = None):
    """Wrapper to run async music generation in background."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio

        # Create a new motor client for this event loop
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]

        if model != "suno":
            raise ValueError(f"Unsupported model: {model}. Only 'suno' is supported.")

        from ..services.suno_generator import generate_music_suno

        # v3.274 [45]: 전체 실행 상한 25분 — httpx per-op timeout 만으론 총 소요 무상한
        # (실측 09-30: progress 85 다운로드 구간 42분 멈춤). 초과 시 asyncio.TimeoutError 가
        # 아래 except 경로(실패 표시 + refund_generation_points)로 수렴해 30분 sweep 전에 확정.
        loop.run_until_complete(asyncio.wait_for(
            generate_music_suno(
                generation_id=generation_id,
                lyrics=lyrics,
                genre=genre,
                mood=mood,
                style=style,
                vocal=vocal,
                duration=duration,  # v3.203: 연주곡 duration 전달 (suno 측에서 instrumental+V6 한정 적용)
                title=title,
                prompt=prompt,
                mongo_db=mongo_db,
                persona_id=persona_id,
                negative_tags=negative_tags,
                style_weight=style_weight,
                weirdness=weirdness,
                audio_weight=audio_weight,
                persona_model=persona_model,
                bpm=bpm,
                key=key,
                reference_audio_url=reference_audio_url,
                duet_main_vocal_style=duet_main_vocal_style,
                duet_sub_vocal_style=duet_sub_vocal_style,
                suno_model=suno_model,
                session_id=session_id,                    # v3.200
                lyrics_version_id=lyrics_version_id,      # v3.200
            ),
            timeout=25 * 60,  # v3.274 [45]: 전체 실행 상한(초) — sweep hard_cap(30분)보다 먼저
        ))
    except Exception as e:
        err_msg = str(e)[:500]
        print(f"Music generation error for {generation_id}: {err_msg}")
        import traceback
        traceback.print_exc()
        # v76.11: doc.status='failed' + error_message 마킹 — frontend 가 "처리중 60%" 무한 표시 방지.
        try:
            from datetime import datetime, timezone as _tz
            loop.run_until_complete(
                mongo_db.generations.update_one(
                    {"_id": __import__("bson").ObjectId(generation_id)},
                    {"$set": {
                        "status": "failed",
                        "error_message": err_msg,
                        "updated_at": datetime.now(_tz.utc),
                    }},
                )
            )
            print(f"Music generation marked failed for {generation_id}")
        except Exception as _mark_exc:
            print(f"Music generation failed-mark error for {generation_id}: {_mark_exc}")
        # v3.200 F1 §3.3 — 실패·타임아웃도 GEN_RESPONSE status=failed 로 기록
        # ("실패도 사실이다"). creation_log 는 루프-로컬 직접 커넥션이라 이
        # 래퍼 루프에서 안전. best-effort — 실패 마킹/환불 흐름을 막지 않는다.
        if session_id:
            try:
                from ..services.creation_log import append_event as _cl_append
                loop.run_until_complete(_cl_append(
                    session_id, "GEN_RESPONSE", "server",
                    payload={
                        "request_id": generation_id,
                        "status": "failed",
                        "error": err_msg[:300],
                        "candidates": [],
                    },
                ))
            except Exception as _cl_exc:
                logger.warning(
                    "[creation-log] failed GEN_RESPONSE record error gen_id=%s: %s",
                    generation_id, _cl_exc,
                )
        # StarEcon(v158) — 실패한 작곡의 -15 선차감 자동 환불 (원자 클레임,
        # 정확히 1회). 이 래퍼는 자체 이벤트 루프 → 반드시 루프-로컬 mongo_db.
        try:
            loop.run_until_complete(refund_generation_points(mongo_db, generation_id))
        except Exception as _refund_exc:
            logger.exception(
                "[star-econ] compose refund hook error gen_id=%s: %s",
                generation_id, _refund_exc,
            )
    finally:
        loop.close()


ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
MAX_REFERENCE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_REFERENCE_DURATION = 480  # 8 minutes in seconds


# ─── Routes ─────────────────────────────────────────────────

@router.post("/upload-reference/")
async def upload_reference_audio(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload a reference audio file for Suno upload-cover generation."""
    # v3.232 F6 — 어린이 참고 음원 업로드 차단(파일 읽기·저장 전). OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "audio_upload")
    if _kids_block is not None:
        return _kids_block
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 오디오 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_REFERENCE_SIZE:
        return JSONResponse(
            status_code=400,
            content={"error": "파일 크기는 50MB 이하여야 합니다."},
        )

    # Extract audio duration using mutagen
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(io.BytesIO(contents))
        if audio is None or audio.info is None:
            return JSONResponse(
                status_code=400,
                content={"error": "오디오 파일을 읽을 수 없습니다."},
            )
        duration_sec = audio.info.length
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"error": f"오디오 파일 분석 실패: {str(e)[:200]}"},
        )

    if duration_sec > MAX_REFERENCE_DURATION:
        return JSONResponse(
            status_code=400,
            content={"error": f"오디오 길이는 최대 8분(480초)까지 허용됩니다. (현재: {duration_sec:.1f}초)"},
        )

    # Upload to MinIO
    minio_client = get_minio()
    content_type = mimetypes.guess_type(file.filename or "")[0] or "audio/mpeg"
    object_name = f"reference/{current_user['id']}/{uuid_lib.uuid4().hex}{ext}"

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # v173: 생성 API(외부 서버측 fetch)로 전달되는 URL — public presign (music 버킷, 24h)
    upload_url = public_presign(object_name, bucket=settings.minio_bucket_music)

    return {
        "upload_url": upload_url,
        "object_name": object_name,
        "filename": file.filename,
        "duration_sec": round(duration_sec, 2),
    }


@router.post("/translate-tags")
async def translate_tags(
    body: TranslateTagsRequest,
    current_user=Depends(get_current_user),
):
    """Translate music style tags to English using GPT."""
    if not body.tags:
        return {"translated": []}

    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)

        translated = []
        # v75 — flagship gpt-5 with reasoning enabled (replaces gpt-4o-mini).
        _tag_model = settings.openai_model or "gpt-5.5"
        logger.info(
            "[ReasoningOn] stage=translate_tags model=%s reasoning_effort=high tag_count=%d",
            _tag_model, len(body.tags),
        )
        for tag in body.tags:
            response = await client.chat.completions.create(
                model=_tag_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Extract music style tags from the input and translate each to English. Output comma-separated tags only. No explanations, no quotes, no numbering.",
                    },
                    {"role": "user", "content": tag},
                ],
                # v75 — gpt-5: temperature default(1) 만 허용 → 제거. max_tokens → max_completion_tokens.
                # v75.2 — reasoning 토큰까지 한도에서 차감되므로 8000 으로 상향.
                max_completion_tokens=8000,
                reasoning_effort="high",
            )
            result = response.choices[0].message.content.strip()
            parts = [p.strip() for p in result.split(",") if p.strip()]
            translated.extend(parts)

        return {"translated": translated}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"태그 번역 실패: {str(e)[:200]}"},
        )


# ─── v3.228 생성 작업 회수·조회·확인 API (gen_jobs) ─────────────────────────
# main.py 비접촉 — 기존 /api/generate 라우터에 등록. 2~4 세그먼트 고정 경로라 아래
# `/{gen_id}` 계열과 충돌하지 않지만, 안전하게 그보다 **앞에** 정의한다.


@router.get("/jobs/recoverable")
async def list_recoverable_gen_jobs(
    kinds: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
):
    """v3.228 — 응답을 잃었을 수 있는 내 생성 작업(작사·작곡·연주곡·커버·다듬기·영상).

    Response: {"jobs":[Job], "count":n, "swept":k}. Job = {job_id, request_id, kind, status
    (processing|done|failed), created_at(ISO Z), elapsed_sec, meta, result|null, error|null,
    refunded, acked}. 호출 시 이 사용자의 죽은 작업은 즉시 실패+1회 환불(swept).
    """
    return await gj.recoverable(current_user["id"], gj.parse_kinds(kinds))


@router.get("/jobs/req/{request_id}")
async def get_gen_job_by_request(
    request_id: str,
    current_user=Depends(get_current_user),
):
    """v3.228 — X-Gen-Request-Id 로 내 작업 1건 정확 회수(없으면 404 — 요청이 서버에 닿지 않음)."""
    job = await gj.get_by_request(current_user["id"], request_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다.", "code": "job_not_found"})
    return job


@router.post("/jobs/{kind}/{job_id}/ack")
async def ack_gen_job(
    kind: str,
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v3.228 — 결과 확인(소비) 영속 표시. 이후 회수 목록에 다시 나타나지 않는다. 환불 없음.

    200 {job_id, kind, acked:true, already} · 404(없음·타인·형식) · 409 {code:"job_processing"}.
    """
    status, body = await gj.ack(current_user["id"], (kind or "").strip().lower(), job_id)
    if status != 200:
        return JSONResponse(status_code=status, content=body)
    return body


async def _compose_guard(user_id: str, request_id: Optional[str], gen_id: Optional[str] = None):
    """v3.228 작곡 진행 중 게이트(사용자당 1곡 — 사용자 결정 4). **사용자 락 안에서** 호출.

    피로 429 뒤·차감 402 앞. 초안(point_ref=None)은 조회 조건에서 원천 제외된다.
    반환: 조기 응답(JSONResponse|dict) 또는 None.
    """
    mongo = get_mongo()
    await gj.sweep_user(user_id, groups=["music"])
    if request_id and gen_id is None:
        prev = await mongo.generations.find_one(
            {"user_id": user_id, "client_request_id": request_id, "point_ref": {"$ne": None}},
        )
        if prev:
            prev = await gj.sweep_doc("music", prev)
            if prev.get("status") in ("pending", "processing"):
                gj.logger.info("[ComposeGuard] dup-blocked user=%s active=%s req=%s (same request)",
                               gj.u8(user_id), str(prev["_id"]), gj.r8(request_id))
                return gj.busy_response("music", prev["_id"], request_id,
                                        prev.get("started_at") or prev.get("created_at"),
                                        {"generation_id": str(prev["_id"]), "title": prev.get("title")})
            gj.logger.info("[ComposeGuard] replay user=%s gen=%s req=%s status=%s",
                           gj.u8(user_id), str(prev["_id"]), gj.r8(request_id), prev.get("status"))
            out = _serialize(prev)
            out["replayed"] = True
            return JSONResponse(status_code=201, content=gj._jsonable(out, 1024 * 1024) or {"replayed": True})
    async for d in mongo.generations.find({
        "user_id": user_id, "status": {"$in": ["pending", "processing"]},
        "point_ref": {"$ne": None}, "refunded": {"$ne": True},
    }).sort("created_at", -1):
        if gj.dead_reason(d, "generations"):
            continue  # sweep 실패 잔재 — 막지 않는다
        gj.logger.info("[ComposeGuard] dup-blocked user=%s active=%s req=%s target=%s",
                       gj.u8(user_id), str(d["_id"]), gj.r8(request_id), gen_id or "(create)")
        return gj.busy_response("music", d["_id"], d.get("client_request_id"),
                                d.get("started_at") or d.get("created_at"),
                                {"generation_id": str(d["_id"]), "title": d.get("title")})
    return None


@router.post("/lyrics/")
async def generate_lyrics_endpoint(
    body: LyricsRequest,
    current_user=Depends(get_current_user),
    x_gen_request_id: Optional[str] = Header(None),
):
    """Generate lyrics using ChatGPT API.

    v3.228: 헤더 X-Gen-Request-Id(32hex, 선택) — 요청 원장(gen_jobs kind=lyrics).
    같은 id 재전송: 진행 중 409 · 완료 200 재생(replayed, 무과금) · 실패 409 request_already_failed.
    사용자당 진행 중 작사 1건(과금 전 409 generation_in_progress). 응답에 gen_job_id·request_id 가산.
    """
    if not body.prompt.strip():
        return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})

    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # v220 — 작사 디렉터 피로 게이트 (⭐5 차감 **전** — 429 무과금).
    user_id = current_user["id"]

    # v3.232 G1·G4 — 어린이: 프롬프트·이야기 필드 금칙어(피로 게이트·원장·⭐ 차감 전) + 작사 안전 지시문.
    # 성인은 _kids_lyrics_child=False → 프롬프트 바이트 불변. 킬 스위치·전체 적용 OFF 면 DB 0회.
    _kids_lyrics_child = False
    if _kids_filter_on():
        _kids_lyrics_child = await kids_policy.is_child_user(user_id)
        _wf = await word_filter_response(
            user_id,
            [body.prompt, body.story_topic, body.story_keywords, body.story_perspective, body.story_reference],
            "lyrics", child=_kids_lyrics_child,
        )
        if _wf is not None:
            return _wf

    fatigued = await _fatigue_gate_response(user_id, director="lyricist")
    if fatigued:
        return fatigued

    # StarEcon(v158) — 작사 ⭐-5 선차감 (부족 402, 실패 시 환불).
    lyrics_cost = POINT_COSTS["lyrics"]
    point_ref = uuid_lib.uuid4().hex

    # v3.228 — 요청 원장 + 진행 중 409(과금 전). 순서: 피로 429(위) → 409 → 잔액 402.
    request_id = gj.normalize_request_id(x_gen_request_id)
    early, job = await gj.gate_and_begin(
        user_id, "lyrics", request_id,
        meta={"save": bool(body.save), "genre": body.genre, "mood": body.mood,
              "duration_minutes": body.duration_minutes, "duet": bool(body.duet)},
        point_ref=point_ref, point_cost=lyrics_cost,
    )
    if early is not None:
        gj.logger.info("[LyricsJob] early status=%s user=%s req=%s",
                       getattr(early, "status_code", "?"), gj.u8(user_id), gj.r8(request_id))
        return early

    if not await spend_points(user_id, "lyrics", lyrics_cost, point_ref):
        logger.info("[star-econ] lyrics denied (insufficient) user=%s", user_id[:8])
        await gj.discard(job)
        return JSONResponse(
            status_code=402,
            content={"error": "포인트가 부족합니다 (필요: {})".format(lyrics_cost)},
        )
    await gj.mark_charged(job)
    logger.info("[star-econ] lyrics spend user=%s -%d ref=%s", user_id[:8], lyrics_cost, point_ref)
    if job:
        gj.logger.info("[LyricsJob] start user=%s job=%s req=%s", gj.u8(user_id), str(job["_id"]),
                       gj.r8(request_id))

    try:
        from ..services.lyrics_generator import generate_lyrics

        _lyrics_prompt = body.prompt.strip()
        if _kids_lyrics_child:
            _lyrics_prompt = _lyrics_prompt + KIDS_LYRICS_GUARD
            logger.info("[kids.lyrics] child guard appended user=%s", user_id[:8])
        result = await generate_lyrics(
            prompt=_lyrics_prompt,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            duration_minutes=body.duration_minutes,
            duet=body.duet or False,
            duet_main_vocal_style=body.duet_main_vocal_style,
            duet_sub_vocal_style=body.duet_sub_vocal_style,
            language=body.language or "ko",
            models=body.models,
            # v229 (B-12) — 구조화 필드 관통
            structure=(body.structure or "").strip() or None,
            english_ratio=body.english_ratio,
            has_rap=body.has_rap,
        )
        # v220 — 작사 완성 훅: lyricist 카운트 +1 + 사다리 쿨다운 시작 (best-effort)
        from ..services.fatigue_service import on_generation_completed
        await on_generation_completed(user_id, director="lyricist")
        # v229 (B-2) — save 옵션: 생성 즉시 가사 자산 저장 (best-effort, 실패해도 응답 유지)
        if body.save and isinstance(result, dict) and result.get("lyrics"):
            from .lyrics_assets import save_lyrics_asset
            _story = {k: (getattr(body, f"story_{k}") or "").strip()[:200] or None
                      for k in ("topic", "keywords", "perspective", "reference")}
            _story = {k: v for k, v in _story.items() if v}
            saved_id = await save_lyrics_asset(
                user_id,
                title=result.get("title") or "",
                content=result.get("lyrics") or "",
                genre=body.genre, mood=body.mood, source="ai",
                story=_story or None,  # v243 — 이야기 필드 영속
                categories=result.get("categories"),  # v3.264 — 발매 categories 폴백 1순위
            )
            if saved_id:
                result["lyrics_id"] = saved_id
        if job and isinstance(result, dict):
            result["gen_job_id"] = str(job["_id"])
            result["request_id"] = request_id
            await gj.finish(
                job,
                result={"lyrics_id": result.get("lyrics_id"), "title": result.get("title"),
                        "lyrics": (result.get("lyrics") or "")[:20000]},
                response=result,
            )
            gj.logger.info("[LyricsJob] done user=%s job=%s lyrics_id=%s", gj.u8(user_id),
                           str(job["_id"]), result.get("lyrics_id") or "-")
        elif job:
            await gj.finish(job, result={}, response=None)
        return result
    except Exception as e:
        logger.exception("[star-econ] lyrics failed user=%s ref=%s (refunding)", user_id[:8], point_ref)
        _err = {"error": f"가사 생성 실패: {str(e)[:200]}"}
        if job:
            # v3.228 — 원장 경유 1회 환불(원자 claim — sweep 과 경합해도 중복 없음)
            _refunded = await gj.fail(job, "lyrics_failed: {}".format(type(e).__name__), refund=True)
            gj.logger.info("[LyricsJob] failed user=%s job=%s refunded=%s", gj.u8(user_id),
                           str(job["_id"]), _refunded)
            _err.update({"gen_job_id": str(job["_id"]), "request_id": request_id})
        else:
            await refund_points(user_id, "lyrics", lyrics_cost, point_ref)
        return JSONResponse(
            status_code=500,
            content=_err,
        )


# ─── v3.276 게스트 작사 체험 ─────────────────────────────────────────
# 비로그인 기기당 평생 1회 무료 작사(가사 결과까지). 과금·원장·피로·자산 저장 전부 생략.
# 기존 /lyrics/ 엔드포인트는 변경 없음 — generate_lyrics(...) 서비스 호출만 재사용한다.
# 제한(Redis): guest:lyrics:{device_id} SET NX(TTL 없음 = 평생 1회) · guest:lyrics:daily:{YYYYMMDD}(KST) INCR ≤ 300.
# 생성 실패(500)면 기기 키·일일 카운트를 되돌려 재시도 가능(사용자 귀책 아님).
import re as _guest_re

GUEST_LYRICS_DAILY_CAP = 300
GUEST_LYRICS_PROMPT_MAX = 4000  # 비용 보호 — 정상 앱 요청(buildLyricsRequest)은 수백 자
_GUEST_DEVICE_RE = _guest_re.compile(r"^[A-Za-z0-9-]{8,64}$")
_KST = timezone(timedelta(hours=9))


def _guest_denied(status: int, error: str, device_tag: str, reason: str, message: Optional[str] = None):
    logger.info("[GuestLyrics] denied device=%s reason=%s", device_tag, reason)
    body = {"error": error}
    if message:
        body["message"] = message
    return JSONResponse(status_code=status, content=body)


@router.post("/lyrics/guest")
@router.post("/lyrics/guest/", include_in_schema=False)
async def generate_lyrics_guest_endpoint(
    body: LyricsRequest,
    x_guest_device_id: Optional[str] = Header(None),
):
    """v3.276 게스트 작사 체험(인증 없음).

    헤더 X-Guest-Device-Id(필수, 8~64자 영숫자/하이픈 — 앱 analytics device_id 재사용).
    400 guest_device_required · 400 프롬프트 · 400 word_filtered · 429 guest_trial_used · 429 guest_daily_cap
    · 503 guest_unavailable(Redis 없음 — 비용 보호 fail-closed) · 500 {"error": ...}.
    성공 응답 = 기존 /lyrics/ 성공 형태(title, lyrics, categories, model …) + guest:true. lyrics_id 없음(저장 안 함).
    """
    device_id = (x_guest_device_id or "").strip()
    if not _GUEST_DEVICE_RE.match(device_id):
        return _guest_denied(400, "guest_device_required", (device_id[:8] or "-") + "…", "bad_device_id",
                             "기기 식별값이 필요해요. 앱을 다시 열어 주세요.")
    device_tag = device_id[:8] + "…"

    if not (body.prompt or "").strip():
        return _guest_denied(400, "프롬프트를 입력해주세요.", device_tag, "empty_prompt")
    if len(body.prompt) > GUEST_LYRICS_PROMPT_MAX:
        return _guest_denied(400, "요청 내용이 너무 길어요.", device_tag, "prompt_too_long")

    if not settings.openai_api_key:
        return JSONResponse(status_code=503, content={"error": "OpenAI API 키가 설정되지 않았습니다."})

    # 금칙어 — 성인 기준(child=False 명시: is_child_user DB 조회 없음, user_id 는 로그 앞 8자에만 쓰임).
    # 전체 적용 스위치(WORD_FILTER_ALL_USERS) OFF 면 word_filter_response 가 즉시 None(기존 성인 경로와 동일).
    _wf = await word_filter_response(
        "guest:" + device_id,
        [body.prompt, body.story_topic, body.story_keywords, body.story_perspective, body.story_reference],
        "lyrics", child=False,
    )
    if _wf is not None:
        logger.info("[GuestLyrics] denied device=%s reason=word_filtered", device_tag)
        return _wf

    from ..database.redis import get_redis
    redis = get_redis()
    if redis is None:
        logger.error("[GuestLyrics] denied device=%s reason=redis_unavailable", device_tag)
        return JSONResponse(status_code=503, content={"error": "guest_unavailable",
                                                      "message": "지금은 체험을 이용할 수 없어요. 잠시 후 다시 시도해 주세요."})

    device_key = f"guest:lyrics:{device_id}"
    daily_key = "guest:lyrics:daily:" + datetime.now(_KST).strftime("%Y%m%d")
    try:
        claimed = await redis.set(device_key, datetime.now(timezone.utc).isoformat(), nx=True)
        if not claimed:
            return _guest_denied(429, "guest_trial_used", device_tag, "trial_used",
                                 "체험은 1회예요. 가입하면 계속 만들 수 있어요.")
        daily = await redis.incr(daily_key)
        if daily == 1:
            await redis.expire(daily_key, 3 * 24 * 3600)  # 집계 키 정리용(제한 자체는 날짜 키로 결정)
        if daily > GUEST_LYRICS_DAILY_CAP:
            await redis.delete(device_key)  # 기기 체험권은 소모하지 않음 — 다음 날 다시 가능
            await redis.decr(daily_key)
            return _guest_denied(429, "guest_daily_cap", device_tag, f"daily_cap({GUEST_LYRICS_DAILY_CAP})",
                                 "오늘 체험이 마감됐어요. 가입하면 바로 만들 수 있어요.")
    except Exception as e:
        logger.error("[GuestLyrics] denied device=%s reason=redis_error %s", device_tag, type(e).__name__)
        return JSONResponse(status_code=503, content={"error": "guest_unavailable",
                                                      "message": "지금은 체험을 이용할 수 없어요. 잠시 후 다시 시도해 주세요."})

    logger.info("[GuestLyrics] start device=%s genre=%s mood=%s daily=%s",
                device_tag, body.genre, body.mood, daily)
    try:
        from ..services.lyrics_generator import generate_lyrics

        result = await generate_lyrics(
            prompt=body.prompt.strip(),
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            duration_minutes=body.duration_minutes,
            duet=body.duet or False,
            duet_main_vocal_style=body.duet_main_vocal_style,
            duet_sub_vocal_style=body.duet_sub_vocal_style,
            language=body.language or "ko",
            models=None,  # 게스트는 기본 모델 고정(복수 모델 비교·고비용 모델 요청 무시)
            structure=(body.structure or "").strip() or None,
            english_ratio=body.english_ratio,
            has_rap=body.has_rap,
        )
        if isinstance(result, dict):
            result["guest"] = True
        logger.info("[GuestLyrics] done device=%s title_len=%d lyrics_len=%d", device_tag,
                    len((result or {}).get("title") or "") if isinstance(result, dict) else 0,
                    len((result or {}).get("lyrics") or "") if isinstance(result, dict) else 0)
        return result
    except Exception as e:
        logger.exception("[GuestLyrics] failed device=%s (trial released)", device_tag)
        try:
            await redis.delete(device_key)
            await redis.decr(daily_key)
        except Exception as re_err:
            logger.warning("[GuestLyrics] release failed device=%s: %s", device_tag, type(re_err).__name__)
        return JSONResponse(status_code=500, content={"error": f"가사 생성 실패: {str(e)[:200]}"})


# ─── v3.277 게스트 작곡 체험 ─────────────────────────────────────────
# 비로그인 기기당 평생 1회 무료 작곡(A/B 2버전 청취까지). 과금·원장(gj)·피로 게이트·창작 세션 훅 전부 생략.
# 발매·저장·커버는 로그인 후 claim(소유권 이전) → 기존 인증 엔드포인트 그대로 사용.
# 기존 엔드포인트는 변경 없음 — _run_music_generation·_serialize·stream_generation 재사용(순수 추가).
# 제한(Redis): guest:compose:{device} SET NX(TTL 없음 = 평생 1회) · guest:compose:daily:{YYYYMMDD KST} ≤ 50
#             · guest:compose:ip:{ip}:{YYYYMMDD KST} ≤ 3. 캡 거절이면 기기 체험권은 되돌린다(미소모).
# 생성 실패(status=failed)는 GET 상태 조회 시 1회 기기 체험권 반환(guest_ticket_returned 표식) — 실패 처리부 무변경.
# GUEST_COMPOSE_DAILY_CAP / GUEST_COMPOSE_IP_DAILY_CAP — 파일 상단(router 정의 아래) 상수
GUEST_COMPOSE_LYRICS_MAX = 3000
GUEST_COMPOSE_FAILED_MSG = "체험 곡을 만들지 못했어요. 체험권은 그대로 남아 있어요 — 다시 시도해 주세요."
_GUEST_COMPOSE_UNAVAILABLE = {"error": "guest_unavailable",
                              "message": "지금은 체험을 이용할 수 없어요. 잠시 후 다시 시도해 주세요."}


class GuestComposeRequest(BaseModel):
    """게스트 작곡 바디 — 허용 필드만 선언. 목소리 클론(persona_*)·참고 음원(reference_audio_*)·
    session/lyrics_version·suno_model·character_id 등은 선언하지 않아 Pydantic 기본(extra ignore)으로 무시된다."""
    lyrics: str
    title: Optional[str] = None
    prompt: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    vocal: Optional[str] = None
    duration: Optional[int] = None
    instrumental: Optional[bool] = None
    bpm: Optional[int] = None
    key: Optional[str] = None
    negative_tags: Optional[str] = None
    style_weight: Optional[float] = None
    weirdness: Optional[float] = None
    duet: Optional[bool] = None
    duet_main_vocal_style: Optional[str] = None
    duet_sub_vocal_style: Optional[str] = None


def _gc_cap(v, n: int) -> Optional[str]:
    s = (v or "").strip() if isinstance(v, str) else ""
    return s[:n] or None


def _gc_unit(v) -> Optional[float]:
    try:
        return None if v is None else max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return None


def _gc_client_ip(request: Request) -> str:
    # nginx 가 `X-Real-IP $remote_addr` 를 넣는다(위조 불가). X-Forwarded-For 는 클라이언트가 보낸 값 뒤에
    # 덧붙이는 구성($proxy_add_x_forwarded_for)이라 첫 홉을 믿으면 IP 상한이 위조로 우회된다 → Real-IP 우선.
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real[:64]
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[-1].strip()
    if xff:
        return xff[:64]
    return ((request.client.host if request.client else "") or "unknown")[:64]


def _gc_ip_tag(ip: str) -> str:
    # 로그용 — IPv4 는 앞 2옥텟만, 그 외는 앞 8자
    parts = ip.split(".")
    return ".".join(parts[:2]) + ".*.*" if len(parts) == 4 else ip[:8] + "…"


def _gc_device(raw) -> Optional[str]:
    d = (raw or "").strip()
    return d if _GUEST_DEVICE_RE.match(d) else None


def _gc_denied(status: int, error: str, device_tag: str, reason: str, message: Optional[str] = None):
    logger.info("[GuestCompose] denied device=%s reason=%s", device_tag, reason)
    body = {"error": error}
    if message:
        body["message"] = message
    return JSONResponse(status_code=status, content=body)


_GC_NOT_FOUND = {"error": "생성 요청을 찾을 수 없습니다."}


async def _gc_load(gen_id: str, device: Optional[str]):
    """device 가 문서 guest_device 와 일치할 때만 문서 반환(불일치·무효 id·없음은 모두 None → 404)."""
    if not device or not ObjectId.is_valid(gen_id):
        return None
    doc = await get_mongo().generations.find_one({"_id": ObjectId(gen_id)})
    if not doc or doc.get("guest_device") != device:
        return None
    return doc


def _gc_expires_at(doc: dict) -> Optional[datetime]:
    """미가입(guest=True) 체험 곡의 만료 시각 — created_at + 7일. 가져간(claim) 곡은 만료 없음(None)."""
    if not doc.get("guest"):
        return None
    created = doc.get("created_at")
    if not isinstance(created, datetime):
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created + timedelta(days=GUEST_COMPOSE_RETENTION_DAYS)


def _gc_expired(doc: dict) -> bool:
    exp = _gc_expires_at(doc)
    return bool(exp and datetime.now(timezone.utc) > exp)


_GC_EXPIRED = {"error": "guest_compose_expired", "message": "체험 곡 보관 기간(7일)이 지났어요."}


async def _gc_cleanup_expired(limit: int = 10) -> None:
    """v3.280 — 만료 체험 곡 지연 정리(게스트 생성 요청 때 소량씩). 음원 객체 best-effort 삭제 후 문서 삭제.
    미가입 문서(guest=True)만 대상 — 가져간 곡은 절대 건드리지 않는다. Never raises."""
    try:
        mongo = get_mongo()
        cutoff = datetime.now(timezone.utc) - timedelta(days=GUEST_COMPOSE_RETENTION_DAYS)
        docs = await mongo.generations.find(
            {"guest": True, "created_at": {"$lt": cutoff}}, {"variants": 1, "audio_url": 1}
        ).limit(limit).to_list(length=limit)
        for d in docs:
            keys = [v.get("audio_url") for v in (d.get("variants") or []) if isinstance(v, dict)]
            keys.append(d.get("audio_url"))
            for k in {k for k in keys if isinstance(k, str) and k and not k.startswith("http")}:
                try:
                    await asyncio.to_thread(get_minio().remove_object, settings.minio_bucket_music, k)
                except Exception:
                    pass
            await mongo.generations.delete_one({"_id": d["_id"], "guest": True})
        if docs:
            logger.info("[GuestCompose] expired cleanup removed=%d", len(docs))
    except Exception:
        logger.exception("[GuestCompose] expired cleanup failed")


async def _gc_settle(doc: dict) -> dict:
    """게스트 문서 정리 — gj.sweep_doc 은 point_ref 없는 문서를 건너뛰므로(과금 문서 전용) 자체 처리.
    ① 진행 중인데 죽은 작업(재시작 boot_id 불일치 · 시작 후 30분 초과 — gj.dead_reason 동일 규칙)이면 failed 표기.
    ② failed 이고 아직 미반환이면 기기 체험권 1회 반환(guest:compose:{device} DEL + guest_ticket_returned)."""
    mongo = get_mongo()
    if not doc.get("guest"):
        return doc
    if doc.get("status") in ("pending", "processing"):
        reason = gj.dead_reason(doc, "generations")
        if reason:
            swept = await mongo.generations.find_one_and_update(
                {"_id": doc["_id"], "guest": True, "status": {"$in": ["pending", "processing"]}},
                {"$set": {"status": "failed", "error_message": GUEST_COMPOSE_FAILED_MSG,
                          "swept_reason": reason, "updated_at": datetime.now(timezone.utc)}},
            )
            if swept:
                logger.info("[GuestCompose] swept gen=%s reason=%s", str(doc["_id"]), reason)
            doc = await mongo.generations.find_one({"_id": doc["_id"]}) or doc
    if doc.get("status") == "failed" and not doc.get("guest_ticket_returned"):
        claimed = await mongo.generations.find_one_and_update(
            {"_id": doc["_id"], "guest": True, "guest_ticket_returned": {"$ne": True}},
            {"$set": {"guest_ticket_returned": True, "updated_at": datetime.now(timezone.utc)}},
        )
        if claimed:
            device = doc.get("guest_device") or ""
            returned = False
            try:
                from ..database.redis import get_redis
                redis = get_redis()
                if redis is not None and device:
                    await redis.delete(f"guest:compose:{device}")
                    returned = True
            except Exception as e:  # noqa: BLE001
                logger.warning("[GuestCompose] ticket return failed gen=%s: %s", str(doc["_id"]), type(e).__name__)
            logger.info("[GuestCompose] failed gen=%s device=%s ticket_returned=%s",
                        str(doc["_id"]), device[:8] + "…", returned)
            doc["guest_ticket_returned"] = True
    return doc


@router.post("/guest-compose", status_code=201)
@router.post("/guest-compose/", status_code=201, include_in_schema=False)
async def create_guest_compose(
    body: GuestComposeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    x_guest_device_id: Optional[str] = Header(None),
):
    """v3.277 게스트 작곡 체험(인증 없음) — 실제 곡 생성(A/B 2클립).

    헤더 X-Guest-Device-Id(필수, 8~64자 영숫자/하이픈). 400 guest_device_required · 400 가사 · 400 word_filtered
    · 429 guest_trial_used / guest_daily_cap / guest_ip_cap · 503 guest_unavailable(Redis 없음 — fail-closed)
    · 500 {"error"}. 성공 201 {id, status, guest:true}. 상태는 GET /guest-compose/{id}(같은 헤더)로 폴링.
    """
    background_tasks.add_task(_gc_cleanup_expired)  # v3.280: 만료(7일) 체험 곡 지연 정리 — 응답과 무관
    device_id = _gc_device(x_guest_device_id)
    if not device_id:
        return _gc_denied(400, "guest_device_required", ((x_guest_device_id or "")[:8] or "-") + "…",
                          "bad_device_id", "기기 식별값이 필요해요. 앱을 다시 열어 주세요.")
    device_tag = device_id[:8] + "…"

    lyrics = (body.lyrics or "").strip()
    if not lyrics:
        return _gc_denied(400, "가사를 입력해주세요.", device_tag, "empty_lyrics")
    if len(lyrics) > GUEST_COMPOSE_LYRICS_MAX:
        return _gc_denied(400, "가사가 너무 길어요.", device_tag, "lyrics_too_long")

    title = _gc_cap(body.title, 100)
    style = _gc_cap(body.style, 500)
    # 금칙어 — 성인 기준(child=False: is_child_user DB 조회 없음). 스위치 OFF 면 즉시 None(기존 성인 경로 동일)
    _wf = await word_filter_response("guest:" + device_id, [title, lyrics, style], "generate", child=False)
    if _wf is not None:
        logger.info("[GuestCompose] denied device=%s reason=word_filtered", device_tag)
        return _wf

    from ..database.redis import get_redis
    redis = get_redis()
    if redis is None:
        logger.error("[GuestCompose] denied device=%s reason=redis_unavailable", device_tag)
        return JSONResponse(status_code=503, content=_GUEST_COMPOSE_UNAVAILABLE)

    ip = _gc_client_ip(request)
    ip_tag = _gc_ip_tag(ip)
    day = datetime.now(_KST).strftime("%Y%m%d")
    device_key = f"guest:compose:{device_id}"
    daily_key = f"guest:compose:daily:{day}"
    ip_key = f"guest:compose:ip:{ip}:{day}"
    got_device = got_daily = got_ip = False

    async def _release(device=True, daily=True, ipc=True):
        try:
            if device and got_device:
                await redis.delete(device_key)
            if daily and got_daily:
                await redis.decr(daily_key)
            if ipc and got_ip:
                await redis.decr(ip_key)
        except Exception as re_err:  # noqa: BLE001
            logger.warning("[GuestCompose] release failed device=%s: %s", device_tag, type(re_err).__name__)

    try:
        if not await redis.set(device_key, datetime.now(timezone.utc).isoformat(), nx=True):
            return _gc_denied(429, "guest_trial_used", device_tag, "trial_used",
                              "작곡 체험은 1회예요. 가입하면 계속 만들 수 있어요.")
        got_device = True
        daily = await redis.incr(daily_key)
        got_daily = True
        if daily == 1:
            await redis.expire(daily_key, 3 * 24 * 3600)
        if daily > GUEST_COMPOSE_DAILY_CAP:
            await _release()  # 기기 체험권 미소모 — 다음 날 다시 가능
            return _gc_denied(429, "guest_daily_cap", device_tag, f"daily_cap({GUEST_COMPOSE_DAILY_CAP})",
                              "오늘 작곡 체험이 마감됐어요. 가입하면 바로 만들 수 있어요.")
        ip_count = await redis.incr(ip_key)
        got_ip = True
        if ip_count == 1:
            await redis.expire(ip_key, 2 * 24 * 3600)
        if ip_count > GUEST_COMPOSE_IP_DAILY_CAP:
            await _release()
            return _gc_denied(429, "guest_ip_cap", device_tag, f"ip_cap({GUEST_COMPOSE_IP_DAILY_CAP}) ip={ip_tag}",
                              "이 네트워크에서 오늘 체험이 마감됐어요. 가입하면 바로 만들 수 있어요.")
    except Exception as e:  # noqa: BLE001
        logger.error("[GuestCompose] denied device=%s reason=redis_error %s", device_tag, type(e).__name__)
        await _release()
        return JSONResponse(status_code=503, content=_GUEST_COMPOSE_UNAVAILABLE)

    instrumental = bool(body.instrumental) or (body.vocal or "").strip().lower() == "instrumental"
    vocal = "instrumental" if instrumental else _gc_cap(body.vocal, 60)
    bpm = body.bpm if isinstance(body.bpm, int) and 40 <= body.bpm <= 250 else None
    duration = body.duration if isinstance(body.duration, int) and 10 <= body.duration <= 360 else None
    genre = _gc_cap(body.genre, 100)
    mood = _gc_cap(body.mood, 100)
    prompt = _gc_cap(body.prompt, 1000) or "곡을 생성합니다."
    key = _gc_cap(body.key, 20)
    negative_tags = _gc_cap(body.negative_tags, 200)
    style_weight = _gc_unit(body.style_weight)
    weirdness = _gc_unit(body.weirdness)
    duet_main = _gc_cap(body.duet_main_vocal_style, 100)
    duet_sub = _gc_cap(body.duet_sub_vocal_style, 100)

    now = datetime.now(timezone.utc)
    # 기존 create(_create_generation_impl) 문서와 같은 필드 구조 — 과금(point_ref)·세션·아티스트·목소리 클론·참고 음원 없음.
    doc = {
        "user_id": f"guest:{device_id}",
        "user_nickname": "게스트",
        "prompt": prompt,
        "title": title,
        "genre": genre,
        "mood": mood,
        "style": style,
        "categories": [],
        "vocal": vocal,
        "duration": duration,
        "bpm": bpm,
        "key": key,
        "instruments": None,
        "reference_style": None,
        "lyrics": lyrics,
        "model": "suno",
        "suno_model": None,  # 서버 기본값 고정(settings.suno_model_default)
        "persona_id": None,
        "character_id": None,
        "negative_tags": negative_tags,
        "style_weight": style_weight,
        "weirdness": weirdness,
        "audio_weight": None,
        "persona_model": None,
        "reference_audio_url": None,
        "reference_audio_name": None,
        "reference_audio_duration": None,
        "duet_main_vocal_style": duet_main,
        "duet_sub_vocal_style": duet_sub,
        "duet": body.duet,
        "lyrics_source": None,
        "session_id": None,
        "lyrics_version_id": None,
        "status": "pending",
        "progress": 0,
        "result_track_id": None,
        "result_audio_url": None,
        "output_files": [],
        "error_message": None,
        "point_ref": None,  # 무과금 — refund_generation_points·gj sweep/recoverable 대상 아님
        "point_cost": None,
        "refunded": False,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        # 죽은 작업 판정(_gc_settle → gj.dead_reason)용. consume_tracked 없음 → 원장 회수 목록 비대상
        "boot_id": gj.BOOT_ID,
        "started_at": now,
        "guest": True,
        "guest_device": device_id,
        "guest_ip_tag": ip_tag,
    }
    try:
        result = await get_mongo().generations.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        logger.exception("[GuestCompose] insert failed device=%s (trial released)", device_tag)
        await _release()
        return JSONResponse(status_code=500, content={"error": f"작곡 요청 저장 실패: {type(e).__name__}"})
    gen_id = str(result.inserted_id)

    background_tasks.add_task(
        _run_music_generation,
        generation_id=gen_id,
        lyrics=lyrics,
        genre=genre,
        mood=mood,
        style=style,
        vocal=vocal,
        duration=duration or 0,
        model="suno",
        title=title,
        prompt=prompt,
        persona_id=None,
        negative_tags=negative_tags,
        style_weight=style_weight,
        weirdness=weirdness,
        audio_weight=None,
        persona_model=None,
        bpm=bpm,
        key=key,
        reference_audio_url=None,
        duet_main_vocal_style=duet_main,
        duet_sub_vocal_style=duet_sub,
        suno_model=None,
        session_id=None,
        lyrics_version_id=None,
    )
    logger.info("[GuestCompose] start device=%s ip=%s daily=%s ip_count=%s gen=%s lyrics_len=%d",
                device_tag, ip_tag, daily, ip_count, gen_id, len(lyrics))
    return JSONResponse(status_code=201, content={"id": gen_id, "status": "pending", "guest": True})


@router.get("/guest-compose/{gen_id}")
async def get_guest_compose(
    gen_id: str,
    x_guest_device_id: Optional[str] = Header(None),
):
    """v3.277 게스트 작곡 상태(인증 없음). 헤더 device 가 문서 guest_device 와 일치해야 함(아니면 404).
    응답 = 기존 GET /{gen_id} 와 같은 직렬화(_serialize) + guest_ticket_returned(실패 시 체험권 반환 여부)."""
    device = _gc_device(x_guest_device_id)
    doc = await _gc_load(gen_id, device)
    if not doc:
        logger.info("[GuestCompose] status not_found gen=%s device=%s", gen_id[:24], (device or "-")[:8] + "…")
        return JSONResponse(status_code=404, content=_GC_NOT_FOUND)
    if _gc_expired(doc):
        logger.info("[GuestCompose] status expired gen=%s", gen_id)
        return JSONResponse(status_code=410, content=_GC_EXPIRED)
    doc = await _gc_settle(doc)
    if doc.get("status") in ("completed", "failed"):
        logger.info("[GuestCompose] status gen=%s status=%s", gen_id, doc.get("status"))
    exp = _gc_expires_at(doc)  # _serialize 가 created_at 을 문자열로 바꾸므로 그 전에 계산
    out = _serialize(doc)
    if isinstance(out, dict) and exp:
        out["guest_expires_at"] = exp.isoformat()
    return out


@router.get("/guest-compose/{gen_id}/stream/")
@router.get("/guest-compose/{gen_id}/stream", include_in_schema=False)
async def stream_guest_compose(
    gen_id: str,
    request: Request,
    variant: int = 0,
    device: Optional[str] = Query(None),
):
    """v3.277 게스트 A/B 청취 스트림(인증 없음). <audio>/expo-av 는 헤더를 못 보내므로 ?device= 쿼리로 소유 확인.
    Range·variant 처리는 기존 stream_generation 그대로 재사용(문서 소유자 id 를 넘겨 소유 검사를 통과시킨다)."""
    dev = _gc_device(device)
    doc = await _gc_load(gen_id, dev)
    if not doc:
        logger.info("[GuestCompose] stream not_found gen=%s device=%s", gen_id[:24], (dev or "-")[:8] + "…")
        return JSONResponse(status_code=404, content=_GC_NOT_FOUND)
    if _gc_expired(doc):
        return JSONResponse(status_code=410, content=_GC_EXPIRED)
    return await stream_generation(gen_id, request, variant, current_user={"id": doc.get("user_id")})


@router.post("/guest-compose/{gen_id}/claim")
@router.post("/guest-compose/{gen_id}/claim/", include_in_schema=False)
async def claim_guest_compose(
    gen_id: str,
    current_user=Depends(get_current_user),
    x_guest_device_id: Optional[str] = Header(None),
):
    """v3.277 게스트 체험 곡을 로그인 계정으로 가져오기(인증 필요, 헤더 device 일치 필수). 무과금.
    200 {id, claimed:true, already} · 404(불일치·없음) · 409 guest_compose_claimed(다른 계정)
    · 409 guest_compose_not_ready(생성 중) · 409 guest_compose_failed(실패 — 가져올 곡 없음)."""
    device = _gc_device(x_guest_device_id)
    uid = current_user["id"]
    doc = await _gc_load(gen_id, device)
    if not doc:
        logger.info("[GuestCompose] claim not_found user=%s gen=%s", uid[:8], gen_id[:24])
        return JSONResponse(status_code=404, content=_GC_NOT_FOUND)
    if doc.get("user_id") == uid:
        logger.info("[GuestCompose] claim user=%s gen=%s already=True", uid[:8], gen_id)
        return {"id": gen_id, "claimed": True, "already": True, "status": doc.get("status")}
    if _gc_expired(doc):
        logger.info("[GuestCompose] claim expired user=%s gen=%s", uid[:8], gen_id)
        return JSONResponse(status_code=410, content=_GC_EXPIRED)
    if not doc.get("guest"):
        logger.info("[GuestCompose] claim conflict user=%s gen=%s", uid[:8], gen_id)
        return JSONResponse(status_code=409, content={"error": "guest_compose_claimed",
                                                      "message": "이미 다른 계정으로 가져간 곡이에요."})
    doc = await _gc_settle(doc)
    status = doc.get("status")
    if status in ("pending", "processing"):
        return JSONResponse(status_code=409, content={"error": "guest_compose_not_ready",
                                                      "message": "아직 곡을 만드는 중이에요."})
    if status != "completed":
        return JSONResponse(status_code=409, content={"error": "guest_compose_failed",
                                                      "message": "체험 곡을 만들지 못해 가져올 곡이 없어요."})
    now = datetime.now(timezone.utc)
    updated = await get_mongo().generations.find_one_and_update(
        {"_id": doc["_id"], "guest": True, "user_id": f"guest:{device}", "status": "completed"},
        {"$set": {
            "user_id": uid,
            "user_nickname": current_user.get("nickname", ""),
            "guest": False,
            "claimed_from_guest": True,
            "claimed_at": now,
            "updated_at": now,
        }},
    )
    if not updated:
        fresh = await get_mongo().generations.find_one({"_id": doc["_id"]}, {"user_id": 1})
        if fresh and fresh.get("user_id") == uid:
            logger.info("[GuestCompose] claim user=%s gen=%s already=True (race)", uid[:8], gen_id)
            return {"id": gen_id, "claimed": True, "already": True, "status": "completed"}
        logger.info("[GuestCompose] claim conflict user=%s gen=%s (race)", uid[:8], gen_id)
        return JSONResponse(status_code=409, content={"error": "guest_compose_claimed",
                                                      "message": "이미 다른 계정으로 가져간 곡이에요."})
    logger.info("[GuestCompose] claim user=%s gen=%s device=%s", uid[:8], gen_id, (device or "")[:8] + "…")
    return {"id": gen_id, "claimed": True, "already": False, "status": "completed"}


@router.post("/", status_code=201)
async def create_generation(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    x_gen_request_id: Optional[str] = Header(None),
):
    """
    Create a generation record.
    If start_music_gen=True, also starts background music generation.

    v3.228: 실제 작곡 시작(start_music_gen)만 사용자 락 안에서 [정리 → 진행 중 409 → 차감 → insert]
    (사용자당 진행 중 1곡 — 사용자 결정 4). 초안(무과금)은 락·게이트·정리 대상이 아니다.
    헤더 X-Gen-Request-Id(선택)는 doc.client_request_id 로 저장(응답 유실 시 /jobs/req 회수).
    """
    # v3.232 F5·F6+G1 — 어린이 제한·금칙어는 락·차감·원장 전(성인은 None 으로 기존 순서 그대로).
    _kids_block = await _kids_generation_gate(current_user["id"], body)
    if _kids_block is not None:
        return _kids_block
    request_id = gj.normalize_request_id(x_gen_request_id)
    will_start = bool(body.start_music_gen and (body.lyrics or (body.vocal or "").strip().lower() == "instrumental"))
    if will_start and gj.enabled("music"):
        async with gj.user_lock(current_user["id"], "music"):
            return await _create_generation_impl(body, background_tasks, current_user, request_id, guard=True)
    return await _create_generation_impl(body, background_tasks, current_user, request_id, guard=False)


async def _create_generation_impl(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user,
    request_id: Optional[str] = None,
    guard: bool = False,
    extra_fields: Optional[dict] = None,
    parent_session_id: Optional[str] = None,
):
    """create_generation 본체(v3.228 이전 로직 그대로 + 진행 중 게이트·추적 필드 가산).

    v3.281 편곡(arrange_generation) 전용 선택 인자 — 기본 None 이면 기존 동작 바이트 불변:
    - extra_fields: insert 직전 doc 에 병합할 가산 필드(arranged_from 등 — 원자 기록).
    - parent_session_id: 실제 작곡 시작 시 이 세션을 부모로 하는 새 창작 세션 생성(파생 계보).
    """
    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (제한 중이면 403)
    from ..services.strike_service import check_generation_allowed
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if not body.prompt.strip():
        return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})

    # StarEcon(v158) — 실제 작곡 시작 경로에만 게이트/과금.
    # 순서: 스트라이크 403(위) → 피로 429 → 잔액 402. draft(start_music_gen
    # False)는 무과금/무게이트. 402/429 시 generations doc 자체를 만들지 않는다.
    # v3.203: 연주곡(vocal='instrumental')은 가사 없이도 생성 시작 허용
    will_start_music = bool(body.start_music_gen and (body.lyrics or (body.vocal or "").strip().lower() == "instrumental"))
    compose_cost = POINT_COSTS["compose"]
    point_ref = None
    if will_start_music:
        # v232: 클론 보이스 만료 선체크 — 차감·생성 전에 차단(만료 시 400 + 클론 ⭐ 환불)
        voice_blocked = await _voice_expired_response(current_user["id"], body.persona_id)
        if voice_blocked:
            return voice_blocked
        fatigued = await _fatigue_gate_response(current_user["id"])
        if fatigued:
            return fatigued
        # v3.228 — 진행 중 작곡 409(과금 전). 순서: 피로 429 → 409 → 잔액 402.
        if guard:
            _early = await _compose_guard(current_user["id"], request_id)
            if _early is not None:
                return _early
        point_ref = uuid_lib.uuid4().hex
        if not await spend_points(current_user["id"], "compose", compose_cost, point_ref):
            logger.info("[star-econ] compose denied (insufficient) user=%s", current_user["id"][:8])
            return JSONResponse(
                status_code=402,
                content={"error": "포인트가 부족합니다 (필요: {})".format(compose_cost)},
            )
        logger.info(
            "[star-econ] compose spend user=%s -%d ref=%s (create)",
            current_user["id"][:8], compose_cost, point_ref,
        )

    mongo = get_mongo()
    now = datetime.now(timezone.utc)

    # v77 — categories 화이트리스트 필터(고정 10종만 통과, 중복 제거/순서 보존).
    from ..constants.categories import filter_categories
    categories = filter_categories(body.categories)

    # ── v3.200 창작 기록 계층 — 세션 확보 (실제 작곡 시작 시에만, best-effort) ──
    # body.session_id 유효(본인·ACTIVE)면 사용, 없거나 무효면 서버 자동 생성
    # (구버전 앱 요청도 기록 — 문서 §4.4 '세션 없이 생성 거부'의 취지 유지).
    # FINALIZED 세션이면 parent 로 잇는 새 세션. 기록 실패는 생성 흐름을 막지 않는다.
    creation_session_id = None
    if will_start_music:
        try:
            if parent_session_id:
                # v3.281 편곡 — 원곡 세션을 부모로 잇는 새 세션(sessions.parent_session_id = 파생 계보)
                from ..services.creation_log import create_session
                creation_session_id = await create_session(
                    current_user["id"], parent_session_id=str(parent_session_id),
                )
            else:
                from ..services.creation_log import ensure_session
                creation_session_id = await ensure_session(body.session_id, current_user["id"])
        except Exception as _cl_exc:
            logger.warning("[creation-log] ensure_session failed (create): %s", _cl_exc)

    doc = {
        "user_id": current_user["id"],
        "user_nickname": current_user.get("nickname", ""),
        "prompt": body.prompt.strip(),
        "title": body.title,
        "genre": body.genre,
        "mood": body.mood,
        "style": body.style,
        "categories": categories,
        "vocal": body.vocal,
        "duration": body.duration,  # v3.203: 자동이면 None 저장(재시작 경로 오염 방지)
        "bpm": body.bpm,
        "key": body.key,
        "instruments": body.instruments,
        "reference_style": body.reference_style,
        "lyrics": body.lyrics,
        "model": body.model or "suno",
        "suno_model": body.suno_model,
        "persona_id": body.persona_id,
        # v236 — 선택 아티스트 승계용 (64자 캡, 존재 검증은 발매 시점 tracks.py)
        "character_id": (body.character_id or "").strip()[:64] or None,
        "negative_tags": body.negative_tags,
        "style_weight": body.style_weight,
        "weirdness": body.weirdness,
        "audio_weight": body.audio_weight,
        "persona_model": body.persona_model,
        "reference_audio_url": body.reference_audio_url,
        "reference_audio_name": body.reference_audio_name,
        "reference_audio_duration": body.reference_audio_duration,
        "duet_main_vocal_style": body.duet_main_vocal_style,
        "duet_sub_vocal_style": body.duet_sub_vocal_style,
        # v209+: 솔로/듀엣 여부 보존 (draft → 작곡실 인계 유실 방지, PATCH duet 과 대칭).
        "duet": body.duet,
        # v214 — 가사 출처 스냅샷 영속 (캡: id 64·title 100. 자기 소유 기록이라 캡 외 무검증).
        "lyrics_source": _normalize_lyrics_source(body.lyrics_source),
        # v3.200 — 창작 기록 계층 연결 (세션 미확보 draft 는 None — start 시점에 확보)
        "session_id": creation_session_id,
        "lyrics_version_id": (body.lyrics_version_id or "").strip()[:64] or None,
        "status": "pending",
        "progress": 0,
        "result_track_id": None,
        "result_audio_url": None,
        "output_files": [],
        "error_message": None,
        # StarEcon(v158) — 작곡 -15 선차감 추적 (실패 시 원자 클레임 환불).
        # 미시작 draft 는 point_ref=None → 환불 클레임 대상에서 제외.
        "point_ref": point_ref,
        "point_cost": compose_cost if will_start_music else None,
        "refunded": False,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    if will_start_music:
        # v3.228 — 작업 추적(가산 필드, 구 코드는 무시): 죽은 작업 판정·회수·확인
        doc.update({
            "boot_id": gj.BOOT_ID,
            "started_at": now,
            "consume_tracked": True,
            "acked_at": None,
        })
        if request_id:
            doc["client_request_id"] = request_id
    if extra_fields:
        doc.update(extra_fields)  # v3.281 편곡 — arranged_from 등 가산 필드(기본 None → 불변)

    result = await mongo.generations.insert_one(doc)
    doc["_id"] = result.inserted_id
    gen_id = str(result.inserted_id)

    logger.info("[generate] gen_id=%s cats=%s", gen_id, categories)
    if doc.get("lyrics_source"):
        logger.info(
            "[SongSource] gen_id=%s lyrics_source id=%s title_len=%d is_mine=%s",
            gen_id, doc["lyrics_source"].get("lyrics_id") or "(none)",
            len(doc["lyrics_source"].get("title") or ""),
            doc["lyrics_source"].get("is_mine"),
        )

    # Start music generation if requested
    if will_start_music:
        if (body.vocal or "").strip().lower() == "instrumental" and not body.lyrics:
            logger.info("[generate] gen_id=%s instrumental start (no lyrics)", gen_id)
        background_tasks.add_task(
            _run_music_generation,
            generation_id=gen_id,
            lyrics=body.lyrics,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            vocal=body.vocal,
            duration=body.duration or 0,  # v3.203: 생략=자동 → suno 게이트에서 falsy로 미전달
            model=body.model or "suno",
            title=body.title,
            prompt=body.prompt,
            persona_id=body.persona_id,
            negative_tags=body.negative_tags,
            style_weight=body.style_weight,
            weirdness=body.weirdness,
            audio_weight=body.audio_weight,
            persona_model=body.persona_model,
            bpm=body.bpm,
            key=body.key,
            reference_audio_url=body.reference_audio_url,
            duet_main_vocal_style=body.duet_main_vocal_style,
            duet_sub_vocal_style=body.duet_sub_vocal_style,
            suno_model=body.suno_model,
            session_id=creation_session_id,                       # v3.200
            lyrics_version_id=doc.get("lyrics_version_id"),       # v3.200
        )
        gj.logger.info("[ComposeGuard] start user=%s gen=%s req=%s (create)",
                       gj.u8(current_user["id"]), gen_id, gj.r8(request_id))

    return _serialize(doc)


@router.post("/{gen_id}/start/")
async def start_music_generation(
    gen_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    x_gen_request_id: Optional[str] = Header(None),
):
    """Start music generation for an existing generation record.

    v3.228: 사용자 락 안에서 진행 중 작곡 409(과금 전) — create 와 같은 게이트.
    """
    # v3.232 F5·F6 — 어린이 && 초안이 내 목소리·참고 음원이면 락·차감 전 403. OFF 면 DB 0회.
    _kids_block = await _kids_start_gate(current_user["id"], gen_id)
    if _kids_block is not None:
        return _kids_block
    request_id = gj.normalize_request_id(x_gen_request_id)
    if gj.enabled("music"):
        async with gj.user_lock(current_user["id"], "music"):
            return await _start_music_generation_impl(gen_id, background_tasks, current_user, request_id, guard=True)
    return await _start_music_generation_impl(gen_id, background_tasks, current_user, request_id, guard=False)


async def _start_music_generation_impl(
    gen_id: str,
    background_tasks: BackgroundTasks,
    current_user,
    request_id: Optional[str] = None,
    guard: bool = False,
):
    """start_music_generation 본체(v3.228 이전 로직 그대로 + 진행 중 게이트·추적 필드 가산)."""
    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (제한 중이면 403)
    from ..services.strike_service import check_generation_allowed
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") == "processing":
        return JSONResponse(status_code=409, content={"error": "이미 생성 중입니다."})

    # StarEcon(v158) — 게이트 순서: 스트라이크 403(위) → 보이스 만료 400 → 피로 429 → 잔액 402.
    # v232: 클론 보이스 만료 선체크 — 차감·생성 전에 차단(만료 시 400 + 클론 ⭐ 환불)
    voice_blocked = await _voice_expired_response(current_user["id"], doc.get("persona_id"))
    if voice_blocked:
        return voice_blocked
    fatigued = await _fatigue_gate_response(current_user["id"])
    if fatigued:
        return fatigued
    # v3.228 — 진행 중 작곡 409(과금 전). 순서: 피로 429 → 409 → 잔액 402.
    if guard:
        _early = await _compose_guard(current_user["id"], request_id, gen_id=gen_id)
        if _early is not None:
            return _early

    compose_cost = POINT_COSTS["compose"]
    point_ref = uuid_lib.uuid4().hex  # 재시도마다 새 ref (멱등키 충돌 회피)
    if not await spend_points(current_user["id"], "compose", compose_cost, point_ref):
        logger.info(
            "[star-econ] compose denied (insufficient) user=%s gen_id=%s (start)",
            current_user["id"][:8], gen_id,
        )
        return JSONResponse(
            status_code=402,
            content={"error": "포인트가 부족합니다 (필요: {})".format(compose_cost)},
        )
    logger.info(
        "[star-econ] compose spend user=%s -%d ref=%s gen_id=%s (start)",
        current_user["id"][:8], compose_cost, point_ref, gen_id,
    )

    # v3.200 — 창작 기록 세션 확보 (doc 저장분 우선, 없으면 자동 생성 — best-effort)
    creation_session_id = None
    try:
        from ..services.creation_log import ensure_session
        creation_session_id = await ensure_session(doc.get("session_id"), current_user["id"])
    except Exception as _cl_exc:
        logger.warning("[creation-log] ensure_session failed (start): %s", _cl_exc)

    # Update status (+ v158: 새 선차감 추적 필드 — 실패 환불용)
    _started = datetime.now(timezone.utc)
    _set = {
        "status": "pending", "progress": 5,
        "point_ref": point_ref, "point_cost": compose_cost, "refunded": False,
        "session_id": creation_session_id,  # v3.200
        "updated_at": _started,
        # v3.228 — 작업 추적(가산): 죽은 작업 판정·회수·확인
        "boot_id": gj.BOOT_ID, "started_at": _started, "consume_tracked": True, "acked_at": None,
    }
    if request_id:
        _set["client_request_id"] = request_id
    await mongo.generations.update_one(
        {"_id": ObjectId(gen_id)},
        {"$set": _set},
    )
    gj.logger.info("[ComposeGuard] start user=%s gen=%s req=%s (start)",
                   gj.u8(current_user["id"]), gen_id, gj.r8(request_id))

    background_tasks.add_task(
        _run_music_generation,
        generation_id=gen_id,
        lyrics=doc.get("lyrics", ""),
        genre=doc.get("genre"),
        mood=doc.get("mood"),
        style=doc.get("style"),
        vocal=doc.get("vocal"),
        duration=doc.get("duration") or 0,  # v3.203: None/부재=자동 → suno 게이트에서 미전달
        model=doc.get("model", "suno"),
        title=doc.get("title"),
        prompt=doc.get("prompt"),
        persona_id=doc.get("persona_id"),
        negative_tags=doc.get("negative_tags"),
        style_weight=doc.get("style_weight"),
        weirdness=doc.get("weirdness"),
        audio_weight=doc.get("audio_weight"),
        persona_model=doc.get("persona_model"),
        bpm=doc.get("bpm"),
        key=doc.get("key"),
        reference_audio_url=doc.get("reference_audio_url"),
        duet_main_vocal_style=doc.get("duet_main_vocal_style"),
        duet_sub_vocal_style=doc.get("duet_sub_vocal_style"),
        suno_model=doc.get("suno_model"),
        session_id=creation_session_id,                     # v3.200
        lyrics_version_id=doc.get("lyrics_version_id"),     # v3.200
    )

    return {"message": "음악 생성이 시작되었습니다.", "id": gen_id}


# ─── v3.281 편곡하기 — 완성 곡을 다른 장르·분위기로 (upload-cover 재사용) ─────────
# 원곡 variant 오디오를 참고 음원(reference_audio_url)으로, 원곡 가사·보컬·목소리(persona)를
# 그대로 실어 기존 create 내부 경로(_create_generation_impl)를 호출한다 — 스트라이크 403·
# 보이스 만료 400·피로 429·진행 중 409·잔액 402·선차감·원장·실패 환불을 전부 재사용(재구현 없음).
ARRANGE_KEEP_MIN = 0.3
ARRANGE_KEEP_MAX = 0.9
ARRANGE_KEEP_DEFAULT = 0.65
ARRANGE_STYLE_MAX = 300
ARRANGE_AUDIO_TTL = timedelta(hours=24)  # 단축 URL 유효(시작/재시작 시각 기준) — /start/ 재시도까지 커버


class ArrangeRequest(BaseModel):
    variant_index: Optional[int] = None  # 생략 시: 발매된 곡이면 발매 트랙의 variant, 아니면 0
    genre: Optional[str] = None       # Suno 영문 태그(앱이 GENRE_EN 매핑해 전송)
    mood: Optional[str] = None        # Suno 영문 태그(앱이 MOOD_EN 매핑해 전송)
    style: Optional[str] = None       # 자유 문장/사운드 태그(≤300자)
    keep_melody: Optional[float] = ARRANGE_KEEP_DEFAULT  # 0.3~0.9 → audioWeight(원곡 유지 정도)
    label: Optional[str] = None       # 제목 꼬리표용 한글 라벨(예: "록") — 없으면 genre/mood


def _arrange_token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _arrange_public_base() -> str:
    # Inst(v3.214) 와 같은 공개 API 베이스 — 게이트웨이가 긴 presigned URL 을 거부해 짧은 리다이렉트 URL 사용
    try:
        from ..services.inst_service import _PUBLIC_API_BASE
        return str(_PUBLIC_API_BASE).rstrip("/")
    except Exception:
        return "https://api.maidol.ai.kr"


def _arrange_clean(v: Optional[str], n: int) -> Optional[str]:
    if v is None:
        return None
    t = " ".join(str(v).split())[:n].strip()
    return t or None


@router.get("/arrange-audio/{src_gen_id}/{variant_index}/{token}")
async def arrange_audio_redirect(src_gen_id: str, variant_index: int, token: str):
    """v3.281: 편곡 원곡 오디오 짧은 URL(무인증 — Suno 게이트웨이 fetch) → presigned 302.

    보호: 편곡 문서별 1회성 난수 토큰(해시만 저장) + 시작 시각 기준 24h. Inst inst-audio 관행.
    """
    import hmac as _hmac

    if not ObjectId.is_valid(src_gen_id) or not token or len(token) > 128:
        return JSONResponse(status_code=404, content={"error": "not found"})
    mongo = get_mongo()
    src = await mongo.generations.find_one({"_id": ObjectId(src_gen_id)}, {"user_id": 1})
    if not src or not src.get("user_id"):
        return JSONResponse(status_code=404, content={"error": "not found"})
    h = _arrange_token_hash(token)
    arr = await mongo.generations.find_one(
        {
            "user_id": src["user_id"],
            "arranged_from.generation_id": src_gen_id,
            "arranged_from.variant_index": variant_index,
            "arrange_audio_token_hash": h,
        },
        {"arrange_audio_token_hash": 1, "arrange_audio_object": 1, "started_at": 1, "created_at": 1},
    )
    if not arr or not _hmac.compare_digest(str(arr.get("arrange_audio_token_hash") or ""), h):
        logger.warning("[Arrange] audio redirect token mismatch src=%s v=%s", src_gen_id[:8], variant_index)
        return JSONResponse(status_code=403, content={"error": "forbidden"})
    base_ts = arr.get("started_at") or arr.get("created_at")
    if isinstance(base_ts, datetime):
        _now = datetime.utcnow() if base_ts.tzinfo is None else datetime.now(timezone.utc)
        if _now - base_ts > ARRANGE_AUDIO_TTL:
            return JSONResponse(status_code=410, content={"error": "expired"})
    obj = arr.get("arrange_audio_object")
    if not obj:
        return JSONResponse(status_code=404, content={"error": "audio not found"})
    url = public_presign(obj, bucket=settings.minio_bucket_music)
    if not url:
        return JSONResponse(status_code=502, content={"error": "presign failed"})
    logger.info("[Arrange] audio redirect ok src=%s v=%s arr=%s", src_gen_id[:8], variant_index, str(arr["_id"])[:8])
    return RedirectResponse(url, status_code=302)


@router.post("/{gen_id}/arrange", status_code=201)
@router.post("/{gen_id}/arrange/", status_code=201, include_in_schema=False)
async def arrange_generation(
    gen_id: str,
    body: ArrangeRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    x_gen_request_id: Optional[str] = Header(None),
):
    """v3.281 편곡하기 — 내 완성 곡(variant)을 다른 장르·분위기로 새로 만든다(⭐ compose 과금).

    응답: create(POST /generate/)와 동일한 새 generation 문서(201) — 앱은 기존 MusicLoading 폴링 재사용.
    400 옵션 없음·잘못된 variant / 403 타인·게스트 곡 / 404 없음·오디오 없음 / 409 미완성 곡
    (code=arrange_source_not_ready) — 이후 게이트(403 스트라이크·400 보이스 만료·429 피로·409 진행 중·
    402 잔액)는 create 와 같은 응답 체계.
    """
    uid = current_user["id"]
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    genre = _arrange_clean(body.genre, 100)
    mood = _arrange_clean(body.mood, 100)
    style_free = _arrange_clean(body.style, ARRANGE_STYLE_MAX)
    label = _arrange_clean(body.label, 20)
    if not (genre or mood or style_free):
        return JSONResponse(status_code=400, content={
            "error": "장르·분위기·스타일 중 하나 이상을 골라주세요.", "code": "arrange_no_option",
        })
    try:
        keep = float(body.keep_melody if body.keep_melody is not None else ARRANGE_KEEP_DEFAULT)
    except (TypeError, ValueError):
        keep = ARRANGE_KEEP_DEFAULT
    if keep != keep:  # NaN
        keep = ARRANGE_KEEP_DEFAULT
    keep = round(min(ARRANGE_KEEP_MAX, max(ARRANGE_KEEP_MIN, keep)), 2)

    mongo = get_mongo()
    src = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not src:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if src.get("guest") or src.get("user_id") != uid:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if src.get("status") != "completed":
        return JSONResponse(status_code=409, content={
            "error": "완성된 곡만 편곡할 수 있어요.", "code": "arrange_source_not_ready",
        })

    variants = src.get("variants") or []
    vi = body.variant_index
    if vi is None:
        # 발매된 곡(단일 플레이어 — 앱이 variant 를 모름)은 발매 트랙에 실제 쓰인 variant 로
        vi = 0
        _tid = src.get("result_track_id")
        if _tid and ObjectId.is_valid(str(_tid)):
            _t = await mongo.tracks.find_one({"_id": ObjectId(str(_tid))}, {"variant_index": 1})
            if _t and isinstance(_t.get("variant_index"), int):
                vi = _t["variant_index"]
    audio_obj = None
    if variants:
        if not (0 <= vi < len(variants)):
            return JSONResponse(status_code=400, content={"error": "잘못된 버전입니다.", "code": "arrange_bad_variant"})
        audio_obj = (variants[vi] or {}).get("audio_url")
    elif vi == 0:
        audio_obj = src.get("result_audio_url")
    else:
        return JSONResponse(status_code=400, content={"error": "잘못된 버전입니다.", "code": "arrange_bad_variant"})
    if not audio_obj:
        return JSONResponse(status_code=404, content={"error": "원곡 오디오를 찾을 수 없습니다."})
    if not str(audio_obj).startswith(("http://", "https://")):
        try:
            _stat = await asyncio.to_thread(
                lambda: get_minio().stat_object(settings.minio_bucket_music, audio_obj)
            )
        except Exception:
            return JSONResponse(status_code=404, content={"error": "원곡 오디오를 찾을 수 없습니다."})
        if getattr(_stat, "size", 0) and _stat.size > MAX_REFERENCE_SIZE:
            return JSONResponse(status_code=400, content={"error": "원곡 파일이 너무 커서 편곡할 수 없어요."})

    # 새 문서 필드 구성 — 원곡 가사·보컬·목소리(persona)·아티스트 유지, 사운드만 새 장르·분위기·스타일
    new_genre = genre or src.get("genre")
    new_mood = mood or (None if genre else src.get("mood"))  # 장르를 바꾸면 원곡 분위기 태그는 버린다(충돌 방지)
    tag = label or genre or mood or "새 스타일"
    base_title = (src.get("title") or "제목 없음").strip() or "제목 없음"
    suffix = f" ({tag} 편곡)"
    title = base_title[: max(1, 80 - len(suffix))].rstrip() + suffix
    desc = ", ".join([x for x in (label or genre, mood, style_free) if x])
    prompt = f"원곡 '{base_title}'을(를) {desc} 스타일로 편곡"

    token = secrets.token_urlsafe(24)
    ref_url = f"{_arrange_public_base()}/api/generate/arrange-audio/{gen_id}/{vi}/{token}"
    is_instr = (src.get("vocal") or "").strip().lower() == "instrumental"

    req = GenerateRequest(
        prompt=prompt,
        title=title,
        genre=new_genre,
        mood=new_mood,
        style=style_free,
        vocal=src.get("vocal"),
        duration=src.get("duration") if is_instr else None,
        lyrics=src.get("lyrics"),
        start_music_gen=True,
        model="suno",
        suno_model=None,  # 서버 기본(V6) — 원곡의 폐기 모델 승계 방지
        persona_id=src.get("persona_id"),
        persona_model=src.get("persona_model"),
        audio_weight=keep,
        reference_audio_url=ref_url,
        reference_audio_name=f"arrange:{gen_id}:v{vi}",
        duet_main_vocal_style=src.get("duet_main_vocal_style"),
        duet_sub_vocal_style=src.get("duet_sub_vocal_style"),
        duet=src.get("duet"),
        character_id=src.get("character_id"),
        lyrics_version_id=src.get("lyrics_version_id"),
    )
    if src.get("lyrics_source"):
        try:
            req.lyrics_source = LyricsSourceSnapshot(**src["lyrics_source"])
        except Exception:
            pass

    # 어린이 제한·금칙어(락·차감 전) — 참고 음원 사용이므로 어린이는 403(앱도 버튼 숨김).
    # 자유 입력 style 은 prompt 에 포함되므로 같은 금칙어 검사(prompt·title)를 탄다.
    _kids_block = await _kids_generation_gate(uid, req)
    if _kids_block is not None:
        return _kids_block

    extra = {
        "arranged_from": {
            "generation_id": gen_id,
            "variant_index": vi,
            "audio_object": audio_obj,
            "keep_melody": keep,
            "genre": genre,
            "mood": mood,
            "style": style_free,
            "label": label,
        },
        "arrange_audio_object": audio_obj,
        "arrange_audio_token_hash": _arrange_token_hash(token),
    }
    request_id = gj.normalize_request_id(x_gen_request_id)
    logger.info(
        "[Arrange] start user=%s gen=%s variant=%s genre=%s mood=%s keep=%.2f persona=%s req=%s",
        uid[:8], gen_id, vi, genre, mood, keep, bool(src.get("persona_id")), gj.r8(request_id),
    )
    if gj.enabled("music"):
        async with gj.user_lock(uid, "music"):
            result = await _create_generation_impl(
                req, background_tasks, current_user, request_id, guard=True,
                extra_fields=extra, parent_session_id=src.get("session_id"),
            )
    else:
        result = await _create_generation_impl(
            req, background_tasks, current_user, request_id, guard=False,
            extra_fields=extra, parent_session_id=src.get("session_id"),
        )
    if isinstance(result, dict):
        result.pop("arrange_audio_token_hash", None)  # 응답 비노출(문서엔 해시만 저장)
        logger.info("[Arrange] start user=%s gen=%s variant=%s genre=%s keep=%.2f → new_gen=%s",
                    uid[:8], gen_id, vi, genre, keep, result.get("id"))
    else:
        logger.info("[Arrange] start user=%s gen=%s → early status=%s",
                    uid[:8], gen_id, getattr(result, "status_code", "?"))
    return result


@router.get("/models/")
async def list_models(current_user=Depends(get_current_user)):
    """List available AI music generation models."""
    return {"models": [
        {
            "id": "suno",
            "name": "Suno",
            "description": "AI 음악 생성 서비스 (고품질 보컬 + 반주)",
            "supports_vocal": True,
            "supports_instrumental": True,
            "max_duration": 240,
            "default": True,
        },
    ]}


@router.get("/")
async def list_generations(
    page: int = 1,
    limit: int = 20,
    status: str = None,
    current_user=Depends(get_current_user),
):
    mongo = get_mongo()
    # v3.228 — 죽은(재시작·상한 초과) 과금 작곡을 먼저 실패+1회 환불로 확정(초안 불변)
    await gj.sweep_user(current_user["id"], groups=["music"])
    query = {"user_id": current_user["id"]}
    if status:
        query["status"] = status

    total = await mongo.generations.count_documents(query)
    cursor = (
        mongo.generations.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)

    return {
        "generations": [_serialize(d) for d in docs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{gen_id}")
async def get_generation(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    # v3.228 — 죽은 작업이면 즉시 failed + 1회 환불로 확정(MusicLoading 무한 대기 해소)
    doc = await gj.sweep_doc("music", doc)
    return _serialize(doc)


@router.patch("/{gen_id}")
async def update_generation(
    gen_id: str,
    body: UpdateGenerationRequest,
    current_user=Depends(get_current_user),
):
    """v209 — draft(작사 임시저장) 수정 전용 PATCH.

    가드: 본인 소유(403) + draft 시그니처만 허용(409):
    status=="pending" && point_ref 없음 && result_audio_url 없음
    (draft 시그니처 근거는 create_generation 의 StarEcon 주석 — 미시작
    draft 는 point_ref=None). 응답은 GET /{gen_id} 와 동일 직렬화.
    """
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        logger.warning("[Generate] patch draft id=%s not found", gen_id)
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        logger.warning("[Generate] patch draft id=%s denied (not owner)", gen_id)
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    is_draft = (
        doc.get("status") == "pending"
        and not doc.get("point_ref")
        and not doc.get("result_audio_url")
    )
    if not is_draft:
        logger.warning(
            "[Generate] patch draft id=%s rejected: not a draft (status=%s point_ref=%s has_audio=%s)",
            gen_id, doc.get("status"), bool(doc.get("point_ref")), bool(doc.get("result_audio_url")),
        )
        return JSONResponse(
            status_code=409,
            content={"error": "임시저장(draft) 상태의 생성물만 수정할 수 있습니다."},
        )

    # 보낸 필드만 반영 (exclude_unset) — 화이트리스트 외 필드는 모델 단계에서 무시됨.
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return JSONResponse(status_code=400, content={"error": "수정할 필드가 없습니다."})

    # prompt 는 create 와 동일하게 공백만은 불허 (명시 전송 시).
    if "prompt" in updates:
        _p = (updates["prompt"] or "").strip()
        if not _p:
            return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})
        updates["prompt"] = _p

    # categories 는 create 와 동일한 화이트리스트 필터 통과.
    if "categories" in updates:
        from ..constants.categories import filter_categories
        updates["categories"] = filter_categories(updates["categories"])

    updates["updated_at"] = datetime.now(timezone.utc)
    logger.info(
        "[Generate] patch draft id=%s fields=%s user=%s",
        gen_id, sorted(k for k in updates if k != "updated_at"), current_user["id"][:8],
    )

    try:
        await mongo.generations.update_one(
            {"_id": ObjectId(gen_id)},
            {"$set": updates},
        )
        updated_doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
        return _serialize(updated_doc)
    except Exception as e:
        logger.error("[Generate] patch draft id=%s failed: %s", gen_id, e)
        return JSONResponse(status_code=500, content={"error": "수정 중 오류가 발생했습니다."})


@router.post("/{gen_id}/timestamps/refetch")
async def refetch_generation_timestamps(
    gen_id: str,
    force: bool = Query(False),
    current_user=Depends(get_current_user),
):
    """On-demand refetch of per-variant lyric timestamps from Suno.

    When ``force`` is False (default), only fills variants that currently have
    empty timestamps; variants that already have timestamps are left untouched.

    When ``force`` is True, re-fetches every variant (even ones with existing
    timestamps) to re-segment them. The merge is safe: a non-empty new fetch
    overwrites the old value, but an empty fetch (transient failure / no data)
    keeps the existing timestamps so good data is never clobbered.

    Returns the serialized doc (same shape as GET /api/generate/{gen_id}).
    """
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    if doc.get("status") != "completed":
        return JSONResponse(
            status_code=400,
            content={"error": "완료된 생성물만 타임스탬프를 불러올 수 있습니다."},
        )

    variants = doc.get("variants") or []
    if not variants:
        return JSONResponse(
            status_code=400,
            content={"error": "이 생성물에는 클립 정보가 없어 타임스탬프를 불러올 수 없습니다."},
        )

    logger.info(
        "[TimestampsRefetch] gen_id=%s force=%s start variants=%d",
        gen_id, force, len(variants),
    )

    try:
        from ..services.suno_timestamp_service import get_suno_timestamps

        task_id = doc.get("suno_task_id")

        async def _fetch_one(v: dict) -> list[dict]:
            audio_id = v.get("suno_audio_id")
            existing = v.get("timestamps") or []
            # Without force: skip if no audio_id or already has timestamps.
            if not audio_id:
                return existing
            if not force and existing:
                return existing
            try:
                fresh = await get_suno_timestamps(task_id, audio_id) or []
            except Exception as _ts_exc:
                logger.warning(
                    "[TimestampsRefetch] gen_id=%s audio_id_len=%d fetch failed: %s",
                    gen_id, len(audio_id), _ts_exc,
                )
                return existing
            # SAFE MERGE: a non-empty fetch overwrites; an empty fetch
            # (transient failure / no data) keeps existing good data.
            if fresh:
                return fresh
            return existing

        ts_results = await asyncio.gather(
            *[_fetch_one(v) for v in variants],
            return_exceptions=False,
        )
        for v, segs in zip(variants, ts_results):
            v["timestamps"] = segs or []

        logger.info(
            "[TimestampsRefetch] gen_id=%s force=%s filled=%s",
            gen_id, force, [len(v.get("timestamps") or []) for v in variants],
        )

        now = datetime.utcnow()
        await mongo.generations.update_one(
            {"_id": ObjectId(gen_id)},
            {"$set": {"variants": variants, "updated_at": now}},
        )

        updated_doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
        return _serialize(updated_doc)

    except Exception as e:
        logger.exception("[TimestampsRefetch] gen_id=%s failed: %s", gen_id, e)
        return JSONResponse(
            status_code=500,
            content={"error": "타임스탬프를 불러오는 중 오류가 발생했습니다."},
        )


@router.delete("/{gen_id}")
async def delete_generation(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    # v3.274 [45]: 과금된 진행 중(pending/processing) 기록 삭제 = 선차감 ⭐ 1회 환불 후 삭제.
    # 종전엔 환불 없이 delete_one → 30분 sweep·409 가드 모두 문서를 못 찾아
    # "삭제 후 재작곡 = 이중과금" 경로였다(09-24 원장 감사 1건 일치). refund_generation_points
    # 는 refunded 플래그 원자 클레임이라 sweep/실패 환불과 겹쳐도 이중 환불 불가.
    if (
        doc.get("status") in ("pending", "processing")
        and doc.get("point_ref")
        and doc.get("refunded") is not True
    ):
        refunded = await refund_generation_points(mongo, gen_id)
        logger.info(
            "[star-econ] delete-in-progress refund gen_id=%s user=%s refunded=%s",
            gen_id, current_user["id"][:8], refunded,
        )
    await mongo.generations.delete_one({"_id": ObjectId(gen_id)})
    return {"message": "삭제되었습니다."}


# v44 — Beat extraction status & retry
def _serialize_beats_payload(doc: dict) -> dict:
    """Build the beats response payload from a generation/track doc."""
    started = doc.get("beats_started_at")
    completed = doc.get("beats_completed_at")
    return {
        "status": doc.get("beats_status") or "pending",
        "tempo": doc.get("tempo"),
        "beats": doc.get("beats") or [],
        "downbeats": doc.get("downbeats") or [],
        "started_at": started.isoformat() if isinstance(started, datetime) else None,
        "completed_at": completed.isoformat() if isinstance(completed, datetime) else None,
        "error": doc.get("beats_error"),
    }


@router.get("/{gen_id}/beats")
async def get_generation_beats(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    """Return beat extraction status + data for a generation."""
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    return _serialize_beats_payload(doc)


@router.post("/{gen_id}/beats/retry")
async def retry_generation_beats(
    gen_id: str,
    current_user=Depends(get_current_user),
):
    """Reset the beat status to pending and re-trigger extraction."""
    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") != "completed" or not doc.get("result_audio_url"):
        return JSONResponse(status_code=400, content={"error": "완료된 생성만 재시도할 수 있습니다."})

    # v3.244 — 박자분석 전역 중지 스위치: 문서 상태 무접촉, 친절 응답(200)
    if not settings.beats_extraction_enabled:
        return {"message": "박자 분석 기능이 일시 중지되었습니다.", "status": "disabled"}

    await mongo.generations.update_one(
        {"_id": ObjectId(gen_id)},
        {"$set": {
            "beats_status": "pending",
            "beats_error": None,
            "beats_started_at": None,
            "beats_completed_at": None,
            "tempo": None,
            "beats": [],
            "downbeats": [],
        }},
    )

    # v206: 기존에는 detect_beats_for_generation 을 메인 루프 create_task 로
    # 직접 걸어 madmom CPU 작업이 메인 이벤트 루프에서 돌던 결함(v205 트랙
    # 재추출의 쌍둥이).
    # 전체를 to_thread 로 워커 스레드에 옮기고, 그 안(sync 래퍼)에서
    # heavy_job_slot 을 획득한다 — 더 이상 메인 루프 fire-and-forget 이 아님.
    from ..services.beat_extraction import run_generation_beat_extraction_in_background
    asyncio.create_task(
        asyncio.to_thread(run_generation_beat_extraction_in_background, gen_id)
    )

    return {"message": "비트 재추출이 시작되었습니다.", "status": "pending"}


@router.get("/{gen_id}/stream/")
async def stream_generation(
    gen_id: str,
    request: Request,
    variant: int = 0,
    current_user=Depends(get_current_user),
):
    """Proxy the generated audio file from MinIO so external clients can access it.

    v74 — accepts ?variant=<i> to stream a specific variant. variant=0 (default)
    falls back to result_audio_url for backward compatibility with older docs
    that have no `variants` array.
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    if not ObjectId.is_valid(gen_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.generations.find_one({"_id": ObjectId(gen_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if doc.get("status") != "completed" or not doc.get("result_audio_url"):
        return JSONResponse(status_code=404, content={"error": "완료된 오디오 파일이 없습니다."})

    # v74 — variant selection
    if variant < 0:
        return JSONResponse(status_code=400, content={"error": "variant는 0 이상이어야 합니다."})

    variants_field = doc.get("variants") or []
    if variant == 0:
        # BC path: prefer variants[0] if exists, else fallback to result_audio_url
        if variants_field and len(variants_field) > 0:
            object_name = variants_field[0].get("audio_url") or doc["result_audio_url"]
        else:
            object_name = doc["result_audio_url"]
    else:
        if not variants_field or variant >= len(variants_field):
            _log.warning(
                "[GenerationStream] gen_id=%s variant=%d out of range (have=%d)",
                gen_id, variant, len(variants_field),
            )
            return JSONResponse(
                status_code=400,
                content={"error": f"variant {variant} 범위를 벗어났습니다."},
            )
        object_name = variants_field[variant].get("audio_url")
        if not object_name:
            return JSONResponse(status_code=404, content={"error": "해당 variant 오디오가 없습니다."})

    _log.info(
        "[GenerationStream] gen_id=%s variant=%d object=%s",
        gen_id, variant, object_name,
    )

    title_raw = doc.get("title", "generated") or "generated"
    import re
    from urllib.parse import quote
    # ASCII-only fallback filename
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', title_raw.replace(' ', '_')) or "generated"
    ext = ".wav" if object_name.endswith(".wav") else ".mp3"
    content_type = "audio/wav" if ext == ".wav" else "audio/mpeg"
    # v74 — append variant suffix to filename when > 0
    suffix = f"_v{variant + 1}" if variant > 0 else ""
    encoded_name = quote(f"{title_raw}{suffix}{ext}")
    # v3.222 ③: attachment→inline — A/B 미리듣기는 재생용(다운로드 시트 별도). 파일명 헤더는 유지.
    disposition = f"inline; filename=\"{safe_name}{suffix}{ext}\"; filename*=UTF-8''{encoded_name}"

    minio_client = get_minio()
    try:
        # v3.222 ③: HTTP Range 지원 — tracks.py v193 stream-proxy 블록 동형 이식.
        # 기존엔 Range/Content-Length 전무 → expo-av duration 미확정으로 A/B 미리듣기 시크 불가.
        range_header = (request.headers.get("range") or "").strip()
        stat = minio_client.stat_object(settings.minio_bucket_music, object_name)
        total = stat.size
        if range_header.startswith("bytes="):
            try:
                spec = range_header[6:].split(",")[0].strip()
                start_s, _, end_s = spec.partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else total - 1
                end = min(end, total - 1)
                if start > end or start >= total:
                    return JSONResponse(status_code=416, content={"error": "요청 범위가 올바르지 않습니다."},
                                        headers={"Content-Range": f"bytes */{total}"})
                length = end - start + 1
                response = minio_client.get_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=object_name,
                    offset=start, length=length,
                )
                _log.info("[GenerationStream] range gen=%s v=%d %d-%d/%d", gen_id[:8], variant, start, end, total)
                return StreamingResponse(
                    response, status_code=206, media_type=content_type,
                    headers={
                        "Accept-Ranges": "bytes",
                        "Content-Range": f"bytes {start}-{end}/{total}",
                        "Content-Length": str(length),
                        "Content-Disposition": disposition,
                    },
                )
            except ValueError:
                _log.warning("[GenerationStream] bad range gen=%s header=%s", gen_id[:8], range_header[:40])

        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=object_name,
        )
    except Exception as _exc:
        _log.error(
            "[GenerationStream] gen_id=%s variant=%d minio get failed: %s",
            gen_id, variant, _exc,
        )
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    return StreamingResponse(
        response,
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(total),
            "Content-Disposition": disposition,
        },
    )
