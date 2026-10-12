# MAIDOL iOS App Store 등록 자료 (초안)

> 작성 2026-10-09 · 대상 빌드 v1.3.x(iOS 첫 제출) · App Store Connect 기본 언어 한국어
> 이 문서는 **대표님 검토용 초안**입니다. 코드블록 안 문구는 App Store Connect에 그대로 붙여넣을 수 있게 썼고, 글자 수는 공백·문장부호 포함 실측값입니다.
> 표기: ✅ 확인됨 · ⚠️ 제출 전 조치 필요 · ❓ 확인 필요 · 🖊 대표님 결정

---

## 0. 제출 전에 먼저 막아야 할 것 (요약)

| # | 항목 | 상태 | 왜 문제인가 |
|---|---|---|---|
| 1 | **애플 로그인** | ✅ 2026-10-11 앱 버튼·서버 운영 반영 | 구글·카카오 로그인을 제공하므로 애플 로그인 필수(가이드라인 4.8). 엔타이틀먼트만 있고 버튼·서버 검증 없음 |
| 2 | **ATT(앱 추적 투명성)** | ✅ 광고 초기화 전 1회 요청·문구 한국어 | 성인 회원의 보상형 광고는 맞춤 광고로 요청됨 → iOS에서 IDFA 사용 시 ATT 동의 팝업·`NSUserTrackingUsageDescription` 필수. `expo-tracking-transparency` 미설치 |
| 3 | **iOS 보상형 광고 단위** | ✅ 새 회사 AdMob 계정 단위 연결 | iOS에서는 Google 테스트 광고로 폴백 → 실서비스에 테스트 광고 노출 |
| 4 | **권한 문구 한국어** | ✅ 마이크·카메라·사진·추적 | 마이크(목소리 녹음·참고 음악 녹음)·카메라(얼굴 인증)·사진 선택 문구가 app.json에 없음 → 영문 기본값 또는 누락으로 반려 위험 |
| 5 | **ATS** | ✅ 전면 허용 제거, kakaocdn.net 만 http 예외 | ATS 전면 해제 — 심사에서 사유 소명 요구 가능. API·웹 모두 HTTPS라 제거 권장 |
| 6 | **개인정보 처리방침과 앱 동작 불일치** | ⚠️ | 처리방침 제2조에 "푸시 알림 토큰을 수집하지 않으며"라고 되어 있으나 앱은 이제 기기 푸시 토큰을 서버에 등록(expo-notifications). 애플 로그인 추가 시 "소셜 계정(네이버·카카오·구글)" 문구도 갱신 필요 |
| 7 | **iPad 지원 여부** | ✅ `supportsTablet: false` 로 결정(2026-10-09) | `supportsTablet: true` → iPad 스크린샷 필수 + iPad에서 심사. 9번 항목 참고 |

---

## 1. 앱 이름 · 부제 — 구글 플레이 등록정보 기준(2026-10-11 대표 제공)

> 기준: Play 간단한 설명 「나의 AI 아이돌, MAIDOL! 나의 이야기를 AI 디렉터와 함께 쉽게 노래로 만들어요」 + Play 자세한 설명(아래 2-2 원문). iOS 문구는 Play와 같은 방향으로 맞추고, 심사 위험 표현만 손봤다.

| 칸 | 값 | 글자 수 |
|---|---|---|
| 이름(30) | `MAIDOL - 나의 마음을 부르는 MY AI IDOL` (App Store Connect 생성값 유지) | 30 |
| **부제(30)** 추천 A | `나의 이야기를 AI 디렉터와 노래로` | 19 |
| 부제 B | `AI 디렉터와 쉽게 만드는 나의 노래` | 20 |
| 부제 C | `나의 이야기가 노래가 되는 AI 기획사` | 21 |

---

## 2. 프로모션 텍스트 · 설명 · 키워드

### 2-1. 프로모션 텍스트 (최대 170자) — Play 간단한 설명 그대로 (49자)

```
나의 AI 아이돌, MAIDOL! 나의 이야기를 AI 디렉터와 함께 쉽게 노래로 만들어요
```

### 2-2. 설명 — Play 자세한 설명 그대로, 1곳만 수정 (917자)

