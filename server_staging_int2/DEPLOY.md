# int2 배포 — SES 실발송 켜기 + 문의 이메일 통일 (재기동 1회)

파일(md5 가드: MD5SUMS.orig):
- app/services/mailer.py — Reply-To(MAIL_REPLY_TO, 기본 maidol_official@lotusai.co.kr), 본문 「문의:」 줄, 소셜 안내에 애플, 운영(실발송 켜짐) 실패 시 코드 미로그
- app/auth.py — 이용 중지 안내 문의처 maidol_official@lotusai.co.kr
- app/routes/referral.py — 초대 페이지 문의 메일 문구(메인 세션 변경분 위에 재적용)

.env 추가: MAIL_ENABLED=true / MAIL_FROM=MAIDOL <no-reply@maidol.ai.kr> / SES_REGION=ap-northeast-2 / MAIL_REPLY_TO=maidol_official@lotusai.co.kr
(전제: SES maidol.ai.kr 확인됨·샌드박스 해제(2026-10-12)·IAM maidol-ses-send·애플 릴레이 SPF ✓)

절차: 백업 → 파일 반영 → .env 추가 → 진행 작업 4종 0건 → 정식 재기동(ec2-deploy-run-command) → health → 대표 메일로 비밀번호 찾기 실발송 확인(받은편지함·스팸·DKIM pass)
테스트: 운영 이미지 격리 컨테이너 test_int2_mailer 7/7 PASS + app.main import OK (2026-10-12)
