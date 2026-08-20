"""v148 — 아이템 스토어 실데이터 대량 시드 (item_images CSV → 계정 5개 + ad_items 449건).

1회성 시드. 백필과 동일하게 Mongo/MinIO 직접 조작. seed_source 태깅으로 멱등.
실행: backend_9005 에서  ./venv/bin/python seed_item_store.py
"""
import asyncio
import csv
import glob
import io
import logging
import os
import uuid as uuid_lib
import urllib.request
from datetime import datetime, timezone

import asyncpg
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database.minio import get_minio, init_minio

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed")

ITEM_DIR = os.path.join(os.path.dirname(__file__), "..", "item_images")
SEED_TAG = "item_images_csv"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# 플랫폼 → (email, nickname)
ACCOUNTS = {
    "29cm": ("twentyninecm@maidol.co.kr", "29cm"),
    "w컨셉": ("wconcept@maidol.co.kr", "w컨셉"),
    "에이블리": ("a-bly@maidol.co.kr", "에이블리"),
    "지그재그": ("zigzag@maidol.co.kr", "지그재그"),
    "크림": ("kream@maidol.co.kr", "크림"),
}
MUSINSA_EMAIL = "musinsa@aimu.com"  # 기존 계정 재사용

EXT_BY_CT = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
GENDER_MAP = {"남성": "남성용", "여성": "여성용"}
ALLOWED_CT = set(EXT_BY_CT.keys())


def parse_gender_category(row):
    sex = (row.get("성별") or "").strip()
    bu = (row.get("부위") or "").strip()
    if "_" in bu:
        g_raw, cat = bu.split("_", 1)
    else:
        g_raw, cat = sex, bu
    gender = GENDER_MAP.get(g_raw.strip())
    return gender, cat.strip()


def product_name_of(row):
    name = (row.get("아이템명") or "").strip()
    if name:
        return name
    # 에이블리 폴백 (a): 브랜드 + 성별 + 상의 + 순위
    brand = (row.get("브랜드") or "").strip()
    rank = (row.get("순위") or "").strip()
    gender_raw = (row.get("성별") or "").strip() or "여성"
    _, cat = parse_gender_category(row)
    suffix = f" (인기 {rank}위)" if rank else ""
    return f"{brand} {gender_raw} {cat}{suffix}".strip()


def resolve_image_bytes(row):
    """Return (bytes, ext) or None. 로컬 우선 → 원격 다운로드."""
    ip = (row.get("이미지경로") or "").strip()
    if ip and ip not in ("(이미지 미포함)",):
        local = os.path.join(ITEM_DIR, *ip.split("/")) if not os.path.isabs(ip) else ip
        # CSV 이미지경로는 item_images 기준 상대. cwd=backend_9005 이므로 ITEM_DIR 결합.
        if os.path.isfile(local):
            with open(local, "rb") as fh:
                data = fh.read()
            ext = os.path.splitext(local)[1].lower() or ".jpg"
            return data, ext
    # 원격 다운로드
    url = (row.get("이미지URL") or "").strip().replace("&amp;", "&")
    if not url or not url.startswith("http"):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = resp.read()
            ct = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        ext = EXT_BY_CT.get(ct)
        if not ext:
            # content-type 미상 → URL 확장자 추정
            for e in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                if e in url.lower():
                    ext = ".jpg" if e == ".jpeg" else e
                    break
            ext = ext or ".jpg"
        if not data:
            return None
        return data, ext
    except Exception as e:
        logger.warning("[seed] image download FAIL url=%s err=%s", url[:80], e)
        return None


