"""
로그 파일 조회 API (앱팀 디버깅 전용).

- 서버 실행 시 `run.sh`가 stdout/stderr 로그를 `backend_9003/logs/server.log`에
  타임스탬프와 함께 기록한다. 본 라우터는 해당 파일을 안전하게 조회/다운로드하기
  위한 토큰 기반 API 3종을 제공한다.
- `settings.log_access_token`이 비어있으면 기능 자체를 비활성화(503)한다.
- 인증은 `X-Log-Token` 헤더 또는 `?token=` 쿼리 중 하나가 일치하면 통과.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import PlainTextResponse, Response

from ..config import settings


router = APIRouter()

# backend_9003/app/routes/_logs.py → backend_9003/logs/server.log
LOG_FILE_PATH: Path = (
    Path(__file__).resolve().parent.parent.parent / "logs" / "server.log"
)


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
            "Content-Disposition": 'attachment; filename="server_9003.log"',
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
