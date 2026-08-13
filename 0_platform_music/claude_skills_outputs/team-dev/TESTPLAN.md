# TESTPLAN.md — platform-music-hmr

- 버전: v172 (planner PLAN.md v172 기준)
- 작성일: 2026-08-11
- 작성: test-designer (설계만, 실행은 tester 담당)
- 대상 변경: vite `server.watch.usePolling: true` + `interval: 1000` 도입
  - 적용 파일: `frontend/vite.config.js`(포트 4000), `frontend_admin/vite.config.js`(포트 4001)
  - 배경: WSL2 `/mnt/d`(drvfs)는 inotify 미지원 → 파일 변경 이벤트 미발생 → HMR 불능. 폴링 감시로 전환.

## 전제 / 공통 픽스처

- 개발 서버: 자체서명 HTTPS. `https://localhost:4000` (사용자 앱), `https://localhost:4001` (관리자 앱). curl 검증 시 `-k` 필요.
- 백엔드: 9005 인스턴스 기동 상태 (`/api` 프록시 대상, `ws: true`).
- 로그 파일: frontend-dev가 재시작 후 `/tmp/claude-1000/vite4000.log`, `/tmp/claude-1000/vite4001.log` 에 남김. 로그 수준 검증은 이 파일 tail 기준.
- 폴링 간격이 1000ms이므로 "즉시 반영" 기대치는 **저장 시점부터 최대 ~1초(폴링 1주기) + HMR 적용 시간**으로 해석. 경계 판정은 2주기(~2.5초)까지 허용.
- 계정이 필요한 화면은 플레이스홀더 사용: `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`, 관리자 `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD`. 실값 기재 금지.
- **정리(cleanup) 절차 (필수)**: B/C/D/E 는 실제 src·config 를 건드리는 파괴적 시나리오다. 모든 마커 문자열·신규 파일·config 수정은 **해당 시나리오 종료 시 즉시 원복**한다. 전체 테스트 종료 시 `git status` 로 테스트 유래 변경이 0건임을 확인한다 (vite.config.js 의 v172 본변경만 잔존해야 함).
- 레벨 태그 해석:
  - `[unit]` = 설정 파일·프로세스·로그 파일 수준 검증 (브라우저/HTTP 불필요)
  - `[api]` = curl 등 HTTP/WS 핸드셰이크 수준 검증
  - `[e2e]` = 브라우저 실사용자 여정 (핵심·회귀만 최소 수량)
- 1단계([unit]/[api]) 실측 기준선 (20/20 PASS, 참고치): HMR 감지 0.95s(4000) / 0.11s(4001), config 변경 재시작 0.64~0.94s, idle CPU 2.63%(4000) / 0.71%(4001). E2E 판정 시 이 수치를 상한 참고로 사용.

## E2E 실행 전제 (확정)

- 실행기: playwright 는 `frontend/node_modules` 의 설치본을 사용한다. 브라우저는 chromium **headless shell** + `LD_LIBRARY_PATH` 에 스크래치패드 libs 추출본 지정 — 시스템 chromium 공유 라이브러리 누락 환경이기 때문.
- 자체서명 HTTPS 이므로 `ignoreHTTPSErrors: true` 필수.
- 증적: 시나리오별 스크린샷 필수. B-1/C-1 은 **마커 반영 전/후 2장**.
- 계정: `TEST_ADMIN_EMAIL` 등 플레이스홀더만 사용. 실값(이메일·비밀번호) 기재 금지.

---

## A. 폴링 설정 자체 검증 (config/기동)

### A-1. frontend 설정값 존재 [unit] — 정상
- Given: `frontend/vite.config.js` 파일
- When: `server.watch` 블록을 확인하면
- Then: `usePolling: true` 와 `interval: 1000` 이 존재한다. 기존 `port: 4000`, `host: '0.0.0.0'`, https 조건부 블록, `/api` proxy 설정은 변경 없이 유지된다.

### A-2. frontend_admin 설정값 존재 [unit] — 정상
- Given: `frontend_admin/vite.config.js` 파일
- When: `server.watch` 블록을 확인하면
- Then: `usePolling: true` 와 `interval: 1000` 이 존재한다. 인증서 사이드카 폴백 로직(`./certs` → `../frontend/certs`)과 proxy 설정은 변경 없이 유지된다.

### A-3. 기동 로그 클린 [unit] — 정상
- Given: frontend-dev 가 두 서버를 재시작해 로그를 남긴 상태
- When: `/tmp/claude-1000/vite4000.log`, `vite4001.log` 의 기동 구간을 확인하면
- Then: `VITE vX ready` 배너와 `[vite] HTTPS enabled` 가 출력되고, watch/폴링 관련 경고·에러(예: `EMFILE`, `ENOSPC`, watcher error)가 없다.

---

## B. frontend(4000) HMR 실반영

### B-1. src 수정 → 브라우저 실반영 [e2e] — 정상 (핵심 여정, planner 항목 1)
- Given: 브라우저로 `https://localhost:4000` 접속, 화면에 보이는 텍스트가 있는 페이지를 연 상태
- When: 해당 텍스트를 렌더링하는 src 컴포넌트 파일의 문구를 고유 마커 문자열로 수정·저장하면
- Then: 서버 재시작·수동 새로고침 없이 약 1초 내(허용 ~2.5초) 화면 문구가 마커로 바뀐다. 페이지 전체 리로드(흰 화면 깜빡임/네트워크 문서 재요청)는 발생하지 않는다.
- 종료 조건: 마커 원복 후, 최종 `git status` 로 테스트 유래 변경 0건 재확인.

### B-2. hmr update 로그 기록 [unit] — 정상
- Given: B-1 과 동일한 수정 직후
- When: `/tmp/claude-1000/vite4000.log` tail 을 확인하면
- Then: 해당 파일 경로가 포함된 `hmr update` 라인이 저장 시점 기준 ~1초 내 타임스탬프로 기록된다.

### B-3. 폴링 간격 경계값 [unit] — 경계
- Given: 4000 서버 기동, 로그 tail 감시 상태
- When: src 파일을 1회 수정·저장하고 로그의 `hmr update` 출현까지의 시간을 측정하면
- Then: 1주기(1초) 이내가 표준, 2주기(2.5초) 초과 시 실패로 판정한다. (폴링 특성상 0초 반영은 기대하지 않음)

### B-4. 연속 저장 (빠른 다중 수정) [unit] — 경계
- Given: 4000 서버 기동 상태
- When: 동일 src 파일을 1초 이내 간격으로 3회 연속 다른 내용으로 저장하면
- Then: **마지막 저장 시각 이후** `hmr update` 라인이 로그에 존재하고, 에러·서버 크래시·재시작이 없다. (최종 내용으로의 화면 수렴 확인은 B-1 마커 검증으로 갈음)

### B-5. CSS 수정 → 스타일만 갱신 [unit] — 정상
- Given: 4000 서버 기동 상태
- When: src 내 css(또는 스타일 파일)를 수정·저장하면
- Then: 로그에 해당 css 파일의 `hmr update` 가 기록되고 `page reload` 라인이 아니다(전체 리로드로 강등되지 않음).

---

## C. frontend_admin(4001) HMR 실반영

### C-1. admin src 수정 → 브라우저 실반영 [e2e] — 정상 (핵심 여정, planner 항목 2)
- Given: 브라우저로 `https://localhost:4001` 접속, 관리자 첫 화면(로그인 화면 등 비인증 노출 영역)이 보이는 상태
- When: 그 화면의 문구를 렌더링하는 admin src 파일을 고유 마커로 수정·저장하면
- Then: 재시작·수동 새로고침 없이 약 1초 내(허용 ~2.5초) 화면에 마커가 반영된다.
- 종료 조건: 마커 원복 후, 최종 `git status` 로 테스트 유래 변경 0건 재확인.

### C-2. admin hmr update 로그 [unit] — 정상
- Given: C-1 과 동일한 수정 직후
- When: `/tmp/claude-1000/vite4001.log` tail 을 확인하면
- Then: 해당 파일의 `hmr update` 라인이 ~1초 내 기록된다.

---

## D. 신규 파일 추가/삭제 감지 (planner 항목 3)

### D-1. 신규 파일 추가 감지 [unit] — 정상
- Given: 4000 서버 기동 상태
- When: src 하위에 신규 모듈 파일(간단한 export 상수)을 생성하고, 기존 컴포넌트에서 import 하도록 수정·저장하면
- Then: 로그에 두 파일 관련 `hmr update` 가 기록되고 `Failed to resolve import` 류 에러가 없다.
- 비고: 신규 파일의 브라우저 실반영 확인은 별도 e2e 없이 B-1 절차로 갈음한다 (planner 검토 반영, 舊 D-2 삭제).

### D-3. 파일 삭제 감지 [unit] — 정상
- Given: D-1 에서 추가한 신규 모듈이 반영된 상태
- When: 먼저 import 구문을 제거·저장하고, 이어서 해당 파일을 삭제하면
- Then: import 제거 저장 단계에서는 로그에 `hmr update` 가 기록된다. 파일 삭제 단계에서는 module graph 에서 이미 빠진 파일이므로 `hmr update` 로그가 없어도 정상 — **에러 로그 없음 + 서버 프로세스 생존 + 4000 응답 정상**이면 통과로 판정한다.

### D-4. import 잔존 상태로 삭제 → 에러 후 복구 [unit] — 실패 케이스
- Given: 신규 모듈을 import 중인 상태
- When: import 를 남겨둔 채 모듈 파일만 삭제하면
- Then: 로그에 import resolve 실패 에러가 (폴링 주기 내) 표면화된다 — 감지 자체가 되는지 확인. 이후 파일을 복원하면 에러가 해소되고 `hmr update` 로 정상 복귀한다. 서버 프로세스는 죽지 않는다.

---

## E. vite.config.js 변경 감지 (planner 항목 4)

### E-1. config 수정 → 자동 재시작 [unit] — 정상
- Given: 4000 서버 기동 상태
- When: `frontend/vite.config.js` 를 무해하게 수정(주석 추가 등)·저장하면
- Then: 로그에 config 변경 감지 및 서버 재시작 라인(`vite.config.js changed, restarting server` / `server restarted`)이 폴링 주기 내 기록되고, 재시작 후 4000 응답이 정상이다. (drvfs 환경에서 config 감지 회복 확인 — 본 변경의 핵심 목적 중 하나)

### E-2. config 문법 오류 → 실패 후 복구 [unit] — 실패 케이스
- Given: 4000 서버 기동 상태
- When: `vite.config.js` 에 문법 오류를 삽입·저장하면
- Then: 재시작 시도 후 오류 로그가 남는다. 원복 저장하면 자동으로 재시작에 성공하고 서버가 정상 응답한다. (테스트 종료 시 반드시 원복 확인)
- 비고: frontend_admin(4001)도 E-1 만 동일 절차로 1회 수행 (E-2 는 4000 대표 수행).

---

## F. 회귀 (planner 항목 5~9)

### F-1. 4000 HTTPS 기동 [api] — 회귀 (항목 5)
- Given: 4000 서버 기동 상태
- When: `curl -k -s -o /dev/null -w '%{http_code}' https://localhost:4000/` 을 호출하면
- Then: 200 이 반환되고, TLS 핸드셰이크가 자체서명 인증서로 성립한다(HTTP 평문 강등 없음).

### F-2. 4001 HTTPS 기동 [api] — 회귀 (항목 5)
- Given: 4001 서버 기동 상태
- When: 동일 방식으로 `https://localhost:4001/` 을 호출하면
- Then: 200 이 반환된다. 로그에 `[vite] HTTPS enabled` 가 존재한다(사이드카 인증서 폴백 포함).

### F-3. /api 프록시 → 9005 [api] — 회귀 (항목 6)
- Given: 9005 백엔드 기동 상태
- When: `curl -k https://localhost:4000/api/health` 와 4001 동일 경로를 호출하면
- Then: 9005 가 직접 반환하는 것과 동일한 응답(상태코드·바디)이 프록시를 통해 반환된다. 502/ECONNREFUSED 없음.
- 비고: 엔드포인트 확정 — `GET /api/health` (`backend_9005/app/main.py:623` 실존 확인).

### F-4. /api 웹소켓 프록시 (ws:true) [api] — 회귀 (항목 6)
- Given: 9005 백엔드의 ws 엔드포인트 기동 상태
- When: `https://localhost:4000` 경유로 `/api/dm/ws` 경로에 Upgrade 요청(curl `--http1.1 -H 'Upgrade: websocket' ...` 수준 핸드셰이크)을 보내면
- Then: 101 Switching Protocols(또는 백엔드 정의 응답)로 프록시가 업그레이드를 통과시킨다.
- 비고: curl 핸드셰이크에는 `Connection: Upgrade`, `Sec-WebSocket-Key: <base64 16바이트>`, `Sec-WebSocket-Version: 13` 헤더가 필요하다.
- 비고: 경로 확정 — `/api/dm/ws`. 미인증 요청에 대한 **403 응답도 프록시 통과의 증명**으로 인정한다(백엔드까지 도달했다는 뜻). 이 검증은 vite HMR ws 와 무관하다(그쪽은 F-5).

### F-5. HMR 웹소켓 연결 + 리로드 루프 없음 [e2e] — 회귀 (항목 7)
- Given: 브라우저로 `https://localhost:4000` 접속 (4001 도 동일 절차 1회)
- When: 개발자 콘솔 메시지를 확인하며 60초간 페이지를 유휴 상태로 두면
- Then: `[vite] connected.` 가 1회 출력되고, `[vite] server connection lost. Polling for restart...` 반복이나 자발적 전체 새로고침 루프가 발생하지 않는다.

### F-6. idle CPU 점유 [unit] — 회귀/경계 (항목 8)
- Given: 두 dev 서버 기동, 파일 수정 없는 유휴 상태
- When: 60초 동안 두 vite node 프로세스의 CPU 사용률을 주기 샘플링(ps/top)하면
- Then: 폴링(interval 1000ms) 상태에서 각 프로세스 평균 CPU 가 과다하지 않다(가이드: 코어 대비 평균 한 자릿수 %, 지속 50%+ 고착 시 실패). 메모리 지속 증가 추세도 없다.

### F-7. vite build — frontend [unit] — 회귀 (항목 9)
- Given: `frontend/` 디렉터리
- When: `npm run build`(vite build) 를 실행하면
- Then: 오류 없이 종료(exit 0)되고 `dist/` 산출물이 생성된다. watch 옵션은 dev 전용이므로 build 동작에 영향이 없어야 한다.

### F-8. vite build — frontend_admin [unit] — 회귀 (항목 9)
- Given: `frontend_admin/` 디렉터리
- When: 동일하게 build 를 실행하면
- Then: 오류 없이 종료되고 산출물이 생성된다.

### F-9. 화면 동작 회귀 — 사용자/관리자 첫 여정 [e2e] — 회귀
- Given: 브라우저에서 `https://localhost:4000` (이어서 `https://localhost:4001`) 접속
- When: 첫 화면 로드 후 API 데이터가 표시되는 영역(목록/차트 등)을 확인하고, 로그인 화면이 있으면 `TEST_USER_EMAIL`(관리자는 `TEST_ADMIN_EMAIL`) 로 로그인 시도까지 수행하면
- Then: 화면이 정상 렌더링되고 `/api` 데이터가 채워지며, 콘솔에 프록시/mixed-content 에러가 없다. (폴링 도입 전과 동일한 동작)
- **안전 경계 (필수)**: 본 여정은 **읽기 전용**으로 제한한다 — 로그인·목록/차트 조회까지만. DM 발송·**전체발송(broadcast)**·삭제 등 쓰기 액션 및 실발송 일체 금지. 특히 4001 어드민에는 broadcast 기능이 실존하므로 해당 버튼/메뉴는 클릭하지 않는다.

---

## 실행 순서 권고 (tester 참고)

1. A-1~A-3 (설정·기동 확인) → 실패 시 이후 전부 차단
2. F-1~F-3 (기동 회귀 스모크)
3. B → C → D → E (HMR 본검증; E-2 는 마지막에, 반드시 원복)
4. F-4~F-6, F-9 (회귀)
5. F-7~F-8 (build — dev 서버와 포트 충돌 없음, 마지막 수행)

## 시나리오 집계 (확정)

- 총 24건 (planner 검토로 舊 D-2 [e2e] 삭제 — B-1 + D-1 조합으로 커버)
- [unit] 16 / [api] 4 / [e2e] 4 — **E2E 확정: B-1, C-1, F-5, F-9**
- 1차 게이트: [unit]/[api] 20/20 PASS (픽스 사이클 0회)

## 개정 이력

- 2026-08-11 v172 초판 작성 (25건)
- 2026-08-11 v172 planner 조건부 승인 반영: D-2 삭제(D-1 비고로 병합), D-3 삭제 단계 판정 완화, B-4 로그 기준 검증으로 변경, 공통 cleanup 절차 추가, F-3/F-4 실행 비고 추가 (24건)
- 2026-08-11 v172 1차 게이트 통과(20/20) 후 E2E 확정: E2E 실행 전제 블록 추가(playwright/headless shell/ignoreHTTPSErrors/스크린샷 증적/플레이스홀더), F-3 `GET /api/health` 확정, F-4 `/api/dm/ws` + 403 판정 주석, 1단계 실측 기준선 기록, F-9 읽기 전용 안전 경계 명문화, B-1/C-1 종료 조건(원복+git status) 명기

---

# v173 — 커버 이미지 mixed-content 해결: media_urls 중앙 헬퍼 + 프록시/presign 이중 모드 (2026-08-13)

- 버전: v173 (planner PLAN.md v173 기준)
- 작성일: 2026-08-13
- 작성: test-designer (설계만, 실행은 tester 담당)
- 대상 변경 요약:
  - 신규 `backend_9005/app/services/media_urls.py` — `public_presign` / `browser_image_url` / `browser_video_url` 3종 헬퍼로 브라우저 노출 이미지 URL 발급 중앙화
  - `MEDIA_URL_MODE=proxy`(개발 기본, `/api/upload/cover-preview/...` 상대경로) | `presign`(운영, public host presign). `MINIO_PUBLIC_SECURE`(bool)로 https presign 전환
  - 비디오(`browser_video_url`)는 모드 무관 **항상 presign** (프록시 메모리 부담 제외)
  - `faces/`·`evidence/` 헬퍼 레벨 차단(안전망), cover-preview 라우트 media_type 보강(mimetypes) + `..` 차단
  - `minio.py get_public_minio` 캐시 키에 secure 포함 (stale 인스턴스 버그 픽스)
  - frontend `AlbumCard.jsx` 깨진 폴백(`/api/files/`) → `api.coverPreviewUrl` 교체
  - backend_9004 는 9005 미러 (`_logs.py` 파일명만 예외 관행)

## v173 전제 / 공통 픽스처

- 백엔드: 9005·9004 uvicorn 기동 상태. API 직접 검증은 `http://localhost:9005/...`(9004 동일), 프론트 경유 검증은 `https://localhost:4000/api/...`(curl `-k` 필요).
- 프론트: 4000 자체서명 HTTPS. E2E 는 playwright `ignoreHTTPSErrors: true` + chromium **headless shell** + `LD_LIBRARY_PATH` 스크래치패드 libs 방식 (v172 확정 전제 그대로).
- 계정: 홈/앨범/아티스트는 **비로그인 검증 가능**. 인증 필요한 회귀 항목만 `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`, 관리자 `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` 플레이스홀더 사용. 실값 기재 금지. IP 는 `<PUBLIC_IP>` 마스킹.
- [unit] 실행 방식: 서버 기동 불필요. `backend_9005` 에서 python/pytest 로 `media_urls`·`minio` 모듈 직접 임포트, 설정값(`media_url_mode`/`minio_public_secure`/`minio_public_host`)은 monkeypatch 또는 env 오버라이드로 분기 — **.env 파일은 건드리지 않는다**.
- [api] 모드 전환 방식: presign 모드 검증(P-3, P-4 후반, P-8 후반)은 9005 `.env` 의 `MEDIA_URL_MODE=presign` 전환 + 서버 재시작이 필요한 파괴적 절차다.
- **정리(cleanup) 절차 (필수)**: `.env` 를 전환한 모든 시나리오는 종료 즉시 `MEDIA_URL_MODE=proxy` 로 **원복하고 서버 재시작 후, albums 목록 1건의 `cover_image` 가 상대경로(`/api/upload/cover-preview/`)로 돌아왔는지 확인**한다. `MINIO_PUBLIC_SECURE` 를 만졌다면 `false` 원복 동일 적용. 전체 종료 시 `git status` + `.env` diff 로 테스트 유래 변경 0건 확인.
- 픽스처 데이터: 커버 이미지가 실존하는 앨범 최소 1건(jpg 또는 png), 커버가 NULL 인 앨범 1건(있으면), MV(`music_video_url`) 보유 트랙 1건을 사전 식별해 object name 을 기록해 둔다. 없으면 tester 가 시드 후 테스트 종료 시 삭제.

