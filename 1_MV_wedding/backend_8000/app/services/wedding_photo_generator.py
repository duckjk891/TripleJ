"""
v13 — 웨딩사진 생성기.

Step A: Gemini 2.5 Flash 로 photorealistic 웨딩 사진용 이미지 prompt 생성.
Step B: gpt_image_2 또는 nb_pro 로 이미지 생성 (ref_images=[groom, bride, place]).

ref_images 는 3개로 고정. character_generator 의 Gemini 호출 헬퍼(`_call_gemini_text`,
`_call_gemini_image`) 와 openai_image 의 `generate_image` 를 그대로 재사용한다.

로그 prefix: `[WeddingPhotoGen]`. 추적자: `mv_job_id`, `photo_id`, `image_model`,
`user_id`, `elapsed_ms`. 본문(user_text) 은 길이만 로깅한다.
"""

from __future__ import annotations

import base64
import logging
import time
from typing import Optional

from .character_generator import _call_gemini_image, _call_gemini_text
from .openai_image import generate_image as openai_generate_image

logger = logging.getLogger(__name__)


WEDDING_PHOTO_SYSTEM_PROMPT = """역할: 결혼식 웨딩 사진 한 장을 photorealistic 으로 그려내기 위한 이미지 모델용
프롬프트를 작성하는 전문가.

[입력 컨텍스트]
- 신랑 캐릭터 시트 (이미지 참조 1): {groom_display_name}, 스타일: {groom_style_label}
- 신부 캐릭터 시트 (이미지 참조 2): {bride_display_name}, 스타일: {bride_style_label}
- 장소 (이미지 참조 3): {place_display_name}{place_memo_block}
- 사용자 지시사항: {user_text}
- 멘션 목록 (지시사항 안의 @ 토큰): {mentions_list}

[규칙]
① ref_image_1=신랑 인물 일관성, ref_image_2=신부 인물 일관성, ref_image_3=장소 배경 일관성.
② @<이름> 토큰은 그대로 출력하지 말고 해당 인물/장소의 시각적 설명으로 변환.
③ Photorealistic, natural lighting, cinematic wedding photography 톤.
④ 두 인물의 표정·자세·소품·시선·거리·구도까지 구체적으로 묘사.
⑤ 출력은 이미지 모델 prompt 영문 1단락만. 따옴표/머리말/번호매김/해설 없음.
⑥ 사용자 지시사항이 비어 있어도 자연스럽고 따뜻한 기본 웨딩 컷 묘사.
"""


# v15 — refine 모드 추가 규칙. WEDDING_PHOTO_SYSTEM_PROMPT 뒤에 append 한다.
WEDDING_PHOTO_REFINE_APPENDIX = """

[모드: refine]
참조 1 = 직전 결과 사진. 인물·장소·구도·색감을 최대한 보존.
참조 2~4 = 신랑 시트 / 신부 시트 / 장소 (인물·장소 일관성 강제용 보조 참조).

[수정 요청] {refine_request}
[멘션 토큰] {refine_mention_list}

규칙:
- 원본의 분위기·구도·인물 일관성을 최대한 보존하고 요청한 부분만 변경.
- "원본을 완전히 새로 그리기" 같은 큰 변경은 피하고 점진적 수정.
- @-토큰은 텍스트로 출력하지 말고 시각적 설명으로 변환.
- Photorealistic, natural lighting 톤 유지.
"""


STYLE_LABEL = {"casual": "평상복", "wedding": "웨딩 촬영복"}


def _inline_part(image_bytes: bytes, mime_type: str) -> dict:
    """Build a Gemini inlineData part from raw bytes + mime."""
    b64 = base64.b64encode(image_bytes or b"").decode("utf-8")
    return {
        "inlineData": {
            "mimeType": mime_type or "image/png",
            "data": b64,
        }
    }


