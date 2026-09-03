# TESTPLAN_v3 — 팀: aidol-parity (test-designer)

> 2단계 게이트(1단계 unit·api → 2단계 e2e). 모바일 → E2E는 **Expo Web + Playwright**로 치환.
> 두 위치 동일 비치(2_housing + claude_skills_outputs/team-dev).

---

## v3.105/107 — 2026-08-31 — 핵심 흐름 스모크 6/6 PASS (증적 scratchpad/v3107s_*)

- 작사 직행(+1.2s LyricsLoading, 결과 도달), 휴식 티켓 부재 확인(쿨다운 없음 — 카운트다운은 다음 실작곡 후), ⭐0 사전 차단 다이얼로그·레거시 ⭐10 confirm 문구, Cody 취소→"이어서 만들기" 배너(입력 요약 표시), 화풍 버튼 온전+미니플레이어 숨김+오디오 지속·이탈 시 복원, Map 대기열 잔재 0·update depth 0·콘솔 에러 0.
- ⭐ 소모: 작사 5만(허용분). 미검증 잔여: 휴식 티켓 카운트다운·단축(다음 실작곡 후 확인).

---

## v3.103~104 — 2026-08-31 — 미러링 대응 신규분 E2E — 8/8 PASS (증적 scratchpad/v3104e_*)

- **레거시 폴백 PASS**(구 계정 조립 카드·구 계약 동작·자산 무손상 ⭐26 불변), **신규 멀티 PASS**(가입 보너스 ⭐50 확인, 생성 후 카드 1장 — Mongo characters 1건 실측, 판단① 중복 생성 없음: 잡 결과 cid는 null이지만 잡 단계에서 문서 미생성 구조), 이름·성별 PATCH 반영.
- **슬롯 ⭐15 실과금 PASS**(spend 200 → max_slots 2 → 2번째 생성 → 카드 2장), 개별 삭제 PASS(대표 승계), B-3 목소리 행 PASS(미연결→VoiceManage 유도), 커버 보관함 PASS(그리드·뷰어·미사용 삭제 — 사용 중 삭제 분기는 데이터 없어 BLOCKED), B-4 PASS(구 곡 미표시 정상 + 신규 작곡 body lyrics_source 실림·Mongo 영속), v3.102 제거 확인 PASS.
- 신규 계정 ⭐ 소모: +50 −10 −15 −10 −15 = 0 (전 항목 서버 기록 일치).
- **잔여 버그 [LOW]**: 아티스트 생성 큐~로딩 구간 콘솔 "Maximum update depth exceeded" 1~2회(기능 정상·복구됨) — 픽스 진행 중.

---

## v3.102 — 2026-08-31 — v216 미러링 회귀 스모크 (api) — 전 항목 PASS

- 파괴적 변경 0: 생성(variants·stream variant·VC필드 유지)·커버(cover-sessions/history/refine 라우트)·트랙(my·beats·related·daily·click)·피로도·앨범·계정(consents·profile 왕복)·소셜(feeds·dm·reports)·클로닝(list·availability) 전부 기존 계약 유지.
- **.env MINIO_PUBLIC_HOST 보존 + presign 외부 200 재확인 — CRITICAL 없음.**
- 소멸 3계열(/kits·/voice-convert·/voice-persona) 404 — v216 §5 일치. 대표 확정: 기능 제거 수용(B안).
- 신규: /character/* 전체·cover-sessions. **주의: 레거시 계정은 /character/list가 빈 배열(마이그레이션 미실행, v216 §7-5) — me/save 폴백 필수(v3.103 설계 반영).** me의 character_id=null·characters_count=1.
- B-4: 트랙 응답 출처는 source_meta 단일 키(기존 곡 null 정상).

---

## v3.101 — 2026-08-31 — 보호자 동의 (서버 플래그 OFF — e2e는 플래그 전환 후)

- 실측: guardian-consent 라우트 4종 실서버 존재, `signup-config.guardian_consent_enabled=false`(OFF) — 런타임 플래그 분기 구현. 보호자 연락은 휴대폰(SMS), 착지 웹은 서버측 제공. ⭐ 지급 로직 서버 부재 → 문구 미표기(백엔드 요청 후보).
- [e2e][미실행] PENDING_TESTS §신규 v3.101 (플래그 전환 후)

---

## v3.100 — 2026-08-31 — 직접 음원 업로드 (api 스모크 완료)

- [api] **PASS**: upload 201(id·audio_url)·⭐21→26(+5 보상)·`/upload/image type=cover`로 cover_image_url 갱신(판단 ⑤-1 실서버 확정)·.txt 400
- [e2e][미실행] 업로드 풀플로우·저작권 confirm·커버 반영·is_public=false 차트 미노출

---

## v3.99 — 2026-08-31 — 서버 복구 후 일괄 테스트 실행 (1차 게이트 [api] 완료)

### 인프라 복구
- 재부팅으로 9004·터널 다운 → cloudflared 재기동(신규 주소, .env 갱신·백업 .env.bak-boot-20260831) → 9004 기동 → health 200, 터널 외부 200, Mongo/MinIO/Expo(8081) 정상.

### 1차 게이트 [api] — **전 항목 FAIL 0건 통과** (PENDING_TESTS §1·§2의 api급 전부 실행)
- PASS: v3.89 cover_session_id / v3.90 위시 toggle·check·404 / v3.91 탈퇴(200·400·401)·upload-reference(정상·480s 초과 400)·translate-tags·search/click(Mongo 기록 실측)·원격로깅(frontend.log 유입·?token=·비로그인 401) / v3.92 프로필 이미지(업로드·5MB·타입·DELETE)·consents 왕복·PATCH profile 3종 / v3.93 목록 페이징·404 / v3.94 status 필드·409 무과금 / v3.95 my-affected·appeal 오류경로·dm official 재사용·feeds 200/404 / v3.96 latest·소유권 400·트랙없음 400·**AI 커버 무과금 실측(⭐40→40)** / v3.97 daily / v3.98 kits 모델 실목록(키 설정됨) / **presign 터널 호스트 외부 200(480KB 전량 수신 — Suno 접근 대리검증)**
- BLOCKED(실생성 필요→E2E-B로 이월): v3.93 stream·variant·upload-from-generation·doc 삭제 / v3.94 402·429 / v3.96 앨범 CRUD 체인
- 계약 실측 노트: ① **/character/list 서버 미배포**(v212에도 없음 — B-1 전환은 백엔드 배포 대기) ② profile-image 한도 5MB(프론트 정합) ③ wishlist check 비로그인 401(프론트 스킵 필요 — E2E-C 확인 항목) ④ albums 이미지 URL은 프록시 상대경로(프론트 prefix 렌더 E2E-C 확인) ⑤ _logs context는 object 필수(프론트 정합)
- 계정: teamdev_test2500 ⭐40→35(cover 정상 차감), 일회용 teamdev_del_836175 가입→탈퇴 소멸. 원복: 프로필 이미지·마케팅 동의·위시. 잔존: region=해외·sns 5개·공식 DM 1건 등(테스트 계정 한정).

### 2차 [e2e] — 완료 (2026-08-31)
**E2E-B 작업실 실생성 계열: 8/8 PASS** (증적 scratchpad/v399b_*)
- 참고음악 배선(generate body에 reference_audio_url·audio_weight 실림, ⭐compose 15), 이력·이어보기(21% 재개), A/B 비교→B 저장(tracks.variant_index=1 Mongo 실측·발매보상 +5), 피로도(2h 쿨다운·앱 내 다이얼로그·⭐5 단축 −30분·429 무과금), 비트뷰(85.7BPM 58비트 렌더), 앨범 체인(AI 커버 무료·마지막 트랙 제거 album_deleted), Kits 변환(무과금·MR 프리뷰·병합), **클로닝 문구 28초 도착(무한 스피너 재현 없음 — 인프라 픽스 최종 검증)**. verify 제출은 미실행(사람 목소리 필요).
- BUG-1 발견·수정·재검 PASS: VoiceConvertScreen merge 직후 stale awaiting_merge 폴링이 phase를 되돌림 → mergeRequestedAtRef 30초 grace로 무시. 실레이스(11ms) 재현 하에 grace 로그 발동·완료 화면 자동 전환 확인.
- SKIPPED: 저잔액 402(⭐ 절약), 참고: 서버 duration 판독이 바이트 슬라이스 클립에서 Xing 헤더 기준(무해).

**E2E-C 일반 웹 플로우: 13/13 PASS** (증적 scratchpad/v399c_*)
- linking 회귀 무사(URL 동기화·새로고침 폴백·OAuth 해시 소비), 피드 딥링크/EmptyState, 프로필 이미지 업로드→폴백, 마케팅 동의 왕복, 인구통계(2/30 차단), 회원탈퇴 UI(가사보관함 유지), 소명 탭, 문의 DM 프리필·전송, 차트 일간(+top100 전용 앨범 섹션·커버 실렌더), 위시(게스트 401 노이즈 0), 검색 클릭, 원격 로깅 frontend.log 유입.
- BUG-2 발견·수정·재검 PASS: PlayerScreen didJustFinish 큐 소진 분기가 관련곡 이어듣기 미호출 → autoContinueWithRelated export+로더 주입으로 연결. 재검: PlayerScreen 경로 이어재생·재생바 갱신, 인라인 회귀·repeat 미호출 모두 정상.
- 정책 확인 요망: 비로그인 검색 차단(로그인 유도) — MAIDOL은 허용. 사용자 결정 대기.

**종합: API FAIL 0 + E2E 21/21 PASS(수정 2건 반영), 콘솔 에러·비의도 4xx/5xx 0건.**

---

## v3.98 — 2026-08-29 — 파리티 Wave 8: Kits 음성 변환+MR 피치 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.98.

- [api][미실행] voice-models 503 분기, 변환 시작 400/409
- [e2e][미실행] 변환 폴링→MR 패널(2트랙 프리뷰·피치)→병합→변환본 발매, native wav 캐시 재생
- 회귀[미실행]: 일반 발매 경로(use_voice_converted 미지정) 무영향, dead code getVoiceModels 제거 영향 없음

---

## v3.97 — 2026-08-29 — 파리티 Wave 7: 비트뷰/메트로놈+차트 일간 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.97.

- [e2e][미실행] 비트 토글·폴링·재시도·메트로놈(웹)·곡 전환 성능
- [api/e2e][미실행] /charts/daily 일간 탭, top100 앨범 섹션 회귀

---

## v3.96 — 2026-08-29 — 파리티 Wave 6: 앨범 관리+홈 최신앨범 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.96.

- [api][미실행] latest/생성 소유권 400/마지막 트랙 자동삭제/AI 커버 무과금
- [e2e][미실행] 생성→관리 풀사이클, 홈 섹션→상세→전체재생, 권한 분기
- 회귀[미실행]: UserChannel 앨범 카드 동작 변경(즉시재생→상세 이동) 확인

---

## v3.95 — 2026-08-29 — 파리티 Wave 5: 소명·CS DM·피드 딥링크 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.95.

- [api][미실행] my-affected/appeal(201·409·400), dm/official→conversations, feeds/{id}(404)
- [e2e][미실행] 소명 탭 풀사이클, 문의하기 프리필 DM, 웹 /feed/{id} 착지
- 회귀[미실행]: NavigationContainer linking 첫 활성화 — 웹 라우팅·OAuth 콜백 영향 확인 필수

---

## v3.94 — 2026-08-29 — 파리티 Wave 4: 디렉터 피로/쿨다운 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.94.

- [api][미실행] status 필드/skip 과금·409·402/429 무과금
- [e2e][미실행] 휴식 배지·카운트다운, ⭐5 단축 반복→자동 진행, 429 레이스 복귀, 광고권 조건부 노출
- 회귀[미실행]: v3.91 참고음악·v3.93 이어보기 경로 무영향

---

## v3.93 — 2026-08-29 — 파리티 Wave 3: 생성 이력+variant 비교 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.93.

- [api][미실행] 이력 목록 페이징/삭제(진행중 포함)/variant 스트림 쿼리 토큰/upload-from-generation variant_index
- [e2e][미실행] 재시작 후 이어보기→A/B 비교→선택 저장 풀사이클, 재저장 차단, 실패 환불 문구
- 회귀[미실행]: 신규 생성 기존 플로우·커버 경유 저장

---

## v3.92 — 2026-08-29 — 파리티 Wave 2: 계정 위생 묶음 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 실행 테스트 0건(서버 다운). tsc 0 오류만 확인. 시나리오는 PENDING_TESTS.md §2 v3.92.

