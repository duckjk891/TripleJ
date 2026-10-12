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


class DanalProvider(BaseProvider):
    """다날 휴대폰 본인확인(UAS) — 다날 「본인인증 서비스 연동 가이드」 v1.1.6 기준(2026-10-12 외부 연동 세션).

    ① ITEMSEND(서버→uas.teledit.com): CPID·CPPWD·TARGETURL(=우리 callback)·ORDERID(=rid) → TID
    ② 사용자 브라우저를 wauth.teledit.com Start.php 로 자동 POST(TID·BackURL·ByPassValue=rid)
    ③ 다날 → TARGETURL POST(TID…) → ④ CONFIRM(서버→uas, CONFIRMOPTION=1·CPID·ORDERID 대조, IDENOPTION=1)
       → DOB(YYYYMMDD)·SEX·NAME·CI·DI. 브라우저가 넘긴 값은 TID 외엔 신뢰하지 않는다(다날 보안 권고).
    설정(.env): DANAL_CPID, DANAL_CPPWD — 값 로그 금지.
    """
    name = "danal"
    UAS_URL = "https://uas.teledit.com/uas/"
    START_WEB = "https://wauth.teledit.com/Danal/WebAuth/Web/Start.php"
    START_MOBILE = "https://wauth.teledit.com/Danal/WebAuth/Mobile/Start.php"
    CPTITLE = "app.maidol.ai.kr"

    @staticmethod
    def _cfg():
        cpid = (os.getenv("DANAL_CPID") or "").strip()
        pwd = (os.getenv("DANAL_CPPWD") or "").strip()
        if not cpid or not pwd:
            raise IdentityNotConfigured()
        return cpid, pwd

    @staticmethod
    def _encode(data: dict) -> bytes:
        from urllib.parse import quote
        return "&".join(f"{k}={quote(str(v), safe='', encoding='euc-kr', errors='replace')}" for k, v in data.items()).encode("ascii")

    @staticmethod
    def _decode(raw: bytes) -> dict:
        from urllib.parse import unquote_to_bytes
        out = {}
        for part in raw.decode("ascii", errors="replace").strip().split("&"):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            b = unquote_to_bytes(v.replace("+", " "))
            try:
                out[k.strip()] = b.decode("euc-kr")
            except UnicodeDecodeError:
                out[k.strip()] = b.decode("utf-8", errors="replace")
        return out

    async def _call(self, data: dict) -> dict:
        import httpx
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(self.UAS_URL, content=self._encode(data),
                             headers={"Content-Type": "application/x-www-form-urlencoded; charset=EUC-KR"})
        res = self._decode(r.content)
        logger.info("[identity.danal] %s http=%d code=%s", data.get("TXTYPE"), r.status_code, res.get("RETURNCODE"))
        return res

    async def itemsend(self, rid: str, callback_url: str) -> str:
        cpid, pwd = self._cfg()
        res = await self._call({"TXTYPE": "ITEMSEND", "SERVICE": "UAS", "AUTHTYPE": "36", "CPID": cpid, "CPPWD": pwd,
                                "TARGETURL": callback_url, "CPTITLE": self.CPTITLE, "ORDERID": rid})
        if res.get("RETURNCODE") != "0000" or not res.get("TID"):
            logger.warning("[identity.danal] itemsend fail rid=%s code=%s msg=%s", rid[:8], res.get("RETURNCODE"), (res.get("RETURNMSG") or "")[:80])
            raise IdentityVerifyError("본인확인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.")
        return res["TID"]

    async def render_page_async(self, rid: str, callback_url: str, back_url: str, user_agent: str = "") -> str:
        tid = await self.itemsend(rid, callback_url)
        mobile = any(t in (user_agent or "").lower() for t in ("iphone", "ipad", "android", "mobile"))
        action = self.START_MOBILE if mobile else self.START_WEB
        e = html.escape
        return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>본인확인</title><style>body{{font-family:-apple-system,sans-serif;background:#0d0820;color:#fff;padding:32px;text-align:center}}</style></head>
<body><p>휴대폰 본인확인 화면으로 이동하고 있어요…</p>
<form id="f" method="post" action="{action}" accept-charset="UTF-8">
<input type="hidden" name="TID" value="{e(tid)}"><input type="hidden" name="BackURL" value="{e(back_url)}">
<input type="hidden" name="IsCharSet" value="UTF-8"><input type="hidden" name="BgColor" value="03">
<input type="hidden" name="ByPassValue" value="{e(rid)}"></form>
<script>document.getElementById('f').submit();</script></body></html>"""

    def render_page(self, rid: str, callback_url: str, done_url: str) -> str:
        raise NotImplementedError("DanalProvider 는 render_page_async 사용")

    async def verify_callback(self, rid: str, payload: dict) -> IdentityResult:
        cpid, _ = self._cfg()
        tid = str(payload.get("TID") or "").strip()
        if not tid:
            raise IdentityVerifyError("본인확인 결과를 받지 못했어요. 다시 시도해 주세요.")
        res = await self._call({"TXTYPE": "CONFIRM", "TID": tid, "CONFIRMOPTION": "1", "IDENOPTION": "1",
                                "CPID": cpid, "ORDERID": rid})
        if res.get("RETURNCODE") != "0000":
            logger.warning("[identity.danal] confirm fail rid=%s code=%s", rid[:8], res.get("RETURNCODE"))
            msg = (res.get("RETURNMSG") or "").strip()
            raise IdentityVerifyError(msg[:120] if msg.startswith("[인증실패]") else "본인확인에 실패했어요. 다시 시도해 주세요.")
        dob = (res.get("DOB") or "").strip()
        try:
            bd = date(int(dob[0:4]), int(dob[4:6]), int(dob[6:8]))
        except (ValueError, IndexError):
            logger.error("[identity.danal] bad DOB rid=%s len=%d", rid[:8], len(dob))
            raise IdentityVerifyError("본인확인 결과를 확인하지 못했어요. 다시 시도해 주세요.")
        sex = (res.get("SEX") or "").strip()
        gender = ("male" if sex in ("1", "3", "5", "7", "9") else "female" if sex in ("2", "4", "6", "8", "0") else None) if sex else None
        return IdentityResult(birth_date=bd, gender=gender, ci=(res.get("CI") or "").strip() or None,
                              name_len=len((res.get("NAME") or "").strip()))


# TODO(PG 계약 후): class PgProvider(BaseProvider):
#   name = "<pg>"
#   render_page — PG 가 준 JS SDK(본인확인 창)를 띄우고, 완료 콜백에서 PG 의 인증 ID 를 callback_url 로 POST.
#                 가맹점 ID 등 공개값만 페이지에 넣는다(시크릿은 서버 전용 .env).
#   verify_callback — payload 의 인증 ID 로 PG 조회 API 를 시크릿 키로 호출 → 상태 '성공' 확인 →
#                 성명·생년월일·성별·CI 를 IdentityResult 로. (요청 리턴값: 기본값만)
#   등록: _PROVIDERS["<pg>"] = PgProvider(), .env IDENTITY_VERIFY_PROVIDER=<pg>
_PROVIDERS = {"mock": MockProvider(), "danal": DanalProvider()}


def get_provider() -> BaseProvider:
    name = provider_name()
    if not enabled():
        raise IdentityNotConfigured()
    p = _PROVIDERS.get(name)
    if p is None:
        logger.error("[identity] 알 수 없는 공급자 provider=%s", name)
        raise IdentityNotConfigured()
    return p
