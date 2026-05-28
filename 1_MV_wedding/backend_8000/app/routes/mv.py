"""
MV job routes — POST/GET /api/mv/jobs
v2: 잡 생성 시 백그라운드로 가사 생성을 띄우고 즉시 반환한다.
v3: 가사 ready 잡에 음악 생성 트리거(POST /jobs/{id}/music)와
     오디오 스트리밍(GET /jobs/{id}/audio) 추가.
완료/실패 시 Mongo mv_jobs 문서를 업데이트한다.
"""

import asyncio
import io
import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..models.story import MusicSpec
from ..services.lyrics_generator import generate_wedding_lyrics
from ..services.suno_generator import generate_music_for_job
from ..services.suno_timestamp_service import get_suno_timestamps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mv")


class MVJobCreate(BaseModel):
    story_id: str
    music_spec: MusicSpec


def _serialize_job(doc: dict) -> dict:
    admin_requested_at = doc.get("admin_requested_at")
    # v19 — variant 별 timestamps. dict("1": [...], "2": [...]).
    lyric_timestamps_variants = doc.get("lyric_timestamps_variants") or {}
    variants_count: dict[str, int] = {}
    if isinstance(lyric_timestamps_variants, dict):
        for k, v in lyric_timestamps_variants.items():
            if isinstance(v, list):
                variants_count[str(k)] = len(v)
    return {
        "job_id": str(doc["_id"]),
        "user_id": doc.get("user_id"),
        "story_id": doc.get("story_id"),
        "music_spec": doc.get("music_spec"),
        "status": doc.get("status", "queued"),
        "progress": doc.get("progress", 0),
        "lyrics": doc.get("lyrics"),
        "audio_object_name": doc.get("audio_object_name"),
        "audio_variants": doc.get("audio_variants") or [],
        "suno_task_id": doc.get("suno_task_id"),
        # v19 — 두 variant 의 audio_id (list). 회귀 호환 위해 단수 필드도 그대로.
        "suno_audio_ids": doc.get("suno_audio_ids") or [],
        # v17.0 — 라인별 timestamp (Phase 0 매핑 입력). 없으면 빈 배열.
        "lyric_timestamps": doc.get("lyric_timestamps") or [],
        "lyric_timestamps_status": doc.get("lyric_timestamps_status") or (
            "ready" if (doc.get("lyric_timestamps") or []) else "missing"
        ),
        # v19 — variant 별 segments 카운트 (실 본문은 무거우므로 카운트만 노출).
        "lyric_timestamps_variants_count": variants_count,
        "error_message": doc.get("error_message"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
        "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
        "admin_requested": bool(doc.get("admin_requested", False)),
        "admin_requested_at": admin_requested_at.isoformat()
        if isinstance(admin_requested_at, datetime)
        else admin_requested_at,
    }


async def _run_lyrics_generation(job_id: str) -> None:
    """
    Background task: load story → call generate_wedding_lyrics → update mv_jobs doc.
    실패 시 status="lyrics_failed" + error_message 기록.
    """
    mongo = get_mongo()
    try:
        job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            return  # 잡이 사라진 경우 (삭제 등) — 조용히 종료

        story_id = job.get("story_id")
        if not story_id:
            raise ValueError("job has no story_id")

        try:
            story_oid = ObjectId(story_id)
        except (InvalidId, TypeError) as e:
            raise ValueError(f"invalid story_id: {story_id}") from e

        story = await mongo.stories.find_one({"_id": story_oid})
        if not story:
            raise ValueError("story not found")

        music_spec = job.get("music_spec") or {}
        lyrics = await generate_wedding_lyrics(
            story=story,
            music=music_spec,
            model=music_spec.get("model"),
        )

        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "lyrics_ready",
                    "progress": 100,
                    "lyrics": lyrics,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
    except Exception as e:
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "lyrics_failed",
                    "error_message": str(e)[:500],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


@router.post("/jobs")
async def create_job(body: MVJobCreate, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": current_user["id"],
        "story_id": body.story_id,
        "music_spec": body.music_spec.model_dump(),
        "status": "generating_lyrics",
        "progress": 0,
        "lyrics": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await mongo.mv_jobs.insert_one(doc)
    job_id = str(result.inserted_id)

    # background lyrics generation (fire-and-forget; FastAPI 요청 종료 후에도 살아남는다)
    asyncio.create_task(_run_lyrics_generation(job_id))

    return {"job_id": job_id, "status": "generating_lyrics"}


@router.get("/jobs")
async def list_jobs(current_user=Depends(get_current_user)):
    mongo = get_mongo()
    cursor = mongo.mv_jobs.find({"user_id": current_user["id"]}).sort("created_at", -1)
    jobs = [_serialize_job(d) async for d in cursor]
    return {"jobs": jobs}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    # v12.1 — admin role 은 다른 사용자의 job 디테일 조회 허용 (요청작 페이지에서 상세보기 진입).
    is_owner = doc.get("user_id") == current_user["id"]
    is_admin = current_user.get("role") == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return _serialize_job(doc)


def _serialize_wedding_photo_asset(d: dict) -> dict:
    """v13 — shape a wedding_assets (type=wedding_photo) doc for /context view."""
    obj = d.get("object_name") or ""
    created = d.get("created_at")
    return {
        "photo_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "object_name": obj or None,
        "preview_url": ("/api/character/preview/" + obj) if obj else None,
        "meta": d.get("meta") or {},
        "created_at": created.isoformat() if isinstance(created, datetime) else created,
    }


@router.get("/jobs/{job_id}/context")
async def get_job_context(job_id: str, current_user=Depends(get_current_user)):
    """v13 — 웨딩사진 패널용 컨텍스트.

    작품 소유자의 시트 4슬롯 + 장소 자산 + 이 작품에 등록된 웨딩사진 자산을
    한 번에 반환한다. 멘션 옵션 풀 빌드와 갤러리 초기 로딩에 쓰인다.
    가드: owner OR admin.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[MVRoute] /context entry user_id=%s is_admin=%s job_id=%s",
        user_id, is_admin, job_id,
    )
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] /context invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")
    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": oid})
    if not job:
        logger.warning(
            "[MVRoute] /context not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    is_owner = job.get("user_id") == user_id
    if not is_owner and not is_admin:
        logger.warning(
            "[MVRoute] /context forbidden user_id=%s job_id=%s owner=%s",
            user_id, job_id, job.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    owner_user_id = job.get("user_id")

    # 시트 4슬롯 (없는 슬롯은 skip).
    cs_doc = await mongo.wedding_character_sheets.find_one(
        {"user_id": owner_user_id}
    )
    owner_sheets: list[dict] = []
    for slot in ("groom_casual", "groom_wedding", "bride_casual", "bride_wedding"):
        sd = ((cs_doc or {}).get("sheets") or {}).get(slot)
        if not sd:
            continue
        owner_sheets.append({
            "slot": slot,
            "display_name": (sd.get("display_name") or "").strip() or slot,
            "sheet_object_name": sd.get("sheet_object_name") or "",
        })

    # 장소 자산.
    owner_places: list[dict] = []
    async for d in mongo.wedding_assets.find({
        "user_id": owner_user_id, "type": "place",
    }).sort("created_at", -1):
        owner_places.append({
            "place_id": str(d.get("_id")) if d.get("_id") is not None else None,
            "display_name": d.get("display_name") or "",
            "memo": (d.get("meta") or {}).get("memo") or "",
            "object_name": d.get("object_name") or "",
        })

    # 이 mv_job 의 웨딩사진 자산.
    photos: list[dict] = []
    async for d in mongo.wedding_assets.find({
        "user_id": owner_user_id,
        "type": "wedding_photo",
        "meta.mv_job_id": job_id,
    }).sort("created_at", -1):
        photos.append(_serialize_wedding_photo_asset(d))

    logger.info(
        "[MVRoute] /context ok user_id=%s is_admin=%s job_id=%s owner_user_id=%s "
        "sheets=%d places=%d photos=%d",
        user_id, is_admin, job_id, owner_user_id,
        len(owner_sheets), len(owner_places), len(photos),
    )
    return {
        "owner_user_id": owner_user_id,
        "owner_sheets": owner_sheets,
        "owner_places": owner_places,
        "wedding_photos": photos,
    }


async def _run_music_generation(job_id: str) -> None:
    """
    Background task: load job → call generate_music_for_job → update mv_jobs doc.
    실패 시 status="music_failed" + error_message 기록.
    """
    mongo = get_mongo()
    try:
        job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            return  # 잡이 사라진 경우 (삭제 등) — 조용히 종료
        lyrics = job.get("lyrics") or {}
        lyrics_body = lyrics.get("body") or ""
        lyrics_title = lyrics.get("title")
        music_spec = job.get("music_spec") or {}
        if not lyrics_body.strip():
            raise ValueError("lyrics body is empty — cannot generate music")

        result = await generate_music_for_job(
            job_id=job_id,
            lyrics_body=lyrics_body,
            lyrics_title=lyrics_title,
            music_spec=music_spec,
            mongo_db=mongo,
        )

        # v19 — Suno timestamped-lyrics best-effort fetch (두 variant 다).
        # 실패해도 음악 자체는 ready 로 처리(timestamps 없으면 Phase 0 만 차단).
        suno_task_id = result.get("suno_task_id") or ""
        suno_audio_id = result.get("suno_audio_id") or ""
        suno_audio_ids: list[str] = list(result.get("suno_audio_ids") or [])
        # 회귀 안전망 — 단수만 있고 list 가 비었으면 list 로 승격.
        if not suno_audio_ids and suno_audio_id:
            suno_audio_ids = [suno_audio_id]

        ts_by_variant: dict[str, list[dict]] = {}
        for idx, aid in enumerate(suno_audio_ids, start=1):
            if not aid:
                continue
            try:
                logger.info(
                    "[MVRoute] action=fetch_timestamps entry job_id=%s variant=%d "
                    "suno_task_id=%s suno_audio_id=%s",
                    job_id, idx, suno_task_id, aid,
                )
                ts = await get_suno_timestamps(suno_task_id, aid)
                if ts:
                    ts_by_variant[str(idx)] = ts
                logger.info(
                    "[MVRoute] timestamps backfill mv_job=%s variant=%d segments=%d",
                    job_id, idx, len(ts or []),
                )
            except Exception as ts_err:
                # get_suno_timestamps 는 자체적으로 빈 리스트를 반환하지만, 만일의 경우 보호.
                logger.exception(
                    "[MVRoute] action=fetch_timestamps failed job_id=%s variant=%d "
                    "err=%s: %s",
                    job_id, idx, type(ts_err).__name__, str(ts_err)[:200],
                )

        timestamps_status = "ready" if ts_by_variant else "missing"

        update_doc: dict = {
            "status": "music_ready",
            "progress": 100,
            "audio_object_name": result["audio_object_name"],
            "audio_variants": result["audio_variants"],
            "suno_task_id": result["suno_task_id"],
            "suno_audio_id": result["suno_audio_id"],
            "suno_audio_ids": suno_audio_ids,
            "lyric_timestamps_variants": ts_by_variant,
            "lyric_timestamps_status": timestamps_status,
            "updated_at": datetime.now(timezone.utc),
        }
        # 회귀 호환: 기존 lyric_timestamps 단수 필드 = variant 1 (있으면).
        if ts_by_variant.get("1"):
            update_doc["lyric_timestamps"] = ts_by_variant["1"]
        else:
            update_doc["lyric_timestamps"] = []

        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": update_doc},
        )
    except Exception as e:
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "music_failed",
                    "error_message": str(e)[:500],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


@router.post("/jobs/{job_id}/music")
async def start_music_generation(job_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    if doc.get("status") != "lyrics_ready":
        raise HTTPException(
            status_code=409,
            detail="가사 생성이 끝난 잡에서만 음악을 만들 수 있습니다.",
        )

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "generating_music",
                "progress": 0,
                "error_message": None,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    asyncio.create_task(_run_music_generation(job_id))

    return {"job_id": job_id, "status": "generating_music"}


@router.get("/jobs/{job_id}/audio")
async def get_job_audio(
    job_id: str,
    variant: int = 1,
    current_user=Depends(get_current_user),
):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    # v12.1 — admin role 은 다른 사용자 작품의 오디오 재생 허용 (요청작 페이지 재생).
    is_owner = doc.get("user_id") == current_user["id"]
    is_admin = current_user.get("role") == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    variants = doc.get("audio_variants") or []
    if not variants:
        raise HTTPException(status_code=404, detail="아직 음악이 준비되지 않았습니다.")
    idx = max(1, int(variant)) - 1
    if idx >= len(variants):
        raise HTTPException(status_code=404, detail=f"variant {variant} 가 없습니다.")
    object_name = variants[idx]

    minio_client = get_minio()
    try:
        stream = minio_client.get_object(settings.minio_bucket_audio, object_name)
        data = stream.read()
        stream.close()
        stream.release_conn()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"오디오 로드 실패: {e}")

    return StreamingResponse(io.BytesIO(data), media_type="audio/mpeg")


@router.post("/jobs/{job_id}/request-admin")
async def request_admin_review(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v12: 사용자가 자기 작품을 관리자 검토 목록에 올린다 (멱등)."""
    user_id = current_user.get("id")
    logger.info(
        "[MVRoute] POST /jobs/{job_id}/request-admin entry user_id=%s job_id=%s action=request_admin",
        user_id,
        job_id,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] request_admin reject invalid job_id user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] request_admin reject not_found user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] request_admin reject forbidden user_id=%s job_id=%s owner=%s",
            user_id,
            job_id,
            doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    now = datetime.now(timezone.utc)
    try:
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "admin_requested": True,
                    "admin_requested_at": now,
                    "updated_at": now,
                }
            },
        )
    except Exception as e:
        logger.error(
            "[MVRoute] request_admin update failed user_id=%s job_id=%s: %s: %s",
            user_id,
            job_id,
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="관리자 요청에 실패했습니다.")

    updated = await mongo.mv_jobs.find_one({"_id": oid})
    logger.info(
        "[MVRoute] POST /jobs/{job_id}/request-admin ok user_id=%s job_id=%s action=request_admin",
        user_id,
        job_id,
    )
    return _serialize_job(updated)


@router.delete("/jobs/{job_id}/request-admin")
async def cancel_admin_review(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v12: 사용자가 관리자 검토 요청을 취소한다 (멱등)."""
    user_id = current_user.get("id")
    logger.info(
        "[MVRoute] DELETE /jobs/{job_id}/request-admin entry user_id=%s job_id=%s action=cancel_admin",
        user_id,
        job_id,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] cancel_admin reject invalid job_id user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] cancel_admin reject not_found user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] cancel_admin reject forbidden user_id=%s job_id=%s owner=%s",
            user_id,
            job_id,
            doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    now = datetime.now(timezone.utc)
    try:
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "admin_requested": False,
                    "updated_at": now,
                },
                "$unset": {
                    "admin_requested_at": "",
                },
            },
        )
    except Exception as e:
        logger.error(
            "[MVRoute] cancel_admin update failed user_id=%s job_id=%s: %s: %s",
            user_id,
            job_id,
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="관리자 요청 취소에 실패했습니다.")

    updated = await mongo.mv_jobs.find_one({"_id": oid})
    logger.info(
        "[MVRoute] DELETE /jobs/{job_id}/request-admin ok user_id=%s job_id=%s action=cancel_admin",
        user_id,
        job_id,
    )
    return _serialize_job(updated)
