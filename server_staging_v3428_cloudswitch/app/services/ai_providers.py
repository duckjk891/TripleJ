"""v3.428 클라우드 결제 전환 — AI 공급 경로 스위치 (옛 경로 / 새 경로).

기본값은 모두 **지금 운영 경로**라서 환경변수를 바꾸지 않으면 동작이 이전과 같다.

  CLAUDE_PROVIDER = anthropic | vertex   (vertex: GCP_PROJECT_ID·VERTEX_REGION, 인증=ADC 서비스 계정)
  GEMINI_PROVIDER = aistudio  | vertex   (vertex: VERTEX_API_KEY 익스프레스 키, 모델 치환=VERTEX_GEMINI_MODEL_MAP)
  GEMINI_VERTEX_RATIO = 0~100 (기본 0)    호출마다 이 비율만큼만 Vertex 로 보냄. GEMINI_PROVIDER=vertex 는 100 과 같음
  GEMINI_AISTUDIO_FALLBACK = true        Vertex 가 429·5xx·시간 초과면 AI Studio 로 한 번 재시도
                                         (GOOGLE_API_KEY 가 있을 때만. 안전 거절·4xx 는 넘기지 않음)
  OPENAI_PROVIDER = openai    | azure    (azure: AZURE_OPENAI_ENDPOINT·AZURE_OPENAI_API_KEY,
                                          Azure 배포 이름을 지금 모델 이름과 똑같이 만든다)
  AI_429_ALERT_THRESHOLD / AI_429_ALERT_WINDOW_SEC
                                         공급자별 429 가 창(기본 300초) 안에 기준(기본 10건) 이상이면 경고 로그
  AI_429_ALERT_EMAIL                     (선택) 비어 있지 않으면 같은 경고를 SES 메일로도 보냄. 기본 = 로그만
  임베딩 모델 = EMBEDDING_MODEL (기본 text-embedding-3-small, 1536차원 — 바꾸면 벡터 전부 재생성 필요)
  fal = FAL_API_KEY 만 마켓플레이스 키로 교체 (코드 변경 없음)

스위치는 컨테이너 기동 시 한 번 읽는다(서비스별 클라이언트가 싱글톤). 바꾼 뒤에는 재기동.
"""
import asyncio
import collections
import logging
import random
import re
import threading
import time
from typing import Deque, Dict, Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_AISTUDIO_MODEL_URL = re.compile(
    r"^https://generativelanguage\.googleapis\.com/v1beta/models/([^:/]+):([A-Za-z]+)$"
)


def _norm(v: Optional[str], default: str) -> str:
    return (v or default).strip().lower()


def claude_provider() -> str:
    return _norm(settings.claude_provider, "anthropic")


def gemini_provider() -> str:
    return _norm(settings.gemini_provider, "aistudio")


def openai_provider() -> str:
    return _norm(settings.openai_provider, "openai")


# ── 429 급증 알림 ─────────────────────────────────────────────────────────────
# 공급자별 429 응답 시각을 창(window) 안에서만 세고, 기준 이상이면 경고 로그(창마다 최대 1번).
# 동작(재시도·실패)은 바꾸지 않는다. 관리자 알림 경로는 따로 없어서 기본은 로그만,
# AI_429_ALERT_EMAIL 이 있으면 기존 SES 메일러(mailer._try_send)로 같은 내용을 보낸다.

_rl_lock = threading.Lock()
_rl_hits: Dict[str, Deque[float]] = collections.defaultdict(collections.deque)
_rl_last_alert: Dict[str, float] = {}


def _rl_config():
    try:
        threshold = max(1, int(getattr(settings, "ai_429_alert_threshold", 10) or 10))
    except (TypeError, ValueError):
        threshold = 10
    try:
        window = max(10, int(getattr(settings, "ai_429_alert_window_sec", 300) or 300))
    except (TypeError, ValueError):
        window = 300
    return threshold, window


def rate_limit_counts() -> Dict[str, int]:
    """지금 창 안의 공급자별 429 건수(점검·시험용)."""
    _, window = _rl_config()
    now = time.monotonic()
    with _rl_lock:
        out = {}
        for name, dq in _rl_hits.items():
            while dq and dq[0] < now - window:
                dq.popleft()
            out[name] = len(dq)
        return out


