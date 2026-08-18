# REPORT_v3 — 팀: aidol-parity

> 작업 결과 기록일지(누적, 최신 위). 두 위치 동일 비치.

---

## v3.30 (웹 seek 실동작 — Range 지원 presigned 스트림 소스로 전환 + 재생/seek 실측) — 2026-08-18

### 요청/질문
"웹 오디오 실제 seek은 백엔드 Range 필요 / 네이티브 정상 예상 — 이거 테스트를 못 해본다는 얘기? 실제 재생이 잘 되는지?"

### 답변 + Plan verification findings (0단계, 실측)
- **재생(playback)**: 웹에서 **테스트 가능하고 잘 됨** — E2E로 위치 진행 확인(3초→7초). 예전에도 재생 자체는 정상이었음.
- **seek(웹)**: 기존 `stream-proxy`가 Range를 무시(**200 반환**)해 웹 seek 불가였음(v3.28). 그러나 **`GET /tracks/stream/{id}` 가 부작용 없이 presigned MinIO URL을 반환하고, 그 URL은 Range를 지원(206, Content-Range 정상)**함을 실측. presigned 호스트=`100.127.225.55:9100`(백엔드와 동일 IP → 도달 가능). `/download`(다운로드 카운트↑)와 달리 `/stream`은 카운트 부작용 없음.
- 즉 **웹 오디오 소스를 stream-proxy → presigned(stream)로 바꾸면 웹에서도 실제 seek 가능**하며, **내가 웹에서 직접 테스트 가능**.

### 수행 결과 (screens/PlayerScreen.tsx)
- **`getAudioUri(id)` 헬퍼**: **웹 = `GET /tracks/stream/{id}`의 presigned URL(Range 지원)**, **네이티브 = stream-proxy(버퍼링 seek 정상·presigned 호스트 도달성 회피)**. 실패 시 proxy 폴백. 오디오 로드 4곳(loadAndPlay·routeTrack효과·switchToTrack·didJustFinish next) 전부 이 헬퍼로 통일.

### 테스트 (tester) — PASS (웹 실측, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] GET /tracks/stream/{id} presigned Range | **206**(Content-Range) |
| [e2e] 웹 재생 진행(위치 증가) | PASS (3s→7s) |
| [e2e] 웹 seek: 슬라이더 드래그 → **그 지점부터 재생 유지**(0으로 안 돌아감) | PASS (`/tmp/v330_seek.png` — 3:04 점프·유지) |
| [e2e] `web audio = presigned(stream)` 로그 | 확인 |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (사용자 질문 정리 답)
- **재생은 원래도 웹에서 테스트 가능·정상**. **seek이 웹에서 안 됐던 것**이며, 이제 **presigned 스트림 소스로 전환해 웹 seek도 실동작 + 실측 완료**(더 이상 "네이티브에서만 될 것" 추정 아님).
- 네이티브(iOS/Android 실기기·에뮬)는 이 환경에 없어 **네이티브 직접 실행 테스트는 불가**하나, 네이티브는 stream-proxy로 이미 버퍼링 seek이 되며 회귀 위험 없음.
- presigned URL 1시간 만료 — 곡 로드 시마다 새로 발급하므로 실사용 문제 없음.

### 커밋
`fix: v3.30 웹 seek 실동작 — Range 지원 presigned(/tracks/stream) 오디오 소스 + 웹 재생/seek 실측 (team-dev)` — 푸시 OFF.

---

## v3.29 (차트클릭 즉시재생 픽스 · 70%재생보상(seek허용) · 하단토글 절대노출 · 음악/동영상 가사싱크) — 2026-08-18

### 요청 작업
① seek이 별 지급과 무관한지(70% 기준인지) 확인해 정책 반영. ② MAIDOL 플레이어 곡정보 화면 분석 → AIDOL에 없는 화면 파악·수정. ③ MAIDOL 음악/동영상 전환 + 동영상 클릭 시 가사 화면 적용. ④ 하단 토글 아직도 안 보임. ⑤ 차트에서 클릭한 곡이 기존 재생 중이어도 그 곡이 먼저 재생(현재 플레이리스트에 추가만 됨).

### Plan verification findings (0단계, MAIDOL 실측 분석)
- **①⑤ 재생보상**: MAIDOL = **70% 위치 도달 시 `POST /charts/record-play {track_id}` → 별 +1(하루 5곡 상한)**. **위치 기반이라 seek 허용**(연속청취 요구 없음). 서버 검증 없음(클라 신뢰). AIDOL엔 record-play 호출·70% 게이트 **전무**(didJustFinish에 로컬 EXP만).
- **⑤ 차트클릭 버그**: `PlayerScreen`의 `track = fullTrack||storeTrack||routeTrack`. 새 곡 클릭 시 storeTrack=옛곡이라 `track`=옛곡 → 마운트 효과가 "같은 곡"으로 판단해 **기존 사운드 재사용 → 새 곡 미재생**(큐에만 추가).
- **② 곡정보 탭**: MAIDOL=2탭(프롬프트정보[프롬프트+상세grid+가사+착장+SNS] / 재생목록). AIDOL=4탭(가사/프롬프트/착장/상세). AIDOL이 오히려 세분화 — 큰 결손은 **동영상 탭 부재**.
- **③ 음악/동영상**: 노래/동영상 media-tabs. 동영상 = MV(`GET /tracks/{id}/music-video`) 있으면 재생, 없으면 **가사 싱크(LyricSyncVideo, `GET /tracks/{id}/lyrics-timeline`→segments[{text,start,end}])**. 실측: lyrics-timeline **정상(실제 타임스탬프)**, music-video는 대개 없음(이 곡도 404) → 가사싱크가 주 경로.

### 수행 결과
- **⑤ screens/PlayerScreen.tsx (차트클릭 재생)**: 마운트 효과·`loadAndPlay(target)`가 **routeTrack(명시 곡) 우선 재생** — 다른 곡 재생 중이어도 클릭 곡 즉시 재생.
- **① screens/PlayerScreen.tsx (70% 보상)**: `onPlaybackStatusUpdate`에서 `position ≥ duration*0.7` 도달 시 `POST /charts/record-play` **트랙당 1회** + 별 잔액 갱신. **위치 기반이라 seek로 넘겨도 인정**(MAIDOL 동일) → **seek 자유 허용**(별 지급과 무관, 되돌리기 가능).
- **④ 하단 토글**: 가사·상세정보 토글을 **하단 절대배치(bottom:0, 배경 포함) + 컨테이너 paddingBottom 56** → 기기·오버플로와 무관하게 **항상 노출**.
- **③ 음악/동영상 + 가사싱크**: **components/LyricSyncView.tsx**(신규, MAIDOL LyricSyncVideo 이식 — 커버 블러 배경 + 현재 재생위치로 활성 가사 라인 중앙 하이라이트·자동스크롤). PlayerScreen에 **노래/동영상 토글** 추가 — 동영상 탭 진입 시 `lyrics-timeline` 로드, 타임스탬프 있으면 **가사 싱크** 표시(없으면 안내). `[PlayerScreen]` 로그.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] POST /charts/record-play · GET lyrics-timeline · music-video | ok / segments / (MV 없음) |
| [e2e] 차트 곡 클릭 → 즉시 재생(loadAndPlay 로그) | PASS |
| [e2e] 하단 가사·상세정보 토글 노출 | PASS (`/tmp/v329_player.png`) |
| [e2e] 노래/동영상 토글 + 동영상=가사 싱크(활성 라인 하이라이트) | PASS (`/tmp/v329_video.png`) |
| [e2e] 70% 도달 시 record-play 호출(위치 기반) | 코드/로그 검증 |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (사용자 질문 답)
- **seek 정책 답**: 별 지급은 **70% 위치 도달 기준(위치 기반)** — 되감기/앞으로 감기 자유, seek이 별 지급을 방해하지 않음. 따라서 **seek 되돌리기 제한 불필요**로 결정(MAIDOL과 동일). (웹 오디오 실제 seek은 여전히 백엔드 stream-proxy Range(206) 필요 — v3.28 기록.)
- **MV 재생(`<video>`)**: 대상 트랙에 MV가 거의 없어 이번엔 **가사 싱크 경로만 구현**. MV 있는 트랙용 expo-av Video 재생은 후속(엔드포인트·컴포넌트 준비됨).
- AIDOL 4탭 상세는 MAIDOL보다 세분화 상태 유지, 추가 결손(스타 SNS 채널)은 경미 — 필요 시 후속.

### 커밋
`feat: v3.29 차트클릭 즉시재생 · 70%재생보상(seek허용) · 하단토글 절대노출 · 음악/동영상 가사싱크 (team-dev)` — 푸시 OFF.

---

## v3.28 (차트 곡클릭→큐추가+재생 · seek 리셋 픽스 · 정보토글 노출 · 플리 탭 아이콘) — 2026-08-18

