"""v3.200 — Phase 0 창작 기록 계층 API (문서 §12).

- POST /api/sessions                 : 세션 생성 → SESSION_START 기록
- GET  /api/sessions/{id}            : 세션 메타 + root_hash
- POST /api/sessions/{id}/events     : 앱 이벤트 배치 (LISTEN/CANDIDATE_SELECT/
                                       LYRIC_EDIT/FINALIZE) — event_id idempotent,
                                       client_seq 순 seq 부여, 스키마 엄격 검증(§12)
- POST /api/sessions/{id}/lyrics     : 가사 버전 커밋(전문+prev_version_id+source)
                                       → LYRIC_EDIT 기록. origin 계산은 후속(NULL)

검증 방침(§12): 앱이 보낸 type·payload 가 §5.1 스키마를 만족하지 않으면 400.
알 수 없는 필드는 거부(엄격). 검증은 배치 전체를 먼저 통과시킨 뒤 append —
부분 기록으로 체인이 오염되지 않게 한다. FINALIZED 세션에 이벤트 추가는 409.
민감정보(가사 전문·프롬프트)는 로그에 남기지 않는다.
"""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..services import creation_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["creation-log"])

MAX_BATCH = 500

# ─── §5.1 payload 스키마 (엄격 — 허용 키 외 거부, 예약 옵션 키는 §6.3) ──────
LISTEN_ACTIONS = {"play", "pause", "seek", "ended"}
SELECT_ACTIONS = {"select", "reject", "unselect"}
FINALIZE_TRIGGERS = {"download", "publish", "done"}

ALLOWED_ITEM_KEYS = {"event_id", "client_seq", "type", "client_ts", "target", "payload"}
ALLOWED_TARGET_KEYS = {"candidate_id", "segment", "item"}
ALLOWED_PAYLOAD_KEYS = {
    "LISTEN": {"action", "position_ms", "from_ms", "to_ms"},
    # rating/favorite/reject_reason — 옵션 예약(§6.3, Phase 2)
    "CANDIDATE_SELECT": {"action", "rating", "favorite", "reject_reason"},
    "LYRIC_EDIT": {"lyrics_version_id", "prev_lyrics_version_id", "diff_hash",
                   "origin_summary", "edit_stats", "source"},
    "FINALIZE": {"candidate_id", "audio_sha256", "lyrics_version_id", "trigger", "track_type"},
}
APP_EVENT_TYPES = set(ALLOWED_PAYLOAD_KEYS.keys())


class CreateSessionBody(BaseModel):
    app_version: Optional[str] = None
    platform: Optional[str] = None            # ios | android | web
    engine_list: Optional[list] = None        # [{engine, model}]
    parent_session_id: Optional[str] = None   # FINALIZED 곡 재편집(§4.1)


class EventItem(BaseModel):
    # §12 body: [{event_id, client_seq, type, client_ts, target, payload}]
    # 엄격 검증은 아래 _validate_item 이 raw dict 기준으로 수행 (pydantic extra
    # 는 기본 ignore 라 unknown-field 거부가 안 됨 — model_config 로 forbid).
    event_id: str
    client_seq: int
    type: str
    client_ts: Optional[str] = None
    target: Optional[dict] = None
    payload: dict

    model_config = {"extra": "forbid"}


class EventsBatchBody(BaseModel):
    events: List[EventItem]

    model_config = {"extra": "forbid"}


class LyricsCommitBody(BaseModel):
    text: str
    source: str                                # ai_draft | user_edit | engine_returned
    prev_version_id: Optional[str] = None
    client_ts: Optional[str] = None

    model_config = {"extra": "forbid"}


def _err(status: int, msg: str):
    return JSONResponse(status_code=status, content={"error": msg})


def _parse_client_ts(raw) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"invalid client_ts: {str(raw)[:40]}")


def _require_int(payload: dict, key: str, etype: str):
    v = payload.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < 0:
        raise ValueError(f"{etype}.payload.{key} must be a non-negative integer")


