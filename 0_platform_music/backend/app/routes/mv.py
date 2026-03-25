"""
MV Draft/Resume routes — create MV jobs, manage scenes, generate images/videos.
"""

import io
import logging
import math
import os
from datetime import datetime, timedelta
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..services.mv_pipeline import (
    run_phase1_and_phase2,
    run_phase2_images,
    run_phase3_videos,
    run_phase4_concatenate,
    run_phase5_merge_audio,
)
from ..services.mv_generator import generate_scene_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mv", tags=["MV"])

# Active processing statuses — used to prevent concurrent phase runs
ACTIVE_STATUSES = {
    "splitting", "generating_images", "generating_videos", "concatenating", "merging_audio",
}


# ── Request Models ───────────────────────────────────────────────────────────

class CreateMVRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    scene_prompt: Optional[str] = None
    character_object_name: Optional[str] = None
    video_model: Optional[str] = "veo"  # "veo" or "kling"
    audio_generation_id: Optional[str] = None


class GenerateImagesRequest(BaseModel):
    scene_numbers: Optional[List[int]] = None


class GenerateVideosRequest(BaseModel):
    scene_numbers: Optional[List[int]] = None
    video_model: Optional[str] = None  # override job's video_model if provided


class SaveDraftRequest(BaseModel):
    audio_generation_id: Optional[str] = None
    audio_file_name: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    tags: Optional[str] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None


class MergeAudioRequest(BaseModel):
    audio_object_name: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _validate_object_id(job_id: str) -> ObjectId:
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="유효하지 않은 작업 ID입니다.")
    return ObjectId(job_id)


async def _get_job_with_ownership(mongo_db, oid: ObjectId, user_id: str) -> dict:
    job = await mongo_db.mv_jobs.find_one({"_id": oid})
    if not job:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if job.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="이 작업에 접근할 권한이 없습니다.")
    return job


