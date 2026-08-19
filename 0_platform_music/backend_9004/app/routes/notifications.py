"""v192 — 인앱 알림 (팔로우/댓글/답글/좋아요/피드 업로드).

Mongo `notifications` 컬렉션:
  { user_id(수신자), type: follow|comment|reply|like|feed,
    actor_id, actor_nickname, target_id(피드 id 등), preview(본문 미리보기),
    read: bool, created_at }
발행은 각 라우터(follows/feeds)가 push_notification/push_notifications_bulk 헬퍼 호출.
발행 실패는 본 동작에 영향 주지 않는다(로깅만).
"""
import logging
import math
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications")

VALID_TYPES = {"follow", "comment", "reply", "like", "feed"}


def _short(v) -> str:
    s = str(v)
    return s[:8]


async def push_notification(mongo, *, user_id, ntype, actor_id, actor_nickname, target_id=None, preview=None):
    """단건 알림 발행 — 자기 자신에게는 보내지 않는다. 실패해도 예외를 올리지 않음."""
    try:
        if not user_id or str(user_id) == str(actor_id):
            return
        if ntype not in VALID_TYPES:
            logger.warning("[notify] invalid type=%s", ntype)
            return
        await mongo.notifications.insert_one({
            "user_id": str(user_id),
            "type": ntype,
            "actor_id": str(actor_id),
            "actor_nickname": actor_nickname,
            "target_id": str(target_id) if target_id else None,
            "preview": (preview or "")[:120] or None,
            "read": False,
            "created_at": datetime.utcnow(),
        })
        logger.info("[notify] push ok type=%s to=%s actor=%s", ntype, _short(user_id), _short(actor_id))
    except Exception:
        logger.exception("[notify] push failed type=%s to=%s", ntype, _short(user_id))


async def push_notifications_bulk(mongo, *, user_ids, ntype, actor_id, actor_nickname, target_id=None, preview=None):
    """다건 팬아웃(피드 업로드 → 팔로워 전원). 자기 자신 제외."""
    try:
        now = datetime.utcnow()
        docs = [{
            "user_id": str(uid),
            "type": ntype,
            "actor_id": str(actor_id),
            "actor_nickname": actor_nickname,
            "target_id": str(target_id) if target_id else None,
            "preview": (preview or "")[:120] or None,
            "read": False,
            "created_at": now,
        } for uid in user_ids if str(uid) != str(actor_id)]
        if docs:
            await mongo.notifications.insert_many(docs)
        logger.info("[notify] bulk ok type=%s fanout=%d actor=%s", ntype, len(docs), _short(actor_id))
    except Exception:
        logger.exception("[notify] bulk failed type=%s actor=%s", ntype, _short(actor_id))


def _serialize(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


@router.get("/")
async def list_notifications(page: int = 1, limit: int = 30, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    user_id = str(current_user["id"])
    page = max(1, page)
    limit = max(1, min(limit, 100))
    logger.info("[notify] list enter user=%s page=%d", _short(user_id), page)
    query = {"user_id": user_id}
    total = await mongo.notifications.count_documents(query)
    unread = await mongo.notifications.count_documents({"user_id": user_id, "read": False})
    docs = (
        await mongo.notifications.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    return {
        "notifications": [_serialize(d) for d in docs],
        "unread": unread,
        "pagination": {"page": page, "limit": limit, "total": total,
                       "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.get("/unread-count")
async def unread_count(current_user=Depends(get_current_user)):
    mongo = get_mongo()
    count = await mongo.notifications.count_documents({"user_id": str(current_user["id"]), "read": False})
    return {"count": count}


@router.post("/read-all")
async def read_all(current_user=Depends(get_current_user)):
    mongo = get_mongo()
    user_id = str(current_user["id"])
    result = await mongo.notifications.update_many(
        {"user_id": user_id, "read": False}, {"$set": {"read": True}}
    )
    logger.info("[notify] read_all user=%s marked=%d", _short(user_id), result.modified_count)
    return {"marked": result.modified_count}
