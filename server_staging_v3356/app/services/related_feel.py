"""v3.360 [RelatedFeel] 관련곡 = 곡 느낌(장르·분위기·카테고리·템포) 유사도.

대표 지적(10-13) "비슷한 장르나 분위기로 추천해야 하는데 이상하게 추천된다 · 아티스트명으로 하는 건 아니지?"
조사: 종전 1차 추천은 검색용 임베딩(embedding_service.build_track_text = 기획사명 + 제목 + 가사 전문 + 작사 요청문 +
장르·분위기)의 최근접이라, 글자 수 대부분인 가사 주제와 기획사명으로 묶였다. 반복 hub 5곡(moonlight trance·slow 인디·
말랑한 밤 인디·너 없는 밤 발라드·시부야 밤 시티팝)은 장르가 제각각인데 모두 기획사 'DDui' + 제목 '밤'.
→ 추천은 곡 메타(장르 145/145·분위기 143·카테고리 142·bpm/tempo 일부)만으로 점수화한다. 기획사명·가사·제목은 쓰지 않는다.
검색 임베딩은 그대로(검색 품질 무영향). 순수 함수 — DB 비의존.
"""
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

W_GENRE, W_MOOD, W_CAT, W_TEMPO = 0.45, 0.30, 0.20, 0.05

# ── 장르: 표기 정규화 → 계열 ─────────────────────────────────────────────────
# 키워드(소문자·공백 제거 후 포함 검사)를 위에서부터 매칭 — 구체적인 것이 먼저.
_GENRE_RULES: List[Tuple[str, Tuple[str, ...]]] = [
    ("hiphop", ("힙합", "hiphop", "hip-hop", "붐뱁", "boombap", "rap", "랩", "trap")),
    ("trot", ("트로트", "trot")),
    ("citypop", ("시티팝", "citypop", "city-pop")),
    ("rnb", ("r&b", "알앤비", "rnb", "soul", "소울")),
    ("jazz", ("재즈", "jazz", "보사노바", "bossa", "swing", "스윙")),
    ("classical", ("클래식", "classical", "관현악", "오케스트라", "orchestra", "opera", "오페라")),
    ("kids", ("children", "동요", "carol", "캐롤", "키즈")),
    ("rock", ("록", "락", "rock", "펑크", "punk", "메탈", "metal", "얼터너티브")),
    ("electronic", ("edm", "trance", "트랜스", "dubstep", "덥스텝", "신스", "synth", "darkpop", "다크팝", "techno", "테크노")),
    ("dance", ("댄스", "dance", "하우스", "house", "디스코", "disco", "k-pop", "kpop", "j-pop", "jpop", "아이돌")),
    ("ballad", ("발라드", "ballad")),
    ("indie", ("인디", "indie", "acoustic", "어쿠스틱", "folk", "포크", "lofi", "lo-fi", "로파이")),
]
# 이웃 계열(0.4) — 양방향
_GENRE_NEAR = {
    frozenset(p) for p in [
        ("dance", "electronic"), ("hiphop", "rnb"), ("rnb", "citypop"), ("citypop", "jazz"), ("rnb", "jazz"),
        ("indie", "ballad"), ("indie", "citypop"), ("ballad", "rnb"), ("rock", "indie"), ("dance", "citypop"),
        ("hiphop", "dance"), ("classical", "ballad"),
    ]
}


def _norm(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).lower()


def genre_family(g) -> Optional[str]:
    n = _norm(g)
    if not n:
        return None
    for fam, keys in _GENRE_RULES:
        if any(k in n for k in keys):
            return fam
    return None


def _as_list(v) -> List[str]:
    if not v:
        return []
    if isinstance(v, (list, tuple)):
        return [str(x) for x in v if x]
    return [str(v)]


def genre_sim(a, b) -> float:
    """같은 표기 1.0 · 같은 계열 0.8 · 이웃 계열 0.4 · 그 외 0 (여러 값이면 최댓값)."""
    la, lb = _as_list(a), _as_list(b)
    best = 0.0
    for x in la:
        for y in lb:
            if _norm(x) == _norm(y):
                return 1.0
            fx, fy = genre_family(x), genre_family(y)
            if fx and fx == fy:
                best = max(best, 0.8)
            elif fx and fy and frozenset((fx, fy)) in _GENRE_NEAR:
                best = max(best, 0.4)
    return best


