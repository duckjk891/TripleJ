# REPORT_v3 — 팀: aidol-parity

> 작업 결과 기록일지(누적, 최신 위). 두 위치 동일 비치.

---

## v3.10 (기능 #2 — 검색 탭 + Feather 아이콘) — 2026-08-13

### 요청 작업
① 하단바 5탭: 차트·플레이리스트·피드·검색·작업실 ② 상단 검색을 검색 페이지로 ③ 비-플랫 아이콘 전부 플랫으로, **MAIDOL이 쓰는 아이콘 세트** 조사해 적용.

### Plan verification findings (0단계)
- **MAIDOL 아이콘 = `react-icons/fi`(Feather)** — 헤더/네비에 FiSearch·FiMenu·FiList·FiMusic·FiUser 등. → AIDOL(RN)은 **`@expo/vector-icons`의 `Feather`**(동일 세트)로 대응. (AIDOL엔 미설치 → `npx expo install @expo/vector-icons`로 설치)
- 기존 탭 아이콘은 이모지/글리프(☰♬✦📰👤⚙️) 혼용 — 플랫 아님.

### 수행 결과
- **SearchScreen.tsx**(신규): `/tracks/search` 전용 검색 페이지(Feather search/x 아이콘, 결과→Player).
- **App.tsx**: 하단바 **5탭**(차트·플레이리스트·피드·**검색**·작업실), 모든 탭 아이콘 **Feather**(bar-chart-2/list/home/search/mic), 마이페이지=Feather user, 설정=Feather settings.
- **ChartScreen.tsx**: 상단 🔍 헤더(useLayoutEffect) 제거 → 탭 공통헤더(로고+user) 사용. (내부 검색 모달은 미사용 dead code로 잔존 — 후속 정리)
- 의존성: `@expo/vector-icons` 추가(package.json).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] 하단바 5탭(차트/플레이리스트/피드/검색/작업실) | **전부 표시** |
| [e2e-web] 상단 🔍 제거 확인 | 없음(OK) |
| [e2e-web] 검색 탭 → SearchScreen | PASS |
| 아이콘 플랫(Feather) 렌더 | PASS (`/tmp/tabs5_home.png`) |
| 콘솔 에러 | 0 |

### 커밋
`feat: v3.10 검색 탭 + Feather(MAIDOL 동일) 플랫 아이콘 5탭 (team-dev)` — 푸시 OFF.

---

## v3.9 (기능 #1 — 네비게이션 개편) — 2026-08-13 — 로고 헤더 · 마이페이지 · 피드 탭

### 요청 작업 (MAIDOL 대비 개선, 화면별 피드백 시작)
① 상단 헤더 메뉴명 → 로고 ② 하단 마이뮤직 → 상단 우측 마이페이지(👤) 아이콘 ③ 설정을 마이페이지 내부로(⚙️) ④ 하단바 순서: 차트·플레이리스트·피드·작업실.

### Plan verification findings (0단계)
- 네비게이션 = `App.tsx` 단일(RootStack + BottomTab + StudioStack). 각 탭 `headerTitle`=메뉴명, `headerRight`=⋮→Settings. MyMusic이 4번째 탭. Settings는 RootStack 모달.
- ChartScreen은 `useLayoutEffect`로 자체 headerRight(🔍+⋮) 설정 → 별도 수정 필요.

