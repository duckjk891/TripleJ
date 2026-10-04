"""DmSquad(v152) — 실시간 1:1 DM 라우터 (REST + WebSocket).

v155(C안): 전체 사용자 검색(`GET /users/search`) + 메시지 요청함
(`GET /requests`, `POST /conversations/{cid}/accept`,
`DELETE /conversations/{cid}`) + `GET /unread-count` → `{count, requests}` 확장.

prefix `/api/dm`. REST 전 엔드포인트는 `get_current_user` 인증.
WS `/api/dm/ws?token=<jwt>` 는 Depends 대신 `authenticate_ws` 수동 검증
(get_current_user 는 HTTPException raise → WS 부적합). 실패 시 close(4401).

실시간 팬아웃: REST 전송 핸들러(dm_service.send_message)가 Redis
`dm:user:{peer}` 로 이벤트 발행 → lifespan 에서 기동한 단일 `dm_pubsub_listener`
가 `psubscribe("dm:user:*")` 후 로컬 ConnectionManager 로 push(멀티워커 대응).
WS 는 서버→클라 push 전용(클라 수신은 keepalive/ping 외 무시).

v3.252 [Club] — 같은 리스너가 `club:*`(크루 단톡방, clubs.py 송신 성공 시 publish)도
psubscribe 한다. 클럽 이벤트는 수신 워커에서 club_members 조회(60s 캐시)로
"해당 크루 멤버이면서 이 워커에 접속 중인" 소켓에만 전달(설계 판단 — 채널을
클럽 단위로 publish 해 송신측 팬아웃 비용 0, 멤버십 판정은 수신 워커가 캐시로).
캐시 TTL 60s 동안 신규 승인 멤버는 이벤트 미수신·kick 직후 멤버는 수신 가능(허용 오차).

로그 prefix [dm](REST) / [dm-ws](WS) / [dm-pubsub](리스너) — id 앞 8자만,
본문 텍스트 원문·토큰·JWT_SECRET 미로그.
"""

import asyncio
import json
import logging
import time
import uuid
from typing import List, Optional

import jwt
import redis.exceptions as redis_exceptions
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import JWT_ALGORITHM, JWT_SECRET, get_current_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..services import dm_service
from ..services.dm_service import (
    CLUB_CHANNEL_PATTERN,
    CLUB_CHANNEL_PREFIX,
    DM_CHANNEL_PATTERN,
    _short,
)
from ..services.official import get_official_id
from ..services import kids_policy  # v3.232 F1 — 어린이 DM(킬 스위치 OFF 면 no-op)
from ..services.word_filter import social_filter_on, word_filter_response  # v3.232 G1 · v3.233 소통 경로 전체 적용

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dm", tags=["DM"])


# ---------------------------------------------------------------------------
# WebSocket 연결 매니저 (in-memory, 멀티탭 대비 user_id → set[WebSocket])
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self._conns: dict[str, set] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        self._conns.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket):
        conns = self._conns.get(user_id)
        if conns:
            conns.discard(websocket)
            if not conns:
                self._conns.pop(user_id, None)

    async def send_to_user(self, user_id: str, data) -> int:
        """자기 워커 로컬 소켓에만 직접 write. 전송 소켓 수 반환."""
        conns = self._conns.get(user_id)
        if not conns:
            return 0
        payload = data if isinstance(data, str) else json.dumps(data)
        sent, dead = 0, []
        for ws in list(conns):
            try:
                await ws.send_text(payload)
                sent += 1
            except Exception:
                dead.append(ws)
        for ws in dead:
            conns.discard(ws)
        if not conns:
            self._conns.pop(user_id, None)
        return sent

    @property
    def user_count(self) -> int:
        return len(self._conns)

    def connected_user_ids(self) -> set:
        """v3.252 [Club] — 이 워커에 접속 중인 user_id 집합(클럽 팬아웃 교집합용)."""
        return set(self._conns.keys())


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# v3.252 [Club] — 클럽 멤버십 60s 캐시 + 클럽 이벤트 팬아웃
# ---------------------------------------------------------------------------
CLUB_MEMBERS_CACHE_TTL = 60.0
_CLUB_MEMBERS_CACHE_MAX = 512
_club_members_cache: dict = {}  # club_id -> (expires_monotonic, frozenset[user_id])


