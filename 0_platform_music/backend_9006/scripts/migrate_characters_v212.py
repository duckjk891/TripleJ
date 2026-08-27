"""v212 — characters 아티스트 다중화 마이그레이션 (PLAN D5).

규칙 (legacy 무character_id doc 만 대상 — **멱등**: cid 보유 doc 스킵):
  1. real 시트 존재 → **in-place 승격**: character_id 발급, kind='real',
     is_default=True, gender='' 시드, 시트 copy
     (characters/{uid}/sheet.png → characters/{uid}/{cid}/sheet.png)
  2. virtual 시트 '도' 존재 → **별도 신규 doc**(kind='virtual',
     art_style←virtual_art_style, used_items←virtual_used_items, 시트 copy)
     후 원 doc 의 virtual_* unset. 양쪽 보유 계정은 user_slots.extra_slots>=1
     grandfather (초과 상태 방지 — 실측 0건, 방어 코드)
  3. real 없고 virtual 만 → in-place 를 virtual 아티스트로 전환(is_default=True)

구 경로 객체(sheet.png / sheet_virtual.png)는 **보존**(copy — 과거 참조 안전).
인덱스 생성 동반. 기본 **dry-run** — 어떤 쓰기도 하지 않고 판정만 출력.

Usage:
    cd backend_9006
    ./venv/bin/python scripts/migrate_characters_v212.py              # dry-run
    ./venv/bin/python scripts/migrate_characters_v212.py --user-id U  # 특정 계정만 (리허설)
    ./venv/bin/python scripts/migrate_characters_v212.py --apply      # 실적용 (▲사용자 승인 후)
"""

import argparse
import asyncio
import sys
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from minio import Minio
from minio.commonconfig import CopySource
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings


def _minio() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=bool(settings.minio_secure),
    )


def _copy_object(minio_client: Minio, src: str, dst: str, apply: bool) -> bool:
    """src → dst 복사 (구 객체 보존). dry-run 은 존재 확인만."""
    try:
        minio_client.stat_object(settings.minio_bucket_images, src)
    except Exception:
        print(f"    [ArtistMigrate]   WARN source object missing: {src} — 경로 갱신 스킵(원경로 유지)")
        return False
    if not apply:
        return True
    minio_client.copy_object(
        settings.minio_bucket_images, dst,
        source=CopySource(settings.minio_bucket_images, src),
    )
    return True


