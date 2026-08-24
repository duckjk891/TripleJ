"""
Background beat extraction service (v44).

Extracts tempo / beats / downbeats from a generation's or track's audio
file (stored in MinIO), using the v43 madmom-based detect_beats() in
audio_utils. Stores the result back into the MongoDB document so that
later MV creation can reuse it instead of re-running madmom every time.

Design:
- Status field `beats_status` on each generation/track doc transitions
  pending → running → completed | failed.
- On startup, lifespan resets any stuck "running" rows back to "pending"
  and re-triggers extraction (see app/main.py).
- Failures store a truncated error string but never raise to caller.

Key design note about event loops:
- The Suno wrapper (`_run_music_generation`) creates its own asyncio loop
  and a loop-local motor client. We therefore expose `*_with_db` variants
  that accept a passed-in db handle, plus convenience wrappers that use
  the global `get_mongo()` (bound to the main FastAPI loop) for callers
  in the main loop (lifespan, REST endpoints, BackgroundTasks wrappers).
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .audio_utils import detect_beats

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _truncate_error(exc: BaseException, limit: int = 200) -> str:
    return f"{type(exc).__name__}: {str(exc)}"[:limit]


async def _load_audio_bytes(object_name: str) -> Optional[bytes]:
    """Fetch raw audio bytes from MinIO (music bucket). Returns None on failure."""
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=object_name,
        )
        try:
            data = response.read()
        finally:
            try:
                response.close()
                response.release_conn()
            except Exception:
                pass
        return data
    except Exception as e:
        logger.warning("beat_extraction: failed to load audio %s: %s", object_name, e)
        return None


async def _extract_and_persist(
    collection,
    oid: ObjectId,
    audio_object: str,
    *,
    label: str,
) -> dict:
    """
    Shared extraction body: marks running → loads audio → calls detect_beats →
    writes back result/failure. Returns the beat dict (or {} on failure).
    Never raises.
    """
    if not audio_object:
        await collection.update_one(
            {"_id": oid},
            {"$set": {
                "beats_status": "failed",
                "beats_error": "no audio object",
                "beats_completed_at": _now(),
            }},
        )
        return {}

    await collection.update_one(
        {"_id": oid},
        {"$set": {
            "beats_status": "running",
            "beats_started_at": _now(),
            "beats_error": None,
        }},
    )

    audio_bytes = await _load_audio_bytes(audio_object)
    if not audio_bytes:
        await collection.update_one(
            {"_id": oid},
            {"$set": {
                "beats_status": "failed",
                "beats_error": "audio download failed",
                "beats_completed_at": _now(),
            }},
        )
        return {}

    try:
        result = await detect_beats(audio_bytes)
    except Exception as e:
        logger.warning("beat_extraction(%s): detect_beats raised: %s", label, e)
        await collection.update_one(
            {"_id": oid},
            {"$set": {
                "beats_status": "failed",
                "beats_error": _truncate_error(e),
                "beats_completed_at": _now(),
            }},
        )
        return {}

    if not result or not result.get("beats"):
        await collection.update_one(
            {"_id": oid},
            {"$set": {
                "beats_status": "failed",
                "beats_error": "detect_beats returned empty",
                "beats_completed_at": _now(),
                "tempo": None,
                "beats": [],
                "downbeats": [],
            }},
        )
        return {}

    await collection.update_one(
        {"_id": oid},
        {"$set": {
            "beats_status": "completed",
            "tempo": result.get("tempo"),
            "beats": result.get("beats") or [],
            "downbeats": result.get("downbeats") or [],
            "beats_completed_at": _now(),
            "beats_error": None,
        }},
    )
    logger.info(
        "beat_extraction(%s): completed, tempo=%s beats=%d downbeats=%d",
        label,
        result.get("tempo"),
        len(result.get("beats") or []),
        len(result.get("downbeats") or []),
    )
    return result


# ─── Generation variants ─────────────────────────────────────

async def detect_beats_for_generation_with_db(generation_id: str, db) -> dict:
    """Loop-local version: uses the passed-in motor db handle."""
    try:
        oid = ObjectId(generation_id)
    except Exception:
        logger.warning("beat_extraction: invalid generation_id=%s", generation_id)
        return {}

    doc = await db.generations.find_one({"_id": oid})
    if not doc:
        logger.warning("beat_extraction: generation %s not found", generation_id)
        return {}

    return await _extract_and_persist(
        db.generations, oid, doc.get("result_audio_url"),
        label=f"gen={generation_id}",
    )


async def detect_beats_for_generation(generation_id: str) -> dict:
    """Main-loop convenience wrapper using the global get_mongo()."""
    return await detect_beats_for_generation_with_db(generation_id, get_mongo())


# ─── Track variants ──────────────────────────────────────────

async def detect_beats_for_track_with_db(track_id: str, db) -> dict:
    """Loop-local version: uses the passed-in motor db handle."""
    try:
        oid = ObjectId(track_id)
    except Exception:
        logger.warning("beat_extraction: invalid track_id=%s", track_id)
        return {}

    doc = await db.tracks.find_one({"_id": oid})
    if not doc:
        logger.warning("beat_extraction: track %s not found", track_id)
        return {}

    return await _extract_and_persist(
        db.tracks, oid, doc.get("audio_url"),
        label=f"track={track_id}",
    )


async def detect_beats_for_track(track_id: str) -> dict:
    """Main-loop convenience wrapper using the global get_mongo()."""
    return await detect_beats_for_track_with_db(track_id, get_mongo())


# ─── BackgroundTasks wrapper for routes/tracks.py ────────────

def run_track_beat_extraction_in_background(track_id: str):
    """
    Wrapper for FastAPI BackgroundTasks. Spins up its own event loop
    and runs detect_beats_for_track_with_db to completion. Mirrors the
    pattern used by routes/generate.py:_run_music_generation.

    v205: 몸통 전체가 heavy_job_slot 안에서 돈다 — BackgroundTasks 는
    이 sync 함수를 스레드풀 워커 스레드에서 실행하므로 블로킹 acquire 안전.
    (routes/tracks.py 의 수동 재추출 경로도 asyncio.to_thread 로 이
    래퍼를 태워 같은 슬롯을 쓴다.)
    """
    from .heavy_jobs import heavy_job_slot

    with heavy_job_slot("beat_extraction", track_id):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            import motor.motor_asyncio

            client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
            db = client[settings.mongo_db]

            loop.run_until_complete(detect_beats_for_track_with_db(track_id, db))
        except Exception as e:  # pragma: no cover
            logger.warning("run_track_beat_extraction_in_background(%s): %s", track_id, e)
        finally:
            loop.close()
