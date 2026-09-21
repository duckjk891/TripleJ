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

---

## v43 - 2026-04-28 - 아티스트 레벨업 + 기획사 레벨업 시스템 (Phase 4 sub 1)

### 요청 작업
디렉터가 아닌 **사용자가 만든 아티스트** + **기획사 본인**이 레벨업하는 매니지먼트 메타 도입.

### 수행 결과

| 항목 | 상태 | 핵심 |
|------|------|------|
| 아티스트 레벨업 시스템 | ✅ | `artistStore` + 칭호(신인→레전드) + EXP 곡선 |
| 기획사 레벨업 시스템 | ✅ | `companyStore` + 등급(인디→글로벌) + EXP 곡선 |
| 레벨업 토스트 | ✅ | `LevelUpModal` 전역 mount, 큐 기반 순차 표시 |
| EXP 트리거 | ✅ | 곡 발매·재생 완료·디렉터 영입·💎 사용 4곳 |
| MapScreen 헤더 칩 | ✅ | 기획사 등급 + (캐릭터 보유 시) 아티스트 칭호 |
| Persist | ✅ | AsyncStorage 영속화 (앱 재시작 후 유지) |

### 파일 변경

| 파일 | 변경 |
|------|------|
| `data/levels.ts` | **신규** — `getArtistRank` / `getCompanyTier` / EXP 곡선 / 보너스 함수. 5단계 칭호 (신인 🌱 → 라이징 ⭐ → 인기 🔥 → 톱스타 👑 → 레전드 💎), 4단계 등급 (인디 🏠 → 중소 🏢 → 메이저 🏛️ → 글로벌 🌐) |
| `stores/artistStore.ts` | **신규** — exp/level/songsReleased/totalPlays. `addExp(delta, source)` — 한 번 호출에 다단계 레벨업 처리, 매 레벨업마다 levelUpQueue enqueue + gemsStore에 보너스 💎 earn. AsyncStorage persist |
| `stores/companyStore.ts` | **신규** — exp/level/totalSongs/totalDirectorsHired/totalSpent. `addExp(delta, source)` 동일 패턴 + `trackSpend(gemAmount)` — 누적 사용량이 100💎 단위 임계값 통과 시 +5 EXP |
| `stores/levelUpQueueStore.ts` | **신규** — `LevelUpEvent` 큐 (kind/newLevel/rankLabel/emoji/bonus). `enqueue` / `dequeue` |
| `components/LevelUpModal.tsx` | **신규** — 전역 토스트 컴포넌트. slide-in/fade-in 애니메이션, 3.5s 자동 dismiss, 사용자 탭 즉시 닫힘. 큐가 있으면 첫 번째 이벤트 표시 후 dequeue → 다음 이벤트 자동 |
| `App.tsx` | RootStack 외각에 `<LevelUpModal />` 전역 mount (모든 화면 위에 zIndex 9999) |
| `screens/MapScreen.tsx` | 헤더 칩에 기획사 등급(emoji+Lv) / 아티스트 칭호(`songsReleased > 0`일 때만) 추가. levelPill 스타일 추가 |
| `screens/MusicLoadingScreen.tsx` | 곡 완성 직후 (polling/direct 모두) `useArtistStore.addExp(50, 'release')` + `useCompanyStore.addExp(30, 'release')` |
| `screens/PlayerScreen.tsx` | `didJustFinish` 시 `useArtistStore.addExp(1, 'play')` (자동 다음곡 분기 전에 호출되어 trigger 보장) |
| `screens/DirectorLineupScreen.tsx` | 디렉터 영입 시 `useCompanyStore.addExp(20, 'hire')` + 유료 영입은 `trackSpend(hireCost)`로 누적 추적. 무료 영입(hireCost === 0)도 +20 EXP 적립 |
| `PLAN.md` | v43 계획 추가 |
| `REPORT.md` | v43 결과 기록 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **EXP 곡선**:
  - 아티스트: Lv N → N+1 = `100 * N` EXP. Lv1→2 = 100, Lv2→3 = 200, …
  - 기획사: Lv N → N+1 = `200 * N` EXP. 기획사가 두 배 더 천천히 성장
- **레벨업 보상**: 모두 고정 (아티스트 +50💎 / 기획사 +100💎). 추후 `level × 10` 식으로 곡선화 가능
- **다단계 레벨업 처리**: `addExp` 함수 안에서 `while (exp >= expForNextLevel(level))`로 처리해 한 번 호출에 여러 레벨 점프 가능. 각 레벨마다 토스트 enqueue + 보너스 지급
- **TrackSpend 정책**: gemsStore.spend 함수 자체는 안 건드림 (느슨한 결합). 대신 `companyStore.trackSpend(amount)`를 직접 호출하는 위치는 현재 DirectorLineupScreen만. 향후 다른 spend 위치 추가 시 같은 패턴
- **칭호 표시 조건**: 아티스트 칩은 `songsReleased > 0`일 때만 (캐릭터만 만들고 곡은 안 낸 사용자는 숨김). 기획사 칩은 항상 표시
- **레벨업 토스트 큐**: 동시 레벨업(아티스트+기획사 둘 다 한 번에) 시 순차 표시. 첫 토스트 dismiss 후 다음 자동 진입
- **AsyncStorage persist**: `artist-storage-v1`, `company-storage-v1` 키. v41에서 도입한 zustand persist 패턴 그대로 사용
- **재생 카운트 정책**: 현재는 `didJustFinish` (곡 끝까지 재생) 한정. 50% 이상 등 정책은 v44~ 정교화
- **좋아요 EXP 미반영**: 백엔드에 `/likes/{track_id}` POST/DELETE는 있으나 "내 트랙들이 받은 좋아요 수"는 클라이언트 측에서 폴링하기 부담. v44에서 `/tracks/my` 응답에 likes_count 필드 활용 검토

### 사용자 확인 (Expo Go, `--clear` 권장)

1. **첫 진입**: MapScreen 헤더 우측에 `🏠 Lv.1` (인디 1단계) 칩 + `💎 100` 잔액 칩
2. **곡 만들기**: 작사 → 작곡 → 커버 (완성) → MusicLoading 종료 시 토스트 미발생 (EXP 100 미달). MapScreen 복귀 시 칩 동일
3. **곡 2~3개 만들고 재생까지 하면**: 아티스트 EXP 100 도달 → "🎉 아티스트가 Lv.2! 라이징 · 보너스 +50💎" 토스트
4. **디렉터 영입 5명+ 곡 발매 누적**: 기획사 EXP 200 도달 → "🎉 기획사가 Lv.2! 인디 · 보너스 +100💎" (Lv.5 도달 시 "중소"로 등급 변경)
5. **앱 종료 → 재시작**: 레벨/EXP/카운트 모두 유지
6. **헤더 칩 확인**: 캐릭터 만들고 곡 1개라도 발매하면 아티스트 칭호 칩(`🌱 Lv.1`) 등장

---

## v44 - 2026-04-28 - 음원 다운로드 결제 시스템 + 가상 팬덤 재생 시뮬레이션 (Phase 4 sub 2)

### 요청 작업
- 사용자가 만든 음원이 자동으로 본인 저작권 → 다른 사용자 다운로드 시 실제 ₩ 결제로 정산
- 듣기는 무료, 다운로드만 유료
- 가상 팬덤이 매일 발매 곡을 들어주는 시뮬레이션 (인기도 EXP 기여)

### 가격 정책 (확정안 A 적용)
- 곡당 ₩500 / 부가세 9% / PG 3% / 플랫폼 22% / **Creator 66% (₩341)**

### 수행 결과
| 항목 | 상태 | 핵심 |
|------|------|------|
| 가격 분해 헬퍼 | ✅ | `data/pricing.ts` — `splitRevenue()` |
| 결제 mock 모달 | ✅ | `PurchaseModal` — 가격 분해 + 라이선스 체크 + 결제 안내 Alert |
| PlayerScreen 다운로드 버튼 | ✅ | 액션 버튼 영역에 `💿 ₩500` (본인 곡은 무료 안내) |
| 정산 화면 | ✅ | `RoyaltyScreen` — 누적 매출/출금 가능액/가격 분해/활동 통계 |
| 정산 store (placeholder) | ✅ | `royaltyStore` — 백엔드 부재 시 0원, syncFromServer 준비 완료 |
| 가상 팬덤 시뮬레이션 | ✅ | `fanSimulationStore` — 24h 갭 체크, 일일 재생수 계산, artistStore.addExp 연결 |
| Settings → 내 정산 메뉴 | ✅ | RoyaltyScreen 진입 |
| MapScreen 진입 시 시뮬 실행 | ✅ | useEffect로 `runIfDue()` 호출, 결과 있으면 Alert |
| 백엔드 요청서 | ✅ | `백엔드_요청_저작권정산.md` — DB 5개 테이블, API 6개, PG 통합, 정산 정책 |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `data/pricing.ts` | **신규** — 가격 상수 + `splitRevenue()` + `formatKrw()` |
| `stores/royaltyStore.ts` | **신규** — 누적 매출/출금 가능액 placeholder + persist + `syncFromServer()` |
| `stores/fanSimulationStore.ts` | **신규** — `runIfDue()` 24h 갭 시뮬 (최대 7일치 누적) + persist. 발매 곡 0개면 skip |
| `components/PurchaseModal.tsx` | **신규** — 슬라이드업 모달, 가격 분해(부가세/PG/플랫폼/creator), 라이선스 동의 체크박스, 결제 mock Alert |
| `screens/RoyaltyScreen.tsx` | **신규** — 큰 매출 카드 + 가격 분해 + 활동 통계. 출금 버튼은 `availableKrw < ₩10,000`이면 disabled |
| `screens/PlayerScreen.tsx` | 액션 버튼에 `💿 ₩500` 추가. `currentUser.id === track.uploader_id`로 본인 곡 분기. PurchaseModal mount |
| `screens/MapScreen.tsx` | useEffect로 `useFanSimulationStore.runIfDue()` 호출 + 결과 있으면 일일 청취 리포트 Alert |
| `screens/SettingsScreen.tsx` | 계정 관리 마지막 행에 "💸 내 정산" 메뉴 추가 |
| `App.tsx` | RootStack에 `Royalty` 라우트 + RoyaltyScreen import |
| `백엔드_요청_저작권정산.md` | **신규** — 8 섹션 명세서 (비즈니스, DB 5 테이블, API 6, PG, 라이선스, 사업 인프라, 모바일 후속, 우선순위) |
| `PLAN.md` / `REPORT.md` | v44 일지 추가 |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항

- **결제는 mock**: PurchaseModal의 "결제하기" 누르면 "백엔드 결제 시스템 준비 중" Alert. 실제 PG 통합은 백엔드 반영 후 v45+
- **본인 곡 분기**: `currentUser.id === track.uploader_id`. 본인 곡 다운로드는 ₩0이지만 백엔드 endpoint 필요 (`GET /tracks/{id}/download-url`)
- **가상 팬덤 시뮬 알고리즘**:
  ```
  daily = artistLevel*5 + companyLevel*3 + songsReleased*2
        + (artistLevel >= 7 ? 20 : 0) + (companyLevel >= 5 ? 10 : 0)
  result = daily × min(daysSinceLastRun, 7)
  ```
- **시뮬 첫 진입**: `lastRunAt == null`이면 즉시 보너스 X, 시점만 기록 (다음 진입부터 24h 후 첫 시뮬)
- **발매 곡 0개**: 시뮬 skip (lastRunAt만 갱신). 곡 만들기 전엔 가상 팬도 없음
- **청취 리포트 Alert**: LevelUpModal 같은 토스트로 만들 수도 있지만 v44 범위에선 Alert. 추후 통합 토스트 시스템 만들면 일관성 ↑
- **artistStore.addExp의 'play' source**: 시뮬레이션 결과를 한 번에 N회 누적. PlayerScreen `didJustFinish` 1회와 동일 함수 → totalPlays 일관 추적
- **백엔드 요청서**:
  - DB 5 테이블 (`tracks`에 컬럼 추가 + `track_purchases` / `payments` / `royalty_ledger` / `payouts` 신규)
  - API 6 (`POST /tracks/{id}/purchase`, PG webhook, royalty summary/ledger, payout request, download-url)
  - PG: 토스페이먼츠 권장 (한국 친화 + REST)
  - 사업 인프라(통신판매업/부가세/약관)는 운영팀 결정 사항으로 명시
- **출금 정책**: 최소 ₩10,000, 수수료 ₩1,000 정액. 사업소득세 3.3% 원천징수는 백엔드 처리

### 사용자 확인 (Expo Go, `--clear` 권장)

1. **다운로드 버튼**: PlayerScreen 액션 행에 `💿 ₩500` 추가 확인. 탭 → PurchaseModal 슬라이드업
2. **PurchaseModal**: 가격 ₩500 / 부가세 ₩45 / PG ₩14 / 플랫폼 ₩100 / **Creator ₩341** 분해 표시. 라이선스 체크 후 "결제하기" → "백엔드 준비 중" Alert
3. **본인 곡**: 자기가 업로드한 곡의 PlayerScreen에서 `💿` 탭 → "내 곡은 결제 없이 다운로드" Alert
4. **Settings → 내 정산**: 큰 카드(₩0 누적), 가격 분해, 활동 통계 표시. 출금 버튼은 disabled (₩10,000 미달)
5. **가상 팬덤**: 곡 1개 이상 발매한 상태에서 24h 후 앱 진입 → "📊 오늘의 청취 +N회" Alert + 아티스트 EXP 적립
6. **첫 진입**: 발매 곡 없거나 첫 사용 → 시뮬 안 돔, lastRunAt만 기록

---

## v45 - 2026-04-28 - 영수증 디렉터 수수료 분배 + Persona Model (D)

### 요청 작업
1. **추가 요청**: 플랫폼 수수료(₩100)가 작사·작곡·이미지·아티스트 디렉터에게 분배되는 명목으로 영수증에 표시
2. **D**: 작곡.md 미반영 파라미터 — Persona Model (Style/Voice). 확인 결과 Style Weight·Weirdness·Audio Weight·BPM·Key는 v40에서 이미 반영됨. **Persona Model 1개만 추가**

