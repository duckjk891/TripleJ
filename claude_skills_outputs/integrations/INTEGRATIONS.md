# MAIDOL 외부 연동 체크리스트

> 관리 세션: 외부 연동 전담(2026-10-08 개설). 대표님이 외부 콘솔 작업을 마치면 이 세션이 앱·서버 연결과 검증을 끝내고 이 문서를 갱신합니다.
> **비밀값 금지**: 키·광고 단위 ID 원문·서비스 계정 JSON 내용·.p8 키는 이 문서·채팅·커밋에 남기지 않습니다. 파일은 "위치만" 알려주세요.
> 표기: ✅ 완료 · 🟡 진행 중/일부 · ⏳ 대표님 작업 대기 · ⛔ 외부 승인 대기 · ❓ 확인 필요

| 연동 | 상태 | 지금 막힌 곳 |
|---|---|---|
| 1. AdMob (Android 보상형) | 🟡 회사 계정으로 이전 중 | 현 계정=개인 Gmail·개인 결제 프로필 → 법인 계정 신규 개설 대기 |
| 2. Firebase / FCM (Android 앱 푸시) | ⏳ 대표님 작업 대기 | Firebase 프로젝트·google-services.json 없음 |
| 3. iOS 출시 | ⛔ 애플 승인 대기 | Apple Developer 법인 등록(K52Q5KXB89, 접수 2026-09-17) |
| 4. AWS SES (비밀번호 재설정 메일) | ⏳ 대표님 작업 대기 | 도메인 인증·샌드박스 해제·EC2 역할 권한 |

## 계정 원칙 (2026-10-08 대표 결정)

| 서비스 | 소유 계정 | 공동 관리자 |
|---|---|---|
| Google Play · Firebase · AdMob(신규) | lotusai.official@gmail.com | maidol_official@lotusai.co.kr |
| 스토어 문의 담당 이메일 | maidol_official@lotusai.co.kr (Workspace 사용자, 신규) | — |
| AdMob(기존, 폐기 예정) | 대표 개인 Gmail · **개인** 결제 프로필 | — |

---

## 확인 근거 (2026-10-08, 이 세션이 직접 확인)

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 앱 버전 | `1.3.1` (appVersionSource: remote) | `2_housing/app.json`, `2_housing/eas.json` |
| 패키지/번들 ID | Android `com.maidol.app`, iOS `com.maidol.app` | `app.json` |
| AdMob 앱 ID | Android·iOS 둘 다 플러그인에 설정됨 | `app.json` → `react-native-google-mobile-ads` |
| AdMob 보상형 광고 단위(Android) | preview·production 빌드 env에 실단위 주입 | `eas.json` → `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID` |
| AdMob 보상형 광고 단위(iOS) | **없음** — 상수·훅이 Android 단위만 사용 | `constants/ads.ts`, `hooks/useRewardedSkipAd.ts` |
| AdMob 테스트 기기 | **미설정** (`EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS` 없음) | `eas.json` |
| 광고 시청→적립 | SSV(user_id=custom_data) → 서버 적립 → 앱이 `POST /fatigue/skip {method:'ad'}` | `hooks/useRewardedSkipAd.ts`, `utils/fatigueGate.ts` |
| Firebase 설정 파일 | `google-services.json`·`GoogleService-Info.plist` **없음** | `2_housing/` |
| 네이티브 푸시 코드 | **없음** (`expo-notifications` 미설치) | `package.json`, 전체 검색 |
| 웹 푸시 | 운영 동작 중 — `GET /api/push/vapid-public-key` 200 (키 설정됨) | 운영 API 호출, `services/pushService.ts` |
| 비밀번호 재설정(앱) | `POST /auth/password-reset/request`·`/confirm` 호출 구현됨 | `services/authService.ts` |
| 소셜 로그인 | 구글·카카오 2종(서버 리다이렉트 방식), **애플 없음** | `components/auth/SocialLoginButtons.tsx` |
| iOS 네트워크 | `NSAllowsArbitraryLoads: true` (전면 허용) | `app.json` ios.infoPlist |
| iOS 권한 문구 | 마이크(`expo-av` 녹음·`expo-audio`)·카메라(`expo-image-picker`) 한국어 문구 **app.json에 없음** | `app.json`, `VoiceCloneWizardScreen.tsx`, `FaceVerifyScreen.tsx` |
| Android 권한 | `POST_NOTIFICATIONS`만 명시, cleartext 허용 | `app.json`, `expo-build-properties` |

