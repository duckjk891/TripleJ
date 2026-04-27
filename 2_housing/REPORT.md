# REPORT - TripleJ 프론트엔드 개발 기록

---

## v2 - 2026-04-08 - 프론트엔드 API 연동 및 대화형 UI 구현

### 수정일자
2026-04-08

### 요청 작업
- 백엔드 API들과 연동되는 React Native 프론트엔드 UI 구현
- 디렉터와 대화 형태의 게임식 UI 구성
- 작사/작곡 플로우 전체 구현 (항목 22~27)
- Suno / Wondera 작곡가 선택 시스템
- 참고 레퍼런스 음악파일 업로드 및 녹음 기능

### 수행 결과

#### 1. 프로젝트 구조 설정
- **의존성 추가**: react-navigation, axios, zustand, expo-av, expo-document-picker, expo-file-system
- **폴더 구조**: screens(10), services(4), stores(3), types(1), dialogues(4) 생성

#### 2. 구현된 화면 (10개)
| 화면 | 파일 | 설명 |
|------|------|------|
| MapScreen | screens/MapScreen.tsx | 기존 타일맵 + 5명 디렉터 캐릭터 (리팩토링) |
| DialogueScreen | screens/DialogueScreen.tsx | RPG 스타일 대화 UI (타이핑 애니메이션, 선택지) |
| LyricsInputScreen | screens/LyricsInputScreen.tsx | 작사 입력 폼 (항목 22) |
| LyricsPromptReviewScreen | screens/LyricsPromptReviewScreen.tsx | 프롬프트 확인/수정 (항목 23) |
| LyricsLoadingScreen | screens/LyricsLoadingScreen.tsx | 가사 생성 대기 (항목 23.5) |
| LyricsResultScreen | screens/LyricsResultScreen.tsx | 가사 결과 확인/수정 (항목 24) |
| ComposerSelectScreen | screens/ComposerSelectScreen.tsx | 작곡가 소개/선택 (항목 25, 26) |
| MusicGenerationScreen | screens/MusicGenerationScreen.tsx | 작곡 입력 폼 (항목 27) |
| MusicLoadingScreen | screens/MusicLoadingScreen.tsx | 음악 생성 대기 |
| MusicResultScreen | screens/MusicResultScreen.tsx | 음악 결과 재생/저장 |

