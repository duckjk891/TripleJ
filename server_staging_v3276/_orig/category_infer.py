"""v3.264 — 발매 시점 카테고리(느낌) 자동 부여.

배경(2026-09-29 진단): 검색 화면의 느낌 칩·느낌명 검색("슬픔" 등)은
`/charts/category/{cat}` = tracks.categories 필터를 탄다. 그런데 categories 는
클라이언트가 발매 body 에 실어 보내던 값인데 앱 리팩토링 이후 아무도 보내지
않아 09-23 이후 발매곡 전부 categories=[] — 느낌 검색에서 최신곡이 사라졌다.

해결: 발매(및 직접 업로드) 시 categories 가 비면 서버가 직접 채운다.
  1순위 — 가사 자산(lyrics_assets)의 LLM 선택 categories (작사 때 이미 뽑는다).
  2순위 — mood/genre 고정 어휘 → 카테고리 결정적 매핑 (아래 표).

매핑은 앱 작곡 디렉터의 고정 무드 8종(+영문 쌍둥이, musicService.ts MOOD_EN)을
전제로 한 부분 문자열 매칭 — LLM·외부 호출 없음, 실패 없음.
"""

import logging
from typing import Iterable, Optional

from ..constants.categories import filter_categories

logger = logging.getLogger(__name__)

# 무드(부분 문자열, 소문자 비교) → 카테고리 후보(화이트리스트 10종 내).
# 키는 한국어 무드 조각과 영문 태그 조각 모두 커버한다.
_MOOD_RULES: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("슬프", "우울", "sad", "melancholic"), ("슬픔",)),
    (("밝고", "경쾌", "bright", "upbeat"), ("행복한 기분", "에너지 충전")),
    (("흥겹", "신나", "exciting", "groovy"), ("파티", "에너지 충전")),
    (("에너지틱", "강렬", "energetic", "intense"), ("운동", "에너지 충전")),
    (("잔잔", "편안", "calm", "relaxing"), ("휴식", "잠자기")),
    (("로맨틱", "달콤", "romantic", "sweet"), ("로맨스",)),
    (("몽환", "신비", "dreamy", "ethereal"), ("집중", "잠자기")),
    (("그리운", "따뜻", "nostalgic", "warm"), ("휴식", "출퇴근길")),
]

# 장르 보강(무드 매핑에 얹는 추가 신호) — 보수적으로 파티 계열만.
_GENRE_RULES: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("댄스", "edm", "하우스", "dance", "house", "party"), ("파티",)),
]


def _norm_terms(value) -> list[str]:
    """str | list | None → 소문자 문자열 리스트."""
    if not value:
        return []
    items: Iterable = value if isinstance(value, (list, tuple)) else [value]
    return [str(v).strip().lower() for v in items if v and str(v).strip()]


def infer_categories(mood=None, genre=None) -> list:
    """mood/genre(문자열 또는 리스트)에서 카테고리 추론. 항상 화이트리스트 통과.

    매칭 없으면 [] — 호출측은 빈 결과를 그대로 저장해도 기존과 동일(악화 없음).
    """
    out: list[str] = []
    moods = _norm_terms(mood)
    genres = _norm_terms(genre)
    for needles, cats in _MOOD_RULES:
        if any(n in m for n in needles for m in moods):
            out.extend(cats)
    for needles, cats in _GENRE_RULES:
        if any(n in g for n in needles for g in genres):
            out.extend(cats)
    return filter_categories(out)


async def resolve_categories(
    mongo, user_id: str, lyrics_id: Optional[str], mood=None, genre=None,
) -> list:
    """발매 시점 카테고리 결정: 가사 자산 LLM 선택 → 무드/장르 추론 순.

    best-effort: 어떤 실패도 발매를 막지 않는다(빈 리스트 반환).
    """
    try:
        if lyrics_id:
            doc = await mongo.lyrics_assets.find_one(
                {"lyrics_id": str(lyrics_id), "user_id": user_id}
            )
            cats = filter_categories((doc or {}).get("categories"))
            if cats:
                logger.info(
                    "[cat-infer] lyrics-asset user=%s lyrics_id=%s cats=%s",
                    user_id[:8], lyrics_id, cats,
                )
                return cats
    except Exception as e:  # noqa: BLE001 — 발매 흐름 보호
        logger.warning("[cat-infer] lyrics-asset lookup failed user=%s: %s", user_id[:8], str(e)[:120])
    cats = infer_categories(mood, genre)
    if cats:
        logger.info("[cat-infer] mood/genre user=%s mood=%s genre=%s cats=%s", user_id[:8], mood, genre, cats)
    return cats
