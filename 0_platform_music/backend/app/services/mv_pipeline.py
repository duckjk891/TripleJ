"""
MV Pipeline — Phase runner functions for draft/resume MV generation.

Reads job data from MongoDB, uses low-level functions from mv_generator.py,
and updates MongoDB throughout each phase.
"""

import asyncio
import io
import logging
import os
import shutil
import tempfile
from datetime import datetime, timedelta
from typing import List, Optional

from ..config import settings
from ..database.minio import get_minio
from .mv_generator import (
    analyze_music_structure,
    split_lyrics_into_scenes,
    generate_scene_image,
    start_scene_video,
    check_scene_video_status,
    download_video,
    concatenate_videos,
    trim_video_clip,
    _get_ffmpeg_path,
)
from .kling_video_generator import (
    start_scene_video_kling,
    check_scene_video_status_kling,
    download_video_kling,
)

logger = logging.getLogger(__name__)


async def _update_job(mongo_db, job_id, update: dict) -> None:
    """Helper to update mv_jobs document."""
    update["updated_at"] = datetime.utcnow()
    await mongo_db.mv_jobs.update_one(
        {"_id": job_id},
        {"$set": update},
    )


async def _get_job(mongo_db, job_id) -> Optional[dict]:
    """Load job document from MongoDB."""
    return await mongo_db.mv_jobs.find_one({"_id": job_id})


async def _is_cancelled(mongo_db, job_id) -> bool:
    """Check if cancel has been requested for this job."""
    job = await mongo_db.mv_jobs.find_one({"_id": job_id}, {"cancel_requested": 1})
    return bool(job and job.get("cancel_requested"))


def _load_cover_image(cover_object_name: Optional[str]) -> Optional[bytes]:
    """Load cover image bytes from MinIO for style reference."""
    if not cover_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=cover_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load cover image '%s': %s", cover_object_name, e)
        return None


def _load_character_image(character_object_name: Optional[str]) -> Optional[bytes]:
    """Load character sheet image bytes from MinIO."""
    if not character_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=character_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load character image '%s': %s", character_object_name, e)
        return None


def _load_audio_from_minio(audio_object_name: Optional[str]) -> Optional[bytes]:
    """Load audio bytes from MinIO music bucket."""
    if not audio_object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=audio_object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except Exception as e:
        logger.warning("Failed to load audio '%s': %s", audio_object_name, e)
        return None


async def _resolve_audio_object_name(job: dict, mongo_db) -> Optional[str]:
    """Resolve audio object name from job or its linked generation."""
    # Direct audio_object_name on the job
    audio_obj = job.get("audio_object_name")
    if audio_obj:
        return audio_obj

    # Try to get from linked generation
    gen_id = job.get("audio_generation_id")
    if gen_id:
        try:
            from bson import ObjectId
            gen_doc = await mongo_db.generations.find_one(
                {"_id": ObjectId(gen_id)},
                {"result_audio_url": 1},
            )
            if gen_doc and gen_doc.get("result_audio_url"):
                return gen_doc["result_audio_url"]
        except Exception as e:
            logger.warning("Failed to resolve audio from generation %s: %s", gen_id, e)

    return None


# ── Phase 1: Split lyrics into scenes ────────────────────────────────────────


