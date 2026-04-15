"""
AIMU Rewards - Google AdMob Rewarded Ad SSV (Server-Side Verification).

Handles:
  - AdMob SSV callback verification (ECDSA signature check)
  - Reward transaction recording and deduplication
  - Reward balance tracking (skip_wait_count)
"""

import base64
import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDSA,
    EllipticCurvePublicKey,
)
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.serialization import load_der_public_key
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/rewards")

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Google public key cache
# ---------------------------------------------------------------------------

GOOGLE_KEYS_URL = "https://gstatic.com/admob/reward/verifier-keys.json"
CACHE_TTL_SECONDS = 86400  # 24 hours

_key_cache: dict = {}
_cache_fetched_at: float = 0.0


async def _fetch_google_keys() -> dict:
    """Fetch and cache Google AdMob SSV public keys (24-hour cache)."""
    global _key_cache, _cache_fetched_at

    now = time.time()
    if _key_cache and (now - _cache_fetched_at) < CACHE_TTL_SECONDS:
        return _key_cache

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(GOOGLE_KEYS_URL)
        resp.raise_for_status()
        data = resp.json()

    # Build a lookup dict: key_id (int) -> DER public key bytes
    keys: dict[int, bytes] = {}
    for entry in data.get("keys", []):
        kid = entry.get("keyId")
        b64_key = entry.get("base64")
        pem_key = entry.get("pem")
        if kid is not None and b64_key:
            keys[int(kid)] = base64.b64decode(b64_key)
        elif kid is not None and pem_key:
            keys[int(kid)] = base64.b64decode(pem_key)

    _key_cache = keys
    _cache_fetched_at = now
    return _key_cache


# ---------------------------------------------------------------------------
# Signature verification helpers
# ---------------------------------------------------------------------------

def _build_verification_message(query_string: str) -> bytes:
    """Build the message that Google signed.

    Google signs the full query string *without* the &signature=...&key_id=...
    portion.  The query string keeps its original order; we just strip the last
    two params (signature & key_id).
    """
    # The query string ends with &signature=<sig>&key_id=<kid>
    # We need the part before &signature=
    sig_idx = query_string.find("&signature=")
    if sig_idx == -1:
        sig_idx = query_string.find("signature=")
        if sig_idx == 0:
            return b""
    message = query_string[:sig_idx]
    return message.encode("utf-8")


async def _verify_ssv_signature(query_string: str, signature_b64: str, key_id: int) -> bool:
    """Verify the ECDSA-SHA256 signature from Google AdMob SSV callback."""
    try:
        keys = await _fetch_google_keys()
        der_bytes = keys.get(key_id)
        if der_bytes is None:
            logger.warning("Unknown key_id=%d in AdMob SSV callback", key_id)
            return False

        public_key = load_der_public_key(der_bytes)
        if not isinstance(public_key, EllipticCurvePublicKey):
            logger.error("Key %d is not an EC key", key_id)
            return False

        message = _build_verification_message(query_string)
        if not message:
            return False

        signature_bytes = base64.urlsafe_b64decode(
            signature_b64 + "=" * (-len(signature_b64) % 4)
        )

        public_key.verify(
            signature_bytes,
            message,
            ECDSA(SHA256()),
        )
        return True
    except Exception as e:
        logger.error("SSV signature verification failed: %s", e)
        return False


# ---------------------------------------------------------------------------
# MongoDB index bootstrap (called once on first callback)
# ---------------------------------------------------------------------------

_indexes_created = False


async def _ensure_indexes():
    global _indexes_created
    if _indexes_created:
        return
    mongo = get_mongo()
    await mongo.reward_transactions.create_index("transaction_id", unique=True)
    await mongo.reward_transactions.create_index("user_id")
    await mongo.reward_balances.create_index("user_id", unique=True)
    _indexes_created = True


# ---------------------------------------------------------------------------
# 1. AdMob SSV Callback (no auth — verified by signature)
# ---------------------------------------------------------------------------

