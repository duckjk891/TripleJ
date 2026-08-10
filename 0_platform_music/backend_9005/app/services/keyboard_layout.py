"""v169 — 한/영 키보드 오타 변환 (2벌식 표준, 의존성 없음).

한영키를 안 누르고 검색한 오타를 복원하는 순수 함수 2개를 제공한다.

- eng_to_kor("dkdlspt") -> "아이네스"  (qwerty 키 → 자모 → 유니코드 음절 조합)
- kor_to_eng("아이네스") -> "dkdlspt"  (음절 → 자모 분해 → qwerty 키)

조합/분해는 한글 음절 유니코드 산술(초성 19 · 중성 21 · 종성 28,
0xAC00 + 초성*588 + 중성*28 + 종성)로 처리하고, 쌍자음(ㄲㄸㅃㅆㅉ)·복모음
(ㅘㅙㅚㅝㅞㅟㅢ)·겹받침(ㄳㄵ…ㅄ)까지 표준 두벌식 오토마타 규칙을 따른다.
매핑되지 않는 문자(숫자·공백·기호)는 그대로 통과한다. 순수 함수 — 로깅/IO 없음.
"""

from typing import List

# ─── 유니코드 음절 산술용 자모 테이블 ────────────────────────────────────────

_CHOSEONG = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]  # 19
_JUNGSEONG = [
    "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
    "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
]  # 21
_JONGSEONG = [
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
    "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]  # 28

_CHO_IDX = {j: i for i, j in enumerate(_CHOSEONG)}
_JUNG_IDX = {j: i for i, j in enumerate(_JUNGSEONG)}
_JONG_IDX = {j: i for i, j in enumerate(_JONGSEONG)}

# ─── 2벌식 표준 qwerty ↔ 자모 매핑 ──────────────────────────────────────────

_KEY_TO_JAMO = {
    # 자음 (소문자)
    "q": "ㅂ", "w": "ㅈ", "e": "ㄷ", "r": "ㄱ", "t": "ㅅ",
    "a": "ㅁ", "s": "ㄴ", "d": "ㅇ", "f": "ㄹ", "g": "ㅎ",
    "z": "ㅋ", "x": "ㅌ", "c": "ㅊ", "v": "ㅍ",
    # 쌍자음 (shift)
    "Q": "ㅃ", "W": "ㅉ", "E": "ㄸ", "R": "ㄲ", "T": "ㅆ",
    # 모음
    "y": "ㅛ", "u": "ㅕ", "i": "ㅑ", "o": "ㅐ", "p": "ㅔ",
    "h": "ㅗ", "j": "ㅓ", "k": "ㅏ", "l": "ㅣ",
    "b": "ㅠ", "n": "ㅜ", "m": "ㅡ",
    "O": "ㅒ", "P": "ㅖ",
}

# 복모음 조합 (기존중성 + 새모음 → 복모음)
_VOWEL_COMPOUND = {
    ("ㅗ", "ㅏ"): "ㅘ", ("ㅗ", "ㅐ"): "ㅙ", ("ㅗ", "ㅣ"): "ㅚ",
    ("ㅜ", "ㅓ"): "ㅝ", ("ㅜ", "ㅔ"): "ㅞ", ("ㅜ", "ㅣ"): "ㅟ",
    ("ㅡ", "ㅣ"): "ㅢ",
}

# 겹받침 조합 (기존종성 + 새자음 → 겹받침)
_JONG_COMPOUND = {
    ("ㄱ", "ㅅ"): "ㄳ", ("ㄴ", "ㅈ"): "ㄵ", ("ㄴ", "ㅎ"): "ㄶ",
    ("ㄹ", "ㄱ"): "ㄺ", ("ㄹ", "ㅁ"): "ㄻ", ("ㄹ", "ㅂ"): "ㄼ",
    ("ㄹ", "ㅅ"): "ㄽ", ("ㄹ", "ㅌ"): "ㄾ", ("ㄹ", "ㅍ"): "ㄿ",
    ("ㄹ", "ㅎ"): "ㅀ", ("ㅂ", "ㅅ"): "ㅄ",
}

# 겹받침 분해 (다음 글자가 모음일 때: 앞 요소는 받침으로 남고 뒤 요소가 새 초성)
_JONG_SPLIT = {v: k for k, v in _JONG_COMPOUND.items()}
# 복모음 분해 (kor_to_eng 용)
_VOWEL_SPLIT = {v: k for k, v in _VOWEL_COMPOUND.items()}

# 자모 → qwerty 키 (단일 자모 역매핑; 쌍자음/복모음/겹받침은 분해 후 매핑)
_JAMO_TO_KEY = {}
for _k, _j in _KEY_TO_JAMO.items():
    _JAMO_TO_KEY.setdefault(_j, _k)


def _compose(cho: str, jung: str, jong: str) -> str:
    """초/중/종 자모를 하나의 한글 음절로 조합 (유니코드 산술)."""
    code = 0xAC00 + _CHO_IDX[cho] * 588 + _JUNG_IDX[jung] * 28 + _JONG_IDX[jong or ""]
    return chr(code)


def eng_to_kor(s: str) -> str:
    """qwerty 로 잘못 입력된 한글을 복원한다 (예: "dkdl" → "아이").

    표준 두벌식 오토마타: 자음은 초성→종성(겹받침 조합) 순으로 채우고, 모음이
    오면 직전 받침(겹받침이면 뒤 요소)이 새 음절의 초성으로 넘어간다.
    미매핑 문자는 그대로 출력. 순수 함수 — 절대 raise 하지 않는다.
    """
    out: List[str] = []
    cho = jung = jong = ""

    def flush() -> None:
        nonlocal cho, jung, jong
        if cho and jung:
            out.append(_compose(cho, jung, jong))
        elif cho:
            out.append(cho)
        elif jung:
            out.append(jung)
        cho = jung = jong = ""

    for ch in s or "":
        jamo = _KEY_TO_JAMO.get(ch) or _KEY_TO_JAMO.get(ch.lower())
        if jamo is None:
            flush()
            out.append(ch)
            continue

        if jamo in _JUNG_IDX:  # 모음
            if jong:
                # 받침이 다음 음절의 초성으로 넘어간다 (겹받침이면 뒤 요소만).
                if jong in _JONG_SPLIT:
                    remain, moved = _JONG_SPLIT[jong]
                else:
                    remain, moved = "", jong
                jong = remain
                flush()
                cho, jung = moved, jamo
            elif jung:
                compound = _VOWEL_COMPOUND.get((jung, jamo))
                if compound:
                    jung = compound
                else:
                    flush()
                    jung = jamo
            else:
                jung = jamo  # 초성 유무와 무관 (초성 없으면 flush 시 단독 모음)
        else:  # 자음
            if cho and jung:
                if jong:
                    compound = _JONG_COMPOUND.get((jong, jamo))
                    if compound:
                        jong = compound
                    else:
                        flush()
                        cho = jamo
                elif jamo in _JONG_IDX:
                    jong = jamo
                else:  # ㄸ/ㅃ/ㅉ 는 받침 불가 → 새 음절 시작
                    flush()
                    cho = jamo
            else:
                flush()
                cho = jamo

    flush()
    return "".join(out)


def kor_to_eng(s: str) -> str:
    """한글로 잘못 입력된 영문을 복원한다 (예: "쟈메" → "wiapp" 이 아닌 실제 키열).

    음절은 유니코드 산술로 초/중/종 분해, 복모음·겹받침은 구성 요소로 나눠
    각 요소를 qwerty 키로 역매핑한다. 호환 자모(ㄱ~ㅣ 단독)도 처리하며
    미매핑 문자는 그대로 출력. 순수 함수 — 절대 raise 하지 않는다.
    """

    def jamo_keys(jamo: str) -> str:
        if jamo in _JAMO_TO_KEY:
            return _JAMO_TO_KEY[jamo]
        if jamo in _VOWEL_SPLIT:
            a, b = _VOWEL_SPLIT[jamo]
            return _JAMO_TO_KEY.get(a, "") + _JAMO_TO_KEY.get(b, "")
        if jamo in _JONG_SPLIT:
            a, b = _JONG_SPLIT[jamo]
            return _JAMO_TO_KEY.get(a, "") + _JAMO_TO_KEY.get(b, "")
        return jamo

    out: List[str] = []
    for ch in s or "":
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:  # 완성형 음절
            offset = code - 0xAC00
            cho = _CHOSEONG[offset // 588]
            jung = _JUNGSEONG[(offset % 588) // 28]
            jong = _JONGSEONG[offset % 28]
            out.append(jamo_keys(cho))
            out.append(jamo_keys(jung))
            if jong:
                out.append(jamo_keys(jong))
        elif 0x3131 <= code <= 0x3163:  # 호환 자모 단독 (ㄱ~ㅣ)
            out.append(jamo_keys(ch))
        else:
            out.append(ch)
    return "".join(out)