def _validate_item(item: EventItem) -> dict:
    """§5.1/§12 엄격 검증 — 통과 시 append 용 dict 반환, 위반 시 ValueError."""
    etype = item.type
    if etype not in APP_EVENT_TYPES:
        raise ValueError(f"unknown or server-only event type: {etype}")

    target = item.target or {}
    unknown_t = set(target.keys()) - ALLOWED_TARGET_KEYS
    if unknown_t:
        raise ValueError(f"{etype}.target has unknown fields: {sorted(unknown_t)}")

    payload = item.payload or {}
    unknown_p = set(payload.keys()) - ALLOWED_PAYLOAD_KEYS[etype]
    if unknown_p:
        raise ValueError(f"{etype}.payload has unknown fields: {sorted(unknown_p)}")

    if etype == "LISTEN":
        action = payload.get("action")
        if action not in LISTEN_ACTIONS:
            raise ValueError(f"LISTEN.payload.action must be one of {sorted(LISTEN_ACTIONS)}")
        if not target.get("candidate_id"):
            raise ValueError("LISTEN.target.candidate_id is required")
        if action == "seek":
            _require_int(payload, "from_ms", etype)
            _require_int(payload, "to_ms", etype)
        else:
            _require_int(payload, "position_ms", etype)

    elif etype == "CANDIDATE_SELECT":
        if payload.get("action") not in SELECT_ACTIONS:
            raise ValueError(f"CANDIDATE_SELECT.payload.action must be one of {sorted(SELECT_ACTIONS)}")
        if not target.get("candidate_id"):
            raise ValueError("CANDIDATE_SELECT.target.candidate_id is required")

    elif etype == "LYRIC_EDIT":
        if not payload.get("lyrics_version_id"):
            raise ValueError("LYRIC_EDIT.payload.lyrics_version_id is required")
        if not payload.get("diff_hash"):
            raise ValueError("LYRIC_EDIT.payload.diff_hash is required")

    elif etype == "FINALIZE":
        if not payload.get("candidate_id"):
            raise ValueError("FINALIZE.payload.candidate_id is required")
        if not payload.get("audio_sha256"):
            raise ValueError("FINALIZE.payload.audio_sha256 is required")
        if payload.get("trigger") not in FINALIZE_TRIGGERS:
            raise ValueError(f"FINALIZE.payload.trigger must be one of {sorted(FINALIZE_TRIGGERS)}")

    # target 예약 필드 정규화 (§5.2 — segment/item 은 Phase 1·2 예약, 지금은 null)
    norm_target = {
        "candidate_id": target.get("candidate_id"),
        "segment": None,
        "item": None,
    } if target else None

    return {
        "event_id": item.event_id,
        "client_seq": item.client_seq,
        "type": etype,
        "actor": "user",
        "client_ts": _parse_client_ts(item.client_ts),
        "target": norm_target,
        "payload": payload,
    }


async def _owned_session(session_id: str, user_id: str):
    """세션 존재+본인 소유 확인. (없음, 응답) 튜플 — 응답이 있으면 그대로 반환."""
    import uuid as _uuid
    try:
        _uuid.UUID(str(session_id))
    except ValueError:
        return None, _err(404, "세션을 찾을 수 없습니다.")
    try:
        sess = await creation_log.get_session(session_id)
    except Exception:
        logger.exception("[creation-log] session lookup failed id=%s", session_id[:8])
        return None, _err(500, "세션 조회에 실패했습니다.")
    if not sess:
        return None, _err(404, "세션을 찾을 수 없습니다.")
    if sess["user_id_hash"] != creation_log.user_id_hash(user_id):
        return None, _err(403, "접근 권한이 없습니다.")
    return sess, None


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
@router.post("/", status_code=201, include_in_schema=False)
async def create_session(body: CreateSessionBody, current_user=Depends(get_current_user)):
    """세션 생성 → SESSION_START 기록(§4.2).

    import_blocked=false 고정 — 참고 음악 업로드 경로가 실존하므로(§4.3 전제
    불성립) 허위 플래그를 기록하지 않는다 (creation_log.create_session 주석).
    """
    try:
        parent = None
        if body.parent_session_id:
            sess, resp = await _owned_session(body.parent_session_id, current_user["id"])
            if resp:
                return resp
            parent = str(sess["session_id"])
        session_id = await creation_log.create_session(
            current_user["id"],
            app_version=(body.app_version or "").strip()[:40] or None,
            platform=(body.platform or "").strip()[:16] or None,
            engine_list=body.engine_list,
            parent_session_id=parent,
        )
        return {"session_id": session_id}
    except Exception:
        logger.exception("[creation-log] create session failed")
        return _err(500, "세션 생성에 실패했습니다.")


