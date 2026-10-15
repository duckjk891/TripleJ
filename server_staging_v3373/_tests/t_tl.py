import asyncio, asyncpg
from app.config import settings
from app.database import mongodb as M, redis as R
from app.routes.feeds import get_timeline
async def main():
    await M.init_mongodb(settings.computed_mongo_url, settings.mongo_db); await R.init_redis(settings.computed_redis_url)
    conn = await asyncpg.connect(settings.postgres_dsn)
    ok = fail = 0
    def check(n, c, i=""):
        nonlocal ok, fail
        ok += c; fail += (not c); print("PASS" if c else "FAIL", n, i)
    for ex in (False, True):
        r1 = await get_timeline(page=1, limit=10, exclude_official=ex, current_user=None, conn=conn)
        r2 = await get_timeline(page=2, limit=10, exclude_official=ex, current_user=None, conn=conn)
        f1, f2 = r1["feeds"], r2["feeds"]
        ts = [f.get("created_at") for f in f1 + f2]
        check(f"exclude_official={ex} sorted desc", all(str(ts[i]) >= str(ts[i+1]) for i in range(len(ts)-1)), str(ts[:3]))
        check(f"exclude_official={ex} no dup across pages", not ({f["id"] for f in f1} & {f["id"] for f in f2}))
        check(f"exclude_official={ex} page sizes", len(f1) == 10 and r1["pagination"]["total"] >= len(f1) + len(f2), str(r1["pagination"]))
        print("  top:", [(f["id"][:8], (f.get("author") or {}).get("nickname") or f.get("author_nickname")) for f in f1[:3]])
    r = await get_timeline(page=1, limit=10, exclude_official=False, current_user=None, conn=conn)
    check("newest = MV promo post", r["feeds"][0]["id"] == "6ad0964eaca6ced2933f99a7", r["feeds"][0]["id"])
    print(f"TOTAL ok={ok} fail={fail}")
asyncio.run(main())
