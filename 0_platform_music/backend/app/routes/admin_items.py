"""어드민 착장(아이템 스토어) 관리 — ad_items 전체 조회·수정·삭제 + CSV 임포트.

business.py 의 ad_items CRUD 는 광고주 본인 아이템만 다룬다. 이 라우터는
어드민 전용으로 소유자 무관 전체 아이템을 다루며, seed_item_store.py 의
1회성 시드를 대체하는 반복 가능한 CSV 임포트(백그라운드 잡)를 제공한다.

CSV 컬럼(시드와 동일): 구분(플랫폼)·성별·부위·아이템명·브랜드·색상·순위·
디테일페이지URL·이미지URL. 이미지경로(로컬)는 서버 임포트에선 미지원 — URL만.
"""
import asyncio
import csv
import io
import logging
import math
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

import bcrypt
import httpx
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database import postgres as postgres_db
from ..database.postgres import get_pg
from ..database.minio import get_minio
from .admin import _log_admin_action
from .business import ALLOWED_AD_CATEGORIES, ALLOWED_AD_GENDERS, _serialize_doc

router = APIRouter(prefix="/api/admin/items", tags=["admin-items"])

logger = logging.getLogger(__name__)

IMPORT_TAG = "admin_import"
MAX_CSV_SIZE = 5 * 1024 * 1024  # 5MB — 이미지 아닌 텍스트 CSV 기준 충분
MAX_IMAGE_DL_SIZE = 10 * 1024 * 1024
DL_CONCURRENCY = 4
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

EXT_BY_CT = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
GENDER_MAP = {"남성": "남성용", "여성": "여성용", "공용": "공용"}

# 플랫폼 → 소유 계정 (seed_item_store.py 와 동일 매핑 유지)
PLATFORM_ACCOUNTS = {
    "무신사": ("musinsa@aimu.com", "무신사"),
    "29cm": ("twentyninecm@maidol.co.kr", "29cm"),
    "w컨셉": ("wconcept@maidol.co.kr", "w컨셉"),
    "에이블리": ("a-bly@maidol.co.kr", "에이블리"),
    "지그재그": ("zigzag@maidol.co.kr", "지그재그"),
    "크림": ("kream@maidol.co.kr", "크림"),
}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ItemUpdate(BaseModel):
    name: Optional[str] = None
    product_url: Optional[str] = None
    category: Optional[str] = None
    gender: Optional[str] = None
    brand: Optional[str] = None
    product_name: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# CSV row parsing (seed_item_store.py 로직 이식)
# ---------------------------------------------------------------------------

def _parse_gender_category(row: dict):
    sex = (row.get("성별") or "").strip()
    bu = (row.get("부위") or "").strip()
    if "_" in bu:
        g_raw, cat = bu.split("_", 1)
    else:
        g_raw, cat = sex, bu
    return GENDER_MAP.get(g_raw.strip()), cat.strip()


def _product_name_of(row: dict) -> str:
    name = (row.get("아이템명") or "").strip()
    if name:
        return name
    brand = (row.get("브랜드") or "").strip()
    rank = (row.get("순위") or "").strip()
    gender_raw = (row.get("성별") or "").strip() or "여성"
    _, cat = _parse_gender_category(row)
    suffix = f" (인기 {rank}위)" if rank else ""
    return f"{brand} {gender_raw} {cat}{suffix}".strip()


# 업체별 CSV 헤더 편차 흡수 — 정규화된 헤더명 → 표준 컬럼명
HEADER_ALIASES = {
    "구분": "구분", "플랫폼": "구분", "쇼핑몰": "구분",
    "성별": "성별",
    "부위": "부위", "카테고리": "부위", "분류": "부위",
    "아이템명": "아이템명", "상품명": "아이템명", "제품명": "아이템명", "이름": "아이템명",
    "브랜드": "브랜드", "브랜드명": "브랜드",
    "색상": "색상", "컬러": "색상",
    "순위": "순위", "랭킹": "순위",
    "디테일페이지url": "디테일페이지URL", "상품url": "디테일페이지URL",
    "제품url": "디테일페이지URL", "링크": "디테일페이지URL", "url": "디테일페이지URL",
    "이미지url": "이미지URL", "이미지": "이미지URL", "이미지주소": "이미지URL",
    "이미지링크": "이미지URL", "사진": "이미지URL", "사진url": "이미지URL",
}


