import asyncio
from datetime import datetime, timedelta, timezone
from app.config import settings
from app.database import mongodb as M
from app.services import fatigue_service as F

UID = "test_v3365_fatigue"
ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    if cond: ok += 1; print("PASS", name, info)
    else: fail += 1; print("FAIL", name, info)

async def main():
    await M.init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    db = M.get_mongo()
    col = db.director_fatigue
    await col.delete_many({"user_id": UID})
    now = datetime.now(timezone.utc)
    mid = F._next_kst_midnight(now)
    to_mid = (mid - now).total_seconds()
    kst = mid.astimezone(timezone(timedelta(hours=9)))
    check("helper midnight is KST 00:00", kst.hour == 0 and kst.minute == 0 and 0 < to_mid <= 86400, kst.isoformat())
    # 1) 자정 넘는 기존 쿨다운 → 상한 + DB 반영
    await col.insert_one({"user_id": UID, "day": F._kst_day(), "completed_count": 4,
                          "cooldown_until": now + timedelta(hours=30), "lyricist_cooldown_until": now + timedelta(minutes=20)})
    rem = await F.check_gate(UID, director="composer")
    check("check_gate capped", abs(rem - to_mid) < 5, f"rem={rem} to_mid={int(to_mid)}")
    d = await col.find_one({"user_id": UID})
    du = d["cooldown_until"].replace(tzinfo=timezone.utc)
    check("DB until persisted at midnight", abs((du - mid).total_seconds()) < 1, du.isoformat())
    lu = d["lyricist_cooldown_until"].replace(tzinfo=timezone.utc)
    check("short cooldown untouched", abs((lu - (now + timedelta(minutes=20))).total_seconds()) < 1)
    st = await F.get_status(UID, director="composer")
    import math
    check("status units capped", st["skip_units_needed"] == min(24, math.ceil(to_mid / 1800)), str(st["skip_units_needed"]))
    check("status total cost", st["skip_total_cost"] == st["skip_units_needed"] * 5)
    # 2) 완성 훅: 4개째 12h → 자정 상한
    await F.on_generation_completed(UID, director="composer")
    d = await col.find_one({"user_id": UID})
    du = d["cooldown_until"].replace(tzinfo=timezone.utc)
    exp = min(datetime.now(timezone.utc) + timedelta(hours=12), mid)
    check("completion hook capped", abs((du - exp).total_seconds()) < 5 and du <= mid, f"{du.isoformat()} count={d['completed_count']}")
    # 3) 완성 훅: 1개째 2h (자정 전이면 그대로)
    await F.on_generation_completed(UID, director="image")
    d = await col.find_one({"user_id": UID})
    iu = d["image_cooldown_until"].replace(tzinfo=timezone.utc)
    exp = min(datetime.now(timezone.utc) + timedelta(hours=2), mid)
    check("image 1st = min(2h, midnight)", abs((iu - exp).total_seconds()) < 5, iu.isoformat())
    # 4) reduce_by 는 상한된 값 기준
    r = await F.reduce_cooldown_by(UID, 30, director="composer")
    check("reduce_by before <= midnight", r is not None and r[0] <= mid, str(r[0].isoformat() if r else None))
    # 5) 어제자 doc → 리셋 유지
    await col.update_one({"user_id": UID}, {"$set": {"day": "20000101"}})
    rem = await F.check_gate(UID, director="composer")
    check("old day reset", rem == 0)
    await col.delete_many({"user_id": UID})
    check("cleanup", await col.count_documents({"user_id": UID}) == 0)
    print(f"TOTAL ok={ok} fail={fail}")

asyncio.run(main())
