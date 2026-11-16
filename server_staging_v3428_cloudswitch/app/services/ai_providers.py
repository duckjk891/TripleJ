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
  GEMINI_RETRY_MAX = 0 / GEMINI_RETRY_BASE_SEC = 1 / GEMINI_RETRY_MAX_WAIT_SEC = 8
                                         자체 재시도 없는 Gemini 호출부의 429·5xx·시간 초과 추가 시도(지수 백오프+지터)
  GEMINI_MODEL_FALLBACK = false          켜면 GEMINI_FALLBACK_MODELS(기본 gemini-3.1-pro-preview=gemini-2.5-pro)로
                                         일시 오류 시 예비 모델 1회
  VERTEX_PRIORITY_PAYGO = false          켜면 사용자가 기다리는 Gemini 요청(캐릭터·커버)에 Priority PayGo 헤더(Vertex 일 때만)
  CLAUDE_MAX_RETRIES / OPENAI_MAX_RETRIES = -1   SDK 재시도 횟수(-1 = SDK 기본 2회 그대로, 호출부 지정값 우선)
  VERTEX_CLAUDE_MODEL_MAP = ""           Vertex 의 Claude 모델 ID 가 다르면 "옛=새,..." 로 치환
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


# ── SDK 공통 재시도 ───────────────────────────────────────────────────────────
# Claude·OpenAI SDK 는 429·408·409·5xx·연결 오류에 지수 백오프+지터 재시도를 이미 한다(기본 2회,
# 0.5초→최대 8초). 횟수만 환경변수로: CLAUDE_MAX_RETRIES / OPENAI_MAX_RETRIES (기본 -1 = 손대지 않음).
# 호출부가 max_retries 를 직접 준 곳(낙서 읽기 1회·연령 분류 2회)은 그 값을 그대로 둔다.

def _sdk_retry_kwargs(kwargs: dict, setting_name: str) -> dict:
    try:
        n = int(getattr(settings, setting_name, -1))
    except (TypeError, ValueError):
        n = -1
    if n >= 0 and "max_retries" not in kwargs:
        kwargs = dict(kwargs, max_retries=n)
    return kwargs


# ── Claude ────────────────────────────────────────────────────────────────────

