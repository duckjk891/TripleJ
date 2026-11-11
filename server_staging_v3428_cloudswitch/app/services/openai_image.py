"""OpenAI GPT Image 2 wrapper (v55).

Provides `generate_image(prompt, ref_images, size, quality)` that returns PNG
bytes — the same shape as the existing Gemini Nano Banana Pro helpers
(`_call_gemini_image` in character_generator, `_gemini_generate_image` in
mv_assets). When `ref_images` is empty/None it calls the text-to-image
endpoint (`/v1/images/generations`); when one or more reference images are
supplied it falls back to the multi-ref edits endpoint (`/v1/images/edits`).

Snapshot model id `gpt-image-2-2026-04-21` is used to avoid alias rolling.
"""
import asyncio
import base64
import io
import logging
from typing import Optional

import httpx

from ..config import settings
from .ai_providers import openai_auth_headers, openai_configured, openai_images_url
from .watermark import embed_image_metadata

logger = logging.getLogger(__name__)

# v55: snapshot model id (avoid `gpt-image-2` alias rolling).
# v3.321 (대표 2026-10-09 "이미지 디렉터·아티스트 생성이 아티스트를 잘 반영 못함 — 2.5로"):
#   gpt-image-2-2026-04-21 → gpt-image-2.5-sunburst-2026-09-08. 2.5 두 변형(flare=빠름, sunburst=참조 이미지 편집·
#   디테일 보존 최상) 중 얼굴·착장 동일성이 목적이라 sunburst(같은 가격). 운영 실측: edits 2048·high·참조 1장 57초,
#   요청 형식(model·prompt·size·quality·n) 변경 없이 동작. 롤백 = 이전 스냅샷 id 로 되돌림.
OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst-2026-09-08"

OPENAI_GEN_URL = openai_images_url("generations")
OPENAI_EDIT_URL = openai_images_url("edits")

# Multi-ref ceiling per OpenAI spec.
MAX_REF_IMAGES = 10

# v3.227 (H-2) — input_fidelity 는 보내지 않는다: gpt-image-2(및 snapshot
# gpt-image-2-2026-04-21)는 이 파라미터를 지원하지 않으며(공식 API reference "Create image
# edit": 해당 모델은 input_fidelity 를 무시/미지원, 프롬프트 가이드: "output is already high
# fidelity by default"), 실제로 보내면 400 invalid_input_fidelity_model 로 실패한다.
# 얼굴 동일성은 프롬프트의 "Image N:" 인덱스 맵 + identity lock 문구로 확보한다
# (character_generator._build_gpt_indexed_prompt).

_EXT_BY_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


def _neutral_placeholder_png() -> bytes:
    """v3.326 — 읽을 수 없는 참조 이미지 대체용 64×64 회색 PNG."""
    from PIL import Image as _Image

    buf = io.BytesIO()
    _Image.new("RGB", (64, 64), (128, 128, 128)).save(buf, format="PNG")
    return buf.getvalue()


def sniff_image_mime(data: Optional[bytes]) -> Optional[str]:
    """매직바이트로 실제 포맷 판별 (edits API 허용 포맷: png/jpeg/webp). 그 외 None."""
    head = (data or b"")[:16]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


# v3.238 — edits 허용 3종(png/jpeg/webp) 밖의 이미지(광고 제품컷 GIF 등) 판별·변환.
# sniff_image_mime 은 "edits 에 그대로 보낼 수 있는 포맷" 계약(호출측이 non-None 을 그대로 MIME 으로 씀)이라
# GIF 를 거기에 넣지 않고 별도 함수로 둔다(넣으면 _call_edits 가 image/gif 로 보내 여전히 400).
def detect_image_mime(data: Optional[bytes]) -> Optional[str]:
    """sniff_image_mime + 흔한 비허용 포맷(gif·bmp·tiff) 판별 — 로그·변환 판단용. 모르면 None."""
    m = sniff_image_mime(data)
    if m:
        return m
    head = (data or b"")[:16]
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:2] == b"BM":
        return "image/bmp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    return None


