# READ-ONLY extraction (find only)
import os, json, re
from pymongo import MongoClient
from urllib.parse import quote_plus
u=quote_plus(os.environ["MONGO_USER"]); p=quote_plus(os.environ["MONGO_PASSWORD"])
cli=MongoClient(f"mongodb://{u}:{p}@{os.environ.get('MONGO_HOST','localhost')}:{os.environ.get('MONGO_PORT','27017')}/?authSource=admin")
db=cli[os.environ.get("MONGO_DB","aimu")]
def uniq(q, n, pick=None, scan=400):
    seen=set(); out=[]
    for g in db.generations.find(q,{"lyrics":1,"created_at":1,"status":1}).sort("created_at",-1).limit(scan):
        L=(g.get("lyrics") or "")
        k=L.strip()
        if not k or k in seen: continue
        if pick and not pick(L): continue
        seen.add(k); out.append({"id":str(g["_id"]),"created_at":str(g.get("created_at")),"status":g.get("status"),"lyrics":L})
        if len(out)>=n: break
    return out
duet=uniq({"lyrics":{"$regex":r"\[(Male|Female|Both)\]"}},10)
solo_dir=uniq({"lyrics":{"$type":"string","$not":re.compile(r"\[(Male|Female|Both)\]|This song is a duet",re.I)},"status":"completed"},5,
              pick=lambda L: bool(re.search(r"\((whisper|spoken|ad-lib|echo|harmon|falsetto)",L,re.I) or re.search(r"\[[A-Za-z\- ]+\d?:[^\]]+\]",L)))
ids={x["id"] for x in solo_dir}
solo_plain=[x for x in uniq({"lyrics":{"$type":"string","$not":re.compile(r"\[(Male|Female|Both)\]|This song is a duet",re.I)},"status":"completed"},15) if x["id"] not in ids][:10-len(solo_dir)]
json.dump({"duet":duet,"solo":solo_dir+solo_plain},open("/out/samples2.json","w"),ensure_ascii=False)
print(len(duet),len(solo_dir),len(solo_plain))
