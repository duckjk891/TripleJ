from datetime import date, datetime
from typing import List, Optional, Tuple
from urllib.parse import urlparse
from pydantic import BaseModel, EmailStr, Field

# ProfileSquad — 인구통계 필드 검증 상수 (전부 선택 입력)
GENDERS = {"male", "female", "other"}
REGIONS = {
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "해외",
}
BIRTH_DATE_MIN = date(1900, 1, 1)

# GuardSquad — 내/외국인 구분 (자기신고, 기록용) + 만14세 게이트 상수
NATIONALITIES = {"domestic", "foreign"}
GUARDIAN_CONSENT_AGE = 14  # 만 나이 기준


def age_years(birth_date: date, today: Optional[date] = None) -> int:
    """만 나이 계산 — 오늘 기준, 생일이 안 지났으면 -1."""
    today = today or date.today()
    years = today.year - birth_date.year
    if (today.month, today.day) < (birth_date.month, birth_date.day):
        years -= 1
    return years


def is_under_14(birth_date: Optional[date], today: Optional[date] = None) -> bool:
    """만 14세 미만 여부. birth_date 미입력(None)이면 False (게이트 미적용)."""
    if birth_date is None:
        return False
    return age_years(birth_date, today) < GUARDIAN_CONSENT_AGE


def validate_nationality(value: Optional[str]) -> Optional[str]:
    """nationality 검증 — None 허용, 무효 시 에러 메시지 반환."""
    if value is not None and value not in NATIONALITIES:
        return "nationality 는 domestic, foreign 중 하나여야 합니다."
    return None


def parse_birth_date(value: Optional[str]) -> Tuple[Optional[date], Optional[str]]:
    """"YYYY-MM-DD" 문자열 → date 파싱. (date|None, 에러 메시지|None) 반환."""
    if value is None:
        return None, None
    try:
        d = date.fromisoformat(value)
    except (TypeError, ValueError):
        return None, "birth_date 는 YYYY-MM-DD 형식이어야 합니다."
    if value != d.isoformat():  # "20250101" 등 축약 표기 거부 — 엄격히 YYYY-MM-DD 만
        return None, "birth_date 는 YYYY-MM-DD 형식이어야 합니다."
    if not (BIRTH_DATE_MIN <= d <= date.today()):
        return None, "birth_date 는 1900-01-01 부터 오늘 사이의 날짜여야 합니다."
    return d, None


def validate_demographics(
    birth_date: Optional[str] = None,
    gender: Optional[str] = None,
    region: Optional[str] = None,
) -> Optional[str]:
    """값이 주어진 필드만 검증. 무효 시 에러 메시지(str), 통과 시 None."""
    if birth_date is not None:
        _, err = parse_birth_date(birth_date)
        if err:
            return err
    if gender is not None and gender not in GENDERS:
        return "gender 는 male, female, other 중 하나여야 합니다."
    if region is not None and region not in REGIONS:
        return "region 은 17개 시·도 이름 또는 '해외'여야 합니다."
    return None


def validate_password(password: str) -> Optional[str]:
    """가입 비밀번호 규칙: 8자 이상 + 영문·숫자 각 1개 이상. 위반 시 에러 메시지."""
    if (
        not password
        or len(password) < 8
        or not any(c.isalpha() for c in password)
        or not any(c.isdigit() for c in password)
    ):
        return "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다."
    return None


# ConsentSquad — 가입/기능 동의 키 (FE constants/consentTexts.js 와 일치)
CONSENT_KEYS = {"terms", "privacy", "overseas", "age14", "marketing", "photo_ai", "voice_ai", "face_biometric"}
REQUIRED_CONSENT_KEYS = ("terms", "privacy", "overseas", "age14")
CONSENT_VERSION_MAX_LEN = 20  # 예: '2026-07-23.v1'


def validate_signup_consents(consents) -> Tuple[Optional[dict], Optional[str]]:
    """가입 동의 검증 — (정규화 dict|None, 에러 메시지|None) 반환.

    필수 4종(terms/privacy/overseas/age14) 전부 true + version 문자열 필수.
    marketing 은 옵션(기본 false — 거부 이력도 기록 대상).
    """
    if not isinstance(consents, dict):
        return None, "필수 동의 항목에 모두 동의해야 가입할 수 있습니다."
    for key in REQUIRED_CONSENT_KEYS:
        if consents.get(key) is not True:
            return None, "필수 동의 항목에 모두 동의해야 가입할 수 있습니다."
    version = consents.get("version")
    if not isinstance(version, str) or not version.strip() or len(version.strip()) > CONSENT_VERSION_MAX_LEN:
        return None, "동의 version 정보가 올바르지 않습니다."
    return {
        "terms": True,
        "privacy": True,
        "overseas": True,
        "age14": True,
        "marketing": consents.get("marketing") is True,
        "version": version.strip(),
    }, None


