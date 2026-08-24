# PLAN_v3 — AIDOL 완성 로드맵: MAIDOL 백엔드 기능 전면 반영

> 계보: `PLAN.md`(일지 v1~) → `PLAN_v2.md`(PANN 통합 로드맵) → **`PLAN_v3.md`(본 문서)**
> 팀: **aidol-parity** (team-dev, 신 워크플로우 5인·2단계 게이트·자동커밋)
> 이 파일은 **두 위치에 동일 비치**: `2_housing/PLAN_v3.md` + `claude_skills_outputs/team-dev/PLAN_v3.md`
> 기록일지(누적, 최신 위). 산출물 규칙 경로의 이전 로그(v1~v10 혼재)는 `claude_skills_outputs/team-dev/archive/` 로 분리.

---

## v3.67 — 2026-08-24 — FAB 최종 스펙 확정

하단바 위 12px + 미니플레이어(재생 중) 시 숨김(원래 차트 동작 복원). 숨김/간격 판단을 공용 Fab 내부로 일원화.

---

## v3.66 — 2026-08-24 — FAB = 하단바 기준 고정(미니플레이어 무관)

사용자 확정 스펙: 버튼은 항상 하단바 위 6px. 재생 중엔 미니플레이어가 덮어 가려짐(의도). v3.63의 lift 로직 제거.

---

## v3.65 — 2026-08-24 — FAB 간격 12→6 (사용자 지정)

GAP_ABOVE_BAR 6으로 조정 — 하단바에 더 붙게.

---

## v3.64 — 2026-08-24 — FAB 기준점 조정(하단바 윗부분에서 살짝 위)

### 요청
"버튼은 하단바 윗부분 기준으로 살짝 위로 떨어지게."

### 변경
| 파일 | 변경 |
|---|---|
| components/Fab.tsx | 간격 상수 GAP_ABOVE_BAR=12 도입 — 하단바 위 20px→12px, 미니플레이어 시 70+12 |

---

## v3.63 — 2026-08-24 — FAB 미표시 픽스(재생 중 숨김 → 미니플레이어 위로 상승)

### 요청
"두 버튼 다 왜 안 보여?" — 재생 중(미니플레이어 존재) 상태에서 FAB이 항상 숨어 있던 문제.

### Plan verification findings
- 원인: 차트 FAB의 기존 조건 `!playerStore.track`(미니플레이어 있으면 숨김)을 v3.62 통일 때 피드에도 적용 — 곡을 튼 상태로 쓰는 사용자는 FAB을 영영 못 봄. 로그인 시 저장된 재생목록이 복원되면 track이 곧바로 세팅되어 사실상 상시 숨김.

### 변경
| 파일 | 변경 |
|---|---|
| components/Fab.tsx | 미니플레이어 존재 시 숨기는 대신 bottom을 70px 올려 그 위에 표시 |
| ChartScreen·FeedScreen | `!playerStore.track` 숨김 조건 제거(항상 노출) |

---

## v3.62 — 2026-08-24 — FAB 위치 통일(차트 + / 피드 글쓰기)

### 요청
"차트 + 버튼이랑 피드 글쓰기 버튼이 동일한 위치에."

### Plan verification findings
- ChartScreen fab: bottom/right spacing.xl, 56×56, 보라 그림자. FeedScreen composeFab: bottom 96/right spacing.lg, 52×52, 검정 그림자 — 위치·크기·그림자 전부 상이.
- 통일 기준 = 기존 차트 FAB(사용자에게 익숙한 위치).

### 변경
| 파일 | 변경 |
|---|---|
| components/Fab.tsx(신규) | 공용 우하단 플로팅 버튼(차트 스펙: 56×56·bottom/right xl·보라 그림자) |
| screens/ChartScreen.tsx | 자체 fab → 공용 Fab |
| screens/FeedScreen.tsx | composeFab → 공용 Fab(연필) |

---

## v3.61 — 2026-08-24 — 피드 작성 신설(음악 첨부=차트 디자인) + 피드 인라인 즉시 재생

### 요청
"피드 작성 시 음악 첨부 화면을 차트랑 동일하게 + 피드에서 바로 재생."

### Plan verification findings
- **앱에 피드 작성 UI가 아예 없음**(POST /feeds 호출 화면 0건 — 읽기·댓글·좋아요만 구현). 요청의 전제가 되는 화면부터 신설 필요.
- POST /api/feeds/ 스키마(라이브): required=[blocks], props: title?/blocks/bgm_track_id?/is_public/kind. blocks는 timeline 응답과 동일 형태({type:'text',text}·{type:'track',track_id}). 내 곡: GET /tracks/my.
- 곡 목록 공용 디자인 = components/TrackRow.tsx(차트·검색·마이뮤직 공용, v3.40에서 통일) — 이걸 곡 선택 화면에 그대로 사용하면 "차트와 동일" 충족.
- 피드 트랙 탭 시 현재 navigate('Player') — 즉시 재생하려면 사운드 로드 로직 필요. 로드 로직이 MiniPlayer 내부 함수(loadAndPlayTrack)에 갇혀 있음 → **services/playback.ts로 승격**해 MiniPlayer·FeedScreen이 공유(중복 제거).

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| services/playback.ts(신규) | loadAndPlayTrack(사운드 로드+didJustFinish 자동 다음곡)·playTrackNow(큐 세팅+즉시 재생) | [playback] |
| components/MiniPlayer.tsx | 자체 로드 로직 제거 → playback.ts 사용 | [MiniPlayer] |
| screens/FeedComposeScreen.tsx(신규) | 제목/내용 입력 + 음악 첨부(내 곡 목록 모달 — 공용 TrackRow) + POST /feeds/ | [FeedCompose] |
| App.tsx | FeedCompose 라우트(모달) 등록 | - |
| screens/FeedScreen.tsx | 로그인 시 작성 FAB(연필) → FeedCompose / 트랙 블록 탭 → playTrackNow(화면 이동 없이 재생, 미니플레이어 등장) | [FeedScreen] |

---

## v3.60 — 2026-08-24 — 피드 디자인 무난화(픽셀 게임창 콘셉트 철회)

### 요청
"피드가 우리 컨셉이랑 많이 안 어울려서 무난하게" — v3.51(게임창 크롬)·v3.52(픽셀 폰트) 철회, 앱 기본 다크 톤으로 통일.

### Plan verification findings
- FeedCard: feedPixel 팔레트(다크 보라 창·밝은 테두리·오프셋 그림자·타이틀바) + PText(NeoDGM) 래퍼 17곳. FeedScreen이 feedPixel·PIXEL_FONT import(본문·트랙 칩 3곳 fontFamily).
- App.tsx useFonts로 neodgm.ttf 로드(사용처는 피드뿐 → 로드 제거 대상, 에셋 파일·expo-font는 보존해 재사용 여지 유지).
- 유지할 것: v3.49 폭 개선(카드 마진 제거+리스트 패딩 12), 좋아요/댓글 스레드/공유(이벤트 문구)/신고 기능 전부.

### 변경
| 파일 | 변경 |
|---|---|
| components/feed/FeedCard.tsx | 팔레트를 앱 테마 매핑(feedTheme)으로 교체, PText→AppText(픽셀 폰트 제거), 게임창 크롬(그림자·2px 테두리·타이틀바) 제거 → surface1 일반 카드 |
| screens/FeedScreen.tsx | PIXEL_FONT 제거, feedTheme 참조, 트랙 칩 다크 복귀 |
| App.tsx | 폰트 로드 제거(에셋은 보존) |

---

## v3.59 — 2026-08-24 — 재화명 '스타' 확정 반영

### 요청
후보 논의 끝에 **'스타(STAR)' 확정** — 루미(v3.58 임시 적용)를 스타로 교체.

### Plan verification findings
- v3.58에서 재화명을 `constants/currency.ts`로 중앙화 + 일부 문구는 리터럴 '루미' — 상수 1곳 + 리터럴 교체로 완결. ⭐ 아이콘·백엔드 별 정책(+50 등)·402 처리 로직은 무변(이름만 변경).
- OG 배너(assets/og/beta-event-og.png)에 '루미 50' 각인 — 재생성 필요.

### 변경
| 파일 | 변경 |
|---|---|
| constants/currency.ts | CURRENCY '루미'→'스타', EN 'LUMI'→'STAR' |
| ChartScreen·GuestQueueNoticeModal·AttendanceModal·DirectorLineup·ArtistInput·AppShareModal·MyMusicScreen·FeedCard·HomeHeaderActions·MapScreen | 리터럴 '루미' → '스타'(문구·라벨) |
| assets/og/beta-event-og.png | "스타 50 추가 증정"으로 재생성 |

---

## v3.58 — 2026-08-24 — 재화명 리브랜딩('루미') + 베타 이벤트 공유(OG) 준비

### 요청 원문 요약
① 앱 공유 시 대표 이미지로 "베타 테스트 기간 가입 시 50스타 추가 증정" 이벤트가 보이게 ② '스타 모으는 법' 텍스트 제거, '내 별' 단어 제거 — 우리만의 재화 이름(단순·부르기 쉬운)을 만들어 적용.

### Plan verification findings
- 재화 문구 사용처: StarGuideModal(제목 '별 모으는 법'·'내 별'), ChartScreen 로그인 CTA, GuestQueueNoticeModal, DirectorLineup/ArtistInput 402 문구, AttendanceModal, AppShareModal(⭐50 안내) — 전부 하드코딩 문자열. 중앙 상수 부재.
- 공유 링크(초대/피드/곡)는 전부 백엔드 도메인 URL — **링크 미리보기(OG) 이미지는 그 URL의 HTML이 서빙해야 하므로 백엔드 작업 필요(동결)**. 프론트에서 가능한 것: OG 이미지 에셋 제작 + 공유 메시지에 이벤트 문구 삽입. Expo(app.json web)는 OG meta 커스텀 미지원.

