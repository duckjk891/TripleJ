"""NoticeSquad(v194) — 4001 어드민 공지 관리 API (전체발송 DM 이력 · 읽음 통계).

prefix `/api/admin/notices`. 전 엔드포인트 admin-role 필수(get_admin_user).

- GET /               공지 목록 (audience 필터, created_at DESC 페이지네이션)
- GET /{notice_id}    공지 상세 (본문 전문 + official_id)

**발송/재발송 엔드포인트는 여기에 없다.** 공지 발송은 기존
`POST /api/admin/cs/broadcast` 단일 경로를 그대로 쓴다 — 발송 경로 단일화가
v194 의 핵심(이력 누락 가능성을 구조적으로 제거). 재발송은 상세에서 본문을
읽어와 기존 발송 API 를 호출하는 방식으로 성립한다.

집계·직렬화·읽음률 계산은 전부 `services/notice_service.py` 책임(서버 계산 —
프론트 계산 금지). 시각 필드는 예외 없이 `notice_service._iso` 를 통과해
UTC(+00:00) 표기로 내려간다(프론트 로컬 오해석 9시간 밀림 방지).

로그 prefix [admin-notices] — notice_id/admin_id 앞 8자만, 공지 본문 원문
미로그(길이만). 개인정보(생년월일·성별·이메일)는 응답·로그 어디에도 없다.
"""

import logging

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services import dm_service, notice_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/notices", tags=["admin-notices"])

MAX_LIST_LIMIT = notice_service.MAX_LIST_LIMIT
DEFAULT_LIST_LIMIT = notice_service.DEFAULT_LIST_LIMIT


# ---------------------------------------------------------------------------
# 1. GET / — 공지 목록
# ---------------------------------------------------------------------------
@router.get("")
async def list_notices(
    page: int = 1,
    limit: int = DEFAULT_LIST_LIMIT,
    audience: str = "",
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공지 목록 — audience 화이트리스트 필터(400) + created_at DESC 페이지네이션.

    행: {id, text_preview, text_len, audience, status, stale, targets, sent,
         failed, delivered, read_count, read_rate, admin_id, admin_nickname,
         admin_code, created_at, finished_at}
    """
    admin_id = str(current_user["id"])
    admin_tag = admin_id[:8]
    try:
        page = max(1, int(page))
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_LIST_LIMIT
    audience = (audience or "").strip()
    logger.info(
        "[admin-notices] list admin=%s page=%d limit=%d audience=%s",
        admin_tag, page, limit, audience or "-",
    )
    try:
        if audience and audience not in dm_service.BROADCAST_AUDIENCES:
            return JSONResponse(status_code=400, content={"error": "발송 대상이 올바르지 않습니다."})

        result = await notice_service.list_notices(
            conn,
            get_mongo(),
            page=page,
            limit=limit,
            audience=audience or None,
            admin_id=admin_id,
        )
        logger.info(
            "[admin-notices] list done admin=%s total=%d returned=%d",
            admin_tag,
            int(result.get("pagination", {}).get("total", 0)),
            len(result.get("notices") or []),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-notices] list failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "공지 목록을 불러올 수 없습니다."})


# ---------------------------------------------------------------------------
# 2. GET /{notice_id} — 공지 상세 (본문 전문)
# ---------------------------------------------------------------------------
@router.get("/{notice_id}")
async def get_notice(
    notice_id: str,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공지 상세 — 목록 행 + text(전문) + official_id. 잘못된 id 400 / 미존재 404."""
    admin_id = str(current_user["id"])
    admin_tag = admin_id[:8]
    notice_tag = str(notice_id)[:8] if notice_id else "-"
    logger.info("[admin-notices] detail admin=%s notice=%s", admin_tag, notice_tag)
    try:
        if not ObjectId.is_valid(notice_id):
            return JSONResponse(status_code=400, content={"error": "잘못된 공지 ID 입니다."})

        notice = await notice_service.get_notice(
            conn, get_mongo(), notice_id, admin_id=admin_id
        )
        if not notice:
            logger.info(
                "[admin-notices] detail not found admin=%s notice=%s", admin_tag, notice_tag
            )
            return JSONResponse(status_code=404, content={"error": "공지를 찾을 수 없습니다."})
        return {"notice": notice}
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-notices] detail failed admin=%s notice=%s", admin_tag, notice_tag
        )
        return JSONResponse(status_code=500, content={"error": "공지를 불러올 수 없습니다."})