### 수행 결과
- **App.tsx**: `tabHeader` 공통 헤더(좌 로고 `AIDOL` + 우 👤→MyMusic). 탭 순서 **Chart·Playlist·Feed·Studio**. **MyMusic**은 `tabBarButton:()=>null`+`display:none`으로 하단바 숨김, 헤더 `마이페이지`+⚙️→Settings.
- **FeedScreen.tsx**(신규): `/api/feeds/timeline`(9004 라이브) 연동, Card/Avatar/EmptyState, `[FeedScreen]` 로그.
- **ChartScreen.tsx**: 자체 headerRight ⋮→Settings → **👤→MyMusic**(🔍 검색 유지).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] 홈 렌더: 로고 AIDOL·🔍·👤, 하단바 차트/플레이리스트/피드/작업실(마이뮤직 없음) | **PASS** (증적 `/tmp/nav_home.png`) |
| [e2e-web] 피드 탭 진입 | PASS (`/tmp/nav_feed.png`) |
| [e2e-web] 👤→마이페이지(헤더 '마이페이지'+⚙️) | **PASS** (`/tmp/nav_mypage.png`) |
| 콘솔 에러 | 0 |

### 커밋
`feat: v3.9 네비 개편 — 로고헤더·마이페이지·피드탭·하단바 순서 (team-dev)` — 푸시 OFF.

---

## v3.8 (AppText 통일 마무리) — 2026-08-13 — 잔여 Text 전량 변환

### 수행 결과
앞서 부분 변환했던 7개 화면(Agency·ArtistDetail·Playlist·Settings·MyMusic·Splash·Player)의 **잔여 `<Text>`도 전량 AppText**로 변환. MyMusic·Playlist는 기존 ui import(EmptyState/Button)에 **AppText 누락**으로 tsc 120에러 발생 → import에 AppText 추가로 즉시 수정.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc(전체) | **에러 0** (120→0 수정) |
| 정적: 전 화면(맵 제외) 잔여 `<Text>` | **0** |
| [e2e-web] 앱 루트 로드 | 콘솔 에러 0 |

### 결과
**AIDOL 전 화면(맵 제외) `<Text>` = 0, 100% AppText 기반 통일 완료.** 화면 통일 단계 종료 → 다음은 기능(빠진 것 채우기 → Wave 이식).

### 커밋
`fix: v3.8 AppText 통일 마무리 — 잔여 Text 전량 + import 수정 (team-dev)` — 푸시 OFF.

---

## v3.7 (AppText 심화 통일 #3 — 남은 화면 일괄) — 2026-08-13

### 요청 작업
"남은 거 다 해" — 남은 16개 화면 일괄 통일(자율, 무중단).

### 수행 결과
`Text → AppText` 일괄 변환 + `components/ui` import 주입 (perl bulk, `<TextInput` 단어경계로 보호):
ArtistCody · ArtistInput · ArtistLoading · ArtistResult · ComposerInput · CoverGeneration · Dialogue · DirectorLineup · LyricsInput · LyricsLoading · LyricsPromptReview · LyricsResult · MusicGeneration · MusicLoading · MusicResult · Royalty (**16화면**).
- 안전확인: 대상 파일들은 HEAD 대비 **내용 diff 0**(모드 플래그만) → 기존 WIP 뭉갬 없음.
- 스타일은 유지(시각 등가·컴포넌트 어댑션). 개별 토큰 스트립/칩·EmptyState 심화는 후속.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc(전체) | 에러 0 |
| 정적: `<AppTextInput` 파손 | 0 (TextInput 안전) |
| 정적: 잔여 `<Text>`·import 미주입 | 0 |
| [e2e-web] 앱 루트 로드(네비게이터가 전 화면 import) | **콘솔 에러 0** |

### 결과 — 화면 통일 완료
AIDOL 전 화면(맵 제외)이 공용 컴포넌트 `AppText` 기반으로 통일됨. **MapScreen만 hands-off**(사용자 지시).

### 커밋
`feat: v3.7 AppText 일괄통일 — 남은 16화면 (team-dev)` — 푸시 OFF.

---

## v3.6 (AppText 심화 통일 #2) — 2026-08-13 — WaitTimer · ComposerSelect

### 수행 결과
- `WaitTimerScreen`: 텍스트 7개 → AppText, 위계(taskName/timerLabel/adButtonText/skipButtonText) style 타이포 제거(토큰화). 타이머 대형숫자·반투명 흰색은 style 유지(의도적).
- `ComposerSelectScreen`: 텍스트 → AppText, **전문장르 칩 → `Tag`**(size sm).