@router.get("/admob-callback")
async def admob_callback(request: Request):
    """Google AdMob rewarded-ad SSV callback.

    Google sends a GET request with query parameters including signature
    and key_id.  We verify the ECDSA signature, deduplicate by
    transaction_id, then credit the user's reward balance.
    """
    params = request.query_params
    query_string = str(request.query_params)

    # Extract required parameters
    custom_data = params.get("custom_data", "")
    reward_amount = params.get("reward_amount")
    reward_item = params.get("reward_item", "")
    signature = params.get("signature")
    key_id_str = params.get("key_id")
    transaction_id = params.get("transaction_id")
    ad_unit = params.get("ad_unit", "")

    # Basic validation
    if not all([signature, key_id_str, transaction_id]):
        return JSONResponse(status_code=400, content={"error": "Missing required parameters"})

    try:
        key_id = int(key_id_str)
    except (ValueError, TypeError):
        return JSONResponse(status_code=400, content={"error": "Invalid key_id"})

    # 1) Verify signature using the raw query string from the request
    raw_qs = request.url.query
    verified = await _verify_ssv_signature(raw_qs, signature, key_id)
    if not verified:
        logger.warning("Invalid SSV signature for transaction_id=%s", transaction_id)
        return JSONResponse(status_code=403, content={"error": "Invalid signature"})

    # 2) Parse user_id from custom_data
    user_id = custom_data  # custom_data should contain the user_id directly

    if not user_id:
        logger.warning("Missing user_id in custom_data for transaction_id=%s", transaction_id)
        return JSONResponse(status_code=400, content={"error": "Missing user_id in custom_data"})

    # Parse reward_amount
    try:
        amount = int(reward_amount) if reward_amount else 1
    except (ValueError, TypeError):
        amount = 1

    await _ensure_indexes()

    mongo = get_mongo()
    now = datetime.now(timezone.utc)

    # 3) Deduplication check — if transaction_id already exists, skip
    existing = await mongo.reward_transactions.find_one({"transaction_id": transaction_id})
    if existing:
        # Already processed — return 200 so Google doesn't retry
        return {"status": "already_processed"}

    # 4) Record transaction
    try:
        await mongo.reward_transactions.insert_one({
            "transaction_id": transaction_id,
            "user_id": user_id,
            "ad_unit": ad_unit,
            "reward_amount": amount,
            "reward_item": reward_item,
            "created_at": now,
            "verified": True,
        })
    except Exception as e:
        # Duplicate key — race condition, still OK
        if "duplicate key" in str(e).lower() or "E11000" in str(e):
            return {"status": "already_processed"}
        raise

    # 5) Update reward balance
    await mongo.reward_balances.update_one(
        {"user_id": user_id},
        {
            "$inc": {"skip_wait_count": amount},
            "$set": {"last_updated": now},
            "$setOnInsert": {"user_id": user_id},
        },
        upsert=True,
    )

    logger.info(
        "Reward granted: user=%s amount=%d item=%s tx=%s",
        user_id, amount, reward_item, transaction_id,
    )

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 2. Reward History (auth required)
# ---------------------------------------------------------------------------

@router.get("/history")
async def reward_history(user: dict = Depends(get_current_user)):
    """Return reward transaction history for the authenticated user (max 50, newest first)."""
    user_id = str(user.get("id") or user.get("user_id"))
    if not user_id:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자입니다."})

    mongo = get_mongo()
    cursor = (
        mongo.reward_transactions
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )
    transactions = await cursor.to_list(length=50)

    # Serialize datetime fields
    for tx in transactions:
        if isinstance(tx.get("created_at"), datetime):
            tx["created_at"] = tx["created_at"].isoformat()

    return {"transactions": transactions}


# ---------------------------------------------------------------------------
# 3. Reward Balance (auth required)
# ---------------------------------------------------------------------------

@router.get("/balance")
async def reward_balance(user: dict = Depends(get_current_user)):
    """Return the current skip_wait_count for the authenticated user."""
    user_id = str(user.get("id") or user.get("user_id"))
    if not user_id:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 사용자입니다."})

    mongo = get_mongo()
    doc = await mongo.reward_balances.find_one({"user_id": user_id}, {"_id": 0})

    if not doc:
        return {"user_id": user_id, "skip_wait_count": 0}

    if isinstance(doc.get("last_updated"), datetime):
        doc["last_updated"] = doc["last_updated"].isoformat()

    return doc
