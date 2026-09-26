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

## v3.203 (2026-09-22) — 연주곡 파이프라인 완성: 백엔드 미시작 버그 수정(prod 1차 배포) + 작곡 디렉터 연주곡 질문 5개 한정 + 곡 길이(1~6분) 선택 신설

### 요청 (원문 요지)
연주곡은 장르·분위기·곡 길이(최대치 조사해 설정)·참고할만한 곡·BPM **만** 선택하게 하고 나머지 질문 제거 + 오케스트레이터가 진단한 백엔드 연주곡 미시작 버그(원인 A·B)를 함께 수정. 백엔드 수정·prod 배포 사용자 승인 완료.

### 원인 (PLAN v3.203 실측 확정)
- **A** `generate.py:636` — `will_start_music = bool(start_music_gen and lyrics)` → 연주곡(lyrics='')은 Suno 미시작·무과금 draft 방치(실사고 gen `6ab1a85a7bb9bac64cfd15c6` "Fall in my heart").
- **B** `suno_generator.py:134` — `use_custom = bool(lyrics...)` → 게이트만 풀면 customMode=false로 나가 style/title이 Suno에서 무시됨(장르/무드/BPM 유실).
- **duration 사슬 단절**: 앱 duration:120 고정 → mongo 저장까지만 오고 래퍼(:311)가 버림, Suno body에 미전송. Suno V6는 duration 10~360초 직접 지원(docs.sunoapi.org 실측) → **최대 6분 확정**. 일반곡에 duration을 실으면 전곡 2분 클램프 — 연주곡 한정 전달이 필수 계약.

### 수행 결과
**백엔드 (maidol-ec2 backend_9004, 1차 배포 완료·health 200 확인)**
1. generate.py 게이트: 연주곡(vocal='instrumental')은 가사 없어도 시작+과금(compose 15⭐) + `[generate] ... instrumental start` 로그. 래퍼가 duration을 generate_music_suno로 전달.
2. suno_generator: `use_custom = lyrics or is_instrumental`, 빈 가사 prompt/title 폴백, **V6 계열+연주곡 한정** `body["duration"] = max(10, min(360, int(duration)))`, `[suno] ... customMode/instrumental/duration` 로그. 원본 백업 `.bak_pre_v3203` 2개 존치.
3. **2차 수정 대기(사용자 실행)**: 스키마 duration 기본값 None + `or 30` 폴백 3곳 제거(4줄) — `/private/tmp/v3203_generate.py`에 검증 완료 상태로 대기. scp 업로드가 권한 분류기에 차단되어 **사용자 scp → 재배포 필요**. 현행 prod는 '자동' 연주곡이 duration=30으로 나감(파괴적 아님, 2차로 해소).
4. 실사고 gen `6ab1a85a7bb9bac64cfd15c6`: 무과금 draft 존치(조치 없음, 기록만).

**앱 (frontend, 6파일, tsc 0건)**
1. musicStore: `durationSec: number|null` + setter + 리셋 경로.
2. MusicGenerationScreen: **step 310(곡 길이)** 신설 — 1~6분 버튼+자동, questionForStep/렌더/commitExchange 경유(되감기 비파괴 치환 자동 편승). 연주곡 체인 재배선: **카드 진입 0→300(장르)→301(분위기)→310(길이)→5(참고곡)→10(BPM)→13(완료)** / **보컬 스텝 INSTRUMENTAL 선택→310→5→10→13**. 아티스트(200)·보컬(3/220/4)·내 목소리(210/12)·제외(6)·자유도(7)·대중/실험(8)·참고음 세기(9)·키(11) 질문 연주곡 분기에서 전부 제거 — 질문 정확히 5개.
3. ComposeLyricsPick handleInstrumental: 잔존 제목 클리어(`setGeneratedTitle('')`).
4. MusicLoading/types/musicService 배선 — **duration 계약: 연주곡 = durationSec 실림·'자동'이면 필드 생략 / 일반곡 = 120 고정(백엔드가 Suno에 미전달이라 무영향)**.

### 정정 기록 (중요)
- **tester 판정 회부 수용**: handleInstrumental의 `setGeneratedLyrics('')`는 **제거**(제목만 클리어). 사유: 미자산화 가사 드래프트가 카드 탭 한 번에 유실될 수 있음(2026-09-07 가사 유실 사고 취지). 연주곡 body에는 musicStore.lyrics('')만 실려 오염 경로 없음 — 수정 후 tsc 0건 재확인.
- **저장소 mode-only 오염 정리**: 100644→100755 변경 834건 발견, 전량 chmod 원복(잔여 0). 콘텐츠 diff 무관 — 커밋 오염 방지.
- **TESTPLAN U-3 정오(저널)**: U-3 판정식의 "자동→body duration 120" 표기는 확정 계약(자동→duration 키 생략)과 불일치 — **계약이 우선**, TESTPLAN 본문은 소급 수정하지 않고 여기 정오로 남김.
- musicalKey 잔존 파라미터는 연주곡에도 유효한 Suno 파라미터라 모순 아님(질문만 제거, 기록).

### 검증 (tester 1차 게이트: 통과 + planner 최종 스팟체크)
- tester: U-1~U-8·A-1~A-3(코드 판정분) 전부 PASS, FAIL 게이트 8건 중 커밋 차단 0건, 재현 스크립트 21케이스 ALL PASS. A-3 ⑤는 prod 현행 FAIL — 2차 배포로 해소되는 **예정된 이월**로 명시.
- planner 스팟체크(2026-09-22): prod `generate.py:638` 게이트·`suno_generator.py:136/203`(use_custom 예외·클램프)·백업 2개·health 200 실측 확인. 앱 durationSec/step 310/제목만 클리어/duration 계약(`musicService.ts:294`) 실측 확인 — PLAN 대비 결손 없음.

### 남은 절차 (사이클 완료 조건)
1. **사용자 scp**: `/private/tmp/v3203_generate.py` → 서버 반영 → 2차 배포(빌드→재기동→health 200) — '자동' 연주곡 duration=30 해소.
2. 2차 배포 후 **A-4/A-5 서버 실측** + **E-3 Suno 실호출 스모크 1회**(테스트 계정, compose 15⭐ 과금 허용): 연주곡 3분 → completed·보컬 없음·`[suno] duration=180` 로그·결과 길이 확인.
3. 실기기 수동 확인: 연주곡 5질문 체인(카드/보컬 스텝 2경로), 곡 길이 되감기 재선택, 일반(가사) 흐름 회귀 0, '자동' 선택 결과 길이.

### 백로그
- 사장 코드 4건(handleRefStyleConfirm·녹음 핸들러 3종 등 호출처 0) 정리 — 별도 청소 사이클.
- 연주곡 결과/발매 화면 빈 가사 표기 정리, 제목 편집 UI(제목 스텝 축소의 전제 — 사용자 결정).

---

## v3.204 (2026-09-22) — 디렉터 대화 편집 UX 통일(작사 방식) + 커버 질문 순서·중복 버튼 정리 + 미세조정 오류 복구 + 후보 재생바 시크 + 튜토리얼 오버레이 신설

### 요청 (원문 요지)
① 작곡 후보 2곡 미리듣기 재생바를 직접 움직일 수 있게 ② 이미지 디렉터 마지막 질문에서 '가사로 생성' 버튼 재노출 금지 ③ 세부 설정에서 구도보다 배경 질문이 먼저 ④ 작곡·이미지 답변 편집을 작사 디렉터처럼 "탭 → 바로 수정 팝업"으로 통일(할지말지 확인 팝업 금지) ⑤ 이미지 미세조정 반복 오류 수정 ⑥ 최초 접속 시 페이지별 최상위 레이어 튜토리얼 UI.

### 원인 (PLAN v3.204 실측 확정)
- **⑤ 미세조정 "계속 오류"**: 서버 refine은 132~141초 동기 처리인데 클라이언트 연결이 도중 단절(v3.202 실측 계열) → 앱은 매번 실패 표시, 서버는 완성+⭐5 차감 완료. 최근 14일 access 로그에 `POST /api/upload/refine-cover` 0건. **9/22 03:05 실측**: 같은 세션에 35초 간격 이중 차감(⭐10)·둘 다 new_version=1(버전 경합). v3.202 I-lite 폴링 복구는 doGenerate 전용이라 refine 미커버 + `refining` 가드가 ⭐ confirm await 앞이라 confirm 대기 중 이중 제출 가능.
- **② 중복 버튼**: 1.75(가사 반영 질문)는 트랙 모드에서 항상 출력되는데 v3.202(H-②)가 step 2에 동일 버튼을 추가 — "1.75를 놓친 사용자"라는 도입 근거가 실측상 존재하지 않는 경로.
- **④**: 작곡·이미지 모두 v3.202 비파괴 치환 인프라(commitExchange/commitRewindAnswer)는 이미 보유 — showAlert 확인 팝업만 제거하고 진입 UX를 작사 모달로 바꾸면 성립.

