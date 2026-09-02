"""
AI Character Sheet Generator using Google Gemini REST API.

Two-step process:
  Step A: Gemini text model analyzes the photo and generates a character sheet prompt
          using the master prompt template.
  Step B: Gemini image model (NanoBanana Pro) generates the character sheet image
          from the prompt + original photo.
"""

import asyncio
import base64
import logging
import re
import time
from typing import Optional

import anthropic
import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# ── API endpoints ─────────────────────────────────────────────────────────────

# Step A (사진→텍스트 분석)용 비전 모델.
# v: gemini-2.5-flash(경량/구세대) → gemini-3.1-pro-preview(상위 비전 Pro) 업그레이드.
#    인물 사진의 외모 특징 추출 정밀도를 높여 정체성 반영 개선 목적.
#    (라이브 키 접근 200 확인. 구 gemini-3-pro-preview 는 404 폐기됨.)
GEMINI_TEXT_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3.1-pro-preview:generateContent"
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
- Logo/Print (exact text spelling, graphic shape, size, placement — copy from reference, never invent):

Bottom (pants / shorts / skirt):
- Type:
- Waist position (elastic/belted/etc.):
- Length:
- Shape:
- Structure:
- Pleats/Tucks:
- Fabric:
- Movement:
- Logo/Print (exact text spelling, graphic shape, size, COUNT and exact placement — e.g. "one large spiral on left leg only"; copy from reference, never invent, never turn a single graphic into a repeating pattern):

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
- Logo/Print (brand mark shape, color, placement — copy from reference, never invent):

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


# ── v228 [MAIDOL v50 이식] REALISTIC OVERRIDE — 실사 경로 상시 적용 ───────────
#
# MAIDOL(1_MV_wedding backend_8000)의 REALISTIC_OVERRIDE_BLOCK 이식.
# AI 의 디폴트 idealization (대칭 미화, 매끄러운 피부, 모델급 비율) 거부.
# 원본과 차이: §4 출력 톤만 AIDOL(아이돌 프로필) 맥락으로 조정 —
# "documentary candid / 연예인 인상=실패" 대신 "촬영 퀄리티는 프로필급 허용,
# 인물 자체의 미화만 금지". §1~3·§5 는 원본 그대로.
REALISTIC_OVERRIDE_BLOCK = r"""

==================================================
★★★ [REALISTIC OVERRIDE — 우선순위 최고] ★★★
==================================================

이 시트는 미화·이상화 없이 사진 속 실제 사람의 외모를 그대로 표현해야 한다.
다음 규칙은 위의 모든 STEP 보다 우선 적용한다:

1. AI 의 디폴트 idealization 거부:
   - 대칭 보정 금지, 매끄러운 피부 미화 금지, 큰 눈·작은 얼굴 보정 금지
   - 어깨/허리/다리 비율 미화 금지 (모래시계 체형 강제 금지)
   - 모델급 sharp jawline / V-line / 8등신 보정 금지

2. 사진 속 실제 특징 그대로 살림:
   - 비대칭 (눈/입꼬리/귀 높이 등) 그대로 반영
   - 피부 결: 자연스러운 모공·미세 트러블·홍조 가능, 매끈한 retouch 금지
   - 일반인 비율 (어깨 폭, 허리/엉덩이 비율, 다리 길이) 사진 그대로
   - 얼굴 형태(이마/광대/턱) 사진 그대로 — 표준화·세련화 금지

3. 항목별 강조:
   - [Face > Skin]: 자연스러운 피부결 (모공 보임, 균일하지 않은 톤 OK)
   - [Face > Eyes/Nose/Lips]: 사진 속 실제 형태 정확 반영
   - [Face > Shape/Jaw/Chin]: 광대/턱 라인 사진 그대로 — 깎거나 다듬지 X
   - [Body > Build/Proportion/Shoulder/Waist/Hip]: 사진 비율 그대로
   - [Makeup]: 사진 속 메이크업 그대로. 추가 미화 메이크업 금지.

4. 출력 톤 (AIDOL 조정):
   - 조명·구도·선명도 등 촬영 퀄리티는 깔끔한 프로필 사진 수준을 유지해도 좋다
   - 단, 인물 자체(얼굴 형태·비율·피부·체형)를 사진과 다르게 다듬는 것은 실패
   - 사진 인물을 아는 사람이 보면 즉시 같은 사람임을 알아보는 결과 = 성공

5. [Final Constraint] 갱신:
   - 이상화·연예인화·모델화 → 실패
   - 사진 인물과 다른 "더 예쁜·잘생긴" 결과 → 실패
   - 사진 인물 그대로 → 성공
"""

# v228 [MAIDOL v50 이식] — 사진 첨부 실사 경로의 STEP 1 answer 끝에 붙는 강화 안내.
_REALISTIC_STEP1_SUFFIX = (
    " ★★ realistic: 사진 분석 시 미화·이상화 없이 인물의 실제 외모를 그대로 반영하라. "
    "비대칭, 잡티, 모공, 일반인 비율 등 사진의 정직한 정보를 모두 살려라. "
    "사진 인물보다 \"더 예쁜/잘생긴\" 결과를 만들지 말 것."
)


