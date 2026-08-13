# PLAN_v3 — AIDOL 완성 로드맵: MAIDOL 백엔드 기능 전면 반영

> 계보: `PLAN.md`(일지 v1~) → `PLAN_v2.md`(PANN 통합 로드맵) → **`PLAN_v3.md`(본 문서)**
> 팀: **aidol-parity** (team-dev, 신 워크플로우 5인·2단계 게이트·자동커밋)
> 이 파일은 **두 위치에 동일 비치**: `2_housing/PLAN_v3.md` + `claude_skills_outputs/team-dev/PLAN_v3.md`
> 기록일지(누적, 최신 위). 산출물 규칙 경로의 이전 로그(v1~v10 혼재)는 `claude_skills_outputs/team-dev/archive/` 로 분리.

---

## v3.5 — 2026-08-13 — PlayerScreen 리스킨 (공용 컴포넌트 확산)

### 요청
"이 공용 컴포넌트로 다음 화면 작업" → PlayerScreen.

### Plan verification findings (0단계)
- `screens/PlayerScreen.tsx`: 이미 color 토큰 사용·레이아웃 양호하나 **타이포가 raw fontSize로 흩어짐**, 상세시트 탭이 커스텀. 오디오/슬라이더/SVG 아이콘/상세시트 로직 존재(보존 대상).

### 변경 매트릭스
| 파일 | 작업 | 추적자 |
|---|---|---|
| `screens/PlayerScreen.tsx` | 텍스트→AppText, 상세탭→Tag, spacing 토큰. 로직 무변경 | `[PlayerScreen]`(기존 유지) |

### 테스트 지정
- [unit] tsc 0. [e2e] Player 실화면 렌더·상세시트 Tag 탭·에러 0. [회귀] 오디오/슬라이더/셔플·반복 로직 보존.

---

## v3.4 — 2026-08-13 — [버그픽스] 일시정지/닫기 후 재생 지속 (우선 처리)

### 요청
"노래가 재생되면 일시정지·미니플레이어 닫기 후에도 계속 재생 — 우선 빨리 수정."

### Plan verification findings (0단계)
- `screens/PlayerScreen.tsx`: mount 시 `[]` 효과(loadAndPlay)와 `[routeTrack?.id]` 효과가 **둘 다** `Audio.Sound.createAsync({shouldPlay:true})` 실행. 후자의 가드는 첫 재생 시 store.track=null이라 무력 → **사운드 2개(고아 발생)**.
- `components/MiniPlayer.tsx` pause/close 로직(`pauseAsync`/`cleanup→unloadAsync`)은 정상 — 단일 인스턴스 전제.
- 결론: pause/close가 추적 인스턴스만 정지, 고아는 지속 = 신고 증상.

### 계획 / 변경 매트릭스
| 파일 | 작업 | 추적자 |
|---|---|---|
| `screens/PlayerScreen.tsx` | `routeTrackInitRef` 추가 → routeTrack 효과 최초 실행 스킵(중복 사운드 방지) | `[PlayerScreen]` |

### 테스트 지정 (→ test-designer)
- [e2e] Player 진입당 Audio 인스턴스 생성 수 = 1 (버그=2). [unit] tsc 0. [회귀] 곡 전환(prev/next)·미니↔풀 전환 정상.

---

## v3.3 — 2026-08-13 — [보강] MAIDOL 프론트 기능 파리티(Track B) + 디자인 시스템 근거

### 요청 반영
"MAIDOL 프론트 페이지마다의 기능 중 AIDOL에 없는 것도 다 구현" + "타사 표준 모바일 디자인 가이드라인 반영(프론트엔드 디자이너로서)" + "yes/no 안 묻고 자율 진행".

