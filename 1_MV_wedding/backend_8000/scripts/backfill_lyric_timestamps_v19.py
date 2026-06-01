"""v19 백필 스크립트 — Suno 두 variant 의 timestamp 를 모두 채워 넣는다.

대상: mv_jobs.status="music_ready" 이고 suno_task_id 가 있는 잡.

동작:
  1) record-info 호출 → sunoData[] 에서 두 id 추출
  2) variant 별로 get_suno_timestamps 호출
  3) mv_jobs 도큐먼트에 다음 필드 업데이트:
       - suno_audio_ids: [id1, id2]
       - lyric_timestamps_variants: {"1": [...], "2": [...]}
       - lyric_timestamps_status: "ready" if any variant else "missing"
       - lyric_timestamps: variant 1 (회귀 호환)

멱등 — 두 번 돌려도 OK. 임시 운영 스크립트(git 커밋 의도 없음).

실행:
    cd backend_8000 && python scripts/backfill_lyric_timestamps_v19.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

import httpx

# 프로젝트 루트(backend_8000) 를 PYTHONPATH 에 추가.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.dirname(_THIS_DIR)
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from app.config import settings  # noqa: E402
from app.database.mongodb import (  # noqa: E402
    init_mongodb,
    get_mongo,
    close_mongodb,
)
from app.services.suno_timestamp_service import get_suno_timestamps  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s | %(message)s",
)
logger = logging.getLogger("backfill_v19")


async def _fetch_record_info(task_id: str) -> dict:
    """Suno record-info 응답 반환. 실패하면 {}."""
    if not settings.suno_api_key or not task_id:
        return {}
    base_url = (settings.suno_api_url or "").rstrip("/")
    url = f"{base_url}/api/v1/generate/record-info"
    headers = {
        "Authorization": f"Bearer {settings.suno_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=headers, params={"taskId": task_id})
            resp.raise_for_status()
            return resp.json() or {}
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "record-info fetch failed task_id=%s: %s: %s",
            task_id, type(e).__name__, str(e)[:200],
        )
        return {}


async def _process_job(job: dict) -> dict:
    """단일 잡 처리. 결과 메타 dict 반환."""
    job_id = str(job["_id"])
    task_id = (job.get("suno_task_id") or "").strip()
    if not task_id:
        return {"job_id": job_id, "skipped": "no_suno_task_id"}

    logger.info("backfill entry job_id=%s suno_task_id=%s", job_id, task_id)

    record = await _fetch_record_info(task_id)
    songs = (((record or {}).get("data") or {}).get("response") or {}).get("sunoData") or []
    if not songs:
        logger.warning(
            "backfill no songs in record-info job_id=%s suno_task_id=%s",
            job_id, task_id,
        )
        return {"job_id": job_id, "skipped": "no_songs"}

    suno_audio_ids: list[str] = []
    for s in songs:
        if not isinstance(s, dict):
            continue
        sid = (s.get("id") or "").strip()
        if sid:
            suno_audio_ids.append(sid)

    ts_by_variant: dict[str, list[dict]] = {}
    per_variant_counts: dict[str, int] = {}
    for idx, aid in enumerate(suno_audio_ids, start=1):
        try:
            ts = await get_suno_timestamps(task_id, aid)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "backfill timestamps fetch failed job_id=%s variant=%d audio_id=%s err=%s: %s",
                job_id, idx, aid, type(e).__name__, str(e)[:200],
            )
            ts = []
        per_variant_counts[str(idx)] = len(ts or [])
        if ts:
            ts_by_variant[str(idx)] = ts
        logger.info(
            "[Backfill v19] mv_job=%s variant=%d segments=%d",
            job_id, idx, len(ts or []),
        )

    mongo = get_mongo()
    update_doc: dict = {
        "suno_audio_ids": suno_audio_ids,
        "lyric_timestamps_variants": ts_by_variant,
        "lyric_timestamps_status": "ready" if ts_by_variant else "missing",
        "updated_at": datetime.now(timezone.utc),
    }
    # 회귀 호환 — variant 1 timestamps 가 있으면 단수 필드에 동일하게 저장.
    if ts_by_variant.get("1"):
        update_doc["lyric_timestamps"] = ts_by_variant["1"]

    try:
        from bson import ObjectId
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": update_doc},
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "backfill mongo update failed job_id=%s err=%s: %s",
            job_id, type(e).__name__, str(e)[:200],
        )
        return {
            "job_id": job_id,
            "audio_ids_count": len(suno_audio_ids),
            "variant_counts": per_variant_counts,
            "updated": False,
        }

    logger.info(
        "backfill ok job_id=%s audio_ids_count=%d variants=%s",
        job_id, len(suno_audio_ids), per_variant_counts,
    )
    return {
        "job_id": job_id,
        "audio_ids_count": len(suno_audio_ids),
        "variant_counts": per_variant_counts,
        "updated": True,
    }


async def main() -> None:
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    mongo = get_mongo()

    cursor = mongo.mv_jobs.find(
        {
            "status": "music_ready",
            "suno_task_id": {"$exists": True, "$ne": ""},
        }
    )

    jobs: list[dict] = []
    async for d in cursor:
        jobs.append(d)

    logger.info("backfill start total_jobs=%d", len(jobs))

    results: list[dict] = []
    backfilled = 0
    for job in jobs:
        r = await _process_job(job)
        results.append(r)
        if r.get("updated"):
            backfilled += 1

    print("")
    print("=== v19 backfill summary ===")
    for r in results:
        print(
            "job_id={job_id} audio_ids={a} variants={v} updated={u} skipped={s}".format(
                job_id=r.get("job_id"),
                a=r.get("audio_ids_count"),
                v=r.get("variant_counts"),
                u=r.get("updated"),
                s=r.get("skipped"),
            )
        )
    print("backfilled_count=%d / total=%d" % (backfilled, len(jobs)))

    await close_mongodb()


if __name__ == "__main__":
    asyncio.run(main())