# ── Master Prompt (CARTOON / 그림·만화 화풍) ──────────────────────────────────
#
# 실사용 MASTER_PROMPT 를 재사용/동적치환하지 않고 **별도 한 벌**로 둔다.
# 실사 대비 차이:
#   1) STEP 2 Art Style 답변이 하드코딩 "Photorealistic (실사)" 가 아니라
#      `{art_style}` placeholder (예: "Korean webtoon style").
#   2) [화풍 변환 규칙] 블록 신설 — 첨부 화풍 reference 이미지를 충실히 따르고,
#      선택 아이템(상의/하의/신발)을 현실 의류 이미지 그대로가 아니라 해당
#      화풍으로 변환해서 캐릭터에게 입혀 그리도록 지시.
#   3) 템플릿의 Rendering Style 이 실사가 아닌 선택 화풍을 따르도록 명시.
# 나머지 절차/레이아웃/STEP1 아이템 반영 로직은 실사와 동일.
MASTER_PROMPT_CARTOON = r"""다음 절차를 반드시 순서대로 따르시오:

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
{art_style}

--------------------------------------------------

[화풍 변환 규칙]

- 이 캐릭터 시트는 **실사(Photorealistic)가 아니라 위 STEP 2 에서 지정한 그림/만화 화풍**으로
  렌더링되어야 한다.
- 첨부 이미지 중 **[화풍 참조] 라벨이 붙은 이미지가 "화풍(Art Style) reference 이미지"**다.
  **[화풍 참조] 이미지에 사람이 등장하더라도, 그 인물의 얼굴·이목구비·헤어·정체성을 절대
  복제하지 말 것.** [화풍 참조]에서는 오직 **선화 두께·채색 방식·음영·색감·비례 과장 정도 등
  '그리는 방식(스타일)'만** 차용한다. 캐릭터의 정체성(얼굴형/이목구비/머리/체형/피부톤)은
  **오직 [인물 사진]** 에서만 가져온다.
- **[인물 사진]에서 식별 가능한 굵직한 정체성 특징을 구체적으로 추출하여 [고정 요소]로
  명시하고 반드시 보존**하라 — 예: 얼굴형(둥근/긴/각진), 머리색·길이·스타일, 눈썹·눈매,
  안경 유무·형태, 피부톤, 수염, 점·흉터 등 특이점. **화풍으로 변환한 뒤에도 이 특징들은
  누락·변형 금지.**
- 화풍 변환은 적용하되, **스타일이 인물의 정체성을 덮어버릴 만큼 과도하게 적용하지 말 것.**
  화풍 안에서도 **원본 인물을 알아볼 수 있는 수준**으로 식별 특징을 유지하라.
- 선택된 아이템([상의 참조]/[하의 참조]/[신발 참조] 라벨 이미지)은 **현실 의류 사진**이지만,
  그대로 사실적으로 그리지 말고 **지정 화풍으로 변환**하여 캐릭터가 착용한 상태로 그리시오.
  **화풍으로 변환되는 것은 오직 질감·선화·채색 방식뿐이다. 색상·패턴/프린트·로고 위치·
  실루엣·기장·여밈 등 제품의 구성 디테일은 참조 이미지와 정확히 일치시켜야 하며,
  임의로 재해석·단순화·변경하지 말 것.** (제품을 아는 사람이 보면 같은 제품임을
  즉시 알아볼 수 있는 수준으로 재현하라)
- **로고·프린팅 복제 규칙**: 참조 이미지에 로고나 프린팅이 있으면 그것을 **그대로 복제**하라 —
  텍스트 로고는 정확한 철자·대소문자·서체 느낌·색상으로, 그래픽 도안은 동일한 형태·크기·
  부착 위치로. 읽기 어렵거나 작더라도 **임의의 다른 문자·도안을 만들어 넣지 말고**
  참조의 시각적 형태를 최대한 그대로 모사하라. 참조에 로고가 없으면 로고를 추가하지 말라.
- **도안 개수·배치 규칙**: 참조에서 도안이 **한 곳에만** 있으면(예: 왼쪽 다리에 큰 나선 1개)
  결과에서도 **정확히 그 위치에 그 개수만** 그려라. **단일 도안을 여러 개로 복사하거나
  반복 패턴으로 확산시키는 것을 절대 금지**한다. 반대로 참조가 전면 반복 패턴이면
  동일한 밀도의 패턴으로 그려라. 이 규칙은 상의·하의·신발 모두에 동일하게 적용된다.
- 선택된 아이템은 반드시 캐릭터가 착용한 상태로 모든 섹션에 일관되게 표현되어야 한다.

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

단, 얼굴·머리 등 [인물 사진]에서 직접 가져오는 정체성 요소는 이 텍스트 규격 대상에서
제외한다(주관적 형용사 묘사 금지, 사진을 따른다). 이 상세 규격 규칙은 의상·소품·배경·
레이아웃 등 새로 정의해야 하는 시각 요소에만 적용한다.

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
A professional character design sheet featuring a single [Gender] character, rendered in {art_style} (NOT photorealistic), high-quality, 4k resolution, neutral grey studio background (#808080).

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
- 얼굴의 이목구비 형태·비율·표정 등 미세한 생김새(얼굴형/턱/광대/눈매/코/입술/눈썹 두께 등)는
  [인물 사진]을 직접 관찰하여 그대로 따른다. 주관적 형용사(예: refined/delicate/두꺼운/얇은/
  자연스러운 두께/natural thickness)로 재서술하지 말 것. 아래에는 식별용 객관·범주값만 기재한다.
- Eye color (눈동자색):
- Glasses (안경 유무/형태):
- Skin tone (피부톤):
- Facial hair (수염 유무):
- Distinctive marks (점/흉터 등 특이점):

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
- Style:
- Color:
- Volume:
- Flow:
- State:
- 머리카락 세부 질감(가닥 두께·표면 등)은 주관적으로 단정하지 말고 [인물 사진]을 따른다.

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
- Logo/Print (exact text spelling, graphic shape, size, placement — copy from reference, never invent):

Bottom (pants / shorts / skirt):
- Type:
- Waist position (elastic/belted/etc.):
- Length:
- Shape:
- Structure:
- Pleats/Tucks:
- Fabric:
- Movement:
- Logo/Print (exact text spelling, graphic shape, size, COUNT and exact placement — e.g. "one large spiral on left leg only"; copy from reference, never invent, never turn a single graphic into a repeating pattern):

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
- Logo/Print (brand mark shape, color, placement — copy from reference, never invent):

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
- Render strictly in {art_style}, faithfully matching the [화풍 참조]-labeled style reference image (line weight, coloring, shading, palette). Do NOT render photorealistically.

[Color Control]
-

[Consistency Rules]
-

[Final Constraint]
- The selected outfit/footwear items must be converted into {art_style} and worn by the character, not drawn as realistic photos.
- Only the rendering technique (texture, line work, coloring) converts to {art_style}; the items' colors, patterns/prints, logo placement, silhouette, length, and construction details must match the labeled reference images EXACTLY — no reinterpretation, simplification, or redesign.
- Logos and prints must be copied verbatim from the reference images: exact text spelling and lettering style for text logos, identical graphic shape/size/placement for graphic prints. Never invent substitute text or artwork; if unreadable, visually mimic the reference shapes. Do not add logos that are not in the reference.
- Print COUNT and placement must match the reference exactly: a single graphic in one location stays a single graphic in that location — never duplicate it or spread it into a repeating pattern; an all-over pattern stays an all-over pattern at the same density. This applies equally to top, bottom, and footwear."""