def _presign(object_name: Optional[str], bucket: Optional[str] = None) -> Optional[str]:
    """Generate a presigned URL for an object, or return None."""
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        return minio_client.presigned_get_object(
            bucket_name=bucket or settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
    except Exception:
        return None


def _scene_to_dict(scene: dict) -> dict:
    """Convert scene doc to response dict with presigned URLs."""
    result = {
        "scene_number": scene.get("scene_number"),
        "description": scene.get("description", ""),
        "lyrics_segment": scene.get("lyrics_segment", ""),
        "image_object_name": scene.get("image_object_name"),
        "image_url": _presign(scene.get("image_object_name")),
        "image_source": scene.get("image_source"),
        "video_object_name": scene.get("video_object_name"),
        "video_url": _presign(scene.get("video_object_name")),
        "video_status": scene.get("video_status", "pending"),
        "video_error": scene.get("video_error"),
    }
    # Section-aware fields (present when music structure analysis was used)
    if scene.get("use_seconds") is not None:
        result["use_seconds"] = scene["use_seconds"]
    if scene.get("section"):
        result["section"] = scene["section"]
    if scene.get("section_mood"):
        result["section_mood"] = scene["section_mood"]
    if scene.get("clip_mood"):
        result["clip_mood"] = scene["clip_mood"]
    return result


# ── POST /api/mv/create ─────────────────────────────────────────────────────

@router.post("/create")
async def create_mv(
    body: CreateMVRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Create MV draft + start scene splitting."""
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    title = body.title.strip()
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "곡 제목을 입력해주세요."},
        )

    if not body.cover_object_name:
        return JSONResponse(
            status_code=400,
            content={"error": "커버 이미지가 필요합니다. 먼저 커버를 생성해주세요."},
        )

    mongo = get_mongo()

    # Validate video model (must come before scene count calculation)
    video_model = body.video_model or "veo"
    if video_model not in ("veo", "kling"):
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 영상 모델입니다. (veo, kling)"},
        )

    # Compute dynamic scene count based on audio duration and video model
    # Veo: 8-second clips, Kling: 10-second clips
    if video_model == "kling":
        SCENE_CLIP_DURATION = 10
    else:
        SCENE_CLIP_DURATION = 8  # veo default
    if body.audio_duration_sec and body.audio_duration_sec > 0:
        scene_count = math.ceil(body.audio_duration_sec / SCENE_CLIP_DURATION)
        scene_count = max(5, min(scene_count, 60))
    else:
        scene_count = 20

    job_doc = {
        "user_id": current_user["id"],
        "title": title,
        "genre": body.genre,
        "mood": body.mood,
        "lyrics": body.lyrics,
        "cover_object_name": body.cover_object_name,
        "scene_count": scene_count,
        "audio_duration_sec": body.audio_duration_sec,
        "scene_prompt": body.scene_prompt,
        "character_object_name": body.character_object_name,
        "video_model": video_model,
        "audio_generation_id": body.audio_generation_id,
        "status": "draft",
        "progress": 0,
        "error_message": "",
        "total_scenes": 0,
        "scenes": [],
        "completed_image_count": 0,
        "completed_video_count": 0,
        "result_video_url": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    result = await mongo.mv_jobs.insert_one(job_doc)
    job_id = result.inserted_id

    # Launch phase 1 + phase 2 combined in background
    background_tasks.add_task(run_phase1_and_phase2, job_id, mongo)

    return {
        "job_id": str(job_id),
        "status": "splitting",
        "message": "MV 작업이 생성되었습니다. 장면 분할 및 이미지 생성이 시작됩니다.",
    }


# ── GET /api/mv/jobs ─────────────────────────────────────────────────────────

@router.get("/jobs")
async def list_mv_jobs(
    page: int = 1,
    limit: int = 20,
    current_user=Depends(get_current_user),
):
    """List user's MV jobs."""
    mongo = get_mongo()
    user_id = current_user["id"]

    skip = (max(page, 1) - 1) * limit
    limit = min(max(limit, 1), 100)

    cursor = mongo.mv_jobs.find(
        {"user_id": user_id},
    ).sort("created_at", -1).skip(skip).limit(limit)

    jobs = []
    async for job in cursor:
        # Get first scene thumbnail
        thumbnail_url = None
        scenes = job.get("scenes", [])
        if scenes:
            for s in scenes:
                if s.get("image_object_name"):
                    thumbnail_url = _presign(s["image_object_name"])
                    break

        # Fall back to cover image if no scene thumbnail yet
        if not thumbnail_url and job.get("cover_object_name"):
            thumbnail_url = _presign(job["cover_object_name"])

        jobs.append({
            "job_id": str(job["_id"]),
            "title": job.get("title", ""),
            "status": job.get("status", "draft"),
            "progress": job.get("progress", 0),
            "total_scenes": job.get("total_scenes", 0),
            "completed_image_count": job.get("completed_image_count", 0),
            "completed_video_count": job.get("completed_video_count", 0),
            "cover_object_name": job.get("cover_object_name"),
            "thumbnail_url": thumbnail_url,
            "result_video_url": _presign(job.get("result_video_url")),
            "result_music_video_url": _presign(job.get("result_music_video_url")),
            "error_message": job.get("error_message", ""),
            "created_at": job.get("created_at", "").isoformat() if job.get("created_at") else None,
            "updated_at": job.get("updated_at", "").isoformat() if job.get("updated_at") else None,
        })

    total = await mongo.mv_jobs.count_documents({"user_id": user_id})

    return {
        "jobs": jobs,
        "total": total,
        "page": page,
        "limit": limit,
    }


# ── GET /api/mv/jobs/{job_id} ────────────────────────────────────────────────

@router.get("/jobs/{job_id}")
async def get_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Get full job details with all scenes."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes_response = [_scene_to_dict(s) for s in job.get("scenes", [])]

    return {
        "job_id": str(job["_id"]),
        "title": job.get("title", ""),
        "genre": job.get("genre"),
        "mood": job.get("mood"),
        "lyrics": job.get("lyrics"),
        "cover_object_name": job.get("cover_object_name"),
        "cover_url": _presign(job.get("cover_object_name")),
        "status": job.get("status", "draft"),
        "progress": job.get("progress", 0),
        "error_message": job.get("error_message", ""),
        "total_scenes": job.get("total_scenes", 0),
        "completed_image_count": job.get("completed_image_count", 0),
        "completed_video_count": job.get("completed_video_count", 0),
        "scenes": scenes_response,
        "result_video_url": _presign(job.get("result_video_url")),
        "result_object_name": job.get("result_video_url"),
        "result_music_video_url": _presign(job.get("result_music_video_url")),
        "result_music_video_object_name": job.get("result_music_video_url"),
        "retry_info": job.get("retry_info"),
        "scene_prompt": job.get("scene_prompt"),
        "character_object_name": job.get("character_object_name"),
        "video_model": job.get("video_model", "veo"),
        "music_sections": job.get("music_sections"),
        # Draft form fields (for restoring the upload page)
        "audio_generation_id": job.get("audio_generation_id"),
        "audio_file_name": job.get("audio_file_name"),
        "tags": job.get("tags"),
        "prompt": job.get("prompt"),
        "ai_model": job.get("ai_model"),
        "created_at": job.get("created_at", "").isoformat() if job.get("created_at") else None,
        "updated_at": job.get("updated_at", "").isoformat() if job.get("updated_at") else None,
    }


# ── POST /api/mv/jobs/{job_id}/generate-images ──────────────────────────────

@router.post("/jobs/{job_id}/generate-images")
async def generate_images(
    job_id: str,
    body: GenerateImagesRequest = GenerateImagesRequest(),
    background_tasks: BackgroundTasks = None,
    current_user=Depends(get_current_user),
):
    """Generate images for scenes without images (or regenerate specific scenes)."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("scenes"):
        return JSONResponse(
            status_code=400,
            content={"error": "장면 데이터가 없습니다. 먼저 장면 분할을 실행하세요."},
        )

    background_tasks.add_task(run_phase2_images, oid, mongo, body.scene_numbers)

    return {
        "job_id": job_id,
        "status": "generating_images",
        "message": "이미지 생성이 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/upload-image ────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/upload-image")
async def upload_scene_image(
    job_id: str,
    scene_number: int,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload custom image for a scene."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes", [])
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break

    if scene_idx is None:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 장면을 찾을 수 없습니다."},
        )

    # Validate file
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        return JSONResponse(
            status_code=400,
            content={"error": "허용되지 않는 이미지 형식입니다. (jpg, png, webp)"},
        )

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지 크기는 10MB 이하여야 합니다."},
        )

    # Save to MinIO
    object_name = "mv/{}/scenes/{:03d}.png".format(str(oid), scene_number)
    minio_client = get_minio()
    content_type = "image/png" if ext == ".png" else "image/jpeg"

    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Update scene
    scenes[scene_idx]["image_object_name"] = object_name
    scenes[scene_idx]["image_source"] = "upload"

    # If scene already has a completed video, reset video_status
    if scenes[scene_idx].get("video_status") == "completed":
        scenes[scene_idx]["video_status"] = "pending"
        scenes[scene_idx]["video_object_name"] = None
        scenes[scene_idx]["video_error"] = None

    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "scene_number": scene_number,
        "image_object_name": object_name,
        "image_url": _presign(object_name),
        "message": "이미지가 업로드되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/regenerate-image ────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/regenerate-image")
async def regenerate_scene_image_endpoint(
    job_id: str,
    scene_number: int,
    current_user=Depends(get_current_user),
):
    """Regenerate single scene image (synchronous)."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    scenes = job.get("scenes", [])
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            break

    if scene_idx is None:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 장면을 찾을 수 없습니다."},
        )

    # Load cover image for style reference
    cover_image_bytes = None
    if job.get("cover_object_name"):
        try:
            minio_client = get_minio()
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=job["cover_object_name"],
            )
            cover_image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Failed to load cover image: %s", e)

    # Load character image for character reference
    character_image_bytes = None
    if job.get("character_object_name"):
        try:
            if not minio_client:
                minio_client = get_minio()
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=job["character_object_name"],
            )
            character_image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Failed to load character image: %s", e)

    # Generate image (synchronous — single Gemini call)
    try:
        img_bytes = await generate_scene_image(
            scenes[scene_idx]["description"],
            cover_image_bytes=cover_image_bytes,
            character_image_bytes=character_image_bytes,
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 생성 실패: {}".format(str(e)[:200])},
        )

    # Save to MinIO
    object_name = "mv/{}/scenes/{:03d}.png".format(str(oid), scene_number)
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(img_bytes),
        length=len(img_bytes),
        content_type="image/png",
    )

    # Update scene
    scenes[scene_idx]["image_object_name"] = object_name
    scenes[scene_idx]["image_source"] = "gemini"

    # Reset video if it was completed (image changed)
    if scenes[scene_idx].get("video_status") == "completed":
        scenes[scene_idx]["video_status"] = "pending"
        scenes[scene_idx]["video_object_name"] = None
        scenes[scene_idx]["video_error"] = None

    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "scene_number": scene_number,
        "image_object_name": object_name,
        "image_url": _presign(object_name),
        "message": "이미지가 재생성되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/generate-videos ──────────────────────────────

