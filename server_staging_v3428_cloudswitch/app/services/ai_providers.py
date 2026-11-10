"""v3.428 클라우드 결제 전환 — AI 공급 경로 스위치 (옛 경로 / 새 경로).

기본값은 모두 **지금 운영 경로**라서 환경변수를 바꾸지 않으면 동작이 이전과 같다.

  CLAUDE_PROVIDER = anthropic | vertex   (vertex: GCP_PROJECT_ID·VERTEX_REGION, 인증=ADC 서비스 계정)
  GEMINI_PROVIDER = aistudio  | vertex   (vertex: VERTEX_API_KEY 익스프레스 키, 모델 치환=VERTEX_GEMINI_MODEL_MAP)
  OPENAI_PROVIDER = openai    | azure    (azure: AZURE_OPENAI_ENDPOINT·AZURE_OPENAI_API_KEY,
                                          Azure 배포 이름을 지금 모델 이름과 똑같이 만든다)
  임베딩 모델 = EMBEDDING_MODEL (기본 text-embedding-3-small, 1536차원 — 바꾸면 벡터 전부 재생성 필요)
  fal = FAL_API_KEY 만 마켓플레이스 키로 교체 (코드 변경 없음)

스위치는 컨테이너 기동 시 한 번 읽는다(서비스별 클라이언트가 싱글톤). 바꾼 뒤에는 재기동.
"""
import logging
import re
from typing import Dict, Optional

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


# ── Claude ────────────────────────────────────────────────────────────────────

def make_anthropic_client(**kwargs):
    """AsyncAnthropic(옛) 또는 AsyncAnthropicVertex(새). timeout·max_retries 등은 그대로 전달.

    Vertex 에서도 모델 ID 는 그대로(claude-opus-4-6 등, 날짜 접미사 없음).
    """
    import anthropic

    if claude_provider() == "vertex":
        logger.info("[ai_providers] claude=vertex project=%s region=%s",
                    settings.gcp_project_id, settings.vertex_region)
        return anthropic.AsyncAnthropicVertex(
            project_id=settings.gcp_project_id,
            region=settings.vertex_region or "global",
            **kwargs,
        )
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, **kwargs)


# ── OpenAI ────────────────────────────────────────────────────────────────────

def _azure_base() -> str:
    return settings.azure_openai_endpoint.rstrip("/") + "/openai/v1/"


def make_openai_client(**kwargs):
    """AsyncOpenAI — 옛: api.openai.com / 새: Azure OpenAI v1 엔드포인트(같은 SDK, 같은 호출 형식)."""
    from openai import AsyncOpenAI

    if openai_provider() == "azure":
        key = settings.azure_openai_api_key
        return AsyncOpenAI(
            api_key=key,
            base_url=_azure_base(),
            default_headers={"api-key": key},
            **kwargs,
        )
    return AsyncOpenAI(api_key=settings.openai_api_key, **kwargs)


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


def gemini_url(url: str) -> str:
    """AI Studio 모델 URL → (vertex 일 때) Vertex 익스프레스 URL. 그 외 URL·aistudio 는 그대로."""
    if gemini_provider() != "vertex":
        return url
    m = _AISTUDIO_MODEL_URL.match(url)
    if not m:
        return url
    model, method = m.group(1), m.group(2)
    model = _gemini_model_map().get(model, model)
    return "https://aiplatform.googleapis.com/v1/publishers/google/models/{}:{}".format(model, method)


def gemini_key() -> str:
    if gemini_provider() == "vertex":
        return settings.vertex_api_key
    return settings.google_api_key


def gemini_params() -> Dict[str, str]:
    return {"key": gemini_key()}


def gemini_headers() -> Dict[str, str]:
    return {"x-goog-api-key": gemini_key()}


def claude_configured() -> bool:
    if claude_provider() == "vertex":
        return bool(settings.gcp_project_id)
    return bool(settings.anthropic_api_key)
