# 2_housing - 모바일 오피스 앱 계획서

## 1. 프로젝트 개요

음악 제작 회사 오피스를 모바일 타일맵으로 구현하고, 5명의 AI 디렉터 캐릭터와 대화하여 음악 제작 서비스를 실행하는 앱.

### 핵심 흐름
```
오피스 맵 진입 → 캐릭터 탐색/클릭 → 대화 UI → 대화 종료 → 백엔드 서비스 실행 → (광고 시청 시 시간 단축) → 결과 수령
```

---

## 2. 오피스 맵 구조 (office.tmx - 22x69 타일)

한 층에 위에서 아래로 6개의 방이 나열된 구조:

| 순서 | 방 | 디렉터 | 역할 | 백엔드 서비스 |
|------|-----|--------|------|--------------|
| 방1 | 아티스트룸 | 아티스트 디렉터 | 아티스트 생성 | 신규 API 개발 필요 (아티스트 프로필/페르소나 생성) |
| 방2 | 작사실 | 작사 디렉터 | 가사 작성 | `POST /api/generate/lyrics` (OpenAI GPT-4o-mini) |
| 방3 | 작곡실 | 작곡 디렉터 | 음악 제작 | `POST /api/generate/` (Suno API V5) |
| 방4 | 이미지실 | 이미지 디렉터 | 앨범 자켓 + MV 씬 이미지 | Gemini 이미지 생성 |
| 방5 | 영상실 | 영상 디렉터 | 뮤직비디오 제작 | `POST /api/mv/submit` (Kling + FFmpeg) |
| 방6 | 홍보실 | (추후 개발) | 홍보/마케팅 | 추후 백엔드 작업 예정 |

### 맵 레이어 (10개)
바닥 → 걸레받이 → 걸레받이 세로 → 벽뒤가구 → 벽 → 가구1~5

---

## 3. 5명의 AI 디렉터 상세

### 3-1. 아티스트 디렉터 (방1)
- **역할**: AI 아티스트 캐릭터를 생성/관리
- **대화 내용**: 아티스트 이름, 장르, 성격, 음악 스타일 등 설정
- **서비스**: 신규 백엔드 API 개발 필요
  - `POST /api/artist/create` - 아티스트 생성
  - `GET /api/artist/` - 아티스트 목록
  - `GET /api/artist/{id}` - 아티스트 상세
  - `PUT /api/artist/{id}` - 아티스트 수정
  - `DELETE /api/artist/{id}` - 아티스트 삭제

### 3-2. 작사 디렉터 (방2)
- **역할**: AI 가사 생성
- **대화 내용**: 주제, 분위기, 감정, 스타일
- **서비스**: 기존 `POST /api/generate/lyrics` (OpenAI GPT-4o-mini)

### 3-3. 작곡 디렉터 (방3)
- **역할**: AI 음악 생성
- **대화 내용**: 장르, 분위기, 보컬 스타일, BPM
- **서비스**: 기존 `POST /api/generate/` (Suno API V5)
- **보컬 옵션**: male_warm, male_powerful, male_husky, male_soft, female_warm, female_powerful, female_husky, female_sweet

### 3-4. 이미지 디렉터 (방4)
- **역할**: 앨범 자켓 사진 + MV 씬 이미지 디자인
- **대화 내용**: 비주얼 컨셉, 스타일, 색감, 분위기
- **서비스**:
  - 앨범 자켓: Gemini 이미지 생성 (text-to-image)
  - MV 씬: MV Pipeline 내 씬 이미지 생성 (씬 분할 + Gemini)

### 3-5. 영상 디렉터 (방5)
- **역할**: 뮤직비디오 최종 영상 제작
- **대화 내용**: 영상 스타일, 카메라 무브먼트, 편집 방향
- **서비스**: 기존 `POST /api/mv/submit` (Kling 영상 생성 + FFmpeg 편집)

---

## 4. 캐릭터 에셋

### 에셋 출처
| 에셋 | 출처 |
|------|------|
| Modern Interiors (타일셋, 스프라이트) | https://limezu.itch.io/moderninteriors |
| 캐릭터 제너레이터 툴 | https://0a3r.itch.io/modern-interiors-character-generation-tool |