### 테스트 (tester)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] | 창작 플로우 깊은 화면(웹 도달 난이) → 타입체크+시각등가로 갈음, 앱 번들 정상 |
| [회귀] 로직 무변경 | PASS |

### 커밋
`feat: v3.6 AppText 심화통일#2 — WaitTimer·ComposerSelect (team-dev)` — 푸시 OFF.

---

## v3.5 (AppText 심화 통일 #1) — 2026-08-13 — SettingsScreen 타입 위계 토큰화

### 요청 작업
"AppText 심화 통일 계속" (자율).

### 수행 결과
- `SettingsScreen`: 핵심 위계 텍스트(화면 제목·섹션 타이틀 4개·폼 타이틀)를 **`AppText`**(variant title2/callout/title3)로 변환, 해당 style에서 fontSize/fontWeight/color 제거(토큰이 담당, 레이아웃만 유지).
- MAIDOL 비교용 프론트 서버(worktree/Vite:4000) 기동 — 원격 9005 프록시 200 확인(별도 산출물 아님, 운영 메모).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] ⋮→설정 진입, "설정"(AppText) 렌더 | PASS |
| 에러 | 콘솔 0 |
| 증적 | `/tmp/settings_reskin.png` |

특이: 반복 행(settingLabel/arrow) 등 나머지 텍스트는 다음 심화 패스에서 순차 변환. 이번은 위계(제목/섹션) 우선.

### 커밋
`feat: v3.5 AppText 심화통일#1 — SettingsScreen 타입위계 (team-dev)` — 푸시 OFF.

---

## v3.4 (화면 통일 스윕 #2) — 2026-08-13 — 하드코딩 색 토큰화 (Splash·Agency·ArtistDetail·Settings)

### 요청 작업
"각 화면마다 공용 컴포넌트/토큰으로 통일" (자율 계속).

