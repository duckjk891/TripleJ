# int3 — 다날 휴대폰 본인확인(UAS) 공급자

파일(md5 가드 MD5SUMS.orig): app/services/identity_verify.py(DanalProvider·등록), app/routes/identity.py(페이지 async 경로·/back/{rid} 취소 복귀)
.env: IDENTITY_VERIFY_PROVIDER=danal, DANAL_CPID=B010009693, DANAL_CPPWD(파일에서, 값 로그 금지), IDENTITY_CI_SALT(서버에서 난수 생성)
SOCIAL_ONBOARDING_ENABLED 는 대표 실기기 E2E 통과 후 별도로 켠다.
검증: 운영 서버→다날 ITEMSEND 실호출 RETURNCODE 0000(2026-10-12, 무과금), 격리 컨테이너 test_int3_danal 12/12, app.main import OK.
다날 서버(방화벽 사용 시): uas.teledit.com 103.11.131.152 / 150.242.135.225, wauth.teledit.com 103.11.131.171 / 150.242.134.225 (443)

> ⚠️ 2026-10-12: 운영 routes/identity.py 는 메인 세션 v3.348(어린이 age14 예외·is_minor)로 갱신됨 — 이 폴더의 _orig/app/routes/identity.py 는 옛 기준. 다음 배포 시 운영 파일을 다시 받아 맞출 것.