```
나의 AI 아이돌, MAIDOL(MY AI IDOL)
학교생활, 직장생활, 반려동물 이야기까지.
나의 이야기를 AI 디렉터와 함께 쉽게 노래로 만들어요.
작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요.

■ 나의 AI 아이돌을 데뷔시켜 보세요
아티스트의 이름과 컨셉을 정하면 프로필 이미지와 앨범 커버까지 AI가 만들어 줘요. 브랜드 의상으로 코디를 바꿔 입히며 나만의 아이돌로 키워 보세요.

■ AI 디렉터와 함께 쉽게 완성해요
작곡을 배운 적이 없어도 괜찮아요. 작사 디렉터, 작곡 디렉터와 대화하듯 장르와 분위기를 고르면 가사와 곡이 완성돼요. 마음에 드는 가사는 가사집에 모아둘 수 있어요.

■ 나의 이야기를 담은 나의 곡
오늘 있었던 일, 우리 집 반려동물, 학교와 회사 이야기를 들려주면 노래 가사가 돼요. 내 목소리를 학습시키면 내 목소리로 부른 곡도 만들 수 있어요.

■ 크루들과 함께 앨범을 만들고 공유해요
취향이 맞는 사람들과 크루를 만들어 채팅하고, 게시판과 플레이리스트·앨범을 함께 채워 보세요. 피드에 새 곡 소식을 올리고, 공유 영상으로 내 곡을 알릴 수도 있어요.

■ TOP 100 차트에 도전!
완성한 곡을 발매하고 실시간 TOP 100 차트에 도전하세요. 일간·주간·월간 순위로 반응을 확인할 수 있어요.

■ 디렉터들이 일하는 나만의 기획사
기획사 건물에서 디렉터들에게 작업을 맡기고, 새로운 디렉터를 영입해 보세요.

■ 별로 즐기는 창작
작사·작곡·커버 생성 같은 창작 기능에는 앱 안에서 쓰는 별이 필요해요. 별은 출석, 광고 시청, 프로필 완성 등으로 무료로 받을 수 있어요.

[안내]
· 기능과 화면은 업데이트에 따라 바뀔 수 있어요.
· AI로 만든 곡과 이미지에는 AI 생성 표시가 붙어요.

문의: lotusai.official@gmail.com
운영: 주식회사 로터스에이아이
```

**Play 원문과 다른 곳(1곳)**
- `· MAIDOL은 현재 오픈 베타 서비스 중이며, 기능과 화면은…` → `· 기능과 화면은 업데이트에 따라 바뀔 수 있어요.`
  - 이유: App Store 심사 가이드라인 2.2 — 베타·시험판은 App Store가 아닌 TestFlight용. 설명에 "베타"가 있으면 미완성 앱으로 반려될 수 있음.

**그대로 둔 것(확인함)**: "AI가 무료로 완성" — 앱이 무료이고 별을 무료로 받을 수 있어 사실과 일치(이름·부제·키워드에는 "무료"를 넣지 않음). 문의 이메일은 Play와 같은 `lotusai.official@gmail.com` — 문의 담당 이메일을 maidol_official@lotusai.co.kr 로 바꾸면 Play·App Store 함께 변경.

### 2-3. 키워드 (최대 100자, 쉼표 뒤 공백 없음) — 79자

```
작사,작곡,노래만들기,AI작곡,AI음악,음악만들기,가사,아이돌,버추얼아이돌,기획사,앨범커버,내목소리,보이스,차트,플레이리스트,크루,작곡앱,K팝
```

- 이름·부제에 이미 있는 단어(MAIDOL·AI·아이돌 일부·이야기·디렉터·노래)는 App Store가 자동으로 검색에 반영하므로 키워드에서 중복을 피함. 다른 앱·브랜드 이름은 넣지 않음.

---

## 3. 카테고리

| 구분 | 추천 | 이유 |
|---|---|---|
| 기본(Primary) | **음악** | 핵심 가치가 곡 제작·발매·감상(차트·플레이리스트·백그라운드 재생) — 음악 앱 검색·차트에 노출 |
| 보조(Secondary) | **엔터테인먼트** | AI 아티스트 육성·크루·피드 등 팬덤·놀이 요소. (대안: 소셜 네트워킹 — 다만 소셜 카테고리는 UGC 심사 기준이 더 엄격하게 적용되는 편이라 비추천) |

> "어린이(Kids)" 카테고리는 선택하지 마세요 — 어린이 카테고리는 제3자 광고(AdMob)·분석을 금지합니다.

---

## 4. URL