def _club_members_cache_clear():
    """테스트·재기동용."""
    _club_members_cache.clear()


async def _club_member_ids(club_id: str) -> frozenset:
    """클럽 멤버 user_id 집합 — 60s TTL 캐시(수신 워커 팬아웃 판정용). 실패는 빈 집합."""
    now = time.monotonic()
    hit = _club_members_cache.get(club_id)
    if hit and hit[0] > now:
        return hit[1]
    try:
        mongo = get_mongo()
        docs = await mongo.club_members.find(
            {"club_id": str(club_id)}, {"user_id": 1}
        ).to_list(length=None)
        ids = frozenset(str(d.get("user_id")) for d in docs if d.get("user_id"))
    except Exception:
        logger.exception("[dm-pubsub] club members lookup failed club=%s", _short(club_id))
        return frozenset()
    if len(_club_members_cache) >= _CLUB_MEMBERS_CACHE_MAX:
        # 만료 항목 정리 — 그래도 가득이면 전체 리셋(단순 상한, 클럽 수 규모상 도달 희박)
        expired = [k for k, v in _club_members_cache.items() if v[0] <= now]
        for k in expired:
            _club_members_cache.pop(k, None)
        if len(_club_members_cache) >= _CLUB_MEMBERS_CACHE_MAX:
            _club_members_cache.clear()
    _club_members_cache[club_id] = (now + CLUB_MEMBERS_CACHE_TTL, ids)
    return ids


async def dispatch_pubsub_event(channel: str, event) -> int:
    """pmessage 1건 라우팅 — dm:user:{uid} 는 해당 유저, club:{club_id} 는
    '멤버 ∩ 이 워커 접속자' 에게 팬아웃. 전송 소켓 수 반환(리스너·테스트 공용)."""
    if channel.startswith(CLUB_CHANNEL_PREFIX):
        club_id = channel[len(CLUB_CHANNEL_PREFIX):]
        if not club_id:
            return 0
        members = await _club_member_ids(club_id)
        targets = members & manager.connected_user_ids()
        sent = 0
        for uid in targets:
            sent += await manager.send_to_user(uid, event)
        logger.info(
            "[dm-pubsub] club fanout club=%s targets=%d sent=%d type=%s",
            _short(club_id), len(targets), sent,
            event.get("type") if isinstance(event, dict) else "?",
        )
        return sent
    uid = channel.rsplit(":", 1)[-1] if channel else None
    if not uid:
        return 0
    sent = await manager.send_to_user(uid, event)
    logger.info(
        "[dm-pubsub] fanout uid=%s sent=%d type=%s",
        _short(uid), sent,
        event.get("type") if isinstance(event, dict) else "?",
    )
    return sent


# ---------------------------------------------------------------------------
# 요청 모델
# ---------------------------------------------------------------------------
class CreateConversationBody(BaseModel):
    peer_id: str


class SendMessageBody(BaseModel):
    # v3.207 ⑥: 이미지 첨부 — text 는 optional 로 완화(text 또는 image 중 1개 필수,
    # 검증은 dm_service.send_message 단일 소스). image_object_name 은
    # POST /api/upload/dm-image 가 반환한 본인 dm/{user_id}/ prefix 오브젝트만 수용.
    # 구 앱 하위호환: 구 클라이언트는 {text}만 보내며 저장 문서·응답 스키마 불변.
    text: str = ""
    image_object_name: Optional[str] = None
    # v3.274: 다중 이미지(한 메시지 최대 5장 — 신고 증빙 등). 단일 필드와 병용 수용,
    # 검증·상한은 dm_service.send_message 단일 소스. 구 앱({text, image_object_name}) 불변.
    image_object_names: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# REST 엔드포인트
