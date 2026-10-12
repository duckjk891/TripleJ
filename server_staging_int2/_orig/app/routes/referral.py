"""
MAIDOL Referral API (v154) - 앱 추천(리퍼럴).

- GET /api/referral/my-code       (인증)   내 추천코드 조회 — 없으면 lazy 생성(소셜 가입자 커버)
- GET /api/referral/invite/{code} (무인증)  초대 착지 페이지 데이터 — 무효/탈퇴 코드는 404
- GET /invite/{code}              (무인증)  v3.198 카톡/브라우저 사람용 HTML 랜딩 (public_router, 프리픽스 없음)
"""

import html
import logging
import re
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..auth import get_current_user
from ..config import settings
from ..database.postgres import get_pg
from ..services.referral_service import ensure_referral_code, resolve_referrer

router = APIRouter(prefix="/api/referral")

logger = logging.getLogger(__name__)


# v3.216: 특정 초대코드의 랜딩 표시명 오버라이드 — 계정 닉네임(채널 정체성)은 불변,
# 초대 문구에만 별도 표기 (LOTUS = maidol_official 계정, 지인 배포용 "LOTUS AI" 명의).
_INVITER_DISPLAY_OVERRIDES = {
    "LOTUS": "LOTUS AI",
}


def _inviter_display(row) -> str:
    return _INVITER_DISPLAY_OVERRIDES.get(
        str(row["referral_code"] or "").upper(), str(row["nickname"] or "")
    )


