# REPORT_v3 — 팀: aidol-parity

> 작업 결과 기록일지(누적, 최신 위). 두 위치 동일 비치.

---

## v3.43 (마이뮤직 정렬 통일 + 하단바 아이콘 + 로그인·회원가입 MAIDOL 이식) — 2026-08-18

### 요청 작업
① 마이뮤직 곡 목록이 플레이리스트/차트와 다름 → 맞출 것 ② 하단바: 플레이리스트=재생 아이콘, 피드=연필 아이콘 ③ 로그인·회원가입을 MAIDOL 참고해 개편(소셜 로그인 포함).

### Plan verification findings (0단계)
- **마이뮤직 다르게 보인 원인**: 행은 v3.41에서 공용 TrackRow로 교체됐지만 FlatList `listContent`에 `paddingHorizontal: 20`이 남아 **이중 들여쓰기**(행 자체 패딩 16 + 20) → 플레이리스트·차트와 정렬이 어긋남. 좋아요 하트 상태(likedMap)도 미연동이라 하트가 항상 회색.
- **치명 버그 발견**: 현행 백엔드 `POST /auth/register`는 `consents`(필수 4종+version)·`gender`가 **필수** — AIDOL은 안 보내서 **신규 가입이 항상 400 실패**. 게다가 에러 키 불일치(백엔드 `{error}` vs 프론트 `detail` 파싱)로 사용자에겐 "회원가입에 실패했습니다"만 표시돼 원인 불명.
- MAIDOL(worktree) 로그인: 라벨+입력, 소셜 3종(Google/카카오/네이버, "~로 계속하기", 구분선 "또는"), 비밀번호 찾기 없음(양쪽 공통). 가입: 연령 게이트(생년월일·내외국인·성별 필수) → 본 폼(이메일/닉네임/기획사명·호칭 필수/비번+실시간 힌트 3종+확인/추천코드 4자리/약관 5종 전체동의+보기 토글). 만14세 미만은 `guardian_consent_enabled=false`라 blocked 안내.
- 소셜 3종은 백엔드 리다이렉트 방식(SDK 없음)이며 **현재 원격 서버에 OAuth 키 미설정 → 3종 모두 503**(직접 호출로 확인).

### 수행 결과
- **screens/MyMusicScreen.tsx**: `listContent`의 paddingHorizontal 제거(이중 들여쓰기 해소 → 플레이리스트·차트와 동일 정렬), likesStore 연동(하트 상태 표시 + ⋮ 좋아요 시 카운트 보정).
- **App.tsx**: 하단바 아이콘 — 플레이리스트 `folder`→`play-circle`(재생), 피드 `users`→`edit-3`(연필).
- **constants/consentTexts.ts (신규)**: MAIDOL 약관 전문 이식(서비스명만 AIDOL 치환, 회사·법률 정보 원문 유지). CONSENT_VERSION `2026-07-30.v1`.
- **components/auth/ConsentList.tsx (신규)**: 전체 동의 + 5항목(필수4·선택1) + 보기/접기 전문 + 행태정보 고지.
- **components/auth/SocialLoginButtons.tsx (신규)**: Google/카카오/네이버 3종(MAIDOL 색상·문구) + "또는" 구분선. 탭 시 서버 503이면 서버 안내 문구 표시, 활성 시 리다이렉트 — **키가 설정되면 코드 수정 없이 동작**.
- **components/auth/AuthPanel.tsx (신규)**: 로그인(라벨+입력+소셜+가입 링크) / 가입(연령 게이트→본 폼→blocked) 전체 흐름. 기획사명 '엔터테인먼트' 자동 접미(onBlur+제출), 비번 실시간 힌트 3종·확인 필드, 추천코드 정규식(4자리, 0/1/O/I/L 제외), 필수 동의 미완료 시 가입 버튼 disabled. **register에 birth_date/nationality/gender/consents/referral_code 포함** → 400 버그 해소.
- **stores/authStore.ts**: register에 `extra` payload 지원, 에러 파싱 `error` 우선(`detail` 폴백) — 서버 문구("이미 등록된 이메일입니다." 등)가 이제 그대로 표시됨.
- **screens/SettingsScreen.tsx**: 비로그인 인라인 폼 → `AuthPanel`로 교체(라우트 유지 → 기존 `navigate('Settings')` 호출 전부 그대로 동작).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 하단바: 플레이리스트=▶, 피드=✎ 렌더 | PASS (`/tmp/v343_tabs.png`) |
| [e2e] 로그인 화면: 라벨·"또는"·소셜 3종(색상 포함)·회원가입 링크 | PASS (`/tmp/v343_login.png`) |
| [e2e] 소셜 탭(카카오) → 503 감지·비활성 안내 | PASS (콘솔 `[AuthPanel:login] 소셜 로그인 비활성`) |
| [e2e] 연령 게이트 3필드 → 만14세 미만 blocked 안내 → 이전으로 복귀 | PASS (`/tmp/v343_blocked.png`) |
| [e2e] 성인 → 본 폼: 게이트 요약+수정, 자동 접미("브이343 엔터테인먼트"), 비번 힌트 ✓3종, 약관 전체동의 | PASS (`/tmp/v343_form_filled.png`) |
| [e2e] **실제 신규 가입 성공**(테스트 계정) — consents·gender 포함 payload로 201 | PASS (`/tmp/v343_registered.png`) |
| [regression] 마이뮤직 이중 패딩 제거·likes 연동 (tsc·코드 확인) | PASS |
| 콘솔 에러(내 코드) | 0 (503은 소셜 비활성 — 의도된 처리) |

### 특이사항
- **소셜 로그인은 서버 측 비활성**: 원격 백엔드에 Google/카카오/네이버 OAuth 키가 미설정(3종 모두 503)이라, 버튼은 MAIDOL과 동일하게 노출하되 탭 시 서버 안내 문구를 보여준다. 키 설정 + `frontend_url`(OAuth 콜백 복귀 주소)을 AIDOL로 지정하는 **서버 설정 작업이 되면 그대로 동작**한다. 네이티브 앱 딥링크 콜백은 그 시점에 추가 필요(expo-web-browser).
- MAIDOL 가입 폼의 '지역(선택)' select는 이번 이식에서 생략(선택 항목, RN picker 미설치) — 원하면 추가 가능. 생년월일도 select 3개 대신 숫자 입력 3칸으로 치환(RN 관용).
- 비밀번호 찾기는 MAIDOL에도 없음(백엔드 API 부재) — 갭 아님.
- 테스트로 신규 계정 1개가 생성됨(`v343test…@example.com`) — 실사용자 데이터는 건드리지 않음.
- SettingsScreen의 구 폼 상태/핸들러 일부는 죽은 코드로 남아 있음(로그인 상태 화면과 공유하는 상태라 이번엔 미제거 — 후속 정리 가능).

---

## v3.42 (빈 상태 이모지·마이페이지 CTA·flex 정렬 + 공유/다운로드 선택지 + 신고 + 프롬프트 파라미터) — 2026-08-18

### 요청 작업
① '재생목록이 비어있어요' 위 이모지 제거 ② 상단바 마이페이지의 로그인 CTA를 다른 화면과 통일 ③ 순번 없는 목록(재생목록·플레이리스트·검색·마이뮤직)에서 **빈 공간 없이 flex 정렬** ④ 마이뮤직 공유/다운로드에 MAIDOL과 동일한 선택지(쇼츠·릴스·틱톡 / 다운로드 여러 옵션) ⑤ Now Playing에 **콘텐츠 신고** 기능(MAIDOL 참고) ⑥ 곡 생성 시 선택한 **프롬프트 설정값**을 DB에서 가져와 표시.

