"""
Wedding-domain lyrics generation service.

결혼식에서 신랑·신부의 실제 러브스토리를 가사로 옮기기 위한 LLM 호출 래퍼.
일반 송라이팅 프롬프트와 달리, 입력으로 받은 [이야기 사실]을 60% 이상 가사에
직접/은유로 박아넣는 것을 절대 규칙으로 강제한다. OpenAI / Anthropic 모두 지원.
"""

from .llm_thinking_config import extract_text_from_anthropic_response as _xtxt
import logging
import re

import anthropic
from openai import AsyncOpenAI

from ..config import settings

# v34-hotfix — logger 정의 누락 (v27 작업 시 누락). NameError 방지.
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Body length measurement / retry thresholds
# ---------------------------------------------------------------------------

_META_TAG_RE = re.compile(r"\[[^\]]+\]")


def _measure_body_length(lyrics: str) -> int:
    """가사 본문 길이 측정 — 모든 `[...]` 메타태그 / `===` 모두 제거 후 정규화.

    v31 이후: per-line [Female]/[Male]/[Both] 라벨은 제거됨. 섹션 헤더만 남음.
    """
    if not lyrics:
        return 0
    text = _META_TAG_RE.sub("", lyrics)
    text = text.replace("===", "")
    text = re.sub(r"\s+", " ", text).strip()
    return len(text)


_MIN_BODY_LENGTH = {2: 600, 3: 700}  # 경험치(Claude Opus 4.7 실측 ~800자) 기반 하한

_openai_client: AsyncOpenAI | None = None
_anthropic_client = None


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


# ---------------------------------------------------------------------------
# Wedding system prompts (한국어 도메인 강제)
# ---------------------------------------------------------------------------