| 항목 | 값 | 상태 | 근거 |
|---|---|---|---|
| 지원 URL (필수) | `https://maidol.ai.kr/` | ✅ 200 응답 확인(2026-10-09) | 홈페이지 하단에 문의하기(메일)·전화·주소 있음 — `homepage/maidol/www/index.html` |
| 마케팅 URL (선택) | `https://maidol.ai.kr/` | ✅ | 같은 랜딩. 랜딩의 "App Store 출시 준비 중" 문구는 출시 후 스토어 링크로 교체 필요 |
| 개인정보 처리방침 URL (필수) | `https://lotusai.co.kr/privacy` | ✅ 200 응답 확인 | 앱 홈페이지 `www/_redirects`(maidol.ai.kr/privacy → 여기로 301), 랜딩 푸터 링크. ⚠️ 0번 6항(푸시 토큰·애플 로그인) 갱신 필요 |
| (참고) 이용약관 | `https://lotusai.co.kr/terms` | ✅ 200 | 앱 설명 끝이나 EULA 칸에 쓰려면 사용. 기본은 애플 표준 EULA |
| (참고) 계정 삭제 안내 | `https://maidol.ai.kr/delete-account/` | ✅ 200 | 앱 내 탈퇴 + 이메일 요청 방법 안내 |

> ❓ 문의 이메일이 세 곳에서 다릅니다: 앱 설정 푸터·랜딩 = `kimpearl@lotusai.co.kr`, 계정삭제·보호자 페이지 = `lotusai.official@gmail.com`, 스토어 문의 담당(10-08 결정) = `maidol_official@lotusai.co.kr`. App Store Connect "연락처 정보"와 설명 끝 문의처를 어느 주소로 통일할지 정해 주세요(근거: `components/PolicySheet.tsx` `CompanyFooter`, `www/delete-account/index.html`, `INTEGRATIONS.md` 계정 원칙).

---

## 5. 저작권

```
2026 LOTUS AI Co., Ltd.
```

> App Store Connect 판매자 표기(LOTUS AI Co., Ltd.)와 맞춘 영문안. 한글로 쓰려면 `2026 주식회사 로터스에이아이`. ©는 넣지 않아도 됩니다(스토어가 표시 시 붙임).

---

## 6. 연령 등급 설문 (2025년 개편 설문 기준)

### 6-1. 항목별 답변

| 설문 항목 | 답변 | 근거 / 비고 |
|---|---|---|
| **앱 내 통제 기능** | | |
| 보호자 통제(Parental Controls) | **예** | 만 14세 미만은 보호자 동의 후 가입, 보호자 웹 페이지에서 피드 글·댓글·친구 메시지 허용을 켜고 끔 — `www/guardian/index.html`, `utils/kidsRestricted.ts`(`feed_write`·`comment`·`dm_friends`) |
| 연령 확인(Age Assurance) | **예** | 가입 시 생년월일 필수·가입 후 변경 불가(`birth_date_locked`), 서버가 나이로 어린이 계정 판정(`kids_restricted`) + **iOS: 애플 Declared Age Range**(v3.331 — 소셜 화면 첫 진입 시 1회 요청, 13세 미만이면 소셜 차단) |
| **기능(Capabilities)** | | |
| 무제한 웹 접근 | **아니요** | 앱 내 웹뷰·브라우저 없음. 외부 링크(코디 상품·SNS 업로드)는 Safari로 열림, 소셜 로그인만 인증 세션 사용 |
| 사용자 생성 콘텐츠(UGC) | **예** | 곡 발매·직접 업로드, 피드 글·사진, 곡 댓글, 크루 게시판, 프로필 |
| 소셜 미디어 | **예** | 피드(게시글·좋아요·댓글)·크루로 사용자 콘텐츠가 확산 |
| **13세 미만 소셜 미디어 비활성화** | **예** (v3.331, 2026-10-11) | iOS에서 어린이 계정이거나 Declared Age Range가 13세 미만(upperBound<13)이면 피드 탭·피드 상세·커뮤니티 탭·크루 홈·마이페이지/채널의 피드·커뮤니티 탭·플레이어 댓글 차단. 공유 거부·iOS 26 미만·애플 계정 미로그인 시 계정 나이로 판정. 차트·감상·창작·DM(어린이는 공식 계정만)은 유지. 효과: 13세 미만의 스크린 타임 '소셜 미디어' 시간 제한 대상에서 제외 |
| 메시지·채팅 | **예** | 1:1 메시지(DM), 크루 채팅 — `DmChatScreen.tsx`, `ClubChatScreen.tsx` |
| 광고 | **예** | AdMob 보상형 광고(광고 보고 휴식 단축) — 사용자가 선택할 때만 노출 |
| **콘텐츠 빈도** (없음 / 드물게·약함 / 잦음·강함) | | |
| 비속어·저속한 유머 | **드물게/약함** 🖊 | AI·사용자 가사에 가벼운 표현이 섞일 수 있음(서버 금칙어 필터 있음). 보수적으로 "드물게" 권장 — "없음"으로 하면 등급은 낮아지나 심사 중 가사 발견 시 반려 위험 |
| 성적 콘텐츠·노출 | 없음 | 생성 이미지 서버 안전 필터 전제(❓ 서버 필터 수준 확인 권장) |
| 폭력(만화·사실적·잔혹) | 없음 | |
| 공포·호러 | 없음 | |
| 성숙한 주제(Mature/Suggestive) | 없음 | |
| 의료·치료 정보, 건강·웰니스 | 없음 | |
| 알코올·담배·약물 | 없음 | |
| 도박 시뮬레이션 / 실제 도박 / 확률형 아이템 | 없음 | 스타는 현금 판매·환전 없음, 확률형 보상 없음 |
| 경품·콘테스트 | 없음 | 차트는 재생수 순위일 뿐 상품 지급 없음(❓ 차트 1위 보상 이벤트를 하게 되면 "예"로 변경) |
| 총기·무기 | 없음 | |