# SnsLinkSquad — SNS 링크 검증 상수
SNS_LINKS_MAX = 5
SNS_LINK_MAX_LEN = 300


def validate_sns_links(links) -> Tuple[Optional[List[str]], Optional[str]]:
    """sns_links 검증·정규화. (정규화 리스트|None, 에러 메시지|None) 반환.

    각 항목 strip → http/https 스킴 + netloc 필수, 길이 ≤300,
    순서 유지 중복 제거 후 최대 5개. 빈 배열은 전량 삭제로 허용.
    """
    if not isinstance(links, list):
        return None, "sns_links 는 URL 문자열 배열이어야 합니다."
    cleaned: List[str] = []
    seen = set()
    for item in links:
        if not isinstance(item, str):
            return None, "sns_links 항목은 문자열이어야 합니다."
        url = item.strip()
        if len(url) > SNS_LINK_MAX_LEN:
            return None, "SNS 링크는 300자 이하여야 합니다."
        parsed = urlparse(url)
        if (
            not url.startswith(("http://", "https://"))
            or parsed.scheme not in ("http", "https")
            or not parsed.netloc
        ):
            return None, "올바른 URL 형식이 아닙니다(http/https)."
        if url not in seen:
            seen.add(url)
            cleaned.append(url)
    if len(cleaned) > SNS_LINKS_MAX:
        return None, "SNS 링크는 최대 5개까지 등록할 수 있습니다."
    return cleaned, None


class UserCreate(BaseModel):
    email: str
    password: str
    nickname: str
    company_name: Optional[str] = Field(default=None, max_length=100)
    display_title: Optional[str] = Field(default="대표", max_length=20)
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    region: Optional[str] = None
    nationality: Optional[str] = None
    # ConsentSquad — {terms,privacy,overseas,age14: bool 필수 true, marketing: bool 옵션, version: str}
    consents: Optional[dict] = None
    # ReferralSquad(v154) — 추천코드 (선택, 4자리). trim/대문자 정규화·검증은 auth 라우트에서 수행.
    referral_code: Optional[str] = None


class MeConsentsBody(BaseModel):
    """POST /api/auth/me/consents — 소셜 온보딩·기능 시점(photo_ai/voice_ai)·마케팅 변경 기록."""
    consents: list  # [{key: str, agreed: bool}]
    version: str


class LoginRequest(BaseModel):
    email: str
    password: str


class WithdrawRequest(BaseModel):
    """회원탈퇴 이중 확인 — confirm_text 는 정확히 '회원탈퇴' 여야 함."""
    confirm_text: str


class UserResponse(BaseModel):
    id: str
    email: str
    nickname: str
    profile_image: Optional[str] = None
    bio: Optional[str] = None
    plan: str = "free"
    company_name: Optional[str] = None
    display_title: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    region: Optional[str] = None
    created_at: Optional[datetime] = None


class UserInDB(UserResponse):
    password_hash: str


class ProfileUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=100)
    display_title: Optional[str] = Field(default=None, max_length=20)
    bio: Optional[str] = Field(default=None, max_length=500)
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    region: Optional[str] = None
    nationality: Optional[str] = None
    sns_links: Optional[List[str]] = None


# GuardSquad — 법정대리인 동의 플로우 요청 모델
class GuardianConsentRequest(BaseModel):
    """만14세 미만 가입 요청 — 가입정보 + 보호자 정보 (값 로그 금지 대상)."""
    email: str
    password: str
    nickname: str
    birth_date: str  # 필수 — 만14세 미만 판정 근거
    nationality: Optional[str] = None
    gender: Optional[str] = None
    region: Optional[str] = None
    company_name: Optional[str] = Field(default=None, max_length=100)
    display_title: Optional[str] = Field(default="대표", max_length=20)
    guardian_name: str = Field(max_length=60)
    guardian_phone: str = Field(max_length=20)
    # ConsentSquad — 아동 가입 경로도 동일 동의 필수
    consents: Optional[dict] = None


class GuardianDecision(BaseModel):
    agree: bool
