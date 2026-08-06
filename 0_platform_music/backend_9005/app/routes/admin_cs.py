"""OfficialSquad — 4001 어드민 CS 대응 API (maidol_official DM 문의 처리).

prefix `/api/admin/cs`. 전 엔드포인트 admin-role 필수(get_admin_user). 내부적으로
me_id = get_official_id() 로 기존 dm_service 함수를 그대로 재사용해 공식 계정
관점의 대화 목록/메시지 조회/답장/읽음/미읽음합을 제공한다.

각 대화 엔드포인트는 대상 대화가 실제 공식 계정 참여 대화인지 검증(권한)한다.
공식 미시드 시 503. 로그 prefix [admin-cs] — cid/admin id 앞 8자만, 본문 미로그.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services import dm_service
from ..services.dm_service import _get_conv, _short
from ..services.official import get_official_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/cs", tags=["admin-cs"])

MAX_PAGE_LIMIT = 100


class ReplyBody(BaseModel):
    text: str


async def _resolve_official(conn) -> str:
    """공식 계정 id 해석 — 미시드면 503."""
    official_id = await get_official_id(conn)
    if not official_id:
        raise HTTPException(status_code=503, detail="공식 계정을 사용할 수 없습니다.")
    return official_id


async def _assert_official_conversation(mongo, cid, official_id, admin_tag) -> dict:
    """대상 대화가 실제 공식 계정 참여 대화인지 검증(권한). 아니면 404/403."""
    conv = await _get_conv(mongo, cid)
    if not conv:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    if official_id not in (conv.get("participants") or []):
        logger.warning(
            "[admin-cs] cid=%s admin=%s non-official conversation", _short(cid), admin_tag
        )
        raise HTTPException(status_code=403, detail="공식 계정 대화가 아닙니다.")
    return conv


@router.get("/conversations")
async def list_cs_conversations(
    page: int = 1,
    limit: int = 20,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공식 계정의 CS 문의 대화 목록 (list_conversations 결과를 페이지네이션)."""
    admin_tag = str(current_user["id"])[:8]
    try:
        page = max(1, int(page))
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_PAGE_LIMIT))
    except (ValueError, TypeError):
        limit = 20
    logger.info("[admin-cs] list conversations admin=%s page=%d limit=%d", admin_tag, page, limit)
    try:
        official_id = await _resolve_official(conn)
        items = await dm_service.list_conversations(conn, get_mongo(), official_id)
        total = len(items)
        start = (page - 1) * limit
        page_items = items[start:start + limit]
        pages = (total + limit - 1) // limit if limit else 0
        logger.info(
            "[admin-cs] list conversations done admin=%s total=%d returned=%d",
            admin_tag, total, len(page_items),
        )
        return {
            "conversations": page_items,
            "pagination": {"page": page, "limit": limit, "total": total, "pages": pages},
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] list conversations failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "대화 목록을 불러올 수 없습니다."})


@router.get("/conversations/{cid}/messages")
async def get_cs_messages(
    cid: str,
    before: str = None,
    limit: int = dm_service.DEFAULT_MESSAGE_LIMIT,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공식 계정 대화의 메시지 조회 (me=official, 참여 검증 후)."""
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-cs] cid=%s admin=%s get messages", _short(cid), admin_tag)
    try:
        official_id = await _resolve_official(conn)
        mongo = get_mongo()
        await _assert_official_conversation(mongo, cid, official_id, admin_tag)
        items = await dm_service.get_messages(mongo, cid, official_id, before=before, limit=limit)
        return {"messages": items}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] get messages failed cid=%s admin=%s", _short(cid), admin_tag)
        return JSONResponse(status_code=500, content={"error": "메시지를 불러올 수 없습니다."})


@router.post("/conversations/{cid}/reply")
async def reply_cs_conversation(
    cid: str,
    body: ReplyBody,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공식 계정 작성자로 답장 전송 (me=official, 참여 검증 후)."""
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-cs] cid=%s admin=%s reply", _short(cid), admin_tag)
    try:
        official_id = await _resolve_official(conn)
        mongo = get_mongo()
        await _assert_official_conversation(mongo, cid, official_id, admin_tag)
        message = await dm_service.send_message(conn, mongo, official_id, cid, body.text)
        logger.info("[admin-cs] cid=%s admin=%s reply sent", _short(cid), admin_tag)
        return {"message": message}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] reply failed cid=%s admin=%s", _short(cid), admin_tag)
        return JSONResponse(status_code=500, content={"error": "답장을 보낼 수 없습니다."})


@router.post("/conversations/{cid}/read")
async def read_cs_conversation(
    cid: str,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """공식 계정측 읽음 처리 (me=official, 참여 검증 후)."""
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-cs] cid=%s admin=%s read", _short(cid), admin_tag)
    try:
        official_id = await _resolve_official(conn)
        mongo = get_mongo()
        await _assert_official_conversation(mongo, cid, official_id, admin_tag)
        return await dm_service.mark_read(mongo, cid, official_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] read failed cid=%s admin=%s", _short(cid), admin_tag)
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.get("/unread-count")
async def cs_unread_count(current_user=Depends(get_admin_user), conn=Depends(get_pg)):
    """공식 계정의 총 미읽음 합 (CS 대응 대기 배지용)."""
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-cs] unread-count admin=%s", admin_tag)
    try:
        official_id = await _resolve_official(conn)
        count = await dm_service.unread_total(get_mongo(), official_id)
        return {"count": count}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] unread-count failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})