### 6-2. 권장 결과

- **예상 등급: 13+** (UGC·메시지·비속어 "드물게" 조합 시 App Store Connect가 계산). 비속어를 "없음"으로 답하면 9+가 나올 수 있으나, UGC·채팅이 있는 앱은 13+로 두는 편이 심사·운영상 안전합니다.
- **"어린이용으로 제작(Made for Kids)": 아니요.** 만 14세 미만 가입을 허용하지만 어린이 전용 앱이 아니며, 어린이 카테고리는 AdMob과 양립 불가.
- 🖊 13+ 등급인데 만 13세 미만 어린이 계정이 존재하는 점: 등급은 "콘텐츠 기준"이라 위반은 아니지만, 보호자 동의·어린이 제한(비맞춤 광고·사진/목소리 차단·DM 제한)이 이미 구현되어 있다는 점을 심사 메모에 적어 두는 것을 권장(8번에 반영).

> 근거: `utils/kidsRestricted.ts`(어린이 제한 문구·권한 키), `hooks/useRewardedSkipAd.ts`(어린이: `tagForChildDirectedTreatment`·`maxAdContentRating: G`·비맞춤 광고), `components/ReportModal.tsx`(신고 대상: 곡·피드·댓글·곡 댓글·크루 멤버·크루 메시지), `screens/BlockedUsersScreen.tsx`·`services/blockService.ts`(차단), `screens/FeedComposeScreen.tsx`(금칙어 400 안내).

---

## 7. 앱 개인정보 보호 (App Privacy "영양성분표")

### 7-1. 데이터 유형별 신고안

