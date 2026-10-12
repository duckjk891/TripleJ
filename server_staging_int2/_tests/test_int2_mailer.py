"""int2 mailer — Reply-To·문의 줄·운영 실패 시 코드 미로그. 격리 컨테이너(--network none), SES 호출은 가짜."""
import asyncio, logging, io, sys
FAILS=[]
def ok(n,c):
    print(("PASS " if c else "FAIL ")+n)
    if not c: FAILS.append(n)
import app.services.mailer as m
buf=io.StringIO(); h=logging.StreamHandler(buf); m.logger.addHandler(h); m.logger.setLevel(logging.INFO)
sent={}
class FakeSES:
    def send_email(self, **kw): sent.update(kw)
m._ses_client=FakeSES()
async def main():
    m.settings.mail_enabled=True
    r=await m.send_password_reset_email("tester@example.com","123456")
    ok("실발송 경로 sent ses", r=={"sent":True,"method":"ses"})
    ok("Reply-To = 문의 메일", sent.get("ReplyToAddresses")==["maidol_official@lotusai.co.kr"])
    body=sent["Content"]["Simple"]["Body"]["Text"]["Data"]
    ok("본문에 코드·문의 줄", "123456" in body and "문의: maidol_official@lotusai.co.kr" in body)
    await m.send_password_reset_social_notice("s@example.com")
    b2=sent["Content"]["Simple"]["Body"]["Text"]["Data"]
    ok("소셜 안내에 애플 포함·문의 줄", "구글/카카오/애플/네이버" in b2 and "문의:" in b2)
    class Boom:
        def send_email(self, **kw): raise RuntimeError("ses down")
    m._ses_client=Boom(); buf.truncate(0); buf.seek(0)
    r=await m.send_password_reset_email("tester@example.com","654321")
    ok("운영 실패 → failed", r=={"sent":False,"method":"failed"})
    ok("운영 실패 시 코드 로그 없음", "654321" not in buf.getvalue())
    m.settings.mail_enabled=False; buf.truncate(0); buf.seek(0)
    r=await m.send_password_reset_email("tester@example.com","111222")
    ok("개발 모드(꺼짐) → dev 폴백 유지", r=={"sent":True,"method":"dev"} and "111222" in buf.getvalue())
asyncio.run(main())
print("RESULT:", "ALL PASS" if not FAILS else FAILS); sys.exit(1 if FAILS else 0)