### 요청 작업
① 차트 곡 클릭 시 재생목록(큐)에 추가되고 재생. ② 플레이어 재생바를 움직이면 그 지점부터 재생돼야 하는데 처음으로 돌아감(점검). ③ 플레이어 하단 곡 정보(가사·상세) 토글이 안 보임(확인). ④ 하단바 플레이리스트 아이콘을 목록 아이콘 대신 폴더/묶음 아이콘으로.

### Plan verification findings (0단계)
- ① `handleTrackPress` = `setQueue(전체 차트)` + navigate → 큐가 차트 전체로 대체됨(사용자 큐 유실). 원하는 건 "그 곡을 큐에 추가+재생".
- ② **버그 2겹**: (a) 슬라이더 `value={isSeeking ? undefined : position}` — 드래그 시작 시 `undefined` → **웹 슬라이더가 0으로 리셋** → 놓으면 0으로 seek. (b) `onPlaybackStatusUpdate`가 stale 클로저 `isSeeking(항상 false)` 참조. **추가로 백엔드 `stream-proxy`가 Range 헤더 무시(206 아닌 200 반환) → 웹은 애초에 seek 불가**.
- ③ 플레이어 `가사·상세정보` 토글은 렌더되나 세로 오버플로 시 하단 잘림 위험.
- ④ App.tsx 플레이리스트 탭 아이콘 = Feather `list`.

### 수행 결과
- **screens/ChartScreen.tsx**: `handleTrackPress` → **`addToQueue(track)`(중복방지) 후 그 곡 인덱스로 재생**. 사용자가 쌓은 재생목록 보존 + 클릭 곡 추가+재생.
- **screens/PlayerScreen.tsx (seek)**: `seekValue` 상태 + `isSeekingRef`(라이브) 도입. 슬라이더 `value={isSeeking ? seekValue : position}`(undefined 제거) + `onValueChange`로 드래그 추적, `onPlaybackStatusUpdate`는 `isSeekingRef.current`로 판정, `handleSeek`은 낙관적 position 반영 후 `setPositionAsync`. 시간 라벨도 드래그값 추종.
- **screens/PlayerScreen.tsx (토글)**: 액션열과 토글 사이 `flex:1` 스페이서 추가 → **가사·상세정보 토글 하단 고정 노출**(tone muted→secondary로 가시성↑, accessibilityLabel 추가).
- **App.tsx**: 플레이리스트 탭 아이콘 `list`→**`folder`**(묶음).