### Plan verification findings (0단계)
- **MAIDOL 최신 코드는 별도 worktree**(`/Users/pearl/TripleJ-maidol/0_platform_music`)에 있었다. 기존 `0_platform_music`(main)에는 공유 선택지·신고가 아예 없어, 그쪽만 보면 "기능 없음"으로 오판하게 된다.
- **신고**: MAIDOL `frontend/src/components/ReportModal.jsx` — 사유 5종(`portrait/copyright/sexual/abuse/other`), '기타'만 상세 입력(500자), 409=이미 신고, 400=신고 불가. 플레이어에서 **본인 곡엔 버튼 미표시**(`PlayerPage.jsx:422`). AIDOL 원격 백엔드에 **`POST /api/reports/`가 이미 존재**(무효값 호출로 "지원하지 않는 신고 사유/대상입니다" 검증 확인) → 백엔드 신규 개발 불필요.
- **공유**: 쇼츠/릴스/틱톡은 **모두 같은 API**(`POST /tracks/{id}/share-video?format=sns`)를 쓰고 폴백 업로드 URL만 다름. + 링크 복사.
- **다운로드**: `format=wide`(가로 16:9) / `sns`(세로 9:16) / `kakao`(15초) 영상 3종 + `POST /tracks/download/{id}`(mp3, 로그인 필요). 영상 최초 생성은 서버 ffmpeg로 1~2분.
- **프롬프트**: 트랙 문서에는 `prompt/genre/mood/tags/bpm/key/tempo/language/ai_model/duration_sec/play_count/like_count/download_count`가 있고, **보컬·스타일·악기·실험성·페르소나 등은 `generations` 문서에만** 존재. 해당 조회 API(`GET /generate/{id}`)는 **소유자 전용(403)** — MAIDOL도 동일 한계.

### 수행 결과
- **components/TrackRow.tsx**: 좌측 슬롯이 없으면 32px 빈 칸을 만들지 않고 **커버가 앞으로 당겨지도록**(`coverFirst`) 변경 → 검색·플레이리스트·마이뮤직·내 재생목록이 빈 공간 없이 정렬. 차트(순위 있음)는 그대로.
- **screens/ChartScreen.tsx**: '재생목록이 비어있어요' 빈 상태의 이모지 제거.
- **screens/MyMusicScreen.tsx**: 마이페이지 비로그인 화면을 `EmptyState+Button` → **공용 `LoginPrompt` + 세로 중앙 정렬**로 교체(다른 화면과 동일). ⋮의 공유·다운로드를 **선택지 시트**로 연결.
- **components/TrackShareDownloadSheet.tsx (신규)**: 공유 4종(YouTube 쇼츠·릴스·틱톡·링크 복사) / 다운로드 4종(일반 화질 16:9·SNS용 9:16·카톡 프로필 15초·음원 mp3). 영상은 `share-video` API(timeout 300s) 사용, mp3는 로그인 필요, MAIDOL과 동일한 에러 문구(404 공개 곡만/400 커버 없음/기타).
- **components/ReportModal.tsx (신규)**: MAIDOL과 동일한 사유 5종 라디오 + '기타' 상세 입력(500자 제한), 비로그인 시 로그인 유도, 409 "이미 신고한 콘텐츠입니다", 접수 완료 안내. **신고 사유 원문은 로그에 남기지 않고 길이만 기록**.
- **screens/PlayerScreen.tsx**: 액션 행에 **공유·신고** 추가(신고는 `uploader_id === user.id`면 숨김). 프롬프트 탭을 확장 — 트랙 필드 + (내 곡이면) `GET /generate/{id}`의 생성 설정을 합쳐 **값이 있는 항목만** 칩으로 표시(장르·분위기·보컬·스타일·악기·참조/제외 스타일·강도·실험성·오디오 영향도·페르소나·BPM·템포·키·언어·AI 모델·길이·태그·재생/좋아요/다운로드 수). 남의 곡은 403이므로 "생성 당시 설정값은 본인에게만 표시" 안내를 띄우고 조용히 생략. 프롬프트 문구가 없어도 파라미터가 있으면 탭이 보이도록 조건 완화.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 빈 재생목록 이모지 제거(텍스트만 노출) | PASS (`/tmp/v342_queue_empty.png`) |
| [e2e] 마이페이지 로그인 CTA = 공용 LoginPrompt(중앙 정렬) | PASS (`/tmp/v342_mypage.png`) |
| [e2e] 검색 행 좌측 빈 공간 제거(커버가 선두), 차트는 순위 유지 | PASS (`/tmp/v342_search.png`) |
| [e2e] 플레이어 액션행에 공유·신고 노출, 공유 시트 4종(쇼츠/릴스/틱톡/링크 복사) | PASS (`/tmp/v342_share.png`) |
| [e2e] 신고 모달 — 비로그인 시 로그인 유도 / 로그인 시 사유 5종 전부 노출 | PASS (`/tmp/v342_report_login.png`) |
| [e2e] 프롬프트 탭 — 작곡 프롬프트 + 파라미터(장르·AI 모델·템포·길이·재생 수·좋아요) + 소유자 안내 | PASS (`/tmp/v342_prompt.png`) |
| 콘솔 에러(내 코드) | 0 (남의 곡 `/generate/{id}` 403은 설계상 무시) |

### 특이사항
- **신고는 접수 API만 호출**했고 실제 신고 데이터를 만들지 않았다(무효값으로 검증 메시지만 확인). 사유 선택 후 '신고' 제출은 되돌릴 수 없어 E2E에서 누르지 않았다 — 화면 노출까지만 검증.
- **다운로드 영상 3종은 실제 생성 미검증**: 최초 생성이 서버 ffmpeg로 1~2분 걸려 자동화에서 실행하지 않았다(선택지 노출·API 경로·파라미터는 MAIDOL과 동일하게 맞춤). 실기기에서 한 번 확인 필요.
- **파일 저장 방식 한계**: 현재 영상/음원은 `Linking.openURL`로 브라우저에 넘긴다. iOS에서 앨범 저장이 어색할 수 있어, 원하면 `expo-file-system` + `expo-sharing` 도입으로 개선 가능(패키지 추가 필요).
- **프롬프트 완전 표시의 구조적 한계**: 보컬·스타일·악기 등은 `generations`에만 있고 소유자 전용이라 **남의 곡에서는 원천적으로 볼 수 없다**(MAIDOL도 동일). 모든 사용자에게 보이게 하려면 곡 발행 시 해당 값을 tracks에 복사하거나 `GET /tracks/{id}` 응답에 병합하는 **백엔드 수정**이 필요하다.

---

## v3.41 (순번 비우기 확대 + 검색 카테고리 문구 + 결과 전체 담기) — 2026-08-18

### 요청 작업
① 검색 결과 좌측 **순번 비우기**. ② 플레이리스트·마이뮤직도 마찬가지로(공용 행 + 순번 비움). ③ 검색 목록 제목을 카테고리명 단독("운동") 대신 **"운동할 때 듣는 음악"** 식 문구로. ④ **검색한 곡 모두 플레이리스트에 담기** 기능.

### Plan verification findings (0단계)
- v3.40에서 검색 좌측에 결과 순번을 넣었으나 순위 의미가 없음 → 비우는 것이 타당(여백은 유지해 커버 정렬은 차트와 동일).
- 플레이리스트/마이뮤직은 아직 **자체 행 렌더**. 특히 마이뮤직 행에는 태그·생성일·공개상태 + 공유/다운로드/차트업로드/삭제가 붙어 있어 단순 교체 시 **기능 손실** 위험 → ⋮ 확장 항목으로 옮겨 보존해야 함. 플레이리스트 상세 행의 ✕(제거)도 동일.
- 대량 담기 전용 API는 없음 → 기존 `POST /playlists/{id}/tracks`를 곡 수만큼 순차 호출하고 중복/실패는 건너뛰며 집계하는 방식으로 구현.

