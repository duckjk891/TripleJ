# MAIDOL 스토어 제출 전 감사 — Google Play(프로덕션) · App Store(iOS 첫 출시)

> 작성 2026-10-11 · 외부 연동 세션(읽기 전용 감사) · 대상: 앱 `2_housing`(v1.3.2, frontend 브랜치 a36d18c), Android APK v1.3.2(versionCode 12, EAS 2026-10-11) 바이너리 매니페스트, 공개 페이지(lotusai.co.kr/privacy·terms, maidol.ai.kr, /delete-account, api.maidol.ai.kr 공개 엔드포인트), 서버 스테이징(`server_staging_*`)·백엔드 워크트리(`TripleJ-backend`, v3.190 기준이라 운영과 다를 수 있음).
> 표기: ✅ 확인됨 · ⚠️ 필요(제출 전 조치) · ❓ 확인(이 세션이 볼 수 없는 콘솔·운영 값)
> 누가: **대표**(콘솔·법무·결정) · **Claude**(외부 연동 세션: 문서·홈페이지·스토어 문구·콘솔 안내) · **메인세션**(앱·서버 코드 수정·빌드)
> APK 원본은 분석 후 삭제함. 매니페스트는 androguard로 디코딩(근거의 "APK 매니페스트" = 디코딩 결과).

---

## 0. 이미 진행 중 (이번 감사 대상에서 제외 — 참고만)

- 개인정보 처리방침 개정: 푸시 토큰 "수집 안 함" 문구, 애플 로그인 미기재
- 스플래시 말풍선 「내 음악으로 수익창출까지」 교체
- 문의 이메일 `maidol_official@lotusai.co.kr` 통일 (로컬 소스는 대부분 반영됨, **운영 페이지는 아직 옛 주소** — 공통 C-12 참고)
- 심사용 데모 계정(⭐·아티스트·곡) 준비
- AWS SES(비밀번호 재설정 메일)
- PG(결제) 연동

---

## 1. 제출 전 반드시 고칠 것 (요약, 우선순위순)