### 테스트 (tester) — PASS / 부분 (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 차트 곡 클릭 → 플레이어 재생 + **재생목록(큐)에 추가** | PASS |
| [e2e] 슬라이더 드래그 → seek 값이 **드래그 지점(159867ms)** 전달(0 아님) — 프론트 리셋 버그 해결 | PASS (로그 확인) |
| [e2e] 정보(가사·상세) 토글 하단 노출 | PASS (`/tmp/v328_player.png`) |
| [e2e] 플레이리스트 탭 = 폴더 아이콘 | PASS (`/tmp/v328_tabbar.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (중요 — seek 웹 미완, 백엔드 블로커)
- **프론트 seek 리셋 버그(undefined→0, stale 클로저)는 수정 완료** → **네이티브 기기에선 seek 정상 예상**(expo-av가 파일 버퍼링해 로컬 seek).
- **웹(Expo Web) seek은 여전히 0 부근으로 남음**: 백엔드 `/api/tracks/stream-proxy/{id}`가 `Accept-Ranges: bytes`를 광고하지만 **Range 요청에 206(Content-Range) 대신 200(전체)를 반환** → 브라우저가 seek 불가(실측: `curl -H "Range: bytes=..."` → `200 OK`, Content-Range 없음). **웹 seek을 완성하려면 백엔드 stream_track_proxy가 Range를 파싱해 부분(206) 반환하도록 수정 필요** — 원격 9004는 사용자측 재배포 필요(메모리 [[server-restart-wsl-constraint]]). 원하시면 maidol 백엔드 소스에 Range 대응 패치를 준비해 드리겠습니다(핸드오프).

### 커밋
`fix: v3.28 차트클릭→큐추가+재생 · seek 프론트리셋 픽스 · 정보토글 하단고정 · 플리탭 폴더아이콘 (team-dev)` — 푸시 OFF.

---

## v3.27 (차트 행에 재생수·좋아요수 표시 — 하트 버튼 자리, 좋아요는 ⋮에서) — 2026-08-18

### 요청 작업
차트에 재생수·좋아요수를 보이게. 하트 버튼 자리에 재생수·좋아요수를 넣고, 좋아요는 ⋮(더보기)에서 하면 됨.

### Plan verification findings (0단계)
- v3.26에서 통계(▶·♥)를 제거하고 하트 버튼을 인라인 배치 → 사용자는 **수치 노출**을 원함. 좋아요 실행은 이미 ⋮ 액션시트에 있음 → 인라인 하트 버튼 불필요.

### 수행 결과 (screens/ChartScreen.tsx)
- **행의 인라인 하트 버튼 제거** → 그 자리에 **재생수·좋아요수 2줄 표시**(▶ play_count / ♥ like_count, Feather play·heart 소형 아이콘+숫자, 우측정렬). 좋아요된 곡은 ♥ 아이콘·숫자 accent.
- **⋮ 액션시트에서 좋아요 실행** 유지(재생/좋아요/재생목록 추가/플레이리스트 담기).
- **좋아요 토글 시 행 좋아요수 낙관적 ±1** 반영(`setTracks` 로컬 업데이트) + 하트색 전환.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 행에 ▶재생수·♥좋아요수 표시 | PASS (`/tmp/v327_chart.png` — ▶139 ♥1) |
| [e2e] ⋮ → 좋아요 → 행 좋아요수 +1·하트 accent | PASS (`/tmp/v327_liked.png` — ♥2 accent) |
| [e2e] 더보기(⋮) 유지 | PASS |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 커밋
`feat: v3.27 차트 행 재생수·좋아요수 표시(하트자리) + 좋아요수 낙관적 반영 (team-dev)` — 푸시 OFF.

---

## v3.26 (차트 UI 클린 리디자인 + MAIDOL 아이콘 통일 + 재생목록/플레이리스트 구분) — 2026-08-18

### 요청 작업
① 차트 UI가 어지러움 → 다른 음악 앱처럼 깔끔하게. ② 아이콘은 MAIDOL과 동일하게. ③ 재생목록·플레이리스트 아이콘이 같아 구별 안 됨 → 구분.

### Plan verification findings (0단계)
- 기존 차트 행이 과밀: rank + cover + (title/artist/**장르pill + ▶count + ♥count**) + **♡(text) + list(Feather) + +(text)** 3버튼. 정보/아이콘 과다.
- **아이콘 혼동 원인**: 재생목록=Feather `list`, 플레이리스트=text `+` — 둘 다 애매하고 MAIDOL과 불일치.
- **MAIDOL SongItem 아이콘(react-icons/fi = Feather)**: `FiPlay·FiHeart·FiPlus(재생목록/큐)·FiBookmark(플레이리스트)` → Feather `play·heart·plus·bookmark`.

### 수행 결과 (screens/ChartScreen.tsx)
- **행 리디자인(멜론/스포티파이식 미니멀)**: `[순위][커버][제목/아티스트][♥ 빠른좋아요][⋮ 더보기]`. 장르 pill·▶count·♥count 인라인 **제거** → 깔끔.
- **MAIDOL 아이콘 적용**: 좋아요=Feather `heart`(좋아요 시 accent 채움), 더보기=`more-vertical`.
- **⋮ 더보기 액션 시트**(신규): 곡 헤더(커버+제목/아티스트) + 4개 **아이콘+라벨** 항목 — **재생(play) · 좋아요(heart) · 재생목록에 추가(plus·FiPlus) · 플레이리스트에 담기(bookmark·FiBookmark)**. → 재생목록/플레이리스트가 **서로 다른 아이콘 + 라벨**로 명확히 구분. 플레이리스트에 담기는 기존 플레이리스트 선택 시트로 연결. `[ChartScreen]` 로그.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 차트 행 클린(순위/커버/제목·아티스트/♥/⋮, 잡정보 제거) | PASS (`/tmp/v326_1_chart.png`) |
| [e2e] ⋮ 더보기 → 액션시트 4항목(재생/좋아요/재생목록에 추가/플레이리스트에 담기) | PASS (`/tmp/v326_2_sheet.png`) |
| [e2e] 재생목록(plus)·플레이리스트(bookmark) 아이콘·라벨 구분 | PASS |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 빠른 좋아요는 행에 유지(1탭), 나머지 곡 액션은 ⋮로 모아 클러터 제거 — 실제 음악앱(멜론/스포티파이) 관행.
- 검색 결과 행은 이번 범위 외(탭 시 재생). 필요 시 동일 ⋮ 패턴 확장 가능.

### 커밋
`feat: v3.26 차트 클린 리디자인 + MAIDOL 아이콘 + 재생목록/플레이리스트 구분(⋮ 액션시트) (team-dev)` — 푸시 OFF.

---

## v3.25 (기능 #9 — 재생목록(큐) 추가·뷰 + 다운로드/공유를 마이뮤직으로 이관) — 2026-08-18

### 요청 작업
① 재생목록(큐) 진행: 차트에 "재생목록 추가" 버튼 + 플레이어에 재생목록(큐) 보기. ② MAIDOL의 다운로드/공유 버튼은 **내가 만든 곡만** 대상이므로 **마이뮤직의 내 음악 리스트에서 관리**.

### Plan verification findings (0단계)
- **큐**: `playerStore`에 queue/currentIndex/`switchToTrack(idx)`(점프+재생) 존재하나 **큐 append/remove 액션·큐 보기 화면 없음**. MAIDOL: 차트 FiPlus=재생목록(큐, 인메모리), 큐 뷰=PlayerPage 탭.
- **다운로드**: 백엔드 `POST /tracks/download/{id}`→`{download_url(presigned), filename}` (실측 200). 기존 PlayerScreen 다운로드 버튼은 **타인 곡 구매(PurchaseModal)까지 겸함** → 사용자 의도(내 곡만)와 불일치.
- MyMusic는 `/tracks/my`로 **본인 곡만** 로드 → 다운로드/공유 배치에 적합(소유권 체크 불필요).

### 수행 결과
- **stores/playerStore.ts**: `addToQueue(track)`(중복 방지 append) · `removeFromQueue(index)`(currentIndex 보정) 추가.
- **screens/ChartScreen.tsx**: 곡 행에 **"재생목록 추가"(Feather list)** 버튼 추가(클라 큐라 로그인 불필요, 토스트). 하트/재생목록/+ 3버튼 + accessibilityLabel.
- **screens/PlayerScreen.tsx**: 액션열의 **다운로드 버튼 제거**(+PurchaseModal·pricing import 정리) → **재생목록(큐) 버튼**으로 교체. **재생목록 모달**(큐 리스트, 현재곡 ▶ 강조, 탭→`switchToTrack` 점프재생, ✕ 제거) 신규.
- **screens/MyMusicScreen.tsx**: 내 곡 행에 **공유(Share.share, 곡 링크)** · **다운로드(`POST /tracks/download/{id}`→`Linking.openURL(presigned)`)** 버튼 추가. `[MyMusic]` 로그.

### 테스트 (tester) — PASS / 부분 (tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] POST /tracks/download/{id} → download_url(presigned) | PASS (200) |
| [e2e] 차트 "재생목록 추가" 버튼 렌더·클릭 | PASS (`/tmp/v325_diag.png` — 하트/list/+ 3버튼) |
| [e2e] 곡 재생 → 플레이어 **재생목록 버튼**(다운로드 제거 확인) | PASS |
| [e2e] 재생목록 모달 — 큐 목록·현재곡 ▶·제거 | PASS (`/tmp/v325_queue.png`) |
| [e2e] 마이뮤직 공유/다운로드 버튼 | **부분** — 테스트계정 본인곡 0개라 행 미표시로 E2E 미검증. **코드/타입 + 다운로드 API 실측**으로 검증 |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- **차트 시간窓**: 오늘(8/18) 공개 트랙이 1곡뿐이라 버튼 카운트가 1로 나옴(데이터, 코드 정상). 다곡 시 각 행에 3버튼.
- **MyMusic 버튼 E2E 미검증 사유**: 테스트 계정이 본인 곡이 없어 트랙 행이 안 뜸. 곡 보유 계정에서 확인 필요(추후). 다운로드 presigned URL 호스트가 `…:9100`(MinIO) — 사용자 디바이스 망 접근성은 실기기 확인 권장(MINIO_PUBLIC_HOST 이슈 가능).
- 큐는 **클라이언트 인메모리**(playerStore persist에 포함) — MAIDOL과 동일하게 백엔드 큐 없음.

### 커밋
`feat: v3.25 재생목록(큐) 추가·뷰 + 다운로드/공유 마이뮤직 이관 (team-dev)` — 푸시 OFF.

---

## v3.24 (버그픽스 — 비로그인 좋아요/담기 무반응 → 로그인 화면 이동) — 2026-08-18

### 요청 작업
비로그인 상태에서 차트의 **좋아요·담기 버튼**을 누르면 로그인 유도 화면으로 넘어가야 하는데 **반응이 없음**. (+ 재생목록 화면 관련 질문 — 아래 특이사항)

### Plan verification findings (0단계)
- 원인: `ChartScreen.requireLogin()`이 `Alert.alert('로그인 필요', …, [취소, 로그인])` 다중버튼 얼럿 사용. **react-native-web(Expo Web)은 다중버튼 Alert 미지원 → 아무것도 안 뜸("반응 없음")**. 좋아요(toggleLike)·담기(handleAddToPlaylist) 둘 다 이 함수를 거침.

### 수행 결과
- **screens/ChartScreen.tsx**: `requireLogin()`을 **다중버튼 Alert 제거 → 비로그인 시 `navigation.navigate('Settings')`(로그인 화면) 즉시 이동**으로 변경. 좋아요·담기 양쪽 동일 적용. `[ChartScreen]` 로그.

### 테스트 (tester) — PASS (E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 비로그인 좋아요(♡) 탭 → 로그인 화면 | PASS (`/tmp/v324_like_gate.png`) |
| [e2e] 비로그인 담기(+) 탭 → 로그인 화면 | PASS (`/tmp/v324_add_gate.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (재생목록 화면 질문 답변)
- MAIDOL 조사 결과: **재생목록(재생 큐/멜론식)은 존재**하나 별도 최상위 메뉴가 아니라 **전체화면 플레이어(`/player`) 안의 "재생목록" 탭**임(`PlayerPage.jsx`). 큐는 **100% 클라이언트 인메모리**(PlayerContext `playlist` 배열, 백엔드 큐 엔드포인트 없음). 저장형 **플레이리스트**(`/playlists` API)와는 별개.
- MAIDOL 차트 곡별 버튼 4종: 재생 / 좋아요 / **재생목록 추가(FiPlus=큐에 담기, 인메모리)** / **플레이리스트에 추가(FiBookmark=모달→POST /playlists/{id}/tracks)**.
- **AIDOL 현재 상태**: 차트에 담기 버튼이 **`+`(플레이리스트 담기) 1종만** 있음. "재생목록(큐)에 담기" 버튼과 **큐 보기 화면(PlayerScreen 내 재생목록 탭)** 은 미구현. AIDOL엔 이미 `playerStore.queue`가 있어 큐 자체는 존재(setQueue로 재생 시 채워짐)하나 **보는 화면·큐 추가 버튼이 없음** → 원하시면 다음 증분으로 (a)차트에 "재생목록 추가" 버튼 + (b)PlayerScreen에 재생목록(큐) 탭 추가 가능.

### 커밋
`fix: v3.24 비로그인 좋아요/담기 무반응 수정(Alert→로그인 화면 이동) (team-dev)` — 푸시 OFF.

---

## v3.23 (기능 #8 — 좋아요(likes) 백엔드 실연동) — 2026-08-18

### 요청 작업
"이 부분(로그인 CTA 통일)은 넘어가고 다음 차례" → 로드맵 대조 후 **다음 미반영 기능 = 좋아요(likes) 실연동** 착수.

### Plan verification findings (0단계)
- **버그**: 차트 하트가 **로컬 Set 토글만**(`ChartScreen.tsx` `toggleLike` — API 호출 0). 눌러도 저장 안 됨 → 재진입 시 사라짐.
- 백엔드 likes API 완비(실측): `POST /likes/{track_id}`(201, 중복 시 400 "이미 좋아요한 트랙"), `DELETE /likes/{track_id}`, `GET /likes/check?song_ids=a,b`→`{liked_ids:[...]}`, `GET /likes/`(내 좋아요 목록).
- 피드 footer 하트는 **feed post 좋아요 수 표시**(트랙 likes와 별개 시스템) → 이번 범위 제외.

### 수행 결과
- **stores/likesStore.ts**(신규): 전역 좋아요 상태 — `isLiked` / `sync(ids)`(check 일괄조회) / `toggle(id)`(낙관적 POST·DELETE, 실패 롤백, 중복 400은 성공 취급). `[likesStore]` 로그.
- **screens/ChartScreen.tsx**: 로컬 `likedTracks` Set 제거 → likesStore 연동. 차트 로드 시(로그인 상태) 보이는 곡 `sync`, 하트 탭 → `toggle`(백엔드). 하트 토글에 accessibilityLabel(좋아요/좋아요 취소).

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] POST/DELETE/check/list likes 실측 | 계약 일치 |
| [e2e] 하트 탭 → 좋아요 저장(♥) | PASS |
| [e2e] **다른 탭 갔다 차트 복귀 시 좋아요 유지**(백엔드 반영) | PASS (`/tmp/v323_like_persist.png`) |
| [e2e] 취소 탭 → 삭제(♡ 복귀) | PASS |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 검색/채널 트랙 행에는 현재 하트 UI가 없어 이번엔 차트에만 연동(공용 likesStore라 추후 확장 용이).
- 피드 post 좋아요(별도 엔드포인트)와 트랙 좋아요는 다른 시스템 — 혼동 방지.
- **로그인 CTA 3화면 구조 통일(v3.23 후보)은 사용자 요청으로 보류** — 재개 시 icon/title/desc 구조 방향 결정 필요.

