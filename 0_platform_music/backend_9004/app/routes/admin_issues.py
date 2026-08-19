"""IssueDesk(v185) — 4001 어드민 오류 신고 관리 API.

prefix `/api/admin/issues`. 전 엔드포인트 admin-role 필수(get_admin_user).

- GET /                    신고 인박스 목록 (status·reason·q 필터, 페이지네이션)
- GET /summary             요약 카드 4 (미처리·처리중·오늘 인입·7일 완료)
- GET /errors?days=        자동 수집 에러 묶음 (frontend_errors fingerprint $group)
- GET /errors/{fingerprint}  발생 이력 (context.api 요청 메타데이터 포함)
- GET /{issue_id}          신고 상세
- PATCH /{issue_id}/status 상태 전이 (감사 issue_status_change — from/to·note 길이만)

주의: /summary·/errors 는 /{issue_id} 보다 먼저 선언(경로 충돌 방지).
로그 prefix [admin-issues] — id·건수·길이만. 신고 본문·처리 메모·page_url
쿼리 원문은 서버 로그·감사 details 금지(본문 정본은 issue_reports).
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services import dm_service
from .admin import _log_admin_action
from .issues import ISSUE_REASONS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/issues", tags=["admin-issues"])

ISSUE_STATUSES = ("received", "in_progress", "resolved", "dismissed")
MAX_NOTE_LEN = 500
MAX_LIST_LIMIT = 100
DEFAULT_LIST_LIMIT = 20
_ERROR_DAYS_WHITELIST = {7, 30, 90}
_LIST_SCAN_CAP = 2000  # q 앱 레벨 매칭용 상한 (규모 소 — v185 §4)

KST = timezone(timedelta(hours=9))


class StatusBody(BaseModel):
    status: str = ""
    note: Optional[str] = None


class ProbeBody(BaseModel):
    url: str = ""
    method: Optional[str] = "GET"
    fingerprint: Optional[str] = None
    issue_id: Optional[str] = None
    orig_status: Optional[int] = None


# --- 프로브(v186) 상수 ---
PROBE_COOLDOWN_SEC = 10
PROBE_TIMEOUT_SEC = 5.0
MAX_PROBE_URL_LEN = 500
RELATED_ERRORS_WINDOW_MIN = 30
RELATED_ERRORS_LIMIT = 20

# GET 부작용 실측(v186) deny-list — 무인증 도달 가능 + 쓰기 의도 GET.
# admob-callback 은 서명 검증 게이트가 있으나 심층 방어로 프로브 자체를 차단.
# (그 외 쓰기 GET — business/profile·mv/jobs·tracks/my·auth/me/consents — 는
#  전부 인증 게이트라 무인증 프로브가 401 에서 원천 차단됨: 실측 근거는 REPORT)
_PROBE_DENY_PREFIXES = ("/api/rewards/admob-callback",)


def _validate_probe_url(url) -> str:
    """프로브 대상 검증 — SSRF 원천 차단(자기 백엔드 상대 경로만).

    차단 규칙: ① `/api/` prefix 강제 ② `://` 거부(절대 URL) ③ `..` 거부
    ④ `//` 거부(프로토콜 상대·경로 압축) ⑤ 제어문자·공백·백슬래시 거부
    + 길이 상한 + 부작용 GET deny-list. 위반 전부 400.
    """
    if not isinstance(url, str):
        raise HTTPException(status_code=400, detail="프로브 URL 이 올바르지 않습니다.")
    url = url.strip()
    if (
        not url
        or len(url) > MAX_PROBE_URL_LEN
        or not url.startswith("/api/")
        or "://" in url
        or ".." in url
        or "//" in url
        or "\\" in url
        or any(ord(c) < 0x20 or c == " " for c in url)
    ):
        raise HTTPException(status_code=400, detail="프로브 URL 이 올바르지 않습니다.")
    path = url.split("?", 1)[0]
    for prefix in _PROBE_DENY_PREFIXES:
        if path.startswith(prefix):
            raise HTTPException(status_code=400, detail="프로브가 허용되지 않는 경로입니다.")
    return url


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


def _parse_error_days(days) -> int:
    try:
        d = int(days)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    if d not in _ERROR_DAYS_WHITELIST:
        raise HTTPException(status_code=400, detail="기간은 7·30·90일 중 하나여야 합니다.")
    return d


def _serialize_issue(doc: dict, user_info: Optional[dict] = None) -> dict:
    return {
        "id": str(doc["_id"]),
        "user_id": doc.get("user_id"),
        "nickname": (user_info or {}).get("nickname"),
        "code": (user_info or {}).get("code"),
        "reason": doc.get("reason"),
        "text": doc.get("text", ""),
        "page_url": doc.get("page_url"),
        # v188 직전 동선 — additive. 구버전 접수 문서엔 필드 부재 → [] 로 정규화
        "recent_pages": doc.get("recent_pages") or [],
        "user_agent": doc.get("user_agent"),
        "app_version": doc.get("app_version"),
        "status": doc.get("status", "received"),
        "admin_note": doc.get("admin_note"),
        "handled_by": doc.get("handled_by"),
        "handled_at": _iso(doc.get("handled_at")),
        "dm_conversation_id": doc.get("dm_conversation_id"),
        "created_at": _iso(doc.get("created_at")),
    }


# ---------------------------------------------------------------------------
# 1. GET / — 신고 인박스 목록
# ---------------------------------------------------------------------------
@router.get("")
async def list_issues(
    status: Optional[str] = None,
    reason: Optional[str] = None,
    q: str = "",
    page: int = 1,
    limit: int = DEFAULT_LIST_LIMIT,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """목록 — status/reason 필터(화이트리스트 400) + q(내용·닉네임 — hydrate 후
    앱 레벨 매칭, 규모 소) + created_at DESC 페이지네이션."""
    admin_tag = str(current_user["id"])[:8]
    try:
        page = max(int(page), 1)
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_LIST_LIMIT
    q_norm = (q or "").strip().lower()
    logger.info(
        "[admin-issues] list admin=%s status=%s reason=%s qlen=%d page=%d limit=%d",
        admin_tag, status, reason, len(q_norm), page, limit,
    )
    try:
        if status and status not in ISSUE_STATUSES:
            return JSONResponse(status_code=400, content={"error": "지원하지 않는 상태입니다."})
        if reason and reason not in ISSUE_REASONS:
            return JSONResponse(status_code=400, content={"error": "지원하지 않는 사유입니다."})

        query: dict = {}
        if status:
            query["status"] = status
        if reason:
            query["reason"] = reason

        docs = (
            await get_mongo().issue_reports.find(query)
            .sort("created_at", -1)
            .to_list(length=_LIST_SCAN_CAP)
        )

        user_ids = list({d.get("user_id") for d in docs if d.get("user_id")})
        hydrated = {}
        if user_ids:
            try:
                hydrated = await dm_service.hydrate_users(conn, user_ids)
            except Exception:
                logger.warning("[admin-issues] hydrate failed admin=%s", admin_tag, exc_info=True)

        if q_norm:
            def _match(d):
                nick = (hydrated.get(d.get("user_id")) or {}).get("nickname") or ""
                return q_norm in (d.get("text") or "").lower() or q_norm in nick.lower()
            docs = [d for d in docs if _match(d)]

        total = len(docs)
        start = (page - 1) * limit
        page_docs = docs[start:start + limit]
        issues = [_serialize_issue(d, hydrated.get(d.get("user_id"))) for d in page_docs]

        logger.info(
            "[admin-issues] list done admin=%s total=%d returned=%d",
            admin_tag, total, len(issues),
        )
        return {
            "issues": issues,
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
        logger.exception("[admin-issues] list failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "신고 목록을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 2. GET /summary — 요약 카드 4
# ---------------------------------------------------------------------------
@router.get("/summary")
async def issues_summary(current_user=Depends(get_admin_user)):
    """미처리(received)·처리중(in_progress)·오늘 인입(KST)·최근 7일 완료(resolved)."""
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-issues] summary admin=%s", admin_tag)
    try:
        mongo = get_mongo()
        now_kst = datetime.now(KST)
        today_start = now_kst.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)

        received = await mongo.issue_reports.count_documents({"status": "received"})
        in_progress = await mongo.issue_reports.count_documents({"status": "in_progress"})
        today = await mongo.issue_reports.count_documents({"created_at": {"$gte": today_start}})
        resolved_7d = await mongo.issue_reports.count_documents(
            {"status": "resolved", "handled_at": {"$gte": week_ago}}
        )
        return {
            "received": received,
            "in_progress": in_progress,
            "today": today,
            "resolved_7d": resolved_7d,
        }
    except Exception:
        logger.exception("[admin-issues] summary failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "요약을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 3. GET /errors — 자동 수집 에러 묶음 (탭②)
# ---------------------------------------------------------------------------
@router.get("/errors")
async def list_error_groups(
    days: str = "7",
    current_user=Depends(get_admin_user),
):
    """frontend_errors fingerprint 묶음 — count·영향 사용자 수·last_seen·대표 message/page."""
    admin_tag = str(current_user["id"])[:8]
    n_days = _parse_error_days(days)
    logger.info("[admin-issues] errors admin=%s days=%d", admin_tag, n_days)
    try:
        since = datetime.now(timezone.utc) - timedelta(days=n_days)
        groups = []
        async for doc in get_mongo().frontend_errors.aggregate([
            {"$match": {"created_at": {"$gte": since}}},
            {"$sort": {"created_at": 1}},
            {
                "$group": {
                    "_id": "$fingerprint",
                    "count": {"$sum": 1},
                    "users": {"$addToSet": "$user_id"},
                    "last_seen": {"$max": "$created_at"},
                    "message": {"$last": "$message"},
                    "page": {"$last": "$page"},
                }
            },
            {"$sort": {"last_seen": -1}},
            {"$limit": 200},
        ]):
            groups.append({
                "fingerprint": doc["_id"],
                "count": int(doc.get("count") or 0),
                "users": len(doc.get("users") or []),
                "last_seen": _iso(doc.get("last_seen")),
                "message": doc.get("message", ""),
                "page": doc.get("page", ""),
            })

        # v186: 지속 여부 — fp 별 최신 프로브 verdict fold (additive, 미확인 null)
        last_probe_map: dict = {}
        if groups:
            async for p in get_mongo().probe_history.aggregate([
                {"$match": {"fingerprint": {"$in": [g["fingerprint"] for g in groups]}}},
                {"$sort": {"created_at": 1}},
                {
                    "$group": {
                        "_id": "$fingerprint",
                        "verdict": {"$last": "$verdict"},
                        "status": {"$last": "$status"},
                        "probed_at": {"$max": "$created_at"},
                    }
                },
            ]):
                last_probe_map[p["_id"]] = {
                    "verdict": p.get("verdict"),
                    "status": p.get("status"),
                    "probed_at": _iso(p.get("probed_at")),
                }
        for g in groups:
            g["last_probe"] = last_probe_map.get(g["fingerprint"])

        logger.info(
            "[admin-issues] errors done admin=%s days=%d groups=%d",
            admin_tag, n_days, len(groups),
        )
        return {"errors": groups, "days": n_days}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-issues] errors failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "에러 목록을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 4. GET /errors/{fingerprint} — 발생 이력
# ---------------------------------------------------------------------------
@router.get("/errors/{fingerprint}")
async def error_group_history(
    fingerprint: str,
    days: str = "7",
    page: int = 1,
    limit: int = DEFAULT_LIST_LIMIT,
    current_user=Depends(get_admin_user),
):
    """묶음 발생 이력 — created_at DESC, api 메타데이터({method,url,status}) 포함."""
    admin_tag = str(current_user["id"])[:8]
    n_days = _parse_error_days(days)
    try:
        page = max(int(page), 1)
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_LIST_LIMIT
    logger.info(
        "[admin-issues] error history admin=%s fp=%s days=%d page=%d",
        admin_tag, fingerprint, n_days, page,
    )
    try:
        since = datetime.now(timezone.utc) - timedelta(days=n_days)
        mongo = get_mongo()
        query = {"fingerprint": fingerprint, "created_at": {"$gte": since}}
        total = await mongo.frontend_errors.count_documents(query)
        docs = (
            await mongo.frontend_errors.find(query)
            .sort("created_at", -1)
            .skip((page - 1) * limit)
            .limit(limit)
            .to_list(length=limit)
        )
        events = [
            {
                "id": str(d["_id"]),
                "user_id": d.get("user_id"),
                "message": d.get("message", ""),
                "page": d.get("page", ""),
                "api": d.get("api"),
                "stack": d.get("stack"),
                "created_at": _iso(d.get("created_at")),
            }
            for d in docs
        ]
        return {
            "events": events,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if limit else 0,
            },
            "days": n_days,
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-issues] error history failed admin=%s fp=%s", admin_tag, fingerprint
        )
        return JSONResponse(status_code=500, content={"error": "발생 이력을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 4.5 POST /probe — 오류 재확인 프로브 (v186)
# ---------------------------------------------------------------------------
@router.post("/probe")
async def probe_error(
    body: ProbeBody,
    request: Request,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """관리자 재확인 프로브 — 자기 백엔드 127.0.0.1 로 GET 재발사.

    무인증·GET 한정·상대 경로 4중 검증·redirect 미추적·timeout 5s·
    X-Admin-Probe: 1 헤더. 동일 url 쿨다운 10초(429). verdict:
    2xx→resolved / orig_status 일치→persisting / 그 외→indeterminate
    (401/403 은 auth_required 병기 — 무인증 프로브 한계의 정직 표기) /
    네트워크 실패→unreachable. probe_history 이력 + 감사 issue_probe.
    """
    admin_tag = str(current_user["id"])[:8]
    method = (body.method or "GET").strip().upper()
    if method != "GET":
        return JSONResponse(
            status_code=400,
            content={"error": "GET 외 메서드는 재발사할 수 없습니다(curl 복사를 이용하세요)."},
        )
    url = _validate_probe_url(body.url)  # SSRF 4중 차단 — 위반 400
    url_path = url.split("?", 1)[0]  # 로그·감사용(쿼리 원문 금지)
    logger.info("[admin-issues] probe enter admin=%s url=%s", admin_tag, url_path)
    try:
        mongo = get_mongo()

        # 쿨다운 — 동일 url 10초 내 재요청 429 (probe_history 최근 조회, 무상태)
        cooldown_since = datetime.now(timezone.utc) - timedelta(seconds=PROBE_COOLDOWN_SEC)
        recent = await mongo.probe_history.find_one(
            {"url": url, "created_at": {"$gte": cooldown_since}}
        )
        if recent:
            logger.info(
                "[admin-issues] probe denied (cooldown) admin=%s url=%s", admin_tag, url_path
            )
            return JSONResponse(
                status_code=429,
                content={"error": "방금 확인한 대상입니다. 잠시 후 다시 시도해주세요."},
            )

        # 자기 포트 도출 — uvicorn scope(server) 우선, 폴백 request.url.port
        server = request.scope.get("server") or (None, None)
        port = server[1] or request.url.port
        if not port:
            logger.warning("[admin-issues] probe port unresolved admin=%s", admin_tag)
            return JSONResponse(status_code=500, content={"error": "프로브를 실행할 수 없습니다."})

        status = None
        latency_ms = None
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=PROBE_TIMEOUT_SEC, follow_redirects=False
            ) as client:
                resp = await client.get(
                    f"http://127.0.0.1:{port}{url}", headers={"X-Admin-Probe": "1"}
                )
            status = resp.status_code
            latency_ms = int((time.monotonic() - t0) * 1000)
        except httpx.HTTPError:
            latency_ms = int((time.monotonic() - t0) * 1000)
            logger.warning(
                "[admin-issues] probe unreachable admin=%s url=%s", admin_tag, url_path
            )

        if status is None:
            verdict = "unreachable"
        elif 200 <= status < 300:
            verdict = "resolved"
        elif body.orig_status is not None and status == body.orig_status:
            verdict = "persisting"
        else:
            verdict = "indeterminate"
        auth_required = status in (401, 403)

        probed_at = datetime.now(timezone.utc)
        issue_id = (body.issue_id or "").strip() or None
        if issue_id and not ObjectId.is_valid(issue_id):
            issue_id = None
        fingerprint = (body.fingerprint or "").strip() or None
        try:
            await mongo.probe_history.insert_one({
                "fingerprint": fingerprint,
                "issue_id": issue_id,
                "url": url,
                "method": "GET",
                "status": status,
                "verdict": verdict,
                "latency_ms": latency_ms,
                "probed_by": str(current_user["id"]),
                "created_at": probed_at,
            })
        except Exception:
            logger.warning(
                "[admin-issues] probe history store failed admin=%s url=%s",
                admin_tag, url_path, exc_info=True,
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-issues] probe failed admin=%s url=%s", admin_tag, url_path)
        return JSONResponse(status_code=500, content={"error": "프로브를 실행할 수 없습니다."})

    # 감사 적재 (best-effort) — url 은 경로만(쿼리 원문 금지)
    if issue_id:
        target_type, target_id = "issue_report", issue_id
    else:
        target_type, target_id = "error_group", (fingerprint or url_path)
    try:
        await _log_admin_action(
            conn,
            str(current_user["id"]),
            "issue_probe",
            target_type,
            target_id,
            {"url": url_path, "status": status, "verdict": verdict},
        )
    except Exception:
        logger.warning(
            "[admin-issues] probe audit log failed admin=%s url=%s",
            admin_tag, url_path,
            exc_info=True,
        )

    logger.info(
        "[admin-issues] probe done admin=%s url=%s status=%s verdict=%s latency=%s",
        admin_tag, url_path, status, verdict, latency_ms,
    )
    return {
        "url": url,
        "method": "GET",
        "status": status,
        "latency_ms": latency_ms,
        "verdict": verdict,
        "auth_required": auth_required,
        "probed_at": probed_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# 5. GET /{issue_id} — 신고 상세
# ---------------------------------------------------------------------------
@router.get("/{issue_id}")
async def get_issue(
    issue_id: str,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-issues] detail admin=%s issue=%s", admin_tag, issue_id)
    try:
        if not ObjectId.is_valid(issue_id):
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})
        doc = await get_mongo().issue_reports.find_one({"_id": ObjectId(issue_id)})
        if not doc:
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})
        hydrated = {}
        if doc.get("user_id"):
            try:
                hydrated = await dm_service.hydrate_users(conn, [doc["user_id"]])
            except Exception:
                logger.warning(
                    "[admin-issues] hydrate failed admin=%s issue=%s",
                    admin_tag, issue_id, exc_info=True,
                )
        return _serialize_issue(doc, hydrated.get(doc.get("user_id")))
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-issues] detail failed admin=%s issue=%s", admin_tag, issue_id)
        return JSONResponse(status_code=500, content={"error": "신고를 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 5.5 GET /{issue_id}/related-errors — 신고자 본인 ±30분 자동 에러 (v186)
# ---------------------------------------------------------------------------
@router.get("/{issue_id}/related-errors")
async def issue_related_errors(
    issue_id: str,
    current_user=Depends(get_admin_user),
):
    """신고와 같은 사용자·±30분 창의 frontend_errors (기계 관측 병치).

    **신고자 본인(user_id 일치) 한정 — 타 사용자 에러 혼입 금지.**
    최대 20건, 시각 오름차순.
    """
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-issues] related errors admin=%s issue=%s", admin_tag, issue_id)
    try:
        if not ObjectId.is_valid(issue_id):
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})
        mongo = get_mongo()
        issue = await mongo.issue_reports.find_one({"_id": ObjectId(issue_id)})
        if not issue:
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

        reporter_id = issue.get("user_id")
        created = issue.get("created_at")
        if not reporter_id or not isinstance(created, datetime):
            return {"errors": [], "window_minutes": RELATED_ERRORS_WINDOW_MIN}

        window = timedelta(minutes=RELATED_ERRORS_WINDOW_MIN)
        docs = (
            await mongo.frontend_errors.find({
                "user_id": reporter_id,  # 신고자 본인 한정 — 개인정보 원칙
                "created_at": {"$gte": created - window, "$lte": created + window},
            })
            .sort("created_at", 1)
            .to_list(length=RELATED_ERRORS_LIMIT)
        )
        errors = [
            {
                "id": str(d["_id"]),
                "fingerprint": d.get("fingerprint"),
                "message": d.get("message", ""),
                "page": d.get("page", ""),
                "api": d.get("api"),
                "created_at": _iso(d.get("created_at")),
            }
            for d in docs
        ]
        logger.info(
            "[admin-issues] related errors done admin=%s issue=%s count=%d",
            admin_tag, issue_id, len(errors),
        )
        return {"errors": errors, "window_minutes": RELATED_ERRORS_WINDOW_MIN}
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-issues] related errors failed admin=%s issue=%s", admin_tag, issue_id
        )
        return JSONResponse(status_code=500, content={"error": "관련 에러를 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 6. PATCH /{issue_id}/status — 상태 전이 (+감사 적재)
# ---------------------------------------------------------------------------
@router.patch("/{issue_id}/status")
async def update_issue_status(
    issue_id: str,
    body: StatusBody,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """상태 4종 전이 + 처리 메모(≤500). 감사 `issue_status_change` best-effort —
    details 는 {from, to, note_len} 만(본문·메모 원문 미적재).

    v186 additive: status 선택화 — status 없이 note 만 보내면 **메모 단독 변경**
    (검증 결과 자동 기록용). 이때 status/handled_by/handled_at 불변·감사 미적재.
    기존 status 포함 호출의 동작은 불변.
    """
    admin_tag = str(current_user["id"])[:8]
    new_status = (body.status or "").strip()
    note = (body.note or "").strip() if body.note is not None else None
    logger.info(
        "[admin-issues] status enter admin=%s issue=%s to=%s note_len=%d",
        admin_tag, issue_id, new_status or "-", len(note or ""),
    )
    try:
        if not new_status and note is None:
            return JSONResponse(status_code=400, content={"error": "변경할 내용이 없습니다."})
        if new_status and new_status not in ISSUE_STATUSES:
            return JSONResponse(status_code=400, content={"error": "지원하지 않는 상태입니다."})
        if note is not None and len(note) > MAX_NOTE_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"처리 메모는 {MAX_NOTE_LEN}자 이하로 입력해주세요."},
            )
        if not ObjectId.is_valid(issue_id):
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

        mongo = get_mongo()
        doc = await mongo.issue_reports.find_one({"_id": ObjectId(issue_id)})
        if not doc:
            return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

        old_status = doc.get("status", "received")
        update: dict = {}
        if new_status:
            update.update({
                "status": new_status,
                "handled_by": str(current_user["id"]),
                "handled_at": datetime.now(timezone.utc),
            })
        if note is not None:
            update["admin_note"] = note
        await mongo.issue_reports.update_one(
            {"_id": ObjectId(issue_id)}, {"$set": update}
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-issues] status failed admin=%s issue=%s", admin_tag, issue_id
        )
        return JSONResponse(status_code=500, content={"error": "상태를 변경할 수 없습니다."})

    # 감사 적재 (best-effort) — 상태 전이 시에만, from/to·메모 길이만(원문 미적재)
    if new_status:
        try:
            await _log_admin_action(
                conn,
                str(current_user["id"]),
                "issue_status_change",
                "issue_report",
                issue_id,
                {"from": old_status, "to": new_status, "note_len": len(note or "")},
            )
        except Exception:
            logger.warning(
                "[admin-issues] status audit log failed admin=%s issue=%s",
                admin_tag, issue_id,
                exc_info=True,
            )

    logger.info(
        "[admin-issues] status done admin=%s issue=%s %s->%s",
        admin_tag, issue_id, old_status, new_status or old_status,
    )
    return {"id": issue_id, "status": new_status or old_status, "previous": old_status}