---

## U. [unit] media_urls 헬퍼 / minio 캐시

### U-1. browser_image_url — proxy 모드 상대경로 [unit] — 정상
- Given: `media_url_mode="proxy"` 설정, 유효한 이미지 object name (예: `covers/abc.jpg`)
- When: `browser_image_url(object_name)` 을 호출하면
- Then: `/api/upload/cover-preview/` 로 시작하는 **상대경로**가 반환되고, object name 은 URL-quote 되어 포함된다(공백·한글 object name 케이스 1건 포함). 스킴/호스트는 포함되지 않는다.

### U-2. browser_image_url — presign 모드 public host [unit] — 정상
- Given: `media_url_mode="presign"`, `minio_public_host="<PUBLIC_IP>:9100"`, `minio_public_secure=False`
- When: 동일 호출하면
- Then: `http://<PUBLIC_IP>:9100/` 로 시작하고 `X-Amz-` 서명 쿼리가 포함된 full URL 이 반환된다. 내부 endpoint(minio_endpoint) 호스트는 URL 에 등장하지 않는다.

### U-3. secure 분기 — https 스킴 [unit] — 정상
- Given: U-2 와 동일하되 `minio_public_secure=True`
- When: `browser_image_url` 및 `public_presign` 을 호출하면
- Then: 반환 URL 스킴이 `https://` 다. (클라우드 이전 시나리오: `.env` 3값 변경만으로 `https://media.maidol.co.kr/...` 발급되는 구조 검증)

### U-4. http(s) passthrough [unit] — 정상
- Given: 임의 모드, 입력값이 이미 `http://...` 또는 `https://...` 인 레거시 full URL
- When: `browser_image_url` / `public_presign` 에 넣으면
- Then: 입력 그대로 반환된다(재서명·프록시 변환 없음 — 레거시 저장분 회귀 주의 지점 3).

### U-5. None/빈값 [unit] — 경계
- Given: 입력이 `None` 또는 `""` (공백 문자열 포함)
- When: 헬퍼 3종을 각각 호출하면
- Then: 예외 없이 `None`(또는 설계된 빈 반환값)이 반환되고 로그 에러가 없다.

### U-6. faces/·evidence/ 차단 [unit] — 보안
- Given: 입력 object name 이 `faces/x.jpg`, `evidence/x.jpg`
- When: `browser_image_url` 을 호출하면
- Then: 두 경우 모두 `None` 이 반환된다(presign 모드에서도 동일). face_verify_service 전제("faces/ 는 프록시/presign 라우트에서 차단됨")가 헬퍼 레벨에서도 성립.

### U-7. browser_video_url — 모드 무관 항상 presign [unit] — 정상
- Given: `media_url_mode="proxy"` 상태 (프록시 주력 모드)
- When: `browser_video_url(object_name)` 을 호출하면
- Then: 프록시 상대경로가 아닌 **full presign URL**(`X-Amz-` 포함, public host 기준)이 반환된다. `media_url_mode="presign"` 에서도 동일 형태다.

### U-8. get_public_minio 캐시 키 — (endpoint, secure, region) 3요소 [unit] — 버그 픽스 검증
- Given: 동일 endpoint 문자열
- When: ① `get_public_minio(endpoint, secure=False)` 호출 후 `get_public_minio(endpoint, secure=True)` 를 호출하고, ② 동일 (endpoint, secure) 에서 region 만 상이하게 재호출하면
- Then: ① secure 상이 → stale 캐시가 아닌 **secure=True 클라이언트가 새로 생성**된다(반환 인스턴스 상이 또는 `_base_url` https 확인). ② region 상이 → 마찬가지로 재생성된다(캐시 키 = endpoint+secure+region 3요소). 동일 (endpoint, secure, region) 재호출은 캐시 히트로 동일 인스턴스를 반환한다.

### U-9. public_presign 오프라인 서명 검증 — 행 없음 + region [unit] — 정상 (planner 조정 1)
- Given: `minio_public_host` 를 도달 불가 TEST-NET 주소(예: `203.0.113.10:9100`)로 오버라이드한 상태
- When: `public_presign(object_name)` 을 호출하면
- Then: 네트워크 접속 시도 없이(행/타임아웃 없이) **2초 이내** full presign URL 이 반환된다 — presign 은 로컬 서명 연산임을 확인. 반환 URL 의 `X-Amz-Credential` 쿼리에 `/us-east-1/` 이 포함된다 (backend-dev region 수정 검증). `X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Expires` 존재도 함께 확인.

---

## P. [api] 응답 URL 형태 / cover-preview 라우트

### P-1. albums 목록 cover_image — proxy 모드 상대경로 [api] — 정상 (기본 모드)
- Given: 9005 기동, `MEDIA_URL_MODE=proxy`(기본), 커버 보유 앨범 존재
- When: `GET /api/albums`(목록) 을 호출하면
- Then: 각 항목 `cover_image` 가 `/api/upload/cover-preview/` 로 시작하는 상대경로다. 내부 minio host·`X-Amz-` 서명이 응답에 등장하지 않는다. 커버 NULL 앨범은 `cover_image` 가 null(또는 설계값)로 에러 없이 내려온다.

### P-2. albums 상세 cover_image — proxy 모드 [api] — 정상
- Given: P-1 과 동일 상태
- When: `GET /api/albums/{id}` 상세를 호출하면
- Then: `cover_image` 형태가 P-1 과 동일 규칙을 따른다(목록/상세 일관성).

### P-3. albums 목록/상세 — presign 모드 전환 [api] — 모드 전환 (파괴적, cleanup 필수)
- Given: 9005 `.env` 를 `MEDIA_URL_MODE=presign` 으로 전환 + 서버 재시작
- When: P-1/P-2 동일 엔드포인트를 호출하면
- Then: `cover_image` 가 `http(s)://<public host>/...` full presign URL(`X-Amz-` 포함)이고 host 가 `MINIO_PUBLIC_HOST` 값과 일치한다(내부 endpoint 아님). `MINIO_PUBLIC_SECURE=false` 면 `http://`, 추가로 `true` 전환+재시작 시 `https://` 로 바뀌는 것까지 1회 확인.
- 종료 조건: `.env` 두 키 원복(proxy/false) + 재시작 + P-1 재확인 (공통 cleanup 절차).

### P-4. artists 앨범 목록 cover_image — 양 모드 동일 규칙 [api] — 정상
- Given: 커버 보유 앨범을 가진 아티스트 존재
- When: proxy 모드에서 `GET /api/artists/{id}` (앨범 목록 포함 응답) 을 호출하고, P-3 의 presign 전환 구간에서 동일 호출을 1회 끼워 넣으면
- Then: 앨범 목록의 `cover_image` 가 albums 와 동일 규칙(proxy=상대경로 / presign=public host full URL)을 따른다.

### P-5. cover-preview 정상 응답 + content-type [api] — 정상 (media_type 보강 검증)
- Given: images 버킷에 실존하는 png 1건·jpg 1건 object name
- When: `GET /api/upload/cover-preview/{object_name}` 을 각각 호출하면
- Then: 200 + 바디가 이미지 바이너리이며, Content-Type 이 각각 `image/png`, `image/jpeg` 로 확장자에 맞게 반환된다(기존 png 고정 오헤더 수정 확인).

### P-6. cover-preview 차단/부재 404 [api] — 보안/실패 케이스
- Given: 9005 기동 상태
- When: `faces/x.jpg`, `evidence/x.jpg`, `..%2F..%2Fetc%2Fpasswd`(및 raw `../` 변형), 실존하지 않는 object name 각각으로 cover-preview 를 호출하면
- Then: 4건 모두 404 (파일 내용·존재 여부 힌트 누설 없음). 서버 에러(500) 아님.

### P-7. cover-preview 무인증 접근 [api] — 정상 (홈 비로그인 전제)
- Given: 인증 헤더/쿠키 없는 클라이언트
- When: P-5 의 정상 object 로 호출하면
- Then: 200 이 반환된다(무인증 유지 — 비로그인 홈 커버 노출 전제. 회귀 주의 지점 6).

### P-8. tracks music_video_url/mv 필드 — 모드 무관 full presign [api] — 정상
- Given: MV 보유 트랙 존재, proxy 모드
- When: 해당 트랙 응답(`music_video_url`/mv 관련 필드)을 조회하고, P-3 presign 전환 구간에서 동일 조회를 1회 반복하면
- Then: 두 모드 모두 `http(s)://` full presign URL(`X-Amz-` 포함, public host)이다 — 비디오는 프록시 상대경로로 강등되지 않는다.

### P-9. MV 잡 조회 — 이미지=proxy 상대경로 / 비디오=full presign 혼재 [api] — 정상 (조건부, planner 조정 3)
- Given: proxy 모드, MV 스튜디오 잡 픽스처(이미지 필드 `image_url`/`thumbnail_url`/`cover_url` 와 비디오 필드를 함께 가진 잡) 존재
- When: 해당 MV 잡 조회 엔드포인트를 호출하면
- Then: 이미지 필드들은 `/api/upload/cover-preview/` 상대경로, 비디오 필드는 `X-Amz-` 포함 full presign URL 로 **한 응답 안에서 kind 별 분기**가 올바르다.
- 조건부: **MV 잡 픽스처가 없으면 실행하지 않고 U-1/U-7(헬퍼 레벨 분기 검증)로 갈음** — 스킵 사유를 결과 기록에 명시한다(잡 신규 생성으로 픽스처를 만들지 말 것 — 외부 API 비용/부작용).

---

## R. [api] 회귀

### R-1. charts/feeds/tracks 목록 cover_image = object name 불변 [api] — 회귀 (주의 지점 1)
- Given: 9005 기동, proxy 모드
- When: `GET /api/charts/top100`, feeds 목록, tracks 목록을 호출하면
- Then: `cover_image` 가 **object name 그대로**다(상대경로·presign 으로 바뀌지 않음 — 프론트가 coverPreviewUrl 로 감싸는 기존 계약 유지). `X-Amz-`·`/api/upload/cover-preview/` 문자열이 해당 필드에 없음.

### R-2. 범용 presigned-url 엔드포인트 faces/·evidence/ 차단 [api] — 회귀/보안 (주의 지점 4)
- Given: 인증된 사용자 토큰(플레이스홀더 계정)
- When: `GET /api/upload/presigned-url` 에 `faces/x.jpg`, `evidence/x.jpg` object 를 요청하면
- Then: 기존과 동일하게 차단 응답(4xx)이다. `public_presign` 교체 후에도 차단 로직이 유지된다.

### R-3. voice clone presign — public host 유지 [api] — 회귀 (주의 지점 2)
- Given: voice clone 트리거 가능한 픽스처(불가 시 해당 서비스 함수 단위로 `public_presign` 호출 결과 확인으로 대체)
- When: voice clone 흐름에서 발급된 presign URL 을 `[voice_clone]` 로그로 확인하면
- Then: URL host 가 public host 이고, **프록시 상대경로가 아니다**(서버측 외부 API 전달용 — 프록시 모드 적용 금지). secure 설정이 스킴에 반영된다(secure=False 하드코딩 제거 확인).

### R-4. 전용 프록시 4종 무변경 [api] — 회귀 (주의 지점 5)
- Given: 각 프록시의 기존 접근 조건 충족 상태(admin 은 `TEST_ADMIN_EMAIL` 인증)
- When: auth profiles 프록시(`profiles/` 전용), business ads 프록시(`ads/` 전용), admin 프록시(인증), character 프록시를 기존 정상 케이스 1건 + 기존 차단 케이스 1건씩 호출하면
- Then: v172 이전과 동일한 응답(정상 200/차단 4xx)이다 — v173 변경의 영향 없음.

### R-5. 9004 미러 동일성 [api] — 회귀 (미러 관행)
- Given: 9004 기동, 9005 와 동일 `.env` 모드(proxy)
- When: P-1(albums 목록)과 P-6 중 faces/ 차단 1건을 9004 에 동일 호출하면
- Then: `cover_image` 형태·404 차단이 9005 와 동일하다. `media_urls.py`·`minio.py`·라우트 diff 가 9005 와 일치(`_logs.py` 파일명 예외만 허용).

---

## E. [e2e] 핵심 여정 (아이스크림콘 금지 — 3건 한정) — **현재 코드 기준 확정** (1차 게이트 23/23 통과 후)

- E2E 공통 전제 (확정 보강):
  1. **진입 조건**: `MEDIA_URL_MODE=proxy` 원복 상태 재확인 — albums 목록 1건의 `cover_image` 가 상대경로(`/api/upload/cover-preview/`)인지 curl 로 확인 후 진입.
  2. **픽스처**: 홈 "최신 앨범" 영역에 커버 보유 앨범이 실노출되는지 사전 확인 — 미노출 시 P-1 픽스처 앨범을 시드하고 테스트 종료 시 삭제 (커버 0건 화면에서의 공허 통과 방지).
  3. **E-1 판정 기준 고정**: 콘솔 메시지에서 "Mixed Content" 문구 grep 0건 + 이미지 리소스 응답 4xx/5xx 0건 + 대상 커버 `<img>` naturalWidth > 0.

### E-1. 홈 비로그인 — 커버 실렌더 + mixed-content 0건 [e2e] — 핵심 (본 변경의 목적)
- Given: 브라우저(headless shell, ignoreHTTPSErrors)로 `https://localhost:4000` 에 **비로그인** 접속
- When: 홈의 차트·최신곡·최신앨범 영역이 로드될 때까지 대기한 뒤, 각 영역의 커버 이미지와 브라우저 콘솔을 확인하면
- Then: 세 영역 커버 `<img>` 가 실제 픽셀로 렌더된다(naturalWidth > 0 수준의 로드 성공 판정, 깨진 이미지 아이콘 없음). 콘솔에 **mixed-content 경고 0건**, 이미지 404/CORS 에러 0건. 특히 "최신 앨범"(AlbumCard — `/api/files/` 깨진 폴백 수정 대상) 커버가 로드된다.
- 증적: 홈 전체 스크린샷 + 콘솔 메시지 캡처.

### E-2. 앨범 상세·아티스트 페이지 — 커버 렌더 [e2e] — 핵심
- Given: E-1 상태에서 계속 (비로그인)
- When: 홈에서 앨범 하나를 클릭해 앨범 상세로 이동하고, 이어서 아티스트 페이지로 이동하면
- Then: 앨범 상세 대형 커버(AlbumDetailPage — `album.cover_image` 직접 src)와 아티스트 페이지의 앨범 목록 커버가 모두 실렌더되고, 콘솔 mixed-content·404 0건.
- 증적: 페이지별 스크린샷.

### E-3. 회귀 — 기존 화면 여정 무손상 [e2e] — 회귀
- Given: `https://localhost:4000` 접속 (필요 시 `TEST_USER_EMAIL` 로그인, 읽기 전용)
- When: 홈 로드 → 곡 목록에서 곡 선택 → 재생목록/플레이어 UI 표시까지 기존 여정을 수행하면
- Then: 화면 렌더·목록 데이터·플레이어 UI 가 v172 와 동일하게 동작하고(SongItem/MusicPlayer 는 기존 coverPreviewUrl 경로 유지), 콘솔에 신규 에러가 없다.
- **안전 경계 (필수)**: 읽기 전용 — 업로드·삭제·발송 등 쓰기 액션 금지 (v172 F-9 규칙 승계).

---

## v173 한계 명시 (검증 범위 경계)

- **presign URL 의 외부망 실 fetch 는 서버 환경에서 검증 불가** — public host(`<PUBLIC_IP>:9100`)로의 접속은 hairpin NAT 제약으로 서버 내부에서 재현되지 않는다.
- 따라서 presign 관련 검증(U-2/U-3/U-9, P-3/P-4/P-8/P-9, R-3)은 **서명 구조 검증까지로 한정**한다: host, scheme(http/https), `X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Credential` 의 region(`/us-east-1/`), `X-Amz-Expires` 존재.
- presign URL 로의 **실제 fetch 성공(이미지/비디오 바이트 수신)은 클라우드 이전 후 확인 항목**으로 이월 — REPORT 특이사항에 기록한다.

## v173 실행 순서 권고 (tester 참고)

1. U-1~U-9 (unit — 서버 무관, 실패 시 이후 차단)
2. P-1, P-2, P-4(proxy), P-5~P-7, P-9(픽스처 있을 때), R-1~R-5 (proxy 기본 모드에서 일괄 — .env 무변경 구간)
3. P-3 + P-4(presign)/P-8(presign) (모드 전환 구간 — 한 번의 전환으로 묶어 수행, 종료 즉시 원복+재시작+P-1 재확인)
4. E-1 → E-2 → E-3 (E2E — 반드시 proxy 원복 상태에서 수행)

## v173 시나리오 집계

- 총 26건 (P-9 는 조건부 — 픽스처 부재 시 U-1/U-7 갈음 + 스킵 기록)
- [unit] 9 / [api] 14 (P 9 + R 5) / [e2e] 3 — **E2E 확정: E-1, E-2, E-3**
- 모드 전환 파괴 구간: P-3·P-4(후반)·P-8(후반) — cleanup(proxy 원복+재시작 확인) 없이는 E2E 진입 금지

## 개정 이력 (v173)

- 2026-08-13 v173 초판 작성 (24건) — planner PLAN.md v173 지정 항목 전부 커버 + secure https 전환(U-3/P-3), 캐시 키 버그 픽스(U-8), cover-preview content-type 보강(P-5), 9004 미러(R-5) 보강
- 2026-08-13 v173 planner 승인+조정 3건 반영 (26건): U-9 신설(public_presign 오프라인 서명 + `/us-east-1/` region), U-8 캐시 키 3요소(endpoint/secure/region) 확장, P-9 조건부 신설(MV 잡 이미지=proxy/비디오=presign 혼재, 픽스처 부재 시 U-1/U-7 갈음), "한계 명시" 블록 추가(hairpin NAT — presign 실 fetch 는 서명 구조 검증으로 한정, 클라우드 이전 후 이월)
- 2026-08-13 v173 1차 게이트 통과(23/23, 픽스 사이클 0회) 후 E2E 확정 (내용 무변경, 전제 3줄 보강): 진입 조건(proxy 원복 curl 재확인), 픽스처(홈 "최신 앨범" 커버 실노출 사전 확인·미노출 시 시드/삭제), E-1 판정 기준 고정("Mixed Content" grep 0건 + 이미지 4xx/5xx 0건 + naturalWidth>0)


---

# v174 — 전체발송(브로드캐스트) UI 관리자 앱 이관 (2026-08-13 13:09)

## 0. 범위와 대상

- 신규 백엔드: `POST /api/admin/cs/broadcast` (9005 선구현 → 9004 미러). body `{audience: all|users|customers, text: 1~2000자}`, 성공 응답 `{queued, audience}`.
  - 에러 계약: 401 무토큰 / 403 비관리자 / 400 유효성(bad audience·빈 text·2000자 초과) / 429 Redis 잠금 `dm:broadcast:lock:{official_id}` (NX EX 30) / 503 official 미시드.
  - 발신자 = official 계정(maidol_official) → 발송 대화가 관리자 CS 인박스에 수렴.