### 디렉터 분배 비율
| 디렉터 | 비율 | 곡당 ₩ |
|---|---|---|
| ✍️ 작사 | 30% | ₩30 |
| 🎵 작곡 | 40% | ₩40 |
| 🎨 이미지 | 15% | ₩15 |
| 🎤 아티스트 | 15% | ₩15 |

### 파일 변경
| 파일 | 변경 |
|------|------|
| `data/pricing.ts` | `DIRECTOR_FEE_SPLIT` 상수 + `splitPlatformFee()` 헬퍼 |
| `components/PurchaseModal.tsx` | 영수증 분해에 디렉터별 분배 4줄 추가 (들여쓰기 + italic) |
| `screens/RoyaltyScreen.tsx` | 가격 분해 카드에 디렉터별 분배 추가, `rowDeepSub` 스타일 |
| `stores/musicStore.ts` | `personaModel: '' \| 'style' \| 'voice'` 필드 + setter |
| `types/index.ts` | `MusicParams.personaModel?` 추가 |
| `services/musicService.ts` | generateWithSuno body에 `persona_model: params.personaModel` 추가 |
| `screens/MusicGenerationScreen.tsx` | DIRECTOR_MESSAGES 13개로 확장. case 12 라디오 UI (Style/Voice). `handlePersonaConfirm` 추가. handleGenerate에서 `musicStore.setPersonaModel` |

### 테스트 결과
| 항목 | 결과 |
|------|------|
| `tsc --noEmit` | PASS (0 errors) |

### 특이사항
- 디렉터 분배는 **명목 표시** — 실제 백엔드 정산은 플랫폼 1건으로 처리. 사용자 인지 효과 ("디렉터들이 일한 보상")
- Persona Model은 백엔드가 모르는 필드면 무시 → 하위 호환
- v40에서 이미 Suno 고급 파라미터 대부분 반영돼 있어 v45 D는 작아짐 (Persona 1개)
- v46 정정: "디렉터 의상/스킨 잠금해제" → "**아티스트 의상/악세서리 잠금해제**" (디렉터는 영입 시스템 그대로, 아티스트의 ArtistCody 8 카테고리 안 SAMPLE_ITEMS에 unlockLevel 부여)

### 사용자 확인
1. PlayerScreen → 💿 다운로드 ₩500 탭 → PurchaseModal에 가격 분해 + **플랫폼 수수료 ₩100 아래 디렉터 4명 분배** 표시
2. Settings → 내 정산 → 가격 분해 카드에 동일 분배 확인
3. 작곡 디렉터 흐름 — 키(case 11) 다음에 **페르소나 모델 단계(case 12)** 등장. Style/Voice 라디오 + 자동/적용
4. 페르소나 선택 후 곡 만들기 → musicStore에 personaModel 저장, /generate API에 persona_model 전달

---

## v3.191 — 2026-09-19 — NowPlaying(PlayerScreen) 안전 영역 준수 — 상·하단 시스템 UI 겹침 해소

**요청 원문**: "nowplaying 플레이어 화면에서 상단, 하단에 모바일 ui를 넘어서서 앱 ui가 배치되어있어. 이거 안전 영역 안으로 배치해줘야지 모바일 ui랑 겹치면 안되잖아"

### 수행 결과
- **원인**: PlayerScreen이 전 화면 중 유일하게 RN 코어 `SafeAreaView`(iOS 전용) 사용 + `app.json` `edgeToEdgeEnabled: true`(Expo SDK 54 기본) → Android에서 헤더가 상태바 아래로, 하단 상세토글이 제스처 바와 겹침.
- **수정**: `2_housing/screens/PlayerScreen.tsx` 단독(11+/4-), 프로젝트 관행(useSafeAreaInsets) 준수.
  | 지점 | 변경 |
  |---|---|
  | import(19행) | 코어 SafeAreaView 제거 → `useSafeAreaInsets`(safe-area-context ~5.6.0) |
  | 루트(797행) | `<View style=[container, { paddingTop: insets.top, paddingBottom: insets.bottom }]>` |
  | 재생목록 Modal 시트(1280행) | RN Modal은 루트 패딩 미상속 → `paddingBottom: insets.bottom + spacing.xxl` 인라인 보강 |
  | 디버그 추적자(170행) | `__DEV__` 시 `[PlayerScreen] safe-area insets { top, bottom }` |
- 이중 여백 방지: header/swipeUpButton 기존 상수 패딩 무변경, insets 사용처는 로그·루트·Modal 시트 3곳뿐. MiniPlayer는 App.tsx 래퍼가 이미 인셋 반영(무변경). 백엔드 무변경.

### 테스트 결과 요약 (TESTPLAN.md v3.191, tester 2026-09-19)
- **1차 게이트(머지) 통과**: [unit] U-1~U-10 전건 PASS (`tsc --noEmit` 기준선 0건 → 수정 후 0건, 변경 범위 PlayerScreen.tsx 단독 격리 확인). 버그 0건.
- **[e2e] 정적 대체 실행**: adb·maestro·에뮬레이터·시뮬레이터 전무 → 계획된 다운그레이드 절차 적용. E-1~E-4 PASS(정적 근거), **UNVERIFIED 2건**:
  - E-5 소형 기기(≈640dp) 토글 밀림 — coverH 산식(winH-460, 하한 180)이 인셋 패딩(48~72px)만큼 세로 슬랙 부족 가능. 기존 산식의 한계(이번 변경으로 신설된 위험 아님) — 실기기 실측 필요.
  - E-6② 동영상 탭 렌더 — 실기기 스크린샷 1장 필요.

### 특이사항
- **릴리즈 게이트는 실기기 스크린샷 확인 후 확정** 필요(에뮬레이터 부재로 E2E가 정적 대체 검증으로 다운그레이드됨 — 명기). 확인 요청: ①Android 제스처 기기 플레이어 풀샷 ②재생목록 시트 하단 ③iPhone 노치 3장(기본/상세패널/재생목록) ④소형 기기 하단 토글 ⑤동영상 탭.
- E-5는 FAIL이어도 후속 픽스 티켓 분류(기존 coverH 산식 한계) — 단독 릴리즈 보류 사유 아님.
- 산출물 정리: 2_housing/PLAN.md·REPORT.md → claude_skills_outputs/team-dev/ `git mv` 완료(v3.191부터 이 파일에 누적).

### 판정
- planner 최종 확인: **승인** — PLAN v3.191 변경 매트릭스 대비 구현 충실(diff 직접 검토), 머지 게이트 통과. preview APK 빌드 진행 가능. 릴리즈 확정은 위 실기기 확인 목록 회신 후.

---

## v3.192 — 2026-09-20 — 냥냥냥 duration 오표시 방어 보정 + 곡 제목 marquee 개행 수정 + 큐 자동추가 동작 분석 답변

**요청 원문**: "모바일에서 확인하고 있는데 냥냥냥 음악이 음악 시간보다 재생시간이 짧게 보이네. 다른 음악은 안그런데 냥냥냥만 그렇고 음악 재생진행바가 중간에 끊어지니까 노래가 남아있는데 동영상 탭에서 남아있는 가사도 안뜨고 멈춰있어. 그리고 더 나오는 것을 막는 것일뿐 음악은 곡 제목이 흘러가는 형태로 나와야하는데 개행이 되버려서 전체적인 ui가 하단으로 밀려서 하단이 잘려보이는 상황이야. 그리고 담기를 안해도 곡을 클릭하면 자동으로 재생목록에 추가가 되는 형태인가?"

> "더 나오려는 것을 막는 것일뿐"은 실제 곡 제목(201초) — 이슈 B 재현 곡.

### 수행 결과

**이슈 A — 냥냥냥 duration (원인 확정 + 프론트 방어, 완전 해결은 백엔드 후속 필요)**
- **원인(실측 확정)**: 해당 트랙(`6aa3ec295f11b57ba518f5e8`)의 MP3가 VBR(128~320kbps 혼재)인데 **Xing/VBRI 헤더 누락**. 첫 프레임 320kbps 기준 CBR 추정 91.26초 = DB `duration_sec 91`과 일치, 실제 길이는 **157.86초(2:38)**. 백엔드 duration 계산과 모바일 재생 엔진(expo-av)이 같은 원리로 같이 91초로 오판 → 진행바 조기 고정·가사 싱크 정지 표시·seek 왜곡. 대조군 2곡(Xing 있음)은 정상 — 이 파일만의 문제.
- **프론트 방어(이번 배포)**: `screens/PlayerScreen.tsx` `onPlaybackStatusUpdate` + `services/playback.ts` 상태 콜백에서 `effectiveDuration = max(엔진 durationMillis, 현재 position, API duration_sec×1000)` 단발 보정 — 재생 위치가 엉터리 duration을 넘어서면 슬라이더 max·총시간이 실시간 확장(조기 고정 방지). 70% 재생기록도 effectiveDuration 기준 통일. `__DEV__` 괴리(≥5초) 경고 트랙당 1회: `[PlayerScreen] duration mismatch` / `[playback] duration mismatch`.
- **계획 대비 편차 1건(수용)**: 계획의 "직전 duration 항 포함(래칫·단조 확장)"을 app-dev가 의도적으로 제외 — 곡 전환 시 이전 곡 duration이 새 곡에 스티키하게 남는 회귀 위험 차단. 트레이드오프로 되감기 seek 시 총시간이 일시 수축할 수 있으나(U-6, 정상곡은 영향 없음), 회귀 위험 제거가 우선이라 **수용 판정**. 의도 주석 코드에 명기.
- **한계·후속**: 이 곡의 seek 정확도·가사 싱크 완치와 70% 기록 조기 발화(세 값 모두 91초라 63.7초 발화)는 **백엔드 파일 재처리 전 해소 불가** → `2_housing/백엔드_요청_트랙duration.md` 신규 작성(① ffmpeg -c copy 재먹싱 후 동일 key 교체 + duration_sec 91→158 ② 파이프라인 디코드 실측 의무화 ③ 전 트랙 괴리 전수 점검). 파일 교체 후 앱 재배포 불요.

**이슈 B — 긴 곡 제목 개행 → 한 줄 marquee 복원**
- **원인**: `components/Marquee.tsx`의 한 줄 강제(nowrap)가 web 전용이라 네이티브에서 Text가 부모 폭 제약으로 개행 → 측정폭≈컨테이너폭이 되어 overflow 판정도 항상 false(마퀴 미발동), title1 2줄로 하단 UI 밀림·잘림.
- **수정**: 트랙을 수평 `ScrollView(scrollEnabled=false)`로 감싸 폭 제약 없는 자연폭 측정·렌더(RN marquee 정석) + 복사본 `numberOfLines=1` 이중 안전장치 + `flexGrow`로 짧은 제목 center 정렬 무회귀(v3.159). 한 파일 수정으로 PlayerScreen 제목·차트 TrackRow 동시 치유. 웹 경로(nowrap) 유지.

**이슈 C — 큐 자동 추가 (분석 보고만, 코드 무변경)**
- 사실 확인: **맞음, 의도된 설계** — 차트 곡 클릭 = `addToQueue`(중복 방지) 후 재생(ChartScreen.tsx:176 주석 명시). 검색 결과 클릭·피드/내음악 재생은 큐를 해당 목록으로 **교체**, 큐 소진 시 관련곡 이어듣기(v3.91)는 큐에 **추가**, '담기'는 명시 추가(+비회원 첫 담기 안내). 사용자에게 답변 전달 완료 — 동작 변경 여부는 사용자 결정 대기.

### 변경 파일
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/PlayerScreen.tsx | effectiveDuration 단발 max 보정 + 70% 기록 통일 + 괴리 경고 1회 가드(ref) + 단발식 의도 주석 | `[PlayerScreen] duration mismatch` |
| services/playback.ts | 동일 보정(미니/인라인 경로) + 경고 1회 가드 | `[playback] duration mismatch` |
| components/Marquee.tsx | 수평 ScrollView 자연폭 측정 + numberOfLines=1 + flexGrow center 무회귀 | — |
| 백엔드_요청_트랙duration.md (신규) | 파일 재먹싱·duration 갱신·파이프라인 개선·전수 점검 요청 | — |

### 테스트 결과 요약 (TESTPLAN.md v3.192, tester 2026-09-20)
- **[unit]** U-1~U-11·U-13 PASS(`tsc --noEmit` 0건). U-6(되감기 시 총시간 수축 깜빡임)은 단발식의 의도된 트레이드오프로 허용 판정. U-12 경미 FAIL(백엔드 문서 한계 문구 1줄 누락) → 보강 완료(70% 조기 발화 한계 1줄 + PlayerScreen 의도 주석 2줄) 후 통과. U-13 커밋 스코프 주의(변경 4파일만 스테이징).
- **[api]** A-1 실측 PASS — 공개 API에서 duration_sec=91 재확인(백엔드 미수정 상태 기준선).
- **[e2e]** 정적 대체 전 항목 PASS. E-5 웹 절반은 expo export 실측 PASS(마퀴 애니메이션 스크린샷 확인).
- **실기기 잔여 3건**: ① 냥냥냥 재생 중 총시간 확장 동작 ② 플레이어 긴 제목 마퀴(하단 잘림 소멸) ③ 차트 행 1줄 마퀴. v3.191 잔여 실기기 확인 목록과 함께 회신 요청.

### 특이사항
- **냥냥냥 완전 해결(총시간 2:38 표기·가사 완주·seek 정확)은 백엔드 파일 재처리 필요** — 백엔드_요청_트랙duration.md 참조. 교체 확인은 냥냥냥에서 DEV `duration mismatch` 경고 미출력으로 검증.
- 진단 실측은 공개 무인증 엔드포인트만 사용, 민감정보 없음.
- v3.191 안전영역 무회귀: 이번 변경은 루트 패딩·인셋 코드 미접촉(diff 확인).

### 판정
- planner 최종 확인: **승인** — PLAN v3.192 변경 매트릭스 대비 구현 충실(diff 직접 검토), 편차 1건(래칫 제외) 수용, 테스트 게이트 통과(U-12 보강 후). 커밋 진행 가능. 릴리즈 확정은 실기기 잔여 3건 확인 후.

