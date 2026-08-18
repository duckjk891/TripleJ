"""
Business (고객사) management & ad system routes.
"""

import io
import logging
import mimetypes
import uuid as uuid_lib
from datetime import datetime, timezone, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.minio import get_minio
from ..database.postgres import get_pg
from ..models.user import is_under_14

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/business")

MAX_AD_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_AD_CATEGORIES = {"상의", "하의", "신발", "장소"}

# 인구통계 분포 소수 버킷 마스킹 기준 (미만이면 "기타(소수)" 합산)
MIN_DEMO_BUCKET = 5
ALLOWED_AD_GENDERS = {"남성용", "여성용", "공용"}


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

async def require_business(user=Depends(get_current_user)):
    if user.get("role") not in ("customer", "admin"):
        raise HTTPException(403, "고객사 권한이 필요합니다.")
    return user


async def _verified_user_ids(conn) -> list:
    """PG users.is_verified=TRUE 인 유저 id(text) 목록.

    verified_only 대시보드 필터용 — 엔드포인트당 1회 조회해 재사용한다.
    """
    rows = await conn.fetch("SELECT id::text FROM users WHERE is_verified IS TRUE")
    return [row["id"] for row in rows]


def _serialize_doc(doc: dict) -> dict:
    """Convert MongoDB document for JSON serialisation."""
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


# ---------------------------------------------------------------------------
# 1. Business Profile
# ---------------------------------------------------------------------------

@router.get("/profile")
async def get_profile(user=Depends(require_business)):
    mongo = get_mongo()
    doc = await mongo.business_profiles.find_one({"user_id": user["id"]})
    if not doc:
        now = datetime.now(timezone.utc)
        new_profile = {
            "user_id": user["id"],
            "company_name": "",
            "industry": "",
            "contact_name": "",
            "contact_phone": "",
            "created_at": now,
            "updated_at": now,
        }
        result = await mongo.business_profiles.insert_one(new_profile)
        new_profile["_id"] = result.inserted_id
        doc = new_profile
    return _serialize_doc(doc)


class ProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None


@router.put("/profile")
async def update_profile(
    body: ProfileUpdate,
    user=Depends(require_business),
):
    mongo = get_mongo()
    update_fields = {"updated_at": datetime.now(timezone.utc)}
    if body.company_name is not None:
        update_fields["company_name"] = body.company_name
    if body.industry is not None:
        update_fields["industry"] = body.industry
    if body.contact_name is not None:
        update_fields["contact_name"] = body.contact_name
    if body.contact_phone is not None:
        update_fields["contact_phone"] = body.contact_phone

    result = await mongo.business_profiles.update_one(
        {"user_id": user["id"]},
        {"$set": update_fields},
    )
    if result.matched_count == 0:
        # Auto-create if not exists
        now = datetime.now(timezone.utc)
        new_profile = {
            "user_id": user["id"],
            "company_name": company_name or "",
            "industry": industry or "",
            "contact_name": contact_name or "",
            "contact_phone": contact_phone or "",
            "created_at": now,
            "updated_at": now,
        }
        await mongo.business_profiles.insert_one(new_profile)

    doc = await mongo.business_profiles.find_one({"user_id": user["id"]})
    return _serialize_doc(doc)


# ---------------------------------------------------------------------------
# 2. Ad Items CRUD
# ---------------------------------------------------------------------------

def _upload_ad_image(contents: bytes, content_type: str, user_id: str) -> str:
    """Upload ad image to MinIO and return object_name."""
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
    ext = ext_map.get(content_type, ".jpg")
    object_name = f"ads/{user_id}/{uuid_lib.uuid4().hex}{ext}"

    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )
    return object_name


@router.post("/ads", status_code=201)
async def create_ad_item(
    image: UploadFile = File(...),
    name: str = Form(...),
    product_url: str = Form(...),
    category: str = Form(...),
    gender: str = Form(...),
    brand: str = Form(""),
    product_name: str = Form(""),
    color: str = Form(""),
    user=Depends(require_business),
):
    logger.info(
        "[business] create ad user=%s cat=%s gender=%s brand=%s color=%s",
        str(user["id"])[:8], category, gender, brand, color,
    )
    if category not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )
    if gender not in ALLOWED_AD_GENDERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 성별입니다. 허용값: {', '.join(sorted(ALLOWED_AD_GENDERS))}"},
        )

    contents = await image.read()
    if len(contents) > MAX_AD_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."})

    content_type = image.content_type or "image/jpeg"
    if content_type not in ALLOWED_IMAGE_TYPES:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 이미지 형식입니다."})

    object_name = _upload_ad_image(contents, content_type, user["id"])

    now = datetime.now(timezone.utc)
    mongo = get_mongo()
    doc = {
        "user_id": user["id"],
        "name": name,
        "image_object_name": object_name,
        "product_url": product_url,
        "category": category,
        "gender": gender,
        "brand": brand,
        "product_name": product_name,
        "color": color,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    result = await mongo.ad_items.insert_one(doc)
    doc["_id"] = result.inserted_id

    return _serialize_doc(doc)


@router.get("/ads")
async def list_ad_items(
    category: Optional[str] = Query(None),
    user=Depends(require_business),
):
    if category is not None and category not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )

    mongo = get_mongo()
    query = {"user_id": user["id"]}
    if category is not None:
        query["category"] = category
    cursor = mongo.ad_items.find(query).sort("created_at", -1)
    items = await cursor.to_list(length=200)
    return {"items": [_serialize_doc(item) for item in items]}