async def run(apply: bool, user_id_filter: str) -> int:
    mongo_client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = mongo_client[settings.mongo_db]
    minio_client = _minio()

    mode = "APPLY" if apply else "DRY-RUN"
    print("=" * 78)
    print(f"characters v212 migration [{mode}] db={settings.mongo_db}"
          f"{' user=' + user_id_filter if user_id_filter else ''}"
          f"  at={datetime.utcnow().isoformat(timespec='seconds')}Z")
    print("=" * 78)

    query = {"character_id": {"$exists": False}}
    if user_id_filter:
        query["user_id"] = user_id_filter
    legacy_docs = await db.characters.find(query).to_list(length=None)
    skipped_cid = await db.characters.count_documents(
        {"character_id": {"$exists": True},
         **({"user_id": user_id_filter} if user_id_filter else {})}
    )
    print(f"legacy(무cid) 대상 {len(legacy_docs)}건 / cid 보유 스킵(멱등) {skipped_cid}건\n")

    counters = {"real_promoted": 0, "virtual_split": 0, "virtual_converted": 0,
                "grandfathered": 0, "skipped_empty": 0}

    for doc in legacy_docs:
        uid = doc.get("user_id")
        has_real = bool(doc.get("sheet_object_name"))
        has_virtual = bool(doc.get("virtual_sheet_object_name"))
        print(f"[ArtistMigrate] user={uid} _id={doc['_id']} real={has_real} virtual={has_virtual}")

        if not has_real and not has_virtual:
            counters["skipped_empty"] += 1
            print("    -> 시트 없음: 판정 스킵 (빈 doc — 수동 검토)")
            continue

        now = datetime.utcnow()

        if has_real:
            # ① in-place real 승격
            cid = uuid.uuid4().hex
            old_sheet = doc["sheet_object_name"]
            new_sheet = f"characters/{uid}/{cid}/sheet.png"
            copied = _copy_object(minio_client, old_sheet, new_sheet, apply)
            set_fields = {
                "character_id": cid,
                "kind": "real",
                "is_default": True,
                "gender": doc.get("gender") or "",
                "art_style": "",
                "updated_at": now,
            }
            if copied:
                set_fields["sheet_object_name"] = new_sheet
            print(f"    -> real 승격 cid={cid} sheet={'copied' if copied else 'kept-old-path'}")
            if apply:
                await db.characters.update_one({"_id": doc["_id"]}, {"$set": set_fields})
            counters["real_promoted"] += 1

            if has_virtual:
                # ② virtual 분리 신규 doc + 원 doc virtual_* unset
                vcid = uuid.uuid4().hex
                old_vsheet = doc["virtual_sheet_object_name"]
                new_vsheet = f"characters/{uid}/{vcid}/sheet.png"
                vcopied = _copy_object(minio_client, old_vsheet, new_vsheet, apply)
                v_doc = {
                    "user_id": uid,
                    "character_id": vcid,
                    "kind": "virtual",
                    "is_default": False,
                    "name": doc.get("name") or "",
                    "age": doc.get("age") or "",
                    "gender": doc.get("gender") or "",
                    "personality_tags": doc.get("personality_tags") or [],
                    "personality_text": doc.get("personality_text") or "",
                    "sheet_object_name": new_vsheet if vcopied else old_vsheet,
                    "used_items": doc.get("virtual_used_items") or [],
                    "art_style": doc.get("virtual_art_style") or "",
                    "image_model": doc.get("image_model") or "nb_pro",
                    "original_photo_object_name": "",
                    "created_at": doc.get("created_at") or now,
                    "updated_at": now,
                }
                print(f"    -> virtual 분리 신규 doc cid={vcid} sheet={'copied' if vcopied else 'kept-old-path'}")
                if apply:
                    await db.characters.insert_one(v_doc)
                    await db.characters.update_one(
                        {"_id": doc["_id"]},
                        {"$unset": {"virtual_sheet_object_name": "",
                                    "virtual_art_style": "",
                                    "virtual_used_items": ""}},
                    )
                counters["virtual_split"] += 1

                # 양쪽 보유 → 슬롯 grandfather (extra_slots >= 1)
                print("    -> 양쪽 보유: user_slots.extra_slots grandfather >=1")
                if apply:
                    await db.user_slots.update_one(
                        {"user_id": uid},
                        {"$max": {"extra_slots": 1}, "$set": {"updated_at": now}},
                        upsert=True,
                    )
                counters["grandfathered"] += 1
        else:
            # ③ virtual 단독 — in-place virtual 전환
            cid = uuid.uuid4().hex
            old_vsheet = doc["virtual_sheet_object_name"]
            new_vsheet = f"characters/{uid}/{cid}/sheet.png"
            vcopied = _copy_object(minio_client, old_vsheet, new_vsheet, apply)
            set_fields = {
                "character_id": cid,
                "kind": "virtual",
                "is_default": True,
                "gender": doc.get("gender") or "",
                "sheet_object_name": new_vsheet if vcopied else old_vsheet,
                "used_items": doc.get("virtual_used_items") or [],
                "art_style": doc.get("virtual_art_style") or "",
                "updated_at": now,
            }
            print(f"    -> virtual 단독 in-place 전환 cid={cid} sheet={'copied' if vcopied else 'kept-old-path'}")
            if apply:
                await db.characters.update_one(
                    {"_id": doc["_id"]},
                    {"$set": set_fields,
                     "$unset": {"virtual_sheet_object_name": "",
                                "virtual_art_style": "",
                                "virtual_used_items": ""}},
                )
            counters["virtual_converted"] += 1

    # 인덱스 생성 동반 (idempotent — main.py 시동 ensure 와 동일 정의)
    if apply:
        await db.characters.create_index("user_id")
        await db.characters.create_index(
            [("user_id", 1), ("character_id", 1)],
            unique=True,
            partialFilterExpression={"character_id": {"$exists": True}},
        )
        await db.user_slots.create_index("user_id", unique=True)
        print("\n[ArtistMigrate] indexes ensured")

    print(f"\n결과 [{mode}]: {counters}")
    if not apply:
        print("dry-run — mongo/MinIO 무변조. 실적용은 --apply (▲사용자 승인 후).")
    mongo_client.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="실적용 (기본 dry-run)")
    parser.add_argument("--user-id", default="", help="특정 user_id 만 (리허설)")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.apply, args.user_id.strip())))
