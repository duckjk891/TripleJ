"""어드민 피드 — MAIDOL 공식 계정 명의로 글 작성·댓글 답글·삭제.

사용자용 feeds.py / upload.py 핸들러를 공식 계정 세션으로 **그대로 호출**한다
(검증·팔로워 알림 팬아웃·댓글/답글 알림·이미지 재인코딩을 중복 구현하지 않기 위함).
공식 계정 = services.official.get_official_id (미시드면 503).

- GET    /api/admin/feeds                       피드 목록 (scope=official|all)
- GET    /api/admin/feeds/pending-comments      공식 계정 글에 달린, 아직 공식 답글이 없는 댓글
- POST   /api/admin/feeds                       공식 계정으로 글 작성 (text + 이미지 선택, multipart)
- DELETE /api/admin/feeds/{feed_id}             공식 계정 글 삭제
- GET    /api/admin/feeds/{feed_id}/comments    댓글 전체 (최대 500)
- POST   /api/admin/feeds/{feed_id}/comments    공식 계정으로 댓글/답글
- DELETE /api/admin/feeds/comments/{comment_id} 공식 계정 댓글 삭제
"""
import logging
import math
from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services.official import get_official_id
from . import feeds as feeds_routes
from . import upload as upload_routes
from .admin import _log_admin_action

router = APIRouter(prefix="/api/admin/feeds", tags=["admin-feeds"])

logger = logging.getLogger(__name__)

MAX_IMAGES = 10


class AdminCommentBody(BaseModel):
    text: str
    parent_id: Optional[str] = None


async def _official_session(conn) -> Optional[dict]:
    """공식 계정을 사용자 핸들러에 넘길 세션 dict 로 (get_current_user 반환 형태와 동일 키)."""
    oid = await get_official_id(conn)
    if not oid:
        return None
    row = await conn.fetchrow(
        "SELECT id::text AS id, email, nickname, profile_image, role FROM users WHERE id::text = $1", oid
    )
    if not row:
        return None
    return {
        "id": row["id"], "email": row["email"], "nickname": row["nickname"],
        "profile_image": row["profile_image"], "role": row["role"] or "user",
    }


def _no_official():
    return JSONResponse(status_code=503, content={"error": "공식 계정이 설정되어 있지 않습니다."})


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _excerpt(doc: dict, n: int = 120) -> str:
    for b in doc.get("blocks") or []:
        if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
            return str(b["text"])[:n]
    return ""