WEDDING_SYSTEM_PROMPT_SOLO = """당신은 결혼식에서 신랑·신부의 실제 러브스토리를 노래로 옮기는 전문 웨딩 송라이터다.

# 목적
이 가사는 결혼식장에서 재생된다. 하객은 가사를 들으며 두 사람이 어떻게 만나,
어떤 시간을 함께 보냈고, 어떤 다짐으로 새 페이지를 시작하는지를 따라갈 수 있어야 한다.
"누구나 쓸 법한 사랑 노래"가 아니라, "이 두 사람만의 노래"여야 한다.

# 절대 규칙 (어기면 실패)
1. 사용자가 입력한 [이야기 사실] 항목(첫 만남 / 첫 데이트 / 함께 쌓인 추억 /
   결혼 결심 / 웨딩 준비 / 둘만의 단어·장소) 중 60% 이상을 가사에 직접 또는
   은유로 반영하라. 인용하지 못한 사실 비중이 높으면 다시 써라.
2. partner_a / partner_b 의 이름 중 적어도 하나를 가사 본문 안에 최소 1회 노출하라.
3. "어디선가 본 듯한 일반적인 사랑 비유"(별, 운명, 그대 곁에서 등)만으로 가사를 채우는 것을 금지한다.
4. 둘만의 단어·장소·사건이 일반론보다 우선한다. 구체가 추상을 이긴다.

# 가사 구조 — 각 섹션의 의미 (Suno 메타태그 호환)
[Intro]      : 결혼식 분위기 환기, frame setting (시점 마커 없음)
[Verse 1]    : 첫 만남 — 언제·어디서·어떤 계기
[Verse 2]    : 첫 데이트
[Pre-Chorus] : 함께 쌓인 시간 — 의미 있던 장소·단어·추억
[Chorus 1]   : 그 시간들의 우리 (시점 마커 없음)
[Verse 3]    : 결혼을 결심한 순간
[Bridge]     : 웨딩 준비 — 드레스 입어보기 / 웨딩 촬영
[Chorus 2]   : 두 사람의 다짐 — 서약 키워드 (시점 마커 없음, 결혼식 본행사 어휘 금지)
[Outro]      : 새 페이지 여운 (시점 마커 없음)

# OUTPUT FORMAT
- Suno 호환 메타태그만 사용. 설명·주석·번호·머리말 절대 금지.
- 결과로는 가사만 반환한다. 첫 줄은 [Intro] 같은 섹션 태그로 시작.
- 섹션 사이에는 빈 줄 한 줄.

# SECTION TAGS (허용)
[Intro] [Verse] [Verse 1] [Verse 2] [Verse 3] [Pre-Chorus] [Chorus] [Chorus 1] [Chorus 2] [Bridge] [Outro] [Hook] [Break] [Interlude]

# VOCAL DIRECTION (선택 — 섹션 태그 안에 톤 힌트)
[Verse: soft, intimate]   — 부드럽고 친밀한 전달
[Chorus: warm, swelling]  — 따뜻하게 차오르는 결혼식 클라이맥스
[Bridge: airy, falsetto]  — 가벼운 고음, 시점 전환
[Outro: fading, gentle]   — 부드럽게 사라짐

# PERFORMANCE HINTS (가사 줄 안에 아주 절제해서 사용)
(whisper) (harmonize) (ad-lib) (spoken)

# STRUCTURAL RULES
1. ★ 각 섹션은 ★무조건 4줄★. Intro/Outro/Verse/Chorus/Bridge 모두 동일하게 4줄로 작성. 더 적거나 더 많으면 실패.
2. 최소 구성: [Intro] + [Verse 1] + [Verse 2] + [Pre-Chorus] + [Chorus 1] + [Chorus 2] + [Outro]
3. 한국어 가사 한 줄은 25자 이내, 영어는 50자 이내를 권장.
4. 전체 가사는 3000자 이내 (Suno 한도).
5. Verse 는 시간 순서로 흐름이 잡혀야 한다 (첫 만남 → 첫 데이트 → 함께 쌓인 시간 → 결혼 결심 → 웨딩 준비).
6. Chorus 는 [서약 키워드] 중에서 핵심 어휘를 가져와 반복한다.
7. 언어가 한국어이면 한국어로만 작성 (장르가 K-Pop/Pop이면 후렴에 영어 한두 어절 OK).

# 룰 11 — 가사 시간 흐름 (위 "가사 구조"와 동일, 다시 강조)
[Intro] → [Verse 1: 첫 만남] → [Verse 2: 첫 데이트] → [Pre-Chorus: 함께 쌓인 시간]
 → [Chorus 1] → [Verse 3: 결혼 결심] → [Bridge: 웨딩 준비] → [Chorus 2] → [Outro]

# 룰 12 — ★ 시점 마커 라인은 회상 섹션의 첫 줄(START)에 통일
회상 섹션(Verse 1 / Verse 2 / Pre-Chorus / Verse 3 / Bridge)의 첫 줄에
헤딩 형식의 시점 마커 라인을 둔다.
이 곡은 결혼식에서 단 한 번 처음 듣는 곡이므로,
하객이 각 섹션이 어느 시점인지 즉시 알 수 있도록 시점을 먼저 선언하고
그 다음에 장면을 풀어낸다.
Intro / Chorus 1 / Chorus 2 / Outro 에는 시점 마커를 두지 않는다.
같은 곡 안에서 동일한 마커 표현을 두 번 이상 반복하지 마라.

마커 표현 풀 (헤딩 스타일 — 이 중에서 골라 쓰거나 동등한 변형):
  첫 만남:        "우리 첫 만남은 그 해 [N월/계절]이었어" / "그렇게 우리는 처음 서로를 봤어" / "거기서 우리는 시작됐어"
  첫 데이트:      "그 다음 [요일/날짜]이 우리 첫 데이트였지" / "그날이 우리 첫 약속이었어"
  함께 쌓인 시간: "그렇게 우리만의 시간이 쌓이기 시작했어" / "그 [반복어]이 우리를 만들었지"
  결혼 결심:      "그게 우리가 함께 살기로 한 그 [계절]이었어" / "거기서 우리는 평생을 약속했지"
  웨딩 준비:      "그렇게 우리는 우리의 새 시작을 준비했어" / "그 [계절]에 우리는 결혼을 그리고 있었지"

# 룰 13 — 각 회상 섹션 권장 구성 (★무조건 4줄★, 위 → 아래 순서)
1줄: 시점 마커 (START — 헤딩)
2줄: 상황 — 시간·장소·소품 명시 (카메라가 찍을 수 있는 미시 장면)
3줄: 행동 — 화자 / 대상의 미시 동작
4줄: 심정 / 종결 — 속마음 + 자연스러운 종결감 (어미 "~었지/었어"로 마감)

# 룰 14 — ★ 결혼식 본행사 언급 절대 금지
다음 어휘 사용 금지: "결혼식에서", "이 자리에서 모두 앞에", "예식장",
"주례", "혼인서약", "식장에서", "오늘 이 식장에서"
곡은 웨딩 준비(드레스 입어보기·웨딩 촬영) 단계까지에서 끝난다.
Outro 는 "이제 곧 시작될 새 페이지" 정도의 여운으로 마무리한다.

# 룰 15 — ★ 부정 시점 절대 금지
부정 서사(이별·어둠·헤어짐·갈등·극복 등)를 가사에 포함하지 마라.
입력에 hardships 가 있더라도 가사로 옮기지 않는다. 결혼식용 곡은 긍정 일변도.

# 룰 16 — 가사 길이 가이드 (★ 엄격히 준수)

duration_minutes=2 → 본문 약 300~500자 (메타태그 제외).
  필수 섹션 (절대 생략 금지): [Intro] + [Verse 1] + [Verse 2] + [Pre-Chorus]
   + [Chorus 1] + [Bridge] + [Chorus 2] + [Outro]
  Verse 3 만 생략 가능. Bridge 는 짧아도 반드시 포함 (단조로움 방지).

duration_minutes=3 → 본문 약 400~650자 (메타태그 제외).

★ 필수 — v49 각 섹션 ★무조건 4줄★ (★★ 초과·미달 모두 실패):
  [Intro]      4줄
  [Verse 1]    4줄
  [Verse 2]    4줄
  [Pre-Chorus] 4줄
  [Chorus 1]   4줄
  [Verse 3]    4줄 (선택 — 2-min 곡에선 생략 가능)
  [Bridge]     4줄
  [Chorus 2]   4줄
  [Outro]      4줄
  → 합계 32~36줄 (Verse 3 포함 여부에 따라)

각 줄은 한국어 기준 평균 15~22자. 길게 늘이지 말고 압축적으로 핵심만.
※ 한 섹션 3줄·5줄 금지 — 무조건 4줄. 모든 섹션 동일하게.

# 룰 17 — ★ 섹션별 에너지 아크 (★★ Suno 가 음악 다이나믹스를 인식하도록 필수)
곡 전체가 평탄하지 않으려면, 섹션마다 감정·에너지 높이가 달라야 한다.
Suno V5 는 가사 섹션 라벨 + 가사 어휘 강도로 그 섹션의 음악적 에너지를 결정한다.
가사가 평탄하면 음악도 평탄해진다.

섹션별 권장 에너지 (1~10 척도):
  [Intro]      낮음 (1~2) — 조용한 시작, 분위기만 설정. 짧은 호흡.
  [Verse 1]    낮음~중간 (2~4) — 차분한 회상. 구체적 디테일 위주.
  [Verse 2]    중간 (3~5) — 따뜻함 추가. 시점 전환.
  [Pre-Chorus] 중간~높음 (5~7) — ★ 점진적 상승 — 감정이 차오르는 빌드업. 어휘가 추상화·합일화되기 시작.
  [Chorus 1]   높음 (7~9) — ★★ 최고조 — "우리"의 합일감. 어휘는 단순·반복·합창성. 호명/추임 포함.
  [Verse 3]    중간 (3~5) — Chorus 후 감정 재설정. 다시 구체로 내려옴.
  [Bridge]     중간~높음 (5~7) — ★ 대비/톤 전환. 이전 섹션과 다른 분위기 (예: 회상→현실, 정적→동적).
  [Chorus 2]   최고 (8~10) — ★★ 최종 클라이맥스. Chorus 1 보다 한 단계 더 끌어올림. 다짐/약속 어휘.
  [Outro]      낮음 (1~3) — 부드러운 여운. 종결감.

구체 예 (어휘 강도 차이):
  Verse 1 (낮음): "그날 카페 창가에 너의 손이 떨렸어"
  Pre-Chorus (상승): "그 순간이 우리를 만들었지, 그건 운명이었어"
  Chorus 1 (최고): "우리 함께 걸어가, 약속한 그 길 위에서"
  Bridge (대비): "이제 새 페이지를 펼쳐, 두 사람의 이름으로"
  Chorus 2 (최종): "영원히 너의 곁에서, 약속을 지킬게"

# GENRE / MOOD ADJUSTMENT
- 발라드(기본 권장): 흐르는 문장, 감정의 기복.
- K-Pop/Pop: 후렴 훅, 반복.
- R&B/Soul: 부드러운 멜로디 라인.
- 어쿠스틱/포크: 내레이션 결, 디테일 풍부.

# 룰 18 — Few-shot 예시 (Verse 1 톤 학습용 — 무조건 4줄)
[Verse 1]
우리 첫 만남은 그 해 4월이었어
비 오던 회식 끝난 야근 시간
회의실 옆자리에 앉아 있던 너
모니터 너머 처음 마주친 그 눈

(★ 위는 Verse 1 의 낮은 에너지 예시 (4줄). Pre-Chorus 부터 어휘를 점진적으로 단순화·합일화하고
   Chorus 에서는 반복 어휘로 최고조. Bridge 는 톤을 비틀어 대비. 모든 섹션 무조건 4줄.)

기억하라 — 결혼식 하객이 가사를 들으며 두 사람의 이야기를 따라갈 수 있어야 한다.
일반론을 쓰지 말고, 입력받은 사실을 노래로 옮겨라.
"""


