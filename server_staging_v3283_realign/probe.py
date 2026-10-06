# 읽기 전용 프로브 — 대상 곡 트랙/generation 구조 확인 (DB 쓰기 없음)
import asyncio, json, sys
sys.path.insert(0, "/srv/app")
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from app.config import settings
from app.services.share_video import _is_collapsed_timeline

TITLES = ["갱 머니","사실 알고있잖아","13층","마지막 버스","show","너 정말","미칠거같아","막좋아","우린 예뻐2","벚꽃 첫사랑"]

async def main():
    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    out = []
    for t in TITLES:
        cur = db.tracks.find({"title": t}, {"title":1,"is_public":1,"generation_id":1,"variant_index":1,"audio_url":1,"duration":1,"lyrics":1})
        async for tr in cur:
            gid = tr.get("generation_id")
            g = None
            if gid:
                q = ObjectId(gid) if isinstance(gid,str) and ObjectId.is_valid(gid) else gid
                g = await db.generations.find_one({"_id": q})
            vi = tr.get("variant_index") or 0
            v = (g or {}).get("variants", [{}])[vi] if g and g.get("variants") else {}
            ts = v.get("timestamps") or []
            out.append({"title": t, "id": str(tr["_id"]), "public": tr.get("is_public"), "gid": str(gid), "vi": vi,
                        "audio": tr.get("audio_url"), "v_audio": v.get("audio_url"), "dur": tr.get("duration"),
                        "ts_n": len(ts), "collapsed": _is_collapsed_timeline(ts) if ts else None,
                        "gen_keys": sorted((g or {}).keys()), "var_keys": sorted(v.keys()) if isinstance(v, dict) else None,
                        "lyr_len": len((g or {}).get("lyrics") or ""), "track_lyr_len": len(tr.get("lyrics") or "")})
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
asyncio.run(main())
