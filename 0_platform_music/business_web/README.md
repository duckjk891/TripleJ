# MAIDOL 광고주 사이트 (business.maidol.ai.kr)

브랜드·광고주용 소개 페이지 + 광고주 전용 화면(대시보드·내 상품·상품별 성과·회사 정보·비밀번호).
Vite + React SPA(HashRouter). 서버 API 는 `/api/business/*`(routes/business.py), 계정 발급은 관리자 웹.

- 로컬 확인(운영 로그인 없이): `node dev/mock_server.mjs` 후 `BIZ_API_TARGET=http://127.0.0.1:5196 npm run dev` (http://localhost:5197)
  - 모의 로그인: 비밀번호 `temp1234` = 임시 비밀번호 흐름, 이메일에 `user` 포함 = 일반 사용자 거절, `wrong` = 비밀번호 틀림
- 배포: `./deploy_business.sh` (EC2 /var/www/maidol-business 교체, 서버 재시작 없음) · 되돌리기 `./deploy_business.sh rollback`
- nginx: 이 주소에서는 `/api/business/*`, `/api/auth/login`, `/api/auth/password-reset/*` 만 서버로 넘긴다.
- 규칙: 노출 문자열은 MAIDOL(AIDOL 금지), 시스템 alert/confirm 금지(components/dialog.jsx), 오류 원문 비노출(api.js friendlyError), 금액·과금 비노출.
