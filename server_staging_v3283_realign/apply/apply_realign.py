"""v3.283d 대표 승인(10-06): 붕괴 10곡 가사 타이밍 1회성 복구 — 테스트 때 이미 계산된 결과를 저장(외부 전송 추가 없음).
tracks.recognized_timestamps(share_video 2순위 폴백) + recognized_timestamps_meta. --apply 없으면 미리보기."""
import asyncio, json, sys
from datetime import datetime, timezone
sys.path.insert(0, "/srv/app")
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
from app.services.share_video import _repair_timeline, _generation_timestamps
APPLY = "--apply" in sys.argv
def gate(m, segs):
    st = _repair_timeline(segs)[1]
    ok = (m.get("anchor_ratio") or 0) >= 0.85 and st in ("ok",)
    return ok, st
async def main():
    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    items = json.load(open("/tmp/realign_apply.json"))
    n = 0
    for it in items:
        t = await db.tracks.find_one({"_id": ObjectId(it["track_id"])})
        if not t: print("SKIP missing", it["title"]); continue
        gen_state = _repair_timeline(await _generation_timestamps(db, t))[1]
        ok, st = gate(it["metrics"], it["segments"])
        had = bool(t.get("recognized_timestamps"))
        print(("APPLY" if APPLY and ok else "PLAN"), it["title"][:14].ljust(14), "| suno", gen_state, "| new", st, "| anchor", it["metrics"].get("anchor_ratio"), "| lines", len(it["segments"]), "| existing", had)
        if APPLY and ok and gen_state == "collapsed" and not had:
            await db.tracks.update_one({"_id": t["_id"]}, {"$set": {
                "recognized_timestamps": it["segments"],
                "recognized_timestamps_meta": {"source": "realign:whisper-1+syllable-dp/v2", "one_time": True,
                    "created_at": datetime.now(timezone.utc), "metrics": it["metrics"]},
            }})
            n += 1
    print("applied", n)
asyncio.run(main())
