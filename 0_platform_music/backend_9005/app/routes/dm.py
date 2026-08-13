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

로그 prefix [dm](REST) / [dm-ws](WS) / [dm-pubsub](리스너) — id 앞 8자만,
본문 텍스트 원문·토큰·JWT_SECRET 미로그.
"""

import asyncio
import json
import logging
import uuid

import jwt
import redis.exceptions as redis_exceptions
from fastapi import (
    APIRouter,
    BackgroundTasks,
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
from ..services.dm_service import DM_CHANNEL_PATTERN, _short
from ..services.official import get_official_id

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


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# 요청 모델
# ---------------------------------------------------------------------------
class CreateConversationBody(BaseModel):
    peer_id: str


class SendMessageBody(BaseModel):
    text: str


class BroadcastBody(BaseModel):
    audience: str
    text: str


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
    """메시지 전송 — 참여자 검증 + 게이트 재검사 + 저장 + unread+1 + WS push."""
    me = current_user["id"]
    try:
        message = await dm_service.send_message(conn, get_mongo(), me, cid, body.text)
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
    try:
        users = await dm_service.search_users(conn, get_mongo(), me, q)
        return {"users": users}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[dm] user_search failed me=%s", _short(me))
        return JSONResponse(status_code=500, content={"error": "검색을 처리할 수 없습니다."})


# ---------------------------------------------------------------------------
# 관리자 대상별 전체발송 (broadcast)
# ---------------------------------------------------------------------------
async def _run_broadcast(me_id: str, audience: str, text: str) -> None:
    """BackgroundTasks 진입점 — 요청 스코프(get_pg) 커넥션은 응답 종료 시 이미
    반환됐으므로, 풀에서 **새 커넥션**을 획득해 broadcast_message 를 실행한다.
    Mongo 는 전역 getter(get_mongo) 라 재사용. text 원문 미로그."""
    from ..database import postgres as _pg

    try:
        async with _pg._pool.acquire() as conn:
            await dm_service.broadcast_message(conn, get_mongo(), me_id, audience, text)
    except Exception:
        logger.exception(
            "[dm-broadcast] background run failed admin=%s audience=%s",
            _short(me_id), audience,
        )


# deprecated(v174): 관리자 앱은 /api/admin/cs/broadcast 사용 — 이 엔드포인트는 호환 유지용
@router.post("/broadcast")
async def broadcast(
    body: BroadcastBody,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """관리자 대상별 전체발송 — admin 게이트 후 대상 수 선계산 → 백그라운드 fan-out.

    body: {audience: all|users|customers, text}. 대상 수만 미리 세어 즉시
    `{queued, audience}` 반환하고, 실제 발송은 BackgroundTasks 에서 새 풀 커넥션
    으로 수행. text 원문 미로그(길이만)."""
    me = current_user["id"]
    audience = (body.audience or "").strip()
    text = (body.text or "").strip()
    logger.info(
        "[dm-broadcast] req admin=%s audience=%s text_len=%d",
        _short(me), audience, len(text),
    )

    # 관리자 게이트
    if current_user.get("role") != "admin":
        logger.info("[dm-broadcast] denied (not admin) me=%s", _short(me))
        return JSONResponse(status_code=403, content={"error": "관리자만 사용할 수 있습니다."})

    # audience 화이트리스트
    if audience not in dm_service.BROADCAST_AUDIENCES:
        logger.info("[dm-broadcast] denied (bad audience) me=%s", _short(me))
        return JSONResponse(status_code=400, content={"error": "발송 대상이 올바르지 않습니다."})

    # text 검증
    if not text or len(text) > dm_service.MAX_TEXT_LEN:
        return JSONResponse(
            status_code=400,
            content={"error": f"메시지는 1~{dm_service.MAX_TEXT_LEN}자여야 합니다."},
        )

    try:
        targets = await dm_service.count_broadcast_targets(conn, me, audience)
    except Exception:
        logger.exception(
            "[dm-broadcast] count failed me=%s audience=%s", _short(me), audience
        )
        return JSONResponse(status_code=500, content={"error": "발송을 준비할 수 없습니다."})

    # v170 — 중복발송 방지: 검증을 모두 통과한 뒤(오타 요청이 잠금을 잡지 않게),
    # 큐잉 직전 admin별 Redis 잠금(SET NX, TTL 30초). 더블클릭/네트워크 재시도로
    # 같은 공지가 전원에게 2번 나가는 사고 차단. Redis 불가 시 잠금 없이 진행
    # (기능 자체를 막지 않음 — best-effort 안전장치).
    try:
        redis = get_redis()
        if redis is not None:
            acquired = await redis.set(
                f"dm:broadcast:lock:{me}", "1", nx=True, ex=30
            )
            if not acquired:
                logger.info("[dm-broadcast] denied (duplicate, locked) me=%s", _short(me))
                return JSONResponse(
                    status_code=429,
                    content={"error": "방금 발송한 건이 처리 중입니다. 잠시 후 다시 시도해주세요."},
                )
    except redis_exceptions.RedisError:
        logger.warning("[dm-broadcast] lock skipped (redis unavailable) me=%s", _short(me))

    background_tasks.add_task(_run_broadcast, str(me), audience, text)
    logger.info(
        "[dm-broadcast] queued admin=%s audience=%s targets=%d",
        _short(me), audience, targets,
    )
    return {"queued": targets, "audience": audience}


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
        await websocket.close(code=4401)
        return None
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True}
        )
    except jwt.InvalidTokenError:
        await websocket.close(code=4401)
        return None
    user_id = payload.get("id")
    if not user_id:
        await websocket.close(code=4401)
        return None
    try:
        redis = get_redis()
        session = await redis.get(f"session:{user_id}") if redis is not None else None
    except Exception:
        await websocket.close(code=4401)
        return None
    if not session:
        await websocket.close(code=4401)
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
    """`dm:user:*` 구독 → 채널에서 uid 파싱 → 로컬 소켓 팬아웃.

    `get_message(timeout=1.0)` 폴링 루프 — 유휴(msg is None)와 read 타임아웃은
    **정상**으로 취급하고 continue(재구독/backoff 없음). 진짜 연결 단절
    (ConnectionError 등)일 때만 재구독 + backoff. CancelledError 는 정상 종료.
    유휴 타임아웃마다 로그 남기지 않음(스팸 방지) — fanout/재연결 시에만 로그.
    """
    logger.info("[dm-pubsub] listener starting pattern=%s", DM_CHANNEL_PATTERN)
    while True:
        pubsub = None
        try:
            redis = get_redis()
            if redis is None:
                await asyncio.sleep(1)
                continue
            pubsub = redis.pubsub()
            await pubsub.psubscribe(DM_CHANNEL_PATTERN)
            logger.info("[dm-pubsub] subscribed pattern=%s", DM_CHANNEL_PATTERN)
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
                    uid = channel.rsplit(":", 1)[-1] if channel else None
                    if not uid or data is None:
                        continue
                    event = json.loads(data) if isinstance(data, str) else data
                    sent = await manager.send_to_user(uid, event)
                    logger.info(
                        "[dm-pubsub] fanout uid=%s sent=%d type=%s",
                        _short(uid), sent,
                        event.get("type") if isinstance(event, dict) else "?",
                    )
                except Exception:
                    logger.exception("[dm-pubsub] message handling error")
        except asyncio.CancelledError:
            logger.info("[dm-pubsub] listener cancelled")
            if pubsub is not None:
                try:
                    await pubsub.punsubscribe(DM_CHANNEL_PATTERN)
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
