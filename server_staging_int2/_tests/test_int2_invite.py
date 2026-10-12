"""int2 초대 페이지 — 테스터 문구 제거·스토어 스위치. 격리 컨테이너."""
import os, sys
FAILS=[]
def ok(n,c):
    print(("PASS " if c else "FAIL ")+n)
    if not c: FAILS.append(n)
import app.routes.referral as r
def render(**kw): return r._render_invite_html(code="ABCD", nickname="민지", store_url="x", page_url="https://maidol.ai.kr/invite/ABCD", **kw)
os.environ.pop("STORE_LINKS_LIVE", None)
h=render()
ok("출시 전: 테스터 문구 없음", "테스터" not in h and "등록된" not in h)
ok("출시 전: 곧 출시 안내·스토어 링크 없음", "곧 출시" in h and "play.google.com" not in h and "apps.apple.com" not in h)
ok("문의 메일 maidol_official", "maidol_official@lotusai.co.kr" in h and "kimpearl@" not in h)
os.environ["STORE_LINKS_LIVE"]="true"
a=render(is_android=True); i=render(is_ios=True); p=render()
ok("출시 후 안드로이드: Play 우선", a.index("play.google.com") < a.index("app.maidol.ai.kr") and "apps.apple.com" not in a)
ok("출시 후 아이폰: App Store 우선", "apps.apple.com/kr/app/id6820885751" in i and "play.google.com" not in i)
ok("출시 후 PC: 웹 우선 + 두 스토어", p.index("app.maidol.ai.kr") < p.index("play.google.com") and "apps.apple.com" in p)
ok("추천코드 웹 링크 유지", "?ref=ABCD" in a and "?ref=ABCD" in i)
print("RESULT:", "ALL PASS" if not FAILS else FAILS); sys.exit(1 if FAILS else 0)