### 결정: 재화명 = 루미(LUMI)
단순·2음절·발음 쉬움, 빛/응원봉(라이트스틱) 연상으로 기존 ⭐ 아이콘과 자연스럽게 연결, "루미 50 증정" 어감 좋음. 후보 비교(픽/샤인/블링)는 REPORT에 기록. `constants/currency.ts` 한 곳만 바꾸면 전체 스왑되도록 상수화.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| constants/currency.ts(신규) | CURRENCY='루미'·CURRENCY_EN·아이콘 상수 | - |
| StarGuideModal | 제목 '별 모으는 법' 제거→'⭐ 루미', '내 별'→'보유 루미', 상수 사용 | [StarGuideModal] |
| ChartScreen·GuestQueueNoticeModal·AttendanceModal·DirectorLineup·ArtistInput | '별' 문구 → 루미(402 안내 포함) | 각 화면 prefix |
| AppShareModal·MyMusicScreen·FeedCard | 공유 메시지에 "🎁 베타 기간 가입 시 루미 50 추가 증정" 이벤트 라인 | [AppShareModal] 등 |
| HomeHeaderActions·MapScreen | accessibilityLabel '별 안내'→'루미 안내' | - |
| assets/og/beta-event-og.png(신규) | 1200×630 베타 이벤트 OG 배너(픽셀 게임창 무드) — HTML 렌더→스크린샷 제작 | - |

백엔드 무변경. OG 태그 서빙은 동결 해제 후 백엔드 5분 작업(이미지·문구는 이번에 완성).

---

## v3.57 — 2026-08-24 — 헤더 벨 확인 · 픽셀 피드 확인자료 · 설정 미니플레이어 숨김 · 오디오 포커스/미디어 세션

### 요청 원문 요약
① 상단바 알림(벨) 왜 있나 — DM·요청으로 통합된 거 아닌가, 필요없으면 삭제 ② 피드 바꾼 디자인(픽셀 라이브러리) 아직 못 봤다 ③ 설정 창에서 미니플레이어가 UI에 이상하게 남음 — 노래는 계속 재생돼야 함 ④ 재생 시 타 앱(유튜브 등) 소리를 끊고, 폰 상단바(알림 영역)에 미디어 컨트롤 표시.

### Plan verification findings
- ① 벨(알림함)과 메일(DM)은 **별개 시스템** — 알림함=팔로우·댓글·답글·좋아요·피드 팬아웃(Mongo notifications), DM함=대화·메시지 요청. DM함에는 소셜 알림이 없고, v3.56 맞팔 버튼도 알림함에 있음 → **삭제하면 안 됨(유지 판정)**. 통합하려면 별도 기획 필요.
- ② 픽셀 게임창(v3.51)+Neo둥근모(v3.52)는 **이미 적용·커밋·푸시됨** — E2E에서 computed fontFamily 'NeoDGM' 실측까지 완료. 사용자가 아직 앱을 리로드 안 했거나 스크린샷 파일을 못 본 것 → 확인 자료를 프로젝트 폴더(docs/screenshots/)에 저장.
- ③ Settings는 `presentation: 'modal'`(App.tsx)인데 MiniPlayerWrapper가 NavigationContainer 레벨 절대배치(zIndex 999)라 모달 위에 어색하게 겹침. **사운드 객체는 playerStore 전역 소유**(MiniPlayer는 순수 UI) → 특정 라우트에서 UI만 숨겨도 재생 유지 확실.
- ④ 현재 setAudioModeAsync가 4곳에 산재하고 interruption 모드 미지정 → 타 앱과 믹스될 수 있음. expo-av `InterruptionModeIOS/Android.DoNotMix`로 **재생 시작 시 타 앱 오디오 포커스 탈취 가능(JS-only)**. iOS 백그라운드 재생은 app.json `UIBackgroundModes:["audio"]` 필요. **폰 상단바 미디어 컨트롤(잠금화면 포함)은 expo-av 미지원** — react-native-track-player 등 네이티브 모듈 + EAS 빌드 필요(Expo Go 불가) → 이번엔 웹 Media Session(브라우저/안드로이드 크롬 알림)까지만 구현하고 네이티브는 빌드 단계 과제로 보고.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| services/audioMode.ts(신규) | 재생용 오디오 모드 헬퍼(DoNotMix·백그라운드) + 웹 Media Session 메타/핸들러 | [audioMode] |
| screens/PlayerScreen.tsx 외 재생 3곳·MiniPlayer | setAudioModeAsync → 공통 헬퍼로 통일, PlayerScreen에서 Media Session 메타 갱신 | [PlayerScreen] |
| App.tsx | navigationRef로 현재 라우트 추적 → Settings에서 MiniPlayerWrapper 숨김(재생 유지) | [App] |
| app.json | ios.infoPlist.UIBackgroundModes:["audio"] | - |
| docs/screenshots/ | 픽셀 피드 확인용 스크린샷 저장 | - |

---

## v3.56 — 2026-08-24 — 알림함 팔로우 알림에 '맞팔하기' 인라인 버튼

### 요청 원문
DM 요청/팔로우 구조 논의 후: "(팔로우 알림에 맞팔 버튼 바로 넣기) 그렇게 해줘."

### Plan verification findings
- NotificationsScreen.tsx — follow 알림은 탭하면 채널로 이동만 함(맞팔은 채널 가서 버튼 눌러야). 알림 항목에 팔로우 상태 표시·액션 없음.
- 팔로우는 승인 개념 없음(POST /follows/{id} 즉시) → 버튼 1탭으로 완결. 상태 조회는 GET /follows/summary/{id}(is_following).
- DM pending 판정은 "수신자가 발신자를 팔로우 중인가"(dm_service.py:359) → 맞팔하면 상대 DM이 요청함을 안 거침. 이 버튼이 DM 흐름 개선과 직결.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/NotificationsScreen.tsx | follow 알림 로드 후 고유 actor들의 팔로우 상태 일괄 조회 → 항목 우측에 '맞팔하기'/'팔로잉 ✓' 버튼(낙관적 갱신, 중복탭 방지, 행 탭과 이벤트 분리) | [Notifications] |

백엔드 변경 없음(동결 유지).

---

## v3.55 — 2026-08-20 — 착장 레일 화살표 + Now playing 공유 제거

### 요청
"화살표 버튼이 있어야 넘기는 줄 안다 + Now playing에 공유 금지(공유는 마이뮤직 내 곡 전용)."

### Plan verification findings
- 공유 시트(TrackShareDownloadSheet) 사용처 2곳: PlayerScreen(제거 대상), MyMusicScreen(⋮ 메뉴 — 내 곡 전용, 유지). 마이뮤직에 링크 공유(Share.share)도 기존재 → Player 쪽만 걷어내면 정책 충족.
- 착장 레일(v3.54)은 스크롤 힌트가 잘린 카드뿐 — 화살표 내비 부재.

### 변경
| 파일 | 변경 | 추적자 |
|---|---|---|
| PlayerScreen.tsx | 공유 버튼·showShare 상태·TrackShareDownloadSheet 사용/임포트 제거(액션 4개: 좋아요·담기·재생목록·신고) / 착장 레일에 좌우 화살표(스크롤 위치 추적, 시작·끝에서 해당 방향 숨김, 190px씩 이동) | [PlayerScreen] |

---

## v3.54 — 2026-08-20 — 착장 탭 가로 스크롤 + 제품 사진 확대

### 요청
"착장은 가로 스크롤로 넘기면서 보게, 제품 사진 크게 — 아이템 많아지면 세로 스크롤 힘듦."

### Plan verification findings
- PlayerScreen.tsx:946 착장 목록이 flexWrap 세로 그리드(카드 108px, 이미지 88px). 시트 ScrollView(세로) 내부라 아이템 증가 시 세로로 무한 확장.
- 착장 보유 곡 확인: '쉬었음 청년'(used_items 3) — E2E 검증 경로는 로그인→피드 트랙 재생(차트 상위곡엔 착장 없음).

### 변경
| 파일 | 변경 |
|---|---|
| PlayerScreen.tsx | 착장 목록을 horizontal ScrollView로(인디케이터 숨김), 카드 108→168·이미지 88→150, 안내 문구에 "옆으로 넘겨보세요" 추가 |

---

## v3.53 — 2026-08-20 — Now playing 액션 아이콘 잘림 + 시트 가로 오버플로 픽스

### 요청
"좋아요, 담기, 재생목록 순서로 아이콘 원복 + 하단 토글의 프롬프트·착장이 화면 가로를 넘지 않게."

### Plan verification findings
- 코드상 순서는 이미 좋아요→담기→재생목록→공유→신고였으나, **actionsRow의 고정 gap 48 + 버튼 minWidth 60×5 = 492px > 화면 390px** → 행이 중앙정렬로 넘치면서 '좋아요'가 좌측 화면 밖으로 잘림(사용자에겐 담기부터 보여 순서가 바뀐 것처럼 인지). 이 오버플로가 페이지 scrollWidth 441을 만들어 시트의 프롬프트·착장도 "가로 스크롤"처럼 보였음 — 단일 원인.
- Playwright 실측: 오버플로 요소 4건, scrollW 441/innerW 390.

### 변경
| 파일 | 변경 |
|---|---|
| PlayerScreen.tsx | actionsRow: 고정 gap → width 100% + space-evenly, actionBtn flex:1(minWidth 제거) / promptChip maxWidth 100%·값 flexShrink(긴 값 방어) |

---

## v3.52 — 2026-08-20 — 피드 2D 게임창 2단계: 픽셀 폰트 라이브러리 도입

### 요청
"피드페이지 2D형태 수정, 라이브러리부터 다시 작업" — v3.51 특이사항으로 남긴 픽셀 폰트 적용. 백엔드는 수정 금지(AWS 이전 대비 동결).

