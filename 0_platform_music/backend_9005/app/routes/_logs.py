"""
로그 파일 조회 / 수신 API (앱팀 디버깅 전용).

- 서버 실행 시 `run.sh`가 stdout/stderr 로그를 `backend_9004/logs/server.log`에
  타임스탬프와 함께 기록한다. 본 라우터는 해당 파일을 안전하게 조회/다운로드하기
  위한 토큰 기반 GET API 3종(`/tail`, `/download`, `/info`)을 제공한다.
- v46-pre: 프론트엔드 콘솔 로그 원격 수집을 위해 POST `/frontend` 엔드포인트 추가.
  브라우저에서 발생한 console.error / window.onerror / unhandledrejection 등을
  배치로 받아 `backend_9004/logs/frontend.log` 에 1 이벤트 = 1 라인 형식으로 기록.
- GET 계열은 `LOG_ACCESS_TOKEN` 으로 보호 (앱팀 운영용).
- POST `/frontend` 는 일반 사용자 JWT(`get_current_user`) 로 보호 — 로그인한
  사용자라면 누구나 자기 브라우저의 로그를 송신할 수 있고, 익명은 401.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings


logger = logging.getLogger(__name__)

router = APIRouter()

# backend_9004/app/routes/_logs.py → backend_9004/logs/{server,frontend}.log
_LOG_DIR: Path = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_FILE_PATH: Path = _LOG_DIR / "server.log"
FRONTEND_LOG_FILE_PATH: Path = _LOG_DIR / "frontend.log"


def _check_token(header_token: Optional[str], query_token: Optional[str]) -> None:
    """토큰 검증 헬퍼.

    - 서버 설정의 log_access_token이 빈 문자열이면 기능 비활성 (503)
    - 헤더 또는 쿼리 토큰 중 하나라도 일치하면 통과, 아니면 401
    """
    configured = settings.log_access_token
    if not configured:
        raise HTTPException(
            status_code=503,
            detail="로그 조회 API가 비활성화되어 있습니다.",
        )

    provided = header_token or query_token or ""
    if provided != configured:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/tail", response_class=PlainTextResponse)
async def tail_log(
    lines: int = Query(200, ge=1, le=5000),
    token: Optional[str] = Query(None),
    x_log_token: Optional[str] = Header(None, alias="X-Log-Token"),
) -> PlainTextResponse:
    """로그 파일의 마지막 N줄을 plain text로 반환."""
    _check_token(x_log_token, token)

    if not LOG_FILE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="로그 파일이 아직 생성되지 않았습니다.",
        )

    # 대용량 파일 대비 deque로 메모리 효율적 tail
    tail_buf: deque[str] = deque(maxlen=lines)
    with LOG_FILE_PATH.open("r", encoding="utf-8", errors="replace") as fp:
        for line in fp:
            tail_buf.append(line)

    return PlainTextResponse("".join(tail_buf))


@router.get("/download")
async def download_log(
    token: Optional[str] = Query(None),
    x_log_token: Optional[str] = Header(None, alias="X-Log-Token"),
) -> Response:
    """로그 파일 전체를 다운로드.

    FileResponse는 os.stat() 시점의 크기로 Content-Length를 고정하는데,
    로그 파일은 다운로드 중에도 계속 자라므로 h11 LocalProtocolError(
    "Too much data for declared Content-Length")가 발생할 수 있다.
    응답 시점의 바이트 스냅샷을 읽어 Response로 반환하여 이 문제를 피한다.
    """
    _check_token(x_log_token, token)

    if not LOG_FILE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="로그 파일이 아직 생성되지 않았습니다.",
        )

    # 스냅샷: 다운로드 중 파일이 계속 자라더라도 응답 시점의 바이트만 보냄
    data = LOG_FILE_PATH.read_bytes()
    return Response(
        content=data,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="server_9005.log"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/info")
async def log_info(
    token: Optional[str] = Query(None),
    x_log_token: Optional[str] = Header(None, alias="X-Log-Token"),
) -> dict:
    """로그 파일 메타정보."""
    _check_token(x_log_token, token)

    if not LOG_FILE_PATH.exists():
        return {
            "exists": False,
            "size_bytes": 0,
            "modified_at": None,
            "line_count_estimate": 0,
        }

    stat = LOG_FILE_PATH.stat()
    modified_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()

    # 라인 수 추정: 파일을 한 번 순회하여 count. 매우 큰 파일에서는 느릴 수 있어
    # "estimate" 키로 표기한다.
    line_count = 0
    with LOG_FILE_PATH.open("rb") as fp:
        for _ in fp:
            line_count += 1

    return {
        "exists": True,
        "size_bytes": stat.st_size,
        "modified_at": modified_at,
        "line_count_estimate": line_count,
    }


# ---------------------------------------------------------------------------
# v46-pre: 프론트엔드 콘솔 로그 원격 수집
# ---------------------------------------------------------------------------

# 한도 상수 (사양 문서와 일치)
_MAX_BATCH_SIZE = 50
_MAX_MESSAGE_LEN = 8192
_MAX_STACK_LEN = 16384
_MAX_BODY_BYTES = 256 * 1024  # 256KB

# 간이 abuse 추적: user_id → deque[timestamp]. 최근 1분 이벤트 카운트가
# 100 초과면 logger.warning. 메모리 leak 방지를 위해 deque maxlen=200.
_RATE_WINDOW_SEC = 60
_RATE_THRESHOLD = 100
_recent_event_ts: Dict[Any, deque] = {}


class FrontendLogEvent(BaseModel):
    """프론트엔드에서 보낸 1 이벤트.

    필드는 사양상 모두 optional 에 가깝게 받되, 기본값으로 보충한다.
    pydantic 의 추가 검증/길이 제한은 엔드포인트 본문에서 수동 적용.
    """

    level: str = Field(default="info")
    message: str = Field(default="")
    context: Optional[Dict[str, Any]] = Field(default_factory=dict)
    ts: Optional[str] = Field(default=None)
    url: Optional[str] = Field(default=None)
    user_agent: Optional[str] = Field(default=None)
    stack: Optional[str] = Field(default=None)


class FrontendLogBatch(BaseModel):
    events: List[FrontendLogEvent]


def _sanitize_message(msg: str) -> str:
    """메시지 길이 제한 + 개행 한 줄로 압축."""
    if not isinstance(msg, str):
        msg = str(msg)
    if len(msg) > _MAX_MESSAGE_LEN:
        msg = msg[:_MAX_MESSAGE_LEN] + "...[truncated]"
    # 한 줄 형식 유지를 위해 개행 치환
    return msg.replace("\r\n", " ⏎ ").replace("\n", " ⏎ ").replace("\r", " ⏎ ")


def _sanitize_stack(stack: Optional[str]) -> Optional[str]:
    if not stack:
        return None
    if not isinstance(stack, str):
        stack = str(stack)
    if len(stack) > _MAX_STACK_LEN:
        stack = stack[:_MAX_STACK_LEN] + "...[truncated]"
    return stack.replace("\r\n", " ⏎ ").replace("\n", " ⏎ ").replace("\r", " ⏎ ")


def _normalize_level(level: str) -> str:
    if not isinstance(level, str):
        return "info"
    lvl = level.strip().lower()
    if lvl in ("error", "warn", "warning", "info", "debug"):
        # 표기 통일: warn → warn (warning 도 warn 으로 축약)
        return "warn" if lvl == "warning" else lvl
    return "info"


def _record_rate(user_id: Any) -> int:
    """user 의 최근 1분 이벤트 수를 갱신·반환."""
    now = time.time()
    bucket = _recent_event_ts.setdefault(user_id, deque(maxlen=200))
    bucket.append(now)
    # 윈도우 밖 prune
    cutoff = now - _RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    return len(bucket)


def _format_line(user_id: Any, ev: FrontendLogEvent) -> str:
    """1 이벤트를 1 라인으로 직렬화."""
    ts_local = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    level = _normalize_level(ev.level)
    page = (ev.url or "").replace("\n", " ").replace("\r", " ")
    msg = _sanitize_message(ev.message or "")
    ctx_obj = ev.context or {}
    try:
        ctx_json = json.dumps(ctx_obj, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        ctx_json = "{}"
    if len(ctx_json) > _MAX_MESSAGE_LEN:
        ctx_json = ctx_json[:_MAX_MESSAGE_LEN] + "...[truncated]"
    line = (
        f"[{ts_local}] [user_id={user_id}] [{level}] [page={page}] "
        f"{msg} | {ctx_json}"
    )
    stack = _sanitize_stack(ev.stack)
    if stack:
        line = f"{line} | stack={stack}"
    return line + "\n"


@router.post("/frontend")
async def receive_frontend_logs(
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> Dict[str, int]:
    """프론트엔드 console / window error 이벤트 배치를 받아 파일에 append.

    - 인증: JWT (axios 인터셉터가 자동 첨부; sendBeacon 은 ?token=<jwt> 폴백 사용)
    - 검증: events 1~50개, body ≤256KB, message ≤8KB, stack ≤16KB
    - 저장: backend_9004/logs/frontend.log 에 1 이벤트 1 라인
    - 응답: {"received": <int>}
    """
    user_id = current_user.get("id") or current_user.get("user_id") or "unknown"

    # body 크기 사전 점검 (256KB 캡)
    raw_body = await request.body()
    if len(raw_body) > _MAX_BODY_BYTES:
        logger.warning(
            "[FrontendLog] body too large user_id=%s size=%d",
            user_id, len(raw_body),
        )
        raise HTTPException(
            status_code=422,
            detail=f"요청 본문이 너무 큽니다(>{_MAX_BODY_BYTES} bytes).",
        )

    # JSON 파싱 (FastAPI 가 Depends 단계에서 body 를 소비했을 수 있어
    # raw_body 를 직접 디코딩한다)
    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning(
            "[FrontendLog] invalid json user_id=%s err=%s",
            user_id, exc,
        )
        raise HTTPException(status_code=422, detail="JSON 파싱 실패")

    try:
        batch = FrontendLogBatch(**payload)
    except Exception as exc:  # pydantic ValidationError 등
        logger.warning(
            "[FrontendLog] schema validation failed user_id=%s err=%s",
            user_id, exc,
        )
        raise HTTPException(status_code=422, detail="이벤트 스키마 검증 실패")

    n = len(batch.events)
    logger.info(
        "[FrontendLog] received batch user_id=%s batch=%d body_bytes=%d",
        user_id, n, len(raw_body),
    )

    if n < 1:
        logger.warning("[FrontendLog] empty batch user_id=%s", user_id)
        raise HTTPException(status_code=422, detail="events 가 비어 있습니다.")
    if n > _MAX_BATCH_SIZE:
        logger.warning(
            "[FrontendLog] batch too large user_id=%s batch=%d max=%d",
            user_id, n, _MAX_BATCH_SIZE,
        )
        raise HTTPException(
            status_code=422,
            detail=f"이벤트가 너무 많습니다(>{_MAX_BATCH_SIZE}).",
        )

    # rate 추적 (이번 batch 의 모든 이벤트 1개씩 카운팅)
    rate_count = 0
    for _ in range(n):
        rate_count = _record_rate(user_id)
    if rate_count > _RATE_THRESHOLD:
        logger.warning(
            "[FrontendLog] high frequency user_id=%s count_in_60s=%d",
            user_id, rate_count,
        )

    # 디렉토리 보장
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error(
            "[FrontendLog] log dir create failed user_id=%s err=%s",
            user_id, exc,
        )
        raise HTTPException(status_code=500, detail="로그 디렉토리 생성 실패")

    # append 모드로 1번 open → 모든 라인 write
    written = 0
    try:
        with FRONTEND_LOG_FILE_PATH.open("a", encoding="utf-8") as fp:
            for ev in batch.events:
                line = _format_line(user_id, ev)
                fp.write(line)
                written += 1
    except OSError as exc:
        logger.error(
            "[FrontendLog] file write failed user_id=%s path=%s written=%d err=%s",
            user_id, FRONTEND_LOG_FILE_PATH, written, exc,
        )
        raise HTTPException(status_code=500, detail="로그 파일 기록 실패")
    except Exception:
        logger.exception(
            "[FrontendLog] unexpected error user_id=%s batch=%d",
            user_id, n,
        )
        raise HTTPException(status_code=500, detail="알 수 없는 서버 오류")

    logger.info(
        "[FrontendLog] batch stored user_id=%s written=%d",
        user_id, written,
    )
    return {"received": written}
