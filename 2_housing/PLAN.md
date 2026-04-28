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

---

## v26 - 2026-04-21 - PANN 브랜드 Sprint 1 착수

### 요청 작업
PLAN_v2.md (통합 로드맵 v2.1) 승인 후 Sprint 1 "브랜드 정체성 확립" 진행.

### 진행 내역

#### ✅ 1-1. theme/colors.ts 생성
- 경로: `theme/colors.ts`
- 구조: `bg` / `accent` / `text` / `status` / `border` / `gradient` / `legacy`
- 팔레트: 황혼의 보라 (Pan → Apollo)
- 편의 alias `C` 제공

#### ✅ 1-2. 하드코딩 HEX → theme 참조 리팩토링 (약 750건, 20개 파일)
- App.tsx, 19개 screens, MiniPlayer 완료
- 매핑 규칙 엄격 준수 (#e94560 → accent.primary 등)
- 매핑에 없는 특수 색상 10건은 `// TODO: 테마화 검토` 주석 처리 (랭크 메달 금은동 등)

#### ✅ 1-3. 새 보라 팔레트 적용
- theme/colors.ts에 새 값이 이미 들어 있으므로 1-2 리팩토링으로 자동 적용됨
- 모든 화면이 황혼 보라 톤으로 전환됨

#### ⏸ 1-4. expo-linear-gradient (보류)
- Metro 실행 중 설치 시 재시작 필요 → 다음 세션에 진행 권장
- 설치 명령: `cd 2_housing && npx expo install expo-linear-gradient`
- 적용 대상: SplashScreen 배경, MapScreen 상단, ChartScreen 헤더

#### ✅ 1-5. 로고 AI 생성 프롬프트 문서화
- 파일: `2_housing/logo_prompts.md`
- 5가지 프롬프트 버전 (미니멀/스토리/추상/워드마크/황혼)
- 컬러 HEX 전달용 표, 벡터화/PNG 변환 가이드 포함

#### ⏸ 1-6. 로고 적용 (사용자 생성 대기)
- AI로 생성된 로고 PNG/SVG를 `assets/logo/`에 넣으면 SplashScreen/Header/앱 아이콘에 적용 예정

#### ✅ 부가 작업: SplashScreen 브랜딩 업데이트
- 타이틀: "TripleJ" → **"PANN"**
- 서브타이틀: "Music Production Studio" → **"당신의 1인 기획사"**

### 다음 단계 (Sprint 2)
1. expo-linear-gradient 설치 후 Splash/Map/Chart 그라데이션
2. Sprint 2-1 ~ 2-11 작업 착수 (온보딩, 스텝퍼, 로딩 세분화, 프롬프트 매핑 등)

### 파일 변경
- 신규: `theme/colors.ts`, `PLAN_v2.md`, `logo_prompts.md`
- 수정: App.tsx, SplashScreen, MapScreen, ChartScreen, PlayerScreen, MyMusicScreen, PlaylistScreen, MusicLoadingScreen, MusicResultScreen, CoverGenerationScreen, MiniPlayer, 그 외 screens/ 19개

---

## v27 - 2026-04-21 - Sprint 1 마무리(그라데이션) + Sprint 2-11 곡 정보 보기

### 요청 작업
- expo-linear-gradient 설치 완료, 그라데이션 적용
- PlayerScreen 곡 정보 보기 버그 수정 (프롬프트 클릭 시 빈 화면)

### 진행 내역

#### ✅ 1-4 그라데이션 (Sprint 1 마무리)
- **SplashScreen**: 전면 황혼 그라데이션 적용 (`#0d0820 → #1e0e4a → #4c1d95 → #2a1758`)
- **ChartScreen**: 상단 160px 영역에 은은한 황혼 페이드 (`#2a1758 → transparent`)
- **MapScreen**: 배경 맵 이미지가 화면을 채우므로 Sprint 2의 작업실 UI 개편과 통합 처리하기로 보류

#### ✅ 2-11 PlayerScreen 곡 정보 보기 (버그 수정 + 정보 확장)
**버그 원인**: route.params.track은 차트/리스트의 축약 객체 → prompt/lyrics/bpm 등 미포함

**수정 내용**:
1. `fullTrack` state 추가, useEffect로 `GET /tracks/{id}` 호출하여 풀 데이터 fetch
2. bottom sheet에서 fullTrack 우선 사용 (fallback: route.params.track)
3. TrackData interface에 `tags`, `bpm`, `key`, `created_at`, `uploader_nickname` 추가
4. **상세 정보 탭 확장**: 제목, 아티스트, 장르, 분위기, 태그, BPM, 키, AI 모델, 길이, 재생수, 좋아요, 생성일 12개 필드
5. **프롬프트 탭 개선**:
   - 제목 라벨 "작사 프롬프트" 추가 (보라 강조)
   - 빈 경우 친절한 안내: "AI가 자동으로 생성했거나, 외부 업로드 곡일 수 있어요"
   - 로딩 중일 땐 "불러오는 중..."
6. 새 스타일 `detailSectionTitle` 추가

### 파일 변경
- 수정: `screens/SplashScreen.tsx`, `screens/ChartScreen.tsx`, `screens/PlayerScreen.tsx`

### 다음 단계 (Sprint 2 본격 진행)
- 2-1, 2-2, 2-3, 2-4: 작업실 UI 가이드 (스텝퍼/펄스/라벨/튜토리얼)
- 2-5: 온보딩 신설 (기획사 이름 + 호칭)
- 2-6: 작사/작곡 단계 바
- 2-7, 2-8: 로딩 단계 세분화 + 단계별 광고
- 2-9: 프롬프트 매핑 시각화

---

## v28 - 2026-04-22 - Sprint 2 잔여 + Sprint 3 통합 PR + Tailscale 전환

### 요청 작업
1. Sprint 2 잔여(2-7/2-8/2-10)와 Sprint 3 (이전 커밋 완료분) 하나의 큰 PR로 통합
2. 백엔드 서버 Tailscale 이전 대응 (cloudflared → `http://100.127.225.55:9003`)

### 계획
- **2-10 성장 곡선 UI (MyMusicScreen)**: 유저 정보 헤더를 성장 카드로 교체
  - 기획사명 / 대표님 / 레벨 (tracks.length / 3 + 1) / 총 재생수 / 베스트 트랙
  - 그라데이션 배경, 레벨 배지, 스탯 행
- **2-7 로딩 단계 세분화**: LyricsLoading/MusicLoading/CoverGeneration 3개 화면
  - 메시지 배열에 대응하는 스텝 인디케이터 (● ○ ○ ○ 형태 + 텍스트)
  - 현재 단계 보라색, 지난 단계 체크, 다음 단계 흐림 처리
- **2-8 단계별 광고 훅**: 현재는 인디케이터 표시까지만 (AdMob 통합은 후속)
  - 단계별로 "이 단계는 광고 1회로 스킵 가능" 문구 노출 준비
- **Tailscale URL 전환**: services/api.ts 한 곳에서 변경

### 작업 분배
- **planner**: PLAN.md / REPORT.md 기록
- **frontend-dev**: 3개 로딩 스크린 + MyMusicScreen + api.ts 편집
- **backend-dev**: (작업 없음 — 메모리 제약: 백엔드 코드 수정 금지)
- **tester**: 타입체크 및 주요 스크린 import 누수 확인

### 테스트 계획
1. `npx tsc --noEmit` (또는 expo TS 검사)로 타입 오류 확인
2. MyMusicScreen 성장 카드 렌더 (user 있는 경우 / tracks 있는 경우 / 없는 경우)
3. 3개 로딩 스크린 스텝 인디케이터 표시 확인
4. Tailscale URL 연결 — 사용자가 수동 테스트 (Expo Go에서 chart 로딩)

---

## v29 - 2026-04-22 - 회원가입 플로우 / 로그 API / 프롬프트 통합

### 요청 작업
1. **회원가입 필드 통합 스펙 문서화** (기획사명/호칭을 회원가입 시점에 DB 저장)
2. **로그 API 엔드포인트 존재 확인** (ping) + 앱팀 사용법 문서화
3. **PlayerScreen 프롬프트 라벨 통합** ("작사 프롬프트" → "작곡 프롬프트"로, 구조 정리)
4. (보류) PANN 로고 — AI 생성 대기

### 사용자 결정 사항
- 메모리 제약 유지: `0_platform_music/backend` 및 `backend_9003` 코드는 프론트에서 **수정하지 않음**
- 회원가입 필드는 **스펙 문서만** 백엔드 담당에게 전달
- 로그 API는 이미 백엔드에 배포됨 확인됨 (401 = 엔드포인트 존재) → 사용법만 문서화
- 작사/작곡 프롬프트 분리 대신 **작곡 프롬프트 하나로 통합 표시** (작사 프롬프트는 DB 미저장)

### 계획
- **`회원가입_필드_백엔드_요청.md`** 신규: DB 스키마 / Pydantic 모델 / 라우트 / 호환성 / 테스트 체크리스트 포함
- **`백엔드_로그_API_사용법.md`** 신규: curl 예시 / 토큰 관리 경고 / .zshrc alias / 앱 통합 방향
- **`PlayerScreen.tsx`** 수정:
  - prompt 탭 라벨 "작사 프롬프트" → "작곡 프롬프트"
  - 하위에 helper 문구 추가: "AI 작곡 시 전달된 스타일·분위기·악곡 정보입니다"
  - 프롬프트 텍스트 아래 **핵심 파라미터 칩 박스** (장르/분위기/BPM/키/AI모델/태그) 6개 필드 시각화
  - 빈 상태 문구 "작곡 프롬프트가 없습니다"로 수정
  - 스타일 추가: `detailHelperText`, `promptChipsBox`, `promptChipsLabel`, `promptChipsRow`, `promptChip`, `promptChipLabel`, `promptChipValue`

### 작업 분배
- **planner**: PLAN.md / REPORT.md 기록, 스펙 문서 구조 설계
- **frontend-dev**: PlayerScreen 수정, ping 실행
- **backend-dev**: (직접 수정 없음 — 스펙 문서로 요청 전달)
- **tester**: `tsc --noEmit` 타입 검증, 수동 테스트 항목 정리

### 테스트 계획
1. `tsc --noEmit` PASS (완료: 0 errors)
2. 로그 API ping — tail/download/info 모두 401 응답 (엔드포인트 존재 확인)
3. PlayerScreen 수동 확인:
   - 트랙 선택 → 우하단 정보 버튼 → "프롬프트" 탭
   - "작곡 프롬프트" 라벨 / helper 문구 / prompt 텍스트 / 핵심 파라미터 칩 박스 표시
   - 빈 트랙(프롬프트 없음)인 경우 "이 곡은 작곡 프롬프트가 없습니다" 표시
4. 백엔드 스펙 문서 리뷰 (백엔드 담당 jaekyu891에게 전달 → 머지 후 프론트 통합 작업)

---

## v30 - 2026-04-22 - 회원가입 필드 프론트 통합 (Onboarding 제거)

### 배경
- 백엔드에 `company_name`, `display_title` 필드 추가 머지 완료
- 프론트는 여전히 `onboardingStore`(in-memory)에서 읽어 **백엔드 반영이 안 됨**
- 로그아웃/재설치 시 사라지는 문제 그대로

### 요청 작업
온보딩 스토어/화면 제거 + 회원가입 시점에 기획사명/호칭 수집 → 백엔드 저장 → `user` 객체 구독

### 계획
- **`stores/authStore.ts`**: `AuthUser`에 `company_name`, `display_title` 옵셔널 추가. `register` 시그니처에 `companyName`, `displayTitle` 파라미터 추가. POST body에 둘 다 포함 (빈 문자열은 제외)
- **`screens/SettingsScreen.tsx`**: 회원가입 모드 폼에 2개 입력 필드 추가 (기본 호칭 "대표", 기획사명 비워두면 `${닉네임} 엔터테인먼트` 자동), helperText 추가. 프로필 카드에서 `company_name`/`display_title` 표시
- **`screens/SplashScreen.tsx`**: `useOnboardingStore` 제거, `isCompleted` 분기 제거. 항상 MainTabs로 이동
- **`screens/MyMusicScreen.tsx`**: `useOnboardingStore` 제거, `user.company_name` / `user.display_title`로 전환. 표기 `${닉네임} ${호칭}님`
- **`App.tsx`**: `OnboardingScreen` import / 라우트 / 타입 제거
- **삭제**: `screens/OnboardingScreen.tsx`, `stores/onboardingStore.ts`

### 테스트 계획
1. `tsc --noEmit` PASS
2. Splash 진입 → 바로 MainTabs (Onboarding 건너뜀)
3. Settings 탭 → 회원가입 → 기획사명/호칭 필드 입력 → 성공 → 로그인 상태
4. MyMusicScreen 성장 카드에 저장된 회사명/호칭 렌더
5. 로그아웃 → 재로그인 → 동일하게 표시 (DB 영속 확인)
6. Settings 프로필 카드에 회사명(보라) + 닉네임+호칭 표시

---

## v31 - 2026-04-22 - MapScreen 로그인 전 UI 숨김 + Settings 프로필 편집

### 요청 작업
1. 작업실(MapScreen) 로그인 전엔 **맵 + 캐릭터만** 표시 (스테퍼/방 라벨/펄스 등 UI 오버레이 숨김)
2. 기존 사용자(company_name NULL → fallback)도 **Settings에서 수정 가능**하도록 프로필 편집 기능 추가

### 사전 확인
- `PATCH /api/auth/me/profile` 엔드포인트 ping 결과 HTTP **401** → 엔드포인트 존재, 인증만 추가하면 사용 가능

### 계획
- **`screens/MapScreen.tsx`**: 조건부 렌더링
  - `{user && ...}` 로 스테퍼 바 감싸기
  - 방 라벨 뷰도 `{user && ...}`
  - 펄스 글로우 조건에 `user &&` 추가 (`isNext = user && type === next && !task`)
  - 튜토리얼 Modal은 이미 `user && !tutorialShownRef`로 게이팅됨
- **`stores/authStore.ts`**:
  - `updateProfile(patch)` 액션 추가 — `PATCH /auth/me/profile` 호출, 응답으로 user 병합
  - 에러는 `error` state로 노출
- **`screens/SettingsScreen.tsx`**:
  - 프로필 카드 아래 "**기획사 정보 편집**" 버튼 추가 (아웃라인 스타일)
  - 모달: 기획사명 / 호칭 2개 입력 + 저장/취소 버튼
  - 저장 성공 시 `user`가 authStore에서 즉시 반영됨 → 프로필 카드 자동 갱신
  - 빈 입력 시 기본값(`${닉네임} 엔터테인먼트` / `대표`) 자동 채움
  - 스타일 9개 추가 (profileEditBtn / modalOverlay / modalBox / modalTitle / modalLabel / modalBtn{Row,Cancel,Save} / 텍스트)

### 테스트 계획
1. `tsc --noEmit` PASS
2. **로그아웃 상태**에서 작업실 탭 진입 → 맵 + 캐릭터만, 상단 스테퍼 없음, 방 라벨 없음, 펄스 없음, 캐릭터 탭 시 로그인 오버레이 유지
3. **로그인 상태**로 전환 → 스테퍼/라벨/펄스/튜토리얼 모두 등장
4. Settings → 로그인 상태 → "기획사 정보 편집" 버튼 → 모달 → 값 입력 → 저장 → 프로필 카드 즉시 갱신
5. 모달 비워두고 저장 → fallback 값 자동 입력
6. 로그아웃 → 재로그인 → 수정한 값 유지 (DB 영속)

---

## v32 - 2026-04-22 - 작업실 UX 대개편 (엔터명 헤더/펄스 중앙/단계 스테퍼)

### 요청 작업 (6건)
1. 작업실 헤더와 방 라벨에 **엔터명** 노출 (로그아웃 시 "작업실")
2. 방 라벨 제거, **디렉터 명**을 캐릭터 아래에 눈에 띄게
3. 튜토리얼을 **헤더 고정 버튼(❓)**으로 토글
4. 펄스에 **캐릭터 중앙 배치 + "클릭해서 작업 시작!" 문구**
5. 대화/프롬프트 리뷰의 **'당신' → `{호칭}님`**, "AI에게 전달할 프롬프트" → "작사 디렉터에 전달할 내용"
6. 상단 진행 스테퍼 제거 → **디렉터 클릭 시 6단계 스테퍼 팝업**으로 재설계. "작사 대기중" → "작사중"

### 계획
- **`MapScreen.tsx`**:
  - `useLayoutEffect`로 Studio 탭 parent에 `headerTitle: user?.company_name || '작업실'`, `headerLeft: ❓ 튜토리얼 토글` 주입
  - 첫 방문 자동 튜토리얼 `useEffect` 제거 (수동 토글만 남김)
  - `DIRECTOR_ROOM_LABEL` 상수 제거, 대신 `DIRECTOR_NAMES`를 캐릭터 **아래(y+50)**에 보라 배경 라벨로 표시
  - 펄스 원 크기 확대 (100→140 mapScale, 반투명 보라 backgroundColor 추가). 캐릭터 기준점 (x, y)로 중앙. "▸ 클릭해서 작업 시작!" 배지 (y+90)
  - 상단 `stepperBar` 블록 제거, 관련 styles 교체
  - 팝업 Modal을 **단계 스테퍼 구조로 완전 재구성**:
    - 헤더: 포트레이트 원형 + 디렉터명 + 현재 taskName 배지
    - 전체 진행률 바 (queueNumber / initialQueue)
    - 6단계 아이콘 스테퍼 (done ✓ / active 보라 / pending 회색)
    - 현재 단계 상세 카드 (아이콘 + 설명)
    - 광고 버튼 문구: "광고 보고 이 단계 빠르게 끝내기" + helper
  - `showAdAndReduceQueue`: `reduceAmount = Math.max(stageSize, baseReduce)` 로 광고 1회=최소 한 단계 앞당김

- **`stores/timerStore.ts`**:
  - `TimerTask`에 `initialQueue` 필드 추가 (진행률 계산용)
  - `DIRECTOR_STAGES` 상수 신설: lyricist/composer/wondera/image/artist/video 6종 × 6단계 (name/icon/description)
  - `TOTAL_STAGES = 6` export
  - `getCurrentStage(type)`: `Math.floor(progress * 6)` 반환 (0..5)
  - `getStageSize(type)`: `Math.ceil(initialQueue / 6)` 반환 (광고 감소량 기준)

- **`LyricsPromptReviewScreen.tsx`**:
  - `useAuthStore` 구독, `titleLabel = user?.display_title || '대표'`
  - "당신의 12가지 답변" → `${titleLabel}님의 12가지 답변`
  - "② 자동 변환된 프롬프트" → "② 작사 디렉터에 전달할 내용"
  - "① 당신의 선택" → `① ${titleLabel}님의 선택`
  - "② AI에게 전달할 프롬프트 (자동 생성됨)" → "② 작사 디렉터에 전달할 내용 (자동 생성됨)"
  - `startTask('lyricist', '작사 대기중')` → `'작사중'`

### 테스트 계획
1. `tsc --noEmit` PASS
2. 작업실 헤더: 로그아웃 시 "작업실", 로그인 시 엔터명 표시
3. 헤더 좌측 ❓ 아이콘 탭 시 튜토리얼 모달 토글 (첫 방문 자동 오픈 X)
4. 각 캐릭터 아래 보라 디렉터명 라벨
5. 다음 액션 디렉터 펄스: 캐릭터 중앙 + 하단에 "클릭해서 작업 시작!" 배지
6. 작사 디렉터 클릭 (프롬프트 없는 상태) → 대화 플로우 → 프롬프트 리뷰 화면: "{호칭}님의 12가지 답변" / "작사 디렉터에 전달할 내용"
7. 프롬프트 확정 → 맵 복귀, 작사 티켓에 "작사중" 표기 (이전 "작사 대기중" 아님)
8. 작업 중인 디렉터 재클릭 → 6단계 스테퍼 팝업
   - 포트레이트 + 디렉터명 + "작사중" 배지
   - 진행률 % + 대기번호 표시
   - 6개 아이콘 스테퍼 (현재 단계 보라 활성)
   - 현재 단계 설명 카드
   - "광고 보고 이 단계 빠르게 끝내기" 버튼 → 한 단계 분량 앞당김

---

## v33 - 2026-04-22 - 로그아웃 시 헤더 ❓ 버튼 제거

### 요청 작업
로그아웃 상태일 때 작업실 헤더에 `❓ 작업실`로 뜨는데, 튜토리얼 버튼을 감추고 순수하게 `작업실`만 표시

### 계획
- `MapScreen.tsx` `useLayoutEffect`의 `headerLeft`를 `user ? () => <❓ 버튼> : undefined` 삼항으로 변경
- 의존성 배열에 `user` 추가 (로그인/로그아웃 전환 시 즉시 반영)

### 테스트 계획
1. `tsc --noEmit` PASS
2. 로그아웃 상태 → 작업실 헤더: **"작업실"** (❓ 없음)
3. 로그인 상태 → **❓ 작업실** (정확히는 좌측 ❓ + 중앙 엔터명)
4. 로그인/로그아웃 토글 시 즉시 반영

---

## v34 - 2026-04-22 - 헤더 툴팁 정렬 + 캐릭터 이동 + 맵 레이어 분리

### 요청 작업
1. "도움말을 보려면 클릭하세요" 말풍선을 맵 위가 아닌 **헤더 ⓘ 아이콘 바로 아래** 정렬
2. 캐릭터가 방 안에서 **이동**, 벽/가구1보다 위·**가구2+보다 아래** 레이어, 타이틀은 **박스 없는 텍스트**로 캐릭터 함께 이동

### 계획
- **`render_map.py`**: TMX 레이어 이름 기반으로 bg(바닥~가구1)/fg(가구2~가구5) 두 장의 PNG 분리 렌더. `map_bg.png`, `map_fg.png` 생성
- **`MapScreen.tsx`**:
  - `MAP_IMAGE` → `MAP_BG` + `MAP_FG` 두 장으로 분리
  - bg는 캐릭터 아래, fg는 캐릭터 위(zIndex 15), UI 라벨은 fg 위(zIndex 25~26)
  - 툴팁 `right: 42` → `right: 52, marginRight: -4`로 ⓘ 아이콘 중앙 정렬
  - 디렉터 네임태그 박스 제거, Character 컴포넌트 내부로 이동 (함께 움직이도록)
  - 기존 `styles.nametagB*` 스타일 → `styles.nametagRole/Name` 텍스트 전용 (textShadow로 가독성 확보)
  - `Image` 에 pointerEvents prop 직접 못 씀 → 부모 `View`에 pointerEvents 감싸서 처리
- **`Character.tsx`**:
  - `useRef(new Animated.Value(0))` 2개 (offsetX/Y)
  - 3초 순환 cycle마다 walk 애니메이션 시작 시 방향별 delta 계산, `Animated.timing` 2500ms로 이동
  - idle/read/drink 단계에선 원점(0,0) 근처로 1500ms로 감쇠 → 방 밖으로 벗어나지 않음
  - WALK_RADIUS_X=60, WALK_RADIUS_Y=35 (맵 좌표 기준)
  - `name`, `roleEn` props 추가 → 캐릭터 머리 위 textShadow만 있는 텍스트 라벨 렌더 (이동에 자동 동행)
  - 외곽 `TouchableOpacity` → `Animated.View` + 내부 `TouchableOpacity` (transform 받기 위함)

### 테스트 계획
1. `tsc --noEmit` PASS
2. 로그인 상태 작업실 진입 → ⓘ 아이콘 바로 아래에 보라 말풍선 "도움말을 보려면 클릭하세요"
3. 캐릭터 3초마다 walk 단계에서 방 안을 소폭 이동 (±60/±35 맵 좌표)
4. 디렉터 이름(작사 디렉터 등)이 캐릭터 머리 위에 **박스 없이** 텍스트로 떠 있고 **함께 움직임**
5. 가구2 이상 (의자/액자/책 등) 이 캐릭터 앞에 자연스럽게 겹쳐 보임 (캐릭터가 가려질 수 있음)
6. 벽/가구1은 캐릭터 뒤 (자연스러움)
7. "클릭해서 작업 시작!" 배지는 가구도 뚫고 항상 보임 (zIndex 26)

---

## v35 - 2026-04-22 - 헤더 힌트를 ⓘ 왼편으로, 네임태그 캐릭터 아래/가까이, 배지 펄스 위

### 요청 작업
1. 힌트 말풍선을 **헤더 안 ⓘ 아이콘 왼쪽**에 배치 (아래가 아님)
2. 캐릭터 이동 동선을 **가구 없는 바닥만**으로 (방별 walk 반경 축소)
3. 디렉터 네임태그를 **캐릭터 아래**로, 최대한 가깝게
4. "클릭해서 작업 시작!"을 **펄스 위쪽**으로

### 계획
- **MapScreen 헤더 재구성**: `headerRight`에 `[말풍선][꼬리▶][ⓘ][⋮]` 가로 배치
  - 말풍선 탭 → 힌트 dismiss
  - 꼬리(borderLeft 삼각형)가 오른쪽 ⓘ를 가리킴
  - 힌트 상태 변화 반영: `useLayoutEffect` 의존성에 `showTutorialHint`, `showTutorial` 추가
  - 본문의 기존 `tutorialHintWrap` 블록 제거
- **walk 반경 축소 & 디렉터별 튜닝**:
  - `DIRECTORS` 배열에 `walkRadiusX/Y` 필드 추가
  - Character.tsx: 상수 `WALK_RADIUS_X/Y` 제거 → props 받음 (기본값 30/15)
  - 기본값을 60→30, 35→15로 절반 축소
  - 작곡/Wondera는 한 방에 2명이라 더 좁게 (30/18)
- **네임태그 위치**: `top: -40` → `top: 64 * spriteScale + 2` (sprite 바로 아래 2px)
  - 순서도 반전: 이름(큰 글씨) 먼저, roleEn(작은 영문)이 아래로
- **"클릭 시작!" 배지**: `top: (d.y + 70) * mapScale` → `top: (d.y - 70) * mapScale - 40` (펄스 상단보다 40px 위)

### 테스트 계획
1. `tsc --noEmit` PASS
2. 로그인 상태에서 헤더: `[도움말을 보려면 클릭▶] ⓘ ⋮` 한 줄에 배치
3. 힌트 탭 시 말풍선 사라지고 ⓘ만 남음 / ⓘ 탭 시 튜토리얼 열리고 힌트도 사라짐
4. 캐릭터가 방 바닥 영역 안에서만 소폭 이동 (의자/책상 타고 올라가지 않음)
5. 네임태그가 캐릭터 발 바로 아래에 바짝 붙어 표시 + 이동 시 동행
6. "클릭해서 작업 시작!"이 캐릭터 위쪽, 펄스 링 상단 밖에 배치

---

## v36 - 2026-04-22 - 디렉터 walk zone TMX 기반 자동 추출

### 요청 배경
v35에서 방별 walk 반경을 임의값(35/20, 30/18)으로 줬던 접근은 실제 방 구조를 반영하지 못함.
→ TMX 바닥 레이어에서 자동 산출하여 "방마다 다른 바닥 모양"이 정확히 반영되도록 재설계.

### 계획

**1. `render_map.py` 확장**
- TMX 렌더링 루프에서 타일 위치 수집
  - `floor_tiles`: 바닥 레이어의 모든 (tx, ty)
  - `blocker_tiles`: 걸레받이/벽/가구1~5 레이어의 (tx, ty)
- `walkable = floor_tiles - blocker_tiles`
- 각 디렉터 위치 (px, py)에서:
  - 타일 좌표 (px/32, py/32)가 walkable이 아니면 가장 가까운 walkable 타일로 앵커 이동 (디렉터가 책상 타일에 앉아 있을 수 있어 필요)
  - 앵커부터 4방향 BFS로 walkable 타일만 연결 탐색, Manhattan 깊이 최대 4 (≈128px)
  - 각 타일 중심의 map-px 좌표를 디렉터 베이스 위치 기준 delta로 변환
- `assets/director_walk_zones.json` 생성

**2. `MapScreen.tsx`**
- `WALK_ZONES = require('../assets/director_walk_zones.json')`
- `DIRECTORS` 배열에서 walkRadiusX/Y 필드 제거
- Character에 `walkDeltas={WALK_ZONES[d.type]}` 전달

**3. `Character.tsx`**
- Props `walkRadiusX/Y` 제거 → `walkDeltas: Array<[number, number]>`
- `currentDeltaRef`로 현재 상대 위치 추적
- walk 시작 시:
  1. walkDeltas에서 무작위 1개 선택
  2. 현재 위치와 Manhattan 거리 < 32 (1타일 미만)이면 최대 3회 재추첨
  3. 이동 방향에 따라 스프라이트 direction 설정 (x/y 차이 크기 비교)
  4. Animated.timing 2500ms로 offsetX/Y 이동
- idle/read/drink 단계에선 원점 복귀 없음 (일한 자리에서 동작 → 자연스러움)

### 테스트 계획
1. `python3 render_map.py` — 각 디렉터별 zone 타일 수 확인 (10+ 타일 기대)
2. `tsc --noEmit` PASS
3. Expo Go에서:
   - 각 방마다 캐릭터가 **실제 바닥 영역 안에서만** 이동
   - 책상/의자 침범 없음
   - 방 모양이 다른 방(작사실 vs 아티스트실)에서 이동 패턴이 다르게 보여야 함
4. TMX 수정 시 `render_map.py` 재실행 → 자동 반영 확인

---

## v37 - 2026-04-24 - UI 정돈 7건 (제자리/라벨 박스/문구/비용/대화형/아티스트 생성)

### 요청 작업
1. 캐릭터 이동 제거 (제자리), 디렉터 라벨을 작은 둥근 테두리 박스로
2. 캐릭터 위 티켓을 "~하는 중", 완료 시 "~일을 완료했어요!"로 변경, 대기번호 숨김
3. 단계당 광고 1회 가정 비용 재계산 (문서)
4. 작곡 디렉터 세부 설정을 대화형(질문+답 스킵/적용)으로 전환
5. 아티스트 디렉터 페이지를 "사진→캐릭터→코디" 대화 플로우로 재구성
6. 솔로 선택 시 서브보컬이 Suno에 전송되지 않는지 검증
7. "대기번호 드릴게요" → "~를 시작할게요!"로 대화 멘트 교체

### 계획 & 근거

- **#1 제자리**: `Character.tsx`의 walk 애니메이션 로직 제거 (walkDeltas 수신만, void 처리). 라벨은 박스 + 둥근 테두리 + 작은 글씨(10pt)로 축소. `characterStyles.nameBadge/nameText` 추가. roleEn은 제거(박스 디자인 간소화)
- **#2 "작사 중" 용어**: 캐릭터 위 티켓에 `task.taskName + 중` / `task.taskName + 일을 완료했어요!` 표시. 대기번호 숫자 완전 삭제. 팝업 진행률 텍스트에서도 "대기번호 #N" 제거. 튜토리얼 4번 문구도 "광고를 보면 현재 단계를 빠르게 끝낼 수 있어요"로 교체
- **#3 비용 재계산**: `비용_재계산_v37.md` 신규. 광고 1회=1단계 기준 모델별 손익 테이블. 결론: 현재 timerStore 수치 유지 + 비즈니스적으로 Free/Pro 플랜 분리 권장
- **#4 작곡 대화형**: DIRECTOR_MESSAGES를 7개→12개로 확장 (step 6~11이 각 세부 설정). 각 단계에서 Switch 제거, [건너뛰기] / [적용] 2-버튼 UI. 슬라이더는 항상 노출, 양 끝에 "자유롭게 ↔ 엄격하게" 등 라벨. handleAdvancedConfirm → handleNegativeConfirm 등 6개 핸들러로 분할
- **#5 아티스트 재구성**: 기존 ArtistDirectorScreen(목록) 완전 재작성. 대화 흐름: 사진 → 코디(상의/하의/신발) → 스타일 텍스트 → `POST /character/generate-sheet` → 프리뷰 → [다시/미세조정/저장]. 백엔드 엔드포인트: `/character/generate-sheet, /character/save, /character/me, /character/refine, /character/me DELETE`, `/business/ads/active?category=`, `/business/ads/{id}/impression`. ImagePicker 설치 안 되어 있어 `expo-document-picker`의 `type: 'image/*'`로 대응
- **#6 서브보컬 검증**: `musicService.ts:92-110` 확인. `isDuet = params.isDuet || false`, `if (isDuet && params.subVocal) { ... }`로 솔로 시 서브보컬 차단됨. **정상**
- **#7 대기번호 드릴게요**: CoverGenerationScreen "대기번호를 드릴게요!" → "커버 작업을 시작할게요! 곧 결과를 보여드릴게요." MusicGenerationScreen `handleGenerate`에 "작곡을 시작할게요! 곧 결과를 보여드릴게요." 채팅 추가 후 1.5초 뒤 맵 이동

### 테스트 계획
1. `tsc --noEmit` PASS (0 errors)
2. Expo Go에서:
   - 캐릭터 제자리 + 라벨 박스 렌더 확인
   - 작업 시작 후 캐릭터 위 티켓이 "작사 중" / 완료 후 "작사 일을 완료했어요!"
   - 작곡 세부 설정 6단계 대화로 Switch 없이 흘러가는지
   - 아티스트 디렉터 진입 → 사진 업로드 → 코디 선택 → 텍스트 입력 → 생성 → 프리뷰 → 저장 전체 흐름
3. Expo Go에 `expo-image-picker`가 필요한 UX가 있다면 후속 개선 (현재는 document picker로 대응)

---

## v38 - 2026-04-24 - UI 버그 수정 4건 + 디렉터 영입 시스템 설계

### 요청 작업
1. 미니→풀 플레이어 전환 시 재생바 멈춤 수정
2. 차트에 장르 배지 추가
3. 플레이리스트 썸네일을 내부 트랙 커버 모자이크로
4. 캐릭터 맵 최상위 레이어
5. 디렉터 영입 시스템 설계 제안

### 계획 & 근거
- **#1**: PlayerScreen이 미니에서 sound를 이어받을 때 `setOnPlaybackStatusUpdate`를 재설정하지 않아 local state가 업데이트 안 되던 것이 원인. useEffect에서 콜백 재등록
- **#2**: `ChartTrack.genre`를 `string | string[]` 유연화. renderTrack statsRow에 `genreBadge` 추가 (보라 아웃라인)
- **#3**: fetchPlaylists 후 `Promise.all`로 각 `/playlists/{id}` 병렬 로드하여 상위 4곡 커버 이미지 수집. 렌더에서 2x2 모자이크 그리드
- **#4**: Character.tsx의 zIndex 10→20으로 변경. fg(zIndex 15)보다 위에 배치
- **#5**: `디렉터_영입_시스템_설계_v38.md` 신규 — 7장 분량 설계 문서. 캐시(💎) 경제, 디렉터 라인업, DB 스키마, API 스펙, Phase 1~4 로드맵, 결정 필요 지점 4가지

### 테스트 계획
1. `tsc --noEmit` PASS
2. 미니플레이어에서 재생 중인 곡 탭 → 풀스크린 진입 → **재생바 자동 진행** 확인
3. 차트 항목에 보라 테두리 장르 배지 노출
4. 플레이리스트 카드에 4분할 커버 이미지 (없으면 기본 ♫ 아이콘)
5. 맵 작업실 캐릭터가 가구 앞에 표시 (가려지지 않음)
6. `디렉터_영입_시스템_설계_v38.md` 검토 후 Phase 1 MVP 착수 여부 결정

---

## v39 - 2026-04-24 - 디렉터 영입 시스템 Phase 1 MVP 구현

### 요청 작업
사용자 "만들어보자" 승인 → v38 설계 문서의 Phase 1 전체 구현

### 결정 반영
- 캐시 단가: 제안대로 (곡당 작사 30+작곡 50+커버 20 = **100 💎** / 광고 단계 스킵 +5 💎)
- 무료 시작: **미니 + 원더라 + 지민(이미지) + 해나(아티스트)** 자동 지급
- 수노는 영입 유도 (3,500 💎)
- MV는 10,000 💎 잠금

### 신규 파일
- `data/directors.ts` — 9명 카탈로그 + INITIAL_DIRECTOR_IDS + GEM_REWARDS/COSTS 상수
- `stores/gemsStore.ts` — 잔액/거래 in-memory zustand (persist는 v40에 AsyncStorage 추가 예정)
- `stores/directorsStore.ts` — hiredIds / selectedByCategory / hire / selectForCategory / getSelectedModelKey / initIfEmpty
- `screens/DirectorLineupScreen.tsx` — 카테고리별 그리드, 영입/선택 전환, 잔액 표시, 부족 시 안내

### 수정 파일
- `App.tsx` — DirectorLineup 라우트 등록
- `MapScreen.tsx` — 로그인 시 initGems/initDirectors, 헤더에 💎 잔액 Pill (탭하면 영입 화면), 작사 디렉터 클릭 시 영입자 2명 이상이면 선택 모달, 광고 시청 시 +5 💎 보너스
- `LyricsPromptReviewScreen.tsx` — useDirectorsStore.getSelectedModelKey('lyricist')를 startTask에 전달
- `MusicGenerationScreen.tsx` — selectedModel로 dirType/modelKey 결정 후 startTask 호출
- `LyricsLoadingScreen.tsx` — 가사 생성 성공 시 earn(30, 'track_lyrics_done')
- `MusicLoadingScreen.tsx` — 음악 생성 완료 2곳 (polling 완료 + direct 완료) 모두 earn(50, 'track_music_done')
- `CoverGenerationScreen.tsx` — handleConfirm에 earn(20, 'track_cover_done')

### 테스트 계획
1. `tsc --noEmit` PASS
2. 로그인 직후 💎 100 보너스 + 작사/원더라/이미지/아티스트 기본 영입 확인
3. 헤더 💎 잔액 → 탭 → 영입 화면 이동
4. 영입 화면에서 다른 디렉터 영입 시도 → 캐시 부족 시 alert
5. 작사 디렉터 2명 이상 영입 후 작사실 클릭 → 선택 모달
6. 곡 생성 완료 시 잔액 자동 증가 (작사 30 / 작곡 50 / 커버 20)
7. 광고 시청 시 +5 💎 보너스

---

## v40 - 2026-04-25 - 자동 재생 / Wondera 제거 / 아티스트 디렉터 흐름 정비

### 요청 작업 6건
1. 풀↔미니 전환 시 다음 곡 자동 재생 끊기는 버그
2. 작곡 디렉터 단순화 — Wondera 제거, "작곡 디렉터" 단일 표기
3. 아티스트 디렉터 Dialogue 진입 + safe area + 원형 포트레이트 얼굴 표시
4. 광고 아이템(상/하/신발) 5개씩 샘플 fallback
5. /character/refine 422 에러 수정
6. 캐릭터 재생성 불가 + 처음엔 속옷 캐릭터 → 코디로 옷 입히기

### 계획 & 근거

- **#1**: PlayerScreen `onPlaybackStatusUpdate`의 `didJustFinish` 분기에 자동 다음 곡 로직 추가. `usePlayerStore.getState().queue/currentIndex` 확인 후 다음 곡으로 `navigation.replace('Player', { track: nextTrack })` → 화면이 unmount→mount되며 sound 자동 재생성
- **#2**: 맵 DIRECTORS 배열에서 `wondera` 제거. DIRECTOR_NAMES `composer/wondera`를 모두 "작곡 디렉터"로 통일. 카탈로그에서 `cmp_wondera` 삭제, `cmp_suno`를 `hireCost: 0, isDefault: true`로 변경. INITIAL_DIRECTOR_IDS에서 wondera→suno 교체. MusicGenerationScreen `startTask`도 `composer/composer` 고정. DialogueScreen / DirectorLineupScreen 라벨 정리
- **#3**:
  - MapScreen `handleDirectorPress`의 `'artist'` 분기를 `getParent()?.navigate('ArtistDirector')` → `navigation.navigate('Dialogue', { directorType: 'artist', ... })`로 변경
  - DialogueScreen `case 'artist'`를 인사 → 안내 → 시작 선택지로 확장. 마지막 노드 `action: 'navigate:ArtistDirector'`
  - DialogueScreen `handleAction/handleChoice`에 ROOT_TARGETS 분기 추가 (ArtistDirector, ArtistDetail, DirectorLineup, Player, Settings은 `navigation.getParent()?.navigate`로 우회) + `goBack` 처리
  - ArtistDirectorScreen `dirPortrait` 44x44 + `dirPortraitImg` 비율 유지 `width:44, height:44*405/95` → 첫 frame(머리)이 원에 정확히 들어옴
  - 모든 `inputArea`에 `paddingBottom: 24 + insets.bottom` 적용 (홈 인디케이터 회피)
- **#4**: ArtistDirectorScreen에 `SAMPLE_ITEMS`(5개씩×3 카테고리) 정의, `openPicker`에서 백엔드 응답이 비면 fallback
- **#5**: 백엔드 `/character/refine` 라우트가 요구하는 필드 확인 — `sheet_image: File`, `photo: File`, `refine_request: Form`. 기존 `sheet_object_name`+`user_text` 잘못 보내고 있어서 422 발생. `handleRefine`을 prevewUrl/photoUri/refineText로 multipart 재구성
- **#6**: Step 흐름 재설계
  - `welcome → style_text → generating → preview → cody → refining(옷적용) → preview → done` 순환
  - `handleGenerate`: user_text에 항상 "기본 의상(흰 민소매+검정 쫄바지+맨발)" prepend → 첫 캐릭터는 항상 속옷
  - `handleSave(true)` 후 자동으로 `step='cody'` 진입
  - `handleApplyOutfit`: 선택된 상/하/신발 이름을 `refine_request`에 텍스트로 전달, `/character/refine` 호출 → 옷 입은 시트로 갱신
  - `handleRegenerate` 제거 (재생성 불가 정책). preview 단계 버튼: [이 부분 수정] / [옷 입히러 가기] / [저장]
  - `handleReset` 제거. 기존 캐릭터 보유 시 myArtistCard에서 "옷 갈아입기" 버튼만

### 테스트 계획
1. `tsc --noEmit` PASS (확인됨)
2. 차트에서 곡 재생 → 풀스크린 미니 토글 후 곡 끝까지 재생 → 다음 곡 자동 시작
3. 맵에서 Wondera 캐릭터 사라짐, 작곡 디렉터 1명만
4. 영입 화면에서 작곡 1명 (수노, 기본 지급)
5. 작업실 → 아티스트 디렉터 클릭 → Dialogue 화면 인사 후 "시작하기" → ArtistDirector 진입
6. 원형 포트레이트에 얼굴이 보임
7. 사진 촬영 버튼이 홈 인디케이터에 안 가림
8. 코디 모달 → 광고 0건이면 샘플 5개 자동 노출
9. 사진 업로드 → 컨셉 입력 → 속옷 차림 캐릭터 생성
10. 저장 후 코디 진입 → 옷 선택 → "이 옷으로 입혀보기" → refine 422 없이 성공 → 옷 입은 시트
11. preview에서 "이 부분 수정" 텍스트 입력 → refine 호출 → 갱신
- 2-10: 성장 곡선 UI

---

## v41 - 2026-04-27 - AsyncStorage persist + 아티스트 디렉터 6단계 대화 + previewUrl 자동 + 프로필 수정 백엔드 요청

### 요청 작업
1. **A. AsyncStorage persist** — `gemsStore`, `directorsStore`, `playerStore` 영속화 (앱 재시작 후에도 잔액·영입·플레이어 상태 유지)
2. **B-1. DialogueScreen 'artist' 정리** — "준비되었으면 시작해볼까요? / 네 / 나중에" 노드 제거, 인사 후 자동으로 ArtistDirector 진입
3. **B-2. ArtistDirectorScreen 6단계 대화** — 단조로운 한 줄 컨셉 입력을 머리/얼굴/피부/체형/키/분위기 6개 질문으로 분할. 각 단계 빠른 선택 칩 + 자유 입력 + [건너뛰기]/[다음]
4. **B-3. previewUrl 자동 채우기** — 기존 myCharacter 보유자 진입 시 백엔드 `preview_url` 응답을 즉시 `previewUrl` state에 주입 → "옷 갈아입기"가 매끄럽게 동작
5. **C. 백엔드 요청서 작성** — 프로필 수정(닉네임/비밀번호/bio) PATCH 엔드포인트가 백엔드에 부재. `백엔드_요청_프로필수정.md` 작성 (실제 PATCH 호출 구현은 백엔드 반영 후)

### 계획 & 근거

- **A**: zustand `persist` 미들웨어 + `createJSONStorage(() => AsyncStorage)`. `expo install @react-native-async-storage/async-storage`로 SDK 54 호환 버전 설치. 각 store에 `name` 부여:
  - `gems-storage-v1`: balance + transactions
  - `directors-storage-v1`: hiredIds + selectedByCategory
  - `player-storage-v1`: track / queue / currentIndex 만 (sound 객체는 native module이라 직렬화 불가, isPlayerScreenOpen은 휘발성). `partialize`로 제외
  - `initIfEmpty`는 그대로 둠 — persist hydration 후에 빈 상태일 때만 동작
- **B-1**: DialogueScreen.tsx `case 'artist'` 노드 3개를 2개로 축소. 노드 2의 next는 제거하고 `action: 'navigate:ArtistDirector'`. ROOT_TARGETS 분기는 v40에서 이미 추가됨
- **B-2**: 새 step 타입 `q_hair`, `q_face`, `q_skin`, `q_body`, `q_height`, `q_mood` 추가. 단계별 답변 state `styleAnswers`. 각 단계 UI 공통 컴포넌트 (`renderQuestionStep`):
  - 빠른 칩 탭 → 입력창에 토큰 추가 (이미 있으면 제거)
  - [건너뛰기] → 답변 빈 문자열로 다음 단계
  - [다음] → 답변 저장, 다음 단계
  - 마지막 q_mood [다음]에서 자동 generating 진입
  - 칩 풀:
    - 머리: [긴 생머리, 단발, 컬리, 짧은컷, 검정, 갈색, 밝은톤]
    - 얼굴: [큰 눈, 날카로운, 부드러운, 둥근 얼굴, 갸름한 얼굴]
    - 피부: [하얀, 자연스러운, 그을린]
    - 체형: [마른, 보통, 글래머, 근육질]
    - 키: [아담, 보통, 키 큰]
    - 분위기: [도시적, 청순, 강렬한 록, 청량, 몽환적]
  - finalText 합성: `머리는 X, 얼굴은 Y, 피부는 Z, 체형은 W, 키는 V, 분위기는 U` (빈 항목은 스킵)
- **B-3**: useEffect `/character/me` 응답에서 `preview_url`이 있으면 `setPreviewUrl(BACKEND_BASE_URL + preview_url)` 와 `setPreviewObjectName(sheet_object_name)`. 기존 `existingPreview` 변수는 `previewUrl`로 대체 가능
- **C**: 백엔드 grep 결과 `auth.py`에 PATCH/PUT 라우트 부재. `upload.py`로 profile_image 업로드만 가능. 닉네임/비밀번호/bio 변경 엔드포인트가 모두 없음. 요청서 작성:
  - `PATCH /api/auth/me/profile` — 닉네임, bio, display_title, company_name 부분 업데이트
  - `PATCH /api/auth/me/password` — 현재 비밀번호 검증 + 새 비밀번호
  - 응답 스키마, 에러 케이스, 검증 규칙 명시

### 테스트 계획
1. `tsc --noEmit` PASS (0 errors)
2. **A 영속**:
   - 곡 생성 → 잔액 +30/+50/+20 적립 → 앱 완전 종료 → 재시작 → 잔액 그대로
   - 디렉터 영입 → 앱 재시작 → 영입 유지
   - (참고) 100💎 자동 재지급 안 됨 (이미 데이터 있으므로 initIfEmpty 스킵)
3. **B-1**: 작업실에서 아티스트 디렉터 클릭 → 인사 2개 → **선택지 없이 자동으로 ArtistDirector** 진입
4. **B-2**: ArtistDirector → 사진 업로드 → 6단계 질문 차례대로 → 각 단계 칩 탭/직접 입력/건너뛰기 → 마지막 [다음]에서 generating
5. **B-3**: 기존 캐릭터 보유 상태로 ArtistDirector 진입 → 상단 myArtistCard 표시 → "옷 갈아입기" 탭 → cody 단계로 즉시 진입 (refine 호출 시 422 없이 성공)
6. **C**: `백엔드_요청_프로필수정.md` 파일 존재, 스키마 정확

### 특이사항 예상
- A 적용 시 첫 진입에서 hydration 잠깐 빈 상태로 보일 수 있음 → 필요시 `onRehydrateStorage` 콜백으로 처리. 이번엔 깜박임 무시(MVP)
- B-2 답변이 모두 빈 경우(전부 건너뛰기) → 기존 "건너뛰고 만들기" 동작과 동일하게 baseAttire만 전송
- B-3는 refresh 후엔 동작하지만, 앱 종료 후엔 useEffect의 `/character/me` 호출이 다시 일어나므로 (네트워크 의존). persist는 character 상태까지는 안 함 (서버 정답이 우선)

---

## v42 - 2026-04-27 - 아티스트 디렉터 화면 분리 + timerStore 통합 + 옷 카테고리 8개 확장

### 요청 작업
1. 아티스트 만들기를 작사/작곡처럼 **단계적 진행 + 자연 대기 + 광고 단축** 패턴으로 재구성
2. "만들어볼게요" → 로딩 화면(단계 진행) → **큐 다 끝난 후** 시트 표시
3. 시트 후 **미세조정도 단계적 대기** 거치고 옷 입히기로 이동
4. 옷 입히기도 동일하게 단계적 대기
5. **옷 카테고리 확장**: 상의/하의/신발 + 헤어스타일/헤어컬러(염색)/악세서리/안경/문신 (총 8개)

### 계획 & 근거

#### 신규 화면 4개 (작사 패턴 차용)
| 화면 | 역할 | 작사 대응 |
|---|---|---|
| `ArtistInputScreen` | 사진 + 6단계 질문 (현재 questioning) → "만들기" | LyricsInput |
| `ArtistLoadingScreen` | API 호출(sheet/refine/outfit 모드 분기) + 단계 진행 + 큐 동기화 + 광고 단축 | LyricsLoading |
| `ArtistResultScreen` | preview + [미세조정 / 옷 입히기 / 저장 / 작업실로] | LyricsResult |
| `ArtistCodyScreen` | 8 카테고리 선택 → "이 옷으로 입혀보기" | (작사엔 없음, 신규) |

#### timerStore 변경
- `DIRECTOR_STAGES.artist` 6단계를 캐릭터 만들기용으로 교체:
  1. 페이스 분석 🔍
  2. 인상 잡기 ✏️
  3. 컬러 설정 🎨
  4. 체형 작업 💃
  5. 분위기 입히기 ✨
  6. 시트 완성 🖼
- `MODEL_QUEUE_CONFIG`에 모델 추가:
  - `artist`: 그대로 (minQueue 30~50, tickIntervalSec 20s) — 캐릭터 시트 생성
  - `artist_refine` (신규): minQueue 15~25, tickIntervalSec 18s — 미세조정용 짧은 큐
  - `artist_outfit` (신규): minQueue 15~25, tickIntervalSec 18s — 옷 입히기용 짧은 큐
- `DIRECTOR_STAGES`에 `artist_refine`, `artist_outfit` 4단계 추가 (옵션, 또는 artist 재사용)

#### Loading 동작 (sheet/refine/outfit 공통)
```
1. 화면 진입 → API 호출 시작 (백그라운드)
2. timerStore.startTask('artist', ...) 동시 시작
3. 단계 메시지: getCurrentStage(artist) 기반 (DIRECTOR_STAGES.artist 사용)
4. 사용자 광고 시청 시 reduceQueue → 단계 빠르게 진행 (큐 화면 안에서 광고 모달)
5. 큐 0 + API 응답 두 조건 모두 충족 시 → 다음 화면 navigation.replace
6. 큐 0인데 API 미응답 → "거의 다 됐어요!" 메시지 유지 + 스피너
7. 실패 시 alert + 이전 화면 복귀
```

#### 옷 카테고리 8개 정의
| 카테고리 | 백엔드 category | 샘플 (광고 0개일 때) |
|---|---|---|
| 상의 | 상의 (기존) | 흰 티, 후디, 데님 셔츠 등 |
| 하의 | 하의 (기존) | 청바지, 슬랙스, 스커트 등 |
| 신발 | 신발 (기존) | 스니커즈, 부츠, 로퍼 등 |
| 헤어스타일 | 헤어스타일 | 단발컷, 보브, 슬릭백, 포니테일, 양갈래 |
| 헤어컬러 | 헤어컬러 | 블랙, 브라운, 블론드, 핑크, 그라데이션 |
| 악세서리 | 악세서리 | 후프 귀걸이, 진주 목걸이, 체인, 가죽 팔찌, 골드 팔찌 |
| 안경 | 안경 | 라운드, 스퀘어, 캣아이, 선글라스, 보스턴 |
| 문신 | 문신 | 손목 별, 어깨 패턴, 팔뚝 글자, 발목 별자리, 등 라인 |

→ 백엔드 ad active API는 새 카테고리 들어오면 빈 배열 응답 (백엔드 수정 금지) → 모두 SAMPLE_ITEMS fallback. 프론트만 동작.
→ 한 번에 최대 8개 선택 가능. 선택된 항목들을 `refine_request` 텍스트로 합쳐 백엔드 호출 (예: "상의: X, 하의: Y, 헤어스타일: Z, 안경: W…").

#### 기타
- `App.tsx`: ArtistInput / ArtistLoading / ArtistResult / ArtistCody 라우트 추가
- `DialogueScreen` artist case의 action `'navigate:ArtistDirector'` → `'navigate:ArtistInput'`로 변경 + ROOT_TARGETS 업데이트
- `MapScreen` artist 분기에서 ArtistDirector로 직접 가던 코드도 ArtistInput으로 변경
- 기존 `ArtistDirectorScreen.tsx` 삭제 (또는 ArtistInputScreen으로 rename) — Auth/myCharacter 진입 분기는 ArtistInputScreen에서 처리
- `ArtistDetailScreen`은 그대로 유지 (별도 용도)

### 테스트 계획
1. `tsc --noEmit` PASS
2. **흐름**:
   - 작업실 → 아티스트 디렉터 → 인사 → ArtistInput → 사진 + 6질문 → 만들기 → ArtistLoading 단계 진행 → 큐 0 + API 응답 → ArtistResult 시트 표시
   - 광고 시청 → 큐 단축 → 단계 빠르게 진행
   - 미세조정 → ArtistLoading(refine) → ArtistResult 복귀
   - 옷 입히기 → ArtistCody (8 카테고리) → ArtistLoading(outfit) → ArtistResult 복귀
3. **8 카테고리**: 각 카테고리 모달에서 샘플 5개 표시 (백엔드 광고 없음)
4. **MapScreen 통합**: ArtistInput에서 만들기 진입 시 MapScreen 캐릭터 위 "캐릭터 만드는 중" 진행 표시 (다른 디렉터처럼)

### 특이사항 예상
- 백엔드 character API는 그대로 (수정 금지). refine은 outfit 모드에서도 그대로 사용 — 텍스트로 옷 설명 전달
- 큐 + API 동기화 race condition: useEffect로 둘 다 watch
- 카테고리 8개라 모달이 길어짐 → 가로 스크롤 카테고리 탭으로 처리 (또는 그리드 + 스크롤)

---

## v43 - 2026-04-28 - 아티스트 레벨업 + 기획사 레벨업 시스템 (Phase 4 sub 1)

### 요청 작업
디렉터가 아니라 **사용자가 만든 아티스트 캐릭터**와 **기획사(사용자 본인)** 가 레벨업하는 매니지먼트 메타. 디렉터는 "직원/도구", 아티스트와 기획사가 "성장 주체".

### 디자인 결정

#### 아티스트 레벨업 (myCharacter)
- **데이터**: `artistStore` (zustand + AsyncStorage persist)
  - exp, level, songsReleased, totalPlays
- **EXP 소스**:
  - 곡 발매 +50 (CoverGenerationScreen handleConfirm 또는 MusicLoadingScreen 완료 시)
  - 곡 1회 재생 완료 +1 (PlayerScreen didJustFinish)
- **칭호**: 신인 (Lv1–3) → 라이징 (4–6) → 인기 (7–10) → 톱스타 (11–15) → 레전드 (16+)
- **EXP 곡선**: Lv N → N+1 = `100 * N` EXP (Lv1→2는 100, Lv2→3은 200, …)
- **레벨업 보상**: +50💎 + 새 칭호

#### 기획사 레벨업 (사용자 본인)
- **데이터**: `companyStore` (zustand + AsyncStorage persist)
  - exp, level, totalSongs, totalDirectorsHired, totalSpent
- **EXP 소스**:
  - 곡 발매 +30
  - 디렉터 영입 +20 (DirectorLineupScreen handleHire)
  - 100💎 사용마다 +5 (gemsStore.spend hook 또는 누적 추적)
- **등급**: 인디 (Lv1) → 중소 (5) → 메이저 (10) → 글로벌 (20)
- **EXP 곡선**: Lv N → N+1 = `200 * N` EXP
- **레벨업 보상**: +100💎 + 새 등급 (다음 v44부터 등급별 신규 디렉터/맵 잠금해제)

#### UI
- **MapScreen 헤더**: 💎 잔액 옆에 작은 칩 2개
  - `🏢 메이저 Lv.10` (기획사 등급)
  - `🎤 인기 Lv.7` (아티스트 칭호)
  - 캐릭터 미생성 상태면 아티스트 칩 숨김
- **레벨업 모달** (`LevelUpModal` 컴포넌트 신규):
  - 곡 발매·재생·영입·💎 사용 직후 EXP 추가 → 레벨업 발생 시 자동 표시
  - 토스트 형태로 화면 상단에서 슬라이드, 3초 후 자동 dismiss + 사용자 탭 시 닫힘
  - 내용: "🎉 [아티스트/기획사]가 Lv.N으로 올라갔어요! +XX💎"

### 파일 변경 계획

| 파일 | 변경 |
|------|------|
| `stores/artistStore.ts` | **신규** — exp/level/songsReleased/totalPlays + addExp(returns leveledUp/bonus) + persist |
| `stores/companyStore.ts` | **신규** — exp/level/totalSongs/totalDirectorsHired/totalSpent + addExp + persist |
| `data/levels.ts` | **신규** — 칭호/등급 라벨 함수 + EXP 곡선 함수 |
| `components/LevelUpModal.tsx` | **신규** — 토스트 형태 모달 (zustand 기반 글로벌 큐) |
| `stores/levelUpQueueStore.ts` | **신규** — 레벨업 알림 큐 (여러 개 한꺼번에 발생 시 순차 표시) |
| `screens/MapScreen.tsx` | 헤더에 기획사 등급 / 아티스트 칭호 칩 추가 |
| `screens/MusicLoadingScreen.tsx` | 곡 완성 시 artist/company addExp 호출 |
| `screens/CoverGenerationScreen.tsx` | 커버 생성 시 (곡 발매 시점) artist/company addExp |
| `screens/PlayerScreen.tsx` | didJustFinish 시 artist addExp(+1, 'play') |
| `screens/DirectorLineupScreen.tsx` | 디렉터 영입 시 company addExp(+20, 'hire') |
| `App.tsx` | RootStack 외각에 `<LevelUpModal />` mount (전역 토스트) |

### 테스트 계획
1. `tsc --noEmit` PASS
2. **EXP 적립**:
   - 곡 발매 → MapScreen 헤더에 EXP 진행바 또는 칩의 Lv 변화 (요약 표시 OK)
   - 재생 1곡 완료 → 아티스트 EXP +1
   - 디렉터 영입 → 기획사 EXP +20
3. **레벨업**:
   - 아티스트 EXP 100 도달 → "🎉 라이징 Lv.4가 됐어요!" 토스트 + +50💎
   - 기획사 EXP 200 도달 → "🎉 인디 Lv.2가 됐어요!" 토스트 + +100💎
4. **Persist**: 앱 재시작 후 레벨/EXP 유지

### 특이사항 예상
- 좋아요 EXP는 v44 추가 (백엔드 응답 활용 + 폴링 정책 결정 필요)
- 재생 카운트는 PlayerScreen의 didJustFinish 트리거 (50% 이상 재생 시도 정책 등은 v44)
- gemsStore.spend hook을 직접 수정하지 않고, 각 spend 호출 위치에서 companyStore.addExp를 함께 호출 (느슨한 결합)
- 레벨업 모달은 단일 컴포넌트에서 큐를 처리해 "동시 2개 레벨업" 시 순차 표시

---

## v44 - 2026-04-28 - 음원 저작권 다운로드 결제 시스템 + 가상 팬덤 재생 시뮬레이션 (Phase 4 sub 2)

### 요청 작업
- 사용자가 만든 음원에 저작권 자동 등록, 다른 사용자가 다운로드 시 실제 ₩ 결제 → 정산
- 듣기는 무료 (스트리밍은 인기도 EXP만 기여)
- 가상 팬덤이 매일 발매 곡을 들어주는 시뮬레이션 (재생 카운트 + 인기도)

### 가격 정책 (확정안 A)
- 곡당 ₩500 (모든 곡 고정 시작 — 추후 creator 설정 옵션은 v45+)
- 부가세 9% (₩45)
- PG 수수료 3% (₩14)
- 플랫폼 수수료 22% (₩100)
- **Creator 몫 ₩341** (약 68%)
- 최소 출금 ₩10,000 / 출금 수수료 ₩1,000 정액

### 분담
1. **프론트 UI (즉시 가능)** — 결제는 mock 처리
   - PurchaseModal 컴포넌트 (가격·라이선스·결제 버튼)
   - PlayerScreen에 "💿 다운로드 ₩500" 버튼 추가
   - RoyaltyScreen (Settings > 내 정산) — 누적 매출 / 출금 가능액 (백엔드 부재 시 0원)
2. **재생 시뮬레이션 (게임 메커닉)**
   - `fanSimulationStore`: lastRunAt, dailyPlayLog
   - 앱 진입 시 또는 MapScreen mount 시 시뮬레이션 실행
   - 발매 곡 × 아티스트 레벨 × 기획사 등급 × 발매일 부스트로 일일 재생수 계산
   - 결과를 artistStore.addExp(plays, 'play')에 반영 + "📊 오늘의 청취 수 +X" 토스트
3. **백엔드 요청서** — `백엔드_요청_저작권정산.md`
   - DB 테이블 4개, API 엔드포인트, PG 통합 (토스페이먼츠), 정산 정책

### 파일 변경 계획
| 파일 | 변경 |
|------|------|
| `data/pricing.ts` | **신규** — 가격 상수 (TRACK_PRICE_KRW=500, VAT_RATE=0.09, PG_RATE=0.03, PLATFORM_RATE=0.22, CREATOR_RATE=0.66, MIN_PAYOUT=10000, PAYOUT_FEE=1000), `splitRevenue(price)` 헬퍼 |
| `stores/fanSimulationStore.ts` | **신규** — lastRunAt + 일일 시뮬레이션 함수 + 결과 누적 |
| `stores/royaltyStore.ts` | **신규** — 누적 매출/출금가능액 (백엔드 부재 시 더미). 향후 백엔드 ledger와 동기화 |
| `components/PurchaseModal.tsx` | **신규** — 결제 모달 (가격 분해 표시 + 라이선스 동의 + 결제 버튼) |
| `screens/PlayerScreen.tsx` | "💿 다운로드 ₩500" 버튼 추가 (자기 곡이면 "내 곡 무료 다운로드") |
| `screens/RoyaltyScreen.tsx` | **신규** — 정산 화면 (누적 매출, 출금, 시뮬레이션 통계) |
| `screens/SettingsScreen.tsx` | "내 정산" 메뉴 추가 |
| `App.tsx` | RootStack에 Royalty 라우트 + 앱 시작 시 fanSimulation 실행 hook |
| `백엔드_요청_저작권정산.md` | **신규** — DB·API·PG·정산 정책 명세서 |

### 시뮬레이션 알고리즘 안
```
일일 가상 재생 수 = floor(
  artistLevel * 5
  + companyLevel * 3
  + songsReleased * 2
  + (artistLevel >= 7 ? 20 : 0)   // 인기 칭호 부스트
  + (companyLevel >= 5 ? 10 : 0)  // 중소 등급 부스트
) * (1 + Math.min(daysSinceLastRun, 7))  // 오랜만에 들어온 사용자 보상
```

예시:
- 신규 사용자 (artist Lv.1, company Lv.1, 곡 0개) → 일 8회 재생 (시작은 미미)
- 라이징 (Lv.4, 중소 Lv.5, 곡 5개) → 일 65회
- 톱스타 (Lv.13, 메이저 Lv.10, 곡 15개) → 일 150회 + 인기/메이저 보너스

### 테스트 계획
1. `tsc --noEmit` PASS
2. PlayerScreen에 "💿 다운로드 ₩500" 노출
3. 다운로드 탭 → PurchaseModal → "결제하기" → "백엔드 결제 시스템 준비 중" Alert
4. 자기 곡일 때 — "🆓 내 곡 무료 다운로드" 라벨로 변경 (백엔드 user_id 매칭)
5. RoyaltyScreen 진입 — 가격 분해 / 누적 매출(0원) / 출금(disabled)
6. 앱 진입 시 / MapScreen mount 시 fanSimulation 실행 → "📊 오늘의 청취 +N회 (인기도 +X)" 토스트
7. 시뮬 후 artistStore.totalPlays 증가, 일정 도달 시 아티스트 레벨업

### 특이사항
- 결제는 mock (Alert로 안내) — 실제 PG 통합은 백엔드 반영 후 v45+
- 자기 곡 판단: `useAuthStore.user.id === track.user_id` (백엔드 응답에 user_id 있는지 확인)
- 시뮬레이션은 매일 자정 cron이 아니라 사용자 진입 시 lastRunAt 갭으로 한 번에 처리 (백엔드 cron 없이 동작)
- RoyaltyScreen은 백엔드 부재 시 "백엔드 정산 시스템 반영 후 활성화" placeholder가 적절

