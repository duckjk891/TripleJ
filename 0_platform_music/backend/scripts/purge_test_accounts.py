"""테스트·탈퇴 계정 완전 삭제 (1회성 운영 스크립트).

대상 = 테스트 도메인 이메일 계정 + 이미 탈퇴(익명화) 처리된 계정. 그 외 계정은 거부한다.
기본은 dry-run(건수만 출력). --execute 일 때만 삭제.
반드시 먼저 pg_dump / mongodump 백업을 떠둘 것.

삭제 범위
  Mongo : tracks 는 purge_track_document(MinIO 오디오·커버·ES 색인·임베딩·좋아요까지),
          그 외 컬렉션은 사용자 필드 기준 delete_many, DM 대화방은 참여자 기준
  PG    : 사용자 참조 행(admin_logs·reports(+appeals)·user_consents·user_violations·ad_wishlist·
          feed_likes) → users (follows·likes·playlists 는 FK CASCADE)
  Redis : session:<id>, stats:dau:* 에서 제거

실행: docker cp scripts/purge_test_accounts.py maidol-app:/tmp/ &&
      docker exec -w /srv/app maidol-app python /tmp/purge_test_accounts.py [--execute]
"""
import asyncio
import sys
import uuid

sys.path.insert(0, "/srv/app")
from app.config import settings  # noqa: E402
from app.database import postgres as pg_mod  # noqa: E402
from app.database.elasticsearch import init_elasticsearch  # noqa: E402
from app.database.minio import init_minio  # noqa: E402
from app.database.mongodb import get_mongo, init_mongodb  # noqa: E402
from app.database.postgres import init_postgres  # noqa: E402
from app.database.redis import get_redis, init_redis  # noqa: E402
from app.routes.tracks import purge_track_document  # noqa: E402

TEST_DOMAINS = {
    "test.com", "test.local", "test.invalid", "example.com", "test.aidol.local",
    "test.aidol.kr", "test.example.com", "t.co", "t.com", "aidol.test",
}

# (컬렉션, 사용자 필드)
MONGO_USER_FIELDS = [
    ("ad_clicks", "user_id"), ("ad_clicks", "star_user_id"),
    ("ad_impressions", "user_id"),
    ("ad_wish_events", "actor_user_id"), ("ad_wish_events", "star_user_id"),
    ("attendance_progress", "user_id"), ("character_jobs", "user_id"), ("characters", "user_id"),
    ("cover_sessions", "user_id"), ("director_fatigue", "user_id"), ("dm_messages", "sender_id"),
    ("download_logs", "user_id"), ("frontend_errors", "user_id"), ("generations", "user_id"),
    ("issue_reports", "user_id"), ("lyrics_assets", "user_id"), ("notifications", "user_id"),
    ("play_logs", "user_id"), ("point_balances", "user_id"), ("point_events", "user_id"),
    ("reward_balances", "user_id"), ("search_clicks", "user_id"), ("search_logs", "user_id"),
    ("user_slots", "user_id"), ("voice_clones", "user_id"), ("tutorial_seen", "user_id"),
    ("mv_jobs", "user_id"), ("inst_jobs", "user_id"), ("vocal_repairs", "user_id"),
    ("feeds", "author_id"), ("feed_comments", "author_id"), ("analytics_events", "user_id"),
]

PG_USER_TABLES = [
    ("admin_logs", "admin_id"), ("user_consents", "user_id"), ("user_violations", "user_id"),
    ("ad_wishlist", "user_id"), ("feed_likes", "user_id"),
    ("face_biometrics", "user_id"), ("face_photo_verifications", "user_id"),
]


async def main(execute: bool):
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    try:
        await init_elasticsearch(settings.es_url)
    except Exception as e:
        print("WARN elasticsearch init failed:", e)

    pool = pg_mod._pool
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id::text AS id, email, account_status, role FROM users")
    targets = [
        r for r in rows
        if (r["email"] or "").split("@")[-1].lower() in TEST_DOMAINS or r["account_status"] == "withdrawn"
    ]
    ids = [r["id"] for r in targets]
    print(f"users total={len(rows)} targets={len(ids)} "
          f"(test_domain={sum(1 for r in targets if r['account_status'] != 'withdrawn')}, "
          f"withdrawn={sum(1 for r in targets if r['account_status'] == 'withdrawn')}) "
          f"keep={len(rows) - len(ids)}")
    print("MODE:", "EXECUTE" if execute else "DRY-RUN")
    if not ids:
        return

    mongo = get_mongo()
    uuids = [uuid.UUID(i) for i in ids]

    # --- tracks (완전 파기 함수) ---
    tracks = await mongo.tracks.find({"uploader_id": {"$in": ids}}).to_list(length=None)
    print(f"tracks: {len(tracks)} {[t.get('title') for t in tracks]}")
    if execute:
        async with pool.acquire() as conn:
            for t in tracks:
                res = await purge_track_document(t, conn)
                print("  purged track", res.get("track_id"), res.get("removed"))

    # --- DM 대화방 (참여자) ---
    conv_ids = [str(c["_id"]) for c in await mongo.dm_conversations.find(
        {"participants": {"$in": ids}}, {"_id": 1}).to_list(length=None)]
    conv_msgs = await mongo.dm_messages.count_documents({"conversation_id": {"$in": conv_ids}}) if conv_ids else 0
    print(f"dm_conversations(participants): {len(conv_ids)}  messages in them: {conv_msgs}")
    if execute and conv_ids:
        await mongo.dm_messages.delete_many({"conversation_id": {"$in": conv_ids}})
        await mongo.dm_conversations.delete_many({"participants": {"$in": ids}})

    # --- 나머지 컬렉션 ---
    for coll, field in MONGO_USER_FIELDS:
        n = await mongo[coll].count_documents({field: {"$in": ids}})
        if n:
            print(f"{coll}.{field}: {n}")
            if execute:
                await mongo[coll].delete_many({field: {"$in": ids}})

    # --- PostgreSQL ---
    async with pool.acquire() as conn:
        rep_ids = [r["id"] for r in await conn.fetch(
            "SELECT id FROM reports WHERE reporter_id::text = ANY($1::text[])", ids)]
        print(f"reports(reporter): {len(rep_ids)}")
        for table, col in PG_USER_TABLES:
            cnt = await conn.fetchval(f"SELECT count(*) FROM {table} WHERE {col}::text = ANY($1::text[])", ids)
            if cnt:
                print(f"{table}.{col}: {cnt}")
        if execute:
            async with conn.transaction():
                if rep_ids:
                    await conn.execute("DELETE FROM report_appeals WHERE report_id = ANY($1::uuid[])", rep_ids)
                    await conn.execute("DELETE FROM reports WHERE id = ANY($1::uuid[])", rep_ids)
                for table, col in PG_USER_TABLES:
                    await conn.execute(f"DELETE FROM {table} WHERE {col}::text = ANY($1::text[])", ids)
                res = await conn.execute("DELETE FROM users WHERE id = ANY($1::uuid[])", uuids)
                print("users:", res)
            remaining = await conn.fetchval("SELECT count(*) FROM users")
            print("users remaining:", remaining)

    # --- Redis ---
    if execute:
        redis = get_redis()
        await redis.delete(*[f"session:{i}" for i in ids])
        async for key in redis.scan_iter(match="stats:dau:*"):
            await redis.srem(key, *ids)
        print("redis sessions/dau cleaned")


if __name__ == "__main__":
    asyncio.run(main("--execute" in sys.argv))
