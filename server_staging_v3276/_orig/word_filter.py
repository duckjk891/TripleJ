"""v3.232 G1 — 금칙어·개인정보 필터 (PLAN v3.232 S11).

check_text(text, child) -> Optional[reason]
  - 공통(욕설·성적·혐오): constants/word_filter_ko.py 자체 목록.
  - 어린이 전용 개인정보 패턴: 전화번호·이메일·URL/도메인·메신저 아이디/오픈채팅·주소(동·호, 번지, 아파트)·학교명.
  reason 코드: profanity · sexual · hate · phone · email · url · messenger · address · school

word_filter_response(user_id, texts, where, ...) -> Optional[JSONResponse]
  - 호출 조건(1차) = 어린이 || settings.word_filter_all_users. 킬 스위치 OFF 이고 전체 적용 OFF 면
    DB 조회 없이 즉시 None(성인 경로 무변화).
  - v3.233: || (settings.word_filter_social_all_users && where ∈ SOCIAL_WHERE — DM·피드 글·피드 댓글·곡 댓글).
    성인 판정은 욕설·성적·혐오만(개인정보는 어린이 전용), constants.ADULT_EXEMPT_* 낱말 제외.
  - 걸리면 400 {"error": "사용할 수 없는 표현이 들어 있어요. 다른 말로 바꿔주세요.", "code": "word_filtered"}
  - 호출부는 ⭐ 차감·저장 **전**에 부른다.

로그 `[wordfilter] hit reason=%s len=%d child=%s where=%s user=%s` — 원문·단어는 기록하지 않는다.
"""

import logging
import re
import unicodedata
from typing import Iterable, Optional

from fastapi.responses import JSONResponse

from ..config import settings
from ..constants import word_filter_ko as W
from . import kids_policy

logger = logging.getLogger(__name__)

WORD_FILTERED_CODE = "word_filtered"
WORD_FILTERED_MESSAGE = "사용할 수 없는 표현이 들어 있어요. 다른 말로 바꿔주세요."

# 어절 정리: 한글 음절·자모·라틴 문자만 남긴다(숫자·기호·이모지 제거 → "시1발"·"씨.발" 우회 대응)
# (NFKC 는 호환 자모 ㅅ(U+3145)를 조합용 자모 ᄉ(U+1109)로 바꾸므로 두 범위 모두 남긴다)
_NON_LETTER_RE = re.compile(r"[^0-9a-z\uac00-\ud7a3\u3131-\u318e\u1100-\u11ff]")
_DIGIT_RE = re.compile(r"[0-9]")

def _nfkc(w: str) -> str:
    return unicodedata.normalize("NFKC", w).lower()


# 목록도 입력과 같은 NFKC 로 맞춘다(ㅅㅂ 같은 호환 자모 → 조합용 자모)
_KO_LISTS = (
    ("profanity", tuple(_nfkc(w) for w in W.PROFANITY_KO)),
    ("sexual", tuple(_nfkc(w) for w in W.SEXUAL_KO)),
    ("hate", tuple(_nfkc(w) for w in W.HATE_KO)),
)
_ALLOW = tuple(sorted((_nfkc(w) for w in tuple(W.ALLOW_PHRASES) + tuple(getattr(W, "ALLOW_PHRASES_V3233", ()))),
                      key=len, reverse=True))

# v3.233 — 어절 경계 정책(constants 주석 참고): 욕설 기본 any, 성적·혐오 기본 left, EDGE/LEFT_WORDS 로 덮어씀.
_EDGE_WORDS = frozenset(_nfkc(w) for w in getattr(W, "EDGE_WORDS", ()))
_LEFT_WORDS = frozenset(_nfkc(w) for w in getattr(W, "LEFT_WORDS", ()))
_EDGE_NEXT = frozenset(_nfkc(getattr(W, "EDGE_NEXT", "")))
_EDGE_NEXT_END = frozenset(_nfkc(getattr(W, "EDGE_NEXT_END", "")))
_ALLOW_EN = tuple(getattr(W, "ALLOW_EN_PHRASES", ()))
_ADULT_ALLOW_EN = tuple(getattr(W, "ADULT_ALLOW_EN_PHRASES", ()))


def _policy(reason: str, w: str) -> str:
    if w in _EDGE_WORDS:
        return "edge"
    if w in _LEFT_WORDS:
        return "left"
    return "any" if reason == "profanity" else "left"