- 신규 프론트(관리자 앱 `frontend_admin`, 4001): AdminCsPage 상단 "📢 전체 발송" 버튼 + `AdminBroadcastModal`(audience 라디오 3종, maxLength 2000, `window.confirm`, 에러 매핑, 로그 `[AdminBroadcast]`), `api.js`의 `broadcastCs`.
- 제거(사용자 앱 `frontend`, 4000): `src/pages/DmInboxPage.jsx`의 브로드캐스트 섹션·`isAdmin` 분기·관련 상태/핸들러, `api/index.js`의 `broadcastDm`, CSS `.dmbroadcast*`.
- 유지: 기존 `/api/dm/broadcast` 엔드포인트는 deprecated 주석만 추가, 동작 불변(회귀 확인 대상).

## 1. 전제 조건 (tester 사전 확인)

- 기동: 9005·9004 백엔드, Redis, 관리자 앱(4001), 사용자 앱(4000).
- 계정(실값 금지 — 플레이스홀더): `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD`(role=admin), `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`(일반 유저). 로그인 API로 `ADMIN_TOKEN`/`USER_TOKEN` 획득.
- `OFFICIAL_ID`: DB에서 maidol_official 계정의 user id 조회(읽기 전용 SELECT) — BC-API-06의 잠금 키 조립에 사용.
- **안전 경계 (v174 필수 규칙)**:
  1. 이번 실행에서 **실제 브로드캐스트 발송은 0건**이어야 한다. 유효 body + 관리자 토큰 조합의 요청은 BC-API-06 단 1건이며, 반드시 **Redis 잠금을 먼저 걸고 나서** 요청한다(잠금 SET 성공 + TTL 확인 전에는 요청 금지).
  2. E2E의 `window.confirm` 은 **반드시 dismiss(취소)** — 수락 절대 금지.
  3. 나머지 신규 엔드포인트 호출은 전부 에러 경로(무토큰/일반토큰/유효성 실패)라 발송이 발생하지 않는다.

## 2. [api] 시나리오 — 비파괴 위주 (기본 대상 9005)

### BC-API-01. 401 — 무토큰 [api]
- Given: 9005 기동 상태, 토큰 없이
- When: `POST /api/admin/cs/broadcast` body `{audience:"all", text:"t"}` 를 Authorization 헤더 없이 호출하면
- Then: HTTP 401. 발송 부작용 없음(무토큰이라 큐잉 자체 불가).

### BC-API-02. 403 — 일반 유저 토큰 [api]
- Given: `USER_TOKEN`(일반 유저) 확보
- When: 동일 유효 body 로 `POST /api/admin/cs/broadcast` 호출하면
- Then: HTTP 403. 발송 0건.

### BC-API-03. 400 — bad audience [api]
- Given: `ADMIN_TOKEN` 확보
- When: body `{audience:"everyone", text:"t"}` 로 호출하면
- Then: HTTP 400 (유효성 에러). 발송 0건.

### BC-API-04. 400 — 빈 text [api]
- Given: `ADMIN_TOKEN`
- When: body `{audience:"all", text:""}` (및 공백만 " " 1회 추가 확인) 로 호출하면
- Then: HTTP 400. 발송 0건.

### BC-API-05. 400 — text 2001자 [api]
- Given: `ADMIN_TOKEN`, 2001자 문자열 생성(예: `python -c "print('a'*2001)"`)
- When: body `{audience:"all", text:"<2001자>"}` 로 호출하면
- Then: HTTP 400. (경계 보조 확인: 2000자는 유효성은 통과해야 하나 **실발송 방지를 위해 2000자 유효 요청은 보내지 않는다** — 경계 하한은 BC-API-06에서 잠금 선점 상태로만 확인.)

### BC-API-06. 429 — Redis 잠금 선점 (실발송 없이) [api] — 핵심
- Given: `ADMIN_TOKEN`, `OFFICIAL_ID` 확보. **요청 전에** redis-cli 로 `SET dm:broadcast:lock:{OFFICIAL_ID} test-lock NX EX 30` 실행 → 응답 `OK` 및 `TTL` 양수 확인. (SET 실패=키 선점 중이면 원인 파악 전 요청 금지)
- When: 유효 body `{audience:"users", text:"lock-test"}` 로 `POST /api/admin/cs/broadcast` 호출하면
- Then: HTTP 429. **발송 0건 검증**: 관리자 CS 인박스(또는 DM 대화 테이블)에 신규 브로드캐스트 대화/메시지 미생성 확인(요청 전후 카운트 동일).
- Cleanup: 검증 완료 후 `DEL dm:broadcast:lock:{OFFICIAL_ID}` 로 테스트 잠금 제거(TTL 자연 만료 대기도 허용, 단 후속 시나리오 전 상태 명시).

### BC-API-07. 회귀 — 기존 `/api/dm/broadcast` 일반 유저 403 [api]
- Given: `USER_TOKEN`
- When: 기존 `POST /api/dm/broadcast` 를 유효 형태 body 로 호출하면
- Then: HTTP 403 (v173 이전과 동일 — deprecated 주석 추가가 동작을 바꾸지 않음). 발송 0건.

### BC-API-08. 9004 미러 동일성 — 대표 케이스 [api]
- Given: 9004 기동 상태, `USER_TOKEN`
- When: BC-API-02 와 동일한 요청(일반 유저 토큰 + 유효 body)을 **9004** 의 `POST /api/admin/cs/broadcast` 로 호출하면
- Then: HTTP 403 — 9005 결과와 동일. (보조: 무토큰 1건도 9004 에 재확인해 401 동일성 확보 — 비용 낮으므로 권장)

## 3. [unit] 시나리오 — 프론트 유효성 (`frontend_admin`)

### BC-UNIT-01. 빈 text — 발송 차단 [unit]
- Given: `AdminBroadcastModal` 렌더 (테스트 러너/컴포넌트 테스트 또는 로직 함수 단위)
- When: text 가 빈 문자열(및 공백만)인 상태에서 발송 시도하면
- Then: 발송 버튼 비활성(disabled) 또는 핸들러 조기 차단 — `broadcastCs` 호출 0회, confirm 미노출.

### BC-UNIT-02. 2000자 카운터·maxLength [unit] — 문안 정정(v174 중간 확인)
- Given: 모달 렌더
- When: 2000자 입력 시 / 2000자 초과 입력 시도 시
- Then: 카운터는 **잔여 형식 "N자 남음"** (AdminBroadcastModal.jsx :103 `remaining = MAX_LEN - text.length`, :138 `{remaining}자 남음`) — 2000자 입력 시 "0자 남음", 1999자 시 "1자 남음". textarea maxLength=2000 으로 초과 입력이 잘림(값 길이 2000 유지). (초판의 `2000/2000` 분수 표기는 실구현과 다른 가정이었음 — 기능 동등, planner 정정)

### BC-UNIT-03. audience 기본값·라디오 전환 [unit] — planner 실측 반영(v174 판정)
- Given: 모달 최초 렌더
- When: 아무 조작 없이 초기 상태를 확인 → 미선택 상태로 발송 클릭 → 이어서 라디오를 users → customers 로 전환하면
- Then: **기본값 = 미선택(`''`)** (AdminBroadcastModal.jsx :27 `useState('')` — 어떤 라디오도 checked 아님, 사용자 앱 시절과 동일 정책). 미선택 발송 시도 시 인라인 notice "발송 대상을 선택해주세요."(:47-49) + `broadcastCs` 호출 0회 + confirm 미노출. 라디오 전환 시 단일 선택 유지(3종 상호 배타), 선택값이 발송 payload 의 audience 와 일치.

## 4. [e2e] 시나리오 — 핵심 여정만 (아이스크림콘 금지) — **현재 코드 기준 확정** (1차 게이트 11/11 통과, 픽스 0회 — planner 4단계 중간 확인)

> 확정 근거: 픽스 사이클 0회로 구현 코드가 TESTPLAN 작성 시점과 동일(git diff 실측 — 변경 매트릭스 10파일+신규 2파일 외 변경 없음). BC-E2E-01 보충 1건: confirm 취소(dismiss) 후 모달은 **입력값 유지 상태로 열려 있는 것이 정상**(AdminBroadcastModal.jsx :66 조기 return — reset 미호출). "남거나 닫히며" 중 '남음'이 실동작. 버튼 위치는 AdminCsPage.jsx :210(헤더), 모달 통합 :214-218.

### BC-E2E-01. 관리자 브로드캐스트 여정 — confirm 취소까지 [e2e] — 핵심
- Given: 관리자 앱(4001) 접속, `TEST_ADMIN_EMAIL` 로 로그인
- When: CS 페이지(/cs)로 이동 → 상단 "📢 전체 발송" 버튼 노출 확인 → 클릭해 모달 열기 → audience 하나 선택 + 텍스트 입력 → 발송 클릭 → **confirm 다이얼로그에서 취소(dismiss)** 하면
- Then: confirm 다이얼로그에 발송 대상/확인 문구가 표시되었고, 취소 후 모달이 발송하지 않은 상태로 남거나 닫히며, **네트워크 기록에 `admin/cs/broadcast` POST 0건**. 콘솔에 신규 에러 없음.
- **안전 경계**: confirm 수락 절대 금지. dialog 핸들러를 dismiss 로 사전 등록 후 발송 클릭.
- 증적: 버튼 노출·모달·confirm 직전 스크린샷 + 네트워크 요청 목록 캡처.

### BC-E2E-02. 회귀 — 사용자 앱에서 브로드캐스트 UI 제거 확인 [e2e] — 회귀
- Given: 사용자 앱(4000) 접속, **admin 계정**(`TEST_ADMIN_EMAIL`)으로 로그인
- When: DM 인박스에서 새 메시지 작성(compose) 모달을 열면
- Then: "📢 전체 발송" 섹션·audience 라디오가 **존재하지 않는다** (admin 계정임에도). 이어서 `TEST_USER_EMAIL` 계정 대상 개별 DM 1건 발송이 정상 동작(전송 성공, 대화에 표시). 콘솔에 `broadcastDm`/`.dmbroadcast` 관련 에러 없음.
- 안전 경계: 개별 DM 은 테스트 계정 간 1건, 무해한 내용으로만.
- 증적: compose 모달 스크린샷(브로드캐스트 섹션 부재) + DM 발송 성공 화면.

### BC-E2E-03. 회귀 — AdminCsPage 기존 기능 무손상 [e2e] — 회귀
- Given: BC-E2E-01 과 동일 로그인 상태(관리자 앱 /cs)
- When: CS 인박스 목록 조회 → 기존 스레드 하나 열기 → 답장 1건 전송하면
- Then: 목록·스레드 로딩·답장 전송이 v173 과 동일하게 정상 동작(신규 버튼/모달 추가가 기존 레이아웃·기능을 깨지 않음). 콘솔 신규 에러 0건.
- 안전 경계: 답장은 테스트 스레드(테스트 계정이 발신한 CS 문의)에만 1건.

## 5. 보류(옵션) — 이번 실행 범위 아님

### BC-OPT-01. 실발송 검증 [api+e2e] — 사용자 명시 승인 시에만
- 내용: dev DB 에서 최소 audience(예: 테스트 계정만 매칭되는 대상군)로 실제 브로드캐스트 1회 발송 → `{queued, audience}` 응답, 수신 계정 DM 도착, 발송 대화의 관리자 CS 인박스 수렴, 발송 직후 재요청 429(잠금 자연 동작) 확인.
- **이번 v174 실행 범위가 아니며, 사용자의 명시 승인 없이는 수행 금지.** REPORT 에 미실행 사유로 기재.

## 6. planner 확인 필요 사항

1. **audience 기본값**: BC-UNIT-03 은 기본값 `all` 로 가정 — 구현 명세상 기본값이 다르면(예: 미선택 강제) 기대값 정정 필요.
2. **BC-API-06 발송 0건 판정 방법**: DB 카운트 비교(권장) vs 관리자 CS 인박스 UI 확인 — tester 가 DB 읽기 접근 가능한지에 따라 확정.
3. **503(official 미시드) 케이스**: dev DB 에 official 시드가 존재하는 한 비파괴로 재현 불가(시드 삭제는 파괴적) → 이번 범위 제외로 기재했는데 이견 있으면 회신.
4. BC-E2E-02/03 의 개별 DM·답장은 쓰기 액션(각 1건) — v172 F-9 "읽기 전용" 규칙의 예외로 승인 필요.

## 6-A. planner 검토 판정 (v174, 2026-08-13 — §6 질의 4건 회신)

1. **audience 기본값 = 미선택(`''`) 확정** — AdminBroadcastModal.jsx :27 실측. BC-UNIT-03 본문·결과표 planner 가 직접 정정 완료(가정 `all` 폐기).
2. **BC-API-06 발송 0건 판정 = API 카운트 비교로 확정** — DM 데이터는 Mongo 소재라 DB 직접 접근 의존 대신, `ADMIN_TOKEN` 으로 `GET /api/admin/cs/conversations` 를 요청 전/후 호출해 `pagination.total` 동일 + 최신 `last_at` 불변 확인(읽기 전용, official 관점 = 발송 수렴 지점 그 자체). 보조 증적: 백엔드 로그에 `[admin-cs]` broadcast background start 로그 부재.
3. **503 케이스 범위 제외 동의** — official 시드 제거는 파괴적이고 startup 멱등 시드가 복구하므로 비파괴 재현 불가. 모달의 503 매핑은 코드 리뷰로 확인됨(AdminBroadcastModal.jsx :90-91). REPORT 한계 항목으로 이월 기재할 것.
4. **BC-E2E-02/03 쓰기 액션 예외 승인** — 개별 DM 1건(테스트 계정 간, 무해 내용) + CS 답장 1건(테스트 계정 발신 스레드 한정). 각 1건 한도 초과 금지. 브로드캐스트 제거가 개별 발송 경로를 깨지 않았는지가 핵심 회귀라 쓰기 필요성 정당.

부가 확인(판정 근거): BC-UNIT-01 의 "disabled 또는 핸들러 조기 차단" 표현은 실구현과 부합 — 빈 text 는 버튼 disabled 가 아니라 핸들러 조기 return + notice "메시지를 입력해주세요."(:51-54) 경로임. 시나리오 문안 수정 불요.

## 7. 실행 순서 권고 (tester 참고)

1. BC-UNIT-01~03 (서버 무관, 실패 시 프론트 구현 픽스 우선)
2. BC-API-01~05 (에러 경로 — 잠금 불필요) → BC-API-06 (잠금 선점 → 요청 → 검증 → DEL cleanup) → BC-API-07 → BC-API-08(9004)
3. BC-E2E-01 → BC-E2E-03 (관리자 앱 세션 재사용) → BC-E2E-02 (사용자 앱)
4. BC-OPT-01 은 수행하지 않음 — REPORT 특이사항에 보류 기록

## 8. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| BC-API-01 | api | | |
| BC-API-02 | api | | |
| BC-API-03 | api | | |
| BC-API-04 | api | | |
| BC-API-05 | api | | |
| BC-API-06 | api | | 잠금 선점 후 429 + 발송 0건 |
| BC-API-07 | api | | 기존 엔드포인트 회귀 |
| BC-API-08 | api | | 9004 미러 |
| BC-UNIT-01 | unit | | |
| BC-UNIT-02 | unit | | |
| BC-UNIT-03 | unit | | 기본값 미선택('') — planner 실측 확정 |
| BC-E2E-01 | e2e | | confirm 취소 — POST 0건 |
| BC-E2E-02 | e2e | | 사용자 앱 섹션 제거 회귀 |
| BC-E2E-03 | e2e | | AdminCsPage 회귀 |
| BC-OPT-01 | 보류 | SKIP(범위 외) | 사용자 승인 시에만 |

## v174 시나리오 집계

- 총 14건 + 보류 1건(BC-OPT-01)
- [api] 8 / [unit] 3 / [e2e] 3 — 실발송 0건 설계(유효 body+관리자 토큰 조합은 잠금 선점된 BC-API-06 단 1건, E2E confirm 은 전부 dismiss)

## 개정 이력 (v174)

- 2026-08-13 v174 초판 작성 (14+1건) — planner 지정 항목 전부 시나리오화. 429 는 redis-cli 잠금 선점 방식으로 비파괴 검증, 2000자 유효 경계 요청은 실발송 위험으로 미전송(카운터 unit + 2001자 400 으로 갈음), 503 케이스는 비파괴 재현 불가로 범위 제외(§6-3).
- 2026-08-13 planner 검토 판정 반영(§6-A) — BC-UNIT-03 기본값 `all` 가정 → 미선택(`''`) 실측 정정, BC-API-06 판정 방법 API 카운트 비교 확정, 503 제외 승인, E2E 쓰기 2건(개별 DM·CS 답장 각 1건) 예외 승인. 전체 14+1건 구성 승인 — 시나리오 추가/삭제 없음.
- 2026-08-13 planner 4단계 중간 확인 — 1차 게이트 11/11 PASS·픽스 0회, git diff 로 구현분 무변경 실측. E2E 섹션(BC-E2E-01~03) 현재 코드 기준 확정 마킹(내용 무변경, BC-E2E-01 dismiss 후 모달 잔존 동작 보충). BC-UNIT-02 카운터 문안을 실구현 잔여 형식("N자 남음")으로 정정(tester 정정 후보 수용 — 기능 동등 PASS 유지).

# v175 — 관리자 앱 사용자 상세 페이지 신설 (/users/:id) (2026-08-13 14:56)

팀: platform-music-admin-userdetail / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v175 §5 (planner 지정 항목), §1-1 응답 스키마 실측, §6 리스크
대상: backend_9005 (무변경 — 기존 `GET /api/admin/users/{id}` 첫 UI 사용) + frontend_admin (신규 AdminUserDetailPage, RecentContentPane 추출, utils/format.js)

## 0. 전제 및 안전 규칙

- **실사용자 무접촉**: 조회·쓰기 전부 v174 테스트 계정만 사용 — `bcast_admin_test_*@test.invalid`(관리자) / `bcast_user_test_*@test.invalid`(일반). 크리덴셜 실값은 문서·로그에 기재 금지 — 아래 플레이스홀더 사용.
  - `ADMIN_TOKEN` = 테스트 관리자 계정 로그인 토큰
  - `USER_TOKEN` = 테스트 일반 계정 로그인 토큰
  - `TEST_USER_ID` = 테스트 일반 계정의 UUID (`GET /api/admin/users?search=bcast_user_test` 로 사전 확보)
- **쓰기 후 원복 필수**: 쓰기 액션은 UD-E2E-01(role 변경), UD-E2E-03(밴/해제) 2곳뿐 — 각 시나리오 내 원복 단계까지가 시나리오의 일부(원복 실패 = 시나리오 FAIL).
- API 시나리오(UD-API-01~05)는 **전부 읽기 전용**(GET만). 대상 id 는 `TEST_USER_ID` 한정.
- 환경: backend_9005 기동, frontend_admin Vite dev(4001). 백엔드 무변경이므로 9004 미러 검증 대상 없음(PLAN §3).
- 로그 추적자: `[AdminUserDetail]`, `[RecentContent]` — 개인정보(이메일 등) 원문 미출력이 검증 대상(UD-UNIT-03).

## 1. [api] 시나리오 — `GET /api/admin/users/{id}` (읽기 전용)

### UD-API-01. 200 — 응답 스키마 필드 실재 확인 [api] — 핵심
- Given: `ADMIN_TOKEN`, `TEST_USER_ID` 확보
- When: `GET /api/admin/users/{TEST_USER_ID}` 를 `ADMIN_TOKEN` 으로 호출하면
- Then: HTTP 200. 응답 JSON 에 다음 **15개 키가 전부 실재**(값은 null 허용 필드 구분):
  - 항상 값 존재: `id`(요청 id 일치), `email`, `nickname`, `plan`, `role`, `is_banned`(bool), `violation_count`(int≥0), `created_at`(ISO), `track_count`(int≥0), `total_plays`(int≥0)
  - null 허용: `profile_image`, `bio`, `banned_at`, `ban_reason`, `restricted_until`
  - **부재 확인**: "포인트"·"본인인증" 류 필드 없음 (PLAN §6-1 — 화면 미표시 근거)

### UD-API-02. 400 — 잘못된 UUID [api]
- Given: `ADMIN_TOKEN`
- When: `GET /api/admin/users/not-a-uuid` 호출하면
- Then: HTTP 400.

