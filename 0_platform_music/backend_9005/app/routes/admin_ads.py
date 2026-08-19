"""AdOps(v184) — 4001 어드민 광고주 관리 API.

prefix `/api/admin/ads`. 전 엔드포인트 admin-role 필수(get_admin_user —
admin_points 패턴). 광고주 = role='customer'. 회사 정보 정본은 Mongo
business_profiles(PG company_name 은 정규화 오염 가능 — v184 §0 실측).

- GET /advertisers                          목록 + 요약 집계 (q 검색, days 기간)
- GET /advertisers/{user_id}                상세 (프로필+계정+성과 요약+아이템)
- GET /advertisers/{user_id}/dashboard      build_dashboard_data 위임
- GET /advertisers/{user_id}/items/{item_id}/stars     build_item_stars_data 위임
- GET /advertisers/{user_id}/items/{item_id}/insights  build_item_insights_data 위임
- PATCH /items/{item_id}/hidden             강제 숨김 설정/해제 (멱등, 감사 적재)

이벤트 의미: ad_impressions = "착장 선택"(용어 — "노출" 금지), CTR = 클릭/착장
선택(기존 광고주 화면 정의). `_worn_counts_by_item` 은 목록/상세에서 호출 금지
(전체 트랙 풀스캔 — dashboard/stars 내부 기존 호출만 허용).

로그 prefix [admin-ads] — admin/advertiser id 앞 8자·item_id·건수만.
회사명·연락처·이메일 값 로그 금지.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from .admin import _log_admin_action
from .business import (
    build_dashboard_data,
    build_item_insights_data,
    build_item_stars_data,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/ads", tags=["admin-ads"])

_DAYS_WHITELIST = {7, 30, 90}
MAX_HIDDEN_REASON_LEN = 200


class HiddenBody(BaseModel):
    hidden: bool
    reason: Optional[str] = None


def _parse_days(days) -> int:
    """days 화이트리스트 {7,30,90} — 그 외(비정수 포함) 400 (analytics 관행)."""
    try:
        d = int(days)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    if d not in _DAYS_WHITELIST:
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    return d


def _parse_user_uuid(user_id: str) -> str:
    """user_id uuid 형식 검증 — 비 uuid 400. 정규화 str 반환."""
    try:
        return str(uuid.UUID(str(user_id or "").strip()))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="잘못된 사용자 ID 형식입니다.")


def _iso(dt) -> Optional[str]:
    # Mongo 는 UTC 를 naive 로 돌려줌 — tz 미표기 시 프론트 new Date() 가
    # 로컬(KST)로 오해석해 9시간 밀림 → UTC 명시 후 직렬화.
    # (dm_service._iso v156.1 선례 방식 복제 — v188 확대적용. 값의 tz 표기만
    #  추가되며 응답 필드·구조·ISO8601 형식은 불변)
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return dt


async def _counts_by_item(collection, item_ids: list, since: Optional[datetime]) -> dict:
    """item_id별 이벤트 건수 집계 — {item_id: count}. since None 이면 누적."""
    if not item_ids:
        return {}
    match: dict = {"item_id": {"$in": item_ids}}
    if since is not None:
        match["timestamp"] = {"$gte": since}
    out: dict = {}
    async for doc in collection.aggregate([
        {"$match": match},
        {"$group": {"_id": "$item_id", "count": {"$sum": 1}}},
    ]):
        out[doc["_id"]] = int(doc.get("count") or 0)
    return out


async def _wish_counts_by_item(conn, item_ids: list) -> dict:
    """PG ad_wishlist 현재 담김수 — {item_id: count}. 실패 시 빈 dict(best-effort)."""
    if not item_ids:
        return {}
    try:
        rows = await conn.fetch(
            "SELECT item_id, COUNT(*) AS cnt FROM ad_wishlist "
            "WHERE item_id = ANY($1::text[]) GROUP BY item_id",
            item_ids,
        )
        return {r["item_id"]: int(r["cnt"]) for r in rows}
    except Exception:
        logger.exception("[admin-ads] wishlist count query failed items=%d", len(item_ids))
        return {}


def _ctr(clicks: int, impressions: int) -> float:
    """CTR = 클릭/착장 선택 ×100 (기존 광고주 화면 정의)."""
    return round(clicks / impressions * 100, 2) if impressions > 0 else 0.0


# ---------------------------------------------------------------------------
# 1. GET /advertisers — 목록 + 요약
# ---------------------------------------------------------------------------
@router.get("/advertisers")
async def list_advertisers(
    q: str = "",
    days: str = "30",
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """광고주(role=customer) 목록 + 집계.

    집계: ad_items 전량 선조회 후 item→advertiser fold (`_worn_counts_by_item`
    호출 금지 — 풀스캔). impressions=착장 선택·clicks 는 days 기간 내,
    wish 는 현재 담김수(PG). q = 회사명·닉네임 부분일치(앱 레벨 — 소규모).
    """
    admin_tag = str(current_user["id"])[:8]
    n_days = _parse_days(days)
    q_norm = (q or "").strip().lower()
    logger.info(
        "[admin-ads] advertisers list admin=%s days=%d qlen=%d",
        admin_tag, n_days, len(q_norm),
    )
    try:
        rows = await conn.fetch(
            """SELECT id::text AS id, nickname, account_status, is_banned, created_at
               FROM users WHERE role = 'customer' ORDER BY created_at DESC"""
        )
        advertiser_ids = [r["id"] for r in rows]

        mongo = get_mongo()

        # 회사 정보 정본 — Mongo business_profiles
        company_map: dict = {}
        if advertiser_ids:
            async for p in mongo.business_profiles.find(
                {"user_id": {"$in": advertiser_ids}}, {"user_id": 1, "company_name": 1}
            ):
                company_map[p.get("user_id")] = p.get("company_name") or ""

        # ad_items 선조회 → item→advertiser 매핑 + 상태 카운트
        item_owner: dict = {}
        item_count: dict = {}
        active_count: dict = {}
        if advertiser_ids:
            async for item in mongo.ad_items.find(
                {"user_id": {"$in": advertiser_ids}},
                {"user_id": 1, "is_active": 1, "admin_hidden": 1},
            ):
                iid = str(item["_id"])
                owner = item.get("user_id")
                item_owner[iid] = owner
                item_count[owner] = item_count.get(owner, 0) + 1
                if item.get("is_active", True) and not item.get("admin_hidden"):
                    active_count[owner] = active_count.get(owner, 0) + 1

        all_item_ids = list(item_owner)
        since = datetime.now(timezone.utc) - timedelta(days=n_days)
        imp_by_item = await _counts_by_item(mongo.ad_impressions, all_item_ids, since)
        click_by_item = await _counts_by_item(mongo.ad_clicks, all_item_ids, since)
        wish_by_item = await _wish_counts_by_item(conn, all_item_ids)

        # item → advertiser fold
        imp_map: dict = {}
        click_map: dict = {}
        wish_map: dict = {}
        for iid, owner in item_owner.items():
            imp_map[owner] = imp_map.get(owner, 0) + imp_by_item.get(iid, 0)
            click_map[owner] = click_map.get(owner, 0) + click_by_item.get(iid, 0)
            wish_map[owner] = wish_map.get(owner, 0) + wish_by_item.get(iid, 0)

        advertisers = []
        for r in rows:
            uid = r["id"]
            company_name = company_map.get(uid, "")
            if q_norm and q_norm not in (company_name or "").lower() and q_norm not in (r["nickname"] or "").lower():
                continue
            impressions = imp_map.get(uid, 0)
            clicks = click_map.get(uid, 0)
            advertisers.append({
                "user_id": uid,
                "nickname": r["nickname"],
                "company_name": company_name,
                "item_count": item_count.get(uid, 0),
                "active_count": active_count.get(uid, 0),
                "impressions": impressions,
                "clicks": clicks,
                "ctr": _ctr(clicks, impressions),
                "wish": wish_map.get(uid, 0),
                "account_status": r["account_status"],
                "is_banned": bool(r["is_banned"]),
                "created_at": _iso(r["created_at"]),
            })
        advertisers.sort(key=lambda a: (-a["clicks"], -a["item_count"], a["user_id"]))

        summary = {
            "advertisers": len(rows),
            "items": len(all_item_ids),
            "active_items": sum(active_count.values()),
            "clicks": sum(click_by_item.values()),
        }
        logger.info(
            "[admin-ads] advertisers list done admin=%s total=%d returned=%d items=%d",
            admin_tag, len(rows), len(advertisers), len(all_item_ids),
        )
        return {"summary": summary, "advertisers": advertisers, "days": n_days}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-ads] advertisers list failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "광고주 목록을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 2. GET /advertisers/{user_id} — 상세
# ---------------------------------------------------------------------------
@router.get("/advertisers/{user_id}")
async def get_advertiser(
    user_id: str,
    days: str = "30",
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """광고주 상세 — Mongo business_profiles 정본 + PG 계정 + 성과 요약(days) +
    아이템 목록(admin_hidden 포함·누적 clicks/wish — worn 미포함: 풀스캔 금지)."""
    admin_tag = str(current_user["id"])[:8]
    n_days = _parse_days(days)
    uid = _parse_user_uuid(user_id)
    logger.info(
        "[admin-ads] advertiser detail admin=%s target=%s days=%d",
        admin_tag, uid[:8], n_days,
    )
    try:
        row = await conn.fetchrow(
            """SELECT id::text AS id, email, nickname, role, account_status,
                      is_banned, created_at
               FROM users WHERE id = $1""",
            uuid.UUID(uid),
        )
        if not row:
            return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

        mongo = get_mongo()
        profile_doc = await mongo.business_profiles.find_one({"user_id": uid})
        profile = None
        if profile_doc:
            profile = {
                "company_name": profile_doc.get("company_name") or "",
                "industry": profile_doc.get("industry") or "",
                "contact_name": profile_doc.get("contact_name") or "",
                "contact_phone": profile_doc.get("contact_phone") or "",
                "updated_at": _iso(profile_doc.get("updated_at")),
            }

        items_raw = await mongo.ad_items.find({"user_id": uid}).sort("created_at", -1).to_list(length=500)
        item_ids = [str(i["_id"]) for i in items_raw]

        since = datetime.now(timezone.utc) - timedelta(days=n_days)
        # ⑥ 성과 요약 — days 기간 내
        imp_period = await _counts_by_item(mongo.ad_impressions, item_ids, since)
        click_period = await _counts_by_item(mongo.ad_clicks, item_ids, since)
        wish_by_item = await _wish_counts_by_item(conn, item_ids)
        # ⑦ 아이템별 누적 clicks (기간 무관)
        click_total = await _counts_by_item(mongo.ad_clicks, item_ids, None)

        items = []
        for i in items_raw:
            iid = str(i["_id"])
            items.append({
                "item_id": iid,
                "name": i.get("name", ""),
                "category": i.get("category", ""),
                "gender": i.get("gender", ""),
                "brand": i.get("brand", ""),
                "product_name": i.get("product_name", ""),
                "color": i.get("color", ""),
                "product_url": i.get("product_url", ""),
                "image_object_name": i.get("image_object_name", ""),
                "is_active": bool(i.get("is_active", True)),
                "admin_hidden": bool(i.get("admin_hidden", False)),
                "admin_hidden_at": _iso(i.get("admin_hidden_at")),
                "clicks": click_total.get(iid, 0),
                "wish": wish_by_item.get(iid, 0),
                "created_at": _iso(i.get("created_at")),
            })

        total_impressions = sum(imp_period.values())
        total_clicks = sum(click_period.values())
        summary = {
            "impressions": total_impressions,
            "clicks": total_clicks,
            "ctr": _ctr(total_clicks, total_impressions),
            "wishes": sum(wish_by_item.values()),
        }

        logger.info(
            "[admin-ads] advertiser detail done admin=%s target=%s items=%d",
            admin_tag, uid[:8], len(items),
        )
        return {
            "advertiser": {
                "user_id": row["id"],
                "email": row["email"],
                "nickname": row["nickname"],
                "role": row["role"],
                "account_status": row["account_status"],
                "is_banned": bool(row["is_banned"]),
                "created_at": _iso(row["created_at"]),
            },
            "profile": profile,
            "summary": summary,
            "items": items,
            "days": n_days,
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-ads] advertiser detail failed admin=%s target=%s", admin_tag, uid[:8]
        )
        return JSONResponse(status_code=500, content={"error": "광고주 정보를 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 3~5. 광고주 관점 위임 (build_* 순수 추출 재사용 — 대외 의미 동일)
# ---------------------------------------------------------------------------
@router.get("/advertisers/{user_id}/dashboard")
async def advertiser_dashboard(
    user_id: str,
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    category: Optional[str] = Query(None),
    verified_only: bool = Query(False),
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """광고주 대시보드(관리자 열람) — build_dashboard_data 위임(읽기 전용)."""
    admin_tag = str(current_user["id"])[:8]
    uid = _parse_user_uuid(user_id)
    logger.info(
        "[admin-ads] advertiser dashboard admin=%s target=%s period=%s",
        admin_tag, uid[:8], period,
    )
    try:
        row = await conn.fetchrow("SELECT 1 FROM users WHERE id = $1", uuid.UUID(uid))
        if not row:
            return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})
        return await build_dashboard_data(
            get_mongo(), conn, uid, period, category, verified_only
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-ads] advertiser dashboard failed admin=%s target=%s",
            admin_tag, uid[:8],
        )
        return JSONResponse(status_code=500, content={"error": "대시보드를 불러올 수 없습니다."})


@router.get("/advertisers/{user_id}/items/{item_id}/stars")
async def advertiser_item_stars(
    user_id: str,
    item_id: str,
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    verified_only: bool = Query(False),
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """아이템 스타별 성과(관리자 열람) — build_item_stars_data 위임.

    user_id ≠ 아이템 소유자면 추출 함수의 기존 소유 검증 그대로 404."""
    admin_tag = str(current_user["id"])[:8]
    uid = _parse_user_uuid(user_id)
    logger.info(
        "[admin-ads] item stars admin=%s target=%s item=%s period=%s",
        admin_tag, uid[:8], item_id, period,
    )
    try:
        return await build_item_stars_data(
            get_mongo(), conn, uid, item_id, period, verified_only
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-ads] item stars failed admin=%s target=%s item=%s",
            admin_tag, uid[:8], item_id,
        )
        return JSONResponse(status_code=500, content={"error": "스타별 성과를 불러올 수 없습니다."})


@router.get("/advertisers/{user_id}/items/{item_id}/insights")
async def advertiser_item_insights(
    user_id: str,
    item_id: str,
    period: str = Query("daily"),
    verified_only: bool = Query(False),
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """아이템 인사이트(관리자 열람) — build_item_insights_data 위임(소유 검증 동일)."""
    admin_tag = str(current_user["id"])[:8]
    uid = _parse_user_uuid(user_id)
    logger.info(
        "[admin-ads] item insights admin=%s target=%s item=%s period=%s",
        admin_tag, uid[:8], item_id, period,
    )
    try:
        return await build_item_insights_data(
            get_mongo(), conn, uid, item_id, period, verified_only
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-ads] item insights failed admin=%s target=%s item=%s",
            admin_tag, uid[:8], item_id,
        )
        return JSONResponse(status_code=500, content={"error": "인사이트를 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 6. PATCH /items/{item_id}/hidden — 강제 숨김 설정/해제 (멱등)
# ---------------------------------------------------------------------------
@router.patch("/items/{item_id}/hidden")
async def set_item_hidden(
    item_id: str,
    body: HiddenBody,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """아이템 강제 숨김 — ad_items.admin_hidden 설정/해제 (광고주 is_active 와 별개,
    광고주 toggle 로 해제 불가). 멱등(동일 상태 200, 감사 미적재).

    reason 은 감사 로그 details 전용(광고주에게 비노출 — 분쟁은 CS 채널).
    updated_at 은 광고주 수정 의미라 불변(admin_hidden_at 별도).
    """
    admin_tag = str(current_user["id"])[:8]
    hidden = bool(body.hidden)
    reason = (body.reason or "").strip()
    logger.info(
        "[admin-ads] hidden enter admin=%s item=%s hidden=%s reason_len=%d",
        admin_tag, item_id, hidden, len(reason),
    )
    try:
        if not ObjectId.is_valid(item_id):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 아이템 ID입니다."})
        if len(reason) > MAX_HIDDEN_REASON_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"사유는 {MAX_HIDDEN_REASON_LEN}자 이하로 입력해주세요."},
            )

        mongo = get_mongo()
        item = await mongo.ad_items.find_one({"_id": ObjectId(item_id)})
        if not item:
            return JSONResponse(status_code=404, content={"error": "아이템을 찾을 수 없습니다."})

        current = bool(item.get("admin_hidden", False))
        if current == hidden:
            logger.info(
                "[admin-ads] hidden no-op admin=%s item=%s hidden=%s",
                admin_tag, item_id, hidden,
            )
            return {"item_id": item_id, "hidden": current, "changed": False}

        if hidden:
            update = {
                "$set": {
                    "admin_hidden": True,
                    "admin_hidden_at": datetime.now(timezone.utc),
                }
            }
        else:
            update = {"$set": {"admin_hidden": False}, "$unset": {"admin_hidden_at": ""}}
        await mongo.ad_items.update_one({"_id": ObjectId(item_id)}, update)
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-ads] hidden failed admin=%s item=%s", admin_tag, item_id
        )
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})

    # 감사 로그 적재 (best-effort) — reason·item name 은 details 전용(로그 미출력)
    action = "ads_admin_hide" if hidden else "ads_admin_unhide"
    try:
        await _log_admin_action(
            conn,
            str(current_user["id"]),
            action,
            "ad_item",
            item_id,
            {
                "advertiser_id": item.get("user_id"),
                "item_name": item.get("name", ""),
                "reason": reason,
            },
        )
    except Exception:
        logger.warning(
            "[admin-ads] hidden audit log failed admin=%s item=%s action=%s",
            admin_tag, item_id, action,
            exc_info=True,
        )

    logger.info(
        "[admin-ads] hidden done admin=%s item=%s hidden=%s advertiser=%s",
        admin_tag, item_id, hidden, str(item.get("user_id"))[:8],
    )
    return {"item_id": item_id, "hidden": hidden, "changed": True}
