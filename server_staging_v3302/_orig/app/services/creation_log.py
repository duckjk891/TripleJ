"""v3.200 — Phase 0 창작 기록 계층 (Creation Record Layer) 핵심 서비스.

요구사항 원문: Phase0_창작기록계층_개발요구사항.md (v1.0)
- 해시 체인 규칙 §5.3 · 부록 B 참고 구현 **그대로** (canonical = RFC 8785 근사:
  sort_keys + separators(",",":") + ensure_ascii=False + UTF-8. 완전한 RFC 8785
  구현(숫자 표기 정규화 등)은 아니지만, 서버가 생성·검증을 모두 수행하므로
  json.dumps 규칙 고정만으로 결정적(deterministic)이다 — 명시 주석).
- seq·server_ts·해시는 전부 서버 부여 (§5.3). 앱은 이벤트 내용만 보낸다.
- append-only: 이 모듈은 events 에 INSERT 만 수행한다. UPDATE/DELETE 권한 회수
  (전용 INSERT/SELECT 계정 분리, §5.4)는 prod 운영 변경이라 **후속 사이클**
  (사용자 승인 필요 — maidol-admin-web 메모 규칙). 코드 관행으로 먼저 지킨다.

커넥션 전략 — 이 모듈은 항상 **직접 asyncpg.connect()** 를 쓴다 (풀 미사용).
이유: 작곡 배경 작업(routes/generate.py `_run_music_generation`)은 자체 이벤트
루프에서 돌아 메인 루프에 묶인 app.database.postgres._pool 을 쓸 수 없다
(루프-로컬 motor 주입과 같은 문제). 이벤트 볼륨(월 생성 ~5건, 곡당 수십 건)
에서 per-call connect 비용은 무시 가능 — 단순함·루프 안전을 택한다.
민감정보 로그 금지: [creation-log] 로그에는 id·seq·해시 앞부분만 남긴다.
"""
import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)

GENESIS_HASH = "0" * 64  # 세션 첫 이벤트의 prev_hash (§5.3)

EVENT_TYPES = {
    "SESSION_START", "GEN_REQUEST", "GEN_RESPONSE",
    "LISTEN", "CANDIDATE_SELECT", "LYRIC_EDIT", "FINALIZE",
}
LYRICS_SOURCES = {"ai_draft", "user_edit", "engine_returned"}


# ─── 부록 B 참고 구현 (그대로) ───────────────────────────────────────────────