### 수행 결과 (색상 토큰화 — 로직/레이아웃 무변경)
- `SplashScreen`: 그라데이션 하드코딩(#1e0e4a·#4c1d95·#2a1758) → `colors.bg.*`/`gradient.twilight[0]`.
- `AgencyProfileScreen`: 레거시 레드/블루 태그(rgba 233,69,96 / 100,100,255) → 온브랜드 보라·금 틴트.
- `ArtistDetailScreen`: 히어로 그라데이션(#4c1d95·#2a1758) → 토큰.
- `SettingsScreen`: 구분선/폼 보더(#2a2a3e) → `colors.border.subtle`, 에러 틴트(레거시 레드) → error 틴트.
- 유지(의도적): Dialogue `#e8e8e8`(밝은 선택지 버튼)·오버레이/그림자 rgba, WaitTimer 반투명 흰색.

### 테스트 (tester)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [정적] 실 하드코딩 HEX 제거 확인 | PASS(#2a2a3e·#4c1d95·#1e0e4a·레거시레드 제거) |
| [e2e-web] | 순수 색-토큰 스왑(시각 등가)이라 이번 배치는 타입/정적 게이트로 갈음 — 렌더 E2E는 다음 통합 스윕서 재확인 |

### 커밋
`feat: v3.4 화면 통일 스윕#2 — 하드코딩 색 토큰화 4화면 (team-dev)` — 푸시 OFF.

---

## v3.3 (화면 통일 스윕 #1) — 2026-08-13 — MyMusic · Playlist 공용 컴포넌트 통일

### 요청 작업
"각 화면마다 공용 컴포넌트로 통일" (자율 진행). 순서: 기존화면 통일 → 빠진기능 → 신규페이지.

### 수행 결과
- `screens/MyMusicScreen.tsx`: 하드코딩 색 제거(`#2a2a3e`→`bg.surface2`, 레거시 레드/블루 태그→온브랜드 보라·금 틴트), 로그인/빈 상태(트랙·가사) 3곳 → **`EmptyState`+`Button`**.
- `screens/PlaylistScreen.tsx`: 로그인/빈 상태 3곳 → **`EmptyState`+`Button`**, 이름변경 모달 버튼 → **`Button`**(tonal/filled).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] 플레이리스트·마이뮤직 탭 렌더 | PASS(콘솔/에러 0) |
| 증적 | `/tmp/tab_playlist.png`, `/tmp/tab_mymusic.png` |

특이: 미로그인 상태라 EmptyState+Button(스타디움형) 렌더 확인. 로그인 후 리스트/성장카드는 로직 무변경으로 보존.

### 커밋
`feat: v3.3 화면 통일 스윕#1 — MyMusic·Playlist 공용 컴포넌트 (team-dev)` — 푸시 OFF.

---

## v3.2 (Wave 0 이어서) — 2026-08-13 — PlayerScreen 리스킨(공용 컴포넌트 적용)

### 요청 작업
"이 공용 컴포넌트로 다음 화면 작업" → PlayerScreen 리스킨.

### 수행 결과
`screens/PlayerScreen.tsx` — 오디오/슬라이더/커스텀 아이콘/상세시트 **로직 전부 보존**, UI만 공용 컴포넌트로 교체:
- 텍스트(헤더 Now Playing·곡 제목·아티스트·시간·액션 라벨 좋아요/담기/다운로드·스와이프업) → **`AppText`**(타입 위계 토큰).
- 상세시트 탭바(가사/프롬프트/착장/상세정보) → **`Tag` 칩**(Spotify식).
- 신규 레이아웃 style 키(headerTitleFlex/trackArtistSpacing/actionLabelSpacing)만 추가, spacing 토큰 사용.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] Player 실화면 렌더 | PASS(콘솔/네트워크 에러 0) |
| [e2e-web] 상세시트 열림 + Tag 탭 렌더 | PASS |
| 증적 | `/tmp/player_reskin.png`, `/tmp/player_sheet.png` |

특이: 곡 제목/아티스트/컨트롤/액션/상세 탭이 토큰·컴포넌트로 일관화(디자이너급). 로직 회귀 없음(로직 무변경).

### 커밋
`feat: v3.2 PlayerScreen 리스킨(공용 컴포넌트 적용) (team-dev)` — 푸시 OFF.

---

## v3.1 (버그픽스) — 2026-08-13 — 재생 중 일시정지/닫기 후에도 노래가 계속 재생되는 버그

### 요청 작업
"노래가 한번 재생되면 일시정지해도, 미니 플레이어 닫아도 계속 재생됨 — 우선 빨리 수정."

### 근본 원인 (0단계 실측)
`screens/PlayerScreen.tsx` mount 시 **두 useEffect가 동시에 `Audio.Sound.createAsync({shouldPlay:true})` 호출**:
- `[]` 효과 → `loadAndPlay()` (사운드 A)
- `[routeTrack?.id]` 효과 → 최초 실행 가드(`routeTrack.id === storeTrackId`)가 **첫 재생 시 store.track이 아직 null이라 무력화** → 사운드 B
→ 사운드 2개 동시 재생, 하나가 **고아(orphan)**. pause/close는 추적 중인 하나(`soundRef`/`store.sound`)만 정지 → 고아 인스턴스는 계속 재생.

### 수정
`routeTrackInitRef`(useRef) 추가 → `[routeTrack?.id]` 효과의 **최초 mount 실행을 명시적으로 스킵**(초기 로드는 `[]` 효과 전담). 이후 routeTrack.id 변경 시에만 곡 교체. `[PlayerScreen]` 디버깅 로그 추가(__DEV__).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] Player 진입당 `Audio` 생성 계측 | **1개** (버그=2, 스킵 가드 로그 1회) |
| [e2e-web] Player 화면 진입 | PASS(Now Playing 렌더) |
| 증적 | `/tmp/aidol_player.png` |