### Track B — MAIDOL 프론트에만 있는 화면/기능 (0단계 실측: pages/components 대조)
**AIDOL에 없는 페이지(신설 대상)**: `MainPage`(콘텐츠 홈) · `SearchPage`(검색 전용, 現 차트 모달만) · `TimelinePage`/`FeedDetailPage`(피드) · `DmInboxPage`(DM) · `InvitePage`(초대) · `BusinessPage`(비즈니스) · `AlbumDetailPage` · `ItemSelectPage` · `GuardianConsentPage` · `OAuthCallbackPage` · `TermsPage`/`PrivacyPage`(법무) · `PlaylistDetailPage`.
**기존 AIDOL 화면에 이식할 in-page 기능(MAIDOL 컴포넌트)**:
- Player 강화: `TrackShareButton`(공유)·`TrackDownloadButton`(다운로드)·`LyricSyncVideo`+`LyricsTimestampToggle`(가사 싱크)·`MusicPlayer` 패턴.
- 공통: `AppShareModal`·`Avatar`·`SocialLoginButtons`·`ConsentGateModal`/`ConsentList`·`ProfileExtraForm`.
- 신고/모더레이션: `ReportModal`·`ReportIssueModal`·`AppealModal`.
- 음성: `MyVoiceCloneSection`·`VoiceCloneWizard`(現 부분) 강화.
- 카탈로그: `AlbumCard`·`AlbumCreateModal`·`TrackCard`·`SongItem`·`PlaylistCard`.
- 참여: `AttendanceCard`·`ItemSelectModal`.
→ **대부분 Track A(백엔드 Wave)와 동일 기능**이라 같은 Wave에서 화면+in-page 기능을 함께 구현. 순수 추가분: **SearchPage(전용)·MainPage(홈)·PlaylistDetail·Player 강화(공유/다운로드/가사싱크)**를 각 Wave에 편입.

### 디자인 시스템 결정 (프론트엔드 디자이너 관점)
공용 컴포넌트를 **업계 표준에 근거**해 설계 — 우리 PANN 토큰(황혼 보라 다크)에 매핑:
- **Material Design 3**: 카드 3형(elevated/filled/outlined), **무거운 그림자 대신 tonal surface**, 리스트 표준 높이, 액션 패딩 8dp, 일관 spacing. → `Card`(filled/outlined), `ListRow`(표준 높이), `Button`(filled/tonal/outline/text).
- **Apple HIG**: 최소 터치 타깃 44pt(=이미 `layout.minTouchTarget=44`), 명료한 타입 위계.
- **음악앱 다크 패턴(Spotify/Apple Music)**: 고대비 다크, tiles/cards/rows, **가로 스크롤 칩 필터**(→ `Tag`/칩), 반투명 now-playing 오버레이(→ MiniPlayer 후속).
- 원칙: 절제(크기/굵기/모서리 소수), 8pt 리듬, tonal elevation, 포인트색(Pan 보라) 절제·금색은 성과/보상. (진단 v41 해소)
- 출처: m3.material.io(Lists/Cards specs), Spotify/Apple Music UI 오딧.

### Wave 0 확정 컴포넌트 (`components/ui/`)
`AppText`(타입 위계) · `Button`(variant: filled/tonal/outline/text, size sm/md/lg) · `Card`(filled/outlined) · `ListRow`(leading/title/subtitle/trailing, 표준 높이) · `SectionHeader` · `Tag`(칩) · `Avatar` · `ScreenLayout`(safe-area+배경 그라데이션) · `EmptyState`. 전부 토큰만, 하드코딩 0.

---

## v3.2 — 2026-08-13 — [전체 계획] 미반영 백엔드 기능 18종 전면 반영 로드맵

### 요청 작업
"반영되지 않은 백엔드 기능들을 모두 반영하는 계획을 짜야지" → 18개 영역 각각의 **실제 API 계약 → AIDOL 구현 매핑** + Wave 로드맵.

### Plan verification findings (0단계 — origin/backend:backend_9004 라우트 실측)
각 라우트의 실제 엔드포인트를 코드에서 추출(경로 prefix는 `/api/<feature>`). 아래 매핑표가 근거.

