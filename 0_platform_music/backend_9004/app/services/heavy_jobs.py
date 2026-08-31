"""
v205: 무거운 백그라운드 작업 동시 실행 상한 (세마포어 대기표).

박자 분석(madmom)·공유영상 생성(ffmpeg) 같은 CPU 무거운 하청 작업이
t3.large(2 vCPU)에서 러시로 몰릴 때 전 작업이 함께 저하되는 것을 막는다.

핵심 설계 결정 (PLAN v205 §0):
- 작업들이 서로 다른 이벤트 루프/스레드에서 돈다 (BackgroundTasks 의
  스레드풀 스레드 자체 루프, asyncio.to_thread 워커 스레드, 메인 루프).
  → 루프에 귀속되는 asyncio.Semaphore 는 작동 불능.
  → 프로세스 전역 threading.BoundedSemaphore 채택.

🔴 안전 수칙: heavy_job_slot 의 acquire 는 블로킹이다.
   반드시 워커 스레드 안에서만 진입할 것 — 메인 이벤트 루프에서
   호출하면 대기 동안 서버 전체가 멈춘다.

로그 추적자 `[heavy]`: wait(진입, 현재 점유 수) / start(획득, 대기 시간) /
done(해제, 점유 시간). "wait 후 start 지연" 발생 자체가 러시 관측 지표.
상한 조정: env HEAVY_JOB_CONCURRENCY (config.heavy_job_concurrency, 기본 2).
"""
import logging
import threading
import time
from contextlib import contextmanager

from ..config import settings

logger = logging.getLogger(__name__)

_semaphore = threading.BoundedSemaphore(settings.heavy_job_concurrency)

# active 카운트는 세마포어 내부값(_value) 직접 접근 대신 자체 카운터로 (락 보호).
_active_lock = threading.Lock()
_active_count = 0


def _active() -> int:
    with _active_lock:
        return _active_count


@contextmanager
def heavy_job_slot(name: str, job_id: str = ""):
    """무거운 작업 슬롯 컨텍스트 매니저 (블로킹 — 워커 스레드 전용).

    with heavy_job_slot("beat_extraction", track_id):
        ... CPU 무거운 작업 ...

    예외가 나도 finally 로 반드시 release 되어 슬롯 누수가 없다.
    """
    global _active_count

    logger.info("[heavy] wait name=%s job=%s active=%d", name, job_id, _active())
    wait_started = time.monotonic()
    _semaphore.acquire()  # 블로킹 — 워커 스레드 안에서만 (모듈 docstring 안전 수칙)
    with _active_lock:
        _active_count += 1
    logger.info(
        "[heavy] start name=%s job=%s waited=%.1fs",
        name, job_id, time.monotonic() - wait_started,
    )
    held_started = time.monotonic()
    try:
        yield
    finally:
        with _active_lock:
            _active_count -= 1
        _semaphore.release()
        logger.info(
            "[heavy] done name=%s job=%s held=%.1fs",
            name, job_id, time.monotonic() - held_started,
        )
