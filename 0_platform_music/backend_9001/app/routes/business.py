"""
Business (고객사) management & ad system routes.
"""

import io
import mimetypes
import uuid as uuid_lib
from datetime import datetime, timezone, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.minio import get_minio
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/business")

MAX_AD_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_AD_CATEGORIES = {"상의", "하의", "신발", "장소"}
ALLOWED_AD_GENDERS = {"남성용", "여성용", "공용"}


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

async def require_business(user=Depends(get_current_user)):
    if user.get("role") not in ("customer", "admin"):
        raise HTTPException(403, "고객사 권한이 필요합니다.")
    return user


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
    user=Depends(require_business),
):
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
    image: Optional[UploadFile] = File(None),
    user=Depends(require_business),
):
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
    """Proxy ad image from MinIO for external access."""
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

    match_filter: dict = {"is_active": True}
    if category is not None:
        match_filter["category"] = category

    mongo = get_mongo()
    pipeline = [
        {"$match": match_filter},
        {"$sample": {"size": 100}},
    ]
    items = await mongo.ad_items.aggregate(pipeline).to_list(length=100)
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


@router.post("/ads/{item_id}/click")
async def record_click(
    item_id: str,
    user=Depends(get_current_user),
):
    if not ObjectId.is_valid(item_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})

    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    six_hours_ago = now - timedelta(hours=6)

    recent = await mongo.ad_clicks.find_one({
        "item_id": item_id,
        "user_id": user.get("id"),
        "timestamp": {"$gte": six_hours_ago},
    })
    if recent:
        return {"status": "duplicate", "message": "6시간 내 중복"}

    await mongo.ad_clicks.insert_one({
        "item_id": item_id,
        "user_id": user.get("id"),
        "timestamp": now,
    })
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


@router.get("/dashboard")
async def business_dashboard(
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    user=Depends(require_business),
):
    mongo = get_mongo()
    start = _period_start(period)

    # Get all ad items for this user
    items_cursor = mongo.ad_items.find({"user_id": user["id"]})
    items = await items_cursor.to_list(length=500)

    item_ids = [str(item["_id"]) for item in items]

    time_filter = {"timestamp": {"$gte": start}}

    # Aggregate impressions
    imp_pipeline = [
        {"$match": {"item_id": {"$in": item_ids}, **time_filter}},
        {"$group": {"_id": "$item_id", "count": {"$sum": 1}}},
    ]
    imp_results = await mongo.ad_impressions.aggregate(imp_pipeline).to_list(length=500)
    imp_map = {r["_id"]: r["count"] for r in imp_results}

    # Aggregate clicks
    click_pipeline = [
        {"$match": {"item_id": {"$in": item_ids}, **time_filter}},
        {"$group": {"_id": "$item_id", "count": {"$sum": 1}}},
    ]
    click_results = await mongo.ad_clicks.aggregate(click_pipeline).to_list(length=500)
    click_map = {r["_id"]: r["count"] for r in click_results}

    total_impressions = sum(imp_map.values())
    total_clicks = sum(click_map.values())
    ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0.0

    dashboard_items = []
    for item in items:
        iid = str(item["_id"])
        impressions = imp_map.get(iid, 0)
        clicks = click_map.get(iid, 0)
        item_ctr = (clicks / impressions * 100) if impressions > 0 else 0.0
        dashboard_items.append({
            "item_id": iid,
            "image_url": f"/api/business/items/image/{item.get('image_object_name', '')}",
            "product_url": item.get("product_url", ""),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": round(item_ctr, 2),
        })

    return {
        "total_impressions": total_impressions,
        "total_clicks": total_clicks,
        "ctr": round(ctr, 2),
        "items": dashboard_items,
    }
