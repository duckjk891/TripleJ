# 읽기 전용: 듀엣 헤더 가사 ↔ Suno 타임라인 붕괴 상관 (DB 쓰기 없음)
import asyncio, json, sys, re, collections
sys.path.insert(0, "/srv/app")
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
TAG = re.compile(r"^\[.*\]$"); SEP = re.compile(r"^[=\-_*~\s]{3,}$")
def state(raw):
    lyr = []
    for s in raw or []:
        if not isinstance(s, dict): continue
        t = str(s.get("text") or "").strip()
        try: st, en = float(s.get("start")), float(s.get("end"))
        except Exception: continue
        if not t or TAG.match(t) or SEP.match(t): continue
        lyr.append([st, en, False])
    n = len(lyr)
    if n < 5: return "short"
    for it in lyr: it[2] = (it[1] - it[0]) < 0.15
    for i in range(n):
        j = i
        while j + 1 < n and lyr[j + 1][0] - lyr[i][0] <= 0.5: j += 1
        if j - i + 1 >= 3:
            for k in range(i, j + 1): lyr[k][2] = True
    b = sum(1 for x in lyr if x[2])
    return "collapsed" if b / n >= 0.5 else ("ok" if b == 0 else "repaired")
async def main():
    db = AsyncIOMotorClient(settings.computed_mongo_url)[settings.mongo_db]
    c = collections.Counter(); ex = collections.defaultdict(list)
    async for g in db.generations.find({"status": "completed", "variants.0.timestamps.0": {"$exists": True}}, {"lyrics": 1, "variants": 1, "created_at": 1}):
        L = g.get("lyrics") or ""
        kind = "duet_hdr" if ("This song is a duet" in L or "===" in L) else ("labels" if re.search(r"^\s*\[(Male|Female|Both)", L, re.M | re.I) else "plain")
        for v in g.get("variants") or []:
            if isinstance(v, dict) and v.get("timestamps"):
                st = state(v["timestamps"]); c[(kind, st)] += 1
    print(json.dumps({f"{k[0]}|{k[1]}": n for k, n in sorted(c.items())}, ensure_ascii=False, indent=1))
asyncio.run(main())