#### 3. API 서비스 레이어
| 서비스 | 연동 API |
|--------|----------|
| api.ts | Axios 인스턴스 (baseURL: http://localhost:8000/api) |
| lyricsService.ts | POST /generate/lyrics/ |
| musicService.ts | POST /generate/ (Suno), POST /wondera/generate (Wondera) |
| voiceService.ts | GET /kits/voice-models |

#### 4. 상태 관리 (Zustand)
- lyricsStore: 장르, 분위기, 가사내용, 템포, 언어, 곡길이, 랩 유무, 생성 상태
- musicStore: 모델 선택, 가사, 장르, 보컬, 레퍼런스 파일, 생성 상태
- dialogueStore: 대화 스크립트 관리

#### 5. 항목별 구현 확인

| 항목 | 요구사항 | 상태 |
|------|----------|------|
| 22 | 작사 API 프롬프트 Input (장르/분위기/가사/템포/언어/곡길이/랩) | OK |
| 23 | 프롬프트 확인/수정 창 | OK |
| 23.5 | 가사 생성 대기시간 | OK |
| 24 | 가사 확인/수정 (텍스트 수정 형태) | OK |
| 25 | Suno/Wondera 선택 + 캐릭터 2개 | OK |
| 26 | 작사 디렉터 작곡가 소개 장면 | OK |
| 27 | 작곡 Input (가사/장르/템포/보컬/스타일/내목소리/업로드/녹음) | OK |

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| 파일 구조 (22개 파일) | PASS |
| TypeScript 컴파일 (0 에러) | PASS |
| Expo Doctor (17/17) | PASS |
| 기능 완전성 (항목 22~27) | PASS |
| 네비게이션 플로우 | PASS |
| API 연동 설정 | PASS |

### 특이사항
- 최초 테스트에서 녹음 기능 미구현 발견 → expo-av Recording API로 즉시 보완 완료
- Suno/Wondera 작곡가는 맵에 직접 배치하지 않고 ComposerSelectScreen에서 카드 선택 방식으로 구현 (맵 변경 최소화)
- voiceService.ts와 musicService.ts에 getVoiceModels 중복 존재 (향후 정리 필요)
- 기존 Character.tsx, SpriteAnimator.tsx는 변경 없이 유지

---

## v3 - 2026-04-09 - UI 개선 및 대화형 인터페이스

### 수정일자
2026-04-09

### 요청 작업
1. 스플래시 로딩 화면 추가
2. 탭 네비게이션 구조 (플레이리스트 + 작업실)
3. 디렉터 배치 수정 (2번 방: 작사, 3번 방: 작곡)
4. 비활성 방 잠금 처리 (아티스트, 영상 → 반투명 회색 + 자물쇠)
5. 대화 UI 재디자인 (흰색 글상자, 디렉터 상단 배치, 맵 배경 투영)
6. 작사 입력을 대화형 단계별 인터페이스로 변경

### 수행 결과

#### 1. 스플래시 화면 (SplashScreen.tsx)
- "TripleJ" 타이틀 + fade/scale 애니메이션
- 2.5초 후 자동으로 메인 탭 이동

#### 2. 탭 네비게이션
- PlaylistScreen (플레이리스트 탭, 기본 선택)
- StudioNavigator (작업실 탭, 기존 맵 + 전체 스택)
- Bottom tabs: 다크 테마, #e94560 활성 색상

#### 3. 디렉터 배치
- 2번 방 (y=660): composer → lyricist 수정
- 3번 방 (y=980): lyricist → composer 수정

#### 4. 잠긴 방
- Artist(1번), Video(5번) 방에 반투명 회색 오버레이 + 🔒 아이콘
- 탭 시 "아직 준비 중인 서비스입니다." Alert 표시

#### 5. 대화 UI 재디자인
- 흰색 글상자 (#f5f5f5), 검은 텍스트
- 디렉터 초상화 대형 (200px), 하단 우측 배치
- 맵 배경 반투명 투영 (transparent modal)
- 해당 방 포커스 효과 (상하 어둡게 처리)
- directorY 파라미터로 방 위치 전달

#### 6. 대화형 작사 입력
- 7단계 순차 대화: 장르 → 분위기 → 내용 → 템포 → 언어 → 길이 → 랩
- 채팅 히스토리 (디렉터: 흰색 버블, 유저: 빨간 버블)
- 번호 선택지 + 직접 입력 옵션
- 완료 후 자동으로 프롬프트 리뷰 화면 이동

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 스플래시 화면 | PASS |
| 탭 네비게이션 | PASS |
| 디렉터 배치 | PASS |
| 잠긴 방 | PASS |
| 대화 UI | PASS |
| 대화형 작사 입력 | PASS |

### 특이사항
- @react-navigation/bottom-tabs 의존성 추가
- 기존 Character.tsx, SpriteAnimator.tsx 변경 없이 유지
- 기존 서비스/스토어/기타 화면 모두 정상 동작

---

## v4 - 2026-04-10 - UI 버그 수정 및 디렉터 이미지 교체

### 수정일자
2026-04-10

### 요청 작업
1. 잠긴 방 제거
2. 디렉터 초상화 교체 (3D 캐릭터 이미지)
3. 대화 화면 맵 배경 수정
4. 네트워크 에러 수정
5. 하단 탭 바 위치 조정
6. 키보드에 가려지는 입력창 수정
7. 프롬프트 요약 항목 클릭 수정

### 수행 결과

#### 1. 잠긴 방 제거
- MapScreen에서 LOCKED_TYPES, LOCKED_ROOMS, 잠금 오버레이 코드 전체 삭제
- 모든 방 디렉터 클릭 시 대화 화면으로 정상 이동

#### 2. 디렉터 초상화 교체
- image (2).png 를 Python PIL로 5개 개별 이미지로 분할
- assets/portraits/ 내 5개 파일 교체 완료
- 작사(비즈니스 우먼), 작곡(비니 남성), 아티스트(핑크머리), 이미지(안경 여성), 영상(카메라맨)
- DialogueScreen에서 얼굴~상반신 크게 표시 (180x320px, resizeMode: contain)

#### 3. 대화 화면 맵 배경
- transparent modal 대신 맵 이미지를 DialogueScreen 내부에 직접 렌더링
- 디렉터의 방 위치 기준으로 맵 스크롤 오프셋 계산
- 상하 어두운 오버레이로 방 포커스 효과 유지

#### 4. 네트워크 에러 수정
- api.ts에서 expo-constants의 debuggerHost로 개발 서버 IP 자동 감지
- Android 에뮬레이터: 10.0.2.2, iOS 시뮬레이터: localhost, 실제 기기: 자동 감지

#### 5. 하단 탭 바 위치
- Tab bar height: 80→90, paddingBottom: 20→30으로 조정
- iPhone 홈 인디케이터와 겹치지 않도록 수정

#### 6. 키보드 가림 수정
- LyricsInputScreen: keyboardVerticalOffset 0→90 (iOS)
- LyricsPromptReviewScreen: 동일하게 적용

#### 7. 프롬프트 요약 수정
- SummaryItem을 TouchableOpacity로 감싸서 클릭 가능
- 클릭 시 하단 Modal로 옵션 목록 표시
- 장르/분위기/템포/언어: 선택지 + 직접 입력
- 곡 길이: 프리셋 선택
- 랩: Switch 토글
- 수정 후 자동으로 프롬프트 텍스트 재생성

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 잠긴 방 제거 | PASS |
| 초상화 교체 | PASS |
| 맵 배경 표시 | PASS |
| API URL 자동 감지 | PASS |
| 탭 바 위치 | PASS |
| 키보드 가림 | PASS |
| 요약 항목 수정 | PASS |

### 특이사항
- expo-constants 의존성 추가 (API URL 자동 감지용)
- 기존 Character.tsx, SpriteAnimator.tsx 변경 없이 유지

---

## v5 - 2026-04-10 - 디렉터 이미지 재배치, 방 포커싱, 탭 확장, 로그인

### 수정일자
2026-04-10

### 요청 작업
1~8번 항목 (디렉터 이미지 순서, 캐릭터 표시, 방 포커싱, 탭 아이콘, 네트워크, 누락 기능, + 버튼, 로그인/DB)

### 수행 결과

#### 1. 디렉터 이미지 순서 수정
- 왼쪽부터: 아티스트(금발), 작곡(비니), 이미지(핑크), 작사(안경), 영상(카메라)
- Python PIL로 5개 이미지 재분할

#### 2. 대화 배경에 캐릭터 스프라이트 표시
- DialogueScreen에 Character 컴포넌트 import
- 맵 이미지 위에 5명의 디렉터 스프라이트 렌더링

#### 3. 방 포커싱 정확도 수정
- ROOM_BOUNDS 매핑으로 TMX 실제 좌표 사용
- 각 방의 정확한 top/bottom 좌표로 오버레이 계산

#### 4. 탭 바 아이콘 위치
- paddingBottom: 28, paddingTop: 8, tabBarIconStyle marginBottom 조정

#### 5. 네트워크 에러 디버깅
- 멀티 폴백 전략: globalThis → expo-constants → 플랫폼별 기본값
- console.log로 API base URL 출력
- 응답 에러 인터셉터 추가

#### 6. 누락 기능 추가
- ChartScreen (차트/TOP100)
- MyMusicScreen (마이뮤직 - 로그인 연동)
- SettingsScreen (설정 - 로그인/회원가입/프로필)
- 총 5개 탭: 플레이리스트, 차트, 작업실, 마이뮤직, 설정

#### 7. 플레이리스트 + 버튼
- 우하단 플로팅 버튼 추가
- 탭하면 마이뮤직 탭으로 이동

#### 8. DB 확인 및 로그인 구현
- DB: PostgreSQL, MongoDB, Redis, MinIO (docker-compose.yml 확인)
- authStore.ts: 로그인/회원가입/로그아웃 Zustand 스토어
- API: POST /auth/login, POST /auth/register 연동

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 디렉터 이미지 순서 | PASS |
| 캐릭터 스프라이트 | PASS |
| 방 포커싱 | PASS |
| 탭 아이콘 위치 | PASS |
| 네트워크 디버깅 | PASS |
| 5개 탭 구성 | PASS |
| + 버튼 | PASS |
| 로그인/회원가입 | PASS |

### 특이사항
- 신규 파일: ChartScreen.tsx, MyMusicScreen.tsx, SettingsScreen.tsx, authStore.ts
- 백엔드 DB는 이미 docker-compose로 구성 완료 (0_platform_music/backend/)
- 네트워크 문제는 백엔드 서버가 실행 중이어야 확인 가능

---

## v6 - 2026-04-10 - UI 레이아웃 수정, 탭 정리, AdMob 타이머

### 수정일자
2026-04-10

### 요청 작업
1. DialogueScreen 레이아웃 5가지 수정
2. 탭 5개 → 3개 + 설정 상단 아이콘
3. 플레이리스트 DB 연동
4. AdMob 대기 타이머

### 수행 결과

#### 1. DialogueScreen 레이아웃 수정
- 캐릭터 스프라이트 z-index를 오버레이 아래로 (zIndex: 1 vs 2)
- 디렉터 이름 위치: 대화창 바로 위 (bottom: 145, left: 16)
- 방 포커싱: 벽 포함하도록 top 경계 96px 상향 확장
- 대화창 하단 간격: marginBottom 40 → 8
- 초상화 위치: bottom 140 → 100

#### 2. 탭 구조 정리
- 차트/설정 탭 제거 → 3개 탭: 플레이리스트, 작업실, 마이뮤직
- 설정은 RootStack에 modal로 추가
- 플레이리스트/마이뮤직 헤더에 ⚙ 아이콘으로 설정 접근
- 탭 바 높이 축소 (85 → 60), 아이콘 위치 상향

#### 3. 플레이리스트 DB 연동
- GET /tracks/ API 호출하여 곡 목록 표시
- 로딩 스피너, 빈 상태, 곡 리스트 UI 구현
- 백엔드 미실행 시 빈 상태 표시

#### 4. AdMob 대기 타이머 시스템
- WaitTimerScreen.tsx 신규 생성
- 5시간 카운트다운 타이머
- 광고 시청 시 30분 단축 (현재 mock, 추후 AdMob 연동)
- 디렉터 초상화 + 스프라이트 표시
- 펄스 애니메이션 광고 버튼
- 작사/작곡 생성 시 WaitTimer를 거쳐 Loading으로 이동
- 테스트용 건너뛰기 버튼 포함

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| DialogueScreen 레이아웃 | PASS |
| 3개 탭 + 설정 아이콘 | PASS |
| 플레이리스트 데이터 | PASS |
| 대기 타이머 시스템 | PASS |

### 특이사항
- react-native-google-mobile-ads 설치됨 (네이티브 빌드 필요, Expo Go에서는 mock 사용)
- AdMob 실제 연동은 `eas build` 후 가능
- ChartScreen.tsx는 더 이상 탭에 없지만 파일은 유지 (향후 재사용 가능)

---

## v7 - 2026-04-10 - 탭 바 반응형 + AdMob 실제 적용

### 수정일자
2026-04-10

### 수행 결과

#### 1. 탭 바 반응형 Safe Area 적용
- tabBarStyle에서 height, paddingBottom, paddingTop, tabBarIconStyle 하드코딩 전부 제거
- @react-navigation/bottom-tabs의 기본 SafeArea 처리에 위임
- iOS: SafeAreaInsets.bottom 자동 적용 (홈 인디케이터 위에 탭 배치)
- Android: NavigationBar 높이 자동 반영

#### 2. AdMob 보상형 광고 실제 적용
- app.json에 AdMob 플러그인 설정 (androidAppId, iosAppId 플레이스홀더)
- WaitTimerScreen에서 RewardedAd 동적 import (try-catch)
- 네이티브 빌드 시: 실제 보상형 광고 로드 → 시청 → EARNED_REWARD → 시간 단축
- Expo Go에서: 자동 폴백으로 mock 광고 (3초 대기)

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 탭 바 SafeArea | PASS |
| AdMob 통합 | PASS |

### 특이사항
- AdMob 실제 동작을 위해서는 아래 사용자 작업이 필요 (하단 안내 참조)

---

## v8 - 2026-04-10 - 방 포커싱 수정, 맵 타이머, 탭 아이콘

### 수정일자
2026-04-10

### 수행 결과

#### 1. 방 포커싱 수정
- ROOM_BOUNDS top 값 조정: 벽 포함하되 넘어가지 않도록
- artist: 160, lyricist: 480, composer: 800, image: 1120, video: 1440

#### 2. 타이머 → 맵 위 상태바
- WaitTimerScreen 제거, timerStore.ts 신규 생성 (Zustand)
- 맵에서 1초 간격으로 tick() 호출하여 카운트다운
- 디렉터 스프라이트 상단에 상태바 표시 ("작사 중 · 4시간 59분")
- 타이머 진행 중 클릭 → Alert로 광고 시청 제안 (30분 단축)
- 타이머 완료 시 클릭 → Loading 화면으로 이동
- LyricsPromptReview, MusicGeneration에서 생성 시 → Map으로 돌아가며 타이머 시작

#### 3. 탭 아이콘 변경
- 플레이리스트: ☰ (리스트)
- 작업실: ⚒ (작업)
- 마이뮤직: ♪ (음표)
- tabBarIconStyle marginTop: 2 추가

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 방 포커싱 | PASS |
| 맵 타이머 | PASS |
| 탭 아이콘 | PASS |

---

## v9 - 2026-04-10 - AdMob ID, 상태바 개선, 방 포커싱 정밀화

### 수정일자
2026-04-10

### 수행 결과

#### 1. AdMob ID 적용
- app.json: iOS App ID `ca-app-pub-1425041551318467~5404280238`
- app.json: Android App ID `ca-app-pub-1425041551318467~9961638197`
- MapScreen: iOS 광고 단위 `ca-app-pub-1425041551318467/8070806176`
- MapScreen: Android 광고 단위 `ca-app-pub-1425041551318467/1283416835`
- Platform.select()로 OS별 자동 분기

#### 2. 상태바 디자인 개선
- 크기 확대: width 140→180, fontSize 9→11
- 2줄 표시: "작사 진행 중" + "4시간 59분 남음"
- 테두리 + 그림자 추가 (borderWidth, shadow, elevation)
- 하단 삼각형 화살표로 디렉터 지시
- 완료 시 녹색 배경 + ✓ 표시

#### 3. 방 포커싱 정밀화
- TMX 걸레받이(baseboard) 레이어 분석으로 정확한 벽 위치 파악
- Row 6,16,26,36,46에 baseboard → 각 방 상단 벽은 2행 위
- artist: 128-480, lyricist: 448-800, composer: 768-1120, image: 1088-1440, video: 1408-1760

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| AdMob ID | PASS |
| 상태바 디자인 | PASS |
| 방 포커싱 | PASS |

---

## v10 - 2026-04-10 - 네트워크, 대화 개선, 프로그레스바, 얼굴 크롭

### 수정일자
2026-04-10

### 수행 결과

#### 1. 네트워크 설정
- 0_platform_music/backend/.env 생성 (localhost → 192.168.219.106)
- api.ts 최종 폴백 URL도 192.168.219.106으로 변경

#### 2. 작사 대화 개선
- 정리.md 기반 7단계: 장르 → 분위기 → 보컬 → 가사내용 → 스타일설명 → 참고스타일 → 언어
- 프롬프트 템플릿: Suno 규격에 맞게 보컬/스타일/참고 포함
- 마지막 질문 버그 수정: setStep(nextStep) 즉시 호출 → isComplete=true로 선택박스 제거

#### 3. 프로그레스 바 + 광고 팝업
- 뱃지 → 프로그레스 바로 변경 (배경 바 + 채움 바)
- 라벨 + 바 + 남은 시간 3줄 표시
- 클릭 시 팝업: "시간을 단축하고 싶나요? 아래 버튼을 클릭해보세요!"

#### 4. AdMob 연결
- iOS/Android 광고 단위 ID 확인 완료
- eas build 완료 상태이므로 development client에서 실제 광고 테스트 가능

#### 5. 얼굴 크롭
- LyricsInputScreen: 36x36 원 안에 36x72 이미지 (top:0 → 얼굴 표시)
- LyricsPromptReviewScreen: 60x60 원 안에 60x120 이미지 (top:0 → 얼굴 표시)

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| .env 네트워크 | PASS |
| 대화 질문 | PASS |
| 마지막 질문 버그 | PASS |
| 프로그레스 바 | PASS |
| 얼굴 크롭 | PASS |

---

## v12 - 2026-04-10 - 차트/플레이리스트, 대기번호, 커스텀 팝업

### 수정일자
2026-04-10

### 수행 결과

#### 1. 차트 탭 (ChartScreen)
- GET /charts/top100 호출하여 곡 목록 표시
- 랭킹 번호 (1~3위 금/은/동), 커버 이미지, 곡명, 아티스트, 재생수/좋아요
- 하트 토글 버튼, pull-to-refresh
- 탭 순서: 차트 → 플레이리스트 → 작업실 → 마이뮤직

#### 2. 플레이리스트 탭 (PlaylistScreen)
- GET /playlists/ 호출 (인증 필요)
- 미로그인 시 "로그인이 필요합니다" 표시
- 플레이리스트 카드 + 트랙 수 표시

#### 3. 대기번호 시스템
- 시간(초) → 대기번호(#80~150) 개념 변경
- 30초마다 대기번호 1 감소
- 광고 시청 시 10~20 감소
- 대기번호 0 → 작업 완료

#### 4. 커스텀 인앱 팝업
- Alert.alert → Modal 기반 게임 스타일 팝업
- 디렉터 초상화 + 대기번호 배지 + 광고 버튼
- ✕ 닫기 버튼, 다크 테마 디자인

#### 5. 맵 상태바
- 프로그레스 바 → 대기번호 표시 ("작사 대기 중 #127")
- 완료 시 녹색 "완료!" 표시

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 차트 탭 | PASS |
| 플레이리스트 탭 | PASS |
| 대기번호 시스템 | PASS |
| 커스텀 팝업 | PASS |

---

## v13 - 2026-04-10 - 토글 높이 고정, 작사 인증 에러 수정

### 수정일자
2026-04-10

### 요청 작업
1. PlayerScreen 가사·상세정보 토글 탭 전환 시 높이 고정
2. 작사 완료 시 /generate/lyrics/ 401 인증토큰 에러 수정

### 수행 결과

#### 1. 토글 높이 고정 (PlayerScreen.tsx)
- `sheetContainer` 스타일에서 `maxHeight: '70%'` + `minHeight: '50%'` 제거
- `height: '70%'`로 고정하여 가사/프롬프트/상세정보 탭 전환 시 높이 일정하게 유지

#### 2. 인증 토큰 에러 수정 (api.ts)
- `useAuthStore` import 추가
- axios 요청 인터셉터 추가: 매 요청마다 `useAuthStore.getState().token`을 읽어 `Authorization: Bearer {token}` 헤더 자동 첨부
- 백엔드 확인: `/generate/lyrics/` 엔드포인트는 `Depends(get_current_user)`로 인증 필수 + Redis 세션 검증

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (0 에러) | PASS |
| sheetContainer height 고정 | PASS |
| 요청 인터셉터 토큰 첨부 | PASS |
| 순환 참조 안전성 (Zustand getState) | PASS |

### 특이사항
- api.ts ↔ authStore.ts 간 순환 참조 존재하나, Zustand의 `getState()` 패턴으로 안전 (요청 시점에 동기 호출)
- 백엔드 인증은 JWT + Redis 세션 이중 검증 구조 (토큰 만료 시 403, 세션 만료 시 401)

---

## v14 - 2026-04-10 - UI 개선, 대화형 작곡, 에러 수정

### 수정일자
2026-04-10

### 요청 작업
1. 토글 위치 하단 이동
2. 탭바 아이콘 플레인 변경 + 설정 아이콘 변경
3. 로딩 텍스트 + 얼굴 크롭 수정 (5개 화면)
4. 작곡 화면 대화형 전환 + lyricsStore 데이터 연동
5. 작곡 에러 수정 (422 + render error)
6. 오디오 스트림 URL 확인

### 수행 결과

#### 1. 토글 위치 하단 이동 (PlayerScreen.tsx)
- `swipeUpButton` 스타일을 `position: 'absolute'`, `bottom: 0`으로 변경
- 화면 최하단에 고정 배치

#### 2. 탭바 아이콘 변경 (App.tsx)
- 차트: 📋 → ☰, 플레이리스트: 🎧 → ♬, 작업실: 🎹 → ✦, 마이뮤직: ♪ 유지
- 설정 아이콘: ⚙ → ⋮ (3개소)

#### 3. 얼굴 크롭 + 로딩 텍스트
- 5개 화면 포트레이트에 overflow:hidden 컨테이너 + 3배 높이 이미지 적용
  - LyricsLoadingScreen: 120x360 in 120x120
  - LyricsPromptReviewScreen: 60x180 in 60x60
  - ComposerSelectScreen: 60x180 + 70x210
  - MusicResultScreen: 60x180 + 140x420
- 로딩 텍스트: "AI가 생성" → "작사 디렉터가 가사를 생성하고 있습니다"

#### 4. 작곡 화면 대화형 전환 (MusicGenerationScreen.tsx)
- 폼 레이아웃 → 5단계 대화형 채팅 UI로 전면 리라이트
- 단계: 가사 확인 → 장르 → 분위기 → 보컬 → 레퍼런스
- lyricsStore에서 장르/분위기/가사 자동 프리필
- 채팅 히스토리 (디렉터: 좌측 버블, 유저: 우측 빨간 버블)
- 파일 업로드/녹음 기능 유지

#### 5. 작곡 에러 수정
- musicService.ts: `prompt` 필드 구성하여 전송 (422 해결)
- MusicResultScreen.tsx: `store.error` typeof 체크 + JSON.stringify 폴백

#### 6. 오디오 스트림 URL
- PlayerScreen.tsx: `http://192.168.219.106:9000/api/tracks/stream-proxy/${track.id}` 확인 완료

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (0 에러) | PASS |
| 토글 위치 | PASS |
| 탭바 아이콘 | PASS |
| 얼굴 크롭 (5개 화면) | PASS |
| 로딩 텍스트 | PASS |
| 대화형 작곡 화면 | PASS |
| 작곡 prompt 전송 | PASS |
| 에러 렌더링 | PASS |

### 특이사항
- MusicGenerationScreen 전면 리라이트: LyricsInputScreen 패턴 참고한 대화형 UI
- 작곡 디렉터 이미지: 현재 composer_director.png 사용, 추후 교체 예정
- Wondera 작곡가 이미지: 현재 image_director.png로 대체 사용 중

---

## v15 - 2026-04-10 - 마이뮤직, 로그인 리다이렉트, 설정 확장, 플레이어 아이콘

### 수정일자
2026-04-10

### 요청 작업
1. 마이뮤직 곡 보관
2. 로그인 후 차트 이동
3. 설정창 기능 추가
4. 재생/일시정지 아이콘 변경
5. 토글 위치 반응형

### 수행 결과

#### 1. 마이뮤직 곡 보관 (MyMusicScreen.tsx)
- `GET /tracks/my` API 연동으로 사용자 생성 곡 목록 표시
- FlatList + 커버이미지/제목/장르/무드/재생수/좋아요/생성일 표시
- Pull-to-refresh, 로딩 스피너, 빈 상태 처리
- 곡 탭 시 PlayerScreen으로 이동

#### 2. 로그인 후 차트 이동 (SettingsScreen.tsx)
- 로그인/회원가입 성공 시 `navigation.goBack()` 호출
- Settings 모달이 닫히면서 MainTabs(차트 탭)로 복귀

#### 3. 설정창 기능 추가 (SettingsScreen.tsx)
- 4개 섹션 추가: 계정 관리(닉네임/비밀번호), 알림 설정(2개 Switch), 앱 정보(버전/약관/라이선스), 기타(캐시/문의)
- ScrollView로 전환하여 스크롤 지원
- 로그아웃 버튼 최하단 배치

#### 4. 재생/일시정지 아이콘 (PlayerScreen.tsx)
- ⏮ → ◁◁, ⏸ → ❚❚, ⏭ → ▷▷
- ▶(재생) 유지

#### 5. 토글 반응형 배치 (PlayerScreen.tsx)
- `position: absolute` 제거, `marginTop: 'auto'`로 flex 하단 배치
- SafeAreaView 적용으로 시스템 UI 영역 내 자동 배치

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (0 에러) | PASS |
| 마이뮤직 API 연동 | PASS |
| 로그인 후 화면 전환 | PASS |
| 설정 섹션 추가 | PASS |
| 플레이어 아이콘 | PASS |
| 토글 반응형 배치 | PASS |

### 특이사항
- 마이뮤직 데이터는 `GET /api/tracks/my` 엔드포인트 사용 (인증 필요)
- 설정 기능 중 닉네임/비밀번호 변경은 placeholder (백엔드 API 추가 필요)
- 알림 설정은 로컬 state만 (실제 푸시 알림 연동은 추후)

---

## v16 - 2026-04-11 - 마이뮤직 작사, 토글 위치, 아이콘 통일, 작곡 성별

### 수정일자
2026-04-11

### 요청 작업
1. 마이뮤직에 작사 기록 표시
2. 토글 위치 올림
3. 플레이어 아이콘 통일
4. 디렉터 얼굴 크롭 점검
5. 작사 없으면 작곡 차단
6. 작곡 보컬 성별 단계 추가

### 수행 결과

#### 1. 마이뮤직 작사 기록 (MyMusicScreen.tsx)
- lyricsStore 연동하여 "작사 기록" 섹션 추가
- 장르/분위기 태그 + 가사 미리보기 (4줄) 표시
- 트랙 리스트 상단에 배치

#### 2. 토글 위치 (PlayerScreen.tsx)
- `marginTop:'auto'` 제거 → `marginTop: 20` 고정
- header paddingTop: 56 → 16 (SafeAreaView가 처리)
- coverArt: 250 → 220, 여백 축소
- 전체 콘텐츠가 SafeArea 내 자연 배치

#### 3. 플레이어 아이콘 (PlayerScreen.tsx)
- 텍스트 아이콘(◁◁, ❚❚, ▷▷) → View+border 기반 CSS 삼각형/막대 도형
- 이전/다음: 2개 삼각형, 재생: 큰 삼각형, 일시정지: 2개 세로 막대
- 크기/굵기/정렬 완전 통일

#### 4. 얼굴 크롭 (LyricsResultScreen.tsx)
- portrait 60x60 → portraitContainer(overflow:hidden) + portraitImage(60x180)

#### 5. 작곡 차단 (ComposerSelectScreen.tsx)
- `handleSelect`에서 `lyricsStore.generatedLyrics` 또는 `musicStore.lyrics` 확인
- 없으면 Alert "먼저 작사 디렉터에게 가사를 만들어주세요!"

#### 6. 작곡 보컬 성별 (MusicGenerationScreen.tsx)
- 6단계 대화: 가사→장르→분위기→보컬ON/OFF→보컬성별→레퍼런스
- VOCAL_GENDERS: 남성/여성/혼성 보컬
- 보컬 OFF 시 성별 단계 자동 건너뛰기
- handleGenerate에서 musicStore.setVocal(성별) 설정

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (0 에러) | PASS |
| 토글 위치 | PASS |
| 플레이어 아이콘 | PASS |
| 마이뮤직 작사 기록 | PASS |
| 얼굴 크롭 | PASS |
| 작곡 차단 | PASS |
| 보컬 성별 단계 | PASS |

### 특이사항
- 작사 기록은 lyricsStore (로컬 상태) 기반이므로 앱 재시작 시 초기화됨
- 추후 백엔드에 작사 이력 저장 API 추가 시 영구 보관 가능
- 보컬 OFF 선택 시 성별 단계가 자동 스킵되어 5→레퍼런스로 이동

---

## v17 - 2026-04-11 - 플레이어 레이아웃 복원, 인증 토큰 순환참조 수정

### 수정일자
2026-04-11

### 요청 작업
1. PlayerScreen 레이아웃 복원
2. 작사 401 인증에러 재발 수정

### 수행 결과

#### 1. PlayerScreen 레이아웃 복원
- header paddingTop: 16 → 56 (원래 값)
- coverArt: 220 → 250 (원래 값)
- trackInfoContainer marginTop: 20 → 32
- progressContainer marginTop: 20 → 32
- actionsRow marginTop: 16 → 32
- swipeUpButton marginTop: 20 유지 (하단 토글만 적절한 위치)

#### 2. 인증 토큰 순환참조 수정
- **원인**: api.ts ↔ authStore.ts 순환 참조로 인해 `useAuthStore`가 요청 인터셉터 시점에 undefined
- **해결**: 순환 참조 완전 제거
  - api.ts: `useAuthStore` import 제거, 대신 모듈 레벨 `_authToken` 변수 + `setAuthToken()` export
  - authStore.ts: `setAuthToken()` 함수를 import하여 login/register/logout 시 토큰 동기화
  - 인터셉터는 `_authToken` 변수를 직접 읽어 헤더에 첨부

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (0 에러) | PASS |
| PlayerScreen 레이아웃 | PASS |
| 인증 토큰 설정 | PASS |

### 특이사항
- 순환 참조 제거로 모듈 초기화 순서에 의존하지 않는 안정적 토큰 관리
- `setAuthToken()`은 api.defaults.headers와 인터셉터 변수 모두에 동기화

---

## v19 - 2026-04-11 - 방 포커싱 정밀화, SafeArea 전체 적용

### 수정일자
2026-04-11

### 수행 결과

#### 1. 방 포커싱 정밀화 (DialogueScreen.tsx)
- TMX 파일 재분석: 각 방 12타일(384px), 벽 제외
- ROOM_BOUNDS 수정: artist(128-512), lyricist(512-896), composer(896-1280), image(1280-1664), video(1664-2048)
- 디렉터 위치도 각 방 중앙으로 재계산

#### 2. SafeArea 전체 적용
- App.tsx: `SafeAreaProvider` 래핑
- 9개 화면: `useSafeAreaInsets` 적용, `paddingTop: 60` → `insets.top + 16` 동적 계산
- 대상: LyricsInput, LyricsPromptReview, LyricsResult, ComposerSelect, ComposerInput, MusicGeneration, MusicResult, MyMusic, Settings

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |

### 특이사항
- MapScreen은 전체화면이므로 SafeArea 미적용
- 노치/다이나믹 아일랜드 디바이스에서도 상단 안전 영역 자동 대응

---

## v20 - 2026-04-11 - 작곡 파라미터 확장, 곡 결과 URL 수정

### 수정일자
2026-04-11

### 수행 결과

#### 1. 작곡 파라미터 전체 적용
- **MusicGenerationScreen**: 6단계 → 9단계 대화로 확장
  - Step 5: 스타일 설명 (자유 텍스트, 건너뛰기 가능)
  - Step 6: 참고 스타일 (자유 텍스트, 건너뛰기 가능)
  - Step 7: 고급 설정 (BPM, 키, 제외 스타일 - 모두 선택사항)
- **musicStore.ts**: style, referenceStyle, bpm, musicalKey, negativeTags 필드 추가
- **types/index.ts**: MusicParams 타입 확장
- **musicService.ts**: 프롬프트 빌더 개선 + API 요청에 style, reference_style, bpm, key, negative_tags 전달

#### 2. 곡 결과 URL 수정
- **MusicLoadingScreen.tsx**: 
  - 폴링 완료 시 result_track_id → stream-proxy URL 변환
  - localhost/minio URL → 실제 IP(192.168.219.106) 자동 치환
- **MusicResultScreen.tsx**: 
  - loadAudio에서 URL 변환 안전장치 추가
  - 디버그 로그 추가

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |

### 특이사항
- 스타일/참고스타일/고급설정은 모두 건너뛰기 가능 (필수 아님)
- BPM은 숫자 키보드로 입력, 키는 칩 선택 UI
- URL 변환은 localhost, 127.0.0.1, minio:9000 패턴을 모두 처리

---

## v21 - 2026-04-14 - 곡 완성 후 오디오 미표시 및 저장 미작동 버그 수정

### 수정일자
2026-04-14

### 요청 작업
작사 → 작곡 완료 후 "곡이 완성됐어요!" 화면에서 생성된 곡이 보이지 않고, 마이뮤직에도 나타나지 않는 문제 수정

### 원인
1. **필드명 불일치**: 백엔드는 `result_audio_url`을 반환하지만, 프론트엔드(`MusicLoadingScreen`)는 `audio_url`, `result_url`, `url`, `output_url`만 검사 → `resultUrl`이 빈 문자열이 되어 플레이어/저장 버튼 미렌더링
2. **가짜 저장 함수**: `handleSave()`가 Alert만 표시하고 실제 DB 저장 API 미호출 → 트랙이 `tracks` 컬렉션에 저장되지 않아 마이뮤직에서 조회 불가

### 수정 내용
- **MusicLoadingScreen.tsx**:
  - `result_audio_url` 필드를 URL 추출 체인에 추가
  - trackId 없을 때 generation stream 엔드포인트(`/api/generate/{id}/stream/`) URL 사용
  - polling 분기와 direct result 분기 모두 수정
- **MusicResultScreen.tsx**:
  - 오디오 로딩 시 인증 헤더(`Authorization: Bearer {token}`) 추가 (generation stream 엔드포인트 인증 필요)
  - `handleSave()` → `POST /api/tracks/upload-from-generation` 실제 호출 구현
  - 저장 중 버튼 비활성화/텍스트 변경 (`저장 중...`)
  - `useAuthStore`, `useLyricsStore`, `api` import 추가

### 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `screens/MusicLoadingScreen.tsx` | result_audio_url 필드 인식, generation stream URL 생성 |
| `screens/MusicResultScreen.tsx` | 인증 헤더 추가, handleSave() API 호출 구현 |
| `PLAN.md` | v21 수정 계획 추가 |

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |

### 특이사항
- 백엔드 `POST /api/tracks/upload-from-generation` 엔드포인트는 이미 구현되어 있었음 (프론트엔드만 미연동 상태)
- generation stream 엔드포인트(`/api/generate/{id}/stream/`)는 인증 필수이므로 expo-av 오디오 로딩 시 Bearer token 헤더 전달 필요
- `generationId`는 MusicLoadingScreen에서 설정된 generation ObjectId가 trackId 없을 때 그대로 유지되므로 upload-from-generation에 정확히 전달됨

---

## v22 - 2026-04-14 - 저장 미작동, 프롬프트 매핑 수정, 다시 생성하기 플로우 수정

### 수정일자
2026-04-14

### 요청 작업
1. 저장하기를 눌러도 마이뮤직에 곡이 안 보이는 문제 해결
2. 작사/작곡 프롬프트 확인 및 개선 - 원하는 노래와 다른 곡 생성 문제
3. 다시 생성하기 → 작곡 설정 화면으로 돌아가도록 수정

### 수행 결과

#### 1. 보컬 스타일 매핑 수정 (핵심 수정)
**문제**: 프론트엔드가 `vocal: '남성 보컬'` (한국어)을 전송하지만, 백엔드 `SUNO_VOCAL_MAP`은 `male_warm`, `female_powerful` 등 영어 키만 인식. 결과적으로 `vocal_info = None`이 되어 보컬 스타일이 Suno에 전혀 전달되지 않음.

**수정**: `musicService.ts`에 보컬 매핑 테이블 추가
| 프론트엔드 (성별 + 스타일) | 백엔드 키 |
|---------------------------|-----------|
| 남성 보컬 + 소프트 | `male_soft` |
| 남성 보컬 + 파워풀 | `male_powerful` |
| 남성 보컬 + 위스퍼 | `male_warm` |
| 남성 보컬 + 그루비 | `male_husky` |
| 여성 보컬 + 소프트 | `female_warm` |
| 여성 보컬 + 파워풀 | `female_powerful` |
| 여성 보컬 + 위스퍼 | `female_warm` |
| 여성 보컬 + 그루비 | `female_husky` |
| 여성 보컬 + 클리어 | `female_sweet` |
| (보컬 OFF) | `instrumental` |

#### 2. "다시 생성하기" 플로우 수정
**변경 전**: `MusicResultScreen` → `MusicLoading` (바로 같은 설정으로 재생성)
**변경 후**: `MusicResultScreen` → `MusicGeneration` (작곡 설정 화면으로 이동, 설정 변경 후 재생성 가능)

#### 3. 저장 기능 검증
v21에서 추가한 `handleSave()` → `POST /api/tracks/upload-from-generation` 호출이 정확한 `generationId`(generation ObjectId)를 전달하는 것을 확인함. 추가 수정 불필요.

#### 4. 프롬프트 템플릿 분석
- **작사**: 백엔드 `lyrics_generator.py`의 시스템 프롬프트가 Suno 최적화 구조 태그([Verse], [Chorus] 등)를 포함하여 잘 구성되어 있음
- **작곡**: `suno_generator.py`의 style 빌드 로직이 genre, mood, vocal, BPM, key를 모두 Suno API로 전달. 문제의 원인은 보컬 매핑 불일치였음

### 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `services/musicService.ts` | VOCAL_KEY_MAP 매핑 테이블 + mapVocalKey() 함수 추가, generateWithSuno()에서 변환된 키 전송 |
| `screens/MusicResultScreen.tsx` | handleRegenerate() → `MusicGeneration` 화면으로 이동, generationId 초기화 |
| `PLAN.md` | v22 수정 계획 추가 |

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |

### 특이사항
- 보컬 매핑 불일치가 "원하는 노래와 다른 곡 생성" 문제의 주요 원인이었음. 보컬 정보가 Suno에 전달되지 않아 기본 보컬 설정으로 생성됨
- `작곡.md`에 명시된 Style Weight, Weirdness, Audio Weight, Persona Model 파라미터는 프론트엔드 UI에 미반영 상태 (고급 설정 확장 시 추가 필요)
- `작사Input정리.md`에 명시된 장르 세부 분류(예: 인디포크, 드림팝 등)는 현재 프론트엔드 장르 리스트보다 훨씬 상세함. 향후 장르 세분화 시 반영 필요

---

## v23 - 2026-04-14 - 백엔드 포트 9001 전환, API 필드 전수 점검

### 수정일자
2026-04-14

### 요청 작업
1. 백엔드 호출 포트 9000 → 9001 전체 변경
2. API 필드 전수 점검 및 불일치 수정
3. 대화 UI 질문 ↔ API 필드 완전성 점검

### 수행 결과

#### 1. 포트 변경 (9000 → 9001)
10개 위치 변경 완료:

| 파일 | 변경 내용 |
|------|----------|
| `services/api.ts` | `BACKEND_PORT = 9000` → `9001` |
| `screens/PlayerScreen.tsx` | 하드코딩 URL 2곳 (cover-preview, stream-proxy) |
| `screens/ChartScreen.tsx` | cover-preview URL |
| `screens/MyMusicScreen.tsx` | cover-preview URL |
| `screens/MusicLoadingScreen.tsx` | tracks/stream, generate/stream URL 4곳 |
| `screens/MusicResultScreen.tsx` | minio:9000 치환 대상 URL |

#### 2. API 필드 수정
- **Wondera API** (`musicService.ts`):
  - `model: 'wondera'` → `'auto'` (유효한 모델명으로 수정)
  - 불필요한 필드 제거: `genre`, `mood`, `duration` (백엔드 `GenerateRequest` 미지원)
  - `prompt` 필드 개선: 장르, 분위기, 스타일, 참고 스타일, 템포 정보를 모두 포함

#### 3. 대화 UI ↔ API 필드 점검 결과

**작사 API** (`POST /generate/lyrics/`): 모든 8가지 질문이 prompt 텍스트 또는 개별 필드로 전달됨 ✅

**작곡 API** (`POST /generate/`): 11가지 입력 중 10가지 정상 전달 ✅
- ⚠️ 참고 음악 파일(`referenceFile`): params에 포함되어 있으나 실제 API 호출에 미전송. 별도 `/generate/upload-reference/` 업로드 후 `reference_audio_url` 전달 필요 (향후 구현 과제)

### 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `services/api.ts` | 포트 9001로 변경 |
| `services/musicService.ts` | Wondera API 필드 정리 (model, prompt 개선) |
| `screens/PlayerScreen.tsx` | 포트 9001 |
| `screens/ChartScreen.tsx` | 포트 9001 |
| `screens/MyMusicScreen.tsx` | 포트 9001 |
| `screens/MusicLoadingScreen.tsx` | 포트 9001 |
| `screens/MusicResultScreen.tsx` | 포트 9001 |
| `PLAN.md` | v23 계획 추가 |

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 | PASS |
| 9000 참조 잔존 검사 | PASS (minio:9000 치환 로직만 정상 잔존) |

### 특이사항
- backend_9001은 원격 PC(WSL)에서 실행 중이며 추가로 `business.py` 라우트 포함
- 참고 음악 파일 업로드 기능은 UI에서 수집하지만 API 호출 미구현 → 향후 `/generate/upload-reference/` 연동 필요
- Wondera 모델 선택 시 사용 가능한 모델: auto, wondera-2.1, wondera-2.2, wondera-o1, wondera-o2

---

## v28 - 2026-04-22 - Sprint 2 잔여 + Sprint 3 통합 + Tailscale 전환

### 요청 작업
1. Sprint 2 잔여 (2-7/2-8 로딩 단계 세분화, 2-10 성장 곡선 UI)
2. Sprint 3 (이전 커밋에 반영된 아티스트 디렉터 + 착용 광고)
3. 백엔드 서버 Tailscale 전환 (`http://100.127.225.55:9003`)

### 수행 결과

| 작업 | 상태 | 설명 |
|------|------|------|
| 2-7 로딩 단계 세분화 (LyricsLoading) | ✅ | 4단계 스텝 인디케이터 (영감→작사→운율→마무리) |
| 2-7 로딩 단계 세분화 (MusicLoading) | ✅ | 5단계 인디케이터 + progress % 연동 |
| 2-7 로딩 단계 세분화 (CoverGeneration) | ✅ | 4단계 인디케이터 (구상→색감→디자인→마무리) |
| 2-8 단계별 광고 훅 | 🟡 | 인디케이터 구조만 준비, AdMob 통합은 후속 |
| 2-10 성장 곡선 UI | ✅ | MyMusicScreen 헤더를 그라데이션 성장 카드로 교체 |
| Tailscale URL 전환 | ✅ | `services/api.ts` BACKEND_BASE_URL 수정 |

### 파일 변경
| 파일 | 변경 내용 |
|------|-----------|
| `services/api.ts` | BACKEND_BASE_URL → `http://100.127.225.55:9003` |
| `screens/LyricsLoadingScreen.tsx` | LOADING_STEPS 구조 + 스텝 인디케이터 UI + 스타일 |
| `screens/MusicLoadingScreen.tsx` | LOADING_STEPS + progress % ↔ 스텝 동기화 |
| `screens/CoverGenerationScreen.tsx` | LOADING_STEPS + 스텝 인디케이터 UI |
| `screens/MyMusicScreen.tsx` | LinearGradient import, 성장 카드 UI, 성장 스타일 |
| `PLAN.md` | v28 계획 추가 |
| `REPORT.md` | v28 결과 기록 |

### 테스트 결과
| 테스트 항목 | 결과 |
|------------|------|
| TypeScript 컴파일 (`tsc --noEmit`) | PASS (0 errors, 550 files) |
| `LOADING_MESSAGES` 잔존 검사 | PASS (모두 `LOADING_STEPS`로 대체됨) |
| cloudflared URL 잔존 검사 | PASS (api.ts 주석 한 줄만 이력 보존) |

### 특이사항
- **2-8 단계별 광고**: timerStore/AdMob 연동은 범위가 커서 이번 통합 PR에서 UI 구조까지만. 다음 스프린트에 "이 단계 광고로 스킵" 버튼을 각 스텝에 추가 예정.
- **MinIO 폴백 IP (192.168.219.106)**: `MusicResultScreen.tsx`에 남아 있지만 `savedTrackId`/`generationId` 모두 없는 극단 케이스에만 동작 — Tailscale MinIO 포트 미확정으로 보류.
- **성장 카드 레벨 공식**: `Math.floor(tracks.length / 3) + 1` — 3곡마다 +1 레벨, 베스트 트랙은 최다 재생수 기준.
- **Tailscale 전제**: 사용자 MAC 100.106.9.84 / 서버 100.127.225.55 같은 tailnet 전제. 테스트 시 두 기기 모두 Tailscale 연결 필요.

---

## v29 - 2026-04-22 - 회원가입 스펙 / 로그 API 문서 / 프롬프트 통합

### 요청 작업
1. 회원가입 필드 추가(기획사명/호칭) — 백엔드 스펙 문서화
2. 로그 API 엔드포인트 확인 + 앱팀 사용법 전달
3. PlayerScreen 프롬프트 표시를 "작곡 프롬프트 하나"로 통합

### 수행 결과

| 작업 | 상태 | 결과 |
|------|------|------|
| 회원가입 스펙 문서 | ✅ | `회원가입_필드_백엔드_요청.md` 생성 — DB/모델/라우트/호환성/테스트 7개 섹션 |
| 로그 API ping 검증 | ✅ | `/api/_logs/tail\|download\|info` 전부 HTTP 401 → **엔드포인트 존재 확정** |
| 로그 API 사용법 문서 | ✅ | `백엔드_로그_API_사용법.md` 생성 — curl 예시 / 보안 경고 / alias 권장 |
| PlayerScreen 프롬프트 통합 | ✅ | 라벨 "작곡 프롬프트"로 변경 + 핵심 파라미터 칩 박스 추가 |

### 파일 변경
| 파일 | 변경 내용 |
|------|-----------|
| `screens/PlayerScreen.tsx` | prompt 탭 UI 개편 (라벨/헬퍼/칩 박스 6개 필드), 스타일 7개 추가 |
| `회원가입_필드_백엔드_요청.md` | 신규 — 백엔드 담당(jaekyu891)에게 전달용 스펙 |
| `백엔드_로그_API_사용법.md` | 신규 — 앱팀 운영/디버깅 가이드 |
| `PLAN.md` | v29 계획 추가 |
| `REPORT.md` | v29 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| TypeScript 컴파일 (`tsc --noEmit`) | PASS (0 errors) |
| 로그 API ping (4개) | `/health` 200, `/_logs/*` 401 (예상 동작) |
| PlayerScreen 수동 | 사용자 Expo Go에서 프롬프트 탭 육안 확인 필요 |

### 특이사항
- **메모리 제약 준수**: backend_9003 코드 미수정. 회원가입 필드는 **스펙 문서로만** 백엔드 담당에게 전달하고, 머지 후 프론트 리팩토링 (SignupScreen 통합, onboardingStore 제거) 예정.
- **로그 토큰 관리**: `LOG_ACCESS_TOKEN`은 `.env` gitignore — 앱팀 공유는 카톡/슬랙 DM 등 안전 채널로만. 문서에 경고 명시.
- **프롬프트 UI**: 현재 백엔드 `Track` 모델이 `prompt` 필드 1개뿐이라 작사/작곡 분리는 불가. 작곡 프롬프트 하나로 통합하되 핵심 파라미터를 칩으로 재구성해 가독성 확보.
- **PANN 로고**: 이번 PR 범위 제외. `logo_prompts.md` 기반 AI 생성은 사용자 작업 대기.

### 다음 단계
- 사용자 앱 테스트 (Tailscale 전환 + v28/v29 UI 변경 전체)
- 이상 없으면 통합 PR(Sprint 2 잔여 + Sprint 3 + v29) 커밋/푸시
- 백엔드 담당이 회원가입 필드 머지하면 프론트 SignupScreen 리팩토링 착수

---

## v30 - 2026-04-22 - 회원가입 필드 프론트 통합 (Onboarding 완전 제거)

### 요청 작업
백엔드에 `company_name`/`display_title` 필드 머지 완료 → 프론트가 Onboarding에서 읽는 구조를 **회원가입 → DB → user 구독** 으로 전환

### 수행 결과

| 파일 | 변경 |
|------|------|
| `stores/authStore.ts` | `AuthUser`에 `company_name?/display_title?` 추가. `register` 시그니처 확장 (+companyName, +displayTitle), POST body에 조건부 포함 |
| `screens/SettingsScreen.tsx` | 회원가입 모드에 2개 필드 추가 (기획사명/호칭), 기본값/자동 생성 로직, helperText, 프로필 카드에 company_name+display_title 표시 |
| `screens/SplashScreen.tsx` | `useOnboardingStore` 임포트 제거, `isCompleted` 분기 제거 → 항상 `MainTabs`로 이동 |
| `screens/MyMusicScreen.tsx` | `useOnboardingStore` 제거, 성장 카드 라벨을 `user.company_name`/`user.display_title` 기반으로 전환 |
| `App.tsx` | `OnboardingScreen` import / 라우트 / 타입 3곳 제거 |
| `screens/OnboardingScreen.tsx` | **파일 삭제** |
| `stores/onboardingStore.ts` | **파일 삭제** |
| `PLAN.md` | v30 계획 추가 |
| `REPORT.md` | v30 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| TypeScript 컴파일 (`tsc --noEmit`) | PASS (0 errors) |
| `onboardingStore`/`OnboardingScreen` 참조 잔존 | PASS (코드 0건, 기록 문서만 잔존) |
| Splash → MainTabs 직행 | 코드상 확정 |

### 사용자 확인 필요 사항
1. Expo Go 재로드 (Metro 캐시 삭제 권장: `npx expo start --clear`)
2. **기존 계정으로 로그인** — `company_name`/`display_title` NULL이면 fallback(`${닉네임} 엔터테인먼트` / "대표") 표시됨
3. **신규 회원가입** — 필드 2개 보이는지, 저장 후 MyMusicScreen 성장 카드에 반영되는지
4. 로그아웃 후 재로그인 — 값 그대로 유지 확인 (DB 영속)

### 특이사항
- 회원가입 폼에 helperText 추가: "PANN에서는 기획사명과 호칭으로 불러드려요. 나중에 설정에서 변경할 수 있어요." (단, 현재 Settings의 "닉네임/비번 변경"은 아직 준비 중 — 백엔드 `PATCH /api/auth/me/profile` 추후 요청 필요)
- 프로필 카드 `companyText` 색상은 `accent.primary`(보라)로 강조, `nicknameText`에 호칭 인라인 결합
- 기존 사용자는 DB에 두 필드 NULL이므로 **fallback 렌더**로 자연스럽게 전환됨

---

## v31 - 2026-04-22 - MapScreen 게스트 UI 정리 + 프로필 편집 기능

### 요청 작업
1. 작업실 로그인 전 화면은 **맵 + 캐릭터만** 순수하게 표시
2. 기존 사용자도 기획사명/호칭을 **Settings에서 변경** 가능하도록

### 수행 결과

| 파일 | 변경 |
|------|------|
| `screens/MapScreen.tsx` | 스테퍼 바 / 방 라벨 / 펄스 글로우 모두 `user &&` 조건부로 전환 |
| `stores/authStore.ts` | `updateProfile(patch)` 액션 추가 (`PATCH /auth/me/profile`) |
| `screens/SettingsScreen.tsx` | 프로필 카드에 "기획사 정보 편집" 버튼, 편집 모달 (기획사명/호칭 입력), 저장 시 authStore로 병합, 스타일 9개 추가 |
| `PLAN.md` | v31 계획 추가 |
| `REPORT.md` | v31 결과 기록 |

### 백엔드 엔드포인트 확인 (ping)
| Endpoint | HTTP | 판정 |
|----------|------|------|
| `PATCH /api/auth/me/profile` | 401 | **존재**, 토큰 필요 |
| `PATCH /api/auth/me` | 405 | 미구현 |
| `PUT /api/auth/me` | 405 | 미구현 |
| `PUT /api/users/me` | 404 | 미구현 |

→ 백엔드 담당이 이미 `PATCH /api/auth/me/profile`를 구현해둠 — 프론트에서 바로 연동 가능.

### 테스트 결과
| 항목 | 결과 |
|------|------|
| TypeScript 컴파일 (`tsc --noEmit`) | PASS (0 errors) |
| MapScreen 게스트 UI 제거 | 코드상 스테퍼/라벨/펄스 모두 user 가드 처리됨 |
| Settings 프로필 편집 모달 | 코드상 완성, UX 수동 확인 필요 |

### 확인 절차 (Expo Go)

**1. MapScreen 로그인 전**
- Settings → 로그아웃
- 하단 탭 "작업실" → 맵 + 캐릭터만 보여야 함
- 상단 "오늘의 작업" 스테퍼 **없음**, 방 라벨 **없음**, 펄스 **없음**
- 캐릭터 탭 시 기존 로그인 유도 오버레이만 동작

**2. 로그인 후 원복 확인**
- Settings → 로그인
- 작업실 재진입 → 스테퍼/라벨/펄스/첫 방문 튜토리얼 모두 정상 등장

**3. 프로필 편집**
- Settings → 프로필 카드 아래 "기획사 정보 편집" 버튼 탭
- 모달에서 기획사명/호칭 수정 → 저장
- 완료 Alert → 카드 즉시 갱신
- 로그아웃 → 재로그인 → 수정값 유지 (DB 영속 확인)

### 특이사항
- **게스트 UX 일관성**: 튜토리얼 `useEffect`는 `user && !tutorialShownRef.current` 조건이라 자동으로 안 뜸. 추가 게이팅 불필요
- **기본값 자동 채움**: 편집 모달에서 빈 값 저장 시 `${nickname} 엔터테인먼트` / `대표`로 자동 치환하여 서버에 전송 — 백엔드 NULL 허용 여부와 무관하게 일관 동작
- **에러 응답 처리**: `updateProfile`가 `error.response.data.detail` 또는 `.error` 둘 다 커버 (FastAPI 디폴트/커스텀 에러 모두 대응)
- **로그 API / PATCH API는 backend_9003에 이미 반영**된 상태 — 본 PR에서는 프론트만 수정

---

## v32 - 2026-04-22 - 작업실 UX 대개편

### 요청 작업 (6건)
헤더 엔터명 / 디렉터명 라벨 / 헤더 튜토리얼 / 펄스 중앙·문구 / 대화 호칭 / **디렉터 단계별 스테퍼 팝업 (핵심)**

### 수행 결과

| 항목 | 상태 | 파일 |
|------|------|------|
| 헤더 엔터명 (로그아웃 시 "작업실") | ✅ | MapScreen useLayoutEffect → parent.setOptions |
| 헤더 ❓ 튜토리얼 토글 | ✅ | headerLeft 주입, 자동 팝업 제거 |
| 방 라벨 → 디렉터 명 (캐릭터 아래) | ✅ | DIRECTOR_NAMES 보라 배경 라벨 y+50 |
| 펄스 확대 + "클릭해서 작업 시작!" | ✅ | 140 mapScale 원 + 보라 배지 y+90 |
| 대화 호칭 반영 | ✅ | LyricsPromptReviewScreen `{titleLabel}님` |
| "작사 대기중" → "작사중" | ✅ | LyricsPromptReviewScreen startTask |
| 상단 스테퍼 제거 | ✅ | MapScreen stepperBar 블록 삭제 |
| **단계 스테퍼 팝업 신설** | ✅ | 6단계 시스템 + 광고=한 단계 스킵 |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `stores/timerStore.ts` | `TimerTask.initialQueue`, `DIRECTOR_STAGES`(6종×6단계), `TOTAL_STAGES`, `getCurrentStage`, `getStageSize` |
| `screens/MapScreen.tsx` | useLayoutEffect 헤더/튜토리얼 버튼, 펄스 UI, 디렉터명 라벨, 상단 스테퍼 제거, 단계 스테퍼 팝업, showAdAndReduceQueue 개선, 스타일 16개 신규 |
| `screens/LyricsPromptReviewScreen.tsx` | useAuthStore 구독, 4곳의 호칭/문구 교체, taskName "작사중" |
| `PLAN.md` | v32 계획 추가 |
| `REPORT.md` | v32 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| TypeScript 컴파일 | PASS (0 errors) |
| 6개 요청 반영 여부 | 모두 코드상 반영 — 사용자 수동 확인 필요 |

### 특이사항 및 설계 근거
- **단계 계산 공식**: `stage = floor((1 - queueNumber / initialQueue) × 6)` → 0~5 범위, 진행률에 자연스럽게 대응
- **광고 1회 = 한 단계 스킵**: `reduceAmount = max(stageSize, baseReduce)` — 기본 adReduce가 작을 수 있어 stageSize 하한 적용
- **단계 설명 문구**: 각 디렉터별로 맥락 있는 6개 설명 (ex. 작사: 테마 해석 → 운율 → 초안 → 감정 → 후렴 → 최종). 단순 숫자가 아닌 "내가 일을 맡긴 디렉터가 지금 뭘 하는지" 체감 강화
- **튜토리얼 자동 팝업 제거**: 사용자 요청대로 헤더 ❓로 **수동 토글만** 남김. 첫 방문 자동 오픈은 혼란 주므로 제외
- **디렉터명 라벨 위치 y+50**: 캐릭터 바로 아래 살짝 떨어뜨려서 가독성 + 맵 구조 훼손 최소화. 로그아웃 시엔 완전 숨김
- **SplashScreen "당신의 1인 기획사"**: 프리로그인 브랜드 태그라인이라 호칭 교체 대상 아님 (유저 명시 안 함, 유지)
- **고아 스타일**: 기존 popupContainer/popupTitle 등 미사용 스타일은 이번 PR에서 제거하지 않고 남김 (런타임 영향 없음, 최소 diff 유지)

### 사용자 확인 (Expo Go)
1. Metro 재시작 (`--clear`) — timerStore 구조 변경으로 캐시 무효화 필요
2. 작업실 헤더 엔터명, ❓ 버튼, 맵 상단 스테퍼 없음 확인
3. 펄스/문구 위치 적절한지
4. 작업 진행 → 디렉터 재클릭 → 단계 스테퍼 팝업 / "광고 보고 이 단계 빠르게 끝내기" 동작
5. 프롬프트 리뷰 화면 호칭/문구 반영

---

## v33 - 2026-04-22 - 로그아웃 시 작업실 헤더 ❓ 제거

### 요청 작업
로그아웃 상태에서 작업실 헤더에 튜토리얼 ❓ 아이콘이 보여 "❓ 작업실"처럼 표시되던 것을 `작업실`만 보이도록 수정

### 수행 결과
| 파일 | 변경 |
|------|------|
| `screens/MapScreen.tsx` | `useLayoutEffect` → `headerLeft: user ? () => ❓ 버튼 : undefined` 삼항 처리. 의존성에 `user` 추가 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| TypeScript 컴파일 | PASS (0 errors) |
| 로그아웃 시 헤더 | "작업실"만 표시 (❓ 숨김) — 코드상 확정 |
| 로그인 시 헤더 | 좌측 ❓ + 엔터명 표시 — 기존 동작 유지 |

### 특이사항
- `headerLeft: undefined`로 설정하면 React Navigation이 `headerLeft` 자체를 렌더링하지 않음 (빈 `View`가 아닌 진짜 제거)
- `user` 의존성 추가로 로그아웃 후에도 즉시 헤더 갱신

---

## v34 - 2026-04-22 - 헤더 툴팁 정렬 + 캐릭터 이동 + 맵 bg/fg 분리

### 요청 작업
1. 도움말 툴팁을 **헤더 ⓘ 아이콘**을 정확히 가리키도록 재배치
2. 캐릭터 이동 구현 + 벽/가구1 < 캐릭터 < 가구2+ 레이어링 + 박스 없는 텍스트 라벨이 함께 움직이도록

### 수행 결과

| 파일 | 변경 |
|------|------|
| `render_map.py` | TMX 레이어를 이름 기반으로 bg/fg 분리 렌더 (`BG_LAYER_NAMES` 셋). `map_bg.png`(바닥~가구1), `map_fg.png`(가구2~가구5) 2장 + 기존 `map_rendered.png` 유지 |
| `assets/map_bg.png` | **신규 생성** 71KB |
| `assets/map_fg.png` | **신규 생성** 51KB (투명 배경) |
| `components/Character.tsx` | Animated.View wrapper + offsetX/Y translate, walk 단계마다 방향별 ±WALK_RADIUS 이동(2500ms). idle에서 원점 감쇠. `name`/`roleEn` props + textShadow 기반 박스없는 라벨 내부 렌더 |
| `screens/MapScreen.tsx` | `MAP_BG` 배경 + `MAP_FG` 전경(zIndex 15, pointerEvents none 부모 View로 감싸 `Image` 제약 우회), Character에 name/roleEn 전달, 기존 인라인 네임태그 제거, 툴팁 `right: 52, marginRight: -4`로 ⓘ 중앙 정렬, "클릭해서 작업 시작!" zIndex 26으로 fg 위 |

### 레이어 구조 최종
```
zIndex 26 : "클릭해서 작업 시작!" 배지   ← 항상 보임
zIndex 25 : 디렉터 네임 라벨 (Character 내부) ← 캐릭터와 함께 이동, 가구 뚫고 보임
zIndex 15 : 가구2~가구5 (map_fg.png)   ← 캐릭터 앞 (터치 투과)
zIndex 10 : 캐릭터 스프라이트 + 이동 transform
zIndex  1 : 다음 액션 스포트라이트 펄스
zIndex  0 : 바닥/벽/가구1 (map_bg.png)
```

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |
| bg/fg PNG 생성 | PASS (render_map.py 실행 완료) |
| 레이어 합산 타일 수 | bg 2070 + fg 274 = 2344 타일 (전체와 일치) |

### 특이사항
- **Image의 pointerEvents 이슈**: React Native의 `Image` 컴포넌트는 `pointerEvents` prop을 직접 받지 못함. 부모 `View`에 감싸서 해결
- **캐릭터 이동 범위**: WALK_RADIUS_X=60, WALK_RADIUS_Y=35 (맵 좌표). mapScale(~0.5) 기준 실제 화면 ±30/±17px 이동. 방 범위(약 140x280 타일 공간)를 벗어나지 않는 안전 값
- **idle 복귀**: walk 후 idle/read/drink 시 원점으로 1500ms 감쇠 → 무한 드리프트 방지. 방 밖 탈출 없음
- **라벨 가독성**: 박스 제거 → textShadow로 어두운 외곽선 효과 (shadowRadius 3~4). 밝은 바닥에서도 어두운 배경 위에서도 판독 가능
- **Character 컴포넌트 리팩토링**: 외곽 TouchableOpacity → Animated.View + 내부 TouchableOpacity로 구조 변경 (transform은 Animated.View에만 적용 가능)
- **튜토리얼 툴팁 정렬**: `right: 52`는 ⓘ/⋮ 아이콘의 상대 위치 계산 기반 (marginRight 12 + ⋮ 38 + ⓘ 왼쪽 반 20 ≈ 70 근방, 꼬리 살짝 오른쪽으로 오프셋)

### 사용자 확인 (Expo Go, `--clear` 권장)
1. 작업실 헤더 ⓘ 바로 아래에 "도움말을 보려면 클릭하세요" 말풍선 정확히 정렬
2. 캐릭터가 3초마다 walk 단계에서 살짝 이동 → idle로 돌아오며 원점 근방 유지
3. 캐릭터 이름이 **박스 없이** 텍스트만 떠 있고, 이동 시 함께 따라옴
4. 가구2 이상의 오브젝트(의자 뒤, 액자 앞 등)가 캐릭터를 일부 가림
5. 벽/가구1은 캐릭터 뒤에 (자연스러움)

---

## v35 - 2026-04-22 - 힌트 헤더 내부 이동, 이동 반경 축소, 라벨 캐릭터 아래

### 요청 4건
1. 힌트 말풍선을 ⓘ **왼쪽 헤더 내부**에 배치
2. 캐릭터 이동을 **바닥만** (가구 회피)
3. 네임태그를 **캐릭터 아래**, 최대한 가깝게
4. "클릭해서 작업 시작!"을 **펄스 위쪽**

### 수행 결과

| 파일 | 변경 |
|------|------|
| `screens/MapScreen.tsx` | `useLayoutEffect` headerRight 재구성 — `[말풍선][꼬리▶][ⓘ][⋮]`. 본문의 tutorialHintWrap 블록 제거. DIRECTORS 배열에 `walkRadiusX/Y` 필드 추가. Character에 walkRadiusX/Y props 전달. "클릭 시작" 배지 y위치 `(d.y - 70) * mapScale - 40`로 변경 |
| `components/Character.tsx` | 상수 WALK_RADIUS_X/Y 제거 → props 받음 (기본 30/15). 라벨 wrapper `top: -40` → `top: 64 * spriteScale + 2`. 순서: 이름(굵은) 위, roleEn 아래. characterStyles 재배열 |

### 스타일 변경
| 스타일 | 변경 |
|--------|------|
| `tutorialHintWrap`, `tutorialHintTail`, `tutorialHintBubble`, `tutorialHintText` | **제거** |
| `headerHintBubble`, `headerHintText`, `headerHintTail` | **신규** (헤더 내부 flex row용) |

### 디렉터별 walk 반경
| 디렉터 | walkRadiusX | walkRadiusY |
|--------|-------------|-------------|
| artist  | 35 | 20 |
| lyricist | 35 | 20 |
| composer | 30 | 18 |
| wondera  | 30 | 18 |
| image    | 35 | 20 |
| video    | 35 | 20 |

기존 60/35 → 대폭 축소. 작곡실(composer+wondera 동거)만 더 좁게.

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항
- **헤더 내부 말풍선**: `useLayoutEffect` 의존성에 `showTutorialHint`, `showTutorial` 추가로 상태 변화 즉시 반영. 다른 대안(본문 top: 0)보다 헤더 내 수평 배치가 UX 명확
- **walk 반경**: 가구 위치가 맵마다 다르므로 완벽한 충돌 회피는 TMX 픽셀 마스크가 필요. 현재는 "바닥 중심점 근방"으로 보수적 반경 지정 → 실제 테스트에서 특정 방에서 여전히 가구 침범하면 해당 디렉터만 추가 축소
- **네임태그 위치**: `64 * spriteScale + 2`는 sprite 바로 아래 2px. 스프라이트 크기가 mapScale 따라 변해도 자동 추종
- **"클릭 시작" 배지**: 펄스 내부가 아닌 **위쪽** 공간에 배치 → 캐릭터 위→배지→펄스 원→캐릭터 전체 구조가 명확

### 사용자 확인 (Expo Go, `--clear` 권장)
1. 로그인 상태 Studio 헤더: `[도움말을 보려면 클릭▶] ⓘ ⋮` 한 줄 배치 확인
2. 힌트 말풍선/ⓘ 어느 쪽 탭해도 힌트 dismiss 확인
3. 각 캐릭터가 방 바닥 안에서만 이동 (책상/의자 위로 안 가는지)
4. 네임태그가 캐릭터 발 바로 아래 2px 간격으로 붙어 있고, 함께 이동
5. 다음 액션 디렉터의 "클릭해서 작업 시작!" 배지가 펄스 위쪽(캐릭터 위)에 표시

---

## v36 - 2026-04-22 - Walk zone을 TMX 바닥 레이어에서 자동 추출

### 요청 작업
v35의 임의 반경(35/20) 대신, TMX의 실제 바닥/가구 데이터를 기반으로 방별 이동 영역을 자동 산출

### 수행 결과

| 파일 | 변경 |
|------|------|
| `render_map.py` | `json`, `deque` 임포트. `BLOCKER_LAYER_NAMES`, `DIRECTOR_POSITIONS`, `WALK_FLOOD_MAX_DEPTH=4` 상수 추가. 렌더 루프에 `floor_tiles`/`blocker_tiles` 수집. 렌더 후 nearest_walkable anchor + BFS로 방별 zone 생성. `assets/director_walk_zones.json` 저장 |
| `assets/director_walk_zones.json` | **신규** 생성 (0.6KB, 디렉터 6개 × 10~24 타일 delta) |
| `screens/MapScreen.tsx` | `WALK_ZONES` JSON require. `DIRECTORS` 배열에서 walkRadiusX/Y 필드 제거. Character에 `walkDeltas={WALK_ZONES[d.type]}` 전달 |
| `components/Character.tsx` | Props walkRadiusX/Y → `walkDeltas: Array<[number, number]>`. `currentDeltaRef`로 현재 위치 추적. walk 로직 재구성 — zone 샘플링 + 재추첨(<32px) + 방향 자동 산출. idle/read/drink 원점 복귀 제거 |

### 실행 결과 (render_map.py 로그)
```
바닥 타일: 1315, 차단 타일: 754, 보행 가능 타일: 716

[artist]   base=(208,340)  anchor=(6,10)  (208,336)   zone=10 타일
[lyricist] base=(208,660)  anchor=(8,20)  (272,656)   zone=24 타일  ← 가장 넓음
[composer] base=(208,980)  anchor=(6,29)  (208,944)   zone=15 타일
[wondera]  base=(320,980)  anchor=(9,30)  (304,976)   zone=15 타일
[image]    base=(208,1300) anchor=(6,39)  (208,1264)  zone=16 타일
[video]    base=(208,1620) anchor=(5,50)  (176,1616)  zone=20 타일
```

각 디렉터의 **실제 방 바닥 구조**가 반영됨 (10~24 타일 = 방마다 실질적으로 다른 영역).

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `python3 render_map.py` | SUCCESS (이미지 3장 + JSON 1장 출력) |
| `tsc --noEmit` | PASS (0 errors) |
| JSON 포맷 검증 | `[dx, dy]` 쌍 배열 — Character.walkDeltas 시그니처와 일치 |
| 원점 이탈 방지 | 모든 delta가 같은 방 내 연결 영역 → BFS로 수학적 보장 |

### 특이사항 / 설계 근거

- **앵커 재산출**: 디렉터 베이스 좌표가 가구 타일(책상 등)에 걸려 있으면 그 타일은 walkable이 아님 → nearest_walkable로 가장 가까운 바닥 타일을 앵커로 삼음. 실제로 4명의 디렉터는 앵커가 base와 다름 (예: lyricist base=(208,660) → anchor=(272,656))
- **BFS 깊이 4**: 4타일 Manhattan = 약 128px 반경. 대부분 방이 7~10타일 폭이므로 방의 절반~전체 커버
- **재추첨 로직**: 현재 위치와 < 32px면 재추첨 (최대 3회). "같은 자리 왕복" 방지, 자연스러운 패턴
- **원점 복귀 제거**: idle/read/drink 시 원점(0,0) 돌아가지 않음. 일하다가 책상 쪽으로 가서 read → 다시 걸어서 다른 자리 이동. 더 현실적
- **TMX 변경 대응**: 방 구조 수정 시 `python3 render_map.py` 한 번으로 zone 재산출 + PNG 재렌더 동시 처리
- **크기**: JSON 0.6KB — 번들 부담 없음

### 사용자 확인 (Expo Go, `--clear` 권장)
1. 각 방마다 캐릭터 이동 패턴이 실제 방 모양을 따르는지 (가구 피해서 바닥만)
2. 작사실(lyricist, 24 타일)이 가장 활동적, 아티스트룸(artist, 10 타일)이 가장 제한적 — 이동 빈도/범위 차이
3. 책상/의자 위로 캐릭터가 올라가는 케이스 0건
4. 캐릭터가 네임태그와 함께 움직이는지

---

## v37 - 2026-04-24 - UI 정돈 7건 + 아티스트 디렉터 생성 플로우

### 요청 7건 전체 반영

| # | 요청 | 결과 |
|---|------|------|
| 1 | 캐릭터 제자리 + 라벨 작은 박스 | ✅ `Character.tsx` walk 제거, 둥근 테두리 보라 박스 라벨 |
| 2 | "~ 중" / "~ 일을 완료했어요!" / 대기번호 숨김 | ✅ `MapScreen.tsx` 티켓 + 팝업 문구 교체 |
| 3 | 단계당 광고 1회 비용 재계산 | ✅ `비용_재계산_v37.md` 분석 문서 |
| 4 | 작곡 세부 설정 대화형 전환 | ✅ Switch 제거, 6개 sub-step + "건너뛰기/적용" 버튼 |
| 5 | 아티스트 디렉터 재구성 | ✅ 사진→코디→스타일 텍스트→생성→프리뷰→저장/수정 |
| 6 | 솔로 시 서브보컬 차단 검증 | ✅ musicService isDuet 게이팅 정상 확인 |
| 7 | "대기번호 드릴게요" → "시작할게요" | ✅ 커버/작곡 멘트 교체 |

### 파일 변경

| 파일 | 변경 |
|------|------|
| `components/Character.tsx` | walk 로직 비활성 (walkDeltas 수신만), 라벨을 `nameBadge` 둥근 박스 + 10pt 텍스트로 축소 (roleEn 제거) |
| `screens/MapScreen.tsx` | 캐릭터 위 티켓: "taskName 중" / "taskName 일을 완료했어요!"; 진행률 텍스트에서 "대기번호 #N" 삭제; 보상 팝업 "단계가 앞당겨졌어요!"; 튜토리얼 문구 수정; Character에 walkDeltas/roleEn 전달 제거 |
| `screens/LyricsPromptReviewScreen.tsx` | `startTask('lyricist', '작사중')` → `'작사'` |
| `screens/CoverGenerationScreen.tsx` | "대기번호를 드릴게요!" → "커버 작업을 시작할게요!..." |
| `screens/MusicGenerationScreen.tsx` | DIRECTOR_MESSAGES 7→12항목, case 6 단일 페이지 → case 6~11 분할 (제외 스타일 / 자유도 / 실험성 / 오디오 세기 / BPM / Key). Switch 제거, [건너뛰기/적용] 버튼 + 슬라이더 끝점 라벨. handleGenerate에 "작곡 시작할게요!" 채팅 추가 후 1.5초 뒤 Map 이동. 새 스타일 `sliderEndLabel/sliderValueCenter/twoBtnRow/skipBtn/applyBtn` |
| `screens/ArtistDirectorScreen.tsx` | **완전 재작성** — 목록 UI 제거, 대화 플로우로 전환. welcome → photo_done → cody(상의/하의/신발 각 모달) → style_text → generating → preview → done. API 연동: `GET /character/me`, `POST /character/generate-sheet`(FormData), `POST /character/save`, `POST /character/refine`, `DELETE /character/me`, `GET /business/ads/active?category=`, `POST /business/ads/{id}/impression` |
| `비용_재계산_v37.md` | **신규** — 광고 1회=1단계 가정 모델별 손익 분석표 |
| `PLAN.md` | v37 계획 추가 |
| `REPORT.md` | v37 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |
| #6 솔로→서브보컬 차단 | 코드 검증 완료 (musicService.ts:92-110) |

### 특이사항

- **#1 캐릭터 이동 비활성 이유**: 가구 있는 맵에서 여전히 부자연스러운 곳으로 이동하는 이슈 확인됨. walkDeltas 데이터와 로직은 보존(향후 재활성 시 복원 가능), Character 렌더만 제자리로 고정
- **#3 수치 정책**: 단계당 광고 1회(총 6회) 규칙은 저가 모델에서만 흑자. 고가 모델(Opus/Suno/MV)은 "Pro 유료 플랜 + 광고 제거"로 풀어야 지속가능. timerStore 수치 자체는 변경 불필요
- **#4 Switch 제거 후 저장 로직**: 기존 `*On` state는 유지(값 저장 필요), 각 단계에서 `apply` 파라미터로 `setXxxOn(apply)` 호출. 이후 `handleGenerate`에서 기존 저장 로직 그대로 재사용 → 변경 최소화
- **#5 ImagePicker 부재**: `expo-image-picker` 미설치. `expo-document-picker`의 `type: 'image/*'`로 대응. 사진 앨범 UX는 OS 파일 탐색기로 동작. 향후 ImagePicker 설치 시 1줄 교체 가능
- **#5 multipart 업로드 (RN)**: FormData에 `{ uri, name, type }` 객체를 그대로 append하는 RN 전용 패턴 사용. 광고 아이템 이미지는 백엔드 URL을 fetch 후 FormData에 추가 (참고 웹 프론트 방식 이식)
- **#5 백엔드 API 의존성**: `/character/*`, `/business/ads/active` 등 이미 백엔드에 구현되어 있음 가정. 없으면 해당 단계에서 에러 alert로 표시

### 사용자 확인 (Expo Go, `--clear` 권장)

1. **#1** 맵에서 캐릭터가 움직이지 않고 제자리에 고정. 작은 둥근 보라 테두리 박스에 "작사 디렉터" 등 표시
2. **#2** 작사 완료 후 티켓에 "작사 일을 완료했어요!" / 진행 중엔 "작사 중" (대기번호 숫자 없음)
3. **#4** 작곡 디렉터 대화 진행 → 보컬/보컬 스타일/참고 파일 이후 제외 스타일/자유도/실험성/오디오 세기/BPM/Key 6단계 모두 질문식으로 + 건너뛰기 가능
4. **#5** 작업실 맵 → 아티스트 디렉터 클릭 → 대화 플로우 진행 → 사진 올리기 → 코디 모달에서 상의/하의/신발 선택 → 스타일 텍스트 → 생성 → 프리뷰 → 저장
5. **#7** 커버/작곡 완료 시 "~를 시작할게요!" 메시지 후 맵으로 복귀

---

## v38 - 2026-04-24 - 플레이어/차트/플레이리스트/레이어 + 영입 설계

### 요청 5건 반영

| # | 요청 | 결과 |
|---|------|------|
| 1 | 미니→풀 전환 시 재생바 멈춤 | ✅ `setOnPlaybackStatusUpdate` 재설정 |
| 2 | 차트에 장르 표시 | ✅ genreBadge 추가 |
| 3 | 플레이리스트 썸네일 모자이크 | ✅ 4곡 커버 2x2 그리드 |
| 4 | 캐릭터 맵 최상위 | ✅ Character zIndex 10→20 |
| 5 | 디렉터 영입 시스템 | ✅ 설계 문서 `디렉터_영입_시스템_설계_v38.md` |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `screens/PlayerScreen.tsx` | 미니에서 sound 이어받을 때 `playerStore.sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate)` 재등록 |
| `screens/ChartScreen.tsx` | ChartTrack.genre/mood 타입 `string \| string[]` 유연화. renderTrack statsRow에 `genreBadge` 렌더. 관련 스타일 추가 |
| `screens/PlaylistScreen.tsx` | Playlist interface에 cover_images 추가. fetchPlaylists에서 Promise.all로 각 /playlists/{id} 호출해 상위 4곡 커버 수집. renderPlaylist 모자이크 조건부 렌더. 스타일 `playlistMosaic/mosaicCell/mosaicImg` 추가 |
| `components/Character.tsx` | zIndex 10 → 20 (fg 15 위) |
| `디렉터_영입_시스템_설계_v38.md` | **신규** — 설계 제안 문서 7장 |
| `PLAN.md` | v38 계획 |
| `REPORT.md` | v38 결과 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **#1 원인 분석**: MiniPlayer가 loadAndPlayNewTrack에서 한 번만 `setOnPlaybackStatusUpdate`를 호출. 이 콜백은 MiniPlayer 클로저라 PlayerScreen local state(position, duration)를 모름. PlayerScreen 진입 시 콜백을 자기 것으로 교체 → local state와 store 둘 다 업데이트. PlayerScreen 언마운트 후에는 콜백이 유지되지만 store는 계속 업데이트되므로 MiniPlayer 표시 정상
- **#3 성능 고려**: N+1 API 호출. 플레이리스트 수가 100+이면 문제. 현재는 개인 플레이리스트라 적어 OK. 장기적으로 백엔드에 `GET /playlists/?include=top_covers` 같은 파라미터 추가 요청 가능
- **#4 라벨/배지도 함께 올라감**: 디렉터 네임 라벨은 Character 내부(zIndex 25)에 있어 캐릭터 뒤로 숨지 않음. "클릭해서 작업 시작!" 배지는 별도 zIndex 26으로 유지. 레이어 일관성 확보
- **#5 설계 미승인 상태**: 문서에 4개 결정 지점 명시. 사용자 답변 후 Phase 1 MVP(캐시 스토어 + 영입 화면 + 선택 모달 + 캐시 지급 훅) 착수 예정

### 사용자 확인 (Expo Go, 선택)
1. 곡 재생 → 미니 플레이어에서 풀스크린 전환 → 재생바 계속 움직이는지
2. 차트 TOP 100 → 각 트랙 이름 아래 작은 보라 테두리 배지(장르명)
3. 플레이리스트 탭 → 카드 썸네일이 2x2 커버 그리드
4. 맵 → 가구 앞에 캐릭터 나타나는지 (이전에 가려졌던 의자/책상 뒤 위치)
5. `디렉터_영입_시스템_설계_v38.md` 읽어보고 결정 지점 4개 답변

---

## v39 - 2026-04-24 - 디렉터 영입 시스템 Phase 1 MVP 구현

### 요청 작업
v38 설계 문서 기반 Phase 1 MVP 전체 구현.

### 수행 결과
| 항목 | 상태 | 핵심 |
|------|------|------|
| 카탈로그 | ✅ | 9명 디렉터 하드코딩 (작사 5 / 작곡 2 / 이미지 1 / MV 1 / 아티스트 1) |
| gemsStore | ✅ | in-memory 잔액 + 거래 로그 (최근 100건). earn/spend/initIfEmpty |
| directorsStore | ✅ | hiredIds / selectedByCategory / hire / selectForCategory / getSelectedModelKey / initIfEmpty |
| DirectorLineupScreen | ✅ | 카테고리별 2열 그리드, 별점(tier), 영입/선택/잔액 부족 분기 |
| 라우트 등록 | ✅ | App.tsx RootStack에 DirectorLineup 추가 |
| 헤더 💎 잔액 | ✅ | 작업실 헤더에 잔액 Pill, 탭 시 영입 화면 이동 |
| 디렉터 선택 모달 | ✅ | 작사 디렉터 2명 이상이면 캐릭터 클릭 시 모달, 선택 후 대화 진행 |
| 캐시 지급 훅 | ✅ | LyricsLoading(30) / MusicLoading(50, 2곳) / CoverGeneration(20) / 광고 시청(+5) |
| modelKey 바인딩 | ✅ | LyricsPromptReview & MusicGeneration에서 선택된 디렉터의 modelKey로 startTask |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `data/directors.ts` | **신규** — DirectorCatalog interface, DIRECTOR_CATALOG 9명, INITIAL_DIRECTOR_IDS, GEM_REWARDS/COSTS |
| `stores/gemsStore.ts` | **신규** — zustand 잔액/거래 로그 |
| `stores/directorsStore.ts` | **신규** — 영입 + 선택 상태 관리 |
| `screens/DirectorLineupScreen.tsx` | **신규** — 영입 UI |
| `App.tsx` | DirectorLineup import + RootStackParamList + RootStack.Screen |
| `screens/MapScreen.tsx` | useGemsStore/useDirectorsStore import, 로그인 시 initIfEmpty 실행, 헤더 💎 잔액 Pill, 작사 디렉터 선택 모달, 광고 시청 +5 💎 보너스, 관련 스타일 추가 |
| `screens/LyricsPromptReviewScreen.tsx` | useDirectorsStore import, startTask에 getSelectedModelKey('lyricist') 전달 |
| `screens/MusicGenerationScreen.tsx` | selectedModel 기반 dirType/modelKey 결정 후 startTask 호출 |
| `screens/LyricsLoadingScreen.tsx` | 가사 생성 성공 시 earn(30) |
| `screens/MusicLoadingScreen.tsx` | 음악 완료 2곳 earn(50) + trackId refId |
| `screens/CoverGenerationScreen.tsx` | handleConfirm에 earn(20) |
| `PLAN.md` | v39 계획 추가 |
| `REPORT.md` | v39 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항 및 후속 작업 (v40 이후)

- **Persist 미설정**: AsyncStorage 미설치로 zustand persist 적용 불가 → 앱 재시작 시 잔액/영입 초기화됨. `initIfEmpty`가 자동으로 재지급하는데, 이 동작은 **매번 가입 보너스(100💎) 지급** = 현 단계 의도 (MVP 데모). 프로덕션 배포 전 반드시 AsyncStorage persist 추가 필요
- **백엔드 미연동**: 실제 서비스 시 gem 잔액 서버 측 검증 필요. 현재는 전적으로 클라이언트 상태 → 조작 가능. v40 백엔드 스펙 전달 예정
- **modelKey 경로**: timerStore.startTask의 세 번째 인자는 이미 존재했으나 이전까지 활용 안 됨. 이제 디렉터별 실제 대기번호/틱 간격이 다른 모델 설정(`MODEL_QUEUE_CONFIG`) 적용됨. 예) 오퍼스 영입 후 작사 시 자연대기 100~175분
- **wondera/composer 구분**: 맵에서 Suno 방과 Wondera 방이 별도 타일이라 각자 다른 DirectorType. musicStore.selectedModel이 실제 모델 디스패치 기준
- **선택 모달 범위**: 현재 작사만 적용. 작곡은 각 방이 1명 카테고리라 모달 불필요. 후속에 같은 카테고리 디렉터 추가 시 그대로 확장

### 사용자 확인 (Expo Go, `--clear` 권장)
1. 로그인 직후 작업실 헤더 오른쪽에 **💎 100** 표시
2. 💎 탭 → 영입 화면 오픈 → **미니 / 원더라 / 지민 / 해나**만 "선택됨" 상태, 나머지는 가격 표시
3. 곡 생성 (작사→작곡→커버) 완료 시마다 잔액 증가 확인 (+30 / +50 / +20)
4. 광고 시청 (단계 스킵) 시 **+5 💎** 증가
5. 영입 화면에서 **소네트(800💎)** 영입 (100+30+50+20+5×N 모아 도달)
6. 다시 맵 → 작사 디렉터 클릭 시 **"어느 분께 맡기시겠어요?"** 모달 등장
7. 소네트 선택 후 대화 진행 → timerStore가 실제로 `lyrics_claude_sonnet` 모델 설정 (대기번호 60~100) 사용 확인

---

## v40 - 2026-04-25 - 자동재생 / Wondera 제거 / 아티스트 디렉터 흐름 정비 6건

### 요청 6건 모두 반영

| # | 요청 | 결과 |
|---|------|------|
| 1 | 풀↔미니 전환 시 다음 곡 자동 재생 끊김 | ✅ PlayerScreen onPlaybackStatusUpdate.didJustFinish에서 navigation.replace로 다음 곡 진입 |
| 2 | Wondera 제거 / "작곡 디렉터" 단일 표기 | ✅ 맵 + 카탈로그 + 라벨 + startTask 정리 |
| 3 | 아티스트 디렉터 Dialogue 진입 + safe area + 얼굴 포트레이트 | ✅ Dialogue 우회 + ROOT_TARGETS 분기 + 44x44 비율 유지 + insets.bottom |
| 4 | 광고 샘플 5개 fallback | ✅ ArtistDirectorScreen SAMPLE_ITEMS |
| 5 | /character/refine 422 | ✅ sheet_image+photo+refine_request 필드로 재작성 |
| 6 | 속옷 캐릭터 + 재생성 불가 + 코디 분리 | ✅ Step 재설계, baseAttire prepend, 다시만들기 제거 |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `screens/PlayerScreen.tsx` | onPlaybackStatusUpdate didJustFinish에 자동 다음 곡 navigation.replace |
| `screens/MapScreen.tsx` | DIRECTORS에서 wondera 제거, DIRECTOR_NAMES/ROLES 통일, wondera 분기 제거, artist 분기를 Dialogue 호출로 변경 |
| `screens/DialogueScreen.tsx` | case 'artist' dialogue 확장(3노드+선택지), handleAction/handleChoice에 ROOT_TARGETS + goBack 분기 |
| `screens/MusicGenerationScreen.tsx` | wondera 분기 제거, startTask('composer','작곡','composer') 고정 |
| `screens/DirectorLineupScreen.tsx` | CATEGORY_LABEL composer/wondera 통일, order에서 wondera 제거 |
| `data/directors.ts` | cmp_wondera 삭제, cmp_suno hireCost 0/isDefault, INITIAL_DIRECTOR_IDS suno로 |
| `screens/ArtistDirectorScreen.tsx` | Step 7→7개 재정의, SAMPLE_ITEMS 더미, 포트레이트 사이즈 44+비율, paddingBottom+insets, handleGenerate에 baseAttire prepend, handleSave→cody, handleApplyOutfit 신설(refine 호출), handleRefine 필드 수정, handleRegenerate 제거, preview 3버튼 재구성 |
| `PLAN.md` | v40 계획 |
| `REPORT.md` | v40 결과 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **#1 navigation.replace 패턴**: PlayerScreen이 unmount되며 sound 정리 → mount 시 새 trackId로 loadAndPlay 자동 트리거. 별도 라이프사이클 관리 불필요. 미니로 다시 줄여도 store 유지되므로 상태 일관됨
- **#2 wondera 보존**: DirectorType enum에서 'wondera'는 남겨둠 (Character.tsx의 SPRITE_SHEETS에 wondera_director.png 있음). 추후 다시 등장시킬 가능성에 대비. 단 맵에서 노출은 안 됨
- **#3 ROOT_TARGETS**: StudioStack 안에서 RootStack 라우트로 점프해야 하는 케이스(ArtistDirector, ArtistDetail, DirectorLineup, Player, Settings)에 한해 parent navigator 호출. dialogue node 시스템을 깨지 않으면서 확장
- **#3 포트레이트 비율**: 95x405 sprite를 44x44에 cover하면 가로 맞춤 → 세로 187 → 위 44만 보임 (머리). 다른 사이즈 sprite도 동일 비율 공식이라 자동 호환. 필요시 lyricist(119x405) 등에 동일 패턴 가능
- **#4 SAMPLE_ITEMS**: image_object_name 없이 만들어 회색 placeholder로 표시. 실제 광고 등록되면 자동 대체
- **#5 refine 필드**: 백엔드 character.py:154-159 기준. sheet_image와 photo는 File, refine_request는 Form 문자열. previewUrl(현재 시트 URL) + photoUri(원본 사진) 그대로 전송 — RN FormData가 URL 기반 파일 참조 자동 처리
- **#6 흐름**:
  - 사진 → 컨셉 → 속옷 캐릭터 → 저장 → 코디 → 옷 입히기 → 다음 옷 / 끝내기
  - 캐릭터는 한 번 생성 후 재생성 X (정책). 옷만 무한 갈아입기 가능 (refine 사용)
  - 기존 캐릭터 보유자는 진입 시 myArtistCard 노출 + "옷 갈아입기" 단일 액션
- **#6 후속 작업**: 기존 myCharacter가 있을 때 previewUrl을 자동 설정하는 로직(백엔드의 character preview endpoint URL)이 필요. 이번 PR에선 새로 만든 직후 흐름만 매끄럽고, 다음 세션 진입 시 옷 갈아입기는 백엔드 URL 추가로 보강 예정

### 사용자 확인 (Expo Go, `--clear` 권장)
1. 차트 → 곡 재생 → 미니 토글 → 풀스크린 → 곡 끝나면 자동으로 다음 곡 시작
2. 작업실에서 작곡 디렉터 1명만 (Wondera 사라짐)
3. 아티스트 디렉터 클릭 → 대화창에서 인사 → 시작하기 → 아티스트 생성 화면
4. 원형 포트레이트에 얼굴 보임 / 하단 버튼이 홈 인디케이터에 안 잘림
5. 코디 모달 → 등록된 광고 없으면 샘플 5개 자동 노출
6. 사진 → 컨셉 → 속옷 차림(흰 민소매 + 검정 쫄바지) 캐릭터 생성
7. preview에서 "옷 입히러 가기" → 코디 → "이 옷으로 입혀보기" → 옷 입은 시트 (422 없음)
8. preview에서 "이 부분 수정" 텍스트 → 미세조정 성공

---

## v41 - 2026-04-27 - AsyncStorage persist + 아티스트 디렉터 6단계 대화 + previewUrl 자동 + 프로필 수정 백엔드 요청

### 요청 5건 모두 반영

| # | 요청 | 결과 |
|---|------|------|
| A | gems / directors / player store AsyncStorage 영속화 | ✅ zustand `persist` + `@react-native-async-storage/async-storage` 적용 |
| B-1 | DialogueScreen 'artist' 노드 정리 (시작 선택지 제거) | ✅ 노드 3개 → 2개, 노드 2의 action으로 자동 ArtistDirector 진입 |
| B-2 | 단조로운 컨셉 입력을 6단계 질문으로 분할 (머리/얼굴/피부/체형/키/분위기) | ✅ `'questioning'` step + qIndex + 칩 토글 + [건너뛰기]/[다음] |
| B-3 | 기존 캐릭터 보유자 진입 시 previewUrl 자동 | ✅ `/character/me` 응답의 `preview_url` 즉시 setPreviewUrl |
| C | 닉네임/비밀번호 변경 백엔드 부재 → 요청서 작성 | ✅ `백엔드_요청_프로필수정.md` 신규 |

### 파일 변경

| 파일 | 변경 |
|------|------|
| `package.json` / `package-lock.json` | `@react-native-async-storage/async-storage` 추가 (expo SDK 54 호환) |
| `stores/gemsStore.ts` | `persist({ name: 'gems-storage-v1', storage: AsyncStorage, partialize: balance + transactions })` |
| `stores/directorsStore.ts` | `persist({ name: 'directors-storage-v1', partialize: hiredIds + selectedByCategory })` |
| `stores/playerStore.ts` | `persist({ name: 'player-storage-v1', partialize: track + queue + currentIndex })`. sound(native)·isPlaying·position·duration·isPlayerScreenOpen은 휘발 |
| `screens/DialogueScreen.tsx` | `case 'artist'` 노드 3개 → 2개. 노드 2에 `action: 'navigate:ArtistDirector'`로 자동 진행. 멘트 살짝 다듬음 ("얼굴 사진 한 장과 캐릭터의 인상만 알려주시면…") |
| `screens/ArtistDirectorScreen.tsx` | **6단계 대화로 재구성**. Step에 `'questioning'` 추가, `'style_text'` 제거. `QUESTIONS` 상수 (key/short/question/chips/placeholder), `StyleAnswers` 인터페이스, `handleChipTap`(토글), `handleAnswerNext`(skip 포함), `buildFinalText`. `useEffect`의 `/character/me` 응답에서 `preview_url`이 있으면 즉시 `setPreviewUrl` + `setPreviewObjectName`. styles에 `qProgress`, `chipsRow`, `chip`, `chipSelected`, `chipText`, `chipTextSelected` 추가. 기존 `existingPreview` 변수 제거하고 `previewUrl` 직접 사용 |
| `백엔드_요청_프로필수정.md` | **신규** — `PATCH /api/auth/me/profile`, `PATCH /api/auth/me/password` 스펙. 요청/응답 스키마, 에러, 검증 규칙, 모바일 후속 작업 명시 |
| `PLAN.md` | v41 계획 추가 |
| `REPORT.md` | v41 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **A persist 정책**: 
  - `gems` 영속 = 잔액·거래 → 앱 재시작 후 잔액 유지, 100💎 자동 재지급 안 됨 (`initIfEmpty`가 빈 상태에서만 동작하므로)
  - `directors` 영속 = 영입 목록·카테고리별 선택 → 앱 재시작 후 영입 유지
  - `player` 영속 = 마지막 트랙·큐·인덱스만 → sound 객체는 native module이라 직렬화 불가, isPlaying/position 같은 실시간 상태도 의도적으로 휘발
- **A hydration 깜박임**: 첫 진입에 hydration 끝나기 전 잔액이 0으로 잠깐 보일 수 있음. MVP에선 무시. 필요시 `onRehydrateStorage` + 로딩 게이트 추가
- **B-1 자동 진행 동작**: 노드 2의 `action`은 `handleTap` 내부에서 처리 — 사용자가 화면을 한 번 탭하면 ROOT_TARGETS 분기로 `navigation.getParent()?.navigate('ArtistDirector')`. 선택지 없이 자연스러운 진행
- **B-2 칩 토글**: 칩 탭 시 입력창 텍스트에 토큰 추가. 이미 있으면 제거(토글). 콤마 구분 파싱 → 사용자가 자유 입력 텍스트와 칩을 섞어도 정상 처리
- **B-2 finalText 합성 예시**: `머리는 검정 단발, 얼굴은 큰 눈, 피부는 자연스러운, 체형은 마른, 키는 보통, 분위기는 도시적`. 빈 항목은 자동 제외. 모두 빈 경우 baseAttire만 전송 (기존 "건너뛰기 전부" 동작과 동일)
- **B-2 실패 복귀**: 마지막 단계에서 `/character/generate-sheet` 실패 시 `qIndex = 마지막`, `step = 'questioning'`으로 복귀해서 사용자가 분위기 답변을 수정 후 재시도 가능
- **B-3 영속 안 함**: persist는 store에만 적용. ArtistDirectorScreen의 `previewUrl`은 useState 로컬 state — 매 진입 시 `/character/me`로 다시 가져옴. 서버 정답이 우선이므로 의도된 동작
- **C 백엔드 grep 결과**: `0_platform_music/backend/app/routes/auth.py`에 PATCH/PUT 라우트 부재. profile_image 업데이트만 `upload.py`로 가능. 닉네임/비밀번호/bio/display_title/company_name 모두 변경 엔드포인트 없음 → 요청서 작성. 프론트 구현은 백엔드 반영 후 후속 PR

### 사용자 확인 (Expo Go, `--clear` 권장)

1. 곡 생성 → 잔액 +30/+50/+20 적립 → **앱 종료 → 재시작 → 잔액 그대로** (100💎 보너스 다시 안 들어옴)
2. 영입 화면에서 디렉터 영입 → 앱 재시작 → 영입 유지
3. 차트 곡 재생 → 앱 재시작 → 미니플레이어에 마지막 곡 표시 (sound는 새로 로드 필요)
4. 작업실 → 아티스트 디렉터 클릭 → 인사 2개 후 **선택지 없이** 자동으로 ArtistDirector 진입
5. 사진 올리기 → 6단계 질문 차례대로 진행:
   - "1 / 6 · 머리" 진행 표시
   - 칩 탭 → 입력창에 토큰 추가, 다시 탭 → 제거
   - [건너뛰기] / [다음] 버튼
   - 마지막 단계에서 [만들기] → generating
6. 기존 캐릭터 보유자가 진입 → 상단 카드에 **현재 아티스트 이미지 자동 표시** → "옷 갈아입기" → cody 단계 → "이 옷으로 입혀보기" → 422 없이 성공
7. `백엔드_요청_프로필수정.md` 파일 확인 — 백엔드 담당자에게 전달

---

## v42 - 2026-04-27 - 아티스트 디렉터 화면 분리 + timerStore 통합 + 옷 카테고리 8개 확장

### 요청 5건 모두 반영

| # | 요청 | 결과 |
|---|------|------|
| 1 | 작사·작곡처럼 단계+대기 패턴으로 분리 | ✅ Input/Loading/Result/Cody 4 화면 + timerStore 'artist' 통합 |
| 2 | "만들기" 후 단계적 진행 → 큐 끝나면 시트 표시 | ✅ ArtistLoading: API + 큐 동시 진행, **둘 다 충족 시** ArtistResult로 navigation.replace |
| 3 | 미세조정도 단계적 대기 | ✅ ArtistResult → ArtistLoading(refine, modelKey: artist_refine, 5~8분 대기) |
| 4 | 옷 입히기도 단계적 대기 | ✅ ArtistCody → ArtistLoading(outfit, modelKey: artist_outfit, 5~8분 대기) |
| 5 | 옷 카테고리 8개로 확장 | ✅ 상의/하의/신발 + 헤어스타일/헤어컬러/악세서리/안경/문신 |

### 파일 변경

| 파일 | 변경 |
|------|------|
| `stores/characterTaskStore.ts` | **신규** — `mode`/`apiResult`/`apiError`/`photoUri`/`photoName` 공유 store. `startTask`는 apiResult 보존 (refine/outfit이 base sheet 재사용) |
| `stores/timerStore.ts` | `DIRECTOR_STAGES.artist`를 캐릭터 만들기용 6단계로 교체 (페이스 분석 → 시트 완성). `artist_refine` / `artist_outfit` 4단계 추가. `MODEL_QUEUE_CONFIG`에 두 모델(minQueue 15~25, tickIntervalSec 18s) 추가, 기존 `artist` 라벨을 '아티스트 캐릭터'로 변경 |
| `screens/ArtistInputScreen.tsx` | **신규** — welcome + 6단계 질문(머리/얼굴/피부/체형/키/분위기). 마지막 [만들기] → characterTaskStore.startTask + ArtistLoading replace. 기존 캐릭터 보유 시 카드에 "옷 갈아입기/미세조정"으로 ArtistResult 진입 |
| `screens/ArtistLoadingScreen.tsx` | **신규** — mode(sheet/refine/outfit) 분기 API 호출 + timerStore.startTask + tickForType 인터벌 + 단계 메시지(progress %). 광고 시청 단축 버튼 + "작업실로 돌아가기" 버튼 (백그라운드 진행). 큐 0 + apiDone 둘 다 충족 시 ArtistResult로 replace |
| `screens/ArtistResultScreen.tsx` | **신규** — preview 표시 + 미세조정 입력 + [옷 입히기/저장/돌아가기]. 미세조정/옷입히기는 ArtistLoading replace로 이동. apiResult 비어있으면 `/character/me`로 hydrate (myCharacter 진입 케이스) |
| `screens/ArtistCodyScreen.tsx` | **신규** — 8 카테고리 그리드, 카테고리별 모달(샘플 5개 fallback), 다중 선택, "이 옷으로 입히기" → ArtistLoading(outfit) replace. 길게 누르면 카테고리 선택 해제 |
| `screens/ArtistDirectorScreen.tsx` | **삭제** — 기능을 4개 화면으로 분리하면서 더 이상 불필요 |
| `App.tsx` | `ArtistDirector` import/route 제거. `ArtistInput`/`ArtistLoading`/`ArtistResult`/`ArtistCody` 4개 RootStack 라우트 추가. RootStackParamList 갱신 |
| `screens/DialogueScreen.tsx` | artist case 노드 2의 `action: 'navigate:ArtistDirector'` → `'navigate:ArtistInput'`. ROOT_TARGETS 배열에 신규 4개 라우트 추가 |
| `screens/MapScreen.tsx` | 코멘트만 갱신 (ArtistInput으로 이동) — 실제 navigation은 Dialogue를 거치므로 별도 변경 없음 |
| `PLAN.md` | v42 계획 추가 |
| `REPORT.md` | v42 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **흐름 도식**:
  ```
  MapScreen artist 클릭
    → DialogueScreen (인사 2개, 노드 2의 action으로 자동 진행)
    → ArtistInput (사진 업로드 + 6 질문)
    → [만들기] → ArtistLoading(sheet) [API + 큐 + 단계]
    → 큐 0 + API → ArtistResult [preview]
       ├─ 미세조정 → ArtistLoading(refine) → ArtistResult 복귀
       ├─ 옷 입히기 → ArtistCody → ArtistLoading(outfit) → ArtistResult 복귀
       └─ 저장 → /character/save → MainTabs로
  ```
- **API + 큐 동기화 정책**: ArtistLoading의 useEffect가 `apiDone && queueNumber <= 0` 둘 다 충족 시 navigation.replace. API가 빠르면 큐가 다 줄 때까지 단계 진행 메시지 유지, 큐가 빠르면 (광고로 단축) "마무리 중이에요..." + 스피너로 API 대기. 사용자가 요청한 "단계적 진행 후 시트 표시" 요건 충족
- **백그라운드 진행**: ArtistLoading에서 "작업실로 돌아가기" 누르면 MapScreen으로 이동. timerStore의 task는 그대로라 자연 진행 + MapScreen의 캐릭터 위 진행 표시 활용 가능. 단 큐 0 도달 시 자동으로 ArtistResult로 점프하는 watcher는 ArtistLoading 화면 안에서만 동작 → 백그라운드 진행 후 사용자가 다시 디렉터 클릭하면 Dialogue → ArtistInput → "옷 갈아입기/미세조정"로 결과 화면 진입 가능
- **광고 시청 단축**: 현재는 실제 광고 SDK 없이 즉시 reduceQueue + Alert. 향후 AdMob 통합 시 동일 콜백 위치
- **사진 영속**: photoUri는 characterTaskStore에 저장돼 refine/outfit 시 재사용. 단 디바이스 캐시 URI라 앱 재시작 후엔 무효화될 수 있음 → refine/outfit 흐름은 현 세션 내 동작 보장. 다음 세션 진입 시는 사진 다시 업로드 필요 (myCharacter는 백엔드에 저장돼 있어 base sheet는 OK)
- **8 카테고리**: 백엔드 `/business/ads/active`는 알 수 없는 카테고리에 대해 빈 배열 응답할 가능성 → 모두 SAMPLE_ITEMS로 fallback. 백엔드 수정 없이 동작
- **새 카테고리 백엔드 등록**: 광고 등록 화면(웹)에서 헤어스타일/헤어컬러/악세서리/안경/문신 카테고리도 등록할 수 있도록 백엔드 enum 확장 필요할 가능성 → 추후 별도 백엔드 요청서로
- **미세조정 → 옷 입히기 순서**: ArtistResult에서 둘 다 가능. 사용자 요청대로 미세조정 후 옷 입히기 자연스러운 순서 가능. 옷 입은 시트도 다시 미세조정 가능 (반복 가능)
- **`artist_refine`/`artist_outfit` 큐 시간**: 기본값 minQueue 15~25, tickIntervalSec 18s = 4~7분. sheet 모드(10~17분)보다 짧게. 광고로 더 단축 가능

### 사용자 확인 (Expo Go, `--clear` 권장)

1. 작업실 → 아티스트 디렉터 클릭 → 인사 2개 → 자동으로 ArtistInput 진입
2. 사진 올리기 → 6단계 질문(머리/얼굴/피부/체형/키/분위기) → 마지막 [만들기]
3. ArtistLoading: 페이스 분석 → 인상 잡기 → ... 단계 진행. 광고 시청 시 즉시 단축. "작업실로 돌아가기"로 백그라운드 진행 가능
4. 큐 0 + API 완료 → ArtistResult로 자동 이동, 캐릭터 시트 표시
5. 미세조정 입력 → "이 부분 미세조정 (대기 필요)" → ArtistLoading(refine) → 4단계 진행 → ArtistResult 복귀
6. "옷 입히러 가기" → ArtistCody → 8 카테고리 그리드 → 여러 카테고리 선택 → "이 옷으로 입히기 (대기 필요)" → ArtistLoading(outfit) → 4단계 진행 → ArtistResult 복귀
7. [저장] → 작업실 복귀
8. 다시 아티스트 디렉터 진입 시 → ArtistInput 상단에 기존 아티스트 카드 → "옷 갈아입기/미세조정" → ArtistResult로 직접 진입 (`/character/me`로 hydrate)
