import asyncio, json
from app.services.suno_timestamp_service import _words_to_segments, get_suno_timestamps

print("===== T2(a) newline split =====")
sample=[
 {"word":"세상은 ","startS":0.638,"endS":1.277,"success":True},
 {"word":"빨라, ","startS":1.436,"endS":2.5135,"success":True},
 {"word":"느려\n","startS":2.872,"endS":4.069,"success":True},
 {"word":"화면 ","startS":4.229,"endS":4.707,"success":True},
 {"word":"흘러가\n\n","startS":6.343,"endS":9.340,"success":True},
 {"word":"[Verse 1: rap flow, gritty]\n알람 ","startS":9.345,"endS":9.734,"success":True},
 {"word":"소리에\n","startS":9.85,"endS":10.13,"success":True},
]
segs=_words_to_segments(sample)
for s in segs: print("  ", json.dumps(s, ensure_ascii=False))
has_nl=any("\n" in s["text"] for s in segs)
times=[(s["start"],s["end"]) for s in segs]
flat=[]
for a,b in times: flat+=[a,b]
mono=all(flat[i]<=flat[i+1] for i in range(len(flat)-1))
print(f"  count={len(segs)} has_newline={has_nl} monotonic={mono}")
print("  T2a PASS" if (len(segs)>1 and not has_nl) else "  T2a FAIL")

print("===== T2(b) fallback 15 words no newline =====")
b=[{"word":f"w{i} ","startS":i*1.0,"endS":i*1.0+0.5,"success":True} for i in range(15)]
sb=_words_to_segments(b)
print(f"  count={len(sb)}")
for s in sb: print("   ", json.dumps(s, ensure_ascii=False))
print("  T2b PASS" if len(sb)>1 else "  T2b FAIL")

print("===== T2(c) live end-to-end =====")
from dotenv import dotenv_values
from pymongo import MongoClient
env=dotenv_values(".env")
murl=env.get("MONGO_URL") or f"mongodb://{env['MONGO_USER']}:{env['MONGO_PASSWORD']}@{env['MONGO_HOST']}:{env['MONGO_PORT']}/{env['MONGO_DB']}?authSource=admin"
cli=MongoClient(murl)
db=cli[env["MONGO_DB"]]
doc=db.generations.find_one(
  {"status":"completed","suno_task_id":{"$ne":None},"variants.0.suno_audio_id":{"$ne":None}},
  sort=[("created_at",-1)])
if not doc:
  print("  NO eligible completed gen found")
else:
  tid=doc.get("suno_task_id"); aid=doc["variants"][0].get("suno_audio_id")
  print(f"  gen_id={str(doc['_id'])[:8]} task_id={str(tid)[:8]} audio_id={str(aid)[:8]} stored_variant0_ts_len={len(doc['variants'][0].get('timestamps') or [])}")
  res=asyncio.get_event_loop().run_until_complete(get_suno_timestamps(tid, aid))
  print(f"  live segments returned={len(res)}")
  for s in res[:5]: print("   ", json.dumps(s, ensure_ascii=False))
  print("  T2c PASS" if len(res)>1 else "  T2c FAIL (or quota/transient)")