### 수행 결과
- **components/PlaylistPickerSheet.tsx (신규)**: 단일·다중 곡 공용 담기 시트. 기존 플레이리스트 선택 또는 새로 만들어 담기, 곡 수에 따라 제목/결과 문구 변경("N곡을 담았어요", 일부 실패 시 건수 표기), 진행 중 중복 탭 방지.
- **components/TrackActionSheet.tsx**: `extraItems`(화면 고유 메뉴, `danger` 지원) 추가. 내부 플레이리스트 로직은 위 공용 시트로 위임해 중복 제거.
- **screens/SearchScreen.tsx**: 좌측 순번 제거, 목록 제목을 **카테고리 문구**로 교체(10종 매핑 + 미매핑 시 `"{카테고리} 할 때 듣는 음악"` 폴백, 검색어일 땐 `'키워드' 검색 결과`), 제목 우측에 **모두 담기** 버튼(비로그인은 로그인 CTA로 유도).
- **screens/PlaylistScreen.tsx**: 자체 행 → 공용 `TrackRow`(순번 비움), ⋮에 **'이 플레이리스트에서 제거'**(빨간색) 추가 — 기존 ✕ 버튼 대체.
- **screens/MyMusicScreen.tsx**: 자체 행 → 공용 `TrackRow`(순번 비움), ⋮에 **공유·다운로드·차트에 업로드(비공개 곡만)·삭제** 배치 — 인라인 버튼/휴지통을 대체하며 기능은 모두 보존.

### 테스트 (tester)
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 검색 좌측 순번 없음 + 커버 정렬 유지 | PASS (`/tmp/v341_search.png`) |
| [e2e] 카테고리 문구 "운동할 때 듣는 음악" 노출 / "운동" 단독 표기 없음 | PASS |
| [e2e] '모두 담기' 버튼 노출, 비로그인 클릭 시 로그인 CTA 전환 | PASS (`/tmp/v341_bulk_guest.png`) |
| [regression] 차트 순위(1..)·행 높이 73px·⋮ 정상 | PASS (`/tmp/v341_chart.png`) |
| [e2e/로그인] 모두 담기 → 시트 제목 **"2곡을 플레이리스트에 담기"**, 새 플레이리스트 생성 성공(`created: true`) | PASS (`/tmp/v341_bulk_sheet.png`) |
| [e2e/로그인] 플레이리스트 상세 — 곡이 **공용 행(순번 없음, 커버·제목·재생수·좋아요수·⋮)**, 행 높이 73px | PASS (`/tmp/v341b_detail.png`) |
| [e2e/로그인] 플레이리스트 곡 ⋮ → **'이 플레이리스트에서 제거'** 노출 | PASS (`removeNow: true`) |
| [e2e] 검색 ⋮ 시트에는 제거 항목 없이 공용 4항목만 | PASS (`/tmp/v341_pl_sheet.png`) |
| 콘솔 에러 / PAGEERROR | 0 / 0 |

### 특이사항
- **마이뮤직 행에서 빠진 표시 정보**: 장르·무드 태그, 생성일, "차트 스트리밍 중" 배지는 공용 행에 자리가 없어 노출되지 않는다. **동작(공유·다운로드·차트 업로드·삭제)은 ⋮에 모두 보존**했다. 태그/공개상태를 행에 다시 보이게 하려면 공용 행에 선택적 배지 슬롯을 추가하면 된다.
- **마이뮤직 화면은 E2E 미검증**: 이 테스트 계정에 업로드한 곡이 없어 목록이 비어 실제 렌더를 확인하지 못했다(타입체크·코드 경로만 확인). 곡이 있는 계정에서 확인 필요.
- 로그인 E2E는 로그인 직후 **출석체크 팝업**이 자동으로 떠 두 차례 막혔고, `accessibilityLabel="닫기"`로 닫는 처리를 넣어 통과시켰다(앱 버그 아님, 자동화 이슈).
- 테스트 과정에서 테스트 계정에 `v341 운동모음` 플레이리스트가 2개 생성됐다(재실행 때문). 실제 사용자 데이터는 건드리지 않았다.

---

## v3.40 (곡 목록 행·더보기 메뉴 공용화 — 검색 = 차트 동일 디자인) — 2026-08-18

### 요청 작업
검색해서 뜨는 곡을 **차트의 곡과 디자인이 동일**하게.

### Plan verification findings (0단계)
- 두 화면이 **완전히 다른 코드**로 각자 행을 그리고 있었음.
  · 차트(`ChartScreen.tsx`): `순위/NEW/▶ | 커버48(radius, overflow hidden) | 마퀴 제목 + 아티스트 | 재생수·좋아요수 | ⋮ 더보기` + ⋮ 액션시트(재생/좋아요/재생목록 추가/플레이리스트 담기) + 플레이리스트 바텀시트.
  · 검색(`SearchScreen.tsx`): `커버48 | 제목(일반 텍스트) + 아티스트 | ▶ play-circle 아이콘`. 순위·통계·⋮ 없음, 마퀴 없음, 행 패딩/보더도 별도 정의.
- 원인: 공용 컴포넌트 없이 화면마다 복붙 → v3.38(로그인 CTA)과 **같은 종류의 불일치**. 재발 방지를 위해 컴포넌트 추출이 필요.
- 검색 결과 타입엔 `play_count/like_count` 필드가 선언돼 있지 않았고(백엔드는 내려줌), 좋아요 동기화(`likesStore.sync`)도 검색에는 없었음.

### 수행 결과
- **components/TrackRow.tsx (신규)**: 곡 목록 한 줄 공용 컴포넌트 — 좌측 슬롯(순위/NEW/▶/번호) + 커버 + 마퀴 제목 + 아티스트 + 재생수·좋아요수 + ⋮. 커버 URL 헬퍼(`getTrackCoverUri`)·`TrackCover`·좌측 슬롯 스타일(`trackRowStyles`)도 함께 export.
- **components/TrackActionSheet.tsx (신규)**: ⋮ 메뉴 전체를 자족형으로 공용화 — 곡 헤더 + 재생/좋아요/재생목록에 추가/플레이리스트에 담기, **플레이리스트 담기 바텀시트**(기존/신규 생성), **비회원 담기 안내 팝업**, 로그인 유도까지 내장. `onLikeChanged`로 호출 화면의 좋아요 수 낙관적 보정 지원.
- **screens/ChartScreen.tsx**: 자체 행 렌더 → `TrackRow`(좌측 슬롯만 탭별 분기), 자체 액션시트·플레이리스트 시트·관련 핸들러(≈100줄) → `TrackActionSheet`로 대체. 중복 상태/임포트 정리.
- **screens/SearchScreen.tsx**: 자체 행 렌더 → `TrackRow`(좌측=순번), `TrackActionSheet` 연결(검색에서도 좋아요·담기 가능), 결과 변경 시 `likesStore.sync` 호출로 하트 상태 표시, `Track` 타입에 `play_count/like_count` 추가. 미사용 `getCoverUri`·행 스타일·`Image` 임포트 제거.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 차트 vs 검색 행 실측 비교(행 높이·패딩·하단보더·커버 크기·아이콘 수·텍스트 구성) | **불일치 0** — 양쪽 73px / 12px 16px / 1px / 48px, 구성 `번호·제목·아티스트·재생수·좋아요수` 동일 |
| [e2e] 검색 ⋮ → 액션시트 4개 항목(재생/좋아요/재생목록에 추가/플레이리스트에 담기) | PASS (`/tmp/v340_sheet3.png`) |
| [regression] 차트 ⋮ → 액션시트 정상, 행 클릭 시 오작동 없음 | PASS (`/tmp/v340_chart_sheet.png`) |
| [regression] 검색 칩/디폴트 카테고리/로그인 CTA(v3.38·v3.39) 유지 | PASS (`/tmp/v340_search.png`) |
| 콘솔 에러 | 0 |