| # | 무엇 | 왜 막히나 | 근거 | 누가 |
|---|---|---|---|---|
| 1 | **소셜 가입(구글·애플·미인증 카카오)이 약관·개인정보·국외이전 동의와 생년월일(연령) 확인 없이 계정을 만든다** | Apple 1.2(UGC 전 약관 동의)·5.1.2, 개인정보보호법 제15·22조의2·28조의8, Play 가족 정책(나이 모름 사용자) 모두 걸림. 만 14세 미만이 소셜 버튼으로 보호자 동의를 우회 가능 | `server_staging_ios1/app/routes/apple_auth.py:167-223`(동의·생년월일 없이 signup), `server_staging_v3323/app/routes/oauth.py:321-398`(신규 INSERT 시 birth_date 는 본인인증 계정만), 앱에 소셜 가입 후 동의·연령 화면 없음(`components/auth/AuthPanel.tsx:417,437` 로그인 탭에서 바로 소셜 가입, `getMyConsents` 사용처는 설정의 마케팅 토글뿐), 계획서 E3 미구현 `team-dev/PLAN.md:6906,7003,7124`(나이 모름 31/43명) | 메인세션(앱+서버) |
| 2 | **목소리 학습(보이스 클론)·참고 음악 녹음 전에 "음성 데이터 AI 처리 동의"가 화면에 없다** | Apple 5.1.2(i)(제3자 AI로 개인 데이터 전송 전 고지·명시 동의), Play 사용자 데이터 정책(눈에 띄는 고지). 심사 메모의 "녹음 전 별도의 음성 데이터 처리 동의를 받습니다"가 사실과 다름 | 동의문은 `constants/consentTexts.ts:182`(voice_ai)에 정의만, 앱 전체 사용처 0건. `screens/VoiceCloneWizardScreen.tsx:883-900`(1단계 바로 녹음/업로드), `screens/VoiceManageScreen.tsx:396-399`, `screens/ArtistResultScreen.tsx:763` 진입부에도 없음. 참고 음악 녹음 `screens/MusicGenerationScreen.tsx:1631` | 메인세션 |
| 3 | **실제로 쓰는 AI 사업자가 동의문·처리방침에 없다** — Anthropic(Claude) 미기재 (※정정 2026-10-11: Replicate·LALAL·Kits 는 관리자 헬스체크에서 키만 참조, 사용자 데이터 전송 없음 → 기재 불필요), 앱 국외이전 동의(6곳)와 처리방침(9곳) 목록 불일치 | Apple 5.1.2(i)·개인정보보호법 제28조의8(이전받는 자 명시). 사용자가 동의한 목록 ≠ 실제 전송처 | Anthropic: `server_staging_v3329/app/services/character_generator.py:20,1041-1049`(claude-opus-4-7), 백엔드 `lyrics_generator.py:36,451`, `translation.py:35`; Replicate·Kits·Sync 헬스체크 `team-dev/REPORT.md:2897`. 앱 동의 `consentTexts.ts:91-116`엔 Wondera·AWS(도쿄)·AdMob 없음. 처리방침 제6조엔 Anthropic·Replicate·Expo 푸시 없음 | 대표(법무)+Claude(문안)+메인세션(동의 버전 올려 재동의) |
| 4 | **Android 사진·동영상 권한(READ_MEDIA_IMAGES/VIDEO) — Play 사진·동영상 권한 정책 위반 소지** | 영상 "저장"만 하는데 전체 미디어 읽기 권한을 요청. Play는 핵심 기능이 아니면 권한 제거(포토 피커/쓰기 전용) 요구, 신고서 제출해도 반려 가능성 큼 | APK 매니페스트 7-10행(READ_MEDIA_AUDIO·IMAGES·VIDEO·VISUAL_USER_SELECTED), `screens/VideoDirectorScreen.tsx:1408`(`requestPermissionsAsync()` 쓰기전용 아님), `utils/nativeSave.ts:68-74`(앨범 조회). 사진 선택은 이미 expo-image-picker(시스템 피커) | 메인세션 |
| 5 | **설정 화면에 테스트·미완성 항목 노출** — 「재생 엔진 테스트」(디버그 화면), 「비밀번호 변경」「오픈소스 라이선스」 → "준비 중인 기능입니다" | Apple 2.1(완성도)·2.3. 심사관은 탈퇴 경로 확인하러 설정을 반드시 연다 | `screens/SettingsScreen.tsx:973-981, 1006-1014`(AudioSpike 진입 — 로그인·비로그인 둘 다), `:569-575`, `:682-687` | 메인세션 |
| 6 | **약관에 "부적절 콘텐츠·악성 사용자 무관용" 조항이 없고, 앱 안의 약관·처리방침은 구버전 축약문** | Apple 1.2: UGC 앱은 무관용을 명시한 약관(EULA) 동의 필수. 5.1.1(i): 앱 안에서 처리방침 열람. 현재 앱의 「개인정보 처리방침」은 처리방침이 아니라 가입 시 "수집·이용 동의" 문안 | 웹 약관 제8·14조에 무관용·24시간 내 조치·차단 문구 없음(https://lotusai.co.kr/terms), 앱 약관 `consentTexts.ts:25-62`(8개 조, 2026-07-30판 — 웹은 9-26 개정 제5조의2 포함 19개 조), `SettingsScreen.tsx:983-987` + `components/PolicySheet.tsx` CompanyFooter가 `CONSENTS.terms/privacy` 본문만 표시(웹 링크 없음) | 대표(법무)+Claude(문안)+메인세션(링크) |
| 7 | **Android 프로덕션 AAB(1.3.2) 미빌드 + Play 계정 유형 미확인** | Play 프로덕션은 AAB 필수. 개발자 계정이 2023-11-13 이후 만든 **개인** 계정이면 프로덕션 신청 전 "테스터 12명 이상 14일 비공개 테스트" 필수 | `eas.json` production 프로필(buildType 미지정=AAB) ✅. 마지막 AAB는 v1.1.0(`team-dev/REPORT.md:2658`). 소유 계정 `lotusai.official@gmail.com`, 조직 계정 전환은 "다음 단계"로만 기록(`memory/store-registration-progress.md`, `INTEGRATIONS.md:152`) | 대표(계정 유형 확인)+메인세션(AAB 빌드) |
| 8 | **Play 타겟층·가족 정책 결정 + Data safety·광고 ID·FGS 신고** | 13세 미만 어린이 계정(심사용 포함)이 있는데, 나이 모름 사용자에게 맞춤 광고·AdMob 앱 시작 시 초기화. 타겟층에 13세 미만을 넣으면 가족 정책 전면 적용 | `hooks/useRewardedSkipAd.ts:274-307`(앱 시작 시 `MobileAds().initialize`), `:84-100`(어린이만 아동 설정), `PLAN.md:7124`(D8: 가족 정책 제출 전 재결정 예정), APK 매니페스트 15행 AD_ID, 120행 mediaPlayback FGS | 대표(결정·콘솔)+Claude(답안 초안) |
| 9 | **생성형 AI 결과물 앱 내 신고 수단이 비공개 결과 화면에 없음** | Play AI 생성 콘텐츠 정책: 앱을 나가지 않고 불쾌한 AI 결과를 신고·표시할 수 있어야 함 | 신고 대상 `components/ReportModal.tsx:21`(발매곡·피드·댓글·DM·크루만). AI 디렉터 대화(`DialogueScreen`), 가사 결과, 커버·아티스트 생성 결과엔 신고 없음. 문의하기 사유(`utils/issueReport.ts:13-19`)에도 "부적절한 AI 결과" 없음 | 메인세션 |
| 10 | **운영 중인 공개 페이지·공유 문구의 베타·테스터 안내 정리 + app-ads.txt** | 앱이 공유하는 초대 링크가 "베타 기간에는 등록된 테스터만 설치 … kimpearl@lotusai.co.kr"로 안내. app-ads.txt 없음(랜딩 HTML 반환) → AdMob 광고 제한 | https://api.maidol.ai.kr/invite/{code} 실측, `server_staging_v3305/_orig/routes/referral.py:145-146`, https://maidol.ai.kr/app-ads.txt → 200 text/html(랜딩), 앱 공유 문구 `components/AppShareModal.tsx:91`, `components/feed/FeedCard.tsx:342`, `constants/shareMessages.ts:118` | 메인세션(서버·앱)+Claude(app-ads.txt 게시)+대표(AdMob 줄 전달) |

> 이 밖의 ⚠️(애플 로그인 이메일 릴레이 등록, App Privacy 대략적 위치 항목, 접근권한 고지 등)는 아래 표에 있습니다.

---

## 2. Google Play

| 항목 | 상태 | 근거 | 해야 할 일 | 누가 |
|---|---|---|---|---|
| 타겟 API 수준 | ✅ | APK 매니페스트 2행 `targetSdkVersion=36`, `minSdk=24`, compileSdk 36. 공식 요건: 2026-08-31부터 신규 앱·업데이트는 API 36 이상(https://developer.android.com/google/play/requirements/target-sdk, 2026-10-01 갱신) | 없음 | — |
| AAB 프로덕션 빌드 | ⚠️ | `eas.json` production: buildType 미지정=AAB, `autoIncrement`, appVersionSource remote. 1.3.2는 preview **APK**(versionCode 12)만 빌드됨. 마지막 AAB v1.1.0 | `eas build -p android --profile production` → versionCode 13 이상 AAB. 업로드 키는 지난 내부 테스트 AAB와 같은 EAS 키스토어인지 확인 | 메인세션 |
| 개발자 계정 유형·프로덕션 접근 | ❓ | 소유 `lotusai.official@gmail.com`. 조직 계정($25, D-U-N-S) 개설 여부 기록 없음 | Play Console → 설정 → 개발자 계정 유형 확인. **개인 계정이면** 비공개 테스트(12명·14일 연속) 후 프로덕션 액세스 신청 필요 → 일정에 2~3주 반영 | 대표 |
| 사진·동영상 권한(READ_MEDIA_IMAGES/VIDEO) | ⚠️ | APK 매니페스트 6-10·14행: READ_EXTERNAL_STORAGE·WRITE_EXTERNAL_STORAGE(maxSdk 없음), READ_MEDIA_AUDIO·IMAGES·VIDEO·VISUAL_USER_SELECTED, `requestLegacyExternalStorage=true`. 출처 = `expo-media-library` 플러그인(app.json). 용도는 공유 영상 저장뿐(`VideoDirectorScreen.tsx:1408`, `nativeSave.ts:68-74`) | app.json `android.blockedPermissions`에 READ_MEDIA_IMAGES/VIDEO/AUDIO 추가, 저장은 `requestPermissionsAsync(true)`(쓰기 전용)+앨범 조회 제거, READ/WRITE_EXTERNAL_STORAGE는 maxSdkVersion 32/29. 빌드 후 매니페스트 재확인 | 메인세션 |
| 포그라운드 서비스 신고 | ⚠️ | APK 매니페스트 64-65행 FOREGROUND_SERVICE·**FOREGROUND_SERVICE_MEDIA_PLAYBACK**, 120행 `AudioControlsService type=mediaPlayback`. 125행 `AudioRecordingService type=microphone`인데 FOREGROUND_SERVICE_MICROPHONE 권한 없음 — expo-audio `enableBackgroundRecording=false`라 시작되지 않음(정상) | Play Console → 앱 콘텐츠 → 포그라운드 서비스 권한: "미디어 재생(백그라운드 음악 재생)" 설명 + 잠금화면 재생 시연 동영상 링크 | 대표(콘솔)+Claude(설명 문안·촬영 시나리오) |
| POST_NOTIFICATIONS | ✅ | 매니페스트 5행. 로그인 후 앱 내 안내 → OS 권한 요청(`services/pushService.ts:199-205`) | 없음 | — |
| CAMERA · RECORD_AUDIO | ✅ | 66·11행. 카메라=얼굴 인증 셀피(동의 후), 마이크=목소리 학습·참고 음악 녹음. 신고서 대상 권한 아님 | 단, 마이크 사용 전 고지는 1번 표 #2 참고 | — |
| SYSTEM_ALERT_WINDOW 등 불필요 권한 | ⚠️(경미) | 매니페스트 12행 SYSTEM_ALERT_WINDOW(Expo 템플릿 잔재), 82-90행 각 제조사 배지 권한, ML Kit 바코드(`expo-dev-client` 유래로 추정, 117·185행), `exp+triplej-studio` 스킴 | `blockedPermissions`에 SYSTEM_ALERT_WINDOW 추가. `expo-dev-client`는 프로덕션 빌드에서 빼는 것 권장(심사 차단 요인은 아님) | 메인세션 |
| 광고 ID 신고 | ⚠️ | 매니페스트 15행 AD_ID, 69-71행 ADSERVICES_*. AdMob 보상형 광고 | 앱 콘텐츠 → 광고 ID: "예", 용도 "광고·마케팅", "분석" 체크 | 대표 |
| 광고 포함 신고 | ⚠️ | 보상형 광고(로그인 사용자만 로드 — `useRewardedSkipAd.ts:126-132`) | 앱 콘텐츠 → 광고: "광고 있음" | 대표 |
| app-ads.txt | ⚠️ | https://maidol.ai.kr/app-ads.txt → 200 이지만 내용은 랜딩 HTML(SPA 폴백) | 대표가 AdMob 콘솔의 app-ads.txt 한 줄 전달 → Claude가 `homepage/maidol/www/app-ads.txt` 게시(_redirects 폴백보다 우선하는지 확인). Play 등록정보 "웹사이트"를 maidol.ai.kr로 | 대표+Claude |
| 데이터 보안(Data safety) 양식 | ⚠️ | 아래 2-1 표 | 2-1 표대로 입력. 특히 대략적 위치(AdMob IP), 기기 ID(AAID·FCM 설치 ID·익명 device_id), 음성·사진·생체 | 대표(입력)+Claude(답안 확정) |
| 전송 중 암호화 답변 | ⚠️(경미) | 매니페스트 91행 `usesCleartextTraffic=true`(app.json expo-build-properties). API·업로드는 HTTPS | "전송 중 암호화: 예"로 답하려면 cleartext를 끄거나 kakaocdn 등 필요한 도메인만 network security config로 허용 | 메인세션 |
| 앱 액세스(심사 계정) | ⚠️ | 성인 `playreview@lotusai.co.kr`, 어린이 `playreview_child@lotusai.co.kr`(보호자 동의 mock·OTP 면제, `REPORT.md:3310`) | 로그인 안내(영문)에 어린이 계정의 제한 내용, 보호자 관리 페이지 사용법 기재. 데모 데이터는 "진행 중" 항목 | 대표+Claude(영문 안내) |
| 타겟층·가족 정책 | ❓🖊 | 어린이 계정 존재·보호자 동의 경로 OFF(`GET /api/auth/signup-config` → `{"guardian_consent_enabled":false}` 실측) — 즉 만14 미만은 이메일 가입 불가, 소셜로는 우회 가능(#1). 나이 모름 사용자 맞춤 광고(D8). 앱 시작 시 AdMob 초기화 | **안 A(권장, 첫 출시)**: 타겟층 13세 이상으로 신고, 어린이 계정은 심사 안내에서 제외. **안 B**: 13세 미만 포함 → 가족 정책 전면(나이 모름=아동 설정, 연령 확인 전 광고 SDK 초기화 금지, 개인정보·광고 요건). 어느 쪽이든 #1(소셜 연령 확인)은 먼저 | 대표(결정)+메인세션 |
| 생성형 AI 콘텐츠 정책 | ⚠️ | 1번 표 #9 | 가사·AI 디렉터 대화·커버·아티스트 결과 화면에 「신고/부적절한 결과」 버튼(서버 `reports` target_type 추가 또는 issues 사유 추가) | 메인세션 |
| UGC 정책(신고·차단·약관) | ⚠️ | 신고 ✅(`ReportModal.tsx:21`: 발매곡·피드·댓글·곡 댓글·DM·크루 멤버·크루 메시지). 차단은 피드·DM에서만(`FeedCard.tsx:264`, `DmChatScreen.tsx:282`) — 곡 댓글·크루 채팅·유저 채널에서 차단 불가. 금칙어는 DM·피드·댓글·곡 댓글만 전 사용자 적용(`REPORT.md:3310` WORD_FILTER_SOCIAL_ALL_USERS=true) | 곡 댓글·크루 채팅·유저 채널에 차단 추가 권장, 약관 무관용 조항(#6) | 메인세션+대표 |
| 계정 삭제 URL | ⚠️(경미) | https://maidol.ai.kr/delete-account/ 200 ✅, 삭제·보관 데이터 구분 ✅. 다만 운영 페이지는 옛 이메일(`lotusai.official@gmail.com`), 가입 방식에 **애플 없음·네이버(v3.194 제거) 잔존** | 로컬 소스(이메일 반영됨) 배포 + "이메일·카카오·구글·애플"로 수정 | Claude |
| 콘텐츠 등급(IARC) | ❓ | Apple 13+/한국 15+로 답함(`IOS_APPSTORE_LISTING.md` 6장). Play 설문 결과 미확인 | 같은 사실로 답변: 사용자 간 소통(DM·크루 채팅)·UGC 공유 "예", 위치 공유 "아니요", 디지털 구매 "아니요", 채팅 조정 "예(금칙어)" | 대표 |
| 등록정보 문구 | ⚠️(경미) | Play 자세한 설명에 "MAIDOL은 현재 오픈 베타 서비스 중"·문의 `lotusai.official@gmail.com`(`IOS_APPSTORE_LISTING.md` 2-2 원문 비교) | 프로덕션 전환 시 베타 문구 제거, 문의 이메일 교체(진행 중 항목과 함께) | 대표 |
| 앱 이름 일관성 | ✅ | 런처 이름 `MAIDOL`(app.json name), 패키지 `com.maidol.app`, 노출 문자열에 AIDOL 없음(딥링크 스킴 `aidol`은 비노출) | 없음 | — |
| 앱 내 업데이트 안내 | ❓ | `GET /api/app/version` 실측: android latest `1.3.1`, ios latest `0.0.0`·store_url 빈값 | 1.3.2 출시 후 android latest 갱신, iOS 출시 후 ios store_url 입력 | 메인세션 |

### 2-1. Data safety 답안 (코드 기준 — 콘솔 입력용 초안)

| Play 데이터 유형 | 수집 | 공유 | 필수/선택 | 목적 | 근거 |
|---|---|---|---|---|---|
| 개인 정보 › 이름 | 예 | 아니요 | 선택(소셜·보호자) | 계정 관리 | 소셜 가입 이름, 보호자 성명 |
| 개인 정보 › 이메일 주소 | 예 | 아니요 | 필수 | 계정 관리 | `authService.ts` |
| 개인 정보 › 사용자 ID | 예 | 아니요 | 필수 | 앱 기능·분석·사기 방지 | SSV custom_data=user_id |
| 개인 정보 › 전화번호 | 예 | 아니요 | 선택(만14 미만 보호자) | 계정 관리 | `guardian_phone` |
| 개인 정보 › 기타(생년월일·성별·내외국인) | 예 | 아니요 | 필수(이메일 가입) | 계정 관리·연령 확인 | 처리방침 제2조 |
| 위치 › 대략적 위치 | **예(AdMob IP)** | **예(Google)** | — | 광고 | AdMob 공시: IP로 대략적 위치 추정(https://developers.google.com/admob/android/privacy/play-data-disclosure) |
| 사진 및 동영상 › 사진 | 예 | 아니요(처리 위탁) | 선택 | 앱 기능 | 프로필·피드·DM·아티스트 사진, 얼굴 셀피 |
| 오디오 › 음성 또는 사운드 녹음 | 예 | 아니요(처리 위탁) | 선택 | 앱 기능 | 목소리 학습·참고 음악 |
| 오디오 › 음악 파일 | 예 | 아니요 | 선택 | 앱 기능 | 직접 업로드 음원(`TrackUploadScreen.tsx:87`) |
| 메시지 › 기타 인앱 메시지 | 예 | 아니요 | 선택 | 앱 기능 | DM·크루 채팅 |
| 앱 활동 › 앱 상호작용 | 예 | 예(AdMob) | — | 분석·광고 | `utils/screenAnalytics.ts`, AdMob |
| 앱 활동 › 기타 사용자 생성 콘텐츠 | 예 | 아니요 | 선택 | 앱 기능 | 가사·프롬프트·피드·댓글 |
| 앱 활동 › 인앱 검색 기록 | ❓ | — | — | — | 서버가 검색어 저장·로그하는지 확인 |
| 앱 정보 및 성능 › 비정상 종료 로그·진단 | 예 | 예(AdMob 진단) | — | 분석·앱 기능 | `utils/remoteLogger.ts`, AdMob 공시 |
| 기기 또는 기타 ID | 예 | 예(AdMob) | — | 광고·분석·앱 기능 | AAID, 앱 세트 ID, FCM/Firebase 설치 ID, 익명 device_id |
| 건강·생체(얼굴) | Play 분류상 "개인 정보"에 생체 별도 항목 없음 → 사진 + 기타로 신고, 개인정보처리방침에 민감정보로 명시 ✅ | | | | 처리방침 제7조 |
| 금융 정보·연락처·웹 기록 | 아니요 | | | | 결제 없음 |
| 전송 중 암호화 | 예(단, cleartext 정리 권장 — 위 표) | | | | |
| 삭제 요청 방법 | 예(앱 내 탈퇴 + URL) | | | | |

> 제3자 AI 처리(Google·OpenAI·Anthropic·Suno·Kling·fal·xAI·Wondera·AWS)는 "회사를 대신한 처리(서비스 제공업체)"로 공유 아님. 단 처리방침·동의문에 전부 적혀 있어야 함(#3).

---

## 3. App Store

| 항목 | 상태 | 근거 | 해야 할 일 | 누가 |
|---|---|---|---|---|
| 1.2 UGC — 약관(EULA) 동의 + 무관용 | ⚠️ | 이메일 가입은 약관 동의 필수 ✅(`AuthPanel.tsx:709-719`). **소셜 가입은 약관 동의 화면 없음**(#1). 약관 본문에 "부적절 콘텐츠·악성 사용자 무관용" 문구 없음(웹 약관 제8·14·15조, 앱 `consentTexts.ts:25-62`) | 약관에 무관용 조항 + "신고 접수 후 24시간 내 검토·조치·해당 사용자 퇴출" 명시 → 앱 동의문 버전 올림 → 소셜 가입에도 동의 단계 | 대표(법무)+Claude(문안)+메인세션 |
| 1.2 — 신고·차단·연락처 | ⚠️(경미) | 신고 7종 ✅, 차단은 피드·DM만, 관리자 웹 신고 처리 ✅, 앱 내 연락처(설정 문의하기·푸터 이메일) ✅ | 곡 댓글·크루 채팅·유저 채널에 차단 추가 권장 | 메인세션 |
| 1.2 — 필터링 | ✅ | 금칙어 소통 경로 전 사용자 적용(`REPORT.md:3310`), 크루 게시판·채팅 적용 여부는 ❓ | 크루 경로 적용 여부만 확인 | 메인세션 |
| 5.1.1(v) 앱 내 계정 삭제 | ✅ | 마이페이지 → 설정 → 맨 아래 「회원탈퇴」 → "회원탈퇴" 입력 → DELETE `/auth/me`(`SettingsScreen.tsx:342-395, 727-760`). 애플 로그인 토큰 철회 훅 운영 반영(`INTEGRATIONS.md` 2장 10-11 배포) | 없음 | — |
| 5.1.1(i) 앱 내 개인정보 처리방침 | ⚠️ | 설정·푸터의 「개인정보 처리방침」이 실제 처리방침이 아니라 가입 동의문(`CONSENTS.privacy`)을 표시(`SettingsScreen.tsx:983-987`, `PolicySheet.tsx` CompanyFooter) | https://lotusai.co.kr/privacy · /terms 를 인앱 브라우저로 열도록 변경(약관도 동일) | 메인세션 |
| 5.1.2(i) 제3자 AI 전송 고지·동의 | ⚠️ | 텍스트(가사·이야기): 이메일 가입 시 국외이전 동의 ✅ — 소셜 가입자는 미동의(#1), Anthropic 누락(#3). 음성: 동의 화면 없음(#2). 사진: 확인 팝업에 "본인/동의 확인·학습 미사용"만 있고 Google·OpenAI 전송 고지 없음(`ArtistInputScreen.tsx:727-735`). 얼굴 셀피: 생체 동의 ✅(`FaceVerifyScreen.tsx`, AWS 도쿄 명시) | 음성·사진 첫 사용 시 `voice_ai`·`photo_ai` 동의 표시(사업자·국가 명시) + 서버 기록. 심사 메모 문구는 구현 후에 유지 | 메인세션 |
| 4.8 애플 로그인 위치 | ✅ | 모든 로그인 진입점이 `AuthPanel` → `SocialLoginButtons`(애플 버튼이 구글·카카오 위, `SocialLoginButtons.tsx:243-262`). 진입점: 로그인 모달(`LoginModalHost.tsx:110`), 설정 비로그인 화면(`SettingsScreen.tsx:1000`), 가입 화면(`AuthPanel.tsx:725`, 만14 미만이면 소셜 숨김) | 없음 | — |
| 애플 로그인 — 비공개 이메일 릴레이 | ⚠️ | 애플 "나의 이메일 가리기" 사용자는 `@privaterelay.appleid.com`. SES로 보내는 메일(비밀번호 재설정·공지)은 애플 개발자 계정에 발신 도메인 등록 전엔 전달 안 됨. 등록 기록 없음 | Certificates, IDs & Profiles → Services → Sign in with Apple for Email Communication → `maidol.ai.kr`(SES 발신 도메인)·발신 주소 등록, SPF/DKIM 통과 확인 | 대표(콘솔)+Claude(안내) |
| 2.1 완성도 — 미완성·테스트 문구 | ⚠️ | 「재생 엔진 테스트」(`SettingsScreen.tsx:973-981,1006-1014`), 「비밀번호 변경」「오픈소스 라이선스」→"준비 중인 기능입니다"(`:569-575, :682-687`), 코디 잠금 카테고리 "준비 중"(`ArtistCodyScreen.tsx:1063-1077`), "개별 삭제는 준비 중이에요"(`ArtistResultScreen.tsx:1312`), "저작권 등록 증빙 자료 생성 기능은 정식 프로모션 때 제공 예정"(`DialogueScreen.tsx:245`, `consentTexts.ts:231`), 만14 미만 가입 "보호자 동의 절차 준비 중"(`AuthPanel.tsx:571` — 현재 서버 플래그 OFF라 실제 노출) | 테스트 진입 삭제, 미구현 행 숨김(비밀번호 변경은 재설정 메일과 묶어 구현하거나 숨김, 라이선스는 화면 구현), 미래 기능 약속 문구 정리. 만14 미만 문구는 "현재 만 14세 미만은 가입할 수 없어요" 식으로 | 메인세션 |
| 2.1/2.2 — "베타" 노출 | ⚠️ | 앱 공유 문구 "베타 테스트 기간 가입 시 ⭐50 추가"(`AppShareModal.tsx:91`, `FeedCard.tsx:342`, `shareMessages.ts:118`), 별 내역 "베타 가입 추가"(`utils/starHistory.ts:13`, `utils/rewardNotice.ts:29`), 지원 URL 랜딩 "OPEN BETA 진행 중"·"App Store 출시 준비 중"(https://maidol.ai.kr/) | 베타 보너스 정책(~10-30)과 맞춰 "가입 이벤트" 등으로 교체(서버 상수·문구 함께 — 메모리 beta-signup-bonus-policy), 랜딩은 출시 후 스토어 배지로 | 메인세션+Claude(랜딩) |
| 2.3 스크린샷 규격 | ❓ | 로컬 `appstore_screenshots/` 6장이 1206×2622(6.3"). App Store Connect 필수 칸은 6.9"(1320×2868 또는 1290×2796) | ASC에 6.9" 칸이 채워져 있는지 확인(대표가 올린 파일이 다르면 무시) | 대표 |
| 2.3 메타데이터 정확성 | ⚠️ | 심사 메모 "녹음 전 별도의 음성 데이터 처리 동의를 받습니다"(`IOS_APPSTORE_LISTING.md` 8-2) — 현재 사실 아님(#2). "만 14세 미만은 보호자 동의 후에만 가입" — 소셜 우회 가능(#1) | #1·#2 반영 후 제출, 아니면 메모 수정 | 메인세션→Claude |
| 3.1 결제 | ✅ | 인앱 유료 결제 UI 없음. `components/PurchaseModal.tsx`("결제 시스템 준비 중")는 import 0건(사용 안 함). 외부 결제 링크 없음. 코디 상품 링크는 실물(의류)이라 IAP 대상 아님 | PG 연동(진행 중)이 ⭐ 판매라면 iOS는 IAP(또는 한국 외부결제 Entitlement), Play는 Play 결제(또는 한국 대체 결제 프로그램 등록) 필수 — 앱에서 PG로 ⭐ 판매 금지 | 대표(정책 결정) |
| 푸시 권한 요청 시점 | ✅ | 로그인 후 앱 내 「알림 받기」 안내 → OS 요청(`pushService.ts:199-205`) | 없음 | — |
| ATT | ✅/⚠️ | 문구 ✅(app.json `NSUserTrackingUsageDescription`). 요청 시점 = **앱 첫 실행 직후**(App.tsx:933 → `useRewardedSkipAd.ts:286-292`), 로그인·연령 확인 전 | 반려 사유는 아니나, 첫 광고 요청 직전(로그인 후·성인 확인 후)으로 미루면 어린이에게 ATT가 뜨지 않음 → 권장 | 메인세션 |
| App Privacy 영양성분표 | ⚠️ | 초안(`IOS_APPSTORE_LISTING.md` 7-1)에 "위치 수집 안 함". AdMob iOS 공시: IP로 대략적 위치, 성능 데이터, 제품 상호작용, 광고 데이터(https://developers.google.com/admob/ios/privacy/data-disclosure) | ASC에서 **대략적 위치(제3자 광고)**, **성능 데이터**를 추가했는지 확인. 기기 ID·광고 데이터는 추적 "예" | 대표 |
| 개인정보 매니페스트(PrivacyInfo.xcprivacy) | ✅/❓ | app.json에 `ios.privacyManifests` 없음 → Expo 템플릿 기본값 + 각 모듈 자체 매니페스트(node_modules 실측: async-storage, expo-application·constants·file-system·media-library·notifications, react-native 코어). GoogleMobileAds는 SDK 자체 포함 | 빌드 1.3.2(8) 업로드 후 애플이 "ITMS-91053 Missing API declaration" 메일을 보냈는지 확인. 왔으면 app.json에 해당 API 이유 코드 추가 | 대표(메일 확인)→메인세션 |
| 권한 문구 정확성 | ⚠️(경미) | 마이크 문구 "내 목소리로 노래를 만들기 위해…"만 — 작곡 「참고 음악 녹음」(`MusicGenerationScreen.tsx:1631`)도 마이크 사용 | "목소리 학습과 작곡용 참고 음악을 녹음할 때" 로 확장(app.json 4곳 동일 문구) | 메인세션 |
| 수출 규정 | ✅ | `ITSAppUsesNonExemptEncryption: false` | 없음 | — |
| NSUserTrackingUsageDescription | ✅ | app.json ios.infoPlist + 플러그인 3곳 동일 | 없음 | — |
| 13세 미만 소셜 차단(Declared Age Range) | ✅ | v3.331, 이미 완료 항목 | 실기기(TestFlight) 확인만 | 대표 |
| 앱 내 업데이트 안내(iOS) | ❓ | `ios.store_url` 빈값 | 출시 후 입력 | 메인세션 |

---

## 4. 공통

| # | 항목 | 상태 | 근거 | 해야 할 일 | 누가 |
|---|---|---|---|---|---|
| C-1 | 소셜 가입 동의·연령 확인 | ⚠️ | 1번 표 #1 | 소셜 신규 가입 직후 "동의(필수 4종) + 생년월일·성별·내외국인" 화면을 거쳐야 활성화(서버: 미완료 계정은 생성 API 403), 만14 미만이면 보호자 절차(현재 OFF → 가입 불가 안내). 기존 소셜 회원(나이 모름)은 다음 로그인 때 같은 화면 | 메인세션 |
| C-2 | 처리방침 vs 실제 — AI 사업자 | ⚠️ | 처리방침 제6조 표에 **Anthropic, PBC(미국)** 없음 (※정정: Replicate 는 사용자 데이터 미전송 — 기재 불필요. 개정안: PRIVACY_ART6_AMENDMENT_DRAFT.md). 실제 사용: Claude(캐릭터 텍스트·가사·번역), Replicate(헬스체크 active) | 제6조 표 추가 + 앱 국외이전 동의 목록 동기화(동의 버전 올리고 재동의) | 대표(법무)+Claude+메인세션 |
| C-3 | 처리방침 vs 실제 — 앱 동의 목록 | ⚠️ | 앱 `consentTexts.ts:105-112`(Google·OpenAI·SunoAPI·Kuaishou·fal·xAI 6곳) vs 처리방침 제6조(위 6 + Wondera·AWS 도쿄·AdMob). 가입자가 동의한 문안에 Wondera(트랙 오디오→미국) 없음 | 앱 동의문을 처리방침과 동일 목록으로 | 메인세션 |
| C-4 | 처리방침 vs 실제 — 푸시 경유지 | ⚠️ | 처리방침 "(주) 푸시 알림 토큰… 수집하지 않으며"(진행 중)에 더해, 푸시는 **Expo 푸시 서비스(650 Industries, 미국)** → FCM/APNs로 전달되며 알림 문구(닉네임·댓글 일부)가 함께 전송(`INTEGRATIONS.md` 2장) | 개정 시 "푸시 토큰 수집" + 국외이전 표에 Expo(미국)·Google FCM·Apple APNs 추가 | Claude(문안)+대표 |
| C-5 | 처리방침 vs 실제 — Firebase | ⚠️(경미) | 처리방침 "제3자 분석·크래시 SDK(Firebase Analytics, Sentry 등)를 사용하지 않습니다" — APK에 Firebase Messaging·Installations·datatransport 포함(매니페스트 172-179행). 분석 SDK는 아니지만 "Firebase" 이름이 들어간 문장이라 오해 소지 | "푸시 발송을 위해 Firebase Cloud Messaging을 사용하며 분석·크래시 SDK는 사용하지 않습니다"로 | Claude |
| C-6 | 처리방침 vs 실제 — 위탁(호스팅) | ⚠️ | 제5조 "국내 사업자에게 위탁하고 있지 않습니다" — 서버·DB·파일은 AWS(서울 EC2·S3), 얼굴 대조 AWS 서울(제6조 참고 문구에만 있음) | 제5조 위탁 표에 Amazon Web Services(서버·저장), (도입 시) AWS SES 추가 | 대표(법무)+Claude |
| C-7 | 처리방침 vs 실제 — 소셜 로그인 | ⚠️ | 처리방침 제2조②·앱 `consentTexts.ts:77`·계정삭제 페이지 모두 "네이버·카카오·구글" — 네이버는 v3.194 제거, 애플 없음(애플은 진행 중 항목, 네이버 잔존은 신규) | 세 곳 모두 "카카오·구글·애플" | Claude+메인세션 |
| C-8 | 처리방침 vs 실제 — 대략적 위치 | ⚠️(경미) | 처리방침 "(주) 위치정보… 수집하지 않으며" — AdMob이 IP로 대략적 위치 추정(위 공시) | "정밀 위치는 수집하지 않으나, 광고 SDK가 IP로 대략적 지역을 추정할 수 있음"으로 | Claude |
| C-9 | 처리방침 vs 실제 — SunoAPI 국가 | ❓ | 처리방침 제6조 SunoAPI.org 국가 "해외", 앱 동의문 "미국" | 국가 확정(법 제28조의8 필수 기재) | 대표 |
| C-10 | 마케팅 동의 문구 | ⚠️(경미) | `consentTexts.ts:139` "전송 매체: 이메일 (추후 앱 푸시 알림이 추가될 수 있으며…)" — 앱 푸시 도입됨 | 광고성 푸시를 보낼 계획이면 매체에 앱 푸시 추가(+야간 수신 별도 동의), 안 보내면 그대로 | 대표 |
| C-11 | 앱 접근권한 고지(정보통신망법 제22조의2) | ⚠️ | 앱에 "필수/선택 접근권한 안내" 화면·문구 없음(전체 검색 0건). 마이크·카메라·사진·알림은 모두 선택 권한 | 첫 실행(또는 설정 > 앱 정보)에 "선택 접근권한: 마이크(목소리 학습·참고 음악)·카메라(얼굴 인증)·사진(프로필·게시물·영상 저장)·알림 — 허용하지 않아도 이용 가능" 고지, 처리방침에도 항목 추가 | 메인세션+Claude |
| C-12 | 문의 이메일 잔존(운영) | ⚠️ | 로컬 앱 소스: 옛 주소 0건 ✅. **운영 중**: maidol.ai.kr 푸터 `kimpearl@lotusai.co.kr`(Cloudflare 난독화 해독), /delete-account `lotusai.official@gmail.com`(3곳), lotusai.co.kr/privacy 6곳·/terms 1곳, 초대 페이지 `kimpearl@`. 로컬 미반영 파일: `/Users/pearl/homepage/www/privacy/index.html:250,334,335,353,372,414`, `www/terms/index.html:408`, `www/index.html:350,378`, `www/about/index.html:253,294,302,325`, `www/news/index.html:249,259,288`, `homepage/maidol/app/index.html:94`(kimpearl), 서버 `server_staging_v3305/_orig/routes/referral.py:90,146`(=운영 초대 페이지), `server_staging_v3216/referral.py:90,146`·`set_referral_ssugsis.py:3,37`(과거 스테이징·스크립트, 배포 대상 아님) | 진행 중 작업에 lotusai.co.kr(www/)·maidol/app·초대 페이지까지 포함해 배포. 개인정보 보호책임자 연락처 변경은 처리방침 개정 공지와 함께 | Claude+메인세션(초대 페이지) |
| C-13 | 초대 랜딩(운영) 문구 | ⚠️ | https://api.maidol.ai.kr/invite/{code}: "베타 기간에는 등록된 테스터만 설치할 수 있어요 … 구글 계정을 … 보내주시면 테스터 등록" | 스토어 출시 시 Play·App Store 버튼으로 교체(서버 `referral.py`, `settings.play_store_url` + App Store URL) | 메인세션 |
| C-14 | 약관(웹) | ⚠️ | https://lotusai.co.kr/terms 200 ✅, 19개 조+부칙. 무관용 조항 없음(1.2), 앱 가입 시 보여주는 약관은 7-30판 축약 8개 조 — 동의 대상과 게시본 불일치 | 무관용 조항 추가 개정 공지(7일) + 앱 동의 화면은 게시본 전문 또는 링크 | 대표+Claude+메인세션 |
| C-15 | 지원 URL·연락 | ✅ | https://maidol.ai.kr/ 200, 문의·전화·주소 있음 | 랜딩 "OPEN BETA·출시 준비 중" 정리(3장 표) | Claude |
| C-16 | 계정 삭제 안내 페이지 | ⚠️(경미) | 위 2장 표 | 이메일·가입 방식 수정 배포 | Claude |
| C-17 | 배포 국가 | ❓🖊 | 동의·처리방침·광고 설정이 한국 법 기준. AdMob은 EEA·영국 사용자에게 인증 CMP(UMP) 필수인데 앱에 UMP 호출 없음(검색 0건) | 첫 출시는 **대한민국만** 선택 권장(양 스토어). 해외 확대 시 UMP·각국 연령 규제 별도 | 대표 |
| C-18 | 참고 음악 업로드 저작권 | ❓ | 작곡 「참고 음악」은 사용자가 임의 음원 업로드·녹음 → Suno 전송(`MusicGenerationScreen.tsx:1591-1631`). 상업 음원 업로드 시 IP 정책 문제 소지 | 업로드 화면에 "본인이 권리를 가진 음원만" 확인 문구(약관 제8조 연결) 권장 | 메인세션 |
| C-19 | 미사용 AI 연동 정리 | ❓ | `consentTexts.ts:3-4` "Sync Labs/LALAL.AI/Kits AI 미사용 — 오픈 전 비활성/제거해야 문구와 코드 일치", 관리자 헬스체크에 kits·sync passive 항목 존재(`REPORT.md:2897`) | 운영에서 해당 라우트가 실제로 꺼졌는지 확인(켜져 있으면 처리방침 기재 또는 제거) | 메인세션 |

---

## 5. 확인 방법 메모 (재현용)

- APK: `https://expo.dev/artifacts/eas/w5_VAFHpWj-…apk` 다운로드 → androguard 4.1.4 `get_android_manifest_axml()` 디코딩 → 매니페스트 확인 후 APK 삭제.
- 공개 페이지: curl 원문 → 태그 제거 텍스트, Cloudflare `data-cfemail` 해독으로 이메일 확인.
- 공개 API(무인증·읽기): `GET /api/auth/signup-config` → `{"guardian_consent_enabled":false}`, `GET /api/app/version`, `GET /invite/TEST1234`.
- Play 타겟 API 요건: developer.android.com target-sdk 페이지(2026-10-01 갱신). Play 사진·동영상 권한 정책: support.google.com/googleplay/android-developer/answer/14115180.
- 이 세션이 볼 수 없어 ❓로 둔 것: Play Console(계정 유형·IARC·기존 신고), App Store Connect(스크린샷 칸·App Privacy 입력값·ITMS 메일), 운영 서버 `.env`·라우트 실제 상태.
