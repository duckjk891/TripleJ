"""age1 — 곡·앨범 연령 등급 관리자 API (관리자 웹 '곡 관리' 연령 등급 탭).

- GET  /api/admin/age-ratings/summary                 등급 분포·차단·미분류·실패 수 + 스위치 상태
- GET  /api/admin/age-ratings/items?kind=&rating=&q=  목록(rating: all|12|15|19|unrated|failed|blocked)
- PUT  /api/admin/age-ratings/{kind}/{item_id}        수동 등급 수정(오분류 대응) — source=admin, 관리 기록
- POST /api/admin/age-ratings/{kind}/{item_id}/reclassify  AI 재분류(분류 시작일 이후만)
- POST /api/admin/age-ratings/sweep                   스위퍼 즉시 깨우기

수동 등급은 제목·커버가 바뀌기 전까지 유지된다(스위퍼는 근거가 바뀐 곡만 재분류).
"""

import logging
import math
import re
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services import age_rating
from ..services.media_urls import browser_image_url
from .admin import _log_admin_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/age-ratings", tags=["admin-age-ratings"])

_KINDS = {"tracks": ("uploader_id", "uploader_nickname"), "albums": ("owner_id", "owner_nickname")}


class AgeRatingUpdate(BaseModel):
    rating: str
    note: Optional[str] = None


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def _item(kind: str, d: dict) -> dict:
    owner_f, nick_f = _KINDS[kind]
    cover = d.get("cover_image_url")
    return {
        "id": str(d["_id"]),
        "kind": kind,
        "title": d.get("title") or "",
        "owner_id": d.get(owner_f),
        "owner_nickname": d.get(nick_f),
        "cover_image": browser_image_url(cover) if age_rating.cover_object_name(cover) else None,
        "cover_object": age_rating.cover_object_name(cover),  # 관리자 웹 AuthImage(/api/admin/media) 용
        "is_public": d.get("is_public", True) is not False,
        "report_blinded": bool(d.get("report_blinded")),
        "age_rating": d.get("age_rating"),
        "effective_rating": age_rating.effective_rating(d),
        "age_blocked": bool(d.get("age_blocked")),
        "reasons": d.get("age_rating_reasons") or [],
        "source": d.get("age_rating_source"),
        "rated_at": _iso(d.get("age_rated_at")),
        "error": d.get("age_rating_error"),
        "attempts": int(d.get("age_rating_attempts") or 0),
        "created_at": _iso(d.get("created_at")),
    }


def _rating_filter(rating: Optional[str]) -> dict:
    if not rating:
        return {}
    if rating in age_rating.RATINGS:
        return {"age_rating": rating}
    if rating == "unrated":
        return {"$or": [{"age_rating": {"$exists": False}}, {"age_rating": None}]}
    if rating == "failed":
        return {"age_rating_error": {"$nin": [None, ""]}}
    if rating == "blocked":
        return {"age_blocked": True}
    return {}


@router.get("/summary")
async def summary(current_admin=Depends(get_admin_user)):
    mongo = get_mongo()
    out = {}
    for kind in _KINDS:
        c = getattr(mongo, kind)
        public_q = {"$or": [{"is_public": True}, {"is_public": {"$exists": False}}, {"age_blocked": True}]}
        by = {}
        async for r in c.aggregate([
            {"$match": public_q},
            {"$group": {"_id": {"$ifNull": ["$age_rating", "unrated"]}, "n": {"$sum": 1}}},
        ]):
            by[str(r["_id"])] = int(r["n"])
        out[kind] = {
            "by_rating": {k: by.get(k, 0) for k in (*age_rating.RATINGS, "unrated")},
            "public_total": sum(by.values()),
            "blocked": await c.count_documents({"age_blocked": True}),
            "failed": await c.count_documents({"age_rating_error": {"$nin": [None, ""]}}),
            "admin_set": await c.count_documents({"age_rating_source": "admin"}),
        }
    start = age_rating.classify_from()
    out["switches"] = {
        "classify_from": start.isoformat() if start else None,
        "classify_enabled": age_rating.classify_enabled(),
        "filter_enabled": age_rating.filter_enabled(),
        "adult19_visible": age_rating.adult19_enabled(),
        "model": age_rating.model_id(),
    }
    return out