def _is_syllable(ch: str) -> bool:
    return "\uac00" <= ch <= "\ud7a3"


def _word_hit(c: str, w: str, policy: str, is_run: bool) -> bool:
    """후보 문자열 c 안에서 금칙어 w 가 정책대로 일치하는가."""
    start = c.find(w)
    while start != -1:
        end = start + len(w)
        left_ok = start == 0 or not _is_syllable(c[start - 1])
        right_ok = (end == len(c) or c[end] in _EDGE_NEXT or not _is_syllable(c[end])
                    or (c[end] in _EDGE_NEXT_END and end + 1 == len(c)))
        if policy == "any":
            return True
        if policy == "left" and left_ok:
            return True
        if policy == "edge" and (right_ok if is_run else (left_ok or right_ok)):
            return True
        start = c.find(w, start + 1)
    return False

# v3.233 — 성인용 목록(어린이 목록에서 ADULT_EXEMPT_* 제외). 어린이 판정은 위 목록 그대로(바이트 동일 동작).
_ADULT_EXEMPT_KO = frozenset(_nfkc(w) for w in getattr(W, "ADULT_EXEMPT_KO", ()))
_KO_LISTS_ADULT = tuple((r, tuple(w for w in ws if w not in _ADULT_EXEMPT_KO)) for r, ws in _KO_LISTS)


def _en_re(words):
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")(?![a-z0-9])")


_EN_LISTS = (
    ("profanity", _en_re(W.PROFANITY_EN)),
    ("sexual", _en_re(W.SEXUAL_EN)),
    ("hate", _en_re(W.HATE_EN)),
)
_ADULT_EXEMPT_EN = frozenset(getattr(W, "ADULT_EXEMPT_EN", ()))
_EN_LISTS_ADULT = tuple(
    (r, _en_re([w for w in ws if w not in _ADULT_EXEMPT_EN]))
    for r, ws in (("profanity", W.PROFANITY_EN), ("sexual", W.SEXUAL_EN), ("hate", W.HATE_EN))
)

# v3.233 — "소통 경로" where 값(WORD_FILTER_SOCIAL_ALL_USERS 적용 범위). 작사(generate·lyrics)·캐릭터·곡 제목
# (track_publish·track_update)·프로필(닉네임·기획사명)은 포함하지 않는다(어린이만).
# v3.245 — club_profile(클럽 이름·소개) 추가. 클럽 게시판 글·댓글은 기존 feed_create/feed_update/feed_comment 로 흐른다.
# v3.252 — club_chat(크루 단톡방 메시지·가입 신청 메시지) 추가.
SOCIAL_WHERE = frozenset({"dm", "feed_create", "feed_update", "feed_comment", "track_comment", "club_profile", "club_chat"})

