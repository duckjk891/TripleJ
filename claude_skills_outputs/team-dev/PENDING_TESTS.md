# PENDING_TESTS — 서버 복구 후 일괄 실행할 미실행 테스트 로그

> 서버(100.127.225.55) 다운 기간(2026-08-28~) 중 코드만 선행한 작업들의 테스트 대기 목록.
> 서버 복구 시 이 파일 순서대로 실행하고, 결과를 TESTPLAN_v3.md에 기록 후 항목을 지운다.
> 규칙: 새 작업이 코드만 끝나면 반드시 여기 항목 추가 (버전·검증 방법·필요 조건 명시).

## 0. 서버 복구 직후 인프라 (테스트 전 선행)

- [ ] SSH(2222)·Tailscale 접속 확인, WSL 서비스 기동 상태 점검
- [ ] cloudflared 터널 재기동(주소 갱신) → `.env` MINIO_PUBLIC_HOST 갱신 → 9004 기동 → `/api/health` 200
  - 참고: 터널은 임시. 물리 접근 가능 시 관리자 PowerShell로 portproxy+방화벽 9100 → `.env`를 공인 IP로 복원(`.env.bak-tunnel-20260828`)
- [ ] presigned URL 외부 접근 200 확인 (Suno 다운로드 경로)
- [ ] Expo 웹(localhost:8081) 기동 확인

## 1. 이월분 (서버 다운 전 코드 완료)

### v3.87.x 클로닝 (커밋 d599132~1ca83fb)
- [ ] [e2e·실비용] 내 목소리 만들기 풀사이클: 노래 샘플 → **문구 도착**(인프라 픽스 후 첫 검증) → 문구 낭독 verify 제출 → ready
- [ ] [e2e] 분석 실패/타임아웃 시 팝업→1단계 복귀+클론 자동삭제 재확인(성공 케이스와 병행)

### v3.88.1 (커밋 b9f81fd)
- [ ] [e2e] 타인 곡 재생 시 `/generate/{id}` 호출 0건·콘솔 403 에러 없음 / 내 곡은 정상 조회

### v3.89 커버 refine (커밋 ec73d31)
- [ ] [api] generate-cover 응답에 cover_session_id 포함되는지(서버 코드 동기화·openapi 확인)
- [ ] [e2e] refine 적용→버전 증가·이미지 갱신 / 버전 내비게이션 / revert 후 refine base 확인 / revert 후 확정 시 해당 버전 부착
- [ ] [e2e] 오류 경로(400 빈 프롬프트·404 세션·타임아웃) showAlert+기존 버전 유지
- [ ] [실기기] refine 입력 키보드 가림 여부

### v3.90 위시리스트·드릴다운 (커밋 070446d)
- [ ] [api] toggle 담기/해제·404 롤백 / check 일괄 하트 복원(로그인·비로그인)
- [ ] [e2e] 위시 탭 목록→선택→코디 적용 E2E(impression 포함) / 판매종료 배지 / 실데이터 5단계 패싯 품질

### 기타 이월 (기존 TESTPLAN 미검증 잔여)
- [ ] persona 간편(구 노래만) 자산 재생·선택 회귀 / 프리셋↔클론 배타 교체 실동작(클론 ready 후)
- [ ] 가상 캐릭터 실생성(⭐10) → 목록 2카드·상세 표시 / ⭐15 아티스트 추가 실과금 플로우
- [ ] 성별 답변→저장→상세 표시 풀사이클
- [ ] user_character_snapshot 실전송·발매 보상 이동 실지급(곡 실생성)
- [ ] **백엔드 B-1(v212) 연동 착수**: openapi 실측 → /character/list 스키마 확인 → 프론트 N명 체제 전환 작업 시작 (별도 개발 건)
- [ ] `/notifications/*`·`/points/spend` 서버 실존 확인(로컬 스냅샷에 없음 — backend 브랜치 확인)

## 2. 파리티 이식 신규분 (2026-08-29~ 코드 선행, 아래에 버전별 추가)

