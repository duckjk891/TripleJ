"""v3.298 [WebPush] 웹 푸시 구독 API."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.mongodb import get_mongo
from ..services import webpush

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/push")


class SubKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: SubKeys


class UnsubscribeBody(BaseModel):
    endpoint: Optional[str] = None


@router.get("/vapid-public-key")
async def vapid_public_key():
    try:
        v = await webpush.get_vapid()
        return {"public_key": v["pub_b64"]}
    except Exception:
        logger.exception("[WebPush] vapid key load failed")
        return JSONResponse(status_code=500, content={"error": "푸시 설정을 불러올 수 없습니다."})


@router.post("/subscribe")
async def subscribe(body: SubscribeBody, request: Request, current_user=Depends(get_current_user)):
    uid = str(current_user["id"])
    ep = (body.endpoint or "").strip()
    if not ep.startswith("https://") or len(ep) > 1000:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 구독 정보입니다."})
    try:
        if len(webpush.b64u_dec(body.keys.p256dh)) != 65 or len(webpush.b64u_dec(body.keys.auth)) < 16:
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 구독 키입니다."})
    except Exception:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 구독 키입니다."})
    try:
        await webpush.save_subscription(uid, ep, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent", ""))
        logger.info("[WebPush] subscribe user=%s host=%s", uid[:8], ep.split("/")[2] if ep.count("/") >= 2 else "?")
        return {"subscribed": True}
    except Exception:
        logger.exception("[WebPush] subscribe failed user=%s", uid[:8])
        return JSONResponse(status_code=500, content={"error": "푸시 구독을 저장하지 못했습니다."})


@router.post("/unsubscribe")
async def unsubscribe(body: UnsubscribeBody, current_user=Depends(get_current_user)):
    uid = str(current_user["id"])
    try:
        n = await webpush.delete_subscription(uid, (body.endpoint or "").strip() or None)
        logger.info("[WebPush] unsubscribe user=%s removed=%d", uid[:8], n)
        return {"subscribed": False, "removed": n}
    except Exception:
        logger.exception("[WebPush] unsubscribe failed user=%s", uid[:8])
        return JSONResponse(status_code=500, content={"error": "푸시 해제를 처리하지 못했습니다."})


@router.get("/status")
async def status(endpoint: Optional[str] = None, current_user=Depends(get_current_user)):
    uid = str(current_user["id"])
    q = {"user_id": uid}
    if endpoint:
        q["endpoint"] = endpoint
    n = await get_mongo()[webpush.SUBS].count_documents(q)
    return {"subscribed": n > 0}