# ── STEP 1 answer: dynamic assembly + role labels ─────────────────────────────
#
# 기존 16종 `STEP1_ANSWERS` 딕셔너리(키 "{text}_{top}{bottom}{shoes}")를 제거하고,
# 선택된 아이템 조합에 따라 동적으로 조립한다. 이미지 식별은 첨부 "순번"
# ("두번째/세번째 이미지")이 아니라 **역할 라벨**("[상의 참조]" 등)으로만 한다 —
# `_build_inline_images` 가 각 이미지 앞에 동일 라벨 텍스트 파트를 삽입하므로
# 첨부 순서가 바뀌어도 모델이 라벨로 식별한다. 결과 의미는 기존 16종과 동등.


def _build_step1_answer(
    has_top: bool,
    has_bottom: bool,
    has_shoes: bool,
    user_text: str = "",
    has_photo: bool = True,
) -> str:
    """Assemble the STEP 1 user-answer text dynamically from item selection.

    - Base (has_photo=True): analyze the [인물 사진] (person photo) reference for
      appearance. `user_text` is appended as the highest-priority instruction.
    - Base (has_photo=False, v161 텍스트-only 경로): `user_text` becomes the SOLE
      identity source — the model concretizes gender/age/body/face/hair from the
      description and free-generates whatever the description omits.
    - For each of top/bottom/shoes: if a reference image is attached, instruct
      the model to analyze the corresponding role-labeled image; otherwise fall
      back to "reflect if visible in the photo, else free-generate" (photo path)
      or "reflect if mentioned in the description, else free-generate" (text path).

    Role labels (not attachment ordinals) are used so the answer stays valid no
    matter the inline-image ordering. The has_photo=True output is byte-identical
    to the pre-v161 builder (regression-safe for the photo path).
    """
    text = (user_text or "").strip()

    if has_photo:
        parts = [
            "첨부된 [인물 사진] 참조 이미지의 외모 특징"
            "(성별/나이/인종/체형/얼굴/머리/눈/피부톤)을 정밀 분석해 반영하라."
            " 단, 얼굴 이목구비의 미세한 형태·비율·표정은 [인물 사진]을 직접 따르게 두고"
            " 주관적 형용사(refined/delicate/두꺼운/얇은/자연스러운 두께 등)로 단정하지 말 것."
            " 텍스트로는 식별용 객관 범주값(머리색/길이·안경·피부톤·눈동자색·특이점 등)과"
            " 화풍·아이템·레이아웃 등 구조 지시만 남겨라."
            " 추출한 위 객관 범주값 중 식별에 중요한 굵직한 특징은 반드시 구체적으로 나열하여"
            " [고정 요소]로 고정하고, 화풍 변환 시에도 보존되도록 명시하라."
        ]
    else:
        # v161 — 텍스트-only: 사용자 외모 설명이 유일한 정체성 소스.
        parts = [
            "이번 생성에는 [인물 사진]이 첨부되지 않았다."
            " 다음 [사용자 외모 설명]을 캐릭터의 유일한 정체성 소스로 삼아"
            " 성별/나이/인종/체형/얼굴형/머리/눈/피부톤을 구체적으로 확정하라:"
            " 「{}」".format(text)
            + " 설명에 없는 요소는 K-pop 아이돌 프로필에 어울리게 자유 생성하라."
            " 확정한 특징 중 식별에 중요한 굵직한 특징"
            "(머리색/길이·안경·피부톤·눈동자색·특이점 등)은 반드시 구체적으로 나열하여"
            " [고정 요소]로 고정하고, 화풍 변환 시에도 보존되도록 명시하라."
        ]

    # v225 — 의상 충실도: 참조 이미지가 있는 아이템은 얼굴 정체성과 동급으로
    # 디테일을 [고정 요소]에 잠근다 (참조에 없는 디테일 창작·임의 변경 금지).
    if has_top:
        parts.append(
            "[Outfit > Top] 항목은 [상의 참조] 이미지를 분석해 반영하라."
            " 참조 이미지의 색상(구체 색명)·패턴/프린트·로고 종류와 위치·넥라인·핏·기장·"
            "여밈(단추/지퍼)·스티치 등 디테일을 그대로 추출해 [고정 요소]로 고정하고,"
            " 참조에 없는 디테일을 창작하거나 임의로 바꾸지 말라."
            " 특히 로고·프린팅은 Logo/Print 항목에 별도로 기록하라: 텍스트 로고는 정확한"
            " 철자·대소문자·서체 느낌·색상까지, 그래픽 프린트는 도안의 형태·크기·부착 위치"
            "(가슴 좌/중앙/등판 등)까지 구체적으로 명시하고 [고정 요소]로 고정하라."
        )
    elif has_photo:
        parts.append("상의는 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    else:
        parts.append("상의는 [사용자 외모 설명]에 언급되면 반영, 없으면 자유 생성하라.")

    if has_bottom:
        parts.append(
            "[Outfit > Skirt/Bottom] 항목은 [하의 참조] 이미지를 분석해 반영하라."
            " 참조 이미지의 색상(구체 색명)·소재 질감·실루엣(와이드/스트레이트 등)·기장·"
            "허리 위치·주름/턱·포켓·워싱 등 디테일을 그대로 추출해 [고정 요소]로 고정하고,"
            " 참조에 없는 디테일을 창작하거나 임의로 바꾸지 말라."
            " 로고·프린팅이 있으면 Logo/Print 항목에 정확한 철자·도안 형태·크기와 함께"
            " **도안의 개수와 정확한 배치(예: 왼쪽 다리 한 곳에만 큰 나선 1개)**를 별도"
            " 기록하고 [고정 요소]로 고정하라. 참조에서 도안이 한 곳에만 있으면 결과에서도"
            " 한 곳에만 그려야 하며, 단일 도안을 반복 패턴으로 늘리는 것을 금지한다."
        )
    elif has_photo:
        parts.append("하의는 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    else:
        parts.append("하의는 [사용자 외모 설명]에 언급되면 반영, 없으면 자유 생성하라.")

    if has_shoes:
        parts.append(
            "[Footwear] 항목은 [신발 참조] 이미지를 분석해 반영하라."
            " 참조 이미지의 색상 조합·소재·굽/밑창 형태·레이스/스트랩·로고 위치 등 디테일을"
            " 그대로 추출해 [고정 요소]로 고정하고, 참조에 없는 디테일을 창작하거나 임의로 바꾸지 말라."
            " 브랜드 로고·마크가 있으면 Logo/Print 항목에 정확한 형태·색상·부착 위치를"
            " 별도 기록하고 [고정 요소]로 고정하라."
        )
    elif has_photo:
        parts.append("신발은 [인물 사진]에서 보이면 반영, 안 보이면 자유 생성하라.")
    else:
        parts.append("신발은 [사용자 외모 설명]에 언급되면 반영, 없으면 자유 생성하라.")

    if text and has_photo:
        parts.append(
            "추가로 사용자가 명시한 특징을 최우선 반영하라: 「{}」"
            " 사용자 설명과 사진이 충돌하면 사용자 설명을 우선하라.".format(text)
        )

    return " ".join(parts)


def _build_inline_images(photo_b64, photo_mime, top_bytes, top_mime, bottom_bytes, bottom_mime, shoes_bytes, shoes_mime):
    """Build ordered list of parts: each image preceded by a role-label text part.

    Labels ("[인물 사진]:", "[상의 참조]:", "[하의 참조]:", "[신발 참조]:") let the
    model identify each image by role regardless of attachment order. Gemini and
    GPT image backends both accept mixed text+image parts. The cartoon path
    appends a "[화풍 참조]:" labeled style image after these parts.

    v161 — photo_b64 가 falsy(텍스트-only 경로)면 [인물 사진] 파트를 생략한다.
    사진 경로(photo_b64 truthy) 출력은 기존과 byte-identical.
    """
    parts = []
    if photo_b64:
        parts.append({"text": "[인물 사진]:"})
        parts.append({"inlineData": {"mimeType": photo_mime, "data": photo_b64}})
    if top_bytes:
        parts.append({"text": "[상의 참조]:"})
        parts.append({
            "inlineData": {
                "mimeType": top_mime or "image/jpeg",
                "data": base64.b64encode(top_bytes).decode("utf-8"),
            }
        })
    if bottom_bytes:
        parts.append({"text": "[하의 참조]:"})
        parts.append({
            "inlineData": {
                "mimeType": bottom_mime or "image/jpeg",
                "data": base64.b64encode(bottom_bytes).decode("utf-8"),
            }
        })
    if shoes_bytes:
        parts.append({"text": "[신발 참조]:"})
        parts.append({
            "inlineData": {
                "mimeType": shoes_mime or "image/jpeg",
                "data": base64.b64encode(shoes_bytes).decode("utf-8"),
            }
        })
    return parts


def _adapt_prompt_for_text_only(prompt: str) -> str:
    """v161 — 텍스트-only(사진 미첨부) 경로 전용: 프롬프트의 사진 전제 문구를
    STEP 1 의 [사용자 외모 설명] 기준으로 치환한다.

    사진 경로에서는 호출되지 않으므로 기존 사진 경로 프롬프트는 byte-identical 로
    유지된다. 치환 대상:
      - "[인물 사진]" 참조 → "STEP 1 의 [사용자 외모 설명]" (정체성 소스 교체)
      - "…을 직접 관찰하여 그대로 따른다" → "…을 기준으로 구체화한다" (텍스트에는 관찰 불가)
      - "사진을 따른다" → "설명을 따른다"
      - "원본 인물" → "설명된 인물"
    """
    p = prompt.replace("[인물 사진]", "STEP 1 의 [사용자 외모 설명]")
    p = p.replace("을 직접 관찰하여 그대로 따른다", "을 기준으로 구체화한다")
    p = p.replace("사진을 따른다", "설명을 따른다")
    p = p.replace("원본 인물", "설명된 인물")
    return p


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


# ── v228 [MAIDOL v52 이식] Step A: Claude 우선 + Gemini 폴백 ──────────────────

_CLAUDE_TEXT_MODEL = "claude-opus-4-7"
_claude_text_client: Optional[anthropic.AsyncAnthropic] = None


def _get_claude_text_client() -> anthropic.AsyncAnthropic:
    global _claude_text_client
    if _claude_text_client is None:
        _claude_text_client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key
        )
    return _claude_text_client


def _sniff_image_media_type(data_b64: str, fallback: str = "image/jpeg") -> str:
    """base64 첫 바이트의 magic 으로 실제 media_type 추론.

    Claude API 는 media_type ↔ 실제 데이터 mismatch 시 400 거부 (Gemini 는 관대).
    """
    try:
        head = base64.b64decode(data_b64[:64] + "===", validate=False)[:16]
    except Exception:  # noqa: BLE001
        return fallback
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return fallback


def _gemini_parts_to_claude_content(prompt: str, image_parts: list) -> list:
    """Gemini parts(라벨 텍스트+inlineData 혼합) → Claude messages content.

    역할 라벨 텍스트 파트("[상의 참조]:" 등)는 이미지 앞의 text block 으로
    그대로 유지해 라벨-이미지 대응이 Claude 에서도 성립하게 한다.
    """
    content: list = []
    for part in image_parts or []:
        if not isinstance(part, dict):
            continue
        if part.get("text"):
            content.append({"type": "text", "text": part["text"]})
            continue
        inline = part.get("inlineData")
        if not inline:
            continue
        declared = inline.get("mimeType") or "image/jpeg"
        data_b64 = inline.get("data") or ""
        if not data_b64:
            continue
        media_type = _sniff_image_media_type(data_b64, fallback=declared)
        if media_type != declared:
            logger.info(
                "[CharGen] image media_type corrected declared=%s actual=%s",
                declared, media_type,
            )
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data_b64,
            },
        })
    content.append({"type": "text", "text": prompt})
    return content