@router.get("/{session_id}")
async def get_session(session_id: str, current_user=Depends(get_current_user)):
    sess, resp = await _owned_session(session_id, current_user["id"])
    if resp:
        return resp
    return {
        "session_id": str(sess["session_id"]),
        "status": sess["status"],
        "parent_session_id": str(sess["parent_session_id"]) if sess["parent_session_id"] else None,
        "started_at": sess["started_at"].isoformat() if sess["started_at"] else None,
        "finalized_at": sess["finalized_at"].isoformat() if sess["finalized_at"] else None,
        "root_hash": sess["root_hash"],
        "final_candidate_id": sess["final_candidate_id"],
        "final_lyrics_version_id": str(sess["final_lyrics_version_id"]) if sess["final_lyrics_version_id"] else None,
        "app_version": sess["app_version"],
        "import_blocked": sess["import_blocked"],
        "criteria_version": sess["criteria_version"],
    }


@router.post("/{session_id}/events")
async def upload_events(session_id: str, body: EventsBatchBody,
                        current_user=Depends(get_current_user)):
    """앱 이벤트 배치 업로드(§5.5·§12) — 검증 전체 통과 후 client_seq 순 append.

    FINALIZE 가 포함되면 그 지점에서 finalize_session(후보 존재 엄격 검증 §4.4,
    root_hash 확정)을 수행하고, 그 뒤 이벤트는 rejected 로 돌려준다(§4.2 —
    한 세션에 FINALIZE 1회, 이후 편집은 새 세션).
    """
    sess, resp = await _owned_session(session_id, current_user["id"])
    if resp:
        return resp
    if sess["status"] == "FINALIZED":
        return _err(409, "이미 종료(FINALIZED)된 세션입니다. 새 세션을 생성해 주세요.")
    if not body.events:
        return _err(400, "events가 비어 있습니다.")
    if len(body.events) > MAX_BATCH:
        return _err(400, f"배치는 최대 {MAX_BATCH}건까지 허용됩니다.")

    # 1) 전체 엄격 검증 (§12) — 하나라도 위반이면 400, 아무것도 기록하지 않음.
    try:
        items = [_validate_item(it) for it in body.events]
    except ValueError as ve:
        logger.warning("[creation-log] events batch rejected session=%s: %s", session_id[:8], ve)
        return _err(400, f"이벤트 스키마 위반: {ve}")

    # LYRIC_EDIT 는 세션 내 실존 가사 버전만 허용 (체인 §7.5 보전)
    for it in items:
        if it["type"] == "LYRIC_EDIT":
            try:
                ok = await creation_log.lyrics_version_exists(
                    session_id, it["payload"]["lyrics_version_id"]
                )
            except Exception:
                logger.exception("[creation-log] lyrics version check failed")
                return _err(500, "이벤트 기록에 실패했습니다.")
            if not ok:
                return _err(400, "LYRIC_EDIT.lyrics_version_id가 세션의 가사 버전에 없습니다.")

    # 2) client_seq 순 정렬 (§5.5 — 세션 내 순서 보존, 서버가 seq 부여)
    items.sort(key=lambda it: it["client_seq"])

    accepted = duplicates = 0
    rejected = []
    root_hash = None
    try:
        # FINALIZE 를 경계로 분할 처리 — FINALIZE 이후 이벤트는 거부(§4.2)
        pending: list = []
        finalized = False
        for it in items:
            if finalized:
                rejected.append({"event_id": it["event_id"], "reason": "session finalized"})
                continue
            if it["type"] == "FINALIZE":
                if pending:
                    r = await creation_log.append_batch(session_id, pending)
                    accepted += r["accepted"]
                    duplicates += r["duplicates"]
                    pending = []
                p = it["payload"]
                try:
                    fin = await creation_log.finalize_session(
                        session_id,
                        candidate_id=p["candidate_id"],
                        audio_sha256=p["audio_sha256"],
                        lyrics_version_id=p.get("lyrics_version_id"),
                        trigger=p["trigger"],
                        track_type=p.get("track_type"),
                        actor="user",
                        client_ts=it["client_ts"],
                        event_id=it["event_id"],
                        strict_candidate=True,  # §4.4 서버 검증 — API 경로는 엄격
                    )
                except ValueError as ve:
                    return _err(400, f"FINALIZE 검증 실패: {ve}")
                if fin.get("already_finalized"):
                    rejected.append({"event_id": it["event_id"], "reason": "session finalized"})
                else:
                    accepted += 1
                    root_hash = fin["root_hash"]
                finalized = True
                continue
            pending.append(it)
        if pending:
            r = await creation_log.append_batch(session_id, pending)
            accepted += r["accepted"]
            duplicates += r["duplicates"]
    except Exception:
        logger.exception("[creation-log] events batch append failed session=%s", session_id[:8])
        return _err(500, "이벤트 기록에 실패했습니다.")

    out = {"session_id": session_id, "accepted": accepted, "duplicates": duplicates}
    if rejected:
        out["rejected"] = rejected
    if root_hash:
        out["root_hash"] = root_hash
    logger.info(
        "[creation-log] events batch session=%s accepted=%d dup=%d rejected=%d",
        session_id[:8], accepted, duplicates, len(rejected),
    )
    return out