### 공통 이식 규칙
- AIDOL(RN)에 **화면(screens) + 스토어(stores) + 서비스 함수(services)** 추가. 컴포넌트 직접 fetch 금지 → `services/*` 경유(신 함수 먼저 추가). 웹 MAIDOL 코드 복사 금지(RN 재구현).
- 모든 신규 화면은 **Wave 0 공용 컴포넌트 + 토큰**으로 제작(디자이너급 일관성).
- 각 기능마다 skill 파이프라인 1사이클: 0단계→계획→TESTPLAN→app-dev(디버깅 로그)→2단계 게이트(Expo Web)→REPORT→자동커밋.

---

### Wave 0 — 공용 컴포넌트 라이브러리 (선행, 백엔드 무관)
`components/ui/`: ScreenLayout·AppText·Button·Card·ListRow·SectionHeader·Tag·EmptyState·Avatar. + ChartScreen 리스킨(파일럿). → 이후 모든 Wave 재사용.

### Wave 1 — 소셜 코어
| 기능 | 실제 API (9004) | AIDOL 구현 |
|---|---|---|
| **feeds** | POST `/`, GET `/timeline`·`/user/{id}`·`/{id}`, PUT/DELETE `/{id}`, POST/DELETE `/{id}/like`, GET/POST `/{id}/comments`, DELETE `/comments/{id}` | `FeedScreen`(타임라인)·`FeedDetailScreen`·`PostComposerScreen` + `feedStore` + `services/feedService.ts` |
| **follows** | GET `/summary/{id}`·`/followers`·`/following`, POST/DELETE `/{id}` | ArtistDetail/AgencyProfile **팔로우 버튼** + `FollowListScreen` + `socialStore`. **가짜 `fanSimulationStore` 대체** |
| **dm** | GET `/official`·`/eligibility`·`/conversations`·`/conversations/{cid}/messages`·`/unread-count`·`/requests`·`/users/search`, POST `/conversations`·`.../messages`·`.../read`·`.../accept`·`/broadcast` | `DmInboxScreen`·`DmThreadScreen`·`DmRequestsScreen` + `dmStore` + `services/dmService.ts` |
| **referral** | GET `/my-code`·`/invite/{code}` | `InviteScreen`(내 코드·딥링크 공유) + Register에 코드 입력 + points 보상 연동 |

### Wave 2 — 참여·보상 경제 (기존 gemsStore/timerStore 정합)
| 기능 | 실제 API | AIDOL 구현 |
|---|---|---|
| **points** | GET `/costs`·`/balance`·`/history` | `gemsStore` ↔ points 서버 동기화, `PointsHistoryScreen` |
| **rewards** | GET `/admob-callback`·`/balance`·`/history` | 리워드 광고(AdMob) 시청→보상 수령 플로우, gemsStore 반영 |
| **attendance** | GET `/status`, POST `/check-in` | 홈/맵 **일일 출석 체크** UI + 보상 |
| **likes** | GET `/`·`/check`, POST/DELETE `/{track_id}` | Player/Chart/MyMusic **좋아요 버튼** + `LikedTracksScreen` |
| **wishlist** | GET `/`·`/check`, POST `/{item_id}/toggle` | **담기(위시) 버튼** + `WishlistScreen` |
| **fatigue** | GET `/status`, POST `/skip` | 피로도 표시 + 스킵(대기 시스템 `timerStore` 연동) |

### Wave 3 — 계정·컴플라이언스 (실서비스 오픈 게이트)
| 기능 | 실제 API | AIDOL 구현 |
|---|---|---|
| **oauth** | GET `/{provider}/login`·`/{provider}/callback` (Naver/Kakao/Google) | Login에 소셜 로그인 버튼, `expo-auth-session`/`WebBrowser` 딥링크 콜백, `authStore` 확장 |
| **face_verify** | GET `/status`, POST `/consent`·`/verify`·`/session`·`/guardian/request`, DELETE | `FaceVerifyScreen`(expo-camera 라이브니스)+동의·보호자요청, 캐릭터 생성 게이트 |
| **reports** | GET `/my`·`/my-affected`, POST `/`·`/{id}/appeal` | 콘텐츠 **신고 모달** + `MyReportsScreen`(제재·이의제기) |