### UD-API-03. 404 — 존재하지 않는 UUID [api]
- Given: `ADMIN_TOKEN`, 무작위 UUID v4 생성(예: `python -c "import uuid;print(uuid.uuid4())"` — DB 미존재 전제)
- When: 해당 UUID 로 호출하면
- Then: HTTP 404.

### UD-API-04. 401 — 무토큰 [api]
- Given: 토큰 없음
- When: `GET /api/admin/users/{TEST_USER_ID}` 를 Authorization 헤더 없이 호출하면
- Then: HTTP 401.

### UD-API-05. 403 — 일반 유저 토큰 [api]
- Given: `USER_TOKEN` (비관리자)
- When: 동일 요청을 `USER_TOKEN` 으로 호출하면
- Then: HTTP 403 (`get_admin_user` 의존성 거부).

## 2. [unit] 시나리오 — 프론트 (브라우저 하니스, 4001 dev)

> 별도 테스트 러너 부재 전제 — 브라우저 직접 확인 방식. 전부 읽기 전용 조회만 사용.

### UD-UNIT-01. 로딩 → 렌더 필드 매핑 [unit] — 핵심
- Given: 관리자 로그인 상태, `/users/{TEST_USER_ID}` 진입
- When: 로딩 상태를 거쳐 렌더가 완료되면
- Then: PLAN §2 화면 구성 4개 섹션이 UD-API-01 응답값과 일치 매핑:
  - 프로필: 닉네임·이메일·id·bio·plan·role·created_at (날짜는 `formatDate` 형식 `YYYY-MM-DD HH:mm` — utils/format.js 경유)
  - 활동: track_count·total_plays·violation_count
  - 제재: is_banned(=false 정상 상태)·restricted_until 표시(미제재 시 해당 없음 표기)
  - 최근 생성물: RecentContentPane 렌더(트랙 없으면 빈 상태 문구)
  - null 필드(profile_image·bio 등)는 placeholder/생략 처리로 깨짐 없음.

### UD-UNIT-02. 404 화면 — 에러 문구 + 목록 버튼 [unit]
- Given: 관리자 로그인 상태, 존재하지 않는 UUID(UD-API-03 과 동일 생성 방식)
- When: `/users/{존재하지 않는 UUID}` 로 직접 진입하면
- Then: **"사용자를 찾을 수 없습니다"** 문구 + "목록으로" 버튼 렌더. 버튼 클릭 시 `/users` 목록으로 이동. 콘솔에 unhandled 에러 없음(`[AdminUserDetail]` 실패 로그는 허용).
- 보조 확인(planner 추가): `/users/not-a-uuid` 진입 시에도 동일한 "사용자를 찾을 수 없습니다" 화면 — 구현이 400 도 not_found 로 처리(AdminUserDetailPage.jsx:36 실측).

### UD-UNIT-03. 콘솔 — 개인정보 원문 미출력 [unit] — 핵심
- Given: UD-UNIT-01 수행 직후(정상 렌더 + 액션 미실행 상태), 브라우저 콘솔 기록 확보
- When: 콘솔 전체 로그에서 테스트 계정의 **이메일 원문**(`@test.invalid` 포함 문자열)을 검색하면
- Then: `[AdminUserDetail]`·`[RecentContent]` 로그를 포함해 **이메일 원문 0건**. 유저 식별은 id 축약 관행(기존 `[AdminUsersPage]` 동일)만 허용.

## 3. [e2e] 시나리오 — 핵심 여정만 (사용자 행동 수준, 셀렉터 금지)

> **planner 확정 (2026-08-13, 1단계 8/8 PASS 후)** — UD-E2E-01~03 을 현재 코드 기준으로 확정. 보충 2건: (1) role 변경은 select 변경 **즉시 API 호출 — 확인 다이얼로그 없음**(AdminUserDetailPage handleRoleChange 실측, AdminUsersPage 관행 동일. confirm/prompt 는 밴·제한해제·위반초기화에만 존재) — E2E-01 초안 문구 정정. (2) E2E-01 보조②는 1단계 UD-API-01 기준 데이터의 `violation_count`/`restricted_until` 실값 기준으로 판정.

### UD-E2E-01. 목록 → 상세 → 액션(role 변경+원복) 여정 [e2e] — 핵심
- Given: 관리자 앱(4001)에서 테스트 관리자 계정으로 로그인
- When: "사용자 관리" 메뉴로 이동 → 검색창에 `bcast_user_test` 입력해 테스트 계정 검색 → 결과 행의 **닉네임을 클릭** → 상세 페이지에서 역할 select 를 **user → customer 로 변경**(즉시 호출 — 다이얼로그 없음, 정정) → 화면 갱신 확인 → 같은 방법으로 **customer → user 원복**하면
- Then:
  - 닉네임 클릭으로 `/users/{id}` 상세 진입, 4개 섹션(프로필·활동·제재·최근 생성물) 렌더, 사이드바 "사용자 관리" 하이라이트 유지
  - role 변경 즉시 화면의 role 표기가 customer 로 갱신(성공 시 `getAdminUser` 재조회 설계), 원복 후 user 로 복귀
  - 보조 확인 ①: 상세에서 브라우저 새로고침 1회 → 동일 렌더(직접 진입 경로, PLAN §5-3 일부)
  - 보조 확인 ② (확정 보충): 1단계 UD-API-01 기준 데이터 기준 — `violation_count == 0` 이면 "위반 초기화" 버튼 **미노출**, `restricted_until` 이 미래 시각이 아니면 "제한 해제" 버튼 **미노출** 확인(PLAN §5-4 대체 확인). 실값이 0/제한 아님과 다르면 노출 확인으로 대체하되 **클릭 금지**·비고 기록
  - 콘솔 신규 에러 0건, `[AdminUserDetail]` 로그에 이메일 원문 없음
- **원복 검증**: 종료 전 `GET /api/admin/users/{TEST_USER_ID}` 로 `role == "user"` 재확인. 불일치 시 즉시 원복 재시도 후 FAIL 기록.
- 증적: 목록 검색 결과·상세 렌더·role 변경 후·원복 후 스크린샷.

### UD-E2E-02. Reports → 사용자 상세 진입 [e2e] — planner 판정 (b) 확정
- Given: 관리자 로그인 상태, 신고 관리 페이지 접근 가능
- When/Then (분기 — planner 질의 2 판정 (b) 반영):
  - **테스트 계정이 신고 대상인 행이 실재하면**: 행 확장 → "사용자 상세 →" 링크 클릭 → 해당 유저 `/users/:id` 상세 이동·정상 렌더.
  - **실재하지 않으면(신고 시드 생성 금지)**: 임의 행 확장 후 링크 **노출 여부 + 링크 href 가 `/users/{reportedUserId}` 형태인지 DOM 에서 확인**까지만 수행(클릭 없음 — 라우팅 자체는 UD-E2E-01 이 커버). 클릭 진입 항목은 **조건부 SKIP(전제 데이터 부재)** 로 기록.
  - 보조: `reportedUserId` 를 추출할 수 없는 신고 행에서는 링크 자체가 **미노출** — 해당 행이 있을 때만 확인(없으면 비고 기록).
- 안전 경계: 클릭 대상은 테스트 계정 관련 행만. 실사용자 신고 행은 링크 노출·href 확인까지만 — **클릭(실사용자 상세 조회 포함) 금지**. 신고 시드 생성 금지(옵션 (a) 기각 — §4-2 판정).
- 증적: 확장 패널(링크 노출) 스크린샷 (+ 클릭 수행 시 이동 후 상세 스크린샷).

### UD-E2E-03. 회귀 — AdminUsersPage 액션 + RecentContentPane 추출 [e2e] — 회귀 핵심
- Given: 관리자 로그인 상태
- When:
  1. 사용자 목록에서 테스트 계정 행의 **밴 실행**(사유 입력, 예: "v175 regression test") → 상태 확인 → **밴 해제로 원복**
  2. 신고 관리 페이지에서 임의 신고 행 확장(가능하면 테스트 계정 행)
- Then:
  1. 목록 페이지 기존 액션이 v174 와 동일 동작 — 밴 후 행에 제재 상태 반영, 해제 후 복귀. 목록 날짜 표기 `YYYY-MM-DD HH:mm` 유지(utils/format.js 전환 회귀)
  2. **RecentContentPane 추출 후에도** 확장 패널의 최근 트랙 그리드·캐릭터 이미지가 이전과 동일 렌더(CSS `admin-reports__recent*` 클래스 이동 회귀 — 육안 스타일 붕괴 없음). 콘솔 신규 에러 0건, `[RecentContent]` 로그 정상
- **원복 검증**: 종료 전 `GET /api/admin/users/{TEST_USER_ID}` 로 `is_banned == false` 재확인. `ban_reason`/`banned_at` 잔존값 여부도 기록(잔존 시 REPORT 특이사항 — FAIL 아님, 백엔드 무변경 원칙상 기존 동작).
- 안전 경계: 밴 대상은 테스트 일반 계정만(관리자 테스트 계정 밴 금지 — 세션 삭제 부작용). 신고 행 확장은 읽기 전용.

## 4. planner 확인 필요 사항 — **판정 완료 (2026-08-13, planner)**

1. **PLAN §5-3 축소 배치 → 승인**: "직접 진입(새로고침)"=UD-E2E-01 보조, "존재하지 않는 id"=UD-UNIT-02 편입, **미로그인 리다이렉트 제외 승인**. 근거: `/users/:id` 가 기존 `AdminRoute` 로 동일 래핑됨을 코드 실측(App.jsx:30) — 가드 자체는 v162 이후 무수정·기수검증 범위이므로 신규 e2e 불요.
2. **UD-E2E-02 → 옵션 (b) 채택**: 신고 시드 생성(a)은 기각 — reports 파이프라인(증거 스냅샷 등) 부작용·원복 복잡성이 커서 쓰기 최소화 원칙 위반. (b)에 보강: 클릭 없이 **링크 href = `/users/{reportedUserId}` DOM 확인**을 추가해 검증력 보전(본문 반영 완료). 실사용자 신고 행 클릭 금지·실사용자 상세 조회 금지 방침 승인. 테스트 계정 대상 행이 실재하면 클릭 진입 수행.
3. **쓰기 배분 → 승인**: role(UD-E2E-01)+밴/해제(UD-E2E-03) 2종만. 제한해제·위반초기화는 버튼 미노출 확인 대체 승인 — 위반 데이터 시드는 `user_violations` 직접 조작이라 **금지**.
4. **UD-UNIT 방식 → 승인**: 러너 도입은 이번 범위 침식 — 브라우저(4001) 직접 확인 + 실 API 읽기 전용 조건으로 진행. 러너 도입은 후속 과제 후보로 REPORT에 기재.

## 5. 실행 순서 권고 (tester 참고)

1. UD-API-01~05 (읽기 전용 — 백엔드 전제 확정, UD-API-01 응답값은 UNIT/E2E 기대값의 기준 데이터로 보관)
2. UD-UNIT-01 → UD-UNIT-03 (같은 세션에서 콘솔 검사) → UD-UNIT-02
3. UD-E2E-01 (role 변경+원복) → UD-E2E-03 (밴/해제+원복 — 세션 재사용) → UD-E2E-02 (planner 질의 2 회신 후)
4. 각 쓰기 시나리오 종료 시 원복 검증 GET 을 반드시 수행하고 결과표 비고에 기록

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| UD-API-01 | api | | 15개 필드 실재 + 포인트/인증 부재 |
| UD-API-02 | api | | 400 잘못된 UUID |
| UD-API-03 | api | | 404 없는 UUID |
| UD-API-04 | api | | 401 무토큰 |
| UD-API-05 | api | | 403 일반유저 |
| UD-UNIT-01 | unit | | 필드 매핑 + formatDate |
| UD-UNIT-02 | unit | | 404 화면 + 목록 버튼 |
| UD-UNIT-03 | unit | | 이메일 원문 콘솔 0건 |
| UD-E2E-01 | e2e | | role 변경 → 원복 검증 필수 |
| UD-E2E-02 | e2e | | 판정 (b) — 링크 노출+href 확인, 클릭은 테스트 계정 행 실재 시만(부재 시 조건부 SKIP) |
| UD-E2E-03 | e2e | | 밴/해제 원복 + RecentContentPane 회귀 |

## v175 시나리오 집계

- 총 11건 — [api] 5 / [unit] 3 / [e2e] 3
- 쓰기 액션은 e2e 2건(role, 밴)뿐 — 전부 테스트 계정 + 시나리오 내 원복 + 종료 시 GET 재검증. API/UNIT 은 전부 읽기 전용.

## 개정 이력 (v175)

- 2026-08-13 초판 작성 (11건) — planner 지정 항목 전부 시나리오화. PLAN §5-3 일부(미로그인 리다이렉트) 제외 및 §5-4 대체 확인 배치는 §4 질의로 planner 판정 대기. UD-E2E-02 는 테스트 계정 대상 신고 데이터 실재 여부 미확인 상태로 전제 조건부 작성.
- 2026-08-13 planner 판정 반영 — §4 질의 4건 전부 확정(1·3·4 승인, 2는 (b)+href 확인 보강). UD-E2E-02 본문 (b) 확정 재작성, UD-UNIT-02 에 400 경로(`/users/not-a-uuid`) 보조 확인 추가(구현이 400→not_found 화면 처리, AdminUserDetailPage.jsx:36 실측). **tester 1단계 착수 가능.**
- 2026-08-13 1단계 결과 8/8 PASS(픽스 0회, git 무변경 확인) — planner E2E 섹션 확정: E2E-01 "확인 다이얼로그" 문구 정정(role select 는 즉시 호출, 다이얼로그 없음 — 코드 실측), 보조② 를 1단계 기준 데이터 실값 기반 판정으로 보충. **tester 2단계(E2E) 착수 가능.**

# v176 — 관리자 앱 감사 로그 페이지 신설 (/logs) + 로그 필터·브로드캐스트 적재 보강 (2026-08-13 15:29)

팀: platform-music-admin-auditlog / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v176 §1-1 응답 스키마 실측, §2 설계 결정, §5 (planner 지정 항목), §6 리스크/강행 금지
대상: backend_9005 `GET /api/admin/logs` 필터·클램프 + admin_cs.py 브로드캐스트 감사 적재(9004 미러) / frontend_admin AdminLogsPage(/logs) + AdminLayout NavLink + App.jsx 라우트

## 0. 전제 및 안전 규칙

- **실사용자 무접촉**: 조회·쓰기 전부 기존 테스트 계정만 — `bcast_admin_test_*@test.invalid`(관리자) / `bcast_user_test_*@test.invalid`(일반). 크리덴셜 실값 기재 금지 — 플레이스홀더 사용.
  - `ADMIN_TOKEN` = 테스트 관리자 로그인 토큰 / `USER_TOKEN` = 테스트 일반 계정 로그인 토큰
  - `TEST_USER_ID` = 테스트 일반 계정 UUID (`GET /api/admin/users?search=bcast_user_test` 로 사전 확보)
  - `OFFICIAL_ID` = maidol_official user id (v174 방식 — 읽기 전용 SELECT, AL-API-08 잠금 키 조립용)
- **쓰기 허용 범위**: ① `TEST_USER_ID` 대상 role 변경(+원복) — AL-API-07/AL-E2E-02, v175 승인 패턴 ② AL-UNIT-03 의 admin_logs 임시 행 INSERT(+DELETE 원복 — PLAN §5-5 명시). 그 외 쓰기 금지.
- **실발송 금지 (v174 규칙 승계)**: 유효 body+관리자 토큰의 브로드캐스트 요청은 **Redis 잠금 선점 후 429 경로(AL-API-08) 단 1건**. `window.confirm` 은 전부 dismiss. 큐잉 성공 경로 실검증은 보류(AL-OPT-01).
- 강행 금지(PLAN §6): admin_logs ALTER 금지, details 에 text 원문·비밀값 저장 없음이 검증 대상(저장 확인이 아니라 **부재 확인**), api.js 인터셉터 무관.
- 환경: 9005·9004 백엔드, Redis, frontend_admin Vite dev(4001). 로그 추적자 `[AdminLogs]`.
- 감사 로그는 **삭제 불가 전제**(원복 개념 없음): AL-API-07/AL-E2E-02 의 role 변경·원복이 남기는 `change_role` 행 2건, AL-API-08 이후 상태는 잔존이 정상 — REPORT 비고에 생성 행 수만 기록. 단 AL-UNIT-03 의 임시 행은 테스트가 직접 INSERT 한 것이므로 DELETE 원복 필수.

## 1. [api] 시나리오 — `GET /api/admin/logs` + 적재 (기본 대상 9005)

### AL-API-01. 200 — 스키마 + created_at DESC 정렬 [api] — 핵심
- Given: `ADMIN_TOKEN` 확보
- When: `GET /api/admin/logs?page=1&limit=20` 을 `ADMIN_TOKEN` 으로 호출하면
- Then: HTTP 200. 응답이 PLAN §1-1 실측 스키마와 일치:
  - `logs[]` 각 행에 `id, admin_id, admin_nickname, action, target_type, target_id, details(object|null), created_at(ISO|null)` 8개 키 실재
  - `pagination` 에 `page, limit, total, totalPages` 실재, `limit == 20`
  - `logs` 가 `created_at` **내림차순**(인접 행 전체 쌍 비교 — 동일 시각 허용)
  - 이 응답을 이후 시나리오의 **기준 데이터**로 보관(필터 기대값·E2E 비교용)

### AL-API-02. action exact 필터 정합 [api] — 핵심
- Given: `ADMIN_TOKEN`, AL-API-01 기준 데이터에서 실재하는 action 1종 선정(기본 `change_role` — 부재 시 기준 데이터 내 임의 action)
- When: `GET /api/admin/logs?action={선정값}&limit=100` 호출하면
- Then: HTTP 200. 응답 `logs` **전 행의 `action` 이 필터값과 exact 일치**. `pagination.total` 이 필터 결과 건수와 정합(total ≤ 전체 total, 그리고 total ≤ 100 인 경우 `logs.length == total`). 무필터 대비 total 감소 또는 동일(증가 금지). 부분일치·대소문자 상이 값(예: `CHANGE_ROLE`)으로는 0건(exact match 확인).

### AL-API-03. target_type exact 필터 정합 [api]
- Given: `ADMIN_TOKEN`
- When: `GET /api/admin/logs?target_type=user&limit=100` 호출하면
- Then: HTTP 200. `logs` 전 행 `target_type == "user"`, total 정합(AL-API-02 와 동일 판정 기준). 보조: `action`+`target_type` 동시 지정 1회 — 두 조건 AND 로 전 행 일치(COUNT/SELECT WHERE 동일성 — PLAN §6 리스크 직접 검증).

### AL-API-04. limit 클램프 — 0→1, 999→100 [api]
- Given: `ADMIN_TOKEN`
- When: ① `GET /api/admin/logs?limit=0` ② `GET /api/admin/logs?limit=999` 각각 호출하면
- Then: 양쪽 모두 HTTP 200(4xx 아님).
  - ① `logs.length ≤ 1` 이고 `pagination.limit == 1` (0 → 하한 1 클램프)
  - ② `logs.length ≤ 100` 이고 `pagination.limit == 100` (999 → 상한 100 클램프)
  - 보조: `page=0` 1회 → 200 + `pagination.page == 1` (page ≥1 클램프)

### AL-API-05. 401 — 무토큰 [api]
- Given: 토큰 없음
- When: `GET /api/admin/logs` 를 Authorization 헤더 없이 호출하면
- Then: HTTP 401.

### AL-API-06. 403 — 일반 유저 토큰 [api]
- Given: `USER_TOKEN`
- When: 동일 요청을 `USER_TOKEN` 으로 호출하면
- Then: HTTP 403.

### AL-API-07. change_role 적재 — 변경+원복 2행 [api] — 핵심 (쓰기 — v175 승인 패턴)
- Given: `ADMIN_TOKEN`, `TEST_USER_ID`. 사전에 `GET /api/admin/logs?action=change_role&limit=1` 로 최신 change_role 행 id 기록
- When: ① `PUT /api/admin/users/{TEST_USER_ID}/role` 로 user → customer 변경 → ② `GET /api/admin/logs?action=change_role&limit=5` 조회 → ③ 동일 API 로 customer → user **원복** → ④ 재조회하면
- Then:
  - ② 최신 행: `action == "change_role"`, `admin_id` = 테스트 관리자 id, `target_type == "user"`, `target_id == TEST_USER_ID`, `details.role == "customer"`, 사전 기록 행보다 최신
  - ④ 최신 행: 동일 구조에 `details.role == "user"` — **원복도 적재됨** (신규 행 정확히 2건 증가)
  - details 에 이메일·비밀값 없음