async def run_phase1_split(job_id, mongo_db) -> None:
    """Split lyrics into scenes, save to mv_jobs.scenes array.

    If audio is available, first analyzes music structure via Gemini,
    then uses section-aware scene planning.
    """
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase1: job %s not found", job_id)
        return

    await _update_job(mongo_db, job_id, {
        "status": "splitting",
        "progress": 1,
    })

    scene_count = job.get("scene_count", 20)
    music_sections = None

    # ── Phase 1a: Analyze music structure (if audio available) ──
    audio_object_name = await _resolve_audio_object_name(job, mongo_db)
    if audio_object_name:
        logger.info("Phase1: analyzing music structure for job %s (audio: %s)", job_id, audio_object_name)
        await _update_job(mongo_db, job_id, {"progress": 1})

        try:
            audio_bytes = _load_audio_from_minio(audio_object_name)
            if audio_bytes:
                # Determine mime type
                mime_type = "audio/mp3"
                if audio_object_name.endswith(".wav"):
                    mime_type = "audio/wav"
                elif audio_object_name.endswith(".m4a"):
                    mime_type = "audio/mp4"

                music_sections = await analyze_music_structure(audio_bytes, mime_type)

                # Save to job
                await _update_job(mongo_db, job_id, {
                    "music_sections": music_sections,
                    "progress": 3,
                })
                logger.info(
                    "Phase1: job %s music structure: %d sections",
                    job_id, len(music_sections),
                )
            else:
                logger.warning("Phase1: could not load audio bytes for job %s", job_id)
        except Exception as e:
            logger.warning(
                "Phase1: music structure analysis failed for job %s: %s (continuing without)",
                job_id, e,
            )
            # Non-fatal: continue without music sections

    await _update_job(mongo_db, job_id, {"progress": 3})

    # ── Phase 1b: Scene planning ──
    try:
        scenes_raw = await split_lyrics_into_scenes(
            lyrics=job.get("lyrics"),
            title=job["title"],
            genre=job.get("genre"),
            mood=job.get("mood"),
            scene_count=scene_count,
            user_scene_prompt=job.get("scene_prompt"),
            music_sections=music_sections,
        )
    except Exception as e:
        logger.error("Phase1: failed to split lyrics for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "장면 분할 실패: {}".format(str(e)[:300]),
        })
        return

    # Build scenes array with status fields
    scenes = []
    for s in scenes_raw:
        scene_doc = {
            "scene_number": s.get("scene_number", len(scenes) + 1),
            "description": s.get("description", ""),
            "lyrics_segment": s.get("lyrics_segment", ""),
            "image_object_name": None,
            "image_source": None,
            "video_object_name": None,
            "video_status": "pending",
            "video_error": None,
        }
        # Section-aware fields (present when music_sections was used)
        if s.get("use_seconds"):
            scene_doc["use_seconds"] = float(s["use_seconds"])
        if s.get("section"):
            scene_doc["section"] = s["section"]
        if s.get("section_mood"):
            scene_doc["section_mood"] = s["section_mood"]
        if s.get("clip_mood"):
            scene_doc["clip_mood"] = s["clip_mood"]

        scenes.append(scene_doc)

    await _update_job(mongo_db, job_id, {
        "status": "scenes_ready",
        "progress": 5,
        "total_scenes": len(scenes),
        "scenes": scenes,
        "completed_image_count": 0,
        "completed_video_count": 0,
    })

    logger.info("Phase1: job %s split into %d scenes", job_id, len(scenes))


# ── Phase 1+2 Combined: Split lyrics then generate images ─────────────────────


async def run_phase1_and_phase2(job_id, mongo_db) -> None:
    """Run Phase 1 (split lyrics) then Phase 2 (generate images) in sequence.

    This is the background task launched by POST /api/mv/create.
    Final status after both complete: "images_ready".
    """
    # Run Phase 1
    await run_phase1_split(job_id, mongo_db)

    # Check if phase 1 succeeded
    job = await _get_job(mongo_db, job_id)
    if not job or job.get("status") == "failed":
        return

    # Run Phase 2 (all scenes, no specific scene_numbers)
    await run_phase2_images(job_id, mongo_db)


# ── Phase 2: Generate images ─────────────────────────────────────────────────