@router.put("/ads/{item_id}")
async def update_ad_item(
    item_id: str,
    name: Optional[str] = Form(None),
    product_url: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    gender: Optional[str] = Form(None),
    brand: Optional[str] = Form(None),
    product_name: Optional[str] = Form(None),
    color: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    user=Depends(require_business),
):
    logger.info(
        "[business] update ad item=%s user=%s brand=%s color=%s",
        item_id, str(user["id"])[:8], brand, color,
    )
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    if category is not None and category not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )
    if gender is not None and gender not in ALLOWED_AD_GENDERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 성별입니다. 허용값: {', '.join(sorted(ALLOWED_AD_GENDERS))}"},
        )

    mongo = get_mongo()
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id), "user_id": user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    update_fields = {"updated_at": datetime.now(timezone.utc)}

    if name is not None:
        update_fields["name"] = name
    if product_url is not None:
        update_fields["product_url"] = product_url
    if gender is not None:
        update_fields["gender"] = gender
    if category is not None:
        update_fields["category"] = category
    if brand is not None:
        update_fields["brand"] = brand
    if product_name is not None:
        update_fields["product_name"] = product_name
    if color is not None:
        update_fields["color"] = color

    if image is not None:
        contents = await image.read()
        if len(contents) > MAX_AD_IMAGE_SIZE:
            return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."})
        content_type = image.content_type or "image/jpeg"
        if content_type not in ALLOWED_IMAGE_TYPES:
            return JSONResponse(status_code=400, content={"error": "지원하지 않는 이미지 형식입니다."})

        # Remove old image from MinIO (best effort)
        old_object = doc.get("image_object_name")
        if old_object:
            try:
                minio_client = get_minio()
                minio_client.remove_object(settings.minio_bucket_images, old_object)
            except Exception:
                pass

        object_name = _upload_ad_image(contents, content_type, user["id"])
        update_fields["image_object_name"] = object_name

    await mongo.ad_items.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": update_fields},
    )

    updated = await mongo.ad_items.find_one({"_id": ObjectId(item_id)})
    return _serialize_doc(updated)


@router.delete("/ads/{item_id}")
async def delete_ad_item(
    item_id: str,
    user=Depends(require_business),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id), "user_id": user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    # Remove image from MinIO
    old_object = doc.get("image_object_name")
    if old_object:
        try:
            minio_client = get_minio()
            minio_client.remove_object(settings.minio_bucket_images, old_object)
        except Exception:
            pass

    await mongo.ad_items.delete_one({"_id": ObjectId(item_id)})
    return {"message": "아이템이 삭제되었습니다.", "item_id": item_id}


@router.patch("/ads/{item_id}/toggle")
async def toggle_ad_item(
    item_id: str,
    user=Depends(require_business),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id), "user_id": user["id"]})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    new_status = not doc.get("is_active", True)
    await mongo.ad_items.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {"is_active": new_status, "updated_at": datetime.now(timezone.utc)}},
    )

    msg = "광고가 활성화되었습니다." if new_status else "광고가 비활성화되었습니다."
    return {"message": msg, "item_id": item_id, "is_active": new_status}


# ---------------------------------------------------------------------------
# 3. Ad Image Proxy
# ---------------------------------------------------------------------------

@router.get("/items/image/{object_name:path}")
async def ad_image_proxy(object_name: str):
    """Proxy ad image from MinIO for external access.

    ads/ prefix 외 객체(profiles/ 등)는 이 문으로 내보내지 않는다 — 버킷 전체
    노출 방지. 모든 광고 이미지는 _upload_ad_image 가 ads/ 아래에만 저장한다.
    """
    if not object_name.startswith("ads/") or ".." in object_name:
        logger.warning("[ad-img] rejected object prefix (len=%d)", len(object_name))
        return JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()

        # Determine media type from extension
        media_type = mimetypes.guess_type(object_name)[0] or "image/png"
        return Response(content=data, media_type=media_type)
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )


# ---------------------------------------------------------------------------
# 4. Active Ads (public, no auth required)
# ---------------------------------------------------------------------------

@router.get("/ads/active")
async def get_active_ads(
    category: Optional[str] = Query(None),
    conn=Depends(get_pg),
):
    """Return all active ad items in random order. No auth required.

    Optional query params:
    - category: filter by category (상의, 하의, 신발, 장소)
    """
    if category is not None and category not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )

    # v184: 관리자 강제 숨김(admin_hidden) 제외 — 필드 부재 기존 문서는 $ne 로 통과
    match_filter: dict = {"is_active": True, "admin_hidden": {"$ne": True}}
    if category is not None:
        match_filter["category"] = category

    mongo = get_mongo()
    # v148: 카탈로그 규모 확대(플랫폼별 실데이터 대량 등록)로 샘플 상한 100→500 상향.
    # 컬렉션이 500 미만이면 전량 반환(랜덤 순). 드릴다운/패싯이 전체 아이템을 볼 수 있게 함.
    pipeline = [
        {"$match": match_filter},
        {"$sample": {"size": 500}},
    ]
    items = await mongo.ad_items.aggregate(pipeline).to_list(length=500)
    serialized = [_serialize_doc(item) for item in items]

    # Collect unique user_ids and fetch nicknames from PostgreSQL
    user_ids = list({item["user_id"] for item in serialized if item.get("user_id")})
    nickname_map: dict = {}
    if user_ids:
        rows = await conn.fetch(
            "SELECT id::text, nickname FROM users WHERE id::text = ANY($1::text[])",
            user_ids,
        )
        nickname_map = {row["id"]: row["nickname"] for row in rows}

    for item in serialized:
        item["advertiser_nickname"] = nickname_map.get(item.get("user_id"), "")

    return {"items": serialized}


