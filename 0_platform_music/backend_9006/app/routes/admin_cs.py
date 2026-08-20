"""OfficialSquad — 4001 어드민 CS 대응 API (maidol_official DM 문의 처리).

prefix `/api/admin/cs`. 전 엔드포인트 admin-role 필수(get_admin_user). 내부적으로
me_id = get_official_id() 로 기존 dm_service 함수를 그대로 재사용해 공식 계정
관점의 대화 목록/메시지 조회/답장/읽음/미읽음합을 제공한다.

각 대화 엔드포인트는 대상 대화가 실제 공식 계정 참여 대화인지 검증(권한)한다.
공식 미시드 시 503. 로그 prefix [admin-cs] — cid/admin id 앞 8자만, 본문 미로그.
"""

import logging
import uuid

import redis.exceptions as redis_exceptions
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..services import dm_service, notice_service
from ..services.dm_service import _get_conv, _short
from ..services.official import get_official_id
from .admin import _log_admin_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/cs", tags=["admin-cs"])

MAX_PAGE_LIMIT = 100

# v177 지정발송 대상 인원 상한 (dedupe 후 판정) — 초과는 전체발송(broadcast) 유도
MAX_CS_SEND_TARGETS = 20


class ReplyBody(BaseModel):
    text: str


class BroadcastCsBody(BaseModel):
    audience: str
    text: str


class SendCsBody(BaseModel):
    user_ids: list[str]
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


@router.get("/conversations/{cid}")
async def get_cs_conversation(
    cid: str,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """단건 대화 조회 — 목록(list_conversations)에 안 잡히는 대화 합류용.

    사용자가 먼저 만든 pending(메시지 요청) 대화는 공식 계정 목록에서 제외되므로
    `/cs?cid=` 진입 시 좌측 목록에서 찾을 수 없다. 목록과 동일한 형태로 단건을
    반환해 프론트가 선택 상태로 렌더할 수 있게 한다. 공식 참여 검증은 동일.
    """
    admin_tag = str(current_user["id"])[:8]
    logger.info("[admin-cs] cid=%s admin=%s get conversation", _short(cid), admin_tag)
    try:
        official_id = await _resolve_official(conn)
        conv = await _assert_official_conversation(get_mongo(), cid, official_id, admin_tag)
        items = await dm_service._hydrate_conversation_list(conn, [conv], official_id)
        return {"conversation": items[0]}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] get conversation failed cid=%s admin=%s", _short(cid), admin_tag)
        return JSONResponse(status_code=500, content={"error": "대화를 불러올 수 없습니다."})


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


# ---------------------------------------------------------------------------
# 대상별 전체발송 (broadcast) — 발신자=공식 계정(official)
# ---------------------------------------------------------------------------
async def _run_cs_broadcast(official_id: str, audience: str, text: str, notice_id: str) -> None:
    """BackgroundTasks 진입점 — 요청 스코프
    (get_pg) 커넥션은 응답 종료 시 이미 반환됐으므로, 풀에서 **새 커넥션**을
    획득해 broadcast_message 를 실행한다. Mongo 는 전역 getter(get_mongo) 재사용.
    text 원문 미로그.

    v194: notice_id 를 fan-out 에 전달(사본 묶음 키)하고, 종료 시 공지 문서에
    결과(sent/failed)를 영속화한다 — 실패 시 예외 **타입명만** 기록(원문/스택 금지).
    """
    from ..database import postgres as _pg

    notice_tag = str(notice_id)[:8] if notice_id else "-"
    logger.info(
        "[admin-cs] broadcast background start official=%s audience=%s notice=%s",
        _short(official_id), audience, notice_tag,
    )
    mongo = get_mongo()
    try:
        async with _pg._pool.acquire() as conn:
            result = await dm_service.broadcast_message(
                conn, mongo, official_id, audience, text, notice_id=notice_id
            )
        sent = int(result.get("sent", 0))
        failed = int(result.get("failed", 0))
        await notice_service.finish_notice(mongo, notice_id, sent, failed)
        logger.info(
            "[admin-cs] broadcast background done official=%s audience=%s sent=%d failed=%d notice=%s",
            _short(official_id), audience, sent, failed, notice_tag,
        )
    except Exception as e:
        logger.exception(
            "[admin-cs] broadcast background failed official=%s audience=%s notice=%s",
            _short(official_id), audience, notice_tag,
        )
        try:
            await notice_service.fail_notice(mongo, notice_id, type(e).__name__)
        except Exception:
            logger.warning(
                "[admin-cs] broadcast notice fail-mark failed official=%s notice=%s",
                _short(official_id), notice_tag,
                exc_info=True,
            )