def canonical(obj) -> bytes:
    """canonical JSON — RFC 8785(JCS) 근사: 키 오름차순·공백 없음·UTF-8.

    부록 B 원문 그대로. 숫자 표기까지 정규화하는 완전한 JCS 는 아니므로
    payload 에는 int/str/bool/null/list/dict 만 넣는다 (float 지양 — duration 은
    ms 정수). 서버가 기록·검증을 모두 수행하므로 이 규칙 고정으로 결정적.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def event_hash(session_id, seq, etype, actor, server_ts, payload, prev_hash) -> str:
    """event_hash = SHA256(session_id \\n seq \\n type \\n actor \\n server_ts
    \\n payload_hash \\n prev_hash) — §5.3, 구분자 '\\n', 순서 고정."""
    payload_hash = sha256_hex(canonical(payload))
    material = "\n".join([session_id, str(seq), etype, actor, server_ts, payload_hash, prev_hash]).encode("utf-8")
    return sha256_hex(material)


def verify_chain(events):
    """events: seq 오름차순 dict 목록(저장된 event_hash 포함) → (ok, broken_seq)."""
    prev = GENESIS_HASH
    for e in events:
        h = event_hash(e["session_id"], e["seq"], e["type"], e["actor"], e["server_ts"], e["payload"], prev)
        if h != e["event_hash"]:
            return False, e["seq"]
        prev = h
    return True, None


# ─── 서버 유틸 ───────────────────────────────────────────────────────────────

def ts_str(dt: datetime) -> str:
    """server_ts 의 해시용 문자열 표기 — UTC 마이크로초 6자리 고정.

    events.server_ts 는 TIMESTAMPTZ 로 저장되고 PG 는 마이크로초 정밀도를
    보존하므로, 검증 시 저장된 datetime 을 이 함수로 다시 문자열화하면
    기록 시점과 바이트 단위로 동일하다 (밀리초 절삭 금지 — 왕복 손실 방지).
    """
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def user_id_hash(user_id: str) -> str:
    """user_id_hash = SHA256(user_id + 서버 salt) — 원 user_id 는 로그에 넣지 않는다(§4.2).

    salt 는 .env CREATION_LOG_SALT (신설). 미설정이면 jwt_secret 폴백 + 경고 —
    폴백 배포 후 salt 를 나중에 넣으면 기존 세션과 해시가 어긋나므로
    배포 전 .env 설정이 원칙 (오케스트레이터 체크리스트 항목).
    """
    from ..config import settings
    salt = settings.creation_log_salt
    if not salt:
        logger.warning("[creation-log] CREATION_LOG_SALT unset — falling back to jwt_secret (set it before prod)")
        salt = settings.jwt_secret
    return sha256_hex((str(user_id) + salt).encode("utf-8"))


async def _connect() -> asyncpg.Connection:
    """루프-로컬 직접 커넥션 (모듈 docstring 의 커넥션 전략 참조)."""
    from ..config import settings
    return await asyncpg.connect(settings.postgres_dsn)


def _jsonb(obj) -> str:
    """asyncpg 는 codec 미설정 시 JSONB 파라미터로 str 를 기대한다."""
    return json.dumps(obj, ensure_ascii=False)


def _from_jsonb(v):
    if isinstance(v, str):
        return json.loads(v)
    return v


# ─── 스키마 (main.py lifespan 멱등 마이그레이션에서 호출) ────────────────────

async def ensure_schema(conn) -> None:
    """PG `creation_log` 스키마 — sessions·events(§5.4 컬럼 전부, UNIQUE(session_id,seq))
    ·lyrics_versions. CREATE IF NOT EXISTS 멱등 (main.py lifespan 관례).

    ⚠️ 권한 분리(§5.4 — 앱 DB 계정에서 events UPDATE/DELETE 회수, 전용
    INSERT/SELECT 계정)는 prod 운영 변경이라 후속 사이클(사용자 승인 필요).
    Phase 0 코드에서는 이 모듈이 INSERT 외 어떤 변경도 하지 않는 것으로 지킨다.
    """
    await conn.execute("CREATE SCHEMA IF NOT EXISTS creation_log")
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS creation_log.sessions ("
        "session_id UUID PRIMARY KEY, "
        "user_id_hash VARCHAR(64) NOT NULL, "
        "status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE', "  # ACTIVE|FINALIZED|ABANDONED(후속 배치)
        "parent_session_id UUID, "
        "started_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "finalized_at TIMESTAMPTZ, "
        "root_hash VARCHAR(64), "
        "final_candidate_id TEXT, "
        "final_lyrics_version_id UUID, "
        "app_version TEXT, "
        "import_blocked BOOLEAN NOT NULL DEFAULT FALSE, "
        "criteria_version TEXT)"  # Phase 1 에서 채움 — 필드만 예약(§4.2)
    )
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS creation_log.events ("
        "event_id UUID PRIMARY KEY, "
        "session_id UUID NOT NULL, "
        "seq INT NOT NULL, "
        "type VARCHAR(20) NOT NULL, "
        "actor VARCHAR(20) NOT NULL, "
        "client_ts TIMESTAMPTZ, "
        "server_ts TIMESTAMPTZ NOT NULL, "
        "target JSONB, "
        "payload JSONB NOT NULL, "
        "payload_hash VARCHAR(64) NOT NULL, "
        "prev_hash VARCHAR(64) NOT NULL, "
        "event_hash VARCHAR(64) NOT NULL, "
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "UNIQUE(session_id, seq))"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS creation_log_events_session "
        "ON creation_log.events(session_id, seq)"
    )
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS creation_log.lyrics_versions ("
        "lyrics_version_id UUID PRIMARY KEY, "
        "session_id UUID NOT NULL, "
        "prev_version_id UUID, "
        "source VARCHAR(20) NOT NULL, "  # ai_draft|user_edit|engine_returned (§7.3)
        "text TEXT NOT NULL, "
        "origin_summary JSONB, "  # 토큰 origin 태깅은 후속 소급 계산 — 지금은 NULL
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    )


# ─── 이벤트 append (해시 체인 — seq 서버 부여) ──────────────────────────────

async def _append_on_conn(conn, session_id: str, etype: str, actor: str,
                          payload: dict, target: dict = None,
                          client_ts: datetime = None, event_id: str = None) -> dict:
    """한 커넥션 위에서 이벤트 1건 append. 호출측이 트랜잭션/락을 관리한다.

    전제: 호출 전에 같은 트랜잭션에서 세션 advisory lock 획득(_lock_session).
    반환: {event_id, seq, event_hash, duplicate(bool)}.
    """
    event_id = event_id or str(uuid.uuid4())
    # idempotent — event_id 중복 수신 무시 (§5.5)
    dup = await conn.fetchrow(
        "SELECT seq, event_hash FROM creation_log.events WHERE event_id=$1", event_id
    )
    if dup:
        return {"event_id": event_id, "seq": dup["seq"], "event_hash": dup["event_hash"], "duplicate": True}

    last = await conn.fetchrow(
        "SELECT seq, event_hash FROM creation_log.events "
        "WHERE session_id=$1 ORDER BY seq DESC LIMIT 1",
        session_id,
    )
    seq = (last["seq"] + 1) if last else 1
    prev_hash = last["event_hash"] if last else GENESIS_HASH

    server_dt = datetime.now(timezone.utc)
    server_ts = ts_str(server_dt)
    payload_hash = sha256_hex(canonical(payload))
    ev_hash = event_hash(session_id, seq, etype, actor, server_ts, payload, prev_hash)

    await conn.execute(
        "INSERT INTO creation_log.events "
        "(event_id, session_id, seq, type, actor, client_ts, server_ts, "
        " target, payload, payload_hash, prev_hash, event_hash) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        event_id, session_id, seq, etype, actor, client_ts, server_dt,
        _jsonb(target) if target is not None else None, _jsonb(payload),
        payload_hash, prev_hash, ev_hash,
    )
    logger.info(
        "[creation-log] append session=%s seq=%d type=%s hash=%s..",
        session_id[:8], seq, etype, ev_hash[:12],
    )
    return {"event_id": event_id, "seq": seq, "event_hash": ev_hash, "duplicate": False}


async def _lock_session(conn, session_id: str) -> None:
    """세션당 seq 직렬화 — 트랜잭션 스코프 advisory lock (커밋 시 자동 해제)."""
    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext('creation_log'))",
        session_id,
    )


async def append_event(session_id: str, etype: str, actor: str, payload: dict,
                       target: dict = None, client_ts: datetime = None,
                       event_id: str = None) -> dict:
    """단건 append (자체 커넥션+트랜잭션). 서버 발생 이벤트(GEN_REQUEST 등)용."""
    conn = await _connect()
    try:
        async with conn.transaction():
            await _lock_session(conn, session_id)
            return await _append_on_conn(
                conn, session_id, etype, actor, payload,
                target=target, client_ts=client_ts, event_id=event_id,
            )
    finally:
        await conn.close()


# ─── 세션 생명주기 ───────────────────────────────────────────────────────────

async def create_session(user_id: str, app_version: str = None, platform: str = None,
                         engine_list: list = None, parent_session_id: str = None) -> str:
    """세션 생성 + SESSION_START 기록(§4.2). 반환: session_id.

    import_blocked=false — 실측(§1): 참고 음악 업로드(/generate/upload-reference/,
    v3.91)가 존재하므로 문서 §4.3 의 '반입 경로 없음' 전제가 현재 앱에 성립하지
    않는다. 허위 플래그 금지 — 참고음악 사용 사실은 GEN_REQUEST 의
    request_body(uploadUrl)와 generations doc 의 reference_audio_url 로 남는다.
    """
    session_id = str(uuid.uuid4())
    uid_hash = user_id_hash(user_id)
    engine_list = engine_list or [{"engine": "suno", "model": None}]
    conn = await _connect()
    try:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO creation_log.sessions "
                "(session_id, user_id_hash, status, parent_session_id, app_version, import_blocked) "
                "VALUES ($1,$2,'ACTIVE',$3,$4,FALSE)",
                session_id, uid_hash, parent_session_id, app_version,
            )
            await _lock_session(conn, session_id)
            await _append_on_conn(
                conn, session_id, "SESSION_START", "server",
                payload={
                    "app_version": app_version,
                    "platform": platform,
                    "engine_list": engine_list,
                    "user_id_hash": uid_hash,
                    "import_blocked": False,
                    "criteria_version": None,
                },
            )
    finally:
        await conn.close()
    logger.info("[creation-log] session created id=%s parent=%s", session_id[:8],
                (parent_session_id or "-")[:8])
    return session_id


async def get_session(session_id: str) -> dict:
    conn = await _connect()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM creation_log.sessions WHERE session_id=$1", session_id
        )
        return dict(row) if row else None
    finally:
        await conn.close()


async def ensure_session(session_id, user_id: str, app_version: str = None,
                         platform: str = None) -> str:
    """생성 요청용 세션 확보 (하위호환 §6 — 문서 §4.4 '세션 없이 생성 거부'의 취지 유지).

    - session_id 가 유효(존재·본인 소유·ACTIVE)하면 그대로 사용.
    - 없거나(구버전 앱) 무효/타인 소유면 서버가 세션 자동 생성.
    - FINALIZED 면 parent_session_id 로 잇는 새 세션 생성(§4.1 재편집 규칙).
    실패 시 예외 — 호출측(generate.py)이 best-effort 로 삼킨다.
    """
    if session_id:
        try:
            sess = await get_session(str(session_id))
        except Exception:
            sess = None
        if sess and sess["user_id_hash"] == user_id_hash(user_id):
            if sess["status"] == "ACTIVE":
                return str(sess["session_id"])
            if sess["status"] == "FINALIZED":
                return await create_session(
                    user_id, app_version=app_version, platform=platform,
                    parent_session_id=str(sess["session_id"]),
                )
        logger.warning("[creation-log] ensure_session: given id invalid/foreign — creating new")
    return await create_session(user_id, app_version=app_version, platform=platform)


async def candidate_exists(session_id: str, candidate_id: str, conn=None) -> bool:
    """§4.4 — candidate_id 가 같은 세션의 GEN_RESPONSE 후보에 존재하는지."""
    own = conn is None
    if own:
        conn = await _connect()
    try:
        rows = await conn.fetch(
            "SELECT payload FROM creation_log.events "
            "WHERE session_id=$1 AND type='GEN_RESPONSE'",
            session_id,
        )
        for r in rows:
            payload = _from_jsonb(r["payload"])
            for c in payload.get("candidates") or []:
                if c.get("candidate_id") == candidate_id:
                    return True
        return False
    finally:
        if own:
            await conn.close()


async def finalize_session(session_id: str, candidate_id: str, audio_sha256: str,
                           lyrics_version_id: str = None, trigger: str = "publish",
                           track_type: str = None, actor: str = "user",
                           client_ts: datetime = None, event_id: str = None,
                           strict_candidate: bool = False) -> dict:
    """FINALIZE 이벤트 + 세션 FINALIZED 전이 + root_hash 확정(§4.2·§5.3).

    strict_candidate=True(POST /sessions/{id}/events 경로)면 후보 미존재 시
    ValueError. False(tracks upload-from-generation 훅)면 경고 로그만 남기고
    기록은 진행 — 구버전 앱 호환(완전 검증은 후속, PLAN §4-5).
    반환: {event, root_hash}. 이미 FINALIZED 면 {"already_finalized": True}.
    """
    conn = await _connect()
    try:
        async with conn.transaction():
            await _lock_session(conn, session_id)
            sess = await conn.fetchrow(
                "SELECT status FROM creation_log.sessions WHERE session_id=$1 FOR UPDATE",
                session_id,
            )
            if not sess:
                raise ValueError("session not found")
            if sess["status"] == "FINALIZED":
                logger.warning("[creation-log] finalize skipped — already FINALIZED session=%s", session_id[:8])
                return {"already_finalized": True}

            found = await candidate_exists(session_id, candidate_id, conn=conn)
            if not found:
                msg = f"candidate {candidate_id} not found in session GEN_RESPONSE"
                if strict_candidate:
                    raise ValueError(msg)
                logger.warning("[creation-log] finalize: %s (recording anyway — BC)", msg)

            payload = {
                "candidate_id": candidate_id,
                "audio_sha256": audio_sha256,
                "lyrics_version_id": lyrics_version_id,
                "trigger": trigger,
            }
            if track_type:
                payload["track_type"] = track_type  # v3.200 ②: 발매 트랙 유형 (standard)
            ev = await _append_on_conn(
                conn, session_id, "FINALIZE", actor, payload,
                target={"candidate_id": candidate_id, "segment": None, "item": None},
                client_ts=client_ts, event_id=event_id,
            )
            await conn.execute(
                "UPDATE creation_log.sessions SET status='FINALIZED', finalized_at=now(), "
                "root_hash=$2, final_candidate_id=$3, final_lyrics_version_id=$4 "
                "WHERE session_id=$1",
                session_id, ev["event_hash"], candidate_id, lyrics_version_id,
            )
            logger.info(
                "[creation-log] FINALIZED session=%s root=%s.. candidate=%s",
                session_id[:8], ev["event_hash"][:12], candidate_id,
            )
            return {"event": ev, "root_hash": ev["event_hash"]}
    finally:
        await conn.close()


# ─── 가사 버전 (F5 — 이번 슬라이스는 전문 버전 체인만, origin 태깅 후속) ─────

async def commit_lyrics_version(session_id: str, text: str, source: str,
                                prev_version_id: str = None,
                                client_ts: datetime = None) -> dict:
    """가사 버전 전문 저장 + LYRIC_EDIT 이벤트(§7.4).

    diff_hash — 토큰 diff 계산은 후속(소급 가능: 버전 전문 체인 보존됨).
    지금은 (이전 전문, 새 전문) 쌍의 canonical 해시로 결정적 정의:
    sha256(canonical({"prev": prev_text or "", "new": text})).
    origin_summary — 후속 소급 계산: NULL.
    반환: {lyrics_version_id, event}.
    """
    if source not in LYRICS_SOURCES:
        raise ValueError(f"invalid source: {source}")
    lyrics_version_id = str(uuid.uuid4())
    conn = await _connect()
    try:
        async with conn.transaction():
            await _lock_session(conn, session_id)
            prev_text = ""
            if prev_version_id:
                prev = await conn.fetchrow(
                    "SELECT text FROM creation_log.lyrics_versions "
                    "WHERE lyrics_version_id=$1 AND session_id=$2",
                    prev_version_id, session_id,
                )
                if not prev:
                    raise ValueError("prev_version_id not found in session")
                prev_text = prev["text"]
            await conn.execute(
                "INSERT INTO creation_log.lyrics_versions "
                "(lyrics_version_id, session_id, prev_version_id, source, text, origin_summary) "
                "VALUES ($1,$2,$3,$4,$5,NULL)",
                lyrics_version_id, session_id, prev_version_id, source, text,
            )
            diff_hash = sha256_hex(canonical({"prev": prev_text, "new": text}))
            ev = await _append_on_conn(
                conn, session_id, "LYRIC_EDIT",
                "user" if source == "user_edit" else "server",
                payload={
                    "lyrics_version_id": lyrics_version_id,
                    "prev_lyrics_version_id": prev_version_id,
                    "diff_hash": diff_hash,
                    "origin_summary": None,  # 후속 소급 계산 (F5 토큰 태깅)
                    "source": source,
                },
                client_ts=client_ts,
            )
    finally:
        await conn.close()
    logger.info(
        "[creation-log] lyrics version session=%s id=%s source=%s len=%d",
        session_id[:8], lyrics_version_id[:8], source, len(text),
    )
    return {"lyrics_version_id": lyrics_version_id, "event": ev}


async def lyrics_version_exists(session_id: str, lyrics_version_id: str) -> bool:
    conn = await _connect()
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM creation_log.lyrics_versions "
            "WHERE lyrics_version_id=$1 AND session_id=$2",
            lyrics_version_id, session_id,
        )
        return bool(row)
    finally:
        await conn.close()


# ─── 앱 이벤트 배치 수신 (routes/sessions.py 가 검증 후 호출) ────────────────

async def append_batch(session_id: str, items: list) -> dict:
    """검증 완료된 앱 이벤트 배치를 client_seq 순으로 append (§5.5).

    items: [{event_id, client_seq, type, actor, client_ts, target, payload}]
    (client_seq 오름차순 정렬은 호출측 완료). FINALIZE 는 이 함수가 아니라
    호출측(routes/sessions.py)이 finalize_session 으로 처리한다.
    반환: {accepted, duplicates, last_seq}.
    """
    accepted = duplicates = 0
    last_seq = None
    conn = await _connect()
    try:
        async with conn.transaction():
            await _lock_session(conn, session_id)
            for it in items:
                res = await _append_on_conn(
                    conn, session_id, it["type"], it.get("actor", "user"),
                    it["payload"], target=it.get("target"),
                    client_ts=it.get("client_ts"), event_id=it["event_id"],
                )
                if res["duplicate"]:
                    duplicates += 1
                else:
                    accepted += 1
                    last_seq = res["seq"]
    finally:
        await conn.close()
    return {"accepted": accepted, "duplicates": duplicates, "last_seq": last_seq}


# ─── F1 헬퍼 — 엔진 요청 canonical 해시 (is_regeneration_of 판정용) ──────────

# §3.3 — 매 호출마다 달라지거나 재현성과 무관한 필드를 제외하고 해시.
# 현 Suno body 실측: seed 없음, 시각 필드 없음 → callBackUrl 만 제외 대상.
REQUEST_HASH_EXCLUDE = {"callBackUrl"}


def request_body_hash(body: dict) -> str:
    filtered = {k: v for k, v in body.items() if k not in REQUEST_HASH_EXCLUDE}
    return sha256_hex(canonical(filtered))
