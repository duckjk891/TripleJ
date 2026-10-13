# 읽기 전용 — 공개곡 메타(제목·제작자·장르·분위기·카테고리·bpm/tempo·재생수·등록일) + track_embeddings 덤프(시뮬레이션 입력). 쓰기 없음.
#   ssh maidol-ec2 'sudo docker exec -i -w /srv/app -e PYTHONPATH=/srv/app maidol-app python -B -' \
#     < _sim/dump_catalog.py > catalog.json
import asyncio, json
from app.config import settings as s
import asyncpg
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    db = AsyncIOMotorClient(s.computed_mongo_url)[s.mongo_db]
    docs = await db.tracks.find({"is_public": True}, {
        "title": 1, "uploader_id": 1, "genre": 1, "play_count": 1, "created_at": 1,
        "mood": 1, "categories": 1, "bpm": 1, "tempo": 1}).to_list(length=5000)
    pg = await asyncpg.connect(s.postgres_dsn)
    rows = await pg.fetch("SELECT track_id, embedding::text AS e FROM track_embeddings")
    await pg.close()
    emb = {r["track_id"]: r["e"] for r in rows}
    pub = {str(d["_id"]) for d in docs}
    out = [{"id": str(d["_id"]), "title": d.get("title") or "", "uploader_id": str(d.get("uploader_id") or ""),
            "genre": d.get("genre"), "play_count": int(d.get("play_count") or 0),
            "created_at": (d["created_at"].isoformat() if hasattr(d.get("created_at"), "isoformat") else str(d.get("created_at") or "")),
            "mood": d.get("mood"), "categories": d.get("categories"), "bpm": d.get("bpm"), "tempo": d.get("tempo"),
            "is_public": True, "emb": emb.get(str(d["_id"]))}
           for d in docs]
    # 비공개곡 임베딩도 pgvector 상위 k 를 차지하므로 포함(메타 없이 is_public=False)
    out += [{"id": t, "title": "", "uploader_id": "", "genre": None, "play_count": 0, "created_at": "",
             "is_public": False, "emb": e} for t, e in emb.items() if t not in pub]
    print(json.dumps({"tracks": out}, ensure_ascii=False))

asyncio.run(main())