### Wave 4 — 커머스·카탈로그
| 기능 | 실제 API | AIDOL 구현 |
|---|---|---|
| **business** | GET `/ads/active`·`/profile`·`/ads`·`/ads/{id}/stars`, POST `/ads`·`/ads/{id}/impression`·`/ads/{id}/click`, PUT/PATCH/DELETE ... | 소비자측 우선: Player/ArtistDetail **💼 착용 아이템**(ads/active + impression/click). (광고주 CRUD는 후순위/웹) |
| **albums** | GET `/`·`/latest`·`/my`·`/{id}`, POST `/`·`/{id}/tracks`·`/cover/generate`, PATCH/PUT/DELETE ... | `AlbumDetailScreen` + MyMusic에 **내 앨범 관리**(트랙 추가/순서/커버) |

### Wave 5 — 음성 확장 (기존 voiceService 확장)
| 기능 | 실제 API | AIDOL 구현 |
|---|---|---|
| **voice_persona** | POST `/create`, GET `/list`·`/{id}`·`/{id}/vocal|cover/stream|download`, DELETE `/{id}` | 내 목소리 **페르소나 목록/생성/커버** UI, voiceService 확장 |
| **voice_convert** | POST `/{gen_id}`·`/{gen_id}/preview-mr`·`/{gen_id}/merge`, GET `/{gen_id}/status`·`.../stream|download` | 생성곡 **보컬 변환(내 목소리)** UI |
| **vocal_repair** | POST `/upload`·`/{id}/enhance`, GET `/{id}/status`·`.../stream|download`·`/list` | **보컬 보정** 업로드→향상 UI |

### 원격 9004 상태 리스크 (0단계 확인)
- health 200 ✅, `/api/feeds` 307(존재). 단 **`/api/dm` 404** — 원격 9004가 일부 최신 라우트 미탑재 가능성.
- **각 Wave 착수 전 tester가 해당 라우트 실응답을 먼저 확인**(2xx/3xx). 미탑재면 서버 재배포(사용자측, WSL 제약) 선행 → PLAN에 블로커로 기록.

### 진행 원칙 (증분·안전)
- **Wave 0 → 1 → 2 → 3 → 4 → 5** 순차. 각 Wave 내 기능도 개별 사이클(파일 변경 >40% 유발 시 사용자 확인).
- 기존 창작 플로우(작사/작곡/맵) **회귀 불변**을 매 Wave 회귀 테스트.
- 우선순위 조정 가능: 실서비스 오픈이 급하면 **Wave 3(컴플라이언스)를 앞당김**.

### 다음 액션
- Wave 0부터 착수(사용자 "진행" 시). test-designer가 Wave별 TESTPLAN_v3 작성.

---

## v3.1 — 2026-08-13 — [킥오프] MAIDOL→AIDOL 기능 반영 + Wave 0 착수

### 요청 작업 (원문)
"플랜이랑 레포트를 새로 만들고 MAIDOL 백엔드의 수정된 기능이 모두 반영될 수 있도록 AIDOL을 수정할꺼야." → PLAN_v3로 작성.
- 사용자 결정: ①**새 파일 = PLAN_v3**(2_housing + 산출물경로 양쪽) ②**Wave 0(공용 컴포넌트) 먼저** ③백엔드 **포트 9004 사용**.

### 프로젝트 유형 적응 (skill 규칙)
- AIDOL = **Expo/React Native 모바일** → `frontend-dev` → **`app-dev`** 치환.
- E2E 도구: 네이티브(Maestro/Appium) 대신 **Expo Web + Playwright**로 치환(이 Mac에 시뮬/에뮬 없음 — 0단계 근거). 2단계 게이트·증적·루프·자동커밋 규칙은 동일.