def _parse_map(raw: Optional[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for pair in (raw or "").split(","):
        if "=" in pair:
            a, b = pair.split("=", 1)
            if a.strip() and b.strip():
                out[a.strip()] = b.strip()
    return out


def _claude_vertex_model_map() -> Dict[str, str]:
    return _parse_map(getattr(settings, "vertex_claude_model_map", ""))


def _apply_claude_model_map(client):
    """VERTEX_CLAUDE_MODEL_MAP("claude-opus-4-6=claude-opus-4-6@20260101,...")이 있으면
    messages.create / stream / count_tokens 의 model= 만 바꿔 준다. 비어 있으면 아무것도 안 함."""
    mapping = _claude_vertex_model_map()
    if not mapping:
        return client
    res = client.messages  # SDK 는 cached_property → 같은 객체에 덮어쓰면 유지됨

    def _wrap(orig):
        def wrapped(*a, **kw):
            m = kw.get("model")
            if m in mapping:
                kw["model"] = mapping[m]
            return orig(*a, **kw)
        return wrapped

    for name in ("create", "stream", "count_tokens"):
        orig = getattr(res, name, None)
        if orig is not None:
            setattr(res, name, _wrap(orig))
    return client


def make_anthropic_client(**kwargs):
    """AsyncAnthropic(옛) 또는 AsyncAnthropicVertex(새). timeout·max_retries 등은 그대로 전달.

    Vertex 에서도 모델 ID 는 그대로(claude-opus-4-6 등). 표기가 다르면 VERTEX_CLAUDE_MODEL_MAP 으로 치환.
    """
    import anthropic

    kwargs = _sdk_retry_kwargs(kwargs, "claude_max_retries")
    if claude_provider() == "vertex":
        logger.info("[ai_providers] claude=vertex project=%s region=%s",
                    settings.gcp_project_id, settings.vertex_region)
        return _apply_claude_model_map(_watch_429(anthropic.AsyncAnthropicVertex(
            project_id=settings.gcp_project_id,
            region=settings.vertex_region or "global",
            **kwargs,
        ), "claude-vertex"))
    return _watch_429(anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, **kwargs),
                      "claude-anthropic")


# ── OpenAI ────────────────────────────────────────────────────────────────────

def _azure_base() -> str:
    return settings.azure_openai_endpoint.rstrip("/") + "/openai/v1/"


def make_openai_client(**kwargs):
    """AsyncOpenAI — 옛: api.openai.com / 새: Azure OpenAI v1 엔드포인트(같은 SDK, 같은 호출 형식)."""
    from openai import AsyncOpenAI

    kwargs = _sdk_retry_kwargs(kwargs, "openai_max_retries")
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
    return _parse_map(settings.vertex_gemini_model_map)


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


# Priority PayGo (공식 문서 2026-11-16 확인): 요청 헤더 X-Vertex-AI-LLM-Shared-Request-Type: priority
#   응답 본문 usageMetadata.trafficType = ON_DEMAND_PRIORITY(적용) / ON_DEMAND(표준으로 강등).
#   TODO: 문서 예시는 서비스 계정(gcloud) 인증 + projects/.../locations/global 경로뿐 — 익스프레스 API 키
#         (publishers/google/models/... 경로)에서도 먹히는지는 시험 컨테이너에서 trafficType 으로 확인할 것.
PRIORITY_PAYGO_HEADER = "X-Vertex-AI-LLM-Shared-Request-Type"
_sleep = asyncio.sleep  # 시험에서 바꿔 끼움


def _gemini_retry_max() -> int:
    try:
        return max(0, min(10, int(getattr(settings, "gemini_retry_max", 0) or 0)))
    except (TypeError, ValueError):
        return 0


def _backoff_delay(attempt: int) -> float:
    """지수 백오프 + 지터(equal jitter): 상한 d=min(최대 대기, 기본×2^attempt), 실제 = d/2 + U(0, d/2)."""
    try:
        base = float(getattr(settings, "gemini_retry_base_sec", 1.0) or 1.0)
        cap = float(getattr(settings, "gemini_retry_max_wait_sec", 8.0) or 8.0)
    except (TypeError, ValueError):
        base, cap = 1.0, 8.0
    d = min(cap, base * (2 ** attempt))
    return d / 2 + random.uniform(0, d / 2)


def _fallback_model_url(url: str) -> Optional[str]:
    """GEMINI_MODEL_FALLBACK 켜짐 + 이 URL 의 모델이 GEMINI_FALLBACK_MODELS 에 있으면 예비 모델 AI Studio URL."""
    if not bool(getattr(settings, "gemini_model_fallback", False)):
        return None
    m = _AISTUDIO_MODEL_URL.match(url)
    if not m:
        return None
    alt = _parse_map(getattr(settings, "gemini_fallback_models", "")).get(m.group(1))
    if not alt or alt == m.group(1):
        return None
    return "https://generativelanguage.googleapis.com/v1beta/models/{}:{}".format(alt, m.group(2))


async def gemini_post(client: httpx.AsyncClient, url: str, *, retry: bool = True, priority: bool = False,
                      **kwargs) -> httpx.Response:
    """Gemini REST POST. url 은 AI Studio 모델 URL 을 그대로 넘긴다.

    한 번의 시도 = 경로 선택(비율) → Vertex 가 429·5xx·시간 초과면 AI Studio 1회(GEMINI_AISTUDIO_FALLBACK)
                 → 그래도 일시 오류면 예비 모델 1회(GEMINI_MODEL_FALLBACK, 기본 꺼짐).
    retry=True 인 호출부는 일시 오류(429·500·502·503·504·시간 초과)에 GEMINI_RETRY_MAX 번(기본 0)
    지수 백오프+지터로 더 시도. **자체 재시도 루프가 있는 호출부는 retry=False** 로 이중 재시도를 막는다.
    priority=True(사용자가 기다리는 요청)는 VERTEX_PRIORITY_PAYGO 가 켜져 있고 Vertex 로 갈 때만 헤더를 붙인다.
    그 밖의 응답(200 안의 안전 차단, 400 등)은 그대로 — 재시도·모델·경로 우회 금지(v3.377).
    """
    attempts = 1 + (_gemini_retry_max() if retry else 0)
    for i in range(attempts):
        last = i + 1 >= attempts
        try:
            resp = await _gemini_attempt(client, url, priority, kwargs)
        except httpx.TimeoutException as e:
            if last:
                raise
            delay = _backoff_delay(i)
            logger.warning("[gemini] timeout(%s) — retry %d/%d in %.1fs", type(e).__name__, i + 1, attempts - 1, delay)
            await _sleep(delay)
            continue
        if resp.status_code in _GEMINI_TRANSIENT and not last:
            delay = _backoff_delay(i)
            logger.warning("[gemini] HTTP %s — retry %d/%d in %.1fs", resp.status_code, i + 1, attempts - 1, delay)
            await _sleep(delay)
            continue
        return resp
    raise RuntimeError("unreachable")  # pragma: no cover


async def _gemini_attempt(client, url, priority, kwargs) -> httpx.Response:
    alt = _fallback_model_url(url)
    if alt is None:
        return await _gemini_route_call(client, url, priority, kwargs)
    try:
        resp = await _gemini_route_call(client, url, priority, kwargs)
    except httpx.TimeoutException as e:
        logger.warning("[gemini] model timeout(%s) -> 예비 모델 %s", type(e).__name__, alt.rsplit("/", 1)[-1])
        return await _gemini_route_call(client, alt, priority, kwargs)
    if resp.status_code in _GEMINI_TRANSIENT:
        logger.warning("[gemini] model HTTP %s -> 예비 모델 %s", resp.status_code, alt.rsplit("/", 1)[-1])
        return await _gemini_route_call(client, alt, priority, kwargs)
    return resp


async def _gemini_route_call(client, url, priority, kwargs) -> httpx.Response:
    route = pick_gemini_route(url)
    if route == "vertex":
        vkw = kwargs
        if priority and bool(getattr(settings, "vertex_priority_paygo", False)):
            vkw = dict(kwargs, headers={**(kwargs.get("headers") or {}), PRIORITY_PAYGO_HEADER: "priority"})
        try:
            resp = await client.post(_vertex_url(url), params={"key": settings.vertex_api_key}, **vkw)
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
