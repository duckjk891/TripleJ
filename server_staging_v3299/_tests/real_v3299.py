"""실모델 확인 — 대표 10-06 3분 작사 요청 그대로(읽기 전용 DB 조회 + 작사 모델 호출, 저장 없음)."""
import asyncio
from app.config import settings as s
from motor.motor_asyncio import AsyncIOMotorClient
import app.services.lyrics_generator as lg
async def main():
    db = AsyncIOMotorClient(s.computed_mongo_url)[s.mongo_db]
    j = await db.gen_jobs.find_one({"kind": "lyrics", "user_id": {"$regex": "^c19acda4"}, "resume.body.duration_minutes": 3}, sort=[("_id", -1)])
    b = (j.get("resume") or {}).get("body") or {}
    print("req genre=%s mood=%s dm=%s rap=%s structure=%s models=%s" % (b.get("genre"), b.get("mood"), b.get("duration_minutes"), b.get("has_rap"), (b.get("structure") or "")[:60], b.get("models")))
    for i in range(2):
        r = await lg.generate_lyrics(
            prompt=b.get("prompt") or "", genre=b.get("genre"), mood=b.get("mood"), style=b.get("style"),
            duration_minutes=b.get("duration_minutes") or 3, duet=bool(b.get("duet")),
            duet_main_vocal_style=b.get("duet_main_vocal_style"), duet_sub_vocal_style=b.get("duet_sub_vocal_style"),
            language=b.get("language") or "ko", models=b.get("models"), structure=(b.get("structure") or "").strip() or None,
            english_ratio=b.get("english_ratio"), has_rap=b.get("has_rap"),
        )
        r = r["results"][0] if "results" in r else r
        st = lg.lyrics_shape_stats(r.get("lyrics") or "")
        print(f"RUN{i+1} model={r.get('model')} sections={st['sections_with_lines']} lyric_lines={st['lyric_lines']} chars={len(r.get('lyrics') or '')}")
        if i == 0:
            print("\n".join((r.get("lyrics") or "").splitlines()[:24]))
asyncio.run(main())
