"""admin-web 1004 — 과거 "[오류신고: 사유] …" DM 을 관리자 '오류 신고'(issue_reports)로 소급 접수.

앱의 문의하기(오류 신고)가 공식 계정 DM 으로만 가던 기간의 메시지를 대상으로 한다.
dm_message_id 로 중복 방지(재실행 안전). 접수 시각은 원래 메시지 시각.

실행(컨테이너 안, dry-run 기본):
    docker exec -i maidol-app python - < backfill_dm_issues.py            # 건수만
    docker exec -i maidol-app python - --apply < backfill_dm_issues.py    # 반영
"""
import asyncio
import sys

APPLY = "--apply" in sys.argv


async def main():
    import asyncpg
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.config import settings
    from app.routes.issues import create_issue_from_dm, parse_dm_issue

    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    conn = await asyncpg.connect(settings.postgres_dsn)
    try:
        row = await conn.fetchrow("SELECT id::text AS id FROM users WHERE email = $1", settings.official_account_email)
    finally:
        await conn.close()
    if not row:
        print("official account not found — abort")
        return
    official = row["id"]

    conv_ids = [str(c["_id"]) async for c in db.dm_conversations.find({"participants": official}, {"_id": 1})]
    found = created = skipped = 0
    cursor = db.dm_messages.find(
        {"conversation_id": {"$in": conv_ids}, "sender_id": {"$ne": official}, "text": {"$regex": r"^\s*\[오류신고"}}
    ).sort("created_at", 1)
    async for m in cursor:
        if not parse_dm_issue(m.get("text")):
            continue
        found += 1
        names = list(m.get("image_object_names") or ([m["image_object_name"]] if m.get("image_object_name") else []))
        message = {"id": str(m["_id"]), "conversation_id": m.get("conversation_id"), "text": m.get("text"),
                   "image_object_names": names}
        if not APPLY:
            exists = await db.issue_reports.find_one({"dm_message_id": message["id"]}, {"_id": 1})
            skipped += 1 if exists else 0
            continue
        issue_id = await create_issue_from_dm(db, m.get("sender_id"), message, created_at=m.get("created_at"))
        if issue_id:
            created += 1
        else:
            skipped += 1
    print("mode={} conversations={} matched={} created={} already={}".format(
        "apply" if APPLY else "dry-run", len(conv_ids), found, created, skipped))


asyncio.run(main())