## v3.193 — 2026-09-20 — NowPlaying 좋아요 서버 연동·담기→플레이리스트·액션행 정렬 + 비로그인 CTA 통일 + 스플래시/로고 타이포 + 토글 라벨 개편

### 사용자 요청 원문 요지
① 좋아요 후 미니플레이어 갔다 오면 하트가 풀림 ② 큐 담기가 자동이면 NowPlaying '담기'는 플레이리스트 담기여야 — 플레이리스트 담기 버튼이 있으면 위치 알려달라 ③ 하단 좋아요~신고 아이콘·텍스트 정렬 불일치 ④ 토글 '가사·프롬프트·착장·댓글' 대체 표현 제안 ⑤ 비로그인 CTA 위치가 작업실/플레이리스트/검색에서 제각각 — 작업실 기준 통일 + 검색은 "AI 음악 검색" 타이틀 ⑥ 스플래시 MY·AI·DOL 및 MAIDOL 텍스트 축소 ⑦ 상단바 MAIDOL은 AI만 강조색, 나머지 흰색 ⑧ 차트 긴 제목 마퀴 미적용 확인.

### 수행 결과 (이슈 A~H)

**A. 좋아요 하트 리셋 — 근본 수정(서버 연동)**
- 원인: PlayerScreen의 하트가 `useState(false)` 로컬 state + `setIsLiked(!isLiked)`뿐, **API 호출 자체가 없었음**. 미니플레이어 전환 = 화면 언마운트 → 재진입 시 false로 재마운트.
- 수정: 전역 `likesStore`(POST/DELETE /likes, GET /likes/check — 차트/검색 ⋮와 동일 스토어) 구독으로 교체, 곡 진입/전환 시 sync, 낙관적 토글+실패 롤백은 스토어 위임. 비로그인 탭은 로그인 안내. → 미니플레이어 왕복·앱 재시작에도 하트 유지, 차트/검색 좋아요와 양방향 일관.

**B. '담기' = 플레이리스트에 담기로 변경 + 기존 버튼 위치 답변**
- 기존 '담기'는 재생목록(큐) 추가였음 — 큐 추가는 곡 클릭 시 자동이라 중복 기능.
- 수정: 회원이 '담기' 탭 → 공용 **PlaylistPickerSheet**(기존 목록 선택/새로 만들기) 열림. 비회원은 기존 안내 팝업(로그인/계속 담기=큐) 유지. 백엔드 API 기존재로 신규 요청 없음. 아이콘 folder-plus로 교체.
- **사용자 답변**: "플레이리스트에 담기" 버튼은 원래도 있었습니다 — ① 차트·검색·피드·마이뮤직·플레이리스트 곡 목록의 **⋮(더보기) → 플레이리스트에 담기** ② 검색 결과 상단 **"모두 담기"**. NowPlaying에만 없었고 이번에 추가됐습니다.

**C. 액션행 정렬 통일**
- 원인: 좋아요(♥)·담기(+)는 24pt 텍스트 글리프(라인박스 ~32px), 나머지는 벡터 아이콘 22~24px — 높이 혼재로 라벨 시작 Y가 제각각.
- 수정: 5버튼 전부 벡터 아이콘 24(좋아요=heart/heart-outline, 담기=folder-plus) + 고정 높이 28 아이콘 박스 → 아이콘·라벨 기준선 완전 일치.

**D. 토글 라벨 — 사용자 2안(제작 스토리형) 선택·반영 완료**
- 하단 토글: "가사 · 제작 노트 · 스타일링 · 댓글", 탭 라벨: prompt='제작 노트', outfit='스타일링'. (제안 3세트 중 사용자 선택)

**E. 비로그인 CTA 통일 (기준=작업실)**
- 플레이리스트: LoginPrompt의 ♫ 아이콘 제거 → 타이틀 "나만의 플레이리스트"가 작업실 "AI 음악 작업실"과 동일 Y.
- 검색: 검색바 아래 잔여 공간 중앙(하향 치우침) → 작업실과 동일한 전체화면 딤 오버레이 정중앙 + **타이틀 "AI 음악 검색"** 추가. 배경 탭=닫기.
- 참고: 피드 CTA는 이미 오버레이 패턴이나 타이틀이 없음 — 사용자 언급 밖이라 미변경(원하면 후속).

**F. 스플래시 타이포 축소** — 1막 MY/AI/IDOL 56→40(lineHeight 74→54), 2막 MAIDOL 52→36(60→44). 심볼·부제 유지.

**G. 상단바 로고** — MAIDOL 전체 보라 → M(흰)+**AI(보라)**+DOL(흰) 분절(스플래시 2막과 동일 패턴).

**H. 차트 마퀴 — 코드 완결 확인(변경 없음)**
- v3.192의 Marquee.tsx 수정이 차트 행(TrackRow)까지 커버함을 코드로 재확인. **사용자 폰에서 안 보이는 것은 구 빌드 정상** — v3.193 빌드에 함께 포함되어 나감.

### 변경 파일 (커밋 스코프 — 이 5개만)
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/PlayerScreen.tsx | A likesStore 연동+sync / B PlaylistPickerSheet / C 아이콘 24+박스 28 / D 라벨 2안 | `[likesStore] toggle/sync`, `[PlayerScreen] toggle like`, `[PlayerScreen] open playlist picker` |
| screens/PlaylistScreen.tsx | E: LoginPrompt icon 제거 | — |
| screens/SearchScreen.tsx | E: absoluteFill 딤 오버레이 + title "AI 음악 검색" | `[SearchScreen] 미로그인 게이트` |
| screens/SplashScreen.tsx | F: 40/54·36/44 | — |
| App.tsx | G: LogoTitle M·AI·DOL 분절 | — |

### 테스트 결과 요약 (TESTPLAN.md v3.193, tester 2026-09-20)
- **25/25 PASS, FAIL 0** — unit 16/16(tsc 0건 포함, 이슈 D 라벨 반영 후 재확인), api 2/2(무인증 프로브), e2e 7/7(정적 대체).
- **실기기 잔여 6건**: ① 좋아요 → 미니 왕복 → 하트 유지 + 차트 ⋮와 상호 반영 ② 회원 담기 → 시트 담기 → 플레이리스트 탭 확인 / 비회원 폴백 무회귀 ③ 액션행 정렬 육안(본인 곡 4버튼 포함) ④ 3화면 CTA 타이틀 Y 일치 스크린샷 대조 ⑤ 스플래시 축소·상단바 로고색 ⑥ (v3.192 이월) 차트·NowPlaying 긴 제목 마퀴 + 냥냥냥 진행바.

### 특이사항
- 백엔드 신규 API 불필요(플레이리스트 CRUD 기존재). 냥냥냥 duration 백엔드 요청(v3.192)은 별도 진행 중.
- 상세 토글 접근성 라벨(accessibilityLabel="가사 프롬프트 착장")은 시각 라벨 변경과 별개로 구 문구 유지 — 후속 정리 후보(비차단).
- 민감정보 없음. v3.191(안전영역)·v3.192(duration/마퀴) 코드 미접촉 — 무회귀.

### 판정
- planner 최종 확인: **승인** — PLAN v3.193 변경 매트릭스 대비 5파일 구현 충실(diff 직접 검토), 이슈 D 2안 반영 확인, 테스트 게이트 통과. 커밋 진행 가능(5파일 스코프 한정). 릴리즈 확정은 실기기 잔여 6건 확인 후.

## v3.194 — 2026-09-20 — 소셜 로그인 APK 분석·앱 복귀 경로 + 네이버 버튼 제거 + 이모지 아이콘 1차 벡터화 + 스플래시 응원봉 제거

### 사용자 요청 원문
"지금 apk 파일로 구글 로그인 시도를 해봤는데. 로그인을 하려니까 갑자기 메일 창이 뜨길래 보내기 버튼을 한번 눌렀어. 그 다음에 다시 로그인을 누르니까 null 에 접근할 수 없습니다. 이렇게 뜨네? 카카오도 앱 관리자 설정 오류라고 뜨고. 앱스토어에서 실행하지 않아서 생기는 문제일까? 그리고 네이버로 계속하기 버튼은 우선 제거해줘. 그리고 방금 수정한 하트 아이콘은 하트누르면 아이콘 내부가 칠해지는 식으로만 되어야지. 이모지 형태로 바뀌면 안되. 이제부터 우리 앱에서는 이모지는 아이콘으로 안쓸꺼야."
- 추가 지시: ⭐(재화 '스타')는 이모지 유지 / 스플래시 응원봉(라이트스틱) 제거.

### 수행 결과

**이슈 A — 소셜 로그인(APK)**
- 원인 분석(코드 실측): 소셜 로그인은 SDK 없이 브라우저 리다이렉트 방식이었고, 콜백 수신이 웹 전용(App.tsx useOAuthCallback `Platform.OS==='web'` 가드)이라 **APK에서는 OAuth가 성공해도 토큰이 앱으로 돌아올 수 없는 구조**였음.
- "메일 창": 구글 버튼→메일 경로는 코드에 없음. 앱에서 메일을 여는 유일한 지점은 로그인 화면 소셜 버튼 바로 아래 CompanyFooter "고객센터" 링크(PolicySheet.tsx, mailto:kimpearl@lotusai.co.kr) — **오탭 가설이 최우선**. 검증법: 고객센터 수신함에서 해당 시각 빈 메일 수신 여부 확인. 차순위: 브라우저의 구글 "미인증 앱" 차단 페이지 내 개발자 문의 링크.
- "null 에 접근할 수 없습니다": 프론트 코드에 없는 문자열(전수 grep 0건). 출처 후보 ① SocialLoginButtons가 서버 503 detail을 무검증 표출 ② 구(舊) 프리플라이트 api.get()이 OAuth 302를 앱 내 XHR로 끝까지 따라가 서버 state 선점/오류 유발 ③ 백엔드 frontend_url 미설정 시 `null/oauth/callback` 류 리다이렉트. 확정은 사용자 재현 시각대 /_logs/frontend 서버 로그로(후속).
- 수정(app-dev 완료): SocialLoginButtons 전면 재작성 — 프리플라이트 제거, sanitizeServerMessage(80자·문자열 검증), 네이티브는 expo-web-browser `openAuthSessionAsync('?client=app', 'aidol://oauth/callback')` + null 가드(result?.type==='success' && result.url일 때만 파싱). App.tsx useOAuthCallback 네이티브 확장(getInitialURL+URL 리스너+dedupe). expo-web-browser ~15.0.11 설치. 백엔드 요청 문서 `백엔드_요청_소셜로그인_앱복귀.md` 발행(client=app 시 aidol:// 리다이렉트).
- "앱스토어 미설치 때문?" 답변(사용자 전달): 아니요 — APK 사이드로드 자체는 원인이 아님. 원인은 ① 구글/카카오 콘솔에 서버·리다이렉트 미등록(카카오 "앱 관리자 설정 오류"가 그 증상) ② 앱이 브라우저에서 토큰을 돌려받는 통로 부재(이번 버전에서 수정). 스토어 게시 후에도 동일하게 실패했을 문제라 미리 발견된 것이 다행. "메일 창"은 로그인 버튼 바로 아래 "고객센터" 링크 오탭 가능성이 큼.

**콘솔 설정 안내(사용자 작업 필요 — 코드로 해결 불가)**
- 구글(Google Cloud Console → API 및 서비스 → 사용자 인증 정보):
  1) OAuth 동의 화면이 "테스트" 상태면 테스트 사용자에 본인 구글 계정 추가(또는 프로덕션 게시).
  2) 웹 클라이언트 승인된 리디렉션 URI에 `https://<백엔드도메인>/api/auth/oauth/google/callback` 등록.
  3) (향후 네이티브 SDK 전환 시에만) Android 클라이언트: 패키지 `com.maidol.app` + SHA-1(`eas credentials`로 확인 — 실행은 사용자/tester).
- 카카오(developers.kakao.com → 내 애플리케이션):
  1) 제품 설정 → 카카오 로그인 **활성화 ON** + Redirect URI `https://<백엔드도메인>/api/auth/oauth/kakao/callback` 등록.
  2) 앱 설정 → 플랫폼: Web에 `https://<백엔드도메인>` 등록(Android 플랫폼 등록은 네이티브 SDK 전환 시 필요).
  3) REST API 키가 백엔드 env의 카카오 client_id와 일치하는지 확인 — "앱 관리자 설정 오류(KOE101)" 전형 원인.

**이슈 B — 네이버 버튼 제거**: SocialLoginButtons PROVIDERS에서 naver 제거(UI만, 백엔드 라우트 무변경). 완료.

**이슈 C — 이모지 아이콘**: 하트는 v3.193에서 이미 벡터(MCI heart/heart-outline 채움 토글) — APK의 이모지 하트는 구 빌드(4a313a5) 탓, 재빌드로 해소. 1차 교체 완료: 미니플레이어·플레이어·차트·플레이리스트·검색·피드 CTA·로그인·공유/출석/스타 모달의 글리프(♪♫▶❚❚✕←✓ 및 EmptyState/LoginPrompt 이모지) 전부 벡터화, EmptyState·LoginPrompt icon prop ReactNode 확장. **⭐(재화) 전량 보존**, 콘텐츠 문자열(AI 프롬프트·공유 메시지) 제외. 2차 잔여 목록은 PLAN v3.194에 기록(다음 버전).

**이슈 D — 스플래시 응원봉**: 응원봉 = assets/branding/maidol_symbol.png, 사용처 SplashScreen.tsx 단일(2막 심볼) 확인 후 3점(require·Image·스타일) 제거. 절대배치 중앙정렬이라 로고+서브타이틀 자동 재중앙 — 빈 공간·타이밍 변화 없음. 네이티브 splash-icon.png는 "MAIDOL" 텍스트뿐이라 무관. 에셋은 디스크 보존.