| Apple 데이터 유형 | 수집 | 사용자와 연결 | 추적에 사용 | 용도 (Apple 분류) | 근거 |
|---|---|---|---|---|---|
| 연락처 정보 › 이메일 주소 | 예 | 예 | 아니요 | 앱 기능(계정) | 가입·로그인 `services/authService.ts` |
| 연락처 정보 › 이름 | 예 | 예 | 아니요 | 앱 기능 | 소셜 가입 시 이름, 만 14세 미만 보호자 성명 — 처리방침 제2조 |
| 연락처 정보 › 전화번호 | 예 | 예 | 아니요 | 앱 기능 | 보호자 휴대폰번호(보호자 동의 문자) `authService.ts` `guardian_phone` |
| 민감한 정보 (생체정보) | 예 | 예 | 아니요 | 앱 기능 | 얼굴 인증 실시간 촬영·얼굴 특징정보 — `FaceVerifyScreen.tsx`, 처리방침 제7조 |
| 사용자 콘텐츠 › 사진 또는 동영상 | 예 | 예 | 아니요 | 앱 기능 | 프로필·피드·DM 사진, 아티스트 생성용 사진, 커버 이미지 |
| 사용자 콘텐츠 › 오디오 데이터 | 예 | 예 | 아니요 | 앱 기능 | 목소리 학습 녹음·업로드, 참고 음악 녹음, 직접 업로드 음원 |
| 사용자 콘텐츠 › 이메일 또는 문자 메시지 | 예 | 예 | 아니요 | 앱 기능 | DM·크루 채팅 |
| 사용자 콘텐츠 › 고객 지원 | 예 | 예 | 아니요 | 앱 기능 | 문의하기(오류 신고) `components/settings/IssueReportModal.tsx`, 신고 내용 |
| 사용자 콘텐츠 › 기타 사용자 콘텐츠 | 예 | 예 | 아니요 | 앱 기능 | 가사·프롬프트, 피드 글·댓글, 크루 게시글 |
| 식별자 › 사용자 ID | 예 | 예 | 아니요 | 앱 기능, 분석 | 계정 ID(분석 이벤트에 로그인 토큰 동봉, 광고 SSV에 user_id 전달) |
| 식별자 › 기기 ID | 예 | 예 | **예** (ATT 동의 시) | 제3자 광고, 분석 | ① AdMob 광고식별자(IDFA) ② 설치 단위 무작위 ID(`utils/screenAnalytics.ts` device_id — 로그인 시 계정과 연결) |
| 사용 데이터 › 제품 상호작용 | 예 | 예 | 아니요 | 분석, 앱 기능 | 화면별 체류시간·세션(`screenAnalytics.ts` → `/api/analytics/events`), 재생·좋아요·공유 이벤트 |
| 사용 데이터 › 광고 데이터 | 예 | 예 | **예** (ATT 동의 시) | 제3자 광고 | AdMob 광고 노출·상호작용 |
| 진단 › 충돌 데이터 / 기타 진단 데이터 | 예 | 예 | 아니요 | 앱 기능(오류 수정) | 콘솔 오류·스택·화면 경로·UA(`utils/remoteLogger.ts` → `/api/_logs/frontend`, 로그인 사용자만 전송) |
| 기타 데이터 | 예 | 예 | 아니요 | 앱 기능, 분석 | 생년월일·성별·내외국인 여부(필수), 지역·SNS 주소·소개글(선택) |
| 검색 기록 | ❓ | — | — | — | 앱 내 곡 검색어를 서버가 저장·로그하는지 확인 필요(저장하면 "예·연결·추적 아니요") |
| 위치 / 연락처(주소록) / 금융 정보 / 구매 내역 / 건강 / 브라우징 기록 | 수집 안 함 | | | | 처리방침 제2조 "위치정보, 주소록, 결제 정보 수집하지 않음" 과 일치. 스타는 무료 적립뿐이라 구매 내역 없음 |

### 7-2. 추적(Tracking) · ATT

- **추적 여부: "예"로 신고해야 합니다.** 성인 회원의 보상형 광고 요청은 맞춤 광고(`requestNonPersonalizedAdsOnly` 미지정)이므로 AdMob SDK가 IDFA를 쓰게 됩니다(어린이 계정만 비맞춤). → 위 표의 "기기 ID·광고 데이터"가 추적 항목.
- ⚠️ 따라서 iOS 빌드에 **ATT 동의 팝업**이 필요합니다: `expo-tracking-transparency` 설치 + `NSUserTrackingUsageDescription` 한국어 문구(예: "맞춤형 광고 제공을 위해 광고 식별자를 사용합니다. 허용하지 않아도 모든 기능을 쓸 수 있어요.") + 광고 SDK 초기화 전에 요청. 현재 코드에는 없음(전체 검색 0건).
- 대안 🖊: iOS에서는 성인도 비맞춤 광고로 고정하면 ATT 없이 "추적 아니요"로 신고 가능(광고 수익은 낮아짐). 9-29 iOS 감사 보고서는 "비맞춤 전용이라 ATT 불필요"로 적었지만, 현재 코드는 어린이만 비맞춤이라 그 판단은 더 이상 맞지 않습니다.
- 푸시 토큰(Expo/APNs)은 Apple 데이터 유형에 별도 항목이 없어 신고 대상은 아니지만, 처리방침 문구("푸시 알림 토큰 수집하지 않음")는 고쳐야 합니다.

> 근거: `hooks/useRewardedSkipAd.ts`(140~152행 요청 옵션, 83~100행 어린이 설정), `utils/screenAnalytics.ts`, `utils/remoteLogger.ts`, `constants/consentTexts.ts`, 처리방침 https://lotusai.co.kr/privacy 제2조·제6조, `package.json`(tracking-transparency 없음).

---

## 8. 심사 정보

### 8-1. 로그인 정보 (데모 계정) — 🖊 대표님이 생성

| 항목 | 값 |
|---|---|
| 사용자 이름(성인) | `playreview@lotusai.co.kr` (구글 Play 심사 계정과 동일) |
| 사용자 이름(어린이) | `playreview_child@lotusai.co.kr` — 심사 메모에 함께 기재 |
| 암호 | 대표님 보관 — App Store Connect 입력란에만 입력(문서·채팅 금지) |

