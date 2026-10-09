"""[FCM] 앱(APK) 푸시 — Expo 푸시 서비스(exp.host) 경유.

FCM V1 서비스 계정 키는 EAS(expo.dev 프로젝트 자격 증명)에만 있고 서버에는 비밀값이 없다.
- 토큰: expo_push_tokens {token(unique), user_id, platform, created_at, updated_at}
  같은 기기에서 계정을 바꾸면 token 문서의 user_id 가 새 사용자로 옮겨간다(upsert by token).
- 발송: POST https://exp.host/--/api/v2/push/send (요청당 최대 100건).
  티켓 오류 DeviceNotRegistered → 토큰 삭제(앱 삭제·알림 끔).
- 실패는 로그만 — 호출부(알림 저장·웹 푸시)에 영향 없음(never raises).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

import httpx

from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TOKENS = "expo_push_tokens"
MAX_TOKENS_PER_USER = 5
ANDROID_CHANNEL_ID = "default"
_TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,120}\]$")

_indexes_ready = False


def valid_token(token: Optional[str]) -> bool:
    return bool(_TOKEN_RE.match((token or "").strip()))


def _mask(token: str) -> str:
    """로그용 — 토큰 원문 대신 끝 6자만."""
    return "…" + token.rstrip("]")[-6:]


async def _ensure_indexes(mongo) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await mongo[TOKENS].create_index("token", unique=True)
    await mongo[TOKENS].create_index("user_id")
    _indexes_ready = True


async def save_token(user_id: str, token: str, platform: str = "android") -> None:
    mongo = get_mongo()
    await _ensure_indexes(mongo)
    now = datetime.now(timezone.utc)
    await mongo[TOKENS].update_one(
        {"token": token},
        {"$set": {"user_id": str(user_id), "platform": (platform or "")[:16], "updated_at": now},
         "$setOnInsert": {"token": token, "created_at": now}},
        upsert=True,
    )
    # 사용자당 최근 MAX_TOKENS_PER_USER 개만 유지
    olds = await mongo[TOKENS].find({"user_id": str(user_id)}, {"_id": 1}).sort("updated_at", -1).skip(MAX_TOKENS_PER_USER).to_list(length=100)
    if olds:
        await mongo[TOKENS].delete_many({"_id": {"$in": [o["_id"] for o in olds]}})


async def delete_token(user_id: str, token: Optional[str] = None) -> int:
    mongo = get_mongo()
    q = {"user_id": str(user_id)}
    if token:
        q["token"] = token
    r = await mongo[TOKENS].delete_many(q)
    return int(getattr(r, "deleted_count", 0) or 0)


def build_message(token: str, payload: dict) -> dict:
    return {
        "to": token,
        "title": payload.get("title") or "MAIDOL",
        "body": payload.get("body") or "",
        "data": {"url": payload.get("url") or "/app", "tag": payload.get("tag") or ""},
        "sound": "default",
        "priority": "high",
        "channelId": ANDROID_CHANNEL_ID,
    }


async def send_to_user(user_id: str, payload: dict, *, client: Optional[httpx.AsyncClient] = None) -> dict:
    """사용자의 모든 앱 토큰에 발송. never raises. 반환 {'ok','gone','fail'} 개수."""
    res = {"ok": 0, "gone": 0, "fail": 0}
    try:
        mongo = get_mongo()
        docs = await mongo[TOKENS].find({"user_id": str(user_id)}).to_list(length=MAX_TOKENS_PER_USER)
        if not docs:
            return res
        tokens = [d["token"] for d in docs]
        messages = [build_message(t, payload) for t in tokens]
        own = client is None
        c = client or httpx.AsyncClient(timeout=10)
        try:
            resp = await c.post(EXPO_PUSH_URL, json=messages, headers={"Accept": "application/json"})
        finally:
            if own:
                await c.aclose()
        if resp.status_code != 200:
            res["fail"] = len(tokens)
            logger.warning("[ExpoPush] send status=%d body=%s", resp.status_code, resp.text[:200])
            return res
        tickets = (resp.json() or {}).get("data") or []
        gone = []
        for i, t in enumerate(tokens):
            tk = tickets[i] if i < len(tickets) else {}
            if tk.get("status") == "ok":
                res["ok"] += 1
                continue
            err = ((tk.get("details") or {}).get("error")) or ""
            if err == "DeviceNotRegistered":
                res["gone"] += 1
                gone.append(t)
            else:
                res["fail"] += 1
                logger.warning("[ExpoPush] ticket error=%s msg=%s token=%s", err or "?", str(tk.get("message", ""))[:160], _mask(t))
        if gone:
            await mongo[TOKENS].delete_many({"token": {"$in": gone}})
        logger.info("[ExpoPush] user=%s sent ok=%d gone=%d fail=%d tag=%s", str(user_id)[:8], res["ok"], res["gone"], res["fail"], payload.get("tag"))
    except Exception:
        logger.exception("[ExpoPush] send_to_user failed user=%s", str(user_id)[:8])
    return res