**이 세션에서 재확인하지 못한 것(메인 세션 확인값 사용)** — 운영 서버 SSH·백엔드 소스 열람 권한이 이 세션에 없어서 아래는 메인 세션 보고 기준입니다.
- 서버 메일러 `app/services/mailer.py`(MAIL_ENABLED 플래그) 존재, 현재 꺼져 있음
- 서버 웹푸시 `services/webpush.py`·`routes/push.py`, 인앱 알림 훅에서 follow·comment·reply·like·star 발송
- AdMob SSV 콜백 서버 라우트(`rewards.py`) 존재, 최근 광고 스킵 사용 0건
- EC2 인스턴스 역할 이름 `maidol-ec2`

---

## 1. AdMob (Android 보상형 광고) — ✅ 연결됨 · ❓ 확인 2건

**2026-10-08 결정 — 회사 계정으로 이전**: 기존 AdMob은 대표 개인 Gmail로 가입(2026-04-10 승인)했고 결제 프로필이 **개인**이라 광고 수익이 개인 명의로 지급됨. AdMob 계정은 양도할 수 없어 lotusai.official@gmail.com 으로 **비즈니스(로터스에이아이) 결제 프로필의 새 AdMob 계정**을 만들고, v1.3.2 빌드에서 앱 ID 2개·보상형 단위를 교체한다. 기존 계정은 v1.3.1 사용자가 v1.3.2로 넘어간 뒤 광고 단위를 중지하고, 잔액 확인 후 해지.

**현재**: 앱·빌드 설정은 끝남(위 근거 표). 웹은 AdMob 미지원이라 ⭐로만 휴식 단축. 설치된 APK v1.3.1에도 들어가 있음.

**대표님이 할 일**
1. **SSV 콜백 확인** (적립이 되려면 필수): AdMob 콘솔 → 앱 → 광고 단위 → 「광고 보고 휴식 줄이기」 보상형 단위 → 고급 설정 → **서버 측 확인(SSV)** 이 켜져 있고 콜백 URL이 우리 서버(`https://api.maidol.ai.kr/...`)로 되어 있는지 스크린샷 1장.
2. **테스트 기기 등록** (내부 테스트 중 본인 클릭이 무효 트래픽으로 잡혀 계정 정지되는 것 방지): AdMob 콘솔 → 설정 → 테스트 기기 → 기기 추가 → 대표님 폰의 광고 ID(안드로이드 설정 → Google → 광고 → 광고 ID) 입력. 사내 테스트 폰 전부.
3. (스토어 등록 시점) `maidol.ai.kr/app-ads.txt` 게시용 한 줄을 AdMob 콘솔 → 앱 → app-ads.txt 에서 복사해 전달 — 파일 게시는 Claude가 함.
4. (지급 받으려면) AdMob → 결제 → 결제 정보·세금 정보 입력.

**대표님이 넘겨줄 것**: ① SSV 설정 화면 스크린샷 ② "테스트 기기 등록 완료" 한 마디 ③ (나중) app-ads.txt 한 줄

**그 뒤 Claude가 할 일**
- SSV가 꺼져 있으면: 콜백 URL·검증 방식 안내 → 서버 로그로 실제 콜백 수신 확인
- 새 APK에서 실광고 1회 시청 → 서버 적립 로그·휴식 30분 단축 확인
- app-ads.txt 웹 루트 게시 및 AdMob 크롤링 확인

**완료 기준**: 실기기(테스트 기기 등록됨)에서 광고 시청 → SSV 콜백 서버 수신 → 휴식 30분 단축이 1회 이상 확인됨.

---

## 2. Firebase / FCM (Android 앱 푸시) — ⏳ 대표님 작업 대기

**현재**: 웹 푸시는 운영 중. Android 앱 푸시는 Firebase 프로젝트·설정 파일·`expo-notifications` 모두 없음. 설치된 APK는 v1.3.1(2026-09-29) — 이후 앱 수정분 전부 미반영.

**추천 방식: Expo 푸시 서비스 경유**
서버는 Expo 푸시 토큰으로 `exp.host` 에 보내고, FCM 서비스 계정 키는 **Expo(EAS)에만** 올립니다. 서버에 Google 비밀키를 둘 필요가 없고, iOS 출시 때 같은 코드로 APNs까지 처리됩니다.

**대표님이 할 일**
1. https://console.firebase.google.com → 프로젝트 추가 → 이름 예: `maidol` (Google 애널리틱스는 꺼도 됨).
2. 프로젝트 개요 → Android 아이콘(앱 추가) → 패키지 이름 **`com.maidol.app`** 정확히 입력 → 앱 등록 → **`google-services.json` 다운로드**. (SDK 추가 단계는 "다음"만 눌러 건너뛰기)
3. 다운로드한 `google-services.json` 을 **`/Users/pearl/TripleJ/2_housing/google-services.json`** 에 놓기. (git엔 안 올리도록 Claude가 설정함)
4. Firebase → ⚙️ 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** → JSON 파일 다운로드. 이 파일은 채팅에 붙여넣지 말고:
   - https://expo.dev 로그인 → 프로젝트 `triplej-studio` → Credentials → Android → `com.maidol.app` → **FCM V1 service account key → Add / Upload** 에서 그 JSON 업로드.
   - 업로드 후 다운로드한 JSON 파일은 지워도 됨(Firebase에서 재발급 가능).

