"""Fixed music category whitelist (single source of truth).

These are the ONLY valid category strings across the platform. The LLM picks
from this list during lyrics generation, and all downstream filtering
(generations save, track publish, category chart endpoints) validates against
``CATEGORY_SET``. Do not add/rename categories ad-hoc — change here only.
"""

# 고정 카테고리 10종 (정확히 이 문자열만 허용)
CATEGORIES = [
    "운동",
    "에너지 충전",
    "휴식",
    "출퇴근길",
    "행복한 기분",
    "집중",
    "로맨스",
    "파티",
    "슬픔",
    "잠자기",
]

CATEGORY_SET = set(CATEGORIES)


def filter_categories(values) -> list:
    """Return a whitelist-filtered, de-duplicated, order-preserving list.

    Accepts any iterable (or None). Non-string / out-of-whitelist values are
    dropped. Order follows first-occurrence in the input.
    """
    if not values:
        return []
    seen = set()
    out = []
    for v in values:
        if not isinstance(v, str):
            continue
        v = v.strip()
        if v in CATEGORY_SET and v not in seen:
            seen.add(v)
            out.append(v)
    return out