async def _call_claude_text(prompt: str, image_parts: list) -> str:
    """Step A (v228, MAIDOL v52 이식): Claude 로 캐릭터 시트 prompt 생성.

    `_call_gemini_text` 와 시그니처/반환 형식 호환.
    """
    content = _gemini_parts_to_claude_content(prompt, image_parts)
    logger.info(
        "[CharGen] Step A: calling Claude text model=%s (parts=%d)",
        _CLAUDE_TEXT_MODEL, len(image_parts or []),
    )
    start = time.monotonic()
    try:
        client = _get_claude_text_client()
        msg = await client.messages.create(
            model=_CLAUDE_TEXT_MODEL,
            max_tokens=8192,
            system=CHARACTER_SYSTEM_INSTRUCTION,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.APIStatusError as e:
        logger.warning(
            "[CharGen] Step A: Claude error status=%s elapsed_s=%.1f",
            getattr(e, "status_code", "?"), time.monotonic() - start,
        )
        raise ValueError(
            "Claude text API error (HTTP {}): {}".format(
                getattr(e, "status_code", "?"), str(e)[:300]
            )
        )
    logger.info(
        "[CharGen] Step A: Claude text ok elapsed_s=%.1f", time.monotonic() - start
    )
    text_chunks = [
        block.text for block in (msg.content or [])
        if getattr(block, "type", None) == "text" and getattr(block, "text", None)
    ]
    if not text_chunks:
        raise ValueError("No text in Claude response")
    return "".join(text_chunks)


async def _call_text_backend(prompt: str, image_parts: list) -> str:
    """Step A 텍스트 모델 디스패처 — Claude 우선, 실패/키 미설정 시 Gemini 폴백.

    MAIDOL 은 Gemini 쿼터 이슈로 Step A 를 Claude 로 전환(v52)했고, AIDOL 도
    2026-09-01 Gemini 503 실사고가 있어 동일 구조를 이식하되 폴백을 남긴다
    (Gemini 경로는 v224 재시도 내장).
    """
    if settings.anthropic_api_key:
        try:
            return await _call_claude_text(prompt, image_parts)
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 Gemini 로 폴백
            logger.warning(
                "[CharGen] Step A: Claude failed — falling back to Gemini: %s",
                str(e)[:200],
            )
    else:
        logger.info("[CharGen] Step A: no anthropic key — using Gemini")
    return await _call_gemini_text(prompt, image_parts)


async def _call_gemini_text(prompt: str, image_parts: list) -> str:
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

    # v224: Gemini 일시 장애(503/429/5xx·타임아웃)에 재시도 — 실사고(2026-09-01
    # 503 "Deadline expired")로 잡이 3초 만에 failed 처리되던 것 방지. 총 3회, 백오프 2s/5s.
    last_err = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    GEMINI_TEXT_API_URL,
                    params={"key": settings.google_api_key},
                    json=payload,
                )
            if resp.status_code == 200:
                break
            detail = resp.text[:300]
            last_err = ValueError(
                "Gemini text API error (HTTP {}): {}".format(resp.status_code, detail)
            )
            if resp.status_code not in (429, 500, 502, 503, 504):
                raise last_err  # 4xx 등 비일시 오류는 즉시 실패
            logger.warning(
                "[gemini-text] transient HTTP %s — retry %d/2", resp.status_code, attempt + 1
            )
        except httpx.HTTPError as e:
            last_err = ValueError("Gemini text API network error: {}".format(e))
            logger.warning("[gemini-text] network error — retry %d/2: %s", attempt + 1, e)
        if attempt < 2:
            await asyncio.sleep(2 if attempt == 0 else 5)
    else:
        raise last_err or ValueError("Gemini text API error: retries exhausted")

    if resp.status_code != 200:
        raise last_err or ValueError("Gemini text API error (HTTP {})".format(resp.status_code))

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
    prompt: str, image_parts: list, image_model: str = "nb_pro"
) -> bytes:
    """v55: Dispatch Step B image generation across model backends.

    image_model:
      - "nb_pro" (default): Gemini Nano Banana Pro — preserves all prior
        behavior bit-for-bit (delegates to `_call_gemini_image`).
      - "gpt_image_2": OpenAI GPT Image 2 — converts `image_parts` (Gemini
        inlineData dicts) back to raw bytes and calls `openai_image.generate_image`.
    """
    logger.info("[CharGen] image_model=%s parts=%d", image_model, len(image_parts))
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
        return await generate_image(prompt=prompt, ref_images=ref_bytes)

    # default — nb_pro
    return await _call_gemini_image(prompt, image_parts)