### 캐릭터 생성 방법
- 캐릭터 제너레이터 툴은 Windows/Linux 빌드만 존재 (Mac 미지원)
- Tiled는 맵 에디터이므로 캐릭터 생성 불가
- **Piskel (https://www.piskelapp.com)** 을 사용하여 브라우저에서 직접 생성
  - 설치 불필요, 픽셀 아트 전용, 레이어 지원
  - 조합 순서: Body → Eyes → Outfit → Hairstyle → Accessory
  - 파츠 위치: `/TripleJ/moderninteriors-win/2_Characters/Character_Generator/`

### 프리메이드 캐릭터 (임시 사용 가능)
- 위치: `/TripleJ/moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/32x32/`
- 20개 캐릭터 스프라이트 시트 보유
- 커스텀 캐릭터를 만들기 전까지 플레이스홀더로 활용

### 각 디렉터별 캐릭터 생성 필요 항목
| 디렉터 | 외형 컨셉 (제안) |
|--------|-----------------|
| 아티스트 디렉터 | 트렌디한 패션, 액세서리 |
| 작사 디렉터 | 안경, 책/노트 |
| 작곡 디렉터 | 헤드폰, 캐주얼 |
| 이미지 디렉터 | 베레모, 아티스틱한 의상 |
| 영상 디렉터 | 모자/캡, 카메라 소품 |

---

## 5. 기술 스택

### 모바일 앱
| 항목 | 기술 |
|------|------|
| 프레임워크 | React Native (Expo) |
| 언어 | TypeScript |
| 타일맵 렌더링 | react-native-skia 또는 Canvas |
| 상태관리 | Zustand |
| API 통신 | Axios |
| 실시간 통신 | WebSocket (기존 office-game-api 활용) |
| 광고 | react-native-google-mobile-ads (AdMob) |
| 네비게이션 | React Navigation |

### 기존 백엔드 연동
| 서비스 | 포트 | 용도 |
|--------|------|------|
| minihompi-api | 8000 | 유저, 인증, 소셜 기능 |
| office-game-api | 8001 | Generative Agent, WebSocket |
| 0_platform_music | - | 음악/이미지/영상 생성 AI |

---

## 6. 앱 화면 구성

### 화면 목록
```
1. 스플래시/로딩
2. 로그인/회원가입
3. 오피스 맵 (메인) - 6개 방을 위아래로 스크롤하며 탐색
   └── 캐릭터 탭 → 대화 UI 오버레이
4. 대화 화면 (채팅 UI)
   └── 대화 종료 → 서비스 파라미터 확정
5. 서비스 실행 화면 (프로그레스 바 + 광고 시청 버튼)
6. 결과 화면 (음악 재생 / 이미지 뷰어 / 영상 플레이어)
7. 마이페이지 (생성 이력, 아티스트 관리, 설정)
```

### 화면 흐름
```
[오피스 맵 - 위에서 아래로 스크롤]
    │
    ├── 방1 아티스트 디렉터 ──→ [대화] ──→ 아티스트 생성 API
    ├── 방2 작사 디렉터 ──→ [대화] ──→ 가사 생성 (OpenAI)
    ├── 방3 작곡 디렉터 ──→ [대화] ──→ 음악 생성 (Suno)
    ├── 방4 이미지 디렉터 ──→ [대화] ──→ 자켓/씬 이미지 (Gemini)
    ├── 방5 영상 디렉터 ──→ [대화] ──→ MV 생성 (Kling)
    └── 방6 홍보실 ──→ (추후 개발)
```

---

## 7. 광고 시스템 설계

### 작동 방식
```
서비스 실행 시작 (예: 음악 생성 예상 5분)
    │
    ├── 기본: 프로그레스 바 표시 (백엔드 실제 처리 시간)
    │
    └── 광고 버튼: "광고를 보고 대기 시간을 줄이세요!"
         ├── 보상형 광고 (Rewarded Ad) 시청
         └── 시청 완료 → 시간 단축 효과 적용
```

### 구현 방식
**Phase 1: 클라이언트 타이머 단축**
- 광고 시청 시 대기 UI를 숨기고 백그라운드 처리
- 결과 준비 시 푸시 알림

**Phase 2: 서버 우선순위 큐 (추후 확장)**
- 광고 시청 → 서버 우선 처리 요청
- 백엔드에 priority 큐 추가

---

## 8. 신규 백엔드 개발 항목

### 8-1. 아티스트 API (신규)
```
POST   /api/artist/create     - 아티스트 생성
GET    /api/artist/            - 아티스트 목록
GET    /api/artist/{id}        - 아티스트 상세
PUT    /api/artist/{id}        - 아티스트 수정
DELETE /api/artist/{id}        - 아티스트 삭제
```

### 8-2. 기존 백엔드 수정
| 서비스 | 수정 내용 |
|--------|----------|
| 전체 | CORS에 모바일 앱 origin 추가 |
| office-game-api | 모바일 WebSocket 호환 확인 |
| 프로덕션 | HTTPS 적용 필요 |

### 8-3. 홍보실 API (추후)
- 추후 별도 기획 후 개발

---

## 9. 추가 타일맵 필요 여부

### 결론: 현재 맵으로 충분
- 이미 6개 방이 각 디렉터 + 홍보실로 잘 구성됨
- 위→아래 스크롤 방식으로 모바일에 적합
- 추가 맵 불필요

### 향후 확장 시 고려
- 로비/대기실 (앱 최초 진입 화면으로 활용 가능)
- 홍보실 내부 디테일 (방6 기획 시)

---

## 10. 개발 단계

### Phase 1: 기본 세팅
- [ ] Piskel에서 5명 디렉터 캐릭터 스프라이트 생성 (Body+Eyes+Outfit+Hairstyle+Accessory)
- [ ] Expo 프로젝트 초기화
- [ ] React Navigation 구조 세팅
- [ ] 기존 백엔드 API 연결 (인증, 유저)
- [ ] CORS 설정 업데이트

### Phase 2: 타일맵 렌더링
- [ ] TMX 파서 구현 (XML → JSON)
- [ ] 타일맵 렌더러 (Canvas/Skia)
- [ ] 카메라 시스템 (세로 스크롤, 줌)
- [ ] 캐릭터 스프라이트 배치 및 애니메이션
- [ ] 캐릭터 탭 인터랙션 (터치 이벤트)

### Phase 3: 대화 시스템
- [ ] 채팅 UI 구현 (말풍선, 입력창)
- [ ] Generative Agent 시스템 연동 (WebSocket)
- [ ] 대화 → 서비스 파라미터 추출 로직
- [ ] 디렉터별 대화 시나리오

### Phase 4: 백엔드 서비스 연동
- [ ] 아티스트 생성 API 개발 (신규)
- [ ] 가사 생성 (OpenAI) 연동
- [ ] 음악 생성 (Suno) 연동
- [ ] 이미지 생성 (Gemini) 연동 - 자켓 + 씬
- [ ] 영상 생성 (Kling) 연동
- [ ] 진행 상태 표시 (프로그레스 바)

### Phase 5: 광고 및 수익화
- [ ] AdMob 연동 (보상형 광고)
- [ ] 광고 시청 → 시간 단축 로직
- [ ] 결과 화면 (음악 재생, 이미지 뷰어, 영상 플레이어)

### Phase 6: 폴리싱 및 배포
- [ ] UI/UX 개선
- [ ] 홍보실 백엔드 개발
- [ ] 앱스토어 배포 준비 (iOS/Android)

---

## 11. 디렉토리 구조

```
2_housing/
├── assets/
│   ├── tilesets/           # 타일셋 이미지 (PNG) ✅ 복사 완료
│   ├── maps/               # TMX, TSX 파일 ✅ 복사 완료
│   ├── sprites/            # 디렉터 캐릭터 스프라이트 (Piskel로 생성 후 추가)
│   └── ui/                 # UI 에셋 (채팅 버블, 버튼 등)
├── app/                    # Expo Router 페이지
│   ├── (auth)/             # 로그인/회원가입
│   ├── (main)/             # 메인 탭
│   │   ├── office.tsx      # 오피스 맵 화면 (6개 방)
│   │   ├── mypage.tsx      # 마이페이지
│   │   └── results.tsx     # 생성 결과 목록
│   └── chat/[director].tsx # 디렉터별 대화 화면
├── components/
│   ├── map/                # 타일맵 렌더러
│   ├── chat/               # 채팅 UI
│   ├── character/          # 캐릭터 컴포넌트
│   ├── ads/                # 광고 컴포넌트
│   └── common/             # 공통 UI
├── services/
│   ├── api.ts              # 백엔드 API 클라이언트
│   ├── websocket.ts        # WebSocket 연결
│   └── tmxParser.ts        # TMX 파일 파서
├── stores/                 # Zustand 상태 관리
├── types/                  # TypeScript 타입 정의
├── PLAN.md                 # 이 계획서
├── app.json                # Expo 설정
├── package.json
└── tsconfig.json
```

---

## v2 - 2026-04-08 - 프론트엔드 API 연동 및 대화형 UI 구현

> **목표**: 작사 디렉터와의 RPG 스타일 대화를 통해 가사를 생성하고, 이어서 작곡 디렉터(Suno/Wondera 2명) 선택 후 음악을 생성하는 전체 플로우를 구현한다. 모든 메뉴와 기능을 빠짐없이 포함한다.

---

### Phase 1: 프로젝트 구조 설정

#### 1-1. 의존성 추가

현재 `package.json`에는 기본 Expo 의존성만 있으므로 아래 패키지를 설치한다:

```bash
npx expo install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
npm install axios zustand
npm install expo-audio expo-file-system expo-document-picker expo-image-picker
npm install -D @types/react-native
```

| 패키지 | 용도 |
|--------|------|
| `@react-navigation/native` + `native-stack` | 화면 간 네비게이션 (맵 → 대화 → 폼 → 결과) |
| `react-native-screens`, `react-native-safe-area-context` | React Navigation 필수 피어 의존성 |
| `axios` | 백엔드 API 통신 (FastAPI 서버) |
| `zustand` | 글로벌 상태 관리 (작사/작곡 플로우 데이터, 사용자 설정) |
| `expo-audio` | 생성된 음악 미리듣기 재생 |
| `expo-file-system` | 레퍼런스 음악 파일 업로드 처리 |
| `expo-document-picker` | 레퍼런스 음악 파일 선택 |
| `expo-image-picker` | 카메라/갤러리 접근 (향후 확장) |

#### 1-2. 폴더 구조 생성

현재 구조에서 아래 폴더/파일을 추가:

```
2_housing/
├── screens/                        # 화면 컴포넌트 (신규)
│   ├── MapScreen.tsx               # 기존 App.tsx 리팩토링
│   ├── DialogueScreen.tsx          # RPG 스타일 대화 화면
│   ├── LyricsInputScreen.tsx       # 작사 세부 입력 폼
│   ├── LyricsPromptReviewScreen.tsx # 프롬프트 확인/수정
│   ├── LyricsLoadingScreen.tsx     # 가사 생성 로딩
│   ├── LyricsResultScreen.tsx      # 생성된 가사 확인/수정
│   ├── ComposerSelectScreen.tsx    # Suno vs Wondera 작곡가 선택
│   ├── MusicGenerationScreen.tsx   # 작곡 입력 폼
│   ├── MusicLoadingScreen.tsx      # 음악 생성 로딩
│   └── MusicResultScreen.tsx       # 생성된 음악 확인/재생
├── services/                       # API 서비스 레이어 (신규)
│   ├── api.ts                      # Axios 인스턴스 (Base URL, 인터셉터)
│   ├── lyricsService.ts            # 가사 생성 API
│   ├── musicService.ts             # Suno + Wondera 음악 생성 API
│   └── voiceService.ts             # 보컬 모델 목록 + 음성 변환 API
├── stores/                         # Zustand 상태 관리 (신규)
│   ├── useLyricsStore.ts           # 작사 플로우 전체 상태
│   ├── useMusicStore.ts            # 작곡 플로우 전체 상태
│   └── useDialogueStore.ts         # 대화 시스템 상태
├── types/                          # TypeScript 타입 정의 (신규)
│   ├── lyrics.ts                   # 가사 관련 타입
│   ├── music.ts                    # 음악 관련 타입
│   ├── dialogue.ts                 # 대화 시스템 타입
│   └── api.ts                      # API 응답 타입
├── data/                           # 정적 대화 스크립트 (신규)
│   ├── lyricistDialogue.ts         # 작사 디렉터 대화 스크립트
│   ├── composerIntroDialogue.ts    # 작사→작곡 연결 대화 스크립트
│   ├── sunoComposerDialogue.ts     # Suno 작곡 디렉터 대화 스크립트
│   └── wonderaComposerDialogue.ts  # Wondera 작곡 디렉터 대화 스크립트
├── components/                     # 기존 + 추가
│   ├── Character.tsx               # (기존)
│   ├── SpriteAnimator.tsx          # (기존)
│   ├── dialogue/                   # 대화 UI 컴포넌트 (신규)
│   │   ├── DialogueBox.tsx         # 대화창 (텍스트 + 타이핑 애니메이션)
│   │   ├── DialogueChoices.tsx     # 선택지 버튼 그룹
│   │   ├── CharacterPortrait.tsx   # 디렉터 초상화 표시
│   │   └── TypingIndicator.tsx     # 타이핑 중 인디케이터 (...)
│   ├── lyrics/                     # 작사 관련 UI (신규)
│   │   ├── GenreSelector.tsx       # 장르 선택 (가요/클래식/BGM 등)
│   │   ├── MoodSelector.tsx        # 분위기 선택
│   │   └── PromptEditor.tsx        # 프롬프트 텍스트 편집기
│   └── music/                      # 작곡 관련 UI (신규)
│       ├── VocalSelector.tsx       # 보컬 스타일/모델 선택
│       ├── ReferenceUploader.tsx   # 레퍼런스 음악 업로드/녹음
│       └── AudioPlayer.tsx         # 음악 재생 플레이어
└── App.tsx                         # NavigationContainer 래퍼로 변경
```

#### 1-3. App.tsx 리팩토링

현재 `App.tsx`에 있는 맵 렌더링 + 모달 코드를 `screens/MapScreen.tsx`로 이동한다. `App.tsx`는 `NavigationContainer`와 `Stack.Navigator`만 포함하도록 변경:

```typescript
// App.tsx (변경 후)
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Map" component={MapScreen} />
        <Stack.Screen name="Dialogue" component={DialogueScreen} />
        <Stack.Screen name="LyricsInput" component={LyricsInputScreen} />
        <Stack.Screen name="LyricsPromptReview" component={LyricsPromptReviewScreen} />
        <Stack.Screen name="LyricsLoading" component={LyricsLoadingScreen} />
        <Stack.Screen name="LyricsResult" component={LyricsResultScreen} />
        <Stack.Screen name="ComposerSelect" component={ComposerSelectScreen} />
        <Stack.Screen name="MusicGeneration" component={MusicGenerationScreen} />
        <Stack.Screen name="MusicLoading" component={MusicLoadingScreen} />
        <Stack.Screen name="MusicResult" component={MusicResultScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

---

### Phase 2: 네비게이션 & 화면 구조

#### 2-1. 전체 화면 플로우

```
[MapScreen] ─── 작사 디렉터 탭 ───→ [DialogueScreen (lyricist)]
                                          │
                                    대화로 기본 정보 수집
                                    (장르, 분위기, 주제 등)
                                          │
                                          ▼
                                    [LyricsInputScreen]
                                    폼으로 세부 입력 확인/수정
                                    (장르, 무드, 가사 내용, 템포,
                                     언어, 곡 길이, 랩 여부)
                                          │
                                          ▼
                                    [LyricsPromptReviewScreen]
                                    완성된 프롬프트 확인/편집
                                          │
                                          ▼
                                    [LyricsLoadingScreen]
                                    가사 생성 중 로딩 화면
                                    (디렉터 애니메이션 + 프로그레스)
                                          │
                                          ▼
                                    [LyricsResultScreen]
                                    생성된 가사 확인/수정
                                          │
                                    "작곡하러 가기" 버튼
                                          │
                                          ▼
                                    [ComposerSelectScreen]
                                    작사 디렉터가 두 작곡가 소개
                                    (Suno 작곡가 vs Wondera 작곡가)
                                          │
                                    사용자 선택
                                          │
                                          ▼
                                    [DialogueScreen (suno/wondera)]
                                    선택한 작곡가와 대화
                                          │
                                          ▼
                                    [MusicGenerationScreen]
                                    작곡 세부 입력
                                    (가사 자동 전달, 장르/무드/템포 자동 전달,
                                     보컬 선택, 레퍼런스 음악 업로드)
                                          │
                                          ▼
                                    [MusicLoadingScreen]
                                    음악 생성 중 로딩 화면
                                          │
                                          ▼
                                    [MusicResultScreen]
                                    생성된 음악 재생/다운로드
```

#### 2-2. 각 화면 상세 명세

##### MapScreen (기존 App.tsx 리팩토링)
- **역할**: 오피스 맵을 렌더링하고 5명의 디렉터 캐릭터를 배치. 캐릭터 탭 시 해당 디렉터의 DialogueScreen으로 navigation.navigate() 호출
- **기존 코드**: 현재 `App.tsx`의 맵 이미지 + ScrollView + Character 컴포넌트 + Modal을 그대로 이동
- **변경점**: Modal 대신 `navigation.navigate('Dialogue', { directorType: 'lyricist' })` 호출로 변경
- **캐릭터 6명**: 기존 5명 + **Suno 작곡 디렉터** 추가 (방2에 2명의 작곡 디렉터를 배치하거나, ComposerSelectScreen에서만 등장)
  - 참고: 맵 상에는 기존 5명만 표시하고, Suno/Wondera 작곡가는 ComposerSelectScreen에서 선택하는 방식 채택 (맵 변경 최소화)

##### DialogueScreen (RPG 스타일 대화 화면)
- **역할**: 비주얼 노벨 스타일 대화 UI. JSON 기반 스크립트를 순서대로 재생
- **params**: `{ directorType: DirectorType, scriptId: string }`
- **UI 구성**:
  - 상단 70%: 맵 배경 블러 또는 단색 배경 + 디렉터 전신 일러스트/초상화
  - 하단 30%: 대화창 (이름 + 텍스트 + 타이핑 애니메이션)
  - 선택지가 있을 경우: 대화창 위에 버튼 2~4개 표시
- **동작**:
  1. 화면 진입 시 해당 디렉터의 대화 스크립트 로드
  2. 텍스트를 한 글자씩 타이핑 효과로 표시 (탭하면 즉시 전체 표시)
  3. 선택지 응답 시 다음 대화로 분기
  4. 스크립트 종료 시 다음 화면으로 navigate (작사→LyricsInputScreen, 작곡→MusicGenerationScreen)
- **수집 데이터**: 대화 중 선택한 값들을 Zustand 스토어에 저장

##### LyricsInputScreen (항목 22 - 작사 세부 입력 폼)
- **역할**: 대화에서 수집한 기본값을 폼으로 보여주고, 사용자가 수정/보완할 수 있게 함
- **입력 항목** (모든 메뉴 빠짐없이 포함):

| 필드 | 타입 | 선택지/설명 |
|------|------|------------|
| 장르 (genre) | 선택 | 가요, 클래식, BGM, 팝, 힙합, R&B, 록, 일렉트로닉, 재즈, 컨트리, 기타 |
| 분위기 (mood) | 선택 | 밝은, 슬픈, 신나는, 잔잔한, 몽환적, 강렬한, 감성적, 기타(직접입력) |
| 가사 내용/주제 (content) | 텍스트 | 자유 입력 - "어떤 내용의 가사를 원하시나요?" |
| 템포 (tempo) | 선택 | 느린(Slow), 보통(Medium), 빠른(Fast) |
| 언어 (language) | 선택 | 한국어, 영어, 일본어, 중국어, 혼합(한영) |
| 곡 길이 (duration) | 선택 | 짧은(1~2분), 보통(3~4분), 긴(5분+) + 실현가능성 체크 메시지 |
| 랩 포함 여부 (includeRap) | 토글 | "랩 파트를 포함하시겠습니까?" ON/OFF |

- **실현가능성 체크**: 곡 길이가 "긴(5분+)"이고 템포가 "빠른"이면 경고 메시지 표시 ("빠른 템포의 긴 곡은 가사 양이 매우 많아질 수 있습니다")
- **하단 버튼**: "프롬프트 생성" → LyricsPromptReviewScreen으로 이동

##### LyricsPromptReviewScreen (항목 23 - 프롬프트 확인/수정)
- **역할**: 수집된 입력값을 바탕으로 자동 생성된 API 프롬프트를 사용자에게 보여줌
- **UI**:
  - 상단: 디렉터 초상화 + "이렇게 작성해볼게요!" 대화 버블
  - 중앙: 생성된 프롬프트 텍스트 (TextInput으로 편집 가능)
  - 프롬프트 예시: `"밝고 신나는 분위기의 한국어 팝 노래. 주제: 여름 바다 여행. 템포: 보통. 랩 파트 포함. 3~4분 길이."`
  - 하단: "수정 완료 → 가사 생성 시작" 버튼
- **프롬프트 자동 조립 로직**: `stores/useLyricsStore.ts`에서 모든 입력값을 조합하여 자연어 프롬프트 문자열 생성
- **API 매핑**: 이 프롬프트가 `POST /api/generate/lyrics/`의 `prompt` 파라미터로 전송됨

##### LyricsLoadingScreen (항목 23.5 - 로딩 화면)
- **역할**: 가사 생성 API 호출 중 대기 화면
- **UI**:
  - 디렉터 캐릭터 작업 중 애니메이션 (스프라이트 'read' 애니메이션 반복)
  - "열심히 가사를 쓰고 있어요..." 텍스트 (타이핑 애니메이션)
  - 프로그레스 인디케이터 (스피너 또는 도트 애니메이션)
  - 예상 소요 시간 표시
- **API 호출**: `POST /api/generate/lyrics/` → `{ prompt, genre, mood, language }`
- **완료 시**: 자동으로 LyricsResultScreen으로 이동

##### LyricsResultScreen (항목 24 - 가사 결과 확인/수정)
- **역할**: 생성된 가사를 표시하고 사용자가 수정할 수 있음
- **UI**:
  - 상단: 디렉터 초상화 + "완성된 가사입니다!" 대화 버블
  - 중앙: 가사 텍스트 (ScrollView + TextInput으로 편집 가능)
  - 가사 섹션 구분 표시 ([Verse 1], [Chorus], [Bridge] 등)
  - 하단 버튼 3개:
    1. "다시 생성" → LyricsLoadingScreen으로 돌아가 재생성
    2. "가사 수정 완료" → 수정된 가사를 스토어에 저장
    3. "작곡하러 가기 →" → ComposerSelectScreen으로 이동 (가사 + 장르/무드/템포 데이터 전달)

##### ComposerSelectScreen (항목 25, 26 - 작곡가 선택)
- **역할**: 작사 디렉터가 두 명의 작곡 디렉터를 소개하는 화면
- **UI**:
  - 상단: 작사 디렉터 대화 ("가사가 완성됐으니, 이제 작곡가를 선택해주세요!")
  - 중앙: 두 작곡가 카드 나란히 배치:
    - **Suno 작곡가**: 초상화 + 이름 + 설명 ("다양한 장르에 능숙한 작곡가. 보컬 스타일 선택 가능, 최대 4분 곡 생성")
    - **Wondera 작곡가**: 초상화 + 이름 + 설명 ("섬세한 보컬 표현이 특기인 작곡가. 커스텀 보컬 모델 지원")
  - 각 카드 탭 시 → 해당 작곡가와의 DialogueScreen으로 이동
- **작사 디렉터 추천 로직** (항목 26):
  - 장르가 "팝", "힙합", "일렉트로닉" → Suno 작곡가 추천
  - 장르가 "클래식", "발라드", "재즈" → Wondera 작곡가 추천
  - 추천 카드에 "★ 추천" 뱃지 표시
- **캐릭터 에셋**: Suno 작곡가, Wondera 작곡가 각각 별도 초상화/스프라이트 필요 (기존 composer 에셋을 복제하여 색상 변형하거나 Piskel로 신규 생성)

##### MusicGenerationScreen (항목 27 - 작곡 입력 폼)
- **역할**: 선택한 작곡가(Suno/Wondera)에 맞는 작곡 파라미터 입력
- **자동 전달 데이터** (작사 플로우에서 전달):
  - 가사 (lyrics) - LyricsResultScreen에서 확정된 가사
  - 장르 (genre) - LyricsInputScreen에서 선택한 장르
  - 분위기 (mood) - LyricsInputScreen에서 선택한 분위기
  - 템포 (tempo) - LyricsInputScreen에서 선택한 템포
- **추가 입력 항목**:

| 필드 | Suno | Wondera | 설명 |
|------|------|---------|------|
| 곡 제목 (title) | ✅ | ❌ | 곡 제목 입력 |
| 보컬 스타일 (vocalStyle) | ✅ | ❌ | male_warm, male_powerful, male_husky, male_soft, female_warm, female_powerful, female_husky, female_sweet |
| 보컬 모델 (vocalId) | ❌ | ✅ | `GET /api/kits/voice-models` 에서 목록 로드하여 선택 |
| 내 목소리 사용 | ✅ (음성변환) | ✅ (음성변환) | `POST /api/voice-convert/{id}` - 녹음/업로드한 음성을 보컬로 변환 |
| BPM | ✅ | ❌ | 템포에서 자동 매핑 (Slow:70, Medium:110, Fast:140) + 직접 입력 가능 |
| 모델 선택 (model) | ✅ | ✅ | Suno: "v5"/"v4", Wondera: "default"/"pro" |
| 레퍼런스 음악 업로드 | ✅ | ✅ | expo-document-picker로 음악 파일 선택 |
| 레퍼런스 음악 녹음 | ✅ | ✅ | expo-audio로 직접 녹음 (허밍/멜로디) |
| 곡 길이 (duration) | ✅ | ❌ | "짧은"(60s), "보통"(180s), "긴"(240s) |
| 스타일 태그 (style) | ✅ | ❌ | 자유 입력 (예: "acoustic guitar, piano ballad") |

- **Suno API 호출**: `POST /api/generate/`
  ```json
  {
    "prompt": "스타일 설명",
    "title": "곡 제목",
    "genre": "장르",
    "mood": "분위기",
    "style": "스타일 태그",
    "vocal": "male_warm",
    "duration": 180,
    "bpm": 110,
    "lyrics": "가사 전체",
    "model": "v5",
    "persona_id": null
  }
  ```
- **Wondera API 호출**: `POST /api/wondera/generate`
  ```json
  {
    "lyrics": "가사 전체",
    "model": "default",
    "prompt": "장르, 분위기, 스타일 설명",
    "vocal_id": "선택한 보컬 모델 ID"
  }
  ```

##### MusicLoadingScreen (음악 생성 로딩)
- **역할**: 음악 생성 API 호출 중 대기 화면
- **UI**: 작곡 디렉터(Suno/Wondera) 스프라이트 애니메이션 + "작곡 중..." 텍스트 + 프로그레스 표시
- **예상 소요**: Suno ~2~5분, Wondera ~1~3분
- **완료 시**: 자동으로 MusicResultScreen으로 이동

##### MusicResultScreen (음악 결과 확인/재생)
- **역할**: 생성된 음악을 재생하고 결과를 확인
- **UI**:
  - 상단: 작곡 디렉터 초상화 + "곡이 완성됐어요!" 대화 버블
  - 중앙: 오디오 플레이어 (재생/일시정지, 시크바, 현재 시간/전체 시간)
  - 곡 정보 표시 (제목, 장르, 분위기, BPM, 보컬 스타일)
  - 하단 버튼:
    1. "다시 생성" → MusicGenerationScreen으로 돌아가 재생성
    2. "저장" → 결과를 서버에 저장
    3. "맵으로 돌아가기" → MapScreen으로 이동

---

### Phase 3: API 서비스 레이어

#### 3-1. api.ts (Axios 인스턴스)

```typescript
// services/api.ts
import axios from 'axios';

const API_BASE_URL = 'http://YOUR_SERVER_IP:8000'; // 환경변수로 관리

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 5분 (음악 생성은 오래 걸림)
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터: 인증 토큰 추가 (추후)
api.interceptors.request.use((config) => {
  // const token = useAuthStore.getState().token;
  // if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 응답 인터셉터: 에러 핸들링
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 공통 에러 처리 (네트워크 에러, 401, 500 등)
    return Promise.reject(error);
  }
);

export default api;
```

#### 3-2. lyricsService.ts

```typescript
// services/lyricsService.ts
import api from './api';
import { LyricsGenerateRequest, LyricsGenerateResponse } from '../types/lyrics';

export const lyricsService = {
  /**
   * 가사 생성
   * POST /api/generate/lyrics/
   * @param params - { prompt, genre, mood, language }
   */
  generateLyrics: async (params: LyricsGenerateRequest): Promise<LyricsGenerateResponse> => {
    const response = await api.post('/api/generate/lyrics/', params);
    return response.data;
  },
};
```

#### 3-3. musicService.ts (Suno + Wondera)

```typescript
// services/musicService.ts
import api from './api';
import { SunoGenerateRequest, WonderaGenerateRequest, MusicGenerateResponse } from '../types/music';

export const musicService = {
  /**
   * Suno 음악 생성
   * POST /api/generate/
   */
  generateSuno: async (params: SunoGenerateRequest): Promise<MusicGenerateResponse> => {
    const response = await api.post('/api/generate/', params);
    return response.data;
  },

  /**
   * Wondera 음악 생성
   * POST /api/wondera/generate
   */
  generateWondera: async (params: WonderaGenerateRequest): Promise<MusicGenerateResponse> => {
    const response = await api.post('/api/wondera/generate', params);
    return response.data;
  },
};
```

#### 3-4. voiceService.ts

```typescript
// services/voiceService.ts
import api from './api';

export const voiceService = {
  /**
   * 보컬 모델 목록 조회
   * GET /api/kits/voice-models
   */
  getVoiceModels: async () => {
    const response = await api.get('/api/kits/voice-models');
    return response.data;
  },

  /**
   * 음성 변환 (내 목소리 → AI 보컬)
   * POST /api/voice-convert/{id}
   */
  convertVoice: async (id: string, audioFile: FormData) => {
    const response = await api.post(`/api/voice-convert/${id}`, audioFile, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};
```

---

### Phase 4: 대화 시스템 (Dialogue System)

#### 4-1. 대화 스크립트 엔진

JSON 기반 대화 스크립트를 순서대로 재생하는 엔진. 분기(선택지), 변수 저장, 조건 분기를 지원한다.

**타입 정의** (`types/dialogue.ts`):

```typescript
export type DirectorType = 'artist' | 'lyricist' | 'composer' | 'image' | 'video' | 'suno_composer' | 'wondera_composer';

export interface DialogueLine {
  id: string;                          // 고유 ID
  character: DirectorType;             // 말하는 캐릭터
  text: string;                        // 대화 내용 (한국어)
  choices?: DialogueChoice[];          // 선택지 (없으면 탭하여 다음으로)
  action?: 'save_genre' | 'save_mood' | 'save_content' | 'save_tempo' | 'save_language' | 'navigate';
  actionValue?: string;                // action에 전달할 값
  nextId?: string;                     // 다음 대화 ID (선택지가 없을 때)
  condition?: {                        // 조건부 표시
    key: string;
    value: string;
  };
}

export interface DialogueChoice {
  text: string;           // 선택지 텍스트
  nextId: string;         // 선택 시 이동할 대화 ID
  saveKey?: string;       // Zustand 스토어에 저장할 키
  saveValue?: string;     // 저장할 값
}

export interface DialogueScript {
  id: string;
  directorType: DirectorType;
  lines: DialogueLine[];
}
```

#### 4-2. 작사 디렉터 대화 스크립트 (`data/lyricistDialogue.ts`)

```
[작사 디렉터 대화 흐름]

1. 인사 → "안녕하세요! 작사 디렉터입니다. 오늘은 어떤 노래를 만들어볼까요?"
2. 장르 질문 → "어떤 장르의 곡을 원하시나요?"
   선택지: [가요] [팝] [힙합] [R&B] [록] [일렉트로닉] [클래식] [BGM] [기타]
3. 분위기 질문 → "곡의 분위기는 어떤 느낌이 좋을까요?"
   선택지: [밝은] [슬픈] [신나는] [잔잔한] [몽환적] [강렬한] [감성적]
4. 주제 질문 → "어떤 이야기를 담고 싶으신가요? 간단히 알려주세요."
   (자유 텍스트 입력 - DialogueChoices 대신 TextInput 표시)
5. 확인 → "좋아요! {장르} 장르의 {분위기} 느낌, '{주제}' 주제로 가사를 써볼게요. 세부 사항을 조정해볼까요?"
   선택지: [세부 조정하기 →] [바로 생성하기]
   - "세부 조정하기" → LyricsInputScreen으로 이동 (수집된 값 기본값 세팅)
   - "바로 생성하기" → LyricsPromptReviewScreen으로 이동 (기본값으로 프롬프트 생성)
```

#### 4-3. 작곡가 소개 대화 스크립트 (`data/composerIntroDialogue.ts`)

```
[작사 디렉터 → 작곡가 소개 흐름] (ComposerSelectScreen에서 사용)

1. "가사가 멋지게 완성됐어요! 이제 이 가사에 음악을 입혀줄 작곡가를 만나볼 시간이에요."
2. "저희 스튜디오에는 두 명의 작곡가가 있어요."
3. "첫 번째는 'Suno 작곡가'. 다양한 장르를 소화하고, 보컬 스타일을 자유롭게 선택할 수 있어요."
4. "두 번째는 'Wondera 작곡가'. 섬세한 보컬 표현이 특기이고, 커스텀 보컬 모델을 사용할 수 있어요."
5. (장르 기반 추천) "{장르} 장르라면 {추천 작곡가}를 추천드려요!"
6. "어떤 작곡가와 함께 하시겠어요?"
   → 선택 카드 UI로 전환
```

#### 4-4. Suno/Wondera 작곡 디렉터 대화 스크립트

각 작곡가별 짧은 인사 대화 후 MusicGenerationScreen으로 이동:

```
[Suno 작곡가]
1. "안녕하세요! Suno 작곡가입니다. 가사를 받아봤는데, 좋은 곡이 될 것 같아요!"
2. "보컬 스타일과 세부 설정을 잡아볼까요?"
→ MusicGenerationScreen (type: 'suno')

[Wondera 작곡가]
1. "반갑습니다! Wondera 작곡가에요. 이 가사에 맞는 음악을 만들어볼게요."
2. "보컬 모델을 선택하고 세부 설정을 해볼까요?"
→ MusicGenerationScreen (type: 'wondera')
```

#### 4-5. 대화 UI 컴포넌트 상세

##### DialogueBox.tsx
- 하단 대화창 컨테이너
- 디렉터 이름 레이블 (좌측 상단)
- 대화 텍스트 영역 (타이핑 애니메이션: 50ms/글자, 탭하면 즉시 완성)
- 하단 우측: "▼" 탭하여 계속 인디케이터 (깜빡임 애니메이션)
- 배경: 반투명 다크 (`rgba(26, 26, 46, 0.95)`), 둥근 모서리 12px

##### DialogueChoices.tsx
- 대화창 위에 선택지 버튼 세로 배치
- 각 버튼: 둥근 사각형, 터치 시 하이라이트
- 자유 텍스트 입력 모드: TextInput + "확인" 버튼으로 전환 가능

##### CharacterPortrait.tsx
- 디렉터 초상화 표시 (원형 + 테두리)
- 대화창 좌측에 배치
- 말할 때 약간 위아래 바운스 애니메이션

##### TypingIndicator.tsx
- "..." 점 세 개가 순서대로 나타나는 애니메이션
- API 응답 대기 중 표시

---

### Phase 5: 기능 구현

#### 5-1. Zustand 상태 관리

##### useLyricsStore.ts
```typescript
interface LyricsState {
  // 입력값 (항목 22)
  genre: string;           // 장르
  mood: string;            // 분위기
  content: string;         // 가사 주제/내용
  tempo: string;           // 템포 (slow/medium/fast)
  language: string;        // 언어
  duration: string;        // 곡 길이 (short/medium/long)
  includeRap: boolean;     // 랩 포함 여부

  // 생성된 결과
  generatedPrompt: string; // 자동 생성된 프롬프트 (항목 23)
  generatedLyrics: string; // 생성된 가사 (항목 24)
  editedLyrics: string;    // 사용자가 수정한 가사

  // 상태
  isGenerating: boolean;
  error: string | null;

  // 액션
  setField: (key: string, value: any) => void;
  buildPrompt: () => string;
  reset: () => void;
}
```

##### useMusicStore.ts
```typescript
interface MusicState {
  // 작곡가 타입
  composerType: 'suno' | 'wondera' | null;

  // 공통 입력값 (작사에서 자동 전달)
  lyrics: string;
  genre: string;
  mood: string;
  tempo: string;

  // Suno 전용
  title: string;
  vocalStyle: string;
  bpm: number;
  style: string;
  sunoModel: string;       // v4 / v5
  sunoDuration: number;

  // Wondera 전용
  vocalId: string;
  wonderaModel: string;    // default / pro

  // 공통
  referenceFile: string | null;  // 레퍼런스 음악 파일 경로
  useMyVoice: boolean;
  myVoiceFile: string | null;

  // 결과
  generatedMusicUrl: string | null;
  musicMetadata: any;

  // 상태
  isGenerating: boolean;
  error: string | null;

  // 액션
  setField: (key: string, value: any) => void;
  initFromLyrics: (lyricsStore: LyricsState) => void;  // 작사 데이터 자동 전달
  reset: () => void;
}
```

##### useDialogueStore.ts
```typescript
interface DialogueState {
  currentScript: DialogueScript | null;
  currentLineIndex: number;
  isTyping: boolean;
  collectedData: Record<string, string>; // 대화 중 수집한 데이터

  loadScript: (scriptId: string) => void;
  nextLine: () => void;
  selectChoice: (choice: DialogueChoice) => void;
  setTypingComplete: () => void;
  reset: () => void;
}
```

#### 5-2. 가사 생성 전체 플로우 구현

1. **MapScreen**: 작사 디렉터 캐릭터 탭
2. **DialogueScreen**: `lyricistDialogue` 스크립트 재생, 기본 정보(장르, 분위기, 주제) 수집 → `useLyricsStore`에 저장
3. **LyricsInputScreen**: 폼으로 모든 필드 표시 (대화에서 수집한 값이 기본값), 사용자 수정 가능
4. **LyricsPromptReviewScreen**: `useLyricsStore.buildPrompt()` 호출하여 프롬프트 생성, TextInput으로 편집 가능
5. **LyricsLoadingScreen**: `lyricsService.generateLyrics()` 호출, 로딩 애니메이션 표시
6. **LyricsResultScreen**: 결과 가사 표시, 편집 가능, "작곡하러 가기" 버튼

#### 5-3. 음악 생성 전체 플로우 구현

1. **ComposerSelectScreen**: 작사 디렉터가 두 작곡가 소개, 장르 기반 추천 뱃지 표시
2. **DialogueScreen**: 선택한 작곡가와 짧은 대화
3. **MusicGenerationScreen**:
   - `useMusicStore.initFromLyrics()`로 작사 데이터 자동 세팅
   - Suno 선택 시: 제목, 보컬 스타일, BPM, 모델, 곡 길이, 스타일 태그 입력
   - Wondera 선택 시: 보컬 모델 선택 (`voiceService.getVoiceModels()`), 모델 선택 입력
   - 공통: 레퍼런스 음악 업로드 (expo-document-picker) 또는 녹음 (expo-audio), 내 목소리 사용 옵션
4. **MusicLoadingScreen**: `musicService.generateSuno()` 또는 `musicService.generateWondera()` 호출
5. **MusicResultScreen**: 생성된 음악 재생 (expo-audio), 정보 표시, 저장/재생성 옵션

#### 5-4. 보컬 선택 통합

- **Suno**: 8가지 보컬 스타일 중 선택 (male_warm, male_powerful, male_husky, male_soft, female_warm, female_powerful, female_husky, female_sweet) → 드롭다운 또는 카드 선택 UI
- **Wondera**: `GET /api/kits/voice-models`에서 모델 목록 로드 → 리스트 + 미리듣기 버튼
- **내 목소리 사용**: 녹음 또는 파일 업로드 → `POST /api/voice-convert/{id}`로 음성 변환 후 적용

#### 5-5. 레퍼런스 음악 파일 업로드/녹음

- **파일 업로드**: `expo-document-picker`로 .mp3, .wav, .m4a 파일 선택 → FormData로 서버 전송
- **직접 녹음**: `expo-audio` Recording API로 녹음 시작/정지 → 녹음 파일을 FormData로 전송
- **UI**: "레퍼런스 음악" 섹션에 [파일 선택] [녹음하기] 2개 버튼 + 선택/녹음된 파일 미리듣기

---

### Phase 6: 테스트 계획

#### 6-1. 단위 테스트

| 테스트 항목 | 대상 | 검증 내용 |
|------------|------|----------|
| 프롬프트 빌드 | `useLyricsStore.buildPrompt()` | 모든 입력 조합에서 올바른 프롬프트 문자열 생성 |
| 스토어 상태 | `useLyricsStore`, `useMusicStore` | setField, reset, initFromLyrics 동작 검증 |
| API 서비스 | `lyricsService`, `musicService` | 요청 형식 및 에러 핸들링 검증 (mock) |
| 대화 엔진 | `useDialogueStore` | 스크립트 로드, 다음 줄, 선택지 분기 동작 검증 |

#### 6-2. 통합 테스트 (화면 플로우)

| 테스트 항목 | 검증 내용 |
|------------|----------|
| 작사 전체 플로우 | 맵 → 대화 → 입력 폼 → 프롬프트 확인 → 로딩 → 결과 표시까지 전체 이동 |
| 작곡 전체 플로우 | 가사 결과 → 작곡가 선택 → 작곡 입력 → 로딩 → 음악 재생까지 전체 이동 |
| 데이터 전달 | 작사 데이터가 작곡 화면까지 정확히 전달되는지 검증 |
| Suno vs Wondera 분기 | 각 작곡가 선택 시 올바른 API 호출 및 입력 폼 표시 검증 |

#### 6-3. API 연동 테스트

| 테스트 항목 | API 엔드포인트 | 검증 내용 |
|------------|---------------|----------|
| 가사 생성 | `POST /api/generate/lyrics/` | 요청 전송 → 응답 수신 → 가사 파싱 |
| Suno 음악 생성 | `POST /api/generate/` | 모든 파라미터 전송 → 음악 URL 수신 |
| Wondera 음악 생성 | `POST /api/wondera/generate` | 모든 파라미터 전송 → 음악 URL 수신 |
| 보컬 모델 목록 | `GET /api/kits/voice-models` | 모델 목록 로드 및 표시 |
| 음성 변환 | `POST /api/voice-convert/{id}` | 오디오 파일 업로드 → 변환 결과 수신 |

#### 6-4. UI/UX 테스트

| 테스트 항목 | 검증 내용 |
|------------|----------|
| 대화 타이핑 애니메이션 | 텍스트가 한 글자씩 나타나는지, 탭 시 즉시 완성되는지 |
| 선택지 반응 | 선택지 탭 시 올바른 분기로 이동하는지 |
| 폼 유효성 검사 | 필수 입력값 누락 시 경고 표시, 실현가능성 체크 경고 |
| 로딩 화면 | 로딩 중 애니메이션 표시, 완료 시 자동 이동 |
| 오디오 재생 | 생성된 음악이 정상 재생되는지, 시크/일시정지 동작 |
| 파일 업로드 | document-picker로 파일 선택 및 업로드 정상 동작 |
| 녹음 | 녹음 시작/정지, 미리듣기, 서버 전송 동작 |
| 화면 뒤로가기 | 모든 화면에서 뒤로가기 시 이전 데이터 유지 |

#### 6-5. 엣지 케이스 테스트

| 테스트 항목 | 검증 내용 |
|------------|----------|
| API 타임아웃 | 5분 초과 시 에러 메시지 및 재시도 옵션 |
| 네트워크 끊김 | 오프라인 상태에서 적절한 에러 처리 |
| 빈 응답 | API가 빈 가사/음악을 반환했을 때 처리 |
| 긴 가사 | 매우 긴 가사를 입력/생성했을 때 ScrollView 정상 동작 |
| 대용량 파일 | 레퍼런스 음악 파일이 큰 경우 업로드 처리 |

---

### 구현 우선순위 및 일정 추정

| 순서 | Phase | 예상 소요 | 의존성 |
|------|-------|----------|--------|
| 1 | Phase 1: 프로젝트 구조 설정 | 0.5일 | 없음 |
| 2 | Phase 2: 네비게이션 & 화면 구조 (빈 화면) | 1일 | Phase 1 |
| 3 | Phase 3: API 서비스 레이어 | 0.5일 | Phase 1 |
| 4 | Phase 4: 대화 시스템 | 2일 | Phase 2 |
| 5 | Phase 5-2: 가사 생성 플로우 | 2일 | Phase 3, 4 |
| 6 | Phase 5-3: 음악 생성 플로우 | 2일 | Phase 5-2 |
| 7 | Phase 5-4, 5-5: 보컬/파일 업로드 | 1일 | Phase 5-3 |
| 8 | Phase 6: 테스트 | 1일 | 전체 |
| **합계** | | **약 10일** | |

---

### 추가 참고사항

- **캐릭터 에셋**: Suno 작곡가, Wondera 작곡가의 초상화와 스프라이트를 Piskel로 신규 생성해야 함 (기존 composer 에셋을 색상 변형하여 빠르게 제작 가능)
- **DirectorType 확장**: 기존 `'artist' | 'lyricist' | 'composer' | 'image' | 'video'`에 `'suno_composer' | 'wondera_composer'` 추가
- **환경변수 관리**: API Base URL은 `.env` 또는 `app.json`의 `extra` 필드로 관리 (expo-constants 활용)
- **CORS**: 모바일 앱에서 FastAPI 서버 접근 시 CORS 설정 확인 필요 (React Native는 origin이 없으므로 `allow_origins=["*"]` 또는 별도 처리)
- **에러 처리 UX**: 모든 API 에러는 디렉터 캐릭터의 대화 형식으로 표시 ("이런, 문제가 생겼어요. 다시 시도해볼까요?")

---

## v3 - 2026-04-09 - UI 개선 및 대화형 인터페이스

### 수정일자
2026-04-09

### 요청 작업
1. 스플래시 로딩 화면 추가
2. 탭 네비게이션 구조 (플레이리스트 + 작업실)
3. 디렉터 배치 수정 (2번 방: 작사, 3번 방: 작곡)
4. 비활성 방 잠금 처리 (아티스트, 영상)
5. 대화 UI 재디자인 (흰색 글상자, 디렉터 상단 배치, 맵 배경 투영)
6. 작사 입력을 대화형 단계별 인터페이스로 변경

---

## v4 - 2026-04-10 - UI 버그 수정 및 디렉터 이미지 교체

### 수정일자
2026-04-10

### 요청 작업
1. 잠긴 방 제거 (원래대로 복원 - 모든 방 접근 가능)
2. 디렉터 초상화를 새 3D 캐릭터 이미지로 교체 (얼굴~상반신)
3. 대화 화면 맵 배경이 까만색으로 보이는 문제 수정 → 맵 이미지를 직접 렌더링
4. 작사 LLM 호출 네트워크 에러 수정 (모바일에서 localhost → 실제 IP 자동 감지)
5. 하단 탭 바가 iPhone 홈 인디케이터에 가려지는 문제 수정
6. 키보드가 텍스트 입력창을 가리는 문제 수정 (KeyboardAvoidingView offset)
7. 프롬프트 확인 창 선택 요약 항목 클릭 시 수정 가능하도록 Modal 추가

---

## v5 - 2026-04-10 - 디렉터 이미지 재배치, 방 포커싱, 탭 확장, 로그인

### 수정일자
2026-04-10

### 요청 작업
1. 디렉터 이미지 순서 재배치: 아티스트, 작곡, 이미지, 작사, 영상
2. 대화 화면 맵 배경에 캐릭터 스프라이트도 표시
3. 방 포커싱 영역을 실제 TMX 방 좌표에 맞게 수정
4. 탭 바 아이콘 위치 조정
5. 네트워크 에러 디버깅 강화 (로그, 멀티 폴백)
6. 누락된 플랫폼 기능 확인 및 추가 (차트, 마이뮤직, 설정 탭)
7. 플레이리스트 + 버튼 → 마이뮤직 연결
8. 로그인/회원가입 기능 구현, DB 현황 확인

---

## v6 - 2026-04-10 - UI 레이아웃 수정, 탭 정리, AdMob 타이머

### 수정일자
2026-04-10

### 요청 작업
1. DialogueScreen 레이아웃 수정 (이름 위치, 방 포커싱, 캐릭터 z-index, 대화창 간격)
2. 탭 구조 정리: 5개 → 3개 (플레이리스트, 작업실, 마이뮤직) + 설정 상단 아이콘
3. 플레이리스트에 DB 데이터 연동
4. Google AdMob 대기 타이머 시스템 구현

---

## v7 - 2026-04-10 - 탭 바 반응형 + AdMob 실제 적용

### 수정일자
2026-04-10

### 요청 작업
1. 하단 탭 바 위치/아이콘을 OS Safe Area 표준에 맞게 반응형 적용
2. Google AdMob 보상형 광고 실제 빌드 적용

---

## v8 - 2026-04-10 - 방 포커싱 수정, 맵 타이머, 탭 아이콘

### 수정일자
2026-04-10

### 요청 작업
1. 방 포커싱 상단 벽 넘어가는 문제 수정
2. 타이머를 별도 화면 → 맵 위 상태바로 변경 (디렉터 상단에 진행 표시)
3. 탭 바 아이콘 변경 (☰/⚒/♪) + 아이콘-텍스트 간격 조정

---

## v9 - 2026-04-10 - AdMob ID 설정, 상태바 개선, 방 포커싱 정밀화

### 수정일자
2026-04-10

### 요청 작업
1. AdMob 실제 앱/광고 단위 ID 적용 (iOS/Android)
2. 맵 위 타이머 상태바 디자인 개선 (크기, 가독성)
3. TMX 파일 분석으로 정확한 방 경계 포커싱

---

## v10 - 2026-04-10 - 네트워크, 대화 개선, 프로그레스바, 얼굴 크롭

### 수정일자
2026-04-10

### 요청 작업
1. .env localhost → 192.168.219.106 변경
2. 작사 대화를 정리.md 기반으로 변경 + 마지막 질문 버그 수정
3. 타이머 상태바 → 프로그레스 바 + 광고 유도 팝업
4. AdMob eas build 연결 확인
5. 디렉터 초상화 얼굴 크롭 수정

---

## v12 - 2026-04-10 - 차트/플레이리스트 분리, 대기번호 시스템, 커스텀 팝업

### 수정일자
2026-04-10

### 요청 작업
1. 백엔드 API 연결 확인 (포트 9000)
2. 차트(모든 곡) + 플레이리스트(내 담은 곡) 탭 분리, 웹 UI 반영
3. 시스템 Alert → 인앱 커스텀 Modal 팝업 + 시간→대기번호 개념 변경

---

## v13 - 2026-04-10 - 토글 높이 고정, 작사 인증 에러 수정

### 수정일자
2026-04-10

### 요청 작업
1. PlayerScreen 가사·상세정보 토글에서 탭 전환 시 높이가 변하지 않고 최대 높이로 고정
2. 작사 완료 시 /generate/lyrics/ 401 인증토큰 에러 수정

### 계획

#### 이슈 1: 토글 높이 고정
- **원인**: `sheetContainer` 스타일에 `maxHeight: '70%'`, `minHeight: '50%'` → 콘텐츠 양에 따라 높이 변동
- **해결**: `height: '70%'` 고정으로 변경
- **담당**: 프론트엔드

#### 이슈 2: 401 인증 에러
- **원인**: `api.ts`에 요청 인터셉터 없음 → 로그인 토큰이 API 요청에 누락
- **해결**: `api.ts`에 요청 인터셉터 추가 (useAuthStore.getState()로 토큰 읽어 Authorization 헤더 첨부)
- **담당**: 프론트엔드

---

## v14 - 2026-04-10 - UI 개선, 대화형 작곡, 에러 수정

### 수정일자
2026-04-10

### 요청 작업
1. PlayerScreen 가사·상세정보 토글 위치 하단으로 이동
2. 탭바 아이콘 플레인 변경 (이모지→유니코드), 설정 아이콘 변경
3. 작사 로딩 텍스트 변경 + 5개 화면 얼굴 크롭 수정
4. MusicGenerationScreen 대화형(채팅) UI 전환 + lyricsStore 데이터 연동
5. 작곡 에러 수정: /generate/ 422 (prompt 누락) + MusicResultScreen render error
6. 오디오 스트림 URL 확인 (stream-proxy)

---

## v15 - 2026-04-10 - 마이뮤직, 로그인 리다이렉트, 설정 확장, 플레이어 아이콘

### 수정일자
2026-04-10

### 요청 작업
1. 마이뮤직에 생성 곡/가사 보관 (API 연동)
2. 로그인 후 차트 탭으로 화면 전환
3. 설정창 기능 추가 (알림, 앱 정보, 캐시 등)
4. 재생/일시정지 아이콘 플레인 변경
5. 가사·상세정보 토글 반응형 배치 (SafeAreaView)

---

## v16 - 2026-04-11 - 마이뮤직 작사, 토글 위치, 아이콘 통일, 작곡 성별

### 수정일자
2026-04-11

### 요청 작업
1. 마이뮤직에 작사 기록도 표시
2. 토글 위치 올림 (SafeArea 내 배치)
3. 플레이어 아이콘 정렬/크기 통일
4. 모든 디렉터 얼굴 크롭 점검
5. 작사 없으면 작곡 차단
6. 작곡 대화에 보컬 성별 단계 추가 + 건너뛰기

---

## v17 - 2026-04-11 - 플레이어 레이아웃 복원, 인증 토큰 순환참조 수정

### 수정일자
2026-04-11

### 요청 작업
1. PlayerScreen 레이아웃 원래대로 복원 (하단 토글만 올리고 전체 UI는 원래대로)
2. 작사 완료 시 401 인증토큰 에러 재발 수정

---

## v19 - 2026-04-11 - 방 포커싱 정밀화, SafeArea 전체 적용

### 수정일자
2026-04-11

### 요청 작업
1. 방 포커싱 하단 벽 포함 문제 수정
2. 앱 상단 SafeArea 지정 (모바일 UI 가림 방지)

---

## v20 - 2026-04-11 - 작곡 파라미터 확장, 곡 결과 URL 수정

### 수정일자
2026-04-11

### 요청 작업
1. 작곡.md 파라미터 전체 적용 (스타일 설명, 참고 스타일, BPM, 키, 제외 스타일)
2. 곡 완성 후 결과물 안 보이는 문제 수정

---

## v21 - 2026-04-14 - 곡 완성 후 오디오 미표시 및 저장 미작동 버그 수정

### 수정일자
2026-04-14

### 요청 작업
작사 → 작곡 완료 후 "곡이 완성됐어요!" 화면에서 생성된 곡이 보이지 않고, 마이뮤직에도 나타나지 않는 문제 수정

### 원인 분석
1. **필드명 불일치 (MusicLoadingScreen.tsx)**: 백엔드 generation 응답의 오디오 URL 필드명이 `result_audio_url`인데, 프론트엔드는 `audio_url`, `result_url`, `url`, `output_url`만 찾고 있음 → `resultUrl`이 빈 문자열이 되어 플레이어와 저장 버튼이 렌더링되지 않음
2. **가짜 저장 (MusicResultScreen.tsx)**: `handleSave()`가 Alert만 표시하고 실제 `POST /api/tracks/upload-from-generation` API를 호출하지 않음 → 트랙이 DB에 저장되지 않아 마이뮤직에서 조회 불가

### 수정 계획
1. `MusicLoadingScreen.tsx`: `result_audio_url` 필드 인식 추가, generation stream 엔드포인트 URL 사용
2. `MusicResultScreen.tsx`: 오디오 로딩 시 인증 헤더 추가 (generation stream 엔드포인트 인증 필요)
3. `MusicResultScreen.tsx`: `handleSave()` → `POST /api/tracks/upload-from-generation` 실제 호출 구현
4. `musicService.ts`: `uploadFromGeneration()` 서비스 함수 추가

---

## v22 - 2026-04-14 - 저장 미작동, 프롬프트 매핑 수정, 다시 생성하기 플로우 수정

### 수정일자
2026-04-14

### 요청 작업
1. 저장하기를 눌러도 마이뮤직에 생성한 음악이 보이지 않는 문제 해결
2. 작사/작곡 프롬프트 확인 및 개선 - 원하는 노래와 다른 곡이 생성되는 문제
3. 다시 생성하기 클릭 시 작곡 설정 화면으로 돌아가도록 수정 (현재는 바로 생성 시작됨)

### 원인 분석
1. **저장 API**: v21에서 handleSave()에 API 호출 추가했으나, generationId 보존 검증 필요
2. **보컬 스타일 매핑 불일치**: 
   - 프론트엔드가 `vocal: '남성 보컬'` (한국어) 전송
   - 백엔드 `SUNO_VOCAL_MAP`은 `male_warm`, `female_powerful` 등 영어 키만 인식
   - 결과: `vocal_info = None` → 보컬 스타일이 Suno에 전달되지 않아 의도와 다른 곡 생성
   - 추가로 `vocalStyle` (소프트, 파워풀 등)이 API에 전송되지 않음
3. **다시 생성하기 플로우**: `handleRegenerate()`가 `MusicLoading`으로 바로 이동하여 동일 파라미터로 재생성됨. `MusicGeneration`으로 이동해야 설정 변경 후 재생성 가능

### 수정 계획
1. `musicService.ts`: 한국어 보컬(성별+스타일) → 백엔드 SUNO_VOCAL_MAP 키 매핑 테이블 추가
2. `MusicResultScreen.tsx`: handleRegenerate() → `MusicGeneration` 화면으로 이동
3. `MusicResultScreen.tsx`: handleSave() 검증 (generationId 정확성 확인)
4. 작곡.md, 작사Input정리.md 파라미터 반영 확인

---

## v23 - 2026-04-14 - 백엔드 포트 9001 전환, API 필드 전수 점검

### 수정일자
2026-04-14

### 요청 작업
1. 프론트엔드 백엔드 호출 포트 9000 → 9001 전체 변경
2. API 필드 전수 점검 및 불일치 수정
3. 대화 UI 질문 ↔ API 필드 완전성 점검

### 원인 분석
1. 최신 백엔드가 9001 포트에서 실행 중이나 프론트엔드가 9000으로 호출
2. Wondera API 호출 시 불필요한 필드(`genre`, `mood`, `duration`) 전송 및 잘못된 모델명(`'wondera'` → `'auto'`)
3. 참고 음악 파일 업로드 플로우 미구현 (향후 과제)

### 수정 계획
1. 모든 `9000` 참조를 `9001`로 변경 (api.ts, 6개 스크린 파일)
2. Wondera API 호출 필드 정리 - 백엔드 스키마에 맞게 수정
3. 대화 UI → API 매핑 점검표 작성


---

## v24 - 2026-04-17 - 자연 대기시간 재책정 (Suno 6시간 기준점)

### 수정일자
2026-04-17

### 요청 작업
- **사용자 요청**: 자연 대기시간이 짧게 느껴짐. **Suno(작곡, 1,000원)를 자연대기 6시간 기준점**으로 잡고, 다른 모델들의 대기시간을 가격에 비례하여 재책정
- 수정 대상: `2_housing/stores/timerStore.ts` 의 `MODEL_QUEUE_CONFIG`
- 백엔드 코드는 절대 수정 금지 (순수 클라이언트 사이드 UX 타이머이므로 백엔드 영향 없음)

### 계산 근거 (Cost-proportional Wait Model)
- 기준점: **Suno 1,000원 = 21,600초 (6시간)**
- 공식: `target_wait_sec = (model_cost / 1000) × 21,600`
- `cost_ratio = 모델가격 / 1,000원`

### 모델별 목표 자연대기시간 (수학적 계산)
| 모델 | 비용 | cost_ratio | 목표 대기 | 환산 |
|------|------|-----------|----------|------|
| GPT-4o Mini | 50원 | 0.05 | 1,080초 | **18분** |
| Claude Sonnet | 200원 | 0.20 | 4,320초 | **72분 (1.2h)** |
| Image (Gemini) | 200원 | 0.20 | 4,320초 | **72분 (1.2h)** |
| GPT-4o | 300원 | 0.30 | 6,480초 | **108분 (1.8h)** |
| GPT-4 Turbo | 500원 | 0.50 | 10,800초 | **180분 (3h)** |
| Wondera | 500원 | 0.50 | 10,800초 | **180분 (3h)** |
| Suno (composer) | 1,000원 | 1.00 | 21,600초 | **360분 (6h)** ★기준★ |
| Claude Opus | 1,500원 | 1.50 | 32,400초 | **540분 (9h)** |
| MV (Video) | 3,000원 | 3.00 | 64,800초 | **1,080분 (18h)** |
| Artist | - | - | ~900초 | **15분 (그대로 유지)** |

### 권장 queueNumber × tickIntervalSec 조합
- **tickIntervalSec 통일 정책**: 30초로 통일 (Artist만 20초 유지, 유아 사용자가 가벼운 작업도 빨리 체감하도록)
- queueNumber = 목표시간(초) ÷ tickIntervalSec
- min/max는 목표값 ±10% (±15% in heavy ones for variability)

| 모델 | tickIntervalSec | minQueue | maxQueue | 평균 대기 | 비고 |
|------|----------------|----------|----------|---------|------|
| lyrics_gpt4o_mini | 30 | 32 | 40 | ~18분 | 1,080s ÷ 30 = 36 → 32~40 |
| lyrics_claude_sonnet | 30 | 130 | 158 | ~72분 | 4,320s ÷ 30 = 144 → 130~158 |
| image | 30 | 130 | 158 | ~72분 | 4,320s ÷ 30 = 144 → 130~158 |
| lyrics_gpt4o | 30 | 195 | 237 | ~108분 | 6,480s ÷ 30 = 216 → 195~237 |
| lyrics_gpt4_turbo | 30 | 324 | 396 | ~180분 | 10,800s ÷ 30 = 360 → 324~396 |
| wondera | 30 | 324 | 396 | ~180분 | 10,800s ÷ 30 = 360 → 324~396 |
| composer (Suno) | 30 | 648 | 792 | ~360분 (6h) | 21,600s ÷ 30 = 720 → 648~792 ★기준★ |
| lyrics_claude_opus | 30 | 972 | 1,188 | ~540분 (9h) | 32,400s ÷ 30 = 1,080 → 972~1,188 |
| video (MV) | 30 | 1,944 | 2,376 | ~1,080분 (18h) | 64,800s ÷ 30 = 2,160 → 1,944~2,376 |
| artist | 20 | 30 | 50 | ~10~17분 | 그대로 유지 |

### adReduce 광고 보상 비율 재조정 (자연대기 비례 5~8%)
- 자연 대기가 길어졌으므로 광고 1회 보상도 비례적으로 늘려야 사용자 경험(UX) 유지
- **정책**: 광고 1회당 평균 자연대기의 약 **5~8%** 단축 (즉 광고 12~20회면 완료)
- adReduce는 **queueNumber 단위**로 차감되므로, `평균 queueNumber × 0.05~0.08` 적용

| 모델 | avg queue | adReduce min (5%) | adReduce max (8%) |
|------|-----------|-------------------|-------------------|
| lyrics_gpt4o_mini | 36 | 2 | 3 |
| lyrics_claude_sonnet | 144 | 7 | 12 |
| image | 144 | 7 | 12 |
| lyrics_gpt4o | 216 | 11 | 17 |
| lyrics_gpt4_turbo | 360 | 18 | 29 |
| wondera | 360 | 18 | 29 |
| composer (Suno) | 720 | 36 | 58 |
| lyrics_claude_opus | 1,080 | 54 | 86 |
| video (MV) | 2,160 | 108 | 173 |
| artist | 40 | 5 | 10 (그대로) |

### 부수효과 검토
1. **MapScreen.tsx tick 인터벌**: 이미 1초 간격으로 모든 디렉터를 체크하면서 각 디렉터의 `tickIntervalSec`을 보고 reduce를 호출하므로, queueNumber/tickIntervalSec 변경에 자동 적응. **영향 없음.**
2. **getAdReduce**: 광고 보상 값이 10배 이상 커지지만 reduceQueue() 자체는 max(0, n-amount) 형태라 안전함.
3. **persist 스토리지**: timerStore는 zustand persist 미사용(메모리 only) → 기존 진행 중 작업이 새 설정으로 인해 이상 동작할 가능성 없음.
4. **백엔드 API**: 타이머는 순수 UI 표시용. 백엔드 generation 응답이 도착하면 `completeTask()` 호출되어 즉시 종료. 따라서 자연대기 시간이 길어도 실제 결과 도착 시 바로 표시됨. **백엔드 영향 0.**

### 수정 대상 파일
- `/Users/pearl/TripleJ/2_housing/stores/timerStore.ts` 의 `MODEL_QUEUE_CONFIG` 객체 전면 교체
- 상단 주석에 "Suno = 6시간(21,600초) 자연 대기 기준점" 명시


## v25 - 2026-04-17 - Suno 6시간 기준 대기시간 재책정 (확정판, v24 미반영분 적용)

### 요청 작업 요약
- **사용자 재요청**: "Suno 자연대기를 6시간 기준으로 잡고, 가격에 비례해서 다른 모델들의 대기시간도 재책정해줘. 현재 자연대기가 너무 짧음."
- **현황**: v24에서 동일 의도의 계획이 작성되었으나 `2_housing/stores/timerStore.ts`에 **미반영** 상태. 현재 코드는 Suno 360~720 / 30s = 평균 약 4.5시간(이전 v12 설정)으로 6시간보다 짧음.
- **본 v25**: v24 계산을 그대로 채택·확정하고 frontend-dev에 직접 적용 가능한 코드 블록 제공.
- **백엔드 영향 없음** (UI 타이머는 순수 클라이언트 사이드, completeTask로 백엔드 응답 시 즉시 종료됨).

### Cost-proportional 계산 (Suno 1,000원 = 6시간 = 21,600초 기준)

`target_wait_sec = (cost / 1000원) × 21,600초`

| 모델 | 가격(원) | cost_ratio | 목표 자연대기(평균) | 현재 평균 → 새 평균 |
|------|---------|-----------|--------------------|----|
| GPT-4o Mini (작사)        |    50 | 0.05 |   1,080s = **18분**       | 13.3분 → **18분** |
| Claude Sonnet (작사)      |   200 | 0.20 |   4,320s = **72분 (1.2h)**| 33.5분 → **72분** |
| Image (Gemini)            |   200 | 0.20 |   4,320s = **72분 (1.2h)**| 33.3분 → **72분** |
| GPT-4o (작사)             |   300 | 0.30 |   6,480s = **108분 (1.8h)**| 41.6분 → **108분** |
| GPT-4 Turbo (작사)        |   500 | 0.50 |  10,800s = **180분 (3h)** | 75분 → **180분** |
| Wondera (작곡)            |   500 | 0.50 |  10,800s = **180분 (3h)** | 150분 → **180분** |
| **Suno (작곡) ★기준**     | 1,000 | 1.00 |  21,600s = **360분 (6h)** | 270분 → **360분** |
| Claude Opus (작사)        | 1,500 | 1.50 |  32,400s = **540분 (9h)** | 137.5분 → **540분** |
| MV (Video)                | 3,000 | 3.00 |  64,800s = **1,080분 (18h)**| 500분 → **1,080분** |
| Artist (저렴, 유지)       |     - |   -  |     ~900s = **15분**       | 13.3분 → 13.3분 (유지) |

### 결정된 새 MODEL_QUEUE_CONFIG (TypeScript, 그대로 복붙)

```typescript
// ─── 모델별 대기번호 설정 ───
// 기준: Suno = 6시간(21,600초) 자연 대기 (Cost-proportional Wait Model)
// target_wait_sec = (model_cost / 1,000원) × 21,600
// queueNumber × tickIntervalSec(30) = target_wait_sec
// min/max는 평균 ±10% 범위로 변동성 부여
// 광고 보상 = 평균 queueNumber × 5~8% (광고 12~20회면 완료)
const MODEL_QUEUE_CONFIG: Record<string, QueueConfig> = {
  // ─── 작사 모델 (5종) ───
  'lyrics_gpt4o_mini': {
    minQueue: 32, maxQueue: 40,        // ~50원 (cost_ratio 0.05)
    tickIntervalSec: 30,               // 자연대기: 16~20분 (평균 18분)
    adReduce: { min: 2, max: 3 },
    label: 'GPT-4o Mini 작사',
  },
  'lyrics_claude_sonnet': {
    minQueue: 130, maxQueue: 158,      // ~200원 (cost_ratio 0.20)
    tickIntervalSec: 30,               // 자연대기: 65~79분 (평균 72분 = 1.2h)
    adReduce: { min: 7, max: 12 },
    label: 'Claude Sonnet 작사',
  },
  'lyrics_gpt4o': {
    minQueue: 195, maxQueue: 237,      // ~300원 (cost_ratio 0.30)
    tickIntervalSec: 30,               // 자연대기: 97~118분 (평균 108분 = 1.8h)
    adReduce: { min: 11, max: 17 },
    label: 'GPT-4o 작사',
  },
  'lyrics_gpt4_turbo': {
    minQueue: 324, maxQueue: 396,      // ~500원 (cost_ratio 0.50)
    tickIntervalSec: 30,               // 자연대기: 162~198분 (평균 180분 = 3h)
    adReduce: { min: 18, max: 29 },
    label: 'GPT-4 Turbo 작사',
  },
  'lyrics_claude_opus': {
    minQueue: 972, maxQueue: 1188,     // ~1,500원 (cost_ratio 1.50)
    tickIntervalSec: 30,               // 자연대기: 486~594분 (평균 540분 = 9h)
    adReduce: { min: 54, max: 86 },
    label: 'Claude Opus 작사',
  },

  // ─── 작곡 모델 ───
  'composer': {
    minQueue: 648, maxQueue: 792,      // Suno ~1,000원 ★기준점★
    tickIntervalSec: 30,               // 자연대기: 324~396분 (평균 360분 = 6h)
    adReduce: { min: 36, max: 58 },
    label: 'Suno 작곡',
  },
  'wondera': {
    minQueue: 324, maxQueue: 396,      // Wondera ~500원 (cost_ratio 0.50)
    tickIntervalSec: 30,               // 자연대기: 162~198분 (평균 180분 = 3h)
    adReduce: { min: 18, max: 29 },
    label: 'Wondera 작곡',
  },

  // ─── 이미지 ───
  'image': {
    minQueue: 130, maxQueue: 158,      // Gemini ~200원 (cost_ratio 0.20)
    tickIntervalSec: 30,               // 자연대기: 65~79분 (평균 72분 = 1.2h)
    adReduce: { min: 7, max: 12 },
    label: '커버 이미지',
  },

  // ─── 기타 ───
  'artist': {
    minQueue: 30, maxQueue: 50,        // 저렴, 유지
    tickIntervalSec: 20,               // 자연대기: 10~17분 (그대로)
    adReduce: { min: 5, max: 10 },
    label: '아티스트',
  },
  'video': {
    minQueue: 1944, maxQueue: 2376,    // MV ~3,000원 (cost_ratio 3.00)
    tickIntervalSec: 30,               // 자연대기: 972~1,188분 (평균 1,080분 = 18h)
    adReduce: { min: 108, max: 173 },
    label: 'MV 생성',
  },
};
```

### 광고 감소량 비례 조정 권장 여부 → **권장 (필수)**
- 자연대기가 평균 1.3~3.9배 길어졌으므로 광고 1회당 보상도 비례 확대 필요. 그렇지 않으면 사용자가 광고를 봐도 체감이 거의 없게 됨.
- **정책**: 평균 queueNumber의 **5~8% 단축**으로 통일. 즉 광고 약 12~20회 시청 시 완료 가능.
- 위 코드 블록의 `adReduce` 값이 이 정책을 이미 반영함.
- **예외**: Artist는 원래 짧으므로 5~10 그대로 유지.

### 영향 범위 (수정 파일 목록)
- `/Users/pearl/TripleJ/2_housing/stores/timerStore.ts`
  - **L25~L93**: `MODEL_QUEUE_CONFIG` 객체 전면 교체 (위 TypeScript 코드 블록으로)
  - **L12~L15**: 상단 주석을 위 코드 블록의 주석으로 갱신
- **그 외 파일 수정 불필요** (MapScreen.tsx, AdMob 핸들러, 백엔드 API 등은 전부 이 config를 참조하므로 자동 적응)

### 부수효과 재검토
1. **MapScreen tick 인터벌**: 1초 단위 글로벌 tick → tickIntervalSec(30) 보고 reduce 호출, 자동 적응. 영향 없음.
2. **AdMob 광고 보상**: getAdReduce()는 새 adReduce 범위를 그대로 사용. 안전.
3. **persist 미사용**: timerStore는 메모리 only → 진행 중 작업에 대한 마이그레이션 불필요.
4. **백엔드**: completeTask()가 백엔드 응답 시 즉시 호출되므로 자연대기보다 빨리 결과가 와도 정상 종료. **백엔드 코드 수정 0건**.
5. **MV 18h 우려**: MV는 cost_ratio 3.0이므로 수학적으로 18시간이 정당하나, 실제 Kling+FFmpeg는 5~15분에 완료됨. 백엔드 응답이 항상 자연대기보다 빨라 completeTask가 먼저 트리거되므로 UX 문제 없음. (광고 173/회로 약 12회면 완료 가능.)

### 다음 단계 (메인 에이전트가 처리)
- frontend-dev에게 timerStore.ts L25~L93 교체 지시 (위 코드 블록 그대로)
- 반영 후 tester가 Suno 평균 ≈360분, Opus 평균 ≈540분, MV 평균 ≈1,080분 산출되는지 단위 테스트 수행