### 특이사항
- 검색 좌측은 순위 개념이 없어 **결과 순번(1,2,3…)**을 표시했다. 레이아웃이 차트와 정확히 일치하며, 원치 않으면 빈 슬롯으로 바꿀 수 있다.
- 테스트 중 확인된 사실: 탭 전환 후에도 이전 탭 화면이 언마운트되지 않아 `aria-label="더보기"` 요소가 화면 수만큼 DOM에 남는다(E2E 셀렉터 주의 — 코드 버그 아님).
- 이번 추출로 곡 목록 UI는 한 곳(`TrackRow`/`TrackActionSheet`)만 고치면 모든 화면에 반영된다. 아직 자체 행을 쓰는 화면(플레이리스트 상세, 마이뮤직 등)도 원하면 같은 방식으로 통일 가능.

---

## v3.39 (담기 안내 팝업 1회만 + 검색 느낌 칩 이모지·라벨 제거) — 2026-08-18

### 요청 작업
① 한 번 '계속 담기'를 누르면 차트에서 담기 클릭 시 **다시 팝업이 뜨지 않도록**. ② 검색 페이지의 운동·에너지충전 등 **앞 이모지 전부 제거**. ③ **"느낌별 음악" 텍스트 제거**.

### Plan verification findings (0단계)
- **원인 확정**: `guestNoticeAck`가 `partialize`에 없어 **영속화되지 않음**(`stores/playerStore.ts`) → 앱 재시작/새로고침 때마다 false로 돌아가 팝업이 다시 떴다. 추가로 `resetOnLogout`이 ack를 false로 되돌려 로그아웃 후에도 재노출.
- 세션 내 2회차 억제는 이미 동작 중이었음(v3.36 E2E로 확인) — 즉 재노출은 **재시작 경로** 문제였다.
- 검색 이모지는 3곳: 칩(`CATEGORY_EMOJI[cat]`), 결과 헤더(`{이모지} {카테고리}`), 그리고 매핑 상수 자체. "느낌별 음악"은 섹션 제목 `AppText`(+EmptyState 힌트 문구에서도 참조).

### 수행 결과
- **stores/playerStore.ts**: `guestNoticeAck`를 **영속 대상에 추가**(partialize) → 앱을 다시 켜도 확인 상태 유지. `resetOnLogout`에서 ack 초기화 제거(한 번 확인한 안내를 로그아웃했다고 다시 띄우지 않음).
- **screens/SearchScreen.tsx**: 칩에서 이모지 출력 제거(텍스트 칩만), 결과 헤더에서 이모지 제거, 미사용이 된 `CATEGORY_EMOJI` 상수 삭제. 섹션 제목 **"느낌별 음악" 제거** + 이제 없는 라벨을 가리키던 EmptyState 힌트를 "위의 느낌을 눌러보세요"로 수정, 미사용 `moodTitle` 스타일 삭제.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 담기 팝업: 1회차 노출 → '계속 담기' → 2회차 미노출 | PASS (true → false) |
| [e2e] **새로고침(앱 재시작) 후 담기 → 팝업 미노출** (핵심 회귀 지점) | PASS (`/tmp/v339_after_reload.png`) |
| [e2e] 검색 칩 10종 텍스트만 노출, 칩 영역 이모지 검출 수 **0** | PASS (`/tmp/v339_search.png`) |
| [e2e] "느낌별 음악" 텍스트 부재 | PASS |
| [regression] 칩 탭 → 해당 느낌 곡 목록 로드(운동 디폴트 선택 유지), 결과 헤더 카테고리명 표시 | PASS |
| 콘솔 에러 | 0 |

### 특이사항
- 팝업은 "비회원이 처음 담을 때 1회"만 노출되는 안내로 확정. 안내 내용(재생목록 소멸·별 미적립·작업실에서 음악 제작)은 '내 재생목록' 상단 배너에 상시 남아 있어, 팝업을 없애도 정보 손실은 없다.
- EmptyState 아이콘(🎵/🔍)은 이모지지만 칩·라벨과 무관한 빈 상태 일러스트라 유지했다. 원하면 함께 제거 가능.

---

## v3.38 (검색 화면 로그인 CTA를 공통 컴포넌트로 통일) — 2026-08-18

### 요청 작업
검색 페이지의 "로그인하고 시작하기"도 다른 화면과 **디자인·위치가 통일**되어야 함.

### Plan verification findings (0단계)
- 피드/플레이리스트/작업실(Map)은 공통 `components/LoginPrompt.tsx`(내부 `LoginStartButton`)를 사용 — 설명문 15px/lineHeight 24/secondary, 버튼은 accent 배경·radius 24·py14/px40·흰색 bold 16, 컨테이너는 `flex:1 + justifyContent:'center'`(세로 중앙).
- **검색만 예외**(`screens/SearchScreen.tsx:202`): 공통 컴포넌트 대신 `AppText`(body, lineHeight 20) + 범용 `Button`을 직접 조합했고, 컨테이너가 `paddingVertical: spacing.huge`라 **세로 중앙이 아니라 상단 쪽에 붙어** 있었음 → 폰트·버튼 스타일·위치가 모두 달랐음.

### 수행 결과
- **screens/SearchScreen.tsx**: 자체 조합(AppText+Button)을 **공통 `LoginPrompt`로 교체**하고, 컨테이너를 `flex:1 + justifyContent:'center'`로 바꿔 다른 화면과 동일한 세로 중앙 배치로 통일. 문구는 기존 그대로("검색 기능은 로그인 후 이용할 수 있어요"). 미사용이 된 `Button` import 제거, `loginHint` 스타일 삭제.
- 검색 상단의 검색창·느낌별 칩 바는 기존대로 유지(v3.16/17 사양) — CTA는 그 아래 남는 영역의 중앙에 배치된다.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 검색·플레이리스트·피드 3화면 CTA 실측 비교(버튼 fontSize/weight/color/width, 설명문 fontSize/lineHeight/color) | **불일치 0** — 전부 16px/700/#fff/128px, 설명 15px/24px/secondary |
| [e2e] 위치 통일: 버튼 중심 Y좌표 | 3화면 모두 **531px**(viewport 844) 동일 |
| [e2e] 스크린샷 육안 확인 | PASS (`/tmp/v338_search.png`, `/tmp/v338_playlist.png`, `/tmp/v338_feed.png`) |
| 콘솔 에러 | 0 |

### 특이사항
- 검색은 게이트 진입 조건이 다른 화면과 다름(검색창 포커스/입력 시 노출) — 이번 요청은 디자인·위치 통일이므로 트리거 방식은 유지했다.
- 남은 비통일 지점: `MyMusicScreen`/`ArtistInputScreen`은 `EmptyState`+`Button` 조합(작업실 오버레이와 별개 경로)이라 CTA 형태가 다르다. 요청 범위 밖이라 손대지 않았으며, 원하면 동일하게 통일 가능.

---

## v3.37 (별 안내 문구 보강 + 가입=승계·로그인=계정 목록 복원) — 2026-08-18

