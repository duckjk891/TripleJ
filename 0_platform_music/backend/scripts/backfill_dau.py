"""관리자 대시보드 일별 접속자(stats:dau:YYYYMMDD) 1회성 백필.

실시간 기록(auth._touch_dau)이 배포 시점부터 시작되므로, 과거 N일은 기존 활동 로그
(재생·포인트·착장 노출·곡 생성·다운로드·가입)에 user_id 가 남은 사용자로 채운다.
활동 없이 앱만 연 사용자는 빠지므로 과거 값은 실제보다 약간 낮다. SADD 라 재실행해도 안전.

실행: docker cp scripts/backfill_dau.py maidol-app:/tmp/ &&
      docker exec -w /srv/app maidol-app python /tmp/backfill_dau.py [days]
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

import asyncpg
import redis.asyncio as aioredis
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, "/srv/app")
from app.auth import DAU_KEY_PREFIX, DAU_TTL  # noqa: E402
from app.config import settings  # noqa: E402

KST = timezone(timedelta(hours=9))

SOURCES = [
    ("play_logs", "played_at"),
    ("point_events", "created_at"),
    ("ad_impressions", "timestamp"),
    ("ad_clicks", "timestamp"),
    ("generations", "created_at"),
    ("download_logs", "downloaded_at"),
]


async def main(days: int):
    since = datetime.combine(
        datetime.now(KST).date() - timedelta(days=days - 1), datetime.min.time(), tzinfo=KST
    ).astimezone(timezone.utc)

    by_day: dict = {}

    def add(day_key: str, uid):
        if uid:
            by_day.setdefault(day_key, set()).add(str(uid))

    mc = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mc[settings.mongo_db]
    for coll, field in SOURCES:
        n = 0
        async for doc in db[coll].aggregate([
            {"$match": {field: {"$gte": since.replace(tzinfo=None)}, "user_id": {"$nin": [None, ""]}}},
            {"$project": {"user_id": 1, "d": {"$dateToString": {"format": "%Y%m%d", "date": f"${field}", "timezone": "+09:00"}}}},
        ]):
            add(doc["d"], doc["user_id"])
            n += 1
        print(f"{coll}: {n} events")

    conn = await asyncpg.connect(settings.postgres_dsn)
    rows = await conn.fetch(
        "SELECT id, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') AS d FROM users WHERE created_at >= $1",
        since,
    )
    await conn.close()
    for r in rows:
        add(r["d"], r["id"])
    print(f"signups: {len(rows)}")

    r = aioredis.from_url(settings.computed_redis_url, decode_responses=True)
    for day, uids in sorted(by_day.items()):
        key = f"{DAU_KEY_PREFIX}{day}"
        await r.sadd(key, *uids)
        await r.expire(key, DAU_TTL)
        print(f"{key}: +{len(uids)} -> {await r.scard(key)}")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 30))
