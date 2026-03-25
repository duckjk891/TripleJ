import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

from .config import settings
from .database.postgres import init_postgres, close_postgres
from .database.mongodb import init_mongodb, close_mongodb
from .database.redis import init_redis, close_redis
from .database.minio import init_minio
from .routes import admin, auth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character, voice_persona, voice_convert


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

    # Start background scheduler for playcount sync
    from .services.playcount_sync import start_playcount_scheduler
    scheduler = start_playcount_scheduler()

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
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


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "서버 내부 오류가 발생했습니다."})
