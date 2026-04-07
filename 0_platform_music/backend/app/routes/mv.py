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
        "image_prompt": scene.get("image_prompt") or scene.get("description", ""),
        "video_prompt": scene.get("video_prompt", ""),
        "description_ko": scene.get("description_ko", ""),
        "lyrics_segment": scene.get("lyrics_segment", ""),
        "image_object_name": scene.get("image_object_name"),
        "image_url": _presign(scene.get("image_object_name")),
        "image_source": scene.get("image_source"),
        "video_object_name": scene.get("video_object_name"),
        "video_url": _presign(scene.get("video_object_name")),
        "video_with_audio_url": _presign(scene.get("video_with_audio_object")),
        "video_synclabs_url": _presign(scene.get("video_synclabs_object")),
        "video_with_audio_synclabs_url": _presign(scene.get("video_with_audio_synclabs_object")),
        "video_status": scene.get("video_status", "pending"),
        "video_error": scene.get("video_error"),
        "sync_error": scene.get("sync_error"),
        "video_source": scene.get("video_source"),
    }
    # Section-aware fields (present when music structure analysis was used)
    if scene.get("use_seconds") is not None:
        result["use_seconds"] = scene["use_seconds"]
    if scene.get("section"):
        result["section"] = scene["section"]
    if scene.get("section_mood"):
        result["section_mood"] = scene["section_mood"]
    if scene.get("scene_type"):
        result["scene_type"] = scene["scene_type"]
    if scene.get("section_start") is not None:
        result["section_start"] = scene["section_start"]
    if scene.get("section_end") is not None:
        result["section_end"] = scene["section_end"]
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
        "scenario": None,
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
        "synclabs_total": job.get("synclabs_total"),
        "synclabs_completed": job.get("synclabs_completed"),
        "scenario": job.get("scenario"),
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
        scene_desc = scenes[scene_idx].get("image_prompt") or scenes[scene_idx].get("description", "")
        img_bytes = await generate_scene_image(
            scene_desc,
            cover_image_bytes=cover_image_bytes,
            character_image_bytes=character_image_bytes,
            scene_type=scenes[scene_idx].get("scene_type", "drama"),
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


# ── Single-scene video generation helpers ───────────────────────────────────

async def _generate_single_scene_video(job_id, scene_number, mongo_db):
    """Generate video for a single scene."""
    from bson import ObjectId
    job = await mongo_db.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return

    scenes = job.get("scenes", [])
    scene_idx = None
    scene = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            scene = s
            break

    if scene is None or not scene.get("image_object_name"):
        return

    # Recalculate section_start/section_end if missing for this scene
    if scene.get("section_start") is None:
        scenes_sorted = sorted(scenes, key=lambda x: x.get("scene_number", 0))
        cumulative = 0.0
        for s in scenes_sorted:
            use_sec = s.get("use_seconds", 10.0)
            s["section_start"] = round(cumulative, 3)
            s["section_end"] = round(cumulative + float(use_sec), 3)
            cumulative += float(use_sec)
        # Update the reference — scene is already in scenes list
        scene = scenes_sorted[scene_idx] if scene_idx < len(scenes_sorted) else scene
        # Also find correct scene after sorting
        for s in scenes_sorted:
            if s.get("scene_number") == scene_number:
                scene = s
                break

    try:
        from ..database.minio import get_minio
        from ..config import settings
        minio_client = get_minio()

        # Load scene image
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=scene["image_object_name"],
        )
        image_bytes = resp.read()
        resp.close(); resp.release_conn()

        # Load previous scene image (if exists)
        prev_scene_image_bytes = None
        if scene_idx > 0:
            prev_scene = scenes[scene_idx - 1]
            prev_img_obj = prev_scene.get("image_object_name")
            if prev_img_obj:
                try:
                    resp = minio_client.get_object(
                        bucket_name=settings.minio_bucket_images,
                        object_name=prev_img_obj,
                    )
                    prev_scene_image_bytes = resp.read()
                    resp.close(); resp.release_conn()
                except Exception:
                    pass

        # Load character sheet
        character_image_bytes = None
        char_obj = job.get("character_object_name")
        if char_obj:
            try:
                resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=char_obj,
                )
                character_image_bytes = resp.read()
                resp.close(); resp.release_conn()
            except Exception:
                pass

        # Generate video via Kling
        from ..services.kling_video_generator import start_scene_video_kling, check_scene_video_status_kling, download_video_kling
        import asyncio

        scene_desc = scene.get("image_prompt") or scene.get("description", "")
        task_id = await start_scene_video_kling(
            prompt=scene_desc,
            image_bytes=image_bytes,
            prev_scene_image_bytes=prev_scene_image_bytes,
            character_image_bytes=character_image_bytes,
            lyrics_segment=scene.get("lyrics_segment", ""),
            scene_type=scene.get("scene_type", "drama"),
            duration=float(scene.get("use_seconds", 10)),
        )

        # Poll for completion (max 10 min)
        for attempt in range(120):
            await asyncio.sleep(5)
            status_result = await check_scene_video_status_kling(task_id)

            if status_result.get("done"):
                video_url = status_result.get("video_url")
                if video_url:
                    # Download and save to MinIO
                    video_bytes = await download_video_kling(video_url)
                    video_object = "mv/{}/scenes/{:03d}_video.mp4".format(job_id, scene_number)
                    minio_client.put_object(
                        bucket_name=settings.minio_bucket_images,
                        object_name=video_object,
                        data=io.BytesIO(video_bytes),
                        length=len(video_bytes),
                        content_type="video/mp4",
                    )
                    scenes[scene_idx]["video_object_name"] = video_object
                    scenes[scene_idx]["video_status"] = "completed"
                    scenes[scene_idx]["video_error"] = None

                    # [DISABLED] Phase 3.5: 자동 Sync Labs 제거 — 사용자가 retry-sync로 수동 선택
                    # Kling 원본 영상을 유지하고, 음악만 합침

                    # ── Merge video with audio segment ──────────────────
                    try:
                        from ..services.mv_pipeline import _resolve_audio_object_name as _resolve_audio
                        audio_obj_name = await _resolve_audio(job, mongo_db)
                        if audio_obj_name and scene.get("section_start") is not None:
                            audio_resp = minio_client.get_object(
                                bucket_name=settings.minio_bucket_music,
                                object_name=audio_obj_name,
                            )
                            full_audio = audio_resp.read()
                            audio_resp.close(); audio_resp.release_conn()

                            # Read the final video (may have been replaced by Sync Labs)
                            vid_resp = minio_client.get_object(
                                bucket_name=settings.minio_bucket_images,
                                object_name=video_object,
                            )
                            final_vid_bytes = vid_resp.read()
                            vid_resp.close(); vid_resp.release_conn()

                            import tempfile, subprocess
                            with tempfile.TemporaryDirectory() as tmpdir:
                                vid_path = os.path.join(tmpdir, "video.mp4")
                                aud_path = os.path.join(tmpdir, "audio.mp3")
                                out_path = os.path.join(tmpdir, "merged.mp4")

                                with open(vid_path, "wb") as f:
                                    f.write(final_vid_bytes)
                                with open(aud_path, "wb") as f:
                                    f.write(full_audio)

                                start = scene["section_start"]
                                end = scene["section_end"]

                                # 가사 자막 생성 (Whisper 타이밍 추출)
                                from ..services.subtitle_generator import generate_scene_lyrics_ass
                                timestamps = None
                                if scene.get("lyrics_segment"):
                                    try:
                                        from ..services.sync_labs_service import cut_audio_segment
                                        from ..services.whisper_service import get_lyrics_timestamps
                                        segment_audio = cut_audio_segment(full_audio, start, end)
                                        timestamps = get_lyrics_timestamps(segment_audio)
                                    except Exception as whisper_err:
                                        logger.warning("Whisper timing failed: %s", str(whisper_err)[:200])
                                ass_content = generate_scene_lyrics_ass(scene, timestamps=timestamps)
                                if ass_content:
                                    ass_path = os.path.join(tmpdir, "lyrics.ass")
                                    with open(ass_path, "w", encoding="utf-8") as f:
                                        f.write(ass_content)
                                    ass_filter = ass_path.replace("\\", "/").replace(":", "\\:")
                                    subprocess.run(
                                        ["ffmpeg", "-y",
                                         "-i", vid_path,
                                         "-ss", str(start), "-to", str(end), "-i", aud_path,
                                         "-vf", "ass={}".format(ass_filter),
                                         "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                                         "-c:a", "aac",
                                         "-map", "0:v:0", "-map", "1:a:0",
                                         "-shortest", out_path],
                                        capture_output=True, timeout=60,
                                    )
                                else:
                                    subprocess.run(
                                        ["ffmpeg", "-y",
                                         "-i", vid_path,
                                         "-ss", str(start), "-to", str(end), "-i", aud_path,
                                         "-c:v", "copy", "-c:a", "aac",
                                         "-map", "0:v:0", "-map", "1:a:0",
                                         "-shortest", out_path],
                                        capture_output=True, timeout=30,
                                    )

                                if os.path.exists(out_path):
                                    with open(out_path, "rb") as f:
                                        merged = f.read()
                                    merged_object = "mv/{}/scenes/{:03d}_video_audio.mp4".format(job_id, scene_number)
                                    minio_client.put_object(
                                        bucket_name=settings.minio_bucket_images,
                                        object_name=merged_object,
                                        data=io.BytesIO(merged),
                                        length=len(merged),
                                        content_type="video/mp4",
                                    )
                                    scenes[scene_idx]["video_with_audio_object"] = merged_object
                    except Exception as merge_err:
                        logger.warning(
                            "Scene %d: Failed to merge audio with video: %s",
                            scene_number, str(merge_err)[:200],
                        )

                else:
                    error = status_result.get("error", "영상 URL 없음")
                    scenes[scene_idx]["video_status"] = "failed"
                    scenes[scene_idx]["video_error"] = error
                break
        else:
            scenes[scene_idx]["video_status"] = "failed"
            scenes[scene_idx]["video_error"] = "영상 생성 시간 초과"

    except Exception as e:
        scenes[scene_idx]["video_status"] = "failed"
        scenes[scene_idx]["video_error"] = str(e)[:300]

    # Update MongoDB
    await mongo_db.mv_jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
    )