### Plan verification findings (0단계 — 코드/환경 실측)
- **타깃**: `2_housing` (화면 27 / 스토어 15). API 클라이언트 = `services/{api,lyricsService,musicService,voiceService}.ts`.
- **백엔드**: `http://100.127.225.55:9004` — **health 200 ✅**. `/api/feeds` 307(존재), **`/api/dm` 404**(원격 9004 일부 최신 라우트 미탑재 가능 → 파리티 시 라우트별 확인, 서버 재배포는 사용자측).
- **현재 AIDOL 사용 API**: 생성 플로우만(`/generate`, `/generate/lyrics`, `/kits/voice-models`, `/voice/upload`, `/wondera/generate`).
- **미반영 18영역**: albums·attendance·business·dm·face_verify·fatigue·feeds·follows·likes·oauth·points·referral·reports·rewards·wishlist·voice_convert·voice_persona·vocal_repair.
- **디자인 토큰**: `theme/{colors,typography,spacing,index}.ts` 존재. 공용 컴포넌트 `components/` 7개뿐(27화면 대비 부족 = 아마추어 원인, 진단 v41).
- **테스트 환경**: `react-native-web@0.21`+`react-dom@19` → Expo Web 실화면 테스트 가능. iOS 시뮬/Android 에뮬/Maestro 없음. Playwright 미설치(테스터 설치 예정).

### 이번 증분 — Wave 0 (공용 컴포넌트 라이브러리 + ChartScreen 리스킨)
목적: 이후 모든 이식 화면이 재사용할 UI 기반 + "디자이너급" 전환 착수.
- **신규 공용 컴포넌트**(`components/ui/`): `ScreenLayout`, `AppText`(타입 위계), `Button`, `Card`, `ListRow`, `SectionHeader`, `Tag`, `EmptyState` — 토큰만 사용, 하드코딩 금지.
- **리스킨**: `ChartScreen.tsx` — 위 컴포넌트로 재조립(기능·데이터 흐름 불변, 9004 `/api/charts` 연동 유지).
- **변경 매트릭스 / 추적자 로그**:
  | 파일 | 작업 | 추적자 |
  |---|---|---|
  | `components/ui/*` | 신규 | `[ui/<Name>]` |
  | `screens/ChartScreen.tsx` | 리스킨 | `[ChartScreen]` (API 전후·catch·빈/에러 상태 로그, DEV 가드) |

### 역할 분담
- planner: 계획·게이트·최종확인.
- app-dev: 공용 컴포넌트 + ChartScreen 리스킨, API는 `services` 경유(직접 fetch 금지), 디버깅 로그.
- backend-dev: 9004 `/api/charts` 응답 계약 확인(코드 변경 최소).
- test-designer: `TESTPLAN.md`(정상/경계/에러/회귀, `[unit]`/`[api]`/`[e2e(web)]`).
- tester: 1단계(컴포넌트 렌더·charts API) → 2단계(Expo Web+Playwright로 ChartScreen 실화면 스크린샷·조작).

### 테스트 항목(초안 → test-designer)
- [unit] 공용 컴포넌트 variant 렌더/스냅샷, 토큰 적용(하드코딩 HEX 0).
- [api] `/api/charts`(9004) 응답 스키마/빈 목록/에러.
- [e2e(web)] Expo Web ChartScreen 진입→목록 렌더→항목 탭, 콘솔 에러 0·4xx/5xx 없음, 스크린샷 저장.
- [회귀] 기존 창작 플로우(맵/작사/작곡) 렌더 불변.

### 다음 단계
- test-designer가 TESTPLAN(Wave 0) 작성 → planner 검토 → app-dev 구현 → tester 2단계 → REPORT_v3 기록 → 자동커밋(푸시 OFF).

---
