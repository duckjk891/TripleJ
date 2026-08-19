"""NoticeSquad(v194) — 공지(전체발송 DM) 이력 · 읽음 통계 서비스 계층.

`POST /api/admin/cs/broadcast` 로 나가는 **전체발송 1건** 을 Mongo `notices`
컬렉션에 1문서로 영속화하고(누가/언제/누구에게/무엇을), 배포된 `dm_messages`
사본을 `notice_id` 로 묶어 읽음 집계(delivered / read_count / read_rate)를
서버에서 계산해 관리자 앱에 제공한다.

**공지 본문 보관의 정당성 (PLAN v194 §2 — 프라이버시 경계)**
공지는 (a) 발신자가 사용자 개인이 아니라 운영 주체(공식 계정), (b) 내용이
불특정 다수에게 동일하게 배포되는 공개 고지, (c) 사후 분쟁 시 "무엇을 언제
누구에게 고지했는가" 를 증명해야 하는 운영 기록 → 보관이 정당하고 필요하다.

**경계 불변 조건 (반드시 유지)**
1. `notices.text` 에는 **관리자가 작성한 공지 본문만** 저장한다.
   **사적 DM 본문은 여전히 미저장** — 사용자가 보낸 DM 본문은 `dm_messages`
   정본 외 어디에도 복제하지 않는다(dm_service 모듈 docstring 정책 승계).
2. PG `admin_logs.details` 에는 여전히 `text_len` 만(+ `notice_id` 포인터).
   공지 본문은 Postgres 로 넘어가지 않는다.
3. 서버 로그에 공지 본문 원문 출력 **금지** — 길이(text_len)만.
4. `dm_service._serialize_message` 는 불변 — `notice_id` 를 사용자 응답에
   노출하지 않는다(내부 식별자).

Collections:
  - notices:     공지 1건 헤더 {text, audience, status, targets, sent, failed,
                 admin_id, official_id, created_at, finished_at, error}
  - dm_messages: 공지로 배포된 메시지에만 `notice_id`(str) 가 sparse 하게 존재

로그 prefix [notice] — notice_id/admin_id 앞 8자만, 본문 원문 미로그(길이만).
개인정보(생년월일·성별·이메일)는 응답·로그 어디에도 포함하지 않는다.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId

from ..database.mongodb import get_mongo  # noqa: F401 (참조 편의)
from . import dm_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------
NOTICE_STATUSES = ("sending", "done", "failed")
TEXT_PREVIEW_LEN = 60
DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 100
# status=sending 이 이 시간을 넘기면 "중단됨(확인 필요)" 로 표시 — 표시 전용,
# 자동 복구/쓰기 없음(BackgroundTasks 는 프로세스 재기동 시 유실됨 — 알려진 한계)
STALE_AFTER_MINUTES = 30
# error 필드는 예외 타입명만 저장 — 원문/스택 금지. 안전 상한.
MAX_ERROR_LEN = 100


_indexes_ready = False


async def ensure_notice_indexes():
    """Lazily create notice indexes once (dm_service.ensure_dm_indexes 패턴 복제).

    - `notices.created_at`: 목록 정렬(created_at DESC)
    - `dm_messages [(notice_id,1),(read,1)] sparse`: 읽음 집계 전용.
      **sparse 필수** — 사적 DM 문서에는 `notice_id` 가 없어 인덱스에 포함되지
      않는다(인덱스 크기·일반 DM insert 비용 증가를 0 에 가깝게 유지).

    `dm_service.ensure_dm_indexes` 는 건드리지 않는다(변경 표면 최소화).
    """
    global _indexes_ready
    if _indexes_ready:
        return
    mongo = get_mongo()
    await mongo.notices.create_index("created_at")
    await mongo.dm_messages.create_index([("notice_id", 1), ("read", 1)], sparse=True)
    _indexes_ready = True
    logger.info("[notice] indexes ensured")


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _short(value) -> str:
    """추적자 표기 — id 앞 8자. 값 없으면 '-'(로그 규율: notice=%s 는 항상 존재)."""
    return str(value)[:8] if value else "-"


def _iso(dt) -> Optional[str]:
    """시각 직렬화 — tz 명시판 (admin_issues._iso:104-113 복제).

    Mongo 는 UTC 를 naive 로 돌려줌 — tz 미표기 시 프론트 `new Date()` 가
    로컬(KST)로 오해석해 9시간 밀림 → UTC 명시 후 직렬화.
    **응답의 모든 시각 필드는 예외 없이 이 헬퍼를 통과시킨다.**
    """
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return dt


def _oid(notice_id) -> Optional[ObjectId]:
    try:
        return ObjectId(str(notice_id))
    except (InvalidId, TypeError):
        return None


def _is_stale(status, created_at) -> bool:
    """표시 전용 플래그 — status=sending 이 STALE_AFTER_MINUTES 를 넘김. 쓰기 없음."""
    if status != "sending" or not isinstance(created_at, datetime):
        return False
    dt = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    return dt < _now() - timedelta(minutes=STALE_AFTER_MINUTES)


def _read_rate(status, sent: int, delivered: int, read_count: int) -> float:
    """읽음률(%) 서버 계산 — 프론트 계산 금지(표기 불일치 방지).

    분모: 완료 건(status=done && sent>0)은 실제 발송 성공 수(sent),
    그 외(발송중·실패)는 실제 배포된 메시지 수(delivered). 분모 0 이면 0.0.
    """
    denom = sent if (status == "done" and sent > 0) else delivered
    if not denom:
        return 0.0
    return round(read_count / denom * 100, 1)


def _serialize_notice(doc: dict, stats=None, admin_info=None, *, include_text=False) -> dict:
    """공지 1건 직렬화. 개인정보(생년월일·성별·이메일) 필드 없음 — 절대 추가 금지.

    include_text=True(상세) 일 때만 본문 전문 + official_id 를 덧붙인다.
    """
    text = doc.get("text") or ""
    status = doc.get("status") or "sending"
    sent = int(doc.get("sent") or 0)
    failed = int(doc.get("failed") or 0)
    s = stats or {}
    delivered = int(s.get("delivered") or 0)
    read_count = int(s.get("read_count") or 0)
    info = admin_info or {}
    row = {
        "id": str(doc["_id"]),
        "text_preview": text[:TEXT_PREVIEW_LEN],
        "text_len": len(text),
        "audience": doc.get("audience"),
        "status": status,
        "stale": _is_stale(status, doc.get("created_at")),
        "targets": int(doc.get("targets") or 0),
        "sent": sent,
        "failed": failed,
        "delivered": delivered,
        "read_count": read_count,
        "read_rate": _read_rate(status, sent, delivered, read_count),
        "admin_id": doc.get("admin_id"),
        # 하이드레이션은 닉네임/배틀태그만 — 개인정보 필드 금지
        "admin_nickname": info.get("nickname"),
        "admin_code": info.get("code"),
        "created_at": _iso(doc.get("created_at")),
        "finished_at": _iso(doc.get("finished_at")),
    }
    if include_text:
        row["text"] = text
        row["official_id"] = doc.get("official_id")
    return row


async def _hydrate_admins(conn, admin_ids, admin_tag="-") -> dict:
    """admin_id → {nickname, code} 일괄 하이드레이션 (best-effort)."""
    uniq = [a for a in {str(a) for a in admin_ids if a}]
    if not uniq:
        return {}
    try:
        return await dm_service.hydrate_users(conn, uniq)
    except Exception:
        logger.warning(
            "[notice] hydrate failed admin=%s count=%d", admin_tag, len(uniq), exc_info=True
        )
        return {}


# ---------------------------------------------------------------------------
# 쓰기 — 발송 라이프사이클 (라우트에서 생성, 백그라운드에서 결과 갱신)
# ---------------------------------------------------------------------------
async def create_notice(mongo, *, text, audience, targets, admin_id, official_id) -> str:
    """공지 문서 생성(status=sending) → notice_id(str) 반환.

    반드시 라우트(요청 스코프) 안에서 호출한다 — 백그라운드는 official_id 만
    알고 로그인 관리자(admin_id)를 모르기 때문(PLAN §2). 실패 시 예외 전파:
    호출측이 500 반환 + 발송 미실행으로 처리한다(이력 없는 발송 금지).
    """
    await ensure_notice_indexes()
    text = text or ""
    doc = {
        "text": text,
        "audience": audience,
        "status": "sending",
        "targets": int(targets or 0),
        "sent": 0,
        "failed": 0,
        "admin_id": str(admin_id),
        "official_id": str(official_id),
        "created_at": _now(),
        "finished_at": None,
        "error": None,
    }
    res = await mongo.notices.insert_one(doc)
    notice_id = str(res.inserted_id)
    logger.info(
        "[notice] created notice=%s admin=%s audience=%s targets=%d text_len=%d",
        _short(notice_id), _short(admin_id), audience, int(targets or 0), len(text),
    )
    return notice_id


async def finish_notice(mongo, notice_id, sent, failed) -> bool:
    """발송 완료 반영 — status=done + sent/failed/finished_at. 갱신 여부 반환."""
    oid = _oid(notice_id)
    if oid is None:
        logger.warning("[notice] finished notice=%s skipped (bad id)", _short(notice_id))
        return False
    sent, failed = int(sent or 0), int(failed or 0)
    res = await mongo.notices.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "done",
                "sent": sent,
                "failed": failed,
                "finished_at": _now(),
                "error": None,
            }
        },
    )
    logger.info(
        "[notice] finished notice=%s sent=%d failed=%d", _short(notice_id), sent, failed
    )
    return res.matched_count > 0


async def fail_notice(mongo, notice_id, error_type) -> bool:
    """발송 실패 반영 — status=failed + finished_at + error(**예외 타입명만**).

    예외 메시지·스택은 저장하지 않는다(본문·개인정보 유출 방지).
    """
    oid = _oid(notice_id)
    if oid is None:
        logger.warning("[notice] failed notice=%s skipped (bad id)", _short(notice_id))
        return False
    error = str(error_type or "Exception")[:MAX_ERROR_LEN]
    res = await mongo.notices.update_one(
        {"_id": oid},
        {"$set": {"status": "failed", "finished_at": _now(), "error": error}},
    )
    logger.warning("[notice] failed notice=%s error=%s", _short(notice_id), error)
    return res.matched_count > 0


# ---------------------------------------------------------------------------
# 읽음 집계 — 단일 aggregation (행마다 count_documents 금지: N+1)
# ---------------------------------------------------------------------------
async def _read_stats(mongo, notice_ids) -> dict:
    """{notice_id: {delivered, read_count}} — `$in` 단일 aggregation 1회.

    `dm_messages [(notice_id,1),(read,1)] sparse` 인덱스를 탄다. 인덱스가 없으면
    full scan 이 되므로 ensure_notice_indexes() 선행이 릴리스 게이트.
    """
    ids = [str(i) for i in (notice_ids or []) if i]
    if not ids:
        return {}
    stats: dict = {}
    total_delivered = 0
    total_read = 0
    cursor = mongo.dm_messages.aggregate([
        {"$match": {"notice_id": {"$in": ids}}},
        {
            "$group": {
                "_id": "$notice_id",
                "delivered": {"$sum": 1},
                "read_count": {"$sum": {"$cond": ["$read", 1, 0]}},
            }
        },
    ])
    async for row in cursor:
        delivered = int(row.get("delivered") or 0)
        read_count = int(row.get("read_count") or 0)
        stats[str(row["_id"])] = {"delivered": delivered, "read_count": read_count}
        total_delivered += delivered
        total_read += read_count
    logger.info(
        "[notice] read stats notice_count=%d delivered=%d read=%d",
        len(ids), total_delivered, total_read,
    )
    return stats


# ---------------------------------------------------------------------------
# 조회 — 목록 / 상세
# ---------------------------------------------------------------------------
async def list_notices(conn, mongo, page=1, limit=DEFAULT_LIST_LIMIT, audience=None, admin_id=None) -> dict:
    """공지 목록 — created_at DESC 페이지네이션 + 읽음 집계 + admin 하이드레이션.

    반환 {notices: [...], pagination: {page, limit, total, pages}}.
    audience 화이트리스트 검증은 라우트 책임(400).
    """
    await ensure_notice_indexes()
    admin_tag = _short(admin_id)
    try:
        page = max(1, int(page))
    except (ValueError, TypeError):
        page = 1
    try:
        limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_LIST_LIMIT

    query: dict = {}
    if audience:
        query["audience"] = audience

    total = await mongo.notices.count_documents(query)
    docs = (
        await mongo.notices.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )

    stats = await _read_stats(mongo, [str(d["_id"]) for d in docs])
    hydrated = await _hydrate_admins(conn, [d.get("admin_id") for d in docs], admin_tag)

    notices = [
        _serialize_notice(d, stats.get(str(d["_id"])), hydrated.get(d.get("admin_id")))
        for d in docs
    ]
    logger.info(
        "[notice] list admin=%s page=%d limit=%d audience=%s returned=%d",
        admin_tag, page, limit, audience or "-", len(notices),
    )
    return {
        "notices": notices,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit if limit else 0,
        },
    }


async def get_notice(conn, mongo, notice_id, admin_id=None) -> Optional[dict]:
    """공지 상세 — 목록 행 + text(전문) + official_id. 미존재 시 None(라우트 404)."""
    await ensure_notice_indexes()
    admin_tag = _short(admin_id)
    oid = _oid(notice_id)
    if oid is None:
        logger.info("[notice] detail notice=%s found=%s", _short(notice_id), False)
        return None
    doc = await mongo.notices.find_one({"_id": oid})
    logger.info("[notice] detail notice=%s found=%s", _short(notice_id), bool(doc))
    if not doc:
        return None
    nid = str(doc["_id"])
    stats = await _read_stats(mongo, [nid])
    hydrated = await _hydrate_admins(conn, [doc.get("admin_id")], admin_tag)
    return _serialize_notice(
        doc, stats.get(nid), hydrated.get(doc.get("admin_id")), include_text=True
    )
