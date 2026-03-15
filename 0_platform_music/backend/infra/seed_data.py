"""
AIMU Platform - Seed Data Script (v2.0)

Seeds data into:
- PostgreSQL: users
- MongoDB: tracks
- Redis: charts (Sorted Sets)

Usage:
    cd backend
    python -m infra.seed_data
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bcrypt
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import asyncpg
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as aioredis
from bson import ObjectId


# ============================================================================
# Seed data definitions
# ============================================================================

USERS = [
    {"email": "test@test.com", "password": "password123", "nickname": "음악매니아"},
    {"email": "test2@test.com", "password": "password123", "nickname": "노래사랑"},
    {"email": "creator1@test.com", "password": "password123", "nickname": "김하늘"},
    {"email": "creator2@test.com", "password": "password123", "nickname": "박소울"},
    {"email": "creator3@test.com", "password": "password123", "nickname": "스타빛"},
    {"email": "creator4@test.com", "password": "password123", "nickname": "이도윤"},
    {"email": "creator5@test.com", "password": "password123", "nickname": "달빛소녀"},
    {"email": "creator6@test.com", "password": "password123", "nickname": "정우진"},
    {"email": "creator7@test.com", "password": "password123", "nickname": "한서연"},
    {"email": "creator8@test.com", "password": "password123", "nickname": "크루즈"},
    {"email": "creator9@test.com", "password": "password123", "nickname": "윤채린"},
    {"email": "creator10@test.com", "password": "password123", "nickname": "블루문"},
    {"email": "creator11@test.com", "password": "password123", "nickname": "최예은"},
    {"email": "creator12@test.com", "password": "password123", "nickname": "파이어독"},
]

# Track data organized by creator (index into USERS above, starting from 2)
TRACKS_BY_CREATOR = [
    # 김하늘 (creator index 2)
    {"creator_idx": 2, "genre": ["발라드"], "tracks": [
        {"title": "눈이 오는 밤", "duration_sec": 264, "play_count": 1520000, "like_count": 89000, "mood": ["감성적인", "잔잔한"], "tags": ["겨울", "눈"]},
        {"title": "겨울 고백", "duration_sec": 238, "play_count": 980000, "like_count": 56000, "mood": ["감성적인"], "tags": ["겨울", "고백"]},
        {"title": "너의 온도", "duration_sec": 251, "play_count": 1230000, "like_count": 72000, "mood": ["따뜻한"], "tags": ["사랑"]},
        {"title": "하얀 숨결", "duration_sec": 219, "play_count": 750000, "like_count": 41000, "mood": ["잔잔한"], "tags": ["겨울"]},
        {"title": "12월의 편지", "duration_sec": 285, "play_count": 620000, "like_count": 35000, "mood": ["감성적인"], "tags": ["겨울", "편지"]},
        {"title": "벚꽃 엔딩 스토리", "duration_sec": 242, "play_count": 2100000, "like_count": 125000, "mood": ["설레는", "밝은"], "tags": ["봄", "벚꽃"]},
        {"title": "봄바람에 실려", "duration_sec": 228, "play_count": 890000, "like_count": 52000, "mood": ["설레는"], "tags": ["봄"]},
        {"title": "꽃비", "duration_sec": 256, "play_count": 670000, "like_count": 38000, "mood": ["잔잔한"], "tags": ["봄", "꽃"]},
    ]},
    # 박소울 (creator index 3)
    {"creator_idx": 3, "genre": ["R&B"], "tracks": [
        {"title": "Midnight Soul", "duration_sec": 234, "play_count": 1780000, "like_count": 98000, "mood": ["그루비한", "감성적인"], "tags": ["밤", "소울"]},
        {"title": "너에게로", "duration_sec": 247, "play_count": 1340000, "like_count": 76000, "mood": ["감성적인"], "tags": ["사랑"]},
        {"title": "Groove Tonight", "duration_sec": 212, "play_count": 920000, "like_count": 54000, "mood": ["그루비한", "신나는"], "tags": ["파티"]},
        {"title": "새벽감성", "duration_sec": 268, "play_count": 1100000, "like_count": 63000, "mood": ["감성적인", "잔잔한"], "tags": ["새벽"]},
        {"title": "Stay With Me", "duration_sec": 241, "play_count": 860000, "like_count": 48000, "mood": ["감성적인"], "tags": ["사랑"]},
        {"title": "비가 오면", "duration_sec": 255, "play_count": 780000, "like_count": 42000, "mood": ["잔잔한"], "tags": ["비", "감성"]},
    ]},
    # 스타빛 (creator index 4)
    {"creator_idx": 4, "genre": ["댄스"], "tracks": [
        {"title": "Shine", "duration_sec": 198, "play_count": 3200000, "like_count": 210000, "mood": ["신나는", "에너지"], "tags": ["댄스"]},
        {"title": "Dancing All Night", "duration_sec": 207, "play_count": 2450000, "like_count": 156000, "mood": ["신나는"], "tags": ["댄스", "파티"]},
        {"title": "별빛 아래서", "duration_sec": 215, "play_count": 1890000, "like_count": 112000, "mood": ["설레는"], "tags": ["별", "밤"]},
        {"title": "Fire Up", "duration_sec": 193, "play_count": 1560000, "like_count": 95000, "mood": ["에너지", "강렬한"], "tags": ["댄스"]},
        {"title": "Together", "duration_sec": 224, "play_count": 980000, "like_count": 58000, "mood": ["밝은"], "tags": ["댄스"]},
        {"title": "Galaxy Express", "duration_sec": 202, "play_count": 4100000, "like_count": 280000, "mood": ["신나는", "에너지"], "tags": ["우주", "댄스"]},
        {"title": "Orbit", "duration_sec": 189, "play_count": 2800000, "like_count": 175000, "mood": ["신나는"], "tags": ["우주"]},
        {"title": "Supernova", "duration_sec": 211, "play_count": 2100000, "like_count": 130000, "mood": ["강렬한"], "tags": ["우주"]},
    ]},
    # 이도윤 (creator index 5)
    {"creator_idx": 5, "genre": ["힙합"], "tracks": [
        {"title": "거리의 시", "duration_sec": 218, "play_count": 2670000, "like_count": 158000, "mood": ["강렬한", "자유로운"], "tags": ["거리", "힙합"]},
        {"title": "Real Talk", "duration_sec": 195, "play_count": 1890000, "like_count": 112000, "mood": ["강렬한"], "tags": ["힙합"]},
        {"title": "새벽 3시", "duration_sec": 232, "play_count": 1540000, "like_count": 89000, "mood": ["감성적인"], "tags": ["새벽"]},
        {"title": "My Way", "duration_sec": 204, "play_count": 1230000, "like_count": 72000, "mood": ["자유로운"], "tags": ["힙합"]},
        {"title": "불꽃", "duration_sec": 188, "play_count": 980000, "like_count": 56000, "mood": ["강렬한"], "tags": ["열정"]},
        {"title": "Respect", "duration_sec": 226, "play_count": 870000, "like_count": 48000, "mood": ["강렬한"], "tags": ["힙합"]},
        {"title": "꿈을 꾸다", "duration_sec": 241, "play_count": 760000, "like_count": 41000, "mood": ["감성적인"], "tags": ["꿈"]},
    ]},
    # 달빛소녀 (creator index 6)
    {"creator_idx": 6, "genre": ["인디"], "tracks": [
        {"title": "달빛 산책", "duration_sec": 267, "play_count": 890000, "like_count": 62000, "mood": ["몽환적인", "잔잔한"], "tags": ["달빛", "밤"]},
        {"title": "밤의 노래", "duration_sec": 245, "play_count": 720000, "like_count": 48000, "mood": ["몽환적인"], "tags": ["밤"]},
        {"title": "별 헤는 밤", "duration_sec": 278, "play_count": 650000, "like_count": 42000, "mood": ["잔잔한"], "tags": ["별", "밤"]},
        {"title": "은하수", "duration_sec": 234, "play_count": 540000, "like_count": 35000, "mood": ["몽환적인"], "tags": ["우주"]},
    ]},
    # 정우진 (creator index 7)
    {"creator_idx": 7, "genre": ["록"], "tracks": [
        {"title": "Thunder", "duration_sec": 245, "play_count": 1450000, "like_count": 86000, "mood": ["강렬한", "에너지"], "tags": ["록", "천둥"]},
        {"title": "폭풍", "duration_sec": 232, "play_count": 1120000, "like_count": 68000, "mood": ["강렬한"], "tags": ["록"]},
        {"title": "Break Free", "duration_sec": 256, "play_count": 890000, "like_count": 52000, "mood": ["자유로운"], "tags": ["록", "자유"]},
        {"title": "자유를 향해", "duration_sec": 271, "play_count": 780000, "like_count": 45000, "mood": ["에너지"], "tags": ["록"]},
        {"title": "Revolution", "duration_sec": 298, "play_count": 650000, "like_count": 38000, "mood": ["강렬한"], "tags": ["록"]},
        {"title": "불꽃놀이", "duration_sec": 263, "play_count": 1680000, "like_count": 102000, "mood": ["에너지", "신나는"], "tags": ["여름", "록"]},
        {"title": "Summer Rock", "duration_sec": 228, "play_count": 1230000, "like_count": 75000, "mood": ["신나는"], "tags": ["여름"]},
        {"title": "열정", "duration_sec": 241, "play_count": 980000, "like_count": 58000, "mood": ["에너지"], "tags": ["록"]},
    ]},
    # 한서연 (creator index 8)
    {"creator_idx": 8, "genre": ["발라드"], "tracks": [
        {"title": "그리움", "duration_sec": 272, "play_count": 1950000, "like_count": 118000, "mood": ["감성적인", "슬픈"], "tags": ["그리움"]},
        {"title": "이별 후", "duration_sec": 258, "play_count": 1680000, "like_count": 98000, "mood": ["슬픈"], "tags": ["이별"]},
        {"title": "사랑했던 날들", "duration_sec": 245, "play_count": 1420000, "like_count": 85000, "mood": ["감성적인"], "tags": ["사랑"]},
        {"title": "눈물", "duration_sec": 231, "play_count": 1100000, "like_count": 65000, "mood": ["슬픈"], "tags": ["눈물"]},
        {"title": "다시 만날 때", "duration_sec": 264, "play_count": 890000, "like_count": 52000, "mood": ["희망적인"], "tags": ["재회"]},
        {"title": "위로", "duration_sec": 248, "play_count": 760000, "like_count": 44000, "mood": ["따뜻한"], "tags": ["위로"]},
    ]},
    # 크루즈 (creator index 9)
    {"creator_idx": 9, "genre": ["힙합"], "tracks": [
        {"title": "Cruise", "duration_sec": 209, "play_count": 1340000, "like_count": 82000, "mood": ["여유로운", "그루비한"], "tags": ["힙합"]},
        {"title": "Chill Mode", "duration_sec": 196, "play_count": 1120000, "like_count": 68000, "mood": ["여유로운"], "tags": ["칠"]},
        {"title": "드라이브", "duration_sec": 223, "play_count": 890000, "like_count": 52000, "mood": ["여유로운"], "tags": ["드라이브"]},
        {"title": "Wave", "duration_sec": 187, "play_count": 760000, "like_count": 44000, "mood": ["그루비한"], "tags": ["여름"]},
    ]},
    # 윤채린 (creator index 10)
    {"creator_idx": 10, "genre": ["댄스"], "tracks": [
        {"title": "Butterfly", "duration_sec": 201, "play_count": 3800000, "like_count": 245000, "mood": ["에너지", "화려한"], "tags": ["나비", "댄스"]},
        {"title": "Wings", "duration_sec": 195, "play_count": 2900000, "like_count": 182000, "mood": ["에너지"], "tags": ["날개"]},
        {"title": "날아올라", "duration_sec": 208, "play_count": 2300000, "like_count": 142000, "mood": ["에너지", "신나는"], "tags": ["댄스"]},
        {"title": "Bloom", "duration_sec": 216, "play_count": 1780000, "like_count": 108000, "mood": ["밝은"], "tags": ["꽃"]},
        {"title": "Fantasy", "duration_sec": 192, "play_count": 1450000, "like_count": 88000, "mood": ["몽환적인"], "tags": ["판타지"]},
        {"title": "Queen", "duration_sec": 204, "play_count": 1200000, "like_count": 72000, "mood": ["강렬한"], "tags": ["댄스"]},
        {"title": "Power", "duration_sec": 198, "play_count": 980000, "like_count": 58000, "mood": ["에너지"], "tags": ["댄스"]},
        {"title": "Dream High", "duration_sec": 221, "play_count": 850000, "like_count": 48000, "mood": ["희망적인"], "tags": ["꿈"]},
    ]},
    # 블루문 (creator index 11)
    {"creator_idx": 11, "genre": ["인디"], "tracks": [
        {"title": "파란 달", "duration_sec": 258, "play_count": 780000, "like_count": 52000, "mood": ["잔잔한", "서정적인"], "tags": ["달", "밤"]},
        {"title": "안녕, 오늘", "duration_sec": 243, "play_count": 650000, "like_count": 42000, "mood": ["잔잔한"], "tags": ["일상"]},
        {"title": "길 위에서", "duration_sec": 267, "play_count": 540000, "like_count": 35000, "mood": ["서정적인"], "tags": ["여행"]},
        {"title": "바람의 노래", "duration_sec": 251, "play_count": 480000, "like_count": 30000, "mood": ["자유로운"], "tags": ["바람"]},
        {"title": "떠나는 날", "duration_sec": 239, "play_count": 420000, "like_count": 26000, "mood": ["감성적인"], "tags": ["이별"]},
    ]},
    # 최예은 (creator index 12)
    {"creator_idx": 12, "genre": ["R&B"], "tracks": [
        {"title": "Velvet", "duration_sec": 237, "play_count": 2450000, "like_count": 155000, "mood": ["감성적인", "그루비한"], "tags": ["R&B"]},
        {"title": "Moonlight", "duration_sec": 248, "play_count": 1890000, "like_count": 118000, "mood": ["감성적인"], "tags": ["달빛"]},
        {"title": "촛불", "duration_sec": 262, "play_count": 1340000, "like_count": 82000, "mood": ["잔잔한"], "tags": ["밤"]},
        {"title": "Honey", "duration_sec": 219, "play_count": 1120000, "like_count": 68000, "mood": ["달콤한"], "tags": ["사랑"]},
        {"title": "Dreamy", "duration_sec": 241, "play_count": 890000, "like_count": 54000, "mood": ["몽환적인"], "tags": ["꿈"]},
    ]},
    # 파이어독 (creator index 13)
    {"creator_idx": 13, "genre": ["록"], "tracks": [
        {"title": "Burn It Down", "duration_sec": 238, "play_count": 1120000, "like_count": 68000, "mood": ["강렬한", "에너지"], "tags": ["록"]},
        {"title": "Rage", "duration_sec": 215, "play_count": 890000, "like_count": 52000, "mood": ["강렬한"], "tags": ["록"]},
        {"title": "전사", "duration_sec": 248, "play_count": 760000, "like_count": 44000, "mood": ["에너지"], "tags": ["록"]},
        {"title": "Fight", "duration_sec": 203, "play_count": 650000, "like_count": 38000, "mood": ["강렬한"], "tags": ["록"]},
        {"title": "끝까지", "duration_sec": 267, "play_count": 540000, "like_count": 32000, "mood": ["에너지"], "tags": ["록"]},
        {"title": "Rise Up", "duration_sec": 229, "play_count": 480000, "like_count": 28000, "mood": ["희망적인"], "tags": ["록"]},
    ]},
]


async def seed():
    # Read config from env
    pg_host = os.getenv("POSTGRES_HOST", "localhost")
    pg_port = int(os.getenv("POSTGRES_PORT", "5432"))
    pg_db = os.getenv("POSTGRES_DB", "aimu")
    pg_user = os.getenv("POSTGRES_USER", "aimu_user")
    pg_pw = os.getenv("POSTGRES_PASSWORD", "your_postgres_password")
    mongo_url = os.getenv("MONGO_URL", "mongodb://aimu_user:your_mongo_password@localhost:27017/aimu?authSource=admin")
    mongo_db_name = os.getenv("MONGO_DB", "aimu")
    redis_url = os.getenv("REDIS_URL", "redis://:your_redis_password@localhost:6379/0")

    # -------------------------------------------------------------------------
    # PostgreSQL: seed users
    # -------------------------------------------------------------------------
    print("Connecting to PostgreSQL...")
    pg = await asyncpg.connect(host=pg_host, port=pg_port, database=pg_db, user=pg_user, password=pg_pw)

    existing = await pg.fetchval("SELECT COUNT(*) FROM users")
    if existing > 0:
        print(f"PostgreSQL already has {existing} users. Skipping PG seed.")
    else:
        print("Seeding PostgreSQL users...")
        user_ids = []
        for u in USERS:
            pw_hash = bcrypt.hashpw(u["password"].encode(), bcrypt.gensalt()).decode()
            row = await pg.fetchrow(
                "INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING id",
                u["email"], pw_hash, u["nickname"],
            )
            user_ids.append(str(row["id"]))
            print(f"  Created user: {u['nickname']} ({user_ids[-1]})")

    # Re-fetch all user IDs in order
    user_rows = await pg.fetch("SELECT id, email, nickname FROM users ORDER BY created_at ASC")
    user_map = {}
    for r in user_rows:
        for i, u in enumerate(USERS):
            if u["email"] == r["email"]:
                user_map[i] = {"id": str(r["id"]), "nickname": r["nickname"]}
                break

    await pg.close()
    print(f"PostgreSQL: {len(user_map)} users ready.")

    # -------------------------------------------------------------------------
    # MongoDB: seed tracks
    # -------------------------------------------------------------------------
    print("Connecting to MongoDB...")
    mongo_client = AsyncIOMotorClient(mongo_url)
    mongo = mongo_client[mongo_db_name]

    existing_tracks = await mongo.tracks.count_documents({})
    if existing_tracks > 0:
        print(f"MongoDB already has {existing_tracks} tracks. Skipping Mongo seed.")
    else:
        print("Seeding MongoDB tracks...")
        all_tracks = []
        now = datetime.now(timezone.utc)

        for creator_group in TRACKS_BY_CREATOR:
            creator_idx = creator_group["creator_idx"]
            creator = user_map.get(creator_idx)
            if not creator:
                print(f"  WARNING: Creator index {creator_idx} not found in user_map, skipping.")
                continue

            genre = creator_group["genre"]
            for t in creator_group["tracks"]:
                doc = {
                    "title": t["title"],
                    "uploader_id": creator["id"],
                    "uploader_nickname": creator["nickname"],
                    "ai_model": None,
                    "prompt": None,
                    "ai_model_version": None,
                    "genre": genre,
                    "mood": t.get("mood", []),
                    "tags": t.get("tags", []),
                    "bpm": None,
                    "key": None,
                    "duration_sec": t["duration_sec"],
                    "language": "ko",
                    "audio_url": None,
                    "cover_image_url": None,
                    "waveform_data": [],
                    "play_count": t["play_count"],
                    "like_count": t["like_count"],
                    "comment_count": 0,
                    "is_public": True,
                    "created_at": now,
                    "updated_at": now,
                }
                all_tracks.append(doc)

        if all_tracks:
            result = await mongo.tracks.insert_many(all_tracks)
            print(f"  Inserted {len(result.inserted_ids)} tracks.")

    # Re-fetch all tracks for chart seeding
    all_track_docs = await mongo.tracks.find({}, {"_id": 1, "play_count": 1}).to_list(length=200)
    mongo_client.close()
    print(f"MongoDB: {len(all_track_docs)} tracks ready.")

    # -------------------------------------------------------------------------
    # Redis: seed charts
    # -------------------------------------------------------------------------
    print("Connecting to Redis...")
    redis = aioredis.from_url(redis_url, decode_responses=True)

    # Check if charts already exist
    now = datetime.utcnow()
    daily_key = f"chart:daily:{now.strftime('%Y%m%d')}"
    existing_chart = await redis.zcard(daily_key)

    if existing_chart > 0:
        print(f"Redis chart already has {existing_chart} entries. Skipping Redis seed.")
    else:
        print("Seeding Redis charts...")
        sorted_tracks = sorted(all_track_docs, key=lambda x: x["play_count"], reverse=True)

        weekly_key = f"chart:weekly:{now.strftime('%Y-W%V')}"
        alltime_key = "chart:alltime"

        pipe = redis.pipeline()
        for track in sorted_tracks[:100]:
            tid = str(track["_id"])
            score = track["play_count"]
            pipe.zadd(daily_key, {tid: score})
            pipe.zadd(weekly_key, {tid: score})
            pipe.zadd(alltime_key, {tid: score})

        # Set TTL for daily and weekly charts
        pipe.expire(daily_key, 48 * 3600)   # 48 hours
        pipe.expire(weekly_key, 14 * 86400)  # 14 days

        await pipe.execute()
        print(f"  Seeded {min(len(sorted_tracks), 100)} entries into daily/weekly/alltime charts.")

    await redis.aclose()
    print("Seed complete!")


if __name__ == "__main__":
    asyncio.run(seed())
