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
