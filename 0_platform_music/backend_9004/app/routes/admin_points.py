"""StarAdmin(v180) — 4001 어드민 별(재화) 관리 API.

prefix `/api/admin/points`. 전 엔드포인트 admin-role 필수(get_admin_user).
points_service 의 기존 함수(credit_points/spend_points/get_balance)만 재사용 —
balance 직접 $inc/$set 금지(원자성·멱등 게이트 우회 금지), 서비스 파일 무접촉.

- GET /summary                    유통 잔액·누적/오늘 적립·소진 집계
- GET /users/{user_id}/balance    대상 유저 잔액 (get_balance 위임)
- GET /users/{user_id}/events     대상 유저 원장 (자체 쿼리 — 페이지네이션+필터)
- POST /adjust                    관리자 지급/차감 (action=admin_adjust)

관리자 조정 원장 기록: 지급=credit_points → action `admin_adjust`/+n,
차감=spend_points → action `spend:admin_adjust`/−n (서비스가 접두 자동 부여).
ref=`adm:{uuid8}:{사유≤40자}` — uuid8 로 시도별 유니크(멱등 충돌 회피),
사유 전문은 감사 로그(points_adjust) details 에 저장.

로그 prefix [admin-points] — admin/target id 앞 8자만, 사유 원문 미로그(길이만).
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..models.user import age_years
from ..services import points_service as svc
from .admin import _log_admin_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/points", tags=["admin-points"])

# 관리자 조정 1회 수량 상한 (오입력 방지 — v180 확정)
MAX_ADJUST_AMOUNT = 10_000
MAX_REASON_LEN = 200
REF_REASON_LEN = 40  # ref 임베드 사유 절단 길이(전문은 감사 details)

MAX_EVENTS_LIMIT = 100
DEFAULT_EVENTS_LIMIT = 20


class AdjustBody(BaseModel):
    user_id: str = ""
    direction: str = ""
    # 수동 검증으로 400 반환(pydantic 422 회피 — 비정수도 400 계약)
    amount: Any = None
    reason: str = ""


async def _require_user(conn, user_id: str) -> str:
    """user_id 검증 — 비 uuid 400, users 미실재 404. 정규화된 str(uuid) 반환."""
    try:
        user_uuid = uuid.UUID(str(user_id or "").strip())
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="잘못된 사용자 ID 형식입니다.")
    row = await conn.fetchrow("SELECT 1 FROM users WHERE id = $1", user_uuid)
    if not row:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return str(user_uuid)


# ---------------------------------------------------------------------------
# 1. GET /summary — 유통 요약 (4카드)
# ---------------------------------------------------------------------------
@router.get("/summary")
async def points_summary(current_user=Depends(get_admin_user)):
    """유통 잔액 합계 + 누적/오늘(KST day) 적립·소진 집계.

    point_balances $group 1회 + point_events $facet 1회 (왕복 2회).
    소진(total_spent/today_spent)은 절대값(양수) 로 반환. 빈 컬렉션은 전부 0.
    """
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-points] summary admin=%s", admin_tag)
    try:
        mongo = get_mongo()

        total_balance = 0
        async for doc in mongo.point_balances.aggregate(
            [{"$group": {"_id": None, "total": {"$sum": "$balance"}}}]
        ):
            total_balance = int(doc.get("total") or 0)

        group_stage = {
            "$group": {
                "_id": None,
                "earned": {"$sum": {"$cond": [{"$gt": ["$amount", 0]}, "$amount", 0]}},
                "spent": {
                    "$sum": {"$cond": [{"$lt": ["$amount", 0]}, {"$abs": "$amount"}, 0]}
                },
            }
        }
        facet = {
            "$facet": {
                "cumulative": [group_stage],
                # day 단독 인덱스 없음 — 오늘 집계는 스캔(현 볼륨 수용, §5 리스크)
                "today": [{"$match": {"day": svc._kst_day()}}, group_stage],
            }
        }
        cumulative = {"earned": 0, "spent": 0}
        today = {"earned": 0, "spent": 0}
        async for doc in mongo.point_events.aggregate([facet]):
            if doc.get("cumulative"):
                cumulative = doc["cumulative"][0]
            if doc.get("today"):
                today = doc["today"][0]

        return {
            "total_balance": total_balance,
            "total_earned": int(cumulative.get("earned") or 0),
            "total_spent": int(cumulative.get("spent") or 0),
            "today_earned": int(today.get("earned") or 0),
            "today_spent": int(today.get("spent") or 0),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-points] summary failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "집계를 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 2. GET /users/{user_id}/balance — 대상 유저 잔액
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}/balance")
async def user_point_balance(
    user_id: str,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """대상 유저 잔액 — 비 uuid 400, 미실재 404, points_service.get_balance 재사용."""
    admin_tag = str(current_user["id"])[:8]
    logger.info(
        "[admin-points] balance admin=%s target=%s", admin_tag, str(user_id)[:8]
    )
    try:
        uid = await _require_user(conn, user_id)
        balance = await svc.get_balance(uid)
        return {"balance": balance}
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-points] balance failed admin=%s target=%s",
            admin_tag, str(user_id)[:8],
        )
        return JSONResponse(status_code=500, content={"error": "잔액을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 3. GET /users/{user_id}/events — 대상 유저 원장 (자체 쿼리)
# ---------------------------------------------------------------------------
# filter → Mongo 조건 매핑 (v180 §1):
#   earn   = amount>0, refund: 접두 제외, admin_adjust 제외(관리자조정 필터 소관)
#   spend  = spend: 접두, 단 spend:admin_adjust 제외
#   refund = refund: 접두
#   admin  = admin_adjust + spend:admin_adjust
_EVENT_FILTERS = {
    "earn": {
        "amount": {"$gt": 0},
        "action": {"$not": {"$regex": "^refund:"}, "$ne": "admin_adjust"},
    },
    "spend": {"action": {"$regex": "^spend:", "$ne": "spend:admin_adjust"}},
    "refund": {"action": {"$regex": "^refund:"}},
    "admin": {"action": {"$in": ["admin_adjust", "spend:admin_adjust"]}},
}


@router.get("/users/{user_id}/events")
async def user_point_events(
    user_id: str,
    page: int = 1,
    limit: int = DEFAULT_EVENTS_LIMIT,
    filter: Optional[str] = None,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """대상 유저 원장 — created_at DESC, count+skip/limit 페이지네이션(v176 형식).

    get_history 는 skip/총계 미지원이라 자체 쿼리. 행 `{action, amount, ref, day,
    created_at}` (ref=point_events.track_id). filter ∈ earn|spend|refund|admin.
    """
    admin_tag = str(current_user["id"])[:8]
    try:
        page = max(int(page), 1)
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_EVENTS_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_EVENTS_LIMIT
    logger.info(
        "[admin-points] events admin=%s target=%s page=%d limit=%d filter=%s",
        admin_tag, str(user_id)[:8], page, limit, filter,
    )
    try:
        uid = await _require_user(conn, user_id)

        query: dict = {"user_id": uid}
        if filter:
            cond = _EVENT_FILTERS.get(filter)
            if cond is None:
                return JSONResponse(
                    status_code=400, content={"error": "지원하지 않는 필터입니다."}
                )
            query.update(cond)

        mongo = get_mongo()
        total = await mongo.point_events.count_documents(query)
        cursor = (
            mongo.point_events.find(query)
            .sort("created_at", -1)
            .skip((page - 1) * limit)
            .limit(limit)
        )
        events = []
        async for doc in cursor:
            created = doc.get("created_at")
            events.append(
                {
                    "action": doc.get("action"),
                    "amount": doc.get("amount", 1),
                    "ref": doc.get("track_id"),
                    "day": doc.get("day"),
                    "created_at": created.isoformat() if created is not None and hasattr(created, "isoformat") else created,
                }
            )
        return {
            "events": events,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if limit else 0,
            },
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-points] events failed admin=%s target=%s",
            admin_tag, str(user_id)[:8],
        )
        return JSONResponse(status_code=500, content={"error": "원장을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 4. POST /adjust — 관리자 지급/차감 (action=admin_adjust)
# ---------------------------------------------------------------------------
@router.post("/adjust")
async def adjust_points(
    body: AdjustBody,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """관리자 별 지급/차감 — 기존 credit/spend 함수만 사용(잔액 직접 조작 금지).

    검증 순서: uuid 400 → 실재 404 → direction 400 → amount(정수 1~10,000) 400 →
    reason(trim 1~200자) 400. 지급=credit_points(False→500 — uuid8 ref 라 멱등
    충돌 사실상 불가, 잔액 무접촉이므로 재시도 안전) / 차감=spend_points
    (False→400 잔액 부족 — 원자 차감으로 마이너스 원천 불가).
    성공 시 감사 적재 points_adjust(best-effort) 후 `{balance, event_ref}` 반환.
    사유 원문은 서버 로그 미출력(길이만) — 감사 details 에만 전문 저장.
    """
    admin_tag = str(current_user["id"])[:8]
    direction = (body.direction or "").strip()
    reason = (body.reason or "").strip()
    logger.info(
        "[admin-points] adjust enter admin=%s target=%s direction=%s amount=%s reason_len=%d",
        admin_tag, str(body.user_id)[:8], direction, body.amount, len(reason),
    )
    try:
        uid = await _require_user(conn, body.user_id)  # 400 / 404

        if direction not in ("grant", "deduct"):
            return JSONResponse(
                status_code=400, content={"error": "direction 은 grant 또는 deduct 여야 합니다."}
            )

        amount = body.amount
        if (
            isinstance(amount, bool)
            or not isinstance(amount, int)
            or amount < 1
            or amount > MAX_ADJUST_AMOUNT
        ):
            return JSONResponse(
                status_code=400,
                content={"error": f"수량은 1~{MAX_ADJUST_AMOUNT:,} 사이의 정수여야 합니다."},
            )

        if not reason or len(reason) > MAX_REASON_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"사유는 1~{MAX_REASON_LEN}자로 입력해주세요."},
            )

        # ref — 시도별 유니크(uuid8) + 사유 요약 가시화(전문은 감사 details)
        ref = f"adm:{uuid.uuid4().hex[:8]}:{reason[:REF_REASON_LEN]}"

        if direction == "grant":
            ok = await svc.credit_points(uid, "admin_adjust", amount, ref)
            if not ok:
                # 멱등 충돌(사실상 불가) 또는 내부 오류 — 잔액 무접촉, 재시도 안전
                logger.warning(
                    "[admin-points] adjust grant failed admin=%s target=%s amount=%d",
                    admin_tag, uid[:8], amount,
                )
                return JSONResponse(
                    status_code=500, content={"error": "지급에 실패했습니다. 다시 시도해주세요."}
                )
        else:
            ok = await svc.spend_points(uid, "admin_adjust", amount, ref)
            if not ok:
                logger.info(
                    "[admin-points] adjust denied (insufficient) admin=%s target=%s amount=%d",
                    admin_tag, uid[:8], amount,
                )
                return JSONResponse(
                    status_code=400, content={"error": "잔액이 부족하여 차감할 수 없습니다."}
                )

        balance = await svc.get_balance(uid)
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-points] adjust failed admin=%s target=%s direction=%s",
            admin_tag, str(body.user_id)[:8], direction,
        )
        return JSONResponse(status_code=500, content={"error": "조정을 처리할 수 없습니다."})

    # 감사 로그 적재 (best-effort) — 사유 전문·ref·조정 후 잔액. 실패해도 조정 유지.
    try:
        await _log_admin_action(
            conn,
            str(current_user["id"]),
            "points_adjust",
            "user",
            uid,
            {
                "direction": direction,
                "amount": amount,
                "reason": reason,
                "ref": ref,
                "balance_after": balance,
            },
        )
    except Exception:
        logger.warning(
            "[admin-points] adjust audit log failed admin=%s target=%s",
            admin_tag, uid[:8],
            exc_info=True,
        )

    logger.info(
        "[admin-points] adjust done admin=%s target=%s direction=%s amount=%d balance=%d",
        admin_tag, uid[:8], direction, amount, balance,
    )
    return {"balance": balance, "event_ref": ref}


# ---------------------------------------------------------------------------
# 5. 분석 대시보드 (v181) — GET /analytics/{daily|breakdown|demographics}
# ---------------------------------------------------------------------------
# day 는 KST %Y%m%d 고정폭 문자열 — 사전순 비교 == 날짜순이라 $gte 범위 매치 유효.
# day 단독 인덱스 부재(스캔 — 현 볼륨 수용, v180 §5 리스크 승계).
#
# 개인정보 비노출 절대 규칙: 응답·로그에 user_id/birth_date/gender 개별값 금지 —
# demographics 의 원시 속성은 버킷 합산 직후 서버 내부에서 소멸(버킷 집계만 반환).

_ANALYTICS_DAYS = {7, 30, 90}
_DEMOGRAPHICS_MODES = {"earn", "spend"}
_AGE_BUCKETS = ("10대", "20대", "30대", "40대+", "미상")


def _parse_analytics_days(days) -> int:
    """days 화이트리스트 {7,30,90} — 그 외(비정수 포함) 400."""
    try:
        d = int(days)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    if d not in _ANALYTICS_DAYS:
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    return d


def _kst_day_range(days: int) -> list:
    """KST 오늘 포함 최근 days 일의 %Y%m%d 문자열 리스트(과거→오늘, 연속)."""
    now = datetime.now(svc.KST)
    return [(now - timedelta(days=days - 1 - i)).strftime("%Y%m%d") for i in range(days)]


@router.get("/analytics/daily")
async def analytics_daily(
    days: str = "30",
    current_user=Depends(get_admin_user),
):
    """일별 적립/소진 추이 — day 범위 $match + $group. 누락일 0 채움 연속 range.

    응답 {days: [{day, earned, spent}]} — 배열 길이 == 기간 일수 고정(과거→오늘).
    소진(spent)은 절대값(양수).
    """
    admin_tag = str(current_user["id"])[:8]
    try:
        n_days = _parse_analytics_days(days)
        day_range = _kst_day_range(n_days)
        logger.info("[admin-points] analytics daily admin=%s days=%d", admin_tag, n_days)

        mongo = get_mongo()
        by_day = {}
        async for doc in mongo.point_events.aggregate([
            {"$match": {"day": {"$gte": day_range[0]}}},
            {
                "$group": {
                    "_id": "$day",
                    "earned": {"$sum": {"$cond": [{"$gt": ["$amount", 0]}, "$amount", 0]}},
                    "spent": {
                        "$sum": {"$cond": [{"$lt": ["$amount", 0]}, {"$abs": "$amount"}, 0]}
                    },
                }
            },
        ]):
            by_day[doc["_id"]] = doc

        out = [
            {
                "day": d,
                "earned": int((by_day.get(d) or {}).get("earned") or 0),
                "spent": int((by_day.get(d) or {}).get("spent") or 0),
            }
            for d in day_range
        ]
        return {"days": out}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-points] analytics daily failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "추이를 불러올 수 없습니다."})


@router.get("/analytics/breakdown")
async def analytics_breakdown(
    days: str = "30",
    current_user=Depends(get_admin_user),
):
    """기간 내 액션별 획득/소비 분포 — $facet 2패널, total DESC.

    응답 {earn: [{action, total}], spend: [{action, total}]} — action 은 원장
    원문 그대로(라벨링은 프론트 actionLabel 단일 소스). total 은 양수.
    """
    admin_tag = str(current_user["id"])[:8]
    try:
        n_days = _parse_analytics_days(days)
        start_day = _kst_day_range(n_days)[0]
        logger.info(
            "[admin-points] analytics breakdown admin=%s days=%d", admin_tag, n_days
        )

        mongo = get_mongo()
        earn, spend = [], []
        async for doc in mongo.point_events.aggregate([
            {"$match": {"day": {"$gte": start_day}}},
            {
                "$facet": {
                    "earn": [
                        {"$match": {"amount": {"$gt": 0}}},
                        {"$group": {"_id": "$action", "total": {"$sum": "$amount"}}},
                        {"$sort": {"total": -1, "_id": 1}},
                    ],
                    "spend": [
                        {"$match": {"amount": {"$lt": 0}}},
                        {"$group": {"_id": "$action", "total": {"$sum": {"$abs": "$amount"}}}},
                        {"$sort": {"total": -1, "_id": 1}},
                    ],
                }
            },
        ]):
            earn = doc.get("earn") or []
            spend = doc.get("spend") or []

        def _panel(rows):
            return [
                {"action": r["_id"], "total": int(r.get("total") or 0)} for r in rows
            ]

        return {"earn": _panel(earn), "spend": _panel(spend)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-points] analytics breakdown failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "분포를 불러올 수 없습니다."})


def _age_bucket(birth_date) -> str:
    """만 나이 → 버킷. birth_date NULL(미입력·탈퇴 파기·유저 미실재)은 '미상'."""
    if birth_date is None:
        return "미상"
    age = age_years(birth_date)
    if age < 20:
        return "10대"
    if age < 30:
        return "20대"
    if age < 40:
        return "30대"
    return "40대+"


@router.get("/analytics/demographics")
async def analytics_demographics(
    days: str = "30",
    mode: str = "earn",
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """기간 내 연령대×성별 별 유통 분포 — mode=earn|spend(그 외 400).

    Mongo user_id별 Σ → PG `ANY($1::uuid[])` 일괄 조회(비 uuid skip) →
    age_years 버킷 × 성별(male/female/unknown=NULL+other+미실재) 합산.
    응답 {rows: [{bucket, male, female, unknown, total}](5행 고정), total} —
    **버킷 합산값만**(개별 user_id·birth_date·gender 미포함·미로그).
    """
    admin_tag = str(current_user["id"])[:8]
    try:
        n_days = _parse_analytics_days(days)
        if mode not in _DEMOGRAPHICS_MODES:
            return JSONResponse(
                status_code=400, content={"error": "mode 는 earn 또는 spend 여야 합니다."}
            )
        start_day = _kst_day_range(n_days)[0]
        logger.info(
            "[admin-points] analytics demographics admin=%s days=%d mode=%s",
            admin_tag, n_days, mode,
        )

        if mode == "earn":
            amount_match = {"$gt": 0}
            sum_expr = "$amount"
        else:
            amount_match = {"$lt": 0}
            sum_expr = {"$abs": "$amount"}

        mongo = get_mongo()
        per_user = {}
        async for doc in mongo.point_events.aggregate([
            {"$match": {"day": {"$gte": start_day}, "amount": amount_match}},
            {"$group": {"_id": "$user_id", "total": {"$sum": sum_expr}}},
        ]):
            per_user[str(doc["_id"])] = int(doc.get("total") or 0)

        # PG 속성 일괄 조회 (hydrate 관행 — 비 uuid 안전 skip)
        uuids = []
        for uid in per_user:
            try:
                uuids.append(uuid.UUID(uid))
            except (ValueError, TypeError):
                continue
        attrs = {}
        if uuids:
            rows = await conn.fetch(
                "SELECT id, birth_date, gender FROM users WHERE id = ANY($1::uuid[])",
                uuids,
            )
            attrs = {str(r["id"]): (r["birth_date"], r["gender"]) for r in rows}

        # 버킷 합산 — 개별 속성은 이 루프 안에서 소멸(응답·로그 미출력)
        table = {b: {"male": 0, "female": 0, "unknown": 0} for b in _AGE_BUCKETS}
        for uid, total in per_user.items():
            birth_date, gender = attrs.get(uid, (None, None))
            bucket = _age_bucket(birth_date)
            col = gender if gender in ("male", "female") else "unknown"
            table[bucket][col] += total

        out_rows = []
        grand_total = 0
        for b in _AGE_BUCKETS:
            row = table[b]
            row_total = row["male"] + row["female"] + row["unknown"]
            grand_total += row_total
            out_rows.append(
                {
                    "bucket": b,
                    "male": row["male"],
                    "female": row["female"],
                    "unknown": row["unknown"],
                    "total": row_total,
                }
            )

        logger.info(
            "[admin-points] analytics demographics done admin=%s days=%d mode=%s users=%d",
            admin_tag, n_days, mode, len(per_user),
        )
        return {"rows": out_rows, "total": grand_total}
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-points] analytics demographics failed admin=%s", admin_tag
        )
        return JSONResponse(status_code=500, content={"error": "분포를 불러올 수 없습니다."})