@router.post("/broadcast")
async def broadcast_cs(
    body: BroadcastCsBody,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """대상별 전체발송 — 발신자=공식 계정(official). admin 게이트(get_admin_user)
    → official 해석(미시드 503) → audience/text 검증(400) → 대상 수 선계산 →
    중복발송 잠금(429) → **공지 이력 생성(notices)** → BackgroundTasks 로 fan-out.
    응답 `{queued, audience, notice_id}`(v194 additive). text 원문 미로그(길이만).

    v194: 발송 경로 단일화 — 공지 관리 페이지도 이 엔드포인트를 그대로 쓴다
    (발송/재발송 전용 신규 엔드포인트 없음). 공지 문서 생성 실패 시 **발송을
    진행하지 않고 500** — 이력 없는 발송을 만들지 않는다. 락 획득 **후**에
    생성하므로 429 로 튕긴 중복 요청이 유령 공지를 만들지 않는다."""
    admin_tag = str(current_user["id"])[:8]
    audience = (body.audience or "").strip()
    text = (body.text or "").strip()
    logger.info(
        "[admin-cs] broadcast enter admin=%s audience=%s text_len=%d",
        admin_tag, audience, len(text),
    )
    try:
        official_id = await _resolve_official(conn)  # 미시드 503

        # audience 화이트리스트
        if audience not in dm_service.BROADCAST_AUDIENCES:
            logger.info(
                "[admin-cs] broadcast denied (bad audience) admin=%s audience=%s",
                admin_tag, audience,
            )
            return JSONResponse(status_code=400, content={"error": "발송 대상이 올바르지 않습니다."})

        # text 검증 (1~MAX_TEXT_LEN)
        if not text or len(text) > dm_service.MAX_TEXT_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"메시지는 1~{dm_service.MAX_TEXT_LEN}자여야 합니다."},
            )

        # 대상 수 선계산 (발신자=official)
        targets = await dm_service.count_broadcast_targets(conn, official_id, audience)
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-cs] broadcast prepare failed admin=%s audience=%s", admin_tag, audience
        )
        return JSONResponse(status_code=500, content={"error": "발송을 준비할 수 없습니다."})

    # 중복발송 방지 — official별 Redis 잠금(SET NX, TTL 30초). dm.py v170 패턴.
    # Redis 불가 시 잠금 없이 진행(best-effort 안전장치).
    try:
        redis = get_redis()
        if redis is not None:
            acquired = await redis.set(
                f"dm:broadcast:lock:{official_id}", "1", nx=True, ex=30
            )
            if not acquired:
                logger.warning(
                    "[admin-cs] broadcast denied (duplicate, locked) admin=%s official=%s audience=%s",
                    admin_tag, _short(official_id), audience,
                )
                return JSONResponse(
                    status_code=429,
                    content={"error": "방금 발송한 건이 처리 중입니다. 잠시 후 다시 시도해주세요."},
                )
    except redis_exceptions.RedisError:
        logger.warning(
            "[admin-cs] broadcast lock skipped (redis unavailable) admin=%s official=%s",
            admin_tag, _short(official_id),
        )

    # v194 공지 이력 생성 — 락 획득 후, 큐잉 전. 실패 시 발송 미실행(500).
    # (락은 TTL 30초로 자연 해제되므로 별도 해제 없음)
    try:
        notice_id = await notice_service.create_notice(
            get_mongo(),
            text=text,
            audience=audience,
            targets=targets,
            admin_id=str(current_user["id"]),
            official_id=str(official_id),
        )
    except Exception:
        logger.exception("[admin-cs] broadcast denied (notice create failed) admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "발송 이력을 만들 수 없어 발송을 중단했습니다."})

    notice_tag = str(notice_id)[:8]
    logger.info(
        "[admin-cs] broadcast notice created notice=%s admin=%s targets=%d",
        notice_tag, admin_tag, targets,
    )

    background_tasks.add_task(_run_cs_broadcast, str(official_id), audience, text, notice_id)
    logger.info(
        "[admin-cs] broadcast queued admin=%s official=%s audience=%s targets=%d notice=%s",
        admin_tag, _short(official_id), audience, targets, notice_tag,
    )

    # 감사 로그 적재 (best-effort) — text 원문 미저장(길이만 + notice_id 포인터),
    # 실패해도 발송은 유지. 본문은 notices 컬렉션에만 존재(PG 로 넘기지 않음).
    try:
        await _log_admin_action(
            conn,
            str(current_user["id"]),
            "cs_broadcast",
            "broadcast",
            audience,
            {"targets": targets, "text_len": len(text), "notice_id": notice_id},
        )
    except Exception:
        logger.warning(
            "[admin-cs] broadcast audit log failed admin=%s audience=%s targets=%d notice=%s",
            admin_tag, audience, targets, notice_tag,
            exc_info=True,
        )

    return {"queued": targets, "audience": audience, "notice_id": notice_id}


# ---------------------------------------------------------------------------
# 지정발송 (v177) — 발신자=공식 계정(official), 명시 user_ids 대상 동기 발송
# ---------------------------------------------------------------------------
@router.get("/users/search")
async def search_cs_users(
    q: str = "",
    limit: int = 20,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """지정발송 대상 검색 — dm_service.search_users 위임(me=official).

    닉네임 ILIKE + '#태그' 정확 매칭(v156). active/비밴 + dm_blocks 후필터라
    검색 결과 ≒ 발송 가능 대상(게이트 정합). 검색어 원문 미로그(길이만).

    v178: 빈 q(트림 후)는 **브라우즈 모드** — 관리자 전용 목록(닉네임순).
    dm_service.search_users 의 빈 검색어 가드(`if not q: return []` — 사용자 앱
    전체 유저 열람 방지 프라이버시 가드)는 절대 불변이라 여기서 자체 쿼리."""
    admin_tag = str(current_user["id"])[:8]
    try:
        limit = max(1, min(int(limit), 20))
    except (ValueError, TypeError):
        limit = 20
    q_stripped = (q or "").strip()
    mode = "search" if q_stripped else "browse"
    logger.info(
        "[admin-cs] user search admin=%s qlen=%d mode=%s limit=%d",
        admin_tag, len(q_stripped), mode, limit,
    )
    try:
        official_id = await _resolve_official(conn)  # 미시드 503
        mongo = get_mongo()

        if not q_stripped:
            # v178 브라우즈 분기 — 필터·정렬·dm_blocks 후필터·응답 키를
            # dm_service.search_users 필터와 동기 유지 필요(:866-896 조회 쿼리
            # 및 :945-970 후필터 참조 — search_users 필터 변경 시 이 분기 동반
            # 수정). dm_service.py 수정 금지 정책상 수동 복제본임.
            official_uuid = uuid.UUID(str(official_id))
            # 후필터(차단)로 줄어들 수 있어 limit 의 2배 조회 후 절단
            rows = await conn.fetch(
                """
                SELECT id, nickname, profile_image, referral_code
                FROM users
                WHERE account_status = 'active'
                  AND NOT is_banned
                  AND id != $1
                ORDER BY nickname
                LIMIT $2
                """,
                official_uuid, limit * 2,
            )

            # dm_blocks 양방향 관계 일괄 후필터 (search_users 동일 패턴, me=official)
            me_id = str(official_id)
            blocked = set()
            cursor = mongo.dm_blocks.find(
                {"$or": [{"blocker_id": me_id}, {"blocked_id": me_id}]},
                {"blocker_id": 1, "blocked_id": 1},
            )
            async for b in cursor:
                blocked.add(b.get("blocker_id"))
                blocked.add(b.get("blocked_id"))
            blocked.discard(me_id)

            users = []
            for r in rows:
                uid = str(r["id"])
                if uid in blocked:
                    continue
                users.append(
                    {
                        "id": uid,
                        "nickname": r["nickname"],
                        "profile_image": r["profile_image"],
                        "code": r["referral_code"],
                    }
                )
                if len(users) >= limit:
                    break
            logger.info(
                "[admin-cs] user search done admin=%s mode=browse results=%d",
                admin_tag, len(users),
            )
        else:
            users = await dm_service.search_users(conn, mongo, official_id, q, limit=limit)
        return {"users": users}
    except HTTPException:
        raise
    except Exception:
        logger.exception("[admin-cs] user search failed admin=%s", admin_tag)
        return JSONResponse(status_code=500, content={"error": "사용자를 검색할 수 없습니다."})


@router.post("/send")
async def send_cs_direct(
    body: SendCsBody,
    current_user=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """지정발송 — 발신자=official, 명시 user_ids(dedupe 후 1~20명) 대상 **동기** 발송.

    admin 게이트 → official 해석(미시드 503) → user_ids/text 검증(400) →
    dm_service.send_to_users(assert_can_dm 풀 게이트 — per-target 실패는 집계만)
    → 대상별 감사 적재(cs_send, best-effort). Redis 잠금 없음(동기 + 상한 20 —
    v177 설계 확정). 응답 {requested, sent, failed, failed_ids}.
    text 원문 미로그(길이만)."""
    admin_tag = str(current_user["id"])[:8]
    text = (body.text or "").strip()

    # dedupe (순서 보존)
    seen: set = set()
    user_ids: list[str] = []
    for uid in body.user_ids or []:
        uid = str(uid or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            user_ids.append(uid)

    logger.info(
        "[admin-cs] send enter admin=%s targets=%d text_len=%d",
        admin_tag, len(user_ids), len(text),
    )
    try:
        official_id = await _resolve_official(conn)  # 미시드 503

        if not user_ids:
            return JSONResponse(status_code=400, content={"error": "발송 대상을 선택해주세요."})
        if len(user_ids) > MAX_CS_SEND_TARGETS:
            return JSONResponse(
                status_code=400,
                content={
                    "error": f"지정 발송은 최대 {MAX_CS_SEND_TARGETS}명까지 가능합니다. "
                             "그 이상은 전체 발송을 이용해주세요."
                },
            )
        for uid in user_ids:
            try:
                uuid.UUID(uid)
            except (ValueError, TypeError):
                return JSONResponse(
                    status_code=400,
                    content={"error": "잘못된 사용자 ID 형식이 포함되어 있습니다."},
                )
        if not text or len(text) > dm_service.MAX_TEXT_LEN:
            return JSONResponse(
                status_code=400,
                content={"error": f"메시지는 1~{dm_service.MAX_TEXT_LEN}자여야 합니다."},
            )

        result = await dm_service.send_to_users(
            conn, get_mongo(), official_id, user_ids, text
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "[admin-cs] send failed admin=%s targets=%d", admin_tag, len(user_ids)
        )
        return JSONResponse(status_code=500, content={"error": "발송할 수 없습니다."})

    # 감사 로그 적재 (best-effort) — 대상별 1행, text 원문 미저장(길이만).
    # 적재 실패가 발송 응답을 막지 않음.
    failed_set = set(result.get("failed_ids") or [])
    for uid in user_ids:
        try:
            await _log_admin_action(
                conn,
                str(current_user["id"]),
                "cs_send",
                "user",
                uid,
                {
                    "result": "failed" if uid in failed_set else "sent",
                    "targets": result.get("requested", len(user_ids)),
                    "text_len": len(text),
                },
            )
        except Exception:
            logger.warning(
                "[admin-cs] send audit log failed admin=%s target=%s",
                admin_tag, uid[:8],
                exc_info=True,
            )

    logger.info(
        "[admin-cs] send done admin=%s requested=%d sent=%d failed=%d",
        admin_tag,
        int(result.get("requested", 0)), int(result.get("sent", 0)), int(result.get("failed", 0)),
    )
    return result