async def run_phase2_images(job_id, mongo_db, scene_numbers: Optional[List[int]] = None) -> None:
    """Generate images for scenes. Updates each scene in MongoDB."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase2: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    if not scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "장면 데이터가 없습니다. 먼저 장면 분할을 실행하세요.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "generating_images",
        "cancel_requested": False,
    })

    cover_image_bytes = _load_cover_image(job.get("cover_object_name"))
    character_image_bytes = _load_character_image(job.get("character_object_name"))
    minio_client = get_minio()

    # Determine which scenes to process
    target_scenes = []
    for i, scene in enumerate(scenes):
        sn = scene.get("scene_number", i + 1)
        if scene_numbers is not None:
            if sn in scene_numbers:
                target_scenes.append((i, scene))
        else:
            # Only generate for scenes without images
            if not scene.get("image_object_name"):
                target_scenes.append((i, scene))

    total_to_generate = len(target_scenes)
    if total_to_generate == 0:
        await _update_job(mongo_db, job_id, {
            "status": "images_ready",
        })
        return

    generated_count = 0

    for idx, (i, scene) in enumerate(target_scenes):
        # Check for cancellation between scenes
        if await _is_cancelled(mongo_db, job_id):
            logger.info("Phase2: job %s cancelled by user", job_id)
            await _update_job(mongo_db, job_id, {
                "status": "images_ready",
                "cancel_requested": False,
                "error_message": "사용자에 의해 중지됨",
            })
            return

        sn = scene.get("scene_number", i + 1)
        try:
            img_bytes = await generate_scene_image(
                scene["description"],
                cover_image_bytes=cover_image_bytes,
                character_image_bytes=character_image_bytes,
            )

            # Save to MinIO
            object_name = "mv/{}/scenes/{:03d}.png".format(str(job_id), sn)
            minio_client.put_object(
                bucket_name=settings.minio_bucket_images,
                object_name=object_name,
                data=io.BytesIO(img_bytes),
                length=len(img_bytes),
                content_type="image/png",
            )

            # Update scene in MongoDB
            scenes[i]["image_object_name"] = object_name
            scenes[i]["image_source"] = "gemini"
            generated_count += 1

        except Exception as e:
            logger.warning("Phase2: scene %d image failed: %s", sn, e)

        # Update progress
        completed_image_count = sum(
            1 for s in scenes if s.get("image_object_name")
        )
        progress = int(5 + (idx + 1) / total_to_generate * 40)
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_image_count": completed_image_count,
            "progress": min(progress, 45),
        })

        # Delay between image generations
        if idx < total_to_generate - 1:
            await asyncio.sleep(3)

    # Final status
    completed_image_count = sum(1 for s in scenes if s.get("image_object_name"))
    await _update_job(mongo_db, job_id, {
        "status": "images_ready",
        "completed_image_count": completed_image_count,
        "scenes": scenes,
        "progress": 45,
    })

    logger.info(
        "Phase2: job %s — %d images generated (%d total)",
        job_id, generated_count, completed_image_count,
    )


# ── Phase 3: Generate videos ─────────────────────────────────────────────────


async def run_phase3_videos(job_id, mongo_db, scene_numbers: Optional[List[int]] = None, video_model: Optional[str] = None) -> None:
    """Generate videos. Pauses on 429. Skips completed scenes."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase3: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    if not scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "장면 데이터가 없습니다.",
        })
        return

    # Resolve video model: parameter > job setting > default
    if not video_model:
        video_model = job.get("video_model", "veo")
    use_kling = (video_model == "kling")

    logger.info("Phase3: job %s using video model: %s", job_id, video_model)

    await _update_job(mongo_db, job_id, {
        "status": "generating_videos",
        "progress": 45,
        "error_message": "",
        "cancel_requested": False,
    })

    minio_client = get_minio()

    # Determine which scenes to process
    target_scenes = []
    for i, scene in enumerate(scenes):
        sn = scene.get("scene_number", i + 1)
        if scene_numbers is not None:
            if sn not in scene_numbers:
                continue
        # Only process pending or failed
        if scene.get("video_status") in ("pending", "failed"):
            if scene.get("image_object_name"):
                target_scenes.append((i, scene))

    total_to_process = len(target_scenes)
    if total_to_process == 0:
        # Check if all done
        completed = sum(1 for s in scenes if s.get("video_status") == "completed")
        status = "completed" if completed == len(scenes) else "images_ready"
        await _update_job(mongo_db, job_id, {
            "status": status,
            "completed_video_count": completed,
        })
        return

    max_retries = 5
    rate_limit_backoffs = [180, 300, 420, 600, 900]

    for idx, (i, scene) in enumerate(target_scenes):
        # Check for cancellation between scenes
        if await _is_cancelled(mongo_db, job_id):
            logger.info("Phase3: job %s cancelled by user", job_id)
            completed_video_count = sum(
                1 for s in scenes if s.get("video_status") == "completed"
            )
            await _update_job(mongo_db, job_id, {
                "status": "paused",
                "cancel_requested": False,
                "error_message": "사용자에 의해 중지됨",
                "completed_video_count": completed_video_count,
                "scenes": scenes,
                "retry_info": None,
            })
            return

        sn = scene.get("scene_number", i + 1)

        # Load image from MinIO
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=scene["image_object_name"],
            )
            image_bytes = resp.read()
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.warning("Phase3: failed to load image for scene %d: %s", sn, e)
            scenes[i]["video_status"] = "failed"
            scenes[i]["video_error"] = "이미지 로드 실패: {}".format(str(e)[:200])
            await _update_job(mongo_db, job_id, {"scenes": scenes})
            continue

        # Mark as generating
        scenes[i]["video_status"] = "generating"
        await _update_job(mongo_db, job_id, {"scenes": scenes})

        # Try to generate video with retries
        video_generated = False
        consecutive_429 = 0

        for attempt in range(max_retries):
            try:
                if use_kling:
                    task_or_op = await start_scene_video_kling(
                        scene["description"], image_bytes
                    )
                else:
                    task_or_op = await start_scene_video(
                        scene["description"], image_bytes
                    )
                consecutive_429 = 0  # API accepted
                await _update_job(mongo_db, job_id, {"retry_info": None})

                # Poll until done (max ~10 min)
                timed_out = True
                for _ in range(120):
                    await asyncio.sleep(5)
                    # Check cancellation during polling
                    if await _is_cancelled(mongo_db, job_id):
                        logger.info("Phase3: job %s cancelled during video poll", job_id)
                        scenes[i]["video_status"] = "pending"
                        completed_vc = sum(
                            1 for s in scenes if s.get("video_status") == "completed"
                        )
                        await _update_job(mongo_db, job_id, {
                            "status": "paused",
                            "cancel_requested": False,
                            "error_message": "사용자에 의해 중지됨",
                            "completed_video_count": completed_vc,
                            "scenes": scenes,
                            "retry_info": None,
                        })
                        return
                    if use_kling:
                        status_result = await check_scene_video_status_kling(task_or_op)
                    else:
                        status_result = await check_scene_video_status(task_or_op)
                    if status_result["done"]:
                        timed_out = False
                        break

                if timed_out:
                    logger.warning("Phase3: scene %d timed out (attempt %d)", sn, attempt + 1)
                    if attempt < max_retries - 1:
                        continue
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = "비디오 생성 시간 초과"
                    break

                if status_result.get("error"):
                    logger.warning("Phase3: scene %d error: %s", sn, status_result["error"])
                    if attempt < max_retries - 1:
                        continue
                    scenes[i]["video_status"] = "failed"
                    scenes[i]["video_error"] = status_result["error"]
                    break

                # Download and save video
                # Kling returns "video_url", Veo returns "video_uri"
                video_download_url = status_result.get("video_url") or status_result.get("video_uri")
                if use_kling:
                    video_bytes = await download_video_kling(video_download_url)
                else:
                    video_bytes = await download_video(video_download_url)

                # Trim video to use_seconds if specified (section-aware pipeline)
                use_seconds = scene.get("use_seconds")
                if use_seconds and use_seconds > 0:
                    tmpdir_trim = tempfile.mkdtemp(prefix="mv_trim_")
                    try:
                        raw_path = os.path.join(tmpdir_trim, "raw_{:03d}.mp4".format(sn))
                        trimmed_path = os.path.join(tmpdir_trim, "trimmed_{:03d}.mp4".format(sn))
                        with open(raw_path, "wb") as f:
                            f.write(video_bytes)

                        trim_ok = await trim_video_clip(raw_path, trimmed_path, use_seconds)
                        if trim_ok and os.path.exists(trimmed_path):
                            with open(trimmed_path, "rb") as f:
                                video_bytes = f.read()
                            logger.info(
                                "Phase3: scene %d trimmed to %.1fs", sn, use_seconds
                            )
                        else:
                            logger.warning(
                                "Phase3: scene %d trim failed, using untrimmed", sn
                            )
                    finally:
                        shutil.rmtree(tmpdir_trim, ignore_errors=True)

                video_object = "mv/{}/videos/{:03d}.mp4".format(str(job_id), sn)
                minio_client.put_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=video_object,
                    data=io.BytesIO(video_bytes),
                    length=len(video_bytes),
                    content_type="video/mp4",
                )

                scenes[i]["video_object_name"] = video_object
                scenes[i]["video_status"] = "completed"
                scenes[i]["video_error"] = None
                video_generated = True
                break

            except Exception as e:
                error_str = str(e)
                is_rate_limit = "429" in error_str

                if is_rate_limit:
                    consecutive_429 += 1
                    backoff = rate_limit_backoffs[min(attempt, len(rate_limit_backoffs) - 1)]
                    logger.warning(
                        "Phase3: scene %d attempt %d: 429 — waiting %ds",
                        sn, attempt + 1, backoff,
                    )

                    if consecutive_429 >= max_retries:
                        # Quota exhausted — pause job
                        scenes[i]["video_status"] = "failed"
                        scenes[i]["video_error"] = "API 할당량 소진 (429)"
                        await _update_job(mongo_db, job_id, {
                            "status": "paused",
                            "scenes": scenes,
                            "error_message": "API 할당량이 소진되어 일시 중지되었습니다. 나중에 재개하세요.",
                            "completed_video_count": sum(
                                1 for s in scenes if s.get("video_status") == "completed"
                            ),
                            "retry_info": None,
                        })
                        logger.info("Phase3: job %s paused due to 429", job_id)
                        return
                else:
                    consecutive_429 = 0
                    backoff = 10 * (attempt + 1)
                    logger.warning(
                        "Phase3: scene %d attempt %d failed: %s",
                        sn, attempt + 1, error_str[:200],
                    )

                if attempt < max_retries - 1:
                    if is_rate_limit:
                        retry_info = {
                            "active": True,
                            "scene_number": sn,
                            "attempt": attempt + 1,
                            "max_retries": max_retries,
                            "backoff_seconds": backoff,
                            "retry_at": (datetime.utcnow() + timedelta(seconds=backoff)).isoformat(),
                            "reason": "429_rate_limit",
                        }
                        await _update_job(mongo_db, job_id, {"retry_info": retry_info})
                    await asyncio.sleep(backoff)
                    await _update_job(mongo_db, job_id, {"retry_info": None})
                    continue

                scenes[i]["video_status"] = "failed"
                scenes[i]["video_error"] = error_str[:300]

        # Update progress
        completed_video_count = sum(
            1 for s in scenes if s.get("video_status") == "completed"
        )
        total_with_images = sum(1 for s in scenes if s.get("image_object_name"))
        progress = int(45 + (idx + 1) / total_to_process * 40)
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": min(progress, 85),
        })

        # Breathing room between scenes
        if video_generated and idx < total_to_process - 1:
            await asyncio.sleep(15)

    # Final status
    completed_video_count = sum(
        1 for s in scenes if s.get("video_status") == "completed"
    )
    total_scenes = len(scenes)

    logger.info(
        "Phase3: job %s — %d/%d videos completed",
        job_id, completed_video_count, total_scenes,
    )

    # If ALL scenes have completed videos, auto-concatenate
    if completed_video_count == total_scenes:
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": 88,
            "status": "generating_videos",
            "retry_info": None,
        })
        await run_phase4_concatenate(job_id, mongo_db)
    else:
        # Not all done — set to videos_ready so user can see progress
        await _update_job(mongo_db, job_id, {
            "scenes": scenes,
            "completed_video_count": completed_video_count,
            "progress": 85,
            "status": "videos_ready",
            "retry_info": None,
        })


