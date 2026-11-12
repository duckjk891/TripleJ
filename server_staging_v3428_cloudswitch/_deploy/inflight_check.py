# 읽기 전용 — 재기동 전 진행 작업 4종 건수(메모리 ec2-deploy-run-command). 0 0 0 0 일 때만 재기동.
import asyncio
from datetime import datetime, timedelta
from app.config import settings as s
from motor.motor_asyncio import AsyncIOMotorClient

ACTIVE = ["pending", "running", "processing", "queued", "generating"]


async def main():
    db = AsyncIOMotorClient(s.computed_mongo_url)[s.mongo_db]
    since = datetime.utcnow() - timedelta(minutes=30)
    out = {
        "gen_jobs": await db.gen_jobs.count_documents({"status": {"$in": ACTIVE}}),
        "generations_30m": await db.generations.count_documents(
            {"status": {"$in": ACTIVE}, "created_at": {"$gte": since}}),
        "character_jobs": await db.character_jobs.count_documents({"status": {"$in": ACTIVE}}),
        "inst_jobs": await db.inst_jobs.count_documents({"status": {"$in": ACTIVE}}),
    }
    print(out, "TOTAL", sum(out.values()))

asyncio.run(main())