@router.get("")
async def list_feeds(
    scope: str = "official",
    page: int = 1,
    limit: int = 20,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    page = max(1, page)
    limit = max(1, min(limit, 50))
    official = await _official_session(conn)
    if not official:
        return _no_official()
    mongo = get_mongo()
    query = {"author_id": official["id"]} if scope == "official" else {}
    total = await mongo.feeds.count_documents(query)
    docs = await mongo.feeds.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(length=limit)
    items = []
    for d in docs:
        images = [b.get("object_name") for b in d.get("blocks") or [] if isinstance(b, dict) and b.get("type") == "image"]
        items.append({
            "id": str(d["_id"]),
            "author_id": d.get("author_id"),
            "author_nickname": d.get("author_nickname"),
            "is_official": d.get("author_id") == official["id"],
            "kind": d.get("kind") or "feed",
            "title": d.get("title"),
            "excerpt": _excerpt(d, 200),
            "image_count": len(images),
            "first_image": images[0] if images else None,
            "like_count": int(d.get("like_count") or 0),
            "comment_count": int(d.get("comment_count") or 0),
            "is_public": bool(d.get("is_public", True)),
            "report_blinded": bool(d.get("report_blinded", False)),
            "created_at": _iso(d.get("created_at")),
        })
    return {
        "feeds": items,
        "official": {"id": official["id"], "nickname": official["nickname"]},
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.get("/pending-comments")
async def pending_comments(limit: int = 50, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    """공식 계정 글의 최상위 댓글 중 공식 계정 답글이 아직 없는 것 (최근순)."""
    official = await _official_session(conn)
    if not official:
        return _no_official()
    mongo = get_mongo()
    oid = official["id"]
    feed_docs = await mongo.feeds.find({"author_id": oid}, {"title": 1, "blocks": 1}).to_list(length=None)
    feed_map = {str(f["_id"]): f for f in feed_docs}
    if not feed_map:
        return {"comments": []}
    comments = await mongo.feed_comments.find(
        {"feed_id": {"$in": list(feed_map)}}
    ).sort("created_at", -1).to_list(length=None)
    answered = {c.get("parent_id") for c in comments if c.get("author_id") == oid and c.get("parent_id")}
    out = []
    for c in comments:
        cid = str(c["_id"])
        if c.get("parent_id") or c.get("author_id") == oid or cid in answered:
            continue
        f = feed_map.get(c.get("feed_id")) or {}
        out.append({
            "id": cid,
            "feed_id": c.get("feed_id"),
            "feed_title": f.get("title") or _excerpt(f, 40),
            "author_nickname": c.get("author_nickname"),
            "text": c.get("text"),
            "created_at": _iso(c.get("created_at")),
        })
        if len(out) >= limit:
            break
    return {"comments": out}


@router.post("", status_code=201)
async def create_official_feed(
    text: str = Form(""),
    title: str = Form(""),
    images: Optional[List[UploadFile]] = File(None),
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    official = await _official_session(conn)
    if not official:
        return _no_official()
    files = [f for f in (images or []) if f and f.filename]
    if len(files) > MAX_IMAGES:
        return JSONResponse(status_code=400, content={"error": f"사진은 최대 {MAX_IMAGES}장까지 올릴 수 있습니다."})

    blocks = []
    for f in files:
        res = await upload_routes.upload_feed_image(file=f, current_user=official)
        if isinstance(res, JSONResponse):
            return res
        blocks.append({"type": "image", "object_name": res["object_name"]})
    if text.strip():
        blocks.append({"type": "text", "text": text})

    body = feeds_routes.FeedBody(title=title.strip() or None, blocks=blocks, is_public=True, kind="feed")
    res = await feeds_routes.create_feed(body, current_user=official, conn=conn)
    if isinstance(res, JSONResponse):
        return res
    feed_id = res["feed"]["id"]
    await _log_admin_action(
        conn, current_admin["id"], "official_feed_create", "feed", feed_id,
        {"text_len": len(text), "images": len(files)},
    )
    logger.info("[admin-feeds] create feed=%s admin=%s images=%d", feed_id[:8], str(current_admin["id"])[:8], len(files))
    return res


@router.delete("/comments/{comment_id}")
async def delete_official_comment(comment_id: str, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    official = await _official_session(conn)
    if not official:
        return _no_official()
    res = await feeds_routes.delete_feed_comment(comment_id, current_user=official)
    if not isinstance(res, JSONResponse):
        await _log_admin_action(conn, current_admin["id"], "official_comment_delete", "feed_comment", comment_id, None)
    return res


@router.delete("/{feed_id}")
async def delete_official_feed(feed_id: str, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    official = await _official_session(conn)
    if not official:
        return _no_official()
    res = await feeds_routes.delete_feed(feed_id, current_user=official, conn=conn)
    if not isinstance(res, JSONResponse):
        await _log_admin_action(conn, current_admin["id"], "official_feed_delete", "feed", feed_id, None)
    return res


@router.get("/{feed_id}/comments")
async def feed_comments(feed_id: str, current_admin=Depends(get_admin_user), conn=Depends(get_pg)):
    official = await _official_session(conn)
    if not official:
        return _no_official()
    if not ObjectId.is_valid(feed_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 피드 ID입니다."})
    mongo = get_mongo()
    feed = await mongo.feeds.find_one({"_id": ObjectId(feed_id)})
    if not feed:
        return JSONResponse(status_code=404, content={"error": "피드를 찾을 수 없습니다."})
    docs = await mongo.feed_comments.find({"feed_id": feed_id}).sort("created_at", 1).to_list(length=500)
    comments = [{
        "id": str(c["_id"]),
        "parent_id": c.get("parent_id"),
        "author_id": c.get("author_id"),
        "author_nickname": c.get("author_nickname"),
        "is_official": c.get("author_id") == official["id"],
        "text": c.get("text"),
        "created_at": _iso(c.get("created_at")),
    } for c in docs]
    return {
        "feed": {
            "id": feed_id,
            "author_nickname": feed.get("author_nickname"),
            "is_official": feed.get("author_id") == official["id"],
            "title": feed.get("title"),
            "text": "\n\n".join(b.get("text", "") for b in feed.get("blocks") or [] if isinstance(b, dict) and b.get("type") == "text"),
            "images": [b.get("object_name") for b in feed.get("blocks") or [] if isinstance(b, dict) and b.get("type") == "image"],
            "created_at": _iso(feed.get("created_at")),
        },
        "comments": comments,
    }


@router.post("/{feed_id}/comments", status_code=201)
async def add_official_comment(
    feed_id: str,
    body: AdminCommentBody,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    official = await _official_session(conn)
    if not official:
        return _no_official()
    res = await feeds_routes.add_feed_comment(
        feed_id, feeds_routes.CommentBody(text=body.text, parent_id=body.parent_id), current_user=official,
    )
    if not isinstance(res, JSONResponse):
        await _log_admin_action(
            conn, current_admin["id"], "official_comment", "feed", feed_id,
            {"parent_id": body.parent_id, "text_len": len(body.text or "")},
        )
    return res