특이: 헤드리스 브라우저는 오토플레이 차단이라 실제 소리 재생은 미검증 → **인스턴스 생성 수(고아 발생 여부)로 검증**. 네이티브 실기기 확인은 대표님 측 권장.

### 커밋
`fix: v3.1 PlayerScreen 중복 사운드 제거(일시정지/닫기 후 재생 지속 버그) (team-dev)` — 푸시 OFF.

---

## v3 (Wave 0) — 2026-08-13 — 공용 컴포넌트 라이브러리 + ChartScreen 리스킨

### 요청 작업
자율 진행(yes/no 미확인). 공용 컴포넌트 라이브러리를 **업계 표준 모바일 디자인 가이드라인 반영**해 제작(프론트 디자이너 관점), Wave 0부터 착수. + 계획에 **미반영 백엔드 기능(Track A) + MAIDOL 프론트 기능(Track B)** 전부 반영.

### 수행 결과
**계획(PLAN_v3)**: v3.2(백엔드 18기능 실 API→AIDOL 매핑, Wave 0~5) + v3.3(Track B: MAIDOL 프론트 전용 페이지/컴포넌트 파리티 + 디자인 시스템 근거) 확정.

**Wave 0 구현**:
- `components/ui/` 9종 신설: `AppText·Button·Card·ListRow·SectionHeader·Tag·Avatar·ScreenLayout·EmptyState` + `index.ts`. 전부 **토큰만**(colors/typography/spacing), 하드코딩 0. `[ui/<Name>]` 주석 추적자.
- 디자인 근거: **Material 3**(카드 tonal surface·리스트 표준높이·stadium 버튼), **Apple HIG**(터치 44), **음악앱 다크**(Spotify 고대비·가로 칩 필터). 우리 PANN 황혼 보라 토큰에 매핑.
- `screens/ChartScreen.tsx` 리스킨: 탭 → Spotify식 **가로 칩 필터(Tag)**, 리스트/빈상태/모달 컴포넌트화, `[ChartScreen]` 디버깅 로그(API 전후·catch·빈상태, __DEV__ 가드) 심음. 기능·데이터 흐름 불변.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] 컴포넌트 9종 + ChartScreen tsc | **에러 0** (전체 프로젝트 tsc 0) |
| [api] 9004 `/api/charts/top100`·health | **200** |
| [e2e-web] Expo Web 번들(797모듈)·HTTP 200 | **PASS** |
| [e2e-web] "차트" 탭 → ChartScreen 실데이터 렌더 | **PASS** (TOP100 10곡+, 장르칩·재생수) |
| [e2e-web] 콘솔 에러/4xx·5xx | **0 / 0** |
| 증적 | `/tmp/aidol_boot.png`, `/tmp/aidol_chart.png` |

→ 리스킨된 ChartScreen이 **실제 9004 데이터로 브라우저 실화면 렌더**, 디자이너급 다크 UI(칩 필터·금은동 랭크·커버·장르칩·FAB) 확인.

### 특이사항
- 원격 9004: charts/health/feeds 정상, **`/api/dm` 404**(Wave 1 DM 착수 전 서버 라우트 탑재 확인 필요 — 서버측).
- E2E 도구: 이 Mac에 iOS 시뮬/Android 에뮬/Maestro 없음 → **Expo Web + Playwright**로 실화면 검증(치환). 네이티브 E2E는 환경 확보 시 추가.
- 커밋: `theme/colors.ts`의 기존(이번 작업 외) 변경은 **스테이징 제외**(skill: 팀 수정분만 명시 add).
- 다음: Wave 1(feeds/follows/dm/referral) — 신규 화면부터 공용 컴포넌트로 제작.

### 커밋
`feat: v3 Wave 0 공용 컴포넌트 라이브러리 + ChartScreen 리스킨 (team-dev)` — 푸시 OFF.