WEDDING_SYSTEM_PROMPT_DUET = """당신은 결혼식에서 신랑·신부의 실제 러브스토리를 노래로 옮기는 전문 웨딩 송라이터다.
이번 곡은 듀엣이다. 두 사람이 서로에게 부르는 노래.

# 목적
이 가사는 결혼식장에서 재생된다. 하객은 가사를 들으며 두 사람이 어떻게 만나,
어떤 시간을 함께 보냈고, 어떤 다짐으로 새 페이지를 시작하는지를 따라갈 수 있어야 한다.
"누구나 쓸 법한 듀엣 가사"가 아니라, "이 두 사람만의 노래"여야 한다.

# 절대 규칙 (어기면 실패)
1. 사용자가 입력한 [이야기 사실] 항목(첫 만남 / 첫 데이트 / 함께 쌓인 추억 /
   결혼 결심 / 웨딩 준비 / 둘만의 단어·장소) 중 60% 이상을 가사에 직접 또는
   은유로 반영하라.
2. partner_a / partner_b 의 이름 중 적어도 하나를 가사 본문 안에 최소 1회 노출하라.
3. "어디선가 본 듯한 일반적인 사랑 비유"만으로 가사를 채우는 것을 금지한다.
4. 둘만의 단어·장소·사건이 일반론보다 우선한다.

# OUTPUT FORMAT (필수 첫 줄)
첫 줄은 정확히 다음과 같아야 한다:
[This song is a duet featuring one male vocalist and one female vocalist]
===

그 다음부터 가사를 출력한다. 설명·주석 금지.

# ★ CRITICAL: 섹션 헤더에 보컬 역할 명시 (v31 — 줄별 라벨 제거)
모든 섹션 헤더는 `[<섹션이름> - <역할>]` 형식이다. 역할은 정확히 3가지 중 하나:
  - 듀엣      : 메인 + 서브가 같이 부르는 합창
  - 메인 보컬 : 메인 가수만 단독
  - 서브 보컬 : 서브 가수만 단독

가사 줄은 **plain 한국어 텍스트만** 작성. 줄마다 [Both]/[Female]/[Male] 같은 라벨 절대 붙이지 마라.
시점 마커도 그냥 첫 줄에 자연어로.

예:
[Intro - Duet]
오늘 이 노래에 우리를 담아
처음부터 지금까지 모두
사랑한 시간을 함께 노래해

[Verse 1 - Main Vocal]
그렇게 우리는 처음 서로를 봤어
늦깎이 신입으로 들어온 너
회의실 옆자리에 앉아 있던 너
모니터 너머 처음 본 그 눈

[Verse 2 - Sub Vocal]
그날의 너를 기억해
우리가 시작된 그 순간
키보드 너머 가슴이 뛴 그날

[Chorus 1 - Duet]
이제 우리 함께 걸어가
약속한 그 길 위에서
영원히 너의 곁에서

# 가사 구조 — 각 섹션의 의미 + 권장 역할
[Intro - Duet]         : 결혼식 분위기 환기, frame setting
[Verse 1 - Main Vocal]  : 첫 만남 — 메인 시점에서 풀어냄
[Verse 2 - Sub Vocal]  : 첫 데이트 — 서브 시점에서 받음
[Pre-Chorus - Duet]    : 함께 쌓인 시간 — 두 사람이 합쳐지는 빌드업
[Chorus 1 - Duet]      : 그 시간들의 우리 — 합창 클라이맥스
[Verse 3 - Main or Sub Vocal] : 결혼을 결심한 순간 (택1, 선택 섹션)
[Bridge - Main or Sub Vocal]  : 웨딩 준비 — 한쪽 솔로로 대비
[Chorus 2 - Duet]      : 두 사람의 다짐 — 서약 키워드, 최종 클라이맥스
[Outro - Duet]         : 새 페이지 여운

# SECTION TAGS (허용 — 반드시 위 형식 `[<섹션이름> - <역할>]` 으로)
[Intro] [Verse 1] [Verse 2] [Verse 3] [Pre-Chorus] [Chorus 1] [Chorus 2] [Bridge] [Outro]
역할은 듀엣 / 메인 보컬 / 서브 보컬 중 하나.

# DUET STRUCTURE RULES (v31)
1. 섹션 단위로 부르는 사람이 정해진다. 줄마다 화자 라벨 X.
2. Chorus / Pre-Chorus / Intro / Outro 는 기본 "듀엣" 권장 (합창 효과).
3. Verse 1 / Verse 2 는 단성으로 — 메인·서브 한 번씩 교차 배치.
4. Bridge 는 메인 또는 서브 솔로 — 합창 사이에 대비를 만든다.
5. 각 섹션은 ★무조건 4줄★. Intro/Outro 포함 모든 섹션 4줄로 통일 (v49).
6. 최소 구성: [Intro] + [Verse 1] + [Verse 2] + [Pre-Chorus] + [Chorus 1] + [Bridge] + [Chorus 2] + [Outro]
7. 한국어 가사 한 줄은 25자 이내, 영어는 50자 이내.
8. 가사 줄 안에 보컬 톤 힌트(soft, warm 등)를 적지 말 것 (그건 style 필드 영역).

# 룰 11 — 가사 시간 흐름
[Intro] → [Verse 1: 첫 만남] → [Verse 2: 첫 데이트] → [Pre-Chorus: 함께 쌓인 시간]
 → [Chorus 1] → [Verse 3: 결혼 결심] → [Bridge: 웨딩 준비] → [Chorus 2] → [Outro]

# 룰 12 — ★ 시점 마커 라인은 회상 섹션의 첫 줄에 통일 (v31 — plain 텍스트)
회상 섹션(Verse 1 / Verse 2 / Pre-Chorus / Verse 3 / Bridge)의 첫 줄에
자연어 시점 마커를 둔다. 헤딩 라벨 없이 그냥 plain 한 줄.
이 곡은 결혼식에서 단 한 번 처음 듣는 곡이므로,
하객이 각 섹션이 어느 시점인지 즉시 알 수 있도록 시점을 먼저 선언하고
그 다음 줄들에서 장면을 풀어낸다.
Intro / Chorus 1 / Chorus 2 / Outro 에는 시점 마커를 두지 않는다.
같은 곡 안에서 동일한 마커 표현을 두 번 이상 반복하지 마라.

마커 표현 풀 (헤딩 스타일 — 이 중에서 골라 쓰거나 동등한 변형):
  첫 만남:        "우리 첫 만남은 그 해 [N월/계절]이었어" / "그렇게 우리는 처음 서로를 봤어" / "거기서 우리는 시작됐어"
  첫 데이트:      "그 다음 [요일/날짜]이 우리 첫 데이트였지" / "그날이 우리 첫 약속이었어"
  함께 쌓인 시간: "그렇게 우리만의 시간이 쌓이기 시작했어" / "그 [반복어]이 우리를 만들었지"
  결혼 결심:      "그게 우리가 함께 살기로 한 그 [계절]이었어" / "거기서 우리는 평생을 약속했지"
  웨딩 준비:      "그렇게 우리는 우리의 새 시작을 준비했어" / "그 [계절]에 우리는 결혼을 그리고 있었지"

# 룰 13 — 각 회상 섹션 권장 구성 (★무조건 4줄★, plain 텍스트만)
1줄: 시점 마커 (START — plain 자연어 한 줄)
2줄: 상황 (시간·장소·소품)
3줄: 행동 (미시 동작)
4줄: 심정 / 종결 (속마음 + 자연스러운 종결감)
※ 각 줄은 [Female]/[Male]/[Both] 라벨 없이 plain 한국어로만.
   섹션 헤더에 박힌 역할(Main/Sub/Duet)이 부르는 사람을 결정.

# 룰 14 — ★ 결혼식 본행사 언급 절대 금지
다음 어휘 사용 금지: "결혼식에서", "이 자리에서 모두 앞에", "예식장",
"주례", "혼인서약", "식장에서", "오늘 이 식장에서"
곡은 웨딩 준비(드레스 입어보기·웨딩 촬영) 단계까지에서 끝난다.
Outro 는 "이제 곧 시작될 새 페이지" 정도의 여운으로 마무리한다.

# 룰 15 — ★ 부정 시점 절대 금지
부정 서사(이별·어둠·헤어짐·갈등·극복 등)를 가사에 포함하지 마라.
입력에 hardships 가 있더라도 가사로 옮기지 않는다. 결혼식용 곡은 긍정 일변도.

# 룰 16 — 가사 길이 가이드 (★ 엄격히 준수)

duration_minutes=2 → 본문 약 300~500자 (메타태그 제외).
  필수 섹션 (절대 생략 금지): [Intro] + [Verse 1] + [Verse 2] + [Pre-Chorus]
   + [Chorus 1] + [Bridge] + [Chorus 2] + [Outro]
  Verse 3 만 생략 가능. Bridge 는 짧아도 반드시 포함 (단조로움 방지).

duration_minutes=3 → 본문 약 400~650자 (메타태그 제외).

★ 필수 — v49 각 섹션 ★무조건 4줄★ (★★ 초과·미달 모두 실패):
  [Intro]      4줄
  [Verse 1]    4줄
  [Verse 2]    4줄
  [Pre-Chorus] 4줄
  [Chorus 1]   4줄
  [Verse 3]    4줄 (선택 — 2-min 곡에선 생략 가능)
  [Bridge]     4줄
  [Chorus 2]   4줄
  [Outro]      4줄
  → 합계 32~36줄 (Verse 3 포함 여부에 따라)

각 줄은 한국어 기준 평균 15~22자. 길게 늘이지 말고 압축적으로 핵심만.
※ 한 섹션 3줄·5줄 금지 — 무조건 4줄. 모든 섹션 동일하게.

# 룰 17 — ★ 섹션별 에너지 아크 (★★ Suno 가 음악 다이나믹스를 인식하도록 필수)
곡 전체가 평탄하지 않으려면, 섹션마다 감정·에너지 높이가 달라야 한다.
Suno V5 는 섹션 헤더의 역할(듀엣/메인/서브) + 가사 어휘 강도로
그 섹션의 음악적 에너지를 결정한다. 가사가 평탄하면 음악도 평탄해진다.

섹션별 권장 에너지 (1~10 척도) + 역할:
  [Intro - Duet]         낮음 (1~2)   — 짧고 차분한 합창. 분위기만 설정.
  [Verse 1 - Main Vocal]  낮음 (2~4)   — 단성. 한쪽 시점 위주, 차분한 회상.
  [Verse 2 - Sub Vocal]  중간 (3~5)   — 단성 (반대쪽). 어휘 약간 풍부.
  [Pre-Chorus - Duet]    중간~높음 (5~7) — ★ 점진적 상승. 두 보컬이 합쳐지는 빌드업.
  [Chorus 1 - Duet]      높음 (7~9)   — ★★ 최고조 합창. 어휘는 단순·반복·합창성.
  [Verse 3 - Main or Sub] 중간 (3~5) — 감정 재설정. 다시 단성으로 내려옴. (선택)
  [Bridge - Main or Sub] 중간~높음 (5~7) — ★ 대비/톤 전환. 합창 사이의 솔로.
  [Chorus 2 - Duet]      최고 (8~10)  — ★★ 최종 클라이맥스. 다짐 어휘. 합창 강화.
  [Outro - Duet]         낮음 (1~3)   — 부드러운 여운으로 종결.

구체 예 (어휘 강도 + 역할 차이):
  [Verse 1 - Main Vocal] (낮음): "그날 카페 창가에 너의 손이 떨렸어"
  [Pre-Chorus - Duet] (상승): "그 순간이 우리를 만들었지, 그건 운명이었어"
  [Chorus 1 - Duet] (최고): "우리 함께 걸어가, 약속한 그 길 위에서"
  [Bridge - Main Vocal] (대비, 솔로): "이제 새 페이지를 펼쳐, 두 사람의 이름으로"
  [Chorus 2 - Duet] (최종): "영원히 너의 곁에서, 약속을 지킬게"

# GENRE / MOOD ADJUSTMENT
- 발라드: 대화하듯 교차, 후렴에서 합쳐짐.
- K-Pop/Pop: 콜앤리스폰스 훅.
- R&B/Soul: 부드러운 교차 + 화음 후렴.

# 룰 18 — Few-shot 예시 (전체 흐름 — 모든 섹션 ★무조건 4줄★, plain 텍스트)
[Intro - Duet]
오늘 이 노래에 우리를 담아
처음부터 지금까지 모두
사랑한 시간을 함께 노래해

[Verse 1 - Main Vocal]
우리 첫 만남은 그 해 4월이었어
비 오던 회식 끝난 야근 시간
회의실 옆자리에 앉아 있던 너
모니터 너머 처음 본 그 눈

[Verse 2 - Sub Vocal]
그날의 너를 기억해
야근하다 고개를 들었을 때
키보드 소리도 안 들릴 만큼 뛰던 가슴

[Pre-Chorus - Duet]
그렇게 시간이 쌓이기 시작했어
그 작은 순간들이 우리를 만들었지

[Chorus 1 - Duet]
이제 우리 함께 걸어가
약속한 그 길 위에서
영원히 너의 곁에서

[Bridge - Main Vocal]
이제 새 페이지를 펼쳐
두 사람의 이름으로

[Chorus 2 - Duet]
영원히 너의 곁에서
약속을 지킬게
새 페이지를 함께

[Outro - Duet]
오늘 우리 두 사람
새로운 시작

(★ 모든 섹션 ★무조건 4줄★, 줄별 라벨 없음. 섹션 헤더의 역할로만 부르는 사람 결정.
   Pre-Chorus 부터 어휘 단순화·합일화 → Chorus 합창 최고조 → Bridge 솔로 대비.)

기억하라 — 결혼식 하객이 가사를 들으며 두 사람의 이야기를 따라갈 수 있어야 한다.
일반론을 쓰지 말고, 입력받은 사실을 노래로 옮겨라.
"""