### 테스트 결과 (tester, TESTPLAN v3.194)
- unit 14/15 PASS, api 3/3 PASS, 정적 검증 PASS, tsc 0건.
- U-14 FAIL: 코드 결함 아님 — app.json에 9/18 빌드 세션 잔존 diff(bundleId/package com.triplej.studio→com.maidol.app, expo-media-library plugin, EOF 개행) 혼입으로 기대 스냅샷 불일치. **처리 방침(planner 판정)**: 커밋 A(v3.194)는 app.json의 expo-web-browser plugin 라인만 add -p 스테이징, 잔존분은 커밋 B(chore)로 분리 기록 — 승인(아래 판정 참조).
- E-1/E-2(구글·카카오 실로그인 왕복) UNVERIFIED-예정: ① 콘솔 설정(사용자) ② 백엔드 client=app 리다이렉트 반영 ③ 실기기 재빌드 APK — 3조건 충족 후 검증.

### planner 판정
1. **U-14/커밋 B — 승인.** 근거: 잔존분은 9/18 EAS 빌드에 실사용된 의도적 변경(사용자가 테스트한 APK 자체가 com.maidol.app 패키지·apk buildType 산물이고, 카카오 콘솔 안내도 이 패키지명 기준). 미커밋 장기화는 빌드-저장소 괴리 위험. **포함 파일 확정: app.json(커밋 A 스테이징분 제외 나머지 hunk), eas.json(preview android.buildType=apk), metro.config.js(zustand ESM→CJS 웹 치환 재작성).** 제외: .easignore(퍼미션 변경만), services/authService.ts 주석 1줄(v3.194 코드 커밋에 자연 포함되면 그쪽으로), 바이너리 에셋·맵/스프라이트 등 불명확 변경 전부. eas.json·metro.config.js의 mode 644→755 변경은 내용과 함께 커밋(메시지에 명기).
2. **P1-4(고객센터 오탭 방지) — 이번 버전 최소 수정으로 반영 지시.** 범위 2점: ① 로그인 화면에서 소셜 버튼 블록과 CompanyFooter 사이 여백 확대(companyBox marginTop을 spacing.xl 이상으로 — 스타일 1곳) ② "고객센터" 탭 시 즉시 mailto 대신 showAlert 확인 다이얼로그("고객센터에 메일을 보낼까요?" 취소/메일 열기) — 오발송 자체를 차단하는 핵심 가드. 둘 다 스타일/1함수 수준의 저위험 변경. 테스트: 로그인 화면에서 고객센터 탭→다이얼로그 노출→취소 시 무동작, 확인 시 메일 앱 오픈.

### 커밋 메시지 제안
- 커밋 A: `feat: v3.194 소셜 로그인 APK 복귀 경로(openAuthSessionAsync·aidol 딥링크)·네이버 버튼 제거·이모지 아이콘 1차 벡터화(⭐ 보존)·스플래시 응원봉 제거 (team-dev)`
- 커밋 B: `chore: 빌드 설정 잔존분 정리 — 패키지 com.maidol.app 전환·expo-media-library 플러그인, eas preview apk buildType, metro zustand ESM→CJS 웹 치환(9/18 빌드 세션 실사용분, 파일 mode 변경 포함) (team-dev)`
- 두 커밋 모두 말미에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