- **원복 검증**: 종료 전 `GET /api/admin/users/{TEST_USER_ID}` 로 `role == "user"` 재확인(불일치 시 즉시 재시도 후 FAIL 기록). 생성된 로그 2행은 감사 기록으로 잔존(§0 — 삭제하지 않음).

### AL-API-08. 브로드캐스트 429 거절 경로 — cs_broadcast 미적재 확인 [api] — v174 절차 준수
- Given: `ADMIN_TOKEN`, `OFFICIAL_ID`. **요청 전에** redis-cli `SET dm:broadcast:lock:{OFFICIAL_ID} test-lock NX EX 30` → `OK` + TTL 양수 확인(실패 시 원인 파악 전 요청 금지 — v174 BC-API-06 동일). 사전에 `GET /api/admin/logs?action=cs_broadcast&limit=1` 로 total(`N0`) 기록
- When: 유효 body `{audience:"users", text:"lock-test"}` 로 `POST /api/admin/cs/broadcast` 호출하면
- Then: HTTP 429(v174 회귀 겸용). 직후 `GET /api/admin/logs?action=cs_broadcast` 의 `pagination.total == N0` — **거절 경로는 미적재**(적재는 큐잉 성공 시에만). 보조: v174 판정 방식대로 `GET /api/admin/cs/conversations` 전후 total 동일(발송 0건).
- Cleanup: `DEL dm:broadcast:lock:{OFFICIAL_ID}` (또는 TTL 자연 만료 — 상태 명시).

### AL-API-09. 9004 미러 — 대표 케이스 + 파일 diff [api] — 미러 규칙
- Given: 9004 기동, `USER_TOKEN`
- When: ① **9004** 의 `GET /api/admin/logs` 를 `USER_TOKEN` 으로 호출(AL-API-06 동일 요청 — 데이터 무관 케이스) ② `diff backend_9005/app/routes/admin.py backend_9004/app/routes/admin.py` 및 `admin_cs.py` 상호 diff 실행하면
- Then: ① HTTP 403 — 9005 와 동일 ② 두 파일 모두 **diff 없음**(PLAN §5-8 — 작업 전 diff 없음 실측이므로 작업 후에도 없어야 함). 보조(비용 낮음, 권장): 무토큰 401 1건 9004 재확인.

## 2. [unit] 시나리오 — 프론트 AdminLogsPage (브라우저 하니스, 4001 dev — v175 방식 승계)

### AL-UNIT-01. 테이블 렌더 + 시각 포맷 [unit] — 핵심
- Given: 관리자 로그인 상태, `/logs` 진입, AL-API-01 기준 데이터 보유
- When: 로딩 완료 후 테이블을 확인하면
- Then: PLAN §2 컬럼 구성대로 렌더 — 시각(utils/format.js `formatDate` 형식 `YYYY-MM-DD HH:mm`) / 관리자(admin_nickname 이 `/users/{admin_id}` Link) / 액션(등록 액션은 한글 라벨 badge — 예: change_role) / 대상(target_type 라벨 + target_id **원문 표기**, nowrap — planner 판정으로 문안 정정: 감사 로그 특성상 id 전체 표기가 대조·복사에 유리, 축약+title 안은 폐기) / 상세(details 1줄 요약, 길면 말줄임+title 전체). 첫 페이지 내용이 기준 데이터 최신 행들과 순서·값 일치. 페이지네이션 `{page}/{totalPages}` + limit 20.
- 보조(planner 마이크로픽스 반영 확인): `TARGET_TYPE_LABELS` 에 `feed`("피드")·`comment`("댓글") 포함 + 대상 유형 필터 select 에 두 옵션 노출 — report_* 행의 target_type 이 track/feed/comment 로 적재되는 실측(admin.py:1048)에 대응. 실 feed/comment 행 부재 시 select 옵션 노출 확인으로 갈음.

### AL-UNIT-02. 필터 변경 → 재조회 + page 리셋 [unit] — 핵심
- Given: `/logs` 에서 2페이지 이상으로 이동한 상태(총 21건 이상일 때 — 미만이면 1페이지 상태에서 재조회만 판정하고 비고 기록)
- When: 액션 필터를 특정 값(예: change_role)으로 변경하면
- Then: `getAdminLogs` 재호출(네트워크에 `action=` 파라미터 포함) + **page=1 로 리셋**되어 첫 페이지 표시, 테이블 전 행이 해당 액션만. target_type 필터도 동일 방식 1회(요청에 `target_type=` 포함 + page 리셋). "전체" 복귀 시 파라미터 제거·전체 목록 복원.

### AL-UNIT-03. 미등록 action fallback + cs_broadcast 라벨 [unit] — (쓰기 — 임시 행, PLAN §5-5 / planner 판정 §5-5 반영)
- Given: 테스트 DB admin_logs 에 임시 행 **2건** INSERT (`admin_id` 는 반드시 실재하는 테스트 관리자 id — JOIN users 충족 필수):
  - ① `action='zz_test_unknown_action'`, `target_type='user'`, `target_id=TEST_USER_ID`, `details='{"note":"v176 unit"}'`
  - ② `action='cs_broadcast'`, `target_type='broadcast'`, `target_id='users'`, `details='{"targets":0,"text_len":9}'` (text 원문 키 없음 — 적재 스키마와 동일 형태)
- When: `/logs` 새로고침(필요 시 action 필터로 해당 행 표시)하면
- Then: ① 미등록 action 이 **원문 그대로 + gray badge** 로 안전 렌더(화면 깨짐·빈 badge·콘솔 에러 없음 — PLAN §2 fallback 필수) ② `cs_broadcast` 행이 라벨 "전체 발송" badge + 대상 "브로드캐스트" 라벨로 렌더(ACTION_META·TARGET_TYPE_LABELS 실화면 확인 — AL-OPT-01 SKIP 보완).
- Cleanup: 임시 행 **2건 모두 DELETE 원복 필수**(id 기준) — 원복 실패 시 시나리오 FAIL.

### AL-UNIT-04. details null → '-' 처리 [unit]
- Given: details 가 null 인 행(기준 데이터에서 탐색; 없으면 AL-UNIT-03 임시 행을 details NULL 로 INSERT 해 겸용 — 동일 cleanup)
- When: 해당 행이 테이블에 렌더되면
- Then: 상세 칸이 `-` (또는 동등한 빈 값 표기)로 표시 — `undefined`/`null` 문자열·렌더 크래시 없음.

### AL-UNIT-05. 콘솔 — 민감정보 미출력 [unit] — 핵심
- Given: AL-UNIT-01~04 수행 세션의 브라우저 콘솔 기록(정상 로드 + 필터 변경 + 로드 실패 1회 유도 — 예: 백엔드 일시 중단 또는 네트워크 오프라인 토글 후 재시도)
- When: 콘솔 전체에서 `@test.invalid` 포함 문자열(이메일 원문)과 details 원문 값(ban reason 문자열·`details` JSON 덤프)을 검색하면
- Then: `[AdminLogs]` 로그 포함 **0건**. 실패 로그는 status 수준만(PLAN §2 — details 원문 콘솔 미출력 관행).

## 3. [e2e] 시나리오 — 핵심 여정만 (행동 수준, 아이스크림콘 금지)

### AL-E2E-01. 감사 로그 여정 — 진입→필터→user Link [e2e] — 핵심
- Given: 관리자 앱(4001)에서 테스트 관리자 계정으로 로그인
- When: 사이드바에서 6번째 메뉴 **"감사 로그"** 클릭 → 목록 렌더 확인 → 액션 필터를 change_role(또는 실재 액션)로 적용 → 필터 결과에서 target_type 이 user 인 행의 **대상 Link 클릭**하면
- Then: `/logs` 진입 + 사이드바 "감사 로그" active 하이라이트, 테이블 5컬럼 렌더, 필터 적용 후 해당 액션 행만 표시, 대상 클릭으로 `/users/{target_id}` 상세 페이지 이동·정상 렌더(v175 페이지 재사용). 콘솔 신규 에러 0건.
- 안전 경계: 클릭 대상 행은 `target_id == TEST_USER_ID` 인 행만(실사용자 상세 조회 금지 — AL-API-07 이 남긴 행 활용).
- 증적: 사이드바+목록·필터 적용 후·이동한 상세 페이지 스크린샷.

### AL-E2E-02. 회귀 — role 변경(원복) 후 로그 페이지에 새 행 2건 [e2e] — (쓰기 — v175 승인 패턴)
- Given: 관리자 로그인 상태, `/logs` 첫 페이지의 최신 행 기록(스크린샷)
- When: "사용자 관리" → `bcast_user_test` 검색 → 테스트 계정 role 을 user → customer 변경 → customer → user **원복** → "감사 로그" 페이지로 이동(또는 새로고침)하면
- Then: 목록 최상단에 `change_role` **새 행 2건**(변경+원복, 최신 순) 노출 — 관리자 닉네임·대상 id 원문·상세(role: customer / role: user) 표시. 감사 UI 가 실제 적재 파이프라인과 연동됨을 여정 수준에서 확인.
- **원복 검증**: 종료 전 `GET /api/admin/users/{TEST_USER_ID}` 로 `role == "user"` 재확인.
- 비고: AL-API-07 과 별도 실행 시 change_role 행이 총 4건 누적됨 — 정상(§0), 결과표 비고에 기록.

### AL-E2E-03. 회귀 — 기존 5페이지 + 브로드캐스트 400/429 불변 [e2e] — 회귀 핵심 (v174 비파괴 케이스 재사용)
- Given: 관리자 로그인 상태
- When: ① 대시보드/사용자/트랙/신고/CS 5페이지 순회 ② CS 페이지에서 브로드캐스트 모달 열기 → 빈 text 발송 시도(400 계열 클라이언트 차단 경로 — v174 BC-UNIT-01 재사용) ③ Redis 잠금 선점 상태에서(AL-API-08 과 연계 또는 재선점) 유효 입력+confirm **수락 대신** — API 레벨 429 는 AL-API-08 로 갈음하고 **E2E 에서는 confirm dismiss 로 POST 0건**(v174 BC-E2E-01 재사용)하면
- Then: ① 5페이지 정상 렌더 + 각 사이드바 active 하이라이트(NavLink 6개 체제에서 기존 5개 무손상) ② 빈 text 는 발송 차단 notice — v174 와 동일 ③ 네트워크에 `admin/cs/broadcast` POST 0건, 콘솔 신규 에러 0건. 브로드캐스트 적재 코드 추가가 기존 에러·차단 경로를 바꾸지 않음.
- 안전 경계: confirm 수락 절대 금지(실발송 0건). 429 실측은 [api] AL-API-08 담당.

## 4. 보류(옵션) — planner 판단 위임

### AL-OPT-01. 브로드캐스트 큐잉 성공 시 cs_broadcast 적재 확인 [api] — 보류
- 내용: 큐잉 성공 경로에서 `action=cs_broadcast, target_type=broadcast, target_id={audience}, details={targets, text_len}` 행 생성 + **details 에 text 원문 부재** 확인. 단 큐잉 성공 = 실발송이므로 v174 안전 규칙과 충돌.
- 선택지 (planner 판단 위임 — 지시 사항):
  - (a) **코드 리뷰로 갈음** (기본 권고): admin_cs.py 의 `_log_admin_action("cs_broadcast", ...)` 가 queue 성공 직후·try/except best-effort 로 배치됐고 text 원문 미전달임을 소스에서 확인, REPORT 에 미실행 사유 기재. (b) v174 BC-OPT-01 승인 시(최소 대상군 실발송)에만 함께 실측 — **사용자 명시 승인 없이는 수행 금지**.
- 이번 실행 기본값: **SKIP(코드 리뷰 갈음)** — planner 회신으로 확정.
- **planner 판정(2026-08-13): (a) 확정.** planner 가 소스 스팟체크로 1차 확인 완료(admin_cs.py:295~310 — 큐잉 성공 직후·거절 경로 미적재·text 원문 미전달·best-effort try/except). tester 는 동일 소스 확인을 재수행해 REPORT 에 기재. (b) 실측은 사용자 명시 승인 시 v174 BC-OPT-01 과 묶어 별도 사이클에서만.

## 5. planner 확인 필요 사항

1. **AL-OPT-01 처리 방식**: (a) 코드 리뷰 갈음 vs (b) v174 BC-OPT-01 과 묶어 사용자 승인 후 실측 — 지시대로 planner 판단 위임. 초안 기본값은 (a).
2. **필터 UI 형태 불일치**: PLAN §2 는 "target_type **버튼**(전체/user/track/report/broadcast) + action **select**", 팀 지시는 "필터 select 2종". AL-UNIT-02/AL-E2E-01 은 행동 수준("필터 적용")으로 작성해 양쪽 모두 판정 가능하나, 구현 확정 후 문안 일치 확인 요청.
3. **AL-UNIT-03/04 임시 행 INSERT**: PLAN §5-5 에 명시된 방식이나 tester 의 Postgres 직접 쓰기 접근이 전제 — 접근 불가 환경이면 fallback 검증을 프론트 라벨 맵 코드 리뷰로 대체할지 판정 필요.
4. **AL-API-08 미적재 판정**: `?action=cs_broadcast` total 전후 비교(API 읽기 전용)로 설계 — v174 §6-A-2 의 conversations 비교 방식과 병행. DB 직접 확인 요구 여부 회신.
5. **cs_broadcast 라벨 맵**: AL-UNIT-01 의 한글 badge 확인 대상에 `cs_broadcast` 포함 여부 — 실행 시점에 실 행이 없으면(AL-OPT-01 SKIP 시 필연) 라벨 맵 존재는 코드 확인으로 갈음하고 화면 확인은 AL-UNIT-03 임시 행 방식 재사용 가능(action='cs_broadcast' 임시 행) — 채택 여부 판정 요청.

### planner 판정 (2026-08-13, §5 1~5 전부 확정 — 본문 반영 완료)

1. **AL-OPT-01 = (a) 코드 리뷰 갈음 확정** — §4 에 판정 병기. 실측(b)은 사용자 명시 승인 전 수행 금지.
2. **필터 UI = select 2종 승인, PLAN 측 문안 수정으로 흡수** — PLAN.md v176 말미 정정 기록 참조. TESTPLAN 은 행동 수준 문안이라 수정 불요(현행 유지).
3. **AL-UNIT-03/04 임시 행 INSERT 허용** — v174~175 에서 tester 가 dev DB 직접 쓰기(role 승격·is_verified)를 수행한 전례로 접근 가능 판단. 조건: `admin_id` 는 실재 테스트 관리자 id(JOIN users inner — 임의 UUID 사용 시 행이 응답에서 누락되어 오판), id 기준 DELETE 원복, 사후 잔존 0건 확인. 접근 불가로 판명될 때만 코드 리뷰 대체 fallback.
4. **AL-API-08 판정 방식 승인** — `?action=cs_broadcast` 필터 한정 total 전후 비교는 노이즈가 차단되어 충분(dev DB 단독 사용 환경). DB 직접 확인 불요. conversations 비교 병행 유지.
5. **cs_broadcast 화면 확인 = 임시 행 방식 채택** — AL-UNIT-03 에 통합(2건 INSERT 로 확장, 본문 반영 완료). AL-OPT-01 SKIP 의 화면 측 보완.

추가 지시(스팟체크 발견): report_* 액션의 target_type 은 `track`/`feed`/`comment` 로 적재됨(admin.py:1048 실측) — 프론트 `TARGET_TYPE_LABELS`·필터 select 에 feed/comment 부재. frontend-dev 에 2줄 마이크로픽스 지시(feed:"피드", comment:"댓글" 추가). 미반영 상태의 행도 fallback 원문 표시로 안전(비차단). AL-UNIT-01 보조 확인으로 반영 검증.

## 6. 실행 순서 권고 (tester 참고)

1. AL-API-01~06 (읽기 전용 — 01 응답을 기준 데이터로 보관) → AL-API-07 (role 쓰기+원복) → AL-API-08 (잠금 선점→429→미적재→DEL) → AL-API-09 (9004)
2. AL-UNIT-01 → AL-UNIT-02 → AL-UNIT-03/04 (임시 행 INSERT→확인→DELETE) → AL-UNIT-05 (같은 세션 콘솔 검사 마감)
3. AL-E2E-01 → AL-E2E-02 (세션 재사용, 원복 검증) → AL-E2E-03
4. AL-OPT-01 은 planner 회신 전 수행 금지 — 기본 SKIP + REPORT 기재

## 7. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| AL-API-01 | api | | 스키마 8키 + DESC 정렬, 기준 데이터 보관 |
| AL-API-02 | api | | action exact + total 정합 |
| AL-API-03 | api | | target_type + AND 복합 보조 |
| AL-API-04 | api | | limit 0→1, 999→100, page 0→1 |
| AL-API-05 | api | | 401 |
| AL-API-06 | api | | 403 |
| AL-API-07 | api | | change_role 변경+원복 2행, role 원복 검증 |
| AL-API-08 | api | | 잠금 선점 429 — cs_broadcast 미적재 |
| AL-API-09 | api | | 9004 403 + admin.py·admin_cs.py diff 0 |
| AL-UNIT-01 | unit | | 5컬럼 + formatDate |
| AL-UNIT-02 | unit | | 필터 재조회 + page=1 리셋 |
| AL-UNIT-03 | unit | | 미등록 action fallback + cs_broadcast 라벨 — 임시 행 2건 DELETE 원복 필수 |
| AL-UNIT-04 | unit | | details null '-' |
| AL-UNIT-05 | unit | | 이메일·details 원문 콘솔 0건 |
| AL-E2E-01 | e2e | | 사이드바→필터→user Link→/users/:id |
| AL-E2E-02 | e2e | | 새 행 2건(변경+원복) |
| AL-E2E-03 | e2e | | 5페이지 + 브로드캐스트 v174 재사용, POST 0건 |
| AL-OPT-01 | 보류 | SKIP(확정) | planner 판정 (a) 코드 리뷰 갈음 — §4·§5-1 |

## v176 시나리오 집계

- 총 17건 + 보류 1건(AL-OPT-01) — [api] 9 / [unit] 5 / [e2e] 3
- 쓰기: role 변경+원복(API 1·E2E 1, v175 승인 패턴) + admin_logs 임시 행 INSERT/DELETE(UNIT, PLAN §5-5)뿐. 실발송 0건 설계(유효 body 요청은 잠금 선점된 AL-API-08 단 1건, E2E confirm 전부 dismiss).

## 개정 이력 (v176)

- 2026-08-13 초판 작성 (17+1건) — planner 지정 항목 전부 시나리오화. 브로드캐스트 적재는 429 미적재(비파괴)만 실측하고 큐잉 성공 적재는 AL-OPT-01 보류(코드 리뷰 갈음 기본값, planner 판단 위임). 필터 UI 형태(버튼 vs select) 불일치는 행동 수준 문안으로 흡수 후 §5-2 질의. planner 회신 대기: §5 1~5.
- 2026-08-13 planner 판정 반영 (planner 직접 수정) — §5 판정 블록 추가(1~5 확정: OPT-01=(a) SKIP 확정 / select 2종 PLAN 흡수 / 임시 행 INSERT 허용(admin_id 실재 id 조건) / API-08 필터 total 비교 승인 / cs_broadcast 임시 행 채택). AL-UNIT-03 을 임시 행 2건(미등록 action + cs_broadcast 라벨)으로 확장, AL-UNIT-01 에 feed/comment 라벨 마이크로픽스 보조 확인 추가, §4·결과표 갱신. tester 1단계([api]) 착수 가능 — feed/comment 픽스는 AL-UNIT-01 실행 전 랜딩 조건.
- 2026-08-13 1단계 결과 접수 후 planner 4단계 처리 (planner 직접 수정) — 1단계 14/14 PASS·픽스 0회·git 변경 파일 = v176 매트릭스 정확 일치 확인. 편차 1건(대상 셀 target_id 축약+title vs 풀 id 원문)은 **문안 흡수로 판정**: 감사 로그는 id 정확 대조·복사 가치가 축약 가독성보다 우선, 렌더 무결(nowrap+table-wrap 스크롤) — AL-UNIT-01(사후 정합)·AL-E2E-02 문안 정정, dev 픽스 없음. **E2E 섹션(AL-E2E-01~03) 현재 코드 기준 확정**: 사이드바 6번째 NavLink·5컬럼·필터 select·user Link(renderTarget)·브로드캐스트 모달 경로 무변경 대조 완료, 추가 수정 없음. E2E 착수 가능.

