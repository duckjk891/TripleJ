"""
AI Music Generation API
- POST /api/generate/lyrics   : Generate lyrics via ChatGPT
- POST /api/generate/         : Submit music generation request (saves + starts background generation)
- GET  /api/generate/         : List user's generation history
- GET  /api/generate/{id}     : Get single generation status/result
- DELETE /api/generate/{id}   : Delete generation record
"""
import asyncio
import io
import logging
import math
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.media_urls import public_presign
from ..services.points_service import POINT_COSTS, refund_points, spend_points

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate")


# ─── Request Models ─────────────────────────────────────────

class TranslateTagsRequest(BaseModel):
    tags: list[str]


class LyricsRequest(BaseModel):
    prompt: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    duration_minutes: Optional[int] = 2  # 기본 2분
    duet: Optional[bool] = False
    duet_main_vocal_style: Optional[str] = None
    duet_sub_vocal_style: Optional[str] = None
    language: Optional[str] = "ko"
    models: Optional[List[str]] = None  # e.g. ["gpt-4o-mini", "claude-opus-4-6"]


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
    duration: Optional[int] = 30  # seconds
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
    for key in ("created_at", "updated_at", "completed_at", "voice_conversion_completed_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    doc["model"] = doc.get("model", "suno")
    return doc


async def _fatigue_gate_response(user_id: str):
    """StarEcon(v158) — 디렉터 피로 게이트. 활성 쿨다운이면 429 응답, 아니면 None.

    응답: {"error":"director_fatigue", ...} + Retry-After 헤더(남은 초).
    게이트 순서는 항상 스트라이크 403 → 피로 429 → 잔액 402.
    """
    from ..services.fatigue_service import check_gate

    remaining = await check_gate(user_id)
    if remaining <= 0:
        return None
    until = datetime.now(timezone.utc) + timedelta(seconds=remaining)
    logger.info("[fatigue] compose gated user=%s remaining=%ds", user_id[:8], remaining)
    return JSONResponse(
        status_code=429,
        content={
            "error": "director_fatigue",
            "message": "디렉터가 휴식 중입니다. 쿨다운이 끝난 뒤 다시 시도하거나 스킵을 이용해주세요.",
            "cooldown_remaining_sec": remaining,
            "cooldown_until": until.isoformat(),
        },
        headers={"Retry-After": str(remaining)},
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

def _run_music_generation(generation_id: str, lyrics: str, genre: str, mood: str, style: str, vocal: str, duration: int, model: str = "suno", title: str = None, prompt: str = None, persona_id: str = None, negative_tags: str = None, style_weight: float = None, weirdness: float = None, audio_weight: float = None, persona_model: str = None, bpm: int = None, key: str = None, reference_audio_url: str = None, duet_main_vocal_style: str = None, duet_sub_vocal_style: str = None, suno_model: str = None):
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

        loop.run_until_complete(
            generate_music_suno(
                generation_id=generation_id,
                lyrics=lyrics,
                genre=genre,
                mood=mood,
                style=style,
                vocal=vocal,
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
            )
        )
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


@router.post("/lyrics/")
async def generate_lyrics_endpoint(
    body: LyricsRequest,
    current_user=Depends(get_current_user),
):
    """Generate lyrics using ChatGPT API."""
    if not body.prompt.strip():
        return JSONResponse(status_code=400, content={"error": "프롬프트를 입력해주세요."})

    if not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # StarEcon(v158) — 작사 ⭐-5 선차감 (부족 402, 실패 시 환불).
    lyrics_cost = POINT_COSTS["lyrics"]
    point_ref = uuid_lib.uuid4().hex
    user_id = current_user["id"]
    if not await spend_points(user_id, "lyrics", lyrics_cost, point_ref):
        logger.info("[star-econ] lyrics denied (insufficient) user=%s", user_id[:8])
        return JSONResponse(
            status_code=402,
            content={"error": "포인트가 부족합니다 (필요: {})".format(lyrics_cost)},
        )
    logger.info("[star-econ] lyrics spend user=%s -%d ref=%s", user_id[:8], lyrics_cost, point_ref)

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
            models=body.models,
        )
        return result
    except Exception as e:
        logger.exception("[star-econ] lyrics failed user=%s ref=%s (refunding)", user_id[:8], point_ref)
        await refund_points(user_id, "lyrics", lyrics_cost, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": f"가사 생성 실패: {str(e)[:200]}"},
        )


@router.post("/", status_code=201)
async def create_generation(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """
    Create a generation record.
    If start_music_gen=True, also starts background music generation.
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
    will_start_music = bool(body.start_music_gen and body.lyrics)
    compose_cost = POINT_COSTS["compose"]
    point_ref = None
    if will_start_music:
        fatigued = await _fatigue_gate_response(current_user["id"])
        if fatigued:
            return fatigued
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
        "duration": body.duration or 30,
        "bpm": body.bpm,
        "key": body.key,
        "instruments": body.instruments,
        "reference_style": body.reference_style,
        "lyrics": body.lyrics,
        "model": body.model or "suno",
        "suno_model": body.suno_model,
        "persona_id": body.persona_id,
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
        background_tasks.add_task(
            _run_music_generation,
            generation_id=gen_id,
            lyrics=body.lyrics,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            vocal=body.vocal,
            duration=body.duration or 30,
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
        )

    return _serialize(doc)


@router.post("/{gen_id}/start/")
async def start_music_generation(
    gen_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Start music generation for an existing generation record."""
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

    # StarEcon(v158) — 게이트 순서: 스트라이크 403(위) → 피로 429 → 잔액 402.
    fatigued = await _fatigue_gate_response(current_user["id"])
    if fatigued:
        return fatigued

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

    # Update status (+ v158: 새 선차감 추적 필드 — 실패 환불용)
    await mongo.generations.update_one(
        {"_id": ObjectId(gen_id)},
        {"$set": {
            "status": "pending", "progress": 5,
            "point_ref": point_ref, "point_cost": compose_cost, "refunded": False,
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    background_tasks.add_task(
        _run_music_generation,
        generation_id=gen_id,
        lyrics=doc.get("lyrics", ""),
        genre=doc.get("genre"),
        mood=doc.get("mood"),
        style=doc.get("style"),
        vocal=doc.get("vocal"),
        duration=doc.get("duration", 30),
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
    )

    return {"message": "음악 생성이 시작되었습니다.", "id": gen_id}


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

    minio_client = get_minio()
    try:
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

    return StreamingResponse(
        response,
        media_type=content_type,
        headers={
            "Content-Disposition": f"attachment; filename=\"{safe_name}{suffix}{ext}\"; filename*=UTF-8''{encoded_name}",
        },
    )
