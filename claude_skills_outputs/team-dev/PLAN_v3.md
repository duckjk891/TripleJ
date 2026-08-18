# PLAN_v3 — AIDOL 완성 로드맵: MAIDOL 백엔드 기능 전면 반영

> 계보: `PLAN.md`(일지 v1~) → `PLAN_v2.md`(PANN 통합 로드맵) → **`PLAN_v3.md`(본 문서)**
> 팀: **aidol-parity** (team-dev, 신 워크플로우 5인·2단계 게이트·자동커밋)
> 이 파일은 **두 위치에 동일 비치**: `2_housing/PLAN_v3.md` + `claude_skills_outputs/team-dev/PLAN_v3.md`
> 기록일지(누적, 최신 위). 산출물 규칙 경로의 이전 로그(v1~v10 혼재)는 `claude_skills_outputs/team-dev/archive/` 로 분리.

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