async def _call_gemini_image(prompt: str, image_parts: list) -> bytes:
    """Step B: Call Gemini image model to generate character sheet image."""
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
        },
    }

    # v224: 텍스트 단계와 동일한 일시 장애(5xx/429·타임아웃) 재시도 — 3회, 백오프 2s/5s.
    last_err = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    GEMINI_IMAGE_API_URL,
                    params={"key": settings.google_api_key},
                    json=payload,
                )
            if resp.status_code == 200:
                break
            detail = resp.text[:300]
            last_err = ValueError(
                "Gemini image API error (HTTP {}): {}".format(resp.status_code, detail)
            )
            if resp.status_code not in (429, 500, 502, 503, 504):
                raise last_err
            logger.warning(
                "[gemini-image] transient HTTP %s — retry %d/2", resp.status_code, attempt + 1
            )
        except httpx.HTTPError as e:
            last_err = ValueError("Gemini image API network error: {}".format(e))
            logger.warning("[gemini-image] network error — retry %d/2: %s", attempt + 1, e)
        if attempt < 2:
            await asyncio.sleep(2 if attempt == 0 else 5)
    else:
        raise last_err or ValueError("Gemini image API error: retries exhausted")

    if resp.status_code != 200:
        raise last_err or ValueError("Gemini image API error (HTTP {})".format(resp.status_code))

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini image response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            # v137 [watermark]: 비가시 AI 마커 삽입 (캐릭터 시트 저장 전 공통).
            from .watermark import embed_image_metadata

            return embed_image_metadata(base64.b64decode(inline_data["data"]))

    raise ValueError("No image generated from Gemini image response")