### 수행 결과 (앱 12파일 — 신규 2, tsc 0건. 서버·0_platform 무접촉 = 읽기 전용 준수)
1. **① MusicResultScreen**: 비교 카드·단일 플레이어 진행바 2곳을 Slider 시크로 교체(PlayerScreen 검증 패턴: isSeekingRef+seekValue 버퍼, 콜백 튐 방지). LISTEN `{action:'seek', from_ms, to_ms}`는 onSlidingComplete에서만 1회, 음이 아닌 정수 클램프. duration 비유한/0이면 비활성.
2. **② CoverGenerationScreen**: step 2 '가사 내용 기반으로 생성' 버튼 + handleLyricsUse fromStep 분기 제거 — 가사 반영 변경은 1.75 버블 편집으로 일원화.
3. **③ CoverGenerationScreen**: 세부 체인 배경(1.85)→구도(1.8)→(인물 시) 표정(1.82)→색감(1.9) 재배선(`proceedToBg` 신설, `proceedToPalette` echoOf 파라미터화). 스텝 번호 불변 — 영속 coverStep·되감기 호환.
4. **④ 편집 UX 통일**: `components/AnswerEditModal.tsx` 신설(작사 재선택 모달을 마크업·스타일 그대로 추출 — 선택지+자유 입력+extraActions+키보드 리프트·동적 maxHeight). LyricsInput은 이 컴포넌트로 치환(회귀 0). 작곡·이미지의 "이 답변만 다시 고를까요?" 확인 팝업 삭제 — 선택지형 스텝은 탭 → 즉시 모달(rewindRef만 세팅, setStep 금지 — 기존 핸들러의 되감기 분기가 치환·복귀), 연쇄(1→1.5, 302→300, 220→210)는 [step] effect로 추적. 복합 스텝(가사 편집·슬라이더·업로드·목록형)은 무확인 즉시 되감기 + 입력 영역 상단 수정 배너([취소]=원위치 복귀). 예외: 이미지 step 0(곡 변경)만 파괴적 확인 팝업 유지.
5. **⑤ CoverGenerationScreen refine**: (a) `refineSubmitGuardRef` — ⭐ confirm await **전** 세팅·finally 해제로 이중 제출 봉인. (b) 네트워크 단절 시 실패 확정 대신 `GET /upload/cover-history/{id}` 15s×최대 12회 폴링 — 요청 직전 버전 기준 `current_version` 증가분 회수(재요청 없음=재차감 0), 폴링 중 안내 문구, 회수 실패 시에만 실패 알럿(+별 소모 안내 1줄). 백엔드 무변경.
6. **⑥ 튜토리얼**: `components/TutorialOverlay.tsx` 신설(RN Modal 최상위 레이어, 딤+하단 카드+도트+다음/건너뛰기, AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` 1회 노출·읽기 실패 시 미노출, ref `show()` 재노출). 장착 6화면: 차트·플레이리스트·피드·검색·작업실(Map)·플레이어. Map은 기존 인라인 튜토리얼 Modal을 스텝으로 이관(문구 유지), ⓘ 버튼 = 재노출.

### 검증 (tester 게이트: 통과 + planner 최종 스팟체크)
- tester: U-1~U-9 + A-1 전부 PASS, FAIL 게이트 6건 전부 통과. LISTEN seek는 테스트 계정 실전송 200 확인(from_ms=0 경계 포함), cover-history 응답 스키마 실측 일치. 구순서로 저장된 coverStep 복원 4케이스 데드엔드 0.
- planner 스팟체크(2026-09-22): ① Slider+seek 1회 기록(MusicResult :16/:157~166/:403~418) ② step2 버튼 부재(:783/:1874 주석) ③ 체인 배선(proceedToBg :661, bg→shot :728/:744/:751, shot→palette(1.8) :696, expr→palette(1.82) :706, lyricsSkip→bg(1.75) :840/:845) ④ AnswerEditModal 3화면 도입·확인 팝업 삭제·이미지 step0 확인만 잔존(:905)·수정 배너(:1992~2008) ⑤ 가드(:234/:1265/:1275/:1358)+폴링(:1223/:1334) ⑥ 6화면 장착·키 프리픽스 — 전 항목 PLAN 정합, 신규 2파일 AIDOL·이모지 0건. 서버 파일 무변경 확인.
- tester 경미 노트 3건(비차단, 백로그): 작곡 :400 repickRef 미복원 극단 조합 / 커버 1→1.5 연쇄 취소 시 버블 잔존(기존 시맨틱 유지) / U-2⑤ sound 동일성은 실기기 E-1ⓒ에서 확인 권장.

### 남은 절차 (실기기 이관)
1. **E-1** 시크 체감(비교 카드·단일 플레이어, 드래그 1회당 seek 이벤트 1건) — ⓒ variant 전환 직후 시크 포함.
2. **E-2** 커버 질문 순서(배경→구도→표정→색감)·편집 모달 육안(작사/작곡/이미지 3화면, 연쇄 케이스 포함).
3. **E-3ⓑ** 미세조정 기내모드 재현 — 폴링 회수·재차감 0·잔액 동기화.
4. **E-4** 클린 설치 튜토리얼 6화면 순회(1회 노출·재진입 미노출·Map ⓘ 재노출·비로그인 차트/검색).
- (별개 존속) v3.203 이월분: 서버 2차 배포(사용자 scp `/private/tmp/v3203_generate.py`) 대기 + E-3 Suno 실호출 스모크 — 이번 사이클과 무관하게 유지.

### 백로그
- **서버(사용자 승인 후 별도 사이클)**: refine 동시 요청 버전 경합(세션 락/멱등키), 이중 차감 환불 1건(user c19acda4 ⭐5, 9/22 03:05), 장시간 동기 POST 비동기 잡+폴링 전환.
- tester 경미 노트 3건(위 기재), 설정 화면 '튜토리얼 다시 보기' 일괄 리셋, generation 스트림 Range(206) 지원(6분 곡 미버퍼 구간 시크 지연 실측 시).

## v3.203 이월분 완결 (2026-09-22, 서버 2차 배포 + E-3 스모크)

- **서버 2차 배포 완료**: 사용자가 scp로 `/private/tmp/v3203_generate.py` 업로드(체크섬 `bdc2b7b4…` 일치) → docker 재빌드·재기동, health 200·기동 무오류. 최종형 반영 실측: GenerateRequest.duration 기본값 None(생략=자동), doc raw 저장, add_task/재시작 경로 `or 0` — 연주곡 '자동'=Suno duration 미전달 계약 성립.
- **A-5 배포 스모크 PASS**: health(로컬·외부) 200, tracks/artists/charts 기존 스키마, traceback 0. 실트래픽 보컬곡 duration 관측 기회 없음(비차단, 게이트 정적 재확인 완료).
- **E-3 연주곡 실생성 스모크 PASS(1회)**: 테스트 계정(가입보너스 50⭐) → Jazz·Romantic·BPM90·180초 연주곡 gen `6ab20557dcf8538e36ab54a5` — 65초 만에 completed. 로그 사슬(`instrumental start` → `customMode=True instrumental=True duration=180`, model V6) 정상, 잔액 50→35(정확히 −15, 재차감·환불 0), doc(vocal/duration/point_cost/result) 정합, creation_log SESSION_START→GEN_REQUEST→GEN_RESPONSE 기록, **결과 오디오 실측 179.56s/179.96s — 요청 180s 대비 오차 0.5초 미만(Suno V6 duration 파라미터 정밀 제어 확인)**.
- 남은 실기기 확인: 연주곡 5질문 체인 육안(E-1·E-2 상당) + '자동' 케이스 1회는 사용자 실사용에서 확인 권장(추가 과금 회피로 미실행).

## v3.205 (2026-09-22) — 문의 DM 입력바·다음곡 로컬 프리다운로드·성별 자동 필터 + 공지 ④ 개정(official 채널 글) 코드분

**요청 5건**: ① 신고→official DM 하단 입력창 잘림·키보드 가림 ② 백그라운드 다음곡 재생 실패 ③ 블루투스 차량 UI 곡 메타데이터 미표시 ④ 문의 방법·FAQ 공지사항 작성 ⑤ 아티스트 꾸미기 상의/하의 성별 필터.
**④ 사용자 개정 지시(당일)**: DM 브로드캐스트 반려 — maidol_official 계정의 공지사항(채널 글)로 작성, 디폴트 팔로우 기반 채널 확인 방향.

### 수행 결과

- **① DmChat 입력바**: 컨테이너 `paddingBottom: insets.bottom`(edge-to-edge 내비바 잘림 해결) + 신규 `hooks/useKeyboardOverlapLift.ts`(Android 한정, 키보드-입력바 실측 겹침만큼 marginBottom 리프트 — API 34↓ 리사이즈 기기는 겹침 0→리프트 0으로 이중 보정 구조적 불가). iOS KAV 경로 불변.
- **② 다음곡 로컬 풀 프리다운로드**(services/playback.ts): 프리로드를 `expo-file-system/legacy` downloadAsync 로컬 파일로 교체 — 스왑 재생이 네트워크 무의존("화면 꺼진 뒤 첫 전환" 구조 해결). 파일 수명 전수 관리(스킵/닫기/셔플/실패/세대 변경 시 삭제 + 기동 purge, purge-다운로드 경합 await 방어), AppState active 복귀 시 놓친 다운로드 재트리거. 한계(정직): N+2곡 연쇄는 Doze 지속 시 실패 가능 — 근본은 차기 이관.
- **③ BT 메타데이터**: expo-av 구조상 이번 사이클 해결 불가 판정(코드 변경 없음) + audioMode.ts 웹 폴백 'AIDOL'→'MAIDOL' 1줄. **차기 본작업 후보: expo-audio 이관 스파이크**(expo-av SDK 55 제거 예정 — 이관 필수 경로, PLAN 참조).
- **⑤ 성별 자동 필터**(ArtistCodyScreen): 아티스트 성별 3단 폴백 해석 → 상의·하의·신발 피커에 genderMatches 기본 적용('공용' 포함), '전체 보기' 토글 칩, 성별 미상 시 미적용(전량 노출), 0건 빈 상태 안내. 위시리스트·5단계 드릴다운·SAMPLE 폴백 불변.
- **④ 개정 — planner 실측**: 디폴트 팔로우 실재(가입 자동 맞팔 auth.py:291·oauth.py:212, startup 백필, 언팔 403 가드 — prod 216명 중 215명 팔로잉). 공지 = official의 kind=community 글(UserChannel 커뮤니티 탭). 등록 경로 = 컨테이너 python insert(official 로그인 불가 설계) + 알림 팬아웃, 글은 DELETE로 회수 가능(리허설 등록·삭제 검증 선행 스펙). 기존 DM 브로드캐스트 스펙 폐기 — 미발송.
- **④ 앱 수정(코드분)**: FeedCard '공지' 배지, 설정 '공지사항' 진입 행(GET /dm/official 경유), UserChannel `initialTab` 파라미터(미지정 시 music 불변). **오케스트레이터 픽스 1건**: PLAN B-1 스펙 결함 — 커뮤니티 글은 일반 유저도 작성 가능해 kind만으로는 전 유저 글에 배지가 붙음 → 신규 `services/officialService.ts`(official id 프로세스 캐시, 실패 60s 스로틀·비로그인 시 배지 미표시 강등)로 **작성자=official일 때만** 배지. Settings 진입도 동일 서비스로 통일.

### 검증 (tester 정적 게이트)

- U-1~U-9 + A-3(로컬 가능분) 전부 PASS — FAIL 게이트 6건 전수 통과: 노출 'AIDOL' 0건 / DmChat 이중 보정 불가 / 프리로드 파일 수명 전수표(고아 경로 0) / 스왑 로컬 전용 / 위시·드릴 무파괴 / 서버 파일 diff 0. `tsc --noEmit` exit 0(④ 코드분·픽스 포함 재확인).
- ④ 개정분 RU-1~4 정적 확인: 배지 렌더 단일 지점·official 조건, 하드코딩 0, initialTab 하위호환(기존 진입 6지점 무파라미터), diff 격리.
- 비차단 특기: iOS KAV+insets 여분 간격 가능성(E-1 ⓒ 실기기 확인), 재생 방치 시 소비 파일 1개 잔존(상한 1·purge 회수 — 누수 아님), U-8 로그 키명 경미 이탈.

### 남은 것 (이월)

1. **실기기 검증(사용자/tester)**: E-2 ⓑ 기내 모드 이어재생(**사이클 완료 조건**)·ⓔ 1시간 연속 재생 연쇄 한계 실측, E-1 입력바(API 35/34·iOS), E-3 성별 필터, RE-1~4 공지 동선(등록 후).
2. **④ 데이터 등록(승인 대기)**: 사용자 최종 go + 알림 팬아웃 포함 여부 결정 → 리허설 글 등록·삭제 검증 → 본 공지 3건 등록(TESTPLAN RA-0~5). **승인 전 프로덕션 쓰기 미실행.**
3. 서버 백로그(별도 승인): 미세조정 이중 차감 환불 1건(⭐5)·refine 비동기화, frontend.log 호스트 마운트, expo-audio 이관 스파이크.

**특이사항**: 사이클 중 세션 중단(사용량 한도)→신규 세션에서 복원 이어받음. JS 변경만이라 빌드 설정 변경은 없으나 expo-updates(OTA) 미도입 — 사용자 반영에는 새 APK(EAS) 빌드 필요(정정: 최초 보고의 '재빌드 불필요'는 오기). 커밋은 2_housing 10파일 + 산출물 3종 한정(워킹 트리의 1_MV_wedding 등 별개 프로젝트 변경분 제외).

## v3.205 ④ 데이터 등록 완결 (2026-09-22, 사용자 승인·직접 실행)

**승인**: 사용자 최종 go + 알림 팬아웃 포함. 커밋 b475f08 푸시(사용자 지시 "푸시까지") 후 진행.
**실행**: 자동 권한 분류기가 원격 쓰기를 차단해 사용자가 notice_runner.py(프로젝트 루트, 비커밋)를 터미널에서 직접 실행 — 리허설·본 등록 모두 사용자 손으로 수행됨.

### 절차·결과 (TESTPLAN RA 게이트)

- **RA-1 리허설 PASS**: 점검 글 1건 insert(팬아웃 없음) → 공개 타임라인 최상단 노출 확인 → purge_feed_document 삭제 → check feed_exists=False·comments/notifications/likes 전부 0 + 타임라인 소멸 교차 확인 — 등록·회수 경로 실데이터 검증 완료.
- **RA-2 본 등록 PASS**: 3건 등록(3→2→1 순서, 31초 간격), `GET /api/feeds/user/{official_id}?kind=community` 정확히 3건, 최상단부터 [문의 방법 안내 / FAQ / 베타 안내], **본문 PLAN 원고와 프로그램 diff 0**, kind=community·title null·author maidol_official 전건 일치.
  - feed_id: 문의 6ab221f66602ec9e9cdd6692 / FAQ 6ab221d76602ec9e9cdd65ba / 베타 6ab221b86602ec9e9cdd64e2
- **RA-3 팬아웃 PASS**: 건당 sent=215(팔로워 215명 전원 — official 비팔로워라 제외 대상 0), 총 645건 인앱 알림(OS 푸시 아님).
- **RA-4 타임라인 PASS**: 공개 타임라인 최상단 3장 = 공지 3건(팔로잉 부스트), 기존 글(무신사 등) 후순위 존치.

### 회수 런북 (필요 시)

`cat notice_runner.py | ssh maidol-ec2 "sudo docker exec -i maidol-app python - purge <feed_id>"` — 글+댓글+좋아요+해당 알림 연쇄 파기(리허설로 검증됨). 이미 열람된 노출은 회수 불가.

### 잔여

- RE-1~3 실기기(새 APK 반영 후): 설정→공지사항 직행·'공지' 배지·기존 진입 회귀 — 공지 배지/메뉴는 v3.205 코드분이라 **새 APK 빌드 전 구버전 앱에서는 배지 없이 일반 글로 표시**(내용·노출은 정상).
- notice_runner.py는 운영 도구로 프로젝트 루트에 비추적 존치(원고 상수 포함 — 차기 공지 시 재사용).

## v3.206 (2026-09-22) — 아티스트 꾸미기 카테고리 개편(악세서리·잠금) + 모자/가방 착용 방식 커스텀 + 서버 카테고리 개방

**요청**: 카테고리를 상의/하의/신발/악세서리(모자, 가방)로 재편, 나머지는 잠금 아이콘(이모지 아님), 모자(바로/거꾸로 쓰기 등)·가방(손에 들기/크로스/어깨) 착용 방식 커스텀. 서버 수정은 사용자 지시("너가 aws 서버에 직접 붙어서 수정해")로 직접 배포.

### 수행 결과

- **planner 실측**: 프로덕션 455건 = 상의157/하의145/신발153, 모자·가방 0건. 서버 ALLOWED_AD_CATEGORIES={상의,하의,신발,장소}라 모자/가방은 조회 400 + CSV 임포트 차단 — 적재 경로 자체가 막혀 있었음. 프롬프트(desc)는 앱이 전량 조립해 user_text로 통과 → 착용 방식은 앱 단독 반영 가능.
- **서버 배포(EC2 직접)**: business.py:30 허용 카테고리에 "모자","가방" 추가 1줄(+주석). admin_items.py CSV 검증은 같은 상수 import라 동시 해결. `business.py.bak.v3206` 백업 후 docker build → 컨테이너 재생성(host 네트워크·.env 주입, 6초 만에 UP·기동 에러 0). 검증: health 200, `?category=모자|가방` 400→**200 빈 배열**, 기존 455건·gender 필드 무변, 허용 외(안경 등) 여전히 400.
- **앱(ArtistCodyScreen.tsx 1파일, +231/−50)**: ① 그리드 = 활성 3장+악세서리 통합 카드(모자·가방 요약 병기, 칩 꾹 누름 개별 해제) + 잠금 4장(헤어스타일/헤어컬러/안경/문신 — Feather "lock" 벡터, 탭 시 showAlert '준비 중') ② 악세서리 피커 [모자|가방] 서브탭, category 파라미터 없는 전체 조회+클라 필터(400 회피 — 서버 개방 후에도 유효), 실데이터 0건 시 모자/가방 SAMPLE 5종씩 폴백 ③ 착용 방식 CAT_OPTIONS(모자: 바로/거꾸로/비스듬히 쓰기, 가방: 손에 들기/크로스로 메기/어깨에 메기) → 기존 fmt() 경로로 `모자="볼캡 (착용 방식:거꾸로 쓰기)"` 직렬화 + 선택 값만 【착용 방식 해석】 1줄(backwards 등 영문 힌트) 합성, **미선택 시 프롬프트 문자 동일**.

### 검증 (tester)

- U-1~U-6 + A-1 전부 PASS — FAIL 게이트 5건 통과: 이모지 잠금 0(Feather 벡터) / v3.205 성별 필터(상의·하의·신발 한정)·위시·드릴다운·폴백 diff 0 / desc 직렬화 확증 / 미선택 오염 0 / diff 격리(2_housing 1파일, 직전 사이클 8파일 diff 0). tsc exit 0.
- A-1 판정 노트: TESTPLAN의 "?category=모자 400 확인"은 서버 금일 배포로 사실관계 갱신 — **200 빈 배열이 정답**(배포 반영). 400 에러 메시지로 현행 허용값 실측: 가방/모자/상의/신발/장소/하의.
- 비차단 UX 노트: 모자 선택 시 피커가 닫혀 가방 추가 선택은 악세서리 카드 재탭 필요(선택 상태 유지 — 동시 선택 성립). 개선 여부는 실기기 확인 후 판단.

### 남은 것

- 실기기 E-1~E-4: 그리드·잠금 육안, 착용 방식 프롬프트 로그 확증, 모자/가방 동시 선택 UX, 기존 플로우 회귀 — **새 APK 빌드 후** (v3.205분과 합본 권장).
- 백로그: 앱 조회를 `?category=모자|가방` 직접 호출로 단순화(서버 개방됨), 모자/가방 참조 이미지 서버 필드 확장, 모자·가방 CSV 실데이터 적재(관리자 — gender 열 포함 권장, 잠금 해제 카테고리 확장 시 LOCKED_CATS 조정.

## v3.207 (2026-09-22) — 실기기 피드백 12건: 키보드 근본 전환·코치마크·first-run·차트 신곡·비밀번호 재설정·DM 이미지·성별 필터 발견성 + 1.1.0 릴리스 준비

**요청 12건**: ①코치마크(화살표 지시) ②차트 신곡 포커스 ③테스트 글 삭제 ④official DM 삭제 ⑤신고 입력 키보드 가림(새 APK에서도 재현 확정) ⑥신고 이미지 첨부 ⑦비밀번호 찾기 ⑧작곡 보컬선택 연주곡 제거 ⑨작사 듀엣 확인 ⑩성별 필터 미발견 ⑪튜토리얼 완전 최초 접속자 한정 ⑫작업실 ⓘ 제거 + APK/AAB(배포). 메일은 사용자 결정으로 AWS SES.

### 수행 결과 (앱 — 커밋 반영분)

- **⑤ 키보드 근본 전환**: v3.201/205 훅 2회 실패 인과 규명 — SDK 54 edge-to-edge 상시 강제에서 RN Keyboard 이벤트가 미발화/좌표 불일치(창 리사이즈 의존). **react-native-keyboard-controller 1.18.5**(네이티브 WindowInsetsAnimationCompat 직수신 — 인과 우회) 도입, KeyboardProvider 루트 + DmChat 입력바 + 시트/모달 5종(담기·신고·이의·답변편집·앨범) 일원화, 수동 리프트 전량 제거. 구훅 2종은 미사용 봉인. **네이티브 모듈 — 새 빌드 필수.**
- **①⑪⑫ 튜토리얼**: anchor registry 스포트라이트(4분할 딤+구멍+Feather 화살표, 대상 실좌표 measure, 실패 시 카드 fallback — 차트 ⋮·검색 2·플레이어 담기·피드 작성 버튼) / first-run 게이트(`getAllKeys` — 기존 키 1개라도 있으면 기존 유저 판정+seen 선기록 이중 차단, 완전 신규만 노출) / 작업실 ⓘ 제거(재보기 수단 소멸은 의도 정합).
- **② 차트**: 기본 탭 신곡·탭 순서 선두·발매일 표시·빈 상태 문구. 서버 무수정.
- **⑧ 연주곡 선택지**: step 3+편집 모달 동반 제거, '가사 없이 만들기(연주곡)' 카드 진입 생존. **⑨ 듀엣**: 재검증 — 메인 보컬 성별→스타일→서브 보컬(step 3→100→101) 정상 존재, 무변경.
- **⑩ 성별 필터**: 원인 = 서버 보유 gender("여성")를 앱이 재시작 후 미조회 → 칩 미노출. 서버 캐릭터 gender를 폴백 1순위로 연결 + 칩 상시 노출(미상 시 "성별 미설정 · 전체 표시" 안내).
- **⑦ 비밀번호 찾기(앱)**: 로그인 하단 링크 → 이메일 → 6자리 코드+새 비밀번호(가입 규칙 동일 검증) → 완료. "아이디는 가입 이메일" 안내. 비밀번호·코드 로그 0.
- **⑥ 신고 이미지(앱)**: 첨부 버튼→업로드 칩(재시도/제거)→이미지 단독/텍스트 동봉 전송→말풍선 렌더.
- **릴리스 준비**: app.json 1.0.0→**1.1.0**, 출시명·출시노트 문서(release-notes/v1.1.0.md).

### 서버·데이터 (스테이징 완료 — 원격 실행은 권한 차단으로 사용자 위임)

- **스테이징 6파일**(server_staging_v3207/, _orig 백업, DEPLOY.md — 재기동 절차는 오케스트레이터가 docker 재빌드·재생성으로 교정): ⑥ dm-image 업로드(본인 prefix·15MB·재인코딩)+메시지 이미지 직렬화·WS·구앱 안전 강등·admin CS 자동 노출 / ⑦ reset 2 엔드포인트(전 경로 균일 200 — 계정 존재 비노출, 코드 bcrypt 해시 Redis TTL 15분, 시도 5회·시간당 5회, 소셜 계정 메일 안내)+mailer.py(SES sesv2, IAM 롤 체인, 미구성 시 dev 폴백 — 로그로 코드 확인)+config 키. py_compile 전부 OK.
- **③④ 삭제 러너**(cleanup_runner_v3207.py, 비커밋): backup(JSON 전체 백업)→delete-feeds(4건 purge — official 글 방어 거부 내장)→delete-dms(official 발신 전량+빈 대화방 정리+잔존 대화 last_*·unread 재계산)→verify. 보존: 공지 3건·lovvepearl 글·peer DM 21건.

### 검증 (tester 통합)

- **U-1~U-9 전부 PASS**(머지 게이트): 구훅 소비처 0 / first-run 판정 경계 3케이스 / anchor fallback / 비밀번호·코드 평문 로그 0(앱+서버) / 연주곡 카드 생존 / v3.203~206 회귀 0 / package.json 변화 keyboard-controller 계열 3건뿐 / tsc exit 0.
- **앱-서버 계약 교차 불일치 0건**(경로·필드명·상태코드 수준). A-1~A-3 정적 대체분 PASS(균일 응답·해시 저장·prefix 차단·하위호환).
- [api] A-1~A-6·[e2e] E-0~E-8: 서버 배포·새 빌드 후 실측 대기. **E-1(키보드)이 사이클 최상위 완료 조건 — 재현 시 미세수정 금지·replan 회부.**
- 기록: 신규 설치 직전에 서드파티 SDK가 스토리지 키를 먼저 쓰면 신규가 기존으로 오판될 수 있음(노출 방향 아님 — E-3 실측 항목). A-2 타이밍 채널은 배포 후 실측.

### 특이·이월

- 원격 배포·데이터 삭제가 권한 분류기(Production Deploy/Remote Shell Writes)에 차단 — DEPLOY.md 절차와 러너 실행을 사용자 위임(v3.205 공지 등록과 동일 방식).
- SES 실발송 전 사용자 콘솔 작업 3종: 도메인 DKIM 검증·샌드박스 해제·EC2 롤 ses:SendEmail → .env MAIL_ENABLED=true 전환.
- 이월: ① 잔여 스텝 앵커 확대, ⑦ 실발송 전환 확인, [KeyboardCtl] 런타임 로그(디버깅 필요 시).

## v3.207 완결 (2026-09-22) — 서버 배포·데이터 정리·1.1.0 빌드 (사용자 실행 + 검증 PASS)

- **서버 배포**: 사용자 실행(권한 차단 위임) — 백업 5파일 → scp 6파일(체크섬 6/6 일치 확인) → docker 재빌드·재생성, UP 6초·기동 에러 0. 검증: health 200 / reset request 균일 200(로그엔 마스킹 이메일만 — 계정 존재 비노출 정상) / dm-image 401(라우트 존재) / 기존 API(tracks·ads 455·타임라인) 회귀 0. 비밀번호 재설정은 dev 모드 가동(서버 로그로 코드 확인 가능).
- **③ 테스트 글 4건 삭제**: purge 연쇄(댓글 7·알림 9 동반) — verify 잔존 0·알림 0. 공개 타임라인에서 소멸 확인.
- **④ official DM 정리**: 1,111건 전량 삭제, 빈 대화방 134 제거, 잔존 7 대화방 last_*·unread 재계산. verify: official 발신 잔존 0, official 공지 3건 보존, peer 메시지 보존(전체 51건 — official 대화 내 21건 포함). 사전 백업 cleanup_backup_v3207.json(384KB, 로컬).
- 관찰(비조치): 전체 대화방 19개 중 빈 대화방 2개는 이번 정리 대상 밖의 기존 잔재 — 필요 시 차기 정리.
- **빌드(1.1.0, versionName 인상)**: APK https://expo.dev/artifacts/eas/twdZlkP5cZRvXEE-9WuvEZnmCdpWiy5yBx3gmRI-aZI.apk / AAB https://expo.dev/artifacts/eas/pXwWTFS939xqa8BonxSWGtRV7LTrzZ6Fn22ZO5ZBQWU.aab — 출시명·출시노트 release-notes/v1.1.0.md.
- **잔여**: E-1~E-8 실기기(최우선: 신고·담기 키보드 — 재현 시 replan), SES 콘솔 3종 후 MAIL_ENABLED=true, Play Console AAB 업로드(사용자).

## v3.208 (2026-09-22) — 디렉터 휴식 보상형 광고 배선 복구 (AdMob SSV) + 서버 서명키 URL 버그 픽스

**요청**: "디렉터들 휴식시간에 광고 연동이 되어있잖아. 이 부분을 내부 테스트 단계에서는 admob에 등록 못해?" — 직답: 등록 가능이며, 실측 결과 **앱 ID는 이미 app.json에 등록·빌드 포함**, 서버에는 SSV 콜백(서명검증·dedup·skip_wait_count 적립)까지 기구현. 끊긴 곳 2개를 복구.

### 수행 결과

- **원인 실측**: ① 광고 시청 배선이 v3.107에서 폐기(WaitTimerScreen deprecated) — 광고권 적립 경로가 앱에 없음 ② 서버 rewards.py:40 서명키 URL(gstatic.com)이 301 리다이렉트인데 httpx 미추적 → **모든 SSV 검증 실패(403)·적립 0**. curl 실증: 구 URL 301 / www.gstatic.com 200 직접 응답.
- **서버 1줄**(server_staging_v3208/rewards.py, .orig 백업·프로덕션 md5 일치 확인): GOOGLE_KEYS_URL → www.gstatic.com. 배포는 사용자 위임(권한 차단 관행).
- **앱 배선(5파일)**: 신규 hooks/useRewardedSkipAd.ts(16.3.2 API 재작성 — SDK 상수 구독·스테일 클로저 제거·SSV `serverSideVerificationOptions{userId, customData:user_id}` 필수 설정, **user_id 미확보 시 로드 차단**(tester U-3③ 즉시 반영 — 적립 불능 시청 봉쇄)) + constants/ads.ts(광고 단위 ID = EXPO_PUBLIC 키, 미설정 시 TestIds 폴백 — 하드코딩 0) + utils/fatigueGate.ts **단일 지점**에 「광고 보고 30분 단축」 버튼(호출부 12곳 무수정 수혜, 시청 완료→기존 fatigueService 폴링 2s×15로 적립 확인→자동 skip('ad') — 서버 계약 무변경, 전 실패 경로 showAlert 후 기존 ⭐/광고권 다이얼로그 복귀) + App.tsx 초기화 1회 + eas.json 플레이스홀더. Expo Go/web try-require 안전 강등·mock 보상 0.

### 검증 (tester)

U-1~U-7 전부 PASS — FAIL 게이트 5건 통과: 하드코딩 0 / SSV customData=user_id 확증 / **클라 단독 보상 경로 0**(폴링 확인 없인 doSkip 불가) / 12개 호출부·기존 ⭐·광고권 경로 diff 0 / v3.207 회귀 0. tsc exit 0(픽스 반영 후 재확인). A-0 스테이징 diff 1줄 정합·A-1 www URL 200 사전 확증. A(배포 후)·E(실기기·콘솔 발급 후) 트랙 대기 — "부분 완료(적립 E2E 대기)" 판정.

### 잔여 (사용자)

1. 서버 1줄 배포(커맨드 전달) → A-1~A-4 실측.
2. AdMob 콘솔: 보상형 광고 단위 생성(ID 제공 → eas.json 기입), 광고 단위에 SSV 콜백 URL 등록, 테스트 기기 등록(무효 트래픽 방지 필수).
3. 다음 APK 빌드에 포함(JS-only — OTA 없음). 실기기 E-0~E-4: 테스트 광고 시청→30초 내 자동 30분 단축 체인. **내부 테스트에서 실광고 클릭 절대 금지**(계정 정지 위험).

### v3.208 서버 배포 완결 (2026-09-22, 사용자 실행)

- rewards.py 1줄 배포(scp + docker 재빌드·재생성, UP 6초). 검증: health 200 / **www.gstatic.com 키 조회 200 OK 로그 실증**(수정 전엔 전 건 실패 지점) / 위조 서명 콜백 → 403 "Invalid signature" 정상 거부·traceback 0 — A-1②③·A-2 위조 경로 PASS. 정상 서명 적립(A-2 정경로)·dedup(A-3)은 실광고(테스트 광고) SSV 실측으로 이관.
- 잔여: AdMob 콘솔 3종(보상형 단위 생성→eas.json 기입 / SSV URL `https://api.maidol.ai.kr/api/rewards/admob-callback` 등록 / 테스트 기기) → 차기 APK 빌드 포함 → E-0~E-4 실기기.

### v3.208 추가분 — AdMob 콘솔 SSV URL 등록 디버깅 3건 + 광고 단위 확정 (2026-09-22)

콘솔 "콜백 URL 확인" 등록 실패를 3단계 실측으로 해결(각 수정 후 사용자 재배포):
1. **400 → 무시 처리**: 콘솔 확인 핑은 custom_data가 비어 있음 — 서명 검증 통과분에 한해 적립 없이 200(ignored_no_user) 응답으로 변경.
2. **테스트 키 세트 병행 조회**: verifier-keys-test.json 추가(별도 캐시) — 테스트 키 검증분은 어떤 경우에도 적립 금지(test_ping_ok 200만). ※실측상 콘솔 핑은 프로덕션 키(3335741209) 사용 — 방어적 병행 유지.
3. **근본 원인 — 서명 메시지 URL 디코딩**: 구글은 **디코딩된** 쿼리 문자열을 서명하는데 서버는 인코딩 원문으로 대조 → 한글 reward_item("휴식 단축(분)") 퍼센트 인코딩에서 전 건 실패. 실핑으로 raw 실패/unquote 성공 실증 후 unquote 적용. 재배포 후 실핑 재전송 200·위조 403 확증.
- **적립량 서버 고정(1)**: 콘솔 리워드 수량 오설정(30 발견)과 무관하게 1회 시청=광고권 1장 봉인(원값 로그만). 콘솔 수량 1로 정정 권고 전달.
- **광고 단위 확정**: 기존 "디렉터 휴식" 보상형 단위(ca-app-pub-…/6051029293) 재사용 — eas.json preview·production에 기입(광고 단위 ID는 클라이언트에 포함되는 공개 식별자로 커밋 허용 판단).

## v3.209 (2026-09-22) — 영상 디렉터: 단색 배경 + 자막 테두리 유무·색 선택

**요청**: "배경에는 원본 이미지가 꼭 있는 형태 → 원본 이미지 없이 색상만 있는 배경도 가능하게. 폰트 테두리 있게/없게 선택 + 색상 선택."

### 수행 결과

- **실측**: 영상 디렉터 = VideoDirectorScreen(공유 영상) → POST /tracks/{id}/share-video → 서버 share_video.py ffmpeg 파이프라인(MinIO share/v6 캐시). 배경 3모드 전부 커버 이미지 위 합성(색 덮기도 alpha ≤0.70이라 원본 비침), 자막 테두리 검정·두께 3 하드코딩.
- **앱(VideoDirectorScreen 1파일, +97/-12)**: 배경 단계 4번째 카드 "단색 배경(이미지 없이 색만)"(center 전용, 선택 시 진하기 질문 생략 → bg=color&bgalpha=100) + 자막 테두리 2단계(있게/없게 → 있게 시 12색 팔레트, 검정 기본). 검정 선택은 기본값('')으로 정규화 — 레거시 캐시 적중. 버블 탭 롤백 편집 신규 스텝 호환, 교차 편집 스테일 0.
- **서버 스테이징(server_staging_v3209/, _orig 백업·프로덕션 md5 일치)**: STYLE_BGALPHAS "100"(drawbox alpha 1.0 = 커버 완전 차폐), Query 2종 fontoutline(1|0)·outlinecolor(hex6, ''=검정) + ASS 빌더 2곳 파라미터화(BGR 변환 실측 3케이스 OK), 캐시 suffix는 말미 기본값 절단 후 기존 로직 — **기본·비기본·무작위 500조합 object name 배포 전후 비트 동일**(backend 실측 + tester 독립 재실행 이중 확증), 기본 조합 ASS 바이트 동일. heavy_job_slot 키·GET file 위치 인자 동기. DEPLOY.md 준비.

### 검증 (tester)

U-1~U-6 + S-1~S-4 전부 PASS — FAIL 게이트(캐시 키 변경 / full 레이아웃 오염 / 구 호출부 파손 / v3.205~208 회귀) 0건, 앱-서버 계약 교차 불일치 0(대문자 hex도 서버 정규식 통과 확인). tsc·py_compile OK. A(배포 후)·E(새 빌드 실기기) 대기. 특기: App.tsx +3줄(웹 탭바 54px·lineHeight)은 병행 웹 세션 작업으로 판독 — 본 커밋에서 제외(격리 성립 조건 이행).

### 잔여

서버 배포(사용자 커맨드) → A-1~A-4 실측(기존 캐시 히트 확인 포함). 앱 변경은 차기 빌드(1.1.2)부터 — E-1~E-5 실기기(단색 배경 원본 흔적 0, 테두리 유무·색, 기존 3모드 회귀, 버블 편집 재생성).

### v3.209 서버 배포 완결 (2026-09-22, 사용자 실행)

share_video.py·tracks.py 배포(백업 .bak_pre_v3209, docker 재빌드·재생성 UP 6초). 검증: health/tracks/timeline 200, traceback 0. 신규 파라미터(bgalpha=100·fontoutline·outlinecolor) API는 인증 필요라 실기기 E2E(1.1.2 빌드 후)에서 실측 — 캐시 키 보존은 정적 이중 확증 완료라 기존 영상 URL 무영향.

## v3.210 (2026-09-23) — 피드 탭·공개/비공개 + Inst. 버전 생성(코드분) [앨범 삭제·배포는 승인 대기]

**요청 3건**: ① 피드 페이지 내 글/공지 탭 + 공개·비공개 ② 앨범 2개 삭제 ③ AI 음원 보컬 제거 → "(Inst.)" 배포.

### 수행 결과 (커밋분)

- **① (앱 4파일 — 서버 무수정, 서버는 기완비)**: FeedScreen [전체|내 피드|내 공지] 탭(본인 조회는 서버가 비공개 포함 반환 — 프로덕션 실측), FeedCompose 공개/비공개 스위치(기본 공개, is_public 하드코딩 제거), FeedCard ⋯메뉴 공개↔비공개 전환(PUT full-body — tester 발견 **bgm_track_id 필드명 오류 즉시 픽스**: BGM 소실 사고 봉쇄) + 비공개 자물쇠 칩(Feather). 비공개 글 타인 노출 경로 서버측 0 실측(타임라인 공개만·단건 404).
- **③ (앱 2파일 + 서버 스테이징 3파일)**: 마이뮤직 ⋮ "Inst. 버전 만들기"(suno 곡 한정, 스타 5 확인→요청→5s 폴링→완료 안내, 402/409 구분 — tester 발견 **409 2형상 미구분 즉시 픽스**). 서버(server_staging_v3210): POST/GET instrumental 2 라우트 — 검증 체인 전부 차감 이전, 원자 락, ⭐5 선차감·실패 5경로 환불 대칭(정확 1회), sunoapi.org vocal-removal(presigned URL — 외부 접근 206 실증), 산출물 MinIO 즉시 이관(**Suno URL 저장 경로 0** — 14일 만료 사고 봉쇄), "(원제) (Inst.)" 자동 발매(커버·무드·페르소나 상속, is_public 원곡 동일, beats 승계, 창작 기록). 발매 보상 ⭐+5는 의도적 미적용(순비용 0 → Suno 크레딧 유출 방지 — 오케스트레이터 승인).

### 검증 (tester)

U-1~U-7 + S-1~S-5: FAIL 2건(위 bgm_track_id·409 — 앱 1줄급) 즉시 픽스 후 tsc 재확인 exit 0, 그 외 전 항목 PASS. 핵심 게이트(Suno URL 잔존 0 / 차감·환불 대칭 / 비공개 타인 노출 0 / 이모지 0 / v3.205~209 회귀 0 / diff 격리 — App.tsx 웹 세션분·v3.211 스파이크분 별도 귀속) 전부 통과. 개선 제안 기록: inst_jobs partial unique index, 폴링 일시 오류 재시도(선택 — 차기).

### 대기

② 앨범 삭제(후보 2건 — 타 계정 "앨범테스트" 포함 여부 사용자 확인 대기), ③ 서버 배포 + A-1~A-5(실생성 1건 = ⭐10·Suno 10크레딧 — 승인 후), E(새 빌드).

## v3.212 (2026-09-23) — 초대(추천하기) 공유 전면 개편: 옵션 축소·멘트·CTA 2원화·OG 이미지 교체 (코드분)

**요청**: 공유 옵션 카카오톡·링크 복사만 / 카카오 멘트를 랜딩 톤으로 / 초대 페이지 Google Play(내부 테스트)+웹 실행 2버튼(iOS는 웹 권장) / 촌스러운 공유 이미지 교체(구 "AIDOL" 이미지 — 브랜딩 위반 확인).

### 수행 결과

- **앱(2파일)**: AppShareModal 옵션 [카카오톡으로 공유|링크 복사] 2개 축소(SDK 미도입 — 네이티브 시트 위임 유지), 멘트 확정본("나의 AI 아이돌, MAIDOL / 작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요 / 추천코드 {code} 입력하면 두 사람 모두 ⭐50, 시작은 3분이면 충분해요") — 사용자 검수 전달. AuthPanel 웹 한정 ?ref 프리필(4자 검증 통과 시만).
- **서버 스테이징(server_staging_v3212)**: referral.py 표시 계층만 개편 — CTA 2원화(Play=settings.play_store_url 경유·하드코딩 0, 웹=app.maidol.ai.kr?ref={code}), 서버 UA 분기(Android=Play primary / iOS·기타=웹 primary + "iOS는 웹 버전을 권장해요"), 랜딩 디자인 토큰 정렬. 보상 로직·JSON API·aidol:// 딥링크·404 변형 diff 0. **신규 OG 이미지 invite_og_v2.png**(1200×630, headless Chrome 렌더 — MAIDOL 워드마크 AI 보라 분리·OPEN BETA·⭐50 배지, AIDOL·프레임·클립아트 0, 재생성용 .src.html 보관, 구 파일 존치). .env PLAY_STORE_URL=내부 테스트 링크(DEPLOY.md 기재).

### 검증 (tester)

U-1~U-4 + S-1~S-3: 주석 문구 1건(문언 게이트) 즉시 정리 외 전 항목 PASS — 멘트 문자 단위 일치, OG PNG 실물 육안(AIDOL 0·규격·용량<500KB), 렌더 스모크 3케이스, 보상·API 회귀 0, tsc·py_compile 0, diff 격리. A(배포 후: UA 분기 curl·og:image 200·JSON 회귀·?ref Playwright)·E(실기기+카카오 캐시 초기화 선행) 대기.

### 잔여

서버 배포(사용자 커맨드 — referral.py+PNG scp, .env 1줄, docker 재빌드) → **카카오 공유 디버거에서 invite URL 캐시 초기화(수동, 링크는 DEPLOY.md)** → A 검증. 앱 변경(옵션·멘트·프리필)은 1.1.2 빌드부터.

### v3.212 배포 완결 + v3.210 ② 앨범 삭제 완결 (2026-09-23)

- **v3.212 서버 배포**(오케스트레이터 직접 실행 — 사용자 지시): referral.py(+워드마크 AI 색 분리·테스터 미등록 안내 추가분)·invite_og_v2.png·.env PLAY_STORE_URL 배포, UP 9초. 검증: Android UA→Play primary(내부 테스트 링크)/iPhone UA→웹 primary(?ref 부착), og:image v2 200·구 png 존치, 테스터 안내 노출, health 200. 우측 잘림 의혹은 계측으로 정상 확증(390px 오버플로 0 — 캡처 아티팩트). 잔여: 사용자 카카오 공유 디버거 캐시 초기화(수동).
- **v3.210 ② 앨범 2건 삭제**(사용자 확인 "둘 다"): 백업(album_backup_v3210.json) → 앨범테스트(차용 커버 보존)·마미 베스트 삭제 → 잔존 0, **수록 트랙 4/4 보존**, 마미 베스트 AI 커버 오브젝트는 boto3(IAM 롤)로 제거(minio 정적 키 경로는 AccessDenied — 스토리지가 S3+IAM 체제임을 실측, 차기 데이터 작업 시 boto3 사용 관행 기록).
- **빌드 전환**: 사용자 EAS Starter 구독 → 로컬 빌드 환경 구축 중단(진행 중이던 로컬 빌드 종료), 1.1.2 클라우드 빌드 재개. 로컬 설치분(JDK·Android SDK ~5GB)은 존치 — 비상용, 제거 원하면 정리 가능.

## v3.213 (2026-09-23) — 튜토리얼 전면 재설계: 사용자 스펙 6영역·반투명 하이라이트·검수 모드

**요청**: 사용자 정리 스펙 그대로 — 차트(비로그인) 2스텝 / 플레이리스트 제거 / 피드·검색·작업실(6스텝)·상단바(6스텝) 로그인 시 / 테두리 박스 대신 세련된 반투명 박스 / 검수용으로 당분간 항상 노출(확인 후 최초 사용자 한정 전환). + JDK·SDK 삭제, Inst 구현 설명.

### 수행 결과

- **정리**: JDK·Android SDK·gradle 캐시 총 ~7.6GB 삭제(로컬 빌드 경로 폐기 — EAS Starter 전환).
- **튜토리얼(10파일, +301/−79)**: 14스텝 문안 사용자 원문 그대로(맞춤법 2건 교정: "확인할"·"메시지"/"연락할", Youtube 표기는 원문 유지) — 차트 탭 스트립+⋮(비로그인), 상단바 아이콘 6종 캐러셀(차트 화면 2호 오버레이·로그인, 상호 배타), 피드 Fab·검색창, 작업실 디렉터 5+생성이력(화면 밖 스텝 자동 스크롤 onStepChange 신설), 플레이리스트 완전 제거. 신규 anchor 13종(등록·해제·로그아웃 정리 쌍). **하이라이트 전환**: 구멍+2px 실선 → 보라 틴트 반투명 박스(rgba(168,85,247,0.16)·radius 12·헤어라인·iOS 글로우) + 딤 rgba(13,8,32,0.68).
- **검수 모드**: tutorialGate.ts:27 `TUTORIAL_REVIEW_MODE = true` — 화면 진입(focus)마다 노출. **false 1줄로 v3.211 first-run(가입 후 최초 사용) 정책 완전 복귀** — tester가 실제 왕복 전환+4분기 격리 스모크로 등가 복귀 실증 후 true 원복(출고 형상 true = 검수용).

### 검증 (tester)

U-1~U-8 전부 PASS — 문안 14스텝 문자 일치·교정 전 잔재 0 / 플레이리스트 잔재 0 / 게이팅 상호 배타 / REVIEW_MODE 양 경로 실증 / anchor 13종 쌍 / 하이라이트 수치·구 실선 잔재 0 / 자동 스크롤 배선 / tsc 0·10파일 격리·PlayerScreen 무접촉·직전 사이클 회귀 0. E-1~E-5(실기기 — 반투명 육안·작업실 자동 스크롤·검수 모드 동작)는 새 빌드 후.

### 이월·대기

플레이어 기존 3스텝 존치(기본안 — 스펙 재정의 시 교체), search-row-more 키 미사용 존치. 사용자 검수 후: REVIEW_MODE=false 전환 + 최종 빌드. v3.210 Inst 서버 배포 승인 대기 지속.

## v3.214 (2026-09-23) — 1.1.3 실기기 피드백 12건: 자막 위치 기하 유도·록업·제목 마퀴·영상 과금·튜토리얼 pill·공유 봉합 + Inst 장애 3단 디버깅 완결

**요청 12건**: ①작업실 튜토리얼 pill/원형 ②창작기록 안내 팝업 상단바 침범 ③Inst 실패 ④연주곡 제목 마퀴(Inst 제외) ⑤완료 화면 4버튼 통일 ⑥영상 공유(다운로드만 됨) ⑦자막 '중간'이 커버 위에 얹힘 ⑧AI 생성 배지(nowplaying 동일+확대+둥근 칩)+우하단 MAIDOL 록업 ⑨다시 만들기 과금·쿨다운 ⑩Inst 팝업 ⭐ 표기 (+추가 지시 2건 반영).

### ③ Inst 장애 — 3단 디버깅으로 완결 (프로덕션 실증)

1. **1차: 미배포 404** — 로그 실증 후 v3.210 서버 배포(사용자 재승인 후 오케스트레이터 실행).
2. **2차: Suno 작업 등록 거부** — 콜백 localhost 교체로도 재현 → **대조 실험**(짧은 공개 URL은 즉시 접수, 1,924자 presigned URL은 거부)으로 원인 확정: 게이트웨이가 긴 서명 URL(IAM 세션 토큰) 거부.
3. **3차 픽스: 짧은 토큰 리다이렉트** — `/api/tracks/inst-audio/{job}/{token}`(1회성 난수·2시간 유효·hmac 대조) → presigned 302. 배포 후 **실기기 3차 시도 전 구간 성공**: 접수(taskId)→게이트웨이 fetch 2회→SUCCESS(~90초)→다운로드 3.65MB→자체 스토리지 이관(sha256 기록). 실패 2회분 ⭐5는 전부 자동 환불 실증(환불 대칭 실검증). Suno 크레딧 잔액 9,750 확인.

### 수행 결과 (코드분)

- **앱(10+2파일)**: ① TutorialOverlay shape 메타+코너 마스크(B=40 — pill 시 딤 모서리 잔존 제거), 작업실 디렉터 5스텝 pill(이름 배지 포함 +24) ② PolicySheet variant='sheet'+useHeaderHeight 상한(작사 기록안내 — page 소비처 무변경) ⑤ 4버튼 width 300·padV 12·fs14 + 취소 시 버블 롤백 ⑥ 공유 3종 봉합(파일명 새니타이즈·mp4 mimeType/UTI·실패 showAlert — 음원 시트도 보강) ⑨ fatigueGate 'video' 게이트(⭐2 스킵·429 대응·**세션 성공 조합은 선게이트 생략 — tester U-5④ 캐시 히트 차단 결함 즉시 픽스**) ③⑩ 404 안내·⭐5 표기.
- **서버 스테이징(server_staging_v3214, 3파일)**: ⑦ `_subpos_positions` 기하 유도(full 바이트 동일 실증·center 좌표 명세표 확정·kakao 역전 소멸·**wide line near 230→220 즉시 픽스**)+캐시 v6→v7(스타일 suffix 비트 동일, prefix만) ④ 제목 마퀴(textfile+expansion=none — 이스케이프 인젝션 원천 차단, 프로덕션 ffmpeg 프레임 캡처 검증, Inst=source_track_id 판별 제외) ⑧ PIL 록업 스트립(AI 생성 둥근 칩 0.56×자막·MAIDOL AI만 #A855F7 동일 라인 — 3포맷 실렌더 검증) ⑨ DIRECTORS+'video'(⭐5 생성·⭐2 스킵·캐시 히트 3함수 미호출) — DEPLOY.md 준비.

### 검증 (tester)

U-1~U-7 + S-1~S-6: FAIL 1(U-5④)·경계 1(S-1④) 즉시 픽스 후 tsc·py_compile 재확인, 그 외 전항 PASS — full ASS 18조합 바이트 동일·object name suffix 비트 동일 독립 재실증, 429 shape·⭐ 상수 등 계약 교차 5항 정합. S-6 WARN(v3210 스테이징 금일 갱신)은 오케스트레이터의 Inst 짧은 URL 픽스 — 정상 경위. A(배포 후: v6 URL은 object형 프록시로 확보 주의)·E(새 빌드) 대기.

### v3.214 서버 배포 완결 + Inst E2E 완결 (2026-09-23)

- **Inst E2E 성공**: 3차 시도 전 구간 로그 실증 — 접수(taskId)→리다이렉트 fetch→SUCCESS(90초)→3.65MB 이관→**"냥냥냥 (Inst.)" 트랙 공개 발매 확인**(차트 API 실측). 실패 2회분 ⭐5 전액 자동 환불.
- **v3.214 서버 배포**(오케스트레이터 실행): 3파일 + **스테이징 충돌 처치** — v3214 tracks.py가 Inst 짧은 URL 라우트 이전 스냅샷이라 재빌드 전 라우트 이식 후 배포(Inst 회귀 0 확인). 검증: health 200·inst-audio 라우트 보존·share_video ⭐5 노출·traceback 0.
- 잔여: A-1~A-4 실측(v7 신규 생성·캐시 무과금·429/402 — 실기기 E와 병행), 카카오 캐시 초기화(사용자).

## v3.215 (2026-09-23) — 최종 배포 전 사이클: 영상 성능·작업실 anchor 정착·Inst 품질/쿨다운/커버·nowplaying 튜토리얼 교체 + 광고 버튼 진단 편입

**요청**: ①영상 생성 안 됨 ②작업실 아티스트 디렉터 영역표시 위치 이상·스크롤 중 표시 금지(포커싱 완료 후 표시) ③Inst 음질 개선 ④Inst=작곡 디렉터 휴식시간 ⑤Inst 커버=원곡 이미지(미니플레이어 미표시) ⑥nowplaying 튜토리얼 = 하단 토글 1스텝 교체 ⑦적용 후 최초 앱 접속·최초 로그인 트리거로 전환 ⑧apk/aab 배포 (+최우선 편입: 쿨다운 「광고 보고 단축」 버튼 실기기 미노출).

### 수행 결과

- **[최우선] 광고 버튼(오케스트레이터)**: 1.1.4 APK 해부로 JS 번들·네이티브(GMA dex·RNGMA TurboModule 8종) 정상 포함 확정 — 원인은 런타임 `require('react-native-google-mobile-ads')` throw 추정(catch가 console.log라 무증상). 픽스: useRewardedSkipAd.ts **진단 warn 승격+admobLoadError 보존+init 1회 로그**(릴리즈 원격 로그 수집), 별건 확정 결함 **app.json AdMob 앱 ID 교정**(~9961638197→~8636830033, 사용자 콘솔·유닛 6051029293 확인). RNGMA 16.3.2 유지(17.0.0은 출시 5일 메이저 — 보류). 새 빌드 원격 로그로 최종 확정 예정.
- **[A] ① 영상 생성(오케스트레이터 핫픽스+성능)**: 1차 핫픽스(타임아웃 300→600s·동시 1 직렬화) 후 근본 개선 — ffmpeg 3중 루프(-loop PNG 매 프레임 재디코드) 제거·PIL 사전 합성, 캐시 **share/v7→v8 승격**. 실사고 조합(sns/center/scroll 92세그) 프로덕션 컨테이너 재생성 **249초 완주**(600s 내), share/v8 적재(12.3MB·201.2s·1080×1920 20fps)·프레임 육안 검증(커버·단색배경·mid 자막·워터마크 스트립 v3.214 기하 동일). 벤치: 순수 x264 60s→24.5s vs -loop 47.5s. 사용자 재시도는 캐시 무과금.
- **앱(② MapScreen+TutorialOverlay)**: 고정 450ms 타이머 → **스크롤 정착 폴링**(120ms 간격·연속 2회 |Δ|<0.5·최대 12회 타임아웃, token 가드로 스텝 경합 폐기) + `InteractionManager.runAfterInteractions` 재측정(진입 전환 중 measureInWindow 오염 차단 — P1 봉합). TutorialOverlay `suspended` prop — 정착 전 **전체 딤만**(구멍·화살표·카드 숨김). P2(상태바 오프셋)는 실기기 로그 판정 대기.
- **앱(⑤ playback.ts)**: 서버 데이터·API·컴포넌트 전 경로 정상 실측(커버 백필 불요 — Inst 파생 1건뿐·커버 보유) → `maybeHydrateCover` 공통 방어: cover 결손 track 재생 시 GET /tracks/{id} 백그라운드 보강·store track/queue 병합(실패 무해).
- **앱(⑥ PlayerScreen)**: 튜토리얼 3스텝 → **1스텝** — anchor `player-detail-toggle`(하단 [가사·제작 노트·스타일링·댓글] 토글, placement above), 문안 사용자 원문 그대로("토글을 열어서 가사와 제작노트 그리고 아티스트의 스타일링을 확인해보세요"). player-add 등록 제거(키 존치).
- **앱(④ MyMusicScreen)**: Inst 요청 전 `getFatigueStatus('composer')` 게이트(확인 다이얼로그 전 차단·조회 실패는 게이트 오픈) + POST 429/'director_fatigue' 분기 → showFatigueCooldownDialog(composer). 맵 휴식 티켓은 composer 기대상이라 자동 정합.
- **서버(server_staging_v3215, 3파일+백필 1건)**: ④ tracks.py /instrumental — `_existing` 409 직후·클레임/⭐차감 **이전** `fatigue_gate_response(director="composer")` 429(게이트→과금 순서), inst_service 성공 경로에 `on_generation_completed(uploader_id, db=mongo_db, director="composer")` best-effort 훅. ③ inst_service — **loudnorm 정규화**(`I=-14:TP=-1.5:LRA=11`+48kHz/320k, best-effort — ffmpeg 부재/실패 시 원본 저장, applied/skipped 로그). 근거 실측: 원곡 -13.9 LUFS vs Inst -21.2 LUFS(**7.3LU 격차** = 체감 저하 주원인, 비트레이트는 179kbps 동일·무가공 저장 확인). sunoapi.org는 mp3 전용·품질 옵션/WAV 부재(공식 문서+record-info 실조회 확정) — 분리 아티팩트 자체는 API 한계 명시.
- **⑦ 트리거**: tutorialGate 실측 — 코드 변경 불요 확인 후 `TUTORIAL_REVIEW_MODE=false` 1줄 전환(사용자 지시) = 완전 최초 설치 + 로그인 게이트 화면은 가입 후 최초 진입 1회. 기존 설치 기기는 'existing' 판정·미노출(검수는 신규 설치로만 가능).
- **마무리**: app.json version 1.1.4→**1.1.5** — 이후 오케스트레이터 커밋+EAS APK/AAB 빌드.

### 서버 배포 (오케스트레이터 실행 완료 — DEPLOY.md 실측 md5)

| 파일 | 배포 경로 | 수정 전(_orig) md5 | 배포본 md5 |
|------|-----------|--------------------|------------|
| share_video.py | app/services/share_video.py | `d1d4c86785bc83933200e386f9a59bc7` (v3.214+600s 핫픽스) | `3b0036a43c64920e1da0d7a21db9da86` |
| tracks.py | app/routes/tracks.py | `983d1e902234cf08c87fea2226e7f3aa` (v3.214 배포본) | `811381c087da9db43dc592fc7ac174e5` |
| inst_service.py | app/services/inst_service.py | `c9a3377d6c23d6545f515eadbc01f455` (v3.210 배포본) | `93b41b0efd4e2ba8dc349f0385fc74b4` |
| backfill_inst_loudnorm_v3215.py | (배포 안 함 — docker cp 1회 실행) | — | `c33c55e61caeab53dc0ad3c61d4224f8` |

- 3파일 md5 일치·docker 재빌드 확인. EC2 측 `.bak_pre_v3215` 백업 선행(롤백 절차 DEPLOY.md).
- **③ 백필 실행 완료**: dry-run 후 --apply — "냥냥냥 (Inst.)" **-21.17→-13.98 LUFS, TP -1.50, 320k/48kHz**, duration 162 유지, tracks.audio_sha256 `dfe6715f…`→`4ae58e94…` 갱신. **롤백 포인트**: MinIO 원본 백업 object `<audio object>.bak_pre_v3215` + 원 sha `dfe6715f…`.

### 검증

- **tester 1차 게이트**: 유닛 11개 시나리오(U-1~U-7·S-1~S-4) **전항 PASS** — tsc 0에러·diff 격리·⑥ 문안 바이트 일치. 서버 정적 S-1(게이트→과금 순서·완료 훅) PASS.
- **planner 최종 정합 확인(코드 재독)**: PLAN v3.215 확정 스펙 11개 변경점 전부 구현 일치 — suspended 딤 전용 분기·정착 폴링 token 가드·안전 타임아웃, player-detail-toggle 등록/해제 대칭, composer 게이트 삽입점(클레임/차감 이전)·훅 위치(성공 경로 한정·실패 raise 선행), loudnorm best-effort(파이프라인 실패 사유 금지)·sha 최종본 기준, 하이드레이션 track+queue 병합·실패 무해, REVIEW_MODE=false·1.1.5·AdMob ID 교정 확인. **이상 없음**.
- **미검증(새 APK 빌드 후 사용자/실기기 확인 — 완료 조건에 명시)**:
  - D-1~D-5: 작업실 anchor 정위치(P2 오프셋 로그 회수 포함)·정착 후 표시, nowplaying 1스텝, Inst 미니플레이어 커버, composer 쿨다운 다이얼로그, first-run 트리거(신규 설치 검수).
  - C 런타임 429: 쿨다운 상태 필요 — 실사용 확인으로 이월.
  - 광고 버튼: 새 APK에서 쿨다운 팝업 버튼 유무 + frontend.log `[AdReward] init` 라인 회수로 원인 최종 확정.
- 절차: 빌드 후 쿨다운 팝업 열기 → 버튼 유무 확인 + 원격 로그 회수(위 라인) — 사용자 확인 안내 예정.

### 이월

loudnorm 2패스 정밀화 · split_stem 재합성 실험(50크레딧·미검증) · P2 상태바 오프셋 보정(실기기 확정 시 1줄) · RNGMA 17 업그레이드(진단 로그 확정 후) · routes/fatigue.py 안내 문구 5종 목록화(v3.214 이월분).

## v3.216 (2026-09-23) — 웹 소셜로그인 복구·DM 시트·official 고정 행·패션브랜드 4,219건 시드·SSUGSIS/LOTUS 초대 + v3.216b 긴급 10건(계정 기반 튜토리얼·미디어세션) + [중대] APK 런치 크래시 픽스(1.1.6)

**요청(7건)**: ①웹 구글/카카오 로그인 — 계정 선택 후 백지 ②DM 창이 상단바를 가림(상단바 하단으로) ③가입 시 DM 작성 버튼에 maidol_official 팔로우 상태 노출 ④패션브랜드 모음 zip → 상의/하의/악세서리(모자·가방) 반영 ⑤튜토리얼 최초 기준 전환(그 외 재노출 금지) ⑥Inst. 만들기 재실패 ⑦app.maidol.ai.kr?ref=SSUGSIS 초대페이지(초대자 김진주, 웹앱 권장 + 설치 희망 시 구글 계정을 official DM/홈페이지 하단 메일로). (+v3.216b: 사용자 긴급 지시 10건 F1~F10, +편입: 1.1.2~1.1.5 APK 전면 런치 크래시)

### 수행 결과

- **① 웹 소셜로그인(2중 원인 — 프로덕션 실측으로 확정·복구)**: 서버 OAuth는 전 단계 성공(로그 실측: token/userinfo 200→302)인데 (a) 프로덕션 `.env FRONTEND_URL=http://localhost:8081` — 성공 리다이렉트가 localhost로 감, (b) app.maidol.ai.kr 래퍼(homepage/maidol/app-shell)가 `/app` 이동 시 hash·query 폐기 → `#token=`·`?ref=` 유실. 픽스: **env 교정(사용자 실행)** + 래퍼 :9/:100 search+hash 보존 전달 + SocialLoginButtons 웹 분기 `location.assign`(같은 탭 — `_blank` 새 탭·비로그인 원탭 잔류 제거) + App.tsx `webOAuthTokenPending` 플래그로 restoreSession 경쟁 방어(:465-468, :549-550 — 구토큰 롤백 차단) + remoteLogger href hash strip(:118, `#token=` 원격 로그 유출 방어). OAuth 302·같은 탭 구글 이동 실측 확인(실계정 완주는 사용자만 가능 — 이월).
- **② DM 상단바(DmInboxScreen)**: 새 메시지 전체화면 Modal → `transparent`+`statusBarTranslucent` 시트(:225), top = `useHeaderHeight()` 폴백 `insets.top+56`(:47-49, PolicySheet v3.214 선례) — 네이티브 헤더('메시지'·뒤로가기·edit) 상시 노출. DmChatScreen 자체 헤더 56 규격 정렬.
- **③ official 고정 행**: 가입 자동 맞팔은 서버 기완비 실측(이메일·소셜 가입 훅 + startup 백필 — 추가 구현 없음). 실결함 = 작성창이 검색 전용 → 빈 검색어 시 `fetchOfficial()` 캐시로 **maidol_official 고정 행 + '공식' 배지**(:258-266, 실패 시 현행 빈 목록 폴백), 탭 시 기존 대화 시작 흐름 재사용.
- **④ 패션브랜드 시드**: 전체_제품정보.csv 4,857행/85브랜드(이미지 4,857개 로컬 전수 실존·결측 0) → 신규 `seed_fashion_brands.py`(SEED_TAG='fashion_brands_csv' 멱등 replace·dry-run 기본·로컬 이미지 S3 직업로드 — admin 임포트의 플랫폼 6종 강제/원격 다운로드 제약 회피). **프로덕션 실행: 판매중 4,219건 inserted=4219 / failed=0** — 모자 629·가방 623 **최초 공급**(기존 0건), API 실노출 확인. 앱 악세서리 피커는 `?category=모자`+`?category=가방` 2호출 합산 전환(ArtistCodyScreen:330-331 — `$sample 500` 캡 희석 방지, 구주석 '서버 400' 정정), wishlist.py ALLOWED 세트 모자·가방 정합 1줄.
- **⑤ 튜토리얼**: v3.215에서 REVIEW_MODE=false 완료 — 본 사이클 검증 + **v3.216b F9로 계정 기반 승격**(아래).
- **⑥ Inst 재실패**: v3.215 배포가 짧은URL 픽스(v3.210) 없는 구베이스로 빌드된 사고 — inst_service.py 픽스 복원본(md5 d6c95351) 사용자 배포 완료. **재발 방지 절차 확립**: 스테이징은 라이브 pull 원본에만 패치 + `_orig` 보존 + 배포 직전 라이브 md5 재대조(DEPLOY.md §3 상설).
- **⑦ SSUGSIS/LOTUS 초대**: referral_service 해석 정규식 4자 charset → `^[A-Z0-9]{4,12}$`(발급은 4자 불변), 앱 REFERRAL_RE 동일 확장 + 입력 maxLength 12. 1회성 스크립트(dry-run 기본·선점 충돌 시 실패=안전)로 **SSUGSIS=김진주(구 5JJY 무효화)**, **LOTUS=maidol_official(구 FNV6 무효화, 랜딩 표시명 "LOTUS AI" 오버라이드 — referral.py:28)** 적용·랜딩 실측. 랜딩 카피 개편: 웹앱 CTA primary 단일화 + Play 버튼 제거 + "모바일 설치 희망 시 구글 계정을 maidol_official DM 또는 kimpearl@lotusai.co.kr(홈페이지 하단 문의 메일)로" 안내 블록. ?ref= 프리필 체인은 ① 래퍼 수정으로 동시 복구.
- **v3.216b 긴급 10건(F1~F10)**: F1 로그인 성공 시 차트 탭 리셋 착지(navigationRef.resetToChartTab — 이메일·소셜·토큰 콜백 공용), F2 튜토리얼 `useIsFocused` 노출 가드, F3 settling 고착 3초 안전망(MapScreen:361-371), F5 전역 팝업(출석 등) 표시 중 튜토리얼 보류→닫힘 후 재평가(seen 미소모), F6 문안 전수 감사 — 임의 스텝 0건·전부 사용자 정본 일치(맞춤법 3곳만 '확인 필요' 존치), F7 pill(원형) 하이라이트 철회 → 둥근 사각(radius 12) 복귀(사용자 지시), F8 아티스트 디렉터 즉시 표시 + 정착 폴링 120ms→60ms, **F9 계정 기반 최초 1회** — 서버 `GET/POST /api/tutorial/seen`(tutorial_seen.py 신설, unknown key 400, Mongo user_id 유니크) + 앱 tutorialGate 서버 동기화(단일 비행·서버 우선·실패 시 기기 기준 폴백) — **저장소 전체 삭제 후 재로그인 시 재노출 없음 실측**, F10 웹 미디어세션 — audioMode.ts 단일 지점(updateMediaSession/playbackState/positionState/prev·next 핸들러) + playback.ts 이관, 재생 시 playbackState 'playing' 실측('none' 고정이 위젯 미노출 원인). 웹 2회 재배포 완료.
- **[중대] APK 런치 크래시(1.1.2~1.1.5 전멸) 전말**: 원인 = expo-audio@1.1.1 peerDep `expo-asset:"*"` → npm이 SDK 58계열 expo-asset@57.0.18을 최상위 호이스팅 → expo-modules-core 3.0.30 비호환(AnyTypeCache NoClassDefFound) → 당일 빌드 전부 시작 즉시 사망(어제까지 구빌드는 정상). 신규 에뮬레이터 환경(~/android-debug, AVD crashtest)으로 재현·이분탐색 확정. 픽스 = package.json `overrides {"expo-asset":"~12.0.13"}` + 락파일 커밋. 로컬 릴리즈·EAS **1.1.6** 빌드 모두 에뮬레이터 기동 검증. 광고 모듈 `[AdReward] init — supported: true` 실측(v3.215 잔여 의문 해소 — 버튼 표시 조건 충족, 실기기 확인만 잔여). AdMob 앱 ID는 이분탐색 중 구값 롤백이 1.1.6 1차 빌드에 혼입 → `~8636830033` 복원(커밋 6321ade) 후 재빌드.
- 커밋: **acae3fe**(v3.216 전체 + v3.216b + 크래시 픽스 + 1.1.6, 앱 18파일), **6321ade**(AdMob 앱 ID 복원).

### 서버 배포 (사용자 실행 완료 — DEPLOY.md 실측 md5·라이브 pull 원본 기반)

| 파일 | 배포 경로 | 수정 전(_orig, 라이브 pull) md5 | 배포본 md5 |
|------|-----------|--------------------------------|------------|
| referral_service.py | app/services/referral_service.py | `4aee608c1a6f025aceb705a4bfadf44d` | `16e14976c558a8e057240548eb2269cd` |
| referral.py | app/routes/referral.py | `db68a9a6e849ea160b2b9af5c551ee85` | `02748345b2583e87bab63005db816329` |
| wishlist.py | app/routes/wishlist.py | `696ed76b64d262221e992e02cfd6ef22` | `425c773c3e824a26543a0169dca7f96e` |
| tutorial_seen.py (신설) + main.py 2줄 | app/routes/ (v3.216b §10) | main.py.bak_pre_v3216b 백업 | 라우터 등록 실측 |
| inst_service.py (v3.215 픽스 복원) | app/services/ | 구베이스(사고분) | `d6c95351…` |
| set_referral_ssugsis.py / set_referral_lotus.py / seed_fashion_brands.py | 배포 안 함 — docker cp 1회 실행 | — | `b0bde132…` / (LOTUS는 DEPLOY.md 표 미기재 — 스크립트 실존·실행 완료) / `e50c3b1e…` |

- `.env FRONTEND_URL=https://app.maidol.ai.kr` 교정(`.env.bak_pre_v3216` 백업). oauth.py 점검 결과 서버 코드 무변경으로 충분(localhost 하드코딩 없음 — env 폴백뿐). 배포 순서 고정(코드 → SQL → 시드 — SSUGSIS는 정규식 배포 전 resolve 불통과이므로 선행 금지) 준수.

### 검증

- **planner 최종 코드 재독(본 기록 전 수행)**: 결과 소재 전항 코드 실증 일치 — overrides expo-asset ~12.0.13·app.json 1.1.6·AdMob `~8636830033`(6321ade 반영), 래퍼 :9/:100 hash·query 보존, location.assign·webOAuthTokenPending·remoteLogger strip, DM 시트(transparent+statusBarTranslucent+composeTopLimit)·official 고정 행·악세서리 2호출·REFERRAL_RE 4-12+maxLength 12, staging_v3216 7파일(정규식·LOTUS 오버라이드·tutorial_seen 400 검증·main.py 라우터 등록·시드 dry-run/멱등·wishlist 세트), v3.216b F1/F2/F3/F5/F7/F8/F9/F10 전부 해당 라인 확인. **이상 없음**.
- 프로덕션 실측(오케스트레이터·사용자): OAuth 302 체인·같은 탭 이동, 시드 4,219/0 실패·API 실노출, /invite/SSUGSIS·/invite/LOTUS 랜딩(웹앱 CTA·DM/메일 안내), tutorial_seen GET/POST·저장소 삭제 후 재로그인 미재노출, 미디어세션 playing, 에뮬레이터 1.1.6 기동 + `[AdReward] init — supported: true`.
- 정적: py_compile 5파일 통과, 랜딩 렌더 단위검증, 정규식 경계(3자·13자·특수문자 거부), 시드 dry-parse(4,857→판매중 4,219·결측 0) — DEPLOY.md 기록.
- 비고: v3.216b는 사용자 긴급 지시 직행분이라 PLAN 별도 섹션 없음(본 기록이 정본). set_referral_lotus.py는 DEPLOY.md md5 표에 행 누락(스크립트·실행은 확인) — 차기 배포 문서에 보강.

### 미검증 이월 (완료 조건 명시)

- **실기기 D군(1.1.6 재빌드 APK)**: 광고 버튼 실노출(에뮬레이터는 supported=true까지 확인), 작업실 앵커 정위치(P2 오프셋 로그 회수), DM 시트·official 행, 웹 미디어세션 위젯(모바일 브라우저), first-run 신규 설치 검수.
- **소셜로그인 실계정 완주**: 구글·카카오 로그인→차트 착지까지 — 사용자만 가능(실계정).
- **C 런타임 429**(composer 쿨다운 — v3.215 이월분): 쿨다운 상태 필요, 실사용 확인.
- 기능 이월: 소셜 가입 ref 전달(oauth state), `$sample 500` 캡 상향/페이지네이션, 품절 638건 취급 재론, admin 임포트 브랜드 직납·로컬 이미지 모드, F6 맞춤법 3곳 사용자 확정, AdMob 앱 ID 재빌드 산출물 검수(1.1.6 2차).

## v3.217 (2026-09-24) — 웹 재생 브라우저 확장(단일 element·인앱 탈출)·차트 공개↔숨김·대표 아티스트 지정·iOS 웹 시트 가림·보이스 validate 500 픽스·외부 API 헬스체크 관리자·가상 착장 폴백

**요청(7건)**: ① 웹(사파리/인앱) 재생 연속성·백그라운드 대응 ② 마이페이지 곡 ⋮에 차트 숨기기/업로드 ③ 대표 아티스트 지정 ④ iOS 웹 하단 팝업(시트) 가림 ⑤ '내 목소리 만들기' 샘플 등록 500 ⑥ 외부 API 상태 관리자 확인 ⑦ 가상 캐릭터 착장 미표시.

### 수행 결과

- **① 웹 재생**: expo-av 웹 우회 — `webAudioElement.ts` 신설, **단일 HTMLAudioElement 재사용**+세대 가드, `ended` 핸들러에서 프리페치 URL **동기 src 교체 연속재생**(XHR/await 0), mediaSession 트랙 sync를 store.track **구독 단일 지점**으로 일원화(PlayerScreen 전환 5경로 개별 호출 제거 — 잠금화면 메타 잔존 결함 동시 해소). 네이티브 = createTrackSound 팩토리 1줄 위임(동작 등가·무변경). **인앱 탈출**: browserEnv.ts+InAppEscapeBanner 신설+public/index.html 인라인 — 카카오톡 `kakaotalk://web/openExternal`(query·hash 보존) 자동 시도+1.5s 배너 폴백, Android 기타 인앱 Chrome intent 버튼, iOS 안내 문구. 한계 명기: 인앱 웹뷰 내 백그라운드 재생 불가(탈출이 대응), iOS 화면꺼짐 중 자동 다음곡 보장 불가(실기기 판정 이월), iOS 크롬 강제 불가·무의미(WebKit 동일).
- **② MyMusic ⋮ 양방향**: 공개곡 "차트에서 숨기기"(확인 팝업→`PUT /tracks/{id} {is_public:false}`→즉시 로컬 갱신+재동기화) ↔ 비공개곡 "차트에 업로드"(현행) 상호 배타. report_blinded 400 등 서버 메시지 표출 보강. 서버 무변경(차트 응답 조립 시점 재필터라 숨김 즉시 반영).
- **③ 대표 아티스트**: 생성 완료(justCreated·is_default=false)에서만 showAlert 팝업 → `patchArtist({is_default:true})`, 첫 아티스트(서버 자동 대표) 생략·1회 가드. MyArtists "대표" 배지+비대표 카드 "대표로 지정" 액션 복원(v3.163 제거분), MyMusic 아티스트 요약 = is_default 우선→최신 생성 폴백 복원.
- **④ public/index.html 신설**: viewport-fit=cover(웹 insets.bottom 실값 공급 → insets 기반 시트 9곳 일괄 회복)+100dvh(@supports 폴백)+인앱 스크립트 인라인. **1차 게이트 FAIL 1건 발견**: :7 주석 속 `%LANG_ISO_CODE%·%WEB_TITLE%` 문자열이 expo의 첫 1회 치환을 소진 → dist title/lang 미치환 잔존 — **발견 즉시 주석 % 제거 픽스 후 `expo export` 재실행으로 실치환 재검증(통과)**. 개별 보정: LyricsPromptReview insets 하한, App.tsx 미니플레이어 웹 54 정합·웹 탭바 54+insets, 래퍼 iframe 100dvh.
- **⑤ 보이스 validate 500**: 로그·Mongo 실측 = 게이트웨이가 **긴 presigned URL 거부**(Inst v3.210 동일 유형·body code 500). 짧은 토큰 302 라우트 이식 — `GET /api/voice-clone/audio/{clone_id}/{kind}/{token}`(무인증·hmac 토큰 대조·kind 화이트리스트·만료 410·성공 302) 신설 + voice_clone_service `_presign` 4곳 → 짧은 URL 헬퍼 교체. **서버 배포 완료(사용자 실행), '진주1' 실재시도 awaiting_verify 도달 실증 — 가설 확정**. ⭐ 환불 경로 hunk 0(회귀 없음).
- **⑥ 외부 API 헬스체크**: routes/admin_health.py 신설(전 라우트 admin 전용) — **active 12종**(suno 크레딧·openai/anthropic/gemini/xai models·replicate·S3·SES·PG/Mongo/Redis/ES — 무과금 확인 엔드포인트만, 키는 헤더 전달·응답 미노출)+**passive 6종**(kling·seedance·kits·sync·rekognition·voice validate 24h 집계 — ⑤ 상시 감시 연동), Redis 10분 캐시+force. admin_web **"시스템" 탭**(Health.jsx·상태 배지 표·60s 폴링) 배포·검증 — **401 게이트·무효 토큰 404 확인**.
- **⑦ 가상 착장**: MusicResult 스냅샷 폴백 — 실사 슬롯 부재 시 virtual_sheet_object_name/virtual_used_items+characterId 포함(서버 `_build_character_snapshot` 재조립이 가상 cid도 커버). 기존 발매곡 소급 없음(백필 이월 → v3.218 ①에서 1곡 처리).

### 검증

- **1차 게이트(TESTPLAN v3.217)**: 앱 11(A-8 FAIL→픽스 후 재검증)+서버 5+admin 1 = **17 PASS / 1 FAIL → 수정 후 통과**. tsc exit 0, py_compile 4파일, expo export·admin npm build 통과, diff 격리(매트릭스 한정·타 트리 오염 0).
- **배포**: 서버 4파일(voice_clone.py·voice_clone_service.py·admin_health.py 신설·main.py 2줄)+admin SPA — **사용자 실행, _orig=라이브 pull·md5 대조**(MD5SUMS·DEPLOY.md, 배포 직전 라이브 재대조 절차 준수). **웹(Pages) 2회 배포**.
- 실측: 보이스 실재시도 awaiting_verify 도달, 헬스체크 응답(suno detail 크레딧 수치)·캐시/force, 302 라우트 무효 토큰 404, suno 크레딧 프로브 사전 실증(GET 1회·무과금).

### 미검증 이월 (완료 조건 명시)

- **실기기 D군(iOS)**: 하단 시트 9곳 사파리 툴바 미가림(④), 화면꺼짐 중 재생 유지·ended 곡 전환 실판정(개선 후에도 보장 불가 — 판정 기록), 잠금화면 메타 곡 전환 추종, 카카오톡 링크 자동 탈출(또는 배너)·Android intent(hash 이중 fragment 확인)·iOS 기타 인앱 안내.
- **보이스 본인확인 이후 단계**: verify→generate 완주·⭐ 과금/실패 환불 회귀(awaiting_verify까지만 실증).
- 기능 이월: 기존 곡 스냅샷 전수 백필(1곡은 v3.218 처리), 헬스체크 주기 수집·알림, kling/kits/fal/sync active 승격, PlayerScreen↔playback 재생 경로 이원화 통합, wondera/lalal 키·라우트 정리.

특이사항: 민감 정보 플레이스홀더(<SSH_HOST>=maidol-ec2 별칭만, API 키·크리덴셜·크레딧 외 수치 미기재). A-8 치환자 파손은 expo 치환기가 String.replace 1회 치환인 데서 온 함정 — public/index.html 주석에 % 치환자 문자열 금지 관행화.

## v3.218 (2026-09-24) — '방학하면 바다가자' 착장 백필 + TrackActionSheet 하단 잘림 + 튜토리얼 하이라이트 단순화 (PLAN·TESTPLAN 별도 섹션 없음 — 본 기록이 정본)

**요청(2건+파생)**: ① 곡 '방학하면 바다가자' 스타일링 탭 착장 미표시 ② 곡 ⋮ 시트 하단 잘림. (+튜토리얼 하이라이트 형태 — 사용자 피드백 3회)

### 수행 결과

- **① 착장 백필**: 해당 곡의 착장 스냅샷이 빈 값(실사 슬롯 기준 오저장 — v3.217 ⑦ 결함의 기존 곡 잔재) → **가상 슬롯 3종으로 스냅샷 교체 백필**(+Redis 트랙 캐시 삭제).
- **② TrackActionSheet**: maxHeight 60%→**78%** + 항목 목록 **ScrollView 래핑**(차트 토글 등 항목 증가로 넘칠 때 스크롤 — Android·iOS 공통).
- **TutorialOverlay 하이라이트 개편**(사용자 피드백 3회 반영): pill(원형) 제거→둥근 사각(radius 12), 이중 딤 띠 제거, 링·글로우 제거 — 최종 단순화.

### 검증

- ① 백필 후 스타일링 탭 **실노출 스크린샷 검증**. ② TrackActionSheet·TutorialOverlay 로컬 실측 스크린샷 검증.
- planner 최종 재확인(본 기록 전): diff 실측 — TrackActionSheet 8줄(ScrollView·78%)·TutorialOverlay 25줄(단순화) 결과 소재와 일치, 이상 없음.

### 미검증 이월

- 실기기: 시트 스크롤 실동작(항목 최다 조합)·튜토리얼 전 스텝 하이라이트 형태 확인.
- 유사 빈 스냅샷 기존 곡 **전수** 백필(이번은 1곡 지정 백필 — 대상 조회 스크립트 이월).

특이사항: 오케스트레이터 직행 소규모 사이클이라 PLAN 미작성 — 본 REPORT가 정본. ① 백필은 프로덕션 데이터 변경(사용자 승인 관행 하 수행).

## v3.219 (2026-09-24) — 작업실 '작업 시작' 말풍선 아티스트 우선화 + 5개 디렉터 작업 중 상태 보존(이탈·재진입 이어가기)

**요청(2건)**: ① 클릭 유도 말풍선("클릭해서 작업 시작!")이 작사 디렉터에 붙음 → 아티스트 디렉터로 ② 각 디렉터 작업 도중 뒤로가기/타 페이지 이동 시 작업 내용이 처음으로 초기화.

### 수행 결과

- **① 말풍선**: 원인 = nextActionDirector 체인(작사→작곡→커버)에 **artist 단계 자체가 부재**. 아티스트 **미보유 시 artist 선두 삽입** + hasArtistCharacter를 **3상태(null=조회 전)**로 — null 동안 말풍선·펄스 유보(보유자 깜빡임 레이스 봉합), 게스트·휴식 중 미표시 현행 유지. `[NextAction]` 로그.
- **② 상태 보존 — 커버(v3.202 H-⑤) 패턴을 4흐름 이식**: **(A) 작사** lyricsStore draftStep/draftChat + **AsyncStorage persist**(partialize 포함 — 핫리로드 생존, 2026-09-07 사고 직결) + `generatedPrompt` partialize 누락 봉합, hydrate·복원 시 setStyle('') 스킵·'처음부터 다시' 버블. **(B) 아티스트** characterTaskStore draft(persist는 텍스트 9필드만 — 파일 URI 제외), targetCharacterId/forceKind 키 불일치 폐기, v3.105 '이어서 만들기' 우선 유지. **(C) 작곡** composeDraft(**lyricsKey** 메모리 — 다른 가사 진입 시 폐기, 마운트 artistCharacterId 초기화는 새 대화 분기 한정으로 v3.156a와 양립, 답변 28필드 hydrate). **(D) 커버** = hunk 0(무접촉 — musicStore persist 미도입으로 자동 재생성·재차감 경로 원천 부재). **(E) 영상** videoDraft(making/done **이중 제외** — 재진입 무한 스피너·재차감 차단, 트랙 실측 검증 후 소멸 시 폐기, **스타일 sticky 14필드 별도 유지** — 완주 후 다음 영상 승계). 공통: authStore.logout에서 draft 일괄 청소(**lyricsStore는 보존** — 기본안·사용자 생성물 우선), MusicResult 발매 성공 2곳 clearComposeDraft.

### 검증

- **1차 게이트(TESTPLAN v3.219): 12/12 PASS, FAIL 0** — 말풍선 3상태·작사 draft persist·아티스트 partialize 격리(파일 URI 미포함 grep)·작곡 마운트 분기·영상 making 제외·logout 청소·tsc exit 0·diff 격리(v3.219 추적자 6종 = 매트릭스 10파일 한정, 병존 v3.217 미커밋분 오염 0) 전수 충족.

### 미검증 이월 (완료 조건 명시)

- **웹 E2E**: 테스트 계정 API 로그인 401(팀 관행 비밀번호 불통 — 1회 시도 후 중단, 비밀번호 재확인 필요) → draft 복원 실측 이월(토큰 → /#token= 진입 → 작사 3답 → 이탈 → 복원 확인).
- **실기기**: 정상 완주 5종(아티스트/작사/작곡/커버/영상 — 도중 뒤로가기·탭 이동 끼워 완주+발매 후 draft·lyricsStore 동시 클리어), 핫리로드/앱 재시작 draft 생존(2026-09-07 재현), 커버 pending 자동 재생성 1회·재차감 없음, 말풍선 실표시(신규→아티스트, 생성 후 작사 이동, 보유 계정 무깜빡임), apiError 재진입 시 draft 복원과 '이어서 만들기' 버튼 관계.

특이사항: 앱 단독·서버 무변경(원격은 읽기 조회만 — 민감 정보 기재 없음). 커버 대화 AsyncStorage 영속·앨범 모드 보존·작곡 draft persist는 이월(재차감 안전장치 설계 선행).

## v3.221 (2026-09-24) — 마이페이지 ⋮ 다운로드 [영상·음원] 2택 + 공유 항목 임시 숨김 (오케스트레이터 직접 — PLAN 없음, 본 기록이 정본)

**요청**: 마이페이지 곡 ⋮ 다운로드를 [영상, 음원] 2택으로(영상은 영상 디렉터 연결), 공유 항목은 임시 숨김.

### 수행 결과

- **다운로드 2택 다이얼로그**(showAlert — 앱 다이얼로그 관행): [영상] → MainTabs>Studio>**VideoDirector initialTrackId 프리셋 신설** 이동(App.tsx 파라미터 타입 확장), [음원] → downloadTrackMp3 즉시 실행.
- **downloadTrackMp3·saveTrackFileToDevice 모듈 헬퍼 추출**(TrackShareDownloadSheet) — 시트 내부는 위임 호출, 시트 밖(마이페이지)에서 재사용. 로그인 가드·성공/실패 안내 헬퍼 내 포함.
- **VideoDirector initialTrackId**: 목록 로드 후 프리셋 곡 발견 시 **clearVideoDraft(명시 진입 우선)**+복원 안내 억제+선곡 통과(format 단계 직행), 비공개 곡은 안내 팝업(공개 전환 유도).
- **공유 임시 숨김**: extraItems에서 공유 **항목만 제거(미노출)** — TrackShareDownloadSheet 렌더·sdMode 상태·공유 기능 전부 보존(복원 = 1줄).

### 검증 (planner 최종 diff 정합 재검 — 본 기록 전 수행)

- 4파일(TrackShareDownloadSheet.tsx·MyMusicScreen.tsx·App.tsx·VideoDirectorScreen.tsx) v3.221 diff 전량 정독: ① 공유 숨김 = **항목 미노출 방식 확인**(시트 렌더·상태·기능 잔존 — MyMusicScreen:957 유지) ② mp3 헬퍼 = 기존 saveToDevice/handleDownloadMp3 로직 **문자 등가 이식**, 로그인 가드 헬퍼 내 보존(시트 close 시점만 API 호출 전으로 앞당김 — 동작 등가) ③ 프리셋 vs draft: 발견 시 clearVideoDraft+notice 억제 후 프리셋 대화로 재구성 → v3.219 미러링이 새 draft로 일관 기록 — **충돌 없음**. 내비 경로 정합(MyMusic=MainTabs 탭 → getParent=RootStack → 중첩 navigate). App.tsx의 v3.221 hunk는 타입 확장 1줄뿐. `tsc --noEmit` exit 0 재실측. **이상 없음**.
- 관찰 2건(비차단): (a) 프리셋 곡이 **비공개**+기존 draft 병존 시 로컬 화면은 draft 지점 유지(코드 주석 'pick 유지'와 상이 — 데이터 유실·재차감 없음, 무해) (b) 프리셋 적용이 마운트 effect 한정 — VideoDirector가 Studio 스택에 **이미 마운트된 채** 재진입하면 파라미터만 갱신되고 프리셋 미적용 가능(Studio 탭 tabPress가 Map 리셋이라 통상 언마운트 — 실기기 확인 이월).

### 미검증 이월

- 실기기: 2택→영상 디렉터 프리셋 착지·음원 저장 완주(OS 공유 시트), 관찰 (a)(b) 실동작 확인.
- 공유 항목 복원 시점 결정(사용자) — 복원은 extraItems 1줄.

특이사항: 앱 단독·서버 무변경. 커밋은 오케스트레이터 승인 후(현재 v3.217~v3.221 미커밋분 작업 트리 병존 — v3.219 A-12 격리 검증 완료 상태).

## v3.220 (2026-09-24)

**요청**: ① 앨범 페이지 하단바(차트~작업실) 사라짐 ② 알림·메시지 페이지 미니플레이어 숨김(설정 관행) ③ 추천하기 '카카오톡으로 공유'→'카카오톡' ④ 전앱 '스타' 텍스트 ⭐ 표기.

**수행**: ① AlbumDetail 을 RootStack→MainTabs 숨김 탭(MyMusic 선례 규격) 이전 — 탭바 상시 유지, exitAlbum(from 분기: Chart/MyMusic/UserChannel 재push) + 내부 이탈 3곳 치환 + albumId 리셋 effect. 진입 5콜사이트 전환. 미니플레이어 허공 렌더 부수결함 구조 해소. ② HIDE_MINIPLAYER_ROUTES + Notifications·DmInbox·DmChat(렌더 게이트만 — 재생 유지). ③ AppShareModal 라벨 1곳(전앱 유일). ④ 매트릭스 12행: R1 수량 `⭐N`, R2 서술형 첫 언급 `스타(⭐)` 병기, R3 기⭐·제외 규칙(스타일*/스타킹/톱스타/a11y/currency·levels) 원형 유지.

**검증**: 1차 게이트 12/12 PASS(TESTPLAN v3.220 — 내비 전환 완전성·제외 규칙 grep·tsc 0에러·diff 12파일 격리). 이월: 실기기/웹 실조작(진입 5경로·복귀 3방향·미니플레이어 숨김·⭐ 육안·Android back 스모크), 비게이트 엣지 1건(에러 경로 한정 from 클로저 — 정상 동선 무영향).

**특이**: 구현 1차 시도가 모델 사용 한도로 중단 → 사용자 지시로 동일 모델 재시도 완료. v3.220은 v3.217~221 일괄 커밋(37a2304) 이후 별도 커밋.

## v3.222 + v3.223 (2026-09-24)

**요청**: v3.222 ① 마이페이지 다운로드→영상 진입 시 상단바가 '작업실'로 뜸(엔터명+뒤로가기 필요) ② Inst 만들기를 작곡 디렉터 1~5단계 진행 화면과 완성 후 미리듣기로 연동 ③ 작곡 2곡 생성 화면 미리듣기 시크 불가. v3.223 로그인 사용자 재생목록 미보존.

**수행**
- v3.222① 원인: 프리셋 진입이 VideoDirector 를 Studio 스택 단독 루트로 적재 → Map(엔터명 헤더 주입 주체) 미마운트. MyMusic 중첩 navigate `initial:false` + VideoDirector focus 시 headerLeft ← 주입.
- v3.222② MusicLoading 진행 UI를 ComposerLoadingView 로 추출(동작 등가), InstLoadingScreen 신설(5단계·시간 전진+status 점프·5s 폴링·10분 타임아웃·resume·실패 환불 안내·완성 시 stream-proxy 시크 미리듣기). MyMusic 백그라운드 폴링 → InstLoading 진입(202/409) + focus 시 reconcileInstBusy.
- v3.222③ 원인: 서버 `GET /generate/{id}/stream/` 에 Range·Content-Length 전무. tracks.py v193 Range 블록 동형 이식 + inline 전환(server_staging_v3222/generate.py). **서버 배포 완료**(사용자 실행, md5 8786687e 일치·health 200·인증 401). 프런트 무변경.
- v3.223 원인: 계정별 보관함(savedQueues)·재시작 복원은 존재했으나, 곡 단위 재생 경로들이 setQueue 로 큐를 통째 교체 → 보관함 즉시 덮어쓰기. playTrackNow mode(append 기본) 도입, 곡 탭 경로 8곳(Chart 검색·Feed·FeedDetail·MyMusic·AlbumDetail + 재검증 추가분 Search·UserChannel·ArtistDetail) append 전환, 빈 큐 보관함 덮어쓰기 방어, playTrackAtIndex 저장 보강, restoreSession 하이드레이션 대기(+2s 폴백), 큐 중복 판정 String 정규화. 플레이리스트 재생=교체·게스트 폐기·claimQueue 불변.

**검증**: 1차 게이트 23항목 중 FAIL 3건(C-9 RN7 `navigate('Map')` 가 Map 을 새로 push → 화면 미해제·사운드/폴링 누수, C-10 InstLoading 인스턴스 재사용으로 이전 결과 잔존, E-3 PLAN 열거 누락 교체 경로 3곳) → 픽스(popTo·blur 시 pause·getId+nonce·append 3곳) → 재검증 통과(하니스 71/71 — 실제 StackRouter 7.5.3·playerStore 실행). 재검증 관찰 O-6에서 동일 결함 2곳(ArtistInput ←, ArtistCody 복귀) 추가 발견 → 오케스트레이터가 popTo 로 동일 수정(tsc 통과).

**이월(2차 게이트·실기기)**: [api] generate stream Range 실측(로그인 토큰), [e2e] 다운로드→영상 헤더, Inst 진행 화면 실완주(⭐ 과금), A/B 시크 실측, 재생목록 보존(담기→곡 재생→재시작 복원), Android 하드웨어 back 시 이전 InstLoading 카드 노출 여부(O-7).

**특이**: Fable 사용량 한도로 에이전트 3회 중단 → 사용자 지시로 크레딧 사용 후 Opus 5.5 로 전환해 완료. 백엔드 worktree(TripleJ-backend)가 라이브와 desync — 서버 작업은 라이브 pull 관행 유지.

## v3.224 (2026-09-24)

**요청**: 이미지 디렉터 상단 ← 부재 / 사파리(PC) 구글·카카오 로그인 403 / 초대 링크 소셜 가입 추천 보상 / 베타 가입 추가 ⭐50(~10/30, 기존 회원 소급).

**수행·검증**
- 이미지 디렉터: CoverGeneration focus 시 Studio 헤더 ← 주입(작사·영상 관행), AlbumCoverGeneration(RootStack) 제외. 로컬 실측(← 노출·Map 복귀).
- PC 로그인 403: 원인 = PC 래퍼가 앱을 iframe 으로 띄우는데 로그인 이동이 iframe 안에서 일어나 구글·카카오가 프레이밍 거부. 최상위 창 이동으로 수정 + 래퍼가 iframe 전달 후 바깥 주소창 #token= 제거. 프로덕션 PC 폭 실측: 창 전체가 구글 로그인으로 이동. 사용자 가설(ref 원인)은 실측으로 기각(ref 유무 무관 앱 정상 실행, OAuth redirect_uri 고정).
- 모바일 사파리 경로 점검: state 는 Redis(쿠키 무관), 콜백 /oauth/callback#token= → 래퍼 → /app 로그인·차트 착지·토큰 제거 재현.
- 추천 보상(소셜): 앱이 ?ref= 를 로그인 URL 에 전달, 서버 oauth state 에 "provider|client|ref" 동봉 → signup 시 referred_by + ⭐50×2(auth.register 동일 규칙, 멱등). 프로덕션 실측: 초대 주소→구글 버튼 → 서버 로그 `login?ref=SSUGSIS` 수신.
- 베타 가입 추가 ⭐50: auth.grant_beta_signup_bonus(액션 beta_signup_bonus, 1인 영구 1회) — 이메일·구글·카카오 가입 지급, 2026-10-30 23:59:59 KST 까지(경계 테스트). 기존 회원 소급: 실제 회원 12명 ⭐600 지급 완료(재실행 0건 — 멱등 확인). 제외: 탈퇴·관리자·브랜드·가짜 도메인 테스트·웹점검 4·팀 test1~4.
- 서버 배포(사용자 실행): auth.py 931890e1 / oauth.py 43f8d62e (md5 일치, health 200). 웹 3회 배포.

**이월**: 실계정 소셜 가입 1건으로 추천 보상 지급 로그 확인([referral] oauth reward), 카카오 웹 로그인 완주(최근 성공 기록 없음), 과거 소셜 가입자 추천 누락분은 사용자 지정 시 수동 지급.

## v3.227 (2026-09-24) — 아티스트 생성 중 자유 이탈·사진 소실 회귀·꾸미기 피커 통합·원본 얼굴사진 보호

> **버전 번호 중복 안내**: 본 섹션은 아티스트·꾸미기·원본 보호 사이클이다. 같은 날 다른 세션이 커밋한 `03b1d2d "v3.227 화면 사용 분석 수집"`(분석 수집)은 **다른 세션 작업**이며 이 섹션 범위에 포함되지 않는다. PLAN 정본 = PLAN.md `# v3.227` 섹션 + `## A-보완`.

**요청**: ① 생성 중 브라우저·화면을 옮기면 작업이 끊기나 — 계속 만들어지게(→ 생성 중 자유 이탈로 격상) ② 원격 로거 폭주 ③ 위시리스트 조회 실패 ④ 상의·하의·모자·가방·신발 피커에서 초기 데이터(무신사·지그재그 등)와 브랜드샵을 "브랜드 모아보기/펼쳐보기"로 통합 + 대분류·필터 ⑤ 피커 상단에 고른 아이템 표시 ⑥ 비밀번호 찾기 메일 AWS SES 전환 검토 ⑦ 웹 배포 명령. (+추가) ⑧ 얼굴 사진으로 만들었는데 '만들 때 사용한 사진'·얼굴 인증이 안 뜸 ⑨ 원본 얼굴사진 무인증 공개 노출.

**원인(실측)**
- ⑧ **v3.219 [ArtistDraft] 회귀**: draft는 대화만 영속하고 사진은 메모리 전용이었다. 복원 시 사진 단계를 지난 상태로 되살아나고, 질문을 마치면 `setInput({photoUri:null})`이 저장된 사진까지 덮어썼다 → 텍스트 전용으로 ⭐10 과금·얼굴 인증 미발동·original_photo_object_name 공란. 아티스트 "샘플" = 2차 job 6ab4c22b(텍스트 전용) 결과(시트 바이트 크기 일치). 어디에도 연결되지 않은 건은 1차 6ab4c16e(사진·얼굴 인증 통과) 1건.
- ① 서버는 끝까지 생성했지만, 앱 폴링이 "연속 오류 3회"에서 포기하고 job을 기록하지 않아 결과가 temp에 고아로 남았다. 포기 문구의 "자동 환불"도 잘못된 안내였다.
- ② 만료 토큰 403을 재시도 대상으로 처리 + 동시 flush 가드 부재로 자기 증식. ③ 최대 1,252개 ID를 쿼리스트링으로 전송.
- ④ 서버 `/ads/active`는 `$sample 500` 랜덤이라 상의·하의는 열 때마다 약 1/3만 노출됐고, 첫 단계 '플랫폼'이 판매자 계정명이라 브랜드샵이 따로 보였다. 프롬프트 브랜드도 판매자 계정명이었다.
- ⑨ preview 프록시가 original_*을 인증 없이 반환했고, upload.py에도 우회 경로 3곳이 있었다.
- ⑥ SES 발송 코드는 v3.207부터 존재하지만 운영에서 비활성(mail_enabled=False, .env 키 없음) → **현재 비밀번호 재설정 메일이 발송되지 않음**(코드는 서버 로그 dev 폴백). IAM 역할 maidol-ec2에 SES 권한이 없고, DNS SPF·DMARC·MX도 없음.

**수행(커밋 — 모두 origin/frontend 푸시)**
- `0045d1e` 꾸미기 피커를 컴포넌트로 분리(동작 무변경 — 40% 룰 대응 추출 커밋).
- `6e48197` **W0 사진 소실 회귀 수정**: draft `photoIntent` 영속, 사진 없이 복원되면 사진 단계로 되돌려 재업로드 요구(확약 다이얼로그 재표시), setInput null 덮어쓰기 금지, 생성 직전 가드(과금 전 차단). **W0 웹 선배포**(사용자 실행 `deploy_w0.sh` — 깨끗한 worktree `/Users/pearl/TripleJ-webdeploy` 기준, 운영 번들 photoIntent 포함 확인).
- `cb340a4` **W1**: 전역 생성 추적기(generationJobStore 영속 + generationTracker — 화면과 분리, 포그라운드 복귀 1.5초 재조회, 네트워크 오류는 실패 아님, 서버 failed일 때만 실패+환불 안내, 30분 서버 stale 기준 정합). ArtistLoading = 추적 뷰어 + [나가서 다른 작업 하기]. 작업실 아티스트 디렉터 말풍선(만드는 중 n분/완성), 내 아티스트·아티스트 만들기 카드(만드는 중·도착·실패), 완성 저장 단일 경로(사진 job은 서버 original_object_name 연결), 중복 생성 차단(앱 3곳 + 서버 409 generation_in_progress). 원격 로거 방어(401·403 drop·토큰 일시정지·inflight·백오프·서킷), 위시 sync를 `GET /wishlist/` 기반으로, 원본 사진 인증 로딩(authImage — 네이티브 헤더/웹 blob, URL 토큰 미사용).
- `ecc3db9` **W2**: 피커 통합 — `/ads/catalog` 전량, [브랜드 모아보기 | 브랜드 펼쳐보기], 대분류 칩, 필터(성별·색상 13계열·가격·브랜드), 정렬, 선택 아이템 스트립(탭 시 카테고리 전환, 재진입 유지), 브랜드 표기 정정(프롬프트·카드 = brand 우선). v3.205 성별·v3.206 모자|가방·위시 탭·SAMPLE 폴백 보존.
- `5d02faf` 앱 버전 1.1.9. W1 단독 스냅샷에서 tsc 0 확인 후 분리 커밋.
- **서버**(server_staging_v3227 6파일: character·business·upload·item_taxonomy(신규)·character_generator·openai_image): recoverable·dismiss·save 소비 표시·409·stale lazy 정리, 원본 재사용 Form, preview 원본 게이트([PreviewGuard]) + upload.py 우회 3곳 차단, catalog(gzip·필드 12·대분류·색상 계열 — DB 쓰기 없음), gpt_image_2 참조 인덱스 맵·IDENTITY LOCK(input_fidelity는 gpt-image-2 미지원·400이라 미사용 — 공식 문서 근거). 배포 전 소수정 3건(save 재시도 멱등·catalog `_id` 타이브레이크·IDENTITY LOCK 헤어 규칙). main.py 무변경.
- 서버 반영: 사용자 1줄 명령(md5 가드·`.bak_pre_v3227` 백업·6×OK) → 오케스트레이터 빌드(다른 세션의 08:36 main.py·admin_items·admin_stats·analytics 변경 포함) → 이미지 내 md5 6개 일치 → 진행 중 job 0 재확인 → 컨테이너 재생성(09:02Z) → health 200.

**검증**
- tester: W0 게이트 FAIL 0(로컬 웹 E2E, 가짜 API·과금 0). W1·W2 1차 게이트: 판정 가능 FAIL 게이트 12개 PASS, 가짜 API E2E ①~⑩ PASS, 하네스 로거 11/11·추적기 29/29·위시 8/8·카탈로그 22/22. 서버 단위 23/23·분류 골든 78/78.
- 운영 스모크: 기존 API 200. 다른 세션 admin/stats·admin/items 401·analytics 405(등록 유지). 원본 3경로 무토큰 404, 일반 시트·커버 200. recoverable·presigned 무토큰 401. catalog 상의 1,501건·gzip 138KB·필드 12·대분류·색상 13, 잘못된 category 400. 재시작 후 traceback 0, [PreviewGuard]·[Catalog] 로그 동작.
- planner 스팟체크(작업트리 정독): photoIntent 3파일, 추적기·카드·authImage·catalogService·codyCatalog·cody 컴포넌트 존재, 로거 403 drop, 위시 `/wishlist/` 사용, pollCharacterJob 삭제, 중복 가드 `guardArtistGeneration` 호출(ArtistCody :444·MyArtists·ArtistLoading), 프롬프트 브랜드 `brandNameOf`, app.json 1.1.9 — PLAN 대비 누락 없음.
- 사용자 결정 준수: 전체 진행 / 오늘 2건 데이터 쓰기 없음 / H-3 즉시 차단 / 회수 기간 무제한. recoverable 노출 예상 = 6ab4c16e 1건(6ab4c22b는 '샘플' 저장본과 바이트 일치라 비노출).

**SES 판정**: 전환 가능, 코드 변경 0. .env 3줄(MAIL_ENABLED·SES_REGION·MAIL_FROM) + 컨테이너 재생성 1회. 재설정 코드·세션은 별도 Redis(AOF)라 재생성에 영향 없음. 사용자 6단계: ① SES 도메인 DKIM(Cloudflare CNAME 3·프록시 OFF) ② (권장) MAIL FROM MX·SPF ③ (권장) DMARC ④ 프로덕션 액세스 요청 ⑤ maidol-ec2 역할에 ses:SendEmail·ses:GetAccount ⑥ .env 편집.

**플랫폼 한계(사용자 안내)**: 모바일 웹·네이티브 모두 백그라운드·화면 꺼짐 중에는 JS가 멈춰 **완성 순간 알림은 불가하고, 돌아왔을 때 수령한다**(작업실 말풍선·카드·알림 1회). 푸시 알림은 백로그(expo-notifications 미설치·서버 푸시 필요).

**이월·남은 절차**
1. W1·W2 웹 배포 — 사용자 `cd /Users/pearl/homepage/maidol && ./deploy.sh app`. 서버가 먼저 반영돼 있어 **구웹에서는 '만들 때 사용한 사진'이 일시 미표시**(원본 인증 게이트).
2. 실기기 확인(사용자, 본인 얼굴 인증 필요): 사진 업로드 → 이탈 → 재업로드 요구 → 생성 중 나가기 → 작업실 말풍선·내 아티스트 카드 → 도착 저장 → '만들 때 사용한 사진' 표시, 중복 생성 차단 팝업, 도착 카드(6ab4c16e) 저장/닫기.
3. H-2 얼굴 동일성 A/B 3장(OpenAI 2·Gemini 1) — 사용자 승인 대기.
4. 409 generation_in_progress 실서버 확인 — 실생성이 필요해 사용자 실사용 중 자연 검증.
5. SES 6단계(사용자) 후 .env 3줄 + 재생성.
6. 로그 볼륨 호스트 마운트 — 사용자 승인 대기(오늘 07:03·08:36·09:02 재생성마다 컨테이너 로그 소실 실측).
7. APK 1.1.9 EAS 빌드 진행 중(링크는 오케스트레이터 보고). 1.1.8 사용자는 원본 사진 표시·실사 옷 입히기가 1.1.9 설치 전까지 제한된다(H-3 즉시 차단 결정).

**백로그**
- [보안] 커버·MV 생성의 `character_object_name`/`cover_object_name` 소유권 검사 부재(upload.py — 타인 원본을 생성 입력으로 사용 가능).
- dismiss 진행 중 job: TESTPLAN 404 vs 서버 409(무해) — 계약 문서 정합.
- 오디오 스트림·DM 웹소켓의 URL 쿼리 토큰(헤더 불가 구조) 잔존.
- UX: 생성 차단 상태에서 ArtistInput 인사말 잔존, 튜토리얼 중 기존 말풍선 표시, 위시 탭 FlatList removeClippedSubviews.
- 분류율 정의 차이(엄격 92.0% / 가방 BAG 포함 96.7%), 색상 없는 874건 이미지 기반 보강, 색상 옵션 중복 문서 표시 병합, 장소 사진 preview 보호, 생성 완료 푸시 알림, 추적기 어댑터로 커버·영상·Inst 이관.

**특이**: 버전 번호가 다른 세션의 분석 수집 커밋(03b1d2d)과 겹침. 서버에 다른 세션이 main.py 등을 .bak 없이 수정·배포(07:03·08:36) → 이번 반영은 배포 직전 현재본 재수신 위에 패치·main.py 제외·디렉터리 통째 scp 금지로 충돌을 회피했다.

## v3.228 (2026-09-24) — 작사·작곡(연주곡)·이미지(커버·다듬기)·영상 디렉터에 자동 도착 알림·중복 생성 차단·재시작 멈춤 환불 정리 확장 (PLAN 정본 = PLAN.md `# v3.228`)

**요청**: "그럼 만약에 작업이 이상해질껄 대비해서 지금 상태를 체크해놓고. 작사, 작곡, 이미지, 영상 디렉터 모두 아티스트 디렉터 처럼 자동도착알림, 중복생성차단, 서버 재시작으로 멈춘 환불정리 반영해줄래?"
- 유지 원칙(ea39dac 결정): 진행 화면 안내는 "작업이 끝날 때까지 이 화면을 벗어나지 마세요" 그대로. 자동 회수는 실수 이탈 대비 안전장치이며, 이탈을 권장하지 않는다.

**체크포인트(롤백 기준)**
- 앱: 태그 `checkpoint-pre-v3228` = ea39dac
- 서버 이미지
  - `maidol-app:checkpoint-pre-v3228`(3f32481b5e68, 09:24Z)
  - `maidol-app:pre-v3228-live`(fc5ae5e93291 = 배포 직전 실행 이미지, 다른 세션의 10:25Z 반영분 포함)
- 서버 소스 tgz: `backups/backend_9004_app_pre_v3228_20260924T094437Z.tgz`
- 파일 백업: `routes/{generate,upload,tracks}.py.bak_pre_v3228`
- 배포 직전 docker 로그 보존: `maidol-app_pre_v3228_20260924T155831Z.log`

**원인(실측 — planner 0단계, 서버 읽기 전용)**
- 재시작 복구는 character_jobs에만 있었다(main.py:536-567).
  - 작곡: 재시작하면 generations가 processing에 영구히 남고 환불도 없었다. 앱 폴링에는 상한이 없어 무한 대기했다.
  - 연주곡: inst_jobs active가 영구히 남아 그 곡이 영구 409가 되고 환불도 없었다.
  - 작사·커버·다듬기·영상(동기 요청): 처리 중에 프로세스가 죽으면 차감만 되고 환불되지 않았다.
- **영상 중복 과금 확정**
  - 캐시 판정이 완성본 존재 여부뿐이라, 인코딩 중에 다시 요청하면 캐시 미스로 재차감 + ffmpeg 이중 실행이 일어났다.
  - 과금 ref가 결정적이라 두 번째 차감의 이벤트가 DuplicateKey로 삼켜졌다. 결과적으로 **기록 없는 차감**이 됐다.
  - 앱 timeout 300초가 서버 600초·nginx 320초보다 짧아 "실패" 표시 → 재요청을 유도했다.
  - 잔액 대사 결과 39개 계정 중 36개는 정확히 맞았다. 2f85f76c −⭐5는 07:00:28 영상 과금 → 07:02:47 완성 사이에 같은 조합 요청이 한 번 더 들어온 정황이다(로그 소실로 직접 증명은 불가).
- **커버 재진입 이중 과금**: 생성 중 이탈 후 다시 들어오면 마운트 시 자동 doGenerate가 돌아 재차감됐다(CoverGeneration :134-135, :330-334). 다듬기는 락 없이 버전을 산정해 경합이 생겼다(9/22 실사고).
- 작업실에서는 완성 직후 디렉터가 휴식 게이트에 걸려 도착 확인을 가로막는 구조였다.
- v3.227 잔재 문구 "나가 있어도 계속 만들어져요" 2곳이 있었다.

**설계(요지)**
- 동기 요청은 동기로 유지한다. 대신 앱이 `X-Gen-Request-Id`를 발급하고, 서버는 과금 **전에** 원장(`gen_jobs`)을 기록한다. 응답을 잃어도 정확히 회수할 수 있고, 같은 id로는 재차감이 불가능하다(멱등).
- 공통 모듈 `app/services/gen_jobs.py`
  - 단일 워커 전제 `boot_id` 판정: 재시작 전 job은 첫 조회에서 즉시 failed + 환불 1회.
  - kind별 상한은 보조 판정이다: 작사 10분, 커버·다듬기 15분, 영상 25분, 작곡·연주곡 30분.
  - 사용자·그룹별 진행 중 1건이면 과금 전에 409.
  - 결과 확인은 `acked_at`으로 영속 기록한다. 레거시 문서(`consume_tracked` 없음)는 회수 대상에서 제외한다.
  - 킬스위치 env `GEN_JOBS_KINDS`.
  - main.py는 변경하지 않았다(API는 generate.py 라우터 `/api/generate/jobs/*`, 인덱스·기동 sweep은 lazy).
- 영상 과금 ref는 시도별 고유값으로 바꿨다. 캐시 히트는 게이트 전에 무과금 반환하는 동작 그대로다.
- 앱: 추적기에 `registerKind` 어댑터를 실구현했다(lyrics·music·inst·cover·cover_refine·video). 작업실 4개 디렉터 말풍선(피로 게이트보다 먼저 분기), 앱 내 도착 알림 1회, kind별 결과 화면 이동과 ack를 넣었다. 아티스트 경로는 동작 불변이다.

**수행(커밋 — 모두 origin/frontend 푸시)**
- `19d55e1` 추적기 레지스트리 인터페이스(동작 무변경)
- `0f15d6e` **W0 공통**: 작업실 말풍선·도착 알림·스냅샷 매퍼·이탈 권장 문구 2곳 정리
- `2653b9c` **영상 연타 가드**(과금 POST 1회 보장 — 서버 무관 즉시 효과)
- `039829f` 공통 보완(살아 있는 요청 판정·discard·replaceKey·settle)
- `56c7f27` 영상 원장 연동(요청 id·회수·409 adopt)
- `e387341` **W1** 작곡·연주곡(등록·가드·hydrate 추출 `utils/musicHydrate.ts`·ack)
- `35b8bf7` **W2** 커버·다듬기: 원장 연동, **재진입 자동 재요청 봉쇄**(recoverJobId), 다듬기 원장. I-lite와 cover-history는 구서버 폴백으로 보존.
- `8b64d12` **W3** 작사(요청 id·resume 모드·가드·도착 시 가사 복원)
- `03e15e2` 게이트 후속 보완 4건
- `d50ff97` 앱 1.2.0
- 웨이브 5묶음은 누적 tsc 0을 확인한 뒤 분할 커밋했다.
- **서버 S1**(스테이징 server_staging_v3228: generate.py·upload.py·tracks.py·gen_jobs.py 신규)
  - 2026-09-24 15:59Z 배포
  - 사용자 1줄 명령(md5 가드·`.bak_pre_v3228`·로그 폴더 10001:10001)
  - 오케스트레이터: 로그 보존·롤백 태그·빌드 → 이미지 내 md5 4개 일치 + 다른 세션 main.py·admin_stats 유지 확인
  - **재생성 직전 진행 중 0 재확인**(character_jobs·과금 generations·inst 0, 최근 3분 동기 생성 요청 0)
  - 재생성: **로그 볼륨 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 적용**(v3.227 결정 7 해소)
  - health 200(6초). `[GenJobs] module loaded groups=image,inst,lyrics,music,video boot_check=True`

**검증**
- tester 게이트
  - W0-1 영상: 과금 POST 1회 보장
  - W0 1조 공통
  - S1 서버 스테이징: **T1~T7 PASS 32/32**(영상·다듬기·커버·작사·작곡 동시 요청 1차감, 죽은 작업 1회 환불·초안 불변, 멱등, 게이트 순서, 소비·재배달 방지)
  - v3.228 앱 전체(구·신서버 두 모드): 과금 FAIL 게이트 앱 측 T1·T3·T5·T7 PASS, **이중 과금 경로 0**
  - 후속 보완: 하니스 29/43/25/15/10 + 영상 재현 스크립트
- 운영 스모크
  - 기존 API 200·catalog 200
  - 다른 세션: admin/stats·admin/items 401, analytics 405(등록 유지)
  - 신규 `/api/generate/jobs/recoverable`·`/jobs/req/{rid}` 무토큰 401
  - v3.227 유지: 원본 사진 404, character recoverable 401
  - 호스트에 `gen_jobs.log` 생성
- **T8 잔액 대사**: 배포 전 기준선(10:27Z)은 불일치 3계정 {18bd8131:−1, c19acda4:−5, 2f85f76c:−5}. 배포 후(15:59:47Z) 41계정 중 **같은 3계정·같은 값(증가 0)**.
- planner 스팟체크(작업트리 정독 — git 미사용, 서버 읽기 전용)
  - `services/genJobs/{index,runtime,lyrics,music,inst,cover,video}.ts`·`genJobsService.ts`·`utils/musicHydrate.ts` 존재
  - `TrackedJobKind = 'artist' | GenJobKind`
  - 어댑터 6종 `registerKind` 등록
  - `guardGeneration` 적용 8지점: LyricsPromptReview·LyricsResult·LyricsLoading·MusicGeneration·MusicLoading·CoverGeneration(생성·다듬기)·VideoDirector
  - VideoDirector `busyRef`·`proceedingRef`
  - CoverGeneration `recoverJobId` 진입
  - MapScreen `useDirectorJob` 4개 디렉터
  - `TUTORIAL_STEPS`·`DIRECTOR_ANCHOR_BY_TYPE` 존재(불변)
  - 이탈 권장 문구는 VoiceCloneWizard:604(범위 밖 — PLAN 결정 6)만 남음
  - app.json 1.2.0
  - 서버: gen_jobs.py·`.bak_pre_v3228` 3개 존재, 로그 볼륨 bind 마운트 확인, `GEN_JOBS_KINDS` 미설정(기본 전 kind), 16:02Z 기준 컨테이너 로그 Traceback 0
- 5분 오류 확인은 오케스트레이터 별도 기록(추가 전달 예정).

**이월·남은 절차**
1. W0~W3 웹 배포 — 사용자 `cd /Users/pearl/homepage/maidol && ./deploy.sh app`(미실행). 서버가 먼저 반영돼 있고 구웹과 호환된다(409는 실제 중복일 때만, 안내 문장 포함).
2. APK 1.2.0 EAS 빌드 진행 중. 구 APK 1.1.9는 호환되며 새 기능만 없다.
3. 실기기 E2E(과금 — 사용자): 영상·작곡·커버·작사 각 1회 실생성 → 실수 이탈 → 작업실 말풍선 → 도착 알림 → 결과 → 재시작 뒤 재배달 없음. 중복 시도 팝업·⭐ 불변.
4. 운영 재시작 관찰: 다음 재배포 때 진행 중이던 job이 즉시 failed+환불(`[GenJobs] swept reason=dead_boot`)되는지, 로그 볼륨 존속(A4).
5. 2f85f76c ⭐5 보정 지급 — 사용자가 관리자 웹에서 실행(사유 "v3.228 영상 중복 차감 보정").

**백로그**
- 서버(경미)
  - ack kind 불일치 404 미적용
  - 배포 전 초안을 `/start/`로 시작한 작곡의 recoverable 필터(created_at → started_at 권장)
  - 같은 rid 재전송이 피로 429에 가려질 수 있음
  - 상한 초과 뒤 늦게 끝난 작업의 무료 결과
  - 커버 핸들러 try 범위 밖 약 150줄(예외 시 15분 슬롯 잠김 뒤 환불)
  - 앨범 커버(albums.py) 원장 미적용
  - 작곡 차감~doc 기록 사이 수 ms 틈
  - character_jobs의 boot_id 전환
  - `spend_points` 이벤트 DuplicateKey 격상·경보(공용)
  - share-video 비소유자 과금 정책
- 앱
  - 다른 기기·재설치로 회수한 커버는 트랙 연결 불가(보관함으로 이동)
  - 구서버 회수는 같은 세션 한정
  - 영상 회수의 드문 이중 안내
  - "벗어나지 마세요" 문구가 13곳이라 기준을 갱신해야 함(PLAN의 '8곳'은 과소 집계)
  - TESTPLAN W0-U1 문구 갱신
  - 생성 완료 푸시 알림

**특이**
- 이번 사이클에 다른 세션이 서버를 6회 재배포했다. 이번 반영은 배포 직전 현재본 md5 가드, main.py 비접촉, 디렉터리 통째 scp 금지로 충돌을 피했다. 재배포마다 진행 중 작업이 죽고 로그가 사라지는 문제가 이번 사이클 설계(boot_id 즉시 환불)와 로그 볼륨 도입의 근거다. **서버 배포 조율 창구 일원화**를 권고한다.
- 영상 중복 과금 1건(2f85f76c)은 정황만 있고 로그 소실로 확정할 수 없었다. 로그 볼륨 적용 이후에는 같은 유형을 `[GenJobs]`·`[star-econ]` 로그로 추적할 수 있다.
- **재시작 후 5분 오류 확인(오케스트레이터, 16:04:13Z — 재시작 15:59:14Z 기준 4분 59초)**: traceback/exception 0, 5xx 응답 0, health 200, `[GenJobs] module loaded … groups=image,inst,lyrics,music,video` 1회, 호스트 `gen_jobs.log` 동일 기록 — TESTPLAN S1-P5 충족.

## v3.229 (2026-09-25) — 보이스 반영 점검·디렉터 1탭 복귀·아티스트 개명 따라가기·재생수 부풀림 수정 (PLAN 정본 = PLAN.md `# v3.229`)

**요청**
1. 아티스트 내 목소리로 작곡했는데 목소리 반영이 안 되는 것 같다 — 확인.
2. 디렉터 작업 보존본이 바로 안 보이고 여러 번 눌러야 보인다 — 그래야 할 이유가 있는가.
3. 작곡 이후 아티스트 이름을 바꿨는데 곡에 반영이 안 된다 → 수정하면 그 이름을 따라가게(기존 곡 소급 포함).
4. 두 번 재생했는데 재생수가 5 → 8 로 늘었다(차트에 없는 곡).
5. 피드·미니플레이어 재생도 재생수에 포함되어야 한다(대표 결정). 기존 부풀림은 보정하지 않음, 30초 중복 방지 수용.
(관리자 웹 곡 생성 시각 KST 표시는 다른 세션이 119d04e 로 이미 수정·16:56Z 배포 — 검증만 수행, 이번 범위 코드 변경 없음.)

**수행 결과**
- 보이스: 앱·서버 모두 persona 를 정상 전달하고 Suno 가 personaId·voice_persona·audioWeight 0.5 를 에코함을 확인. 앱 V1 — 참고 세기 질문은 레퍼런스 업로드 시에만, 미업로드면 audio_weight 미전송. 서버 V2 `SUNO_VOICE_AUDIO_WEIGHT`(기본 빈값=기존과 동일 본문, 켜기는 A/B 청취 뒤 대표 결정), V3 `[suno][voice] … audioWeight req=… sent=… echo=…` 로그.
- 디렉터 1탭 복귀(R1~R8): 이유 없음 — v3.219 보존 기능에서 "보존본이면 인사 대사 건너뛰기" 분기 누락. `utils/directorResume.ts` 신규, 맵 탭 순서 = 로그인 → 추적 job → 보존본 바로가기 → 휴식 게이트 → 기존 흐름. 모든 디렉터 보존본 있으면 1탭. "이어서 하기" 말풍선, 작사 창작모드 영속, 이미지 '처음부터' 추가. 튜토리얼 중 비활성.
- 개명: 서버 `services/artist_name_sync.py` 신규 + character.py PATCH·재생성 저장·레거시 저장 3경로 훅(이름이 실제 바뀔 때만, 실패해도 개명 성공). likes/playlists/feeds/albums 가수명 우선 + `character_id` 추가(키 추가만). 앱 `renameArtistInQueue`·`applyArtistRenameToPlayback` 로 큐·현재곡·미디어세션 즉시 반영.
- 재생수: 원인 ① 서버 `GET /tracks/{id}` 가 상세 조회마다 `playcount:buffer` incr(→ 재생수·차트 부풀림) — 제거. ② `record-play` 중복 방지 없음 — 사용자/IP해시 30초 dedup. ③ 앱 플레이어 재오픈 시 같은 재생 재기록 — `services/playRecord.ts` 로 재생 1회=기록 1회. ④ 기록이 플레이어 화면에만 붙어 피드·미니플레이어 재생 누락 — 전역 재생 엔진(playback.ts 스토어 구독)으로 이동, 로그 `[PlayRecord] … src=`.

**테스트**
- 앱 `tsc --noEmit` 0, Node 하네스 playRecord 28/28 · directorResume 14/14 · rename 11/11(12번째는 테스트 가정 오류로 제외).
- 서버 스테이징 28/28, 배포 전 현재본 md5 = 기준 원본(다른 세션 변경 보존, main.py 비접촉).
- tester 보완: B1(좋아요·플레이리스트·피드 큐 개명 미반영 → character_id 추가) 해소, m6(늦게 관측한 재생 누락) 해소. 문서 불일치 m1·m2(로그 grep 형식) DEPLOY 에 구현 기준으로 정정.
- 미검증(실기기·사용자): 디렉터 탭 수 실측, 개명 노출 화면 전수, 보이스 A/B 청취, 잠금화면 메타(APK).

**서버 배포 (23:26:53Z 재생성)**
- 사용자 1줄 scp → 10파일 OK, 백업 `.bak_pre_v3229` 9개, 롤백 이미지 `maidol-app:pre-v3229-live`, 재생성 전 로그 `maidol-app_pre_v3229_20260924T232622Z.log`.
- 재생성 직전 진행 중 작업 0, 이미지 md5 10개 = 패치본, main.py·admin_stats = 호스트 현재본.
- **로그 볼륨 복구**: 16:56Z 다른 세션 재배포에서 빠졌던 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 재적용, LOGS_W 확인.
- 스모크: health 200, traceback 0, 공개곡 상세 3회 조회 후 play_count 불변·buffer 키 0.
- 소급(N5): dry-run 대상 1곡(6ab552a2 「혼자 Merry Christmas」 '샘플' → '한겨울', 공개 0). `--apply` 는 프로덕션 데이터 쓰기라 사용자 실행 대기.

**특이**
- 기존 부풀린 재생수(예: 6ab552a2 play_count 8 / play_logs 3)는 대표 결정으로 보정하지 않음.
- 30초 안 같은 곡 처음부터 재생·43초 미만 곡 연속 반복은 서버에서 1회로 흡수(수용).
- 소급 적용 완료(사용자 실행): APPLY DONE tracks=1 errors=0, re-check remaining=0, 검증 REP_TRACK 6ab552a2 artist_name·snap_name='한겨울'. 롤백 원천 OLD 줄은 스테이징 scripts/apply_*.txt 에 보존.

## v3.230 (2026-09-25) — 별 소모 이탈·닉네임 변경·영상 재열람·의상 성별 필터·⭐ 확인 전면화·TOP100 본인 제외·추천 가입 안내·본인인증 우회 (PLAN 정본 = PLAN.md `# v3.230` + "추가 항목 ⑧")

**요청**: ① 아티스트 생성 중 뒤로가기로 별만 소모 ② 닉네임 변경 ③ 영상 단계 완료 후 미표시 ④ 이전 여자 아티스트 이력 때문에 의상 필터가 여자로 고정 ⑤ ⭐ 소모 전 팝업 누락 경로 ⑥ TOP100 기준(본인 다운로드 제외, 멜론 비교) ⑦ 소셜 가입 추천코드 적립 안내 ⑧ 본인인증 요구 전면 우회(사용자간 DM 은 본인인증 도입 후), 가입 닉네임 예약어 변형 차단(후속 v3.230b).

**원인(확정)**
- ① v3.227 이후 캐릭터 ⭐10 차감 후 결과 유실 0건(10일 9건 전부 저장). 실사례는 슬롯 확장 ⭐15 후 본인인증 403 으로 이탈(2f85f76c, 슬롯 보존). 앱 틈: 요청 전 이탈에도 POST 진행·이탈 안내 없음·본인인증 뒤늦은 안내·작곡 응답 전 이탈 시 추적 미등록.
- ② 앱 "준비 중" 스텁, 서버 ProfileUpdate 에 nickname 없음, 닉네임 사본이 곡·피드·댓글에 복사 저장.
- ③ 09-24 07:00 영상: 서버 완성·응답 유실 → 재시도 429 로 사용자 미시청. 재열람 경로 없음.
- ④ 신규 생성에도 기존 기본 아티스트 성별이 1순위, 필터 전환 불가.
- ⑤ 무확인 6경로 + 조건부 3경로(비용 미수신 시 무확인) + 휴식 단축 직후 연쇄 7지점(3초 내 연쇄 차감 8건, 3.5초 ⭐40 사례).
- ⑥ 순위식은 멜론과 동일 구조(순 청취자×0.4 + 순 다운로더×0.6, 24h/1h 50:50, 심야 24h)이나 본인 다운로드·재생이 가산(다운로드 진입점이 내 곡뿐 → 다운로드 성분 100% 본인), 24h 가 자정 리셋 달력일, 동점 비결정.
- ⑦ 적립은 정상(소셜 가입 11건 전원 ⭐50) — 안내·내역 화면 부재.
- ⑧ FACE_VERIFY_ENABLED=true 이고 얼굴 인증 동의·보호자 요청·검증이 users.is_verified 선행 요구 → 본인인증 기능 부재로 실사 얼굴 아티스트 전원 차단.

**수행 결과**
- 서버(8파일, 05:02:57Z 재생성): S1 닉네임 PATCH(정규화·2~15자·예약어 변형 차단·대소문자 무시 중복 409·본인 현재값 no-op·세션 갱신·곡/피드/댓글/앨범 사본 동기화 `[NicknameSync]`), S2 차트 본인 재생·다운로드 제외(`[ChartOwnerExclude]`, play_count 는 유지)·롤링 24h·동점 결정 정렬·빈 차트 폴백·chart_recovery 동일 기준, S3 `IDENTITY_VERIFY_REQUIRED`(기본 false) — face_verify 3곳 본인인증 게이트만 우회(AWS 얼굴 인증·미성년 보호자 동의·character 얼굴 게이트 유지). DM 파일은 원본 유지(사용자간 DM 본인인증 도입 전까지 차단, 공식 계정 DM 허용).
- 앱 1조: 공통 ⭐ 확인(`confirmStarSpend`, fail-closed, 폴백 단가 = 서버 POINT_COSTS 11키 일치), 모든 차감 경로 1회 확인(아티스트는 Cody 1회), 휴식 단축 0.8초 잠금·누적 표시·연쇄 확인, 4개 진행 화면 이탈 가드(단계별 문구 + 원칙 문구 유지, 요청 전 이탈은 POST 안 함), 작곡 추적 등록 순서 수정, 하드코딩 비용 제거, 빈 슬롯 표시, "첫 아티스트 (무료)" 라벨 정정, 지난 영상 무료 칩(공개 곡).
- 앱 2조: 닉네임 편집(서버와 동일 정규화·예약어 규칙), 의상 필터 성별 우선순위(신규는 방금 답)·남/여/전체 칩(female⊃male 오판 방지), 차트 기준 안내, 추천코드 보관(7일)·로그인 화면 입력·소셜 이동 전 보관, 가입 선물 팝업(72h, 계정별 1회), 스타 내역 화면(naive UTC → KST, Hermes 소수 6자리 대응), 본인인증 유도 UI 전면 제거(DM 은 "준비 중·공식 계정 문의" 안내).

**테스트**: tsc 0, 앱 하니스 1조 81 + 2조 184 PASS, v3.229 회귀 42 PASS, 서버 32/32. 배포 전 라이브 7파일 md5 = 기준 원본, 이미지 md5 = 패치본(DM·main.py·admin_stats 원본 유지), 재생성 직전 진행 중 작업 0. 스모크(무쓰기): health 200, 로그 볼륨 재적용 LOGS_W, `[ChartRecovery] done plays=175 owner_excluded_plays=71 hourly_buckets=13`, top100 200 23곡 basis=rolling24h·반복 순서 동일, daily/weekly/monthly 200, identity_verify_required=False·face_verify_enabled=True, Traceback/ERROR 0. hot100 0곡은 현재 1시간 버킷 기준(기존과 동일 동작).
- 미검증: 테스트 계정 토큰이 필요한 닉네임 PATCH 스모크·points/history·face-verify status 실측, 실기기/웹 화면 E2E(이탈 가드의 웹 브라우저 back·iOS 스와이프 한계 포함), 첫 실사용 소셜 가입 팝업 관측.

**특이**
- 롤백: 이미지 `maidol-app:pre-v3230-live`, 파일 `.bak_pre_v3230`, 로그 `maidol-app_pre_v3230_20260925T050226Z.log`. S3 만 되돌리기 = `.env` `IDENTITY_VERIFY_REQUIRED=true` + 재생성.
- 다른 세션이 00:36Z 재기동하며 로그 볼륨을 또 누락 — 이번 재생성에서 복구. 재발 방지 전달 필요.
- 본인인증 우회 상태에서 미성년 판정은 자가 입력 생년월일에만 의존(미입력 시 성인 경로) — 본인인증 도입 전 수용.
- 기존 부풀린 차트 기록은 삭제하지 않음(자연 만료). 가입 경로 닉네임 예약어 변형 차단은 v3.230b 후속 배포.

### v3.230b (2026-09-25) — 가입 닉네임 예약어 변형 차단 (서버 후속 배포)
- 요청: "가입할 때는 "maidol official"이 아직 통과됩니다. <- 이거 막아줘."
- 서버 3파일(services/official.py 공용 `clean_nickname`·`reserved_key`·`is_reserved_nickname`, routes/auth.py 이메일·보호자 가입 적용, routes/oauth.py 소셜 가입 — 예약어 변형이면 `{provider}_{uid8}` 대체 이름). 닉네임 변경과 같은 함수 객체 사용. 기존 가입자 데이터 무변경. 스테이징 37/37.
- 배포: 사용자 1줄 scp(3 OK, `.bak_pre_v3230b`) → 롤백 태그 `maidol-app:pre-v3230b-live`, 로그 `maidol-app_pre_v3230b_*.log` → 빌드(이미지 md5 = 패치본, main.py 유지) → 진행 중 0 확인 → 05:11:24Z 재생성(로그 볼륨 유지).
- 스모크: health 200, 이메일 가입 "maidol official" → 400 `[official] reserved nickname blocked`(계정 미생성), 공용 판정 변형 3종 차단·허용 2종 통과, 채움 문자 제거 확인, Traceback/ERROR 0.
- 미결: 가입 경로 닉네임 길이 제한(현재 무제한, 변경은 2~15자) — 대표 결정 대기.

### v3.230c (2026-09-25) — 가입 닉네임 2~15자 (서버·앱)
- 요청: 가입에도 닉네임 변경과 같은 2~15자 적용(대표 결정 "응응 그렇게 해줘").
- 서버 3파일(official.py 공용 `nickname_rule_reason`·`social_signup_nickname`, auth.py 이메일·보호자 가입 400, oauth.py 소셜 15자 자르기/대체 이름). 스테이징 42/42. 앱(74c7dec): 가입 폼 사전 검사·`n/15` 카운터·서버 문구 표시, 하니스 84/84.
- 배포: 사용자 scp 3 OK(`.bak_pre_v3230c`) → 롤백 태그 `maidol-app:pre-v3230c-live`·로그 보관 → 빌드(이미지 md5 = 패치본, main.py 유지) → 캐릭터 생성 1건 진행 중이라 종료(05:24:41Z)까지 대기 → 05:24:55Z 재생성(로그 볼륨 유지).
- 스모크(계정 미생성): 이메일 가입 1자·16자 → 400 "닉네임은 2~15자로 입력해주세요.", 소셜 판정 함수 18자→15자 자르기·1자/예약어→대체 이름·정상 유지, Traceback/ERROR 0.
- 기존 16자 이상 닉네임 보유자는 무변경(다른 이름으로 바꿀 때만 적용).

## v3.231 (2026-09-25) — 아티스트 만들기 답변 편집·검색 로맨스 포커싱·장르 검색 보강 (PLAN 정본 = PLAN.md `# v3.231`)
**요청**: "아티스트 만들기에서도 다른 디렉터와 마찬가지로 내가 답변한 대답에 대해서 편집할 수 있는 기능이 필요할 것 같은데. 그리고 검색창에 로맨스를 포커싱해줘. 그리고 검색에 장르로도 검색이 되는 상태인건가?"

**답(장르 검색)**: 된다 — ES 키워드 검색에 genre·mood 필드 포함(search_service.py:549) + 벡터 하이브리드, 관련도 순(필터 아님). 빈틈: 한/영 표기 혼재(힙합 2/4, 알앤비 1/3), 비공개→공개 전환 6곡이 ES 에 비공개로 남아 "재즈" 0건(PUT 이 ES 미갱신), 느낌 분류(로맨스 등) 미색인으로 "로맨스" 0건.

**수행 결과**
- 앱 A조: 아티스트 답변 비파괴 편집(말풍선 탭 → 기존 답 채운 입력 + "○○ 답변을 수정 중이에요 [취소]" 배너 → 해당 답만 교체·원위치 복귀, 성별 등 파생값·의상 성별 재계산), 사진 말풍선 탭 = 사진 바꾸기(새 사진 확정 시에만 교체), 실사 최종 확인 단계 + [의상 고르러 가기], Cody 취소 복귀 시 대화 복원, 마지막 질문 버튼 "답변 완료". 범위 밖 보완: 복원 시 실사/캐릭터 종류 동기화, 화풍 확정 시 파생값 계산, 가상 흐름 사진 누락 복귀점. 신규 utils/artistAnswerEdit.ts.
- 앱 B조: 로맨스 칩 맨 앞·진입 시 기본 선택, 안내 문구 "곡 제목, 아티스트, 장르 검색 (예: 로맨스)", 느낌 10종 정확 입력 시 느낌 목록 연결(0건이면 일반 검색 폴백), 자동 포커스 없음·비로그인 차단 선행 유지. 신규 utils/searchMood.ts.
- 서버(2파일): S1 categories 색인 필드(항상 키 포함)·기동 self-heal(공개 id 양방향 대조 → 재색인 + 역방향 문서 비공개/삭제 정리, 재기동 시 0), S2 한/영 장르 별칭(단어 전체 또는 음악 접미어만), S3 PUT 시 색인 필드 변경분 ES 갱신(5초 cap·예외 격리), regex 폴백 genre/mood/categories + re.escape.

**테스트**: tsc 0, 앱 하니스 AE 163·검색 56 + 회귀(v3229·v3230) 전부 PASS, 서버 v3.231 24/24·회귀 42/42. tester 1차 게이트 PASS, Low 3건(L1 역방향 드리프트 재색인 루프·L2 "로맨스ㅁㄴ" 별칭 앞부분 일치·L3 사진 바꾸기 중 재시작 안내 말풍선) 전부 수정·재검증. 배포 전 probe: INFLIGHT 0, ES public 21/Mongo 27, stale 6, reverse 0, categories 매핑 없음.
- 미검증: 폰 웹 E2E(답변 편집 여정·검색 탭), 배포 후 스모크.

**특이**: 관리자 visibility 토글(admin.py:540) ES 미갱신은 범위 밖(다른 세션 소유 파일) — 기동 self-heal 로 보정. 곡 수정 시 벡터 임베딩 재생성·차트 캐시 무효화 없음(기존 공백).
- **서버 배포(06:25:57Z 재생성)**: 사용자 scp 2 OK(`.bak_pre_v3231`) → 롤백 태그 `maidol-app:pre-v3231-live`·로그 `maidol-app_pre_v3231_*.log` → 빌드(이미지 md5 = 패치본, main.py·auth.py 유지) → 진행 중 0 → 재생성(로그 볼륨 유지).
- 기동 self-heal: `public drift es_public=21 mongo_public=27 stale=6 reverse=0` → `reindexed=27 errors=0`. 이후 probe es_public=27/27, categories 27/27, 매핑 categories=True. 재기동 1회 추가 → `reindexed=0 (in sync, skip)`(루프 없음), Traceback/ERROR 0.
- 무쓰기 검색 스모크(`_hybrid_search_core`): 로맨스 10/10(2~12위, 배포 전 0건), 재즈 1/1(1위, 배포 전 0건), 힙합 4/4, 알앤비 3/3, 케이팝 3/3, 트로트·시티팝·댄스·하우스·인디 전부 매치, "로맨스 노래" 12/12(1~12위), "ㅁㄴㅇㄹ" gibberish 0, "로맨스ㅁㄴ" 별칭 미적용(매치 0, 벡터 결과만). 아티스트·가사 회귀 검색 정상. "발라드" 0건은 공개 발라드 곡 부재.

## v3.232 (2026-09-25) — 어린이 모드 1차 (PLAN 정본 = PLAN.md `# v3.232`, 기획서 = 2_housing/어린이모드_기획서.md)
**요청**: "어린이 기획서를 기반으로 앱을 전반적으로 수정해야할 것 같은데. 잘 생각해서 기존 기능에 문제가 절대 없도록 만들어야되. 지금 상태를 체크해서 저장해두고 어린이 기획서를 반영해서 새로운 버전을 만들어줘"

**체크포인트**: git 태그 `checkpoint-pre-kids-20260925`(03a1c8d, push), 서버 이미지 `maidol-app:checkpoint-pre-kids-20260925`(9a0076591bb4), DB 백업 `/home/ubuntu/maidol/backups/pre_v3232_*`(PG 351KB·20 테이블, Mongo 1.2MB).

**실측**: 운영 43명 중 만 13세 미만 0·13세 0, 생년월일 없음 31(72%) → 어린이로 보지 않음(기존 동작). 보호자 동의는 설정 off·발송 mock·동의 페이지 부재 → 이번에 켜지 않음.

**수행 결과 (1차)**
- 서버(17파일, 신규 kids_policy·word_filter·word_filter_ko): `KIDS_MODE_ENABLED` 킬 스위치(기본 off — off 면 DB 조회 0·응답 동일, 추가 키 4종 age_group·kids_restricted·kids_permissions·birth_date_locked), QA 계정 지정, 생년월일 잠금(같은 날짜 다른 표기 허용), 어린이 제한 403 child_restricted(DM 공식 계정만, 사진·음원·얼굴·보이스·실사 생성·피드 글·댓글·공개 전환 등 — 파일 읽기·⭐·잡 이전 가드), 금칙어(자체 목록·어린이만, 주소·학교 보수적), 곡 댓글 신고(전체), 어린이 작사 지시문, 광고·카탈로그 가격·링크 null. fail-open(나이 조회 오류 시 제한 없음 + 에러 로그).
- 앱 1조: kidsMode(판정 = 서버 kids_restricted 하나)·kidsRestricted 공통 인터셉터(이중 팝업 방지·예외 재던짐)·안전 안내·설정 생년월일 잠금·어린이 지역/SNS/사진 업로드 숨김·광고 아동 설정(적용 후에만 로드). 2조: DM 공식 계정만·피드/댓글/사진 첨부 숨김·착장 링크 차단·곡 댓글 신고(전체). 3조: 아티스트 가상만·얼굴 인증/보이스 클론/참고 음원/음원 업로드/커버 배경 사진 숨김·착장 가격·판매처 숨김, 실사 고정 진입은 강등 대신 안내 후 뒤로(대표 승인).
- DB: `reports.target_type` VARCHAR(10)→(20) (대표 실행, 곡 댓글 신고 저장용).

**테스트**: tsc 0, 앱 하니스 g1 191·g2 209·g3 187 + v3228~v3231 회귀 PASS(v3231 AE-U13 1건은 범위 검사 항목, v3229 rename 1건은 기존 실패), 서버 1378/1378(off 동일성 376건·on 비어린이 329건·어린이 94건·금칙어 오탐 세트 131+54) + v3228·v3230·v3231 회귀 PASS. tester 버그 B1(피드 공개 전환 이중 팝업)·B2(DM 이중 팝업)·B3(금칙어 주소 오탐) 수정 재검증.

**배포**: 사용자 DB 백업·코드 17 OK(`.bak_pre_v3232`) → 롤백 태그 `pre-v3232-live`·로그 보관 → 빌드(이미지 md5 = 패치본, main.py 유지) → 진행 중 0 → 09:55:49Z 재생성(킬 스위치 off, 로그 볼륨 유지). 스모크: health 200, 어린이 관련 로그 0줄(off 에서 신규 코드 미실행), errors 0·5xx 0, probe kids_mode_enabled=False·is_child 0, 비로그인 공개 응답(곡 목록·카테고리·공식 계정) 해시 동일, 광고 active 는 원래 무작위 정렬(500건·키 동일), 차트는 재기동 재계산으로 값 변동(차트 코드 무변경). 웹 배포(AppEntry-30b04f6d…) 코드 반영 확인.

**남은 것(2차·외부)**: QA 계정 지정 + 킬 스위치 on 검증(대표 승인·.env), 보호자 동의 실발송·본인확인 업체, 보호자 관리 페이지, 소셜 가입 연령 확인, 처리방침·약관 개정(법무), Play Console 제출, 광고 ID 미전송 실기기 확인, 생년월일 없던 계정의 첫 입력으로 어린이 전환 경로(보호자 절차 없음), 금칙어 한글 숫자 전화번호 미검출.

## v3.233 (2026-09-26) — 보호자 관리 API·심사용 계정·소통 경로 금칙어·어린이 모드 ON (PLAN 정본 = PLAN.md `# v3.233`, 사양 = 2_housing/백엔드_요청_보호자관리.md)
**요청**: "지금 google play 어른 계정이 있으니까 그걸 기반으로 어린이 계정하나 만들자." / 보호자 관리 API·심사용 관리 링크 절차(붙여넣기) / "어른계정은 playreview@lotusai.co.kr 로 만들어줘. 바로 진행해줘." / 금칙어를 모든 사용자 DM·댓글에 / "별 100개 넣고 금칙어도 같이 켜줘."

**수행 결과**
- 서버(수정 13·신규 2, main.py 무변경 — referral.py public_router 에 결합): `guardian_manage` 테이블(자녀당 1행), `/api/guardian/manage/{token}` GET·otp·otp/verify·settings PUT·revoke·delete-request(OTP 6자리 5분·1시간 5회·5회 오답 폐기, 세션 Redis 30분 토큰 결속, otp_exempt 는 스크립트 전용), decide 동의 시 manage_token 발급(mock 응답 manage_url), 동의 링크 `https://maidol.ai.kr/guardian/?token=`, 보호자 설정 → kids_permissions(feed_post→feed_write·comment, dm_friends → 맞팔 DM 즉시 accepted), revoke → suspended(이메일·소셜 로그인·기존 JWT 403 account_suspended), 삭제 요청 → issue_reports, admin 목록·재발송 API, `WORD_FILTER_SOCIAL_ALL_USERS`(성인 DM·피드 글·댓글·곡 댓글 — 욕설·성적·혐오만), 금칙어 어절 경계 매칭(오탐 수정), 철회된 동의 링크 409, access log 토큰 마스킹.
- 앱(d31f68e): 맞팔 DM(공식 + 맞팔, 새 대화는 맞팔 목록), feed_post 허용 시 글·댓글, account_suspended 공통 안내(로그인·소셜 #error·인터셉터), 어린이만 복귀·DM 진입 시 /auth/me 권한 갱신(30초).
- 테스트: 서버 217/217 + 스크립트 21/21 + v3.228·v3.230·v3.231 회귀 PASS(v3.232 스위트 3건은 범위 고정 검사 — 의도), 성인 오탐 194문장 적중 0·차단 100/100, 앱 하니스 312/312 + v3.232 g1·g3 PASS. tester 버그(금칙어 오탐·권한 즉시 반영·철회 링크·IFS) 수정 재검증.

**배포(2026-09-25T23:17Z / ON 23:20Z)**: DB 백업 `pre_v3233_*` → 스키마(guardian_manage) → 코드 15 OK(`.bak_pre_v3233`) → 롤백 태그 `pre-v3233-live` → 빌드·재생성(off) 스모크(health·오류 0·공개 응답 해시 동일·관리 API 404/401·CORS·마스킹) → 심사용 계정 생성(대표 터미널, 비밀번호 숨김 입력): 성인 `playreview@lotusai.co.kr`(41aea541), 어린이 `playreview_child@lotusai.co.kr`(bb6a1759, 만 10세, 보호자 동의 agreed mock, guardian_manage otp_exempt) → 어린이 ⭐100 지급(admin_grant, note review_child_seed_v3233) → `.env` KIDS_MODE_ENABLED=true·WORD_FILTER_SOCIAL_ALL_USERS=true(`.env.bak_pre_v3233_kids`) → 재생성. 확인: is_child n=1(심사용 어린이만), 관리 링크 GET 200(인증 없이, age 10·settings 모두 false), 오류 0, 공개 응답 동일.

**남은 것**: Play Console 로그인 세부정보(성인·어린이 계정 + 관리 링크 + 영어 안내문), 보호자 동의 실발송·본인확인 업체(실제 어린이 가입은 여전히 불가), 소셜 가입 연령 확인, 처리방침·약관 개정, nginx access.log 토큰 잔존, 심사자가 "동의 철회" 시 복구 1줄(DEPLOY §4-5), 앱 APK 반영.

## v3.234·v3.235·v3.236 (2026-09-26) — "집으로" 스타일링·모든 옷 변경 경로 착장 반영·⋯ 공유하기·링크 즉시 재생·휴식 일괄 단축 (PLAN 정본 = PLAN.md `# v3.234`·`# v3.235`·`# v3.236`)
**요청**: "방금 생성한 집으로 라는 곡에서 아티스트 옷을 갈아입힌것 같은데. 스타일링 정보에 반영이 안되어있네?" / "아티스트를 생성하고 나서는 휴식중이라고 떠야하는데 이어서 하기가 떠" / "아티스트 페이지에서 아티스트 꾸미기로 옷을 바꾸든, 작곡하는 과정에서 옷을 바꿔서 만들던 커버 이미지 만들때 이미지 디렉터와의 대화에서 옷을 갈아입던 아티스트 착장에 반영… 공유 버튼… 공유한 링크로 들어오면 해당 곡이 바로 재생" (정정: "차트나 마이페이지에서 … 점 세개 눌러서") / "휴식 디렉터 별 차감할때 … 스타가 총 얼마 필요한지가 나오고 내가 얼마만큼 스타를 써서 시간을 줄일껀지 정해서"
**원인**: 곡 스타일링은 발매 순간 1회 스냅샷 — 커버 흐름은 발매 후 커버 대화 중 '의상 바꾸러 가기'가 가능한데 커버 적용(PUT /tracks) 이 스냅샷 미갱신("집으로" 확정 1곡). 작곡 중 옷 입히기가 발매보다 늦게 끝나면 옛 옷 고정. 커버 인물이 곡 아티스트가 아닌 대표 아티스트, 의상 바꾸기 대상 미전달, 완료 후 커버 미복귀. 아티스트 완료 경로(finalizeArtistJob)가 draft 미정리 → "이어서 하기" 잔존. 공유 링크 경로 서버 부재(404), ⋯ 공유 숨김(v3.221). 휴식 단축 30분 단건·팝업 설명 과다.
**수행 결과**
- 서버(v3.234 S1~S4 + v3.235 S5~S8 + v3.236): 커버 생성 시 착장 기록·커버 적용/보관함 발매 시 스타일링 교체(가을산 밤바람 보호), 발매 후 완료되는 옷 입히기 24h 추적 반영(track_outfit_follows), `/tracks/my` character_id 보장, 공유 랜딩 `GET/HEAD /track/{id}`(OG·앱 이동·aidol://, 비공개/없음 404 바이트 동일·XSS 안전·닉네임 미노출) + `/track/{id}/og.jpg` 1200×630(요청마다 공개 재확인), `POST /api/fatigue/skip-bulk`(요청 ID 멱등·상한·원자 차감·환불·가격 확인) + status additive 3키. main.py 무변경.
- 앱(1638d9b, 9c5817f): 아티스트 완료 시 연결 draft 정리, 커버 인물=곡 아티스트·의상 바꾸기 대상 고정·완료 후 커버 복귀·옷 입히는 중 확인, 공용 ⋯ '공유하기'(비공개 곡 공개 확인), `?track=`/`aidol://track` 즉시 재생(로그인 복원 후, 재생목록 append, 자동재생 차단 탭 오버레이, 튜토리얼 생략), 휴식 팝업 개편(남은 시간·전부 ⭐·보유 ⭐, −/+·전부, 1회 확정, 구서버 404 폴백).
**테스트**: 서버 v3.234 140·v3.235 162·v3.236 139 + 회귀(v3.228·230·231·233 전부, v3.232 기능 전부 — 범위 고정 검사 3건 의도), 앱 tsc 0 · 하니스 v3234 62·v3235 g1 131·g2 168·v3236 118 + 회귀. 통합 게이트 PASS(차단 0, Low 3: 링크 소비 중 새 링크 재시도 없음·og 클라이언트 캐시 1일·원본 크기 상한 읽은 뒤 검사).
**배포(대표 모바일 — 오케스트레이터 실행 지시)**: v3.235 코드 6 OK(`.bak_pre_v3235`)·v3.236 코드 4 OK(`.bak_pre_v3236`) → 롤백 태그 `pre-v3235-live`·로그 보관 → 빌드(이미지 md5 = 두 배포본) → 곡 생성 1건 완료 대기(13:41:24Z) → 13:41:43Z 재생성(로그 볼륨). 스모크: health·오류 0, 공개 곡 랜딩 200(og:image·앱 이동 URL), 비공개·없는 id 404 바이트 동일, og.jpg 200 54KB·비공개 302, skip-bulk 무인증 401, /invite 200. "집으로" 소급(대표 승인 "다른계정 곡이야 집으로 근데 수정해야되"): applied=1 errors=0, 재 dry-run 0, 공개 GET 착장 = 후디·핀턱 팬츠·AF1·드로스트링 백(undo 줄은 logs/v3235_backfill_*.log). 웹 배포(AppEntry-5cc0d38e…) 반영 확인.
**남은 것**: 카카오 공유 디버거로 미리보기 카드 확인(대표), 실기기 E2E(링크 자동재생·커버 의상 복귀·휴식 팝업 16곳), 앱 링크 연동(App Links)은 스토어 등록 후, 네이티브 빌드(v1.3.1) 반영.