# ── Phase 4: Concatenate videos ──────────────────────────────────────────────


async def run_phase4_concatenate(job_id, mongo_db) -> None:
    """Download clips, concatenate, upload final."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase4: job %s not found", job_id)
        return

    scenes = job.get("scenes", [])
    completed_scenes = [
        s for s in scenes
        if s.get("video_status") == "completed" and s.get("video_object_name")
    ]

    if not completed_scenes:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "합칠 완료된 비디오가 없습니다.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "concatenating",
        "progress": 90,
    })

    # Sort by scene_number
    completed_scenes.sort(key=lambda s: s.get("scene_number", 0))

    minio_client = get_minio()
    tmpdir = tempfile.mkdtemp(prefix="mv_concat_")

    try:
        # Download all completed video clips
        video_paths = []
        for scene in completed_scenes:
            sn = scene["scene_number"]
            local_path = os.path.join(tmpdir, "scene_{:03d}.mp4".format(sn))
            try:
                resp = minio_client.get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=scene["video_object_name"],
                )
                with open(local_path, "wb") as f:
                    for chunk in resp.stream(32 * 1024):
                        f.write(chunk)
                resp.close()
                resp.release_conn()
                video_paths.append(local_path)
            except Exception as e:
                logger.warning(
                    "Phase4: failed to download scene %d video: %s", sn, e
                )

        if not video_paths:
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "비디오 다운로드에 실패했습니다.",
            })
            return

        if len(video_paths) == 1:
            final_path = video_paths[0]
        else:
            ffmpeg_path = _get_ffmpeg_path()
            if not ffmpeg_path:
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "ffmpeg가 설치되어 있지 않아 비디오를 합칠 수 없습니다.",
                })
                return

            final_path = os.path.join(tmpdir, "final.mp4")
            try:
                await concatenate_videos(video_paths, final_path)
            except Exception as e:
                logger.error("Phase4: concatenation failed: %s", e)
                await _update_job(mongo_db, job_id, {
                    "status": "failed",
                    "error_message": "비디오 합치기 실패: {}".format(str(e)[:300]),
                })
                return

        # Trim final video to audio duration if available
        audio_duration = job.get("audio_duration_sec")
        if audio_duration and audio_duration > 0:
            trimmed_path = os.path.join(tmpdir, "final_trimmed.mp4")
            ffmpeg_path = _get_ffmpeg_path()
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_path, "-y", "-i", final_path,
                "-t", str(audio_duration),
                "-c", "copy", trimmed_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode == 0:
                final_path = trimmed_path
            else:
                logger.warning(
                    "Phase4: trim failed (returncode %d), using untrimmed: %s",
                    proc.returncode, stderr.decode()[:300],
                )

        # Upload final video to MinIO
        final_object = "mv/{}/final.mp4".format(str(job_id))
        with open(final_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=final_object,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "video_ready",
            "progress": 95,
            "result_video_url": final_object,
        })

        logger.info("Phase4: job %s concatenation completed", job_id)

    except Exception as e:
        logger.error("Phase4: unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "예상치 못한 오류: {}".format(str(e)[:300]),
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── Phase 5: Merge audio with video ──────────────────────────────────────────


async def run_phase5_merge_audio(job_id, mongo_db, audio_object_name: str) -> None:
    """Download final video + audio, merge with ffmpeg, upload result."""
    job = await _get_job(mongo_db, job_id)
    if not job:
        logger.error("Phase5: job %s not found", job_id)
        return

    video_object_name = job.get("result_video_url")
    if not video_object_name:
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "합칠 영상 파일이 없습니다.",
        })
        return

    await _update_job(mongo_db, job_id, {
        "status": "merging_audio",
        "progress": 96,
    })

    minio_client = get_minio()
    tmpdir = tempfile.mkdtemp(prefix="mv_merge_")

    try:
        # Download video
        video_path = os.path.join(tmpdir, "video.mp4")
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=video_object_name,
            )
            with open(video_path, "wb") as f:
                for chunk in resp.stream(32 * 1024):
                    f.write(chunk)
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.error("Phase5: failed to download video: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "영상 다운로드 실패: {}".format(str(e)[:300]),
            })
            return

        # Download audio (audio files are in the music bucket, not images)
        audio_path = os.path.join(tmpdir, "audio.mp3")
        try:
            resp = minio_client.get_object(
                bucket_name=settings.minio_bucket_music,
                object_name=audio_object_name,
            )
            with open(audio_path, "wb") as f:
                for chunk in resp.stream(32 * 1024):
                    f.write(chunk)
            resp.close()
            resp.release_conn()
        except Exception as e:
            logger.error("Phase5: failed to download audio: %s", e)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "오디오 다운로드 실패: {}".format(str(e)[:300]),
            })
            return

        # Merge with ffmpeg
        ffmpeg_path = _get_ffmpeg_path()
        if not ffmpeg_path:
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "ffmpeg가 설치되어 있지 않아 합칠 수 없습니다.",
            })
            return

        output_path = os.path.join(tmpdir, "music_video.mp4")
        proc = await asyncio.create_subprocess_exec(
            ffmpeg_path, "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            output_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            error_msg = stderr.decode()[:300] if stderr else "알 수 없는 오류"
            logger.error("Phase5: ffmpeg merge failed: %s", error_msg)
            await _update_job(mongo_db, job_id, {
                "status": "video_ready",
                "error_message": "음악 합치기 실패: {}".format(error_msg),
            })
            return

        # Upload merged video to MinIO
        merged_object = "mv/{}/music_video.mp4".format(str(job_id))
        with open(output_path, "rb") as f:
            video_data = f.read()

        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=merged_object,
            data=io.BytesIO(video_data),
            length=len(video_data),
            content_type="video/mp4",
        )

        await _update_job(mongo_db, job_id, {
            "status": "completed",
            "progress": 100,
            "result_music_video_url": merged_object,
        })

        logger.info("Phase5: job %s audio merge completed", job_id)

    except Exception as e:
        logger.error("Phase5: unexpected error for job %s: %s", job_id, e)
        await _update_job(mongo_db, job_id, {
            "status": "video_ready",
            "error_message": "예상치 못한 오류: {}".format(str(e)[:300]),
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
