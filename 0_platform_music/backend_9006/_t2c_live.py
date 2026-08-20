import asyncio, json
from app.services.suno_timestamp_service import get_suno_timestamps
from dotenv import dotenv_values
from pymongo import MongoClient
env=dotenv_values(".env")
murl=env.get("MONGO_URL") or f"mongodb://{env['MONGO_USER']}:{env['MONGO_PASSWORD']}@{env['MONGO_HOST']}:{env['MONGO_PORT']}/{env['MONGO_DB']}?authSource=admin"
db=MongoClient(murl)[env["MONGO_DB"]]

async def run_one(label, doc):
    tid=doc.get("suno_task_id")
    for i,v in enumerate(doc.get("variants") or []):
        aid=v.get("suno_audio_id")
        if not aid: continue
        stored=len(v.get("timestamps") or [])
        res=await get_suno_timestamps(tid, aid)
        print(f"  [{label}] gen={str(doc['_id'])[:8]} var{i} task={str(tid)[:8]} aud={str(aid)[:8]} stored_ts={stored} -> live_segs={len(res)}")
        for s in res[:5]: print("      ", json.dumps(s, ensure_ascii=False))
        return len(res)

async def main():
    # T2c + T3-direct: gen 6a327dc3 has stored ts=1 (old broken single-segment)
    doc=db.generations.find_one({"_id":__import__("bson").ObjectId("6a327dc3")} if False else {"status":"completed","suno_task_id":{"$ne":None}}, sort=[("created_at",-1)])
    # explicitly grab the one-segment gen
    one=None
    for d in db.generations.find({"status":"completed","suno_task_id":{"$ne":None}}, sort=[("created_at",-1)]):
        for v in d.get("variants") or []:
            if v.get("suno_audio_id") and len(v.get("timestamps") or [])==1:
                one=d; break
        if one: break
    print("=== T2(c) live segmentation on most recent completed gen ===")
    await run_one("T2c", doc)
    if one and (not doc or str(one["_id"])!=str(doc["_id"])):
        print("=== T3 direct: existing 1-segment song re-segmented ===")
        await run_one("T3direct", one)
    elif one:
        print("=== T3 direct: (most recent gen IS the 1-segment one, shown above) ===")

asyncio.run(main())