### Plan verification findings
- Expo SDK 54, expo-font 미설치, 앱에 커스텀 폰트 로딩 없음(시스템 폰트만).
- @expo-google-fonts에 Neo둥근모 패키지 부재(E404) → **TTF 에셋 번들 방식** 채택: neodgm.ttf(Neo둥근모, 원저작 public domain + MIT 배포) GitHub 공식 릴리스에서 다운로드 → `assets/fonts/neodgm.ttf`(651KB).
- 적용 범위는 피드 카드 한정(v3.51 게임창 크롬과 세트) — 전앱 폰트 교체 아님. AppText는 style 후순위 병합이라 fontFamily 오버라이드 가능.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| assets/fonts/neodgm.ttf | 신규 에셋 | - |
| package.json | expo-font 설치 | - |
| App.tsx | useFonts로 NeoDGM 로드(비차단 — 로드 전엔 시스템 폰트 폴백) | [App] |
| components/feed/FeedCard.tsx | PIXEL_FONT 상수 + PText 래퍼, 카드 내 전 텍스트·댓글 입력창에 적용 | [FeedCard] |
| screens/FeedScreen.tsx | 본문 블록·트랙 칩 텍스트에 fontFamily 적용 | [FeedScreen] |

---

## v3.51 — 2026-08-19 — 피드 카드 → 2D 게임창(픽셀 윈도우) 스타일

### 요청 원문
"이러지말고 아예 약간 2D 형태의 게임창(픽셀느낌)처럼 피드창을 만들면 어때?" (라이트 카드 톤 조정 중단 → 방향 전환)

### Plan verification findings
- v3.49~50에서 카드 색이 `feedCardLight` 팔레트로 중앙화(FeedCard+FeedScreen 공유) — 팔레트 교체 + 카드 크롬(테두리/그림자/타이틀바) 구조 추가로 전환 가능. 직전 미커밋 톤다운 값은 폐기하고 픽셀 팔레트로 대체.
- RN에는 CSS pixelated border-image가 없음 → **각진 모서리(radius 2) + 2px 밝은 테두리 + 우하단 4px 오프셋 솔리드 그림자 + 타이틀바(작성자 줄 분리)**로 레트로 RPG 창을 표현.
- 픽셀 폰트(Neo둥근모 등)는 폰트 에셋 로딩이 필요해 이번 범위 제외 — 특이사항에 후속 옵션으로 기록.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| components/feed/FeedCard.tsx | `feedCardLight`→`feedPixel` 팔레트(다크 창 배경·밝은 테두리·픽셀 그림자·인셋 필드), 카드 래퍼 3중 구조(cardWrap/cardShadow/card), 헤더를 타이틀바로 | [FeedCard] |
| screens/FeedScreen.tsx | import·참조 교체, 트랙 칩 인셋(각진 모서리+1px 테두리) | [FeedScreen] |

---

## v3.50 — 2026-08-19 — 피드 카드 톤 다운(라벤더 틴트+투명도)

### 요청
피드카드 배경이 너무 밝아 안 어울림 — 투명도/색감 조정으로 자연스럽게.

### Plan verification findings
- v3.49에서 카드 색을 `feedCardLight` 팔레트(components/feed/FeedCard.tsx)로 중앙화 — FeedCard 전체와 FeedScreen 본문 블록이 공유하므로 **팔레트 6색 값만 수정하면 전면 반영**. 구조 변경 불필요.

### 변경
| 파일 | 변경 |
|---|---|
| components/feed/FeedCard.tsx | 팔레트 조정: bg 순백→rgba(226,221,240,0.90)(라벤더+10% 투명 — 배경 보라가 비침), 텍스트 3톤 보라 틴트 잉크로, line/field 반투명화 |

---

## v3.49 — 2026-08-19 — Now playing 시트 간소화 · 기획사 채널 개편(MAIDOL 동일) · 피드 폭/라이트 카드

### 요청 원문 요약
① Now playing 하단 토글 시트: 상세정보 불필요 — 가사·프롬프트·착장만. ② 기획사 클릭 → MAIDOL처럼 팔로우 버튼 + 앨범/트랙/팔로워 통계 + 곡·앨범/피드/커뮤니티 탭. ③ 피드 가로 길이 아직도 짧음. ④ 피드를 밝은 색 카드 나열로.

### Plan verification findings (0단계)
- PlayerScreen.tsx:165,881 — 시트 탭 4종 `lyrics/prompt/outfit/info`. info 블록 984~1011. 토글 라벨 "가사 · 상세정보"(854).
- PlayerScreen.tsx:678 — 기획사 클릭이 **AgencyProfile**(검색 기반 구형: 팔로우·탭 없음)로 이동. 반면 **UserChannelScreen**(팔로우 토글+음악/피드/공지 탭)이 이미 존재하나 피드/알림에서만 진입됨.
- MAIDOL ArtistDetailPage.jsx — 통계 앨범/트랙/팔로워, 탭 곡·앨범/피드/커뮤니티(v131·v133). API 검증: `/artists/{id}/albums`(cover_image=풀경로, track_count), `/albums/{id}`(tracks 포함) 라이브 확인.
- **피드 폭 원인 확정**: FeedScreen `list{padding:16}` + FeedCard `card{marginHorizontal:20}` **이중 여백 36px/쪽** — v3.47 조정이 카드 쪽만 보고 리스트 패딩을 놓침.
- FeedCard는 FeedScreen 전용(UserChannel은 자체 경량 카드) — 라이트 전환 영향 범위 격리 확인. AppText는 style이 tone보다 후순위 병합(AppText.tsx:28) → 색 오버라이드 가능.

### 변경 매트릭스
| 파일 | 변경 | 로그 추적자 |
|---|---|---|
| PlayerScreen.tsx | info 탭 제거(3탭), 토글 라벨 "가사 · 프롬프트 · 착장", 기획사 클릭 → uploader_id 있으면 UserChannel(없으면 구형 폴백) | [Player] |
| UserChannelScreen.tsx | 앨범 fetch 추가, 통계 앨범/트랙/팔로워, 탭명 곡·앨범/피드/커뮤니티, 곡·앨범 탭에 앨범 카드(탭→앨범 트랙 재생) | [UserChannel] |
| components/feed/FeedCard.tsx | 라이트 팔레트 `feedCardLight` 정의·적용(흰 카드+어두운 텍스트), marginHorizontal 제거(폭 픽스 절반) | [FeedCard] |
| FeedScreen.tsx | 리스트 가로 패딩 16→12(폭 픽스 나머지), 본문/트랙칩 라이트 색 적용 | [FeedScreen] |

백엔드 변경 없음(기존 API로 충족). 팀 역할: planner+frontend-dev 주도, tester는 tsc+Playwright(Expo Web 8081).

---

## v3.48 — 2026-08-19 — A그룹(백엔드 원격) + B그룹(프론트) 일괄

### 요청
"A작업 끝나면 B작업까지 다 해" — A1 대댓글 / A2 알림 / A3 별 차감 / A4 프롬프트 공개 / A5 Range + B1 세션 / B2 env / B3 신고내역 / B4 WS·배지 / B5 MV / B6 저장.

### Plan verification findings
- 서버: /mnt/d/.../0_platform_music (admin, v190) — 9004·9005 미러, reload 없음(setsid 재시작). spend_points 서비스는 기존재(라우트만 부재). WS 라우트 존재하나 **websockets 라이브러리 미설치로 404**(신규 발견). 댓글 serializer는 doc 전체 반환이라 parent_id 추가만으로 응답 포함.

### 변경 매트릭스
| 위치 | 파일 | 변경 |
|---|---|---|
| 서버 v191 | feeds.py(9004/9005) | CommentBody.parent_id + 검증 + 평탄화 |
| 서버 v192 | notifications.py(신규)·follows.py·feeds.py·main.py | 알림 라우터 + 발행 훅 4종 + 팬아웃 |
| 서버 v193 | points.py·points_service.py·tracks.py | /spend + 단가 2종 / generation_params 병합(캐시 v3) / Range 206 |
| 서버 | venv×2 | websockets 설치 |
| 프론트 | FeedCard | parent_id 전송·트리(마커 폴백) |
| 프론트 | NotificationsScreen(신규)·HomeHeaderActions·App | 알림함+벨 뱃지+라우트 |
| 프론트 | DirectorLineup·ArtistInput | 별 차감 연동(402 안내) |
| 프론트 | PlayerScreen | generation_params 병합·MV Video 재생(진입 시 곡 일시정지) |
| 프론트 | authStore·App | 토큰 영속+restoreSession |
| 프론트 | services/api | EXPO_PUBLIC_API_URL |
| 프론트 | MyReportsScreen(신규)·SettingsScreen | 신고 내역 |
| 프론트 | services/dmSocket(신규)·HomeHeaderActions·DmChatScreen | WS 실시간(폴링 폴백 유지) |
| 프론트 | TrackRow·MyMusicScreen | footer 슬롯·배지 복원 |
| 프론트 | TrackShareDownloadSheet(+expo-sharing) | 네이티브 기기 저장 |

---

## v3.47 — 2026-08-19 — 댓글 중첩 스레드 + ⋯ 팔로우 메뉴 + 여백

### 요청
① 팔로우 알림 확인 ② ⋯ 메뉴 팔로우/팔로우 중/신고 ③ 피드 가로 간격 ④ 답글 중첩 스레드(@멘션 폐기).

### Plan verification findings
- 팔로우 알림 없음(발행 코드 0건). ⋯ 메뉴에 팔로우 부재. 카드 margin 16(<20). @멘션 방식은 사용자 편집으로 관계 소실 — 구조화 마커 `[reply:{id}]`로 전환(백엔드 parent_id 부재의 클라 측 최선).

### 변경 매트릭스
| 파일 | 변경 | 로그 |
|---|---|---|
| components/feed/FeedCard.tsx | 스레드(마커 저장/파싱/중첩 렌더/폴백), 답글 배너, ⋯ 팔로우 토글(lazy summary), margin 20 | `[FeedCard] follow 토글/댓글 등록(reply)` |

---

