"""
MV job routes — POST/GET /api/mv/jobs
v2: 잡 생성 시 백그라운드로 가사 생성을 띄우고 즉시 반환한다.
v3: 가사 ready 잡에 음악 생성 트리거(POST /jobs/{id}/music)와
     오디오 스트리밍(GET /jobs/{id}/audio) 추가.
완료/실패 시 Mongo mv_jobs 문서를 업데이트한다.
"""

import asyncio
import io
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

router = APIRouter(prefix="/api/mv")


class MVJobCreate(BaseModel):
    story_id: str
    music_spec: MusicSpec


def _serialize_job(doc: dict) -> dict:
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
        "error_message": doc.get("error_message"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
        "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
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
    if doc.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return _serialize_job(doc)


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
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "music_ready",
                    "progress": 100,
                    "audio_object_name": result["audio_object_name"],
                    "audio_variants": result["audio_variants"],
                    "suno_task_id": result["suno_task_id"],
                    "suno_audio_id": result["suno_audio_id"],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
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
    if doc.get("user_id") != current_user["id"]:
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
