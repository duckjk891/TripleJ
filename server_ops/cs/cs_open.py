# MAIDOL CS 미답변 조회(읽기 전용). 사용: 컨테이너에 복사 후 docker exec -e PYTHONPATH=/srv/app maidol-app python /tmp/cs_open.py
# 내부 테스트 대화(무신사·이재규어·lovvepearl↔무신사·오리쟁이↔무신사)는 답장 대상 아님.
import asyncio, asyncpg
from datetime import timezone, timedelta
from app.config import settings
from app.database import mongodb as M

KST = timezone(timedelta(hours=9))


def kst(dt):
    if not dt:
        return "?"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST).strftime("%m-%d %H:%M")


async def main():
    await M.init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    db = M.get_mongo()
    c = await asyncpg.connect(settings.postgres_dsn)
    offs = await c.fetch("SELECT id::text AS id, nickname, role FROM users WHERE email LIKE '%@lotusai.co.kr' OR role IN ('admin','customer','official')")
    off = {r["id"]: r["nickname"] for r in offs}
    print("공식/관리 계정:", [(r["nickname"], r["role"]) for r in offs])

    async def nick(uid):
        if not uid:
            return "?"
        return await c.fetchval("SELECT nickname FROM users WHERE id::text=$1", str(uid)) or str(uid)[:8]

    print("\n== 공식 계정 대화 중 마지막 메시지가 사용자 쪽인 것")
    async for cv in db.dm_conversations.find({"participants": {"$in": list(off)}}).sort("last_at", -1):
        if cv.get("last_sender_id") in off or not cv.get("last_sender_id"):
            continue
        cid = str(cv["_id"])
        peer = next((p for p in cv["participants"] if p not in off), None)
        offn = next((off[p] for p in cv["participants"] if p in off), "")
        pn = await nick(peer)
        print(f"\n[대화 {cid}] {pn} -> {offn}")
        msgs = [m async for m in db.dm_messages.find({"conversation_id": cid}).sort("created_at", -1).limit(6)]
        for m in reversed(msgs):
            who = "공식" if m.get("sender_id") in off else pn
            imgs = len(m.get("image_object_names") or ([1] if m.get("image_object_name") else []))
            extra = f" [사진 {imgs}장: {' '.join(m.get('image_object_names') or [m.get('image_object_name')])}]" if imgs else ""
            print(f"  {kst(m.get('created_at'))} {who}: {(m.get('text') or '')[:400]}{extra}")

    print("\n== 처리 안 된 오류 신고(issue_reports status=received)")
    async for r in db.issue_reports.find({"status": "received"}).sort("created_at", -1):
        pn = await nick(r.get("user_id"))
        print(f"- {r['_id']} {kst(r.get('created_at'))} {pn} reason={r.get('reason')} ver={r.get('app_version')} page={r.get('page_url')} dm={r.get('dm_conversation_id')}")
        print(f"    {(r.get('text') or '')[:500]}")

    print("\n== 상담 케이스 needs_admin")
    async for k in db.cs_cases.find({"status": "needs_admin"}).sort("created_at", -1):
        pn = await nick(k.get("user_id"))
        print(f"- {k['_id']} {kst(k.get('created_at'))} {pn} cat={k.get('category')} bug={k.get('is_bug_report')} conv={k.get('conversation_id')} reason={k.get('escalate_reason')}")
        print(f"    draft: {(k.get('ai_reply_final') or k.get('ai_reply') or '')[:300]!r}")
    await c.close()


asyncio.run(main())