# v177 — 감사 로그 대상 닉네임#태그 표시 + CS 지정발송 (2026-08-13 16:34)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v177 §0 실측(hydrate_users 비uuid 안전·broadcast_message 루프·search_users 게이트), §1 설계 결정, §4 테스트 항목, §5 리스크/강행 금지
대상: backend_9005 `GET /api/admin/logs` additive 필드(`target_nickname`/`target_code`) + `GET /api/admin/cs/users/search` + `POST /api/admin/cs/send` + dm_service `_deliver_official_message` 추출 리팩터(9004 미러) / frontend_admin AdminCsSendModal(신설)·AdminCsPage 버튼·AdminLogsPage renderTarget

## 0. 전제 및 안전 규칙

- **크리덴셜 실값 기재 금지** — 플레이스홀더만 사용:
  - `ADMIN_TOKEN` = 테스트 관리자(`bcast_admin_test_*@test.invalid`) 로그인 토큰 / `USER_TOKEN` = 테스트 일반 계정 로그인 토큰
  - `TEST_USER_1_ID`/`TEST_USER_2_ID` = 테스트 일반 계정(`bcast_user_test_*@test.invalid`) UUID, `TEST_USER_1_CODE` 등 = 각 계정의 code(referral_code) — 사전에 `GET /api/admin/cs/users/search?q=bcast_user_test` (또는 `GET /api/admin/users?search=`) 로 확보해 **발송 대상 허용 목록으로 고정**
  - `OFFICIAL_ID` = maidol_official user id (읽기 전용 SELECT — v174 방식, CS-API-15 잠금 키 조립용)
  - `GHOST_UUID` = 형식은 유효하나 **미존재**인 UUID (예: `00000000-0000-4000-8000-0000000000aa`) — 사용 전 `GET /api/admin/users/{GHOST_UUID}` 404 로 부재 확정
- **실발송 허용 범위 (planner 승인된 유일한 실발송)**: `POST /api/admin/cs/send` 의 대상 = **위 허용 목록의 테스트 계정 UUID 만**. 시나리오별 실발송 대상·건수를 본문에 명시(CS-API-09: 2건 / CS-API-14: 1건 / CS-E2E-01: 2건 / CS-E2E-03 답장: 1건 — 총 최대 6건, 전부 official→테스트 계정 DM). **실사용자 UUID 를 user_ids 에 넣는 호출 절대 금지** — 매 발송 직전 user_ids 를 허용 목록과 대조 후 호출.
- **브로드캐스트 실발송 금지 (v174 규칙 승계)**: 유효 body+관리자 토큰의 broadcast 요청은 Redis 잠금 선점 후 429 경로(CS-API-15) 단 1건. E2E 의 브로드캐스트 confirm 은 전부 dismiss.
- **감사 행 삭제 금지**: 테스트가 생성하는 `cs_send`(및 CS-API-06 채택 시 ban/unban) 감사 행은 감사 무결성상 **삭제하지 않고 잔존** — REPORT 에 생성 행 수·target·시각 범위를 명시(방침 고정). 단 CS-API-02 fallback 의 임시 행(직접 INSERT)은 v176 승인 패턴대로 id 기준 DELETE 원복 필수.
- **DM 대화 정리**: 테스트로 생성된 official↔테스트 계정 대화·메시지는 잔존 허용(테스트 계정 전용) — 기본 잔존 + REPORT 기재, planner 가 삭제 지시 시에만 Mongo 에서 해당 대화 한정 삭제.
- 강행 금지(PLAN §5): 게이트(assert_can_dm) 우회 없음 — failed 는 오류가 아닌 집계 대상. `/logs` 기존 필드 불변(additive only)이 검증 대상. details 본문 원문 **부재 확인**(저장 확인 아님). admin_logs ALTER·api.js 인터셉터 무관.
- 환경: 9005·9004 백엔드, Redis, Mongo, frontend_admin Vite dev(4001). 로그 추적자 `[AdminCsSend]`(신규)·`[AdminLogs]`·`[AdminCs]`.

## 1. [api] 시나리오 — ① logs additive (기본 대상 9005)

### CS-API-01. `GET /logs` 200 — user 행 target_nickname/target_code + 기존 스키마 불변 [api] — 핵심
- Given: `ADMIN_TOKEN`. 기준 계정 정보(TEST_USER_1 의 현재 닉네임·code) 확보. `target_type=user` 행이 최소 1건 존재(v176 이후 change_role 행 등 — 부재 시 CS-API-14 이후 재실행)
- When: `GET /api/admin/logs?limit=100` 호출하면
- Then: HTTP 200.
  - **user 타입 행**: `target_nickname`(string)·`target_code`(string|null) 키 실재. `target_id == TEST_USER_1_ID` 인 행에서 값 == 현재 닉네임/code (검색 API 응답과 교차 대조)
  - **비 user 행**(track/report/broadcast 등): 두 필드 모두 **null**
  - 기존 8키(`id, admin_id, admin_nickname, action, target_type, target_id, details, created_at`) 전 행 실재 + `pagination` 4키 + `created_at` DESC — **v176 AL-API-01 스키마 회귀**(제거·개명 0건, additive only)
  - 이 응답을 이후 시나리오 기준 데이터로 보관

### CS-API-02. 비 uuid target_id 행 무오류 [api]
- Given: `ADMIN_TOKEN`. 기준 데이터에서 **비 uuid target_id** 행 탐색(report 의 ObjectId, cs_broadcast 의 `users` 등). 부재 시 v176 §5-3 승인 패턴 재사용 — `action='cs_broadcast', target_type='broadcast', target_id='users', admin_id=실재 테스트 관리자 id` 임시 행 1건 INSERT (planner 확인 §5-6)
- When: 해당 행이 포함되는 페이지를 `GET /api/admin/logs` (필요 시 `?action=` 필터)로 호출하면
- Then: HTTP **200 — 500 없음**(hydrate_users 후처리의 비 uuid 안전 skip 검증). 해당 행 `target_nickname`/`target_code` == null, 나머지 필드 정상. 다른 user 행의 hydrate 결과에 영향 없음(혼재 페이지에서 판정).
- Cleanup: 임시 행 사용 시 id 기준 DELETE + 잔존 0건 확인.

### CS-API-03. v176 회귀 — 필터·페이지네이션·클램프 불변 [api]
- Given: `ADMIN_TOKEN`, 기준 데이터
- When: ① `?action={실재 액션}&limit=100` ② `?target_type=user&limit=100` ③ `?limit=0` / `?limit=999` / `?page=0` 각각 호출하면
- Then: ①② 전 행 exact 일치 + total 정합(v176 AL-API-02/03 판정 기준) — 필터 결과 행에도 신규 2필드 규칙(user=값·비user=null) 동일 적용. ③ 200 + `limit` 0→1, 999→100, `page` 0→1 클램프(v176 AL-API-04 동일). 후처리 추가가 필터·클램프 경로를 바꾸지 않음.

## 2. [api] 시나리오 — ② 검색 `GET /api/admin/cs/users/search`

### CS-API-04. 닉네임 부분매칭 [api] — 핵심
- Given: `ADMIN_TOKEN`, 테스트 계정 닉네임 확인
- When: `GET /api/admin/cs/users/search?q={테스트 계정 닉네임의 부분 문자열}` 호출하면
- Then: HTTP 200. 결과에 해당 테스트 계정 포함, 각 항목 `{id, nickname, profile_image, code}` — **code 실재**(모달 `닉네임#code` 표시·발송 게이트 정합의 근거). official 자기 자신 미포함(search_users me 제외 실측). 무의미 문자열(q=`zzzz_none`)은 빈 배열.

### CS-API-05. #태그 정확매칭 [api]
- Given: `ADMIN_TOKEN`, `TEST_USER_1_CODE`
- When: ① `?q=%23{TEST_USER_1_CODE}` (`#code` URL 인코딩) ② `?q=%23ZZZZ`(미존재 태그) 각각 호출하면
- Then: ① 정확히 1건 — `id == TEST_USER_1_ID` ② 0건. 부분 태그(`#{code 앞 일부}`)는 정확매칭 아님(0건 또는 ILIKE 미적용 — v156 사양 준수) 확인.

### CS-API-06. 밴 계정 미노출 [api] — (쓰기 — ban+원복, planner 승인 완료 §6-1)
- Given: `ADMIN_TOKEN`, `TEST_USER_2_ID`. 사전 검색으로 TEST_USER_2 가 결과에 노출됨 확인
- When: ① TEST_USER_2 를 관리자 ban API 로 밴(사유 = "v177 test ban — will revert") ② 동일 q 로 재검색 ③ **즉시 unban 원복** ④ 재검색하면
- Then: ② 결과에서 TEST_USER_2 **미노출**(active·비밴만 — search_users WHERE 실측 정합) ④ 재노출. 종료 전 `GET /api/admin/users/{TEST_USER_2_ID}` 로 비밴 상태 재확인(불일치 시 즉시 재시도 후 FAIL 기록). ban/unban 감사 행 잔존은 정상 — REPORT 기재.
- planner 판정(§6-1): **승인** — 대상은 TEST_USER_2 한정, unban 원복·비밴 재확인까지 원자적 수행, **CS-API-09 이전에 원복 완료 필수**(발송 게이트 ③ 오염 방지). ban API 자체가 실패하는 환경에서만 코드 리뷰 갈음+SKIP.

### CS-API-07. limit 클램프 1~20 [api]
- Given: `ADMIN_TOKEN`
- When: ① `?q=bcast&limit=0` ② `?q=bcast&limit=999` 각각 호출하면
- Then: 양쪽 200(4xx 아님). ① 결과 ≤1건(하한 1) ② 결과 ≤**20**건(상한 20 — 브로드캐스트용 100 아님). 문안 확정(§6-3): 구현이 `limit` 쿼리 파라미터를 받아 `max(1, min(int(limit), 20))` 클램프함을 planner 코드 실측(admin_cs.py `search_cs_users`) — 축소 판정 조항 폐기.

### CS-API-08. 401·403 — 검색·발송 공통 [api]
- Given: 토큰 없음 / `USER_TOKEN`
- When: ① `GET /admin/cs/users/search?q=x` 무토큰 ② 동일 요청 `USER_TOKEN` ③ `POST /admin/cs/send`(body `{user_ids:[TEST_USER_1_ID], text:"auth-test"}`) 무토큰 ④ 동일 body `USER_TOKEN` 으로 각각 호출하면
- Then: ①③ HTTP 401, ②④ HTTP 403. ③④는 인증 게이트에서 거절되므로 **발송 0건**(보조: `GET /admin/cs/conversations` total 불변).

## 3. [api] 시나리오 — ② 발송 `POST /api/admin/cs/send`

### CS-API-09. 정상 발송 — 테스트 계정 2명 실발송 [api] — 핵심 (실발송 2건: official→TEST_USER_1·2)
- Given: `ADMIN_TOKEN`. user_ids 허용 목록 대조 완료. 사전 기록: `GET /admin/cs/conversations` total(`N0`) + 두 대상 대화 존재 여부, `GET /admin/logs?action=cs_send` total(`L0`). text = `"[v177 테스트] CS 지정발송 검증 {실행시각}"` (민감정보 없음, ≤2000자, `TEXT_LEN` 기록)
- When: `POST /api/admin/cs/send` body `{user_ids:[TEST_USER_1_ID, TEST_USER_2_ID], text}` 호출하면
- Then: HTTP 200 **동기** 응답 `{requested:2, sent:2, failed:0, failed_ids:[]}` (게이트 전제 **성립 판정** §6-2 — 수신자 is_verified 는 게이트 비대상이라 bcast_user_test 미인증이어도 무관. 단 CS-API-06 unban 원복 완료 후 실행).
  - `GET /admin/cs/conversations` — 두 대상 대화가 목록에 수렴(신규 생성 또는 기존 갱신, 최신 메시지 == text, N0 대비 증가분 정합)
  - 교차 검증(가능 시): `USER_TOKEN`(TEST_USER_1) 으로 수신측 DM 조회 — 대화 status **accepted**(pending 승격 경로 포함) + 수신 메시지 text 일치
  - 응답 시간이 동기 관행 범위(수 초 내 — BackgroundTasks 아님 정황) 기록

### CS-API-10. cs_send 감사 적재 — 대상별 1행 + 본문 원문 부재 [api] — 핵심
- Given: CS-API-09 직후, `L0`·`TEXT_LEN` 보유
- When: `GET /api/admin/logs?action=cs_send&limit=10` 호출하면
- Then: 최신 2행(total == L0+2):
  - 각 행 `action=="cs_send"`, `target_type=="user"`, `target_id` ∈ {TEST_USER_1_ID, TEST_USER_2_ID} (대상별 1행), `admin_id` == 호출 관리자 id
  - `details` == `{result:"sent", targets:2, text_len:TEXT_LEN}` **만** — details 직렬화 전체에서 발송 본문 문자열 검색 **0건**(본문·토큰·이메일 미저장)
  - ①번 기능과의 시너지: 이 행들의 `target_nickname`/`target_code` 가 테스트 계정 닉/코드로 채워짐(UI 렌더는 CS-E2E-01 담당)

### CS-API-11. 400 — 빈 user_ids·비 uuid 형식 [api]
- Given: `ADMIN_TOKEN`
- When: ① `{user_ids:[], text:"x"}` ② `{user_ids:["not-a-uuid"], text:"x"}` 각각 호출하면
- Then: 모두 HTTP **400 확정**(§6-7 — 구현 실측: 수동 검증 전부 JSONResponse 400. 422 는 body 형 위반(`user_ids` 키 누락·리스트 아님 등 Pydantic 레벨)에서만 발생 — 본 시나리오 범위 밖, 관측 시 FAIL). 발송 0건(conversations total 불변 보조).

### CS-API-12. 400 — 21명 상한 초과 + 전체발송 유도 메시지 [api]
- Given: `ADMIN_TOKEN`. user_ids = 테스트 계정 2 + 형식 유효 미존재 UUID 19개(**실사용자 UUID 절대 금지** — GHOST 패턴 일련번호로 생성), dedupe 후 21개
- When: `POST /api/admin/cs/send` 호출하면
- Then: HTTP 400 + 에러 메시지에 **"전체 발송" 유도 문구**(PLAN §1 확정 문안 "20명 초과는 전체 발송을 이용해주세요" 취지) 포함. 상한 판정이 발송 루프 **앞**임을 확인 — conversations·cs_send total 불변(발송 0건).

### CS-API-13. 400 — text 위반 (빈/2001자) [api]
- Given: `ADMIN_TOKEN`, user_ids = [TEST_USER_1_ID] (유효 대상이어도 검증 선행)
- When: ① `text:""`(및 공백만 1회) ② `text:"a"×2001` 각각 호출하면
- Then: 모두 HTTP 400 (MAX_TEXT_LEN=2000 준수). 발송 0건. 경계 보조: 2000자 정확 길이는 CS-API-09 계열 실발송을 늘리지 않기 위해 **미실측**(코드 리뷰로 경계 포함 여부 확인, REPORT 기재).

### CS-API-14. 미존재 UUID 혼합 → failed 집계 + dedupe [api] — (실발송 1건: official→TEST_USER_1)
- Given: `ADMIN_TOKEN`, `GHOST_UUID` 부재 확정(404). user_ids = `[TEST_USER_1_ID, TEST_USER_1_ID, GHOST_UUID]` (중복 1 + 미존재 1)
- When: `POST /api/admin/cs/send` (text = `"[v177 테스트] failed 집계 검증 {실행시각}"`) 호출하면
- Then: HTTP 200 — `{requested:2, sent:1, failed:1, failed_ids:[GHOST_UUID]}`:
  - **dedupe**: 중복 제거 후 requested==2 (3 아님)
  - **failed 집계**: 미존재 대상은 게이트(assert_can_dm 상대 존재 확인)에서 best-effort 실패 — 500 아님
  - 감사: `?action=cs_send` 최신 2행 — TEST_USER_1 행 `details.result=="sent"`, GHOST_UUID 행 `details.result=="failed"`·`targets:2`. GHOST 행의 `target_nickname` == null(hydrate 실패 → UI fallback 근거, CS-E2E-02 에서 활용)

### CS-API-15. 회귀 — 브로드캐스트 400·429 경로 불변 + 리팩터 코드 리뷰 [api] — 회귀 핵심 (v174 비파괴 재사용)
- Given: `ADMIN_TOKEN`, `OFFICIAL_ID`. 사전 `GET /admin/cs/conversations` total 기록
- When: ① `POST /admin/cs/broadcast` 빈 text → ② 잘못된 audience(예: `"nobody"`) → ③ redis-cli `SET dm:broadcast:lock:{OFFICIAL_ID} test-lock NX EX 30` OK+TTL 확인 **후** 유효 body `{audience:"users", text:"lock-test"}` 호출하면
- Then: ① ② HTTP 400 ③ HTTP **429**(잠금 선점 — 실발송 0건, conversations total 불변) — v174·v176 AL-API-08 판정 방식 동일.
  - 보조(코드 리뷰 — 실측 갈음): dm_service.py 에서 `broadcast_message` 가 `_deliver_official_message` 를 호출하는 순수 리팩터인지 확인 — **시그니처·반환 구조·게이트(assert_can_dm)·pending 조건부 승격·best-effort 집계·로그 문구 불변**(PLAN §5-③). 발견 편차는 즉시 planner 보고.
- Cleanup: `DEL dm:broadcast:lock:{OFFICIAL_ID}` (또는 TTL 만료 — 상태 명시).

### CS-API-16. 9004 미러 — 파일 diff + 대표 403 [api] — 미러 규칙
- Given: 9004 기동, `USER_TOKEN`
- When: ① `diff` 3파일 상호 비교 — `backend_9005/app/routes/admin.py`↔9004, `admin_cs.py`↔9004, `app/services/dm_service.py`↔9004 ② **9004** `GET /api/admin/cs/users/search?q=x` 를 `USER_TOKEN` 으로 호출하면
- Then: ① 3파일 모두 diff 0(PLAN §0-3 — 작업 전 byte-identical 실측 유지) ② HTTP 403 — 9005 와 동일(대표 케이스). 9004 에 대한 발송 호출은 **하지 않음**(실발송 중복 회피 — 미러 diff 0 으로 동작 동일성 갈음).

## 4. [unit] 시나리오 — AdminCsSendModal (브라우저 하니스, 4001 dev — v175~176 방식 승계)

### CS-UNIT-01. 모달 열기 + 검색 debounce·결과 렌더 [unit] — 핵심
- Given: 관리자 로그인, CS 페이지(`/cs`) 진입 — 헤더에 📢 옆 **"✉️ 지정 발송"** 버튼 노출
- When: 버튼 클릭 → 모달 오픈 → 검색 input 에 `bcast_user` 를 빠르게 연속 타이핑하면
- Then: 네트워크 탭에 `admin/cs/users/search` 요청이 타이핑 중 남발되지 않고 **입력 종료 후 1회**(debounce 300ms 동작 판정 — 최종 q 로 1건이면 PASS, 중간 요청 잔존 시 횟수 기록). 결과 리스트에 테스트 계정이 **`닉네임#code`** 로 렌더. 검색어 전부 삭제 시 결과 초기화·불필요 요청 없음.

