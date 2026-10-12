"""int4 보호자 본인확인 — 성인·아이 본인 아님·동의 연결·시작/상태 API. 가짜 DB, 격리 컨테이너."""
import asyncio, os, sys, uuid
from datetime import date
FAILS=[]
def ok(n,c):
    print(("PASS " if c else "FAIL ")+n)
    if not c: FAILS.append(n)
os.environ.update({"IDENTITY_VERIFY_PROVIDER":"mock","IDENTITY_CI_SALT":"salt"})
import app.routes.identity as ri
import app.services.identity_verify as iv
CHILD=uuid.uuid4(); GC=uuid.uuid4()
class Conn:
    def __init__(s): s.gc={"id":GC,"child_user_id":CHILD,"status":"pending","requested_at":None,"guardian_verified_at":None,"method":"mock"}; s.child_hash=None; s.inserted=[]; s.updates=[]
    async def execute(s, q, *a):
        if q.strip().startswith("UPDATE guardian_consents"):
            if s.gc["status"]=="pending": s.gc.update(guardian_verified_at="now", method=a[2]); s.updates.append(a); return "UPDATE 1"
            return "UPDATE 0"
        if "INSERT INTO identity_verifications" in q: s.inserted.append(a)
        return "OK"
    async def fetchrow(s, q, *a):
        if "FROM guardian_consents" in q: return s.gc if a[0]=="tok" else None
        if "FROM identity_verifications WHERE consent_id" in q: return {"status":"verified","error":None}
        return None
    async def fetchval(s, q, *a):
        if "SELECT ci_hash FROM users" in q: return s.child_hash
        return None
ri._schema_ready=False
async def main():
    c=Conn(); row={"id":"rid-guardian-1","user_id":CHILD,"consent_id":GC,"purpose":"guardian"}
    kid=iv.IdentityResult(birth_date=date(2016,3,1),gender="male",ci="DI:kid")
    o=await ri._apply_guardian_result(c,row,"danal",kid); ok("미성년 보호자 거부", o["status"]=="failed" and "만 19세" in o["error"] and not c.updates)
    c.child_hash=iv.ci_hash("DI:same")
    same=iv.IdentityResult(birth_date=date(1985,5,5),gender="female",ci="DI:same")
    o=await ri._apply_guardian_result(c,row,"danal",same); ok("아이 본인 거부(같은 DI)", o["status"]=="failed" and "자녀 본인" in o["error"] and not c.updates)
    adult=iv.IdentityResult(birth_date=date(1985,5,5),gender="female",ci="DI:parent")
    o=await ri._apply_guardian_result(c,row,"danal",adult)
    ok("성인 보호자 인증 → 동의 건 표시(해시·method)", o["status"]=="verified" and c.gc["guardian_verified_at"] and c.updates[-1][1]==iv.ci_hash("DI:parent") and c.updates[-1][2]=="danal")
    c.gc["status"]="agreed"
    o=await ri._apply_guardian_result(c,row,"danal",adult); ok("처리된 동의 건 거부", o["status"]=="failed")
    c2=Conn()
    r=await ri.guardian_identity_start(ri.GuardianStartBody(consent_token="tok"),conn=c2)
    ok("시작: request_id·page URL·return_url=보호자 페이지", isinstance(r,dict) and "/api/identity/page/" in r["url"] and c2.inserted and c2.inserted[0][3].startswith("https://maidol.ai.kr/guardian/?token=tok&identity=done") and c2.inserted[0][4]==GC)
    r=await ri.guardian_identity_start(ri.GuardianStartBody(consent_token="bad"),conn=c2); ok("시작: 잘못된 토큰 404", getattr(r,"status_code",0)==404)
    c2.gc["status"]="agreed"; r=await ri.guardian_identity_start(ri.GuardianStartBody(consent_token="tok"),conn=c2); ok("시작: 처리된 동의 404", getattr(r,"status_code",0)==404)
    c3=Conn(); c3.gc["guardian_verified_at"]="now"
    st=await ri.guardian_identity_status("tok",conn=c3); ok("상태: guardian_verified true·개인정보 없음", st["guardian_verified"] is True and "guardian_name" not in st and "guardian_phone" not in st)
    ok("보호자 페이지 복귀 주소 허용", any("https://maidol.ai.kr/guardian/?x".startswith(p) for p in ri._ALLOWED_RETURN_PREFIXES))
asyncio.run(main())
print("RESULT:","ALL PASS" if not FAILS else FAILS); sys.exit(1 if FAILS else 0)