async def generate_character_sheet(
    photo_bytes: bytes = None,
    mime_type: str = "image/jpeg",
    top_bytes: bytes = None,
    top_mime: str = None,
    bottom_bytes: bytes = None,
    bottom_mime: str = None,
    shoes_bytes: bytes = None,
    shoes_mime: str = None,
    user_text: str = "",
    image_model: str = "nb_pro",
) -> bytes:
    """Generate photorealistic character sheet from reference photo.

    Two-step process:
      Step A: Gemini text model analyzes photo + master prompt -> character sheet prompt text
      Step B: Gemini image model generates character sheet image from prompt + photo

    Optional outfit images (top/bottom/shoes) switch the STEP 1 answer to reference
    those images for the corresponding outfit sections.
    Optional user_text adds user-described character traits with highest priority.

    v161 — photo_bytes 는 Optional. None(텍스트-only 경로)이면 user_text 가 유일한
    정체성 소스가 되고, [인물 사진] 파트/문구가 전부 텍스트 설명 참조로 대체된다.
    사진 경로(photo_bytes 존재) 프롬프트는 기존과 byte-identical.

    Returns PNG bytes of the character sheet image.
    """
    has_photo = bool(photo_bytes)
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8") if has_photo else None

    # Dynamically assemble STEP 1 answer from item selection + user_text
    # (role labels only — no attachment ordinals).
    step1_answer = _build_step1_answer(
        has_top=bool(top_bytes),
        has_bottom=bool(bottom_bytes),
        has_shoes=bool(shoes_bytes),
        user_text=user_text,
        has_photo=has_photo,
    )

    # Build inline image parts (role-labeled photo + any outfit images)
    image_parts = _build_inline_images(
        photo_b64, mime_type,
        top_bytes, top_mime,
        bottom_bytes, bottom_mime,
        shoes_bytes, shoes_mime,
    )
    logger.info(
        "[CharGen] items=top:%s/bottom:%s/shoes:%s text=%s photo=%s parts=%d",
        bool(top_bytes), bool(bottom_bytes), bool(shoes_bytes),
        bool(user_text), has_photo, len(image_parts),
    )

    # ── Step A: Generate character sheet prompt via text model ──────────────
    # v228 [MAIDOL v50 이식] — 실사 경로 상시 REALISTIC OVERRIDE:
    # 사진 첨부 시 step1 강화 suffix + 마스터 끝 override block (미화·이상화 금지).
    if has_photo:
        step1_answer = step1_answer + _REALISTIC_STEP1_SUFFIX
    master = MASTER_PROMPT.format(step1_answer=step1_answer)
    if has_photo:
        master = master + REALISTIC_OVERRIDE_BLOCK
    step_a_prompt = (
        "아래 마스터 프롬프트의 절차를 따라 캐릭터 시트 프롬프트를 생성하라.\n"
        "STEP 1, STEP 2에는 이미 사용자 답변이 포함되어 있으므로 "
        "질문 단계를 건너뛰고 바로 STEP 4부터 진행하여 "
        "최종 캐릭터 시트 프롬프트를 코드블록으로 출력하라.\n\n"
        + master
    )

    logger.info("Step A: Generating character sheet prompt via text backend...")
    sheet_prompt_text = await _call_text_backend(step_a_prompt, image_parts)
    sheet_prompt_text = _extract_code_block(sheet_prompt_text)
    logger.info(
        "Step A complete. Generated prompt length: %d chars", len(sheet_prompt_text)
    )

    # ── Step B: Generate character sheet image via image model ──────────────
    if has_photo:
        step_b_prompt = (
            "아래의 캐릭터 시트 프롬프트를 기반으로 캐릭터 시트 이미지를 생성하라.\n"
            "[인물 사진] 라벨이 붙은 이미지는 이 캐릭터의 참조 사진이다. "
            "생성되는 캐릭터는 반드시 이 참조 사진 속 인물과 동일한 외모를 가져야 한다.\n"
            "[상의 참조]/[하의 참조]/[신발 참조] 라벨 이미지가 첨부된 경우, 해당 의류는 "
            "참조 이미지의 실제 제품과 동일하게(색상·패턴·로고 위치·실루엣·기장·디테일) "
            "재현하여 착용시켜라 — 임의로 재해석·단순화·변경하지 말 것. "
            "로고·프린팅은 참조의 것을 그대로 복제하라: 텍스트는 정확한 철자·서체 느낌으로, "
            "그래픽은 동일한 도안·크기·위치로. 임의 대체·창작 금지, 참조에 없는 로고 추가 금지. "
            "도안 개수·배치도 참조와 동일하게 — 단일 도안을 반복 패턴으로 늘리지 말 것 "
            "(상의·하의·신발 동일 적용).\n\n"
            "=== 캐릭터 시트 프롬프트 ===\n\n"
            "{}"
        ).format(sheet_prompt_text)
    else:
        # v161 — 텍스트-only: 인물 참조 사진 없음. 시트 프롬프트(STEP 1 사용자 외모
        # 설명 기반)가 유일한 외모 기준.
        step_b_prompt = (
            "아래의 캐릭터 시트 프롬프트를 기반으로 캐릭터 시트 이미지를 생성하라.\n"
            "이번 생성에는 인물 참조 사진이 없다. 캐릭터의 외모 정체성은 아래 캐릭터 시트 "
            "프롬프트(사용자 외모 설명 기반)에 명시된 특징을 유일한 기준으로 삼아 "
            "4개 섹션 모두에서 일관되게 그려야 한다.\n\n"
            "=== 캐릭터 시트 프롬프트 ===\n\n"
            "{}"
        ).format(sheet_prompt_text)

    logger.info(
        "Step B: Generating character sheet image via image_model=%s",
        image_model,
    )
    image_bytes = await _call_image_backend(
        step_b_prompt, image_parts, image_model=image_model
    )
    logger.info("Step B complete. Generated image size: %d bytes", len(image_bytes))

    return image_bytes