@router.post("/jobs/{job_id}/generate-videos")
async def generate_videos(
    job_id: str,
    body: GenerateVideosRequest = GenerateVideosRequest(),
    background_tasks: BackgroundTasks = None,
    current_user=Depends(get_current_user),
):
    """Start/resume video generation. Pauses on 429 instead of failing."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("scenes"):
        return JSONResponse(
            status_code=400,
            content={"error": "장면 데이터가 없습니다."},
        )

    # Check that at least some scenes have images
    scenes_with_images = [s for s in job["scenes"] if s.get("image_object_name")]
    if not scenes_with_images:
        return JSONResponse(
            status_code=400,
            content={"error": "이미지가 생성된 장면이 없습니다. 먼저 이미지를 생성하세요."},
        )

    # Determine video_model: request override > job setting > default
    video_model = body.video_model or job.get("video_model", "veo")

    # Update job's video_model if overridden
    if body.video_model and body.video_model != job.get("video_model"):
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {"$set": {"video_model": video_model, "updated_at": datetime.utcnow()}},
        )

    background_tasks.add_task(run_phase3_videos, oid, mongo, body.scene_numbers, video_model)

    return {
        "job_id": job_id,
        "status": "generating_videos",
        "message": "비디오 생성이 시작되었습니다. (모델: {})".format(video_model),
    }


# ── POST /api/mv/jobs/{job_id}/concatenate ───────────────────────────────────

@router.post("/jobs/{job_id}/concatenate")
async def concatenate(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Manually trigger video concatenation."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    completed_videos = [
        s for s in job.get("scenes", [])
        if s.get("video_status") == "completed" and s.get("video_object_name")
    ]

    if not completed_videos:
        return JSONResponse(
            status_code=400,
            content={"error": "합칠 완료된 비디오가 없습니다."},
        )

    background_tasks.add_task(run_phase4_concatenate, oid, mongo)

    return {
        "job_id": job_id,
        "status": "concatenating",
        "message": "비디오 합치기가 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/merge-audio ────────────────────────────────────

@router.post("/jobs/{job_id}/merge-audio")
async def merge_audio(
    job_id: str,
    body: MergeAudioRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Merge audio track with the final video to create a music video."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "이 작업은 현재 처리 중입니다. 완료 후 다시 시도하세요."},
        )

    if not job.get("result_video_url"):
        return JSONResponse(
            status_code=400,
            content={"error": "합칠 영상이 없습니다. 먼저 영상 생성을 완료하세요."},
        )

    background_tasks.add_task(run_phase5_merge_audio, oid, mongo, body.audio_object_name)

    return {
        "job_id": job_id,
        "status": "merging_audio",
        "message": "뮤직비디오 음악 합치기가 시작되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/save-draft ─────────────────────────────────────

@router.post("/jobs/{job_id}/save-draft")
async def save_draft(
    job_id: str,
    body: SaveDraftRequest,
    current_user=Depends(get_current_user),
):
    """Save additional form fields so the upload page can be fully restored."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    await _get_job_with_ownership(mongo, oid, current_user["id"])

    update_fields = {"updated_at": datetime.utcnow()}
    # Only set fields that were provided (not None)
    for field in (
        "audio_generation_id", "audio_file_name",
        "genre", "mood", "tags", "prompt", "ai_model",
    ):
        val = getattr(body, field, None)
        if val is not None:
            update_fields[field] = val

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": update_fields},
    )

    return {
        "job_id": job_id,
        "message": "임시저장이 완료되었습니다.",
    }


