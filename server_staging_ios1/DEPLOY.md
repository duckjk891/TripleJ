# 외부 연동 서버 배포 (FCM 앱 푸시 + 애플 로그인) — 한 번에 1회 재기동

대상(EC2 /home/ubuntu/maidol/backend_9004):
- server_staging_fcm1: app/routes/push.py, app/services/webpush.py, app/services/expo_push.py(신규)
- server_staging_ios1: app/routes/apple_auth.py(신규), app/routes/auth.py(탈퇴 시 애플 해지 훅), app/main.py(라우터 1줄)
- oauth.py 는 수정 없음(apple_auth 가 _resolve_account 재사용) — MD5SUMS.orig 에 의존성 확인용으로 포함

절차:
1. md5 가드: 운영 파일 md5 == 각 MD5SUMS.orig (불일치 시 중단·병합)
2. 백업: 대상 파일 → /home/ubuntu/maidol/backups/pre_int_<UTC>/
3. .env 추가(값 로그 금지): APPLE_TEAM_ID, APPLE_SIWA_KEY_ID, APPLE_SIWA_KEY_B64(.p8 base64)
4. 진행 작업 4종 0건 확인(gen_jobs·generations 30분·character_jobs·inst_jobs)
5. 정식 재기동(메모리 ec2-deploy-run-command: 로그 백업 → build → stop -t 60 → run -e S3_REGION -v logs) → /api/health
6. 확인: POST /api/push/expo-token 무토큰 401, 잘못된 토큰 400 / POST /api/auth/apple/native 위조 토큰 401

테스트: 운영 이미지 격리 컨테이너(--network none)에서 test_fcm1 16/16, test_ios1 23/23, app.main import + 신규 라우트 4개 등록 확인(2026-10-09).
