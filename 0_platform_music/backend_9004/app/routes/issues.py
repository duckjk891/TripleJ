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
from typing import Optional

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


class IssueCreate(BaseModel):
    reason: str = ""
    text: str = ""
    page_url: Optional[str] = None
    app_version: Optional[str] = None
    dm_conversation_id: Optional[str] = None


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

        doc = {
            "user_id": user_id,
            "reason": reason,
            "text": text,
            "page_url": (body.page_url or "")[:MAX_PAGE_URL_LEN] or None,
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
            "[issues] create done user=%s issue=%s reason=%s", user_tag, issue_id, reason
        )
        return {"id": issue_id}
    except Exception:
        logger.exception("[issues] create failed user=%s", user_tag)
        return JSONResponse(status_code=500, content={"error": "신고를 접수할 수 없습니다."})