- [api][미실행] profile-image 업로드 정상/5MB 초과·타입 400/DELETE 폴백
- [api][미실행] consents GET/POST 토글·롤백
- [api][미실행] PATCH profile 필드별 저장·null 지우기·sns_links 상한
- [e2e][미실행] 아바타 교체 흐름(web/native), 편집 모달 날짜 검증, is_verified 게이트
- 회귀[미실행]: 기존 기획사 정보 편집, v3.91 회원탈퇴 모달

---

## v3.91 — 2026-08-29 — 파리티 Wave 1: 회원탈퇴+저비용 배선 6건 (전 시나리오 미실행 — 서버 다운, PENDING_TESTS 이월)

> 서버(9004) 다운으로 **실행 테스트 0건**. 코드 정적 검증(tsc 0 오류)만 수행. 실행 시나리오는 PENDING_TESTS.md §2 v3.91 참조 — 서버 복구 후 그 목록대로 실행하고 결과를 본 파일에 추기한다.

- [api][미실행] DELETE /auth/me: 정상 탈퇴 200 / confirm_text 불일치 400 / 탈퇴 후 토큰 무효(401)
- [e2e][미실행] 설정→회원탈퇴 전체 흐름(문구 게이트→완료 팝업→로그인 화면·로컬 상태 정리, 가사보관함 유지)
- [api][미실행] upload-reference 정상/8분 초과 400, [e2e][미실행] 참고음악 포함 생성 body 실림 + 실패 분기
- [api][미실행] translate-tags 정상/실패 폴백, [e2e][미실행] 비프리셋 태그 생성 시 영문 변환
- [e2e][미실행] 관련곡 자동 이어듣기(완주→append→재생, repeat/수동 큐 시 미호출)
- [api][미실행] search/click 기록, [e2e][미실행] 실패 무영향
- [api][미실행] 원격 로깅 frontend.log 유입/비로그인 미전송/민감정보 drop
- 회귀[미실행]: 참고음악 없이 일반 생성 정상(A-5 배선이 기존 생성 흐름을 건드림), 큐/반복 기존 동작, 설정 화면 로그아웃 기존 흐름

---

## v3.90 — 2026-08-29 — 위시리스트·드릴다운 (코드 검증만 — 서버 복구 후 실행 이월)

- [unit] tsc 0 → PASS.
- [보류·서버 복구 후] toggle 담기/해제·404 롤백 / check 일괄 하트 복원(로그인·비로그인) / 전체 list→클라이언트 필터·판매종료 처리 / 실데이터 패싯 품질(광고 0이면 샘플 더미) / 위시 탭 선택→코디 적용 E2E(impression 포함).

---

## v3.89 — 2026-08-29 — 커버 refine (코드 검증만 — 서버 다운, 실행 테스트 이월)

- [unit] tsc 0 → PASS. 커밋 ec73d31.
- [보류·서버 복구 후] ①generate-cover 응답 cover_session_id 실존(9004 코드 동기화 여부·openapi) ②refine 정상 흐름(버전 증가·히스토리·이미지 갱신) ③revert 후 refine base 확인 ④revert 후 확정 시 해당 버전 부착 ⑤400/404/타임아웃 에러 경로 ⑥실기기 키보드 가림.
- 함께 이월: v3.88.1(403 스킵) 실화면 확인.

---

## v3.88 — 2026-08-27 — 내 목소리 만들기 실생성 E2E 진단 (근본 원인 확정)

- [e2e] 실클론 생성: 서버 생성곡("쉬었음 청년" 5.5MB 보컬 MP3)로 위저드 전 과정 실행 — create 200(5초) → Suno validate 1차+자동재시도 모두 "Internal Error" → +374초 실패 팝업→1단계 복귀·자동 삭제(v3.87.4 플로우 실전 PASS), 지연 안내 +71초 노출 PASS, ⭐40 불변. 대표 2회 실패와 동일 패턴 → **샘플 무관 확정**.
- [api] **근본 원인**: presigned URL 호스트 `MINIO_PUBLIC_HOST`(.env)가 **구 공인 IP로 잔존** — 현 서버 공인 IP와 불일치. 구 주소 외부 접속 타임아웃, 신 IP 9100도 연결 거부(포트포워딩 소실). Suno가 샘플 다운로드 불가 → generic Internal Error. MinIO 자체는 localhost 정상(200).
- 조치 필요(서버·사용자): ①공유기 9100 포트포워딩 재설정 ②.env MINIO_PUBLIC_HOST 신 IP(또는 DDNS)로 수정 ③9004 재시작 ④외부에서 /minio/health/live 200 확인 후 재시도. (.env 원격 수정은 권한 정책상 차단 — 사용자 조치)
- 증적: scratchpad/v388_e2e.log, v388_e2e_00~06b.png

---

## v3.87 — 2026-08-27 — 위저드 문구·배치 스모크 (전 항목 PASS, 지출 0)

- [unit] tsc 0 → PASS
- [e2e] VoiceManage 버튼 "내 목소리 만들기"(클로닝/문장낭독 0건)·신설 설명 문구 → PASS (`v387_smoke_01`)
- [e2e] 위저드 헤더·"최소 15초 ~ 2분" 힌트 → PASS (`02`)
- [e2e] 배치(y좌표 실측): 이름→샘플→"방금 넣은 샘플은 어떤 음성인가요?"+[노래][말]→구간→[다음: 만들기 시작], 칩 전환 동작 → PASS (`03`)
- [e2e] 콘솔·4xx/5xx 0, ⭐40→40, 만들기 시작 미클릭 → PASS

---

## v3.86 — 2026-08-27 — 이모지 제거 스모크 (14개 화면 스캔, 최종 전부 PASS)

- [unit] tsc 0 · 소스 재스캔 잔존 0(⭐·텍스트 딩뱃·비노출 문자열 제외) → **PASS**
- [e2e] 렌더 텍스트 이모지 정규식 스캔(⭐ 제외): 작업실 맵·MyArtists·ArtistResult·VoiceManage(펼침 포함)·LyricsBook(확장 포함)·작곡 5스텝·마이페이지 = **매칭 0** / 설정 = 💸 1건 검출 → **즉시 픽스 후 0** → **PASS**
- [e2e] ⭐ 배지 유지(맵 ⭐40 등) · 휴지통 벡터 아이콘(Feather trash-2) 렌더+탭→인앱 confirm→취소 정상 → **PASS** (`v386_smoke_08`)
- [e2e] 회귀: 콘솔·pageerror·4xx/5xx 0, 브라우저 dialog 0(v3.85 유지), ⭐40→40 → **PASS**
- 증적 scratchpad/v386_smoke_01~13.
- 기록: 범위 밖 화면(UserChannel·Chart/Search/Playlist EmptyState·AgencyProfile·ArtistDetail·Feed·Player)에 이모지 잔존 — 후속 정리 후보. stores/timerStore.ts의 단계 이모지 데이터는 렌더에서 번호로 대체(데이터 자체는 범위 밖 잔존).

---

## v3.85 — 2026-08-27 — 앱 내 다이얼로그 전면 전환 스모크 (실행 완료 전 시나리오 PASS, window dialog 0건)

- [unit] tsc 0 · 정적 스윕: Alert.alert/window.alert/confirm 직접 호출 잔존 0, showAlert 120곳/29파일 일원화 → **PASS**
- [e2e] 별 부족 안내: DOM 다이얼로그(단일 [확인]) 렌더·닫힘 → **PASS** (`v385_smoke_05`)
- [e2e] 사진 확약(2버튼·취소 좌측): 취소→미진행 / 확인→질문 진입 → **PASS** (`01`)
- [e2e] 보관함 삭제 confirm(destructive 스타일) → **PASS** (`08`)
- [e2e] 설정 캐시 삭제 알림 → **PASS** (`10`)
- [e2e] 기존 ConfirmDialog 회귀(다시 만들기 confirm 1회 렌더, 충돌 없음) → **PASS** (`11`)
- [e2e] 회귀: **window dialog 0건**·콘솔/pageerror/4xx·5xx 0·생성계 POST 0·⭐ 불변(40/5), [appAlert] 로그 1:1 대응 → **PASS**
- 관찰(범위 밖 후보): Settings 로그아웃이 confirm 없이 즉시 실행(SettingsScreen.tsx:222) — 실수 방지 confirm 추가 검토.
- [미검증] 네이티브(iOS/Android) 렌더 — Modal 기반이라 동일 예상, 실기기 확인 권장.

---

## v3.84 — 2026-08-27 — 아티스트 목소리 2택 재편 스모크 (실행 완료 전 시나리오 PASS, 실비용 0)

- [unit] tsc 0 · 구 필드(artistPersonaId 등) 잔존 참조 0(마이그레이션 코드 제외) → **PASS**
- [e2e] VoiceManage 재편: "(사용 가능 상태만 선택돼요)" 부재·현재 목소리 카드·2택([간편]/[내 목소리(노래+문장낭독)])·구 persona 폼 부재 → **PASS** (`v384_smoke_02`)
- [e2e] 간편 만들기: 성별 미기록 힌트·남/여+스타일 6종 칩·여성·허스키 설정→카드 갱신, 서버 mutation 0건(순수 로컬) → **PASS** (`03~06`)
- [e2e] 전파+persist: ArtistResult 표기 갱신·localStorage aidol-voice v1 리로드 유지 → **PASS** (`07`)
- [e2e] 작곡 반영: 보컬 성별/스타일 스텝에 여성·허스키 **기본 선택**(변경 가능 확인), 케이스12 프리셋 안내+건너뛰기, 최종 스텝 정지 → **PASS** (`08~11`)
- [e2e] 해제: confirm→"아직 설정 안 됨" 복귀 → **PASS**
- [e2e] 회귀: 콘솔·pageerror·4xx/5xx 0, 생성계 POST 0(로그인 1건뿐), ⭐40→40, 클로닝 위저드 진입 정상 → **PASS**
- [미검증] 클론 설정 시 배타 교체 실동작(ready 클론 자산 0개 — 실클로닝 후 확인 권장) · persist v0→v1 마이그레이션 실데이터(기존 연결 계정 없음) · 네이티브 런타임.

---

## v3.83 — 2026-08-27 — Voice Clone 위저드 UI 스모크 (실행 완료 전체 PASS, 실비용 0)