def _normalize_headers(row: dict) -> dict:
    """헤더명을 표준 컬럼명으로 치환 (공백 제거·소문자 비교). 미지의 헤더는 유지."""
    out = {}
    for k, v in row.items():
        if k is None:
            continue
        key = HEADER_ALIASES.get(k.strip().replace(" ", "").lower(), k.strip())
        out.setdefault(key, v)
    return out


def _parse_rows(raw: bytes):
    """CSV 바이트 → (유효 row dict 목록, 에러 목록). 쓰기 없음 — dry-run 공용."""
    text = raw.decode("utf-8-sig", errors="replace")
    rows = [_normalize_headers(r) for r in csv.DictReader(io.StringIO(text))]
    valid, errors = [], []
    for i, row in enumerate(rows, start=2):  # 헤더 다음 줄부터 = 2행
        platform = (row.get("구분") or "").strip()
        if platform not in PLATFORM_ACCOUNTS:
            errors.append({"line": i, "error": f"알 수 없는 플랫폼(구분): '{platform}'"})
            continue
        gender, category = _parse_gender_category(row)
        if gender is None or category not in ALLOWED_AD_CATEGORIES:
            errors.append({"line": i, "error": f"성별/부위 파싱 실패 (성별={gender}, 부위={category})"})
            continue
        url = (row.get("이미지URL") or "").strip().replace("&amp;", "&")
        if not url.startswith("http"):
            errors.append({"line": i, "error": "이미지URL 없음 (서버 임포트는 URL 필수)"})
            continue
        valid.append({
            "platform": platform,
            "gender": gender,
            "category": category,
            "brand": (row.get("브랜드") or "").strip(),
            "product_name": _product_name_of(row),
            "color": (row.get("색상") or "").strip() or "기본",
            "product_url": (row.get("디테일페이지URL") or "").strip(),
            "image_url": url,
            "source_rank": (row.get("순위") or "").strip(),
        })
    return valid, errors


async def _ensure_platform_accounts(pool) -> dict:
    """플랫폼 소유 계정 upsert → {platform: user_id}. seed 와 동일 규칙."""
    mapping = {}
    async with pool.acquire() as conn:
        for platform, (email, nick) in PLATFORM_ACCOUNTS.items():
            row = await conn.fetchrow("SELECT id FROM users WHERE email=$1", email)
            if row:
                mapping[platform] = str(row["id"])
                continue
            pw_hash = bcrypt.hashpw(uuid_lib.uuid4().hex.encode(), bcrypt.gensalt()).decode()
            row = await conn.fetchrow(
                """INSERT INTO users (email, password_hash, nickname, company_name, display_title, role, account_status, provider)
                   VALUES ($1,$2,$3,$4,'대표','customer','active','local') RETURNING id""",
                email, pw_hash, nick, platform,
            )
            mapping[platform] = str(row["id"])
            logger.info("[admin-items] platform account created %s (%s)", platform, email)
    return mapping


# ---------------------------------------------------------------------------
# 1. GET "" — 전체 아이템 목록 (검색·필터·페이지네이션 + 소유자·카테고리 통계)
# ---------------------------------------------------------------------------