**대표님이 넘겨줄 것**: "google-services.json 놓았음" + "expo.dev에 FCM V1 키 올렸음" 두 마디. (파일 내용·키 값은 필요 없음)

**그 뒤 Claude가 할 일**
1. 앱: `expo-notifications` 설치, `app.json` 에 `android.googleServicesFile` 및 알림 아이콘·채널 설정, `.gitignore` 에 `google-services.json` 추가(EAS 빌드엔 포함되도록 `.easignore` 확인).
2. 앱: 로그인 후 알림 권한 요청(앱 내 다이얼로그 규칙 준수) → Expo 푸시 토큰 발급 → 서버 등록, 로그아웃 시 해제, 알림 탭 시 해당 화면으로 이동.
3. 서버: 기기 토큰 저장 API(`/api/push/` 하위 확장) + 기존 웹푸시 발송 훅에서 Expo 푸시도 함께 발송, 무효 토큰(`DeviceNotRegistered`) 자동 정리. → 스테이징 → **대표 승인 후** 배포(재기동 전 진행 작업 4종 0건 확인).
4. **새 APK v1.3.2 빌드**(앱 버전 1.3.2, `expo-image-picker` 카메라 전용 얼굴 인증 포함, 9-29 이후 수정분 전부 반영).
5. 대표님 폰에 설치 → 팔로우·댓글 등으로 실제 알림 수신 확인.

**완료 기준**: v1.3.2 APK에서 ① 알림 권한 허용 → 서버에 토큰 등록 ② 다른 계정의 팔로우/댓글 시 앱이 꺼져 있어도 알림 도착 ③ 알림 탭 → 해당 화면 이동 ④ 웹 푸시 회귀 없음.

---

## 3. iOS 출시 — ⛔ 애플 승인 대기

**현재**: Apple Developer 법인 등록 접수(K52Q5KXB89, 2026-09-17) 후 승인 대기. 번들 ID `com.maidol.app`, AdMob iOS 앱 ID는 이미 설정됨. iOS 빌드는 아직 한 번도 안 함.

**대표님이 할 일 (승인 연락 후 순서대로)**
1. 승인 메일 → **$99 결제**로 가입 완료. (승인 전화/메일 오면 바로 응대)
2. App Store Connect → 사용자 및 액세스 → 통합 → **App Store Connect API 키** 생성(역할: 앱 관리자) → `.p8` 파일 다운로드(1회만 가능). 파일을 `/Users/pearl/TripleJ/2_housing/credentials/` 에 놓고 **Key ID·Issuer ID** 만 알려주기. (이걸로 Claude가 인증서·프로비저닝·APNs 키를 EAS로 자동 생성)
3. Certificates, IDs & Profiles → Keys → **Sign in with Apple 용 키** 생성(.p8) + Identifiers → **Services ID** 생성(웹 로그인 리다이렉트용, 도메인 `api.maidol.ai.kr`). 같은 폴더에 .p8 놓고 Key ID·Services ID 이름·Team ID 알려주기.
4. AdMob 콘솔 → iOS 앱(이미 있음) → **보상형 광고 단위 생성**(이름: 「광고 보고 휴식 줄이기 iOS」) → 단위 생성 시 SSV 콜백 URL을 Android와 동일하게 설정.
5. App Store Connect → 앱 → 새로운 앱(번들 `com.maidol.app`, 이름 MAIDOL) 생성, 개인정보 처리방침 URL·지원 URL 입력.

**대표님이 넘겨줄 것**: ① 승인 완료 알림 ② API 키 Key ID·Issuer ID + .p8 파일 위치 ③ 애플 로그인 Key ID·Services ID·Team ID + .p8 위치 ④ iOS 보상형 광고 단위 ID(앱에 들어가는 공개값이라 채팅으로 줘도 됨 — 빌드 환경변수에만 넣고 이 문서엔 안 적음)