async def generate_wedding_photo(
    *,
    groom_bytes: bytes,
    groom_mime: str,
    groom_display_name: str,
    groom_style: str,
    bride_bytes: bytes,
    bride_mime: str,
    bride_display_name: str,
    bride_style: str,
    place_bytes: bytes,
    place_mime: str,
    place_display_name: str,
    place_memo: str,
    image_model: str,
    user_text: str,
    user_text_refs: list[dict],
    mv_job_id: Optional[str] = None,
    photo_id: Optional[str] = None,
    user_id: Optional[str] = None,
    # v15 — refine 모드.
    mode: str = "generate",
    parent_bytes: Optional[bytes] = None,
    parent_mime: str = "image/png",
    refine_request: str = "",
    refine_request_refs: Optional[list[dict]] = None,
) -> bytes:
    """Two-step wedding photo generation.

    Args:
      groom_*/bride_*/place_*: raw image bytes + mime per ref slot.
      groom_style/bride_style: "casual" | "wedding" — used only as a label in
        the Step A prompt.
      place_display_name/place_memo: human strings for prompt context.
      image_model: "gpt_image_2" | "nb_pro".
      user_text: user instruction (free text). Logged as length only.
      user_text_refs: list of MentionRef dicts (display_name / type / asset_id /
        object_name). The Step A prompt enumerates `@display_name` so the LLM
        can resolve them.
      mv_job_id / photo_id / user_id: tracing tags.
      mode: "generate" | "refine". refine 일 때 parent_* 와 refine_request 사용.
      parent_bytes/parent_mime: refine 모드에서 직전 결과 사진 (ref_image 첫 번째).
      refine_request: 수정 지시 문장.
      refine_request_refs: 수정 지시 내 @-토큰 (MentionRef dict 들).

    Returns:
      PNG bytes of the rendered wedding photo.
    """
    started = time.time()
    is_refine = (mode == "refine")
    logger.info(
        "[WeddingPhotoGen] entry mv_job_id=%s photo_id=%s image_model=%s "
        "user_id=%s mode=%s text_len=%d ref_count=%d refine_len=%d "
        "refine_refs=%d parent_bytes_len=%d",
        mv_job_id, photo_id, image_model, user_id, mode,
        len(user_text or ""), len(user_text_refs or []),
        len(refine_request or ""), len(refine_request_refs or []),
        len(parent_bytes or b""),
    )

    if is_refine and not parent_bytes:
        raise ValueError("refine mode requires parent_bytes")

    # ── Step A — Gemini text 합성 ──────────────────────────────────────────
    mention_lines: list[str] = []
    for r in (user_text_refs or []):
        try:
            name = (r or {}).get("display_name") or ""
        except Exception:
            name = ""
        name = name.strip()
        if name:
            mention_lines.append("- @{}".format(name))
    mentions_list = "\n".join(mention_lines) or "(없음)"

    place_memo_v = (place_memo or "").strip()
    place_memo_block = "\n  메모: {}".format(place_memo_v) if place_memo_v else ""

    step_a_prompt = WEDDING_PHOTO_SYSTEM_PROMPT.format(
        groom_display_name=groom_display_name or "(이름 없음)",
        groom_style_label=STYLE_LABEL.get(groom_style, groom_style or ""),
        bride_display_name=bride_display_name or "(이름 없음)",
        bride_style_label=STYLE_LABEL.get(bride_style, bride_style or ""),
        place_display_name=place_display_name or "(이름 없음)",
        place_memo_block=place_memo_block,
        user_text=(user_text or "").strip()
            or "(특별한 지시 없음 — 자연스럽고 따뜻한 웨딩 컷)",
        mentions_list=mentions_list,
    )

    if is_refine:
        refine_mention_lines: list[str] = []
        for r in (refine_request_refs or []):
            try:
                name = (r or {}).get("display_name") or ""
            except Exception:
                name = ""
            name = name.strip()
            if name:
                refine_mention_lines.append("- @{}".format(name))
        refine_mention_list = "\n".join(refine_mention_lines) or "(없음)"
        step_a_prompt = step_a_prompt + WEDDING_PHOTO_REFINE_APPENDIX.format(
            refine_request=(refine_request or "").strip()
                or "(수정 요청 비어 있음 — 큰 변경 없이 디테일만 보정)",
            refine_mention_list=refine_mention_list,
        )

    # refine 일 때 ref_images 앞에 parent prepend → [parent, groom, bride, place] 4개.
    if is_refine:
        step_a_image_parts = [
            _inline_part(parent_bytes or b"", parent_mime or "image/png"),
            _inline_part(groom_bytes, groom_mime or "image/png"),
            _inline_part(bride_bytes, bride_mime or "image/png"),
            _inline_part(place_bytes, place_mime or "image/png"),
        ]
    else:
        step_a_image_parts = [
            _inline_part(groom_bytes, groom_mime or "image/png"),
            _inline_part(bride_bytes, bride_mime or "image/png"),
            _inline_part(place_bytes, place_mime or "image/png"),
        ]

    logger.info(
        "[WeddingPhotoGen] step_a calling gemini text mv_job_id=%s photo_id=%s "
        "mode=%s prompt_len=%d parts=%d",
        mv_job_id, photo_id, mode, len(step_a_prompt), len(step_a_image_parts),
    )

    step_a_text = await _call_gemini_text(
        step_a_prompt, step_a_image_parts,
        role=None, style=None, user_id=user_id,
    )
    step_a_text = (step_a_text or "").strip()
    if not step_a_text:
        raise ValueError("Gemini Step A returned empty text")

    logger.info(
        "[WeddingPhotoGen] step_a done mv_job_id=%s photo_id=%s mode=%s text_len=%d",
        mv_job_id, photo_id, mode, len(step_a_text),
    )

    # ── Step B — 이미지 모델 호출 ─────────────────────────────────────────
    if is_refine:
        step_b_ref_images = [parent_bytes, groom_bytes, bride_bytes, place_bytes]
    else:
        step_b_ref_images = [groom_bytes, bride_bytes, place_bytes]

    if image_model == "gpt_image_2":
        logger.info(
            "[WeddingPhotoGen] step_b calling openai_image mv_job_id=%s "
            "photo_id=%s mode=%s ref_count=%d",
            mv_job_id, photo_id, mode, len(step_b_ref_images),
        )
        image_bytes = await openai_generate_image(
            prompt=step_a_text,
            ref_images=step_b_ref_images,
            size="1024x1024",
            quality="high",
        )
    elif image_model == "nb_pro":
        logger.info(
            "[WeddingPhotoGen] step_b calling gemini image mv_job_id=%s "
            "photo_id=%s mode=%s ref_count=%d",
            mv_job_id, photo_id, mode, len(step_a_image_parts),
        )
        image_bytes = await _call_gemini_image(
            step_a_text, step_a_image_parts,
            role=None, style=None, user_id=user_id,
        )
    else:
        raise ValueError("unsupported image_model: {}".format(image_model))

    elapsed_ms = int((time.time() - started) * 1000)
    logger.info(
        "[WeddingPhotoGen] ok mv_job_id=%s photo_id=%s image_model=%s mode=%s "
        "elapsed_ms=%d bytes=%d",
        mv_job_id, photo_id, image_model, mode, elapsed_ms,
        len(image_bytes or b""),
    )
    return image_bytes
