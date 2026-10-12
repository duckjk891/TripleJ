"""int3 다날 본인확인 — 인코딩·응답 해석·CONFIRM 매핑·실패 코드. 격리 컨테이너, 다날 호출은 가짜."""
import asyncio, os, sys
from urllib.parse import quote
FAILS=[]
def ok(n,c):
    print(("PASS " if c else "FAIL ")+n)
    if not c: FAILS.append(n)
os.environ.update({"DANAL_CPID":"B000000000","DANAL_CPPWD":"pw12345678","IDENTITY_VERIFY_PROVIDER":"danal"})
import app.services.identity_verify as iv
p=iv.get_provider()
ok("공급자 등록 danal", p.name=="danal")
enc=p._encode({"TXTYPE":"ITEMSEND","CPTITLE":"app.maidol.ai.kr","X":"한글 & =값"})
ok("요청 인코딩(EUC-KR 퍼센트·& 이스케이프)", b"X=%C7%D1%B1%DB%20%26%20%3D%B0%AA" in enc and b"CPTITLE=app.maidol.ai.kr" in enc)
dec=p._decode(("RETURNCODE=0000&RETURNMSG="+quote("정상","",encoding="euc-kr")+"&TID=20261012ABC").encode())
ok("응답 해석(EUC-KR)", dec=={"RETURNCODE":"0000","RETURNMSG":"정상","TID":"20261012ABC"})
calls=[]
async def fake_call(data):
    calls.append(data)
    if data["TXTYPE"]=="ITEMSEND": return {"RETURNCODE":"0000","TID":"T123"}
    if data["TID"]=="BAD": return {"RETURNCODE":"1110","RETURNMSG":"[인증실패] 입력하신 정보가 올바르지 않습니다."}
    if data["TID"]=="WEIRD": return {"RETURNCODE":"0256","RETURNMSG":"internal"}
    return {"RETURNCODE":"0000","DOB":"20160315","SEX":"2","NAME":"홍길동","CI":"ci-abc","DI":"di"}
p._call=fake_call
async def main():
    page=await p.render_page_async("rid123","https://api.maidol.ai.kr/api/identity/callback/rid123","https://api.maidol.ai.kr/api/identity/back/rid123","Mozilla/5.0 (iPhone)")
    it=calls[-1]
    ok("ITEMSEND 필수값", it["SERVICE"]=="UAS" and it["AUTHTYPE"]=="36" and it["ORDERID"]=="rid123" and it["TARGETURL"].endswith("/callback/rid123"))
    ok("모바일 Start.php·TID·BackURL·ByPass", "Mobile/Start.php" in page and 'value="T123"' in page and "/back/rid123" in page and 'name="ByPassValue" value="rid123"' in page)
    ok("비밀번호가 페이지에 없음", "pw12345678" not in page)
    r=await p.verify_callback("rid123",{"TID":"T999"})
    cf=calls[-1]
    ok("CONFIRM: CONFIRMOPTION=1·CPID·ORDERID 대조", cf["TXTYPE"]=="CONFIRM" and cf["CONFIRMOPTION"]=="1" and cf["ORDERID"]=="rid123" and cf["IDENOPTION"]=="1")
    ok("결과 매핑(DOB·여성·CI·이름길이)", str(r.birth_date)=="2016-03-15" and r.gender=="female" and r.ci=="ci-abc" and r.name_len==3)
    for tid,expect in (("BAD","[인증실패]"),("WEIRD","본인확인에 실패")):
        try: await p.verify_callback("rid123",{"TID":tid}); ok(f"실패코드 {tid} 예외",False)
        except iv.IdentityVerifyError as e: ok(f"실패코드 {tid} 안내문", expect in str(e))
    try: await p.verify_callback("rid123",{}); ok("TID 없음 거부",False)
    except iv.IdentityVerifyError: ok("TID 없음 거부",True)
    os.environ.pop("DANAL_CPPWD")
    try: p._cfg(); ok("키 없으면 미설정",False)
    except iv.IdentityNotConfigured: ok("키 없으면 미설정",True)
asyncio.run(main())
print("RESULT:","ALL PASS" if not FAILS else FAILS); sys.exit(1 if FAILS else 0)