def record_rate_limit(provider: str, now: Optional[float] = None) -> bool:
    """429 한 건 기록. 이번 호출로 경고를 냈으면 True."""
    threshold, window = _rl_config()
    now = time.monotonic() if now is None else now
    with _rl_lock:
        dq = _rl_hits[provider]
        dq.append(now)
        while dq and dq[0] < now - window:
            dq.popleft()
        count = len(dq)
        last = _rl_last_alert.get(provider)
        if count < threshold or (last is not None and now - last < window):
            return False
        _rl_last_alert[provider] = now
    msg = "[ai-429-alert] provider={} 429 {}건 / 최근 {}초 (기준 {}건)".format(
        provider, count, window, threshold)
    logger.warning(msg)
    _send_429_mail(provider, msg)
    return True


def _send_429_mail(provider: str, msg: str) -> None:
    to = (getattr(settings, "ai_429_alert_email", "") or "").strip()
    if not to:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # 이벤트 루프 밖(시험 등)에서는 로그만
    try:
        from .mailer import _try_send
        loop.create_task(_try_send(to, "[MAIDOL] AI 429 급증 - {}".format(provider), msg + "\n", "ai_429_alert"))
    except Exception as e:  # 알림 실패가 본 요청을 막으면 안 됨
        logger.warning("[ai-429-alert] mail schedule failed: %s", type(e).__name__)


def _watch_429(client, provider: str):
    """SDK 클라이언트 내부 httpx 에 응답 훅만 덧붙여 429 를 센다(SDK 재시도 포함 실제 응답 수).

    클라이언트 생성 방식·타임아웃·재시도는 그대로. 훅을 못 붙이면 조용히 건너뛴다.
    """
    async def _hook(resp):
        if resp.status_code == 429:
            record_rate_limit(provider)

    try:
        inner = getattr(client, "_client", None)
        if isinstance(inner, httpx.AsyncClient):
            hooks = dict(inner.event_hooks)
            hooks["response"] = list(hooks.get("response", [])) + [_hook]
            inner.event_hooks = hooks
    except Exception:
        pass
    return client


# ── Claude ────────────────────────────────────────────────────────────────────

def make_anthropic_client(**kwargs):
    """AsyncAnthropic(옛) 또는 AsyncAnthropicVertex(새). timeout·max_retries 등은 그대로 전달.

    Vertex 에서도 모델 ID 는 그대로(claude-opus-4-6 등, 날짜 접미사 없음).
    """
    import anthropic

    if claude_provider() == "vertex":
        logger.info("[ai_providers] claude=vertex project=%s region=%s",
                    settings.gcp_project_id, settings.vertex_region)
        return _watch_429(anthropic.AsyncAnthropicVertex(
            project_id=settings.gcp_project_id,
            region=settings.vertex_region or "global",
            **kwargs,
        ), "claude-vertex")
    return _watch_429(anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, **kwargs),
                      "claude-anthropic")


# ── OpenAI ────────────────────────────────────────────────────────────────────

def _azure_base() -> str:
    return settings.azure_openai_endpoint.rstrip("/") + "/openai/v1/"


def make_openai_client(**kwargs):
    """AsyncOpenAI — 옛: api.openai.com / 새: Azure OpenAI v1 엔드포인트(같은 SDK, 같은 호출 형식)."""
    from openai import AsyncOpenAI

    if openai_provider() == "azure":
        key = settings.azure_openai_api_key
        return _watch_429(AsyncOpenAI(
            api_key=key,
            base_url=_azure_base(),
            default_headers={"api-key": key},
            **kwargs,
        ), "openai-azure")
    return _watch_429(AsyncOpenAI(api_key=settings.openai_api_key, **kwargs), "openai")


def openai_images_url(kind: str) -> str:
    """kind = generations | edits (openai_image.py 의 httpx 직접 호출용)."""
    if openai_provider() == "azure":
        return _azure_base() + "images/" + kind
    return "https://api.openai.com/v1/images/" + kind


def openai_auth_headers() -> Dict[str, str]:
    if openai_provider() == "azure":
        key = settings.azure_openai_api_key
        return {"api-key": key, "Authorization": "Bearer {}".format(key)}
    return {"Authorization": "Bearer {}".format(settings.openai_api_key)}


