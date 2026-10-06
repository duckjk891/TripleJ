"""v3.284 — 가사 속 괄호 연출 지시 → Suno 메타태그 줄 변환 (순수 함수, I/O 없음).

배경(10-06 실데이터): 최근 가사 187건 중 34건(18%)에 `(whisper) 가사`·`가사 (echo)` 같은 괄호 연출이 있었다.
Suno 는 괄호 안 글자를 코러스(백보컬)로 부르는 관행이 있고, 부르지 않더라도 타임스탬프 정렬이 그 글자를
가사 단어로 세어 싱크가 밀린다. → 작곡 직전 전송본에서만 연출 괄호를 '단독 태그 줄'(`[Whispered]`)로 올린다.
태그 줄은 노래되지 않고(v3.283c `[Female Vocal]` 실곡 검증) 자막에서도 `[...]` 단독 줄로 제외된다.

규칙
- 괄호 안이 아래 어휘 '만'(쉼표·/·&·and 로 여러 개 가능)으로 이뤄졌을 때만 연출로 본다.
  `(oh oh)`·`(사랑해)`·`(우산 아래의 속삭임)` 같은 실제로 부르는 괄호는 절대 바꾸지 않는다.
- 연출이 있는 줄: 그 줄 바로 위에 `[연출, 연출]` 태그 줄을 넣고 줄에서는 괄호만 뺀다(가사 글자 불변).
  괄호만 있던 줄은 태그 줄로 바뀐다.
- 태그 줄(`[Verse: soft]` 등)은 건드리지 않는다. 연출이 하나도 없으면 입력 문자열을 그대로(바이트 불변) 돌려준다.
"""

import re

# 소문자 어휘 → Suno 태그 표기
_CUE_MAP = {
    # 속삭임
    "whisper": "Whispered", "whispers": "Whispered", "whispered": "Whispered", "whispering": "Whispered",
    "속삭이듯": "Whispered", "속삭이며": "Whispered", "속삭임": "Whispered", "속삭여": "Whispered",
    # 말하듯(내레이션)
    "spoken": "Spoken Word", "spoken word": "Spoken Word", "speaking": "Spoken Word", "speak": "Spoken Word",
    "talking": "Spoken Word", "narration": "Spoken Word", "narrated": "Spoken Word",
    "읊조리듯": "Spoken Word", "읊조리며": "Spoken Word", "내레이션": "Spoken Word", "나레이션": "Spoken Word",
    "말하듯": "Spoken Word", "대사": "Spoken Word",
    # 애드리브
    "ad-lib": "Ad-libs", "ad lib": "Ad-libs", "adlib": "Ad-libs", "ad-libs": "Ad-libs", "ad libs": "Ad-libs",
    "adlibs": "Ad-libs", "애드립": "Ad-libs", "애드리브": "Ad-libs",
    # 화음
    "harmonize": "Harmonized", "harmonise": "Harmonized", "harmonized": "Harmonized", "harmonised": "Harmonized",
    "harmony": "Harmonized", "harmonies": "Harmonized", "화음": "Harmonized",
    # 가성
    "falsetto": "Falsetto", "가성": "Falsetto",
    # 에코
    "echo": "Echo", "echoes": "Echo", "echoing": "Echo", "echoed": "Echo", "에코": "Echo", "메아리": "Echo",
    # 랩
    "rap": "Rap", "rapping": "Rap", "랩": "Rap",
    # 허밍
    "hum": "Humming", "hums": "Humming", "humming": "Humming", "허밍": "Humming",
    # 기타 창법·표현
    "belt": "Belting", "belting": "Belting",
    "laugh": "Laughing", "laughs": "Laughing", "laughing": "Laughing", "laughter": "Laughing",
    "웃으며": "Laughing", "웃음": "Laughing",
    "sigh": "Sigh", "sighs": "Sigh", "sighing": "Sigh", "한숨": "Sigh",
    "soft": "Soft", "softly": "Soft", "작게": "Soft", "부드럽게": "Soft",
    "slow": "Slow", "slowly": "Slow", "천천히": "Slow",
    "breathy": "Breathy",
    # 악기 구간
    "guitar solo": "Guitar Solo", "기타 솔로": "Guitar Solo",
    "piano solo": "Piano Solo", "피아노 솔로": "Piano Solo",
}
# 태그 줄 판별용(작사 결과의 `[Whispered]` 같은 줄) — 어휘 + 표기 모두 허용
_CUE_TOKENS = set(_CUE_MAP) | {v.lower() for v in _CUE_MAP.values()}

_PAREN_RE = re.compile(r"\(([^()\n]{1,40})\)")
_SPLIT_RE = re.compile(r"\s*(?:,|/|&|\+|\band\b)\s*", re.I)
_TAG_ONLY_RE = re.compile(r"^\s*\[([^\[\]\n]+)\]\s*$")
_LEADING_WS_RE = re.compile(r"^\s*")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower()).strip(" .…~!")


def cues_of(inner: str):
    """괄호 안 문자열 → 태그 표기 목록. 어휘만으로 이뤄지지 않았으면 None(=실제 코러스, 불변)."""
    parts = [p for p in (_norm(x) for x in _SPLIT_RE.split(inner or "")) if p]
    if not parts:
        return None
    out = []
    for p in parts:
        cue = _CUE_MAP.get(p)
        if cue is None:
            return None
        if cue not in out:
            out.append(cue)
    return out


def is_cue_tag_line(line: str) -> bool:
    """`[Whispered]`·`[Spoken Word, Echo]` 처럼 연출 어휘만 담은 단독 태그 줄이면 True (섹션 태그 아님)."""
    m = _TAG_ONLY_RE.match(line or "")
    if not m:
        return False
    parts = [p for p in (_norm(x) for x in _SPLIT_RE.split(m.group(1))) if p]
    return bool(parts) and all(p in _CUE_TOKENS for p in parts)


def lift_inline_directions(text: str):
    """전송본 가사의 괄호 연출을 단독 태그 줄로 올린다. 반환 (text, stats).

    stats: lifted(변환한 괄호 수) lines(영향받은 줄 수) cues(태그 표기별 횟수)
    """
    stats = {"lifted": 0, "lines": 0, "cues": {}}
    if not text or "(" not in text:
        return text, stats
    out = []
    for ln in text.split("\n"):
        if "(" not in ln or _TAG_ONLY_RE.match(ln):
            out.append(ln)
            continue
        found = []

        def _sub(m):
            c = cues_of(m.group(1))
            if c is None:
                return m.group(0)
            stats["lifted"] += 1
            for x in c:
                if x not in found:
                    found.append(x)
            return " "

        rest = _PAREN_RE.sub(_sub, ln)
        if not found:
            out.append(ln)
            continue
        stats["lines"] += 1
        for x in found:
            stats["cues"][x] = stats["cues"].get(x, 0) + 1
        indent = _LEADING_WS_RE.match(ln).group(0)
        eol = "\r" if ln.endswith("\r") else ""  # CRLF 원문은 줄 끝 표기 유지
        out.append("{}[{}]{}".format(indent, ", ".join(found), eol))
        rest = re.sub(r"[ \t]{2,}", " ", rest).strip()
        if rest:
            out.append(indent + rest + eol)
    if not stats["lifted"]:
        return text, stats
    return "\n".join(out), stats