### CS-UNIT-02. chips 추가/제거/중복·20명 상한 차단 [unit] — 핵심
- Given: CS-UNIT-01 모달 상태
- When: ① 결과 항목 클릭 → ② 동일 항목 재클릭 → ③ chip 의 × 클릭 → ④ (계정 풀 충분 시) 20개 선택 후 21번째 추가 시도하면
- Then: ① chip 추가(`닉네임#code` + × 버튼) ② **중복 추가 안 됨**(chip 1개 유지) ③ 제거 정상 ④ 추가 **차단** + 상한 안내 문구(발송 요청 아님 — 네트워크에 send POST 0건).
- ④ 판정 확정(§6-4): 시드 확장 없이 **코드 리뷰 + CS-API-12 갈음 채택** — planner 가 모달 `handlePick` 의 `selected.length >= MAX_TARGETS(20)` 차단+안내 문구를 코드 실측 완료. tester 는 ①~③ 실측 + ④ 는 비고에 "코드 리뷰 갈음(§6-4)" 기재 후 PASS/FAIL 판정(SKIP 아님).

### CS-UNIT-03. 발송 가드 — 대상 0명·빈 text 차단 [unit]
- Given: 모달 오픈 상태
- When: ① 대상 0명 + text 입력 후 발송 시도 ② 대상 1명(테스트 계정) 선택 + text 빈 값으로 발송 시도 ③ textarea 에 2000자 초과 입력 시도하면
- Then: ①② 발송 차단(버튼 비활성 또는 안내) — **confirm 미노출 + 네트워크 send POST 0건** ③ maxLength 제한 또는 발송 차단(2000자 초과 전송 불가). 전 과정 실발송 0건.

### CS-UNIT-04. 콘솔 — 닉네임·본문 원문 미출력 [unit] — 핵심
- Given: CS-UNIT-01~03 수행 세션의 콘솔 기록(+ 검색 실패 1회 유도 — 백엔드 일시 중단 또는 오프라인 토글)
- When: 콘솔 전체에서 ① 테스트 계정 닉네임 문자열 ② 입력했던 본문 원문 ③ `@test.invalid` 이메일을 검색하면
- Then: `[AdminCsSend]` 로그 포함 전부 **0건** — 로그는 status·건수 수준만. 검색/발송 실패 시에도 응답 덤프 미출력.

## 5. [e2e] 시나리오 — 핵심 여정만 3건 (행동 수준)

> **planner E2E 착수 확정 (1단계 20/20 PASS 반영)**: 실발송 잔여 예산 **3건 = E2E 설계(E2E-01 2 + E2E-03 답장 1)와 정확히 일치 — 초과 금지**. TEST_USER_2 는 1단계에서 신설된 계정으로 허용 목록에 포함 확정. GHOST failed 행(E2E-02 전제)은 1단계 CS-API-14 로 생성 완료 — 추가 발송 불요. 주의: 감사 로그·CS 목록에 07:20 경 maidol_official 유래 `cs_broadcast` 실발송 흔적 잔존(사용자 수동 E2E 추정, 비버그) — E2E 판정에 혼입하지 말 것(아래 각 시나리오 보충 참조).

### CS-E2E-01. 지정발송 풀 여정 — 검색→2명→confirm 수락→감사 로그 닉네임#태그 [e2e] — 핵심 (실발송 2건: official→테스트 계정 2명)
- Given: 관리자 앱(4001) 테스트 관리자 로그인, `/cs` 진입. 대상 = 테스트 계정 2명만(허용 목록 — TEST_USER_1 + **1단계 신설 TEST_USER_2**, 발송 직전 UUID 대조)
- When: "✉️ 지정 발송" 클릭 → `bcast_user_test` 검색 → 테스트 계정 **2명** 선택(chips 확인) → 본문 `"[v177 E2E] 지정발송 여정 {실행시각}"` 입력 → 발송 → `window.confirm` 문안에서 **대상 닉네임 나열+2명**이 허용 목록과 일치함을 최종 대조 → **수락**하면
- Then: 발송 완료 alert(sent=2 취지) → 모달 닫힘 → CS 목록에 두 대상 대화가 최신으로 **수렴**(onSuccess 갱신 — 수동 새로고침 불요) → "감사 로그" 페이지 이동 → action=cs_send 필터 → 최신 2행의 대상 셀이 **`사용자 닉네임#code` Link**(title=uuid 원문)로 렌더 → Link 클릭 시 `/users/{uuid}` 이동 정상. 콘솔 신규 에러 0건.
- 안전 경계: confirm 문안의 대상이 테스트 계정 2명과 다르면 **즉시 dismiss 후 FAIL**. 실사용자 상세 진입 금지(클릭 행은 테스트 계정 행만).
- 증적: 모달(chips)·confirm 직전·완료 alert·CS 목록·감사 로그 렌더 스크린샷.

### CS-E2E-02. 감사 로그 표시 — 닉네임 표시 + fallback + title=uuid [e2e] — 핵심
- Given: 관리자 로그인, `/logs` 진입. GHOST_UUID 의 cs_send failed 행은 **1단계 CS-API-14 PASS 로 존재 확정 — 잔존 행 활용, 추가 발송 불요**
- When: ① 해석 가능한 user 행(테스트 계정 대상 — change_role·cs_send 행)과 ② GHOST_UUID 행 ③ 비 user 행(track/report/broadcast)을 각각 확인하면
- Then: ① `사용자 {닉네임}#{code}` Link + **title 속성 == uuid 원문**(브라우저 툴팁/DOM 검사) — code null 계정이 있으면 닉네임만 표기(보조) ② hydrate 실패 행은 기존 **`사용자 #id` fallback** 그대로(빈 표기·크래시 없음) ③ 비 user 행 기존 표기 불변(v176 렌더 회귀). 콘솔 신규 에러 0건.
- 증적: ①②③ 각 행 렌더 + title 툴팁 스크린샷.

### CS-E2E-03. 회귀 — 전체 발송 모달(dismiss)·CS 답장·기존 페이지 [e2e] — 회귀 핵심 (실발송 1건: 답장 official→테스트 계정)
- Given: 관리자 로그인 상태
- When: ① `/cs` 에서 📢 전체 발송 모달 열기 → 유효 입력 → confirm **dismiss** ② official↔테스트 계정 기존 대화(**1단계 CS-API-09 발송으로 존재 확보 — TEST_USER_1 대화 권장**) 선택 → 답장 1건(`"[v177 E2E] 회귀 답장"`) 전송 ③ 대시보드/사용자/트랙/신고/감사 로그 페이지 순회하면
- Then: ① **이번 E2E 세션 네트워크 탭 기준** `admin/cs/broadcast` POST **0건**(v174 규칙) — 지정 발송 버튼 추가가 기존 모달 동선을 훼손하지 않음. 감사 로그·대화 목록의 **기존 07:20 cs_broadcast 잔존 흔적(사용자 수동 발송 추정)은 판정 무관 — 혼입 금지** ② 답장 정상 전송·대화에 표시(reply 동기 관행 회귀) ③ 5페이지 정상 렌더 + 사이드바 active + 콘솔 신규 에러 0건.
- 안전 경계: 답장 대상은 official↔**테스트 계정** 대화만. 브로드캐스트 confirm 수락 절대 금지.

## 6. planner 확인 필요 사항

1. **CS-API-06 ban+unban 쓰기**: 밴 계정 검색 미노출 실측에 TEST_USER_2 일시 밴(+즉시 원복)이 필요 — PLAN §4 에 명시되지 않은 쓰기(v175 role 변경 승인 패턴의 유사 적용). 승인 여부 회신. 불허 시 search_users WHERE 조건 코드 리뷰 갈음+SKIP.
2. **CS-API-09 게이트 통과 전제**: sent==2 판정은 테스트 계정이 assert_can_dm 풀 게이트(미성년 팔로우 요건·dm_blocks 등)를 통과한다는 전제 — 테스트 계정 시드 상태(성인·비차단) 사전 확인을 tester 절차에 포함했으나, 시드 상태가 다르면 기대값(sent/failed 배분) 조정 필요. 시드 확정 상태 회신.
3. **검색 limit 파라미터**: 팀 지시는 "limit 1~20 클램프", PLAN §1 결정표에는 클램프 명시 없음 — 구현이 limit 쿼리 파라미터를 받는지 확정 후 CS-API-07 문안 고정(미수신 구현이면 "기본 ≤20 반환"으로 축소).
4. **CS-UNIT-02 상한 실측**: 테스트 계정 풀이 21명 미만이면 UI 상한 ④는 코드 리뷰+CS-API-12 로 갈음(기본값). 시드 확장(계정 추가 생성)으로 실측할지 판정 위임.
5. **실발송 총량**: 설계 합계 최대 6건(API 3 + E2E 2 + 답장 1, 전부 official→테스트 계정) — 승인 범위 내인지 확인. 대화·메시지는 기본 잔존+REPORT 기재로 설계(삭제 지시 시에만 Mongo 해당 대화 한정 삭제).
6. **CS-API-02 임시 행 INSERT**: 실 비 uuid 행 부재 시에만 v176 §5-3 승인 패턴(admin_id 실재 조건·DELETE 원복) 재사용 — 재승인 확인.
7. **400 vs 422**: CS-API-11~13 의 검증 실패 상태 코드가 FastAPI 기본 422 로 구현될 가능성 — PLAN 은 400 명시. 구현 확정 후 기대값 통일 회신(초안은 400 기준, 422 관측 시 비고 기록 후 판정 보류).

### planner 판정 (2026-08-13, 코드 실측 근거 — 7건 전부 확정, 해당 시나리오 문안 반영 완료)

1. **CS-API-06 ban+unban — 승인.** v175 role 변경(쓰기+원복) 승인 패턴 준용. 조건: 대상 TEST_USER_2 한정·즉시 unban·비밴 재확인, **CS-API-09 이전 원복 완료 필수**(§7 실행 순서에 이미 06→09 순서 확보). ban/unban 감사 행 잔존 정상(§0 방침).
2. **CS-API-09 게이트 전제 — 성립 (기대값 sent:2 유지).** 코드 실측: `assert_can_dm`(dm_service.py:199)은 **발신자(me=official)의 is_verified 만 검사**(:222-227) — 수신자 is_verified 는 게이트 비대상이므로 bcast_user_test 미인증 여부는 무관. 수신자 측 게이트는 ②존재 ③비밴 ④미성년(`is_under_14` — `models/user.py:29` **birth_date None→False, 게이트 미적용** — 테스트 계정은 birth_date 미입력 시드) ⑥dm_blocks 뿐. ⑤관계는 deny 없이 pending 판정용이고 `send_to_users`→`_deliver_official_message` 가 pending 을 조건부 승격. 방증: v174 에서 official→bcast_user_test 개별 DM 1건 실발송 성공 잔존(REPORT v174). → 시드 재확인 절차는 유지하되 기대값 조정 불요.
3. **검색 limit — 구현 확정 반영.** admin_cs.py `search_cs_users` 가 `limit` 쿼리 파라미터 수신 + `max(1, min(int(limit), 20))` 클램프 실측. CS-API-07 축소 조항 폐기, 문안 고정 완료.
4. **CS-UNIT-02 ④ — 코드 리뷰+CS-API-12 갈음 확정 (시드 확장 안 함).** 테스트 계정 21개 생성은 잔존 데이터 대비 실익 없음. planner 가 AdminCsSendModal.jsx `handlePick` 상한 차단(`selected.length >= MAX_TARGETS`)+안내 문구 코드 실측 완료 — tester 는 비고 기재 후 정식 판정(SKIP 아님).
5. **실발송 총량 — 6건 승인** (send 5: API-09 2 + API-14 1 + E2E-01 2, reply 1: E2E-03. 전부 official→테스트 계정, 매 발송 직전 허용 목록 대조 §0 유지). 대화·메시지 **기본 잔존 + REPORT 기재 확정** — 삭제 지시 없음.
6. **CS-API-02 임시 행 INSERT — 재승인.** v176 §5-3 승인 패턴 그대로(admin_id 실재 테스트 관리자·id 기준 DELETE 원복·잔존 0건 확인). 실 비 uuid 행이 이미 있으면 INSERT 생략이 우선.
7. **400 확정.** 구현 실측: `POST /send` 의 빈 대상/상한 초과/비 uuid 형식/text 위반 전부 **수동 검증 JSONResponse 400**(admin_cs.py `send_cs_direct` — Pydantic 은 `user_ids: list[str]`/`text: str` 형만 강제). 422 는 body 형 위반(키 누락 등)에서만 — 시나리오 밖, 관측 시 FAIL. **CS-API-11(비 uuid→400 즉시 거절)과 CS-API-14(형식 유효+미존재 GHOST_UUID→failed 집계) 정합 확인 완료** — 14 가 GHOST_UUID 사전 404 확정 절차를 이미 포함하므로 설계 충돌 없음.

## 7. 실행 순서 권고 (tester 참고)

1. 사전 준비: 테스트 계정·code·OFFICIAL_ID·GHOST_UUID(404 확인) 확보 → 허용 목록 고정
2. CS-API-01~03 (①, 읽기 전용 — 02 임시 행 필요 시 INSERT→확인→DELETE) → CS-API-04~08 (검색 — 06 은 planner 승인 후, ban→검색→unban 원자적 수행) → CS-API-11~13 (비발송 검증 경로 먼저) → CS-API-09→10 (실발송 2+감사) → CS-API-14 (실발송 1) → CS-API-15 (잠금→429→DEL) → CS-API-16 (9004)
3. CS-UNIT-01→02→03 (실발송 0건 구간) → CS-UNIT-04 (같은 세션 콘솔 마감)
4. CS-E2E-01 (실발송 2 — confirm 문안 대조 후 수락) → CS-E2E-02 (API-14 잔존 행 활용) → CS-E2E-03 (broadcast dismiss·답장 1)
5. 종료: cs_send·ban 감사 행 잔존 내역 + DM 대화 잔존 내역 REPORT 정리(삭제하지 않음)

## 8. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| CS-API-01 | api | | user 행 2필드 + 8키·DESC 불변 (v176 회귀) |
| CS-API-02 | api | | 비 uuid 행 500 없음·null — 임시 행 시 DELETE 원복 |
| CS-API-03 | api | | 필터·클램프 v176 재확인 |
| CS-API-04 | api | | 닉 부분매칭 + code 실재 + official 제외 |
| CS-API-05 | api | | #태그 정확 1건 / 미존재 0건 |
| CS-API-06 | api | | 밴 미노출 — ban+unban 원복 (planner §6-1 승인 후) |
| CS-API-07 | api | | limit 0→1 / 999→20 |
| CS-API-08 | api | | 검색·발송 401/403 — 발송 0건 |
| CS-API-09 | api | | 실발송 2(테스트 계정) — sent 정합+CS 수렴+accepted |
| CS-API-10 | api | | cs_send 대상별 1행 + 본문 원문 부재 |
| CS-API-11 | api | | 빈 배열·비 uuid 형식 400 |
| CS-API-12 | api | | 21명 400 + 전체발송 유도 문구 |
| CS-API-13 | api | | 빈 text·2001자 400 |
| CS-API-14 | api | | 실발송 1 — dedupe requested=2·failed_ids=GHOST·failed 행 적재 |
| CS-API-15 | api | | broadcast 400·429 불변 + 리팩터 코드 리뷰 |
| CS-API-16 | api | | 9004 3파일 diff 0 + 대표 403 |
| CS-UNIT-01 | unit | | debounce 1회 + 닉네임#code 렌더 |
| CS-UNIT-02 | unit | | chips 중복 방지·제거·상한 차단(풀 부족 시 §6-4 fallback) |
| CS-UNIT-03 | unit | | 0명·빈 text·2000자 초과 차단 — POST 0건 |
| CS-UNIT-04 | unit | | 닉네임·본문·이메일 콘솔 0건 |
| CS-E2E-01 | e2e | | 실발송 2 — 풀 여정 + 감사 로그 닉네임#태그 렌더 |
| CS-E2E-02 | e2e | | 닉네임 표시·fallback·title=uuid |
| CS-E2E-03 | e2e | | broadcast dismiss POST 0건 + 답장 1 + 5페이지 |

## v177 시나리오 집계

- 총 **23건** — [api] 16 / [unit] 4 / [e2e] 3 (보류 없음 — planner 확인 7건은 §6)
- 쓰기·실발송: 지정발송 실발송 최대 5건 + 답장 1건(전부 official→테스트 계정, 시나리오별 명시) / ban+unban 1회(§6-1 승인 조건) / 임시 행 INSERT(조건부, DELETE 원복). 브로드캐스트 실발송 0건 설계(유효 body 요청은 잠금 선점된 CS-API-15 단 1건, E2E confirm dismiss). cs_send 감사 행은 삭제하지 않고 REPORT 명시.

## 개정 이력 (v177)

- 2026-08-13 초판 작성 (23건) — PLAN v177 §4 항목 1~10 전부 시나리오화(§4-1→CS-API-01·02, §4-2→CS-E2E-02, §4-3→CS-API-04·05·07·08, §4-4→CS-API-09, §4-5→CS-API-11·12·13, §4-6→CS-API-10·14, §4-7→CS-E2E-01·CS-UNIT-02, §4-8→CS-API-15·CS-E2E-03, §4-9→CS-API-03, §4-10→CS-API-16·CS-UNIT-04). 밴 미노출 실측(ban 쓰기)·검색 limit 파라미터·상한 UI 실측·상태 코드 400/422 등 7건 planner 회신 대기(§6). 실발송은 official→테스트 계정 한정 최대 6건으로 설계.
- 2026-08-13 planner 판정 반영 — §6 판단 요청 7건 전부 확정(§6 판정 블록: ban+unban 승인 / 게이트 전제 성립(수신자 is_verified 비게이트·birth_date None 미적용 코드 실측) / limit 클램프 1~20 구현 확정 / UNIT-02 ④ 코드 리뷰 갈음 / 실발송 6건 승인·대화 잔존 확정 / 임시 행 INSERT 재승인 / 400 확정·CS-API-11↔14 정합 확인). CS-API-06·07·09·11·CS-UNIT-02 문안 5곳 고정. 보류 0건 — tester 1단계 착수 가능.
- 2026-08-13 E2E 확정 (1단계 20/20 PASS·픽스 0회·git 무변경 확인 후) — §5 착수 확정 블록 신설(잔여 실발송 예산 3건=E2E 설계 정확 일치·초과 금지, 07:20 cs_broadcast 잔존 흔적 판정 혼입 금지). CS-E2E-01(TEST_USER_2 신설 반영)·CS-E2E-02(GHOST 행 존재 확정, 추가 발송 불요)·CS-E2E-03(대화 존재 근거 명시, POST 0건 판정을 세션 네트워크 기준으로 한정) 문안 보충. E2E 착수 GO.

# v178 — CS 지정발송 검색창 브라우즈 모드 (빈 검색어 시 사용자 목록 표시) (2026-08-13 17:14)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v178 §0 증분 실측(dm_service.py:901-902 가드·admin_cs.py:327 분기 지점·모달 effect), §1 설계 결정, §4 테스트 항목 1~6, §5 강행 금지
대상: backend_9005 `GET /api/admin/cs/users/search` 빈 q 브라우즈 분기(9004 미러) / frontend_admin AdminCsSendModal effect·SEARCH_LIMIT 20·문구 2곳. **dm_service.py·api.js·AdminCsPage·AdminLogsPage 무변경**(변경 매트릭스 §2)

## 0. 전제 및 안전 규칙

