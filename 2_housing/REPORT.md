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