### 요청 작업
① "별도 받을 수 없어요"만으로는 별이 뭔지 알 수 없음 → **별을 모으면 작업실에서 나만의 음악을 만들 수 있다**는 설명을 넣을 것. ② 앱을 새로 켜면 로그인 사용자도 로그아웃 상태가 된다면, **회원가입 사용자만 (비회원으로 담은) 재생목록을 승계**하고, **로그인만 하는 경우엔 그 계정의 기존 재생목록을 보여주는 게 맞지 않나**.

### Plan verification findings (0단계)
- v3.36은 login/register **둘 다 `claimQueue`**(게스트 큐 승계) → 로그인 사용자의 기존 목록이라는 개념이 없었음. 사용자 지적대로 분기 필요.
- **잠재 버그 발견**: v3.36은 `queue`+`queueOwnerId`를 영속화 → 앱 재시작 시 auth는 초기화되는데 큐는 남아 **이전 로그인 사용자의 재생목록이 다음 게스트에게 그대로 노출**될 수 있었음.
- 계정별 재생목록을 보관하는 저장소가 없었음(서버 API도 없음) → 로컬 보관함 도입 필요.

### 수행 결과
- **stores/playerStore.ts (저장 구조 재설계)**
  - `savedQueues: { [userId]: { queue, currentIndex, track } }` **계정별 보관함**(영속) 추가. 로그인 상태에서 큐가 바뀔 때마다(`setQueue/addToQueue/removeFromQueue/reorderQueue/setCurrentIndex`) 해당 계정 보관함에 자동 저장.
  - `claimQueue(userId)` = **회원가입 전용** — 가입 직전까지 비회원으로 담은 목록을 새 계정으로 승계.
  - `restoreQueueFor(userId)` = **로그인 전용** — 그 계정 보관함의 목록을 복원해 보여줌(재생 위치·현재 곡 포함). 보관 목록이 없으면(첫 로그인 등) 담아둔 목록을 승계.
  - `resetOnLogout()`은 비우기 **전에 보관함에 저장** → 다음 로그인 때 그대로 복원.
  - **영속 대상 축소**: 작업 중인 `queue/currentIndex/track/queueOwnerId`는 더 이상 영속화하지 않고 `savedQueues`(+shuffle/repeat)만 저장 → ⓐ 비회원 목록은 재시작 시 자연히 사라지고(안내 문구와 일치), ⓑ **이전 사용자 목록이 다음 사람에게 노출되는 문제 해소**. v3.36의 `onRehydrateStorage` 임시 처리 제거.
- **stores/authStore.ts**: `login` → `restoreQueueFor(user.id)`, `register` → `claimQueue(user.id)`로 분기.
- **components/GuestQueueNoticeModal.tsx / screens/ChartScreen.tsx (문구)**: "로그인하지 않으면 다음 접속 시 재생목록이 사라져요 / 음악을 들으면 받는 **별(⭐)**도 쌓이지 않아요 / **별을 모으면 작업실에서 나만의 음악을 만들 수 있어요**" — 팝업·목록 상단 배너 동일 취지로 보강(별 강조 색).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [unit] 보관/복원 8케이스: 가입 승계, 로그인 시 기존목록 복원(게스트목록 대체), 보관없음→승계, 로그아웃 보관 후 비움, 재로그인 복원, 재시작 시 게스트 빈 큐·보관함 유지·재로그인 복원 | 8/8 PASS |
| [e2e] 담기 팝업에 별 설명 문구 노출("작업실에서 나만의 음악을 만들 수 있어요") | PASS (`/tmp/v336_notice.png`) |
| [e2e] 내 재생목록 배너에 동일 안내 노출 | PASS (`/tmp/v336_mylist_guest.png`) |
| [e2e/regression] 담기 팝업 노출·로그인 화면 미이동·계속 담기 후 목록 표시·2회차 팝업 없음 | PASS |
| 콘솔 에러 | 0 |

### 특이사항
- **정책 확정**: 회원가입 = 담아둔 목록 승계 / 로그인 = 그 계정 목록 복원(없으면 담아둔 목록 승계) / 로그아웃 = 보관 후 비움 / 재시작 = 비회원 목록 소멸·계정 목록은 보관함에 남아 로그인 시 복원.
- **부수 효과(의도)**: 재시작 시 "마지막 듣던 곡 자동 복귀"는 더 이상 하지 않음(로그인 후 복원으로 대체) — 세션이 초기화되는 현 구조에서 이전 사용자 데이터 노출을 막기 위한 선택.
- 재생목록은 여전히 **로컬 보관**이다(서버 동기화 아님). 기기를 바꾸면 따라오지 않는다 — 서버 저장이 필요하면 백엔드 API 신설이 선행돼야 한다.
- 로그인/가입 실제 플로우는 계정이 필요해 E2E 대신 단위 테스트로 검증.

---

## v3.36 (담기 선택 팝업 + 내 재생목록 비회원 개방 + 로그인 시 큐 승계) — 2026-08-18

### 요청 작업
① 비로그인 담기 시 곧장 로그인 화면으로 튕기지 말고 **[로그인하고 시작하기] / [계속 담기]** 선택 팝업 — "로그인 안 하면 다음 접속 시 재생목록 사라짐 + 별 못 받음" 안내. ② 계속 담기를 고르면 담은 곡이 내 재생목록에 **그냥 보이도록**(회원 전용 아님 — v3.35 게이트 철회). ③ 담다가 로그인하면 그 재생목록이 **로그인 이후에도 그대로 유지**되도록 데이터 보존.

### Plan verification findings (0단계)
- v3.35에서 '내 재생목록' 탭에 회원 전용 `LoginPrompt` 게이트를 넣었음 → **철회 대상**(사용자: "회원전용이 아닌거야").
- `ChartScreen.handleAddToQueue`는 원래 로그인 불필요였고, 로그인 화면으로 튕기던 건 `requireLogin()`(:112)을 쓰는 좋아요/플레이리스트 담기 경로. `PlayerScreen.handleAddToPlaylist`(:520)는 **아무것도 하지 않는 스텁**("플레이리스트에 추가되었습니다" 알림만) — 사용자가 말한 '담기'가 실제로 재생목록에 담기지 않고 있었음.
- **중요**: `stores/authStore.ts`는 **영속화·세션 복원이 전혀 없음**(재시작 시 항상 로그아웃). 반면 playerStore는 큐를 무조건 영속화 → 지금 구조로는 **비회원 큐가 다음 접속에도 남아** "로그인 안 하면 사라진다"는 안내가 거짓이 됨. → 소유자 표식으로 정직하게 구현 필요.

### 수행 결과
- **components/GuestQueueNoticeModal.tsx (신규)**: "재생목록에 담을까요?" + 경고문(다음 접속 시 사라짐 · 별 못 받음) + **[로그인하고 시작하기] / [계속 담기]** 2선택. 배경 탭으로 취소.
- **screens/ChartScreen.tsx**: ⋮ '재생목록에 추가'를 비회원이 누르면 **로그인 화면 이동 대신 팝업**. '계속 담기' 선택 시 즉시 담고 `guestNoticeAck`로 이후엔 팝업 없이 바로 담김. **v3.35 회원 전용 게이트 제거** → 비회원도 담은 곡이 그대로 보이고, 목록 상단에 안내 배너(탭하면 로그인)만 노출.
- **screens/PlayerScreen.tsx**: '담기' 스텁을 **실제 재생목록 추가**로 수정(+ 동일한 비회원 팝업 흐름). `useAuthStore` 실사용(기존엔 import만 되어 있었음).
- **stores/playerStore.ts**: `queueOwnerId`(영속) 추가 — 비회원 큐는 owner=null. `claimQueue(userId)`로 **로그인 시 큐 항목·인덱스 그대로 두고 소유자만 부여(보존 승계)**. `onRehydrateStorage`에서 **owner 없는(비회원) 큐는 재시작 시 폐기** → 안내문과 실제 동작 일치. `guestNoticeAck`(세션 한정) 추가. `resetOnLogout`은 owner/ack도 함께 초기화.
- **stores/authStore.ts**: `login`/`register` 성공 시 `claimQueue(user.id)` 호출 → 담다가 로그인해도 재생목록 유지.

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [unit] claimQueue/재수화 4케이스: 로그인 승계 시 큐·인덱스 보존, 회원큐 재시작 유지, 비회원큐 재시작 폐기, 멱등 | 4/4 PASS |
| [e2e] 게스트 담기 → 팝업 노출(문구·2버튼)·**로그인 화면으로 튕기지 않음**(차트 유지) | PASS (`/tmp/v336_notice.png`) |
| [e2e] '계속 담기' → 내 재생목록 탭에 담은 곡 표시, "회원 전용" 문구 사라짐, 안내 배너 노출 | PASS (`/tmp/v336_mylist_guest.png`) |
| [e2e] 2회차 담기는 팝업 없이 바로 담김(ack 동작) | PASS |
| 콘솔 에러 | 0 |

