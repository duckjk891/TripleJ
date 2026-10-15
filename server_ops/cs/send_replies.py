# 공식 계정 답장 발송(대표 승인된 문구만!). 입력 /tmp/dm_msgs.json = [{who,cid,text,issue_id?,status?,issue_note?}]
# 발송 → cs_cases admin_answered → issue_reports 상태(status 기본 in_progress)·메모.
import asyncio, asyncpg, json, sys
from datetime import datetime, timezone
from bson import ObjectId
from app.config import settings
from app.database import mongodb as M
from app.routes.admin_cs import _resolve_official
from app.services import dm_service, cs_worker

MSGS = json.load(open("/tmp/dm_msgs.json", encoding="utf-8"))

async def main():
    await M.init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    db = M.get_mongo()
    conn = await asyncpg.connect(settings.postgres_dsn)
    official = await _resolve_official(conn)
    admin_id = await conn.fetchval("SELECT id::text FROM users WHERE nickname='관리자' AND role='admin'")
    for m in MSGS:
        cid = m["cid"]
        conv = await db.dm_conversations.find_one({"_id": ObjectId(cid)})
        assert conv and official in conv["participants"], cid
        msg = await dm_service.send_message(conn, db, official, cid, m["text"])
        n = await cs_worker.on_admin_reply(db, cid, admin_id, msg.get("id"))
        print("SENT", m["who"], cid[:8], "msg", str(msg.get("id"))[:8], "cases->admin_answered", n)
        if m.get("issue_id"):
            r = await db.issue_reports.update_one({"_id": ObjectId(m["issue_id"])}, {"$set": {
                "status": m.get("status", "in_progress"), "handled_by": admin_id, "handled_at": datetime.now(timezone.utc),
                "admin_note": m["issue_note"]}})
            print("  issue in_progress", r.modified_count)
    await conn.close()

asyncio.run(main())
