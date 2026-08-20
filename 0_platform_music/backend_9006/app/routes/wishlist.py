"""광고상품 위시리스트 API.

PG `ad_wishlist` 테이블(user_id, item_id, created_at)에 위시 상태를 저장하고,
상품 상세는 Mongo `ad_items` 컬렉션에서 cross-query 한다 (likes.py 패턴).
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wishlist")

ALLOWED_AD_CATEGORIES = {"상의", "하의", "신발", "장소"}


def _short(user_id: str) -> str:
    """로그용 user_id 축약 (앞 8자만)."""
    return str(user_id)[:8]


class WishToggleBody(BaseModel):
    """옵션 토글 컨텍스트 body. 기존 무바디 호출과 호환."""
    track_id: Optional[str] = None


async def _record_wish_event(mongo, item_id: str, track_id: Optional[str], actor_user_id: str, action: str):
    """ad_wish_events 이벤트 기록 (best-effort — 실패해도 토글 응답에 영향 없음)."""
    try:
        star_user_id = None
        event_track_id = None
        if track_id:
            if ObjectId.is_valid(track_id):
                track = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"uploader_id": 1})
                if track:
                    event_track_id = track_id
                    star_user_id = track.get("uploader_id")
                else:
                    logger.warning(
                        "[wishlist] event track not found item=%s track=%s", item_id, track_id
                    )
            else:
                logger.warning(
                    "[wishlist] event invalid track_id item=%s track=%s", item_id, track_id
                )

        await mongo.ad_wish_events.insert_one({
            "item_id": item_id,
            "track_id": event_track_id,
            "star_user_id": star_user_id,
            "actor_user_id": actor_user_id,
            "action": action,
            "timestamp": datetime.now(timezone.utc),
        })
        logger.info(
            "[wishlist] event recorded item=%s action=%s actor=%s star=%s",
            item_id, action, _short(actor_user_id),
            _short(star_user_id) if star_user_id else None,
        )
    except Exception:
        logger.warning(
            "[wishlist] event record failed item=%s action=%s actor=%s",
            item_id, action, _short(actor_user_id), exc_info=True,
        )


@router.post("/{item_id}/toggle")
async def toggle_wishlist(
    item_id: str,
    body: Optional[WishToggleBody] = None,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    user_id = uuid.UUID(current_user["id"])
    logger.info("[wishlist] toggle enter user=%s item=%s", _short(current_user["id"]), item_id)

    # ObjectId 파싱 실패도 존재하지 않는 아이템으로 취급 → 404
    if not ObjectId.is_valid(item_id):
        logger.warning("[wishlist] toggle invalid ObjectId user=%s item=%s", _short(current_user["id"]), item_id)
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    mongo = get_mongo()
    logger.info("[wishlist] toggle mongo lookup item=%s", item_id)
    doc = await mongo.ad_items.find_one({"_id": ObjectId(item_id)}, {"_id": 1})
    if not doc:
        logger.warning("[wishlist] toggle item not found user=%s item=%s", _short(current_user["id"]), item_id)
        return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

    try:
        result = await conn.execute(
            "DELETE FROM ad_wishlist WHERE user_id = $1 AND item_id = $2",
            user_id, item_id,
        )
        if result != "DELETE 0":
            logger.info("[wishlist] toggle removed user=%s item=%s", _short(current_user["id"]), item_id)
            wishlisted = False
        else:
            await conn.execute(
                "INSERT INTO ad_wishlist (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                user_id, item_id,
            )
            logger.info("[wishlist] toggle added user=%s item=%s", _short(current_user["id"]), item_id)
            wishlisted = True
    except Exception:
        logger.exception("[wishlist] toggle pg error user=%s item=%s", _short(current_user["id"]), item_id)
        raise

    # 토글 결과 확정 후 이벤트 기록 (부가 기능 — 실패해도 본 응답 유지)
    await _record_wish_event(
        mongo,
        item_id=item_id,
        track_id=body.track_id if body else None,
        actor_user_id=current_user["id"],
        action="add" if wishlisted else "remove",
    )

    return {"wishlisted": wishlisted}


@router.get("/check")
async def check_wishlist(
    item_ids: str = Query(""),
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    logger.info("[wishlist] check enter user=%s", _short(current_user["id"]))

    ids = [s.strip() for s in item_ids.split(",") if s.strip()]
    if not ids:
        return {"wishlisted_ids": []}

    user_id = uuid.UUID(current_user["id"])
    logger.info("[wishlist] check pg query user=%s count=%d", _short(current_user["id"]), len(ids))
    rows = await conn.fetch(
        "SELECT item_id FROM ad_wishlist WHERE user_id = $1 AND item_id = ANY($2::text[])",
        user_id, ids,
    )

    return {"wishlisted_ids": [r["item_id"] for r in rows]}


@router.get("/")
async def list_wishlist(
    category: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    logger.info("[wishlist] list enter user=%s category=%s", _short(current_user["id"]), category)

    if category is not None and category not in ALLOWED_AD_CATEGORIES:
        logger.warning(
            "[wishlist] list invalid category user=%s category=%s", _short(current_user["id"]), category
        )
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 카테고리입니다. 허용값: {', '.join(sorted(ALLOWED_AD_CATEGORIES))}"},
        )

    user_id = uuid.UUID(current_user["id"])
    rows = await conn.fetch(
        "SELECT item_id, created_at FROM ad_wishlist WHERE user_id = $1 ORDER BY created_at DESC",
        user_id,
    )
    logger.info("[wishlist] list pg rows user=%s count=%d", _short(current_user["id"]), len(rows))

    if not rows:
        return {"items": []}

    object_ids = [ObjectId(r["item_id"]) for r in rows if ObjectId.is_valid(r["item_id"])]
    mongo = get_mongo()
    docs = await mongo.ad_items.find({"_id": {"$in": object_ids}}).to_list(length=len(object_ids))
    docs_map = {str(d["_id"]): d for d in docs}
    logger.info("[wishlist] list mongo docs user=%s count=%d", _short(current_user["id"]), len(docs))

    # advertiser nickname join (business.py 패턴)
    advertiser_ids = list({str(d.get("user_id")) for d in docs if d.get("user_id")})
    nickname_map: dict = {}
    if advertiser_ids:
        nick_rows = await conn.fetch(
            "SELECT id::text, nickname FROM users WHERE id::text = ANY($1::text[])",
            advertiser_ids,
        )
        nickname_map = {row["id"]: row["nickname"] for row in nick_rows}

    items = []
    for r in rows:
        doc = docs_map.get(r["item_id"])
        if not doc:
            # Mongo 에서 삭제된 고아 item — 결과에서 제외
            logger.warning(
                "[wishlist] list orphan item excluded user=%s item=%s", _short(current_user["id"]), r["item_id"]
            )
            continue
        wishlisted_at = r["created_at"]
        if isinstance(wishlisted_at, datetime):
            wishlisted_at = wishlisted_at.isoformat()
        items.append({
            "id": str(doc["_id"]),
            "name": doc.get("name"),
            "image_object_name": doc.get("image_object_name"),
            "product_url": doc.get("product_url"),
            "category": doc.get("category"),
            "advertiser_nickname": nickname_map.get(str(doc.get("user_id")), ""),
            "is_active": bool(doc.get("is_active", False)),
            "wishlisted_at": wishlisted_at,
        })

    if category is not None:
        items = [i for i in items if i["category"] == category]

    logger.info("[wishlist] list done user=%s items=%d", _short(current_user["id"]), len(items))
    return {"items": items}