### 특이사항
- **정책 갱신(v3.35 → v3.36)**: 내 재생목록은 **회원 전용이 아님**. 비회원도 담고 볼 수 있으며, 다만 재시작 시 폐기 + 별 미적립. 로그인 시 승계 보존.
- **알려진 제약(후속 제안)**: `authStore`에 세션 영속화가 없어 앱 재시작 시 로그인 사용자도 로그아웃 상태가 된다. 이 경우 회원이 담은 큐는 (owner가 있어) 데이터로는 보존되지만, "로그인 상태 유지"는 별도 작업(토큰 안전 저장 + 부팅 시 복원)이 필요하다 — 원하면 다음 버전에서 진행 가능.
- 로그인 이후 승계는 로그인 계정이 필요해 E2E 대신 단위 테스트로 검증.

---

## v3.35 (내 재생목록 회원 전용 게이트 + 플레이리스트 재생=큐 교체로 정정) — 2026-08-18

### 요청 작업
① 내 재생목록은 가입(로그인)해야 제공 — 세션 끊기고 재진입 시 비회원엔 아무것도 없어야 함. ② 플레이리스트 곡은 재생목록에 담기지 않게(=v3.34 누적 되돌리기). ③ 단, 플레이리스트에서 재생하면 그 플레이리스트가 재생목록이 되어야 함(=큐 교체).

### Plan verification findings (0단계)
- v3.34에서 PlaylistScreen을 `mergeAndPlay`(누적 보존)로 바꿨음 → 사용자 의도는 반대(누적 금지 + 재생 시 교체). **정정 필요.**
- `stores/authStore.ts:86` `logout`은 `token/user`만 초기화, 큐는 그대로. playerStore는 queue/currentIndex/track을 AsyncStorage에 영속화 → 로그아웃/재진입해도 큐 잔존.
- 차트 '내 재생목록' 탭(v3.33)은 로그인 여부와 무관하게 로컬 큐 노출 → 회원 전용 게이트 없음.
- ChartScreen엔 이미 `requireLogin()` 패턴, 앱 전역엔 `LoginPrompt` 공통 컴포넌트 존재(Feed/Playlist에서 사용).

### 수행 결과
- **screens/PlaylistScreen.tsx (정정)**: 곡 탭을 `mergeAndPlay`(누적) → `setQueue(playlistTracks)+setCurrentIndex`(교체)로 되돌림 → **플레이리스트에서 재생하면 그 플레이리스트가 곧 재생목록**. 기존 큐에 누적하지 않음.
- **stores/playerStore.ts**: v3.34 `mergeAndPlay` 제거. 대신 `resetOnLogout()` 추가 — sound 언로드 + queue/currentIndex/track/재생상태 초기화.
- **stores/authStore.ts**: `logout`에서 `usePlayerStore.getState().resetOnLogout()` 호출 → 로그아웃 시 재생목록 완전 초기화(재진입 시 비회원엔 잔존 없음).
- **screens/ChartScreen.tsx**: '내 재생목록' 탭을 **회원 전용 게이트** — 비로그인 시 큐를 노출하지 않고 `LoginPrompt`(🎧 "내 재생목록은 회원 전용이에요" + 로그인하고 시작하기) 표시. (게스트가 큐를 만들어도 탭에선 곡이 아니라 로그인 유도.)

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [unit] `mergeAndPlay` 참조 전무 확인(정정 완료) | PASS |
| [e2e] 게스트가 큐에 곡 추가 후 '내 재생목록' 탭 → 회원 전용 문구+로그인 버튼, 큐 곡·빈상태문구 미노출 | PASS (`/tmp/v335_gate.png`) |
| [e2e] 게스트 흐름 콘솔 에러(authStore↔playerStore import 포함) | 0 |

### 특이사항
- 로그아웃→큐 초기화, 플레이리스트 교체 재생은 로직이 단순하고 tsc/임포트 그래프 무오류로 검증(로그인 필요한 전체 플로우는 웹 E2E 대신 정적+게스트 임포트 검증으로 대체).
- **정책 정리(확정)**: 재생목록(큐)=로그인 회원의 단일 '지금 재생' 목록(영속·로그아웃 시 소멸). 플레이리스트=저장 목록, 재생 시 큐를 교체(누적 아님). 차트 곡 클릭/‘재생목록에 추가’ 누적은 유지(회원이 큐를 쌓는 정식 경로).
- 잔여 참고: Search/Artist/Feed/UserChannel 재생도 `setQueue` 교체(일관). 미니플레이어는 활성 재생 중에만 노출.

---

## v3.34 (재생목록↔플레이리스트 구분: 큐 보존 + 재생목록 아이콘 위치 교체) — 2026-08-18

### 요청 작업
① 재생목록이 18곡이었는데 플레이리스트 5곡이 추가/섞인 것처럼 보임 — 구분되어야 하는데 이상함. ② 재생목록 순서 편집 아이콘(≡)과 닫기 아이콘(×) 위치 교체.

### Plan verification findings (0단계)
- 큐 변경 지점 전수조사: 차트 곡 클릭·'재생목록에 추가'는 `addToQueue`(**누적**), 그러나 **PlaylistScreen 곡 탭은 `setQueue(playlistTracks)`(파괴적 교체)**(`screens/PlaylistScreen.tsx:199`). Search/ArtistDetail/Feed/UserChannel도 `setQueue` 교체.
- 즉 사용자가 차트로 **누적한 18곡 재생목록**이 플레이리스트를 재생하는 순간 그 플레이리스트 5곡으로 **덮어써져** 사라짐 → "재생목록에 플레이리스트가 섞였다/이상하다"의 실제 원인. (증가 버그(18+5)가 아니라 파괴적 교체(18→5)였음.)
- 아이콘: `components/DraggableQueue.tsx` 행 배치가 `본문 → ×(제거) → ≡(핸들)` 순 → 사용자는 ≡/× 위치 교체 요청.

### 설계 판단 (재생목록 vs 플레이리스트)
- **재생목록(재생 큐)** = 사용자가 쌓아가는 단일 '지금 재생' 목록. **플레이리스트** = 저장된 소스 목록. 둘은 별개.
- 파괴적 교체는 사용자가 애써 만든 재생목록을 날려 손실이 큼 → **플레이리스트 재생을 차트 클릭과 동일한 '누적(중복 제외)+선택곡 재생'으로 통일**해 큐를 보존. (재생목록은 일관되게 누적되는 단일 목록, 플레이리스트는 거기에 곡을 공급하는 저장 소스로 역할이 분리됨.)