def to_png_bytes(data: bytes) -> bytes:
    """Pillow 로 PNG 변환(GIF·애니메이션 = 첫 프레임, RGBA). 디코드 실패는 예외 그대로(호출측 처리)."""
    from PIL import Image

    with Image.open(io.BytesIO(data)) as im:
        im.seek(0)
        rgba = im.convert("RGBA")
    out = io.BytesIO()
    rgba.save(out, format="PNG")
    return out.getvalue()


def _png_size(size: str) -> str:
    """Normalize size to one of the supported strings; fall back to 2048x2048."""
    if size in ("1024x1024", "1024x1792", "1792x1024", "2048x2048", "auto"):
        return size
    return "2048x2048"


async def _decode_first_image(data: dict) -> bytes:
    """Decode the first image from an OpenAI images API response."""
    images = data.get("data") or []
    if not images:
        raise ValueError("OpenAI image response missing 'data'")
    first = images[0] or {}
    b64 = first.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    # Fallback: response_format=url path — fetch the URL.
    url = first.get("url")
    if url:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                raise ValueError(
                    "OpenAI image URL download failed (HTTP {})".format(r.status_code)
                )
            return r.content
    raise ValueError("OpenAI image response missing b64_json/url")


async def _call_generations(
    prompt: str, size: str, quality: str
) -> bytes:
    """POST /v1/images/generations — text-to-image."""
    headers = {
        **openai_auth_headers(),
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": _png_size(size),
        "quality": quality,
        "n": 1,
    }
    # v59: 품질 우선 — 2K + ref 호출은 응답까지 1~5분 자주 걸리므로 1800s(30분) 여유.
    async with httpx.AsyncClient(timeout=1800.0) as client:
        resp = await client.post(OPENAI_GEN_URL, headers=headers, json=payload)
    logger.info(
        "[OpenAIImage] generations http=%d size=%s", resp.status_code, payload["size"]
    )
    if resp.status_code != 200:
        raise ValueError(
            "OpenAI generations error HTTP {}: {}".format(
                resp.status_code, resp.text[:300]
            )
        )
    return await _decode_first_image(resp.json())


async def _call_edits(
    prompt: str, ref_images: list, size: str, quality: str
) -> bytes:
    """POST /v1/images/edits — text + multi-ref (multipart)."""
    headers = {
        **openai_auth_headers(),
    }
    # Use multipart/form-data with multiple image[] parts.
    files = []
    mimes = []
    for idx, ref in enumerate(ref_images):
        if not ref:
            continue
        # v3.227 (H-2) — 실제 포맷으로 파일명·MIME 표기 (기존: 전부 ref_{i}.png/image/png —
        # 원본 jpg 도 png 로 표기됐음). 판별 불가면 기존 표기(png) 유지.
        mime = sniff_image_mime(ref)
        if mime is None:
            # v3.238 — GIF 등 비허용 포맷을 png 로 잘못 표기해 보내면 edits 400 "Invalid image data"(커버 전체 실패).
            # PNG 로 변환해 보낸다. 변환 실패면 기존 동작(png 표기) — 참조 개수·순서(Image N 번호 맵)는 절대 바꾸지 않는다.
            _orig_mime = detect_image_mime(ref) or "unknown"
            try:
                ref = to_png_bytes(ref)
                logger.warning("[OpenAIImage] ref converted idx=%d mime=%s → image/png", idx, _orig_mime)
            except Exception as _e:  # noqa: BLE001
                # v3.326: 이미지가 아닌 참조(예: 업로드 경로 오류로 저장된 HTML)를 그대로 보내면 edits 400 으로 커버 전체 실패.
                # 번호 맵(Image N)을 지키기 위해 빼지 않고 무채색 자리표시 이미지로 대체해 생성은 진행한다.
                logger.warning("[OpenAIImage] ref convert failed idx=%d mime=%s err=%s — neutral placeholder", idx, _orig_mime, type(_e).__name__)
                ref = _neutral_placeholder_png()
            mime = sniff_image_mime(ref) or "image/png"
        mimes.append(mime)
        files.append(
            ("image[]", ("ref_{}.{}".format(idx, _EXT_BY_MIME.get(mime, "png")), io.BytesIO(ref), mime))
        )
    data = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": _png_size(size),
        "quality": quality,
        "n": "1",
    }
    # v59: 품질 우선 — edits 도 multi-ref + 2K 면 응답 지연 잦음. 1800s 동일 적용.
    async with httpx.AsyncClient(timeout=1800.0) as client:
        resp = await client.post(
            OPENAI_EDIT_URL, headers=headers, data=data, files=files
        )
    logger.info(
        "[OpenAIImage] edits http=%d refs=%d size=%s mimes=%s",
        resp.status_code,
        len(files),
        data["size"],
        mimes,
    )
    if resp.status_code != 200:
        raise ValueError(
            "OpenAI edits error HTTP {}: {}".format(
                resp.status_code, resp.text[:300]
            )
        )
    return await _decode_first_image(resp.json())


