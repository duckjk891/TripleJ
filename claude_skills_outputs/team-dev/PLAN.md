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

---

## v45 - 2026-04-28 - 영수증 디렉터 수수료 분배 + Persona Model 파라미터 (D)

### 요청 작업
1. **추가 요청**: 플랫폼 수수료(₩100)가 작사·작곡·이미지·아티스트 디렉터에게 분배되는 명목으로 영수증에 표시
2. **D (TODO)**: 작곡.md 미반영 파라미터 — `Persona Model` (Style Persona / Voice Persona)
   - 확인 결과 Style Weight / Weirdness / Audio Weight / BPM / Key는 v40에서 이미 반영됨. **Persona Model 1개만 빠짐**

### 디렉터 분배 비율 (플랫폼 수수료 ₩100 기준)
| 디렉터 | 비율 | 곡당 ₩ | 근거 |
|---|---|---|---|
| 작사 디렉터 | 30% | ₩30 | LLM 호출 비용 |
| 작곡 디렉터 | 40% | ₩40 | Suno (가장 비싼 외부 비용) |
| 이미지 디렉터 | 15% | ₩15 | 커버 생성 |
| 아티스트 디렉터 | 15% | ₩15 | 캐릭터 시트 |

### 파일 변경 계획
| 파일 | 변경 |
|------|------|
| `data/pricing.ts` | `DIRECTOR_FEE_SPLIT` 상수 + `splitPlatformFee(platformFee)` 헬퍼 |
| `components/PurchaseModal.tsx` | 영수증에 디렉터별 분배 4줄 추가 (들여쓰기 표시) |
| `screens/RoyaltyScreen.tsx` | 가격 분해 카드에 디렉터별 분배 추가 |
| `stores/musicStore.ts` | `personaModel: 'style' \| 'voice' \| ''` 필드 + setter |
| `screens/MusicGenerationScreen.tsx` | DIRECTOR_MESSAGES 13개로 확장, case 12 라디오 UI, handleGenerate에 personaModel 반영 |
| `services/musicService.ts` | `GenerateParams.persona_model?` 추가, FormData에 전달 |

### 특이사항 예상
- 디렉터 분배는 명목 표시 — 실제 백엔드 정산은 플랫폼 1건으로 처리. 사용자에게 "디렉터들이 일한 보상" 인지시키는 UX 효과
- Persona Model은 Suno API 비공식 가능성 — 백엔드가 모르는 필드면 무시되니 하위 호환

### 다음 작업 메모 (v46 후보)
- **아티스트 의상/악세서리 잠금해제** (Phase 4 sub 3 정정) — ArtistCody 8 카테고리 안의 SAMPLE_ITEMS에 `unlockLevel` 필드 추가, 아티스트 레벨 미달이면 잠금 표시 + 미선택. 디렉터 의상/스킨은 범위에서 제외 (사용자 정책)


---

## v3.191 — 2026-09-19 — NowPlaying(PlayerScreen) 안전 영역 준수 — 상·하단 시스템 UI 겹침 해소

**요청 원문**: "nowplaying 플레이어 화면에서 상단, 하단에 모바일 ui를 넘어서서 앱 ui가 배치되어있어. 이거 안전 영역 안으로 배치해줘야지 모바일 ui랑 겹치면 안되잖아"

### Plan verification findings (0단계 사전 코드 분석)
- **원인(핵심)**: `2_housing/screens/PlayerScreen.tsx:12` — `SafeAreaView`를 **`react-native` 코어**에서 import(791행 루트 래퍼, 1299행 닫힘). RN 코어 SafeAreaView는 **iOS 전용**(Android에서는 일반 View와 동일, 인셋 미적용).
- **Android edge-to-edge**: `2_housing/app.json:35` `"android": { "edgeToEdgeEnabled": true }` — 앱이 상태바·내비게이션 바 밑까지 그려짐(Expo SDK 54 기본). 그 결과:
  - 상단: 헤더(796행 렌더, styles.header 1324행 `paddingTop: 10`)가 상태바/노치 아래로 파고듦.
  - 하단: 상세 토글 버튼(1013행, styles.swipeUpButton 1554행 `paddingBottom: 18`)이 제스처 바/내비게이션 바와 겹침. showDetails 패널(detailWrap, 1026행~)·재생목록 Modal 시트(1271행 queueSheet)도 하단 인셋 미반영.
- **마운트 방식**: `App.tsx:502-505` — RootStack `presentation: 'modal'`, `animation: 'slide_from_bottom'`, headerShown:false. Android native-stack modal은 풀스크린 → 인셋 처리 전적으로 화면 책임.
- **Provider/버전**: `App.tsx:29,483` SafeAreaProvider 정상 래핑. `react-native-safe-area-context ~5.6.0`(package.json:39).
- **프로젝트 관행**: 전 화면이 `useSafeAreaInsets` 패턴 — 예: `FaceVerifyScreen.tsx:355` `paddingTop: insets.top + 8`(헤더), `DmChatScreen.tsx:158` 컨테이너 `paddingTop: insets.top`. **RN 코어 SafeAreaView를 쓰는 화면은 PlayerScreen이 유일**(관행 이탈 지점).
- **MiniPlayer.tsx**: 자체 인셋 불필요 — `App.tsx:234-245` MiniPlayerWrapper가 `bottom: 49 + insets.bottom`(탭바 높이+인셋)으로 이미 안전 영역 반영. 이번 범위 제외.

### 변경 매트릭스
| 파일 | 변경 | 디버깅 추적자 |
|------|------|--------------|
| FE screens/PlayerScreen.tsx | ①import: RN 코어 SafeAreaView 제거 → `useSafeAreaInsets`(safe-area-context) ②루트: `<SafeAreaView styles.container>` → `<View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>` ③재생목록 Modal(RN Modal은 컨테이너 패딩 미상속): queueSheet에 `paddingBottom: insets.bottom + spacing.xxl` 인라인 보강 ④마운트 시 `__DEV__` 인셋 로그 | `[PlayerScreen] safe-area insets { top, bottom }` |

### 특이사항
- iOS pageSheet 모달에서는 safe-area-context가 모달 컨텍스트 인셋을 정확히 반환 — 이중 패딩 없음(코어 SafeAreaView 제거로 단일 소스화).
- KeyboardAvoidingView(상세 패널)·swipeUpButton은 루트 paddingBottom 안쪽에 있으므로 개별 수정 불요 — 루트 1곳 + Modal 시트 1곳만.
- 기존 파일 정리: `2_housing/PLAN.md`·`REPORT.md` → `claude_skills_outputs/team-dev/PLAN.md`·`REPORT.md` `git mv` 완료(v3.191, 본 엔트리부터 이 파일에 누적). TESTPLAN.md는 test-designer 산출 시 생성 예정.

---

## v3.192 — 2026-09-20 — 냥냥냥 duration 오표시(진행바 조기 종료·가사 싱크 정지) + 곡 제목 marquee 개행 수정 + 큐 자동추가 동작 분석

**요청 원문**: "모바일에서 확인하고 있는데 냥냥냥 음악이 음악 시간보다 재생시간이 짧게 보이네. 다른 음악은 안그런데 냥냥냥만 그렇고 음악 재생진행바가 중간에 끊어지니까 노래가 남아있는데 동영상 탭에서 남아있는 가사도 안뜨고 멈춰있어. 그리고 더 나오는 것을 막는 것일뿐 음악은 곡 제목이 흘러가는 형태로 나와야하는데 개행이 되버려서 전체적인 ui가 하단으로 밀려서 하단이 잘려보이는 상황이야. 그리고 담기를 안해도 곡을 클릭하면 자동으로 재생목록에 추가가 되는 형태인가?"

> 주: 요청문 중 "더 나오려는 것을 막는 것일뿐"은 실제 곡 제목(duration 201초, 긴 제목)이다 — 이슈 B의 재현 곡.

### Plan verification findings (0단계 사전 코드 분석 — 2026-09-20 실측)

**[이슈 A] 냥냥냥 duration 불일치 — 원인: 해당 MP3 파일에 VBR(Xing) 헤더 누락 (백엔드 데이터 문제)**
- **duration 소스 추적**: 진행바·시간표시는 100% 재생 엔진(expo-av `~16.0.8`) 값. `screens/PlayerScreen.tsx:353-361` `onPlaybackStatusUpdate`가 `status.durationMillis`를 local `duration`+`playerStore.duration`에 기록 → 슬라이더 `maximumValue={duration||1}`(:922), 총시간 라벨(:934), showDetails 미니 진행바(:1043). 미니 경로도 동일: `services/playback.ts:103` `setDuration(status.durationMillis||0)`. **API의 `duration_sec`은 재생바에 전혀 쓰이지 않음**(프롬프트 탭 표기 :273에만 사용).
- **가사 싱크 정지 구조**: 동영상 탭 = `components/LyricSyncView.tsx` — `positionMillis`(PlayerScreen `position` state, :841에서 전달) 기준 이진탐색(:26-34)으로 활성 라인 결정. 엔진이 이 파일의 위치/길이를 91초 스케일로 잘못 보고하면 91초 지점 이후 가사가 진행되지 않고 멈춘 것으로 보임(가사 timeline 자체는 실제 초 단위 정상).
- **냥냥냥 데이터 실측(공개 API, 무인증)**: `GET /api/tracks/search?q=냥냥냥` → track id `6aa3ec295f11b57ba518f5e8`, **`duration_sec: 91`**. `stream-proxy`로 파일 수신(3,650,646B) 후 분석:
  - 실제 오디오 길이 **157.86초(2:38)** (48kHz, 평균 ~179kbps).
  - 파일은 **VBR**(프레임 비트레이트 128~320kbps 혼재)인데 **Xing/Info/VBRI 헤더가 없음**. 첫 프레임이 320kbps → CBR 가정 추정 = 3,650,496B×8÷320kbps = **91.26초 = API의 91과 정확히 일치**.
  - 대조군(정상 곡) 2곡 실측: `사랑의 김장`(Xing 있음, 실측 144.3s = API 144), `더 나오려는 것을 막는 것일뿐`(Xing 있음, 실측 201.2s = API 201) — **냥냥냥만 헤더 누락**.
- **결론**: 백엔드에 저장된 이 곡의 MP3 자체가 VBR 헤더 없는 비정상 파일 → ① 백엔드 duration_sec 계산(91)도, ② 모바일 재생 엔진(ExoPlayer ConstantBitrateSeeker/AVFoundation의 첫 프레임 비트레이트 추정)도 똑같이 91초로 오판. 진행바 조기 종료·가사 싱크 정지·seek 좌표 왜곡(바이트-선형 매핑) 전부 이 파일 하나의 문제. **근본 수정은 백엔드(파일 리먹스+duration 재계산), 프론트는 방어 로직만 가능.**

**[이슈 B] 긴 곡 제목 개행 — 원인: Marquee가 네이티브에서 한 줄 강제가 안 됨**
- 제목은 이미 Marquee 적용(v3.159): `screens/PlayerScreen.tsx:868` `<Marquee text={track?.title} variant="title1" center />`. 차트 행도 동일 컴포넌트(`components/TrackRow.tsx:65`).
- **버그**: `components/Marquee.tsx:19` nowrap이 **web 전용**(`Platform.OS==='web'`), 네이티브는 `copy: { flexShrink: 0 }`(:73)뿐. RN(yoga)에서 Text는 flexShrink:0이어도 **부모 폭 제약으로 측정되어 개행됨** → 긴 제목이 2줄+로 렌더, 측정 폭 textW≈containerW라 overflow 판정(:26)도 false → 마퀴 미발동. title1 2줄만큼 아래 UI(재생바·컨트롤·상세 토글)가 밀리고, 루트가 비스크롤 View(PlayerScreen.tsx:797)라 하단이 잘림.
- MiniPlayer는 `numberOfLines={1}`(MiniPlayer.tsx:85)라 무관. 이슈 재현 곡: "더 나오려는 것을 막는 것일뿐".
- marquee 외부 라이브러리 없음(package.json 확인) — 자체 Marquee.tsx 수정으로 해결(한 파일 수정으로 PlayerScreen+TrackRow 동시 치유).

**[이슈 C] 큐 자동 추가 — 현재 동작 사실 확인 (코드 변경 없음)**
- **맞다. 의도된 설계**: `screens/ChartScreen.tsx:176-182` — 주석 "곡 클릭 → 재생목록(큐)에 추가(중복 방지) 후 그 곡 재생". `addToQueue`(stores/playerStore.ts:88-95, id 중복이면 추가 안 함) → `setCurrentIndex` → Player 진입. 즉 차트에서 곡을 클릭만 해도 큐에 **누적** 추가됨.
- 그 외 경로: 검색 결과 클릭은 큐를 검색결과 목록으로 **교체**(ChartScreen.tsx:185-191 `setQueue(searchResults)`), 피드/내음악은 `playTrackNow`가 컨텍스트 목록으로 큐 **교체**(services/playback.ts:131-139), 큐 소진 시 관련곡 자동 이어듣기(v3.91)도 큐에 **추가**(playback.ts:66). '담기' 버튼(PlayerScreen.tsx:753-757)은 현재 곡 명시 추가 + 비회원 첫 담기 안내 모달.
- 사용자 답변만 전달, 변경 여부는 사용자 결정 대기.

### 이슈별 수정 방안

**A. 프론트 방어(v3.192 범위)** — 엔진 duration을 그대로 믿지 않고 "실측 우선" 보정:
- `onPlaybackStatusUpdate`(PlayerScreen.tsx:353-361)와 playback.ts:98-115 상태 콜백에서 `effectiveDuration = Math.max(status.durationMillis||0, status.positionMillis||0, 직전 duration)` 로 기록 — 재생 위치가 엉터리 duration을 넘어서는 순간부터 슬라이더 max·총시간 라벨이 실시간 확장되어 진행바가 "끝에 박혀 끊긴" 표시를 방지. `track.duration_sec*1000`도 하한으로 병용(이번 곡은 91로 같이 틀렸지만 일반 방어로 유효).
- 70% 재생 기록(recordPlayIfNeeded :340-351)도 effectiveDuration 기준 사용(조기 기록 방지, 트랙당 1회 가드는 기존 유지).
- 한계 명시: 엔진이 position 자체를 91s에서 멈춰 보고하는 플랫폼이라면(가사 정지 증상) 프론트로는 완치 불가 — **근본 해결은 백엔드 파일 수정**. 방어 로직은 오표시 완화 + 타 곡 일반 방어.
- `__DEV__` 경고 로그: durationMillis와 duration_sec*1000 괴리가 5초 이상이면 `[PlayerScreen] duration 불일치 감지 {engine, api}` 1회 출력(재현 진단용).

**B. Marquee 네이티브 한 줄 보장** — `components/Marquee.tsx` 단일 파일 수정:
- 트랙(복사본 나열 Row)을 `<ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>`로 감싸 **폭 제약 없는 수평 컨텍스트**에서 자연폭 측정·렌더(RN marquee 정석). 복사본 AppText에 `numberOfLines={1}` 이중 안전장치.
- 기존 동작 보존: 넘치지 않으면 정적 + `center` 옵션 시 가운데(v3.159), 넘치면 loop translate. 웹 경로(nowrap) 무회귀.
- 효과: PlayerScreen 제목 1줄 고정 → 하단 밀림/잘림 소멸, TrackRow(차트) 잠재 버그 동시 해결.

**C. 분석 보고만** — 코드 변경 없음. 위 사실 확인을 사용자에게 전달.

### 변경 매트릭스
| 파일 | 변경 | 디버깅 추적자 |
|------|------|--------------|
| FE screens/PlayerScreen.tsx | onPlaybackStatusUpdate duration 보정(max(engine, position, api)), recordPlayIfNeeded effectiveDuration 기준, 불일치 감지 __DEV__ 로그 | `[PlayerScreen] duration 불일치 감지` |
| FE services/playback.ts | 상태 콜백 동일 보정(미니/인라인 재생 경로) | `[playback]` |
| FE components/Marquee.tsx | 수평 ScrollView 래핑 + numberOfLines=1 — 네이티브 한 줄 자연폭 보장 | `[Marquee]`(측정 __DEV__ 로그 선택) |
| 문서 2_housing/백엔드_요청_트랙duration.md (신규) | 아래 백엔드 수정요청 — 관행(백엔드_수정요청.md 등 곡별 요청서) 준수 | — |

### 백엔드 수정요청 문서 내용 (MAIDOL 음악 API는 로컬 저장소에 없음 — 0_platform/backend에는 minihompi-api·office-game-api뿐이라 문서로 요청)
1. **개별 데이터 수정**: track `6aa3ec295f11b57ba518f5e8`(냥냥냥)의 MP3가 VBR인데 Xing/Info/VBRI 헤더 없음 → `ffmpeg -i in.mp3 -c:a copy out.mp3` 재먹싱(Xing 헤더 재작성)으로 교체 저장, `duration_sec`을 실측 158(157.86s)로 갱신. (원인 추정: 생성/업로드 파이프라인에서 헤더가 잘린 파일이 그대로 저장됨)
2. **파이프라인 하드닝**: 트랙 저장 시 항상 재먹싱(또는 ffprobe 디코드 실측)으로 duration 산출 — 첫 프레임 비트레이트 기반 추정 금지. 동일 증상 트랙 전수 점검 쿼리(파일 크기×8÷duration_sec 대비 실측 비트레이트 괴리) 권장.
3. 하위 호환: 파일 교체는 동일 object key로 — 앱/캐시 영향 없음.

### 특이사항
- 진단 실측은 공개 무인증 엔드포인트(`/tracks/search`, `/tracks/stream-proxy`)만 사용. 민감정보 없음.
- 이슈 A 프론트 방어는 "표시 보정"이며 seek 정확도(바이트-선형 오매핑)는 파일 수정 전까지 이 곡에서 부정확할 수 있음을 사용자 안내에 포함.
- v3.191(안전영역 insets) 직후라 PlayerScreen 하단 잘림 관측에 인셋 회귀가 섞였을 가능성은 코드상 없음(루트 padding 유지) — 테스트로 무회귀 확인.

## v3.193 — 2026-09-20 — NowPlaying 좋아요 서버 연동 + 담기→플레이리스트 담기 + 액션행 정렬 + 비로그인 CTA 통일 + 스플래시/로고 타이포

### Plan verification findings (0단계 — 파일 직접 확인)

**[이슈 A] 좋아요 하트 리셋 — 원인 확정: 서버 연동 자체가 없음(로컬 state 전용)**
- `screens/PlayerScreen.tsx:182` `const [isLiked, setIsLiked] = useState(false);` — 초기값 무조건 false.
- `:998-1006` 하트 onPress = `setIsLiked(!isLiked)` **한 줄뿐. API 호출·스토어 연동 전무.**
- PlayerScreen은 미니플레이어로 내리면 언마운트(goBack) → 재진입 시 재마운트되어 state가 false로 초기화. 서버에 좋아요가 기록된 적도 없으므로 "복원"할 대상도 없음. 사용자가 본 증상과 정확히 일치.
- 반면 전역 `stores/likesStore.ts`(v 기존)는 이미 완비: `POST/DELETE /likes/{id}`, `GET /likes/check?song_ids=`(:25,49-50), 낙관적 토글+롤백, busy 가드. 차트/검색/피드의 ⋮ 액션시트(`components/TrackActionSheet.tsx:41,58-61,105-107`)가 이 스토어로 좋아요를 수행 중. **PlayerScreen만 미접속.**

**[이슈 B] '담기' 버튼 현황 + 플레이리스트 담기 UI 존재 여부**
- NowPlaying '담기'(PlayerScreen.tsx:1014-1017) → `handleAddToPlaylist`(:783-790, 이름과 달리 실제로는) → `addCurrentToQueue`(:776-781) = **재생목록(큐)에 추가**. 비회원 첫 담기 시 GuestQueueNoticeModal(:1283-1292).
- 큐 추가는 이미 자동(차트 클릭 시 addToQueue — v3.192 분석 확정)이라 이 버튼은 사실상 중복 기능. 사용자 기대(플레이리스트 담기)와 불일치.
- **"플레이리스트에 담기" UI는 이미 존재**: ① `components/PlaylistPickerSheet.tsx` — 기존 목록 선택/새로 만들기 바텀시트, `GET /playlists/`·`POST /playlists/`·`POST /playlists/{id}/tracks` 사용(**백엔드 API 기존재 — 신규 요청 불필요**). ② 진입 경로 2곳: 곡 목록의 ⋮ 더보기 → "플레이리스트에 담기"(TrackActionSheet.tsx:115, 차트·검색·피드·마이뮤직·플레이리스트 공용), 검색 결과 헤더 "모두 담기"(SearchScreen.tsx:258-261). **NowPlaying에만 없음.**

**[이슈 C] 액션행(좋아요~신고) 정렬 불일치 — 원인: 아이콘 렌더 방식 혼재**
- PlayerScreen.tsx:997-1034 — 좋아요 `AppText variant="title2"` ♥/♡(24pt bold, lineHeight 24×1.35≈32px), 담기 `AppText title2` '+', 댓글 Feather 23, 재생목록 Feather 24, 신고 Feather 22. 텍스트 글리프(라인박스 ~32px)와 벡터 아이콘(22~24px 박스)의 높이가 제각각 → 라벨(caption, actionLabelSpacing=marginTop xxs) 시작 Y가 버튼마다 다름 = 사용자가 본 정렬 붕괴.

**[이슈 D] 상세 토글 라벨 — 현황**
- 하단 토글 문구: PlayerScreen.tsx:1047 `가사 · 프롬프트 · 착장 · 댓글`, 탭바 라벨: :1108 `{ lyrics:'가사', prompt:'프롬프트', outfit:'착장', comments:'댓글' }`.
- 탭 실제 내용: 가사=가사 전문+공유, 프롬프트=곡의 "이야기"+핵심 파라미터 칩(:1137-1158), 착장=발매 시점 아티스트 의상 카드+위시/구매링크(:1171-1258), 댓글=곡 댓글(:1267-1276). → '프롬프트'는 개발 용어라 일반 사용자에게 낯섦, '착장'은 K-pop 용어로 통용되나 대체 가능.

**[이슈 E] 비로그인 CTA 3화면 비교 — 위치가 다른 원인 2가지**
- 작업실(기준): `screens/MapScreen.tsx:613-625` — absoluteFill 딤 오버레이(styles.loginOverlay:992-997, rgba 0.75, 콘텐츠 영역 정중앙) + 공용 `LoginPrompt`(**아이콘 없음**, title="AI 음악 작업실"+desc+버튼).
- 플레이리스트: `screens/PlaylistScreen.tsx:220-228` — flex:1 중앙 View + LoginPrompt(**icon="♫" 있음**, title="나만의 플레이리스트"). 중앙 앵커는 동일하지만 **아이콘 48pt+마진 16이 그룹 상단에 추가**되어 타이틀 Y가 작업실보다 ~32px 아래로 밀림.
- 검색: `screens/SearchScreen.tsx:231-238` — 검색바+느낌칩 **아래 남은 공간**의 flex:1 중앙(styles.loginCta:318) + LoginPrompt(**타이틀·아이콘 없음**, desc만). 상단 ~110px가 소비된 뒤의 중앙이라 세로 중심이 아래로 치우침 + 타이틀 부재.
- 참고: 피드(FeedScreen.tsx:301-312)는 이미 작업실과 같은 absoluteFill 오버레이 패턴(타이틀 없음). 사용자 언급 밖이라 이번엔 미변경, 보고만.

**[이슈 F] 스플래시 타이포 크기**
- `screens/SplashScreen.tsx` — 1막 MY/AI/IDOL: styles.word(:110-116) fontSize **56**/lineHeight 74/letterSpacing 6. 2막 MAIDOL: styles.title(:121-127) fontSize **52**/lineHeight 60/letterSpacing 3. (참고: 1막 문구는 'MY/AI/IDOL' — 사용자 표기 'DOL'은 2막 로고 분절 M|AI|DOL 기준.)

**[이슈 G] 상단바 MAIDOL 로고색**
- `App.tsx:249-251` LogoTitle = `<AppText variant="title2" tone="accent">MAIDOL</AppText>` — **전체가 강조색(보라)**. 스플래시 2막(:87-89)은 이미 M(흰)+AI(보라)+DOL(흰) 분리 렌더 → 같은 패턴으로 통일하면 됨.

**[이슈 H] 차트 마퀴 — v3.192 수정으로 코드상 완결 확인(변경 불필요)**
- `components/Marquee.tsx`(현 워킹트리) — v3.192 수평 ScrollView 래핑+numberOfLines=1 반영 확인(:52-76). 차트 행(`components/TrackRow.tsx:65`)이 동일 컴포넌트 사용 → 코드상 치유 완료. **사용자 폰에서 미적용으로 보이는 것은 v3.192가 아직 빌드/배포되지 않은 정상 상황.** v3.193 빌드에 포함되어 함께 나감. 추가 수정 없음, 테스트 항목만 유지.

### 이슈별 수정 방안 (코드 변경은 app-dev)

**A. PlayerScreen 좋아요 → likesStore 서버 연동** (`screens/PlayerScreen.tsx`)
- 로컬 `isLiked` state 제거, `useLikesStore` 구독: `const liked = useLikesStore((s)=>!!s.liked[trackId])`.
- 곡 진입/전환 시 동기화: trackId 변경 effect에서 로그인 상태면 `useLikesStore.getState().sync([trackId])` (댓글 수 조회 effect(:245-257)와 같은 패턴).
- 하트 onPress → 비로그인: `showAlert('알림','로그인 후 이용할 수 있습니다.')`(착장 위시 :235-237 관행) / 로그인: `useLikesStore.getState().toggle(trackId)` (낙관적+롤백은 스토어가 담당).
- 효과: 미니플레이어 전환·재진입에도 전역 스토어라 하트 유지 + 차트/검색 ⋮ 좋아요와 상태 공유(양방향 일관).
- 로그 추적자: 기존 `[likesStore] toggle/sync` 재사용 + `[PlayerScreen] 좋아요 toggle` 1줄.

**B. '담기' → 플레이리스트에 담기** (`screens/PlayerScreen.tsx` + 기존 `PlaylistPickerSheet` 재사용, 신규 백엔드 없음)
- state `showPlaylistPicker` 추가, 모달 3종 구역(:1282-1298)에 `<PlaylistPickerSheet visible trackIds={[String(track.id)]} onClose/>` 추가.
- 담기 onPress 분기: 로그인 → PlaylistPickerSheet 열기. 비로그인 → 기존 GuestQueueNoticeModal 유지(플레이리스트는 서버 저장이라 비회원 불가; '계속 담기'=기존 큐 담기 폴백 유지, 문구는 현행 유지 — 큐 설명이므로 여전히 유효).
- 아이콘/라벨: '+' 텍스트 글리프 → Feather `folder-plus`(또는 `plus`) 24, 라벨 '담기' 유지(사용자 멘탈모델상 담기=플레이리스트).
- 로그: `[PlayerScreen] 담기 → PlaylistPicker`(회원) / 기존 비회원 로그 유지.

**C. 액션행 정렬 통일** (`screens/PlayerScreen.tsx`)
- 텍스트 글리프 전폐: 좋아요 = `MaterialCommunityIcons heart/heart-outline` 24(이미 import, 착장 위시와 동일 아이콘 계열 — liked면 accent), 담기 = Feather 24(위 B), 댓글/재생목록/신고 = Feather 모두 **24**로 통일.
- 각 버튼 아이콘을 고정 높이 박스(`height:28, alignItems:'center', justifyContent:'center'`) `styles.actionIconBox`로 감싸 라벨 시작 Y 완전 동일화. 라벨은 기존 actionLabelSpacing 공통 유지.

**D. 토글 라벨 — 제안만(코드 변경 없음, 사용자 결정 대기)** — 아래 '사용자 보고' 참조.

**E. 비로그인 CTA 위치·타이틀 통일 (기준=작업실)**
- `screens/PlaylistScreen.tsx:222-227` LoginPrompt에서 `icon="♫"` 제거 → 그룹 구성(title+desc+버튼)이 작업실과 동일해져 타이틀 Y 일치(중앙 앵커는 이미 동일).
- `screens/SearchScreen.tsx` gated 분기(:231-238)를 작업실 패턴으로 교체: 남은 공간 flex 중앙 대신 **absoluteFill 딤 오버레이**(MapScreen styles.loginOverlay와 동일 스펙: rgba(0,0,0,0.75)·center, 배경 탭=닫기 `setGated(false)`) + `LoginPrompt title="AI 음악 검색"` + 기존 desc. → 세로 중심·타이틀 스타일이 작업실과 픽셀 단위 일치.
- 상단바 헤더 타이틀('검색', App.tsx:355)은 변경하지 않음(사용자 요청은 CTA 타이틀 문맥 — 보고에 명시, 헤더 변경 원하면 후속).
- 로그: `[SearchScreen] 미로그인 게이트` 기존 유지.

**F. 스플래시 타이포 축소** (`screens/SplashScreen.tsx`)
- 1막 word: fontSize 56→**40**, lineHeight 74→**54**, letterSpacing 6 유지 (약 0.71배).
- 2막 title(MAIDOL): fontSize 52→**36**, lineHeight 60→**44**, letterSpacing 3 유지 (약 0.69배). 심볼(64×66)·subtitle 유지 — 로고 대비 심볼 비중이 커지므로 QA에서 육안 확인, 과하면 심볼 56으로 미세조정 허용.

**G. 상단바 로고 부분 강조색** (`App.tsx:249-251`)
- LogoTitle을 스플래시 2막과 동일한 분절 렌더로: `<AppText variant="title2" style={{letterSpacing:1}}>M<AppText variant="title2" tone="accent">AI</AppText>DOL</AppText>` (중첩 Text — 기본 tone primary=흰색, AI만 accent). 크기·자간 기존 유지.

**H. 변경 없음** — v3.192 Marquee 수정이 TrackRow(차트)를 이미 커버. 테스트 재확인만.

### 변경 매트릭스
| 파일 | 변경 | 디버깅 추적자 |
|------|------|--------------|
| FE screens/PlayerScreen.tsx | (A) isLiked→likesStore 연동+sync (B) 담기→PlaylistPickerSheet(회원)/GuestNotice(비회원) (C) 액션행 아이콘 24 통일+고정높이 박스 | `[likesStore] toggle/sync`, `[PlayerScreen] 좋아요 toggle`, `[PlayerScreen] 담기 → PlaylistPicker` |
| FE screens/PlaylistScreen.tsx | (E) LoginPrompt icon 제거 | — |
| FE screens/SearchScreen.tsx | (E) gated 분기 → absoluteFill 오버레이 + title="AI 음악 검색" | `[SearchScreen] 미로그인 게이트` |
| FE screens/SplashScreen.tsx | (F) word 56→40, title 52→36 (+lineHeight 비례) | — |
| FE App.tsx | (G) LogoTitle M/AI/DOL 분절 — AI만 accent | — |
| (변경 없음) components/Marquee.tsx·TrackRow.tsx | (H) v3.192 수정 유지 확인만 | — |

### 특이사항
- 이슈 B는 **백엔드 신규 API 불필요**(플레이리스트 CRUD 전부 기존재) — 요청 문서 없음.
- D는 코드 변경 없이 라벨 후보만 사용자 보고(결정 후 반영은 1줄×2곳: PlayerScreen.tsx:1047·1108).
- 피드 비로그인 CTA는 이미 오버레이 패턴이나 타이틀 없음 — 이번 범위 밖, 사용자 보고에 포함.
- 민감정보 없음. 원격 로깅은 기존 콘솔→/_logs/frontend 배치(App.tsx:18) 경유.

## v3.194 — 2026-09-20 — 소셜 로그인(APK) 버그 분석 + 네이버 버튼 제거 + 이모지 아이콘 전수 교체(1차) + 스플래시 응원봉 제거

### 사용자 요청 요약
1. APK에서 구글 로그인 시 "메일 창"이 뜨고, 두 번째 시도에 "null 에 접근할 수 없습니다" 표시. 카카오는 "앱 관리자 설정 오류".
2. "네이버로 계속하기" 버튼 제거.
3. 하트 아이콘은 벡터(내부 채움 토글)만 — 이모지 금지. 앞으로 앱 전체에서 이모지를 아이콘으로 쓰지 않음.
4. (추가 지시) ⭐(재화 '스타' 표기)는 이모지 유지 — 교체 제외.
5. (추가 지시) 앱 시작 스플래시의 응원봉(라이트스틱) 요소 제거.

---

### 이슈 A — 소셜 로그인(APK) 분석

#### A-0. 현재 구조 (코드 실측)
- 소셜 로그인은 **SDK 미사용, 순수 브라우저 리다이렉트 방식** (package.json에 expo-auth-session/google-signin/kakao/naver SDK 전무).
- 진입점: 로그인 화면 = `screens/SettingsScreen.tsx` 비로그인 모드(877행 `AuthPanel`) → `components/auth/AuthPanel.tsx:273` → `components/auth/SocialLoginButtons.tsx`.
- 흐름(SocialLoginButtons.tsx:21-45): ① `api.get('/auth/oauth/{p}/login')` (axios 프리플라이트) → ② 503이면 서버 안내 alert, 아니면 `Linking.openURL('${BACKEND_BASE_URL}/api/auth/oauth/{p}/login')` → 외부 브라우저에서 OAuth 진행.
- 콜백: 백엔드가 `{frontend_url}/oauth/callback#token=JWT`로 리다이렉트 → **App.tsx:442 `useOAuthCallback`은 `Platform.OS === 'web'` 전용**. App.tsx:467 `linking` config에도 `oauth/callback` 라우트 없음(FeedDetail만 존재).

#### A-1. "메일 창" 원인 (파일:라인)
- 앱 코드에서 메일 작성 창을 여는 곳은 **단 한 곳**: `components/PolicySheet.tsx:41-43` `CompanyFooter`의 "고객센터" 링크 → `Linking.openURL('mailto:kimpearl@lotusai.co.kr')`.
- `CompanyFooter`는 로그인 화면에서 **소셜 로그인 버튼 바로 아래** 렌더됨(SettingsScreen.tsx:881). 구글 버튼과 근접해 오탭 가능성 높음 — 사용자가 누른 "보내기"는 **고객센터로 빈 메일 발송**이었을 가능성이 가장 큼(수신함 kimpearl@lotusai.co.kr에서 빈 메일 수신 여부로 검증 가능).
- 차순위 가설: 브라우저에서 구글 OAuth 동의화면이 "테스트 모드/미인증 앱" 차단 페이지를 띄우고, 그 페이지의 "개발자에게 문의"(개발자 이메일 링크)를 탭 → 메일 창. 이 경우도 코드가 아닌 **구글 콘솔 설정** 문제.
- 결론: 코드상 구글 버튼이 mailto로 폴백하는 경로는 없음. UI 개선(P1-4, 고객센터 오탭 방지)과 콘솔 안내로 대응.

#### A-2. "null 에 접근할 수 없습니다" 원인
- 이 문자열은 **프론트 코드에 존재하지 않음**(전수 grep 0건). 표시 경로 후보:
  - `SocialLoginButtons.tsx:33-35` — 503 응답의 `detail/error`를 **검증 없이 그대로 alert에 표출**. 백엔드/프록시가 내려준 오류 문구가 그대로 노출됐을 가능성이 최우선(첫 시도에서 백엔드 OAuth state/세션이 소모·잔존된 뒤 두 번째 GET에서 서버측 null 참조 오류 응답).
  - 프리플라이트 `api.get()`(27행)은 RN XHR이 302를 **앱 안에서 끝까지 따라가** 구글/카카오 HTML까지 받아버리는 무의미+유해한 호출 — 백엔드가 세션 기반 state를 쓰면 이 호출이 state를 선점/소모해 이후 브라우저 흐름과 어긋남(두 번째 탭 오류의 유력 트리거).
- 확정 절차(tester): `utils/remoteLogger.ts`가 콘솔을 `/_logs/frontend`로 배치 전송 중 — 사용자 세션 시각대 서버 로그에서 `[API Error] /auth/oauth/google/login` status와 본문을 확인해 문자열 출처 확정. 필요 시 `adb logcat` 병행.
- 코드 수정안(원인과 무관하게 필요한 방어):
  1) `SocialLoginButtons.tsx:27` 프리플라이트 `api.get()` **삭제** — 바로 브라우저 오픈으로 단순화(503 안내가 필요하면 redirect를 따라가지 않는 별도 status 엔드포인트 요청을 백엔드에 문서로 요청).
  2) 서버 detail 표출 시 문자열 타입·길이 검증 후 아니면 고정 안내문("소셜 로그인에 실패했습니다…")으로 대체(null/객체가 그대로 찍히는 것 차단).
  3) `err?.response` 계열 optional chaining은 이미 적용돼 있으나, `Linking.openURL` reject 시 사용자 안내 alert 추가(현재는 콘솔만).

#### A-3. 구조적 결함 — **APK에서는 성공해도 로그인이 완결될 수 없음** (이번 버전 핵심)
- 네이티브에는 토큰 복귀 경로가 없음: 콜백 수신이 웹 전용(App.tsx:442-458)이고 딥링크 라우트도 없어, OAuth가 성공해도 토큰은 **외부 브라우저의 웹 프론트에 남고 앱은 로그인되지 않음**. "다시 로그인을 누르니까"가 반복된 이유.
- 수정안(app-dev):
  1) `expo-web-browser` 추가, `WebBrowser.openAuthSessionAsync(loginUrl, 'aidol://oauth/callback')`로 교체(스킴 `aidol`은 app.json에 기존재).
  2) 백엔드에 앱 복귀 지원 요청(문서화): `/auth/oauth/{p}/login?client=app` 시 최종 리다이렉트를 `aidol://oauth/callback#token=JWT`로.
  3) 복귀 URL 파싱 시 **null 가드 필수**: `result?.type === 'success' && result.url`일 때만 토큰 추출 → `useAuthStore.getState().loginWithToken(token)`(stores/authStore.ts:82 기존재). 취소/dismiss 시 조용히 복귀(에러 alert 금지).
  4) 백엔드 준비 전까지는(백엔드 수정이 이번 버전에 안 들어오면) 현행 브라우저 오픈 유지 + A-2 방어만 반영하고, 버튼 하단에 "브라우저에서 로그인 후 앱으로 돌아와 주세요" 임시 문구 없이 **웹 프론트 로그인 유도 문구** 검토 — planner 판단: 백엔드 요청 문서를 이번 버전에 발행하고, 앱측 openAuthSessionAsync 전환은 백엔드 응답 확인 후 같은 버전 내 반영.

#### A-4. 콘솔 설정 안내 (코드로 해결 불가 — 사용자 전달용)
- 공통: 현재 방식은 **브라우저 리다이렉트(웹) 방식**이라 네이티브 SDK용 SHA-1/키 해시가 필수는 아님. 필요한 것은 각 콘솔의 **Redirect URI·플랫폼 등록·앱 상태**.
- 구글 (Google Cloud Console → API 및 서비스 → 사용자 인증 정보):
  1) OAuth 동의 화면이 "테스트" 상태면: 테스트 사용자에 로그인할 구글 계정 추가, 또는 "프로덕션으로 게시".
  2) 웹 클라이언트의 승인된 리디렉션 URI에 `https://api.maidol.ai.kr/api/auth/oauth/google/callback` (실제 백엔드 콜백 경로 — tester가 백엔드 팀에 정확 경로 확인) 등록.
  3) (향후 네이티브 SDK 전환 시에만) Android 클라이언트 생성: 패키지 `com.maidol.app` + SHA-1(`eas credentials` → Android → production keystore에서 확인 — 확인 명령까지만, 실행은 사용자/tester).
- 카카오 (developers.kakao.com → 내 애플리케이션):
  1) "앱 관리자 설정 오류"는 KOE101 계열 — 카카오 로그인 **활성화 OFF** 또는 잘못된 앱 키/플랫폼 미등록이 전형 원인.
  2) 제품 설정 → 카카오 로그인: 활성화 ON + Redirect URI `https://api.maidol.ai.kr/api/auth/oauth/kakao/callback` 등록.
  3) 앱 설정 → 플랫폼: Web 플랫폼에 `https://api.maidol.ai.kr` 등록. Android 플랫폼(패키지명 `com.maidol.app` + 키 해시)은 네이티브 SDK 전환 시 필요 — 지금 등록해두어도 무방.
- 백엔드측 확인 요청: `/auth/oauth/{google|kakao}/login·callback`의 client_id/secret env, `frontend_url` 설정값(미설정 시 `null/oauth/callback` 같은 리다이렉트가 만들어질 수 있음 — "null" 문구의 또 다른 후보).

#### A-5. "앱스토어에서 실행하지 않아서 생기는 문제인가?" — 사용자 전달용 답변
> 아니에요. APK를 직접 설치(사이드로드)한 것 자체는 구글/카카오 로그인 실패의 원인이 아닙니다. 원인은 두 가지입니다. ① 구글·카카오 개발자 콘솔에 이 앱(서버 주소·리다이렉트 주소)이 아직 제대로 등록되지 않아 로그인 페이지가 차단/오류를 띄우는 것(카카오 "앱 관리자 설정 오류"가 바로 그 증상), ② 앱이 브라우저에서 로그인 성공 토큰을 되돌려받는 통로가 아직 없어서, 설령 로그인에 성공해도 앱이 그걸 모르는 구조적 문제입니다. 둘 다 이번 버전에서 콘솔 등록 안내 + 앱/서버 수정으로 해결합니다. 플레이스토어에 올린 뒤에도 지금 상태로는 동일하게 실패했을 문제라, 오히려 미리 발견된 게 다행입니다. 참고로 "메일 창"은 로그인 버튼 바로 아래 있는 "고객센터" 링크(문의 메일)가 눌렸을 가능성이 큽니다 — 보내기를 누르셨다면 고객센터 주소로 빈 메일이 갔을 수 있어요.

---

### 이슈 B — "네이버로 계속하기" 제거
- 위치: `components/auth/SocialLoginButtons.tsx:15` PROVIDERS 배열의 naver 항목 1줄.
- 제거 범위(최소): 해당 1줄 삭제. 핸들러는 provider 제네릭이라 추가 정리 불필요, naver 전용 import/SDK 없음. 파일 상단 주석(1행 "3종")과 AuthPanel.tsx:2 주석의 "네이버" 표기만 함께 갱신.
- 백엔드 `/auth/oauth/naver/*`는 건드리지 않음(UI만 제거).

---

### 이슈 C — 이모지/텍스트 글리프 아이콘 전수 조사 및 교체
- 하트 확인: v3.193에서 이미 벡터 전환 완료 — PlayerScreen.tsx:1030-1034 `MaterialCommunityIcons heart/heart-outline 24`(좋아요), 1256(위시), TrackRow.tsx:78, TrackActionSheet.tsx:106, FeedCard.tsx:298 모두 Feather/MCI 벡터. **APK에서 이모지 하트가 보인 것은 구 빌드(4a313a5, ♥/♡ 텍스트 글리프) 때문 — 코드 수정 불필요, 재빌드로 해소.**
- 예외(교체 금지): ① **⭐ = 재화 '스타' 표기 — 전부 유지**(ChartScreen:283, GuestQueueNoticeModal:25, 각종 비용 안내 문구 등). ② 콘텐츠 문자열(ArtistCodyScreen.tsx:401-412 AI 프롬프트 내 ✓/❌, FeedCard.tsx:207 공유 메시지 🎁, 가사·대화 텍스트).
- 전수 목록 — **1차(이번 버전, 사용자 노출 빈도 높은 화면)**:
  - components/MiniPlayer.tsx:79 ♪ → Feather "music" / :96 ❚❚·▶ → "pause"/"play" / :115 ✕ → "x"
  - screens/PlayerScreen.tsx:910 ♪(커버 플레이스홀더) / :1123 ❚❚·▶(상단 미니바)
  - screens/ChartScreen.tsx:204·265 ♪ / :216 ▶(재생중 행 표시) / :317 ← → "arrow-left" / :331 ✕ / :304 📊·:355 🔍·:357 🎵(EmptyState icon)
  - screens/PlaylistScreen.tsx:181 ♫ / :233 ← / :264 ♫(EmptyState)
  - components/DraggableQueue.tsx:93 ▶(재생중 행)
  - components/TrackRow.tsx:34 ♪
  - screens/SearchScreen.tsx:247 🎧 / :272 🔍 / :274 🎵
  - screens/FeedScreen.tsx:275 LoginPrompt icon="👥"
  - components/auth/AuthPanel.tsx:417 ✓(비밀번호 힌트) → Feather "check"(미충족은 현행 '·' 유지 가능)
  - components/AppShareModal.tsx:82 ✕ / components/StarGuideModal.tsx:50 ✕ / components/AttendanceModal.tsx:88 ✕
  - components/StarGuideModal.tsx:16-21 행 아이콘 🎉🛡️👥📅🎧🚀 → Feather(gift/shield/users/calendar/headphones/rocket 계열, ⭐ 금액 표기는 유지)
  - components/AttendanceModal.tsx:123 ✅/🎁/🔒 → Feather check-circle/gift/lock
  - 공통 인프라: `components/ui/EmptyState.tsx`의 `icon?: string`을 `icon?: ReactNode`(또는 Feather name 문자열)로 확장, `components/LoginPrompt.tsx`의 `icon?: string`(Text 렌더, :17·27) 동일 처리 — 호출부가 벡터를 넘기도록.
- **2차(목록만 기록, 다음 버전)**: AgencyProfileScreen 111 ♪·125 ▶·126 ♥·179 🎤 / ArtistDetailScreen 51 CATEGORY_ICON(👕👖👟📍)·147 ←·155 ♪·181 🎵·194 ♪·200 ▶♥·212 💼·221 🛍 / PlayerScreen 61 CATEGORY_ICON / MyMusicScreen 521 ★·523 ▶·677 ♪ / FaceVerifyScreen 272 ✓·316 📷 / VoiceManageScreen 318 ▲▼ / VoiceCloneWizardScreen 577 ⏹▶·643 ✓·746 ↺ / MusicLoadingScreen 370 ✓ / ArtistLoadingScreen 617 ✓ / LyricsLoadingScreen 196 ✓ / CoverGenerationScreen 953 ✓·1043 ◀·1058 ▶ / LyricsPromptReviewScreen 416 ✎ / NotificationsScreen 134 "팔로잉 ✓" / MapScreen 543 ▸·642 ✕·688 → / DirectorLineupScreen 139 ★(티어 표시) / WaitTimerScreen 266 ▶ / VideoDirectorScreen 476 ♪ / AlbumDetailScreen 361 ♪ / PurchaseModal 44 💿·74 ↳·80 🎤·91 ✓ / LevelUpModal 85 🎉 / AttendanceModal 67·134 문구 내 ✅.

---

### 이슈 D — 스플래시 응원봉(라이트스틱) 제거
- 실체 확인: 응원봉 = `assets/branding/maidol_symbol.png`(141×172, 흰 실루엣) — **`screens/SplashScreen.tsx`에서만 사용**(24행 require, 85행 `<Image>`, 119행 `symbol` 스타일 64×66). 네이티브 스플래시 `assets/splash-icon.png`는 보라 "MAIDOL" 텍스트뿐이라 응원봉 없음 → 제거 범위는 SplashScreen.tsx 2막 심볼로 확정.
- 수정안: 24행 SYMBOL require·85행 Image·119행 symbol 스타일 삭제. 2막 컨테이너(`styles.act`)가 절대배치 중앙정렬이라 심볼 제거 시 로고 행+서브타이틀이 자동 재중앙 정렬 — 빈 공간 없음. 애니메이션(act2Opacity/act2Scale)·타이밍(4000ms)은 로고 행에 그대로 적용되므로 무변경. `logoRow.marginBottom: 16` 유지, 시각 확인 후 필요 시만 미세 조정. 에셋 파일은 디스크에 보존(재사용 대비).

---

### app-dev 작업 지시 (v3.194)
1. **B**: SocialLoginButtons.tsx PROVIDERS에서 naver 1줄 제거 + 주석 2곳("3종"·AuthPanel 헤더) 갱신.
2. **A-2 방어**: 프리플라이트 `api.get()` 제거, 서버 detail 표출 검증(문자열 아니거나 80자 초과 시 고정 문구), openURL 실패 시 사용자 alert.
3. **A-3**: 백엔드 요청 문서(`백엔드_요청_소셜로그인_앱복귀.md` — client=app 시 `aidol://oauth/callback#token=` 리다이렉트) 작성. 백엔드 준비 확인되면 expo-web-browser `openAuthSessionAsync` 전환 + null 가드(result?.type==='success' && result.url일 때만 파싱) + loginWithToken 연결. 미준비 시 전환 코드는 다음 버전으로 이월하고 문서만 발행.
4. **C 1차**: 위 1차 목록 전부 Feather/MCI 벡터 교체(색·크기는 기존 텍스트 스타일의 color/fontSize에 맞춤, 좋아요류 채움 토글은 heart/heart-outline 패턴 준수). EmptyState·LoginPrompt icon prop을 ReactNode로 확장. ⭐·콘텐츠 문자열은 손대지 않음.
5. **D**: SplashScreen.tsx 심볼 제거(24·85·119행), 레이아웃 자연스러움 확인.
6. 버전 문자열/주석 v3.194, 수정일 2026-09-20.

### test-designer 테스트 항목 (v3.194)
- [B] 로그인·회원가입 화면에 구글/카카오 버튼만 노출, 네이버 부재. 버튼 간격·구분선 정상.
- [A] 구글/카카오 버튼 탭 시 즉시 브라우저(또는 AuthSession) 1회만 열림 — 이중 요청(프리플라이트) 없음(네트워크 로그로 확인). 실패 시 alert 문구가 사용자용 문장인지(원시 오류/null 노출 금지). 브라우저에서 취소 후 복귀 시 앱 정상(무한 busy·크래시 없음), 재탭 정상 동작.
- [A-3 반영 시] OAuth 성공 → 앱 자동 복귀 → 로그인 상태 반영(설정 화면 프로필 표시), 취소 시 무반응 복귀. 콜드 스타트 딥링크 aidol://oauth/callback 처리.
- [C] 1차 교체 화면(플레이어·미니플레이어·차트·플레이리스트·검색·피드 CTA·로그인·공유/출석/스타 모달)에 이모지·글리프 문자 아이콘 잔존 없음(스크린샷 대조). ⭐ 표기는 그대로. 좋아요 하트: 탭 시 outline→filled 채움 토글, 이모지 렌더 없음(Android 실기기).
- [D] 스플래시 2막에 응원봉 미노출, MAIDOL 로고+서브타이틀 중앙 정렬, 1막→2막 전환 애니메이션·4초 후 MainTabs 진입 정상.
- [무회귀 v3.191~193] NowPlaying 상·하단 안전영역 겹침 없음(3.191) / VBR 곡 진행바·가사 싱크 정상, 제목 marquee 개행 없음(3.192) / 좋아요 서버 연동·담기→플레이리스트 시트·비로그인 CTA·타이포 축소 유지(3.193). 미니플레이어 재생/일시정지/닫기(아이콘 교체 후) 동작 동일.
- [tester 추가] 사용자 재현 세션 시각대 `/_logs/frontend` 서버 로그에서 "null" 오류 출처 확정, `eas credentials` SHA-1 확인(실행은 tester/사용자), kimpearl@lotusai.co.kr 수신함에서 빈 문의 메일 수신 여부 확인(메일 창 가설 검증).

### v3.194 추가 지시 (planner 판정 후속) — P1-4 고객센터 오탭 방지
- 배경: "메일 창" 최우선 가설 = 로그인 화면 소셜 버튼 바로 아래 CompanyFooter "고객센터"(mailto) 오탭. PLAN 본문에 구현 정의가 없어 미반영 상태였음 → 이번 버전 반영으로 판정.
- 구현 정의(최소 범위 2점, components/PolicySheet.tsx):
  1) `styles.companyBox`의 marginTop을 spacing.xl 이상으로 확대 — 소셜 버튼 블록과 시각·터치 분리.
  2) `CompanyFooter.openMail`: 즉시 `Linking.openURL('mailto:...')` 대신 `showAlert('고객센터', '고객센터(kimpearl@lotusai.co.kr)로 메일을 보낼까요?', [취소, 메일 열기])` 확인 다이얼로그 경유 — 오발송 차단 핵심 가드. utils/appAlert의 showAlert 사용(시스템 팝업 금지 방침 v3.85 준수).
- 테스트(test-designer 추가): 로그인 화면·설정 화면 각각에서 고객센터 탭→다이얼로그 노출, 취소=무동작, "메일 열기"=메일 앱 오픈. 소셜 버튼과 고객센터 간 여백 확대 확인. 이용약관/개인정보처리방침 링크 동작 무회귀.

## v3.195 — 2026-09-20 — [분석 전용] 카카오 콘솔 계정 단서 + 중복 곡 삭제 후보 조사 + 얼굴없이/커버 로직 분석 + 착장 크롤링 여부

> 이번 사이클은 코드 수정 없음. DB는 조회만(삭제 후보 목록화) — 실제 삭제는 오케스트레이터가 사용자 확인 후 별도 실행.

### A. 카카오 개발자 콘솔 계정 — 결론: 문서상 확인 불가 (등록 완료 정황은 확인됨)
- 로컬 문서 전수 조사(2_housing/docs/OAUTH_SETUP.md, 백엔드_요청_소셜로그인_앱복귀.md, PLAN/REPORT v3.194, git log): 콘솔 등록 **절차 안내만 있고 어떤 계정으로 했는지 기록 없음**. REPORT v3.194에 "콘솔 설정은 사용자 작업 필요(코드로 해결 불가)"로 사용자에게 이관한 기록만 존재.
- Gmail(kimpearl3599@gmail.com) 검색: Kakao Developers 발신 메일 0건 → 이 구글 메일 계정은 아닐 가능성 높음.
- 서버 정황: 프로덕션 `/api/auth/oauth/kakao/login` → **302**(구글도 302) = KAKAO_CLIENT_ID `.env` 설정 완료(.env 최종 수정 2026-09-18 06:52 UTC). 즉 누군가(=사용자 본인 추정) 콘솔에서 REST API 키를 발급받아 전달/설정함.
- **결론**: 카카오 개발자 콘솔은 카카오 계정으로 로그인하므로, 사용자가 developers.kakao.com 접속 시 자동 로그인되는 본인 카카오톡 계정일 가능성이 가장 높음. 확정은 developers.kakao.com → 우상단 프로필(계정 이메일)에서 직접 확인 필요.

### B. "제목 끝 숫자" 중복 곡 삭제 후보 (Mongo aimu.tracks — 전체 28곡 중 7곡 해당, 조회만 수행)

| # | track_id | 제목 | 생성일 | 소유자(닉네임) | 재생수 | 비고 |
|---|---|---|---|---|---|---|
| 1 | 69ce4c72b3d9beab06ce01f9 | 벚꽃피는 날 1 | 2026-04-02 | 오리쟁이 (18bd8131…) | 66 | 동일 generation_id 69cdf591… 6형제 |
| 2 | 69ce559c95664045e593cc18 | 벚꽃피는 날 2 | 2026-04-02 | 오리쟁이 | 18 | 〃 |
| 3 | 69ce5b1595664045e593cc1b | 벚꽃피는 날 3 | 2026-04-02 | 오리쟁이 | 16 | 〃 |
| 4 | 69ce5cd4874e73f0eb1b07af | 벚꽃피는 날 4 | 2026-04-02 | 오리쟁이 | 65 | 〃 |
| 5 | 69ce5f49d7bdcd377ca0e5e8 | 벚꽃피는 날 5 | 2026-04-02 | 오리쟁이 | 24 | 〃 |
| 6 | 69ce6fa83e517ff3cdc103b0 | 벚꽃피는 날 6 | 2026-04-02 | 오리쟁이 | 16 | 〃 |
| 7 | 6a718658fcd44fc403b85340 | starecon v158 upload test 1785824819 | 2026-08-04 | stareconA24819 (QA 계정) | 0 | 비공개 QA 업로드 테스트 잔재 |

- **오삭제 위험군(전량 해당)**: 숫자 없는 원본 "벚꽃피는 날"이 **존재하지 않음** — 1~6 전부 지우면 곡 자체가 소멸. 6곡은 같은 generation_id의 변형이므로 "중복 정리"라면 **1곡은 남기는 안**(재생수 최다 = "벚꽃피는 날 1", 66회)을 권고. 몇 번을 남길지 사용자 확인 필요.
- #7은 제목 끝 숫자가 붙었지만 중복 넘버링이 아닌 QA 테스트 곡(비공개·재생 0) — 삭제해도 무방하나 성격이 다르므로 별도 확인 항목.
- 참고(패턴 밖 실제 중복): "Cherry Blossom Day" 2곡(6a126e48…/6a127418…, 무신사, 같은 generation_id) — 숫자 미부착이라 이번 후보에서 제외했으나 진짜 중복이므로 사용자에게 고지 권장.

**안전 삭제 절차** — 백엔드에 완전 파기 공용 함수 기존재: `app/routes/tracks.py:870 purge_track_document()` (v138). 처리 범위: MinIO 오디오+전속 커버+공유영상 캐시(share/v5·v6), Mongo tracks, Redis 캐시(cache:track*·playcount buffer·차트 캐시 전체 무효화), ES 색인(es_delete_track), PG track_embeddings·likes, 소유자 앨범 카스케이드(빈 앨범 삭제). 관리자 API `DELETE /api/admin/tracks/{id}`(admin.py:477)도 있으나 **커버·공유영상·likes·앨범 카스케이드가 빠져 있어 purge 함수 직접 호출이 더 완전**함.
- 권고 실행안(오케스트레이터): ① 사용자에게 위 표 확인(남길 곡 지정) → ② 서버 docker(maidol-app) 내부에서 purge_track_document 호출하는 1회성 스크립트 실행 → ③ purge가 안 지우는 잔여 2종 수동 정리: Mongo `track_comments.delete_many({track_id})`, PG `DELETE FROM playlist_tracks WHERE track_id=…`(조회 시 자동 skip되지만 orphan row 정리) → ④ 차트/검색에서 잔존 확인.

### C. 얼굴 없이 만들기 · 캐릭터 시트 · 커버 이미지 로직 (파일:라인 근거)
1) **앱 UI 존재함**: `2_housing/screens/ArtistInputScreen.tsx:574` "사진 없이 만들기" 버튼(v3.76/MAIDOL v161) → `handleTextOnly()`(:327) photoUri=null로 질문 플로우 진입. 실사/캐릭터(가상) 모드 모두 지원(:351,354).
2) **캐릭터 시트 생성(얼굴 유/무 분기)**: 서버 `app/services/character_generator.py`. 2단계 파이프라인 — Step A 텍스트 모델(claude-opus-4-7 기본, :1025)이 시트 프롬프트 작성 → Step B 이미지 모델(gemini-3-pro-image-preview, 옵션 gpt_image_2, :1228)이 시트 이미지 생성. 분기는 :848 `has_photo`: **사진 있으면** [인물 사진] 정밀 분석(이목구비는 사진이 직접 기준) / **사진 없으면(v161)** "사용자 외모 설명이 유일한 정체성 소스 — 성별/나이/체형/얼굴형/머리/눈/피부톤을 설명에서 확정, 없는 요소는 K-pop 아이돌 프로필풍 자유 생성"(:880-892). 확정 특징은 [고정 요소]로 잠가 화풍 변환에도 보존. 인라인 이미지 파트에서 인물 사진만 생략(:947-961) — 이후 화풍·의상 참조 로직은 동일.
3) **커버 디렉터 — 아티스트 없이**: 앱 `CoverGenerationScreen.tsx:645` "아티스트 빼고" → character_object_name null 전송. 서버 `app/routes/upload.py:387` character_object_name 없으면 시트 미로드 → `app/services/cover_generator.py:293` **[B] character-無 분기**: 스타일 제약 없음(사진·일러스트·애니 등 자유), 구도/초점 등 아트디렉션 지시 중심, 성별 절만 명시. 시스템 프롬프트도 "any artistic style" 아트디렉터 페르소나(:405).
4) **얼굴 없이 만든 캐릭터로 커버**: 커버 파이프라인은 **원본 얼굴 사진을 전혀 쓰지 않고 캐릭터 "시트" 이미지만 참조** — upload.py:388-397이 MinIO에서 `characters.sheet_object_name`(실사)/`virtual_sheet_object_name`(가상) 오브젝트를 읽어 cover_generator [A] character-有 분기(:223)로 전달. 시트가 canonical(얼굴·머리·의상 그대로 유지 강제, :235-258; 착장 제품컷 추가 참조 v239, upload.py:414-430). 따라서 얼굴 없이(텍스트만) 만든 캐릭터도 **시트가 생성돼 있는 한 커버 생성 경로는 사진 기반 캐릭터와 100% 동일**. 가상 캐릭터는 화풍 라벨을 이어받아 일러스트 강제(:226-231), 실사는 photorealistic 강제(:244-258).

### D. 착장(상의/하의/신발) 데이터 — 크롤링 코드 없음, 1회성 시드만
- 데이터 소스: 서버 `seed_item_store.py`(v148) — **크롤러 아님**. 사전 준비된 item_images CSV(무신사·29cm·W컨셉·에이블리·지그재그·크림 6개 플랫폼)에서 이미지 URL을 받아 MinIO 업로드 + Mongo `ad_items` 시드하는 1회성 스크립트(seed_source 태깅 멱등). CSV 원본을 만든 크롤링 코드는 서버·로컬 어디에도 없음(수동 수집/외부 작업 추정). 현재 ad_items 455건 = 상의 157·하의 145·신발 153 — 카테고리도 이 3종뿐(악세서리·아우터 등 없음).
- 서빙 경로: `app/routes/business.py`·`wishlist.py`·`admin_ads.py`가 ad_items 사용.
- **자동화 주기 제안**: 패션 커머스 랭킹은 시즌/트렌드 회전이 주 단위 — **주 1회(예: 월요일 새벽) 갱신 + 시즌 전환기(3·6·9·12월) 전량 리프레시** 권장. 단, 대상 플랫폼들이 공식 API를 제공하지 않아 스크레이핑은 약관·robots 이슈가 있으므로, 자동화 전에 제휴/광고 계약(ad_items 구조가 이미 광고 모델임) 기반 피드 수급을 우선 검토할 것.
- **관리자 페이지**: 백엔드에 admin API 7종(`app/routes/admin.py`·admin_ads·admin_cs·admin_points·admin_issues·admin_notices·admin_moderation, get_admin_user 인증)이 이미 있으나 **웹 프론트(관리자 화면)는 서버·로컬 어디에도 없음**(StaticFiles 마운트·admin 호출 프론트 코드 0건) — 현재는 API 직호출만 가능. 착장 데이터 갱신 자동화는 admin_ads(아이템 CRUD)와 직접 연관되므로, **관리자 페이지 구축 + 크롤링/피드 자동화는 사용자 요청대로 별도 세션으로 분리**할 것을 권고(범위: admin 웹 UI 신설, 아이템 스토어 관리 탭, 수동 트리거 + 스케줄 갱신).

### 다음 액션 (오케스트레이터)
1. 사용자에게 B 표 제시 → 남길 곡(벚꽃피는 날 중 1곡 권장)·QA 곡·Cherry Blossom Day 중복 처리 확인 후 삭제 실행.
2. 카카오 콘솔 계정은 사용자 본인 확인(developers.kakao.com 프로필).
3. 관리자 페이지 + 착장 자동화는 별도 세션 발제.

## v3.196 — 2026-09-21 — 하단 시트 안전영역(제스처 바) 가림 + 텍스트 입력 키보드 가림 전면 정비

> 사용자 원본 요청: "차트 ⋮ / NowPlaying 담기의 하단 팝업이 모바일 UI(제스처 바)에 가려짐. 텍스트 입력 시 입력창이 키보드 위로 와야 함. 전체적으로 수정." (냥냥냥 데이터 수정은 오케스트레이터가 서버 직접 처리 — 본 계획 제외)
> 환경 전제: Expo SDK 54, `app.json` android `edgeToEdgeEnabled: true` + `softwareKeyboardLayoutMode: "resize"` 확인(app.json:35-36). RN `Modal`은 **별도 window라 루트 safe-area 패딩·adjustResize를 상속하지 않음** — v3.191 queueSheet 주석(PlayerScreen.tsx:1348)과 동일한 원리가 이번 이슈 전체의 원인.

### 0단계 분석 결과 (파일 직접 확인 완료)

**A. 하단 시트형 Modal 전수 (justifyContent:'flex-end' + Modal 기준 grep 전수)**

| 시트 | 파일:라인 | 하단 인셋 | 판정 |
|---|---|---|---|
| 곡 ⋮ 액션 시트 (차트·검색·플레이리스트 공용) | components/TrackActionSheet.tsx:89 (styles :158-159) | 없음 — sheet padding: spacing.xl 고정 | ❌ 수정 (사용자 지목 1) |
| 플레이리스트 담기 시트 | components/PlaylistPickerSheet.tsx:84 (styles :122-123) | 없음 | ❌ 수정 (사용자 지목 2) |
| SNS 공유/다운로드 시트 | components/TrackShareDownloadSheet.tsx:157 (styles :188-189) | 없음 — paddingBottom: spacing.xxl 고정 | ❌ 수정 |
| 착장 아이템 선택 시트 | screens/ArtistCodyScreen.tsx:761 (styles :1086-1090, modalOverlay flex-end + modalBox maxHeight 80%) | 없음 | ❌ 수정 |
| 재생목록(큐) 시트 | screens/PlayerScreen.tsx:1346-1349 | `insets.bottom + spacing.xxl` (v3.191) | ✓ 기준 사례 — 재수정 금지(이중 적용 주의) |
| 스타 구매 모달 | components/PurchaseModal.tsx:43 (:123 flex-end) | `16 + insets.bottom` | ✓ 유지 |

- 센터 배치(fade+center) 모달은 인셋 무관으로 제외: ConfirmDialog, GuestQueueNoticeModal, AttendanceModal, StarGuideModal, AppShareModal, ReportModal, AppealModal, AlbumCreateModal, AppDialogHost, MapScreen 팝업, Settings·PlaylistScreen·AlbumDetail·ArtistResult 각 모달.
- 부수 발견: screens/ChartScreen.tsx:445-447 `sheetBackdrop`/`sheet` 스타일은 TrackActionSheet 공용화 후 **미사용 잔존(죽은 코드)** — 삭제 대상. ChartScreen 검색 모달(:315-362) FlatList는 contentContainerStyle 하단 패딩 없음 → 마지막 행이 제스처 바에 걸림(보조 수정).
- **공용화 판단**: 수정 대상 시트가 4곳(+이미 적용 2곳)뿐이고 해법이 "스타일 한 줄"이므로 공용 BottomSheet 래퍼/훅 도입은 과대설계로 **기각**. v3.191 queueSheet 패턴(각 시트에 `useSafeAreaInsets` → `paddingBottom: insets.bottom + 기존패딩`)을 그대로 복제한다.

**B. TextInput 키보드 처리 전수**

정상(수정 금지 — 기준 패턴):
- PlayerScreen 상세패널 KAV(:1096, v3.182) + TrackComments 댓글 입력 — **기준 사례**
- 입력 화면군 KAV+offset: LyricsInput(:243), ComposerInput(:160), MusicGeneration(:1492), CoverGeneration(:993,:1157), ArtistInput(:719), LyricsPromptReview(:201), FeedCompose(:276), DmChat(:158), LyricsResult(:129)
- ScrollView `automaticallyAdjustKeyboardInsets`(iOS)+resize(Android): TrackUpload(:243), VoiceCloneWizard(:652), ArtistCody(:624), Settings 프로필편집(:715 부근)
- 입력창이 화면 상단이라 가림 없음: ChartScreen 검색(:321, paddingTop 아래 고정), SearchScreen(:209), DmInbox 새 메시지(:221)

문제/불명 (Modal 내부 = resize 미적용 위험):
| 위치 | 파일:라인 | 현황 | 판정 |
|---|---|---|---|
| 담기 시트 "새 플레이리스트" 입력 | PlaylistPickerSheet.tsx:86,105 | KAV behavior **iOS만 padding, Android undefined** | ❌ 핵심 — 사용자 지목. 하단 시트+입력이라 가림 최다 재현 지점 |
| 이름 변경 모달 | screens/PlaylistScreen.tsx:269-291 | KAV 없음 + autoFocus | ❌ |
| 앨범 정보 수정 모달 | screens/AlbumDetailScreen.tsx:447-475 | KAV 없음 (multiline 포함) | ❌ |
| 프로필 수정 모달 | screens/ArtistResultScreen.tsx:1406-1460 (TextInput :1421,:1429,:1451) | KAV 없음 | ❌ |
| 회원탈퇴 확인 모달 | screens/SettingsScreen.tsx:645-671 | KAV 없음 | ❌ (센터 배치라 경미) |
| 신고/이의 모달 | ReportModal.tsx:77 / AppealModal.tsx:95 / AlbumCreateModal.tsx:90 | KAV 있으나 **iOS만 padding** | △ Android 실기기 검증 후 동일 패턴 통일 |
| 피드 댓글 인라인 입력 | components/feed/FeedCard.tsx (FeedScreen 리스트 내) | 화면 KAV 없음 — 리스트 하단 카드에서 가림 가능 | △ 검증 후 판단 |
| DM 입력바 | DmChatScreen.tsx:219-233 (inputBar :266) | KAV 있음. 단 하단 insets.bottom 미반영(margin으로만 이격) | △ 보조 |

- edge-to-edge 상호작용: Android 15+/edgeToEdge에서 일반 Activity는 resize가 동작하나(위 "정상"군이 증거 — v3.182 댓글 입력 작동), **RN Modal 내부는 별도 window로 resize 보장이 없음** → Modal 안에서는 KAV를 플랫폼 공통 `behavior="padding"`으로 거는 것이 표준 해법. iOS 기존 동작은 동일하므로 회귀 없음.

### 1. app-dev 작업 지시 (우선순위순, 코드 수정은 app-dev가 수행)

**P1 — 사용자 지목 2곳 시트 인셋 (v3.191 queueSheet 패턴 복제)**
1) components/TrackActionSheet.tsx: `useSafeAreaInsets` import → Modal 내 `styles.sheet`에 `{ paddingBottom: insets.bottom + spacing.xl }` 병합(:91). 주석에 "Modal은 루트 인셋 미상속" 명시.
2) components/PlaylistPickerSheet.tsx: 동일 — `styles.sheet`에 `{ paddingBottom: insets.bottom + spacing.xl }`(:88).

**P2 — 사용자 지목 키보드: Modal 내부 KAV 플랫폼 공통화**
3) PlaylistPickerSheet.tsx:86 `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` → `behavior="padding"` (양 플랫폼). 키보드 열림 시 인셋 이중 여백이 어색하면 키보드 표시 중 insets.bottom 가산 생략(선택 최적화 — Android 실기기 확인 후).
4) 같은 패턴으로 ReportModal.tsx:77 / AppealModal.tsx:95 / AlbumCreateModal.tsx:90도 `behavior="padding"` 통일 — 단 **Android 실기기에서 3)이 가림 해소됨을 확인한 뒤** 일괄 적용.

**P3 — 나머지 하단 시트 인셋**
5) components/TrackShareDownloadSheet.tsx: `styles.sheet` paddingBottom을 `insets.bottom + spacing.xxl`로.
6) screens/ArtistCodyScreen.tsx: 아이템 선택 modalBox(:1087)에 `paddingBottom: insets.bottom` 보강(insets는 :150에서 이미 존재).

**P4 — KAV 없는 입력 모달 4곳: ReportModal과 동일한 래핑(KAV flex:1, behavior="padding", pointerEvents="box-none")**
7) PlaylistScreen.tsx 이름변경(:269) / 8) AlbumDetailScreen.tsx 앨범수정(:447) / 9) ArtistResultScreen.tsx 프로필수정(:1406) / 10) SettingsScreen.tsx 회원탈퇴(:645).

**P5 — 보조(시간 남으면, 각 1줄 수준)**
11) ChartScreen.tsx:445-447 미사용 sheet 스타일 삭제. 12) ChartScreen 검색 FlatList에 `contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}`. 13) DmChatScreen inputBar 하단 `marginBottom: spacing.lg + insets.bottom` (키보드 열림 시 이중 여백 확인). 14) FeedCard 댓글 입력 가림은 Android 실기기 재현 시에만 FeedScreen KAV 추가.

**금지/주의**: PlayerScreen queueSheet(:1349)·PurchaseModal(:43)은 이미 적용 — 손대지 말 것(이중 적용 금지). 웹(insets.bottom=0)에서는 전부 no-op이므로 웹 회귀 없음. v3.193 담기 시트 진입 경로(NowPlaying 담기→PlaylistPickerSheet)와 v3.194 아이콘 벡터화 파일들과 충돌 없음(스타일 라인만 변경).

### 2. test-designer 테스트 항목
- [P1] Android 실기기(제스처 내비): 차트 ⋮ 시트·담기 시트 마지막 항목/버튼이 제스처 바 위로 완전 노출. 3버튼 내비 모드에서도 확인. iOS(홈 인디케이터 기기)도 동일.
- [P2] 담기 시트에서 "플레이리스트 이름" 입력 탭 → 입력창+만들기 버튼이 키보드 바로 위 노출(Android/iOS 각각), 입력·생성·닫기 정상.
- [P3] 공유/다운로드 시트 mp3 항목, 착장 아이템 시트 하단 행 가림 없음.
- [P4] 이름변경·앨범수정·프로필수정·회원탈퇴 모달에서 키보드가 입력창을 가리지 않음(특히 앨범 설명 multiline·프로필 3필드 최하단 필드).
- [정상군 무회귀] 댓글 입력(PlayerScreen 상세, v3.182)·DM 채팅·가사/작곡 입력 화면 키보드 동작 그대로.
- [무회귀 v3.191~195] NowPlaying 상·하단 안전영역(3.191 queueSheet 이중 패딩 없는지 육안 확인), VBR 진행바·marquee(3.192), 좋아요 서버연동·담기 플로우(3.193), 소셜 로그인 복귀·아이콘 벡터화 화면(3.194). 웹 빌드에서 시트/모달 표시 동일(인셋 0).

### 3. 기록
- PLAN.md v3.196 append 완료 (본 섹션).

## v3.197 — 2026-09-21 — 차량(BT)/화면꺼짐 상태 다음곡 자동재생 실패 + 재생버튼 무반응 복구 불능 수정 계획

> 사용자 원본 요청: "APK — 블루투스 연결 차 안에서 재생 시 재생목록 다음곡이 재생 안 됨. 재생버튼 눌러도 무반응, 미니플레이어 닫고 곡을 다시 클릭해야만 재생됨. BT 끊고 모바일 단독이면 자동 다음곡 정상."
> 환경: Expo SDK 54 + expo-av ~16.0.8 (package.json:20-21). 코드 수정 금지 — 본 문서는 계획만.

### 1. 가설별 코드 근거 (0단계 분석 — 파일 직접 확인 완료)

**H1 (최우선 확정 원인 후보): 백그라운드 곡 전환이 "unload → 네트워크 재로드" 구조 — 무음 갭 + 네트워크 의존**
- 곡 종료 처리 didJustFinish 2계통 모두 동일 구조:
  - `screens/PlayerScreen.tsx:410-443` — didJustFinish → 기존 sound `unloadAsync()`(:423) → `getAudioUri`(:425, 네이티브는 stream-proxy URL 문자열 즉시 반환) → `Audio.Sound.createAsync({uri}, {shouldPlay:true})`(:426-430) = **이 시점에 네트워크 스트림 로드 시작**. 실패 시 catch(:440-442)는 `console.warn`만.
  - `services/playback.ts:121-129` — loadAndPlayTrack 상태 콜백 안 didJustFinish → `loadAndPlayTrack(다음곡)` 재귀(:125) → 내부에서 unload(:91-93)+createAsync(:98-100).
- 오디오 모드 설정 현황: `services/audioMode.ts:12-19` — `staysActiveInBackground: true`, DoNotMix(iOS/Android), `shouldDuckAndroid: false`. **설정 자체는 이미 정석**. iOS `UIBackgroundModes: ["audio"]`도 존재(app.json:24-27).
- 그러나 Android에는 **포그라운드 서비스·미디어 알림이 없음**(app.json:29-37에 관련 항목 없음) — expo-av 자체가 미지원이며 audioMode.ts:5 주석에 "네이티브 잠금화면 미디어 알림은 expo-av 미지원 — react-native-track-player 필요(별도 과제)"로 이미 자인돼 있음.
- 종합: 곡이 끝나는 순간 unload로 **재생 중 오디오가 0이 되는 무음 갭**이 생기고, 그 갭에 Android가 알림 없는 백그라운드 앱을 cached/frozen 처리(Android 12+ cached-app freezer, Doze 네트워크 유예)하면 createAsync의 네트워크 로드가 완료되지 못해 전환이 죽는다. 화면 켜짐(손에 들고 사용) 시 정상인 것과 정확히 일치 — **BT는 원인이 아니라 "차량 = 화면 꺼짐/거치" 상황의 프록시**일 가능성이 높다. 단, 확진은 (e) 원격 계측으로.
- 큐 소진 시 관련곡 이어듣기는 한 단계 더 취약: `services/playback.ts:34-85` `autoContinueWithRelated`가 `GET /tracks/{id}/related` **API 왕복**(:47)까지 필요 — 백그라운드 실패 확률 최고.

**H2: 오디오 포커스/인터럽션·에러 상태 미처리 — 부분 확정(에러 무시는 확정, 포커스 이벤트는 expo-av가 노출 안 함)**
- 상태 콜백이 `if (status.isLoaded)` 단독 분기: `PlayerScreen.tsx:376-377`, `playback.ts:102`. expo-av가 미디어 에러 시 주는 `{isLoaded:false, error}` 상태는 **어느 쪽에도 처리 분기가 없어 무음 무시** → 사운드가 죽어도 UI는 마지막 상태로 방치. (grep 결과 `status.error`/`!status.isLoaded` 처리 0건)
- 포커스 상실/오디오 라우트 변경 이벤트는 expo-av JS API에 미노출 — 직접 구독 불가. AppState 복귀 시 재생상태 리컨사일 코드도 전무(AppState 사용처는 remoteLogger.ts:276 flush뿐, App.tsx에 없음).

**H3: 재생버튼 복구 부재 — 확정 (BT 무관 견고성 결함, 사용자 복구 경로와 정확히 일치)**
- `PlayerScreen.tsx:727-734` `togglePlayPause`: `if (!soundRef.current) return;` 후 pause/playAsync 호출뿐 — isLoaded 검사·try/catch·재로드 폴백 전무. unloaded 사운드에 playAsync → reject(무반응 + unhandled rejection).
- `components/MiniPlayer.tsx:22-31` `togglePlay`: 동일 + 낙관적 `setIsPlaying` (실패해도 아이콘만 토글).
- **죽은 참조가 잔존하는 이유**: 전환 실패 시 ① playback.ts:91-93에서 기존 sound를 unload했지만 store.sound를 null로 갱신하지 않고, createAsync 실패 catch(:142-144)는 로그만 — `setIsPlaying(false)`도 없음 ② PlayerScreen.tsx:422-424 → 실패 catch(:440-442)도 동일하게 soundRef.current가 unloaded 객체로 잔존. 이후 재생버튼은 죽은 객체에 playAsync만 반복 → 무반응.
- 유일 복구 경로 = 미니플레이어 닫기(`MiniPlayer.tsx:53-57` invalidatePlayback+cleanup으로 참조 초기화) 후 곡 재클릭(playTrackNow 신규 로드) — **사용자 보고 "미니 닫고 다시 클릭해야만 재생"과 정확히 일치**.

### 2. 수정 방안 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| (a) 오디오 모드 설정 보강 | **부분 적용** | staysActiveInBackground 등 핵심 설정은 이미 정석(audioMode.ts:12-19) — 신규 옵션 추가는 없음. 대신 **복구 재로드 경로(c)에서 `applyPlaybackAudioMode()` 재호출**(인터럽션 후 포커스 재획득)만 추가. app.json 변경 없음(iOS audio 기존재, Android는 expo-av 한계로 추가할 항목 자체가 없음). |
| (b) 다음 곡 프리로드 | **적용 (핵심)** | 곡 종료 시점의 네트워크 의존 제거 + 무음 갭 최소화(freeze 트리거 약화). 난이도 **중** — 주의점 4개는 아래 작업지시 참조. |
| (c) 재생버튼 견고화 | **적용 (핵심)** | H3 확정 결함. BT/차량과 무관하게 고쳐야 할 견고성 문제 — 전환이 어떤 이유로 죽어도 "재생버튼 1탭"이 복구 경로가 되게 한다. |
| (d) 인터럽션/포커스 복구 | **부분 적용** | 가능한 것만: ① 상태 콜백에 `else if (!status.isLoaded && status.error)` 분기(로그+isPlaying 정합) ② AppState 'active' 복귀 리컨사일. 포커스 이벤트 직접 구독은 expo-av 미노출로 **보류**(track-player 과제로 이관). |
| (e) [BTDebug] 원격 계측 | **적용** | 차량 재현 불가 → 사용자 주행 후 서버 로그로 H1 확진. **반드시 console.warn 레벨** 사용 — remoteLogger는 warn/error만 프로덕션 후킹(remoteLogger.ts:218-219), info는 DEV 전용(:220-222). 로그인 필수(:153)·백그라운드 진입 시 flush(:276-281)+5초 인터벌·큐 cap 200이라 주행 중 실패분도 앱 복귀 시 전송됨. |
| 관련곡 이어듣기(related API) 프리페치 | **보류** | 큐 내 전환 프리로드가 우선. related 프리페치는 "언제 끝날지"에 더해 "무엇이 다음인지"도 서버 의존이라 범위 초과 — track-player 과제와 함께 재검토. |

### 3. app-dev 작업 지시 (파일 단위)

**T1. services/playback.ts — 프리로드 공용 모듈 (신규 export)**
- `preloadNext()`: 현재 곡 남은 시간 ≤ 20초(또는 position/duration ≥ 85%) 시점에 다음 곡을 `createAsync({uri}, {shouldPlay:false})`로 미리 로드해 모듈 스코프 `nextPreload = { trackId, sound, pinnedIdx, gen }` 보관. 트리거는 양쪽 상태 콜백에서 호출(1회 가드).
- `consumePreloaded(expectedTrackId)`: didJustFinish에서 pinnedIdx 트랙과 매치하면 preload된 sound를 반환(즉시 `playAsync()` + 콜백 부착) — 매치 실패/미존재면 null 반환 → 기존 createAsync 경로 폴백.
- **주의점 4개**: ① `getNextIndex()`는 shuffle 시 호출마다 랜덤(playerStore.ts:178-183) — 프리로드 시점에 다음 인덱스를 **핀(pinnedIdx)**하고 didJustFinish는 핀을 사용(현재처럼 종료 시 재호출 금지) ② 수동 스킵·큐 편집(remove/reorder)·셔플/반복 토글·미니 닫기 시 프리로드 폐기 — 기존 loadGen 세대 토큰(:11-17)에 연동해 unloadAsync 후 버림 ③ 로더 2계통(playback.ts loadAndPlayTrack ↔ PlayerScreen 자체 createAsync) **양쪽 didJustFinish 모두** consumePreloaded를 먼저 시도 ④ 프리로드 곡 duration도 v3.192 effectiveDuration 보정(playback.ts:106-120) 경로를 타야 함(콜백 부착 시점 주의).
- loadAndPlayTrack catch(:142-144) 보강: `store.setSound(null)` + `store.setIsPlaying(false)` + `[BTDebug]` warn. unload 직후(:91-93)에도 setSound(null)로 죽은 참조 창 제거.
- 상태 콜백(:101-)에 `else if (!status.isLoaded && status.error)` 분기: `console.warn('[BTDebug] sound error', {...})` + `setIsPlaying(false)`.

**T2. screens/PlayerScreen.tsx**
- `onPlaybackStatusUpdate`(:376-475): ① isLoaded else-분기에 status.error 처리(위와 동일) ② 프리로드 트리거 호출(position 기반, effectiveDuration 사용) ③ didJustFinish(:410-473)에서 consumePreloaded 먼저 → 폴백 시 기존 경로. 폴백 catch(:440-442)에서 `soundRef.current = null; store.setSound(null); store.setIsPlaying(false)` + [BTDebug] warn.
- `togglePlayPause`(:727-734) 견고화: try/catch + `getStatusAsync()`로 isLoaded 확인 → 미로드/에러/soundRef null이면 `applyPlaybackAudioMode()` 후 현재 store.track을 `loadAndPlay(track)`로 재로드(현 position 복원은 선택 — 1차는 처음부터 재생으로 충분, 복잡도 억제). playAsync 실패 catch에서도 동일 폴백 + [BTDebug] warn.
- autoContinueWithRelated 주입 로더(:451-471)에도 실패 시 참조 정리 동일 적용.

**T3. components/MiniPlayer.tsx**
- `togglePlay`(:22-31) 견고화: T2와 동일 패턴 — getStatusAsync 검사, 죽었으면 `loadAndPlayTrack(track)` 폴백(+applyPlaybackAudioMode). 낙관적 setIsPlaying 제거(성공 후 상태 콜백이 반영).

**T4. AppState 복귀 리컨사일 (App.tsx 1곳 또는 playback.ts에 init 함수)**
- `AppState 'active'` 진입 시: store.sound 존재 && store.isPlaying=true인데 `getStatusAsync()`가 !isLoaded/error면 → `setIsPlaying(false)` + 참조 정리 + `[BTDebug] reconcile` warn. (자동 재재생은 하지 않음 — 사용자가 재생버튼 1탭으로 복구, (c)가 받아줌. 운전 중 갑작스러운 자동 재생 시작 방지.)

**T5. [BTDebug] 계측 포인트 (전부 console.warn, 민감정보 금지)**
- didJustFinish 진입: `{ trackId, nextIdx, appState: AppState.currentState, preloadHit: bool }`
- 프리로드 시작/성공/실패, 전환 createAsync 성공/실패(catch), 재생버튼 폴백 발동(어느 화면), status.error 분기, autoContinueWithRelated 실패, AppState 리컨사일 발동.
- 출시 후 사용자 주행 → 서버 `/api/_logs/frontend` 로그에서 `[BTDebug]` 검색으로 H1 확진(백엔드 로그 조회는 오케스트레이터).

**T6. app.json — 변경 없음** (확인만: iOS UIBackgroundModes audio :24-27 유지).

### 4. test-designer 항목

**시뮬레이터/에뮬레이터 가능**
- 큐 2곡+ 자동 전환(포그라운드): 순차·shuffle·repeat all/one 각각 — 프리로드 히트 시에도 전환 정상, 재생바 0부터, 70% 재생기록(record-play) 곡당 1회 유지.
- 마지막 곡 소진 → 관련곡 자동 이어듣기 무회귀(PlayerScreen 열림/미니 두 경로).
- 수동 스킵/큐 편집/셔플 토글 직후 곡 종료 — 핀된 프리로드가 폐기되고 올바른 곡으로 전환(잘못된 곡 재생 금지), 이중 재생(고아 사운드) 없음.
- 재생/일시정지 토글 반복 — 지연·이중재생 없음, 미니↔풀 화면 전환 후 콜백 정상(재생바 갱신).
- 웹: getAudioUri presigned 경로(PlayerScreen.tsx:479-491)에서 프리로드 정상 동작 확인, 아니면 네이티브 한정 플래그 확인.

**실기기 전용 (BT/차량/화면꺼짐은 에뮬 재현 불가 — Android APK 필수, iOS 병행 권장)**
- 화면 끄고(잠금) 곡 종료 대기 → 다음 곡 자동재생 (핵심 시나리오, 3곡 이상 연속).
- BT 스피커/차량 헤드유닛 연결 + 화면 끄고 동일 시나리오.
- 전환 실패 유도: 곡 말미 비행기모드 → 전환 실패 → 재생버튼 **1탭**으로 현재 곡 복구(미니플레이어·풀 플레이어 각각). 미니 닫기 없이 복구되어야 통과.
- BT 연결 해제(재생 중 이어폰/차량 끊기) → 일시정지됨 → 재생버튼 1탭 복구.
- 전화 수신 인터럽션 → 통화 종료 후 재생버튼 복구.
- 배터리 최적화(절전 모드) 켠 삼성/샤오미류 기기에서 화면 꺼짐 연속재생 — 실패하더라도 [BTDebug] 로그가 서버에 도착하는지 확인(로그인 상태 전제).

**무회귀 (v3.191~196)**
- 3.191 queueSheet 인셋, 3.192 VBR duration 보정(프리로드 곡에도 effectiveDuration 적용 확인)·marquee, 3.193 좋아요 서버연동·담기 시트, 3.194 소셜 로그인 APK 복귀·벡터 아이콘, 3.196 하단 시트 인셋·입력 모달 KAV. 미니플레이어 닫기(cleanup) 후 재클릭 재생(기존 복구 경로)도 여전히 정상.

### 5. 근본 해결 판정 — react-native-track-player 이관: **필요, 별도 세션 분리 권고**
- expo-av는 Android 포그라운드 서비스·미디어 알림 미지원(audioMode.ts:5 주석으로 기자인) + Expo 공식 deprecated(expo-audio로 대체 권고 흐름). 화면 꺼짐/차량 장시간 연속재생의 **완전한** 신뢰성과 잠금화면 컨트롤은 track-player(포그라운드 서비스+미디어 세션+네이티브 큐)가 정도.
- 현 구조는 사운드 소유권이 3곳(playback.ts / PlayerScreen 자체 soundRef / MiniPlayer via store)에 분산 — 이관은 재생 파이프라인 전면 재편(대수술)이므로 v3.197 범위 밖. **[BTDebug] 로그로 H1 확진 후 별도 세션 발제**(그때 expo-audio vs RNTP 비교 포함). 이번 개선으로 재발 빈도·복구성은 크게 좋아지나, 무음 갭 없이도 프로세스를 freeze하는 공격적 절전 기기에서는 한계 잔존 — 임시 완화로 사용자에게 "앱 배터리 최적화 제외" 안내 가능.

### 6. 기록
- PLAN.md v3.197 append 완료 (본 섹션). 코드 수정 없음 — app-dev 착수 대기.

## v3.198 — 2026-09-21 — 미니플레이어 시작 시 노출 + 담기 시트 키보드 닫힘 후 간격 잔존 + 카카오 초대 링크 랜딩/OG 카드 + 인스타·페북 버튼 동작 답변

> 사용자 원본 요청: "APK — ① 앱 첫 접속부터 하단 미니 플레이어가 보인 채 시작 ② 플레이리스트에 담기에서 텍스트창을 열었다 닫으면 하단 UI가 살짝 간격이 생긴 채 떠 있음 ③ 카카오 공유 링크(https://api.maidol.ai.kr/invite/7VFU) 클릭 시 어디로 연동? 플레이스토어 링크로 연동 + 카톡 메시지를 이미지 있는 예쁜 카드로 ④ 인스타그램/페이스북 공유 버튼은 공유인가, 내가 영상·음악을 올리는 기능인가?"
> 환경: RN(Expo SDK 54) + FastAPI(EC2, 소스 /home/ubuntu/maidol/backend_9004 → docker 컨테이너 maidol-app :9006, nginx api.maidol.ai.kr→127.0.0.1:9006). 코드 수정 금지 — 본 문서는 계획만.

### 1. 이슈 A — 앱 시작부터 미니플레이어 노출 (원인 확정)

**원인 체인 (파일:라인 확인 완료)**
1. 앱 부팅: `App.tsx:510` `restoreSession()` → 저장 토큰 유효 시 `authStore.ts:91` `loginWithToken` 성공 → `usePlayerStore.getState().restoreQueueFor(userId)` 호출.
2. `stores/playerStore.ts:140-152` `restoreQueueFor` — 보관함(savedQueues)에 그 계정 큐가 있으면 `track: saved.track`(:148)까지 복원(일시정지 상태, `isPlaying:false, sound:null`).
3. `components/MiniPlayer.tsx:24` — v3.197에서 렌더 조건을 `!track || !sound` → **`if (!track) return null;`** 로 완화(전환 실패로 sound가 null이어도 "재생버튼 1탭" 복구 경로 유지 목적, MiniPlayer.tsx:22-23 주석). 부수효과로 **로그인 복원 큐의 track만 있어도(재생한 적 없어도) 미니가 뜬다** → APK 자동로그인 사용자는 앱 켜자마자 일시정지 미니 노출. 사용자 보고와 정확히 일치.

**수정 방안 — `sessionActive` 플래그 (v3.197 복구 경로 보존이 제약)**
- `stores/playerStore.ts`: 비영속 상태 `sessionActive: boolean`(초기 false, partialize 제외 — 현행 partialize(:217-222)가 화이트리스트라 추가 작업 없음) 신설.
  - **set true**: `setSound(sound)`(:82)에서 `sound`가 truthy일 때 — 재생 시작점이 3곳(playback.ts:268·306, PlayerScreen.tsx:431·476·520·578 등)에 분산돼 있으므로 각 호출부가 아니라 **스토어 setter 한 곳**에서 걸어야 누락이 없다: `setSound: (sound) => set(sound ? { sound, sessionActive: true } : { sound })`.
  - **set false(리셋)**: `resetOnLogout`(:126-130)과 `restoreQueueFor`(:145-151)의 set에 `sessionActive: false` 추가. `cleanup`(:205)은 track도 null이라 미니가 어차피 숨음 — 리셋 불필요하나 일관성 위해 넣어도 무해.
- `components/MiniPlayer.tsx:24`: `const hasSound = usePlayerStore((s) => !!s.sound);` + `sessionActive` 구독 후 조건을 **`if (!track || (!hasSound && !sessionActive)) return null;`** 로.
  - 시나리오 검증: ① 앱 시작 복원 큐 = track만, sound null, sessionActive false → **숨김(수정 목표 달성)** ② BT 전환 실패로 sound가 정리(null)돼도 이번 세션에 재생한 적 있음(sessionActive true) → **미니 유지 + 재생버튼 1탭 복구(v3.197 보존)** ③ cleanup 후 track null → 숨김(현행 동일) ④ 로그아웃→다른 계정 로그인: resetOnLogout+restoreQueueFor 양쪽에서 리셋 → 숨김.
- 주의: v3.197이 MiniPlayer에서 sound 직접 구독을 제거했으므로(MiniPlayer.tsx:15 주석) `!!s.sound` **불리언 셀렉터**로만 구독할 것(사운드 객체 구독 금지 — 리렌더 소음 방지). 복원 큐를 미니 없이 재생 시작하는 경로(MyMusic 등 곡 탭)는 playTrackNow→setSound로 자연히 sessionActive true가 된다.

### 2. 이슈 B — 담기 시트 키보드 닫은 뒤 하단 간격 잔존 (원인 규명)

**현황**: `components/PlaylistPickerSheet.tsx:88` — v3.196에서 KAV를 **양플랫폼 `behavior="padding"`** 으로 확장한 유일한 지점(커밋 메시지 "담기 시트 KAV 양플랫폼"과 일치). 나머지 v3.196 적용처는 전부 iOS 전용이라 이 버그와 무관: ReportModal.tsx:77, AppealModal.tsx:95, AlbumCreateModal.tsx:90, DmChatScreen.tsx:158 모두 `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — **영향 평가: 확산 없음, 수정 범위는 담기 시트 1곳**.

**메커니즘(추정 — Android 한정)**: RN KAV는 Android에서 `keyboardDidShow/DidHide` 이벤트의 endCoordinates로 `상대 키보드 높이 = 뷰 프레임 bottom − keyboard.screenY`를 계산해 paddingBottom을 준다. SDK 54(Android edge-to-edge 강제) 환경의 Modal 별도 window에서는 ① 키보드가 닫힐 때 마지막 프레임 계산에 제스처 내비 바 높이만큼 잔차가 남거나 ② hide 이벤트 순서 문제로 padding이 0으로 완전 복원되지 않는 기지의 RN 이슈가 있다 — "살짝 간격(≈제스처 바 높이)"이라는 증상·재현 절차(열었다 닫기)와 정합. 또한 열려 있는 동안에도 시트 자체 `paddingBottom: insets.bottom + spacing.xl`(:91)과 KAV 키보드 높이가 **인셋을 이중 계상**한다.

**수정 방안 (권장: Android 수동 패딩, iOS 현행 유지)**
- `PlaylistPickerSheet.tsx`: KAV `behavior`를 iOS 전용으로 되돌리고(`Platform.OS === 'ios' ? 'padding' : undefined`), Android는 `Keyboard.addListener('keyboardDidShow', e => setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom)))` / `'keyboardDidHide', () => setKbPad(0)` 로 시트 컨테이너에 `paddingBottom: insets.bottom + spacing.xl + kbPad` 직접 부여(visible false 시·언마운트 시 리스너 해제 + kbPad 0 리셋).
  - hide 시 **무조건 0으로 리셋**하므로 잔존 간격이 구조적으로 불가능하고, show 시 `- insets.bottom` 보정으로 이중 계상도 해소. v3.196의 목적(Android Modal 키보드 가림 해소)은 유지.
- 대안(차선): KAV 유지 + `keyboardVerticalOffset={-insets.bottom}` — 잔존 버그 자체가 KAV 내부 계산에 있어 재발 위험, 비권장.
- 회귀 확인: 이 시트는 v3.193에서 담기 흐름에 진입점이 늘었으므로(TrackActionSheet→담기) 두 진입 경로 모두에서 테스트.

### 3. 이슈 C — 초대 링크 랜딩 + 카톡 OG 카드 (서버 확인 완료 → backend-dev 설계)

**현재 동작 (확정)**
- 공유 문구의 링크: `components/AppShareModal.tsx:50` `${BACKEND_BASE_URL}/invite/${code}` (BACKEND_BASE_URL = https://api.maidol.ai.kr, services/api.ts:5).
- 서버에는 **루트 `/invite/{code}` 라우트가 없다**. 있는 것은 `app/routes/referral.py:43-58` `GET /api/referral/invite/{code}`(JSON 데이터, 무인증)뿐. 실측: `curl https://api.maidol.ai.kr/invite/7VFU` → **404 `{"detail":"Not Found"}`** — 즉 현재 카톡 링크를 누르면 브라우저에 JSON 404가 뜬다(사용자 질문에 대한 답).
- 보상 로직은 이미 완비: 가입 시 추천코드 입력 → `app/routes/auth.py:268-284` inviter/joiner 각 ⭐50(`referral_inviter`/`referral_joiner`, day="-" 영구 1회 멱등) + 가입 보너스 ⭐50(:258-263). **랜딩은 코드 노출·복사와 스토어 유도만 하면 됨** — 딥링크로 코드를 앱에 전달하는 기능은 이번 범위 밖(가입 화면에서 수동 입력, 현행 유지).
- play_store_url 기존재: `app/config.py:170` `https://play.google.com/store/apps/details?id=com.maidol.app` (referral.py:39·57 응답에 이미 포함).
- 인프라: nginx api.maidol.ai.kr → 127.0.0.1:9006 = docker 컨테이너 maidol-app(Dockerfile:150 `COPY app/ ./app/`, :203 uvicorn :9006). **app/ 아래에 정적 파일을 두면 이미지 빌드에 자동 포함**. 참고: /home/ubuntu/maidol/backend_9004/restart_9004.sh는 9004 직접 기동용 구스크립트 — 실서비스는 9006 컨테이너.

**설계 — 루트 초대 랜딩 페이지 (backend-dev 코드 초안 수준)**
1. **OG 이미지 준비**: 앱 저장소에 1200×630 정확 규격 이미지 기존재 — `/Users/pearl/TripleJ/2_housing/assets/og/beta-event-og.png`. 이를 서버 소스 `app/static/og/invite_og.png` 로 복사(신규 디렉터리). 보조 후보: assets/branding/maidol_logo.png(256×271, 페이지 내 로고용), 서버 app/assets/watermark_logo.png.
2. **정적 마운트**: `app/main.py` admin_static 마운트(:864-868) 옆에
   `app.mount('/static', StaticFiles(directory=os.path.join(os.path.dirname(__file__), 'static')), name='static')` (디렉터리 존재 가드 동일 패턴).
3. **라우트**: `app/routes/referral.py`에 프리픽스 없는 별도 라우터 추가 —
   ```python
   public_router = APIRouter()  # 루트 — 카톡/브라우저 사람용 랜딩

   @public_router.get("/invite/{code}", response_class=HTMLResponse)
   async def invite_landing(code: str, conn=Depends(get_pg)):
       row = await resolve_referrer(conn, code)   # 기존 재사용(무효 코드 → None)
       nickname = html.escape(row["nickname"]) if row else None
       ok = row is not None
       # ok=False여도 200/404 HTML + 스토어 버튼은 항상 노출(공유 링크가 죽은 경험 방지)
       return HTMLResponse(status_code=200 if ok else 404, content=_render_invite_html(
           code=html.escape(code) if ok else None, nickname=nickname,
           store_url=settings.play_store_url))
   ```
   `app/main.py:754` 부근에 `app.include_router(referral.public_router)` 추가. (Starlette은 GET 라우트에 HEAD 자동 대응 — 카카오 스크래퍼 HEAD 프리플라이트 OK.)
4. **HTML 구성**(`_render_invite_html`, f-string 인라인 템플릿 — 별도 템플릿 엔진 불요):
   - `<head>`: `<meta property="og:title" content="MAIDOL 초대장 — {nickname}님의 초대">`, `og:description "베타 테스트 기간 가입 시 스타 50 추가 증정! 추천코드 {code}"`, **`og:image "https://api.maidol.ai.kr/static/og/invite_og.png"`(절대 URL 필수)** + `og:image:width 1200`/`og:image:height 630`, `og:url`(자기 자신), `twitter:card summary_large_image`, `<meta name="viewport" ...>`. → **카톡이 이 링크를 이미지 카드로 자동 렌더**(문구·og만으로 충분, Kakao SDK 템플릿 불요 — 앱 공유 코드는 무변경).
   - `<body>`(모바일 다크, 앱 톤): MAIDOL 로고/워드마크 → "{nickname}님이 MAIDOL에 초대했어요" → 추천코드 대형 표기 + [코드 복사] 버튼(`navigator.clipboard` + execCommand 폴백) → 보상 안내("추천코드로 가입하면 두 사람 모두 ⭐50 · 베타 기간 가입만 해도 ⭐50 추가") → **주 CTA [Google Play에서 다운로드] = settings.play_store_url** → 보조 링크 "이미 설치했다면 열기" `href="aidol://"`(app.json:5 scheme, best-effort). 무효 코드면 코드 영역 대신 "유효하지 않은 초대코드" + 스토어 CTA 유지.
5. **배포·검증**: 소스 수정 → docker build → 컨테이너 교체(오케스트레이터 기존 절차). 검증: ① `curl -I https://api.maidol.ai.kr/invite/7VFU` 200/HTML ② `curl https://api.maidol.ai.kr/static/og/invite_og.png` 200 ③ 무효코드 404 HTML ④ **카카오 OG 캐시**: 기존 404가 스크랩 캐시됐을 수 있음 — https://developers.kakao.com/tool/debugger/sharing 에서 캐시 초기화 후 실기기 카톡 공유로 카드 확인.
- **앱 쪽 변경 없음**: shareTextBase/Full(AppShareModal.tsx:53-54) 문구·URL 그대로 — 링크가 카드+랜딩으로 예뻐지는 것으로 요구 충족. (선택 사항으로도 문구 수정 불요.)

### 4. 이슈 D — 인스타그램/페이스북 버튼 동작 (분석·답변만, 코드 무변경)

- `components/AppShareModal.tsx:66-74` `handleShare`: 카카오톡/인스타그램/페이스북 세 버튼 **모두 동일하게** RN `Share.share({ message: shareTextFull })` — OS **네이티브 공유 시트**를 띄우는 것뿐이고 target 값은 로그에만 쓰임(:67). 인스타/페북 API 연동·스토리 업로드·영상/음악 업로드 기능이 아니다.
- **사용자 전달용 답변**: "세 버튼은 전부 '초대 문구+링크를 텍스트로 공유'하는 기능입니다. 누르면 폰의 공유 시트가 뜨고 거기서 앱을 고르는 방식이라, 인스타그램은 텍스트 링크 공유를 잘 받지 않아(DM 정도만 가능) 체감상 어색할 수 있습니다. 영상·음악을 인스타/페북에 올려주는 기능이 아닙니다. 참고로 곡 영상 공유는 별도의 TrackShareDownloadSheet 흐름이 담당합니다. 추후 개선 옵션: 세 버튼을 '공유하기' 단일 버튼으로 통합하거나, 인스타 스토리 공유(이미지 스티커) 같은 진짜 SNS 연동은 별도 과제로."

### 5. 작업 지시

**app-dev (A·B — 2_housing)**
1. `stores/playerStore.ts`: `sessionActive` 비영속 플래그 신설 — setSound(truthy)에서 true, resetOnLogout/restoreQueueFor(+cleanup)에서 false. partialize 무변경(화이트리스트라 자동 제외).
2. `components/MiniPlayer.tsx:24`: 렌더 조건 `if (!track || (!hasSound && !sessionActive)) return null;` — `!!s.sound` 불리언 셀렉터 구독, v3.197 주석 갱신(복구 경로 보존 명시).
3. `components/PlaylistPickerSheet.tsx`: KAV behavior iOS 전용 복귀 + Android `keyboardDidShow/Hide` 수동 패딩(`max(0, kbHeight - insets.bottom)`, hide 시 0 강제 리셋, visible/언마운트 시 리스너 해제). 다른 KAV 4곳(Report/Appeal/AlbumCreate/DmChat)은 iOS 전용이므로 손대지 않는다.
4. app.json 버전 v3.198 갱신(기존 관례).

**backend-dev (C — maidol-ec2 backend_9004, 랜딩 코드 초안은 §3 참조)**
1. `/Users/pearl/TripleJ/2_housing/assets/og/beta-event-og.png` → 서버 소스 `app/static/og/invite_og.png` 반입.
2. `app/main.py`: `/static` StaticFiles 마운트 + `referral.public_router` include.
3. `app/routes/referral.py`: `public_router` + `GET /invite/{code}` HTML 랜딩(§3-3·4 초안대로 — OG 태그·코드 복사·Play 스토어 CTA·무효코드 404 HTML). XSS 방지 `html.escape` 필수.
4. 배포는 오케스트레이터 기존 절차(docker build→컨테이너 교체, :9006) — 배포 후 §3-5 검증 4종 + 카카오 스크랩 캐시 초기화.

**test-designer (v3.191~197 무회귀 포함)**
- A: ① 자동로그인 APK 콜드 스타트 → 미니 미노출 ② 곡 재생 → 미니 노출 → BT 전환 실패 상황(sound null)에서도 미니 유지+재생버튼 1탭 복구(v3.197 회귀) ③ 로그아웃→재로그인 → 미니 미노출 ④ 미니 닫기(cleanup) 후 미노출.
- B: 담기 시트에서 입력창 포커스→키보드 닫기(뒤로가기/빈곳 탭 각각) 반복 → 하단 간격 0, 키보드 열림 중 입력창 가림 없음(v3.196 회귀), 제스처 바 겹침 없음(v3.191/196 회귀). iOS 동작 무변경. Report/Appeal/AlbumCreate 모달 키보드 동작 스팟 체크.
- C: 유효/무효 코드 랜딩 200/404, OG 카드 실기기 카톡 렌더, Play 스토어 버튼 이동, 코드 복사 동작(Android Chrome/iOS Safari), 기존 `GET /api/referral/my-code`·가입 보상 플로우 무회귀.
- 공통: v3.192 duration·v3.193 담기 흐름·v3.194 소셜 로그인 복귀·v3.197 다음곡 프리로드 스팟 회귀.

### 6. 기록
- PLAN.md v3.198 append 완료 (본 섹션). 코드 수정 없음 — app-dev/backend-dev 착수 대기.

---

## v3.199 (2026-09-21) — 작업실 UX 4종: 기획사 이니셜 아바타(A) · 디렉터 대화 뒤로가기(B) · 엔터명 마퀴(C) · 선택값 편집 아이콘(D)

### 0. 범위·전제
- 대상: `/Users/pearl/TripleJ/2_housing` (RN Expo SDK 54). 백엔드 무변경.
- v3.198 사이클 미커밋 파일(`stores/playerStore.ts`, `components/MiniPlayer.tsx`, `components/PlaylistPickerSheet.tsx`)과 **무접점** — 본 건 대상 파일과 겹치지 않으므로 병행 안전. app-dev는 위 3파일을 건드리지 말 것.
- 이모지 금지 방침 준수: 아이콘은 Feather 벡터, 이니셜은 텍스트 콘텐츠(허용).

### 1. 이슈 A — 기획사 프로필 이니셜 아바타 + 배경색

**현황(파일:라인)**
- 공용 `components/ui/Avatar.tsx`가 이미 표준: 이미지 없으면 **첫 글자 이니셜**(:33) + **seed 해시 기반 8색 팔레트** 배경(FALLBACK_PALETTE :17-20, seedColor :22-27, v3.181). 같은 계정은 항상 같은 색(결정적).
- Avatar 정상 적용처: DmChatScreen:164, DmInboxScreen:145·242, TrackComments:128·171, FeedCard:325, UserChannelScreen:238 — 모두 이니셜+색 폴백 동작.
- **구멍 1 (사용자가 본 "빈 기본값" 유력 지점)**: `screens/AgencyProfileScreen.tsx:153-171` profileBox — 아바타/이미지 요소가 아예 없음(기획사명 텍스트+지표만). PlayerScreen:1028-1029에서 구형 곡(uploader_id 없음) 기획사 탭 시 진입하는 화면.
- **구멍 2**: `screens/SettingsScreen.tsx:463-470` — 이니셜(nickname[0])은 있으나 배경이 고정 accent 단색(avatarCircle :938-946). 팔레트 규칙 미적용(Avatar 미사용 — 편집 배지·업로드 스피너 때문에 자체 구현).
- 소소: UserChannelScreen:238 Avatar에 `seed` 미전달 → name 해시 폴백(색 다양성은 확보되나 닉네임 변경 시 색이 바뀜 — v3.181 취지와 어긋남).
- 참고: 작업실 상단 헤더(MapScreen:267-282)·MyMusic 성장카드(:487)는 기획사 **이미지 요소 자체가 없는 텍스트 디자인** — A 범위 아님.

**사용자 질문("배경 색상 다양하게 랜덤 맞지?")에 대한 답변(전달용)**
"네, 다양하게 나옵니다 — 정확히는 매번 바뀌는 완전 랜덤이 아니라, 계정 id(또는 이름)를 해시해 8색 팔레트에서 고르는 방식이에요(v3.181). 그래서 사용자들끼리는 색이 다양하게 갈리되, **같은 기획사는 언제 어디서 봐도 항상 같은 색**입니다. 볼 때마다 색이 바뀌면 '내 기획사 색'이라는 식별성이 사라지고 목록 리렌더마다 색이 튀기 때문에, 랜덤처럼 다양하되 결정적인 지금 방식이 UX상 우월해서 그대로 유지합니다. 대신 이 규칙이 안 닿던 두 곳(기획사 프로필 폴백 화면 — 이미지가 아예 비어 있던 곳, 설정 아바타 — 색이 보라 단색 고정이던 곳)을 이번에 같은 규칙으로 통일합니다."

**수정 방안**
1. `AgencyProfileScreen.tsx` profileBox 상단(companyLabel 위, 중앙)에 `<Avatar name={uploaderNickname} seed={uploaderId || uploaderNickname} size={64} />` 추가 — 이 화면은 이미지 데이터 자체가 없으므로 이니셜 아바타가 곧 기본값. 신규 컴포넌트 불요(Avatar 재사용).
2. `components/ui/Avatar.tsx`의 `seedColor`를 named export로 승격 → `SettingsScreen.tsx` avatarCircle 폴백 배경을 `seedColor(user.id, user.nickname)`로 교체(이미지 있으면 기존대로). 편집 배지/스피너 구조 보존을 위해 컴포넌트 통째 교체 대신 색 함수만 재사용.
3. UserChannelScreen:238에 `seed={authorId}` 전달(1줄).

### 2. 이슈 B — 디렉터 대화 중 상단 뒤로가기 아이콘

**현황**
- 대화는 별도 스크린 `StudioStack > Dialogue` (App.tsx:180-187, `transparentModal`+fade). 스택 레벨 헤더는 없음(App.tsx:174 headerShown:false).
- 단, Studio **탭 헤더**(titleHeader App.tsx:374-381, MapScreen:261-287이 setOptions로 기획사명+ⓘ 타이틀을 덮음)는 대화 중에도 상단에 그대로 떠 있음 — 그런데 좌측 back 요소가 없음(headerLeft: undefined :283, 우측은 HomeHeaderActions).
- 현재 복귀 수단: 대화 끝까지 탭(DialogueScreen:244 goBack) · Android HW back · 하단 작업실 탭 재탭 리셋(App.tsx:369-372)뿐 — 명시적 상단 UI 부재.

**수정 방안**
- `DialogueScreen.tsx`에 `useFocusEffect`로 부모 탭 헤더에 back 주입: `const parent = navigation.getParent(); parent?.setOptions({ headerLeft: () => <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: 12 }} accessibilityLabel="작업실로 돌아가기"><Feather name="arrow-left" size={22} color={colors.text.primary} /></TouchableOpacity> })` — 아이콘·마진·사이즈는 stackHeader 관행(App.tsx:293-298) 그대로.
- **cleanup 필수**: blur/unmount 시 `parent?.setOptions({ headerLeft: undefined })` 복원. MapScreen useLayoutEffect는 deps 불변 시 재실행되지 않아, 미복원 시 Map 복귀 후에도 화살표가 잔존한다.
- 화면 내 절대배치 오버레이 버튼 대안은 탭 헤더와 이중 상단바가 되므로 비권장.
- **확장(포함, 동일 패턴)**: `LyricsInputScreen`·`ComposerInputScreen`도 같은 탭 헤더 아래 back 없음("디렉터와 이야기하는 중"의 연장) — 동일 useFocusEffect 패턴 적용. goBack만 수행(확인 팝업은 과설계; 두 화면의 chatHistory는 로컬 state라 이탈 시 초기화됨을 알고 있는 동작). 우선순위: Dialogue > 확장 2종.

### 3. 이슈 C — 작업실 상단 엔터테인먼트 이름 폭 제한 + 마퀴

**현황**
- `screens/MapScreen.tsx:267-282` headerTitle: `user?.company_name`을 fontSize 17/700 Text `numberOfLines={1}`로 렌더 — **폭 제약 없음**. headerTitleAlign 'left', 우측 HomeHeaderActions(로그인 시 별 배지·출석·초대·알림·DM·마이페이지 6요소, 대략 220~260px). 긴 기획사명("○○○ 엔터테인먼트" 자동 접미까지, AuthPanel:29-33)이 우측 액션 영역을 침범/겹침.
- 재사용 대상 `components/Marquee.tsx`(v3.192 ScrollView 측정판): 넘칠 때만 흐르고 짧으면 정적. 단 container가 `width:'100%'`(:82)라 **부모가 명시 폭을 줘야** 동작 — bottom-tabs headerTitle 컨테이너는 폭 제약이 느슨하므로 명시 maxWidth 필수.

**수정 방안**
- headerTitle 렌더를: `const { width: winW } = useWindowDimensions();` → `nameMaxWidth = winW - (user ? 260 : 150)` 근사(우측 액션+좌마진+ⓘ+gap 여유, 실기기 360dp에서 최소 90px 확보되게 하한 `Math.max(90, …)`).
- `<View style={{ flexDirection:'row', alignItems:'center', gap:6 }}><View style={{ width: nameMaxWidth }}><Marquee text={user?.company_name || '작업실'} style={{ fontSize:17, fontWeight:'700', color: colors.text.primary }} /></View>{ⓘ 기존 그대로}</View>` — ⓘ는 마퀴 밖 고정(흐르는 텍스트와 분리, 항상 같은 자리에서 탭 가능). useLayoutEffect deps에 winW 추가.
- Marquee 자체는 무수정(PlayerScreen 제목 등 공용 — v3.192 무회귀 유지).

### 4. 이슈 D — 대화 선택값 편집(연필) 아이콘

**현황**
- 기준 패턴(이미 완성): `screens/VideoDirectorScreen.tsx:402-414` — user 버블 탭=해당 스텝 롤백 수정(handleEditChoice :138-141) + **`<Feather name="edit-2" size={11} color="rgba(255,255,255,0.7)" style={{marginLeft:6}}/>` 아이콘 표시(:411, v3.182)**.
- `screens/LyricsInputScreen.tsx:304-322` — user 버블 탭 시 재선택 모달 **동작은 이미 있음**(handleReselect :188-192, handleReselectChoice :194-223, 모달 :402-419)이나 **아이콘 없음**. 어포던스는 안내 문구 한 줄(:278-282)뿐. 자유입력 스텝은 choices 없어 재선택 비대상(:189-190 no-op).
- `screens/ComposerInputScreen.tsx:173-200` — user 버블이 plain View로 **탭 자체가 불가**, 수정 기능 부재. 사용자는 "선택하면 수정할 수 있잖아"로 인지 중 — 작곡 흐름에는 사실이 아니어서, 아이콘만 붙이면 거짓 어포던스가 된다 → 기능 이식이 전제.

**수정 방안**
1. **LyricsInput**: user 버블 텍스트 우측에 edit-2 아이콘(VideoDirector :411 스펙 동일). 노출 조건 `msg.type==='user' && msg.step!=null && STEPS[msg.step]?.choices?.length`(자유입력 답변엔 미표시 — 탭해도 무동작이므로). 버블 내부를 row 배치(텍스트+아이콘, alignItems center).
2. **ComposerInput**: LyricsInput 재선택 패턴 이식 — ChatMessage에 `step` 기록(user push :111·:138), 버블 View→TouchableOpacity, handleReselect/handleReselectChoice(스텝 0 genre·1 mood·2 vocal만 — 3·4는 freeText라 제외) + 재선택 모달(LyricsInput :402-419·styles :561- 이식), 동일 아이콘·동일 노출 조건. 수정 시 로컬 state와 chatHistory 텍스트 동시 갱신 — 최종 프롬프트는 완료 시점 state로 조립(:118-123)되므로 정합.
3. VideoDirector 무변경(기준).

### 5. 작업 지시

**app-dev (전부 2_housing, v3.199 주석 태깅 관례)**
1. [A] `components/ui/Avatar.tsx` seedColor named export 승격 → `screens/SettingsScreen.tsx` 아바타 폴백 배경색 적용(:463-470·:938-946), `screens/AgencyProfileScreen.tsx` profileBox에 Avatar(64) 추가, `screens/UserChannelScreen.tsx:238` seed={authorId}.
2. [B] `screens/DialogueScreen.tsx` useFocusEffect로 탭 헤더 headerLeft back 주입+blur 복원(§2 스펙). 이어 `LyricsInputScreen`·`ComposerInputScreen` 동일 패턴.
3. [C] `screens/MapScreen.tsx:261-287` headerTitle에 winW 기반 maxWidth + Marquee 적용(§3 스펙, deps winW 추가). Marquee.tsx 무수정.
4. [D] `screens/LyricsInputScreen.tsx` user 버블 edit-2 아이콘(조건부), `screens/ComposerInputScreen.tsx` 재선택 이식+아이콘(§4 스펙).
5. 금지: v3.198 미커밋 3파일(playerStore/MiniPlayer/PlaylistPickerSheet) 및 backend 접촉 금지. 버전 표기는 커밋 메시지 관례(v3.199).

**test-designer (v3.191~198 무회귀 포함)**
- A: 이미지 미설정 계정 — ① 설정 아바타: 이니셜+팔레트색(고정 보라 아님), 앱 재실행에도 같은 색 ② 구형 곡(uploader_id 없음) Player→기획사 탭→AgencyProfile: 이니셜 아바타 노출 ③ UserChannel·피드·DM·댓글 아바타 색 계정별 상이+불변 ④ 이미지 설정 계정: 이미지 그대로(회귀) ⑤ 프로필 이미지 업로드/삭제(v3.92) 무회귀.
- B: 디렉터 탭→대화 진입: 상단 좌측 화살표 노출→탭→Map 복귀. 복귀 후 헤더에 화살표 **잔존 없음**(cleanup). Android HW back 동일. 하단 작업실 탭 재탭 리셋 무회귀. 작사/작곡 입력 화면 back 동작.
- C: 짧은 기획사명 정적 표시+ⓘ 탭 가능 / 20자+ 긴 이름에서 별 배지·우측 아이콘 침범 없음+텍스트 흐름 / 360dp 소형 기기 · 비로그인('작업실') 확인 / PlayerScreen 제목 마퀴 무회귀(v3.192·v3.159 center).
- D: 작사 — 선택 답변 버블에만 연필 표시(자유입력 답변 미표시), 탭→재선택 모달→값·버블 갱신(v3.110 매핑 무회귀); 작곡 — 장르/분위기/보컬 수정 신규 동작+최종 프롬프트 반영, 자유입력 2종 비대상; 영상 디렉터 수정 흐름(v3.182) 무회귀.
- 공통: v3.196 시트 키보드·v3.197 다음곡 전환·v3.198 미니플레이어 게이트(병행 사이클) 스팟 회귀.

### 6. 기록
- PLAN.md v3.199 append 완료 (본 섹션). 코드 수정 없음 — app-dev 착수 대기.

## v3.200 (2026-09-21) — Phase 0 창작 기록 계층 1차 슬라이스 + "일반/저작권 등록 트랙" UI 분기(coming soon)

### 0. 범위·전제
- 요구사항 원문: /Users/pearl/Downloads/Phase0_창작기록계층_개발요구사항.md (v1.0, 7종 이벤트·해시 체인·append-only·F1~F9). 사용자 의도 두 갈래: ① 기록 계층을 이번 테스트 배포에 반영(소급 불가 — 지금부터 쌓여야 함) ② UI에 일반/저작권 등록 트랙 분기 노출(저작권 등록 트랙 = "정식 프로모션 출시 예정").
- 대상: 앱 /Users/pearl/TripleJ/2_housing + 백엔드 maidol-ec2 backend_9004(이번 사이클은 계획만 — 코드 수정 없음, 서버 읽기 전용 확인 완료). 배포는 오케스트레이터 기존 절차.
- 파일 변경 규모: 앱 ~6파일 신설/수정, 백엔드 ~5파일 — 40% 미만, 사용자 확인 플래그 불필요.

### 1. 현재 아키텍처 실측 (파일:라인)

**F1 §3.4 "앱은 엔진을 직접 호출하지 않는다" — 이미 충족.**
- 앱에 Suno API 키·엔드포인트 직접 참조 없음(전 소스 grep — voiceService.ts:44 주석, constants/consentTexts.ts:108 고지 문구뿐). 작곡 요청은 `services/musicService.ts:279 api.post('/generate/', body)` → 백엔드 `routes/generate.py:588 create_generation` → `services/suno_generator.py:61 generate_music_suno`(SUNO_API_KEY 서버 전용 :87). Wondera 경로(musicService.ts:295)도 동일하게 프록시.

**요청·응답 저장 현황 — 전문(全文)은 미저장 (F1 최대 갭).**
- 요청: generate.py:641-693이 generations(Mongo `aimu`.generations) doc에 파라미터를 **필드별로** 저장(prompt·genre·mood·lyrics·persona_id·suno_model·lyrics_source(v214) 등). 그러나 suno_generator.py:139-171에서 조립되는 **엔진 전송 body JSON 전문은 버려짐**. canonical 해시도 없음 → is_regeneration_of 판정 불가.
- 응답: 폴링 record-info 전문(status_data)은 미저장. 추출 필드만 — `suno_task_id`(:222 `result["data"]["taskId"]`), variant별 `suno_audio_id`(:296·:340 `sunoData[].id`), MinIO object_name, timestamps(suno_generator.py:333-430).
- 오디오: audioUrl에서 받은 mp3 바이트를 **재인코딩 없이 그대로** MinIO `generated/{gen_id}/suno_output.mp3`(+2번째 variant)에 저장(:316-330·:364) — §16-2 요건 이미 충족. 단 SHA-256 미계산.
- 후보 2개(2-variant) 모두 저장됨(v74) — "기각 후보 포함 전 후보 저장" 요건 충족.

**후보 청취·선택 UI (LISTEN/CANDIDATE_SELECT 계측 지점).**
- `screens/MusicResultScreen.tsx` v3.93 A/B 비교: variants 조회 :211-232, 재생/정지 :144-209(expo-av), variant 전환 미리듣기 :293-305, 선택 variant로 발매 :358(`variant_index`). 여기가 유일한 후보 비교 화면 — play/pause/전환/선택 핸들러에 계측 삽입.

**FINALIZE 지점.**
- 발매 = MusicResultScreen handleSave(:331-») → `POST /tracks/upload-from-generation`(tracks.py:1866-1945, variant_index 검증 :1925-1945, 원본 object 복사). 다운로드/공유 = `components/TrackShareDownloadSheet.tsx`. 서버측 훅 1곳(upload-from-generation)으로 FINALIZE 기록 가능.

**가사 흐름 — 버전·diff 개념 없음.**
- 작사 디렉터 → `POST /generate/lyrics/`(lyricsService.ts:20, generate.py:509) → `LyricsResultScreen.tsx` 초안 편집(:38-92, '수정' 토글 :189) → `MusicGenerationScreen.tsx` 추가 편집(:89-90·:311-324) → 생성 요청 lyrics 필드. 가사는 store 단일 문자열 — 중간본 유실. lyrics_source 스냅샷(v214)은 출처 id뿐. **AI 초안 원문과 사용자 수정본의 구분이 현재 데이터로는 소급 불가 → 버전 캡처가 이번 슬라이스 필수.**

**DB.**
- Mongo(motor, aimu) generations·tracks — 앱 계정 full RW. PG(asyncpg pool, app/database/postgres.py) 이미 운용중: face_verify·admin_notices/cs/issues·track_embeddings(tracks.py related). → append-only 이벤트는 **PG 별도 스키마**가 적합(§16-4 답 참조).
- 실측 규모: generations 총 69건, 최근 30일 5건, 2-variant 12건, tracks 26건 — 이벤트 볼륨 부담 전무.

**F6 현황.**
- 생성물 표시: `screens/PlayerScreen.tsx:988-996` "AI 생성" 뱃지(v3.171, 전 곡 공통) — 곡 상세·플레이어 충족.
- 사전 고지: 가입 동의문(constants/consentTexts.ts — AI 생성 콘텐츠 권리 :40-43, 국외이전·프롬프트 전송 :95-119). "생성형 AI로 음악을 생성합니다" 취지 포함.
- 미비: ① 보컬 음향 합성 별도 고지(공유·발매 화면) ② 설정에서 상시 확인 ③ 다운로드 파일 ID3 메타 ④ 문구 서버 설정화.

**F7·② 배치 관련.**
- 설정 앱 정보 섹션 존재(SettingsScreen.tsx:580-583) — 특허 표기 자리.
- ComposerSelectScreen은 v3.127부터 자동 skip(WONDERA_ENABLED=false :53-57, 사용자에게 미노출) — "생성 시작 시점" 배치 후보로 부적합.
- 주의 실측: 참고 음악 업로드(`/generate/upload-reference/`, v3.91, musicService.ts:116-152)가 존재 → 문서 §4.3의 `import_blocked=true` 전제가 **현재 앱에는 성립하지 않음**. SESSION_START에 `import_blocked:false` + 참고음악 사용 시 request 기록에 reference_audio_url이 남는 구조로 기록해야 함(허위 플래그 금지).

### 2. 슬라이싱 — v3.200(이번 테스트 배포) vs 후속

원칙: **소급 불가능한 "원천 데이터 확보"는 전부 이번에, 소급 계산 가능한 "가공·검증·강화"는 후속에.**

**v3.200 포함 (이번):**
| 항목 | 이유 | 규모 |
|---|---|---|
| B1. F1 보강 — 엔진 요청 body 전문·응답 record-info 전문·audio SHA-256·requested_at/responded_at·request_body_hash(canonical, seed류 제외)를 generations doc+이벤트에 저장 | 전문·해시는 생성 시점에만 확보 가능. suno_generator.py 국소 수정 | 백 소(1파일 ~50줄) |
| B2. F2/F3 골격 — PG `creation_log` 스키마(sessions·events, §5.4 컬럼 전부+UNIQUE(session_id,seq)) + **해시 체인 서버 계산 포함**(부록 B ~20줄, seq·server_ts·해시 전부 서버 부여라 지금 넣는 게 소급 계산보다 싸다) + `POST /sessions`·`POST /sessions/{id}/events`(배치, event_id idempotent) + generate create가 session_id optional 수용(없으면 서버 자동 생성 — 구버전 앱 요청도 기록) + SESSION_START/GEN_REQUEST/GEN_RESPONSE 서버 기록 + upload-from-generation 내부 FINALIZE 훅(candidate 존재 검증 §4.4) | 이벤트 스키마 §5.2 완전 준수로 시작해야 체인·검증이 뒤에 붙음 | 백 중(신규 라우터+서비스 ~400줄) |
| B3. 가사 버전 저장 `POST /sessions/{id}/lyrics`(전문+prev_version_id+source) + LYRIC_EDIT 이벤트 | AI 초안/사용자 수정 중간본은 지금 안 남기면 영원히 소실. **토큰 diff·origin_summary 계산은 후속** — 버전 전문 체인만 있으면 §7.3 규칙이 결정적이라 소급 계산 가능 | 백 소 |
| A1. 앱 세션 연동 + LISTEN/CANDIDATE_SELECT 계측(MusicResultScreen 4지점) + FINALIZE trigger 전달 | 청취·선택 사실은 앱에서만 발생 | 앱 중(신규 creationLogService+계측) |
| A2. 앱 가사 버전 커밋 3지점 — LyricsResult 진입 시 ai_draft, 편집 '완료' 시, 생성 요청 직전 | 위 B3의 원천 | 앱 소 |
| A3. F6 경량 — 공유/다운로드 시트·발매 완료에 "이 곡의 음성은 AI로 합성되었습니다" 1줄 + 설정>앱 정보에 AI 생성 고지 상시 항목 | 법정 의무(P0)인데 작업량이 작음. 뱃지·가입고지는 기존 충족 | 앱 소 |
| A4. ② UI 트랙 유형 분기(§3) + 발매 payload `track_type:"standard"` 기록(B: tracks doc 저장) | 사용자 요청. 기록 관점에서도 FINALIZE에 유형이 남는 게 프로모션 분기 소급 근거 | 앱 소·백 미 |

**후속 (v3.201+):**
- 오프라인 SQLite 큐 §5.5 완전판(이번엔 메모리 큐+배치 전송·지수 백오프 — 강제종료 시 유실 허용. 수용기준 §5.6-3은 후속에서 달성): 테스트 배포 사용자 규모에서 유실 리스크 < 구현 지연 비용.
- F5 토큰 origin 태깅·origin_summary·붙여넣기 감지: 버전 전문에서 소급 계산 가능.
- §5.4 DB 권한 분리(이벤트 UPDATE/DELETE 불가 계정)·MinIO 객체 잠금·F8 보존 정책: 운영 변경이라 prod 승인 필요(maidol-admin-web 메모 규칙) — 별도 사이클.
- F9 검증 API/CLI·일 배치: 체인이 이번부터 쌓이므로 언제든.
- ID3 메타 기입·F6 문구 서버 설정화.
- F7 특허 표기: 출원번호 확보 전 표기는 허위표시 위험 — 출원 접수 후.
- is_regeneration_of 소급 판정(request_body_hash가 이번부터 저장되므로 가능)·ABANDONED 30일 배치·parent_session_id 재편집 세션.

### 3. ② "일반 트랙 / 저작권 등록 트랙" UI 분기 설계 (사용자 확인용 제안)

**배치 — 이번 배포는 발매 확정 화면(MusicResultScreen) 권장, 프로모션 때 시작 시점으로 승격.**
- 1안(권장, v3.200): MusicResultScreen 발매(저장) 버튼 위 "트랙 유형" 섹션. 근거: ① 현재 저작권 등록 트랙은 선택 불가(coming soon)라 시작 시점에 두면 실질 선택지 1개짜리 마찰만 추가 ② 생성 시작부(ComposerSelect)는 자동 skip 화면이라 자리가 없고 MusicGeneration은 대화 시퀀스라 개편 비용이 큼 ③ 발매 직전은 "이 곡을 어떤 트랙으로 낼까"가 자연스러운 의사결정 지점.
- 2안(프로모션 정식판): 작곡 디렉터 진입 직후 첫 선택 스텝으로 승격 — 사용자 원래 구상("생성 시점부터 분기")대로. 그 시점엔 SESSION_START payload에 track_type이 남아 전 과정 분기 근거가 된다. v3.200 기록 계층이 깔리므로 승격은 UI 작업만.

**UI 스펙(1안).**
- 카드 2개 세로 배치, 기존 카드 톤(theme/colors) 준수.
  - [일반 트랙] 기본 선택·체크 표시. 부제: "지금 바로 발매하는 기본 트랙이에요."
  - [저작권 등록 트랙] dim 처리 + 우상단 배지 "정식 프로모션 출시 예정". 부제: "작사·작곡 전 과정을 기록해 저작권 등록 증빙 자료 생성(준비 중)을 지원하는 트랙이에요."
- 저작권 등록 트랙 탭 시 showAlert(앱 내 다이얼로그 규칙, 시스템 Alert 금지): 제목 "저작권 등록 트랙", 본문 "정식 프로모션 때 출시될 예정이에요. 지금 만드는 곡도 작사·작곡 과정이 기록되고 있어요." — 사실 서술만.
- **문구 금지선(F7 §9 준수)**: "저작권 등록 가능/보장/인정" 단정 금지, "특허 기술" 언급 금지. 허용: "창작 과정을 기록합니다", "저작권 등록 증빙 자료 생성 기능(준비 중)".
- 발매 payload에 `track_type: 'standard'` 포함(서버 tracks doc 저장) — 프로모션 때 'copyright_ready' 값 추가만 하면 됨.

### 4. 작업 지시

**backend-dev (maidol-ec2 backend_9004 — 이번 사이클 실작업 시 브랜치 확인·보고 후 진행, 9004만)**
1. [B2] PG `creation_log` 스키마: `sessions`(session_id PK, user_id_hash, status, parent_session_id, started_at, finalized_at, root_hash, final_candidate_id, final_lyrics_version_id, app_version, import_blocked, criteria_version) · `events`(§5.4 컬럼 전부, UNIQUE(session_id,seq)) · `lyrics_versions`(lyrics_version_id PK, session_id, prev_version_id, source, text, origin_summary NULL 허용, created_at). init은 앱 기동 시 CREATE IF NOT EXISTS(기존 postgres.py 관례).
2. [B2] `app/services/creation_log.py` 신설: canonical JSON(부록 B — RFC 8785 수준은 sort_keys+separators로 시작, 명시 주석), payload_hash·event_hash·prev_hash 체인, append(session_id, type, actor, target, payload, client_ts) — 세션당 PG advisory lock으로 seq 직렬화. user_id_hash = SHA256(user_id+서버 salt), salt는 .env 신설 키.
3. [B2] `app/routes/sessions.py` 신설: POST /sessions(SESSION_START — app_version·platform·engine_list·user_id_hash·**import_blocked:false**(§1 실측 — 참고음악 업로드 존재)·criteria_version:null), POST /sessions/{id}/events(배치, event_id 중복 무시, FINALIZED 세션 409, 스키마 엄격 검증 400), POST /sessions/{id}/lyrics(전문 저장+LYRIC_EDIT 기록, origin 계산은 생략 — NULL), GET /sessions/{id}.
4. [B1] generate.py·suno_generator.py: create_generation이 body.session_id optional 수용(무세션이면 서버가 세션 자동 생성 후 doc에 session_id 저장) → 엔진 호출 직전 GEN_REQUEST(request_id=gen_id, request_body_hash — seed·callBackUrl·시각류 제외 canonical) → 폴링 완료 후 `suno_request_body`·`suno_response_raw`(최종 record-info 전문)·variant별 `audio_sha256`(MinIO put 직전 bytes로 계산)·requested_at/responded_at을 generations doc $set → GEN_RESPONSE(candidates[]: candidate_id=f"{gen_id}:v{index}", engine_clip_id=suno_audio_id, audio_sha256, duration). 실패·타임아웃도 status:failed로 GEN_RESPONSE(§3.3). 원본 오디오 재인코딩 금지 유지.
5. [B3+FINALIZE] tracks.py upload-from-generation: body에 track_type(기본 'standard')·session_id 수용 → tracks doc 저장 + FINALIZE 이벤트(candidate_id·audio_sha256·lyrics_version_id·trigger:'publish') + 세션 FINALIZED·root_hash 확정. candidate_id가 해당 세션 GEN_RESPONSE에 없으면 이벤트만 경고 기록(발매 자체는 막지 않음 — 구버전 앱 호환, 완전 검증은 후속).
6. 금지: 기존 이벤트/컬렉션 삭제·변경, 9005 접촉, prod 운영 설정(권한 분리·Object Lock)은 이번에 하지 않음.

**app-dev (2_housing, v3.200 주석 태깅)**
1. [A1] `services/creationLogService.ts` 신설: startSession(작곡 플로우 진입 — MusicGenerationScreen mount 시 1회, session_id를 musicStore에 보관), logEvent(메모리 큐+2s 디바운스 배치 전송, 실패 지수 백오프 3회, event_id=uuid·client_seq 로컬 단조), commitLyrics. 비로그인·서버 미배포 시 무해 no-op(404/401 삼킴 — 기능 게이트).
2. [A1] MusicResultScreen 계측: 재생 toggle(:144-209) → LISTEN play/pause(position_ms), variant 전환(:293-305) → LISTEN pause+play, 발매 variant 확정(:358 경로) → CANDIDATE_SELECT select(비선택 variant는 자동 reject 기록하지 않음 — §6.3 명시 기각만), handleSave 성공 시 FINALIZE는 서버 훅이 기록하므로 앱은 session_id·track_type만 payload에 추가.
3. [A2] 가사 버전 커밋 3지점: LyricsResultScreen 진입(generatedLyrics → source:'ai_draft'), '수정→완료'(:189)·MusicGenerationScreen 가사 편집 완료(:318-324) → source:'user_edit', 생성 요청 직전(musicService.generateWithSuno 호출부) 최종본 커밋 후 lyrics_version_id를 생성 body에 동봉.
4. [A3] TrackShareDownloadSheet 상단·발매 완료 showAlert 본문에 "이 곡의 음성은 AI로 합성되었습니다" 1줄, SettingsScreen 앱 정보에 "AI 생성 고지" 행(탭 → PolicySheet 재사용, consentTexts 기반).
5. [A4] §3 스펙대로 MusicResultScreen 트랙 유형 카드 + payload track_type. 문구 금지선 엄수.
6. 금지: 엔진 직접 호출 추가 금지(F1), 시스템 Alert 금지, 미커밋 병행 파일 접촉 주의.

**test-designer**
- 기록: 생성 1회 → PG events에 SESSION_START·GEN_REQUEST·GEN_RESPONSE 체인(seq 1..N, prev_hash 연결) + generations doc에 suno_request_body/suno_response_raw/audio_sha256 존재. 부록 B verify_chain 스크립트로 재해시 일치. 실패 생성(잔액 402 아닌 엔진 실패) → GEN_RESPONSE failed 기록.
- 청취·선택: 후보 A 전체·B 10초 청취 후 A 발매 → §6.4 재구성 가능(LISTEN 시퀀스+CANDIDATE_SELECT+FINALIZE candidate 일치). 재청취 구분.
- 가사: AI 초안 → 2회 수정 → 생성 → lyrics_versions 체인 3개+LYRIC_EDIT 이벤트, FINALIZE.lyrics_version_id 최종본 일치.
- 하위호환: 구버전 앱(session_id 미전송) 생성·발매 정상 + 서버 자동 세션 기록. 비로그인 흐름 무영향. no-op 게이트(서버 미배포 상태에서 앱만 배포) 시 기능 무영향.
- F6/②: 공유 시트·발매 완료 고지 문구 노출, 트랙 유형 카드 — 일반 선택 고정·저작권 등록 dim+배지+팝업 문구(금지 표현 부재 확인), 발매 track_type 저장.
- 무회귀: v3.93 A/B 비교·발매, v3.171 AI 뱃지, v3.197~199 스팟.

### 5. §16 열린 질문 — 실측 기반 답
1. **Suno 식별자**: 생성 응답 `data.taskId`(suno_generator.py:222) + record-info `data.response.sunoData[].id`(:296·:340, 이미 suno_audio_id로 저장 중) + audioUrl. → `engine_clip_id = sunoData[].id`, 작업 단위 taskId 병행 저장으로 확정. seed는 현 API 응답에 없음 — 미저장(문서 "반환하면 저장" 조건 불성립).
2. **오디오 포맷**: 현행 코드가 이미 mp3 바이트 무변환 저장(:316-330) — 그대로 확정, SHA-256만 추가. 저장 키는 기존 `generated/{gen_id}/…` 유지(이벤트에 URI 기록으로 §5.4 키 체계 갈음 — 마이그레이션 불요).
3. **가사 토큰 단위**: 어절(공백) 확정 — 편집 UI가 전문 TextInput이라 형태소 분석은 재현성만 해침. 단 이번 슬라이스는 전문 버전 저장까지, 토큰화는 후속 소급 계산.
4. **이벤트 저장소**: PG 별도 스키마 `creation_log` + (후속) 전용 INSERT/SELECT 계정. 근거: PG 이미 운용중(face_verify·admin·embeddings), Mongo는 앱 계정 full RW라 append-only 권한 분리 부적합, 현 규모(월 생성 5건)에 별도 DB는 과함.
5. **5년 보존 비용**: 실측 — 총 69건·최근 30일 5건·2-variant 12건. 월 1,000건 성장 가정에도 1,000×2×4MB=8GB/월, 5년 누적 480GB ≈ S3 표준 $11/월(콜드 ~$2). 현 규모는 사실상 0 — 보존 정책이 비용 제약을 받을 일 없음.

### 6. 기록
- PLAN.md v3.200 append 완료 (본 섹션). 코드 수정 없음 — ② UI 배치안(§3)은 사용자 확인 후 app-dev 착수.

## v3.201 (2026-09-21) — 담기 시트 입력 중 키보드 가림(A) · 재선택 팝업 자유 입력(B) · 디렉터 대화 뒤로가기 미표시 원인·견고화(C)

### 0. 전제 — 워킹트리 상태
워킹트리에 **v3.200 미커밋 변경**이 있음(`services/creationLogService.ts` 신설, `screens/DialogueScreen.tsx` +113줄 모드 토글, `stores/musicStore.ts` +15, `services/musicService.ts` +24). 본 계획의 분석은 **현 워킹트리 기준**이며, **구현은 v3.200 커밋 후 착수**한다. 특히 C가 수정하는 DialogueScreen은 v3.200 변경과 같은 파일 — 라인 번호는 커밋 후 재확인.

### 1. [A] PlaylistPickerSheet — 입력 중 TextInput 키보드 가림 (Android, 근본 원인 확정)

**레이아웃 체인** (`components/PlaylistPickerSheet.tsx`):
- :101 `Modal(transparent)` → :104 `KAV flex:1`(behavior: **iOS만 'padding'**, Android undefined) → :105 backdrop(`styles.backdrop` :142, `flex:1, justifyContent:'flex-end'`) → :108 sheet(`styles.sheet` :143 + `paddingBottom: insets.bottom + spacing.xl + kbPad`)
- **sheet는 `maxHeight: '60%'`** (:143), 내부는 스크롤 없는 `View` 목록(:113–122) 뒤에 라벨(:123)·`createRow`(입력행, :124–133)가 **맨 마지막**.
- kbPad: :27–38, Android에서 `keyboardDidShow` 시 `kbHeight - insets.bottom`, hide 시 0 (v3.198).

**근본 원인**: Android edge-to-edge에서 키보드는 창을 리사이즈하지 않고 위에 덮는다(그래서 v3.198이 수동 kbPad를 도입). 그런데 kbPad를 **paddingBottom에 합산**하면 "시트 콘텐츠 전체 높이가 kbPad만큼 커져야" 입력행이 위로 올라가는데, 시트에는 `maxHeight: '60%'` 클램프가 있다. 키보드 높이가 화면의 ~35–40%이므로 `콘텐츠 높이 + kbPad`는 거의 항상 60%를 초과 → **시트 높이가 60%에서 고정**되고, 스크롤 불가 View 구조에서 맨 아래 자식인 createRow(입력행)가 시트 하단 경계 밖으로 밀려 **키보드 뒤에 그대로 남는다**. 플레이리스트 목록이 길수록(비스크롤 View) 즉시 재현. "키보드 닫은 후 간격 잔존"은 hide→0 리셋으로 해결됐지만(v3.198 목표), "열림 중 가림"은 이 클램프 경로 때문에 미해결이 맞다.

**수정안 (근본: "입력 중 input은 항상 키보드 위")**:
1. **kbPad 적용 위치를 paddingBottom → 시트 `marginBottom`으로 이동** — 시트 *전체*를 키보드 위로 들어올린다. 콘텐츠 높이가 변하지 않으므로 maxHeight 클램프와 무관하게 입력행이 항상 키보드 위. paddingBottom은 `insets.bottom + spacing.xl` 원복(제스처 바 보강 목적 유지). hide 시 kbPad=0 → marginBottom 0이라 **v3.198의 '잔존 간격 구조적 불가' 보장 그대로 유지**. iOS는 KAV padding 경로 무변경(kbPad는 Android에서만 >0).
   - 엣지: 키보드(~40%) + 시트(≤60%) = 최대 100% — 화면 상한에 정확히 걸리는 극단만 존재. 보강으로 kbPad>0일 때 sheet maxHeight를 `winH - kbHeight - 24px` 이하로 동적 클램프(useWindowDimensions).
2. **목록 스크롤화**: 플레이리스트 목록(:113–122)을 `ScrollView`(maxHeight ~240) 전환 — 키보드와 무관하게 목록이 많으면 입력행이 밀리는 기존 잠재 결함 동시 해소.
3. **공용 훅 추출**: `hooks/useAndroidKeyboardLift.ts` 신설(현 :27–38 로직 그대로 — visible 게이트·리스너 쌍 해제 포함) — A와 B(재선택 모달 2곳)가 공용. Modal 내 KAV 재시도는 하지 않는다(v3.196→198에서 Android Modal KAV 잔존 간격으로 이미 기각된 경로 — 재퇴행 금지).

### 2. [B] 재선택 팝업 자유 입력 — 두 화면 설계

**현 구조**: LyricsInputScreen 재선택 모달 :432–452(선택지 ScrollView + 취소만), 반영 경로 `handleReselectChoice` :219–248(store 스텝 매핑 + chatHistory의 해당 user 메시지 텍스트 교체). ComposerInputScreen 이식본 :338–356 + `handleReselectChoice` :185–209(동일 패턴, 로컬 state+store). 모달 오픈 가드: 선택지 있는 스텝만(`handleReselect` — Lyrics :213–217, Composer :174–182).

**설계**:
1. **모달 내 자유 입력 행 추가**(두 화면 공통): `reselectContainer` 안, 선택지 ScrollView 아래·취소 버튼 위에 "직접 입력..." TextInput + 확인 버튼(메인 플로우 inputRow :394–427 스타일 재사용, 로컬 state `reselectInput`). 확인 시 `handleReselectChoice(reselectInput.trim())` — **기존 선택지 탭과 완전히 동일한 검증·반영 경로**(trim·빈값 disabled는 `handleCustomSubmit` :254–258과 동일 규칙, store 매핑·chatHistory 교체·모달 닫기 모두 기존 함수 재사용, 신규 분기 없음). 모달 닫을 때 `reselectInput` 리셋.
2. **노출 조건 = 메인 플로우 자유입력 허용 스텝과 동치**:
   - LyricsInput: 메인 플로우가 step 2(듀엣)·8(랩)·9(길이)에서 직접 입력을 숨김(:393) — enum 매핑 스텝(`choice==='듀엣'`, `'포함'`, durationMap)이라 자유 텍스트가 무의미. **재선택 모달도 reselectStep ∉ {2, 8, 9}일 때만 입력 행 노출**(불일치 시 boolean 오매핑 버그).
   - ComposerInput: 메인 플로우 입력행은 전 스텝 노출(제한 없음, :300대) — 재선택 대상 스텝 0·1·2 모두 입력 행 노출.
3. **키보드 회피(A와 같은 함정)**: 모달은 중앙 정렬(`reselectOverlay` justifyContent:'center') + `maxHeight:'60%'` — Android edge-to-edge Modal이라 화면 하단 절반에 걸치면 가려질 수 있음. §1-3의 `useAndroidKeyboardLift` 적용: `reselectContainer`에 `marginBottom: kbPad` (중앙 정렬이라 kbPad>0이면 컨테이너가 위로 밀림) + iOS는 모달 내부 KAV(behavior 'padding') 래핑 — v3.196 입력 모달 KAV 관행. autoFocus는 주지 않는다(모달 오픈 즉시 키보드 팝업 방지 — 선택지 탭이 1차 UX).
4. edit-2 어포던스(:349–351)·안내 문구는 변경 없음(대상 스텝 불변 — 자유입력 스텝의 말풍선은 여전히 재선택 비대상, v3.199 "거짓 어포던스 금지" 유지).

### 3. [C] 디렉터 대화 3화면 뒤로가기 — 원인 확정 + 수정 + 사용자 설명

**네비게이터 트리 확정** (App.tsx): `RootStack(:532 MainTabs)` → `Tab(:302 MainTabs)` → Studio 탭 스크린 = `StudioNavigator(:169, StudioStack, screenOptions headerShown:false :174)` → Map/Dialogue(:180 transparentModal)/LyricsInput/ComposerInput. **화면에 보이는 헤더는 StudioStack 헤더가 아니라 Tab 헤더**(:379 `titleHeader` headerShown:true). 따라서 3화면의 `navigation.getParent()` = **Tab 네비게이터가 맞고**, setOptions는 Studio 탭 라우트에 적용된다 — 타게팅 자체는 정상(MapScreen :267–296이 v3.75부터, ArtistInputScreen :196–214가 v46부터 같은 경로로 헤더를 성공적으로 덮어온 실증 있음). 즉 **v3.199 화살표의 의도된 위치 = 상단 탭 헤더 맨 왼쪽(기획사명 왼편) ← 아이콘, 3화면 포커스 중에만**.

**안 보이는/유실되는 원인 — 같은 `headerLeft` 키를 4곳이 경합 작성**:
1. **(주 원인) 화면 전환 클로버**: Dialogue→LyricsInput 전환 시 native-stack은 이전 화면을 트랜지션 종료까지 유지 — DialogueScreen blur cleanup(:104–106, `headerLeft: undefined`)이 LyricsInput의 focus 주입(:128–146) **이후에 실행될 수 있다**(React Navigation focus/blur 이펙트 순서 비보장 — 공유 리소스를 cleanup으로 지우는 패턴의 알려진 경합). 결과: 화면 진입 직후 화살표 소실. ComposerInput(:85–103)도 동일.
2. **(부 원인) MapScreen 와이프**: MapScreen setOptions payload에 `headerLeft: undefined` 키가 포함(:292)되고 deps에 `user` **객체 identity**(:296) — Dialogue는 transparentModal이라 Map이 아래에 마운트 유지되므로, user 갱신(SettingsScreen setUser 등) 시 대화 도중에도 화살표가 지워진다.
3. **(iOS 한정, 실기기 Android라 이번 보고와 무관하나 검증 필요)**: Dialogue의 `presentation:'transparentModal'`(:184)은 iOS에서 부모 헤더·탭바를 덮는 전체화면 프레젠테이션 — 탭 헤더 자체가 안 보일 수 있음. Android는 컨테이너 내 렌더라 헤더 노출.

**수정안 — "focused-screen-writes-only" 불변식**(쓰기를 전부 focus 이벤트로 일원화 → 포커스 화면은 항상 1개이므로 경합 원천 차단):
1. 3화면(Dialogue·LyricsInput·ComposerInput)의 useFocusEffect에서 **cleanup의 `headerLeft: undefined` 제거** — focus 시 set만 한다.
2. MapScreen: setOptions payload에서 `headerLeft: undefined` 키 삭제(:292) + **자체 useFocusEffect 추가로 Map 포커스 시 `headerLeft: undefined` 클리어** — 기존 cleanup의 목적(Map 복귀 후 화살표 잔존 방지, v3.199 주석의 우려)을 focus 기반으로 승계. 쓰기 지점: 3화면 focus(set) + Map focus(clear) 뿐.
3. **iOS 검증 항목**: iOS에서 Dialogue 중 탭 헤더가 안 보이면 — DialogueScreen 컨테이너 배경이 불투명(`colors.bg.deepest` :477–478)이라 transparentModal일 필요가 낮으므로 `presentation:'card'`+fade 전환을 1안으로 검토(제스처·뒤로가기 동작 확인 필수), 불가 시 iOS 한정 화면 내 back 오버레이(v3.200 modeBar가 top:12/left:16 점유 — 오버레이는 좌상단 back, modeBar를 우측 시프트해 간섭 회피).
4. ArtistInput/ArtistResult/ArtistCody의 구패턴(useLayoutEffect+unmount cleanup)은 이번 스코프 밖(3화면과 교차 전환 흐름 없음 — 경로상 항상 Map 경유) — 동일 불변식으로의 통일은 후속 백로그.

**사용자 설명문(안)**: "v3.199의 뒤로가기는 대화 화면 안이 아니라 **화면 최상단 탭 헤더의 맨 왼쪽**(기획사 이름 바로 왼편)에 ← 화살표로 들어가도록 만든 것이었어요. 다만 여러 화면이 같은 헤더 자리를 번갈아 쓰는 구조여서, 화면을 오가는 타이밍에 따라 화살표가 지워져 실기기에서 안 보일 수 있는 결함을 확인했습니다. v3.201에서 '지금 보고 있는 화면만 헤더를 쓴다' 방식으로 바꿔 3화면(디렉터 대화·작사·작곡) 모두에서 항상 보이게 고칩니다."

### 4. app-dev 작업 지시 (v3.200 커밋 후 착수)
0. **선행**: v3.200 커밋 완료 확인 후 시작. **v3.200 접촉 라인 주의 목록**: `screens/DialogueScreen.tsx` — 모드 토글 useFocusEffect 인근(:72–108)·modeBar JSX(:437–470)·modeBar 스타일(:484–530대)은 v3.200 산출물, C-1 수정은 :90–108의 cleanup 3줄만 접촉(라인 번호는 커밋 후 재확인). `stores/musicStore.ts`·`services/musicService.ts`·`services/creationLogService.ts`는 이번 버전 비접촉.
1. [공통] `hooks/useAndroidKeyboardLift.ts` 신설 — PlaylistPickerSheet :27–38 로직 이동(visible 게이트, show: `max(0, kbHeight - insets.bottom)`, hide: 0, 리스너 쌍 해제).
2. [A] `components/PlaylistPickerSheet.tsx`: kbPad를 :108 paddingBottom에서 빼고 sheet `marginBottom`으로 이동, kbPad>0 시 maxHeight 동적 클램프(§1-1), 목록 ScrollView 전환(§1-2), 훅 사용으로 교체. iOS 경로(KAV padding) 무변경.
3. [B] `screens/LyricsInputScreen.tsx` 재선택 모달(:432–452): 자유 입력 행 추가(reselectStep ∉ {2,8,9} 조건), 제출=`handleReselectChoice(trim)` 재사용, 모달에 iOS KAV + Android kbPad(marginBottom) 적용, 닫기 시 입력 리셋.
4. [B] `screens/ComposerInputScreen.tsx` 재선택 모달(:338–356): 동일 이식(전 재선택 스텝 0·1·2 입력 행 노출).
5. [C] 3화면 cleanup의 `headerLeft: undefined` 제거 + `screens/MapScreen.tsx` :292 키 삭제·focus 클리어 추가(§3 수정안 1·2). iOS 시뮬레이터에서 Dialogue 헤더 노출 검증 후 §3-3 필요 시 적용(적용 시 커밋 메시지에 명기).
6. 금지: 시스템 Alert 금지, Modal 내 Android KAV padding 재도입 금지(v3.198 퇴행), v3.200 미커밋… → 커밋 선행이므로 해당 없음(단 v3.200 주석·로직 삭제 금지).

### 5. test-designer 항목 (v3.191~200 무회귀 포함)
- [A] Android 실기기/에뮬: 담기 시트에서 새 플레이리스트 입력 탭 → **입력행이 키보드 위에 완전 노출**(플레이리스트 0개·10개 두 케이스), 키보드 닫기 → 간격 잔존 없음(v3.198 무회귀), 홈버튼/백 제스처로 키보드 해제·시트 재오픈 반복 시 패딩 누적 없음. iOS: 기존 KAV 동작 무회귀. 목록 10개 시 스크롤로 전 항목 접근 + 입력행 상시 노출.
- [B] 두 화면: 답변 말풍선 탭 → 모달에 선택지+직접 입력 노출(LyricsInput 듀엣·랩·길이 스텝은 입력 행 없음 확인), 자유 텍스트 제출 → 말풍선 텍스트 교체·최종 프롬프트에 반영(LyricsPromptReview/작곡 요약에서 확인), 빈값 제출 불가, 취소 시 미반영·입력 리셋, 모달 입력 중 키보드가 입력창을 가리지 않음(Android).
- [C] Android: Map→디렉터 대화→작사→(작곡 플로우도) 각 진입 직후·체류 중 헤더 ← 상시 노출, ← 탭 동작(Dialogue→Map, LyricsInput→Dialogue), Map 복귀 시 화살표 소멸(잔존 무), 대화 중 설정에서 프로필 변경 후 복귀해도 화살표 유지(§3 원인 2 회귀 확인), Studio 탭 재진입(tabPress 리셋) 후 화살표 무. iOS: Dialogue 중 탭 헤더 노출 여부 보고. ArtistInput ‹ 무회귀.
- 무회귀 스팟: v3.196 시트 4곳 인셋, v3.198 미니플레이어 sessionActive, v3.199 아바타/마퀴/edit-2, v3.200 모드 토글·저작권 안내 1회 노출.

### 6. 기록
- PLAN.md v3.201 append 완료. 코드 수정 없음(계획 전용). 구현은 v3.200 커밋 후 app-dev가 착수.

## v3.202 — 수정일 2026-09-21 (실기기 10건: 배경재생·입력가림·모드가이드·헤더폭·디렉터 대화·이미지 디렉터·연주곡)

> 작성: 오케스트레이터 (planner A/I/E/F/G 분석 + H/J·B/C/D 심층 조사 2건 통합 — planner 최종 검토는 구현 후 수행)

### 원인 확정 (전 항목 실측 근거)
- **A 배경 자동재생**: 원격 [BTDebug] 로그 실측 — didJustFinish는 배경에서도 발화(JS 생존). 실패 원인 = Android Doze의 네트워크 차단(UnknownHostException). 프리로드 히트 시 전환 성공. 결함 2: maybePreloadNext 실패 시 초당 ~8회 재시도 폭주(백오프 없음), 프리로드 창(20s/85%)이 Doze 진입보다 늦음. **근본(포그라운드 서비스/track-player 이관)은 별도 과제.**
- **B 입력 반 가림**: 재선택 모달 overlay가 justifyContent:center → marginBottom 리프트가 kbPad/2만 유효(Yoga 산식 확정). 담기 시트(flex-end)는 정상. ReportModal/AppealModal/AlbumCreateModal은 Android 회피 전무(동종). edge-to-edge에서 adjustResize 무력 — 수동 리프트가 유일 방어선.
- **C 모드 로깅**: creationLogService에 creationMode 참조 0건 — **양 모드 공통 기록 확인**(분기는 발매 track_type 2곳뿐). 가이드 안내는 1회 showAlert뿐 + 재열람 불가(동일 모드 재탭 no-op 가드).
- **D 헤더 폭**: nameMaxWidth 산식이 화살표(38px) 미반영, HomeHeaderActions 실측 208~229px에 기존 여유 −1~+20px → 화살표 6px 순증으로 임계 초과, end 컨테이너가 flexShrink:0이라 타이틀 위로 넘침.
- **E/F/G/J 작곡**: **라이브 작곡 대화 = MusicGenerationScreen** (ComposerInputScreen은 v3.131부터 도달 불가 죽은 화면 — v3.199 재선택 이식이 죽은 코드에 감). F=performRewind의 prev.slice 파괴적 절단(설계였음). G=아티스트 게이트 list.length>0(:418). E=재선택 후 디렉터 응답(구값 에코)이 잔존. J=가사 게이트(ComposeLyricsPick 빈 상태 '돌아가기'만)+ComposerSelect 하드 블록, vocal='' → 'instrumental' 경로도 2중 단절(MusicLoadingScreen:210 `store.vocal || undefined`, VOCAL_OPTIONS에 선택지 부재)로 발동 불가.
- **H 커버 디렉터**: ① 가사반영 질문(step 1.75)은 존재하나 stale closure(handleTrackSelect가 이전 렌더 클로저 호출)로 아티스트 없는 사용자에게 스킵 ② doRegenerate가 대화 전체 와이프+step 2 강등(실패·429 공통) ③ performRewind 파괴적 절단+질문 중복+result 모드에서 탭 불가 ④ coverExtras 모듈 상태가 화면과 따로 놀아 안 보이는 답이 요청에 실림 ⑤ 실패 시 finally가 coverTrackId 등을 지워 재개 불가.
- **I 이미지 느림/오류**: gpt_image_2 2048² 서버 150~180s 동기 처리. 실패 3건 실측 = 클라이언트 ERR_NETWORK(11/44/153s 연결 단절) 후 **서버는 완성**(별 5 차감+이미지 고아). 복구: GET /api/upload/cover-sessions 목록에 완성본 존재 — **백엔드 무변경으로 앱 폴링 회수 가능**. 비동기 잡 전환은 별도 과제.

### 슬라이스 — v3.202(이번, 앱 전용·백엔드 무변경)
1. **A-lite** services/playback.ts: 프리로드 트리거 조기화(현재 곡 로드 성공 직후+60s 전 이중 트리거, 기존 20s/85% 유지), 실패 재시도 백오프(곡당 최대 3회, 10s 간격 — 폭주 제거), [BTDebug] 유지.
2. **B** LyricsInputScreen 재선택 모달: overlay flex-end 전환+동적 maxHeight(담기 시트 검증 패턴 — B안1). ReportModal/AppealModal/AlbumCreateModal: useAndroidKeyboardLift + translateY(-kbPad) (center 유지 — B안2, 클램프 병행).
3. **C** consentTexts에 COPYRIGHT_RECORD_GUIDE 상수(문구 금지선: '등록 가능/보장/인정/특허' 금지, 사실 서술) + DialogueScreen recChip을 TouchableOpacity화(+info 아이콘) → PolicySheet로 가이드 표시. 모드 alert에 '자세히 보기' 버튼 추가. 세그먼트 라벨은 유지(변경은 사용자 결정 사항으로 REPORT에 기록).
4. **D** MapScreen: nameMaxWidth = max(90, winW-(user?300:90)) (D안1) + setOptions에 headerRightContainerStyle {flexShrink:0}·headerTitleContainerStyle {flexShrink:1} (D안4 안전망).
5. **E/F** MusicGenerationScreen: performRewind를 파괴적 절단 → **비파괴 값 치환**(해당 user 버블 map 교체 + 직후 디렉터 에코 버블도 새 값으로 치환, 이후 대화·상태 보존). 치환 대상 스텝의 store/로컬 값 갱신은 기존 rewind의 개별 필드 초기화 로직을 "새 값 세팅"으로 전환.
6. **G** MusicGenerationScreen 아티스트 스텝(:418 게이트): 아티스트 0명이어도 '아티스트로 만들기' 선택지 항상 노출 → 선택 시 showAlert('아티스트가 아직 없어요', '아티스트 디렉터에게 먼저 만들어달라고 할까요?') [취소/이동] → 이동 시 navigation으로 아티스트 디렉터(Dialogue artist) 연결(현재 대화 상태는 보존).
7. **H** CoverGenerationScreen+musicStore: H fix 1~5 전면 — ① stale closure 수정(track 인자 전달) ② step-2 자유입력에 '가사 내용 기반으로 생성' 동등 버튼 추가 ③ doRegenerate 와이프 제거(기존 대화에 디렉터 메시지 append+직전 스텝 복귀, resetCoverExtras는 명시적 처음부터에만) ④ performRewind 비파괴 치환(E/F와 동일 패턴, result 모드에서도 탭 허용) ⑤ 대화 상태 zustand 영속(coverMessages/coverStep/coverExtras/coverLyrics*) + 실패 finally의 coverTrackId 클리어 제거(성공 시만).
8. **I-lite** CoverGenerationScreen: ERR_NETWORK/타임아웃 catch에서 즉시 실패 확정하지 않고 cover-sessions 폴링(15s 간격×최대 12회) → 완성본 발견 시 성공 처리(재차감 없음) + 대기 UI 문구. 미발견 시 기존 오류.
9. **J** 연주곡: ComposeLyricsPickScreen에 '가사 없이 만들기(연주곡)' 카드(목록 위+빈 상태) → setLyrics('')+setInstrumental(true)+replace('ComposerSelect'). ComposerSelectScreen 가사 게이트에 instrumental 예외. MusicGenerationScreen: instrumental 시 가사확인·보컬 스텝 스킵 + VOCAL_OPTIONS에 'Instrumental (연주곡)' 추가(가사 있어도 무보컬 선택 가능). MusicLoadingScreen:210 vocal 배선 수정 + musicService: params.instrumental 명시 처리+연주곡 프롬프트 문장(작곡.md:67). musicStore에 instrumental 필드(리셋 경로 포함). **ComposerInputScreen 삭제**(App.tsx 등록 3곳 제거 — v3.199 이식분 포함 폐기, REPORT에 정정 기록).
### 후속(별도 과제): 포그라운드 서비스/track-player 이관(A 근본), 이미지 비동기 잡+고아 자동 복구 배치(I 근본), 댓글 패널 Android 회피, '저작권 등록 모드' 라벨 재검토(사용자 결정)

## v3.203 (2026-09-22) — 연주곡 파이프라인 완성: 백엔드 미시작 버그(원인 A·B) 수정 + 작곡 디렉터 연주곡 질문 5개 한정 + 곡 길이 선택 신설

> 작성: planner(팀 리드). 사용자 요청: "연주곡인 경우에는 장르, 분위기, 곡 길이(최대 몇분까지 가능한지 설정필요), 참고할만한 곡, bpm만 선택하게 하고 나머지는 작곡 디렉터가 물어보면 안될것 같아. 위의 내용(백엔드 연주곡 미시작 버그) 수정하면서 같이 진행해줘." — 백엔드 수정+prod 배포 사용자 승인 완료.
> 소스오브트루스: 프로덕션 서버 `ssh maidol-ec2`, `/home/ubuntu/maidol/backend_9004/` (git 아님). 로컬 워크트리 `/Users/pearl/TripleJ-backend`는 v3.190에서 정지 — **읽기 참고 포함 사용 금지**.

### Plan verification findings (파일:라인 + 현재 동작 — 전 항목 서버/앱 실측)

**백엔드 (maidol-ec2 `/home/ubuntu/maidol/backend_9004/`)**
- **원인 A** `app/routes/generate.py:636` — `will_start_music = bool(body.start_music_gen and body.lyrics)`. 연주곡은 앱이 `lyrics:''` 전송 → False → Suno 백그라운드 미시작·무과금 draft로만 저장(gen `6ab1a85a7bb9bac64cfd15c6` "Fall in my heart" pending/0% 방치 실사고, point_cost null·별 무차감 → **무해 draft로 존치, 회수/삭제 안 함**).
- **원인 B** `app/services/suno_generator.py:134` — `use_custom = bool(lyrics and lyrics.strip())`. A만 풀면 연주곡이 `customMode:false`로 나가고, Suno API는 customMode=false에서 style·title을 무시(prompt만 사용) → 장르/무드/BPM style 문자열이 통째로 버려짐. `is_instrumental`은 :131에 이미 존재(`vocal=='instrumental'`).
- **body 구성부** `suno_generator.py:164~180` — `title`은 `if title and use_custom`(:176)만, **duration 파라미터 전송 없음**. `style_str`은 :128에서 폴백 "pop" 보장(빈 값 불가). `vocal_info`는 SUNO_VOCAL_MAP 조회라 'instrumental'이면 None → vocalGender 미전송(정상).
- **duration 사슬 단절**: `generate.py:756` `_run_music_generation(duration=body.duration or 30 ...)`까지는 오지만, `generate.py:311` 래퍼가 `generate_music_suno` 호출 시 **duration을 버림**. `suno_generator.py:62` 시그니처에 duration 파라미터 자체가 없음. mongo doc에는 저장됨(`generate.py` doc `"duration": body.duration or 30`).
- **Suno V6 곡 길이 상한 (WebFetch 조사 확정, docs.sunoapi.org/suno-api/generate-music, 2026-09-22 조회)**: `duration` 파라미터 존재 — "Audio duration in seconds. Optional. Only available when customMode is true. Range: 10–360 seconds. Default: 20." / "Only valid when the model is V5_5 (Discontinued), V6, V6_MINI, or V6_WILD." → **V6 최대 360초=6분. 곡 길이 옵션 1~6분 확정.** customMode+instrumental 요건은 "At least one of style, lyrics, or negativeTags must be provided"(style 폴백으로 항상 충족), title은 "optional, maximum 80 characters"(오케스트레이터 진단의 'title 필수'는 문서 원문과 상이 — 옵션이지만 폴백 title을 항상 실어 무해하게 방어).
- **회귀 지뢰(핵심)**: 앱은 **모든 곡**에 `duration:120` 고정 전송(`musicService.ts:290`). 백엔드가 duration을 무조건 Suno에 실으면 **일반 보컬곡이 전부 2분으로 잘린다** → Suno 전달은 `is_instrumental`일 때만.
- 배포 대상 컨테이너: `maidol-app`(--network host, health `127.0.0.1:9006/api/health` 200 확인). `POST /generate/{gen_id}/start/`(:779)의 재시작 경로는 doc의 lyrics/vocal을 그대로 쓰므로 게이트 무관(추가 수정 불요).

**앱 (frontend 브랜치 `/Users/pearl/TripleJ/2_housing/`)**
- **연주곡(카드 진입, `instrumentalEntryRef`) 현재 스텝 체인** — `MusicGenerationScreen.tsx`:
  `0 제목확인(:380 handleTitleConfirm→:387 commitExchange 300, repickRef=true)` → `300 장르(:501 handleGenrePick→repick이라 301)` → `301 분위기(:523 handleMoodPick→proceedToArtistStep 200)` → **`200 아티스트(:550 handleArtistPick — instrumental 분기 :556/:567 → 5)`** → `5 참고음원(:1376 확인/건너뛰기→6, :873 handlePickReference→6)` → **`6 제외 스타일(:793→7)`** → **`7 자유도(:797→8)`** → **`8 대중/실험(:801→9)`** → **`9 참고음 세기(:814→10)`** → `10 BPM(:818 handleBpmConfirm→11)` → **`11 키(:837 handleKeyConfirm→instrumental이면 13)`** → 완료 13(내 목소리 12는 v3.202에서 이미 스킵). 굵은 스텝 = 사용자가 금지한 잉여 질문 6개(아티스트·제외·자유도·실험·참고음세기·키).
- **가사 기반 연주곡(보컬 스텝 Instrumental 선택)**: `:707 handleVocalSelect(INSTRUMENTAL_OPTION)` → step 5 직행 → 이후 6~11 잉여 질문 동일 노출.
- 대화 커밋 구조: 전 핸들러가 `commitExchange`(:294 — 되감기 시 비파괴 치환, `echoOfStep` 메타 매치) / `advanceStep`(:322) 경유. 재선택은 `handleUserBubbleTap`(:369)→`performRewind`(:358). 새 스텝은 `questionForStep`(:335) + `renderInputArea` switch(:1019)에 case 추가만 하면 기존 되감기 UX 자동 편승.
- 죽은 코드: `handleStartRecording/handleStopRecording/handleSkipReference`(:881/:906/:930)는 렌더 미참조(참고 스텝 출구는 :873·:1376 두 곳뿐) — 이번 분기 수정 대상 아님.
- 잔존 제목 버그: `ComposeLyricsPickScreen.tsx:228 handleInstrumental`이 musicStore만 비우고 `lyricsStore.generatedTitle/generatedLyrics`는 안 비움 → 연주곡 진입 시 직전 작사 세션 제목이 `editedTitle` 초기값(:99)으로 잔존.
- duration 배선: `musicStore.ts`에 durationSec 필드 없음. `MusicLoadingScreen.tsx:210~214`가 instrumental 플래그를 musicService로 전달, `musicService.ts:263~301` body에 `duration:120` 고정.

### 확정 스펙 (자율 판단 근거 포함)
1. **연주곡 질문 = 정확히 5개**: ① 장르(300) ② 분위기(301) ③ **곡 길이(신규 step 310)** ④ 참고할만한 곡(5 — 기존 업로드 플로우 재사용) ⑤ BPM(10) → 완료(13). 아티스트(200)·보컬(3/220/4)·내 목소리(210/12)·제외(6)·자유도(7)·대중/실험(8)·참고음 세기(9)·키(11) 전부 연주곡 분기에서 제거.
2. **제목 확인(step 0)은 유지**: 사용자 열거는 "창작 질문 5개 한정" 취지로 해석. 제목은 곡 식별 데이터이고 MusicResult/발매 화면에 제목 편집 UI가 없어(실측) 여기서 못 정하면 무명 트랙이 됨. 단, 카드 진입 시 잔존 제목 클리어(위 버그 수정)로 빈 입력에서 시작.
3. **곡 길이 옵션**: `1분/2분/3분/4분/5분/6분` + `자동`(길이 지정 안 함). 최대 6분 근거 = Suno V6 duration 10~360초(위 문서 실측). 선택값은 `durationSec = 분×60`으로 store→body `duration` 필드에 실리고, 백엔드가 V6 계열+연주곡일 때만 Suno body `duration`으로 전달(스타일 힌트 불필요 — 직접 제어 가능 확인됨). '자동' 선택 시 durationSec null → body는 기존 120 유지(문서 Default 20은 파라미터 미포함 시 미적용 — 현행 일반곡이 2~3분으로 나오는 실태와 일치, 미포함=자동 판단).
4. **가사 기반 연주곡**(보컬 스텝 Instrumental 선택)도 선택 직후 `310 곡 길이 → 5 참고 → 10 BPM → 13` 체인 적용(장르/분위기/아티스트는 이미 답변된 뒤라 재질문 없음 — 5개 한도 내).
5. **일반(가사) 흐름 회귀 0**: 비연주곡 체인·질문·순서·body 불변. duration은 일반곡에서 계속 120 고정 전송되지만 백엔드가 Suno에 안 실으므로 동작 변화 없음.
6. 실사고 gen `6ab1a85a7bb9bac64cfd15c6`: 무과금 draft 존치(삭제·재시작 안 함).

### 변경 매트릭스
| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| (서버) app/routes/generate.py | :636 게이트 instrumental 예외 + 시작 로그 + :311 래퍼 duration 전달 | backend-dev | `[generate] gen_id=... instrumental start` |
| (서버) app/services/suno_generator.py | :62 시그니처 duration 추가, :134 use_custom instrumental 예외, :135 prompt_text 빈가사 폴백, title 폴백, V6+연주곡 한정 body duration(10~360 클램프) + 로그 | backend-dev | `[suno] generation_id=... customMode=... instrumental=... duration=...` |
| stores/musicStore.ts | durationSec: number\|null + setter + initialState/reset | app-dev | — |
| screens/MusicGenerationScreen.tsx | step 310 신설(질문/렌더/questionForStep), 연주곡 분기 재배선(301→310, 3→310, 310→5, 5→10, 10→13), 잉여 스텝 차단 | app-dev | `[MusicGeneration] 연주곡 ...` console.info |
| screens/ComposeLyricsPickScreen.tsx | handleInstrumental에 lyricsStore 제목/가사 클리어 | app-dev | `[ComposeLyricsPick] 연주곡(가사 없이) 선택` |
| screens/MusicLoadingScreen.tsx | params.durationSec 배선 | app-dev | 기존 `[MusicLoading]` 파라미터 로그에 duration 추가 |
| services/musicService.ts (+types MusicParams) | body duration = instrumental&&durationSec ? durationSec : 120 | app-dev | `[Suno] API 호출:` 로그에 duration 추가 |

### app-dev 작업 할당
`/Users/pearl/TripleJ/2_housing/` (frontend 브랜치, 커밋 후 자동 push). 문자열 MAIDOL 규칙·이모지 금지·showAlert 규칙 준수.
1. **musicStore.ts**: `durationSec: number | null`(initialState null) + `setDurationSec` 추가. reset은 initialState 스프레드라 자동 포함.
2. **MusicGenerationScreen.tsx — step 310(곡 길이) 신설**:
   - `const DURATION_OPTIONS = [1,2,3,4,5,6]`(분) — Suno V6 상한 360초 근거 주석. 질문 문구: `'곡 길이는 어느 정도로 할까요? 최대 6분까지 만들 수 있어요. (자동 = 길이를 맡겨요)'` — `questionForStep` case 310 + 렌더 case 310(분 버튼 6개 + '자동' 버튼, 기존 skipBtn/applyBtn 스타일 재사용).
   - `handleDurationPick(min: number | null)`: `musicStore.setDurationSec(min ? min*60 : null)` 후 `commitExchange({user: min ? \`곡 길이: ${min}분\` : '자동', step: 310}, [{director: DIRECTOR_MESSAGES[5]}], 5)`. commitExchange 경유라 되감기 비파괴 치환 자동 지원.
3. **연주곡 체인 재배선** (전부 `musicStore.instrumental` 기준, 일반 흐름 무변경):
   - `handleMoodPick`(:523): instrumental이면 `proceedToArtistStep` 대신 `commitExchange({user: \`분위기: ${mood}\`, step: 301}, [310 질문], 310)` — 아티스트 질문 제거. (되감기 중이면 rewindRef 규약대로 commitExchange가 치환 처리.)
   - `handleGenrePick`(:501) mood 보유 && !repick 경로: instrumental이면 동일하게 310으로(방어 — 카드 진입은 항상 repick이지만 되감기 조합 대비).
   - `handleVocalSelect` INSTRUMENTAL_OPTION 분기(:708): nextStep 5 → **310** ('좋아요! 보컬 없이 연주곡으로 만들게요.' + 310 질문 2버블).
   - 참고 스텝 출구 2곳(:873 `handlePickReference`, :1376 확인/건너뛰기): `advanceStep(..., musicStore.instrumental ? 10 : 6)` — 제외/자유도/실험/참고음세기 4스텝 제거.
   - `handleBpmConfirm`(:818): `advanceStep(..., musicStore.instrumental ? 13 : 11)` — 키(11)·내 목소리(12) 제거. (:840 handleKeyConfirm의 기존 instrumental 분기는 일반 흐름 전용으로 잔존 — 무해.)
   - `handleArtistPick`의 v3.202 instrumental 분기(:551~581)는 새 체인에서 도달 불가 — 삭제하지 말고 "방어 잔존(도달 경로 없음)" 주석만 갱신.
   - 각 분기 `console.info('[MusicGeneration] 연주곡 ...')` 로그 유지/추가.
4. **ComposeLyricsPickScreen.tsx** `handleInstrumental`(:228): `lyricsStore.setGeneratedTitle(''); lyricsStore.setGeneratedLyrics('');` 추가 — 직전 작사 세션 제목 잔존 차단(제목 입력은 빈 값에서 시작).
5. **배선**: `MusicLoadingScreen.tsx` params에 `durationSec: store.durationSec || undefined` 추가(:210 인근). `types` MusicParams에 `durationSec?: number`. `musicService.ts:290`: `duration: params.instrumental && params.durationSec ? params.durationSec : 120` + :302 로그에 duration 포함.
6. `proceedGenerate`(:941): 일반곡이면 `musicStore.setDurationSec(null)` 명시(연주곡→일반 되감기 전환 시 끈적 방지). `handleVocalSelect` 성별 재선택 분기(:727)의 instrumental 해제에도 `setDurationSec(null)` 동반.

### backend-dev 작업 할당
서버 `ssh maidol-ec2`, 소스 `/home/ubuntu/maidol/backend_9004/` (직접 수정 — git 아님). 로컬 워크트리 금지. **사용자 배포 승인 완료.**
1. **generate.py**
   - :636 → `will_start_music = bool(body.start_music_gen and (body.lyrics or (body.vocal or "").strip().lower() == "instrumental"))`
   - will_start_music 확정 직후(과금 로그 인근): 연주곡이면 `logger.info("[generate] instrumental start user=%s (lyrics empty, vocal=instrumental)", current_user["id"][:8])`, doc 생성 후 gen_id 로그가 기존에 없으면 background_tasks 등록 직전 `logger.info("[generate] gen_id=%s instrumental start", gen_id)`.
   - :311 `_run_music_generation` 래퍼: `generate_music_suno(..., duration=duration, ...)` 전달(현재 duration을 받고 버림).
2. **suno_generator.py**
   - :62 시그니처에 `duration: int = None` 추가.
   - :134 → `use_custom = bool(lyrics and lyrics.strip()) or is_instrumental`
   - :135 → `prompt_text = _ensure_lyrics_structure(lyrics.strip()) if (lyrics and lyrics.strip()) else (title or "A beautiful song")` (빈 가사로 _ensure_lyrics_structure 진입 금지).
   - :176 title 블록: `if use_custom and (title or is_instrumental): body["title"] = (title or "Instrumental")[:80]` — customMode에서 title 항상 확보(문서상 옵션이지만 무해 방어).
   - body 구성 후(resolved_model 확정 뒤): `if is_instrumental and duration and resolved_model.upper().startswith("V6"): body["duration"] = max(10, min(360, int(duration)))` — **연주곡 한정**(일반곡에 실으면 앱 고정 duration:120 때문에 전곡 2분 클램프 — 절대 금지). customMode는 위 수정으로 연주곡=항상 true.
   - 기존 resolved_model 로그(:157 인근) 뒤 `logger.info("[suno] generation_id=%s customMode=%s instrumental=%s duration=%s", generation_id, use_custom, is_instrumental, body.get("duration"))`.
3. **검증(배포 전)**: `python3 -c "import ast; ast.parse(open('app/routes/generate.py').read()); ast.parse(open('app/services/suno_generator.py').read())"`.
4. **배포 절차(승인 완료)**: 서버에서
   - `cp app/routes/generate.py app/routes/generate.py.bak_pre_v3203 && cp app/services/suno_generator.py app/services/suno_generator.py.bak_pre_v3203`
   - 수정 반영 → `sudo docker build -t maidol-app:latest .`
   - `sudo docker stop maidol-app && sudo docker rm maidol-app`
   - `sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env -e S3_REGION=ap-northeast-2 maidol-app:latest`
   - `curl 127.0.0.1:9006/api/health` 200 확인 + `sudo docker logs maidol-app --tail 50` 기동 로그 확인.
5. 실사고 gen `6ab1a85a7bb9bac64cfd15c6`: 무과금 draft — 조치 없음(기록만).

### test-designer 테스트 항목
1. **연주곡 카드 진입 체인(E2E)**: 가사 없이 만들기 → 제목 확인 → 장르 → 분위기 → **곡 길이** → 참고곡 → BPM → 완료. 아티스트/보컬/내 목소리/제외 스타일/자유도/대중·실험/참고음 세기/키 질문이 **한 번도 노출되지 않음**. 진행 중 [MusicGeneration] 연주곡 로그 확인.
2. **곡 길이 반영**: 3분 선택 → store.durationSec=180 → `[Suno] API 호출` 로그 duration=180 → 서버 `[suno] ... duration=180` → 결과물 재생 길이 약 3분(±허용 오차). '자동' 선택 → body duration=120, Suno body에 duration 필드 없음(서버 로그 duration=None).
3. **가사 기반 연주곡(step 3 Instrumental)**: 일반 흐름에서 Instrumental (연주곡) 선택 → 곡 길이→참고→BPM→완료 체인, 가사는 유지된 채 vocal='instrumental' 전송.
4. **되감기 회귀**: 곡 길이 버블 탭 재선택(비파괴 치환·이후 대화 보존), 분위기 버블 재선택 후 체인 복귀, Instrumental→성별 재선택 시 연주곡 해제+durationSec null+일반 체인 복원.
5. **일반(가사) 흐름 회귀 0**: 전 스텝(0→1→302/300→200→3→220→4→5→6→7→8→9→10→11→12→13) 순서·질문 불변, body duration=120, **Suno body에 duration 미포함**, customMode=기존과 동일(가사 있으면 true).
6. **백엔드 unit(게이트)**: `will_start_music` — (lyrics='' , vocal='instrumental', start=true)→True·과금 / (lyrics='', vocal='', start=true)→False·무과금 draft / (lyrics有)→기존 동일. `use_custom` — instrumental→True(가사 없어도) / 가사무·비연주곡→False. prompt_text 빈 가사 시 _ensure_lyrics_structure 미호출. duration 클램프(9→10, 400→360), 비V6 모델 미전달, is_instrumental=False면 미전달.
7. **Suno 실호출 스모크 1회**(테스트 계정, compose 비용 15⭐ 과금 허용): 연주곡·Jazz·로맨틱·3분·BPM 90 → generations doc status pending→processing→completed, 결과 오디오 보컬 없음·style 반영 확인, 서버 로그 `[generate] instrumental start`·`[suno] customMode=True instrumental=True duration=180` 확인. 실패 시 환불 로그(`[star-econ] compose refund`) 확인.
8. **인접 회귀**: v3.202 커버 실패 자동회수(cover-sessions 폴링), 창작 기록(GEN_REQUEST/GEN_RESPONSE — 연주곡도 세션 기록됨), 참고 음악 업로드(일반곡), 피로 429 게이트, 발매 시 아티스트명 폴백(연주곡은 artistCharacterId null → 기획사명).
9. **배포 스모크**: health 200, 기존 API(로그인/목록/스트림) 정상, docker logs에 기동 오류 없음.

### 후속(별도 과제)
- 연주곡 결과 화면·발매 흐름의 "가사" 표기 정리(빈 가사 섹션 숨김) — 이번 범위 밖.
- MusicResult/발매 제목 편집 UI(제목 확인 스텝 축소의 전제) — 사용자 결정 사항.
- MusicGenerationScreen의 죽은 녹음 핸들러 3종(:881/:906/:930 — 렌더 미참조) 정리 — 별도 청소 사이클.


---

## v3.204 (2026-09-22) — 디렉터 대화 편집 UX 통일(작사 방식) + 커버 질문 순서·중복 버튼 정리 + 미세조정 오류 복구 + 후보 재생바 시크 + 튜토리얼 오버레이 신설

> 작성: planner(팀 리드). 사용자 요청 6항목: ① 작곡 후보 2곡 재생바 시크 ② 이미지 디렉터 마지막 질문의 '가사 기반' 버튼 제거 ③ 세부 질문 순서 배경→구도 ④ 답변 편집을 작사 디렉터의 재선택 팝업 방식으로 통일(할지말지 확인 팝업 금지) ⑤ 이미지 미세조정 반복 오류 수정 ⑥ 최초 접속 시 페이지별 튜토리얼 오버레이.
> 소스오브트루스: 앱 `/Users/pearl/TripleJ/2_housing/`(frontend, 직전 0b4d59d v3.203), 백엔드 프로덕션 `ssh maidol-ec2` `/home/ubuntu/maidol/backend_9004/`(git 아님, **이번 사이클 서버 읽기 전용 — 서버 쓰기는 권한 차단 상태**, 로컬 백엔드 워크트리 사용 금지).
> v3.203 이월분(서버 2차 배포 사용자 대기·E-3 Suno 스모크)은 이번 계획과 별개 — 건드리지 않는다(참고만).

### Plan verification findings (파일:라인 + 현재 동작 — 전 항목 실측)

**① 후보 2곡 재생바 (MusicResultScreen.tsx, 1097줄)**
- 비교 카드 진행바 :618~631, 단일 플레이어 진행바 :655~672 — 둘 다 `View` 폭 % 채우기(비인터랙티브). 시크 UI 없음.
- 재생: expo-av `Audio.Sound.createAsync`(:196~214, 상태 콜백이 :205에서 position 갱신). `generationStreamUrl(generationId, variant)` 프록시 스트림(:182).
- `@react-native-community/slider` **5.0.1 이미 설치**(package.json:15). 검증된 시크 관행 = PlayerScreen.tsx(:24 import, :1060 Slider, :866 `handleSeek`→`setPositionAsync`, :880 `handleSlidingStart`+`isSeekingRef`로 콜백 튐 방지, :188 `seekValue` 드래그 버퍼). **PanResponder 자체 구현 불필요 — 기존 라이브러리·기존 관행 재사용 확정.**
- LISTEN 계측: `logListen`(:142~153)의 주석 :145~146이 "시킹 UI 도입 시 from_ms/to_ms와 함께 seek 기록(문서 §6.2)"을 이미 예약. **서버 실측**: sessions.py:34 `LISTEN_ACTIONS = {"play","pause","seek","ended"}` — seek 허용, :129~130 `from_ms`/`to_ms` 음이 아닌 정수 필수. 이벤트 폭주 방지 = `onSlidingComplete`에서만 1회 기록(드래그 중 미기록).
- 스트림 Range: generate.py:1224 `stream_generation`은 StreamingResponse 전체 전송(Range/206 미지원). 단 PlayerScreen 주석(:539) 실측대로 네이티브는 버퍼링 기반 seek 정상 — 후보 클립은 5~6MB라 초기에 전부 버퍼링됨. 백엔드 무변경.
- duration Infinity 가드 :368~369 존재 — Slider `maximumValue`는 유한값 필수 → duration 비유한/0이면 슬라이더 disabled 처리 필요.

**② 이미지 디렉터 '가사 기반' 버튼 중복 (CoverGenerationScreen.tsx, 1795줄)**
- step 1.75(초반, :604~614 `proceedToLyricsQ`)에서 "가사 내용을 반영해서 만들까요?"를 **트랙 모드에서 항상** 질문(트랙은 step 0에서 반드시 선택되므로 스킵 경로 없음 — :605 albumMode/무트랙만 예외).
- 그런데 마지막 스텝 2(자유 서술) 렌더 :1662~1668에 v3.202(H-②)가 넣은 '가사 내용 기반으로 생성' 버튼이 또 노출 — 넣을 때 근거였던 "1.75를 놓친 사용자"는 실측상 존재하지 않는 경로(1.75는 트랙 모드에서 항상 출력). 1.75에서 이미 '반영'을 답했든 '직접'을 답했든 재노출 → 사용자 지적대로 중복·모순. **버튼 및 `handleLyricsUse(fromStep=2)` 분기(:742~743 answerText, :784 early return) 제거 확정.**
- 1.75에서 '반영'을 답한 뒤 마음이 바뀌면: 해당 답변 버블 탭 편집(④)으로 해결 — 기능 손실 없음.

**③ 세부 질문 순서 (CoverGenerationScreen.tsx)**
- 현재 체인(1.75 '직접 정할게요' 이후): `proceedToShot`(:638, 구도 1.8) → `handleShotPick`(:646, 인물 있으면 표정 1.82 / 없으면 배경 1.85) → `handleExpressionPick`(:664 → 배경 1.85) → `handleBgPhoto/Text/Skip`(:678/:705/:715 → `proceedToPalette` :722, 색감 1.9) → `handlePalettePick`(:730 → `proceedToFinal` 2).
- 스텝 식별자는 숫자 값(1.8=구도, 1.85=배경 고정)이고 렌더는 step 값 스위치(:1550~1629), 되감기(`performRewind` :825)도 target step 값 기준 → **순서 교체는 체인 배선만 바꾸면 되고 스텝 번호·영속 coverStep·프롬프트 조립(doGenerate payload :404~409, 개별 필드라 순서 무관)에 영향 없음.**
- 주의: 디렉터 질문 버블의 `echoOfStep` 메타(비파괴 되감기의 에코 식별)가 선행 스텝 값과 일치해야 함 — 배선 변경 시 함께 갱신(현재 `proceedToShot`은 echoOfStep 미부여, `proceedToPalette`는 1.85 하드코딩 :725 → 호출부 파라미터화 필요).
- `handleLyricsSkip` 되감기 분기(:794~800)의 "디테일 무응답 시 이어서 질문" 진입점도 proceedToShot → 새 1번 질문(배경)으로 교체 대상.

**④ 답변 편집 UX 통일 — 기준: 작사 디렉터 (LyricsInputScreen.tsx, 723줄)**
- 기준 구현: 답변 버블 탭 → `handleReselect`(:220) → **즉시 재선택 Modal**(:455~518 — 선택지 목록 + v3.201 자유 입력 행 + 취소, v3.202 flex-end 오버레이 + `useAndroidKeyboardLift` + 동적 maxHeight :475) → `handleReselectChoice`(:226~256)가 store 반영 + 해당 user 버블 text만 교체(비파괴). **확인 팝업 없음.**
- 작곡(MusicGenerationScreen.tsx:374~381 `handleUserBubbleTap`)·이미지(CoverGenerationScreen.tsx:856~870): 탭 → `showAlert('이 답변만 다시 고를까요?', ... 취소/다시 선택)` **확인 팝업 후** `performRewind`로 하단 입력 영역을 그 스텝으로 전환하는 방식 — 사용자가 금지한 "할지말지 팝업" 실측 확인.
- 두 화면 모두 v3.202/v3.203의 비파괴 치환 인프라 보유: 작곡 `commitExchange`(:298~324, rewindRef 활성 시 버블+echoOfStep 에코 치환 후 resumeStep 복귀), 이미지 `commitRewindAnswer`(:569~581) — **팝업에서 값을 고르면 기존 핸들러를 rewindRef 활성 상태로 그대로 호출하면 치환·복귀가 자동 성립.** 신규 커밋 경로 불필요.
- 스텝 유형 실측 — 팝업(선택지)형으로 옮길 수 있는 스텝과 불가 스텝이 갈림:
  - 작곡 renderInputArea(:1062, case :1074~1649): 단순 선택지 = 3(보컬)·100·4(스타일)·101·220·300(장르)·301(분위기)·310(곡길이)·11(키)·302(그대로/다시). 복합 UI = 0(제목 입력)·1(가사 편집)·5(참고 업로드)·6(제외 태그)·7/8/9/10(슬라이더)·200(아티스트 목록)·210(클론 목록)·12(페르소나).
  - 이미지: 선택지형 = 1(포함/빼고)·1.5(슬롯)·1.7(의상 2택)·1.75(반영/직접)·1.8(구도)·1.82(표정)·1.85(배경 — 사진/텍스트/건너뛰기)·1.9(색감)·2(스타일+자유). 복합 = 0(곡 목록 — 유일한 **파괴적** 스텝, :826~847 이후 선택 전부 초기화).
- 결론(자율 확정): 공용 `AnswerEditModal` 추출(작사 모달 마크업·스타일 그대로 — 재사용 3곳 충족) + 선택지형 스텝은 탭 → 즉시 이 모달. 복합 스텝은 탭 → **확인 팝업 없이** 즉시 되감기 + 입력 영역 위 "수정 중" 배너(취소 제공). 예외 1곳: 이미지 step 0(곡 변경)만 파괴적이라 확인 팝업 유지 — 작사에는 파괴적 스텝이 없어 "작사와 동일" 원칙과 충돌하지 않고, 실수 탭으로 대화 전체가 날아가는 사고 방지가 우선.

**⑤ 이미지 미세조정 반복 오류 — 원인 실측 (앱 + 프로덕션 서버 로그)**
- 앱 `handleRefine`(CoverGenerationScreen.tsx:1077~1149): `POST /upload/refine-cover`(timeout 10분). 서버 upload.py:849, 동기 처리(생성과 동일 계열), ⭐5 선차감.
- **서버 로그 실측(docker logs maidol-app, -t)**: 2026-09-22 03:05:09 refine 차감(ref 0fe9dfe0) → **35초 뒤** 03:05:44 같은 세션·같은 prompt_len=22로 두 번째 차감(ref 540904a6) → 03:07:31/03:07:57 **둘 다 성공, 둘 다 new_version=1**(이력 버전 충돌) — 도합 ⭐10 차감. 그리고 최근 14일 access 로그에 `POST /api/upload/refine-cover` 라인이 **0건**(generate-cover도 0건 — 장시간 동기 POST의 응답이 클라이언트에 도달하지 못하는 v3.202 I-lite 실측과 동일 계열).
- 재구성: refine 실소요 132~141초 >> 클라이언트 연결이 도중 단절(v3.202 실측 11/44/153s ERR_NETWORK와 동일) → 앱은 매번 '미세조정 실패' 표시 → 사용자 재시도 → **차감은 반복되고 결과는 못 받는 루프** = "계속 오류".
- 이중 제출 경로 추가 확인: `handleRefine`의 `refining` 가드(:1079)는 ⭐ confirm `await`(:1090~1096) **앞**에서만 검사 — confirm 대기 중 Enter(onSubmitEditing :1380)와 적용 버튼(:1384)으로 재진입하면 confirm 2개가 뜨고 동시 요청 가능(서버 로그의 35초 간격은 재시도로 보이나, 이 경합도 함께 봉인).
- v3.202 I-lite 폴링 복구(:324~361)는 **doGenerate 경로 전용** — refine 미커버 확인.
- 회수 수단 실측: 서버에 `GET /upload/cover-history/{cover_session_id}`(upload.py:1103) 존재 — `current_version`·`cover_object_name`·`cover_refine_history` 반환. **앱 수정만으로 복구 가능(백엔드 무변경) 확정.** 서버 측 결함(동시 refine이 같은 버전 번호를 쓰는 경합, refine 멱등키 부재)은 쓰기 차단 상태라 이번 배포 없음 → 서버 백로그로 기재.
- refine-cover 정상 완료도 되는 환경이 있음(9/22 03:07 성공 로그) — 즉 "항상 실패"가 아니라 "장시간 요청이 회선에 따라 실패"로, 복구 폴링이 정답(재요청=재차감 금지).

**⑥ 튜토리얼 오버레이 — 현황 실측**
- 기존 유사물: MapScreen.tsx:231~233 `showTutorial` + :736~760 인라인 Modal(작업실 4항목, ⓘ 버튼 :286으로 수동 토글) — **자동 1회 노출·영속 플래그 없음**, 다른 화면에는 전무.
- AsyncStorage 관행: `@react-native-async-storage/async-storage` 2.2.0, authStore.ts:4처럼 `.catch(() => {})` 무해 처리 관행.
- 탭 구조(App.tsx:300~395): Chart(차트)·Playlist(플레이리스트)·Feed(피드)·Search(검색)·Studio(작업실→Map)·MyMusic(숨김 탭). Player는 RootStack 별도 화면.
- 라이브러리(react-native-copilot 등) 검토 → **자체 구현 확정**: 대상이 5~6화면·카드형이면 RN Modal(transparent, statusBarTranslucent)로 충분하고, 스포트라이트(타깃 측정) 라이브러리는 Expo 54·기존 헤더 주입 구조와 충돌 리스크 대비 이득 없음. v3.201~202 교훈 반영: Modal 내 KAV 금지(입력 없음이라 무관), safe-area 인셋 직접 처리.

### 확정 스펙 (자율 판단 근거 포함)
1. **(①) MusicResult 시크**: 비교 카드 활성 진행바 + 단일 플레이어 진행바를 `Slider`로 교체(PlayerScreen 패턴 이식: `isSeekingRef`+`seekValue`로 드래그 중 콜백 튐 방지, `onSlidingComplete`→`setPositionAsync`). duration 비유한/0이면 disabled. LISTEN `{action:'seek', from_ms, to_ms}`를 onSlidingComplete에서만 1회 기록(:145 예약 주석 이행 — 폭주 없음). 재생 중이 아니어도 시크 허용(위치만 이동).
2. **(②) step 2의 '가사 내용 기반으로 생성' 버튼 삭제** + handleLyricsUse의 fromStep 파라미터·분기 제거(1.75 전용으로 단순화). 가사 반영 변경은 1.75 버블 편집으로 일원화.
3. **(③) 세부 체인 재배선**: 1.75 '직접' → **배경(1.85)** → **구도(1.8)** → (인물 있으면) 표정(1.82) → 색감(1.9) → 자유 서술(2). 스텝 번호 불변·배선과 echoOfStep만 교체. 앨범 모드/무트랙 직행(:605)도 배경부터.
4. **(④) 편집 UX 통일**:
   - 신규 `components/AnswerEditModal.tsx` — LyricsInput 재선택 모달(:455~518 + reselect* 스타일)을 그대로 추출. props: `visible, title('다시 선택하기'), choices, freeText?, extraActions?(라벨+onPress — 배경 '사진 올리기', 의상 '꾸미기 가기' 용), onPick(text), onCancel`. 키보드 리프트·동적 maxHeight 로직 포함.
   - LyricsInputScreen: 자체 모달 JSX를 이 컴포넌트 호출로 치환(마크업 동일 추출이라 회귀 0 목표 — 동작·스타일 diff 검증 필수).
   - 작곡/이미지: `handleUserBubbleTap`에서 showAlert 확인 팝업 **삭제**. 선택지형 스텝 → `rewindRef = {idx, target, resumeStep: step}`만 세팅(**setStep 안 함** — 하단 입력 영역 유지)하고 모달 오픈; onPick은 기존 스텝 핸들러(handleShotPick·handleGenrePick 등)를 그대로 호출 → commitExchange/commitRewindAnswer의 되감기 분기가 치환·복귀 수행. onCancel은 rewindRef=null. 핸들러 후에도 rewindRef가 살아 있으면(연쇄: 이미지 1→1.5, 작곡 302→300 등) 모달 스텝을 rewindRef.target으로 갱신해 이어서 노출.
   - 복합 스텝(작곡 0·1·5·6·7·8·9·10·200·210·12) → 확인 팝업 없이 기존 `performRewind` 즉시 실행 + 입력 영역 상단에 수정 배너(`"○○ 답변을 수정 중이에요"` + [취소] — 취소 시 rewindRef=null·setStep(resumeStep)). 실수 탭 복귀 수단 확보.
   - 이미지 step 0(곡 변경)만 파괴적 확인 팝업 유지(위 근거).
   - freeText 허용 스텝 = 메인 플로우에 자유 입력이 있는 스텝만(작곡 300·301·4·101, 이미지 1.8·1.82·1.85·1.9·2). enum 매핑 스텝(작곡 3·100·220·302·310·11, 이미지 1·1.5·1.7·1.75)은 자유 입력 비노출 — LyricsInput의 듀엣/랩/길이 비노출 원칙(:492 주석)과 동일 근거.
5. **(⑤) 미세조정 복구 — 앱 측만**:
   - `handleRefine` 이중 제출 봉인: confirm await 전에 `refineSubmitGuardRef` 세팅(취소/완료 시 해제) — confirm 대기 중 재진입 차단.
   - 실패 catch에서 `isRecoverableNetErr`이면 즉시 실패 확정 대신 **`GET /upload/cover-history/{coverSessionId}` 폴링**(15s×최대 12회 — I-lite와 동일 리듬, 요청 직전 `currentVersion`을 기준선으로 `current_version > 기준선`이면 회수): 성공 시 새 버전 채택(objectName·history·version state 갱신 + `fetchBalance()`), **재요청 없음=재차감 없음**. 폴링 중 refineHint를 '연결이 불안정했어요. 서버에서 완성본을 확인하고 있어요…'로 표시. 회수 실패 시에만 기존 실패 알럿(문구에 '별이 이미 사용됐다면 버전 기록에 잠시 후 나타날 수 있어요' 1줄 추가).
   - **서버 백로그(이번 배포 없음 — 쓰기 차단)**: (a) refine 동시 요청이 같은 new_version을 쓰는 경합(9/22 실측: version 1 이중 기록) — 세션 단위 락 or 멱등키, (b) 이중 차감 환불 검토(user c19acda4 ⭐5 × 1건), (c) 장시간 동기 POST의 응답 유실 — 비동기 잡+폴링 전환 검토. 사용자 승인 후 별도 사이클.
6. **(⑥) 튜토리얼 오버레이**:
   - 신규 `components/TutorialOverlay.tsx`: RN Modal(transparent·fade·statusBarTranslucent) + 반투명 딤 + 하단 카드(제목/설명/진행 도트/[다음]·마지막 [시작하기]/[건너뛰기]). props `screenKey, steps:{title, desc}[]`. 마운트 시 AsyncStorage `maidol_tutorial_seen_v1:<screenKey>` 확인(try/catch, 읽기 실패 시 **미노출** — 오탐 노출보다 안전) → 미열람이면 자동 1회 노출, 닫힘(건너뛰기 포함) 시 플래그 기록. `show()` 명령형 재노출 지원(ref).
   - 스포트라이트(요소 하이라이트) 없이 카드형 스텝 안내로 확정 — MapScreen 기존 tutorialBox 관행 연장, 측정 기반 하이라이트는 과설계.
   - 대상 6화면·문구(짧고 기능 중심, 이모지 금지, MAIDOL 표기): Chart(차트 구경→탭 재생→담기), Playlist(재생목록/플레이리스트 관리→비회원 재생목록은 재시작 시 사라짐→플레이리스트 재생=큐 교체), Feed(소식 보기→내 곡 공유→반응), Search(곡·아티스트 검색→결과 탭 재생), Map(기존 ⓘ 4항목을 steps로 이관 — 인라인 Modal 삭제, ⓘ 버튼은 overlay.show() 재노출로 연결), Player(재생바 드래그 이동→가사 보기→담기·공유). 문구 최종은 dev 재량(규칙 준수 전제).
   - showAlert 규칙과 별개인 전용 오버레이(메모리 규칙 예외 명시). '튜토리얼 다시 보기' 설정 항목은 백로그(Map은 ⓘ로 이미 재노출 가능).
7. 항상 규칙: MAIDOL 문자열, 이모지 금지(⭐ 예외), 저작권 단정 금지, 시크릿 금지.

### 변경 매트릭스
| 파일 | 변경 | 항목 | 담당 | 로그 추적자 |
|---|---|---|---|---|
| screens/MusicResultScreen.tsx | 진행바 2곳 Slider 교체 + seek LISTEN(from_ms/to_ms) | ① | app-dev 1조 | `[MusicResult] seek` |
| components/AnswerEditModal.tsx (신규) | 작사 재선택 모달 추출(선택지+자유입력+extraActions) | ④ | app-dev 1조 | — |
| screens/LyricsInputScreen.tsx | 자체 모달 → AnswerEditModal 치환(회귀 0) | ④ | app-dev 1조 | 기존 로그 유지 |
| screens/MusicGenerationScreen.tsx | 확인 팝업 삭제, 선택지형=모달/복합형=배너 되감기 | ④ | app-dev 1조 | `[MusicGeneration] 답변 편집` |
| screens/CoverGenerationScreen.tsx (편집 UX부) | 확인 팝업 삭제(step 0 제외)·모달 적용 | ④ | app-dev 1조 (2조 커밋 후) | `[Cover] 답변 편집` |
| screens/CoverGenerationScreen.tsx (체인·버튼·refine부) | step2 가사 버튼 제거, 배경→구도 재배선+echoOfStep, refine 이중제출 가드+cover-history 폴링 복구 | ②③⑤ | app-dev 2조 | `[Cover] refine 폴링 복구` |
| components/TutorialOverlay.tsx (신규) | 공용 오버레이+AsyncStorage 1회 노출 | ⑥ | app-dev 3조 | `[Tutorial] shown/skip` |
| screens/ChartScreen·PlaylistScreen·FeedScreen·SearchScreen·MapScreen·PlayerScreen.tsx | TutorialOverlay 장착(Map은 기존 인라인 Modal 이관) | ⑥ | app-dev 3조 | 동일 |
| (서버) — | 변경 없음(읽기 전용) — refine 경합·환불·비동기화는 백로그 | ⑤ | backend-dev 없음 | — |

### 작업 순서·충돌 관리
- **2조 → 1조 순차**(둘 다 CoverGenerationScreen.tsx 대규모 수정 — 2조 커밋 후 1조가 그 위에서 편집 UX 적용). 3조는 전 구간 병렬(신규 파일+탭 화면들, 겹침 없음. MapScreen은 3조 전유).
- 커밋: 조별 1커밋 이상, frontend 브랜치 자동 push 관행.

### 후속(별도 과제 — 이번 범위 밖)
- 서버: refine 버전 경합·멱등키·이중 차감 환불·장시간 POST 비동기화(위 ⑤ 백로그 — 사용자 승인 필요).
- 설정 화면 '튜토리얼 다시 보기' 일괄 리셋.
- generation 스트림 Range(206) 지원 — 긴 곡(6분) 후보에서 미버퍼 구간 시크 지연이 실측되면 그때.

---

## v3.205 (2026-09-22) — 문의 DM 입력바 가림 수정 + 백그라운드 다음곡(로컬 프리다운로드) + BT 메타데이터 판정 + 공지 3건 등록 + 꾸미기 성별 자동 필터

> 작성: planner(팀 리드, maidol-studio). 사용자 요청 5항목: ① 신고/문의 official DM 화면 하단 입력바 잘림·키보드 가림 ② 백그라운드 다음곡 재생 실패 지속 ③ 블루투스 차량 UI에 곡 제목·가수 미표시 ④ 문의 방법·FAQ·베타 안내를 MAIDOL 공지사항으로 등록 ⑤ 꾸미기 상의/하의 성별 필터 확인·적용.
> 소스오브트루스: 앱 `/Users/pearl/TripleJ/2_housing/`(frontend, 직전 9670ccb v3.203/204 합격 형상), 백엔드 프로덕션 `ssh maidol-ec2` `/home/ubuntu/maidol/backend_9004/`(git 아님, **서버 파일 쓰기 권한 차단 — 읽기·API 호출·컨테이너 내 python 실행만**).
> 이번 사이클 서버 파일 배포 없음. 네이티브 모듈 추가 없음 → **EAS 재빌드 불필요**(전 항목 JS만).

### Plan verification findings (파일:라인 + 실측)

**① 문의 DM 입력바 잘림·키보드 가림 (DmChatScreen.tsx, 273줄)**
- 진입 경로 실측: 설정 → 문의하기(오류 신고) → `startCsInquiry`(SettingsScreen.tsx:364~385) → `GET /dm/official` → `POST /dm/conversations` → `navigate('DmChat', { conversation, prefill: '[오류신고: 사유] ' })`. DmChat은 RootStack 직속(App.tsx:534) — 탭바 없음.
- **잘림 원인**: app.json `android.edgeToEdgeEnabled: true`(:35) — 앱이 시스템 내비게이션 바 뒤까지 그려지는데, DmChatScreen 컨테이너는 `paddingTop: insets.top`만 적용(:158)하고 **`insets.bottom` 미적용**. 입력바(:266~271)는 `margin: spacing.lg`(약 16px) < 내비바 높이(3버튼 ~48px, 제스처 ~24px) → 하단 입력바가 내비바에 깔려 잘림.
- **키보드 가림 원인**: `KeyboardAvoidingView behavior`가 iOS 'padding'/Android `undefined`(:158) — Android는 `softwareKeyboardLayoutMode: "resize"`(app.json:36)에 의존하는데, **Android 15(API 35)+에서는 edge-to-edge 강제로 adjustResize가 창을 자동 축소하지 않는 것이 확인된 플랫폼 변경**(Expo 커뮤니티·keyboard-handling 가이드 실측 — SDK 53+ 다수 보고). 기기별로 갈리므로(API 34 이하는 resize 동작) 고정 리프트를 더하면 구버전에서 이중 보정(간격)이 생긴다.
- 기존 합격 패턴: `hooks/useAndroidKeyboardLift.ts`(v3.201~202)는 **Modal 전용 셈법**(kbHeight − insets.bottom) — 전체 화면에는 창 리사이즈 동작 여부가 기기별이라 그대로 쓰면 API 34 이하에서 이중 보정. → **겹침 실측 기반 리프트**로 확장(아래 스펙 3).
- ReportModal(components/ReportModal.tsx)은 `/reports` 제출용 — DM 미연계. 사용자가 말한 "신고하기 → official DM"은 위 CS 문의 흐름으로 특정.

**②③ 백그라운드 다음곡 + BT 메타데이터 (합동 진단 — 이번 사이클 최대 쟁점)**
- **서버 원격 로그 재실측 결과: v3.202 이후 [BTDebug] 실측 불가 — 로그 소실.** frontend.log는 컨테이너 내부 `/app/logs/frontend.log`에 기록되는데 `docker inspect maidol-app` Mounts가 `[]`(호스트 마운트 없음). 오늘 04:31 v3.203 2차 배포(컨테이너 재생성)로 이전 로그 전부 소실 — 현재 파일은 4줄(dmSocket 재연결)뿐. 직전 사이클까지의 실측(2026-09 UnknownHostException = Android Doze 네트워크 차단)이 최신 근거. → 백로그: frontend.log 호스트 볼륨 마운트(`-v .../logs:/app/logs`) — docker run 옵션 변경이라 서버 배포 절차 필요(사용자 협조, 이번 사이클 제외).
- **② 현 구조의 남은 구멍(코드 실측)**: v3.197/202 프리로드는 `Audio.Sound.createAsync({uri: 원격}, {shouldPlay:false})`(playback.ts:122~125) — 네이티브 플레이어는 **파일 전체가 아니라 버퍼 창만** 미리 받는다. 즉 "preload ready"여도 스왑 후 재생을 잇는 도중 Doze가 네트워크를 끊으면 미버퍼 구간에서 죽는다. 프리로드가 "완결된 자산"이 아니라는 것이 잔존 실패의 유력 원인(조기 프리로드·백오프로도 못 막는 구간).
- **③ 원인 확정**: expo-av는 Android MediaSession(잠금화면·BT AVRCP 메타데이터)을 제공하지 않음 — services/audioMode.ts 주석(:5~6)에 이미 명기, `updateMediaSession`은 `Platform.OS !== 'web'` 즉시 return(:40). **expo-av 유지로는 ③ 해결 불가(코드 재확인 완료).**
- **이관 평가(핵심 판정)**:
  - **RNTP**: v5(2026)는 `@rntp/player`로 **상용 라이선스 전환(개인·교육만 무료)** — MAIDOL은 스토어 출시 예정 상용 앱이라 비용 발생(사용자 승인 사안). v4.1은 Apache-2.0 유지지만 신아키텍처(app.json `newArchEnabled: true`:10) + SDK 54(RN 0.81) 조합 호환성 이슈 보고 존재(patch-package 필요 사례) — 검증 스파이크 없이 본작업 투입 불가. 네이티브 모듈 추가 = EAS 재빌드 필수.
  - **expo-audio(신규 대안, 조사로 확인)**: Expo 공식 — **expo-av는 SDK 55에서 제거 예정**(SDK 54 체인지로그 명시)이라 이관 자체가 불가피. SDK 54의 expo-audio는 `setActiveForLockScreen(active, metadata)`·`updateLockScreenMetadata({title, artist, albumTitle, artworkUrl})` API로 잠금화면/미디어 세션 메타데이터를 지원(=③ 해결 후보), `shouldPlayInBackground` 지원. 단 원격 컨트롤(다음/이전) 이벤트 리스너와 Android 포그라운드 서비스(=② Doze 근본 해결) 문서화가 불충분 — 실기기 스파이크 필요. 무료·Expo 순정이라 RNTP v5 비용/v4 호환 리스크 대비 우선 검토 대상.
  - **판정: 이번 사이클 이관 보류.** 근거: (a) RNTP v5 비용은 사용자 결정 사안, v4는 신아키 호환 미검증 (b) expo-audio가 더 유력한데 스파이크(실기기 EAS 빌드 검증) 선행 필요 (c) 이관은 playback.ts 축적 로직(duration 보정 v3.192·프리로드 v3.197/202·reconciler·LISTEN 계측·[BTDebug]) + PlayerScreen/MiniPlayer 전면 재배선 = 단독으로도 40% 룰 초과 규모 — 다른 4개 항목과 같은 사이클 불가. → **차기 사이클 본작업 후보: "expo-audio 이관 스파이크(잠금화면 메타데이터+백그라운드 연쇄 재생 실기기 검증) → 합격 시 전면 이관"**, RNTP는 스파이크 실패 시의 차선(v4 우선, v5는 비용 승인 후).
  - 40% 룰: 이번 사이클 확정 범위는 미초과. 이관을 포함했다면 초과 — 그래서 뺐다.
- **② 이번 사이클 점진 보강(확정)**: 다음 곡을 **로컬 파일로 풀 프리다운로드**(expo-file-system legacy `downloadAsync` — ArtistLoadingScreen.tsx:15~16 관행: v19 신 API에 downloadAsync 없음 → `expo-file-system/legacy` import) 후 `file://` URI로 createAsync. 파일이 디스크에 있으면 스왑 후 재생에 네트워크가 전혀 불필요 → **"화면 꺼진 뒤 첫 전환"을 구조적으로 해결**. 한계 정직 기재: N+2곡부터는 백그라운드에서 다운로드가 다시 Doze에 막힐 수 있음(기기별 오디오 재생 중 Doze 완화 여부에 따라 연쇄 성립 — tester 실측 항목). 근본 해결은 포그라운드 서비스 = 차기 이관.
- ③ 부수 실측: audioMode.ts:46 웹 폴백 아티스트 문자열이 `'AIDOL'` — 브랜딩 규칙 위반(노출 문자열 AIDOL 금지) → MAIDOL로 정정(1줄).

**④ 공지사항 — 공지 시스템 실측**
- 정식 공지 경로 = **NoticeSquad(v194)**: `POST /api/admin/cs/broadcast`(admin_cs.py:271~) 단일 발송 경로 — official 계정(services/official.py: `official_account_email`로 시드, role=admin) 발신, `dm_service.broadcast_message(conn, mongo, official_id, audience, text, notice_id)`(dm_service.py:821)로 전 유저 1:1 DM fan-out + `notice_service.create_notice`(notice_service.py:192) 이력(mongo notices) + 읽음 집계. audience 화이트리스트 `all|users|customers`(dm_service.py:755), text 1~2000자(MAX_TEXT_LEN=2000). **앱 공지 화면 = official 계정과의 DM 대화(DmInbox/DmChat)** — 별도 공지 목록 화면 없음(UserChannel의 '공지' 라벨은 kind=community 채널 피드로 별개).
- 등록 수단: 관리자 JWT 필요(get_admin_user) — 관리자 계정 크리덴셜은 시크릿이라 사용 불가. **확정 절차: 컨테이너 내 python 실행**(`sudo docker exec -i maidol-app python - <<'PY' ...`, python 3.11 확인) — admin_cs 핸들러 시퀀스를 코드 그대로 재현(create_notice → broadcast_message → 이력 상태 갱신), Redis 락은 수동 순차 실행이라 생략(건당 30초 이상 간격 준수). admin_id는 official_id로 기록(수동 등록 표식 없음 — 이력상 무해). **프로덕션 데이터 쓰기(전 유저 DM 발송·비가역)** — 본문은 아래 확정 원고를 한 글자도 바꾸지 않고 사용, tester가 수신·이력 검증. 서버 파일 수정 없음.
- 발송 건수 판단: 브로드캐스트 1건 = 전 유저 DM 1통. FAQ를 잘게 쪼개면 스팸 — **3건으로 확정**(문의 방법 / FAQ / 베타 안내), 각 2000자 이내.

**⑤ 꾸미기 성별 필터 — 실측: 서버 필드 있음, 데이터 충실, 앱에 자동 필터 없음**
- 서버: ad_items에 `gender` 필드 존재 — `ALLOWED_AD_GENDERS = {"남성용","여성용","공용"}`(business.py:34), 관리자 CSV 임포트에 성별 열(admin_items.py:94~147, 기본값 "여성"→파싱). **프로덕션 실데이터 확인(GET /business/ads/active, 무인증)**: 455건 중 상의 남 69/여 87/공용 1, 하의 남 74/여 71, 신발 남 65/여 88 — 성별 데이터 충실. `/ads/active`는 gender 쿼리 파라미터가 없어(카테고리만) **필터는 앱 측 적용**(응답에 gender 포함 — ArtistCodyScreen AdItem 타입 :58에 이미 수신 중).
- 앱: ArtistCodyScreen.tsx의 5단계 드릴다운(:65~68 platform›brand›gender›product)에 **수동** 성별 레벨은 있으나(genderMatches :74~80, '공용'·미지정은 양쪽 포함) **아티스트 성별 기준 자동 필터는 없음** — openPicker(:220~238)가 받은 목록을 그대로 노출.
- 아티스트 성별 소스: 서버 /character 저장 body에 gender 포함(ArtistLoadingScreen.tsx:282 `saveBody.gender = pendingGender`) + 로컬 `artistProfileStore.profiles[slot].gender`(v3.82, '남성'|'여성'|자유 입력) + 생성 흐름 중엔 `characterTaskStore.pendingGender`. 구계정/자유입력은 값이 없거나 비정형일 수 있음 → **성별 판별 실패 시 자동 필터 미적용**(전체 노출)으로 안전.

### 확정 스펙 (자율 판단 근거 포함)

1. **(①) DmChatScreen 하단 정비**
   - 컨테이너(:158)에 `paddingBottom: insets.bottom` 추가 — edge-to-edge 내비바 잘림 근본 해결(제스처·3버튼 공통).
   - 신규 `hooks/useKeyboardOverlapLift.ts`: Android 한정, `keyboardDidShow`의 `endCoordinates.screenY`(키보드 상단 절대좌표)와 대상 뷰의 `measureInWindow` 하단 좌표의 **실측 겹침만큼만** 리프트(hide 시 0 리셋, 리스너 등록/해제 쌍 — useAndroidKeyboardLift v3.201 관행 계승). 창이 이미 리사이즈된 기기(API 34↓)는 겹침 0 → 리프트 0(이중 보정 구조적 불가), Android 15+ edge-to-edge(리사이즈 미동작)는 겹침만큼 리프트. 반환값을 inputBar `marginBottom`에 적용(paddingBottom 합산 금지 — v3.201 §1 교훈 동일).
   - iOS 기존 KAV padding 경로 불변. 기존 useAndroidKeyboardLift(모달 전용)는 손대지 않는다 — 회귀 0.
2. **(②) 다음 곡 로컬 풀 프리다운로드 (services/playback.ts)**
   - `maybePreloadNext` 내 프리로드 경로(:119~146) 교체: `FileSystem.downloadAsync(streamProxyUrl, cacheDirectory + 'preload/' + trackId + '.mp3')`(`expo-file-system/legacy`) 완료 후 `createAsync({uri: 로컬 file://}, {shouldPlay:false})`. NextPreload에 `fileUri` 보관.
   - 정리 규칙: `discardPreloaded`(:74)에서 unload와 함께 파일 삭제(deleteAsync idempotent), 새 다운로드 시작 전 이전 preload 파일 삭제, 스왑 소비된 파일은 **해당 곡 재생 종료(didJustFinish/새 로드) 시** 삭제. 앱 기동 시 `preload/` 디렉터리 일괄 purge 1회(고아 파일 방지) — initPlaybackReconciler에 편승.
   - 실패 처리: 다운로드 실패 = 기존 preloadFail 백오프(곡당 3회·10s) 그대로 계상, didJustFinish 미스 시 기존 네트워크 폴백 경로 불변. 다운로드 도중 loadGen 변경 시 파일 삭제 후 중단.
   - **reconciler 보강 1줄**: AppState 'active' 복귀 시(initPlaybackReconciler :378~) 재생 중이고 프리로드가 없으면 `maybePreloadNext(track, 0, 0, {eager:true})` 재트리거 — Doze로 놓친 다운로드를 화면 켜짐 순간 회수.
   - [BTDebug] 로그 이름 유지·추가: `preload download start/done(bytes)/fail`, swap 로그에 `local:true`. PlayerScreen은 무수정(스왑 사운드 생성 경로가 playback.ts 내부라 투명).
   - 한계 명시(정직): 연쇄 N+2곡은 Doze 지속 시 여전히 실패 가능 — 근본은 차기 expo-audio/RNTP 이관(포그라운드 서비스).
3. **(③) 이번 사이클 코드 변경 없음(불가 판정 보고)** + audioMode.ts:46 `'AIDOL'` → `'MAIDOL'` 1줄(웹 미디어세션 폴백 문자열 — 브랜딩 규칙). 차기 사이클 본작업 제안: **expo-audio 이관 스파이크**(setActiveForLockScreen 실기기 검증: BT AVRCP 제목·아티스트 표기 + 백그라운드 연쇄 재생 + 원격 다음/이전) → 합격 시 전면 이관, 불합격 시 RNTP v4(Apache) 스파이크, v5는 상용 라이선스 비용 사용자 승인 후. expo-av SDK 55 제거 예정이라 어느 쪽이든 이관은 필수 경로.
4. **(④) 공지 3건 등록(컨테이너 python, 서버 파일 무수정)** — 확정 원고(이모지 없음, MAIDOL 표기, 저작권 단정 없음). 등록 순서 3→2→1(받은편지함 상단에 1번이 오게), 건당 30초 이상 간격, audience='all'.
   - **공지 1 — 문의 방법 안내**: "안녕하세요, MAIDOL 팀입니다. 이용 중 불편이나 오류가 있다면 언제든 알려주세요. 문의 방법: 설정 화면에서 '문의하기(오류 신고)'를 누르고 사유를 선택하면 MAIDOL 공식 계정과의 1:1 대화가 열립니다. 문제 상황(어떤 화면에서, 어떤 동작을 했을 때, 어떤 메시지가 떴는지)을 남겨 주시면 확인 후 답변드립니다. 이 대화방에 바로 답장을 보내셔도 접수됩니다. 감사합니다."
   - **공지 2 — 자주 묻는 질문(FAQ)**: "MAIDOL 자주 묻는 질문을 안내드립니다. / Q. 별은 무엇인가요? — 별은 MAIDOL의 활동 재화입니다. 곡 만들기, 커버 이미지 생성 등 일부 기능에 사용되며, 보유량은 마이페이지에서 확인할 수 있습니다. / Q. 곡 생성은 얼마나 걸리나요? — 보통 수 분 이내에 완성됩니다. 이용이 몰리는 시간에는 조금 더 걸릴 수 있으며, 생성 중에는 앱을 닫아도 서버에서 계속 진행됩니다. / Q. 내 목소리(보이스 클론)는 언제까지 쓸 수 있나요? — 생성된 보이스는 약 2~6시간 동안 유지된 뒤 만료됩니다. 만료된 보이스는 다시 생성해야 하며, 만료로 인한 별 환불은 없습니다. 생성 자체가 실패한 경우에만 사용한 별이 환불됩니다. / Q. 가사 없는 연주곡도 만들 수 있나요? — 네. 곡 만들기에서 연주곡을 선택하면 가사 없이 원하는 길이의 연주곡을 만들 수 있습니다. / Q. 내가 만든 곡의 창작 기록은 어떻게 남나요? — MAIDOL은 곡 생성 과정의 대화와 선택 내역을 창작 기록으로 보관해 확인할 수 있도록 제공합니다. 이는 창작 과정을 증빙하는 데 참고할 수 있는 자료이며, 법적 저작권 등록이나 권리 보장을 의미하지는 않습니다."
   - **공지 3 — 베타 테스트 안내**: "MAIDOL 베타 테스트에 참여해 주셔서 감사합니다. 현재 MAIDOL은 베타 기간으로, 기능이 수시로 추가되고 개선됩니다. 이용 중 오류를 만나시면 설정의 '문의하기(오류 신고)'로 알려주세요. 보내주신 의견은 하나씩 확인해 반영하고 있습니다. 베타 기간에는 일부 기능의 동작과 정책(별 사용량 등)이 예고 후 변경될 수 있습니다. 더 나은 MAIDOL로 보답하겠습니다."
   - 스크립트 요건: 컨테이너 모듈 그대로 사용(asyncpg 커넥션은 settings.database_url로 직접 생성, mongo는 앱 getter 재사용 또는 motor 직접), official_id는 `official_account_email`로 SELECT(services/official.py 시드 기준), 시퀀스 = `notice_service.create_notice` → `dm_service.broadcast_message(..., notice_id=...)` → 이력 상태 갱신(admin_cs._run_cs_broadcast의 성공/실패 마킹과 동일 함수 사용). sent/failed 집계 출력 저장. 크리덴셜·토큰 출력 금지(시크릿 금지).
5. **(⑤) 꾸미기 성별 자동 필터 (screens/ArtistCodyScreen.tsx)**
   - 아티스트 성별 해석 헬퍼: apiResult(서버 character).gender → characterTaskStore.pendingGender → artistProfileStore.profiles[slot].gender 순 폴백, 문자열 정규화(trim 후 '남'으로 시작→'남', '여'로 시작→'여', 그 외/부재→null).
   - null 아니면 피커 목록에 `genderMatches(item, g)`(:74 기존 함수 그대로 — '공용'·미지정 양쪽 포함)를 **기본 적용**. 피커 헤더(전체|위시리스트 탭 행)에 토글 칩 노출: 기본 `"○성용만"`(활성) ↔ 탭 시 `"전체 보기"` — 세션 내 피커 열 때마다 기본 ON 복귀. null이면 칩 미노출·필터 미적용.
   - 적용 카테고리: gender 데이터가 실재하는 **상의·하의·신발**(실측 근거). 나머지 카테고리는 무필터(데이터 없음 — 전량 사라지는 사고 방지). SAMPLE_ITEMS(무광고 폴백)는 gender 없음 → genderMatches가 '공용' 취급이라 자연 통과.
   - 수동 드릴다운 성별 레벨(:66)·위시리스트 탭·5단계 체인은 불변. 자동 필터는 openPicker 결과와 드릴 소스 목록에 일괄 선적용(드릴 패싯 수치도 필터 후 기준 — 일관성).
   - 로그: `[ArtistCody] 성별 자동 필터` { g, cat, before, after }.
6. 항상 규칙: MAIDOL 표기·이모지 금지(⭐ 예외)·showAlert(시스템 Alert 금지)·저작권 단정 금지·시크릿 금지·v3.203/204 합격 형상 회귀 금지.

### 변경 매트릭스
| 파일 | 변경 | 항목 | 담당 | 로그 추적자 |
|---|---|---|---|---|
| screens/DmChatScreen.tsx | insets.bottom 패딩 + 입력바 겹침 리프트 | ① | app-dev 1조 | `[DmChat]` 기존 유지 |
| hooks/useKeyboardOverlapLift.ts (신규) | 겹침 실측 기반 Android 키보드 리프트 훅 | ① | app-dev 1조 | — |
| screens/ArtistCodyScreen.tsx | 아티스트 성별 자동 필터 + 전체 보기 토글 | ⑤ | app-dev 1조 | `[ArtistCody] 성별 자동 필터` |
| services/playback.ts | 프리로드를 로컬 풀 다운로드로 교체 + 파일 수명 관리 + active 복귀 재트리거 | ② | app-dev 2조 | `[BTDebug] preload download *` |
| services/audioMode.ts | 웹 폴백 문자열 AIDOL→MAIDOL 1줄 | ③ | app-dev 2조 | — |
| (서버) — 파일 변경 없음 | 컨테이너 python으로 공지 3건 브로드캐스트(프로덕션 DB 쓰기) | ④ | notice-ops | 서버 `[admin-cs]`/`[dm-broadcast]` |

### 작업 순서·충돌 관리
- **전 조 병렬**(파일 겹침 없음). 커밋: 조별 1커밋 이상, frontend 브랜치 자동 push 관행. EAS 재빌드 불필요(JS만).
- notice-ops는 원고 오탈자 검수 후 실행 — 발송은 비가역이므로 실행 전 원고를 PLAN 원문과 diff 0 확인. 등록 스크립트는 scratchpad에만 두고 커밋 금지(로컬 산출물 아님).
- ②의 캐시 경로·정리 로직은 tester 검증 전까지 프리로드 외 용도 사용 금지(다른 캐시와 디렉터리 분리).

### test-designer 테스트 항목
1. **① DmChat 입력바**: 설정→문의하기→사유 선택→DmChat 진입(프리필 확인). (a) Android API 35 에뮬 — 진입 직후 입력바 전체 노출(내비바에 안 깔림, 제스처/3버튼 모두), 입력 포커스 시 입력바가 키보드 위에 완전 노출, 키보드 닫힘 후 잔존 간격 0. (b) Android API 34 — 동일 + 이중 보정 간격 없음(겹침 0 → 리프트 0 확인). (c) iOS — 기존 KAV 회귀 0. (d) 수신 pending 대화(입력바 숨김 상태) 레이아웃 회귀 0.
2. **② 로컬 프리다운로드**: 큐 2곡 이상 재생 → `[BTDebug] preload download start/done` 로그, 캐시 preload/ 파일 실재(크기>0). **핵심 시나리오**: 프리로드 완료 확인 후 기내 모드(네트워크 차단) → 현재 곡 종료 → 다음 곡 정상 이어재생(swap 로그 local:true). 수동 스킵/미니 닫기/셔플 토글 시 파일 삭제 확인(고아 0), 앱 재시작 시 purge 1회 로그. 다운로드 실패(서버 차단 시뮬) 시 백오프 3회·10s 및 didJustFinish 네트워크 폴백 회귀. 실기기(대표 단말) 화면 끄고 1시간 연속 재생 — 전환 성공률 기록(연쇄 한계 실측: N+2곡 동작 여부 보고).
3. **③ 판정 검증**: 코드 변경 없음 확인(회귀 0) + 웹 빌드에서 미디어세션 artist 폴백 'MAIDOL' 표기. 노출 문자열 'AIDOL' 전역 grep 0(⭐ 예외 규칙 무관).
4. **④ 공지 3건**: 테스트 일반 계정에서 official DM 3건 수신(순서: 문의 방법이 최상단), 본문이 PLAN 원고와 일치(diff 0), 이모지·'AIDOL' 문자열 0, 링크/개인정보 없음. mongo notices 3건(status 완료, sent>0, failed 집계 확인 — 컨테이너 python 읽기 전용 조회). DmChat에서 공지 대화에 답장 시 CS 접수 정상(기존 흐름 회귀).
5. **⑤ 성별 필터**: 남성 아티스트로 꾸미기 진입 → 상의/하의/신발 피커 기본 상태에서 '여성용' 아이템 미노출·'공용' 노출, 토글 탭 → 전체 노출, 피커 재진입 시 필터 기본 복귀. 여성 아티스트 교차 확인. 성별 미상(구계정·자유입력) → 칩 미노출·전량 노출. 드릴다운 5단계(성별 레벨 포함)·위시리스트 탭·SAMPLE 폴백 회귀 0. 악세서리 등 무데이터 카테고리 전량 노출.
6. **인접 회귀**: v3.204 AnswerEditModal 3화면·MusicResult 시크·튜토리얼 오버레이, v3.203 연주곡 체인 — 스모크 1회.

### 후속(별도 과제)
- **[차기 본작업 후보] expo-audio 이관 스파이크**: 실기기 EAS 빌드로 (a) setActiveForLockScreen → BT/차량 제목·아티스트 표기 (b) 백그라운드 연쇄 재생(Doze) (c) 원격 다음/이전 이벤트 검증 → 합격 시 playback.ts 전면 이관 설계(어댑터 계층으로 duration 보정·프리로드·reconciler·LISTEN 이식). 불합격 시 RNTP v4 스파이크, v5는 라이선스 비용 사용자 승인 사안. expo-av는 SDK 55 제거 예정 — 이관 필수.
- 서버: frontend.log 호스트 볼륨 마운트(컨테이너 재생성 시 로그 소실 재발 방지 — docker run 옵션, 사용자 승인 배포).
- /business/ads/active에 gender 쿼리 파라미터(서버 필터) — 앱 필터로 충분하나 카탈로그 500건 초과 성장 시.
- 공지 운영 정례화: admin_web 공지 관리 페이지에서 발송하는 운영 절차 문서화(관리자 로그인 보유자 = 사용자).

---

## v3.205 ④ 개정 (2026-09-22, 사용자 지시: DM 브로드캐스트 반려 → official 채널 공지 글)

> 사용자 원문: "공지는 DM 으로 발송되는게 아니라 maidol_official 계정의 공지사항에 글로 작성해야해. 그리고 사용자들이 디폴트로 오피셜 계정에 팔로워가 되어있어서 공지..를 채널에서 확인하는 방향으로 가려고 하는데."
> → 기존 ④ 스펙(POST /api/admin/cs/broadcast, 전 유저 official DM 1통 fan-out)은 **폐기(미실행)**. DM 브로드캐스트는 이번 사이클에서 실행하지 않는다. 공지 3건 원고 본문은 재사용(채널 글 형식으로 조정 — 아래 확정 원고).
> 실측 대상: 프로덕션 `maidol-ec2:/home/ubuntu/maidol/backend_9004`(읽기 전용 접근), 앱 `2_housing/`. 이하 파일:라인은 프로덕션 서버 파일 기준.

### Plan verification findings (파일:라인 실측)

**F1. '공지' 채널의 실체 = feeds kind=community (별도 채널·카테고리 없음)**
- routes/feeds.py:30 `FEED_KINDS = ("feed", "community")  # v133: community = 채널 공지 글 (텍스트만)`. 별도 공지 채널/보드 없음 — **채널 = 유저 채널**(UserChannel), 공지 글 = 그 유저의 kind=community 피드 문서(mongo `feeds`).
- 작성 API: `POST /api/feeds/`(feeds.py:308) — `get_current_user` 인증, author=본인 고정(작성자 위임 파라미터 없음). community 검증(feeds.py:104~175): 텍스트 블록만(track/image 400), title 무시·null 저장, blocks 1~50, 본문 합계 ≤10,000자.
- 조회 API: `GET /api/feeds/user/{user_id}?kind=community`(feeds.py:363~) — `get_current_user_optional`(익명 열람 가능), 공개 글은 전 유저 열람, created_at DESC.
- 타임라인: `GET /api/feeds/timeline`(feeds.py:439~) — 공개 글 최신 200건 후보, **팔로잉 작성자 글 +1000 부스트**(feeds.py:38 TIMELINE_FOLLOWING_BOOST). 전 유저가 official을 팔로우하므로 official 공지는 전 유저 피드 탭 최상단 블록에 노출(신규 팔로잉 글이 쌓이면 recency로 자연 하강, 고정(pin) 기능은 없음).
- 알림 팬아웃(v192): 공개 글 생성 시 팔로워 전원에게 인앱 알림 insert(feeds.py:344~356 → routes/notifications.py:60~79 push_notifications_bulk, mongo `notifications`, **OS 푸시 아님**).
- official 계정: services/official.py — `settings.official_account_email`로 users 단일 시드(role=admin), 비밀번호는 빈값이면 랜덤 시크릿 해시(official.py:36~39) → **로그인 불가(의도된 설계)**. **프로덕션 실측**: official id `56fea014…`, nickname `maidol_official`, role admin. official 명의 피드/공지 글 **0건**(전체 community 글은 1건 — 무신사 비즈 계정, 2026-08-31). 공지용 채널은 "이미 존재"하나(= official 유저 채널의 커뮤니티 탭) 글이 없는 상태.

**F2. "사용자 디폴트 팔로우" — 사용자 가정과 코드 일치(실재)**
- 가입 시 자동 맞팔: routes/auth.py:291, routes/oauth.py:212 → `ensure_mutual_follow`(services/official.py:110~149, user↔official 양방향 멱등 INSERT).
- 기존 유저 백필: main.py:643~680 — startup마다 전 유저↔official 양방향 맞팔 멱등 백필(별도 백필 스크립트 불필요).
- 언팔 가드: routes/follows.py:114~118 — official 언팔로우 403 차단.
- **프로덕션 실측**: users 216명, official 팔로워 215명(전원 — official 자신 제외). → 조정안 불필요, 그대로 활용 가능.

**F3. 앱 측 노출 경로 (2_housing)**
- UserChannelScreen.tsx: '커뮤니티' 탭(:231~232)이 `GET /feeds/user/{id}?kind=community`(:62,:84)를 렌더(:395~398, 빈 상태 "아직 커뮤니티 글이 없어요"). 작성 버튼은 `isSelf`만 노출(:376~390 '새 공지 작성') — 타 유저에겐 읽기 전용.
- UserChannel 진입 경로: FeedScreen.tsx:229(타임라인 작성자 탭)·FeedDetailScreen.tsx:208·AlbumDetailScreen.tsx:368·PlayerScreen.tsx:1034·NotificationsScreen.tsx:102(follow 알림 한정). **공지 전용 진입 메뉴는 없음** — 설정 등에서 official 채널로 바로 가는 길이 없다.
- 눈에 띄는 표시: components/feed/FeedCard.tsx에 kind 구분 배지 **없음** — 타임라인에서 공지 글이 일반 피드와 시각적으로 동일. 고정/상단핀 기능 없음.
- 알림: ntype=feed 라벨 "…님이 새 피드를 올렸어요"(NotificationsScreen.tsx:30), 탭 시 피드 탭 이동(:108) — 공지 열람 유도 동작으로 자연 성립.
- official_id 해석 API: `GET /dm/official`(routes/dm.py:109~122) → `{official_id, nickname}` 반환(로그인 유저 누구나) — 앱에서 official 채널 네비게이션에 그대로 사용 가능.
- → **앱 수정 필요(소규모 2건)**: 공지 구분 배지 + 공지 진입 메뉴(아래 확정 스펙 B). 없이도 공지는 노출되지만(타임라인 부스트+알림) "공지사항을 채널에서 확인"하는 명시적 동선이 없다.

**F4. 등록 수단 확정**
- `POST /api/feeds/`는 official JWT 필요 — official 비밀번호는 랜덤 시크릿(로그인 불가), 관리자 크리덴셜 사용 불가 전제 → API 경로 불가.
- **확정: 컨테이너 python 직접 실행**(`ssh maidol-ec2` → `sudo docker exec -i maidol-app python`, python 3.11) — create_feed 핸들러(feeds.py:308~360)의 doc 형상을 그대로 재현해 mongo `feeds` insert + v192 알림 팬아웃(`app.routes.notifications.push_notifications_bulk` 재사용). DB 접속은 컨테이너 내 `settings.computed_mongo_url`(config.py:254~257)·postgres_* 설정 재사용(크리덴셜 하드코딩·출력 금지).
- doc 형상(feeds.py:322~337 그대로): `{author_id: <official_id str>, author_nickname: "maidol_official", kind: "community", title: None, blocks: [{"type":"text","text": <원고>}], bgm_track_id: None, like_count: 0, comment_count: 0, is_public: True, created_at/updated_at: utcnow}`.
- **삭제 가능 실측**: `DELETE /api/feeds/{feed_id}`(feeds.py:683~697, author-only, purge_feed_document로 댓글·좋아요 연쇄 정리) 존재 — 컨테이너 python으로 동일 purge 호출 가능. → **글 게시는 삭제로 회수 가능(엄밀한 비가역 아님)**. 단 팬아웃된 알림 문서는 별도 회수 필요(`notifications.delete_many({"target_id": feed_id})`), 이미 열람된 알림·타임라인 노출은 되돌릴 수 없음.

**F5. 영향 지점·회귀 위험**
- DM/CS 흐름 무변경: admin_cs.py broadcast·dm_service·notice_service는 이번에 호출하지 않을 뿐 코드 폐기 아님(운영 도구로 존치). 설정→문의하기(startCsInquiry) 경로 무영향.
- 타임라인: 공지 3건이 전 유저 피드 탭 최상단 3장을 당분간 점유(+1000 부스트, 현재 전체 피드 5건뿐이라 체감 큼) — 사용자 의도("채널에서 확인")에 부합하나 피드 첫인상 변화는 인지 필요.
- 알림: 유저당 인앱 알림 3건 적재(215명×3=645 문서, OS 푸시 아님 — 스팸성 낮음).
- 앱 수정 2건은 신규 UI 추가로 기존 화면 로직 비파괴(배지=표시 전용, 설정 행=신규 항목).

### 확정 스펙

**A. 데이터 작업 — 공지 3건을 official 채널 community 글로 등록 (notice-ops, 프로덕션 mongo 쓰기)**
1. 컨테이너 python 스크립트(scratchpad 전용, 커밋 금지): official_id를 `settings.official_account_email`로 SELECT → 공지 3건을 **3→2→1 순서**(커뮤니티 탭 created_at DESC — "문의 방법 안내"가 최상단), 건당 30초 이상 간격으로 feeds insert + `push_notifications_bulk(ntype="feed", actor_id=official_id, actor_nickname="maidol_official", target_id=feed_id, preview=본문 1행)` 팬아웃.
2. 본 등록 전 **리허설 1건**: 테스트 본문("MAIDOL 공지 채널 점검 글입니다.")을 insert(팬아웃 없이) → 앱/API로 노출 확인 → purge_feed_document로 삭제 — 등록·삭제 경로를 실데이터로 검증한 뒤 본 공지 진행.
3. 원고는 아래 확정본을 diff 0으로 사용(이모지 금지·MAIDOL 표기·저작권 단정 금지). community는 title이 없으므로 본문 1행을 제목 라인으로 사용.
4. sent/failed(팬아웃 insert 건수) 집계를 로그로 남기고 feed_id 3건을 TESTPLAN에 전달. 크리덴셜·토큰 출력 금지.

**공지 원고 3건 — 채널 글 버전(본문 1행 = 제목 라인, 이하 본문. DM판 대비 조정: 호칭 도입부 유지, FAQ는 줄바꿈 목록화)**

- **공지 1 — 등록 순서 3번째(최상단)**:
"[MAIDOL 공지] 문의 방법 안내
안녕하세요, MAIDOL 팀입니다. 이용 중 불편이나 오류가 있다면 언제든 알려주세요.
문의 방법: 설정 화면에서 '문의하기(오류 신고)'를 누르고 사유를 선택하면 MAIDOL 공식 계정과의 1:1 대화가 열립니다. 문제 상황(어떤 화면에서, 어떤 동작을 했을 때, 어떤 메시지가 떴는지)을 남겨 주시면 확인 후 답변드립니다.
감사합니다."

- **공지 2 — 등록 순서 2번째**:
"[MAIDOL 공지] 자주 묻는 질문(FAQ)
MAIDOL 자주 묻는 질문을 안내드립니다.
Q. 별은 무엇인가요?
별은 MAIDOL의 활동 재화입니다. 곡 만들기, 커버 이미지 생성 등 일부 기능에 사용되며, 보유량은 마이페이지에서 확인할 수 있습니다.
Q. 곡 생성은 얼마나 걸리나요?
보통 수 분 이내에 완성됩니다. 이용이 몰리는 시간에는 조금 더 걸릴 수 있으며, 생성 중에는 앱을 닫아도 서버에서 계속 진행됩니다.
Q. 내 목소리(보이스 클론)는 언제까지 쓸 수 있나요?
생성된 보이스는 약 2~6시간 동안 유지된 뒤 만료됩니다. 만료된 보이스는 다시 생성해야 하며, 만료로 인한 별 환불은 없습니다. 생성 자체가 실패한 경우에만 사용한 별이 환불됩니다.
Q. 가사 없는 연주곡도 만들 수 있나요?
네. 곡 만들기에서 연주곡을 선택하면 가사 없이 원하는 길이의 연주곡을 만들 수 있습니다.
Q. 내가 만든 곡의 창작 기록은 어떻게 남나요?
MAIDOL은 곡 생성 과정의 대화와 선택 내역을 창작 기록으로 보관해 확인할 수 있도록 제공합니다. 이는 창작 과정을 증빙하는 데 참고할 수 있는 자료이며, 법적 저작권 등록이나 권리 보장을 의미하지는 않습니다."

- **공지 3 — 등록 순서 1번째(최하단)**:
"[MAIDOL 공지] 베타 테스트 안내
MAIDOL 베타 테스트에 참여해 주셔서 감사합니다. 현재 MAIDOL은 베타 기간으로, 기능이 수시로 추가되고 개선됩니다.
이용 중 오류를 만나시면 설정의 '문의하기(오류 신고)'로 알려주세요. 보내주신 의견은 하나씩 확인해 반영하고 있습니다.
베타 기간에는 일부 기능의 동작과 정책(별 사용량 등)이 예고 후 변경될 수 있습니다. 더 나은 MAIDOL로 보답하겠습니다."

(DM판과의 차이: 공지 1에서 "이 대화방에 바로 답장을 보내셔도 접수됩니다." 문장 제거 — 채널 글에는 해당 없음. 그 외 본문 동일.)

**B. 앱 작업 (app-dev, JS만 — EAS 재빌드 불필요)**
1. **FeedCard 공지 배지**: components/feed/FeedCard.tsx — `feed.kind === 'community'`일 때 카드 헤더에 '공지' 텍스트 배지(액센트 보더 칩, 이모지·아이콘 추가 없음). 타임라인·채널·마이페이지 공통 적용(표시 전용, 기존 레이아웃 비파괴).
2. **설정 '공지사항' 진입**: screens/SettingsScreen.tsx — '문의하기(오류 신고)' 행(:630) 위에 '공지사항' 행 추가 → `GET /dm/official`로 official_id 해석 → `navigation.navigate('UserChannel', { authorId: official_id, name: 'maidol_official', initialTab: 'community' })`. 실패 시 showAlert(시스템 Alert 금지).
3. **UserChannel initialTab 파라미터**: App.tsx:145 RootStack 파라미터 타입에 `initialTab?: 'music'|'artists'|'feed'|'community'` 추가, UserChannelScreen.tsx:38,46에서 `useState<Tab>(route.params?.initialTab ?? 'music')` — 기존 진입(파라미터 없음)은 동작 불변.

**서버 작업: 없음(파일 무수정·무배포·무재기동).**

### 변경 매트릭스
| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| components/feed/FeedCard.tsx | kind=community '공지' 배지 | app-dev | — (표시 전용) |
| screens/SettingsScreen.tsx | '공지사항' 행 → official UserChannel 커뮤니티 탭 | app-dev | `[Settings] 공지사항 진입` |
| screens/UserChannelScreen.tsx · App.tsx | UserChannel `initialTab` 파라미터 | app-dev | `[UserChannel]` 기존 유지 |
| (서버 파일 변경 없음) | 컨테이너 python으로 공지 3건 community 글 insert + 인앱 알림 팬아웃 | notice-ops | 서버 `[feed]`/`[notify]` |

### 실행 순서·비가역/프로덕션 쓰기 지점
1. app-dev: B-1~3 구현·커밋(frontend 브랜치 관행) — 데이터 작업과 독립(병렬 가능).
2. notice-ops: 원고 diff 0 검수 → **리허설 글 1건 등록·삭제**(프로덕션 쓰기이나 즉시 회수) → **사용자 최종 go 확인 후** 본 공지 3건 등록+팬아웃.
3. **프로덕션 쓰기 지점(계획 단계에서는 미실행)**: (a) feeds insert 3건 (b) notifications insert 645건(215명×3). **회수 절차 실측 완료**: 글은 purge_feed_document로 삭제 가능, 알림은 target_id delete_many — 단 유저가 이미 본 노출은 회수 불가이므로 "사실상 발행 행위"로 취급, 본 등록 전 사용자 go 필수.
4. tester: 아래 항목 검증 → PASS 시 커밋·기록.

### test-designer 테스트 항목 (기존 TESTPLAN A-1/A-2의 DM 수신 검증은 **폐기** — DM 브로드캐스트 미실행)
1. **등록 검증(API)**: `GET /api/feeds/user/{official_id}?kind=community` → 정확히 3건, 순서 최상단부터 [문의 방법 안내 / FAQ / 베타 안내], 본문 PLAN 원고 diff 0, kind=community·title null·is_public true, 이모지·'AIDOL' 문자열 0. 리허설 글 잔존 0.
2. **채널 노출(앱)**: 일반 테스트 계정 → 설정 '공지사항' 탭 → official UserChannel 커뮤니티 탭 직행, 3건 노출 + '공지' 배지. 타 유저 채널·본인 채널(isSelf 작성 버튼) 회귀 0. initialTab 미지정 진입(타임라인 작성자 탭)은 기존 music 탭 시작 불변.
3. **타임라인**: 일반 계정 피드 탭 최상단 블록에 공지 3건 노출(+팔로잉 부스트), FeedCard '공지' 배지, 작성자 탭 → official 채널 진입.
4. **알림**: 일반 계정 알림함에 "maidol_official님이 새 피드를 올렸어요" 3건, 탭 시 피드 탭 이동. 팬아웃 건수 로그(645±: official 제외 계산) 일치.
5. **회귀**: 설정→문의하기(오류 신고)→official DM 흐름 무변경(①번 항목 테스트와 교차), 기존 community 글(무신사) 표시 회귀 0, FeedCompose 일반 유저 공지 작성 회귀 0, 피드 좋아요/댓글 정상.

### 사용자 결정 필요 사안
- **본 공지 3건 등록 실행 go**(프로덕션 쓰기 — 리허설 후 최종 확인).
- 알림 팬아웃 포함 여부(기본안: 포함 — 표준 create_feed 동작 재현, 인앱 알림뿐이라 부담 낮음. 제외 시 유저가 공지 등록을 인지할 채널이 타임라인뿐).
- (후속 후보) 공지 고정(pin)·공지 전용 화면·커뮤니티 탭 라벨 '공지' 변경은 이번 범위 외 — 필요 시 차기 사이클.

---

## v3.206 (2026-09-22) — 아티스트 꾸미기 카테고리 개편(악세서리·잠금)·모자/가방 착용 방식 커스텀

> 사용자 원문: "아티스트 꾸미기에서 상의, 하의, 신발 선택하잖아. 모자, 가방도 곧 DB에 데이터가 쌓일텐데. 지금 카테고리가 상의, 하의, 신발, 악세서리(모자, 가방) 이렇게 해주고. 나머지 카테고리는 잠금 아이콘(이모지 아님)으로 처리해줄래? 모자는 바로 쓰기, 거꾸로 쓰기 등으로 커스텀 가능하게 하고, 가방은 손에 들기, 크로스로 메기, 어깨에 메기로 커스텀 가능하게 해주면 될것 같은데."
> 실측 대상: 앱 `2_housing/`, 프로덕션 `maidol-ec2:/home/ubuntu/maidol/backend_9004`(읽기 전용), 프로덕션 API `https://api.maidol.ai.kr`(무인증 실측). **이번 사이클 서버 무수정·무배포·무재기동.**

### Plan verification findings (파일:라인·프로덕션 실측)

**F1. 앱 현재 카테고리 구조 (screens/ArtistCodyScreen.tsx)**
- 카테고리 8종 고정: `type Cat = '상의'|'하의'|'신발'|'헤어스타일'|'헤어컬러'|'악세서리'|'안경'|'문신'` (:32-33). 렌더는 2열 그리드 카드(`styles.catCard`, width 48%, :668-690) — 칩/탭 아님. 탭 시 `openPicker(cat)` 모달, 꾹 누르면 선택 해제. Cat 타입은 이 파일 로컬(외부 미참조 — AppliedItem.cat은 free string).
- 선택 모델: **카테고리당 단일 선택** `selected: Partial<Record<Cat, AdItem>>` (:199).
- 세부 옵션: `CAT_OPTIONS`(:37-49, 상의 핏/길이·하의 핏/기장·신발 양말)가 '세부 옵션' 박스(:692-729)를 데이터 주도로 렌더 → `fmt()`(:351-358)가 `상의="AURA 흰 티 (핏:슬림)"` 형태로 프롬프트에 자동 직렬화. **옵션 그룹만 추가하면 UI·프롬프트 모두 자동 반영되는 구조.**
- v3.205 성별 자동 필터: `GENDER_FILTER_CATS = ['상의','하의','신발']`(:95) 한정, `genderMatches`(:75-81, 공용·미지정은 양쪽 통과), 3단 폴백(:228-231). 피커 내 토글 칩(:845-855).
- 5단계 드릴다운(:582-645): 플랫폼›브랜드›성별›제품›색상 — baseItems(성별 필터 후) 기준 파생.
- 위시리스트 탭(:647-654): `wishItemsAll.filter(it => it.category === pickerCat)` — **item.category 문자열 동치 비교**.
- SAMPLE 폴백: `SAMPLE_ITEMS`(:99-156) 카테고리당 5개 더미. openPicker에서 서버 0건 또는 **요청 실패(catch) 시 폴백**(:252, :257-258). 악세서리 샘플은 현재 귀걸이·목걸이·팔찌 등 장신구 5종(:135-141) — 모자·가방 없음.

**F2. 서버 카테고리 체계·프로덕션 실데이터**
- `ALLOWED_AD_CATEGORIES = {"상의", "하의", "신발", "장소"}` (프로덕션 routes/business.py:30). **'모자'·'가방'·'악세서리' 모두 비허용**: 아이템 등록(:174)·수정(:257)·`GET /business/ads/active?category=`(:416-419) 전부 400. CSV 임포트도 동일 상수로 검증(admin_items.py:33 import, :138 — '부위' 열이 category가 되며 비허용 값은 행 단위 에러) → **서버 1줄 수정 없이는 모자/가방 실데이터 적재 자체가 불가**.
- 프로덕션 실측(GET /api/business/ads/active 무인증): **총 455건 = 상의 157(남69/여87/공용1)·하의 145(남74/여71)·신발 153(남65/여88). 모자·가방·악세서리 0건**(장소도 active 0). `?category=악세서리|모자|가방` → **400 실측 확인** → 앱은 catch로 SAMPLE 폴백. 즉 사용자 인식("아직 데이터 없음")과 일치하되, 정확히는 "없음"이 아니라 **적재 경로가 막혀 있음**.
- category 파라미터 없는 전체 조회는 정상 동작(455건) — wishlistStore.ts:107에 이미 "서버 category 필터는 상의/하의/신발/장소만 허용 → 전체 조회 후 클라이언트 필터" 관행 존재.

**F3. 꾸미기 적용 흐름 — 착용 방식 반영 경로: 앱 단독 가능(실측 판정)**
- 프롬프트는 **전량 앱이 조립**: handleApply(:312-532)가 1~4단계+최종점검 한국어 지시문(desc)을 문자열로 구성 → `taskStore.setInput({ outfitDesc: desc })` → ArtistLoadingScreen.tsx:366 `form.append('user_text', taskStore.outfitDesc)` → 서버 `/character/generate-sheet-async`(실사)·`-cartoon-async`(가상, use_saved_sheet)의 `user_text: str = Form("")`(프로덕션 character.py:742, :950)로 **그대로 통과**해 생성 프롬프트에 합성(:869, :1097). → **모자 바로/거꾸로, 가방 손·크로스·어깨는 CAT_OPTIONS 확장 + fmt() 자동 직렬화만으로 프롬프트에 실림. 서버 수정 불필요.**
- 참조 이미지 첨부는 **상의/하의/신발 3종 한정**: 앱 appendOutfitObjectNames(ArtistLoadingScreen.tsx:85-91, fieldByCat 3종) ↔ 서버 top/bottom/shoes_object_name(character.py:739-741, :947-949, :1295-1297). **모자/가방 제품 사진은 첨부 경로가 없어 텍스트 묘사로만 반영**(재현 정확도 하락 — 하단 결정 사안 ③).
- CLOTHING_CATS(:349) = [상의,하의,신발,안경,악세서리] — 2단계 "새 의상 적용" 블록 분류. 1단계 의상 제거 지시문(:394)은 이미 "모자/안경/악세서리" 언급. 미선택 기본형(:370-373)은 상의/하의/신발만(모자/가방 미선택 시 기본형 불필요 — 자연 무착용).

**F4. 잠금 UI — 아이콘 관행·잠금 기준**
- ArtistCodyScreen은 이미 `Feather`·`MaterialCommunityIcons` import(:16), Feather `lock` 사용 전례 있음(components/AttendanceModal.tsx:130 `<Feather name="lock" size={15} color={colors.text.muted} />`). → **잠금 = Feather "lock" 벡터 아이콘**(이모지 금지 충족).
- 잠금 기준 판정: **고정 목록**이 맞음. "실데이터 0건 자동 잠금"으로 하면 악세서리(현재 0건)도 잠기고, 서버 400(카테고리 비허용)과 0건을 구분해야 하는 등 사용자 의도와 어긋남. → `LOCKED_CATS = ['헤어스타일','헤어컬러','안경','문신']` 하드코딩(활성 4종: 상의·하의·신발·악세서리).

**F5. 영향·회귀 지점**
- 성별 필터: GENDER_FILTER_CATS 불변(상의/하의/신발) — 모자/가방은 gender 실데이터 0건이라 v3.205 원칙("데이터 실재 카테고리만 자동 필터") 그대로. genderMatches는 미지정→공용 통과라 추후 데이터 적재 시 확장만 하면 됨.
- 위시리스트: wish 탭 필터가 `category === pickerCat` 동치 — 악세서리 피커는 `['모자','가방']` 포함 비교로 바꿔야 함. 서버 위시 아이템의 category는 ad_items 원본값('모자'/'가방'으로 적재될 예정)이므로 정합.
- 드릴다운: baseItems 파생이라 악세서리 피커(모자/가방 서브탭)에도 그대로 동작 — 단 서브탭 필터를 baseItems 앞단에 적용.
- 기존 코디 저장분: AppliedItem.cat·used_items.category 모두 free string — 과거 '악세서리' cat으로 저장된 착장의 ArtistResult 표시는 무영향. selected 상태는 화면 세션 로컬이라 마이그레이션 불요.
- sheet 모드: 현재 부제 "옷·헤어를 골라주세요"(:663) + 4단계 헤어/문신 프롬프트 — 헤어 잠금 시 sheet 모드에서 헤어 선택 기능이 사라짐(현재도 샘플 더미만 노출되는 데모 기능이라 실손실 없음). 미선택 시 4단계는 "현재 시트 유지"/sheet 기본 처리로 안전(:447-455). 부제 문구 수정 필요.

### 사용자 사양 ↔ 코드 현실 충돌·갭
1. **'악세서리(모자, 가방)' 카테고리는 서버에 없음** — 서버 허용값은 상의/하의/신발/장소뿐. 조정안(확정): **앱 상위 카테고리 '악세서리' 아래 하위 구분 '모자'/'가방'**. 데이터(ad_items.category)는 '모자'·'가방'을 정식 값으로 하고(CSV '부위' 열과 자연 일치), 앱 악세서리 피커가 두 값을 묶어 보여준다. '악세서리'라는 category 값은 만들지 않음(장신구류가 추후 생기면 별도 논의).
2. **서버 category= 쿼리가 모자/가방에 400** — 앱 악세서리 피커는 category 파라미터 없이 전체 조회(현 455건, wishlistStore 관행) 후 클라이언트에서 `category ∈ {모자,가방}` 필터. 서버 1줄 수정(결정 사안 ①) 전에도 앱은 동작(0건 → 샘플 폴백), 수정·적재 후에는 코드 변경 없이 실데이터 자동 노출.
3. **카테고리당 단일 선택 구조 vs 모자+가방 동시 착용** — '악세서리' 단일 Cat으로 두면 모자와 가방을 동시에 못 고름. 조정안(확정): 내부 Cat을 '모자'·'가방'으로 분리(각각 단일 선택 = 동시 선택 가능), UI 그리드에는 '악세서리' 카드 1장으로 묶어 노출.
4. **모자/가방 참조 이미지 첨부 불가**(F3) — 텍스트 묘사만. 서버 필드 확장은 별도 승인 사안으로 이월.

### 확정 스펙 (앱 단독 — 서버 이번 사이클 무수정)

**A. 카테고리 그리드 개편 (ArtistCodyScreen.tsx)**
1. 내부 타입: `type Cat = '상의'|'하의'|'신발'|'모자'|'가방'` + 잠금 표시용 `LOCKED_CATS: string[] = ['헤어스타일','헤어컬러','안경','문신']`(선택 불가 — Cat에서 제외). CATEGORIES(활성 선택 슬롯)는 [상의,하의,신발,모자,가방].
2. 그리드 카드: 활성 4장(상의·하의·신발·**악세서리**) + 잠금 4장(헤어스타일·헤어컬러·안경·문신) 순. 악세서리 카드는 '모자'·'가방' 두 선택 슬롯의 요약을 함께 표시(예: 부제 "모자·가방 고르기" / 선택 시 "볼캡 · 크로스백"). 탭 → 악세서리 피커(B).
3. 잠금 카드: `<Feather name="lock" size={18} color={colors.text.muted} />` + 흐린 스타일(opacity/muted 보더), 부제 "준비 중". onPress → `showAlert('준비 중', '곧 열릴 카테고리예요.')`(1회성 안내, 시스템 Alert 금지 관행), onLongPress 무동작. 이모지 사용 금지.
4. sheet 모드 부제(:663) "옷·헤어를 골라주세요" → "옷·모자·가방을 골라주세요"로 수정.

**B. 악세서리 피커 — 하위 구분 모자|가방**
1. openPicker('악세서리 진입')은 **category 파라미터 없이** `GET /business/ads/active` 전체 조회 → `item.category ∈ {모자,가방}`만 보관. 상의/하의/신발 피커는 기존 category= 호출 불변.
2. 피커 상단(전체|위시리스트 탭 옆 또는 아래)에 하위 구분 세그먼트 **[모자 | 가방]**(기본 모자). 세그먼트가 baseItems 앞단 필터 → 드릴다운·패싯·기선택 정렬 로직 그대로 재사용. 선택(pickItem)은 현재 세그먼트의 Cat('모자' 또는 '가방') 슬롯에 저장 — 모자·가방 각 1개씩 동시 선택 가능.
3. 해당 서브카테고리 실데이터 0건 → SAMPLE 폴백: SAMPLE_ITEMS의 기존 악세서리(장신구 5종)를 **모자 5종·가방 5종으로 교체**(예: 볼캡/버킷햇/비니…, 크로스백/토트백/백팩… — 가상 브랜드 관행 유지). 위시 하트는 샘플에서 기존대로 숨김.
4. 위시리스트 탭 필터: 악세서리 피커에서는 `it.category ∈ {모자,가방}` + 현재 서브 세그먼트 일치로 필터.
5. 성별 필터 칩: 악세서리 피커 미노출(GENDER_FILTER_CATS 불변 — v3.205 원칙, 데이터 적재 후 확장).

**C. 착용 방식 커스텀 — 데이터 모델·프롬프트 반영**
1. CAT_OPTIONS 확장(기존 패턴 그대로):
   - `모자: [{ label: '착용 방식', values: ['바로 쓰기', '거꾸로 쓰기', '비스듬히 쓰기'] }]`
   - `가방: [{ label: '착용 방식', values: ['손에 들기', '크로스로 메기', '어깨에 메기'] }]`
   ('비스듬히 쓰기'는 사용자 원문 "등"의 최소 해석 1개 추가 — 반려 시 2개만.)
2. 저장 위치: 기존 `itemOptions[cat]`(화면 상태) → AppliedItem.options(:494)로 영속 — **신규 필드·서버 계약 변화 없음**. '세부 옵션' 박스가 CAT_OPTIONS 주도라 UI 자동 노출.
3. 프롬프트: fmt() 자동 직렬화로 `모자="BRAND 볼캡 (착용 방식:거꾸로 쓰기)"` 형태가 2단계 블록에 포함되도록 CLOTHING_CATS에 '모자','가방' 추가(:349, '악세서리' 제거). 추가로 모자/가방 선택 시 1줄 해석 지시를 desc에 합성: 예) `【착용 방식 해석】 '거꾸로 쓰기'=챙이 뒤로 가게(backwards), '크로스로 메기'=끈을 대각선으로 가로질러, '어깨에 메기'=한쪽 어깨에, '손에 들기'=손에 쥔 채로.` (미선택 시 프롬프트 불변 — v3.116 관행.)
4. 미선택 기본형(:370-373)에 모자/가방 **추가하지 않음**(미선택 = 무착용이 자연 기본). 참조 이미지 경고(:499)·appendOutfitObjectNames는 상의/하의/신발 한정 그대로(모자/가방은 의도된 텍스트 전용 — 결정 사안 ③ 전까지).

**서버 작업: 이번 사이클 없음.** (결정 사안 ① 승인 시 차기: business.py:30 `ALLOWED_AD_CATEGORIES`에 `"모자", "가방"` 추가 1줄 + 배포 — CSV 임포트·category 쿼리 개방. admin_items.py는 상수 import라 자동 추종.)

### 변경 매트릭스
| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| 2_housing/screens/ArtistCodyScreen.tsx | Cat 재정의(모자·가방)+LOCKED_CATS 잠금 카드(Feather lock)·악세서리 통합 카드·피커 서브탭·전체조회 필터·CAT_OPTIONS 착용 방식·CLOTHING_CATS/프롬프트 합성·SAMPLE 교체·위시탭 필터 | frontend-dev | `[ArtistCody]` (기존 접두 유지, 서브탭 전환 `[ArtistCody] accessory subcat` 신설) |
| (서버·기타 앱 파일 변경 없음 — ArtistLoadingScreen·stores 무수정) | — | — | — |

**40% 룰 판정**: 변경은 ArtistCodyScreen.tsx 1개 파일, 약 150~200라인(전체 1,340라인의 ~15%) — **부분 수정(패치)**, 재작성 불필요. 서버 0파일.

### test-designer 테스트 항목 (회귀 포함)
1. **그리드**: 활성 카드 4장(상의/하의/신발/악세서리) + 잠금 4장(헤어스타일/헤어컬러/안경/문신, Feather lock 아이콘 — 소스에 이모지 0). 잠금 탭 → '준비 중' 안내만, 피커 미오픈, 꾹 눌러도 무동작.
2. **악세서리 피커**: [모자|가방] 서브탭 노출·전환. 프로덕션 현 상태(모자/가방 0건)에서 category 파라미터 없는 전체 조회 후 0건 → 모자 샘플 5·가방 샘플 5 폴백(장신구 샘플 잔존 0). 샘플 위시 하트 숨김 유지. 성별 필터 칩 미노출.
3. **동시 선택**: 모자 1개 + 가방 1개 동시 선택 가능, 악세서리 카드·선택 요약 칩에 둘 다 표기, 개별 해제 가능.
4. **착용 방식**: 모자 선택 시 '착용 방식' 칩(바로/거꾸로/비스듬히), 가방 선택 시 (손/크로스/어깨) 노출·토글·재탭 해제. 프롬프트(desc, __DEV__ 로그)에 `모자="… (착용 방식:거꾸로 쓰기)"`·`가방="… (착용 방식:크로스로 메기)"`가 2단계 블록에 포함 + 【착용 방식 해석】 1줄. 옵션 미선택 시 해당 문구 불포함.
5. **프롬프트 회귀**: 모자/가방 미선택 시 desc가 기존과 동일(기본형 3종에 모자/가방 미추가, 4단계 헤어/문신 '현재 시트 유지' 불변). 하의 특별 지시·참조 이미지·로고 블록 불변.
6. **v3.205 회귀**: 상의/하의/신발 피커 — category= 호출 그대로(455건 실측 분포), 성별 자동 필터 칩·3단 폴백·0건 안내 불변. 5단계 드릴다운·기선택 정렬·판매처 링크 불변.
7. **위시리스트 회귀**: 상의 등 기존 카테고리 위시 탭 불변. 악세서리 피커 위시 탭은 category 모자/가방만 서브탭별 표시(현 0건 → 빈 안내).
8. **적용 플로우 회귀**: outfit 모드 최소 1개 선택 게이트·피로도 게이트·별 사전 체크 → ArtistLoading 직행, appendOutfitObjectNames는 여전히 top/bottom/shoes 3필드만 전송(서버 계약 불변). sheet 모드 부제 문구 변경 확인. 기존 저장 착장(cat '악세서리' 포함)의 ArtistResult 표시 회귀 0.

### 사용자 결정 필요 사안
1. **[서버 1줄 — 별도 승인] business.py:30 ALLOWED_AD_CATEGORIES에 "모자","가방" 추가 + 배포**: 이것 없이는 admin CSV 임포트가 모자/가방 행을 전부 거부해 "곧 DB에 데이터가 쌓일" 경로 자체가 막혀 있음(프로덕션 실측). 앱은 선반영해도 무해(0건 → 샘플).
2. **헤어스타일·헤어컬러 잠금 확인**: sheet(신규 생성) 모드에서 헤어 고르기가 사라짐 — 현재도 실데이터 0건·샘플 데모지만, 의도 확인 요망(기본안: 사용자 원문대로 잠금).
3. **(차기 후보) 모자/가방 참조 이미지 첨부 필드(hat/bag_object_name) 서버 확장**: 현재는 텍스트 묘사만이라 실데이터 적재 후 제품 재현 정확도가 상의/하의/신발 대비 낮음.
4. 모자 착용 방식 '비스듬히 쓰기' 1개 추가 여부(원문 "등" 해석 — 반려 시 바로/거꾸로 2개만).


---

## v3.207 (2026-09-22) — 실기기 피드백 12건: 튜토리얼 개편(코치마크·최초1회·ⓘ제거)·차트 신곡 포커스·키보드 가림 근본 전환·신고 이미지 첨부·비밀번호 재설정·데이터 정리(테스트 글·official DM) + APK/AAB

> 작성: planner(팀 리드). 사용자 요청 2개 메시지 12항목: ① 튜토리얼 코치마크(화살표/대상 표시) ② 차트 신곡 포커스 ③ official 외 "테스트" 글 삭제 ④ official→개인 DM 삭제 ⑤ 신고 input·담기 시트 키보드 가림(재발) ⑥ 신고 이미지 첨부 ⑦ 아이디·비밀번호 찾기 ⑧ 작곡 보컬선택에서 연주곡 제거 ⑨ 작사 듀엣 메인/서브보컬 질문 확인 ⑩ 성별 필터 미발견 ⑪ 튜토리얼 완전 최초 접속자 한정 ⑫ 작업실 ⓘ 제거. 마감: APK + AAB 빌드(배포용).
> 소스오브트루스: 앱 `/Users/pearl/TripleJ/2_housing/`(frontend 브랜치), 서버 프로덕션 `maidol-ec2:/home/ubuntu/maidol/backend_9004`(**이번 사이클 분석은 읽기 전용 — 서버 코드 수정·배포·데이터 삭제 실행은 오케스트레이터가 사용자 최종 확인 후 별도 수행**), 프로덕션 DB(mongo aimu·pg) 실측 완료.

### Plan verification findings (파일:라인·프로덕션 실측)

**F1. ①⑪⑫ 튜토리얼 시스템 (components/TutorialOverlay.tsx 187줄, v3.204 신설)**
- 현재 구조: `TutorialStep = {title, desc}` 텍스트 전용(:15-18) — **anchor/좌표/measure 코드 0건**, 헤더 주석 :2에 "스포트라이트/요소 측정 없음" 명시. 렌더 = 전체 균일 딤(rgba 0,0,0,0.6, :141-145) + 하단 카드 캐러셀(:104,146-154). 화살표·하이라이트 없음 → 사용자 지적("점 세 개 위치를 가리키는 표시가 있어야 이해")과 정확히 일치.
- 노출 조건: AsyncStorage `maidol_tutorial_seen_v1:{player|chart|feed|playlist|search|map}` **화면별 1회**(:31,:53,:73). 앱 전체 1회 아님. 전용 store/유틸 없음 — 로직 전부 이 파일 안.
- "점 세 개" 문구 실체: ChartScreen.tsx:30 "더보기(⋮) 버튼으로 재생목록이나…", SearchScreen.tsx:25 "더보기(⋮)로 담을 수도" — 대상 버튼은 공용 components/TrackRow.tsx:82-86(행 우측 끝 Feather more-vertical, 리스트 아이템 내부). 피드 카드 가로 ⋯ 는 별개(components/feed/FeedCard.tsx:283).
- ⑫ 작업실 ⓘ: 작업실 = MapScreen(App.tsx:373 tabBarLabel). ⓘ 버튼 = MapScreen.tsx:292-300(헤더 기획사명 우측, 로그인 시만, `tutorialRef.current?.show()`). **전 앱에서 유일한 튜토리얼 재보기 수단이며 그마저 map 4스텝만 재생** — 제거 시 재보기 소멸이지만 ⑪(최초 1회 한정)과 방향 일치, 사용자가 명시 요청 → 제거 확정.
- ⑪ 기존 유저 판별 실측: 최초 실행 판정 로직 전무(SplashScreen 순수 애니메이션, App.tsx:504-513 restoreSession만). launch count/install id/expo-application 없음. 직접 키 2종(`auth-token-v1` — 로그아웃 시 삭제되어 단독 부적합, `maidol_tutorial_seen_v1:*`) + zustand persist 12종(`player-storage-v1`은 **비회원 재생만 해도 생성**, guestNoticeAck 포함). → **진짜 신규 설치만 AsyncStorage가 완전히 비어 있음** = getAllKeys() 기반 판별이 유일하게 신뢰 가능.

**F2. ② 차트 (screens/ChartScreen.tsx 457줄) — 앱 단독 변경으로 충분**
- 탭 6종 TABS(:51-61): top100/일간/주간/월간/**신곡**/내 재생목록. 기본 탭 `useState<ChartTab>('top100')`(:74) — 한 줄 스위치. **신곡 탭 이미 존재**: `/tracks/?sort=created_at&limit=100`(:59, 서버 지원 확인) + NEW 뱃지(:221-222) + 최신 앨범 가로 섹션(:259-285, `/albums/latest`).
- 기본 탭 'new' 전환 시 연쇄: :129(포커스 시 앨범 로드), :138(리프레시), :96(폴백 endpoint), 튜토리얼 문구 :27-31, 빈 상태 :312-314. 서버 무수정.

**F3. ③ 테스트 글 — 프로덕션 mongo aimu.feeds 실측 (전체 8건)**
- official 계정 = users `56fea014-…`(nickname maidol_official). 삭제 후보 = official 아닌 작성자 + "테스트" 포함 **4건**(하단 '데이터 삭제 후보 목록' 참조). 보존: official 공지 3건(v3.205 등록분) + lovvepearl "펄킴 신곡…" 1건. 삭제 수단: feeds.py:631 `purge_feed_document`(피드+댓글+likes+알림+MinIO 이미지 일괄 파기) 재사용 — mongo 직접 delete 금지.

**F4. ④ official DM — 프로덕션 실측: 대화 143개, official 발신 1,111건 전수 테스트 산출물**
- 스키마: dm_conversations(pair_key unique, participants, unread, last_message_text/last_at, status) + dm_messages(conversation_id, sender_id, text, read, notice_id?) — dm_service.py:14-16.
- official 발신 1,111건 분류: notice_id 브로드캐스트 825건("공지테스트1/2", "공지발송테스트3/4", "발송테스트5", "전체공지테스트7") + 무notice 브로드캐스트 262건("전체발송 테스트1" 132, "공지테스트" 119, "고객사 전체공지 테스트" 11) + v174/v177/v194/v195 E2E 지정발송·회귀 답장 등 24건(그중 "[공식답변] 문의 감사합니다…" 1건, "안녕하세요, MAIDOL 고객센터입니다. E2E 테스트 답장…" 1건 — **모두 테스트 픽스처, 실제 고객 응대 아님**). → **전량 삭제 안전 판정**.
- 상대(개인) 발신 21건("[CS테스트]…", "[오류신고: 재생 오류]…" 등) — official 발신이 아니므로 **보존**(사용자 원문 범위 밖).
- 부작용 처리: official 메시지 삭제 후 (a) 잔존 메시지 0건 대화 → 대화 도큐먼트도 삭제(pair_key upsert 구조라 문의하기 재진입 시 자동 재생성 — dm_service.py:347-382 실측), (b) 잔존 있는 대화 → last_message_text/last_at 재계산 + unread 리셋. admin_notices 원본 레코드는 대상 아님(사용자 원문 = DM만).

**F5. ⑤ 키보드 가림 — 오늘 빌드 APK에서도 재현 확정(오케스트레이터 전달). 두 세대 훅 모두 실패 → 근본 전환 판정**
- 현황: DmChatScreen.tsx:40+:226 `useKeyboardOverlapLift`(marginBottom 실측 겹침 리프트, v3.205) / Modal 5종(PlaylistPickerSheet:32, ReportModal:43, AppealModal, AnswerEditModal, AlbumCreateModal) `useAndroidKeyboardLift`(kbHeight−insets.bottom, v3.201). app.json: `edgeToEdgeEnabled: true` + `softwareKeyboardLayoutMode: "resize"` + `newArchEnabled: true`. expo ~54.0.37 / RN 0.81.5.
- 실패 인과(원리 재검토): (1) SDK 54는 Android edge-to-edge **상시 강제**(targetSdk 35) — opt-out 불가, `softwareKeyboardLayoutMode:"resize"`는 edge-to-edge에서 창 실리사이즈를 보장하지 못함(Android 15에서 adjustResize의 창 축소가 동작하지 않는 플랫폼 변경, v3.205 F에서 이미 확인). (2) 두 훅 모두 **RN `Keyboard` 이벤트에 전적으로 의존** — RN Android의 keyboardDidShow는 역사적으로 창 레이아웃 변화 감지 기반이라, 창이 리사이즈되지 않는 edge-to-edge 기기에서 **미발화 또는 endCoordinates 좌표계 불일치**(Fabric+edge-to-edge 조합 보고 다수)가 발생하면 lift가 0으로 남는다 — "리프트 로직은 있는데 안 올라간다"는 실기기 증상과 정합. (3) Modal 5종은 별도 window라 root 리사이즈 경로 밖 + 동일한 Keyboard 이벤트 의존 → 같은 뿌리로 동반 실패. 즉 **JS 측 Keyboard 이벤트 기반 수동 보정은 이 기기 계열에서 구조적으로 신뢰 불가** — 3번째 미세수정 시도는 금지.
- 근본 전환 후보 비교: (a) **react-native-keyboard-controller 도입 — 채택**: 네이티브 WindowInsetsAnimationCompat로 IME 지오메트리를 창 리사이즈 여부와 무관하게 직접 수신(RN Keyboard 이벤트 미의존 — 위 실패 인과 자체를 우회), Fabric/new arch 지원, RN Modal 내부 동작, expo autolinking(설정 플러그인 불요) — **네이티브 모듈이라 새 빌드 필수인데 이번 사이클이 APK/AAB 빌드 사이클이라 타이밍 정합**. (b) softwareKeyboardLayoutMode/edgeToEdge 조합 정리 — SDK 54에서 edge-to-edge opt-out 불가라 성립 안 함(기각). (c) 기존 훅 3차 수정 — 동일 이벤트 의존이라 재발 인과 미해소(기각).
- 검증 가능성: 실기기(문제 기기) + API 34 에뮬 이중 확인을 테스트 항목에 명시. keyboard-controller는 `KeyboardProvider` 루트 래핑 필요(App.tsx).

**F6. ⑥ 신고 이미지 첨부 — "신고" = CS 오류신고 DM 확정, 서버 확장 필요**
- 신고 동선: SettingsScreen.tsx:361-392 — 사유 선택 → `/dm/official` → DmChat 프리필 "[오류신고: 사유] "(자동전송 X). ReportModal(콘텐츠 신고, POST /reports/)과 별개 — 키보드 가림·이미지 첨부 대상은 DmChat.
- 서버 실측: dm.py SendMessageBody = `{text}` 뿐(:100-101), dm_service.send_message(:493-537) text 전용(1~2000자) — **이미지 미지원**. 재사용 인프라: upload.py:720 `/upload/feed-image`(jpg/png/webp ≤15MB, 재인코딩, MinIO images 버킷) + media_urls.browser_image_url(:136) + feeds.py v3.111 image 블록 검증 관행(본인 prefix + MinIO 실존).
- 앱 실측: FeedComposeScreen.tsx:159 첨부 관행 = **DocumentPicker image/*** (expo-image-picker 미설치 — :179 주석) → POST /upload/feed-image → object_name. DmChatScreen 말풍선 렌더 :146(텍스트 전용, 280줄).

**F7. ⑦ 비밀번호 재설정 — 서버 엔드포인트·메일 인프라 모두 부재(실측)**
- 서버 auth.py 실측: password 관련 라우트 0건(login :324, register :144, me, consents, guardian-consent, profile-image 등뿐). **메일 발송 코드 전무** — requirements에 boto3 있으나 얼굴인증(Rekognition) 전용(.env `AWS_FACE_*` 키만), SMTP/SES/sendgrid 0건. 보호자 동의도 mock consent_url 반환 방식.
- 소셜 계정 판별 근거 서버에 존재: users.password_hash **NULL = 소셜 전용 계정**(auth.py:341 로그인 시 `not row["password_hash"]` 거부, :1014 NULL 세팅) → 재설정 요청 시 "소셜 가입 계정" 분기 가능. 앱 AuthUser에는 provider/has_password 필드 없음(stores/authStore.ts:6-21).
- 앱 실측: 로그인 = SettingsScreen 비로그인 분기의 AuthPanel(components/auth/AuthPanel.tsx 510줄, mode='login'|'gate'|'form'|'blocked'|'pending') — **비밀번호/아이디 찾기 링크 0건**(:275-280 footer는 회원가입만). 로그인 후 "비밀번호 변경" 메뉴도 더미(SettingsScreen.tsx:525-531 "준비 중"). 아이디 = 이메일(login body {email,password}) → **"아이디 찾기"는 별도 화면 불요, 안내 문구로 갈음**.

**F8. ⑧ 작곡 보컬선택 연주곡 (screens/MusicGenerationScreen.tsx 2,495줄)**
- step 3 선택지 = `[...VOCAL_OPTIONS, INSTRUMENTAL_OPTION]` → 남성/여성/**Instrumental (연주곡)**(:49,:1286) + 편집 모달 case 3(:450)에도 동일 노출.
- 연주곡 별도 진입점 생존 확인: ComposeLyricsPickScreen.tsx:279-288 "가사 없이 만들기 (연주곡)" 카드(상시 노출) → setInstrumental(true)(:238). **보컬 선택지에서 빼도 연주곡 기능 접근 유지**. v3.203 5문항 한정 체인(300→301→310→5→10→13)은 전부 `musicStore.instrumental` 플래그 기준이라 무영향.
- 단 소멸하는 서브 유스케이스: "이미 쓴 가사를 유지한 채 무보컬 버전"(step 3 경로만 가사 보존 — instrumentalEntryRef :158-160, proceedGenerate :1155) → 사용자 결정 사안 ④.
- 동반 수정 필수: :1286 렌더 배열, :450 편집 모달(누락 시 재선택 모달로 우회 진입 잔존), :49 상수. :926-931 연주곡 해제 방어 분기는 유지(되감기 유입 가드). VOCAL_OPTIONS(:45)는 타 화면 공유라 불변.

**F9. ⑨ 작사 듀엣 — 판정: 작사 디렉터에는 메인/서브보컬 질문 없음, 작곡 디렉터에 있음(정상 동작)**
- 작사(LyricsInputScreen.tsx): step 2 "혼자 부르는 곡인가요, 둘이…"(:63-66, DUET_OPTIONS=솔로/듀엣) → isDuet 저장(:161). STEPS 11문항 선형(:54-106) — 듀엣 후속 질문 없음. duet 불리언만 가사 API로 전달(백엔드가 [Female]/[Male] 라벨 분배 — LyricsLoadingScreen.tsx:82-90).
- 작곡(MusicGenerationScreen.tsx): lyricsStore.isDuet 읽어 step 3 질문이 "듀엣 곡이네요! 메인 보컬 성별을 선택해주세요."로 변경(:359,:752), 메인 스타일 후 step 100(서브 성별)→101(서브 스타일) 분기(:963-989, 렌더 :1558-1596). → **사용자 질문에 대한 답: 질문이 나오는 위치가 작사가 아니라 작곡 디렉터이며, 거기서 정상 노출됨.** 보고만 하고 코드 무변경(문구로 "듀엣 곡이네요!" 맥락 안내가 이미 있음). 선택: 작사 완료 시점 안내 한 줄 추가는 과설계로 판단 — 제외.

**F10. ⑩ 성별 필터 미발견 원인 (screens/ArtistCodyScreen.tsx) — 프로덕션 실측 포함**
- 필터 칩 위치: **피커 모달 내부**(:979-984, "여성용만"/"전체 보기" 토글) — 카테고리 그리드(메인 화면)에는 없음. 노출 게이트 :634 = `artistGender && GENDER_FILTER_CATS(상의/하의/신발) && …` — **artistGender null이면 칩 자체 미노출**(v3.205 설계).
- artistGender 3단 폴백(:239-243): apiResult.gender → taskStore.pendingGender → artistProfileStore(로컬). **characterTaskStore는 persist 미등록** → 앱 재시작 후 기존 아티스트로 진입하면 앞 2단이 null, 로컬 profileStore.gender만 남음(v3.82 이전 생성분·미입력이면 null).
- 프로덕션 실측: mongo characters 12건 중 gender null 7 / "여성" 5. **사용자 계정(c19acda4) 아티스트 "펄킴"·"진주" 모두 gender="여성" 서버 보유** — 즉 서버엔 값이 있는데 앱 폴백이 서버 캐릭터를 조회하지 않아 null → 칩 미노출이 미발견의 유력 원인(+ 칩이 피커 안에만 있어 발견성 자체도 낮음). 서버 GET /character 직렬화에 gender 이미 포함(character.py:329,356,378,398) — **서버 무수정, 앱에서 서버 캐릭터 gender를 폴백 최우선으로 연결**.

**F11. 빌드 프로파일**: eas.json preview(distribution internal, android buildType **apk**) / production(autoIncrement, buildType 미지정 = **AAB 기본**) — APK+AAB 요청과 정합, 설정 변경 불요.

### 항목별 확정 스펙

- **① 튜토리얼 코치마크(스포트라이트+화살표)**: TutorialOverlay 확장 — TutorialStep에 `anchorKey?: 'row-more' | …`, `placement?: 'above'|'below'` 추가. 좌표 채널은 **registry 방식**(신규 utils/tutorialAnchors.ts: `registerAnchor(key, rect)`/`getAnchor(key)`, onLayout·measureInWindow 기반) — 공용 TrackRow 시그니처 오염 최소화(첫 행 index 0만 등록). 딤은 4분할 View(anchor rect 구멍) + Feather 화살표(또는 SVG 삼각형)로 대상 지시, 카드 위치는 anchor 상/하 자동. **anchor 미등록/측정 실패 시 현행 카드형 graceful fallback**(리스트 로딩 전 노출 타이밍 대비). 적용 범위: 대상이 구체 UI인 스텝 — 차트 "곡 담기"(⋮=TrackRow 첫 행), 검색 "더보기(⋮)", 플레이어 주요 버튼, 피드 글쓰기 등 화면당 1~2 스텝(전 스텝 앵커화는 과설계 — 텍스트 스텝은 유지).
- **② 차트 신곡 포커스**: 기본 탭 'new'(:74) + TABS 순서 신곡 맨 앞 + 폴백 endpoint 신곡으로(:96) + 튜토리얼 문구(:27-31)·빈 상태 문구 신곡 기준 수정. ChartTrack에 `created_at?` 추가해 TrackRow footer로 상대 발매일 표기(서버 무수정). Top 100 탭은 존치(2번째).
- **③ 테스트 글 삭제**: 하단 후보 4건 — 사용자 확인 후 오케스트레이터가 purge_feed_document 경유 스크립트로 실행(컨테이너 내 python one-shot). 앱 무변경.
- **④ official DM 삭제**: 사용자 확인 후 스크립트 — dm_messages sender=official 1,111건 삭제 → 대화별 잔존 0건이면 dm_conversations 삭제, 잔존 있으면 last_message_text/last_at 재계산+unread 리셋. peer 발신 21건 보존. 앱 무변경.
- **⑤ 키보드 근본 전환**: `react-native-keyboard-controller` 도입(네이티브 — 이번 빌드에 포함). App.tsx 루트 `KeyboardProvider` 래핑 → DmChatScreen: RN KAV+overlap 훅 제거, keyboard-controller `KeyboardAvoidingView(behavior='padding')`로 교체. Modal 5종(PlaylistPickerSheet/ReportModal/AppealModal/AnswerEditModal/AlbumCreateModal): useAndroidKeyboardLift 제거, 라이브러리 `useKeyboardState`(또는 KeyboardAvoidingView)로 리프트 일원화 — iOS 경로도 동일 컴포넌트로 통일(기존 iOS KAV 회귀 확인 필수). 구훅 2종은 소비처 0 확인 후 삭제. 로그 추적자 `[KeyboardCtl]`.
- **⑥ 신고(DM) 이미지 첨부**: 서버 — upload.py에 `/upload/dm-image`(feed-image 계약 복제, prefix `dm/{user_id}/`), dm.py SendMessageBody `image_object_name?` + dm_service.send_message 확장(text 또는 image 필수, image는 본인 prefix+MinIO 실존 검증, 직렬화에 image_url=browser_image_url, last_message_text "(사진)", WS payload 포함). 앱 — DmChatScreen 입력바에 첨부 버튼(DocumentPicker image/* 관행), 업로드→전송, 말풍선 이미지 렌더(최대폭 제한+탭 확대 생략 가능). 수신측(admin CS 툴) 영향은 admin_cs.py 직렬화 공유 여부 확인 후 동일 필드 노출.
- **⑦ 비밀번호 재설정**: 서버 — `POST /auth/password-reset/request {email}`(항상 200 동일 응답 — 존재 여부 비노출, 6자리 코드 발급·15분 만료·시도 5회 제한, password_hash NULL 계정은 메일에 "소셜 가입 계정" 안내), `POST /auth/password-reset/confirm {email, code, new_password}`(validate_password 재사용, bcrypt 갱신), 신규 services/mailer.py(SMTP — .env `SMTP_HOST/PORT/USER/PASSWORD/FROM` 플레이스홀더; **자격 미제공 시 dev 모드 = 응답에 코드 미포함·로그만** → 기능 활성은 사용자 자격 제공 후). 앱 — AuthPanel `Mode`에 'forgot'|'forgotSent' 추가(:24), 로그인 폼 하단 "비밀번호를 잊으셨나요?" 링크(:273-280 사이), 이메일 입력→코드+새 비밀번호 입력→완료 후 login 모드 복귀. onModeChange 시그니처·SettingsScreen 헤더 타이틀 매핑 동반 수정. "아이디 찾기"는 이메일 라벨 하단 안내 문구 1줄("아이디는 가입하신 이메일입니다").
- **⑧ 연주곡 제거**: :1286 배열에서 INSTRUMENTAL_OPTION 제거 + :450 편집 모달 case 3 동반 제거 + :49 상수 정리. :926-931 방어 분기 유지. ComposeLyricsPick 카드 경로 회귀 0 확인.
- **⑨ 작사 듀엣**: 코드 무변경 — "듀엣 선택 시 메인/서브보컬 질문은 작곡 디렉터 step 3→100→101에서 정상 노출" 확인 보고.
- **⑩ 성별 필터**: (a) 서버 캐릭터 gender를 폴백 1순위로 — 화면 진입 시 보유 캐릭터 조회값(기존 GET /character 응답 재사용, 신규 호출 최소화) → 기존 3단 폴백 앞단에 연결. (b) 발견성 — 상의/하의/신발 피커에서 **칩 상시 노출**: 성별 미상이면 "성별 미설정 · 전체 표시"(탭 시 안내 — 아티스트 프로필에서 성별 설정 유도), 판별되면 현행 "◯◯용만/전체 보기" 토글. 회귀: 드릴다운 5단계·위시탭·SAMPLE 폴백·v3.206 악세서리 무영향.
- **⑪ 최초 접속자 한정**: 신규 utils/tutorialGate.ts + App.tsx 부팅 1회(restoreSession 옆) — `maidol_first_run_v1` 마커 확정: 미존재 시 getAllKeys() 검사, **튜토리얼 키 제외 키가 1개라도 있으면 'existing'**(기존 유저 — 6개 seen 키 일괄 선기록), 완전 빈 스토리지면 'fresh'. TutorialOverlay 자동 노출 effect(:51-64)는 마커 'fresh'일 때만 동작(레이스 방지: 마커 미확정 시 미노출 — 현행 보수 기본값 계승). 'fresh' 유저도 화면별 1회는 유지(최초 설치 세션 이후 첫 방문 화면 포함 — "2번 이상 접속자 제외"의 실질 의도 = 기존 유저 차단으로 해석, 엄격 1회 세션 한정은 과차단이라 기본안에서 제외. 반려 시 launch count 방식으로 교체 가능).
- **⑫ 작업실 ⓘ 제거**: MapScreen.tsx:292-300 삭제 + tutorialRef(:241)·Handle import(:35) 정리. TutorialOverlay 자체(:744)는 존치(⑪ 게이트 하 최초 노출용). 재보기 수단 소멸은 ⑪과 정합 — 의도된 동작.

### 변경 매트릭스 (앱)

| 파일 | 변경 | 항목 | 담당 | 로그 추적자 |
|---|---|---|---|---|
| components/TutorialOverlay.tsx | anchorKey 스포트라이트·화살표·fallback + firstRun 게이트 | ①⑪ | app-dev 1조 | `[Tutorial]` |
| utils/tutorialAnchors.ts (신규) | anchor registry | ① | app-dev 1조 | — |
| utils/tutorialGate.ts (신규) | 최초 설치 판별·마이그레이션 | ⑪ | app-dev 1조 | `[TutorialGate]` |
| App.tsx | KeyboardProvider 래핑 + tutorialGate 부팅 훅 | ⑤⑪ | app-dev 1조 | — |
| screens/MapScreen.tsx | ⓘ 제거 + ref 정리 | ⑫ | app-dev 1조 | — |
| screens/ChartScreen.tsx | 기본 탭 신곡·TABS 순서·문구·created_at footer + ⋮ anchor | ②① | app-dev 1조 | — |
| screens/SearchScreen.tsx / PlayerScreen.tsx / FeedScreen.tsx / PlaylistScreen.tsx | 코치마크 anchor 등록(해당 스텝) | ① | app-dev 1조 | — |
| components/TrackRow.tsx | 첫 행 ⋮ anchor 등록 콜백(옵션 prop) | ① | app-dev 1조 | — |
| screens/DmChatScreen.tsx | keyboard-controller KAV 교체 + 이미지 첨부 UI·렌더 | ⑤⑥ | app-dev 2조 | `[DmChat]` |
| components/PlaylistPickerSheet.tsx 외 Modal 4종 | 리프트 일원화(keyboard-controller) | ⑤ | app-dev 2조 | `[KeyboardCtl]` |
| hooks/useAndroidKeyboardLift.ts·useKeyboardOverlapLift.ts | 소비처 0 확인 후 삭제 | ⑤ | app-dev 2조 | — |
| components/auth/AuthPanel.tsx | forgot 모드 + 링크 + 아이디 안내 | ⑦ | app-dev 2조 | `[Auth]` |
| screens/SettingsScreen.tsx | onModeChange 타입·헤더 타이틀 매핑 | ⑦ | app-dev 2조 | — |
| services/authService.ts | passwordResetRequest/Confirm | ⑦ | app-dev 2조 | — |
| screens/MusicGenerationScreen.tsx | INSTRUMENTAL_OPTION 제거(:1286·:450·:49) | ⑧ | app-dev 2조 | — |
| screens/ArtistCodyScreen.tsx | 서버 gender 폴백 + 칩 상시 노출 | ⑩ | app-dev 2조 | `[ArtistCody] 성별 자동 필터` |
| package.json | react-native-keyboard-controller 추가 | ⑤ | app-dev 2조 | — |

### 서버 수정 필요 항목 (배포 1회로 묶음 — 오케스트레이터 실행)

1. **dm.py + dm_service.py + upload.py**: DM 이미지 메시지(⑥) — SendMessageBody.image_object_name, send_message 확장, `/upload/dm-image`.
2. **auth.py + services/mailer.py(신규) + config.py**: 비밀번호 재설정 2 엔드포인트 + SMTP 어댑터(⑦) — .env `SMTP_*` 플레이스홀더, 자격 미제공 시 dev 모드.
3. (코드 아님·데이터 작업) ③ 피드 4건 purge, ④ official DM 정리 스크립트 — 사용자 확인 후.
- 서버 무수정 확인: ②(차트 신곡 API 기존), ⑧⑨(앱), ⑩(gender 직렬화 기존).

### 데이터 삭제 후보 목록 (③④ — 사용자 최종 확인용)

**③ feeds 4건 (전체 8건 중; 보존 4건 = official 공지 3 + 펄킴 신곡 글):**
| # | feed_id | 작성자 | kind | 제목/본문 머리 |
|---|---|---|---|---|
| 1 | 6a69b3c7c03621e095f0295c | 무신사(c3202520) | feed | "0729테스트1" |
| 2 | 6a8588fc227bebd79cd1b7fe | v348수신자(73f78b2f) | feed | "v348 알림 팬아웃 테스트" |
| 3 | 6a8c118399933f837326bc6d | v323(0240335f) | feed | "v361 작성 기능 테스트" |
| 4 | 6a955c0113b9e03ee75306c9 | 무신사(c3202520) | community | "[공지테스트1] 공지테스트8월31일" |

**④ official 발신 DM 1,111건 전량**(위 F4 분류 — 전부 테스트 산출물, 실 CS 응대 없음) + 잔존 0건 대화방 삭제. **peer 발신 21건 보존.**

### 40% 룰 판정

앱 12항목 중 8건이 국소 수정(②⑧⑨⑩⑫ 및 ⑦앱·⑥앱·⑪)이고, 중규모 2건(① 오버레이 확장, ⑤ 라이브러리 전환 6파일)+서버 2건(⑥⑦)으로 **판정: 초과 아님(가결)** — 단 ①은 "anchor 스텝 화면당 1~2개 한정+fallback"으로 범위 고정(전 스텝 앵커화 금지), ⑦ 메일 실발송은 자격 제공 전까지 dev 모드로 분리해 빌드 블로커에서 제외. 이월 후보(차기): ① 잔여 스텝 앵커 확대, 피드 ⋯ 메뉴 튜토리얼 스텝 신설, ⑦ SES 전환.

### test-designer 테스트 항목

1. **⑤ 실기기(문제 기기) + API 34 에뮬 + iOS**: DmChat 신고 입력·담기 시트·신고/이의/답변편집/앨범 모달 — 키보드 위 완전 노출, 닫힘 후 잔존 간격 0, 이중 보정 없음. **이번 사이클 최우선 실기기 검증.**
2. **①⑪ 튜토리얼**: 완전 신규 설치(스토리지 empty) → 화면별 최초 1회 + ⋮ 스포트라이트·화살표 위치 정확(차트/검색). 기존 유저 시뮬(키 1개라도 존재) → 전 화면 미노출. anchor 측정 실패 시 카드형 fallback. Android 백버튼 skip.
3. **⑫**: 작업실 헤더에 ⓘ 부재, 헤더 마퀴 레이아웃 회귀 0.
4. **②**: 차트 진입 기본 신곡 탭 + NEW 뱃지 + 최신 앨범 섹션, Top 100 탭 전환 정상, 발매일 footer.
5. **⑥**: 이미지 첨부→전송→양측 렌더, 15MB 초과/비이미지 거부, 텍스트 없는 이미지 단독 전송, admin CS 툴 수신 확인.
6. **⑦**: 미존재 이메일도 동일 응답, 코드 만료·5회 제한, 소셜 계정 안내, 새 비밀번호로 재로그인. dev 모드에서 로그 코드로 E2E.
7. **⑧**: step 3 선택지 2개(남/여) + 편집 모달에도 연주곡 부재, ComposeLyricsPick 연주곡 카드 경로 5문항 체인 회귀 0.
8. **⑩**: 사용자 계정(서버 gender=여성) 재시작 후 진입 → 칩 "여성용만" 노출·필터 동작, gender null 캐릭터 → "성별 미설정" 칩·전량 노출, 드릴다운·위시탭 회귀 0.
9. **③④ 실행 후**: 피드 목록 4건 부재·공지 3건 잔존, DM 인박스에서 official 테스트 대화 부재, 문의하기 재진입 시 새 대화 정상 생성.
10. **빌드**: eas preview(APK)·production(AAB) 산출, keyboard-controller 포함 빌드에서 1~9 재확인.

### 사용자 결정 필요 사안

1. **③ 피드 4건 삭제 go/no-go** (특히 #4 공지테스트 — 무신사 계정 작성).
2. **④ official DM 1,111건 전량 삭제 + 빈 대화방 정리 go/no-go** (peer 문의 21건은 보존 기본안).
3. **⑦ 메일 발송 수단·자격**: SMTP 자격(호스트/계정) 또는 AWS SES 세팅 제공 여부 — 미제공 시 이번 빌드는 dev 모드(실메일 미발송, 서버 로그로 코드 확인)로 출고.
4. **⑧ "가사 유지 무보컬" 서브 유스케이스 소멸 허용 여부**(연주곡 진입은 '가사 없이 만들기' 카드로 일원화 — 카드 경로는 가사를 비움).
5. **⑪ 해석 확인**: 기본안 = "기존 유저 완전 차단 + 신규 설치자는 화면별 최초 1회"(설치 후 2번째 접속에서 처음 방문한 화면은 노출됨). 엄격한 "첫 실행 세션에서만"을 원하면 launch count 방식으로 교체.

## v3.208 (2026-09-22) — 디렉터 휴식(쿨다운) 보상형 광고 배선: 내부 테스트 단계 AdMob 연동 (광고 보고 단축)

> 작성: planner(팀 리드). 사용자 요청: "디렉터들 휴식시간에 광고 연동이 되어있잖아. 이 부분을 내부 테스트 단계에서는 admob에 등록 못해?"
> 소스오브트루스: 앱 `/Users/pearl/TripleJ/2_housing/`(frontend), 서버 프로덕션 `maidol-ec2:/home/ubuntu/maidol/backend_9004`(**읽기 전용 분석 — 배포는 오케스트레이터**). 스테이징: `server_staging_v3208/`.

### Plan verification findings (파일:라인·프로덕션 실측)

**F1. 사용자 질문 직답 — AdMob "등록"은 이미 되어 있고, 내부 테스트 단계 연동 가능(판정: 가결)**
- app.json:41-45 에 AdMob **앱 ID 실값이 이미 설정**되어 있음(`androidAppId`/`iosAppId` = `ca-app-pub-xxxx~xxxx` 형식 실값 — 본 문서에는 미기재). 즉 AdMob 계정·앱 등록 자체는 완료 상태이며 최신 1.1.0 APK/AAB에 SDK(react-native-google-mobile-ads ^16.3.2, package.json:39)+앱 ID가 네이티브로 포함돼 있다.
- 남은 콘솔 작업(코드 밖·사용자 수행): ① **보상형(Rewarded) 광고 단위 생성**(Android, 보상 item=skip_ticket·amount=1) ② 그 광고 단위에 **SSV 콜백 URL 등록**: `https://api.maidol.ai.kr/api/rewards/admob-callback` ③ **테스트 기기 등록**(내부 테스트 중 실광고 노출=무효 트래픽 계정 정지 위험 → 자체 광고 단위 + 테스트 기기 조합이 유일한 안전 E2E 경로). 미게시 앱도 광고 단위 생성 가능; 스토어 연결·app-ads.txt·실광고 게재는 프로덕션 공개 후로 이월.
- **구글 샘플 TestIds.REWARDED 로는 SSV E2E 불가**: SSV 콜백 URL은 광고 단위별 콘솔 설정이라 샘플 유닛 시청은 우리 서버로 콜백이 오지 않음 → 적립 0. TestIds 는 UI 배선 확인용 폴백으로만 유지.

**F2. 서버 광고권 체계 전모 — 적립(SSV)·소비(fatigue) 서버측은 이미 완비, 부여 경로는 SSV 유일**
- 적립: routes/rewards.py(로컬 미러 `0_platform_music/backend_9004`와 md5 동일 `95cd671b…` — 프로덕션 실측) `GET /api/rewards/admob-callback`(:153, 무인증·서명검증) — ECDSA-SHA256 검증(:98-128) → transaction_id dedup(reward_transactions unique index :143) → `reward_balances.$inc skip_wait_count += reward_amount`(:231-239). `custom_data` 를 user_id 로 사용(:190) → **앱이 serverSideVerificationOptions.customData=user_id 를 반드시 실어야 적립됨**. 부가: GET /api/rewards/balance(:281)·/history(:253). main.py:758 라우터 등록 확인.
- 소비: routes/fatigue.py POST /api/fatigue/skip method='ad'(:187-205) — `{skip_wait_count:{$gte:1}}` 조건부 `$inc:-1` 원자 차감, 쿨다운 소멸 레이스 시 +1 원복. 30분 단축(fatigue_service.SKIP_MINUTES=30:47). 티켓은 디렉터 공용.
- 부여 경로 실측: 서버 전체 grep 결과 skip_wait_count 증가는 **SSV 콜백 단 1곳**(출석 attendance.py·포인트·어드민 지급 경로 없음; admin_ads.py 는 광고주 AdOps로 무관). 앱에 광고 시청 배선이 없으므로 현재 적립 0 → 광고권 버튼은 사실상 사장(死藏) 상태 — 오케스트레이터 실측과 일치.
- **치명 버그 발견(이번 사이클 서버 수정 1건의 근거)**: rewards.py:40 `GOOGLE_KEYS_URL = "https://gstatic.com/admob/reward/verifier-keys.json"` — 실측 **HTTP 301 → www.gstatic.com** 리다이렉트인데 httpx.AsyncClient 는 기본 `follow_redirects=False`(:55) → 키 fetch 가 JSON 파싱 실패 → `_verify_ssv_signature` 예외 → **모든 SSV 콜백이 403 으로 거절되어 보상 미적립**. 배선을 붙여도 이 1줄을 고치지 않으면 E2E 불성립.

**F3. 앱 소비 흐름 — 수정 단일 지점은 utils/fatigueGate.ts (호출부는 4곳이 아니라 11화면 12곳)**
- 공용 다이얼로그 showFatigueCooldownDialog(utils/fatigueGate.ts:15-103): ⭐단축 버튼 상시 + 광고권 버튼은 `skip_wait_count>0` 일 때만(:86-91). 헤더 주석 :12 "신규 광고 시청 배선은 미포함(SSV 미연동)" — 의도된 미배선.
- 호출부 실측 12곳: MapScreen:424 · MusicGeneration:1188,1913 · MusicLoading:307 · ArtistLoading:493 · ArtistResult:647 · ArtistCody:422 · LyricsResult:131 · LyricsLoading:133 · CoverGeneration:486,1146 · LyricsPromptReview:85 (오케스트레이터 사전 실측 4곳은 부분집합). **다이얼로그 내부에 광고 버튼을 추가하면 12곳 전부 무수정 수혜** — 호출부 변경 0 이 기본 설계.
- services/fatigueService.ts: status(all)에 skip_wait_count 포함(types/index.ts:148,154) → 적립 확인 폴링은 기존 getFatigueStatus 재사용 가능(신규 rewards API 클라이언트 불요·선택).

**F4. WaitTimerScreen 보존 코드 평가 — 구조 관행만 재사용, 로직은 신규 훅으로 재작성**
- 재사용 가치(관행): Platform.OS!=='web' + try-require 게이트(:30-42, metro.config.js:23 web 빈 모듈 치환과 한 쌍), 화면 진입 시 pre-load(:91-113), Expo Go mock 폴백(:227-230).
- 재작성 사유(16.3.2 기준 결함 3): ① `serverSideVerificationOptions` 미설정 — SDK 는 `RewardedAd.createForAdRequest(adUnitId, {serverSideVerificationOptions:{customData}})` 지원(lib/typescript/types/RequestOptions.d.ts:6-17,:96 실측) ② 'closed' 문자열 리터럴 구독(:178, AdEventType.CLOSED 상수 미사용) ③ :214-220 setTimeout 이 스테일 클로저 `isWatchingAd` 를 참조하는 타임아웃 버그. → 신규 `hooks/useRewardedSkipAd.ts`(가칭)로 추출·재작성, WaitTimerScreen 은 @deprecated 그대로 존치(무수정).

**F5. 설정·빌드 실측 — 이번 사이클 앱 변경은 JS-only(네이티브 변경 0)**
- 앱 ID 는 app.json 플러그인에 이미 실값 → **prebuild 산출 네이티브 변경 없음**. 광고 "단위" ID 는 순수 JS 상수라 네이티브 무관.
- 광고 단위 ID 주입: `constants/ads.ts`(신규) — `process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`(플레이스홀더, 빌드 시 인라인) 우선, 미설정 시 `TestIds.REWARDED` 폴백. **코드에 `ca-app-pub-xxxx/xxxx` 실값 하드코딩 금지**. __DEV__/프로필 분기 불요 — "키 미제공=샘플 테스트 광고, 제공=자체 단위(테스트 기기에선 테스트 광고 게재)" 단일 규칙이 더 단순·안전. eas.json preview/production env 블록에 키 추가(값은 사용자 제공 시).
- 테스트 기기: `MobileAds().setRequestConfiguration({testDeviceIdentifiers:[…]})` 를 앱 시작 시 1회(값은 .env/상수 플레이스홀더) — 콘솔 등록과 병행 가능.

**F6. 어뷰징·회귀·플랫폼 판정**
- 어뷰징: 서버 검증 없는 클라 신뢰 보상은 **채택 안 함** — 기존 SSV(서명·dedup)가 이미 서버측 검증이므로 규모 대비 추가 설계 불요. 클라이언트 적립 API 신설 금지(현행 유지 — 적립은 구글→서버 콜백만). 일일 상한은 서버 캡 미구현 상태 → AdMob 콘솔 게재빈도 설정으로 갈음(기본안).
- SSV 지연: 콜백은 통상 수 초~수십 초 지연 → EARNED_REWARD 후 status 폴링(2s 간격 최대 30s), 타임아웃 시 "적립 확인 지연 — 잠시 후 다시 열어주세요" 안내 후 다이얼로그 재표시(다음 진입 시 반영). 광고 로드 실패/미충전 시 기존 ⭐/광고권 버튼 경로 그대로(폴백 무손상).
- Expo Go/web: try-require 실패 시 광고 버튼 자체 미노출(mock 보상 금지 — 서버 적립이 없어 UX 거짓말이 됨). 회귀면: 쿨다운 게이트 12곳 다이얼로그 버튼 배열만 증가, doSkip·409/402 처리 무변경.
- iOS: 이번 사이클 **Android 내부 테스트 한정**(검증 대상 APK). 코드 자체는 공용이나 iOS 실광고는 ATT 고지(NSUserTrackingUsageDescription)+SKAdNetwork 항목 필요 → 이월(차기, 프로덕션 공개 시점).

### 확정 스펙 (앱/서버 분리)

**흐름**: 휴식 다이얼로그에 3번째 버튼 「광고 보고 30분 단축」(광고권 0장이어도 노출, 광고 준비 안 됐으면 "광고 준비 중…" 비활성) → 시청 완료(EARNED_REWARD) → 구글이 SSV 콜백으로 skip_wait_count +1 적립 → 앱이 status 폴링으로 적립 확인 → **자동으로 skip(method:'ad') 1회 호출** = 30분 단축(잔여 시 갱신 다이얼로그 재표시 — 기존 반복 스킵 UX 동일) — 서버 계약 무변경.

### 변경 매트릭스

| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| hooks/useRewardedSkipAd.ts (신규) | try-require·pre-load·show·SSV customData(user_id)·이벤트 정리(F4 결함 3종 교정) | app-dev | `[AdReward]` |
| constants/ads.ts (신규) | EXPO_PUBLIC_ADMOB_REWARDED_ANDROID 플레이스홀더 + TestIds 폴백, 테스트 기기 ID 목록 | app-dev | — |
| utils/fatigueGate.ts | 「광고 보고 30분 단축」 버튼 + 시청완료→적립 폴링(2s×15)→doSkip('ad') 자동 연결, 미지원 플랫폼 미노출 | app-dev | `[AdReward]` `[fatigue:*]` |
| App.tsx | MobileAds 초기화 + setRequestConfiguration(테스트 기기) 1회 | app-dev | `[AdReward]` |
| eas.json | preview/production env 에 EXPO_PUBLIC_ADMOB_REWARDED_ANDROID 키(값은 사용자 제공 후) | app-dev | — |
| server_staging_v3208/rewards.py | **1줄: GOOGLE_KEYS_URL → `https://www.gstatic.com/admob/reward/verifier-keys.json`**(또는 follow_redirects=True) — F2 치명 버그 | backend-dev(스테이징만) | 서버 `[rewards]` |

- 서버 수정은 위 1줄이 전부(엔드포인트 신설 0·계약 무변경). 배포: `server_staging_v3208/` 에 rewards.py 스테이징 → 오케스트레이터가 v3.207 절차(백업 `.bak_pre_v3208` → scp → docker build+재생성) 재사용. 앱 12곳 호출부·WaitTimerScreen·fatigueService 무수정.

### 40% 룰 판정

앱 신규 2파일+수정 3파일(국소)+서버 1줄 — **초과 아님(가결)**. 이월: iOS ATT/SKAdNetwork, 실광고 전환(스토어 공개+app-ads.txt), 서버측 일일 적립 캡, WaitTimerScreen 완전 삭제 여부.

### test-designer 테스트 항목

1. **SSV 서버 단독(배포 후 즉시)**: `www.gstatic.com` 키 fetch 성공 로그 확인, 위조 서명 콜백 → 403, transaction_id 재전송 → already_processed(적립 1회 유지).
2. **E2E(자체 광고 단위+테스트 기기, 실기기 APK)**: 쿨다운 중 다이얼로그 → 광고 시청 → 30s 내 자동 30분 단축 + skip_wait_count 증감 로그(적립 +1→소비 -1), reward_transactions 1건 적재.
3. **폴백**: 광고 로드 실패(비행기모드)·SSV 폴링 타임아웃 → 안내 후 기존 ⭐/광고권 버튼 정상, 이중 차감 0.
4. **회귀(12곳)**: Map·MusicGeneration·MusicLoading·ArtistLoading·ArtistResult·ArtistCody·LyricsResult·LyricsLoading·CoverGeneration·LyricsPromptReview — ⭐단축·광고권 소비·409/402·반복 스킵 무변화.
5. **플랫폼**: Expo Go(광고 버튼 미노출·크래시 0)·web 빌드(빈 모듈 치환 유지)·키 미제공 빌드(TestIds 광고 표시, 적립은 미발생 안내).

### 사용자 결정 필요 사안

1. **AdMob 콘솔 작업+발급값 제공**: 보상형 광고 단위 생성(Android) 후 단위 ID(`ca-app-pub-xxxx/xxxx`) 전달, 해당 단위 SSV 콜백 URL `https://api.maidol.ai.kr/api/rewards/admob-callback` 등록, 테스트 기기 ID 등록/전달. 미제공 시에도 TestIds 폴백으로 UI 배선까지는 출고 가능(적립 E2E 만 보류).
2. **보상 정책 확정 — 기본안 (b)**: (a) 광고 1회=광고권 +1 적립만(수동 소비) (b) 적립 즉시 자동 소비=**광고 보고 30분 단축**(서버 무수정, 잔여 쿨다운엔 반복 시청 가능) (c) 광고 1회=쿨다운 전체 해제 — 서버 수정 필요+사다리(2~12h) 경제 붕괴 위험으로 **기각 권고**.
3. **시청 상한**: 서버 캡 없음 — AdMob 콘솔 게재빈도 캡(예: 1일 5회)으로 갈음할지, 차기 서버 캡 도입할지.
- SSV 도입 여부는 결정 사안 아님 — **서버에 이미 구현 완료라 사용 확정**(F2).

---

## v3.209 (2026-09-22) — 공유영상(영상 디렉터): 단색(이미지 없는) 배경 옵션 + 자막 테두리 on/off·테두리 색 선택

### 요청(원문)
"영상 디렉터가 영상 생성할때 배경에는 원본 이미지가 꼭 있는 형태이던데 원본 이미지 없이 색상만 있는 배경도 가능하게 하라는 소리였어. 그리고 폰트가 테두리가 있던데 테두리 있게 없게도 선택을 할 수 있어야하고 색상을 선택할 수 있도록 해줘."
→ ① 배경: 단색(원본 이미지 미노출) 옵션 ② 자막 폰트: 테두리 on/off + 색 선택. "색상"의 대상은 코드 실측으로 **테두리 색**으로 확정 — 글자색 선택은 이미 존재(fontColor 단계, v3.182)하고, 현재 하드코딩돼 선택 불가한 색은 테두리(OutlineColour 검정 고정)뿐.

### Plan verification findings (파일:라인 — 서버는 프로덕션 EC2 실측, 로컬 미러 아님)

**F1. 앱 흐름 실측 — 대상 화면은 VideoDirectorScreen 단일, 배경 3모드 모두 "이미지 위" 합성**
- 화면: `2_housing/screens/VideoDirectorScreen.tsx` (724줄, 추적자 `[VideoDirector]`). 대화 단계 Step 유니언 :28-30, 사용자 버블 탭→해당 단계 롤백(handleEditChoice :138-145, v3.182 방식 — AnswerEditModal 미사용, 이 화면 고유 관행 유지).
- 배경 소스는 **트랙 커버 이미지 고정**(`/tracks/my` 목록 :119, coverUriOf :63-66) — 업로드 경로 없음. 배경 질문(bg 단계 :523-537)은 **center 레이아웃에서만** 노출(layout full 이면 :173-174 에서 곧장 font 로 skip, styleParams :266 이 `bg`를 'blur' 로 강제). 3모드 clean(원본+어둠막)/blur(3강도)/color(색+투명도 25·45·70%) 모두 커버 이미지가 기저 — **투명도 최대 70%라 원본이 항상 비침** = 사용자 지적과 정확히 일치.
- 생성 요청: `POST /tracks/{id}/share-video` 쿼리 파라미터(:289, styleParams :263-270 — format/layout/shape/lyrics/font/fontcolor/bg/bgblur/bgcolor/bgalpha/fontbold/fontitalic/subpos). 색 팔레트 관행: 프리셋 12색 + hex 표시(PALETTE :50-54, 글자색·배경색 공용).
- 제2 호출부(회귀 대상): `components/TrackShareDownloadSheet.tsx:53` — **format 만 전송**(구식 최소 페이로드) → 신규 파라미터는 서버 기본값=현행 동작이어야 함.

**F2. 서버 파이프라인 실측 — 자막 테두리는 검정·두께3 하드코딩, 배경은 drawbox 오버레이**
- 라우트: EC2 `backend_9004/app/routes/tracks.py:2421-2555` (POST, Query 13종 :2424-2436, 스타일 검증 :2463-2471, 캐시 히트 무과금 :2517-2521, ⭐과금 ref=비기본 축만 직렬화 :2527-2530, 실패 환불 :2545-2552) + `GET …/share-video/file :2558-2630`(무인증 프록시, share_object_name **위치 인자** 호출 :2605-2608 — 시그니처 확장 시 이 호출부 동기 필수).
- 파이프라인: `app/services/share_video.py` (817줄). center 배경 체인 :664-672 — `bg=="color"` 시 `drawbox=c=0x{bgcolor}@{alpha}:t=fill`(:670), alpha 는 `STYLE_BGALPHAS={"25","45","70"}`(:117) 한정 → **alpha=1.0 만 허용하면 drawbox 가 커버를 완전 차폐 = 단색 배경**. ffmpeg color source 신설 불필요(입력 그래프 무변경 — 최소 diff).
- 자막(ASS) 스타일: `_build_ass` :305-307 · `_build_ass_scroll` :386-387 — Style 줄에 `OutlineColour=&H00000000`(검정)·`BorderStyle=1, Outline=3, Shadow=0` **하드코딩**. 즉 현재 모든 자막 = 검정 테두리 두께 3 고정. 폰트는 번들 fontsdir(:737, assets/fonts) — mv_pipeline.py(AI MV job, routes/mv.py)와는 **별개 파이프라인**(share-video 는 fontconfig 미의존, 오케스트레이터 참고사항의 mv_pipeline 은 이번 대상 아님).
- hex→ASS 변환기 기존재: `font_colour_ass` :149-156 (RRGGBB→&H00BBGGRR) — 테두리 색에 그대로 재사용 가능.
- 캐시·과금 키: `_style_tuple` :163-164(12원소) → `_style_suffix` :167-172(기본 튜플=빈 suffix, 비기본=md5 8자) → `share/v6/{id}{fmt}{suffix}.mp4`(:185). 과금 ref(:2527-2530)·video_url 쿼리(:2501-2507)도 "비기본 축만" 직렬화 — **신규 축을 '기본값이면 무흔적'으로 설계하면 캐시·환불멱등·URL 전부 자동 하위호환**.
- heavy_job_slot :575-577 — 스타일 문자열 키에 신규 축 추가만(무해).

**F3. 로컬 미러 부실 — 스테이징은 프로덕션 원본에서 출발 필수**
- `0_platform_music/backend_9004`(로컬 미러): share_video.py md5 상이(af7057… vs 프로덕션 9c5d13…), routes/tracks.py 는 **미러에 아예 없음**. → backend-dev 는 `scp maidol-ec2:…/app/{services/share_video.py,routes/tracks.py}` 원본을 `server_staging_v3209/` 로 받아 `.orig` 보존 후 수정(스테이징 관행 = 루트 `server_staging_v3207/`·`v3208/` 과 동일).

**F4. 40% 압축 판정 — 배경 단색은 신규 모드 신설 대신 기존 color 모드의 alpha 100% 승인 1줄**
- A안(bg='solid' 신설): STYLE_BGS·검증·분기·캐시축 다수 수정. B안(**채택**): `STYLE_BGALPHAS` 에 `"100"` 추가 **서버 1줄** — :669 `alpha=1.0` → drawbox 완전 불투명 = 원본 완전 차폐. 검증(:2467)·GET 검증(:2586)은 동일 상수 import 라 자동 통과, 캐시 suffix 는 bgalpha 가 이미 튜플 원소라 자동 분리. 시각 결과 동일·회귀면 최소로 B안 우월.
- 자막 테두리는 지름길 없음 — 신규 축 2종(fontoutline·outlinecolor) 정식 추가.

**F5. 기타 영향 실측**
- creationLog: VideoDirectorScreen 은 creationLogService 미사용·서버 share-video 도 창작기록 미적재(현행) — 이번 사이클 무변경(현행 유지).
- 비용·시간: 신규 외부 API 0, ffmpeg 단일 패스 유지(단색 배경은 blur 대비 오히려 경량). ⭐과금은 기존 POINT_COSTS['share_video'] 스타일 조합별 1회 그대로.
- 400 "커버 이미지가 없는 곡"(:2495-2496) 게이트는 유지 — center 레이아웃 중앙 이미지에 커버가 여전히 필요.

### 확정 스펙

**① 배경 단색 (center 레이아웃 배경 단계에 4번째 선택지)**
- 앱: bg 단계 카드 4개 — 원본/흐린/색으로 덮기/**「단색 배경」(desc "이미지 없이 색만")**. 단색 선택 → 색 팔레트(기존 bgColor 단계 재사용, PALETTE 12색+hex) → **진하기 단계 skip** → 폰트 단계. 미리보기는 이미지 없는 순수 색 스와치(정직한 근사).
- 전송 매핑(styleParams): 앱 내부 상태 `pickedBg='solid'` → API 로는 `bg=color & bgcolor={hex} & bgalpha=100` (계약 신설 0). 롤백 버블 step='bg' 기록 — 기존 탭-수정 호환.
- 서버: `STYLE_BGALPHAS = {"25","45","70","100"}` — 1줄. (:669 기존 로직이 1.00 을 그대로 처리)

**② 자막 테두리 on/off + 테두리 색 (신규 API 축 2종 — 기본값=현행과 완전 동일)**
- API 계약(POST·GET file 공통 Query 추가): `fontoutline` "1"(기본, 테두리 있음)|"0" · `outlinecolor` ""(기본=검정)|hex6. 검증: `fontoutline in {"0","1"}`, `outlinecolor=="" or _HEX6_RE`.
- 서버 반영: `_build_ass`/`_build_ass_scroll` 파라미터화 — Outline 폭 `3 if fontoutline=="1" else 0`, OutlineColour `font_colour_ass(outlinecolor) if outlinecolor else "&H00000000"` (Style 줄 첫 &H00000000 만 치환, BackColour 불변). scroll 인라인 오버라이드(\1c·\alpha)는 무수정(스타일 기본값이 테두리 색 전달).
- **캐시·과금 하위호환(핵심)**: `_style_tuple` 14원소 확장 + `_style_suffix` 에서 **말미 신규 축이 기본값("1","")이면 절단 후 md5** → 기존 전 조합(기본·비기본 모두)의 object name·과금 ref·video_url 이 배포 전후 비트 동일. route `_defaults` 에 두 키 추가(비기본만 쿼리/ref 직렬화 — 기존 메커니즘 자동 적용). GET file 의 위치 인자 호출(:2605-2608)도 확장 동기.
- 앱: fontColor 단계 뒤 신규 2단계 — `fontOutline`(카드 2: 「테두리 있음(기본)」/「없음」, 미리보기 textShadow 근사) → 있음이면 `outlineColor`(PALETTE 재사용, 기본 검정 표시). 전송: `fontoutline=pickedOutline?'1':'0'`, `outlinecolor=` 테두리 on 이고 검정(000000)이 아닐 때만 hex, 그 외 ""(**검정 선택=기본값 정규화** → 레거시 캐시 적중). 이후 lyricsMode → subPos 기존 흐름.

### 변경 매트릭스

| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| 2_housing/screens/VideoDirectorScreen.tsx | Step 에 fontOutline·outlineColor 추가, bg 단계 4번째 카드(단색), solid→color/100 매핑, 진하기 skip 분기, 신규 상태 3종(pickedOutline·pickedOutlineColor·pickedBg 'solid'), styleParams 확장, 디렉터 질문 문구 2건 | app-dev | `[VideoDirector]` |
| server_staging_v3209/share_video.py | STYLE_BGALPHAS +"100" · STYLE_FONTOUTLINES 검증 상수 · _build_ass/_build_ass_scroll 테두리 파라미터화 · _style_tuple/_DEFAULT_STYLE_TUPLE 14원소 · _style_suffix 말미 기본값 절단 · share_object_name/generate_share_video/_impl/heavy 슬롯 키 시그니처 확장 | backend-dev(스테이징만) | 서버 `[share-video]` |
| server_staging_v3209/tracks.py | POST·GET file 라우트 Query 2종 추가 + 검증식 확장 + _defaults 2키 + generate 호출·share_object_name 위치 인자 확장 | backend-dev(스테이징만) | 서버 `[share-video]` |

- 앱 TrackShareDownloadSheet·기타 화면 무수정(서버 기본값=현행). 배포: 프로덕션 원본 scp → `server_staging_v3209/`(`.orig` 보존) 수정 → 오케스트레이터 v3.207/8 절차(EC2 `.bak_pre_v3209` 백업 → scp → docker build+재생성). EC2 직접 쓰기 금지 준수.

### 40% 룰 판정
앱 1파일 국소(+약 90줄)·서버 2파일 국소(신규 엔드포인트 0·계약은 선택 Query 2종 추가) — **초과 아님(가결)**. 이월: full 레이아웃 단색(아래 결정 1), 커버 없는 곡의 가사-only 영상, 테두리 두께 선택, share-video 창작기록 적재.

### test-designer 테스트 항목
1. **하위호환(최중요)**: 구 페이로드(format 만 — TrackShareDownloadSheet 경로) 및 기존 비기본 스타일 조합(예: center/circle/line/dohyeon/hex색) — 배포 전후 `share_object_name` **문자열 동일** 실증(파이썬 단위 비교) + 기존 생성물 재요청 `cached:true`·무과금.
2. **단색 배경**: center+단색 생성 영상 프레임 샘플링 — 배경 픽셀=지정색 단일(커버 미노출), 중앙 커버·자막·워터마크 정상. bgalpha=100 검증 통과(POST·GET 모두).
3. **테두리**: fontoutline=0 → ASS Style `Outline=0` 실측(임시 ASS 검사 또는 로그)+시각상 테두리 없음(scroll·line 양모드). outlinecolor=FF6FA5 → `OutlineColour=&H00A56FFF`(BBGGRR 반전) 정확. 기본(미전송)=검정 두께3 현행 동일.
4. **검증 400**: fontoutline=2 · outlinecolor=GGGGGG · bg=color&bgcolor 누락 → 400 "지원하지 않는 스타일".
5. **과금·환불**: 신규 축 비기본 조합 첫 생성 ⭐차감(ref 에 fontoutline/outlinecolor 포함), 동일 조합 재요청 무과금, 강제 실패 시 환불 멱등.
6. **앱 UX**: 신규 2단계 대화 진행·사용자 버블 탭 롤백(fontOutline/outlineColor/bg 단계 포함), 단색 선택 시 진하기 질문 미출현, kakao·wide 포맷 각 1건 회귀.

### 사용자 결정 필요 사안
1. **full(화면 꽉 채우기) 레이아웃에도 단색 배경 제공 여부** — 기본안: **이번 사이클 제외(center 전용)**. full 은 커버가 화면 전체(=콘텐츠 그 자체)라 단색이면 이미지 0%의 가사-only 영상이 됨 — 커버 없는 곡 지원과 묶어 별도 기획 권고. (배경 질문 자체가 현재 center 에서만 나오므로 사용자 지적 문맥과도 일치)
2. **테두리 색 팔레트** — 기본안: 글자색과 동일 프리셋 12색 재사용(기본=검정 강조 표시). 자유 색상환(컬러 휠)은 디렉터 대화 관행(프리셋+hex 표시, v3.182) 대비 과잉으로 판정 — 미채택.
3. (참고) 테두리 두께는 현행 3 고정 유지 — 요청 범위 밖, 필요 시 차기.

---

## v3.210 (2026-09-22) — 피드 페이지 내 글 탭·공개/비공개 관리 + 프로덕션 앨범 2건 삭제(데이터) + AI 곡 "(Inst.)" 버전 생성·배포

### 사용자 요청 원문
"피드페이지에 내가 올린 피드나 공지는 탭으로 구분해서 볼 수 있어야하고, 피드나 공지를 작성시에도 관리할때도 공개, 비공개 처리할 수 있는 장치도 필요할 것 같아. 지금 앨범 만들어놓은거 2개 삭제해주고. 혹시 지금 현재 AI 가 만든 음원에서 보이스를 빼고 inst. 형태로 만들 수 있는 기능도 추가할 수 있어? 이 기능은 어디에 들어가면 좋을지는 모르겠는데 현재 곡에 (Inst.) 라고 붙여서 배포되면 될것 같은데."

### 0단계 findings (코드 실측 + 프로덕션 실측)

**① 피드 탭·공개/비공개 — 서버는 이미 완비, 앱만 비어 있음**
- FeedScreen(`2_housing/screens/FeedScreen.tsx`): **탭 없음** — `/feeds/timeline` 단일 목록(:129), Fab→FeedCompose(kind 미지정=feed, :332). 타임라인은 공개글 최신 200건 랭킹(서버 feeds.py:439-464, **전 kind 혼합**·`is_public: True`만).
- 서버 `feeds.py`(EC2 backend_9004): `is_public` 스키마 **이미 존재·전면 배선 완료** — body 기본 True(:63), 작성 저장(:225), 수정 반영(:615), 타인 조회 필터 `{"$ne": False}`(:391), 비공개 단건 소유자 외 404(:571). kind="feed"|"community"(:64, 수정 시 변경 불가 :601). **신고 블라인드는 별도 플래그 `report_blinded`**(:596)로 구분되어 수정 자체가 400 — 사용자 공개 토글과 충돌 없음(블라인드 글은 토글 불가로 자연 차단).
- FeedComposeScreen(:244): `is_public: true` **하드코딩** — 토글 UI 없음. kind='community'(공지)는 마이페이지 커뮤니티 탭에서만 진입(:41).
- FeedCard ⋯메뉴(:287-306): 내 글=**삭제만**, 남의 글=팔로우/신고. **수정·공개 전환 없음**. PUT /feeds/{id}는 앱 어디서도 미사용(전 화면 grep 0건). 공지 배지 = official 작성 community 글만(:86, v3.205).
- **v3.114/115 기존 유사 동선**: MyMusicScreen 상위 탭 [곡·앨범|피드|커뮤니티](:59-60, :575-645) — `/feeds/user/{id}?kind=` 로 **내 글(비공개 포함) 조회 + 새 피드/공지 작성 버튼이 이미 있음**. UserChannelScreen도 동일 계약(:62-63). → 판정: 데이터·컴포넌트는 전부 재사용 가능. 사용자가 "피드 페이지에서" 를 명시했으므로 **FeedScreen에 탭 신설**(기존 동선 안내로 갈음하지 않음), MyMusic 탭은 그대로 유지.

**② 앨범 삭제 — 프로덕션 전수 실측(mongo `aimu.albums`, 읽기 전용): 정확히 2건뿐**
| # | id | 제목 | 소유자 | 수록곡 | 생성일 | 커버 |
|---|-----|------|--------|--------|--------|------|
| 1 | 6a1263c9c298a4ddb1cdc6da | 앨범테스트 | 오리쟁이 (duck***@hanmail.net) | 2곡 | 2026-05-24 | borrowed(트랙 커버 차용 — **오브젝트 삭제 금지**) |
| 2 | 6a964784a632963bbf50efe5 | 마미 베스트 | lovvepearl (**사용자 본인** kimp***@gmail.com) | 2곡 | 2026-09-01 | ai 생성 `covers/generated/<uid>/album_*.png` — 함께 삭제 |
- "만들어놓은 거 2개" = 전체가 딱 2건이라 **사실상 특정됨**(단, 1번은 타 계정 소유 — 아래 사용자 확인). DELETE /albums/{id}(albums.py:390)는 소유자 본인만 → 타 계정 건은 API 불가, **mongosh 직접 삭제(데이터 작업)**. 연쇄: 앨범 doc 삭제 + `album_` prefix 커버만 MinIO 제거(:410-427 관행 준수), 트랙은 건드리지 않음. purge 경로 별도 없음.

**③ (Inst.) 생성 — 실행 경로 확정 (스파이크 불필요, 외부 API 문서 실검증 완료)**
- 서버 demucs/보컬분리 잔재 **없음**: Dockerfile v199에서 demucs/torch 제거 + torch 재유입 시 빌드 실패 가드(Dockerfile:38-39, :162-164). vocal_repair/voice_convert 라우트는 main.py include_router 목록(:740-780)에 없음 — 자체 분리 부활은 금지 경로.
- Suno 게이트웨이 = **sunoapi.org**(config.py:124 `suno_api_url="https://api.sunoapi.org"`, suno_generator.py:93). **공식 문서 실검증(2026-09-22 웹)**: `POST /api/v1/vocal-removal/generate` — `taskId+audioId` 또는 **`audioUrl`(외부 오디오, ≤20MB)**, type=`separate_vocal`(10 credits), 폴링 `GET /api/v1/vocal-removal/record-info?taskId=`(successFlag PENDING/SUCCESS/…, `instrumentalUrl`·`vocalUrl`) — 기존 generate 폴링 관행(suno_generator.py:315)과 동일 패턴. 산출 URL **14일 보관** → 즉시 MinIO 이관 필수.
- 데이터 연결: AI 발매 트랙은 `generation_id`+`variant_index` 보유(tracks.py:2182-2184) → generations에 `suno_task_id`/variants[].`suno_audio_id`(suno_generator.py:507-529). 단, Suno측 원본도 14일 보관이라 **구곡은 taskId/audioId 경로 신뢰 불가** → **`audioUrl`(자체 MinIO presigned URL) 단일 경로 권고**(코드 1경로·구곡 포함 전곡 지원, 업로드곡까지 자연 확장 가능).
- UI 위치 제안(근거): 마이뮤직 곡 탭 ⋮ TrackActionSheet `extraItems`(MyMusicScreen.tsx:792-798) — 이미 "공유/다운로드/차트에 업로드/삭제" 등 **내 곡 관리 액션의 관행 위치**이고, 발매(배포) 개념과 결이 같음. 플레이어/곡 상세는 타인 곡도 보이는 화면이라 부적합.

### 확정 스펙

**①-A FeedScreen 탭 신설 (frontend only)**
- 상단 세그먼트 탭 3개: **[전체] [내 피드] [내 공지]** (MyMusicScreen tabBar 스타일 재사용, 비로그인은 [전체]만 노출·탭바 숨김).
- [전체]=기존 timeline 불변. [내 피드]=`/feeds/user/{me}?kind=feed`, [내 공지]=`?kind=community`(비공개 포함 — 서버가 본인 조회 시 자동 포함). 렌더는 기존 FeedCard·블록 로직 그대로.
- Fab: [내 공지] 탭에서는 kind='community'로 FeedCompose 진입(그 외 'feed').

**①-B 작성 시 공개/비공개 (frontend only)**
- FeedComposeScreen에 공개 스위치(기본 ON=공개) — TrackUploadScreen 스위치(:383) 관행 재사용. POST 페이로드 `is_public` 실값 전달(:244 하드코딩 제거). 피드·공지(kind 불문) 공통 — 일반 유저 관점(official 전용 아님).

**①-C 관리 시 공개 전환 (frontend only)**
- FeedCard ⋯메뉴(내 글): [비공개로 전환]/[공개로 전환] 추가 — `PUT /feeds/{id}`에 저장된 title·blocks(track_id/object_name 원형)·bgm 재전송 + is_public 반전(서버 계약: 전체 body 필요, blocks 원형은 serialize 응답에 포함). `report_blinded` 400 응답은 "신고 처리로 제한된 콘텐츠" 안내 그대로 노출.
- 카드에 내 글 한정 "비공개" 칩 표시(공지 배지와 별개, MyMusicScreen 트랙 비공개 표기 관행).

**② 앨범 2건 삭제 (데이터 작업 — 오케스트레이터→사용자 승인 후 실행)**
- mongosh로 `albums` 2건 delete + 마미 베스트의 `covers/generated/<uid>/album_a61d….png` MinIO 제거(앨범테스트 borrowed 커버는 트랙 소유물 — 보존). 실행 전·후 count 실측 기록. 코드 변경 없음.

**③ Inst. 생성·배포 (backend + frontend)**
- 서버: `POST /api/tracks/{track_id}/instrumental` (소유자·⭐차감·melody 중복 방지 락) → 원곡 MinIO presigned URL(≤20MB 검증)로 sunoapi.org vocal-removal(separate_vocal) 생성 → 백그라운드 폴링 → `instrumentalUrl` 다운로드→MinIO 이관 → **신규 트랙 자동 발매**: 제목 `"<원제> (Inst.)"`, 원곡의 커버·장르·무드·artist_name·character/persona 스냅샷 복제, lyrics 없음, `source_track_id` 기록, `is_public`=원곡과 동일, 창작 기록(creation_log) 관행 연동. 실패 시 환불(refund 관행). 상태 조회 `GET /api/tracks/{track_id}/instrumental/status`(또는 generations 관행 재사용 — dev 재량).
- 앱: 마이뮤직 곡 ⋮ 시트에 **[Inst. 버전 만들기]**(AI 곡=ai_model suno 한정, 이미 (Inst.)인 곡·진행 중 곡 제외) → 비용 확인 다이얼로그(⭐표기) → 완료 알림 후 목록 갱신. 서버 Dockerfile 가드 준수 — **자체 분리(torch) 절대 재유입 금지**.

### 변경 매트릭스
| 영역 | 파일 | 내용 |
|------|------|------|
| 앱 | screens/FeedScreen.tsx | 탭 3분할·내 글 조회·Fab kind 분기 |
| 앱 | screens/FeedComposeScreen.tsx | 공개 스위치 + is_public 실값 |
| 앱 | components/feed/FeedCard.tsx | 공개 전환 메뉴·비공개 칩 |
| 앱 | screens/MyMusicScreen.tsx | ⋮ Inst. 액션·상태 |
| 서버(스테이징 server_staging_v3210) | app/routes/tracks.py(+services/inst_service 신규) | instrumental 생성·폴링·발매 |
| 데이터 | (코드 없음) | 앨범 2건 + AI 커버 1점 삭제 |

### 40% 룰 판정
①은 서버 무변경 프론트 4파일, ③은 검증 완료 외부 API + 기존 폴링·발매 관행 조립 — 신규 불확실성은 "presigned URL의 sunoapi.org 외부 접근성" 1건뿐(구현 초기에 curl 실검증, 실패 시 임시 공개 프록시 경로로 우회 설계). 스파이크 선행 불필요, **본 사이클 3건 모두 포함 가능** 판정. 단 ③ 실패 시 ①·②만으로 사이클 완결 가능하도록 커밋 순서 ①→②→③.

### test-designer 항목
1. 피드 탭: [전체]=기존 타임라인 회귀 무손상, [내 피드]/[내 공지] kind 분리·비공개 글 본인 노출, 타 계정에서는 비공개 글 미노출(타임라인·채널·단건 404).
2. 작성: 공개 OFF 등록 → 타임라인 미출현·내 탭 출현. 공지 배지(v3.205)는 official 글만 유지(일반 유저 공지에 미표시) 회귀.
3. 관리: 공개↔비공개 전환 왕복(blocks 원형 보존 — 트랙/이미지/[item] 마커 무손실), report_blinded 글 전환 시 400 안내.
4. Inst.: 정상 생성 E2E(⭐차감→SUCCESS→"(Inst.)" 트랙 발매·커버 승계·재생), 실패 시 환불 멱등, 20MB 초과/비AI 곡 거부, 중복 요청 락.
5. 데이터: 삭제 후 albums count=0, 마이뮤직 앨범 탭·/albums/latest 빈 목록 정상, 수록 트랙 4곡 무손상.

### 사용자 결정 필요 사안
1. **앨범 1번(앨범테스트)** 소유자가 타 계정(오리쟁이)입니다 — 본인 부계정이면 함께 삭제, 아니면 본인 소유 1건만 삭제할지 확인 필요(기본안: 요청 원문 "2개" 존중, 2건 모두 삭제).
2. **Inst. ⭐비용** — 외부 원가 10 credits(작곡 대비 저렴). 기본안: **⭐5**(share_video·커버와 동일 축), 대안 ⭐10. 무료(0)는 외부 과금 유출로 비권고.
3. Inst. 발매 공개 상태 — 기본안: 원곡과 동일(원곡 비공개면 Inst.도 비공개).

## v3.211 (2026-09-22) — [최우선 장애] APK/AAB 백그라운드 재생 불능 진단 — 웹앱은 정상, 배포판만 실패

### 사용자 요청 원문
"웹앱에서는 백그라운드 재생이 되는데 APK/AAB 배포판에서는 백그라운드 재생이 안 되고 있어. 이거부터 수정해"

### 0단계 findings (코드·git·서버 로그 실측 + 웹 조사)

**① 오디오 모드 설정 — 플래그 자체는 정상, 호출 시점도 문제 없음**
- `2_housing/services/audioMode.ts:12-19`: `staysActiveInBackground: true`·`playsInSilentModeIOS: true`·InterruptionMode DoNotMix(iOS/Android)·`shouldDuckAndroid: false` 전부 설정됨. 앱 기동 시가 아니라 **재생 직전 호출** 방식 — playback.ts:467(loadAndPlayTrack), :425(프리로드 스왑 playPreloadedSound), PlayerScreen.tsx:582, MusicResultScreen.tsx:211. expo-av에서 setAudioModeAsync는 재생 전에만 적용되면 충분 — 시점 결함 아님. **설정 누락 가설(a) 기각.**
- 웹 분기: audioMode.ts:39-62 Media Session API(웹 전용) — 웹은 브라우저가 OS 미디어 세션·백그라운드 유지를 대행하므로 정상인 것이 당연. APK와의 차이는 여기가 아니라 네이티브 계층.

**② app.json·타깃 SDK — Android 포그라운드 서비스 전무 + targetSdk 35(Android 15) 확정**
- app.json:24-27 iOS `UIBackgroundModes: ["audio"]` 있음(참고). **android(:29-37)에는 FOREGROUND_SERVICE 권한·미디어 알림·서비스 관련 항목 0건** — expo-av 자체가 Android FGS 미지원(기지: PLAN v3.197 사이클 2845행, audioMode.ts:5 주석 자인).
- expo-build-properties(:50-59)는 usesCleartextTraffic만 — **targetSdkVersion 미지정 → Expo SDK 54 기본값 = API 35(Android 15)** (웹 조사: Expo SDK 54 changelog·build-properties 문서 — API 36은 명시적 오버라이드 필요, SDK 55에서 기본화).
- **핵심 신규 발견(웹 조사, developer.android.com "Behavior changes: Apps targeting Android 15")**: **targetSdk 35 앱은 포그라운드(top app)가 아니고 FGS도 없으면 audio focus 요청이 `AUDIOFOCUS_REQUEST_FAILED`로 거부됨**(Android 15+ 기기에서 발효). expo-av는 재생 시작마다 focus를 요청하므로, 화면 꺼진 상태의 didJustFinish→스왑 재생(playback.ts:425-427 applyPlaybackAudioMode+playAsync)·재로드 폴백 전부가 **구조적으로 거부될 수 있는 경로**. v3.205의 로컬 프리다운로드(네트워크 무관화)로도 못 막는 신규 차단층 — 이번 보고가 "전환 실패"를 넘어 "재생 자체 불능"으로 악화된 것을 설명할 유력 후보. 웹앱이 되는 이유(브라우저 프로세스는 자체 미디어 FGS 보유)와도 정합.

**③ 1.1.0 vs 1.1.1 — 네이티브 diff 없음, "1.1.1 신규 모듈 회귀" 가설은 매니페스트 레벨 기각**
- git 실측: 1.1.0(37b6f7e, v3.207) 시점 package.json에 **이미** keyboard-controller 1.18.5·reanimated ~4.1.1·worklets 0.5.1·react-native-google-mobile-ads ^16.3.2 전부 존재. `git diff c6c3ed2..dcc0db9` = app.json 버전 문자열 + JS만(constants/ads.ts·hooks/useRewardedSkipAd.ts·utils/fatigueGate.ts·eas.json) — **두 빌드의 네이티브 모듈 구성 동일**. "1.1.0에는 keyboard-controller가 없다"는 전제는 git과 불일치 — keyboard-controller 없는 빌드는 9/18-20 세대(1.0.0, 7f1c245 이전)뿐. 어느 APK를 설치했는지는 사용자 확인 항목(아래 질문 1).
- AdMob 배선(1.1.1 JS 추가분)은 다이얼로그 진입 시에만 lazy-load(useRewardedSkipAd.ts:23-29, 모듈 싱글턴) — 전역 오디오 포커스 영향 경로 없음. 하위 가설로만 유지.

**④ 서버 frontend.log 실측 (ssh maidol-ec2, 읽기 전용)**
- 로그 위치 정정: 컨테이너 내부 `/srv/app/logs/frontend.log`(구 /app/logs 아님). **v3.209 배포(23:27 KST)의 컨테이너 재생성으로 이전 로그 또 소실**(기지 백로그: 호스트 볼륨 마운트 미적용, PLAN 3523행) — 잔존은 23:42~23:45 KST 세션 6줄뿐.
- 잔존 세션 판독(user_id=c19acda4…, page=Player): 23:42:28 preload start(eager)→download done(3.65MB/7.1s)→**preload ready(local:true)** 정상. 23:45:20 `[API Error] /charts/record-play status=undefined Network Error`. record-play는 **70% 재생 위치 도달 시** 발화(PlayerScreen.tsx:378-390 PLAY_RECORD_RATIO=0.7) → **재생 위치는 계속 전진 중(=오디오 살아 있음)인데 네트워크만 사망**(status=undefined = 무응답, Doze 정황 — v3.205 실측 UnknownHostException과 동일 패턴). 이후 didJustFinish/swap 로그 미도달 — 네트워크 사망으로 원격 로그 배치 유실이거나 프로세스 동결/킬. **이 세션만으로는 "즉시 멈춤"이 아니라 최소 곡 중반까지 재생 지속이 실측됨** — 사용자 증상(즉시/수분 후/전환만)의 구분이 필수(아래 질문 3).

**⑤ expo-audio 재확인 (웹 조사)**
- SDK 54 expo-audio 공식 문서: `setAudioModeAsync({ shouldPlayInBackground: true })` + **`setActiveForLockScreen(active, metadata, options)`**(잠금화면 컨트롤·메타데이터, AudioLockScreenOptions)·`updateLockScreenMetadata` 지원 — v3.205 조사와 일치. 잠금화면 컨트롤 활성 = Android 미디어 알림 = FGS 계층 확보(=②의 focus 제한과 Doze 근본 해제 후보). 커뮤니티 자료에는 최신 expo-audio의 `["expo-audio", {enableBackgroundPlayback}]` config plugin(FGS·권한 자동 생성) 언급 — SDK 54 동봉 버전에서의 정확한 지원 범위는 **실기기 스파이크로 확정**(공식 v54 문서에는 plugin 항목 없음 — 버전 확인 필요). expo-av는 SDK 55 제거 예정 — 이관은 어차피 필수 경로(v3.205 판정 유지).

### 원인 판정 — 단일 확정 불가(기기·재현 양상 미상), 가설 우선순위 + 검증 절차
| 순위 | 가설 | 근거 | 검증 |
|------|------|------|------|
| H1 | **구조 문제: FGS 부재** — Android 15+ 기기에서 targetSdk 35 audio focus 제한으로 백그라운드 곡 전환·재개 거부, 및/또는 프로세스 동결 | ②의 공식 behavior change + 앱에 FGS 0건 + 웹앱 정상과 정합 | 사용자 기기 Android 버전 확인(질문 2) + adb logcat에서 `AUDIOFOCUS_REQUEST_FAILED`/`requestAudioFocus` 거부 로그 + 화면 켠 뒤 서버 [BTDebug] reconcile 로그(playback.ts:522 dead sound=사운드 사망 / :529 paused=포커스 정지 — 두 로그가 원인 갈래를 직접 구분해줌) |
| H2 | 기지 Doze 네트워크 차단(Android 15 미만 기기) — 전환 실패의 누적 체감을 "백그라운드 재생 안 됨"으로 보고 | ④ 실측(재생 지속+네트워크 사망) = v3.205 실측과 동일 패턴 | 질문 3·4로 증상 구분, 프리로드 hit 시 전환 성공 여부 [BTDebug] didJustFinish preloadHit 확인 |
| H3 | OEM 공격적 절전(배터리 최적화 대상 앱 프로세스 킬) | 기지 한계(v3.197 판정) — FGS 없으면 완전 방어 불가 | 질문 5 + 배터리 최적화 제외 후 재현 여부 |
| H4 | 1.1.1 회귀(신규 네이티브) | ③에서 네이티브 diff 없음으로 **사실상 기각** | 질문 1(설치 빌드 식별)로 종결 |

### 확정 스펙 — 픽스 경로
**(1) [본작업 승격] expo-audio 이관 스파이크** — v3.205 백로그(PLAN 3595행)를 이번 사이클로 승격. H1·H2·H3 모두 근본 해법이 "FGS + 미디어 세션" 단일 지점으로 수렴하고, expo-av로는 어떤 조합으로도 도달 불가(FGS 미지원)이므로 진단 결과와 무관하게 필수 경로.
- 스파이크 범위: 별도 검증 화면/스크립트 + EAS 실기기 빌드로 (a) `shouldPlayInBackground`+`setActiveForLockScreen` → 화면 꺼짐 30분 연속 재생 (b) 백그라운드 곡 전환(연쇄 3곡+) — Android 15 기기 포함 (c) 잠금화면/BT 메타데이터·원격 다음/이전 이벤트 (d) SDK 54 동봉 expo-audio 버전의 config plugin(enableBackgroundPlayback) 지원 여부·생성 매니페스트 확인. 합격 판정 시 **전면 이관(playback.ts 어댑터 계층: duration 보정 v3.192·프리로드 v3.197/202/205·reconciler·LISTEN 계측 이식)은 별도 사이클** — 불합격 시 RNTP v4 스파이크(차선, v3.205 판정 유지).
- 스파이크 중 임시 완화(사용자 안내): 설정 앱 배터리 최적화 제외 안내(기지 임시책, v3.197 판정) — 코드 변경 없음, 사용자 커뮤니케이션.
**(2) [소규모 병행] 계측 1건**: playback.ts 스왑/로드 실패 로그에 이미 message가 담기므로(425-449, :489) 추가 코드 변경 없음 — 단 **frontend.log 호스트 볼륨 마운트**(기지 백로그, docker run 옵션)를 이번에 함께 처리해야 실기기 검증이 로그 소실에 다시 막히지 않음(서버 배포 절차 — 사용자 승인 필요).
**(3) 하지 않는 것**: expo-av 위에서의 땜질(백그라운드 focus 재시도 루프 등) — Android 15 정책상 원천 거부라 무의미, 금지.

### 변경 매트릭스
| 영역 | 파일 | 내용 |
|------|------|------|
| 앱(스파이크) | scratchpad 또는 screens/dev 전용 진입로 + app.json(expo-audio plugin 시험) | expo-audio 검증 하네스 — 본 재생 파이프라인 무변경 |
| 앱 | package.json | expo-audio 추가(expo-av 병존 — 이관 전 제거 금지) |
| 서버(옵션) | docker run 옵션(코드 아님) | frontend.log 호스트 볼륨 마운트 — 사용자 승인 배포 |

### 40% 룰 판정
스파이크 자체(검증 하네스+EAS 빌드 1회)는 미초과. **전면 이관까지 이번 사이클에 포함하면 명백 초과**(v3.205에서 "단독으로도 40% 초과" 기판정 — playback.ts 549줄+PlayerScreen/MiniPlayer 전면 재배선). → 기본안: 이번 사이클 = 진단 확정 + 스파이크까지, 이관 본작업은 스파이크 합격 후 차기 사이클. **이관까지 한 번에 원하시면 사용자 확인 필요.**

### test-designer 항목
1. 스파이크 합격 기준: Android 15+ 실기기에서 화면 꺼짐 30분 연속 재생 무중단, 백그라운드 연쇄 전환 3곡+, 잠금화면 컨트롤 표기·조작.
2. 회귀: 스파이크 하네스가 기존 expo-av 재생 경로(웹 포함)에 무영향 — 미니플레이어/PlayerScreen 스모크.
3. 진단 검증: 사용자 재현 세션의 서버 [BTDebug] reconcile dead/paused 로그로 H1 vs H2 판별 기록.
4. (볼륨 마운트 적용 시) 컨테이너 재시작 후 frontend.log 보존 확인.

### 사용자에게 물어볼 진단 질문 (원인 특정 최소 세트)
1. **어느 빌드**를 테스트하셨나요? 앱 버전(1.1.0/1.1.1)과 설치 시점 — 혹시 그 전(1.0.0, 9/18~20 설치) APK 그대로인가요?
2. **기기 모델과 Android 버전**(설정>휴대전화 정보)은? — Android 15 이상 여부가 원인 판정의 갈림길입니다.
3. 증상이 정확히 어느 쪽인가요? (a) 화면을 끄면 **즉시** 멈춤 (b) 몇 분 재생되다 멈춤(대략 몇 분?) (c) 듣던 곡은 끝까지 나오는데 **다음 곡으로만** 안 넘어감
4. 화면을 켠 채 **다른 앱으로 전환**했을 때는 재생이 유지되나요? (화면 꺼짐과 앱 전환의 분리)
5. 이어폰/블루투스(차량 포함) 연결 상태였나요, 스피커였나요? 배터리 절전 모드/앱 배터리 최적화 설정은?
6. 멈춘 뒤 앱으로 돌아가면 어떤 상태인가요? (일시정지 표시 / 처음 화면부터 재시작 / 재생 표시인데 무음)

## v3.212 (2026-09-23) — 추천하기 공유 개편: 옵션 2개 축소·멘트 랜딩 톤 정렬·초대 페이지 CTA 2원화(Play 내부테스트+웹앱)·OG 이미지 신규 제작(AIDOL 구브랜딩 제거)

### 사용자 요청 원문
"상단바 추천하기 기능에서 카카오톡이랑 링크 복사만 남기고 나머지는 지워줘. 그리고 공유하기 하면 이렇게 보이는데. 카카오톡 멘트도 변경해주고. 최대한 maidol.ai.kr 이랑 app.maidol.ai.kr 페이지의 멘트, 느낌이 비슷하게 가야해. 그리고 구글 플레이 다운로드, 웹에서 실행 이렇게 두가지로 실행되게 해야할 것 같아(안드로이드는 구글 플레이가 되지만 IOS는 웹에서 실행하도록 권장) 현재 https://play.google.com/apps/internaltest/4700477405401874414 이게 내부 테스트 링크고 웹앱버젼은 app.maidol.ai.kr 로 연결되게 해야하고. 공유할때 카카오톡에 뜨는 이미지랑 클릭했을때 링크가 보이는 이미지가 촌스러운것 같아. 웹페이지를 최대한 참고해서 수정해봐."

### Plan verification findings (파일:라인 — 서버는 프로덕션 EC2 실측)

**F1. 앱 추천하기 흐름 실측 — 공유 4종 전부 "네이티브 시트 위임"(카카오 SDK 미사용)**
- 진입점: `2_housing/components/HomeHeaderActions.tsx:78` (헤더 친구초대 아이콘 → uiStore.openInvite) → `2_housing/components/AppShareModal.tsx` (전체 141줄).
- 공유 버튼: `AppShareModal.tsx:16-20` SHARE_BUTTONS = 카카오톡/인스타그램/페이스북 3종 + 링크 복사(:110-112) = 총 4개. **삭제 대상 = 인스타그램·페이스북**.
- 카카오 공유 방식: 카카오 SDK 아님 — 세 소셜 버튼 모두 `Share.share({message})`(:66-74, RN 시스템 공유 시트)로 동일 동작. package.json 에 kakao 계열 의존성 0.
- 공유 멘트: :53-54 `shareTextBase` = "MAIDOL — AI가 만든 음악의 새로운 세계\n베타 테스트 기간 가입 시 스타 50 추가 증정!\n추천코드: {code}" + URL. 스크린샷 2의 노란 말풍선 텍스트와 정확히 일치 — 이 문자열이 교체 대상.
- 링크 복사(:62-65)는 shareTextFull 전체를 클립보드에 복사(URL 포함) — 유지.

**F2. 초대 랜딩(서버) 실측 — EC2 `backend_9004/app/routes/referral.py`(venv uvicorn 직기동, restart_9004.sh)**
- 라우트: `GET|HEAD /invite/{code}` public_router(:253-) → `_render_invite_html`(:84-) f-string 인라인 템플릿. 무효 코드 = 404 HTML 변형(코드 박스 대신 안내 + CTA 유지).
- 현재 CTA: **단일 버튼** `Google Play에서 다운로드` href=`settings.play_store_url` — `app/config.py:170` 기본값 `https://play.google.com/store/apps/details?id=com.maidol.app` = **미출시 플레이스홀더(스토어에서 404)**. `.env` 에 PLAY_STORE_URL 부재 실측(grep 0건) — pydantic `model_config env_file=".env"`(:291)라 .env 추가만으로 교체 가능(코드 무수정, config.py:169 주석의 설계 의도 그대로).
- 웹앱 CTA 없음. "이미 설치했다면 앱 열기" = `aidol://`(:79, app.json scheme "aidol" 실측 일치) — 유지.
- OG: :77 `_OG_IMAGE_URL = https://api.maidol.ai.kr/static/og/invite_og.png` ← EC2 실물 `app/static/og/invite_og.png`(1200×630 PNG, 56KB. main.py:886-889 /static 마운트). **이미지 실측: 좌상단 워드마크가 "AIDOL"(구 브랜딩 위반) + 브라우저 창 프레임 + 클립아트 입체 별** — 스크린샷 2의 카드 이미지와 동일. 동일 바이트의 beta-event-og.png 는 서버 py 코드 참조 0건(방치 파일).
- og:title "MAIDOL 초대장 — {nick}님의 초대" / og:desc "베타 테스트 기간 가입 시 스타 50 추가 증정! 추천코드 {code}"(:100-107) — 멘트 교체 대상.
- 페이지 스타일: bg `#0d0820`·바이올렛 `#a855f7` 계열 — 랜딩 실측 토큰(`/Users/pearl/homepage/maidol/www/index.html:18-26` --bg:#0a0a1a·--violet:#8b5cf6·--violet-soft:#a78bfa, :15 Pretendard CDN)과 근소 상이. 구조는 이미 유사 → 토큰·폰트만 정렬(최소 수정).

**F3. 랜딩(maidol.ai.kr) 카피 실측 — 멘트 톤의 근거(이 파일은 읽기 전용, 수정 금지)**
- `index.html:6` title "MAIDOL — 나의 AI 아이돌, 나만의 기획사" / :224 "MY AI IDOL · OPEN BETA 진행 중" / :225 h1 "나의 AI 아이돌, AI 음악 창작 놀이터" / :226 lede "작사·작곡부터 앨범 커버까지, AI가 무료로 완성합니다. 나의 AI 아티스트를 데뷔시키고, 차트에 도전하세요." / :317 "시작은 3분이면 충분해요" / :339-341 "지금, 웹에서 바로 시작하세요 … 설치 없이 브라우저에서 무료로" + CTA "웹에서 바로 시작하기"(→ app.maidol.ai.kr).

**F4. 웹앱 추천코드 자동 적용 경로 — 현재 부재, 5줄 프리필로 해소**
- 웹앱(app.maidol.ai.kr) = 동일 RN 코드베이스 웹 빌드. 가입 폼 `2_housing/components/auth/AuthPanel.tsx:79,561-568` 추천코드 수동 입력(4자, REFERRAL_RE :38). URLSearchParams/location.search 사용처 전 코드베이스 0건 실측 → `?ref=` 쿼리는 현재 무시됨. 웹 한정(Platform.OS==='web') 초기값 프리필 약 5줄로 자동 적용 가능 — 포함(가입 API 계약 무변경).

**F5. OG 이미지 제작 방식 실측 — 로컬 Chrome 헤드리스 스크린샷 채택**
- 로컬 도구: rsvg-convert·ImageMagick·cairosvg 부재 / **Chrome 실행파일 존재** + Pillow 12.3(검증용). → HTML(랜딩 토큰·Pretendard CDN) 작성 → `chrome --headless --screenshot --window-size=1200,630 --hide-scrollbars` → PNG. 한글 폰트·그라데이션을 랜딩과 픽셀 단위로 정합시키는 최적 경로. 서버는 정적 서빙뿐이라 서버측 변환 불요.
- 캐시 이슈: 카카오는 **페이지 URL 기준으로 OG 스크랩 캐시**. 파일명을 `invite_og_v2.png` 로 변경해 중간 캐시(브라우저/프록시) 회피 + 기존 스크랩된 invite URL 은 카카오 공유 디버거 수동 초기화 필요(사용자 안내 항목).

### 확정 스펙

**① 앱 공유 모달 (AppShareModal.tsx)**
- 버튼 [카카오톡으로 공유 | 링크 복사] 2개만(인스타그램·페이스북 삭제). 카카오톡 버튼 = 현행 네이티브 공유 시트 유지(카카오 SDK 도입은 네이티브 모듈·앱키·빌드 영향으로 이번 범위 밖 — 이월. 시트에서 카카오톡 선택 시 스크린샷 2와 같은 텍스트 공유로 정상 동작 실증됨).
- 공유 멘트 확정본(shareTextBase — 이모지 금지·⭐ 예외 규칙 준수):
```
나의 AI 아이돌, MAIDOL
작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요.
추천코드 {code} 입력하면 두 사람 모두 ⭐50, 시작은 3분이면 충분해요.
```
  (+ 줄바꿈 + inviteUrl = shareTextFull. 링크 복사도 동일 전문)
- 모달 안내문(:93-95)은 현행 유지(보상 설명 정확). 버튼 2개 폭 48% 셀 그대로(2열 1행).

**② 초대 랜딩 (server_staging_v3212/referral.py — EC2 원본 scp 후 .orig 보존 수정)**
- CTA 2원화(둘 다 항상 노출, UA 서버측 분기 — invite_landing 이미 Request 수신):
  - [Google Play에서 다운로드] → `settings.play_store_url` (.env `PLAY_STORE_URL=https://play.google.com/apps/internaltest/4700477405401874414` 추가로 교체 — 코드 무수정, 배포 단계 항목)
  - [웹에서 바로 시작하기] → `_WEBAPP_URL = "https://app.maidol.ai.kr"` 상수 신설, 유효 코드면 `?ref={code}` 부착(④ 프리필과 연동)
  - UA 에 "Android" 포함 → Play 버튼이 primary(그라데이션)·웹 버튼 secondary(아웃라인), iOS/기타 → 웹 버튼 primary + 보조문구 "iOS는 웹 버전을 권장해요 — 설치 없이 바로 시작". `aidol://` 앱 열기 링크 유지.
- 카피·토큰 랜딩 정렬: tagline "MY AI IDOL · AI 음악 창작 놀이터", 리워드 박스 위에 lede 1줄 "작사·작곡부터 앨범 커버까지, AI가 무료로 완성해요." 추가. bg #0d0820→#0a0a1a, 바이올렛 #a855f7 계열→#8b5cf6/#a78bfa/#6d28d9, Pretendard CDN link 추가(폴백 현행 스택 유지).
- OG 메타 확정본: og:title 유효 "「{nickname}」님이 MAIDOL에 초대했어요" / 무효 "MAIDOL — 나의 AI 아이돌" · og:description "작사·작곡부터 앨범 커버까지 AI가 무료로 완성. 추천코드 {code} 입력하면 두 사람 모두 스타 50!"(무효 코드는 코드 문장 생략) · og:image → `/static/og/invite_og_v2.png`.
- 보상 로직·/api/referral/* JSON 계약·404 변형·XSS escape 구조 무변경(표시 계층만).

**③ OG 이미지 신규 (server_staging_v3212/static/og/invite_og_v2.png)**
- 1200×630. 랜딩 디자인 언어: #0a0a1a 배경 + 상단 라디얼 바이올렛 글로우(rgba(124,58,237,.28)), 중앙 MAIDOL 그라데이션 워드마크(#c084fc→#7c3aed, 자간 넓게), 서브카피 "MY AI IDOL · AI 음악 창작 놀이터", 하단 필 배지 "OPEN BETA"+"추천코드 가입 시 두 사람 모두 ⭐50". 브라우저 창 프레임·입체 별 클립아트·"AIDOL" 표기 전면 제거.
- 제작: 로컬 HTML → Chrome 헤드리스 1200×630 스크린샷(F5 방식) → Pillow 로 규격 검증 → 스테이징 배치. 배포 시 EC2 `app/static/og/` 에 v2 추가(기존 invite_og.png 는 삭제하지 않고 존치 — 이미 스크랩된 구 카드의 이미지 404 방지).

**④ 웹앱 추천코드 프리필 (AuthPanel.tsx — 웹 한정)**
- `referralCode` 초기값: Platform.OS==='web' 이고 `location.search` 의 `ref` 가 REFERRAL_RE 통과 시 대문자 프리필(약 5줄, try/catch). 네이티브 경로 무영향, 가입 payload 계약 무변경.

### 변경 매트릭스

| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| 2_housing/components/AppShareModal.tsx | SHARE_BUTTONS 카카오톡 1종 축소, 공유 멘트 확정본 교체, 헤더 주석 갱신 | app-dev | `[AppShareModal]` |
| 2_housing/components/auth/AuthPanel.tsx | 웹 한정 ?ref 프리필 초기값 약 5줄 | app-dev | `[AuthPanel]` |
| server_staging_v3212/referral.py | CTA 2원화+UA 분기, _WEBAPP_URL, OG 메타·카피·토큰 정렬, og:image v2 경로 | backend-dev(스테이징만) | 서버 `[invite]` |
| server_staging_v3212/static/og/invite_og_v2.png | 신규 제작(Chrome 헤드리스) | backend-dev | — |
| EC2 .env | `PLAY_STORE_URL=<내부테스트 링크>` 1줄 추가 | 오케스트레이터(배포 단계) | — |

- 배포: 프로덕션 referral.py scp → 스테이징 수정(.orig 보존) → EC2 `.bak_pre_v3212` 백업 → scp(py+png) → .env 1줄 → `restart_9004.sh` (docker 아님 — venv uvicorn 직기동 실측). EC2 직접 편집 금지 준수.

### 40% 룰 판정
앱 2파일 국소(합계 약 40줄)·서버 1파일 표시 계층 + 정적 이미지 1개·API 계약 무변경 — **초과 아님(가결)**. 이월: 카카오 SDK 공식 공유(메시지 템플릿 카드), 웹앱 로그인 화면 딥링크 라우팅 고도화, beta-event-og.png 정리.

### test-designer 테스트 항목
1. 앱 모달: 버튼 정확히 2개(카카오톡·링크 복사), 인스타/페북 부재. 링크 복사 클립보드 값 = 확정 멘트 3줄 + invite URL. 공유 시트 호출 메시지 동일.
2. 랜딩 UA 분기: `curl -A "...Android..."` vs `-A "...iPhone..."` → primary/secondary 클래스 역전 실증, 두 CTA href = 내부테스트 링크 / `https://app.maidol.ai.kr?ref={code}`. 두 버튼 모두 양 UA 에서 존재.
3. OG: `curl /invite/{유효코드}` → 신규 og:title/description 문안, og:image=invite_og_v2.png · 이미지 GET 200 + 1200×630 PNG 실측 + "AIDOL" 워드마크 부재(육안).
4. 무효 코드: 404 + HTML 변형(안내문·CTA 2개 유지) 회귀. HEAD 프리플라이트 200/404 정상.
5. 웹 프리필: `app.maidol.ai.kr?ref=7VFU` 가입 폼 자동 입력(웹), `ref=zz!` 형식 무효 시 공란, 네이티브 앱 가입 폼 회귀 무영향.
6. 회귀: GET /api/referral/my-code JSON 계약 불변, 추천 가입 양측 ⭐50 적립 로직 무변경 스모크, `aidol://` 앱 열기 링크 존치.

### 사용자 결정 필요 사안
1. **멘트 문안 검수** — 앱 공유 멘트·OG title/description·랜딩 lede 확정본(위 ①②)을 제시했으나 배포 전 사용자 검수 권고(톤은 maidol.ai.kr 실측 카피 기반).
2. **카카오톡 버튼 방식** — 기본안: 네이티브 공유 시트 유지(SDK 미도입, 텍스트+링크 공유 → OG 카드는 카카오가 자동 생성). 공식 카카오 SDK 카드 템플릿은 이월 — 수용 여부.
3. **카카오 OG 캐시 초기화(수동 필요)** — 배포 후 https://developers.kakao.com/tool/debugger/sharing 에서 기존 공유된 `api.maidol.ai.kr/invite/{code}` URL 캐시 초기화해야 이미 스크랩된 코드의 카드가 갱신됨(신규 코드는 즉시 신규 카드).
4. (참고) Play 내부 테스트 링크는 테스터 등록 계정만 접근 가능 — 비테스터 수신자는 웹 버튼 경로가 실질 진입로임을 전제로 iOS 외 안내문구도 중립 유지.

---

## v3.213 (2026-09-23) — 튜토리얼 전면 재설계: 사용자 확정 문안 6영역·반투명 하이라이트 비주얼·리뷰 모드(상시 노출→검수 후 first-run 복귀)

> 작성: planner(팀 리드, maidol-dev). 사용자가 6개 화면 스펙을 직접 확정 — 문안은 원문 그대로 사용(명백 오탈자만 별도 교정 제안). 핵심 3요청: ① 영역 표시를 테두리 박스가 아닌 **세련된 반투명 박스**로 ② 이번 빌드는 **계속 노출**(사용자 검수용) ③ 검수 후 사용자 지시 시 "최초 접속·가입 후 최초 사용"만 노출로 복귀.
> 전제: v3.211까지 구축된 인프라(TutorialOverlay 스포트라이트·tutorialAnchors registry·tutorialGate first-run) 재사용·확장. 서버 무관(프론트 전용).

### Plan verification findings (파일:라인 실측)

**F1. 기존 인프라 재검증 — 전부 생존, 확장 지점 확정**
- `components/TutorialOverlay.tsx`(345줄): 4분할 딤(rgba 0,0,0,0.6 :53,:205-210) + 구멍 테두리(`holeBorder` :286-291, borderWidth 2 + accent 보라 — 사용자가 지적한 "테두리 박스" 스타일) + Feather 화살표(:220-233) + 근접 카드(:234-245), anchor 미등록 시 하단 카드 fallback(:248-256). 자동 노출 = 마운트 1회 useEffect(:77-97)에서 `initTutorialGate()==='fresh'` && seen 미기록. **enabled(로그인 게이팅) prop·스텝 변경 콜백·포커스 재노출 없음** — 이번에 추가.
- `utils/tutorialAnchors.ts`: 키 5종 union(:7-12 — chart-row-more/search-input/search-row-more/player-add/feed-compose), `measureAndRegister` 헬퍼(:65-76), 늦은 등록 구독 지원. 키 확장만으로 재사용 가능.
- `utils/tutorialGate.ts`: `maidol_first_run_v1` 마커 + getAllKeys 판별(:27-71), `TUTORIAL_SCREEN_KEYS = ['player','chart','feed','playlist','search','map']`(:19). 플래그 스위치를 이 파일에 두면 오버레이·게이트 단일 출처 유지.
- 현행 오버레이 사용처 6곳: Chart :412 / Feed :420 / Search :314 / Playlist :321 / Map :735 / Player :1490. **현행은 전부 로그인 여부 무관 노출** — 이번에 화면별 게이팅 도입.

**F2. 차트 (screens/ChartScreen.tsx)**
- 탭 스트립: `TABS` 6종(:70-78, 신곡→TOP 100→일간→주간→월간→내 재생목록) → chipBar View(:268) 내부 가로 ScrollView + Tag 칩. **"신곡~내 재생목록" 전체 영역 = chipBar View에 ref+onLayout로 anchor 등록**(가로 스크롤 무관 — 스트립 컨테이너 자체가 대상, 스텝 문안도 영역 단위).
- ⋮ anchor: TrackRow `moreAnchorKey={index===0 ? 'chart-row-more' : undefined}`(:260) 기구축 — 그대로 재사용. 첫 행이 리스트 로딩 후 등록되는 늦은 등록도 구독으로 처리됨(기검증).
- 기존 스텝 3종(:28-32)은 v3.207 산물 — 사용자 문안 2스텝으로 교체.

**F3. 피드·검색 (FeedScreen/SearchScreen)**
- 피드 Fab anchor 'feed-compose' 기구축(:113-135 — Fab 내부 아이콘 측정→지름 56 확장, 비로그인·미니플레이어 시 해제). 사용자 스텝 1종으로 교체(:27-31). 피드=로그인 시 표시는 anchor 해제 조건과 정합(비로그인이면 어차피 오버레이 자체를 게이팅).
- 검색바 anchor 'search-input' 기구축(:226 onLayout). 사용자 스텝 1종으로 축소 — 2스텝(search-row-more, :28·:191) 사용 철회.

**F4. 작업실 (screens/MapScreen.tsx) — 이번 사이클 최대 신규 공정**
- 디렉터 5종 위치 = `DIRECTORS`(:92-98, 맵 좌표 x:208 고정·y:340/660/980/1300/1620) → ScrollView(:506) 내 `mapScale = screenW/704`(:208) 스케일 렌더. 캐릭터 주변 박스 근거: isNext 펄스가 `(d.x±70, d.y±70)*mapScale` 140×140 박스 사용(:536-543) — anchor 박스도 동일 좌표계로 산출 가능.
- **스크롤 문제**: displayHeight ≈ 2208×scale(폭 390 기준 ≈1224px)로 이미지(₄)·영상(₅) 디렉터는 첫 화면 밖(y스케일 ≈720·898) → measureInWindow가 화면 밖 rect를 반환하면 validAnchor 검사(:142-151)에서 탈락해 카드 fallback으로 강등. **해결: 스텝 전환 시 MapScreen이 해당 디렉터로 자동 스크롤 후 재측정** — TutorialOverlay에 `onStepChange(index)` 콜백 prop 신설, MapScreen이 scrollRef.scrollTo({y: 대상y*scale − 화면높이*0.45, animated:true}) 후 ~350ms 뒤 anchor 재등록(맵 좌표 기지라 measure 대신 스크롤오프셋 기반 직접 계산도 가능 — 구현 시 단순한 쪽 선택, 계산식: winY = 대상맵y*scale − scrollY + ScrollView 화면 오프셋).
- 생성 이력 = 맵 우상단 **고정 오버레이 버튼**(:618-628, styles :749-760, position absolute top:10 right:12, 로그인 시만 렌더) — 스크롤 무관, ref+onLayout 등록.
- 기존 4스텝(:56-62, "빛나는 디렉터…" 등)은 전량 교체. 작업실은 비로그인 시 guestTouchOverlay(:634)로 잠김 — 로그인 게이팅과 정합.

**F5. 상단바 (components/HomeHeaderActions.tsx + App.tsx)**
- 아이콘 6종 전부 실존·순서도 사용자 스펙과 일치: 스타 배지(:63-74)→출석체크(:75-77)→추천/친구초대(:78-80)→알림(:82-92)→DM(:94-104)→마이페이지(:107-109). 앞 5종은 `user` 조건부(:60), 마이페이지는 상시.
- **호스트 화면 문제**: HomeHeaderActions는 네비 헤더 headerRight로 **여러 탭 헤더에 다중 마운트**(App.tsx chartHeader :283, titleHeader :294 등) — 동일 anchor 키를 여러 인스턴스가 등록하면 비활성 탭 헤더의 stale 좌표가 이길 수 있음. **해결: `registerTutorialAnchors?: boolean` prop을 추가하고 차트 탭 헤더(chartHeader :283)에서만 true 전달** — 상단바 튜토리얼은 차트 화면에서만 노출하므로 충분. 아이콘에 ref+onLayout만 부착(스타일 무변경 → 헤더 레이아웃 무영향).
- 상단바 튜토리얼 호스트 = ChartScreen에 **두 번째 TutorialOverlay**(screenKey 'topbar', enabled=로그인) 추가. 헤더 아이콘은 화면 최상단 → placement 자동 'below'(:196-197)로 카드가 아래 배치, 화살표 arrow-up — 기존 로직 그대로 동작. Modal statusBarTranslucent(:264)라 measureInWindow 창 좌표와 일치(v3.207 기검증).

**F6. 노출 게이트 현행과 격차**
- 현행: first-run 'fresh' 판정 시 화면별 1회, 로그인 여부 무관. 목표(검수 후): 화면별 1회 + **로그인 상태 게이팅**(차트=비로그인, 피드·검색·작업실·상단바=로그인). 이번 빌드: **게이트·seen 무시하고 화면 포커스마다 노출**(로그인 게이팅은 리뷰 모드에서도 적용 — 사용자가 상태별로 검수 가능해야 함).
- "화면 진입마다"의 구현: 탭 화면은 언마운트되지 않으므로 마운트 1회 useEffect로는 재진입 미노출 → TutorialOverlay에 `useIsFocused()`(@react-navigation/native — 이미 의존) 도입, 리뷰 모드일 때 포커스 획득마다 show().

### 확정 스펙 — 화면별 스텝 표 (문안 = 사용자 원문 그대로)

| # | 화면(screenKey) | 노출 조건 | 스텝 | 타이틀(제안) | 문안(원문 그대로) | anchor 키 | 타겟 (파일:라인) |
|---|---|---|---|---|---|---|---|
| 1 | 차트(chart) | **비로그인** | 1/2 | 신곡·차트 탭 | 최신 발매된 곡이나 인기곡을 탭하여 확인해보세요. | `chart-tabs`(신규) | ChartScreen.tsx:268 chipBar |
| | | | 2/2 | 곡 더보기 | 클릭하여 재생목록에 추가하거나 플레이리스트에 담아보세요. | `chart-row-more`(기존) | TrackRow ⋮ (ChartScreen.tsx:260) |
| 2 | 플레이리스트 | — | **튜토리얼 없음** — 오버레이·스텝 제거 | | | | PlaylistScreen.tsx:29,:321 삭제 |
| 3 | 피드(feed) | 로그인 | 1/1 | 피드 작성 | 클릭하여 피드를 작성하거나 다른 사용자의 피드 및 공지사항을 확인할 수 있어요. | `feed-compose`(기존) | FeedScreen.tsx:113-135 Fab |
| 4 | 검색(search) | 로그인 | 1/1 | 곡 검색 | 검색하여 나에게 딱 맞는 곡을 찾아보세요. | `search-input`(기존) | SearchScreen.tsx:226 검색바 |
| 5 | 작업실(map) | 로그인 | 1/6 | 아티스트 디렉터 | 클릭하여 나만의 아티스트를 만들고 의상을 입힐 수 있어요. | `map-artist`(신규) | MapScreen.tsx:92 (y=340) |
| | | | 2/6 | 작사 디렉터 | 클릭하여 가사를 작사할 수 있어요. | `map-lyricist`(신규) | :93 (y=660) |
| | | | 3/6 | 작곡 디렉터 | 클릭하여 나만의 음악을 만들어요. | `map-composer`(신규) | :94 (y=980) |
| | | | 4/6 | 이미지 디렉터 | 클릭하여 내 곡의 커버 이미지를 만들어요. | `map-image`(신규) | :95 (y=1300, 자동 스크롤) |
| | | | 5/6 | 영상 디렉터 | 클릭하여 SNS, Youtube, 카카오톡에 게시할 영상을 만들어요. | `map-video`(신규) | :96 (y=1620, 자동 스크롤) |
| | | | 6/6 | 생성이력 | 작업실에서 작업했던 과정을 확인할 수 있어요. | `map-history`(신규) | MapScreen.tsx:618-628 버튼 |
| 6 | 상단바(topbar) | 로그인 (차트 화면 호스트) | 1/6 | 스타 | 클릭하여 잔여 스타와 스타 받는 방법을 확인 할 수 있어요. | `topbar-star`(신규) | HomeHeaderActions.tsx:63-74 |
| | | | 2/6 | 출석체크 | 클릭하여 출석체크하고 스타를 받아보세요. | `topbar-attendance`(신규) | :75-77 |
| | | | 3/6 | 추천 | 클릭하여 친구에게 초대링크를 보내고 스타를 받아보세요. | `topbar-invite`(신규) | :78-80 |
| | | | 4/6 | 알림 | 클릭하여 새 피드나 공지를 확인해보세요. | `topbar-noti`(신규) | :82-92 |
| | | | 5/6 | DM | 클릭하여 나에게 온 메세지나 요청을 확인하고 다른 사용자 또는 관리자에게 연락 할 수 있어요. | `topbar-dm`(신규) | :94-104 |
| | | | 6/6 | 마이페이지 | 내 기획사를 관리할 수 있는 페이지로 이동할 수 있어요. | `topbar-mypage`(신규) | :107-109 |

- 캐러셀 전환 UX: **기존 관행 유지** — 도트 인디케이터 + [건너뛰기]/[다음(마지막 스텝은 시작하기)] 버튼(TutorialOverlay :162-180). 스와이프 미도입(기존에도 없음 — 6스텝도 동일 패턴, 과설계 배제).
- 오탈자 교정 제안(원문과 별도 — 사용자 승인 시에만 반영): ① "확인 할 수 있어요" → "확인할 수 있어요"(상단바 스타·DM 2건, 띄어쓰기) ② "메세지" → "메시지"(DM). "Youtube" 표기는 원문 유지(고유명사 관용). 그 외 문안 일체 무수정.

### 해석 확정 (스펙 모호 지점 — PLAN 명시)
1. **차트 "비로그인 시 표시"**: 차트 튜토리얼은 `enabled = !user`. 로그인 사용자가 차트 진입 시 차트 튜토리얼은 미노출하고 대신 **상단바 튜토리얼(로그인 시)**이 차트 화면에서 노출 — 한 화면에서 두 오버레이가 동시에 뜨는 경우는 구조적으로 없음(게이트가 상호 배타). 최종(first-run) 모드 시나리오: 신규 설치 → 비로그인 차트 진입(차트 튜토리얼) → 가입 → 차트 복귀 시 상단바 튜토리얼(seen 키가 chart/topbar로 분리라 자연 성립). 비로그인에게 보이는 유일한 튜토리얼 = 차트.
2. **플레이어(player) 튜토리얼**: 사용자 스펙 6영역에 미포함(플레이리스트처럼 "없음"으로 명시되지도 않음) → **기존 3스텝 존치**(무변경, 리뷰 모드 플래그만 공통 적용). 제거 원하시면 지시 1줄로 처리 — 사용자 결정 사안 ②.
3. 피드 문안이 Fab 1개 스텝에 "작성+확인"을 함께 설명 — 스텝 분리 없이 원문 그대로 1스텝(사용자 구성 존중).

### 반투명 하이라이트 비주얼 스펙 (테두리 박스 → 반투명 박스)
현행 구멍(4분할 딤) 구조는 유지하되(대상이 원본 밝기로 보이는 장점), **구멍 위에 보라 틴트 반투명 박스를 얹고 테두리를 최소화**한다. `holeBorder` 스타일 대체 — 구체 수치(theme 토큰 기반):
- 딤: `rgba(13, 8, 32, 0.68)` — 순흑 0.6 대신 `colors.bg.deepest`(#0d0820) 틴트로 브랜드 톤 정렬 (`DIM_COLOR` :53 교체).
- 하이라이트 박스(구멍 rect 위, pointerEvents none): `backgroundColor: 'rgba(168, 85, 247, 0.16)'`(= `colors.accent.primary` #a855f7 @16%), `borderRadius: radius.lg`(12), `borderWidth: StyleSheet.hairlineWidth`, `borderColor: 'rgba(192, 132, 252, 0.45)'`(= `colors.accent.primaryGlow` @45% — "테두리 최소화": 2px 실선 → 헤어라인 글로우 톤).
- 소프트 글로우: `shadowColor: colors.accent.primary, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: {0,0}` (iOS/웹). **Android 한계**: elevation은 글로우 표현 불가 → 틴트+헤어라인만으로 성립하는 디자인(글로우는 enhancement). 웹(Expo Web) boxShadow 정상.
- `HOLE_PAD` 8 유지, 화살표(accent.primary)·근접 카드 유지 — 상단바 18px 아이콘처럼 작은 대상은 패드 포함 ≈34px 박스라 화살표 지시가 여전히 유효.
- 참고 선례: MapScreen isNext 펄스(:544-551)가 이미 `rgba(168,85,247,0.28)`+글로우 — 동일 계열로 앱 내 시각 언어 통일.

### 리뷰 모드 플래그 설계 (전환 = 1줄)
- `utils/tutorialGate.ts`에 `export const TUTORIAL_REVIEW_MODE = true;` 신설(파일 상단, 주석으로 복귀 절차 명기). **이 상수 한 곳이 유일한 스위치.**
- TutorialOverlay 동작 분기: REVIEW_MODE=true → initTutorialGate·seen 키 검사 생략, `useIsFocused` 포커스 획득마다 show() (enabled=false면 리뷰 모드에서도 미노출 — 로그인 게이팅은 항상 유효). seen 키 기록은 유지(무해·복귀 후 상태 오염 없음… 단 검수 중 기록된 seen이 복귀 후 노출을 막으므로 **복귀 시점에 사용자 기기는 이미 'existing' 판정이라 어차피 미노출 — 오염 아님**, 신규 설치엔 무영향).
- REVIEW_MODE=false → v3.211 정책 완전 복귀: 'fresh'(신규 설치)만 + 화면·상태별 1회. **가입 후 최초 사용 요건은 로그인 게이팅과 first-run의 결합으로 자연 충족**(로그인 전엔 enabled=false라 seen 미소모 → 가입 후 첫 진입에 노출).
- `TUTORIAL_SCREEN_KEYS`(tutorialGate :19) 갱신: 'playlist' 제거, **'topbar' 추가** → 기존 유저 마이그레이션 선기록이 새 키까지 차단.

### 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| components/TutorialOverlay.tsx | 반투명 하이라이트 스타일 교체(딤·박스·글로우), `enabled?`·`onStepChange?` prop, 리뷰 모드 분기+useIsFocused 재노출 | app-dev | `[TutorialOverlay]` |
| utils/tutorialGate.ts | `TUTORIAL_REVIEW_MODE` 플래그, SCREEN_KEYS 갱신(playlist→topbar) | app-dev | `[TutorialGate]` |
| utils/tutorialAnchors.ts | anchor 키 +13종(chart-tabs, map-* 6, topbar-* 6) — search-row-more는 미사용화(키 존치 무해, 정리 가능) | app-dev | `[Tutorial]` |
| screens/ChartScreen.tsx | 스텝 2종 교체, chipBar anchor 등록, enabled=!user, **topbar 오버레이 2호 추가**(enabled=!!user) | app-dev | `[ChartScreen]` |
| components/HomeHeaderActions.tsx | `registerTutorialAnchors` prop + 아이콘 6종 ref/onLayout 등록(스타일 무변경) | app-dev | `[HomeHeaderActions]` |
| App.tsx | chartHeader(:283)의 HomeHeaderActions에만 registerTutorialAnchors 전달 | app-dev | — |
| screens/FeedScreen.tsx | 스텝 1종 교체(3→1), enabled=!!user | app-dev | `[FeedScreen]` |
| screens/SearchScreen.tsx | 스텝 1종 교체(2→1, search-row-more 사용 철회 :191), enabled=!!user | app-dev | `[SearchScreen]` |
| screens/PlaylistScreen.tsx | 튜토리얼 완전 제거(:29 스텝·:321 오버레이·import) | app-dev | `[PlaylistScreen]` |
| screens/MapScreen.tsx | 6스텝 교체, 디렉터 anchor 5종(140×140·mapScale 박스)+생성이력 anchor, scrollRef+onStepChange 자동 스크롤·재측정, enabled=!!user | app-dev | `[MapScreen]` |
| screens/PlayerScreen.tsx | 무변경(스펙 범위 밖 — 결정 사안 ②) | — | — |

### 40% 룰 판정
10파일이나 전부 튜토리얼 오버레이 계층 한정 — 화면 비즈니스 로직·API·store 무변경, 신규 공정은 MapScreen 자동 스크롤 연동 1건. v3.207(동일 계층 개편+12항목)보다 좁은 범위 — **초과 아님(가결)**. 이월 후보: 오탈자 교정(사용자 승인 대기), search-row-more/player 스텝 정리(결정 사안).

### test-designer 테스트 항목
1. [unit] tutorialGate: REVIEW_MODE=true 분기(게이트·seen 무시), false 시 v3.211 동작 회귀(fresh/existing/미확정 3분기), SCREEN_KEYS에 topbar 포함·playlist 부재.
2. [unit] tutorialAnchors: 신규 13키 등록/해제/구독, 0-rect 무시 회귀.
3. [e2e(web)] 비로그인: 차트 진입 → 차트 2스텝(탭 스트립 하이라이트 → 첫 행 ⋮), 플레이리스트·피드·검색 진입 시 튜토리얼 **없음**(피드·검색은 로그인 게이트, 플레이리스트는 제거), 작업실은 게스트 잠금+튜토리얼 없음.
4. [e2e(web)] 로그인: 차트 진입 → **차트 튜토리얼 미노출·상단바 6스텝 노출**(아이콘별 하이라이트 이동), 피드 1스텝(Fab), 검색 1스텝(검색바), 작업실 6스텝 — 4·5스텝에서 **자동 스크롤로 이미지·영상 디렉터가 스포트라이트**(카드 fallback 아님을 rect로 검증), 6스텝 생성이력 버튼.
5. [e2e(web)] 리뷰 모드 상시성: 동일 화면 이탈→재진입 시 매번 재노출(탭 왕복), 건너뛰기 후에도 재진입 시 노출.
6. [e2e(web)] 비주얼: 하이라이트가 반투명 보라 틴트+헤어라인(2px 실선 테두리 부재), 딤 색 rgba(13,8,32,0.68), 문안이 사용자 원문과 바이트 일치(오탈자 포함).
7. [회귀] 헤더 레이아웃 무변화(아이콘 위치·배지), 차트 탭 전환·재생·⋮ 시트, 피드 Fab 동작, 맵 디렉터 탭·생성이력 진입, 플레이리스트 화면 정상(제거 후 잔존 참조 0), 플레이어 기존 3스텝 존치.
8. [회귀] REVIEW_MODE=false로 뒤집은 빌드에서: 기존 유저(스토리지 有) 전 화면 미노출, 클린 스토리지 신규 설치 시 화면·상태별 1회.

### 사용자 결정 필요 사안
1. **오탈자 교정 2건 수용 여부** — "확인 할"→"확인할"(2곳), "메세지"→"메시지". 미승인 시 원문 그대로 유지(기본값).
2. **플레이어(지금 재생 화면) 튜토리얼** — 스펙 6영역 밖이라 기존 3스텝 존치가 기본안. 제거/재작성 원하시면 지시 필요.
3. (예고된 후속) 검수 완료 후 "최초 접속·가입 후 최초 사용만" 복귀는 `TUTORIAL_REVIEW_MODE=false` 1줄 — 사용자 지시 시 즉시 처리.

---

---

# v3.214 — 1.1.3 실기기 피드백 10건 (튜토리얼 형태·기록안내 시트·Inst·영상 디렉터 종합)

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend). 서버 변경은 **server_staging_v3214** 스테이징 전제(운영 9004 직접 수정 금지, 배포는 사용자 승인·rsync). 서버 소스 실측 = 9004 (읽기 전용, ssh -p 2222 <SSH_HOST>).
③ Inst 실패 원인은 오케스트레이터가 확증 완료(POST /instrumental 404 = v3.210 서버 미배포, 배포 커맨드 사용자 전달) — 본 계획은 앱 오류 문구 1건만 다룸.

## 0단계 findings (실측 요약)

**F1. ① 작업실 하이라이트 형태 (TutorialOverlay.tsx)**
- 현행: 딤 = 4분할 사각(dimPart, :253-258) + 구멍 위 highlightBox(:336-348, borderRadius `radius.lg`=12 고정, HOLE_PAD 8). Step 타입(:37-44)에 shape 개념 없음.
- 디렉터 비주얼(MapScreen/Character.tsx): 스프라이트 32×64(맵단위 48×96, 세로 1:2) + 하단 이름 배지(폭 ~88px). anchor = (d.x±70,d.y±70)*mapScale 정사각(:247-263). isNext 펄스는 이미 **완전 원형**(borderRadius 70*mapScale, :617-635).
- **제약**: borderRadius만 키우면 4분할 딤의 모서리가 사각으로 밝게 남음 → 라운딩 밖 모서리를 덮는 "코너 마스크"(구멍보다 큰 View + 두꺼운 DIM_COLOR border + borderRadius r+B) 필요. SVG 마스크 불요.
- 원형 반지름 ≈46.8px(폭390 기준)이면 이름 배지(하단 +28~+48px, 폭 88px) 모서리가 잘림 → 박스 하단 확장 필요.

**F2. ② 창작과정 기록안내 시트 (위치 정정: TrackUploadScreen 아님)**
- 실체 = **DialogueScreen.tsx(작사 디렉터)** 저작권 등록 모드 recChip(:473-483) → **PolicySheet**(components/PolicySheet.tsx, DialogueScreen :487-493, 타이틀 '창작 과정 기록 안내').
- PolicySheet = 비투명 **전체 화면 Modal**(flex:1, paddingTop: insets.top만) — 약관/개인정보 전문용 설계를 재사용한 것. 상단바(네이티브 헤더)를 완전히 덮는 게 침범의 원인. maxHeight 개념 없음.
- 앱 시트 관행(TrackActionSheet·TrackShareDownloadSheet·PlaylistPickerSheet): `Modal transparent` + backdrop rgba(0,0,0,0.6) + flex-end + maxHeight '60%' + paddingBottom insets.bottom+spacing.xl.
- 헤더 높이: 커스텀 상수 없음. `useHeaderHeight()`(@react-navigation/elements, 이미 의존) 사용 가능 — DialogueScreen에서 호출해 prop으로 전달(Modal 별창 안에서는 훅 무효).

**F3. ③⑩ Inst (MyMusicScreen.tsx)**
- 확인 다이얼로그(:349-386): "스타 ${INSTRUMENTAL_STAR_COST}개가 차감되며" — 관행(`⭐${n}이 소모돼요`, VideoDirectorScreen:326 등)과 불일치. INSTRUMENTAL_STAR_COST=5 (services/trackService.ts:158).
- 오류 처리(:366-381): 402/409 분기만 존재, **404 전용 분기 없음** → 서버 미배포 404가 generic "Inst. 생성 요청에 실패했어요"로 표기. 개선 여지 1건.

**F4. ④⑦⑧ 서버 share_video.py 실측 (9004, 817줄)**
- 가사 없는 곡: segments=[] → subtitled=False → **무자막 스틸+워터마크만**(현행). 제목 표시 없음.
- **⑦ 자막 위치 버그 확증 — 좌표 셈법**: center 레이아웃 커버 = size 0.68·min(W,H)(wide 0.60), 중심 y=0.32H(wide는 정중앙). 커버 점유: sns 247–981 / kakao 382–1116 / **wide 216–864**.
  - sns: near/mid/low(scroll cy 1150/1265/1380, line MarginV 760/560/380) 전부 커버 아래 — 정상.
  - **kakao**: line(alignment=8 상단 기준) mid=900·low=600 → **이미지 위에 얹힘**(382–1116 내) + low가 mid보다 위(의미 역전). scroll cy mid=1000·low=820도 이미지 위. ✗
  - **wide**: scroll cy 650/685/720 → **세 값 전부 이미지(216–864) 위**. ✗ ← "중간 선택했는데 이미지 위에 뜬다" 재현 경로(사용자 wide 또는 kakao 생성 추정).
  - 원인: `_SUBPOS_MARGIN_V`/`_SUBPOS_SCROLL_CY` 하드코딩 표가 center 레이아웃의 커버 기하와 무관하게 정의됨.
- **⑧ 워터마크 현행**: watermark_logo.png 록업(보라 심볼+MAIDOL+AI 생성) 1장을 h=40으로 우하단 오버레이(_WATERMARK_LOGO_SPEC). 좌하단 요소 없음. 서버 PIL 10.4 가용, 폰트 5종 번들(assets/fonts, Regular만).
- 과금(routes/tracks.py:2474-2508): **캐시 미스에만** POINT_COSTS["share_video"]=⭐5 spend, 실패 시 환불. 캐시 히트 무과금. 피로도 훅 없음.
- 피로도(fatigue_service.py): DIRECTORS=("composer","lyricist","image","artist") — **'video' 없음**. 사다리 전원 {1:2h,2:4h,3:8h,max 12h}, 스킵비 = 생성비 1/3 반올림(compose15→5, character10→3, 5짜리→2). on_generation_completed는 각 생성 라우트가 완료 시 호출.

**F5. ⑤⑥ VideoDirectorScreen.tsx 결과 화면**
- 버튼 4종 2행: 1행(기기에 저장/공유하기) = width:300 고정, primaryBtn(padV 12, radius 12) fs14. 2행(다른 형식으로/다른 곡으로) = **width 미지정(전폭)**, outlineBtn padV 10, fs13 → 폭·높이·폰트 모두 상이. "다시 만들기" 버튼은 없음(답변 버블 탭 = handleEditChoice로 재생성).
- **⑥ 공유하기 = 이미 expo-sharing 구현됨**(:394-411, expo-sharing ~14.0.8 설치, TrackShareDownloadSheet도 사용): downloadToCache → `Sharing.shareAsync(uri)`. 그런데 실기기에서 "다운로드만" 증상 → 유력 원인 후보: (a) 캐시 파일명 `${title}_${format}.mp4` — 한글·공백·특수문자 미새니타이즈로 downloadAsync 실패 가능, (b) shareAsync에 mimeType/UTI 미지정(Android 공유 대상 축소·실패), (c) catch 시 무피드백. 웹 세션은 Linking.openURL(=다운로드)이 정상 스펙.
- API: POST /tracks/{id}/share-video, format은 사용자가 매번 선택(sns/wide/kakao), subpos 라벨 near='이미지 가까이(center)/위쪽(full)', mid='중간', low='아래쪽'.
- 확인 팝업 "새 영상 생성 시 ⭐{cost}이 소모돼요 (같은 곡·형식·스타일은 무료)" 기존재. 402 처리 기존재. 피로도 게이트 없음.

**F6. ⑧ 앱 기준 스타일 (배지·로고)**
- PlayerScreen "AI 생성" 배지(:1561-1567): `bg rgba(0,0,0,0.55), borderRadius 6, padH 7, padV 3, 텍스트 rgba(255,255,255,0.85) fs10 w700`, 커버 우하단 8px 인셋.
- 상단바 로고(App.tsx:261-267 LogoTitle): `M`+`AI`+`DOL`, fs24 w700 letterSpacing 1, M/DOL=#ffffff, AI=#a855f7(colors.accent.primary). 시스템 폰트(fontFamily 미지정).

## 항목별 확정 스펙

### ① 작업실 디렉터 하이라이트 = 필(pill) 형태 [app]
- `TutorialStep`에 `shape?: 'rect' | 'pill'` 추가(기본 'rect'=현행 radius 12). pill = `borderRadius: min(w,h)/2`.
- 딤 코너 마스크: validAnchor 분기에서 구멍 위에 **마스크 View 1장 추가** — `left: hole.x−B, top: hole.y−B, width: hole.w+2B, height: hole.h+2B, borderWidth: B, borderColor: DIM_COLOR, borderRadius: r+B, backgroundColor: 'transparent', pointerEvents: 'none'` (B=40). shape 무관 항상 렌더(rect도 radius 12 모서리 정합 개선). highlightBox radius = r(shape 연동).
- MapScreen: 디렉터 5스텝(map-artist~map-video)에 `shape:'pill'`. anchor 박스 하단 확장 — `(d.x±70, d.y−70 ~ d.y+94)*mapScale`(하단 +24 맵단위, 이름 배지 포함; DIRECTOR_ANCHOR_HALF 상수 분리 유지). 140×164 → pill radius = 70*mapScale ≈ isNext 펄스와 동일 시각 언어. map-history·타 화면 스텝은 rect 유지.

### ② 창작과정 기록안내 = 헤더 하단 제한 바텀시트 [app]
- PolicySheet에 `variant?: 'page' | 'sheet'`(기본 'page'=현행 전체화면 — 약관·개인정보 사용처 무변경) + `topLimit?: number` prop.
- variant='sheet': `Modal transparent statusBarTranslucent animationType="slide"` + backdrop rgba(0,0,0,0.6) flex-end + 시트 `maxHeight: winH − topLimit − spacing.md`, 상단 radius.xxl, paddingBottom insets.bottom+spacing.xl, body ScrollView flexGrow:0 (앱 시트 관행 준수).
- DialogueScreen: `useHeaderHeight()` 호출값을 topLimit으로 전달(훅 실패/0이면 fallback `insets.top + 56`). 규칙: **시트 상단 ≥ 헤더 하단**.

### ③ Inst 404 문구 [app, 소규모]
- MyMusicScreen catch에 404 분기 추가: `showAlert('알림', 'Inst. 만들기 준비 중이에요. 잠시 후 다시 시도해주세요.')` — 서버 배포 전 과도기 안내(배포 후 404는 곡 미존재 케이스뿐이라 무해).

### ⑩ Inst 팝업 ⭐ 표기 [app, 확정 소규모]
- :353 메시지 "스타 ${INSTRUMENTAL_STAR_COST}개가 차감되며" → **"⭐${INSTRUMENTAL_STAR_COST}이 차감되며"** (관행: VideoDirectorScreen:326 "⭐{n}이 소모돼요" — ⭐는 이모지 금지의 명시 예외).

### ④ 가사 없는 곡 = 제목 마퀴 [server_staging_v3214]
- 조건: `segments==[]` **그리고 Inst 트랙 아님**(판별: /instrumental 생성 트랙 마킹 필드 — 구현 시 tracks.py instrumental 라우트의 실제 필드명(source_track_id 류) 확인, 부재 시 제목 " (Inst.)" 접미사 판별 폴백). Inst는 현행 유지(세그먼트 있으면 가사, 없으면 무자막) — 사용자 원문 "Inst 제외" 준수.
- 구현 판정: **ffmpeg drawtext 채택**(ASS 반복 이벤트 대비 단순, 조건 분기 내장) —
  `drawtext=fontfile=<선택 폰트 ttf>:text=<제목>:fontsize=<ass fontsize>:fontcolor=<선택 색>:borderw=3:x='if(gt(text_w,w-80), w-mod(t*140,text_w+w), (w-text_w)/2)':y=<subpos 밴드의 line모드 y>`
  → 폭 초과 시에만 우→좌 140px/s 무한 마퀴, 아니면 중앙 정적. 제목 이스케이프(`:'\,%` → drawtext 규칙) 필수.
- route: find_one 프로젝션에 `title` 추가, generate_share_video에 `title` 전달. 마퀴 시 frame_rate=20 (스틸 -r 2 금지). kakao 클립도 동일 적용.

### ⑦ 자막 위치 좌표 명세 — center 레이아웃 기하 유도 [server_staging_v3214]
- 원칙: **center = "이미지 하단 ~ 워터마크 상단" 밴드 안에서 3단**, full = 현행 표 유지(이미지가 전면 배경이라 겹침이 정상 — 위/중/아래 현행 좌표 무변경).
- wide center 커버 수직 중심 0.5H → **0.42H 상향**(자막 밴드 확보 — 기존엔 하단 여백 216px뿐), size 0.60 유지.
- 확정 좌표 표 (center 레이아웃, 커버 하단 ib / 워터마크 상단 wt / pad 20):

| fmt | 커버 점유 | 밴드 | scroll(window,rh) | scroll cy near/mid/low | line(anchor) MarginV near/mid/low |
|---|---|---|---|---|---|
| sns 1080×1920 | 247–981 | 1001–1840 | ±2, 110 | 1221 / 1421 / 1620 | (al=2 하단) 830 / 470 / 110 |
| wide 1920×1080 | 130–778 (0.42H) | 798–1000 | ±1, 70 | 872 / 906 / 940 | (al=2) 230 / 150 / 80 |
| kakao 1080×2340 | 382–1116 | 1136–1384* | ±1, 90 | 1250 (3단 클램프 단일) | (al=8 상단) 1136 (단일) |

  *kakao는 프로필 UI 가림(y>1404) 제약으로 밴드 248px — 3단 미분화, near/mid/low 동일 클램프(문서화·400 아님). kakao line 역전(low가 위) 구조 소멸.
- 구현: `_SUBPOS_MARGIN_V`/`_SUBPOS_SCROLL_CY`를 `_subpos_positions(fmt, layout)` 함수로 대체 — full은 기존 수치 그대로 반환(회귀 0), center는 위 표.
- **캐시 승격 v6→v7**(share/v7/) — ⑦⑧④ 가시 변경 일괄 반영. share_object_name·주석 갱신.

### ⑧ AI 생성 배지 + MAIDOL 워터마크 [server_staging_v3214]
- 록업 PNG 1장 → **PIL 런타임 렌더 스트립**으로 교체(폭 W, 투명 배경, 좌우 요소 포함 1장 — ffmpeg 그래프의 기존 워터마크 입력 슬롯 그대로 재사용).
- 좌하단 "AI 생성" 칩 = PlayerScreen 배지 스케일업: 텍스트 fontsize = **round(0.56×자막 fontsize)**(sns 36 / wide 32 / kakao 34 — "자막보단 작고 지금(h40 록업 내 ~20px)보다 큼"), `bg rgba(0,0,0,0.55)`, **rounded rect** radius=0.6×fontsize(PIL rounded_rectangle), padH=0.7×fs, padV=0.3×fs, 텍스트 색 rgba(255,255,255,0.85), 유사볼드 stroke_width 1(번들에 Bold ttf 없음).
- 우하단 "MAIDOL" = 동일 fontsize, M·DOL #FFFFFF / AI #A855F7, letterSpacing ~1px, 박스 없음 — 칩과 **수직 중앙선 정렬(같은 라인)**.
- 배치: 좌 x=20, 우 x=W−w−20, y=H−h−20 (kakao만 y=H−h−56 현행 유지). 자막 low 밴드와 비침범 검증됨(sns low 하한 1810 < 배지 상단 ~1842).
- 폰트: NanumGothic-Regular(번들). 보라 그라데이션은 미적용(단색 #A855F7 — ffmpeg/PIL 단순성 판정).

### ⑨ 영상 디렉터 피로도 + 재생성 과금 [server_staging_v3214 + app]
- 서버: `DIRECTORS += ("video",)`, SKIP_POINT_COSTS["video"]=**2**(share_video 5의 1/3 반올림 — 기존 규칙 그대로), 사다리 {1:2,2:4,3:8}/max12(타 디렉터 동일). tracks.py POST share-video: **spend 직전 check_gate 429**(타 디렉터와 동일: 게이트→과금 순서), 생성 성공 후 `on_generation_completed(director="video")` best-effort. **캐시 히트 경로는 게이트·피로 미적용**(무비용 재다운로드 유지).
- 앱: types FatigueDirector에 'video', fatigueGate.ts fallback 스킵비 video:2, VideoDirectorScreen에 MusicGenerationScreen 패턴 이식 — 진입/포커스 시 status fetch, startGeneration 직전 쿨다운이면 showFatigueCooldownDialog(스킵 ⭐2·광고권), POST 429 응답도 동일 다이얼로그.
- 과금 기본안(사용자 결정 ②): 새 스타일 조합=⭐5(현행 서버 로직 그대로 — "다시 만들기"는 조합 변경이므로 자연 과금), **동일 조합 캐시 히트=무과금·무피로 유지**(산출 결정적 동일물 재과금은 소비자 손해). 확인 팝업 문구 현행 유지.

### ⑤ 결과 버튼 크기 통일 [app]
- 2행(:500)에 `width: 300, maxWidth: '100%'` 부여(1행과 동일), outlineBtn `paddingVertical: 10→12`, outlineBtnText `fontSize: 13→14` → 4버튼 전부 동일 규격(색 체계는 현행: 저장=채움, 나머지=아웃라인). 부수: 확인 팝업 취소 시 subpos 답변 버블 잔존(:304/:332) 정리 1줄.

### ⑥ 공유하기 시스템 공유 시트 [app]
- handleShare/downloadToCache 보강: ① 캐시 파일명 새니타이즈 `title.replace(/[^\w가-힣.-]+/g,'_').slice(0,40)` ② `Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: '영상 공유' })` ③ 다운로드·공유 실패 catch에 showAlert('오류', …) — 무피드백 금지 ④ 진행 중 로딩 인디케이터(다운로드가 수십 MB). 카카오톡은 시스템 시트 경유(별도 SDK 미도입 — MVP). TrackShareDownloadSheet의 shareAsync에도 동일 mimeType 보강.
- tester: 실기기 재현 로그 확보(실패 지점 a/b/c 확정) — 스펙은 3후보 동시 봉합.

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| components/TutorialOverlay.tsx | shape prop·pill radius·딤 코너 마스크 | app-dev | `[TutorialOverlay]` |
| screens/MapScreen.tsx | 디렉터 5스텝 shape:'pill'·anchor 하단 +24 확장 | app-dev | `[MapScreen]` |
| components/PolicySheet.tsx | variant 'page'/'sheet'·topLimit·바텀시트 렌더 | app-dev | `[PolicySheet]` |
| screens/DialogueScreen.tsx | useHeaderHeight→topLimit 전달, variant='sheet' | app-dev | `[DialogueScreen]` |
| screens/MyMusicScreen.tsx | ⭐5 표기(:353)·404 분기(:380) | app-dev | `[MyMusicScreen]` |
| screens/VideoDirectorScreen.tsx | 버튼 규격 통일·공유 보강·피로도 게이트·429 | app-dev | `[VideoDirector]` |
| components/TrackShareDownloadSheet.tsx | shareAsync mimeType 보강 | app-dev | `[ShareSheet]` |
| types/index.ts, utils/fatigueGate.ts | FatigueDirector+'video', 스킵비 2 | app-dev | `[Fatigue]` |
| (서버) services/share_video.py | 제목 마퀴 drawtext·subpos 기하 유도·PIL 배지 스트립·캐시 v7 | backend-dev | `[share-video]` |
| (서버) routes/tracks.py | title 프로젝션·check_gate·on_generation_completed('video') | backend-dev | `[tracks]` |
| (서버) services/fatigue_service.py | DIRECTORS+video·스킵비·사다리 | backend-dev | `[fatigue]` |

## 40% 룰 판정
앱 8파일·서버 3파일이나 상호 독립 개선 10건(신규 화면·신규 스토어 0, 최대 공정 = share_video.py subpos 재설계+배지 렌더). v3.213(10파일 튜토리얼 전면 재설계)과 유사 체급, 각 항목이 국소적 — **초과 아님(가결)**. 이월 후보: 카카오 SDK 직공유, kakao center 밴드 재설계(커버 축소), Inst 트랙 마킹 필드 정식화.

## test-designer 항목
1. [unit/server] `_subpos_positions`: full=기존 수치 바이트 일치(회귀 0), center 표값 일치, kakao center 3단 동일 클램프, wide center 커버 0.42H.
2. [unit/server] 제목 마퀴: segments=[] & 비Inst → drawtext 포함 cmd, Inst → 현행, 제목 특수문자(`:',%`) 이스케이프, frame_rate 20.
3. [unit/server] 캐시 v7 객체명, video 피로도: check_gate 429 → spend 미발생, 성공 시 on_generation_completed, 캐시 히트 무게이트·무피로.
4. [unit/app] fatigueGate 'video' 스킵비 2, PolicySheet variant 기본 'page' 회귀.
5. [e2e(web)] 작업실 튜토리얼: 디렉터 스텝 하이라이트가 pill(radius=min(w,h)/2)·코너 밝은 사각 잔존 없음(스크린샷), 배지 포함 박스, 타 화면 rect 회귀.
6. [e2e(web)] 기록안내 시트: 시트 상단 y ≥ 헤더 하단 y(측정), backdrop 탭/닫기, 약관·개인정보 전체화면 회귀.
7. [e2e(web)] 영상 결과 4버튼 rect 폭·높이 동일(측정), Inst 팝업 "⭐5" 문구, 404 시 "준비 중" 문구.
8. [통합/스테이징] center×{sns,wide,kakao}×{near,mid,low}×{scroll,line} 생성 → 자막이 커버 미침범(프레임 캡처 y 검증), full 3종 회귀, 가사 없는 곡 제목 마퀴(장·단 제목), 배지: 좌 칩 rounded rect+우 MAIDOL(AI 보라) 동일 라인.
9. [실기기/tester] 공유하기 → 시스템 공유 시트 표시(카카오 포함), 한글 긴 제목 곡, 실패 시 오류 팝업.

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **④ Inst 해석**: 기본안 = Inst 트랙은 제목 마퀴 대상 제외(원문 그대로), 세그먼트 있으면 가사 표시 현행 유지. Inst도 제목 마퀴로 바꾸려면 지시 1줄.
2. **⑨ 재생성 과금**: 기본안 = 새 조합 ⭐5 / 동일 조합 캐시 히트 무과금·무피로. 캐시 v7 승격으로 **기존 생성분도 다음 요청 시 1회 재과금** 발생(대안: v6 객체 존재 시 무과금 이관 — 복잡도↑로 기본안은 수용).
3. **① 형태**: 기본안 = 디렉터 5종 pill(원형 계열, isNext 펄스와 통일). 순수 원형(배지 제외) 원하면 지시.
4. **⑦ wide center 커버 상향(0.42H)**: 자막 밴드 확보를 위한 구도 변경 — 미세 톤 조정 가능.

규칙: 민감 정보 플레이스홀더(<SSH_HOST>), 서버 수정은 server_staging_v3214에서만, git 커밋은 오케스트레이터 승인 후.

# v3.215 — 최종 배포 전 사이클: 작업실 anchor 정착·Inst 품질/쿨다운/커버·nowplaying 튜토리얼 교체 (+광고 버튼 편입)

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend). 서버 변경은 **server_staging_v3215** 스테이징(운영 EC2 `maidol-ec2` `/home/ubuntu/maidol/backend_9004` scp pull 기반 — 직접 수정 금지, 배포는 사용자 승인). 실측 = EC2 읽기 전용 + 프로덕션 API/DB 읽기 조회.
계획 제외(오케스트레이터 선처리): ① 영상 생성 실패(ffmpeg 600s+동시1 핫픽스 배포 완료 — 사용자 재시도 대기), ⑦ 리뷰 모드 off 1줄 전환(최종 빌드 직전), ⑧ 빌드/APK.

## 0단계 findings (실측 요약)

**F1. ② 작업실 anchor 위치·스크롤 중 표시 (MapScreen.tsx:246-291, TutorialOverlay.tsx)**
- 산식 자체는 isNext 펄스와 동일 좌표계(`sy + (d.x±70,d.y−70~+94)*mapScale − scrollY`)로 정합. 아티스트(1스텝, y=340)는 `targetY = 340*mapScale − winH*0.45 ≤ 0` → **스크롤 없음** — 즉 진입 시점 측정값이 그대로 노출된다.
- 어긋남 경로 확증(우선순위): **P1 측정 타이밍** — 초기 등록이 ScrollView onLayout(내비 전환 애니메이션 중 measureInWindow → sx/sy 오염) + 스텝 전환 재등록이 고정 450ms 타이머(Android는 programmatic scrollTo에 onMomentumScrollEnd 미발화 관행 → 장거리 스크롤(영상 y=1620)은 450ms에 **애니메이션 미완 상태를 스냅샷**해 어긋난 rect가 고착). **P2(조건부)** — Modal `statusBarTranslucent`와 measureInWindow 창 기준 불일치(Android 기기별 상태바 높이 상수 오프셋) 가능성: 실기기 로그로만 확정 가능.
- 스크롤 중 표시: 오버레이는 anchor가 있으면 즉시 스포트라이트 렌더 — 이동 중 하이라이트가 구좌표에 떠 있는 현상은 설계상 필연. 사용자 요구 = **포커싱(스크롤 정착) 완료 후에만 영역 표시**.

**F2. ③ Inst 음질 (inst_service.py — EC2 실측 + docs.sunoapi.org 조사 + record-info 실조회)**
- 저장 경로: instrumentalUrl mp3를 **무가공 그대로** MinIO 이관(재인코딩 없음 — 저장본 크기 3,655,773B = Suno 산출물과 바이트 동일 실측). 우리 쪽 열화는 0.
- sunoapi.org vocal-removal: **mp3 전용·음질 파라미터 없음**(공식 문서 + taskId `b77c8bbe…` record-info 실조회로 확정 — instrumentalUrl/vocalUrl mp3 2종뿐, WAV 필드 없음). `/api/v1/wav/generate`는 생성 트랙 전용(분리 결과 미지원 문서화). type=split_stem(50크레딧, 5배)은 12스템 분해로 instrumentalUrl 자체가 null — 재합성 미검증·고비용, 부적합.
- 비트레이트: Inst 179.5kbps/48kHz = 원곡 179.4kbps와 동일 — 비트레이트 열화 아님.
- **핵심 실측: 라우드니스 격차** — 원곡 -13.9 LUFS(TP -1.5dBTP) vs Inst **-21.2 LUFS**(TP -5.6dBTP) = **7.3LU 더 조용함**. "음질이 많이 떨어져 보임"의 주 원인은 음량(라우드니스)으로 판정 — 이건 **개선 가능**. 잔여 분리 아티팩트는 Suno 측 특성으로 개선 불가(정직 판정, 한계 명시).

**F3. ④ Inst 쿨다운 (tracks.py:3042-3195 + fatigue 체계 실측)**
- 작곡 디렉터 fatigue 키 = **"composer"**(DIRECTORS 튜플·앱 FatigueDirector 동일). 일반 곡 생성 훅 = suno_generator.py:553 `on_generation_completed(user_id, db=mongo_db)`(기본 composer, 루프-로컬 db).
- /instrumental 라우트: 현재 게이트 없음. 관행 삽입점 = 기존 검증(409 existing) 통과 후·inst_jobs 클레임/spend **이전**(v3.214 share-video "게이트→과금" 순서). 앱 MyMusicScreen handleCreateInstrumental(:348-386)은 게이트 없음 — MusicGenerationScreen 패턴(getFatigueStatus + showFatigueCooldownDialog(director)) 이식 대상. 맵 휴식 티켓은 composer 이미 대상이라 Inst 쿨다운도 자동 표기(정합 무료).

**F4. ⑤ Inst 커버 (전 경로 실측 — 버그 재현 실패, 데이터 정상)**
- inst_service는 `cover_image_url` 원곡 상속 구현·동작 확인: "냥냥냥 (Inst.)"(6ab349505cd1241ab92b5e5f) DB에 커버 존재, cover-preview 프록시 200, 공개 API 직렬화 `cover_image` 정상 반환 — Inst 파생 트랙은 전 DB에 이 1건뿐이라 **커버 백필 불요**.
- MiniPlayer(:93)·TrackRow(:25)·PlayerScreen(:372)·상세토글 미니바 전부 `cover_image||cover_image_url` 동일 셈법 — 코드 결함 미발견. 유력 잔여 후보 = **재생 store에 cover 필드 결손 스냅샷이 들어오는 경로**(피드 트랙 블록 등 축약 객체로 playTrackNow 호출) → 전 경로 공통 방어(하이드레이션)로 봉합하고 실기기 재현 절차를 tester에 위임.

**F5. ⑥ nowplaying 튜토리얼 (PlayerScreen.tsx:56-60, 1490)**
- 현행 3스텝(재생 위치 이동/가사·제작 노트/담기와 공유, anchor는 player-add 1개). 대상 토글 = swipeUpButton(:1192-1199, 하단 절대배치 "가사 · 제작 노트 · 스타일링 · 댓글") — anchor 등록 지점으로 적합(measureAndRegister 관행, showDetails=false 초기 상태에 항상 노출).
- 튜토리얼 트리거: tutorialGate 실측 — `TUTORIAL_REVIEW_MODE=false` 1줄 전환만으로 "완전 최초 설치('fresh') + 화면·상태별 1회 + 로그인 게이트 화면(map 등)은 최초 로그인 후 첫 진입 노출" = **사용자 요구(최초 앱 접속·최초 로그인) 충족 확인** — 추가 코드 불요(⑦ 오케스트레이터 소관). 유의: 기존 설치 기기는 'existing' 판정·전 화면 seen 선기록이라 미노출 — 검수는 신규 설치로만 가능.

**F6. [편입] 광고 「광고 보고 단축」 버튼 미노출 — 오케스트레이터 분석·픽스 완료분 기재**
- 확정: JS 번들·네이티브 심볼 모두 정상 포함, 원인 후보 = 런타임 require('react-native-google-mobile-ads') throw(TurboModuleRegistry.getEnforcing) → admob=null → 버튼 숨김. catch가 console.log라 원격 로그 무증상. 별건 확정 결함: APK AdMob 앱 ID 불일치(~9961638197 → 콘솔 ~8636830033).
- 적용된 픽스(재수정 불필요): useRewardedSkipAd.ts warn 승격·admobLoadError 보존·init 1회 진단 warn, app.json androidAppId 교정, RNGMA 16.3.2 유지 결정.

## 확정 스펙

### ② 작업실 anchor — 정착 후 표시 + 측정 견고화 [app]
- **TutorialOverlay**: `suspended?: boolean` prop 신설 — visible & suspended면 **전체 딤만** 렌더(구멍·화살표·카드 숨김; 사용자 지시 "이동 중에는 딤만"). false 복귀 시 현행 스포트라이트/폴백 로직 그대로.
- **MapScreen**: `tutorialSettling` state. handleTutorialStepChange(index): ① setSettling(true) ② 대상 스크롤(scrollTo 현행) ③ **정착 감지 = scrollYRef 안정 폴링**(120ms 간격, 연속 2회 |Δ|<0.5 → 정착; 최대 12회=1.44s 안전 타임아웃) — 고정 450ms 타이머 대체(Android momentum 미발화·장거리 스크롤 대응) ④ 정착 후 `InteractionManager.runAfterInteractions`로 registerDirectorAnchors()(진입 전환 애니메이션 오염 차단 — P1 봉합) ⑤ setSettling(false). 스텝 5(생성 이력)는 measureAndRegister 후 즉시 해제. onLayout 초기 등록은 존치(무해·폴백용).
- **P2 검증 로그**: registerDirectorAnchors에 __DEV__ 로그 + 릴리즈 1회 warn(측정 rect vs window 크기) — tester 실기기에서 상수 오프셋 확인 시 Android `StatusBar.currentHeight` 보정 1줄 후속(이번 사이클 조건부 — 미확인 상태 선반영 금지, 이중 보정 리스크).

### ③ Inst 음질 — 라우드니스 정규화 [server_staging_v3215: inst_service.py + 데이터 백필]
- _run_pipeline 4단계(다운로드 후·MinIO put 전) ffmpeg 정규화 삽입:
  `ffmpeg -i in.mp3 -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -b:a 320k out.mp3`
  (목표 -14 LUFS = 스트리밍 표준 ≈ 원곡 실측 -13.9와 일치, TP -1.5 클립 방지, 320kbps 재인코딩 손실 최소화). **best-effort** — ffmpeg 부재/실패 시 원본 그대로 저장(파이프라인 실패 사유 금지), 로그 `[inst] loudnorm applied/skipped`. audio_sha256·duration은 최종 저장본 기준.
- **백필**: 기존 "냥냥냥 (Inst.)" 저장 오디오 1건 동일 정규화 재업로드(+tracks.audio_sha256 갱신) — 배포 절차(DEPLOY.md)에 1회성 스크립트로 포함, 사용자 승인 후 실행.
- **한계 명시(사용자 보고용)**: 분리 아티팩트 자체는 sunoapi.org 처리 특성 — mp3 179kbps 소스 고정, WAV/고음질 옵션·프롬프트 부재(공식 문서+record-info 실조회 확정). 개선분은 음량 정합(7.3LU)까지.

### ④ Inst = 작곡(composer) 쿨다운 [server_staging_v3215: tracks.py + app]
- 서버 tracks.py create_instrumental_version: `_existing` 409 검사 통과 직후·inst_jobs 클레임/spend 이전에 `fatigue_gate_response(current_user["id"], director="composer")` 429(+Retry-After) — 게이트→과금 순서(v3.214 share-video 관행). 성공 시 inst_service._run_pipeline 완료 마킹 후 `on_generation_completed(uploader_id, db=mongo_db, director="composer")` best-effort(suno_generator:553 패턴 — 루프-로컬 db 필수). fatigue_service.py 무변경(composer 기존재).
- 앱 MyMusicScreen handleCreateInstrumental: 확인 다이얼로그 전 `getFatigueStatus('composer')` — cooldown_remaining_sec>0면 `showFatigueCooldownDialog({status, remainingSec, director:'composer', onCleared: 재진입 안내})` 후 중단(조회 실패는 게이트 오픈 — 서버 429 최종 방어, MusicGeneration 관행). POST catch에 429/'director_fatigue' 분기 추가 → 동일 다이얼로그. Inst 1건 = 작곡 사다리 1곡 카운트(일반 곡 생성과 사다리 공유 — 사용자 원문 "작곡 디렉터의 영역" 직해).

### ⑤ Inst 커버/미니플레이어 [app 방어 + tester 재현]
- 서버·데이터 정상 실측(F4) — 서버 변경·백필 불요. 앱 공통 방어: `playTrackNow`(services/playback.ts)에서 재생 대상 track에 `cover_image/cover_image_url` 모두 결손 시 `GET /tracks/{id}` 백그라운드 하이드레이션 → store track/queue 항목 병합(실패 무시) — 어떤 축약 스냅샷 경로로 재생돼도 미니플레이어 커버 보장(store 구독이라 자동 반영). __DEV__ 로그 `[playback] cover hydrate`.
- tester: 실기기에서 Inst 트랙 재생 → 미니플레이어 커버 확인, 미표시 재현 시 진입 경로(내곡/피드/재생목록) 기록.

### ⑥ nowplaying 튜토리얼 교체 [app]
- PlayerScreen TUTORIAL_STEPS 3스텝 전부 제거 → **1스텝**: `{ title: '가사·제작 노트·스타일링', desc: '토글을 열어서 가사와 제작노트 그리고 아티스트의 스타일링을 확인해보세요', anchorKey: 'player-detail-toggle', placement: 'above' }` (문안 사용자 원문 그대로, 제목은 합리 제안 — 하단 토글 라벨과 동일 계열).
- tutorialAnchors: `'player-detail-toggle'` 키 추가. PlayerScreen: swipeUpButton(:1192)에 ref + onLayout `measureAndRegister('player-detail-toggle', …)`, unmount 해제. 기존 player-add 등록(:1155)·해제(:205) 제거(키는 registry에 주석 존치 — search-row-more 관행).
- 트리거(F5): 리뷰 모드 off 1줄로 요구 충족 — 본 계획 코드 변경 없음(⑦ 오케스트레이터).

### [편입] 광고 버튼 — 적용 완료분 (재분석·재수정 금지, 기재만)
- useRewardedSkipAd.ts(경고 승격·진단 로그)·app.json(AdMob 앱 ID 교정) — 오케스트레이터 완료. RNGMA 16.3.2 유지. 실기기 검증은 새 빌드에서만 가능(TESTPLAN 미검증 항목 명시).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| components/TutorialOverlay.tsx | `suspended` prop — 정착 전 전체 딤만 | app-dev | `[TutorialOverlay]` |
| screens/MapScreen.tsx | 정착 폴링(120ms×12)·runAfterInteractions 재등록·settling 연동·측정 로그 | app-dev | `[MapScreen]` |
| screens/PlayerScreen.tsx | 튜토리얼 1스텝 교체·player-detail-toggle 등록/해제 | app-dev | `[PlayerScreen]` |
| utils/tutorialAnchors.ts | 키 'player-detail-toggle' 추가 | app-dev | `[TutorialAnchors]` |
| screens/MyMusicScreen.tsx | Inst 요청 전 composer 게이트 + 429 다이얼로그 | app-dev | `[MyMusicScreen]` |
| services/playback.ts | playTrackNow 커버 하이드레이션 | app-dev | `[playback]` |
| hooks/useRewardedSkipAd.ts | (완료분) warn 승격·진단 로그 | 오케스트레이터 완료 | `[AdReward]` |
| app.json | (완료분) AdMob 앱 ID 교정 | 오케스트레이터 완료 | `[AdReward]` |
| (서버) routes/tracks.py | /instrumental composer 게이트 429 | backend-dev | `[tracks]` |
| (서버) services/inst_service.py | loudnorm 정규화·완료 훅 on_generation_completed('composer') | backend-dev | `[inst]` |
| (데이터) 백필 스크립트 | 냥냥냥 (Inst.) 오디오 정규화 재업로드 1건 | backend-dev | `[inst-backfill]` |

## 40% 룰 판정
앱 6파일(전부 국소 — 신규 화면·스토어 0, 최대 공정 = MapScreen 정착 폴링)+서버 2파일+백필 1건, 완료분 2파일은 기재만. v3.214(앱 8·서버 3)보다 작은 체급 — **초과 아님(가결)**. 이월 후보: loudnorm 2패스 정밀화, split_stem 재합성 실험, P2 상태바 오프셋 보정(실기기 확정 시), RNGMA 17 업그레이드.

## test-designer 항목
1. [unit/app] MapScreen 정착 폴링: 안정 2회 감지 시 재등록 1회·settling 해제, 12회 타임아웃 시 강제 해제(고착 금지), 스크롤 불요 스텝(artist)도 재등록 경유.
2. [unit/app] TutorialOverlay suspended=true → 구멍·카드 미렌더(전체 딤), false 복귀 시 스포트라이트. 기존 rect/pill·폴백 회귀(v3.214 ① 회귀).
3. [unit/app] PlayerScreen 스텝 1개·anchorKey player-detail-toggle·문안 일치, player-add 미참조. playback 하이드레이션: cover 결손 시에만 GET /tracks/{id}·store 병합, 실패 무해.
4. [unit/app] MyMusicScreen: cooldown>0면 confirm 미진입+다이얼로그, POST 429 분기 다이얼로그, 조회 실패 게이트 오픈. useRewardedSkipAd require 실패 경로 admobLoadError 보존+warn 호출(편입).
5. [unit/server] /instrumental: 쿨다운 중 429(+Retry-After)·spend/inst_jobs 미발생(게이트→과금 순서), 성공 파이프라인 완료 시 on_generation_completed(composer) 호출, 실패 시 미호출+환불 현행.
6. [unit/server] loudnorm: ffmpeg 성공 시 320k 재인코딩본 저장+sha 갱신, ffmpeg 실패 시 원본 저장(파이프라인 성공 유지) — 로그 2종.
7. [api] 원격 로깅: release console.warn → frontend.log 전송 배선 확인(편입, 재확인 수준).
8. [e2e(web)] 작업실 튜토리얼: 스텝 전환 중 하이라이트 미표시(딤만)→정착 후 표시(스크린샷), 아티스트 1스텝 pill이 캐릭터 정위치(isNext 펄스 좌표 대비 오차 검증), 6스텝 완주. nowplaying 1스텝: 토글 영역 스포트라이트+카드 above.
9. [통합/스테이징] Inst 생성 E2E: 신규 Inst 라우드니스 실측 -14±1 LUFS·TP≤-1, 커버 상속, composer 쿨다운 발생(사다리 카운트)·429 재요청, 실패 환불 회귀(v3.210). 백필 후 냥냥냥 (Inst.) -14±1 LUFS.
10. [실기기/tester] 새 APK: 미니플레이어 Inst 커버 표시, 쿨다운 팝업 광고 버튼 유무+frontend.log '[AdReward] init' 라인 회수(미검증 항목 — 빌드 후 사용자 확인 절차 REPORT 기재), 작업실 anchor 오프셋 로그 회수(P2 판정). v3.214 회귀: 영상 center 자막·제목 마퀴·video 피로도 429.

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **③ 음질 개선 방식**: 기본안 = 라우드니스 정규화 -14 LUFS/320k(실측 7.3LU 격차 해소 — 요청 "방법이 있다면 적용" 직행). 분리 아티팩트는 API 한계로 개선 불가(WAV·품질 옵션 부재 확정). 무가공 유지 원하면 지시 1줄.
2. **③ 백필**: 기본안 = 기존 냥냥냥 (Inst.) 1건 정규화 재업로드(프로덕션 데이터 변경 — 승인 후 실행).
3. **④ 사다리 공유**: 기본안 = Inst = 작곡 사다리 공동 카운트(그날 일반 곡 + Inst 합산). Inst 별도 사다리 원하면 지시.
4. **⑥ 제목**: 기본안 = '가사·제작 노트·스타일링'. 본문은 사용자 원문 고정.
5. **⑦ 트리거**: 코드 변경 불요 확인(F5) — 기존 설치 기기는 미노출이므로 최종 검수는 신규 설치(스토리지 완전 초기화)로만 가능함을 유의.

규칙: 민감 정보 플레이스홀더(<SSH_HOST>, API 키 로그 금지), 서버 수정은 server_staging_v3215에서만(프로덕션 scp pull 후 작업·_orig 보존), git 커밋은 오케스트레이터 승인 후.


# v3.216 — 웹 소셜로그인 복구·DM 헤더 규격·official 기본 노출·패션브랜드 4,857건 시드·SSUGSIS 초대페이지 (+튜토리얼/Inst 상태 기재)

전제: 앱 = /Users/pearl/TripleJ/2_housing (RN/Expo SDK 54, 1.1.5). 서버 변경은 **server_staging_v3216 신설** — 원본은 **반드시 라이브 EC2(`maidol-ec2` /home/ubuntu/maidol/backend_9004)에서 pull**(scp/rsync) 후 `_orig` 보존·md5 대조. **재발 방지(v3.215 사고)**: v3.215 배포 시 로컬 구사본을 베이스로 빌드해 inst_service.py 짧은URL 픽스(v3.210)가 유실됐다 — 이번부터 (1) 스테이징 파일은 라이브 pull 원본에만 패치, (2) 배포 직전 라이브 현재본 md5 재대조(원본 drift 검출), (3) v3.215 Inst 픽스가 **배포 완료된 후의 라이브본**을 pull(미배포 상태면 pull 대기). 웹앱·홈페이지 소스 = **/Users/pearl/homepage/maidol** (Cloudflare Pages 2프로젝트: `maidol`(www/)=maidol.ai.kr, `maidol-app`(app/ = expo export 산출+app-shell 래퍼)=app.maidol.ai.kr, deploy.sh — Pages 배포는 프로덕션이므로 사용자 승인 후). 관리자 = api.maidol.ai.kr/admin (서버 app/admin_static 정적 mount, main.py:878 — 이번 사이클 무관여). 실측 = EC2 읽기 전용(ssh) + PG/Mongo 읽기 조회.

계획 제외(오케스트레이터 선처리 — 상태만 기재):
- **⑥ Inst 재실패**: 원인 확정 — v3.215 배포가 짧은 토큰 URL 픽스(v3.210) 없는 구베이스로 빌드됨. server_staging_v3215/inst_service.py 에 픽스 복원 완료(import secrets + _PUBLIC_API_BASE + audio-url ready 블록, py_compile 통과, md5 d6c95351). 배포 커맨드 사용자 전달 완료 — **사용자 실행 대기 중**. 실패분 ⭐5 자동 환불 확인. 본 계획은 검증 시나리오만 담당.
- **⑤ 튜토리얼 최초 기준 전환**: TUTORIAL_REVIEW_MODE=false 1.1.5 반영 완료(커밋 dd884f2, tutorialGate.ts:27 + 배포 웹번들 `u=!1` 실측). 본 계획은 재노출 검증 findings + tester 시나리오만.

## 0단계 findings / Plan verification (파일:라인 — 서버는 프로덕션 EC2 실측, 로컬 미러 아님)

**F1. ① 웹 소셜로그인 백지 — 이중 결함 확정 (서버 로그 + 배포 래퍼 실측)**
- 서버측은 **전 단계 성공**: 최근 로그에서 google·kakao 모두 `step=token 200 → step=userinfo 200 → action=login → 302` 완주(호출자 user_id d988bcfd = 김진주 계정 — 사용자 본인의 재현 시도로 판단). 즉 콜백 도달·계정 해석까지 정상.
- **주원인(확정)**: 성공 리다이렉트 = `{frontend_url}/oauth/callback#token=` (oauth.py:60-67, 콜백 말미 RedirectResponse) 인데 프로덕션 `.env` **FRONTEND_URL=http://localhost:8081** — 브라우저가 localhost로 302 = 백지. config.py:166 기본값도 localhost 계열.
- **2차 결함(FRONTEND_URL 교정 후에도 막힘)**: app.maidol.ai.kr 배포 구조 — 루트는 래퍼(homepage/maidol/app-shell/index.html), 앱 본체는 `/app`(expo index.html 개명). `_redirects`/`404.html` 부재로 **모든 미지 경로가 래퍼로 폴백**(실서버 GET: `/`, `/oauth/callback`, `/?ref=SSUGSIS` 전부 래퍼 5390B, `/app`만 앱 1215B). 래퍼 :8 `location.replace('/app')`(모바일)과 :95 `<iframe src="/app">`(PC)가 **hash·query를 폐기** → `#token=`·`?ref=` 유실.
- 클라 보조 결함: SocialLoginButtons.tsx:41-49 웹 분기가 `Linking.openURL(...)` — react-native-web은 `_blank` 새 탭(원 탭은 비로그인 잔류, 탭 간 토큰 전달 장치 없음). 콜백 파서 = App.tsx:461-478(useOAuthCallback, hash `token=`만 파싱, 파싱 후 replaceState). 경쟁조건 후보: App.tsx:522(OAuth)·:527(restoreSession) 동시 실행 시 authStore.ts:95-96·:169가 새 토큰 세션을 되돌릴 수 있음. 보안: utils/remoteLogger.ts:114-117이 `location.href` 로깅 — hash 제거 전 에러 로그에 `#token=` 유출 가능.
- APK는 별도 경로(openAuthSessionAsync + `aidol://oauth/callback` 딥링크, SocialLoginButtons.tsx:24,54-76 / 서버 client=app 분기 oauth.py 기존재) — **웹 전용 증상 맞음**.

**F2. ② DM 창이 상단바를 가림 (DmInboxScreen.tsx:208-215, App.tsx:555-558)**
- DmInbox 자체는 네이티브 헤더 스크린(App.tsx:555 stackHeader '메시지') — 정상. **주원인 = "새 메시지"(수신자 선택) 창이 전체화면 RN `<Modal>`**(DmInboxScreen.tsx:208 `animationType="slide"`, transparent/statusBarTranslucent 없음)이라 네이티브 헤더를 통째로 덮음. `paddingTop: insets.top`(:209)은 상태바만 비우고 헤더(≈56)는 미반영.
- 부원인: DmChat은 headerShown:false(App.tsx:558)에 자체 헤더(DmChatScreen.tsx:296 `paddingTop: insets.top`, 헤더 스타일 :426-430에 높이 56 규격 없음) — 상단바 규격 불일치.
- 선례(v3.214 ②): PolicySheet `variant='sheet'` — `transparent`+`statusBarTranslucent` Modal + `maxHeight = winH - topLimit`(components/PolicySheet.tsx:32-57), 호출측이 useHeaderHeight() 측정(DialogueScreen.tsx:95-96). 웹/네이티브 분기 없음(웹 insets.top=0).

**F3. ③ maidol_official 기본 팔로우 — 서버는 기완비, 앱 작성창이 검색 전용 (프로덕션 실측)**
- 자동 맞팔 **기존재**: 이메일 가입 auth.py(ensure_mutual_follow, provider="local"), 소셜 가입 oauth.py `action=="signup"` 분기(ensure_mutual_follow — 프로덕션 원본 실독), + **startup 전 유저 백필**(official.py 모듈 docstring·main.py). official 계정 실존(users 56fea014, nickname maidol_official). → 팔로우 상태 요건은 이미 충족.
- 실결함 = **DM 작성창이 검색 전용**: DmInboxScreen.tsx:110 빈 검색어면 결과 강제 [](목록 소스는 `GET /dm/users/search` 뿐, :115), 서버 dm_service.py도 `if not q: return []` — 팔로우 목록을 쓰는 코드가 앱·서버 어디에도 없음. official 해석 API `GET /api/dm/official`(dm.py:115-128)와 앱 캐시(services/officialService.ts:21-42) 기존재 — 재사용 가능.
- 유의: 이메일 미인증 유저는 compose가 게이트에 막힘(DmInboxScreen.tsx:166-179, edit 버튼은 살아 있어 무반응 — :96-104 vs :208). official 상대는 서버 DM 게이트 면제(dm_service.py:228-237).

**F4. ④ 패션브랜드 대량 반영 (CSV·이미지 전수 실측 + 서버 임포트 경로 분석)**
- 소스: scratchpad/fashion/MAIDOL_패션브랜드_모음/ — **전체_제품정보.csv 4,857행/85브랜드가 정본**(브랜드별 CSV는 동일 데이터 + 말미 수집메모 행·헤더 중복으로 행수만 부풀음 — 골드퍼센트 대조 실측). 미수집 7브랜드(미수집_브랜드_목록.csv, 사유 기록). 총 4,944파일 1.1GB.
- 스키마: `브랜드,성별,부위,부위내순위,제품명,색상,판매가(원),판매상태,상세페이지URL,이미지파일,이미지유형,이미지원본URL`. 부위 = 상의1,524/하의1,450/모자749/가방734/신발400. 성별 = 여성2,202/공용1,682/남성973. 판매상태 = 판매중4,219/품절638. **이미지 로컬 경로({브랜드}/{이미지파일}) 4,857행 전수 실존·결측 0**. 얼굴 노출 이미지 없음(제품컷 4,133 + 얼굴없는 모델컷 724). (브랜드,부위,제품명,색상) 중복 244건 — 색상 옵션 중복, 문서 단위 삽입이라 무해(비고만).
- 반영 대상 스토어: Mongo `ad_items`(카테고리 ALLOWED = {상의,하의,신발,모자,가방,장소} — business.py:30 v3.206), 이미지 = MinIO 클라이언트로 **AWS S3**(MINIO_HOST=s3.ap-northeast-2.amazonaws.com, settings.minio_bucket_images) `ads/{owner_uid}/{uuid}.ext`. 현황: ad_items 총 455건(상의155/신발153/하의147) — **모자·가방 0건, v3.206 카테고리 개방 후 최초 공급**.
- 기존 admin CSV 임포트(admin_items.py POST /import, dry_run 지원)는 **이번 건에 부적합**: (a) `구분` 플랫폼 6종(무신사/29cm/…) 필수(:48-64, :133) — 브랜드 직납 스키마 아님, (b) 이미지URL **원격 다운로드** 강제(:141-146, :405 httpx) — 원본 쇼핑몰 핫링크 4,857건은 차단·유실 리스크, 로컬 이미지 활용 불가. 선례 = seed_item_store.py(1회성 시드, SEED_TAG='item_images_csv' 멱등, 449건 실적).
- 후속 리스크(반영 후): 공개 조회 `GET /business/ads/active`가 **`$sample 500` 랜덤 캡**(business.py:427-431). 총 ~5.3k가 되면 ArtistCody 악세서리 피커의 **무필터 전량 조회→클라 필터**(ArtistCodyScreen.tsx:327-331) 방식으론 모자·가방이 표본의 ~28%(~140건)만 랜덤 노출. 앱 주석 :316 "서버가 category=모자 400 거부"는 **구정보** — business.py:30에 모자·가방 이미 허용. 단 wishlist.py:25는 자체 구세트 `{상의,하의,신발,장소}` 잔존(모자·가방 미포함) — 위시리스트 카테고리 경로 400 리스크.
- EC2 디스크 여유 120G(145G 중 25G 사용) — 1.2GB rsync 무리 없음.

**F5. ⑤ 튜토리얼 최초 기준 — 검증 findings (tutorialGate.ts 정독)**
- fresh/existing 판정: 마커 `maidol_first_run_v1` 우선(:45-50) → 마커 없고 비튜토리얼 키 존재 시 existing 확정 + **6화면 seen 선기록 마이그레이션**(:59-64) → 완전 빈 스토리지만 fresh(:69-71), 판정 실패 시 미노출(:75-80). 화면 seen 키 6종과 마이그레이션 목록(:33) 전수 일치 실측(player/feed/chart/topbar/map/search). 로그아웃·AsyncStorage.clear 경로 없음 → **기존 설치 기기·기가입 기기 재노출 없음 = 요건 충족**.
- 한계(명기): 판정이 **기기(스토리지) 기준**이라 기가입 계정도 새 기기·새 브라우저·시크릿 창·사이트데이터 삭제·iOS ITP(7일)에선 fresh → 재노출. 계정 서버 동기화는 이월. 또 검수모드 시절 fresh 마커가 찍힌 테스터 기기는 seen 미기록 화면(TutorialOverlay.tsx:124)이 1회 더 뜰 수 있음(정상 종료 조건).
- 웹도 동일 코드(AsyncStorage→localStorage, iframe 동일 origin 공유).

**F6. ⑦ SSUGSIS 초대페이지 (referral 3중 검증 지점 + DB 실측)**
- 코드 체계: 발급 4자(charset 31종 — 0/O/1/I/L 제외, referral_service.py:20-22), 해석 `REFERRAL_CODE_RE=^[charset]{4}$`(:23) — resolve(:99-116)가 형식+active 검증. 가입 소비 = auth.py 이메일 가입 선검증(무효면 가입 거부)→보상 ⭐50×2(referral_inviter/joiner). 앱 입력 = AuthPanel.tsx:38 `REFERRAL_RE`(동일 4자)+:570-578 maxLength=4, 웹 프리필 `?ref=` 대문자화(:41-47, 모듈 로드 1회). 소셜 가입은 ref 미전달(SocialLoginButtons.tsx:41).
- **SSUGSIS(7자, 'I' 포함)는 서버 resolve·가입 검증·앱 입력 3곳 모두 불통과** — 코드 확장 없인 불가.
- 김진주 = users **d988bcfd**(kimpearl@lotusai.co.kr, 기존 코드 5JJY, active, 2026-09-18 가입) — PG 실측. 홈페이지 하단 메일 = **kimpearl@lotusai.co.kr**(homepage/maidol/www/index.html:353·361 mailto 실측, 라이브는 Cloudflare 이메일 난독화로만 노출).
- 랜딩 기존재: `GET /invite/{code}`(referral.py v3.212 HTML, 라우트 가드 `^[A-Za-z0-9]{4,12}$` — SSUGSIS 형식은 통과하나 resolve에서 사망) — CTA 2원화(웹앱 `app.maidol.ai.kr?ref={code}` + Play), UA 분기. **?ref= 자체가 F1 래퍼에서 유실 중**이라 현행 랜딩→웹앱 프리필 체인도 끊겨 있음(래퍼 수정으로 동시 복구).
- `/app?ref=7VFU` 직진입 시 앱 로드 실측(1215B) — 래퍼만 고치면 프리필 체인 성립.

## 확정 스펙

### ① 웹 소셜로그인 복구 [운영 env(사용자 실행) + homepage 래퍼 + app 웹분기]
- **(사용자 실행) EC2 .env `FRONTEND_URL=https://app.maidol.ai.kr` + 컨테이너 재기동** — 배포 커맨드로 전달(프로덕션 변경 승인 관행). 서버 코드 무변경.
- **래퍼**(homepage/maidol/app-shell/index.html): :8 → `location.replace('/app' + location.search + location.hash)`, :95 iframe `src`도 진입 시 search+hash 부착(스크립트로 설정). 앱은 `/app`에서 hash 파싱(App.tsx:466) 기존 로직 그대로 동작. (`_redirects` `/oauth/callback` 302는 옵션 — 래퍼 수정만으로 충족되므로 미채택.)
- **앱 웹분기**(SocialLoginButtons.tsx:43-49): `Linking.openURL` → `window.location.assign(loginUrl)` (같은 탭 이동 — `_blank` 새 탭·비로그인 원탭 잔류 제거). 네이티브 경로(:54-76) 무변경.
- **경쟁조건 방어**(App.tsx:461-478, :522-527): useOAuthCallback이 hash 토큰을 감지하면 restoreSession 스킵(또는 토큰 처리 완료 후 실행) — authStore.ts:95-96·:169의 새 토큰 세션 롤백 차단.
- **토큰 유출 방어**(utils/remoteLogger.ts:114-117): 로깅 href에서 hash strip 1줄(`split('#')[0]`).
- 배포: expo web export + `deploy.sh app`(Cloudflare Pages) — **사용자 승인 후** 오케스트레이터 절차.

### ② DM 상단바 규격 [app]
- **새 메시지 창**: DmInboxScreen 내 전체화면 Modal(:208) 폐지 → **PolicySheet 'sheet' 선례**로 교체: `transparent`+`statusBarTranslucent` Modal + 컨테이너 `top = 헤더 하단`(`useHeaderHeight()` 측정값, 폴백 insets.top+56 — DialogueScreen:95-96 관행) + 하단 시트형 컨테이너. 네이티브 헤더('메시지'·뒤로가기·edit)가 항상 보임 = "상단바 하단으로 창" 요구 직해. (RootStack 스크린 승격 대안은 검색 상태 이관 비용으로 미채택.)
- **DmChat 자체 헤더 규격화**(DmChatScreen.tsx:296-314, :426-430): 높이 56 고정 + 타이틀 상단바 위치 정렬(header-consistency 규칙 — paddingTop 고정값 금지, insets.top+56 규격). 네이티브 헤더 전환은 우측 커스텀 요소 유지 위해 미채택.

### ③ DM 작성창 official 기본 노출 [app — 서버 무변경]
- DmInboxScreen 작성 Modal: **빈 검색어일 때 maidol_official 1행 고정 노출**(현행 빈 배열 :110 대체) — `fetchOfficial()`(officialService 캐시, GET /dm/official) 성공 시 `{id, nickname: 'maidol_official'}` 행 + '공식' 배지, 탭 시 기존 상대 선택 흐름(:132) 그대로. 조회 실패 시 현행(빈 목록+안내 문구) 폴백.
- 팔로우 자동화는 서버 기완비(F3) — 추가 구현 없음. 검색어 입력 시엔 현행 검색 결과만(official이 검색에도 걸리면 중복 제거).
- 미인증 게이트(:166-179)는 현행 유지 — official 행도 게이트 통과자(작성창 진입자)에게만 노출(정책 변경은 결정사안 4).

### ④ 패션브랜드 4,857건 시드 [server_staging_v3216 신규 스크립트 + app 피커 보강 + wishlist 정합]
- **시드 스크립트 신설** `seed_fashion_brands.py`(seed_item_store.py 관행 이식, server_staging_v3216): 입력 = 전체_제품정보.csv + 브랜드 폴더 로컬 이미지(EC2로 rsync ~1.2GB, 디스크 여유 실측 120G). 행별: gender 남성→남성용/여성→여성용/공용→공용, category=부위 그대로(5종 전부 ALLOWED), name=제품명(+색상 suffix — admin_items:434 관행, '대표(…)' 색상은 '기본' 취급), product_url=상세페이지URL, source_rank=부위내순위, 이미지 = **로컬 파일 직업로드**(S3 put_object `ads/{owner_uid}/{uuid}.ext` — 원격 핫링크 다운로드 배제). `SEED_TAG='fashion_brands_csv'` 멱등(재실행 시 태그 문서+S3 오브젝트 제거 후 재삽입 = replace).
- **안전장치**: `--dry-run`(파싱·카테고리/브랜드/성별 집계·이미지 실존 검사만, 쓰기 0 — 이미 로컬 전수검사 결측 0이나 EC2 전송 후 재검), 기본 **판매중 4,219건만**(품절 제외 — 결정사안 2), 업로드 실패 행 skip 목록 리포트, 동시 업로드 8·진행 로그 100건 단위(예상 10~25분). 실행은 배포 절차(DEPLOY.md)에 포함 — **프로덕션 쓰기이므로 사용자 승인 후**.
- **소유 계정**: 신규 1계정 시드(예: fashionbrands@maidol.co.kr / 닉네임 '브랜드샵') — seed_item_store의 플랫폼 계정 upsert 관행. 브랜드 표기는 `brand` 필드(앱 카드가 브랜드명 표시). (결정사안 1)
- **앱 악세서리 피커 전환**(ArtistCodyScreen.tsx:316-331): 무필터 전량 조회 → `?category=모자` + `?category=가방` 2회 호출 합산(서버 이미 허용 — 구주석 :316 삭제). $sample 500 캡과 무관하게 모자 749·가방 734 각각 500 표본 확보. 상의/하의 탭은 기존 카테고리 필터 호출(:301)이라 카테고리당 500 랜덤 = 전시 로테이션으로 수용(캡 상향은 이월).
- **wishlist.py:25 세트 정합**(서버 1줄): `{상의,하의,신발,장소}` → business.py:30과 동일 세트(모자·가방 추가) — 악세서리 위시리스트 400 방지.

### ⑤ 튜토리얼 — 코드 무변경, 검증만
- F5로 요건(최초 접속·최초 로그인, 기존 기기 재노출 없음) 충족 확인 — 변경 없음. tester 시나리오: (a) 기존 설치 기기 업데이트 → 전 화면 미노출, (b) 신규 설치(웹 시크릿) → 로그인 게이트 화면은 최초 로그인 후 1회만, (c) 재로그인·재방문 미재노출. 한계(새 기기 = 기기 기준 재노출)는 REPORT에 정책 한계로 명기.

### ⑥ Inst — 상태 기재 + 검증만
- 스테이징 픽스 복원 완료·사용자 배포 대기(계획 제외 참조). tester: 배포 후 Inst 생성 E2E(성공·짧은 audio-url 로그 확인·⭐5 과금/실패 환불 회귀). **v3.216 서버 스테이징 pull은 이 배포 완료 후 수행**(전제 참조).

### ⑦ SSUGSIS 초대페이지 [server_staging_v3216: referral 2파일 + 1회성 SQL + app 입력 확장 (+F1 래퍼 연동)]
- **커스텀 코드 해석 확장**(referral_service.py): `REFERRAL_CODE_RE` → `^[A-Z0-9]{4,12}$`(normalize 기존 대문자화 유지). 자동 발급(generate_code)은 4자 charset 불변 — 커스텀 코드는 수동 부여 전용. auth.py 가입 검증·/invite 랜딩은 resolve 재사용이라 자동 커버.
- **SSUGSIS 발급**(1회성 SQL, 배포 절차 포함·사용자 승인): `UPDATE users SET referral_code='SSUGSIS' WHERE id='d988bcfd-…'`(김진주). 기존 5JJY는 대체되어 무효화됨을 명기(결정사안 3). referral_code 부분 유니크 인덱스로 충돌 시 실패 = 안전.
- **앱 입력 확장**(AuthPanel.tsx:38, :570-578): `REFERRAL_RE` → `^[A-Z0-9]{4,12}$`, maxLength 12. 프리필(:41-47)은 F1 래퍼 수정으로 `?ref=` 전달 복구 시 그대로 동작.
- **초대 랜딩 카피 개편**(referral.py `_render_invite_html` — 전 코드 공통, 결정사안 5): CTA를 **웹앱 primary 단일화**("웹에서 바로 시작하기" — UA 무관), Play CTA 제거하고 안내 블록으로 대체: "모바일(Google Play) 설치를 원하시면 **구글 계정을 maidol_official DM** 또는 **kimpearl@lotusai.co.kr**(maidol.ai.kr 하단 문의 메일)로 보내주세요 — 테스터 등록 후 설치 안내"(mailto 링크 포함). UA 분기(is_android)·OG는 유지, "이미 설치했다면 열기" 존치.
- 테스트 진입 URL: `https://api.maidol.ai.kr/invite/SSUGSIS`(랜딩) → `https://app.maidol.ai.kr?ref=SSUGSIS`(웹앱 프리필). 소셜 가입 ref 전달(oauth state 경유)은 **이월**(40% 룰).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| (운영 env) backend .env FRONTEND_URL | https://app.maidol.ai.kr + 재기동 — 커맨드 전달, 사용자 실행 | backend-dev(지시서) | `[oauth]` |
| homepage/maidol/app-shell/index.html | replace/iframe에 search+hash 전달 | frontend-dev | `[app-shell]` |
| components/auth/SocialLoginButtons.tsx | 웹 분기 location.assign 전환 | frontend-dev | `[SocialLogin]` |
| App.tsx | useOAuthCallback↔restoreSession 경쟁 방어 | frontend-dev | `[OAuthCb]` |
| utils/remoteLogger.ts | href hash strip(토큰 유출 방어) | frontend-dev | `[remoteLogger]` |
| screens/DmInboxScreen.tsx | 작성 Modal sheet화(헤더 하단) + 빈검색 official 고정 행 | frontend-dev | `[DmInbox]` |
| screens/DmChatScreen.tsx | 자체 헤더 56 규격 정렬 | frontend-dev | `[DmChat]` |
| screens/ArtistCodyScreen.tsx | 악세서리 피커 category=모자/가방 2호출 전환·구주석 정리 | frontend-dev | `[ArtistCody]` |
| components/auth/AuthPanel.tsx | REFERRAL_RE 4-12자·maxLength 12 | frontend-dev | `[AuthPanel]` |
| (서버) services/referral_service.py | 해석 정규식 4-12자 확장 | backend-dev | `[referral]` |
| (서버) routes/referral.py | 랜딩 CTA/안내 카피 개편 | backend-dev | `[invite]` |
| (서버) routes/wishlist.py | ALLOWED 세트 모자·가방 정합 1줄 | backend-dev | `[wishlist]` |
| (서버) seed_fashion_brands.py 신설 | CSV+로컬이미지 → S3+ad_items 시드(dry-run·멱등) | backend-dev | `[fashion-seed]` |
| (데이터) 1회성 SQL | 김진주 referral_code='SSUGSIS' | backend-dev(DEPLOY.md) | `[referral-sql]` |

## 40% 룰 판정
앱 8파일(전부 국소 — 신규 화면·스토어 0, 최대 공정 = DmInbox sheet화)+홈페이지 래퍼 1+서버 3파일+시드 스크립트 1+운영 env/SQL 2건(지시서). v3.214(앱 8·서버 3)와 동급 체급이나 건별 변경폭이 작음 — **초과 아님(가결)**. 이월: 소셜 가입 ref 전달(oauth state), $sample 캡 상향/페이지네이션, 튜토리얼 seen 계정 동기화, admin 임포트의 브랜드 직납·로컬 이미지 모드 지원, 품절 638건 취급 재론.

## test-designer 항목
1. [unit/app] SocialLoginButtons 웹: location.assign 호출(새 탭 미사용)·네이티브 경로 회귀. useOAuthCallback: hash 토큰 시 restoreSession 미실행(또는 후행)·토큰 처리 후 hash 제거. remoteLogger href에 '#' 미포함.
2. [unit/app] DmInbox 작성창: 컨테이너 top=헤더 하단(측정값/폴백 insets.top+56)·statusBarTranslucent·빈검색 시 official 1행(fetch 실패 폴백 빈목록)·검색 시 중복 제거. DmChat 헤더 56 규격.
3. [unit/app] ArtistCody 악세서리: category=모자·가방 2호출 합산·서브탭 필터 회귀. AuthPanel: 4~12자 코드 통과(SSUGSIS)·프리필 대문자화·기존 4자 회귀.
4. [unit/server] referral_service: SSUGSIS resolve 성공(active만)·4자 기존 코드 회귀·발급은 여전히 4자. wishlist 세트에 모자·가방.
5. [unit/server] seed_fashion_brands: dry-run 쓰기 0·집계 일치(판매중 4,219), gender/category 매핑, 색상 '대표(…)'→기본, 재실행 멱등(replace), 실패 행 skip 리포트.
6. [api/스테이징] /invite/SSUGSIS 200 + 랜딩에 웹앱 CTA·DM/메일 안내(카피 실측)·무효코드 404 HTML 회귀. /business/ads/active?category=모자 200.
7. [e2e(web)] 래퍼: app.maidol.ai.kr/oauth/callback#token=t → /app#token=t 보존(모바일 replace·PC iframe 양쪽), ?ref=SSUGSIS → 가입 폼 프리필. 구글/카카오 실로그인 완주(FRONTEND_URL 교정 배포 후) — 백지 재현 소멸 확인.
8. [e2e(web)] DM: 상단바 노출 상태로 작성창·채팅 진입, official 행 탭→DM 전송. 튜토리얼: 시크릿 신규 = 최초 1회만, 기존 스토리지 = 미노출(F5 시나리오 a~c).
9. [통합/프로덕션 반영 후] 패션 시드: ad_items 카테고리별 건수(모자 749↓·가방 734↓ 판매중 기준)·S3 오브젝트 임의 10건 200·앱 악세서리 피커 실표시·기존 455건 무손상. Inst E2E(⑥ 배포 후) + v3.215 회귀(loudnorm·composer 쿨다운·커버).

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **④ 소유 계정**: 기본안 = 신규 1계정('브랜드샵') 일괄 소유, 브랜드는 brand 필드 표기. 85브랜드 개별 계정은 과잉으로 미채택.
2. **④ 품절 취급**: 기본안 = 판매중 4,219건만 시드(품절 638 제외 — product_url이 품절 페이지로 이어지는 UX 방지). 전량 원하면 지시 1줄.
3. **⑦ 5JJY 대체**: 기본안 = 김진주 코드를 SSUGSIS로 교체(기존 5JJY 링크 무효화). 5JJY 병행 유지 원하면 별도 설계 필요(코드 2개 체계 — 이월급).
4. **③ 미인증 게이트**: 기본안 = 현행 유지(official 행은 작성창 진입 가능자에게만). "가입 직후 누구나"로 완화하려면 게이트 정책 변경 지시 필요.
5. **⑦ 랜딩 카피 적용 범위**: 기본안 = 전 초대코드 공통(베타 설치 정책이 동일하므로). SSUGSIS 전용 분기 원하면 지시.
6. **① 배포 순서**: FRONTEND_URL 교정(env+재기동)과 Pages 재배포(래퍼+앱 번들) 모두 사용자 실행/승인 — ⑥ Inst 배포와 묶어 1회 승인으로 처리 제안.

규칙: 민감 정보 플레이스홀더(<SSH_HOST>=maidol-ec2 별칭만 기재, OAuth 키·DB 크리덴셜 로그/문서 기재 금지 — 이번 실측도 키 이름만 확인), 서버 수정은 server_staging_v3216에서만(**라이브 pull 원본** + _orig 보존 + 배포 직전 md5 재대조), 프로덕션 쓰기(env·SQL·시드·Pages 배포)는 전부 사용자 승인 후, git 커밋은 오케스트레이터 승인 후.

# v3.217 — 웹 재생 브라우저 확장(사파리/인앱)·차트 공개↔숨김 토글·대표 아티스트 지정·iOS 웹 시트 가림·보이스 validate 500 픽스·외부 API 헬스체크 관리자·가상 착장 표시

전제: 앱 = /Users/pearl/TripleJ/2_housing (RN/Expo SDK 54). 서버 변경은 **server_staging_v3217 신설** — 원본은 반드시 라이브 EC2(`<SSH_HOST>`=maidol-ec2, /home/ubuntu/maidol/backend_9004)에서 pull(+`_orig` 보존·md5 기록, 배포 직전 라이브 md5 재대조 — v3.215 베이스 착오 재발 방지). 라이브 상태 실측: `referral.py.bak_pre_v3216`·`main.py.bak_pre_v3216b` 존재 = v3.216(+b)까지 반영된 최신본 확인. **EC2는 코드 베이크 — 서버 .py 변경도 docker build 필요, prod 변경 전부 사용자 승인**(maidol-admin-web 관행). 웹 배포 = expo export → /Users/pearl/homepage/maidol/deploy.sh app (Pages, 사용자 승인). 관리자 SPA = api.maidol.ai.kr/admin (서버 app/admin_static mount — main.py:882-884), **소스는 로컬 워크트리** /Users/pearl/TripleJ/.claude/worktrees/distracted-jennings-dc69d7/0_platform_music/admin_web/ (Vite+React SPA, 브랜치 claude/distracted-jennings-dc69d7 — origin 푸시됨, deploy_admin.sh = dist 업로드+docker rebuild+9006 헬스체크). 실측 = EC2 읽기 전용 ssh + Mongo 읽기 조회 + Suno 크레딧 무과금 GET 1회.

## 0단계 findings / Plan verification (파일:라인 — 서버는 프로덕션 EC2 실측)

**F1. ① 웹 백그라운드 재생 — 구조 실태와 기술 한계(솔직 명기)**
- 웹 오디오 = expo-av 웹 구현의 **곡마다 새로 만드는 detached `new Audio()`**(node_modules/expo-av/build/ExponentAV.web.js:159, 이전 요소는 unloadForSound :175-179가 pause+src 제거). **`onended` 리스너 없음** — 곡 끝 판정이 `ontimeupdate`(:160)+`media.ended`(:79) 의존. `setAudioMode`는 웹 no-op(:152) → `staysActiveInBackground`(services/audioMode.ts:14) 웹 무효.
- 재생 경로 2원화: services/playback.ts(:545 stream-proxy, :548-552 createAsync)와 PlayerScreen.tsx(:559-571 — 곡마다 presigned XHR(`GET /tracks/stream/{id}`) 후 play). 웹 프리로드는 차단(playback.ts:261 즉시 return).
- mediaSession: 메타·핸들러 = syncMediaSessionForTrack(playback.ts:39-75→audioMode.ts:39-62), playbackState/positionState = 스토어 구독(playback.ts:80-102→audioMode.ts:67-96). 단 **sync 호출이 playback.ts:562·PlayerScreen.tsx:604 두 곳뿐** — PlayerScreen의 자동 다음곡(:526-555)·프리로드 스왑(:444-465)·관련곡(:481-511)·수동 스킵(:831-863)·routeTrack 교체(:762-798) 전부 미호출 = 곡 전환 후 잠금화면 메타가 이전 곡 잔존.
- 백그라운드·브라우저 대응 코드 0건: visibilitychange/wake lock/keepAwake 직접 사용 없음, **kakaotalk·intent://·사파리 판별 앱/래퍼 통틀어 0건**. 래퍼(homepage/maidol/app-shell/index.html)는 인앱 처리 없음, 모바일이면 :9에서 즉시 `/app` replace.
- **기술 한계(확정적 사실)**: (a) iOS 사파리는 재생 중 화면꺼짐/백그라운드 유지 자체는 가능(mediaSession+audio element)하나, **곡 전환 시 "새 Audio 생성+XHR 후 play()"는 백그라운드에서 autoplay 정책에 차단될 위험** — 단일 element 재사용+`ended` 핸들러 내 동기 src 교체가 표준 관행. (b) 카카오톡 등 **인앱 웹뷰는 웹뷰 suspend로 백그라운드 오디오 대부분 불가 — 코드로 해결 불가**, 외부 브라우저 탈출이 유일 대응(카카오톡 공식 스킴 `kakaotalk://web/openExternal?url=` = iOS/Android 모두 기본 브라우저로 열기, Android는 `intent://…;package=com.android.chrome;end` 크롬 지정 관행 병용 가능). (c) **iOS에서 "크롬으로 강제"는 불가하고 무의미**(iOS 크롬도 WebKit — 백그라운드 특성 동일).

**F2. ② 마이페이지 곡 ⋮ 메뉴 — 공개 방향만 있고 숨기기 부재 (앱 결함, 서버 기완비)**
- ⋮ = 공용 TrackActionSheet + MyMusicScreen extraItems(:913-931). 현행: 재생/좋아요/재생목록/플레이리스트/공유/다운로드/Inst.(조건부 :316-319)/삭제 + **"차트에 업로드"는 `is_public=false`인 곡에만 표시**(:926-928 → handlePublishToChart :292-312 → `PUT /tracks/{id} {is_public:true}` :302). **공개곡을 숨기는 메뉴가 없음** = 사용자 증상("어디에도 업로드하기·숨기기 없음")은 공개 상태 곡에서 메뉴가 아예 안 보이는 것. 공개곡 행엔 "차트 스트리밍 중" 표기(:498-500).
- 서버 기완비: `PUT /api/tracks/{track_id}`(tracks.py:1040, TrackUpdateBody.is_public :732) — 소유자 검증·`report_blinded` 곡 재공개 400(:1059)·track 캐시 무효화. 차트는 **응답 조립 시점에 is_public 재필터**(charts.py:112-121, 장르 :246·카테고리 :282·폴백 :513) → 숨김 즉시 차트에서 소멸(차트 캐시 무관). 발매 기본값 공개(upload Form is_public=True, upload-from-generation :2184, 레거시 무필드=공개 tracks.py:141-145). 비공개 전환 호출 선례 앱 기존재(MusicResultScreen.tsx:499·:569).

**F3. ③ 대표 아티스트 — 서버 완비, 앱은 지정 UI가 처음부터 없음**
- 서버: characters.is_default 체계 완비 — `PATCH /api/character/{cid} {is_default:true}` = 본인 set 후 나머지 전부 false, false 단독은 400(character.py:2701-2886, :2730-2796·:2836-2859), **첫 아티스트 자동 default**(:2065 `used==0`), 삭제 시 real 우선·최신순 승계(:2898-2942), 대표 해석 resolve_representative_artists(:408-432, real/virtual 슬롯별).
- 앱: patchArtist(services/characterService.ts:148-157)와 `PatchArtistBody.is_default`(:56) 기존재하나 **`is_default:true` PATCH 호출 0건**(전수 grep). 대표 배지는 v3.163(bdc971b)에서 제거(MyArtistsScreen.tsx:388 — isDefault 매핑 :120은 잔존·미사용, ArtistResultScreen.tsx:898). MyMusicScreen 아티스트 표시는 is_default→**최신 생성** 폴백으로 대체됨(:241-246). is_default 잔여 사용처는 ArtistCodyScreen.tsx:267·269(성별 필터 폴백)뿐.
- 생성 완료 지점: ArtistLoadingScreen.tsx:176-322(생성→자동 `POST /character/save` :291)→`replace('ArtistResult',{characterId, justCreated:true})`(:319-322). ArtistResult justCreated 하단 [꾸미기]/[아티스트 저장하기](:1128-1149), 수동 저장 handleManualSave(:495-545).

**F4. ④ iOS 웹 하단 팝업 가림 — 근본 원인 = viewport-fit 부재로 웹 insets.bottom=0 + 100vh 계열**
- expo 웹 빌드에 **`public/index.html` 템플릿 없음** → 기본 템플릿 사용(@expo/cli webTemplate.js:68-76) → dist/index.html:6·배포본 app.html:6 viewport = `width=device-width, initial-scale=1, shrink-to-fit=no` — **`viewport-fit=cover` 부재**. html/body/#root height:100%.
- safe-area-context 웹 구현은 env(safe-area-inset-*)를 측정(NativeSafeAreaProvider.web.tsx:103-126) — viewport-fit=cover 없으면 **iOS에서 env=0 → 모든 시트의 insets.bottom 보정이 웹에서 0**. RN Modal 웹 = `position:fixed; top:0; bottom:0`(react-native-web ModalContent.js:52-55) → 시트 하단이 사파리 하단 툴바 뒤로.
- 공통 시트 컴포넌트 없음 — 파일별 복제: PolicySheet:34-39, PlaylistPickerSheet(담기):100-107, TrackActionSheet:94, TrackShareDownloadSheet:167, PurchaseModal:43, AnswerEditModal:76-81, PlayerScreen 큐 시트 :1457, DmInboxScreen:228, ArtistCodyScreen:985 — 전부 `insets.bottom + α` 방식(= 템플릿 수정만으로 일괄 회복). 예외 2건: **LyricsPromptReviewScreen.tsx:305·:569-576 insets 미사용(고정 40)**, App.tsx:250-258 미니플레이어 bottom 49+insets vs 웹 탭바 54(:327) — 5px 겹침. showAlert(AppDialogHost)는 중앙 정렬이라 무관. 래퍼 iframe 높이 100vh(app-shell/index.html:66)는 PC 전용.
- 안드로이드 정상인 이유: 크롬은 동적 툴바가 layout viewport에 반영돼 fixed bottom이 가려지지 않음.

**F5. ⑤ 목소리 만들기 500 — 실패 지점 = sunoapi.org voice/validate 응답 code 500 (로그·DB 실측 확정)**
- 서버 로그(24h, 오케스트레이터 확보): 앱→서버 전 단계 정상(normalize .m4a→mp3 OK → clip → ⭐5 선차감 → S3 업로드 → presign ok=True) 후 `[voice_clone:6ab448ce…] suno voice/validate request voice_host=https://maidol-media-audio-prod.s3…` → **HTTP 200, body `{'code': 500, 'msg': 'Server exception, please try again later or contact customer service'}`** → `_call_validate code=500` → ⭐ 자동 환불(정상 동작) → 앱 "샘플 등록 실패". 2계정·다수 반복 재현.
- Mongo 실측: voice_clones 최근 20건 = failed 8·expired 7·awaiting_verify 1, failed error_message 전부 `validate 거부: validate code=500: Server exception…`. (awaiting_verify 1건 = 과거 validate 성공 이력 존재 — 게이트웨이측 최근 변화 가능성 병존, 확증 실험 필요.)
- 코드 경로: create(routes/voice_clone.py:147-289) → `_save_audio_to_minio`(:115-141, `voice-clones/{user_id}/{clone_id}/{kind}{ext}`, music 버킷) → voice_clone_service `_presign`(:95-108, media_urls.public_presign 24h) → `_call_validate`(:130-169, body=voiceUrl/vocalStartS/vocalEndS/language/callBackUrl :236-243, generic 오류 1회 재시도 :264-282 — 동일 500). **presigned = IAM 토큰 포함 장문 URL**. `_presign` 사용 4곳: create :229·verify :356·retry :574·generate :860.
- **유력 가설(v3.210 Inst 선례 동일)**: 게이트웨이가 장문 presigned URL 처리 실패 — Inst vocal-removal에서 실증됐고 픽스 = 짧은 토큰 302 라우트(`GET /api/tracks/inst-audio/{job_id}/{token}` tracks.py:3007-3042 → RedirectResponse presigned, inst_service.py:216-218 `secrets.token_urlsafe(24)` + `_PUBLIC_API_BASE`). 동일 패턴 이식이 기본안. 앱측은 결함 없음(VoiceCloneWizardScreen.tsx:484 — 402 외 전부 "샘플 등록 실패" 팝업 :479-485, FormData 업로드 voiceService.ts:122-144). Suno V6 전환(v3.177) 무관 — validate body에 모델 파라미터 없음.

**F6. ⑥ 외부 API 전수·헬스체크 (env 키 이름 실측 + 사용 모듈 매핑 + 프로브 실증)**
- 사용 중 외부 API(키 이름↔모듈): sunoapi.org(SUNO_API_KEY/URL — suno_generator·voice_clone_service·inst_service·suno_timestamp), OpenAI(OPENAI_API_KEY — lyrics/gpt-4o-mini·gpt-5.4·openai_image), Anthropic(ANTHROPIC_API_KEY — claude_cache·lyrics_generator), Google Gemini(GOOGLE_API_KEY — character/cover_generator·mv_assets), Kling(KLING_ACCESS/SECRET_KEY — kling_video_generator), KITS(KITS_API_KEY — lyric_recognize_service), fal.ai(FAL_API_KEY — seedance_video_generator), xAI(XAI_API_KEY — grok_video_generator), Sync Labs(SYNC_API_KEY — sync_labs_service), Replicate(REPLICATE_API_TOKEN — mv_pipeline), AWS SES(mailer.py sesv2·인스턴스 롤), AWS Rekognition(AWS_FACE_* — face_verify), AWS S3(MINIO_* — 미디어 전체). **미사용 판정**: LALAL_API_KEY(코드 참조 0)·WONDERA_API_KEY(routes/wondera 레거시 mount 잔존). 내부 의존: PG/Mongo/Redis/ES — 기존 `GET /api/health`(main.py:784)·`/api/ready`(:835) 존재.
- **Suno 크레딧 프로브 실증**: `GET {base}/api/v1/generate/credit` → `{"code":200,"msg":"success","data":9684.0}` (무과금, 잔여 크레딧 표시 겸용 — 이번 실측 1회 호출).
- 관리자 현황: admin.py prefix `/api/admin`(:22)+get_admin_user(Bearer JWT, role=admin), 대시보드(:81) 기존재. SPA 탭 = 대시보드/신고/곡/사용자/착장 아이템/브랜드·광고주(admin_web src/components/Layout.jsx:5-10, 라우트 App.jsx:25-31, axios baseURL '/api' src/api.js:23). 배포 = deploy_admin.sh(dist→app/admin_static + **docker rebuild**).

**F7. ⑦ 가상캐릭터 착장 미표시 — 원인 = 발매 스냅샷 체인이 실사 슬롯 전용 (표시 조건·서버 저장은 정상)**
- 표시 조건에 실사/가상 구분 없음: PlayerScreen 스타일링 탭 = `cover_character.used_items.length>0`(:1320-1321, 없으면 "착장 정보가 없습니다" :1412). cover_character = 발매 시점 스냅샷(tracks.py get_track :1593-1642 — mv_job.user_character_snapshot 우선 :1609-1611, track.user_character_snapshot 폴백 :1612).
- 서버 저장 정상: 가상 생성도 착장 저장됨 — cid 문서는 kind=virtual이라도 `used_items`(character.py:2222, 레거시 슬롯은 virtual_used_items :2215). **Mongo 실측: characters 12건 중 virtual 3(used_items 채워짐 2)·real 2(1)** — 데이터 실존. 앱 생성 페이로드도 실사/가상 동일하게 used_items 전송(ArtistLoadingScreen.tsx:250-277).
- **실결함 = 스냅샷 생성 체인**: (a) 앱 MusicResultScreen.tsx:90-110 fetchCharacterInfo가 `/character/me`의 **실사 슬롯 필드(sheet_object_name/used_items)만** 읽음 — 가상은 별도 `virtual_*` 필드(ArtistResultScreen.tsx:349-350·:429-431)라 미포함, **가상 전용 계정은 sheet 부재로 스냅샷 자체 미생성**(:104-105). (b) 서버 보정 `_build_character_snapshot`(tracks.py:94-140)은 character_id 전달 시 cid 문서의 used_items 사용(kind 무관 — 가상도 커버)하나, **작곡 시 "아티스트 없이 진행"(MusicGenerationScreen.tsx:756) 또는 cid 미전달 경로에선 (a) 폴백만 남음**. 참고: ArtistResult "착용한 제품"은 이미 가상 지원(:832-843) — 아티스트 상세는 정상, 곡 스타일링 탭만 결손.

## 확정 스펙

### ① 웹 재생 브라우저 확장 [app + public/index.html 신설 — 기본안 = (a)+(b) 플랫폼별 조합]
- **(b) 인앱 브라우저 탈출(1순위·저위험)**: `public/index.html` 신설(④와 공유)의 인라인 스크립트 + 신규 `utils/browserEnv.ts` — UA 감지(KAKAOTALK/Instagram/NAVER/Line/FBAV 등). 카카오톡 = 진입 즉시 `kakaotalk://web/openExternal?url=<현재URL(query·hash 보존)>` 자동 시도(iOS·Android 공통 기본 브라우저로 탈출) + 1.5s 내 미이탈 시 안내 배너 폴백. 기타 인앱 = 상단 배너 "외부 브라우저로 열기"(Android = `intent://…;package=com.android.chrome;end` 버튼, iOS = 공유→"Safari로 열기" 안내 문구). 일반 브라우저는 무개입.
- **(a) iOS 사파리 백그라운드 연속재생 개선(축소 스펙·웹 분기 격리)**: services/playback.ts 웹 전용 — expo-av 우회 **단일 HTMLAudioElement 재사용**(src 교체 방식) + `ended` 리스너에서 **사전 프리페치해 둔 다음곡 URL로 동기 src 교체+play()**(웹 프리로드 차단 :261은 유지하되 "URL만 선확보"로 대체) + mediaSession 트랙 sync를 **스토어 구독 단일 지점**으로 이관(currentTrack 변경 구독 → syncMediaSessionForTrack — PlayerScreen 전환 경로 5곳 개별 수정 회피, F1 메타 잔존 결함 동시 해소). 네이티브 경로 무변경.
- **한계 REPORT 명기**: 인앱 웹뷰 내 백그라운드 재생은 미지원(탈출 유도가 대응), iOS 화면꺼짐 중 자동 다음곡은 개선 후에도 보장 불가(실기기 검증으로 판정 기록), iOS 크롬 강제 불가·무의미(WebKit 동일). 대안 (b')"전부 크롬 유도" 단독안은 iOS 불가로 미채택.

### ② 차트 공개↔숨김 토글 [app — 서버 무변경]
- MyMusicScreen extraItems(:926-928) 양방향화: `is_public=false` → "차트에 업로드하기"(현행 유지), **`is_public=true` → "차트에서 숨기기" 신설** — showAlert 2버튼 확인(관행 :292-312) → `PUT /tracks/{id} {is_public:false}` → 목록 상태 즉시 갱신("차트 스트리밍 중" 표기 :498-500 연동). report_blinded 재공개는 서버 400 메시지 그대로 표출. 차트 반영은 서버 응답 시점 재필터(F2)로 즉시.

### ③ 대표 아티스트 지정 [app — 서버 무변경]
- **생성 완료 시 선택**: ArtistResultScreen justCreated 진입(자동 저장 완료 후) — 서버 응답 `is_default=true`(첫 아티스트 자동 대표)면 팝업 생략, 아니면 showAlert 2버튼 "'{이름}'을(를) 대표 아티스트로 지정할까요?" [나중에]/[대표로 지정] → `patchArtist(cid,{is_default:true})`(characterService.ts:148-157 기존 함수). 앱 다이얼로그 관행(showAlert — 시스템 Alert 금지).
- **대표 배지·변경 경로 복원**: MyArtistsScreen 카드에 "대표" 배지(isDefault 매핑 :120 재사용) + 비대표 카드에 "대표로 지정" 액션(동일 PATCH). MyMusicScreen 아티스트 표시(:241-246) = is_default 우선→최신 폴백으로 복원(대표 지정이 실사용 의미를 갖도록).

### ④ iOS 웹 하단 시트 가림 [app — 공통 수정 지점 단일화]
- **`public/index.html` 신설(핵심 단일 지점)**: expo 기본 템플릿 복사 후 (1) viewport에 **`viewport-fit=cover`** 추가 → 웹 insets.bottom 실값 공급 = insets 기반 시트 9곳 일괄 회복(F4 표), (2) html/body/#root **100dvh**(@supports 미지원 폴백 100%), (3) ①(b) 인앱 스크립트 인라인. deploy.sh의 index.html→app.html 개명 흐름 그대로 호환(산출물 head에 반영 확인을 배포 체크에 포함).
- 개별 보정 2곳: LyricsPromptReviewScreen(:305·:569-576) insets.bottom 반영, App.tsx:250-258 미니플레이어 bottom을 웹 탭바 54(:327)와 정합. 래퍼 PC iframe 100vh→100dvh(app-shell/index.html:66) 1줄.

### ⑤ 보이스 validate 500 [server_staging_v3217 — Inst 선례 이식 + 확증 실험]
- **짧은 토큰 302 라우트 이식(기본안)**: voice_clones doc에 `audio_token`(secrets.token_urlsafe(24)) 저장, 신규 `GET /api/voice-clone/audio/{clone_id}/{kind}/{token}`(무인증, token 대조·kind∈{source,verify}, 불일치 404) → RedirectResponse(presigned, 302) — tracks.py:3007-3042 패턴. voice_clone_service `_presign` 사용 4곳(:229 create·:356 verify·:574 retry·:860 generate)을 짧은 URL 조립 헬퍼(`{public_base}/api/voice-clone/audio/…`)로 교체(내부 presign은 302 라우트 안으로 이동).
- **확증 실험(구현 확정 전, 사용자 승인 후 1회)**: 실패한 기존 source 오브젝트를 짧은 302 URL로 voice/validate 1회 실호출 — 성공 = 가설 확정(장문 URL 원인), 실패 = 게이트웨이 장애(외부) 판정 → 픽스는 유지하되 REPORT에 외부 장애 명기 + ⑥ 헬스체크 passive 지표(voice validate 실패 카운트)로 상시 감시. 실험 전 크레딧 소모 여부 확인(check-availability·크레딧 전후 대조).
- 앱 무변경(에러 처리 현행 유지 — VoiceCloneWizardScreen:479-485). ⭐ 환불 로직 정상 동작 실측 — 회귀 확인만. 배포 = docker build(사용자 승인).

### ⑥ 외부 API 헬스체크 → 관리자 [server_staging_v3217 신규 라우트 + admin_web 신규 탭]
- **서버** `routes/admin_health.py` 신설(prefix `/api/admin/health`, get_admin_user) + main.py include 1줄: `GET /external?force=` — 병렬 프로브(httpx, 각 8s timeout), 결과 Redis 캐시 10분(force=true 강제 갱신).
  - **active 프로브(무과금 확실 엔드포인트만)**: suno `GET /api/v1/generate/credit`(잔여 크레딧 표시 — 실증 완료), openai `GET /v1/models`, anthropic `GET /v1/models`, gemini models list, xai `GET /v1/models`, replicate `GET /v1/account`, S3 head_bucket, SES get_account(발신 쿼터 표시), 내부(PG/Mongo/Redis/ES — 기존 /api/health 로직 재사용).
  - **passive(무과금 헬스 엔드포인트 불확실 — 키 설정 여부 + 최근 24h 실사용 성공/실패 카운트)**: kling·kits·fal(seedance)·sync labs·rekognition + **voice validate 실패 카운트(voice_clones, ⑤ 연동)**. 미사용 명기 제외: lalal(참조 0)·wondera(레거시).
  - 응답 shape: `[{service, tier(active|passive), status(ok|fail|unknown), latency_ms, detail(크레딧·쿼터·실패건수), checked_at}]`.
- **admin_web**(워크트리 소스): 신규 탭 "시스템"(/health) — 상태 배지 표·새로고침 버튼(force)·페이지 오픈 중 60s 폴링(서버 10분 캐시라 부하 미미). 변경: src/App.jsx(라우트)·src/components/Layout.jsx(탭)·src/api.js(호출)·src/pages/Health.jsx 신설. 배포 = 빌드 후 deploy_admin.sh(docker rebuild 포함 — 사용자 승인). 주기 백그라운드 수집·알림은 이월.

### ⑦ 가상캐릭터 착장 표시 [app 주 + 서버 무변경]
- **앱 스냅샷 폴백 확장**(MusicResultScreen.tsx:90-110): `/character/me` 실사 슬롯 부재 시 **가상 슬롯(virtual_sheet_object_name/virtual_used_items) 폴백** + 스냅샷에 character_id 포함(있으면 서버 `_build_character_snapshot` 재조립이 우선하므로 가상 cid도 자동 커버 — F7(b)). 작곡 시 선택한 가상 아티스트 cid가 발매까지 전달되는지 검증(MusicGenerationScreen 선택 폴백 — 결손 시 보정 포함).
- 서버 무변경(_build_character_snapshot kind 무관 used_items 사용 확인). 한계 명기: **기존 발매곡(스냅샷 미보유)은 소급 안 됨** — 스냅샷 백필 스크립트는 이월. ArtistResult "착용한 제품"은 회귀 확인만.

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| public/index.html 신설 | viewport-fit=cover·100dvh·인앱 탈출 인라인 스크립트 | frontend-dev | `[WebShell]` |
| utils/browserEnv.ts 신설 | 인앱 UA 감지·탈출 유틸(배너용) | frontend-dev | `[InApp]` |
| services/playback.ts | 웹 단일 audio 재사용·ended 연속재생·URL 프리페치·mediaSession 구독 sync | frontend-dev | `[WebAudio]` |
| services/audioMode.ts | (필요 범위) sync 헬퍼 보강 | frontend-dev | `[WebAudio]` |
| App.tsx | 인앱 배너 mount·미니플레이어 웹 탭바 정합 | frontend-dev | `[InApp]` |
| screens/LyricsPromptReviewScreen.tsx | 하단 insets 반영 | frontend-dev | `[SheetInset]` |
| screens/MyMusicScreen.tsx | ⋮ "차트에서 숨기기" 신설·상태 갱신·(③)대표 우선 복원 | frontend-dev | `[ChartToggle]` |
| screens/ArtistResultScreen.tsx | justCreated 대표 지정 팝업 | frontend-dev | `[DefaultArtist]` |
| screens/MyArtistsScreen.tsx | 대표 배지·지정 액션 복원 | frontend-dev | `[DefaultArtist]` |
| screens/MusicResultScreen.tsx | 스냅샷 가상 슬롯 폴백·character_id 포함 | frontend-dev | `[VirtualOutfit]` |
| homepage/maidol/app-shell/index.html | iframe 100vh→100dvh | frontend-dev | `[WebShell]` |
| (서버) routes/voice_clone.py | audio 302 라우트 신설·audio_token | backend-dev | `[VoiceFix]` |
| (서버) services/voice_clone_service.py | _presign 4곳 → 짧은 URL 헬퍼 | backend-dev | `[VoiceFix]` |
| (서버) routes/admin_health.py 신설 + main.py 1줄 | 외부 API 헬스 프로브·캐시 | backend-dev | `[HealthCheck]` |
| (admin_web) App.jsx·Layout.jsx·api.js·pages/Health.jsx 신설 | "시스템" 탭 상태 표 | frontend-dev | `[HealthCheck]` |

## 40% 룰 판정
앱 10파일 + 래퍼 1 + 서버 3(+main 1줄) + admin_web 4 = 역대 상위 체급이나, 최대 공정은 ①(a) playback 웹 분기 1개(격리·네이티브 무변경)이고 나머지는 전부 국소(메뉴 1항목·팝업 1개·폴백 1블록·템플릿 1파일·선례 이식 라우트). **조건부 가결** — ①(a)가 구현 중 웹 회귀를 만들면 ①(b)+④(탈출·시트 가림)만 남기고 ①(a)는 차기 분리(replan 규칙). 이월: 인앱 웹뷰 내 재생(불가 판정), 기존 곡 스냅샷 백필, 헬스체크 주기 수집·알림, kling/kits/fal/sync active 프로브 승격, PlayerScreen↔playback 재생 경로 이원화 통합, wondera/lalal 키·라우트 정리.

## test-designer 항목
1. [unit/app] browserEnv: UA 판정(카카오/인스타/네이버/일반), 탈출 URL에 query·hash 보존. MyMusic ⋮: 공개곡="차트에서 숨기기"·비공개곡="차트에 업로드하기" 상호 배타, PUT payload, 실패 시 상태 롤백.
2. [unit/app] 대표 지정: justCreated & is_default=false에서만 팝업, [대표로 지정]→patchArtist({is_default:true}), 첫 아티스트(is_default=true) 팝업 생략. MyArtists 배지·지정 액션. MyMusic 대표 우선 표시 회귀.
3. [unit/app] MusicResult 스냅샷: 실사 있음=현행, 실사 없음·가상 있음=virtual_* 폴백+character_id 포함, 둘 다 없음=스냅샷 생략.
4. [unit/web] playback 웹: 단일 element 재사용(곡 전환 시 new Audio 미생성), ended→프리페치 URL 동기 재생, currentTrack 구독 시 mediaSession 메타 갱신(수동 스킵·자동 전환 공통), 네이티브 경로 무변경 회귀.
5. [unit/server] voice_clone: 짧은 URL 조립(4 경로), audio 302 라우트 token 불일치 404·kind 검증·Location=presigned. admin_health: 프로브 집계 shape·타임아웃 fail 처리·redis 캐시/force·비admin 403.
6. [api/스테이징] `GET /api/voice-clone/audio/{id}/{kind}/{token}` 302 실측, `GET /api/admin/health/external` 200(suno detail에 크레딧 수치).
7. [실험·사용자 승인 후] 확증: 실패 source의 짧은 302 URL로 voice/validate 1회 — code 200/taskId 수신 여부 판정 기록(크레딧 전후 대조 포함). 반증 시 게이트웨이 장애 판정 절차(⑤ 스펙).
8. [e2e(iOS 실기기 web)] 사파리: 화면꺼짐 중 재생 유지·곡 전환 여부(판정 기록), 담기 시트·TrackActionSheet·큐 시트가 하단 툴바에 안 가림(④), 잠금화면 메타 곡 전환 추종. 카카오톡 인앱: 링크 진입→외부 브라우저 자동 탈출(또는 배너), 안드로이드 크롬 intent 버튼.
9. [e2e(web)] 차트: 공개곡 숨기기→차트 목록 즉시 소멸→재공개 복귀. 가상 아티스트로 신규 발매→스타일링 탭 착장 표시(기존 곡 미소급 확인). 보이스: 배포 후 샘플 등록→awaiting_verify 도달(E2E 완주)·⭐ 과금/실패 환불 회귀.
10. [admin] 시스템 탭: 상태 표 렌더·새로고침(force)·suno 크레딧 표시, 기존 탭(곡/사용자 등) 회귀.

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **① 범위**: 기본안 = (a) 사파리 재생 개선 + (b) 인앱 탈출 동시 진행(①(a)는 회귀 시 차기 분리 조건부). "크롬 강제 단일안"은 iOS 불가로 미채택 — (b)의 Android 크롬 intent가 그 취지를 흡수.
2. **⑤ 확증 실험**: 짧은 302 URL로 voice/validate 1회 실호출 필요(외부 API 호출·크레딧 무소모 확인 후 진행) — 승인 요청. 미승인 시 실험 생략하고 픽스 배포 후 E2E로 판정.
3. **③ 대표 복원 범위**: 기본안 = 생성 팝업 + MyArtists 배지/지정 + MyMusic 대표 우선 표시까지. 팝업만 원하면 지시 1줄.
4. **⑥ 프로브 범위**: 기본안 = 무과금 확실 8종 active + 5종 passive. kling/kits/fal/sync active 승격은 무과금 확인 후 이월.
5. **⑥ admin_web 소스 위치**: 기본안 = 기존 워크트리(claude/distracted-jennings-dc69d7)에서 계속 작업·배포. frontend 브랜치로 편입 원하면 지시(별도 이관 공정).
6. **배포 묶음**: (i) 서버 docker build(⑤⑥) (ii) admin_web deploy_admin.sh(⑥) (iii) Pages 재배포(①②③④⑦ 웹 번들+래퍼) — 3건 모두 사용자 실행/승인, 1회 승인으로 묶음 처리 제안.

규칙: 민감 정보 플레이스홀더(<SSH_HOST>=maidol-ec2 별칭만, API 키·DB 크리덴셜 기재 금지 — 이번 실측도 키 이름·크레딧 수치만 기록), 서버 수정은 server_staging_v3217에서만(**라이브 pull 원본** + _orig 보존 + 배포 직전 md5 재대조), 프로덕션 쓰기(docker build·admin 배포·Pages 배포·외부 API 실험 호출)는 전부 사용자 승인 후, git 커밋은 오케스트레이터 승인 후.

# v3.219 — 작업실 "작업 시작" 말풍선 아티스트 우선화 + 5개 디렉터 작업 중 상태 보존(이탈·재진입 이어가기)

전제: 앱 = /Users/pearl/TripleJ/2_housing (RN/Expo SDK 54) 단독 — **서버 무변경**(원격 읽기 조회만 수행, 쓰기 없음). 사용자 요청 원문 2건: ① 작업실 클릭 유도 말풍선("클릭해서 작업 시작!")이 작사 디렉터에 붙음 → 아티스트 디렉터로, ② 각 디렉터 작업 도중 뒤로가기/타 페이지 이동 시 작업 내용이 처음으로 초기화되는 문제 수정. 참조 이력: 2026-09-07 가사 유실 사고(핫리로드가 메모리 store 초기화 — v3.133에서 lyricsStore AsyncStorage persist로 봉합), v3.202(H-⑤) 커버 대화 store 영속(검증된 보존 패턴 — 이번 이식의 원형), v3.105 아티스트 '이어서 만들기'.

## 0단계 findings / Plan verification (전부 현행 코드 직접 정독 — 파일:라인)

**F1. ① 말풍선 결정 로직 — 작사로 가는 원인 = 다음 액션 체인에 '아티스트' 단계 자체가 없음**
- 말풍선("▸ 클릭해서 작업 시작!")·펄스는 `isNext = user && d.type === nextActionDirector && !isResting`(MapScreen.tsx:700, 배지 :726-746, 펄스 :706-724). 결정 로직 = `nextActionDirector: DirectorType = !lyricsDone ? 'lyricist' : !musicDone ? 'composer' : 'image'`(:659-663, lyricsDone=`lyricsStore.generatedLyrics`(:657)·musicDone=`musicStore.savedTrackId`(:658)).
- **체인이 작사→작곡→커버로만 구성 — 'artist'가 후보에 없다.** 신규/작업 없음 상태는 항상 `!lyricsDone` → 작사 디렉터에 붙는 것이 현재 증상의 정확한 원인. 발매 완료 시 lyricsStore.reset()(MusicResultScreen.tsx:524·:589)으로 다시 작사로 회귀.
- 아티스트 보유 여부는 이미 화면에 있음: `hasArtistCharacter` — focus 시 `GET /character/me`로 실측(MapScreen.tsx:381-403, 실사/가상 시트 하나라도 있으면 true :395). 단 **초기값 false(useState(false) :245) + 비동기 조회** — 이 값을 말풍선 분기에 쓰면 조회 완료 전 잠깐 아티스트 보유자에게도 아티스트 말풍선이 깜빡이는 레이스 있음(3상태 필요).
- 말풍선은 user 있을 때만(게스트 미표시 :700) — 현행 유지 대상.

**F2. ② 흐름별 상태 저장·리셋 실태 (5개 디렉터 전수)**

공통 구조: Studio 탭 = native-stack(App.tsx:186-249). **탭 이동은 스택이 유지돼 화면 state 보존**(bottom-tabs 기본, unmountOnBlur 미사용 — App.tsx 전수 grep 0건). 초기화가 일어나는 경로는 (a) **뒤로가기(pop)로 화면 언마운트**(각 화면이 헤더에 goBack/navigate('Map') 주입), (b) **앱 재시작·핫리로드(메모리 store 소실)**, (c) 진입 시 초기화 effect. 로그아웃은 playerStore만 리셋(authStore.ts:151-157) — 작업 draft는 어느 store도 안 지움(계정 전환 오염 리스크, F3).

| 흐름 | 진행 상태 위치 | 리셋 원인(파일:라인) | 기존 보존 장치 |
|---|---|---|---|
| 아티스트 생성 | ArtistInputScreen **로컬 useState**: step·chat·qIndex·styleAnswers·currentInput·selectedKind·pendingConceptText(:159-193) | 헤더 ← = navigate('Map')(:202) → pop 언마운트로 Q&A 전량 소실. store(characterTaskStore, **비영속** zustand)엔 마일스톤에만 기록: 사진 확약(:300)·kind 선택(:343)·Q&A 완료(:473,:494)·화풍 확정(:413) | v3.105 '이어서 만들기'(:531-538) — **Cody 취소(restore param)·생성 실패(apiError) 시에만** 노출, 재개 지점도 의상 선택뿐(Q&A 도중 이탈은 무보존) |
| 작사 | LyricsInputScreen **로컬 useState**: step·chatHistory·durationLabel(:113-120). 답변 자체는 스텝마다 lyricsStore(영속)에 즉시 기록(processAnswer :156-175) | 헤더 ← goBack(:139) → 언마운트로 step/chatHistory 소실 = **재진입 시 1번 질문부터**(store엔 이전 답이 남아 제출 시 조용히 섞임). 진입 effect가 store.setStyle('') 리셋(:123). 주석이 현상 자인: "chatHistory는 로컬 state라 이탈 시 초기화됨"(:129-130) | lyricsStore = AsyncStorage persist(v3.133, lyricsStore.ts:75-112 — **generatedPrompt는 partialize 제외** :104-110). 프롬프트 생성 후엔 '요청사항으로 돌아가기' 버튼(:365-374)으로 리뷰 복귀 가능 |
| 작곡 | MusicGenerationScreen **로컬 useState 약 30개**: step·chatHistory(:106-114)+답변 상태(editedTitle/editedLyrics/selectedGenre/Mood/보컬/persona/suno 파라미터 :117-165) | 뒤로가기 pop 언마운트 → 대화 전체 소실. 마운트 effect가 artistCharacterId 강제 초기화(:184-186, v3.156a "마운트=새 대화" 전제 — 복원 도입 시 충돌 지점). musicStore는 **비영속**(musicStore.ts:173 — persist 없음, reset() 호출처 없음 :181) | 스택 push 이동(아티스트 디렉터 다녀오기 등)은 보존(:272-273 주석·useFocusEffect 재조회 :274-278). 언마운트 보존은 전무 |
| 커버 | **v3.202(H-⑤)로 이미 store 보존** — chatHistory/step을 musicStore.coverMessages/coverStep에 미러링(CoverGenerationScreen.tsx:282-288), 마운트 시 hydrate(:137-154)·보강답변 스냅샷 복원(:256-278)·성공 확정 시에만 clearCoverContext(:186-198) | 잔여 공백: musicStore 비영속 → **핫리로드·앱 재시작 시 소실**(2026-09-07 유형). 앨범 모드는 의도적 미보존(:129) | 곡 선택·아티스트 포함·대기 이어보기(hasPendingGeneration :133-134)까지 복원 — 5개 중 유일하게 화면 이탈 보존 완비 |
| 영상 | VideoDirectorScreen **로컬 useState 전량**: chat·selected(곡)·step·picked* 스타일 파라미터 13종(:79-105) | 뒤로가기 pop 언마운트 → 곡 선택·스타일 조합 전량 소실 | 없음(succeededSigsRef 캐시 시그니처도 세션 로컬 :112). 텍스트 입력물은 없고 전부 선택지 |
| (공통 관문) Dialogue | currentIndex 로컬(DialogueScreen.tsx:90) | 언마운트 소실 | 2노드 인사 대화뿐, 사용자 입력 없음 — **보존 대상 아님(명기)** |

**F3. 회귀 위험 실측**
- (a) **잔존 오염**: 작사 store는 이미 영속이라 "새로 시작"과 "이어가기"가 구분 없음 — 현재는 화면이 매번 step 0부터라 덮어써서 가려짐. 복원 도입 시 명시적 초기화 액션 필요. 작곡은 마운트 초기화(:184-186)가 유일한 오염 방어 — 복원과 양립 설계 필요. 커버는 coverTrackId 키·성공 시 클리어로 기해결.
- (b) **커버 자동 재생성 재차감**: `hasPendingGeneration = coverTrackId && coverStyle != null`(:133-134)이면 마운트 즉시 loading 재개 — **musicStore를 persist할 경우 coverStyle까지 영속되면 앱 재시작 시 자동 생성 재발화(⭐ 재차감) 위험** → persist 대상에서 제외 필수.
- (c) **계정 전환**: logout이 작업 draft 미청소(F2 공통) — A 로그아웃→B 로그인 시 A의 가사 draft(영속)·커버 대화(메모리) 노출 가능. 현행에도 존재하던 기위험이나 보존 강화로 노출면 확대.
- (d) 아티스트 photoUri는 로컬 임시 파일 URI — 앱 재시작 후 파일 소멸 가능, AsyncStorage 영속 부적합(메모리 보존만).

## 확정 스펙

### ① 말풍선 아티스트 우선화 [MapScreen.tsx — 로직 수정(고정 아님)]
- `nextActionDirector` 체인 선두에 아티스트 단계 삽입: **`hasArtist === false ? 'artist' : (!lyricsDone ? 'lyricist' : !musicDone ? 'composer' : 'image')`**. 고정 'artist'가 아닌 이유: 아티스트 기보유자에게 아티스트 말풍선은 무의미(대화가 '내 아티스트 보러가기'로 빠짐 — DialogueScreen.tsx:157-171). "작업 시작 = 아티스트부터"라는 요청 취지를 제작 순서(아티스트→작사→작곡→커버)로 일반화.
- 레이스 봉합: `hasArtistCharacter`를 boolean→**3상태(null=조회 전)**로. null 동안은 말풍선·펄스 미표시(조회 완료 후 표시 — 보유자에게 아티스트 말풍선 깜빡임 방지). 조회 실패 시 기존대로 false(=아티스트 유도, 무해).
- 게스트 미표시(user 게이트 :700)·휴식 중 미표시(!isResting) 현행 유지. 로그: `[NextAction] 말풍선 대상 산출 {hasArtist, lyricsDone, musicDone → target}`.

### ② 디렉터 작업 보존 — 커버(v3.202 H-⑤) 패턴을 나머지 4흐름에 이식 + 영속 보강
공통 원칙: **진행 대화(chatHistory/step)+답변을 store에 미러링 → 마운트 시 hydrate → 완주(발매·저장 성공) 시에만 클리어 + 재진입 환영 버블에 '처음부터 다시' 액션 제공**(이어가기 기본). AsyncStorage persist는 **사용자 텍스트 입력물이 있는 흐름만**(2026-09-07 정책 — 전 흐름 persist는 과잉·(b)(d) 리스크).

- **(A) 작사 [LyricsInputScreen + lyricsStore]**: lyricsStore에 `draftStep`·`draftChat`(ChatMessage[]) 추가, processAnswer/재선택 시 동기 기록. 마운트 시 draftStep>0이면 hydrate(진행도·대화 복원, durationLabel은 duration에서 역산). **partialize에 draftStep/draftChat 포함**(텍스트 답변 = 사용자 생성물, 핫리로드 생존 — 사고 이력 직결). `generatedPrompt`도 partialize 추가(현재 누락 :104-110 — '요청사항으로 돌아가기' 버튼이 재시작 후 소실되는 부수 결함 동시 봉합). 클리어 = 기존 reset() 지점(발매 MusicResultScreen.tsx:524·:589) + '처음부터 다시' 액션(reset 후 step 0). 진입 setStyle('')(:123)은 draft 복원 시 스킵. 로그 `[LyricsDraft]`.
- **(B) 아티스트 생성 [ArtistInputScreen + characterTaskStore]**: characterTaskStore에 `draft { step, chat, qIndex, styleAnswers, selectedKind, pendingConceptText }` 추가, 변경 시 미러링·마운트 시 hydrate. **키 검증**: 재생성 진입(targetCharacterId)·forceKind가 draft와 다르면 draft 폐기(오염 방지). 기존 '이어서 만들기'(restore/apiError → 의상 재개)는 현행 유지 — draft 복원은 그보다 앞 단계(Q&A 도중)를 커버. 클리어 = 생성 성공 저장(ArtistResultScreen taskStore.reset() 기존 지점 :502·:614·:645·:686 승계) + '처음부터'. **persist는 styleAnswers·pendingConceptText 텍스트만 AsyncStorage 병행**(photoUri 등 파일 URI 제외 — F3(d)). 로그 `[ArtistDraft]`.
- **(C) 작곡 [MusicGenerationScreen + musicStore]**: musicStore에 `composeDraft { chatHistory, step, answers(editedTitle/editedLyrics/selectedGenre/selectedMood/보컬 3종/서브보컬/persona 선택/suno 파라미터 on·값), lyricsKey }` 단일 스냅샷 추가(커버 coverMessages 관행), `[chatHistory, step]` effect로 미러링·마운트 시 hydrate. **lyricsKey = lyricsSource.lyrics_id ?? lyrics 해시** — 다른 가사로 진입(ComposeLyricsPick handlePick :184-210·연주곡 :234-238) 시 draft 불일치 → 폐기 후 새 대화(잔존 오염 차단). 마운트 artistCharacterId 초기화(:184-186)는 **draft 미복원(새 대화) 분기에서만** 실행. 클리어 = 발매 성공(MusicResult 저장 성공 — lyricsStore.reset()과 동일 지점) + '처음부터'. persist 제외(선택지 위주·editedLyrics 원본은 lyricsStore가 이미 영속 — 기본안). 로그 `[ComposeDraft]`.
- **(D) 커버 [CoverGenerationScreen — 소폭]**: 화면 이탈 보존은 기완비 — 회귀 검증 중심. 보강 1건: musicStore persist 도입 시 **cover 대화 필드(coverMessages/coverStep/coverExtrasSnapshot/coverLyrics*)만 partialize 포함, coverStyle·coverTrackId는 제외**(F3(b) 자동 재생성 재차감 차단)… 단 coverTrackId 없이는 재시작 복원 문맥이 불완전하므로 **기본안 = 커버는 persist 미적용(메모리 보존 현행 유지)**, 핫리로드 생존은 이월 검토. 로그 기존 `[Cover]` 유지.
- **(E) 영상 [VideoDirectorScreen + musicStore(or 신규 videoDraft slice)]**: `videoDraft { selectedTrackId/Title, step, chat, picked* 13종 }` store 미러링·hydrate. 마운트 시 draft의 트랙이 내 곡 목록에 없으면(삭제 등) 폐기. **스타일 파라미터는 완주 후에도 sticky 유지**(다음 영상에 이전 취향 승계 — creationMode sticky 관행), step/chat/선곡만 저장·공유 완료 시 클리어 + '처음부터'. persist 제외(전부 선택지). 로그 `[VideoDraft]`.
- **(공통) 계정 전환 청소**: authStore.logout(:151-157)에 draft 일괄 클리어 추가 — characterTaskStore.reset()·musicStore composeDraft/videoDraft/cover 컨텍스트 클리어. **lyricsStore는 현행대로 유지(기본안)** — 가사 텍스트는 사용자 생성물(유실 사고 이력), 기기 공유 계정 전환 오염보다 보존 우선. 결정 사안 3.
- Dialogue 관문(2노드 인사)은 보존 제외 명기(F2 표).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| screens/MapScreen.tsx | nextActionDirector에 artist 단계 삽입·hasArtistCharacter 3상태·null 중 말풍선 유보 | frontend-dev | `[NextAction]` |
| stores/lyricsStore.ts | draftStep/draftChat 추가·partialize에 draft+generatedPrompt 포함 | frontend-dev | `[LyricsDraft]` |
| screens/LyricsInputScreen.tsx | draft 미러링·hydrate·'처음부터 다시'·setStyle('') 복원 시 스킵 | frontend-dev | `[LyricsDraft]` |
| stores/characterTaskStore.ts | draft 필드 추가(+텍스트만 AsyncStorage persist 래핑) | frontend-dev | `[ArtistDraft]` |
| screens/ArtistInputScreen.tsx | draft 미러링·hydrate·키 검증(targetCharacterId/forceKind)·'처음부터' | frontend-dev | `[ArtistDraft]` |
| stores/musicStore.ts | composeDraft·videoDraft 필드/세터 추가(persist 미도입 — 기본안) | frontend-dev | `[ComposeDraft]`·`[VideoDraft]` |
| screens/MusicGenerationScreen.tsx | composeDraft 미러링·hydrate·lyricsKey 불일치 폐기·마운트 초기화(:184) 새 대화 분기 한정·'처음부터' | frontend-dev | `[ComposeDraft]` |
| screens/MusicResultScreen.tsx | 발매 성공 시 composeDraft 클리어(lyricsStore.reset() 동일 지점 2곳) | frontend-dev | `[ComposeDraft]` |
| screens/VideoDirectorScreen.tsx | videoDraft 미러링·hydrate·트랙 소멸 검증·저장/공유 완료 클리어·스타일 sticky | frontend-dev | `[VideoDraft]` |
| screens/CoverGenerationScreen.tsx | (수정 최소) 회귀 검증 중심 — 필요 시 '처음부터' 액션 정합만 | frontend-dev | `[Cover]` |
| stores/authStore.ts | logout 시 draft 일괄 클리어(lyricsStore 제외 — 기본안) | frontend-dev | `[DraftKeep]` |

## 40% 룰 판정
앱 11파일이나 전부 프론트 단독·서버 무변경, 핵심 공정은 **검증된 v3.202(H-⑤) 패턴의 3회 반복 이식(작사/아티스트/영상) + 작곡 1회(최대 난도)**. 작곡(MusicGenerationScreen 2,478줄·로컬 state 약 30개)이 최대 리스크 — **조건부 가결**: (C) 작곡 draft가 구현 중 대화 커밋(commitExchange :314-)·되감기(rewindRef)와 충돌해 회귀를 만들면, (C)만 "chatHistory/step+가사·장르·분위기 핵심 5필드 축소 보존"으로 강등 또는 차기 분리(replan 규칙)하고 ①·(A)·(B)·(E)·공통 청소는 그대로 출하. 이월: 커버 대화 AsyncStorage 영속(재차감 안전장치 설계 선행), 앨범 모드 커버 보존, Dialogue 관문 보존, 작곡 draft persist.

## test-designer 항목
1. [unit] MapScreen nextActionDirector: (아티스트 없음)→artist, (있음·가사 없음)→lyricist, (가사 있음·미발매)→composer, (발매)→image, 조회 전(null)→말풍선 미표시, 게스트 미표시, 휴식 중 미표시.
2. [unit] lyricsStore: draft partialize 왕복(직렬화/복원), generatedPrompt 영속, reset()이 draft까지 초기화. LyricsInput: step 5 이탈→재진입 시 대화·진행도 복원, '처음부터 다시'→step 0+store 초기화, 복원 시 setStyle('') 미실행.
3. [unit] ArtistInput: Q&A 3답 후 이탈→재진입 복원, 재생성 진입(targetCharacterId 상이)→draft 폐기, forceKind 상이→폐기, 생성 성공 저장→draft 클리어, 기존 '이어서 만들기'(restore/apiError) 회귀.
4. [unit] MusicGeneration: step N 이탈→재진입 복원(chatHistory·답변), 다른 가사 선택(lyricsKey 상이)→새 대화+artistCharacterId 초기화 실행, 같은 가사 재진입→초기화 미실행, 되감기(rewind)·비파괴 치환 회귀, 발매 성공→composeDraft 클리어.
5. [unit] VideoDirector: 스타일 5개 선택 후 이탈→재진입 복원, draft 트랙 삭제됨→폐기, 저장 완료→선곡/step 클리어+스타일 sticky 유지.
6. [unit] logout: characterTask/composeDraft/videoDraft/cover 컨텍스트 클리어, lyricsStore 잔존(기본안), 게스트 재진입 시 말풍선 미표시.
7. [e2e 회귀 — 정상 완주 5종] ⑴ 아티스트 생성(Q&A→의상→생성→저장) ⑵ 작사 완주(11스텝→프롬프트→가사 생성) ⑶ 작곡 완주(가사 선택→대화→생성→발매, 발매 후 draft·lyricsStore 클리어 확인) ⑷ 커버 완주(곡 선택→대화→생성→확정 — v3.202 보존·성공 클리어 회귀) ⑸ 영상 완주(선곡→스타일→생성→저장). 각각 "도중 뒤로가기→작업실→재진입 이어가기"와 "탭 이동→복귀"를 끼워서 완주.
8. [e2e] 핫리로드/앱 재시작: 작사 draft(텍스트) 생존 — 2026-09-07 시나리오 재현 테스트. 커버 pending(coverStyle 확정 후 이탈→재진입)이 자동 재생성 1회만 수행(재차감 없음 — 기존 동작 회귀).
9. [e2e] 말풍선: 신규 계정 로그인 직후 아티스트 디렉터에 표시→아티스트 생성 완료 후 작사로 이동, 아티스트 보유 계정 진입 시 깜빡임 없음.

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **① 말풍선 대상**: 기본안 = 아티스트 미보유 시에만 artist, 보유 시 기존 체인(작사→작곡→커버). "항상 아티스트 고정"을 원하면 지시 1줄(고정 시 보유자는 '내 아티스트' 안내 대화로 빠짐을 감안).
2. **② persist 범위**: 기본안 = 작사 draft 전체 + 아티스트 텍스트 답변만 AsyncStorage, 작곡·영상·커버는 메모리 store 보존(뒤로가기/탭 이동 커버, 앱 재시작은 미커버). 작곡까지 영속 원하면 지시(재차감·오염 안전장치 추가 공정).
3. **로그아웃 시 가사 draft**: 기본안 = 유지(사용자 생성물 보존 우선, 현행 동일). 계정 전환 보안 우선(클리어)을 원하면 지시 1줄.
4. **'처음부터 다시' 노출 위치**: 기본안 = 각 화면 재진입 시 복원 안내 버블에 인라인 액션(디렉터 대화 톤). 별도 확인 팝업(showAlert 2버튼)을 원하면 지시.

규칙: 민감 정보 플레이스홀더(이번 사이클은 앱 단독 — SSH·키·크리덴셜 기재 없음, 원격은 읽기 조회만), 코드 수정·커밋·배포는 이 계획 승인 후 team-dev 루프에서, git 커밋은 오케스트레이터 승인 후.

# v3.220 — 앨범 페이지 하단 탭바 유지 + 알림·메시지 미니플레이어 숨김 + 카카오톡 라벨 + '스타' ⭐ 병용

전제: 앱 = /Users/pearl/TripleJ/2_housing 단독 — **서버 무변경**. 사용자 요청 원문 4건: ① 앨범 페이지에서 하단바(차트~작업실) 사라짐, ② 알림·메시지 페이지도 설정 페이지처럼 미니플레이어 숨김(재생 유지), ③ 추천하기 '카카오톡으로 공유'→'카카오톡', ④ 전앱 텍스트 '스타'에 ⭐ 이모지 병용. 주의: **v3.219 미커밋 변경분(stores 4·screens 다수)이 작업 트리에 있는 상태에서 분석** — 본 섹션의 파일:라인은 현재 작업 트리 기준(커밋 시점에 소폭 이동 가능). v3.220 접점 파일 중 v3.219 작업분과 겹치는 것은 App.tsx·MyMusicScreen·MyArtistsScreen·VideoDirectorScreen 4개 — 충돌 없는 별개 지점이나 구현 순서는 v3.219 커밋 후 권장.

## 0단계 findings / Plan verification (현행 코드 직접 정독 — 파일:라인)

**F1. ① 하단바 사라짐 — 원인 실증: AlbumDetail이 RootStack 소속(구조적 확정)**
- 내비 구조: RootStack(native-stack, App.tsx:581-636) ⊃ MainTabs(Tab.Navigator :320-431, 탭바 = 차트·플레이리스트·피드·검색·작업실) ⊃ StudioStack. **AlbumDetail은 RootStack.Screen(:625, stackHeader '앨범')** — RootStack push는 MainTabs 전체를 덮으므로 Tab.Navigator가 화면 밖 = 탭바 미렌더. 이것이 원인의 전부(옵션·스타일 문제 아님). FeedDetail·UserChannel·ArtistDetail 등 다른 상세도 동일 구조(의도된 관행)이나 사용자는 앨범만 지적.
- 부수 실증: MiniPlayerWrapper는 NavigationContainer 내 형제(:638)로 AlbumDetail 위에도 렌더되는데 bottom = 탭바 높이(49/54+inset, :252-265) — **현재 앨범 페이지에선 탭바 없는 허공 위에 미니플레이어가 뜨는 시각 결함 동반**(이동 시 자동 해소).
- 진입 경로 전수(grep AlbumDetail — 5콜사이트+복귀 1): ⑴ 차트 최신앨범 ChartScreen.tsx:313, ⑵ 차트 앨범소속곡 탭 :214(album_id 백엔드 미제공으로 현재 휴면 분기 — :208-212 TODO), ⑶ 마이페이지 앨범행 MyMusicScreen.tsx:832(`getParent()?.navigate`), ⑷ 앨범 생성 직후 :933(동일), ⑸ 채널 앨범 UserChannelScreen.tsx:142(UserChannel 자체가 RootStack — 이미 탭바 없는 문맥). 복귀: AlbumCoverGeneration(RootStack :628)이 goBack으로 AlbumDetail 복귀(CoverGenerationScreen.tsx:1649·1185). **검색(SearchScreen)엔 앨범 진입 없음**(grep 0건 — 지시문의 '검색' 경로는 부존재 확인).
- 탭바 유지 선례 = **MyMusic 숨김 탭 관행**(App.tsx:407-428): `tabBarButton: () => null` + `tabBarItemStyle: display 'none'`으로 Tab.Navigator 내부에 두고 탭바는 유지, 헤더는 탭 options로 구성, ← 는 BackIcon=navigate('Chart') 고정(:417). 탭 내 스택 선례 = StudioStack + tabPress 리셋(:391-396).
- 회귀 관련 실측: AlbumDetailScreen은 useRoute/useNavigation 제네릭(:49-51)이라 소속 이동에 스크린 코드 호환. focus 시 재조회(useFocusEffect :106, fetchAlbum dep=albumId :90-105). 내부 goBack 3곳(조회 실패 :99·앨범 삭제 :157·마지막 트랙 제거 :228). Player(모달)·AlbumCoverGeneration·UserChannel로 navigate(:114·:303·:368) — 탭 내부에서 호출해도 RootStack으로 버블링 정상. **딥링크 무영향**: linking config에 AlbumDetail 미등록(:538-547, FeedDetail만). 숨김 탭 이동 시 주의 2건: (a) 탭 스크린은 언마운트되지 않아 albumId 재진입 시 이전 앨범 잔상 — albumId 변경 감지 리셋 필요, (b) Tab backBehavior 미지정(기본 firstRoute) — goBack이 차트로 떨어지므로 origin 복귀는 명시 처리 필요.

**F2. ② 미니플레이어 숨김 관행 — v3.57 route 기반 목록(추정 적중)**
- `HIDE_MINIPLAYER_ROUTES = ['Settings', 'AudioSpike']`(App.tsx:533) + currentRoute 추적(navigationRef.getCurrentRoute().name, onReady/onStateChange :572-579) + 렌더 게이트(:638). 주석 명시: "UI를 숨겨도 재생은 계속된다"(:529-530) — **숨김=렌더만 차단, playerStore 무접촉 = 재생 유지 확인**.
- 별개 메커니즘: 화면 단위 store 숨김 `setMiniHidden`(v3.82, playerStore.ts:171 → App.tsx:255-259) — Artist 4화면이 focus/blur로 사용(ArtistInput:311-318 등). **알림·메시지는 RootStack 화면이므로 route 목록 방식이 정확한 관행**(설정과 동일 계열).
- 대상 라우트명 실측: `Notifications`(App.tsx:592, '알림')·`DmInbox`(:591, '메시지')·`DmChat`(:594, 채팅방 — DmInbox에서 push, "메시지 페이지"의 일부로 포함이 자연). getCurrentRoute는 최심 포커스 라우트를 반환하므로 이름 매칭 정상. DmChat은 하단 입력바+키보드 화면(DmChatScreen.tsx:292-300)이라 미니플레이어 겹침 제거 효익이 가장 큼.

**F3. ③ 카카오톡 라벨 — 1줄 확인 완료**
- components/AppShareModal.tsx:17 `{ key: 'kakao', label: '카카오톡으로 공유' }` → 렌더 :102-104(Button label). '카카오톡으로 공유' 문자열은 전앱에서 이 1곳뿐(주석 :2 동반 수정). v3.212에서 옵션 2종(카카오톡·링크 복사) 축소된 그 라벨.

**F4. ④ '스타' 사용처 전수 인벤토리 — 30건 grep, 사용자 노출 문자열 분류**
- 기존 관행 3계보 실측: (i) 수량 = `⭐N` 통일 — v3.214 ⑩ 주석이 명문("'스타 n개' → '⭐n'", MyMusicScreen.tsx:415), (ii) 병기 = `스타(⭐)` — ChartScreen.tsx:338·GuestQueueNoticeModal.tsx:25 기구현, (iii) 재화명 상수 CURRENCY='스타'/CURRENCY_ICON='⭐'(constants/currency.ts — 사용처는 StarGuideModal 4곳뿐, 나머지는 전부 리터럴).
- 오매칭 제외 규칙(확정): `스타일*`(스타일·스타일링·스타일리스트), `스타킹`(ArtistCodyScreen.tsx:535·540 — AI 프롬프트, 비노출), `스타트`·`인스타`·`리스타트`, `톱스타`(data/levels.ts:4·20 — 등급명, 재화 아님), 주석·로그(MyMusicScreen:415, StarGuideModal:1 등), 접근성 라벨(HomeHeaderActions.tsx:102 '스타 안내' — 스크린리더에 이모지 낭독 부적합 → 제외).
- 사용자 의도 해석: "'스타'가 들어가는 곳에 이모지 별이 들어갈 수 있도록" = 스타 언급 시 ⭐가 보이게(단어 제거 요구 아님). (a) 전면 대체는 "⭐가 부족해요" 등 문장 가독성 훼손, (c) 수량만으론 "스타가 부족해요"류 미커버 → **기본안 = (b)+(c) 하이브리드**(스펙 ④).

## 확정 스펙

### ① 앨범 페이지 탭바 유지 [App.tsx + AlbumDetailScreen + 콜사이트 3파일 — 기본안 = 숨김 탭 이식(MyMusic 관행)]
- **AlbumDetail을 RootStack(:625)에서 제거하고 MainTabs의 숨김 탭으로 이동**: `tabBarButton: () => null`+`tabBarItemStyle: {display:'none'}`(MyMusic :411-412 동일), 헤더는 탭 options로 headerShown+타이틀 '앨범'+← (stackHeader 시각 규격 승계). 탭바(차트~작업실) 상시 노출 — 활성 탭 하이라이트 없음은 MyMusic 관행과 동일. 대안 (b) 탭별 네이티브 스택화(Studio 관행 정공법)는 차트·마이페이지 헤더 재배선 등 범위 과대로 비채택(이월 후보).
- **origin 복귀(back)**: 진입 시 `from` 파라미터 명시 — 차트 2곳(ChartScreen:214·:313) `navigate('AlbumDetail', { albumId, from:'Chart' })`(탭 형제 해석으로 자동 전환), 마이페이지 2곳(MyMusicScreen:832·:933) `getParent()?.navigate` → `navigation.navigate('AlbumDetail', { albumId, from:'MyMusic' })`, 채널(UserChannelScreen:142) → `navigate('MainTabs', { screen:'AlbumDetail', params:{ albumId, from:'UserChannel', fromParams:{ authorId, name } } })`. AlbumDetailScreen에 `exitAlbum()` 헬퍼 신설: from==='UserChannel'이면 navigate('UserChannel', fromParams)(재push — 채널 복귀 유지), 그 외 navigate(from ?? 'Chart'). 내부 goBack 3곳(:99·:157·:228)과 헤더 ← 를 전부 exitAlbum으로 교체. **매 진입마다 albumId·from 전체 전달**(파라미터 머지 의존 금지).
- **잔상 방지**: 탭 스크린은 상주하므로 `useEffect([albumId])`로 album=null·loading=true·manageMode=false 리셋(useFocusEffect 재조회 :106은 현행 유지 — AI 커버 확정 복귀 재조회 경로 보존).
- 회귀 확인 지점: Player 모달·AlbumCoverGeneration 진입/goBack 복귀(RootStack 버블링 — 복귀 시 MainTabs의 마지막 활성 탭=AlbumDetail 정상), Android 하드웨어 back은 backBehavior 기본(firstRoute→차트) 허용(문서화 — 전역 backBehavior 변경은 회귀면이 넓어 금지), 딥링크 무영향(F1), 차트 :214 휴면 분기도 from 부여. 미니플레이어는 AlbumDetail에서 표시 유지(숨김 목록 미포함 — 탭바 위 정상 안착으로 F1 시각 결함 해소). 로그 `[AlbumNav]`.

### ② 미니플레이어 숨김 확대 [App.tsx 1줄 — v3.57 관행 그대로]
- `HIDE_MINIPLAYER_ROUTES = ['Settings', 'AudioSpike', 'Notifications', 'DmInbox', 'DmChat']`(:533). 재생은 유지(렌더 게이트만 — F2 실증). setMiniHidden(store) 방식 미사용(RootStack 화면은 route 목록이 관행). 주석에 v3.220 사유 1줄 추가.

### ③ 추천하기 카카오톡 라벨 [AppShareModal.tsx:17 — 1줄]
- `label: '카카오톡으로 공유'` → `'카카오톡'`(주석 :2·:15의 표기도 동기화). 동작(네이티브 공유 시트 위임)·키('kakao') 무변경.

### ④ '스타' ⭐ 병용 [11파일 문자열 치환 — 기본안 = (b)병기+(c)수량 하이브리드]
- 규칙 3조: **R1** 수량 동반(`스타 N`·`스타 N개`) → `⭐N`(v3.214 ⑩ 관행), **R2** 수량 없는 언급 → 해당 문자열의 **첫 '스타'만 `스타(⭐)` 병기**(반복 병기는 소음 — ChartScreen:338 기구현 톤), **R3** 같은 문자열에 ⭐가 이미 있으면 무변경. 리터럴 ⭐ 유지(CURRENCY_ICON 전환은 이월 — 기존 리터럴 관행과 혼재 방지).
- 치환 매트릭스(파일:라인 — 현행 → 기본안):

| 위치 | 문맥 분류 | 적용 규칙 → 결과 |
|---|---|---|
| MyMusicScreen.tsx:372 | Inst 실패 안내 | R2 → '차감된 스타(⭐)는 환불됩니다.' |
| MyMusicScreen.tsx:447 | 잔액 부족 안내 | R2 → '스타(⭐)가 부족해요. …' (뒤 '스타를 모아보세요'는 유지) |
| MyMusicScreen.tsx:473 | 곡 공유 멘트 | R1 → '가입 시 ⭐50 추가 증정!' |
| SettingsScreen.tsx:188 | 지급 완료 본문 | R1 → '⭐10을 드렸어요.'(타이틀은 기 ⭐10 — R3) |
| ArtistLoadingScreen.tsx:534 | 부족 팝업 타이틀 | R2 → '스타(⭐)가 부족해요'(본문은 기 ⭐15 — R3) |
| VideoDirectorScreen.tsx:525 | 402 안내 | R2 → '스타(⭐)가 부족해요. …' |
| ChartScreen.tsx:38 | 튜토리얼 타이틀·desc | 타이틀 '스타'→'⭐ 스타'(StarGuideModal 헤드 :52 관행), desc R2 → '잔여 스타(⭐)와 …' |
| ChartScreen.tsx:39·40 | 튜토리얼 desc 2건 | R2 → '… 스타(⭐)를 받아보세요' |
| MyArtistsScreen.tsx:258·335 | 부족 팝업 타이틀 2건 | R2 → '스타(⭐)가 부족해요'(본문 :259·:335는 기 ⭐ — R3) |
| DirectorLineupScreen.tsx:84 | 402 안내 | R2 → '스타(⭐)가 부족해요. …' |
| AppShareModal.tsx:91 | 추천 안내 | R1×2 → '두 사람 모두 ⭐50을 받아요!' / '⭐50 추가 증정!' |
| components/feed/FeedCard.tsx:267 | 피드 공유 멘트 | R1 → '⭐50 추가 증정!' |
| 무변경(R3) | ChartScreen:338-339·GuestQueueNoticeModal:25-26·AttendanceModal:145·TrackShareDownloadSheet:62·StarGuideModal 전체 | 기 병기/⭐ 포함 |
| 제외 | HomeHeaderActions:102(a11y)·ArtistCodyScreen:535·540(프롬프트 '스타킹')·levels.ts('톱스타')·currency.ts CURRENCY 값·주석/로그 전부 | F4 규칙 |

- 서버 발신 에러 메시지(response.data.error 패스스루)에 '스타'가 올 수 있으나 서버 무변경 원칙상 범위 외(명기).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| App.tsx | ① AlbumDetail RootStack 제거→MainTabs 숨김 탭(헤더·←)·② HIDE_MINIPLAYER_ROUTES 3개 추가·주석 | frontend-dev | `[AlbumNav]` |
| screens/AlbumDetailScreen.tsx | ① exitAlbum 헬퍼(goBack 3곳+헤더 ←)·albumId 변경 리셋 effect | frontend-dev | `[AlbumNav]` |
| screens/ChartScreen.tsx | ① from:'Chart' 2곳(:214·:313)·④ 튜토리얼 문안 3건 | frontend-dev | `[AlbumNav]` |
| screens/MyMusicScreen.tsx | ① getParent 제거+from:'MyMusic' 2곳·④ 2건(:372·:447·:473) | frontend-dev | `[AlbumNav]` |
| screens/UserChannelScreen.tsx | ① MainTabs 중첩 navigate+fromParams | frontend-dev | `[AlbumNav]` |
| components/AppShareModal.tsx | ③ 라벨 1줄·④ :91 | frontend-dev | — |
| screens/SettingsScreen.tsx·ArtistLoadingScreen.tsx·VideoDirectorScreen.tsx·MyArtistsScreen.tsx·DirectorLineupScreen.tsx·components/feed/FeedCard.tsx | ④ 문자열 치환 각 1-2건 | frontend-dev | — |

## 40% 룰 판정
**가결**. ②③④는 문자열·상수 수준(구조 무변경). 유일한 구조 변경 = ①이며 앱 내 검증 선례(MyMusic 숨김 탭 :407-428) 1:1 이식 + 콜사이트 5곳·goBack 3곳의 기계적 치환. 최대 리스크는 ①의 back 동선(특히 UserChannel 재push 복귀)과 탭 상주 잔상 — 실패 시 UserChannel 진입만 RootStack 잔류(이중 등록 없이 해당 콜사이트만 현행 유지 = 채널 문맥은 탭바 없음 허용)로 축소하는 후퇴선 명시. 이월: 탭별 네이티브 스택 정공법 전환, FeedDetail 등 타 상세 화면 탭바 정책 통일 여부, ⭐ 리터럴의 CURRENCY_ICON 일원화.

## test-designer 항목
1. [unit] ① AlbumDetail 진입 4경로(차트 최신앨범·차트 앨범곡(모킹)·마이페이지 앨범행·앨범 생성 직후): 탭바 노출 + albumId·from 파라미터 전달 확인.
2. [unit] ① exitAlbum: from=Chart→차트, from=MyMusic→마이페이지, from=UserChannel→채널 재push(fromParams), from 결측→차트 폴백. 내부 goBack 3경로(조회 실패·앨범 삭제·마지막 트랙 제거)가 동일 헬퍼 경유.
3. [unit] ① 앨범 A→나가기→앨범 B 진입: 잔상 없음(리셋 effect)·재조회 1회. AI 커버 확정 goBack 복귀 시 focus 재조회로 커버 갱신(기존 회귀).
4. [unit] ② HIDE_MINIPLAYER_ROUTES: 재생 중 Notifications·DmInbox·DmChat 진입 시 미니플레이어 미렌더 + playerStore 재생 상태 불변, 이탈 시 재노출. Settings·AudioSpike 기존 회귀.
5. [unit] ③ SHARE_BUTTONS 라벨 '카카오톡', handleShare('kakao') 동작 불변.
6. [unit] ④ 치환 매트릭스 전건 스냅샷 + 오매칭 가드: '스타일'·'스타킹'·'톱스타'·a11y 라벨 '스타 안내' 무변경 grep 검증.
7. [e2e] ① 차트→최신앨범→곡 재생(Player 모달)→닫기→탭바 유지→뒤로→차트 / 마이페이지→앨범→뒤로→마이페이지 / 채널→앨범→뒤로→채널. Android 하드웨어 back(앨범→차트 착지) 문서 스모크.
8. [e2e] ① 앨범 화면에서 미니플레이어가 탭바 바로 위에 안착(허공 결함 해소), 하단 탭 5개 터치로 즉시 이탈 가능.
9. [e2e] ② DmChat 키보드 입력 중 미니플레이어 미간섭, 백그라운드 재생·잠금화면 컨트롤 유지. 미니플레이어 표시 화면 회귀(차트·플레이리스트·피드·검색·작업실 Map·마이페이지·AlbumDetail).
10. [e2e] ④ 별 이모지 렌더(iOS·Android·웹 각 1회 스모크 — 기존 ⭐ 리터럴 다수라 저위험).

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **① 구현 방식**: 기본안 = 숨김 탭 이식(MyMusic 관행, 소규모). Android 하드웨어 back이 앨범→차트로 떨어짐(헤더 ←는 origin 복귀 정상)을 감수. 탭별 스택 정공법(back 완전 보존·범위 확대)을 원하면 지시 1줄.
2. **② DmChat 포함 여부**: 기본안 = 포함(알림·메시지 목록·채팅방 3화면). 채팅방은 표시 유지 원하면 지시 1줄.
3. **④ 치환 강도**: 기본안 = R1(수량 ⭐N)+R2(첫 언급 병기 스타(⭐))+R3(기⭐ 무변경). (a) '스타' 전면 ⭐ 대체 또는 (c) 수량만 치환을 원하면 지시 1줄.
4. **④ 튜토리얼 타이틀**: 기본안 = '스타'→'⭐ 스타'. 원문 고정(v3.213 "문안 = 사용자 원문" 이력) 원하면 제외 지시.

규칙: 민감 정보 플레이스홀더(앱 단독 사이클 — SSH·키·크리덴셜 기재 없음), 코드 수정·커밋·배포는 이 계획 승인 후 team-dev 루프에서, git 커밋은 오케스트레이터 승인 후. v3.219 미커밋분 위에서 분석했으므로 구현 착수 전 v3.219 커밋 선행 권장.

# v3.222 — ① 영상 디렉터 프리셋 진입 헤더 정합 ② Inst 생성 → 작곡 디렉터 진행 화면·완료 미리듣기 연동 ③ 작곡 A/B 미리듣기 시크

전제: 앱 = /Users/pearl/TripleJ/2_housing (커밋 65a9eb2 기준 작업 트리 — 앱 파일:라인은 현행 코드 직접 정독). 서버 실측 = **라이브 EC2 읽기 전용 ssh(`<SSH_HOST>`=maidol-ec2, /home/ubuntu/maidol/backend_9004) + 무토큰 curl 존재성 프로브** — 서버 파일:라인은 라이브 기준. 주의: 백엔드 git worktree(TripleJ-backend)는 HEAD 2474b06(v3.190)로 **라이브와 desync**(instrumental 코드 자체 부재 실측) — ③ 서버 작업은 v3.217 관행(server_staging_v3222 신설 = 라이브 pull + `_orig` 보존 + md5 재대조, EC2는 코드 베이크라 docker build·배포 전부 사용자 승인)을 따른다. ①②는 앱 단독(서버 무변경), ③만 서버 1함수 변경.

## 0단계 findings / Plan verification (파일:라인 — 앱은 현행 코드, 서버는 라이브 EC2 실측)

**F1. ① 프리셋 진입 상단바 '작업실' — 원인 실증: 중첩 navigate가 Map을 적재하지 않아 헤더 셋업 주체가 부재**
- 헤더 구조: StudioStack 자체는 headerShown:false(App.tsx:190-194) — 작업실 계열에서 보이는 상단바는 **항상 Tab 헤더 1개**이며 기본값은 titleHeader '작업실'(App.tsx:397-404, titleHeader :296-303, ← 없음).
- 정상 진입 헤더의 실체: **엔터명 타이틀은 MapScreen이 마운트 시 parent(Tab) setOptions로 주입**(MapScreen.tsx:443-472 useLayoutEffect — 엔터명 Marquee+HomeHeaderActions, sticky)하고, **← 화살표는 DialogueScreen이 focus 시 headerLeft로 주입**(DialogueScreen.tsx:105-120), 클리어는 Map 복귀 focus가 전담(MapScreen.tsx:477-481, v3.201 불변식). 정상 진입 스택 = Map → Dialogue(video, transparentModal) → navigate('VideoDirector')(DialogueScreen.tsx:200 action 'navigate:VideoDirector' → :289 navigation.navigate) = [Map, Dialogue, VideoDirector] — 타이틀·화살표 모두 하위 화면이 심어놓은 것이 잔존하는 구조. 화살표 onPress는 Dialogue 클로저의 goBack이라 VideoDirector 위에서 눌러도 Map 복귀.
- 프리셋 진입(v3.221, MyMusicScreen.tsx:303-306): `getParent()?.navigate('MainTabs',{screen:'Studio',params:{screen:'VideoDirector',params:{initialTrackId}}})`. React Navigation 7 중첩 navigate는 **지정 화면을 스택의 유일 초기 라우트로 적재**(initialRouteName Map은 `initial:false` 없이는 미적재):
  - (a) Studio 탭 미방문 세션 → 스택 [VideoDirector] 단독: Map useLayoutEffect 미실행 = 타이틀 '작업실' 기본값 + headerLeft 주입 주체 없음 + back 스택 자체 부재 → **사용자 재현 상태 그대로**.
  - (b) Studio 기방문 → 기존 스택 위 push: 타이틀은 엔터명 잔존하나 ← 는 여전히 없음(마지막 Map focus가 클리어해 둔 상태).
  두 경우 모두 뒤로가기 부재. VideoDirectorScreen은 헤더 무접촉(setOptions·goBack 배선 grep 0건) 확인 — 이탈 수단이 하단 탭뿐.
- 프리셋 로직 자체(:207-225 — 선곡 통과·비공개 곡 안내·videoDraft 클리어)는 정상. 문제는 스택 적재·헤더만.
- 동일 잠복 패턴: CoverGenerationScreen.tsx:647(ArtistCody 중첩 navigate) — 이번 범위 외, 기록만.

**F2. ② Inst 현행 플로우와 작곡 진행 화면 — 재사용 재료·결합 장애 실측**
- 현행 Inst: MyMusicScreen ⋮ → handleCreateInstrumental(:406-427, composer 쿨다운 선게이트) → confirmCreateInstrumental(:430-479, ⭐5 다이얼로그 → requestInstrumental → '생성 시작' alert → pollInstrumental; 402 충전 안내·409 진행 중·404 과도기 분기 :451-478) → pollInstrumental(:375-401) = **5s×10분 while 폴링, completed→alert+fetchTracks / failed→환불 안내** — 진행 UI 없음(다이얼로그·백그라운드 폴링뿐), result_track_id 미사용.
- "작곡 디렉터 1~5 로딩 화면" = **MusicLoadingScreen**(StudioStack 'MusicLoading'): LOADING_STEPS 5단계(멜로디→화음→작곡→믹싱→마무리, :34-40), 4s 자동 전진(:54-59)+서버 progress% 점프(:62-70), 스텝 인디케이터(:363-392)·%바(:394-403)·초상 펄스, 완료 시 replace('MusicResult')(:144) — "다 만들면 들어보기"는 MusicResult가 담당. resumeGenerationId 재개 모드(:331-341) = **생성 시작 없이 폴링만 하는 화면 재사용 선례**.
- 결합 장애: MusicLoadingScreen의 doGenerate(:172-328)가 musicStore·generateWithSuno·참고음 업로드·피로 429 재시도에 강결합 — Inst(트랙 축 API)를 모드 파라미터로 밀어 넣으면 분기 비대 → (a) 화면 통짜 재사용 비채택.
- 서버 실측(라이브 EC2 — 배포 확인: 무토큰 GET /tracks/1/instrumental/status 401 vs 임의 경로 404):
  - POST /tracks/{id}/instrumental 202(tracks.py:3045-3205, 응답에 status_url), GET .../instrumental/status(:3210-3257) 반환 = **{status, job_id, result_track_id, error, refunded, created_at, updated_at}** — 완료 시 result_track_id 확보 가능(기존 Inst 트랙만 있어도 completed+id 응답 :3237-3242).
  - job 내부 전이는 **pending→processing→completed/failed 3단뿐**(inst_service.py:483·446·491) — 1~5단계 세분 필드 없음 → 스텝 표시는 클라 시간 기반(MusicLoading 관행) + status 도달 점프로 설계(**서버 무변경**). 파이프라인 실순서(제출→보컬 분리→다운로드→정규화→발매)를 표시 문안으로만 차용.
  - 완료 트랙 재생 소스 = /tracks/stream-proxy/{id} — v193 Range 구현(tracks.py:1318-1348)이라 완료 미리듣기는 시크 포함 정상 전제.

**F3. ③ A/B 미리듣기 시크 불가 — 원인 실증: 프런트는 v3.204에 이미 Slider, 서버 생성 스트림이 Range 미지원**
- 화면 특정: "곡 2개 생성 화면" = **MusicResultScreen A/B 비교**(showComparison :197, variant 카드 :658-710). 재생바는 표시 전용 View가 아니라 v3.204(①)에서 Slider 이식 완료(active 카드 :689-701·단일 플레이어 :732-744, PlayerScreen 패턴 시킹 상태 :141-146·handleSeek :425-437·LISTEN seek 1회 기록 :171-183). 단 `disabled={!seekable}`(:697·:740), seekable=duration>0(:413), duration=expo-av status.durationMillis(:238).
- 원인(서버): A/B 오디오 소스 = generationStreamUrl(:213 → musicService.ts:377-384, ?token 쿼리 인증) → **GET /api/generate/{gen_id}/stream/ — 라이브 generate.py stream_generation(:1224~)의 StreamingResponse에 Range 처리·Accept-Ranges·Content-Length 전무(파일 전체 grep 0건 실측) + Content-Disposition attachment(:1304-1311)**. 반면 저장 트랙 stream-proxy는 v193 Range 완비. expo-av(웹 HTML5 audio·네이티브 ExoPlayer/AVPlayer)는 Range 미지원·길이 미상 스트림에서 duration 미확정→Slider disabled(드래그 무반응)이거나 duration이 잡혀도 setPositionAsync 무효/처음부터 재생 — 사용자 증상과 정합. **v3.204가 프런트만 이식하고 서버 격차를 놓친 것.**
- 소비처 전수(grep): MusicResult A/B(:213)·GenerationHistory 이어듣기(:129)·MusicLoading url 조립(:134·:279) — 전부 재생 문맥, 다운로드 용도 없음 → attachment→inline 전환 안전.
- 곡별 독립성: variant 전환 시 sound 재로드+position/duration/시킹 상태 리셋(:268-275), 활성 카드만 바 노출(:686) — 구조는 이미 곡별 독립. **시크만 뚫리면 "각 곡마다 재생바 이동" 요구 충족.** 부차 확인: variant 카드 TouchableOpacity(:661) 내부 Slider 제스처 경합(특히 web) — Range 픽스 후 실기기 확인.
- 저장 확정 후 단일 플레이어(store.savedTrackId → stream-proxy :210)는 Range 지원 경로라 기존에도 시크 가능했을 것 — 증상 범위는 생성 직후(A/B·미확정 단일) 한정으로 해석.

## 확정 스펙

### ① 영상 디렉터 프리셋 진입 = 정상 진입과 동일 헤더 [2파일 소변경]
- MyMusicScreen.tsx:303-306: Studio 중첩 params에 **`initial: false` 추가** → 미방문 세션에도 스택 [Map, VideoDirector] 적재. Map 마운트만으로 엔터명 헤더 셋업(useLayoutEffect — focus 불요) = 정상 진입과 동일 타이틀.
- VideoDirectorScreen: **useFocusEffect로 parent headerLeft ← 주입**(Dialogue :105-120 관행 그대로 — 아이콘·마진 동일, 클리어는 Map focus 승계). onPress = `navigation.navigate('Map')` — 정상 진입([Map,Dialogue,VD] — 중간 Dialogue까지 pop)·프리셋 진입 모두 **Map(작업실) 복귀로 일원화**(기본안: 헤더 문맥=엔터명과 일치). 정상 진입 시 Dialogue가 이미 심은 화살표와 중복 주입되나 마지막 focus가 이기고 목적지 동일 — 무해.
- 회귀 확인 지점: 비공개 곡 프리셋 안내(:214-215) 유지, videoDraft 복원 배너(정상 진입) 유지, '작업실' tabPress Map 리셋(App.tsx:391-396) 유지. 로그 `[VideoDirector]` 헤더 주입 1줄.

### ② Inst 생성 → 작곡 진행 화면(1~5)·완료 미리듣기 [기본안 = (b)진행 UI 추출 공용화 + (c)전용 경량 화면]
- **components/ComposerLoadingView.tsx 신설**: MusicLoadingScreen 프레젠테이션부(초상 펄스+메시지+5스텝 인디케이터+%바+노트, :349-412+styles)를 props(steps, messageIndex, progress?, portrait, noteText)로 추출. MusicLoadingScreen은 이를 사용하도록 치환(시각·로직 무변경 — 회귀 0 목표).
- **screens/InstLoadingScreen.tsx 신설**(StudioStack 'InstLoading' 등록 + StudioStackParamList, params { trackId, title, resume? }):
  - 스텝 5종 Inst 문안(기본안): 제출 → 보컬 분리 → 오디오 받기 → 정규화 → 발매 (서버 파이프라인 순서 차용 — 표시용). 4s 시간 전진 + status 점프(processing 진입 시 ≥2단계, completed 시 5/✓ — 서버 세분 필드 부재 실측 전제).
  - 폴링 = getInstrumentalStatus 5s(기존 축·10분 타임아웃 문안 :400 재사용). completed → **result_track_id**(실측 스키마)로 done 상태: 5단계 ✓ + 완료 카드 = **미리듣기 플레이어(expo-av+Slider — MusicResult v3.204 패턴, 소스 /tracks/stream-proxy/{result_track_id} = Range OK)** + [마이페이지에서 보기] 버튼. failed → 환불 문안(:391 재사용) + [돌아가기]. 이탈 자유(gestureEnabled 기본 — 서버 백그라운드 진행, MusicLoading의 잠금과 달리 강제성 없음).
  - 진입 배선: confirmCreateInstrumental(:443-448)에서 202 수락 시 '생성 시작' alert 대신 `navigate('MainTabs',{screen:'Studio',params:{screen:'InstLoading', initial:false, params:{trackId,title}}})`(①과 동일 헤더 정합 — Map 하부 적재, ← 주입은 InstLoading도 ① 관행 동일 적용). **409(이미 진행 중) → 동일 화면 resume 모드**(폴링만 — MusicLoading resumeGenerationId :331-341 관행). 402·404·쿨다운 게이트(:406-427) 분기는 현행 유지.
  - **폴링 소유권 이관**: MyMusicScreen pollInstrumental while 루프(:375-401) 제거. instBusy는 유지하되 화면 focus 시 busy 트랙 status 1회 확인으로 해제+fetchTracks(복귀 시 목록 갱신). ⋮ 진행 중 항목 제외(:368-371) 회귀 유지.
- 서버 무변경(스키마 실측 그대로). 로그 `[Inst]` 유지 + `[InstLoading]` 신설.

### ③ 작곡 A/B 미리듣기 시크 [백엔드 1함수 + 프런트 검증 — 기본안 = 서버 Range 이식]
- **B-1(server_staging_v3222)**: generate.py stream_generation(:1224~)에 stream_proxy v193 Range 블록 이식(tracks.py:1318-1355 동형) — stat_object로 total 확보 → Range 파싱 → 206 + Content-Range/Accept-Ranges/Content-Length, 비-Range 200에도 Content-Length+Accept-Ranges 선언, Content-Disposition **attachment→inline**(소비처 전수 재생 문맥 — F3). variant 선택 로직(:1231~)·권한 검사 무변경. 로그 `[GenerationStream] range` 1줄.
- 프런트 코드 변경 없음(기본안) — v3.204 Slider·seekable 게이트가 duration 확정과 함께 그대로 살아난다. 실기기에서 카드 TouchableOpacity 제스처 경합이 확인되는 경우에 한해 카드 onPress와 Slider 영역 분리(바 영역을 카드 밖 터치 영역으로) 소수정 허용.
- 배포: EC2 docker build 필요 — **prod 변경 사용자 승인 후**(라이브 pull+_orig+md5 재대조 관행). 승인 전 대안(보류 시): 클라 FileSystem 캐시 후 재생 폴백 — 웹 미지원·용량 이슈로 비추천(사용자 결정 4).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| screens/MyMusicScreen.tsx | ① initial:false(:303-306) · ② InstLoading 진입 배선+409 resume+폴링 루프 제거·focus 1회 확인 | frontend-dev | `[Inst]` |
| screens/VideoDirectorScreen.tsx | ① headerLeft focus 주입(→Map) | frontend-dev | `[VideoDirector]` |
| components/ComposerLoadingView.tsx (신규) | ② MusicLoading 진행 UI 추출 | frontend-dev | `[InstLoading]` |
| screens/MusicLoadingScreen.tsx | ② 추출 컴포넌트 사용 치환(로직 무변경) | frontend-dev | — |
| screens/InstLoadingScreen.tsx (신규) · App.tsx | ② 진행·완료 미리듣기 화면 + StudioStack 등록·ParamList | frontend-dev | `[InstLoading]` |
| backend_9004/app/routes/generate.py (server_staging_v3222) | ③ stream_generation Range/Content-Length/inline (v193 이식) | backend-dev | `[GenerationStream]` |
| screens/MusicResultScreen.tsx | ③ 원칙 무변경(검증) — 실기기 제스처 경합 시에만 소수정 | tester/frontend-dev | — |

## 40% 룰 판정
**가결**. ①은 파라미터 1개+focus 주입 1블록(앱 내 검증 선례 Dialogue :105-120 1:1). ③ 서버는 같은 파일군에 있는 v193 검증 코드의 동형 이식(1함수)이고 프런트는 원칙 무변경. 최대 항목은 ②(신규 화면 1+추출 1)이나 진행 UI는 기존 화면 추출 재사용, 폴링은 기존 5s 축 이관, 완료 미리듣기는 MusicResult v3.204 패턴 재사용으로 신규 로직 최소. 리스크 상위 2건과 후퇴선: ⑴ ② MusicLoading 추출 리팩토링이 정상 작곡 완주를 건드릴 가능성 — 실패 시 추출 포기하고 InstLoading에 UI 복제(중복 감수) 후퇴, ⑵ ③ 서버 배포 승인 지연 — ①②만 선반영(③은 프런트 무변경이라 독립 배포 가능). 이월: CoverGeneration→ArtistCody 중첩 navigate 헤더 정합(F1 잠복), MusicLoading url 조립(:134)의 스트림 시크 일관 검증, ⭐ 리터럴 CURRENCY_ICON 일원화(v3.220 이월분 유지).

## test-designer 항목
1. [unit] ① 프리셋 진입 2케이스(Studio 미방문/기방문): 헤더 타이틀=엔터명·← 존재, ← → Map 복귀, 스택에 Map 존재(initial:false).
2. [unit] ① 정상 진입(Map→Dialogue→VideoDirector) 회귀: 헤더 동일·← Map 복귀·videoDraft 복원 배너, 비공개 곡 프리셋 안내(:214-215), '작업실' tabPress Map 리셋.
3. [unit] ② ComposerLoadingView 추출 후 MusicLoading 회귀: 5단계 4s 전진·progress% 점프·스텝 ✓ 렌더·완료 replace(MusicResult)·피로 429 재시도 경로 무변경(스냅샷).
4. [unit] ② InstLoading: pending→processing→completed 전이별 스텝 점프, completed 시 result_track_id로 미리듣기 소스(stream-proxy) 배선, failed 환불 문안, 10분 타임아웃 문안, resume 모드(생성 요청 없이 폴링만).
5. [unit] ② 진입 배선: 확인 다이얼로그→202→InstLoading(initial:false — 헤더 정합), 409→resume 진입, 402 충전 안내·404 과도기(:475-476)·composer 쿨다운 게이트(:406-427) 회귀.
6. [unit] ② MyMusic 폴링 이관: while 루프 제거 후 focus 1회 확인으로 instBusy 해제+fetchTracks, ⋮ 진행 중 항목 제외(:368-371) 유지, 새 "<원제> (Inst.)" 트랙 목록 노출.
7. [api] ③ Range 실측(스테이징→배포 후 프로덕션): `Range: bytes=0-1023` → 206+Content-Range/Accept-Ranges, 무Range → 200+Content-Length, variant=1 동일, 불량 Range 416, 타 사용자 403·미완료 404 회귀, inline 전환 후 웹 재생 정상.
8. [e2e] ③ A/B 화면: 버전 A·B 각각 재생바 드래그 시크(iOS·Android·웹), 드래그 중 position 미덮어쓰기, seek LISTEN {from_ms,to_ms} 1회 기록, 버전 전환 후 재시크, 카드 탭 선택 vs 슬라이더 드래그 제스처 경합 없음.
9. [e2e] ② Inst 완주: 마이페이지 ⋮→Inst 만들기→진행 화면 1~5→완료 미리듣기 재생·시크→마이페이지 목록 확인. 이탈 후 재시도(409)→resume 화면 복귀.
10. [e2e] 회귀: 정상 작곡 완주(가사→작곡 대화→MusicLoading→MusicResult A/B→선택 저장→발매·보상), 저장 후 단일 플레이어 시크, GenerationHistory 이어보기/이어듣기, v3.221 다운로드 2택(영상=프리셋 진입 헤더 확인·음원 mp3).

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **① ← 목적지**: 기본안 = Map(작업실) — 헤더 엔터명 문맥·정상 진입과 단일 동선. 프리셋 진입만 마이페이지 복귀 원하면 from 파라미터 분기 지시 1줄.
2. **② 이탈 중 완료 알림**: 기본안 = 앱내 완료 alert 폐지(진행 화면이 완료 표시 담당, 이탈 시 복귀 목록 갱신으로 확인). 기존처럼 어디서든 완료 alert 원하면 MyMusic 백그라운드 폴링 병행(이중 폴링) 지시.
3. **② Inst 스텝 문안**: 기본안 = Inst 전용 5종(제출→보컬 분리→오디오 받기→정규화→발매). 작곡 문안(멜로디~마무리) 그대로 원하면 지시.
4. **③ 서버 배포**: B-1은 EC2 docker build — server_staging_v3222 작성 후 **배포 승인 요청 1회**(②까지 묶어 승인 불요 — ③만 서버). 승인 보류 시 ③은 미해결 상태로 ①② 선반영(클라 다운로드 폴백은 웹 미지원이라 비추천).

규칙: 민감 정보 플레이스홀더(`<SSH_HOST>`=maidol-ec2 별칭만 기재 — 토큰·크리덴셜 로그/문서 기재 금지, 이번 실측도 무토큰 프로브·읽기 전용 ssh만), 서버 수정은 server_staging_v3222에서만(라이브 pull 원본+_orig 보존+배포 직전 md5 재대조), 프로덕션 쓰기(docker build·배포)는 사용자 승인 후, 코드 수정·커밋은 이 계획 승인 후 team-dev 루프에서, git 커밋은 오케스트레이터 승인 후.

# v3.223 — 로그인 사용자 재생목록(큐) 보존 실효화: 암묵 큐 교체·보관함 덮어쓰기 정리 + 재시작 복원 견고화

전제: 앱 = /Users/pearl/TripleJ/2_housing (커밋 65a9eb2 이후 작업 트리 — 파일:라인은 현행 코드 직접 정독). 서버 실측 = 라이브 EC2 읽기 전용 ssh(`<SSH_HOST>`=maidol-ec2) routes 전수 grep. **서버 무변경**(전 항목 앱 단독). 정책 불변(v3.36 확정): 비회원 큐=앱 재시작 시 폐기·가입 시 claimQueue 승계·플레이리스트 재생=큐 교체. v3.222 planner와 병렬 — 본 섹션은 파일 끝 append만, v3.222 섹션 무접촉.

## 0단계 findings / Plan verification (파일:라인 — 전부 현행 코드 실증)

**F1. 보존 인프라는 이미 존재하고 재시작 복원 경로도 배선돼 있다 — "서버 저장"이 아니라 계정 스코프 로컬 영속(savedQueues)**
- playerStore(stores/playerStore.ts): persist 대상은 `savedQueues`(계정별 보관함 Record<userId,{queue,currentIndex,track}>)·shuffle·repeat·guestNoticeAck뿐(partialize :228-233). 작업 큐(queue/currentIndex/track)와 queueOwnerId는 **의도적 비영속**(:223-227 주석 — 비회원 폐기·계정 오염 방지 정합).
- 저장 시점: saveOwnerQueue(:67-71)가 queueOwnerId 있을 때만 보관함에 스냅샷 — setQueue(:95)·addToQueue(:101)·removeFromQueue(:113)·reorderQueue(:127)·setCurrentIndex(:172)·resetOnLogout(:132)·claimQueue(:147)에서 호출. **setTrack(:91)·playTrackAtIndex(:178-183)는 미호출** → 보관 스냅샷의 현재곡/인덱스가 낡을 수 있음(경미).
- 복원 경로: App.tsx:582 `restoreSession()`(부팅 1회) → authStore.ts:178-190 저장 토큰 → loginWithToken(:84-101) → **restoreQueueFor(user.id)**(:93) → playerStore.ts:149-169 보관함에서 큐·현재곡 복원(isPlaying:false·sessionActive:false — **자동 재생 없음**, 지시 요건 이미 충족). 일반 로그인(:77)·회원가입 claimQueue(:114)도 배선 완료.
- 서버 큐 API: **없음** — 라이브 EC2 routes 전수 grep에서 'queue'는 admin_cs.py·admin_items.py(관리자 작업큐)뿐. 회원 서버 자산은 /playlists(플레이리스트)만 존재(앱 소비처 PlaylistScreen.tsx:61-145). 앱 services/에도 큐 저장/로드 API 호출 0건 → 기기 간 동기화는 구조적 미구현.

**F2. "보존되지 않는" 형태 판정 — (a)(b)(c) 각각**
- **(a) 재시작 소실: 복원 로직은 정상이나 체감 소실을 만드는 실결함 3건.**
  - **A1(최유력). 암묵 큐 교체가 계정 보관함까지 즉시 파괴**: 곡 하나를 재생했을 뿐인데 큐 전체가 그 화면 리스트로 교체되고, setQueue→saveOwnerQueue(:95)가 보관함을 덮어씀 → '담기'로 모은 재생목록이 **재생 1회로 영구 소실, 다음 재시작 때 "예전 목록이 아님" = 보존 안 됨 체감**. 교체 호출부 전수: 검색 결과 탭(ChartScreen.tsx:228-233 setQueue(searchResults)), 피드 인라인(FeedScreen.tsx:203 playTrackNow(track, allTracks()) — playback.ts:714-722가 setQueue 교체), 피드 상세(FeedDetailScreen.tsx:123), 마이뮤직 피드 트랙(MyMusicScreen.tsx:596), 앨범 개별 곡(AlbumDetailScreen.tsx:131-137 playFrom). 반면 **차트 곡 탭은 append**(ChartScreen.tsx:218-224 addToQueue+setCurrentIndex — v3.220). 정책상 교체는 "플레이리스트 재생"(PlaylistScreen.tsx:201-208)만 해당 — 나머지 교체는 정책 외 관성 코드.
  - **A2. 복원 큐 비가시**: v3.198 게이트로 재시작 직후 미니플레이어 미노출(MiniPlayer.tsx:28 — sound null+sessionActive false, 의도된 설계). PlayerScreen 큐 시트는 미니 경유라 도달 불가 → 복원 확인 수단이 차트 '내 재생목록' 탭(ChartScreen.tsx:89·122-124)뿐. "복원됐는데 없는 것처럼 보임" 체감 기여.
  - **A3(잠재·저확률). 하이드레이션 경합 시 파괴적**: restoreQueueFor가 persist 하이드레이션 전에 실행되면 savedQueues={} → else 분기(:164-168)가 **빈 큐를 saveOwnerQueue로 보관함에 덮어씀**. 현실적으론 하이드레이션(부팅 즉시 AsyncStorage read)이 restoreSession의 네트워크 왕복(/auth/me)보다 항상 빠르지만 코드상 보장이 없다 — 방어 필요.
  - 부차: 관련곡 자동 이어재생(playback.ts:479-513)이 큐 종료 시 addToQueue → 보관함에 자동 곡이 계속 누적 — "내가 만든 목록과 다름" 체감 기여(정책 결정 사안).
- **(b) 로그아웃→재로그인 소실: 아님(정상 구현)** — resetOnLogout(playerStore.ts:129-140)이 saveOwnerQueue **후** 초기화, 재로그인 restoreQueueFor 복원. **v3.219 DraftKeep 회귀 아님 — git diff 실측**: 37a2304의 authStore.ts +15줄(:159-171)은 characterTaskStore·musicStore draft 청소뿐, playerStore 무접촉(resetOnLogout 호출 :158은 v3.36부터 기존).
- **(c) 기기 간 미동기화: 구조적 미구현이 맞음**(F1 — 서버 큐 API 부재, savedQueues는 AsyncStorage 기기 로컬).

## 확정 스펙 (기본안 = (b) 계정 스코프 로컬 영속 유지 — 기존 savedQueues 인프라 그대로, 서버 무변경)

서버 저장(기기 간 동기화)은 백엔드 신설(모델+CRUD+마이그레이션)이라 이번 범위 외 — 백로그 기록(사용자 결정 2). 로그인 사용자 보존은 이미 있는 로컬 인프라의 **실효성 결함 3건(A1·A2·A3) 수리**로 달성한다.

### ① A1 — 곡 단위 재생 = append 통일(차트 관행), 교체는 리스트 단위만 [핵심]
- playback.ts playTrackNow(:714-722)에 `mode: 'append'|'replace'` 파라미터(기본 'append'): append = 큐에 없으면 addToQueue 후 해당 곡 playTrackAtIndex(차트 :218-224 관행 1:1), replace = 현행 setQueue 교체.
- 호출부 치환(곡 단위 탭 → append): FeedScreen.tsx:203, FeedDetailScreen.tsx:123, MyMusicScreen.tsx:596, AlbumDetailScreen.tsx:131-137(playFrom), ChartScreen.tsx:228-233(검색 결과 탭 — searchResults 통째 setQueue 제거, 탭한 곡만 append).
- 교체 유지(정책 그대로): 플레이리스트 재생(PlaylistScreen.tsx:201-208 — "플레이리스트 재생=큐 교체" 문구·로그 유지).
- 부작용 인지: 피드/앨범에서 "다음곡"이 화면 리스트가 아닌 내 큐 순서를 따르게 됨 — 정책(재생목록=사용자 소유 단일 목록) 정합이 우선. 화면별 롤백은 호출부 1줄이라 후퇴 용이.
### ② A3 — 재시작 복원 견고화 + 저장 시점 보강
- App.tsx:582: restoreSession 실행을 playerStore 하이드레이션 완료 후로 — `usePlayerStore.persist.hasHydrated()` 확인, 미완이면 `onFinishHydration` 1회 대기 후 실행(zustand v4 persist API). 로그 `[playerStore] hydration-wait` 1줄.
- playerStore.ts restoreQueueFor else 분기(:164-168): **queue.length===0이면 saveOwnerQueue 스킵**(빈 큐로 보관함 덮어쓰기 금지 — 승계할 게 있을 때만 저장). 방어이므로 정상 경로 무영향.
- 저장 시점 보강: playTrackAtIndex(:178-183)에 saveOwnerQueue 추가(현재곡·인덱스 스냅샷 최신화 — 복원 시 현재 곡 정확). 복원 범위 현행 유지: 큐+currentIndex+track 복원, **재생 위치(position) 미복원·자동 재생 금지·미니 미노출**(sessionActive:false — v3.198 게이트 불변).
### ③ A2 — 가시성(최소 손잡이)
- 기본안: 미니플레이어 정책(v3.198) 불변. 재시작 복원 성공 시(restoreQueueFor true 반환, App 레벨) 1회 안내는 **미도입**(팝업 피로 — 사용자 결정 3). 대신 복원 확인 동선인 차트 '내 재생목록' 탭이 ①로 항상 진실을 보여주게 되는 것으로 갈음. UI 변경 0.

## 변경 매트릭스
| 파일 | 변경 | 담당 | 추적자 |
|---|---|---|---|
| services/playback.ts | ① playTrackNow mode('append' 기본/'replace') | frontend-dev | `[playback]` |
| screens/FeedScreen.tsx · FeedDetailScreen.tsx · MyMusicScreen.tsx · AlbumDetailScreen.tsx | ① 곡 탭 append 치환(각 1곳) | frontend-dev | `[playback]` |
| screens/ChartScreen.tsx | ① 검색 결과 탭 setQueue 교체→append(:228-233) | frontend-dev | `[ChartScreen]` |
| stores/playerStore.ts | ② restoreQueueFor 빈 덮어쓰기 방어(:164-168) · playTrackAtIndex 저장(:178-183) | frontend-dev | `[playerStore]` |
| App.tsx | ② restoreSession 하이드레이션 대기(:582) | frontend-dev | `[playerStore]` |

## 40% 룰 판정
**가결**. 신규 화면·신규 스토어 0, 서버 0. ①은 기존 차트 append 관행(ChartScreen.tsx:218-224)의 1:1 이식 + 호출부 5곳 1줄 치환, ②는 스토어 소변경 2곳+App 1곳(zustand 공식 API). 리스크 상위 2건과 후퇴선: ⑴ ① append 통일이 피드/앨범 연속재생 UX를 바꿈 — 화면 단위 호출부 1줄이라 개별 롤백(replace 유지) 가능, ⑵ ② 하이드레이션 대기가 부팅 로그인을 지연시킬 가능성 — hasHydrated 즉시 true면 현행과 동일 경로, 실패 시 타임아웃(2s) 후 기존 즉시 실행 폴백. 이월(백로그): 서버 큐 API(기기 간 동기화 — 백엔드 신설), 관련곡 자동 이어재생의 보관함 누적(결정 3), CoverGeneration 중첩 navigate(v3.222 이월분 유지).

## test-designer 항목
1. [unit] playerStore: 로그인 상태(queueOwnerId 有) 큐 편집(add/remove/reorder/setQueue/setCurrentIndex/playTrackAtIndex)마다 savedQueues[owner] 갱신, 비회원(owner null)은 미저장.
2. [unit] restoreQueueFor: 보관 큐 有→복원(queue·currentIndex·track, isPlaying false·sessionActive false), 보관 無+현재 큐 有→승계 저장, 보관 無+현재 큐 空→**saveOwnerQueue 미호출**(빈 덮어쓰기 방어).
3. [unit] resetOnLogout: 저장 후 초기화 순서, guestNoticeAck 유지, v3.219 DraftKeep 블록이 playerStore 무접촉 회귀 가드.
4. [unit] playTrackNow: mode 기본 append(중복 시 기존 인덱스 재생·추가 없음), replace 시 교체 — 플레이리스트 경로만 replace 호출 확인.
5. [unit] ChartScreen 검색 탭: 곡 탭 시 기존 큐 유지+해당 곡 append 재생(searchResults 통째 교체 없음).
6. [e2e] 핵심 재현: 로그인→담기 3곡→앱 강제종료→재시작(자동 로그인)→차트 '내 재생목록' 탭 = 3곡 그대로(자동 재생 없음·미니 미노출), 이어서 피드에서 다른 곡 재생→'내 재생목록' = 3곡+1곡(교체 아님)→재시작→4곡 유지.
7. [e2e] 로그아웃→재로그인 복원, 계정 A/B 전환 시 서로의 큐 미노출, 회원가입 직전 비회원 큐 claimQueue 승계.
8. [e2e] 정책 회귀: 비회원 담기(안내 팝업 1회·guestNoticeAck)→앱 재시작 시 폐기, 플레이리스트 재생=큐 교체 유지, 게스트 큐 안내 모달(TrackActionSheet:75-81·PlayerScreen:914) 무변경.
9. [e2e] 재생 흐름 회귀: 미니플레이어 토글/이전/다음(append된 큐 순서), v3.198 복원 큐 미니 미노출 유지, v3.216b~217 웹 미디어세션 next/prev(playback.ts:121-149 track 구독 동기화)가 append 큐에서 정상, 관련곡 이어듣기(큐 종료 시) 동작 유지.

## 사용자 결정 사안 (기본안 명시 — 미지시 시 기본안 진행)
1. **① 앨범 곡 탭**: 기본안 = append(곡 단위 탭이므로). 앨범을 플레이리스트에 준해 "교체"로 남기려면 AlbumDetailScreen 1곳만 replace 유지 지시 1줄.
2. **기기 간 동기화(서버 큐 저장)**: 기본안 = 이월(백로그 — 백엔드 모델·API 신설 필요, 이번 범위 앱 단독). 착수 원하면 B-백로그로 지시.
3. **관련곡 자동 이어재생 곡의 보관함 누적**: 기본안 = 현행 유지(청취 흐름 존중). 담은 곡만 보존 원하면 자동 추가분 저장 제외 지시.
4. **재시작 복원 1회 안내(토스트/배지)**: 기본안 = 미도입(팝업 최소화 — 복원은 '내 재생목록' 탭으로 확인). 원하면 앱내 다이얼로그 규칙(showAlert)로 1회 노출 지시.

규칙: 서버 무변경(라이브 EC2는 이번 분석에서 읽기 전용 grep만), 민감 정보 플레이스홀더(`<SSH_HOST>`=maidol-ec2), 코드 수정·커밋은 이 계획 승인 후 team-dev 루프에서, git 커밋은 오케스트레이터 승인 후.

# v3.227 — 아티스트 생성 결과 회수(이탈·복귀 재개) + 원격 로거 폭주 차단 + 위시 조회 경량화 + 꾸미기 피커 통합(브랜드 모아보기/펼쳐보기·대분류·필터·선택 스트립) + 얼굴 반영(사진 소실 가드·gpt_image_2 참조 인덱스) + 원본 얼굴사진 공개 노출 차단 + 비밀번호 찾기 SES 실발송 전환 점검

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD 4df2636 v3.226, 앱 1.1.8). **착수 전 작업트리 점검(2026-09-24)**: `git status --short -- 2_housing` = 미추적 문서 4건(MAIDOL_to_AIDOL_이식_로드맵_v42.md·디자인_품질_진단_v41.md·피그마_퍼스트_워크플로우_v40.md·피드백_소셜확산_계획서_v39.md)과 scratchpad/ 산출물뿐 — **수정(M)된 추적 파일 0건, 타 세션 미커밋 코드 작업 없음**. `git log -3` = 4df2636 / 931dbd4 / e88ffdb(v3.225~226) — 본 계획의 파일:라인은 이 HEAD 기준. 서버 실측 = `<SSH_HOST>`(maidol-ec2) 읽기 전용(파일 grep·sed, 컨테이너 내 mongo read-only 집계, IMDS·SES 읽기 API, DNS dig). 서버 파일 쓰기 0건(집계 스크립트는 /tmp에 올렸다가 삭제). .env는 **키 이름만** 확인. 출처 표기: [O]=오케스트레이터 추적(재조사 안 함), [P]=planner 실측.

## [최우선] H-1 근본원인 확정 — v3.219 [ArtistDraft] 회귀 (W0로 분리해 A~G보다 먼저 배포)
- 사용자 증상: 얼굴 사진을 올려 만들었는데 **ArtistResult '만들 때 사용한 사진'(ArtistResultScreen.tsx:940-950)이 뜨지 않고 얼굴 인증도 안 떴다**.
- [O] 확정 증거: 아티스트 "샘플"(characters 6ab4c5d18e018aff8332553c, real, 06:40:17Z)의 original_photo_object_name = 빈 문자열. sheet.png 6,124,198 bytes = **2차 job 6ab4c22b(source=text, photo=False) 결과와 바이트 크기 일치** → "샘플" = 사진 없이 생성된 2차 결과를 저장한 것. 1차 job 6ab4c16e(사진+텍스트, 06:21:30 face gate→verify match=True 정상 발동)의 결과와 원본(`characters/temp/<uid>/original_90a11746.jpg`)은 서버 temp에 남아 있고 **어떤 아티스트에도 연결되지 않음(실제 유실은 1차 1건)**.
- [P] 코드 경로 확정: ⑴ `characterTaskStore.ts:169-172` partialize = draft만 → photoUri·portraitConfirmed는 메모리 전용. ⑵ `ArtistInputScreen.tsx:161` resumableDraft 복원 시 step/qIndex가 **사진 단계를 이미 지난 상태**(questioning/style)로 되살아나고, `:203` 로컬 `photoUri`는 null로 시작 → 사진을 다시 달라는 UI 없이 질문을 이어갈 수 있다. ⑶ 질문을 마치면 `handleStartGeneration` → **`:593 taskStore.setInput({ photoUri, photoName, … })`이 null로 store 값을 덮어쓴다**(가상 경로 `:513 handleStyleConfirm`도 같은 형태). ⑷ 실사 텍스트 전용(v161)은 정상 기능이라 `:562` 가드(사진 없으면 텍스트 필수)만 통과하면 앱·서버 누구도 막지 않음 → `ArtistLoadingScreen.tsx:180-188` hasPhoto=false → FormData에 file 없음 → 서버 `character.py:1384-1392` face gate는 `contents is not None`일 때만 돌아서 **얼굴 인증 미발동**, ⭐10 과금 → `:246-259` upload-original-photo도 hasPhoto일 때만이라 스킵 → save에 original_photo_object_name 없음 → '사용한 사진' 미노출. v3.219(37a2304, 09-24 10:26) 이전에는 재진입 시 draft 복원이 없어 사진부터 다시 받았다 = 사용자 말 "원래는 떴다"와 일치.
- **W0 수정(앱 단독, 1조 선행 분리 커밋·빌드)**:
  1. draft에 `photoIntent: 'photo' | 'text' | null` + `photoName` 추가 — `handlePickPhoto` 확약 확인(:394-399)에서 'photo', `handleTextOnly`(:426-435)에서 'text'. URI는 계속 영속하지 않음(파일 소멸).
  2. 복원 시 `photoIntent==='photo' && !photoUri`면 **사진 단계로 되돌림**(step='welcome', selectedKind 유지, qIndex·styleAnswers는 보존해 재업로드 후 멈췄던 질문으로 복귀). 복원 chat의 "사진 선택: …" 버블은 디렉터 버블 "이어서 만들려면 얼굴 사진을 다시 올려주세요"로 교체. 사진 단계에서는 [사진 올리기](확약 다이얼로그 재표시 = 본인 사진 재확인 유지) / [사진 없이 설명으로 만들기](명시적 전환 → photoIntent='text')만 제공 — **사진 없이 사진 단계 뒤로 진행 불가**.
  3. `setInput` 호출부(:513, :593)는 **photoUri가 있을 때만** photoUri/photoName을 넘긴다(null로 덮어쓰기 금지). 텍스트 전용 명시 선택 때만 handleTextOnly가 비운다.
  4. 생성 직전 가드(`ArtistLoadingScreen.tsx` sheet 분기 :173-188, API 호출 전): `characterKind==='real' && photoIntent==='photo'(taskStore로 전달) && !photoUri`면 **요청 없이 중단**(⭐ 차감 0) → failApi + showAlert "얼굴 사진이 확인되지 않아 만들지 않았어요. 사진을 다시 올려주세요(별은 사용되지 않았어요)" → ArtistInput 사진 단계로.
  5. 로그 `[ArtistDraft] photo-intent restore {intent, hasUri}`, `[ArtistLoading] blocked: photo intent without photo`.
  - 서버 원본 재사용(아래 H-1 서버 항목)은 W1 옵션이며, 쓰더라도 [이전 사진 사용] 선택 시 확약 다이얼로그를 다시 띄우고 얼굴 게이트(바이트 SHA 기반)는 서버에서 그대로 돌게 한다 — 인증 우회 없음.
- W0 회귀 E2E(핵심 여정 — test-designer 1순위): 사진 업로드 → 이탈 3종(작업실 복귀 / 웹 새로고침 / 백그라운드 3분 후 복귀) → 이어서 진행 → 사진 단계 재요구 확인 → 재업로드 → 생성 시 서버 로그 **source=photo… photo=True·face gate 발동**, save에 **original_photo_object_name 채워짐**, ArtistResult **'만들 때 사용한 사진' 노출**. 음성 케이스: 재업로드 없이 진행 불가, 가드 발동 시 ⭐ 불변. 텍스트 전용 명시 선택은 기존대로 동작.

## 0단계 findings / Plan verification (파일:라인)

**A. 생성 결과 유실 — 서버는 끝까지 만들고, 앱이 받기를 포기한 뒤 버린다**
- [O] job 6ab4c16e(사진+텍스트)·6ab4c22b(텍스트만) 둘 다 서버 done, 각 ⭐10 차감. 폰 브라우저 백그라운드→복귀 때 조회가 연속 Network Error로 실패.
- [P] 폴링 `screens/ArtistLoadingScreen.tsx:57-82` — 5초 간격·180틱, **연속 오류 3회면 포기(:77)**. 화면이 다시 보이는지 확인하지 않고 지연(백오프)도 없어, 복귀 직후 네트워크가 되살아나기 전 1초 만에 3회를 모두 써버린다. 포기 시 문구 :77 + 공통 catch(:571-574)가 **"사용된 별은 자동으로 환불됩니다"를 덧붙인다 — 서버는 성공했으니 환불 없음 = 잘못된 안내**.
- [P] **결과 확정 단계가 전부 앱 쪽에 있다**: done 이후 upload-original-photo(:246-259) → `/character/save`(:290 — 슬롯 생성·영구 경로 복사) → ArtistResult. 앱이 중간에 끊기면 결과가 `characters/temp/{uid}/*.png`에 남는다(서버 `character.py:684-730` `_store_temp_sheet`). 이 temp 결과를 다시 찾을 방법이 없다: job_id를 저장하지 않고(`characterTaskStore.ts:169-172` partialize=draft만), 서버에는 목록 조회가 없다(`character.py` 라우트: GET /job/{id}(:1713)만 있음). /save가 job을 "소비됨"으로 표시하지도 않는다(:1892-2000에 character_jobs 접근 0).
- [P] 서버 job 문서 필드(실측): status·object_name·original_object_name(사진 원본 temp 경로)·preview_url·mode·character_id·art_style(_key)·point_ref·refunded·created/completed_at. 전체 64건, 최근 7일 done 6건. **인덱스는 _id 하나뿐**. 소비 여부를 과거 데이터로 추정하는 방법(characters.updated_at 20분 이내 변경)은 유실 2건까지 "소비됨"으로 오판해 **쓸 수 없음** → 소비 표시는 배포 이후에만 믿을 수 있다.
- [P] 재기동 부작용(F에도 해당): 백그라운드 작업은 프로세스 메모리에서 돌기 때문에(`BackgroundTasks`, character.py:1422-1440) 재기동하면 **진행 중 job은 'processing'으로 멈춘다**. 이를 정리하는 코드는 **다음 기동 때 30분 넘은 job만** 실패+환불 처리한다(`main.py:535-567`). 30분 안 된 job은 그다음 재기동까지 멈춘 채 별만 차감된 상태로 남는다.

**B. 원격 로거 폭주** — [O] 원인 추적 그대로. [P] 라인 확인: `utils/remoteLogger.ts:124-143` _enqueue(큐가 20 이상이면 즉시 _flush :142), `:145-170` _flush(401·422만 버림 :161, 나머지는 큐로 되돌림 :166-167, **동시 실행 방지 없음**, _inEmit는 불리언 하나라 겹친 flush에서는 무력 :58/:153/:169), 주기 flush 5초(:286-288). 서버는 토큰이 만료·무효면 403을 준다(`app/auth.py:28-32`), 세션이 없으면 401(:40-41). 참고로 get_current_user는 `?token=` 쿼리도 받는다(:18-21).

**C. 위시 조회 실패** — [P] `stores/wishlistStore.ts:47-68` sync가 `GET /wishlist/check?item_ids=<콤마 결합>`. 호출부 `ArtistCodyScreen.tsx:306`(카테고리 최대 500개 — 서버 `$sample 500`), `:337`(모자+가방 1,252개). ID 24자+%2C라 500개면 URL ≈13.5KB, 1,252개면 ≈34KB. 서버 쪽 `wishlist.py:131-150`에는 크기 제한이 없다. **그런데 이미 `GET /wishlist/`(:153 — 내 위시 전량, 보통 수십 건)가 있으므로 check 없이 wished 맵을 채울 수 있다** → 서버 변경 없이 해결 가능.

**D. 피커 데이터·UI (ad_items 실측, 활성·비숨김 4,674건)**
- 출처(seed_source): `fashion_brands_csv` 4,219(v3.216 브랜드샵, 소유 계정 1개 = 닉네임 '브랜드샵', 80브랜드) / `item_images_csv` 449(6개 플랫폼 계정 무신사·29cm·W컨셉·에이블리·지그재그·크림, 182브랜드) / 표기 없음 6(수동 등록 2계정).
- 카테고리별 합계: **상의 1,501 · 하의 1,421 · 신발 500 · 모자 629 · 가방 623**. 필드가 채워진 비율: name·product_name·brand·gender·color·image·product_url 100%. `price_krw`는 브랜드 데이터 4,196/4,219에만 있고 플랫폼 데이터는 0% (가격 3,000~950,000, 중앙값 72,000). **세부 분류(sub_category) 필드 없음.** color는 자유 텍스트라 표기가 584가지(BLACK/Black/블랙/black 등)이고, '기본' 1,055·'단일색상' 243은 실제로 색이 없다는 뜻.
- 성별: 브랜드 데이터 여성용 1,999 / 남성용 921 / 공용 1,299, 플랫폼 데이터 여성용 241 / 남성용 208.
- **서버 목록 API `business.py:406-448` `/ads/active`는 `$sample 500` 랜덤 추출** → 상의·하의는 열 때마다 약 1/3만 무작위로 보인다(브랜드를 모아서 보여주는 것 자체가 불가능). 쿼리 파라미터는 category 하나뿐, 페이지네이션 없음. 상의 500건 응답 = **345KB, 압축 없음**(nginx `gzip on`이지만 gzip_types 기본값에 JSON이 없음 — nginx.conf:46-53 실측, FastAPI GZip 미들웨어도 없음).
- **두 데이터가 따로 보이는 이유**: 앱 드릴다운 첫 단계 '플랫폼' = `advertiser_nickname`(`ArtistCodyScreen.tsx:95` platformOf). 그래서 무신사·29cm…와 **'브랜드샵'이 같은 줄에 나란히 선택지로 뜬다**(:716-721 facetOptions). 그 뒤 단계: 브랜드 › 성별 › 제품 › 색상(:702-714, v3.90 5단계).
- 브랜드 표기 오류: 카드 배지(:1162-1166)·카테고리 카드(:798-800, :931-933)·**생성 프롬프트 fmt(:454)·하의 지시문(:476)·appliedItems.brand(:599)**가 모두 advertiser_nickname을 쓴다. 그래서 브랜드샵 상품은 "브랜드샵 우먼즈룩 …"으로 프롬프트에 들어가고 카드에도 '브랜드샵'으로 표시된다(실제 브랜드명은 brand 필드에 있음).
- 세부 분류 규칙 가능성(상품명 키워드 규칙, 로컬 시험): 분류 성공률 **상의 93.2% · 하의 96.7% · 신발 82.2% · 모자 99.7% · 가방 98.7% (전체 94.7%)**, 나머지는 '기타'. 주의: 규칙 순서가 중요하다(티셔츠를 셔츠보다 먼저, 맨투맨/스웨트셔츠를 셔츠보다 먼저). 색상 계열 13종 정규화(텍스트 규칙 — 색이 '기본'이면 상품명에서 추출): **3,617/4,674 = 77% 분류, 874건은 '색상 정보 없음'**.
- 데이터 무결성: 이미지 60건 무작위 표본 전부 200(image/*), image_object_name 중복 0. (brand, category, name) 중복 290그룹·초과 문서 306, (product_url, color) 중복 213 — 색상 옵션을 문서 단위로 넣은 결과이며 동일 상품이 중복 노출됨(표시 단계에서 합치기는 백로그). color 값에 **'색상미표기_NNNN'·'Women'·'Men'·'Long' 같은 파싱 잔재**가 있음 → 표시할 때 숨김. 플랫폼 데이터 3건은 admin_hidden=False(노출 정상).
- 튜토리얼 앵커: ArtistCody에는 앵커가 없다(grep 0). Map(MapScreen.tsx:66-90)은 이번에 건드리지 않는다.

**E. 선택 상태** — [P] `ArtistCodyScreen.tsx:204` `selected`(컴포넌트 state, 카테고리당 1개). 피커를 닫거나 탭을 바꿔도 화면이 떠 있는 동안은 유지된다. **화면을 다시 들어오면 사라진다**(적용 시에만 `outfitStore.setItems`(:616)로 AppliedItem 저장 — 모양이 다르고, 새 시트 생성 시 clear(ArtistInputScreen.tsx:590)).

**F. 비밀번호 찾기 메일 — SES 전환은 v3.207에 이미 구현·배포돼 있고, 스위치만 꺼져 있다**
- [P] 코드: `app/services/mailer.py`(sesv2 boto3, 기본 자격 체인 = 인스턴스 롤, run_in_executor, 실패하면 dev 폴백). 라우트 `app/routes/auth.py:419-475`(request)·`:477-`(confirm), 코드는 bcrypt 해시로 **Redis `pwreset:code:{ekey}`에 TTL 15분**(:394-396), 시도 5회·시간당 5회 제한. 설정 키 `config.py:232-244`: MAIL_ENABLED·SES_REGION·MAIL_FROM·PASSWORD_RESET_CODE_TTL_MINUTES·PASSWORD_RESET_MAX_ATTEMPTS·PASSWORD_RESET_HOURLY_LIMIT.
- [P] **라이브 상태: mail_enabled=False**(컨테이너 settings 불리언 확인). 서버 .env에 MAIL_*/SES_* 키 자체가 없음(키 이름 grep: REDIS_*·AWS_FACE_*·AWS_FACE_USE_IAM_ROLE만 있음) → **지금 사용자는 재설정 메일을 받지 못한다. 코드는 서버 로그에만 찍힌다(dev 폴백)**. 앱은 계정 존재를 노출하지 않으려고 항상 200을 주므로 사용자에게는 "보냈다"고 보인다.
- [P] IAM: IMDS 역할 **maidol-ec2 존재**(리전 ap-northeast-2). 같은 역할로 sesv2 GetAccount/GetEmailIdentity/ListEmailIdentities 호출 → **AccessDenied** → 역할에 SES 권한이 없다(적어도 읽기 권한은 확정 없음, SendEmail 권한도 부여 흔적 없음). 관리자 헬스체크 SES 항목(admin_health.py:194-206)도 같은 이유로 실패 중일 것.
- [P] DNS(maidol.ai.kr, Cloudflare NS): **TXT(SPF) 없음·MX 없음·_dmarc 없음·_amazonses 없음**. DKIM CNAME은 셀렉터가 무작위라 조회로 확인 불가 → 도메인 검증은 콘솔에서 확인 필요(미검증으로 추정).
- [P] 재기동 영향: .env는 이미지에 들어가지 않고(.dockerignore:21-24), 컨테이너 생성 시점의 `--env-file`로 들어간다 → **`docker restart`로는 반영되지 않고, 컨테이너를 다시 만들어야 한다**(기존 배포와 같은 `docker rm -f` + `docker run … --env-file .env`, REPORT.md:3387). Redis는 별도 컨테이너 aimu-redis(`--appendonly yes`, docker-compose.yml:48, 09-17부터 가동) → **앱 컨테이너 재생성과 무관하게 재설정 코드·로그인 세션 유지** — 진행 중인 재설정 링크(코드)는 무효화되지 않음. 이미지 재빌드 불필요(코드 변경 0).

**G. 웹 배포 스크립트** — [P] `/Users/pearl/homepage/maidol/deploy.sh`: `app` = 2_housing에서 `rm -rf dist && npx expo export --platform web` → homepage/maidol/app로 복사 → assets/node_modules를 vendor-assets로 이름 변경하고 번들 해시 갱신 → index.html을 app.html로 바꾸고 app-shell(PC 래퍼)을 index로 → `wrangler pages deploy --project-name=maidol-app`(app.maidol.ai.kr). `landing` = www → project maidol(maidol.ai.kr). `all`(**인자를 안 주면 기본값**) = 둘 다. 전제: wrangler Cloudflare 로그인 상태, **2_housing 작업트리 그대로 빌드됨(커밋되지 않은 변경도 포함)** → 커밋 후, 작업트리가 깨끗할 때 실행.

**H. 얼굴 반영 (추가 항목 — [O] 추적 + [P] 설계 근거)**
- H-1 사진 소실 경로(코드로 확정): `ArtistInputScreen.tsx:201-204` photoUri는 **로컬 state이고 v3.219 draft 영속에서 빠져 있다**(`characterTaskStore.ts:169-172`). draft는 생성에 성공해야만 지워진다(ArtistResult reset). 그래서 실패 후 아티스트 만들기에 다시 들어오면 **Q&A는 복원되지만 사진은 null**이고, `handleStartGeneration`(:559-)이 **`setInput({ photoUri: null … })`(:593)으로 store에 남아 있던 사진까지 덮어쓴다**. 사진이 없으면 텍스트 전용 경로로 조용히 진행되고(:562는 텍스트가 있으면 통과), 과금된다. 폰 웹에서 페이지가 새로 로드된 경우에도 메모리 store가 비어 같은 결과. 그런데 ArtistCody는 실사 모드에서 사진 유무와 상관없이 "【필수 유지】 얼굴 인상·체형은 첨부된 사용자 사진을 따라"(ArtistCodyScreen.tsx:582-586)를 프롬프트에 넣는다 → 사용자도 모델도 사진이 있다고 여기게 됨. 서버에는 이전 사진이 남아 있다: job.original_object_name(`characters/temp/{uid}/original_{8hex}.jpg`, character.py:704-716).
- H-2 서버 구조: `character.py:1307-1308` 실사는 gpt_image_2로 고정(v217 [ModelPin] — **도입 사유는 앱팀 요청 "모델 선택 없이 하나로 고정"**(TripleJ-backend APP_TEAM_HANDOFF_v216.md:190-200). 얼굴 동일성 비교에서 나온 결정이 아님). `character_generator.py:948-985` `_build_inline_images`는 "[인물 사진]:" 같은 역할 라벨 텍스트를 이미지 앞에 붙이지만, **gpt_image_2 분기(:1233-1245)는 inlineData 바이트만 추출** → 라벨이 사라진다. 그런데 Step B 프롬프트(:1403-1406)는 "[인물 사진] 라벨이 붙은 이미지는…"이라고 라벨이 있다고 가정 → 모델이 어느 이미지가 얼굴인지 알 수 없다. CHARACTER_SYSTEM_INSTRUCTION은 Gemini 경로(:1250-1253)에만 전달된다. `openai_image.py:94-125` `_call_edits`는 모든 참조를 `ref_{i}.png`/image/png로 표기(원본은 jpg). 사진은 이미 첫 번째로 들어간다(:960-962 순서: 사진→상의→하의→신발). **텍스트 우선 조항**: `:936-942` "사용자 설명과 사진이 충돌하면 사용자 설명을 우선" + 앱 Q&A가 사진이 있어도 머리·얼굴·피부·체형을 묻고(ArtistInputScreen.tsx:90-110, buildFinalText :128-140) "머리는 …, 얼굴은 …"을 보낸다 → **긴 생머리→단발, 둥근 얼굴→갸름한 얼굴 변화는 답변이 사진을 덮어쓴 결과일 수도 있다**(서버가 user_text를 로그에 남기지 않아 확인 불가 — 이번에 길이·해시·키워드 로그 추가).
- **OpenAI 공식 문서 확인(WebFetch)**: `input_fidelity`는 "gpt-image-2와 gpt-image-2-2026-04-21은 이 파라미터를 무시한다"(API reference Create image edit). 프롬프트 가이드에는 "input_fidelity does not work for this model because output is already high fidelity by default". 실제로 gpt-image-2에 input_fidelity를 보내면 **400 `invalid_input_fidelity_model`**(pydantic-ai 이슈 #5413). → **입력 충실도 상향은 쓸 수 없음(보내면 실패)**. 공식 권장: "Reference each input by index and description ("Image 1: … Image 2: …")", "Preserve her exact likeness, expression, hairstyle, and proportions … lock what must not change". 이미지는 최대 16장, PNG/WebP/JPG 허용.
- H-3 [보안]: `character.py:2440-2461` preview 프록시는 **인증 없이** faces/·evidence/만 막는다 → `characters/{uid}/original_*`(영구, upload-original-photo :575-581)와 `characters/temp/{uid}/original_*`가 토큰 없이 200([O] curl). 원본을 쓰는 앱 코드: `ArtistLoadingScreen.tsx:95-118` appendMinioImageToForm(웹 fetch·네이티브 downloadAsync, 인증 없음), `ArtistResultScreen.tsx:305-315, :434-435`(원본 사진을 `<Image uri>`로 표시). 관리자 웹은 `/api/admin/media` 프록시를 쓰므로(admin_moderation.py:76-91) 영향 없음. 시트·아이템 이미지(tracks.py:1624 등 공개 사용)는 공개 유지.

## 확정 스펙

### A. 생성 결과 회수 [서버+앱, 1조+백엔드]
- **서버(character.py)**
  1) `GET /api/character/jobs/recoverable` — 내 job 중 `consumed_at`·`dismissed_at`이 없고 `created_at >= max(now-7d, RECOVERABLE_SINCE)`인 것. done → {job_id, mode, status, object_name, preview_url, original_object_name, character_id, art_style(_key), created_at, completed_at}, processing → {job_id, mode, status, created_at}. 조회 시 **30분 넘은 processing은 즉시 failed+환불로 정리**(main.py:549-563의 claim+`refund_character_job_points` 재사용 — 재기동을 기다리지 않는 lazy 정리. voice 만료 lazy 체크 관행과 같음). 최신순 최대 10건. 로그 `[CharJob] recoverable user=… n=…`.
  2) `/character/save`(:1892) 성공 경로 끝에 best-effort `character_jobs.update_one({user_id, object_name: body.sheet_object_name}, {$set:{consumed_at}})` — 정상 생성 흐름이 자동으로 소비 표시를 남긴다.
  3) `POST /api/character/job/{job_id}/dismiss` — 본인 done job만, `dismissed_at` 설정(결과 버리기). **환불 없음**(성공 결과가 전달된 것이므로 — 실패만 환불하는 기존 정책과 일치).
  4) 인덱스 `character_jobs (user_id, created_at)` — **main.py는 건드리지 않는다**(07:03Z에 다른 세션이 .bak 없이 수정·배포함). character.py 안에서 recoverable을 처음 호출할 때 프로세스당 1회 create_index(멱등, 모듈 플래그).
  5) 상수 `RECOVERABLE_SINCE`: 기본 = 배포 시각(과거 job은 소비 여부를 알 수 없어 다시 나타나지 않게 함). **사용자가 오늘 유실 2건을 "살리기"로 결정하면 `2026-09-24T06:00:00Z`로 설정** → 두 건이 해당 사용자의 회수 목록에 자동으로 뜬다. 06:00Z 이후 타 사용자 done job이 있으면 배포 직전 읽기 전용 조회로 확인해 보고한다.
- **앱**
  1) `characterTaskStore`: 영속 필드 `activeJob: {jobId, mode:'sheet'|'outfit', kind, targetCharacterId, pendingName, pendingGender, pendingAge, legacyContract, startedAt}`(텍스트만 — 2026-09-07 보존 정책) 추가. POST로 job_id를 받자마자 기록하고, save 성공·dismiss·failed 수신 시 비운다. partialize에 activeJob 추가.
  2) `pollCharacterJob`(:57-82) 재작성: 화면이 보일 때만 오류를 센다(웹 `document.visibilityState`, 네이티브 AppState). 보이게 되면 1.5초 기다렸다가 즉시 1회 조회. 연속 오류는 5→10→20→40→60초 백오프. 포기 기준을 "오류 3회"에서 **"화면에 보인 상태로 누적 3분 연속 실패" 또는 job 생성 후 20분 경과**로 변경. 404는 즉시 종료. 로그 `[ArtistLoading] poll resume/visible/backoff`.
  3) 포기·이탈 시 문구: "생성은 서버에서 계속되고 있어요. 완성되면 '내 아티스트'에서 받아볼 수 있어요." — **환불 문구 제거**(:77, :571-574 — 서버가 실제로 실패했을 때만 환불 안내).
  4) ArtistLoading 재진입(resume 모드): store에 activeJob이 있으면 POST 없이 폴링만. done 이후 처리(save → ArtistResult)는 공통 함수 `finalizeCharacterJob(job, ctx)`로 추출해 신규·재개·회수가 같은 경로를 쓴다(upload-original-photo는 사진 파일이 메모리에 있을 때만, 없으면 job.original_object_name을 save의 original_photo_object_name으로 보냄).
  5) 회수 UI: `MyArtistsScreen` 상단과 `ArtistInputScreen` welcome에 "완성된 아티스트가 도착했어요 (n)" 카드(미리보기 썸네일) → [아티스트로 저장](finalize — 409 슬롯 초과면 기존 확장 다이얼로그 재사용) / [버리기](dismiss, showAlert 확인). processing이면 "만드는 중" 카드 + 탭하면 ArtistLoading resume. 조회 시점: 두 화면 focus 때, 로그인 사용자만, 30초 스로틀. `services/characterService.ts`에 listRecoverableJobs·dismissJob 추가. 서버 404(구서버)면 조용히 무시.
  6) outfit 모드도 같은 activeJob/resume을 적용(회수 목록에서는 mode=real/cartoon + character_id로 대상 아티스트 갱신 저장).

### B. 원격 로거 [앱 단독, 1조]
- `_flush`: **401·403·422는 전부 버림(drop)**. 추가로 401·403이면 `_authBlockedToken = 현재 토큰`으로 로거를 일시정지(같은 토큰인 동안 enqueue·flush 무동작, authStore 토큰이 바뀌면 해제).
- 한 번에 하나만 실행: `_inflight: Promise|null` — 실행 중이면 새 flush는 무동작(임계치 트리거 포함). `_inEmit` 불리언은 카운터로 바꾸거나 inflight로 대체.
- 실패 백오프: 네트워크·5xx면 `_nextAllowedAt = now + min(5s·2^n, 5분)`. 연속 5회 실패 시 서킷 차단 10분(큐는 MAX_QUEUE로 자르고 유지). 성공하면 초기화.
- 임계치 즉시 flush(:142)는 백오프·서킷·inflight 조건을 모두 통과할 때만.
- 목표 수치: 만료 토큰 상태에서 **분당 요청 ≤1**(첫 403 이후 0).

### C. 위시 조회 [앱 단독, 1조]
- `wishlistStore.sync(itemIds)`의 **시그니처는 유지**(2조 호출부를 바꾸지 않기 위해). 내부를 `GET /wishlist/` 1회로 교체해 wished 맵을 채운다(서버 쿼리스트링 없음): 목록 id → true, 넘겨받은 itemIds 중 목록에 없는 것 → false. 60초 이내 재호출은 캐시(피커를 열 때마다 호출돼도 1회). `/wishlist/check`는 더 이상 쓰지 않는다(서버 라우트는 그대로 둠 — 구버전 앱 호환).
- 로그 `[wishlistStore] sync via list { listed, requested }`.

### D. 꾸미기 피커 통합 + 대분류·필터 [서버+앱, 2조+백엔드]
- **서버**: 신규 `GET /api/business/ads/catalog?category=`(ALLOWED 5종, 인증 없음 — /ads/active와 같음). 전량 반환(`$sample` 없음), 정렬은 source_rank 오름차순 후 created_at. 필요한 필드만 추림: `{id, name, product_name, brand(없으면 advertiser_nickname), gender, color(잔재 값은 빈 문자열), color_family, sub_category, price_krw|null, image_object_name, product_url, source:'brand'|'platform'}`. 응답은 **gzip**(Accept-Encoding: gzip이면 라우트 안에서 gzip.compress + Content-Encoding 헤더 — 전역 GZip 미들웨어는 오디오 Range 스트리밍을 깨뜨릴 수 있어 쓰지 않음). 상의 1,501건 예상 ≈330KB → gzip 후 약 50~70KB. `/ads/active`는 그대로 유지(구버전 앱·PlayerScreen 등).
- 신규 `app/services/item_taxonomy.py`: `classify_sub_category(category, name)`(규칙 순서가 중요 — 이번에 시험한 규칙표를 그대로 옮기고 보강: 상의 = 아우터·가디건·후드·맨투맨·니트·원피스·나시·티셔츠·셔츠/블라우스·기타 / 하의 = 스커트·반바지·데님·슬랙스·트레이닝/조거·카고/와이드·팬츠·기타 / 신발 = 스니커즈·부츠·로퍼/구두·샌들/슬리퍼·기타 / 모자 = 볼캡·버킷햇·비니·베레모/기타 / 가방 = 백팩·크로스백·토트백·숄더백·미니/파우치·기타), `color_family(color, name)`(13계열: 블랙·화이트·아이보리/크림·그레이·네이비·블루·베이지/브라운·그린·레드/버건디·핑크·퍼플·옐로/오렌지·멀티, 없으면 null). **응답을 만들 때 계산하고 DB에는 쓰지 않는다**(4.7k건이라 비용 무시할 수준, 규칙은 재배포로 개선, 프로덕션 DB 쓰기 0). 이미지 기반 색상 채우기(874건 미상)는 백로그.
- **앱 UX(피커 모달 재구성)**
  - 상단: E 선택 스트립 → [전체 | 내 위시리스트] 탭(유지) → (전체 탭) 보기 전환 [브랜드 모아보기 | 브랜드 펼쳐보기].
  - 대분류 칩 가로 스크롤: '전체' + sub_category(개수 표시, 0건은 숨김). 악세서리는 v3.206 [모자 | 가방] 세그먼트를 유지하고 그 아래에 해당 대분류 칩.
  - 필터 행: [성별 칩](v3.205/207 자동 필터를 그대로 이식 — 기본 ON, '◯◯용만/전체 보기', 성별 미설정 안내 칩 유지) · [색상 ▾](계열 스와치 다중 선택, '색상 정보 없음' 상품은 색상 필터를 켜면 제외) · [가격 ▾](~3만/3~5만/5~10만/10만~, 가격 없는 상품은 가격 필터를 켜면 제외하고 "가격 정보가 있는 상품만" 안내) · [브랜드 ▾](펼쳐보기 전용, 검색 가능한 다중 선택). 활성 필터 개수 배지와 [초기화].
  - **모아보기**: 필터·대분류 적용 후 브랜드별 그룹 카드(브랜드명·상품 수·썸네일 3장), 상품 수 내림차순 → 탭하면 해당 브랜드의 상품 그리드, 상단 브레드크럼 "전체 브랜드 › {브랜드}"와 뒤로. **플랫폼 단계 폐지 — 무신사/지그재그/브랜드샵 구분 없이 brand 단위로 통합.**
  - **펼쳐보기**: 필터 적용된 전체 상품 그리드, 정렬 [추천순(source_rank) | 낮은 가격순 | 높은 가격순](가격순에서 가격 없는 상품은 뒤로).
  - 상품 카드: 배지 = `brand`(advertiser_nickname은 폴백일 때만), 상품명, 색상 텍스트(잔재 값 숨김), 가격(있을 때 "72,000원"), 판매처 보기·하트 유지, 선택됨 표시(v3.124) 유지, 선택된 상품 맨 앞 정렬 유지.
  - 필터 적용 위치 = **클라이언트**(카테고리별 최대 1,501건을 한 번에 받는 규모라 즉시 반응하는 패싯 계산이 유리하고, 서버 쿼리 파라미터를 늘릴 필요 없음). FlatList `initialNumToRender 8·windowSize 5·removeClippedSubviews`, 이미지 lazy.
  - 카탈로그 캐시: 카테고리별 메모리 캐시 10분(모달을 다시 열 때 재요청 없음). catalog가 404(구서버)·오류면 `/ads/active` → 그래도 0건이면 SAMPLE 폴백(v3.216 관행 그대로 — sub_category/color_family가 없으면 모두 '기타' 취급).
  - 보기 모드·대분류·필터 상태는 화면 state로 유지(피커를 닫아도 카테고리별로 기억), 성별 필터는 기존대로 피커를 열 때마다 ON으로 복귀.
  - **브랜드 표기 정정**: fmt(:454)·bottomName(:476)·appliedItems.brand(:599)·카테고리 카드(:798-800, :816, :931-933)·위시 카드(:1275)를 `brandOf(item)`(brand 우선)로 → 프롬프트에 실제 브랜드명이 들어간다.
- 구조: 모달을 `components/cody/CodyPickerModal.tsx`(+ `CodyFilterBar.tsx`, `BrandGroupGrid.tsx`, `SelectedItemsStrip.tsx`)로 분리. 파생 계산은 `utils/codyCatalog.ts`(순수 함수 — 필터·그룹·정렬, 유닛 테스트 대상). API는 `services/catalogService.ts`.

### E. 선택 아이템 미리보기 스트립 [앱, 2조]
- 피커 모달 헤더 바로 아래에 가로 스트립: 상의·하의·신발·모자·가방 5칸 고정 순서, 각 칸 = 44px 썸네일(선택 없으면 점선 빈 칸 + 카테고리명). 현재 카테고리 칸은 강조 테두리.
- 탭 동작(자율 확정): **썸네일(또는 빈 칸)을 탭하면 해당 카테고리 피커로 전환**(모자/가방은 악세서리 모드 서브탭으로) — 하의를 고르다가 상의를 바꾸는 흐름을 모달 안에서 끝낼 수 있게. 해제는 기존 관행대로 카테고리 카드를 길게 누르기(스트립은 탭 전환만 — 실수로 지우는 것 방지).
- 재진입 유지: `outfitStore`에 `codyDraft: Record<Cat, AdItem 최소필드>` + `codyOptions` 추가(영속 — 텍스트/id만). ArtistCody mount 시 복원하고 선택이 바뀔 때마다 기록. 적용 성공(ArtistResult 도달)이나 새 시트 시작(ArtistInput :590 clear)에서 비운다. 복원한 아이템이 카탈로그에서 사라졌으면(비활성) 표시는 하되 적용 전 경고.
- 로그 `[ArtistCody] strip jump {from,to}`, `[ArtistCody] draft restore {n}`.

### F. 비밀번호 찾기 SES — 판정: **전환 가능(문제 없음), 코드 변경 0**
- 판정 근거: ① 발송 코드(mailer.py)는 v3.207부터 운영 중이고 설정 스위치만 꺼져 있음. ② 전환에 필요한 서버 작업 = .env 3줄 + **컨테이너 재생성 1회**(이미지 재빌드 불필요). 재생성 동안 API는 수 초~수십 초 응답 불가(이미지 HEALTHCHECK start-period 90s가 상한) — 평소 배포와 같은 수준이며, 앱은 A·B 수정 이후 이 구간을 백오프로 견딘다. ③ 재설정 코드·세션은 별도 Redis 컨테이너(AOF 영속)에 있어서 앱 컨테이너 재생성에 영향이 없다 → 진행 중인 재설정도 유지. ④ SES 실패(권한·샌드박스·검증 미완료)면 mailer가 예외 없이 dev 폴백 → 서비스가 죽을 위험은 없다. 대신 메일이 조용히 안 가는 문제가 있으므로 `[mailer] ses send failed` 로그를 배포 검증 항목에 넣는다.
- **재기동에 따른 진짜 리스크는 SES가 아니라 진행 중인 생성 작업**: 재생성 순간의 character job은 멈춘 채 남는다(0단계 A). 대응: ⑴ 배포 직전 `character_jobs status=processing` 0건 확인(읽기 전용), ⑵ A의 lazy 정리(30분 넘으면 실패+환불)로 재기동을 기다리지 않고 복구. 작곡·영상 생성 중인 job도 배포 직전 확인 대상에 포함(generations processing 건수 조회).
- **SES 적용 방식은 v3.227 서버 배포와 같은 재생성 1회에 합친다**(.env가 준비됐을 때만 MAIL_ENABLED=true, 아니면 이번에는 false 유지 — 코드 배포와 분리 가능).
- 사용자 AWS 콘솔·DNS 체크리스트(순서대로):
  1. SES(ap-northeast-2) → Identities → Create identity → Domain `maidol.ai.kr`, Easy DKIM(RSA 2048). 표시되는 **CNAME 3개를 Cloudflare DNS에 추가 — 프록시 OFF(DNS only)**. 상태가 Verified가 될 때까지 대기(보통 수 분~72시간).
  2. (권장) Custom MAIL FROM `mail.maidol.ai.kr`: Cloudflare에 MX `feedback-smtp.ap-northeast-2.amazonses.com`(우선순위 10) + TXT `v=spf1 include:amazonses.com ~all`.
  3. (권장) DMARC: Cloudflare TXT `_dmarc.maidol.ai.kr` = `v=DMARC1; p=none;` (Gmail 수신 신뢰도).
  4. SES → Account dashboard → **Request production access**(샌드박스 해제 — 용도: 비밀번호 재설정 트랜잭션 메일, 예상량 소량). 승인 전에는 검증된 수신 주소로만 발송된다(E2E는 본인 주소를 Verified identity로 추가해서 테스트 가능).
  5. IAM → Roles → `maidol-ec2` → 인라인 정책 추가: `ses:SendEmail`(Resource `arn:aws:ses:ap-northeast-2:<ACCOUNT_ID>:identity/maidol.ai.kr`) + `ses:GetAccount`(Resource `*` — 관리자 헬스체크용).
  6. 서버 .env에 `MAIL_ENABLED=true`, `SES_REGION=ap-northeast-2`, `MAIL_FROM=no-reply@maidol.ai.kr` 추가 — **사용자가 직접 편집**(값은 문서·로그에 남기지 않음). 이후 컨테이너 재생성은 배포 절차 §6에서 오케스트레이터가 수행.
- 검증: 본인 이메일로 앱 "비밀번호 찾기" → 메일 수신(스팸함 포함 확인) → 코드로 변경 → 로그 `[mailer] ses send ok kind=reset`(코드 값은 미기록 확인) → admin 시스템 탭 SES 초록.

### H. 얼굴 반영 [서버+앱, 백엔드+1조]
- **H-1 사진 소실 가드(앱)**
  - **W0 = 문서 상단 "[최우선] H-1" 절의 수정 1~5가 정본**(draft `photoIntent`, 사진 단계로 되돌림, :513/:593 null 덮어쓰기 금지, ArtistLoading :173-188 생성 직전 가드, 로그). 여기에 W1에서 [이전 사진 사용] 선택지를 더한다: 회수 가능한 최근 job의 original_object_name 또는 서버 캐릭터 original이 있을 때만 노출, 선택하면 확약 다이얼로그를 다시 띄운 뒤 `reuseOriginalObjectName`으로 전송.
  - ArtistCody 실사 sheet 모드 상단에 "얼굴 사진 포함 / 설명으로 만들기" 배지. 사진이 없으면 【필수 유지】 문구(:582-586)를 "설명된 외모를 유지"로 분기(가상 분기와 같은 형태).
- **H-1 원본 재사용(서버)**: generate-sheet-async·generate-sheet(sync)에 선택 Form `original_object_name` 추가 — 파일이 없고 이 값이 있으면 소유권 검증(`characters/temp/{uid}/original_` 또는 `characters/{uid}/original_` 접두어, 타인이면 403) 후 MinIO에서 바이트를 읽어 contents로 사용. 얼굴 인증 게이트(SHA 기반, :1384-1392)는 같은 바이트라 그대로 통과. 앱의 outfit 실사 경로도 이 Form을 쓰도록 바꿔 `appendMinioImageToForm`(원본을 앱이 내려받아 다시 올리는 것) 자체를 없앤다 → H-3과 자연스럽게 맞물림.
- **H-2 동일성(서버) — 채택 ⓐ(인덱스 명시), ⓑ는 A/B로 판정**
  - ⓐ `_call_image_backend` gpt_image_2 분기: parts를 순회하며 라벨 텍스트를 모아 **"Image 1: [인물 사진] — 이 인물의 얼굴형·이목구비·헤어(길이·색·스타일)·피부·체형을 그대로 유지. Image 2: [상의 참조] — 의상만 참조 …"** 형태의 인덱스 맵을 프롬프트 맨 앞에 붙이고, CHARACTER_SYSTEM_INSTRUCTION을 프롬프트 선두 블록으로 합친다(Gemini의 systemInstruction에 해당). Step B 문구 "[인물 사진] 라벨이 붙은 이미지"는 gpt 경로에서 "Image 1([인물 사진])"로 치환. 사진이 첫 번째 순서라는 것을 코드 주석과 assert로 고정. 공식 가이드의 identity lock 문구("Preserve exact likeness … Replace only the clothing")를 추가.
  - `openai_image._call_edits`: 참조 파일명·MIME을 실제 포맷으로(매직바이트로 판별: jpg/png/webp). **input_fidelity는 보내지 않는다**(gpt-image-2는 400 — 공식 문서 근거를 주석으로).
  - 텍스트 우선 조항 수정(:936-942): "사용자가 **명시적으로 바꾸라고 한 항목(헤어 등)만** 설명을 우선하고, 얼굴형·이목구비·피부 특징은 항상 사진을 따른다." 앱 쪽(1조): 사진이 있을 때 Q&A의 머리·얼굴·피부·체형 질문 안내를 "사진과 다르게 하고 싶을 때만 적어주세요(건너뛰면 사진 그대로)"로 바꾼다(ArtistInputScreen QUESTIONS 문구 — 사진 유무 분기).
  - 관측: `[CharGen] user_text chars=%d hair_kw=%s face_kw=%s sha8=%s`(원문은 남기지 않음), `[CharGen] gpt refs=[photo,top,...] mimes=[...]`.
  - ⓑ A/B: 배포 전 스테이징 스크립트 `scripts/ab_face_v3227.py`(컨테이너 안에서 generate_character_sheet를 직접 호출 — ⭐·슬롯·DB 쓰기 없음, 결과는 /tmp 로컬 png): **테스트 계정 사진 1장(사용자 제공 또는 오케스트레이터 테스트 사진) × {현행 gpt, ⓐ gpt, nb_pro} × 1회 = 3회 생성**(OpenAI 2 + Gemini 1, 호출 비용만). 사용자가 육안으로 판정 → nb_pro가 확실히 우월하면 REAL_SHEET_MODEL 전환은 **사용자 결정 사안**(v217 고정은 앱팀 요청이었으므로 되돌리는 것은 가능, 대신 실사 화질·의상 재현 차이도 함께 비교).
- **H-3 원본 얼굴 사진 보호(서버+앱)**
  - 서버 preview(:2440): 경로가 `characters/{uid}/original_` 또는 `characters/temp/{uid}/original_`(정규식)이면 `get_current_user`(헤더 또는 기존 ?token= 폴백) 필수 + `session.id == uid` 또는 role admin일 때만 200. 아니면 **404**(존재를 드러내지 않음 — faces/ 차단과 같은 관행). 로그 `[preview] original denied reason=`. 추가로 media_type을 매직바이트로(현재 png 고정).
  - 앱: 신규 `utils/authImage.ts` — 네이티브는 `{uri, headers:{Authorization}}` 소스, 웹은 `fetch(Authorization)` → blob → `URL.createObjectURL`(언마운트 시 revoke). 적용 위치 ArtistResultScreen.tsx:305-315, :434-435(원본 사진 표시). ArtistLoading의 원본 다운로드(:95-118)는 H-1에 따라 `original_object_name` Form으로 대체되어 제거. **URL에 JWT를 넣는 방식은 쓰지 않는다**(nginx access log 노출 방지).
  - 순서: 서버 배포(게이트 포함)와 웹 배포를 같은 창에서 진행. **APK 1.1.8은 실사 옷 입히기(원본 재다운로드)와 원본 사진 표시가 401/404로 깨짐** — 사용자 결정 2(기본안: 보안 우선 즉시 차단, APK 1.1.9에서 복구). 장소 사진(`characters/{uid}/locations/`)도 실사진이라 같은 문제가 있으나 이번 범위 밖(백로그).

## 변경 매트릭스
| 파일 | 변경 | 담당 | 로그 추적자 |
|---|---|---|---|
| screens/ArtistLoadingScreen.tsx | A 폴링 재작성·resume 모드·finalize 추출·문구 정정 / H-1 전송 전 가드·original_object_name Form / H-3 appendMinioImageToForm 제거 | 1조 | `[ArtistLoading] poll …`, `[CharRecover]` |
| stores/characterTaskStore.ts | A activeJob(영속)·H-1 textOnlyConfirmed·reuseOriginalObjectName | 1조 | `[CharRecover]` |
| screens/ArtistInputScreen.tsx | H-1 draft hadPhoto·재업로드 버블·:593 덮어쓰기 금지 / H-2 사진 모드 Q&A 문구 / A 회수 카드 | 1조 | `[ArtistDraft]`, `[CharRecover]` |
| screens/MyArtistsScreen.tsx | A 회수 카드(저장/버리기/진행중) | 1조 | `[CharRecover]` |
| screens/ArtistResultScreen.tsx | H-3 원본 사진 authImage 적용(:305-315, :434-435) | 1조 | `[authImage]` |
| services/characterService.ts | A listRecoverableJobs·dismissJob | 1조 | `[CharRecover]` |
| utils/authImage.ts (신규) | H-3 인증 이미지 소스(네이티브 헤더/웹 blob) | 1조 | `[authImage]` |
| utils/remoteLogger.ts | B drop 403·인증 일시정지·inflight·백오프·서킷 | 1조 | `[remoteLogger]`(원래 console로 1회만 경고) |
| stores/wishlistStore.ts | C sync → GET /wishlist/ 기반(시그니처 유지)·60초 캐시 | 1조 | `[wishlistStore] sync via list` |
| screens/ArtistCodyScreen.tsx | D 피커를 CodyPickerModal로 교체·브랜드 표기 정정(:454/:476/:599/:798/:816/:931) / E draft 복원·기록 / H-1 사진 배지·【필수 유지】 분기(:582-586) | **2조 전유** | `[ArtistCody]` |
| components/cody/CodyPickerModal.tsx·CodyFilterBar.tsx·BrandGroupGrid.tsx·SelectedItemsStrip.tsx (신규) | D·E UI | 2조 | `[ArtistCody]` |
| utils/codyCatalog.ts (신규) | D 필터·그룹·정렬·가격 구간·색상 스와치 맵(순수 함수) | 2조 | — |
| services/catalogService.ts (신규) | D catalog 호출·캐시·/ads/active 폴백 | 2조 | `[catalog]` |
| stores/outfitStore.ts | E codyDraft·codyOptions(영속) | 2조 | `[ArtistCody] draft` |
| 서버 app/routes/character.py | A recoverable·dismiss·save 소비 표시·인덱스 / H-1 original_object_name Form / H-3 preview 게이트 | 백엔드 | `[CharJob]`, `[preview]` |
| 서버 app/main.py | **변경 없음**(다른 세션이 07:03Z 수정 — 인덱스는 character.py lazy 생성으로 대체) | — | — |
| 서버 app/services/character_generator.py | H-2 인덱스 맵·system 합성·텍스트 우선 조항·관측 로그 | 백엔드 | `[CharGen]` |
| 서버 app/services/openai_image.py | H-2 MIME/파일명 정정(input_fidelity 금지 주석) | 백엔드 | `[OpenAIImage]` |
| 서버 app/routes/business.py | D /ads/catalog(gzip·필드 축소) | 백엔드 | `[catalog]` |
| 서버 app/services/item_taxonomy.py (신규) | D 세부 분류·색상 계열 규칙 | 백엔드 | — |
| 서버 scripts/ab_face_v3227.py (신규, 스테이징 전용) | H-2 A/B 3회 | 백엔드 | `[ABFace]` |
| 서버 .env | F MAIL_ENABLED·SES_REGION·MAIL_FROM | **사용자** | `[mailer]` |

충돌 방지: 1조와 2조의 공유 접점은 `wishlistStore.sync` 시그니처(불변)와 `characterTaskStore`(2조는 읽기만 — 사진 배지용 `photoUri`/`characterKind`)뿐. ArtistCodyScreen은 2조만 편집하고, 1조의 H-1 ArtistCody 변경분(배지·【필수 유지】 분기)도 2조가 반영한다.

## 조 분담 (할당문)
- **1조(frontend-dev A) — [먼저] W0 H-1 앱 수정만 담은 단독 커밋(ArtistInputScreen·characterTaskStore·ArtistLoadingScreen 가드) → 오케스트레이터 검증·웹 배포 → 이어서 A+B+C+H-1 W1분+H-2(앱 문구)+H-3(앱)**: ArtistLoading 폴링·resume·finalize 공통화, activeJob 영속, MyArtists·ArtistInput 회수 카드, 사진 소실 가드와 draft hadPhoto, 원본을 Form으로 재사용, authImage, remoteLogger 방어 5종, wishlist sync 교체. ArtistCodyScreen은 건드리지 않음. 서버 신규 API가 404면 조용히 기존 동작(구서버 호환).
- **2조(frontend-dev B) — D+E(+H-1 ArtistCody 부분)**: 먼저 **행동 변화 없는 추출 커밋**(현행 피커를 CodyPickerModal로 그대로 옮김, 스냅샷·회귀 확인) → 이어서 기능 커밋(catalog·모아보기/펼쳐보기·대분류·필터·스트립·draft·브랜드 표기). v3.205 성별 칩·v3.206 서브탭·위시 탭·SAMPLE 폴백 문구·v3.124 선택됨 표시를 그대로 옮긴다.
- **백엔드(backend-dev) — 서버 A·D·H 코드**: `/private/tmp/server_staging_v3227/`에서만 작업(라이브 원본을 읽기로 가져와 `_orig/` 보존 + MD5SUMS). py_compile, 유닛(분류 규칙표 골든 케이스·recoverable 필터·preview 게이트 경로 정규식·Form 소유권 검증), DEPLOY.md 작성. A/B 스크립트는 스테이징에만 두고 실행은 배포 창에서 오케스트레이터가 한다.

## 서버 배포 절차 (v3.203·v3.224 관행)
0. **[동시 작업 경고]** 컨테이너가 07:03:26Z에 재시작됨 — 다른 세션이 `app/routes/admin_items.py`(07:02)·`app/main.py`(07:03)를 .bak 없이 수정·배포. 따라서 ⑴ 백엔드는 스테이징을 만들 때, 오케스트레이터는 **배포 직전에 한 번 더** 라이브 현재본 4파일(character.py·character_generator.py·openai_image.py·business.py)을 내려받아 `_orig`와 md5를 대조한다. 다르면 **새 현재본 위에 패치를 다시 적용**(3-way — 준비본으로 덮어쓰기 금지)하고 diff를 보고한다. ⑵ main.py·admin_items.py는 이번 반영 대상에서 제외(scp 목록에 넣지 않음). ⑶ 이미지 빌드는 서버 디렉터리 전체를 굽기 때문에 다른 세션의 미커밋 변경도 함께 빌드된다 → 빌드 전 `ls -l --time-style=full-iso app/routes app/services app/main.py`로 최근 변경 파일을 기록해 보고. 읽기 전용 사전 점검: `character_jobs`/`generations` processing 0건 확인(있으면 끝날 때까지 대기).
1. 사용자(1줄): **디렉터리 통째 scp 금지**(main.py·admin_items.py 등 다른 세션 변경을 덮을 수 있음). 스테이징에 `deploy/` 평면 폴더(변경 5파일만: character.py·business.py·character_generator.py·openai_image.py·item_taxonomy.py)를 만들고 사용자가 한 줄(`&&` 연결)로 실행: ① ssh로 기존 4파일을 `.bak_pre_v3227`로 복사 ② routes 2파일 scp → `app/routes/` ③ services 3파일 scp → `app/services/`. 서버 파일 쓰기는 오케스트레이터 권한으로 차단되므로 백업 생성도 이 사용자 명령에 포함한다 — 정확한 명령은 DEPLOY.md에 기재. (F 준비가 됐으면 .env 3줄도 사용자가 편집)
2. 오케스트레이터: 서버 .bak_pre_v3227 백업 확인 → `sudo docker build -t maidol-app:latest .` → `sudo docker rm -f maidol-app && sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env -e S3_REGION=ap-northeast-2 maidol-app:latest` → /api/health 200 대기. **로그 볼륨(우선순위 상향 — 재배포 때마다 컨테이너 내부 frontend.log·docker 로그가 사라져 이번 추적도 07:03 이전 로그를 잃음)**: 사용자가 승인하면 이 재생성에 `-v /home/ubuntu/maidol/logs:/srv/app/logs`를 추가한다(호스트 디렉터리를 먼저 만들고 `chown 10001:10001` — 이미지 USER app uid 10001). docker 표준출력 로그 보존(`--log-driver journald` 또는 재생성 전 `docker logs > 파일` 백업)도 함께 결정.
3. 검증(무과금 우선): catalog 5카테고리 건수(상의 1,501…)·gzip 헤더·sub_category 분포 / recoverable 401(무토큰)·200(테스트 계정) / preview original 무토큰 404, 본인 토큰 200, 시트 경로 무토큰 200 유지 / dismiss 타인 job 404 / `[migration]` 인덱스 로그 / (F) `[mailer] ses send ok`.
4. H-2 A/B 스크립트 3회 실행 → 결과 png를 사용자에게 전달 → 모델 결정(사용자).
5. 웹 배포(G) — 서버 검증이 통과한 뒤에.
6. 롤백: `.bak_pre_v3227` 복원 → 재빌드·재생성(DEPLOY.md에 명령 명시). .env 롤백 = MAIL_ENABLED 줄 삭제 후 재생성.

## 40% 룰 판정
**초과(범위 분할로 대응)**. ArtistCodyScreen(1,578줄)은 피커 모달·파생 계산(:671-760, :976-1300 ≈ 420줄)을 교체하고 신규 컴포넌트 4개를 더하므로 파일 변경률이 약 35~45%로 경계선이다 → **"추출 커밋(동작 불변) → 기능 커밋" 2단계를 의무화**해 재작성 리스크를 통제한다. 사이클 전체도 앱 14파일(신규 7)·서버 7파일(신규 2)로 평소 규모를 넘는다 → **웨이브 분할**:
- **W0(최우선·앱 단독·서버 무관)**: H-1 앱 수정 1~4(draft photoIntent·사진 단계 되돌림·setInput 덮어쓰기 금지·생성 직전 가드). 1조가 별도 커밋으로 먼저 끝내고 → 웹 배포(G) 즉시 가능, APK는 1.1.9 후보. 서버 배포를 기다리지 않는다.
- **W1(긴급·서버 배포 1회)**: A·B·C·H-1 서버(original 재사용 Form)·H-3(앱+서버), H-2ⓐ(서버 프롬프트), D 서버 catalog(앱 D가 없어도 무해), F(콘솔 준비가 됐으면 같은 재생성에 합침), 로그 볼륨 마운트(승인 시).
- **W2(같은 사이클 후반, W1 배포 후)**: D·E 앱 UI(2조 — W1과 병렬로 개발하되 배포는 W1 서버 검증 이후), H-2ⓑ 결정 반영.
- 이월(백로그): 이미지 기반 색상 채우기(874건), 색상 옵션 중복 문서를 표시 단계에서 합치기, 장소 사진 preview 보호, 서버 user_text 원문 감사 저장 여부, nginx gzip_types JSON(서버 설정 — 사용자).

## test-designer 항목
1. [unit] pollCharacterJob: 숨김 상태 오류는 세지 않음, 보이게 되면 1.5초 후 즉시 조회, 백오프 5→60초, 보인 상태로 3분 연속 실패하거나 20분 경과 시 포기, 404 즉시 종료, 포기 문구에 '환불' 없음.
2. [unit] activeJob: POST 직후 기록, done→finalize→save 성공 시 비움, failed 수신 시 비움 + 환불 문구, 앱 재시작 후 ArtistLoading resume이 POST 없이 폴링만.
3. [api] recoverable: 7일·RECOVERABLE_SINCE 경계, consumed/dismissed 제외, 30분 넘은 processing lazy 정리(1회만 환불 — refunded 플래그), 타 사용자 비노출, save 후 consumed_at 기록, dismiss 본인 done만.
4. [e2e] 핵심 재현(폰 웹): 생성 요청 → 즉시 다른 탭/화면 끄기 3분 → 복귀 → 결과 화면 도달. 변형: 복귀 전 페이지 새로고침 → 내 아티스트에 "도착" 카드 → 저장 → ArtistResult. 슬롯 가득 참 409 → 확장 다이얼로그.
5. [unit] remoteLogger: 403/401 응답 후 같은 토큰이면 enqueue·flush 0회, 토큰 바뀌면 재개. 동시 _flush 2회 호출 → 네트워크 요청 1회. 5xx 연속 시 백오프 간격·서킷 10분. 임계치 트리거가 백오프 중에는 무동작. [e2e] 만료 토큰으로 로컬 웹 10분 방치 → 서버 `_logs` 요청 ≤1.
6. [unit] wishlistStore.sync: GET /wishlist/ 1회로 wished 채움(목록 id true, 요청 id 중 나머지 false), 60초 캐시, 401 조용히, 쿼리스트링 요청 0건. [e2e] 폰 웹에서 상의 피커 열기 → 하트 상태 정상, Network Error 0.
7. [api] catalog: 카테고리별 전량(상의 1,501·하의 1,421·신발 500·모자 629·가방 623 ±비활성 변동), 필드 축소 셋, gzip, 잔재 color 빈 문자열, sub_category 골든 케이스(티셔츠가 셔츠로 분류되지 않음, 스웨트셔츠→맨투맨, 데이팩→백팩 등 20개), 비허용 category 400.
8. [unit] codyCatalog: 대분류×성별×색상×가격×브랜드 조합 필터, 모아보기 그룹 정렬(상품 수 내림차순), 가격순에서 가격 없는 상품 뒤로, 필터 0건일 때 안내·초기화, 선택된 상품 맨 앞.
9. [e2e] 피커: 모아보기 → 브랜드 → 상품 선택 / 펼쳐보기 → 필터 → 선택. 무신사·지그재그·브랜드샵이 **플랫폼 단계로 따로 보이지 않고** brand로 통합. 카드·프롬프트에 실제 브랜드명(예: 골드퍼센트)이 들어가고 '브랜드샵'은 없음(적용 로그 desc 확인).
10. [회귀] v3.205/207 성별 자동 필터(기본 ON·피커 열 때 ON 복귀·서버 gender 폴백·미설정 칩 안내), v3.206 악세서리 [모자|가방] 서브탭·동시 선택·착용 방식 옵션 프롬프트 합성, 위시리스트 탭(카테고리 필터·판매종료 배지·하트 해제), SAMPLE 폴백(catalog/active 모두 실패·0건), v3.124 선택됨 표시, v3.116 자유 디렉팅, v3.156 returnToCover ← 복귀.
11. [e2e] E 스트립: 상의 선택 → 하의 피커 상단에 상의 썸네일, 스트립에서 상의 칸 탭 → 상의 피커로 전환, 모자·가방 칸 → 악세서리 서브탭. 화면 이탈 후 재진입 → 선택 유지. 새 아티스트 생성 시작 → 비워짐.
12. [e2e] H-1: 사진+Q&A → 실패 유도(오프라인) → 아티스트 만들기 재진입 → "사진 다시 올리기" 버블, 사진 없이 전송 시도 → **요청 0건·⭐ 변화 없음**. [이전 사진 사용] → 서버 로그 `source=photo…`, original_object_name 소유권 타인 403.
13. [api] H-3: `characters/{uid}/original_*`·`characters/temp/{uid}/original_*` 무토큰 404, 타인 토큰 404, 본인 200, admin 200, 시트·아이템·커버 경로 무토큰 200 유지. [e2e] ArtistResult 원본 사진 표시(웹 blob·네이티브 헤더), 실사 옷 입히기 정상(원본 재다운로드 없이 Form 경로).
14. [smoke] H-2: gpt 경로 요청 로그에 인덱스 맵·MIME 실제 포맷, input_fidelity 미포함, A/B 3장 산출. v3.219 디렉터 작업 보존(draft 복원·처음부터·성공 시 청소) 회귀, 가상(cartoon) 경로 프롬프트 불변.
15. [회귀] 튜토리얼 앵커(MapScreen TUTORIAL_STEPS·DIRECTOR_ANCHOR — 회수 카드는 Map에 넣지 않음을 확인), 작업실 미니플레이어 숨김(ArtistCody·ArtistLoading focus), v3.223 재생 큐 무관.
16. [ops] F: 재생성 전후 Redis 세션 유지(로그인 유지), 발급된 재설정 코드가 재생성 뒤에도 유효, SES 실발송·dev 폴백 로그 분기, admin SES 헬스.

## 사용자 결정·실행 사안 (기본안 명시 — 지시가 없으면 기본안으로 진행)
1. **오늘 2건(⭐20) 처리** — 실측 갱신: 2차 6ab4c22b(사진 없이 텍스트 전용, H-1 회귀로 발사)는 **이미 아티스트 "샘플"로 저장됨**(원본 사진 없음 → '사용한 사진' 미노출). 실제로 어디에도 연결되지 않은 것은 **1차 6ab4c16e(사진+텍스트, 얼굴 인증 통과, 결과+원본 temp 보존)** 1건. 기본안 = **"샘플"의 시트를 1차 결과로 교체하고 1차 원본을 original_photo_object_name으로 연결**(`/character/save` character_id=샘플 cid, sheet_object_name=1차 object_name, original_photo_object_name=1차 original_object_name — 오케스트레이터가 사용자 토큰 없이 서버 내부 스크립트로 수행하는 프로덕션 쓰기라 승인 필요, 이름·성별 등 프로필 유지) + **의도하지 않은 텍스트 전용 과금 ⭐10 환불**(2차 point_ref 기준 1회). 대안: (b) 1차를 새 아티스트로 회수(슬롯 필요 — W1 회수 UI 또는 RECOVERABLE_SINCE=06:00Z) + "샘플" 유지, (c) 환불만. 참고: 1차 결과도 H-2 구조 문제(참조 라벨 소실) 영향 아래 생성된 것이라 얼굴 유사도는 약할 수 있음 → 교체 전 미리보기를 사용자에게 보여주고 확정.
2. **H-3 즉시 차단 vs APK 호환**: 기본안 = 즉시 차단(얼굴 원본 = 민감 개인정보). APK 1.1.8의 실사 옷 입히기·원본 사진 표시는 1.1.9 배포 전까지 실패(웹은 동시 배포로 정상).
3. **H-2 모델**: 기본안 = gpt_image_2 유지 + ⓐ 적용, A/B 3장을 보고 사용자가 nb_pro 전환 여부 판정.
4. **F SES 콘솔·DNS·IAM·.env**: 체크리스트 1~6은 사용자 실행. 준비되면 W1 재생성에 합치고, 아니면 이후 .env 편집 + 재생성 1회로 별도 적용.
5. **서버 배포 scp 1줄**(W1) — 사용자 실행.
6. **회수 노출 기간**: 기본안 = 7일(그 이후 temp 결과는 목록에서 사라짐, 파일은 남음). 원하면 조정.
7. **로그 호스트 볼륨 마운트**(우선순위 상향): 기본안 = W1 재생성 때 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 추가(docker run 옵션 변경 — 사용자 승인).
8. **다른 세션의 서버 동시 수정**(07:03Z main.py·admin_items.py, .bak 없음): 이번 빌드에 함께 들어간다 — 해당 세션 소유자 확인이 필요하면 사용자에게 전달.

규칙: 서버 수정은 server_staging_v3227에서만(라이브 원본 pull + _orig 보존 + 배포 직전 md5 재대조), 프로덕션 쓰기(docker build·재생성·포인트 환불·.env)는 사용자 승인/실행 후, 민감 정보는 플레이스홀더(`<SSH_HOST>`, `<ACCOUNT_ID>`, .env 값 미기재), 팝업은 showAlert, 표기 MAIDOL, 코드 수정·커밋은 이 계획이 승인된 뒤 team-dev 루프에서.

## A-보완 — 생성 중 자유 이탈(전역 백그라운드 작업 추적) [서버+앱, 1조+백엔드]

사용자 지시("생성 중에 화면을 나가도 계속 생성하게")로 A를 '결과 회수'에서 격상한다. **이 소절이 위 "확정 스펙 A"와 충돌하면 이 소절이 우선한다**: `characterTaskStore.activeJob` → 전용 `generationJobStore`, ArtistLoading 안의 폴링 → 전역 추적기, 20분/15분 상한 → 서버 stale 기준 30분, 오류 3회 포기 → 서버 status=failed일 때만 실패. H-1(W0)은 별개로 유지하며 이 소절은 W0를 건드리지 않는다.
원칙: 서버는 접수 즉시 백그라운드로 끝까지 생성한다(0단계 A). 따라서 **앱은 화면이 아니라 job을 추적**하면 된다. 로딩 화면은 추적기를 보여주는 창일 뿐이고, 화면을 나가거나 앱을 재시작해도 추적은 이어진다.

**앱 — 신규 `stores/generationJobStore.ts` + `services/generationTracker.ts` (확장 가능한 형태, 이번 범위는 kind='artist'만)**
1. **영속 레코드**(zustand persist, AsyncStorage = 웹 localStorage — 기존 관행): `jobs: Record<jobId, TrackedJob>`, `TrackedJob = { jobId, kind:'artist', mode:'sheet'|'outfit', characterKind:'real'|'virtual', targetCharacterId|null, legacyContract, photoIntent:'photo'|'text', pendingName|Gender|Age|null, startedAt, lastStatus:'processing'|'done'|'failed'|'unknown', lastCheckedAt, result?:{object_name, preview_url, original_object_name?, character_id?, art_style?}, error?, ownerUserId }`. 텍스트만 저장(파일 URI 제외). 로그아웃하면 ownerUserId가 다른 레코드는 숨기고, 다시 로그인하면 복원한다. 모든 레코드는 30일이 지나면 정리.
   - 기록 시점: `POST /character/generate-sheet(-cartoon)-async`가 202/200으로 job_id를 돌려준 **직후 즉시**(ArtistLoading의 해당 지점 :200-210·:396-402). 화면 전환보다 먼저 한다.
2. **전역 추적기**(화면 수명과 분리): App 루트에서 1회 `startGenerationTracker()` 호출. `lastStatus==='processing'`인 레코드를 폴링(5초 간격, 여러 job이면 순차 조회). 오류는 **실패로 치지 않는다**: 네트워크 오류·5xx·타임아웃은 lastStatus 유지 + 백오프(5→10→20→40→60초). 404는 'unknown'(다른 계정 등, 조용히 정리).
   - 재개 트리거: 네이티브 `AppState` → active, 웹 `visibilitychange` → visible, `online` 이벤트, 로그인 완료. 트리거가 오면 대기 중인 타이머를 취소하고 1.5초 뒤 즉시 조회(복귀 직후 네트워크가 살아날 시간).
   - 숨김 상태(웹 hidden / 네이티브 background)에서는 폴링을 멈춘다(어차피 JS가 정지되고, 배터리 낭비 방지).
   - **실패 판정은 서버 `status=failed`일 때만.** 이때 문구에 "사용된 별은 자동으로 환불돼요"(서버가 `refund_character_job_points`로 환불 — character.py:1146-1175, 러너 실패 경로 :1265-1285). 오래 걸리면 "아직 만드는 중이에요 — 나가 있어도 계속 만들어져요"를 유지한다. **상한 정합**: 서버는 30분 넘은 processing을 stale로 보고 실패+환불 처리(main.py:535-567 기동 시 + 이번에 추가하는 recoverable lazy 정리). 그래서 앱은 **startedAt+30분**이 지나면 recoverable을 1회 호출(서버가 lazy로 failed+환불 확정)하고, 결과 status를 그대로 따른다. 기존 15분 상한(pollCharacterJob 180틱)은 폐기.
3. **ArtistLoadingScreen = 추적 뷰어로 전환**: 신규 생성 경로는 POST까지만 담당하고 이후 폴링을 직접 하지 않는다. 대신 `useTrackedJob(jobId)`를 구독해 단계 애니메이션을 표시한다. 화면에 **[나가서 다른 작업 하기]** 버튼(작업실로 popTo('Map'))과 "나가도 계속 만들어져요. 완성되면 작업실에서 알려드릴게요" 안내를 둔다. 라우트 파라미터 `{ jobId }`로 재진입 가능(resume — POST 없음). 기존 `pollCharacterJob`(:57-82)은 삭제.
4. **완성 처리(단일 경로)**: `finalizeArtistJob(job)`을 추출(현 :221-330 sheet / :404-440 outfit 저장 로직을 이관). 순서:
   - (sheet) 사진 파일이 메모리에 있으면 기존대로 upload-original-photo. 없으면(이탈·재시작) **job.result.original_object_name을 save의 original_photo_object_name으로 연결** — 사진을 사용한 job이면 '만들 때 사용한 사진'이 항상 채워진다(H-1과 짝).
   - save → consumed 표시(서버) → store 레코드 완료 처리 → `navigation.navigate('ArtistResult', { characterId, justCreated:true })`.
   - 호출 시점: ⑴ 추적 뷰어가 열려 있는 상태에서 done을 받으면 즉시 ⑵ 뷰어 밖에서 done을 받으면 **자동 이동하지 않는다**(사용자가 다른 작업 중일 수 있음) → 레코드를 'done-unsaved'로 두고 작업실 배지·앱 내 알림(아래 5)으로 안내 → 사용자가 탭하면 finalize → ArtistResult. **저장은 반드시 사용자가 결과를 보는 흐름에서 한 번만**(중복 save 방지 — 레코드에 `finalizing` 잠금).
   - 슬롯 초과 409는 기존 확장 다이얼로그를 재사용. 저장 실패 시 레코드는 done-unsaved를 유지(재시도 가능).
5. **작업실 표시**(MapScreen): 아티스트 디렉터 위치에 상태 말풍선 — processing이면 "만드는 중… (n분)"(스피너 점), done-unsaved면 "완성! 눌러서 확인". 렌더 위치는 기존 isNext 말풍선 슬롯(MapScreen.tsx:749-767)과 같다. **추적 중에는 아티스트의 isNext 말풍선·펄스를 대신 표시**(두 말풍선이 겹치지 않게). 휴식 티켓(:778-785)과는 위치가 달라 병존 가능. 튜토리얼 앵커 `DIRECTOR_ANCHOR_BY_TYPE`(:75-90)는 디렉터 좌표 박스 기준이라 말풍선 추가가 앵커 측정에 영향 없음 — 튜토리얼이 진행 중(TutorialOverlay 표시)이면 상태 말풍선은 숨김.
   - 아티스트 디렉터 탭(`proceedDirectorPress`): 추적 중인 job이 있으면 기존 진입 대신 **processing → 추적 뷰어(ArtistLoading {jobId}), done-unsaved → finalize → ArtistResult**. v3.219 디렉터 작업 보존(ArtistInput draft 이어가기)은 추적 job이 없을 때의 기존 경로 그대로.
   - 앱 내 알림: 뷰어 밖에서 done을 수신하면 showAlert 1회("아티스트가 완성됐어요" [지금 보기]/[나중에]). 단 작곡·영상 등 생성 화면에 있을 때는 알림을 띄우지 않고 배지만 표시(방해 금지 — 작업실(Map)·마이페이지 계열 화면에서만 팝업). 문구에 "저작권" 표현 없음.
6. **중복 생성 차단(앱)**: 추적 중인 artist job(processing 또는 done-unsaved)이 있으면 ArtistInput 진입 시와 ArtistCody [만들기/입히기](handleApply :404 부근, 과금 전 게이트 순서: 피로 게이트 앞) 모두에서 showAlert "이미 아티스트를 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요" [진행 상황 보기]. done-unsaved면 "완성된 아티스트를 먼저 확인해주세요"로 안내.
7. **복구 경로(로컬 기록이 사라진 경우 — 기기 변경·저장소 삭제·다른 브라우저)**: 로그인·포그라운드 복귀·MyArtists focus 때 `GET /character/jobs/recoverable`(30초 스로틀)을 호출하고, 로컬에 없는 job은 레코드로 편입(photoIntent는 original_object_name 존재 여부로 추정). 이후 흐름은 1~6과 같다. 서버가 404면(구서버) 조용히 건너뛴다.
8. **플랫폼 한계(REPORT·사용자 안내에 명시)**: 모바일 웹은 화면이 꺼지거나 탭이 백그라운드로 가면 브라우저가 JS를 멈춘다 → **완성 순간의 알림은 불가하고, 돌아왔을 때 수령하는 것이 한계**. 이번 수정으로 수령은 확실해진다(작업실 배지 + 알림 1회). 네이티브도 백그라운드에서는 JS 폴링이 멈추므로 같은 방식. **네이티브 로컬/푸시 알림은 이번 범위 밖**(expo-notifications 미설치 — 네이티브 모듈 추가·APK 재빌드와, 백그라운드 완성 감지를 위해 서버 푸시(FCM) 발송이 필요 → 백로그 "생성 완료 푸시").
9. **확장 지점(기록만)**: `TrackedJob.kind`에 'cover'·'video'·'inst'를 추가할 수 있게 설계한다 — kind별 `{ statusUrl(jobId), parseStatus(res), finalize(job) }` 어댑터 레지스트리(`generationTracker.registerKind`). 이번에는 artist 어댑터만 구현. 기존 v3.93 GenerationHistory(Map :810-822 '생성 이력')·Inst 폴링(v3.222)은 건드리지 않고, 차기에 이 어댑터로 이관하는 후보로 둔다.

**서버(character.py — main.py 무변경)**
1. `GET /api/character/jobs/recoverable`: 내 job 중 `consumed_at`·`dismissed_at` 없음 + `created_at >= max(now-7d, RECOVERABLE_SINCE)`. done → {job_id, mode, status, object_name, preview_url, original_object_name, character_id, art_style(_key), created_at, completed_at}, processing → {job_id, mode, status, created_at}, 최근 24시간의 failed → {job_id, status, error, refunded}(앱이 실패+환불 안내를 확정하는 데 사용). **조회할 때 30분 넘은 processing은 즉시 failed+환불 처리**(stale 복구 로직과 같은 claim + `refund_character_job_points` 재사용 — 재기동을 기다리지 않음). 최신순 최대 10건. 노출 기간 = 7일(자율 확정: 사용자 재방문 주기를 고려하되 temp 결과가 오래 남지 않게), `RECOVERABLE_SINCE` 기본 = 배포 시각(결정 1에 따라 조정).
2. `/character/save` 성공 끝에 best-effort로 `character_jobs.update_one({user_id, object_name: sheet_object_name}, {$set:{consumed_at}})`.
3. `POST /api/character/job/{job_id}/dismiss`: 본인 done job만 `dismissed_at` 설정, 환불 없음.
4. **중복 생성 서버 차단**: generate-sheet-async·generate-sheet-cartoon-async(및 sync 2종 — 같은 헬퍼)에서 피로 게이트 뒤, 슬롯·⭐ 차감 **전**에 `character_jobs.find_one({user_id, status:'processing', created_at >= now-30m})`를 조회해 있으면 **409 `{"error":"generation_in_progress","job_id":…}`**(무과금). 30분 넘은 것은 stale로 보고 막지 않는다(lazy 정리가 처리). 앱은 409 generation_in_progress를 받으면 그 job_id를 추적기에 편입하고 뷰어를 연다(다른 기기에서 시작한 생성도 이어볼 수 있음). 참고: 현재는 동시 신규 생성 2건이 모두 슬롯 검사를 통과할 수 있음(슬롯은 save 때 소모) — 이 409가 그 틈도 막는다. refine(sync, 미리보기용)은 대상 아님.
5. 인덱스 `character_jobs (user_id, status, created_at)`: character.py에서 프로세스당 1회 lazy create_index(main.py 무변경).
6. 로그 `[CharJob] recoverable user=… n=… stale_fixed=…`, `[CharJob] dup-blocked user=… job=…`, `[CharJob] consumed job=…`, `[CharJob] dismissed job=…`.

**보완 1 — 생성 중(processing)에도 보이게**
- `MyArtistsScreen` 상단·`ArtistInputScreen` welcome에 추적 카드 공통 컴포넌트 `components/GenerationJobCard.tsx`: processing = "아티스트를 만드는 중이에요 · 경과 m분 — 나가 있어도 계속 만들어져요"(1분마다 경과 갱신) → 탭하면 추적 뷰어(ArtistLoading {jobId}). done-unsaved = "완성된 아티스트가 도착했어요" + 썸네일 → [확인하기](finalize → ArtistResult) / [버리기](dismiss, showAlert 확인). failed(최근 24시간·미확인) = "만들지 못했어요 — 사용된 별은 환불됐어요" [확인](레코드 정리).
- **Map 표시 확정 = 아티스트 디렉터 말풍선 슬롯**(위 5항). 근거: 튜토리얼 앵커는 디렉터 좌표로 계산한 140×140 박스(MapScreen.tsx:75-83, :279 measure)이고 말풍선 요소가 아니다. 말풍선은 기존 isNext 말풍선(:749-767)과 같은 자리에 대체 렌더링하므로 앵커 좌표·측정에 영향이 없다. TutorialOverlay가 떠 있는 동안은 숨긴다. 헤더 우측 표시는 채택하지 않음: Map은 탭 헤더를 공유하고 우측 영역에는 ⭐·알림 등 전역 요소가 있어 충돌 여지가 더 크며, 하단 '생성 이력' 버튼(:810-822)은 `map-history` 앵커라 손대지 않는다.

**보완 2 — 중복 생성 차단(과금 전)**
- 앱: 추적 중(processing·done-unsaved)이면 ⑴ ArtistInput 진입 시 welcome에서 새로 만들기 버튼 대신 추적 카드만, ⑵ ArtistCody handleApply 첫 줄(피로 게이트·잔액 체크 앞, :404-440), ⑶ ArtistLoading POST 직전(최종 방어)에서 showAlert "이미 아티스트를 만드는 중이에요" [진행 상황 보기]/[닫기]. done-unsaved면 "완성된 아티스트를 먼저 확인해주세요" [확인하기]. 옷 입히기(outfit)도 같은 규칙(동일 사용자 artist job 1개).
- 서버: 위 서버 4항 — `409 {"error":"generation_in_progress","job_id"}`, 무과금. **영구 잠김 방지**: 판정 직전에 같은 사용자의 30분 넘은 processing을 lazy 정리(recoverable과 같은 헬퍼 `_sweep_stale_jobs(user_id)` — failed+1회 환불)한 뒤 남은 processing만 본다. 서버 재기동으로 러너가 죽은 job은 최대 30분 뒤 자동으로 풀린다. 앱은 409를 받으면 job_id를 추적기에 편입하고 뷰어로 이동한다.
- 30분 동안 막히는 것이 과한지는 관측 항목으로 둔다: 정상 생성은 3~6분(0단계 A)이라 30분은 stale 기준과 맞춘 값이다.

**보완 3 — 부팅·새로고침·재시작 후 재개**
- persist 하이드레이션이 끝나고(`generationJobStore.persist.onFinishHydration` — v3.223 playerStore 대기 관행) 로그인 세션이 복원된 뒤(authStore restoreSession 완료), `startGenerationTracker()`가 레코드를 스캔한다. processing은 즉시 1회 조회 후 폴링 재개. 조회 결과 done이면 done-unsaved로 바꾸고 카드·Map 말풍선·알림 1회. failed면 환불 안내 카드. 이어서 `GET /character/jobs/recoverable`로 로컬에 없는 job(다른 기기·저장소 삭제)을 편입한다.
- 웹 새로고침 중 ArtistLoading URL로 바로 들어오는 경로는 없다(linking config는 FeedDetail만 — App.tsx:575-584). 따라서 재개는 전역 추적기 + 카드/말풍선으로만 한다.
- 로그 `[GenTracker] boot resume {n, processing, done}`, `[GenTracker] poll {jobId, status, backoff}`, `[GenTracker] visible → refresh`.

**변경 매트릭스 추가분**(1조): stores/generationJobStore.ts(신규)·services/generationTracker.ts(신규)·components/GenerationJobCard.tsx(신규)·App.tsx(추적기 기동 1줄 + 하이드레이션 대기)·screens/MapScreen.tsx(아티스트 말풍선 슬롯·디렉터 탭 분기 — 1조 전유, 튜토리얼 로직은 건드리지 않음)·ArtistLoadingScreen(추적 뷰어 전환·finalize 추출)·MyArtists·ArtistInput(카드·진입 차단). ArtistCody handleApply 첫 줄의 중복 가드는 2조가 반영(1조가 `useHasActiveArtistJob()` 훅을 제공). 서버(백엔드): character.py의 recoverable·dismiss·consumed·409·`_sweep_stale_jobs`·lazy 인덱스. **W0(H-1) 커밋·파일 범위와 섞지 않는다** — A-보완은 W0 머지 이후 1조 후속 커밋으로.

**test-designer 추가 항목(A-보완)**
17. [e2e] 이탈 자유: 생성 접수 → [나가서 다른 작업 하기] → 작업실 아티스트 말풍선 "만드는 중… n분" → 작곡 화면으로 이동(팝업 없음) → 작업실 복귀 시 "완성! 눌러서 확인" → 탭 → ArtistResult(저장 1회, original 사진 노출 — 사진 job).
18. [e2e] 새로고침·재시작 재개: 웹 생성 중 새로고침(또는 네이티브 앱 강제 종료 후 재실행) → 부팅 로그 `[GenTracker] boot resume` → MyArtists 상단 "만드는 중 · 경과 m분" 카드 → 완성 후 "도착" 카드 → 확인. 백그라운드 3분 뒤 복귀 시 1.5초 이내 재조회, Network Error가 나도 실패 표시 없음.
19. [e2e/api] 중복 차단: 추적 중 ArtistCody [만들기] → "이미 만드는 중이에요"(요청 0건·⭐ 불변). 다른 기기/브라우저에서 같은 계정으로 generate 시도 → 409 generation_in_progress(무과금) → 앱이 그 job을 편입해 뷰어 표시. stale: processing job의 created_at을 31분 전으로 둔 테스트 데이터(스테이징 유닛) → 새 요청 시 lazy 정리(failed+환불 1회) 후 정상 접수.
20. [unit] 실패 판정: 추적기 오류 5종(Network Error·502·504·timeout·401 재로그인 필요)에서 lastStatus 유지·백오프만, 서버 failed 수신 때만 실패+환불 문구, startedAt+30분 경과 시 recoverable 1회 호출 후 서버 status 반영. 튜토리얼 표시 중 말풍선 숨김, isNext 말풍선과 동시 렌더 없음.

### v3.227 사용자 결정 (2026-09-24, 오케스트레이터 기록 — 본문과 충돌 시 이 소절이 우선)
1. **범위**: 전체 진행(W0 → W1 → W2). 40% 룰 초과는 사용자 승인으로 해소.
2. **오늘 유실 2건(job 6ab4c16e·6ab4c22b, ⭐20)**: **그대로 둠** — '샘플' 교체·환불 등 프로덕션 데이터 쓰기 없음. 단 A 배포 후 회수 목록(recoverable)에 1차 job(미소비 done)이 '도착' 카드로 자연 노출되는 것은 기능 동작으로 허용(사용자가 저장/닫기 선택).
3. **H-3 원본 사진 보호**: **즉시 차단**(서버 배포 시점에 적용). APK 1.1.8의 실사 옷 갈아입기·'사용한 사진' 표시는 1.1.9까지 일시 제한 — REPORT·사용자 안내에 명시, 웹은 동시 대응.
4. **회수 보관 기간**: **기간 제한 없음** — recoverable 목록은 저장(consume) 또는 사용자 닫기(dismiss) 전까지 계속 노출. 오래된 job 대량 노출 방지를 위한 목록 상한(예: 최근 N건)은 자율 확정 가능.
5. W0(H-1) 구현 완료(1조, tsc 0) — photoIntent 표기는 `'photo' | 'text' | null`로 확정.

---

# v3.228 — 작사·작곡(연주곡 포함)·이미지(커버·다듬기)·영상 디렉터에 아티스트 디렉터 수준의 "자동 도착 알림 · 중복 생성 차단 · 서버 재시작으로 멈춘 작업 환불 정리" 확장

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD ea39dac = 태그 `checkpoint-pre-v3228`, 앱 1.1.9). 서버 = `<SSH_HOST>`(maidol-ec2) `/home/ubuntu/maidol/backend_9004/`(git 아님, 이미지 베이크, 컨테이너 09:24:51Z 기동). **서버 실측은 전부 읽기 전용**: 라이브 파일 scp 다운로드, 컨테이너 안 python stdin 실행(쓰기 0, 서버에 파일 생성 0). 출처: [P]=planner 실측, [O]=오케스트레이터 전달(재확인함).
사용자 요청 원문: "그럼 만약에 작업이 이상해질껄 대비해서 지금 상태를 체크해놓고. 작사, 작곡, 이미지, 영상 디렉터 모두 아티스트 디렉터 처럼 자동도착알림, 중복생성차단, 서버 재시작으로 멈춘 환불정리 반영해줄래?"
유지 원칙(ea39dac 사용자 결정): 진행 화면 안내는 **"작업이 끝날 때까지 이 화면을 벗어나지 마세요"** 그대로. 자동 회수는 실수 이탈 대비 안전장치이며, 버튼·문구로 이탈을 권장하지 않는다. "만드는 중" 표시와 도착 알림은 허용.

## 체크포인트(롤백 기준 — 생성 완료, [P] 재확인)
- 앱: 태그 `checkpoint-pre-v3228` → ea39dac(`git rev-parse checkpoint-pre-v3228^{commit}` = ea39dac).
- 서버 이미지: `maidol-app:checkpoint-pre-v3228` = `latest` = sha256:3f32481b5e68…(09:24:47Z 빌드).
- 서버 소스: `/home/ubuntu/maidol/backups/backend_9004_app_pre_v3228_20260924T094437Z.tgz`(5.8MB, `app/` 전체 — generate.py·upload.py·tracks.py·main.py 포함 확인).
- 현재 서버 파일 md5([P] 09:4xZ): generate.py `8786687e43753f6be8bf8f3988072052` · upload.py `0a3e5927f8457c94cc8bb01466ab0c4f`(v3.227 반영본) · tracks.py `811381c087da9db43dc592fc7ac174e5` · main.py `78ab70741f8dc476e879c330608e0bc7`(mtime 09:24:41Z, 내용은 07:22본과 동일) · services/inst_service.py `d6c95351a7b264da5b82fc331d675f93` · services/points_service.py `3ad6a322b0b316b92145bc0b0afd9b93`.
- 다른 세션 변경 파일(오늘 09:24Z): main.py·admin_items.py·admin_stats.py·analytics.py. **이번 사이클 반영 대상과 겹치지 않음. main.py는 건드리지 않는다.**

## 0단계 findings / Plan verification (파일:라인)

### 0-1. 디렉터별 현황표 (현재 코드)
| 디렉터 | 서버 엔드포인트 | 과금 시점 | 환불 훅 | 작업 상태 저장 | 결과 저장 위치 | 앱 재진입 경로 |
|---|---|---|---|---|---|---|
| 작사 | `POST /api/generate/lyrics/`(동기) generate.py:536-612 | 피로 429(:553) 뒤 `spend_points("lyrics",5,uuid)` :560 | 같은 요청의 except만 :606-608 | **없음** | `save=true`면 `lyrics_assets` 자동 저장(:593-603). 응답 `lyrics_id` | 없음. LyricsLoading은 마운트마다 새 POST(LyricsLoadingScreen.tsx:74-167) |
| 작곡 | `POST /api/generate/`(201, BackgroundTasks) generate.py:615-779 · `POST /{id}/start/` :782-879 | 피로(:646) 뒤 spend :650 → doc insert :734 → 백그라운드 :751 | 러너 except에서 원자 claim 환불 `refund_generation_points` :273-306, :397-404 | `generations`(status pending→processing→completed/failed, point_ref·refunded) | generations doc(→ 발매 시 tracks `upload-from-generation`) | MusicLoading `resumeGenerationId`(MusicLoadingScreen.tsx:298-306) · GenerationHistory 진행중 탭(GenerationHistoryScreen.tsx:143-154) |
| 연주곡(Inst.) | `POST /tracks/{id}/instrumental`(202) tracks.py:3045-3207 | 곡별 active claim(upsert) :3149-3171 뒤 spend :3182 | 러너 except `refund_instrumental_points`(inst_service.py:150-185, :485-501) | `inst_jobs`(active, status, refunded) | 새 트랙 자동 발매 | InstLoading `resume`(MyMusicScreen.tsx:487-502 409 분기) |
| 이미지(커버) | `POST /upload/generate-cover`(동기 150~180초) upload.py:344-679 | 피로(:392-396) 뒤 spend :403 | 같은 요청 except :674-676 | **없음**(성공 후에만 `cover_sessions` insert :642) | cover_sessions(보관함) | v3.202 I-lite: ERR_NETWORK 시 `GET /upload/cover-sessions` 시각 휴리스틱 폴링(CoverGenerationScreen.tsx:337-379) |
| 이미지(다듬기) | `POST /upload/refine-cover`(동기 132~141초) upload.py:942-1132 | 세션 로드(:970) → spend :1027 | refine 예외만 :1044-1047. **MinIO·Mongo 저장 실패(:1070-1117)는 환불 없음** | **없음** | cover_sessions.cover_refine_history | v3.204 `GET /upload/cover-history/{id}` 버전 비교 폴링(:1244-1285) |
| 영상 | `POST /tracks/{id}/share-video`(동기) tracks.py:2424-2593 | 캐시 미스(:2542) → 피로(:2551) → spend :2563 | 같은 요청 except :2576-2583 | **없음**(MinIO 객체 존재 = 캐시) | MinIO `share/v8/…` | 없음. VideoDraft는 'making' 제외(VideoDirectorScreen.tsx:90-96) |

공통 인프라 실측:
- uvicorn **단일 워커**(Dockerfile CMD, `--workers` 없음 — 주석으로 의도 명시) — [P].
- 재시작 복구는 **character_jobs만** 존재(main.py:536-567, 30분 기준). generations·inst_jobs·동기 요청은 기동 복구 없음(MV는 paused 전환만 :523-534) — [P].
- nginx `proxy_read_timeout 320s`(sites-enabled/maidol-api:13), api.maidol.ai.kr은 Cloudflare 미경유(직결 A 3.37.146.1) — [P].
- 앱 axios 기본 timeout 600초(services/api.ts:18), 영상만 300초(VideoDirectorScreen.tsx:543). 자동 재시도 인터셉터 없음 — [P].
- `spend_points`는 **비멱등**: 잔액 차감(:202-206)을 먼저 하고 이벤트 기록은 best-effort. 이벤트 유니크 인덱스(user_id, action, track_id=ref, day)(points_service.py:53-57)에 걸리면 DuplicateKey를 경고로 삼키고 **차감은 유지**(:214-225) — [P].

실측 수치(컨테이너 읽기 전용 집계, 최근 30일) — [P]:
- 작곡 소요(created→completed): 일반 n=7 p50 66s, 최대 76s / 보이스클론 n=2 114~135s. suno 폴링 상한은 일반 5분, 보이스클론 20분(suno_generator.py:297-299).
- 연주곡: n=4, p50 111s, 최대 128s.
- 작사(spend→자산 저장): n=10, p50 18s, 최대 35s.
- 커버(spend→세션 생성): n=13, p50 153s, p99 177s, 최대 178s.
- 영상: 이력 문서가 없어 측정 불가. ffmpeg 상한 600초(share_video.py:58)이고, 주석에 "300초 초과 실사고 2건(v3.215)".
- 현재 멈춘 과금 작업: generations pending/processing 중 point_ref 보유 **0건**(pending 8건은 전부 point_ref=None 초안 — **정리 대상이 아님**), inst_jobs active **0건**, character_jobs processing 0건.
- 인덱스: generations·cover_sessions·inst_jobs 모두 `_id_`만 있음.

### 0-2. 영상 중복 과금 실측 결과 (요청 항목) — **확정: 중복 차감 경로가 있음 + 이미 발생한 정황 1건**
1. **코드 경로(확정)**
   - 진행 중 요청을 막는 장치가 없다. 캐시 판정은 MinIO 완성본 존재 여부뿐이다(tracks.py:2542). 완성본은 인코딩이 끝난 뒤에야 올라간다(share_video.py:1128-1145).
   - 그래서 인코딩 중에 같은 조합을 다시 요청하면 캐시 미스가 난다. 결과는 **재차감 + ffmpeg 이중 실행**(heavy 슬롯 2개를 서로 뺏음 → 둘 다 느려짐)이다.
   - 두 번째 인코딩은 업로드 직전 재확인에서 `concurrent cache detected — skip upload`로 업로드만 건너뛴다. **환불은 하지 않는다**(share_video.py:1128-1135).
2. **이벤트 기록 유실(확정)**
   - 과금 ref는 조합별로 결정적이다: `share_video:{track}:{fmt}[:스타일]`(tracks.py:2559-2562).
   - 같은 날(KST) 두 번째 차감은 이벤트 insert가 DuplicateKey로 실패한다. 경고로 삼켜지므로 **포인트 내역·관리자 통계에 나타나지 않는다**(points_service.py:214-225).
3. **재요청을 부르는 조건(확정)**
   - 앱 요청 timeout은 300초(VideoDirectorScreen.tsx:543)로 서버 ffmpeg 상한 600초·nginx 320초보다 짧다.
   - 300초를 넘기면 앱이 "영상 생성에 실패했어요. 잠시 후 다시 시도해주세요"를 띄우고 'format' 단계로 되돌아간다(:569-574). 서버는 계속 인코딩 중이다.
   - 사용자가 같은 조합을 다시 고르면 재차감된다.
   - 웹에서는 자막 위치 카드 더블클릭(handlePickSubPos :477-484 → proceedGeneration)으로 요청 2건이 나갈 수 있다. 비용 확인이 없는(videoCost=null) 경로에는 in-flight 가드가 없다.
   - 화면을 나갔다가 다시 들어와도 'making' draft가 복원되지 않아 재요청할 수 있다.
4. **데이터 정황([P] 잔액 대사)**
   - 39개 계정 중 36개는 `잔액 = Σpoint_events`가 정확히 맞는다. 나머지 3개가 어긋난다.
   - **`2f85f76c`(오늘 06:30 가입한 베타 신규 사용자) −⭐5**
     - 그날 결정적 ref로 차감된 건은 share_video 한 건뿐이다(07:00:28Z). 나머지 차감은 전부 uuid ref라 중복될 수 없다.
     - MinIO 완성본은 07:02:47Z에 생성됐다. 07:03:26Z 재시작 전에 완료된 것이다.
     - 따라서 **07:00:28~07:02:47 사이에 같은 조합 요청이 한 번 더 들어와 기록 없이 ⭐5가 차감됐다고 보는 것이 유일하게 일관된 설명**이다. 대안(upload +5 적립 이벤트는 들어갔는데 잔액 반영만 실패)은 가능성이 낮다.
     - 도커 로그는 07:03 재생성 때 사라져 직접 확정할 수 없다.
   - `c19acda4`(대표 계정 추정) −⭐5: 같은 날 share_video 재요청이 여러 번 있어 후보가 여러 개다.
   - `18bd8131` −1: 영상과 무관(성격 다름).
5. 결론: **중복 과금 가능성은 "미검증"에서 "구조 확정 + 실발생 정황 1건"으로 올린다**. 이번 사이클의 과금 사고 FAIL 게이트 1순위다.

### 0-3. 기타 과금·유실 실측 — [P]
- **커버 재진입 이중 과금 경로(신규 발견)**
  - CoverGeneration은 `coverTrackId && coverStyle != null`이면 마운트할 때 자동으로 `doGenerate`를 호출한다(CoverGenerationScreen.tsx:134-135, :330-334).
  - coverStyle은 성공·실패가 확정될 때만 해제된다. 그래서 **생성 중에 화면을 나갔다가(뒤로가기·작업실) 이미지 디렉터로 다시 들어오면 새로 요청하고 ⭐5를 다시 낸다**. 첫 요청은 서버에서 계속 진행 중이다.
  - musicStore는 persist하지 않으므로 같은 세션 안의 이동에서만 생긴다.
- **다듬기(refine) 버전 경합 이중 차감**(9/22 실사고): 같은 세션에서 200초 이내 연속 차감 1건. 버전 번호를 락 없이 산정한다(upload.py:1052-1064).
- **작곡 멈춤**
  - 서버가 재시작하면 generations가 processing에 영구히 남고 환불도 없다.
  - MusicLoading 폴링에는 **상한이 없고**, 404·403·400이 아니면 계속 돈다(MusicLoadingScreen.tsx:121-134). 사용자는 무한 대기 화면을 보게 된다.
- **연주곡 멈춤**
  - 재시작 시 inst_jobs `active:true`가 영구히 남는다. 결과는 **그 곡의 Inst. 요청이 영원히 409**("이미 진행 중")이고 환불도 없다.
  - 앱은 10분 뒤 'timeout' 문구만 보여준다(InstLoadingScreen.tsx:124-130).
- **작사·커버 동기 요청 중 재시작**: 차감만 되고 환불되지 않는다(except 훅이 돌지 않음).
  - 30일 기준 "차감 후 자산·세션도 없고 환불도 없는" 고아 건은 작사 4건(08-31 3건, 09-07 1건), 커버 1건(09-01)이다.
  - 전부 c19acda4(대표 계정 추정)이고, 원인(재시작·자산 저장 실패·배포 과도기)은 확정할 수 없다. **보정은 하지 않는다**(사용자 결정 3의 기본안).
- **v3.227 잔재 문구(정책 위반)**: "나가 있어도 계속 만들어져요"가 2곳 남아 있다.
  - components/GenerationJobCard.tsx:43
  - services/generationTracker.ts:594(아티스트 중복 가드 팝업)
  - ea39dac 결정(이탈 권장 금지)에 어긋나므로 이번에 정리한다.
- **generationTracker 확장점 상태**: `registerKind`는 **주석으로만 예고**돼 있고 구현은 없다(generationTracker.ts 전체가 artist 전용이고 `listUserArtistJobs`가 kind='artist'로 고정). stores/generationJobStore.ts:15 `TrackedJobKind = 'artist'`.
- 작업실 말풍선 탭 경로
  - `handleDirectorPress`는 artist를 **제외한** 디렉터에 휴식(피로) 게이트를 먼저 건다(MapScreen.tsx:591-618).
  - 생성이 끝나면 곧바로 사다리 쿨다운이 시작된다. 그래서 **"완성! 눌러서 확인" 말풍선을 누르면 휴식 다이얼로그가 결과 확인을 가로막는다**. 도착 말풍선은 피로 게이트를 우회해야 한다.

### 0-4. 요구 3종 충족도·갭
| 디렉터 | 자동 도착 알림 | 중복 생성 차단 | 재시작으로 멈춘 작업 환불 정리 |
|---|---|---|---|
| 아티스트(v3.227 모범) | O(전역 추적·말풍선·카드·알림 1회) | O(앱 가드 + 서버 409, 사용자별 락) | O(30분 lazy sweep + 기동 복구) |
| 작사 | X(응답을 잃으면 결과를 알 수 없음. 자산은 저장돼도 모름) | X(재진입·재생성 시 재차감) | X(동기 요청이 죽으면 환불 없음) |
| 작곡 | △(GenerationHistory에서 수동 확인만) | X(사용자별 제한 없음. 웹 새로고침 뒤 재작곡 = 재차감) | X(processing 영구화 + 무환불 + 앱 무한 대기) |
| 연주곡 | △(MyMusic focus 재확인 :400-420) | O(곡별 active claim) | X(active 영구화 → 곡 영구 잠김 + 무환불) |
| 커버 | △(I-lite 시각 휴리스틱, 3분 한정) | X(재진입 자동 재요청 = 이중 과금) | X |
| 다듬기 | △(버전 비교 휴리스틱) | △(화면 ref 가드뿐. 서버는 경합) | X(+ 저장 실패 무환불) |
| 영상 | X | X(0-2 확정) | X |

## 설계 결정 (자율 확정 — 근거 기록)

### D1. 동기 요청형(작사·커버·다듬기·영상): **동기 유지 + 서버 요청 원장(in-flight ledger)**. job화(202+폴링)는 채택하지 않는다.
- **비용·리스크 비교**
  - job화하려면 4개 엔드포인트의 응답 계약을 바꾸거나 새 async 엔드포인트를 병설해야 한다. 앱 4개 흐름의 요청·결과 수신도 다시 짜야 한다(CoverGeneration 2,038줄의 모드 전환, VideoDirector 대화 단계 포함).
  - 게다가 APK 1.1.9는 구계약을 쓴다. 그러니 병설이 필수이고 서버 코드가 이중화된다.
  - 반면 동기 처리는 클라이언트가 끊겨도 서버에서 끝까지 수행된다. Starlette는 연결이 끊겨도 핸들러를 취소하지 않고, to_thread도 계속 돈다. 0-2의 07:02:47 완성과 I-lite 실측이 근거다. 따라서 **원장만 있으면 job화한 것과 같은 회수가 가능**하다.
- **방식**
  - 앱이 요청마다 `X-Gen-Request-Id`(32hex)를 발급해 헤더로 보낸다. 요청을 **보내기 전에** 로컬 추적 레코드를 만든다.
  - 서버는 과금 전에 원장 문서를 만들고(processing, `boot_id`, 과금 정보), 성공하면 done+result, 실패하면 failed+환불로 확정한다.
  - 응답을 잃으면(ERR_NETWORK·timeout·새로고침·앱 종료) 앱은 `GET /api/generate/jobs/req/{request_id}`로 **정확히** 회수한다. 시각 휴리스틱(I-lite·cover-history)은 구서버 폴백으로만 남긴다.
- **멱등**: 같은 request_id가 다시 오면 진행 중일 때는 409(같은 job), 완료 후에는 200 재생(`replayed:true`, 무과금)으로 답한다. 클라이언트 재시도가 구조적으로 재차감을 못 한다.

### D2. 서버 공통 모듈 **`app/services/gen_jobs.py`(신규)** + 라우트별 얇은 연결 — 디렉터별 개별 구현은 채택하지 않는다.
- 근거: 판정(살아 있음·죽음), 사용자별 락, 원자 환불, 소비·확인 표시, 회수 목록 직렬화가 6개 kind에서 같다. character.py v3.227(:1219-1340)에 같은 로직이 이미 한 벌 있다. 다섯 번 복제하면 불일치가 생긴다.
- **main.py 비접촉**
  - 새 라우터 파일을 만들면 `include_router`(main.py) 수정이 필요하다. 그래서 회수·조회·확인 API는 **기존 `generate.py` 라우터(`/api/generate`)** 에 둔다. 경로는 `/jobs/...`(2세그먼트)라 기존 `/{gen_id}` GET과 충돌하지 않는다. 그래도 **기존 `/{gen_id}` 계열보다 파일 앞쪽에 정의**한다.
  - 인덱스는 lazy로 프로세스당 1회 만든다(character.py 관행).
  - 기동 복구도 main.py 대신 **첫 호출 시 1회 전역 sweep**(`asyncio.create_task`)으로 한다.
- **죽은 작업 판정 = `boot_id` 불일치(즉시) + kind별 상한(보조)**
  - uvicorn 단일 워커이므로 이전 프로세스가 만든 processing은 **절대 끝날 수 없다**. 재시작 뒤 첫 조회에서 즉시 실패+환불로 확정한다(아티스트의 30분 대기보다 낫고, 30분 동안 새 생성이 잠기지도 않음).
  - `BOOT_ID = f"{hostname}:{pid}:{uuid4().hex[:8]}"`(모듈 import 시 1회).
  - boot_id가 없는 레거시 문서는 상한 경과로만 판정한다.
  - 전제(단일 워커)는 모듈 docstring과 기동 로그에 명시한다. 이 전제가 깨지면(`--workers` 추가) boot 판정을 꺼야 하므로 env `GEN_JOBS_BOOT_CHECK=0`을 제공한다.
- **kind별 상한**(살아 있는 프로세스에서 멈춘 경우의 보조 판정, 실측 기반)

  | kind | 상한 | 근거 |
  |---|---|---|
  | lyrics | 10분 | p50 18s, 최대 35s |
  | cover | 15분 | p99 177s, 앱 timeout 600s |
  | cover_refine | 15분 | 132~141s |
  | video | 25분 | ffmpeg 600s + heavy 슬롯 대기 + 다운로드·업로드 |
  | music | 30분 | suno 폴링 상한 20분(보이스클론) + 다운로드·정규화 |
  | inst | 30분 | 실측 최대 128s + 폴링 여유 |

  - 앱의 "평소보다 오래 걸리고 있어요" 문구 기준은 p90의 약 2배로 둔다: 작사 1분, 커버·다듬기 5분, 작곡 3분(보이스클론 6분), 연주곡 4분, 영상 6분.
- **환불 정확성**
  - 원장은 **과금 전에** 만들고(charged=false), 차감에 성공하면 charged=true로 바꾼다.
  - sweep 환불 조건은 `refunded≠true` 원자 claim AND (charged=true OR `point_events`에 `spend:{action}`·track_id=point_ref 존재)이다. 두 단계 사이에서 프로세스가 죽어도 이중 환불이나 미환불이 생기지 않는다.
  - generations·inst_jobs는 기존 원자 환불 함수(`refund_generation_points`, `refund_instrumental_points`)를 재사용한다(순환 import를 피해 **함수 안에서 lazy import**).
- **소비·확인(consume/ack) 영속 — 오늘 사고 교훈 반영**
  - 모든 신규 문서에 `consume_tracked:true`를 넣는다. 회수 대상은 `consume_tracked && acked_at 없음`뿐이다.
  - 사용자가 결과 화면을 연 순간 앱이 `POST …/ack`로 **서버에 `acked_at`을 영속 기록**한다. 이후 결과물(가사 자산·커버 세션·곡·영상)을 지워도 다시 배달되지 않는다.
  - 작곡은 발매(`result_track_id` 존재)도 소비로 본다.
  - 레거시(배포 전) 문서는 `consume_tracked`가 없으므로 자동으로 제외된다. 추가 하한으로 `RECOVERABLE_SINCE_V3228`(배포 당일 스테이징 확정 시각 UTC)을 AND로 건다. 경계는 신코드가 쓴 문서 여부이므로 **실질적으로 배포 시각과 같다**.
- **킬스위치**
  - env `GEN_JOBS_KINDS`(기본 `lyrics,music,inst,image,video`). 목록에서 빠진 kind는 원장·409 게이트 없이 기존 동작으로 돌아간다.
  - 컨테이너 재생성만 하면 되고 재빌드는 필요 없다(v3.227 `CHAR_GPT_REF_INDEX` 관행).
  - sweep·환불 로직은 킬스위치와 무관하게 동작한다(안전 측).

### D3. 중복 차단 범위 — "사용자당 디렉터(그룹)별 진행 중 1건"(아티스트와 동일), 과금 전 409
| 그룹 | 대상 | 비고 |
|---|---|---|
| lyrics | 작사 | |
| music | 작곡(`start_music_gen` 경로, `/start/`) | 초안(start_music_gen=false)은 무과금이라 **게이트 제외** |
| inst | 연주곡 | **기존 곡별 claim 유지**(사용자별로는 막지 않음. 원곡이 다르면 병행 허용). 대신 죽은 active를 먼저 정리해 영구 잠김을 해소 |
| image | 커버 + 다듬기 | 하나의 슬롯. 다듬기 버전 경합(0-3)이 구조적으로 사라짐 |
| video | 영상(조합 무관) | **캐시 히트는 게이트 전에 무과금으로 즉시 반환 — 불변** |

- **완성됐지만 확인 안 한 결과(done-unacked)는 새 생성을 막지 않는다.**
  - 근거: 아티스트는 저장(슬롯) 전까지 결과가 자산이 아니라서 막았다. 나머지는 서버가 이미 자산으로 보관한다(가사 보관함·생성 이력·커버 보관함·영상 캐시·Inst 트랙). 막으면 사용자 불편만 생긴다.
- **게이트 순서(기존 순서 보존)**: 검증 400 → 스트라이크 403 → (보이스 만료 400) → **피로 429 → 진행 중 409 → 잔액 402** → 처리.
  - 사용자별·그룹별 `asyncio.Lock` 안에서 [sweep → 진행 중 조회 → 원장 insert → spend]를 수행한다(character.py `_user_gen_lock` 관행).
- **409 본문(구 APK 호환)**: `{error:<한국어 안내>, detail:<같은 문장>, code:"generation_in_progress", kind, job_id, request_id, created_at, meta}`.
  - 구앱의 오류 표시 경로(작사·작곡은 `detail`, 커버는 `error`)가 사람이 읽을 수 있는 문장을 보여준다.
  - 신앱은 `code`로 판정한다. 아티스트 409(`error:"generation_in_progress"`)와는 필드가 다르므로 앱 파서는 둘 다 받는다.
- 영상 과금 ref를 **시도별 고유값**으로 바꾼다: `share_video:{track}:{fmt}[:스타일]:{job8}`. 이벤트 유실(0-2-2)이 없어지고 대사가 맞게 된다. 배포 시점에 진행 중인 구 ref가 없으면(사전 점검) 하위호환 문제는 없다.

### D4. 앱 — `registerKind` 어댑터 실구현(아티스트 경로 동작 불변)
- **스토어** `stores/generationJobStore.ts`
  - `TrackedJobKind`에 `'lyrics'|'music'|'inst'|'cover'|'cover_refine'|'video'`를 추가한다.
  - 선택 필드를 추가한다: `requestId?`, `serverJobId?`, `meta?`, `genResult?`, `ackedAt?`, `director?`.
  - persist 키 `maidol-generation-jobs-v1`은 유지한다(필드 추가만, 마이그레이션 불필요).
  - 아티스트 선택자(`listUserArtistJobs` 등)는 그대로 둔다(kind='artist' 필터). 새로 `listUserGenJobs(kinds?)`와 `useDirectorJob(director)`를 추가한다. 우선순위는 processing → done-unacked → failed-unacked.
- **코어** `services/generationTracker.ts`(1조 전유)
  - tick이 모든 kind의 processing을 순회한다. kind별로 `adapter.fetch`를 호출하고, 아티스트는 기존 코드 경로를 그대로 탄다.
  - 알림·말풍선은 kind 공용으로 일반화한다(뷰어가 보고 있는 job 제외, 알림은 한 번에 1개).
  - `refreshRecoverable`에서 `GET /api/generate/jobs/recoverable`도 함께 병합한다(서버 기능 판정을 엔드포인트별로 캐시. 404면 구서버로 보고 조용히 건너뜀).
  - kind별 상한이 지나면 recoverable을 한 번 호출한다(서버 lazy sweep 유도).
  - **404 유예(동기 kind)**: 요청 후 120초 안의 404는 "아직 도착 전"으로 보고 processing을 유지한다. 120초가 지나도 404면 요청이 서버에 닿지 않은 것이다(원장은 과금 전에 생성). 레코드를 조용히 지우고, 뷰어가 열려 있으면 "요청이 전달되지 않았어요. 별은 차감되지 않았어요. 다시 시도해 주세요"를 띄운다.
  - 네트워크 오류·5xx·timeout은 **절대 실패로 표시하지 않는다**(v3.227 원칙).
- **어댑터 레지스트리** `services/genJobs/index.ts`(1조) + kind별 파일. 파일 소유: `lyrics.ts`·`music.ts`·`inst.ts`는 1조, `cover.ts`(cover·cover_refine)·`video.ts`는 2조. 계약:
  ```ts
  export type GenKind = 'lyrics'|'music'|'inst'|'cover'|'cover_refine'|'video';
  export interface GenJobSnapshot { jobId: string; requestId?: string|null; kind: GenKind; status: 'processing'|'done'|'failed'|'unknown';
    createdAtMs?: number; result?: any; error?: string|null; refunded?: boolean|null; acked?: boolean; meta?: any }
  export interface GenKindAdapter {
    kind: GenKind; director: 'lyricist'|'composer'|'image'|'video'; capMs: number; slowMs: number;
    fetch(job: TrackedJob): Promise<GenJobSnapshot|null>;          // null = 404
    open(job: TrackedJob, navigation?: any): Promise<void>;         // done → 결과 화면(+ack) / processing → 뷰어
    text: { busyTitle: string; busyBody: string; doneTitle: string; doneBody: string; failTitle: string };
  }
  registerKind(adapter); registerGenJob({ kind, requestId?, serverJobId?, meta }); markGenJobDone(key, result, { acked }); ackGenJob(key);
  guardGeneration(kind, { navigation, where }): boolean; newRequestId(): string; setViewerJob(key|null);
  ```
- **요청 시점 규약**
  - 동기 kind: `registerGenJob`(requestId)을 **POST 직전**에 호출하고, 헤더 `X-Gen-Request-Id`를 붙인다.
  - 작곡·연주곡: 201·202 수신 직후(generation_id, inst job_id)에 호출한다. 작곡 POST에도 헤더를 붙여, 응답을 잃은 경우에도 서버의 `client_request_id`로 회수할 수 있게 한다.
  - 화면이 성공 응답을 직접 받으면 `markGenJobDone(…, { acked:true })` → `ackGenJob`(서버 ack) 순으로 처리하고 레코드를 즉시 정리한다. 회수 목록에 뜨는 것은 응답을 잃은 건뿐이다.
- **도착 알림 문구**(showAlert, 알림 화면 집합은 v3.227 `NOTIFY_ROUTES`. 생성 화면에서는 말풍선만)

  | kind | doneTitle | doneBody | 버튼 |
  |---|---|---|---|
  | lyrics | 가사가 완성됐어요 | 완성된 가사를 확인해 주세요. | [나중에]/[지금 보기] |
  | music | 곡이 완성됐어요 | 완성된 곡을 들어보고 발매해 주세요. | |
  | inst | Inst. 버전이 완성됐어요 | 내 곡에 추가됐어요. | |
  | cover | 커버 이미지가 완성됐어요 | 완성된 이미지를 확인해 주세요. | |
  | cover_refine | 이미지 다듬기가 끝났어요 | 다듬은 이미지를 확인해 주세요. | |
  | video | 영상이 완성됐어요 | 미리 보고 저장하거나 공유해 보세요. | |

  - 실패(서버 확정): "{작업}을 끝내지 못했어요". 본문은 refunded면 "사용된 별은 자동으로 환불됐어요", 미과금이면 "별은 차감되지 않았어요". [확인] → ack.
  - "저작권" 표현과 이탈 권장 표현은 쓰지 않는다.
- **도착 시 이동 화면**
  - lyrics
    - `GET /lyrics/{lyrics_id}`(없으면 원장 result의 본문)로 lyricsStore(generatedTitle·generatedLyrics·sourceAssetId)와 musicStore.lyricsSource를 채운다(LyricsLoadingScreen.tsx:97-109 성공 경로와 같게).
    - 그다음 `LyricsResult`로 이동한다.
  - music: `GenerationHistoryScreen.hydrateStores`를 `utils/musicHydrate.ts`로 추출해 재사용한다(동작 불변). → `MusicResult {alreadySaved:false}`.
  - inst: `InstLoading {trackId, title, resume:true, nonce}` — 완료 카드와 미리듣기는 기존 화면이 그대로 처리한다.
  - cover
    - 로컬 meta에 trackId가 있고 앨범 모드가 아니면 `CoverGeneration {recoverJobId}` 결과 모드로 연다(선곡 복원).
    - 다른 기기에서 회수했거나 앨범 모드면 `CoverLibrary`로 보낸다(최신순이라 맨 위에 보임).
  - cover_refine: `CoverGeneration {recoverJobId}` → `GET /upload/cover-history/{session}`로 로드해 새 버전을 보여준다.
  - video: `VideoDirector {initialTrackId, recoverJobId}` → 'done' 단계로 연다(video_url 사용, 캐시 URL이라 무과금 재생).
- **작업실(MapScreen, 1조 전유)**
  - 작사·작곡·이미지·영상 디렉터 모두에 v3.227 아티스트 말풍선 슬롯을 일반화한다: processing은 "만드는 중… (n분)", done은 "완성! 눌러서 확인". 작곡 디렉터는 music·inst 중 우선순위가 가장 높은 1건을 보여준다.
  - **말풍선 탭과, 추적 job이 있는 디렉터의 탭은 피로 게이트보다 먼저 job 처리로 분기한다**(0-3 가로막힘 해소).
  - 튜토리얼 표시 중에는 숨긴다. isNext 말풍선과는 같은 슬롯을 대체하며(동시 렌더 0), 휴식 티켓과는 병존한다.
  - `DIRECTOR_ANCHOR_BY_TYPE`(MapScreen.tsx:79-86)와 `TUTORIAL_STEPS`(:69)는 **변경하지 않는다**.
- **중복 가드(앱, 과금 게이트보다 먼저)**: `guardGeneration(kind)`가 true면 return한다. 팝업은 "이미 {가사를 쓰는/곡을 만드는/이미지를 만드는/영상을 만드는} 중이에요 — 완성된 뒤에 새로 만들 수 있어요." [닫기]/[진행 상황 보기]이다. 적용 지점:
  - 작사: LyricsPromptReview `handleGenerate` 첫 줄, LyricsResult `handleRegenerate` 첫 줄, LyricsLoading doGenerate(최종 방어)
  - 작곡: MusicGeneration `handleGenerate` 첫 줄, MusicLoading doGenerate(최종)
  - 커버: CoverGeneration `handleStyleConfirm`·자동 재진입 경로(:330-334)·`handleRefine` 첫 줄
  - 영상: VideoDirector `startGeneration` 첫 줄 + `proceedGeneration`에 **in-flight ref 가드**(더블클릭 차단)
  - 연주곡: 기존 곡별 409 resume 유지 + 추적 중이면 InstLoading resume로 보냄
- **진행 뷰어 재진입([진행 상황 보기]·말풍선)**: POST 없이 추적만 한다.
  - `LyricsLoading {jobId}` — 새 resume 모드. 마운트 시 POST를 하지 않는다.
  - `MusicLoading {resumeGenerationId}` — 기존
  - `InstLoading {resume:true}` — 기존
  - `CoverGeneration {recoverJobId}` — 로딩 모드로 들어가며 **자동 doGenerate를 억제**한다
  - `VideoDirector {initialTrackId, recoverJobId}` — 'making' 단계
- **문구 정리**: GenerationJobCard.tsx:43은 "탭하면 진행 상황을 볼 수 있어요."로, generationTracker.ts:594는 "완성된 뒤에 새로 만들 수 있어요."로 바꾼다("나가 있어도 계속 만들어져요" 삭제).
- **새 kind용 카드 컴포넌트는 만들지 않는다.** 근거: 범위(40% 룰). 표시는 작업실 말풍선, 앱 내 알림 1회, 기존 목록 화면(GenerationHistory·CoverLibrary·가사 보관함·내 곡)으로 충분하다.

## 확정 스펙

### 서버 S1 (backend-dev — 스테이징 `/private/tmp/server_staging_v3228/`에서만 작업)
1. **`app/services/gen_jobs.py`(신규)**
   - 상수: `BOOT_ID`, `KIND_CFG`(kind → group, cap_min, point action), `RECOVERABLE_SINCE_V3228`, `ENABLED_GROUPS`(env `GEN_JOBS_KINDS`), `BOOT_CHECK`(env `GEN_JOBS_BOOT_CHECK`, 기본 1).
   - 컬렉션 `gen_jobs`(동기 kind 전용):
     ```
     {_id, user_id, kind, group, request_id|null, status:processing|done|failed, boot_id, created_at, updated_at, completed_at,
      point_action, point_cost, point_ref, charged, refunded, error, meta{}, result{}, response{}(재생용, ≤64KB),
      consume_tracked:true, acked_at, swept_reason}
     ```
   - 인덱스(lazy 1회, 로그 `[GenJobs][migration]`):
     - `gen_jobs (user_id, group, status, created_at)`
     - `gen_jobs (user_id, request_id)` unique partial(request_id 존재)
     - `generations (user_id, status, created_at)`
     - `generations (user_id, client_request_id)` sparse
     - `inst_jobs (user_id, active, created_at)`
   - 함수(전부 never-raise, 로그 추적자 `[GenJobs]`):
     - `normalize_request_id(hdr)`: `^[0-9a-f]{32}$` 외에는 None
     - `user_lock(user_id, group)`
     - `gate_and_begin(user_id, kind, request_id, meta)` → `(early_response|None, job)`. 락 안에서 다음 순서로 처리한다:
       1. sweep_user
       2. request_id 중복(processing이면 409 같은 job, done이면 200 재생, failed면 409 `request_already_failed`)
       3. 그룹 진행 중(살아 있는 것만)이면 409
       4. insert processing(charged=false)
     - `mark_charged(job, ref)`
     - `finish(job, result, response)`: processing일 때만 done으로 바꾼다. 이미 sweep된 경우는 `late_result` 저장 + 경고 `late-complete`.
     - `fail(job, error, refund=True)`
     - `refund_once(…)`
     - `is_dead(doc, kind)`: boot 불일치 또는 상한 초과
     - `sweep_user(user, groups)`, `sweep_doc(kind, doc)`, `ensure_boot_sweep()`(프로세스당 1회 전역: gen_jobs·generations·inst_jobs)
     - `recoverable(user, kinds)`, `ack(user, kind, job_id)`, `serialize(kind, doc)`
   - sweep 대상
     - gen_jobs: status=processing
     - **generations**: status∈{pending, processing} **AND point_ref≠None AND refunded≠true**. 초안(point_ref=None)은 절대 건드리지 않는다.
       - 처리: `status:"failed"`, `error_message:"서버 점검으로 작업이 중단됐어요. 사용한 별은 자동으로 환불됐어요."`
       - `refund_generation_points` 호출
       - session_id가 있으면 `creation_log.append_event(GEN_RESPONSE, status failed, error "server_restart|hard_cap")`(best-effort — v3.200 "실패도 사실이다")
     - **inst_jobs**: active=true AND status∈{pending, processing} → status failed, active false, error_message, `refund_instrumental_points`
2. **`app/routes/generate.py`**
   - (a) **파일 앞쪽**에 다음 엔드포인트를 둔다.
     - `GET /jobs/recoverable?kinds=`
       - 응답 `{jobs:[Job], count, swept}`
       - Job = `{job_id, request_id, kind, status, created_at(ISO Z), elapsed_sec, meta, result|null, error|null, refunded}`
       - 상한: kind별 done+processing 10건, failed(24h·미확인) 합계 5건
       - music done = completed·result_track_id 없음·미확인
     - `GET /jobs/req/{request_id}`(본인 gen_jobs + generations.client_request_id, 없으면 404, 조회 대상 문서는 sweep_doc)
     - `POST /jobs/{kind}/{job_id}/ack`
       - 200 `{job_id, kind, acked:true, already}`
       - 404(없음·타인·형식)
       - 409 `{code:"job_processing"}`
       - 환불 없음
   - (b) 작사: 피로 429(:553) 뒤 → gate_and_begin → spend 성공이면 mark_charged, 402면 fail(refund=False) 후 402 → 생성 성공이면 finish(result `{lyrics_id,title,lyrics≤20KB}`, response) → 예외면 fail(refund) + 기존 500 응답. 응답에 `gen_job_id`·`request_id`를 가산한다.
   - (c) 작곡 create(:615)
     - `will_start_music`일 때만: 피로 뒤 사용자 락 안에서 sweep → 진행 중 generations(point_ref≠None, 살아 있음)가 있으면 409 → spend → doc insert.
     - doc에 `boot_id`, `consume_tracked:true`, `client_request_id`, `acked_at:None`를 가산한다.
     - `/start/`(:782)도 같은 게이트를 적용하고, update에 `boot_id` 가산.
   - (d) `GET /{gen_id}`(:930)·`GET /`(:898): 반환 전에 해당 문서(목록은 사용자 단위) sweep_doc/sweep_user를 한다. MusicLoading 무한 대기가 사라진다.
3. **`app/routes/upload.py`**
   - generate-cover: 피로 뒤 gate(group image) → spend → 성공 시 finish(result `{cover_session_id, object_name, image_url, image_model}`) / 예외 시 fail(refund) + 기존 500.
   - refine-cover: 현재 커버 로드 뒤 gate(group image, meta `{cover_session_id, base_version}`) → spend. **락 안에서 세션을 다시 읽어** 버전을 산정한다. MinIO·Mongo 저장 실패(:1070-1117)도 fail(refund)로 환불한다(기존 무환불 버그 수정).
   - `cover-history`·`cover-sessions`는 변경하지 않는다(v3.202·v3.204 폴백 유지).
4. **`app/routes/tracks.py`**
   - share-video
     - 캐시 히트 경로(:2542-2546)는 **불변**(게이트 전에 무과금 반환).
     - 피로 뒤 gate(group video, meta `{track_id, format, style: _style_kw, video_url}`) → spend(ref에 job8을 붙인 고유값) → 성공 시 finish(response 그대로) / 실패 시 fail(refund) + 기존 502.
     - `concurrent cache detected` 경로는 이제 발생할 수 없다(동일 사용자). 다른 사용자가 같은 조합을 동시에 만들면 기존처럼 업로드만 건너뛴다(각자 과금·성공).
   - instrumental: claim 전에 이 track의 죽은 active job을 sweep_doc한다. upsert `$setOnInsert`에 `boot_id`, `consume_tracked:true`를 가산한다. status 엔드포인트(:3210)도 sweep_doc한다.
5. **main.py·inst_service.py·suno_generator.py·points_service.py·character.py 무변경.** character의 boot_id 전환은 백로그다.
6. 로그 추적자:
   - `[GenJobs] begin kind= user= job= req=`
   - `dup-blocked kind= active=`
   - `replay req=`
   - `done`
   - `failed refunded=`
   - `swept kind= reason=dead_boot|hard_cap refunded=`
   - `boot-sweep n=`
   - `recoverable user= n=`
   - `ack`
   - `late-complete`
   - `[GenJobs][migration] index`

### 앱 (웨이브별 — 아래 조 분담)
- 1조 코어: 위 D4의 스토어·코어·레지스트리·`services/genJobsService.ts`(recoverable·req·ack·newRequestId)·Map·문구 정리.
- 동기 kind 요청은 `api.post(url, body, { headers: { 'X-Gen-Request-Id': rid } })` 한 줄로 추가한다(서비스 함수 시그니처에 선택 인자 `requestId`).
- 409 파서: `data.code === 'generation_in_progress' || data.error === 'generation_in_progress'`이면 adopt(해당 job을 추적기에 편입)하고 뷰어로 전환한다(같은 대상이면 이어보기, 다르면 팝업 [진행 상황 보기]).
- 구서버(엔드포인트 404) 폴백: 원장 조회를 쓰지 않고 v3.202 I-lite·v3.204 cover-history 폴링을 그대로 쓴다. 헤더는 무해하게 무시된다.

## 변경 매트릭스
| 파일 | 변경 | 담당 | 웨이브 | 로그 추적자 |
|---|---|---|---|---|
| 서버 app/services/gen_jobs.py (신규) | D2 공통 모듈 | 백엔드 | S1 | `[GenJobs]` |
| 서버 app/routes/generate.py | jobs API 3종·작사 원장·작곡 게이트/boot_id/조회 sweep | 백엔드 | S1 | `[GenJobs]`, `[star-econ]` |
| 서버 app/routes/upload.py | 커버·다듬기 원장/409·다듬기 락 내 버전·저장 실패 환불 | 백엔드 | S1 | `[GenJobs]`, `[RefineCover]` |
| 서버 app/routes/tracks.py | 영상 원장/409/고유 ref·Inst sweep/boot_id | 백엔드 | S1 | `[GenJobs]`, `[share-video]`, `[inst]` |
| 서버 main.py·admin_*·analytics·points_service·character.py | **변경 없음** | — | — | — |
| stores/generationJobStore.ts | kind 확장·선택자 | 1조 | W0 | `[GenJobStore]` |
| services/generationTracker.ts | 다중 kind tick·알림·recoverable 병합·guardGeneration·문구(:594) | 1조 | W0 | `[GenTracker] kind=` |
| services/genJobs/index.ts·lyrics.ts·music.ts·inst.ts (신규) | 레지스트리·어댑터 | 1조 | W0(index)·W1·W3 | `[GenJob:<kind>]` |
| services/genJobs/cover.ts·video.ts (신규, 1조가 스텁 생성 → 2조 소유) | 어댑터 | 2조 | W0(video)·W2(cover) | `[GenJob:video]`, `[GenJob:cover]` |
| services/genJobsService.ts (신규) | API 3종·newRequestId | 1조 | W0 | `[GenJobs]` |
| components/GenerationJobCard.tsx | 문구(:43) | 1조 | W0 | — |
| screens/MapScreen.tsx | 4개 디렉터 말풍선·탭 분기(피로 게이트 앞) | **1조 전유** | W0 | `[Map] job-bubble` |
| screens/VideoDirectorScreen.tsx | in-flight ref·헤더·원장 추적·recoverJobId 진입·409 adopt | **2조 전유** | W0 | `[VideoDirector]`, `[GenJob:video]` |
| screens/MusicLoadingScreen.tsx·MusicGenerationScreen.tsx·GenerationHistoryScreen.tsx·utils/musicHydrate.ts(신규)·services/musicService.ts | 등록·가드·hydrate 추출·헤더 | 1조 | W1 | `[MusicLoading]`, `[GenJob:music]` |
| screens/InstLoadingScreen.tsx·MyMusicScreen.tsx·services/trackService.ts | 등록·ack·헤더 | 1조 | W1 | `[Inst]`, `[GenJob:inst]` |
| screens/CoverGenerationScreen.tsx | 헤더·원장 추적·recoverJobId(자동 doGenerate 억제)·다듬기 원장·가드 | **2조 전유** | W2 | `[Cover]`, `[GenJob:cover]` |
| screens/LyricsLoadingScreen.tsx·LyricsPromptReviewScreen.tsx·LyricsResultScreen.tsx·services/lyricsService.ts | 헤더·resume 모드·가드·도착 hydrate | 1조 | W3 | `[LyricsLoading]`, `[GenJob:lyrics]` |

충돌 방지
- 2조는 generationTracker·store·MapScreen·genJobs/index.ts를 **읽기만** 한다(export API 사용).
- 1조의 W0 **인터페이스 커밋**(타입·레지스트리·스텁 cover.ts/video.ts, 동작 변화 없음)이 들어간 뒤 2조가 착수한다.
- `services/musicService.ts`와 `trackService.ts`는 1조만, `upload`·`video` 관련 호출은 화면 파일 안(2조)에서 처리한다.

## 조 분담 (할당문)
- **백엔드(backend-dev) — S1 전체**
  - `/private/tmp/server_staging_v3228/`에 `orig/`(라이브 generate.py·upload.py·tracks.py + 참조용 points_service·inst_service·character.py)·`deploy/`·`diffs/`·`tests/`·`scripts/`·`DEPLOY.md`를 만든다. **v3.227 DEPLOY.md 형식**을 따른다.
  - 스텁·페이크 Mongo로 단위 테스트를 작성한다. 과금 FAIL 게이트 T1~T7은 필수다.
  - `scripts/predeploy_probe_v3228.py`(읽기 전용: 진행 중 작업 0건 확인 + 잔액 대사 기준선 저장)를 만든다.
  - 서버 쓰기는 하지 않는다.
- **1조(frontend-dev A) — W0 코어 → W1 작곡·연주곡 → W3 작사**
  1. 인터페이스 커밋(동작 불변) → 2조에 통지
  2. Map 말풍선·탭 분기·문구 정리·recoverable 병합
  3. W1 music·inst
  4. W3 lyrics

  아티스트 경로(ArtistLoading·ArtistInput·MyArtists·ArtistCody 가드)는 **동작 불변**이다. v3.227 test-designer 17~20을 회귀로 다시 돌린다.
- **2조(frontend-dev B) — W0 영상 → W2 이미지(커버·다듬기)**
  - W0 영상: 먼저 in-flight ref 가드만 담은 단독 커밋(서버 무관 즉시 효과), 이어서 원장 추적·recoverJobId.
  - W2: CoverGeneration 원장 추적 + **재진입 자동 doGenerate 억제**(0-3) + 다듬기 원장.
  - v3.202 I-lite·v3.204 폴링은 구서버 폴백으로 보존한다.
- **오케스트레이터**: S1 배포 창 운영(아래), 웨이브별 tsc 0 → test-designer 게이트 → 웹 배포. APK는 마지막에 1회(결정 5).

## 서버 스테이징·배포 절차 (v3.227 DEPLOY.md 관행)
0. **[동시 작업 경고]** 오늘 다른 세션이 4회 재배포했다(07:03·08:36·09:02·09:24). main.py·admin_items·admin_stats·analytics를 수정 중이다.
   - 배포 **직전에** 반영 대상 3파일(generate.py·upload.py·tracks.py)을 다시 내려받아 `MD5SUMS.orig`와 대조한다.
   - 다르면 새 현재본에 `diffs/` 3-way를 다시 적용한다(`patch --dry-run` 먼저). 준비본으로 덮어쓰지 않는다. 그다음 테스트를 재실행하고 md5를 갱신한다.
   - **디렉터리 통째 scp와 main.py 반영은 금지**한다.
1. 오케스트레이터 사전 점검(읽기 전용)
   - `ssh … md5sum routes/generate.py routes/upload.py routes/tracks.py; test ! -e services/gen_jobs.py`
   - `predeploy_probe_v3228.py`를 stdin으로 실행해 다음을 확인한다.
     - generations(point_ref 보유) pending·processing = 0
     - inst_jobs active = 0
     - 최근 10분 docker 로그에 `[star-econ] (lyrics|cover|cover_refine|share_video) spend` 뒤 완료 로그가 없는 건 = 0
     - 잔액 대사 기준선 저장(현재 불일치 3계정 = 기준. 배포 후 **증가 0**이 기준)
   - 0이 아니면 끝날 때까지 기다린다(작사 1분, 커버 3분, 영상 10분).
2. 사용자 1줄(백업 `.bak_pre_v3228` + 원본 md5 가드 + scp + 반영 md5 확인)
   - routes 3파일 → `app/routes/`, gen_jobs.py → `app/services/`
   - `test ! -e services/gen_jobs.py`
   - `.bak_pre_v3228`가 이미 있으면 중단(재실행 방지)
   - 형식은 v3.227 §3-1과 같다. 명령 전문은 backend-dev가 DEPLOY.md §3-1에 md5를 채워 작성한다.
3. 오케스트레이터
   - `docker logs` 보존은 사용자가 1줄로 실행한다(v3.227 §3-2 관행).
   - `sudo docker build -t maidol-app:latest .`
   - 이미지 안 md5 확인: 4파일 + **main.py = 현재본 md5**(다른 세션 변경 유지 확인)
   - `docker rm -f maidol-app && docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env -e S3_REGION=ap-northeast-2 maidol-app:latest`
   - health 200 대기
4. 스모크(무과금 우선)
   - health
   - `GET /api/generate/jobs/recoverable`: 무토큰 401, 테스트 계정 200 `count:0`, 로그 `[GenJobs][migration]`·`boot-sweep n=0`
   - `GET /api/generate/jobs/req/<임의32hex>` 404
   - ack 형식 오류 404
   - 기존 API 회귀: `/api/generate/`(목록), `/api/generate/{id}`, `/api/tracks/{id}/instrumental/status`, `/api/upload/cover-sessions`, share-video **캐시 히트 조합**(무과금 200 `cached:true`)
   - 과금 스모크(사용자 승인 시, 테스트 계정 ⭐): 작사 동시 2요청 → 1건 200 + 1건 409, ⭐-5 1회, 대사 불변
5. 롤백은 아래 절을 따른다.

## 롤백 절차
- **앱**
  - 웨이브 단위: `git revert <웨이브 커밋 범위>` → 웹 재배포.
  - 전체: `git revert --no-edit checkpoint-pre-v3228..HEAD`(히스토리 보존) 또는 태그 체크아웃 빌드(`git worktree add /tmp/rb checkpoint-pre-v3228`)로 웹 재배포.
  - APK는 1.1.9(태그 시점 빌드)를 유지한다.
  - 영속 스토어 호환: 새 필드는 선택 필드라 구버전 앱이 무시한다. kind≠artist 레코드는 구버전 선택자에서 걸러진다(`kind==='artist'` 필터).
- **서버 — 1순위(재빌드 없음)**: 킬스위치 `-e GEN_JOBS_KINDS=`(빈 값)를 추가해 재생성한다. 원장과 409 게이트는 꺼지고, 죽은 작업 환불 sweep은 유지된다.
- **서버 — 2순위(파일)**
  - 사용자 1줄: `ssh maidol-ec2 'set -e; cd /home/ubuntu/maidol/backend_9004/app; for f in routes/generate.py routes/upload.py routes/tracks.py; do cp -p "$f.bak_pre_v3228" "$f"; done; md5sum routes/generate.py routes/upload.py routes/tracks.py'` → 원본 md5 확인
  - 오케스트레이터: 재빌드·재생성
  - `services/gen_jobs.py`는 남아 있어도 무해하다(import하는 곳이 없음).
- **서버 — 3순위(이미지 즉시 복귀)**: `sudo docker rm -f maidol-app && sudo docker run -d --name maidol-app --network host --restart unless-stopped --env-file .env -e S3_REGION=ap-northeast-2 maidol-app:checkpoint-pre-v3228`
  - **주의**: 09:24Z 이후 다른 세션이 배포한 변경이 함께 사라진다. 실행 전에 `docker image ls`·현재 main.py md5로 확인하고, 그 세션 소유자에게 알린다.
- **서버 — 4순위(소스 전체)**: `tar -xzf /home/ubuntu/maidol/backups/backend_9004_app_pre_v3228_20260924T094437Z.tgz -C /home/ubuntu/maidol/backend_9004/`(사용자 실행) → 재빌드.
  - 3순위와 같은 주의가 필요하다. `app/` 전체를 덮어쓰므로 **비상시에만** 쓴다.
- **데이터**
  - 새 컬렉션 `gen_jobs`, 새 필드(`boot_id`, `consume_tracked`, `client_request_id`, `acked_at`, `swept_reason`)와 인덱스는 구 코드가 무시하므로 무해하다.
  - **이미 실행된 환불은 되돌리지 않는다**(정당한 환불).

## 40% 룰 판정
**초과 — 사이클 규모 기준 (파일별 변경률은 모두 40% 미만으로 통제)**
- 파일별 추정 변경률
  - generationTracker.ts(709줄): 코어 일반화 약 25%. 어댑터는 별도 파일이라 이 파일 재작성은 없다.
  - LyricsLoadingScreen(322줄): 약 30%(resume 모드)
  - MusicLoading: 약 15%
  - CoverGeneration(2,038줄): 약 7%
  - VideoDirector(1,073줄): 약 11%
  - MapScreen(1,234줄): 약 6%
  - 서버: generate.py +15%, upload.py +8%, tracks.py +3%, gen_jobs.py 신규 약 450줄
- 사이클 전체 규모: 앱 약 20파일(신규 8), 서버 4파일(신규 1). 평소 규모를 넘으므로 → **웨이브 분할**.
- 웨이브
  - **S1(서버 1회 배포, 킬스위치 포함)**
    - 근거: 서버 배포마다 컨테이너를 재생성하면 진행 중 작업이 죽는다. 이번 사이클이 없애려는 사고 유형 그 자체다. 게다가 오늘 이미 5회 재생성됐다.
    - 서버 변경은 kind별로 가산적이다. 구 APK·구 웹과 호환되고(409는 실제 중복일 때만), kind별 킬스위치로 부분 롤백할 수 있다.
    - 테스트에서 특정 kind가 FAIL하면 그 kind는 `GEN_JOBS_KINDS`에서 빼고 배포한다.
  - **W0(최우선·과금)**: 2조 영상 in-flight 가드(서버 무관, 즉시 웹 배포 가능) → 1조 코어·Map·문구 → 2조 영상 원장 추적. S1 배포 뒤 웹 배포.
  - **W1**: 작곡·연주곡(1조)
  - **W2**: 이미지 커버·다듬기(2조, W1과 병렬 개발 가능 — 파일 충돌 없음)
  - **W3**: 작사(1조)
  - 각 웨이브는 S1 위에서 독립적으로 웹 배포할 수 있다. 구서버에서도 폴백으로 동작한다.
- 이월(백로그)
  - character_jobs의 boot_id 전환(30분 대기 해소)
  - `spend_points` 이벤트 DuplicateKey를 error로 격상하고 관리자 경보를 붙이는 일(points_service 공용 — 전 kind 영향)
  - 로그 호스트 볼륨 마운트(v3.227 결정 7 미처리 — 이번 영상 사고 원인도 로그 유실로 확정 불가)
  - share-video 비소유자 과금 정책(공개 곡이면 타인도 생성 가능)
  - 네이티브 푸시 알림

## test-designer 항목 (과금 사고 FAIL 게이트 우선 — T1~T8 하나라도 FAIL이면 해당 kind 배포 중단)
1. **T1 [api][FAIL] 영상 중복 과금**
   - 같은 조합 동시 2요청 → 200 1건 + 409 `generation_in_progress` 1건, ⭐-5 정확히 1회, ffmpeg 1회(`[heavy] start` 1회).
   - 다른 조합으로 동시 요청해도 409(사용자당 1건). 완료 뒤 같은 조합은 캐시 히트 200 `cached:true`(무과금·무피로·게이트 미진입).
   - **잔액 대사 `잔액 = Σpoint_events` 유지**(고유 ref라 이벤트 유실 0).
   - 캐시 히트는 쿨다운 중에도 200(v3.214 회귀).
2. **T2 [api][FAIL] 다듬기 경합**: 같은 세션 동시 2요청 → 1건만 차감. 버전 번호 충돌 0(v{N} 덮어쓰기 없음). MinIO put 실패를 주입하면 환불 1회.
3. **T3 [api][FAIL] 커버·작사·작곡 동시 2요청**: 각 1건 차감 + 409. 작곡 초안(`start_music_gen=false`)은 409 없음·무과금. `/start/`도 게이트 적용.
4. **T4 [api][FAIL] 죽은 작업 환불(재시작 시뮬레이션)**
   - gen_jobs·generations·inst_jobs에 다른 boot_id로 processing 문서를 둔다(charged=true) → 첫 조회에서 failed + 환불 **정확히 1회**. sweep을 2번 호출하고 recoverable·gate·GET이 동시에 돌아도 1회.
   - charged=false이고 spend 이벤트가 없으면 **환불 0**. spend 이벤트는 있지만 charged=false(중간에 죽음)이면 환불 1회.
   - **초안 generations(point_ref=None) 불변**(현재 8건 실데이터 형태로 테스트).
   - inst active 해제 → 같은 곡 재요청 가능.
   - 작곡 sweep 시 creation_log에 GEN_RESPONSE failed 기록.
5. **T5 [api][FAIL] 멱등**
   - 같은 `X-Gen-Request-Id` 재전송: processing 중이면 409(같은 job), done 뒤면 200 `replayed:true`·무과금, failed 뒤면 409 `request_already_failed`.
   - 형식 오류 헤더는 무시(새 id).
   - 타인의 request_id 조회 → 404.
6. **T6 [api][FAIL] 게이트 순서**: 피로 429 → 409 → 402 순서. 429·402일 때 원장 잔재 없음, 또는 failed·미과금·recoverable 비노출. 스트라이크 403, 보이스 만료 400 선행 유지.
7. **T7 [api][FAIL] 소비·재배달 방지(오늘 사고 교훈)**
   - done 뒤 ack → recoverable 비노출. 이후 결과물(가사 자산·커버 세션·generation·Inst 트랙)을 삭제해도 **재배달 0**.
   - 작곡 발매(result_track_id) → 비노출.
   - 레거시(consume_tracked 없음) 문서 **전부 비노출**: 운영 스냅샷 형태의 페이크 데이터 58 completed generations 등.
   - RECOVERABLE_SINCE 경계.
8. **T8 [ops][FAIL] 배포 전후 잔액 대사**: 불일치 계정이 기준선 3개(c19acda4 −5, 2f85f76c −5, 18bd8131 −1)에서 **늘지 않음**.
9. **[api] recoverable 계약**
   - kind별 필드
   - 상한 10/5
   - 살아 있는 processing의 elapsed_sec
   - failed 24h·refunded 플래그
   - ack 409(processing)·404(타인)
   - 킬스위치 `GEN_JOBS_KINDS=`일 때 게이트·원장 없음 + sweep 동작
10. **[unit] 앱 추적기**
    - 동기 kind 404 유예 120초(이후 조용히 정리 + 뷰어 안내 "별은 차감되지 않았어요")
    - 네트워크 오류·5xx·timeout은 실패 표시 없이 백오프만
    - 서버 failed일 때만 실패·환불 문구
    - kind별 상한 경과 시 recoverable 1회
    - 알림 1회·뷰어 job 제외·NOTIFY_ROUTES 밖에서는 말풍선만
    - 아티스트 레코드·선택자 불변
11. **[e2e] kind별 이탈·복귀**(폰 웹 + APK)
    - 요청 → 실수 이탈(탭 전환·뒤로·웹 새로고침) → 작업실 해당 디렉터 말풍선 "만드는 중… (n분)" → 완성 → "완성! 눌러서 확인" + 작업실에서 알림 1회 → 탭 → 올바른 결과 화면 → ack → 말풍선 사라짐 → 재시작해도 다시 안 뜸.
    - kind별 결과 화면
      - 가사: LyricsResult 본문·제목·자산 연결(작곡 PATCH 동기화 동작)
      - 곡: MusicResult 비교 카드·발매
      - Inst: 완료 카드
      - 커버: 결과 + 곡 적용
      - 다듬기: 새 버전
      - 영상: 미리보기·저장
    - **디렉터가 휴식 중이어도 말풍선 탭이 결과로 간다**(피로 다이얼로그 없음).
12. **[e2e] 중복 가드 앱**
    - 진행 중 재진입·재생성 시도 → 팝업 "이미 … 중이에요", 요청 0건·⭐ 불변.
    - **커버 생성 중 작업실 → 이미지 디렉터 재진입 → 자동 재요청 0건**(0-3 회귀 봉합).
    - 영상 자막 위치 카드 더블클릭 → 요청 1건.
    - 다른 기기에서 409 → adopt 후 진행 표시.
13. **[e2e] 재시작**: 스테이징 유닛 + 운영 관측
    - 작곡 중 재시작 → MusicLoading이 다음 폴링에서 실패 화면 + "사용한 별은 자동으로 환불됐어요", GenerationHistory 실패 표시
    - 연주곡 → InstLoading 실패 문구 + 곡 잠김 해제
    - 동기 kind → 앱 재진입 시 실패·환불 알림 1회
14. **[회귀]**
    - v3.203 연주곡 생성·duration 게이트
    - v3.202 I-lite(구서버 폴백)·커버 대화 영속·성공 시에만 컨텍스트 클리어
    - v3.204 refine 이중 제출 가드·cover-history 폴링(폴백)
    - v3.214 영상 과금·캐시 무과금·피로 게이트
    - v3.219 디렉터 작업 보존 draft(VideoDraft 'making' 제외 유지, ArtistInput draft)
    - v3.227 아티스트 추적기 전체(test 17~20)
    - 튜토리얼 앵커·TUTORIAL_STEPS 불변(말풍선은 튜토리얼 중 숨김)
    - 피로 429 다이얼로그 12곳
    - creation_log(작곡 GEN_REQUEST·GEN_RESPONSE)
    - 작사 자산 자동 저장·v3.144 sourceAssetId 영속
    - GenerationHistory 이어보기·삭제
    - MyMusic Inst focus 재확인
    - v3.223 재생 큐 무관
15. **[정책 문구]**
    - `grep -rn "나가 있어도\|나가도 계속\|나가서 다른" 2_housing/{screens,components,services}` → VoiceCloneWizard(:604, 범위 밖 — 결정 6)만 남음
    - 진행 화면 8곳 "작업이 끝날 때까지 이 화면을 벗어나지 마세요" 유지
    - 알림 문구에 "저작권"·이모지 없음(⭐ 제외)
    - 모든 팝업은 showAlert
    - MAIDOL 표기

## 사용자 결정 사안 (기본안 명시 — 지시가 없으면 기본안으로 진행)
1. **서버 배포 방식**: 기본안 = S1 1회 배포(킬스위치 포함) + 사용자 scp 1줄. 대안은 영상·이미지 먼저(S1a), 작사·작곡 나중(S1b)의 2회 배포(재생성 1회 추가).
2. **작곡 중복 차단 강도**: 기본안 = 사용자당 동시 작곡 1곡(아티스트와 같음). 대안은 동시 2곡까지 허용.
3. **과거 불일치·고아 과금 보정**
   - 기본안: `2f85f76c`(오늘 가입한 베타 사용자, 영상 중복 차감 정황 −⭐5)에 ⭐5를 보정 지급한다(관리자 admin_adjust, 사유 "v3.228 영상 중복 차감 보정" — **사용자가 관리자 웹에서 실행**).
   - c19acda4(대표 계정 추정)의 −5, 작사 고아 4건, 커버 고아 1건은 보정하지 않는다.
4. **완성됐지만 확인 안 한 결과가 새 생성을 막는지**: 기본안 = 막지 않음(D3 근거). 알림과 말풍선만 표시한다.
5. **APK**: 기본안 = 웨이브마다 웹을 먼저 배포하고 APK는 W3 뒤 1회(1.2.0 후보). 구 APK 1.1.9는 409 안내 문장만 보이고 기능은 호환된다.
6. **보이스 클론 마법사 문구**("이 화면을 나가도 계속 진행되고", VoiceCloneWizardScreen.tsx:604): 디렉터 5종 밖이라 기본안 = 유지. 통일을 원하면 지시.
7. **로그 호스트 볼륨 마운트**(v3.227 결정 7 미처리): 기본안 = S1 재생성 때 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 추가(docker run 옵션 변경 — 사용자 승인 필요). 이번 영상 사고도 로그 유실 때문에 확정하지 못했다.

규칙: 서버 수정은 server_staging_v3228에서만 한다(라이브 원본 pull + orig 보존 + 배포 직전 md5 재대조). 프로덕션 쓰기(scp·build·재생성·보정 지급·env)는 사용자 승인·실행 뒤에 한다. main.py는 건드리지 않는다. 민감 정보는 플레이스홀더로 쓴다. 팝업은 showAlert, 표기는 MAIDOL로 한다. 이탈을 권장하는 문구는 쓰지 않는다. 코드 수정과 커밋은 이 계획이 승인된 뒤 team-dev 루프에서 한다.

### v3.228 사용자 결정 (2026-09-24, 오케스트레이터 기록 — 본문과 충돌 시 이 소절이 우선)
1. **진행 방식**: 전체 진행 — 서버 S1 단일 배포(사용자 scp 1줄, kill switch `GEN_JOBS_KINDS`), 앱 W0(영상 과금+공통) → W1(작곡·연주곡) → W2(이미지) → W3(작사), 웨이브별 웹 선배포, APK는 W3 후 1.2.0 1회. 40% 룰 초과는 사용자 승인으로 해소.
2. **영상 중복 차감 의심 ⭐5(user 2f85f76c)**: 사용자가 관리자 웹에서 직접 지급 — 팀은 데이터 쓰기 금지. c19acda4 과거 미설명 차감은 조정하지 않음.
3. **로그 볼륨**: S1 재생성 시 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 추가(디렉터리 생성·권한은 DEPLOY.md 1줄 명령에 포함 — 사용자 실행).
4. **작곡 동시 생성**: 사용자당 진행 중 1곡(과금 전 409). 완성됐지만 미확인 결과는 새 생성을 막지 않음.
5. 기본값 확정: 미확인 결과 비차단, 보이스 클론 문구 유지(4개 디렉터 범위 밖), "나가 있어도 계속 만들어져요" 잔존 2곳(GenerationJobCard.tsx:43, generationTracker.ts:594)은 이번에 "벗어나지 마세요" 원칙으로 교체.


# v3.229 — ① 아티스트 "내 목소리" 작곡 미반영 점검 ② 디렉터 복귀 시 보존 화면까지 여러 번 눌러야 하는 문제 ③ 아티스트 개명이 곡 표기에 반영 안 됨

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD 522941a, 앱 1.2.0 — 서버·웹·APK 모두 v3.228 반영). 서버 = `<SSH_HOST>`(maidol-ec2) `/home/ubuntu/maidol/backend_9004/`(git 아님, 이미지 베이크, 컨테이너 `maidol-app` 2026-09-24 ~16:00Z 기동). **서버 실측은 전부 읽기 전용**이다(scp 다운로드·호스트 로그·`docker logs` grep). 출처 표기: [P]=planner 실측, [O]=오케스트레이터 전달(재확인한 것은 [O→P]).
- **권한 제약(기록)**: planner의 컨테이너 내 Mongo 읽기(`docker exec … python -`)는 이번 세션 권한 분류기가 "Production Reads"로 거부했다. 그래서 DB 필드 대조는 [O] 사실 + 로그로 대신하고, 남은 DB 대조는 **읽기 전용 스크립트를 준비해 오케스트레이터 실행 항목**으로 넘긴다(§1-5).

사용자 요청 원문:
1. "지금 테스트했는데 아티스트에 내 목소리가 있는 상태로 작곡을 했는데 목소리가 반영이 안되는 것 같아서 확인해줘. 그리고 디렉터들과 작업을 하다가 다른 작업을 하고 돌아오면 상태가 보존되어있긴한데 이 보존된 화면이 바로 보이는게 아니라 어느정도의 클릭 다음에 화면이 보이는 형태더라고? 이렇게 해야만 하는 이유가 있는거야?"
2. (추가 제보) "내가 아티스트 이름이 맘에 안들어서 작곡 이후에 아티스트 이름을 바꿨는데. 만든 곡에 아티스트 이름이 반영이 안되네?"
3. (항목 ③ 사용자 결정) "수정하면 그 이름 따라가게 반영해줘" — 기존에 개명된 아티스트의 곡도 소급한다(승인됨. 단 실행 전 대상 건수·목록을 오케스트레이터가 확인). 개명 남용 정책 리스크는 기록만 한다.

현재 서버 파일 md5([P] 2026-09-24 16:4xZ, 배포 직전 재대조 기준):
- services/suno_generator.py `c3ce9f3d7bb063b6f0c4394e5077c2ec`(mtime 09-21 22:41Z)
- routes/generate.py `4842bb5623cf55c3f6be00da9ae88a7a`
- routes/character.py `0c73273ce489a51da8c4ccfda7869491`(mtime 09-24 09:01Z)
- routes/tracks.py `350c092800856da7b9f294155b16fda2`

## 0단계 Plan verification findings

### 1. 내 목소리 미반영

#### 1-1. 문제 곡 타임라인 (컨테이너 로그 + 호스트 로그, [P])
| 시각(UTC 09-24) | 이벤트 | 출처 |
|---|---|---|
| 16:27:29·16:27:39·16:30:04·16:30:09 | 작곡 대화에서 아티스트 "샘플"(cid a34d8577…) 선택 4회 **차단** — `목소리 미연결 아티스트 선택 차단 {status:null}` | frontend.log (MusicGenerationScreen.tsx:950-962) |
| 16:28:33 | 보이스 학습 과금(voice_clone −⭐5) | gen_jobs.log:34 |
| 16:28:37~16:29:30 | validate-info·record-info 폴링 → 16:29:31 `check-voice isAvailable=True`(voice 91521d4c…) | docker logs |
| 16:31:04.150 | 작곡 요청 직전 check-voice 재확인 `isAvailable=True` | docker logs (generate.py:799 `_voice_expired_response`) |
| 16:31:04.211 | `Suno style string: Carol, Romantic, Sweet, 130 BPM` · `resolved_model=V6 (suno_model_in=None use_upload_cover=False persona=True)` · `customMode=True` | suno_generator.py:124·160·206 |
| 16:31:04.52 | Suno taskId=fbb0147e… · 폴링 루프 `max_polls=240 is_voice_clone=True` | :297-299 |
| 16:31:30 → 16:32:07 → 16:32:12 | TEXT_SUCCESS → FIRST_SUCCESS → **SUCCESS**(변형 2개) | docker logs |
| 16:31:34 | 같은 사용자 2번째 작곡 POST(req=2cd7ceee)를 `[ComposeGuard] dup-blocked` → 앱 16:31:39 `/generate/ 409` | gen_jobs.log:60, frontend.log |
| 16:41:07 | variant 0 발매 → track 6ab552a2… | docker logs |

- 결론: **전달 경로는 정상이다(확정)**.
  - 목소리 연결 → ready → 요청 직전 사용 가능 확인 → body에 `personaId` + `personaModel=voice_persona` + `model=V6`이 실렸다([O], 로그 `persona=True` [P]).
  - 보컬 성별(`vocalGender`)과 보컬 스타일 문구는 없었다. style 문자열에 보컬 지시가 없으므로 **style이 목소리를 덮었을 가능성은 낮다**.
  - 만료도 아니다. 요청 직전 `isAvailable=True`였다.
- **관찰 A(요청 대비 소요시간)**: Suno 제출에서 SUCCESS까지 **68초**가 걸렸다.
  - v3.228 실측([P], 최근 30일)은 일반곡 p50 66초, 보이스클론 곡 **114~135초**(n=2)였다. 이번 곡은 **일반곡과 같은 속도**다.
  - 보이스 곡이 느렸던 표본은 V5_5 시기로 추정되지만 날짜는 미확정이다(§1-5 스크립트로 확정).
  - V6에서 페르소나 처리 방식이 달라졌을 수 있다는 **정황**일 뿐이며 확정 근거는 아니다.

#### 1-2. sunoapi.org 공식 문서 (WebFetch 2026-09-25 조회, docs.sunoapi.org/suno-api/generate-music[.md])
- `personaModel`: "Only available for `V5`, `V5_5`, `V6`, `V6_MINI`, and `V6_WILD`." voice_persona는 Suno Voice로 만든 voiceId일 때 필수다.
  - .md 판은 V5·V5_5에 **"(Discontinued)"** 표기를 붙였다. → **V5_5로 되돌리는 안은 불가**하다(확정).
- `audioWeight`: "Relative weight of audio features. Range 0–1, up to 2 decimal places. Custom mode only. Not supported when there are no vocals". **기본값·권장값은 문서에 없다.**
- `styleWeight`: style 준수 강도(0–1). `weirdnessConstraint`: 실험성(0–1). 둘 다 custom mode 전용이고 권장값은 없다.
- `vocalGender`: "only increases probability". 이번 요청에는 없었다.
- V6 가사 필드: `lyrics` 우선, 없으면 `prompt`를 가사로 쓴다(custom mode). → 우리가 `prompt`로 가사를 보내는 것은 **문서상 유효**하다.
- 목소리 품질·유사도 권장 파라미터를 다루는 문서는 없다.
  - suno-voice-generate·check-voice 문서에도 없다.
  - 서드파티 가이드(mindstudio·suno.hk·evolink)에도 audioWeight 권장값이 없다.
  - 공통 서술은 "완전한 복제가 아니라 유사한 페르소나"라는 것뿐이다.
- 응답(record-info) 스키마: `data.param`(요청 에코 JSON 문자열), `data.response.sunoData[].model_name`·`tags`·`prompt`. 서버는 이 전문을 `generations.suno_response_raw`에 저장한다(suno_generator.py:509-510).
  - `data.param`에 personaId와 audioWeight가 에코됐는지로 **공급자가 파라미터를 받았는지 확인**할 수 있다(§1-5).

#### 1-3. 코드 실측 [P]
- 서버 `suno_generator.py`
  - :142-158: 모델은 호출자 값 → 없으면 `settings.suno_model_default`(=V6)로 정한다. V5/V5_5가 명시돼 와도 V6로 방어 매핑한다(v3.177/v3.179).
  - :184-198: `personaId`·`styleWeight`·`weirdnessConstraint`·`audioWeight`·`personaModel`은 **받은 값을 그대로** 싣는다. 보이스 곡 전용 보정은 없다.
- 이력
  - v3.148(09-09): V5로 보내 personaId가 무시되던 회귀를 V5_5 강제로 고쳤다. REPORT_v3.md:3063-3069.
  - 09-11 "냥냥냥"(6aa3ea81…)은 V5_5 시기 곡이다. 사용자가 만족한 사례다([O]).
  - **v3.177(09-15) V6 이전 때 "실생성 스모크는 대표 실테스트 위임"으로 끝났다**(REPORT_v3.md:3515). **V6 보이스 곡의 목소리 유사도를 확인한 기록은 없다.**
- 앱 `MusicGenerationScreen.tsx`
  - 목소리 연결 아티스트를 선택하면 `persona_voice_id`를 자동 적용한다(:983-990). `personaModel='voice'`, 보컬 성별·스타일 단계는 건너뛴다.
  - **이후 step 5~10 세부 질문은 그대로 묻는다.** step 9 문구는 "참고 음원의 세기는 얼마만큼 반영할까요?"(:81)이고, 슬라이더 기본값은 0.5다(:188, UI :1866-1895).
  - "이대로 갈게요"를 누르면 `audioWeight`가 실린다(:1168-1171, :1316-1317 → MusicLoadingScreen.tsx:314 → musicService.ts:304).
  - **이 질문은 참고 음원을 올리지 않아도 무조건 나온다**(step 8→9 무조건 전이 :1155-1167).
  - 이번 곡은 참고 음원이 없었다(`use_upload_cover=False`). 그런데도 body에 `audioWeight`가 실렸다([O]).
  - → **"참고 음원 세기"로 안내한 슬라이더 값이 실제로는 목소리(페르소나) 오디오 반영 비중으로 Suno에 들어간다(오배선, 확정)**. 사용자가 이 값을 낮추거나 기본 0.5로 두면 목소리 반영이 약해지는 방향이다. 값의 효과 크기는 문서에 없으므로 **A/B 청취로 확정**해야 한다.
- 부수 발견(범위 밖, 기록만)
  - step 7 "자유도"(styleWeight)와 step 8 "대중/실험"(weirdness)은 **값을 받기만 하고 서버로 보내지 않는다**. musicService.ts와 musicStore에 전송 필드가 없다.
  - 이번 원인과는 무관하다. 사용자가 고른 답이 무시되는 UI라서 후속 정리 후보로 남긴다.

#### 1-4. 원인 판정
| 후보 | 판정 | 근거 |
|---|---|---|
| 앱·서버 전달 누락 | **배제(확정)** | 로그 `persona=True`, [O] body에 personaId·voice_persona, check-voice True |
| 보이스 만료 | **배제(확정)** | 요청 직전 isAvailable=True, 생성 후 2분 |
| ⓐ V6의 voice_persona 반영 강도가 V5_5보다 약함 | **가장 유력(미확정)** | V6 전환(09-15) 뒤 목소리 유사도를 확인한 적 없음. 사용자 만족 사례는 V5_5뿐. 소요시간이 일반곡 수준(68초 대 114~135초). V5_5는 공급자가 Discontinued로 표기해 되돌릴 수 없음 |
| ⓑ audioWeight 오배선(참고 음원 질문이 목소리 비중을 결정) | **확정된 결함, 영향 크기 미확정** | step 9가 참고 음원이 없어도 나오고, 그 값이 personaId와 같은 요청에 들어감. 문서 정의는 "audio features의 상대 가중치". 권장값은 없음 |
| ⓒ styleWeight·weirdness 누락 | 영향 낮음 | 문서상 style 준수·실험성 파라미터. 목소리와 직접 관계 없음. 앱이 원래 보내지 않음(부수 발견) |
| ⓓ 가사·스타일 보컬 지시가 페르소나를 덮음 | 낮음(style 확인), 가사는 §1-5로 확인 | style에 보컬 단어 없음. 듀엣 가사라면 `[Female]/[Male]` 태그가 있음(lyrics_generator.py:145-175). 이 곡은 제목상 솔로로 추정되지만 스크립트로 확인 |
| ⓔ Suno가 페르소나를 무시한다는 신호 | §1-5로 확인 | `suno_response_raw.data.param` 에코와 `sunoData[].model_name`, `tags` |

- **결론**: 앱·서버 전달은 정상이다. 목소리가 약하게 들리는 원인으로 가장 유력한 것은 두 가지다.
  - ⓐ V6 전환 뒤 한 번도 검증하지 않은 V6의 목소리 반영 특성
  - ⓑ "참고 음원 세기" 질문 값이 목소리 반영 비중으로 새는 오배선
- 둘을 가르는 것은 **같은 가사와 같은 목소리로 audioWeight만 바꾼 A/B 청취**다. 사용자 결정 1: 과금이 발생한다.

#### 1-5. 오케스트레이터 실행 항목 (읽기 전용 DB 대조 — planner 권한 거부분)
- 스크립트: `/Users/pearl/TripleJ/2_housing/scratchpad/v3229_q_voice_compare.py`
  - 쓰기 0이다. 가사 본문과 시크릿은 출력하지 않고, 가사는 보컬 태그 유무만 본다.
  - 실행: `ssh <SSH_HOST> 'docker exec -i -w /srv/app maidol-app python -' < …/v3229_q_voice_compare.py`
- 출력: voice_persona 곡 **전체**를 시간순으로, 그리고 6aa3ea81 범위("냥냥냥")를 따로 뽑는다. 각 행의 항목은 다음과 같다.
  - `engine_model`·`body_model`, 소요초
  - `audioWeight`·`styleWeight`·`weirdness`·`vocalGender`, style 앞 80자, 가사 보컬 태그 유무
  - **응답 에코**: `echo_personaId?`·`echo_personaModel`·`echo_audioWeight`·`echo_keys`
  - `model_name`, `tags`
- 판정 기준
  - 에코에 personaId와 voice_persona가 **없으면** 공급자가 무시한 것이다. 원인을 ⓔ로 확정하고 sunoapi에 문의한다(사용자 몫).
  - 에코에 있으면 ⓐ·ⓑ를 A/B로 가른다.
  - V5_5 곡의 audioWeight 유무와 값, 소요초가 V6 곡과 체계적으로 다르면 PLAN에 추가 기록한다.
  - "냥냥냥"에 audioWeight가 없었고 이번 곡에 0.5 이하가 있었다면 ⓑ의 가능성이 올라간다.

### 2. 디렉터 복귀 시 보존 화면까지 탭 수 ([P] 코드 재확인)

#### 2-1. 현재 탭 흐름 (MapScreen.tsx `handleDirectorPress` :615-652 → `proceedDirectorPress` :654-719)
1. 로그인 확인 (:616-619)
2. v3.228 추적 작업 (:621-628): "만드는 중"이면 진행 화면, "완성"이면 결과 화면으로 1탭에 간다. 휴식 게이트보다 먼저 처리한다.
3. **휴식(피로) 게이트** (:634-649)
   - 작사·작곡·이미지는 휴식 중이면 **이어하기까지 막고** ⭐ 또는 광고로 단축하는 다이얼로그를 띄운다.
   - 아티스트는 v3.122.1부터 제외됐고, 영상은 맵 대상이 아니다(:142-144).
4. 작사: 영입 디렉터가 2명 이상이면 **매번** 선택 모달을 띄운다(:659-665). 요청서가 있으면 LyricsPromptReview로 간다(:671-674).
5. 이미지: CoverGeneration으로 바로 간다(:680-683).
6. 아티스트: 추적 작업이 없으면 Dialogue를 거친다(:690-716). 보유자는 Dialogue 다음에 MyArtists로 간다.
7. 나머지(작곡·영상·작사 신규): Dialogue로 간다(:718 → :605).
- **Dialogue**(DialogueScreen.tsx): 대사 2줄이 40ms 간격 타자 효과로 나온다(:250-262). 한 번 탭하면 문장이 완성되고 한 번 더 탭하면 다음 줄로 간다(:265-297). **대사 자체는 보존 draft를 보지 않는다.**

| 디렉터 | 복귀 탭 수(휴식 아님) | 보존 위치 / 재시작 후 | 복원 판정 |
|---|---|---|---|
| 아티스트 | 미보유: 캐릭터 1 + 대사 2~4 → ArtistInput = **3~5탭**. **보유**: 캐릭터 1 + 대사 2~4 → MyArtists → ＋추가 → ⭐ 고지 확인 → ArtistInput = **5~7탭** | `characterTaskStore.draft`, 영속(characterTaskStore.ts:107-192, 사진 URI 제외) | ArtistInputScreen.tsx:215-236. `targetCharacterId`·`forceKind` 키가 일치해야 하고, 다르면 **draft를 폐기**한다 |
| 작사 | 캐릭터 1 + (선택 모달 1, 2명 이상일 때) + 대사 2~4 → LyricsInput = **3~6탭**. 요청서 뒤에는 1탭 | `lyricsStore.draftStep/draftChat`, 영속(lyricsStore.ts:92-133) | LyricsInputScreen.tsx:120-135 |
| 작곡 | 캐릭터 1 + 대사 2~4 → ComposeLyricsPick(목록 로딩) → **같은 가사 카드**를 다시 탭 → ComposerSelect 자동 통과 → MusicGeneration = **4~6탭**. 다른 카드를 누르면 draft를 폐기한다 | `musicStore.composeDraft`, **메모리 전용** | MusicGenerationScreen.tsx:124-133(lyricsKey 일치 + 사용자 답 1개 이상) |
| 이미지 | **1탭**(바로 이동) | `musicStore.coverMessages/coverStep`, 메모리 | CoverGenerationScreen.tsx:411-433. **'처음부터' 버튼이 없다** |
| 영상 | 캐릭터 1 + 대사 2~4 → VideoDirector = **3~5탭** | `musicStore.videoDraft`, 메모리 | VideoDirectorScreen.tsx:188-197('making'·'done' 단계와 회수 진입은 제외) |
- 휴식 중이면 작사·작곡·이미지에 **다이얼로그 처리가 1회 이상 추가**된다. ⭐나 광고로 단축하지 않으면 이어하기가 불가능하다.

#### 2-2. 각 단계가 존재하는 이유와 타당성
| 단계 | 이유(기록) | 이어하기에서의 타당성 |
|---|---|---|
| 로그인 | 계정 데이터 | 유지 |
| 추적 작업 우선 | v3.228: 결과 확인은 무과금이라 휴식이 막으면 안 됨 | 유지(최우선) |
| 맵 휴식 게이트 | v3.107/v3.118: 새 작업 전에 쿨다운을 알림 | **이어하기에는 불필요**. 과금 시점마다 화면 안 게이트가 따로 있다: LyricsPromptReview:89, MusicGeneration:1357·2082, CoverGeneration:698·1648, VideoDirector:665·914, ArtistLoading:510, ArtistCody:475. 맵 게이트는 과금 방어로는 중복이고, 무과금인 이어하기(보기·수정)만 막는다 |
| Dialogue 대사 | v3.179/v3.182 대표 요청: "모든 디렉터가 캐릭터+흰 대화창을 거치게" 연출 통일. 작사는 창작 모드 선택(v3.200)도 여기서 함 | **새로 시작할 때는 유지**. v3.219 draft 도입 때 Dialogue를 "보존 대상 아님"으로만 두었고, **draft가 있을 때 건너뛰는 분기를 설계한 적이 없다**(PLAN.md:4995 "Dialogue 관문(2노드 인사)은 보존 제외 명기"). 이어하기에서 반복하는 것은 의도가 아니라 누락이다 |
| 작사 선택 모달 | 영입 디렉터 선택 | 이미 선택한 디렉터가 있고 draft가 있으면 불필요 |
| 작곡 가사 재선택 | v3.130: 새 곡의 첫 질문 = 가사 선택 | draft의 lyricsKey가 현재 가사와 같으면 불필요(같은 카드를 다시 고르는 동작일 뿐) |
| 아티스트 MyArtists→＋추가→⭐ 고지 | v3.105: 추가 진입 시점에 비용 고지 1회 | 시작할 때 이미 봤다. 이어하기에서 반복하는 것은 불필요하다(과금은 ArtistLoading에서 하고 게이트가 있음) |
- **답(사용자 질문)**: "이렇게 해야만 하는 이유"는 없다. 새로 시작할 때를 위한 연출(대사)과 휴식 안내가 이어하기에도 그대로 걸려 있는 것이다. v3.219에서 보존만 만들고 **바로 가기 분기**를 빼먹은 설계 누락이다.
  - 유지할 이유가 있는 것: 추적 작업(만드는 중·완성)이 보존 화면보다 먼저인 것, 새로 시작할 때의 대사·휴식 안내, 과금 버튼에서의 휴식 게이트.

### 3. 아티스트 개명 미반영 ([O] + [P] 코드 실측)
- [O] characters a34d8577… name="한겨울"(16:46:42Z에 수정). 곡 tracks 6ab552a2…(16:41:07Z 발매, 비공개)는 `artist_name`="샘플", `user_character_snapshot.name`="샘플", `character_id` 연결은 있음.
- **원인(확정)**: 발매할 때 이름을 **복사해 동결**한다. 개명 PATCH는 곡에 전파하지 않는다.
  - 발매: tracks.py:206-219(`source_meta.artist_name` ← characters.name), :2156·:2192(`artist_name`), :1790·:1825(업로드 경로), `_build_character_snapshot` :95-137(`user_character_snapshot.name` 포함).
  - 파생: Inst.는 원곡 값을 상속한다(inst_service.py:400·425, `character_id` 상속).
  - 개명: character.py `PATCH /character/{cid}` :3377-3540은 `characters.update_one`만 하고 **tracks·mv_jobs·ES·Redis는 건드리지 않는다**.
- 설계 목적 기록(REPORT_v3.md:3198-3212, v3.156/v236)
  - 요청은 ③ "차트=가수명, 없으면 기획사명 폴백"과 ① "착장 표시"였다.
  - "동결"은 착장 스냅샷(발매 당시 외형 = 이력)과 **함께 구현하면서 생긴 부수 효과**다. **이름을 고정해야 한다는 요구나 근거 기록은 없다.**
  - 닉네임(기획사명 `uploader_nickname`)도 같은 비정규화 복사인데, 회원 탈퇴 때만 일괄 치환한다(auth.py:1232-1236). 닉네임 변경도 곡에 전파되지 않는다(동류 문제, 이번 범위 밖 — 기록).
- 이름이 노출되는 경로(서버 직렬화, [P])

| 경로 | 현재 표기 원천 | 비고 |
|---|---|---|
| 곡 상세·목록·마이페이지(tracks.py `_serialize_track` :35-54) | `artist_name` → 없으면 닉네임 | 상세 Redis 캐시 `cache:track:v4:{id}` 600초(:1530·:1649) |
| 차트(charts.py:55) | 동일 | 차트 캐시 TTL 300초(:36) |
| 아티스트 채널(artists.py:41) | 동일 | :244는 채널 요약(닉네임) |
| 검색 — regex 폴백(tracks.py:405-418) | `artist_name`·닉네임 필드 매치 | DB 값이라 갱신하면 즉시 반영 |
| 검색 — ES(search_service.py:207 `artist` 필드) | 색인 시점 값 | **재색인 필요** — `index_track_es_in_background`(:714), `es_index_track`(:435) |
| 착장 탭·기획사 프로필 아티스트 명단(get_track `cover_character.name` :1605-1625, 앱 AgencyProfileScreen.tsx:87-91) | `mv_jobs.user_character_snapshot.name`이 1순위, 없으면 `tracks.user_character_snapshot.name` | 스냅샷 이름 |
| 곡 출처 표시(`source_meta.artist_name`) | 발매 시점 값 | PlayerScreen은 상단과 중복돼 제거됨(v3.156). 데이터는 남아 있음 |
| 좋아요 목록(likes.py:56)·플레이리스트(playlists.py:57)·피드 곡 블록(feeds.py:79, 프로젝션 :47)·앨범 곡(albums.py:70) | **닉네임만**(artist_name 미사용 — v236 통일 누락) | 개명과 무관하게 가수명 대신 기획사명이 나온다 |
| 앱 재생 큐·미니플레이어·미디어세션(playerStore 영속, playback.ts:54·502, MiniPlayer.tsx:122) | 큐에 저장된 트랙 객체의 `artist_name` | 서버를 갱신해도 **영속 큐 항목은 그대로** |
| 공유 영상(share_video.py) | 이름을 쓰지 않음(grep 0) | 해당 없음 |
| DM(dm.py) | 곡 이름 표기 필드 없음(grep 0) | 해당 없음 |

## 설계 결정 (자율 확정 — 근거 기록)

### V. 목소리
- **V1(앱, 확정)**: "참고 음원 세기" 질문(step 9)은 **참고 음원을 올린 경우에만** 묻는다.
  - 참고 음원이 없으면 step 8 다음은 BPM(10)이고, `audioWeight`는 null이다(미전송).
  - 근거: 참고 음원이 없을 때 이 값이 목소리 비중으로 새는 오배선(1-3)을 끊는다. 문구와 동작을 일치시킨다.
  - 되감기(v3.148) 매핑도 함께 고친다.
- **V2(서버, 확정 — 기본 무동작 스위치)**: suno_generator.py body 조립부(:184-198)에서 다음 두 조건을 모두 만족하면 `audioWeight = float(settings.suno_voice_audio_weight)`로 **덮어쓴다**.
  - 조건: `persona_model == 'voice_persona'`, **참고 음원 없음**(`not use_upload_cover`)
  - env `SUNO_VOICE_AUDIO_WEIGHT`, config 기본 None이다. **None이면 현행 그대로 통과**하므로 배포만으로는 동작이 바뀌지 않는다.
  - 값은 A/B 결과로 사용자 승인 후 env로 켠다(컨테이너 재생성 필요 — 사용자 실행).
  - 근거: 권장값이 문서에 없으므로 추측으로 박지 않는다. 구 APK(1.2.0)는 계속 step 9 값을 보내므로 서버 쪽에서 일관되게 통제해야 한다.
- **V3(서버 로그, 확정)**: 보이스 곡 추적자를 추가한다.
  - 제출 직전: `[suno][voice] gen_id=… model=… personaModel=… audioWeight_in=… audioWeight_sent=… styleWeight=… (override=on|off)`
  - SUCCESS 시: `[suno][voice] gen_id=… model_name=[…] echo_persona=bool echo_audioWeight=… secs=…`
  - `data.param` JSON을 파싱하고, personaId 값 자체는 로그에 쓰지 않는다(bool만).
- **V4(모델)**: V5/V5_5는 공급자가 Discontinued로 표기했다 → **복귀 불가**. V6_MINI·V6_WILD도 voice_persona를 지원하지만 문서 설명이 "경량·속도"와 "대담한 창작"이라 목소리 유사도 개선 근거가 없다. → **모델 변경은 하지 않는다**. A/B에서 V6가 audioWeight와 무관하게 목소리를 못 살리면, 공급자 문의(sunoapi 지원 — 사용자 몫)로 올린다.
- **A/B 검증 설계(사용자 결정 1 — 과금)**
  - **코드 변경 없이 현재 앱으로 가능하다.** 같은 목소리(새로 학습해 2시간 안), 같은 가사, 같은 장르·분위기로 작곡을 2회 한다.
    - (a) step 9 "건너뛰기" = audioWeight 미전송
    - (b) step 9 슬라이더 **1.0** "이대로 갈게요"
  - 각 ⭐15이고 공급자 크레딧이 들며 곡마다 2변형이 나온다. 사용자가 본인 목소리와 비교해 청취한다.
  - 결과별 조치
    - (b)가 확연히 낫다 → `SUNO_VOICE_AUDIO_WEIGHT=1.0`(또는 청취로 고른 값)으로 켠다.
    - 둘 다 비슷하게 약하다 → ⓐ로 확정하고 공급자에 문의한다.
    - (a)가 낫다 → V2를 끄고 V1만 유지한다(미전송).
  - 보조: V3 로그와 §1-5 에코로 두 요청의 파라미터 수신 여부를 대조한다.
  - 팀은 과금 테스트를 실행하지 않는다. 사용자가 실행하고, 팀은 로그와 DB로 판정만 한다.

### R. 디렉터 복귀 바로 가기
- **R1 순서(MapScreen.handleDirectorPress)**: 로그인 → **추적 작업(v3.228, 최우선·불변)** → **보존 draft 바로 가기(신규)** → 휴식 게이트(**새로 시작할 때만**) → 기존 `proceedDirectorPress`(선택 모달·Dialogue·새 흐름).
  - 바로 가기는 `tutorialVisible`이면 끈다. 튜토리얼 중에는 기존 흐름을 쓴다. TUTORIAL_STEPS와 앵커는 불변이다.
  - 로그 `[Map] resume-direct {director, route}`
- **R2 판정 단일화 — `utils/directorResume.ts`(신규)**
  - `getDirectorResumeTarget(type): {route, params} | null`
  - 각 화면의 마운트 판정을 **부작용 없는 순수 함수로 옮겨** 화면과 맵이 함께 쓴다. 판정 불일치로 빈 화면이 뜨는 것을 막는다.
    - 작사 `isLyricsDraftResumable()` — LyricsInputScreen.tsx:121 로직: `draftStep>0 && draftChat.length>0`. 요청서(`generatedPrompt`)가 있으면 기존대로 LyricsPromptReview가 우선이다.
    - 작곡 `getResumableComposeDraft()` — MusicGenerationScreen.tsx:126-132: lyricsKey 일치 + 사용자 답 존재. `computeComposeLyricsKey`(:103-113)를 utils로 옮겨 export한다. 대상 라우트는 **ComposerSelect**다. 가사 게이트 뒤 `replace('MusicGeneration')`(ComposerSelectScreen.tsx:70-83)를 기존 경로 그대로 탄다.
    - 영상 `getResumableVideoDraft()` — VideoDirectorScreen.tsx:190-197: 사용자 답 존재, `step∉{making,done}`.
    - 아티스트 `peekArtistDraft()` — ArtistInputScreen.tsx:215-236의 **읽기 전용** 판정: 사용자 답 존재. 폐기 부작용은 넣지 않는다. 대상 라우트는 `ArtistInput`이고 params는 `{characterId: draft.targetCharacterId ?? undefined, forceKind: draft.forceKind ?? undefined}`다. **키를 반드시 넘긴다.** 안 넘기면 키 불일치로 draft가 폐기된다.
    - 이미지: `coverMessages.length>0`(앨범 모드가 아닐 때) 또는 진행 중 생성. 라우트는 기존과 같다(CoverGeneration). 휴식 게이트만 건너뛴다.
- **R3 휴식 게이트**: 보존 draft가 있으면 맵 게이트를 건너뛴다. 이어서 진행하다 과금 버튼을 누르면 화면 안 게이트(2-2 목록)가 그대로 막는다. **과금 방어는 불변**이다.
- **R4 작사 선택 모달**: draft가 있고 `selectedByCategory.lyricist`가 이미 있으면 생략한다.
- **R5 작사 창작 모드 보존**: Dialogue를 건너뛰면 창작 모드 선택(DialogueScreen v3.200)을 볼 수 없다. 그런데 `musicStore.creationMode`는 메모리 전용이라 재시작하면 'standard'로 돌아간다.
  - → `lyricsStore`에 `draftCreationMode`를 추가해 영속하고, LyricsInput 미러링 때 기록한다. 복원 때 `musicStore.setCreationMode`로 되살린다.
  - 복원 안내 버블에 모드가 copyright이면 "저작권 등록 모드로 이어서 해요" 한 줄을 붙인다.
- **R6 이미지 '처음부터'**: CoverGeneration 복원(`hasResumableDialogue`)일 때 다른 디렉터와 같은 복원 안내 버블과 인라인 **'처음부터'**를 넣는다.
  - 누르면 `clearCoverContextStore()`(:79)와 로컬 상태를 초기화해 첫 인사부터 시작한다. 확인 다이얼로그는 showAlert이다.
  - 진행 중 생성·회수 진입일 때는 버튼을 숨긴다.
- **R7 맵 말풍선**: 슬롯 우선순위를 **추적 작업(만드는 중/완성) > "이어서 하기"(신규) > 다음 액션 "작업 시작"**으로 둔다(MapScreen.tsx:784-790). 튜토리얼 중에는 숨긴다(작업 말풍선 규칙과 같음). 휴식 티켓과는 병존한다.
- **R8 '처음부터'**: 작사·작곡·영상·아티스트는 이미 화면 안에 있다. 작사 LyricsInput 복원 버블, 작곡 배너(:2145), 영상 :1123·:433, 아티스트 :381·:1141이 해당한다. 새로 시작하려는 사용자는 **이어하기 화면 안에서 '처음부터'**를 누른다. 그 뒤 Dialogue 연출은 다음 새 시작 때 다시 본다.
- 뒤로 가기: 바로 가기로 들어오면 스택에 Dialogue가 없어서 뒤로 가면 맵이다. 지금은 Dialogue로 되돌아가므로 오히려 개선이다.
- 위험과 가드
  - (a) 작곡 draft가 생성 버튼 단계에 머문 경우: 1탭으로 생성 직전 화면에 도착한다. 과금은 guardGeneration(v3.228)과 휴식 게이트가 막으므로 새 위험은 아니다.
  - (b) 메모리 전용 draft(작곡·이미지·영상)는 재시작하면 없어서 자연히 기존 흐름을 탄다.
  - (c) 아티스트 draft가 재생성용(targetCharacterId≠null)일 때 해당 캐릭터가 삭제됐으면 ArtistInput의 기존 처리를 따른다. 구현 시 확인한다.

### N. 아티스트 이름 따라가기 (사용자 확정)
- **방식 비교 → 일괄 갱신(write-through) 채택**

| | 일괄 갱신(개명 시) | 조회 시 해석(character_id → 현재 이름) |
|---|---|---|
| 읽기 비용 | 0(기존 그대로) | 곡을 직렬화하는 모든 경로(tracks·charts·artists·likes·playlists·feeds·albums·search·get_track, 9곳 이상)에 characters 배치 조회 추가 |
| 검색(ES) | 대상 곡 재색인(보통 수~수십 곡) | **그래도 재색인이 필요**(ES `artist` 필드는 색인 값) — 이점 없음 |
| 캐시 | 대상 곡 상세 캐시 삭제. 차트는 5분 TTL로 자연 반영 | 캐시된 응답이 TTL 동안 옛 이름 — 결국 같음 |
| 일관성 위험 | 복사본 위치(tracks 3필드·mv_jobs 스냅샷)를 빠짐없이 갱신해야 함 → 같은 함수를 소급 스크립트로도 써서 **멱등 대사**로 보완 | 새 직렬화 경로가 생길 때마다 해석을 빠뜨릴 위험 |
| 변경 규모 | character.py PATCH 1곳 + 신규 서비스 1파일 | 9개 이상 파일 |

  → 개명은 드물고 읽기는 많으므로 **일괄 갱신**으로 한다.
- **N1 서버 신규 `app/services/artist_name_sync.py`**: `sync_artist_name(mongo, user_id, character_id, new_name) -> dict`. 멱등이다. PATCH와 소급 스크립트가 같이 쓴다.
  - `tracks.update_many({"uploader_id": uid, "character_id": cid, "artist_name": {"$ne": v}}, {"$set": {"artist_name": v}})`
    - `v = new_name or None`: 빈 이름이면 None이다. 직렬화가 기획사명으로 폴백한다(기존 계약).
  - 스냅샷 이름: `{"uploader_id": uid, "character_id": cid, "user_character_snapshot": {"$type": "object"}}`에 `$set {"user_character_snapshot.name": new_name or ""}`
    - **null 스냅샷에 점 경로 $set을 하면 오류가 나므로 `$type` 필터가 필수**다.
    - 착장·외형·나이·성격·시트는 **이력으로 유지**한다(불변).
  - 출처 이름: 같은 `$type` 필터로 `source_meta.artist_name`
  - MV 스냅샷: `mv_jobs.update_many({"user_id": uid, "character_id": cid, "user_character_snapshot": {"$type":"object"}}, {"$set": {"user_character_snapshot.name": …}})`
    - 필드명은 mv.py:707·:732-733 실측 기준이다. 구현 시 재확인한다.
  - 영향받은 곡 id마다 Redis `cache:track:{id}`·`cache:track:v4:{id}` 삭제, `index_track_es_in_background(id)`
  - 로그 `[ArtistRename] user=… cid=… tracks=N snap=N meta=N mv=N es_queued=N` — 이름 원문은 쓰지 않고 길이만 기록한다.
  - 전부 best-effort다. **실패해도 개명 PATCH 응답은 성공**이다(경고 로그만 남기고, 소급 스크립트가 복구 경로).
- **N2 character.py PATCH**: `"name" in set_fields`이고 **이전 이름과 다를 때만** update_one 뒤에 `await sync_artist_name(...)`을 호출한다.
  - 앱은 편집 저장 때 name을 항상 보내므로, 같으면 건너뛰어 불필요한 재색인을 막는다.
- **N3 직렬화 통일(가수명이 보이는 모든 곳)**: likes.py:56, playlists.py:57, feeds.py:79(+프로젝션 :47에 `artist_name: 1`), albums.py:70을 `doc.get("artist_name") or doc.get("uploader_nickname") or "AI"`로 바꾼다. tracks와 charts의 v236 규칙과 같다.
  - v236 통일 누락을 보정해 좋아요·플레이리스트·피드·앨범에서도 **현재 가수명**이 보이게 한다.
  - 응답 키는 불변이고 값만 바뀐다(가수명 우선).
- **N4 앱 영속 큐 반영**: `playerStore`에 `renameArtistInQueue(characterId, name)`을 추가한다. queue·savedQueues·currentTrack 중 `character_id` 일치 항목의 `artist_name`을 `name || uploader_nickname || 'AI'`로 바꾼다.
  - 현재 곡이면 미디어세션 메타데이터를 갱신한다(playback.ts:54 경로).
  - ArtistResultScreen `performSaveProfile` 성공 직후(:790-797) 호출한다.
  - `character_id`가 없는 큐 항목은 대상이 아니다. 다음 서버 조회 때 갱신된다.
- **N5 소급(사용자 승인됨 — 실행 전 목록 확인 절차 필수)**
  - 스크립트 `backfill_artist_names_v3229.py`(스테이징에 둔다. **기본 --dry-run**)
    - dry-run: `tracks`에서 `character_id`가 있는 곡마다 소유자의 characters(`user_id`+`character_id`)를 조회한다. `artist_name` / `user_character_snapshot.name` / `source_meta.artist_name` 중 하나라도 현재 이름과 다른 곡을 뽑는다.
    - dry-run 출력: `track_id, title, is_public, uploader(앞 8자), cid, old→new` 목록과 총계, 그리고 mv_jobs 대상 수
    - 캐릭터 문서가 없는 곡(삭제된 아티스트)은 **건너뛰고 동결 유지**한다. 목록에 "skip(char missing)"으로 표시한다.
  - 절차
    - ① 오케스트레이터가 dry-run 결과(건수·목록)를 PLAN/REPORT에 기록하고 확인한다. 공개 곡 수를 별도로 표기한다.
    - ② 사용자 1줄로 `--apply`를 실행한다. 내부는 N1 함수를 cid별로 호출하므로 멱등이다.
    - ③ 다시 dry-run해서 **0건**을 확인한다.
    - ④ 대표 곡 6ab552a2…의 상세·차트·검색("한겨울")에서 표기를 확인한다.
  - 프로덕션 쓰기이므로 팀은 실행하지 않는다. 사용자 승인은 받았고 실행 주체는 사용자 또는 오케스트레이터다(목록 확인 후).
- **N6 정책 리스크(기록만)**: 공개 곡의 가수명이 개명 즉시 차트·검색에 반영된다. 사칭이나 부적절한 이름으로 바꾸면 곡 전체에 퍼진다. 이번에는 차단하지 않는다.
  - 완화: `[ArtistRename]` 로그로 추적할 수 있다. 관리자 웹 신고·모더레이션 흐름은 현행대로다.
  - 후속 후보: 개명 빈도 제한, 금칙어, 관리자 이력 조회.
- 범위 밖(기록): 기획사명(닉네임) 변경도 `uploader_nickname` 동결 때문에 곡에 전파되지 않는다(auth.py:1232-1236은 탈퇴 때만 치환). 같은 방식으로 후속 처리할 수 있다.

## 변경 매트릭스·로그 추적자
| 영역 | 파일 | 변경 | 추적자 |
|---|---|---|---|
| 앱 | screens/MusicGenerationScreen.tsx | V1: step 9는 참고 음원이 있을 때만(`referenceData` 존재), 없으면 8→10. 되감기 매핑도 수정. `computeComposeLyricsKey`를 utils로 이동 | `[MusicGeneration] 참고음 세기 생략(참고 음원 없음)` |
| 앱 | utils/directorResume.ts(신규) | R2 판정 5종 + `getDirectorResumeTarget` | `[DirectorResume]` |
| 앱 | screens/MapScreen.tsx | R1 순서, R3 휴식 게이트 우회(draft 있을 때), R4 모달 생략, R7 "이어서 하기" 말풍선 | `[Map] resume-direct` |
| 앱 | screens/LyricsInputScreen.tsx · stores/lyricsStore.ts | R2 export, R5 `draftCreationMode` 영속·복원·버블 문구 | `[LyricsDraft] creationMode 복원` |
| 앱 | screens/VideoDirectorScreen.tsx · screens/ArtistInputScreen.tsx | R2 판정 함수 사용(동작 불변) | 기존 `[VideoDraft]`·`[ArtistDraft]` |
| 앱 | screens/CoverGenerationScreen.tsx | R6 복원 버블 + '처음부터' | `[CoverDraft] 처음부터` |
| 앱 | stores/playerStore.ts · screens/ArtistResultScreen.tsx · services/playback.ts | N4 큐 이름 반영 + 미디어세션 | `[Queue] artist rename n=` |
| 서버 | services/suno_generator.py | V2 보이스 audioWeight 스위치, V3 로그 | `[suno][voice]` |
| 서버 | config.py | `suno_voice_audio_weight: Optional[float] = None`(env SUNO_VOICE_AUDIO_WEIGHT) | 기동 로그 1줄 |
| 서버 | services/artist_name_sync.py(신규) · routes/character.py | N1·N2 | `[ArtistRename]` |
| 서버 | routes/likes.py · playlists.py · feeds.py · albums.py | N3 가수명 우선 | — |
| 서버(스크립트) | scripts/backfill_artist_names_v3229.py | N5 dry-run/apply | `[ArtistRenameBackfill]` |

## 분담 (team-dev 할당문)
- **frontend-dev A (디렉터 바로 가기)**: R1~R8. `utils/directorResume.ts`를 만들고 5개 화면의 판정을 이 함수로 바꾼다. 화면 동작은 불변이어야 한다(회귀 0).
  - MapScreen 순서는 로그인 → 추적 작업 → 바로 가기 → 휴식 게이트 → 기존이다. 튜토리얼 중에는 바로 가기를 끈다.
  - 작사 창작 모드를 영속하고, 이미지에 '처음부터'를 넣고, "이어서 하기" 말풍선을 추가한다.
  - 원칙: "작업이 끝날 때까지 이 화면을 벗어나지 마세요" 문구는 불변이고 이탈을 권장하는 문구는 넣지 않는다. 팝업은 showAlert, 이모지 금지(⭐ 예외), MAIDOL 표기.
- **frontend-dev B (목소리·이름)**: V1(step 9 조건화, 되감기 포함)과 N4(큐·미디어세션 이름 반영).
- **backend-dev (스테이징 전용 `/private/tmp/server_staging_v3229/`)**
  - `orig/`에 라이브 suno_generator.py·config.py·character.py·likes.py·playlists.py·feeds.py·albums.py·tracks.py(참조)·mv.py(참조)를 받고 `MD5SUMS.orig`를 만든다.
  - V2·V3, N1·N2·N3, N5 스크립트를 작성한다. `diffs/`·`tests/`(유닛: 스위치 None 통과·설정값 덮어쓰기·참고 음원이 있으면 미적용, sync의 null 스냅샷 안전·멱등·빈 이름 None, PATCH 이름 불변 시 sync 미호출)·`DEPLOY.md`(v3.228 형식)를 만든다.
  - **main.py는 건드리지 않는다**(신규 서비스 파일은 import만 하므로 라우터 등록이 필요 없다).
- **test-designer**: 아래 항목.

## 서버 스테이징·배포 절차 (v3.228 DEPLOY.md 관행)
0. 다른 세션이 서버를 자주 재배포한다. **배포 직전에** 대상 파일 7개를 다시 받아 `MD5SUMS.orig`와 대조한다. 다르면 새 현재본에 diffs를 다시 적용하고(`patch --dry-run` 먼저) 테스트를 재실행한다. 디렉터리 통째 scp와 main.py 반영은 금지한다.
1. 오케스트레이터 사전 점검(읽기 전용): md5, `test ! -e services/artist_name_sync.py`, 진행 중 작곡 0건(`generations` processing 중 point_ref 보유 0).
2. 사용자 1줄: `.bak_pre_v3229` 백업 + 원본 md5 가드 + scp + 반영 md5 확인.
3. 오케스트레이터: 로그 보존 1줄(사용자) → `sudo docker build -t maidol-app:latest .` → 이미지 안 md5 확인(main.py는 현재본 유지) → 컨테이너 재생성(v3.228 run 옵션과 로그 볼륨 `-v /home/ubuntu/maidol/logs:/srv/app/logs` 유지) → health 200.
   - `SUNO_VOICE_AUDIO_WEIGHT`는 **이번 배포에서 설정하지 않는다**(무동작). A/B 뒤 사용자 결정으로 .env에 추가하고 재생성한다.
4. 스모크(무과금)
   - health
   - `PATCH /character/{테스트 계정 cid}`로 이름 변경 → 로그 `[ArtistRename] tracks=N` → 그 곡 `GET /tracks/{id}` artist_name이 새 이름
   - 검색 regex 폴백과 ES에서 새 이름 매치(재색인 수 초 대기)
   - 같은 이름으로 PATCH하면 `[ArtistRename]` 없음
   - likes·playlists·feeds·albums 응답 artist_name이 가수명 우선
   - 보이스 경로는 로그 형식만 확인한다(실생성은 A/B에서)
5. N5 소급: dry-run 목록 기록·확인 → 사용자 `--apply` → 재 dry-run 0 → 대표 곡 확인.
6. 롤백: `.bak_pre_v3229` 원복 + 재빌드. 소급 데이터는 dry-run 출력의 old 값으로 역적용할 수 있다(출력 보존 필수).

## test-designer 항목
1. **[api] V2 스위치**(유닛·스테이징)
   - env 미설정이면 보이스 곡 body의 audioWeight가 앱 값 그대로다.
   - env=1.0이면 보이스+참고 음원 없음에서 1.0으로 덮어쓴다.
   - 참고 음원이 있거나 persona가 style_persona이거나 일반곡이면 미적용이다.
   - `[suno][voice]` 로그 2줄 형식을 확인하고, personaId 원문이 로그에 없어야 한다.
2. **[e2e] V1**(웹)
   - 참고 음원 없이 목소리 아티스트로 작곡 대화를 하면 "참고 음원의 세기" 질문이 **나오지 않고** 자유도 → 대중/실험 → BPM으로 간다.
   - 참고 음원을 올리면 질문이 나온다.
   - 되감기로 step 5(참고 음원)에서 업로드를 취소하면 step 9가 사라진다.
   - MusicLoading 전송 로그의 audio_weight가 undefined다.
   - 연주곡 흐름은 불변이다(v3.203).
3. **[DB·로그] §1-5 대조**(오케스트레이터 실행 결과 판정): 에코에 personaId·voice_persona 수신 여부, V5_5 대 V6 audioWeight·소요초 비교표를 REPORT에 싣는다.
4. **[사용자 A/B 가이드]**: 1-5 설계 그대로 (a)·(b) 2곡을 만든다. 팀은 로그로 두 요청의 audioWeight가 미전송 대 1.0인지만 확인하고 청취 판정은 사용자에게 맡긴다. **팀의 과금 실행은 0회**다.
5. **[e2e] 바로 가기 — 디렉터별 탭 수 1**(폰 웹 + APK)
   - 각 디렉터에서 사용자 답 1개 이상으로 진행 → 작업실(다른 탭) 이동 → 복귀 → 캐릭터 1탭 → **보존 화면이 바로 보인다**(Dialogue 없음).
     - 작사: 요청서 전 단계, 선택 모달 없음
     - 작곡: 같은 가사 대화, 가사 재선택 없음
     - 이미지
     - 영상: 선곡 뒤 스타일 단계
     - 아티스트: 보유 계정의 ＋추가 draft는 MyArtists·⭐ 고지 없이, 재생성 draft는 characterId 키 유지
   - draft가 없으면 기존 흐름(Dialogue 등)이 그대로다.
6. **[e2e] 우선순위**
   - 추적 작업이 "만드는 중"이면 진행 화면, "완성"이면 결과 화면이다. draft가 있어도 **작업이 먼저**다.
   - 말풍선 슬롯은 작업 > 이어서 하기 > 작업 시작 순이다.
   - 튜토리얼 중에는 바로 가기와 말풍선이 모두 꺼지고 앵커·TUTORIAL_STEPS는 불변이다.
7. **[e2e] 휴식 게이트**
   - 작사·작곡·이미지 휴식 중 + draft 있음 → 1탭에 보존 화면이 나온다(다이얼로그 없음).
   - 그 화면에서 과금 버튼을 누르면 **화면 안 휴식 다이얼로그**가 뜨고 요청 0건, ⭐ 불변이다.
   - draft가 없으면 맵 휴식 다이얼로그가 기존대로 뜬다.
8. **[e2e] '처음부터'**
   - 5개 디렉터 모두 복원 화면에서 '처음부터'를 누르면 새 대화로 간다. 이미지는 신규 버튼과 showAlert 확인이 뜬다.
   - 다음 복귀에서는 draft가 없으므로 Dialogue 흐름이다.
9. **[e2e] 작사 창작 모드**: 저작권 등록 모드로 작사 진행 → 앱(웹) 재시작 → 1탭 복귀 → 모드 유지(버블 문구) → 발매 track_type=copyright_ready.
10. **[api·e2e] 개명 따라가기**(테스트 계정)
    - 아티스트 곡 발매 → 이름 변경 → 다음 경로가 전부 새 이름이다.
      - 곡 상세(캐시 삭제 확인), 차트(≤5분), 검색(ES·regex) 새 이름 매치, 옛 이름은 매치 안 됨
      - 착장 탭·기획사 프로필 명단, 좋아요·플레이리스트·피드·앨범
      - 미니플레이어·재생 큐·미디어세션
    - 착장·외형 스냅샷은 불변이다.
    - 이름을 비우면 기획사명으로 폴백한다.
    - 같은 이름으로 저장하면 sync가 호출되지 않는다.
    - Inst. 파생곡도 따라간다.
11. **[데이터] 소급**: dry-run 목록 기록(건수·공개 곡 수) → apply → 재 dry-run 0 → 6ab552a2… "한겨울" 표기 확인. 캐릭터가 없는 곡은 skip으로 표시된다.
12. **[관찰 재현] 16:31:34 2번째 작곡 POST**
    - 작곡 시작 30초 뒤 같은 사용자가 새 request id로 POST를 보냈고, 서버 409로 **무과금 차단**됐다(v3.228 가드 정상 동작).
    - 앱 쪽 발생 경로(MusicLoading 재마운트, 웹 새로고침, 뒤로 간 뒤 재생성)를 재현해 확인한다. 앱 가드(guardGeneration)가 먼저 막아야 하는 경로라면 결함으로 보고한다.
13. **[회귀]**
    - v3.228 추적기 전체: 말풍선, 알림 1회, 409 편입, 회수
    - v3.219 draft 5종의 화면 안 복원
    - v3.202 커버 영속과 성공 시 클리어
    - v3.148 작곡 되감기
    - v3.143 목소리 미연결 아티스트 차단
    - v3.156 발매 스냅샷(착장)
    - v3.223 큐 보존
    - 피로 429 다이얼로그 전 지점
    - 정책 문구 grep: "나가 있어도|나가도 계속|나가서 다른"은 VoiceCloneWizard만 남아야 한다.

## 사용자 결정 사안 (기본안 — 지시가 없으면 기본안으로 진행)
1. **목소리 A/B 과금 테스트**
   - 기본안: 사용자가 직접 2곡을 만든다(⭐15×2 + 공급자 크레딧, 목소리가 없으면 학습 ⭐5). 팀은 실행하지 않는다.
   - 결과에 따라 `SUNO_VOICE_AUDIO_WEIGHT` 값을 켤지 결정한다(.env 추가와 컨테이너 재생성은 사용자 승인).
2. **문제 곡 ⭐15 환불 여부**: 기본안 = **환불하지 않는다**. 전달은 정상이었고 결함이 확정되지 않았기 때문이다. v3.148은 결함(V5 전송)이 확정돼 환불했다. A/B에서 ⓑ(오배선)가 확정되면 재검토한다.
3. **V6가 audioWeight와 무관하게 목소리를 약하게 반영할 경우**: 기본안 = sunoapi 지원에 문의한다(사용자 몫). 모델 되돌림은 불가(Discontinued).
4. **소급 실행**: 승인됨. 실행 전 dry-run 목록을 오케스트레이터가 확인하고, 실행은 사용자 1줄로 한다.
5. **기획사명(닉네임) 변경 전파**: 기본안 = 이번 범위 밖(기록). 원하면 같은 방식으로 후속 사이클에서 한다.
6. **step 7·8(자유도·대중/실험) 미전송 UI**: 기본안 = 이번 범위 밖(기록). 전송으로 연결할지 질문을 없앨지는 후속에서 결정한다.

규칙: 서버 수정은 server_staging_v3229에서만 한다(라이브 원본 pull + orig 보존 + 배포 직전 md5 재대조). 프로덕션 쓰기(scp·build·재생성·.env·소급 apply)는 사용자 승인·실행 뒤에 한다. main.py는 건드리지 않는다. 민감 정보는 플레이스홀더로 쓴다. 팝업은 showAlert, 표기는 MAIDOL, 이모지 금지(⭐ 예외), 이탈 권장 문구 금지, 과금 단정 금지. 코드 수정과 커밋은 이 계획이 승인된 뒤 team-dev 루프에서 한다.

---

# v3.230 (2026-09-25) — ① 아티스트 생성 중 뒤로가기 "별만 소모" ② 닉네임 변경 ③ 영상 디렉터 완료 후 결과 미표시 ④ 의상 필터 성별 오판 ⑤ ⭐ 소모 전 확인 팝업 누락 경로 ⑥ TOP100 선정 기준(멜론 대비) ⑦ 소셜 가입 추천코드 적립 안내

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD cded514, 앱 1.2.0 — 서버·웹·APK 모두 v3.228까지 반영, v3.229 서버 반영). 서버 = `<SSH_HOST>`(maidol-ec2) `/home/ubuntu/maidol/backend_9004/app`(git 아님, 이미지 베이크, 컨테이너 `maidol-app` 2026-09-24 23:26Z 재기동). 분석용 원본 = `/private/tmp/server_staging_v3230/orig/`(routes·services·models·config·database 다운로드, 서버 쓰기 0). DB 조회 스크립트 = `/private/tmp/server_staging_v3230/q*.py`(전부 읽기 전용 — find/count/aggregate/stat 만).
- 이번 세션은 컨테이너 내 Mongo·Postgres·Redis·MinIO **읽기 조회가 허용됐다**(v3.229와 달리). 출처 표기: [P]=planner 실측(코드 file:line / DB / 로그), [E]=planner가 띄운 Explore 서브에이전트 실측(핵심 줄은 [P]가 재확인한 것만 "확정"으로 씀).
- 로그 보존 범위: 컨테이너 로그는 2026-09-24 ~10시(UTC) 이후만 남아 있다(`maidol-app_pre_v3228_*.log` → `pre_v3229_*.log` → 현 컨테이너). 그 이전은 Mongo `point_events`·`character_jobs`·`frontend_errors`(앱 error 레벨 원격 로그)로 대신 추적했다.

사용자 요청 원문:
1. "캐릭터만들려고 별소모했는데 실수로 뒤로가기하니까 별만소모됐다."
2. "닉네임바꾸기 기능 추가"
3. "영상생성단계다했는데 안나옴경우 있음"
4. "아티스트 생성할때 앞에 여자캐릭터로 만든 이력이 있으면 현재들어간 얼굴이미지가 남자여도 의상필터가 여자로됨"
5. "별 소모되기 전에 팝업이 안뜨는 과정이 있는지"
6. "top100 선정 기준이 플레이수, 하트수 말고 다른게 있어? 내가 내 곡 다운로드 받는건 여기에 포함 안되어야해. 로컬에 멜론의 top100 선정방식이 있다고 하던데 이걸 참고해서 지금 잘 되어있는지 봐봐."
7. "구글이나 카카오로 가입했을때 추천코드로 별이 쌓이긴 하는데 넣는 칸이 없어서 쌓이는지 안쌓이는지 모르는 경우가 있을 것 같아서 추천코드로 가입해서 별을 받았다는 식으로 보여주면 좋겠어."

현재 서버 파일 md5([P] 2026-09-25 00:31Z, 배포 직전 재대조 기준 — 다른 세션이 main.py·admin_*·analytics 를 수시 변경하므로 main.py 는 수정 대상 아님. main.py 는 00:36Z 에 다른 세션이 이미 변경함 `78ab7074…`):
- routes/auth.py `931890e1317fd12305132d868d63d8cf`(mtime 09-24 04:20Z) · models/user.py `f127f33dfdd18f0eab8ba82a572c5be2`
- routes/charts.py `31f3d78b198b8d3b02f1e3b42d638603`(mtime 09-24 23:26Z) · routes/tracks.py `3623fba367916b6757cfd9d6dc2a8225`(mtime 09-24 23:26Z) · services/chart_recovery.py `66b59ffc2c09490ab67afd8eb583b356`
- (참고·무변경 예정) routes/character.py `a61f7865…` · routes/oauth.py `43f8d62e…` · routes/points.py `0d7bf5a4…` · services/points_service.py `3ad6a322…` · services/gen_jobs.py `d71d93c2…`

## 0단계 Plan verification findings

### 1. 아티스트 생성 ⭐ 소모 후 뒤로가기 → "별만 소모"

#### 1-1. 서버 실측 — 최근 10일 `spend:character` 9건 전수 대조 [P] (q1·q2·q3)
| 차감 시각(UTC) | user | job | 결과 | 소비(저장) |
|---|---|---|---|---|
| 09-23 12:36 | 18bd8131 | 6ab3c7b3… real | done 12:39:16 | 레거시 단일 doc(character_id 없음) `updated_at` 12:39:43 — 27초 뒤 저장(추정 확정) |
| 09-23 14:22 | c3202520 | 6ab3e0b2… cartoon | done 14:24:28 | 레거시 단일 doc 14:28:24 저장(추정 확정) |
| 09-24 06:21·06:24 | c19acda4 | 6ab4c16e·6ab4c22b | done | consumed save:create 09:10·09:26 (v3.227 원인 사건 — 이미 회수) |
| 09-24 06:35 | 2f85f76c | 6ab4c49c… | done 06:36:44 | 새 아티스트 06:36:45 생성(레거시 추적 전 job) |
| 09-24 06:55 | 2c6296a9 | 6ab4c969… | done 06:57:09 | 새 아티스트 06:57:09 생성 |
| 09-24 09:14 | c19acda4 | 6ab4e9f5… | done | consumed save:create |
| 09-24 13:23 · 16:29 | ea750ef6 | 6ab52444 · 6ab54feb | done | consumed save:create · save:update |
- 결론: **v3.227 배포 이후 "캐릭터 ⭐10 차감 → 결과 유실·미환불" 사례는 0건(확정)**. 모든 job 이 done 이고 저장까지 이어졌다. 실패 job 이 없어 환불 누락도 없다.

#### 1-2. "별만 소모"에 해당하는 실사례 — 슬롯 확장(⭐15) 후 생성 미완 [P]
- **2f85f76c(구글 가입, 본인인증 없음)**: 09-24 08:59:51 `spend:extra_slot −15`(user_slots.extra_slots=1) → 09:03:25·14:08:25 `generate-sheet-async` **403 face_verification_required**(frontend_errors + 컨테이너 로그 `[face-verify] gate user=2f85f76c verified=False` → `status … verified=False consent=False`) → 얼굴 인증 기록 없음(Postgres `face_photo_verifications` 0행) → 두 번째 아티스트 0. 로그상 이후 `[ArtistV212] list … slots=1/2` — **슬롯은 남아 있다**(⭐은 영구 슬롯으로 전환됨, 사용자는 "별만 나갔다"고 인식할 수 있는 상태).
  - 원인 경로(확정): 실사 사진 아티스트는 서버가 **과금 전** 403으로 막고, 앱은 FaceVerify 로 `replace` 한다(ArtistLoadingScreen.tsx:522-528). 본인인증(is_verified) 미완 계정은 `need_identity` 단계(FaceVerifyScreen.tsx:110-117)에서 막히고, 닫으면 `failApi('얼굴 인증이 필요해 생성을 중단했어요…')` 후 goBack(:236-244). **사진·질문·꾸미기를 다 끝낸 뒤에야** 본인인증 필요 사실을 알게 된다.
- 18bd8131: 09-23 12:33:16 `extra_slot −15` 직후 12:33:18 generate 409 → 12:35:23 403 → 12:35:58 얼굴 인증 → 12:36:03 생성(레거시 doc 갱신). 레거시 doc 은 시트 2개가 슬롯 2로 환산돼(slots_service.py:22-37) 확장 후에도 2/2일 수 있다 → 409 가 slot_limit 였는지는 로그 소실로 **미확정**(추정).

#### 1-3. 앱 코드 — 생성 요청·이탈 동작 [P 재확인]
- 요청 시점: ArtistCody "이 옷으로 만들기" → 스택 `[Map, ArtistLoading]` reset(ArtistCodyScreen.tsx:697-711) → **ArtistLoading 마운트 effect 안에서** 사진/blob 준비·`/character/me`·능력 확인 후 POST(ArtistLoadingScreen.tsx:216-585, POST :308).
- 이탈 처리: 앱 전체에 `BackHandler`·`beforeRemove`·`popstate` 처리 **없음**([E], grep 재확인). Android 하드웨어 back·웹 브라우저 back·Studio 탭 재탭이 모두 화면을 즉시 pop 한다. AbortController 없음 — 언마운트는 `cancelled=true`만(:583).
- 추적 등록: job_id 수신 직후 **cancelled 여부와 무관하게** `registerArtistJob`(:316, outfit :402) → AsyncStorage `maibol-generation-jobs-v1` 영속 → 전역 추적기가 폴링·도착 알림(v3.227). 즉 **POST 이후 뒤로가기는 결과가 살아남는다**(확정).
- 남은 틈(확정):
  - (a) **준비 단계(POST 전) 이탈** — 이미 화면을 떠났는데도 POST 가 나가 ⭐10이 차감된다(사용자 인지 밖 과금). 결과는 추적기로 오지만 "뒤로 갔는데 별이 빠졌다"로 보인다.
  - (b) 진행 화면 문구는 "작업이 끝날 때까지 이 화면을 벗어나지 마세요"(:661·:678, 사용자 결정 ea39dac 유지)인데, 실수로 뒤로가기 했을 때 **아무 안내도 없다** → 사용자는 "별만 나갔다"고 판단한다.
  - (c) 실사 아티스트 본인인증 요구를 입력 **마지막**에야 알린다(1-2).
  - (d) 슬롯 확장 직후 생성을 못 끝내면 "빈 슬롯이 남아 있다"는 안내가 없다(MyArtistsScreen.tsx:295-330, 확장 확인 문구에 "영구 확장"만).
- 부수(같은 계열, 확정): **MusicLoadingScreen.tsx:341 `if (!isMounted) return;` 이 `registerGenJob`(:351)보다 앞** — 작곡 POST 응답 전에 화면을 떠나면 로컬 추적 등록이 빠진다(서버 원장·다음 기동 회수로만 복구). 작사(LyricsLoadingScreen.tsx:164)·커버(:846)·영상(:828)은 POST 전 등록이라 문제없음.

#### 1-4. v3.227 추적기가 왜 "못 살렸나"
- 서버 대조상 v3.227 이후 캐릭터 결과 유실은 없다 → 추적기는 **살렸다**. 사용자가 본 "별만 소모"는 ① 슬롯 확장 ⭐15 후 403·이탈(1-2, 슬롯은 보존) 또는 ② 이탈 직후 안내 부재로 결과 도착 전 "손실"로 판단한 경우(1-3 b)로 본다(추정 — 제보자·시각 미특정).

### 2. 닉네임 변경 [P]
- 앱: 설정의 "닉네임 변경" 행은 "준비 중인 기능입니다" 스텁(SettingsScreen.tsx:519-525). `ProfilePatch`(stores/authStore.ts:26-35)에 nickname 없음. `updateProfile` = PATCH `/auth/me/profile`(authStore.ts:127-150). 닉네임은 `useAuthStore.user` 에만 있고(비영속, /auth/me 로 재구성), 표시처: SettingsScreen.tsx:486·492·500·503·762(기본 기획사명 :168), MyMusicScreen.tsx:629·679-680, components/common/TrackComments.tsx:171 [E].
- 서버: `PATCH /api/auth/me/profile`(routes/auth.py:584-700)은 존재하나 `ProfileUpdate`(models/user.py:204-212)에 **nickname 필드 없음** → 보내도 조용히 무시된다(pydantic 기본 ignore).
- 규칙 현황: 가입 시 예약 닉네임(maidol_official)만 차단(auth.py:156, services/official.py:100-107). **길이·중복 검사 없음**, Postgres `users.nickname` 에 유니크 인덱스 없음(pg_indexes 실측), 현재 중복 닉네임 1그룹 존재, 길이 분포 2~15자.
- 세션: `get_current_user` 는 Redis `session:{user_id}` JSON(닉네임 포함)을 current_user 로 쓴다(app/auth.py:58-67). 업로드·피드·댓글은 `current_user.get("nickname")` 을 **복사 저장**(feeds.py:329·861, tracks.py:2940 등) → 변경 시 **세션 갱신 필수**.
- 비정규화 사본(Mongo 실측 건수): tracks.uploader_nickname 34 · feeds.author_nickname 4 · 댓글 author_nickname 2 · notifications.actor_nickname 78. 차트·곡 직렬화의 `agency_name`/`artist_name` 폴백이 uploader_nickname(charts.py:53-56) → 곡 표기에 직접 노출된다. ES `artist` 필드도 uploader_nickname 포함(search_service.py:207).
- 참고 패턴: 탈퇴 시 닉네임 치환(auth.py:1186-1240 — PG + tracks.uploader_nickname), v3.229 `services/artist_name_sync.py`(write-through·캐시 삭제·ES 백그라운드 재색인·멱등).
- 문서 `2_housing/백엔드_요청_프로필수정.md`(04-27, 우선순위 낮음): nickname 2~20자·`409 nickname_taken` 제안 — 미구현.

### 3. 영상 디렉터 단계 완료 후 영상 미표시 [P]
- 실사례(확정): **2f85f76c 09-24 07:00:28** `spend:share_video −5`(sns·center·circle·line·색 배경 조합) → MinIO `share/v8/6ab4c6d9…_c54410f3.mp4` **07:02:47 생성 완료(5.9MB, 존재 확인)** → 앱 `frontend_errors` 07:03:32 `[VideoDirector] share-video 실패 … Network Error`(응답 유실) → 07:04:11 재시도 **429**(완성 시 video 디렉터 피로가 적립돼 쿨다운) → 사용자는 영상을 한 번도 못 봄. v3.228 잔액 대사에서 같은 계정 정황이 이미 기록됨(REPORT.md:3090-3095).
- 같은 계열 과거 사례: c19acda4 09-22 09:24 Network Error, 09-23 04:29·04:35·04:50(timeout 300s) — 09-23 3건은 ffmpeg 300s 초과 실패로 **환불 완료**(point_events refund:share_video 3건). v3.215 에서 ffmpeg 600s·정적 사전 합성으로 해소.
- 현행(v3.228, 09-24 16:00Z 배포 이후): POST 전 `X-Gen-Request-Id` 원장 등록(VideoDirectorScreen.tsx:820-828) → 응답 없음·게이트웨이 오류는 "확인 중"으로 두고 원장·파일 조회로 회수(:870-893, `VIDEO_VERIFY_WINDOW_MS` 11분 :99, 추적기 cap 25분 services/genJobs/video.ts:13). **v3.228 이후 영상 생성 0건**(gen_jobs kind=video 0, 로그 POST 1건=09-24 12:44 성공) → 현행 경로의 실전 검증은 아직 없다.
- 남은 틈:
  - (a) **이미 완성됐지만 못 본 영상(07:00 건)** 은 현재 앱에서 다시 열 길이 없다. 같은 조합을 다시 요청하면 캐시 히트(무과금)지만 사용자는 조합을 기억 못 한다. 서버 보관함 API `GET /api/tracks/my/share-videos`·object 프록시(tracks.py:3025-3097)는 살아 있으나 **v3.187 대표 결정으로 앱 보관함 제거**(VideoDirectorScreen.tsx:5).
  - (b) nginx `proxy_read_timeout 320s` < ffmpeg 상한 600s + heavy 슬롯 대기(무제한) — 긴 곡·동시 인코딩 시 응답 유실은 구조적으로 계속 생긴다(현행은 회수 경로로 흡수).
  - (c) 구앱(1.2.0 미만) 사용자는 v3.228 회수 경로가 없다(업데이트 외 해법 없음 — 기록).
  - (d) 완성 시점에 피로가 적립되므로, 응답을 못 받은 사용자의 "재시도"는 429 로 막힌다(구앱 한정 — 현행은 확인 중 상태로 재시도 자체를 막음).

### 4. 의상 필터 성별 오판 [P 재확인]
- 필터 성별 결정식(ArtistCodyScreen.tsx:187-191): `serverGender ?? apiResult.gender ?? pendingGender ?? profileGender`.
- `serverGender` 는 진입 시 `listArtists()` 에서 **대상 아티스트가 없으면(신규 생성) "현재 kind 의 기본 아티스트 → 성별 있는 아티스트 → 아무 기본 → 아무나"** 를 골라 그 성별을 쓴다(:200-228). 신규 생성은 `targetCharacterId=null`(ArtistInputScreen.tsx:459)이라 **기존(예: 여자) 아티스트 성별이 1순위로 박힌다**. 사용자가 방금 답한 성별(`pendingGender`, ArtistInputScreen.tsx:830-834)은 무시된다 → **원인 확정**.
- `apiResult.gender` 는 항상 비어 있는 죽은 폴백(characterTaskStore.ts:39-42). `profileGender`(AsyncStorage `aidol-artist-profile`, 슬롯별)도 이전 값 잔존 가능.
- 얼굴 사진으로 성별을 판별하는 코드는 **없다**(서버·앱 모두). "얼굴이 남자여도"는 사진이 아니라 **성별 질문 답/기존 아티스트**가 필터를 정한다는 뜻.
- 사용자가 바꿀 수단: 필터 켜기/끄기만("◯◯용만"↔"전체 보기", components/cody/CodyFilterBar.tsx:149-160), 남/여 전환 불가. 피커 열 때마다 ON 복귀(:244·:269). 적용 대상 상의/하의/신발(utils/codyCatalog.ts:20), 판정 `genderMatches`(:51-57), `normalizeArtistGender` 는 '남…/여…'로 시작할 때만 인식(:62-68).

### 5. ⭐ 소모 전 확인 팝업 누락 경로 [E 전수 + P 재확인·DB 증거]
서버 차감 지점(전수, grep `spend_points(`): character.py:897·1135·1792·2066(character 10) · generate.py:669(lyrics 5)·811·1015(compose 15) · upload.py:425·albums.py:695(cover 5) · upload.py:1120(cover_refine 5) · tracks.py:2616(share_video 5)·3286(instrumental 5) · voice_clone.py:232(voice_clone 5) · fatigue.py:165(skip 2/3/5) · points.py:43(/spend: hire_director 10·extra_slot 15) · admin_points.py:320(관리자).

| # | 기능(⭐) | 트리거 | 차감 호출 | 차감 직전 확인 | 누락·우회 경로 |
|---|---|---|---|---|---|
| 1 | 새 아티스트(10) | ArtistCody "이 옷으로 만들기 ⭐N"(:442·:958) | ArtistLoading :308 | **부분** — MyArtists "＋추가" 진입 때만 ConfirmDialog(MyArtistsScreen.tsx:506-512) | **첫 아티스트**(Map→Dialogue→ArtistInput, DialogueScreen.tsx:184·MapScreen.tsx:817-827), 초안 이어하기(directorResume.ts:130-140), "이어서 만들기"(ArtistInput :899-903), 빈 상태 버튼(ArtistResult :833), **FaceVerify 완료 "확인" → 즉시 재요청**(FaceVerifyScreen.tsx:68-69) |
| 2 | 아티스트 다시 만들기(10) | ArtistResult :665 | 동일 | 있음(:1236-1243·:1246-1260) | — |
| 3 | 옷 갈아입히기(10) | ArtistResult :580-608 → Cody | ArtistLoading :395 | **없음**(버튼 라벨만) | 항상 |
| 4 | 슬롯 확장(15) | MyArtists :306·:321 | characterService.ts:175 | 있음(:518-521) | ArtistLoading :539-545·generationTracker.ts:470-476 은 "⭐15로 확장" 하드코딩 |
| 5 | 작사(5) | LyricsPromptReview :299, 다시 생성 LyricsResult :249 | LyricsLoading :180 | **없음**(비용 표기도 없음) | 항상 |
| 6 | 작곡(15) | MusicGeneration :1432 | MusicLoading :336 | **없음**(비용 표기 없음) | 항상 |
| 7 | Inst(5) | MyMusic 메뉴 | MyMusic :481 | 있음(:467-477) | 비용 하드코딩(trackService.ts:158) |
| 8 | 커버 생성(5) | CoverGeneration :2499·:2513·:2520 | :266 | **없음** | 스타일 답 재편집(:1478) |
| 9 | 커버 미세조정(5) | :2216·:2220 | :1875 | **조건부**(:1848-1856, refineCost 숫자일 때만) | /points/costs 실패·로딩 중이면 무확인 차감(:491-502) |
| 10 | 영상(5) | VideoDirector :1358 | :837 | **조건부**(:798-806) | videoCost 미수신 시 무확인 |
| 11 | 보이스(5) | VoiceCloneWizard :715 | :461 | **조건부**(:441-448) | 비용 미수신 시 무확인(구서버 폴백 :451) |
| 12 | 유료 디렉터 영입(10) | DirectorLineup :128 | :76 `/points/spend` | **없음**, 연타 가드 없음 | 항상(실사용 0건 — point_events hire 0) |
| 13 | 휴식 단축(2~5) | fatigueGate.ts:155-156 버튼 | fatigueService.ts:73 | 버튼 자체가 확인 | 아래 연쇄 |
- **연쇄 과금(확정, DB 증거)**: 휴식 단축 후 "휴식 종료 → 확인" 또는 409(이미 해제)가 `onCleared` 를 부르고(fatigueGate.ts:69-81), 호출 화면은 **확인 없이 곧바로 생성 요청**을 보낸다(MusicLoading :404-407, LyricsLoading :250-253, CoverGeneration :739-743·:1688, MusicGeneration :1419, LyricsPromptReview :93, LyricsResult :139). Mongo 실측: 마지막 휴식 단축 후 **3초 이내 생성 차감 8건**(cover 3·character 2·lyrics 1·compose 1·instrumental 1; 예 2f85f76c 09-24 09:16:26 skip → 09:16:27 compose −15).
- **휴식 단축 연타(확정)**: 단축 후 같은 다이얼로그가 같은 위치 버튼으로 즉시 재표시(fatigueGate.ts:69-73) → 15초 안 3회 이상 연속 단축 **12묶음**, 최대 8회 3.5초에 ⭐40(2f85f76c 09-24 09:16:22). `fatigue_skip` 은 전체 차감 이벤트 1위(66건·⭐182).
- 하드코딩 비용(드리프트 위험): ArtistLoading :534-551·:564, generationTracker.ts:469-481, trackService.ts:158, DirectorLineup :80, "재학습 ⭐5"(MusicGeneration :1004·:1565, VoiceCloneWizard :822).
- 웹/네이티브 차이·"다시 묻지 않기" 플래그: 없음.

### 6. TOP100 선정 기준 — 멜론 자료 대비 [P]
- 자료: `/Users/pearl/TripleJ/0_platform_music/melonChart.md`(2026-04-07 조사) — 순 청취자(1인 1회)·다운로드 순이용자(최초 1회, 재다운로드 제외), 음원점수 = 스트리밍×0.4 + 다운로드×0.6, TOP100 주간 = 24h×50% + 1h×50%, 심야(01~07) = 24h×100%, 음소거·스킵·일시정지 제외, 신곡 부스트·구곡 감쇠 없음.
- 현행 산정(charts.py:1-13·:415-473) — **재생수(play_count)·하트(좋아요)는 순위에 쓰지 않는다**:
  - 점수 = (로그인 사용자 순 청취자 수)×0.4 + (순 다운로더 수)×0.6. 주간 08~24시 = "24h"×0.5 + 1h×0.5, 01~07시 = "24h"만.
  - 순 청취자 = `/charts/record-play` 에서 로그인 사용자만 Redis 셋 `chart:listeners:{hourly|daily|weekly|monthly}:…` 에 SADD(charts.py:183-288). 앱은 곡의 **70% 재생 도달 시 세션당 1회** 기록(services/playRecord.ts:62-112). v3.229 에서 30초 재호출 중복 방지 추가(:147-181). 비로그인 재생은 play_count 만 올리고 차트 제외.
  - 순 다운로더 = `POST /tracks/download/{id}` 에서 SADD(tracks.py:2335-2424) — 기간별 1인 1회.
  - 차트 데이터가 비면 **총 재생수(play_count, 비로그인·본인 포함) 순 폴백**(charts.py:435-437·:537-538·:558-563).
  - 비공개 곡은 응답 단계에서 제외(:120).
- **"내 곡 다운로드 제외" 요구 — 미충족(확정)**: download_track 은 업로더 본인 여부를 보지 않고 차트 셋에 넣는다(tracks.py:2352-2389). 게다가 앱에서 다운로드 진입점은 **내 곡(MyMusic)뿐**(MyMusicScreen.tsx:314·:550, TrackShareDownloadSheet.tsx:77) → 가중치 60% 인 다운로드 성분은 구조상 **100% 본인 다운로드**로만 채워진다. (실측: 30일 download_logs 1건 — 영향은 아직 작음)
- 본인 재생: 역시 제외 없음. 30일 play_logs 155건 중 **본인 곡 재생 65건(42%)**, 5명.
- 기타 갭:
  - "24h" 가 **롤링 24시간이 아니라 KST 달력 일(00:00 리셋)**(`_time_keys` daily=YYYYMMDD, charts.py:68-77). 자정 직후·심야(01~07, 24h만 사용)엔 당일 0시 이후 데이터만 남아 순위가 비거나 폴백(총 재생수)으로 급변한다. 시간 셋 TTL 2h(:243)라 롤링 계산 불가.
  - 동점 처리 없음(Redis set 순서) — 소규모 데이터에서 0.4점 동점 다수 → 순위가 요청마다 흔들릴 수 있다(오늘 일간 실측: 상위 15곡 중 14곡이 0.4점 동점).
  - 음소거 재생 제외·기기/IP 이상 탐지·본인인증 가입 강제는 없음(본인인증은 스토어 일정 연동 — 범위 밖 기록).
  - 멜론 대비 이미 충족: 1인 1회(기간별 셋), 0.4/0.6, 50:50, 심야 24h, 로그인만 집계, 30일 HOT100.

### 7. 소셜 가입 추천코드 적립 안내 [P + E]
- 서버(동작 확정): 초대 링크 → `app.maidol.ai.kr?ref=CODE`(referral.py:100-126) → 앱 `SocialLoginButtons` 가 `ref=` 를 `/api/auth/oauth/{provider}/login` 에 부착 → state 에 동봉(oauth.py:77-80·:147) → 콜백 신규 가입 시 `signup_bonus 50`·`beta_signup_bonus 50`·유효 코드면 `referred_by` 기록 + `referral_inviter 50`/`referral_joiner 50`(oauth.py:208-243). 리다이렉트는 `#token=` 만 전달(:262-265) — **가입 여부·추천 적용 결과를 앱에 알리지 않는다**.
- 실측: 09-24 05:36 이후 소셜 가입 11건 **전원 referred + referral_joiner ⭐50 적립**(q12). 적립은 정상, "보이지 않는 것"이 문제(확정).
- 이메일 가입: 폼에 "추천코드 (선택)"(components/auth/AuthPanel.tsx:572-580, 미성년 숨김), 응답 `referral.applied`(auth.py:307-310) — 앱은 이 값을 **쓰지 않는다**(authStore.ts:108-115 → 차트 탭 이동만).
- 앱: `?ref=` 는 AuthPanel 모듈 로드 시 1회 읽어 폼 기본값으로만 씀(AuthPanel.tsx:40-49·:90) — **저장 안 함**(새로고침·재방문 시 유실). 로그인 모드 소셜 버튼에는 코드 입력칸 없음(:350). 네이티브 초대 딥링크 없음(App.tsx:581-590). 가입 후 안내 팝업·알림 없음. **⭐ 내역 화면 없음**(pointsStore 잔액만; genJobs/index.ts:114·120 오류 문구가 존재하지 않는 "별 사용 내역"을 안내). 서버 `GET /api/points/history`(points.py:90-110)는 있음 — action·amount·created_at 반환.

## 항목별 원인/갭 요약
| # | 판정 | 원인 |
|---|---|---|
| 1 | v3.227 이후 캐릭터 결과 유실 0건(확정). 제보 사례는 슬롯 ⭐15 후 본인인증 403·이탈(확정 1건) 또는 이탈 무안내로 인한 손실 오인(추정) | POST 전 이탈해도 과금 진행, 뒤로가기 무안내, 본인인증 요구를 입력 마지막에 알림, 빈 슬롯 안내 없음 |
| 2 | 기능 없음(확정) | ProfileUpdate 에 nickname 없음, 앱 스텁, 사본 5종 전파·세션 갱신 필요 |
| 3 | 09-24 07:00 응답 유실 + 재시도 429(확정, v3.228 이전). 현행은 회수 경로 존재·실전 미검증 | 완성됐지만 못 본 영상 재열람 길 없음, nginx 320s < 인코딩 상한 |
| 4 | 확정 | 신규 생성에서도 기존 아티스트 성별이 1순위, 사용자 답 무시, 남/여 전환 불가 |
| 5 | 누락 6경로 + 조건부 3 + 연쇄 7지점(확정, DB 증거) | 화면별 개별 구현, fail-open, 휴식 단축 onCleared 가 확인 없이 생성 |
| 6 | 본인 다운로드 포함(확정), 본인 재생 포함, 24h 가 달력 일 | download/record-play 에 소유자 판정 없음, `_time_keys` daily |
| 7 | 적립 정상·안내 부재(확정) | 콜백이 결과를 안 넘김, 앱이 register 응답·history 를 안 씀, ref 비영속 |

## 변경 매트릭스
### 서버 (staging `/private/tmp/server_staging_v3230/` — orig 보존, 수정본 `new/`, main.py 무변경)
| ID | 파일 | 변경 | 로그 prefix |
|---|---|---|---|
| S1 | models/user.py | `ProfileUpdate.nickname: Optional[str] = Field(None, max_length=30)` | — |
| S1 | routes/auth.py `update_profile` | nickname 전달 시: strip → 길이(기본 2~15) → 제어문자·앞뒤공백·연속공백 정리 → `is_reserved_nickname` → 중복(`lower(trim(nickname))`, 본인·탈퇴 제외) 409 `{"error":"nickname_taken"}` / 400 `{"error":"nickname_invalid","message":…}` → UPDATE 후 **Redis `session:{uid}` 의 nickname 갱신**(TTL 유지) → `nickname_sync.sync_user_nickname()` 호출. 응답에 `nickname_synced` 요약(건수). 값 원문 로그 금지(길이만) | `[NicknameChange]` |
| S1 | services/nickname_sync.py(신규) | artist_name_sync 패턴 복제: `tracks.uploader_nickname`(uploader_id) · `feeds.author_nickname`(author_id) · 피드/곡 댓글 `author_nickname`(author_id — 컬렉션명 backend-dev 확인) update_many(필터 "이미 새 이름 아닌 것" 멱등) · 영향 곡 `cache:track:*`·`cache:chart:*` 삭제 · ES `artist` 재색인(background) · notifications.actor_nickname 은 기본 유지(결정 D3). never raise, errors 단계명만 | `[NicknameSync]` |
| S2 | routes/tracks.py `download_track` | `uploader_id == user_id` 이면 차트 셋(SADD) **생략**, download_logs 에 `is_owner: true` 기록, download_count 는 현행 유지(결정 D5) | `[ChartOwnerExclude] download` |
| S2 | routes/charts.py `record_play` | (결정 D5 기본=적용) 소유자 재생은 listener 셋 생략(play_count·play_logs·포인트는 현행). 소유자 조회는 `tracks.find_one({_id},{uploader_id})` 1회(+ Redis `track:owner:{id}` 1h 캐시 선택) | `[ChartOwnerExclude] play` |
| S2 | routes/charts.py `_calc_top100` 등 | (D5) 롤링 24h: hourly 셋 TTL 2h→26h, 24h 순 청취자 = 최근 24개 hourly 셋 SUNION 카디널리티(다운로드 동일). 동점 정렬 = score → listeners_1h → listeners_24h → track_id(결정적). 빈 차트 폴백 = weekly 점수 → 그래도 없으면 play_count(현행) | `[ChartCalc]` |
| S2 | services/chart_recovery.py | 재구성 시 소유자 이벤트 제외(`is_owner` 또는 uploader 조회), hourly 24개 재구성(롤링 채택 시) | `[ChartRecovery]` |
- 서버 변경 없음: 항목 1·3·4·5·7(앱만으로 해결 — 3은 기존 `GET /tracks/my/share-videos`·object 프록시 재사용, 7은 기존 `GET /points/history` 재사용).
- 금지 준수: main.py·admin_*·analytics 무변경. 새 라우터 파일 없음(main.py include 불요).

### 앱 (2_housing)
| ID | 파일 | 변경 | 추적자 |
|---|---|---|---|
| A1-1 | hooks/useGenerationLeaveGuard.ts(신규) + ArtistLoadingScreen.tsx (+ MusicLoading·LyricsLoading·InstLoading — D1) | 진행 중 `beforeRemove`(헤더·탭·웹 브라우저 back 포함) + Android `BackHandler` 가로채기 → showAlert("아직 만드는 중이에요", "나가도 만들던 결과는 완성되면 작업실에서 알려드려요.", [계속 기다리기 / 나가기]). 원칙 문구 "작업이 끝날 때까지 이 화면을 벗어나지 마세요"는 유지(이탈 권장 문구·버튼 추가 금지 — 가드는 사용자가 이미 나가려 할 때만) | `[LeaveGuard]` |
| A1-2 | ArtistLoadingScreen.tsx | POST 직전(:308 앞) `cancelled` 재확인 → 이미 떠났으면 **요청 안 보냄**(무과금) + 초안 보존(failApi 문구 "시작 전에 나가서 만들지 않았어요. ⭐은 쓰이지 않았어요"). outfit(:395)도 동일 | `[ArtistLoading]` |
| A1-3 | ArtistInputScreen.tsx(실사 사진 선택 직후) · MyArtistsScreen.tsx(슬롯 확장 확인) | `face-verify/status` 로 본인인증 미완이면 사진 단계에서 즉시 showAlert(실사는 본인인증 필요·가상 아티스트는 바로 가능). 슬롯 확장 성공 문구에 "빈 슬롯은 계속 남아 있어요" 추가, MyArtists 에 "빈 슬롯 N개" 표시 | `[ArtistInput]` `[MyArtists]` |
| A1-4 | MusicLoadingScreen.tsx | `registerGenJob` 을 `if (!isMounted) return` 앞(또는 POST 전 rid 로 선등록)으로 이동 | `[GenJob:music]` |
| A2 | stores/authStore.ts, screens/SettingsScreen.tsx, components/settings/NicknameEditModal.tsx(신규) | ProfilePatch.nickname 추가, 스텁 행 → 앱 내 모달(현재값·글자수 카운터·규칙 안내), 409 "이미 쓰는 닉네임이에요"/400 메시지 매핑, 성공 시 user 갱신 + showAlert("닉네임을 바꿨어요", "내 곡·피드·댓글 표기도 새 닉네임으로 바뀌어요.") | `[NicknameChange]` |
| A3 | VideoDirectorScreen.tsx (+ services/trackService.ts 조회 함수) | 곡 선택 직후 `GET /tracks/my/share-videos` 중 그 곡 항목이 있으면 "지난번 만든 영상 보기(무료)" 칩 → object 프록시 URL 로 결과 화면(showVideoDone) — 보관함 탭 재도입 아님(D9). v3.228 회수 경로는 유지 | `[VideoDirector] 지난 영상` |
| A4 | ArtistCodyScreen.tsx, components/cody/CodyFilterBar.tsx, utils/codyCatalog.ts | 신규 생성(`isSheetMode && !targetCharacterId`)은 `pendingGender` 만 사용(서버·프로필 폴백 제거), 대상 아티스트가 있을 때만 서버 성별. 필터 바에 남/여/전체 전환 칩, 답 없음=전체. `normalizeArtistGender` 에 소년/소녀·male/female·boy/girl 등 추가. 죽은 `apiResult.gender` 폴백 제거 | `[ArtistCody] 성별 필터` |
| A5-1 | utils/starSpendConfirm.ts(신규) + services/pointCosts.ts(신규 — `/points/costs` 캐시·폴백 표) | `confirmStarSpend({title, cost, balance})` → showAlert([취소]/[⭐N 사용하기]), 비용 미수신이면 폴백 표로 **반드시 확인**(fail-closed) | `[StarConfirm]` |
| A5-2 | ArtistCodyScreen(시트·옷 갈아입히기 공통 "이 옷으로 만들기"), LyricsPromptReview·LyricsResult(다시 생성), MusicGeneration(생성 시작), CoverGeneration(생성·스타일 재편집), DirectorLineup(영입 + 연타 가드), FaceVerify 완료 다이얼로그([취소]/[⭐N 사용하고 이어서 만들기]) | 누락 6경로 적용. MyArtists "＋추가" 진입 확인은 비용 없는 안내로 전환(차감 확인은 Cody 1회로 일원화 — D6) | `[StarConfirm]` |
| A5-3 | CoverGeneration refine·VideoDirector·VoiceCloneWizard | 조건부 확인 → fail-closed(폴백 비용) | `[StarConfirm]` |
| A5-4 | 휴식 단축 onCleared 연쇄 7지점(MusicLoading :404, LyricsLoading :250, CoverGeneration :739·:1688, MusicGeneration :1419, LyricsPromptReview :93, LyricsResult :139) | onCleared → 생성 직전 확인(A5-1)을 거치도록 변경. 로딩 화면(이미 확인을 받은 요청의 재시도)은 "휴식이 끝났어요. ⭐N을 사용해 이어서 만들까요?" 1회 | `[StarConfirm] fatigue-chain` |
| A5-5 | utils/fatigueGate.ts | 단축 후 재표시 다이얼로그 버튼 0.8초 잠금(연타 흡수), 본문에 "이번에 단축에 ⭐N 사용" 누적 표시 | `[fatigue:*]` |
| A5-6 | 하드코딩 비용 6곳 | pointCosts 조회로 교체 | — |
| A6 | screens/ChartScreen.tsx | TOP100 탭 "차트 기준" 안내(showAlert): 로그인 사용자 순 청취자·순 다운로더, 곡 70% 이상 재생 1회, 본인 곡 재생·다운로드 제외, 좋아요·총 재생수 미반영 (D5 결과에 맞춰 문구 확정) | `[Chart]` |
| A7-1 | components/auth/AuthPanel.tsx, components/auth/SocialLoginButtons.tsx, utils/pendingReferral.ts(신규) | `?ref=` 를 안전 저장(web localStorage try/catch, 7일 TTL, 키 `maidol-pending-ref-v1`) → 가입·로그인 모드 모두 "추천코드 ○○○ 적용돼요 — 구글·카카오로 가입해도 ⭐50을 받아요" 칩 + 로그인 모드에 "추천코드가 있어요" 펼침 입력(소셜 신규 가입에만 적용 안내). 가입 확인 후 삭제 | `[ReferralPending]` |
| A7-2 | utils/rewardNotice.ts(신규) + authStore 로그인/가입 직후·앱 복귀 훅 | `GET /points/history?limit=50` 에서 `signup_bonus`·`beta_signup_bonus`·`referral_joiner`·`referral_inviter`·`verify_bonus`·`profile_bonus` 중 **미확인 이벤트**(AsyncStorage `maidol-reward-seen-v1:{uid}`, 72시간 이내)를 모아 showAlert 1회: "가입 선물이 도착했어요 · 가입 보너스 ⭐50 · 베타 가입 추가 ⭐50 · 추천코드 가입 ⭐50". 추천인은 "친구가 내 추천코드로 가입했어요 ⭐50". 대기 코드가 있었는데 referral_joiner 가 없으면 "추천코드가 확인되지 않아 추천 보상은 적용되지 않았어요" | `[RewardNotice]` |
| A7-3 | screens/StarHistoryScreen.tsx(신규, D8) + StarGuideModal "내역 보기" | `/points/history` 목록(한글 라벨 표: 가입 보너스·추천 가입·친구 초대·재생 적립·작곡 사용·환불 …). genJobs/index.ts:114·120 "별 사용 내역" 문구를 실제 화면명과 일치 | `[StarHistory]` |

## 역할 분담
- **app-dev 1조(과금·이탈)**: A1-1~A1-4, A5-1~A5-6. 선행: A5-1(공통 유틸) → 나머지.
- **app-dev 2조(프로필·표시)**: A2, A3, A4, A6, A7-1~A7-3. A2 는 S1 계약(아래)만 보고 병행 가능.
- **backend-dev**: S1(닉네임) → S2(차트). staging 에서만 수정, 로컬 스모크(pytest 또는 스크립트) 후 배포 패키지·md5 목록 제출. 배포는 사용자 승인 뒤.
- S1 계약(앱 합의): `PATCH /api/auth/me/profile {nickname}` → 200 사용자 객체(nickname 갱신) + `nickname_synced:{tracks,feeds,comments}` / 409 `{"error":"nickname_taken"}` / 400 `{"error":"nickname_invalid","message":"…"}`. nickname 미전달 시 현행 동작 불변.

## 회귀 위험
- A1-1 `beforeRemove` 가 성공 후 자동 전환(ArtistLoading → ArtistResult replace, FaceVerify replace, 슬롯 409 goBack)까지 막으면 흐름이 멈춘다 → 가드는 "진행 중 + 사용자 발 액션(POP/GO_BACK/탭)"에만, 코드 발 replace/reset 은 통과. 웹 브라우저 back 은 URL 이 먼저 바뀌는 한계가 있어 확인 후 되돌림 동작 검증 필요.
- A1-2 준비 단계 중단이 v3.227 추적(등록은 응답 후)과 충돌하지 않는지 — POST 를 안 보냈으면 등록도 없어야 함.
- A4 재생성·옷 갈아입히기(대상 있음)는 서버 성별 유지 — 신규만 바뀌는지.
- A5 확인 팝업 추가가 v3.228 중복 차단(busyRef·proceedingRef)·v3.229 디렉터 1탭 복귀(utils/directorResume.ts)·자동 재개(FaceVerify replace) 흐름과 이중 팝업/재진입을 만들지 않는지. 확인 취소 시 busy 해제·단계 롤백.
- A5-4 휴식 단축 후 확인 팝업이 연속 다이얼로그(showAlert 큐) 상태에서 겹치지 않는지.
- A7-2 기존 회원(소급 지급 12명 등)에게 과거 보너스가 갑자기 뜨지 않게 72시간 창 + 최초 실행 시 기준시각 기록.
- S1 세션 갱신 실패 시 이후 업로드·댓글에 옛 닉네임 복사 → 세션 갱신은 필수 단계(실패 시 500 대신 경고 + 다음 로그인까지 지연 기록). 동시 중복 변경 경합(유니크 인덱스 없음) → 트랜잭션 내 `SELECT … FOR UPDATE` 불가 구조라 최종 재확인 후 UPDATE(경합 창 허용, 기록).
- S2 소유자 제외로 현재 소규모 차트가 더 비어 폴백 비중 증가, 롤링 24h 전환 직후 hourly 셋 TTL 26h 가 쌓이기 전 24시간은 기존 daily 와 혼용 필요(전환기 폴백: 롤링 셋 부족 시 daily 사용). Redis 메모리 증가(시간 셋 ×13) — 현 규모 무시 가능.
- S2 record_play 에 Mongo 조회 1회 추가 — 재생 기록 지연(캐시로 완화).
- 서버 재기동 시 v3.228 boot_id 죽은 작업 환불 — 진행 중 생성이 없을 때 배포.

## test-designer 에게 줄 테스트 항목
1. [A1] 아티스트 생성: (a) POST 전(준비 중) 뒤로가기 → 차감 0·요청 로그 0·초안 유지 (b) POST 후 뒤로가기/웹 back/Studio 탭 → 가드 팝업 → 나가기 → 결과 도착 알림·ArtistResult 회수·⭐10 1회 (c) 계속 기다리기 → 화면 유지 (d) 성공 후 자동 전환이 가드에 막히지 않음 (e) 본인인증 미완 계정이 실사 사진 선택 시 즉시 안내.
2. [A1-4] 작곡 POST 응답 전 이탈 → 로컬 추적 등록·작업실 말풍선·도착 알림.
3. [S1/A2] 닉네임: 정상 변경 → 설정·내 곡·차트 곡 표기·피드·댓글·검색 반영, 세션 갱신 후 새 댓글에 새 닉네임, 409 중복(대소문자·공백 변형), 400 길이·예약어, 동일값 재저장 멱등, 탈퇴 계정 닉네임과 중복 허용 여부, 로그에 원문 없음.
4. [A3] 영상: (a) 응답 유실 모사(POST 후 네트워크 차단) → 확인 중 → 완성 표시·⭐5 1회 (b) 이미 만든 곡 선택 시 "지난번 만든 영상 보기" 칩 → 무과금 재생(point_events 증가 0) (c) 비공개 곡·커버 없는 곡 사전 차단 문구 (d) 회귀: 429 휴식 다이얼로그·409 합류.
5. [A4] 여자 아티스트 보유 계정으로 신규 생성 + 성별 "남성" 답 → 필터 "남성용", 성별 스킵 → 전체, 칩으로 남/여 전환, 옷 갈아입히기(대상 여자)는 여자 유지.
6. [A5] 표의 13경로 전부: 확인 팝업 표시·비용 값=`/points/costs`·취소 시 차감 0·busy 해제. `/points/costs` 실패 모사 시에도 확인 표시(fail-closed). 휴식 단축 → 휴식 종료 → 확인 팝업 → 취소 시 생성 차감 0. 단축 다이얼로그 0.8초 내 연타 흡수. 디렉터 영입 연타 1회만 차감. 회귀: v3.228 중복 차단, v3.229 디렉터 1탭 복귀, 첫 아티스트 경로.
7. [S2/A6] 차트: 소유자 다운로드·재생은 `chart:*` 셋 미가산(download_logs `is_owner`)·play_count 는 증가, 타인 다운로드·재생 가산, 롤링 24h(자정 넘김 모사), 심야 24h 전용, 동점 결정적 정렬, 빈 차트 폴백, chart_recovery 재구성 결과가 소유자 제외와 일치, 비공개 곡 제외 유지, v3.229 30초 중복 방지 유지.
8. [A7] 초대 링크 `?ref=` → 새로고침 후에도 칩 유지 → 구글/카카오 신규 가입 → 가입 선물 팝업 1회(가입·베타·추천 3줄) → 재로그인 시 재표시 없음. 무효 코드 → 미적용 안내. 이메일 가입 `referral.applied` 경로 동일 팝업. 추천인 계정 "친구가 가입" 1회. 기존 회원 로그인 시 과거 보너스 미표시. ⭐ 내역 화면 라벨.
9. 공통: 팝업 전부 showAlert(시스템 Alert 0), MAIDOL 표기(AIDOL 노출 0), 이모지 ⭐ 외 0, "저작권 등록 가능/보장" 문구 0, "나가 있어도 계속 만들어져요"류 이탈 권장 문구 0(VoiceCloneWizard 기존 예외 유지).

## 대표 결정 필요 (기본값으로 진행)
- **D1 뒤로가기 가드 범위·문구**: 기본 = 아티스트·작곡·작사·Inst 진행 화면 4곳, [계속 기다리기]/[나가기] + "나가도 만들던 결과는 완성되면 작업실에서 알려드려요." (원칙 문구 "벗어나지 마세요"는 유지, 가드는 나가려 할 때만 표시).
- **D2 개별 사례 조치**: 기본 = 2f85f76c 슬롯 ⭐15 환불 없음(슬롯 영구 보존·사용 가능, 1/2) · 09-24 07:00 영상 ⭐5 환불 없음(영상 보존 — A3 칩으로 무료 재열람). 개별 안내 메시지 발송 없음.
- **D3 닉네임 규칙**: 기본 = 2~15자, 앞뒤 공백 제거·연속 공백 1칸, 중복 불가(대소문자 무시, 탈퇴 계정 제외), 예약어(MAIDOL 공식 계정명) 차단, 변경 간격 제한 없음(베타), 기존 곡·피드·댓글 표기는 새 닉네임을 따라감(소급), 지난 알림 문구(actor_nickname)는 이력으로 유지. 욕설 필터 없음.
- **D4 기획사명(company_name) 전파**: v3.229 결정 5와 같이 이번 범위 밖(기록). 곡 표기의 "기획사" 자리는 uploader_nickname 이므로 닉네임 변경으로 바뀐다.
- **D5 TOP100**: 기본 = 본인 다운로드 제외(요청 반영) + **본인 재생도 차트 집계 제외**(총 재생수 play_count·재생 ⭐ 적립은 유지) + 롤링 24시간 적용 + 빈 차트 폴백 = 주간 점수 → 총 재생수 + 동점 결정적 정렬 + 차트 화면 "차트 기준" 안내 추가. 곡 다운로드 수 표시(download_count)는 총계 유지. 좋아요는 반영하지 않음(멜론과 동일).
- **D6 ⭐ 확인 일원화**: 기본 = 모든 차감 직전 1회 확인(비용·보유 표시), 아티스트는 Cody "이 옷으로 만들기" 1회로 일원화(MyArtists 진입 확인은 비용 없는 안내로), "다시 묻지 않기" 없음, 비용 미수신 시에도 확인(fail-closed).
- **D7 휴식 단축 연타**: 기본 = 재표시 0.8초 버튼 잠금 + 누적 사용 표시. "남은 휴식 한 번에 단축" 버튼은 도입하지 않음.
- **D8 가입 선물 안내·⭐ 내역**: 기본 = 가입 직후 1회 팝업(가입·베타·추천 합산) + 추천인 1회 팝업 + 최소 "스타 내역" 화면 도입.
- **D9 영상 재열람**: 기본 = 곡 선택 시 "지난번 만든 영상 보기" 칩만(보관함 탭 재도입 아님 — v3.187 결정 존중).
- **D10 본인인증 조기 안내**: 기본 = 실사 사진 선택 직후 안내(가상 아티스트 대안 제시).

## 서버 배포 필요 여부
- **필요**(S1 닉네임, S2 차트). 절차: staging `/private/tmp/server_staging_v3230/{orig,new}` → 로컬 스모크 → 배포 직전 라이브 md5 재대조(위 기준값과 다르면 다른 세션 변경분을 병합 후 재검증) → 사용자 승인 → scp·이미지 빌드·컨테이너 재생성(진행 중 생성 job 0 확인 후) → 스모크(닉네임 PATCH 200/409/400, 차트 top100 200·소유자 제외, `/points/history` 200) → 5분 무오류 로그.
- 앱 배포: 웹(app.maidol.ai.kr) + APK/빌드는 기존 절차. S1 미배포 상태에서 A2 는 400/무시를 받으므로 **S1 배포 후 A2 노출**(또는 서버 응답에 nickname 반영 여부 확인해 실패 안내).
- DB 쓰기·소급: S1 은 사용자 요청 시에만 사본 갱신(일괄 소급 스크립트 불필요). S2 는 기존 Redis 차트 셋의 소유자 기록을 지우지 않음(자연 만료 — 주간 8일·월간 32일, 즉시 정리 원하면 별도 승인).

규칙: 서버 수정은 server_staging_v3230 에서만(orig 보존·배포 직전 md5 재대조). 프로덕션 쓰기(scp·build·재생성·.env·DB)는 사용자 승인·실행 뒤. main.py 무변경. 민감 정보는 플레이스홀더. 팝업은 showAlert, 표기 MAIDOL, 이모지 ⭐만, 이탈 권장 문구 금지, "저작권 등록 가능/보장" 금지. 코드 수정·커밋은 이 계획 승인 뒤 team-dev 루프에서.

## v3.230 추가 항목 ⑧ (2026-09-25) — 본인인증 요구 전면 우회
**요청 원문**: "아티스트 얼굴 넣으면 본인인증 하라고 뜬다는데. 본인인증은 추후 적용이라서 본인인증 하라고 뜨는 경우가 있다면 모두 넘어가도록 해놔야해."

**Plan verification findings (오케스트레이터 실측)**
- 라이브 `FACE_VERIFY_ENABLED=true`. `routes/character.py:885-893`·`:1771-1779` 실사 사진 첨부 시 `is_photo_verified` 미통과 → 403 `face_verification_required`(AWS 얼굴 인증 게이트).
- 얼굴 인증 플로우 자체가 본인인증 선행을 요구: `routes/face_verify.py` `/consent`(:171), `/guardian/request`(:206), 검증(:291) 등에서 `users.is_verified` false → 403 `identity_verification_required`. 본인인증(PASS 등) 기능은 아직 없음 → 실사 얼굴 아티스트는 전원 막힘. `/status`(:125~) 가 `is_verified` 를 내려 앱 FaceVerifyScreen 이 "본인인증" 단계로 분기.
- `_is_minor` 는 birth_date 미입력 시 성인 취급(게이트 미적용) — 본인인증 우회해도 미성년 보호자 동의 분기는 birth_date 가 있으면 그대로 동작.
- 앱 본인인증 노출 파일: screens/FaceVerifyScreen.tsx, screens/ArtistInputScreen.tsx, screens/SettingsScreen.tsx, screens/DmInboxScreen.tsx, stores/authStore.ts.

**계획**
- S3(서버): config `identity_verify_required: bool = False`(env `IDENTITY_VERIFY_REQUIRED`). False 면 face_verify.py 의 모든 `is_verified` 게이트 통과, `/status` 는 `identity_required:false` 추가 + 앱 분기용 `is_verified` 는 원값 유지(또는 `identity_ok:true`). AWS 얼굴 인증(동의·라이브니스·대조)·미성년 보호자 동의·character.py 얼굴 게이트는 유지. 로그 `[face-verify] identity gate skipped user=…`. 추후 본인인증 도입 시 .env 한 줄로 복원.
- A8(앱): 본인인증 요구 UI 전부 우회 — FaceVerifyScreen 본인인증 단계 건너뛰고 동의→촬영으로(서버 identity_required 미수신 구서버면 기존 동작), ArtistInput 의 본인인증 안내 제거(v3.230 D10 "본인인증 조기 안내"는 **취소** — 대신 얼굴 인증 안내로 대체 가능), Settings·DmInbox 의 본인인증 요구 문구/차단 점검(단순 정보 표시는 유지, 기능 차단·유도 팝업은 제거). 403 `identity_verification_required` 수신 시에도 본인인증 유도 대신 일반 안내.
- 담당: 서버 S3 = backend-dev(v3.230 스테이징에 추가), 앱 ArtistInputScreen = 1조, FaceVerifyScreen·Settings·DmInbox·authStore = 2조.
- 테스트: 미인증 성인 계정 → 동의 200·검증 진행, 미성년(birth_date 有) → 보호자 동의 분기 유지, flag True 로 되돌리면 기존 403, 앱 어디에서도 "본인인증" 유도 팝업/차단 없음(grep + 하니스).

---

# v3.231 (2026-09-25) — ① 아티스트 만들기 "내 답변 편집" ② 검색창 로맨스 포커싱 ③ 장르 검색 여부 확인

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD 5a5dd26). 서버 = maidol-ec2 `/home/ubuntu/maidol/backend_9004/app`(읽기 전용). 분석용 원본 = `/private/tmp/server_staging_v3231/orig/`(routes/tracks.py·routes/charts.py·services/search_service.py·services/embedding_service.py·constants/categories.py·database/elasticsearch.py, 서버 쓰기 0). 실측 스크립트 = `/private/tmp/server_staging_v3231/q1~q7.py`(Mongo find/count·ES get/search/count/analyze·pgvector 유사도 조회만 — `_hybrid_search_core` 를 직접 호출해 `search_logs` 기록도 남기지 않음). 출처 [P]=planner 실측.

사용자 요청 원문:
"아티스트 만들기에서도 다른 디렉터와 마찬가지로 내가 답변한 대답에 대해서 편집할 수 있는 기능이 필요할 것 같은데. 그리고 검색창에 로맨스를 포커싱해줘. 그리고 검색에 장르로도 검색이 되는 상태인건가?"

서버 파일 md5 기준값([P] 2026-09-25, 배포 직전 재대조):
- routes/tracks.py `d7b2a040ebef87dddd23ce9f2b3afd02`(mtime 09-25 05:01Z — 다른 세션이 오늘 변경함, 병합 주의) · services/search_service.py `de0288a90b7769cef93ee3877baeefac`(09-11) · routes/charts.py `9a5c47a26f611e29561d81c1cffbd657` · services/embedding_service.py `657650d55f2f1ba0756e30b869a76add` · constants/categories.py `730407841bb98f7d1bee202b6fd12dd0` · config.py `672c746801940276ffeab6734ae8249f` · main.py `78ab70741f8dc476e879c330608e0bc7`(수정 대상 아님)

## 0단계 Plan verification findings

### 1. 다른 디렉터의 "내 답변 편집" 구현 [P]
| 디렉터 | 방식 | 근거 |
|---|---|---|
| 작사 LyricsInputScreen | 선택지 스텝만 **제자리 교체**(대화·진행 위치 유지). 말풍선 탭 → 공용 `AnswerEditModal`(선택지 + 일부 자유 입력) → store 값 + 해당 user 버블 텍스트만 교체 | LyricsInputScreen.tsx:283-319(handleReselect/handleReselectChoice), :405-410(버블 탭), :529-535(모달) |
| 작곡 MusicGenerationScreen | **비파괴 되감기**. 선택지형 스텝 = `AnswerEditModal` 즉시, 복합형(제목·가사·슬라이더 등) = 해당 스텝 입력 영역으로 이동 + 상단 "○○ 답변을 수정 중이에요 [취소]" 배너. 커밋 시 해당 버블·직후 에코 버블만 치환하고 원래 진행 위치(resumeStep)로 복귀 | MusicGenerationScreen.tsx:58-68(분류), :462-490(commitExchange 되감기 분기), :529-565(performRewind/handleUserBubbleTap), :567-574(cancelRewind), :2212(말풍선 "탭해서 수정"), :2231-2241(배너), :2247-2253(모달) |
| 커버 CoverGenerationScreen | 작곡과 동일(비파괴). 단 곡 변경(step 0)만 파괴적 확인 팝업(showAlert) 후 처음부터 | CoverGenerationScreen.tsx:1397-1420, :2320(힌트), :2542 |
| 영상 VideoDirectorScreen | **파괴적 롤백** — 탭한 답변 포함 이후 대화 삭제 후 그 단계부터 다시. 생성 중(busyRef) 차단 | VideoDirectorScreen.tsx:59-60, :467-478, :1137-1149(edit-2 아이콘) |
- 공용 요소: `components/AnswerEditModal.tsx`(단일 선택 + 선택적 자유 입력, 초기값 prop 없음), 말풍선 힌트 "탭해서 수정"(editHint 스타일), 되감기 배너(rewindBanner 스타일). 초안 영속은 각 화면 draft 미러링 effect 가 자동 반영(편집 결과도 그대로 영속).

### 2. 아티스트 만들기(ArtistInputScreen) 현재 흐름과 갭 [P]
- 대화 모델: `ChatMessage {type,text}` — **어느 질문의 답인지 메타가 없다**(ArtistInputScreen.tsx:39-42, draft 타입 stores/characterTaskStore.ts:17-20). 말풍선은 `View` 로만 렌더(탭 불가, :1119-1140). → 편집 기능 **전무**(확정).
- 질문 9개(성별·이름·나이·머리·얼굴·피부·체형·키·분위기, :71-133). 답은 **칩 다중 토글 + 자유 입력을 쉼표로 합친 문자열**(handleChipTap :780-789) → 작사식 단일 선택 모달(AnswerEditModal)로는 재현 불가. 이름은 칩 없음(자유 입력 전용).
- 답변 진행: handleAnswerNext(:791-811)가 버블 push + 다음 질문. **마지막 질문(분위기) 답 즉시 handleStartGeneration(:813-866) → 1초 뒤 `navigation.replace('ArtistCody')`(:863)** — 실사 흐름은 최종 확인 지점이 없어 답을 고칠 기회가 없다. (가상은 화풍 단계 :744-778 를 한 번 더 거친다.) 다른 디렉터는 모두 최종 버튼 전에 확인 지점이 있다(작곡 "모든 설정이 완료됐어요! 아래 버튼을…" MusicGenerationScreen.tsx:495, 작사 완료 후 시작 버튼).
- 파생 값: handleStartGeneration 이 `pendingGender/pendingName/pendingAge`(:830-834)와 `userText/conceptText`(:853-859, 가상은 `pendingConceptText` :839) 를 **그 시점에 한 번** 계산 → 이후 답을 바꾸면 이 값들을 다시 계산해야 한다.
- 의상 성별(v3.230 A4): ArtistCodyScreen.tsx:190-201 `resolveCodyDefaultGender({isNewArtist, pendingGender, draftGender = draft.styleAnswers.gender})`(utils/codyCatalog.ts:90-108). 신규 생성은 pendingGender → 초안 성별 순. → 성별 편집은 `styleAnswers`(초안 미러링 자동) **와** `pendingGender`(설정된 뒤라면) 둘 다 갱신해야 필터가 맞다.
- Cody 취소 복귀: ArtistCodyScreen.tsx:985-991 `replace('ArtistInput',{restore:true})` → ArtistInput 은 restore 면 **초안 대화 복원을 건너뛴다**(:221) → 빈 환영 화면 + "이어서 만들기" 버튼(:895-905)만. 답한 내용을 보거나 고칠 수 없다(확정).
- 초안 재진입 결함(코드 추적, 런타임 재현 전): 실사 마지막 답 후 step='questioning', qIndex=8 로 초안이 남는다(qIndex 증가 없이 이동). Cody 에서 하드웨어 back 등으로 나가 작업실 바로 가기(utils/directorResume.ts:128-139)로 돌아오면 분위기 질문이 다시 열리고, 답하면 분위기 버블이 중복된다.
- 사진/얼굴 인증: 사진 확정 시 동의 선진행 `acceptPhotoWithConsentPrecheck`(:582-594), 사진 의도 `photoIntent` 영속·재요구(`requirePhotoAgain` :562-567, `resumeOrStartQuestioning` :534-560), 실사+사진이면 외모 4문항 안내 문구 변형(`questionTextFor` :138-140). 초안 복원 시 사진 버블 텍스트로 의도를 추론하는 구 초안 호환(:150-160).
- 재생성 대상: `route.params.characterId`/`forceKind` 가 초안 키(:214-232) — 편집은 키를 바꾸지 않으므로 영향 없음.

### 3. 검색 화면 현재 구성 [P]
- 검색 탭 = `screens/SearchScreen.tsx`(App.tsx:399). 입력창 placeholder "곡 제목, 아티스트, 태그 검색"(:233), 아래 느낌 칩 가로 바(10종, 서버 `/charts/categories` 순서 = 운동·에너지 충전·휴식·출퇴근길·행복한 기분·집중·**로맨스(7번째)**·파티·슬픔·잠자기, constants/categories.py:10-21). 진입 시 **첫 칩(운동)을 기본 선택해 곡 로드**(:150-156). 로맨스 칩은 가로 스크롤해야 보인다. 헤드라인 "설렐 때 듣는 음악"(:51).
- 비로그인: 입력 포커스·칩 탭 → 로그인 오버레이(:99-106, :141-144, :236-237). 기본 카테고리 로드만 비로그인도 노출(현행). 서버 `/tracks/search` 는 비로그인도 200(tracks.py:641-647 `get_current_user_optional`) — 차단은 앱 정책(메모리 aidol-mvp-policy-decisions 유지).
- ChartScreen.tsx:186-201·:398-407 에도 검색 모달이 있으나 여는 코드가 없다(죽은 코드 — 범위 밖, 기록만).
- 카테고리별 공개곡 수 [P q1]: 로맨스 10 · 행복한 기분 10 · 에너지 충전 8 · 파티 4 · 휴식 3 · **운동 2** · 슬픔 1 · 출퇴근길 1 · 집중 0 · 잠자기 0 (공개곡 27/전체 35). → 현재 기본값(운동)은 2곡뿐, 로맨스는 가장 많은 10곡.

### 4. 서버 검색 경로 — 장르 검색 여부 [P, 코드 + 실측]
- 경로: `GET /tracks/search`(routes/tracks.py:641-688) → `_hybrid_search_core`(:432-583) = pgvector 의미 검색(cosine floor 0.15) + ES BM25 → RRF 결합 → Mongo 공개곡만. 폴백 regex(:405-429)는 두 백엔드가 모두 죽었을 때만.
- ES 색인 필드: title·lyrics·prompt·**genre**·**mood**·tags·keywords·artist(search_service.py:150-180, 문서 변환 :192-210). 쿼리 multi_match fields = `artist^4, title^3, lyrics^2, keywords^2, prompt, tags, genre, mood`(:549), nori + 무드 동의어(:70-81).
- **느낌 카테고리(`categories`: 로맨스 등)는 ES 매핑·문서 변환·쿼리 어디에도 없다**(확정). regex 폴백도 title·tags·prompt·uploader_nickname·artist_name 만(:407-416 — genre/mood/categories 없음).
- 아무말 게이트(:486-512): ES top1 < `search_es_weak_score`(3.0) 이고 벡터 top1 < `search_gibberish_cosine`(0.34) 이고 접두어 앵커(:636-675, fields lyrics.phrase·title.phrase·artist·keywords) 0건이면 빈 결과.
- 저장값 실측 [P q1]: 공개곡 genre 가 한/영 혼재 — 트로트4·댄스4·시티팝3·R&B3·K-Pop3·Hip-hop3·하우스2·인디2·Dance Pop1·Carol1·재즈1·Dance1·힙합1·City pop1. mood 도 한/영 혼재(밝고 경쾌한9·Romantic2·로맨틱·달콤한2…). tags 는 전 곡 비어 있음. 분석기 토큰: "R&B"→[r,b], "Hip-hop"→[hip,hop], "hiphop"→[hiphop], "시티팝"→[시티,팝].
- **ES 공개 상태 불일치 6곡**[P q5·q7]: Mongo 공개 27곡 중 ES `is_public=false` 6곡(ES 총 28 문서, 역방향 불일치 0). 6곡 모두 비공개로 만든 뒤 공개로 바꾼 곡(updated_at > created_at). 원인: `PUT /tracks/{id}`(tracks.py:1040-1100)가 Mongo·Redis 만 갱신하고 ES 는 갱신하지 않는다(ES 동기화 호출은 삭제 :977·관리자 :877 뿐). 기동 시 자가 치유(search_service.py:303-432)는 **문서 개수만** 비교(28 ≥ 27 → skip)해서 못 고친다.
- 실측(`_hybrid_search_core` 직접 호출, 공개곡 27) [P q3·q4·q6]:

| 검색어 | 모드 | 결과 수 | 해당 장르/느낌 곡 | 순위 |
|---|---|---|---|---|
| R&B | hybrid | 27 | 3/3 | 1·2·3 |
| 알앤비 | hybrid | 11 | 1/3 | 3 |
| Hip-hop | hybrid | 17 | 4/4 (Hip-hop+힙합) | 1·2·3·10 |
| 힙합 | hybrid | 7 | 2/4 | 1·2 |
| 트로트 | hybrid | 13 | 4/4 | 1·2·7·13 |
| 댄스 | hybrid | 24 | 5/6 (댄스·Dance·Dance Pop) | 1·2·3·6·10 |
| 시티팝 / City pop | hybrid | 27 / 12 | 4/4 | 1·2·5·21 / 1·2·3·10 |
| K-Pop / 케이팝 | hybrid | 27 / 27 | 3/3 | 2·3·4 / 3·18·23 |
| 하우스 · 인디 | hybrid | 16 · 20 | 2/2 · 2/2 | 1·2 |
| **재즈** | gibberish | **0** | 0/1 | — (그 1곡이 ES 불일치 6곡 중 하나) |
| 발라드 | gibberish | 0 | 공개 발라드 곡 0 — 정상 | — |
| **로맨스** | gibberish | **0** | 0/12 (카테고리 로맨스 10 + 무드 로맨틱 2) | — (ES top1 2.87 < 3.0, 벡터 0.322 < 0.34) |
| 로맨틱 | hybrid | 26 | 12/12 | 1·2·3·4·5·7·8·9·17·23·25·26 |
- 결론(확정): **장르 검색은 된다(genre 필드 색인·검색, 해당 장르 곡이 대부분 1~3위).** 단 ① 한/영 표기 불일치로 "힙합"은 Hip-hop 표기 곡 2곡을 놓치고 "알앤비"는 R&B 곡 1/3만, "케이팝"은 하위권 ② ES 공개 상태 미동기화 6곡은 키워드로 안 잡혀 "재즈" 0건 ③ 장르 "필터"가 아닌 관련도 검색이라 결과에 다른 장르 곡도 섞인다(R&B 검색 27곡 전부 노출, 해당 곡은 상위) ④ **느낌(로맨스 등)은 색인되지 않아 "로맨스"를 입력하면 0건**(느낌 칩으로는 10곡) ⑤ regex 폴백은 장르 미포함.

## 항목별 원인/갭 요약
1. **답변 편집(아티스트)**: 대화 메시지에 질문 식별 정보가 없고 말풍선이 탭 불가 → 편집 기능 없음. 실사는 마지막 답과 동시에 의상 화면으로 넘어가 확인 지점이 없음. Cody 취소 복귀 시 대화가 보이지 않음. 답은 칩 다중 선택+자유 입력 합성이라 공용 모달(단일 선택)이 맞지 않음 → 작곡의 "복합형 되감기(입력 영역 재사용 + 수정 배너)" 방식이 적합.
2. **로맨스 포커싱**: 느낌 칩 기본 선택이 첫 번째(운동, 2곡)로 고정, 로맨스는 7번째라 스크롤해야 보임. 검색창에 "로맨스"를 쳐도 0건(서버 카테고리 미색인 + 아무말 게이트).
3. **장르 검색**: 된다. 다만 한/영 별칭 미흡·ES 공개 상태 불일치(재즈 0건)·느낌 카테고리 미색인. placeholder 에 장르 안내 없음("태그 검색" — 실제 tags 는 전 곡 비어 있음).

## 변경 매트릭스

### 앱 (2_housing)
| ID | 파일 | 변경 | 로그 prefix |
|---|---|---|---|
| A1 | screens/ArtistInputScreen.tsx, stores/characterTaskStore.ts | **질문 답변 편집(비파괴)**. `ChatMessage`·`ArtistDraftChatMessage` 에 선택 필드 `qKey?: keyof StyleAnswers` 추가(handleAnswerNext 가 기록, 구 초안 호환). 구 초안 버블은 직전 디렉터 버블이 `QUESTIONS[i].question` 으로 시작하면 그 key 로 추론(없으면 편집 불가). user 버블을 TouchableOpacity 로, qKey 있는 버블에 "탭해서 수정" 힌트(작곡 editHint 스타일). 탭 → `editRef={idx,qKey,resume:{step,qIndex,currentInput}}` 저장 → 입력 영역을 그 질문으로 전환(`currentInput`=기존 답, 생략이었다면 빈 값, 칩 선택 상태 자동 반영) + 진행 표시 "수정 중 · 머리" + 상단 배너 "머리 답변을 수정 중이에요 [취소]"(작곡 rewindBanner 스타일). 버튼 = [비우기(건너뛰기)] [수정 완료]. **디렉터 새 버블 push 없음**. 커밋: `styleAnswers[qKey]` 갱신, 해당 버블 텍스트만 교체(`(○○ 생략)` 포함), 이후 대화 보존, step·qIndex·currentInput 원위치 복귀. 연쇄 편집(수정 중 다른 버블 탭) = 복귀 지점은 최초 위치 유지(작곡 규칙). [취소] = 미반영 복귀. | `[ArtistEdit]` 열기/커밋/취소/거부 |
| A1-파생 | 동일 | 커밋 시 이미 계산된 파생 값 재계산: `pendingGender/pendingName/pendingAge`(이미 설정된 경우 = style·review 단계), 가상 style 단계면 `pendingConceptText = buildFinalText(new) \|\| '특별한 컨셉 없음 — 자연스러운 느낌으로'`, review/복원 단계면 `taskStore.conceptText/userText` 재설정. 사진 소스 없음 + 모든 답이 비게 되는 커밋은 거부 → showAlert('설명이 필요해요','사진 없이 만들 때는 한 가지 이상 답해주세요.'). 실사+사진이면 외모 4문항 진행 표시에 PHOTO_MODE_HINT 유지. | `[ArtistEdit] 파생 재계산` |
| A1-차단 | 동일 | 편집 비활성(힌트 미표시·탭 무시): `activeJob` 있음, 사진 재요구 중(`photoResume`), 의상 화면 이동 대기(1초 setTimeout — `leavingRef`), initialLoading. 사진/설명 선택·실사/캐릭터 선택·화풍 버블은 질문 편집 대상 아님(A1-b 참조). | `[ArtistEdit] 거부 reason=` |
| A1-b | 동일 | **사진 버블 탭 = 사진 바꾸기**(D2 기본 도입): showAlert('사진을 바꿀까요?','답해둔 내용은 그대로 두고 사진만 다시 골라요.',[취소]/[사진 바꾸기]) → 기존 `requirePhotoAgain` 메커니즘 재사용(photoResume 에 현재 step·qIndex 저장 → welcome) — 단 디렉터 문구는 "바꿀 사진을 올려주세요. 사진 없이 설명만으로 만들 수도 있어요."(재업로드 안내 문구와 분리). 새 사진 → 기존 확약 팝업·얼굴 인증 동의 선진행(acceptPhotoWithConsentPrecheck) 그대로 → 멈췄던 단계로 복귀. 실사/캐릭터 선택 버블은 편집 불가(바꾸려면 '처음부터'). | `[ArtistEdit] 사진 바꾸기` |
| A2 | 동일(+ characterTaskStore `ArtistDraft.step` 에 `'review'` 추가) | **실사 최종 확인 단계 'review'**: 마지막 질문 답 후 바로 Cody 로 넘기지 않고 디렉터 "답해주신 내용으로 준비됐어요! 고치고 싶은 답은 말풍선을 눌러 바꿀 수 있어요." + [의상 고르러 가기] 버튼. 버튼이 기존 handleStartGeneration 의 파생 값 설정·outfit clear·`replace('ArtistCody')` 수행(동작 동일, 시점만 버튼으로). 가상은 기존 화풍 단계가 확인 단계 역할(그 단계에서도 A1 편집 가능). `resumeOrStartQuestioning`·`initialPhotoResume` 가 target.step='review' 를 처리(사진 재업로드 후 review 복귀). 구 초안(step='questioning', qIndex=8, 분위기 답 있음)은 복원 시 review 로 승격(중복 분위기 버블 방지). | `[ArtistInput] review 진입/의상 이동` |
| A3 | 동일 | **Cody 취소 복귀 시 대화 복원**: restore 이고 초안 키 일치·진행 있음이면 초안 대화를 복원하고 step='review'(실사·가상 공통)로 연다 — [의상 고르러 가기] = 기존 handleResume(store 보존 입력 그대로) + 답변 편집 가능(편집 시 conceptText/userText·pending* 재계산). 초안이 없으면 현행(환영 + "이어서 만들기"). 메모리 사진 유지 로직(:249-253) 그대로. | `[ArtistDraft] restore 대화 복원` |
| A4 | screens/SearchScreen.tsx | **로맨스 포커싱**(D3 기본): 느낌 칩 순서에서 로맨스를 맨 앞으로(서버 목록에서 앱이 재정렬 — 서버 순서 불변, 폴백 배열도 동일), 진입 시 기본 선택 = 로맨스(목록에 없으면 첫 칩), 입력창 placeholder = "곡 제목, 아티스트, 장르 검색 (예: 로맨스)". 비로그인 게이트 현행 유지(기본 카테고리 목록 노출만 현행대로). | `[SearchScreen] 기본 느낌=로맨스` |
| A5 | screens/SearchScreen.tsx | **느낌 이름 검색 바로 가기**: 입력어(trim)가 느낌 카테고리명과 정확히 같으면 `/tracks/search` 대신 해당 칩 선택(loadCategory) — 서버 배포 전에도 "로맨스" 입력 0건 해소. 그 외 검색어는 현행. | `[SearchScreen] 느낌 검색 바로 가기` |

### 서버 (staging `/private/tmp/server_staging_v3231/{orig,new}` — main.py·config.py 무변경)
| ID | 파일 | 변경 | 로그 prefix |
|---|---|---|---|
| S1 | services/search_service.py | ES `categories` 필드 추가: 매핑(`_ko_text_field()`), `_track_to_doc` 에 `categories`, es_search fields 에 `categories^2`, es_anchor_hits fields 에 `categories`. 기동 자가 치유의 샘플 검사에 "`categories` 키 없음 → 전체 재색인"(v169 artist 패턴 :376-393) 추가 → 배포 후 1회 자동 재색인(공개곡 27, 수 초) — **이 재색인이 공개 상태 불일치 6곡도 함께 고친다**. put_mapping 은 기존 ensure 경로(:230-242)가 가산 적용. | `[search.es.migrate] sample doc missing 'categories'` |
| S2 | routes/tracks.py | 장르·느낌 별칭 확장(ES 쿼리 문자열에만 덧붙임, 벡터 쿼리·응답 형태 불변): 힙합↔Hip-hop, 알앤비↔R&B, 케이팝↔K-Pop, 시티팝↔City pop, 댄스↔Dance, 재즈↔Jazz, 발라드↔Ballad, 트로트↔Trot, 록↔Rock, 로맨스→로맨틱·Romantic. 대응 토큰이 쿼리에 있을 때만 추가. 느낌 카테고리명과 정확히 같은 쿼리는 아무말 게이트 비적용. regex 폴백 `$or` 에 genre·mood·categories 추가. | `[tracks.search] alias_expand q_len=%d added=%d` |
| S3 | routes/tracks.py | `PUT /tracks/{id}` 갱신 후 ES 동기화: 갱신된 문서를 다시 읽어 `es_index_track`(admin.py:877 패턴, best-effort·실패해도 200). 공개↔비공개·제목·장르 변경이 검색에 즉시 반영. | `[tracks.update] es_sync track=%s ok=%s` |
- 배포 후 기대 [P 예측, 스모크로 확인]: "로맨스" → 10곡 이상(카테고리 일치 상위), "재즈" → 1곡, "힙합" → 4곡 상위, "알앤비" → R&B 3곡 상위.

## 역할 분담
- 1조(앱): A1·A1-파생·A1-차단·A1-b·A2·A3 — ArtistInputScreen.tsx, characterTaskStore.ts(타입만). utils/directorResume.ts 는 수정 없음(step 값 추가만 영향 — hasArtistDraftProgress 는 step 을 보지 않음 확인).
- 2조(앱): A4·A5 — SearchScreen.tsx.
- backend-dev: S1·S2·S3 — staging 에서만, orig 보존, 배포 직전 md5 재대조(tracks.py 는 오늘 05:01Z 변경분 있음 — 병합).
- test-designer: 아래 항목.

## 회귀 위험
- v3.229 directorResume: 초안 step 에 'review' 가 생겨도 작업실 바로 가기·"이어서 하기" 판정 불변이어야 함(peekArtistDraft 는 user 버블 유무만 봄). 키(characterId·forceKind) 전달 유지.
- v3.230 A4 의상 성별: 성별 편집 → Cody 기본 필터가 새 성별(pending 우선 → 초안). 편집 전 값이 pendingGender 에 남는 경로가 없어야 함(review·style·restore 세 단계 모두).
- v3.230 ⭐ 확인(starSpendConfirm)·이탈 가드(useGenerationLeaveGuard): ArtistInput 에는 과금이 없음 — 과금·확인은 Cody "이 옷으로 만들기" 1회 그대로. A2 버튼이 과금으로 오해되지 않게 문구에 ⭐ 표기 금지.
- v3.227 H-1 사진 의도·재요구: 사진 바꾸기(A1-b)와 재업로드 안내 문구 분리, photoIntent·reuseOriginal 갱신 규칙 동일. 텍스트 전용에서 사진으로 바꾸면 photoIntent='photo' 로.
- 얼굴 인증 동의 선진행은 사진 확정 때만(편집 커밋으로 재실행 금지).
- 복원 안내 버블('처음부터')·showResumeNotice 접기 규칙 — 편집 시작도 "이어서"로 접는다(다른 디렉터와 동일).
- 검색: 비로그인 입력·칩 탭 게이트 유지, 기본 카테고리 로드는 현행(비로그인도 목록 노출). 검색 결과 클릭 로깅(:159-165)은 A5 바로 가기(카테고리 모드)에서 기록 안 함(현행 카테고리 모드와 동일).
- 서버: 응답 형태 `{tracks,pagination}` 불변. 별칭 확장이 아무말 게이트를 과하게 풀지 않게(느낌명 정확 일치만 게이트 제외). ES 재색인은 공개곡만(비공개 문서는 그대로 is_public=false).

## test-designer 에게 줄 테스트 항목
1. [A1] 실사·사진 없음: 머리 답(칩 2개+자유 입력) → 체형 질문 중 머리 버블 탭 → 입력 영역에 기존 값·칩 선택 표시 → 수정 완료 → 머리 버블만 바뀌고 이후 대화·현재 질문(체형) 그대로. [취소] = 변화 없음. 생략 버블 편집 → 값 입력 시 텍스트 교체. 연쇄 편집 후 복귀 위치 = 최초 위치.
2. [A1-파생] 성별 남→여 편집(가상 style 단계·실사 review 단계 각각) → Cody 기본 필터 "여성" (로그 `[ArtistCody] 성별 필터 source=pending gender=여`). 이름·나이 편집 → 생성 저장 후 상세 화면 반영. 가상 컨셉 텍스트 재계산 확인.
3. [A1-차단] 추적 중 job 있음·사진 재요구 중·의상 화면 이동 1초 대기 중 탭 무반응. 사진 없음 + 모든 답 비우기 커밋 → showAlert 거부.
4. [A1-b] 실사 사진 버블 탭 → 확인 → 새 사진 → 확약 팝업 → 멈췄던 질문으로 복귀, 답 보존, photoIntent='photo'. 텍스트 전용 → 사진으로 전환. 캐릭터(가상) 사진 버블도 동일.
5. [A2] 실사 마지막 답 → review(자동 이동 없음) → [의상 고르러 가기] → Cody. review 에서 편집 후 이동 → user_text 에 수정값 반영(ArtistLoading `form.append('user_text')` 값 확인). 구 초안(questioning, qIndex 8, 분위기 답 있음) 복원 → review 로 열림·분위기 버블 중복 없음.
6. [A3] Cody [취소] → 대화 복원 + review → 편집 → [의상 고르러 가기] → Cody → 생성 → conceptText 수정값. 초안 없는 restore 는 현행 화면.
7. [초안 영속] 편집 직후 앱 종료·재시작 → 편집값 유지(버블·styleAnswers·qKey). 재생성(characterId) 진입 초안 키 불일치 폐기 현행.
8. [A4] 검색 탭 진입 → 로맨스 칩 맨 앞·선택·"설렐 때 듣는 음악" 목록. `/charts/categories` 실패 시 폴백 목록도 로맨스 먼저. 비로그인: 입력 포커스·다른 칩 탭 → 로그인 오버레이.
9. [A5] "로맨스" 입력 → 로맨스 칩 선택 목록(10곡), "로맨스 노래" 는 일반 검색. 다른 느낌명도 동일.
10. [S1~S3] 스모크: "로맨스"·"재즈"·"힙합"·"알앤비"·"R&B"·"발라드"(0 유지)·아무말("ㅁㄴㅇㄹ" 0 유지)·아티스트명·가사 구절(순위 회귀 없음). 곡 비공개→공개 PUT 후 즉시 검색 반영, 공개→비공개 후 제외. 기동 로그 `[search.es.migrate] sample doc missing 'categories'` 1회 → 재기동 시 재발 없음. ES 공개 문서 수 = Mongo 공개 수.
11. 공통: 팝업 전부 showAlert, MAIDOL 표기, 이모지 ⭐ 외 0.

## 대표 결정 필요 (기본값으로 진행)
- **D1 편집 방식**: 기본 = 작곡식 비파괴 편집(입력 영역 재사용 + 수정 배너, 이후 대화 보존). 대안: 영상식 파괴적 롤백(이후 답 다시 입력) — 채택 안 함.
- **D2 사진 바꾸기**: 기본 = 사진 버블 탭으로 사진만 교체(답 보존) 도입. 실사↔캐릭터 전환은 '처음부터'로만.
- **D3 로맨스 포커싱 해석**: 기본 = (a) 느낌 칩 로맨스 맨 앞 + 진입 기본 선택(곡 목록 즉시) + (b) placeholder "곡 제목, 아티스트, 장르 검색 (예: 로맨스)" + (c) "로맨스" 입력 시 로맨스 목록(A5·S1). 대안: 입력창 자동 포커스(키보드 올라옴)는 하지 않음 — 비로그인은 포커스 즉시 로그인 오버레이가 떠서 부적합.
- **D4 실사 최종 확인 단계(review)**: 기본 = 도입(탭 1회 추가, 다른 디렉터와 일관). 대안: 현행 자동 이동 유지 + Cody 취소 복귀 시에만 편집.
- **D5 장르 검색 방식**: 기본 = 관련도 검색 유지(장르 곡이 상위, 다른 곡도 아래 노출) + 한/영 별칭 보강. 장르 정확 일치 시 "필터 결과만" 보여주기는 하지 않음.
- **D6 저장 장르 표기 정리(DB 소급)**: 기본 = 하지 않음(Hip-hop/힙합 등 기존 값 유지, 검색 별칭으로 흡수). 소급 통일은 별도 승인 사안.

## 서버 배포 필요 여부
- **필요**(S1·S2·S3 — 검색 품질). 앱 A1~A5 는 서버 없이 동작(A5 로 "로맨스" 0건은 앱만으로도 해소). 절차: staging `orig/`→`new/` 수정 → 로컬 구문 검사·스모크 → 배포 직전 md5 재대조(위 기준값, tracks.py 오늘 변경분 병합) → 사용자 승인 → 코드 반영·이미지 빌드·컨테이너 재생성(진행 중 생성 job 0 확인) → 기동 로그 재색인 1회 확인 → 검색 스모크(테스트 10) → 5분 무오류.
- DB 쓰기: Mongo·Postgres 쓰기 없음. ES 재색인(공개곡 27건 upsert)은 배포 시 자동 1회 — 배포 승인에 포함해 고지.

규칙: 서버 수정은 server_staging_v3231 에서만(orig 보존). 프로덕션 쓰기는 사용자 승인 뒤. 비밀값 미기재. 팝업 showAlert, 표기 MAIDOL, 이모지 ⭐만. 코드 수정·커밋은 계획 승인 뒤 team-dev 루프에서.

---

# v3.232 (2026-09-25) — 어린이 모드

전제: 앱 = /Users/pearl/TripleJ/2_housing (frontend, HEAD 03a1c8d = v3.231). 서버 = maidol-ec2 `/home/ubuntu/maidol/backend_9004/app`(읽기 전용). 분석용 원본 = `/private/tmp/server_staging_v3232/orig/`(app 트리 전체 .py 119개, .bak·static 제외, 서버 쓰기 0). 실측 스크립트 = `/private/tmp/server_staging_v3232/q1.py·q2.py`(Postgres SELECT 만). 기획서 = `2_housing/어린이모드_기획서.md`(273행 전부 확인 — 파일:라인 인용 다수가 현재 코드와 어긋나 아래 표로 재확정). 출처 [P]=planner 실측·코드 확인.

사용자 요청 원문:
"어린이 기획서를 기반으로 앱을 전반적으로 수정해야할 것 같은데. 잘 생각해서 기존 기능에 문제가 절대 없도록 만들어야되. 지금 상태를 체크해서 저장해두고 어린이 기획서를 반영해서 새로운 버전을 만들어줘"

체크포인트(완료, 되돌림 기준): git 태그 `checkpoint-pre-kids-20260925`(HEAD 03a1c8d) · 서버 이미지 `maidol-app:checkpoint-pre-kids-20260925`(9a0076591bb4 = 현재 latest, 06:25Z).

서버 파일 md5 기준값([P] 2026-09-25, 배포 직전 재대조 — 다른 세션이 오늘 auth.py·oauth.py·official.py(05:21Z)·tracks.py·search_service.py(06:25Z)를 바꿈):
config.py `672c746801940276ffeab6734ae8249f` · models/user.py `d91de49cd633cc85b52366da1b39c3f4` · routes/auth.py `abffbf0add39f8c4f77115287085ad1c` · services/dm_service.py `cb5fa56f1ec11f23cb365d541043d519` · routes/dm.py `c051757fa444d49e06148e057591c443` · routes/upload.py `74c18f239a347ae405de34548f17a9ce` · routes/feeds.py `5e051562412bfc18570236859d2531ae` · routes/tracks.py `21ac424dd71d7e2b9cdfb355c090e483` · routes/character.py `a61f7865f7907e41f86ebb0662a7fbc8` · routes/face_verify.py `6ba27ce6d7a037ac0231953fdc446794` · routes/voice_clone.py `48a6b607c1aabbd9b9f04af75e136231` · routes/generate.py `4842bb5623cf55c3f6be00da9ae88a7a` · routes/business.py `886744df7305eb4e9c9d31704f0807c9` · routes/reports.py `8ebfa941c29303a142eb25e989db2735` · routes/admin.py `42603988c709095c43fe000cf7f9a461` · main.py `78ab70741f8dc476e879c330608e0bc7`(수정 대상 아님)

## 0단계 Plan verification findings

### 1. DB 실측 — 배포 즉시 누가 어린이가 되는가 [P q1·q2, 2026-09-25]
| 항목 | 값 |
|---|---|
| 전체 계정 | 43 (전부 account_status=active, pending_consent 0) — provider local 24 · kakao 10 · google 9 / role user 33 · customer 8 · admin 2 |
| 생년월일 입력 | 12 (local 10 · kakao 1 · google 1) — 만 나이 분포 16세 1명 · 19세 1명 · 나머지 20세 이상(최소 16 · 최대 37) |
| **생년월일 없음(나이 모름)** | **31 / 43 = 72%** — kakao 9 · google 8 · local 14(2026-03~09 이메일 가입 중 생년월일 필수화 이전·선택 입력 계정) |
| 만 13세 미만(child) | **0** (상태 무관 0) |
| 만 13세(teen) | 0 |
| guardian_consents | 3행(signup: agreed 1 · rejected 1 · expired 1, 모두 method=mock, 2026-07 테스트) — 3건 모두 아동 계정이 이미 삭제됨(09-24 테스트 계정 정리) |
| is_verified | 4 (kakao 인증 트랙) |
→ **결론: 코드를 배포하고 킬 스위치를 켜도 현재 어린이 모드로 바뀌는 계정은 0명.** 나이 모름 31명은 어린이로 취급하지 않는다(아래 플래그 설계) — 이 31명을 어린이로 보면 즉시 대규모 회귀.

### 2. 서버 설정·보호자 동의 현황 [P]
- `settings.guardian_consent_enabled` = **False**(config.py:180 기본값, 운영 .env 에 GUARDIAN_CONSENT_ENABLED 키 없음 — 컨테이너 settings 실측 False). identity_verify_required=False, face_verify_enabled=True, frontend_url=https://app.maidol.ai.kr.
- 발송 어댑터 `services/guardian_notify.py` = **mock**(로그만 남기고 consent_url 반환, SMS 없음). 본인확인 어댑터 `services/guardian_verify.py` = **mock**(즉시 통과).
- **보호자 동의 착지 페이지가 없다**: consent_url = `{frontend_url}/guardian-consent/{token}` → `https://app.maidol.ai.kr/guardian-consent/x` 는 200 이지만 앱 웹 SPA 홈(index.html)으로 떨어진다(curl 확인). 구 MAIDOL 웹의 `GuardianConsentPage.jsx`(/Users/pearl/TripleJ-maidol/0_platform_music/frontend/src/pages/)는 이식되지 않았다. 앱 authService.ts:14 도 "decide 는 보호자 웹 착지 페이지 전용 — 앱에서 호출하지 않음".
- → guardian_consent_enabled 를 지금 켜면: 만 14세 미만이 가입 요청 → pending_consent 계정 생성(로그인 403) → 보호자에게 아무것도 가지 않고, 앱이 보여주는 "테스트 모드" 링크도 동의 화면이 아님 → **영구 대기 계정만 쌓인다.** 이번 버전에서 켜지 않는다(대표 결정 D2 기본값).
- 동의 처리 로직 자체는 있음: auth.py:976 request(플래그 OFF 503) · :1075 notice · :1124 decide(verify mock → agreed 시 active 전환, verify_reward_points>0 이면 ⭐ 지급). 가입 차단: auth.py:323-337(register 는 만14 미만이면 항상 400 guardian_consent_required).

### 3. 연령·계정 코드 현황 [P]
- 서버 나이 계산: models/user.py:20-33 `age_years`·`is_under_14`(GUARDIAN_CONSENT_AGE=14, birth None=False, `date.today()` = 컨테이너 UTC 기준). age_group 개념 없음. 세션(Redis session dict, auth.py(루트):33-68)에 birth_date 없음 → 어린이 판정은 PG fresh 조회 필요(dm_service._fetch_gate_row :158-165 관행).
- `/auth/me` (routes/auth.py:646-686): birth_date 포함, age_group 없음. `/auth/login` (:436-481): user 에 id·email·nickname·profile_image·company_name·display_title·role 만(birth_date 없음) → 앱은 이메일 로그인 직후 나이를 모른다. 앱 loginWithToken(소셜·세션 복원)은 /auth/me 사용(stores/authStore.ts:97-114).
- 소셜 가입(routes/oauth.py:302-398): google 은 생년월일 없음, kakao/naver 는 provider 가 주면 is_verified 계정에 birth_date 저장(:380-390). **만 14세 미만 게이트 없음** — kakao 가 아동 생년월일을 주면 보호자 동의 없이 active 가입(현재 해당 0명). 실측상 kakao 10명 중 9명은 생년월일 미수신.
- **생년월일 수정**: PATCH /auth/me/profile(auth.py:688-897) — 본인인증 계정만 잠금(:759-770). 미인증은 변경·삭제(null) 자유 → 첫 입력 시 만14 미만 날짜를 넣어도 보호자 절차 없음(기존 공백, E3 소관). 앱 SettingsScreen 저장은 **미인증이면 매번 birth_date 를 보낸다(값 그대로여도)**(screens/SettingsScreen.tsx:166-176) → E4 잠금은 "같은 값 재전송 = 통과"여야 회귀가 없다.
- 프로필 완성 ⭐10: auth.py:857-867 (birth_date·gender·region 3종) / 앱 배지 SettingsScreen.tsx:510-516.
- 앱 가입 게이트: components/auth/AuthPanel.tsx:218-242(만14 미만 → signup-config 조회 → ON=보호자 폼, OFF=blocked), blocked 화면 :538-549("이전으로" :546 → 생년월일 재입력 가능), 게이트 문구 :555 "가입 전에 생년월일과 내/외국인 여부를 확인합니다."(기준 나이 비노출 — 중립 확인 요건 충족), 미성년 소셜 버튼 숨김 :695. 앱 다른 곳에 나이 로직 없음(faceVerify 의 만19 minor 는 서버값).

### 4. DM 현황 — 어린이 DM 은 사실상 이미 닫혀 있다 [P]
- 게이트 `assert_can_dm`(services/dm_service.py:211-275): ① 보내는 사람 is_verified 필수(공식 상대만 면제 :230-240) ④ 받는 사람 만14 미만이면 그 아이가 나를 팔로우해야 함(:253-257) ⑤ 비팔로우 = 메시지 요청(pending, DM_REQUIRE_MUTUAL=False :60). 사용자 검색 `search_users`(:988-)도 is_verified 필수(:1020-1023). 본인인증 미도입(v3.230)으로 is_verified=4명(kakao) 뿐.
- 어린이(미인증)는 이미 공식 계정 외 DM 불가. 단 kakao 인증 트랙으로 들어온 아동은 is_verified=True 라 DM·검색 가능 → F1 필요. 다른 사람 → 아동: ④로 "아이가 나를 팔로우"면 요청 가능 → F1 로 공식 외 전면 차단.
- 앱: DM 진입은 HomeHeaderActions.tsx:131-141(무조건 렌더) 1곳, 공식 CS DM = SettingsScreen.tsx:365-400(GET /dm/official → POST /dm/conversations), DmInbox 새 메시지 검색 :130-152(GET /dm/users/search), 공식 고정 행 :276-289, 사진 첨부 DmChatScreen.tsx:396-398(POST /upload/dm-image :148). 공식 공지 DM(브로드캐스트)도 받은편지함으로 온다 → 아이콘을 숨기면 공지·CS 답장을 못 읽는다(기획서 B1 과 충돌 — 아래 D3).

### 5. 기획서 인용 vs 현재 코드(재확정) [P + Explore 2건]
| 기획서 | 현재 실제 위치 | 비고 |
|---|---|---|
| A1 authStore.ts:16-31 | stores/authStore.ts:16-31 AuthUser | 일치 |
| A2 App.tsx:524-575 | App.tsx:523-580 useOAuthCallback | 소셜은 토큰→/auth/me |
| A3 AuthPanel 218-242, 539-546 | AuthPanel.tsx:218-242, :538-549 | 일치 |
| A4 Settings 786-815 | SettingsScreen.tsx:780-815(입력), 저장 :153-196 | 저장이 매번 birth_date 전송 |
| A5 187-189, 512 | :187-191, :510-516 | |
| B1 HomeHeaderActions:131 | :131-141 (unread 폴링 :52) | 유일한 DmInbox 진입 |
| B2 DmInbox 120-157 | :120-170 | 공식 고정 행 :276-289 |
| B3 DmChat 148, 163-187 | :148(upload) · :163-187(pickImage) · 버튼 :396-398 | |
| B4 Feed 388-392 / MyMusic 862 / UserChannel 394 | FeedScreen.tsx:387-392 FAB · MyMusicScreen.tsx:851-862 · UserChannelScreen.tsx:386-394(본인 채널만) | 3곳이 전부 |
| B5 FeedCompose 25, 88-148, 161 | MAX_FEED_IMAGES :25 · 사진 버튼 :322-328 · 업로드 :161 · 아이템 첨부 :371-374 · 제출 :242 | |
| B6 FeedCard:140, TrackComments:79 | FeedCard.tsx:461-477 입력(:140 POST) · TrackComments.tsx:169-195 입력(:79 POST) | FeedCard 1곳이 4화면 공용 |
| B7 ReportModal:16 | ReportModal.tsx:16 타입 · 사용처 PlayerScreen:1468·FeedCard:483-484·DmChat:422 · MyReportsScreen.tsx:17 라벨 | 곡 댓글 신고·메뉴 없음 확정(삭제만 :147-150) |
| C1 ArtistInput 316-319, 647-741, 745-761 | 종류 카드 :1149-1158 · handleSelectKind :745-763 · 사진 올리기 :1161-1163(:647-680) · 이전 사진 :1165-1167(:710-741) · 사진 없이 :1169-1171(:684-705) · **화풍 이미지 업로드 :1257-1264(:788-800)** | 기획서에 화풍 이미지 누락 |
| C1 서버 | ArtistLoadingScreen.tsx:276-349 — **가상(cartoon)도 `file`(얼굴 사진)·`style_image` 전송**(:307-316, :334) | "그림체 허용"만으로는 사진이 들어간다 |
| C2 FaceVerify | 진입 2곳: ArtistInputScreen.tsx:640 · ArtistLoadingScreen.tsx:571-574 | |
| C3 ArtistResult 1093, 1396 / MusicGen 1539-1580, 2098 | ArtistResult :1307-1321(내 목소리) · :1393-1397 · :1093 / MusicGen :1530-1545 · :1547-1592(:1578) · :2033-2105(:2098) · 자동 적용 :998-1036 · VoiceManage :383-387 | |
| C4 CoverGeneration | :2463-2466 버튼 · :1210-1235 handleBgPhoto · 수정 모달 :1440-1448 | 글 설명·건너뛰기 대안 있음 |
| C5 TrackUpload | **진입 없음**(App.tsx:708 라우트만, MyMusic 진입 제거됨 :836-837) · 참고 음원 MusicGen :1822-1850(:1271) → MusicLoadingScreen.tsx:279-283 업로드 | |
| C6 Settings 480-501 | 아바타 :484 → :247-253 → :204-230 업로드 · :232-245 삭제 | "AI 아티스트 이미지로" 기능 없음 |
| C7 Settings 828-873 | 지역 :828-839 · SNS :840-872 | 소개글 입력 UI 없음, 지역·SNS 는 공개 화면에 미표시(bio 만 UserChannel :249-251) |
| D1 useRewardedSkipAd 93, 196-216 | preload :76-115 · requestOptions :93-95 · init :193-216 · 호출 App.tsx:637, fatigueGate.ts:126·189 | |
| D2 광고·쇼핑 | ArtistDetail :84-94·:116-124·:212-240 · ArtistCody openItemLink :354-362 → CodyItemCard.tsx:83 · ArtistResult 판매처 :895-901·:1025-1031 · Player :1366-1406(:1402) · Feed :235-245 · FeedDetail :145-154 · UserChannel :206-222 · MyMusic :649-665 · FeedCompose 아이템 첨부 :371 | Player 광고 fetch :693-712 는 렌더 안 됨(죽은 코드) |
| D3 consentTexts | consentTexts.ts:123-131(age14) · REQUIRED :212 | |
| 403 처리 | services/api.ts:44-55 — 전역 403 처리 없음(401 경고만) | 신규 코드 매핑 지점 |

### 6. 서버 제한 지점(현재 라우트:라인, 전부 /api 하위) [P]
| # | 엔드포인트 | 위치 | 현재 인증 |
|---|---|---|---|
| F1 | POST /dm/conversations · GET /dm/users/search · (방어) 메시지 전송 | dm.py:152 · :265 · dm_service.assert_can_dm :211 · send_message :533 | 필수 |
| F2 | POST /upload/dm-image · /upload/feed-image | upload.py:852 · :794 | 필수 |
| F3 | POST /feeds/ · PUT /feeds/{id} · POST /feeds/{id}/comments · POST /tracks/{id}/comments | feeds.py:312 · :587 · :822 · tracks.py:3098 | 필수 |
| F4 | /character/upload-original-photo · generate-sheet · generate-sheet-async · refine · POST locations(실제 장소 사진) · cartoon/cartoon-async 의 `file`·`style_image` | character.py:561 · :757 · :1653 · :2310 · :3193 · :989 · :1839 | 필수 |
| F4 | /face-verify/consent · guardian/request · verify · session (status·DELETE 는 허용) | face_verify.py:180 · :211 · :284 · :458 (:140 · :483) | 필수 |
| F5 | /voice-clone/create · {id}/verify · regenerate-phrase · check-availability (list·get·delete·audio 허용) · /generate/ 의 persona_model=voice_persona · /generate/{id}/start/ | voice_clone.py:147 · :292 · :404 · :420 · generate.py:750(→_create_generation_impl, 선체크 :794-802) · :955 | 필수 |
| F6 | /upload/cover-background · /upload/image(type cover·profile) · /tracks/upload · /generate/upload-reference/ · /generate/ 의 reference_audio_url | upload.py:152 · :186 · tracks.py:1836 · generate.py:419 · :867 | 필수 |
| F7 | POST /auth/me/profile-image(DELETE 허용) · PATCH /auth/me/profile 의 region·sns_links·bio | auth.py:1251 · :688 | 필수 |
| F8 | GET /business/ads/active · /ads/catalog · POST /ads/{id}/click | business.py:410 · :511 · :646 | **무인증**(click 은 optional) |
| G2 | POST /reports/ + 관리자 조치 | reports.py:43-52 · :535 · 증거 :147-250 · admin.py:850-935 | |
| G4 | POST /generate/lyrics/ | generate.py:625 | 필수 |
- 금칙어 필터: 서버·앱 어디에도 없음 확정(grep 금칙·욕설·profan·badword 0건; 닉네임 예약어 official.py:116 만 있음).
- 기존 미성년 로직(회귀 금지): 광고 분석에서 만14 미만 이벤트 제외 business.py:1091-1106 · 얼굴 인증 만19 미만 보호자 동의 face_verify.py:40-71 · DM ④ 만14 미만 수신 보호.

### 7. AdMob [P]
- react-native-google-mobile-ads **16.3.2**(package.json:40, node_modules 실측) → Android play-services-ads **25.0.0**, UMP 4.0.0(패키지 sdkVersions). 가족 정책 인증 목록 기준(19.0.0+) 충족 — 기획서와 일치.
- API: `MobileAds().setRequestConfiguration({ tagForChildDirectedTreatment, tagForUnderAgeOfConsent, maxAdContentRating: MaxAdContentRating.G, testDeviceIdentifiers })`(src/types/RequestConfiguration.ts, 전역·언제든 호출 가능) · 요청별 `RewardedAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true, serverSideVerificationOptions })`(RequestOptions.ts:31).
- 현재: 보상형 1종만. init(App.tsx:637 → useRewardedSkipAd.ts:193-216)은 테스트 기기만 설정. preload(:76-115)는 로그인 user.id 있을 때만(비로그인 광고 없음), requestOptions = SSV 만(:93-95). 사용자 전환 시 preloadedForUserId 로 재생성(:84).

## 기획서 vs 현재 코드 — 핵심 차이
1. **착장 카탈로그 빈 목록(F8) 그대로 하면 어린이는 아티스트 의상을 못 고른다**: 의상 피커가 /ads/catalog(폴백 /ads/active)를 쓴다(services/catalogService.ts:64-86). → 어린이에게는 목록은 주되 구매 링크·가격을 빼는 방식으로 변경(D9).
2. **가상(그림체) 경로도 얼굴 사진·화풍 이미지를 받는다** → F4 는 "cartoon 허용"이 아니라 "cartoon 의 file·style_image·original_object_name 거부"여야 한다. `/character/refine`(실사 다듬기, photo 필수)·`POST /character/locations`(실제 장소 사진)·`/upload/image`(곡 커버·프로필 직접 업로드)도 기획서 목록에 없던 사진 입구.
3. **DM 아이콘 숨김(B1)은 공식 공지·CS 답장 수신을 막는다** → 아이콘 유지, 받은편지함은 공식 계정 대화만·새 메시지 검색 숨김(D3).
4. **보호자 동의를 켜도 동의할 페이지가 없다**(2번) → E2 는 발송·본인확인뿐 아니라 착지 페이지까지 2차.
5. **보호자 허용(피드·댓글·친구 DM)은 보호자 관리 페이지(E5)가 생겨야 켤 수 있다** → 1차에서는 허용값이 항상 꺼짐 = 어린이 피드 쓰기·댓글·DM 은 항상 막힘(기획서 기본값과 같음). 코드는 허용값을 읽는 구조로 만들어 2차에서 저장소만 붙인다.
6. 이메일 로그인 응답에 생년월일이 없다 → age_group 을 login 응답에도 넣어야 앱이 즉시 모드를 안다.
7. TrackUpload 는 진입이 없다(서버만 막으면 충분, 앱은 화면 진입 가드만).
8. 전역 403 처리 없음 → 신규 코드 전용 인터셉터(성인은 이 코드를 받을 일이 없어 영향 0).
9. 소개글 입력 UI 없음 · 지역·SNS 는 공개 표시 없음 → C7 은 입력 숨김 + 서버 저장 무시로 충분.

## 단계 분할과 근거
**1차 = v3.232(이번) — 외부 계약·법무 없이 코드만으로 끝나고, 꺼 두면 성인에게 0 영향인 것**
- 서버: E1(age_group 등 응답 키 추가) · 킬 스위치 · F1~F8 · E4(플래그 켜짐 시 생년월일 잠금) · G1(자체 목록 금칙어 모듈, 1차 적용 대상 = 어린이만) · G2(곡 댓글 신고, 전 사용자 — 가산 기능) · G4(어린이 작사 지시문) · A5(어린이 프로필 완성 기준).
- 앱: A1(useIsChild) · A4(잠금 UI) · A5 · B1~B8(DM 공식만·피드/댓글 입력 숨김·사진 첨부 숨김·곡 댓글 신고·안전 안내) · C1~C7(가상 + 사진 없이만, 얼굴 인증·목소리·음원·배경 사진·프로필 사진·지역/SNS 숨김) · D1(아동 광고 설정) · D2(광고 카드·구매 링크 숨김) · 403 인터셉터.
- 근거: 현재 어린이 0명 + 신규 어린이 가입 불가(보호자 동의 OFF 유지) → 배포 후 실사용자 영향 0, 테스트 계정으로만 검증. 모든 분기가 `KIDS_MODE_ENABLED && age_group=='child'` 뒤에 있어 끄면 즉시 원복.

**2차 = v3.233 이후 — 외부 의존·법무·대표 결정이 필요한 것**
- E2 보호자 동의 실발송(문자·알림톡 업체) + 보호자 본인확인(PASS 등 업체) + **보호자 동의 착지 웹 페이지** → 그 뒤 GUARDIAN_CONSENT_ENABLED=true.
- E5 보호자 관리 웹(maidol.ai.kr/guardian 등: 피드 글·댓글·친구 DM 허용, 동의 철회, 삭제 요청) + 저장 테이블 → 1차 허용값 함수에 연결.
- E3 소셜 가입 연령 확인(생년월일 없는 계정 "연령 확인 필요" 상태 + API 차단) + 첫 생년월일 입력이 만14 미만이면 보호자 절차로 전환 + A2 앱 연령 확인 화면 + A3 가입 게이트 개편(차단 화면·"이전으로" 제거 — 보호자 동의가 켜져야 의미).
- 금칙어 전 사용자 적용(IARC "채팅 조정") · G3 어린이 피드에서 신고 접수 콘텐츠 숨김 · C6 "내 AI 아티스트 이미지를 프로필로" · 관리자 웹(생년월일 정정 도구, 신고 목록 track_comment 라벨 — admin_web 별도 배포).
- D3 처리방침 제10조·약관·계정 삭제 안내·앱 동의 문구(age14 문구 연령별 분리) — 법무 검토·7일 전 공지 · Play Console 타겟층·등급 설문·데이터 보안·심사용 어린이 계정 · AdMob 광고 ID 미전송 실기기 확인 · 나이 모름 로그인 사용자(72%) 광고 처리 결정.
- 근거: 업체 계약·법무·스토어 제출은 코드로 끝나지 않고, 보호자 동의 경로가 열리기 전에는 어린이가 실제로 가입할 수 없으므로 1차가 먼저 배포돼도 법적·정책 공백이 생기지 않는다. Play 가족 정책 심사는 타겟층에 만 13세 미만을 넣는 시점(2차 끝)부터 적용.

## 플래그 설계
- 서버 config.py(신규, 기존 키 불변):
  - `kids_mode_enabled: bool = False` (.env KIDS_MODE_ENABLED) — **킬 스위치**. False 면 모든 제한 함수가 DB 조회 없이 즉시 "제한 없음" 반환 → 성인·어린이 모두 현행과 같은 동작(응답에 추가 키만 존재).
  - `kids_test_child_user_ids: str = ""` (.env KIDS_TEST_CHILD_USER_IDS, 쉼표 구분 UUID) — QA 전용 강제 어린이(운영 DB 쓰기 없이 검증). kids_mode_enabled 가 True 일 때만 의미.
  - `word_filter_all_users: bool = False` (.env WORD_FILTER_ALL_USERS) — 금칙어를 성인에게도 적용(2차 결정 전까지 False).
- 판정(신규 services/kids_policy.py):
  - `age_group(birth_date, today=kst_today())` → 'child'(<13) · 'teen'(13) · 'adult'(≥14) · 'unknown'(None). KST 날짜 기준(기존 is_under_14 는 건드리지 않음).
  - `async is_child_user(user_id, conn=None) -> bool`: `if not settings.kids_mode_enabled: return False`(DB 0회) → 강제 목록 → PG `SELECT birth_date FROM users WHERE id=$1`(conn 없으면 풀에서 1회 acquire) → age_group=='child'. **'unknown'·'teen' 은 False.**
  - `optional_child_from_request(request)`: 무인증 라우트(F8)용 — 플래그 OFF 면 즉시 False, ON 이면 Authorization 헤더 JWT 를 조용히 디코드(Redis 세션·DAU 기록 없음 — get_current_user_optional 을 붙이면 DAU 통계가 바뀌므로 쓰지 않는다).
  - `kids_permissions(user_id)` → 1차 고정 `{"feed_write": False, "comment": False, "dm_friends": False}`(2차에 보호자 설정 테이블 조회로 교체).
  - `child_restricted(feature)` → `JSONResponse(403, {"error": "<한국어 안내>", "code": "child_restricted", "feature": feature})`. **error 에 사람이 읽는 문구**(앱 여러 화면이 data.error 를 그대로 표시 — 코드 문자열 노출 방지), 앱 인터셉터는 `code` 로 판별.
- 응답 키 추가(E1): /auth/me · /auth/login user · /auth/register user · PATCH /auth/me/profile 응답에 `age_group`, `kids_restricted`(= 플래그 && child), `kids_permissions`, `birth_date_locked`(= 플래그 && 기존 birth_date 있음 && 미인증 — 인증 계정은 기존 잠금 규칙 그대로). 기존 키·값 불변. login 은 SELECT 에 birth_date 컬럼만 추가(응답 기존 키 불변).
- 앱 판정: `useIsChild() = user?.kids_restricted === true`(서버가 플래그·나이를 모두 반영한 값 — 앱은 생년월일 계산 안 함). 구서버·키 없음 = false. 서버 킬 스위치를 끄면 다음 /auth/me(앱 재시작·세션 복원) 부터 앱도 일반 모드.
- 분기 원칙(성인 경로 불변 보장): 모든 서버 제한은 **핸들러 첫 부분의 `if await is_child_user(...)`: return child_restricted(...)** 한 줄 추가 형태 — 성인은 조건 False 로 기존 코드를 그대로 통과. 앱은 `isChild ? <대안> : <기존 JSX>` 가 아니라 `{!isChild && 기존 요소}` 로 감싸 기존 JSX·props 를 한 글자도 바꾸지 않는다.

## 변경 매트릭스

### 서버 (staging `/private/tmp/server_staging_v3232/{orig,new}` — orig 보존, main.py 무변경·DB 스키마 변경 없음)
| ID | 파일 | 변경 | 로그 prefix |
|---|---|---|---|
| S0 | config.py · services/kids_policy.py(신규) | 위 플래그 3종 + 판정·응답 헬퍼 | `[kids] check user=%s child=%s src=pg\|forced`(ON 일 때만) |
| S1 (E1) | routes/auth.py(me :646-686 · login :436-481 · register :403-426 · update_profile 응답 :868-897), models/user.py(age_group 순수 함수 위치 선택 가능) | 응답 키 4종 추가. login SELECT 에 birth_date | `[kids] me age_group=%s restricted=%s` (DEBUG) |
| S2 (E4) | routes/auth.py update_profile(:759-783 인근) | 플래그 ON + 기존 birth_date 있음 + 전달값이 **다르거나 null** → 400 `{"error":"생년월일은 가입 후 바꿀 수 없어요. 고객센터로 문의해주세요.","code":"birth_date_locked"}`. 같은 값 재전송·첫 입력(null→값) 통과. 인증 계정 기존 분기(:759-770) 우선 유지 | `[kids.birth_lock] blocked user=%s` |
| S3 (F7) | routes/auth.py update_profile · upload_profile_image(:1251) | 어린이: PATCH 의 region·sns_links·bio 키를 **조용히 제외**(200, 나머지 저장), 프로필 사진 업로드 403(삭제 허용) | `[kids.profile] strip fields=%d user=%s` |
| S4 (A5) | routes/auth.py :857-867 | 어린이만 완성 조건 = birth_date && gender(지역 제외). 성인 조건 불변 | `[star-econ] profile_bonus +10 user=%s kids=1` |
| S5 (F1) | routes/dm.py create_conversation(:152)·search_dm_users(:265) · services/dm_service.py assert_can_dm(:211) | 라우트: 나 또는 상대가 어린이이고 상대/내가 공식 계정이 아니면 403 child_restricted(검색은 어린이면 403). 서비스(send_message·공식 발송 경로 방어): 같은 조건 `_deny("child", …)` — 공식 계정↔어린이는 양방향 허용(공지·CS 유지). 기존 ①~⑥ 순서·문구 불변 | `[dm] gate denied stage=child` |
| S6 (F2·F6) | routes/upload.py(:852 dm-image · :794 feed-image · :152 cover-background · :186 image[cover·profile]) · routes/tracks.py(:1836 upload) · routes/generate.py(:419 upload-reference) | 어린이 403 | `[kids] restricted feature=%s user=%s` |
| S7 (F3) | routes/feeds.py(:312 create · :587 update · :822 comment) · routes/tracks.py(:3098 comment) | 어린이 && `kids_permissions` 해당 값 False → 403(1차는 항상) | 동일 |
| S8 (F4) | routes/character.py(:561 · :757 · :1653 · :2310 · :3193 → 403 / :989 · :1839 → `file`·`style_image`·`original_object_name` 중 하나라도 있으면 403, 텍스트·프리셋·use_saved_sheet 는 허용) · routes/face_verify.py(:180 · :211 · :284 · :458 → 403) | ⭐ 차감·잡 생성 **전**에 검사 | 동일 |
| S9 (F5·F6) | routes/voice_clone.py(:147 · :292 · :404 · :420) · routes/generate.py(_create_generation_impl — persona_model=='voice_persona' 또는 reference_audio_url 있음 → 403, 차감·gj 락 전 / :955 start 동일) | style_persona(아티스트 스타일)는 허용 | 동일 |
| S10 (F8) | routes/business.py(:410 active · :511 catalog · :646 click) | 어린이(optional_child_from_request): active·catalog 항목에서 product_url·link_url·price_krw 를 null 로(목록·이미지 유지 — 의상 피커 보호), click 은 기록 없이 `{"ok": true, "skipped": "child"}`. 성인·비로그인은 코드 경로·gzip 캐시 그대로(어린이 응답은 캐시 키 분리 또는 캐시 미사용) | `[kids.ads] strip links n=%d` |
| S11 (G1) | services/word_filter.py(신규) · constants/word_filter_ko.py(신규 자체 목록) | `check_text(text, child: bool) -> Optional[reason]`: 정규화(NFKC·공백·특수문자·반복 제거) 후 욕설·성적·혐오 목록 부분일치 + **어린이 전용 개인정보 패턴**(전화번호·이메일·URL/도메인·"카톡 아이디/오픈채팅"·주소(동·아파트 호수)·학교명(○○초/중)). 적용 지점 = feeds create/update·feed comment·track comment·DM 전송·PATCH nickname/company_name·/generate/lyrics prompt·/generate prompt·title·character user_text·곡 공개 title(upload-from-generation·PUT /tracks) — **1차 호출 조건 = 어린이 || word_filter_all_users**. 400 `{"error":"사용할 수 없는 표현이 들어 있어요. 다른 말로 바꿔주세요.","code":"word_filtered"}`, ⭐ 차감 전. 원문 로그 금지(길이·사유 코드만) | `[wordfilter] hit reason=%s len=%d child=%s` |
| S12 (G2) | routes/reports.py(:43 TARGET_TYPES·:47 _TARGET_META 에 `"track_comment": ("track_comments","author_id")`, 증거 스냅샷 분기 :216 패턴 복제) · routes/admin.py(:850 화이트리스트에 track_comment = comment 와 동일 규칙, delete 조치 = track_comments 삭제 + tracks.comment_count 음수 방지 감소 :926 패턴) · reports.py:304 · admin.py:619 목록 스냅샷 dict 에 track_comment 추가 | 전 사용자. 기존 4종 동작 불변 | `[report] create ok type=track_comment` · `[admin-report] track_comment delete` |
| S13 (G4) | routes/generate.py lyrics(:625) → 가사 생성 호출부 | 어린이만 사용자 프롬프트 뒤에 고정 지시문("초등학생이 불러도 괜찮은 표현만, 폭력·성적·욕설·음주 금지") 추가. 성인 프롬프트 바이트 동일. 이미지 생성은 현행 기본 안전 설정 유지(OpenAI moderation 파라미터 미지정=auto 확인) | `[kids.lyrics] child guard appended` |
- 서버 배포 후 운영 .env 추가(승인 필요): 1단계 `KIDS_MODE_ENABLED=false`(기본값과 같아 생략 가능) → 성인 무변화 확인 → 2단계 `KIDS_MODE_ENABLED=true`, `KIDS_TEST_CHILD_USER_IDS=<점검용 maidol.co.kr 계정 1개>`.

### 앱 (2_housing)
| ID | 파일 | 변경 | 로그 prefix |
|---|---|---|---|
| K1 (A1) | stores/authStore.ts(:16-31 AuthUser 에 age_group·kids_restricted·kids_permissions·birth_date_locked 선택 필드) · utils/kidsMode.ts(신규: `useIsChild()`, `isChildNow()`(store 동기 조회), `useKidsPermission(key)`, 문구 상수) | login/register/updateProfile 응답의 새 키가 기존 병합 로직으로 자연 반영되는지 확인(login 은 `set({user})` 전체 교체 :88 — 새 키 포함됨) | `[KidsMode] mode=child\|normal src=me\|login` (전환 시 1회) |
| K2 | services/api.ts(:44-55) | 응답 인터셉터: `data.code==='child_restricted'`(또는 data.detail?.code) → showAlert('어린이 계정에서는 쓸 수 없어요', data.error) 3초 중복 억제. 그 외 경로 불변 | `[KidsGate] 403 feature=%s` |
| K3 (A4·A5·C6·C7) | screens/SettingsScreen.tsx | 편집 모달: `birth_date_locked` 면 생년월일 입력 비활성 + "생년월일은 가입 후 바꿀 수 없어요. 고객센터로 문의해주세요." + **저장 patch 에서 birth_date 제외**(인증 잠금 :166-176 과 같은 방식). 어린이: 지역·SNS 입력 숨김 + patch 에서 region·sns_links 제외, ⭐10 배지 조건 = birth_date && gender, 아바타 선택지에서 "사진 선택" 제거("기본 이미지로"만), 계정 관리에 "온라인 안전 안내" 행 | `[KidsMode] settings child ui` |
| K4 (B8) | components/kids/KidsSafetyNotice.tsx(신규) · App.tsx(인증 사용자 확정 effect :630-634 옆) | 어린이 첫 로그인 1회(AsyncStorage `kids-safety-seen:{uid}`, try/catch) — 앱 내 다이얼로그(showAlert 또는 기존 모달 컴포넌트 규격)로 안전 안내 5항목(실명·학교·전화번호·주소 올리지 않기, 모르는 사람 연락 거절, 이상한 내용 신고, 보호자에게 말하기, 사진 올리지 않기). 설정 행에서 다시 보기 | `[KidsNotice] shown uid=%s` |
| K5 (D1) | hooks/useRewardedSkipAd.ts | preload(:76) 에서 isChildNow() 면 load 전에 `setRequestConfiguration({tagForChildDirectedTreatment:true, tagForUnderAgeOfConsent:true, maxAdContentRating:G, testDeviceIdentifiers 유지})` 1회 적용(모듈 플래그 `childAdConfigApplied`) + requestOptions 에 `requestNonPersonalizedAdsOnly:true` 추가, preload 재사용 키를 `userId+child` 로. **성인은 requestOptions 객체·init 호출이 현행과 동일**. 어린이 설정이 한 번 적용된 앱 실행 동안은 유지(D7) | `[KidsAd] child config applied` |
| K6 (B1·B2) | screens/DmInboxScreen.tsx | 어린이: 새 메시지(:120-128 헤더 아이콘)·검색 입력(:258-305) 숨김, 공식 고정 행(:276-289)만, 목록은 공식 계정 대화만 필터(방어), 요청 탭 숨김. HomeHeaderActions 는 **변경 없음**(D3) | `[KidsMode] dm official-only` |
| K7 (B3) | screens/DmChatScreen.tsx(:396-398) | 어린이: 사진 첨부 버튼 숨김 | — |
| K8 (B4·D2) | screens/FeedScreen.tsx(:387-392 FAB · :235-245 아이템 링크) · screens/MyMusicScreen.tsx(:851-862 · :649-665) · screens/UserChannelScreen.tsx(:386-394 · :206-222) · screens/FeedDetailScreen.tsx(:145-154) | 어린이 && !feed_write: 글쓰기 진입 숨김. 어린이: 아이템 카드의 구매 링크 탭 비활성(카드·이미지 표시는 유지) | — |
| K9 (B5) | screens/FeedComposeScreen.tsx | 진입 방어: 어린이 && !feed_write 면 showAlert 후 goBack. (2차 보호자 허용 대비) 어린이면 사진 버튼(:322-328)·아이템 첨부(:371-374) 숨김 | `[KidsGate] compose blocked` |
| K10 (B6) | components/feed/FeedCard.tsx(:461-477) · components/common/TrackComments.tsx(:169-195) | 어린이 && !comment: 입력 행 숨김 + "보호자가 허용하면 댓글을 쓸 수 있어요" 한 줄. 답글 버튼도 숨김 | — |
| K11 (B7·G2) | components/common/TrackComments.tsx · components/ReportModal.tsx(:16 타입에 'track_comment') · screens/MyReportsScreen.tsx(:17 라벨 "곡 댓글") | **전 사용자**: 남의 곡 댓글에 "신고" 텍스트 버튼(FeedCard 댓글 신고 :424-428 과 같은 조건 `!canDelete && user`) → ReportModal(targetType='track_comment'). 구서버 400 이면 "지원하지 않는 신고 대상" 문구 그대로 표시 | `[TrackCommentReport] open/submit` |
| K12 (C1) | screens/ArtistInputScreen.tsx · screens/ArtistLoadingScreen.tsx | 어린이: 종류 카드(:1149-1158)에서 실사 숨김 → 가상 자동 선택(forceKind 'real' 파라미터도 가상으로 강등 + 안내), 사진 올리기(:1161-1163)·이전 사진(:1165-1167)·화풍 이미지 업로드(:1257-1264) 숨김, "사진 없이 만들기"·화풍 프리셋 유지. 초안 복원 시 photoUri·reuseOriginal·styleImageUri 무시. ArtistLoading(:276-349)은 어린이면 file·style_image·original_object_name 을 붙이지 않음(방어) + 403 child_restricted 를 기존 오류 경로로 표시 | `[KidsGate] artist virtual-only` |
| K13 (C2) | screens/FaceVerifyScreen.tsx | 진입 가드(어린이면 showAlert 후 goBack) — 진입점 2곳(ArtistInput :640 · ArtistLoading :571-574)은 어린이가 사진 경로에 못 가므로 도달 불가지만 방어 | — |
| K14 (C3) | screens/ArtistResultScreen.tsx(:1307-1321 · :1393-1397 · :1093 · 판매처 :1025-1031) · screens/MusicGenerationScreen.tsx(:1530-1545 · :1547-1592 · :2033-2105 · 편집 모달 선택지 :605·:624 · 자동 적용 :998-1036 · 참고 음원 :1822-1850) · screens/VoiceManageScreen.tsx(:383-387) · screens/VoiceCloneWizardScreen.tsx(진입 가드) | 어린이: "내 목소리" 선택지·목소리 만들기·관리 진입 숨김, 연결 클론 자동 적용 skip, 참고 음원 "파일 업로드" 숨김(다른 선택지 유지), 판매처 보기 숨김. 간편 목소리(voice_preset) 유지 | `[KidsGate] voice hidden` |
| K15 (C4) | screens/CoverGenerationScreen.tsx(:2463-2466 · 수정 모달 :1440-1448) | 어린이: 배경 "사진 올리기" 숨김(글 설명·건너뛰기 유지) | — |
| K16 (C5) | screens/TrackUploadScreen.tsx | 진입 가드(현재 진입 없음 — 방어만) | — |
| K17 (D2) | screens/ArtistDetailScreen.tsx(:212-240 광고 카드) · screens/ArtistCodyScreen.tsx(:354-362 openItemLink) · components/cody/CodyItemCard.tsx(:83 링크 버튼) · screens/PlayerScreen.tsx(:1366-1406 "자세히 보기") | 어린이: 광고 카드 섹션 숨김, 구매 링크 버튼 숨김(의상 선택·착용 표시는 유지) | — |
- 앱 배포: 서버만 배포해도 제한은 작동(구 앱은 일반 오류 문구로 표시). 앱 숨김·광고 설정은 새 빌드부터(웹 app.maidol.ai.kr 도 같은 코드).

## 역할 분담 (파일 충돌 없음)
- **backend-dev**: S0→S1→S2~S13 순서(S0 kids_policy 를 먼저 만들어 나머지가 import). staging new/ 에서만, orig 보존, 로컬 구문 검사 + 판정 단위 테스트(age_group 경계: 생일 전날·당일·윤년 2/29, KST 자정) + TestClient 가능한 라우트 스모크. 배포 직전 md5 재대조(위 기준값 — auth.py·tracks.py 는 오늘 다른 세션 변경분 병합).
- **app-dev 1조(기반·설정·광고)**: K1 · K2 · K3 · K4 · K5 — stores/authStore.ts, utils/kidsMode.ts(신규), services/api.ts, screens/SettingsScreen.tsx, components/kids/KidsSafetyNotice.tsx(신규), App.tsx, hooks/useRewardedSkipAd.ts. **K1 계약(`useIsChild`, `isChildNow`, `useKidsPermission('feed_write'|'comment'|'dm_friends')`)을 첫 커밋으로 먼저 올려** 2·3조가 import.
- **app-dev 2조(소셜·피드·재생)**: K6 · K7 · K8 · K9 · K10 · K11 + K17 중 PlayerScreen — DmInboxScreen, DmChatScreen, FeedScreen, MyMusicScreen, UserChannelScreen, FeedDetailScreen, FeedComposeScreen, FeedCard, TrackComments, ReportModal, MyReportsScreen, PlayerScreen.
- **app-dev 3조(창작·얼굴·목소리·광고 카드)**: K12 · K13 · K14 · K15 · K16 + K17 중 ArtistDetail·ArtistCody·CodyItemCard — ArtistInputScreen, ArtistLoadingScreen, FaceVerifyScreen, ArtistResultScreen, MusicGenerationScreen, VoiceManageScreen, VoiceCloneWizardScreen, CoverGenerationScreen, TrackUploadScreen, ArtistDetailScreen, ArtistCodyScreen, components/cody/CodyItemCard.tsx.
- **test-designer**: 아래 항목 + 성인 응답 스냅샷 비교 스크립트.

## 회귀 위험과 보호 방법
| 위험 | 보호 |
|---|---|
| 나이 모름 72%(31명)가 어린이로 오판 | age_group 'unknown' → 제한 없음(판정 함수 단위 테스트 + 실측 31명 샘플 /auth/me kids_restricted=false) |
| 성인 요청에 추가 DB 조회·지연 | 플래그 OFF = 조회 0. ON = 제한 대상 라우트에서만 PK 조회 1회(피드 목록·차트·재생 등 읽기 경로엔 없음). F8 무인증 라우트는 JWT 디코드만(DAU·Redis 무접촉) |
| E4 잠금으로 기존 앱 저장 실패 | 같은 값 재전송 통과(현 앱이 매번 보냄), 첫 입력 허용. 잠금은 플래그 ON 에서만. 새 앱은 잠금 시 필드를 보내지 않음. 구 앱에서 생년월일을 지우거나 바꾸는 경우만 400(의도) |
| F8 의상 피커 빈 화면 | 목록 유지 + 링크·가격만 제거(D9). gzip 캐시가 어린이/성인 응답을 섞지 않게 캐시 분리 |
| 공식 공지·CS DM 끊김 | DM 아이콘 유지, 공식 계정↔어린이 양방향 허용(S5), 브로드캐스트(_deliver_official_message) 경로 테스트 |
| 신규 오류 코드가 기존 화면에 코드 문자열로 노출 | error=한국어 문구, code 별도(S0). 인터셉터는 code 만 봄 |
| 광고 설정이 성인에게 새어감 | 성인만 쓰는 앱 실행에선 setRequestConfiguration 추가 호출 없음·requestOptions 동일. 어린이 로그인 후 성인 전환 시에만 아동 설정 유지(D7, 보수적) |
| 금칙어 오탐으로 성인 작업 중단 | 1차 성인 미적용(플래그 OFF). 어린이 오탐은 문구로 안내, ⭐ 차감 전 검사 |
| v3.228 genJobs 락·환불 순서 | 어린이 검사는 gj.user_lock·차감 **전**(generate.py:766 분기 이전 또는 impl 선두) — 성인 경로는 조건 False 로 기존 순서 그대로 |
| v3.227 사진 소실 가드·H-1 | 어린이는 사진 경로 자체가 없음. 성인 photoIntent·reuseOriginal 로직 불변(K12 는 {!isChild && …} 래핑만) |
| v3.229·v3.230 디렉터 복귀·⭐ 확인·이탈 가드 | 해당 화면의 과금·확인 코드 미수정. 숨김은 선택지 렌더만 |
| v3.230 DM 본인인증 차단 유지·공식 DM 허용 | assert_can_dm ①~⑥ 불변, 어린이 조건은 추가 단계 |
| v3.230b/c 닉네임 규칙 | 닉네임 검증 순서 불변, 금칙어는 어린이만·규칙 검증 뒤 |
| v3.231 답변 편집·검색 | 미접촉(ArtistInput 은 종류 카드·사진 버튼만, 편집 로직 미수정) |
| 곡 댓글 신고(가산) | 기존 댓글 목록 응답·삭제 불변, 신고 버튼 조건 = FeedCard 와 동일 |
| 기존 미성년 로직(광고 분석 제외·얼굴 인증 만19·DM ④) | 코드 미수정(회귀 테스트로 확인) |
| 다른 세션 동시 수정(auth.py·tracks.py 오늘 변경) | 배포 직전 md5 재대조·3-way 병합, 백업 태그 pre-v3232-live |

## test-designer 에게 줄 테스트 항목
**A. 성인·기존 기능 회귀(플래그 OFF 와 ON 두 번 모두 수행)**
1. 응답 스냅샷 비교(스크립트): 점검용 성인 계정으로 배포 전·후 /auth/me · /auth/login · PATCH /auth/me/profile(같은 값) · /feeds/timeline · /tracks/search?q=로맨스 · /charts/* · /business/ads/catalog?category=상의(항목 키 집합·product_url 유무) · /dm/conversations · /dm/unread-count · /face-verify/status · /voice-clone/list · /character/me → **차이는 추가 키 4종(age_group·kids_restricted·kids_permissions·birth_date_locked)만**.
2. 가입·로그인: 이메일 가입(성인, 추천코드 포함 ⭐50+50·베타 ⭐50) · 만14 미만 생년월일 → "준비 중" 차단 화면(현행) · 로그인·로그아웃·앱 재시작 세션 복원 · 구글·카카오 소셜 로그인(웹·네이티브 딥링크) · 비밀번호 재설정 · 회원탈퇴.
3. 설정: 기획사 정보 편집(생년월일 없음 계정: 첫 입력 → 저장·⭐10 완성 보상 / 있음 계정: 같은 값 저장 200·다른 값·지우기 400 문구(플래그 ON)·플래그 OFF 면 현행대로 변경 가능) · 인증 계정 잠금 현행 · 지역·SNS 저장 · 닉네임 변경(v3.230) · 프로필 사진 업로드·기본 이미지 · 공지사항 · 고객센터 오류신고 DM.
4. 창작: 작사(⭐ 확인·피로 게이트·genJobs 복귀) · 작곡(내 목소리 클론 적용·참고 음원 업로드·연주곡) · 커버(배경 사진·글·건너뛰기·다듬기) · 영상 디렉터 · 아티스트 실사(사진·이전 사진·사진 없이·얼굴 인증 동의·만19 미만 보호자 동의 안내)·가상(사진·화풍 이미지·프리셋)·의상 피커(카탈로그 목록·구매 링크·찜)·다듬기(refine)·재생성 · 보이스 클론 위저드·관리 · 답변 편집(v3.231).
5. 소셜: 피드 글쓰기(사진 4장·아이템 첨부·BGM) · 수정·공개 전환·삭제 · 좋아요 · 댓글·답글·삭제 · 피드·댓글·곡·DM 메시지 신고 · 곡 댓글 신규 신고(성인 → 관리자 신고 목록에 track_comment 표시·삭제 조치 시 댓글 수 감소·본인 댓글 신고 400·중복 409) · 내 신고 내역 라벨 · DM(인증 계정 검색·요청·수락·거절·차단·사진·공식 CS) · 알림.
6. 재생·차트·검색: 차트(본인 제외 v3.230)·검색(로맨스·장르 v3.231)·플레이어 착장 탭 "자세히 보기"·곡 댓글 · 재생목록·큐(비회원·승계) · 공유.
7. 광고·별: 디렉터 휴식 창 "광고 보고 30분 단축"(실기기: 로드·시청·SSV 적립 — 성인은 requestOptions 에 requestNonPersonalizedAdsOnly 없음 로그 확인) · 출석·스타 내역·관리자 스타 지급 알림.
8. 관리자·비즈: 관리자 웹 신고 처리(기존 4종 + track_comment) · 사용자 관리 · 비즈 대시보드(만14 미만 이벤트 제외 로직 현행).

**B. 어린이 모드(KIDS_MODE_ENABLED=true + KIDS_TEST_CHILD_USER_IDS=점검 계정)**
9. /auth/me·login: age_group(실제 나이값)·kids_restricted=true·kids_permissions 전부 false. 앱: 로그 `[KidsMode] mode=child`, 첫 로그인 안전 안내 1회(재시작 시 재표시 없음, 설정에서 다시 보기).
10. 서버 우회 차단(curl 로 직접 호출, 전부 403 code=child_restricted, ⭐ 잔액 불변): F1 대화 시작(일반 사용자)·검색 / 공식 계정 대화 시작·전송 = 성공 / 다른(인증) 계정 → 어린이 대화 시작 403 / 관리자 공지 발송이 어린이에게 도착 · F2 dm-image·feed-image · F3 피드 작성·수정·피드 댓글·곡 댓글 · F4 실사 시트(sync·async)·원본 업로드·refine·장소 사진·cartoon+file·cartoon+style_image·cartoon+original_object_name / cartoon 텍스트·프리셋 = 성공 · 얼굴 인증 consent·guardian/request·verify·session / status·DELETE = 200 · F5 클론 create·verify·regenerate·check-availability / list = 200 · generate persona_model=voice_persona·reference_audio_url · F6 cover-background·/upload/image(cover·profile)·tracks/upload·upload-reference · F7 프로필 사진 업로드 403·PATCH region/sns_links 무시(200, 값 저장 안 됨) · F8 catalog·active 항목 product_url/price null·이미지 유지, click skipped.
11. 금칙어(어린이): 닉네임·기획사명·작사 프롬프트·작곡 제목·아티스트 설명·곡 공개 제목에 욕설/전화번호/URL/학교명 → 400 word_filtered 문구, ⭐ 미차감. 정상 문장 통과(오탐 샘플 20개: "시발점", "개나리", "010 스타일" 등 경계 사례 기록). 성인 동일 입력 = 통과(플래그 OFF).
12. 앱 UI(어린이): DM 아이콘 유지·받은편지함 공식만·검색·새 메시지 없음·사진 첨부 없음 · 피드 FAB·내 채널·보관함 글쓰기 없음 · 피드·곡 댓글 입력 없음(목록 읽기 가능, 신고 가능) · 아티스트: 실사 카드 없음·가상 자동·사진/이전 사진/화풍 이미지 버튼 없음·사진 없이 만들기 → 생성 성공 · 목소리: 내 목소리·만들기·관리·참고 음원 업로드 없음, 간편 목소리 가능 · 커버: 배경 사진 버튼 없음 · 설정: 생년월일 잠금 표시·지역/SNS 없음·⭐10 조건(생년월일+성별)·아바타 "사진 선택" 없음 · 광고 카드·구매 링크·판매처 보기 없음(의상 선택·착용 이미지는 보임) · 곡 발행·차트·검색·재생·플레이리스트·출석·스타 정상.
13. 광고(실기기, 어린이): 로그 `[KidsAd] child config applied` 후 광고 로드·시청·SSV 적립 정상 · 로그아웃 → 성인 로그인(같은 실행) = 아동 설정 유지(D7) · 앱 재시작 후 성인 = 현행.
14. 킬 스위치: KIDS_MODE_ENABLED=false 로 되돌려 재기동 → 같은 테스트 계정 kids_restricted=false, 모든 F 엔드포인트 성인과 동일, 앱 재시작 시 일반 모드.
15. 생일 경계: kids_policy 단위 테스트(만 13세 생일 전날 child·당일 teen, KST 00:00~08:59 UTC 전날 구간, 2/29 생) · 테스트 계정 강제 목록에서 빼면 즉시 일반.
16. 구 앱(현재 스토어 빌드) + 신 서버: 성인 전 기능 정상(키 추가만) · 어린이 계정이 차단 API 호출 시 기존 오류 표시 경로로 한국어 문구(코드 문자열 노출 없음).
17. 공통: 팝업 전부 showAlert/앱 내 다이얼로그, 표기 MAIDOL, 이모지 ⭐ 외 0, 로그에 생년월일·전화번호·원문 미기록.

## 대표 결정 필요 (기본값으로 진행)
- **D1 킬 스위치 운영값**: 기본 = 배포는 OFF → 성인 스냅샷 동일 확인 → QA 계정으로 ON 검증 → **ON 유지**(현재 어린이 0명이라 켜도 실사용자 영향 0, 잠금 E4 만 성인에게 보임).
- **D2 보호자 동의(guardian_consent_enabled)**: 기본 = **OFF 유지**. 이유: 발송 mock·본인확인 mock·동의 착지 페이지 없음 → 켜면 만14 미만 가입자가 영구 대기. 2차에서 업체 계약·착지 페이지 후 ON.
- **D3 어린이 DM**: 기본 = 이번엔 **완전히 끔(공식 계정 공지·고객센터만)**, 아이콘은 유지. 친구 DM 은 2차 보호자 관리 이후.
- **D4 금칙어 방식·범위**: 기본 = 자체 단어 목록(서버 상수) + **어린이만 적용**. 전 사용자 적용(WORD_FILTER_ALL_USERS)은 오탐 검토 후 2차 결정 — IARC "채팅 조정=예" 의 전제.
- **D5 최소 가입 나이**: 기본 = 이번엔 정하지 않음(가입 자체가 막혀 있음). 2차 보호자 동의 개통 시 결정(후보: 없음 / 만 7세).
- **D6 생년월일 잠금 대상**: 기본 = 킬 스위치 ON 이면 **전 사용자**(이미 입력된 값 변경·삭제 불가, 첫 입력 허용, 정정은 고객센터 → 2차 관리자 도구 전까지 DB 수정은 대표 승인). 대안: 만 14세 미만만 잠금.
- **D7 광고 계정 전환**: 기본 = 어린이 계정이 로그인한 앱 실행 동안은 아동 광고 설정 유지(앱 재시작 시 초기화). 성인만 쓰는 기기는 현행과 동일.
- **D8 나이 모름 로그인 사용자(31/43) 광고**: 기본 = 1차 현행(맞춤 광고). Play 가족 정책 제출 전(2차) E3 로 생년월일을 받은 뒤 다시 결정(가족 정책은 "나이 모름"도 아동 설정 요구).
- **D9 착장 카탈로그(F8)**: 기본 = 어린이에게도 의상 목록·이미지는 제공, 구매 링크·가격·광고 카드만 제거(기획서의 "빈 목록"은 아티스트 의상 선택을 깨뜨림).
- **D10 프로필 사진(C6)**: 기본 = 1차는 기본 아바타만(업로드 차단), "내 AI 아티스트 이미지로 지정"은 2차 신규 기능.
- **D11 곡 댓글 신고(G2)**: 기본 = 모든 사용자에게 추가.
- **D12 테스트 계정 강제 지정(KIDS_TEST_CHILD_USER_IDS)**: 기본 = 도입, 점검용 maidol.co.kr 계정 1개. Play 심사용 어린이 계정은 2차에 보호자 동의 절차로 정식 생성.
- **D13 착장 찜(위시)**: 기본 = 어린이도 유지(구매 링크는 없음).
- **D14 앱 출시**: 기본 = 서버 먼저(제한 즉시 작동), 앱은 다음 스토어 빌드에 포함(버전 번호는 대표 결정).

## 외부 의존(코드 밖) — 2차 선행 과제
1. 보호자 동의 문자·알림톡 발송 업체 계약 + 보호자 본인확인(PASS·휴대폰 인증) 업체 계약 — 가장 오래 걸림, 먼저 착수.
2. 개인정보처리방침 제10조(⑤⑥⑦ 초안)·제2조 ⑨·이용약관·계정 삭제 안내 개정(법무 검토, 시행 7일 전 공지, lotusai.co.kr·maidol.ai.kr 게시).
3. Play Console: 타겟층(6~8·9~12세 추가)·콘텐츠 등급 재설문·데이터 보안·심사용 어린이 계정·영문 안내 — 앱 기능과 처리방침 게시 이후.
4. AdMob 아동 설정 시 광고 ID 미전송 실기기 확인(네트워크 로그), iOS 출시 시 Apple 연령 등급 재답변.

## 파일 변경 비율 추정
- 앱: TS/TSX 215개 중 수정 29 + 신규 3(utils/kidsMode.ts · components/kids/KidsSafetyNotice.tsx · (선택) constants/kidsTexts.ts) ≈ **15%**.
- 서버: .py 119개 중 수정 15(config·auth·dm_service·dm·upload·feeds·tracks·character·face_verify·voice_clone·generate·business·reports·admin·models/user) + 신규 3(services/kids_policy.py · services/word_filter.py · constants/word_filter_ko.py) ≈ **15%**.
- 합계 ≈ 50 / 334 ≈ **15% — 40% 미만.** 단 각 파일 변경은 "가드 한 줄 + 래핑" 위주라 줄 수 기준으로는 더 작음(최대: kids_policy·word_filter 신규, ArtistInputScreen·SettingsScreen·TrackComments).

## 배포 계획
1. 사전: 운영 **DB 백업**(pg_dump -Fc + mongodump archive gzip → EC2 `/home/ubuntu/maidol/backups/pre_v3232_<ts>`, 09-24 pre_test_purge 절차와 동일) — 1차는 스키마·데이터 쓰기가 없지만 E4·F7 이 사용자 입력 저장 경로를 바꾸므로 권장. 이미지 태그 `pre-v3232-live`(현재 latest). 진행 중 생성 job 0 확인.
2. 서버: staging new/ → 구문 검사·단위 테스트 → 배포 직전 md5 재대조(기준값 위, 불일치 파일은 3-way 병합) → **사용자 승인** → 코드 반영·docker build·컨테이너 교체(KIDS_MODE_ENABLED 미설정=OFF) → 기동 로그 확인 → 테스트 A-1 스냅샷 비교(추가 키만) → 5분 무오류.
3. 킬 스위치 ON(**승인 필요**): .env 에 `KIDS_MODE_ENABLED=true`, `KIDS_TEST_CHILD_USER_IDS=<점검 계정>` 추가 → 컨테이너 재생성(.env 반영은 재시작 필요) → 테스트 B → 문제 시 .env 원복 + 재생성(이미지 교체 불필요) 또는 `maidol-app:checkpoint-pre-kids-20260925` 로 롤백.
4. 앱: frontend 커밋·push → 웹(app.maidol.ai.kr) 배포 → 스토어 빌드는 대표 일정.
5. 2차 착수 전 이번 REPORT 에 실측(어린이 0·나이 모름 31) 재기록.

규칙: 서버 수정은 server_staging_v3232 에서만(orig 보존). 프로덕션 쓰기(코드 반영·.env·DB)는 사용자 승인 뒤. 비밀값·개인정보 미기재(테스트 계정 id 는 REPORT 에만 앞 8자). 팝업 showAlert/앱 내 다이얼로그, 표기 MAIDOL, 이모지 ⭐만. 코드 수정·커밋은 계획 승인 뒤 team-dev 루프에서.

# v3.233 (2026-09-25) — 보호자 관리 API(E5)·심사용 계정(성인·어린이)
**요청 원문**: "지금 google play 어른 계정이 있으니까 그걸 기반으로 어린이 계정하나 만들자." / (붙여넣은 절차: 백엔드가 `2_housing/백엔드_요청_보호자관리.md` 관리 API → 어린이 테스트 계정 `playreview_child@lotusai.co.kr` 관리 링크를 휴대폰 인증 없이 발급 → Play Console 안내문 `[링크]`) / "어른계정은 playreview@lotusai.co.kr 로 만들어줘. 바로 진행해줘."

**정본 사양**: `/Users/pearl/TripleJ/2_housing/백엔드_요청_보호자관리.md` (§1 링크 형식, §2 decide 변경, §3 저장값, §4 새 API 6종, §5 심사용 otp_exempt, §6 admin, §7 로그). 보호자 웹 페이지는 홈페이지 저장소 `maidol/www/guardian/index.html`(다른 세션 제작·배포 완료, `https://maidol.ai.kr/guardian/`, `?demo=consent|manage` 미리보기) — 이 페이지의 요청·응답 계약을 그대로 맞춘다(페이지 소스를 읽어 확인).

**Plan verification findings (오케스트레이터 실측)**
- DB: `playreview@lotusai.co.kr`·`playreview_child@lotusai.co.kr` 없음(lotusai 도메인은 kimpearl@ 1개). `guardian_consents` 열: id, child_user_id, guardian_name, guardian_phone, consent_token, status, method, requested_at, decided_at, consent_type — manage_token·feed_post·dm_friends·otp_exempt·revoked_at 없음 → **DB 스키마 추가 필요(ALTER, 대표 1줄 실행)**. `user_consents`(consent_key terms/privacy/overseas/marketing/age14 등, version 2026-07-30.v1). users.account_status 값 active/pending_consent/withdrawn — `suspended` 신규.
- v3.232 배포 상태: KIDS_MODE_ENABLED off(09:55Z), kids_policy.py 가 kids_permissions(feed_write·comment·dm_friends) 를 내려주되 1차는 전부 false. 보호자 동의 `guardian_consent_enabled` off, 알림 어댑터 mock.
- 앱: utils/kidsMode.ts useKidsPermission('feed_write'|'comment'|'dm_friends'), 2조 DM 은 어린이에게 공식 계정만 표시.

**범위**
- S(서버): §2 decide 에서 manage_token 발급·mock 응답 manage_url, 알림 어댑터 consent_url 을 `https://maidol.ai.kr/guardian/?token=` 형식으로, §3 저장(별도 테이블 `guardian_manage` 권장 — 기존 guardian_consents 무변경이 회귀상 안전, 판단은 backend), §4 API 6종(`/api/guardian/manage/{token}` GET·otp·otp/verify·settings PUT·revoke·delete-request, 세션=Redis 30분, OTP 5분·1시간 5회·5회 오답 폐기, OTP 발송은 mock 어댑터 — 실발송 업체 미계약), 보호자 설정 → kids_policy 의 kids_permissions(feed_post → feed_write·comment, dm_friends) 연결 + F1 DM 제한에 dm_friends(서로 팔로우만) 반영, revoke → suspended 로그인 403, delete-request 운영 대기열(기존 탈퇴/삭제 요청 저장 구조 재사용 또는 신규 컬렉션). 라우터 등록은 main.py 무변경 원칙 — 불가피하면 보고(대표 승인 후 최소 변경). §6 admin 페이지는 관리자 웹(다른 세션 소유) 대신 **admin API 만**(목록·관리 링크 재발송·심사용 발급) 또는 스크립트로 대체 — 판단 보고.
- 계정: 성인 `playreview@lotusai.co.kr`(성인 생년월일, 약관 동의 기록, 일반 가입과 동일 필드)·어린이 `playreview_child@lotusai.co.kr`(만 10세, 보호자 동의 agreed mock 기록, guardian_manage otp_exempt=true, 만료 없는 manage 링크) 생성 스크립트 — **비밀번호는 대표가 터미널에서 숨김 입력(오케스트레이터·로그·argv·셸 히스토리에 남지 않게)**, 멱등(이미 있으면 중단), dry-run 기본.
- A(앱): 보호자 허용 반영 — useKidsPermission 이 서버값을 그대로 쓰는지 확인, dm_friends=true 인 어린이는 DM 에서 서로 팔로우한 사람과의 대화·새 대화(상대 찾기는 맞팔 목록에서만, 검색 없음) 가능, feed_post=true 면 글쓰기·댓글 허용(사진 첨부는 계속 금지). suspended 로그인 403 안내 문구.
- 킬 스위치: 어린이 모드 on 전환은 계정 생성·배포 뒤 대표 승인(`.env`).

**회귀 보호**: 성인·킬 스위치 off 동작 불변(v3.232 동일성 스위트 재사용), 기존 guardian consent request/decide 흐름(플래그 off 상태) 불변, 로그 규칙(§7) 준수.
**배포**: DB 백업 → ALTER/CREATE 1줄 → 코드 반영 → 빌드·재생성(off) → 스모크 → 계정 생성 스크립트(대표) → 킬 스위치 on(대표) → 심사용 관리 링크 확인.