@router.get("/items")
async def list_items(
    kind: str = Query("tracks"),
    rating: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    current_admin=Depends(get_admin_user),
):
    if kind not in _KINDS:
        return JSONResponse(status_code=400, content={"error": "kind 는 tracks 또는 albums 입니다."})
    mongo = get_mongo()
    c = getattr(mongo, kind)
    query = _rating_filter(rating)
    if q:
        pat = re.escape(q.strip()[:60])
        text_q = {"$or": [{"title": {"$regex": pat, "$options": "i"}},
                          {_KINDS[kind][1]: {"$regex": pat, "$options": "i"}}]}
        query = {"$and": [query, text_q]} if query else text_q
    total = await c.count_documents(query)
    docs = await c.find(query, {"lyrics": 0, "prompt": 0}).sort("created_at", -1) \
        .skip((page - 1) * limit).limit(limit).to_list(length=limit)
    return {
        "items": [_item(kind, d) for d in docs],
        "pagination": {"page": page, "limit": limit, "total": total,
                       "totalPages": math.ceil(total / limit) if limit else 0},
    }


async def _load(kind: str, item_id: str):
    if kind not in _KINDS:
        return None, JSONResponse(status_code=400, content={"error": "kind 는 tracks 또는 albums 입니다."})
    if not ObjectId.is_valid(item_id):
        return None, JSONResponse(status_code=400, content={"error": "유효하지 않은 ID입니다."})
    doc = await getattr(get_mongo(), kind).find_one({"_id": ObjectId(item_id)})
    if not doc:
        return None, JSONResponse(status_code=404, content={"error": "찾을 수 없습니다."})
    return doc, None


@router.get("/{kind}/{item_id}")
async def get_item(kind: str, item_id: str, current_admin=Depends(get_admin_user)):
    """검토용 상세 — 가사 전문 포함(관리자만)."""
    doc, err = await _load(kind, item_id)
    if err:
        return err
    out = _item(kind, doc)
    out["lyrics"] = doc.get("lyrics") if kind == "tracks" else None
    return {"item": out}


@router.put("/{kind}/{item_id}")
async def set_rating(
    kind: str,
    item_id: str,
    body: AgeRatingUpdate,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    if body.rating not in age_rating.RATINGS:
        return JSONResponse(status_code=400, content={"error": "등급은 all·12·15·19 중 하나입니다."})
    doc, err = await _load(kind, item_id)
    if err:
        return err
    note = (body.note or "").strip()[:100]
    reasons = [{"category": "admin", "source": "admin", "note": note or "관리자 수정"}]
    prev = doc.get("age_rating")
    res = await age_rating.apply_rating(kind, doc, body.rating, reasons, "admin", admin_id=current_admin["id"])
    await _log_admin_action(
        conn, current_admin["id"], "set_age_rating", kind[:-1], item_id,
        {"from": prev, "to": body.rating, "note": note, "is_public": res.get("is_public")},
    )
    logger.info("[age] admin set kind=%s id=%s %s->%s admin=%s", kind, item_id[:8], prev, body.rating,
                str(current_admin["id"])[:8])
    fresh = await getattr(get_mongo(), kind).find_one({"_id": doc["_id"]}, {"lyrics": 0, "prompt": 0})
    return {"item": _item(kind, fresh)}


@router.post("/{kind}/{item_id}/reclassify")
async def reclassify(kind: str, item_id: str, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    if not age_rating.classify_enabled():
        return JSONResponse(status_code=409, content={"error": "분류 시작일 전이라 AI 분류를 할 수 없습니다."})
    doc, err = await _load(kind, item_id)
    if err:
        return err
    rating = await age_rating.classify_and_apply(kind, doc)
    await _log_admin_action(conn, current_admin["id"], "reclassify_age_rating", kind[:-1], item_id,
                            {"from": doc.get("age_rating"), "to": rating})
    fresh = await getattr(get_mongo(), kind).find_one({"_id": doc["_id"]}, {"lyrics": 0, "prompt": 0})
    if rating is None:
        return JSONResponse(status_code=502, content={"error": "분류에 실패했습니다.", "item": _item(kind, fresh)})
    return {"item": _item(kind, fresh)}


@router.post("/sweep")
async def sweep_now(current_admin=Depends(get_admin_user)):
    age_rating.kick()
    return {"ok": True}