def _is_capacity_error(err: Optional[Exception]) -> bool:
    """429(한도)·5xx(서버)·시간 초과·연결 오류만 True. 안전 거절(400 등)은 False."""
    if err is None:
        return False
    if isinstance(err, (httpx.TimeoutException, httpx.TransportError)):
        return True
    text = str(err)
    for code in ("HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504"):
        if code in text:
            return True
    return False


async def generate_image(
    prompt: str,
    ref_images: Optional[list] = None,
    size: str = "2048x2048",
    quality: str = "high",
) -> bytes:
    """Generate a single image via OpenAI GPT Image 2 and return PNG bytes.

    - When `ref_images` is empty/None: uses /v1/images/generations.
    - When one or more `ref_images` (list[bytes]) are supplied: uses
      /v1/images/edits with multi-ref attachments (max 10 — anything beyond
      is dropped with a warning).

    The interface mirrors `_gemini_generate_image` in mv_assets so callers
    can dispatch on `image_model` with a single-line branch.
    """
    if not openai_configured():
        # Do not log the key. Just fail loudly.
        raise ValueError("OPENAI_API_KEY is not configured")

    refs = [b for b in (ref_images or []) if b]
    if len(refs) > MAX_REF_IMAGES:
        logger.warning(
            "[OpenAIImage] ref_images=%d exceeds max=%d — truncating",
            len(refs),
            MAX_REF_IMAGES,
        )
        refs = refs[:MAX_REF_IMAGES]

    mode = "edits" if refs else "generations"
    logger.info(
        "[OpenAIImage] mode=%s refs=%d prompt_len=%d",
        mode,
        len(refs),
        len(prompt or ""),
    )

    # Single retry on transient failure.
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            if refs:
                result = await _call_edits(prompt, refs, size, quality)
            else:
                result = await _call_generations(prompt, size, quality)
            # v137 [watermark]: 비가시 AI 마커 삽입 (모든 저장 지점 공통 적용).
            return embed_image_metadata(result)
        except Exception as e:  # noqa: BLE001
            last_err = e
            # httpx.ReadTimeout / TimeoutException 등은 str(e) 가 빈 문자열일 수 있어
            # 클래스명을 항상 포함시킴.
            err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
            logger.warning(
                "[OpenAIImage] attempt=%d failed: %s",
                attempt + 1,
                err_text,
            )
            if attempt == 0:
                await asyncio.sleep(2.0)
                continue
            break

    # v3.428: 한도 초과(429)·서버 오류(5xx)·시간 초과일 때만 Gemini 이미지(트랙 1)로 예비 전환.
    #   IMAGE_FALLBACK_GEMINI=true 일 때만 동작(기본 꺼짐 = 기존 동작 그대로). Azure 신규 구독 기본 한도(분당 2건) 대비.
    #   안전 기준 거절(400 등)은 넘기지 않는다 — 모델 우회 금지 정책(v3.377).
    if settings.image_fallback_gemini and _is_capacity_error(last_err):
        try:
            from .mv_assets import _gemini_generate_image
            logger.warning("[OpenAIImage] fallback=gemini reason=%s refs=%d", type(last_err).__name__, len(refs))
            result = await _gemini_generate_image(prompt, refs)
            return embed_image_metadata(result)
        except Exception as fe:  # noqa: BLE001
            logger.error("[OpenAIImage] fallback=gemini failed: %s", type(fe).__name__)

    # All retries exhausted.
    msg = "OpenAI image generation failed after retry: {}".format(
        "{}: {}".format(type(last_err).__name__, str(last_err)[:200] or "(no message)")
        if last_err else "unknown"
    )
    logger.error("[OpenAIImage] failed: %s", msg)
    raise ValueError(msg)