# ── POST /api/mv/jobs/{job_id}/cancel ──────────────────────────────────────────

@router.post("/jobs/{job_id}/cancel")
async def cancel_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Cancel an in-progress MV generation. Pipeline checks this flag between scenes."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    current_status = job.get("status", "")
    if current_status not in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=400,
            content={"error": f"현재 상태({current_status})에서는 중지할 수 없습니다."},
        )

    # Set cancelled flag — pipeline loops check this between iterations
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "cancel_requested": True,
            "updated_at": datetime.utcnow(),
        }},
    )

    return {
        "job_id": job_id,
        "message": "중지 요청이 전송되었습니다. 현재 처리 중인 씬 완료 후 중지됩니다.",
    }


# ── DELETE /api/mv/jobs/{job_id} ─────────────────────────────────────────────

@router.delete("/jobs/{job_id}")
async def delete_mv_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Delete job and all associated MinIO objects."""
    mongo = get_mongo()
    oid = _validate_object_id(job_id)
    job = await _get_job_with_ownership(mongo, oid, current_user["id"])

    if job.get("status") in ACTIVE_STATUSES:
        return JSONResponse(
            status_code=409,
            content={"error": "처리 중인 작업은 삭제할 수 없습니다."},
        )

    minio_client = get_minio()

    # Delete all objects under mv/{job_id}/ prefix
    prefix = "mv/{}/".format(str(oid))
    try:
        objects = minio_client.list_objects(
            bucket_name=settings.minio_bucket_images,
            prefix=prefix,
            recursive=True,
        )
        from minio.deleteobjects import DeleteObject
        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        if delete_list:
            errors = minio_client.remove_objects(
                bucket_name=settings.minio_bucket_images,
                delete_object_list=delete_list,
            )
            for err in errors:
                logger.warning("Failed to delete MinIO object: %s", err)
    except Exception as e:
        logger.warning("Failed to clean up MinIO objects for job %s: %s", job_id, e)

    # Delete MongoDB document
    await mongo.mv_jobs.delete_one({"_id": oid})

    return {
        "job_id": job_id,
        "message": "작업이 삭제되었습니다.",
    }


# ── GET /api/mv/models ───────────────────────────────────────────────────────

@router.get("/models")
async def list_video_models():
    """List available video generation models."""
    models = [
        {
            "id": "veo",
            "name": "Veo 3.1",
            "provider": "Google",
            "description": "고품질 8초 영상 생성 (Google Veo 3.1)",
            "duration": "8초",
            "available": bool(settings.google_api_key),
        },
        {
            "id": "kling",
            "name": "Kling V3",
            "provider": "Kling AI",
            "description": "이미지 기반 10초 영상 생성 (Kling AI)",
            "duration": "10초",
            "available": bool(settings.kling_access_key and settings.kling_secret_key),
        },
    ]
    return {"models": models}
