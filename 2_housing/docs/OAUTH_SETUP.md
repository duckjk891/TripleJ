# 소셜 로그인(OAuth) 서버 설정 가이드 — Google / 카카오 / 네이버

> v3.44 기준. 프론트(AIDOL)는 준비 완료 — 버튼 3종 + 콜백 토큰 수신(`#token=`)까지 구현돼 있어,
> 아래 **서버 설정만 하면 코드 수정 없이 동작**한다.
> 현재 상태: 서버에 키 미설정 → 3종 모두 503("현재 사용할 수 없습니다") 응답.

## 왜 자동으로 못 했나
1. **클라이언트 키는 각 프로바이더 개발자 콘솔에서 사업자/개발자 계정으로 발급**해야 한다(대행 발급 불가).
2. 원격 백엔드 호스트(`100.127.225.55:2222`)에 현재 이 맥의 SSH 키가 등록돼 있지 않아 `.env`를 직접 수정할 수 없었다.
3. `.env` 변경은 서버 재시작이 필요하다(pydantic-settings가 기동 시 1회 로딩).

## 1) 프로바이더 콘솔 등록 (각각 발급)
공통 리다이렉트 URI — **정확히 이 값**으로 등록:
```
http://100.127.225.55:9004/api/auth/oauth/google/callback
http://100.127.225.55:9004/api/auth/oauth/kakao/callback
http://100.127.225.55:9004/api/auth/oauth/naver/callback
```

| 프로바이더 | 콘솔 | 발급 항목 | 비고 |
|---|---|---|---|
| Google | console.cloud.google.com → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션) | 클라이언트 ID + 보안 비밀 | 승인된 리디렉션 URI에 위 google callback 등록 |
| 카카오 | developers.kakao.com → 앱 생성 → 앱 키 | **REST API 키**(=client_id), (선택) 보안 → Client Secret | 카카오 로그인 활성화 + Redirect URI 등록 + 동의항목(이메일·닉네임·프로필) |
| 네이버 | developers.naver.com → 애플리케이션 등록 | Client ID + Client Secret | 서비스 URL + Callback URL 등록, 제공정보(이메일·이름·생년월일·성별) |

## 2) 서버 `.env`에 추가 (backend_9004 디렉토리)
```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
KAKAO_CLIENT_ID=YOUR_KAKAO_REST_API_KEY
KAKAO_CLIENT_SECRET=YOUR_KAKAO_CLIENT_SECRET   # 선택
NAVER_CLIENT_ID=YOUR_NAVER_CLIENT_ID
NAVER_CLIENT_SECRET=YOUR_NAVER_CLIENT_SECRET

# 프로바이더가 인가코드를 돌려보낼 우리 서버 주소
OAUTH_CALLBACK_BASE=http://100.127.225.55:9004

# 로그인 완료 후 JWT(#token=)를 전달할 프론트 주소
# ─ Expo Web 개발: 개발 PC의 주소 (예: http://localhost:8081)
# ─ 실기기 앱 배포 시: 커스텀 스킴 딥링크로 교체 필요 (예: aidol://oauth) — 그 시점에 앱쪽 딥링크 핸들러 추가 예정
FRONTEND_URL=http://localhost:8081
```

## 3) 서버 재시작
`.env`는 기동 시 로딩되므로 백엔드 프로세스 재시작 필요.

## 4) 확인
```bash
curl -s -o /dev/null -w "%{http_code}" http://100.127.225.55:9004/api/auth/oauth/kakao/login
# 302 = 활성 (503 = 키 미설정)
```
활성화되면 AIDOL 로그인 화면의 소셜 버튼 → 프로바이더 로그인 → `FRONTEND_URL/#token=JWT` 복귀 → 자동 로그인(App.tsx의 콜백 훅이 처리).

## 백엔드 동작 요약 (코드 수정 불필요 — 이미 구현돼 있음)
- `GET /api/auth/oauth/{p}/login` → state 발급(레디스, 5분) → 프로바이더 인가 페이지 302
- `GET /api/auth/oauth/{p}/callback` → code 교환 → 계정 찾기/연결/신규 생성 → JWT 발급 → `FRONTEND_URL/oauth/callback#token=` 302
- 카카오·네이버는 본인인증 트랙: `is_verified=TRUE` + 생년월일/성별 자동 저장 + ⭐30 보너스, 신규 가입 ⭐50
