import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

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
from .routes import admin, auth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character, voice_persona, voice_convert, vocal_repair, wondera, rewards, business, _logs


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to all databases
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    print("All database connections established.")

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
app.include_router(voice_convert.router)
app.include_router(vocal_repair.router)
app.include_router(wondera.router)
app.include_router(rewards.router)
app.include_router(business.router)
app.include_router(_logs.router, prefix="/api/_logs", tags=["_logs"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "서버 내부 오류가 발생했습니다."})