# ── 어린이 전용 개인정보 패턴 (NFKC·소문자 텍스트, 띄어쓰기 유지) ──
_PHONE_RES = (
    re.compile(r"(?<!\d)01[016789][\s.\-]{0,2}\d{3,4}[\s.\-]{0,2}\d{4}(?!\d)"),
    re.compile(r"(?<!\d)0(?:2|[3-6][1-5])[\s.\-]{0,2}\d{3,4}[\s.\-]{0,2}\d{4}(?!\d)"),
)
_EMAIL_RE = re.compile(r"[a-z0-9._%+\-]+\s*@\s*[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}")
_URL_RES = (
    re.compile(r"https?://"),
    re.compile(r"(?<![a-z0-9])www\."),
    re.compile(r"(?<![a-z0-9@])[a-z0-9\-]{2,}(?:\.[a-z0-9\-]{2,})*\.(?:com|net|org|kr|io|me|ly|gg|tv|app|xyz|site|link|shop|info|biz|co)(?![a-z0-9])"),
)
_MESSENGER_PHRASES = (
    "카톡아이디", "카톡id", "카톡아디", "카톡친추", "카톡추가", "카톡주소", "카톡방링크",
    "카카오톡아이디", "카카오톡id", "카카오아이디", "카카오id",
    "오픈채팅", "오픈카톡", "오픈톡", "오카방", "openkakao",
    "텔레그램", "텔레아이디", "라인아이디", "라인id",
    "인스타아이디", "인스타id", "디스코드아이디", "디코아이디", "틱톡아이디",
    "갠톡", "개인톡", "디엠줘", "dm줘", "페메줘",
)
# v3.232 B3(tester) — 주소·학교 패턴은 오탐 최소 우선(작사·제목·DM·닉네임에 400 이 나므로):
#   숫자(동·호수·번지·도로명 번호)가 붙거나, 실제 광역 시·도 이름 + 실제 자치구 이름 조합일 때만 적중.
#   "다시 친구 사이로"·"너도 친구 곁으로"·"아파트아파트"·"그리하여중간에" 같은 일반 낱말 끝글자 일치는 제외.
_H = "\uac00-\ud7a3"
_METRO = (
    "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북|충청남|전북|전남|전라북|전라남|"
    "경북|경남|경상북|경상남|제주"
)
# 광역시 자치구(서울 25 · 부산 16 · 대구 · 인천 · 광주 · 대전 · 울산) + 흔한 군 — "OO시 OO구" 조합 판정용
_DISTRICTS = (
    "종로구|중구|용산구|성동구|광진구|동대문구|중랑구|성북구|강북구|도봉구|노원구|은평구|서대문구|마포구|양천구|"
    "강서구|구로구|금천구|영등포구|동작구|관악구|서초구|강남구|송파구|강동구|"
    "서구|동구|영도구|부산진구|동래구|남구|북구|해운대구|사하구|금정구|연제구|수영구|사상구|기장군|"
    "수성구|달서구|달성군|군위군|미추홀구|연수구|남동구|부평구|계양구|강화군|옹진군|광산구|유성구|대덕구|울주군|"
    "분당구|수정구|중원구|장안구|권선구|팔달구|영통구|일산동구|일산서구|덕양구|상록구|단원구|만안구|동안구|"
    "처인구|기흥구|수지구|원미구|소사구|오정구|흥덕구|청원구|상당구|서원구|동남구|서북구|완산구|덕진구|의창구|성산구|"
    "마산합포구|마산회원구|진해구"
)
_ADDRESS_RES = (
    # 101동 1203호 · 3동 201호
    re.compile(r"\d{1,4}\s*동\s*\d{1,4}\s*호"),
    # 123번지
    re.compile(r"\d{1,5}\s*번지"),
    # 도로명 + 번호: "테헤란로 123-4" · "역삼로 12번길" · "중앙로 12길 3"
    re.compile(r"[" + _H + r"]{1,12}(?:로|길)\s*\d{1,4}\s*번길"),
    re.compile(r"[" + _H + r"]{2,12}(?:대로|로|길)\s*\d{1,4}-\d{1,4}"),
    # 아파트·빌라·맨션 + 동/호 번호: "래미안아파트 101동"
    re.compile(r"[" + _H + r"]{2,12}(?:아파트|빌라|맨션|오피스텔)\s*\d{1,4}\s*(?:동|호)"),
    # 실제 광역 시·도 + 실제 자치구·군: "서울시 강남구" · "부산광역시 해운대구" · "서울 마포구"
    re.compile(
        r"(?<![" + _H + r"])(?:" + _METRO + r")(?:특별시|광역시|특별자치시|특별자치도|시|도)?\s*(?:" + _DISTRICTS + r")"
        r"(?=$|\s|[.,!?~]|에서|에|이야|야|의|은|는|이|으로|로)"
    ),
    # 구·군·시 + 동·읍·면 + 번지 숫자: "강남구 역삼동 123" · "수원시 매탄동 45-6"
    re.compile(r"[" + _H + r"]{1,5}(?:구|군|시)\s+[" + _H + r"]{1,6}(?:동|읍|면|리)\s*\d{1,5}(?:-\d{1,5})?(?![\d" + _H + r"])"),
)
# 학교: 이름 + 학교 종류(뒤에 조사·공백·끝만 허용) · 이름 + 학년 · 학년 + 반
_AFTER = r"(?=$|\s|[.,!?~]|에서|에게|[에의은는이가도를을와과랑로])"
_SCHOOL_RES = (
    re.compile(r"[" + _H + r"]{2,10}(?:초등학교|중학교|고등학교)" + _AFTER),
    re.compile(r"(?<![" + _H + r"])[" + _H + r"]{2,6}(?:여중|여고|초교)" + _AFTER),
    re.compile(r"(?<![" + _H + r"])[" + _H + r"]{2,10}(?:초|중|고)\s*\d\s*학년"),
    re.compile(r"\d\s*학년\s*\d{1,2}\s*반"),
)


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "").lower()


def _clean_token(tok: str) -> str:
    tok = _NON_LETTER_RE.sub("", tok)
    return _DIGIT_RE.sub("", tok)


