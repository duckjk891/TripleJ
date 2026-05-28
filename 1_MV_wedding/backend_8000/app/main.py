import os
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    force=True,
)

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv()

from .config import settings
from .database.postgres import init_postgres, close_postgres
from .database.mongodb import init_mongodb, close_mongodb, ensure_indexes
from .database.redis import init_redis, close_redis
from .database.minio import init_minio, get_minio
from .routes import (
    admin,
    assets,
    auth,
    character,
    mv,
    places,
    pre_mv,
    share,
    story,
    wedding_photos,
)
from .services.outfit_seeder import seed_outfits
from .services.admin_seeder import seed_admin


REQUIRED_BUCKETS = (
    settings.minio_bucket_photos,
    settings.minio_bucket_audio,
    settings.minio_bucket_videos,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to all databases
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    print("All database connections established.")

    # Ensure MinIO buckets exist (one-shot, idempotent)
    try:
        client = get_minio()
        for bucket in REQUIRED_BUCKETS:
            if not client.bucket_exists(bucket):
                client.make_bucket(bucket)
                print(f"Created MinIO bucket: {bucket}")
            else:
                print(f"MinIO bucket exists: {bucket}")
    except Exception as e:
        print(f"MinIO bucket ensure failed: {e}")

    # v17.0 — Mongo 인덱스 ensure (멱등). pre_mv_jobs 등 신규 컬렉션 대비.
    try:
        await ensure_indexes()
    except Exception as e:
        print(f"[Startup] ensure_indexes failed: {type(e).__name__}: {e}")

    # v11 — seed admin account (idempotent — checked by email lookup).
    try:
        await seed_admin()
    except Exception as e:
        print(f"[Startup] seed_admin failed: {type(e).__name__}: {e}")

    # Seed wedding outfit catalog (idempotent — checked by collection count).
    try:
        await seed_outfits()
    except Exception as e:
        print(f"[Startup] seed_outfits failed: {type(e).__name__}: {e}")

    yield

    # Shutdown
    await close_postgres()
    await close_mongodb()
    await close_redis()
    print("All database connections closed.")


app = FastAPI(title="Wedding MV Studio API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(story.router)
app.include_router(mv.router)
app.include_router(character.router)
app.include_router(assets.router)
app.include_router(share.router)
app.include_router(places.router)
app.include_router(wedding_photos.router)
app.include_router(pre_mv.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "서버 내부 오류가 발생했습니다."})