### v3.91 — 회원탈퇴 + 저비용 배선 6건 (코드만 완료, tsc 0)
- [ ] **회원탈퇴** [api] 테스트 계정 로그인 → `DELETE /auth/me {confirm_text:"회원탈퇴"}` 200 `{message}` / 오문구 400 / 탈퇴 후 기존 토큰 GET /auth/me 401. [e2e] 설정→회원탈퇴: 문구 불일치 시 버튼 비활성·400 인라인 에러 → 성공 시 완료 팝업 후 로그인 화면, 아티스트 목소리·프로필 초기화, **가사보관함은 유지** 확인. ※ 반드시 새 테스트 계정으로(기존 teamdev 계정 소진 금지)
- [ ] **참고음악 업로드** [api] `POST /generate/upload-reference/`(field=file) mp3<8분 → upload_url/duration_sec; 8분 초과 400. [e2e] 참고 파일 선택→작곡 → generations doc에 reference_audio_url/audio_weight 실림; 업로드 실패 시 "참고 없이 진행할까요?" 양 분기(중단/진행) 동작
- [ ] **태그 번역** [api] `POST /generate/translate-tags {tags:["몽환적이고 신나는"]}` → translated 영문. [e2e] 비프리셋 직접입력 장르로 생성 → [Suno] 로그에 번역 적용·generate body 영문 태그; 번역 실패 시에도 생성 진행(원문 폴백)
- [ ] **관련곡 이어듣기** [e2e] 큐 1곡 재생 완주(반복 off) → related 1곡 자동 append·이어재생, exclude로 중복 없음; repeat all/one·수동 큐 잔여 시 related 미호출
- [ ] **검색 클릭 로깅** [api] `POST /tracks/search/click {q,track_id}` 후 서버측 기록 확인. [e2e] 검색 결과 탭(로그인/비로그인) — 실패해도 재생 무영향
- [ ] **원격 로깅** [api] 로그인 상태 콘솔 error → `backend_9004/logs/frontend.log` 유입; 비로그인 시 요청 미발생; 토큰 문자열 포함 로그 drop 확인

### v3.92 — 계정 위생: 프로필 이미지·마케팅 동의·인구통계 편집 (코드만 완료, tsc 0)
- [ ] **프로필 이미지** [api] 정상 jpg 업로드 → profile_image 반영·즉시 렌더 / 6MB·비허용 타입 400 → showAlert / DELETE → 이니셜 폴백·재로그인 후에도 null 유지
- [ ] **마케팅 동의** [api] 무이력 계정 GET → 스위치 off 노출; 토글 on → POST 후 재조회 agreed=true; 서버 오류 시 롤백+팝업
- [ ] **인구통계 PATCH** [api] 생년월일 null 지우기·region '해외'·sns_links 5개 저장 후 GET /auth/me 일치; 6개째 URL 추가 버튼 숨김
- [ ] [e2e] web/native: 설정→아바타 탭→사진 선택→스피너→반영; 편집 모달 월=2·일=30 인라인 에러로 저장 차단
- [ ] [e2e] 본인인증 계정(is_verified) 생년월일·성별 입력 비활성 + PATCH 페이로드 미포함
- [ ] 회귀 [e2e] 기존 기획사 정보(회사명/직함/bio) 편집·저장, v3.91 회원탈퇴 모달 정상 동작

### v3.93 — 생성 이력 + 2-variant 비교 (코드만 완료, tsc 0)
- [ ] [api] GET /generate/?page=1&limit=20 — generations/pagination 형태·created_at desc
- [ ] [api] DELETE /generate/{id} — processing 상태에서도 200
- [ ] [api] GET /generate/{id}/stream/?variant=1&token=<jwt> — 헤더 없이 200 오디오
- [ ] [api] POST /tracks/upload-from-generation variant_index=1 — 트랙 오디오=variants[1]·result_track_id 역기록
- [ ] [e2e] 작곡 시작→앱 재시작→작업실 "생성 이력"→진행중 이어보기→완료→버전 A/B 각각 재생→B 선택 저장→마이뮤직에서 B 클립 재생
- [ ] [e2e] 발매됨 항목 재진입 시 저장 버튼 "저장 완료" 고정(중복 트랙 방지) / 실패 항목 탭→사유 팝업(⭐ 환불 문구)→삭제
- [ ] 회귀 [e2e] 신규 생성 정상 플로우(참고음악 포함 v3.91 경로), 커버 경유 저장에 variant_index 실림

### v3.94 — 디렉터 피로/쿨다운 (코드만 완료, tsc 0)
- [ ] [api] GET /fatigue/status 필드(ladder/skip_point_cost:5/skip_minutes:30/skip_wait_count) 확인
- [ ] [api] POST /fatigue/skip points — ⭐5 차감·30분 단축; 쿨다운 없음 409 무과금; 별<5 402; 광고권 0장 ad→no_skip_tickets
- [ ] [api] 쿨다운 중 POST /generate/ 429 director_fatigue + Retry-After, ⭐잔액 불변
- [ ] [e2e] 곡 완성 후 작곡 재진입 → 휴식 배지·카운트다운·오늘 완성 곡수 일치
- [ ] [e2e] 쿨다운 중 생성 시작 → 앱 내 다이얼로그 → ⭐5 단축 반복 → 0 도달 시 자동 진행
- [ ] [e2e] MusicLoading 429 레이스 → 다이얼로그, 돌아가기=복귀, 실패 화면 미진입·미차감
- [ ] [e2e] 광고권 보유 시에만 광고권 버튼 노출·차감
- [ ] 참고: Wondera 생성 경로는 서버 피로 게이트·과금 없음(파리티 사각) — A-7 작업 시 결정