def _ko_candidates(norm: str):
    """[(후보, 결합구간여부)] — 어절별 정리 문자열 + 한 글자 어절 연속 구간을 붙인 문자열. 정상 낱말(ALLOW)은 먼저 제거.
    v3.233: 한 글자 판정은 숫자를 남긴 길이로("10시 발 매"의 "10시"는 한 글자 어절이 아님 — "시1발"·"시 1 발" 우회는 그대로 잡힘)."""
    raw = [(_clean_token(t), _NON_LETTER_RE.sub("", t)) for t in norm.split()]
    raw = [(t, r) for t, r in raw if t]
    out = []
    run = []
    for t, r in raw:
        out.append((t, False))
        if len(r) == 1:
            run.append(t)
        else:
            if len(run) >= 2:
                out.append(("".join(run), True))
            run = []
    if len(run) >= 2:
        out.append(("".join(run), True))
    cleaned = []
    for c, is_run in out:
        for a in _ALLOW:
            if a in c:
                c = c.replace(a, " ")
        cleaned.append((c, is_run))
    return cleaned


def check_text(text, child: bool = False) -> Optional[str]:
    """금칙어·(어린이) 개인정보 판정. 걸리면 사유 코드, 아니면 None. 원문은 어디에도 남기지 않는다."""
    if not isinstance(text, str) or not text.strip():
        return None
    norm = _normalize(text)
    cands = _ko_candidates(norm)
    for reason, words in (_KO_LISTS if child else _KO_LISTS_ADULT):
        for c, is_run in cands:
            for w in words:
                if w in c and _word_hit(c, w, _policy(reason, w), is_run):
                    return reason
    en_norm = norm
    for a in _ALLOW_EN + (() if child else _ADULT_ALLOW_EN):
        en_norm = en_norm.replace(a, " ")
    for reason, rx in (_EN_LISTS if child else _EN_LISTS_ADULT):
        if rx.search(en_norm):
            return reason
    if not child:
        return None
    if any(rx.search(norm) for rx in _PHONE_RES):
        return "phone"
    digits_only = re.sub(r"[\s.\-]", "", norm)
    if re.search(r"(?<!\d)01[016789]\d{7,8}(?!\d)", digits_only):
        return "phone"
    if _EMAIL_RE.search(norm):
        return "email"
    if any(rx.search(norm) for rx in _URL_RES) or "open.kakao" in norm:
        return "url"
    compact = re.sub(r"[\s.\-_]", "", norm)
    if any(p in compact for p in _MESSENGER_PHRASES):
        return "messenger"
    if any(rx.search(norm) for rx in _ADDRESS_RES):
        return "address"
    if any(rx.search(norm) for rx in _SCHOOL_RES):
        return "school"
    return None


def word_filtered_response() -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": WORD_FILTERED_MESSAGE, "code": WORD_FILTERED_CODE},
    )


def _all_users() -> bool:
    return bool(getattr(settings, "word_filter_all_users", False))


def social_filter_on() -> bool:
    """v3.233 WORD_FILTER_SOCIAL_ALL_USERS — 소통 경로(SOCIAL_WHERE) 전체 사용자 적용 스위치."""
    return bool(getattr(settings, "word_filter_social_all_users", False))


async def word_filter_response(
    user_id, texts: Iterable, where: str, conn=None, child: Optional[bool] = None
) -> Optional[JSONResponse]:
    """적용 대상이면 texts 를 검사해 400 응답 또는 None. 킬 스위치·전체 적용·소통 전체 적용 모두 OFF 면 즉시 None(DB 0회).
    v3.233: 성인 적용 = WORD_FILTER_ALL_USERS(전 경로) 또는 WORD_FILTER_SOCIAL_ALL_USERS && where ∈ SOCIAL_WHERE."""
    all_users = _all_users() or (social_filter_on() and where in SOCIAL_WHERE)
    if not kids_policy.kids_enabled() and not all_users:
        return None
    if child is None:
        child = await kids_policy.is_child_user(user_id, conn)
    if not child and not all_users:
        return None
    for t in texts or ():
        if not isinstance(t, str) or not t:
            continue
        reason = check_text(t, child=bool(child))
        if reason:
            logger.info(
                "[wordfilter] hit reason=%s len=%d child=%s where=%s user=%s",
                reason, len(t), bool(child), where, str(user_id)[:8] if user_id else "?",
            )
            return word_filtered_response()
    return None