@router.post("/{session_id}/lyrics", status_code=201)
async def commit_lyrics(session_id: str, body: LyricsCommitBody,
                        current_user=Depends(get_current_user)):
    """가사 버전 커밋(§7.4) — 전문+prev_version_id+source 저장, LYRIC_EDIT 기록.

    origin 토큰 태깅·origin_summary 는 후속 소급 계산(전문 체인 보존으로 §7.3
    규칙이 결정적) — 응답 origin_summary 는 null.
    """
    sess, resp = await _owned_session(session_id, current_user["id"])
    if resp:
        return resp
    if sess["status"] == "FINALIZED":
        return _err(409, "이미 종료(FINALIZED)된 세션입니다. 새 세션을 생성해 주세요.")
    if not (body.text or "").strip():
        return _err(400, "가사 텍스트가 비어 있습니다.")
    if body.source not in creation_log.LYRICS_SOURCES:
        return _err(400, f"source는 {sorted(creation_log.LYRICS_SOURCES)} 중 하나여야 합니다.")
    try:
        client_ts = _parse_client_ts(body.client_ts)
    except ValueError as ve:
        return _err(400, str(ve))
    try:
        res = await creation_log.commit_lyrics_version(
            session_id, body.text, body.source,
            prev_version_id=body.prev_version_id, client_ts=client_ts,
        )
    except ValueError as ve:
        return _err(400, str(ve))
    except Exception:
        logger.exception("[creation-log] lyrics commit failed session=%s", session_id[:8])
        return _err(500, "가사 버전 저장에 실패했습니다.")
    return {
        "lyrics_version_id": res["lyrics_version_id"],
        "origin_summary": None,  # 후속 (F5)
        "seq": res["event"]["seq"],
    }
