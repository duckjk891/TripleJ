import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# v67-pre: app 모듈 logger 가 stdout 으로 출력되도록 root logger 설정.
# 이전엔 uvicorn 의 access 로그만 stdout 으로 나와서 우리 logger.info 등이
# server.log 에 안 찍혔음. INFO 레벨 + 단순 포맷.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
    force=True,
)

load_dotenv()

from .config import settings
from .database.postgres import init_postgres, close_postgres
from .database.mongodb import init_mongodb, close_mongodb
from .database.redis import init_redis, close_redis
from .database.minio import init_minio
from .database.elasticsearch import init_elasticsearch, get_es, close_elasticsearch
from .routes import admin, auth, oauth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character, voice_persona, voice_clone, voice_convert, vocal_repair, wondera, rewards, business, points, _logs


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to all databases
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    print("All database connections established.")

    # v89 — ensure playlists.description column exists (idempotent, safe across shared DB backends)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE playlists ADD COLUMN IF NOT EXISTS description TEXT")
        print("[migration] playlists.description ensured")
    except Exception as _e:
        logging.getLogger(__name__).warning("[migration] playlists.description ensure failed: %s", _e)

    # Social OAuth — ensure users.provider columns + uniqueness, allow NULL password_hash
    # (소셜 가입 계정은 비밀번호가 없음). 멱등, 공유 DB 안전.
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'local'")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id TEXT")
            await _conn.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
            await _conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_provider_uid "
                "ON users(provider, provider_user_id) WHERE provider_user_id IS NOT NULL"
            )
        print("[migration] users.provider ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.provider ensure failed: %s", _e)

    # VectorSearch — ensure pgvector extension + track_embeddings table/index (idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS track_embeddings ("
                "track_id TEXT PRIMARY KEY, "
                "embedding vector(1536), "
                "content_hash TEXT, "
                "model TEXT, "
                "updated_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS track_embeddings_hnsw "
                "ON track_embeddings USING hnsw (embedding vector_cosine_ops)"
            )
        print("[migration] track_embeddings ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] track_embeddings ensure failed: %s", _e)

    # HybridSearch — connect Elasticsearch + ensure the `tracks` index exists
    # (nori analyzer, idempotent), then schedule a non-blocking self-heal backfill:
    # if the ES index emptied/drifted across a restart, re-index public tracks from
    # Mongo so search never silently degrades to vector-only. Never break startup if
    # ES is down: log + continue.
    try:
        await init_elasticsearch(settings.es_url)
        es = get_es()
        from .services.search_service import ensure_tracks_index, backfill_es_if_needed
        await ensure_tracks_index(es)
        print("[migration] es tracks index ensured")

        import asyncio as _es_asyncio
        from .database.mongodb import get_mongo as _get_mongo
        _mongo_db = _get_mongo()
        _es_asyncio.create_task(backfill_es_if_needed(es, _mongo_db, force=False))
        print("[migration] es backfill check scheduled")
    except Exception as _e:
        logging.getLogger(__name__).warning("[migration] es tracks index/backfill ensure failed: %s", _e)

    # Recover stuck MV jobs (active status but no running task after server restart)
    try:
        from .database.mongodb import get_mongo
        mongo = get_mongo()
        stuck_result = await mongo.mv_jobs.update_many(
            {"status": {"$in": ["splitting", "generating_images", "generating_videos", "concatenating"]}},
            {"$set": {"status": "paused", "error_message": "서버 재시작으로 인해 중지됨", "cancel_requested": False, "retry_info": None}},
        )
        if stuck_result.modified_count > 0:
            print(f"Recovered {stuck_result.modified_count} stuck MV jobs → paused")
    except Exception as e:
        print(f"MV job recovery failed: {e}")

    # Recover stale character sheet jobs — a `processing` job older than 30min
    # has lost its background task (e.g. server restart) and will never finish.
    # Points: each recovered job also refunds its pre-deducted points (once —
    # guarded by the atomic `refunded` flag shared with the async runner).
    try:
        from .database.mongodb import get_mongo
        from .routes.character import refund_character_job_points
        mongo = get_mongo()
        _stale_filter = {
            "status": "processing",
            "created_at": {"$lt": datetime.utcnow() - timedelta(minutes=30)},
        }
        _n_failed = 0
        _n_refunded = 0
        async for _job in mongo.character_jobs.find(_stale_filter, {"_id": 1}):
            _claimed = await mongo.character_jobs.find_one_and_update(
                {"_id": _job["_id"], "status": "processing"},
                {"$set": {
                    "status": "failed",
                    "error": "서버 재시작으로 중단됨",
                    "updated_at": datetime.utcnow(),
                }},
            )
            if not _claimed:
                continue  # 러너/타 워커가 그 사이 상태를 바꿈 — 건드리지 않음
            _n_failed += 1
            if await refund_character_job_points(mongo, _job["_id"]):
                _n_refunded += 1
        if _n_failed > 0:
            print(f"[migration] character_jobs stale recovered n={_n_failed} refunded={_n_refunded}")
    except Exception as e:
        print(f"[migration] character_jobs stale recovery failed: {e}")

    # v44 — Recover stuck beat extractions (running → pending) and re-trigger
    try:
        from .database.mongodb import get_mongo
        import asyncio as _asyncio
        mongo = get_mongo()

        # Reset stuck "running" rows back to pending
        gen_reset = await mongo.generations.update_many(
            {"beats_status": "running"},
            {"$set": {"beats_status": "pending"}},
        )
        track_reset = await mongo.tracks.update_many(
            {"beats_status": "running"},
            {"$set": {"beats_status": "pending"}},
        )
        if gen_reset.modified_count or track_reset.modified_count:
            print(
                f"Recovered stuck beat extractions: generations={gen_reset.modified_count}, tracks={track_reset.modified_count} → pending"
            )

        # Re-trigger pending extractions for completed generations
        from .services.beat_extraction import (
            detect_beats_for_generation,
            detect_beats_for_track,
        )
        pending_gens = await mongo.generations.find(
            {
                "beats_status": "pending",
                "status": "completed",
                "result_audio_url": {"$ne": None},
            },
            {"_id": 1},
        ).to_list(length=200)
        for g in pending_gens:
            _asyncio.create_task(detect_beats_for_generation(str(g["_id"])))
        if pending_gens:
            print(f"Re-triggered beat extraction for {len(pending_gens)} pending generations")

        pending_tracks = await mongo.tracks.find(
            {"beats_status": "pending", "audio_url": {"$ne": None}},
            {"_id": 1},
        ).to_list(length=200)
        for t in pending_tracks:
            _asyncio.create_task(detect_beats_for_track(str(t["_id"])))
        if pending_tracks:
            print(f"Re-triggered beat extraction for {len(pending_tracks)} pending tracks")
    except Exception as e:
        print(f"Beat extraction recovery failed: {e}")

    # Recover Redis chart data from MongoDB
    try:
        from .database.redis import get_redis
        from .services.chart_recovery import rebuild_redis_from_mongo
        redis = get_redis()
        await rebuild_redis_from_mongo(mongo, redis)
    except Exception as e:
        print(f"Chart data recovery failed: {e}")

    # Start background task for playcount sync
    from .services.playcount_sync import start_playcount_scheduler
    sync_task = start_playcount_scheduler()

    # Start background task for MV asset cleanup (24h retention, hourly sweep)
    import asyncio as _asyncio
    from .services.mv_assets import cleanup_loop as _mv_asset_cleanup_loop
    asset_cleanup_task = _asyncio.create_task(_mv_asset_cleanup_loop(3600))

    yield

    # Shutdown
    sync_task.cancel()
    asset_cleanup_task.cancel()
    await close_postgres()
    await close_mongodb()
    await close_redis()
    try:
        await close_elasticsearch()
    except Exception as _e:
        logging.getLogger(__name__).warning("[shutdown] es close failed: %s", _e)
    print("All database connections closed.")


app = FastAPI(title="AIMU Platform API v2", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(admin.router)
app.include_router(tracks.router)
app.include_router(albums.router)
app.include_router(artists.router)
app.include_router(charts.router)
app.include_router(playlists.router)
app.include_router(likes.router)
app.include_router(upload.router)
app.include_router(follows.router)
app.include_router(generate.router)
app.include_router(mv.router)
app.include_router(character.router)
app.include_router(voice_persona.router)
app.include_router(voice_clone.router)
app.include_router(voice_convert.router)
app.include_router(vocal_repair.router)
app.include_router(wondera.router)
app.include_router(rewards.router)
app.include_router(business.router)
app.include_router(points.router)
app.include_router(_logs.router, prefix="/api/_logs", tags=["_logs"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "서버 내부 오류가 발생했습니다."})