### 실기기/후속 (6건)
1. 사용자: 구글 콘솔 테스트 사용자/Redirect URI, 카카오 로그인 활성화/Redirect URI/Web 플랫폼 등록(위 안내대로, 민감정보는 콘솔에서만).
2. 백엔드: `백엔드_요청_소셜로그인_앱복귀.md` 반영(client=app → aidol://oauth/callback#token=) + frontend_url env 값 확인("null" 리다이렉트 후보 배제).
3. tester: 사용자 재현 시각대 /_logs/frontend 서버 로그에서 "null 에 접근할 수 없습니다" 출처 확정.
4. 실기기 재빌드 APK로 E-1/E-2(구글·카카오 로그인 왕복·취소 복귀) + 하트 벡터 렌더 + 스플래시 확인.
5. 고객센터 수신함(kimpearl@lotusai.co.kr)에서 사용자 발신 빈 메일 확인 — "메일 창" 오탭 가설 검증.
6. 이모지 아이콘 2차 목록(PLAN v3.194 기록분) 다음 버전 처리 + P1-4 반영분 회귀 확인.

### 특이사항
- APK 소셜 로그인은 콘솔 등록·백엔드 client=app 반영 전까지는 여전히 완결 불가 — 코드 준비는 끝났고 외부 조건 대기 상태임을 사용자에게 고지 필요.
- 커밋 B는 과거 세션 산출물의 사후 기록이라 v3.194 버전 번호를 붙이지 않음(chore).
- 민감정보 없음(콘솔 키·SHA-1은 플레이스홀더/확인 명령 안내만).

## v3.195 — 2026-09-20 — [분석+DB정리] 카카오 콘솔 계정 단서 + 중복 곡 정리 실행 + 얼굴없이/커버 로직 분석 + 착장 크롤링 부재 확인

**요청 원문 요지**: ①카카오 콘솔 등록 계정 파악 ②제목 끝 숫자 붙은 중복 곡 삭제 ③얼굴 없이 만들기 유무·시트 생성 방식 ④커버 디렉터 아티스트-無 로직·얼굴없는 캐릭터의 커버 생성 방식 ⑤착장(상의/하의/신발) 크롤링 코드 유무·자동화 주기·관리자 페이지 연관성(연관 시 별도 세션 분리).

**성격**: 분석 중심 사이클 — 코드 수정 없음. DB 작업은 planner 조사(조회) → 사용자 확인 → 오케스트레이터 원오프 스크립트 실행 순서 준수.

### A. 카카오 개발자 콘솔 계정 — 문서상 확인 불가(등록 완료 정황 확인)
- 로컬 문서 전수(OAUTH_SETUP.md·백엔드_요청_소셜로그인_앱복귀.md·PLAN/REPORT v3.194·git log): 절차 안내만 있고 **계정 기록 없음**. v3.194에서 "사용자 작업 필요"로 이관된 항목.
- Gmail(kimpearl3599@gmail.com)에 Kakao Developers 발신 메일 0건 → 해당 구글 메일 아님 추정.
- 프로덕션 kakao/google `/login` 모두 **302**(=클라이언트 키 설정 완료, .env 최종 수정 9/18) — 콘솔 등록·키 발급은 완료된 상태.
- **결론**: 사용자 본인 카카오톡 계정 추정 — developers.kakao.com 우상단 프로필에서 직접 확인 필요(사용자 안내 완료).

### B. 중복 곡 정리 — 사용자 결정 반영해 실행 완료
- 조사: aimu.tracks 전체 28곡 중 "제목 끝 숫자" 7곡(벚꽃피는 날 1~6 — 동일 generation_id 변형 6형제·숫자 없는 원본 부재 → 전량 삭제 시 곡 소멸 위험 고지 / starecon QA 테스트 곡 1). 패턴 밖 실제 중복 "Cherry Blossom Day" 2곡(같은 generation_id)도 추가 고지.
- **사용자 결정**: 벚꽃피는 날 6곡 = 삭제 대신 **비활성화(비공개·차트 미노출)**, QA 곡(6a718658)·Cherry Blossom 중복 53회 곡(6a126e48) = **완전 삭제**(101회 곡 유지).
- **실행 결과**(프로덕션 컨테이너 내부 원오프 스크립트, 대상 8건 제목 사전 검증 통과 후 실행):
  1. 벚꽃피는 날 1~6 → `is_public=false` 6/6 적용 + 트랙 캐시(v1/v4)·차트 캐시 무효화 + ES 색인 제거.
  2. 6a718658·6a126e48 → `purge_track_document` 실행, removed=[mongo, es, embedding, likes] 각각. track_comments 0건·playlist_tracks 0건(잔여 없음).
  3. 사후 검증: 숨김 6곡 중 공개 잔존 0 / 삭제 2곡 잔존 0.

### C. 얼굴 없이 만들기 · 캐릭터 시트 · 커버 로직 (분석 결과)
- 앱 기능 존재: `ArtistInputScreen.tsx:574` "사진 없이 만들기"(v3.76) — 실사·캐릭터 모두 지원.
- 시트 생성: `character_generator.py:848` has_photo 분기 — 無사진 시 사용자 외모 설명이 유일한 정체성 소스(성별/체형/얼굴형 등 텍스트에서 확정, 누락 요소는 K-pop 아이돌풍 자유 생성, [고정 요소] 잠금). Step A claude-opus-4-7 → Step B gemini-3-pro-image-preview(옵션 gpt_image_2).
- 아티스트-無 커버: 앱 "아티스트 빼고" → `cover_generator.py:293` [B] 분기(스타일 자유·아트디렉션 중심).
- 얼굴없는 캐릭터의 커버: 커버는 원본 얼굴 사진을 쓰지 않고 **시트 이미지만 참조**(`upload.py:388` MinIO sheet_object_name 로드 → [A] 분기, 시트=canonical) — 텍스트-only 캐릭터도 사진 기반과 동일 경로.

### D. 착장 데이터 — 크롤링 코드 없음
- `seed_item_store.py`(v148) = 사전 준비 CSV(6개 커머스 플랫폼) 1회성 시드. 크롤러는 서버·로컬 모두 부재. ad_items 455건(상의157/하의145/신발153).
- 자동화 주기 제안: 주 1회 + 시즌 전환기 전량 리프레시(단, 공식 API 부재 — 스크레이핑 약관 리스크로 제휴/광고 피드 우선 검토).
- 관리자 페이지: 백엔드 admin API 7종 존재하나 **웹 관리자 UI 부재** — 착장 자동화가 admin_ads와 직결되므로 **별도 세션 분리 확정(카드 생성됨)**.

### 특이사항
- **MinIO 스토리지 잔존 가능성**: purge 2건의 removed 태그에 audio/cover/share_video 미포함 → 오브젝트 삭제가 조용히 스킵된 정황(audio_url이 http 전체 URL 형식이면 purge는 object name만 처리 가능). 도큐먼트 기삭제로 URL 역추적 불가. 베타 규모라 용량 영향 미미. **후속 과제(백엔드 개선 항목)**: ① MinIO 고아 오브젝트 정리 스크립트 ② purge_track_document의 http URL 파싱 보강.
- 원오프 스크립트 파일이 컨테이너 `/tmp/cleanup_v3195.py`에 잔존(비루트 유저라 삭제 불가, 민감정보 없음, 컨테이너 재생성 시 소멸).
- 서버 소스는 읽기 전용 준수 — 코드 수정·재시작 없음. 이번 사이클 커밋 대상은 산출물 문서뿐.
- 민감정보 미기록(OAuth 키 값·DB 접속 정보는 출력·기록하지 않음, 302 상태코드 확인만).

## v3.196 — 2026-09-21 — 하단 시트 안전영역(제스처 바) 가림·텍스트 입력 키보드 가림 전면 정비 + 미니 재생 아이콘 채움형 통일 + 냥냥냥 duration 서버 데이터 근본 수정

### 요청 원문
- "차트에서 맨 오른쪽 점 세개 눌렀을때랑 nowplaying에서 플레이리스트 담기 버튼 누르면 하단에 팝업이 뜨는데, 모바일 UI에 팝업 하단이 가려져서 안 보임. 하단 팝업이 뜰 때 이 부분을 생각해서 수정. 텍스트 입력 시 텍스트 입력창이 모바일 키보드 UI 위로 위치해야 함. 해당 부분 전체적으로 수정."
- 추가 지시(작업 중): 미니플레이어·플레이어 축소 미니바의 재생/일시정지 아이콘을 대형 버튼과 같은 채움형으로 통일(P6).
- 별건(오케스트레이터 서버 직접 처리): 냥냥냥 곡 duration 데이터 근본 수정.

### 원인 진단 (planner 0단계 분석)
RN `Modal`은 별도 window라 **루트 safe-area 패딩과 Android adjustResize(softwareKeyboardLayoutMode resize)를 상속하지 않음** — 시트 하단 가림(A)과 Modal 내 입력창 키보드 가림(B)이 모두 같은 원인. v3.191 queueSheet(paddingBottom: insets.bottom 보강)가 기준 패턴. 전수 조사 결과 하단 시트형 6곳 중 4곳 인셋 미적용, Modal 내 TextInput 8곳 중 KAV 부재 4곳·iOS 전용 KAV 4곳.

### 수행 결과 (app-dev, 콘텐츠 변경 11파일, tsc 0건 — planner diff 검토 완료·PLAN 대비 편차 없음)
- **P1 (사용자 지목 시트 인셋)**: components/TrackActionSheet.tsx(⋮ 시트), components/PlaylistPickerSheet.tsx(담기 시트) — `useSafeAreaInsets` 도입, 시트에 `paddingBottom: insets.bottom + spacing.xl` 인라인 보강(v3.191 queueSheet 패턴 복제, 주석 명시).
- **P2 (담기 시트 키보드)**: PlaylistPickerSheet KAV `behavior`를 iOS 전용 → 양 플랫폼 공통 `"padding"`으로 확장 — "새 플레이리스트 이름" 입력창이 Android에서도 키보드 위로. (기존 ReportModal·AppealModal·AlbumCreateModal 3곳의 동일 통일 = P2-4는 PLAN 게이트대로 **실기기 검증 후 적용 보류**.)
- **P3 (나머지 시트 인셋)**: components/TrackShareDownloadSheet.tsx(`insets.bottom + spacing.xxl`), screens/ArtistCodyScreen.tsx 착장 아이템 시트(`insets.bottom` 보강).
- **P4 (KAV 부재 입력 모달 4곳)**: PlaylistScreen 이름변경 / AlbumDetailScreen 앨범수정 / ArtistResultScreen 프로필수정 / SettingsScreen 회원탈퇴 — ReportModal 패턴(KAV flex:1, behavior="padding", pointerEvents="box-none") 래핑.
- **P5 (보조)**: ChartScreen 미사용 playlist sheet 스타일 8종 삭제(공용화 잔존 죽은 코드) + 검색 FlatList `paddingBottom: insets.bottom + spacing.xl`. P5-13(DM 입력바 인셋)·P5-14(피드 댓글)는 실기기 재현 확인 전제로 보류.
- **P6 (추가 지시, PLAN 외 — 사용자 직접 지시로 수용)**: components/MiniPlayer.tsx(:98) Feather 스트로크 → MCI 채움형 play/pause, 16→20px / screens/PlayerScreen.tsx 축소 미니바(:1126) 동일 교체 14→16px. MCI play 글리프의 내장 광학 보정(bbox 우측 배치) 확인 → marginLeft 보정 불요 판단. 대형 재생 버튼(기준)은 무변경.
- **무수정 확인**: PlayerScreen queueSheet(:1349)·PurchaseModal(이미 인셋 적용, 이중 적용 금지) 준수. 웹은 insets=0으로 전부 no-op.

### 냥냥냥 duration 서버 데이터 수정 (오케스트레이터 직접 처리, 별건)
- 오디오 재먹싱으로 헤더 duration 복구(실측 162.84s), 원본은 `.bak_pre_v3196` 백업. Mongo `duration_sec` 91→163 갱신 + 캐시·ES 재색인. 백엔드_요청_트랙duration.md 항목 1 완료 처리. (v3.192 클라이언트 방어 보정은 다른 VBR 곡 대비로 유지.)

### 테스트 요약 (tester)
- **PASS 17 / FAIL 0 / N/A 1** (U-9: P2-4가 게이트 보류 상태라 조건부 정상). API-1로 duration_sec=163 실측 확인.
- 기록 2건: ① TrackShareDownloadSheet 정적 스타일의 paddingBottom 표기 잔존(인라인이 항상 덮어써 동작 무해 — 차기 정리 후보) ② PlayerScreen "diff 0" 가드 해제됨(P6로 실변경 발생, 의도된 것).
- **실기기 잔여 6건**: Android 제스처/3버튼 내비 각각의 시트 하단 노출, 담기 시트 키보드 위 입력창(Android/iOS), P4 모달 4곳 키보드, v3.191 queueSheet 이중 패딩 없음 육안, 미니바 아이콘 시각 균형. **P2-4 게이트**: 담기 시트 Android 실기기에서 가림 해소 확인 후 ReportModal·AppealModal·AlbumCreateModal behavior="padding" 일괄 통일.

### 특이사항
- behavior="padding" 적용처는 전부 Modal 내부라 Android resize와의 이중 시프트 위험 없음(일반 화면 KAV는 미변경).
- 키보드 열림 중 insets.bottom 가산으로 담기 시트에 약간의 추가 여백 가능 — PLAN상 선택 최적화로, 실기기 확인 후 필요 시 조정.

### 판정: **승인** (커밋 가능)
- 커밋 메시지 제안:
  `fix: v3.196 하단 시트 안전영역·키보드 가림 전면 정비 — 시트 4곳 insets.bottom 보강(v3.191 패턴)·담기 시트 KAV 양플랫폼 padding·입력 모달 4곳 KAV 래핑 + ChartScreen 죽은 스타일 정리 + 미니 재생 아이콘 MCI 채움형 통일 (team-dev)`
- 스테이징 11파일(2_housing/ 기준): components/{MiniPlayer,PlaylistPickerSheet,TrackActionSheet,TrackShareDownloadSheet}.tsx, screens/{AlbumDetailScreen,ArtistCodyScreen,ArtistResultScreen,ChartScreen,PlayerScreen,PlaylistScreen,SettingsScreen}.tsx — mode-only/바이너리 무관 변경 파일은 제외할 것.

## v3.197 — 2026-09-21 — 차량(BT)/화면꺼짐 상태 다음곡 자동재생 실패 + 재생버튼 무반응 복구 불능 수정

### 요청 원문
- "apk파일 확인해보니까 블루투스 연결하는 차 안에서 재생을 하니까 재생목록에 있는 다음곡이 재생이 안되. 다시 재생버튼을 누르면 재생이 안되고 꼭 미니 플레이어를 닫고 다시 곡을 클릭해야지만 재생이되는 문제가 있어. 근데 블루투스 끊고 모바일에서만 재생하면 또 다음곡으로 자동재생이 되는 문제가 있어서 이거 수정해줘"

### 원인 진단 (planner 0단계 분석 — PLAN.md v3.197)
- **H1 (유력·구조 확인)**: didJustFinish 2계통(playback.ts·PlayerScreen) 모두 "기존 sound unload → createAsync 네트워크 재로드" 구조 — 곡 사이 무음 갭 + 네트워크 의존. 오디오 모드(staysActiveInBackground·DoNotMix)와 iOS UIBackgroundModes audio는 이미 정석이나 **Android 포그라운드 서비스/미디어 알림은 expo-av 자체 미지원**. 화면 꺼짐 시 Android cached-app freeze/Doze에 전환이 걸려 죽는 구조 — BT는 원인이 아니라 "차량 = 화면 꺼짐/거치"의 프록시로 판단(원격 계측으로 확진 예정).
- **H2 (부분 확정)**: 상태 콜백이 `if (status.isLoaded)` 단독 분기 — `{isLoaded:false, error}` 미디어 에러 전면 무시(무음 방치). 포커스 이벤트는 expo-av 미노출, AppState 복귀 리컨사일 전무.
- **H3 (확정 — 사용자 복구 경로와 정확히 일치)**: 재생버튼 2곳(PlayerScreen togglePlayPause·MiniPlayer togglePlay)이 isLoaded 검사·재로드 폴백 없이 playAsync만 호출. 전환 실패 catch가 로그만 남기고 **unloaded 사운드 참조를 store/soundRef에 방치** → 재생버튼이 죽은 객체에 무반응 반복. 유일 복구가 미니 닫기(cleanup) 후 재클릭.

### 수행 결과 (app-dev 4파일 — planner diff 검토 완료·PLAN T1~T6 대비 편차 2건 수용, tsc 0건)
- **T1 services/playback.ts — 프리로드 공용 모듈(핵심)**: 종료 20초 전/85% 지점에 다음 곡을 shouldPlay:false로 선로드(`maybePreloadNext`), **셔플 랜덤 재추첨 방지를 위해 다음 인덱스 핀** + 소비 시 5중 검증(loadGen 세대·fromIndex·shuffle·repeat·트랙 id 매치, `consumePreloaded`) — 불일치면 unload 폐기 후 기존 네트워크 경로 폴백. 폐기 훅: invalidate(미니 닫기)·new-load(수동 재생)·manual-skip·player-load 4곳. 웹은 presigned(진짜 seek) 경로 유지 위해 **네이티브 한정**. 상태 콜백을 `makeStatusCallback` 팩토리로 승격해 스왑 사운드에도 v3.192 effectiveDuration 보정 경로 동일 적용. 스왑 재생(`playPreloadedSound`)은 세대 갱신+applyPlaybackAudioMode 재호출, 실패 시 네트워크 폴백.
- **T2 screens/PlayerScreen.tsx**: didJustFinish에서 프리로드 스왑 우선(getNextIndex 재호출 금지) → 미스/실패 시 기존 v3.99 경로를 `advanceViaNetwork` 공용 폴백으로 정리. `togglePlayPause` 견고화 — getStatusAsync로 isLoaded 확인, 죽은/부재 객체면 현재 곡 재로드(내부에서 applyPlaybackAudioMode 재획득). status.error 분기 신설(UI 일시정지 정합화, 자동 재재생 안 함). 전환·로드·switchToTrack 실패 catch 전부에서 soundRef/store.sound null + isPlaying false — **죽은 참조 방치 제거**(재생버튼 1탭이 복구 경로).
- **T3 components/MiniPlayer.tsx**: togglePlay 동일 견고화(getStatusAsync 검사 → loadAndPlayTrack 재로드 폴백), 낙관적 setIsPlaying 제거(상태 콜백이 반영).
- **T4 App.tsx + playback.ts**: AppState 'active' 복귀 리컨사일 — sound가 죽었으면 참조 정리+UI 일시정지 정합화. **자동 재재생 금지 준수**(운전 중 돌발 재생 방지, 계획 명시). init/teardown 쌍으로 등록·해제(픽스 루프 반영).
- **T5 [BTDebug] 원격 계측 28건**: 전부 console.warn 레벨(remoteLogger 프로덕션 후킹 조건) — didJustFinish(preloadHit·appState 포함)/프리로드 시작·성공·실패·폐기/스왑 성공·실패/전환·로드 실패/재생버튼 복구 발동/sound error/리컨사일. 기록 값은 trackId·인덱스·상태·err.message뿐 — 민감정보 없음.
- **T6 무변경 확인**: app.json·stores/playerStore.ts·services/audioMode.ts diff 0 — 계획 준수.
- **편차 2건 — planner 최종 수용**: ① MiniPlayer 렌더 조건 `!track || !sound` → `!track` 완화 — 전환 실패로 sound가 정리(null)돼도 미니플레이어가 남아야 "재생버튼 1탭" 복구가 성립(계획 취지에 필수적 귀결; cleanup 후에는 track도 null이라 기존과 동일하게 숨김). ② 리컨사일에 "로드됐지만 시스템이 멈춘 경우 UI만 일시정지 정합화" 분기 추가 — 자동 재재생 금지 위반 없음, 인터럽션(H2) 후 UI-실제 불일치 해소로 계획 (d) 취지 내.

### 테스트 결과 (tester, 픽스 루프 1회 포함)
- 1차: **U-7 ①(AppState 리스너 등록/해제 쌍 부재)만 FAIL**, 나머지 전 항목 PASS(자동 전환 순차·셔플 핀·repeat all/one, 수동 스킵/큐 편집 후 프리로드 폐기·오재생 없음, 재생버튼 토글 회귀, 웹 무영향, 계측 레벨 검증 포함).
- 픽스 루프: app-dev가 reconcilerSubscription 보관(playback.ts:333,:337) + `teardownPlaybackReconciler` export(:364-368) + App.tsx cleanup 쌍(:513) — 오케스트레이터 단건 재검(3지점 grep + tsc 0건) 통과. **최종 FAIL 0**.
- 비차단 기록 3건(차기 개선 후보): ① 로그아웃 시 프리로드 잔존 가능(상한 1개·다음 재생 시 폐기라 영향 미미) ② 프리로드 실패 반복 시 말미 20초 동안 [BTDebug] warn 재시도 스팸 가능성(원격 로그 노이즈) ③ err.message pass-through(민감정보 패턴은 remoteLogger가 drop하나 메시지 위생은 개선 여지).
- **실기기 잔여 6건 (에뮬 재현 불가 — 배포 전 확인 필수)**: ① 화면 끄고(잠금) 3곡+ 연속 자동재생 ② BT 스피커/차량 헤드유닛 연결 + 화면 꺼짐 동일 시나리오 — **차량 테스트는 반드시 동승자가 조작(운전자 직접 조작 금지)** ③ 곡 말미 비행기모드로 전환 실패 유도 → 재생버튼 1탭 복구(미니·풀 각각) ④ 재생 중 BT 연결 해제 → 재생버튼 복구 ⑤ 전화 수신 인터럽션 → 통화 후 복구 ⑥ 공격적 절전 기기(삼성 등)에서 실패 시 [BTDebug] 로그의 서버(/api/_logs/frontend) 도착 확인(로그인 상태 전제).

### track-player 이관 판정 — **필요, 별도 과제로 분리**
- expo-av는 Android 포그라운드 서비스·미디어 알림 미지원 + Expo 공식 deprecated 흐름. 화면 꺼짐/차량 장시간 연속재생의 완전한 신뢰성·잠금화면 컨트롤은 react-native-track-player(또는 expo-audio 비교 검토) 이관이 정도이나, 사운드 소유권이 3곳에 분산된 현 구조의 전면 재편(대수술)이라 v3.197 범위 밖. **실기기 [BTDebug] 서버 로그로 H1 확진 후 별도 세션 발제.** 이번 개선으로 재발 빈도·복구성은 크게 개선되나 무음 갭 없이도 freeze하는 공격적 절전 기기에는 한계 잔존 — 임시 완화로 사용자에게 "앱 배터리 최적화 제외" 안내 가능.

### 특이사항
- 프리로드는 트랙당 스트림 프록시 요청 1회가 미리 발생(서버 부하 증가 미미, 곡당 동일 총량). repeat 'one'도 동일 곡을 새 사운드로 선로드해 기존 동작과 등가.
- 70% 재생기록(record-play)·EXP 적립은 상태 콜백 경로 유지로 무회귀(스왑 사운드에도 동일 콜백 부착).
- 민감정보 미기록: 계측 값은 trackId·인덱스·appState·err.message뿐, 토큰/개인정보 없음.

### 판정: **승인** (커밋 가능 — 실기기 잔여 6건은 배포 전 확인 조건)
- 커밋 메시지 제안:
  `fix: v3.197 차량(BT)/화면꺼짐 다음곡 전환 견고화 — 다음 곡 프리로드(셔플 핀+5중 검증)·재생버튼 2곳 재로드 폴백·status.error 분기·AppState 리컨사일(자동 재재생 금지) + [BTDebug] 원격 계측 28건 (team-dev)`
- 스테이징 4파일(2_housing/ 기준): services/playback.ts, screens/PlayerScreen.tsx, components/MiniPlayer.tsx, App.tsx — mode-only/무관 변경 파일 제외할 것.

## v3.198 — 2026-09-21 — 미니플레이어 시작 시 노출 수정 + 담기 시트 키보드 간격 잔존 수정 + 카카오 초대 링크 랜딩/OG 카드(백엔드 배포) + 인스타·페북 버튼 동작 답변

### 요청 원문
- "이번 버젼 apk 다운받으니까. 처음 앱 접속할때부터 하단에 미니 플레이어가 보이는채로 시작을 하는데. 뭔가 잘못된것 같아 수정해줘. 텍스트 입력창이 있는 부분에서 텍스트창을 한번 열었다가 닫으면 하단 ui가 살짝 간격이 생긴채로 떠있어. 확인해서 수정해줘(플레이리스트에 담기). 카카오로 공유하면 문자가 'MAIDOL — … 추천코드: 7VFU / https://api.maidol.ai.kr/invite/7VFU' 이렇게 가는데 이걸 클릭하면 어떤 화면으로 연동되는거야? 공유를 하면 플레이스토어 다운로드 링크로 연동이 되었으면 좋겠는데. 그리고 이 카카오톡 메세지를 좀 더 예쁘게 이미지도 있고 그렇게 만들 수는 없을까. 현재 인스타그램, 페이스북 공유버튼이 있는데 이건 공유가 맞아? 아니면 내가 영상이나 음악을 올리도록 하는 기능이야?"

### 원인 진단 (planner 0단계 분석 — PLAN.md v3.198)
- **A (확정)**: 앱 부팅 restoreSession(App.tsx:510) → loginWithToken(authStore.ts:91) → restoreQueueFor(playerStore.ts:148)가 보관함에서 track까지 복원(일시정지) → **v3.197에서 완화된 MiniPlayer 렌더 조건 `if (!track)`(MiniPlayer.tsx:24)** 이 sound 없이도 렌더 → 자동로그인 APK는 시작부터 일시정지 미니 노출. v3.197 편차 ①의 예견 못 한 부수효과.
- **B (범위 확정)**: PlaylistPickerSheet.tsx:88이 v3.196 유일의 Android `behavior="padding"` KAV 적용처(나머지 Report/Appeal/AlbumCreate/DmChat 4곳은 iOS 전용 — 확산 없음). Android(edge-to-edge Modal)에서 KAV가 키보드 닫힘 후 제스처 바 높이만큼 padding 잔차를 남김 + 시트 자체 insets.bottom과 이중 계상.
- **C (서버 실측)**: 공유 링크 `https://api.maidol.ai.kr/invite/{code}` → **404 JSON**(루트 라우트 부재 — 존재하는 건 `GET /api/referral/invite/{code}` JSON뿐, referral.py:43). 가입 보상(inviter/joiner 각 ⭐50 멱등)은 auth.py:268-284에 기완비 — 랜딩은 코드 노출·복사·스토어 유도만 담당하면 됨.
- **D (분석)**: AppShareModal.tsx:66-74 — 카카오/인스타/페북 세 버튼 모두 동일한 RN `Share.share({message})` = OS 네이티브 공유 시트에 텍스트+링크를 넘기는 순수 공유. 영상·음악 업로드/SNS API 연동 아님(target은 로그용).

### 수행 결과
**app-dev (A·B — 3파일, planner diff 최종 검토 완료, tsc 0건)**
- **stores/playerStore.ts**: 비영속 `sessionActive` 플래그 신설(partialize 화이트리스트라 자동 제외). **비대칭 스펙** — setSound(truthy)에서만 true(재생 시작점 분산 → setter 한 곳에서 일괄 마킹, null 세팅은 전환/정리 중일 수 있어 내리지 않음 = v3.197 복구 경로 보존), resetOnLogout·restoreQueueFor(복원 분기)·cleanup에서 false.
- **components/MiniPlayer.tsx**: 렌더 조건 `if (!track || (!hasSound && !sessionActive))` — sound는 `!!s.sound` 불리언 셀렉터로만 구독(v3.197 원칙 유지, 리렌더 소음 방지). 복원 큐(재생 전)는 숨고, 세션 중 sound null(BT 전환 실패)은 유지 → **v3.197 "재생버튼 1탭 복구"와 양립**.
- **components/PlaylistPickerSheet.tsx**: KAV behavior iOS 전용 복귀 + Android `keyboardDidShow/Hide` 수동 패딩 `max(0, kbHeight - insets.bottom)`(이중 계상 해소), hide 시 무조건 0 리셋 — 잔존 간격 구조적 불가. 리스너 등록/해제 쌍 + visible false·언마운트 시 해제와 패딩 리셋(v3.197 U-7 교훈 반영).
- **편차 1건(수용)**: app.json 버전 갱신 보류 — versionName 변경 무전례로 관례 오인 판정, 기존 값 유지.

**backend-dev (C — EC2 backend_9004, docker 재배포 완료)**
- `app/routes/referral.py`: 프리픽스 없는 `public_router` + `/invite/{code}` HTML 초대 랜딩 — OG 태그(og:title "…님의 초대"/og:description 보상 문구/og:image 1200×630 절대 URL/og:image:width·height/twitter:card) + 본문(다크 톤, 닉네임·추천코드 대형 표기·[코드 복사](clipboard+폴백)·보상 안내·주 CTA **[Google Play에서 다운로드]**=config.py play_store_url·보조 "이미 설치했다면 열기" aidol:// 딥링크). 닉네임·코드 **html.escape 일괄**(XSS 방지). 무효/탈퇴 코드 → **404 HTML**(스토어 CTA는 유지 — 죽은 링크 경험 방지).
- `app/main.py`: `/static` StaticFiles 마운트 + public_router include. OG 이미지 1200×630 2파일 `app/static/og/` 배치(Dockerfile `COPY app/`로 이미지에 자동 포함).
- **패치 이력**: 1차 배포 후 오케스트레이터 검증에서 **HEAD 405** 발견(카카오 스크래퍼 프리플라이트 대비) → `api_route(GET, HEAD)`로 패치, **배포 2회**로 해결.
- **검증 전건 통과**: `/invite/{유효코드}` GET/HEAD 200 HTML, og 이미지 200, 무효코드 404 HTML+CTA, 기존 `GET /api/referral/invite/{code}` JSON 무회귀. 앱 공유 문구·URL은 무변경(요구 충족 — 링크 자체가 카드+랜딩으로 개선).

**(D) 답변 전달 완료**: "세 버튼 모두 초대 문구+링크의 텍스트 공유(OS 공유 시트)이며, 영상·음악을 인스타/페북에 올리는 기능이 아님. 인스타는 텍스트 링크 공유 수용이 제한적(DM 정도)이라 체감 어색할 수 있음 — '공유하기' 단일 버튼 통합 또는 스토리 이미지 공유 연동은 차기 개선 후보."

### 테스트 결과 (tester)
- unit 6/7 + api 3/3 + e2e 정적 대체 PASS. **U-6만 조건부 FAIL** — 원인은 본건 3파일이 아니라 **스코프 외 정체불명 변경 2건**(App.tsx lineHeight 1줄, ChartScreen 기본탭 'new' 1줄 — 출처 불명, 어느 에이전트도 미보고) → 오케스트레이터가 **revert 처리**(요청되지 않은 변경의 미검증 반입 거부 원칙), revert 후 tsc 재확인 0건.
- **실기기 잔여 5건 (배포 전 확인)**: ① 자동로그인 APK 콜드 스타트 → 미니 미노출, 곡 재생 후 노출 ② BT 전환 실패(sound null) 상황 미니 유지+재생버튼 1탭 복구(v3.197 무회귀) ③ 담기 시트 키보드 열고 닫기 반복(뒤로가기/빈곳 탭) → 간격 0·입력창 가림 없음(v3.196 무회귀, iOS 무변경 확인) ④ 실기기 카톡 공유 → 이미지 카드 렌더·랜딩→Play 스토어 이동·코드 복사(Android Chrome/iOS Safari) ⑤ 로그아웃→타계정 로그인 → 미니 미노출.

### 특이사항
- **사용자 액션 잔여 1건**: 카카오가 기존 404 응답을 스크랩 캐시했을 수 있음 — https://developers.kakao.com/tool/debugger/sharing 에서 해당 URL **캐시 초기화** 후 카톡 재공유로 카드 확인 필요.
- 스코프 외 변경 2건 revert는 편차가 아니라 방어 조치로 기록 — 필요 시 별도 요청으로 재반입.
- 초대 랜딩의 추천코드는 표시·복사까지만(가입 화면 수동 입력, 현행 유지) — 딥링크로 코드 자동 전달은 범위 밖 차기 후보.
- 민감정보 미기록: 랜딩 노출 값은 닉네임·추천코드뿐(escape 처리), 토큰/개인정보·서버 크리덴셜 없음.

### 판정: **승인** (커밋 가능 — 실기기 잔여 5건은 배포 전 확인 조건, 카카오 캐시 초기화는 사용자 액션)
- 커밋 메시지 제안:
  `fix: v3.198 미니플레이어 시작 시 노출 차단(sessionActive)·담기 시트 Android 키보드 간격 잔존 수정(수동 패딩) + 초대 링크 HTML 랜딩/OG 카드(서버 GET·HEAD /invite)·Play 스토어 CTA (team-dev)`
- 스테이징 3파일(2_housing/ 기준): stores/playerStore.ts, components/MiniPlayer.tsx, components/PlaylistPickerSheet.tsx + 산출물(PLAN/REPORT/TESTPLAN) — revert된 App.tsx·ChartScreen 등 무관 파일 제외할 것.

---

## v3.199 (2026-09-21) — 작업실 UX 4종: 기획사 이니셜 아바타 · 디렉터 대화 뒤로가기 · 엔터명 마퀴 · 선택값 편집 아이콘

### 1. 요청 원문
"기획사 프로필 이미지를 설정하지 않아도 기본값이 비어있으면 안되. 제일 앞글자라도 써있어야하고. 그리고 기본값 배경 색상 다양하게 랜덤으로 되는거 맞지? 추가로 작업실에 디렉터들과 이야기를 하는 중에 다시 작업실로 돌아가고 싶을때 상단에 이전으로 돌아갈 수 잇는 아이콘 ui가 있어야 할것 같아. 그리고 작업실 접속했을때 상단에 엔터테이먼트 이름도 너무 길어지니까 ui 를 침범해서 옆의 ui 를 침범하지 않는 선에서 적당히 가로길이를 정하고 텍스트가 흘러가도록 해줘. 추가로 디렉터와 대화할때 값을 선택해도 값을 선택하면 수정할 수 있잖아. 수정할 수 있으니까 편집 아이콘을 살짝 넣어주면 좋을 것 같아."

### 2. 수행 결과 (9파일, +240/-17, tsc 0건)

**A. 기획사 이니셜 아바타**
- 진단: 공용 `components/ui/Avatar.tsx`(v3.181)가 이미 이니셜+seed 해시 8색 팔레트 표준. 빈 기본값은 두 곳 — AgencyProfileScreen(아바타 요소 전무), SettingsScreen(이니셜은 있으나 배경 고정 보라 단색).
- 수정: ① Avatar `seedColor` named export 승격(+ui/index barrel 1줄) ② SettingsScreen 폴백 배경 = seedColor(계정 id, 닉네임) ③ AgencyProfileScreen profileBox에 Avatar 64px(이니셜=기획사명 첫 글자) ④ UserChannelScreen Avatar에 seed=authorId(닉변에도 색 불변).
- **사용자 질문 "배경 색상 다양하게 랜덤 맞지?" 답변**: 네, 다양하게 나옵니다 — 정확히는 매번 바뀌는 완전 랜덤이 아니라 계정 id 해시로 8색 팔레트에서 고르는 방식(v3.181)입니다. 사용자끼리는 색이 다양하게 갈리되 **같은 기획사는 언제 봐도 항상 같은 색** — 볼 때마다 색이 바뀌면 "내 기획사 색" 식별성이 사라지고 리렌더마다 색이 튀므로, 랜덤처럼 다양하되 결정적인 현 방식을 유지했고, 이 규칙이 안 닿던 두 곳을 이번에 통일했습니다.

**B. 디렉터 대화 뒤로가기**
- DialogueScreen(+ 대화의 연장인 LyricsInput·ComposerInput)에 useFocusEffect로 Studio 탭 헤더 headerLeft에 arrow-left 주입, blur/unmount 시 undefined 복원(미복원 시 Map 복귀 후 화살표 잔존 — MapScreen effect deps 불변 함정 방어). 아이콘 스펙은 stackHeader 관행 동일.

**C. 엔터명 마퀴**
- MapScreen 헤더 타이틀: winW 기반 명시 폭(`max(90, winW - 로그인 260/비로그인 150)`) 안에 기존 Marquee(v3.192) 재사용 — 넘칠 때만 흐르고 짧으면 정적. ⓘ 도움말 아이콘은 마퀴 밖 고정(항상 같은 자리 탭 가능). winW는 useWindowDimensions라 회전에도 반응(deps 포함).

**D. 선택값 편집 아이콘**
- LyricsInput: 재선택 기능은 기존(v3.110) — user 버블에 Feather edit-2 11px 아이콘 추가(VideoDirector v3.182 스펙 동일). 선택지 스텝에만 노출(자유입력 답변은 재선택 비대상이라 미표시).
- ComposerInput: 수정 기능 자체가 없어 아이콘만 붙이면 거짓 어포던스 → LyricsInput 재선택 패턴 이식(+156줄): step 기록·버블 탭·재선택 모달(장르/분위기/보컬 3스텝, 자유입력 2종 제외)·아이콘. store 반영은 processAnswer와 동일 매핑(genre/mood는 store+로컬, vocal은 로컬 — 최종 프롬프트는 완료 시점 state 조립이라 정합).

### 3. 편차 3건 (tester 전부 승인)
1. **ComposerInput `!isComplete` 게이트**: 완료 후에는 프롬프트가 이미 클로저로 조립·저장돼 수정이 반영될 경로가 없음 → 완료 후 재선택 차단+아이콘 숨김(거짓 어포던스 방지).
2. **userText `flexShrink:1`**: 버블 row 배치 전환에 따라 긴 자유입력 답변이 버블 밖으로 밀리는 것 방지(Yoga 기본 0).
3. **back 라벨 이원화**: Dialogue는 "작업실로 돌아가기", LyricsInput/ComposerInput은 "뒤로"(스택 관행) — 접근성 문맥 반영.

### 4. 테스트
- unit 9/9 PASS, FAIL 0. tsc 0건. 안전 분류기 미검토 공백은 tester가 diff 전량 열람으로 보완 — 수상 코드 혼입 없음.
- planner 최종 diff 검수: 9파일 전량 확인 — ① reselect store 반영이 processAnswer와 정확히 동일 매핑 ② headerLeft 주입/복원 순서(blur 정리→focus 주입) 안전 ③ MapScreen winW 반응성 확인. 지적 사항 없음.
- **실기기 잔여**: ① 20자+ 기획사명 마퀴 흐름·우측 아이콘 침범 없음(360dp 포함) ② 대화→back→Map 복귀 후 화살표 잔존 없음(왕복 반복) ③ Dialogue→LyricsInput 연속 전환 시 headerLeft 유지 ④ 작곡 재선택 후 최종 프롬프트 값 반영 ⑤ 이미지 미설정 계정 아바타 색 일관성(재실행 포함). v3.191~198 스팟 회귀 포함.

### 5. 특이사항
- v3.198 미커밋 3파일(playerStore/MiniPlayer/PlaylistPickerSheet)과 무접점 확인 — 병행 커밋 시 스테이징 분리 가능.
- ui/index.ts 1줄(barrel export)은 필연·최소 변경으로 커밋 포함.
- 이모지 금지 방침 준수(Feather 벡터), 민감정보 미기록.

### 판정: **승인** (커밋 가능 — 실기기 잔여 5건은 배포 전 확인 조건)
- 커밋 메시지 제안:
  `feat: v3.199 작업실 UX 4종 — 기획사 이니셜 아바타 통일(seed 팔레트 export·설정/기획사프로필/채널)·디렉터 대화 3화면 헤더 뒤로가기 주입/복원·엔터명 maxWidth+마퀴(ⓘ 고정)·선택 답변 edit-2 아이콘+작곡 재선택 이식 (team-dev)`
- 스테이징(2_housing/): components/ui/Avatar.tsx, components/ui/index.ts, screens/SettingsScreen.tsx, screens/AgencyProfileScreen.tsx, screens/UserChannelScreen.tsx, screens/DialogueScreen.tsx, screens/LyricsInputScreen.tsx, screens/ComposerInputScreen.tsx, screens/MapScreen.tsx + 산출물(PLAN/REPORT/TESTPLAN) — v3.198 사이클 3파일은 제외할 것.

---

## v3.200 (2026-09-21) — Phase 0 창작 기록 계층 1차 슬라이스 + 일반/저작권 등록 트랙 분기

### 1. 요청 원문
- 요구사항 문서: /Users/pearl/Downloads/Phase0_창작기록계층_개발요구사항.md (v1.0 — 7종 이벤트·해시 체인·append-only·F1~F9).
- 사용자 원문: "이번 테스트 배포에서는 위 phase 0 번에 대한 내용이 반영되야하는데. 배포후에 정식 프로모션때 음악에 대한 전 파이프라인 즉 음악을 생성하는 시점부터 마무리하는 시점까지(작사, 작곡) 일반트랙으로 갈껀지 저작권 등록 트랙으로 갈껀지 선택을 해서 분기를 하려고해. 그래서 작사, 작곡에 대한 로그가 남아있어야하고. 프로모션때 저작권 등록 트랙에 대한 작업을 할꺼긴 하지만 ui 상으로 일반 트랙, 저작권 등록 트랙을 두고 저작권 등록 트랙은 프로모션 때 출시 예정으로 보일 수 있도록 작업을 조금 해두면 어떨까 싶은데"

### 2. 슬라이스 범위 (원칙: 소급 불가한 원천 데이터는 전부 이번, 가공·검증·강화는 후속)
**v3.200 반영**: F1 엔진 요청/응답 전문·audio SHA-256·canonical 해시 저장 / PG creation_log(sessions·events·lyrics_versions, §5.2 스키마·해시 체인 서버 계산) / POST /sessions·events(배치 idempotent)·lyrics API / generate session_id 하위호환(무세션 시 서버 자동 생성) / tracks FINALIZE 훅+track_type / 앱 SDK(creationLogService)·LISTEN/CANDIDATE_SELECT 계측·가사 버전 커밋 3+1지점 / F6 고지 3지점 / ② 모드 토글 UI.
**후속(v3.201+)**: 오프라인 SQLite 영속 큐(§5.5 완전판 — 이번엔 메모리 큐, 강제종료 유실 허용), F5 토큰 origin 태깅·origin_summary·paste 감지(버전 전문 체인에서 소급 계산 가능), §5.4 DB 권한 분리·MinIO Object Lock·F8 보존 정책(prod 운영 변경 — 사용자 승인 필요), F9 검증 API·일 배치, ID3 메타·문구 서버 설정화, F7 특허 표기(출원번호 확보 후), is_regeneration_of 소급 판정, ABANDONED 배치, SESSION_START creation_mode 스키마 확장.

### 3. 수행 결과
**backend-dev (backend_9004 — 배포 완료)**
- `app/services/creation_log.py` 신설: canonical JSON+payload_hash/event_hash/prev_hash 체인(문서 부록 B와 문자 일치 — tester 확증), 세션당 advisory lock seq 직렬화, user_id_hash=SHA256(user_id+CREATION_LOG_SALT — .env 기입).
- `app/routes/sessions.py` 신설: POST /sessions(SESSION_START — import_blocked:false 실측 반영), POST /sessions/{id}/events(봉투형 {"events":[...]}, 배치 ≤500, event_id idempotent, FINALIZED 409, §12 엄격 검증 400), POST /sessions/{id}/lyrics(전문+prev_version_id+source, LYRIC_EDIT 기록), GET /sessions/{id}. 전부 401 인증 게이트.
- generate.py·suno_generator.py: session_id/lyrics_version_id optional 수용(구버전 앱 하위호환 — 무세션 시 자동 생성), GEN_REQUEST/GEN_RESPONSE(실패 포함) 기록, suno_request_body·suno_response_raw 전문·variant별 audio_sha256·requested_at/responded_at 저장. 원본 mp3 무변환 저장 유지.
- tracks.py upload-from-generation: track_type 화이트리스트('standard'|'copyright_ready')·session_id 수용, FINALIZE(trigger:'publish') 훅+root_hash 확정.
- PG 스키마 3종 lifespan CREATE IF NOT EXISTS — 배포 후 스키마 생성 로그·테이블 실측, 기존 API 무회귀 확인.

**app-dev (2_housing — 9수정 + 1신설, +334/-10, tsc 0건)**
- `services/creationLogService.ts` 신설(272줄): 세션 lazy 확보(idempotent)·메모리 큐+2s 디바운스 배치·지수 백오프 3회·500 분할·순서 보존 flush·404/401 no-op 게이트(기록 실패가 기능을 절대 막지 않음)·가사 버전 커밋(동일 텍스트 중복 제거).
- 계측: MusicResultScreen LISTEN play/pause/ended·variant 전환 pause·CANDIDATE_SELECT(명시 선택만, §6.3)·발매 직전 select+flush(FINALIZE보다 체인 앞 보장)·발매 성공 시 세션 종료. 가사 버전: LyricsResult 진입 ai_draft / '완료'·작곡 진입·작곡 대화 '적용' user_edit / 생성 요청 직전 최종 커밋+lyrics_version_id 동봉(musicService).
- F6 3지점: TrackShareDownloadSheet 고지 1줄(전 곡 공통 — v3.171 뱃지와 동일 전제), 발매 완료 팝업(보컬 곡 한정), 설정>앱 정보 "AI 생성 고지" 상시 항목(PolicySheet 재사용, consentTexts.AI_GENERATION_NOTICE).
- ② UI: DialogueScreen 작사 디렉터 한정 "일반 모드/저작권 등록 모드" 세그먼트 토글 + "창작 과정 기록 중" 상태 칩(벡터 점 — 이모지 금지 준수) + 최초 선택 시 showAlert 안내(앱 다이얼로그 규칙). musicStore.creationMode → 발매 track_type 반영.

**② UI 결정 경위**: planner 초안은 MusicResultScreen 발매 카드(§3 1안)였으나, **사용자가 재선택** — 작사 디렉터 대화 화면 토글로 확정(생성 시작 시점부터 분기 의도 반영). % 게이지(기여도 표시류)는 origin 태깅 선행이 필요해 후속. 문구 금지선(F7 §9) 준수: "저작권 등록 가능/보장/인정"·"특허" 표현 전무, "증빙 자료 생성 기능은 정식 프로모션 때 제공 예정" 사실 서술만.

### 4. 테스트·픽스 이력
- tester: unit 10/10 PASS + unit-서버 4/4 PASS, api/e2e는 실기기·스테이징 이관 처리.
- **X-1 (유일 FAIL → 픽스 루프 1회)**: LISTEN/CANDIDATE_SELECT의 candidate_id를 payload에 실어 §5.2 정본(target.candidate_id) 위반 — 서버 엄격 검증 400 위험. → target 배선으로 수정, 오케스트레이터 재검 통과(target 배선 확인·payload 잔존 0·tsc 0). 코드에 `v3.200(X-1)` 주석 2곳 실존 확인(planner).
- planner 최종 diff 검수(10파일 전량): ① 봉투형·6필드·500분할·no-op 게이트 스펙 정합 ② 발매 경로 2곳(handleSave·커버 경유) 모두 select→flush→업로드→세션 종료 순서 동일 ③ didJustFinish 클로저는 effect deps(selectedVariant)로 stale 아님 ④ SESSION_START에 creation_mode 미전송(서버 엄격 검증 400 방어 — 주석 명시) ⑤ 금지선 문구 준수 — **지적 사항 없음**. 전환/발매의 select 중복 기록은 event_id 별개·§6.4 재구성에 무해(기록은 사실 나열, 판정은 Phase 1).

### 5. 실기기 스모크 절차 (배포 전 확인 조건 — 오케스트레이터 실행)
생성 1회(작사→작곡→A/B 청취→발매) 후 서버 PG에서 6단계 확인:
1. sessions 1행(status=FINALIZED, root_hash NOT NULL) 2. events seq 1..N 연속·SESSION_START→GEN_REQUEST→GEN_RESPONSE→LISTEN*→LYRIC_EDIT*→CANDIDATE_SELECT→FINALIZE 순서 3. 체인 재해시 일치(부록 B verify — creation_log.py 함수 재사용) 4. generations doc에 suno_request_body/suno_response_raw/audio_sha256 존재 5. lyrics_versions prev 체인 연결·FINALIZE.lyrics_version_id 일치 6. tracks doc track_type 저장. 추가: 저작권 등록 모드 토글 상태에서 발매 → track_type='copyright_ready' / 비로그인·구버전(플래그 없는 요청) 흐름 무영향 / 공유 시트·발매 팝업·설정 고지 노출.

### 6. 후속 기록 7건 (tester)
1. MusicResultScreen generationId가 폴링 완료 후 result_track_id로 치환되는 경로에서 candidate_id 규약 오염 가능 — gen_id 별도 보관으로 교정.
2. 커버 경유 발매 완료 팝업에 F6 음성 합성 고지 누락(handleSave에만 반영) — 갭 보완.
3. creationMode sticky UX: 다음 곡에도 유지되는 동작의 안내 부재 — 새 곡 시작 시 칩 재노출 등 검토.
4. 화면 이탈 flush가 2s 디바운스와 겹칠 때 지연 여지 — 이탈 시 즉시 flush 우선순위 조정.
5. 오디오 로드 실패 시 LISTEN 재시도 이벤트 미기록 — 필요성 검토.
6. 서버 코드 git 동기화 잔무(backend_9004 반영분의 TripleJ-backend 워크트리 커밋).
7. 토글·안내 카피 최종 리뷰(법무 문구 관점 — F7 금지선 재확인 포함).

### 7. 특이사항
- 민감정보 미기록(salt 값·키 미표기), 서버 스키마 변경은 CREATE IF NOT EXISTS 한정 — 기존 데이터 무접촉.
- v3.199까지 전부 커밋됨 — 이번 diff는 v3.200 단독(병행 미커밋 사이클 없음).

### 판정: **승인** (커밋 가능 — §5 실기기 스모크 6단계는 배포 전 확인 조건)
- 커밋 메시지 제안:
```
feat: v3.200 Phase0 창작 기록 계층 1차 — 창작 세션·LISTEN/CANDIDATE_SELECT 계측·가사 버전 커밋(creationLogService 신설) + 작사 디렉터 모드 토글→발매 track_type 분기·F6 AI 고지 3지점 (team-dev)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```
- 스테이징(frontend 브랜치 — 커밋 시 자동 push 유의):
  - 앱 10파일(2_housing/): **services/creationLogService.ts(untracked — git add 필수)**, services/musicService.ts, stores/musicStore.ts, screens/MusicResultScreen.tsx, screens/DialogueScreen.tsx, screens/LyricsResultScreen.tsx, screens/MusicGenerationScreen.tsx, screens/SettingsScreen.tsx, components/TrackShareDownloadSheet.tsx, constants/consentTexts.ts
  - 산출물 3종: claude_skills_outputs/team-dev/{PLAN.md, REPORT.md, TESTPLAN.md}
  - 그 외 장기 미커밋 파일(assets·scripts·타 프로젝트 등)은 이번 커밋에서 제외할 것.

## v3.201 (2026-09-21) — 담기 시트 입력 가림 수정 + 재선택 팝업 자유 입력 + 디렉터 대화 뒤로가기 견고화

### 요청 원문
"담기 시트 키보드 닫은 후 간격 잔존 해결 <- 이부분은 해결되었지만, 텍스트를 입력하려고 하면 모바일 ui(키보드)에 텍스트 input이 가려져. 그리고 디렉터와의 대화에서 내 답변을 눌러서 다시 선택하기 팝업이 뜨면 거기서 자유롭게 입력하는 창도 있어야해. 디렉터 대화 3화면 상단 뒤로가기 <- 이게 어디에 반영된건지 모르겠는데. 설명해줘"

### A. 담기 시트 — 입력 중 키보드 가림 (버그, 수정 완료)
- **원인(확정)**: v3.198의 kbPad를 시트 **paddingBottom에 합산**한 것이 문제. 시트에 `maxHeight: '60%'` 클램프가 있어 Android(edge-to-edge, 키보드가 창을 리사이즈하지 않음)에서 콘텐츠+kbPad가 60%를 넘는 순간 시트 높이가 고정되고, 스크롤 없는 목록 뒤 **맨 아래 자식인 입력행이 시트 경계 밖 = 키보드 뒤에 남았다**. "닫은 후 잔존"과 "열림 중 가림"은 서로 다른 경로 — v3.198은 전자만 고친 것이 맞다.
- **수정**: kbPad를 **시트 marginBottom(시트 전체 리프트)**으로 이동 — 콘텐츠 높이가 안 변해 클램프와 무관하게 입력행이 항상 키보드 위. paddingBottom은 `insets.bottom + spacing.xl` 원복. 키보드 열림 중 maxHeight를 남는 화면 안으로 동적 클램프. 목록은 ScrollView(maxHeight 240, persistTaps) 전환 — 목록이 길면 입력행이 밀리던 잠재 결함도 해소. hide 시 0 리셋이라 **v3.198 '잔존 간격 불가' 보장 유지**(무회귀). kbPad 로직은 공용 훅 `hooks/useAndroidKeyboardLift.ts`로 추출.

### B. 재선택 팝업 자유 입력 (기능, 완료)
- 작사(LyricsInput)·작곡(ComposerInput) 두 화면의 "다시 선택하기" 모달에 선택지 아래 **"직접 입력..." + 확인** 행 추가. 제출은 기존 `handleReselectChoice(trim)` 완전 재사용 — store 매핑·말풍선 텍스트 교체·최종 프롬프트 반영 경로가 선택지 탭과 동일(신규 분기 없음). 빈값 비활성, 닫기(취소·백드롭·백버튼) 시 입력 리셋.
- **노출 조건 = 메인 플로우와 동치**: 작사의 듀엣(2)·랩(8)·길이(9)는 enum 매핑 스텝이라 자유 텍스트가 오매핑을 유발 → 입력 행 비노출. 작곡은 전 재선택 스텝(장르·분위기·보컬) 노출.
- 모달 키보드 회피: iOS KAV(padding) + Android 공용 훅 리프트(A와 동일 패턴, Modal 내 Android KAV 재도입 금지 준수).

### C. 디렉터 대화 3화면 상단 뒤로가기 — 사용자 설명 + 원인·수정
- **어디에 반영됐었나(v3.199 의도)**: 대화 화면 안이 아니라 **화면 최상단 탭 헤더의 맨 왼쪽 — 기획사 이름 바로 왼편의 ← 화살표**입니다. 작업실 화면들은 자체 헤더가 없고 상단 탭 헤더를 공유하는 구조라, 3화면(디렉터 대화·작사·작곡)이 포커스일 때 그 자리에 화살표를 주입하는 방식이었습니다.
- **왜 안 보였나(원인 확정)**: 같은 헤더 자리(headerLeft)를 4곳이 경합 작성. ① (주 원인) 화면 전환 시 **이전 화면의 blur cleanup(화살표 삭제)이 다음 화면의 focus 주입 뒤에 실행될 수 있어**(React Navigation focus/blur 순서 비보장) 진입 직후 화살표가 지워짐. ② (부 원인) MapScreen이 setOptions에 `headerLeft: undefined`를 항상 포함 + deps에 user 객체 identity — 대화 중 user 갱신 시 화살표 와이프.
- **수정("포커스 화면만 헤더에 쓴다" 불변식)**: 3화면의 blur cleanup 제거(focus 시 set만), MapScreen은 payload에서 headerLeft 키 삭제 + 자체 focus 클리어로 일원화, deps는 `!!user`로 교체. 포커스 화면은 항상 1개이므로 경합이 구조적으로 불가능. Map 복귀 시 화살표 제거(잔존 방지)는 Map focus 클리어가 승계. App.tsx 무변경.
- **사용자 설명문**: "뒤로가기는 원래 상단 탭 헤더 맨 왼쪽(기획사명 왼편)에 ← 로 넣은 것이었는데, 여러 화면이 같은 헤더 자리를 번갈아 쓰는 구조여서 화면 전환 타이밍에 화살표가 지워지는 결함이 있었습니다. v3.201에서 '지금 보는 화면만 헤더를 쓴다' 방식으로 바꿔 3화면 모두에서 항상 보이도록 고쳤습니다."

### 검증
- 변경 6파일: hooks/useAndroidKeyboardLift.ts(신설), components/PlaylistPickerSheet.tsx, screens/LyricsInputScreen.tsx, screens/ComposerInputScreen.tsx, screens/DialogueScreen.tsx, screens/MapScreen.tsx. tsc 0건.
- tester U-1~U-13 전부 PASS(5대 게이트 포함), FAIL 0. 주석 1건(입력 리셋 1줄 — 취지 내 허용).

### 편차·실기기 잔여 (E-2 필수 확인)
1. **재선택 모달 리프트 절반**: 모달 컨테이너가 중앙 정렬(flex center)이라 `marginBottom: kbPad`는 실제로 **kbPad의 절반만** 위로 이동시킨다(중앙 정렬에서 마진은 잔여 공간을 반분). 컨테이너가 중앙 시작 + maxHeight 60%라 대부분 기기에서 절반 리프트로도 입력행이 키보드 위로 나올 것으로 계산되나, **소형 기기·키 큰 키보드에서 하단 일부 가림 가능** — 실기기(E-2)에서 재선택 입력 중 입력행 노출 확인 필수. 가려지면 후속: kbPad>0일 때 `translateY` 직접 이동 또는 overlay를 flex-end+패딩으로 전환.
2. **iOS 검증 이관**: C의 Dialogue(transparentModal)가 iOS에서 부모 탭 헤더를 덮는지(헤더 자체 미노출 가능) — iOS 실기기/시뮬레이터 확인으로 이관. 필요 시 presentation 'card'+fade 전환이 1안(자체 배경 불투명이라 transparentModal 필요성 낮음).
3. persistTaps: 목록·선택지 ScrollView에 `keyboardShouldPersistTaps="handled"` — 키보드 열린 상태에서 항목 탭 1회 동작(정합 확인됨).

### 특이사항
- v3.200 커밋(d8f0b4a) 선행 완료 후 착수 — 전제 충족. DialogueScreen은 v3.200 모드 토글과 같은 파일이나 접촉 블록 분리(cleanup 3줄 삭제 + 주석), 간섭 없음.
- ArtistInput/ArtistResult/ArtistCody의 구패턴(unmount cleanup) 통일은 후속 백로그(3화면과 교차 전환 없음 — 경로상 Map 경유).
- 스테이징(frontend 브랜치 — 커밋 시 자동 push 유의): 앱 6파일(**hooks/useAndroidKeyboardLift.ts untracked — git add 필수**) + 산출물(PLAN.md·REPORT.md·TESTPLAN.md). 장기 미커밋 파일(assets·문서 등)은 제외.

### 판정
**승인** — 계획(§1~3) 대비 구현 정합, tsc 0건·테스트 FAIL 0. 잔여는 실기기 확인 항목 2건(위 편차 1·2)으로 릴리스 차단 아님.

## v3.202 — 2026-09-21/22 (실기기 10건: 배경재생·입력가림·모드가이드·헤더폭·디렉터 대화·이미지 디렉터·연주곡)

### 요청 (원문 요지)
백그라운드 자동재생 실패 / 하단 팝업 입력창 반 가림 / 일반·저작권 모드 둘 다 로그 기록 + 저작권 모드 가이드 안내 / 작업실 헤더 기획사명 폭 축소 / 작사 디렉터 재선택 시 구값 응답 잔존 / 작곡 디렉터 수정 시 초기화 / 작곡 아티스트 선택 항상 노출 + 없으면 아티스트 디렉터 연결 / 이미지 디렉터 가사 기반 옵션·실패 후 대화 유실·수정 시 초기화 / 이미지 생성 지연·오류 원인 / 가사 없는 곡(연주곡) UI 부재.

### 원인 (전 항목 실측)
- **A**: 원격 [BTDebug] 실측 — didJustFinish는 배경에서도 발화(JS 생존), 실패 원인은 Android Doze의 네트워크 차단(UnknownHostException). 프리로드 히트 시 전환 성공. 부수 결함: 실패 시 초당 ~8회 재시도 폭주(백오프 없음), 프리로드 창(20s/85%)이 Doze 진입보다 늦음.
- **B**: 재선택 모달 overlay가 center 정렬 → marginBottom 리프트가 Yoga 산식상 kbPad/2만 유효(담기 시트는 flex-end라 정상). ReportModal/AppealModal/AlbumCreateModal은 Android 회피 전무(동종). edge-to-edge에서 adjustResize 무력.
- **C**: creationLogService에 creationMode 참조 0건 — **양 모드 공통 기록 확인**(분기는 발매 track_type뿐). 가이드는 1회 showAlert뿐이고 동일 모드 재탭 no-op 가드로 재열람 불가.
- **D**: nameMaxWidth 산식이 화살표(38px) 미반영, HomeHeaderActions 실측 208~229px에 여유가 −1~+20px뿐이라 6px 순증이 임계 초과, end 컨테이너 flexShrink:0으로 타이틀 침범.
- **E/F/G/J**: **라이브 작곡 대화 = MusicGenerationScreen**. F=performRewind의 prev.slice 파괴적 절단(설계였음), G=아티스트 게이트 list.length>0, E=재선택 후 디렉터 에코 버블 구값 잔존, J=가사 게이트 이중 차단 + vocal→'instrumental' 경로 2중 단절로 발동 불가.
- **H**: ① stale closure로 가사반영 질문(step 1.75) 스킵(아티스트 없는 사용자) ② doRegenerate가 대화 전체 와이프+step 2 강등 ③ performRewind 파괴적 절단+질문 중복+result 모드 탭 불가 ④ coverExtras 모듈 상태가 화면과 분리되어 안 보이는 답이 요청에 실림 ⑤ 실패 시 finally가 coverTrackId 클리어 → 재개 불가.
- **I**: gpt_image_2 2048² 서버 150~180s 동기 처리. 실패 3건 실측 = 클라이언트 ERR_NETWORK 단절 후 **서버는 완성**(별 5 차감+이미지 고아). GET /api/upload/cover-sessions에 완성본 존재 → 백엔드 무변경 폴링 회수 가능.

### 수행 결과 (앱 전용, 백엔드 무변경)
1. **A-lite**: 프리로드 이중 트리거(로드/스왑 성공 직후 eager + 기존 20s/85%), 창을 60초로 합집합 확장(U-2 보강), 실패 백오프 곡당 3회·10초(폭주 제거). v3.197 셔플 핀·5중 검증 무침투.
2. **B**: 작사 재선택 모달 flex-end 전환+동적 maxHeight(담기 시트 검증 패턴). 모달 3곳은 useAndroidKeyboardLift+translateY(-(kbPad+insets.bottom)/2 = 가시영역 재중앙, 수학 검증 통과)+동적 클램프.
3. **C**: consentTexts COPYRIGHT_RECORD_GUIDE 신설(금지어 0건 grep 확인), recChip 탭 가능화+info 아이콘 → PolicySheet 재사용(신규 컴포넌트 0), 모드 alert에 '자세히 보기' 버튼. **양 모드 기록은 기존대로 정상 — 코드 변경 불요 확인**.
4. **D**: nameMaxWidth 300/90 + headerRightContainerStyle flexShrink:0·headerTitleContainerStyle flexShrink:1 안전망.
5. **E/F**: performRewind 파괴적 절단 폐기 → commitExchange 단일 커밋 경로 + ChatMessage.echoOfStep 메타로 디렉터 에코 버블만 정확히 치환(암묵 idx+1·문자열 검색 배제). 이후 대화·답변·step 전부 보존.
6. **G**: 아티스트 게이트 제거(항상 노출), 0명 선택 시 showAlert → Dialogue(artist) push(작곡 대화 스택 보존, 복귀 시 refreshArtists 반영).
7. **H**: fix①~⑤ 전면 — 인자 전달로 stale closure 제거, step-2에 '가사 내용 기반으로 생성' 동등 버튼, doRegenerate 와이프→append 복귀, commitRewindAnswer 비파괴 치환(result 모드 탭 허용), musicStore cover* 영속 + 클리어를 성공 경로로 이동, hasPendingGeneration 판별 강화(재차감 방지).
8. **I-lite**: ERR_NETWORK/타임아웃 시 cover-sessions 폴링(15s×12, created_at≥t0−120s+cover_object_name) → 완성본 회수 성공 처리(**재생성 호출 0 = 재차감 없음**), 대기 안내 문구.
9. **J**: ComposeLyricsPick '가사 없이 만들기(연주곡)' 카드(목록 위+빈 상태), ComposerSelect 게이트 예외+끈적 정규화, MusicGeneration 조건 분기 스킵(스텝 번호 체계 유지)+INSTRUMENTAL_OPTION 로컬 상수(공유 VOCAL_OPTIONS 무변경 — 아티스트 설정 UI 오노출 차단), MusicLoading/musicService 배선+연주곡 프롬프트, musicStore instrumental+리셋 2경로.

### 정정 기록 (중요)
- **v3.199 D(작곡 재선택 이식)·v3.201 B(Composer 자유입력)의 ComposerInputScreen 분은 죽은 코드 대상 작업이었음** — 해당 화면은 v3.131(커밋 1970d7f)부터 도달 경로가 없었고, 당시 tester PASS는 라이브 동작 검증이 아니었다. v3.202에서 화면 삭제 + App.tsx 등록 3곳 + DialogueScreen 타입 키 제거로 폐기 완료. LyricsInputScreen 분은 라이브이므로 유지.
- 오케스트레이터의 직전 "연주곡 파이프라인이 이미 동작한다"는 답변도 같은 죽은 코드를 근거로 한 오답이었음 — 실제로는 진입 경로·전송 배선 모두 부재했고 v3.202에서 신설.

### 테스트
tester 통합 검증: unit 18 / api 1 / e2e 4. 핵심 FAIL 게이트 9건 중 8건 즉시 통과, FAIL 3건(타입 키 잔존·프리로드 창·REPORT 정정)은 오케스트레이터가 수정·기록 완료 후 재판정 없이 커밋 승인. tsc 0건. 리프트 산식은 수학 검증으로 "절반 결함 재림 아님" 확정.

### 실기기 잔여 (배포 후 확인)
E-1 Doze 배경 재생(프리로드 히트·백오프 ≤3회/≥10s), E-2 연주곡 실생성 1회(Suno 과금), E-3 커버 실패 폴링 회수·잔액 무차감 대조(+앨범 모드 성공 후 coverCharacterObjectName 미정리 엣지), E-4 비파괴 재선택·소형 기기 키보드 4모달·0명 CTA 왕복.

### 후속 과제
포그라운드 서비스/track-player 이관(A 근본), 이미지 비동기 잡 전환+고아 자동 복구 배치(I 근본), 댓글 패널 Android 키보드 회피, '저작권 등록 모드' 라벨 재검토(사용자 결정 대기).