# ── 분위기: 키워드 → (에너지, 밝기) 0..1 ──────────────────────────────────────
_MOOD_KEYS: List[Tuple[Tuple[str, ...], Tuple[float, float]]] = [
    (("흥겹", "신나", "exciting", "party", "자유롭"), (0.9, 0.9)),
    (("에너지", "강렬", "energetic", "intense", "웅장", "날카"), (0.95, 0.5)),
    (("경쾌", "upbeat", "groovy", "그루비", "발랄"), (0.75, 0.85)),
    (("밝", "bright", "happy", "sunny", "행복", "평화"), (0.6, 0.9)),
    (("로맨틱", "romantic", "달콤", "sweet", "설렘"), (0.45, 0.8)),
    (("잔잔", "편안", "calm", "relax", "차분"), (0.2, 0.6)),
    (("몽환", "신비", "dreamy"), (0.35, 0.5)),
    (("그리", "따뜻", "nostalg", "덤덤", "warm"), (0.3, 0.45)),
    (("시크", "도도", "chic", "dark", "다크"), (0.55, 0.35)),
    (("슬프", "슬픈", "우울", "sad", "melanchol", "이별"), (0.25, 0.15)),
    (("두려", "공포", "fear"), (0.5, 0.1)),
]


def mood_vec(moods) -> Optional[Tuple[float, float]]:
    pts = []
    for m in _as_list(moods):
        n = _norm(m)
        for keys, v in _MOOD_KEYS:
            if any(k in n for k in keys):
                pts.append(v)
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def mood_sim(a, b) -> Optional[float]:
    va, vb = mood_vec(a), mood_vec(b)
    if va is None or vb is None:
        return None
    return max(0.0, 1.0 - math.dist(va, vb) / math.sqrt(2) * 1.6)


def cat_sim(a, b) -> Optional[float]:
    sa, sb = set(_as_list(a)), set(_as_list(b))
    if not sa or not sb:
        return None
    return len(sa & sb) / len(sa | sb)


def _tempo(doc) -> Optional[float]:
    for k in ("tempo", "bpm"):
        try:
            v = float(doc.get(k))
            if 40 <= v <= 220:
                return v
        except (TypeError, ValueError):
            pass
    return None


def tempo_sim(a: dict, b: dict) -> Optional[float]:
    ta, tb = _tempo(a), _tempo(b)
    if ta is None or tb is None:
        return None
    d = min(abs(ta - tb), abs(ta * 2 - tb), abs(ta - tb * 2))  # 반/배속 동일 취급
    return max(0.0, 1.0 - d / 40.0)


def feel_score(seed: dict, cand: dict) -> float:
    """0..1 — 없는 항목은 가중에서 빼고 재정규화. 기획사명·가사·제목은 쓰지 않는다."""
    parts = [(W_GENRE, genre_sim(seed.get("genre"), cand.get("genre")))]
    for w, s in ((W_MOOD, mood_sim(seed.get("mood"), cand.get("mood"))),
                 (W_CAT, cat_sim(seed.get("categories"), cand.get("categories"))),
                 (W_TEMPO, tempo_sim(seed, cand))):
        if s is not None:
            parts.append((w, s))
    tw = sum(w for w, _ in parts)
    return sum(w * s for w, s in parts) / tw if tw else 0.0


TOP_N = 12            # 점수 상위 N곡 안에서만 고른다(그 밖은 '비슷하지 않음')
MIN_SCORE = 0.35      # 이 미만은 후보로 치지 않음(상위 N이 모자라도 억지로 채우지 않음 → 다음 단계)
FRESH_DAYS = 7
FRESH_MULT = 1.5      # 비슷한 곡 중 최근 7일 신곡 가중 ×1.5(신곡 노출 — 장르 무관 탐색 대체)


def _created(doc) -> Optional[datetime]:
    v = doc.get("created_at")
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def rank_candidates(seed: dict, docs: Iterable[dict], now: Optional[datetime] = None) -> List[Tuple[dict, float, float]]:
    """(doc, score, base_weight) 상위 TOP_N — base_weight = 점수 순위 가중 × 점수 × 신곡 가중."""
    now = now or datetime.now(timezone.utc)
    scored = [(d, feel_score(seed, d)) for d in docs]
    scored = [x for x in scored if x[1] >= MIN_SCORE]
    scored.sort(key=lambda x: -x[1])
    out = []
    for i, (d, s) in enumerate(scored[:TOP_N]):
        w = (1.0 / (i + 3.0)) * s
        c = _created(d)
        if c and now - c <= timedelta(days=FRESH_DAYS):
            w *= FRESH_MULT
        out.append((d, s, w))
    return out
