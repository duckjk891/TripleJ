"""
AI Cover Image Generator using Google Gemini REST API.
Generates album cover art from song metadata.

Uses httpx to call the Gemini API directly (avoids google-genai SDK
which requires Python >= 3.9).
"""
import asyncio
import base64
import logging
from typing import Optional

import httpx

from ..config import settings
from .location_prompt import anchor_clause

logger = logging.getLogger(__name__)

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)


async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    character_image_bytes: bytes = None,
    user_prompt: str = None,
    prompt_model: str = None,
    user_location_image_bytes: bytes = None,
    user_location_name: str = None,
    image_model: str = "nb_pro",
    vocal_gender: str = None,
) -> bytes:
    """Generate album cover image using Gemini. Returns PNG bytes.

    If prompt_model is a Claude model, uses it to generate a richer prompt
    before sending to Gemini for image generation.

    v42: when user_location_image_bytes/user_location_name are supplied, the
    cover scene is anchored to the user-provided real location (Mode B —
    architecture/lighting/time-of-day must match the reference).

    v57: when ``vocal_gender`` is one of "female"/"male"/"neutral", inject a
    short protagonist-gender clause into all four prompt branches (Claude
    enhance system, programmatic [A] character-有, programmatic [B]
    character-無, systemInstruction). ``None`` keeps the legacy behaviour
    (no clause injected — byte-level no-regress for the existing call path).
    """
    # v57: gender clause helper. None → empty string (no injection).
    # "neutral" is rendered as "neutral / unspecified" for clarity downstream.
    _vg = (vocal_gender or "").strip().lower() if vocal_gender else None
    if _vg not in ("female", "male", "neutral"):
        _vg = None
    _vg_label = (
        "neutral / unspecified" if _vg == "neutral" else _vg
    )  # "female"|"male"|"neutral / unspecified"|None
    logger.info(
        "[CoverGen] vocal_gender=%s has_char_ref=%s char_bytes_len=%d has_loc_ref=%s",
        _vg,
        bool(character_image_bytes),
        len(character_image_bytes) if character_image_bytes else 0,
        bool(user_location_image_bytes),
    )

    # ── Optional: AI-enhanced prompt via Claude ──
    enhanced_prompt = None
    if prompt_model and prompt_model.startswith("claude-"):
        from .mv_generator import _get_anthropic_client
        anthropic_client = _get_anthropic_client()

        basic_info = f'Song title: "{title}"'
        if genre:
            basic_info += f"\nGenre: {genre}"
        if mood:
            basic_info += f"\nMood: {mood}"
        if user_prompt:
            basic_info += f"\nUser direction: {user_prompt}"

        enhance_system = (
            "You are a world-class album cover art director. "
            "Given song metadata and optional user direction, write a detailed, vivid prompt "
            "for an AI image generator to create a stunning album cover. "
            "Include specific details about composition, lighting, color palette, atmosphere, and visual elements. "
            "Output ONLY the image generation prompt, nothing else. 2-4 sentences, English."
        )
        if character_image_bytes:
            enhance_system += (
                " The cover must be photorealistic since it includes a character reference. "
                "PRESERVE the wardrobe / outfit (top, bottom, shoes, accessories) shown in the "
                "reference sheet — do not change clothing items even if the cover theme suggests otherwise."
            )
        else:
            enhance_system += " You may use any artistic style that fits the song's mood."
        # v42: anchor cover scene to user-provided real location, when supplied.
        if user_location_image_bytes:
            _loc_label = (user_location_name or "").strip() or "the provided location"
            enhance_system += (
                " A user-provided location reference image is attached as the canonical setting "
                "(named \"{name}\"). The cover scene MUST be set there — match its architecture, "
                "lighting, time of day, and color tone exactly. Do not invent a different place."
            ).format(name=_loc_label)
        # v57: protagonist gender clause (branch 1 — Claude enhance system).
        if _vg_label:
            enhance_system += " The protagonist is a {g} subject.".format(g=_vg_label)
        enhance_system += " The image must NOT contain any text or letters."

        try:
            cover_kwargs = {
                "model": prompt_model,
                "max_tokens": 8000,  # v75.2 — adaptive thinking 토큰 차감 대비 상향
                "system": enhance_system,
                "messages": [{"role": "user", "content": basic_info}],
                # v75 — adaptive thinking + high effort. temperature 제거.
                "thinking": {"type": "adaptive"},
                "output_config": {"effort": "high"},
            }
            logger.info(
                "[ThinkingOn] stage=cover_enhance model=%s effort=high",
                prompt_model,
            )
            response = await anthropic_client.messages.create(**cover_kwargs)
            # v75 — adaptive thinking 응답 안전 추출 ([ThinkingBlock, TextBlock] 순서).
            enhanced_prompt = None
            try:
                for _b in getattr(response, "content", []) or []:
                    if getattr(_b, "type", None) == "text":
                        enhanced_prompt = (getattr(_b, "text", "") or "").strip() or None
                        break
            except Exception:
                enhanced_prompt = None
        except Exception:
            enhanced_prompt = None  # Fall through to standard prompt building

    # If Claude generated an enhanced prompt, use it directly; otherwise build programmatically
    if enhanced_prompt:
        prompt = enhanced_prompt
    else:
        # Build prompt — two distinct paths based on character sheet usage
        prompt_parts = ["Create a beautiful album cover art image."]
        prompt_parts.append('Song title: "{}"'.format(title))
        if genre:
            prompt_parts.append("Genre: {}".format(genre))
        if mood:
            prompt_parts.append("Mood/atmosphere: {}".format(mood))

        if character_image_bytes:
            # [A] With character sheet — enforce photorealistic style
            prompt_parts.append(
                "The image MUST be in photorealistic style — like a real photograph "
                "taken with a high-end camera. Use realistic lighting, textures, and "
                "depth of field. The image should be square (1:1 aspect ratio), "
                "visually striking, suitable as a music album cover. "
                "Do NOT include any text or letters in the image."
            )
            prompt_parts.append(
                "IMPORTANT: The provided character reference sheet shows the main character. "
                "Feature this person prominently in the album cover as the main subject. "
                "Maintain the person's exact appearance (face, hair, features) from the reference. "
                "Also PRESERVE THE WARDROBE / OUTFIT (top, bottom, shoes, accessories) shown in "
                "the reference sheet — do not change clothing items even if the cover theme suggests otherwise. "
                "The character must be photorealistic, not illustrated or stylized."
            )
            # v57: protagonist gender clause (branch 2 — programmatic [A] character 有).
            # neutral 일 때는 캐릭터 시트로 위임함을 명시.
            if _vg_label:
                if _vg == "neutral":
                    prompt_parts.append(
                        "Protagonist gender: neutral / unspecified — defer to the reference sheet."
                    )
                else:
                    prompt_parts.append("Protagonist gender: {}.".format(_vg_label))
            prompt_parts.append(
                "Use cinematic photography techniques: choose an appropriate focal length "
                "(50mm for natural, 85mm for portrait, 35mm for environmental), "
                "apply professional lighting (key light, fill, rim/hair light), "
                "and use intentional depth of field to separate subject from background."
            )
            if user_prompt:
                prompt_parts.append("Additional direction: {}".format(user_prompt))
            # v42: append user-location anchor when supplied
            if user_location_image_bytes:
                _loc_clause = anchor_clause("cover", user_location_name, has_character=True)
                if _loc_clause:
                    prompt_parts.append(_loc_clause)
        else:
            # [B] Without character sheet — user can request any style
            if style:
                prompt_parts.append("Visual style: {}".format(style))
            prompt_parts.append(
                "The image should be square (1:1 aspect ratio), "
                "visually striking, suitable as a music album cover. "
                "Do NOT include any text or letters in the image."
            )
            # v57: protagonist gender clause (branch 3 — programmatic [B] character 無).
            if _vg_label:
                prompt_parts.append("Protagonist gender: {}.".format(_vg_label))
            prompt_parts.append(
                "Use intentional composition and artistic techniques: consider focal length, "
                "depth of field, lighting direction and quality, and color palette "
                "to create a visually compelling image."
            )
            if user_prompt:
                prompt_parts.append("Style and direction: {}".format(user_prompt))
            # v42: append user-location anchor when supplied (no character)
            if user_location_image_bytes:
                _loc_clause = anchor_clause("cover", user_location_name, has_character=False)
                if _loc_clause:
                    prompt_parts.append(_loc_clause)

        prompt = " ".join(prompt_parts)

    # v55: branch by image_model. nb_pro (default) keeps the existing Gemini
    # path bit-for-bit. gpt_image_2 forwards prompt + ref bytes to OpenAI.
    logger.info("[CoverGen] image_model=%s", image_model)
    if image_model == "gpt_image_2":
        from .openai_image import generate_image as _openai_generate_image

        _refs: list = []
        if character_image_bytes:
            _refs.append(character_image_bytes)
        if user_location_image_bytes:
            _refs.append(user_location_image_bytes)
        return await _openai_generate_image(
            prompt=prompt, ref_images=_refs or None, size="2048x2048", quality="high"
        )

    # Build request parts
    request_parts = [{"text": prompt}]

    if character_image_bytes:
        char_b64 = base64.b64encode(character_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": char_b64,
            }
        })

    # v42: attach user-provided location reference (after character if present).
    if user_location_image_bytes:
        loc_b64 = base64.b64encode(user_location_image_bytes).decode("utf-8")
        request_parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": loc_b64,
            }
        })

    if character_image_bytes:
        system_text = (
            "You are a world-class album cover art director and photographer. "
            "You specialize in creating iconic, visually striking album covers "
            "that capture the essence of music through photorealistic imagery. "
            "You have deep expertise in composition, focal length, depth of field, "
            "lighting, color theory, and visual storytelling for the music industry."
        )
    else:
        system_text = (
            "You are a world-class album cover art director and visual artist. "
            "You specialize in creating iconic, visually striking album covers "
            "in any artistic style the user requests — photorealistic, anime, illustration, "
            "watercolor, cyberpunk, minimalist, abstract, or any other style. "
            "You have deep expertise in composition, focal length, depth of field, "
            "lighting, color theory, and visual storytelling for the music industry."
        )

    # v42: extend systemInstruction to respect user-provided location reference.
    if user_location_image_bytes:
        system_text += (
            " Respect the user-provided location reference image as the canonical setting "
            "for this cover — its architecture, lighting, time of day, and color tone are "
            "non-negotiable."
        )

    # v57: protagonist gender clause (branch 4 — systemInstruction).
    # character 有: 캐릭터 시트가 외형의 canonical 임을 동시 명시.
    # character 無: 단순 성별 명시.
    if _vg_label:
        if character_image_bytes:
            system_text += (
                " The protagonist is a {g} subject — the reference sheet is canonical "
                "for face/hair/features."
            ).format(g=_vg_label)
        else:
            system_text += " The protagonist is a {g} subject.".format(g=_vg_label)

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_text}]
        },
        "contents": [{"parts": request_parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            GEMINI_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini API error (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()

    # Extract image from response
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")

    parts = candidates[0].get("content", {}).get("parts", [])
    image_bytes = None
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            image_bytes = base64.b64decode(inline_data["data"])
            break

    if image_bytes is None:
        raise ValueError("No image generated from Gemini response")

    return image_bytes


# ─── v58: refine_cover_image — image-to-image multi-turn refinement ───
#
# 신규 [추가 수정] 플로우. 현재 커버 PNG 를 ref 이미지로 사용해 부분 수정을
# 적용 (multi-turn image-to-image). 기존 generate_cover_image 는 byte-level
# 무회귀 (시그니처/본문 변경 X — 신규 함수로 완전 분리).
#
# image_model 은 session 박제값 그대로 사용 (Q3 b — 일관성). refine 시
# 사용자가 변경 불가.

_ABSOLUTE_RULE = (
    "ABSOLUTE RULE: Do NOT change anything other than what the user explicitly "
    "requests. Preserve face identity, outfit, background, color tone, and "
    "composition from the reference image as faithfully as possible."
)


def _build_refine_prompt(
    refine_prompt: str,
    title: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
) -> str:
    """Compose the english refine prompt body. Pure (no I/O) for testability."""
    parts = [
        "This is an image-to-image refinement task. Take the attached reference "
        "image as the canonical starting point and apply ONLY the following "
        "user-requested change:",
        "",
        'USER CHANGE REQUEST: "{}"'.format(refine_prompt),
        "",
    ]
    ctx_lines = []
    if title:
        ctx_lines.append('- Song title: "{}"'.format(title))
    if genre:
        ctx_lines.append("- Genre: {}".format(genre))
    if mood:
        ctx_lines.append("- Mood: {}".format(mood))
    if ctx_lines:
        parts.append("CONTEXT (best-effort, do not introduce conflicting elements):")
        parts.extend(ctx_lines)
        parts.append("")
    parts.append(_ABSOLUTE_RULE)
    parts.append("")
    parts.append("The image must NOT contain any text or letters.")
    return "\n".join(parts)


async def _refine_with_gemini(
    prompt: str, current_cover_bytes: bytes
) -> bytes:
    """Call Gemini image preview with the current cover as inlineData ref.

    1 retry on transient failure (HTTP != 200 or parse error).
    """
    ref_b64 = base64.b64encode(current_cover_bytes).decode("utf-8")
    request_parts = [
        {"text": prompt},
        {"inlineData": {"mimeType": "image/png", "data": ref_b64}},
    ]
    system_text = (
        "You are a world-class image editor. You receive a reference image and a "
        "user instruction describing a localized change. Apply ONLY the requested "
        "change and preserve every other aspect of the reference image as faithfully "
        "as possible. " + _ABSOLUTE_RULE
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system_text}]},
        "contents": [{"parts": request_parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }

    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    GEMINI_API_URL,
                    params={"key": settings.google_api_key},
                    json=payload,
                )
            logger.info("[CoverRefine] gemini HTTP status=%d", resp.status_code)
            if resp.status_code != 200:
                raise ValueError(
                    "Gemini API error (HTTP {}): {}".format(
                        resp.status_code, resp.text[:300]
                    )
                )
            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise ValueError("No candidates in Gemini response")
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                inline_data = part.get("inlineData")
                if inline_data and inline_data.get("data"):
                    return base64.b64decode(inline_data["data"])
            raise ValueError("No image generated from Gemini response")
        except Exception as e:  # noqa: BLE001
            last_err = e
            err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
            logger.warning("[CoverRefine] attempt=%d failed: %s", attempt + 1, err_text)
            if attempt == 0:
                await asyncio.sleep(2.0)
                continue
    # Both attempts failed.
    raise last_err if last_err else ValueError("Gemini refine failed (unknown)")


async def refine_cover_image(
    current_cover_bytes: bytes,
    refine_prompt: str,
    image_model: str = "nb_pro",
    title: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
) -> bytes:
    """Refine an existing cover image (image-to-image) and return new PNG bytes.

    v58 신규. ``current_cover_bytes`` (현재 커버 PNG) 를 ref 이미지로 첨부하고
    ``refine_prompt`` (사용자 변경 요청) 만 적용. ``image_model`` 은 처음 커버
    생성 시 박제된 값 그대로 사용 (Q3 b — 일관성).

    - ``nb_pro``: Gemini gemini-3-pro-image-preview 의 inlineData ref 첨부.
    - ``gpt_image_2``: OpenAI ``/v1/images/edits`` (openai_image.generate_image
      with ref_images=[current_cover_bytes]).

    1회 retry on transient failure (nb_pro 분기). gpt_image_2 는
    openai_image 내부 retry 정책을 그대로 따른다.

    Logs:
      - [CoverRefine] image_model=... refine_prompt_len=...
      - [CoverRefine] gemini HTTP status=... (nb_pro 분기)
      - [CoverRefine] success bytes=...
      - [CoverRefine] failed: <class>: <msg>
    """
    # 정규화 — refine_prompt 본문 절대 미출력 (PII 가능). 길이만 로깅.
    rp = (refine_prompt or "").strip()
    logger.info(
        "[CoverRefine] image_model=%s refine_prompt_len=%d", image_model, len(rp)
    )
    if not rp:
        raise ValueError("refine_prompt 가 비어 있습니다.")
    if not current_cover_bytes:
        raise ValueError("current_cover_bytes 가 비어 있습니다.")

    prompt = _build_refine_prompt(
        refine_prompt=rp, title=title, genre=genre, mood=mood
    )

    try:
        if image_model == "gpt_image_2":
            from .openai_image import generate_image as _openai_generate_image

            result = await _openai_generate_image(
                prompt=prompt,
                ref_images=[current_cover_bytes],
                size="2048x2048",
                quality="high",
            )
        else:
            # default / nb_pro
            result = await _refine_with_gemini(prompt, current_cover_bytes)
    except Exception as e:  # noqa: BLE001
        err_text = "{}: {}".format(type(e).__name__, str(e)[:200] or "(no message)")
        logger.error("[CoverRefine] failed: %s", err_text)
        raise

    logger.info("[CoverRefine] success bytes=%d", len(result) if result else 0)
    return result