# ---------------------------------------------------------------------------
@router.get("/official")
async def official_contact(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """maidol_official 공식 계정 연락처 조회 (CS 오류신고 문의 대상).

    FE 가 이 id 로 대화 시작(POST /conversations)한다. 공식 미시드 시 503.
    """
    me = current_user["id"]
    logger.info("[dm] official contact me=%s", _short(me))
    try:
        official_id = await get_official_id(conn)
        if not official_id:
            logger.warning("[dm] official contact unavailable me=%s", _short(me))
            return JSONResponse(status_code=503, content={"error": "공식 계정을 사용할 수 없습니다."})
        return {"official_id": official_id, "nickname": settings.official_account_nickname}
    except Exception:
        logger.exception("[dm] official contact failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.get("/eligibility")
async def dm_eligibility(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """봉투 아이콘/버튼 활성 판단 — 본인인증 게이트②만 반영."""
    me = current_user["id"]
    try:
        row = await conn.fetchrow(
            "SELECT is_verified, is_banned FROM users WHERE id = $1",
            uuid.UUID(str(me)),
        )
        return {
            "is_verified": bool(row["is_verified"]) if row else False,
            "is_banned": bool(row["is_banned"]) if row else False,
        }
    except Exception:
        logger.exception("[dm] eligibility failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.post("/conversations")
async def create_conversation(
    body: CreateConversationBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """대화 시작/기존 반환 — 안전게이트 전체 통과 필수."""
    me = current_user["id"]
    peer = (body.peer_id or "").strip()
    logger.info("[dm] create_conversation me=%s peer=%s", _short(me), _short(peer))
    # v3.232 F1 — 어린이는 공식 계정과의 대화만 시작 가능(상대가 어린이인 경우는 서비스 게이트가 일반 문구로 거부).
    # v3.233 — 보호자가 '친구와 메시지'(dm_friends)를 허용했고 서로 팔로우한 상대면 허용(나머지는 서비스 게이트).
    if kids_policy.kids_enabled() and await kids_policy.is_child_user(me, conn):
        if peer != (await get_official_id(conn) or ""):
            _kids_dm = await kids_policy.child_dm_friend_status(conn, me, peer)
            if _kids_dm != "ok":
                logger.info("[dm] gate denied stage=child me=%s peer=%s", _short(me), _short(peer))
                return kids_policy.child_restricted(
                    "dm", me,
                    message=kids_policy.DM_FRIENDS_ONLY_MESSAGE if _kids_dm == "not_mutual" else None,
                )
            logger.info("[dm] kids friend conversation me=%s peer=%s", _short(me), _short(peer))
    try:
        conv = await dm_service.get_or_create_conversation(conn, get_mongo(), me, peer)
        return conv
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] create_conversation failed me=%s peer=%s", _short(me), _short(peer))
        return JSONResponse(status_code=500, content={"error": "대화를 시작할 수 없습니다."})


@router.get("/conversations")
async def list_conversations(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """내 대화 목록 (last_at desc)."""
    me = current_user["id"]
    try:
        items = await dm_service.list_conversations(conn, get_mongo(), me)
        logger.info("[dm] list_conversations me=%s count=%d", _short(me), len(items))
        return {"conversations": items}
    except Exception:
        logger.exception("[dm] list_conversations failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "대화 목록을 불러올 수 없습니다."})


@router.get("/conversations/{cid}/messages")
async def get_messages(
    cid: str,
    before: str = None,
    limit: int = dm_service.DEFAULT_MESSAGE_LIMIT,
    current_user=Depends(get_current_user),
):
    """메시지 페이지네이션 (참여자 검증). created_at desc — 프론트 reverse."""
    me = current_user["id"]
    try:
        items = await dm_service.get_messages(get_mongo(), cid, me, before=before, limit=limit)
        return {"messages": items}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] get_messages failed me=%s conv=%s", _short(me), _short(cid))
        return JSONResponse(status_code=500, content={"error": "메시지를 불러올 수 없습니다."})


@router.post("/conversations/{cid}/messages")
async def post_message(
    cid: str,
    body: SendMessageBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """메시지 전송 — 참여자 검증 + 게이트 재검사 + 저장 + unread+1 + WS push.

    v3.207 ⑥: image_object_name(optional) — 이미지 첨부 메시지 지원.
    """
    me = current_user["id"]
    # v3.232 F1·G1 — 어린이: 사진 첨부 거부 + 금칙어·개인정보 검사(대화 상대 제한은 서비스 게이트). OFF 면 DB 0회.
    if kids_policy.kids_enabled() and await kids_policy.is_child_user(me, conn):
        if body.image_object_name or body.image_object_names:
            return kids_policy.child_restricted("dm_image", me)
        _wf = await word_filter_response(me, [body.text], "dm", child=True)
        if _wf is not None:
            return _wf
    elif kids_policy.kids_enabled() or getattr(settings, "word_filter_all_users", False) or social_filter_on():
        _wf = await word_filter_response(me, [body.text], "dm", child=False)
        if _wf is not None:
            return _wf
    try:
        message = await dm_service.send_message(
            conn, get_mongo(), me, cid, body.text,
            image_object_name=body.image_object_name,
            image_object_names=body.image_object_names,
        )
        return {"message": message}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] post_message failed me=%s conv=%s", _short(me), _short(cid))
        return JSONResponse(status_code=500, content={"error": "메시지를 보낼 수 없습니다."})


@router.post("/conversations/{cid}/read")
async def read_conversation(
    cid: str, current_user=Depends(get_current_user)
):
    """내 unread=0 + 상대발신 미읽음 read=true."""
    me = current_user["id"]
    try:
        return await dm_service.mark_read(get_mongo(), cid, me)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] read failed me=%s conv=%s", _short(me), _short(cid))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.get("/unread-count")
async def unread_count(current_user=Depends(get_current_user)):
    """헤더 배지용 총 unread 합 (30s 폴링).

    v155: `{count, requests}` — count 는 accepted 대화만 집계(헤더 하위호환),
    requests 는 내가 받은 pending 메시지 요청 수(DM 페이지 탭 배지용).
    """
    me = current_user["id"]
    try:
        mongo = get_mongo()
        count = await dm_service.unread_total(mongo, me)
        requests = await dm_service.requests_count(mongo, me)
        return {"count": count, "requests": requests}
    except Exception:
        logger.exception("[dm] unread_count failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


# ---------------------------------------------------------------------------
# v155 — 메시지 요청함 / 사용자 검색
# ---------------------------------------------------------------------------
@router.get("/users/search")
async def search_dm_users(
    q: str = "",
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """DM 대상 전체 사용자 닉네임 검색 — is_verified 게이트(게이트① 준용),
    active/비밴만, 자기 자신/차단(양방향) 제외. 검색어 원문 미로그(길이만)."""
    me = current_user["id"]
    logger.info("[dm] user_search request me=%s qlen=%d", _short(me), len((q or "").strip()))
    # v3.232 F1 — 어린이는 사용자 검색 불가(공식 계정 고정 행만). OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(me, "dm_search", conn)
    if _kids_block is not None:
        return _kids_block
    try:
        users = await dm_service.search_users(conn, get_mongo(), me, q)
        return {"users": users}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] user_search failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "검색을 처리할 수 없습니다."})


# ---------------------------------------------------------------------------
# 관리자 대상별 전체발송 (broadcast) — v194 폐기(410 Gone)
# ---------------------------------------------------------------------------
# v194: 발송 경로를 `POST /api/admin/cs/broadcast` 하나로 강제한다. 이 경로로
# 나간 발송은 공지 이력(notices)·감사 로그에 남지 않아 "무엇을 언제 누구에게
# 고지했는가" 가 유실되므로 구조적으로 차단한다(프론트 사용처 실측 0건 —
# 사용자 앱/관리자 앱 양쪽 grep). 인증(get_current_user)은 유지 — 무인증
# 스캐너에 경로 존재를 알리지 않는다. 본문(body) 파싱조차 하지 않는다.
@router.post("/broadcast")
async def broadcast(current_user=Depends(get_current_user)):
    """**폐기됨(410 Gone).** 전체발송은 `POST /api/admin/cs/broadcast` 를 사용한다.

    해당 엔드포인트만이 공지 이력(notices)·읽음 통계·감사 로그를 남긴다.
    """
    me = current_user["id"]
    logger.warning("[dm-broadcast] gone (deprecated endpoint) me=%s", _short(me))
    return JSONResponse(
        status_code=410,
        content={"error": "지원하지 않는 경로입니다. 공지 발송은 관리자 공지 관리에서 이용해주세요."},
    )


@router.get("/requests")
async def list_requests(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """내가 받은 메시지 요청 목록 (pending && requester != me, last_at desc)."""
    me = current_user["id"]
    try:
        items = await dm_service.list_requests(conn, get_mongo(), me)
        logger.info("[dm] list_requests me=%s count=%d", _short(me), len(items))
        return {"requests": items, "count": len(items)}
    except Exception:
        logger.exception("[dm] list_requests failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "요청 목록을 불러올 수 없습니다."})


@router.post("/conversations/{cid}/accept")
async def accept_request(
    cid: str,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """메시지 요청 수락 — 수신자만. status→accepted + 요청자에게 WS accepted 발행."""
    me = current_user["id"]
    logger.info("[dm] accept_request me=%s conv=%s", _short(me), _short(cid))
    try:
        conv = await dm_service.accept_request(conn, get_mongo(), cid, me)
        return {"ok": True, "conversation": conv}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] accept_request failed me=%s conv=%s", _short(me), _short(cid))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.delete("/conversations/{cid}")
async def decline_request(cid: str, current_user=Depends(get_current_user)):
    """메시지 요청 거절 — 수신자만. 대화+메시지 삭제, 발신자 미통지(인스타식)."""
    me = current_user["id"]
    logger.info("[dm] decline_request me=%s conv=%s", _short(me), _short(cid))
    try:
        await dm_service.decline_request(get_mongo(), cid, me)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] decline_request failed me=%s conv=%s", _short(me), _short(cid))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.post("/blocks/{uid}")
async def block(uid: str, current_user=Depends(get_current_user)):
    """상대 차단."""
    me = current_user["id"]
    try:
        return await dm_service.block_user(get_mongo(), me, uid)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] block failed me=%s target=%s", _short(me), _short(uid))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


@router.delete("/blocks/{uid}")
async def unblock(uid: str, current_user=Depends(get_current_user)):
    """차단 해제."""
    me = current_user["id"]
    try:
        return await dm_service.unblock_user(get_mongo(), me, uid)
    except Exception:
        logger.exception("[dm] unblock failed me=%s target=%s", _short(me), _short(uid))
        return JSONResponse(status_code=500, content={"error": "요청을 처리할 수 없습니다."})


# ---------------------------------------------------------------------------
# WebSocket — 수동 인증 (auth.py 미수정, JWT 상수만 import 재사용)
# ---------------------------------------------------------------------------
async def _reject_ws(websocket: WebSocket) -> None:
    """WS 인증 거절 — 반드시 accept 후 close 한다.

    2026-08-20: accept 이전에 close(4401) 을 호출하면 ASGI 규약상 핸드셰이크가
    HTTP 403 으로 변환되어 클라이언트는 close code 를 받지 못하고 1006 을 본다.
    프론트(`dmSocket.js`)의 4401 분기가 사문화되어 만료 토큰 보유 브라우저가
    30초 간격으로 영구 재접속하던 버그의 원인. accept 후 close 해야 코드가 전달된다.
    """
    try:
        await websocket.accept()
    except Exception:  # 이미 닫혔거나 accept 불가 — 거절 자체는 성립
        pass
    try:
        await websocket.close(code=4401)
    except Exception:
        pass


async def authenticate_ws(websocket: WebSocket):
    """`?token=` 또는 Authorization 헤더에서 JWT 추출 → decode → Redis 세션 확인.
    실패 시 websocket.close(code=4401) 후 None 반환. 성공 시 user_id(str) 반환.
    (토큰/JWT_SECRET 미로그.)"""
    token = websocket.query_params.get("token")
    if not token:
        auth = websocket.headers.get("authorization")
        if auth and auth.startswith("Bearer "):
            token = auth.split(" ")[1]
    if not token:
        await _reject_ws(websocket)
        return None
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True}
        )
    except jwt.InvalidTokenError:
        await _reject_ws(websocket)
        return None
    user_id = payload.get("id")
    if not user_id:
        await _reject_ws(websocket)
        return None
    try:
        redis = get_redis()
        session = await redis.get(f"session:{user_id}") if redis is not None else None
    except Exception:
        await _reject_ws(websocket)
        return None
    if not session:
        await _reject_ws(websocket)
        return None
    return str(user_id)


@router.websocket("/ws")
async def dm_ws(websocket: WebSocket):
    user_id = await authenticate_ws(websocket)
    if not user_id:
        logger.info("[dm-ws] auth failed close=4401")
        return
    await websocket.accept()
    await manager.connect(user_id, websocket)
    logger.info(
        "[dm-ws] connected user=%s online_users=%d", _short(user_id), manager.user_count
    )
    try:
        while True:
            # 서버→클라 push 전용. 클라 수신은 keepalive/ping 외 무시.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("[dm-ws] receive error user=%s", _short(user_id))
    finally:
        manager.disconnect(user_id, websocket)
        logger.info(
            "[dm-ws] disconnected user=%s online_users=%d",
            _short(user_id), manager.user_count,
        )


# ---------------------------------------------------------------------------
# Redis pub/sub 리스너 — lifespan 에서 단일 태스크로 기동
# ---------------------------------------------------------------------------
async def dm_pubsub_listener():
    """`dm:user:*` + `club:*`(v3.252) 구독 → 채널별 로컬 소켓 팬아웃(dispatch_pubsub_event).

    `get_message(timeout=1.0)` 폴링 루프 — 유휴(msg is None)와 read 타임아웃은
    **정상**으로 취급하고 continue(재구독/backoff 없음). 진짜 연결 단절
    (ConnectionError 등)일 때만 재구독 + backoff. CancelledError 는 정상 종료.
    유휴 타임아웃마다 로그 남기지 않음(스팸 방지) — fanout/재연결 시에만 로그.
    """
    logger.info(
        "[dm-pubsub] listener starting patterns=%s,%s", DM_CHANNEL_PATTERN, CLUB_CHANNEL_PATTERN
    )
    while True:
        pubsub = None
        try:
            redis = get_redis()
            if redis is None:
                await asyncio.sleep(1)
                continue
            pubsub = redis.pubsub()
            await pubsub.psubscribe(DM_CHANNEL_PATTERN, CLUB_CHANNEL_PATTERN)
            logger.info(
                "[dm-pubsub] subscribed patterns=%s,%s", DM_CHANNEL_PATTERN, CLUB_CHANNEL_PATTERN
            )
            while True:
                try:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                except redis_exceptions.TimeoutError:
                    # 유휴 상태 read 타임아웃 — 정상. 재구독/로그 없이 계속 폴링.
                    continue
                if message is None or message.get("type") != "pmessage":
                    continue
                try:
                    channel = message.get("channel")
                    data = message.get("data")
                    if not channel or data is None:
                        continue
                    event = json.loads(data) if isinstance(data, str) else data
                    await dispatch_pubsub_event(channel, event)
                except Exception:
                    logger.exception("[dm-pubsub] message handling error")
        except asyncio.CancelledError:
            logger.info("[dm-pubsub] listener cancelled")
            if pubsub is not None:
                try:
                    await pubsub.punsubscribe(DM_CHANNEL_PATTERN, CLUB_CHANNEL_PATTERN)
                    await pubsub.close()
                except Exception:
                    pass
            raise
        except redis_exceptions.ConnectionError:
            # 진짜 연결 단절 — 재구독 + backoff.
            logger.warning("[dm-pubsub] connection lost; resubscribing in 2s")
            if pubsub is not None:
                try:
                    await pubsub.close()
                except Exception:
                    pass
            await asyncio.sleep(2)
        except Exception:
            logger.exception("[dm-pubsub] listener crashed; restarting in 2s")
            if pubsub is not None:
                try:
                    await pubsub.close()
                except Exception:
                    pass
            await asyncio.sleep(2)