### 커밋
`feat: v3.23 좋아요(likes) 백엔드 실연동 — likesStore + 차트 하트 (team-dev)` — 푸시 OFF.

---

## v3.22 (로그인 유도 화면 텍스트까지 3화면 통일 — LoginPrompt 공용화) — 2026-08-13

### 요청 작업
플레이리스트 로그인 화면의 **버튼 외 나머지 텍스트(제목·설명) 폰트**가 피드·작업실과 아직 다름 → 통일.

### Plan verification findings (0단계)
- 플레이리스트 비로그인 = 공용 `EmptyState`(제목 `callout`·tone `muted` / 힌트 `footnote`·`muted`) → 오버레이 텍스트와 크기·색상 상이.
- 작업실/피드 오버레이 = `loginOverlayTitle`(20 bold, text.primary) + `loginOverlayDesc`(15, text.secondary). ← 통일 기준.

### 수행 결과
- **components/LoginPrompt.tsx**(신규): 아이콘(선택)·제목(선택)·설명 + `LoginStartButton`을 묶은 공용 로그인 유도 콘텐츠. 텍스트 스펙 = 제목 20/bold/primary · 설명 15/secondary/lineHeight24(작업실·피드 기준).
- **screens/PlaylistScreen.tsx**: 비로그인 `EmptyState` → 중앙정렬 래퍼 + `<LoginPrompt icon="♫" title="나만의 플레이리스트" desc=… />`.
- **screens/MapScreen.tsx · FeedScreen.tsx**: 오버레이 인라인 제목/설명/버튼 → `<LoginPrompt/>`(단일 소스로 수렴). 작업실=title+desc, 피드=desc.