def _run_single_scene_video(job_id, scene_number):
    """Synchronous wrapper to run single scene video generation in a background thread."""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        loop.run_until_complete(_generate_single_scene_video(job_id, scene_number, mongo_db))
    except Exception as e:
        print(f"Single scene video error: {e}")
        import traceback; traceback.print_exc()
    finally:
        loop.close()


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video ────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/generate-video")
async def generate_single_scene_video_endpoint(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Generate video for a single scene in the background."""
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

    # Check that the scene has an image
    if not scenes[scene_idx].get("image_object_name"):
        return JSONResponse(
            status_code=400,
            content={"error": "이미지가 없는 장면입니다. 먼저 이미지를 생성하세요."},
        )

    # Prevent duplicate generation
    if scenes[scene_idx].get("video_status") == "generating":
        return JSONResponse(
            status_code=409,
            content={"error": "이 장면의 영상이 이미 생성 중입니다."},
        )

    # Update video_status to "generating"
    scenes[scene_idx]["video_status"] = "generating"
    scenes[scene_idx]["video_error"] = None
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {"$set": {
            "scenes": scenes,
            "updated_at": datetime.utcnow(),
        }},
    )

    # Launch background task
    background_tasks.add_task(_run_single_scene_video, str(oid), scene_number)

    return {
        "job_id": job_id,
        "scene_number": scene_number,
        "video_status": "generating",
        "message": "씬 영상 생성이 시작되었습니다.",
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


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/retry-sync ────────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/retry-sync")
async def retry_sync_labs(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Retry Sync Labs lip sync post-processing for a single scene."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    if not settings.sync_api_key:
        return JSONResponse(status_code=503, content={"error": "Sync Labs API 키가 설정되지 않았습니다."})

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다."})
    if str(job.get("user_id", "")) != str(current_user["id"]):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    scenes = job.get("scenes", [])
    scene = None
    for s in scenes:
        if s.get("scene_number") == scene_number:
            scene = s
            break
    if not scene:
        return JSONResponse(status_code=404, content={"error": "씬을 찾을 수 없습니다."})
    if scene.get("scene_type") != "lipsync":
        return JSONResponse(status_code=400, content={"error": "립싱크 씬이 아닙니다."})
    if not scene.get("video_object_name"):
        return JSONResponse(status_code=400, content={"error": "영상이 없습니다. 먼저 영상을 생성해주세요."})

    background_tasks.add_task(_run_retry_sync, str(job_id), scene_number)
    return {"message": "립싱크 재시도를 시작합니다.", "scene_number": scene_number}


def _run_retry_sync(job_id, scene_number):
    """Background wrapper for Sync Labs retry."""
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        import motor.motor_asyncio
        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        mongo_db = mongo_client[settings.mongo_db]
        loop.run_until_complete(_retry_sync_for_scene(job_id, scene_number, mongo_db))
    except Exception as e:
        logger.error("Retry sync error: %s", e, exc_info=True)
    finally:
        loop.close()


async def _retry_sync_for_scene(job_id, scene_number, mongo_db):
    """Retry Sync Labs post-processing for a single scene."""
    from bson import ObjectId as _ObjectId
    job = await mongo_db.mv_jobs.find_one({"_id": _ObjectId(job_id)})
    if not job:
        return

    scenes = job.get("scenes", [])
    scene_idx = None
    scene = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene_idx = i
            scene = s
            break
    if scene is None or not scene.get("video_object_name"):
        return

    from ..database.minio import get_minio
    minio_client = get_minio()

    try:
        # Load current video
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=scene["video_object_name"],
        )
        video_bytes = resp.read()
        resp.close(); resp.release_conn()

        # Load audio
        from ..services.mv_pipeline import _resolve_audio_object_name
        from ..services.sync_labs_service import generate_lipsync_from_video, cut_audio_segment

        audio_object_name = await _resolve_audio_object_name(job, mongo_db)
        if not audio_object_name:
            scenes[scene_idx]["sync_error"] = "음악 파일을 찾을 수 없습니다."
            await mongo_db.mv_jobs.update_one({"_id": _ObjectId(job_id)}, {"$set": {"scenes": scenes}})
            return

        audio_resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object_name,
        )
        full_audio = audio_resp.read()
        audio_resp.close(); audio_resp.release_conn()

        # Recalculate section_start/end if missing
        if scene.get("section_start") is None:
            cumulative = 0.0
            sorted_scenes = sorted(scenes, key=lambda s: s.get("scene_number", 0))
            for sc in sorted_scenes:
                use_sec = float(sc.get("use_seconds", 10))
                sc["section_start"] = round(cumulative, 3)
                sc["section_end"] = round(cumulative + use_sec, 3)
                cumulative += use_sec
            # Re-find scene after recalc
            for i, s in enumerate(scenes):
                if s.get("scene_number") == scene_number:
                    scene = s
                    scene_idx = i
                    break

        start_sec = scene.get("section_start", 0)
        end_sec = scene.get("section_end", start_sec + 10)

        # 분리된 보컬이 있으면 Sync Labs에 보컬만 전달, 없으면 전체 구간
        original_segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)
        if scene.get("separated_vocal_object"):
            vocal_resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_music,
                object_name=scene["separated_vocal_object"],
            )
            sync_audio = vocal_resp.read()
            vocal_resp.close()
            vocal_resp.release_conn()
        else:
            sync_audio = original_segment_audio

        # Call Sync Labs (보컬만 전달하여 립싱크 정확도 향상)
        synced_video = await generate_lipsync_from_video(
            video_bytes=video_bytes,
            audio_bytes=sync_audio,
            model="lipsync-2",
        )

        # 오디오 제거 → 원본 음악(풀믹스) 다시 합치기
        import tempfile, subprocess
        with tempfile.TemporaryDirectory() as tmpdir:
            synced_path = os.path.join(tmpdir, "synced.mp4")
            silent_path = os.path.join(tmpdir, "silent.mp4")
            audio_seg_path = os.path.join(tmpdir, "audio_seg.mp3")
            final_path = os.path.join(tmpdir, "final.mp4")

            with open(synced_path, "wb") as f:
                f.write(synced_video)
            with open(audio_seg_path, "wb") as f:
                f.write(original_segment_audio)

            subprocess.run(["ffmpeg", "-y", "-i", synced_path, "-an", "-c:v", "copy", silent_path],
                          capture_output=True, timeout=30)

            if os.path.exists(silent_path):
                subprocess.run(["ffmpeg", "-y", "-i", silent_path, "-i", audio_seg_path,
                               "-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0",
                               "-shortest", final_path],
                              capture_output=True, timeout=30)

            if os.path.exists(final_path):
                with open(final_path, "rb") as f:
                    final_video = f.read()
            else:
                final_video = synced_video

        # Sync Labs 후 자막 재적용
        from ..services.mv_pipeline import _burn_subtitles_on_synced_video
        final_video = _burn_subtitles_on_synced_video(final_video, scene, original_segment_audio)

        # Save Sync Labs result to SEPARATE file (원본 Kling 영상 유지)
        synclabs_object = "mv/{}/scenes/{:03d}_video_synclabs.mp4".format(job_id, scene_number)
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=synclabs_object,
            data=io.BytesIO(final_video),
            length=len(final_video),
            content_type="video/mp4",
        )

        scenes[scene_idx]["video_synclabs_object"] = synclabs_object
        scenes[scene_idx]["video_source"] = "kling+synclabs"
        scenes[scene_idx]["sync_error"] = None

        # Also save video_with_audio_synclabs (Sync Labs 결과 + 원본 음악)
        synclabs_audio_object = "mv/{}/scenes/{:03d}_video_audio_synclabs.mp4".format(job_id, scene_number)
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=synclabs_audio_object,
            data=io.BytesIO(final_video),
            length=len(final_video),
            content_type="video/mp4",
        )
        scenes[scene_idx]["video_with_audio_synclabs_object"] = synclabs_audio_object

    except Exception as e:
        scenes[scene_idx]["sync_error"] = str(e)[:300]
        scenes[scene_idx]["video_source"] = "kling (sync failed)"

    await mongo_db.mv_jobs.update_one(
        {"_id": _ObjectId(job_id)},
        {"$set": {"scenes": scenes, "updated_at": datetime.utcnow()}}
    )


# ── POST /api/mv/jobs/{job_id}/scenes/{scene_number}/separate-vocal ─────────

@router.post("/jobs/{job_id}/scenes/{scene_number}/separate-vocal")
async def separate_vocal(
    job_id: str,
    scene_number: int,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Separate vocals from audio segment for lip sync preview."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        return JSONResponse(status_code=404, content={"error": "작업을 찾을 수 없습니다."})
    if str(job.get("user_id", "")) != str(current_user["id"]):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    scenes = job.get("scenes", [])
    scene = None
    scene_idx = None
    for i, s in enumerate(scenes):
        if s.get("scene_number") == scene_number:
            scene = s
            scene_idx = i
            break
    if not scene:
        return JSONResponse(status_code=404, content={"error": "씬을 찾을 수 없습니다."})
    if scene.get("scene_type") != "lipsync":
        return JSONResponse(status_code=400, content={"error": "립싱크 씬이 아닙니다."})

    # section_start/end 필요
    start_sec = scene.get("section_start")
    end_sec = scene.get("section_end")
    if start_sec is None or end_sec is None:
        return JSONResponse(status_code=400, content={"error": "씬의 시간 정보가 없습니다."})

    # 이미 분리된 보컬이 있으면 바로 반환
    if scene.get("separated_vocal_object") and scene.get("separated_original_object"):
        import base64
        minio_client = get_minio()
        orig_resp = minio_client.get_object(settings.minio_bucket_music, scene["separated_original_object"])
        orig_b64 = base64.b64encode(orig_resp.read()).decode(); orig_resp.close(); orig_resp.release_conn()
        vocal_resp = minio_client.get_object(settings.minio_bucket_music, scene["separated_vocal_object"])
        vocal_b64 = base64.b64encode(vocal_resp.read()).decode(); vocal_resp.close(); vocal_resp.release_conn()
        return {
            "original_audio_url": "data:audio/mpeg;base64," + orig_b64,
            "vocal_audio_url": "data:audio/wav;base64," + vocal_b64,
            "scene_number": scene_number,
            "cached": True,
        }

    # 오디오 로드
    from ..services.mv_pipeline import _resolve_audio_object_name
    audio_object_name = await _resolve_audio_object_name(job, mongo)
    if not audio_object_name:
        return JSONResponse(status_code=404, content={"error": "음악 파일을 찾을 수 없습니다."})

    minio_client = get_minio()
    resp = minio_client.get_object(bucket_name=settings.minio_bucket_music, object_name=audio_object_name)
    full_audio = resp.read()
    resp.close()
    resp.release_conn()

    # 구간 자르기
    from ..services.sync_labs_service import cut_audio_segment
    segment_audio = cut_audio_segment(full_audio, start_sec, end_sec)

    # demucs로 보컬 분리
    try:
        from ..services.demucs_service import enhance_vocal_demucs
        vocal_bytes = await enhance_vocal_demucs(segment_audio, "segment.mp3")
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "보컬 분리 실패: {}".format(str(e)[:200])})

    # MinIO에 저장
    original_object = "mv/{}/scenes/{:03d}_original_segment.mp3".format(job_id, scene_number)
    vocal_object = "mv/{}/scenes/{:03d}_vocal_only.wav".format(job_id, scene_number)

    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=original_object,
        data=io.BytesIO(segment_audio),
        length=len(segment_audio),
        content_type="audio/mpeg",
    )
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=vocal_object,
        data=io.BytesIO(vocal_bytes),
        length=len(vocal_bytes),
        content_type="audio/wav",
    )

    # 씬에 저장
    scenes[scene_idx]["separated_original_object"] = original_object
    scenes[scene_idx]["separated_vocal_object"] = vocal_object
    await mongo.mv_jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {"scenes": scenes}}
    )

    import base64
    return {
        "original_audio_url": "data:audio/mpeg;base64," + base64.b64encode(segment_audio).decode(),
        "vocal_audio_url": "data:audio/wav;base64," + base64.b64encode(vocal_bytes).decode(),
        "scene_number": scene_number,
        "cached": False,
    }