**✅ 준비 완료(2026-10-12, 외부 연동 세션 — 앱과 같은 API 흐름으로 생성)**
| 계정 | 별 | 아티스트(그림체) | 발매곡(커버 포함, 공개) |
|---|---|---|---|
| 성인 `playreview@lotusai.co.kr` | 3,000 | 루미(여성·20대, 웹툰) | 「출근길 라떼」(직장생활) · 「우리 집 막내 보리」(반려견) |
| 어린이 `playreview_child@lotusai.co.kr`(2016년생·보호자 동의 완료) | 1,000 | 토리(남성·10대, 웹툰) | 「강아지랑 산책해요」(방과 후·반려견) |
- 디렉터 휴식(쿨다운) 모두 해제된 상태로 둠. 가사·이미지·커버 모두 직접 검토(선정·폭력·실존 인물·브랜드 없음).

데모 계정 준비 체크리스트:
- [ ] **성인** 생년월일로 가입(어린이 계정이면 사진·목소리·DM이 막혀 심사가 막힘)
- [ ] 스타 넉넉히 지급(예: 300 이상 — 작곡 15·가사 5·커버 5·아티스트 10 소모, `services/pointCosts.ts`)
- [ ] 미리 만든 아티스트 1명 + 발매곡 2~3곡(생성 대기 없이 재생·차트·피드 확인 가능하도록)
- [ ] 디렉터 휴식(쿨다운)이 걸리지 않은 상태로 제출
- [ ] 공식 계정과 DM 대화 1건(메시지 기능 확인용)

### 8-2. 심사 메모 (붙여넣기용, 4,000자 이내)

