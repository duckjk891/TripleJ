"""v3.333 [IdentityVerify] 휴대폰 본인확인(PG사) 어댑터 — PG 계약 전 '꽂기만 하면 되는' 준비본.

구조(공급자 무관):
  ① 앱 POST /api/identity/start → request_id + 인증 페이지 URL(우리 서버가 띄우는 페이지)
  ② 인증 페이지 = 공급자 화면(PG SDK)을 띄우고, 끝나면 POST /api/identity/callback/{rid} 로 결과 토큰 전달
  ③ 서버가 공급자 API 로 결과를 '서버 대 서버'로 다시 조회·검증(위변조 방지) → 이름·생년월일·성별·CI
  ④ users 반영: is_verified·verified_at·verify_provider·birth_date·gender·ci_hash(원문 CI 저장 안 함)
  ⑤ 앱은 GET /api/identity/result/{rid} 로 결과 확인(만 14세 미만이면 보호자 동의 안내)

공급자 선택 = 환경변수 IDENTITY_VERIFY_PROVIDER
  ''/'off'(기본) — 기능 꺼짐(설정 조회 enabled=false, start 503)
  'mock'          — 개발·점검용 가짜 화면(생년월일·성별 직접 입력). 운영에서 켜지 말 것.
  '<pg 이름>'     — PG 계약 후 PgProvider 를 구현해 _PROVIDERS 에 등록(아래 TODO).

받는 값은 기본 리턴값만(성명·생년월일·성별·CI/DI) — 휴대폰번호·통신사·내외국인은 요청하지 않는다(대표 10-11 결정).
로그 규칙: 이름·생년월일·CI 값 금지(길이·연령대만), request_id 앞 8자.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import logging
import os
from dataclasses import dataclass
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class IdentityResult:
    """공급자가 확인해 준 본인 정보(서버 대 서버 조회 결과만 신뢰)."""
    birth_date: date
    gender: Optional[str]          # 'male' | 'female' | None (users.gender 규약)
    ci: Optional[str] = None       # 연계정보 — 해시만 저장
    name_len: int = 0              # 로그용(이름 값은 저장·로그 금지)


class IdentityNotConfigured(Exception):
    """공급자 미설정(기능 꺼짐)."""


class IdentityVerifyError(Exception):
    """공급자 검증 실패(사용자 안내용 한국어 메시지)."""


def provider_name() -> str:
    return (os.getenv("IDENTITY_VERIFY_PROVIDER") or "").strip().lower()


def enabled() -> bool:
    return provider_name() not in ("", "off", "none", "false", "0")


def ci_hash(ci: Optional[str]) -> Optional[str]:
    """CI 원문 대신 저장하는 HMAC-SHA256(중복 가입 확인용). 키 = IDENTITY_CI_SALT(없으면 JWT_SECRET)."""
    if not ci:
        return None
    key = (os.getenv("IDENTITY_CI_SALT") or os.getenv("JWT_SECRET") or "").encode()
    if not os.getenv("IDENTITY_CI_SALT"):
        logger.warning("[identity] IDENTITY_CI_SALT 미설정 — JWT_SECRET 폴백")
    return hmac.new(key, ci.encode(), hashlib.sha256).hexdigest()


# ── 공급자 ──────────────────────────────────────────────────────────────────

class BaseProvider:
    name = "base"

    def render_page(self, rid: str, callback_url: str, done_url: str) -> str:
        """인증 페이지 HTML(공급자 SDK 를 띄움)."""
        raise NotImplementedError

    async def verify_callback(self, rid: str, payload: dict) -> IdentityResult:
        """콜백으로 받은 결과 토큰을 공급자 API 로 서버 대 서버 재조회해 IdentityResult 로."""
        raise NotImplementedError


class MockProvider(BaseProvider):
    """개발·점검용 — 실제 본인확인 없이 입력값을 그대로 결과로 쓴다(운영 금지)."""
    name = "mock"

    def render_page(self, rid: str, callback_url: str, done_url: str) -> str:
        return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>본인확인(테스트)</title>
<style>body{{font-family:-apple-system,sans-serif;background:#0d0820;color:#fff;padding:24px}}
input,select,button{{width:100%;padding:12px;margin:8px 0;border-radius:10px;border:0;font-size:16px}}
button{{background:#a855f7;color:#fff;font-weight:700}}.n{{color:#a78bfa;font-size:13px}}</style></head>
<body><h2>본인확인 (테스트 화면)</h2><p class="n">PG 연동 전 점검용 화면이에요. 실제 인증은 하지 않아요.</p>
<form method="post" action="{html.escape(callback_url)}">
<input name="birth_date" placeholder="생년월일 YYYY-MM-DD" required>
<select name="gender"><option value="female">여성</option><option value="male">남성</option></select>
<input type="hidden" name="done_url" value="{html.escape(done_url)}">
<button type="submit">인증 완료</button></form></body></html>"""

    async def verify_callback(self, rid: str, payload: dict) -> IdentityResult:
        try:
            bd = date.fromisoformat(str(payload.get("birth_date") or "").strip())
        except ValueError:
            raise IdentityVerifyError("생년월일 형식이 올바르지 않아요.")
        g = str(payload.get("gender") or "").strip()
        return IdentityResult(birth_date=bd, gender=g if g in ("male", "female") else None,
                              ci=f"mock-{rid}", name_len=0)


# TODO(PG 계약 후): class PgProvider(BaseProvider):
#   name = "<pg>"
#   render_page — PG 가 준 JS SDK(본인확인 창)를 띄우고, 완료 콜백에서 PG 의 인증 ID 를 callback_url 로 POST.
#                 가맹점 ID 등 공개값만 페이지에 넣는다(시크릿은 서버 전용 .env).
#   verify_callback — payload 의 인증 ID 로 PG 조회 API 를 시크릿 키로 호출 → 상태 '성공' 확인 →
#                 성명·생년월일·성별·CI 를 IdentityResult 로. (요청 리턴값: 기본값만)
#   등록: _PROVIDERS["<pg>"] = PgProvider(), .env IDENTITY_VERIFY_PROVIDER=<pg>
_PROVIDERS = {"mock": MockProvider()}


def get_provider() -> BaseProvider:
    name = provider_name()
    if not enabled():
        raise IdentityNotConfigured()
    p = _PROVIDERS.get(name)
    if p is None:
        logger.error("[identity] 알 수 없는 공급자 provider=%s", name)
        raise IdentityNotConfigured()
    return p