async def generate_character_sheet_cartoon(
    photo_bytes: bytes = None,
    mime_type: str = "image/jpeg",
    top_bytes: bytes = None,
    top_mime: str = None,
    bottom_bytes: bytes = None,
    bottom_mime: str = None,
    shoes_bytes: bytes = None,
    shoes_mime: str = None,
    user_text: str = "",
    image_model: str = "nb_pro",
    art_style_label: str = "Korean webtoon style",
    style_ref_bytes: bytes = None,
    style_ref_mime: str = None,
) -> bytes:
    """Generate a CARTOON / illustration-style character sheet (가상화).

    Same two-step pipeline as `generate_character_sheet`, but:
      - Uses `MASTER_PROMPT_CARTOON` (separate prompt, NOT the realistic one),
        formatted with both `step1_answer` and `art_style`.
      - Appends a **style reference image** (with a "[화풍 참조]:" label part)
        after the role-labeled photo + outfit items, so every image is
        identified by role label rather than attachment ordinal.
      - Selected outfit/footwear items are converted INTO the chosen art style
        (not drawn as realistic photos).

    `art_style_label` examples: "Korean webtoon style", "Japanese anime style",
    "1990s retro manga style", or "the art style of the attached style
    reference image" (when the user uploaded their own style image).

    v161 — photo_bytes 는 Optional. None(텍스트-only 경로)이면 user_text 가 유일한
    정체성 소스가 되고, MASTER_PROMPT_CARTOON 의 "정체성은 오직 [인물 사진]" 규칙이
    "STEP 1 의 [사용자 외모 설명]" 참조로 치환된다 (사진 경로 byte-identical).

    Returns PNG bytes of the cartoon character sheet image.
    """
    has_photo = bool(photo_bytes)
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8") if has_photo else None

    # Dynamically assemble STEP 1 answer (same builder as realistic — role labels).
    step1_answer = _build_step1_answer(
        has_top=bool(top_bytes),
        has_bottom=bool(bottom_bytes),
        has_shoes=bool(shoes_bytes),
        user_text=user_text,
        has_photo=has_photo,
    )

    # Build inline image parts (role-labeled photo + items), then append the
    # style reference with a "[화풍 참조]:" label part.
    image_parts = _build_inline_images(
        photo_b64, mime_type,
        top_bytes, top_mime,
        bottom_bytes, bottom_mime,
        shoes_bytes, shoes_mime,
    )
    has_style_ref = bool(style_ref_bytes)
    if has_style_ref:
        image_parts.append({"text": "[화풍 참조]:"})
        image_parts.append({
            "inlineData": {
                "mimeType": style_ref_mime or "image/png",
                "data": base64.b64encode(style_ref_bytes).decode("utf-8"),
            }
        })

    logger.info(
        "[CharGen] mode=cartoon items=top:%s/bottom:%s/shoes:%s text=%s photo=%s "
        "style_ref=%s art_style=%s image_model=%s parts=%d",
        bool(top_bytes), bool(bottom_bytes), bool(shoes_bytes),
        bool(user_text), has_photo, has_style_ref, art_style_label, image_model,
        len(image_parts),
    )

    # ── Step A: Generate cartoon character sheet prompt via text model ──────
    # v161 — 텍스트-only 시 MASTER_PROMPT_CARTOON 의 사진 전제 문구("정체성은 오직
    # [인물 사진]" 등)를 format 전에 STEP 1 사용자 외모 설명 참조로 치환한다
    # (step1_answer 본문은 치환 대상 아님). 사진 경로는 원본 템플릿 그대로.
    master_cartoon = (
        MASTER_PROMPT_CARTOON if has_photo
        else _adapt_prompt_for_text_only(MASTER_PROMPT_CARTOON)
    )
    step_a_prompt = (
        "아래 마스터 프롬프트의 절차를 따라 그림/만화 화풍 캐릭터 시트 프롬프트를 생성하라.\n"
        "STEP 1, STEP 2에는 이미 사용자 답변이 포함되어 있으므로 "
        "질문 단계를 건너뛰고 바로 STEP 4부터 진행하여 "
        "최종 캐릭터 시트 프롬프트를 코드블록으로 출력하라.\n"
        "[화풍 참조] 라벨이 붙은 이미지가 화풍(Art Style) reference 이미지다.\n\n"
        + master_cartoon.format(
            step1_answer=step1_answer, art_style=art_style_label
        )
    )

    logger.info("[CharGenCartoon] Step A: generating prompt via text backend...")
    try:
        # v228 — Claude 우선 + Gemini 폴백 (실사와 동일 디스패처).
        sheet_prompt_text = await _call_text_backend(step_a_prompt, image_parts)
    except Exception as e:
        logger.error("[CharGenCartoon] Step A failed: %s", str(e)[:200])
        raise
    sheet_prompt_text = _extract_code_block(sheet_prompt_text)
    logger.info(
        "[CharGenCartoon] Step A complete. prompt length=%d chars",
        len(sheet_prompt_text),
    )

    # ── Step B: Generate cartoon character sheet image via image model ──────
    style_ref_note = (
        " [화풍 참조] 라벨 이미지가 화풍 reference 이미지다 — 이 스타일을 충실히 따르라."
        if has_style_ref else ""
    )
    if has_photo:
        step_b_prompt = (
            "아래의 캐릭터 시트 프롬프트를 기반으로 그림/만화 화풍 캐릭터 시트 이미지를 생성하라.\n"
            "[인물 사진] 라벨 이미지는 이 캐릭터의 인물 참조 사진이다. "
            "생성되는 캐릭터는 이 인물의 외모적 정체성을 유지하되, 실사가 아니라 "
            "'{}' 화풍으로 변환하여 그려야 한다.\n"
            "선택된 아이템([상의 참조]/[하의 참조]/[신발 참조] 라벨 이미지)은 현실 의류 이미지이지만 "
            "그대로 사실적으로 그리지 말고 동일 화풍으로 변환하여 캐릭터가 착용한 상태로 그려라. "
            "단, 화풍으로 바꾸는 것은 질감·선화·채색 방식뿐이다 — 색상·패턴·로고 위치·실루엣·기장 등 "
            "제품 구성 디테일은 각 참조 이미지와 정확히 일치시키고 임의로 재해석하지 말라. "
            "로고·프린팅은 참조 이미지의 것을 그대로 복제하라: 텍스트 로고는 정확한 철자·서체 느낌으로, "
            "그래픽 도안은 동일한 형태·크기·위치로. 임의의 다른 문자·도안으로 대체하지 말고, "
            "참조에 없는 로고를 추가하지도 말라. 도안의 개수와 배치도 참조와 동일하게 — "
            "한 곳에만 있는 단일 도안을 여러 개로 복사하거나 반복 패턴으로 늘리지 말라. "
            "이는 상의·하의·신발 모두에 동일 적용된다.{}\n"
            "정체성(얼굴/이목구비/머리/체형)은 [인물 사진]에서만 가져오고, "
            "[화풍 참조] 이미지의 인물·얼굴은 절대 복제하지 말 것(스타일만). "
            "얼굴 이목구비의 미세한 형태·비율·표정은 [인물 사진]을 직접 따르고, 텍스트 시트의 "
            "주관적 형용사 묘사가 아니라 사진 자체를 기하 기준으로 삼아라. 텍스트 시트는 객관 "
            "범주값(머리색/길이/안경/피부톤/눈동자색/특이점)과 화풍·아이템·레이아웃 구조 지시로 활용하라. "
            "아래 캐릭터 시트 프롬프트에 명시된 인물의 식별 특징(머리/안경/피부톤/눈동자색 등)을 "
            "반드시 유지하라. 과도한 스타일화로 정체성을 덮지 말고, 원본 인물을 알아볼 수 있게 그려라.\n\n"
            "=== 캐릭터 시트 프롬프트 ===\n\n"
            "{}"
        ).format(art_style_label, style_ref_note, sheet_prompt_text)
    else:
        # v161 — 텍스트-only: 인물 참조 사진 없음. 시트 프롬프트(STEP 1 사용자 외모
        # 설명 기반)가 유일한 정체성 기준. 화풍/아이템 규칙은 사진 경로와 동일 유지.
        step_b_prompt = (
            "아래의 캐릭터 시트 프롬프트를 기반으로 그림/만화 화풍 캐릭터 시트 이미지를 생성하라.\n"
            "이번 생성에는 인물 참조 사진이 없다. 캐릭터의 외모 정체성은 아래 캐릭터 시트 "
            "프롬프트(사용자 외모 설명 기반)에 명시된 특징을 유일한 기준으로 삼아, 실사가 아니라 "
            "'{}' 화풍으로 4개 섹션 모두에서 일관되게 그려야 한다.\n"
            "선택된 아이템([상의 참조]/[하의 참조]/[신발 참조] 라벨 이미지)은 현실 의류 이미지이지만 "
            "그대로 사실적으로 그리지 말고 동일 화풍으로 변환하여 캐릭터가 착용한 상태로 그려라. "
            "단, 화풍으로 바꾸는 것은 질감·선화·채색 방식뿐이다 — 색상·패턴·로고 위치·실루엣·기장 등 "
            "제품 구성 디테일은 각 참조 이미지와 정확히 일치시키고 임의로 재해석하지 말라. "
            "로고·프린팅은 참조 이미지의 것을 그대로 복제하라: 텍스트 로고는 정확한 철자·서체 느낌으로, "
            "그래픽 도안은 동일한 형태·크기·위치로. 임의의 다른 문자·도안으로 대체하지 말고, "
            "참조에 없는 로고를 추가하지도 말라. 도안의 개수와 배치도 참조와 동일하게 — "
            "한 곳에만 있는 단일 도안을 여러 개로 복사하거나 반복 패턴으로 늘리지 말라. "
            "이는 상의·하의·신발 모두에 동일 적용된다.{}\n"
            "[화풍 참조] 이미지의 인물·얼굴은 절대 복제하지 말 것(스타일만 차용). "
            "아래 캐릭터 시트 프롬프트에 명시된 인물의 식별 특징(머리/안경/피부톤/눈동자색 등)을 "
            "반드시 유지하라. 과도한 스타일화로 정체성을 덮지 말고, 설명된 인물의 특징을 "
            "알아볼 수 있게 그려라.\n\n"
            "=== 캐릭터 시트 프롬프트 ===\n\n"
            "{}"
        ).format(art_style_label, style_ref_note, sheet_prompt_text)

    logger.info(
        "[CharGenCartoon] Step B: generating image via image_model=%s",
        image_model,
    )
    try:
        image_bytes = await _call_image_backend(
            step_b_prompt, image_parts, image_model=image_model
        )
    except Exception as e:
        logger.error("[CharGenCartoon] Step B failed: %s", str(e)[:200])
        raise
    logger.info(
        "[CharGenCartoon] Step B complete. image size=%d bytes", len(image_bytes)
    )

    return image_bytes


async def refine_character_sheet(
    current_sheet_bytes: bytes,
    photo_bytes: bytes,
    photo_mime: str,
    refine_request: str,
    image_model: str = "nb_pro",
) -> bytes:
    """Refine an existing character sheet based on user's modification request.

    Sends the current character sheet image + original photo to Gemini image model
    with the refinement instructions. Returns PNG bytes of the refined sheet.
    """
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
        "Refining character sheet. Request: %s image_model=%s",
        refine_request[:100],
        image_model,
    )
    image_bytes = await _call_image_backend(
        prompt, image_parts, image_model=image_model
    )
    logger.info("Refinement complete. Image size: %d bytes", len(image_bytes))

    return image_bytes
