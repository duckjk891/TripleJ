"""IssueDesk(v185) — 기능오류 신고 접수 API (사용자용).

prefix `/api/issues`. 일반 JWT(get_current_user) — 접수 전용 최소 표면.
저장소: Mongo `issue_reports` (reports 테이블 상태 모델 차용 —
status received|in_progress|resolved|dismissed, handled_by/handled_at).

dm_conversation_id 는 선택 — DM 대화 생성 실패 시에도 접수가 성공하는 것이
1차 가치(실패 격리). user_agent 는 서버가 요청 헤더에서 캡처.

로그 prefix [issues] — user id 앞 8자·길이·issue id 만.
신고 본문·page_url 쿼리 원문은 서버 로그 금지.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/issues", tags=["issues"])

# 사유 코드 5종 — 한글 라벨은 프론트 맵 소관
ISSUE_REASONS = {"playback", "payment", "account", "auth", "other"}
MAX_ISSUE_TEXT_LEN = 2000
MAX_PAGE_URL_LEN = 500
MAX_APP_VERSION_LEN = 40
MAX_UA_LEN = 400

# v188 직전 동선(A) — 클라이언트가 보낸 값은 신뢰하지 않고 서버가 재검증한다.
MAX_RECENT_PAGES = 5
MAX_RECENT_PATH_LEN = 200
MAX_RECENT_AT_LEN = 40


class IssueCreate(BaseModel):
    reason: str = ""
    text: str = ""
    page_url: Optional[str] = None
    app_version: Optional[str] = None
    dm_conversation_id: Optional[str] = None
    # 직전 동선 — [{path, at}] 최대 5개(최신순). 타입 자유 수용 후 서버 재검증.
    recent_pages: Optional[Any] = None


def _sanitize_recent_pages(raw) -> list:
    """recent_pages 재검증 — [{path(≤200), at(str)}] 최대 5개.

    비정상 입력(문자열·숫자·null·항목 타입 불일치·path 부재)은 **조용히 무시**
    하고 접수는 성공시킨다(v185 DM 실패 격리 원칙 승계). 개수 초과는 앞에서부터
    5개만(최신순 전제), path·at 은 길이 절단. 경로 원문은 로그 금지.
    """
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if len(out) >= MAX_RECENT_PAGES:
            break
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        if not isinstance(path, str):
            continue
        path = path.strip()[:MAX_RECENT_PATH_LEN]
        if not path:
            continue
        at = item.get("at")
        at = at.strip()[:MAX_RECENT_AT_LEN] if isinstance(at, str) else None
        out.append({"path": path, "at": at})
    return out


@router.post("", status_code=201)
async def create_issue(
    body: IssueCreate,
    request: Request,
    current_user=Depends(get_current_user),
):
    """오류 신고 접수 — 201 {id}. reason 화이트리스트·text 1~2000 검증 400."""
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")
    user_tag = user_id[:8]
    reason = (body.reason or "").strip()
    text = (body.text or "").strip()

    logger.info(
        "[issues] create enter user=%s reason=%s text_len=%d has_cid=%s",
        user_tag, reason, len(text), bool(body.dm_conversation_id),
    )
    try:
        if reason not in ISSUE_REASONS:
            return JSONResponse(
                status_code=400, content={"error": "신고 사유가 올바르지 않습니다."}
            )
        if not text or len(text) > MAX_ISSUE_TEXT_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"내용은 1~{MAX_ISSUE_TEXT_LEN}자로 입력해주세요."},
            )

        # dm_conversation_id — 형식 무효면 null 로 저장(접수 실패 아님 — 실패 격리)
        cid = (body.dm_conversation_id or "").strip() or None
        if cid and not ObjectId.is_valid(cid):
            logger.info("[issues] invalid cid dropped user=%s", user_tag)
            cid = None

        recent_pages = _sanitize_recent_pages(body.recent_pages)

        doc = {
            "user_id": user_id,
            "reason": reason,
            "text": text,
            "page_url": (body.page_url or "")[:MAX_PAGE_URL_LEN] or None,
            "recent_pages": recent_pages,
            "user_agent": (request.headers.get("user-agent") or "")[:MAX_UA_LEN] or None,
            "app_version": (body.app_version or "")[:MAX_APP_VERSION_LEN] or None,
            "status": "received",
            "admin_note": None,
            "handled_by": None,
            "handled_at": None,
            "dm_conversation_id": cid,
            "created_at": datetime.now(timezone.utc),
        }
        result = await get_mongo().issue_reports.insert_one(doc)
        issue_id = str(result.inserted_id)
        logger.info(
            "[issues] create done user=%s issue=%s reason=%s recent_pages=%d",
            user_tag, issue_id, reason, len(recent_pages),
        )
        return {"id": issue_id}
    except Exception:
        logger.exception("[issues] create failed user=%s", user_tag)
        return JSONResponse(status_code=500, content={"error": "신고를 접수할 수 없습니다."})
