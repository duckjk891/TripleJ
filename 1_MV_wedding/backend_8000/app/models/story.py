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


class StoryDetails(BaseModel):
    """
    v2.2 — 각 시점은 단일 자유 텍스트로 받는다.
    사용자는 그때의 상황·행동·심정을 한 덩어리로 자연스럽게 작성하고,
    LLM이 가사화할 때 그 안에서 장면과 감정을 모두 추출한다.
    meeting 만 필수, 나머지 시점은 옵션.
    """

    meeting: str                       # 첫 만남 — 필수
    first_date: str | None = None      # 첫 데이트
    memories: list[str] = Field(default_factory=list)
    proposal: str | None = None        # 결혼을 결심한 순간
    wedding_prep: str | None = None    # 웨딩 준비 (드레스 / 촬영)
    rituals: str | None = None         # 둘만의 단어·장소


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


class MusicSpec(BaseModel):
    genre: str
    moods: list[str] = Field(default_factory=list)
    duration_minutes: Literal[2, 3] = 2
    vocal_form: Literal["solo", "duet"] = "solo"
    vocal_styles: VocalStyles | None = None
    language: Literal["ko", "en"] = "ko"
    model: str | None = None