@router.get("/my-code")
async def my_referral_code(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """내 추천코드 조회 — 코드 없으면 즉시 발급(lazy). invite_url 은 프론트 조립용 상대경로."""
    user_tag = str(current_user["id"])[:8]
    logger.info("[referral] GET /my-code user=%s", user_tag)
    try:
        user_id = uuid.UUID(str(current_user["id"]))
        code = await ensure_referral_code(conn, user_id)
    except Exception:
        logger.exception("[referral] my-code failed user=%s", user_tag)
        return JSONResponse(status_code=500, content={"error": "추천코드 조회에 실패했습니다."})
    logger.info("[referral] my-code ok user=%s code=%s", user_tag, code)
    return {
        "referral_code": code,
        "invite_url": f"/invite/{code}",
        "play_store_url": settings.play_store_url,
    }


@router.get("/invite/{code}")
async def invite_info(code: str, conn=Depends(get_pg)):
    """초대 착지 페이지 데이터 (무인증) — 형식 무효/미존재/탈퇴·정지 유저 코드는 404."""
    code_tag = str(code)[:8] if code else ""
    logger.info("[referral] GET /invite code=%s", code_tag)
    row = await resolve_referrer(conn, code)
    if not row:
        logger.info("[referral] invite not found code=%s", code_tag)
        return JSONResponse(status_code=404, content={"error": "유효하지 않은 초대코드입니다."})
    logger.info(
        "[referral] invite ok code=%s inviter=%s", row["referral_code"], str(row["id"])[:8]
    )
    return {
        "referral_code": row["referral_code"],
        "inviter_nickname": _inviter_display(row),  # v3.216: LOTUS 표시명 오버라이드
        "play_store_url": settings.play_store_url,
    }


# =============================================================================
# v3.198 — 루트 초대 랜딩 (카톡/브라우저 사람용 HTML, PLAN v3.198 §3)
#
# 공유 링크 https://api.maidol.ai.kr/invite/{code} 가 기존엔 404 JSON 이었음 →
# OG 카드(카톡 이미지 카드) + 모바일 다크 랜딩 + CTA 제공.
# 무효 코드여도 404 "HTML" + CTA 는 항상 노출(공유 링크가 죽은 경험 방지).
#
# v3.212 — CTA 2원화(Play 내부테스트 + 웹앱 app.maidol.ai.kr?ref={code}), 서버측 UA 분기
# (Android=Play primary / iOS·기타=웹 primary), 카피·토큰 랜딩(maidol.ai.kr) 정렬,
# OG 메타 개편 + og:image invite_og_v2.png. 보상 로직·/api/referral JSON 계약 무변경.
#
# v3.216 — CTA 웹앱 primary 단일화(전 코드 공통, UA 무관). Play CTA 버튼 제거 →
# 설치 희망자 안내 블록(maidol_official DM 또는 kimpearl@lotusai.co.kr 로 구글 계정
# 전달 → 테스터 등록 후 설치 안내)으로 대체. UA 분기(is_android)·OG·앱 열기 링크 유지.
# =============================================================================

public_router = APIRouter()  # 루트 — 프리픽스 없음. main.py 에서 별도 include.

_PUBLIC_BASE_URL = "https://api.maidol.ai.kr"
# v3.212: OG 카드 신규 제작(invite_og_v2.png) — 구 invite_og.png 는 삭제하지 않고 존치
# (이미 스크랩된 구 카드의 이미지 404 방지). 파일명 변경으로 중간 캐시 회피.
_OG_IMAGE_URL = f"{_PUBLIC_BASE_URL}/static/og/invite_og_v2.png"  # 1200×630 고정 규격
_WEBAPP_URL = "https://app.maidol.ai.kr"  # v3.212 웹앱 CTA — 유효 코드면 ?ref={code} 부착
_APP_SCHEME_URL = "aidol://"  # app.json scheme — "이미 설치했다면 열기" best-effort

# 라우트 수준 형식 가드 — 영숫자 4~12자만 DB 조회(실코드는 4자 charset, resolve 가 최종 검증).
_INVITE_CODE_RE = re.compile(r"^[A-Za-z0-9]{4,12}$")


def _render_invite_html(*, code, nickname, store_url, page_url, is_android=False):
    """초대 랜딩 HTML (f-string 인라인 템플릿 — 템플릿 엔진 불요).

    code/nickname/page_url 은 이 함수 안에서 html.escape 처리한다(XSS 방지 — 호출부 누락 원천 차단,
    이중 이스케이프 금지: 호출부는 원본값 전달). code=None → 무효 코드 변형:
    코드 영역 대신 안내 문구, OG 는 일반 문구. CTA 는 양쪽 모두 노출.

    v3.216 CTA 웹앱 primary 단일화(전 코드 공통):
      - "웹에서 바로 시작하기"(app.maidol.ai.kr?ref={code}) 만 primary 로 노출 — UA 무관.
      - Play CTA 버튼 제거 → 설치 안내 블록(공식 DM/메일로 구글 계정 전달 → 테스터 등록).
      - is_android 는 UA 분기 시그니처·로깅 호환용으로 유지(현재 렌더 분기 없음).
      - store_url 은 시그니처 호환용으로 유지(v3.216 부터 미사용).
    """
    ok = code is not None
    code = html.escape(str(code)) if ok else None
    nickname = html.escape(str(nickname)) if nickname else None
    page_url = html.escape(str(page_url))
    store_url = html.escape(str(store_url))
    # code 는 위에서 escape 완료(영숫자만 통과하는 코드지만 방어적으로 escape 값 사용).
    webapp_url = f"{_WEBAPP_URL}?ref={code}" if ok else _WEBAPP_URL
    og_title = (
        f"「{nickname}」님이 MAIDOL에 초대했어요" if ok and nickname else "MAIDOL — 나의 AI 아이돌"
    )
    og_desc = (
        f"작사·작곡부터 앨범 커버까지 AI가 무료로 완성. 추천코드 {code} 입력하면 두 사람 모두 스타 50!"
        if ok
        else "작사·작곡부터 앨범 커버까지 AI가 무료로 완성."
    )
    headline = (
        f"{nickname}님이<br>MAIDOL에 초대했어요" if ok and nickname else "MAIDOL에 초대합니다"
    )

    cta_web = f'<a class="cta cta--primary" href="{webapp_url}">웹에서 바로 시작하기</a>'
    cta_block = f"""{cta_web}
    <p class="cta-note">설치 없이 브라우저에서 바로 — PC·모바일 모두 지원해요.</p>
    <div class="install-note">
      <p class="install-title">모바일 앱(Google Play) 설치를 원하시나요?</p>
      <p class="install-body">지금은 등록된 테스터만 설치할 수 있어요.<br>
      <strong>구글 계정</strong>을 앱 내 <strong>maidol_official DM</strong> 또는<br>
      <a class="install-mail" href="mailto:maidol_official@lotusai.co.kr">maidol_official@lotusai.co.kr</a>(maidol.ai.kr 하단 문의 메일)로 보내주시면<br>
      테스터 등록 후 설치 방법을 안내해 드려요.</p>
    </div>"""

    # v3.332: '베타' 표현 제거 — 가입 이벤트 추가 ⭐ 는 기간(auth.py 상수) 안에서만 표시
    event_line = ""
    try:
        from .auth import BETA_SIGNUP_BONUS_AMOUNT, _beta_signup_bonus_active
        from datetime import datetime, timezone
        if _beta_signup_bonus_active(datetime.now(timezone.utc)):
            event_line = f"<br>\n      가입 이벤트 기간엔 가입만 해도 <strong>&#11088;{BETA_SIGNUP_BONUS_AMOUNT}</strong> 추가 증정!"
    except Exception as e:  # noqa: BLE001 — 판단 불가 = 이벤트 줄 없음(과대 약속 방지)
        logger.warning("[Invite] event line check failed err=%s", type(e).__name__)

    if ok:
        code_block = f"""
      <p class="code-label">내 추천코드</p>
      <div class="code-box">
        <span id="ref-code" class="code">{code}</span>
        <button id="copy-btn" type="button" onclick="copyCode()">복사</button>
      </div>"""
    else:
        code_block = """
      <div class="code-box invalid">
        <span class="invalid-msg">유효하지 않은 초대코드예요</span>
      </div>
      <p class="invalid-sub">그래도 괜찮아요 — 지금 가입해도 가입 보상을 받을 수 있어요.</p>"""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{og_title}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="MAIDOL">
  <meta property="og:title" content="{og_title}">
  <meta property="og:description" content="{og_desc}">
  <meta property="og:image" content="{_OG_IMAGE_URL}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="{page_url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{og_title}">
  <meta name="twitter:description" content="{og_desc}">
  <meta name="twitter:image" content="{_OG_IMAGE_URL}">
  <meta name="description" content="{og_desc}">
  <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ min-height: 100%; }}
    body {{
      background: #0a0a1a; color: #f1efff;
      font-family: "Pretendard Variable", Pretendard,
                   -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
                   "Noto Sans KR", "Malgun Gothic", sans-serif;
      display: flex; flex-direction: column; align-items: center;
      padding: 40px 20px 28px;
      background-image: radial-gradient(60% 40% at 50% 0%, rgba(124, 58, 237, 0.28), transparent 70%);
      -webkit-font-smoothing: antialiased;
    }}
    .card {{ width: 100%; max-width: 420px; text-align: center; }}
    .wordmark {{
      font-size: 34px; font-weight: 800; letter-spacing: 6px;
      color: #f2f0fa;
      margin-bottom: 6px;
    }}
    .wordmark-ai {{
      background: linear-gradient(120deg, #a78bfa, #8b5cf6 55%, #6d28d9);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #8b5cf6;
    }}
    .tagline {{ font-size: 12px; color: #a9a3c8; letter-spacing: 2px; margin-bottom: 36px; }}
    h1 {{ font-size: 24px; line-height: 1.4; font-weight: 700; margin-bottom: 12px; }}
    .lede {{ font-size: 14px; line-height: 1.7; color: #a9a3c8; margin-bottom: 24px; word-break: keep-all; }}
    .code-label {{ font-size: 13px; color: #a9a3c8; margin-bottom: 8px; }}
    .code-box {{
      display: flex; align-items: center; justify-content: center; gap: 12px;
      background: rgba(139, 92, 246, 0.10); border: 1px solid rgba(139, 92, 246, 0.45);
      border-radius: 14px; padding: 16px 18px; margin-bottom: 20px;
    }}
    .code {{ font-size: 30px; font-weight: 800; letter-spacing: 8px; color: #a78bfa; }}
    #copy-btn {{
      flex-shrink: 0; border: 1px solid rgba(167, 139, 250, 0.6); background: transparent;
      color: #a78bfa; border-radius: 8px; padding: 8px 14px; font-size: 14px;
      font-weight: 600; cursor: pointer; font-family: inherit;
    }}
    #copy-btn:active {{ background: rgba(139, 92, 246, 0.25); }}
    .code-box.invalid {{ border-color: rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.05); }}
    .invalid-msg {{ font-size: 16px; color: #cfc9e6; }}
    .invalid-sub {{ font-size: 13px; color: #a9a3c8; margin-bottom: 20px; }}
    .reward {{
      font-size: 14px; line-height: 1.7; color: #e6e1f5;
      background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 14px; padding: 14px 16px; margin-bottom: 28px;
    }}
    .reward strong {{ color: #fbbf24; font-weight: 700; }}
    .cta {{
      display: block; width: 100%; text-decoration: none; text-align: center;
      font-size: 17px; font-weight: 700;
      border-radius: 14px; padding: 16px 0; margin-bottom: 14px;
    }}
    .cta--primary {{
      background: linear-gradient(120deg, #8b5cf6, #6d28d9);
      color: #ffffff;
      box-shadow: 0 6px 24px rgba(109, 40, 217, 0.45);
    }}
    .cta--secondary {{
      background: transparent; color: #a78bfa;
      border: 1px solid rgba(167, 139, 250, 0.45);
      padding: 15px 0;
    }}
    .cta:active {{ opacity: 0.85; }}
    .cta-note {{ font-size: 12px; color: #a9a3c8; margin: -6px 0 14px; }}
    .install-note {{
      text-align: left; font-size: 13px; line-height: 1.7; color: #cfc9e6;
      background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; word-break: keep-all;
    }}
    .install-title {{ font-weight: 700; color: #e6e1f5; margin-bottom: 6px; }}
    .install-body strong {{ color: #a78bfa; font-weight: 700; }}
    .install-mail {{ color: #a78bfa; text-decoration: underline; }}
    .open-app {{ display: inline-block; font-size: 13px; color: #a9a3c8; text-decoration: underline; }}
    footer {{
      margin-top: 48px; font-size: 11px; line-height: 1.7; color: #6f6890;
      text-align: center; max-width: 420px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="wordmark">M<span class="wordmark-ai">AI</span>DOL</div>
    <div class="tagline">MY AI IDOL · AI 음악 창작 놀이터</div>
    <h1>{headline}</h1>
    <p class="lede">작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요.</p>
    {code_block}
    <div class="reward">
      추천코드로 가입하면 두 사람 모두 <strong>&#11088;50</strong>{event_line}
    </div>
    {cta_block}
    <a class="open-app" href="{_APP_SCHEME_URL}">이미 설치했다면 앱 열기</a>
  </div>
  <footer>
    MAIDOL | 주식회사 로터스에이아이 | 대표 이재규<br>
    사업자등록번호 334-87-04045 | 서울시 중구 퇴계로36길 2, 10층 16호·18호<br>
    &copy; 2026 Lotus AI. All Rights Reserved.
  </footer>
  <script>
    function copyCode() {{
      var text = document.getElementById('ref-code');
      var btn = document.getElementById('copy-btn');
      if (!text) return;
      var value = text.textContent;
      function done() {{
        if (!btn) return;
        var prev = btn.textContent;
        btn.textContent = '복사됨!';
        setTimeout(function () {{ btn.textContent = prev; }}, 1600);
      }}
      if (navigator.clipboard && navigator.clipboard.writeText) {{
        navigator.clipboard.writeText(value).then(done).catch(function () {{ fallback(); }});
      }} else {{
        fallback();
      }}
      function fallback() {{
        var ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {{ document.execCommand('copy'); done(); }} catch (e) {{ /* no-op */ }}
        document.body.removeChild(ta);
      }}
    }}
  </script>
</body>
</html>"""


# v3.198: HEAD 허용 — 카카오 등 링크 스크래퍼의 HEAD 프리플라이트 405 방지
@public_router.api_route("/invite/{code}", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def invite_landing(request: Request, code: str, conn=Depends(get_pg)):
    """v3.198 초대 랜딩 HTML (무인증) — 카톡 OG 카드 + 코드 표기/복사 + 웹앱 CTA.

    v3.216: CTA 웹앱 primary 단일(Play 버튼 제거 — 설치 희망자는 DM/메일 안내 블록).
    무효 코드도 404 'HTML'(CTA 유지)로 응답. Starlette 이 GET 라우트에 HEAD 를
    자동 대응하므로 카카오 스크래퍼 HEAD 프리플라이트도 커버. 민감정보 로깅 금지.
    """
    code_tag = str(code)[:12] if code else ""
    ua = (request.headers.get("user-agent") or "-")[:120]
    # v3.216: CTA 는 UA 무관 단일이나 UA 분기 판정·로깅은 유지(트래픽 분석·회귀 대비).
    is_android = "android" in ua.lower()
    logger.info("[invite] landing enter code=%s android=%s ua=%s", code_tag, is_android, ua)

    row = None
    if code and _INVITE_CODE_RE.match(code):
        row = await resolve_referrer(conn, code)  # 형식/존재/계정상태 최종 검증(무효 → None)
    ok = row is not None

    # 이스케이프는 _render_invite_html 내부에서 일괄 수행 — 여기선 원본값 전달.
    page_url = f"{_PUBLIC_BASE_URL}/invite/{row['referral_code']}" if ok else f"{_PUBLIC_BASE_URL}/invite/"

    logger.info("[invite] landing render code=%s ok=%s", code_tag, ok)
    return HTMLResponse(
        status_code=200 if ok else 404,
        content=_render_invite_html(
            code=row["referral_code"] if ok else None,
            nickname=_inviter_display(row) if ok else None,  # v3.216: LOTUS 표시명 오버라이드
            store_url=settings.play_store_url,
            page_url=page_url,
            is_android=is_android,
        ),
    )


# v3.233 보호자 관리 API(/api/guardian/manage/…) + 운영 admin API(/api/admin/guardian/…) —
# main.py 무변경 원칙: main.py 가 이미 include 하는 루트 public_router 에 합류시킨다(모듈 import 시점 등록 →
# main.py 의 app.include_router(referral.public_router) 가 함께 복사한다). 경로는 사양 그대로.
from .guardian_manage import admin_router as _guardian_admin_router  # noqa: E402
from .guardian_manage import router as _guardian_manage_router  # noqa: E402

public_router.include_router(_guardian_manage_router)
public_router.include_router(_guardian_admin_router)

# v3.235 S7·S8 곡 공유 랜딩(GET/HEAD /track/{id} · /track/{id}/og.jpg) — 위 guardian 과 같은 방식으로 합류(main.py 무변경).
from .share_landing import router as _share_landing_router  # noqa: E402
public_router.include_router(_share_landing_router)

# v3.237 곡 공유 문구 API(GET /api/share/track/{id}) — 같은 방식으로 합류(main.py 무변경).
from .share_messages import router as _share_messages_router  # noqa: E402
public_router.include_router(_share_messages_router)

# v3.245 클럽 코어(/api/clubs/…) — 위 guardian·share 와 같은 방식으로 합류(main.py 무변경).
from .clubs import router as _clubs_router  # noqa: E402
public_router.include_router(_clubs_router)

# v3.333 [IdentityVerify] 본인확인(PG 준비본)·소셜 가입 마무리 상태(/api/identity/…) — 같은 방식으로 합류(main.py 무변경).
# 기본 꺼짐(IDENTITY_VERIFY_PROVIDER·SOCIAL_ONBOARDING_ENABLED 미설정) → 기존 동작 그대로.
from .identity import router as _identity_router  # noqa: E402
public_router.include_router(_identity_router)
