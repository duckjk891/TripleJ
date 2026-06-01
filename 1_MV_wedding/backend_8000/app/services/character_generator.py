"""
AI Character Sheet Generator (wedding edition).

Two-step process:
  Step A: Gemini text model analyzes the photo and generates a character sheet
          prompt using the master prompt template.
  Step B: Either Gemini image model (NanoBanana Pro) OR OpenAI GPT Image 2
          generates the character sheet image from the prompt + photo +
          optional outfit reference images. Default is `gpt_image_2`.

All logs use prefix `[CharGen]` and include `role`, `style`, `user_id` when
those optional kwargs are supplied for traceability.
"""

import base64
import logging
import re
import time
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# ── API endpoints ─────────────────────────────────────────────────────────────

GEMINI_TEXT_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

GEMINI_IMAGE_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)

# ── Master Prompt (hardcoded from 마스터 프롬프트 txt) ─────────────────────────

MASTER_PROMPT = r"""다음 절차를 반드시 순서대로 따르시오:

--------------------------------------------------

STEP 1
사용자에게 다음과 같이 질문하시오:
"캐릭터의 특징을 나열하여 주세요."

[사용자 답변]:
{step1_answer}

--------------------------------------------------

STEP 2
사용자에게 다음과 같이 질문하시오:
"이미지의 Art Style을 입력해주세요."

[사용자 답변]:
Photorealistic (실사)

--------------------------------------------------

STEP 4
사용자의 입력을 기반으로 "고정 요소"와 "변형 가능 요소"를 분리하시오.

[고정 요소]
- 사용자가 명시적으로 입력한 모든 특징
- 성별, 나이, 인종, 핵심 외형 등

[변형 가능 요소]
- 사용자가 입력하지 않은 모든 세부 요소
- 색상, 재질, 디테일 구조, 악세사리, 세부 치수 등

--------------------------------------------------

[입력 해석 및 우선순위 규칙]

사용자의 입력은 아래 두 가지 유형으로 분류하시오:

1) 명확한 묘사 (Explicit Traits)
- 외형, 수치, 색상, 구조 등 직접적으로 정의된 정보
- 예: "검은 머리", "단발", "키 170cm", "마른 체형"

2) 암시적 표현 (Implicit Traits)
- 분위기, 성격, 인상, 감정 등 간접적인 정보
- 예: "차가운 느낌", "도도한 성격", "몽환적인 분위기"

--------------------------------------------------

[반영 규칙]

1. 명확한 묘사는 해당 항목에 그대로 반영할 것 (수정 금지)

2. 암시적 표현은 직접적으로 항목에 쓰지 말고,
   그 의미를 해석하여 비어 있는 세부 항목들에 구체적인 형태로 변환하여 반영할 것

--------------------------------------------------

[충돌 해결 규칙]

- 명확한 묘사 > 암시적 표현

- 두 요소가 충돌할 경우:
  → 명확한 묘사를 절대 우선으로 유지할 것
  → 암시적 표현은 해당 범위 내에서만 제한적으로 반영할 것

--------------------------------------------------

[출력 금지 규칙]

- 분위기, 성격 등의 추상적 표현을 그대로 출력하지 말 것
- 반드시 물리적/시각적 요소로 변환하여 작성할 것

--------------------------------------------------

STEP 5
고정 요소와 변형 가능 요소를 기반으로, 하나의 캐릭터 시트를 생성하시오.

규칙:

[공통 규칙]
- 고정 요소는 반드시 유지할 것
- 전체 레이아웃 구조는 템플릿을 그대로 따를 것

[생성 규칙]
- 변형 가능 요소를 활용하여 누락된 모든 디테일을 보완할 것
- 모든 요소는 구체적이고 명확하게 정의할 것
- 모호하거나 추상적인 표현은 사용하지 말 것

--------------------------------------------------

STEP 6
각 시트에 대해, 누락된 모든 정보를 보완하여 완전한 스펙을 생성하시오.

모든 요소는 반드시 아래 기준으로 정의할 것:

- Position (위치)
- Size (치수)
- Shape (형태)
- Material (재질)
- State (상태)

모호한 표현 금지.

--------------------------------------------------

[포즈 제약 규칙]

- 캐릭터는 반드시 반듯하게 선 정자세를 유지할 것
- 과장된 동작이나 역동적인 포즈는 금지
- 팔과 다리는 신체 구조에 맞게 자연스럽게 정렬될 것
- 소지품이 있을 경우, 물리적으로 자연스럽고 어색하지 않은 방식으로 들고 있을 것

--------------------------------------------------

STEP 7
각 시트는 아래 템플릿을 절대 수정하지 말고 그대로 사용하여 생성하시오.

- 구조 변경 금지
- 항목 삭제 금지
- 순서 변경 금지
- 모든 항목은 최대한 상세하게 작성

--------------------------------------------------

STEP 8 (출력 규칙)

- 각 시트는 반드시 하나의 코드블록으로 출력할 것
- 코드블록 외에는 어떤 텍스트도 출력하지 말 것

--------------------------------------------------

<CHARACTER SHEET TEMPLATE>

**[OVERALL COMPOSITION - FIXED LAYOUT]**
A professional character design sheet featuring a single [Gender] character, [Art Style], high-quality, 4k resolution, neutral grey studio background (#808080).

The canvas is divided into FOUR vertical sections (1x4 layout), arranged from left to right:

--------------------------------------------------

[SECTION 1 - RIGHT 45° FULL BODY]
- Full body view from a 45-degree angle facing right
- Character stands upright in a neutral, straight posture
- Arms relaxed naturally at the sides unless holding a prop
- If holding a prop, the pose must naturally incorporate the item

--------------------------------------------------

[SECTION 2 - LEFT 45° FULL BODY]
- Full body view from a 45-degree angle facing left
- Same posture and proportional consistency as Section 1
- No pose variation except mirrored orientation

--------------------------------------------------

[SECTION 3 - BACK FULL BODY]
- Full body view from directly behind
- Upright neutral standing posture
- Clear visibility of back structure (hair, outfit, silhouette)

--------------------------------------------------

[SECTION 4 - FACE DETAIL STACK (VERTICAL 3-SPLIT)]

Top:
- Face view from a 45-degree angle facing right

Middle:
- Face view from a 45-degree angle facing left

Bottom:
- Face view from directly behind

Rules:
- Equal vertical spacing
- Zoomed-in framing focused on head only
- Consistent scale and alignment

--------------------------------------------------

[GLOBAL LAYOUT RULES]

- All sections must maintain consistent character proportions
- No perspective distortion between sections
- Strict alignment and equal spacing across all divisions
- No rearrangement of section order
- Clean separation between sections

--------------------------------------------------

**[CHARACTER SPECIFICATION - FULL DEFINITION]**

[Identity]
- Gender:
- Age:
- Ethnicity:

[Body]
- Height:
- Proportion:
- Build:
- Shoulder width:
- Waist:
- Hip:
- Posture:

[Pose]
- A-pose
- Arms:
- Elbows:
- Hands:
- Legs:
- Weight distribution:

--------------------------------------------------

[Face]
- Shape:
- Jaw:
- Chin:
- Eyes:
- Eye color:
- Eye size:
- Brows:
- Nose:
- Lips:
- Skin:
- Expression:

[Makeup]
- Base:
- Blush:
- Eyeshadow:
- Eyeliner:
- Mascara:
- Lips:

--------------------------------------------------

[Hair]
- Length:
- Part:
- Structure:
- Strand thickness:
- Layering:
- Volume:
- Flow:
- Color:
- Surface:
- State:

--------------------------------------------------

[Outfit]

Top:
- Type:
- Length:
- Fit:
- Neckline:
- Sleeve:
- Fabric:
- Wrinkles:

Skirt:
- Type:
- Waist position:
- Length:
- Shape:
- Structure:
- Pleats:
- Fabric:
- Movement:

--------------------------------------------------

[Footwear]
- Type:
- Heel height:
- Sole thickness:
- Shape:
- Coverage:
- Material:
- Color:
- Fit:
- State:

--------------------------------------------------

[Accessories / Wear Position]

Earrings:
- Type:
- Length:
- Material:
- Position:
- Movement:

Necklace:
- Type:
- Lengths:
- Position:
- Material:

Rings:
- Count:
- Placement:
- Material:

Bracelet:
- Wrist:
- Fit:
- Material:

--------------------------------------------------

[Props]
-

--------------------------------------------------

**[TECHNICAL SPECIFICATIONS]**

[Lighting]
- Key:
- Fill:
- Rim:
- Shadow:

[Rendering Style]
-

[Color Control]
-

[Consistency Rules]
-

[Final Constraint]
-"""