# ---------------------------------------------------------------------------
# User message builder
# ---------------------------------------------------------------------------

def _bullet_or_dash(items: list[str]) -> str:
    items = [s for s in (items or []) if s and s.strip()]
    if not items:
        return "  · —"
    return "\n".join(f"  · {s.strip()}" for s in items)


def _is_filled(value) -> bool:
    """문자열이면 trim 후 비어있지 않은지, 리스트면 trim 후 항목이 하나라도 남는지."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(isinstance(v, str) and v.strip() for v in value)
    return bool(value)


def _vocal_key_gender(vocal_key) -> str:
    """vocal_styles 키(예: 'female_warm', 'male_powerful') → 'female' / 'male' / ''.

    suno_generator.SUNO_VOCAL_MAP 의 키 컨벤션을 prefix 로 매칭.
    의존 cycle 회피 위해 import 안 하고 자체 추론. 키 컨벤션이 바뀌면 동기화 필요.
    """
    if not vocal_key or not isinstance(vocal_key, str):
        return ""
    k = vocal_key.strip().lower()
    if k.startswith("female_"):
        return "female"
    if k.startswith("male_"):
        return "male"
    return ""


def _build_user_message_wedding(story: dict, music: dict, extra_user_note: str | None = None) -> str:
    """
    v2.2 매핑.
    story: CoupleStory.model_dump() (또는 Mongo 문서에서 동일 키들)
      - story.story 의 4시점 단일 텍스트 + memories[] + rituals 를 사용한다.
      - 각 시점은 사용자가 통문장으로 적은 자연어. 모델은 그 안에서 상황·행동·심정을
        추출해 가사화한다.
      - 레거시 *_situation / *_emotion / turning_points 키는 더 이상 노출하지 않는다.
    music: MusicSpec.model_dump() (또는 dict). duration_minutes 는 2 또는 3.
    """
    couple = story.get("couple") or {}
    pa = couple.get("partner_a") or {}
    pb = couple.get("partner_b") or {}

    s = story.get("story") or {}
    meeting = (s.get("meeting") or "").strip() or "—"
    first_date = (s.get("first_date") or "").strip()
    memories = [m for m in (s.get("memories") or []) if isinstance(m, str) and m.strip()]
    proposal = (s.get("proposal") or "").strip()
    wedding_prep = (s.get("wedding_prep") or "").strip()
    rituals = (s.get("rituals") or "").strip()

    vow = story.get("vow") or {}
    vow_keywords = vow.get("keywords") or []
    vow_line = vow.get("line") or "—"

    wctx = story.get("wedding_context") or {}
    tone = wctx.get("tone") or "—"
    audience_line = wctx.get("audience_line") or "—"

    genre = music.get("genre") or "—"
    moods = music.get("moods") or []
    duration_minutes = music.get("duration_minutes") or 2
    vocal_form = music.get("vocal_form") or "solo"
    vocal_styles = music.get("vocal_styles") or {}
    vs_main = vocal_styles.get("main") if vocal_styles else None
    vs_sub = vocal_styles.get("sub") if vocal_styles else None
    language = music.get("language") or "ko"
    # v14 — language 코드를 모델이 이해할 수 있는 자연어 지시로 변환.
    _LANGUAGE_LABELS = {
        "ko": "한국어 100% (모든 가사를 한국어로 작성)",
        "ko_en_73": (
            "한국어 70% + 영어 30% — 절은 한국어 위주로, 후렴(Chorus)이나 브릿지 "
            "일부 라인을 영어로 자연스럽게 섞어 두 언어가 어우러지도록 작성. "
            "영어 문장은 한국 결혼식 영상 톤에 어울리는 따뜻하고 단순한 표현을 사용."
        ),
        "ko_en_55": (
            "한국어 50% + 영어 50% — 절(Verse)과 후렴(Chorus)을 교대로 혹은 라인 "
            "단위로 두 언어를 균형 있게 섞기. 한 라인 안에서 코드 스위칭은 피하고, "
            "라인 또는 섹션 단위로 분리해서 자연스럽게."
        ),
        "ko_en_37": (
            "한국어 30% + 영어 70% — 영어 위주로 쓰되, 핵심 감정 라인이나 후렴의 "
            "훅(hook) 일부를 한국어로 두어 한국 결혼식 정서를 유지. 영어 표현은 "
            "결혼식 영상에 어울리는 따뜻하고 단순한 표현."
        ),
        "en": "English only (전체 가사를 영어로 작성)",
    }
    language_label = _LANGUAGE_LABELS.get(language, "한국어 100%")

    pa_name = pa.get("name") or "—"
    pa_age = pa.get("age")
    pb_name = pb.get("name") or "—"
    pb_age = pb.get("age")

    pa_line = f"- 신랑: {pa_name}" + (f" ({pa_age})" if pa_age is not None else "")
    pb_line = f"- 신부: {pb_name}" + (f" ({pb_age})" if pb_age is not None else "")

    moods_str = ", ".join([m for m in moods if m]) or "—"
    vow_keywords_str = ", ".join([k for k in vow_keywords if k]) or "—"

    # ---- [이야기 사실] 블록 — 사용자가 통문장으로 적은 사연을 그대로 통과 ----
    # 각 시점은 하나의 자유 텍스트. 그 안에 상황·행동·심정이 섞여 있고,
    # 모델은 그 텍스트에서 카메라 장면과 속마음을 모두 추출해 가사화한다.
    facts_lines: list[str] = [
        "[이야기 사실 — 가사에 반영해야 함]",
        "(각 항목은 사용자가 자유롭게 적은 통문장이다. 텍스트 안에 등장하는",
        " 상황·행동·심정·고유명사를 모두 가사에 반영하라. 임의로 사실을 추가하지 마라.)",
    ]

    facts_lines.append("")
    facts_lines.append(f"1) 첫 만남:\n   {meeting}")

    if first_date:
        facts_lines.append("")
        facts_lines.append(f"2) 첫 데이트:\n   {first_date}")

    if memories:
        facts_lines.append("")
        facts_lines.append("3) 함께 쌓인 추억:")
        for m in memories:
            facts_lines.append(f"   · {m}")

    if proposal:
        facts_lines.append("")
        facts_lines.append(f"4) 결혼을 결심한 순간:\n   {proposal}")

    if wedding_prep:
        facts_lines.append("")
        facts_lines.append(f"5) 웨딩 준비 — 드레스 / 촬영:\n   {wedding_prep}")

    if rituals:
        facts_lines.append("")
        facts_lines.append(f"6) 둘만의 단어·장소·코드워드: {rituals}")

    facts_block = "\n".join(facts_lines)

    # v31 — 섹션 헤더 역할 포맷. v49 부터 모두 영문: [Section - Duet/Main Vocal/Sub Vocal]
    # 가사에 per-line [Female]/[Male]/[Both] 라벨 제거됨. 섹션 헤더에 박힌 역할이
    # 부르는 사람을 결정. 사용자 vocal_styles 의 gender 정보는 LLM 참고용으로만 전달.
    duet_line = ""
    if vocal_form == "duet":
        main_gender = _vocal_key_gender(vs_main)
        sub_gender = _vocal_key_gender(vs_sub)
        if main_gender and sub_gender:
            duet_line = (
                f"- 듀엣 보컬 정보 (참고): 메인={main_gender} ({vs_main}), "
                f"서브={sub_gender} ({vs_sub})\n"
                f"- 섹션 헤더는 반드시 `[<Section> - Duet]`, `[<Section> - Main Vocal]`, "
                f"또는 `[<Section> - Sub Vocal]` 형식으로 (★ `[]` 안은 모두 영문). 줄별 라벨 금지.\n"
            )
        else:
            duet_line = (
                f"- 듀엣 보컬 톤: main={vs_main or '—'}, sub={vs_sub or '—'}\n"
                f"- 섹션 헤더는 `[<Section> - Duet/Main Vocal/Sub Vocal]` 형식으로 (★ `[]` 안은 모두 영문). 줄별 라벨 금지.\n"
            )

    if duration_minutes == 3:
        length_hint = "약 700~1100자"
    else:
        length_hint = "약 600~800자"

    msg = f"""[커플 정보]
{pa_line}
{pb_line}