async def ensure_accounts(conn):
    """5개 계정 upsert + 무신사 조회. returns {platform: user_id}."""
    pw_hash = bcrypt.hashpw("123456".encode(), bcrypt.gensalt()).decode()
    mapping = {}
    for platform, (email, nick) in ACCOUNTS.items():
        existing = await conn.fetchrow("SELECT id FROM users WHERE email=$1", email)
        if existing:
            uid = str(existing["id"])
            logger.info("[seed] account exists platform=%s email=%s uid=%s", platform, email, uid[:8])
        else:
            row = await conn.fetchrow(
                """INSERT INTO users (email, password_hash, nickname, company_name, display_title, role, account_status, provider)
                   VALUES ($1,$2,$3,$4,'대표','customer','active','local') RETURNING id""",
                email, pw_hash, nick, platform,
            )
            uid = str(row["id"])
            logger.info("[seed] account CREATED platform=%s email=%s uid=%s", platform, email, uid[:8])
        mapping[platform] = uid
    # 무신사
    m = await conn.fetchrow("SELECT id FROM users WHERE email=$1", MUSINSA_EMAIL)
    if not m:
        raise RuntimeError("무신사 계정(musinsa@aimu.com) 없음 — 확인 필요")
    mapping["무신사"] = str(m["id"])
    logger.info("[seed] 무신사 uid=%s", str(m["id"])[:8])
    return mapping


async def main():
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    minio = get_minio()
    bucket = settings.minio_bucket_images

    conn = await asyncpg.connect(settings.postgres_dsn)
    plat_uid = await ensure_accounts(conn)
    await conn.close()

    mc = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mc[settings.mongo_db]

    # 멱등: 이전 시드 삭제 (기존 테스트 6개는 seed_source 없음 → 보존)
    prev = await db.ad_items.delete_many({"seed_source": SEED_TAG})
    logger.info("[seed] cleared previous seeded items: %d", prev.deleted_count)

    rows = []
    for f in sorted(glob.glob(os.path.join(ITEM_DIR, "*", "*.csv"))):
        with open(f, encoding="utf-8-sig") as fh:
            rows.extend(list(csv.DictReader(fh)))
    logger.info("[seed] total CSV rows: %d", len(rows))

    inserted = 0
    skipped = []
    by_platform = {}
    now = datetime.now(timezone.utc)

    for i, row in enumerate(rows):
        platform = (row.get("구분") or "").strip()
        uid = plat_uid.get(platform)
        if not uid:
            skipped.append((platform, "no account", row.get("디테일페이지URL")))
            continue
        gender, category = parse_gender_category(row)
        if gender is None or category not in ("상의", "하의", "신발"):
            skipped.append((platform, f"bad gender/cat g={gender} c={category}", row.get("디테일페이지URL")))
            continue
        brand = (row.get("브랜드") or "").strip()
        pname = product_name_of(row)
        color = (row.get("색상") or "").strip() or "기본"
        purl = (row.get("디테일페이지URL") or "").strip()

        img = resolve_image_bytes(row)
        if img is None:
            skipped.append((platform, "no image", purl))
            continue
        data, ext = img
        ct = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "image/jpeg")
        object_name = f"ads/{uid}/{uuid_lib.uuid4().hex}{ext}"
        try:
            minio.put_object(bucket, object_name, io.BytesIO(data), length=len(data), content_type=ct)
        except Exception as e:
            logger.warning("[seed] minio put FAIL platform=%s err=%s", platform, e)
            skipped.append((platform, f"minio fail {e}", purl))
            continue

        name = pname if color in ("", "기본") else f"{pname} - {color}"
        doc = {
            "user_id": uid,
            "name": name,
            "image_object_name": object_name,
            "product_url": purl,
            "category": category,
            "gender": gender,
            "brand": brand,
            "product_name": pname,
            "color": color,
            "is_active": True,
            "seed_source": SEED_TAG,
            "source_rank": (row.get("순위") or "").strip(),
            "created_at": now,
            "updated_at": now,
        }
        await db.ad_items.insert_one(doc)
        inserted += 1
        by_platform[platform] = by_platform.get(platform, 0) + 1
        if inserted % 50 == 0:
            logger.info("[seed] progress inserted=%d", inserted)

    logger.info("=" * 50)
    logger.info("[seed] DONE inserted=%d skipped=%d", inserted, len(skipped))
    for p, c in sorted(by_platform.items()):
        logger.info("   %s: %d", p, c)
    if skipped:
        logger.info("[seed] --- SKIPPED (%d) ---", len(skipped))
        for s in skipped[:60]:
            logger.info("   %s | %s | %s", *s)


if __name__ == "__main__":
    asyncio.run(main())
