# int4 — 보호자(법정대리인) 다날 본인확인 (대표 승인 「보호자 동의 연결 만들어」 2026-10-12)

API(로그인 없음, consent_token 이 자격):
- POST /api/identity/guardian/start {consent_token} → {request_id, url}  (guardian_consents.status='pending' 만)
  url = 다날 인증 페이지. 완료 시 303 → https://maidol.ai.kr/guardian/?token=…&identity=done&rid=…&status=verified|failed|cancelled
- GET /api/identity/guardian/status/{consent_token} → {consent_status, guardian_verified, method, last_attempt{status,error}}
검증: 보호자 만 19세 이상 · 아이 DI 와 다른 사람 · 동의 건 pending → guardian_consents.guardian_verified_at=now(), guardian_di_hash(해시), method='danal'
스키마(멱등 ALTER): identity_verifications.consent_id UUID, guardian_consents.guardian_verified_at TIMESTAMPTZ, guardian_di_hash TEXT
메인 세션 몫: 동의(agree) 엔드포인트가 guardian_verified_at IS NOT NULL 을 요구하도록, 보호자 페이지 UI(인증 → 동의), 로그인한 14세 미만 소셜 계정용 동의 요청 생성.
테스트: 격리 컨테이너 test_int4_guardian 9/9 + app.main import OK. 기준 파일 = 운영(2026-10-12 int3 배포본) md5 MD5SUMS.orig.
