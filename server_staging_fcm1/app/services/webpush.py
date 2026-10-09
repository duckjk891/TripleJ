"""v3.298 [WebPush] 웹 푸시 — RFC 8291(aes128gcm 암호화) + RFC 8292(VAPID) 직접 구현.

외부 의존성 없이 이미 이미지에 있는 cryptography·httpx 만 사용한다(pywebpush 미설치).
- VAPID 키쌍: Mongo app_secrets._id='webpush_vapid' 에 1회 생성·보관(경쟁 시 먼저 저장된 키 사용).
- 구독: push_subscriptions {user_id, endpoint(unique), p256dh, auth, created_at, last_ok_at}.
- 발송: 404/410 응답 구독은 삭제(만료). 실패는 로그만 — 호출부(알림 저장)에 영향 없음(never raises).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

SUBS = "push_subscriptions"
SECRETS = "app_secrets"
VAPID_DOC_ID = "webpush_vapid"
VAPID_SUB = "https://app.maidol.ai.kr"
PUSH_TTL = 86400
MAX_SUBS_PER_USER = 10

_vapid_cache: Optional[dict] = None
_indexes_ready = False


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64u_dec(s: str) -> bytes:
    s = (s or "").strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt_payload(payload: bytes, p256dh_b64: str, auth_b64: str, *, _as_priv=None, _salt: Optional[bytes] = None) -> bytes:
    """RFC 8291 aes128gcm 단일 레코드 본문(헤더 포함)."""
    ua_pub = b64u_dec(p256dh_b64)
    auth = b64u_dec(auth_b64)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    as_priv = _as_priv or ec.generate_private_key(ec.SECP256R1())
    as_pub = as_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_priv.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth, shared, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    salt = _salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    ct = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    rs = 4096
    return salt + rs.to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + ct


def vapid_auth_header(endpoint: str, priv: ec.EllipticCurvePrivateKey, pub_b64: str, now: Optional[int] = None) -> str:
    u = urlparse(endpoint)
    aud = f"{u.scheme}://{u.netloc}"
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": aud, "exp": int(now or time.time()) + 12 * 3600, "sub": VAPID_SUB}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    der = priv.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={header}.{claims}.{sig}, k={pub_b64}"


async def _ensure_indexes(mongo) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await mongo[SUBS].create_index("endpoint", unique=True)
    await mongo[SUBS].create_index("user_id")
    _indexes_ready = True


async def get_vapid() -> dict:
    """{'priv': EllipticCurvePrivateKey, 'pub_b64': str} — 없으면 생성(최초 1회)."""
    global _vapid_cache
    if _vapid_cache:
        return _vapid_cache
    mongo = get_mongo()
    doc = await mongo[SECRETS].find_one({"_id": VAPID_DOC_ID})
    if not doc:
        priv = ec.generate_private_key(ec.SECP256R1())
        pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        pub = b64u(priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        try:
            await mongo[SECRETS].insert_one({"_id": VAPID_DOC_ID, "private_pem": pem, "public_b64": pub, "created_at": datetime.now(timezone.utc)})
            logger.info("[WebPush] VAPID keypair created")
        except Exception:
            logger.info("[WebPush] VAPID keypair already created by another worker — reuse")
        doc = await mongo[SECRETS].find_one({"_id": VAPID_DOC_ID})
    priv = serialization.load_pem_private_key(doc["private_pem"].encode(), password=None)
    _vapid_cache = {"priv": priv, "pub_b64": doc["public_b64"]}
    return _vapid_cache


async def save_subscription(user_id: str, endpoint: str, p256dh: str, auth: str, ua: str = "") -> None:
    mongo = get_mongo()
    await _ensure_indexes(mongo)
    now = datetime.now(timezone.utc)
    await mongo[SUBS].update_one(
        {"endpoint": endpoint},
        {"$set": {"user_id": str(user_id), "p256dh": p256dh, "auth": auth, "ua": (ua or "")[:200], "updated_at": now},
         "$setOnInsert": {"endpoint": endpoint, "created_at": now}},
        upsert=True,
    )
    # 사용자당 최근 MAX_SUBS_PER_USER 개만 유지
    olds = await mongo[SUBS].find({"user_id": str(user_id)}, {"_id": 1}).sort("updated_at", -1).skip(MAX_SUBS_PER_USER).to_list(length=100)
    if olds:
        await mongo[SUBS].delete_many({"_id": {"$in": [o["_id"] for o in olds]}})


async def delete_subscription(user_id: str, endpoint: Optional[str] = None) -> int:
    mongo = get_mongo()
    q = {"user_id": str(user_id)}
    if endpoint:
        q["endpoint"] = endpoint
    r = await mongo[SUBS].delete_many(q)
    return int(getattr(r, "deleted_count", 0) or 0)


async def _send_one(client: httpx.AsyncClient, sub: dict, body: bytes, vapid: dict) -> str:
    endpoint = sub.get("endpoint") or ""
    try:
        enc = encrypt_payload(body, sub["p256dh"], sub["auth"])
        headers = {
            "Authorization": vapid_auth_header(endpoint, vapid["priv"], vapid["pub_b64"]),
            "TTL": str(PUSH_TTL),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "Urgency": "normal",
        }
        resp = await client.post(endpoint, content=enc, headers=headers)
        if resp.status_code in (200, 201, 202):
            return "ok"
        if resp.status_code in (404, 410):
            return "gone"
        logger.warning("[WebPush] send status=%d host=%s body=%s", resp.status_code, urlparse(endpoint).netloc, resp.text[:160])
        return "fail"
    except Exception:
        logger.exception("[WebPush] send error host=%s", urlparse(endpoint).netloc)
        return "fail"


async def send_to_user(user_id: str, payload: dict) -> dict:
    """사용자의 모든 구독에 발송. never raises. 반환 {'ok','gone','fail'} 개수."""
    res = {"ok": 0, "gone": 0, "fail": 0}
    # [FCM] 앱(APK) 푸시도 같은 문구로 함께 발송 — 웹 구독 유무와 무관, 실패 무영향
    try:
        from . import expo_push as _ep
        await _ep.send_to_user(str(user_id), payload)
    except Exception:
        logger.exception("[ExpoPush] chained send failed user=%s", str(user_id)[:8])
    try:
        mongo = get_mongo()
        subs = await mongo[SUBS].find({"user_id": str(user_id)}).to_list(length=MAX_SUBS_PER_USER)
        if not subs:
            return res
        vapid = await get_vapid()
        body = json.dumps(payload, ensure_ascii=False).encode()[:3000]
        async with httpx.AsyncClient(timeout=10) as client:
            outs = await asyncio.gather(*[_send_one(client, s, body, vapid) for s in subs])
        gone = []
        for s, o in zip(subs, outs):
            res[o] += 1
            if o == "gone":
                gone.append(s["_id"])
        if gone:
            await mongo[SUBS].delete_many({"_id": {"$in": gone}})
        logger.info("[WebPush] user=%s sent ok=%d gone=%d fail=%d tag=%s", str(user_id)[:8], res["ok"], res["gone"], res["fail"], payload.get("tag"))
    except Exception:
        logger.exception("[WebPush] send_to_user failed user=%s", str(user_id)[:8])
    return res


# 알림 종류 → 푸시 문구(피드 팬아웃·크루 홍보는 푸시 제외 — 스팸 방지)
PUSH_TYPES = {"follow", "comment", "reply", "like", "star"}


def payload_for_notification(ntype: str, actor_nickname: Optional[str], target_type: Optional[str] = None,
                             preview: Optional[str] = None, amount: Optional[int] = None) -> Optional[dict]:
    if ntype not in PUSH_TYPES:
        return None
    nick = actor_nickname or "누군가"
    if ntype == "follow":
        body = f"{nick}님이 나를 팔로우했어요"
    elif ntype == "comment":
        body = f"{nick}님이 내 {'곡' if target_type == 'track' else '글'}에 댓글을 남겼어요"
    elif ntype == "reply":
        body = f"{nick}님이 내 댓글에 답글을 남겼어요"
    elif ntype == "like":
        body = f"{nick}님이 내 글을 좋아해요"
    else:  # star
        body = f"스타 {int(amount or 0)}개를 {'차감했어요' if target_type == 'star_deduct' else '받았어요'}"
    if preview and ntype in ("comment", "reply", "star"):
        body = f"{body}\n{preview[:80]}"
    return {"title": "MAIDOL", "body": body, "url": "/app", "tag": f"maidol-{ntype}"}