**그 뒤 Claude가 할 일**
- **애플 로그인**(앱 심사 필수 — 구글·카카오 제공 시 애플 로그인 의무): 서버 OAuth 리다이렉트 방식에 Apple 추가 + 버튼 추가
- **AdMob iOS**: `EXPO_PUBLIC_ADMOB_REWARDED_IOS` 추가·플랫폼 분기, **ATT(앱 추적 투명성) 동의 팝업**·SKAdNetwork ID 목록 추가(없으면 심사 반려·광고 수익 저하)
- **ATS 축소**: `NSAllowsArbitraryLoads` 제거 → 필요한 http 도메인만 예외(없으면 전면 https)
- **권한 문구 한국어화**: 마이크(목소리 학습 녹음), 카메라(얼굴 인증), 사진 저장, 알림
- 푸시: APNs 키를 EAS에 등록 → 2번 FCM 작업의 코드가 iOS에서도 동작하는지 확인
- `eas build -p ios` → TestFlight 업로드 → 대표님 아이폰에서 테스트 → 스토어 제출 자료(스크린샷·심사 메모·데모 계정) 준비

**출시 차단 요소(이 세션 범위 밖, 메모용)**: ⭐ 충전은 iOS에서 **인앱결제(IAP)** 필수 · 본인인증(PASS/NICE) 계약 · 구글 Play Console 조직 계정.

**완료 기준**: TestFlight 빌드에서 애플 로그인·보상형 광고·푸시·녹음·얼굴 인증이 동작하고, App Store 심사 제출 완료.

---

## 4. AWS SES (비밀번호 재설정 메일) — ⏳ 대표님 작업 대기

**현재**: 앱 화면과 서버 API(`/auth/password-reset/request`·`/confirm`, 6자리 코드·15분 만료·5회 제한)는 준비됨. 서버 메일 발송은 꺼짐(MAIL_ENABLED). 그래서 지금은 비밀번호 찾기 메일이 실제로 가지 않음.

**대표님이 할 일** (AWS 콘솔, 리전 **서울 ap-northeast-2** — 서버와 같은 리전)
1. **도메인 인증**: SES → 구성 → 자격 증명(Identities) → 자격 증명 생성 → 도메인 `maidol.ai.kr` → Easy DKIM(RSA 2048) 켬 → 표시되는 **CNAME 3개**를 maidol.ai.kr 의 DNS 관리 화면에 추가 → 상태가 "확인됨"이 될 때까지 대기(보통 수십 분).
   - DNS를 어디서 관리하는지 모르면 알려주세요. Claude가 넣을 레코드를 정리해 드립니다.
2. **보내는 주소 정하기**: 예) `no-reply@maidol.ai.kr` — 받는 메일함이 따로 필요 없음(도메인 인증으로 충분).
3. **샌드박스 해제 요청**: SES → 계정 대시보드 → **프로덕션 액세스 요청** → 메일 유형: 트랜잭션, 웹사이트 `https://app.maidol.ai.kr`, 사용 설명: "회원 비밀번호 재설정 인증 코드 메일만 발송, 일 100건 미만, 반송/수신거부 자동 처리". (승인 보통 1일 내외. 승인 전엔 인증된 주소로만 발송 가능)
4. **EC2 역할 권한**: IAM → 역할 → `maidol-ec2` → 권한 추가 → 인라인 정책 → 서비스 SES → 작업 `SendEmail`, `SendRawEmail` → 리소스: 1번 도메인 자격 증명 ARN → 이름 `maidol-ses-send`.
   - 원하시면 Claude가 붙여넣을 JSON 정책 문구를 만들어 드립니다.

**대표님이 넘겨줄 것**: ① "도메인 확인됨" ② 보내는 주소 ③ 샌드박스 해제 승인 여부 ④ "역할 권한 추가함"

**그 뒤 Claude가 할 일**
1. 서버 메일러 설정 재확인(보내는 주소·리전·MAIL_ENABLED) → `.env` 변경안 작성 → **대표 승인 후** 반영·재기동(정식 명령, 진행 작업 4종 0건 확인).
2. 대표님 메일 주소로 재설정 코드 실발송 → 수신·스팸함 여부·DKIM 통과(메일 원문 헤더) 확인 → 코드로 비밀번호 변경까지 E2E.
3. 소셜 전용 계정 안내 메일, 존재하지 않는 이메일(균일 응답) 회귀 확인.
4. (권장) 반송·수신거부 알림(SNS) 연결 — 반송률이 높으면 SES가 발송을 정지시키므로.

**완료 기준**: 운영에서 비밀번호 찾기 → 대표님 Gmail 받은편지함(스팸 아님)에 코드 메일 1분 내 도착 → 코드로 비밀번호 변경 성공.

---

## 변경 이력
- 2026-10-08: 계정 원칙 추가, AdMob 회사 계정 이전 결정(기존=개인 결제 프로필).
- 2026-10-08: 문서 생성. 앱 쪽 설정 직접 확인, 서버 쪽은 메인 세션 확인값 사용(운영 서버 열람 권한 없음).
