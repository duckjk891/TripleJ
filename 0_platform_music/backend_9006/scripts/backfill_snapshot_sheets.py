"""SnapFix backfill — pin existing character snapshots to immutable sheet copies.

대상: `tracks` / `mv_jobs` 의 `user_character_snapshot.sheet_object_name` 이
가변 영구 경로(`characters/{uid}/sheet.png` · `sheet_virtual.png`)를 가리키는
문서. 각 문서에 대해:

  1. 현재 그 경로의 MinIO 파일을 불변 경로 `character_snapshots/{user_id}/{uuid}.png`
     로 서버측 복사 (snapshot_service.snapshot_sheet_copy 재사용)
  2. 스냅샷의 sheet_object_name 을 사본 경로로 교체하고 원본 경로를
     sheet_object_name_origin 에 보존
  3. 관련 트랙의 Redis 캐시 `cache:track:v2:{track_id}` 삭제
     (mv_jobs 는 audio_generation_id 로 연결된 트랙 캐시도 삭제)

원본 파일이 MinIO 에 없으면 스킵+로그.

주의: 캐릭터를 이미 재생성해 시트가 덮어써진 곡은 발행 당시 이미지를 복원할
수 없다 — 이 백필은 "현재 파일" 기준 사본을 만들며, 이후의 재생성/삭제로부터
격리하는 것이 목적이다.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/backfill_snapshot_sheets.py
"""

import asyncio
import logging
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import redis.asyncio as aioredis
from minio import Minio
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.snapshot_service import snapshot_sheet_copy

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s", stream=sys.stdout)
logger = logging.getLogger("backfill_snapshot_sheets")

# 가변 영구 시트 경로 패턴 (real/virtual 슬롯)
MUTABLE_SHEET_RE = re.compile(r"^characters/[^/]+/sheet(_virtual)?\.png$")

QUERY = {
    "user_character_snapshot.sheet_object_name": {
        "$regex": r"^characters/[^/]+/sheet(_virtual)?\.png$",
    }
}


def _object_exists(minio_client: Minio, object_name: str) -> bool:
    try:
        minio_client.stat_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        return True
    except Exception:
        return False


async def _delete_track_cache(redis, track_id: str, counters: dict) -> None:
    try:
        deleted = await redis.delete(f"cache:track:v2:{track_id}")
        if deleted:
            counters["cache_deleted"] += 1
    except Exception as e:
        logger.warning("redis cache delete failed track=%s: %s", track_id, e)


async def _backfill_collection(db, minio_client, redis, coll_name: str, user_id_field: str, counters: dict) -> None:
    coll = db[coll_name]
    cursor = coll.find(QUERY)
    async for doc in cursor:
        doc_id = doc["_id"]
        snap = doc.get("user_character_snapshot") or {}
        src = snap.get("sheet_object_name")
        user_id = doc.get(user_id_field) or "unknown"

        if not src or not MUTABLE_SHEET_RE.match(src):
            continue  # defensive — query already filtered

        if not _object_exists(minio_client, src):
            counters["skip"] += 1
            logger.info("[skip] %s %s — source missing in MinIO: %s", coll_name, doc_id, src)
            continue

        new_object = snapshot_sheet_copy(minio_client, user_id, src)
        if not new_object:
            counters["err"] += 1
            logger.warning("[err] %s %s — copy failed for %s", coll_name, doc_id, src)
            continue

        await coll.update_one(
            {"_id": doc_id},
            {"$set": {
                "user_character_snapshot.sheet_object_name": new_object,
                "user_character_snapshot.sheet_object_name_origin": src,
            }},
        )
        counters["ok"] += 1
        logger.info("[ok] %s %s user=%s %s -> %s", coll_name, doc_id, user_id, src, new_object)

        # 캐시 무효화
        if coll_name == "tracks":
            await _delete_track_cache(redis, str(doc_id), counters)
        else:  # mv_jobs — 연결된 트랙 캐시 삭제
            gen_id = doc.get("audio_generation_id")
            if gen_id:
                async for t in db.tracks.find({"generation_id": gen_id}, {"_id": 1}):
                    await _delete_track_cache(redis, str(t["_id"]), counters)


async def _run() -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]
    minio_client = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )
    redis = aioredis.from_url(settings.computed_redis_url, decode_responses=True)

    counters = {"ok": 0, "skip": 0, "err": 0, "cache_deleted": 0}
    try:
        n_tracks = await db.tracks.count_documents(QUERY)
        n_jobs = await db.mv_jobs.count_documents(QUERY)
        logger.info("targets: tracks=%d mv_jobs=%d", n_tracks, n_jobs)

        await _backfill_collection(db, minio_client, redis, "tracks", "uploader_id", counters)
        await _backfill_collection(db, minio_client, redis, "mv_jobs", "user_id", counters)

        logger.info(
            "done ok=%d skip=%d err=%d cache_deleted=%d",
            counters["ok"], counters["skip"], counters["err"], counters["cache_deleted"],
        )
    finally:
        await redis.aclose()
        mongo_client.close()
    return 0 if counters["err"] == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_run()))