# ── STEP 1 answers: 16 variations by user_text + outfit image attachment ───

_USER_TEXT_SUFFIX = (
    " 추가로, 사용자가 아래와 같이 캐릭터 특징을 직접 설명하였으므로 이를 최우선으로 반영하시오:"
    " 「{user_text}」"
    " 사용자 설명과 사진이 충돌하면 사용자 설명을 우선하시오."
)

STEP1_ANSWERS = {
    # ── 텍스트 없음 (0_xxx): 기존 8가지 ──
    "0_000": (
        "첨부된 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "의상과 신발도 사진 속 인물이 착용하고 있는 것을 그대로 분석하여 반영하라. "
        "사진에서 보이지 않는 부위는 자유롭게 생성하라."
    ),
    "0_100": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 사진 속 의상 대신 별도 첨부된 두번째 이미지(상의 참조)를 "
        "분석하여 반영하시오. 하의와 신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_010": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Skirt/Bottom] 항목은 사진 속 의상 대신 별도 첨부된 두번째 이미지(하의 참조)를 "
        "분석하여 반영하시오. 상의와 신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_001": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Footwear] 항목은 사진 속 신발 대신 별도 첨부된 두번째 이미지(신발 참조)를 "
        "분석하여 반영하시오. 상의와 하의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_110": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Outfit > Skirt/Bottom] 항목은 별도 첨부된 세번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_101": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 세번째 이미지(신발 참조)를 분석하여 반영하시오. "
        "하의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_011": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Skirt/Bottom] 항목은 별도 첨부된 두번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 세번째 이미지(신발 참조)를 분석하여 반영하시오. "
        "상의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
    ),
    "0_111": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Outfit > Skirt/Bottom] 항목은 별도 첨부된 세번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 네번째 이미지(신발 참조)를 분석하여 반영하시오."
    ),
    # ── 텍스트 있음 (1_xxx): 0_xxx + 사용자 텍스트 블록 ──
    "1_000": (
        "첨부된 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "의상과 신발도 사진 속 인물이 착용하고 있는 것을 그대로 분석하여 반영하라. "
        "사진에서 보이지 않는 부위는 자유롭게 생성하라."
        + _USER_TEXT_SUFFIX
    ),
    "1_100": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 사진 속 의상 대신 별도 첨부된 두번째 이미지(상의 참조)를 "
        "분석하여 반영하시오. 하의와 신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_010": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Skirt/Bottom] 항목은 사진 속 의상 대신 별도 첨부된 두번째 이미지(하의 참조)를 "
        "분석하여 반영하시오. 상의와 신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_001": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Footwear] 항목은 사진 속 신발 대신 별도 첨부된 두번째 이미지(신발 참조)를 "
        "분석하여 반영하시오. 상의와 하의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_110": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Outfit > Skirt/Bottom] 항목은 별도 첨부된 세번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "신발은 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_101": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 세번째 이미지(신발 참조)를 분석하여 반영하시오. "
        "하의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_011": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Skirt/Bottom] 항목은 별도 첨부된 두번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 세번째 이미지(신발 참조)를 분석하여 반영하시오. "
        "상의는 사진에서 보이면 그대로 반영, 안 보이면 자유롭게 생성하시오."
        + _USER_TEXT_SUFFIX
    ),
    "1_111": (
        "첨부된 첫번째 사진 속 인물의 외모 특징을 분석하여 사용하시오. "
        "사진에서 관찰되는 성별, 나이대, 인종, 체형, 얼굴, 머리카락, 눈, 피부톤 등 "
        "모든 시각적 특징을 정밀하게 추출하여 반영하라. "
        "단, [Outfit > Top] 항목은 별도 첨부된 두번째 이미지(상의 참조)를 분석하여 반영하시오. "
        "[Outfit > Skirt/Bottom] 항목은 별도 첨부된 세번째 이미지(하의 참조)를 분석하여 반영하시오. "
        "[Footwear] 항목은 별도 첨부된 네번째 이미지(신발 참조)를 분석하여 반영하시오."
        + _USER_TEXT_SUFFIX
    ),
}