- [unit] tsc 0 → **PASS**
- [api] `/voice-clone/list` 200 `{clones:[]}` · `/voice-persona/list` 200 병행 · create required={source_file,voice_name,vocal_start_s,vocal_end_s} · verify skill=beginner/intermediate/advanced/**professional**(MAIDOL의 'pro'는 서버 400 — 교정 이식) 실측 → **PASS**
- [e2e] VoiceManage 만들기 2택([🎤 정식 클로닝 (노래+문장낭독)] + 간편 만들기 공존) → **PASS** (`v383_smoke_02`)
- [e2e] 위저드 1단계: 렌더(이름·녹음/업로드·구간·스타일·단계 dot)·무음 wav 주입·미리듣기 재생·뒤로가기 복귀, create 호출 0건 → **PASS** (`03~07`)
- [e2e] 작곡 케이스12 회귀: 가사 보관함 시드 재사용(비용 0)으로 도달, persona+clone 병행 조회 200, 건너뛰기→최종 스텝 확인 후 정지 → **PASS** (`10·11`)
- [e2e] 회귀: 콘솔·pageerror·4xx/5xx 0, 생성계 POST 0, ⭐40→40 → **PASS**
- 후속 픽스: 1단계 [다음] 버튼이 미충족 시 무반응(disabled)이던 것 → 탭 가능+누락 항목 showAlert 안내로 변경(tsc 0).
- [미검증] create→문구 폴링→verify 실왕복(Suno 실비용 — 실사용 1회 확인 권장) · 네이티브 녹음 · 구간 시작≥끝 가드 알림(코드상 존재, 실클릭 미실행).

---

## v3.82 — 2026-08-27 — 아티스트 UI 정리 스모크 (실행 완료 6/6 PASS, 과금·생성·삭제 0)

- [unit] tsc 0 → **PASS**
- [e2e] 미니플레이어: 곡 재생 상태에서 ArtistResult 진입 시 숨김(focus 로그)+[✨ 꾸미기]가 탭바 바로 위(y 실측: 버튼 843 vs 탭바 905, 사이 공간 없음), 복귀 시 재표시(blur 로그)+타 탭 정상 → **PASS** (`v382_smoke_04·07·10`)
- [e2e] 배지 제거: 목록·상세에 "실사/가상/화풍" 문자열 0건, 카드=썸네일+이름, 상세=이름(·성별) 표시 → **PASS**
- [e2e] [🗑 삭제] 버튼 부재·"다시 만들기" 신문구·confirm 취소 시 DELETE 0건 → **PASS**
- [e2e] 추가 confirm 본문 "⭐15를 사용해 아티스트 슬롯을 추가할까요?"만(kind 단어 0건)·취소·spend 0건 → **PASS**
- [e2e] 성별 첫 질문(1/7 남성/여성 칩+건너뛰기) → 2/7·3/7 정상 진행, 토글 라벨 "🎨 그림 스타일로 만들기" → **PASS** (`12·13`)
- [e2e] 회귀: 잔액 불변(40/5)·spend 0·pageerror 0 → **PASS**
- 후속 픽스: welcome 힌트 "가상 인물" → "아티스트"로 중립화(tsc 0).
- **백로그 기록(v3.82 무관 기존 버그)**: 타인 곡 재생 시 Player가 `GET /generate/{id}` 폴링 → 403+콘솔 에러 1건 — 비소유 트랙은 폴링 스킵 필요.
- [미검증] 성별 로컬 저장→상세 표시 풀사이클(실생성 필요), 미니플레이어 오디오 지속(웹 오토플레이 제약 — UI 기준 검증).

---

## v3.81 — 2026-08-27 — "내 아티스트" 목록 UI 스모크 (실행 완료, 과금·생성 0)

- [unit] tsc 0 → **PASS**
- [api] /points/costs의 extra_slot=15 실측 · /points/history 구조 실측(방어 파싱 일치) → **PASS**
- [e2e] 목록 진입(1명 보유): 맵→디렉터→MyArtists, 카드 1장(썸네일+📷 실사 배지), [＋ 추가 (⭐15)] 노출 → **PASS** (`v381_smoke_01`)
- [e2e] 추가 confirm: "⭐15… 가상(그림) 캐릭터로 만들어져요" 문구 → 취소 → **`/points/spend` 호출 0건** → **PASS** (`02·03`)
- [e2e] 카드→상세: 탭 UI 미존재·kind 배지·[🗑 삭제][✨ 꾸미기] 유지, ‹ → 목록 복귀 → **PASS** (`04·05`)
- [e2e] 미보유 계정(9802b): 게이트 미출현, welcome 3버튼 정상 → **PASS** (`07`)
- [e2e] 회귀: 콘솔·pageerror·4xx/5xx 0, 잔액 40/5 불변 → **PASS**
- **버그 1건(픽스 완료)**: 상세 ‹가 navigate로 목록을 새로 push → 목록↔상세 핑퐁 (ArtistResultScreen.tsx:93) → slotParam 진입 시 goBack(pop)으로 수정, tsc 0.
- [미검증] ⭐15 실과금·forceKind 진입·기구매 무과금 재진입(실과금 금지) · 커버 step1.5 신문구(곡 0곡 미도달) · 핑퐁 픽스 실화면(코드 수정만).

---

## v3.80 — 2026-08-26 — 가상화 캐릭터·화풍 갤러리·슬롯 탭·커버 variant UI 스모크 (실행 완료, ⭐지출 0)

- [unit] tsc 0 → **PASS**
- [api] style-samples 200 + 프리뷰 3종(webtoon/anime/manga90) 200, fetchStyleSamples 모듈 캐시 1회 호출 → **PASS**
- [e2e] 가상화 진입: welcome [🎨 가상화] 토글 on/off/on(재탭 복귀 채팅) → 사진 없이 → 질문 → **화풍 스텝 도달**(3종 카드+업로드+확정) → **PASS** (`v380_smoke_03`)
- [e2e] 화풍 검증: 미선택 확정 차단 alert · 샘플↔업로드 상호 배타 양방향 → **PASS** (`04~06`)
- [e2e] 화풍 확정→ArtistCody 도달("이 옷으로 만들기 ⭐10" 노출, 미클릭 정지) → **PASS**
- [e2e] 실사 회귀: 토글 미선택 시 화풍 스텝 미출현, 기존 흐름 그대로 코디 도달 → **PASS**
- [e2e] 슬롯 탭: [실사화] 활성·선택 / [가상화] 비활성(opacity 0.35) / 하단 [🗑 삭제][✨ 꾸미기] 유지 → **PASS** (`09`)
- [e2e] 회귀: 콘솔·pageerror·4xx/5xx 0, 생성계 POST 0, ⭐40→40 → **PASS**
- [미도달·정상] 커버 step1.5 자동 보정: 계정 곡 0곡이라 "곡이 없어요" 차단 — 코드 분기 확인만.
- [미검증] cartoon-async 실생성·variant:'virtual' 자동저장·가상 슬롯 탭 활성 상태·커버 variant 실전송(⭐비용 — 실기기/사장님 1회 생성 권장).
- 기록: 캐릭터 보유 시 "새 아티스트 만들기" 게이트 도달 동선이 좁음(Map이 캐릭터 확인 후 ArtistResult 직행) — UX 후속 후보.

---

## v3.79 — 2026-08-26 — 가사 보관함·스냅샷·보상픽스·UX 스모크 (실행 완료, 7/7 PASS)

- [unit] tsc 0 → **PASS**
- [e2e] 보관함 진입(빈 상태): LyricsInput 시작 화면 "📓 가사 보관함" 버튼 → LyricsBook 렌더(빈 문구·화살표 1개) → **PASS**
- [e2e] 작사 1회(⭐5 허용)→저장: LyricsResult 도달, **⭐배지 45→40 무리로드 갱신(UX-2)**, "보관함에 저장" 성공 + 재탭 중복 가드 → **PASS**
- [e2e] 재사용: 항목 확장→"이 가사로 작곡하기"→ComposerSelect→작곡 1단계 제목·2단계 가사 실림 확인 후 정지(생성 미실행) → **PASS**
- [e2e] persist: 리로드 후 항목 유지(localStorage 'aidol-lyrics-book' 실측) → **PASS**
- [e2e] 삭제: confirm→목록 제거·빈 상태 복귀 → **PASS**
- [e2e] 이중 화살표 해소(UX-1): ArtistResult·VoiceManage 각 화살표 1개 실측, 복귀 경로 정상 → **PASS**
- [e2e] 회귀: 콘솔 에러·pageerror·4xx/5xx 0, 지출은 허용된 작사 ⭐5 1건만 → **PASS**
- 증적: scratchpad/v379_smoke_00~14.png, v379_smoke.log
- [미검증] user_character_snapshot 실전송·발매 보상 이동 실지급(곡 실생성 필요 — 비용), 아티스트 삭제 버튼 실클릭(실캐릭터 삭제 회피 — 코드 경로는 기존 ConfirmDialog 재사용이라 위험 낮음).

---

## v3.78 — 2026-08-26 — "내 목소리" 파이프라인 UI 스모크 (실행 완료)

- [unit] tsc 0 → **PASS**
- [api] login→`GET /voice-persona/list` 200, `{personas:[]}` 구조 실측·파싱 일치 → **PASS**
- [api] vocal/stream `?token=` 쿼리 인증 지원 실측(무토큰 401→쿼리 403 invalid) → **PASS**
- [e2e] 작곡 흐름→persona 스텝(케이스12) 도달: 새 UI(내 목소리 만들기/관리·건너뛰기·적용) 렌더 + list 200 → **PASS** (`v378_smoke_03`)
- [e2e] VoiceManage 진입/복귀: 만들기 폼(이름+파일+녹음)·빈 목록 렌더, 복귀 후 스텝 유지·재조회 → **PASS** (`v378_smoke_04·05`)
- [e2e] 건너뛰기 회귀: persona 없이 최종 확인 스텝까지 정상 진행, 생성 확정 직전 정지(생성 POST 0건) → **PASS** (`v378_smoke_06`)
- [e2e] ArtistResult "🎤 목소리 연결"→VoiceManage 선택모드 진입/복귀 → **PASS** (`v378_smoke_07·08`)
- [e2e] 회귀: 콘솔 에러·pageerror·4xx/5xx·예상외 dialog 0건 → **PASS**
- [미검증] persona 실생성(Suno 비용+보컬 음원 소스 부재)·미리듣기 실재생·적용 방식 토글(persona 보유 시에만 노출)·persona_id 실전송(정적 검증만) — persona 1개 실생성 허용되는 회차에서 커버 필요.
- 기록: 스모크 중 작사 ⭐5 소모(persona 스텝 도달에 가사 필수) · VoiceManage 이중 뒤로가기 화살표(UX, ArtistResult 경유 시) · 가사 차감 후 헤더 ⭐배지 미갱신(리로드 시 반영) — 경미, 후속 정리 후보.

---

## v3.77 — 2026-08-26 — 가상화 캐릭터 모드 + 커버 variant & v3.76 미검증 실테스트

### Track 1 — v3.76 미검증 실테스트 (⭐ 실비용 허용, 테스트 계정 전용) — 실행 완료
- [e2e] **실생성**: Given 테스트 계정(⭐≥10) When 텍스트-only 생성→코디 확정 Then job 폴링 실관찰(≤15분)·완료 화면·⭐ 잔액 −10 실측 → **PASS** (⭐60→50 실측, job 3분 10초, 5초 폴링 정확, 무신사 착장 object_name 영속 확인. 증적 scratchpad/v376_retest_01~11)
- [e2e] **402/사전체크**: Given 잔액 <10(⭐5 계정) When 코디 확정 Then 시작 전 차단 → **기능 PASS / 웹 안내 FAIL**(버그#2) + 서버 402 직접 확인
- [e2e] **사진 확약 웹 Alert** → **FAIL**(버그#1: RN-web Alert no-op으로 사진 경로 데드엔드)
- [e2e] 콘솔 로그 3종 실출력 → **PASS**
- [미검증 잔존] 생성 실패 시 별 자동 환불 실측(성공해버려 실패 경로 미발생), ArtistLoading 실패 Alert 웹 표시(동일 사유)

### Track 1-fix — 웹 Alert 폴백 픽스 스모크 (재검증 완료)
- [unit] tsc 0 → **PASS**
- [e2e] 별 부족: window.alert("별이 부족해요…⭐5") 발생·차단 유지·POST 0건 → **PASS**
- [e2e] 사진 확약: window.confirm 발생, 거부 시 미진행 / 수락 시 채팅 추가+질문 1/6 진입 → **PASS** (dismiss/accept 양쪽)
- [e2e] 회귀: 콘솔 에러·4xx/5xx 0건 → **PASS** (증적 scratchpad/v376fix_01~07, v376fix_smoke.log)
- [unit] ⭐15 껍데기 과금 차단: 교체 확인 confirm으로 대체, /points/spend 호출 제거 — 코드 확인(tsc 0)

### Track 2 — v3.77 구현 검증
- [unit] tsc 에러 0 (전 파일).
- [unit] characterTaskStore: 신규 4필드 setInput 수용·reset 초기화·기존 화이트리스트 불변.
- [unit] 화풍 상호 배타: preset 선택→styleImage 해제, 역방향 동일.
- [unit] 커버 자동 보정: (real만)→real, (virtual만)→virtual, (둘 다)→선택 카드, (없음)→null.
- [api] style-samples 200·3종·preview 3키 image/png.
- [api] cartoon-async: (텍스트+preset)/(사진+확약+preset)/(사진+style_image) 접수→job done 시 object_name·art_style 확인. style 없이 전송 시 서버 거동 기록.
- [api] save {variant:'virtual', art_style} → /me에 virtual_* 반영 + 실사 필드 무손상. variant:'x' → 400.
- [e2e] 가상 풀 플로우: 가상 진입→텍스트-only→화풍 웹툰→Cody ⭐N→Loading 폴링→Result 가상 탭+화풍 라벨→자동 저장.
- [e2e] 커버 variant: 둘 다 보유 시 선택 카드→재진입 생성 시 선택 슬롯 object_name 전송(`[Cover]` 로그 확인), 한쪽만이면 카드 생략·자동 선택, 미보유 시 스텝 미등장, "아티스트 빼고" 시 미전송, 완료 후 다음 커버에 잔존 없음(회귀).
- [e2e] 회귀: 실사 기존 플로우(v3.76) — 사진 확약·402 문구·자동환불 안내 무변화.

---

## v3.76 — 2026-08-24 — 아티스트 디렉터 MAIDOL 이식 1차

- [unit] tsc 0.
- [api] 9004 실측: /points/costs {character:10} · generate-sheet-async·/character/job/{id}·style-samples(3종)·face-verify(enabled) 존재 확인.
- [e2e] ArtistInput에 '사진 없이 만들기' 버튼 노출 + 텍스트-only 진입 → 질문 진행(1/6→2/6 실측) PASS.
- [e2e] 텍스트-only에서 6문답 전부 생략 시 가드 동작(설명 필요 안내 + 질문 재시작) 실관찰 PASS.
- [e2e] ArtistCody 확정 버튼 '이 옷으로 만들기 ⭐10'(costs 연동) 노출 PASS (`scratchpad/v376_3_cody.png`).
- [미검증] 비동기 job 폴링 실생성(⭐10 차감·수 분 소요 — 실기기/사장님 계정 1회 생성 권장), 402/403 실분기(잔액 조작 필요), 사진 확약 Alert(RN-web Alert 버튼 제약 — 네이티브에서 확인 권장).

---

## v3.75 — 2026-08-24 — 탭 헤더 좌측 타이틀 정정

- [unit] tsc 0.
- [e2e] 탭별 좌측 타이틀 실측: 차트=AIDOL, 플레이리스트/피드/검색=페이지명, 작업실=기획사명(v348 엔터테인먼트) — 전부 x=16 동일 위치 PASS.
- [e2e] 5개 탭 모두 우측 알림·마이페이지(공용 액션) 노출 PASS.
- [e2e] 아이콘 축소 후 작업실 기획사명+ⓘ 잘림 없음(축소 전 잘림 → 후 전체 표시) 스크린샷 비교 (`v375_작업실.png`).

---

## v3.74 — 2026-08-24 — 탭 상단바 통일

- [unit] tsc 0 (pageHeader·MyPageIcon 제거 후에도 통과).
- [e2e] 5개 탭 모두 로그인 상태에서 AIDOL 로고·알림·마이페이지 노출, logoRight=93/actionsLeft=139 완전 동일(390px) PASS.
- [e2e] 로고-우측 액션 간격 46px(390px 기기) — 겹침 없음 → 아이콘 축소 불필요. 360px 기기도 계산상 여백 16px.
- [회귀] 탭 전환·하단바 동작 정상(5탭 순회 중 에러 0건).

---

## v3.73 — 2026-08-24 — 피드작성·새 메시지 타이틀 상단바 위치

- [unit] tsc 0.
- [e2e] 피드작성: 네이티브 상단바에 ✕·'피드 작성'·등록 배치, 타이틀 y=20(다른 페이지 헤더와 동일 위치) PASS (`scratchpad/v373_compose.png`).
- [e2e] 새 메시지 모달: 타이틀 y=14, 높이 56 상단바 규격 헤더 최상단 배치 PASS (`v373_newdm.png`).
- [api] v348b is_verified=false 복구 확인(GET /dm/eligibility → true 전환) — DM 게이트로 모달 진입 불가했던 원인.
- [회귀] 피드작성 버튼 3종(음악 첨부·내 가사 복사·착장 아이템 첨부) 노출 유지 확인(스크린샷).
- [미검증] DmChat·MyReports·차트 검색·PolicySheet의 safe-area 전환 실기기(iOS 노치) 렌더.

---

## v3.72 — 2026-08-24 — 왼쪽 재생 아이콘 제거

- [unit] tsc 0.
- [e2e] 재생 중 상태에서 트랙 행 커버 왼쪽 영역 아이콘 0개, 커버 배지 1개(⏸) 확인 (`scratchpad/v372_playing.png`).

---

## v3.71 — 2026-08-24 — 추천 모달 정리 · 알림/메시지 헤더 · 배지 위치 · 아이템 곡 필터

- [unit] tsc 0.
- [e2e] 추천하기 모달: 이모지 전부 제거·'가입하면' 뒤 개행(3줄) 스크린샷 시각 확인 (`scratchpad/v371_1_invite.png`). ※ ✕ 닫기 글리프는 앱 전역 표준이라 유지.
- [e2e] 알림 화면 타이틀 y=20(상단바 내) PASS, 메시지 화면 타이틀 y=20 PASS + '새 메시지' 버튼 headerRight 노출 PASS (`v371_2_notifications.png`, `v371_3_dminbox.png`).
- [e2e] 피드 재생 배지 rect가 커버 이미지 rect 내부(badge 72~90 ⊂ cover 44~92) PASS (`v371_4_feed.png`).
- [e2e] 아이템 피커: 발매곡 0 계정에서 빈 상태 정상('아직 발매한 곡이 없어요'), 크래시·에러 0건.
- [api] 필터 판별 소스 검증 — 실데이터에서 used_items 보유(쉬었음 청년 3, Cherry Blossom Day 3)/미보유(감정 로봇·But Free·여름의 기억 0) 곡이 갈리는 것 확인 → 필터가 보유 곡만 남김.
- [e2e] 콘솔 에러·4xx/5xx 0건.
- [미검증] 착장 필터 실사용(발매곡 보유 계정 필요 — 사장님 계정 확인 권장), 네이티브 헤더 실기기 렌더.

---

## v3.70 — 2026-08-24 — 커버 재생배지 · 가사 복사 · 착장 아이템 첨부 · 유령 재생 픽스

- [unit] tsc 0 (Image 미임포트 1건 발견→수정 후 통과).
- [e2e] 커버 우하단 18px 재생 배지 렌더 확인(재생 중 ⏸, 정지 ▶ 전환 스크린샷) (`scratchpad/v370_1_feed.png`, `v370_3_closed.png`).
- [e2e] **유령 재생 race 재현 테스트**: 트랙 탭 → 로드 중 300ms 시점에 미니플레이어 ✕ → 6초 대기 후 재생 중 미디어 0개 = PASS. 콘솔에 `[playback] load gen:1` → `invalidate gen:2` 시퀀스 확인(세대 토큰 동작 실증).
- [e2e] 작성 화면 버튼 3종 노출: '음악 첨부'·'내 가사 복사'·'착장 아이템 첨부' ✓. 아이템 피커 열림('착장이 있는 곡 선택' 타이틀) ✓ (`v370_4_compose.png`, `v370_5_itempicker.png`).
- [e2e] 콘솔 에러·4xx/5xx 0건.
- [api] GET /tracks/{id} → cover_character.used_items[] (name/category/image_object_name/product_url) 스키마 확인(아이템 소스).
- [미검증] 가사 클립보드 실복사·아이템 실첨부→피드 카드 렌더(발매곡+착장 보유 계정 필요 — 사장님 계정 실사용 확인 권장), 네이티브(iOS/Android) Clipboard 동작.

---

## v3.69 — 2026-08-24 — 피드 트랙 TrackRow·인라인 토글·가사 불러오기

- [unit] tsc 0.
- [e2e] 피드 트랙 블록 = 차트 동일 TrackRow — **재생수(219)·좋아요(2)·⋮ 표시 실측**(스탯 병합 동작) (`/tmp/v369_feed_row.png`).
- [e2e] 트랙 탭 후 피드 화면 유지(Now Playing 미진입) ✓. '내 가사 불러오기' 버튼 작성 화면 노출 ✓ (`/tmp/v369_compose.png`).
- [api] GET /tracks/{id} lyrics 필드 존재(가사 삽입 소스) 확인.
- [미검증] 재생↔일시정지 토글 실동작(코드 경로 단순 — 실기기 확인 권장), 가사 실제 삽입(발매곡 보유 계정 필요), ⋮ 액션시트 열림(차트와 동일 컴포넌트라 위험 낮음).

---

## v3.68 — 2026-08-24 — FAB 숨김 판정 픽스

- [unit] tsc 0.
- [e2e] 로그인 직후(사운드 미로드): FAB y727 표시 ✓ / 재생 시작 후: 차트·피드 FAB 모두 숨김(null) ✓.

---

## v3.67 — 2026-08-24 — FAB 최종 스펙

- [unit] tsc 0. 유휴: 하단바 위 12px(v3.64에서 y727 실측된 위치) / 재생 중: 렌더 안 함(return null).

---

## v3.66 — 2026-08-24 — FAB 하단바 고정

- [unit] tsc 0. lift 로직 제거 — 유휴 시 하단바 위 6px(v3.65 실측 위치와 동일), 재생 중엔 미니플레이어에 덮임(스펙).

---

## v3.65 — 2026-08-24 — FAB 간격 6

- [unit] tsc 0. 상수 1곳 변경(로직 무변) — 유휴 y733/재생 y663 예상(하단바·미니플레이어 위 6px).

---

## v3.64 — 2026-08-24 — FAB 간격 조정

- [unit] tsc 0.
- [e2e] 유휴: y727(하단바 위 12px) / 재생 중: y657(미니플레이어 위 12px) — 차트·피드 동일 좌표 실측.

---

## v3.63 — 2026-08-24 — FAB 상시 노출 픽스

- [unit] tsc 0.
- [e2e] 유휴: FAB y=719 / **재생 중: y=649(미니플레이어 위로 70px 상승, 겹침 없음)** — 차트·피드 좌표 동일 (`/tmp/v363_chart.png`·`v363_feed.png`).
- [regression] 유휴 상태 위치는 v3.62와 동일(719), FAB 동작 무변.

---

## v3.62 — 2026-08-24 — FAB 위치 통일

- [unit] tsc 0.
- [e2e] 차트 +(곡 추가)와 피드 글쓰기 FAB 좌표 실측 — **완전 동일(x314·y719·56px)** (`/tmp/v362_feed_fab.png`).
- [regression] 차트 FAB 동작(MyMusic 이동)·피드 FAB 동작(FeedCompose) 무변, 미니플레이어 표시 시 양쪽 모두 숨김(조건 통일).

---

## v3.61 — 2026-08-24 — 피드 작성 신설 + 인라인 재생

- [unit] tsc 0.
- [e2e] FAB(연필) → 작성 화면(제목/내용/음악 첨부) 진입 — PASS (`/tmp/v361_compose.png`).
- [e2e] 음악 첨부 → '내 곡에서 선택'(공용 TrackRow=차트 디자인) 모달 + 발매곡 0 계정의 빈 상태("작업실에서 만들기") — PASS (`/tmp/v361_picker.png`).
- [api/e2e] 텍스트 피드 실제 등록 → 목록 최상단 반영("v361 작성 기능 테스트") — PASS (`/tmp/v361_posted.png`).
- [e2e] 피드 트랙 블록 탭 → **화면 이동 없이 즉시 재생, 미니플레이어 등장** — PASS (`/tmp/v361_inline.png`).
- [regression] MiniPlayer next/prev·곡 종료 자동 다음곡은 승격된 공용 loadAndPlayTrack 경유(로직 동일 이동, tsc·수동 경로 확인).
- [미검증] 음악 첨부→트랙 블록 포함 등록(발매곡 보유 계정 필요 — 코드 경로는 blocks에 track_id 추가로 단순), 첨부 곡의 서버측 track 확장 응답.

---

## v3.60 — 2026-08-24 — 피드 무난화

- [unit] tsc 0. PIXEL_FONT·PText·게임창 스타일(2px 테두리·오프셋 그림자·타이틀바) 잔여 0건(grep).
- [e2e] 피드: 시스템 폰트 렌더(computed fontFamily = system), surface1 둥근 카드 — 타 화면과 동일 톤 확인 (`docs/screenshots/feed_plain_design.png`).
- [regression] 카드 폭(v3.49) 유지, 좋아요/댓글 스레드/공유(스타 이벤트 문구)/신고 무변.

---

## v3.59 — 2026-08-24 — '스타' 확정 반영

- [unit] tsc 0. 잔여 '루미/LUMI' 리터럴 0건(grep 전수).
- [e2e] 헤더 배지 → 팝업: '⭐ 스타'·'보유 스타' 노출, '루미'·'내 별'·'별 모으는 법' 부재 — PASS (`/tmp/v359_star.png`).
- [unit] OG 배너 "스타 50 추가 증정"으로 재생성·검수.
- [regression] 402 안내·출석·공유 메시지 문구만 변경(로직 무변).

---

## v3.58 — 2026-08-24 — 루미 리브랜딩·베타 이벤트 공유

- [unit] tsc 0.
- [e2e] 헤더 ⭐ 배지 → 팝업: 제목 '⭐ 루미', 잔액 라벨 '보유 루미', **'별 모으는 법'·'내 별' 문구 부재** 확인 — PASS (`/tmp/v358_lumi.png`).
- [unit] 공유 메시지 3종(초대·내 곡·피드)에 "🎁 베타 테스트 기간 가입 시 루미 50 추가 증정" 라인 포함(코드 검증).
- [unit] OG 배너 1200×630 생성·시각 확인 (`assets/og/beta-event-og.png`).
- [regression] 별 배지 잔액 표시·출석/초대/402 흐름 문구만 변경(로직 무변).
- [미검증] 카톡 등 실제 링크 미리보기에 OG 이미지 노출 — 백엔드 OG 태그 서빙 필요(동결)로 이번 범위 외.

---

## v3.57 — 2026-08-24 — 미니플레이어 숨김·오디오 포커스·벨 판정

- [unit] tsc 0.
- [e2e] 곡 재생 → 미니플레이어 노출 확인 → 설정(모달) 진입 → **미니플레이어 완전 숨김** (`docs/screenshots/settings_no_miniplayer.png`).
- [e2e] 재생 연속성: 설정 조작 포함 구간에서 재생 시간 0:04→0:13 진행(일시정지 아이콘 유지) — **UI 숨김과 무관하게 재생 유지** (사운드는 playerStore 전역 소유 — 코드 검증 병행).
- [e2e] 피드 픽셀 디자인 렌더 재확인 — 게임창 크롬+Neo둥근모 도트체 (`docs/screenshots/feed_pixel_design.png`).
- [unit] 오디오 모드: 재생 4개 진입점이 공통 헬퍼(DoNotMix) 경유 — grep으로 잔여 개별 setAudioModeAsync 없음(녹음용 2곳 제외).
- [미검증] 타 앱 오디오 중단(DoNotMix)·백그라운드 재생·웹 Media Session — **실기기/실브라우저 필요**(헤드리스에선 오디오 포커스 검증 불가). 설정 닫은 후 미니플레이어 복귀는 조건부 렌더 로직상 자명하나 E2E 미확정.

---

## v3.56 — 2026-08-24 — 알림함 인라인 맞팔 버튼

- [unit] tsc 0.
- [api] 사전 상태 확인: 수신 계정에 follow 알림 존재 + is_following=false.
- [e2e] 알림함에서 팔로우 알림 항목 우측 '맞팔하기' 노출 → 클릭 → '팔로잉 ✓' 전환 — PASS (`/tmp/v356_noti.png`, `/tmp/v356_after.png`).
- [api] 클릭 후 GET /follows/summary → is_following=true, follower_count 1→2 — 서버 반영 확인.
- [regression] 비팔로우 알림(댓글)은 기존처럼 시간 표시 유지, 행 탭(채널 이동)과 버튼 탭 이벤트 분리 동작.

---

## v3.55 — 2026-08-20 — 착장 화살표·공유 제거

- [unit] tsc 0.
- [e2e] 착장 탭: 우측 화살표 노출 → 클릭 → 레일 이동 + 좌측 화살표 등장, 끝 도달 시 우측 숨김 — PASS (`/tmp/v355_outfit.png`).
- [e2e] Now playing 액션 행에 '공유' 부재 — PASS.
- [regression] 레일 가로 스크롤·페이지 폭(390=390)·마이뮤직 ⋮ 공유 경로 유지.

---

## v3.54 — 2026-08-20 — 착장 가로 스크롤

- [unit] tsc 0.
- [e2e] 착장 보유 곡(피드 '쉬었음 청년')에서: 가로 스크롤 컨테이너 실측 contentW 536 > visibleW 350(스크롤 성립), 제품 이미지 150px ×3, 페이지 가로 오버플로 없음(scrollW 390=390) — PASS (`/tmp/v354_outfit.png`).
- [e2e/회귀] 착장 없는 곡은 기존 빈 상태 문구 유지 확인.
- [regression] 가사/프롬프트 탭·자세히 보기 버튼 무영향.

---

## v3.53 — 2026-08-20 — 액션 행·시트 오버플로

- [unit] tsc 0.
- [e2e] 액션 아이콘 좌→우 실측 순서 = 좋아요·담기·재생목록·공유·신고, '좋아요' x≥0(잘림 해소) — PASS (`/tmp/v353_player.png`).
- [e2e] 시트 프롬프트 탭 연 상태에서 화면 가로 오버플로 요소 0건, scrollWidth 390 = viewport 390 — PASS (`/tmp/v353_prompt.png`).
- [regression] 재생/시트 탭 전환/픽셀 피드 무영향(스타일만 변경).

---

## v3.52 — 2026-08-20 — 픽셀 폰트(Neo둥근모) 적용

- [unit] tsc 0. neodgm.ttf 유효 TrueType 확인(651KB).
- [e2e] 피드 카드 내 텍스트 5종 computed fontFamily = "NeoDGM" 실측(작성자·시간·제목·본문·트랙 제목) — PASS (`/tmp/v352_feed.png`).
- [regression] 피드 外 화면은 시스템 폰트 유지(적용 범위 피드 한정), 폰트 로드 비차단이라 앱 기동 영향 없음, 콘솔 에러 0.
- [미검증] 네이티브(iOS/Android)에서의 폰트 로드 — expo-font 표준 경로라 리스크 낮으나 실기기 확인 요망.

---

## v3.51 — 2026-08-19 — 피드 카드 2D 게임창(픽셀) 스타일

- [unit] tsc 0.
- [e2e] 피드 카드: 타이틀바 bg 실측 rgb(46,40,80)=titleBg, 밝은 2px 테두리·각진 모서리·우하단 오프셋 그림자·인셋 트랙 칩 렌더 — PASS (`/tmp/v351_feed.png`).
- [regression] 카드 폭(v3.49)·좋아요/댓글/⋯메뉴 구조 무변(스타일만), 콘솔 에러 0.

---

## v3.50 — 2026-08-19 — 피드 카드 톤 다운

- [unit] tsc 0.
- [e2e] 피드 카드 bg 실측 rgba(226,221,240,0.9), 라벤더 카드가 다크 배경과 조화·텍스트 가독 유지 — PASS (`/tmp/v350_feed.png`).
- [regression] 카드 폭 366/390·레이아웃 변화 없음(색만 변경).

---

## v3.49 — 2026-08-19 — Now playing 3탭·기획사 채널·피드 폭/라이트

- [unit] tsc --noEmit 0.
- [e2e] 피드: 카드 폭 366/뷰포트 390(여백 12px/쪽, 이중 여백 해소), 카드 bg rgb(255,255,255) 실측 — PASS (`/tmp/v349_feed.png`).
- [e2e] Now playing 시트: 토글 라벨 "가사 · 프롬프트 · 착장", 탭 3종만 노출·'상세 정보' 부재 — PASS (`/tmp/v349_sheet.png`).
- [e2e] 기획사 클릭 → 채널: 통계 앨범/트랙/팔로워 + 팔로우 버튼 + 곡·앨범/피드/커뮤니티 탭 — PASS (`/tmp/v349_channel.png`).
- [e2e] 앨범 보유 채널(검색→곡→기획사): 앨범 1 통계 + 앨범 카드('앨범테스트', n곡) 노출 — PASS (`/tmp/v349_album_channel.png`).
- [api] `/artists/{id}/albums`·`/albums/{id}`(tracks 포함) 응답 계약 라이브 확인.
- [regression] 피드 좋아요/댓글/⋯메뉴 구조 변경 없음(색·여백만), 채널 피드/커뮤니티 탭 기존 렌더 유지, 콘솔 에러 0(기존재하는 남의 곡 /generate 401 로그 제외 — v3.48 이전부터 존재).
- [미검증] 앨범 카드 탭→앨범 전체 재생(빈 앨범 아닌 실재생 UI), 구형 uploader_id 없는 곡의 AgencyProfile 폴백 경로.

---

## v3.48 — 2026-08-19 — A+B 일괄 검증

- [unit] tsc 0.
- [api/라이브] parent_id 저장·응답 / 알림 follow·feed 팬아웃·comment 실수신 + read-all 2→0 / spend 차감·402·400 / generation_params 남의 곡 수신 / stream-proxy Range=206.
- [e2e] 벨 뱃지+알림함 표시, parent_id·레거시 답글 공존 스레드(마커 미노출), 새로고침 후 로그인 유지(B1), 설정→내 신고 내역 화면(B3).
- [api] WS 핸드셰이크 CONNECTED (websockets 설치 후 — 설치 전 404 재현·원인 확정 포함).
- [regression] 차트/피드/댓글/좋아요/DM 게이트/재생 정상, 콘솔 에러 0.
- [미검증] WS 실이벤트(본인인증 계정), MV 실재생(MV 보유 곡), B6 네이티브 저장(실기기).

---

## v3.47 — 2026-08-19 — 스레드·팔로우 메뉴·여백 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] ⋯ 메뉴(남의 피드): 팔로우+신고 → 팔로우 탭 → '팔로우 중' 전환(follows API 실반영). 내 피드는 삭제 유지.
- [e2e] 답글: '답글' → 배너("…님에게 답글 남기는 중") → 등록 → 부모 아래 들여쓰기+연결선 렌더, [reply:] 마커 미노출, 배너 해제.
- [e2e] 부모 없는 답글/기존 @멘션 댓글 → 최상위 폴백.
- [e2e] 카드 좌우 여백 20 대칭.
- [regression] 좋아요 토글·댓글 작성/삭제·공유·트랙 재생 유지.

---

## v3.46 — 2026-08-19 — 피드/댓글/DM 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 피드 카드: 아바타(프로필 이미지)·상대시간·⋯메뉴·♥/💬/공유 액션바.
- [e2e] 좋아요: 탭 → 카운트 +1·색 활성(API 실반영), 재탭 롤백 경로는 낙관적+실패 롤백 코드로 보장.
- [e2e] 댓글: 열기→작성→목록 표시→'답글' 탭 시 입력창 @멘션 프리필. 시간 "1분 전"(UTC 보정).
- [e2e] DM: 상단바 봉투 아이콘 → 미인증 계정 게이트 문구 표시(정책 일치).
- [regression] 피드 트랙 블록 재생·비로그인 CTA·작성자 채널 이동 유지.
- [미검증] DM 대화·요청 수락/차단 실플로우(본인인증 계정 필요 — API 스키마 대조로 갈음), WebSocket(후속).

---

## v3.45 — 2026-08-19 — 회사 정보 링크·문구·설정 여백 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 푸터: 이용약관/개인정보처리방침/고객센터 3링크 노출(로그인 화면·설정 공통).
- [e2e] 문구: "주식회사 로터스에이아이" 표기, "(주)Lotus AI"·"통신판매업" 문구 부재.
- [e2e] 비로그인 푸터 '이용약관' → 전문 시트 열림/닫힘.
- [e2e] 설정 행 카드 좌우 여백 20px(프로필 카드와 동일, 풀블리드 아님).
- [regression] 설정 메뉴(이용약관·개인정보 처리방침) 동작, 로그인/가입 플로우, 고객센터 mailto(노출 확인).

---

## v3.44 — 2026-08-19 — 회사 정보·약관·생년월일·헤더·OAuth 준비 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 생년월일: 연도/월/일 3칸 모두 화면 내(x+width ≤ viewport), 균등 폭.
- [e2e] 헤더: 비로그인 진입 시 '로그인', 회원가입 전환 시 '회원가입'(설정 표기 없음). 로그인 상태 설정 화면은 '설정' 유지.
- [e2e] 로그인/가입 화면 하단 + 설정 최하단에 사업자 정보((주)Lotus AI·사업자등록번호) 표기.
- [e2e] 설정 > 이용약관 → 전문("제1조 (목적)") 표시, 개인정보 처리방침 → 전문 표시, 닫기 정상.
- [unit/코드] loginWithToken: 토큰 설정→/auth/me→user 세팅, 실패 시 토큰 해제+에러. 웹 훅: #token= 파싱 후 URL 즉시 정리.
- [regression] 이메일 로그인/가입 플로우, 하단바 아이콘(▶/✎), 소셜 버튼 503 안내 유지.
- [미검증] OAuth 실동작(서버 키 미설정 — docs/OAUTH_SETUP.md 절차 완료 후 가능).

---

## v3.43 — 2026-08-18 — 마이뮤직 정렬·아이콘·로그인/가입 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 하단바: 플레이리스트 ▶(play-circle), 피드 ✎(edit-3) 렌더.
- [e2e] 로그인: 라벨(이메일/비밀번호)·"또는" 구분선·소셜 3종(Google 흰색/카카오 노랑/네이버 초록)·회원가입 링크.
- [e2e] 소셜(비활성): When 카카오 탭 Then 503 감지 후 서버 안내 문구(무한 로딩·크래시 없음).
- [e2e] 게이트: 생년월일·내외국인·성별 필수 검증 → 만14세 미만 blocked 문구 → 이전으로 복귀.
- [e2e] 본 폼: 게이트 요약+수정, 기획사명 '엔터테인먼트' 자동 접미, 비번 실시간 힌트 3종·확인 불일치 표시, 추천코드 4자리 제한, 필수 동의 전 가입 버튼 disabled.
- [e2e] 실가입: 신규 테스트 계정으로 consents·gender 포함 payload 제출 → 201 성공(기존 400 버그 해소 확인).
- [regression] 로그인 유도 지점들(navigate('Settings')) 전부 새 패널로 정상 진입, 기존 계정 로그인 동작.
- [미검증] 마이뮤직 곡 목록 실렌더(테스트 계정에 곡 없음 — 코드 레벨 확인), 소셜 활성 상태 플로우(서버 키 미설정).

---

## v3.42 — 2026-08-18 — 빈 상태·CTA·정렬 + 공유/다운로드/신고/프롬프트 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 빈 재생목록: Then 이모지 없이 문구만 노출.
- [e2e] 마이페이지(상단 user 아이콘) 비로그인 → 공용 LoginPrompt(중앙 정렬)와 동일 디자인.
- [e2e] 정렬: 순번 없는 목록은 커버가 행 선두(빈 32px 없음), 차트는 순위 유지.
- [e2e] 플레이어 액션행: 좋아요·담기·재생목록·공유·신고(본인 곡이면 신고 숨김).
- [e2e] 공유 시트: YouTube 쇼츠/릴스/틱톡/링크 복사 4종.
- [e2e] 신고 모달: 비로그인 → 로그인 유도 / 로그인 → 사유 5종(초상권·저작권·성적·욕설·기타), '기타' 선택 시 상세 입력.
- [e2e] 프롬프트 탭: 작곡 프롬프트 + 값이 있는 파라미터만 칩 표시, 남의 곡은 소유자 전용 안내.
- [regression] 차트 순위·⋮ 시트, 검색 모두 담기, 재생/seek/가사 동작 유지.
- [미검증] 다운로드 영상 3종 실제 생성(서버 ffmpeg 1~2분) — 실기기 확인 필요. 신고 제출(되돌릴 수 없어 미클릭).

---

## v3.41 — 2026-08-18 — 순번 비우기 + 카테고리 문구 + 결과 전체 담기 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 검색 순번: Given 검색/느낌 결과 When 행 확인 Then 좌측에 순번 숫자 없음(커버 정렬은 차트와 동일 유지).
- [e2e] 카테고리 문구: Given '운동' 칩 선택 Then 목록 제목이 "운동할 때 듣는 음악"(카테고리명 단독 표기 없음). 검색어 입력 시 "'키워드' 검색 결과".
- [e2e] 모두 담기(비로그인): When '모두 담기' 탭 Then 로그인 CTA 노출(무단 호출 없음).
- [e2e] 모두 담기(로그인): When '모두 담기' → 새 플레이리스트 이름 입력 → 만들기 Then "N곡을 담았어요" 안내, 플레이리스트 목록에 생성, 상세에 곡들이 공용 행으로 표시.
- [e2e] 플레이리스트 상세 ⋮ Then 공용 4항목 + '이 플레이리스트에서 제거' 노출.
- [regression] 차트 순위(1,2,3·NEW·▶) 유지, 행 높이 73px 동일, ⋮ 정상.
- [regression] 마이뮤직: 행이 공용 디자인으로 표시되고 ⋮에 공유·다운로드·차트 업로드(비공개 곡)·삭제 노출.

---

## v3.40 — 2026-08-18 — 곡 목록 행·더보기 메뉴 공용화 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 디자인 동일: Given 차트/검색 각각 곡 목록 When 첫 행 실측 Then 행 높이·패딩·하단 보더·커버 크기·구성 요소(번호/제목/아티스트/재생수/좋아요수/⋮)가 **모두 동일**.
- [e2e] 검색 ⋮: When 검색 결과 행의 ⋮ 탭 Then 차트와 동일한 4항목(재생/좋아요/재생목록에 추가/플레이리스트에 담기) + 곡 헤더 노출.
- [regression] 차트 ⋮ 액션시트 정상 동작(행 클릭으로 오작동 없음), 차트 순위/NEW/▶ 좌측 슬롯 유지.
- [regression] 검색 느낌 칩(이모지 없음)·디폴트 카테고리 로드·로그인 CTA 통일 유지.
- [regression] 검색 행 탭 → 해당 곡 재생(큐 = 검색 결과), 좋아요 상태 동기화 표시.

---

## v3.39 — 2026-08-18 — 담기 팝업 1회 + 검색 칩 이모지·라벨 제거 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 팝업 1회: Given 비로그인 When ⋮→담기(1회차) Then 팝업 노출 → '계속 담기' → When 다른 곡 담기 Then 팝업 미노출.
- [e2e] 영속(핵심): When 새로고침(앱 재시작) 후 다시 담기 Then **팝업 미노출**(guestNoticeAck 영속 확인). (`/tmp/v339_after_reload.png`)
- [e2e] 검색 칩: Then 운동/에너지 충전 등 10종이 텍스트만 표시, 칩 영역 이모지 검출 0.
- [e2e] Then "느낌별 음악" 문구 없음. (`/tmp/v339_search.png`)
- [regression] 칩 탭 시 해당 느낌 곡 로드·운동 디폴트 선택, 결과 헤더에 카테고리명 표시, 로그인 CTA(v3.38 통일) 유지.

---

## v3.38 — 2026-08-18 — 검색 로그인 CTA 통일 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] 디자인 통일: Given 비로그인 When 검색창 포커스 / 플레이리스트 진입 / 피드 스크롤 Then 3화면의 버튼(fontSize·fontWeight·color·width)과 설명문(fontSize·lineHeight·color) 실측값이 **모두 동일**.
- [e2e] 위치 통일: Then 버튼 중심 Y좌표가 3화면 동일(중앙 정렬).
- [regression] 검색 상단 검색창·느낌별 칩 바 유지, 게이트 트리거(포커스/입력) 유지, 로그인 버튼 탭 시 Settings 이동.
- [regression] 콘솔 에러 0.

---

## v3.37 — 2026-08-18 — 별 안내 문구 + 가입 승계 / 로그인 복원 검증

- [unit] tsc --noEmit → 에러 0.
- [unit] 보관·복원 8케이스:
  · 가입: Given 게스트 2곡 When register Then 2곡 승계+보관함 기록
  · 로그인(기존 있음): Given savedQueues[u1]=3곡, 게스트 1곡 When login Then 3곡·인덱스 복원(게스트 목록 대체)
  · 로그인(기존 없음): Then 담아둔 목록 승계+보관
  · 로그아웃: Then 보관 후 큐 비움 / 재로그인 Then 복원
  · 재시작: Then 게스트 빈 큐·소유자 null, 보관함 유지, 재로그인 시 복원(이전 사용자 목록이 게스트에 노출 안 됨)
- [e2e] 담기 팝업 문구: Then "별을 모으면 작업실에서 나만의 음악을 만들 수 있어요" 노출. (`/tmp/v336_notice.png`)
- [e2e] 내 재생목록 배너에 동일 안내 노출. (`/tmp/v336_mylist_guest.png`)
- [regression/e2e] 팝업 2버튼·로그인 화면 미이동·계속 담기 후 목록 표시·2회차 팝업 없음.
- [regression] 드래그 편집, 아이콘 순서(≡→×), 플레이리스트 재생=큐 교체.

---

## v3.36 — 2026-08-18 — 담기 선택 팝업 + 내 재생목록 비회원 개방 + 로그인 시 큐 승계 검증

- [unit] tsc --noEmit → 에러 0.
- [unit] claimQueue/재수화 4케이스: Given 비회원이 3곡 담고 currentIndex=1 When 로그인 Then 큐 3곡·인덱스 보존+소유자 부여 / 회원큐는 재시작 유지 / 비회원큐는 재시작 폐기 / 같은 소유자 재호출 멱등.
- [e2e] 담기 팝업: Given 비로그인 When ⋮→'재생목록에 추가' Then "재생목록에 담을까요?"+경고문+[로그인하고 시작하기]/[계속 담기] 노출, **로그인 화면으로 이동하지 않음**(차트 유지). (`/tmp/v336_notice.png`)
- [e2e] 계속 담기: When '계속 담기' 선택 Then 곡이 담기고 '내 재생목록' 탭에 그대로 표시, "회원 전용" 문구 없음, 상단 안내 배너 노출. (`/tmp/v336_mylist_guest.png`)
- [e2e] ack: When 두 번째 담기 Then 팝업 없이 즉시 담김.
- [regression] 드래그 편집·아이콘 순서(≡→×), 플레이리스트 재생=큐 교체, 로그아웃 시 큐 초기화 유지.

---

## v3.35 — 2026-08-18 — 내 재생목록 회원 전용 게이트 + 플레이리스트 재생=큐 교체 검증

- [unit] tsc --noEmit → 에러 0. mergeAndPlay 참조 전무.
- [e2e] 게이트: Given 게스트(비로그인)가 ⋮로 큐에 1곡 추가 When '내 재생목록' 탭 클릭 Then "회원 전용" 문구+"로그인하고 시작하기" 노출, 큐 곡·"비어있어요" 문구 미노출. (`/tmp/v335_gate.png`)
- [e2e] 게스트 흐름 콘솔 에러 0 (authStore→playerStore import 그래프 무오류).
- [regression/설계] 플레이리스트 곡 탭 → setQueue(교체): 그 플레이리스트가 재생목록이 됨(기존 큐에 누적 안 함). (로그인 필요 → 정적 검증)
- [regression] 로그아웃 시 resetOnLogout로 큐/재생상태 초기화 → 재진입 시 비회원 큐 없음. (로직 단순, 정적 검증)
- [regression] 차트 곡 클릭/‘재생목록에 추가’ 누적, 드래그 편집·아이콘 순서(≡→×) 유지.

---

## v3.34 — 2026-08-18 — 재생목록↔플레이리스트 구분(큐 보존) + 아이콘 위치 교체 검증

- [unit] tsc --noEmit → 에러 0.
- [unit] mergeAndPlay: Given 재생목록 18곡·플레이리스트 5곡(track_id) When 3번째 곡 재생 Then 큐 23곡 보존·선택 인덱스=20·id 정규화. + 중복제외/빈큐/타겟없음 폴백 4케이스.
- [e2e] 재생목록 아이콘 순서: Given 큐 모달 오픈 When 첫 행 확인 Then ≡(순서 변경 손잡이)가 ×(목록에서 제거)보다 왼쪽(handleX<removeX). (`/tmp/v334_queue.png`)
- [e2e/regression] 아이콘 교체 후 드래그: When 첫 핸들 아래로 1칸(CDP 터치) Then reorder 발화·순서 변경·▶ 인덱스 추종.
- [regression] 차트 곡 클릭/‘재생목록에 추가’ 누적 동작 유지, 큐 삭제(×)·곡 클릭 재생 유지.

---

## v3.33 — 2026-08-18 — 마퀴 크로스플랫폼 + 재생목록 드래그 편집 + 차트 '내 재생목록' 탭 검증

- [unit] tsc --noEmit → 에러 0.
- [e2e] Marquee: 차트 top100 응답 첫 곡에 긴 제목 주입 → Given 컨테이너보다 긴 제목 When 렌더 Then 조각 2개(복제본)·textOverflow=clip(말줄임 없음)·1.8초 뒤 좌측 이동. (`/tmp/v333_marquee_a.png`·`_b.png`)
- [e2e] 차트 '내 재생목록' 탭: Given 큐 비어있음 When 탭 클릭 Then "재생목록이 비어있어요"; Given ⋮로 3곡 추가 When 탭 Then 3곡 목록·현재곡 ▶. (`/tmp/v333_mylist.png`)
- [e2e] 큐 드래그 편집: Given 큐 3곡·1번 재생중 When 1번 핸들을 아래로 1칸 드래그(CDP 터치) Then 순서 [1,2]→[2,1] 변경·▶ 인덱스 추종·재생 연속. (`/tmp/v333_touch_after.png`)
- [regression] 마퀴 짧은 제목 정적(말줄임 없음), 큐 곡 클릭 재생/삭제(×), Now Playing 라인 없음 유지.
- 회귀 안전망: reorder 로그 동작 확인(`[DraggableQueue] reorder {from,to}`).

---

## v3.32 — 2026-08-18 — 마퀴 실동작 + 미니플레이어 재생목록 + Now Playing 라인 제거 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 긴 제목(주입) → 마퀴 흐름(말줄임 없음, textOverflow=clip, 위치 이동) | [e2e] | PASS (`v332_marquee1/2`) |
| E2 | 미니플레이어 재생목록 버튼 → 큐 모달 즉시 오픈 | [e2e] | PASS (`v332_mini_queue`) |
| E3 | Now Playing 하단 라인 제거 | [e2e] | PASS (`v332_player`) |
| R1 (회귀) | 짧은 제목 정적(말줄임 없음)·재생/seek/가사싱크 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.31 — 2026-08-18 — 차트 제목 마퀴 + 플레이어 레이아웃 + 동영상 가사 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 차트 제목: 짧으면 정적, 넘치면 마퀴 흐름(말줄임 아님) | [e2e] | PASS (`v331_chart`) |
| E2 | 플레이어 좋아요/담기/재생목록 + 상단바(Now Playing/닫기) + 토글 모두 노출 | [e2e] | PASS (`v331_player`) |
| E3 | 동영상 가사 활성라인 박스 세로 중앙 + 긴 줄 개행 | [e2e] | PASS (`v331_video`) |
| R1 (회귀) | 재생/seek/70%보상/차트클릭재생 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.30 — 2026-08-18 — 웹 seek 실동작(presigned Range 소스) 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | GET /tracks/stream/{id} → presigned, Range 요청 206(Content-Range) | [api] | PASS |
| E1 | 웹 재생 진행(위치 증가 3s→7s) | [e2e] | PASS |
| E2 | 웹 seek 드래그 → 그 지점(3:04)부터 재생 유지(0 리셋 없음) | [e2e] | PASS (`v330_seek`) |
| E3 | web audio = presigned(stream) 소스 사용 로그 | [e2e] | PASS |
| R1 (회귀) | 재생/일시정지/다음·이전·70%기록·가사싱크 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |
| N1 | 네이티브 실기기 seek | [e2e] | 미검증(환경 없음) — stream-proxy로 기존 정상 |

---

## v3.29 — 2026-08-18 — 차트클릭 즉시재생·70%보상·하단토글·음악/동영상 가사싱크 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | POST /charts/record-play · GET lyrics-timeline | [api] | PASS(ok/segments) |
| E1 | 차트 곡 클릭 → 즉시 재생(기존 곡 재생중이어도) | [e2e] | PASS(loadAndPlay 로그) |
| E2 | position≥70% → record-play 1회 + 별 갱신(seek 포함) | [e2e] | 코드/로그 |
| E3 | 하단 가사·상세정보 토글 절대배치 노출 | [e2e] | PASS(`v329_player`) |
| E4 | 노래/동영상 토글 + 동영상=가사 싱크(활성라인) | [e2e] | PASS(`v329_video`) |
| R1 (회귀) | 재생/일시정지/다음·이전·좋아요·재생목록 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.28 — 2026-08-18 — 차트클릭→큐 · seek픽스 · 정보토글 · 플리탭 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | stream-proxy Range 요청 → 206 여부 | [api] | FAIL(200 반환) — 백엔드 블로커 기록 |
| E1 | 차트 곡 클릭 → 플레이어 재생 + 재생목록(큐) 추가 | [e2e] | PASS |
| E2 | 슬라이더 드래그 → seek 값 드래그지점 전달(0 아님, 프론트 리셋버그 해결) | [e2e] | PASS(로그) |
| E2b | 웹 오디오 실제 seek(위치 이동) | [e2e] | 미완 — 백엔드 Range(206) 필요 |
| E3 | 플레이어 가사·상세정보 토글 하단 노출 | [e2e] | PASS (`v328_player`) |
| E4 | 플레이리스트 탭 폴더 아이콘 | [e2e] | PASS (`v328_tabbar`) |
| R1 (회귀) | 재생/일시정지/다음·이전·좋아요 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.27 — 2026-08-18 — 차트 재생수·좋아요수 표시 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 차트 행에 ▶재생수·♥좋아요수 표시(하트 버튼 자리) | [e2e] | PASS (`v327_chart` ▶139 ♥1) |
| E2 | ⋮ → 좋아요 → 행 좋아요수 +1·하트 accent | [e2e] | PASS (`v327_liked` ♥2) |
| R1 (회귀) | ⋮ 액션시트 4항목·재생목록/플레이리스트 구분 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.26 — 2026-08-18 — 차트 클린 리디자인 + MAIDOL 아이콘 + 액션시트 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 차트 행 = 순위/커버/제목·아티스트/♥/⋮ (장르pill·카운트 제거) | [e2e] | PASS (`v326_1`) |
| E2 | ⋮ 더보기 → 액션시트 4항목(재생/좋아요/재생목록에 추가/플레이리스트에 담기) | [e2e] | PASS (`v326_2`) |
| E3 | 재생목록=plus, 플레이리스트=bookmark 서로 다른 MAIDOL 아이콘·라벨 | [e2e] | PASS |
| R1 (회귀) | 행 좋아요 토글·재생·플레이리스트 담기 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.25 — 2026-08-18 — 재생목록(큐) + 다운로드/공유 마이뮤직 이관 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | POST /tracks/download/{id} → download_url(presigned) | [api] | PASS |
| E1 | 차트 곡 행 "재생목록 추가" 버튼 렌더·클릭(토스트) | [e2e] | PASS (`v325_diag`) |
| E2 | 곡 재생 → 플레이어 재생목록 버튼 존재 + 다운로드 버튼 없음 | [e2e] | PASS |
| E3 | 재생목록 모달 — 큐 목록/현재곡 ▶/제거 | [e2e] | PASS (`v325_queue`) |
| E4 | 마이뮤직 내 곡 행 공유/다운로드 버튼 | [e2e] | 부분(본인곡0 계정 → 코드/API 검증) |
| R1 (회귀) | 좋아요/플레이리스트 담기 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.24 — 2026-08-18 — 비로그인 좋아요/담기 로그인 게이트 픽스 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 비로그인 차트 좋아요(♡) 탭 → 로그인 화면(설정) 이동 | [e2e] | PASS (`v324_like_gate`) |
| E2 | 비로그인 차트 담기(+) 탭 → 로그인 화면 이동 | [e2e] | PASS (`v324_add_gate`) |
| R1 (회귀) | 로그인 상태 좋아요/담기 정상(게이트 미발동) | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.23 — 2026-08-18 — 좋아요(likes) 백엔드 실연동 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | POST /likes/{id}(201) · 중복 400 · DELETE · check?song_ids= · list | [api] | PASS |
| E1 | 로그인 후 차트 하트 탭 → ♥(좋아요) 전환 | [e2e] | PASS |
| E2 | 다른 탭 이동 후 차트 복귀 → 좋아요 유지(백엔드 반영) | [e2e] | PASS (`v323_like_persist`) |
| E3 | 좋아요 취소 탭 → ♡ 복귀(삭제) | [e2e] | PASS |
| R1 (회귀) | 미로그인 하트 탭 → 로그인 안내(요구로그인) | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.22 — 2026-08-13 — 로그인 유도 텍스트 3화면 통일 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 플레이리스트 제목 폰트 = 작업실(20px/700/#fff) | [e2e] | PASS |
| E2 | 플레이리스트 설명 폰트 = 작업실/피드(15px/400/#a78bfa) | [e2e] | PASS |
| E3 | 플레이리스트 로그인 화면 룩 = 피드·작업실 | [e2e] | PASS (`v322_1/2`) |
| R1 (회귀) | 각 화면 로그인 유도 노출·버튼 클릭 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.21 — 2026-08-13 — 로그인 버튼 3화면 통일 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 플레이리스트/피드/작업실 버튼 텍스트 박스 크기 동일(128×18) | [e2e] | PASS |
| E2 | 3화면 폰트 동일(16px/700/#fff) | [e2e] | PASS |
| E3 | 플레이리스트 버튼 룩 = 피드·작업실 | [e2e] | PASS (`v321_1/2/3`) |
| R1 (회귀) | 각 화면 로그인 버튼 클릭 → Settings 이동 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.20 — 2026-08-13 — 로그인 오버레이 요소 제거 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 피드 오버레이: "AIDOL 피드"·👥 아이콘 제거 + 설명/버튼 유지 | [e2e] | PASS (`v320_1`) |
| E2 | 작업실 오버레이: 🎵 아이콘 제거 + "AI 음악 작업실"/버튼 유지 | [e2e] | PASS (`v320_2`) |
| R1 (회귀) | 오버레이 트리거·배경 탭 닫힘 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.19 — 2026-08-13 — 피드 로그인 CTA 전체화면 딤드 오버레이 통일 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 초기(액션 전) 오버레이 미노출 | [e2e] | PASS |
| E2 | 스크롤 시 rgba(0,0,0,0.75) 전체화면 오버레이 + 중앙 "AIDOL 피드"·버튼 | [e2e] | PASS (`v319_1`) |
| E3 | 오버레이 배경 탭 → 닫힘(작업실과 동일) | [e2e] | PASS |
| E4 | 팔로워(아바타) 클릭 → 오버레이 등장 | [e2e] | PASS (`v319_2`) |
| R1 (회귀) | 로그인 후 피드 채널이동·재생 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.18 — 2026-08-13 — 피드 로그인 CTA 트리거 전환 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 피드 진입 직후(액션 전) CTA 미노출(고정 아님) | [e2e] | PASS (`v318_1`) |
| E2 | 스크롤 동작 발생 → CTA 등장(콘솔 "스크롤 감지") | [e2e] | PASS (`v318_2`) |
| E3 | CTA ✕ 닫기 → 사라짐 | [e2e] | PASS |
| E4 | 팔로워(아바타) 클릭 → CTA 등장 | [e2e] | PASS (`v318_3`) |
| R1 (회귀) | 로그인 후 피드 채널 이동·트랙 재생 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.17 — 2026-08-13 — 검색 운동 디폴트·게이트멘트 + 피드 하단고정 CTA 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 검색 진입 시 🏃 운동 칩 활성 + 운동 곡 목록 노출 | [e2e] | PASS (`v317_1`) |
| E2 | 미로그인 검색 포커스 → "검색 기능은 로그인 후 이용할 수 있어요"(옛 멘트 제거) | [e2e] | PASS (`v317_2`) |
| E3 | 피드 비로그인 → 하단 고정 "로그인하고 시작하기" 버튼 상시 노출 | [e2e] | PASS (`v317_3`) |
| E4 | 피드 팔로워(아바타) 클릭 → CTA 유지(로그인 폼 미이동) | [e2e] | PASS |
| R1 (회귀) | 로그인 후 느낌칩 탭·검색·피드 채널이동·재생 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.16 — 2026-08-13 — 느낌별음악 가로칩·게이트·검색로딩멘트 + 피드 클릭게이트 + 헤더정렬 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| E1 | 검색 기본 = 느낌별 음악 **가로 스크롤 칩 바**(운동~잠자기) | [e2e] | PASS (`v316_1`) |
| E2 | 미로그인 느낌칩 탭 → 로그인 CTA | [e2e] | PASS (`v316_2`) |
| E3 | 미로그인 검색창 포커스/입력 → 로그인 CTA | [e2e] | PASS |
| E4 | 미로그인 피드 카드 클릭 → 로그인 화면 | [e2e] | PASS (`v316_3`) |
| E5 | 텍스트 검색 로딩 = "최적의 음악을 찾고 있습니다"(스피너 X) | [e2e] | PASS (`v316_5`) |
| E6 | 로그인 후 느낌칩 탭 → 곡 결과 | [e2e] | PASS (`v316_4`) |
| E7 | 차트/작업실 헤더 좌측 타이틀 x 동일(정렬 통일) | [e2e] | PASS (x=16/16) |
| R1 (회귀) | 로그인 후 피드 카드 채널 이동·트랙 재생 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.15 — 2026-08-13 — 피드 소프트게이트·유저채널 + 검색 느낌별음악·게이트 + 작업실 헤더 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc 0 | [unit] | PASS |
| A1 | `/charts/categories`(10종) · `/charts/category/{운동}` 트랙 | [api] | PASS |
| A2 | `/follows/summary/{id}`(follower_count,is_following) · `/feeds/user/{id}?kind=feed|community` · `/artists/{id}(/tracks)` | [api] | PASS |
| E1 | 비로그인 피드: 글 노출 + 하단 "로그인하고 시작하기" + "로그인이 필요해요" 없음 + 개행 | [e2e] | PASS (`v315_1`) |
| E2 | 검색 기본 = 느낌별 음악(운동~잠자기 10칸) | [e2e] | PASS (`v315_2`) |
| E3 | 미로그인 검색 포커스 → 로그인 CTA(검색 차단) | [e2e] | PASS (`v315_3`) |
| E4 | 작업실 ⓘ 엔터명 우측 + 말풍선 제거 + 공유 화살표 아이콘 | [e2e] | PASS (`v315_4`) |
| E5 | 피드 아바타 → 채널(팔로워/음악/피드/공지 탭·팔로우·재생) | [e2e] | PASS (`v315_5`) |
| R1 (회귀) | 별 배지·출석·별팝업(v3.12~14) 정상 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.14 — 2026-08-13 — 피드 게이트/재생 + 다이아 제거 + 작업실 상단바·별팝업 액션 검증

| # | 시나리오 (G/W/T) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 tsc --noEmit 0 | [unit] | PASS |
| E1 | 비로그인 피드 탭 → "🔒 로그인이 필요해요"만, 공개 글(무신사) 미노출 | [e2e] | PASS (`v314_1`) |
| E2 | 로그인 피드 → 제목·본문·트랙카드(커버/제목/아티스트/길이) 노출 | [e2e] | PASS (`v314_2`) |
| E3 | 피드 트랙 탭 → Player 진입 + 재생(0:02/3:58) | [e2e] | PASS (`v314_8`) |
| E4 | 작업실 헤더 💎 없음 + ⭐배지·📅출석·share초대 존재 | [e2e] | PASS (`v314_3`) |
| E5 | 초대 아이콘 = 공유(share-2) | [e2e] | PASS |
| E6 | 별 팝업 = 첫가입~내곡발매만(쓰는곳/작사/풀사이클 삭제) | [e2e] | PASS (`v314_4`) |
| E7 | 별팝업: 남곡듣기→차트 / 내곡발매→작업실 / 친구초대→공유모달 / 출석→출석모달 | [e2e] | PASS (`v314_5/6/7`) |
| R1 (회귀) | 로그인 자동 출석팝업·별 배지(v3.12/13) 정상 | [e2e] | PASS |
| R2 (회귀) | 디렉터 영입/추가 아티스트(무료화 후) 정상 동작·크래시 없음 | [e2e] | PASS |
| R3 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.13 — 2026-08-13 — 별 배지 + 별 안내 팝업 + 아이콘 교체 검증

| # | 시나리오 (Given/When/Then) | 태그 | 결과 |
|---|---|---|---|
| U1 | 전체 프로젝트 `tsc --noEmit` 에러 0 | [unit] | PASS |
| A1 | 실토큰 GET /points/balance → `{balance:number}` | [api] | PASS (`{balance:50}`) |
| A2 | 실토큰 GET /points/costs → lyrics/compose/cover/character/fatigue_skip | [api] | PASS (5/15/5/10/5) |
| E1 | 로그인 후 차트 헤더에 **⭐+잔액 배지** 노출 | [e2e] | PASS (`v313_2` ⭐50) |
| E2 | 별 배지 클릭 → **별 안내 팝업**(모으는 법/쓰는 곳/풀사이클) | [e2e] | PASS (`v313_3`) |
| E3 | 별 안내 팝업 금액이 실 costs 반영(작사5·작곡15·커버5·아티스트10) | [e2e] | PASS |
| E4 | 추천 아이콘 **user-plus(친구초대)** 클릭 → 초대 모달(3YEH) | [e2e] | PASS (`v313_4`) |
| E5 | 작업실 탭 아이콘 **음표(music)** 렌더 | [e2e] | PASS (`v313_6`) |
| R1 (회귀) | 로그인 자동 출석 팝업 정상(v3.12) + 체크인 시 별 배지 동기화 | [e2e] | PASS |
| R2 (회귀) | 콘솔 에러 / 4xx·5xx | [e2e] | 0 / 0 |

---

## v3.6 — 2026-08-13 — AppText 심화 통일 #1 (Settings) 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | Settings tsc 에러 0 | [unit] | PASS |
| U2 | 위계 텍스트 style에서 fontSize/fontWeight/color 제거(토큰화) | [unit] | PASS(제목/섹션/폼) |
| E1 | ⋮→설정 진입, "설정"(AppText) 및 섹션 타이틀 렌더 | [e2e] | PASS |
| E2 | 콘솔 에러 | [e2e] | 0 |
| R1(회귀) | 설정 항목/로그인·회원가입 폼 로직 보존 | [unit] | PASS(로직 미수정) |

---

## v3.5 — 2026-08-13 — 화면 통일 스윕 #2 (색 토큰화) 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | Splash·Agency·ArtistDetail·Settings tsc 에러 0 | [unit] | PASS |
| U2 | 실 하드코딩 HEX(#2a2a3e·#4c1d95·#1e0e4a·레거시레드) 제거 | [unit/정적] | PASS |
| R1(회귀) | 레이아웃/로직/그라데이션 시각 등가(토큰값 근사) | [unit] | PASS(색 참조만 변경) |

주: 순수 색-토큰 스왑이라 렌더 E2E는 다음 통합 스윕에서 일괄 재확인.

---

## v3.4 — 2026-08-13 — 화면 통일 스윕 #1 (MyMusic·Playlist) 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | MyMusic·Playlist tsc 에러 0 | [unit] | PASS |
| U2 | MyMusic 하드코딩 HEX 제거(토큰화) | [unit] | PASS(#2a2a3e·레거시 rgba 제거) |
| E1 | 플레이리스트 탭 → EmptyState+Button 렌더 | [e2e] | PASS |
| E2 | 마이뮤직 탭 렌더 | [e2e] | PASS |
| E3 | 콘솔/네트워크 에러 | [e2e] | 0/0 |
| R1(회귀) | 로그인 후 리스트/성장카드/모달 로직 무변경 | [unit] | PASS(로직 미수정) |

---

## v3.3 — 2026-08-13 — PlayerScreen 리스킨 검증

| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| U1 | PlayerScreen tsc 에러 0 | [unit] | PASS |
| E1 | 차트→트랙 탭→Player 진입, 실화면 렌더(제목/아티스트/컨트롤/액션 AppText) | [e2e] | PASS |
| E2 | "가사·상세정보" 열기 → 탭이 Tag 칩으로 렌더, 콘텐츠 표시 | [e2e] | PASS |
| E3 | 콘솔/네트워크 에러 수집 | [e2e] | 0/0 |
| R1(회귀) | 오디오/슬라이더/셔플·반복/상세시트 로직 무변경 → 동작 보존 | [unit] | PASS(로직 미수정) |

---

## v3.2 — 2026-08-13 — 버그픽스: 재생 지속(중복 사운드) 검증

| # | 시나리오 (Given/When/Then) | 태그 | 결과 |
|---|---|---|---|
| U1 | Given PlayerScreen 수정 / When tsc / Then 에러 0 | [unit] | PASS |
| E1 | Given 앱→차트 / When 첫 트랙 탭해 Player 진입 / Then `Audio` 인스턴스 **정확히 1개** 생성(계측) | [e2e] | PASS(1개) |
| E2 | Given Player 진입 / When routeTrack 효과 / Then 최초 실행 스킵 가드 로그 1회 | [e2e] | PASS |
| E3 | Given Player / When 화면 렌더 / Then "Now Playing" 표시 | [e2e] | PASS |
| R1(회귀) | 곡 전환(prev/next)·미니↔풀 전환 시 사운드 1개 유지 | [e2e] | 설계상 보존(단일 생성 경로) |

주: 헤드리스 오토플레이 차단 → 실제 소리 재생은 미검증. 인스턴스 수(고아 발생)로 핵심 검증. 네이티브 실기기 확인 권장.

---

## v3.1 — 2026-08-13 — Wave 0 (공용 컴포넌트 + ChartScreen 리스킨)

### 1단계 — [unit] / [api]
| # | 시나리오 (Given/When/Then) | 태그 | 결과 |
|---|---|---|---|
| U1 | Given 공용 컴포넌트 9종 / When `tsc --noEmit --strict` / Then 타입에러 0 | [unit] | PASS |
| U2 | Given ChartScreen 리스킨 / When 프로젝트 tsc / Then ChartScreen·ui 에러 0 (전체 0) | [unit] | PASS |
| U3 | Given 컴포넌트 스타일 / When 코드 검사 / Then 원시 HEX·매직넘버 없이 토큰만 사용 | [unit] | PASS(신규 ui 토큰화) |
| A1 | Given 9004 / When `GET /api/charts/top100` / Then 200 + 트랙 배열 | [api] | PASS(실데이터 렌더 확인) |
| A2 | Given 9004 health / When `GET /api/health` / Then 200 | [api] | PASS |

### 2단계 — [e2e(web)]
| # | 시나리오 | 태그 | 결과 |
|---|---|---|---|
| E1 | Given Expo Web 부팅 / When 앱 로드 / Then 번들 성공(797모듈)·HTTP 200·마운트 | [e2e] | PASS |
| E2 | Given 앱 화면 / When "차트" 탭 클릭 / Then ChartScreen 렌더(칩 필터+랭킹 리스트) | [e2e] | PASS(clicked:차트) |
| E3 | Given ChartScreen / When 실데이터 로드 / Then 랭킹곡·장르칩·재생수 표시 | [e2e] | PASS(TOP100 10곡+) |
| E4 | Given 렌더 / When 콘솔·네트워크 수집 / Then 콘솔 에러 0·4xx/5xx 0 | [e2e] | PASS(ERRORS 0) |
| E5(증적) | 스크린샷 저장 | [e2e] | /tmp/aidol_boot.png, /tmp/aidol_chart.png |

### 회귀 [regression]
| R1 | 기존 창작 플로우(맵/작사/작곡) 화면 — 웹 번들에 포함·컴파일 성공(전체 tsc 0, 번들 성공) | [e2e] | PASS(간접: 전체 번들·타입 0) |

> 주: R1 개별 화면 클릭 회귀는 Wave 1 이후 화면 추가 시 확대. 현재 ChartScreen 외 화면 미변경.

---

## v3.124/v225 (2026-09-01)

1. [e2e] 기선택 배지 — Given 꾸미기 진입·상의 픽 후 재오픈 / Then 해당 카드 최상단 + 강조 테두리 + "✓ 선택됨" 배지, 첫 오픈 시 배지 없음
2. [api] v225 프롬프트 실생성 — Given 신규계정(⭐50) / When cartoon-async(webtoon, top/bottom object_name) / Then job done·⭐10 차감·Step A/B 로그 정상 (format placeholder 오류 없음)
3. [unit] tsc·py_compile 통과
4. [수동/후속] 의상 충실도 체감 — 대표 재생성 시 실물 대비 색상·패턴·로고 유지 확인 (정성 판정)

---

## v3.125/v226 (2026-09-01)

1. [unit] py_compile + 템플릿 .format() 검증(실사=step1_answer, 만화=+art_style) + tsc
2. [api] 로고 실생성 — Given 신규계정 / When KODAK 빅그래픽 티(top_object_name)로 cartoon-async / Then job done·⭐10 차감·로고 철자/도안/위치 재현
3. [회귀] v225 색상·실루엣 재현 유지 (동일 생성물에서 확인)

---

## v3.126/v227 (2026-09-01)

1. [unit] py_compile·템플릿 format·tsc
2. [api] 동일 실패 케이스 재생성 — Given 신규계정 / When 나선 반바지(대표와 동일 object)+manga90 / Then 나선1+별표2가 한쪽 다리에만, 반복 패턴 없음, 고무줄 허리
3. [회귀] 상의 로고(PMO 데이지) 재현 유지, 레깅스 금지 규칙 유지(참조 無 분기 원문 보존)

---

## v228 (2026-09-02)

1. [unit] py_compile·템플릿 format·override 블록 brace-free 검증
2. [api] 만화 경로 — Given 신규계정 / When cartoon-async(webtoon+상의 참조) / Then 서버 로그 "calling Claude ... Claude text ok" + job done
3. [api] 실사 경로 회귀 — Given 신규계정 / When generate-sheet-async(텍스트-only+상의 참조) / Then job done·⭐10 차감
4. [수동/후속] 실사+사진 첨부 시 REALISTIC OVERRIDE 체감(미화 억제) — 대표 실사용 확인

---

## v3.127/v229 (2026-09-03)

1. [api] B-7 — /wondera/* 호출 → 503 wondera_disabled
2. [api] B-2 — /lyrics CRUD 풀사이클(201→목록→PATCH→DELETE→404) + generate save:true → lyrics_id 반환·목록 반영
3. [api] B-12 — structure/english_ratio/has_rap/duration 4분 포함 실작사 → 200·rap 태그·영어 포함
4. [api] B-13 — 원본사진 2회 업로드 → 경로 상이 + characters 유령 문서 0
5. [e2e] B-2/B-7 — 로그인→작사 디렉터→가사 보관함(서버 항목 표시)→이 가사로 작곡하기→Wondera 미노출·선택 화면 스킵·작곡 진행 1/13 착지(제목 자동 주입)
6. [unit] tsc·py_compile 전건
7. [보류] B-6 지급 훅 — 플래그 OFF(실SMS 부재)라 E2E 불가, 코드 준비 완료 / B-8 — 서버 기구현, AWS 후 콜백 등록+광고 화면 재구축