def openai_configured() -> bool:
    if openai_provider() == "azure":
        return bool(settings.azure_openai_endpoint and settings.azure_openai_api_key)
    return bool(settings.openai_api_key)


# ── Gemini (REST) ─────────────────────────────────────────────────────────────

def _gemini_model_map() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for pair in (settings.vertex_gemini_model_map or "").split(","):
        if "=" in pair:
            a, b = pair.split("=", 1)
            if a.strip() and b.strip():
                out[a.strip()] = b.strip()
    return out


_GEMINI_TRANSIENT = (429, 500, 502, 503, 504)


def gemini_vertex_ratio() -> int:
    """Vertex 로 보낼 비율(0~100). GEMINI_PROVIDER=vertex 는 100 으로 해석."""
    if gemini_provider() == "vertex":
        return 100
    try:
        r = int(float(getattr(settings, "gemini_vertex_ratio", 0) or 0))
    except (TypeError, ValueError):
        r = 0
    return max(0, min(100, r))


def _vertex_url(url: str) -> Optional[str]:
    m = _AISTUDIO_MODEL_URL.match(url)
    if not m:
        return None
    model, method = m.group(1), m.group(2)
    model = _gemini_model_map().get(model, model)
    return "https://aiplatform.googleapis.com/v1/publishers/google/models/{}:{}".format(model, method)


def pick_gemini_route(url: str) -> str:
    """호출 한 번의 경로: 'vertex' | 'aistudio'. 모델 URL 이 아니면 항상 aistudio."""
    r = gemini_vertex_ratio()
    if r <= 0 or _vertex_url(url) is None:
        return "aistudio"
    if r >= 100:
        return "vertex"
    return "vertex" if random.random() * 100 < r else "aistudio"


def _aistudio_fallback_ok() -> bool:
    return bool(getattr(settings, "gemini_aistudio_fallback", True)) and bool(settings.google_api_key)


async def gemini_post(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """Gemini REST POST 한 번. url 은 AI Studio 모델 URL 을 그대로 넘긴다.

    - 비율에 따라 이번 호출 경로를 고른다(0% = 예전과 똑같은 요청).
    - Vertex 가 429·5xx·시간 초과면 AI Studio 로 딱 한 번 재시도(GOOGLE_API_KEY 있을 때만).
    - 그 밖의 응답(200 안의 안전 차단, 400 등)은 그대로 돌려준다 — 모델·경로 우회 금지(v3.377).
    호출부의 기존 재시도·오류 처리는 이 응답을 받아 예전처럼 동작한다.
    """
    route = pick_gemini_route(url)
    if route == "vertex":
        try:
            resp = await client.post(_vertex_url(url), params={"key": settings.vertex_api_key}, **kwargs)
        except httpx.TimeoutException as e:
            if _aistudio_fallback_ok():
                logger.warning("[gemini] vertex timeout(%s) -> AI Studio 재시도", type(e).__name__)
                return await _gemini_aistudio(client, url, **kwargs)
            raise
        if resp.status_code == 429:
            record_rate_limit("gemini-vertex")
        if resp.status_code in _GEMINI_TRANSIENT and _aistudio_fallback_ok():
            logger.warning("[gemini] vertex HTTP %s -> AI Studio 재시도", resp.status_code)
            return await _gemini_aistudio(client, url, **kwargs)
        return resp
    return await _gemini_aistudio(client, url, **kwargs)


async def _gemini_aistudio(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    resp = await client.post(url, params={"key": settings.google_api_key}, **kwargs)
    if resp.status_code == 429:
        record_rate_limit("gemini-aistudio")
    return resp


# 아래 셋은 "전부 Vertex(100%)" 기준 보조 함수(점검·시험용). 실제 호출은 gemini_post 를 쓴다.

def gemini_url(url: str) -> str:
    """AI Studio 모델 URL → (비율 100% 일 때) Vertex 익스프레스 URL. 그 외는 그대로."""
    if gemini_vertex_ratio() < 100:
        return url
    return _vertex_url(url) or url


def gemini_key() -> str:
    return settings.vertex_api_key if gemini_vertex_ratio() >= 100 else settings.google_api_key


def gemini_params() -> Dict[str, str]:
    return {"key": gemini_key()}


def claude_configured() -> bool:
    if claude_provider() == "vertex":
        return bool(settings.gcp_project_id)
    return bool(settings.anthropic_api_key)