def _build_inline_images(
    photo_b64,
    photo_mime,
    top_bytes,
    top_mime,
    bottom_bytes,
    bottom_mime,
    shoes_bytes,
    shoes_mime,
):
    """Build ordered list of inlineData parts: photo (required) + optional outfit images."""
    parts = [
        {"inlineData": {"mimeType": photo_mime, "data": photo_b64}},
    ]
    if top_bytes:
        parts.append({
            "inlineData": {
                "mimeType": top_mime or "image/jpeg",
                "data": base64.b64encode(top_bytes).decode("utf-8"),
            }
        })
    if bottom_bytes:
        parts.append({
            "inlineData": {
                "mimeType": bottom_mime or "image/jpeg",
                "data": base64.b64encode(bottom_bytes).decode("utf-8"),
            }
        })
    if shoes_bytes:
        parts.append({
            "inlineData": {
                "mimeType": shoes_mime or "image/jpeg",
                "data": base64.b64encode(shoes_bytes).decode("utf-8"),
            }
        })
    return parts


def _extract_code_block(text: str) -> str:
    """Extract content from a markdown code block, or return the full text."""
    match = re.search(r"```[\w]*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


CHARACTER_SYSTEM_INSTRUCTION = (
    "You are a professional character designer and concept artist for film and music video production. "
    "You specialize in creating detailed, consistent character reference sheets that maintain visual "
    "coherence across multiple scenes. You have extensive experience in translating abstract personality "
    "descriptions into concrete physical and visual attributes."
)


def _trace_kv(
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """Build "role=X style=Y user_id=Z" trailer for log lines (skip None entries)."""
    parts = []
    if user_id:
        parts.append("user_id={}".format(user_id))
    if role:
        parts.append("role={}".format(role))
    if style:
        parts.append("style={}".format(style))
    return " ".join(parts)


async def _call_gemini_text(
    prompt: str,
    image_parts: list,
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """Step A: Call Gemini text model to generate a character sheet prompt."""
    payload = {
        "systemInstruction": {
            "parts": [{"text": CHARACTER_SYSTEM_INSTRUCTION}]
        },
        "contents": [{
            "parts": [
                {"text": prompt},
                *image_parts,
            ]
        }],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 8192,
        },
    }

    trailer = _trace_kv(role, style, user_id)
    logger.info(
        "[CharGen] Step A: calling Gemini text (parts=%d) %s",
        len(image_parts),
        trailer,
    )
    # user requested very generous timeout — Gemini text can run slow when image
    # parts are large; bumped 120s → 300s (5 min) margin.
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(
            GEMINI_TEXT_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )
    elapsed_s = time.monotonic() - start
    logger.info(
        "[CharGen] Step A: Gemini text http=%d elapsed_s=%.1f %s",
        resp.status_code, elapsed_s, trailer,
    )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini text API error (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini text response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        if part.get("text"):
            return part["text"]

    raise ValueError("No text in Gemini text response")


async def _call_image_backend(
    prompt: str,
    image_parts: list,
    image_model: str = "gpt_image_2",
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
) -> bytes:
    """Dispatch Step B image generation across model backends.

    image_model:
      - "gpt_image_2" (default): OpenAI GPT Image 2 — converts `image_parts`
        (Gemini inlineData dicts) back to raw bytes and calls
        `openai_image.generate_image`.
      - "nb_pro": Gemini Nano Banana Pro — delegates to `_call_gemini_image`.
    """
    trailer = _trace_kv(role, style, user_id)
    logger.info(
        "[CharGen] image_model=%s parts=%d %s",
        image_model,
        len(image_parts),
        trailer,
    )
    if image_model == "gpt_image_2":
        from .openai_image import generate_image

        ref_bytes: list = []
        for part in image_parts or []:
            inline = part.get("inlineData") if isinstance(part, dict) else None
            data_b64 = (inline or {}).get("data")
            if data_b64:
                try:
                    ref_bytes.append(base64.b64decode(data_b64))
                except Exception:
                    continue
        # v29 — 캐릭터 시트는 인물 portrait 표준에 맞춰 1:1 유지.
        # openai_image.generate_image 의 default 가 16:9(2048x1152) 로 바뀌었으므로
        # 시트 호출 시 명시적으로 1:1 박는다.
        return await generate_image(
            prompt=prompt, ref_images=ref_bytes, size="2048x2048",
        )

    # default fall-through branch — nb_pro
    return await _call_gemini_image(
        prompt, image_parts, role=role, style=style, user_id=user_id
    )


async def _call_gemini_image(
    prompt: str,
    image_parts: list,
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
    *,
    aspect_ratio: str = "1:1",
    image_size: str = "2K",
) -> bytes:
    """Step B: Call Gemini image model to generate the requested image.

    v29 — `aspect_ratio` / `image_size` 옵션 추가. 캐릭터 시트는 default "1:1"
    유지, 씬/장소/웨딩사진 등 호출자는 명시적으로 "16:9" 박는다.
    payload.generationConfig.imageConfig 위치 (Gemini 3 native).
    """
    from .llm_thinking_config import apply_thinking_to_gemini_image_payload
    payload = {
        "systemInstruction": {
            "parts": [{"text": CHARACTER_SYSTEM_INSTRUCTION}]
        },
        "contents": [{
            "parts": [
                {"text": prompt},
                *image_parts,
            ]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size,
            },
        },
    }
    # v28 — Nano Banana Pro adaptive thinking (high). Image preview 모델이
    # thinkingConfig 받지 않는 경우 fallback 으로 제거 후 1회 재시도.
    apply_thinking_to_gemini_image_payload(payload)

    trailer = _trace_kv(role, style, user_id)
    logger.info(
        "[CharGen] Step B: calling Gemini image (parts=%d) thinking=%s %s",
        len(image_parts),
        bool((payload.get("generationConfig") or {}).get("thinkingConfig")),
        trailer,
    )
    # Nano Banana Pro is typically 30~60s per call — 180s timeout already
    # comfortable; keep as-is.
    start = time.monotonic()
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            GEMINI_IMAGE_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )
    elapsed_s = time.monotonic() - start
    logger.info(
        "[CharGen] Step B: Gemini image http=%d elapsed_s=%.1f %s",
        resp.status_code, elapsed_s, trailer,
    )

    # v28 — thinkingConfig 거부 fallback. 400 + 응답 본문에 "thinking" 키 언급 시
    # thinkingConfig 제거 후 1회 재시도.
    if (
        resp.status_code == 400
        and "thinking" in (resp.text or "").lower()
        and (payload.get("generationConfig") or {}).get("thinkingConfig")
    ):
        logger.warning(
            "[CharGen] Step B: Gemini image rejected thinkingConfig — "
            "falling back to no-thinking retry %s",
            trailer,
        )
        payload.get("generationConfig", {}).pop("thinkingConfig", None)
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                GEMINI_IMAGE_API_URL,
                params={"key": settings.google_api_key},
                json=payload,
            )
        logger.info(
            "[CharGen] Step B: Gemini image (no-thinking retry) http=%d %s",
            resp.status_code, trailer,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError(
            "Gemini image API error (HTTP {}): {}".format(resp.status_code, detail)
        )

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini image response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("No image generated from Gemini image response")


async def generate_character_sheet(
    photo_bytes: bytes,
    mime_type: str = "image/jpeg",
    top_bytes: Optional[bytes] = None,
    top_mime: Optional[str] = None,
    bottom_bytes: Optional[bytes] = None,
    bottom_mime: Optional[str] = None,
    shoes_bytes: Optional[bytes] = None,
    shoes_mime: Optional[str] = None,
    user_text: str = "",
    image_model: str = "gpt_image_2",
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
) -> bytes:
    """Generate photorealistic character sheet from reference photo.

    Two-step process:
      Step A: Gemini text model analyzes photo + master prompt -> character sheet prompt text
      Step B: Image model (GPT Image 2 default, or NanoBanana Pro) generates character sheet image

    Optional outfit images (top/bottom/shoes) switch the STEP 1 answer to reference
    those images for the corresponding outfit sections.
    Optional user_text adds user-described character traits with highest priority.

    Returns PNG bytes of the character sheet image.
    """
    trailer = _trace_kv(role, style, user_id)
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8")

    # Determine combination key: "{text_flag}_{top}{bottom}{shoes}"
    key = "{}_{}{}{}".format(
        1 if user_text else 0,
        1 if top_bytes else 0,
        1 if bottom_bytes else 0,
        1 if shoes_bytes else 0,
    )
    step1_answer = STEP1_ANSWERS[key]
    # Replace {user_text} placeholder with actual user input
    if user_text:
        step1_answer = step1_answer.format(user_text=user_text)
    logger.info(
        "[CharGen] generate_character_sheet entry key=%s user_text=%s image_model=%s photo_bytes=%d %s",
        key,
        bool(user_text),
        image_model,
        len(photo_bytes or b""),
        trailer,
    )

    # Build inline image parts (photo + any outfit images)
    image_parts = _build_inline_images(
        photo_b64, mime_type,
        top_bytes, top_mime,
        bottom_bytes, bottom_mime,
        shoes_bytes, shoes_mime,
    )

    # ── Step A: Generate character sheet prompt via text model ──────────────
    step_a_prompt = (
        "아래 마스터 프롬프트의 절차를 따라 캐릭터 시트 프롬프트를 생성하라.\n"
        "STEP 1, STEP 2에는 이미 사용자 답변이 포함되어 있으므로 "
        "질문 단계를 건너뛰고 바로 STEP 4부터 진행하여 "
        "최종 캐릭터 시트 프롬프트를 코드블록으로 출력하라.\n\n"
        + MASTER_PROMPT.format(step1_answer=step1_answer)
    )

    sheet_prompt_text = await _call_gemini_text(
        step_a_prompt, image_parts, role=role, style=style, user_id=user_id
    )
    sheet_prompt_text = _extract_code_block(sheet_prompt_text)
    logger.info(
        "[CharGen] Step A complete prompt_len=%d %s",
        len(sheet_prompt_text),
        trailer,
    )

    # ── Step B: Generate character sheet image via image model ──────────────
    step_b_prompt = (
        "아래의 캐릭터 시트 프롬프트를 기반으로 캐릭터 시트 이미지를 생성하라.\n"
        "첨부된 사진은 이 캐릭터의 참조 사진이다. "
        "생성되는 캐릭터는 반드시 이 참조 사진 속 인물과 동일한 외모를 가져야 한다.\n\n"
        "=== 캐릭터 시트 프롬프트 ===\n\n"
        "{}"
    ).format(sheet_prompt_text)

    logger.info(
        "[CharGen] Step B start image_model=%s %s", image_model, trailer
    )
    image_bytes = await _call_image_backend(
        step_b_prompt,
        image_parts,
        image_model=image_model,
        role=role,
        style=style,
        user_id=user_id,
    )
    logger.info(
        "[CharGen] Step B complete image_bytes=%d %s",
        len(image_bytes),
        trailer,
    )

    return image_bytes


async def refine_character_sheet(
    current_sheet_bytes: bytes,
    photo_bytes: bytes,
    photo_mime: str,
    refine_request: str,
    image_model: str = "gpt_image_2",
    role: Optional[str] = None,
    style: Optional[str] = None,
    user_id: Optional[str] = None,
) -> bytes:
    """Refine an existing character sheet based on user's modification request.

    Sends the current character sheet image + original photo to the chosen
    image model with the refinement instructions. Returns PNG bytes of the
    refined sheet.
    """
    trailer = _trace_kv(role, style, user_id)
    sheet_b64 = base64.b64encode(current_sheet_bytes).decode("utf-8")
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8")

    image_parts = [
        {"inlineData": {"mimeType": "image/png", "data": sheet_b64}},
        {"inlineData": {"mimeType": photo_mime, "data": photo_b64}},
    ]

    prompt = (
        "첨부된 첫번째 이미지는 현재 캐릭터 시트이다.\n"
        "첨부된 두번째 이미지는 이 캐릭터의 원본 참조 사진이다.\n"
        "아래 수정 요청사항만 반영하여 캐릭터 시트를 다시 생성하시오.\n"
        "수정 요청 외의 모든 요소(얼굴, 체형, 포즈, 레이아웃 등)는 "
        "현재 캐릭터 시트와 동일하게 유지하시오.\n\n"
        "수정 요청: {}".format(refine_request)
    )

    logger.info(
        "[CharGen] refine entry request=%s image_model=%s sheet_bytes=%d photo_bytes=%d %s",
        refine_request[:100],
        image_model,
        len(current_sheet_bytes or b""),
        len(photo_bytes or b""),
        trailer,
    )
    image_bytes = await _call_image_backend(
        prompt,
        image_parts,
        image_model=image_model,
        role=role,
        style=style,
        user_id=user_id,
    )
    logger.info(
        "[CharGen] refine complete image_bytes=%d %s",
        len(image_bytes),
        trailer,
    )

    return image_bytes