```
안녕하세요. MAIDOL은 AI와 대화하며 노래(가사·작곡·앨범 커버·공유 영상)를 만들고, 나만의 AI 아티스트로 발매해 차트·피드·커뮤니티에서 공유하는 음악 창작 앱입니다.

[로그인]
- 제공한 데모 계정(이메일)으로 로그인해 주세요. 로그인 화면에서 Sign in with Apple, Google, 카카오 로그인도 사용할 수 있습니다.
- 데모 계정에는 기능 체험에 필요한 스타(앱 내 무료 포인트)가 미리 지급되어 있고, 미리 만든 아티스트와 곡이 있습니다.
- Apple·Google·카카오·네이버로 새로 가입하면 가입 마무리 단계에서 한국 법령에 따른 휴대폰 본인확인(한국 이동통신사 명의 휴대폰 필요)을 거쳐야 하므로, 심사에는 제공한 데모 계정을 사용해 주세요. 데모 계정은 가입 절차가 모두 끝난 상태입니다.

[핵심 기능 확인 방법]
1) 곡 만들기: 하단 「작업실」 탭 → 작사 디렉터와 대화로 가사 생성 → 작곡 디렉터에서 장르·분위기 선택 → 완성곡 생성. AI 생성은 외부 서버에서 처리되어 보통 1~3분 걸리며, 다른 화면으로 이동해도 계속 진행되고 완료되면 알려드립니다.
2) 앨범 커버·공유 영상: 완성된 곡 화면에서 이미지 디렉터(커버), 영상 디렉터(가사 자막 영상)를 실행할 수 있습니다.
3) 감상: 「차트」「플레이리스트」 탭에서 곡을 재생할 수 있고, 백그라운드 재생(UIBackgroundModes: audio)을 지원합니다.
4) 소통: 「피드」(게시글·댓글), 「커뮤니티」(크루 게시판·채팅), 상단 메시지 아이콘(1:1 메시지).

[권한이 필요한 기능 안내]
- 마이크: 「내 목소리 학습」에서 사용자가 직접 노래 샘플과 검증 문장을 녹음할 때, 작곡 시 참고 음악을 녹음할 때만 사용합니다. 녹음 전 별도의 음성 데이터 처리 동의를 받습니다.
- 카메라: 본인 사진으로 아티스트를 만들 때, 업로드한 사진이 본인인지 확인하는 「얼굴 인증」 촬영에만 사용합니다(타인 사진 도용 방지). 촬영 전 생체정보 수집·이용 동의를 별도로 받으며, 설정에서 언제든 동의 철회·파기할 수 있습니다. 사진 없이 가상 아티스트로도 만들 수 있습니다.
- 사진 보관함: 프로필·피드·아티스트 사진 선택, 만든 공유 영상 저장에 사용합니다.
- 이 기능들은 실제 사람의 목소리·얼굴이 필요해 심사 환경에서 끝까지 진행하기 어려울 수 있습니다. 동의 화면과 녹음·촬영 화면까지 확인해 주시면 됩니다.

[사용자 생성 콘텐츠 안전 장치]
- 곡·피드 글·댓글·곡 댓글·메시지·크루 멤버 신고, 사용자 차단(설정 > 차단한 사용자에서 관리), 서버 금칙어 필터, 신고 접수 시 운영자 검토 후 비공개 처리를 운영합니다.
- 만 14세 미만은 보호자 동의 후에만 가입할 수 있고, 어린이 계정은 사진·목소리 업로드와 모르는 사람과의 메시지가 차단되며, 게시글·댓글·친구 메시지는 보호자가 허용한 경우에만 사용할 수 있습니다. 어린이 계정에는 비맞춤·전체이용가 광고만 표시됩니다.

[광고·결제]
- 앱 내 유료 결제는 없습니다. 스타는 출석·미션·곡 발매 등으로만 무료 적립되며 현금으로 구매하거나 환전할 수 없습니다.
- 광고는 사용자가 「광고 보고 휴식 줄이기」를 직접 선택한 경우에만 보상형 광고로 표시됩니다.

[계정 삭제]
- 상단 사람 모양 아이콘(마이페이지) → 우측 상단 톱니바퀴(설정) → 화면 맨 아래 「회원탈퇴」 → 안내 창에 「회원탈퇴」 입력 → [탈퇴하기]. 즉시 처리됩니다.

[AI 생성 고지]
- 앱의 음악·가사·이미지·영상은 생성형 AI로 만들어지며, 이 사실을 가입 동의와 설정 > 앱 정보에서 고지합니다.

[Demo accounts / 데모 계정]
- Adult: playreview@lotusai.co.kr (entered in the Sign-In fields above)
- Child (under 13, guardian-consented): playreview_child@lotusai.co.kr — password: [대표님 입력]

[Please use the demo accounts — Korean phone identity verification]
- Under Korean law, a new account created with Sign in with Apple, Google, Kakao or Naver must complete mobile phone identity verification (provided by Danal, a licensed Korean identity verification agency) to finish sign-up. This requires a mobile phone registered with a Korean carrier, so it cannot be completed outside Korea.
- Sign in with Apple itself works: it signs the user in and creates the account, and then shows the identity verification step.
- Please use the demo accounts above. Both have already finished sign-up (the child account has also completed guardian consent), so every feature can be reviewed without this step.

[Age-based restrictions on iOS (Declared Age Range)]
- The first time a user opens a social screen, the app requests the user's age range through Apple's Declared Age Range API (system prompt).
- If the account is a child account, or Apple reports an age range under 13, all social features are blocked on iOS: the Feed tab, feed posts, the Community tab, crew homes, the feed/community tabs on My Page and user channels, and comments in the player.
- If the user declines to share, is on iOS earlier than 26, or is not signed in to an Apple Account, the app falls back to the age on the MAIDOL account (birth date entered at sign-up, which cannot be changed later).
- Charts, listening, and creating music remain available. Direct messages for child accounts are limited to the official MAIDOL account only.
- With the child demo account above, you will see the Feed, Community and comments shown as blocked on iOS.

문의: [심사 연락 담당자 이름 / 전화 / 이메일]
```

> ✅ Sign in with Apple(2026-10-11 운영 반영)·iOS 보상형 광고 단위 연결 완료 — 위 메모 그대로 사용 가능.
> ✅ v3.331 Declared Age Range(메인 세션) 반영 — 어린이 데모 계정으로 소셜 차단 확인 가능. 실기기 미검증(TestFlight로 확인 필요).
>
> 근거: 계정 삭제 — `screens/SettingsScreen.tsx` 341~395행(DELETE `/auth/me`, 확인 문구 "회원탈퇴"), 726행(로그아웃 아래 진입); 진입 경로 — `components/HomeHeaderActions.tsx`(사람 아이콘 → 마이페이지), `App.tsx` 마이페이지 헤더 톱니 → `Settings`; 차단 목록 — `App.tsx` `BlockedUsers` 화면; 보이스 동의 — `consentTexts.ts` `voice_ai`, 얼굴 동의 — `face_biometric`.

### 8-3. 연락처 정보 (App Store Connect 필수 칸)