- **이번 버전은 읽기 전용 — 실발송 0건 설계(PLAN §5 강행 금지 ③)**: `POST /api/admin/cs/send` 및 broadcast 는 **호출 자체 금지**(401/403 케이스 포함 send 계열 요청 없음 — v177 과 달리 인증 거부 경로도 이번 범위 아님). UI 여정의 confirm 은 **직전 취소(dismiss)**. 전 구간 발송 0건은 BR-API-07 에서 감사 total 전후 비교로 입증.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN` / `USER_TOKEN`(테스트 일반 계정) / `TEST_USER_1_ID`·`TEST_USER_2_ID`·각 code / `OFFICIAL_ID` — v177 §0 과 동일 방식으로 확보, 실값 기재 금지.
- **쓰기는 ban+unban 1회뿐**(BR-API-04 — planner 확정 §4-1: v177 CS-API-06 에서 **이미 승인·실측 PASS·원복 검증 완료**된 패턴의 재사용, 테스트 계정 한정+즉시 원복). 그 외 쓰기 0건. ban/unban 감사 행 잔존은 정상 — REPORT 기재.
- 강행 금지(PLAN §5): dm_service.py 일체 수정 없음이 **검증 대상**(BR-API-06 3중 확인). 응답 스키마 `{users:[...]}` 유지. 브라우즈의 사용자 라우트(dm.py) 노출 없음. v177 강행 금지 전부 승계.
- 환경: 9005·9004, frontend_admin Vite dev(4001). 추적자 `[admin-cs]`(mode=browse 로그)·`[AdminCsSend]`.
- 시작 시 기록: `GET /api/admin/logs?action=cs_send` total(`S0`) + `GET /api/admin/cs/conversations` total(`C0`) — 종료 시 발송 0건 입증 기준값.

## 1. [api] 시나리오 (기본 대상 9005)

### BR-API-01. 브라우즈 200 — 빈 q 3형·닉네임순·4키·official 미포함 [api] — 핵심
- Given: `ADMIN_TOKEN`
- When: ① `GET /api/admin/cs/users/search` (q 생략) ② `?q=` ③ `?q=%20`(공백만 — strip 처리) 각각 호출하면
- Then: 3형 모두 HTTP 200 `{users:[...]}` (스키마 불변 — 강행 금지 ④):
  - 목록 ≤ limit(기본 20), 각 항목 **4키 `{id, nickname, profile_image, code}`** — code 실재(검색 모드와 동일 형식)
  - **닉네임 오름차순**(인접 쌍 전수 비교 — DB collation 기준, 동일 닉 허용)
  - `OFFICIAL_ID` **미포함**(id <> official 제외 조건) + 테스트 계정(active·비밴) 포함
  - 3형 응답 상호 동일(빈값 정규화 일관). 백엔드 로그에 `mode=browse` + **검색어 원문 없음**(qlen=0) — 로그 확인 가능 시 보조
- 이 응답을 이후 기준 데이터로 보관(BR-API-04 대조·UI 대조용)

### BR-API-02. 브라우즈 401·403 — 기존 인증 게이트 동일 [api]
- Given: 토큰 없음 / `USER_TOKEN`
- When: ① `GET /api/admin/cs/users/search`(빈 q) 무토큰 ② 동일 요청 `USER_TOKEN` 으로 호출하면
- Then: ① HTTP 401 ② HTTP 403 — 브라우즈 분기가 get_admin_user **뒤**에 있어 비관리자에게 목록이 절대 노출되지 않음(프라이버시 경계 확인). send 계열 호출 없음.

### BR-API-03. 브라우즈 limit 클램프 — 0→1, 999→20 [api]
- Given: `ADMIN_TOKEN`
- When: ① `?limit=0`(빈 q) ② `?limit=999`(빈 q) 각각 호출하면
- Then: 양쪽 200(4xx 아님). ① `users.length ≤ 1`(하한 1 클램프) ② `users.length ≤ 20`(상한 20 클램프 — 검색 모드와 공용 클램프가 브라우즈에도 적용, PLAN §1). ①의 1건이 닉네임순 첫 사용자와 일치(정렬·절단 순서 정합 보조).

### BR-API-04. 밴 계정 브라우즈 미노출 [api] — (쓰기 — ban+원복, planner 확정 §4-1: **실측**)
- Given: `ADMIN_TOKEN`, `TEST_USER_2_ID`. BR-API-01 기준 데이터에 TEST_USER_2 노출 확인(닉네임순 20건 밖이면 limit=20 내 진입하는 계정으로 대체 — 대체 불가 시 fallback)
- When: ① TEST_USER_2 밴(사유="v178 test ban — will revert") ② 빈 q 브라우즈 재호출 ③ **즉시 unban 원복** ④ 재호출하면
- Then: ② 목록에서 **미노출**(브라우즈 자체 쿼리의 `NOT is_banned AND account_status='active'` — search_users 와 수동 복제된 필터 정합 실측) ④ 재노출. 종료 전 비밴 상태 재확인(불일치 시 재시도 후 FAIL).
- fallback: ban API 자체가 오류로 실패하는 환경에서만 브라우즈 쿼리 WHERE 절 코드 리뷰 갈음+SKIP(§4-1 — 미승인 조건은 소멸).
- 보조(코드 리뷰 — planner 확정 §4-2): **dm_blocks 양방향 후필터**가 브라우즈 분기에 존재하는지 소스 확인 — 차단 관계 시드 실측은 하지 않음(official 계정 차단 상태 오염 리스크 > 실측 이득).

### BR-API-05. 검색 모드 회귀 — 비어있지 않은 q 경로 불변 [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`, 테스트 계정 닉네임·`TEST_USER_1_CODE`
- When: v177 CS-API-04/05 동일 요청 재실행 — ① `?q={닉네임 부분 문자열}` ② `?q=%23{TEST_USER_1_CODE}` ③ `?q=%23ZZZZ` ④ `?q=zzzz_none` 각각 호출하면
- Then: ① 부분매칭 결과에 테스트 계정 포함 + 4키 + official 미포함 ② 정확 1건(id==TEST_USER_1_ID) ③ 0건 ④ 0건 — **v177 실행 결과와 동일**(브라우즈 분기 삽입이 `q.strip()` 비어있지 않은 경로를 건드리지 않음 — search_users 위임 불변). 밴 미노출 회귀는 BR-API-04 의 ②시점에 검색 모드 1회 병행 호출로 겸측(ban 쓰기 1회 재사용, fallback 시 코드 리뷰 겸침).

### BR-API-06. 사용자 앱 가드 불변 — 3중 확인 [api] — 핵심 회귀 (강행 금지 ①·②)
- Given: `USER_TOKEN`, 저장소 체크아웃(구현 브랜치)
- When: ① `GET /api/dm/users/search?q=` 를 `USER_TOKEN` 으로 호출 ② `backend_9005/app/services/dm_service.py:901-902` 부근 소스 열람 ③ `git diff 6995395 --name-only` (기준 리비전 = **v177 커밋 `6995395`** == 현재 HEAD, planner 확정 §4-5 — v178 은 워킹트리 미커밋 상태라 커밋 범위 아닌 워킹트리 diff) 실행하면
- Then: ① HTTP 200 + **빈 배열**(사용자 앱에서 브라우즈 미동작 — `if not q: return []` 프라이버시 가드 생존, 전체 유저 열람 불가) ② 가드 라인 **문면 무변경**(코드 리뷰) ③ 변경 파일 목록에 **dm_service.py 부재**(9005·9004 모두). 셋 중 하나라도 실패 시 **즉시 중단·planner 보고**(최우선 회귀).
- 보조: 동일 요청 `?q=%20`(공백만) 1회 — 빈 배열(사용자 경로에서 공백 우회 없음).

### BR-API-07. 9004 미러 + 전 구간 발송 0건 입증 [api] — 미러 규칙·안전 마감
- Given: 9004 기동, `ADMIN_TOKEN`·`USER_TOKEN`, 시작 시 기록한 `S0`·`C0`
- When: ① `diff backend_9005/app/routes/admin_cs.py backend_9004/app/routes/admin_cs.py` ② **9004** 빈 q 브라우즈를 `ADMIN_TOKEN` 으로 1회(대표 정상 케이스 — 읽기 전용이라 9004 호출 안전) + `USER_TOKEN` 403 1회 ③ [api]·[unit]·[e2e] 전체 종료 후 `GET /admin/logs?action=cs_send` total 과 `GET /admin/cs/conversations` total 재조회하면
- Then: ① diff **0**(byte-identical 유지) ② 9004 응답이 9005 BR-API-01/02 와 동일 판정(200 목록·403) ③ **total == S0, C0 — 전 구간 send POST 0건·신규 대화 0건**(강행 금지 ③ 입증). dm_service.py 9004 측도 BR-API-06 ③ 에서 무변경 확인됨.

## 2. [unit] 시나리오 — AdminCsSendModal (브라우저 하니스, 4001 dev)

### BR-UNIT-01. 모달 open 즉시 목록 표시 — 0ms [unit] — 핵심
- Given: 관리자 로그인, `/cs` 진입
- When: "✉️ 지정 발송" 클릭으로 모달을 열면(추가 입력 없음)
- Then: 네트워크에 `admin/cs/users/search` 브라우즈 요청(빈 q, **limit=20** — SEARCH_LIMIT 확대 반영) **즉시 1회**(디바운스 0ms — 유의미한 지연·이중 호출 없음), 결과 리스트가 입력 전에 렌더(≤20건, `닉네임#code` 표기, 닉네임순 — BR-API-01 기준 데이터와 순서 일치). chips 안내 문구가 **"목록에서 사용자를 클릭해 대상을 추가하세요"** 취지로 변경 확인(PLAN §1 문구 조정).

### BR-UNIT-02. 타이핑 점진 축소 — 300ms 디바운스 유지 [unit] — 핵심
- Given: BR-UNIT-01 목록 표시 상태
- When: 검색 input 에 테스트 계정 닉네임을 한 글자씩 빠르게 연속 타이핑하면
- Then: 타이핑 중 요청 **남발 없음**(300ms 디바운스 — 입력 종료 후 최종 q 로 1회 수준, 중간 요청 잔존 시 횟수 기록), 리스트가 브라우즈 전체 목록 → 매칭 결과로 **재배열 없이 자연 축소**(닉네임순 동일 정렬 — PLAN §1 UX 핵심). stale 응답이 최신 결과를 덮지 않음(seq 가드 — 빠른 연속 입력 후 최종 화면이 최종 q 결과).

### BR-UNIT-03. 전부 삭제 → 목록 복귀 + 빈 결과 문구 분기 [unit]
- Given: BR-UNIT-02 매칭 결과 표시 상태
- When: ① 검색어 전부 삭제 ② `zzzz_none` 입력(검색 모드 빈 결과) ③ 다시 전부 삭제하면
- Then: ① **즉시(0ms) 브라우즈 재호출** → 전체 목록 복귀(빈 화면·이전 결과 잔존 없음) ② 빈 결과 문구 **"검색 결과가 없습니다"**(q 있음 모드) ③ 목록 복귀 재확인. 브라우즈 빈 결과 문구("표시할 사용자가 없습니다")는 dev DB 에 사용자가 존재해 실측 불가 — **코드 조건 분기 리뷰 갈음 확정(§4-3)** + 보조 증적: frontend-dev 육안 검증 중 구버전(v177) 백엔드가 빈 q 에 빈 배열을 반환해 해당 문구가 **실렌더된 스크린샷 확보됨** — REPORT 에 첨부 인용.

### BR-UNIT-04. 콘솔 위생 — 닉네임·검색어 원문 0건 [unit] — 핵심
- Given: BR-UNIT-01~03 수행 세션 콘솔 기록(+브라우즈 실패 1회 유도 — 백엔드 일시 중단/오프라인 토글 후 복구)
- When: 콘솔 전체에서 ① 사용자 닉네임 문자열 ② 입력한 검색어 원문 ③ `@test.invalid` 를 검색하면
- Then: `[AdminCsSend]` 로그 포함 전부 **0건** — DEV 로그는 q_len(0 허용)·건수·status 수준만(PLAN §3 지시 정합). 브라우즈 응답(사용자 목록) 덤프 미출력.

## 3. [e2e] 시나리오 — 1건 (행동 수준, 발송 금지)

### BR-E2E-01. 관리자 여정 — 즉시 목록→축소→chips→confirm 직전 취소 [e2e] — 핵심 (실발송 0건)
- Given: 관리자 앱(4001) 테스트 관리자 로그인
- When: `/cs` → "✉️ 지정 발송" 클릭 → (입력 없이) 목록 표시 확인 → 닉네임 타이핑으로 축소 → 테스트 계정 1명 클릭(chip 추가) → 검색어 전부 삭제 → 목록 복귀 확인(chip 유지) → 본문 입력 → 발송 클릭 → `window.confirm` 노출 → **취소(dismiss)** → 모달 닫기. 보조 회귀: 📢 전체 발송 모달 열기 → 유효 입력 → confirm **dismiss**
- Then: 여정 전 단계 정상 렌더(chips 는 검색어 삭제·목록 복귀에도 유지), confirm dismiss 후 **네트워크에 `admin/cs/send`·`admin/cs/broadcast` POST 0건**, 모달 상태 정상(재발송 시도 없음), CS 목록·기존 페이지 무손상, 콘솔 신규 에러 0건. 발송 0건은 BR-API-07 ③ 의 total 비교로 최종 입증.
- 증적: open 직후 목록·축소 후·chip+목록 복귀·confirm 대화상자·dismiss 후 네트워크 탭 스크린샷.

## 4. planner 확인 필요 사항

1. **BR-API-04 ban+unban 실측 여부**: PLAN §4-2 는 "승인 패턴 재사용 또는 코드 리뷰 갈음 — tester 환경 판단" — v177 §6-1(동일 ban 쓰기) 판정이 아직 pending 이므로 **v177 판정에 연동**해 확정 요청. 초안 기본값: v177 승인 시 실측, 미승인 시 코드 리뷰 갈음+SKIP.
2. **dm_blocks 후필터 실측 불가**: 브라우즈의 차단 관계 제외 실측은 dm_blocks 시드 쓰기(official 차단 관계 생성)가 필요 — 이번 읽기 전용 원칙과 충돌하여 **코드 리뷰 갈음으로 설계**(BR-API-04 보조). 실측 요구 시 별도 승인 회신.
3. **브라우즈 빈 결과 문구 실측 불가**: "표시할 사용자가 없습니다" 는 사용자 0명 상태가 전제 — dev DB 특성상 재현 불가, 코드 조건 분기 리뷰 갈음(BR-UNIT-03)으로 확정 요청.
4. **닉네임 정렬 판정 기준**: ORDER BY nickname 은 DB collation 의존(한글·영문·숫자 혼재) — 판정은 "API 응답 순서 == UI 렌더 순서 == DB 정렬" 상호 일치로 하고, 로케일별 사전순 차이는 비고 처리. 이의 시 회신.
5. **BR-API-06 ③ diff 기준 커밋**: "v177 종료 커밋" 을 기준으로 설계 — 구현 브랜치의 실제 기준 리비전(태그/커밋 해시)을 backend-dev 완료 보고에서 확정해 tester 에 전달 요청.

### planner 판정 (2026-08-13, 5건 전부 확정 — 해당 시나리오 문안 반영 완료)

1. **BR-API-04 — 실측 확정.** "v177 §6-1 pending" 전제는 착오 — v177 CS-API-06 은 planner 승인 후 **실측 PASS·unban 원복 검증까지 완료**된 이력. 동일 패턴(테스트 계정 한정·즉시 원복·CS 발송류 시나리오 없음이라 순서 제약도 불요) 재사용 승인. fallback 은 ban API 오류 환경만.
2. **dm_blocks 코드 리뷰 갈음 — 동의.** 차단 시드 실측은 official 계정에 차단 관계를 만드는 쓰기 — 원복 실패 시 실사용자 CS 채널(공식 DM)이 차단되는 리스크가 실측 이득을 초과. planner 가 스팟체크에서 브라우즈 분기의 dm_blocks 양방향 후필터(blocker/blocked set→discard(me)→제외, limit*2→절단)를 **diff 실측 완료** — tester 는 동일 확인을 문면 대조로 수행.
3. **브라우즈 빈 문구 코드 리뷰 갈음 — 동의 + 보조 증적 채택.** frontend-dev 육안 중 구버전 백엔드(빈 q→빈 배열) 환경에서 해당 문구 실렌더 스크린샷이 확보돼 있음 — 렌더 경로 자체는 실증된 셈. REPORT 에 인용.
4. **정렬 판정 방식 — 동의.** API 응답 순서 == UI 렌더 순서 == DB `ORDER BY nickname` 상호 일치로 판정, collation 로케일 차이는 비고 처리(절대 사전순을 요구하지 않음).
5. **diff 기준 리비전 = `6995395`** (v177 커밋 — planner git log 실측: 현재 HEAD 와 동일, v178 변경분은 워킹트리 미커밋). BR-API-06 ③ 문안에 반영 완료 — `git diff 6995395 --name-only` 워킹트리 diff 로 판정.

## 5. 실행 순서 권고 (tester 참고)

1. 시작 기록: `S0`(cs_send total)·`C0`(conversations total) → BR-API-01~03 (읽기 전용) → BR-API-04(+05 병행 겸측 — planner §4-1 확정 후, ban→브라우즈·검색→unban 원자적) → BR-API-05(미실측분) → BR-API-06 (가드 3중 — 실패 시 즉시 중단)
2. BR-UNIT-01→02→03 → BR-UNIT-04 (같은 세션 콘솔 마감)
3. BR-E2E-01 (confirm dismiss — POST 0건)
4. BR-API-07 (9004 미러 + 종료 시 S0·C0 재대조 — 발송 0건 마감 입증) → REPORT: ban/unban 감사 행 잔존 내역·코드 리뷰 갈음 항목 기재

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| BR-API-01 | api | | 빈 q 3형 200·닉네임순·4키·official 미포함 |
| BR-API-02 | api | | 브라우즈 401/403 — 비관리자 목록 비노출 |
| BR-API-03 | api | | limit 0→1 / 999→20 (브라우즈) |
| BR-API-04 | api | | 밴 미노출 — ban+원복(§4-1 확정 후) 또는 코드 리뷰 갈음 |
| BR-API-05 | api | | 검색 모드 회귀 — v177 CS-API-04/05 동일 결과 |
| BR-API-06 | api | | 사용자 가드 3중(빈 배열/코드 리뷰/diff 부재) — 실패 시 즉시 중단 |
| BR-API-07 | api | | 9004 diff 0 + 대표 케이스 + S0·C0 불변(발송 0건) |
| BR-UNIT-01 | unit | | open 즉시 목록·limit=20·chips 안내 문구 |
| BR-UNIT-02 | unit | | 300ms 디바운스·재배열 없는 축소·stale 가드 |
| BR-UNIT-03 | unit | | 전부 삭제 복귀(0ms)·문구 분기(브라우즈 문구는 코드 리뷰) |
| BR-UNIT-04 | unit | | 닉네임·검색어·이메일 콘솔 0건 |
| BR-E2E-01 | e2e | | 여정 + confirm dismiss — send/broadcast POST 0건 |

## v178 시나리오 집계

- 총 **12건** — [api] 7 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 5건은 §4)
- 쓰기: BR-API-04 의 ban+unban 1회(조건부 — v177 §6-1 판정 연동)뿐. **실발송 0건 설계** — send·broadcast 호출 자체 없음(401/403 도 검색 엔드포인트만 사용), E2E confirm 전부 dismiss, 종료 시 cs_send·conversations total 전후 비교로 발송 0건 입증(BR-API-07). 감사 행 삭제 없음.

## 개정 이력 (v178)

- 2026-08-13 초판 작성 (12건) — PLAN v178 §4 항목 1~6 전부 시나리오화(§4-1→BR-API-01·02, §4-2→BR-API-03·04, §4-3→BR-API-05, §4-4→BR-API-06(3중), §4-5→BR-UNIT-01~04, §4-6→BR-API-07·BR-E2E-01). 강행 금지 ③(실발송 0건)을 설계 불변식으로 승격 — send 계열 요청 전무+total 전후 비교 마감. ban 실측·dm_blocks 후필터·브라우즈 빈 문구·정렬 판정·diff 기준 커밋 5건 planner 회신 대기(§4).
- 2026-08-13 planner 판정 반영 — §4 판정 블록 5건 확정(BR-API-04 실측 확정 — "v177 pending" 전제 착오 정정 / dm_blocks·빈 문구 코드 리뷰 갈음 동의(+구버전 스크린샷 보조 증적 채택) / 정렬 상호 일치 판정 동의 / diff 기준 `6995395` 반영). §0·BR-API-04·BR-API-06·BR-UNIT-03 문안 4곳 고정. 프론트 파생 수정(결과 블록 `{trimmedQuery && ...}` 렌더 게이트 제거) planner 승인 — 미제거 시 브라우즈 목록 렌더 불가로 필수 수정 판정. 보류 0건 — tester 1단계 착수 가능.
