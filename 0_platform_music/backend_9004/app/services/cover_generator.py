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
    # v234(대표 확정 2026-09-09): 이미지 디렉터 대화 보강 — 전부 선택사항(None=미주입)
    shot: str = None,               # 구도 (한국어 라벨 또는 자유 문자열)
    expression: str = None,         # v245(대표) — 인물 표정 (자유 문자열)
    palette: str = None,            # 색감·톤
    background_prompt: str = None,  # 배경·장소 텍스트 설명
    background_image_bytes: bytes = None,  # 배경·장소 참조 사진
    lyrics_excerpt: str = None,     # 가사 발췌 — 장면 영감용 (LLM 추가 호출 없이 이미지 모델에 직접 전달)
    # v235(대표 지적 2026-09-09): 가상(만화) 아티스트에 실사 강제 프롬프트가 걸리던 결함 분기
    character_kind: str = None,       # 'real' | 'virtual' — None 은 기존(실사) 동작 유지
    character_art_style: str = None,  # 가상 화풍 영문 라벨 (예: "Korean webtoon style")
    # v239(대표 지적 2026-09-11): 시트만으론 의상 디테일(백프린트 등)이 누락 — 착장 아이템
    # 제품컷을 추가 참조로 동봉 + 의상 충실도 강제 절 주입
    outfit_item_images: list = None,   # 착장 아이템 제품컷 bytes 목록 (최대 3)
    outfit_item_names: list = None,    # 위와 짝 — 아이템명(프롬프트 표기용)
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
    # v234: 배경 참조 사진은 기존 location 파이프라인(참조 이미지 동봉 + systemInstruction)을
    # 그대로 재사용 — 문구는 아래 _extra_parts 의 배경 절이 담당(anchor_clause 는 name 필요라 미사용).
    if background_image_bytes and not user_location_image_bytes:
        user_location_image_bytes = background_image_bytes

    logger.info(
        "[CoverGen] vocal_gender=%s has_char_ref=%s char_bytes_len=%d has_loc_ref=%s shot=%s palette=%s bg_prompt=%s lyrics=%s",
        _vg,
        bool(character_image_bytes),
        len(character_image_bytes) if character_image_bytes else 0,
        bool(user_location_image_bytes),
        (shot or "")[:12], (palette or "")[:12], bool(background_prompt), bool(lyrics_excerpt),
    )

    # ── v234: 대화 보강 항목 → 영어 절 (전부 선택 — None 은 미주입, 한국어 라벨 매핑·자유 문자열 통과) ──
    _SHOT_MAP = {
        "클로즈업": "Close-up portrait framing, the face filling most of the frame",
        "반신": "Half-body (waist-up) shot",
        "전신": "Full-body shot showing the entire figure",
        "뒷모습": "Shot from behind (back view of the subject)",
        "인물 없이": "No people in the image — object/landscape centered composition",
    }
    _PALETTE_MAP = {
        "파스텔": "soft pastel color palette",
        "비비드": "vivid, highly saturated colors",
        "다크 무디": "dark, moody tones with low-key lighting",
        "흑백": "black and white monochrome",
    }
    _extra_parts = []
    if shot and shot.strip():
        _extra_parts.append("Composition: {}.".format(_SHOT_MAP.get(shot.strip(), shot.strip())))
    if expression and expression.strip():
        # v245 — 인물 표정 (한국어 그대로 전달 — enhance/이미지 모델 모두 처리 가능)
        _extra_parts.append("Facial expression of the main subject: {}.".format(expression.strip()[:100]))
    if palette and palette.strip():
        _extra_parts.append("Color palette: {}.".format(_PALETTE_MAP.get(palette.strip(), palette.strip())))
    if background_prompt and background_prompt.strip():
        _extra_parts.append("Background / scene: {}.".format(background_prompt.strip()[:300]))
    if background_image_bytes:
        _extra_parts.append(
            "A background reference photo is provided — set the scene in this exact place: "
            "match its scenery/architecture, lighting, time of day, and color tone."
        )
    if lyrics_excerpt and lyrics_excerpt.strip():
        _extra_parts.append(
            "Scene inspiration from the song lyrics (use mood and imagery only — "
            "do NOT render any of these words as text in the image): {}".format(lyrics_excerpt.strip()[:400])
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
        # v234: 대화 보강 절도 Claude 보강 경로에 동일 반영
        for _p in _extra_parts:
            basic_info += f"\n{_p}"
        # v235: 가상 캐릭터 화풍 명시 — 실사 변환 금지
        if character_image_bytes and (character_kind or "").strip().lower() == "virtual":
            basic_info += "\nCharacter: illustrated in {} — the cover must stay illustrated in this style, never photorealistic.".format(
                (character_art_style or "").strip() or "the reference sheet's art style"
            )

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
                "reference sheet — do not change clothing items even if the cover theme suggests otherwise. "
                # v239 — 프린트/그래픽 충실도(백프린트 포함): 단순화·누락 금지
                "Explicitly instruct that every print, graphic, logo and pattern on the garments "
                "(including on the back of tops) must be reproduced exactly as in the reference."
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
            # v161 — 캐싱 비적용(system ~200-350 tok < 최소 캐시 길이 — 마커 미부착).
            # [cache] 로깅만 부착: create=0/read=0 이 비적용의 실측 증거.
            from .claude_cache import log_cache_usage

            log_cache_usage("cover_enhance", prompt_model, getattr(response, "usage", None))
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

        _is_virtual_char = (character_kind or "").strip().lower() == "virtual"
        if character_image_bytes:
            if _is_virtual_char:
                # [A-v] v235: 가상(만화) 캐릭터 시트 — 시트의 화풍을 따르는 일러스트 강제
                _style_label = (character_art_style or "").strip() or "the illustrated art style of the character reference sheet"
                prompt_parts.append(
                    "The image MUST be fully illustrated in {style} — matching the character "
                    "reference sheet's art style exactly. Do NOT render the character or the scene "
                    "as a photograph or photorealistic/live-action image. The image should be square "
                    "(1:1 aspect ratio), visually striking, suitable as a music album cover. "
                    "Do NOT include any text or letters in the image.".format(style=_style_label)
                )
                prompt_parts.append(
                    "IMPORTANT: The provided character reference sheet shows the main character. "
                    "Feature this character prominently in the album cover as the main subject. "
                    "Maintain the character's exact design (face, hair, features) from the reference. "
                    "Also PRESERVE THE WARDROBE / OUTFIT (top, bottom, shoes, accessories) shown in "
                    "the reference sheet — do not change clothing items even if the cover theme suggests otherwise. "
                    "The character must stay illustrated in the same art style as the reference — "
                    "never photorealistic."
                )
            else:
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
            if _is_virtual_char:
                # v235: 가상은 촬영 기법 대신 일러스트 연출 지시
                prompt_parts.append(
                    "Use intentional illustrated composition: dynamic framing and angles, "
                    "expressive lighting and shading consistent with the art style, and a "
                    "deliberate color design that makes the cover visually striking."
                )
            else:
                prompt_parts.append(
                    "Use cinematic photography techniques: choose an appropriate focal length "
                    "(50mm for natural, 85mm for portrait, 35mm for environmental), "
                    "apply professional lighting (key light, fill, rim/hair light), "
                    "and use intentional depth of field to separate subject from background."
                )
            # v234: 대화 보강 절(구도/색감/배경/가사) — 사용자 지시가 고정 문구보다 뒤에 오도록
            prompt_parts.extend(_extra_parts)
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
            # v234: 대화 보강 절(구도/색감/배경/가사)
            prompt_parts.extend(_extra_parts)
            if user_prompt:
                prompt_parts.append("Style and direction: {}".format(user_prompt))
            # v42: append user-location anchor when supplied (no character)
            if user_location_image_bytes:
                _loc_clause = anchor_clause("cover", user_location_name, has_character=False)
                if _loc_clause:
                    prompt_parts.append(_loc_clause)

        prompt = " ".join(prompt_parts)

    # v239(대표): 의상 충실도 강제 — Claude 보강/프로그래매틱 어느 경로든 최종 프롬프트에 항상 부착.
    # 핵심: ①옷의 프린트·그래픽·로고·패턴(상의 '뒷면' 포함)을 단순화/누락 없이 그대로 재현
    #      ②"텍스트 금지"는 타이틀/오버레이 한정 — 옷 그래픽에 포함된 글자는 의상의 일부로 재현.
    if character_image_bytes:
        prompt += (
            "\nSTRICT WARDROBE FIDELITY: reproduce the character's outfit EXACTLY as shown in the "
            "reference images — every print, graphic, logo, pattern and lettering on each garment "
            "(including graphics on the BACK of tops) must appear precisely as in the references, "
            "never simplified, altered or omitted. The no-text rule applies only to overlay/title "
            "text: lettering that is part of the clothing graphics in the references is part of the "
            "wardrobe and MUST be reproduced faithfully."
        )
        if outfit_item_images:
            _names = ", ".join([str(n)[:60] for n in (outfit_item_names or []) if n][:3])
            prompt += (
                "\nClose-up product photos of the exact outfit items are attached as additional "
                "references{names} — match the garments' colors, cuts, prints and graphics to these "
                "product photos precisely."
            ).format(names=f" ({_names})" if _names else "")
        logger.info(
            "[CoverGen] wardrobe fidelity clause on, outfit_item_refs=%d",
            len(outfit_item_images or []),
        )

    # v55: branch by image_model. nb_pro (default) keeps the existing Gemini
    # path bit-for-bit. gpt_image_2 forwards prompt + ref bytes to OpenAI.
    logger.info("[CoverGen] image_model=%s", image_model)
    if image_model == "gpt_image_2":
        from .openai_image import generate_image as _openai_generate_image

        _refs: list = []
        if character_image_bytes:
            _refs.append(character_image_bytes)
        # v239 — 착장 아이템 제품컷 (최대 3): 시트에 작게 보이는 프린트/그래픽의 고해상 근거
        for _it in (outfit_item_images or [])[:3]:
            if _it:
                _refs.append(_it)
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

    if character_image_bytes and (character_kind or "").strip().lower() == "virtual":
        # v235: 가상 캐릭터 — 일러스트 아트 디렉터 페르소나
        system_text = (
            "You are a world-class album cover art director and illustrator. "
            "You specialize in creating iconic, visually striking illustrated album covers "
            "that match a given character's art style exactly — never converting "
            "illustrated characters into photorealistic imagery. You have deep expertise "
            "in composition, lighting, color design, and visual storytelling for the music industry."
        )
    elif character_image_bytes:
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

    # v137 [watermark]: 비가시 AI 마커 삽입 (커버 저장 전 공통 —
    # gpt_image_2 분기는 openai_image.generate_image 내부에서 동일 적용됨).
    from .watermark import embed_image_metadata

    return embed_image_metadata(image_bytes)


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
                    # v137 [watermark]: 비가시 AI 마커 삽입 (refine 결과 공통).
                    from .watermark import embed_image_metadata

                    return embed_image_metadata(base64.b64decode(inline_data["data"]))
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