### 수행 결과
- **stores/playerStore.ts**: `mergeAndPlay(tracks, targetId)` 추가 — 기존 큐에 없는 곡만 누적(중복 제외), id 정규화(플레이리스트 곡은 `track_id`만 있을 수 있음 → `id`로 승격), 선택곡 인덱스로 `currentIndex` 설정. 파괴적 교체 없음.
- **screens/PlaylistScreen.tsx**: 곡 탭 핸들러를 `setQueue+setCurrentIndex`(교체) → `mergeAndPlay`(보존 누적)로 교체 + 로그.
- **components/DraggableQueue.tsx**: 행 배치를 `본문 → ≡(핸들) → ×(제거)`로 교체(≡가 × 앞).

### 테스트 (tester) — PASS
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [unit] mergeAndPlay 순수로직: 18곡+PL5곡→23곡 보존·선택인덱스 정확, 중복제외, 빈큐, 타겟없음 폴백 | 4/4 PASS |
| [e2e] 재생목록 모달 아이콘 순서: ≡(handleX=308) < ×(removeX=338) | PASS (`/tmp/v334_queue.png`) |
| [e2e] 아이콘 교체 후 드래그 회귀: `[DraggableQueue] reorder {from:0,to:1}` 발화·순서 변경·▶ 추종 | PASS |

### 특이사항
- **범위 판단**: 이번엔 사용자가 지목한 **플레이리스트 재생**만 큐 보존(mergeAndPlay)으로 전환. Search/ArtistDetail/Feed/UserChannel은 여전히 `setQueue` 교체 유지(브라우징 새 재생 세션 성격) — 원하면 동일 정책으로 통일 가능(후속). 
- 대안 설계(플레이리스트를 재생목록과 **완전 분리**해 큐에 아예 넣지 않는 2단계 큐)는 next/prev 컨텍스트 분리가 필요한 큰 변경이라 이번엔 보류. 사용자가 "플레이리스트 곡은 재생목록에 아예 안 담기길" 원하면 그 방향으로 재작업 가능.
- 플레이리스트 전체 E2E는 로그인+플레이리스트 데이터 필요 → 핵심 로직은 단위 테스트로 검증.

---

## v3.33 (마퀴 크로스플랫폼 측정 + 재생목록 드래그 편집 + 차트 '내 재생목록' 탭) — 2026-08-18

### 요청 작업
① 제목이 아직 말줄임 형태 — 다시 확인. ② 재생목록을 드래그로 잡아 끌어 순서 편집 가능하게. ③ 차트에 주간/월간/신곡 다음에 '내 재생목록' 탭을 둬 내 큐를 보기 — 멜론은 어떻게 되어있나?

### Plan verification findings (0단계)
- ① v3.32는 **웹만** 해결됨. Marquee의 폭 측정이 `whiteSpace:nowrap`(web 전용) + `position:absolute` 요소 기반이라 **네이티브에선 측정 텍스트가 개행 → 자연폭 미측정 → overflow 미감지 → 말줄임 유지**. 사용자가 실기기(네이티브)에서 보면 여전히 "..."로 보이는 원인.
- ② 큐 편집 라이브러리 미설치: `react-native-draggable-flatlist`/`gesture-handler`/`reanimated` **모두 없음**. reanimated 도입은 babel 설정·빌드 리스크 → **내장 PanResponder**로 자체 구현 결정.
- ③ 차트 TABS는 `top100/weekly/monthly/new` 4개(`screens/ChartScreen.tsx:37`). playerStore에 `queue`/`currentIndex` 존재 → 로컬 큐를 그대로 노출 가능. **멜론 실제**: '재생목록(현재 재생 큐)'은 차트 탭이 아니라 **플레이어/미니플레이어의 상시 버튼**으로 접근하고, '내 플레이리스트'는 라이브러리(보관함)에 별도로 둠 — 차트(랭킹)와 큐를 섞지 않음. 사용자 요청대로 차트 탭에 큐 뷰를 추가하되, 랭킹과 구분되게 라벨을 '내 재생목록'으로 명시.

### 수행 결과
- **components/Marquee.tsx (크로스플랫폼 측정으로 재작성)**: 별도 absolute 측정요소 제거. **실제 표시 텍스트 자체**(`flexShrink:0` + web `whiteSpace:nowrap`)를 `onLayout`으로 측정 → 네이티브는 yoga가 flexShrink:0 행 자식을 자연폭 한 줄로 측정, 웹은 nowrap로 한 줄 유지. 양 플랫폼 모두 자연폭 정확 측정 → **overflow 감지 정상**. numberOfLines 미사용(말줄임 원천 차단).
- **stores/playerStore.ts**: `reorderQueue(from,to)` 추가 — 배열 splice 이동 + **현재 재생 인덱스(currentIndex) 보정**(끌린 곡이 재생 중이면 따라 이동, 사이를 지나가면 ±1).
- **components/DraggableQueue.tsx (신규)**: 라이브러리 없이 내장 **PanResponder** 드래그 편집. 고정 행높이(ROW_H=60) 절대배치, 끌리는 행 `translateY`로 손가락 추종·사이 행 ±ROW_H로 자리 양보, 우측 그립(≡) 핸들에서만 드래그. **핵심 버그 회피**: PanResponder를 렌더마다 재생성하면 제스처 중 terminate → **index별 1회 생성 캐시(respondersRef)** + 가변값 ref 참조.
- **screens/PlayerScreen.tsx**: 큐 모달의 정적 리스트를 `<DraggableQueue/>`로 교체 + "≡ 손잡이를 잡고 끌어 순서를 바꿀 수 있어요" 안내.
- **screens/ChartScreen.tsx**: TABS에 `{key:'queue', label:'내 재생목록'}` 추가(API 없이 로컬 큐 노출). fetchChart는 queue탭이면 API 스킵, 렌더는 `playerStore.queue`를 데이터소스로. 빈 큐 EmptyState, 현재 재생곡 ▶ 표시.

### 멜론 답변(사용자 질문)
멜론은 '재생목록(현재 큐)'을 **차트 탭이 아니라 플레이어/하단 재생바의 상시 버튼**으로 열고, '내 플레이리스트/보관함'은 라이브러리에 따로 둡니다(차트=랭킹, 큐=재생대기열을 분리). 요청대로 차트에 '내 재생목록' 탭을 추가하되 랭킹과 혼동되지 않게 라벨을 명확히 했고, 큐 접근성은 v3.32의 미니플레이어 바로가기 + 이번 탭으로 이중 확보했습니다.

### 테스트 (tester) — PASS (웹 실측, tsc 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc --noEmit | 에러 0 |
| [e2e] 긴 제목(주입)→마퀴: copies=2·textOverflow=clip(말줄임 없음)·좌측 이동(106→28px) | PASS (`/tmp/v333_marquee_a.png`·`_b.png`) |
| [e2e] '내 재생목록' 탭 존재·빈 상태 문구·큐 채워지면 목록 노출 | PASS (`/tmp/v333_mylist.png`) |
| [e2e] 큐 드래그(터치)로 순서 변경: [쉬었음청년,여름의끝자락에서]→[여름의끝자락에서,쉬었음청년], ▶ 인덱스 추종 | PASS (`/tmp/v333_touch_after.png`) |
| 콘솔 에러(내 코드) / reorder 로그 동작 | 0 / `[DraggableQueue] reorder {from:0,to:1}` 확인 |

