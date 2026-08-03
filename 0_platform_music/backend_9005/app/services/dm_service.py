"""DmSquad(v152) — 실시간 1:1 DM 서비스 계층 (Mongo/게이트/pub-sub 발행).

인스타(메타) 정책 벤치마킹 경량 실시간 DM MVP. 본인인증·관계·미성년·정지·차단
게이트를 대화 시작/전송 공통으로 강제(`assert_can_dm`). 실시간 push 는 REST
전송 핸들러가 Redis `dm:user:{peer}` 채널로 발행 → dm 라우터의 단일 pub/sub
리스너가 로컬 WebSocket 으로 팬아웃(멀티워커 대응).

v155(C안, 인스타 완전체): 전체 사용자 검색 + 메시지 요청함. 비팔로우 상대에게도
전송 가능하되 대화가 pending(요청)으로 생성 — 수신자는 수락 전 답장 불가,
메인 목록 대신 요청함 격리, 수락 → accepted / 거절 → 대화+메시지 hard delete
(발신자 미통지). legacy 문서(status 필드 부재)는 쿼리 레벨에서 accepted 취급.

Collections:
  - dm_conversations: 1:1 대화 헤더(pair_key unique, participants, unread map,
                      v155: status(accepted|pending)/requester_id/accepted_at)
  - dm_messages:      메시지 본문 (conversation_id, sender_id, text, read)
  - dm_blocks:        개별 차단 (blocker_id, blocked_id) — 대화 시작 전에도 가능

게이트/영속화는 REST 단일화. WS 는 서버→클라 push 전용(전송 안 함).
is_verified/is_banned/birth_date 는 매번 fresh Postgres 조회(세션 dict 불신).
로그 prefix [dm] — user_id/conversation_id 앞 8자만, 본문 텍스트 원문 미로그.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from ..database.mongodb import get_mongo  # noqa: F401 (참조 편의)
from ..database.redis import get_redis
from ..models.user import is_under_14
from .referral_service import REFERRAL_CODE_RE, normalize_code

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------
MAX_TEXT_LEN = 2000
LAST_MESSAGE_SUMMARY_LEN = 200
DEFAULT_MESSAGE_LIMIT = 30
MAX_MESSAGE_LIMIT = 100
MAX_CONVERSATIONS = 200

# 관계 게이트: 기본은 "상대가 나를 팔로우" 만 요구. True 로 바꾸면 상호 팔로우 필수.
DM_REQUIRE_MUTUAL = False

# Redis pub/sub 채널 — 사용자별 이벤트 팬아웃
DM_CHANNEL_PREFIX = "dm:user:"
DM_CHANNEL_PATTERN = "dm:user:*"

# 차단/정지/미성년 사실을 상대에게 드러내지 않는 일반 거부 문구
_GENERIC_DENY = "메시지를 보낼 수 없습니다."


_indexes_ready = False


async def ensure_dm_indexes():
    """Lazily create DM indexes once (points_service.ensure_indexes 패턴)."""
    global _indexes_ready
    if _indexes_ready:
        return
    mongo = get_mongo()
    await mongo.dm_conversations.create_index("pair_key", unique=True)
    await mongo.dm_conversations.create_index("participants")
    await mongo.dm_conversations.create_index("last_at")
    await mongo.dm_messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await mongo.dm_messages.create_index("conversation_id")
    await mongo.dm_blocks.create_index(
        [("blocker_id", 1), ("blocked_id", 1)], unique=True
    )
    _indexes_ready = True
    logger.info("[dm] indexes ensured")


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _short(value) -> str:
    return str(value)[:8] if value else "?"


def _pair_key(a, b) -> str:
    x, y = sorted([str(a), str(b)])
    return f"{x}_{y}"


def _participants(a, b) -> List[str]:
    return sorted([str(a), str(b)])


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        # Mongo 는 UTC 를 naive 로 돌려줌 — tz 미표기 시 프론트 new Date() 가
        # 로컬(KST)로 오해석해 9시간 밀림 → UTC 명시 후 직렬화 (v156.1 시간표시 픽스)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


def _user_channel(uid) -> str:
    return f"{DM_CHANNEL_PREFIX}{uid}"


def _serialize_message(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "conversation_id": doc.get("conversation_id"),
        "sender_id": doc.get("sender_id"),
        "text": doc.get("text"),
        "created_at": _iso(doc.get("created_at")),
        "read": bool(doc.get("read")),
    }


async def _get_conv(mongo, conversation_id) -> Optional[dict]:
    try:
        oid = ObjectId(str(conversation_id))
    except (InvalidId, TypeError):
        return None
    return await mongo.dm_conversations.find_one({"_id": oid})


def _peer_of(conv: dict, me_id: str) -> Optional[str]:
    return next((p for p in (conv.get("participants") or []) if p != me_id), None)


# ---------------------------------------------------------------------------
# Postgres 게이트 조회 (매 게이트마다 fresh)
# ---------------------------------------------------------------------------
async def _fetch_gate_row(conn, uid):
    try:
        u = uuid.UUID(str(uid))
    except (ValueError, TypeError):
        return None
    return await conn.fetchrow(
        "SELECT is_verified, is_banned, birth_date FROM users WHERE id = $1", u
    )


async def _peer_follows_me(conn, peer_id, me_id) -> bool:
    """상대(peer)가 나(me)를 팔로우 중인가."""
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2",
            uuid.UUID(str(peer_id)), uuid.UUID(str(me_id)),
        )
    except (ValueError, TypeError):
        return False
    return row is not None


async def _i_follow_peer(conn, me_id, peer_id) -> bool:
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2",
            uuid.UUID(str(me_id)), uuid.UUID(str(peer_id)),
        )
    except (ValueError, TypeError):
        return False
    return row is not None


async def _is_blocked_either(mongo, me_id, peer_id) -> bool:
    doc = await mongo.dm_blocks.find_one(
        {
            "$or": [
                {"blocker_id": str(me_id), "blocked_id": str(peer_id)},
                {"blocker_id": str(peer_id), "blocked_id": str(me_id)},
            ]
        }
    )
    return doc is not None


def _deny(stage, me_id, peer_id, status_code, message):
    """게이트 거부 — 사유 코드만 로그(민감정보 X) 후 HTTPException raise."""
    logger.info(
        "[dm] gate denied stage=%s me=%s peer=%s", stage, _short(me_id), _short(peer_id)
    )
    raise HTTPException(status_code=status_code, detail=message)


async def assert_can_dm(conn, mongo, me_id, peer_id, existing_conv=None):
    """DM 안전 게이트. 실패 시 HTTPException(status_code, detail).

    ① 본인인증(me.is_verified)   ② 상대 존재 & 자기자신 아님
    ③ 둘 다 not is_banned        ④ 미성년 보호(peer 미성년이면 팔로우 필수 — 403 유지)
    ⑤ 관계 판정(v155 C안): deny 하지 않고 pending 판정용으로 계산만 —
       기존 대화가 있으면 skip(None), 없으면 "상대가 나를 팔로우" 여부 bool
    ⑥ 개별 차단(dm_blocks 양방향)
    ④·⑤ 를 위해 birth_date/is_banned/is_verified 는 fresh Postgres 조회.

    Returns: {"peer_follows_me": bool | None} — None 은 기존 대화 존재로 관계
    재검사 skip(기존 의미 유지). 호출부(get_or_create_conversation)가 이 값으로
    신규 대화 status(accepted|pending)를 결정.
    """
    me_id = str(me_id)
    peer_id = str(peer_id)

    # ① 본인인증 (me)
    me_row = await _fetch_gate_row(conn, me_id)
    if not me_row or not me_row["is_verified"]:
        _deny("verified", me_id, peer_id, 403, "본인인증 후 이용 가능합니다.")

    # ② 상대 존재 & 자기자신 아님
    if me_id == peer_id:
        _deny("self", me_id, peer_id, 400, "자기 자신에게는 메시지를 보낼 수 없습니다.")
    peer_row = await _fetch_gate_row(conn, peer_id)
    if not peer_row:
        _deny("peer_missing", me_id, peer_id, 404, "사용자를 찾을 수 없습니다.")

    # ③ 정지 계정 (사실 비노출 — 일반 문구)
    if me_row["is_banned"] or peer_row["is_banned"]:
        _deny("banned", me_id, peer_id, 403, _GENERIC_DENY)

    # ④ 미성년 보호 — 수신자 미성년이면 팔로우 관계 필수 (사실 비노출)
    if is_under_14(peer_row["birth_date"]) and not await _peer_follows_me(
        conn, peer_id, me_id
    ):
        _deny("minor", me_id, peer_id, 403, _GENERIC_DENY)

    # ⑤ 관계 판정(v155) — deny 없음. 기존 대화 있으면 skip(None — 상대 언팔해도
    #    기존 대화 유지), 없으면 pending 판정용 bool 계산만.
    relationship = None
    if existing_conv is None:
        ok = await _peer_follows_me(conn, peer_id, me_id)
        if DM_REQUIRE_MUTUAL:
            ok = ok and await _i_follow_peer(conn, me_id, peer_id)
        relationship = ok
        logger.info(
            "[dm] gate relationship me=%s peer=%s peer_follows_me=%s",
            _short(me_id), _short(peer_id), ok,
        )

    # ⑥ 개별 차단 (양방향, 사실 비노출)
    if await _is_blocked_either(mongo, me_id, peer_id):
        _deny("blocked", me_id, peer_id, 403, _GENERIC_DENY)

    return {"peer_follows_me": relationship}


# ---------------------------------------------------------------------------
# 유저 하이드레이션 (닉/프사)
# ---------------------------------------------------------------------------
async def hydrate_users(conn, ids) -> dict:
    """user_id 리스트 → {id: {id, nickname, profile_image, code}} (닉/프사/태그 일괄 조회).

    code = users.referral_code (v156 배틀태그 — 4자리, 비밀 아님).
    """
    uniq, seen = [], set()
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            uniq.append(i)
    if not uniq:
        return {}
    uuids = []
    for i in uniq:
        try:
            uuids.append(uuid.UUID(str(i)))
        except (ValueError, TypeError):
            continue
    if not uuids:
        return {}
    rows = await conn.fetch(
        "SELECT id, nickname, profile_image, referral_code FROM users WHERE id = ANY($1::uuid[])",
        uuids,
    )
    return {
        str(r["id"]): {
            "id": str(r["id"]),
            "nickname": r["nickname"],
            "profile_image": r["profile_image"],
            "code": r["referral_code"],
        }
        for r in rows
    }


async def _serialize_conversation(conn, conv: dict, me_id: str) -> dict:
    me_id = str(me_id)
    peer_id = _peer_of(conv, me_id)
    users = await hydrate_users(conn, [peer_id]) if peer_id else {}
    peer = users.get(peer_id) or {
        "id": peer_id, "nickname": None, "profile_image": None, "code": None
    }
    unread = conv.get("unread") or {}
    return {
        "conversation_id": str(conv["_id"]),
        "peer": peer,
        "last_message_text": conv.get("last_message_text"),
        "last_sender_id": conv.get("last_sender_id"),
        "last_at": _iso(conv.get("last_at")),
        "unread": int(unread.get(me_id, 0) or 0),
        # v155: legacy 문서(status 필드 부재)는 accepted 로 정규화
        "status": conv.get("status") or "accepted",
        "requester_id": conv.get("requester_id"),
    }


# ---------------------------------------------------------------------------
# Redis pub/sub 발행
# ---------------------------------------------------------------------------
async def publish_to_user(uid, event: dict):
    """사용자 채널로 이벤트 발행. 실패는 흡수(실시간 끊겨도 REST 폴백)."""
    try:
        redis = get_redis()
        if redis is None:
            return
        await redis.publish(_user_channel(str(uid)), json.dumps(event))
    except Exception:
        logger.exception("[dm] publish failed uid=%s", _short(uid))


# ---------------------------------------------------------------------------
# 대화 / 메시지
# ---------------------------------------------------------------------------
async def get_or_create_conversation(conn, mongo, me_id, peer_id) -> dict:
    """게이트 통과 시 기존 대화 반환 or 신규 생성. pair_key unique 로 중복 방지."""
    await ensure_dm_indexes()
    me_id, peer_id = str(me_id), str(peer_id)
    pair = _pair_key(me_id, peer_id)
    existing = await mongo.dm_conversations.find_one({"pair_key": pair})
    gate = await assert_can_dm(conn, mongo, me_id, peer_id, existing_conv=existing)
    if existing:
        logger.info(
            "[dm] conversation reuse conv=%s me=%s peer=%s",
            _short(existing["_id"]), _short(me_id), _short(peer_id),
        )
        return await _serialize_conversation(conn, existing, me_id)

    now = _now()
    parts = _participants(me_id, peer_id)
    # v155: 상대가 나를 팔로우 → 즉시 accepted, 아니면 pending(메시지 요청)
    status = "accepted" if gate.get("peer_follows_me") else "pending"
    doc = {
        "participants": parts,
        "pair_key": pair,
        "last_message_text": None,
        "last_sender_id": None,
        "last_at": now,
        "unread": {parts[0]: 0, parts[1]: 0},
        "status": status,
        "requester_id": me_id,
        "accepted_at": now if status == "accepted" else None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        res = await mongo.dm_conversations.insert_one(doc)
        doc["_id"] = res.inserted_id
        logger.info(
            "[dm] conversation created conv=%s me=%s peer=%s status=%s",
            _short(doc["_id"]), _short(me_id), _short(peer_id), status,
        )
    except DuplicateKeyError:
        # 동시 생성 경쟁 — 재조회로 흡수
        doc = await mongo.dm_conversations.find_one({"pair_key": pair})
        logger.info(
            "[dm] conversation race resolved conv=%s me=%s peer=%s",
            _short(doc["_id"]) if doc else "?", _short(me_id), _short(peer_id),
        )
    return await _serialize_conversation(conn, doc, me_id)


async def _hydrate_conversation_list(conn, convs, me_id) -> List[dict]:
    """대화 doc 리스트 → peer 닉/프사 일괄 하이드레이션 + serialize (v155 공용)."""
    peer_ids = [p for c in convs for p in (c.get("participants") or []) if p != me_id]
    users = await hydrate_users(conn, peer_ids)
    out = []
    for c in convs:
        peer_id = _peer_of(c, me_id)
        peer = users.get(peer_id) or {
            "id": peer_id, "nickname": None, "profile_image": None, "code": None
        }
        unread = c.get("unread") or {}
        out.append(
            {
                "conversation_id": str(c["_id"]),
                "peer": peer,
                "last_message_text": c.get("last_message_text"),
                "last_sender_id": c.get("last_sender_id"),
                "last_at": _iso(c.get("last_at")),
                "unread": int(unread.get(me_id, 0) or 0),
                "status": c.get("status") or "accepted",
                "requester_id": c.get("requester_id"),
            }
        )
    return out


async def list_conversations(conn, mongo, me_id) -> List[dict]:
    """내 대화 목록 (last_at desc, peer 닉/프사 일괄 하이드레이션).

    v155: 남이 보낸 pending(메시지 요청)은 제외 — 요청함(list_requests)에서만
    노출. 내가 보낸 pending 은 인스타처럼 내 목록에 표시(requester_id=me).
    legacy 문서(status 필드 부재)는 `$ne: "pending"` 으로 자동 accepted 취급.
    """
    await ensure_dm_indexes()
    me_id = str(me_id)
    convs = (
        await mongo.dm_conversations.find(
            {
                "participants": me_id,
                "$or": [{"status": {"$ne": "pending"}}, {"requester_id": me_id}],
            }
        )
        .sort("last_at", -1)
        .to_list(length=MAX_CONVERSATIONS)
    )
    return await _hydrate_conversation_list(conn, convs, me_id)


async def get_messages(mongo, conversation_id, me_id, before=None, limit=DEFAULT_MESSAGE_LIMIT) -> List[dict]:
    """대화 메시지 페이지네이션 (참여자 검증, created_at/_id desc → 프론트 reverse)."""
    me_id = str(me_id)
    conv = await _get_conv(mongo, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    if me_id not in (conv.get("participants") or []):
        raise HTTPException(status_code=403, detail="대화 참여자가 아닙니다.")

    try:
        limit = int(limit)
    except (ValueError, TypeError):
        limit = DEFAULT_MESSAGE_LIMIT
    limit = max(1, min(limit, MAX_MESSAGE_LIMIT))

    cid = str(conv["_id"])
    query = {"conversation_id": cid}
    if before:
        try:
            query["_id"] = {"$lt": ObjectId(str(before))}
        except (InvalidId, TypeError):
            pass
    docs = (
        await mongo.dm_messages.find(query)
        .sort("_id", -1)
        .limit(limit)
        .to_list(length=limit)
    )
    return [_serialize_message(d) for d in docs]


async def send_message(conn, mongo, me_id, conversation_id, text) -> dict:
    """메시지 전송 — 참여자 검증 + 게이트 재검사(대화존재 시 관계 skip) + 저장 +
    conversation last_* 갱신 + 상대 unread+1 + Redis publish `dm:user:{peer}`."""
    me_id = str(me_id)
    text = (text or "").strip()
    if not text or len(text) > MAX_TEXT_LEN:
        raise HTTPException(
            status_code=400, detail=f"메시지는 1~{MAX_TEXT_LEN}자여야 합니다."
        )
    conv = await _get_conv(mongo, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    if me_id not in (conv.get("participants") or []):
        raise HTTPException(status_code=403, detail="대화 참여자가 아닙니다.")
    peer_id = _peer_of(conv, me_id)

    # v155: pending 대화의 수신자(비요청자)는 수락 전 답장 불가
    if conv.get("status") == "pending" and me_id != conv.get("requester_id"):
        _deny(
            "pending_reply", me_id, peer_id, 403,
            "메시지 요청을 수락한 후에 답장할 수 있습니다.",
        )

    # 전송 시 게이트 재검사 (기존 대화 존재 → 관계 게이트 skip)
    await assert_can_dm(conn, mongo, me_id, peer_id, existing_conv=conv)

    now = _now()
    cid = str(conv["_id"])
    doc = {
        "conversation_id": cid,
        "sender_id": me_id,
        "text": text,
        "created_at": now,
        "read": False,
    }
    res = await mongo.dm_messages.insert_one(doc)
    doc["_id"] = res.inserted_id

    await mongo.dm_conversations.update_one(
        {"_id": conv["_id"]},
        {
            "$set": {
                "last_message_text": text[:LAST_MESSAGE_SUMMARY_LEN],
                "last_sender_id": me_id,
                "last_at": now,
                "updated_at": now,
            },
            "$inc": {f"unread.{peer_id}": 1},
        },
    )

    message = _serialize_message(doc)
    event = {
        "type": "message",
        "conversation_id": cid,
        "message": message,
        # v155: 수신측이 요청함/메인 목록 갱신을 분기할 수 있도록 상태 동봉
        "conversation_status": conv.get("status") or "accepted",
    }
    # 상대에게 실시간 push (본인은 REST 응답으로 echo)
    await publish_to_user(peer_id, event)
    logger.info(
        "[dm] message sent conv=%s me=%s peer=%s len=%d",
        _short(cid), _short(me_id), _short(peer_id), len(text),
    )
    return message


async def mark_read(mongo, conversation_id, me_id) -> dict:
    """내 unread=0 + 상대발신 미읽음 메시지 read=true 일괄. 상대에게 read 이벤트 발행."""
    me_id = str(me_id)
    conv = await _get_conv(mongo, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    if me_id not in (conv.get("participants") or []):
        raise HTTPException(status_code=403, detail="대화 참여자가 아닙니다.")
    cid = str(conv["_id"])

    # v155: pending 요청의 수신자 열람은 no-op — 요청 열람 사실을 발신자에게
    # 노출하지 않음(read 이벤트 미발행) + unread 는 수락 시점까지 보존.
    if conv.get("status") == "pending" and me_id != conv.get("requester_id"):
        logger.info(
            "[dm] mark_read skipped (pending request) conv=%s me=%s",
            _short(cid), _short(me_id),
        )
        return {"conversation_id": cid, "read": False, "marked": 0}

    await mongo.dm_conversations.update_one(
        {"_id": conv["_id"]}, {"$set": {f"unread.{me_id}": 0}}
    )
    result = await mongo.dm_messages.update_many(
        {"conversation_id": cid, "sender_id": {"$ne": me_id}, "read": False},
        {"$set": {"read": True}},
    )
    peer_id = _peer_of(conv, me_id)
    if peer_id:
        # 상대에게 "읽음" 알림 (읽음표시 동기화)
        await publish_to_user(peer_id, {"type": "read", "conversation_id": cid})
    logger.info(
        "[dm] mark_read conv=%s me=%s marked=%d",
        _short(cid), _short(me_id), result.modified_count,
    )
    return {"conversation_id": cid, "read": True, "marked": result.modified_count}


async def unread_total(mongo, me_id) -> int:
    """헤더 배지용 총 unread 합 — v155: accepted(및 legacy) 대화만 집계."""
    me_id = str(me_id)
    total = 0
    cursor = mongo.dm_conversations.find(
        {"participants": me_id, "status": {"$ne": "pending"}}, {"unread": 1}
    )
    async for c in cursor:
        total += int((c.get("unread") or {}).get(me_id, 0) or 0)
    return total


# ---------------------------------------------------------------------------
# 메시지 요청함 (v155 — 인스타 C안: pending 격리 / 수락 / 거절)
# ---------------------------------------------------------------------------
def _requests_filter(me_id: str) -> dict:
    """내가 '받은' pending 요청 필터 (내가 보낸 pending 은 내 메인 목록 소관)."""
    return {
        "participants": me_id,
        "status": "pending",
        "requester_id": {"$ne": me_id},
    }


async def requests_count(mongo, me_id) -> int:
    """헤더/탭 배지용 — 내가 받은 pending 메시지 요청 수."""
    me_id = str(me_id)
    return await mongo.dm_conversations.count_documents(_requests_filter(me_id))


async def list_requests(conn, mongo, me_id) -> List[dict]:
    """내가 받은 메시지 요청 목록 (pending && requester != me, last_at desc)."""
    await ensure_dm_indexes()
    me_id = str(me_id)
    convs = (
        await mongo.dm_conversations.find(_requests_filter(me_id))
        .sort("last_at", -1)
        .to_list(length=MAX_CONVERSATIONS)
    )
    logger.info("[dm] list_requests me=%s count=%d", _short(me_id), len(convs))
    return await _hydrate_conversation_list(conn, convs, me_id)


def _assert_request_receiver(conv, me_id, cid_hint, action: str) -> None:
    """accept/decline 공통 검증 — 참여자 404/403, pending 400, 수신자 본인 403."""
    if not conv:
        logger.info("[dm] %s denied (not found) conv=%s me=%s", action, _short(cid_hint), _short(me_id))
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    if me_id not in (conv.get("participants") or []):
        logger.info("[dm] %s denied (not participant) conv=%s me=%s", action, _short(conv["_id"]), _short(me_id))
        raise HTTPException(status_code=403, detail="대화 참여자가 아닙니다.")
    if (conv.get("status") or "accepted") != "pending":
        logger.info("[dm] %s denied (not pending) conv=%s me=%s", action, _short(conv["_id"]), _short(me_id))
        raise HTTPException(status_code=400, detail="이미 처리된 요청입니다.")
    if me_id == conv.get("requester_id"):
        logger.info("[dm] %s denied (requester self) conv=%s me=%s", action, _short(conv["_id"]), _short(me_id))
        raise HTTPException(status_code=403, detail="메시지 요청의 수신자만 처리할 수 있습니다.")


async def accept_request(conn, mongo, cid, me_id) -> dict:
    """메시지 요청 수락 — 수신자만. status→accepted, 요청자에게 WS accepted 발행."""
    me_id = str(me_id)
    conv = await _get_conv(mongo, cid)
    _assert_request_receiver(conv, me_id, cid, "accept")
    now = _now()
    await mongo.dm_conversations.update_one(
        {"_id": conv["_id"]},
        {"$set": {"status": "accepted", "accepted_at": now, "updated_at": now}},
    )
    conv["status"] = "accepted"
    conv["accepted_at"] = now
    requester_id = conv.get("requester_id")
    if requester_id:
        # 요청자 UI 의 대화 상태 갱신용 (수락 통지)
        await publish_to_user(
            requester_id, {"type": "accepted", "conversation_id": str(conv["_id"])}
        )
    logger.info(
        "[dm] request accepted conv=%s me=%s requester=%s",
        _short(conv["_id"]), _short(me_id), _short(requester_id),
    )
    return await _serialize_conversation(conn, conv, me_id)


async def decline_request(mongo, cid, me_id) -> dict:
    """메시지 요청 거절 — 수신자만. 대화+메시지 hard delete, 발신자 미통지.

    인스타식 무통지 삭제. 기접수 신고는 reports.py 가 접수 시점에 evidence
    스냅샷(PG jsonb)을 저장하므로 삭제와 증거 충돌 없음.
    """
    me_id = str(me_id)
    conv = await _get_conv(mongo, cid)
    _assert_request_receiver(conv, me_id, cid, "decline")
    cid_str = str(conv["_id"])
    msg_result = await mongo.dm_messages.delete_many({"conversation_id": cid_str})
    await mongo.dm_conversations.delete_one({"_id": conv["_id"]})
    # WS 이벤트 미발행 — 발신자에게 거절 사실 비노출(인스타 방식)
    logger.info(
        "[dm] request declined conv=%s me=%s deleted_msgs=%d",
        _short(cid_str), _short(me_id), msg_result.deleted_count,
    )
    return {"declined": True, "deleted_messages": msg_result.deleted_count}


# ---------------------------------------------------------------------------
# 사용자 검색 (v155 — 새 메시지 대상 전체 닉네임 검색)
# ---------------------------------------------------------------------------
def _escape_like(q: str) -> str:
    """ILIKE 패턴 메타문자 이스케이프 (Postgres 기본 escape = backslash)."""
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_users(conn, mongo, me_id, q, limit: int = 20) -> List[dict]:
    """DM 대상 전체 사용자 닉네임 부분일치 검색 + 배틀태그 정확 매칭 (v156).

    게이트: 인증 유저 + is_verified(게이트① 준용 — 미인증 유저의 전체 닉네임
    열람 방지). active/비밴만, 자기 자신 제외, dm_blocks 양방향 관계 일괄
    후필터. 검색어 원문 미로그(name 모드는 길이만 — tag 모드 코드값은
    비밀 아님이라 로그 허용).

    v156 태그 파싱: q 에 '#' 포함 시 마지막 '#' 기준 분리 → 뒷부분을
    normalize_code(trim+upper) 후 REFERRAL_CODE_RE 풀매치면 태그 정확 매칭
    모드(`referral_code = tag`, 닉네임부 무시 — 태그 전역 유일이라 최대 1명).
    무효 태그면 전체 문자열 그대로 기존 ILIKE 닉네임 검색 폴백
    ('#' 은 LIKE 메타문자 아님 — 닉네임에 '#' 포함 유저 검색 유지).
    """
    me_id = str(me_id)
    q = (q or "").strip()

    # v156: 배틀태그 파싱 — 마지막 '#' 기준 분리 후 형식 검증
    tag = ""
    if "#" in q:
        _, _, tail = q.rpartition("#")
        cand = normalize_code(tail)
        if REFERRAL_CODE_RE.match(cand):
            tag = cand
    mode = "tag" if tag else "name"
    logger.info(
        "[dm] user_search me=%s qlen=%d mode=%s%s",
        _short(me_id), len(q), mode, f" code={tag}" if tag else "",
    )
    if not q:
        return []

    # 게이트① 준용 — is_verified fresh 확인
    me_row = await _fetch_gate_row(conn, me_id)
    if not me_row or not me_row["is_verified"]:
        _deny("verified", me_id, None, 403, "본인인증 후 이용 가능합니다.")

    try:
        me_uuid = uuid.UUID(me_id)
    except (ValueError, TypeError):
        _deny("verified", me_id, None, 403, "본인인증 후 이용 가능합니다.")

    # 후필터(차단)로 줄어들 수 있어 limit 의 2배 조회 후 절단
    if tag:
        # 태그 정확 매칭 모드 — 게이트/자기제외 조건은 name 모드와 동일
        rows = await conn.fetch(
            """
            SELECT id, nickname, profile_image, referral_code
            FROM users
            WHERE referral_code = $1
              AND account_status = 'active'
              AND NOT is_banned
              AND id != $2
            LIMIT $3
            """,
            tag, me_uuid, limit * 2,
        )
    else:
        pattern = f"%{_escape_like(q)}%"
        rows = await conn.fetch(
            """
            SELECT id, nickname, profile_image, referral_code
            FROM users
            WHERE nickname ILIKE $1
              AND account_status = 'active'
              AND NOT is_banned
              AND id != $2
            ORDER BY nickname
            LIMIT $3
            """,
            pattern, me_uuid, limit * 2,
        )

    # dm_blocks 양방향 관계 일괄 후필터 (1회 조회 → set 제외)
    blocked = set()
    cursor = mongo.dm_blocks.find(
        {"$or": [{"blocker_id": me_id}, {"blocked_id": me_id}]},
        {"blocker_id": 1, "blocked_id": 1},
    )
    async for b in cursor:
        blocked.add(b.get("blocker_id"))
        blocked.add(b.get("blocked_id"))
    blocked.discard(me_id)

    out = []
    for r in rows:
        uid = str(r["id"])
        if uid in blocked:
            continue
        out.append(
            {
                "id": uid,
                "nickname": r["nickname"],
                "profile_image": r["profile_image"],
                "code": r["referral_code"],
            }
        )
        if len(out) >= limit:
            break
    logger.info(
        "[dm] user_search done me=%s qlen=%d mode=%s results=%d",
        _short(me_id), len(q), mode, len(out),
    )
    return out


# ---------------------------------------------------------------------------
# 차단
# ---------------------------------------------------------------------------
async def block_user(mongo, me_id, target_id) -> dict:
    me_id, target_id = str(me_id), str(target_id)
    if me_id == target_id:
        raise HTTPException(status_code=400, detail="자기 자신을 차단할 수 없습니다.")
    await ensure_dm_indexes()
    try:
        await mongo.dm_blocks.update_one(
            {"blocker_id": me_id, "blocked_id": target_id},
            {
                "$setOnInsert": {
                    "blocker_id": me_id,
                    "blocked_id": target_id,
                    "created_at": _now(),
                }
            },
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    logger.info("[dm] block me=%s target=%s", _short(me_id), _short(target_id))
    return {"blocked": True}


async def unblock_user(mongo, me_id, target_id) -> dict:
    me_id, target_id = str(me_id), str(target_id)
    await mongo.dm_blocks.delete_one({"blocker_id": me_id, "blocked_id": target_id})
    logger.info("[dm] unblock me=%s target=%s", _short(me_id), _short(target_id))
    return {"blocked": False}