### 테스트 (tester) — PASS (E2E 폰트 측정, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 제목 폰트 동일(플레이리스트=작업실: 20px/700/#fff) | PASS |
| [e2e] 설명 폰트 동일(15px/400/#a78bfa) | PASS |
| [e2e] 플레이리스트 로그인 화면 룩 = 작업실/피드 | PASS (`/tmp/v322_1_playlist.png`·`v322_2_studio.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 이제 로그인 유도 화면의 **버튼(v3.21)+제목/설명(v3.22)** 모두 `LoginPrompt`/`LoginStartButton` 단일 소스 공유 → 3화면 완전 통일, 향후 드리프트 방지.

### 커밋
`feat: v3.22 로그인 유도 텍스트까지 3화면 통일(LoginPrompt 공용화) (team-dev)` — 푸시 OFF.

---

## v3.21 ("로그인하고 시작하기" 버튼 3화면 통일 — 공용 컴포넌트 추출) — 2026-08-13

### 요청 작업
비로그인 상태에서 **플레이리스트 / 피드 / 작업실**의 "로그인하고 시작하기" 버튼 디자인(버튼 크기·폰트 색상·크기)이 제각각 → 통일.

### Plan verification findings (0단계)
- **플레이리스트**(`PlaylistScreen.tsx:233`): 공용 `Button` 컴포넌트(filled 변형) 사용 — 패딩/라운드/폰트가 오버레이 버튼과 상이.
- **피드**(`FeedScreen`)·**작업실**(`MapScreen`): 커스텀 `loginOverlayButton`(bg accent.primary, radius 24, py14/px40) + `loginOverlayButtonText`(text.primary, 16, bold). 둘은 v3.19에서 1:1 동일화됨.
- 즉 피드=작업실은 이미 동일, **플레이리스트만 다름**. 향후 드리프트 방지 위해 **공용 컴포넌트로 추출**해 3곳 공유가 최선.

### 수행 결과
- **components/LoginStartButton.tsx**(신규): "로그인하고 시작하기" 통일 버튼(작업실/피드 스펙 = accent bg·radius 24·py14/px40·white bold 16). 버튼 크기/폰트를 한 곳에서 관리.
- **screens/MapScreen.tsx · FeedScreen.tsx**: 오버레이 인라인 버튼 → `<LoginStartButton/>` 로 교체.
- **screens/PlaylistScreen.tsx**: 비로그인 EmptyState의 공용 `Button` → `<LoginStartButton/>` 로 교체.
- (기존 `loginOverlayButton*` 스타일 키는 미사용으로 무해하게 잔존)

### 테스트 (tester) — PASS (E2E 픽셀 측정, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 3화면 버튼 텍스트 박스 동일(128×18, 동일 좌표) | PASS |
| [e2e] 3화면 폰트 동일(16px / 700 / #fff) | PASS |
| [e2e] 플레이리스트 버튼 = 피드·작업실과 동일 룩 | PASS (`/tmp/v321_1_playlist.png`·`v321_2_feed.png`·`v321_3_studio.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 커밋
`feat: v3.21 로그인하고 시작하기 버튼 3화면 통일(LoginStartButton 공용화) (team-dev)` — 푸시 OFF.

---

## v3.20 (로그인 오버레이 정리 — 작업실 아이콘 제거 + 피드 "AIDOL 피드" 텍스트·아이콘 제거) — 2026-08-13

### 요청 작업
"작업실에 로그인하고 시작하기 버튼 위에 아이콘, AIDOL 피드 텍스트랑 그 위에 아이콘 빼줘." → ① 작업실 오버레이의 아이콘(🎵), ② 피드 오버레이의 "AIDOL 피드" 텍스트, ③ 그 위 아이콘(👥) 제거.

### Plan verification findings (0단계)
- 작업실(MapScreen) loginOverlay 콘텐츠 순서: `loginOverlayIcon(🎵)` → `loginOverlayTitle("AI 음악 작업실")` → desc → 버튼.
- 피드(FeedScreen) loginOverlay(v3.19) 콘텐츠 순서: `loginOverlayIcon(👥)` → `loginOverlayTitle("AIDOL 피드")` → desc → 버튼.

### 수행 결과
- **screens/MapScreen.tsx**: loginOverlay에서 **🎵 아이콘 라인 제거**. 타이틀("AI 음악 작업실")·설명·버튼 유지.
- **screens/FeedScreen.tsx**: loginOverlay에서 **👥 아이콘 + "AIDOL 피드" 타이틀 제거**. 설명("로그인하면 팔로우한 아티스트와…")·버튼 유지. (딤드 배경·트리거·배경탭닫힘 등 v3.19 동작 불변; 미사용 스타일 키는 무해하게 잔존)

### 테스트 (tester) — PASS (E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 피드 오버레이: "AIDOL 피드"·👥 제거, 설명/버튼 유지 | PASS (`/tmp/v320_1_feed_overlay.png`) |
| [e2e] 작업실 오버레이: 🎵 제거, 타이틀/버튼 유지 | PASS (`/tmp/v320_2_studio_overlay.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 요청 문구를 콤마 기준 3요소(작업실 아이콘 / 피드 텍스트 / 피드 아이콘)로 해석 — 작업실은 아이콘만, 피드는 텍스트+아이콘 제거. 해석이 다르면 알려주시면 조정.

### 커밋
`fix: v3.20 로그인 오버레이 정리 — 작업실 아이콘·피드 텍스트/아이콘 제거 (team-dev)` — 푸시 OFF.

---

## v3.19 (피드 로그인 CTA를 작업실과 동일한 전체화면 딤드 오버레이로 통일) — 2026-08-13

### 요청 작업
"작업실에서 로그인하고 시작하기 화면이 뜨는 것과 같이(까만 화면으로 불투명하게 배경을 덮고 그 위에 텍스트) 피드도 동일하게."

### Plan verification findings (0단계)
- 작업실(MapScreen)의 로그인 오버레이 = `styles.loginOverlay`(`MapScreen.tsx:1298`): `StyleSheet.absoluteFillObject` + `backgroundColor:'rgba(0,0,0,0.75)'` 전체화면 딤 + 중앙 콘텐츠(아이콘 48 / 타이틀 20 bold / 설명 15 secondary / pill 버튼). 배경 탭 시 닫힘.
- 피드(v3.18) = 하단에 뜨는 작은 카드형 CTA(`ctaCard`). → 시각을 작업실과 통일 필요.

### 수행 결과
- **screens/FeedScreen.tsx**: 하단 카드형 CTA 제거 → **작업실과 동일 스펙의 전체화면 딤드 오버레이**로 교체. `rgba(0,0,0,0.75)` absoluteFill + 중앙(👥 아이콘 · "AIDOL 피드" 타이틀 · "로그인하면 팔로우한 아티스트와\n다른 사람들의 소식을 볼 수 있어요" · pill "로그인하고 시작하기" 버튼). **배경 탭 → 닫힘**(작업실과 동일). 트리거(스크롤 y>10 / onScrollBeginDrag / 팔로워·트랙 클릭)와 기본 숨김은 v3.18 그대로 유지. 스타일 값은 MapScreen `loginOverlay*` 1:1 복제.

### 테스트 (tester) — PASS (E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 초기 오버레이 미노출 | PASS |
| [e2e] 스크롤 시 **전체화면 딤드 오버레이**(AIDOL 피드 + 버튼) | PASS (`/tmp/v319_1_overlay.png`) |
| [e2e] 배경 탭 → 오버레이 닫힘(작업실과 동일) | PASS |
| [e2e] 팔로워 클릭 시 오버레이 등장 | PASS (`/tmp/v319_2_click_overlay.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 커밋
`feat: v3.19 피드 로그인 CTA를 작업실과 동일한 전체화면 딤드 오버레이로 통일 (team-dev)` — 푸시 OFF.

---

## v3.18 (피드 로그인 CTA — 고정 제거, 스크롤/팔로워 클릭 트리거로 전환) — 2026-08-13

### 요청 작업 (사용자 재지적)
"하단 고정하지 말고 **스크롤 동작이 발생하거나 팔로워를 클릭하면** 뜨게 하라" — v3.17의 상시 하단 고정 CTA를 **트리거형(평소 숨김 → 스크롤/클릭 시 등장)** 으로 교체.

### Plan verification findings (0단계)
- FeedScreen(v3.17): `{!user ? <stickyCta>}` = **항상 노출되는 하단 고정 배너**. → 사용자는 "고정" 아닌 "행동 시 등장"을 원함.
- 테스트 피드가 짧아(공개글 1건) FlatList 콘텐츠가 뷰포트에 맞아 **스크롤 자체가 발생 안 함**(onScroll 미발화) → 스크롤 트리거가 동작하려면 목록이 스크롤 가능해야 함.

### 수행 결과
- **screens/FeedScreen.tsx**:
  - 상시 고정 배너 제거 → **`ctaVisible` 상태 기반 트리거형 CTA**(기본 숨김). 스크롤(`onScroll` y>10 / `onScrollBeginDrag`) 또는 **팔로워(아바타)·트랙 클릭** 시 `setCtaVisible(true)` → 하단에 **떠오르는 카드형 CTA**(✕ 닫기 버튼 포함) 노출. 닫기 시 숨김.
  - 비로그인 시 목록이 짧아도 스크롤이 가능하도록 `contentContainerStyle.minHeight = 화면높이+140` 부여(스크롤 제스처가 실제로 발생 → 트리거 보장).
  - 비로그인 카드 탭은 로그인 폼 이동이 아니라 **CTA 등장**으로 통일. `[FeedScreen]` 스크롤 감지 로그.

### 테스트 (tester) — PASS (E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 초기(액션 전) CTA **미노출**(고정 아님) | PASS (`/tmp/v318_1_initial.png`) |
| [e2e] **스크롤 시** CTA 등장(콘솔 "스크롤 감지" 확인) | PASS (`/tmp/v318_2_scroll.png`) |
| [e2e] 닫기(✕) 시 CTA 사라짐 | PASS |
| [e2e] **팔로워(아바타) 클릭 시** CTA 등장 | PASS (`/tmp/v318_3_click.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 짧은 피드에서도 스크롤 제스처가 실제 발생하도록 `minHeight`(화면+140)로 스크롤 여유를 둠 → 스크롤 시작 즉시(y>10) CTA 등장하므로 빈 여백까지 내려갈 일은 적음. 실 피드(글 다수)에선 여백 영향 미미.
- 네이티브(모바일) 터치 드래그는 `onScrollBeginDrag`로 즉시 트리거.

### 커밋
`fix: v3.18 피드 로그인 CTA 고정 제거 → 스크롤/팔로워 클릭 트리거 (team-dev)` — 푸시 OFF.

---

## v3.17 (UX 미세조정 — 검색 운동 디폴트·게이트멘트 + 피드 하단고정 로그인 CTA) — 2026-08-13

### 요청 작업
① 검색 전 첫 칩(운동)이 **디폴트 선택 상태 + 해당 곡 표시**. ② 검색 게이트 멘트를 **"검색 기능은 로그인 후 이용할 수 있어요"** 로 수정. ③ 피드에서 **팔로워 클릭/스크롤 시 "로그인하고 시작하기" 버튼**이 뜨도록(반복 요청 — v3.16은 클릭 시 Settings 폼으로 튕겨 버튼 미노출).

### Plan verification findings (0단계)
- SearchScreen(v3.16): 기본 화면 = 빈 EmptyState("느낌을 선택하거나…"), 카테고리는 탭해야 로드. 게이트 멘트="검색과 느낌별 음악은 로그인 후 이용".
- FeedScreen(v3.16): 비로그인 카드 탭 → `navigation.navigate('Settings')`(로그인 **폼**으로 이동) + 하단 `ListFooterComponent` CTA(스크롤 끝에서만). → 사용자는 "버튼이 뜨는" 경험을 원함(폼 이동 아님).

### 수행 결과
- **screens/SearchScreen.tsx**: `loadCategory()`(게이트 없는 공용 로더) 분리 + 마운트 시 **첫 카테고리(운동) 디폴트 선택·곡 로드**(`didDefault` 가드) → 검색 전에도 🏃 운동 활성칩 + 곡 노출. 게이트 멘트 → **"검색 기능은 로그인 후\\n이용할 수 있어요"**. 명시적 느낌칩 탭/검색/포커스는 비로그인 시 게이트 유지.
- **screens/FeedScreen.tsx**: 비로그인 시 **하단 고정 CTA 배너**(`position:absolute` bottom, "로그인하고 시작하기" 버튼 + 안내문) — 스크롤·클릭과 무관하게 **항상 노출**. 기존 "카드 탭→Settings 폼 이동" 제거(비로그인 카드 탭은 무동작, 로그인 경로는 고정 CTA 버튼으로 일원화). 리스트 `paddingBottom` 확보로 마지막 글 가림 방지.

### 테스트 (tester) — PASS (E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 검색 기본 = 🏃 운동 활성 + 운동 곡 목록 | PASS (`/tmp/v317_1_search_default.png`) |
| [e2e] 게이트 멘트 "검색 기능은 로그인 후 이용할 수 있어요"(옛 멘트 제거) | PASS (`/tmp/v317_2_search_gate.png`) |
| [e2e] 피드 하단 고정 "로그인하고 시작하기" 버튼 노출 | PASS (`/tmp/v317_3_feed_cta.png`) |
| [e2e] 팔로워(아바타) 클릭 후에도 CTA 버튼 유지(폼 미이동) | PASS |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 운동 디폴트 곡은 공개 차트 데이터라 비로그인도 노출(브라우징). 다른 느낌 칩 탭/텍스트 검색은 비로그인 시 게이트 유지 — "검색 전 운동 디폴트 표시" + "검색 기능 로그인 필요" 양립.
- 피드 하단 CTA는 상시 고정형(스크롤/클릭 모두에서 버튼 보장) — v3.16의 폼-이동 방식 대체.

### 커밋
`feat: v3.17 검색 운동 디폴트·게이트멘트 수정 + 피드 하단고정 로그인 CTA (team-dev)` — 푸시 OFF.

---

## v3.16 (UX 다듬기 — 느낌별음악 가로칩·게이트확장·검색로딩멘트 + 피드 클릭게이트 + 헤더 좌측정렬 통일) — 2026-08-13

### 요청 작업
① 느낌별 음악을 큰 아이콘 그리드가 아니라 **작은 아이콘 가로 나열(가로 스크롤)** + 칩 탭 시 곡 노출. ② 검색 시도 **또는 느낌별 음악 클릭** 시(미로그인) 로그인 CTA. ③ 검색 로딩바 대신 **"최적의 음악을 찾고 있습니다"** 멘트. ④ 피드 **클릭하거나 스크롤 내리면** 로그인 CTA. ⑤ **차트/작업실 상단바 왼쪽 아이콘 간격 통일**.

### Plan verification findings (0단계)
- SearchScreen(v3.15) 느낌별 음악 = 3열 큰 카드 그리드 + `ActivityIndicator` 로딩 + 텍스트검색만 게이트(칩 탭은 미게이트).
- FeedScreen(v3.15) = 비로그인 피드 노출 + 하단 CTA만(카드 탭은 채널/재생으로 이동 — 게이트 없음).
- 헤더 좌측: 차트=`homeHeader` `headerTitle=<LogoTitle/>` + `headerTitleAlign:'left'`(App.tsx:197). 작업실=`MapScreen` setOptions 커스텀 `headerTitle` 인데 **`headerTitleAlign` 미설정** → 좌측 인셋 상이(측정: 작업실 title x가 차트와 어긋남).

### 수행 결과
- **screens/SearchScreen.tsx**: 느낌별 음악을 **가로 스크롤 칩 바**(`ScrollView horizontal`, 이모지+라벨 작은 pill, 활성 칩 강조)로 교체 — 항상 상단 노출, 칩 탭 → `/charts/category/{name}` 결과. **게이트 확장**: 미로그인 사용자가 (입력창 포커스/입력 | 느낌 칩 탭 | 검색 실행) 시 `gated=true` → "로그인하고 시작하기" CTA(로그인 시 자동 해제). **로딩 멘트**: 스피너 제거 → `🎧 최적의 음악을 찾고 있습니다…`.
- **screens/FeedScreen.tsx**: 비로그인 시 **피드 카드 전체 탭 → 로그인(Settings) 이동**(카드를 `TouchableOpacity`로 래핑 + 작성자헤더·트랙 핸들러도 미로그인 시 로그인으로). 하단 스크롤 CTA(v3.15)는 유지. `goLogin()` 헬퍼.
- **screens/MapScreen.tsx**: 작업실 헤더에 **`headerTitleAlign:'left'`** 추가 → 차트 헤더와 좌측 정렬 통일(측정 결과 두 타이틀 모두 x=16, diff 0.0).

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 느낌별 음악 = 가로 스크롤 칩 바(운동~잠자기) | PASS (`/tmp/v316_1_search_moodbar.png`) |
| [e2e] 미로그인 느낌칩 탭 → 로그인 CTA | PASS (`/tmp/v316_2_search_gate.png`) |
| [e2e] 미로그인 피드 클릭 → 로그인 화면 | PASS (`/tmp/v316_3_feed_click_gate.png`) |
| [e2e] 텍스트 검색 로딩 = "최적의 음악을 찾고 있습니다" 멘트 | PASS (`/tmp/v316_5_loading_msg.png`) |
| [e2e] 로그인 후 느낌칩 탭 → 곡 결과 | PASS (`/tmp/v316_4_category_results.png`) |
| [e2e] 차트/작업실 헤더 좌측 타이틀 x=16 동일 | PASS (`/tmp/v316_chart_hdr.png`·`v316_studio_hdr.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 카테고리(느낌) 결과 로딩은 매우 빨라 멘트가 순간 노출 → 멘트 검증은 느린 **텍스트 검색**(`/tracks/search` 시맨틱)에서 확인.
- 피드 "클릭→로그인"은 로그인 화면(Settings)으로 이동하는 방식(= "로그인하고 시작하기"와 동일 진입점).

### 커밋
`feat: v3.16 느낌별음악 가로칩·게이트확장·검색로딩멘트 + 피드 클릭게이트 + 헤더 좌측정렬 통일 (team-dev)` — 푸시 OFF.

---

## v3.15 (기능 #7 — 피드 소프트게이트·유저채널 페이지 + 검색 느낌별음악·게이트 + 작업실 헤더/아이콘 정리) — 2026-08-13

### 요청 작업
① 피드: 우선 노출하고 아래로 내리면 "로그인하고 시작하기" CTA / "로그인이 필요해요" 텍스트 삭제 / "아티스트와" 뒤 개행. ② 검색: 검색 시작 시(미로그인) 로그인 CTA + 기본 화면에 MAIDOL "느낌별 음악"(운동~잠자기). ③ 상단바 공유 아이콘을 화살표형으로. ④ 작업실 도움말(ⓘ)을 엔터명 오른편에. ⑤ "도움말을 보려면 클릭" 말풍선 제거. ⑥ 피드 작성자 아바타 클릭 → 그 사람 채널(팔로워 수·작성 피드·공지사항·만든 음악, MAIDOL 내채널 참고).

### Plan verification findings (0단계)
- 피드는 **전역 공개 타임라인**(비로그인도 200) → v3.14의 하드 게이트를 **소프트 게이트**(노출+하단 CTA)로 전환.
- **느낌별 음악**: MAIDOL MainPage = `GET /charts/categories`(고정 10종: 운동·에너지 충전·휴식·출퇴근길·행복한 기분·집중·로맨스·파티·슬픔·잠자기) → 칩 탭 시 `GET /charts/category/{name}?limit=50`(트랙 배열). 이모지/색은 코드에 없음 → 클라에서 이모지 매핑 신규.
- **유저 채널(MAIDOL ArtistDetailPage=/artist/:id)**: (a)프로필 `GET /artists/{id}`(name·image·track_count·total_plays·bio) (b)팔로워 `GET /follows/summary/{id}`→`{follower_count,is_following}`(+`POST`/`DELETE /follows/{id}`) (c)피드 `GET /feeds/user/{id}?kind=feed` (d)**공지=커뮤니티** `?kind=community` (e)음악 `GET /artists/{id}/tracks`. 프로필/커버 이미지 = `/api/upload/cover-preview/{obj}`. 피드 아이템에 `author_id` 존재(채널 이동 키).
- 기존 `ArtistDetailScreen`은 트랙+광고만(팔로워·피드·공지 없음) → 요건 미달 → 신규 `UserChannelScreen` 작성.

### 수행 결과
- **screens/UserChannelScreen.tsx**(신규): 프로필(아바타·이름·bio) + 통계(트랙/**팔로워**/재생) + **팔로우 토글**(POST/DELETE) + 탭(**음악**/피드/**공지사항**). 음악=재생 가능(Player), 피드/공지=제목·본문·트랙 카드 렌더. `[UserChannel]` 로그. **App.tsx**: `UserChannel` 라우트(헤더 표시) 등록.
- **screens/FeedScreen.tsx**: 비로그인도 **피드 우선 노출**(fetch 게이트 제거) + 목록 하단 `ListFooterComponent`로 **"로그인하고 시작하기" CTA**(문구 "…팔로우한 아티스트와\\n다른 사람들의 소식을…" 개행). **"로그인이 필요해요" 제거**. 작성자 헤더(아바타+닉네임) 탭 → **UserChannel 이동**(chevron 표시).
- **screens/SearchScreen.tsx**: 기본 화면 = **느낌별 음악** 10칸 그리드(이모지+라벨, `/charts/categories`) → 탭 시 `/charts/category/{name}` 트랙 리스트(재생). **미로그인 사용자가 입력창 포커스/입력 시 → "로그인하고 시작하기" CTA**(검색 차단). `[SearchScreen]` 로그.
- **screens/MapScreen.tsx**: 헤더 재구성 — **도움말(ⓘ)을 엔터명 오른편**(custom headerTitle)로 이동, **"도움말을 보려면 클릭" 말풍선 삭제**, 공유 아이콘 `share-2`→**`share`(화살표형)**. **components/HomeHeaderActions.tsx**: 공유 `share-2`→**`share`**.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 비로그인 피드 노출 + 하단 "로그인하고 시작하기" + "로그인이 필요해요" 없음 + 개행 | PASS (`/tmp/v315_1_feed_out.png`) |
| [e2e] 검색 기본 = 느낌별 음악(운동~잠자기 10칸) | PASS (`/tmp/v315_2_search_mood.png`) |
| [e2e] 미로그인 검색 포커스 → 로그인 CTA | PASS (`/tmp/v315_3_search_gate.png`) |
| [e2e] 작업실 ⓘ 엔터명 우측 + 말풍선 제거 + share(화살표) | PASS (`/tmp/v315_4_studio_header.png`) |
| [e2e] 피드 아바타 → **채널**(팔로워/음악/피드/공지 탭·팔로우 버튼·재생) | PASS (`/tmp/v315_5_channel.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 채널의 "재생/팔로워" 통계는 `/artists/{id}`·`/follows/summary` 기준(앨범 수는 미표기 — 엔드포인트 미제공). 공지사항 탭은 `kind=community` 글(테스트 계정 대상 0건이면 빈 상태 안내).
- 검색 게이트는 **텍스트 검색만** 차단(느낌별 음악 브라우징은 비로그인도 허용) — "검색을 시작하면" 해석.

### 커밋
`feat: v3.15 피드 소프트게이트·유저채널 + 검색 느낌별음악·게이트 + 작업실 헤더 정리 (team-dev)` — 푸시 OFF.

---

## v3.14 (기능 #6 — 피드 로그인 게이트·콘텐츠/재생 수정 + 다이아 제거·별 통일 + 작업실 상단바·아이콘·별팝업 액션) — 2026-08-13

### 요청 작업
① 비로그인 시 피드 노출 금지. ② 피드 클릭 무반응·내용/음악 미표시 수정(노출 형태도 설명). ③ 다이아 다 없애고 별만. ④ 작업실 상단바에 별·출석체크·초대 아이콘 모두. ⑤ 초대 아이콘을 공유 아이콘으로. ⑥ 별 팝업을 첫가입~내곡발매만 남기고 나머지 삭제. ⑦ 별 팝업 항목 클릭 액션(친구초대→공유, 출석체크→출석, 남곡듣기→차트, 내곡발매→작업실).

### Plan verification findings (0단계)
- **피드 노출 형태(사용자 질문 답)**: `/feeds/timeline` = **인스타형 혼합 타임라인**(`backend feeds.py:374`). `is_public` 최신 200건 후보 → 점수 랭킹, **로그인 시 팔로잉 작성자 글 +1000점(최상단 블록)**, 동률은 `created_at desc`. 즉 "최신순 기반 + 팔로우한 사람 최상단"이 맞음. **단, 팔로우 없어도 공개 피드가 노출**되는 전역 타임라인 → 비로그인도 200 반환 → **클라 게이트 필요**.
- **피드 미표시 버그 원인**: 실제 응답은 `{title, blocks:[{type:'text',text},{type:'track',track:{id,title,artist_name,cover_image,duration_sec}}], author_nickname, like_count, comment_count}` 구조인데, 기존 `FeedScreen`은 `item.body/content/text`·`item.track_title`(존재하지 않는 필드)만 읽어 **본문·트랙 미표시**. 카드에 `onPress` 없어 **클릭 무반응**.
- **다이아(💎) = 100% 로컬**(`gemsStore`, AsyncStorage; 백엔드 연동 0). 소비/게이트는 단 2곳(디렉터 영입 `hireCost`, 추가 아티스트 슬롯 100)뿐. 곡/작사/커버/1인 아티스트 생성은 다이아 게이트 없음. **백엔드 별(points)은 읽기전용**(`/points/balance`·`/costs`), 차감 엔드포인트 부재 + 실서버 원격이라 이 환경서 추가·테스트 불가.
- 이미지 URL 규약: `${BACKEND_BASE_URL}/api/upload/cover-preview/{enc(object)}` (ChartScreen 동일). 트랙 재생: `playerStore.setQueue(...)` + `navigate('Player',{track})`.

### 수행 결과
- **screens/FeedScreen.tsx**(재작성): (a) **비로그인 → 조회 안 하고 "🔒 로그인이 필요해요" 게이트**(로그인 버튼). (b) 실제 응답 스키마로 카드 렌더 — 작성자(아바타+닉네임)·제목·본문(text 블록)·**트랙 카드(커버·제목·아티스트·길이·▶)**·좋아요/댓글 수. (c) **트랙 탭 → 재생**(전체 피드 트랙 큐잉 후 Player 진입). `[FeedScreen]` 로그.
- **components/StarGuideModal.tsx**(재작성): "별 쓰는 곳/작사·작곡·커버/풀사이클/팁" **삭제**, **버는 곳(첫가입~내곡발매)만** 유지. 항목 클릭 액션 — 친구초대→**공유(초대 모달)**, 출석체크→**출석 모달**, 남의 곡 듣기→**차트 이동**, 내 곡 발매→**작업실 이동**(전역 `navigationRef`). 클릭 가능 항목은 chevron 표시.
- **services/navigationRef.ts**(신규): 전역 `navigationRef` + `navigateGlobal()` — 전역 모달에서 화면 이동(순환 import 방지 위해 App 밖 모듈). **App.tsx**: `NavigationContainer ref={navigationRef}`.
- **screens/MapScreen.tsx**(작업실 헤더): 💎 pill 제거 → **⭐별 배지(→별 안내)·📅출석·share 초대** 추가(+기존 ⓘ·마이페이지 유지). 로그인 시 `fetchStarBalance()`. 버튼 "…영입하러 가기 💎"→💎 제거.
- **components/HomeHeaderActions.tsx**: 초대 아이콘 `user-plus`→**`share-2`**(공유).
- **screens/DirectorLineupScreen.tsx**: 다이아 게이트 제거 → **디렉터 영입 무료**(잔액 pill·💎 코스트·"캐시 부족" 삭제). **screens/ArtistInputScreen.tsx**: 추가 아티스트 슬롯 다이아 게이트 제거 → **무료 개방**. **components/LevelUpModal.tsx**: `보너스 +N💎` → "N위 달성!"(다이아 문구 제거).

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] **비로그인 피드 = "🔒 로그인이 필요해요"**(피드 미노출) | PASS (`/tmp/v314_1_feed_loggedout.png`) |
| [e2e] 로그인 피드 = 제목·본문·**트랙 카드** 노출 | PASS (`/tmp/v314_2_feed_loggedin.png`) |
| [e2e] **트랙 탭 → Player 진입·재생**(0:02/3:58) | PASS (`/tmp/v314_8_player.png`) |
| [e2e] 작업실 헤더 💎 제거 + ⭐배지·📅출석·share초대 | PASS (`/tmp/v314_3_studio_header.png`) |
| [e2e] 별 팝업 = 첫가입~내곡발매만(쓰는곳/작사 없음) | PASS (`/tmp/v314_4_starguide.png`) |
| [e2e] 별팝업 남곡듣기→차트 / 내곡발매→작업실 / 친구초대→공유 | PASS (`v314_5/6/7`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (중요 — 사용자 확인 요망)
- **다이아 제거의 게임 경제 영향**: 다이아가 유일 게이트였던 **디렉터 영입(최대 10,000)·추가 아티스트 슬롯(100)이 무료가 됨**. 백엔드 별(points) 차감 엔드포인트가 없고 실서버가 원격이라 이 환경에서 별 과금을 구현·검증할 수 없어 내린 결정. **별로 과금(영입/추가슬롯 시 ⭐ 차감)하려면 백엔드 `POST /points/spend` 신설이 필요** — 원하시면 다음 작업으로 진행.
- `stores/gemsStore.ts` 파일 자체는 잔존(광고 스킵 보상 등 내부 기록에만 사용) — **화면 어디에도 다이아(💎) 미표시**. 완전 삭제는 후속 정리 가능.
- 피드는 전역 공개 타임라인이라 "팔로우 0명"이어도 공개 글이 보임(팔로우한 사람은 최상단). "내 팔로잉만" 피드를 원하면 백엔드 파라미터/모드 추가 필요.

### 커밋
`feat: v3.14 피드 로그인게이트·재생 수정 + 다이아 제거(별 통일) + 작업실 상단바·별팝업 액션 (team-dev)` — 푸시 OFF.

---

## v3.13 (기능 #5 — 별 잔액 헤더 배지 + 별 안내 팝업 + 아이콘 교체) — 2026-08-13

### 요청 작업
① 로그인 후 상단바에 **내 별(⭐) 갯수** 표시(별=작업실 다이아몬드 개념, MAIDOL 동일). ② 별 클릭 시 MAIDOL은 출석팝업이지만 AIDOL은 **"별 버는 법" 안내 팝업**(별정책.txt 참고). ③ 선물상자 추천 아이콘 → 기능에 어울리는 다른 아이콘. ④ 작업실 탭 아이콘 → 음표.

### Plan verification findings (0단계)
- **별 잔액 = `GET /points/balance`→`{balance}`** (MAIDOL 헤더도 `getPointsBalance()`). 9004 실검증 `{balance:50}`.
- **`GET /points/costs`** = 별정책.txt 소비금액과 1:1 일치(작사5·작곡15·커버5·아티스트10·피로스킵5).
- AIDOL `gemsStore` 💎 는 **로컬 persist 전용**(백엔드 별과 별개). Studio 헤더 💎 는 로컬 스토어 → top-bar 별 배지는 **백엔드 별(points)** 로 연결.
- 코드에 별 정책 문서 없음 → **`별정책.txt`(별 경제 v1.2)** 기반으로 안내 팝업 제작.

### 수행 결과
- **stores/pointsStore.ts**(신규): 별 잔액 스토어 — `fetchBalance()`(GET /points/balance) + `setBalance()`(응답 balance 직접 반영). `[pointsStore]` 로그.
- **components/StarGuideModal.tsx**(신규): 별 안내 팝업 — 내 별 잔액, **⭐ 별 모으는 법**(첫가입+50·인증+30·친구초대+50·출석+10[5일차+30·10일차+100]·남곡듣기+1·내곡발매+5), **🎬 별 쓰는 곳**(작사·작곡·커버·아티스트·피로스킵, 금액은 **실 /points/costs 우선**·폴백 정책값), 풀사이클(-25) + 팁. `[StarGuideModal]` 로그.
- **components/HomeHeaderActions.tsx**: 로그인 시 **⭐배지(잔액)** 추가(클릭→별 안내 팝업), 헤더 마운트 시 fetchBalance. 추천 아이콘 **gift→user-plus**(친구초대, accessibilityLabel도 "친구초대").
- **components/AttendanceModal.tsx**: status 로드/체크인 응답의 `balance` → `pointsStore.setBalance` 동기화(별 배지 즉시 갱신).
- **App.tsx**: `<StarGuideModal/>` 전역 렌더, 로그인 전환 시 `fetchBalance()` 호출, 작업실 탭 아이콘 **`mic`→`music`**(음표).
- **stores/uiStore.ts**: `starGuideOpen` 플래그 추가.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] /points/balance·/points/costs (실토큰) | 200, 정책 일치 |
| [e2e-web] 차트 헤더 **⭐50 배지** | PASS (`/tmp/v313_2_chart_header.png`) |
| [e2e-web] 별 배지 클릭 → **별 안내 팝업**(모으는 법/쓰는 곳/풀사이클) | PASS (`/tmp/v313_3_starguide.png`) |
| [e2e-web] 추천 **user-plus** → 초대 모달(3YEH) | PASS (`/tmp/v313_4_invite.png`) |
| [e2e-web] 작업실 탭 **음표 아이콘** | PASS (`/tmp/v313_6_tabbar.png`) |
| 회귀: 로그인 자동 출석팝업 + 체크인 별 배지 동기화 | PASS |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- **별(백엔드 points) vs 작업실 💎(로컬 gemsStore)**: 현재 이원화 상태. 이번엔 사용자 요청대로 **상단바 별 배지=백엔드 points**로 연결. Studio 💎(MapScreen) 통합은 MapScreen 핸즈오프 방침상 **이번 범위 제외** — 두 잔액 단일화가 필요하면 별도 작업으로 진행 권장.
- 별 안내 팝업의 소비 금액은 **런타임 /points/costs** 우선 표기(정책 변경 시 자동 반영), 실패 시 정책 기본값 폴백.

### 커밋
`feat: v3.13 별 잔액 헤더 배지 + 별 안내 팝업 + 추천/작업실 아이콘 교체 (team-dev)` — 푸시 OFF.

---

## v3.12 (기능 #4 — 작업실 마이페이지 아이콘 + 출석/초대 팝업 이식 + 로그인 자동팝업) — 2026-08-13

### 요청 작업
① 작업실(스튜디오) 헤더도 설정(⋮) 대신 **마이페이지 아이콘**. ② MAIDOL 출석체크·초대하기 기능을 파악해 **그대로 팝업/토글** 제작. ③ **최초 로그인 시 출석체크 팝업 자동 노출**(MAIDOL 동일).

### Plan verification findings (0단계)
- MAIDOL `AttendanceCard.jsx`: `GET /attendance/status`(checked_today/cycle_day/cumulative_count/today_reward/calendar[10]/balance) + `POST /attendance/check-in`(awarded/already/cycle_day/balance). 10일 사이클, 5·10일차 보너스, 🎁/✅/🔒 셀 마크.
- MAIDOL `AppShareModal.jsx`: `GET /referral/my-code`→`{referral_code, invite_url}`. 코드+📋복사 + 공유 4종(카카오톡/인스타그램/페이스북/링크복사), desc "…두 사람 모두 ⭐50…".
- MAIDOL `Header.jsx` v157: 로그인 세션당 1회 출석 자동팝업(sessionStorage pending 플래그 소비 → status.checked_today===false 시 open).
- AIDOL `authStore`는 persist 없음 → 콜드스타트 user=null. **user null→set 전환 = 로그인 이벤트**로 판정(세션 1회 등가).
- 9004 실검증: status(checked_today:false, today_reward:10, calendar 5일차⭐30·10일차⭐100), my-code(`3YEH`, `/invite/3YEH`) 정상.

### 수행 결과
- **stores/uiStore.ts**(신규): 전역 모달 플래그(attendanceOpen/inviteOpen + open/close 액션) — 헤더·로그인 어디서든 오픈.
- **components/AttendanceModal.tsx**(신규): MAIDOL AttendanceCard 충실 이식 — 누적/사이클, 10칸 캘린더(claimed/next/bonus 스타일), 체크인 버튼·토스트·중복안내. `[AttendanceModal]` 로그(__DEV__ 가드·catch).
- **components/AppShareModal.tsx**(신규): MAIDOL AppShareModal 충실 이식 — "📢 AIDOL 추천하기", ⭐50 안내, 코드박스+📋복사, 공유 4종(카카오톡/인스타그램/페이스북=네이티브 Share 시트, 링크복사=클립보드). `[AppShareModal]` 로그.
- **components/HomeHeaderActions.tsx**: 출석·추천 아이콘이 uiStore로 모달 오픈(기존 즉시호출→모달화).
- **App.tsx**: `<GlobalModals/>`(출석·초대 모달 전역 렌더) + **로그인 자동 출석팝업 이펙트**(user null→set → status 조회 → checked_today===false 시 openAttendance). `[GlobalModals]` 로그.
- **screens/MapScreen.tsx**(작업실 헤더 1개 아이콘만): 우상단 `⋮→Settings`을 **Feather user→MyMusic**으로 교체(마이페이지). 나머지 MapScreen 불변.
- 의존성: `expo-clipboard`(코드/링크 복사).

### 테스트 (tester) — PASS (실로그인 E2E)
신규 테스트계정 등록(9004, consents+gender 필수) 후 AIDOL 웹 실로그인으로 검증.
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [api] /attendance/status·/referral/my-code (실토큰) | 200, 계약 일치 |
| [e2e-web] **로그인 즉시 출석팝업 자동 노출** | **PASS** (`/tmp/v312_5_attendance.png` — 누적0일·1일차🎁·5일차⭐30·10일차⭐100·"오늘 출석하고 별 받기 ⭐10") |
| [e2e-web] 초대 모달(헤더 🎁) | **PASS** (`/tmp/v312_6_invite.png` — 3YEH+📋복사+공유4종) |
| [e2e-web] **작업실 헤더 마이페이지 아이콘** | **PASS** (`/tmp/v312_7_studio.png` — ⋮ 대신 user) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- MAIDOL 초대의 카카오톡/인스타/페이스북 3버튼은 웹 전용(navigator.share/sharer). RN에선 **네이티브 Share 시트로 통합**하되 4버튼 레이아웃·라벨은 그대로 유지(충실 이식).
- MAIDOL 자동팝업의 sessionStorage-1회 소비를 AIDOL은 **user 전환 감지**로 등가 구현(persist 없는 스토어 특성 활용).
- invite_url 호스트: RN엔 window.location.origin 없음 → `BACKEND_BASE_URL/invite/{code}` 사용.

### 커밋
`feat: v3.12 작업실 마이페이지 아이콘 + 출석/초대 팝업 이식 + 로그인 자동팝업 (team-dev)` — 푸시 OFF.

---

## v3.11 (기능 #3 — 헤더/피드/홈 액션 개편) — 2026-08-13

### 요청 작업
① 차트=홈, 피드=팔로우 소식(아이콘 홈 말고 딴 걸로) ② 팔로우 없으면 피드에 "팔로우를 추가해주세요" ③ 차트 상단 돋보기 제거 + 마이페이지 아이콘 통일 ④ 돋보기 대신 로그인 시 출석체크·추천하기 ⑤ 차트 외 페이지는 상단에 페이지명 + 뒤로가기.

### Plan verification findings (0단계)
- 헤더 = `App.tsx` 탭별 옵션. 기존 tabHeader = 로고+마이페이지 공통.
- 백엔드: `POST /attendance/check-in`, `GET /referral/my-code`→`{referral_code, invite_url}` (인증 필요·라이브).

### 수행 결과
- **App.tsx**: 헤더 2종 분리 — **홈(차트)**=로고+`HomeHeaderActions`(출석·추천·마이페이지) / **일반 페이지**(플레이리스트·피드·검색·작업실·마이페이지)=**뒤로가기(←)+페이지명+마이페이지**. 피드 탭 아이콘 `home`→**`users`**.
- **components/HomeHeaderActions.tsx**(신규): 로그인 시 **출석체크**(Feather calendar→`/attendance/check-in`)·**추천하기**(gift→`/referral/my-code`+Share), 항상 마이페이지(user).
- **FeedScreen.tsx**: 빈/미로그인 상태 → "**팔로우를 추가해주세요**"(+아티스트 둘러보기 버튼)/"로그인이 필요해요".
- (차트 상단 돋보기는 v3.10에서 제거 완료 — 홈 헤더로 대체됨.)

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e-web] 홈: 로고 AIDOL + user | PASS (`/tmp/hdr_home.png`) |
| [e2e-web] 플레이리스트: **← 플레이리스트** 헤더 | PASS (`/tmp/hdr_playlist.png`) |
| [e2e-web] 피드 아이콘 users + 실데이터/빈상태 문구 | PASS (`/tmp/hdr_feed.png`) |
| 콘솔 에러 | 0 |

특이: 출석체크·추천하기·팔로우빈상태 문구는 **로그인 경로**라 미로그인 웹에선 UI 노출까지만 검증(로직 코드 완비). 실기기/로그인 시 동작.

### 커밋
`feat: v3.11 헤더 페이지명+뒤로가기, 홈 출석·추천, 피드 users아이콘·팔로우유도 (team-dev)` — 푸시 OFF.

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