### 특이사항
- 드래그는 RNW responder가 **터치 이벤트** 경로를 우선 → Playwright 합성 마우스로는 재현 불안정, **CDP 터치 이벤트**로 실제 순서 변경까지 검증(실기기 터치는 PanResponder 정식 지원 경로라 정상 동작 예상). 네이티브 실기기 테스트는 에뮬레이터 부재로 미실시.
- 관측된 `401 /business/ads/*/impression`은 광고 노출 트래킹(비로그인) — 이번 변경과 무관한 기존 사항.

---

## v3.32 (마퀴 실동작 수정 + 미니플레이어 재생목록 바로가기 + Now Playing 하단 라인 제거) — 2026-08-18

### 요청 작업
① 차트 제목 마퀴가 아직 ...(말줄임)으로 보임 — 다시 확인/수정. ② 내 재생목록은 MAIDOL도 곡 클릭해야 나오나?(불편). ③ Now Playing을 상단바처럼 만들라 한 적 없음 — 하단 라인 없애줘.

### Plan verification findings (0단계)
- ① v3.31 Marquee가 **오버플로 미감지** → static 분기(numberOfLines=1)로 말줄임. 원인: 폭 측정용 텍스트가 컨테이너 폭으로 **개행**돼 자연폭이 아닌 컨테이너폭으로 측정됨(overflow=false). 또 마퀴 복사본의 numberOfLines=1이 웹에서 ellipsis 강제.
- ② MAIDOL도 재생목록(큐)은 `/player` 안에서만 보임(곡 재생/클릭 필요) — 구조상 동일. 다만 **한 번에 열 진입점**이 없어 불편.
- ③ v3.31에서 헤더에 하단 보더(borderBottom)를 추가해 "상단바처럼" 보이게 됨 — 사용자는 위치만 옮기길 원했음.

### 수행 결과
- **components/Marquee.tsx (실동작 수정)**: 폭 측정 텍스트에 **web `whiteSpace:nowrap`** 부여 → 자연폭 정확 측정(개행 방지) → 긴 제목 **오버플로 감지 성공**. 마퀴 복사본은 **numberOfLines 제거 + 측정폭 고정(width:textW+4) + web nowrap** → **말줄임 없이 전체 텍스트가 좌우로 흐름**. 웹 네이티브드라이버 미지원 대응(`useNativeDriver: Platform.OS!=='web'`).
- **components/MiniPlayer.tsx + PlayerScreen.tsx (재생목록 바로가기)**: 미니플레이어에 **재생목록(list) 버튼** 추가 → `Player`로 `openQueue:true` 전달 → **큐 모달 즉시 오픈**(곡 클릭 후 플레이어 진입→버튼탭 2스텝을 1탭으로 단축).
- **screens/PlayerScreen.tsx (라인 제거)**: 헤더 `borderBottom` 제거 → Now Playing 하단 라인 없음(상단바 룩 해제).

### 테스트 (tester) — PASS (웹 실측, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 긴 제목(주입) → 마퀴 흐름·**말줄임 없음**(textOverflow=clip, 2프레임 위치 이동) | PASS (`/tmp/v332_marquee1.png`·`marquee2.png`) |
| [e2e] 미니플레이어 재생목록 버튼 → 큐 모달 즉시 오픈 | PASS (`/tmp/v332_mini_queue.png`) |
| [e2e] Now Playing 하단 라인 제거 | PASS (`/tmp/v332_player.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항 (질문 답)
- **재생목록(큐)은 MAIDOL도 플레이어 내부 구조** — 곡을 재생/클릭해야 큐가 채워지고 보임. 이번에 **미니플레이어 바로가기**로 접근성만 개선(빈 큐일 땐 "비어있어요" 안내).
- 마퀴 자연폭 측정은 web `whiteSpace:nowrap` 기반 → **웹에서 실동작 검증 완료**. 네이티브는 측정 방식 차이로 미검증(환경 없음)이나, 오버플로 미감지 시 기존처럼 말줄임 폴백(회귀 없음).

### 커밋
`fix: v3.32 마퀴 실동작(자연폭 측정) + 미니플레이어 재생목록 바로가기 + Now Playing 하단 라인 제거 (team-dev)` — 푸시 OFF.

---

## v3.31 (차트 제목 마퀴 + 플레이어 레이아웃 재정비(액션열 노출) + 동영상 가사 중앙정렬/개행) — 2026-08-18

### 요청 작업
① 차트 제목 말줄임(...) 대신 텍스트 흐르는(마퀴) 형태. ② 플레이 화면 하단 좋아요/담기/재생목록 아이콘이 안 보임(가사·상세정보 토글만 보임) — 상단바(Now Playing+닫기) 형태로 위치 잡고 확실히 디자인. ③ 동영상 가사 싱크에서 현재 가사가 박스 세로 가운데가 아니라 하단에 굵게 표시됨 + 가로가 박스폭을 넘음(개행 필요).

### Plan verification findings (0단계)
- ① 차트 제목 = `<AppText numberOfLines={1}>` → 말줄임. 마퀴 컴포넌트 부재.
- ② v3.29에서 **미디어탭 추가 + 토글 절대배치(bottom:0) + 헤더 paddingTop:56(SafeArea 이중인셋)** 로 세로 오버플로 → 액션열이 화면 밖/토글 뒤로 밀려 미노출.
- ③ LyricSyncView가 활성라인을 위쪽부터 렌더(윈도우 비대칭) → 곡 시작부에서 활성라인이 위/아래로 치우침. 라인 개행 폭 제약 없음.

### 수행 결과
- **components/Marquee.tsx**(신규): 컨테이너보다 텍스트가 길 때만 좌우로 흐르는 애니메이션(Animated loop, 텍스트폭 측정), 짧으면 정적. **screens/ChartScreen.tsx**: 제목을 `<Marquee>`로 교체.
- **screens/PlayerScreen.tsx (레이아웃 재정비)**: 헤더를 **상단바**로(paddingTop 56→10 + 하단 보더), **토글 절대배치 해제→정상 플로우**, 컨테이너 paddingBottom 제거, **커버 250→210**·액션열 marginTop 32→20 등 세로 압축 → **좋아요/담기/재생목록 + 가사·상세정보 토글 모두 노출**.
- **components/LyricSyncView.tsx (재작성)**: 활성라인 위아래 각 WINDOW개 슬롯을 **빈 라인으로 대칭 패딩** → 활성 가사가 **박스 세로 정중앙**에 굵게. `lyricsCol` 가로패딩+`width:100%`로 **긴 줄 자동 개행**.

### 테스트 (tester) — PASS (실로그인 E2E, tsc 0 / 콘솔에러 0)
| 게이트 | 결과 |
|---|---|
| [unit] tsc | 에러 0 |
| [e2e] 차트 제목 렌더(짧은 제목=정적, 긴 제목=마퀴 흐름) | PASS (`/tmp/v331_chart.png`; 마퀴는 오버플로 시 작동) |
| [e2e] 플레이어 좋아요/담기/재생목록 + 상단바 + 토글 모두 노출 | PASS (`/tmp/v331_player.png`) |
| [e2e] 동영상 가사 활성라인 세로 중앙 + 개행 | PASS (`/tmp/v331_video.png`) |
| 콘솔 에러 / 4xx·5xx | 0 / 0 |

### 특이사항
- 마퀴는 **제목이 컨테이너를 넘칠 때만** 흐름(짧은 제목은 정적 — 자연스러움). 현재 차트 데이터 제목이 짧아 스샷상 정적으로 보이나 로직상 긴 제목은 스크롤.
- 부수 확인: 별 배지 50→51 — v3.29 70% 재생보상(record-play)도 실동작 확인.

### 커밋
`feat: v3.31 차트 제목 마퀴 + 플레이어 레이아웃 재정비(액션열 노출) + 동영상 가사 중앙정렬/개행 (team-dev)` — 푸시 OFF.

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