# ---------------------------------------------------------------------------
# 5. Impression & Click tracking
# ---------------------------------------------------------------------------

@router.post("/ads/{item_id}/impression")
async def record_impression(
    item_id: str,
    user=Depends(get_current_user),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    six_hours_ago = now - timedelta(hours=6)

    recent = await mongo.ad_impressions.find_one({
        "item_id": item_id,
        "user_id": user.get("id"),
        "timestamp": {"$gte": six_hours_ago},
    })
    if recent:
        return {"status": "duplicate", "message": "6시간 내 중복"}

    await mongo.ad_impressions.insert_one({
        "item_id": item_id,
        "user_id": user.get("id"),
        "timestamp": now,
    })
    return {"message": "노출 기록 완료"}


class ClickBody(BaseModel):
    """Optional click attribution body. 기존 무바디 호출과 호환."""
    track_id: Optional[str] = None
    anon_id: Optional[str] = None  # 비로그인 클릭 추적용 클라이언트 UUID


@router.post("/ads/{item_id}/click")
async def record_click(
    item_id: str,
    body: Optional[ClickBody] = None,
    user=Depends(get_current_user_optional),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    six_hours_ago = now - timedelta(hours=6)

    if user is not None:
        # 로그인 클릭 — 기존과 동일 (user_id 저장 + user_id 기준 6h 가드)
        actor_fields = {"user_id": user.get("id")}
        guard_query = {
            "item_id": item_id,
            "user_id": user.get("id"),
            "timestamp": {"$gte": six_hours_ago},
        }
    else:
        # 익명 클릭 — 유효 UUID anon_id 필수, 없거나 무효면 기록 skip (값 미출력)
        anon_id = body.anon_id if body else None
        anon_valid = False
        if anon_id:
            try:
                uuid_lib.UUID(str(anon_id))
                anon_valid = True
            except (ValueError, TypeError):
                anon_valid = False
        if not anon_valid:
            logger.warning(
                "[adclick] anon click skipped item=%s has_anon_id=%s",
                item_id, bool(anon_id),
            )
            return {"status": "skipped"}
        actor_fields = {"anon_id": anon_id}
        guard_query = {
            "item_id": item_id,
            "anon_id": anon_id,
            "timestamp": {"$gte": six_hours_ago},
        }

    recent = await mongo.ad_clicks.find_one(guard_query)
    if recent:
        return {"status": "duplicate", "message": "6시간 내 중복"}

    doc = {
        "item_id": item_id,
        **actor_fields,
        "timestamp": now,
    }

    # 옵션: track 귀속 태깅 (star_user_id = track uploader)
    track_id = body.track_id if body else None
    if track_id:
        if ObjectId.is_valid(track_id):
            track = await mongo.tracks.find_one(
                {"_id": ObjectId(track_id)}, {"uploader_id": 1}
            )
            if track and track.get("uploader_id"):
                doc["track_id"] = track_id
                doc["star_user_id"] = track["uploader_id"]
                logger.info(
                    "[adclick] attributed item=%s track=%s star=%s",
                    item_id, track_id, str(track["uploader_id"])[:8],
                )
            else:
                logger.warning(
                    "[adclick] track not found, skip attribution item=%s track=%s",
                    item_id, track_id,
                )
        else:
            logger.warning(
                "[adclick] invalid track_id, skip attribution item=%s track=%s",
                item_id, track_id,
            )

    await mongo.ad_clicks.insert_one(doc)
    logger.info("[adclick] recorded item=%s anon=%s", item_id, user is None)
    return {"message": "클릭 기록 완료"}


# ---------------------------------------------------------------------------
# 6. Dashboard
# ---------------------------------------------------------------------------

def _period_start(period: str) -> datetime:
    """Calculate start date for the given period."""
    now = datetime.now(timezone.utc)
    if period == "daily":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "weekly":
        return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _chart_time_ranges(period: str):
    """Return a list of (label, start, end) tuples for chart_data time series."""
    now = datetime.now(timezone.utc)
    ranges = []

    if period == "daily":
        # 최근 7일, 각 날짜별
        for i in range(6, -1, -1):
            day = now - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            label = day_start.strftime("%m-%d")
            ranges.append((label, day_start, day_end))

    elif period == "weekly":
        # 최근 4주, 각 주차별
        current_monday = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        for i in range(3, -1, -1):
            week_start = current_monday - timedelta(weeks=i)
            week_end = week_start + timedelta(weeks=1)
            label = f"{4 - i}주차"
            ranges.append((label, week_start, week_end))

    elif period == "monthly":
        # 최근 6개월, 각 월별
        for i in range(5, -1, -1):
            # i months ago
            year = now.year
            month = now.month - i
            while month <= 0:
                month += 12
                year -= 1
            month_start = datetime(year, month, 1, tzinfo=timezone.utc)
            # next month start
            if month == 12:
                next_start = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                next_start = datetime(year, month + 1, 1, tzinfo=timezone.utc)
            label = f"{month}월"
            ranges.append((label, month_start, next_start))

    return ranges


async def _worn_counts_by_item(mongo, item_ids: set) -> dict:
    """공개 트랙 1회 전수 스캔으로 아이템별 착장 스타 카운트 집계.

    Returns {item_id: {uploader_id: track_count}}.
    스냅샷 우선순위는 tracks.py 트랙 상세와 동일:
    완료 mv_job(include_my_character=True) snapshot 우선, 없으면 track snapshot 폴백.
    """
    if not item_ids:
        return {}

    tracks = await mongo.tracks.find(
        {"is_public": True},
        {
            "uploader_id": 1,
            "generation_id": 1,
            "user_character_snapshot.used_items.id": 1,
        },
    ).to_list(length=None)

    # 트랙과 연결된 완료 mv_job 일괄 조회 (_find_completed_mv 와 동일 조건)
    gen_ids = [t.get("generation_id") for t in tracks if t.get("generation_id")]
    mv_map: dict = {}
    if gen_ids:
        mv_jobs = await mongo.mv_jobs.find(
            {
                "audio_generation_id": {"$in": gen_ids},
                "status": "completed",
                "result_music_video_url": {"$exists": True, "$ne": None},
            },
            {
                "audio_generation_id": 1,
                "include_my_character": 1,
                "user_character_snapshot.used_items.id": 1,
            },
        ).to_list(length=None)
        mv_map = {mv.get("audio_generation_id"): mv for mv in mv_jobs}

    result: dict = {}
    for t in tracks:
        uploader_id = t.get("uploader_id")
        if not uploader_id:
            continue

        mv_job = mv_map.get(t.get("generation_id"))
        snap = None
        if (
            mv_job
            and mv_job.get("include_my_character") is True
            and mv_job.get("user_character_snapshot")
        ):
            snap = mv_job.get("user_character_snapshot")
        elif t.get("user_character_snapshot"):
            snap = t.get("user_character_snapshot")
        if not snap:
            continue

        used_ids = {
            str(it.get("id"))
            for it in (snap.get("used_items") or [])
            if it.get("id")
        }
        for iid in used_ids & item_ids:
            per_star = result.setdefault(iid, {})
            per_star[uploader_id] = per_star.get(uploader_id, 0) + 1

    return result


async def build_item_stars_data(mongo, conn, user_id, item_id, period, verified_only):
    """아이템별 '스타별 성과' 집계 본문 — v184 순수 추출(ad_item_stars 에서 이동).

    require_business 게이트 때문에 admin 이 라우트를 직접 호출할 수 없어
    admin_ads.py 가 이 함수를 재사용한다(v179 추출 전례). 소유 검증
    ({"user_id": user_id})·JSONResponse 오류 경로 포함 본문 그대로 —
    소유 불일치는 기존과 동일 404. 대외 동작·응답·로그 불변.

    verified_only=true 면 위시/클릭 카운트를 본인인증 유저 행적만으로 집계
    (익명 클릭 제외). worn_count 는 행적이 아니므로 무필터 유지.
    """
    logger.info(
        "[adstars] enter item=%s period=%s user=%s verified_only=%s",
        item_id, period, str(user_id)[:8], verified_only,
    )

    if not ObjectId.is_valid(item_id):
        logger.warning("[adstars] invalid item id item=%s", item_id)
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    doc = await mongo.ad_items.find_one(
        {"_id": ObjectId(item_id), "user_id": user_id}, {"_id": 1}
    )
    if not doc:
        logger.warning("[adstars] item not found or not owned item=%s user=%s", item_id, str(user_id)[:8])
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    start = _period_start(period)

    # verified_only — 본인인증 유저 id 집합 1회 조회 후 재사용
    verified_ids = await _verified_user_ids(conn) if verified_only else None

    # 1) 착장 (기간 무관 소급, 행적이 아니므로 verified_only 무필터)
    worn_by_item = await _worn_counts_by_item(mongo, {item_id})
    worn_map = worn_by_item.get(item_id, {})
    logger.info("[adstars] worn item=%s stars=%d", item_id, len(worn_map))

    # 2) 위시 (ad_wish_events, action=add, 기간 내)
    wish_match = {
        "item_id": item_id,
        "action": "add",
        "star_user_id": {"$ne": None},
        "timestamp": {"$gte": start},
    }
    if verified_ids is not None:
        wish_match["actor_user_id"] = {"$in": verified_ids}
    wish_pipeline = [
        {"$match": wish_match},
        {"$group": {"_id": "$star_user_id", "count": {"$sum": 1}}},
    ]
    wish_results = await mongo.ad_wish_events.aggregate(wish_pipeline).to_list(length=1000)
    wish_map = {r["_id"]: r["count"] for r in wish_results}
    logger.info("[adstars] wish item=%s stars=%d", item_id, len(wish_map))

    # 3) 클릭 (star_user_id 귀속 클릭, 기간 내 — verified_only 면 익명 anon_id 클릭 자동 제외)
    click_match = {
        "item_id": item_id,
        "star_user_id": {"$ne": None},
        "timestamp": {"$gte": start},
    }
    if verified_ids is not None:
        click_match["user_id"] = {"$in": verified_ids}
    click_pipeline = [
        {"$match": click_match},
        {"$group": {"_id": "$star_user_id", "count": {"$sum": 1}}},
    ]
    click_results = await mongo.ad_clicks.aggregate(click_pipeline).to_list(length=1000)
    click_map = {r["_id"]: r["count"] for r in click_results}
    logger.info("[adstars] click item=%s stars=%d", item_id, len(click_map))

    # 기간 내 star_user_id 미귀속 클릭 수 ({star_user_id: None} 은 missing 도 매치)
    untracked_query = {
        "item_id": item_id,
        "star_user_id": None,
        "timestamp": {"$gte": start},
    }
    if verified_ids is not None:
        untracked_query["user_id"] = {"$in": verified_ids}
    untracked_clicks = await mongo.ad_clicks.count_documents(untracked_query)

    # union → PG nickname join
    star_ids = list(set(worn_map) | set(wish_map) | set(click_map))
    nickname_map: dict = {}
    follower_map: dict = {}
    if star_ids:
        rows = await conn.fetch(
            "SELECT id::text, nickname FROM users WHERE id::text = ANY($1::text[])",
            star_ids,
        )
        nickname_map = {row["id"]: row["nickname"] for row in rows}

        # 스타별 팔로워 수 (한 번의 GROUP BY)
        follower_rows = await conn.fetch(
            "SELECT followee_id::text AS uid, COUNT(*) AS cnt FROM follows "
            "WHERE followee_id::text = ANY($1::text[]) GROUP BY followee_id",
            star_ids,
        )
        follower_map = {row["uid"]: row["cnt"] for row in follower_rows}

    # 스타별 공개 트랙 재생수 합 (한 번의 Mongo 집계)
    plays_map: dict = {}
    if star_ids:
        plays_pipeline = [
            {"$match": {"uploader_id": {"$in": star_ids}, "is_public": True}},
            {"$group": {"_id": "$uploader_id", "plays": {"$sum": {"$ifNull": ["$play_count", 0]}}}},
        ]
        plays_results = await mongo.tracks.aggregate(plays_pipeline).to_list(length=1000)
        plays_map = {r["_id"]: r["plays"] for r in plays_results}
    logger.info(
        "[adstars] enrich item=%s followed_stars=%d played_stars=%d",
        item_id, len(follower_map), len(plays_map),
    )

    def _engagement(uid: str):
        total_plays = plays_map.get(uid, 0)
        if not total_plays:
            return None
        return round((wish_map.get(uid, 0) + click_map.get(uid, 0)) / total_plays, 4)

    stars = [
        {
            "user_id": uid,
            "nickname": nickname_map.get(uid, ""),
            "worn_count": worn_map.get(uid, 0),
            "wish_count": wish_map.get(uid, 0),
            "click_count": click_map.get(uid, 0),
            "follower_count": follower_map.get(uid, 0),
            "total_plays": plays_map.get(uid, 0),
            "engagement_rate": _engagement(uid),
        }
        for uid in star_ids
    ]
    stars.sort(key=lambda s: (-s["click_count"], -s["wish_count"], -s["worn_count"]))

    logger.info(
        "[adstars] done item=%s stars=%d untracked_clicks=%d verified_only=%s",
        item_id, len(stars), untracked_clicks, verified_only,
    )
    return {"stars": stars, "untracked_clicks": untracked_clicks, "verified_only": verified_only}


@router.get("/ads/{item_id}/stars")
async def ad_item_stars(
    item_id: str,
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    verified_only: bool = Query(False),
    user=Depends(require_business),
    conn=Depends(get_pg),
):
    """아이템별 '스타별 성과' 집계 (착장/위시/클릭) — build_item_stars_data 위임(v184)."""
    return await build_item_stars_data(
        get_mongo(), conn, user["id"], item_id, period, verified_only
    )


KST = timezone(timedelta(hours=9))


def _label_keys(track: dict, field: str) -> list:
    """트랙의 genre/mood 값을 카운트 키 목록으로 변환 (list 면 각각, 없으면 '기타')."""
    val = track.get(field)
    if isinstance(val, list):
        keys = [str(v) for v in val if v]
        return keys or ["기타"]
    if val:
        return [str(val)]
    return ["기타"]


async def build_item_insights_data(mongo, conn, user_id, item_id, period, verified_only):
    """아이템별 인사이트 집계 본문 — v184 순수 추출(ad_item_insights 에서 이동).

    admin_ads.py 재사용(v179 추출 전례). 소유 검증({"user_id": user_id})·
    JSONResponse 오류 경로(period 400 포함) 본문 그대로 — 소유 불일치는 기존과
    동일 404. 대외 동작·응답·로그 불변.

    개별 user_id 는 응답에 포함하지 않는다(집계만).
    verified_only=true 면 본인인증 유저의 위시/클릭 이벤트만 집계(익명 클릭 제외)
    — demographics/by_* 분포도 동일 필터가 적용된다.
    """
    if period not in ("daily", "weekly", "monthly"):
        return JSONResponse(
            status_code=400,
            content={"error": "period 는 daily, weekly, monthly 중 하나여야 합니다."},
        )

    logger.info(
        "[adinsights] enter item=%s period=%s user=%s verified_only=%s",
        item_id, period, str(user_id)[:8], verified_only,
    )

    if not ObjectId.is_valid(item_id):
        logger.warning("[adinsights] invalid item id item=%s", item_id)
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    doc = await mongo.ad_items.find_one(
        {"_id": ObjectId(item_id), "user_id": user_id}, {"_id": 1}
    )
    if not doc:
        logger.warning(
            "[adinsights] item not found or not owned item=%s user=%s",
            item_id, str(user_id)[:8],
        )
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    start = _period_start(period)

    # verified_only — 본인인증 유저 id 집합 1회 조회 후 재사용
    verified_ids = await _verified_user_ids(conn) if verified_only else None

    wish_query = {"item_id": item_id, "action": "add", "timestamp": {"$gte": start}}
    click_query = {"item_id": item_id, "timestamp": {"$gte": start}}
    if verified_ids is not None:
        wish_query["actor_user_id"] = {"$in": verified_ids}
        # user_id $in 조건은 익명(anon_id-only) 클릭도 자동 제외한다
        click_query["user_id"] = {"$in": verified_ids}

    wish_events = await mongo.ad_wish_events.find(
        wish_query,
        {"track_id": 1, "actor_user_id": 1, "timestamp": 1},
    ).to_list(length=None)
    click_events = await mongo.ad_clicks.find(
        click_query,
        {"track_id": 1, "user_id": 1, "timestamp": 1},
    ).to_list(length=None)
    logger.info(
        "[adinsights] events item=%s wishes=%d clicks=%d",
        item_id, len(wish_events), len(click_events),
    )

    # GuardSquad — 만14세 미만 actor(birth_date 기준 만나이) 이벤트는 광고 분석에서
    # 전면 제외 (아동 행적 분석 금지). 이후의 전환/장르/시간대/인구통계 집계 전부에
    # 필터가 적용된다. 로그는 제외 개수만.
    raw_actor_ids = {str(e["actor_user_id"]) for e in wish_events if e.get("actor_user_id")}
    raw_actor_ids |= {str(e["user_id"]) for e in click_events if e.get("user_id")}
    minor_ids: set = set()
    if raw_actor_ids:
        minor_rows = await conn.fetch(
            "SELECT id, birth_date FROM users WHERE id::text = ANY($1::text[]) AND birth_date IS NOT NULL",
            list(raw_actor_ids),
        )
        minor_ids = {str(r["id"]) for r in minor_rows if is_under_14(r["birth_date"])}
    events_before = len(wish_events) + len(click_events)
    if minor_ids:
        wish_events = [e for e in wish_events if str(e.get("actor_user_id")) not in minor_ids]
        click_events = [e for e in click_events if str(e.get("user_id")) not in minor_ids]
    logger.info(
        "[adinsights] minors_excluded=%d",
        events_before - (len(wish_events) + len(click_events)),
    )

    # 1) 위시→클릭 전환
    wishes = len(wish_events)
    clicks = len(click_events)
    wish_to_click = {
        "wishes": wishes,
        "clicks": clicks,
        "rate": round(clicks / wishes, 4) if wishes else None,
    }

    # 2) 장르/무드별 분포 (track_id 있는 이벤트만 트랙 조인, 없으면 '미귀속')
    track_ids = {
        str(e["track_id"])
        for e in (wish_events + click_events)
        if e.get("track_id")
    }
    track_map: dict = {}
    if track_ids:
        obj_ids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(t)]
        if obj_ids:
            tdocs = await mongo.tracks.find(
                {"_id": {"$in": obj_ids}}, {"genre": 1, "mood": 1}
            ).to_list(length=None)
            track_map = {str(t["_id"]): t for t in tdocs}
    logger.info(
        "[adinsights] tracks item=%s referenced=%d resolved=%d",
        item_id, len(track_ids), len(track_map),
    )

    genre_agg: dict = {}
    mood_agg: dict = {}

    def _bump(agg: dict, key: str, idx: int):
        ent = agg.setdefault(key, [0, 0])
        ent[idx] += 1

    for events, idx in ((wish_events, 0), (click_events, 1)):
        for e in events:
            tid = e.get("track_id")
            if not tid:
                _bump(genre_agg, "미귀속", idx)
                _bump(mood_agg, "미귀속", idx)
                continue
            track = track_map.get(str(tid))
            if track is None:
                _bump(genre_agg, "기타", idx)
                _bump(mood_agg, "기타", idx)
                continue
            for key in _label_keys(track, "genre"):
                _bump(genre_agg, key, idx)
            for key in _label_keys(track, "mood"):
                _bump(mood_agg, key, idx)

    def _to_rows(agg: dict) -> list:
        rows = [
            {"key": key, "wishes": ent[0], "clicks": ent[1]}
            for key, ent in agg.items()
        ]
        rows.sort(key=lambda r: (-(r["wishes"] + r["clicks"]), r["key"]))
        return rows

    by_genre = _to_rows(genre_agg)
    by_mood = _to_rows(mood_agg)

    # 3) 시간대/요일별 분포 (UTC → KST 변환 후 버킷팅)
    hour_counts = [0] * 24
    weekday_counts = [0] * 7
    for e in wish_events + click_events:
        ts = e.get("timestamp")
        if not isinstance(ts, datetime):
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        local = ts.astimezone(KST)
        hour_counts[local.hour] += 1
        weekday_counts[local.weekday()] += 1
    by_hour = [{"hour": h, "count": c} for h, c in enumerate(hour_counts)]
    by_weekday = [{"weekday": d, "count": c} for d, c in enumerate(weekday_counts)]

    # 4) 인구통계 (고유 actor 유저 집합 기준, 집계만 — 개별 id 미포함)
    actor_ids = {e.get("actor_user_id") for e in wish_events}
    actor_ids |= {e.get("user_id") for e in click_events}
    actor_ids.discard(None)

    age_band_agg: dict = {}
    gender_agg: dict = {}
    region_agg: dict = {}
    nationality_agg: dict = {}
    matched_users = 0
    if actor_ids:
        user_rows = await conn.fetch(
            "SELECT birth_date, gender, region, nationality FROM users WHERE id::text = ANY($1::text[])",
            [str(a) for a in actor_ids],
        )
        matched_users = len(user_rows)
        current_year = datetime.now(KST).year
        for row in user_rows:
            birth_date = row["birth_date"]
            if birth_date:
                age = current_year - birth_date.year + 1  # 연 나이 (한국식)
                band = f"{(age // 10) * 10}대" if age >= 10 else "10대 미만"
            else:
                band = "미입력"
            age_band_agg[band] = age_band_agg.get(band, 0) + 1

            gender = row["gender"] if row["gender"] in ("male", "female", "other") else "미입력"
            gender_agg[gender] = gender_agg.get(gender, 0) + 1

            region = row["region"] or "미입력"
            region_agg[region] = region_agg.get(region, 0) + 1

            # GuardSquad — 내/외국인 축 (자기신고, 무효/미입력은 "미입력")
            nationality = row["nationality"] if row["nationality"] in ("domestic", "foreign") else "미입력"
            nationality_agg[nationality] = nationality_agg.get(nationality, 0) + 1
    logger.info(
        "[adinsights] demographics item=%s unique_actors=%d matched=%d",
        item_id, len(actor_ids), matched_users,
    )

    def _count_rows(agg: dict, label_key: str) -> list:
        # k-익명성 보호: 인원이 MIN_DEMO_BUCKET 미만인 버킷은 "기타(소수)" 로 합산
        # (아이템×기간 단위로 쪼개진 분포에서 소수 버킷은 개인 식별 위험이 있음)
        rows = []
        minority_total = 0
        for key, cnt in agg.items():
            if 0 < cnt < MIN_DEMO_BUCKET:
                minority_total += cnt
            else:
                rows.append({label_key: key, "count": cnt})
        if minority_total > 0:
            rows.append({label_key: "기타(소수)", "count": minority_total})
        rows.sort(key=lambda r: (-r["count"], r[label_key]))
        return rows

    demographics = {
        "age_bands": _count_rows(age_band_agg, "band"),
        "genders": _count_rows(gender_agg, "key"),
        "regions": _count_rows(region_agg, "key"),
        "nationalities": _count_rows(nationality_agg, "key"),
        "min_bucket": MIN_DEMO_BUCKET,
    }

    logger.info(
        "[adinsights] done item=%s wishes=%d clicks=%d genres=%d moods=%d",
        item_id, wishes, clicks, len(by_genre), len(by_mood),
    )
    return {
        "period": period,
        "verified_only": verified_only,
        "wish_to_click": wish_to_click,
        "by_genre": by_genre,
        "by_mood": by_mood,
        "by_hour": by_hour,
        "by_weekday": by_weekday,
        "demographics": demographics,
    }


@router.get("/ads/{item_id}/insights")
async def ad_item_insights(
    item_id: str,
    period: str = Query("daily"),
    verified_only: bool = Query(False),
    user=Depends(require_business),
    conn=Depends(get_pg),
):
    """아이템별 전환/장르·무드/시간대/인구통계 인사이트 — build_item_insights_data 위임(v184)."""
    return await build_item_insights_data(
        get_mongo(), conn, user["id"], item_id, period, verified_only
    )


async def build_dashboard_data(mongo, conn, user_id, period, category, verified_only):
    """대시보드 집계 본문 — v184 순수 추출(business_dashboard 에서 이동).

    require_business 게이트 때문에 admin 이 라우트를 직접 호출할 수 없어
    admin_ads.py 가 이 함수를 재사용한다(v179 추출 전례). category 400 등
    JSONResponse 오류 경로 포함 본문 그대로 — 대외 동작·응답·로그 불변.
    """
    if category is not None and category not in ALLOWED_AD_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )

    start = _period_start(period)

    # verified_only — 본인인증 유저 id 집합 1회 조회 후 재사용 (익명 클릭 자동 제외)
    verified_ids = await _verified_user_ids(conn) if verified_only else None
    actor_filter = {"user_id": {"$in": verified_ids}} if verified_ids is not None else {}

    # Get ad items for this user (optionally filtered by category)
    item_query = {"user_id": user_id}
    if category is not None:
        item_query["category"] = category
    items_cursor = mongo.ad_items.find(item_query)
    items = await items_cursor.to_list(length=500)

    item_ids = [str(item["_id"]) for item in items]

    time_filter = {"timestamp": {"$gte": start}}

    # Aggregate impressions
    imp_pipeline = [
        {"$match": {"item_id": {"$in": item_ids}, **time_filter, **actor_filter}},
        {"$group": {"_id": "$item_id", "count": {"$sum": 1}}},
    ]
    imp_results = await mongo.ad_impressions.aggregate(imp_pipeline).to_list(length=500)
    imp_map = {r["_id"]: r["count"] for r in imp_results}

    # Aggregate clicks
    click_pipeline = [
        {"$match": {"item_id": {"$in": item_ids}, **time_filter, **actor_filter}},
        {"$group": {"_id": "$item_id", "count": {"$sum": 1}}},
    ]
    click_results = await mongo.ad_clicks.aggregate(click_pipeline).to_list(length=500)
    click_map = {r["_id"]: r["count"] for r in click_results}

    total_impressions = sum(imp_map.values())
    total_clicks = sum(click_map.values())
    ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0.0

    # 아이템별 현재 총 담김수 (PG ad_wishlist — verified_only 면 인증 유저 위시만)
    wish_map: dict = {}
    if item_ids:
        try:
            if verified_ids is not None:
                wish_rows = await conn.fetch(
                    "SELECT item_id, COUNT(*) AS cnt FROM ad_wishlist "
                    "WHERE item_id = ANY($1::text[]) AND user_id::text = ANY($2::text[]) "
                    "GROUP BY item_id",
                    item_ids, verified_ids,
                )
            else:
                wish_rows = await conn.fetch(
                    "SELECT item_id, COUNT(*) AS cnt FROM ad_wishlist "
                    "WHERE item_id = ANY($1::text[]) GROUP BY item_id",
                    item_ids,
                )
            wish_map = {row["item_id"]: row["cnt"] for row in wish_rows}
        except Exception:
            logger.exception("[dashboard] wishlist count query failed user=%s", str(user_id)[:8])

    # 아이템별 착장 스타 카운트 (공개 트랙 1회 전수 스캔)
    worn_by_item = await _worn_counts_by_item(mongo, set(item_ids))

    dashboard_items = []
    for item in items:
        iid = str(item["_id"])
        impressions = imp_map.get(iid, 0)
        clicks = click_map.get(iid, 0)
        item_ctr = (clicks / impressions * 100) if impressions > 0 else 0.0
        dashboard_items.append({
            "item_id": iid,
            "name": item.get("name", ""),
            "image_object_name": item.get("image_object_name", ""),
            "product_url": item.get("product_url", ""),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": round(item_ctr, 2),
            "wish_count": wish_map.get(iid, 0),
            "worn_count": sum(worn_by_item.get(iid, {}).values()),
        })

    total_wishes = sum(wish_map.values())
    total_worn = sum(
        sum(per_star.values()) for per_star in worn_by_item.values()
    )

    # ------------------------------------------------------------------
    # total_users: 활성(비차단) 사용자 수 from PostgreSQL
    # ------------------------------------------------------------------
    try:
        user_count_row = await conn.fetchrow(
            "SELECT COUNT(*) AS cnt FROM users WHERE is_banned IS NOT TRUE"
        )
        total_users = user_count_row["cnt"] if user_count_row else 0
    except Exception:
        total_users = 0

    # ------------------------------------------------------------------
    # chart_data: 시계열 데이터 (period별 시간 범위)
    # ------------------------------------------------------------------
    time_ranges = _chart_time_ranges(period)
    chart_data = []

    for label, range_start, range_end in time_ranges:
        range_filter = {"timestamp": {"$gte": range_start, "$lt": range_end}}

        # Impressions count for this time range
        imp_ts_pipeline = [
            {"$match": {"item_id": {"$in": item_ids}, **range_filter, **actor_filter}},
            {"$group": {
                "_id": None,
                "count": {"$sum": 1},
                "unique_users": {"$addToSet": "$user_id"},
            }},
        ]
        imp_ts_result = await mongo.ad_impressions.aggregate(imp_ts_pipeline).to_list(length=1)

        if imp_ts_result:
            range_impressions = imp_ts_result[0]["count"]
            range_users = len(imp_ts_result[0].get("unique_users", []))
        else:
            range_impressions = 0
            range_users = 0

        # Clicks count for this time range
        click_ts_pipeline = [
            {"$match": {"item_id": {"$in": item_ids}, **range_filter, **actor_filter}},
            {"$group": {"_id": None, "count": {"$sum": 1}}},
        ]
        click_ts_result = await mongo.ad_clicks.aggregate(click_ts_pipeline).to_list(length=1)
        range_clicks = click_ts_result[0]["count"] if click_ts_result else 0

        range_ctr = (range_clicks / range_impressions * 100) if range_impressions > 0 else 0.0

        chart_data.append({
            "label": label,
            "impressions": range_impressions,
            "clicks": range_clicks,
            "ctr": round(range_ctr, 2),
            "users": range_users,
        })

    logger.info(
        "[dashboard] done user=%s items=%d verified_only=%s",
        str(user_id)[:8], len(dashboard_items), verified_only,
    )
    return {
        "category": category,
        "verified_only": verified_only,
        "total_impressions": total_impressions,
        "total_clicks": total_clicks,
        "ctr": round(ctr, 2),
        "items": dashboard_items,
        "total_users": total_users,
        "chart_data": chart_data,
        "total_wishes": total_wishes,
        "total_worn": total_worn,
    }


@router.get("/dashboard")
async def business_dashboard(
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    category: Optional[str] = Query(None),
    verified_only: bool = Query(False),
    user=Depends(require_business),
    conn=Depends(get_pg),
):
    """고객사 대시보드 — build_dashboard_data 위임(v184)."""
    return await build_dashboard_data(
        get_mongo(), conn, user["id"], period, category, verified_only
    )
