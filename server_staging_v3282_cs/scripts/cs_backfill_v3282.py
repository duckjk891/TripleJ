"""v3.282 — 기존 미답 CS 문의 → cs_cases 초안(shadow) 1회성 백필. **실제 발송 없음**(모드 강제 shadow).

기본은 --dry-run: LLM 호출·DB 쓰기 없이 대상 대화·미처리 메시지 수·사전 규칙(강제 이관/상담원 요청/
오류신고 머리말)만 출력한다. 메시지 본문은 출력하지 않는다.

  # 컨테이너 안(배포 후 이미지에 포함 — PYTHONPATH 필요)
  sudo docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python -B scripts/cs_backfill_v3282.py
  # 실제 초안 생성(LLM 호출, cs_cases 저장, 발송 없음) — 1~2건만 먼저
  sudo docker exec -w /srv/app -e PYTHONPATH=/srv/app maidol-app python -B scripts/cs_backfill_v3282.py --apply --limit 2 --print-drafts
  # 특정 대화만
  ... --apply --conversation <cid> --print-drafts

옵션: --apply(초안 생성) · --limit N(대화 수) · --conversation CID · --days N(미처리 메시지 조회 기간, 기본 120)
      · --print-drafts(생성된 초안·판정 출력 — 운영자 검토용)
"""

import argparse
import asyncio
from datetime import datetime, timedelta, timezone


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="기본값(명시용)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--conversation", default="")
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--print-drafts", action="store_true")
    args = ap.parse_args()
    apply = bool(args.apply)

    from app.config import settings
    from app.database import postgres as _pg
    from app.database.mongodb import init_mongodb, get_mongo, close_mongodb
    from app.database.postgres import init_postgres, close_postgres
    from app.database.redis import init_redis, close_redis
    from app.services import cs_worker
    from app.services.official import get_official_id

    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    try:
        mongo = get_mongo()
        async with _pg._pool.acquire() as conn:
            official_id = await get_official_id(conn)
        if not official_id:
            print("[cs-backfill] 공식 계정 없음 — 중단")
            return
        since = datetime.now(timezone.utc) - timedelta(days=args.days)
        flt = {"participants": official_id}
        if args.conversation:
            flt["_id"] = cs_worker._oid(args.conversation)
        convs = await mongo.dm_conversations.find(flt, {"_id": 1, "participants": 1}).sort("last_at", -1).to_list(length=2000)
        targets = []
        for c in convs:
            cid = str(c["_id"])
            pending, _ = await cs_worker.load_pending(mongo, cid, official_id, since)
            if pending:
                targets.append((cid, c, pending))
        print(f"[cs-backfill] 공식 대화 {len(convs)}건 중 미처리 {len(targets)}건 · 메시지 {sum(len(p) for _, _, p in targets)}개 "
              f"(apply={apply}, 기간 {args.days}일, 발송 없음)")
        if args.limit:
            targets = targets[: args.limit]
        made = 0
        for cid, c, pending in targets:
            uid = next((p for p in c.get("participants") or [] if p != official_id), "?")
            bodies, prefix = [], 0
            for m in pending:
                label, body = cs_worker.strip_issue_prefix(m.get("text") or "")
                prefix += 1 if label else 0
                bodies.append(body)
            joined = "\n".join(bodies)
            first, last = pending[0].get("created_at"), pending[-1].get("created_at")
            print(f"  - conv={cid[:8]} user={uid[:8]} msgs={len(pending)} 오류신고={prefix} "
                  f"forced={','.join(cs_worker.detect_forced(joined)) or '-'} agent={cs_worker.detect_agent_request(joined)} "
                  f"기간={cs_worker._kst(first)}~{cs_worker._kst(last)}")
            if not apply:
                continue
            r = await cs_worker.process_conversation(
                cid, trigger="backfill", mode="shadow", since=since, respect_debounce=False,
            )
            if not r:
                print("    → 처리 안 됨(잠금/이미 처리)")
                continue
            made += 1
            doc = await mongo[cs_worker.CASES].find_one({"_id": cs_worker.ObjectId(r["case_id"])})
            print(f"    → case={r['case_id']} ai_decision={doc.get('ai_decision')} conf={doc.get('ai_confidence')} "
                  f"category={doc.get('category')} reason={doc.get('escalate_reason')} known={doc.get('known_issue_id')} "
                  f"tokens={((doc.get('llm') or {}).get('usage') or {})}")
            if args.print_drafts:
                print("    [LLM 초안]\n" + "\n".join("      " + ln for ln in (doc.get("ai_reply") or "(없음)").splitlines()))
                print("    [auto 였다면 발송할 문구]\n" + "\n".join("      " + ln for ln in (doc.get("ai_reply_final") or "").splitlines()))
        print(f"[cs-backfill] done cases_created={made}")
    finally:
        await close_postgres()
        await close_mongodb()
        await close_redis()


if __name__ == "__main__":
    asyncio.run(main())
