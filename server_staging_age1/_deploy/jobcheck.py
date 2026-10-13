"""진행 작업 4종 건수(메모리 ec2-deploy-run-command) — maidol-app 컨테이너 안에서 실행. 출력: 'total=N detail'."""
import asyncio
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings


async def main():
    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    since = datetime.now(timezone.utc) - timedelta(minutes=30)
    c = {
        "gen_jobs": await db.gen_jobs.count_documents({"status": {"$in": ["pending", "running", "processing"]}}),
        "generations": await db.generations.count_documents(
            {"status": {"$in": ["pending", "processing", "generating"]}, "created_at": {"$gte": since}}),
        "character_jobs": await db.character_jobs.count_documents({"status": "processing"}),
        "inst_jobs": await db.inst_jobs.count_documents({"active": True, "status": {"$in": ["pending", "processing"]}}),
    }
    print(f"total={sum(c.values())} {c}")

asyncio.run(main())
