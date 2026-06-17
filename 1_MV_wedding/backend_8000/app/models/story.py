"""
Couple story / music spec Pydantic models (v2.1).

v2.1 변경:
- StoryDetails 4필드 → 8필드 (상황·심정 페어 4쌍 + memories[] + rituals).
- turning_points 필드 제거 (부정 시점 가사화 금지 룰과 일관).
- MusicSpec.duration_minutes: Literal[1, 2, 3] → Literal[2, 3].
"""

from typing import Literal

from pydantic import BaseModel, Field


class Partner(BaseModel):
    name: str
    age: int | None = None


class Couple(BaseModel):
    partner_a: Partner
    partner_b: Partner


class MentionRef(BaseModel):
    """
    v8 — story 본문 내 @-멘션이 가리키는 자산 참조.
    type="sheet" → asset_id 는 캐릭터 시트 슬롯 키(groom_casual 등).
    type="place" → asset_id 는 wedding_assets._id 문자열.
    type="wedding_photo" → asset_id 는 wedding_assets._id 문자열 (type=wedding_photo).
        v17.0 — 식전영상(MV) Phase 0/2 reference 풀 호환용 백엔드 확장.
        StoryWizardPage 의 멘션 입력 풀에는 노출하지 않는다(v17 위험·갭 권고 #3).
    """

    type: Literal["sheet", "place", "wedding_photo"]
    asset_id: str
    display_name: str
    object_name: str | None = None


class StoryDetails(BaseModel):
    """
    v2.2 — 각 시점은 단일 자유 텍스트로 받는다.
    사용자는 그때의 상황·행동·심정을 한 덩어리로 자연스럽게 작성하고,
    LLM이 가사화할 때 그 안에서 장면과 감정을 모두 추출한다.
    meeting 만 필수, 나머지 시점은 옵션.

    v8 — 각 시점에 @-멘션 메타데이터(*_refs) 추가. 모두 옵션.
    memories_refs 는 memories 와 parallel 한 2차원 배열.
    """

    meeting: str                       # 첫 만남 — 필수
    meeting_refs: list[MentionRef] = Field(default_factory=list)
    first_date: str | None = None      # 첫 데이트
    first_date_refs: list[MentionRef] = Field(default_factory=list)
    memories: list[str] = Field(default_factory=list)
    memories_refs: list[list[MentionRef]] = Field(default_factory=list)
    proposal: str | None = None        # 결혼을 결심한 순간
    proposal_refs: list[MentionRef] = Field(default_factory=list)
    wedding_prep: str | None = None    # 웨딩 준비 (드레스 / 촬영)
    wedding_prep_refs: list[MentionRef] = Field(default_factory=list)
    rituals: str | None = None         # 둘만의 단어·장소
    rituals_refs: list[MentionRef] = Field(default_factory=list)


class Vow(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    line: str | None = None


class WeddingContext(BaseModel):
    tone: str
    audience_line: str | None = None


class CoupleStory(BaseModel):
    couple: Couple
    story: StoryDetails
    vow: Vow
    wedding_context: WeddingContext


class VocalStyles(BaseModel):
    main: str
    sub: str


class VoiceCloneRef(BaseModel):
    """보이스 클론(내 목소리) 참조. ready 상태 클론만 voice_id 보유.
    suno_generator 가 voice_id 를 personaId+personaModel=voice_persona 로 전달."""
    clone_id: str | None = None
    voice_id: str | None = None
    name: str | None = None


class MusicSpec(BaseModel):
    genre: str
    moods: list[str] = Field(default_factory=list)
    duration_minutes: Literal[2, 3] = 2
    vocal_form: Literal["solo", "duet"] = "solo"
    vocal_styles: VocalStyles | None = None
    # v14 — 한영 혼합 비율 옵션 추가 (ko_en_73 = 한국어 70% + 영어 30%, 등).
    language: Literal["ko", "ko_en_73", "ko_en_55", "ko_en_37", "en"] = "ko"
    model: str | None = None
    # 보이스 클론 참조 (선택). 있으면 그 음색으로 노래 생성.
    voice_clone: VoiceCloneRef | None = None