@router.get("")
async def list_items(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    gender: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    hidden: Optional[bool] = Query(None),
    active: Optional[bool] = Query(None),
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    page = max(1, page)
    limit = max(1, min(limit, 100))
    mongo = get_mongo()

    query = {}
    if search:
        rx = {"$regex": search, "$options": "i"}
        query["$or"] = [{"name": rx}, {"brand": rx}, {"product_name": rx}]
    if category:
        query["category"] = category
    if gender:
        query["gender"] = gender
    if owner_id:
        query["user_id"] = owner_id
    if hidden is not None:
        query["admin_hidden"] = True if hidden else {"$ne": True}
    if active is not None:
        query["is_active"] = active

    total = await mongo.ad_items.count_documents(query)
    cursor = mongo.ad_items.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    docs = await cursor.to_list(length=limit)

    # 카테고리별 카운트 (현재 필터 기준, ~수백 건 규모라 부담 없음)
    cat_agg = await mongo.ad_items.aggregate([
        {"$match": query},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]).to_list(length=20)
    by_category = {c["_id"]: c["count"] for c in cat_agg}

    # 소유자 닉네임 붙이기 (PG 1쿼리)
    owner_ids = list({d.get("user_id") for d in docs if d.get("user_id")})
    owners = {}
    if owner_ids:
        try:
            rows = await conn.fetch(
                "SELECT id, nickname, company_name FROM users WHERE id = ANY($1::uuid[])",
                [uuid_lib.UUID(o) for o in owner_ids],
            )
            owners = {str(r["id"]): (r["company_name"] or r["nickname"]) for r in rows}
        except Exception:
            logger.warning("[admin-items] owner lookup failed", exc_info=True)

    items = []
    for d in docs:
        item = _serialize_doc(d)
        item["owner_name"] = owners.get(item.get("user_id"), "-")
        items.append(item)

    return {
        "items": items,
        "by_category": by_category,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------------------
# 2. GET /owners — 아이템 소유 계정 목록 (필터 드롭다운용)
# ---------------------------------------------------------------------------

@router.get("/owners")
async def list_owners(current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    owner_ids = await mongo.ad_items.distinct("user_id")
    owner_ids = [o for o in owner_ids if o]
    result = []
    if owner_ids:
        uuids = []
        for o in owner_ids:
            try:
                uuids.append(uuid_lib.UUID(o))
            except ValueError:
                continue
        rows = await conn.fetch(
            "SELECT id, nickname, company_name, email FROM users WHERE id = ANY($1::uuid[])",
            uuids,
        )
        result = [
            {"id": str(r["id"]), "name": r["company_name"] or r["nickname"], "email": r["email"]}
            for r in rows
        ]
        result.sort(key=lambda x: x["name"] or "")
    return {"owners": result}


# ---------------------------------------------------------------------------
# 3. PUT /{item_id} — 아이템 필드 수정 (어드민, 소유자 무관)
# ---------------------------------------------------------------------------

@router.put("/{item_id}")
async def update_item(
    item_id: str,
    body: ItemUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return JSONResponse(status_code=400, content={"error": "수정할 필드가 없습니다."})
    if "category" in updates and updates["category"] not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(status_code=400, content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"})
    if "gender" in updates and updates["gender"] not in ALLOWED_AD_GENDERS:
        return JSONResponse(status_code=400, content={"error": f"허용되지 않는 성별입니다. 허용값: {', '.join(sorted(ALLOWED_AD_GENDERS))}"})

    mongo = get_mongo()
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    updates["updated_at"] = datetime.now(timezone.utc)
    await mongo.ad_items.update_one({"_id": ObjectId(item_id)}, {"$set": updates})
    updated = await mongo.ad_items.find_one({"_id": ObjectId(item_id)})

    await _log_admin_action(
        conn, current_admin["id"], "item_update", "ad_item", item_id,
        {"fields": [k for k in updates if k != "updated_at"], "name": doc.get("name")},
    )
    return _serialize_doc(updated)


# ---------------------------------------------------------------------------
# 4. DELETE /{item_id} — 아이템 삭제 (Mongo + MinIO best-effort)
# ---------------------------------------------------------------------------

@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    obj = doc.get("image_object_name")
    if obj:
        try:
            get_minio().remove_object(settings.minio_bucket_images, obj)
        except Exception:
            logger.warning("[admin-items] minio remove failed obj=%s", obj)

    await mongo.ad_items.delete_one({"_id": ObjectId(item_id)})
    await _log_admin_action(
        conn, current_admin["id"], "item_delete", "ad_item", item_id,
        {"name": doc.get("name"), "owner_id": doc.get("user_id")},
    )
    return {"message": "아이템이 삭제되었습니다.", "item_id": item_id}


# ---------------------------------------------------------------------------
# 5. POST /import — CSV 임포트 (dry_run 즉시 / 실행은 백그라운드 잡)
# ---------------------------------------------------------------------------

async def _run_import_job(job_id: str, rows: list, mode: str, admin_id: str):
    """백그라운드 임포트 — 이미지 다운로드→MinIO→ad_items insert. 진행률 잡 문서 갱신."""
    mongo = get_mongo()
    jobs = mongo.admin_import_jobs
    minio = get_minio()
    bucket = settings.minio_bucket_images
    pool = postgres_db._pool  # 백그라운드 태스크는 Depends 를 못 쓰므로 풀 직접 참조

    try:
        plat_uid = await _ensure_platform_accounts(pool)

        # replace 모드: CSV 에 등장한 플랫폼 계정의 기존 시드/임포트 아이템 정리
        # (seed_source 없는 광고주 수동 등록분은 보존 — 시드와 동일 규칙)
        if mode == "replace":
            target_uids = list({plat_uid[r["platform"]] for r in rows})
            old = await mongo.ad_items.find(
                {"user_id": {"$in": target_uids}, "seed_source": {"$exists": True}},
                {"image_object_name": 1},
            ).to_list(length=None)
            for d in old:
                obj = d.get("image_object_name")
                if obj:
                    try:
                        minio.remove_object(bucket, obj)
                    except Exception:
                        pass
            res = await mongo.ad_items.delete_many(
                {"user_id": {"$in": target_uids}, "seed_source": {"$exists": True}}
            )
            await jobs.update_one({"_id": job_id}, {"$set": {"replaced": res.deleted_count}})
            logger.info("[admin-items] import job=%s replace cleared=%d", job_id, res.deleted_count)

        now = datetime.now(timezone.utc)
        sem = asyncio.Semaphore(DL_CONCURRENCY)
        inserted = 0
        skipped = []
        lock = asyncio.Lock()

        async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers={"User-Agent": UA}) as client:

            async def process(row):
                nonlocal inserted
                async with sem:
                    try:
                        resp = await client.get(row["image_url"])
                        if resp.status_code != 200 or not resp.content:
                            raise RuntimeError(f"HTTP {resp.status_code}")
                        if len(resp.content) > MAX_IMAGE_DL_SIZE:
                            raise RuntimeError("이미지 10MB 초과")
                        ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                        ext = EXT_BY_CT.get(ct)
                        if not ext:
                            low = row["image_url"].lower()
                            ext = next((e for e in (".jpg", ".png", ".webp", ".gif") if e in low), ".jpg")
                            ct = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}[ext]
                        data = resp.content
                    except Exception as e:
                        async with lock:
                            skipped.append({"platform": row["platform"], "product": row["product_name"], "error": f"이미지 실패: {e}"})
                        return

                uid = plat_uid[row["platform"]]
                object_name = f"ads/{uid}/{uuid_lib.uuid4().hex}{ext}"
                try:
                    await asyncio.to_thread(
                        minio.put_object, bucket, object_name,
                        io.BytesIO(data), length=len(data), content_type=ct,
                    )
                except Exception as e:
                    async with lock:
                        skipped.append({"platform": row["platform"], "product": row["product_name"], "error": f"MinIO 실패: {e}"})
                    return

                name = row["product_name"] if row["color"] in ("", "기본") else f"{row['product_name']} - {row['color']}"
                await mongo.ad_items.insert_one({
                    "user_id": uid,
                    "name": name,
                    "image_object_name": object_name,
                    "product_url": row["product_url"],
                    "category": row["category"],
                    "gender": row["gender"],
                    "brand": row["brand"],
                    "product_name": row["product_name"],
                    "color": row["color"],
                    "is_active": True,
                    "seed_source": IMPORT_TAG,
                    "import_job_id": job_id,
                    "source_rank": row["source_rank"],
                    "created_at": now,
                    "updated_at": now,
                })
                async with lock:
                    inserted += 1
                    if (inserted + len(skipped)) % 20 == 0:
                        await jobs.update_one(
                            {"_id": job_id},
                            {"$set": {"processed": inserted + len(skipped), "inserted": inserted}},
                        )

            await asyncio.gather(*(process(r) for r in rows))

        await jobs.update_one({"_id": job_id}, {"$set": {
            "status": "done",
            "processed": inserted + len(skipped),
            "inserted": inserted,
            "skipped": skipped[:200],
            "skipped_count": len(skipped),
            "finished_at": datetime.now(timezone.utc),
        }})
        logger.info("[admin-items] import job=%s DONE inserted=%d skipped=%d", job_id, inserted, len(skipped))

        try:
            async with pool.acquire() as conn:
                await _log_admin_action(
                    conn, admin_id, "items_import", "ad_item", job_id,
                    {"mode": mode, "inserted": inserted, "skipped": len(skipped)},
                )
        except Exception:
            logger.warning("[admin-items] import audit log failed job=%s", job_id)

    except Exception as e:
        logger.exception("[admin-items] import job=%s FAILED", job_id)
        await jobs.update_one({"_id": job_id}, {"$set": {
            "status": "failed", "error": str(e), "finished_at": datetime.now(timezone.utc),
        }})


@router.post("/import")
async def import_items(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mode: str = Form("append"),
    dry_run: bool = Form(False),
    current_admin=Depends(get_admin_user),
):
    """CSV 임포트. dry_run=True 는 파싱·검증 결과만 즉시 반환(쓰기 없음).

    mode=append: 기존 유지 + 추가. mode=replace: CSV 에 등장한 플랫폼의
    기존 시드/임포트 아이템(seed_source 有)을 지우고 새로 넣음(시즌 전량 교체).
    """
    if mode not in ("append", "replace"):
        return JSONResponse(status_code=400, content={"error": "mode 는 append 또는 replace 여야 합니다."})

    raw = await file.read()
    if len(raw) > MAX_CSV_SIZE:
        return JSONResponse(status_code=400, content={"error": "CSV 크기는 5MB 이하여야 합니다."})

    valid, errors = _parse_rows(raw)
    by_platform = {}
    for r in valid:
        by_platform[r["platform"]] = by_platform.get(r["platform"], 0) + 1

    if dry_run:
        return {
            "dry_run": True,
            "valid_rows": len(valid),
            "by_platform": by_platform,
            "errors": errors[:100],
            "error_count": len(errors),
        }

    if not valid:
        return JSONResponse(status_code=400, content={"error": "임포트할 유효한 행이 없습니다.", "errors": errors[:100]})

    mongo = get_mongo()
    job_id = uuid_lib.uuid4().hex
    await mongo.admin_import_jobs.insert_one({
        "_id": job_id,
        "status": "running",
        "mode": mode,
        "filename": file.filename,
        "total": len(valid),
        "processed": 0,
        "inserted": 0,
        "skipped_count": 0,
        "parse_errors": len(errors),
        "by_platform": by_platform,
        "admin_id": current_admin["id"],
        "started_at": datetime.now(timezone.utc),
    })
    background_tasks.add_task(_run_import_job, job_id, valid, mode, current_admin["id"])
    logger.info(
        "[admin-items] import queued job=%s admin=%s mode=%s rows=%d",
        job_id, str(current_admin["id"])[:8], mode, len(valid),
    )
    return {"job_id": job_id, "total": len(valid), "by_platform": by_platform, "parse_errors": errors[:100]}


# ---------------------------------------------------------------------------
# 6. GET /import-jobs — 임포트 잡 목록 / 상세
# ---------------------------------------------------------------------------

@router.get("/import-jobs")
async def list_import_jobs(limit: int = 10, current_admin=Depends(get_admin_user)):
    mongo = get_mongo()
    docs = await mongo.admin_import_jobs.find().sort("started_at", -1).limit(min(limit, 50)).to_list(length=50)
    jobs = []
    for d in docs:
        d["job_id"] = str(d.pop("_id"))
        for k in ("started_at", "finished_at"):
            if isinstance(d.get(k), datetime):
                d[k] = d[k].isoformat()
        d.pop("skipped", None)  # 목록에선 요약만
        jobs.append(d)
    return {"jobs": jobs}


@router.get("/import-jobs/{job_id}")
async def get_import_job(job_id: str, current_admin=Depends(get_admin_user)):
    mongo = get_mongo()
    d = await mongo.admin_import_jobs.find_one({"_id": job_id})
    if not d:
        return JSONResponse(status_code=404, content={"error": "잡을 찾을 수 없습니다."})
    d["job_id"] = str(d.pop("_id"))
    for k in ("started_at", "finished_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d