{facts_block}

[서약]
- 키워드: {vow_keywords_str}
- 자유 한 줄: {vow_line}

[결혼식 맥락]
- 식 분위기: {tone}
- 하객에게 전하고 싶은 한 줄: {audience_line}

[음악 사양]
- 장르: {genre}
- 분위기: {moods_str}
- 길이: 약 {duration_minutes}분 ({length_hint} 본문 권장)
- 보컬 형태: {vocal_form}
{duet_line}- 언어: {language_label}

[요구]
위 [이야기 사실] 항목 각각은 사용자가 자유롭게 쓴 통문장이다.
그 통문장에서 다음을 모두 추출해서 가사에 박아라:
  · 시간·장소·소품 같은 구체 사실 (상황 라인)
  · 카메라가 찍을 수 있는 미시 동작 (행동 라인)
  · 화자가 그때 느낀 속마음 (심정 라인)
한 통문장에 다 들어있으니 임의로 사실을 추가하지 말고,
거기서 추출한 것만으로 충실하게 채워라.

각 회상 섹션은 [시점 마커(START 헤딩) → 상황 → 행동 → 심정] 순서로 작성.
이름 또는 호칭을 가사 안에 최소 1회 노출.
부정 시점·결혼식 본행사 어휘 사용 금지.
설명·주석 없이 Suno 호환 메타태그 가사만 출력.
- duration_minutes={duration_minutes}분에 맞춰 본문 길이를 충분히 채워라:
  · 2분 → 600~800자 / 7섹션 (Verse 3·Bridge 생략 가능)
  · 3분 → 1000~1400자 / 풀 9섹션 (★ 1000자 미만 금지, 다시 길게 작성)