## v3.46 — 2026-08-19 — 피드 인스타식 + 댓글/답글 + DM(#태그) + 알림·서버 답변

### 요청
① 피드 인스타/페북식 ② 댓글+대댓글 ③ 업로드 알림 확인 ④ DM 이식(#고유번호) ⑤ WSL 서버 .env 접근 ⑥ 가이드 파일명.

### Plan verification findings
- 피드 카드 통계 표시 전용(액션 불가). 댓글 API 존재하나 parent_id 없음(대댓글 백엔드 미지원, MAIDOL도 없음). 알림 시스템 부재(라우터·발행 없음). DM 15 API 완비(본인인증 게이트, #태그=referral_code 4자리). 서버 UTC 타임스탬프 무표기 → 로컬 파싱 9시간 오차.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/feed/FeedCard.tsx (신규) | 인스타식 카드+좋아요 토글+댓글/답글(@멘션)+공유+⋯메뉴+신고 | `[FeedCard] like/댓글` |
| screens/FeedScreen.tsx | renderPost→FeedCard | 기존 유지 |
| screens/DmInboxScreen.tsx (신규) | 목록/요청 탭+새 메시지(#태그 검색·내 태그)+인증 게이트 | `[DmInbox] …` |
| screens/DmChatScreen.tsx (신규) | 말풍선+8s 폴링+요청 수락/거절/차단+신고 | `[DmChat] …` |
| components/HomeHeaderActions.tsx | 봉투 아이콘+미읽음 뱃지(30s 폴링) | `[HomeHeaderActions] dm unread` |
| App.tsx / components/ReportModal.tsx | 라우트 2종 / dm_message 타입 | — |
| (공통) | UTC 'Z' 보정 parseUtc | — |

---

## v3.45 — 2026-08-19 — 회사 정보 링크 + 문구 정리 + 설정 여백 통일

### 요청
① 푸터에 이용약관/개인정보처리방침/고객센터 링크 ② 통신판매업 면제 라인 제거 ③ 회사명 "주식회사 로터스에이아이" ④ 설정 가로 여백 통일.

### Plan verification findings
- CompanyFooter에 링크 3종 누락(MAIDOL Footer엔 존재). 통신판매업 면제 표기는 의무 아님. settingRow가 marginHorizontal 없는 풀블리드 → 꽉 찬 느낌.

### 변경 매트릭스
| 파일 | 변경 | 로그 |
|---|---|---|
| components/PolicySheet.tsx | CompanyFooter 링크 3종(onOpenPolicy/mailto), 문구 정리, 회사명 변경 | `[CompanyFooter] 메일 열기 실패` |
| screens/SettingsScreen.tsx | settingRow marginHorizontal 20, 비로그인 분기 PolicySheet, 푸터 패딩 래퍼 | 기존 유지 |

---

## v3.44 — 2026-08-19 — 회사 정보·약관 + 생년월일 UI + 인증 헤더 + OAuth 준비

### 요청
① 회사 정보/처리방침 위치+구현 ② 생년월일 '일' 칸 잘림 ③ 헤더 '설정'→로그인/회원가입 ④ 본인인증 자문 ⑤ OAuth 서버 설정(가능한 만큼).

### Plan verification findings
- '일' 칸 잘림 = 웹 input 고유폭으로 flex 축소 불가(min-width:auto) → minWidth:0 필요.
- TitleRow '설정' 고정. 약관 메뉴는 "준비 중" Alert. 회사 정보 표기 관행 = 설정 최하단 + 문서 페이지.
- OAuth: 서버 .env 로딩(기동 시). SSH 2222 publickey 거부(키 미등록) + 클라이언트 키는 콘솔 발급 필요 → 서버 측은 가이드 문서로 대체, 프론트 콜백 수신은 선구현.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/auth/AuthPanel.tsx | birthInput minWidth:0, onModeChange, 내부 타이틀 제거 | 기존 유지 |
| screens/SettingsScreen.tsx | 헤더 타이틀 분기, 약관 메뉴→PolicySheet, CompanyFooter 2곳 | 기존 유지 |
| components/PolicySheet.tsx (신규) | 정책 문서 모달 + 사업자 정보 푸터 | — |
| stores/authStore.ts | loginWithToken(소셜 콜백) | `[authStore] loginWithToken 실패` |
| App.tsx | 웹 #token= 콜백 훅(URL 즉시 정리) | `[App] OAuth 콜백` |
| docs/OAUTH_SETUP.md (신규) | 서버 설정 가이드(플레이스홀더만) | — |

---

## v3.43 — 2026-08-18 — 마이뮤직 정렬 + 하단바 아이콘 + 로그인·회원가입 MAIDOL 이식

### 요청
① 마이뮤직 곡 목록을 플레이리스트/차트와 통일 ② 하단바 플레이리스트=재생·피드=연필 아이콘 ③ 로그인·회원가입 MAIDOL 참고 개편(소셜 포함).

### Plan verification findings
- 마이뮤직: listContent paddingHorizontal:20 이중 들여쓰기 + likedMap 미연동이 원인.
- 치명 버그: 현행 백엔드 register는 consents·gender 필수 → AIDOL 가입 항상 400 + 에러 키(detail vs error) 불일치로 원인 은폐.
- MAIDOL 로그인/가입 구성·문구·검증 규칙 전수 조사(worktree). 소셜 3종은 서버 리다이렉트 방식, 현재 키 미설정으로 503.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| screens/MyMusicScreen.tsx | 이중 패딩 제거, likes 연동 | 기존 유지 |
| App.tsx | 탭 아이콘 play-circle/edit-3 | — |
| constants/consentTexts.ts (신규) | 약관 전문(AIDOL 치환) | — |
| components/auth/ConsentList.tsx (신규) | 전체동의+5항목+보기 | — |
| components/auth/SocialLoginButtons.tsx (신규) | 소셜 3종, 503 안내 | `[AuthPanel:*] 소셜 로그인` |
| components/auth/AuthPanel.tsx (신규) | 로그인/게이트/가입/blocked 흐름 | `[AuthPanel] login/register 시도` |
| stores/authStore.ts | register extra payload, error 키 수정 | 기존 유지 |
| screens/SettingsScreen.tsx | 인라인 폼 → AuthPanel | 기존 유지 |

---

## v3.42 — 2026-08-18 — 빈 상태·CTA·flex 정렬 + 공유/다운로드 선택지 + 신고 + 프롬프트 파라미터

### 요청
① 빈 재생목록 이모지 제거 ② 마이페이지 로그인 CTA 통일 ③ 순번 없는 목록 flex 정렬(빈 공간 제거) ④ 마이뮤직 공유/다운로드 선택지(MAIDOL 동일) ⑤ Now Playing 신고 ⑥ 곡 생성 프롬프트 설정값 표시.

### Plan verification findings
- MAIDOL 최신 코드는 worktree `/Users/pearl/TripleJ-maidol/0_platform_music`. main 체크아웃엔 공유 선택지·신고 없음(오판 주의).
- 신고: ReportModal.jsx 사유 5종, 본인 곡 미표시. AIDOL 원격 백엔드에 POST /api/reports/ 이미 존재(검증 메시지로 확인) → 백엔드 개발 불필요.
- 공유 3종은 동일 API(format=sns), 폴백 URL만 상이 + 링크 복사. 다운로드는 wide/sns/kakao 영상 + mp3(로그인).
- 프롬프트: 보컬·스타일·악기 등은 generations 전용이며 GET /generate/{id}는 소유자만(403). MAIDOL도 동일 한계.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/TrackRow.tsx | 좌측 슬롯 없으면 커버가 선두(coverFirst) | — |
| screens/ChartScreen.tsx | 빈 재생목록 이모지 제거 | — |
| screens/MyMusicScreen.tsx | 로그인 CTA → 공용 LoginPrompt, ⋮ 공유·다운로드 → 선택지 시트 | 기존 유지 |
| components/TrackShareDownloadSheet.tsx (신규) | 공유 4종/다운로드 4종 | `[TrackShareDownloadSheet] share-video/mp3` |
| components/ReportModal.tsx (신규) | 사유 5종 + 기타 상세, 409/400 처리 (사유 원문 미로깅) | `[ReportModal] submit` (길이만) |
| screens/PlayerScreen.tsx | 액션행 공유·신고(본인 곡 숨김), 프롬프트 탭 파라미터 확장 + generation 조인 | `[PlayerScreen] generation 상세 조회` |

---

## v3.41 — 2026-08-18 — 순번 비우기(검색·플레이리스트·마이뮤직) + 카테고리 문구 + 결과 전체 담기

### 요청
① 검색 순번 비우기 ② 플레이리스트·마이뮤직도 동일하게(공용 행 + 순번 비움) ③ 검색 결과 제목을 "(운동) 할 때 듣는 음악" 형태로 ④ 검색한 곡 모두 플레이리스트에 담기.

### Plan verification findings
- 플레이리스트/마이뮤직은 아직 자체 행 렌더(공용 TrackRow 미적용). 마이뮤직 행에는 태그·생성일·공개상태·공유/다운로드/차트업로드/삭제가 붙어 있어 **단순 교체 시 기능 손실** → ⋮ 확장 항목으로 보존 필요.
- 플레이리스트 상세 행에는 ✕(플레이리스트에서 제거)가 있음 → 동일하게 ⋮로 이동.
- 대량 담기용 API 없음 → 기존 `POST /playlists/{id}/tracks`를 곡 수만큼 순차 호출(중복 실패는 건너뜀).

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/PlaylistPickerSheet.tsx (신규) | 단일·다중 곡 공용 담기 시트(기존 선택/새로 만들기, 부분 실패 집계) | `[PlaylistPickerSheet] 조회/추가 실패` |
| components/TrackActionSheet.tsx | `extraItems`(화면 고유 항목) 지원, 담기 시트를 공용 컴포넌트로 위임 | 기존 유지 |
| screens/SearchScreen.tsx | 순번 제거, 카테고리 헤드라인 문구, '모두 담기' 버튼+시트 | `[SearchScreen] 모두 담기` |
| screens/PlaylistScreen.tsx | 자체 행 → TrackRow(순번 비움), ⋮에 '이 플레이리스트에서 제거' | 기존 유지 |
| screens/MyMusicScreen.tsx | 자체 행 → TrackRow(순번 비움), ⋮에 공유·다운로드·차트 업로드·삭제 | 기존 유지 |

---

## v3.40 — 2026-08-18 — 곡 목록 행·더보기 메뉴 공용화(검색 = 차트 동일 디자인)

### 요청
검색 결과 곡 행을 차트와 동일한 디자인으로.

### Plan verification findings
- 차트/검색이 각자 행을 렌더(복붙) → 구조 자체가 다름(차트: 순위·통계·⋮·마퀴 / 검색: 커버·제목·▶아이콘).
- v3.38 로그인 CTA와 동일한 유형의 불일치 → 공용 컴포넌트 추출로 재발 방지.
- 검색엔 play_count/like_count 타입 필드·좋아요 동기화 부재.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/TrackRow.tsx (신규) | 공용 곡 행(좌측 슬롯/커버/마퀴/통계/⋮) + TrackCover·getTrackCoverUri·trackRowStyles | — |
| components/TrackActionSheet.tsx (신규) | 공용 ⋮ 메뉴 + 플레이리스트 시트 + 비회원 담기 안내 | `[TrackActionSheet] addToQueue` 등 |
| screens/ChartScreen.tsx | 자체 행·시트·핸들러 → 공용 컴포넌트로 대체, 중복 제거 | 기존 유지 |
| screens/SearchScreen.tsx | TrackRow(좌측 순번)+TrackActionSheet 적용, likes sync, 타입 보강, 미사용 코드 제거 | 기존 유지 |

---

## v3.39 — 2026-08-18 — 담기 안내 팝업 1회만 + 검색 느낌 칩 이모지·라벨 제거

### 요청
① 계속 담기 1회 후 차트 담기에서 팝업 재노출 금지 ② 검색 칩 이모지 전부 제거 ③ "느낌별 음악" 텍스트 제거.

### Plan verification findings
- guestNoticeAck가 partialize에 없어 비영속 → 재시작 시 false로 복귀해 팝업 재노출. resetOnLogout도 ack를 초기화.
- 검색 이모지 3지점: 칩, 결과 헤더, CATEGORY_EMOJI 상수. "느낌별 음악"은 섹션 제목 + EmptyState 힌트 참조.

### 변경 매트릭스
| 파일 | 변경 | 로그 |
|---|---|---|
| stores/playerStore.ts | guestNoticeAck 영속화, resetOnLogout에서 ack 초기화 제거 | 기존 유지 |
| screens/SearchScreen.tsx | 칩·결과헤더 이모지 제거, CATEGORY_EMOJI 삭제, "느낌별 음악" 제목 제거, 힌트 문구/미사용 스타일 정리 | 기존 유지 |

---

## v3.38 — 2026-08-18 — 검색 화면 로그인 CTA 공통 컴포넌트로 통일

### 요청
검색 페이지의 "로그인하고 시작하기"를 다른 화면과 디자인·위치 통일.

### Plan verification findings
- 피드/플레이리스트/작업실: 공통 `LoginPrompt`(+LoginStartButton), 컨테이너 flex:1+center.
- 검색(`SearchScreen.tsx:202`)만 AppText(body/lineHeight 20)+범용 Button 자체 조합, 컨테이너 paddingVertical:huge → 상단 치우침. 폰트·버튼·위치 모두 상이.

### 변경 매트릭스
| 파일 | 변경 | 로그 |
|---|---|---|
| screens/SearchScreen.tsx | 자체 CTA → 공통 LoginPrompt, loginCta를 flex:1+center로, Button import·loginHint 제거 | (기존 화면 로그 유지) |

---

## v3.37 — 2026-08-18 — 별 안내 문구 보강 + 가입=승계 / 로그인=계정 목록 복원

### 요청
① 별이 뭔지 알 수 있게 "별을 모으면 작업실에서 나만의 음악을 만들 수 있다" 문구 추가 ② 가입 사용자만 담아둔 재생목록 승계, 로그인은 그 계정의 기존 목록을 복원.

### Plan verification findings
- v3.36은 login/register 모두 claimQueue → 분기 필요.
- v3.36 잠재 버그: queue+owner를 영속화해 재시작(=세션 초기화) 후 이전 사용자 목록이 게스트에게 노출 가능.
- 계정별 목록 보관소 없음(서버 API도 없음) → 로컬 savedQueues 도입.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| stores/playerStore.ts | savedQueues(계정별 보관, 영속) + 큐 변경 시 자동 저장, claimQueue=가입 전용, restoreQueueFor=로그인 복원, resetOnLogout 저장 후 비움, 영속 대상 축소(작업 큐 비영속) | `[playerStore] restoreQueueFor`, `claimQueue`, `resetOnLogout` |
| stores/authStore.ts | login→restoreQueueFor / register→claimQueue 분기 | `[authStore] restoreQueueFor 실패`(catch) |
| components/GuestQueueNoticeModal.tsx | 별 설명 문구(작업실에서 나만의 음악) 추가 | — |
| screens/ChartScreen.tsx | 목록 상단 배너 문구 동일 보강 | — |

### 정책
가입=승계 / 로그인=계정 목록 복원(없으면 승계) / 로그아웃=보관 후 비움 / 재시작=비회원 목록 소멸·계정 목록은 보관함 유지.

---

## v3.36 — 2026-08-18 — 담기 선택 팝업 + 내 재생목록 비회원 개방 + 로그인 시 큐 승계

### 요청
① 비회원 담기 → 로그인 화면 튕김 대신 [로그인하고 시작하기]/[계속 담기] 팝업(경고: 다음 접속 시 사라짐, 별 못 받음) ② 계속 담기 시 담은 곡이 내 재생목록에 그대로 보임(회원 전용 철회) ③ 담다가 로그인하면 재생목록 보존.

### Plan verification findings
- v3.35 회원 전용 게이트 = 철회 대상. PlayerScreen '담기'(:520)는 실제로 담지 않는 스텁이었음.
- authStore 영속/복원 없음 + playerStore 큐 무조건 영속 → 비회원 큐가 재접속에도 남아 안내문과 모순 → queueOwnerId 도입으로 해소.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/GuestQueueNoticeModal.tsx (신규) | 2선택 팝업 + 경고문 | — |
| screens/ChartScreen.tsx | 게이트 제거, 안내 배너, 담기 시 팝업 | `[ChartScreen] 비회원 담기 → 안내 팝업` |
| screens/PlayerScreen.tsx | 담기 스텁 → 실제 큐 추가 + 팝업 | `[PlayerScreen] 담기 → addToQueue` |
| stores/playerStore.ts | queueOwnerId(영속)·claimQueue·guestNoticeAck·재수화 시 비회원 큐 폐기 | `[playerStore] claimQueue`, `비회원 재생목록 폐기` |
| stores/authStore.ts | login/register 성공 → claimQueue(user.id) | `[authStore] claimQueue 실패`(catch) |

### 정책
내 재생목록 = 비회원도 사용 가능(재시작 시 폐기·별 미적립), 로그인 시 승계 보존. v3.35의 회원 전용 규정을 대체.

---

## v3.35 — 2026-08-18 — 내 재생목록 회원 전용 게이트 + 플레이리스트 재생=큐 교체(정정)

### 요청
① 내 재생목록 = 로그인 회원 기능(비회원 재진입 시 없음) ② 플레이리스트 곡 재생목록에 누적 금지(v3.34 되돌리기) ③ 플레이리스트 재생 시 그 목록이 재생목록이 됨(교체).

### Plan verification findings
- v3.34 mergeAndPlay(누적)는 의도와 반대 → setQueue(교체)로 정정.
- authStore.logout(:86)은 큐 미초기화, playerStore는 큐 영속 → 로그아웃 후 잔존.
- 차트 '내 재생목록' 탭 게이트 없음. LoginPrompt/ requireLogin 패턴 기존 존재.

### 변경 매트릭스 (추적자: prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| screens/PlaylistScreen.tsx | mergeAndPlay→setQueue(교체) | `[PlaylistScreen] 플레이리스트 재생(큐 교체)` |
| stores/playerStore.ts | mergeAndPlay 제거, `resetOnLogout()` 추가 | `[playerStore] resetOnLogout` |
| stores/authStore.ts | logout에서 resetOnLogout 호출 | `[authStore] resetOnLogout 실패`(catch) |
| screens/ChartScreen.tsx | '내 재생목록' 탭 비로그인 시 LoginPrompt 게이트 | `[ChartScreen] 내 재생목록 탭 — 비로그인` |

---

## v3.34 — 2026-08-18 — 재생목록↔플레이리스트 구분(큐 보존) + 재생목록 아이콘 위치 교체

### 요청
① 플레이리스트 재생이 재생목록(누적 큐)을 덮어써 섞인 것처럼 보임 — 구분 필요. ② ≡(순서 편집)와 ×(닫기) 위치 교체.

### Plan verification findings
- PlaylistScreen 곡 탭 = `setQueue(playlistTracks)`(교체) → 누적 18곡이 5곡으로 덮여 사라짐(파괴적). 차트/‘재생목록에 추가’는 이미 `addToQueue`(누적).
- DraggableQueue 행: `본문 → ×(제거) → ≡(핸들)` 순.

### 변경 매트릭스 (추적자: 컴포넌트 prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| stores/playerStore.ts | `mergeAndPlay(tracks,targetId)` — 누적(중복제외)+id정규화+선택곡 재생, 파괴적 교체 제거 | — |
| screens/PlaylistScreen.tsx | 곡 탭 `setQueue`→`mergeAndPlay`(큐 보존) | `[PlaylistScreen] mergeAndPlay` |
| components/DraggableQueue.tsx | 행 배치 `본문 → ≡ → ×`로 교체 | — |

### 설계 결정
재생목록 = 단일 누적 '지금 재생' 목록 / 플레이리스트 = 저장 소스. 플레이리스트 재생은 큐를 보존 누적. Search/Artist/Feed/UserChannel의 setQueue 교체는 이번 범위 외(후속 통일 가능).

---

## v3.33 — 2026-08-18 — 마퀴 크로스플랫폼 측정 + 재생목록 드래그 편집 + 차트 '내 재생목록' 탭

### 요청
① 제목 아직 말줄임 재확인 ② 재생목록 드래그로 순서 편집 ③ 차트에 '내 재생목록' 탭 추가(멜론 대비 자문)

### Plan verification findings
- Marquee: v3.32는 web 전용(whiteSpace nowrap + absolute 측정) → 네이티브 측정 실패로 말줄임 잔존. → 실표시 텍스트(flexShrink:0) onLayout 측정으로 크로스플랫폼화.
- 드래그 라이브러리 전무(draggable-flatlist/gesture-handler/reanimated) → reanimated 도입 리스크 회피 위해 내장 PanResponder로 구현.
- 차트 TABS 4개(ChartScreen.tsx:37), playerStore.queue/currentIndex 존재 → 로컬 큐 노출 탭 추가. 멜론은 큐를 플레이어 상시버튼, 플레이리스트는 라이브러리로 분리(랭킹과 큐 미혼합) — 라벨 '내 재생목록'으로 구분.

### 변경 매트릭스 (추적자: 컴포넌트 prefix)
| 파일 | 변경 | 로그 |
|---|---|---|
| components/Marquee.tsx | 측정 방식 재작성(실표시 텍스트 onLayout, numberOfLines 제거) | — |
| stores/playerStore.ts | `reorderQueue(from,to)` + currentIndex 보정 | — |
| components/DraggableQueue.tsx (신규) | PanResponder 드래그 편집(응답기 index별 캐시) | `[DraggableQueue] reorder` |
| screens/PlayerScreen.tsx | 큐 모달 → DraggableQueue 교체 + 안내문구 | — |
| screens/ChartScreen.tsx | TABS에 queue 탭, fetch 스킵, 큐 데이터소스, ▶표시 | `[ChartScreen] 내 재생목록 탭` |

---

## v3.32 — 2026-08-18 — 마퀴 실동작 수정 + 미니플레이어 재생목록 바로가기 + Now Playing 라인 제거

### 요청
① 마퀴 아직 ...으로 보임(재확인) ② 재생목록 접근 불편(MAIDOL도 곡 클릭 필요?) ③ Now Playing 하단 라인 제거.

### Plan verification findings (0단계)
- 마퀴 overflow 미감지: 측정텍스트가 컨테이너폭으로 개행→자연폭 측정 실패. 복사본 numberOfLines=1이 웹 ellipsis 강제.
- 재생목록=MAIDOL도 /player 내부(곡 클릭 필요). v3.31에서 헤더 borderBottom 추가로 상단바 룩.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| components/Marquee.tsx | 측정텍스트 web nowrap→자연폭, 복사본 numberOfLines 제거+폭고정+nowrap→말줄임 없이 흐름 | — |
| components/MiniPlayer.tsx + PlayerScreen.tsx | 미니플레이어 재생목록 버튼→openQueue param→큐 모달 즉시 | — |
| screens/PlayerScreen.tsx | 헤더 borderBottom 제거 | — |

---

## v3.31 — 2026-08-18 — 차트 제목 마퀴 + 플레이어 레이아웃 재정비 + 동영상 가사 중앙/개행

### 요청
① 차트 제목 ... 대신 흐르는 텍스트 ② 플레이어 하단 좋아요/담기/재생목록 안보임(상단바 정리) ③ 동영상 가사 세로중앙+개행.

### Plan verification findings (0단계)
- 제목 numberOfLines=1 말줄임. v3.29 미디어탭+토글 절대배치+헤더 paddingTop56 이중인셋→오버플로로 액션열 미노출. LyricSyncView 윈도우 비대칭→활성라인 치우침, 개행 폭 제약 없음.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| components/Marquee.tsx (신규) + ChartScreen | 제목 마퀴(오버플로 시 흐름) | — |
| screens/PlayerScreen.tsx | 헤더 상단바화, 토글 정상플로우, 커버 210, 세로압축→액션열 노출 | — |
| components/LyricSyncView.tsx | 활성라인 대칭 패딩→세로중앙, 가로 개행 | — |

---

## v3.30 — 2026-08-18 — 웹 seek 실동작(Range presigned 스트림 소스) + 재생/seek 실측

### 질문
웹 실제 재생/seek 테스트 못 하나?

### Plan verification findings (0단계 실측)
- 재생=웹 테스트 가능·정상(위치 진행). seek=stream-proxy가 Range 무시(200)라 웹 불가였음. GET /tracks/stream/{id}=presigned(부작용無)+Range 206 지원, 호스트 동일 IP(도달가능).

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/PlayerScreen.tsx | getAudioUri: 웹=presigned(/tracks/stream, Range), 네이티브=stream-proxy. 오디오 로드 4곳 통일 | `[PlayerScreen]` |

실측: 재생 3s→7s, seek 드래그→3:04 점프·유지(웹 seek 실동작). 네이티브 실기기 테스트는 환경상 불가(stream-proxy로 이미 정상).

---

## v3.29 — 2026-08-18 — 차트클릭 즉시재생 · 70%재생보상(seek허용) · 하단토글 절대노출 · 음악/동영상 가사싱크

### 요청
① seek vs 별지급(70%?) ② 곡정보 화면 분석·결손수정 ③ 음악/동영상 전환+동영상 가사 ④ 하단 토글 여전히 안보임 ⑤ 차트클릭 곡이 기존 재생중이어도 즉시 재생(현재 큐추가만).

### Plan verification findings (0단계, MAIDOL 실측)
- 재생보상=70% 위치 도달 시 POST /charts/record-play→별+1(하루5), 위치기반=seek허용. AIDOL 미구현.
- 차트클릭버그: track=storeTrack(옛곡) 우선→마운트 효과 재사용→새곡 미재생.
- 동영상=music-video(대개없음) or lyrics-timeline 가사싱크(정상). 

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/PlayerScreen.tsx | loadAndPlay(target=routeTrack) 즉시재생, 70% record-play, 하단토글 절대배치, 노래/동영상 토글+가사싱크 | `[PlayerScreen]` |
| components/LyricSyncView.tsx (신규) | 가사 싱크(활성라인 하이라이트) | — |

seek 정책=70% 위치기반이라 자유 허용(제한 불필요). MV 재생은 후속.

---

## v3.28 — 2026-08-18 — 차트클릭→큐추가+재생 · seek 리셋 픽스 · 정보토글 · 플리탭 아이콘

### 요청
① 차트 곡 클릭→재생목록 추가+재생 ② seek 드래그 시 처음으로 돌아감 점검 ③ 플레이어 곡정보 토글 안보임 ④ 플리 탭 아이콘 폴더/묶음.

### Plan verification findings (0단계)
- handleTrackPress=setQueue(전체차트). seek: value undefined→웹 0리셋 + onPlaybackStatusUpdate stale isSeeking. **+백엔드 stream-proxy Range 미대응(200 반환)→웹 seek 불가**. 정보토글 오버플로 잘림. 플리 탭=list.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/ChartScreen.tsx | handleTrackPress → addToQueue+재생 | `[ChartScreen]` |
| screens/PlayerScreen.tsx | seek seekValue/isSeekingRef, 슬라이더 value·onValueChange, 정보토글 flex 하단고정 | `[PlayerScreen]` |
| App.tsx | 플리 탭 list→folder | — |

특이: seek 프론트 리셋버그 수정=네이티브 OK 예상. 웹 seek은 백엔드 stream-proxy Range(206) 대응 필요(사용자 재배포). 

---

## v3.27 — 2026-08-18 — 차트 행 재생수·좋아요수 표시(하트 자리) + 좋아요는 ⋮

### 요청
차트에 재생수·좋아요수 노출. 하트 자리에 수치, 좋아요는 ⋮에서.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/ChartScreen.tsx | 인라인 하트 제거 → ▶재생수/♥좋아요수 표시, 좋아요 토글 시 카운트 낙관적 ±1 | `[ChartScreen]` |

---

## v3.26 — 2026-08-18 — 차트 클린 리디자인 + MAIDOL 아이콘 + 재생목록/플레이리스트 구분

### 요청
차트 어지러움→깔끔, MAIDOL 아이콘 그대로, 재생목록/플레이리스트 아이콘 구별.

### Plan verification findings (0단계)
- 기존 행 과밀(장르pill+2카운트+3버튼). 재생목록=list, 플레이리스트=+ 혼동. MAIDOL=FiPlay/FiHeart/FiPlus(큐)/FiBookmark(플리)=Feather play/heart/plus/bookmark.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/ChartScreen.tsx | 행 미니멀화(순위/커버/제목·아티스트/♥/⋮), ⋮ 액션시트(재생/좋아요/재생목록plus/플리bookmark) | `[ChartScreen]` |

---

## v3.25 — 2026-08-18 — 재생목록(큐) 추가·뷰 + 다운로드/공유 마이뮤직 이관

### 요청
① 큐: 차트 재생목록 추가 버튼 + 플레이어 큐 뷰. ② 다운로드/공유는 내 곡만 → 마이뮤직에서 관리.

### Plan verification findings (0단계)
- playerStore에 큐/switchToTrack 있으나 add/remove·큐 뷰 없음. 다운로드 API=POST /tracks/download/{id}(presigned). PlayerScreen 다운로드는 타인곡 구매 겸함 → 내 곡만 원칙과 불일치. MyMusic=/tracks/my(본인곡).

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| stores/playerStore.ts | addToQueue/removeFromQueue | — |
| screens/ChartScreen.tsx | 행에 재생목록 추가 버튼 | `[ChartScreen]` |
| screens/PlayerScreen.tsx | 다운로드 제거 → 재생목록 버튼+큐 모달 | — |
| screens/MyMusicScreen.tsx | 내 곡 행 공유(Share)/다운로드(presigned) | `[MyMusic]` |

큐=클라 인메모리. MyMusic 버튼 E2E는 본인곡 보유 계정 필요(추후).

---

## v3.24 — 2026-08-18 — 비로그인 좋아요/담기 무반응 픽스 + 재생목록 화면 조사

### 요청
비로그인 좋아요·담기 클릭 시 로그인 화면으로 이동해야 하는데 무반응. + MAIDOL 재생목록(큐) 화면 존재 여부 질문.

### Plan verification findings (0단계)
- `ChartScreen.requireLogin` = Alert.alert 다중버튼 → RN-Web 미지원 → 무반응.
- MAIDOL 재생목록 = PlayerPage(/player) 내 탭(인메모리 PlayerContext.playlist), 백엔드 큐 없음. 플레이리스트(/playlists)와 별개. AIDOL엔 playerStore.queue만 있고 큐 보기 화면·큐추가 버튼 없음.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/ChartScreen.tsx | requireLogin: Alert 다중버튼 → navigate('Settings') | `[ChartScreen]` |

후속 후보: 차트 "재생목록 추가" 버튼 + PlayerScreen 재생목록(큐) 탭.

---

## v3.23 — 2026-08-18 — 좋아요(likes) 백엔드 실연동

### 요청
로그인 CTA 통일 보류 → 다음 미반영 기능 진행. 로드맵 대조로 좋아요 실연동 선정.

### Plan verification findings (0단계)
- 차트 하트 = 로컬 Set만(저장 안 됨). 백엔드 likes API 완비(POST/DELETE /likes/{id}, GET /likes/check?song_ids=, GET /likes/). 피드 하트=feed post 좋아요(별개).

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| stores/likesStore.ts (신규) | 좋아요 전역 상태(sync/toggle, 낙관적+롤백) | `[likesStore]` |
| screens/ChartScreen.tsx | 로컬 Set → likesStore, 로드 시 sync, 하트 탭 toggle | `[ChartScreen]` |

미반영 잔여: dm·wishlist·fatigue·rewards·albums·face_verify·oauth·reports·voice_convert·voice_persona·vocal_repair.

---

## v3.22 — 2026-08-13 — 로그인 유도 텍스트(제목/설명)까지 3화면 통일

### 요청
플레이리스트 로그인 화면 버튼 외 텍스트 폰트가 피드·작업실과 다름 → 통일.

### Plan verification findings (0단계)
- 플레이리스트=EmptyState(callout/footnote·muted), 작업실/피드=loginOverlayTitle(20 bold primary)+Desc(15 secondary). 상이.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| components/LoginPrompt.tsx (신규) | 아이콘/제목/설명+버튼 공용 콘텐츠(통일 폰트) | — |
| screens/PlaylistScreen.tsx | EmptyState → LoginPrompt(중앙정렬) | — |
| screens/MapScreen.tsx·FeedScreen.tsx | 오버레이 인라인 텍스트/버튼 → LoginPrompt | — |

측정: 제목 20/700/#fff, 설명 15/400/#a78bfa — 플레이리스트=작업실 동일.

---

## v3.21 — 2026-08-13 — "로그인하고 시작하기" 버튼 3화면 통일

### 요청
플레이리스트/피드/작업실 로그인 버튼 크기·폰트 색상·크기 통일.

### Plan verification findings (0단계)
- 플레이리스트=공용 Button(filled), 피드·작업실=커스텀 loginOverlayButton(accent/radius24/py14 px40/white bold16). 피드=작업실 동일, 플레이리스트만 상이.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| components/LoginStartButton.tsx (신규) | 통일 버튼 컴포넌트 | — |
| screens/MapScreen.tsx·FeedScreen.tsx | 인라인 버튼 → LoginStartButton | — |
| screens/PlaylistScreen.tsx | 공용 Button → LoginStartButton | — |

측정: 3화면 버튼 텍스트 128×18 동일 · 폰트 16/700/#fff 동일.

---

## v3.20 — 2026-08-13 — 로그인 오버레이 정리(작업실 아이콘·피드 텍스트/아이콘 제거)

### 요청
작업실 오버레이 아이콘, 피드 오버레이 "AIDOL 피드" 텍스트 + 그 위 아이콘 제거.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/MapScreen.tsx | loginOverlay 🎵 아이콘 제거(타이틀/버튼 유지) | — |
| screens/FeedScreen.tsx | loginOverlay 👥 아이콘 + "AIDOL 피드" 타이틀 제거(설명/버튼 유지) | — |

---

## v3.19 — 2026-08-13 — 피드 로그인 CTA를 작업실과 동일한 전체화면 딤드 오버레이로 통일

### 요청
작업실 로그인 오버레이(까만 반투명 전체화면 + 중앙 텍스트)와 동일하게 피드 CTA 제작.

### Plan verification findings (0단계)
- MapScreen `loginOverlay` = absoluteFill + rgba(0,0,0,0.75) + 중앙 콘텐츠, 배경 탭 닫힘.
- 피드(v3.18) = 하단 카드형 → 시각 통일 필요.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/FeedScreen.tsx | 하단 카드 CTA → 전체화면 딤드 오버레이(MapScreen loginOverlay 1:1), 트리거·배경탭닫힘 유지 | `[FeedScreen]` |

---

## v3.18 — 2026-08-13 — 피드 로그인 CTA 고정 제거 → 스크롤/팔로워 클릭 트리거

### 요청 (재지적)
하단 고정 말고, 스크롤 동작 발생 시 또는 팔로워 클릭 시 로그인 CTA가 뜨게.

### Plan verification findings (0단계)
- v3.17 = `{!user ? <stickyCta>}` 상시 고정. 테스트 피드가 짧아(1건) FlatList 미스크롤 → onScroll 미발화.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/FeedScreen.tsx | 고정 배너 제거 → ctaVisible 트리거(onScroll/onScrollBeginDrag/아바타·트랙 탭), 닫기 버튼, minHeight로 스크롤 보장 | `[FeedScreen]` |

---

## v3.17 — 2026-08-13 — 검색 운동 디폴트·게이트멘트 + 피드 하단고정 로그인 CTA

### 요청
① 검색 전 첫 칩(운동) 디폴트 선택 + 곡 표시 ② 게이트 멘트 "검색 기능은 로그인 후 이용할 수 있어요" ③ 피드 팔로워 클릭/스크롤 시 "로그인하고 시작하기" 버튼 노출.

### Plan verification findings (0단계)
- SearchScreen(v3.16): 기본=빈 EmptyState, 칩 탭해야 로드. 게이트 멘트="검색과 느낌별 음악…".
- FeedScreen(v3.16): 비로그인 카드 탭→Settings 폼 이동 + 스크롤 끝 footer CTA. → 버튼이 "뜨는" 경험 아님.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/SearchScreen.tsx | loadCategory 분리 + 마운트 시 운동 디폴트 로드 + 게이트 멘트 수정 | `[SearchScreen]` |
| screens/FeedScreen.tsx | 비로그인 하단 고정 CTA 배너(상시) + 카드탭 폼이동 제거 | `[FeedScreen]` |

---

## v3.16 — 2026-08-13 — 느낌별음악 가로칩·게이트확장·검색로딩멘트 + 피드 클릭게이트 + 헤더 좌측정렬 통일

### 요청
① 느낌별 음악 작은 아이콘 가로 스크롤 + 탭 시 곡 ② 검색/느낌칩(미로그인) → 로그인 CTA ③ 검색 로딩 "최적의 음악을 찾고 있습니다" 멘트 ④ 피드 클릭/스크롤 → 로그인 CTA ⑤ 차트/작업실 상단바 좌측 아이콘 정렬 통일.

### Plan verification findings (0단계)
- SearchScreen(v3.15): 큰 카드 그리드 + 스피너 + 텍스트검색만 게이트.
- FeedScreen(v3.15): 비로그인 피드 노출+하단CTA, 카드 탭 게이트 없음.
- 헤더: 차트 `headerTitleAlign:'left'`(App.tsx), 작업실 setOptions 커스텀 title에 align 미설정 → 좌측 인셋 상이.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/SearchScreen.tsx | 느낌별 음악 가로칩 바 + 게이트확장(포커스/입력/칩탭/검색) + 로딩멘트 | `[SearchScreen]` |
| screens/FeedScreen.tsx | 비로그인 카드 탭→로그인(Settings) 래핑 + 핸들러 게이트 | `[FeedScreen]` |
| screens/MapScreen.tsx | 작업실 헤더 headerTitleAlign:'left' (차트와 좌측 정렬 통일) | — |

측정: 차트 AIDOL x=16 == 작업실 작업실 x=16 (diff 0.0).

---

## v3.15 — 2026-08-13 — 피드 소프트게이트·유저채널 + 검색 느낌별음악·게이트 + 작업실 헤더 정리

### 요청
① 피드 우선노출+하단 로그인CTA / "로그인이 필요해요" 삭제 / "아티스트와" 개행 ② 검색 미로그인 게이트 + 기본=느낌별 음악(운동~잠자기) ③ 공유 아이콘 화살표형 ④ 작업실 ⓘ 엔터명 우측 ⑤ 도움말 말풍선 제거 ⑥ 피드 아바타→채널(팔로워/피드/공지/음악, MAIDOL 내채널).

### Plan verification findings (0단계)
- 피드 = 전역 공개 타임라인(비로그인 200) → 소프트 게이트.
- 느낌별 음악: `/charts/categories`(10종) → `/charts/category/{name}`. 이모지 클라 신규 매핑.
- 채널: `/artists/{id}`(프로필/track_count/total_plays), `/follows/summary/{id}`(follower_count/is_following, POST·DELETE), `/feeds/user/{id}?kind=feed|community`(피드/공지), `/artists/{id}/tracks`(음악). 이미지=`/api/upload/cover-preview/{obj}`. 피드에 author_id 존재.
- 기존 ArtistDetailScreen은 트랙+광고만 → 신규 UserChannelScreen.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/UserChannelScreen.tsx (신규) + App.tsx | 채널 페이지(프로필·팔로워·팔로우·음악/피드/공지 탭) + 라우트 | `[UserChannel]` |
| screens/FeedScreen.tsx | 소프트게이트(우선노출+하단CTA), "로그인이 필요해요" 삭제, 아바타→채널 | `[FeedScreen]` |
| screens/SearchScreen.tsx | 느낌별 음악 그리드 + 미로그인 검색 게이트 | `[SearchScreen]` |
| screens/MapScreen.tsx | ⓘ 엔터명 우측, 말풍선 제거, 공유 share(화살표) | — |
| components/HomeHeaderActions.tsx | 공유 share-2→share | — |

---

## v3.14 — 2026-08-13 — 피드 로그인게이트/재생 수정 + 다이아 제거(별 통일) + 작업실 상단바·별팝업 액션

### 요청
① 비로그인 피드 노출 금지 ② 피드 클릭 무반응·내용/음악 미표시 수정(+노출형태 설명) ③ 다이아 다 없애고 별만 ④ 작업실 상단바 별·출석·초대 아이콘 ⑤ 초대 아이콘 공유 아이콘으로 ⑥ 별 팝업 첫가입~내곡발매만 ⑦ 별 팝업 액션(친구초대→공유, 출석→출석, 남곡듣기→차트, 내곡발매→작업실).

### Plan verification findings (0단계)
- `/feeds/timeline` = 인스타형 혼합(is_public 최신200 후보 → 팔로잉 +1000 최상단, 동률 created_at desc). 비로그인도 공개 피드 반환 → 클라 게이트 필요.
- 피드 미표시 원인: 응답이 `{title, blocks:[text|track], author_nickname, like/comment}` 구조인데 기존 카드가 `body/track_title`(없는 필드)만 읽음 + onPress 없음.
- 💎 = 100% 로컬(gemsStore). 게이트 2곳(디렉터 영입 hireCost, 추가 아티스트 100). 백엔드 별=읽기전용(spend 엔드포인트 부재·원격서버). → 다이아 표시 제거 + 두 게이트 무료화, 별(points) 단일 표시.

### 변경 매트릭스
| 파일 | 변경 | 추적자 |
|---|---|---|
| screens/FeedScreen.tsx | 비로그인 게이트 + 실스키마 카드(제목/본문/트랙) + 트랙 탭 재생 | `[FeedScreen]` |
| components/StarGuideModal.tsx | 쓰는곳/작사·작곡/풀사이클 삭제, 버는곳만 + 항목 액션 | `[StarGuideModal]` |
| services/navigationRef.ts (신규) + App.tsx | 전역 navigationRef(모달→화면 이동) | `[navigationRef]` |
| screens/MapScreen.tsx | 작업실 헤더 💎→⭐배지·출석·공유; 버튼 💎 제거 | — |
| components/HomeHeaderActions.tsx | 초대 user-plus→share-2 | — |
| screens/DirectorLineupScreen.tsx | 다이아 게이트 제거(영입 무료)·💎 표시 삭제 | `[DirectorLineup]` |
| screens/ArtistInputScreen.tsx | 추가 아티스트 슬롯 무료화·다이아 문구 삭제 | `[ArtistInput]` |
| components/LevelUpModal.tsx | `+N💎`→달성 문구 | — |

### 특이(경제 영향)
다이아가 유일 게이트였던 **디렉터 영입·추가 아티스트가 무료**가 됨(별 차감 백엔드 부재). 별 과금 원하면 `POST /points/spend` 신설 후속 필요. gemsStore 파일은 잔존하나 화면 미표시.

---

## v3.13 — 2026-08-13 — 별(⭐) 잔액 헤더 배지 + 별 안내 팝업 + 아이콘 교체

### 요청
① 로그인 후 상단바에 **내 별(⭐) 갯수** 표시(MAIDOL과 동일 — 별=작업실 다이아몬드 개념). ② 별 클릭 시 MAIDOL은 출석팝업이지만 AIDOL은 **"별 버는 법" 안내 팝업**(코드에 별 정책 있으면 참고, 없으면 `/Users/pearl/TripleJ/별정책.txt` 참고). ③ 추천하기 아이콘(선물상자)이 기능과 안 어울림 → 다른 아이콘. ④ 작업실 탭 아이콘 → 음표.

### Plan verification findings (0단계)
- **별 잔액 소스오브트루스 = `GET /api/points/balance`→`{balance}`** (MAIDOL 헤더도 `getPointsBalance()` 사용, `components/Header.jsx:122`). 9004 실검증 `{balance:50}`.
- **`GET /api/points/costs`→`{costs:{lyrics:5,compose:15,cover:5,character:10,fatigue_skip:5}}`** — 별정책.txt 소비 금액과 1:1 일치.
- AIDOL 기존 `stores/gemsStore.ts` 💎 = **로컬 persist(AsyncStorage) 전용**(백엔드 별과 별개). Studio 헤더 `MapScreen` 의 💎 는 이 로컬 스토어. → 이번 top-bar 별 배지는 **백엔드 별(points)** 로 연결. (Studio 💎 통합은 MapScreen 핸즈오프 방침상 이번 범위 제외 — REPORT 특이사항에 명시.)
- 추천하기 아이콘 = `HomeHeaderActions.tsx` Feather `gift`. 작업실 탭 아이콘 = `App.tsx:285` Feather `mic`.
- 별정책.txt(별 경제 v1.2): 버는 곳(첫가입+50·인증+30·친구초대+50/+50·출석+10[5일차30·10일차100]·남곡듣기+1×5·내곡발매+5), 쓰는 곳(작사5·작곡15·커버5·아티스트10·피로스킵5, 풀사이클 -25).

### 변경 매트릭스 (추적자 = 컴포넌트 prefix)
| 파일 | 변경 | 로그 prefix |
|---|---|---|
| stores/pointsStore.ts (신규) | 별 잔액 스토어(fetchBalance/setBalance) | `[pointsStore]` |
| stores/uiStore.ts | starGuideOpen 플래그 추가 | — |
| components/StarGuideModal.tsx (신규) | 별 안내 팝업(정책+실코스트) | `[StarGuideModal]` |
| components/HomeHeaderActions.tsx | ⭐배지 추가 + 추천 gift→user-plus | — |
| components/AttendanceModal.tsx | status/check-in balance→pointsStore 동기화 | `[AttendanceModal]` |
| App.tsx | StarGuideModal 렌더 + 로그인 시 fetchBalance + 작업실 mic→music | `[GlobalModals]` |

---

## v3.8 — 2026-08-13 — AppText 심화 통일 #1 (Settings) + MAIDOL 비교 서버

### 요청
"AppText 심화 통일 계속" + "MAIDOL 프론트 따로 띄워 빠진 기능 확인".

### 수행
- SettingsScreen 위계 텍스트(제목/섹션×4/폼) → AppText, style 타이포 속성 제거.
- MAIDOL 프론트 실행: `git worktree add /Users/pearl/TripleJ-maidol origin/backend` → `0_platform_music/frontend` proxy를 원격 9005로 수정 → `npm run dev`(Vite:4000). AIDOL(8081)과 병행 비교 가능. Track B 갭 체크리스트 제공.

### 남은 AppText 큐
반복 행 텍스트(settingLabel 등) + 창작 플로우 화면(Lyrics/Composer/Cover/Artist/Director/Royalty/WaitTimer 등) 순차.

### 테스트 지정
[unit] tsc 0. [e2e] 화면 렌더·에러 0. [회귀] 레이아웃/로직 보존.

---

## v3.7 — 2026-08-13 — 화면 통일 스윕 #2 (하드코딩 색 토큰화)

### 변경 매트릭스
| 파일 | 작업 |
|---|---|
| SplashScreen | 그라데이션 하드코딩→토큰 |
| AgencyProfileScreen | 레거시 태그색→온브랜드 틴트 |
| ArtistDetailScreen | 히어로 그라데이션→토큰 |
| SettingsScreen | 보더 #2a2a3e→border.subtle, 에러 틴트→error |

### 남은 큐
MapScreen(1460줄·15색, 별도 턴) · MusicGenerationScreen · ArtistResultScreen · Composer*/Lyrics*/Cover/Artist*/WaitTimer/Dialogue(색은 의도적) — 이후 EmptyState/AppText 심화 통일.

### 테스트 지정
[unit] tsc 0. [정적] 하드코딩 HEX 제거. [회귀] 레이아웃/로직 무변경.

---

## v3.6 — 2026-08-13 — 화면 통일 스윕 #1 (MyMusic·Playlist)

### 요청
"각 화면마다 공용 컴포넌트로 통일" → 화면 순차 스윕 시작(자율).

### 변경 매트릭스
| 파일 | 작업 |
|---|---|
| `MyMusicScreen.tsx` | 하드코딩 색→토큰, 빈/로그인 상태 3곳→EmptyState+Button |
| `PlaylistScreen.tsx` | 빈/로그인 3곳→EmptyState+Button, 모달 버튼→Button |

### 남은 화면(우선순위 큐)
Agency/ArtistDetail/ArtistResult/Settings/WaitTimer/Map/Splash/Dialogue/MusicGeneration/DirectorLineup/Royalty/Composer*/Lyrics*/Cover/Artist* — 하드코딩 HEX 있는 화면부터 순차 통일 예정.

### 테스트 지정
[unit] tsc 0. [e2e] 각 탭 렌더·에러 0. [회귀] 로그인 후 데이터/로직 보존.

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