| 항목 | 값 |
|---|---|
| 이름 | 🖊 `[심사 연락 담당자]` |
| 전화번호 | 🖊 `[+82 …]` (대표전화 02-2272-8952 사용 가능) |
| 이메일 | 🖊 `maidol_official@lotusai.co.kr` 권장(스토어 문의 담당, 10-08 결정) |

---

## 9. 스크린샷 체크리스트

### 9-1. 필수 규격

| 기기 | 해상도(세로) | 필수 여부 |
|---|---|---|
| iPhone 6.9" | 1320×2868 (또는 1290×2796) | **필수** — 이 규격 1세트만 올리면 작은 화면은 자동 축소 사용 |
| iPhone 6.5" | 1284×2778 (또는 1242×2688) | 6.9"를 올리면 선택 |
| iPad 13" | 2064×2752 (또는 2048×2732) | `supportsTablet: true`인 동안 **필수** |

- 장수: 기기별 1~10장(권장 5~6장). PNG/JPG, 알파 채널 없이.
- 실제 앱 화면이어야 함(가이드라인 2.3.3) — 상단 문구·배경 꾸밈은 가능하나 없는 기능 표현 금지.

### 9-2. iPad 지원 — ✅ `supportsTablet: false` 적용(iPad 스크린샷 불필요)

현재 `app.json` → `ios.supportsTablet: true`, `orientation: portrait`.
- **true 유지 시**: iPad 13" 스크린샷 필수, 심사관이 iPad에서 테스트 → 휴대폰용 세로 레이아웃이 iPad에서 깨지면 반려(2.1). iOS 시뮬레이터·iPad 실기기 검증 이력 0회(메모리 `app-runtime-testing-limits`).
- **false로 바꾸면**: iPad에서는 iPhone 앱 호환 모드로 실행(그래도 iPad에서 설치 가능), iPad 스크린샷 불필요.
- ⚠️ **첫 출시 전에 정해야 합니다.** iPad 지원으로 한 번 출시하면 이후 업데이트에서 iPad 지원을 빼는 것이 허용되지 않습니다.

### 9-3. 촬영 추천 화면 (6장)

| 순서 | 화면 | 상단 카피(예시) | 경로 |
|---|---|---|---|
| 1 | 작사 디렉터 대화 | "대화하듯 쓰는 내 노래 가사" | 작업실 → 작사 |
| 2 | 작곡 결과·플레이어(커버+가사) | "장르만 고르면 완성곡까지" | 곡 완성 화면 / 플레이어 |
| 3 | AI 아티스트 결과·코디 보드 | "나만의 AI 아티스트 데뷔" | 작업실 → 아티스트 |
| 4 | 차트 TOP 100 | "발매하고 차트에 도전" | 차트 탭 |
| 5 | 내 목소리 학습 | "내 목소리로 부르는 노래" | 작업실 → 내 목소리 |
| 6 | 크루(커뮤니티)·피드 | "크루와 함께 만드는 플레이리스트" | 커뮤니티 탭 |

> 촬영 시: 데모 계정(성인)으로, 실제 회원 닉네임·얼굴이 보이지 않게(공식 계정·데모 데이터 사용), 상태바 시간 9:41 권장. 홈페이지 랜딩 이미지(`www/img/shot-*.jpg`)는 해상도가 규격에 맞지 않으면 재촬영 필요.

---

## 10. 대표님이 직접 정해야 할 항목

1. **부제** A/B/C 중 선택 (1번)
2. **프로모션 텍스트** 베타안 사용 여부 — iOS 출시가 10/30 이후면 상시안 (2-1)
3. **iPad 지원** — `supportsTablet` false 전환 추천 (9-2, 첫 출시 전 결정 필수)
4. **iOS 광고 방식** — ATT 팝업 넣고 맞춤 광고 / iOS는 비맞춤 고정 (7-2)
5. **비속어 빈도 답변** — "드물게"(13+ 예상, 추천) / "없음" (6-1)
6. **문의 이메일 통일** — 스토어·앱 푸터·처리방침·계정삭제 페이지 (4번)
7. **데모 계정** 생성·스타 지급·샘플 곡 준비, **심사 연락처** 이름·전화 (8-1, 8-3)
8. **저작권 표기** 영문/한글 (5번)
9. **개인정보 처리방침 개정**(푸시 토큰 수집, 애플 로그인 추가) 공고 일정 (0번 6항)
10. **스타 판매(인앱결제) 도입 시점** — 도입하면 설명·심사 메모·개인정보(구매 내역) 전부 수정 필요