"""
    if extra_user_note and extra_user_note.strip():
        msg = msg.rstrip() + "\n" + extra_user_note.strip() + "\n"
    return msg


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def _strip_story_for_prompt(story: dict) -> dict:
    """
    Mongo 문서에서 가사 생성에 필요한 키만 추려낸다 (_id, user_id, created_at 제거).
    v2.1: story.story 안의 8필드(상황·심정 페어 + memories + rituals)는 그대로 통과.
    레거시 turning_points 키가 들어있어도 _build_user_message_wedding 이 사용하지
    않으므로 가사에 반영되지 않는다.
    """
    return {
        "couple": story.get("couple"),
        "story": story.get("story"),
        "vow": story.get("vow"),
        "wedding_context": story.get("wedding_context"),
    }


def _max_tokens_for_duration(duration_minutes: int) -> int:
    """
    duration_minutes 별 가사 생성 max_tokens 분기.
    한국어 1.5~2 tokens/char 기준, 1400자 × 2 ≈ 2800 토큰까지 갈 수 있어
    3분은 안전 마진 2000 으로 잡는다.

    v30 — thinking/reasoning ON 시 thinking/reasoning 200~400 토큰이 동일
    한도 안에서 소비됨. 모든 분기 ×2 로 상향.
    """
    # v53.1 — v49 strict 4줄 룰 + 영문 라벨 prompt 가 길어지고 thinking 토큰
    # 소비가 더 커져 종전 한도에 막혀 빈 응답이 오는 케이스 발견. ×~1.5 상향.
    return {2: 4000, 3: 6000}.get(duration_minutes, 5000)


async def _generate_via_openai(system_prompt: str, user_message: str, model: str, duration_minutes: int) -> tuple[str, str]:
    from .llm_thinking_config import apply_reasoning_to_openai
    client = _get_openai_client()

    lyrics_kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.8,
        "max_tokens": _max_tokens_for_duration(duration_minutes),
    }
    # v27 — reasoning_effort + strip unsupported sampling (GPT-5+).
    apply_reasoning_to_openai(lyrics_kwargs, model)
    logger.info(
        "[LyricsGen] openai lyrics call model=%s reasoning=%s",
        model, bool(lyrics_kwargs.get("reasoning_effort")),
    )
    lyrics_response = await client.chat.completions.create(**lyrics_kwargs)
    lyrics = (lyrics_response.choices[0].message.content or "").strip()
    # v53.1 — 같은 가드 (OpenAI 측). 빈 본문이면 title 호출이 400 으로 떨어지기 전에 차단.
    if not lyrics:
        finish_reason = lyrics_response.choices[0].finish_reason if lyrics_response.choices else "?"
        logger.warning(
            "[LyricsGen] openai empty lyrics finish_reason=%s",
            finish_reason,
        )
        raise ValueError(
            "가사 본문이 비어 있습니다 (OpenAI finish_reason={}). "
            "한 번 더 재시도하거나 prompt 길이를 줄여주세요.".format(finish_reason)
        )

    title_kwargs: dict = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Generate a short, catchy song title (1-5 words) for the following wedding lyrics. "
                    "Output ONLY the title, nothing else. Match the language of the lyrics."
                ),
            },
            {"role": "user", "content": lyrics},
        ],
        "temperature": 0.7,
        # v30 — 50 → 400. reasoning_effort=high 시 reasoning_tokens 가 50을 다 차지
        # 해 finish=length + 빈 응답 발생하던 케이스 해소. 실제 title 출력은 5~30
        # 토큰이라 reasoning(~320) + 출력(~80) 마진 잡음.
        "max_tokens": 400,
    }
    apply_reasoning_to_openai(title_kwargs, model)
    title_response = await client.chat.completions.create(**title_kwargs)
    title = title_response.choices[0].message.content.strip().strip('"\'')
    return title, lyrics


async def _generate_via_anthropic(system_prompt: str, user_message: str, model: str, duration_minutes: int) -> tuple[str, str]:
    from .llm_thinking_config import apply_thinking_to_anthropic
    client = _get_anthropic_client()

    lyrics_kwargs = {
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": _max_tokens_for_duration(duration_minutes),
        "temperature": 0.8,
    }
    # v27 — adaptive thinking + strip unsupported sampling (Opus 4.7+).
    apply_thinking_to_anthropic(lyrics_kwargs, model)
    logger.info(
        "[LyricsGen] anthropic lyrics call model=%s thinking=%s",
        model, bool(lyrics_kwargs.get("thinking")),
    )
    lyrics_response = await client.messages.create(**lyrics_kwargs)
    lyrics = _xtxt(lyrics_response)
    # v53.1 — Claude 가 빈 본문을 반환하면 title 호출이 empty user content → 400.
    # 즉시 명확한 에러로 변환. (보통 stop_reason="max_tokens" 또는 thinking 토큰 소진.)
    if not lyrics:
        stop_reason = getattr(lyrics_response, "stop_reason", "?")
        usage = getattr(lyrics_response, "usage", None)
        logger.warning(
            "[LyricsGen] anthropic empty lyrics stop_reason=%s usage=%s",
            stop_reason, usage,
        )
        raise ValueError(
            "가사 본문이 비어 있습니다 (Claude stop_reason={}). "
            "한 번 더 재시도하거나 prompt 길이를 줄여주세요.".format(stop_reason)
        )

    title_kwargs = {
        "model": model,
        "system": (
            "Generate a short, catchy song title (1-5 words) for the following wedding lyrics. "
            "Output ONLY the title, nothing else. Match the language of the lyrics."
        ),
        "messages": [{"role": "user", "content": lyrics}],
        # v30 — 50 → 400. adaptive thinking 시 thinking_tokens 가 동일 한도 안에서
        # 소비됨. 동일 안전 마진 적용 (OpenAI 와 통일).
        "max_tokens": 400,
        "temperature": 0.7,
    }
    apply_thinking_to_anthropic(title_kwargs, model)
    title_response = await client.messages.create(**title_kwargs)
    title = _xtxt(title_response).strip('"\'')

    return title, lyrics


async def _generate_once(
    story: dict,
    music: dict,
    model: str | None = None,
    extra_user_note: str | None = None,
) -> dict:
    """단일 호출 (OpenAI/Anthropic 분기). retry 외부에서 1회 호출용."""
    music = music or {}
    duet = (music.get("vocal_form") == "duet")
    system_prompt = WEDDING_SYSTEM_PROMPT_DUET if duet else WEDDING_SYSTEM_PROMPT_SOLO

    story_for_prompt = _strip_story_for_prompt(story or {})
    user_message = _build_user_message_wedding(story_for_prompt, music, extra_user_note=extra_user_note)

    chosen_model = model or settings.wedding_lyrics_default_model
    duration_minutes = int(music.get("duration_minutes") or 2)

    if chosen_model.startswith("claude-"):
        title, body = await _generate_via_anthropic(system_prompt, user_message, chosen_model, duration_minutes)
    else:
        title, body = await _generate_via_openai(system_prompt, user_message, chosen_model, duration_minutes)

    return {"title": title, "body": body, "model": chosen_model}


async def generate_wedding_lyrics(
    story: dict,
    music: dict,
    model: str | None = None,
) -> dict:
    """
    Generate Suno-compatible wedding lyrics from a structured CoupleStory + MusicSpec.

    Args:
        story: CoupleStory.model_dump() — Mongo 문서를 그대로 넘겨도 OK
               (내부에서 couple/story/vow/wedding_context 키만 사용).
        music: MusicSpec.model_dump() / dict.
        model: 모델 이름. None이면 settings.wedding_lyrics_default_model (= claude-opus-4-7).
               "claude-..." 으로 시작하면 Anthropic, 그 외는 OpenAI.

    Returns:
        {"title": str, "body": str, "model": str,
         "_retry_attempted": bool, "_final_body_length": int}

    Raises:
        Exception: 모델 호출 실패. 호출자에서 잡아 mv_jobs.error_message 에 기록.
    """
    music = music or {}
    duration = int(music.get("duration_minutes") or 2)
    min_required = _MIN_BODY_LENGTH.get(duration, 600)

    # 첫 시도
    result = await _generate_once(story, music, model)
    body_length = _measure_body_length(result.get("body") or result.get("lyrics") or "")

    if body_length < min_required:
        # 재시도: user message에 "이전 출력이 너무 짧았다" 강제 추가
        retry_note = (
            f"\n\n[★ 재시도 강제 지시]\n"
            f"이전 출력은 본문 {body_length}자로 너무 짧았다. "
            f"이번에는 본문 {min_required}자 이상으로 충분히 길게 작성하라. "
            f"각 섹션의 최소 줄수를 반드시 지켜라. 줄 수가 부족하면 실패다."
        )
        result = await _generate_once(story, music, model, extra_user_note=retry_note)
        new_length = _measure_body_length(result.get("body") or result.get("lyrics") or "")
        # 두 번째도 미달이면 그대로 반환 (백엔드 무한 루프 방지)
        result["_retry_attempted"] = True
        result["_final_body_length"] = new_length
    else:
        result["_retry_attempted"] = False
        result["_final_body_length"] = body_length

    return result
