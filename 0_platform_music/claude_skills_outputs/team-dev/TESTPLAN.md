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

# v179 — 지정발송 검색 리스트 드롭다운 오버레이 전환 (2026-08-13 17:57)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v179 §0 증분 실측(effect 의존 [open,query]→[dropdownOpen,query]·in-flow 결과 블록·blur 클릭 씹힘 분석·height 고정), §1 설계 결정, §4 테스트 항목 1~7, §5 강행 금지
대상: **프론트 2파일만** — `frontend_admin/src/components/AdminCsSendModal.jsx`·`.css` (백엔드 9005·9004·dm_service.py·api.js·타 페이지 **무변경**이 검증 대상)

## 0. 전제 및 안전 규칙

- **실발송 0건 불변식(v178 승계)**: send/broadcast 호출 자체 금지, E2E confirm 직전 취소(dismiss). 시작 시 `GET /api/admin/logs?action=cs_send` total(`S0`)·`GET /api/admin/cs/conversations` total(`C0`) 기록 → 종료 시 재대조(DD-API-01 ③).
- **쓰기 전무**: 이번 버전은 순수 UI — ban/unban 도 불요(백엔드 무변경). DB·Redis·Mongo 쓰기 0건.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`·`USER_TOKEN`·테스트 계정 닉네임/`TEST_USER_1_CODE` — v177~178 방식, 실값 기재 금지.
- 강행 금지(PLAN §5): 백엔드 파일 무접촉이 검증 대상(git diff — DD-API-01). blur 기반 닫기 금지(씹힘) — DD-UNIT-05 가 행동 수준으로 검증. runSearch·디바운스·seq 가드·문구 로직 불변 — DD-UNIT-04 회귀.
- 환경: 9005 백엔드(읽기 전용)·frontend_admin Vite dev(4001). 추적자 `[AdminCsSend]`. 측정 도구: 브라우저 devtools — 요소 `getBoundingClientRect()`(패널 높이·본문 요소 위치)·네트워크 탭(요청 횟수)·콘솔.
- 높이·위치 판정 공통 기준: 패널 높이 = `min(240px, 40vh)` 고정(내용 무관), 비교는 동일 뷰포트에서 rect 값 대조(**허용 오차 ±1px — planner 확정 §4-1**, 0px 요구·±2px 완화 모두 기각).

## 1. [api] 시나리오 — 백엔드 무변경·API 불변·발송 0건 마감

### DD-API-01. 백엔드 무변경 git diff + v178 API 응답 불변 + S0/C0 대조 [api] — 회귀 핵심
- Given: 구현 브랜치 체크아웃, `BASE_REV` = **v178 커밋 `c662064`** (== 현재 HEAD, planner git log 실측 확정 §4-3 — v179 변경분은 워킹트리 미커밋), `ADMIN_TOKEN`, 시작 기록 `S0`·`C0`
- When: ① `git diff c662064 --name-only` (워킹트리 diff) ② v178 대표 2케이스 재호출 — `GET /api/admin/cs/users/search`(빈 q) / `?q={테스트 계정 닉네임 부분 문자열}` ③ 전체 시나리오([unit]·[e2e] 포함) 종료 후 `S0`·`C0` 재조회하면
- Then:
  - ① 변경 파일이 **`AdminCsSendModal.jsx`·`AdminCsSendModal.css` 2파일뿐** — backend_9005/9004·dm_service.py·api.js·타 페이지 **출현 금지**(강행 금지 ①). 위반 시 즉시 중단·planner 보고
  - ② 빈 q: 200 `{users:[...]}` 닉네임순·4키·official 미포함 / 부분매칭: 테스트 계정 포함 — **v178 BR-API-01·05 실행 결과와 동일**(프론트만 바뀐 버전에서 API 응답 불변)
  - ③ `cs_send` total == S0, conversations total == C0 — **전 구간 실발송 0건·신규 대화 0건 입증**

## 2. [unit] 시나리오 — AdminCsSendModal 드롭다운 (브라우저 하니스, 4001 dev)

### DD-UNIT-01. open 기본 상태 — 요청 0건 + 리스트 미표시 [unit] — 핵심
- Given: 관리자 로그인, `/cs` 진입, 네트워크 탭 기록 시작
- When: "✉️ 지정 발송" 클릭으로 모달을 열고 **아무것도 하지 않으면**(focus·입력 없음)
- Then: `admin/cs/users/search` 요청 **0건**(v178 의 open 자동 브라우즈 제거 확인), 드롭다운·결과 리스트 **미표시** — 모달 기본 모습이 v177 과 동일(입력창·chips 안내·textarea·버튼만). 잔여 로딩 표시 없음.

### DD-UNIT-02. focus → 브라우즈 1회 + 오버레이 겹침·레이아웃 시프트 없음 [unit] — 핵심
- Given: DD-UNIT-01 상태. focus **전** 기준 rect 기록: 모달(`.admin-cs-send`) 크기, chips 영역·textarea·발송 버튼의 위치(top)
- When: 검색 input 을 focus 하면
- Then:
  - 빈 q 브라우즈 요청 **정확 1회**(즉시 — 0ms 딜레이) + 드롭다운 패널 표시(≤20건, `닉네임#code`, 닉네임순 — DD-API-01 ② 응답과 순서 일치)
  - 패널이 **chips 영역·textarea 위에 겹쳐** 렌더(absolute 오버레이): 패널 rect 가 chips/textarea rect 와 교차 + z-order 상 패널이 위(가려진 요소 클릭 시 패널이 받음 — DD-UNIT-06 ①에서 겸측)
  - **레이아웃 시프트 없음**: focus 전후 모달 크기·chips·textarea·버튼의 rect **동일**(±1px) — in-flow 밀림 부재
- 보조: 드롭다운 닫은 뒤 **재focus** → 브라우즈 재요청 1회 + 재표시(PLAN §1 신선도 확보 — 재호출은 남발이 아닌 기대 동작).

### DD-UNIT-03. 패널 높이 고정 — 4상태 + 로딩 대조 [unit] — 핵심
- Given: 드롭다운 열린 상태. 각 상태에서 패널(`.admin-cs-send__dropdown`) 높이 + 모달 크기 rect 기록
- When: ① 빈 q 브라우즈(20건 — 내부 스크롤 발생) → ② `bcast_user_test` 타이핑(축소 — 2건 수준) → ③ `#`+`TEST_USER_1_CODE`(정확 1건) → ④ `zzzz_none`(빈 결과 — "검색 결과가 없습니다") 순으로 전환하면(+전환 중 로딩 표시 상태 1회 캡처)
- Then: **4상태(+로딩) 전부 패널 높이 동일**(`min(240px, 40vh)` — 내용량 무관 고정, max-height 축소 없음: 1건·빈 결과에서도 동일) + **모달 크기 불변**(4상태 rect 동일 ±1px). 20건 상태는 패널 **내부 스크롤**로 전체 접근 가능. ①~④ 각 상태 스크린샷 증적.
- 보조(planner 확정 §4-2 — 소형 뷰포트 스팟체크): 뷰포트 높이 **약 600px** 로 축소 후 ① 상태 1회 재확인 — 패널 높이가 `40vh` 분기로 적용되고 목록 전체가 **내부 스크롤로 접근 가능**하면 PASS. 모달 스크롤 컨테이너 내 패널 하단 접힘이 관측되면 **비고 기재(비차단 — FAIL 아님**, PLAN §5 기지 리스크). 종료 후 원 뷰포트 복원(rect 계열 판정과 뷰포트 분리).

### DD-UNIT-04. v178 회귀 — 디바운스·전부 삭제 복귀·stale 가드 (드롭다운 열린 상태) [unit]
- Given: 드롭다운 열린 상태(focus 유지)
- When: ① 닉네임을 한 글자씩 빠르게 연속 타이핑 ② 검색어 전부 삭제 ③ 빠른 연속 입력 직후 결과 확인하면
- Then: ① 타이핑 중 요청 남발 없음 — **300ms 디바운스로 입력 종료 후 1회 수준**(중간 요청 잔존 시 횟수 기록) ② **즉시(0ms) 빈 q 브라우즈 재호출** → 전체 목록 복귀 — 드롭다운이 닫히지 않고 열린 채 전환 ③ 최종 화면 == 최종 q 결과(seq stale 가드 생존). v178 BR-UNIT-02/03 판정 기준 동일 — 트리거 교체가 호출 로직을 훼손하지 않음(강행 금지 ④).

### DD-UNIT-05. 항목 첫 클릭 성공 + 연속 다중선택·드롭다운 유지 [unit] — 핵심 (blur 씹힘 회귀)
- Given: 드롭다운 열린 상태(테스트 계정 ≥2 노출)
- When: ① 첫 항목을 **단 1회 클릭** ② 이어서 둘째 항목 클릭 ③ 동일 항목 재클릭 시도하면
- Then: ① **첫 클릭에 chip 즉시 추가**(씹힘 없음 — mousedown→blur 언마운트로 click 소실되는 버그 부재, 클릭 후에도 **드롭다운 열린 채 유지**) ② 둘째도 첫 클릭 성공 — chips 2개(`닉네임#code`) ③ 중복 추가 안 됨 + picked 표시 회귀. 20명 상한 문구·chip × 제거 v177~178 동작 회귀(보조 1회). 클릭 시 패널 깜빡임·재호출 남발 없음.

### DD-UNIT-06. 닫기 3종 + backdrop 모달 닫기 불변 [unit] — 핵심
- Given: 드롭다운 열린 상태, chips 1개 이상
- When: ① 본문 요소(textarea 등 패널 밖 모달 내부) **mousedown** ② 검색 input 재focus ③ (드롭다운 재오픈 후) **Esc** 키 ④ (드롭다운 닫힌 상태에서) 모달 backdrop 클릭하면
- Then:
  - ① 드롭다운 **닫힘** — 가려졌던 chips·textarea 노출, **chips 유지**, 모달은 열린 채(내부 클릭이 모달을 닫지 않음)
  - ② 재표시 + 브라우즈 재호출 1회(DD-UNIT-02 보조와 동일 판정)
  - ③ **드롭다운만 닫힘 — 모달 유지**(Esc 가 모달·페이지로 전파돼 이중 닫힘 없음, PLAN §5 전파 소비)
  - ④ backdrop 클릭 시 **모달 닫기 기존 동작 불변**(v177~178 회귀) — 재오픈 시 상태 초기화(reset) 정상
- 보조: 패널 내부 스크롤바 드래그/패널 여백 클릭은 "내부" 판정 — 드롭다운 유지(wrapper ref 포함 판정).

### DD-UNIT-07. 콘솔 위생 + eslint 0 [unit] — 마감
- Given: DD-UNIT-01~06 수행 세션 콘솔 기록(+브라우즈 실패 1회 유도 — 백엔드 일시 중단/오프라인 토글 후 복구), frontend_admin 저장소
- When: ① 콘솔 전체에서 사용자 닉네임·입력 검색어 원문·`@test.invalid` 검색 ② `eslint` 실행(frontend_admin 관행 명령)하면
- Then: ① `[AdminCsSend]` 포함 전부 **0건** — DEV 로그는 q_len·건수·status 수준만. 리스너 등록/해제 관련 경고(React state update on unmounted 등)·신규 콘솔 에러 0건 ② eslint 오류 **0**(PLAN §3 지시).

## 3. [e2e] 시나리오 — 1건 (행동 수준, 발송 금지)

### DD-E2E-01. 풀 여정 — open→focus→목록→축소→2명 선택→바깥 클릭 닫힘→본문→confirm dismiss [e2e] — 핵심 (실발송 0건)
- Given: 관리자 앱(4001) 테스트 관리자 로그인
- When: `/cs` → "✉️ 지정 발송" → (리스트 없음 확인) → input **focus** → 목록 표시 → 닉네임 타이핑으로 축소 → 테스트 계정 **2명 연속 선택**(chips 2개·드롭다운 유지) → **바깥(본문) 클릭**으로 드롭다운 닫힘 → 본문 입력 → 발송 클릭 → `window.confirm` 노출 → **취소(dismiss)** → 모달 닫기
- Then: 각 단계 정상 전이(open 시 요청 0건 → focus 시 1회 → 축소 → 첫 클릭 선택 성공 ×2 → 닫힘 후 chips·본문 노출) — confirm dismiss 후 **네트워크에 `admin/cs/send`·`admin/cs/broadcast` POST 0건**, CS 페이지·목록 무손상, 콘솔 신규 에러 0건. 발송 0건 최종 입증은 DD-API-01 ③ 의 S0/C0 대조.
- 증적: open 직후(리스트 없음)·focus 오버레이(본문 가림)·축소·chips 2개+드롭다운 유지·바깥 클릭 후·confirm 대화상자 스크린샷.

## 4. planner 확인 필요 사항

1. **높이·위치 판정 허용 오차**: rect 대조를 ±1px 로 설계(서브픽셀·스크롤바 렌더 감안) — 정확 0px 요구 또는 완화(±2px) 여부 회신.
2. **소형 뷰포트 스팟체크**: PLAN §5 리스크(스크롤 컨테이너 내 absolute 패널 접힘, `min(240px,40vh)` 완화·비차단) — 축소 뷰포트(예: 높이 600px)에서 DD-UNIT-03 1회 반복을 보조 항목으로 넣을지 판정 위임(초안은 미포함, 관측 시 비고만).
3. **git diff 기준 리비전(BASE_REV)**: v178 종료 커밋 해시를 frontend-dev 완료 보고에서 확정해 tester 전달 요청(v178 §4-5 와 동일 이슈).
4. **드롭다운 닫힌 상태의 Esc**: 요구는 "드롭다운 열림 시 Esc → 드롭다운만 닫힘"만 명세 — 드롭다운 닫힌 상태에서 Esc 의 모달 동작(v177~178 현행 유지 전제)을 회귀 기준으로 삼음. 기대 동작이 다르면 회신.

### planner 판정 (2026-08-13, 4건 전부 확정 — 해당 문안 반영 완료)

1. **±1px 확정** — 서브픽셀·스크롤바 렌더 감안 적정. 0px 은 환경 취약(위양성 FAIL), ±2px 은 실제 시프트를 놓칠 수 있어 기각.
2. **소형 뷰포트 스팟체크 — 보조 항목 추가 확정**(DD-UNIT-03 보조로 편입). PLAN §5 에 명시한 기지 리스크의 실측 확인 — 비용 1회로 낮고, 판정은 비차단(접힘 관측 시 비고). 원 뷰포트 복원 조건 포함.
3. **BASE_REV = `c662064`** (v178 커밋 — planner git log 실측: 현재 HEAD 와 동일, v179 변경분 워킹트리 미커밋). DD-API-01 을 `git diff c662064 --name-only` 워킹트리 diff 로 고정.
4. **Esc 현행 유지 회귀 기준 — 동의.** 코드 실측: v177~179 모달은 자체 Esc 핸들링이 없음(닫기는 backdrop/×/취소뿐) — 드롭다운 닫힌 상태 Esc 는 무동작이 현행이며, v179 리스너는 `open && dropdownOpen` 조건부 등록이라 닫힌 상태에 리스너 자체가 없음(diff 실측). 무동작 유지가 기대값.

## 5. 실행 순서 권고 (tester 참고)

1. 시작 기록: `S0`·`C0` → DD-API-01 ①②(diff·API 대표 케이스 — 위반 시 즉시 중단)
2. DD-UNIT-01→02→03→04→05→06 (단일 세션 연속 — rect 기록은 동일 뷰포트 유지) → DD-UNIT-07 (콘솔 마감+eslint)
3. DD-E2E-01 (confirm dismiss)
4. DD-API-01 ③ (S0/C0 재대조 — 발송 0건 마감) → REPORT: 코드 리뷰 갈음 항목·rect 측정값 기재

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| DD-API-01 | api | | diff 프론트 2파일뿐 + API 대표 2케이스 불변 + S0/C0 대조 |
| DD-UNIT-01 | unit | | open 요청 0건·리스트 없음(v177 복원) |
| DD-UNIT-02 | unit | | focus 1회 호출 + 오버레이 겹침 + 시프트 없음(±1px) |
| DD-UNIT-03 | unit | | 4상태+로딩 패널 높이·모달 크기 동일 |
| DD-UNIT-04 | unit | | 디바운스 1회·삭제 즉시 복귀·stale 가드(v178 회귀) |
| DD-UNIT-05 | unit | | 첫 클릭 성공·연속 2명·드롭다운 유지·중복 방지 |
| DD-UNIT-06 | unit | | 바깥 mousedown/재focus/Esc + backdrop 불변 |
| DD-UNIT-07 | unit | | 콘솔 0건 + eslint 0 |
| DD-E2E-01 | e2e | | 풀 여정 + confirm dismiss — send/broadcast POST 0건 |

## v179 시나리오 집계

- 총 **9건** — [api] 1 / [unit] 7 / [e2e] 1 (보류 없음 — planner 확인 4건은 §4)
- 쓰기·실발송: **전무** — 순수 UI 버전(ban 불요·DB/Redis/Mongo 무접촉), send/broadcast 호출 0건, confirm dismiss, S0/C0 전후 대조로 발송 0건 입증(DD-API-01 ③). 백엔드 무변경은 git diff 로 검증(강행 금지 ①).

## 개정 이력 (v179)

- 2026-08-13 초판 작성 (9건) — PLAN v179 §4 항목 1~7 전부 시나리오화(§4-1→DD-UNIT-01, §4-2→DD-UNIT-02, §4-3→DD-UNIT-03, §4-4→DD-UNIT-04, §4-5→DD-UNIT-05, §4-6→DD-UNIT-06, §4-7→DD-API-01·DD-UNIT-07·DD-E2E-01). blur 씹힘 회귀는 DD-UNIT-05 행동 수준(첫 클릭 성공)으로, 레이아웃 시프트·높이 고정은 rect 실측(±1px)으로 판정. 허용 오차·소형 뷰포트 스팟체크·BASE_REV·Esc 기본 동작 4건 planner 회신 대기(§4).
- 2026-08-13 planner 판정 반영 — §4 판정 블록 4건 확정(±1px 확정 / 소형 뷰포트 스팟체크 DD-UNIT-03 보조 편입(비차단) / BASE_REV `c662064` 워킹트리 diff 고정 / Esc 현행 무동작 유지 — 닫힌 상태 리스너 부재 diff 실측). §0·DD-API-01·DD-UNIT-03 문안 3곳 고정. 보류 0건 — tester 착수 가능(1단계+E2E 한 흐름 승인).
- 2026-08-13 실행 9/9 PASS 후 마이크로픽스 1건 planner 승인 — tester UX 관찰(비차단): **Esc 닫기 후 input focus 잔존 상태에서 재클릭 시 재오픈 불가**(트리거 onFocus 단일 — focus 이벤트 미재발생). 사용자 원 요구 "클릭하거나 터치하면 리스트가 나오게" 문언상 요구 위반 소지 → v179 범위 포함 확정. 픽스: input `onClick={() => setDropdownOpen(true)}` 1줄 보강(onFocus 유지 — 최초 클릭 시 focus·click 이 동일 true 세팅이라 상태 전이 1회 = **이중 fetch 없음**, effect 는 dropdownOpen 전이에만 발화). 재검증 범위(오케스트레이터 실행): ① Esc 닫기 → (focus 유지 상태) input 재클릭 → 재오픈+브라우즈 재호출 1회 ② 회귀 — 최초 focus/클릭 시 요청 1회(이중 호출 없음), 바깥 클릭 닫힘·첫 클릭 선택 불변(DD-UNIT-05/06 스모크).

# v180 — 관리자 별(재화) 관리 페이지 신설 (/points) (2026-08-13 18:35)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v180 §0 실측(point_events 유니크 인덱스·spend_points 원자 차감·credit_points 멱등·ref 임베드 `adm:{uuid8}:{사유≤40}`), §1 설계 결정, §4 테스트 항목 1~8, §5 강행 금지 8항·리스크 3건
대상: backend_9005 `routes/admin_points.py` 신설(summary/balance/events/adjust) + main.py 2줄(9004 미러) / frontend_admin AdminUserSearchDropdown·AdminPointsPage 신설 + App/Layout/api.js/AdminLogsPage 라벨 1줄. **points_service.py·routes/points.py·AdminCsSendModal 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **조정 실측은 테스트 계정(`bcast_user_test_*`)만** — 실사용자 UUID 절대 금지. **모든 지급은 동량 차감으로 잔액 원복 필수**(시나리오별 grant/deduct 짝 명시, 종료 시 잔액 == 시작 잔액 검증). 원장(point_events)·감사(admin_logs) 행은 삭제 불가 잔존이 정상 — REPORT 에 생성 내역(행 수·ref·시각 범위) 기재.
- **조정 외 쓰기 없음**. CS 지정발송·브로드캐스트는 이번 범위 밖 — **호출 자체 금지**(CS 모달 회귀 스모크는 선택 단계까지, send/broadcast POST 0건 네트워크 확인).
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN` / `USER_TOKEN`(=TEST_USER_1 로그인) / `TEST_USER_1_ID`·code — v177~179 방식, 실값 기재 금지. `GHOST_UUID` = 형식 유효·미존재(사전 404 확인). 조정 수량 `N` = 7(식별 용이한 소액), 사유 = `"v180 테스트 지급(원복 예정)"` 계열 — 민감정보 없는 고정 문구.
- 강행 금지(PLAN §5): points_service.py·routes/points.py 무접촉(git diff 검증 — PT-API-08), 마이너스 잔액 불가(PT-API-05 가 핵심 검증), 비용표 읽기 전용(수정 UI 부재 확인), AdminCsSendModal 무접촉(PT-UNIT-07 스모크), 사유는 감사 details 저장 허용·**콘솔 미출력**(PT-UNIT-08).
- 환경: 9005·9004, Mongo(point_*), PG(users), frontend_admin Vite dev(4001). 추적자 `[admin-points]`·`[AdminPoints]`·`[AdminUserSearch]`·`[AdminLogs]`.
- summary delta 판정 전제(planner 확정 §4-1): 기본은 정확 delta(±N) 판정하되 **호출 창 최소화**(grant/deduct 직전·직후 연속 호출, 수 초 내). 이 dev 환경은 사용자 수동 테스트 간헐 발생 이력(07:20 브로드캐스트 전례) — 불일치 관측 시 1회 재실행, 재차 불일치면 "TEST_USER_1 balance·원장 반영 확인"으로 **완화 판정(FAIL 아님)** + 외부 트래픽 관측 사실 비고 기재.

## 1. [api] 시나리오 — admin_points 4 엔드포인트 (기본 대상 9005)

### PT-API-01. summary 200 — 5필드 정합 + 조정 delta 검증 [api] — 핵심
- Given: `ADMIN_TOKEN`. PT-API-03 실행 전후에 각 1회 호출하도록 배치
- When: `GET /api/admin/points/summary` 호출하면
- Then: HTTP 200 — `{total_balance, total_earned, total_spent, today_earned, today_spent}` 5필드 전부 숫자(음수 아님·빈 컬렉션이어도 0 방어). 정합: `total_balance` 가 TEST_USER_1 잔액 변화를 반영 —
  - **delta 검증**: PT-API-03 의 grant +N 직후 재호출 시 `total_balance`·`total_earned`·`today_earned` 가 각 **+N**, deduct −N 원복 후 `total_balance` 원상·`total_spent`/`today_spent` **+N** — 호출 창 최소화·불일치 시 §0 완화 절차(재실행 1회 → balance·원장 반영 확인으로 완화 판정+비고)
  - today_* 는 KST 기준 오늘 집계(자정 경계 실행 회피 — 실행 시각 기록)

### PT-API-02. 신규 엔드포인트 401·403 [api]
- Given: 토큰 없음 / `USER_TOKEN`
- When: ① 4 엔드포인트(summary / `users/{TEST_USER_1_ID}/balance` / `users/{TEST_USER_1_ID}/events` / adjust 유효 body) 각각 무토큰 호출 ② summary·adjust 2종을 `USER_TOKEN` 으로 호출하면
- Then: ① 전부 HTTP 401 ② 전부 HTTP 403 — 특히 **adjust 는 비관리자 403**(파괴 API 게이트 최우선). 403 케이스의 잔액 불변 확인(발동 0건).

### PT-API-03. adjust 정상 흐름 — grant +N → 원장 → deduct −N 원복 [api] — 핵심 (쓰기: grant N + deduct N, 순변화 0)
- Given: `ADMIN_TOKEN`, `TEST_USER_1_ID`. 사전 기록: `GET /users/{id}/balance` → `B0`, `GET /admin/logs?action=points_adjust` total(`P0`)
- When: ① `POST /api/admin/points/adjust` `{user_id, direction:"grant", amount:N, reason:"v180 테스트 지급(원복 예정)"}` → ② balance·events 조회 → ③ 동일 body 로 `direction:"deduct"`(사유 "v180 테스트 차감(원복)") → ④ 재조회하면
- Then:
  - ① 200 + 응답 `{balance}` == B0+N ② balance == B0+N. events 최신 행: `action=="admin_adjust"`, `amount==+N`, **ref `adm:` 접두 + uuid8 + 사유(≤40자) 임베드**, day==KST 오늘
  - ③ 200 + balance == **B0(원상)** ④ events 최신 행: `action=="spend:admin_adjust"`(서비스 접두 자동 부여 실측 정합), `amount==−N`
  - 감사: `?action=points_adjust` total == P0+2 — 각 행 target_type=user·target_id=TEST_USER_1_ID, details == `{direction, amount, reason(원문), ref}` — 토큰·이메일 등 **비밀값 없음**(reason 저장은 허용 사양)
  - PT-API-01 delta 와 교차 정합

### PT-API-04. adjust 입력 검증 — 400/404 스윕 (비파괴) [api]
- Given: `ADMIN_TOKEN`, 사전 balance 기록
- When: ① user_id="not-a-uuid" ② user_id=GHOST_UUID(실재 검증) ③ direction="gift"(미정의) ④ amount: 0 / −1 / 10001 / 1.5(비정수) ⑤ reason: 누락 / 공백만 / 201자 — 각각 호출하면
- Then: ① 400 ② **404**(uuid 형식 통과 후 users 실재 검증 — 검증 순서 정합) ③ 400 ④ 전부 **400 확정**(§4-2 — 구현 실측: `AdjustBody.amount: Any`(:51) + 수동 `isinstance(int)`·bool 거부 검증이라 1.5 도 pydantic 422 없이 400 도달. 422 관측 시 FAIL) ⑤ 전부 400(trim 1~200). **전 케이스 잔액·원장·감사 무변화**(발동 0건 — balance 재조회로 확인).

### PT-API-05. 잔액 초과 차감 400 — spend_points 원자성 [api] — 핵심
- Given: `ADMIN_TOKEN`, TEST_USER_1 현재 잔액 `B` 조회
- When: `direction:"deduct", amount:B+1`(단 B+1 ≤ 10000 — 초과 시 amount 상한 내 시나리오로 조정: 잔액을 0 근처로 만든 뒤 1 차감 등) 호출하면
- Then: HTTP **400 "잔액 부족"** 계열 — **balance == B 불변**(마이너스 잔액 원천 불가 — `{balance:{$gte:amount}}` 원자 필터 실측 정합). 원장·감사에 행 미생성. 보조(코드 리뷰): balance 직접 `$inc/$set` 우회 코드 부재(강행 금지 ④).

### PT-API-06. 동일 사유 연속 지급 — ref 유니크·멱등 오차단 없음 [api] — (쓰기: grant N×2 + deduct 2N, 순변화 0)
- Given: `ADMIN_TOKEN`, balance `B0` 기록
- When: **동일 reason·동일 amount(N)** 로 grant 를 즉시 2회 연속 호출 → 이후 deduct 2N 1회(원복)하면
- Then: 2회 모두 **200 성공**(ref 의 uuid8 이 시도별 유니크 — (user, action, ref, day) 멱등 유니크 인덱스와 충돌 없음, DuplicateKey 500 미발생), balance == B0+2N → 원복 후 B0. 원장에 admin_adjust +N 2행(ref 상이) + spend:admin_adjust −2N 1행. 감사 points_adjust 3행 증가.

### PT-API-07. events — 필터 4종 매핑·클램프·타 사용자 미혼입 [api] — 핵심
- Given: `ADMIN_TOKEN`. PT-API-03/06 이후(admin_adjust ±행 실재), TEST_USER_1 에 기존 적립/소진 행 유무 확인
- When: `GET /users/{TEST_USER_1_ID}/events` 를 ① 무필터 ② `filter=admin` ③ `filter=spend` ④ `filter=refund` ⑤ `filter=earn` ⑥ `limit=0`/`limit=999`/`page=0` 으로 각각 호출하면
- Then:
  - ① 200 — 행 `{action, amount, ref, day, created_at}` + pagination(v176 형식), created_at DESC, **전 행이 TEST_USER_1 것만**(타 사용자 미혼입 — 다른 테스트 계정 행 부재로 판정)
  - ② **admin_adjust 와 spend:admin_adjust 만**(이번 생성분 전부 포함) ③ `^spend:` 중 **spend:admin_adjust 제외** ④ `^refund:` 만(부재 시 0건 정상) ⑤ earn 매핑 — **admin_adjust 제외 확정**(§4-4 — `_EVENT_FILTERS["earn"]` 에 `$ne: "admin_adjust"` 코드 실측): earn 결과에 admin_adjust·refund:·spend: 계열 부재, 적립 원액션(amount>0)만
  - ⑥ 클램프 — limit 0→1, 999→**100**, page 0→1 (전부 200)

### PT-API-08. 회귀 — 사용자용 points API 무변경 + git diff [api] — 회귀 핵심
- Given: `USER_TOKEN`(TEST_USER_1), 구현 브랜치. `BASE_REV` = **v179 커밋 `4f52f16`** (== 현재 HEAD, planner git log 실측 확정 §4-5 — v180 변경분은 워킹트리 미커밋)
- When: ① `GET /api/points/costs`(무토큰 공개) ② `GET /api/points/balance` ③ `GET /api/points/history` 를 `USER_TOKEN` 으로 호출 ④ `git diff 4f52f16 --name-only` (워킹트리 diff) 실행하면
- Then: ①~③ 200 — 기존 스키마 그대로(costs 액션·단가 불변, balance 가 PT-API-03 원복 후 값과 일치 — 사용자 뷰와 관리자 뷰 정합), history 에 admin_adjust ±행이 **사용자에게도 정상 노출**(원장 공유 — 이상 렌더·500 없음) ④ 변경 파일 목록에 **points_service.py·routes/points.py 부재**, 변경분이 PLAN §2 매트릭스와 정확 일치(초과 파일 출현 시 즉시 중단·planner 보고).

### PT-API-09. 9004 미러 — 2파일 diff 0 + 대표 케이스 [api] — 미러 규칙
- Given: 9004 기동, `ADMIN_TOKEN`·`USER_TOKEN`
- When: ① `diff backend_9005/app/routes/admin_points.py backend_9004/app/routes/admin_points.py` + main.py 상호 diff ② **9004** summary 를 `ADMIN_TOKEN`(200)·`USER_TOKEN`(403) 으로 각 1회 호출하면
- Then: ① admin_points.py diff **0**, main.py 는 기존 미러 예외(`_logs.py` 파일명) 외 diff 없음 ② 9005 와 동일 판정. **9004 에 adjust 호출은 하지 않음**(쓰기 중복 회피 — diff 0 으로 갈음).

## 2. [unit] 시나리오 — AdminPointsPage·검색 드롭다운 (브라우저 하니스, 4001 dev)

### PT-UNIT-01. /points 진입 — 사이드바 7번째·4블록·비용표 [unit] — 핵심
- Given: 관리자 로그인
- When: 사이드바 7번째 메뉴 **"별 관리"**(FiStar) 클릭하면
- Then: `/points` 진입 + active 하이라이트(기존 6개 NavLink 무손상), 4블록 렌더 — ①요약 카드 4(summary 값과 일치) ②검색+조정 폼 ③원장 영역(선택 전 상태) ④비용표: `GET /api/points/costs` 기반 5행(작사/작곡/커버/캐릭터/피로스킵 라벨 + ⭐단가) **읽기 전용**(수정 입력·버튼 부재 — 강행 금지 ③). 콘솔 신규 에러 0건.

### PT-UNIT-02. 검색 드롭다운 — 단일 선택·선택 시 닫힘 (v179 패턴 회귀) [unit] — 핵심
- Given: `/points` 진입 상태
- When: ① 검색 input focus → ② 타이핑 축소 → ③ 테스트 계정 항목 **첫 클릭** → ④ 재focus → ⑤ 바깥 mousedown / Esc 하면
- Then: ① 브라우즈 1회+드롭다운 표시(height 고정·오버레이 — v179 판정 기준 준용) ② 300ms 디바운스·자연 축소 ③ **첫 클릭 선택 성공(씹힘 없음) + 드롭다운 즉시 닫힘**(CS 모달의 다중선택 유지와 달리 **단일 선택 사양**) + input 에 `닉네임#code` 표시 + **잔액 자동 표시**(balance API 호출 1회) ④ 재오픈·재호출 ⑤ 닫힘 / 드롭다운만 닫힘. `[AdminUserSearch]` 신규 컴포넌트가 v179 검증 패턴(blur 금지)을 계승함을 행동 수준으로 확인.

### PT-UNIT-03. 조정 폼 검증·confirm 문안 [unit]
- Given: 테스트 계정 선택된 상태
- When: ① 사유 빈 값으로 지급 시도 ② 수량 0/미입력 시도 ③ 유효 입력 후 지급 클릭 → confirm 에서 **취소** 하면
- Then: ①② 클라이언트 차단(안내 표시) — **네트워크 adjust POST 0건** ③ `window.confirm` 문안에 **대상 `닉네임#code`·방향(지급/차감)·수량·사유** 전부 명시, 취소 시 POST 0건·상태 불변.

### PT-UNIT-04. 조정 성공 — 잔액·요약·원장 3자 갱신 [unit] — 핵심 (쓰기 — PT-E2E-01 과 동일 세션 겸측 권장)
- Given: 테스트 계정 선택, 사전 잔액 표시값 기록
- When: 지급 N confirm **수락** → (검증 후) 동량 차감 confirm 수락(원복)하면
- Then: 성공 안내 후 **3자 동시 갱신** — ① 잔액 표시 +N ② 요약 카드(total/today) delta 반영 ③ 원장 테이블 최상단에 admin_adjust 행(수동 새로고침 불요). 차감 원복 후 3자 원상+spend:admin_adjust 행. 실패(400) 시 사유 표시 경로는 잔액 초과 차감 1회로 확인(서버 400 메시지 렌더 — PT-API-05 재사용, 추가 쓰기 없음).

### PT-UNIT-05. 원장 렌더 — 라벨·증감 색·fallback·필터 버튼 [unit]
- Given: TEST_USER_1 원장 표시 상태(admin_adjust ±행 실재)
- When: 원장 테이블과 필터 버튼(전체/earn/spend/refund/admin)을 확인·전환하면
- Then: `admin_adjust`→**"관리자 지급"**·+N green / `spend:admin_adjust`→**"관리자 차감"**·−N red, ref(`adm:` 접두+사유 가시)·day·시각 formatDate 렌더. 필터 전환 시 재조회+매핑 결과 일치(PT-API-07 정합)+페이지네이션 동작. 미등록 액션 fallback(원문+gray)은 **코드 리뷰 갈음 확정**(§4-3 — 원장 직접 INSERT 는 오염이라 금지) — 기존 listen/attendance 등 행이 있으면 등록 라벨 실측 병행.

### PT-UNIT-06. 감사 짝 항목 — /logs "별 조정" 라벨 [unit] — 핵심 (v177 재발 방지)
- Given: PT-API-03/06 실행 후(points_adjust 행 실재), `/logs` 진입
- When: action 필터에서 points_adjust 행을 표시하면
- Then: **"별 조정" 라벨+배지**로 렌더(gray fallback 아님 — ACTION_META 등록 확인, 짝 항목 검증), 대상 셀 `사용자 닉네임#code` Link+title=uuid(v177 기능 회귀), details 요약에 사유 노출은 허용 사양(콘솔 미출력과 구분). action 필터 select 에 항목 노출 여부 보조 확인.

### PT-UNIT-07. 회귀 스모크 — CS 모달 무변경·기존 7페이지 [unit]
- Given: 관리자 로그인
- When: ① `/cs` "✉️ 지정 발송" 모달 — focus 오픈→첫 클릭 선택(**다중선택 유지** — v179 동작)→바깥 클릭 닫힘→모달 닫기(발송 시도 없음) ② 대시보드/사용자/트랙/신고/CS/감사 로그/사용자 상세 등 기존 페이지 순회하면
- Then: ① v179 판정 기준 그대로(공용 드롭다운 신설이 AdminCsSendModal 을 건드리지 않음 — git diff 부재는 PT-API-08 ④ 겸측) + **send/broadcast POST 0건** ② 전 페이지 정상 렌더+사이드바 7개 체제에서 기존 6개 무손상. 콘솔 신규 에러 0건.

### PT-UNIT-08. 콘솔 위생 [unit] — 마감
- Given: PT-UNIT-01~07 수행 세션 콘솔(+adjust 실패 1회 포함됨 — PT-UNIT-04)
- When: 콘솔 전체에서 ① **사유 원문** ② 닉네임 ③ `@test.invalid` 를 검색하면
- Then: `[AdminPoints]`·`[AdminUserSearch]` 포함 전부 **0건** — 로그는 건수/길이(reason_len 등)/status 수준만. adjust 요청 body 덤프 미출력.

## 3. [e2e] 시나리오 — 1건 (행동 수준)

### PT-E2E-01. 풀 여정 — 검색→지급 수락→3자 확인→감사→동량 차감 원복 [e2e] — 핵심 (쓰기: grant N + deduct N, 순변화 0 — 테스트 계정만)
- Given: 관리자 앱(4001) 테스트 관리자 로그인. 대상 = TEST_USER_1 만(confirm 문안에서 `닉네임#code` 최종 대조 — 불일치 시 즉시 취소·FAIL)
- When: 사이드바 "별 관리" → 검색 input focus → `bcast_user_test` 타이핑 → 대상 선택(드롭다운 닫힘·잔액 표시) → 지급 N·사유 입력 → confirm **수락** → 잔액 +N 갱신 확인 → 원장에 "관리자 지급" +N 행 확인 → "감사 로그" 이동 → points_adjust 행 **"별 조정" 라벨+닉네임#code** 확인 → `/points` 복귀 → **동량 차감 N** confirm 수락 → 잔액 원상·"관리자 차감" −N 행 확인하면
- Then: 전 단계 정상 전이·콘솔 신규 에러 0건·**종료 잔액 == 시작 잔액**(원복 완결). PT-UNIT-04 와 동일 세션 겸측 가능(쓰기 중복 최소화 — 겸측 시 결과표 비고 기재).
- 증적: 선택+잔액·confirm·지급 후 3블록·감사 로그 행·차감 원복 후 스크린샷.

## 4. planner 확인 필요 사항

1. **summary delta 판정 전제**: dev DB 단독 사용(동시 적립/소진 트래픽 없음) 전제로 total/today delta == ±N 정확 일치 판정 — 동시 트래픽 가능 환경이면 "TEST_USER_1 balance 반영 확인"으로 완화 필요. 전제 확정 회신.
2. **비정수 amount 상태 코드**: 1.5 등은 FastAPI 타입 강제 시 422 가능 — PLAN 은 400 계열 명시. 구현 확정 후 400/422 기대값 통일(v177 §6-7 동일 이슈).
3. **원장 미등록 액션 fallback 실측**: point_events 직접 INSERT 는 원장 오염이라 지양 — 실 미등록 행 부재 시 **라벨 맵 코드 리뷰 갈음**으로 설계(PT-UNIT-05). 임시 행 방식 요구 시 회신(admin_logs 와 달리 원장은 원복 DELETE 도 감사성 훼손 소지).
4. **earn 필터의 admin_adjust 포함 여부**: PLAN §1 매핑은 `earn=나머지(amount>0)` — admin_adjust(+) 가 admin 필터 전용인지 earn 에도 잡히는지 모호. 구현 확정 후 PT-API-07 ⑤ 기대값 고정 요청.
5. **BASE_REV**: git diff 기준(v179 종료 커밋 해시)을 backend-dev/frontend-dev 완료 보고에서 tester 에 전달(관행 — v178 §4-5·v179 §4-3 동일).

### planner 판정 (2026-08-13, 5건 전부 확정 — 해당 문안 반영 완료)

1. **summary delta — 정확 판정 유지 + 완화 절차 병기.** dev 환경에 사용자 수동 테스트 간헐 발생 이력(07:20 전례)이 있어 무조건 정확 일치를 강제하면 위양성 FAIL 위험 → 호출 창 최소화(직전·직후 연속 호출) 기본 + 불일치 시 1회 재실행 → 재차 불일치면 balance·원장 반영 확인으로 완화 판정(FAIL 아님)+외부 트래픽 비고. §0·PT-API-01 반영.
2. **비정수 amount 400 확정.** 코드 실측: `AdjustBody.amount: Any`(admin_points.py:51 — "pydantic 422 회피" 주석) + 수동 `isinstance(int)`·bool 명시 거부 → 1.5/true 전부 400 도달. 422 관측 시 FAIL.
3. **원장 미등록 액션 fallback — 코드 리뷰 갈음 확정.** point_events 직접 INSERT 는 재화 원장 오염(DELETE 원복도 감사성 훼손 소지 — admin_logs 임시 행과 달리 금전 기록) → 금지. 라벨 맵+fallback 분기 코드 리뷰 + 실재 등록 액션 행 실측 병행으로 충분.
4. **earn 필터 admin_adjust 제외 확정.** `_EVENT_FILTERS["earn"]` = `{amount>0, action: {$not: ^refund:, $ne: admin_adjust}}` 코드 실측 — PT-API-07 ⑤ 기대값 고정(관리자 지급은 admin 필터 전용).
5. **BASE_REV = `4f52f16`** (v179 커밋 — planner git log 실측: 현재 HEAD, v180 워킹트리 미커밋). PT-API-08 을 `git diff 4f52f16 --name-only` 로 고정.

## 5. 실행 순서 권고 (tester 참고)

1. 사전: TEST_USER_1 잔액 `B0`·`P0`(points_adjust total) 기록, GHOST_UUID 404 확인
2. PT-API-02 (401/403 — 비파괴 선행) → PT-API-04 (검증 스윕) → PT-API-01+03 (summary 전→grant→delta→deduct→원상) → PT-API-05 (잔액 초과 400) → PT-API-06 (연속 지급+원복) → PT-API-07 (events 필터 — 생성 행 활용) → PT-API-08 (사용자 API+diff) → PT-API-09 (9004)
3. PT-UNIT-01→02→03 (비파괴) → PT-UNIT-04(+PT-E2E-01 겸측 판단) → PT-UNIT-05→06→07 → PT-UNIT-08 (콘솔 마감)
4. PT-E2E-01 (겸측 안 했으면 단독 실행 — grant/deduct 짝 엄수)
5. 종료: 전 계정 잔액 원상 재확인 + REPORT 에 원장·감사 잔존 행 내역 기재

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| PT-API-01 | api | | summary 5필드 + grant/deduct delta |
| PT-API-02 | api | | 4 엔드포인트 401 + summary·adjust 403 |
| PT-API-03 | api | | grant→원장 admin_adjust→deduct 원복 + 감사 2행 |
| PT-API-04 | api | | 400/404 스윕 — 잔액·원장 무변화 |
| PT-API-05 | api | | 잔액 초과 차감 400·잔액 불변 (원자성 핵심) |
| PT-API-06 | api | | 동일 사유 연속 2회 성공(ref 유니크) + 2N 원복 |
| PT-API-07 | api | | 필터 4종 매핑·클램프·미혼입 (earn 은 §4-4 확정 후) |
| PT-API-08 | api | | 사용자 points API 무변경 + git diff 매트릭스 일치 |
| PT-API-09 | api | | 9004 diff 0 + summary 200/403 — adjust 미호출 |
| PT-UNIT-01 | unit | | 7번째 NavLink·4블록·비용표 읽기 전용 |
| PT-UNIT-02 | unit | | 단일 선택·선택 시 닫힘·잔액 표시 (v179 패턴) |
| PT-UNIT-03 | unit | | 폼 차단·confirm 문안·취소 POST 0건 |
| PT-UNIT-04 | unit | | 3자 갱신(잔액·요약·원장) + 원복 — E2E 겸측 가능 |
| PT-UNIT-05 | unit | | 원장 라벨·색·ref 가시·필터 버튼 (fallback 은 §4-3) |
| PT-UNIT-06 | unit | | "별 조정" 라벨+닉네임#태그 (짝 항목) |
| PT-UNIT-07 | unit | | CS 모달 스모크(발송 0)·기존 페이지 |
| PT-UNIT-08 | unit | | 사유·닉네임·이메일 콘솔 0건 |
| PT-E2E-01 | e2e | | 풀 여정 + 동량 차감 원복 — 종료 잔액 == 시작 잔액 |

## v180 시나리오 집계

- 총 **18건** — [api] 9 / [unit] 8 / [e2e] 1 (피라미드 유지, 보류 없음 — planner 확인 5건은 §4)
- 쓰기: point 조정만 — PT-API-03(±N)·PT-API-06(+2N/−2N)·PT-UNIT-04/PT-E2E-01(±N, 겸측 시 1회) 전부 **테스트 계정 + 동량 원복(순변화 0)**. 원장·감사 행 잔존 정상 — REPORT 기재. CS 발송·브로드캐스트 호출 0건(스모크는 선택 단계까지, POST 0건 확인). 실사용자 무접촉.

## 개정 이력 (v180)

- 2026-08-13 초판 작성 (18건) — PLAN v180 §4 항목 1~8 전부 시나리오화(§4-1→PT-API-01·02, §4-2→PT-API-03, §4-3→PT-API-04·05·06, §4-4→PT-API-07, §4-5→PT-UNIT-01~05, §4-6→PT-UNIT-06, §4-7→PT-API-08·09·PT-UNIT-07, §4-8→PT-UNIT-08). 조정 쓰기는 grant/deduct 짝(순변화 0)으로 설계하고 종료 시 잔액 원상 검증을 불변식으로. summary delta 전제·비정수 422·fallback 실측·earn 매핑·BASE_REV 5건 planner 회신 대기(§4).
- 2026-08-13 planner 판정 반영 — §4 판정 블록 5건 확정(delta 정확 판정+완화 절차 / 비정수 400 — `amount: Any` 수동 검증 실측 / fallback 코드 리뷰 갈음 — 원장 INSERT 금지 / earn 필터 admin_adjust 제외 — `_EVENT_FILTERS` 실측 / BASE_REV `4f52f16`). §0·PT-API-01·04·07·08·PT-UNIT-05 문안 6곳 고정. 보류 0건 — tester 착수 가능(**전제: 9005·9004 v180 반영 재기동** — frontend-dev 보고의 404 는 구버전 백엔드 유래).

# v181 — 별 분석 대시보드 (/points 탭 분리 + 집계 3블록) (2026-08-13 19:22)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v181 §0 실측(birth_date 백필·GENDERS 도메인·day 사전순 범위 매치·라벨 named export), §1 설계 결정, §4 테스트 항목 1~7, §5 강행 금지 6항·리스크 3건
대상: backend_9005 `admin_points.py` analytics 3 엔드포인트 추가(daily/breakdown/demographics — 9004 미러) / frontend_admin AdminPointsDashboard 신설 + AdminPointsPage 탭 분리(운영 탭 무변경)+라벨 export+`signup_bonus` 라벨 + api.js 3래퍼. **points_service.py·routes/points.py·main.py·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **기본 전부 읽기 전용** — 집계 조회뿐. 유일한 쓰기 = PD-API-04 delta 검증 **1쌍**(테스트 계정 grant N → 동량 deduct 원복, 잔액 순변화 0). CS 발송·브로드캐스트 호출 0건. 실사용자 무접촉.
- **delta 의 집계 잔존**: grant/deduct 는 잔액은 원상이나 원장·집계(daily earned/spent, breakdown ±)에는 **±N 이 영구 잔존**(원장 삭제 불가 방침의 연장 — 정상). REPORT 에 잔존 내역 기재(planner 확인 §4-3).
- **개인정보 비노출이 이번 검증의 핵심**(강행 금지 ④): 응답·화면·서버 로그·콘솔 어디에도 birth_date/gender/user_id **개별값** 금지 — 버킷 합산만. tester 의 REPORT 에도 테스트 계정의 생년월일·성별 원문을 기재하지 않고 **버킷명만** 기재(예: "20대 버킷 반영 확인").
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`/`USER_TOKEN`/`TEST_USER_1_ID` — v177~180 방식. `BASE_REV` = **v180 종료 커밋(planner 검토 시 확정 예정 — 확정 전 diff 판정 보류)**.
- 정합 대조 전제(planner 확정 §4-4): 3 API 짧은 시간창 연속 호출 — **불일치 시 즉시 1회 재실행, 재불일치면 FAIL**(외부 트래픽은 3 API 에 동일 반영되므로 재실행으로 호출 간 시차 경합만 배제하면 잔여 불일치는 버그).
- 환경: 9005·9004, Mongo(point_events)·PG(users), frontend_admin Vite dev(4001). 추적자 `[admin-points]`·`[AdminPointsDash]`·`[AdminPoints]`.

## 1. [api] 시나리오 — analytics 3 엔드포인트 (기본 대상 9005)

### PD-API-01. 3 API 200 스키마 — daily 0 채움 연속성·breakdown DESC·demographics 5행 고정 [api] — 핵심
- Given: `ADMIN_TOKEN`
- When: ① `GET /api/admin/points/analytics/daily?days=30` ② `GET .../analytics/breakdown?days=30` ③ `GET .../analytics/demographics?days=30&mode=earn` 호출(+days=7·90 스팟 각 1회)하면
- Then:
  - ① 200 `{days:[{day, earned, spent}]}` — **배열 길이 == 30 정확**(7→7, 90→90), day 가 KST `%Y%m%d` 연속 오름차순(누락일 **0 채움** — earned/spent 0인 날도 행 실재), 마지막 요소 == KST 오늘, earned ≥0·spent ≥0 숫자
  - ② 200 `{earn:[{action, total}], spend:[{action, total}]}` — 양 패널 total **DESC 정렬**, action 은 원문(라벨 없음 — 프론트 책임), total >0
  - ③ 200 `{rows:[...5행 고정], total}` — rows 순서 10대/20대/30대/40대+/미상, 각 행 `{bucket, male, female, unknown, total}` — **행 total == male+female+unknown**, 응답 total == Σ행 total. 데이터 없는 버킷도 0 행 실재(5행 불변)

### PD-API-02. 파라미터 화이트리스트 400 + 401·403 [api]
- Given: `ADMIN_TOKEN` / 토큰 없음 / `USER_TOKEN`
- When: ① days=8 / 0 / 91 / −7 / abc (daily 기준, breakdown·demographics 각 1케이스 스팟) ② demographics mode=all / 빈값 / 대문자 EARN ③ 3 엔드포인트 무토큰 ④ 대표 1개(demographics — 민감 집계) `USER_TOKEN` 으로 각각 호출하면
- Then: ① 전부 **400**(화이트리스트 {7,30,90} 외 — 422 관측 시 비고 후 통일, v177 §6-7 관행) ② 전부 400(earn|spend 외) ③ 전부 401 ④ 403. 오류 응답에 내부 정보(스택·쿼리) 미노출.

### PD-API-03. 3 API 상호 정합 — 교차 대조 (같은 원장 유래, 정확 일치) [api] — 핵심
- Given: `ADMIN_TOKEN`. 동일 days(30)로 4콜을 **짧은 시간창 내 연속 실행**: daily / breakdown / demographics(mode=earn) / demographics(mode=spend)
- When: 각 응답의 합계를 계산·대조하면
- Then: **전부 정확 일치 — 불일치 시 FAIL**(전 응답이 동일 point_events 기간 슬라이스 유래):
  - `Σ daily[].earned` == `Σ breakdown.earn[].total` == `demographics(mode=earn).total`
  - `Σ daily[].spent` == `Σ breakdown.spend[].total` == `demographics(mode=spend).total` — **spent 계열 전부 양수(절대값) 확정**(§4-5, 코드 실측: 3 엔드포인트 모두 `$abs` — 음수 관측 시 FAIL)
  - 보조: v180 summary 와 부분 정합 — `daily 마지막 요소(오늘).earned/spent` == summary `today_earned/today_spent`(같은 시간창 재조회)

### PD-API-04. delta 검증 1쌍 (선택) — grant +N 3면 반영 → 동량 차감 원복 [api] — (유일한 쓰기: ±N, 테스트 계정)
- Given: `ADMIN_TOKEN`, `TEST_USER_1_ID`. 사전: 3 API(30일·earn) 기준값 기록 + 테스트 계정의 기대 버킷 확인(DB 조회 — REPORT 에는 버킷명만 기재, 원문 금지)
- When: v180 패턴 `POST /adjust` grant N → 3 API 재조회 → 동량 deduct(원복) → 재조회하면
- Then:
  - grant 후: daily **오늘** earned +N / breakdown.earn 에 `admin_adjust` 항목 +N(신규 또는 증가) / demographics(earn) **해당 버킷·해당 성별 열** +N + total +N — 타 버킷·타 열 불변
  - deduct 후: 잔액 원상(v180 불변식) + daily 오늘 spent +N / breakdown.spend 에 `spend:admin_adjust` +N / demographics(spend) 동일 버킷 +N — **earned 쪽 +N 은 잔존**(집계 잔존 정상 — §0)
  - PD-API-03 정합식이 delta 후에도 성립(재대조 1회)

### PD-API-05. 개인정보 비노출 — 응답 전문·서버 로그 [api] — 핵심 (강행 금지 ④)
- Given: PD-API-01~04 의 3 API 응답 전문(JSON 원문 보관), 백엔드 로그(테스트 실행 구간)
- When: ① 응답 원문에서 uuid 패턴(`[0-9a-f]{8}-[0-9a-f]{4}-…`)·날짜 패턴(생년월일 `\d{4}-\d{2}-\d{2}`)·`@`(이메일)·사용자 개별 레코드 배열 구조를 검사 ② 서버 로그를 동일 패턴 + 테스트 계정 닉네임으로 grep 하면
- Then: ① **전부 0건** — 응답은 버킷·액션 합산값만(demographics 의 male/female/unknown 은 **집계 열 이름**이며 개별 사용자 성별 값 아님 — 구조 검사로 구분: rows 5행 외 사용자 단위 배열 부재) ② 서버 로그는 `[admin-points]` days/mode/행 수 수준만 — birth_date 값·user_id 나열·성별 개별값 **0건**. 위반 발견 시 즉시 중단·planner 보고(비노출은 협상 불가 항목).

### PD-API-06. 회귀 — v180 4 엔드포인트·사용자 API·package.json [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(v180 종료 커밋 — planner 확정 후)
- When: ① v180 대표 케이스 재실행 — summary 200 5필드 / `users/{TEST_USER_1_ID}/balance` / events `filter=admin` 매핑 / adjust 검증 400 대표 1건(빈 reason — 비파괴) ② 사용자용 `GET /api/points/costs·balance·history`(USER_TOKEN) ③ `git diff {BASE_REV}..HEAD --name-only` 하면
- Then: ① v180 TESTPLAN 판정 기준 그대로 PASS(analytics 추가가 기존 4개를 건드리지 않음) ② 200·스키마 불변 ③ 변경 파일 == PLAN §2 매트릭스 정확 일치 — points_service.py·routes/points.py·main.py 부재 + **package.json(및 lock 파일) 부재 — 차트 라이브러리 미도입 검증**(강행 금지 ③). 초과 파일 출현 시 즉시 중단·보고.

### PD-API-07. 9004 미러 — diff 0 + 대표 케이스 [api] — 미러 규칙
- Given: 9004 기동
- When: ① `diff backend_9005/app/routes/admin_points.py backend_9004/app/routes/admin_points.py` ② **9004** daily(30일) `ADMIN_TOKEN` 200 + demographics `USER_TOKEN` 403 각 1회 하면
- Then: ① diff **0** ② 9005 와 동일 판정(9004 main.py 는 무변경 — 등록 기존이므로 diff 대상 아님, 확인만).

## 2. [unit] 시나리오 — 탭 분리·대시보드 (브라우저 하니스, 4001 dev)

### PD-UNIT-01. 운영 탭 회귀 — v180 무변경 증빙 [unit] — 핵심
- Given: 관리자 로그인, `/points` 진입
- When: ① 탭 2개(운영/분석 대시보드) 확인 — 기본 탭 상태 기록 ② **운영 탭**에서 v180 핵심 동작 재실행 — 4블록 렌더·검색 드롭다운(focus 오픈→첫 클릭 단일 선택·닫힘·잔액 표시)·조정 폼 유효 입력 후 confirm **취소**(adjust POST 0건)·원장 라벨/필터·비용표 읽기 전용 하면
- Then: v180 PT-UNIT-01/02/03/05 판정 기준 그대로 PASS — 탭 래핑이 운영 기능을 훼손하지 않음. 보조(코드 리뷰): AdminPointsPage diff 가 **탭 스위치·JSX 래핑·named export 2·`signup_bonus` 라벨 1줄뿐**(핸들러·상태 로직 무변경 — 강행 금지 ①), 탭 전환 왕복 후 운영 탭 상태(선택 대상·입력값) 처리 방식 기록(초기화/유지 어느 쪽이든 크래시 없음).

### PD-UNIT-02. 분석 탭 — 3블록 렌더·라벨·각주 [unit] — 핵심
- Given: 분석 대시보드 탭 진입(기본 30일)
- When: 3블록을 확인하면
- Then:
  - **추이**: 이중 막대 30쌍(적립 green/소진 red, 높이 비율 = 값/기간 최대값), **hover 툴팁에 일자·수치**(title 폴백 병행), 0 값 날도 슬롯 실재(0 채움 시각 반영)
  - **분포**: 2패널(획득/소비) 가로 비율 바 — actionLabel 라벨(admin_adjust="관리자 지급" 등)·%·⭐값, **`signup_bonus` → "가입 보너스" 신라벨**(기간 내 실데이터 등장 시 실측 — 미등장 시 라벨 맵 코드 확인으로 갈음, planner 확인 §4-6), 미등록 액션 원문 fallback
  - **인구**: 5행 스택 바(남/여/미상 구성비)+행별 합계 ⭐+획득/소비 **토글 버튼**+각주 **"미상 = 미입력·기타"** 문구 실재. 값이 PD-API-01 ③ 응답과 일치

### PD-UNIT-03. 기간 필터 연동·토글·빈/에러 상태 [unit] — 핵심
- Given: 분석 탭(30일)
- When: ① 7일 버튼 클릭 ② 90일 클릭 ③ 인구 토글 earn↔spend ④ (가능 시) 데이터 없는 구간 관찰 ⑤ 백엔드 일시 중단 후 기간 전환 1회 하면
- Then: ① **3블록 동시 재조회**(네트워크에 daily/breakdown/demographics 3콜, days=7)+추이 막대 7쌍으로 갱신 ② 동일(days=90, 90쌍) ③ demographics 재조회(mode 전환)+스택 바 갱신 — 다른 2블록 불필요 재조회 없음(관측 결과 기록) ④ 빈 구간 안전 렌더 — 0 높이 막대/빈 상태 문구, 크래시·NaN 표시 없음 ⑤ 에러 상태 문구 표시·화면 유지(백엔드 복구 후 재시도 정상). stale 응답이 최신 기간 화면을 덮지 않음(빠른 연속 전환 1회).

### PD-UNIT-04. 콘솔 위생 + eslint [unit] — 마감
- Given: PD-UNIT-01~03 수행 세션 콘솔(+에러 상태 1회 포함), frontend_admin 저장소
- When: ① 콘솔에서 생년월일 패턴·성별 개별값·uuid·닉네임·`@test.invalid` 검색 ② eslint 실행하면
- Then: ① `[AdminPointsDash]`·`[AdminPoints]` 포함 전부 **0건** — 로그는 기간/모드/건수 수준만, 3 API 응답 덤프 미출력 ② eslint 신규 오류 0.

## 3. [e2e] 시나리오 — 1건 (행동 수준, 읽기 전용)

### PD-E2E-01. 풀 여정 — 분석 탭→기간 전환→토글→운영 탭 복귀 [e2e] — 핵심 (쓰기 0건)
- Given: 관리자 앱(4001) 테스트 관리자 로그인
- When: 사이드바 "별 관리" → **분석 대시보드 탭** 클릭 → 30일 3블록 데이터 렌더 확인 → 기간 **7일 전환**(3블록 재조회·막대 7쌍) → 인구 **토글 전환**(스택 바 갱신) → **운영 탭 복귀** → v180 기능 정상(검색→테스트 계정 선택→잔액 표시 — 조정은 confirm **취소**, adjust POST 0건)하면
- Then: 전 단계 정상 전이, 탭 왕복 후 양 탭 모두 정상 상태, 콘솔 신규 에러 0건, **네트워크에 adjust/send/broadcast POST 0건**(전 여정 읽기 전용). 감사 로그·원장에 이번 E2E 유래 신규 행 0건.
- 증적: 분석 탭 30일·7일 전환 후·토글 후·운영 탭 복귀 스크린샷.

## 4. planner 확인 필요 사항

1. **BASE_REV 확정**: v180 종료 커밋 — **`c04f9c7` 확정**(§4 판정 블록 1 — 보류 해제, PD-API-06 diff 실행 가능).
2. **delta 버킷 판정용 DB 조회**: PD-API-04 는 테스트 계정의 기대 버킷 확인을 위해 users 의 birth_date/gender 를 DB 에서 1회 조회 — 결과는 REPORT 에 **버킷명만** 기재(원문 미기재) 방침. 조회 자체 승인 확인.
3. **delta 의 집계 영구 잔존 허용**: grant/deduct 1쌍이 daily/breakdown 집계에 ±N 으로 잔존(잔액만 원상) — 원장 잔존 방침의 연장으로 설계. 허용 확인(불허 시 PD-API-04 SKIP·코드 리뷰 갈음).
4. **정합 대조 판정 규칙**: 정확 일치 기준은 "짧은 시간창 내 연속 호출 + dev DB 단독" 전제 — 호출 사이 이벤트 유입 가능 환경이면 "불일치 시 즉시 1회 재실행, 재불일치 시 FAIL" 규칙 채택 여부 회신.
5. **spent 부호 규약**: daily.spent·breakdown.spend.total·demographics(spend).total 의 절대값/음수 표기 통일 — 구현 확정 후 PD-API-03 비교식 부호 고정.
6. **signup_bonus 실측 가능성**: 조회 기간 내 가입 보너스 이벤트 부재 시 "가입 보너스" 라벨은 코드 확인으로 갈음(PD-UNIT-02) — 실측 요구 시 신규 가입 시드가 필요해 범위 초과, 갈음 승인 요청.

### planner 판정 (2026-08-13, 6건 전부 확정 — 해당 문안 반영 완료)

1. **BASE_REV = `c04f9c7`** (v180 커밋 — planner git log 실측: 현재 HEAD, v181 변경분 워킹트리 미커밋). PD-API-06 diff 는 `git diff c04f9c7 --name-only` 워킹트리 기준.
2. **버킷 판정용 DB 조회 승인** — 읽기 전용 SELECT 1회(v174 OFFICIAL_ID 조회 관행 준용). REPORT 에는 **버킷명만**(생년월일·성별 원문 기재 금지 — 개인정보 강행 금지의 문서 측 연장).
3. **집계 영구 잔존 허용** — 잔액 원상이 불변식이고 원장·집계는 append-only(원장 방침 연장). 오늘 daily 의 earned/spent 양쪽 +N 동일 부풀림은 정보성 무해. REPORT 기재 조건.
4. **정합 재실행 규칙 채택** — 불일치→1회 재실행→재불일치 FAIL. summary delta 완화(v180 §4-1)와 구별: 그쪽은 기준 시점 대비 delta(외부 유입이 오차가 됨), 이쪽은 동일 시점 API 간 비교(외부 유입도 3 API 에 같이 반영 — 재실행 후 불일치는 구현 버그).
5. **spent 전부 양수 확정** — 코드 실측: daily(:$abs)·breakdown(spend $abs)·demographics(spend $abs) 3곳 일관. PD-API-03 비교식 고정 완료.
6. **signup_bonus 코드 확인 갈음 승인** — 단 live 원장에 가입 보너스 행 실재 가능성이 높으므로(156명 가입 이력) **기간 내 실데이터 우선, 부재 시에만 갈음**(신규 가입 시드는 금지 — 범위 초과+테스트 계정 증식).

**편차 승인 기록**: PLAN §1 "actionLabel named export" → `src/utils/pointsLabels.js` 모듈 추출로 변경(frontend-dev 발견: 페이지 파일 named export 는 eslint `react-refresh/only-export-components` error 위반). byte-identical 추출 + signup_bonus 1줄 추가 diff 검증 완료 — 단일 소스 의도 충족·운영 탭 로직 무변경이라 **승인**(PLAN 측 정정으로 기록, 구현 재작업 없음).

## 5. 실행 순서 권고 (tester 참고)

1. PD-API-01→02 (읽기 전용 스키마·검증) → PD-API-03 (정합 — 짧은 시간창 4콜) → PD-API-04 (유일한 쓰기 ±N — §4-2·3 확정 후) → PD-API-05 (응답 원문·서버 로그 검사 — 01~04 산출물 재사용) → PD-API-06 (회귀+diff — BASE_REV 확정 후) → PD-API-07 (9004)
2. PD-UNIT-01 (운영 탭 회귀) → PD-UNIT-02→03 (분석 탭) → PD-UNIT-04 (콘솔 마감+eslint)
3. PD-E2E-01 (읽기 전용 여정)
4. 종료: 잔액 원상 재확인(PD-API-04 실행 시) + REPORT: 집계 잔존 내역·버킷명(원문 금지)·코드 리뷰 갈음 항목 기재

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| PD-API-01 | api | | 3 스키마 — daily 길이=days·0 채움, DESC, 5행 고정 |
| PD-API-02 | api | | days·mode 화이트리스트 400 + 401/403 |
| PD-API-03 | api | | 3 API 합계 정확 일치 + summary 부분 정합 |
| PD-API-04 | api | | delta ±N 3면 반영 — 유일한 쓰기, 버킷명만 기재 |
| PD-API-05 | api | | 응답·서버 로그 개인정보 0건 — 위반 시 즉시 중단 |
| PD-API-06 | api | | v180 대표·사용자 API·diff 매트릭스+package.json 0 |
| PD-API-07 | api | | 9004 diff 0 + daily 200·demographics 403 |
| PD-UNIT-01 | unit | | 운영 탭 v180 회귀 + diff 코드 리뷰(래핑·export만) |
| PD-UNIT-02 | unit | | 3블록·툴팁·가입 보너스 라벨·각주 |
| PD-UNIT-03 | unit | | 기간 3콜 재조회·토글·빈/에러 상태·stale |
| PD-UNIT-04 | unit | | 개인 속성·응답 덤프 콘솔 0건 + eslint 0 |
| PD-E2E-01 | e2e | | 풀 여정 — 읽기 전용, adjust/send POST 0건 |

## v181 시나리오 집계

- 총 **12건** — [api] 7 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: PD-API-04 delta **1쌍만**(테스트 계정 grant N→deduct N, 잔액 순변화 0 — 집계 잔존은 §4-3 확정 조건). 그 외 전부 읽기 전용. CS 발송·브로드캐스트 0건, E2E 는 adjust 포함 쓰기 0건(confirm 취소). 개인정보 비노출(PD-API-05·PD-UNIT-04)은 위반 시 즉시 중단 항목.

## 개정 이력 (v181)

- 2026-08-13 초판 작성 (12건) — PLAN v181 §4 항목 1~7 전부 시나리오화(§4-1→PD-API-01·02, §4-2→PD-API-03, §4-3→PD-API-04, §4-4→PD-API-05, §4-5→PD-UNIT-01~03, §4-6→PD-API-06·07, §4-7→PD-UNIT-04). 개인정보 비노출을 즉시 중단 항목으로 승격, delta 는 유일한 쓰기 1쌍으로 한정(집계 잔존 명시). BASE_REV(planner 확정 예정)·버킷 확인 DB 조회·집계 잔존·정합 재시도 규칙·spent 부호·signup_bonus 갈음 6건 planner 회신 대기(§4).
- 2026-08-13 planner 판정 반영 — §4 판정 블록 6건 확정(BASE_REV `c04f9c7` / 버킷 DB 조회 승인(REPORT 버킷명만) / 집계 잔존 허용 / 정합 재실행 1회 후 FAIL / spent 전부 양수 — 3곳 `$abs` 실측 / signup_bonus 실데이터 우선·부재 시 갈음) + pointsLabels.js 편차 승인 기록. §0·§4-1·PD-API-03 문안 3곳 고정. 보류 0건 — tester 착수 가능(전제: 9005·9004 v181 반영 재기동).

# v182 — 별 경제 건전성 지표 3종 (순증·소비자 티어·잔액 분포) (2026-08-18 14:02)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v182 §0 실측(잔액 실분포 5구간·소비 유저 8명·day `-` 행 적립 계열 한정·순증=daily 프론트 재가공), §1 설계 결정, §4 테스트 항목 1~7, §5 강행 금지 6항·리스크 3건
대상: backend_9005 `admin_points.py` 신규 2 엔드포인트(`GET /analytics/top-spenders`·`GET /analytics/balance-distribution` — 9004 미러) / frontend_admin AdminPointsDashboard 3블록 추가(순증·소진율은 **백엔드 무변경 프론트 계산**)+api.js 2래퍼. **기존 9 엔드포인트·AdminPointsPage·pointsLabels·points_service·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **읽기 전용 위주** — 유일한 쓰기 = EH-API-06 delta **1쌍**(테스트 계정 grant N→동량 deduct, 잔액 순변화 0, v181 §4-3 집계 잔존 승인 방침 연장 — REPORT 기재). CS 발송류 0건. E2E 는 쓰기 0건.
- **개인정보 경계(강행 금지 ③)**: 티어 응답의 `nickname`/`code`/`user_id` 는 **허용 사양**(v177 감사 로그 동급 — 관리자 화면 표준). 검증 대상은 **이메일·생년월일·성별 부재**(응답·서버 로그·콘솔). REPORT 에 개인값 미기재 — 단 닉네임#code 는 허용(코디네이터 확정), 생년월일·성별·이메일은 금지 유지.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`/`USER_TOKEN`/`TEST_USER_1_ID` — v177~181 방식. `BASE_REV` = **v181 종료 커밋(planner 검토 시 확정 예정 — 확정 전 diff 판정 보류)**.
- 정합 판정 규칙: v181 확정 규칙 승계 — **불일치 시 즉시 1회 재실행, 재불일치 FAIL**(짧은 시간창 연속 호출·dev DB 단독 전제). spent 계열은 **전부 양수($abs) 규약**(v181 판정 확정 반영).
- signup_bonus(day `-`) 는 daily(=순증)·3면 정합에서 일관 제외(§5 — REPORT 재기재).
- 환경: 9005·9004, Mongo(point_events·point_balances)·PG(users), frontend_admin Vite dev(4001). 추적자 `[admin-points]`·`[AdminPointsDash]`.

## 1. [api] 시나리오 — 신규 2 엔드포인트 (기본 대상 9005)

### EH-API-01. top-spenders 200 스키마 + 빈 기간 안전 [api] — 핵심
- Given: `ADMIN_TOKEN`
- When: `GET /api/admin/points/analytics/top-spenders?days=90`(+30·7 스팟) 호출하면
- Then: HTTP 200 —
  - `top`: **≤10행**, 각 행 `{user_id, nickname, code, total}` — total **양수·DESC 정렬**, nickname/code 는 hydrate 결과(미해석 시 null — 프론트 fallback 몫)
  - `whale`: **4필드** `{top_count, top_total, all_total, share_pct}` — `top_count == max(1, ceil(0.1×spenders))`, `top_total ≤ all_total`, `share_pct == round(top_total/all_total×100, 1)` 재계산 일치
  - `spenders`: 기간 내 소비 distinct 사용자 수(음수 아님)
  - **빈 소비 기간**(소비 0 인 days 가 있으면 — 실행 시점 확인): `whale == null`·`top == []`·`spenders == 0` — 500 없음(부재 시 코드 리뷰 갈음, planner 확인 §4-3)

### EH-API-02. balance-distribution 200 — 5행 고정·스냅샷 [api] — 핵심
- Given: `ADMIN_TOKEN`
- When: ① `GET /api/admin/points/analytics/balance-distribution` ② 동일 요청에 `?days=7` 붙여 호출하면
- Then: ① 200 — `buckets` **5행 고정 라벨 순서 "0"/"1~10"/"11~50"/"51~100"/"101+"**(빈 버킷도 count 0 행 실재), 각 count ≥0 정수, `total_users`·`total_balance` 숫자 ② **days 무시**(파라미터 없는 스냅샷 사양) — ①과 동일 응답(400 아님·값 동일).

### EH-API-03. days 화이트리스트 400 + 401·403 [api]
- Given: `ADMIN_TOKEN` / 토큰 없음 / `USER_TOKEN`
- When: ① top-spenders days=8/0/91/−7/abc ② 신규 2 엔드포인트 무토큰 ③ top-spenders(닉네임 노출 응답 — 민감 대표) `USER_TOKEN` 으로 각각 호출하면
- Then: ① 전부 **400**(화이트리스트 {7,30,90} — 422 관측 시 비고 후 통일 관행) ② 전부 401 ③ 403 — 비관리자에게 티어(닉네임 순위) 비노출. 오류 응답에 내부 정보 미노출.

### EH-API-04. 잔액 검산 — Σcount == total_users == 문서 수 + summary 교차 [api] — 핵심
- Given: `ADMIN_TOKEN`. **point_balances 문서 수 DB 읽기 1회**(`countDocuments` — 읽기 전용, **planner 승인 완료 §4-2**)
- When: balance-distribution 과 v180 `GET /summary` 를 짧은 시간창 내 연속 호출하고 DB count 와 대조하면
- Then: **`Σ buckets[].count == total_users == point_balances 문서 수`**(3자 정확 일치 — 잔액 문서 보유자 모수 사양 검증, users 전체 156명과 다름이 정상) + **`total_balance == summary.total_balance`**(같은 스냅샷 교차 — 시차 쓰기로 불일치 시 1회 재실행 규칙 준용). 실분포 sanity(음수 버킷 없음 — spend 원자 차감 정합) 보조 기재.

### EH-API-05. 소비 3면 정합 — whale.all_total 교차 대조 [api] — 핵심
- Given: `ADMIN_TOKEN`. 동일 days(90)로 3콜을 짧은 시간창 내 연속 실행: top-spenders / breakdown / daily
- When: 합계를 대조하면
- Then: **`whale.all_total == Σ breakdown.spend[].total == Σ daily[].spent`** — 같은 amount<0 소스 3면, 전부 양수 규약, **정확 일치(불일치→1회 재실행→FAIL)**. 보조: `Σ top[].total ≤ all_total`(top10 부분합), `spenders ≥ top 행 수`. days=30 으로 1회 반복(기간 매개 정합).

### EH-API-06. delta 1쌍 (선택) — 순증·소진율·티어 반영 + 원복 [api] — (유일한 쓰기: ±N, 테스트 계정)
- Given: `ADMIN_TOKEN`, `TEST_USER_1_ID`. 사전: daily(오늘 행)·top-spenders(테스트 계정 등장 여부)·balance-distribution 기준값 기록
- When: v180 패턴 grant N → 즉시 deduct N(원복) → 3 API 재조회하면
- Then:
  - daily 오늘: earned +N **및** spent +N — **순증(earned−spent) 기여 0**(상쇄), 소진율 분자·분모 각 +N(프론트 대조는 EH-UNIT-01 몫)
  - top-spenders: 테스트 계정이 소비 Σ ≥N 으로 **등장 또는 total 증가**(deduct 가 소비 행 — day 정상 세팅이라 티어 집계 포함 실측), whale.all_total +N — EH-API-05 정합식 재성립(재대조 1회)
  - balance-distribution: **원복 후 기준값과 동일**(잔액 원상 — 버킷 이동 없음. grant 직후 중간 상태는 미판정)
  - 잔액 원상 확인(v180 불변식) + 집계 ±N 영구 잔존 REPORT 기재

### EH-API-07. 회귀 — 기존 9 엔드포인트·diff·개인정보 [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(v181 커밋 — 확정 후)
- When: ① 대표 재실행 — v180 summary/balance/events(filter=admin)/adjust 400 대표 1건 + v181 daily·breakdown·demographics 스키마 대표 각 1건 ② 사용자용 `GET /api/points/costs·balance·history`(USER_TOKEN) ③ `git diff {BASE_REV}..HEAD --name-only` ④ 신규 2 응답 전문·서버 로그 검사하면
- Then: ① v180~181 TESTPLAN 판정 기준 그대로 PASS(신규 2개 추가가 기존을 건드리지 않음) ② 스키마 불변 ③ 변경 파일 == PLAN §2 매트릭스 정확 일치 — AdminPointsPage·pointsLabels·points_service·routes/points.py·main.py·**package.json(및 lock) 부재**(라이브러리 금지) ④ **개인정보 회귀**: 신규 2 응답 전문에 `@`(이메일)·생년월일 패턴·성별 필드 **0건**(티어의 nickname/code/user_id 는 허용 사양 — 판정 제외 명시), 서버 로그는 admin_tag/days/spenders 수만(닉네임·id 나열 0건). 위반 시 즉시 중단·보고.

### EH-API-08. 9004 미러 — diff 0 + 대표 케이스 [api] — 미러 규칙
- Given: 9004 기동
- When: ① `diff backend_9005/app/routes/admin_points.py backend_9004/app/routes/admin_points.py` ② **9004** top-spenders `ADMIN_TOKEN` 200 + balance-distribution `USER_TOKEN` 403 각 1회 하면
- Then: ① diff **0** ② 9005 와 동일 판정.

## 2. [unit] 시나리오 — 대시보드 3블록 (브라우저 하니스, 4001 dev)

### EH-UNIT-01. 순증·소진율 프론트 계산 대조 [unit] — 핵심
- Given: 분석 탭(30일), 같은 세션에서 `GET /analytics/daily?days=30` 응답 확보(네트워크 탭)
- When: 순증 블록·소진율 카드 값을 daily 응답으로 재계산·대조하면
- Then: **일별 순증 막대 값 == earned−spent**(양수 green 상향/음수 red 하향 — 0축 기준), **소진율 카드 == Σspent/Σearned %**(**소수 1자리 확정 §4-5** — frontend 실측 73.4% 형식·backend share_pct round(,1) 와 동일 규약), **신규 fetch 없음**(순증 블록은 daily state 재가공 — 기간 전환 시에도 순증용 추가 콜 0). `Σearned == 0` 기간의 **"-" 방어**는 실측 가능 시 실측(7일 등), 불가 시 코드 리뷰 갈음. 기간 전환 시 순증·소진율이 새 daily 와 함께 갱신.

### EH-UNIT-02. 블록 배치·기간 연동·스냅샷 배지 [unit] — 핵심
- Given: 분석 탭(30일)
- When: ① 블록 순서 확인 ② 기간 7일 전환 ③ 잔액 블록 확인하면
- Then: ① 위→아래 **추이→[순증·소진율]→분포→인구→티어→잔액 분포** 순서 정확 ② 재조회 네트워크 == **daily/breakdown/demographics/top-spenders 4콜**(days=7) — **balance-distribution 콜 없음**(스냅샷 미재조회) ③ 잔액 블록에 **"현재 기준" 배지** + 각주 **"잔액 기록 보유 사용자 기준"** 실재(모수 오독 방지 — §5), 세로 히스토그램 5구간 라벨이 API buckets 와 일치.

### EH-UNIT-03. 티어 렌더 — Link·fallback·whale 카드·빈 상태 [unit]
- Given: 분석 탭, top-spenders 응답 보유
- When: 티어 블록을 확인하면
- Then: 순위+**`닉네임#code` Link(→`/users/:id`, title=uuid — v177 관행)**+소비 ⭐ 가 응답 순서·값과 일치, whale 카드 **"상위 10%(N명)가 전체 소비의 X% 점유"**(N=top_count·X=share_pct 병기 — 소규모 모수 오해 방지 §5), hydrate 미해석 행 `사용자 #id8` fallback(실 미해석 행 부재 시 코드 리뷰 갈음), 빈 상태 문구 "기간 내 소비 없음"(소비 0 기간 실측 가능 시 — EH-API-01 과 동일 조건). Link 클릭 검증은 **테스트 계정 행만**(실사용자 상세 진입 금지 — 부재 시 href 속성 검사로 갈음).

### EH-UNIT-04. 운영 탭 회귀 스모크 + 콘솔 위생 + eslint [unit] — 마감
- Given: EH-UNIT-01~03 수행 세션, `/points` 운영 탭
- When: ① 운영 탭 — 검색 드롭다운 첫 클릭 선택·조정 confirm **취소**(adjust POST 0건)·원장·비용표 스모크 ② 콘솔에서 이메일·생년월일 패턴·성별 값·응답 덤프 검색 ③ eslint 실행하면
- Then: ① v180~181 판정 기준 그대로(무변경 — git diff 는 EH-API-07 ③ 겸측) ② `[AdminPointsDash]` 포함 **0건** — 티어 닉네임은 화면 렌더 허용이나 **콘솔 로그에는 미출력**(건수/기간 수준만) ③ eslint 신규 0.

## 3. [e2e] 시나리오 — 1건 (행동 수준, 쓰기 0건)

### EH-E2E-01. 분석 탭 풀 여정 — 신규 3블록→기간 전환→운영 복귀 [e2e] — 핵심 (쓰기 0건)
- Given: 관리자 앱(4001) 테스트 관리자 로그인 (EH-API-06 실행 후면 티어에 테스트 계정 행 존재 — Link 클릭 검증 가능)
- When: "별 관리" → 분석 탭 → 스크롤로 **6블록 순서·신규 3블록(순증/티어/잔액) 렌더** 확인 → 기간 **7일 전환** → 티어 포함 4콜 재조회·잔액 블록 유지 확인 → (티어에 테스트 계정 행이 있으면) Link 클릭 → `/users/:id` 이동·복귀 → **운영 탭 복귀** → v180 기능 정상(검색·선택·잔액 표시 — 조정 confirm 취소)하면
- Then: 전 단계 정상 전이, 잔액 블록 "현재 기준" 배지 유지, 콘솔 신규 에러 0건, **네트워크에 adjust/send/broadcast POST 0건**(전 여정 읽기 전용 — delta 는 [api] 단계 전용). 실사용자 티어 행 클릭 금지(테스트 계정 행 부재 시 클릭 생략·비고).
- 증적: 6블록 전경·7일 전환 후 티어/잔액·운영 탭 복귀 스크린샷.

## 4. planner 확인 필요 사항

1. **BASE_REV 확정**: v181 종료 커밋 = **`54c22c3` 확정**(planner git log 실측 — 현재 HEAD, v182 변경분 워킹트리 미커밋). EH-API-07 ③ 은 `git diff 54c22c3 --name-only` 워킹트리 기준 — 보류 해제.
2. **EH-API-04 DB 읽기 1회 승인**: point_balances `countDocuments`(읽기 전용) — 코디네이터 "승인 예정" 표기에 따라 확정 회신 요청. 불허 시 Σcount == total_users 2자 검산으로 축소.
3. **빈 소비 기간 실측 가능성**: whale null·top []·빈 상태 문구는 소비 0 인 days 존재 여부(실행 시점 데이터)에 의존 — 부재 시 코드 리뷰 갈음 승인(EH-API-01·EH-UNIT-03 공통).
4. **E2E 티어 Link 클릭 대상**: 테스트 계정 행 한정(실사용자 상세 진입 금지) — EH-API-06 delta 실행 후 잔존 소비로 등장 예상이나, 미등장 시 href 검사 갈음. 실행 순서 의존(api→e2e) 승인 확인.
5. **소진율 표기 포맷**: Σspent/Σearned % 의 반올림 자리(정수/1자리)·share_pct 표기 — 구현 확정 후 EH-UNIT-01·EH-UNIT-03 기대값 고정 회신.

### planner 판정 (2026-08-18, 5건 확정 + 라벨 마이크로픽스 1건 — 해당 문안 반영 완료)

1. **BASE_REV = `54c22c3`** (v181 커밋 — planner git log 실측: 현재 HEAD, v182 워킹트리 미커밋). EH-API-07 워킹트리 diff 고정, 보류 해제.
2. **point_balances countDocuments 읽기 1회 승인** — 읽기 전용 검산용(v182 §0 planner 실측과 동일 방식).
3. **빈 소비 기간 whale null — 코드 리뷰 갈음 승인.** 근거: 코드 실측 `spenders == 0` 조기 반환 `{top:[], whale:null, spenders:0}` 확인(500 경로 없음). 실행 시점에 소비 0 인 days 창이 실재하면 실측 우선.
4. **E2E 티어 Link 클릭 = 테스트 계정 행 한정 승인**(api→e2e 순서 의존 수용) — 실사용자 행 클릭 금지 원칙 유지, 테스트 행 부재 시 클릭 생략+비고(Link href 존재 확인 갈음).
5. **share_pct 소수 1자리 확정**(backend `round(,1)` 코드 실측) + **소진율 카드 73.4% 형식(소수 1자리) 고정** — 양쪽 동일 규약, EH-API-01·EH-UNIT-01 판정식 반영 완료.

**라벨 마이크로픽스 — v182 포함 확정 (frontend-dev 지시, pointsLabels.js 한정)**: planner 가 live 원장 distinct action 전수 실측 — `play`(175)·`upload`(13)·`download`(1)·`generate`(1)·`referral_inviter`(4)·`referral_joiner`(4)·`verify_bonus`(3) 실재, **`listen` 은 원장 0건**(v180 라벨 맵의 추정 오류 — 실액션은 `play`, award_point 콜사이트 실측 정합). 수정 내역:
- `listen: '재생 적립'` **제거** → **`play: '재생 적립'`** 등록(키 정정)
- 추가: `upload: '업로드 적립'` / `referral_inviter: '친구초대 보상(초대)'` / `referral_joiner: '친구초대 보상(가입)'` / `verify_bonus: '본인인증 보너스'`
- `generate` 는 **미등록 유지**(콜사이트 부재·legacy 1행 — 의미 미확정 라벨 추정 금지, fallback 원문이 정직)
재검증(EH-UNIT-02 겸측 편입): 분포 패널 `play`→"재생 적립"·`upload`→"업로드 적립" 렌더 + `generate` 원문 fallback 잔존(fallback 실증 겸측). 운영 탭 원장도 동일 모듈이라 자동 반영(표시 전용 — 무해).

## 5. 실행 순서 권고 (tester 참고)

1. EH-API-01→02→03 (읽기 전용 스키마·검증) → EH-API-04 (검산 — §4-2 확정 후 DB count 포함) → EH-API-05 (3면 정합 — 짧은 시간창) → EH-API-06 (유일한 쓰기 ±N — 정합 재대조 포함) → EH-API-07 (회귀+diff — BASE_REV 확정 후) → EH-API-08 (9004)
2. EH-UNIT-01→02→03 → EH-UNIT-04 (운영 스모크+콘솔 마감+eslint)
3. EH-E2E-01 (쓰기 0건 — EH-API-06 이후 실행 시 티어 Link 검증 가능)
4. 종료: 잔액 원상 재확인(EH-API-06 실행 시) + REPORT: 집계 잔존·signup_bonus 제외 일관성 재기재·코드 리뷰 갈음 항목 — 개인값 미기재(닉네임#code 허용)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| EH-API-01 | api | | top ≤10 DESC·whale 4필드·spenders·빈 기간 안전 |
| EH-API-02 | api | | buckets 5행 고정·total 2종·days 무시(스냅샷) |
| EH-API-03 | api | | days 400 + 401/403 |
| EH-API-04 | api | | Σcount==total_users==문서 수 + summary 교차(재실행 1회 규칙) |
| EH-API-05 | api | | all_total 3면 정확 일치(90·30) + top 부분합 |
| EH-API-06 | api | | delta ±N — 순증 상쇄·티어 등장·잔액 분포 원상 |
| EH-API-07 | api | | 기존 9 대표 불변 + diff 매트릭스·package.json 0 + 개인정보 회귀 |
| EH-API-08 | api | | 9004 diff 0 + 200/403 대표 |
| EH-UNIT-01 | unit | | 순증·소진율 == daily 재계산·추가 콜 0·"-" 방어 |
| EH-UNIT-02 | unit | | 6블록 순서·기간 4콜(잔액 제외)·배지·각주 |
| EH-UNIT-03 | unit | | 티어 Link·fallback·whale 카드·빈 상태 |
| EH-UNIT-04 | unit | | 운영 탭 스모크 + 콘솔 0건 + eslint 0 |
| EH-E2E-01 | e2e | | 풀 여정 — 쓰기 0건, 테스트 계정 행만 클릭 |

## v182 시나리오 집계

- 총 **13건** — [api] 8 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 5건은 §4)
- 쓰기: EH-API-06 delta **1쌍만**(테스트 계정 ±N·잔액 원상·집계 잔존 승인 방침 연장). 그 외 전부 읽기 전용, E2E 쓰기 0건, CS 발송류 0건. 개인정보: 티어의 닉네임/code/user_id 는 허용 사양으로 판정 제외를 명문화하고, 이메일·생년월일·성별 부재를 응답·서버 로그·콘솔 3면에서 검증(EH-API-07 ④·EH-UNIT-04 — 위반 시 즉시 중단).

## 개정 이력 (v182)

- 2026-08-18 초판 작성 (13건) — PLAN v182 §4 항목 1~7 전부 시나리오화(§4-1→EH-API-01·03, §4-2→EH-API-02·04, §4-3→EH-API-05, §4-4→EH-UNIT-01, §4-5→EH-API-06, §4-6→EH-UNIT-02·03·04, §4-7→EH-API-07·08). v181 확정 규칙 승계(재실행 1회 후 FAIL·spent 양수 $abs). 티어 개인정보 허용 경계(닉네임#code·user_id 허용 / 이메일·생년월일·성별 금지)를 판정 기준으로 명문화. BASE_REV·DB count 승인·빈 소비 기간 갈음·E2E Link 대상·소진율 포맷 5건 planner 회신 대기(§4).
- 2026-08-18 planner 판정 반영 — §4 판정 블록 5건 확정(BASE_REV `54c22c3` / countDocuments 승인 / whale null 코드 리뷰 갈음 — 조기 반환 실측 / E2E Link 테스트 행 한정 / share_pct·소진율 소수 1자리 통일) + **라벨 마이크로픽스 v182 포함 확정**(원장 전수 실측: listen→play 키 정정, upload·referral 2종·verify_bonus 등록, generate 미등록 유지 — EH-UNIT-02 겸측 재검증). §4-1·EH-API-04·EH-UNIT-01 문안 3곳 고정. 보류 0건 — tester 착수 가능(전제: 9005·9004 v182+마이크로픽스 반영 재기동).

# v183 — 분석 대시보드 세그먼트 2종 (플랜·역할 / 가입 코호트) (2026-08-18 14:39)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전)
근거: PLAN.md v183 §0 실측(plan free 157/100%·role 3분포·가입월 5개·admin 포함 판단·`_sum_points_by_user` 헬퍼 신설), §1 설계 결정, §4 테스트 항목 1~6, §5 강행 금지 6항·리스크
대상: backend_9005 `admin_points.py` 신규 2 엔드포인트(`GET /analytics/segments`·`GET /analytics/cohorts`)+헬퍼 1(기존 demographics 함수 무변경 — 9004 미러) / frontend_admin AdminPointsDashboard ⑥⑦블록 추가(8블록 체제)+api.js 2래퍼. **기존 엔드포인트·AdminPointsPage·pointsLabels·points_service·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **읽기 전용 위주** — 유일한 쓰기 = SG-API-05 delta **1쌍**(테스트 계정 grant N→동량 deduct, 잔액 순변화 0, 집계 잔존 승인 방침 연장 — REPORT 기재). E2E 쓰기 0건. CS 발송류 0건.
- **DB 읽기**: ① users 전체 COUNT 1회(코호트 인원 검산 — v182 §4-2 승인 방식 준용, **승인 예정 표기**, 실측 기준 157) ② 테스트 계정 created_at 가입월 확인 1회(SG-API-05 버킷 판정용 — REPORT 에 **가입월 YYYY-MM 만** 기재).
- **개인정보 3면 원칙(강행 금지 ③)**: 신규 2 응답·서버 로그·콘솔에 **개별 plan/role/가입일(YYYY-MM-DD)·이메일·user_id 나열 부재** — 버킷 집계만(cohorts 의 month 는 버킷값). 위반 시 즉시 중단·보고.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`/`USER_TOKEN`/`TEST_USER_1_ID`. `BASE_REV` = **v182 종료 커밋(planner 검토 시 확정 예정 — 확정 전 diff 판정 보류)**.
- 정합 판정 규칙 승계(v181~182 확정): 짧은 시간창 연속 호출·**불일치→1회 재실행→FAIL**, spent 계열 전부 양수($abs). signup_bonus(day `-`) 는 day 범위 매치 특성상 daily·cohorts 활동 집계에서 일관 제외(REPORT 재기재).
- 환경: 9005·9004, Mongo·PG, frontend_admin Vite dev(4001). 추적자 `[admin-points]`·`[AdminPointsDash]`.

## 1. [api] 시나리오 — 신규 2 엔드포인트 (기본 대상 9005)

### SG-API-01. segments 200 스키마 — plan 3행·role 4행 고정 + 내부 정합 [api] — 핵심
- Given: `ADMIN_TOKEN`
- When: `GET /api/admin/points/analytics/segments?days=90&mode=earn`(+spend·30일 스팟) 호출하면
- Then: HTTP 200 —
  - `plan_rows` **3행 고정 순서**(free/premium/미상), `role_rows` **4행 고정**(user/customer/admin/미상) — 빈 버킷도 `{bucket, users:0, total:0}` 행 실재
  - 각 행 users(distinct 활동 유저 수) ≥0 정수·total ≥0(양수 규약)
  - **내부 정합**: `Σ plan_rows[].total == Σ role_rows[].total == total`(같은 Σ 의 두 축 매핑 — 합계 보존, users 도 축별 Σ 일치)
  - 현 데이터 특성 확인: **plan 은 free 단일 집중(premium 0)** — 오류 아닌 정상(§5, REPORT 기재)

### SG-API-02. cohorts 200 — 가입월 전체 행 + 인원 검산 [api] — 핵심
- Given: `ADMIN_TOKEN`. **users 전체 COUNT 1회**(PG 읽기 전용 — §0 승인 예정)
- When: `GET /api/admin/points/analytics/cohorts?days=90`(+30 스팟) 호출하면
- Then: HTTP 200 —
  - `rows` — `month` "YYYY-MM" **오름차순**(실측 5개 월: 2026-03/04/05/07/08 수준), 각 행 `{month, users, earned, spent}`, **활동 0 월도 행 실재**(earned/spent 0 — 전체 가입월 축), `미상` 행은 유저 미실재 활동 존재 시에만 월 정렬 뒤 조건 표시
  - **인원 검산**: `Σ rows[].users == total_users == users 테이블 COUNT`(실측 기준 157 — 탈퇴 익명화 포함이 정상, 3자 정확 일치)
  - **직교 사양**: days 변경(90→30) 시 earned/spent 만 변하고 **rows 의 월 구성·users 는 불변**(인원은 기간과 직교)

### SG-API-03. days·mode 화이트리스트 400 + 401·403 [api]
- Given: `ADMIN_TOKEN` / 토큰 없음 / `USER_TOKEN`
- When: ① segments days=8/0/91/문자 + mode=all/빈/대문자 EARN ② cohorts days=8/문자 (mode 파라미터 무시 확인 1회) ③ 신규 2개 무토큰 ④ 대표 1개 `USER_TOKEN` 하면
- Then: ①② 전부 **400**(화이트리스트 {7,30,90}·earn|spend — 422 관측 시 비고 후 통일 관행) ③ 전부 401 ④ 403. 오류 응답 내부 정보 미노출.

### SG-API-04. 4면 정합 교차 — segments·티어·분포·추이 + 코호트 [api] — 핵심
- Given: `ADMIN_TOKEN`. 동일 days(90)로 관련 콜을 짧은 시간창 내 연속 실행
- When: 합계를 대조하면
- Then: **전부 정확 일치(불일치→1회 재실행→FAIL)**:
  - **spend 4면**: `segments(spend).total` == `top-spenders.whale.all_total` == `Σ breakdown.spend[].total` == `Σ daily[].spent` (v182 3면에서 확장)
  - **earn 동일**: `segments(earn).total` == `Σ breakdown.earn[].total` == `Σ daily[].earned` == `demographics(earn).total`
  - **코호트 교차**: `Σ cohorts.rows[].earned == Σ daily[].earned`, `Σ cohorts.rows[].spent == Σ daily[].spent` (동일 days — 활동만 기간 필터인 직교 정의 검증)
  - days=30 으로 spend 4면 1회 반복(기간 매개 정합)

### SG-API-05. delta 1쌍 (선택) — plan·role·가입월 버킷 정밀 반영 + 원복 [api] — (유일한 쓰기: ±N, 테스트 계정)
- Given: `ADMIN_TOKEN`, `TEST_USER_1_ID`(plan=free·role=user 전제 — 사전 확인, 가입월 `M0` 확보 §0). segments(earn·spend)·cohorts 기준값 기록
- When: grant N → 재조회 → deduct N(원복) → 재조회하면
- Then:
  - grant 후(earn): plan_rows **free 행만** total +N(premium·미상 불변), role_rows **user 행만** +N(customer/admin/미상 불변), cohorts **M0 행만** earned +N(타 월 불변) — users 는 기등장 시 불변·신규 등장 시 +1 기록
  - deduct 후(spend): 동일 버킷들 spend 측 +N — 잔액 원상(v180 불변식) + SG-API-04 정합식 재성립(재대조 1회)
  - 집계 ±N 영구 잔존 REPORT 기재(승인 방침 연장)

### SG-API-06. 회귀 — 기존 엔드포인트·demographics 무변경·diff·개인정보 3면 [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(v182 커밋 — 확정 후)
- When: ① 기존 admin_points 엔드포인트 대표 재실행 — v180 summary/events(filter=admin)/adjust 400 대표 + v181 daily/breakdown/demographics + v182 top-spenders/balance-distribution 스키마 대표 각 1건(PLAN 표기 "11 엔드포인트"와 실측 카운트 대조 — planner 확인 §4-3) ② 사용자용 `GET /api/points/costs·balance·history`(USER_TOKEN) ③ `git diff {BASE_REV}..HEAD --name-only` + admin_points.py 내 **demographics 함수 본문 diff 무변경**(헬퍼 신설만 — 코드 리뷰) ④ 신규 2 응답 전문·서버 로그 검사하면
- Then: ① 전부 기존 TESTPLAN 판정 기준 PASS ② 스키마 불변 ③ 변경 파일 == PLAN §2 매트릭스 정확 일치(pointsLabels·points_service·routes/points.py·main.py·**package.json/lock 부재**), demographics 함수 무변경 ④ **개인정보 3면**: 응답에 개별 plan/role/가입일·이메일·uuid 나열 0건(버킷 집계만 — plan_rows/role_rows/month 는 버킷값), 서버 로그 admin_tag/days/mode/행 수만, 위반 시 즉시 중단.

### SG-API-07. 9004 미러 — diff 0 + 대표 케이스 [api] — 미러 규칙
- Given: 9004 기동
- When: ① admin_points.py 9005↔9004 diff ② **9004** segments `ADMIN_TOKEN` 200 + cohorts `USER_TOKEN` 403 각 1회 하면
- Then: ① diff **0** ② 9005 와 동일 판정.

## 2. [unit] 시나리오 — 대시보드 ⑥⑦블록 (브라우저 하니스, 4001 dev)

### SG-UNIT-01. 8블록 순서·세그먼트 렌더·한글 라벨 [unit] — 핵심
- Given: 분석 탭(30일)
- When: 블록 순서와 세그먼트 블록을 확인하면
- Then: 순서 **추이→순증→분포→인구→[⑥플랜·역할 세그먼트]→[⑦가입 코호트]→티어→잔액** 정확(8블록). 세그먼트 = **가로 스택 바 2줄**(인구 블록 패턴) — 라벨 무료/프리미엄/일반/고객/**관리자**(admin 포함·분리 가시화 — 제외 아님)/미상, 각 행 ⭐합계·유저 수 병기, 값 == API 응답. **plan 단일 버킷 현상 정상 표기**(free 100%·프리미엄 0 — 빈 스택도 안전 렌더, 오류 표시 아님). 미등록 버킷값 원문 fallback(코드 확인 갈음 가능).

### SG-UNIT-02. 독립 토글·기간 전환 6콜·직교 각주 [unit] — 핵심
- Given: 분석 탭(30일)
- When: ① 세그먼트 블록 획득/소비 토글 ② 인구 블록 토글 ③ 기간 7일 전환 ④ 코호트 블록 확인하면
- Then: ① **segments 1콜만 재조회**(demographics·타 블록 콜 없음 — 독립 상태) ② demographics 1콜만(세그먼트 불변 — 상호 독립 검증) ③ 재조회 == **6콜**(daily/breakdown/demographics/top-spenders/segments/cohorts — **balance-distribution 제외 유지**) ④ 직교 각주 **"인원은 가입월 전체, 별 활동은 선택 기간 내"** 실재 + 기간 전환 후 코호트 **인원 열 불변·활동 열 갱신**(SG-API-02 직교 사양의 화면 검증).

### SG-UNIT-03. 코호트 표 렌더·빈/에러 상태 [unit]
- Given: 분석 탭, cohorts 응답 보유
- When: 코호트 표와 에러 경로를 확인하면
- Then: 표 = 월/인원/획득⭐/소비⭐ 열, 월 ASC·활동 0 월 행 표시(0 값 정상 렌더·NaN 없음), `미상` 행은 조건 표시(부재 시 미노출 — 코드 확인 갈음 가능), 값 == API. 백엔드 일시 중단 1회 → 블록 에러 상태 문구·화면 유지(복구 후 재시도 정상), stale 응답이 최신 기간 화면을 덮지 않음.

### SG-UNIT-04. 운영 탭 회귀 스모크 + 콘솔 위생 + eslint [unit] — 마감
- Given: SG-UNIT-01~03 수행 세션, `/points` 운영 탭
- When: ① 운영 탭 — 검색 첫 클릭 선택·조정 confirm **취소**(adjust POST 0건)·원장·비용표 스모크 ② 콘솔에서 개별 plan/role 값 나열·가입일 패턴(`\d{4}-\d{2}-\d{2}`)·이메일·응답 덤프 검색 ③ eslint 실행하면
- Then: ① v180~182 판정 기준 그대로(무변경 — diff 는 SG-API-06 ③ 겸측) ② `[AdminPointsDash]` 포함 **0건**(로그는 기간/모드/건수 수준만) ③ eslint 신규 0.

## 3. [e2e] 시나리오 — 1건 (행동 수준, 쓰기 0건)

### SG-E2E-01. 8블록 풀 여정 — 기간 전환→세그먼트 토글→코호트→운영 복귀 [e2e] — 핵심 (쓰기 0건)
- Given: 관리자 앱(4001) 테스트 관리자 로그인
- When: "별 관리" → 분석 탭 → 스크롤로 **8블록 순서·신규 2블록 렌더** 확인 → 기간 **7일 전환**(6콜 재조회·잔액 유지·코호트 인원 열 불변) → 세그먼트 **토글 전환**(1콜·스택 바 갱신) → 코호트 표·직교 각주 확인 → **운영 탭 복귀** → v180 기능 정상(검색·선택·잔액 표시 — 조정 confirm **취소**)하면
- Then: 전 단계 정상 전이, 콘솔 신규 에러 0건, **네트워크에 adjust/send/broadcast POST 0건**(전 여정 읽기 전용 — delta 는 [api] 단계 전용). 관리자 행이 role 스택 바에 분리 가시(별도 제외 없음 확인).
- 증적: 8블록 전경·7일 전환 후 세그먼트/코호트·토글 후·운영 탭 복귀 스크린샷.

## 4. planner 확인 필요 사항

1. **BASE_REV 확정**: v182 종료 커밋 = **`e0f2c64` 확정**(§4 판정 블록 1 — 보류 해제, `git diff e0f2c64 --name-only` 워킹트리 기준).
2. **PG COUNT 읽기 1회 승인 완료**(§4 판정 블록 2): users 전체 수(실측 기준 157 — SG-API-02 검산 축), v182 §4-2 방식 준용.
3. **"기존 11 엔드포인트" 카운트 편차**: admin_points 실측 누계 9(v180 4+v181 3+v182 2) vs PLAN §4-6 표기 11 — 회귀 대상 목록(사용자용 points 3 포함 여부 등) 확정 요청. 초안은 admin 9+사용자용 3 전부 대표 커버로 설계(포함이 안전측).
4. **테스트 계정 created_at 조회 1회**: SG-API-05 가입월 버킷 판정용 — REPORT 에 **가입월(YYYY-MM)만** 기재(가입일 원문 금지) 방침 승인.
5. **4면 정합의 demographics 포함 전제**: segments 미상(비 uuid skip)과 demographics 버킷의 합계 보존 규약이 동일하다는 전제로 earn 면에 demographics 포함 — 구현상 모수 차이(skip 규칙 상이)가 있으면 비교식에서 demographics 를 분리(3면+별도 대조)할지 회신.

### planner 판정 (2026-08-18, 5건 전부 확정 — 해당 문안 반영 완료)

1. **BASE_REV = `e0f2c64`** (v182 커밋 — planner git log 실측: 현재 HEAD, v183 변경분 워킹트리 미커밋). SG-API-06 은 `git diff e0f2c64 --name-only` 워킹트리 기준 — 보류 해제.
2. **users COUNT 읽기 1회 승인** — v182 §4-2 방식 준용(읽기 전용 검산 축, 실측 157).
3. **카운트 편차 — PLAN 표기 오류 정정(planner 오산정).** 실측 확정: admin_points 누계 **9**(v180 4 + v181 3 + v182 2), 사용자용 points **3** — 회귀 대상 = **12 엔드포인트**(초안 안전측 설계 채택). PLAN v183 §4-6·§5-① 의 "기존 11" 은 "기존 9(admin_points)+사용자용 3" 으로 읽는다(본 판정 블록이 정정 기록 — PLAN 재수정 없이 이 문서 우선).
4. **테스트 계정 created_at 조회 1회 승인** — REPORT 에 **가입월(YYYY-MM)만** 기재(가입일 원문 금지).
5. **demographics 포함 확정 — 모수 규약 동일성 코드 실측 완료.** 양쪽 모두 `per_user`(기간 내 활동 전원)를 **누락 없이 합산**: demographics 는 attrs 미해석 `(None,None)`→미상/unknown 열 합류(v181 코드), segments 는 `_fetch_user_attrs` 미해석(비 uuid 포함)→미상 버킷 합류(v183 코드 — skip 은 PG 조회 대상에서만, 합산에서는 미탈락). ∴ `segments.total == demographics.total == Σdaily.earned == Σbreakdown.earn` **4면 정합 비교식 유지**(분리 불요).

## 5. 실행 순서 권고 (tester 참고)

1. SG-API-01→02(§4-2 확정 후 COUNT 포함)→03 (읽기 전용) → SG-API-04 (4면 정합 — 짧은 시간창) → SG-API-05 (유일한 쓰기 ±N — §4-4 확정 후, 정합 재대조 포함) → SG-API-06 (회귀+diff — BASE_REV 확정 후) → SG-API-07 (9004)
2. SG-UNIT-01→02→03 → SG-UNIT-04 (운영 스모크+콘솔 마감+eslint)
3. SG-E2E-01 (쓰기 0건)
4. 종료: 잔액 원상 재확인(SG-API-05 실행 시) + REPORT: plan 단일 버킷 현상·signup_bonus 제외 일관성·집계 잔존·코드 확인 갈음 항목 기재(개인값 미기재 — 가입월·버킷명만)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| SG-API-01 | api | | plan 3행·role 4행 고정 + Σplan==Σrole==total |
| SG-API-02 | api | | 월 ASC·활동 0 월 행·Σusers==COUNT(157 기준)·직교 |
| SG-API-03 | api | | days·mode 400 + 401/403 |
| SG-API-04 | api | | spend 4면·earn 4면·코호트 교차 — 재실행 1회 규칙 |
| SG-API-05 | api | | delta ±N — free/user/가입월 버킷만 반영·타 버킷 불변 |
| SG-API-06 | api | | 기존 대표 불변 + demographics 무변경 + diff·package.json + 개인정보 3면 |
| SG-API-07 | api | | 9004 diff 0 + 200/403 대표 |
| SG-UNIT-01 | unit | | 8블록 순서·스택 바 2줄·관리자 행·plan 단일 버킷 정상 |
| SG-UNIT-02 | unit | | 독립 토글 1콜·기간 6콜(잔액 제외)·직교 각주·인원 열 불변 |
| SG-UNIT-03 | unit | | 코호트 표·0 값·미상 조건·에러/stale |
| SG-UNIT-04 | unit | | 운영 스모크 + 콘솔 0건 + eslint 0 |
| SG-E2E-01 | e2e | | 8블록 풀 여정 — 쓰기 0건 |

## v183 시나리오 집계

- 총 **12건** — [api] 7 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 5건은 §4)
- 쓰기: SG-API-05 delta **1쌍만**(테스트 계정 ±N·잔액 원상·집계 잔존 REPORT 기재). DB 읽기 = users COUNT 1회+테스트 계정 created_at 1회(각 승인 예정 표기). E2E 쓰기 0건·CS 발송류 0건. 개인정보 3면(응답·서버 로그·콘솔)에서 개별 plan/role/가입일·이메일 부재 검증 — 위반 시 즉시 중단.

## 개정 이력 (v183)

- 2026-08-18 초판 작성 (12건) — PLAN v183 §4 항목 1~6 전부 시나리오화(§4-1→SG-API-01·03, §4-2→SG-API-02, §4-3→SG-API-04, §4-4→SG-API-05, §4-5→SG-UNIT-01~04, §4-6→SG-API-06·07). v181~182 확정 규칙 승계(재실행 1회·양수 규약·집계 잔존). PLAN "11 엔드포인트" 표기와 실측 9 의 편차를 §4-3 으로 질의(초안은 전부 커버 안전측). BASE_REV·PG COUNT 승인·카운트 편차·created_at 조회·demographics 포함 전제 5건 planner 회신 대기(§4).
- 2026-08-18 planner 판정 반영 — §4 판정 블록 5건 확정(BASE_REV `e0f2c64` / users COUNT 승인 / 카운트 편차 정정 — 회귀 대상 12(admin 9+사용자 3), PLAN "기존 11" 은 오산정으로 본 블록이 정정 기록 / created_at 조회 승인 — REPORT 가입월만 / demographics 포함 확정 — 양측 per_user 전량 합산·미해석 미상 합류 코드 실측으로 4면 비교식 유지). §4-1·2 문안 고정. 보류 0건 — tester 착수 가능(전제: 9005·9004 v183 반영 재기동).

# v184 — 관리자 광고주 관리 페이지 (/advertisers 목록·상세 + 강제 숨김) (2026-08-18 17:02)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v184 §0 실측(dashboard 인라인·/ads/active 필터 지점·require_business 게이트·광고주 11/아이템 449·PG company_name 오염 기지), §1 설계, §4 테스트 항목 1~8, §5 강행 금지 7항, **§6 판정 반영(⑧ per-item stars/insights 포함 — 총 6 엔드포인트·추출 3건)**
대상: backend_9005 `admin_ads.py` 신설 6 엔드포인트 + business.py 순수 추출 3건(`build_dashboard_data`/`build_item_stars_data`/`build_item_insights_data`)+/ads/active `admin_hidden` 필터 + main.py 등록·인덱스 2종(9004 미러 3파일) / frontend_admin 페이지 2종 신설+라우트·NavLink 8번째·api.js 6래퍼·AdminLogsPage 짝 항목 3. **admin.py·admin_points.py·points 계열·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **강제 숨김 실측은 테스트 유래 아이템만**: bcast 테스트 계정을 customer 로 역할 변경(v177 승인 패턴) → 해당 계정으로 테스트 아이템 생성 → 숨김/해제 실측 → **아이템 삭제 + 역할 원복 필수**(종료 검증: role==user·테스트 아이템 잔존 0건). **실광고주(무신사·크림 등 시드 포함) 아이템의 숨김·수정·삭제 절대 금지** — PATCH 대상 item_id 를 매 호출 전 테스트 아이템 id 와 대조. 감사 행(ads_admin_hide/unhide·change_role) 잔존은 정상 — REPORT 기재.
- **실광고주 대상 허용 범위 = 읽기 전용 GET 만**(목록·상세·dashboard/stars/insights 프록시 — 집계 조회는 비파괴). 쓰기는 위 테스트 아이템 사이클과 역할 변경뿐.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN` / `USER_TOKEN` / `TEST_USER_1_ID`(customer 전환 대상) / `TEST_ITEM_ID`(생성 후 기록) / `SEED_ADV_ID`(시드 광고주 user_id — 읽기 전용) / `BIZ_TOKEN`(광고주 본인 토큰 — 확보 방법은 planner 확인 §4-1). 실값 기재 금지.
- **개인정보 판정 경계(§4 지시 7)**: 상세 ④ 의 email·연락처·회사명은 **관리자 화면 표시 사양(허용)** — 검증 대상은 ① 위시/클릭 **개별 사용자 목록 부재**(집계만) ② 서버 로그·콘솔에 회사명·이메일·연락처 0건. k-익명·14세 미만 제외는 기존 로직 무변경 재사용이므로 **추출 동일성 검증(AD-API-04)으로 갈음**.
- **용어 강행 금지(⑤)**: 신규 화면에 "노출" 금지 — "착장 선택"·"클릭율"(CTR=클릭/착장 선택).
- DB 읽기(검산용, 승인 관행 준용): PG `users WHERE role='customer'` COUNT 1회(실측 기준 11) + Mongo `ad_items` $group 1회 + `list_indexes` 2회.
- `BASE_REV` = **`9ee2703` 확정**(§4 판정 3). BIZ 토큰 2종 구분: `SEED_BIZ_TOKEN`(시드 광고주 — **읽기 전용 GET 만**)/`TEST_BIZ_TOKEN`(customer 전환 테스트 계정 — 쓰기 사이클 전용)(§4 판정 1). 환경: 9005·9004, Mongo·PG, frontend_admin Vite dev(4001). 추적자 `[admin-ads]`·`[AdminAds]`·`[AdminLogs]`.

## 1. [api] 시나리오 (기본 대상 9005)

### AD-API-01. 목록 200 스키마 + 검산 [api] — 핵심
- Given: `ADMIN_TOKEN`. PG customer COUNT·Mongo ad_items $group(광고주별 count) 실측값 확보(§0)
- When: `GET /api/admin/ads/advertisers?days=30` 호출하면
- Then: HTTP 200 —
  - summary 카드 4(광고주 수·등록 아이템·활성=is_active∧¬admin_hidden·기간 클릭) + 행별 `{user_id, nickname, company_name, item_count, active_count, impressions, clicks, ctr, wish, status}` 필드 실재
  - **검산 ①**: 행 수·광고주 수 == PG customer COUNT(**실측 기준 11**) — 정확 일치
  - **검산 ②**: `Σ item_count` == ad_items 전체 수(**실측 기준 449**) + 행별 item_count == $group 실측값 표본 2행 대조(시드 광고주)
  - ctr == clicks/impressions 재계산 일치(0 나눗셈 방어 — impressions 0 행 "0" 또는 "—" 정상)

### AD-API-02. 목록 q 검색·days 400·401/403 [api]
- Given: `ADMIN_TOKEN` / 토큰 없음 / `USER_TOKEN`
- When: ① `?q={시드 회사명 부분 문자열}` ② `?q={시드 닉네임 부분}` ③ `?q=zzzz_none` ④ days=8/0/91/문자 ⑤ 6 엔드포인트 무토큰 ⑥ 목록·PATCH hidden `USER_TOKEN` 하면
- Then: ①② 해당 광고주만 필터(회사명·닉네임 부분일치) ③ 빈 목록(요약 카드 정상) ④ 전부 400(화이트리스트 {7,30,90} — 422 관측 시 비고 후 통일 관행) ⑤ 전부 401 ⑥ 403 — **PATCH 403 은 발동 0**(비관리자가 숨김 불가·잔존 상태 불변).

### AD-API-03. 상세 — Mongo 정본 회사 정보·⑥ days·⑦ items [api] — 핵심
- Given: `ADMIN_TOKEN`, `SEED_ADV_ID`(PG company_name 오염값 실측 기지 계정 — "엔터테인먼트" 등). Mongo business_profiles 해당 문서 실측값 확보(읽기 1회)
- When: ① `GET /advertisers/{SEED_ADV_ID}?days=30` ② 동일 요청 days=7 ③ `GET /advertisers/{GHOST_UUID}` ④ 비 uuid 하면
- Then:
  - ① ④블록 회사 정보 == **Mongo business_profiles 정본**(PG 오염값 "엔터테인먼트" 계열이 **아님** — 필드별 대조) + 계정 필드(email/nickname/created_at/상태), ⑥ 성과 요약 4, ⑦ items[] 각 행에 **admin_hidden 포함·worn 부재**(`_worn_counts_by_item` 미호출 — 강행 금지 ① 응답 증거)·clicks/wish/is_active/category/brand/product_name/image_object_name/created_at
  - ② ⑥ 값이 days 에 따라 변화(기간 필터 동작 — ⑦ 누적값은 불변)
  - ③ 404 ④ 400
  - 응답 전문에 위시/클릭 **개별 사용자 목록 부재**(집계만 — §0 경계)

### AD-API-04. 추출 회귀 3종 세트 — 관리자 == 광고주 본인 동일값 + 타 광고주 404 [api] — v184 핵심
- Given: `ADMIN_TOKEN` + `BIZ_TOKEN`(동일 광고주 본인 — 확보 방법 §4-1 확정 후), 대상 광고주 user_id·아이템 item_id, 동일 조합 {period, category, verified_only} 2세트(기본+verified_only=true)
- When: 짧은 시간창 내 쌍호출 — ① admin `GET /advertisers/{uid}/dashboard?period=&category=&verified_only=` ↔ 본인 `GET /api/business/dashboard`(동일 파라미터) ② admin `GET /advertisers/{uid}/items/{item_id}/stars?period=&verified_only=` ↔ 본인 `GET /api/business/ads/{item_id}/stars` ③ admin `.../items/{item_id}/insights` ↔ 본인 `GET /api/business/ads/{item_id}/insights` ④ admin `GET /advertisers/{TEST_USER_1_ID}/items/{실광고주 item_id}/stars`(소유자 불일치 — 읽기 전용) 하면
- Then:
  - ①②③ **응답 동일 구조·동일 값**(JSON 정규화 비교 — 순수 추출 증빙, 시계열·아이템별 성과·스타별·인사이트 전부. 불일치→1회 재실행(시차 이벤트)→재불일치 FAIL) — k-익명 5·14세 미만 제외·스타 닉네임 사양은 동일성으로 자동 갈음(§0)
  - ④ **404**(추출된 소유 검증이 admin 경유에도 그대로 — 기존과 동일 오류 경로)
  - verified_only·category 파라미터가 양측에 동일 전달·동일 반영(값 변화 대칭)

### AD-API-05. 강제 숨김 4단 + 감사 2행 [api] — 핵심 (쓰기 — 테스트 유래 아이템 사이클)
- Given: `ADMIN_TOKEN`. 사전: `TEST_USER_1_ID` role user→customer(v177 패턴·원복 예정) → 해당 계정 `BIZ_TOKEN` 으로 테스트 아이템 1건 생성(`TEST_ITEM_ID` 기록, 상품명 "v184-test-item") → `GET /api/business/ads/active` 에 노출 확인. PATCH 대상 == TEST_ITEM_ID 대조(§0)
- When: ⓐ `PATCH /api/admin/ads/items/{TEST_ITEM_ID}/hidden` `{hidden:true, reason:"v184 테스트 숨김(원복 예정)"}` → ⓑ 본인 `GET /api/business/ads` 확인 → ⓒ 본인 toggle(is_active) 왕복 → ⓓ 동일 `{hidden:true}` 재요청 → 이후 `{hidden:false}` 해제하면
- Then:
  - ⓐ 200 → `GET /api/business/ads/active` 에 TEST_ITEM_ID **미노출**(타 448 아이템 count 불변)
  - ⓑ 본인 GET /ads 에는 **노출 + admin_hidden true 표시** — 응답에 **reason 부재**(광고주 비노출 사양)
  - ⓒ 본인 toggle 이후에도 **admin_hidden true 불변**(독립 필드 핵심 — is_active 만 변화, toggle 원복 후에도 active 목록 미노출 유지)
  - ⓓ 동일 상태 재요청 **200 멱등**(오류·중복 감사 행 없음 — 감사 행 수 기록)
  - 해제 후 active 재노출. 감사: `?action=ads_admin_hide`·`ads_admin_unhide` 각 1행 — target_type=ad_item·target_id=TEST_ITEM_ID·details `{advertiser_id, item_name, reason}`(비밀값 없음)
- Cleanup: **테스트 아이템 삭제 + role 원복**(§0 — 종료 검증 포함, 삭제 방법은 §4-2 확정).

### AD-API-06. 숨김 검증 경로 — 400/404 [api]
- Given: `ADMIN_TOKEN`
- When: ① item_id="not-an-objectid" ② 형식 유효 미존재 ObjectId 각 PATCH 하면
- Then: ① 400 ② 404 — 전 케이스 상태 변화·감사 행 0(실광고주 아이템 무접촉 확인 겸용).

### AD-API-07. business 5 API 회귀 + 인덱스 2종 [api] — 회귀 핵심
- Given: `BIZ_TOKEN`(§4-1), 리팩터 전 기준값(v183 시점 응답 또는 시드 실측), 9005 재기동 완료 상태
- When: ① `GET /api/business/dashboard` ② `GET /ads/{id}/stars` ③ `GET /ads/{id}/insights` ④ `GET /ads/active`(무인증 공개면 무토큰) ⑤ `GET /ads` + toggle 왕복 1회 ⑥ Mongo `list_indexes`(ad_impressions·ad_clicks) 하면
- Then: ①~⑤ **기존 동작 불변** — 응답 필드·상태코드 동일, ④ 는 admin_hidden 미설정 기존 문서(449) **전량 통과**(`$ne true` 무마이그레이션 — count 기존과 동일), ⑤ toggle 은 is_active 만 변경. ⑥ 두 컬렉션에 **`[("item_id",1),("timestamp",-1)]` 인덱스 실재**(재기동 후 idempotent 생성 확인). 보조(코드 리뷰): business.py diff 가 **이동 헌크+위임 호출로만** 구성(응답·로그 문구 불변 — JSONResponse 오류 경로 포함 이동), `/ads/active` 필터 1줄 외 변경 없음.

### AD-API-08. 기존 회귀 + git diff + 개인정보·서버 로그 [api] — 회귀 마감
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(확정 후)
- When: ① 기존 admin 대표 재실행(points summary·logs·cs search 등 대표 3~4건) + 사용자용 points 대표 ② `git diff {BASE_REV}..HEAD --name-only` ③ 신규 6 엔드포인트 응답 전문·서버 로그 grep(이메일·연락처·회사명·개별 이벤트 user_id 나열) 하면
- Then: ① 전부 기존 TESTPLAN 판정 기준 PASS ② 변경 파일 == PLAN §2+§6 증분 매트릭스 정확 일치(admin.py·admin_points.py·points 계열·**package.json/lock 부재**) ③ 응답은 §0 허용 경계 내(상세 ④ 표시 항목 외 개별값 0건), **서버 로그는 [admin-ads] 건수/파라미터 수준만 — 회사명·이메일·연락처·개별 user_id 0건**. 위반 시 즉시 중단·보고.

## 2. [unit] 시나리오 (브라우저 하니스, 4001 dev + 정적 검사)

### AD-UNIT-01. 목록 페이지 — 8번째 NavLink·요약·검색·행 이동 [unit] — 핵심
- Given: 관리자 로그인
- When: 사이드바 8번째 **"광고주 관리"**(FiShoppingBag) 클릭 → 목록 확인 → 검색 입력 → 행 클릭하면
- Then: `/advertisers` 진입+active 하이라이트(기존 7메뉴 무손상), 요약 카드 4·테이블 렌더(AD-API-01 값 일치), 검색 필터 동작, 행 클릭 → `/advertisers/:id` 이동. 콘솔 신규 에러 0건.

### AD-UNIT-02. 상세 5블록 — 정본·향후 배지·기간 규약 표기·confirm [unit] — 핵심
- Given: 상세 페이지(`SEED_ADV_ID` — 읽기 전용)
- When: ④~⑧ 블록과 숨김 버튼(confirm **취소**)을 확인하면
- Then: ④ Mongo 정본 회사 정보 렌더 ⑤ 플랜·과금 자리 블록 — **"향후" 배지 + 전값 "—"** + 과금 설명 1줄 ⑥ days 7/30/90 토글(재조회) ⑦ 아이템 테이블(admin_hidden 상태 표시) ⑧ 기간 규약 **각 블록 기준 표기**(⑥ 일수 vs ⑧ daily/weekly/monthly — 혼동 방지 §5). 숨김 confirm 문안에 **아이템명·방향** 명시 — 취소 시 PATCH 0건(실광고주 아이템에서 confirm 수락 금지 — 취소만).

### AD-UNIT-03. 용어 검사 — "노출" 부재 grep [unit] — 핵심 (지시 6)
- Given: frontend_admin 신규 소스(AdminAdvertisersPage·AdminAdvertiserDetailPage jsx/css + 관련 추가분)
- When: ① `grep "노출"` ② `grep "착장 선택"`·`grep "클릭율"` 실행하면
- Then: ① 신규 화면 소스·문자열 리터럴에 **"노출" 0건**(코드 주석 포함 여부는 리터럴 우선 — 주석 검출 시 비고) ② "착장 선택"·"클릭율" 사용 확인(지표 라벨). 화면 렌더 수준 확인은 AD-E2E-01 겸측.

### AD-UNIT-04. 감사 라벨 짝 항목 + 콘솔 위생 + eslint [unit]
- Given: AD-API-05 실행 후(감사 행 잔존), `/logs` 진입 + AD-UNIT-01~03 세션 콘솔
- When: ① ads_admin_hide/unhide 행 표시 ② 콘솔 검색(회사명·이메일·연락처·`@test.invalid`) ③ eslint 하면
- Then: ① **"광고 숨김"(red)·"광고 숨김 해제"(green) 라벨+배지**, target **"광고 아이템"** 라벨(짝 항목 3종 — gray fallback 아님) + 대상 표기 정상 ② `[AdminAds]` 포함 **0건**(건수/status 수준만) ③ eslint 신규 0.

### AD-UNIT-05. 9004 미러 byte-identical + package.json diff 0 [unit] — 미러 규칙 (코디네이터 태그 준수)
- Given: 9004 기동, 저장소
- When: ① `diff` 3파일 — admin_ads.py·business.py·main.py 9005↔9004 ② package.json(+lock) `git diff` ③ **9004** 목록 `USER_TOKEN` 403 대표 1회 하면
- Then: ① 3파일 **byte-identical**(main.py 는 기존 미러 예외 외 diff 없음) ② diff **0**(라이브러리 금지) ③ 9005 와 동일 403. 9004 에 PATCH hidden 호출 없음(쓰기 중복 회피).

## 3. [e2e] 시나리오 — 1건 (사용자 여정·회귀 지점만)

### AD-E2E-01. 풀 여정 — 목록→상세→행 확장 lazy load→테스트 아이템 숨김/해제→감사 확인 [e2e] — 핵심
- Given: 관리자 로그인. ~~AD-API-05 사이클과 연계 실행~~ **(planner E2E 확정 갱신)**: 1차 게이트에서 AD-API-05 Cleanup 이 완료됐으므로 **E2E 전용 테스트 아이템 사이클 1회 재수행**(동일 승인 패턴: TEST_USER_1 role→customer → `TEST_BIZ_TOKEN` 으로 아이템 생성 "v184-test-item-e2e" → 여정 수행 → 숨김/해제 → DELETE API 삭제 → 역할 원복+종료 검증). 숨김 실측 대상은 이 아이템만 — 추가 쓰기는 승인 패턴 반복이라 허용(감사 행 잔존 REPORT 기재).
- When: "광고주 관리" → 목록 렌더 → 테스트 광고주(customer 전환 계정) 행 클릭 → 상세 → ⑦ 아이템 행 **확장(▼)** → stars/insights 패널 lazy load → 같은 행 **재확장** → 테스트 아이템 **숨김 confirm 수락** → 행·요약 갱신 확인 → **해제** → "감사 로그" 이동 → 라벨 확인 → 기존 페이지 1~2곳 순회하면
- Then:
  - 확장 시 **stars·insights 각 1회 호출**(네트워크 캡처 — 페이지 진입 시 일괄 로드 아님), 패널 렌더가 광고주 화면 패턴과 동일(용어 "착장 선택"/"클릭율" 화면 확인 — AD-UNIT-03 겸측). **재확장 동작은 구현 기준 명기**: 재호출/캐시 어느 쪽이든 관측 결과를 비고 기록(중복 폭주만 FAIL)
  - 숨김 수락 → 성공 안내+행 admin_hidden 표시·요약 활성 수 갱신, 해제 → 원상. confirm 문안의 아이템명 == "v184-test-item-e2e"(E2E 전용 사이클 생성분 — Given 갱신) 대조 후 수락(불일치 시 즉시 취소·FAIL)
  - 감사 로그에 hide/unhide 라벨 렌더, 기존 페이지 정상, 콘솔 신규 에러 0건. **실광고주 아이템 행에서는 확장(읽기)만 — 숨김 confirm 수락 금지**
- 증적: 목록·상세 5블록·확장 패널·confirm·숨김 후 행·감사 로그 스크린샷.

## 4. planner 확인 필요 사항

1. **BIZ_TOKEN 확보 방법(AD-API-04·07 전제)**: (a) 시드 광고주 테스트 크리덴셜이 dev 시드에 존재하면 그것으로 로그인(**읽기 전용 GET 만** — 쓰기·toggle 은 테스트 계정 쪽만) (b) 부재 시 customer 전환한 테스트 계정으로 한정 — 단 이벤트 데이터가 빈약해 k-익명·인사이트 경로의 동일성 검증 강도가 낮아짐(구조 동일성 위주로 축소). 어느 쪽인지 판정 요청. AD-API-07 ⑤ toggle 은 (b)의 테스트 계정에서만 수행.
2. **테스트 아이템 생성·삭제 경로**: 생성은 광고주 POST(business 라우트) 사용 전제 — 삭제 엔드포인트 부재 시 Mongo 직접 delete(테스트 유래 문서 1건 한정) 허용 여부 확정.
3. **BASE_REV**: v183 종료 커밋 — planner 확정 예정 표기(확정 전 AD-API-08 ② 보류).
4. **추출 "바이트 불변" 증빙 판정**: diff 이동 헌크 코드 리뷰(AD-API-07 보조) + 응답 동일값 교차(AD-API-04)의 2중으로 설계 — 추가 증빙(로그 문구 비교 등) 요구 여부.
5. **AD-API-04 대상 광고주**: (a) 채택 시 실광고주 데이터 조회가 관리자·본인 양측에서 발생(읽기 전용) — 허용 확인. 비교 표본 아이템 수(기본 1~2개) 지정 여부.
6. **검산 DB 읽기 3회 승인**: PG customer COUNT·ad_items $group·list_indexes(§0 — v182~183 승인 관행 준용) 확인.

### planner 판정 (2026-08-18, 6건 전부 확정 — 해당 문안 반영 완료)

1. **BIZ_TOKEN = (a) 시드 광고주 크리덴셜 채택**(오케스트레이터 의견 동의) — 추출 회귀의 핵심 가치는 **실데이터 동일값 비교**라 (b)면 검증력 급락. 조건: 크리덴셜 실값은 산출물·로그에 플레이스홀더만, **BIZ_TOKEN 으로는 읽기 전용 GET 만**(toggle 등 쓰기는 AD-API-05/07⑤ 의 customer 전환 테스트 계정 쪽 BIZ 토큰으로만 — 두 토큰을 구분 표기: `SEED_BIZ_TOKEN`/`TEST_BIZ_TOKEN`). planner 가 seed_data.py 에서 광고주 시드 크리덴셜을 미발견 — **tester 가 확보 실패 시 (b) 폴백**(구조 동일성 위주 축소 + 비고, FAIL 아님).
2. **테스트 아이템 삭제 = 광고주 `DELETE /api/business/ads/{item_id}` API 사용**(business.py:319 실재 — MinIO 이미지까지 정리). **Mongo 직접 delete 불허**(이미지 잔존 유발). API 삭제가 오류로 실패하는 경우에만 예외적 Mongo delete + MinIO 잔존 오브젝트명 REPORT 보고.
3. **BASE_REV = `9ee2703`** (v183 커밋 — planner git log 실측: 현재 HEAD, v184 워킹트리 미커밋). AD-API-08 ② 는 `git diff 9ee2703 --name-only` 워킹트리 기준 — 보류 해제.
4. **증빙 2중으로 충분** — diff 이동 헌크 코드 리뷰(AD-API-07 보조) + 응답 동일값 교차(AD-API-04). 응답 동일값이 기능 등가를 직접 증명하므로 별도 로그 문구 런타임 비교는 불요. 단 diff 리뷰 시 **"로그 라인이 이동 헌크에 포함(문구 무변경)"을 명시 확인 항목**으로 포함.
5. **실광고주 읽기 전용 조회 허용 확정**(§0 경계와 일치 — 비파괴 GET 양측 비교). 표본 아이템 **2개 지정**: 이벤트 데이터가 풍부한 아이템 1 + 희소한 아이템 1(분포 양극 — k-익명 발동/미발동 경로 양쪽 커버 기대).
6. **DB 읽기 3회 승인** (관행 준용).

## 5. 실행 순서 권고 (tester 참고)

1. AD-API-01→02→03 (읽기 전용 — 검산 DB 읽기 포함) → AD-API-04 (§4-1 확정 후 — 추출 3종 교차+404) → AD-API-06 (비파괴 검증 선행) → AD-API-05 (테스트 아이템 사이클: 역할 변경→생성→4단→감사 확인) → **AD-E2E-01 연계 실행**(정리 전 구간) → Cleanup(아이템 삭제+역할 원복+종료 검증) → AD-API-07 (business 회귀+인덱스) → AD-API-08 (회귀 마감+diff — BASE_REV 확정 후)
2. AD-UNIT-01→02→03 (grep) → AD-UNIT-04 (감사 라벨 — API-05 이후) → AD-UNIT-05 (9004+package.json)
3. 종료: REPORT — 감사 잔존 행·테스트 아이템 생성/삭제 내역·역할 변경/원복·재확장 동작 관측치·BIZ_TOKEN 방식 기재(크리덴셜 실값 금지)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| AD-API-01 | api | | 스키마+검산(customer 11·items 449·표본 대조) |
| AD-API-02 | api | | q 검색·days 400·401/403(PATCH 발동 0) |
| AD-API-03 | api | | Mongo 정본(오염값 아님)·⑥ days·⑦ admin_hidden 포함/worn 부재 |
| AD-API-04 | api | | 추출 3종 동일값 교차 + 소유자 불일치 404 |
| AD-API-05 | api | | 숨김 4단(active 미노출/본인 노출/toggle 독립/멱등)+감사 2행 — 테스트 아이템만 |
| AD-API-06 | api | | PATCH 400/404 — 상태 변화 0 |
| AD-API-07 | api | | business 5 API 불변+/ads/active 449 통과+인덱스 2종 |
| AD-API-08 | api | | 기존 대표·diff 매트릭스·개인정보/서버 로그 0건 |
| AD-UNIT-01 | unit | | 8번째 NavLink·요약·검색·행 이동 |
| AD-UNIT-02 | unit | | 5블록·"향후" 배지·기간 규약 표기·confirm 취소 |
| AD-UNIT-03 | unit | | "노출" 0건 grep + 착장 선택/클릭율 |
| AD-UNIT-04 | unit | | 짝 항목 3종 라벨 + 콘솔 0건 + eslint 0 |
| AD-UNIT-05 | unit | | 9004 3파일 byte-identical + package.json 0 |
| AD-E2E-01 | e2e | | 행 확장 lazy 1회 호출·재확장 관측·숨김/해제 여정 — 테스트 아이템만 |

## v184 시나리오 집계

- 총 **14건** — [api] 8 / [unit] 5 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: 테스트 아이템 사이클(역할 변경→생성→숨김/해제→삭제→역할 원복 — AD-API-05·AD-E2E-01 연계)뿐. 실광고주는 읽기 전용 GET 만(숨김·toggle·수정 절대 금지 — 매 PATCH 전 item_id 대조). 개인정보는 허용 경계(상세 ④ 표시 항목) 명문화 후 응답·서버 로그·콘솔 3면 검증, k-익명은 추출 동일성으로 갈음. CS 발송류·points 조정 0건.

## 개정 이력 (v184)

- 2026-08-18 초판 작성 (14건) — 코디네이터 필수 9항목 전부 시나리오화(1→AD-API-01, 2→AD-API-03, 3→AD-API-04, 4→AD-API-05·06·AD-UNIT-04·AD-E2E-01, 5→AD-API-07, 6→AD-UNIT-03·AD-E2E-01 겸측, 7→AD-API-03·08·AD-UNIT-04, 8→AD-E2E-01, 9→AD-UNIT-05) + PLAN §6 판정(⑧ stars/insights 포함 — 추출 회귀 3종 세트·행 확장 lazy load) 반영. 강제 숨김은 테스트 유래 아이템 사이클로 한정하고 실광고주 무접촉을 불변식으로. BIZ_TOKEN 확보·아이템 삭제 경로·BASE_REV·증빙 수준·실광고주 읽기 허용·DB 읽기 승인 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.
- 2026-08-18 planner 판정 반영 — §4 판정 블록 6건 확정(SEED/TEST BIZ 토큰 이원화 — (a) 채택+폴백 (b) / 삭제는 광고주 DELETE API(Mongo 직접 delete 불허 — MinIO 정리) / BASE_REV `9ee2703` / 증빙 2중 충분(diff 리뷰에 로그 라인 이동 명시 확인 포함) / 실광고주 읽기 전용 표본 2개(이벤트 풍부·희소 양극) / DB 읽기 3회 승인). §0 문안 2곳 고정. 보류 0건 — dev 구현 완료·재기동 후 tester 착수 가능.
- 2026-08-18 planner E2E 확정 (1차 게이트 13/13 PASS·픽스 0회 접수 후) — AD-E2E-01 Given 갱신 1곳: 연계 실행 전제가 1차 Cleanup 완료로 소멸 → E2E 전용 사이클 재수행("v184-test-item-e2e", 동일 승인 패턴·원복 포함)으로 확정. confirm 대조 아이템명도 갱신값 기준. 편차 비고 2건 수용: ① 목록 status → account_status+is_banned 2필드(정보 동등 — 계약 확정, PLAN 정정 갈음) ② api.js 주석 "광고주 비노출"(화면 리터럴 아님 — AD-UNIT-03 규정 내 비고 처리 정당). 상태 라벨 확정값 "게재중"(planner 판정 — 노출 0건 불변식 유지) 랜딩 실측. E2E 갱신 외 잔여 문안 현재 코드와 일치 — 2단계 착수 가능.

# v185 — 기능오류 신고 시스템 1단계 (신고 인박스 + 실패 API 수집 + 자동 에러 뷰) (2026-08-18 20:46)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v185 §0 실측(_logs.py 포트 문자열 예외·수신부 계약·remoteLogger 후킹), §1 판정 3건(스크린샷 차기·백필 기각·error 만 저장), §2 설계, §5 테스트 항목 1~7, §6 강행 금지 7항
대상: backend_9005 `issues.py`·`admin_issues.py` 신설 + `_logs.py` error Mongo 병행 저장·fingerprint + main.py 등록·인덱스(9004 미러 4파일 — _logs.py 포트 예외) / 사용자 앱(4000) ReportIssueModal 플로우·api_failure 인터셉터 / 관리자 앱(4001) AdminIssuesPage 탭2·NavLink 9번째·AdminCsPage cid 쿼리·감사 짝 항목 2종. **파일 로그 계약·AdminCsSendModal·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **신고 생성·상태 변경은 테스트 계정 신고만**: 접수 본문은 전부 **`[v185-test]` prefix 표식**(예: "[v185-test] 재생 오류 검증") — 신규 컬렉션이라 실사용자 오염 원천 없음이나 표식으로 테스트 유래 식별 보장. **정리 계획**: 테스트 신고는 검증 종료 시 상태를 종결(resolved/dismissed)로 정리 후 **기본 잔존 + REPORT 에 id 목록 기재**(Mongo 직접 delete 는 planner 판정 위임 §4-2). frontend_errors 테스트 유발 문서도 동일(표식 = 유발 URL 경로 패턴 기재).
- **수집기 검증용 에러 유발은 사용자 앱(4000)+테스트 계정 세션에서만** — 유발 대상은 무해한 실패 호출(존재하지 않는 GET 404 등, 쓰기 API 아님). DM 연결 검증은 official↔테스트 계정 대화만.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN` / `USER_TOKEN`(테스트 계정) / `TEST_USER_1_ID` / `TEST_ISSUE_ID`(접수 후 기록) / `TEST_CID`(테스트 DM 대화 id). 실값 기재 금지. `BASE_REV` = **`3d05227` 확정**(§5 판정 1 — v184 마이크로픽스 포함 HEAD).
- 강행 금지(§6) 검증 관점: 파일 로그 계약 불변(경로·포맷·한도·인증 — IS-API-04), 감사 details·서버 로그에 본문·메모 원문 금지(길이만 — IS-API-06·08), 관리자 앱 remoteLogger 미적용(IS-UNIT-01), 2단계 기능(재발사·curl) 부재.
- 검산 DB 읽기(승인 관행 준용, §4-5): issue_reports count/필드 검증·frontend_errors $group 대조·frontend.log tail — 전부 읽기 전용.
- 환경: 9005·9004, Mongo, 사용자 앱 4000·관리자 앱 4001. 추적자 `[issues]`·`[admin-issues]`·`[_logs]`·`[AdminIssues]`·`[ReportIssue]`.

## 1. [api] 시나리오 — 접수·수집·파일 계약 (기본 대상 9005)

### IS-API-01. 접수 정상 — 5종 reason + DM 실패 격리 [api] — 핵심
- Given: `USER_TOKEN`(테스트 계정)
- When: ① reason 5종(playback/payment/account/auth/other) 각 1건 `POST /api/issues` — body `{reason, text:"[v185-test] {사유} 검증", page_url, app_version?}` — **dm_conversation_id 생략** ② 1건은 `dm_conversation_id: TEST_CID` 포함(사전 official↔테스트 대화 확보) 하면
- Then:
  - ① 전부 **201 {id}** — **cid 없이 접수 성공**(DM 실패 격리의 서버측 보장: cid 는 선택 필드). Mongo issue_reports 레코드: reason 코드 저장·`status=="received"`·**user_agent 서버 캡처**(요청 UA 헤더와 일치 — body 아닌 서버 기록)·page_url·created_at·user_id==TEST_USER_1_ID·dm_conversation_id 부재
  - ② 레코드에 TEST_CID 저장(상세 "CS 대화 열기" 연결 근거)
  - 모달 측 실패 격리(DM 생성 실패 시에도 POST 수행)는 **코드 리뷰 갈음 기본**(실측 유발 곤란 — §4-3)

### IS-API-02. 접수 검증 — 400·401 [api]
- Given: `USER_TOKEN` / 토큰 없음
- When: ① reason="bug"(비화이트리스트)·빈 reason ② text 빈/공백만/2001자 ③ 유효 body 무토큰 하면
- Then: ①② 전부 **400**(422 관측 시 비고 후 통일 관행) ③ **401**. 전 케이스 issue_reports 레코드 미생성(count 불변).

### IS-API-03. 수집기 저장 — fingerprint 묶임·context.api·error 한정 [api] — 핵심
- Given: 4000 테스트 계정 세션. frontend_errors 사전 상태 기록
- When: ① 동일한 실패 API(존재하지 않는 GET → 404)를 **2회** 유발 ② 다른 경로 실패 1회 유발 ③ console.warn 1회 유발 → remoteLogger 배치 전송 대기(5초) 후 Mongo 확인하면
- Then:
  - ① 두 문서가 **같은 fingerprint**(16 hex — id/숫자열 정규화 확인: url 내 uuid/ObjectId 상이해도 동일 fp)로 적재 — 묶음 키 동작. `context.api == {method, url, status}` 저장, message `[api_failure] GET {경로} -> 404` 형식
  - ② 다른 fingerprint(과대 묶음 아님 — 경로 상이)
  - ③ **warn 은 frontend_errors 미적재**(error 만 — 판정 3), 파일 로그에는 기록(IS-API-04 겸측)
  - user_id·page·created_at 필드 실재, stack 은 존재 시만

### IS-API-04. 파일 로그 계약 회귀 — 응답·append 포맷 불변 + Mongo 실패 격리 [api] — 핵심 (강행 금지 ①)
- Given: `USER_TOKEN`. 변경 전 frontend.log 기존 라인 표본(형식 기준) 확보
- When: ① `POST /api/_logs/frontend` 정상 배치(error 1+warn 1) ② 무토큰 ③ batch 51건 ④ IS-API-03 유발분의 frontend.log 확인 ⑤ Mongo 저장 실패 경로 검토하면
- Then:
  - ① 응답 **기존 계약과 불변**(상태·body 형식) + frontend.log 에 error·warn 모두 **기존 `_format_line` 포맷 그대로 append**(라인 구조 diff 관점 대조 — 신규 필드 삽입 없음) ② 401(기존 동일) ③ 기존 한도 동작 동일(400/절단 — 기존 계약 기준)
  - ④ Mongo 병행 저장이 파일 기록을 대체하지 않음(파일·Mongo 양쪽 실재)
  - ⑤ **Mongo insert 가 try/except best-effort 로 격리**되어 실패해도 파일 append·응답 불변 — 모킹 수단 부재 시 **코드 리뷰 갈음**(§4-3): except 블록이 응답 경로에 영향 없음 확인

## 2. [api] 시나리오 — 관리자 API

### IS-API-05. 목록·요약 — 필터 3종 + 4수치 검산 [api] — 핵심
- Given: `ADMIN_TOKEN`. IS-API-01 접수분(5+1건) 존재. DB 직접 count 확보(읽기 전용 — status별·오늘 인입·7일 완료)
- When: ① `GET /api/admin/issues`(무필터) ② `?status=received` ③ `?reason=playback` ④ `?q={테스트 계정 닉네임}`·`?q=[v185-test]`(내용) ⑤ `GET /api/admin/issues/summary` 하면
- Then: ① 200 — 행에 닉네임#code(hydrate)·reason·상태·내용 요약·접수일+pagination, created_at DESC ② 전 행 status 일치 ③ 전 행 reason 일치 ④ 닉네임/내용 매칭 행만 ⑤ **4수치(미처리·처리중·오늘 인입·7일 완료) == DB 직접 count 정확 일치**(시차 쓰기 시 1회 재실행 규칙 준용).

### IS-API-06. PATCH 상태 전이 + 감사 적재 + 401/403 [api] — 핵심
- Given: `ADMIN_TOKEN`, `TEST_ISSUE_ID`(테스트 신고만 — §0)
- When: ① `PATCH /{TEST_ISSUE_ID}` `{status:"in_progress", admin_note:"[v185-test] 확인 중"}` → ② `{status:"resolved"}` ③ `{status:"zzz"}` ④ 미존재 id ⑤ 유효 body 무토큰/`USER_TOKEN` 하면
- Then: ①② 200 — 레코드 status·admin_note·handled_by·handled_at 갱신. **감사 `issue_status_change` 행**(target_type=`issue_report`·target_id=id, details `{from, to, note_len}` — **본문·메모 원문 부재**, 전이당 1행) ③ 400(화이트리스트) ④ 404 ⑤ 401/403 — 발동 0(레코드 불변).

### IS-API-07. errors 묶음·이력 — 집계 검산 + days·401/403 [api]
- Given: `ADMIN_TOKEN`. IS-API-03 유발분 존재. frontend_errors $group 직접 대조값 확보(읽기 전용)
- When: ① `GET /api/admin/issues/errors?days=7` ② `GET /errors/{fingerprint}?days=7`(IS-API-03 의 fp) ③ days=8/0/문자 ④ 무토큰·`USER_TOKEN` 하면
- Then: ① 묶음 행 `{fingerprint, count, 영향 사용자 수(distinct), last_seen, 대표 message/page}` — **count·distinct·last_seen == DB $group 정확 일치**(테스트 fp 행 count==2) ② 발생 이력에 **context.api {method,url,status} 포함**(2단계 재확인용 메타데이터 확보 검증)+페이지네이션 ③ 전부 400(화이트리스트 {7,30,90}) ④ 401/403.

### IS-API-08. 개인정보 — 서버 로그·응답 경계 [api] — 핵심 (강행 금지 ③)
- Given: IS-API-01~07 실행 구간의 백엔드 로그, 관리자 응답 전문 보관
- When: ① 서버 로그 grep — 신고 본문("[v185-test]" 이후 내용 원문)·admin_note 원문·page_url 쿼리 원문·이메일 ② 관리자 목록/상세/errors 응답 전문 검사 ③ frontend_errors 저장 문서의 sanitize 확인하면
- Then: ① **0건** — `[issues]`/`[admin-issues]`/`[_logs]` 로그는 길이·id·건수 수준만 ② 필요 필드 외 개인정보 부재(닉네임#code·UA·page_url 은 표시 사양 허용 — 이메일·연락처 부재) ③ 기존 `_sanitize_message`/`_sanitize_stack` 통과(민감 키 drop — IS-UNIT-01 의 마스킹과 이중 확인). 위반 시 즉시 중단·보고.

### IS-API-09. 회귀 — 기존 대표·_logs server.log·git diff [api] — 회귀 마감
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(확정 후)
- When: ① 기존 _logs 의 server.log 계열 API 대표 1건(기존 계약 불변) ② admin 대표 재실행(points summary·logs·cs search·advertisers 목록 등 대표 3~4건)+사용자용 대표 ③ `git diff {BASE_REV}..HEAD --name-only` 하면
- Then: ① 기존 동작 불변 ② 전부 기존 TESTPLAN 판정 기준 PASS ③ 변경 파일 == PLAN §3 매트릭스 정확 일치 — AdminCsSendModal·points 계열·**package.json/lock 부재**. 초과 파일 시 즉시 중단.

## 3. [unit] 시나리오 (브라우저 하니스 + 정적 검사)

### IS-UNIT-01. 수집기 클라이언트 — 인터셉터·마스킹·4001 미적용 [unit] — 핵심
- Given: 4000 테스트 계정 세션(네트워크 탭 기록)
- When: ① 실패 API 유발 → `/api/_logs/frontend` 배치 전송 payload 검사 ② **`?token=abc&key=xyz` 계열 쿼리를 가진 실패 URL** 유발 ③ 4001 관리자 앱에서 동일 관찰하면
- Then: ① payload 에 `[api_failure] {METHOD} {경로} -> {status}` 구조화 이벤트(level error·context.api)·5초 배치 관행 유지 ② **payload·저장값에서 token/key/secret/password 계열 파라미터 값 마스킹**(원문 0건 — IS-API-03 Mongo 측과 이중) ③ **4001 은 `/_logs/frontend` 전송 자체 없음**(관리자 앱 remoteLogger 미적용 유지 — 강행 금지 ②).

### IS-UNIT-02. 관리자 UI — NavLink 9·탭 2·인박스·행 확장 [unit] — 핵심
- Given: 관리자 로그인, 테스트 신고·에러 데이터 존재
- When: 사이드바 9번째 **"오류 신고"**(FiAlertCircle) → 탭① 인박스 → 필터·상세 패널 → 탭② 전환 → 묶음 행 확장하면
- Then: `/issues` 진입+active(기존 8메뉴 무손상), 탭① — 요약 카드 4·사유 필터 5+전체·검색·목록(상태 배지·닉네임#code·요약·접수일)·상세 패널(전문+환경정보(UA·page_url)+`/users/:id` 링크+상태 변경 UI+메모+CS 대화 열기 버튼), 탭② — 묶음 목록(count·영향 사용자·last_seen)·기간 필터·**행 확장 시 이력 lazy load 1회 호출**(v184 관행)+**api 메타데이터(method/url/status) 표시**. 콘솔 신규 에러 0건.

### IS-UNIT-03. 감사 짝 항목 + AdminCsPage 회귀 + 콘솔 위생 + eslint [unit]
- Given: IS-API-06 실행 후, `/logs`·`/cs` 진입 + IS-UNIT-01~02 세션 콘솔
- When: ① issue_status_change 행 확인 ② `/cs` **cid 쿼리 없는 진입** ③ 콘솔 검색(신고 본문·메모·닉네임·이메일) ④ eslint 하면
- Then: ① **"오류신고 상태 변경"(blue) 라벨+배지·target "오류 신고"** 라벨(짝 항목 2종 — gray fallback 아님) ② 기존 CS 목록·선택 동작 불변(cid 처리 추가의 회귀 조건 — §6) ③ `[AdminIssues]`·`[ReportIssue]` 포함 **0건**(길이/건수/status 만) ④ eslint 신규 0.

### IS-UNIT-04. 9004 미러 — 3파일 byte-identical + _logs.py 포트 치환 diff 0 + package.json [unit] — 미러 규칙
- Given: 9004 기동, 저장소
- When: ① issues.py·admin_issues.py·main.py 9005↔9004 diff ② **_logs.py 포트 치환 검증 절차**: `diff <(sed -e 's/backend_9005/backend_9004/g' -e 's/9005/9004/g' backend_9005/app/routes/_logs.py) backend_9004/app/routes/_logs.py` — 포트·경로 문자열 치환 후 비교 ③ package.json(+lock) git diff ④ **9004** POST /api/issues 401 대표 1회 하면
- Then: ① 3파일 **byte-identical** ② 치환 후 **diff 0**(포트 문자열 외 차이 없음 — 기존 미러 예외 규칙 준수) ③ diff **0** ④ 9005 와 동일 401. 9004 에 쓰기 성공 케이스 없음(중복 회피).

## 4. [e2e] 시나리오 — 1건 (사용자 여정)

### IS-E2E-01. 풀 여정 — 4000 신고 → 4001 인박스 → 상태 변경 → CS 열기 → 탭② [e2e] — 핵심
- Given: 4000 테스트 계정 로그인 + 4001 테스트 관리자 로그인. 사전에 IS-API-03 의 에러 유발분 존재
- When: **[4000]** 신고 모달 열기 → 사유 선택+내용 `"[v185-test] E2E 여정 신고"` 입력 → 제출 → 접수 확인(+DM 프리필 화면 이동 관찰) → **[4001]** `/issues` 인박스에 해당 신고 표시 확인 → 상세 열기(전문·환경정보) → 상태 변경(**confirm 수락** — 대상이 [v185-test] 신고임을 문안 대조)+메모 입력 → `/logs` 에서 "오류신고 상태 변경" 라벨 렌더 → 상세의 **"CS 대화 열기"** → `/cs?cid=` 진입 시 **해당 대화 자동 선택** → `/issues` 복귀 → **탭② 에러 묶음 표시**(유발 fp 행·count) 확인하면
- Then: 전 단계 정상 전이 — 접수·인박스 반영(새로고침 허용)·상태 배지 갱신·감사 라벨·cid 자동 선택(대화 부재 시 무시 동작은 별도 1회 확인 — 잘못된 cid 로 진입 시 크래시 없음)·묶음 행 표시. 콘솔 신규 에러 0건. **상태 변경 confirm 은 테스트 신고에서만 수락**(타 신고 존재 시 취소).
- 증적: 모달·접수 확인·인박스·상세·감사 로그·cid 자동 선택된 /cs·탭② 스크린샷.

## 5. planner 확인 필요 사항

1. **BASE_REV**: v184 종료 커밋 — planner 확정 예정 표기(확정 전 IS-API-09 ③ 보류). 해시 회신 요청.
2. **테스트 레코드 정리 방식**: 기본안 = 테스트 신고를 종결 상태(resolved/dismissed)로 정리 후 **잔존+REPORT 에 id 목록 기재**(신규 컬렉션·dev 환경). Mongo 직접 delete 를 허용할지 판정 위임(frontend_errors 테스트 유발 문서 동일).
3. **격리 2건의 코드 리뷰 갈음 승인**: ① 모달 DM 생성 실패 시 접수 성공(실측 유발 곤란 — 프론트 코드 리뷰) ② _logs Mongo insert 실패 시 파일·응답 불변(모킹 수단 부재 시 try/except 코드 리뷰) — 각 갈음 기본값 승인 요청.
4. **수집기 유발 에러의 잔존**: IS-API-03/IS-UNIT-01/IS-E2E-01 이 frontend_errors 에 테스트 문서(수 건)를 남김 — 유발 URL 패턴을 REPORT 에 표식 기재하고 잔존하는 방침(§4-2 와 동일 판정) 확인.
5. **검산 DB 읽기 승인**: issue_reports count/필드·frontend_errors $group·frontend.log tail(읽기 전용 — 기존 승인 관행 준용) 확인.
6. **batch 51건 한도 동작(IS-API-04 ③)**: 기존 계약의 정확한 한도 초과 동작(400 vs 절단)을 구현·기존 코드 기준으로 고정 필요 — 실측 전 기존 동작 기준값 회신(변경 없음이 판정 기준).

### planner 판정 (2026-08-18, 6건 전부 확정 — 해당 문안 반영 완료)

1. **BASE_REV = `3d05227`** (v184 마이크로픽스 커밋 — planner git log 실측: 현재 HEAD, 픽스 포함 최신 기준이 맞음. 본커밋 359c829 아님). IS-API-09 ③ 은 `git diff 3d05227 --name-only` 워킹트리 기준 — 보류 해제.
2. **테스트 레코드 — 기본안 채택, Mongo 직접 delete 불허.** 근거: issue_reports 는 상태 이력이 감사 로그 `issue_status_change` 의 target_id 와 연결되는 **감사성 데이터** — 삭제 시 감사 행이 고아화. `[v185-test]` 표식+종결 상태로 오염 없고, 원장·감사 잔존 관행과도 일관. frontend_errors 테스트 문서 동일(잔존+fp 기재).
3. **격리 2건 코드 리뷰 갈음 승인** — 모킹 인프라 부재 상태에서 비용 대비 적정(오케스트레이터 의견 동의). try/except·플로우 분기 문면 확인으로 판정.
4. **수집기 유발 에러 잔존 허용** + REPORT 에 **유발 URL 패턴과 fingerprint 값 명기**(탭② 상단에 테스트 fp 가 보이는 것은 dev 환경 특성으로 함께 기재 — 오케스트레이터 권장 채택).
5. **검산 DB 읽기 승인**(관행 준용 — 전부 읽기 전용).
6. **batch 한도 동작 — 전부 422 거절(절단 아님) 확정.** planner 코드 실측(_logs.py): body >256KB → **422**(:358)·빈 배치 → **422**(:394)·batch >50 → **422**(:401) — 요청 전체 거절, 부분 수용·절단 없음. IS-API-04 ③ 기대값 = 422 + 파일·Mongo 양쪽 미기록(레코드 수 불변). "변경 없음" 판정 기준 유지.

## 6. 실행 순서 권고 (tester 참고)

1. 사전: 테스트 DM 대화(TEST_CID) 확보 → IS-API-01→02 (접수) → IS-API-03 (4000 유발 — 표식 기록) → IS-API-04 (파일 계약 — 유발분 재사용)
2. IS-API-05→06 (관리자 목록·PATCH — 테스트 신고만) → IS-API-07 (errors 검산) → IS-API-08 (개인정보 — 01~07 산출물 재사용) → IS-API-09 (회귀+diff — BASE_REV 확정 후)
3. IS-UNIT-01 (4000) → IS-UNIT-02→03 (4001) → IS-UNIT-04 (미러 — 치환 diff 절차)
4. IS-E2E-01 (양 앱 여정 — 테스트 신고만 confirm 수락)
5. 종료: 테스트 신고 종결 상태 정리(§5-2 확정 방식) + REPORT — 테스트 신고 id·frontend_errors 유발 표식·감사 잔존 행·코드 리뷰 갈음 항목 기재

## 7. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| IS-API-01 | api | | 5종 201·UA 서버 캡처·cid 없이 성공(격리) |
| IS-API-02 | api | | reason·text 400 + 401 — 레코드 0 |
| IS-API-03 | api | | 동일 에러 2회 같은 fp·context.api·warn 미적재 |
| IS-API-04 | api | | 파일 응답·포맷 불변 + Mongo 실패 격리(코드 리뷰 §5-3) |
| IS-API-05 | api | | 필터 3종 + summary 4수치 DB 대조 |
| IS-API-06 | api | | 전이+감사(원문 부재)+400/404/401/403 |
| IS-API-07 | api | | 묶음 $group 검산·이력 api 메타·days 400 |
| IS-API-08 | api | | 서버 로그·응답 개인정보 0건 — 위반 시 중단 |
| IS-API-09 | api | | server.log 계약·기존 대표·diff 매트릭스 |
| IS-UNIT-01 | unit | | [api_failure] payload·마스킹·4001 미적용 |
| IS-UNIT-02 | unit | | NavLink 9·탭 2·상세 패널·행 확장 1회 호출 |
| IS-UNIT-03 | unit | | 짝 항목 2종 + /cs 무쿼리 회귀 + 콘솔 0 + eslint 0 |
| IS-UNIT-04 | unit | | 3파일 identical + _logs 치환 diff 0 + package.json 0 |
| IS-E2E-01 | e2e | | 4000→4001 풀 여정·cid 자동 선택·탭② 묶음 |

## v185 시나리오 집계

- 총 **14건** — [api] 9 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 6건은 §5)
- 쓰기: 테스트 신고 접수(6건 내외·[v185-test] 표식)+상태 전이(테스트 신고만)+수집기 유발 에러 문서(무해 실패 호출) — 실사용자 데이터 무접촉(신규 컬렉션+표식+정리 계획 §0). DM 연결은 official↔테스트 계정만. CS 발송·points 조정·광고 조작 0건. 개인정보(본문·메모·쿼리 원문)는 서버 로그·감사 details·콘솔 3면에서 부재 검증 — 위반 시 즉시 중단.

## 개정 이력 (v185)

- 2026-08-18 초판 작성 (14건) — 코디네이터 필수 7축 전부 시나리오화(1→IS-API-01·02, 2→IS-API-03·IS-UNIT-01, 3→IS-API-04, 4→IS-API-05·06·07, 5→IS-E2E-01, 6→IS-UNIT-04(_logs 포트 치환 sed diff 절차 명기), 7→IS-API-08) + PLAN §5 잔여(짝 항목·cs 회귀 → IS-UNIT-03, 기존 회귀 → IS-API-09) 반영. 테스트 유래 레코드는 [v185-test] 표식+종결 상태 정리+잔존/REPORT 방침으로 설계(삭제는 §5-2 위임). BASE_REV·정리 방식·격리 2건 갈음·유발 에러 잔존·DB 읽기·batch 한도 기준 6건 planner 회신 대기(§5). planner 검토 후 확정 예정.
- 2026-08-18 planner 판정 반영 — §5 판정 블록 6건 확정(BASE_REV `3d05227` — 마이크로픽스 포함 HEAD / 테스트 레코드 잔존·delete 불허 — 감사 target 고아화 방지 / 격리 2건 코드 리뷰 갈음 승인 / 유발 에러 잔존+fp 명기 / DB 읽기 승인 / batch 한도 = 전부 422 거절 코드 실측 — body·빈배치·51건 3경로). §0 문안 1곳 고정. 보류 0건 — dev 구현 완료·재기동 후 tester 착수 가능.
- 2026-08-18 planner E2E 확정 (1차 게이트 13/13 PASS 접수 후) — ① 마스킹 픽스 1줄(`?&` 잔존 정리 — 코스메틱, 민감값 제거는 게이트에서 완전 확인)은 IS-E2E-01 판정 요소(접수·인박스·상태 변경·cid 선택·탭②)와 무관 판정 — E2E 문안 갱신 불요, 스모크 재실행 통과를 전제로 그대로 확정. Given 의 "IS-API-03 유발분 존재"는 게이트 잔존 fp 재사용으로 충족(v184 형 전제 소멸 없음). ② fingerprint 의 page 포함으로 동일 URL 오류가 발생 page 별로 분리되는 관측(artists 사례) — PLAN §2 설계 사양 동작이자 §6 기지 리스크(과소 묶음) 범위로 **1단계 수용 확정**. 2단계 개선 후보 구체화: api_failure 이벤트는 page 대신 api.url 기준 fp 가 적합(REPORT 후속 후보 예약).

# v186 — 기능오류 신고 시스템 2단계 (프로브 재확인·curl 복사·신고↔에러 연결·fp 개선) (2026-08-19 11:27)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v186 §0 실측(frontend_errors 20건·api 13건 전부 GET·상대 경로 저장), §1 판정 3건(스크린샷 차기·fp 백필 기각·무인증 프로브), §2 설계, §5 테스트 항목 1~7, §6 강행 금지 9항
대상: backend_9005 `admin_issues.py` probe·related-errors 2 엔드포인트+errors last_probe additive+PATCH note 단독 확장 / `_logs.py` fp v2 분기(**파일 로그 계약 라인 무접촉**) / main.py probe_history 인덱스(9004 미러 3파일) / frontend_admin AdminIssuesPage 지속 여부 열·재확인·curl 복사·관련 에러 병치·자동 메모+api.js 2래퍼+짝 항목 2. **issues.py·사용자 앱·AdminCsPage·package.json 무변경**이 검증 대상

## 0. 전제 및 안전 규칙

- **프로브 대상은 자기 백엔드 무해 GET 만**: ① v185 테스트 fp 의 미존재 경로(`/api/...` 404 계열 — 표식 경로 재사용) ② 실재 공개 GET 1건(예: `GET /api/points/costs` — 읽기 전용) ③ 인증 필수 GET 1건(indeterminate 판정용 — 무인증 프로브라 게이트에서 차단, 부작용 0). **쓰기 메서드 재발사·외부 URL 시도 결과가 400 이 아니면 즉시 중단·보고**(강행 금지 ①②).
- **신고 검증은 `[v185-test]`/`[v186-test]` 표식 신고만** — 신규 유발 데이터는 전부 `[v186-test]` 계열 표식(신고 본문·유발 URL 경로 패턴). 쓰기 = probe_history·감사·테스트 신고 admin_note append 한정. **Mongo delete 불허 관행** — 테스트 유래 문서 잔존+REPORT id/표식 기재.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN` / `USER_TOKEN`(테스트 계정 1) / `USER2_TOKEN`(테스트 계정 2 — 교차 계정 실증용, §4-4) / `TEST_ISSUE_ID`. `BASE_REV` = v185 종료 커밋(planner 확정 예정 — 확정 전 diff 판정 보류).
- curl 복사 검증 기준: 클립보드 문자열에 **실토큰·실크리덴셜 0건**(`Bearer <YOUR_TOKEN>` 플레이스홀더 — 세션 localStorage 실토큰 값과 대조 0건).
- GET 부작용 deny-list **확정(backend-dev 실측 접수)**: `/api/rewards/admob-callback` 1건(무인증 도달+쓰기 부작용 — 심층 방어 등재) — PB-API-02 ⑥ 400 케이스로 반영, **프로브 대상 금지 목록에도 등재**(테스트 중 이 경로를 정상 프로브 대상으로 사용 금지). 그 외 부작용 GET 은 전부 인증 게이트 — 무인증 프로브가 401 로 원천 차단(수신측 스킵 불요 판정, REPORT 비고 기재).
- 환경: 9005·9004, Mongo, 사용자 앱 4000(유발용)·관리자 앱 4001. 추적자 `[admin-issues]`·`[_logs]`·`[AdminIssues]`·`[AdminLogs]`.

## 1. [api] 시나리오 — 프로브·연결·fp (기본 대상 9005)

### PB-API-01. 프로브 core — verdict 3종·이력·감사·헤더 [api] — 핵심
- Given: `ADMIN_TOKEN`. 대상 3종(§0): 404 경로(원 오류 status 404 — v185 테스트 fp 연계)·실재 공개 GET·인증 필수 GET
- When: ① `POST /api/admin/issues/probe` `{url: 404경로, fingerprint: 테스트fp, orig_status: 404}` ② `{url: 공개 GET}` ③ `{url: 인증 GET, orig_status: 500}`(원 status 상이 케이스) 각각 호출하면
- Then:
  - ① 200 `{status: 404, latency_ms(양수), verdict: "persisting", probed_at}` — **원 오류 status 일치 → 지속중**
  - ② `status 2xx → verdict "resolved"`(해소됨)
  - ③ 프로브 status 401/403(무인증 게이트) ≠ 원 status → **`indeterminate`("판정 불가 — 인증 필요/상태 상이" 정직 표기)** — 판정 1-3 정합. verdict 명명은 `indeterminate` 확정(inconclusive 아님 — backend 계약)
  - 비고(정보성): 스펙 외 `unreachable`(네트워크 실패) verdict 실재 — 판정 항목 아님, 발생 시 관측값만 결과표 비고에 기록
  - probe_history 3건 저장 `{target_url, method:"GET", status, latency_ms, verdict, fingerprint?, admin_id, created_at}` + 감사 `issue_probe` 적재(target_type=error_group(fp 연계)·details `{url, status, verdict}` — **토큰류·크리덴셜 부재**) + **X-Admin-Probe: 1 발신 실측**(수신측 서버 로그에서 헤더 확인) + redirect 미추적·timeout 5s 사양은 코드 리뷰 병행

### PB-API-02. SSRF 차단 4케이스 + GET 외 400 [api] — 핵심 (위반 시 즉시 중단)
- Given: `ADMIN_TOKEN`. probe_history count 사전 기록
- When: ① `url: "http://evil.example/x"`(`://` 절대 URL) ② `"/api/../etc/passwd"`(`..`) ③ `"//evil.example/x"`(`//`) ④ `"/admin/users"`(비 `/api/` prefix) ⑤ body `{url: 무해 GET 경로, method: "POST"}`(GET 외 메서드 명시 — backend 계약 확정 형식) ⑥ `url: "/api/rewards/admob-callback"`(**deny-list 등재 경로** — 무인증 도달·쓰기 부작용 심층 방어) ⑦ 무토큰/`USER_TOKEN` 하면
- Then: ①~④ 전부 **400 + probe_history 미증가(발사 전 차단 — count 불변)** — 상대 경로 4중 검증 실증. ⑤ **400 + 에러 메시지에 "curl 복사를 이용하세요" 포함**(GET 한정 서버 계약) ⑥ **400 + 발사 0**(deny-list — probe_history 미증가) ⑦ 401/403(관리자 게이트 — 발사 0). **어떤 케이스든 외부로 요청이 나가는 우회가 관찰되면 즉시 중단·planner 보고**(강행 금지 ①). 보조(여력 시 1케이스 스팟): 공백·제어문자·백슬래시 포함 url 도 400(backend 차단 매트릭스 실측 정보).

### PB-API-03. 쿨다운 10초 — 429 [api]
- Given: `ADMIN_TOKEN`
- When: ① 동일 url 프로브 직후 즉시 재요청 ② 그 사이 **타 url** 프로브 ③ 10초 경과 후 동일 url 재요청 하면
- Then: ① **429**(쿨다운 — probe_history 미증가·감사 미적재) ② 정상 200(대상별 독립) ③ 정상 200(쿨다운 해제). 429 응답에 내부 정보 미노출.

### PB-API-04. related-errors — 본인 한정·±30분 경계 [api] — 핵심 (개인정보, 위반 시 즉시 중단)
- Given: `ADMIN_TOKEN`. 준비: 테스트 신고 A(`USER_TOKEN` 계정1, `[v186-test]` 표식) 접수 직전후 **계정1 에러 2건 + 계정2(`USER2_TOKEN`) 에러 1건** 을 ±30분 창 내 유발(교차 계정 실증 데이터)
- When: ① `GET /api/admin/issues/{A}/related-errors` ② 에러 없는 테스트 신고 B 로 동일 호출 ③ 무토큰/`USER_TOKEN` 하면
- Then:
  - ① 계정1 에러 2건만 반환(시각순·최대 20) — **계정2 에러 혼입 0건**(신고자 본인 user_id 한정 실증 — 개인정보 핵심). **시간 경계**: 창 밖(±30분 초과) 기존 frontend_errors 문서(계정1 소유·오래된 것)가 미포함 — 해당 문서 부재 시 경계 조건 코드 리뷰 갈음(§4-3)
  - ② 빈 배열 안전(500 없음) ③ 401/403

### PB-API-05. PATCH note 단독 + 기존 status 회귀 + 자동 기록 포맷 [api]
- Given: `ADMIN_TOKEN`, `TEST_ISSUE_ID`(테스트 신고만)
- When: ① `PATCH /{id}` `{admin_note: "[v186-test] 메모 단독"}`(status 생략) ② 기존 방식 `{status:"in_progress", admin_note}` ③ 자동 기록 형식 문자열(`[재확인 {시각}] GET {url} → {status} — 재현됨`) append 하면
- Then: ① 200 — **메모만 갱신·status 불변**(additive 확장) ② v185 IS-API-06 판정 그대로(기존 호출 불변 — status 전이+감사) ③ append 수용·기존 메모 보존(전문 확인). 감사 details 에 메모 원문 부재(note_len 만 — v185 규약 유지).

### PB-API-06. fp v2 실증 — page 무관 묶음·비-api 불변·백필 없음 [api] — 핵심
- Given: 4000 테스트 계정 세션. 사전: 기존 frontend_errors 전체 스냅샷(count·fp 목록 — v185 유래 v1 문서 포함)
- When: ① **같은 api.url 실패를 서로 다른 page 2곳**에서 각 1회 유발(`[v186-test]` 표식 경로) ② 비-api 에러(console.error) 1회 유발 ③ 스냅샷 재대조 하면
- Then:
  - ① 2건이 **동일 fingerprint 1묶음**(`api|GET|{정규화 url}` — page 상이해도 동일, v185 과대 분리 관측의 해소 실증) + **`fp_version: 2`** 병기 + 탭② 묶음 count 2
  - ② 기존 fp 방식(message+page)·`fp_version: 1` — 비-api 경로 무영향
  - ③ **기존 v185 문서 전부 무변경**(fp·fp_version·count 불변 — 재계산 백필 없음, 강행 금지 ⑤)

### PB-API-07. 회귀 — v185 대표·admin_issues 6 엔드포인트·미오염·diff [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, `BASE_REV`(확정 후). 프로브 실행 완료 상태
- When: ① v185 대표 재실행 — 접수 201·인박스 목록/summary·**파일 로그 계약**(frontend.log 포맷·응답 불변 — _logs.py 변경이 Mongo 내부 로직만임을 재검증)·errors 묶음 ② admin_issues 기존 6 엔드포인트 대표(errors 목록은 **last_probe additive 만** — 기존 필드 불변) ③ **프로브 미오염**: 프로브 실행 전후 frontend_errors count·대상 fp count 불변(프로브는 서버간 호출 — remoteLogger 미경유 구조 확인) ④ `git diff {BASE_REV}..HEAD --name-only` + **package.json/lock 부재**(httpx 기존 의존 — 신규 설치 없음, requirements 계열 diff 도 확인) 하면
- Then: ①② 전부 기존 TESTPLAN 판정 기준 PASS ③ count 불변 + 감사 details·probe_history 에 토큰류 부재(§5-7 위생) ④ 변경 파일 == PLAN §3 매트릭스 정확 일치(issues.py·사용자 앱·AdminCsPage 부재). 초과 파일 시 즉시 중단.

### PB-API-08. 9004 미러 — 3파일 + 대표 케이스 [api] — 미러 규칙
- Given: 9004 기동
- When: ① admin_issues.py·main.py 9005↔9004 diff + **_logs.py sed 포트 치환 후 diff 0**(v185 IS-UNIT-04 절차 재사용) ② **9004** probe 무토큰 401 + SSRF 1케이스 400(발사 없는 케이스만 — 9004 에서 프로브 성공 실행은 하지 않음) 하면
- Then: ① 2파일 byte-identical + _logs.py 치환 diff **0** ② 9005 와 동일 판정.

## 2. [unit] 시나리오 — AdminIssuesPage (브라우저 하니스, 4001 dev)

### PB-UNIT-01. 탭② — 지속 여부 열·재확인 여정·429 안내 [unit] — 핵심
- Given: 관리자 로그인, `/issues` 탭②(테스트 fp 행 존재 — 프로브 미실행 상태 확보 가능 시)
- When: ① 지속 여부 열 확인 ② 테스트 fp 행(무해 404 경로) **[재확인]** 클릭 ③ 직후 연타 ④ 행 확장 하면
- Then: ① 미확인 행 **"—"** 표시, 프로브 이력 있는 행은 최신 verdict 배지 ② 결과 배지 **"방금 확인: {status} — {라벨}"**(지속중/해소됨/판정 불가) + 열 갱신 ③ **429 안내 표시**(크래시·무한 재시도 없음) ④ 확장 내 **확인 이력**(probe_history) 표시. 재확인은 테스트 fp 행에서만 실행(실사용자 유래 fp 행 클릭 금지 — 무해 GET 이지만 이력 오염 방지).

### PB-UNIT-02. curl 복사 — 실토큰 부재·버튼 분기 [unit] — 핵심
- Given: 탭② 에 GET 행 + **비GET 행**(부재 시 4000 에서 미존재 경로 무해 POST 404 실패 1회 유발로 생성 — §4-5)
- When: ① 비GET 행 버튼 확인 ② [curl 복사] 클릭 후 클립보드 검사 ③ GET 행 버튼 확인 하면
- Then: ① 비GET 행은 **[재확인] 없음·[curl 복사]만**(자동 재발사 금지 분기) ② 클립보드 == `curl -X {METHOD} '{호스트}{url}' -H 'Authorization: Bearer <YOUR_TOKEN>'` 형식 — **실토큰 0건**(localStorage 토큰 값 대조)·url 은 마스킹된 값 그대로 ③ GET 행은 [재확인]+[curl 복사] 병행. 콘솔에 토큰·curl 전문 미출력.

### PB-UNIT-03. 신고 상세 병치·자동 메모·/logs 짝 항목·콘솔·eslint [unit] — 핵심
- Given: 테스트 신고 상세(PB-API-04 의 A — 관련 에러 존재), `/logs`
- When: ① 상세의 관련 에러 병치("기계 관측") ② API 후보 추천 → **[재확인]** → 결과 확인 ③ admin_note 확인 ④ `/logs` 에서 issue_probe 행 ⑤ 콘솔 검색·eslint 하면
- Then: ① 신고자 본인 에러만 병치(±30분 — API-04 와 일치) ② 프로브 결과 표시 ③ **메모에 자동 append**(`[재확인 {시각}] GET {url} → {status} — {판정 문구}` — 기존 메모 보존) ④ **"오류 재확인" 라벨+배지 + target "error_group" 한글 라벨**(짝 항목 2종 — gray fallback 아님) ⑤ 콘솔에 본문·메모·토큰 0건(마스킹된 url·건수/status 는 허용)·eslint 신규 0. v185 인박스·탭 전환 스모크 병행(회귀).

## 3. [e2e] 시나리오 — 1건 (관리자 여정)

### PB-E2E-01. 풀 여정 — 탭② 재확인→429→curl→신고 상세 검증→감사 [e2e] — 핵심
- Given: 관리자 로그인. 테스트 fp(404 경로)·테스트 신고(`[v186-test]`)·관련 에러 준비 완료(PB-API-04·06 데이터 재사용)
- When: `/issues` 탭② → 지속 여부 열("—") → 테스트 fp 행 **[재확인]** → 배지·열 갱신 → 연타 → 429 안내 → 비GET 행 **[curl 복사]** → 클립보드 실토큰 부재 확인 → 탭① → 테스트 신고 상세 → 관련 에러 병치 확인 → 추천 API **[재확인]** → **메모 자동 기록** 확인 → `/logs` → "오류 재확인" 라벨 → 인박스 복귀(v185 여정 무손상) 하면
- Then: 전 단계 정상 전이·콘솔 신규 에러 0건·프로브 대상은 무해 GET 만(실사용자 fp 행 미조작)·**네트워크에 send/broadcast/adjust POST 0건**. 감사 로그에 issue_probe 행 잔존(REPORT 기재).
- 증적: 지속 여부 열·재확인 배지·429 안내·클립보드 내용(토큰 플레이스홀더)·상세 병치·자동 메모·감사 라벨 스크린샷.

## 4. planner 확인 필요 사항

1. **BASE_REV**: v185 종료 커밋 = **`c846923` 확정**(§4 판정 1 — 보류 해제).
2. **GET 외 400 의 요청 형식**: probe body 에 method 전달 방식이 설계상 미확정(GET 한정 서버 구현) — 구현 확정 후 PB-API-02 ⑤ 문안 고정.
3. **±30분 시간 경계 실측**: 창 밖 에러 문서는 시각 조작 곤란 — 계정1 소유의 기존(30분+ 경과) frontend_errors 문서 활용을 기본안으로, 부재 시 **경계 조건 코드 리뷰 갈음** 승인.
4. **USER2_TOKEN(테스트 계정 2) 사용 승인**: 교차 계정 혼입 0 실증(PB-API-04)에 계정 2 세션의 에러 유발 필요 — bcast 테스트 계정 풀 내 2번째 계정 사용 확인.
5. **비GET 행 생성 방법**: 4000 에서 미존재 경로 무해 POST(404) 실패 1회 유발 — 부작용 0 전제 승인(불허 시 curl 분기·문자열은 코드 리뷰 갈음).
6. **deny-list 증분**: backend-dev 의 GET 부작용 실측 보고 접수 시 PB-API-02 에 차단 경로 400 케이스를 추가하는 조건부 문안 — 보고 결과 공유 요청(부작용 GET 존재 시 해당 경로는 프로브 대상 금지 목록에도 반영).

### planner 판정 (2026-08-19, 6건 전부 확정 — 해당 문안 반영 완료)

1. **BASE_REV = `c846923`** (v185 커밋 — planner git log 실측: 현재 HEAD, v186 워킹트리 미커밋). PB-API-07 ④ 는 `git diff c846923 --name-only` 워킹트리 기준 — 보류 해제.
2. **GET 외 400 요청 형식 — backend-dev 구현 확정 후 문안 고정 채택**(오케스트레이터 중계 방식 동의). PB-API-02 ⑤ 는 계약 접수 전 임시 보류(나머지 케이스는 실행 가능 — 부분 보류가 전체 게이트를 막지 않음).
3. **±30분 경계 — 기본안 채택 + 코드 리뷰 갈음 승인.** 계정1 소유 30분+ 경과 기존 문서(v185 잔존분 실재 — 시각상 자연 경과) 활용이 1순위, 부재 시 경계 비교 연산(`$gte/$lte`) 코드 리뷰 갈음(FAIL 아님·비고).
4. **USER2_TOKEN 승인** — 교차 계정 혼입 0 실증은 이 버전 개인정보 검증의 핵심(실측 가치 > 계정 추가 비용). bcast 테스트 계정 풀 2번째 사용, 크리덴셜 플레이스홀더·에러 유발은 무해 GET 404 계열만. 계정 2 생성이 필요하면 v177 관례(신설 기록 REPORT 기재) 준용.
5. **비GET 유발 — 무해 POST 404 1회 승인**(미존재 경로·부작용 0·인증 게이트 앞 404/401 어느 쪽이든 수집기 캡처만 확인). 불허 조건 소멸 — curl 분기 실측 우선, 코드 리뷰 갈음은 유발 실패 시 폴백.
6. **deny-list 증분 — 조건부 문안 채택**(중계 방식 동의). backend-dev 실측 보고 접수 시 PB-API-02 에 차단 400 케이스 추가 + 프로브 금지 목록 반영. 부작용 GET 부재 판명 시 증분 없음(비고만).

## 5. 실행 순서 권고 (tester 참고)

1. 데이터 준비: 테스트 신고 A/B 접수(`[v186-test]`)+계정1·2 에러 유발+비GET 이벤트(§4-5) → 기존 frontend_errors 스냅샷(PB-API-06 용)
2. PB-API-02 (SSRF — 발사 0 확인 선행) → PB-API-01 (core 3종) → PB-API-03 (쿨다운) → PB-API-04 (related — 교차 계정) → PB-API-05 (note) → PB-API-06 (fp v2 — 스냅샷 대조) → PB-API-07 (회귀+diff — BASE_REV 확정 후) → PB-API-08 (9004)
3. PB-UNIT-01→02→03 (같은 세션 콘솔 마감)
4. PB-E2E-01 (준비 데이터 재사용)
5. 종료: REPORT — probe_history·감사 issue_probe·테스트 신고/에러 표식 목록 기재(Mongo delete 없음), deny-list 실측 결과 반영 여부 명기

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| PB-API-01 | api | | verdict 3종·이력·감사·X-Admin-Probe 실측 |
| PB-API-02 | api | | SSRF 4케이스+deny-list 경로 400·발사 0·method:"POST" 400(curl 안내 메시지) — 우회 시 즉시 중단 |
| PB-API-03 | api | | 동일 url 429·타 url 통과·10초 해제 |
| PB-API-04 | api | | 본인 한정(계정2 혼입 0)·±30분 경계·빈 결과 |
| PB-API-05 | api | | note 단독 + 기존 status 회귀 + append 포맷 |
| PB-API-06 | api | | page 상이 2회 → 1묶음(v2)·비-api v1 유지·백필 없음 |
| PB-API-07 | api | | v185 대표·파일 계약·미오염·diff·package.json 0 |
| PB-API-08 | api | | 9004 2파일 identical + _logs 치환 diff 0 |
| PB-UNIT-01 | unit | | 지속 여부 열·배지·이력·429 안내 |
| PB-UNIT-02 | unit | | 버튼 분기·클립보드 실토큰 0건 |
| PB-UNIT-03 | unit | | 병치·자동 메모·짝 항목 2·콘솔·eslint |
| PB-E2E-01 | e2e | | 풀 여정 — 무해 GET 만·감사 잔존 기재 |

## v186 시나리오 집계

- 총 **12건** — [api] 8 / [unit] 3 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: probe_history·감사 issue_probe·테스트 신고 admin_note append·테스트 유발 에러 문서(`[v186-test]` 표식)뿐 — 전부 테스트 유래·잔존+REPORT(Mongo delete 불허 관행). 프로브는 무해 GET 3종 한정(쓰기 재발사·외부 URL 은 400 검증 대상이며 우회 관찰 시 즉시 중단). curl 실토큰 부재·related-errors 타 사용자 혼입 0 을 핵심 보안·개인정보 판정으로 승격. CS 발송·points 조정·광고 조작 0건.

## 개정 이력 (v186)

- 2026-08-19 초판 작성 (12건) — 코디네이터 필수 7축 전부 시나리오화(1→PB-API-01, 2→PB-API-02, 3→PB-API-03, 4→PB-API-04, 5→PB-API-05, 6→PB-API-06, 7→PB-UNIT-01~03·PB-E2E-01·PB-API-07(회귀)·PB-API-08(미러)). SSRF 우회·타 사용자 혼입을 즉시 중단 항목으로 지정, fp v2 는 기존 스냅샷 대조로 백필 부재까지 검증. BASE_REV·GET 외 형식·경계 실측·USER2_TOKEN·비GET 유발·deny-list 증분 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.
- 2026-08-19 planner 판정 반영 — §4 판정 블록 6건 확정(BASE_REV `c846923` / GET 외 400 형식은 backend 계약 접수 후 고정 — PB-API-02 ⑤ 부분 보류 / ±30분 기본안+코드 리뷰 갈음 / USER2_TOKEN 승인 — 교차 혼입 0 실증 핵심 / 비GET 무해 POST 404 승인 / deny-list 조건부 증분). 보류: PB-API-02 ⑤ 1건(backend 계약 대기 — 전체 게이트 비차단). dev 구현 완료·재기동 후 tester 착수 가능.
- 2026-08-19 backend 계약 접수 반영 (코디네이터 중계, test-designer 문안 고정) — ① PB-API-02 ⑤ 확정: body `{url, method:"POST"}` → 400 + "curl 복사를 이용하세요" 메시지(공백·제어문자·백슬래시 400 은 보조 스팟 비고) ② deny-list 확정 1건 `/api/rewards/admob-callback` → PB-API-02 ⑥ 400 케이스 추가+§0 프로브 대상 금지 목록 등재(그 외 부작용 GET 은 인증 게이트 401 원천 차단 — 수신측 스킵 불요 비고) ③ PB-API-01 verdict 명명 정합 확인(`indeterminate` 확정, 스펙 외 `unreachable` 은 정보성 비고). **§4 보류 0건 — 전 항목 확정.** tester 착수 시 테스트 admin 계정 pw 상태 확인 선행 권고(backend 전달 사항 — 문안 영향 없음).
- 2026-08-19 planner 중간확인·편차 판정 (1차 게이트 11/11 PASS 접수 후) — ① 버튼 분기 편차: **소픽스 채택**(GET 행 = [재확인]+[curl 복사] 병행 — TESTPLAN 원안대로 구현을 정정). 근거: auth_required(무인증 프로브의 판정 한계 지점)에서 관리자가 자기 인증 컨텍스트로 재현할 유일한 수단이 curl — 프로브 한계의 정확한 보완재(§4 판정의 무인증 채택과 설계 일관). 승인 목업의 "쓰기는 curl"은 쓰기 제약이지 GET 의 curl 금지가 아님(초과 제공 무해). frontend-dev 1줄 분기 완화 + tester 스모크(GET 행 병행 렌더+클립보드 실토큰 0 재확인) 후 E2E. ② PB-E2E-01 문안 유효 확정 — 게이트 중 코드 변경 0·잔존물 미종결 유지(재사용 설계 성립), 병행 문안 기준이라 소픽스 랜딩 후 오히려 완전 정합. ③ admin 계정 pw 이슈 재현 안 됨(3계정 정상) — 해소 상태 판명, REPORT 경위 기재만.

# v187 — 탭② 행 확장 UX 개선 + CS 대화 열기 픽스 정식 편입 (2026-08-19 15:12)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v187 §0 실측(A: 7열 무조건 렌더·확장 트리거 버튼 전용·`{repApi && …}` 미렌더 / B: a479669 diff 판독·페이지네이션이 실원인), §1 판정(빌드 표기 최소형·캐시 정책 불변), §2 설계, §5 테스트 항목 1~6, §6 강행 금지 6항
대상: frontend_admin 전용 — AdminIssuesPage(행 클릭 토글·접근성·선택 가드·api 부재 안내)·vite.config.js define·AdminLayout 빌드 표기·AdminCsPage **주석 정정 1~2줄만** + **소급 검증 대상 a479669**(admin_cs.py 9005/9004 신규 단건 조회·api.js·AdminCsPage 주입/스크롤 로직). **백엔드·사용자 앱·package.json 무변경**이 검증 대상
BASE_REV: **a479669**(코디네이터 지정 — git diff 기준)

## 0. 전제 및 안전 규칙

- **실사용자 CS 대화 발신·수정 절대 금지 — 열람만**(강행 금지 ①): cid 진입·대화 선택·렌더 확인까지만. **입력창에 타이핑·전송·상태 변경 금지**(입력창 "활성" 판정은 disabled 속성/포커스 가능 여부로 — 문자 입력 없이). 목록 밖 cid 검증은 **테스트 계정 대화(official↔`bcast_user_test`) 우선**, 페이지네이션 밖(30 밖 순번) 확보가 테스트 대화로 불가할 때만 실대화 **열람 전용**(§4-1 확인).
- **쓰기 0건 버전**: 프로브·발송·조정·신고 상태 변경 등 호출 금지(v186 회귀는 **읽기 케이스와 이미 적재된 데이터 확인**으로 구성). Mongo delete 불허 관행 승계.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`/`USER_TOKEN`/`TEST_CID`(테스트 계정 대화 id)/`FAR_CID`(목록 30건 밖 대화 id — 확보 절차 §4-1)/`GHOST_CID`(형식 유효·미존재). 실값 기재 금지.
- **구번들 오판 방지 선행 절차**(v187 사고 재발 방지): 모든 [unit]/[e2e] 착수 전 **하드 새로고침(Ctrl+Shift+R)** 후 사이드바 **빌드 표기 시각**을 확인·기록하고, 그 값이 현재 dev 기동/빌드 시각과 정합할 때만 판정에 사용(불일치 시 재로드 후 재확인 — 스크린샷에 빌드 표기 포함 권장).
- 판정 도구: devtools 네트워크(요청 계수)·DOM 검사(속성·스크롤 위치)·`window.getSelection()`·콘솔 grep.
- 환경: 9005·9004(백엔드 무변경 확인용)·frontend_admin Vite dev(4001)·사용자 앱 4000(무영향 확인). 추적자 `[AdminIssues]`·`[AdminCs]`.

## 1. [unit] 시나리오 — 탭② 행 확장·안내·빌드 표기 (4001 dev)

### CX-UNIT-01. 행 클릭 토글 + 버튼 이중 토글 없음 + 키보드 + 선택 가드 [unit] — 핵심
- Given: 관리자 로그인, `/issues` 탭②(에러 묶음 행 ≥2). §0 빌드 표기 확인 완료
- When: ① 행 본문(빈 셀 영역) 클릭 → 재클릭 ② 우측 **"발생 이력 ▼" 버튼** 클릭 ③ 행에 포커스(Tab) 후 **Enter**, 이어서 **Space** ④ 셀 텍스트를 **드래그로 선택한 뒤 마우스 업 지점에서 클릭** 하면
- Then:
  - ① 첫 클릭에 **펼침**, 재클릭에 **접힘**(토글 — 결함 ① 해소)
  - ② **한 번만 반응**(열림 1회 — 행 onClick 과 겹쳐 열렸다 닫히는 이중 토글 없음, `stopPropagation` 실증). 버튼 재클릭도 1회 반응으로 접힘
  - ③ Enter·Space 각각 토글 동작(접근성 — `role="button"`·`tabIndex=0` DOM 속성 실재 확인)
  - ④ **토글 무시**(드래그 선택 직후 클릭에 펼침/접힘 없음 — `getSelection()` 가드), 선택된 텍스트는 유지
  - 전 과정 콘솔 신규 에러 0건·확장 시 이력 lazy 호출은 v186 관행대로 1회

### CX-UNIT-02. api 부재 안내 + api 보유 그룹 v186 회귀 [unit] — 핵심
- Given: 탭②에 **api 정보 없는 그룹**(예: `[DmSocket] socket error` — 부재 시 비-api 콘솔 에러 유발로 확보, §4-3)과 **api 보유 그룹**(v186 테스트 fp) 동시 존재
- When: ① api 부재 그룹 확장 ② api 보유 그룹 확장 하면
- Then:
  - ① **안내 문구 렌더** — "재호출할 API 정보가 없는 에러입니다(콘솔·소켓 오류 등) — 재확인·재현 명령을 제공할 수 없습니다." 취지, **[지금 재확인]·[재현 명령 복사] 버튼 부재**(부재 사유가 화면에서 설명됨 — 결함 ② 해소). 이력 리스트는 정상 렌더
  - ② **v186 동작 불변** — [지금 재확인]+[재현 명령 복사] **병행 노출**, 지속 여부 열·배지 규약 유지(클릭 실행은 CX-UNIT-04 회귀에서 판단 — 이번 버전 프로브 실행은 하지 않음, §0)
  - 헤더 **7열**(에러 요약/발생 수/영향 사용자/최근 발생/페이지/지속 여부/이력) 렌더 확인(구번들 5열 아님 — §0 절차와 교차)

### CX-UNIT-03. 빌드 표기 [unit]
- Given: 관리자 앱 4001, 사용자 앱 4000
- When: ① 사이드바 푸터 확인 ② 표기 요소의 title 속성 확인 ③ dev 재기동(또는 재빌드) 후 재확인 ④ 4000 확인 하면
- Then: ① `빌드 {MM-DD HH:mm}` 소형 텍스트 렌더 ② **title 툴팁 문구 존재**("화면이 최신이 아니면 Ctrl+Shift+R" 취지 + dev 에서는 서버 기동 시각 의미 병기 — §6 리스크) ③ 값 **갱신**(이전 기록값과 상이) ④ 사용자 앱 **무영향**(표기 없음·변경 없음 — 관리자 앱 한정).

### CX-UNIT-04. v186·기존 화면 회귀 + 콘솔 + eslint [unit]
- Given: 관리자 로그인
- When: ① 탭② 지속 여부 열·이력·curl 복사(**클립보드 문자열에 실토큰 부재** 재확인 — 클릭만, 프로브 실행 없음) ② 탭① 신고 인박스 목록·상세(관련 에러 병치·자동 메모 기록 잔존 확인 — 신규 상태 변경 없음) ③ `/logs` 짝 항목 라벨("오류 재확인"·"오류신고 상태 변경") ④ **기존 8메뉴 순회** ⑤ 콘솔 grep·eslint 하면
- Then: ①~④ v185~186 판정 기준 그대로 렌더·동작(행 클릭 토글 추가가 기존 UI 계약 훼손 없음), 사이드바 active 정상 ⑤ 콘솔에 대화 본문·신고 본문·닉네임·이메일·토큰 **0건**(건수/status/cid 앞 8자 수준만)·신규 에러 0건, eslint 신규 0.

## 2. [api] 시나리오 — B 소급 검증(단건 조회)·회귀·개인정보

### CX-API-01. 신규 `GET /api/admin/cs/conversations/{cid}` 4케이스 + 미러 [api] — 핵심
- Given: `ADMIN_TOKEN`/`USER_TOKEN`/토큰 없음, `TEST_CID`·`GHOST_CID`
- When: ① 무토큰 ② `USER_TOKEN` ③ `GHOST_CID`(미존재) ④ `TEST_CID` 정상 ⑤ `diff backend_9005/app/routes/admin_cs.py backend_9004/app/routes/admin_cs.py` ⑥ **9004** 무토큰 401 대표 하면
- Then: ① **401** ② **403** ③ **404** ④ **200** — 응답이 **목록 행과 동일 형태**(peer 닉네임#code·프로필·최근 메시지·시각 등 목록 사양 필드 집합 일치, 추가 개인정보 없음) ⑤ **diff 0**(a479669 미러 완료 재확인) ⑥ 9005 와 동일 401. **비공식(official 무관) 대화 접근 케이스**가 구현상 403/404 중 무엇인지 관측·기록(§4-4).

### CX-API-02. 개인정보 — 응답·서버 로그·콘솔 3면 [api] — 핵심 (위반 시 즉시 중단)
- Given: CX-API-01 응답 전문 + CS 열람 구간의 서버 로그·브라우저 콘솔
- When: ① 단건 조회 응답 전문 검사 ② 서버 로그 grep(대화 본문·이메일·연락처) ③ 콘솔 grep 하면
- Then: ① **필요 필드 외 개인정보 부재** — peer 닉네임#code·프로필 이미지는 **기존 목록 사양(허용)**, 이메일·전화·생년월일 등 0건 ② 서버 로그에 **대화 본문 원문 0건**(cid·건수 수준만) ③ 콘솔 동일(§0 판정 기준). 위반 시 즉시 중단·planner 보고.

### CX-API-03. 회귀 — v186 대표 + git diff 매트릭스 [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, BASE_REV `a479669`
- When: ① v186·v185 대표 재실행(읽기) — 인박스 목록/summary·errors 묶음(+last_probe)·프로브 **SSRF 400 1케이스**(발사 0 — 무해)·**파일 로그 계약**(`POST /api/_logs/frontend` 응답·frontend.log append 포맷 불변) ② admin 대표(cs conversations 목록·logs) ③ `git diff a479669..HEAD --name-only` 하면
- Then: ①② 전부 기존 TESTPLAN 판정 기준 PASS(프론트 전용 버전이므로 서버 동작 완전 불변) ③ 변경 파일이 **PLAN §3 매트릭스와 정확 일치** — AdminIssuesPage.jsx/.css·vite.config.js·AdminLayout(+css)·AdminCsPage(**주석 라인만** — diff 내용이 로직 변경 없음을 코드 리뷰로 확인, 강행 금지 ④) 뿐이고 **백엔드 전체·사용자 앱 전체·package.json/lock 부재**. 초과 파일·로직 변경 발견 시 즉시 중단·보고.

## 3. [e2e] 시나리오 — CS 대화 열기 정식 검증 (열람 전용)

### CX-E2E-01. cid 진입 6종 여정 — 목록 밖 대화 열림·폴링 유지·스크롤·무시·회귀 [e2e] — 핵심 (열람만, 발신 0)
- Given: 관리자 로그인. `FAR_CID` 확보(§4-1 — 목록 첫 페이지 30건 **밖** 순번, 예: 133개 중 118번째), `GHOST_CID`
- When: ⓐ `/cs?cid={FAR_CID}` 진입 → ⓑ 그대로 **15초 이상 대기**(폴링 12초 주기 경과) → ⓒ 좌측 목록에서 선택 행 위치 확인 → ⓓ `/cs?cid={GHOST_CID}`(및 형식 오류 cid) 진입 → ⓔ `/cs`(무쿼리) 진입 하면
- Then:
  - ⓐ **대화창 열림** — 상대 **닉네임 표시**·메시지 렌더·**입력창 활성**(disabled 아님 — **타이핑·전송 금지**, 속성/포커스로만 판정)
  - ⓑ 폴링 경과 후에도 **선택 유지**(주입분 미소실 — `injectedConvRef` 동작), 서버 목록에 등장 시에도 중복 행 없음
  - ⓒ 선택 행이 **목록에서 보이도록 스크롤**(scrollIntoView 1회 — 사용자가 스크롤한 뒤 폴링마다 재강제되지 않음도 관측·기록)
  - ⓓ **조용히 무시** — 크래시·에러 배너 없이 기본 화면(대화 미선택 상태) 정상 렌더, 콘솔 신규 에러 0건
  - ⓔ **무쿼리 진입 회귀 불변** — 기존 목록·선택 동작 그대로(v185 IS-UNIT-03 판정 기준)
- 안전 경계: `FAR_CID` 가 실사용자 대화일 경우 **열람만**(발신·수정·상태 변경 절대 금지), 스크린샷은 대화 본문이 식별되지 않도록 목록·상단 위주로 촬영(§4-2).
- 증적: 목록 밖 cid 진입 직후·15초 후·스크롤 위치·잘못된 cid 화면·무쿼리 화면 스크린샷(+빌드 표기 포함).

## 4. planner 확인 필요 사항

1. **`FAR_CID` 확보 방법**: 테스트 계정 대화가 목록 첫 페이지(30건) 안에 있으면 "목록 밖" 조건을 만족 못 함 — (a) 테스트 계정 대화를 오래된 순번으로 확보 가능한지 (b) 불가 시 실사용자 대화 1건을 **열람 전용**으로 사용(발신·수정 금지, 본문 미기재) 중 판정 요청. 초안은 (a) 우선·(b) 조건부.
2. **증적 스크린샷의 본문 노출**: 실대화 열람 시 화면에 본문이 보임 — 캡처 범위 제한(목록·헤더 위주) + REPORT 에 본문·닉네임 미기재 방침 승인 요청.
3. **api 부재 그룹 확보**: 현재 `[DmSocket] socket error` 류 그룹이 없으면 4000 에서 **무해한 console.error 1회 유발**(비-api 이벤트 — v186 PB-API-06 ② 방식)로 생성. 유발 승인 및 잔존(표식 `[v187-test]`) 확인.
4. **비공식 대화 접근 기대값**: CX-API-01 의 "official 무관 대화" 케이스가 403 인지 404 인지 구현 확정값 회신(초안은 관측·기록으로 처리).
5. **빌드 표기 갱신 검증 방법**: dev 재기동으로 값 변경 확인이 기본안 — 재기동이 다른 시나리오 실행에 방해되면 CX-UNIT-03 ③ 을 마지막 순서로 배치(초안 실행 순서 반영). 별도 프로덕션 빌드 검증 요구 여부 회신.
6. **프로브 실행 0건 방침**: 이번 버전은 UI 회귀만이므로 [지금 재확인] **클릭 실행 없이** 버튼 노출·문구만 판정(무해 GET 이지만 이력·감사 증가 회피). 실행 포함을 원하면 회신(테스트 fp 한정).

### planner 판정 (2026-08-19, 6건 전부 확정 — 해당 문안 반영 완료)

1. **FAR_CID = (a) 우선, (b) 열람 전용 승인.** 정렬이 last_at desc 라 테스트 계정 대화는 상단으로 오기 쉬워 (a) 성립이 어려울 수 있음 — **실패 시 (b) 실사용자 대화 1건 열람 전용 승인**(진입·선택·속성 판정만, **발신·상태 변경·메시지 입력 절대 금지**, 사용자가 겪은 조건과 동일 재현이 목적). 판정 요소는 "대화창 열림·입력창 활성·메시지 렌더 여부"뿐이며 본문 내용은 판정 대상 아님.
2. **캡처 범위 제한 + REPORT 본문·닉네임 미기재 승인** — 증적은 목록/헤더/입력창 활성 범위로 한정, 대화 본문 영역은 마스킹 또는 프레임 밖. cid 는 앞 8자만 기재.
3. **api 부재 그룹 — 유발 불요**(오케스트레이터 실측: `[DmSocket] socket error` 그룹 실재·확장 시 프로브 바 미렌더 확인). 기존 그룹 재사용 — 신규 유발·잔존물 0. 만약 기간 필터로 안 보이면 days 확대(7→30/90)로 확보, 그래도 부재 시에만 무해 console.error 1회 유발(`[v187-test]` 표식).
4. **비공식 대화 접근 기대값 — 코드 실측 확정**: `_assert_official_conversation`(admin_cs.py) — **미존재/무효 cid → 404**("대화를 찾을 수 없습니다"), **공식 계정 미참여 대화 → 403**("공식 계정 대화가 아닙니다"). 신규 `GET /conversations/{cid}` 가 이 헬퍼를 그대로 재사용하므로 CX-API-01 기대값을 이 값으로 **고정**(관측·기록이 아닌 판정 기준). 무토큰 401·비관리자 403(get_admin_user)은 별도.
5. **빌드 표기 — dev 재기동 기본안 채택, 프로덕션 빌드 검증 범위 밖.** CX-UNIT-03 ③ 을 실행 순서 마지막 배치(초안 그대로). dev 에서는 "서버 기동 시각" 의미임을 판정 시 감안(PLAN §6 리스크).
6. **프로브 실행 0건 방침 채택** — 노출·문구만 판정(이력·감사 증가 회피, v186 에서 실행 경로는 이미 12/12 검증 완료라 중복 가치 낮음).

## 5. 실행 순서 권고 (tester 참고)

1. 선행: 하드 새로고침 + **빌드 표기 시각 기록**(§0 — 구번들 오판 방지) → `FAR_CID`·`GHOST_CID` 확보(§4-1 확정 후)
2. CX-API-01→02 (단건 조회·개인정보) → CX-API-03 (회귀+diff — BASE a479669)
3. CX-UNIT-01→02(→ §4-3 확정 시 api 부재 그룹 유발 선행)→CX-UNIT-04 (회귀·콘솔·eslint)
4. CX-E2E-01 (cid 6종 — 열람만)
5. 마지막: CX-UNIT-03 ③(dev 재기동 후 빌드 표기 갱신 확인)
6. 종료: REPORT — 빌드 표기 관측값·`FAR_CID` 성격(테스트/실대화 열람)·유발한 비-api 이벤트 표식·프로브 미실행 사유 기재(본문·개인값 미기재)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| CX-UNIT-01 | unit | | 행 토글·버튼 1회 반응·Enter/Space·선택 가드 |
| CX-UNIT-02 | unit | | api 부재 안내 문구·버튼 부재 / api 보유 v186 병행 노출·7열 |
| CX-UNIT-03 | unit | | 빌드 표기·title 안내·재기동 갱신·4000 무영향 |
| CX-UNIT-04 | unit | | v186 탭②·인박스·짝 항목·8메뉴·콘솔 0·eslint 0 |
| CX-API-01 | api | | 401/403/404/200(목록 동일 형태) + 9004 diff 0 |
| CX-API-02 | api | | 응답·서버 로그·콘솔 본문/개인정보 0건 |
| CX-API-03 | api | | v186·v185 대표 불변 + diff 매트릭스(주석만·백엔드 부재) |
| CX-E2E-01 | e2e | | 목록 밖 cid 열림·폴링 유지·스크롤·무시·무쿼리 회귀 — 열람만 |

## v187 시나리오 집계

- 총 **8건** — [api] 3 / [unit] 4 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: **0건 설계** — CS 는 열람만(발신·수정·상태 변경 금지), 프로브·발송·조정 호출 없음, 신고 상태 변경 없음. 유일한 데이터 생성 가능성은 §4-3 승인 시 비-api console.error 1건(표식·잔존). 개인정보는 응답·서버 로그·콘솔 3면 + 증적 캡처 범위 제한으로 관리 — 위반 시 즉시 중단.

## 개정 이력 (v187)

- 2026-08-19 초판 작성 (8건) — 코디네이터 필수 6축 전부 시나리오화(1→CX-UNIT-01, 2→CX-UNIT-02, 3→CX-UNIT-03, 4→CX-API-01·CX-E2E-01(ⓐ~ⓕ 6종 분배), 5→CX-API-03·CX-UNIT-04, 6→CX-API-02). PLAN §5 의 CS 6종을 [api](ⓕ)+[e2e](ⓐ~ⓔ)로 분리 배치하고, 구번들 오판 재발 방지를 위해 **빌드 표기 확인을 전 시나리오 선행 절차**로 §0 에 명문화. BASE_REV=a479669 지정 반영. FAR_CID 확보·증적 캡처 범위·api 부재 그룹 유발·비공식 대화 기대값·빌드 갱신 검증·프로브 미실행 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.
- 2026-08-19 planner 판정 반영 — §4 판정 블록 6건 확정(FAR_CID (a) 우선·(b) 열람 전용 승인(발신 금지) / 캡처 범위·본문 미기재 승인 / api 부재 그룹 기존 재사용(유발 불요) / **비공식 대화 404·403 코드 실측 고정** / 빌드 표기 dev 재기동 기본안·프로덕션 범위 밖 / 프로브 실행 0건 채택). 보류 0건 — frontend-dev 구현 완료 후 tester 착수 가능(§0 하드 새로고침+빌드 표기 기록 선행 절차 준수).

# v188 — 시각 9시간 밀림 픽스 + 탭② 열 가시성 + 신고 위치 추적(A+B) (2026-08-19 16:03)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v188 §0 실측(`_iso` naive 직렬화 — admin_issues:104·**admin_ads:74 동일 버그**·dm_service 선례 정상 / `_page_path` 호스트 보존 → 1259px scrollWidth 1654 / recent_pages 부재), §1 판정 3건(공용화 미실시·스키마 5개 sessionStorage·페이지 표시 전역 통일), §2 설계, §5 테스트 항목 1~7, §6 강행 금지 7항
대상: backend_9005 `admin_issues.py`·`admin_ads.py` `_iso` tz 명시 + `issues.py` recent_pages 수신·재검증·저장(9004 미러 3파일) / 사용자 앱 `recentPages.js` 신설·라우터 훅·ReportIssueModal 전송 / 관리자 앱 AdminIssuesPage formatPagePath·page 셀·"직전 동선"·"신고한 화면" 라벨. **`_logs.py`·dm_service·admin_cs/points·package.json 무변경**이 검증 대상
BASE_REV: **28679d0**(코디네이터 지정 — git diff 기준)

## 0. 전제 및 안전 규칙

- **선행 절차(v187 승계·필수)**: 모든 [unit]/[e2e] 착수 전 **하드 새로고침(Ctrl+Shift+R)** 후 사이드바 **빌드 표기 시각 기록**·정합 확인(구번들 오판 방지). 증적 스크린샷에 빌드 표기 포함 권장.
- **테스트 계정 한정·표식**: 신고 접수 본문은 `[v188-test]` prefix, 사용자 앱 동선 유발은 테스트 계정 세션에서만. **실사용자 신고·CS 대화 수정 금지(열람만)**. **프로브 클릭 0건**(v187 방침 승계 — probe 관련은 이미 적재된 데이터의 시각 표기 확인만). Mongo delete 불허 — 테스트 유래 문서 잔존+REPORT id/표식 기재.
- **크리덴셜 플레이스홀더**: `ADMIN_TOKEN`/`USER_TOKEN`(테스트 계정)/`TEST_ISSUE_ID`/`SEED_ADV_ID`(광고 회귀 — 읽기 전용). 실값 기재 금지.
- **시각 판정 기준**: 서버 UTC 실측값(레코드 저장값) 대비 화면 KST = UTC+9, 허용 오차 **±1분**. 판정 시 tester 로컬 TZ 가 KST 인지 먼저 확인(다르면 비고 기록 후 UTC+9 환산 기준 판정).
- **레이아웃 판정 기준**: 창 **내부 폭 1259px**(devtools 로 innerWidth 고정) 에서 탭② 표 `scrollWidth ≤ clientWidth` + **7개 th 각각 `getBoundingClientRect().right ≤ innerWidth`**. 허용 오차 ±1px(서브픽셀 — v179 관행).
- 환경: 9005·9004, 사용자 앱 4000·관리자 앱 4001. 추적자 `[admin-issues]`·`[admin-ads]`·`[issues]`·`[RecentPages]`·`[ReportIssue]`·`[AdminIssues]`.

## 1. [api] 시나리오 — tz 표기·recent_pages·회귀

### TZ-API-01. tz 표기 — admin_issues·admin_ads 전 시각 필드 + 구조 불변 [api] — 핵심
- Given: `ADMIN_TOKEN`. 수정 전 응답 스냅샷(있으면 v187 실행분 재사용 — 없으면 키 집합만 기존 TESTPLAN 기준으로 대조)
- When: ① 신고 목록·상세(`created_at`, `handled_at`) ② errors 묶음(`last_seen`)·이력(`created_at`) ③ probe 이력(`probed_at`, `created_at` — 기적재분 조회만) ④ **admin_ads 대표**: 광고주 목록·상세(`created_at` 계열)·items 행 각각 호출하면
- Then:
  - ①~④ **모든 시각 필드 문자열이 `+00:00` 또는 `Z` 로 끝남**(tz 표기 존재 — naive 직렬화 부재)
  - **값 자체 동일**: 날짜·시분초 부분이 수정 전과 동일(접미사만 추가 — UTC 재해석·시프트 없음). 대조 방법: 동일 레코드의 Mongo 저장값(UTC)과 응답의 `YYYY-MM-DDTHH:MM:SS` 부분이 일치
  - **응답 구조 불변**: 키 집합·필드 순서·타입 기존과 동일(추가/삭제 0 — 강행 금지 ①)
  - 4계열(신고·에러·프로브·광고) 전부 커버됐는지 체크리스트로 기록

### TZ-API-02. recent_pages 정상 저장 [api] — 핵심
- Given: `USER_TOKEN`(테스트 계정), 사용자 앱에서 **3~5개 경로 이동 후 신고 접수**(TZ-E2E-01 과 연계 — 본문 `[v188-test]`)
- When: 접수 후 Mongo issue_reports 문서와 관리자 상세 응답을 확인하면
- Then: `recent_pages` == `[{path, at}]` — **최신순**·**≤5개**·각 path 는 **pathname(+마스킹 쿼리)**·`at` ISO8601. **중복 연속 경로 미중복**(같은 경로 연속 이동은 시각 갱신만). **민감 쿼리 마스킹**: `?token=`/`?api_key=` 포함 경로를 거쳐도 값 원문 부재. 관리자 상세 응답에도 동일 배열 포함(additive).

### TZ-API-03. recent_pages 방어 — 절단·무시·200 [api] — 핵심
- Given: `USER_TOKEN`
- When: 직접 `POST /api/issues` 로 ① `recent_pages` **6개 이상**(예: 8개) ② path **200자 초과** 항목 포함 ③ 문자열 `"abc"` ④ 숫자 `123` ⑤ `null` ⑥ 객체 배열 아님(`[1,2,3]`) ⑦ **필드 미포함**(구버전 앱 시뮬) 하면
- Then: **전부 접수 200/201 성공**(500·400 없음 — 실패 격리 원칙):
  - ① 저장값 **5개로 절단**(최신 5 유지) ② path **200자로 절단** ③~⑥ **무시**(recent_pages 미저장 또는 빈 배열 — 접수는 성공) ⑦ 정상 접수·필드 부재
  - 어떤 케이스도 다른 필드(reason/text/page_url) 저장에 영향 없음

### TZ-API-04. 회귀 — v185~187 대표 + 미러 + diff [api] — 회귀 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, BASE_REV `28679d0`
- When: ① v185~186 대표(접수 201·인박스 목록/summary·errors 묶음+last_probe·**파일 로그 계약**: `POST /api/_logs/frontend` 응답·frontend.log append 포맷 불변·SSRF 400 1케이스(발사 0)) ② v187 대표(`GET /api/admin/cs/conversations/{TEST_CID}` 200·401/403/404) ③ `diff` 9005↔9004 — admin_issues.py·admin_ads.py·issues.py ④ `git diff 28679d0..HEAD --name-only` 하면
- Then: ①② 기존 TESTPLAN 판정 기준 그대로 PASS(tz 접미사 외 동작 불변) ③ 3파일 **diff 0**(byte-identical) ④ 변경 파일 == PLAN §3 매트릭스 정확 일치 — `_logs.py`·dm_service·admin_cs/points·**package.json/lock 부재**. 초과 파일 시 즉시 중단·보고.
- 보조: **fp 묶음 무영향** — 표시 전용 변환이므로 기존 fp·묶음 count 불변(탭② 대표 그룹 1건 대조, §6 리스크 항목).

### TZ-API-05. 개인정보·서버 로그 위생 [api] — (위반 시 즉시 중단)
- Given: TZ-API-01~03 구간의 백엔드 로그, 관리자 응답 전문
- When: ① 서버 로그 grep — 신고 본문·**recent_pages 경로 원문**·마스킹 대상 쿼리값·이메일 ② 응답 전문 검사 하면
- Then: ① **0건** — `[issues]` 로그는 **개수만**(경로 원문 미출력, PLAN §4 지시)·`[admin-issues]`/`[admin-ads]` 는 건수·id 수준 ② 관리자 응답은 표시 사양 필드만(경로는 신고 진단 목적의 저장값 — 허용, 단 토큰/키 값은 마스킹 상태). 위반 시 즉시 중단·planner 보고.

## 2. [unit] 시나리오 — 레이아웃·표시·라벨 (4001 dev)

### TZ-UNIT-01. 1259px 가시성 — 7열 전부 화면 안 [unit] — 핵심
- Given: 관리자 로그인, `/issues` 탭②. §0 선행 절차 완료, devtools 로 **innerWidth 1259px** 고정
- When: 표 레이아웃을 측정하면
- Then: ① 표 `scrollWidth ≤ clientWidth`(가로 스크롤 없음) ② **7개 th 각각 `right ≤ innerWidth`**(에러 요약/발생 수/영향 사용자/최근 발생/페이지/**지속 여부**/**이력** — 사용자 캡처에서 잘리던 우측 2열 포함, ±1px) ③ page 셀이 **경로만 표시**(스킴·호스트 제거)+말줄임(max-width·ellipsis)+**title 에 원문 URL 보존**(DOM 속성 확인) ④ **1024px 로 축소** 시 가로 스크롤은 허용하되 **열 손실·헤더 붕괴 없음**(7열 유지).

### TZ-UNIT-02. 페이지 표시 정책 전역 통일 [unit]
- Given: 탭② 이력 행·관련 에러 행(신고 상세)·신고 상세 본문
- When: 각 지점의 페이지 표기를 확인하면
- Then: **동일 정책**(경로만+말줄임+title 원문) 적용 — 탭② 목록·행 확장 이력·신고 상세 관련 에러·"신고한 화면" 값 전부. 빈 값은 `-`. 어느 지점도 스킴·호스트 노출로 폭 폭증을 일으키지 않음.

### TZ-UNIT-03. 라벨 "신고한 화면" + "직전 동선" 블록 [unit] — 핵심
- Given: 신고 상세 — ① recent_pages 보유 신고(TZ-API-02) ② 미보유 신고(v185~187 기존 신고)
- When: 상세를 확인하면
- Then: ① 기존 "페이지" 라벨이 **"신고한 화면"** 으로 표기(값 == 제출 시점 경로 — 기존 동작 불변) + **"직전 동선" 블록**에 경로+시각이 **최신순으로 순서대로** 렌더(시각은 KST — TZ-E2E-02 와 교차) ② 동선 없는 신고는 **규칙대로 처리**("기록 없음(구버전 앱에서 접수)" 취지 문구 또는 블록 미표시 — 구현 확정값 관측·기록, 크래시·빈 블록 잔재 없음).

### TZ-UNIT-04. v187 회귀 + 콘솔 + eslint [unit]
- Given: 관리자 로그인
- When: ① 탭② **행 클릭 토글**·"발생 이력 ▼" 1회 반응·Enter/Space·드래그 선택 가드 ② **api 부재 안내 문구**·api 보유 그룹 [지금 재확인]+[재현 명령 복사] 노출(**클릭 실행 없음**) ③ 빌드 표기·기존 8메뉴 순회 ④ 콘솔 grep(신고 본문·경로 원문·닉네임·이메일·토큰)·eslint 하면
- Then: ①~③ v187 판정 기준 그대로(page 셀 변경이 행 클릭·확장 UX 훼손 없음) ④ 콘솔 **0건**(건수·status 수준만)·신규 에러 0·eslint 신규 0.

## 3. [e2e] 시나리오 — 2건

### TZ-E2E-01. recent_pages 여정 — 이탈 후 신고에도 오류 페이지 보존 [e2e] — 핵심 (이번 개선의 핵심 가치)
- Given: 사용자 앱(4000) 테스트 계정 로그인. sessionStorage 초기 상태 기록
- When: ① 3~5개 경로 이동(마지막에 **오류가 난 페이지 A** 방문) → ② **A 를 이탈해 메인으로 이동** → ③ 메인에서 신고 모달로 접수(본문 `[v188-test] 동선 검증`) → ④ (별도 세션) 경로 이동 후 **새로고침(F5)** → 신고 접수 하면
- Then:
  - ③ 접수 성공 + 관리자 상세 "직전 동선"에 **A 가 남아 있음**(신고한 화면 = 메인, 동선 = …→A→메인 순서대로) — **오류 페이지 이탈 후 신고해도 진단 가능**(핵심 가치 실증)
  - ④ **새로고침 후에도 동선 보존**(sessionStorage 링버퍼 — 탭 유지 시 소멸 없음), 접수 문서에 반영
  - 이동 경로 수가 5 초과여도 최신 5개만·순서 정확. 마스킹 대상 쿼리를 포함한 경로를 1회 경유해 **값 마스킹**을 화면·저장 양쪽에서 확인(TZ-API-02 교차)
- 안전: 유발 이동은 무해한 조회 경로만(쓰기 화면에서 제출 금지).

### TZ-E2E-02. KST 표시 실증 — 9시간 해소 + 광고 화면 회귀 [e2e] — 핵심
- Given: TZ-E2E-01 의 접수 직후(접수 시각을 **기록**: tester 로컬 시계 + 서버 UTC 저장값), `SEED_ADV_ID`(읽기 전용)
- When: ① 관리자 `/issues` 목록·상세의 접수 시각 ② 탭② **최근 발생**(기적재 에러) ③ 프로브 이력 시각(기적재분 — 클릭 실행 없음) ④ **v184 광고주 화면 1지점**(상세 items `created_at` 등) 확인하면
- Then: ①~④ 전부 **화면 표시 = 실제 KST(±1분)** — 저장 UTC + 9시간과 일치, **9시간 밀림 해소 실증**(수정 전 증상: UTC 값이 그대로 KST 로 표시돼 9시간 이름). 특히 ① 은 방금 접수라 tester 로컬 현재 시각과 근사(±1분). ④ 는 v184 화면의 다른 요소(목록·상세 블록)도 정상 렌더(회귀 — 값 시프트 외 변화 없음).
- 증적: 접수 직후 상세 시각·탭② 최근 발생·광고 화면 시각 스크린샷(+빌드 표기·로컬 시계 확인 가능한 형태).

## 4. planner 확인 필요 사항

1. **tz 수정 전 스냅샷 확보**: TZ-API-01 의 "값 자체 동일" 판정은 수정 전 응답과의 대조가 이상적이나 이미 구현 랜딩 시 불가 — **Mongo 저장값(UTC) 직접 대조**를 기본 판정으로 설계. DB 읽기 1회(신고·에러·광고 각 1건) 승인 확인.
2. **tester 로컬 TZ**: KST 전제(±1분 판정). 실행 환경이 UTC 등이면 판정식을 "저장 UTC+9 == 화면" 으로 유지하되 비고 기록 — 확인 요청.
3. **직전 동선 미보유 신고의 표시 규칙**: PLAN §2 는 "기록 없음(구버전 앱에서 접수)" 문구, 구현이 블록 미표시일 수 있음 — 구현 확정값 회신(초안은 관측·기록 처리).
4. **광고 화면 회귀 1지점 지정**: `SEED_ADV_ID` 상세의 어느 시각 필드를 대표로 볼지(items created_at 기본안) 확정 요청 — 실광고주 데이터는 **읽기 전용**.
5. **TZ-API-03 직접 POST 승인**: 방어 검증은 모달 우회 직접 호출이 필요(6개 초과·비정상 타입) — 테스트 계정 토큰으로 7케이스 접수(성공 케이스는 `[v188-test]` 표식 문서 생성·잔존) 승인 확인.
6. **프로브 클릭 0건 유지**: v187 방침 승계로 probed_at 시각 검증은 **기적재 이력** 사용 — 기적재 프로브 이력이 없으면 해당 필드 검증을 SKIP(코드 리뷰 갈음)할지 회신.

### planner 판정 (2026-08-19, 6건 전부 확정 — 문안 반영)

1. **Mongo 저장값(UTC) 직접 대조 채택 + DB 읽기 승인**(신고·에러·광고 각 1건). 수정 전 스냅샷보다 견고하다는 판단에 동의 — 저장 UTC 와 응답 tz-aware 값이 **동일 순간**을 가리키는지가 판정식(문자열 동일이 아니라 시각 동일).
2. **tester 로컬 TZ = KST 확정**(planner `date` 실측 `KST +0900`). ±1분 기준 그대로. 다른 TZ 환경이면 "저장 UTC+9 == 화면" 유지+비고.
3. **직전 동선 미보유 표시 = 블록 미표시 채택**(오케스트레이터 의견 동의 — 구버전 접수 건에 "기록 없음" 문구는 노이즈). **PLAN §2 ③A 표시 문안을 이 판정으로 정정**(문구 표시 → 데이터 있을 때만 블록 렌더). frontend 계약이 다르면 오케스트레이터 중계로 문안 고정.
4. **광고 회귀 1지점 = `SEED_ADV_ID` 상세 items created_at 확정**(읽기 전용). 광고 데이터 쓰기·숨김 금지(v184 승계).
5. **TZ-API-03 직접 POST 7케이스 승인** — 모달 우회는 방어 검증의 유일 경로. `[v188-test]` 표식·성공 케이스 잔존은 REPORT 기재.
6. **프로브 클릭 0건 유지 + 기적재 이력 사용 확정** — v186 잔존 probe_history 15건 실재(REPORT v186 기재)이므로 probed_at 검증 가능. 만약 조회 결과 부재 시에만 코드 리뷰 갈음+비고(SKIP 아님).

## 5. 실행 순서 권고 (tester 참고)

1. 선행: 하드 새로고침+빌드 표기 기록, 로컬 TZ 확인(§4-2) → TZ-API-01(tz — DB 대조) → TZ-API-05(로그 위생 일부 선점)
2. TZ-E2E-01 (사용자 앱 동선·접수 — 시각 기록) → TZ-API-02 (저장 검증) → TZ-API-03 (방어 7케이스) → TZ-E2E-02 (KST 실증·광고 회귀)
3. TZ-UNIT-01 (1259px 측정) → TZ-UNIT-02→03 → TZ-UNIT-04 (v187 회귀·콘솔·eslint)
4. TZ-API-04 (회귀·미러·diff — BASE 28679d0) → TZ-API-05 마감(전 구간 로그 재검사)
5. 종료: REPORT — 생성한 `[v188-test]` 신고 id 목록·recent_pages 관측치(경로는 마스킹 상태로만)·빌드 표기·1259px 측정값 기재. 개인값·본문 미기재

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| TZ-API-01 | api | | 4계열 tz 표기·값 동일(DB 대조)·구조 불변 |
| TZ-API-02 | api | | 최신순·5 상한·마스킹·중복 미중복·상세 포함 |
| TZ-API-03 | api | | 6개↑ 절단·200자 절단·비정상 타입 무시·미포함 — 전부 200 |
| TZ-API-04 | api | | v185~187 대표·미러 3파일 diff 0·매트릭스·fp 무영향 |
| TZ-API-05 | api | | 서버 로그 경로 원문·본문 0건 — 위반 시 중단 |
| TZ-UNIT-01 | unit | | 1259px 7열 가시·scrollWidth≤clientWidth·title 원문·1024px 열 유지 |
| TZ-UNIT-02 | unit | | 페이지 표시 정책 4지점 통일 |
| TZ-UNIT-03 | unit | | "신고한 화면" 라벨·"직전 동선" 순서·미보유 규칙 |
| TZ-UNIT-04 | unit | | v187 행 클릭·안내·빌드 표기·콘솔 0·eslint 0 |
| TZ-E2E-01 | e2e | | 이탈 후 신고에도 오류 페이지 보존·새로고침 보존 |
| TZ-E2E-02 | e2e | | KST 정확(±1분) 4지점·광고 화면 회귀 |

## v188 시나리오 집계

- 총 **11건** — [api] 5 / [unit] 4 / [e2e] 2 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: `[v188-test]` 신고 접수(여정 1 + 방어 케이스 성공분 — 테스트 계정 한정, 잔존+REPORT)뿐. 프로브 클릭 0건·실사용자 신고/대화 수정 0건·광고는 읽기 전용·Mongo delete 없음. 개인정보는 서버 로그·콘솔·응답 3면 + recent_pages 마스킹으로 관리(위반 시 즉시 중단).

## 개정 이력 (v188)

- 2026-08-19 초판 작성 (11건) — 코디네이터 필수 7축 전부 시나리오화(1→TZ-API-01, 2→TZ-E2E-02, 3→TZ-UNIT-01·02, 4→TZ-API-02·TZ-E2E-01, 5→TZ-API-03, 6→TZ-UNIT-03, 7→TZ-API-04·05·TZ-UNIT-04). 시각 판정은 **Mongo 저장 UTC 대조 + 화면 KST ±1분**, 레이아웃은 **innerWidth 1259px 에서 th right ≤ innerWidth** 로 측정 가능하게 고정. recent_pages 는 정상·방어·여정(이탈 후 보존·새로고침 보존) 3층으로 분리. BASE_REV=28679d0 반영. 스냅샷 대조 방식·로컬 TZ·미보유 표시 규칙·광고 회귀 지점·직접 POST 승인·프로브 미실행 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.
- 2026-08-19 planner 판정 반영 — §4 판정 블록 6건 확정(Mongo UTC 직접 대조+DB 읽기 승인 / 로컬 TZ KST 실측 확정 / **직전 동선 미보유 = 블록 미표시로 PLAN 문안 정정** / 광고 회귀 지점 items created_at / 직접 POST 7케이스 승인 / 프로브 0건·기적재 이력 사용). 보류 0건 — dev 구현 완료·재기동 후 tester 착수 가능(§0 선행 절차 유지).
- 2026-08-19 planner 계약 편차 판정 — `recent_pages[].at` 비문자열 시 **항목 제외 대신 `at: null` 저장**(구현 관대 규칙 채택, PLAN §7 정정). TZ-API-03 기대값을 이 규칙으로 고정(비정상 at 포함 항목도 path 보존·200), TZ-UNIT-03/TZ-E2E-01 에 **`at` null 항목은 시각 없이 경로만 렌더(널 안전·크래시 0)** 판정 추가.

# v189 — Elasticsearch 보안 강화 (인증 활성화·바인딩 차단·랜섬 인덱스 제거) (2026-08-19 16:50)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v189 §0 실측(`xpack.security.enabled=false`+0.0.0.0 바인딩·ES 클라이언트 3지점·`es_url` 단일 조립·`.env` 에 ES_USER/PASSWORD 부재·**MinIO 는 브라우저 직접 접속이라 차단 금지**), §1 판정 3건(basic_auth 주입·ES 만 바인딩 차단·비밀번호 .env 한정), §2 설계, §5 테스트 항목 1~7, §6 강행 금지 7항
대상: `docker-compose.yml`(security=true·ELASTIC_PASSWORD·127.0.0.1 바인딩·healthcheck 인증)·`.env`(ES_USER/ES_PASSWORD)·`config.py`(`es_basic_auth`)·`database/elasticsearch.py`·`services/embedding_service.py`·`services/search_service.py` 9005 및 9004 미러 6파일. **MinIO·PG·Mongo·Redis 설정·tracks 인덱스·앱 기능 코드 무접촉**이 검증 대상
BASE_REV: **758485b**(코디네이터 지정 — git diff 기준)

## 0. 전제 및 안전 규칙

- **크리덴셜 위생(최우선)**: ES 비밀번호 **실값을 TESTPLAN·REPORT·로그·명령 기록 어디에도 기재 금지** — 전부 `<ES_PASSWORD>` 플레이스홀더. 검증 명령은 `-u "$ES_USER:$ES_PASSWORD"` 처럼 **환경변수 참조 형태**로 실행하고, 실행 기록에 실값이 남는 형태(히스토리 평문·산출물 붙여넣기)를 만들지 않는다. `ES_USER` 는 기본 `elastic`.
- **인덱스 무접촉(강행 금지 ③)**: 이번 검증에서 tester 는 **어떤 인덱스도 삭제·수정하지 않는다**(`read_me` 삭제는 backend-dev 작업 — tester 는 **부재 확인만**). ES 쓰기 요청(PUT/POST/DELETE) 금지 — 조회(`GET /_cat/indices`, `GET /{index}/_count`)만. 앱 경유 색인 검증(ES-API-05)은 **테스트 계정 트랙 1건** 한정.
- **MinIO·타 스토어 무접촉**: 9100 바인딩·설정 확인은 **읽기 관찰만**(`ss -tlnp`·presign 발급 조회). PG/Mongo/Redis 설정 변경·바인딩 변경 금지(범위 밖 — §1 판정 2).
- **증거 파일**: `read_me` 원문 JSON 은 스크래치패드에 보존됨 — tester 는 **경로 존재·크기만 확인**하고 **내용(지갑주소·이메일 등)을 REPORT·로그·화면에 옮기지 않는다**(§4-2).
- **실사용자 데이터 무접촉**: 검색·재생 검증은 조회만. 신고·CS·광고 회귀는 v185~188 방침 승계(열람·읽기 전용, `[v189-test]` 표식이 필요한 쓰기는 신고 접수 1건 이내).
- **재기동 승인**: ES·백엔드 2대 재기동으로 검색 일시 중단은 승인됨 — 검증은 재기동 완료 후 수행. 재기동 실패 시 즉시 중단·롤백 보고(§6).
- 환경/플레이스홀더: `ES_HOST`(localhost)·`ES_PORT`(9200)·`EXT_IP`(외부 인터페이스 IP — 테일스케일 100.x 또는 공인 IP, REPORT 에는 `100.x.x.x` 형태로 마스킹 기재)·`ADMIN_TOKEN`/`USER_TOKEN`/`TEST_TRACK_ID`.

## 1. [api] 시나리오 — ES 보안 상태

### ES-API-01. 인증 강제 — 무인증 401 / 인증 200 [api] — 핵심
- Given: ES 재기동 완료(보안 활성), `ES_USER`/`ES_PASSWORD` 는 환경변수로만 참조(§0)
- When: ① `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9200` ② `curl ... http://127.0.0.1:9200/_cat/indices` (무인증) ③ 인증 포함 `-u "$ES_USER:$ES_PASSWORD"` 로 `/`·`/_cluster/health`·`/_cat/indices` ④ **잘못된 비밀번호** 1회 하면
- Then: ①② **401**(수정 전 200 이었음 — 무인증 접근 차단 실증) ③ **200** + `/_cluster/health` 의 `status`(green/yellow) 조회 가능·`_cat/indices` 목록 반환 ④ 401. 응답 본문·헤더에 비밀번호 반향 0건.

### ES-API-02. 외부 노출 차단 — 바인딩·외부 IP 도달 실패 [api] — 핵심
- Given: 호스트 셸 접근, `EXT_IP` 확인(`ip -4 addr` 등 읽기)
- When: ① `ss -tlnp | grep 9200` ② `curl --max-time 5 http://{EXT_IP}:9200`(외부 인터페이스 경유) ③ 참고: 동일 명령을 `127.0.0.1` 로 하면
- Then: ① **`127.0.0.1:9200` 바인딩만 존재 — `*:9200`(0.0.0.0) 부재** ② **접속 실패**(connection refused 또는 타임아웃 — 도달 불가) ③ 정상 도달(401/200 — ES-API-01 과 일치). ①의 출력에서 PID/프로세스 정보는 기록하되 **다른 포트(9100·5432·27017·6379)는 관찰만 하고 변경하지 않음**(ES-API-06 에서 MinIO 불변 확인에 재사용).

### ES-API-03. 침해 산출물 — read_me 부재·tracks 21건·증거 파일 [api] — 핵심
- Given: 인증 크리덴셜, 삭제 전 인덱스 스냅샷(backend-dev 보고값 — tracks 문서 수 기준 21)
- When: ① 인증 `GET /_cat/indices?v` ② `GET /read_me/_count`(또는 `_cat/indices` 내 존재 여부) ③ `GET /tracks/_count` ④ 증거 JSON 파일 경로 `ls -l` 하면
- Then: ① 인덱스 목록에 **`read_me` 부재**, 기타 인덱스 손실 0(삭제 전 목록 대비 `read_me` 만 감소) ② 404(인덱스 없음) ③ **count == 21**(삭제 전후 동일 — tracks 무접촉 실증) ④ **파일 존재·크기 > 0**(경로만 REPORT 기재, **내용 미열람·미인용** — §0). 이 시나리오에서 tester 는 어떤 삭제·쓰기도 수행하지 않음.

### ES-API-04. 앱 기능 — 9005·9004 양쪽 health·검색·하이브리드 [api] — 핵심
- Given: 백엔드 2대 재기동 완료, `USER_TOKEN`
- When: 각 포트(9005·9004)에 대해 ① health 엔드포인트 ② 트랙 검색 API(키워드 — 기존 시드 트랙이 걸리는 질의) ③ **하이브리드 검색**(ES+pgvector 경로 — 의미 검색/추천 질의) 하면
- Then: **양쪽 모두** ① 200(ES 연결 정상 — 인증 주입 후에도 클라이언트 초기화 성공) ② 200 + **결과 ≥1건**(tracks 21건 대상 매칭) ③ 200 + 결과 반환(ES·pgvector 양측 정상 — 한쪽 실패 시 빈 결과/500 이면 FAIL). 응답·서버 로그에 인증 실패(401) 흔적 0건, 시작 로그에 ES 연결 오류 0건.

### ES-API-05. 색인/삭제 경로 — 테스트 트랙 1건 (조건부) [api]
- Given: `USER_TOKEN`(테스트 계정), 테스트 트랙 1건 업로드 가능 환경(§4-3 승인 시)
- When: ① 테스트 트랙 1건 생성(제목 `[v189-test]` 표식) → ② 검색으로 **색인 반영 확인**(잠시 후 조회) → ③ 해당 트랙 **삭제** → ④ 재검색 하면
- Then: ② 신규 트랙이 검색 결과에 등장(ES 색인 경로 정상 — 인증 후에도 쓰기 경로 동작) ④ 결과에서 사라짐(삭제 연동 정상) + `GET /tracks/_count` 가 **21 로 복귀**(순변화 0). **승인 불가/환경 제약 시 SKIP** — `embedding_service.py`·`search_service.py`·`elasticsearch.py` 3지점의 `basic_auth` 전달 코드 리뷰로 갈음(§4-3).

### ES-API-06. MinIO 회귀 — 차단하지 않았음 확인 [api] — 회귀 핵심
- Given: `USER_TOKEN`/`ADMIN_TOKEN`
- When: ① `ss -tlnp | grep 9100` ② 영상 트랙의 **presign URL 발급** API 호출 ③ 발급된 URL 로 HEAD/GET(브라우저 직접 접속 경로 모사 — `MINIO_PUBLIC_HOST` 기준) ④ 관리자 **이미지 프록시** 1건 하면
- Then: ① **`*:9100` 바인딩 불변**(127.0.0.1 로 바뀌지 않음 — 차단 금지 준수, 강행 금지 ①) ② presign URL 발급 200(`public_presign` 경로) ③ **200/206 도달**(외부 접속 유지 — 영상 재생 파손 없음) ④ 프록시 정상. PG/Mongo/Redis 포트 바인딩도 **변경 없음** 관찰 기록(§1 판정 2 — 이번 범위 밖).

### ES-API-07. 회귀 — v185~188 대표 + 미러 + git diff [api] — 회귀 마감
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, BASE_REV `758485b`
- When: ① v185~188 대표: 신고 접수(`[v189-test]` 1건)·인박스 목록/상세·탭② errors 묶음·프로브 이력 조회(클릭 실행 0)·CS 단건 조회(`/conversations/{cid}`)·**시각 tz 표기**(`+00:00`)·**직전 동선** 필드 ② `diff` 9005↔9004 — docker-compose.yml·config.py·database/elasticsearch.py·services/embedding_service.py·services/search_service.py ③ `git diff 758485b..HEAD --name-only` 하면
- Then: ① 전부 기존 TESTPLAN 판정 기준 PASS(ES 보안 변경이 앱 기능·표시 계약에 무영향) ② **compose 포함 5파일 diff 0**(바이트 동일 — `.env` 는 환경별 값이라 diff 대상 제외, 존재·키 구성만 확인) ③ 변경 파일 == PLAN §3 매트릭스 정확 일치 — **`.env` 부재**(gitignore — ES-UNIT-01)·MinIO/PG/Mongo/Redis 설정 파일 부재·**package.json/lock 부재**. 초과 파일 시 즉시 중단·보고.

## 2. [unit] 시나리오 — 크리덴셜 위생 (정적 검사)

### ES-UNIT-01. `.env` 커밋 차단 + 실값 노출 0건 [unit] — 핵심 (위반 시 즉시 중단)
- Given: 저장소(9005·9004), 서버 로그·이번 버전 산출물(PLAN·TESTPLAN·REPORT 초안)
- When: ① `git check-ignore -v backend_9005/.env` / `backend_9004/.env` + `git ls-files | grep -c '\.env$'` ② `git log --all --name-only | grep '\.env'`(과거 커밋 유입 여부 스팟) ③ 서버 로그·앱 로그 grep — 비밀번호 실값·`elastic:` 형태 크리덴셜·`http://.*:.*@` URL 패턴 ④ 산출물(PLAN/TESTPLAN/REPORT) grep — 동일 패턴 ⑤ 앱 응답(health·검색·오류 응답) 검사 하면
- Then: ① **gitignore 매칭 또는 미추적**(추적 파일 목록에 `.env` 0건) ② 과거 커밋에도 유입 없음(발견 시 **즉시 중단·planner 보고** — 이력 정리는 별도 판단) ③④⑤ **비밀번호 실값 0건** + **ES URL 에 크리덴셜 미포함**(`http://host:port` 형태만 — `basic_auth` 주입 방식 실증, §1 판정 1). 위반 1건이라도 발견 시 즉시 중단.

### ES-UNIT-02. 설정 코드 리뷰 — 인증 주입·healthcheck·바인딩 [unit]
- Given: 수정된 6파일
- When: ① `config.py` 의 `es_user`/`es_password`/`es_basic_auth`(미설정 시 None 반환) ② 3지점(`elasticsearch.py`·`embedding_service.py`·`search_service.py`)의 `basic_auth=settings.es_basic_auth` 전달 ③ compose 의 `xpack.security.enabled=true`·`ELASTIC_PASSWORD=${ES_PASSWORD}`·`127.0.0.1:${ES_PORT:-9200}:9200`·**인증 포함 healthcheck** ④ MinIO/PG/Mongo/Redis 블록 하면
- Then: ①② URL 문자열에 크리덴셜을 넣지 않고 `basic_auth` 파라미터로만 전달(강행 금지 ④ 구조적 준수) — 미설정 시 None 으로 기존 동작 유지 ③ 4항목 전부 반영 + healthcheck 가 401 로 실패하지 않음(컨테이너 healthy 상태 실측 — `docker ps` 또는 compose ps) ④ **무변경**(MinIO 바인딩·타 스토어 설정 라인 diff 0 — ES-API-07 ③ 겸측).

## 3. [e2e] 시나리오 — 1건

### ES-E2E-01. 사용자 검색 여정 + 관리자 화면 스모크 [e2e] (읽기 전용)
- Given: 사용자 앱(4000)·관리자 앱(4001), 테스트 계정 로그인. §0/v187 선행 절차(하드 새로고침·빌드 표기 기록)
- When: ① 사용자 앱에서 **트랙 검색**(키워드) → 결과 목록 → 상세 진입 → **영상 재생 1건**(presign 경로 — MinIO 회귀) ② 관리자 앱에서 `/issues` 탭①·탭②·`/advertisers` 1지점·`/cs` 무쿼리 진입 하면
- Then: ① 검색 결과 정상 렌더(ES 경로 — 인증 활성 후에도 사용자 체감 무변화)·**영상 재생 정상**(9100 직접 접속 유지) ② 관리자 화면 v185~188 렌더 정상(시각 KST·페이지 경로 표시·행 클릭 확장)·콘솔 신규 에러 0건·**ES 401 관련 오류 배너 0건**.
- 안전: 조회·재생만(업로드·삭제·발송·조정 0건). 실사용자 콘텐츠는 열람만.
- 증적: 검색 결과·영상 재생·관리자 2화면 스크린샷(빌드 표기 포함, 크리덴셜 화면 노출 없음).

## 4. planner 확인 필요 사항

1. **외부 IP 도달 실패 검증 위치**: `EXT_IP` 로의 접속 시도를 **동일 호스트에서** 수행하면 라우팅상 도달할 수 있어(로컬 인터페이스) 판정이 약해질 수 있음 — (a) 동일 호스트에서 `curl http://{EXT_IP}:9200` 실패로 판정(초안) (b) 외부 단말(테일스케일 피어 등)에서 검증 가능하면 그쪽 우선. 환경 가능 여부 회신 요청.
2. **증거 파일 확인 범위**: 경로·크기만 확인하고 **내용 미열람** 방침(지갑주소·이메일 등 침해자 데이터) — 파일 존재만으로 충분한지, 문서 수 등 메타 확인이 필요한지 회신.
3. **ES-API-05 색인 경로 실측 승인**: 테스트 트랙 1건 업로드→검색 확인→삭제(순변화 0, `[v189-test]` 표식) 승인 여부. 불허/환경 제약 시 3지점 코드 리뷰 갈음 + SKIP 기록(초안 기본값은 승인 시 실측).
4. **`.env` 과거 커밋 유입 스팟(ES-UNIT-01 ②)**: `git log --all` 스캔 수행 여부 — 발견 시 이력 정리는 범위 밖(즉시 보고만) 확인.
5. **tracks 21건 기준값 출처**: backend-dev 의 삭제 전 스냅샷 값 사용 — 재기동/재색인으로 값이 달라질 가능성이 있으면 기준값을 backend-dev 보고서에서 확정해 전달 요청.
6. **PG/Mongo/Redis 바인딩 관찰 기록**: 이번 범위 밖이나 `ss -tlnp` 출력에 함께 잡힘 — REPORT 에 **현황만 기재**(변경 없음 확인용)하는 것이 맞는지, 노출 현황 기재 자체를 피할지 판정 요청(보안 문서 취급).

### planner 판정 (2026-08-19, 6건 전부 확정 — v189)

1. **외부 도달 실패 검증 = `ss -tlnp` 바인딩이 1차 근거, curl 은 보조**(오케스트레이터 의견 채택). 판정식: `127.0.0.1:9200` **단독 LISTEN** + `*:9200` 부재가 PASS 조건. 동일 호스트에서 자기 외부 IP 로의 curl 은 라우팅상 판정이 애매할 수 있으므로 **보조 관측(비고)** 으로만 기록. **테일스케일 피어에서의 원격 검증은 필수화하지 않음**(환경 확보 불확실 — 가능하면 보너스 증적).
2. **증거 파일 = 경로·크기·문서 수 메타만 확인, 내용 비인용 확정.** 랜섬 문구·지갑주소·연락처는 **TESTPLAN·REPORT 어디에도 전재 금지**(스크래치패드 원본에만 존재).
3. **ES-API-05 색인 실측 → 코드 리뷰 갈음 확정**(의견 채택). 근거: 트랙 업로드는 MinIO 쓰기·별 소비 등 **부수효과가 큰 쓰기 경로**이고, 읽기 경로는 ES-API-04(검색 200+결과)가 이미 커버. 갈음 내용 = **3지점 `basic_auth` 전달 코드 리뷰 + 서버 로그에 ES 401/AuthenticationException 부재 확인**(재기동 후 색인·검색 호출이 실제로 인증 통과 중임을 로그로 입증).
4. **`.env` 과거 커밋 스캔 — planner 가 선실측 완료, 결과 공유**: 루트 `.gitignore:21-23` 에 `.env`·`.env.local`·`*.env` 실재, `git check-ignore -v` 로 `backend_9005/.env` 가 **`*.env` 규칙에 매칭됨** 확인. `git ls-files` 에 tracked `.env` **0건**(`.env.example` 2개만 tracked — 정상), `git log --all -- "*backend_9005/.env"` **빈 결과 = 과거에도 커밋된 적 없음**. → tester 는 **이 결과를 재확인(3 명령)만** 하고, 신규 발견 시에만 보고. 이력 정리는 범위 밖(불필요 확정).
5. **tracks 기준값** — backend-dev 의 삭제 전 스냅샷을 오케스트레이터가 전달(현 실측 21건). 판정은 **스냅샷 == 사후 count** 동일성.
6. **타 스토어 바인딩 현황 REPORT 기재 확정**(의견 채택) — 포트·바인딩 형태(`*:PORT` vs `127.0.0.1:PORT`)·인증 유무까지 기재, **EXT_IP 는 마스킹**. 사용자가 다음 결정(PG/Mongo/Redis 차단 여부)을 내리려면 현황이 문서에 있어야 한다.

## 5. 실행 순서 권고 (tester 참고)

1. 선행: backend-dev 완료 보고(재기동·삭제 완료·tracks 기준값·증거 경로) 접수 확인 → ES-UNIT-01(크리덴셜 위생 — 위반 시 즉시 중단) → ES-UNIT-02(설정 리뷰)
2. ES-API-01 → ES-API-02 → ES-API-03 (보안 3축 — 조회만)
3. ES-API-04 (9005·9004 앱 기능) → ES-API-05 (§4-3 승인 시) → ES-API-06 (MinIO 회귀)
4. ES-API-07 (v185~188 회귀·미러·diff — BASE 758485b)
5. ES-E2E-01 (사용자 검색·재생·관리자 스모크)
6. 종료: REPORT — 401/200 관측·바인딩 출력(마스킹)·인덱스 count·증거 파일 경로(내용 미기재)·미러 diff·`[v189-test]` 산출물 정리 내역. **비밀번호 실값·증거 내용·EXT_IP 원문 기재 금지**(마스킹)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| ES-API-01 | api | | 무인증 401·인증 200·health 조회·오답 401 |
| ES-API-02 | api | | 127.0.0.1:9200 단독 바인딩·외부 IP 도달 실패 |
| ES-API-03 | api | | read_me 부재·tracks 21·타 인덱스 손실 0·증거 파일 존재(경로만) |
| ES-API-04 | api | | 9005·9004 health·검색·하이브리드 200 |
| ES-API-05 | api | | 색인/삭제 경로(테스트 트랙 1건, 순변화 0) — 미승인 시 SKIP |
| ES-API-06 | api | | MinIO *:9100 불변·presign 200·직접 접속·프록시 정상 |
| ES-API-07 | api | | v185~188 대표·미러 5파일 diff 0·diff 매트릭스 |
| ES-UNIT-01 | unit | | .env 미추적·실값 0건·URL 크리덴셜 미포함 — 위반 시 중단 |
| ES-UNIT-02 | unit | | basic_auth 주입·compose 4항목·healthcheck healthy·타 스토어 무변경 |
| ES-E2E-01 | e2e | | 검색·영상 재생·관리자 스모크 — 읽기 전용 |

## v189 시나리오 집계

- 총 **10건** — [api] 7 / [unit] 2 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: **원칙 0건** — tester 는 ES 조회만(삭제·색인 요청 금지), 인덱스 무접촉. 예외는 ES-API-05(승인 시 테스트 트랙 1건 업로드→삭제, 순변화 0)와 ES-API-07 의 `[v189-test]` 신고 접수 1건. MinIO·PG·Mongo·Redis 설정 무접촉(관찰만), 실사용자 데이터 열람·조회만. 크리덴셜은 전 구간 플레이스홀더·환경변수 참조, 증거 파일은 경로만 확인(내용 비인용) — 위반 시 즉시 중단.

## 개정 이력 (v189)

- 2026-08-19 초판 작성 (10건) — 코디네이터 필수 7축 전부 시나리오화(1→ES-API-01, 2→ES-API-02, 3→ES-API-03, 4→ES-API-04·05·ES-E2E-01, 5→ES-API-06, 6→ES-API-07·ES-UNIT-02, 7→ES-UNIT-01). 보안 검증 특성상 **tester 쓰기 0건 원칙**(인덱스 무접촉·조회만)과 **크리덴셜/증거 비인용 규칙**을 §0 불변식으로 명문화. BASE_REV=758485b 반영. 외부 IP 검증 위치·증거 확인 범위·색인 실측 승인·과거 커밋 스캔·tracks 기준값·타 스토어 현황 기재 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.
- 2026-08-19 planner 판정 반영(v189) — 6건 확정(바인딩 1차·curl 보조 / 증거 메타만 · 내용 전재 금지 / 색인 코드 리뷰+ES 401 부재 로그 갈음 / **.env 미추적·미커밋·`*.env` ignore 매칭 planner 선실측 완료 — tester 는 재확인만** / tracks 스냅샷 대조 / 타 스토어 바인딩 현황 기재·EXT_IP 마스킹). 보류 0건 — backend-dev 작업 완료·재기동 후 tester 착수 가능(쓰기 0건 원칙 유지).

# v190 — DB 포트 외부 노출 차단 (PG·Mongo·Redis 루프백 바인딩) (2026-08-19 17:53)

팀: platform-music-cs-send / test-designer 작성 (초안 — 실행 전, planner 검토 대기)
근거: PLAN.md v190 §0 실측(`*:5432`·`*:27017`·`*:6379`·`*:9100`·`*:9101` / ES `127.0.0.1:9200` 완료·앱은 전부 localhost 접속·**redis·minio 는 legacy compose 출처**·볼륨 parity 로 데이터 유지), §1 판정 2건(Windows localhost 접속 유지·**3서비스 명시 재생성**·`down -v` 금지), §2 설계, §5 테스트 항목 1~6, §6 강행 금지 7항
대상: `backend_9005/docker-compose.yml`·`backend_9004/docker-compose.yml` 의 postgres·mongodb·redis **ports 3줄 `127.0.0.1:` 접두**뿐. **minio·elasticsearch 블록·.env·앱 코드 전부 무변경**이 검증 대상
BASE_REV: **7d85229**(코디네이터 지정 — git diff 기준)

## 0. 전제 및 안전 규칙

- **tester 쓰기 최소·인프라 무조작**: 컨테이너 조작(`up`/`down`/`restart`)·볼륨 접근·compose 실행은 **backend-dev 몫** — tester 는 **관찰·조회만**(`ss -tlnp`·`docker ps`(읽기)·DB 카운트 쿼리·API 조회). **`down -v`·볼륨 삭제·컨테이너 재생성 금지**(강행 금지 ②).
- **쓰기 허용 범위**: `[v190-test]` 표식 신고 접수 **1건**(Mongo 경유 쓰기 경로 확인용)까지. 그 외 쓰기(발송·조정·트랙 업로드·상태 변경) 0건. 실사용자 데이터 무접촉(열람·집계 조회만).
- **MinIO·ES 무접촉**: 두 서비스는 **차단되지 않았음을 확인하는 대상**(변경됐다면 FAIL) — 설정·바인딩·컨테이너 조작 금지, 관찰과 API 조회만.
- **크리덴셜 위생(v189 승계)**: DB 비밀번호·ES 비밀번호 **실값 기재 금지** — 명령은 환경변수 참조 형태(`-u "$ES_USER:$ES_PASSWORD"`, PG/Mongo 는 `.env` 참조), REPORT·로그에 플레이스홀더만. 외부 인터페이스 IP 는 `100.x.x.x` 형태로 마스킹 기재.
- **데이터 무손실 판정 기준(핵심)**: backend-dev 의 **사전 스냅샷**(PG 17테이블 행수 — users 158 등 / Mongo 33컬렉션 문서수 — play_logs 28,716 등 / Redis `DBSIZE`)과 **정확 일치**. **하나라도 불일치 시 즉시 중단·planner 보고**(추가 검증 진행 금지). 대조 시점의 자연 증가분(테스트 신고 1건 등 tester 유발분)은 **증가 항목·수치를 명시**하고 그 외 항목은 완전 일치여야 함.
- **순단 허용**: 재생성 중 수 초 순단 승인됨 — 검증은 재생성 완료 후 수행, 커넥션 풀 **재연결 확인**을 판정 항목에 포함(ES-…v189 방식 승계).
- 선행 절차(v187~189 승계): [unit]/[e2e] 착수 전 하드 새로고침 + 빌드 표기 기록.
- 플레이스홀더: `ADMIN_TOKEN`/`USER_TOKEN`(테스트 계정)/`TEST_CID`/`EXT_IP`(외부 인터페이스 IP — 마스킹 기재).

## 1. [api] 시나리오 — 바인딩·데이터·기능

### DB-API-01. 바인딩 차단 — 3포트 루프백 단독 + MinIO·ES 불변 [api] — 핵심
- Given: 호스트 셸(읽기 전용), backend-dev 재생성 완료 보고 접수
- When: ① `ss -tlnp | grep -E '5432|27017|6379|9100|9101|9200'` ② `docker ps --format '{{.Names}}\t{{.Ports}}'`(읽기) 하면
- Then:
  - ① **5432·27017·6379 가 `127.0.0.1:PORT` 단독 LISTEN** — 해당 3포트의 `*:PORT`/`0.0.0.0`/`[::]` 항목 **0건**
  - **MinIO `*:9100`·`*:9101` 불변**(루프백으로 바뀌었으면 **FAIL** — 영상 재생 파손, 강행 금지 ①)
  - **ES `127.0.0.1:9200` 불변**(v189 상태 유지)
  - ② `docker ps` 포트 매핑이 ①과 교차 일치(3서비스는 `127.0.0.1:` 접두, minio 는 `0.0.0.0`+`[::]` 유지)
  - 출력 기록 시 PID·프로세스명은 남기되 **크리덴셜·IP 원문은 마스킹**

### DB-API-02. 외부 도달 실패 (보조 근거) [api]
- Given: `EXT_IP` 확인(읽기)
- When: `curl --max-time 5 http://{EXT_IP}:5432` / `:27017` / `:6379`(프로토콜 무관 — TCP 연결 성립 여부만 관찰, 예: `nc -z -w3`) 하면
- Then: **3포트 전부 연결 실패**(refused/timeout). 단 **동일 호스트에서의 시도는 라우팅상 성립할 수 있어 1차 근거는 DB-API-01 바인딩 실측** — 본 시나리오는 **보조 근거·비고 처리**(v189 §4-1 판정 승계). 외부 단말(테일스케일 피어)에서 검증 가능하면 그 결과를 우선 기재.

### DB-API-03. 데이터 무손실 — 스냅샷 정확 대조 [api] — 핵심 (불일치 시 즉시 중단)
- Given: backend-dev **사전 스냅샷**(PG 17테이블 행수·Mongo 33컬렉션 문서수·Redis DBSIZE) 수령
- When: ① PG 각 테이블 `COUNT(*)`(17개 — users 158 등) ② Mongo 각 컬렉션 `countDocuments`(33개 — play_logs 28,716 등) ③ Redis `DBSIZE`·주요 키 패턴 수 하면
- Then: **①②③ 전 항목이 사전 스냅샷과 정확 일치** — 볼륨 재연결로 데이터 유지 실증(§0 판정). 예외는 tester/dev 유발 증가분뿐이며 **항목·수치를 명시**(예: issue_reports +1). **하나라도 불일치(감소·테이블/컬렉션 소실) 시 즉시 중단·planner 보고**(이후 시나리오 진행 금지). 테이블/컬렉션 **개수 자체**(17·33)도 동일 확인.

### DB-API-04. 앱 기능 — DB별 경유 경로 (9005·9004 양쪽) [api] — 핵심
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, 양 포트 기동 상태
- When: **각 포트에 대해** ① health ② **PG 경유**: 로그인(토큰 발급) 또는 `GET /api/admin/users`(사용자 목록) ③ **Mongo 경유**: 트랙 목록·별 잔액(`/api/points/balance`)·신고 목록 조회 + **신고 접수 1건**(`[v190-test]` — 9005 에서만, §0) ④ **Redis 경유**: 세션 유지(발급 토큰으로 인증 요청 재사용) 또는 차트 캐시 응답 1건 ⑤ **ES 경유**: 트랙 검색 하면
- Then: **양쪽 모두 전 항목 200**(+ ②는 결과 행 ≥1, ⑤는 결과 ≥1) — 루프백 전환 후에도 앱 접속 경로(localhost) 정상. **서버 로그에 커넥션 오류(connection refused/timeout/pool 재시도 실패) 0건** — 재생성 순단 시점의 재연결 로그는 허용하되 **지속 오류 0**(§0 재연결 확인). 신고 접수 1건은 DB-API-03 증가분으로 명시.

### DB-API-05. MinIO 회귀 — presign·직접 GET·프록시 [api] — 회귀 핵심
- Given: `USER_TOKEN`/`ADMIN_TOKEN`
- When: ① 영상 트랙 **presign URL 발급** API ② 발급 URL 로 **직접 GET**(Range 요청 — 브라우저 재생 경로 모사, `MINIO_PUBLIC_HOST` 경유) ③ 관리자 **이미지 프록시** 1건 하면
- Then: ① **200**(public_presign 정상) ② **206**(부분 콘텐츠 — v189 와 동일 기준, 외부 직접 접속 유지 실증) ③ 200. DB-API-01 의 `*:9100` 불변과 교차 정합 — MinIO 가 함께 차단되지 않았음을 기능 수준에서 확인.

### DB-API-06. 회귀 — v185~189 대표 + compose 동일 + git diff [api] — 회귀 마감
- Given: `ADMIN_TOKEN`·`USER_TOKEN`, BASE_REV `7d85229`
- When: ① v185~188 대표: 신고 인박스 목록/상세·탭② errors 묶음·프로브 이력 조회(클릭 0)·CS 단건 조회(`/conversations/{TEST_CID}`)·**시각 tz 표기**(`+00:00`)·**직전 동선** 필드 ② v189 대표: **무인증 `curl :9200` 401 / 인증 200**·`read_me` 부재·`tracks` count 21 ③ `diff -q backend_9005/docker-compose.yml backend_9004/docker-compose.yml` ④ `git diff 7d85229..HEAD --name-only` 하면
- Then: ①② 전부 기존 TESTPLAN 판정 기준 PASS(포트 바인딩 변경이 앱·ES 보안 상태에 무영향) ③ **바이트 동일**(diff 출력 없음) ④ 변경 파일 == **compose 2파일 + 산출물(PLAN/TESTPLAN/REPORT)뿐** — `.env`·앱 코드·minio/es 관련 파일 **부재**. 초과 파일 시 즉시 중단·보고.

## 2. [unit] 시나리오 — 설정 검사

### DB-UNIT-01. compose diff 리뷰 — 3줄 한정·MinIO/ES 블록 무변경 [unit]
- Given: 수정된 compose 2파일, BASE_REV 기준 diff
- When: ① `git diff 7d85229..HEAD -- backend_9005/docker-compose.yml backend_9004/docker-compose.yml` 내용 검토 ② minio·elasticsearch 블록 대조 하면
- Then: ① 변경이 **postgres·mongodb·redis 의 ports 3줄에 `127.0.0.1:` 접두 추가**뿐(각 파일 3줄 — 다른 라인·환경변수·볼륨·healthcheck 변경 0) ② **minio·elasticsearch 블록 diff 0**(ES 는 v189 상태 유지·MinIO 는 `*` 바인딩 유지 — 강행 금지 ①). `.env` 파일 미추적 상태 유지 확인(v189 ES-UNIT-01 승계 스팟 1회).

### DB-UNIT-02. 관리자 앱 스모크 + 콘솔 위생 [unit]
- Given: 관리자 앱(4001), 선행 절차(하드 새로고침·빌드 표기 기록) 완료
- When: ① `/issues` 탭①·탭②(행 클릭 확장·페이지 셀 경로 표시) ② `/points` 요약·`/advertisers` 목록 ③ `/cs` 무쿼리 진입 ④ 콘솔 grep(크리덴셜·본문·경로 원문) 하면
- Then: ①~③ v185~188 렌더·동작 정상(시각 KST·7열 가시성 유지)·에러 배너 0 ④ 콘솔 **0건**·신규 에러 0건. DB 순단 흔적(무한 로딩·500 배너) 없음.

## 3. [e2e] 시나리오 — 1건 (읽기 위주)

### DB-E2E-01. 사용자 여정 — 로그인→검색→재생 + 관리자 확인 [e2e]
- Given: 사용자 앱(4000)·관리자 앱(4001), 테스트 계정
- When: ① **로그인**(PG+Redis 세션) → ② 트랙 목록·**검색**(Mongo+ES) → ③ 상세 진입 → **영상 재생 1건**(MinIO presign 직접 접속) → ④ 별 잔액 화면 확인(Mongo) → ⑤ (선택) `[v190-test]` 신고 1건 접수 — DB-API-04 ③과 중복 시 생략 → ⑥ 관리자 앱에서 해당 신고/기존 인박스 확인 하면
- Then: 전 단계 정상 — **로그인 유지**(새로고침 후에도 세션 — Redis 재연결 실증)·검색 결과 ≥1·**영상 재생 정상**(206 경로)·잔액 표시·관리자 인박스 반영. 콘솔 신규 에러 0건, DB 연결 오류 배너 0건.
- 안전: 조회·재생·신고 1건 외 쓰기 없음. 실사용자 콘텐츠는 열람만.
- 증적: 로그인 후 화면·검색 결과·영상 재생·관리자 인박스 스크린샷(빌드 표기 포함, 크리덴셜 노출 없음).

## 4. planner 확인 필요 사항

1. **스냅샷 수령 형식**: DB-API-03 은 backend-dev 사전 스냅샷(17테이블·33컬렉션·Redis DBSIZE)이 **전 항목 수치**로 전달돼야 정확 대조 가능 — 산출물 형태(표/JSON)와 전달 시점 확정 요청. 부분 항목만 오면 **핵심 항목(users·play_logs·DBSIZE) 대조 + 나머지는 개수 일치**로 축소.
2. **tester 의 DB 직접 조회 승인**: PG `COUNT(*)`·Mongo `countDocuments`·Redis `DBSIZE` 는 읽기 전용이나 DB 직결이 필요 — v182~183 승인 관행 준용 확인(불허 시 dev 사후 스냅샷 재현값을 tester 가 교차 검토하는 방식으로 대체).
3. **외부 도달 검증 위치**(v189 §4-1 동일 이슈): 동일 호스트 시도는 보조 근거 처리(초안). 외부 단말 검증 가능 여부 회신 — 가능하면 그 결과를 1차 보조 근거로 격상.
4. **Redis 경유 대표 경로 지정**: "세션 유지" 판정을 (a) 토큰 재사용 200 (b) 차트 캐시 응답 (c) 브로드캐스트 잠금(429 — 발송 위험이라 **제외 권고**) 중 무엇으로 고정할지 — 초안은 (a)+(b), (c) 미사용.
5. **신고 접수 1건 승인**: Mongo 쓰기 경로 확인용 `[v190-test]` 신고 1건(9005 한정, 잔존+REPORT 기재) 승인 확인. 불허 시 Mongo 쓰기 경로는 SKIP(조회만).
6. **다른 기기 DB 직결 사용 여부 고지**(§6 리스크): 차단으로 끊길 수 있는 워크플로 — REPORT 특이사항 고지 문안을 tester 가 작성할지, planner/코디네이터가 사용자 확인 후 확정할지 판정 요청.

## 5. 실행 순서 권고 (tester 참고)

1. 선행: backend-dev 완료 보고(사전 스냅샷·재생성·자가 확인 결과) 접수 → **DB-API-03(데이터 무손실) 최우선**(불일치 시 즉시 중단)
2. DB-API-01(바인딩 — 1차 근거) → DB-API-02(외부 도달 보조) → DB-UNIT-01(compose diff 리뷰)
3. DB-API-04(9005·9004 DB별 경유 — 신고 1건 포함) → DB-API-05(MinIO 회귀)
4. DB-API-06(v185~189 회귀·compose 동일·git diff) → DB-UNIT-02(관리자 스모크·콘솔)
5. DB-E2E-01(사용자 여정)
6. 종료: REPORT — 바인딩 출력(마스킹)·스냅샷 대조표(증가분 명시)·MinIO 206 확인·미러/diff 결과·`[v190-test]` 신고 id. **크리덴셜 실값·EXT_IP 원문 기재 금지**, 다른 기기 DB 직결 고지 문안(§4-6 판정 반영)

## 6. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| DB-API-01 | api | | 3포트 127.0.0.1 단독·MinIO *:9100/9101 불변·ES 불변·docker ps 교차 |
| DB-API-02 | api | | 외부 IP 3포트 연결 실패(보조 근거) |
| DB-API-03 | api | | PG 17테이블·Mongo 33컬렉션·Redis DBSIZE 정확 일치 — 불일치 시 중단 |
| DB-API-04 | api | | 9005·9004 health+PG/Mongo/Redis/ES 경유 200·커넥션 오류 0 |
| DB-API-05 | api | | presign 200·직접 GET 206·프록시 200 |
| DB-API-06 | api | | v185~189 대표·compose diff -q 동일·git diff 2파일+산출물 |
| DB-UNIT-01 | unit | | ports 3줄만 변경·minio/es 블록 diff 0·.env 미추적 |
| DB-UNIT-02 | unit | | 관리자 화면 스모크·콘솔 0·순단 흔적 없음 |
| DB-E2E-01 | e2e | | 로그인→검색→재생→잔액→인박스 — 세션 유지 실증 |

## v190 시나리오 집계

- 총 **9건** — [api] 6 / [unit] 2 / [e2e] 1 (보류 없음 — planner 확인 6건은 §4)
- 쓰기: `[v190-test]` 신고 접수 **1건**(승인 시)뿐 — 컨테이너·볼륨 조작 0(관찰만), MinIO·ES 무접촉, 실사용자 데이터 열람·집계 조회만. 데이터 무손실은 **사전 스냅샷 정확 대조**로 판정하고 불일치 시 즉시 중단. 크리덴셜 실값·외부 IP 원문은 전 산출물에서 마스킹.

## 개정 이력 (v190)

- 2026-08-19 초판 작성 (9건) — 코디네이터 필수 6축 전부 시나리오화(1→DB-API-01, 2→DB-API-02, 3→DB-API-03, 4→DB-API-04·DB-E2E-01, 5→DB-API-05, 6→DB-API-06·DB-UNIT-01·02). 데이터 무손실을 **최우선 실행·불일치 시 즉시 중단** 항목으로 배치하고, MinIO/ES 는 "차단되지 않았음"을 FAIL 조건으로 명문화. BASE_REV=7d85229 반영. 스냅샷 형식·DB 직접 조회 승인·외부 검증 위치·Redis 대표 경로·신고 1건 승인·다른 기기 직결 고지 6건 planner 회신 대기(§4). planner 검토 후 확정 예정.


## v194 — 공지 관리 페이지(B안: 읽음 통계 포함)

팀: MAIDOL-NoticeSquad / test-designer 작성 (초안 — **실행 전**, planner 검토 대기)
근거: PLAN.md v194 §1 실측(발송 경로·read 갱신 1지점·dm_messages 스키마/인덱스·감사로그·프론트 현황·미러 현황), §2 갭/정정(분모 정의·stale·프라이버시 경계 4조건), §3 설계(notices 컬렉션·notice_id·인덱스·API 2종·발송 흐름·410 차단), §4 변경 매트릭스 B1~B7/F1~F6 + §4-1 tz 규율, §5 회귀 위험 R1~R14, §6 범위 밖, §7 절대 준수
대상: `notice_service.py`(신규)·`admin_notices.py`(신규)·`dm_service.py`(optional kwarg 3곳)·`admin_cs.py`(broadcast/_run_cs_broadcast)·`dm.py`(410)·`main.py` + `frontend_admin`(api.js·AdminNoticesPage·AdminBroadcastModal props·App·AdminLayout) + 9004 미러
BASE_REV: **d19af4b** (git diff 기준 — 코디네이터 확정 시 갱신)

### 0. 전제 및 안전 규칙 (최우선 — 위반 시 해당 테스트 항목 자체를 폐기)

- **실제 전체발송 절대 금지 (되돌릴 수 없는 실액션).** 발송 관련 항목은 **모달 열림 / 검증 분기(400) / 인가(401·403) / `window.confirm` 취소 / 429 락 / 503** 경로까지만 설계·실행한다. `POST /api/admin/cs/broadcast` 가 **200 을 반환하는 호출은 이 TESTPLAN 의 어떤 항목에서도 수행하지 않는다** — 단, §5 planner 승인을 받은 격리 항목(NT-API-16·17)은 예외.
- **격리 실발송 조건(승인 대기)**: 실발송이 불가피한 항목(읽음 통계 산출·로그 추적 체인)은 **audience 필터가 테스트 계정 1~2개만 매칭하는 상태**를 별도로 구성한 뒤에만 수행한다. 구성 요건은 §5-A 에 설계서로 제출하며, **planner 승인 전 실행 금지**. 승인 전에는 해당 항목을 `SKIP(승인 대기)` 로 기록한다.
- **실사용자 계정·데이터 무접촉.** 테스트 계정(`<test-user-a>`, `<test-user-b>`, `<admin-email>`)만 사용. 실사용자 대화·공지·별·트랙은 **열람/집계 조회만**.
- **쓰기 허용 범위**(승인 전 기준): ① 테스트 계정 간 DM 대화 1건 + 메시지 수 건(회귀 1·2·5 확인용) ② 테스트 계정 간 pending 요청 1건(수락/거절 각 1) ③ `POST /api/admin/cs/send` 지정발송 **테스트 계정 1명 대상 1건**(회귀 4) ④ Redis 락 키 1개 수동 선점(NT-API-06, TTL 30초 자연 해제). **그 외 쓰기 0건** — 전체발송·인덱스 생성/삭제·컨테이너/볼륨 조작·compose 실행 전부 금지(인덱스는 앱 lazy 생성분을 **관찰만**).
- **크리덴셜 위생**: 산출물(TESTPLAN·REPORT·로그 인용)에 API 키·시크릿·실계정 비밀번호·토큰 **실값 기재 금지**. 전부 플레이스홀더 — `YOUR_TOKEN`, `<admin-email>`, `<test-user-a>`, `<official-id>`, `<notice-id>`, `<cid>`.
- **개인정보 위생**: 생년월일·성별·이메일이 응답/화면/로그/콘솔에 노출되지 않는지 **확인은 하되, 관측된 실제 값은 산출물에 옮겨 적지 않는다**(필드 존재 여부·개수만 기재). 공지 본문 원문도 로그·콘솔 인용 금지(길이만).
- **선행 절차**(v187~190 승계): `[unit]`(프론트)·`[e2e]` 착수 전 관리자 앱 하드 새로고침 + 빌드 표기 기록. 백엔드 `[unit]` 은 9005 실행 환경에서 순수 함수 직접 호출(pytest 임시 파일 또는 `python -c`) — **테스트 파일은 임시 사용 후 삭제**(레포 커밋 금지).
- 기준 URL: 9005 = `http://localhost:9005`, 9004 = `http://localhost:9004`, 관리자 앱 = `http://localhost:4001`, 사용자 앱 = `http://localhost:4000`.
- **중단 규칙**: NT-API-08(프라이버시 경계)·NT-UNIT-07(기존 DM doc 필드 집합)·NT-API-09(`notice_id` 응답 유출) 중 **하나라도 FAIL 이면 즉시 중단·planner 보고**(이후 항목 진행 금지).

---

### 1. `[unit]` 시나리오 — 17건 (순수 함수·계약·정적 검사)

> 실행 방식: 9005 파이썬 환경에서 `notice_service` 를 import 해 **DB 없이** 호출 가능한 함수를 직접 검증. DB 가 필요한 항목(`_read_stats`)은 **읽기 전용 aggregation** 만 수행. 정적 검사 항목은 `grep`/`diff`/코드 리뷰.

#### NT-UNIT-01. `read_rate` 분모 규칙 — done → sent, 미완료 → delivered `[unit]` — 핵심
- Given: `notice_service` 의 read_rate 계산 함수(또는 목록 직렬화 헬퍼), PLAN §3-2 정의
- When: 다음 입력으로 계산하면
  | # | status | sent | delivered | read_count | 기대 read_rate |
  |---|---|---|---|---|---|
  | a | done | 100 | 100 | 50 | 50.0 |
  | b | done | 80 | 100 | 40 | **50.0** (분모=sent=80 → 40/80) |
  | c | sending | 0 | 40 | 10 | **25.0** (분모=delivered=40) |
  | d | failed | 0 | 12 | 3 | **25.0** (분모=delivered) |
- Then: 표의 기대값과 **정확히 일치**. 특히 (b) 는 분모가 `delivered(100)` 가 아니라 `sent(80)` 여야 하고, (c)(d) 는 `sent` 가 0 이므로 `delivered` 로 폴백해야 한다.
- PASS/FAIL: 4행 전부 일치 → PASS. 1행이라도 불일치 → FAIL(분모 정의 위반 — 화면 표기 신뢰 불가).

#### NT-UNIT-02. `read_rate` 0 분모 · 반올림 1자리 `[unit]`
- Given: 동일 함수
- When: ① `status=done, sent=0, delivered=0, read_count=0` ② `status=sending, sent=0, delivered=0, read_count=0` ③ `sent=3, read_count=1` ④ `sent=7, read_count=2` ⑤ `sent=6, read_count=1` 을 계산하면
- Then: ①② **`0.0`** (ZeroDivisionError·`None`·`NaN`·`inf` 발생 시 즉시 FAIL) ③ `33.3` ④ `28.6` ⑤ `16.7` — **소수 1자리 반올림**, 반환 타입은 `float`
- PASS/FAIL: 5건 전부 일치 + 예외 0건 → PASS.

#### NT-UNIT-03. `stale` 판정 경계 — sending & 30분, done/failed 는 항상 false `[unit]` — 핵심
- Given: stale 판정 헬퍼(PLAN §2: `status=="sending" and created_at < now-30분`), 기준시각 `now`
- When: 다음 조합을 판정하면
  | # | status | created_at | 기대 stale |
  |---|---|---|---|
  | a | sending | now − 29분 | **false** |
  | b | sending | now − 30분 정각 | **false** (구현 실측 확정: `_is_stale` 는 `dt < now - timedelta(minutes=30)` 엄격 부등호 — 정각은 아직 stale 아님) |
  | c | sending | now − 31분 | **true** |
  | d | done | now − 10시간 | **false** |
  | e | failed | now − 10시간 | **false** |
  | f | sending | created_at 이 naive UTC | (c) 와 동일 판정 — **tz 혼용으로 인한 9시간 오판 없음** |
- Then: 표대로. (f) 가 어긋나면 naive/aware 비교 버그(TypeError 또는 9시간 오차) → FAIL.
- PASS/FAIL: a·c·d·e·f 정확 일치 + b 일관 → PASS. 판정 중 예외 발생 시 FAIL.

#### NT-UNIT-04. `text_preview` 60자 절단 · `text_len` `[unit]`
- Given: 목록 행 직렬화 헬퍼
- When: text 길이 ① 0자(이론상 미발생 — 방어) ② 59자 ③ 60자 ④ 61자 ⑤ 2000자 ⑥ 개행·이모지 혼합 60자 초과 를 입력하면
- Then: ② `text_preview` == 원문(절단 없음), ③ 원문 그대로(60자), ④⑤ **정확히 60자로 절단**(구현 실측 확정: `text[:TEXT_PREVIEW_LEN]`, `TEXT_PREVIEW_LEN=60` — **말줄임 기호 미부착**이므로 preview 길이가 61자 이상이거나 `…`/`...` 가 붙어 있으면 FAIL. 말줄임 표기는 CSS 몫), ⑥ **중간 잘림으로 인한 인코딩 깨짐 없음**(파이썬 str 슬라이싱 기준 — 결합 이모지 분리 허용, 예외·`UnicodeDecodeError` 0). 전 케이스 `text_len` == **원문 전체 길이**(절단값 아님).
- PASS/FAIL: `text_len` 이 preview 길이와 같아진 케이스가 있으면 FAIL.

#### NT-UNIT-05. audience 라벨 매핑 `[unit]`
- Given: 백엔드 화이트리스트 `{all, users, customers}`(dm_service.BROADCAST_AUDIENCES) + 프론트 라벨 맵
- When: `all`/`users`/`customers`/미지의 값(`admins`·빈문자열·`None`) 을 라벨로 변환하면
- Then: 구현 실측 확정 라벨 — `all → 전체`, `users → 일반 사용자`, `customers → 고객`. **미지의 값은 크래시 없이 `원문 || '-'` 로 폴백**(`AUDIENCE_LABELS[value] || value || '-'` — 빈 화면·`undefined` 문자열 노출 금지). 백엔드 화이트리스트 3종(`BROADCAST_AUDIENCES`)과 프론트 `AUDIENCE_LABELS` 키 집합이 **정확히 일치**(누락·초과 0). 추가로 `AdminNoticesPage.AUDIENCE_LABELS` 와 `AdminBroadcastModal.AUDIENCES` 의 **값·라벨이 동일**한지 대조(표기 일원화 — 어긋나면 FAIL).
- PASS/FAIL: 키 집합 불일치 또는 폴백 시 예외 → FAIL.

#### NT-UNIT-06. `_iso()` tz 명시 — naive→`+00:00`, aware 보존 `[unit]` — 핵심 (v188 회귀 방지)
- Given: `notice_service._iso`(또는 `admin_notices._iso`) — `admin_issues.py:104-113` 방식
- When: ① `datetime(2026,8,19,6,12,0)`(naive) ② `datetime(2026,8,19,6,12,0,tzinfo=timezone.utc)` ③ `datetime(2026,8,19,15,12,0,tzinfo=KST)` ④ `None` ⑤ 문자열 `"x"` 를 통과시키면
- Then: ① `"2026-08-19T06:12:00+00:00"` — **`+00:00` 접미 필수**(없으면 FAIL) ② 동일 문자열(변형 없음) ③ **`+09:00` 유지**(UTC 로 강제 변환하지 않음 — 값 보존) ④ `None` ⑤ 입력 그대로 반환(예외 0)
- 추가 정적 확인: `grep -n "isoformat()" backend_9005/app/routes/admin_notices.py backend_9005/app/services/notice_service.py` → **`_iso` 정의부 외의 직접 `.isoformat()` 호출 0건**(PLAN §4-1: 1줄이라도 있으면 리뷰 반려 → FAIL).
- PASS/FAIL: ①의 `+00:00` 부재 또는 직접 호출 잔존 → FAIL.

#### NT-UNIT-07. `send_message(notice_id=None)` → 생성 doc 필드 집합 **완전 동일** `[unit]` — 핵심 (중단 규칙)
- Given: `dm_service.send_message` 변경분, 기존 필드 집합 `{_id, conversation_id, sender_id, text, created_at, read}`(PLAN §1-3 실측)
- When: ① 정적: 변경된 insert 블록 코드 리뷰 — doc 리터럴이 기존 6키 그대로이고 `notice_id` 는 **조건부(값이 있을 때만) 추가**인지 ② 실측: 테스트 계정 간 일반 DM 1건 전송 후 Mongo 에서 해당 doc 의 **키 집합**을 확인하면
- Then: ① doc 리터럴 6키 불변 + `if notice_id:` 류 가드 존재(무조건 `notice_id: None` 삽입이면 **FAIL** — 기존 doc 과 달라짐) ② 실측 키 집합 == `{_id, conversation_id, sender_id, text, created_at, read}` — **`notice_id` 키가 존재하지 않을 것**(`None` 값으로도 존재하면 FAIL)
- PASS/FAIL: 키 1개라도 증감 → FAIL → **즉시 중단·planner 보고**.

#### NT-UNIT-08. `send_message(notice_id="...")` → `notice_id` 만 additive · str 캐스팅 `[unit]`
- Given: 동일 함수
- When: ① 정적 코드 리뷰 — 삽입값이 `str(notice_id)` 인지(ObjectId 원본 저장 시 `$in` 매칭 타입 불일치로 집계 0 이 됨) ② (승인 후 NT-API-16 수행 시) 공지 메시지 doc 1건의 키 집합·타입을 확인하면
- Then: ① `str(...)` 캐스팅 확인 ② 키 집합 == 기존 6키 + `notice_id` **1개뿐**, `notice_id` 타입 **문자열**, 값 == 해당 공지의 24자 hex id
- 함께 확인: `_deliver_official_message`·`broadcast_message` 가 **pass-through 만** 하고 pending→accepted 승격 블록(dm_service.py:756-765)을 **한 글자도 건드리지 않았는지** diff 리뷰(R4)
- PASS/FAIL: 승격 블록 변경 발견 또는 ObjectId 원본 저장 → FAIL. ②는 승인 전 SKIP 가능(①만으로 부분 PASS 기록).

#### NT-UNIT-09. `_read_stats` 안전성 — 빈 입력·미존재 id·N+1 부재 `[unit]`
- Given: `notice_service._read_stats(mongo, notice_ids)` (읽기 전용)
- When: ① `[]` ② `[None]`/`[""]` ③ 존재하지 않는 24자 hex id 1개 ④ 존재 id + 미존재 id 혼합(승인 후) ⑤ 코드 리뷰: aggregation 호출 횟수 를 확인하면
- Then: ① **`{}` 반환 + Mongo 왕복 0회**(early return — 빈 `$in` 으로 컬렉션 스캔하지 않을 것) ② 예외 없이 안전 처리(`{}` 또는 해당 키 부재) ③ **`{}` 또는 해당 id 키 부재** — 예외·`KeyError` 0 ④ 존재분만 채워지고 미존재분은 호출부에서 `delivered=0, read_count=0` 으로 안전 폴백(→ NT-UNIT-02 의 0 분모 규칙과 연결) ⑤ **`$in` 단일 aggregation 1회**(행마다 `count_documents` 호출 = N+1 이면 FAIL — R6)
- PASS/FAIL: 예외 발생·N+1 발견 → FAIL.

#### NT-UNIT-10. 목록/상세 응답 필드 계약 — 화이트리스트·개인정보 부재 `[unit]` — 핵심
- Given: `notice_service.list_notices`/`get_notice` 직렬화 코드
- When: 반환 dict 의 키 집합을 코드에서 열거하면
- Then: 목록 행 == `{id, text_preview, text_len, audience, status, stale, targets, sent, failed, delivered, read_count, read_rate, admin_id, admin_nickname, admin_code, created_at, finished_at}`(PLAN §3-4), 상세 == 목록 행 + `{text, official_id}`. **다음 키가 어디에도 없을 것**: `birth`/`birthday`/`birth_date`/`gender`/`email`/`phone`/`password`. 하이드레이션은 **`nickname`/`code` 만**(구현 실측 확정: `_hydrate_admins` → `admin_nickname`/`admin_code` 2키. `profile_image` 도 응답에 **없음** — 새로 추가돼 있으면 계약 위반으로 기록).
- 함께 확인: Mongo doc 을 **통째로 `dict(doc)` 로 흘려보내는 코드가 없을 것**(화이트리스트 명시 방식일 것)
- PASS/FAIL: 금지 키 1개라도 존재 또는 doc 통과 방식 → FAIL → **즉시 중단**.

#### NT-UNIT-11. `notices` 문서 스키마 계약 — create/finish/fail 필드 `[unit]`
- Given: `create_notice`/`finish_notice`/`fail_notice` 코드, PLAN §3-1 스키마
- When: 각 함수가 쓰는 필드를 코드에서 열거하면
- Then: ① `create_notice` insert doc == `{text, audience, status:"sending", targets, sent:0, failed:0, admin_id, official_id, created_at, finished_at:None, error:None}`(+`_id` 자동) — **초기 status 는 반드시 `"sending"`**, sent/failed 초기값 0 ② `finish_notice` 는 `{status:"done", sent, failed, finished_at}` 만 `$set` ③ `fail_notice` 는 `{status:"failed", finished_at, error:<예외 타입명>}` 만 `$set` — **`error` 에 예외 메시지 원문·스택트레이스·공지 본문이 들어가지 않을 것**(`type(e).__name__` 만) ④ 세 함수 어디에도 사용자 DM 본문을 읽어 오는 코드 없음
- PASS/FAIL: `error` 에 원문/스택 저장 발견 → FAIL(프라이버시 경계 위반).

#### NT-UNIT-12. `_serialize_message`·`ensure_dm_indexes`·`mark_read`·`send_to_users` 무변경 `[unit]` — 핵심 (R2·R3)
- Given: BASE_REV `d19af4b`
- When: `git diff d19af4b..HEAD -- backend_9005/app/services/dm_service.py` 를 검토하면
- Then: 변경이 **`send_message` 시그니처+조건부 doc 필드 / `_deliver_official_message` pass-through / `broadcast_message` pass-through / 로그 라인 `notice=` 추가** 로 한정. 다음 4개는 **diff 0줄**:
  - `_serialize_message`(dm_service.py:120-128) — 화이트리스트 6필드 그대로(`notice_id` 미노출)
  - `ensure_dm_indexes`(:66-81) — 기존 인덱스 6종 그대로
  - `mark_read`(:561-595) — pending no-op 분기 포함 전부
  - `send_to_users`(지정발송) — `notice_id` 미부착
- 추가: `grep -rn "send_message(" backend_9005 backend_9004` 로 호출부 3곳(dm.py:214·admin_cs.py:177·dm_service.py:766)이 전부 **기존 positional 인자 그대로**인지 확인(R1)
- PASS/FAIL: 4함수 중 1줄이라도 변경 → FAIL.

#### NT-UNIT-13. `AdminBroadcastModal` props additive — 미전달 시 현행 100% 동일 `[unit]` (R8)
- Given: `frontend_admin/src/components/AdminBroadcastModal.jsx` diff
- When: ① 신규 props(`initialText=''`, `initialAudience=''`, `title='📢 전체 발송'`) **기본값 존재** 확인 ② `open` 이 false→true 로 전이할 때만 seed 하는 `useEffect` 의존성 배열 확인 ③ 기존 검증·`window.confirm`·429/403/400/503 분기·`reset()` 코드 diff 확인 하면
- Then: ① 3개 props 전부 기본값 보유 — 미전달 호출(AdminCsPage)에서 `undefined` 참조 0 ② seed 가 **열릴 때 1회**만 동작(매 렌더 seed → 사용자 입력 덮어쓰기면 FAIL) ③ **기존 로직 diff 0**(발송 확인 절차가 약화되지 않았을 것 — `window.confirm` 제거·조건부화 시 즉시 FAIL)
- 함께 확인: `AdminCsPage.jsx` 호출부가 **무변경**(PLAN §4 F4)
- PASS/FAIL: `window.confirm` 약화 또는 호출부 변경 → FAIL.

#### NT-UNIT-14. 로그 규율 정적 검사 — `notice=` 추적자 · 본문 원문 미출력 `[unit]` — 핵심
- Given: PLAN §4 로그 규율(추가/수정 로그 전부 `notice=%s` 포함, 본문 원문 금지)
- When: ① `grep -n "logger\.\(info\|warning\|error\|exception\)" backend_9005/app/services/notice_service.py backend_9005/app/routes/admin_notices.py` 로 신규 로그 전수 열거 ② `admin_cs.py`·`dm_service.py` 의 **변경된 로그 라인** diff 열거 ③ 각 라인의 포맷 인자에 `text`(원문 변수)가 전달되는지 검사 ④ 프론트 `grep -n "console\." frontend_admin/src/pages/AdminNoticesPage.jsx` 하면
- Then: ① 백엔드 신규 로그 전부에 `notice=` 토큰 존재(인덱스 생성 로그 등 notice 무관 라인은 예외로 기록) ② 변경 라인 전부 `notice=` 포함(값 없으면 `-`) ③ **포맷 인자에 본문 문자열이 전달되는 라인 0건** — `len(text)`/`text_len` 만 허용 ④ 프론트 콘솔 로그가 `{page, count}`·`{notice: id.slice(0,8)}`·`{text_len}` 수준 — **본문·닉네임 원문 출력 0건**
- PASS/FAIL: 본문 전달 라인 1개라도 발견 → FAIL(프라이버시 경계 §2-③ 위반).

#### NT-UNIT-15. 9004 미러 정적 동일성 — 대상 6파일 `diff -q` `[unit]` (R13)
- Given: 변경 대상 6파일
- When: 아래를 실행하면
  ```bash
  for f in app/services/notice_service.py app/routes/admin_notices.py \
           app/services/dm_service.py app/routes/admin_cs.py \
           app/routes/dm.py app/main.py; do
    diff -q "backend_9005/$f" "backend_9004/$f"
  done
  ```
- Then: **6개 전부 출력 없음(바이트 동일)**. 9004 에만 있는 `_logs.py` 파일명 예외는 이번 대상 밖(변경 대상 아님 — 변경됐으면 FAIL).
- PASS/FAIL: 차이 1건이라도 출력 → FAIL.

#### NT-UNIT-16. 관리자 앱 정적 위생 — 라우트·네비·eslint·빌드 `[unit]`
- Given: 관리자 앱 소스, 선행 절차(하드 새로고침·빌드 표기 기록) 완료
- When: ① `App.jsx` 에 `/notices` 라우트 1개 추가(`*` 리다이렉트 이후가 아닌 **앞**에 위치) ② `AdminLayout.jsx` NavLink 9개(기존 8 + 공지 관리) ③ `api.js` 에 `getAdminNotices`/`getAdminNoticeDetail` 추가 + **컴포넌트 직접 fetch/axios 호출 0건**(`grep -rn "axios\|fetch(" frontend_admin/src/pages/AdminNoticesPage.jsx`) ④ `npx eslint` ⑤ 빌드 표기 하면
- Then: ①② 정확히 1개씩 additive(기존 라우트 13개·NavLink 8개 **무삭제·무순서변경**) ③ 직접 호출 0건 ④ **신규 eslint 경고/에러 0** ⑤ 빌드 표기 갱신 확인
- PASS/FAIL: 기존 항목 삭제·순서 파괴 또는 신규 lint 오류 → FAIL.

#### NT-UNIT-17. notice 생성 실패 → 500 + 발송 미실행 분기 `[unit]` (R11)
- Given: `broadcast_cs` 변경분 코드
- When: 코드 경로를 리뷰하면
- Then: ① `create_notice` 는 **Redis 락 획득 이후**에 호출(429 로 튕긴 요청이 유령 공지 문서를 만들지 않음 — PLAN §3-5) ② `create_notice` 예외 시 **`background_tasks.add_task` 미호출 + 500 반환** ③ 감사 로그 적재 실패는 **best-effort**(발송 유지 — 기존 동작 보존) ④ `_run_cs_broadcast` 는 예외 시 `fail_notice` 를 부르고 **재발송을 시도하지 않음**
- PASS/FAIL: 순서 역전(락 전 생성) 또는 생성 실패인데 add_task 진행 → FAIL.

---

### 2. `[api]` 시나리오 — 17건

> **공통 안전**: 아래 어떤 curl 도 `POST /api/admin/cs/broadcast` 를 **200 으로 성립시키지 않는다**(NT-API-16·17 승인분 제외). 토큰은 전부 플레이스홀더.

#### NT-API-01. `GET /api/admin/notices` 200 · 필드 계약 · 정렬 · 페이지네이션 `[api]` — 핵심
- Given: `ADMIN_TOKEN`(테스트 관리자), 기존 공지 문서 0건 이상
- When:
  ```bash
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices?page=1&limit=20"
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices?page=2&limit=5"
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices?audience=users"
  ```
- Then: ① **200** + 최상위 `{notices: [...], pagination: {page, limit, total, pages}}` ② 각 행 키 집합 == NT-UNIT-10 목록 계약 17키(초과·누락 0) ③ `created_at` 이 **내림차순**(연속 쌍 비교로 검증 — 1건 이하면 "정렬 검증 불가"로 기록) ④ page=2&limit=5 의 첫 행이 page=1&limit=5 의 6번째 행과 동일(중복·누락 0), `pages == ceil(total/limit)` ⑤ `audience=users` 필터 시 결과 전부 `audience=="users"` ⑥ 공지 0건이어도 `{notices: [], pagination:{total:0,...}}` 로 **200**(500·null 금지)
- PASS/FAIL: 상기 6항 전부 충족 → PASS.

#### NT-API-02. 목록 검증·인가 — audience 400 · limit 클램프 · 401 · 403 `[api]`
- Given: `ADMIN_TOKEN`, `USER_TOKEN`(비관리자 테스트 계정)
- When: ① `?audience=admins` ② `?audience=%20` ③ `?limit=1000` ④ `?limit=0` / `?page=0` / `?page=-1` ⑤ **Authorization 헤더 없이** ⑥ `USER_TOKEN` 으로 호출하면
- Then: ①② **400**(`{"error": ...}` — 한국어 안내, 스택트레이스·내부 경로 미노출) ③ **limit 100 으로 클램프**(200, `pagination.limit == 100`) ④ page/limit 최소 1 로 클램프(200) — 500·음수 offset 금지 ⑤ **401** ⑥ **403**
- PASS/FAIL: 500 발생·403 대신 200 → FAIL(인가 우회 = 즉시 중단·보고).

#### NT-API-03. `GET /api/admin/notices/{id}` — 200(text 전문)·400·404·인가 `[api]` — 핵심
- Given: `ADMIN_TOKEN`, 유효 `<notice-id>`(없으면 승인 후 NT-API-16 이후 수행 — 그전까지 400/404/인가만 검증)
- When:
  ```bash
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices/<notice-id>"
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices/not-an-objectid"
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices/000000000000000000000000"
  curl -s "http://localhost:9005/api/admin/notices/<notice-id>"          # 무토큰
  ```
- Then: ① 200 + `{notice: {...}}` 에 **`text` 전문 포함**(목록의 `text_preview` 와 달리 절단 없음, `text_len` 과 실제 `len(text)` 일치) + `official_id` 포함 ② `not-an-objectid` → **400**(500 아님 — `InvalidId` 가 새면 FAIL) ③ 형식은 맞지만 미존재 → **404** ④ 무토큰 **401**, `USER_TOKEN` **403**
- PASS/FAIL: ②가 500 이면 FAIL(예외 누출).

#### NT-API-04. 응답 시각 tz — 전 시각 필드 `+00:00` `[api]` — 핵심 (R12·v188 회귀 방지)
- Given: NT-API-01·03 응답 전문
- When: 응답 JSON 의 `created_at`·`finished_at` 값을 전수 검사하면
- Then: ① **모든 non-null 시각 값이 `+00:00`(또는 `Z`) 로 끝남** — tz 미표기 ISO 문자열이 **0건** ② `finished_at` 은 `status=="sending"` 행에서 `null` 허용(빈 문자열·`"None"` 문자열이면 FAIL) ③ 값을 `datetime.fromisoformat` 으로 파싱했을 때 `tzinfo` 가 **not None** ④ 동일 공지의 `finished_at >= created_at`
- 검증 보조:
  ```bash
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/notices" \
    | grep -o '"\(created_at\|finished_at\)":"[^"]*"' | grep -v '+00:00' | grep -v 'null'
  # 기대: 출력 0줄
  ```
- PASS/FAIL: tz 미표기 1건이라도 → FAIL(화면 9시간 밀림 확정 — NT-E2E-05 와 교차).

#### NT-API-05. `POST /api/admin/cs/broadcast` 검증·인가 분기 — **실발송 0** `[api]` — 핵심 (회귀 3)
- Given: `ADMIN_TOKEN`, `USER_TOKEN`. **모든 케이스가 200 이 아닌 응답으로 끝나야 한다**
- When:
  ```bash
  # a) 빈 text → 400
  curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
    -d '{"audience":"users","text":"   "}' http://localhost:9005/api/admin/cs/broadcast
  # b) 2001자 → 400
  curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
    -d "{\"audience\":\"users\",\"text\":\"$(python3 -c 'print("A"*2001)')\"}" \
    http://localhost:9005/api/admin/cs/broadcast
  # c) 잘못된 audience → 400 (text 는 유효하게 두어 audience 분기만 확인)
  curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
    -d '{"audience":"admins","text":"[v194-test] validation only"}' \
    http://localhost:9005/api/admin/cs/broadcast
  # d) 비관리자 → 403 / e) 무토큰 → 401
  ```
- Then: (a)(b)(c) **400** + 한국어 안내(`메시지는 1~2000자여야 합니다.` / `발송 대상이 올바르지 않습니다.`) (d) **403** (e) **401**. **전 케이스에서**: ① `notices` 컬렉션 문서 수 **증가 0**(락 획득 전 검증 단계에서 반려 — PLAN §3-5 순서) ② `dm_messages` 문서 수 증가 0 ③ `admin_logs` 에 신규 `cs_broadcast` 행 0 ④ 서버 로그에 `[admin-cs] broadcast queued` **0건**
- 경계 확인: **2000자 정확(허용 상한)은 시도하지 않는다** — 성공하면 실발송이므로 금지. 상한 준수는 NT-UNIT-04 와 코드 리뷰로 갈음.
- PASS/FAIL: 어느 케이스든 200 반환 시 **즉시 중단·planner 보고**(실발송 발생 가능성 — 대상 수·로그 즉시 확인).

#### NT-API-06. 중복 락 429 — Redis 락 수동 선점(실발송 0) `[api]` (회귀 3) — **§5-B 승인 필요**
- Given: `<official-id>`(공식 계정 uuid — 관리자 조회 API 또는 dev 제공), Redis 접근
- When: ① Redis 에 락 키를 **직접 선점**
  ```bash
  redis-cli SET "dm:broadcast:lock:<official-id>" 1 NX EX 30
  ```
  ② 즉시 유효한 body 로 broadcast 호출(`{"audience":"users","text":"[v194-test] lock path"}`) ③ 30초 후 키 자연 만료 확인(`redis-cli TTL`) 하면
- Then: ② **429** + `방금 발송한 건이 처리 중입니다...` 안내 ③ 락 키가 TTL 로 자연 소멸(수동 DEL 불필요). **부수효과 0**: `notices` 증가 0(락 실패 시 create_notice 미도달 — PLAN §3-5), `dm_messages` 증가 0, `admin_logs` 신규 0, `[admin-cs] broadcast queued` 로그 0건. 서버 로그에 `[admin-cs] broadcast denied (duplicate, locked)` 1건
- 안전: **실발송을 먼저 일으켜 락을 만드는 방식 금지.** 락을 수동 선점하는 이 방식만 허용하며, 30초 동안 실제 전체발송이 차단되는 것은 **의도된 안전 부작용**.
- PASS/FAIL: 429 미반환 또는 notices/dm_messages 증가 → FAIL.

#### NT-API-07. `POST /api/dm/broadcast` → **410 Gone**, 무토큰 401 유지 `[api]` — 핵심
- Given: `ADMIN_TOKEN`, `USER_TOKEN`
- When:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
    -d '{"audience":"users","text":"[v194-test] deprecated path"}' \
    http://localhost:9005/api/dm/broadcast
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Content-Type: application/json" \
    -d '{"audience":"users","text":"x"}' http://localhost:9005/api/dm/broadcast   # 무토큰
  ```
- Then: ① 관리자 토큰 **410**(+ 대체 경로 안내 메시지) ② 비관리자 토큰도 **410**(인증은 통과하되 경로 자체가 소멸 — 403/200 이면 FAIL) ③ **무토큰은 401 유지**(410 을 먼저 반환해 무인증 스캐너에 경로 존재를 알리지 않을 것 — PLAN §3-6) ④ **부수효과 0**: dm_messages·notices·admin_logs 증가 0 ⑤ 서버 로그 `[dm-broadcast] gone (deprecated endpoint) me=...` 1건, **본문 원문 미출력**
- PASS/FAIL: 무토큰이 410 을 받으면 FAIL(정보 노출), 200 이면 즉시 중단(실발송 위험).

#### NT-API-08. 프라이버시 경계 — 본문 저장 범위·개인정보 부재 `[api]` — 핵심 (회귀 10, 중단 규칙)
- Given: `ADMIN_TOKEN`, Mongo/PG 읽기 접근
- When: ① `notices` 컬렉션의 **모든 문서의 `admin_id`·`official_id` 가 관리자/공식 계정 uuid 인지**, 문서 수가 "관리자가 지시한 전체발송 건수"와 일치하는지 ② 사용자↔사용자 DM 을 1건 보낸 뒤 `notices` 문서 수 **증가 0** 인지 ③ `admin_logs` 의 `cs_broadcast` 행 `details` 키 집합 확인 ④ NT-API-01·03 응답 전문에 개인정보 키 검색 ⑤ 서버 로그·브라우저 콘솔 grep 하면
- Then: ① `notices.text` 가 **관리자 작성 공지 전용** — 사용자 DM 본문 유입 0 ② 사용자 DM 전송이 `notices` 에 아무 것도 만들지 않음 ③ `details` 키 == `{targets, text_len, notice_id}` — **`text` 키 부재**(본문이 PG 로 넘어가지 않음) ④ 응답에 `birth*`/`gender`/`email`/`phone` **0건** ⑤ 로그·콘솔에 공지 본문 원문·이메일·생년월일 **0건**
- 기록 규칙: 관측된 개인정보 실제 값은 **산출물에 옮겨 적지 않는다** — "해당 키 0건" 형태로만 기재.
- PASS/FAIL: 1항이라도 위반 → FAIL → **즉시 중단·planner 보고**.

#### NT-API-09. 기존 DM 송수신 무회귀 + `notice_id` 응답 미노출 `[api]` — 핵심 (회귀 1, 중단 규칙)
- Given: 테스트 계정 A/B(`<test-user-a>`/`<test-user-b>`), 각 토큰
- When: ① A→B 대화 생성 `POST /api/dm/conversations` ② A 가 메시지 2건 전송 `POST /api/dm/conversations/<cid>/messages` ③ B 가 조회 `GET /api/dm/conversations/<cid>/messages` ④ B 가 답장 1건 ⑤ 목록 `GET /api/dm/conversations` ⑥ Mongo 에서 해당 메시지 doc 키 집합 확인 하면
- Then: ①~⑤ 전부 **200** + 기존 동작 그대로(순서·본문·읽음 플래그) ③ 각 메시지 객체 키 집합 == `{id, conversation_id, sender_id, text, created_at, read}` — **`notice_id` 키 부재**(`_serialize_message` 불변 증명, R2) ⑥ Mongo doc 키 집합 == 기존 6키(NT-UNIT-07 실측과 동일 결론) ⑦ `created_at` 이 `+00:00` 표기 유지(기존 `dm_service._iso` 동작)
- 검증 보조:
  ```bash
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/dm/conversations/<cid>/messages" | grep -c 'notice_id'
  # 기대: 0
  ```
- PASS/FAIL: `notice_id` 노출 1건 → FAIL → **즉시 중단**.

#### NT-API-10. 메시지 요청함(pending) 무회귀 `[api]` (회귀 2)
- Given: 테스트 계정 A/B(서로 미팔로우 등 pending 유발 조건), 각 토큰
- When: ① A→B 최초 메시지로 **pending 대화 생성** ② B 가 `GET /api/dm/requests` 로 확인 ③ **pending 상태에서 B 가 답장 시도** ④ B 가 `POST /api/dm/conversations/<cid>/accept` ⑤ 수락 후 B 답장 ⑥ 별도 pending 대화를 만들어 B 가 `DELETE /api/dm/conversations/<cid>` (거절) ⑦ 거절 후 Mongo 에서 대화·메시지 잔존 확인 하면
- Then: ① 201/200 + `status=="pending"` ② 요청 목록에 1건 ③ **403**(pending 수신자 답장 차단 — dm_service.py:510-514) ④ 200 + `status=="accepted"` ⑤ **200**(수락 후엔 답장 가능) ⑥ 200 ⑦ **hard delete** — 대화 doc 0건 + 해당 `conversation_id` 의 `dm_messages` 0건
- PASS/FAIL: ③이 200 이면 FAIL(게이트 붕괴), ⑦에 잔존 문서 있으면 FAIL.

#### NT-API-11. 읽음 표시·미읽음 뱃지·pending no-op `[api]` — 핵심 (회귀 5)
- Given: NT-API-09 의 대화 `<cid>`, NT-API-10 의 pending 대화 `<pending-cid>`, CS 대화 `<cs-cid>`(테스트 계정 ↔ 공식 계정)
- When: ① B 토큰으로 `POST /api/dm/conversations/<cid>/read` ② 직후 `GET /api/dm/unread-count`(B) ③ A 토큰으로 `GET /api/dm/conversations/<cid>/messages` 재조회(상대 읽음 동기화) ④ 관리자 토큰으로 `POST /api/admin/cs/conversations/<cs-cid>/read` ⑤ `GET /api/admin/cs/unread-count` ⑥ **pending 수신자**(B)가 `POST /api/dm/conversations/<pending-cid>/read` 하면
- Then: ① **200** + `{"read": true, "marked": N>0}` ② B 의 unread 합계가 해당 대화분만큼 **감소**(0 이면 0) ③ A 가 보낸 메시지들의 `read == true`(읽음 표시 동기화 — WS `read` 이벤트 경로는 NT-E2E-06 에서 화면 확인) ④ 200 + `marked` 반영, 해당 CS 대화 unread 0 ⑤ 200 + 관리자 미읽음 총합이 ④ 반영값 ⑥ **200 + `{"read": false, "marked": 0}`**(pending no-op 유지 — dm_service.py:573-578). 전 항목에서 `mark_read` 코드 무변경(NT-UNIT-12)과 교차 정합.
- PASS/FAIL: ⑥이 `marked > 0` 이면 FAIL(요청 열람 사실이 발신자에게 노출 — 프라이버시 회귀).

#### NT-API-12. CS 지정발송(v177) 무회귀 + 공지 이력 미편입 `[api]` — 핵심 (회귀 4)
- Given: `ADMIN_TOKEN`, 테스트 계정 1명(`<test-user-a>`), 사전 `GET /api/admin/notices` 의 `pagination.total` 값 기록
- When: ①
  ```bash
  curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
    -d '{"user_ids":["<test-user-a>"],"text":"[v194-test] 지정발송 무회귀 확인"}' \
    http://localhost:9005/api/admin/cs/send
  ```
  ② 직후 `GET /api/admin/notices` 재조회 ③ 해당 메시지 doc 확인 ④ 검증 분기(빈 user_ids 400 / 21명 400 / 잘못된 uuid 400 / 빈 text 400) 하면
- Then: ① **200** + `{requested:1, sent:1, failed:0, failed_ids:[]}`(v177 응답 형식 불변) ② **`pagination.total` 증가 0** + 목록 최상단이 사전 조회와 동일(공지 이력에 편입되지 않음 — PLAN §3-2·§6) ③ 해당 `dm_messages` doc 에 **`notice_id` 키 부재**(`send_to_users` 무변경 — NT-UNIT-12) ④ 4개 케이스 전부 400 + 기존 안내 문구
- 안전: 지정발송 대상은 **테스트 계정 1명뿐**. 실사용자 uuid 사용 금지.
- PASS/FAIL: ②에서 공지 행이 생기면 FAIL(범위 위반), ③에 `notice_id` 있으면 FAIL.

#### NT-API-13. 관리자 로그 — `cs_broadcast` details additive `[api]` (회귀 6)
- Given: `ADMIN_TOKEN`, v190 이전에 적재된 기존 `cs_broadcast` 행(있으면) + v194 이후 행(승인 후 NT-API-16 로 생성)
- When:
  ```bash
  curl -s -H "Authorization: Bearer YOUR_TOKEN" \
    "http://localhost:9005/api/admin/logs?action=cs_broadcast&limit=20"
  ```
- Then: ① **200** + 기존 응답 스키마 불변(`{logs:[{id, admin_id, admin_nickname, action, target_type, target_id, details, created_at, target_nickname, target_code}], pagination:{...}}`) ② **v194 이후 행**의 `details` == `{targets, text_len, notice_id}` — `targets`·`text_len` **유지**(제거·개명 시 FAIL), `notice_id` **추가** ③ **`details.text` 부재**(본문 미저장) ④ **구버전 행**(details 에 `notice_id` 없음)도 200 으로 정상 반환되고 프론트가 깨지지 않을 것(하위호환) ⑤ `created_at` tz 표기 유지 ⑥ `action=cs_send` 필터도 기존대로 동작
- PASS/FAIL: ②③ 위반 → FAIL. ②는 승인 전이면 `SKIP(승인 대기)` + ①③④⑤⑥만 판정.

#### NT-API-14. 인덱스 실측 — `(notice_id, read)` sparse · `notices.created_at` · 기존 6종 유지 `[api]` (회귀 8·R5)
- Given: Mongo 읽기 접근. **인덱스 생성은 앱의 `ensure_notice_indexes()` lazy 호출에 맡기고 tester 는 생성/삭제하지 않는다**
- When: ① `GET /api/admin/notices` 를 1회 호출해 lazy 생성 트리거 ② `db.dm_messages.getIndexes()` ③ `db.notices.getIndexes()` ④ `db.dm_conversations.getIndexes()` / `db.dm_blocks.getIndexes()` 하면
- Then: ② `dm_messages` 에 **`[("notice_id",1),("read",1)]` 존재 + `sparse: true`**(sparse 누락 시 FAIL — 사적 DM 전량이 인덱스에 유입) + 기존 `[(conversation_id,1),(created_at,1)]`·`conversation_id` **유지** ③ `notices` 에 **`created_at` 인덱스 존재**(+ 기본 `_id_`) ④ 기존 DM 인덱스 **6종 전부 유지**(`dm_conversations.pair_key unique`·`participants`·`last_at`·`dm_messages` 2종·`dm_blocks` 복합 unique) — 삭제·옵션 변경 0
- 참고: 인덱스 미생성 상태 배포 시 대량 공지 집계가 full scan(R5) → **본 항목은 릴리스 게이트**.
- PASS/FAIL: sparse 누락 또는 기존 인덱스 감소 → FAIL.

#### NT-API-15. 9004 런타임 동일 `[api]` (회귀 9·R13)
- Given: 9004 기동 상태, `ADMIN_TOKEN`
- When: ① `GET http://localhost:9004/api/admin/notices` ② `POST http://localhost:9004/api/dm/broadcast`(관리자 토큰) ③ 무토큰 동일 호출 ④ `GET http://localhost:9004/api/admin/notices/not-an-objectid` 하면
- Then: ① **200** + 9005 와 **동일한 필드 계약**(키 집합 동일 — 데이터 내용은 동일 DB 이므로 총건수도 일치해야 함) ② **410** ③ **401** ④ **400**. NT-UNIT-15 의 `diff -q` 결과와 교차 정합.
- PASS/FAIL: 응답 코드/키 집합 불일치 → FAIL.

#### NT-API-16. 격리 실발송 1건 — 읽음 통계 산출 E2E `[api]` — **§5-A 승인 필요 · 승인 전 실행 금지**
- Given: **planner 승인 완료**(§5-A) + 격리 조건 구성 완료 — `audience` 필터(`role = ANY(...) AND NOT is_banned AND account_status='active' AND id <> official`)가 **테스트 계정 1~2개만 매칭**하는 상태. 착수 직전 `GET`/`count_broadcast_targets` 상당 값으로 **대상 수가 1~2 임을 재확인**하고, 3 이상이면 **중단**
- When: ① 관리자 앱 또는 curl 로 전체발송 1건(`text = "[v194-test] 읽음 통계 검증 <타임스탬프>"`) ② `GET /api/admin/notices` 최상단 행 확인 ③ 배경 완료 후(수 초) 재조회 ④ 테스트 수신 계정으로 DM 열람 + `POST /api/dm/conversations/<cid>/read` ⑤ `GET /api/admin/notices/<notice-id>` 재조회 하면
- Then: ① 200 `{queued: 1~2, audience, notice_id}` — **`notice_id` additive 필드 존재** ② 즉시 `status=="sending"`, `targets==queued`, `sent==0`, `failed==0`, `delivered` 는 진행 중 값, `stale==false`, `finished_at==null` ③ `status=="done"`, `sent + failed == targets`, `finished_at` non-null 이며 `+00:00` 표기 ④ 200 `marked>=1` ⑤ **`read_count` 가 1 증가**하고 `read_rate == round(read_count/sent*100, 1)` — NT-UNIT-01·02 규칙과 **수치 일치** ⑥ 전 과정에서 **실사용자 계정에 DM 이 가지 않았을 것**(대상 계정 목록을 발송 전 스냅샷으로 확보해 대조)
- 안전: 대상 수 3 이상이면 즉시 중단. 발송 후 `dm_messages` 증가분이 `queued` 와 정확히 일치하는지 확인(초과 시 격리 실패 → 즉시 보고).
- PASS/FAIL: 승인 전 = `SKIP(승인 대기)`. 승인 후 ①~⑥ 전부 충족 → PASS.

#### NT-API-17. 디버깅 로그 추적 체인 — 동일 `notice=` 값 `[api]` — **§5-A 승인 필요(NT-API-16 과 동시 수행)**
- Given: NT-API-16 의 발송 1건, 그 `<notice-id>` 앞 8자 = `<n8>`, 백엔드 9005 로그
- When: `docker logs`(또는 로그 파일)에서 `grep "notice=<n8>"` 하면
- Then: **동일 `notice=<n8>` 값으로 아래 체인이 시간순으로 전부 추적**될 것
  1. `[admin-cs] broadcast notice created notice=<n8> admin=... targets=...`
  2. `[admin-cs] broadcast queued admin=... audience=... targets=... notice=<n8>`
  3. `[admin-cs] broadcast background start notice=<n8> ...`
  4. `[dm-broadcast] start ... notice=<n8>`
  5. `[dm] message sent conv=... me=... peer=... len=... notice=<n8>` (대상 수만큼)
  6. `[dm-broadcast] done ... notice=<n8>`
  7. `[admin-cs] broadcast background done notice=<n8> sent=... failed=...`
  - 추가: `[notice] created ...` / `[notice] finished notice=<n8> sent=.. failed=..` 도 동일 값
  - **본문 원문이 어떤 라인에도 없을 것**(길이만 — `grep "<발송 본문 일부>"` 결과 0줄)
  - 같은 시간대의 **일반 DM 로그는 `notice=-`**(공지와 섞이지 않음)
- 판정 보조: 7단계 중 누락 단계가 있으면 그 단계명을 기록(로그 규율 미흡 — FAIL 사유), 값이 단계별로 다르면 추적자 불일치 → FAIL
- PASS/FAIL: 승인 전 = `SKIP(승인 대기)`. 승인 후 7단계 전부 동일 값 + 본문 0건 → PASS. **정적 포맷 검증(라인 존재·`notice=` 토큰 포함)은 승인과 무관하게 NT-UNIT-14 로 선행 수행**.

---

### 3. `[e2e]` 시나리오 — 7건 (사람이 화면에서만 확인 가능한 것에 한정 · 행동 수준 초안)

> 셀렉터·내부 state 이름에 의존하지 않는다. "무엇을 보고 무엇을 눌렀는가" 수준으로 기술한다. **어떤 시나리오도 실제 발송을 완료하지 않는다.**

#### NT-E2E-01. `/notices` 진입 · 사이드바 노출 · 목록 렌더 `[e2e]` — 핵심
- Given: 관리자 계정(`<admin-email>`)으로 관리자 앱 로그인, 하드 새로고침 + 빌드 표기 기록 완료
- When: ① 사이드바를 본다 ② "공지 관리" 항목을 클릭한다 ③ 목록 화면을 확인한다 ④ (공지 0건인 경우) 빈 상태 문구를 확인한다 ⑤ 페이지네이션이 있으면 2페이지로 이동한다
- Then: ① 기존 8개 메뉴가 **그대로 있고** 그 아래(감사로그/오류신고 인접 위치)에 "공지 관리" 1개가 추가돼 보인다 — 기존 메뉴 사라짐·순서 뒤바뀜 0 ② URL 이 `/notices` 로 바뀌고 화면이 뜬다(빈 화면·리다이렉트·404 없음) ③ 목록에 **발송시각 / 관리자 / 대상 / 발송수 / 성공·실패 / 읽음 N명 (X%) / 상태** 가 보인다. `읽음` 표기는 `N명 (X%)` 형태로 소수 1자리, 분모 0 인 행은 `0명 (0.0%)` 로 표시되고 `NaN`·`undefined`·`Infinity` 문구가 **어디에도 없다** ④ 빈 상태에서 에러 배너·무한 로딩 없이 안내 문구가 뜬다 ⑤ 2페이지 이동 시 목록이 바뀌고 중복 행이 없다
- 확인: 브라우저 콘솔 신규 에러 **0건**, 콘솔에 공지 본문 원문·닉네임 원문·이메일 **0건**
- 증적: 목록 화면 스크린샷(빌드 표기 포함, 실사용자 개인정보 미노출 상태로)

#### NT-E2E-02. 행 클릭 확장 → 본문 전문 표시 `[e2e]`
- Given: NT-E2E-01 의 목록 화면, 공지 1건 이상(없으면 NT-API-16 승인 후 수행)
- When: ① 목록의 한 행을 클릭한다 ② 확장된 영역을 읽는다 ③ 같은 행을 다시 클릭한다 ④ 다른 행을 클릭한다 ⑤ 텍스트를 드래그 선택해 본다
- Then: ① 행 아래로 상세가 펼쳐진다(페이지 이동 없음) ② **공지 본문 전문**이 보인다 — 목록의 60자 미리보기와 달리 절단되지 않고, 개행이 보존돼 읽을 수 있다 ③ 다시 접힌다(토글) ④ 이전 행 처리 방식(닫힘/동시 열림)이 **일관**되게 동작한다 ⑤ 드래그 선택이 행 토글을 유발하지 않는다(AdminIssuesPage 의 드래그 가드 관행 승계 — 미구현이면 개선 제안으로 기록, FAIL 아님)
- 확인: 확장/축소 반복 5회에 레이아웃 붕괴·콘솔 에러 0

#### NT-E2E-03. "이 공지 재발송" → 모달 prefill 확인 후 **`window.confirm` 취소** `[e2e]` — 핵심 (실발송 0)
- Given: NT-E2E-02 의 확장된 상세, 해당 공지의 본문·대상을 **서버 응답값으로 미리 확보**
- When: ① "이 공지 재발송" 버튼을 누른다 ② 열린 모달의 본문 입력란과 대상 선택 상태를 확인한다 ③ 대상을 다른 값으로 바꿔 본다 ④ 발송 버튼을 누른다 ⑤ 브라우저 확인창에서 **"취소"** 를 누른다 ⑥ 모달을 닫는다 ⑦ 목록을 새로고침한다
- Then: ① 모달이 열린다 ② **본문이 원문 그대로 채워져 있고**(글자 수 카운터가 `text_len` 과 일치) **대상이 원 공지의 대상으로 선택돼 있다** ③ 대상 변경이 자유롭게 된다(본문은 유지) ④ **브라우저 확인창이 반드시 뜬다**(안 뜨고 바로 발송되면 **즉시 중단·planner 보고**) ⑤ 취소 후 **아무 것도 발송되지 않는다** ⑥ 모달이 닫힌다 ⑦ **목록에 새 행이 생기지 않는다**(`pagination.total` 불변)
- 확인(필수): 서버 로그에 `[admin-cs] broadcast queued` **0건**, `notices` 문서 수 증가 **0**, `dm_messages` 증가 **0**
- 안전: **④에서 확인창의 "확인"을 누르는 것은 이 시나리오에서 금지**(NT-API-16 승인 항목에서만 허용)

#### NT-E2E-04. 발송 모달 두 진입점 — 열기→취소→재열기 잔존 없음 `[e2e]` (회귀 7·R8)
- Given: 관리자 앱, `/notices` 와 `/cs` 두 화면
- When: **`/notices` 에서** ① 헤더 "공지 발송" 버튼을 누른다 ② 본문에 아무 글자를 입력하고 대상을 고른다 ③ 모달을 **취소/닫기** 한다 ④ 다시 연다 / **`/cs` 에서** ⑤ 헤더 "전체 발송" 버튼을 누른다 ⑥ 대상을 고르지 않고 발송을 시도한다 ⑦ 2000자를 넘겨 입력해 본다 ⑧ 입력 후 닫았다가 다시 연다
- Then: ① 모달이 **빈 상태**로 열린다(재발송과 달리 prefill 없음) ③④ **재열기 시 이전 입력이 남아 있지 않다** ⑤ CS 페이지 모달이 **기존과 동일하게** 열린다(props 추가에도 호출부 무변경 — 제목·레이아웃·문구 그대로) ⑥ **대상 미선택 안내 문구**가 뜨고 발송이 진행되지 않는다 ⑦ **2000자 카운터**가 동작하고 초과 입력이 막히거나 초과 경고가 뜬다 ⑧ 입력 잔존 없음(현행과 동일)
- 확인: 전 과정에서 확인창의 "확인"을 누르지 않는다 — `[admin-cs] broadcast queued` 로그 **0건**
- 판정: ⑤⑥⑦⑧ 중 하나라도 v190 대비 달라지면 **FAIL**(CS 전체발송 회귀)

#### NT-E2E-05. 발송시각 표기 — **9시간 밀림 없음** `[e2e]` — 핵심 (R12·v188 회귀 방지)
- Given: 공지 1건 이상, 해당 공지의 **서버 원본값**을 API 응답에서 미리 확보(예: `created_at = 2026-08-19T06:12:00+00:00`)
- When: ① `/notices` 목록의 발송시각 셀을 읽는다 ② 행을 펼쳐 상세의 시각(완료시각 포함)을 읽는다 ③ `/logs` 화면의 같은 건 시각과 대조한다 ④ (있으면) `/issues` 의 시각 표기 방식과 비교한다
- Then: ① 화면값이 **서버 원본 UTC + 9시간(KST)** 과 정확히 일치 — 위 예시라면 `2026-08-19 15:12`. **`06:12`(UTC 그대로 표기)** 나 **`2026-08-18 21:12`(9시간 더 밀림)** 이 보이면 **FAIL** ② 완료시각도 동일 규칙, `status=="sending"` 행은 완료시각이 `-`(빈칸/`Invalid Date`/`1970-01-01` 금지) ③④ 다른 관리자 화면들과 **동일 시각 체계**로 보인다(v188 픽스 결과와 정합)
- 교차: NT-API-04(`+00:00` 표기)와 반드시 함께 판정 — API 가 tz 를 붙였는데도 화면이 밀리면 프론트 `formatDate` 문제로 분리 보고
- 증적: 서버 응답값과 화면 캡처를 나란히 기록(시각만, 개인정보 미포함)

#### NT-E2E-06. 사용자 DM 여정 무회귀 — 송수신 + 읽음 표시 동기화 `[e2e]` (회귀 1·5)
- Given: 사용자 앱 2개 세션(테스트 계정 A/B)
- When: ① A 가 B 에게 DM 을 보낸다 ② B 앱 헤더의 **미읽음 뱃지**를 본다 ③ B 가 대화를 연다 ④ A 화면의 해당 메시지 **읽음 표시**를 본다 ⑤ B 가 답장한다 ⑥ A 가 대화를 연 채로 B 가 추가 메시지를 보낸다 ⑦ 관리자 앱 `/cs` 에서 CS 대화를 열고 미읽음 뱃지 변화를 본다
- Then: ① 전송 즉시 A 화면에 반영 ② 뱃지 숫자가 **1 증가** ③ 대화 열람과 동시에 뱃지가 **감소/0** ④ A 화면에서 **"읽음"으로 바뀐다**(실시간 동기화 — WS `read` 이벤트) ⑤ 답장 정상 ⑥ 대화가 열려 있는 상태에서 수신 시 **즉시 읽음 처리**(기존 동작 유지) ⑦ 관리자 미읽음 뱃지가 열람 후 감소
- 판정: v190 대비 어떤 단계라도 동작·표기가 달라지면 **FAIL**(공통 DM 경로 회귀 — R1·R3)
- 안전: 테스트 계정 간 대화만. 실사용자 대화는 열지 않는다.

#### NT-E2E-07. `/logs` 화면 — `cs_broadcast` details 표시 무회귀 `[e2e]` (회귀 6·R7)
- Given: 관리자 앱 `/logs`, `cs_broadcast` 행 1건 이상(구버전 행이라도 가능)
- When: ① `action` 필터로 "전체 발송" 을 고른다 ② 행의 상세(details) 표기를 읽는다 ③ v194 이후 행이 있으면 그 표기를 읽는다 ④ "지정 발송" 필터도 확인한다
- Then: ① 필터가 기존대로 동작 ② details 가 `key: value` 로 **깨짐 없이** 나열된다(`[object Object]`·빈칸·JSON 원문 덤프 없음) ③ v194 이후 행에는 `targets`·`text_len` 에 더해 **`notice_id` 가 자연스럽게 한 줄 더** 표시된다(`summarizeDetails` generic 나열 — 프론트 수정 없이 동작) — **본문(text)은 표시되지 않는다** ④ 지정 발송 표기 무회귀
- 확인: 화면·콘솔에 공지 본문 원문 **0건**
- 판정: ③에서 본문이 보이면 **즉시 중단·planner 보고**(프라이버시 경계 위반)

---

### 4. 태그 균형 집계표 (아이스크림콘 방지 — 요구 충족 증명)

| 태그 | 개수 | 비율 | 요구 | 판정 |
|---|---|---|---|---|
| `[unit]` | **17** | **41.5%** | ≥ 40% | ✅ 충족 |
| `[api]` | **17** | **41.5%** | ≥ 35% | ✅ 충족 |
| `[e2e]` | **7** | **17.1%** | ≤ 25% | ✅ 충족 |
| **합계** | **41** | 100% | — | — |

- 계산: unit 17/41 = 41.46%, api 17/41 = 41.46%, e2e 7/41 = 17.07%
- **E2E 를 7건으로 묶은 근거**(사람이 화면에서만 확인 가능한 것에 한정): 라우트 진입·사이드바 노출(01), 행 확장 렌더(02), 모달 prefill + `window.confirm` 취소(03), 모달 상태 잔존(04), **시각 표기 KST 대조**(05), 실시간 읽음 표시 동기화(06), details 화면 나열(07). 그 외 검증 가능한 모든 것은 unit/api 로 내렸다.
- **승인 대기 2건(NT-API-16·17)을 제외한 즉시 실행 가능 건수**: 39건 — unit 17(43.6%) / api 15(38.5%) / e2e 7(17.9%) → **제외 후에도 요구 비율 전부 충족**.

---

### 5. planner 승인 필요 항목 (승인 전 실행 금지)

#### 5-A. 격리 실발송 1건 — NT-API-16 · NT-API-17 (**승인 대기**)
- **목적**: 읽음 통계(`delivered`/`read_count`/`read_rate`) 산출 검증 + `notice=` 로그 추적 체인 검증. 실발송 없이는 원리적으로 확인 불가.
- **격리 조건 설계**(승인 대상):
  1. 발송 대상 필터는 `role = ANY(audience 매핑) AND NOT is_banned AND account_status='active' AND id <> official_id` (dm_service.py:723-741). 이 필터가 **테스트 계정 1~2개만 매칭**하도록 구성한다.
  2. 구성 방법은 **planner/backend-dev 가 지정**한다. 후보: (a) 테스트 전용 DB/스테이징에서 수행 (b) 실사용자 계정이 존재하지 않는 audience 를 사용 (c) 일시적으로 대상 계정 범위를 좁히는 조치. **tester 가 실사용자 계정 상태(role·is_banned·account_status)를 임의로 변경하는 방식은 제안하지 않으며 승인되더라도 tester 는 수행하지 않는다.**
  3. 착수 직전 **대상 수를 재측정**해 1~2 임을 확인. **3 이상이면 즉시 중단**.
  4. 발송 전 **대상 계정 목록 스냅샷**을 확보하고 발송 후 `dm_messages` 증가분이 스냅샷과 정확히 일치함을 대조(초과 시 격리 실패 → 즉시 보고).
  5. 본문은 `[v194-test]` 접두 + 타임스탬프. 발송 후 공지 문서·메시지는 **잔존**시키고 REPORT 에 id 를 기재(회수 기능은 범위 밖 — PLAN §6).
- **승인 없으면**: NT-API-16·17 = `SKIP(승인 대기)`, NT-API-13 ②·NT-UNIT-08 ② = 부분 SKIP. 나머지 39건은 그대로 실행 가능.

#### 5-B. Redis 락 키 수동 선점 — NT-API-06 (**승인 대기**)
- `redis-cli SET dm:broadcast:lock:<official-id> 1 NX EX 30` 1건. 30초 동안 실제 전체발송이 차단되는 부작용(안전 방향). tester 의 Redis 쓰기 1건 승인 여부 회신 요청. **불허 시 대안 없음 → NT-API-06 = `SKIP`** (실발송으로 락을 만드는 방식은 금지이므로 대체 불가).

#### 5-C. 회신 요청 사항
1. **격리 조건 구성 주체·방식 확정**(§5-A 2번) — tester 는 구성하지 않고 dev/planner 구성 완료 보고 후 검증만 수행하는 것이 초안 전제.
2. **Redis 락 선점 승인**(§5-B).
3. **Mongo/PG 직접 조회 승인** — NT-UNIT-07·NT-API-08·12·14 는 컬렉션 키 집합·인덱스·문서 수 확인을 위해 읽기 전용 DB 직결이 필요(v182~183·v190 승인 관행 준용 확인 요청). 불허 시 dev 가 실행한 결과를 tester 가 교차 검토하는 방식으로 대체.
4. ~~`stale` 30분 경계 부등호~~ **해소** — 구현 실측으로 확정(엄격 `<`, 30분 정각은 false). NT-UNIT-03 (b) 기대값 고정 완료. 스펙상 `<=` 여야 한다면 회신 요청(그 경우 코드 수정 대상).
5. ~~`text_preview` 말줄임 기호 정책~~ **해소** — 구현 실측으로 확정(`text[:60]`, 기호 미부착 / 말줄임은 CSS). NT-UNIT-04 기대값 고정 완료.
6. **9004 실발송 금지 확인** — NT-API-15 는 9004 에서 **410·401·400·목록 200 만** 확인하고 발송 계열은 일절 호출하지 않는 것이 초안 전제(9004·9005 가 동일 DB 를 보므로 9004 발송도 실발송임).
7. **BASE_REV 확정** — 초안은 `d19af4b`. 코디네이터 지정값이 다르면 회신.

---

### 6. 알려진 한계 (FAIL 이 아닌 **기대 동작** — 판정 기준 명문화)

| # | 현상 | 판정 |
|---|---|---|
| L1 | **서버 재기동 시 BackgroundTasks 유실** → 해당 공지가 `status:"sending"` 에 **고착**된다. 자동 복구 로직은 **없다**(PLAN §2·§6 — 워커/스케줄러는 범위 밖) | **FAIL 아님 — 기대 동작.** 30분 경과 후 `stale=true` 로 표시되어 "중단됨(확인 필요)" 로 보이면 **PASS**. 재현: 승인된 격리 발송 중 재기동은 **수행하지 않는다**(자연 발생 시에만 관측·기록) |
| L2 | `stale` 은 **표시 전용 플래그**로 Mongo 에 쓰기를 하지 않는다 — DB 의 `status` 는 계속 `"sending"` | 기대 동작. `status` 가 자동으로 `failed` 로 바뀌면 오히려 스펙 위반(FAIL) |
| L3 | 공지 **수정·삭제·회수** 기능 없음(PLAN §6) | 화면에 해당 버튼이 없는 것이 정상. 있으면 범위 위반(FAIL) |
| L4 | **개인별 읽음 목록**("누가 읽었는지") 없음 — 집계(N명, X%)만 | 기대 동작. 개인별 목록이 노출되면 프라이버시 위반(FAIL) |
| L5 | `POST /api/dm/broadcast` 410 차단으로 **외부 스크립트/포스트맨 사용처가 끊길 수 있음**(프론트 사용처 0건 실측) | 기대 동작. backend-dev 의 액세스 로그 확인 결과를 REPORT 특이사항에 기재(R9) |
| L6 | 지정발송(`cs_send`)은 공지 이력에 **편입되지 않음** | 기대 동작 — NT-API-12 ②의 판정 기준 자체 |
| L7 | 사용자 앱에는 공지 전용 UI·배지·푸시가 **없다**(일반 DM 으로 도착) | 기대 동작(PLAN §6) |

---

### 7. 실행 순서 권고 (tester 참고)

1. **선행**: backend-dev/frontend-dev 완료 보고 접수 → BASE_REV 확정 → 하드 새로고침·빌드 표기 기록
2. **정적 게이트 먼저**(코드가 안전 조건을 지키는지 확인 후에만 런타임 진행): NT-UNIT-12(공통 DM 함수 무변경) → NT-UNIT-07(doc 필드 집합) → NT-UNIT-14(로그 규율) → NT-UNIT-06(`_iso`) → NT-UNIT-15(9004 diff) → NT-UNIT-17(생성 실패 분기)
3. **순수 함수**: NT-UNIT-01·02·03·04·05·09·10·11
4. **프론트 정적**: NT-UNIT-13·16
5. **읽기 API**: NT-API-01 → 02 → 03 → 04 → 14(인덱스) → 15(9004)
6. **회귀 API(쓰기 최소)**: NT-API-09 → 10 → 11 → 12 → 13(부분) → 08(프라이버시 — **FAIL 시 즉시 중단**)
7. **발송 안전 경로**: NT-API-05(검증 분기) → NT-API-07(410) → NT-API-06(락 429 — §5-B 승인 시)
8. **E2E**: NT-E2E-01 → 02 → 05(시각) → 03(재발송 취소) → 04(모달 두 진입점) → 07(로그 화면) → 06(사용자 DM 여정)
9. **승인분(있을 때만)**: NT-API-16 → 17 → NT-API-13 ② 재판정 → NT-UNIT-08 ② 재판정
10. **종료**: REPORT — 태그별 결과 집계, 실발송 0건 증명(`[admin-cs] broadcast queued` 로그 건수·`notices`/`dm_messages` 증감), 인덱스 실측 출력, 9004 diff 결과, 승인 대기로 SKIP 한 항목 목록, L1~L7 관측 여부. **크리덴셜·개인정보 실값·공지 본문 원문 기재 금지**

---

### 8. 결과 기록 표 (tester 작성용)

| ID | 레벨 | 결과(PASS/FAIL/SKIP) | 비고 |
|---|---|---|---|
| NT-UNIT-01 | unit | | read_rate 분모 4행(done→sent / 미완료→delivered) |
| NT-UNIT-02 | unit | | 0 분모 → 0.0, 반올림 1자리 5건 |
| NT-UNIT-03 | unit | | stale 경계 29/30/31분·done/failed false·naive tz |
| NT-UNIT-04 | unit | | text_preview 60자·text_len 원문 길이 |
| NT-UNIT-05 | unit | | audience 라벨 3종·폴백 |
| NT-UNIT-06 | unit | | `_iso` naive→+00:00 / aware 보존 / 직접 isoformat 0건 |
| NT-UNIT-07 | unit | | notice_id=None doc 필드 집합 동일 — **FAIL 시 중단** |
| NT-UNIT-08 | unit | | notice_id 부착 시 additive 1키·str 캐스팅·승격 블록 무변경 |
| NT-UNIT-09 | unit | | `_read_stats` 빈 입력/미존재/단일 aggregation |
| NT-UNIT-10 | unit | | 응답 필드 화이트리스트·개인정보 키 0 — **FAIL 시 중단** |
| NT-UNIT-11 | unit | | notices 문서 스키마·error 는 타입명만 |
| NT-UNIT-12 | unit | | `_serialize_message`/`ensure_dm_indexes`/`mark_read`/`send_to_users` diff 0 |
| NT-UNIT-13 | unit | | 모달 props 기본값·seed 1회·confirm 유지 |
| NT-UNIT-14 | unit | | 로그 `notice=` 전수·본문 전달 0건 |
| NT-UNIT-15 | unit | | 9004 미러 6파일 `diff -q` |
| NT-UNIT-16 | unit | | 라우트/NavLink additive·api.js 경유·eslint 신규 0 |
| NT-UNIT-17 | unit | | 락 후 생성·생성 실패 시 500+미발송 |
| NT-API-01 | api | | 목록 200·필드 계약·DESC·페이지네이션 |
| NT-API-02 | api | | audience 400·limit 클램프·401·403 |
| NT-API-03 | api | | 상세 200(text 전문)·400·404·인가 |
| NT-API-04 | api | | 전 시각 필드 `+00:00` |
| NT-API-05 | api | | broadcast 검증 분기 400/401/403 — **실발송 0 증명** |
| NT-API-06 | api | | 락 429(§5-B 승인 필요) |
| NT-API-07 | api | | `/api/dm/broadcast` 410 · 무토큰 401 |
| NT-API-08 | api | | 프라이버시 경계 — **FAIL 시 중단** |
| NT-API-09 | api | | DM 송수신 + `notice_id` 미노출 — **FAIL 시 중단** |
| NT-API-10 | api | | pending 생성/수락/거절/403/hard delete |
| NT-API-11 | api | | 읽음 3종 + 뱃지 2종 + pending marked:0 |
| NT-API-12 | api | | 지정발송 무회귀 + 공지 목록 미편입 |
| NT-API-13 | api | | 로그 details additive·본문 부재 |
| NT-API-14 | api | | `(notice_id,read)` sparse·notices.created_at·기존 6종 |
| NT-API-15 | api | | 9004 런타임 200/410/401/400 |
| NT-API-16 | api | | **승인 대기** — 격리 실발송 1건·읽음 통계 |
| NT-API-17 | api | | **승인 대기** — `notice=` 추적 체인 7단계 |
| NT-E2E-01 | e2e | | `/notices` 진입·사이드바·목록 렌더 |
| NT-E2E-02 | e2e | | 행 확장 → 본문 전문 |
| NT-E2E-03 | e2e | | 재발송 prefill → confirm **취소** |
| NT-E2E-04 | e2e | | 모달 두 진입점·잔존 없음·CS 무회귀 |
| NT-E2E-05 | e2e | | 발송시각 KST 대조 — 9시간 밀림 0 |
| NT-E2E-06 | e2e | | 사용자 DM 여정·읽음 동기화 |
| NT-E2E-07 | e2e | | `/logs` details 나열·본문 미표시 |

---

### 9. 요구 축 ↔ 시나리오 매핑 (누락 검증)

**신규 기능(v194)**

| 요구 | 시나리오 |
|---|---|
| `read_rate` 분모/0분모/반올림 | NT-UNIT-01·02 |
| `stale` 경계 | NT-UNIT-03 |
| `text_preview`·`text_len` | NT-UNIT-04 |
| audience 라벨 매핑 | NT-UNIT-05 |
| `_iso` naive/aware | NT-UNIT-06 |
| `send_message(notice_id=None)` doc 동일 | NT-UNIT-07 (+08) |
| `_read_stats` 안전성 | NT-UNIT-09 |
| 목록 200·계약·DESC·페이지네이션 | NT-API-01 |
| audience 400 / 401 / 403 | NT-API-02 |
| 상세 200(전문)·400·404 | NT-API-03 |
| broadcast 검증 분기·429 | NT-API-05·06 |
| `/api/dm/broadcast` 410·401 | NT-API-07 |
| 시각 `+00:00` | NT-API-04 |
| 응답 개인정보 부재 | NT-UNIT-10·NT-API-08 |
| `/notices` 진입·사이드바·목록 | NT-E2E-01 |
| 행 확장 본문 | NT-E2E-02 |
| 재발송 prefill·confirm 취소 | NT-E2E-03 |
| 헤더 발송 버튼·모달 취소 | NT-E2E-04 |
| 발송시각 9시간 밀림 | NT-E2E-05 (+NT-API-04) |

**회귀 10축**

| # | 요구 | 시나리오 |
|---|---|---|
| 1 | 기존 DM 송수신·`notice_id` 부재·doc 필드 집합 | NT-API-09 · NT-UNIT-07 · NT-E2E-06 |
| 2 | 요청함 pending | NT-API-10 |
| 3 | CS 전체발송 경로(검증·락·응답, 실발송 금지) | NT-API-05 · NT-API-06 |
| 4 | CS 지정발송(v177) 무회귀·이력 미편입 | NT-API-12 |
| 5 | 읽음 표시 4종 | NT-API-11 · NT-E2E-06 |
| 6 | 관리자 로그 details·`/logs` 화면 | NT-API-13 · NT-E2E-07 |
| 7 | CS 페이지 모달 무회귀 | NT-E2E-04 · NT-UNIT-13 |
| 8 | 인덱스 실측 | NT-API-14 |
| 9 | 9004 미러 | NT-UNIT-15(정적) · NT-API-15(런타임) |
| 10 | 프라이버시 경계 | NT-API-08 · NT-UNIT-10·11·14 |
| 추가 | 디버깅 로그 `notice=` 추적 | NT-UNIT-14(정적) · NT-API-17(체인, 승인 대기) |
| 추가 | 알려진 한계(재기동 → sending 고착) | §6 L1·L2 |

---

## v194 시나리오 집계

- 총 **41건** — `[unit]` 17(41.5%) / `[api]` 17(41.5%) / `[e2e]` 7(17.1%) → 태그 요구(unit ≥40% · api ≥35% · e2e ≤25%) **전부 충족**
- **승인 대기 2건**: NT-API-16(격리 실발송 1건 — 읽음 통계) · NT-API-17(로그 추적 체인). 추가로 NT-API-06 은 Redis 락 선점 승인 필요(§5-B)
- **쓰기 총량**(승인 전 기준): 테스트 계정 간 DM 수 건 · pending 요청 2건(수락/거절) · 지정발송 1건(테스트 계정 1명) · Redis 락 키 1개(TTL 30초, 승인 시). **전체발송 0건** · 인덱스 조작 0 · 컨테이너/볼륨 조작 0 · 실사용자 데이터 무접촉
- **즉시 중단 조건**: NT-UNIT-07 / NT-UNIT-10 / NT-API-08 / NT-API-09 FAIL, `POST /api/admin/cs/broadcast` 가 예기치 않게 200 을 반환, `/logs`·목록에 공지 본문이 노출되는 경우

## 개정 이력 (v194)

- 2026-08-19 초판 작성 (41건) — PLAN v194 §1~§7 전 항목 시나리오화. 안전 제약(**실발송 금지**)을 §0 불변식으로 두고 발송 계열을 **검증 분기·인가·429 락(수동 선점)·`window.confirm` 취소·410** 경로로만 설계. 실발송이 원리적으로 필요한 2건(NT-API-16·17)은 **격리 조건 설계서(§5-A)와 함께 승인 대기**로 분리. 태그 균형은 정적 검사·순수 함수 검증을 unit 으로 끌어올려 unit 41.5% / api 41.5% / e2e 17.1% 로 확보(승인 대기 2건 제외 시에도 43.6/38.5/17.9 로 충족). BASE_REV=d19af4b 초안 반영. planner 회신 대기 7건(§5-C). planner 검토 후 확정 예정.
- 2026-08-19 실측 반영(설계 중 구현분 착지) — 작성 중 backend-dev/frontend-dev 산출물(`notice_service.py`·`admin_notices.py`·`AdminNoticesPage.jsx`·`AdminBroadcastModal` props)이 워킹트리에 착지해, "구현 확정값 관측" 으로 열어 두었던 3건의 기대값을 **실측으로 고정**: ① `_is_stale` 엄격 부등호(`dt < now-30분`) → 30분 정각 **false**(NT-UNIT-03 b) ② `text_preview = text[:60]` **말줄임 기호 미부착**(NT-UNIT-04) ③ audience 라벨 `all=전체 / users=일반 사용자 / customers=고객` + `|| value || '-'` 폴백, 모달과 값·라벨 일원화 대조 추가(NT-UNIT-05) ④ 목록 행 17키·상세 +2키가 PLAN §3-4 계약과 일치하고 `profile_image` 미포함(NT-UNIT-10). §5-C 4·5번 회신 항목 **해소**(잔여 회신 5건). **시나리오 개수·태그 비율은 불변**(41건 / 17·17·7).


## v195 — 미읽음 뱃지 실시간 반영 + 공지 읽음 수 자동 갱신

팀: MAIDOL-RealtimeSquad / test-designer 작성 (**설계 산출물 — 본 문서는 실행하지 않는다. 실행은 tester 담당**)
근거: PLAN.md v195 §2 실측(①본인 대상 이벤트 부재가 근본 원인 / ②`loadNotices` 가 `setLoading` 으로 표를 통째 교체 / ③관리자 앱 WS 0건), §3 변경 매트릭스 B1~B3·F1~F8, §4 회귀 위험 R1~R17, §5 범위 밖, §6 절대 준수
BASE_REV: **e356a70**(v194) + 워킹트리 v195 구현분(미커밋)

**대상 파일 (작성 시점 워킹트리 실측)**

| # | 파일 | 상태 |
|---|---|---|
| B1·B2 | `backend_9005/app/services/dm_service.py` `mark_read`(`:571~628`) | 착지 — prev_unread 캡처 `:597`, peer `read` `:609`, self `unread` `:616`, published 로그 `:618`, skipped 로그 `:623` |
| B3 | `backend_9004/app/services/dm_service.py` | 착지 — `:616`/`:618` 동일 위치 (미러 확인됨) |
| F1 | `frontend/src/components/Header.jsx:201~209` | 착지 — DEV 로그 1줄만 추가, `onUnread` 폴백 로직 무변경 |
| F2·F3 | `frontend/src/utils/dmSocket.js`, `frontend/src/pages/DmInboxPage.jsx` | **무수정**(설계대로) |
| F4·F5 | `frontend_admin/src/pages/AdminNoticesPage.jsx` | 착지 — `NOTICE_POLL_MS=20000`(`:20`), ref 4종(`:77~84`), `loadNotices(pageNum,{silent})`(`:88~137`), 폴링 이펙트(`:174~197`), `fetchDetail(id,{silent})`(`:148~169`) |
| F6 | `frontend_admin/src/utils/csUnreadBus.js` **(신규, untracked)** | 착지 — `subscribe`(`:17~20`), `emitDelta`(`:26~37`) |
| F7 | `frontend_admin/src/components/AdminLayout.jsx:51~59` | 착지 — `csUnreadBus.subscribe` + `Math.max(0, v+delta)`(`:56`), 30초 폴링(`:47`) 유지 |
| F8 | `frontend_admin/src/pages/AdminCsPage.jsx:150~173` | 착지 — `prevUnread` 열기 전 캡처(`:154`), `markCsRead` 성공 후 `prevUnread>0` 일 때만 `emitDelta`(`:167~172`) |

---

### 0. 전제 및 안전 규칙 (최우선 — 위반 시 해당 항목 자체를 폐기)

1. **실사용자 계정·데이터 무접촉.** 테스트 계정 `<test-user-a>` / `<test-user-b>` / `<admin-email>` 만 사용한다. 실사용자 대화·공지·별·트랙은 **열람/집계 조회만**.
2. **실제 전체발송 절대 금지.** `POST /api/admin/cs/broadcast` 를 **어떤 항목에서도 200 으로 성립시키지 않는다.** 발송 계열은 **모달 열림 / 검증 400 / 인가 401·403 / 503 / 429 락 / `window.confirm` 취소** 경로까지만. 200 이 필요해 보이는 상황이 생기면 **즉시 중단하고 planner 승인 요청**(§5).
3. **기존 실공지 읽기 전용.** `notices` 컬렉션에 사용자가 실제로 발송한 공지가 존재한다. **수정·삭제·재발송 금지.** ②의 읽음 수 증가 e2e(RT-E2E-02)는 **이 기존 공지의 미읽음 수신자인 테스트 계정으로 열람**하여 수행한다(공지 자체는 건드리지 않는다).
4. **우회 금지 3종**: `mark_read` 의 pending no-op 가드(`dm_service.py:587~594`) / `_serialize_message` 화이트리스트 / `ensure_dm_indexes` — 테스트를 위해 **수정·몽키패치·우회하지 않는다**(가드를 끄고 통과시키는 테스트는 그 자체가 FAIL).
5. **크리덴셜 위생**: 산출물에 API 키·시크릿·실계정 비밀번호·토큰 **실값 기재 금지**. 전부 플레이스홀더 — `<TEST_ADMIN_TOKEN>`, `<TEST_USER_A_TOKEN>`, `<TEST_USER_B_TOKEN>`, `<cid>`, `<notice-id>`, `<official-id>`.
6. **개인정보·본문 위생**: 공지 본문 원문·닉네임 원문·생년월일·성별·이메일을 TESTPLAN·REPORT·로그 인용에 **옮겨 적지 않는다**. **길이(`text_len`)·건수·필드 존재 여부·불리언**으로만 기재한다.
7. **인프라 무조작**: docker-compose·포트·ES·MinIO 조작 금지. **MinIO 9100 차단 금지.** 컨테이너 재시작이 필요해 보이면 planner 확인 후.
8. **쓰기 허용 총량**: ① 테스트 계정 간 DM 대화 1건 + 메시지 수 건 ② 테스트 계정 간 pending 요청 2건(수락 1·거절 1) ③ `POST /api/admin/cs/send` 지정발송 **테스트 계정 1명 대상 최대 1건**(G1 회귀용) ④ Redis 락 키 1개 수동 선점(RT-API-09, TTL 자연 해제, **승인 필요**). **그 외 쓰기 0건.**
9. **선행 절차**(v187~v194 승계): 프론트 `[unit]`·`[e2e]` 착수 전 사용자 앱(4000)·관리자 앱(4001) **하드 새로고침 + 빌드 표기 기록**. 백엔드 `[unit]` 은 9005 실행 환경에서 순수 함수 직접 호출(pytest 임시 파일 또는 `python -c`) — **임시 테스트 파일은 사용 후 삭제**(레포 커밋 금지).
10. 기준 URL: 9005 = `http://localhost:9005`, 9004 = `http://localhost:9004`, 사용자 앱 = `http://localhost:4000`, 관리자 앱 = `http://localhost:4001`.
11. **DEV 로그 전제**: `[Header]`·`[AdminNotices]`·`[CsUnreadBus]`·`[AdminLayout]`·`[AdminCs]` 콘솔 라인은 전부 `import.meta.env.DEV` 가드 안에 있다. **개발 서버(dev)로 띄운 상태**에서만 관측 가능 — 프로덕션 빌드로 검증하면 로그 부재를 FAIL 로 오판한다.

**즉시 중단 조건 (하나라도 FAIL → 이후 항목 진행 금지, planner 즉시 보고)**
- **RT-UNIT-01** (본인 이벤트 타입이 `unread` 가 아님 → 거짓 읽음표시 버그, R1)
- **RT-UNIT-16 / RT-API-05** (pending 프라이버시 가드 훼손, R2)
- **RT-E2E-07** (내가 읽었을 때 내 메시지에 읽음표시가 켜짐 — R1 의 화면 발현)
- `POST /api/admin/cs/broadcast` 가 **예기치 않게 200** 을 반환
- 공지 본문 원문·개인정보가 로그/콘솔/응답에 노출

---

### 1. `[unit]` 시나리오 — 20건

> 실행 방식: 백엔드는 9005 파이썬 환경에서 `dm_service` 를 import 해 `publish_to_user` / mongo 를 **목킹**하고 직접 호출(DB 불필요). 프론트는 dev 서버 + 브라우저 콘솔 + 정적 코드 검사(`grep`/`diff`) 조합. **프로덕션 코드를 수정하지 않는다.**

#### RT-UNIT-01. 본인 대상 이벤트 타입이 **정확히 `"unread"`** `[unit]` — 핵심 / 즉시 중단 조건 (①, R1)
- **사전조건**: `dm_service.publish_to_user` 를 호출 인자 기록용 스텁으로 교체. `_get_conv` 가 `{_id:<cid>, participants:[me,peer], status:"accepted", unread:{me:3}}` 를 반환하도록 mongo 목킹. `dm_messages.update_many` 는 `modified_count=2` 반환.
- **Given** 미읽음 3건이 있는 accepted 대화, **When** `await mark_read(mongo, <cid>, me)` 를 호출하면, **Then** `publish_to_user` 호출 인자 중 `uid == me` 인 건의 이벤트가 **`{"type": "unread", "conversation_id": <cid>}`** 이다.
- **기대결과**: 본인 이벤트 `event["type"] == "unread"`. **`"read"` 이면 FAIL**(DmInboxPage 가 "상대가 내 메시지를 읽음"으로 해석 → 거짓 읽음표시).
- **확인할 로그 라인**: `[dm] mark_read self-unread published conv=%s me=%s prev_unread=%d marked=%d`
- **PASS/FAIL**: 타입 문자열 정확 일치 → PASS. 다른 값·본인 호출 자체 부재 → **FAIL + 즉시 중단**.
- **실패 시 의심**: `backend_9005/app/services/dm_service.py:616` (self publish 의 `"type"` 리터럴).

#### RT-UNIT-02. 본인 이벤트 페이로드에 **`count` 키 부재** `[unit]` (①)
- **사전조건**: RT-UNIT-01 과 동일 목킹.
- **Given** 동일 대화, **When** `mark_read` 호출 후 본인 이벤트 dict 의 키 집합을 조사하면, **Then** 키 집합이 **정확히 `{"type", "conversation_id"}`** 이다.
- **기대결과**: `"count" not in event` 가 참. `count`·`requests`·`unread` 등 추가 키 0개. (근거: `GET /unread-count` 만이 `{count, requests}` 를 함께 계산하는 단일 진실원천이며, count 동봉은 official 계정의 전량 스캔 비용을 클릭마다 유발)
- **확인할 로그 라인**: `[dm] mark_read self-unread published ...` (페이로드 자체는 로그에 없으므로 스텁 기록으로 단언)
- **PASS/FAIL**: 키 2개 정확 일치 → PASS. `count` 존재 또는 키 초과 → FAIL.
- **실패 시 의심**: `dm_service.py:616`.

#### RT-UNIT-03. peer `read` 발행 유지 + **순서 peer → self** `[unit]` (①, R4)
- **사전조건**: RT-UNIT-01 목킹 + `publish_to_user` 스텁이 **호출 순서를 리스트로 보존**.
- **Given** peer 가 존재하는 accepted 대화, **When** `mark_read` 호출, **Then** 호출 기록이 `[(peer, {"type":"read","conversation_id":cid}), (me, {"type":"unread","conversation_id":cid})]` 순이다.
- **기대결과**: 총 2회 호출. 1번째 = peer + `read`, 2번째 = me + `unread`. peer 이벤트 페이로드도 **v194 이전과 동일**(`{type, conversation_id}` 2키).
- **확인할 로그 라인**: `[dm] mark_read self-unread published conv=%s me=%s prev_unread=%d marked=%d`
- **PASS/FAIL**: 순서·대상·타입 모두 일치 → PASS. peer 발행 누락/변형 → FAIL(읽음표시 동기화 회귀).
- **실패 시 의심**: `dm_service.py:606~609` (peer 블록), `:610~625` (self 블록 위치).

#### RT-UNIT-04. `prev_unread==0 && modified_count==0` → 본인 발행 **skip** `[unit]` (①, R5)
- **사전조건**: `unread:{me:0}` 인 accepted 대화, `update_many` 가 `modified_count=0` 반환하도록 목킹.
- **Given** 이미 다 읽은 대화, **When** `mark_read` 를 다시 호출하면, **Then** `publish_to_user` 는 **peer 1회만**(read) 호출되고 **본인 호출 0회**.
- **기대결과**: 반환값은 정상 `{conversation_id, read, marked:0}`. 본인 대상 발행 0건.
- **확인할 로그 라인**: `[dm] mark_read self-unread skipped (nothing to clear) conv=%s me=%s` (published 라인이 **나오면 FAIL**)
- **PASS/FAIL**: skipped 로그 + 본인 발행 0 → PASS. published 로그 출력 → FAIL(불필요 이벤트 폭주 — `DmInboxPage:385` 가 활성 대화 수신마다 `markDmRead` 를 호출한다).
- **실패 시 의심**: `dm_service.py:615` (`if prev_unread > 0 or result.modified_count > 0`).

#### RT-UNIT-05. `prev_unread>0` → **반드시 발행** `[unit]` (①, R5)
- **사전조건**: `unread:{me:1}`, `update_many` 가 `modified_count=0` 반환(메시지는 이미 read 지만 카운터만 남은 경계 케이스).
- **Given** 카운터만 1 남은 대화, **When** `mark_read` 호출, **Then** 본인 대상 `unread` 이벤트가 **발행된다**(가드가 `or` 이므로 한쪽만 참이어도 통과).
- **기대결과**: 본인 발행 1회, 로그 `prev_unread=1 marked=0`.
- **확인할 로그 라인**: `[dm] mark_read self-unread published conv=%s me=%s prev_unread=1 marked=0`
- **PASS/FAIL**: 발행됨 → PASS. skip 되면 FAIL(뱃지가 안 줄어드는 원래 증상 재발).
- **실패 시 의심**: `dm_service.py:615` 가드가 `and` 로 잘못 작성됐는지, `:597` prev_unread 캡처가 unread=0 업데이트 **뒤**로 밀렸는지.

#### RT-UNIT-06. 발행 실패(Redis 예외)가 `mark_read` 반환값·상태변경을 깨지 않음 `[unit]` (①)
- **사전조건**: `get_redis()` 가 `publish` 시 예외를 던지는 더블 반환(또는 `None` 반환 경로). `publish_to_user` 는 **몽키패치하지 않는다**(실제 예외 흡수 경로를 타야 함).
- **Given** Redis 장애, **When** `mark_read` 호출, **Then** 예외가 밖으로 새지 않고 `{conversation_id, read:True, marked:N}` 를 정상 반환하며 `dm_conversations.update_one`·`dm_messages.update_many` 는 **정상 호출**된다.
- **기대결과**: 호출자에게 예외 전파 0. 상태 변경(unread=0, read=true) 그대로.
- **확인할 로그 라인**: `[dm] publish failed uid=%s` (traceback 동반) + `[dm] mark_read self-unread published ...`
- **PASS/FAIL**: 예외 전파 없음 + 반환 정상 → PASS. `HTTPException`/500 발생 → FAIL.
- **실패 시 의심**: `dm_service.py:328~336` (`publish_to_user` 의 `try/except`).

#### RT-UNIT-07. `loadNotices(page, {silent:true})` 가 `setLoading`/`setError` **미호출** `[unit]` (②, R8)
- **사전조건**: 관리자 앱 dev 서버, 공지 관리 페이지 진입 후 목록 로드 완료(표 렌더).
- **Given** 이미 렌더된 목록, **When** 폴링 tick 이 `loadNotices(pageNum, {silent:true})` 를 호출하면, **Then** 화면이 `로딩 중...` 으로 교체되지 않고 에러 배너도 뜨지 않는다.
- **기대결과**: 정적 확인 — `loadNotices` 안의 `setLoading(true)`/`setError('')` 가 **`if (!silent)` 블록 내부**에만 존재(`AdminNoticesPage.jsx:90~93`), `finally` 의 `setLoading(false)` 도 `if (!silent)` 로 가드(`:135`). 런타임 확인 — 20초 tick 시 표 DOM 이 제거/재생성되지 않음(개발자도구 Elements 에서 `<tbody>` 노드 유지).
- **확인할 로그 라인**: `[AdminNotices] poll tick` → `[AdminNotices] poll merged` (그 사이 `[AdminNotices] list loaded` 는 **나오면 안 됨** — silent 분기 미탐)
- **PASS/FAIL**: 두 가드 모두 존재 + tick 시 `로딩 중...` 미노출 → PASS.
- **실패 시 의심**: `AdminNoticesPage.jsx:90~93`, `:133~136`.

#### RT-UNIT-08. 폴링 중단 조건 3종 각각에서 요청 미발생 `[unit]` (②, R9)
- **사전조건**: 공지 관리 페이지 dev, Network 탭 필터 `notices`.
- **Given/When/Then** 3분기를 각각 재현:
  | 분기 | 재현 방법 | 기대 로그 | 기대 네트워크 |
  |---|---|---|---|
  | modal | "공지 발송" 버튼으로 모달 열고 20초 이상 대기 (**보내지 않는다 — §0-2**) | `[AdminNotices] poll skipped {reason:'modal'}` | `GET /admin/notices` **0건** |
  | hidden | 다른 탭으로 전환해 `document.hidden===true` 로 만들고 25초 대기 | `[AdminNotices] poll skipped {reason:'hidden'}` | 0건 |
  | inflight | 네트워크를 Slow 3G 로 스로틀해 응답이 20초를 넘기게 한 뒤 다음 tick 관찰 | `[AdminNotices] poll skipped {reason:'inflight'}` | 중복 요청 0건 |
- **기대결과**: 세 분기 모두 skip 로그 + 신규 요청 0. 조건 해제 시 다음 tick 부터 정상 재개.
- **확인할 로그 라인**: `[AdminNotices] poll skipped` (reason 3종) / 해제 후 `[AdminNotices] poll tick`
- **PASS/FAIL**: 3분기 전부 skip → PASS. 1분기라도 요청이 나가면 FAIL.
- **실패 시 의심**: `AdminNoticesPage.jsx:176~187` (skip 3분기), `:84` `inFlightRef` 선언, `:134` `finally` 의 `inFlightRef.current=false`.

#### RT-UNIT-09. 응답의 요청 페이지 ≠ 현재 페이지 → **상태 미반영(레이스 폐기)** `[unit]` (②, R10)
- **사전조건**: 공지 2페이지 이상 존재. Network 를 Slow 3G 로 스로틀.
- **Given** 1페이지에서 폴링 tick 이 발사되어 응답 대기 중, **When** 응답 도착 전에 "다음" 버튼으로 2페이지로 이동하면, **Then** 1페이지 응답이 도착해도 `setNotices`/`setTotalPages` 가 호출되지 않고 화면은 2페이지 데이터를 유지한다.
- **기대결과**: 표에 1페이지 행이 섞여 들어오지 않음. 페이지 표시(`n / m`)가 2 유지. **비-silent 초기 로드는 이 가드를 타지 않음**(`silent &&` 조건) — 사용자가 직접 넘긴 로드는 정상 반영되어야 한다.
- **확인할 로그 라인**: `[AdminNotices] poll response discarded (page changed)` `{requested:1, current:2}`
- **PASS/FAIL**: discard 로그 + 화면 유지 → PASS. 1페이지 데이터가 렌더되면 FAIL.
- **실패 시 의심**: `AdminNoticesPage.jsx:99~104` (레이스 가드), `:78~79` (`pageRef` 동기화 이펙트).

#### RT-UNIT-10. silent 상세 재조회가 `loading:true` 미설정 + 실패 시 기존 `data` 보존 `[unit]` (②, R7/R8)
- **사전조건**: 공지 1건의 행을 펼쳐 본문이 표시된 상태(`detailState[id].data` 존재).
- **Given** 펼친 행, **When** ① 정상 tick 20초 경과 ② 상세 API 를 일시적으로 실패시키는 상황(오프라인 토글) 을 각각 겪으면, **Then** ① `본문 불러오는 중...` 문구가 **한 프레임도 뜨지 않고** 본문이 갱신되며 ② 실패해도 본문이 **에러 화면으로 바뀌지 않고 기존 내용 유지**.
- **기대결과**: 정적 확인 — `fetchDetail` 의 `setDetailState({loading:true})` 가 `else`(비-silent) 분기에만 존재(`:150~154`), `catch` 에서 `if (silent) return;` 로 조기 반환(`:166`). 런타임 확인 — 본문 DOM 텍스트 길이가 0 이 되는 순간 없음.
- **확인할 로그 라인**: `[AdminNotices] detail silent refresh` `{notice:<8자>}` / 실패 시 `[AdminNotices] getAdminNoticeDetail failed {silent:true, ...}` (**본문 원문 미출력** 확인)
- **PASS/FAIL**: 깜빡임 0 + 실패 시 보존 → PASS.
- **실패 시 의심**: `AdminNoticesPage.jsx:148~154`, `:162~167`.

#### RT-UNIT-11. `csUnreadBus.emitDelta(-3)` 전달 + unsubscribe 후 미전달 `[unit]` (③)
- **사전조건**: 관리자 앱 dev 콘솔에서 모듈 직접 검증(또는 임시 vitest — 사용 후 삭제).
- **Given** `const off = subscribe(fn)`, **When** `emitDelta(-3)` → `off()` → `emitDelta(-1)`, **Then** `fn` 은 **`-3` 으로 1회만** 호출된다.
- **기대결과**: 호출 기록 `[-3]`. 추가로 `emitDelta(0)`·`emitDelta(NaN)`·`emitDelta(undefined)`·`emitDelta('x')` 는 **전부 no-op**(가드 `!Number.isFinite(n) || n === 0`), 이 경우 `[CsUnreadBus] delta` 로그도 남지 않아야 한다.
- **확인할 로그 라인**: `[CsUnreadBus] delta` `{delta:-3}` 1회 (0/NaN 케이스에서는 **미출력**)
- **PASS/FAIL**: 정확 1회 + no-op 4종 → PASS. unsubscribe 후에도 호출되면 FAIL(누수).
- **실패 시 의심**: `frontend_admin/src/utils/csUnreadBus.js:17~20`(Set 삭제), `:26~29`(가드).

#### RT-UNIT-12. 구독자 예외가 다른 구독자·호출측으로 전파되지 않음 `[unit]` (③)
- **사전조건**: 구독자 2개 등록 — 첫 번째는 즉시 `throw new Error('boom')`, 두 번째는 호출 기록.
- **Given** 예외를 던지는 구독자가 먼저 등록됨, **When** `emitDelta(-2)` 를 호출하면, **Then** 두 번째 구독자도 `-2` 를 받고 `emitDelta` 자체는 예외를 던지지 않는다.
- **기대결과**: 두 번째 구독자 호출 1회. 호출측 `try/catch` 불필요. 에러는 콘솔로만 보고되며 **에러 메시지에 대화 내용·개인정보 없음**(`{message}` 만).
- **확인할 로그 라인**: `[CsUnreadBus] handler error` `{message:'boom'}` + `[CsUnreadBus] delta` `{delta:-2}`
- **PASS/FAIL**: 전파 0 + 두 번째 수신 → PASS.
- **실패 시 의심**: `csUnreadBus.js:30~36` (`forEach` 내부 `try/catch`).

#### RT-UNIT-13. `AdminLayout` 델타 적용이 **음수로 내려가지 않음** `[unit]` (③, R12)
- **사전조건**: 관리자 앱 dev, 사이드바 CS 뱃지의 현재값 확인(예: 2).
- **Given** `csUnread === 2`, **When** 콘솔에서 `csUnreadBus.emitDelta(-5)` 를 강제 발행하면(또는 unread 5인 대화를 여는 실사용 시나리오), **Then** 뱃지 상태값이 **0** 이 되고 음수·`-3` 표기가 나타나지 않는다.
- **기대결과**: `setCsUnread((v) => Math.max(0, v + delta))` 하한 동작. 뱃지는 0 일 때 미표시(기존 렌더 규칙 유지).
- **확인할 로그 라인**: `[AdminLayout] csUnread delta applied` `{delta:-5}`
- **PASS/FAIL**: 0 하한 → PASS. 음수 표기 → FAIL.
- **실패 시 의심**: `frontend_admin/src/components/AdminLayout.jsx:56`.

#### RT-UNIT-14. `openConversation` 이 `markCsRead` **성공 시에만**, `unread>0` 일 때만 emit `[unit]` (③, R12/R13)
- **사전조건**: CS 관리 페이지. 대화 3종 준비 — (a) `unread=2` (b) `unread=0` (c) `markCsRead` 가 실패하도록 오프라인 토글한 상태의 `unread=1`.
- **Given/When/Then**:
  | 케이스 | 대화 클릭 | 기대 emit | 기대 로그 |
  |---|---|---|---|
  | a | `unread=2` | `-2` **1회** | `[AdminCs] csUnread signal {cid:<8자>, delta:-2}` → `[CsUnreadBus] delta` → `[AdminLayout] csUnread delta applied` |
  | b | `unread=0` | **0회** | signal 로그 **미출력**(뱃지 불변) |
  | c | 실패(오프라인) | **0회** | `[AdminCs] markCsRead failed` 만, signal 로그 미출력 |
  | a′ | a 를 **다시 클릭**(이미 0) | **0회** | signal 미출력 |
- **기대결과**: 정적 확인 — `prevUnread` 캡처가 `markCsRead` **이전**(`:154`)이고 emit 은 `try` 블록 안 `markCsRead` **성공 뒤**(`:167~172`). 액션당 1회 emit(렌더/updater 내부 호출 아님 → StrictMode 이중 적용 없음).
- **확인할 로그 라인**: `[AdminCs] csUnread signal` / `[CsUnreadBus] delta` / `[AdminLayout] csUnread delta applied`
- **PASS/FAIL**: 4케이스 전부 일치 → PASS. b·c 에서 emit 발생 → FAIL(드리프트 유발).
- **실패 시 의심**: `frontend_admin/src/pages/AdminCsPage.jsx:153~155`(캡처 위치), `:167~172`(emit 조건).

#### RT-UNIT-15. 본인 `unread` 이벤트가 `DmInboxPage` 읽음표시 경로를 타지 않음 `[unit]` — 핵심 (G3, R1)
- **사전조건**: 사용자 앱 소스 정적 검사 + dev 콘솔.
- **Given** `DmInboxPage.jsx` 의 WS 구독 목록, **When** `grep -n "dmSocket.on" frontend/src/pages/DmInboxPage.jsx` 를 실행하면, **Then** 구독은 `onMessage`(`:368`) / `onAccepted`(`:434`) / `onRead`(`:443`) **3종뿐**이고 **`onUnread` 구독이 0건**이다.
- **기대결과**: `onUnread` 0건 확인. 추가로 `onRead` 핸들러(`:443~452`)가 `String(m.sender_id) === String(currentUserId)` 인 메시지를 `read:true` 로 칠하는 코드임을 확인 → **이 경로에 본인 이벤트가 도달할 수 없음**이 타입 분리로 보장됨을 문서화. 런타임 확인 — 내가 대화를 열었을 때 콘솔에 `[Header] ws unread event {hasCount:false}` 는 뜨지만 DmInboxPage 발 목록 재조회 요청은 추가로 발생하지 않는다.
- **확인할 로그 라인**: `[Header] ws unread event` `{hasCount:false}`
- **PASS/FAIL**: `onUnread` 구독 0건 + 중복 리페치 0 → PASS. `DmInboxPage` 에 `onUnread` 가 추가되어 있으면 **FAIL**(PLAN §5 범위 밖 위반, 깜빡임 유발).
- **실패 시 의심**: `frontend/src/pages/DmInboxPage.jsx:443~452`, `frontend/src/utils/dmSocket.js` 디스패치 테이블.

#### RT-UNIT-16. pending no-op 시 **peer `read` 미발행 + 본인 `unread` 미발행** `[unit]` — 즉시 중단 조건 (G4, R2)
- **사전조건**: `_get_conv` 가 `{status:"pending", requester_id:<peer>, participants:[me,peer], unread:{me:1}}` 를 반환하도록 목킹. `publish_to_user` 는 호출 기록 스텁.
- **Given** 내가 **수신자**인 pending 요청, **When** `mark_read(mongo, cid, me)` 호출, **Then** 함수는 **조기 return** 하여 `{"conversation_id":cid, "read":False, "marked":0}` 를 반환하고 `publish_to_user` 호출 **0회**, `dm_conversations.update_one`·`dm_messages.update_many` 호출 **0회**.
- **기대결과**: unread 보존(요청 열람 사실을 발신자에게 노출하지 않는 프라이버시 설계). **본인 대상 `unread` 도 금지** — 이 분기에서는 뱃지가 줄지 않는 것이 정상이다.
- **확인할 로그 라인**: `[dm] mark_read skipped (pending request) conv=%s me=%s` (published/skipped(nothing to clear) 라인은 **둘 다 미출력**)
- **PASS/FAIL**: 발행 0 + DB 쓰기 0 + 반환 정확 → PASS. 하나라도 어긋나면 **FAIL + 즉시 중단**.
- **실패 시 의심**: `dm_service.py:587~594` (pending 가드가 `prev_unread` 캡처(`:597`)보다 **위**에 있어야 한다).

#### RT-UNIT-17. 관리자 폴링 2종 **존치** — `AdminCsPage` 12초 / `AdminLayout` 30초 `[unit]` (G10, R11)
- **사전조건**: 관리자 앱 소스 + dev 실행.
- **Given** v195 변경 후 소스, **When** `grep -n "POLL_MS\|setInterval" frontend_admin/src/pages/AdminCsPage.jsx frontend_admin/src/components/AdminLayout.jsx` 를 실행하면, **Then** `AdminCsPage.jsx:20 POLL_MS = 12000` + `:210~214 setInterval` 이 **존재**하고 `AdminLayout.jsx:10 CS_UNREAD_POLL_MS = 30000` + `:47 setInterval(fetchUnread, ...)` 도 **존재**한다.
- **기대결과**: 두 인터벌 모두 살아 있고 실제로 동작(Network 탭에서 12초 주기 CS 목록 요청, 30초 주기 `GET /admin/cs/unread-count` 관찰). **델타 버스는 폴링을 대체하지 않는 보완 경로**임을 확인.
- **확인할 로그 라인**: 30초 tick 후 `[AdminLayout] csUnread delta applied` 없이 뱃지가 권위값으로 교정되는지(델타 로그 없이 값 변동 = 폴링 동작)
- **PASS/FAIL**: 두 인터벌 존재 + 네트워크 주기 관찰 → PASS. 제거·주기 변경 → FAIL.
- **실패 시 의심**: `AdminCsPage.jsx:20`, `:210`; `AdminLayout.jsx:10`, `:47`.

#### RT-UNIT-18. 공지 폴링이 `expandedId`·`page`·`modal` 을 건드리지 않음 `[unit]` (G11, R7/R9/R10)
- **사전조건**: 공지 관리 페이지, 2페이지로 이동 + 임의 행 1개 펼침.
- **Given** `page=2`, `expandedId=<notice-id>`, 모달 닫힘, **When** 폴링이 3회(60초) tick 하면, **Then** 세 상태가 모두 불변이다.
- **기대결과**: 정적 확인 — 폴링 이펙트(`AdminNoticesPage.jsx:174~197`) 안에 `setExpandedId`/`setPage`/`setModal` **호출 0건**(ref 읽기만: `pageRef.current`, `expandedIdRef.current`, `modalOpenRef.current`). `setExpandedId(null)` 은 `[page, reloadKey]` 이펙트(`:139~144`) 전용으로 유지. 폴링 이펙트 의존성 배열이 `[loadNotices, fetchDetail]`(둘 다 `useCallback([])` → 불변)이라 **인터벌 재시작이 발생하지 않음**도 확인.
- **확인할 로그 라인**: `[AdminNotices] poll tick {page:2}` ×3 (page 가 1로 바뀌면 FAIL) + `[AdminNotices] detail silent refresh` ×3
- **PASS/FAIL**: 3상태 불변 + tick 로그의 page 유지 → PASS.
- **실패 시 의심**: `AdminNoticesPage.jsx:174~197`, 의존성 배열 `:197`.

#### RT-UNIT-19. **9004 미러** — `diff -q` 5개 파일 무출력 `[unit]` (G12, R15)
- **사전조건**: 메인 체크아웃 `/mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music`.
- **Given** v195 변경 후, **When** 아래를 실행하면
  ```
  for f in app/services/dm_service.py app/routes/dm.py app/routes/admin_cs.py \
           app/routes/admin_notices.py app/services/notice_service.py; do
    diff -q backend_9005/$f backend_9004/$f
  done
  ```
  **Then** **출력이 전혀 없다**(5개 전부 byte-identical).
- **기대결과**: 이번 변경 대상인 `dm_service.py` 포함 5개 무출력. 보조 확인 — `grep -n 'publish_to_user(me_id' backend_9004/app/services/dm_service.py` 가 **`:616`** 을 반환(9005 와 동일 라인).
- **확인할 로그 라인**: (정적 검사 — 로그 없음). 대신 `grep -c 'self-unread' backend_9004/app/services/dm_service.py` == `grep -c 'self-unread' backend_9005/app/services/dm_service.py`
- **PASS/FAIL**: 무출력 → PASS. 1줄이라도 출력 → FAIL(미러 누락).
- **실패 시 의심**: `backend_9004/app/services/dm_service.py:596~626`.

#### RT-UNIT-20. **신규 로그에 본문·닉네임 원문 없음** (정적 grep) `[unit]` (G13, R17)
- **사전조건**: 소스 정적 검사.
- **Given** v195 에서 추가·수정된 로그 라인 전부, **When** 아래를 확인하면, **Then** 어떤 라인도 원문 문자열을 담지 않는다.
  - `dm_service.py:610~625` — `_short(cid)`·`_short(me_id)`·정수 2개만. 메시지 `text` 참조 0.
  - `Header.jsx:203~205` — `{hasCount: boolean}` 만. `conversation_id`·`count` 값·본문 참조 0.
  - `AdminNoticesPage.jsx` 신규 로그 — `poll tick{page,silent}` / `poll skipped{reason}` / `poll merged{page,count,read_total}` / `poll response discarded{requested,current}` / `detail silent refresh{notice:8자}`. **`text`·`text_preview`·`admin_nickname` 참조 0.**
  - `csUnreadBus.js:29`,`:34` — `{delta}` / `{message}` 만.
  - `AdminLayout.jsx:55` — `{delta}` 만. `AdminCsPage.jsx:169` — `{cid: 앞8자, delta}` 만.
- **기대결과**: `grep -n "console\.\(info\|warn\|error\)" <대상 5파일>` 결과에서 `text`·`nickname`·`email`·`birth`·`gender` 를 실어 나르는 신규 라인 **0건**.
- **확인할 로그 라인**: 위 6종 문자열 자체가 검사 대상.
- **PASS/FAIL**: 0건 → PASS. 1건이라도 원문 노출 → FAIL + 즉시 보고.
- **실패 시 의심**: `AdminNoticesPage.jsx:116~118`(`poll merged` 집계부 — `read_total` 은 숫자 합산이어야 한다).

---

### 2. `[api]` 시나리오 — 16건

> 실행 방식: 9005 에 직접 HTTP 호출(`curl`/HTTPie). 토큰은 플레이스홀더. **`POST /api/admin/cs/broadcast` 는 200 을 만들지 않는다.**

#### RT-API-01. `POST /api/dm/conversations/{cid}/read` 응답 스키마 **불변** `[api]` (①)
- **사전조건**: `<test-user-a>` 로 로그인, `<test-user-b>` 와의 accepted 대화 `<cid>` 에 미읽음 2건.
- **Given** 미읽음 있는 대화, **When** `POST /api/dm/conversations/<cid>/read` (`Authorization: Bearer <TEST_USER_A_TOKEN>`), **Then** 200 + 응답 키 집합이 **정확히 `{conversation_id, read, marked}`**.
- **기대결과**: `read == true`, `marked == 2`, `conversation_id == <cid>`. **키 추가·삭제 0**(v194 이전과 동일 — v195 는 API 계약 변경 0). 두 번째 호출은 `{read:true, marked:0}`.
- **확인할 로그 라인**: `[dm] mark_read self-unread published conv=.. me=.. prev_unread=2 marked=2` → `[dm-pubsub] fanout uid=.. sent=N type=unread` (peer 쪽 `type=read` 도 함께)
- **PASS/FAIL**: 3키 정확 일치 → PASS. 키 변동 → FAIL(계약 파괴).
- **실패 시 의심**: `backend_9005/app/routes/dm.py:217~229`, `dm_service.py:626~628`.

#### RT-API-02. `GET /api/dm/unread-count` 가 열람 후 감소 반영 `[api]` (①)
- **사전조건**: `<test-user-a>` 에 미읽음 총 N(≥2), pending 요청 R건.
- **Given** 열람 전 `GET /api/dm/unread-count` → `{count:N, requests:R}`, **When** `POST .../read` 로 미읽음 2건 대화를 읽고 다시 조회하면, **Then** `{count:N-2, requests:R}`.
- **기대결과**: `count` 만 감소, `requests` **불변**(pending 은 read 대상 아님). 응답 키 2개 고정.
- **확인할 로그 라인**: `[dm] mark_read self-unread published ...` 직후 `[dm] unread_count ...`(요청 로그) — count 값은 응답으로 판정.
- **PASS/FAIL**: 정확히 −2 → PASS. `requests` 가 변하면 FAIL.
- **실패 시 의심**: `dm.py:232~248`, `dm_service.py:633~` `unread_total`.

#### RT-API-03. `GET /api/admin/notices?page=1&limit=20` **연속 2회 계약 동일** `[api]` (②)
- **사전조건**: `<TEST_ADMIN_TOKEN>`. 기존 실공지 존재(읽기 전용).
- **Given** 폴링이 같은 요청을 20초마다 반복한다는 전제, **When** 동일 요청을 **연속 2회**(간격 ~20초) 보내면, **Then** 두 응답의 **키 집합·타입이 완전히 동일**하다.
- **기대결과**: 각 행 17키 = `{id, text_preview, text_len, audience, status, stale, targets, sent, failed, delivered, read_count, read_rate, admin_id, admin_nickname, admin_code, created_at, finished_at}`. `pagination` = `{page, limit, total, pages}`. 값 중 **`read_count`·`read_rate` 만 변동 허용**(다른 필드 변동 시 원인 규명 필요). `read_rate` 타입은 `float`, `stale` 은 `bool`. 응답에 **본문 전문(`text`) 미포함**.
- **확인할 로그 라인**: 서버 `[admin-notices] list admin=.. page=1 limit=20 audience=-` ×2 + `[admin-notices] list done admin=.. total=.. returned=..` ×2 / 클라이언트 `[AdminNotices] poll merged {page:1, count:N, read_total:M}`
- **PASS/FAIL**: 키 집합·타입 동일 → PASS. 필드 누락/추가 → FAIL.
- **실패 시 의심**: `backend_9005/app/services/notice_service.py:136~172` (`_serialize_notice`), `app/routes/admin_notices.py:43~94`.

#### RT-API-04. 기존 DM 송수신 + `before` 커서 과거 로드 `[api]` (G1)
- **사전조건**: `<test-user-a>`↔`<test-user-b>` accepted 대화 `<cid>`, 메시지 ≥ 25건(부족하면 테스트 계정끼리 채운다 — §0-8 허용 범위).
- **Given** 기존 대화, **When** ① `POST /api/dm/conversations/<cid>/messages` (본문 짧은 테스트 문자열) ② `GET /api/dm/conversations/<cid>/messages?limit=20` ③ ②의 최상단 id 로 `GET ...?before=<id>&limit=20`, **Then** ① 201/200 + 생성 메시지 반환 ② 20건 + `has_more:true` ③ 그 이전 구간이 **중복 없이** 반환.
- **기대결과**: 메시지 직렬화 키 집합이 v194 와 동일(`_serialize_message` 화이트리스트 불변 — 개인정보 필드 0). `before` 페이지네이션 정상.
- **확인할 로그 라인**: `[dm] message sent conv=.. me=.. peer=.. len=N notice=-` (본문 대신 **길이만** 기록되는지 확인)
- **PASS/FAIL**: 3단계 정상 + 중복 0 → PASS.
- **실패 시 의심**: `dm_service.py:493~569` (`send_message`), `dm.py:179~215`.

#### RT-API-05. pending no-op — 반환·unread 보존·뱃지 불변 `[api]` — 즉시 중단 조건 (G4, R2)
- **사전조건**: `<test-user-b>` → `<test-user-a>` 로 **서로 팔로우하지 않는 상태**의 메시지 요청 1건 생성(pending 대화 `<cid>`, `<test-user-a>` 미읽음 1).
- **Given** `<test-user-a>` 가 수신자인 pending 대화, **When** `<TEST_USER_A_TOKEN>` 으로 `POST /api/dm/conversations/<cid>/read`, **Then** 200 + **`{conversation_id, read:false, marked:0}`**.
- **기대결과**: 호출 전후 `GET /api/dm/unread-count` 의 `requests` **불변**, `count` **불변**. DB 상 `unread.<a>` 보존. **`[dm-pubsub] fanout ... type=read` 도 `type=unread` 도 발생하지 않음**(요청자에게 열람 사실 미노출).
- **확인할 로그 라인**: `[dm] mark_read skipped (pending request) conv=%s me=%s` **만** 출력. `[dm] mark_read self-unread published` / `self-unread skipped (nothing to clear)` / `[dm-pubsub] fanout ... type=read` 는 **전부 미출력**.
- **PASS/FAIL**: 반환·불변·무발행 3조건 → PASS. 하나라도 어긋나면 **FAIL + 즉시 중단**.
- **실패 시 의심**: `dm_service.py:587~594`.

#### RT-API-06. 메시지 요청함 — `/requests` / accept / decline / `accepted` 이벤트 `[api]` (G5)
- **사전조건**: 테스트 계정 간 pending 요청 2건(수락용 1, 거절용 1).
- **Given** pending 2건, **When** ① `GET /api/dm/requests` ② `POST /api/dm/conversations/<cid1>/accept` ③ `DELETE /api/dm/conversations/<cid2>` , **Then** ① 요청 목록에 2건 + 개인정보 필드 0 ② 200 + `status:"accepted"` ③ 200/204 + 목록에서 제거.
- **기대결과**: accept 시 **요청자(peer)에게 `{"type":"accepted"}` 이벤트 발행**. 수락 후 `GET /unread-count` 의 `requests` 가 −1, `count` 는 해당 대화 unread 만큼 증가(pending 동안 보존됐던 값이 산입).
- **확인할 로그 라인**: `[dm-pubsub] fanout uid=.. sent=N type=accepted`
- **PASS/FAIL**: 3단계 정상 + accepted 이벤트 관측 → PASS.
- **실패 시 의심**: `dm_service.py:694~710` (`accept_request`), `dm.py:295~340`.

#### RT-API-07. CS 전체발송 — audience 화이트리스트 **400 또는 422** `[api]` — ⚠️ 200 성립 금지 (G6)
> **기대값 정정 (v195 tester 실측 반영)**: 최초 기대값은 "4건 전부 400" 이었으나, `null`(및 키 누락·숫자)은 `BroadcastCsBody.audience: str`(non-Optional, `admin_cs.py:42~44`)에 걸려 **Pydantic 이 핸들러 진입 전에 422 로 거절**한다. 이는 FastAPI 표준 동작이며 `admin_cs.py` 는 v195 에서 **미변경**이다. 판정 기준을 **"400 또는 422 — 단 2xx 는 절대 불가"** 로 정정한다. 본질은 상태코드가 아니라 **발송 미성립**이다.

- **사전조건**: `<TEST_ADMIN_TOKEN>`.
- **Given** 화이트리스트 `{all, users, customers}`, **When** `POST /api/admin/cs/broadcast` 에 `audience` = `admins` / `""` / `null` / `ALL`(대문자) 를 각각 담아 보내면, **Then** 타입이 맞는 값(`admins`·`""`·`ALL`)은 **400**, 타입이 틀린 값(`null`)은 **422**.
- **기대결과**: 4건 모두 **2xx 아님**. **어떤 경우에도 발송이 시작되지 않는다** — 응답에 `notice_id`·`targets` 가 실려 있으면 발송이 성립한 것이므로 **즉시 중단·planner 보고**. `notices` 컬렉션 건수가 호출 전후 **동일**함을 `GET /api/admin/notices?page=1` 의 `pagination.total` 로 확인.
- **확인할 로그 라인**: 서버 경고 라인 확인 + `[notice] ...` 신규 생성 로그가 **없음**을 확인
- **PASS/FAIL**: 4건 전부 400 또는 422 + `total` 불변 → PASS. 하나라도 2xx → **FAIL + 즉시 중단**.
- **실패 시 의심**: `backend_9005/app/routes/admin_cs.py:271~` 의 audience 검증 위치(400 경로) / `:42~44` `BroadcastCsBody` 타입 선언(422 경로).

#### RT-API-08. CS 전체발송 — 인가 **401 / 403** `[api]` — ⚠️ 200 성립 금지 (G6)
- **사전조건**: 토큰 없음 / 일반 사용자 토큰 `<TEST_USER_A_TOKEN>`.
- **Given** 관리자 전용 엔드포인트, **When** ① 토큰 없이 ② 일반 사용자 토큰으로 `POST /api/admin/cs/broadcast` (body 는 **유효한 audience 를 쓰지 않는다** — 인가가 먼저 걸리더라도 이중 안전), **Then** ① **401** ② **403**.
- **기대결과**: 인가 실패가 **audience 검증보다 먼저** 걸린다(의존성 순서). `notices.total` 불변.
- **확인할 로그 라인**: `[admin-cs] ...` 요청 로그가 남지 않거나 인가 거절만 기록됨
- **PASS/FAIL**: 401·403 정확 → PASS. 2xx → **FAIL + 즉시 중단**.
- **실패 시 의심**: `admin_cs.py:271` 의 `Depends(get_admin_user)`.

#### RT-API-09. CS 전체발송 — official 미시드 **503** / 중복 락 **429** `[api]` — ⚠️ 200 성립 금지 / **planner 승인 필요** (G6)
- **사전조건**: **① 503 분기는 관찰만**(official 계정을 삭제·변조하지 **않는다** — 현재 시드되어 있으므로 재현 불가 시 `SKIP(재현 불가 — 코드 경로 정적 확인으로 대체)`). ② 429 는 **Redis 브로드캐스트 락 키 1개를 수동 선점**해야 하며 **planner 승인 전 실행 금지**.
- **Given** 락이 이미 잡힌 상태, **When** `POST /api/admin/cs/broadcast` 를 유효 audience 로 호출하면, **Then** **429** 로 즉시 거절되고 발송이 **시작되지 않는다**.
- **기대결과**: 429 + `notices.total` 불변. 락은 TTL 로 자연 해제(수동 삭제 금지). 503 분기는 `_resolve_official` 실패 경로를 코드 리뷰로 확인하고 `SKIP` 기록.
- **확인할 로그 라인**: 락 충돌 경고 라인 + `[notice]` 신규 생성 로그 **없음**
- **PASS/FAIL**: 429 + total 불변 → PASS. 200 → **FAIL + 즉시 중단**.
- **실패 시 의심**: `admin_cs.py:271~` 락 획득부, `_resolve_official`.
- **⚠️ 승인 사유**: Redis 키 선점은 §0-8 의 쓰기 항목이며 락 유효시간 동안 **관리자의 정상 발송을 막는다.**

#### RT-API-10. 구버전 `POST /api/dm/broadcast` → **410** `[api]` (G7)
- **사전조건**: `<TEST_USER_A_TOKEN>` (일반 사용자 토큰으로도 410 이어야 한다).
- **Given** v194 에서 폐기된 경로, **When** `POST /api/dm/broadcast` 를 body 유무 관계없이 호출하면, **Then** **410 Gone** + `{"error": "지원하지 않는 경로입니다. ..."}`.
- **기대결과**: 어떤 경우에도 발송 0. 9004 에서도 동일 410.
- **확인할 로그 라인**: `[dm-broadcast] gone (deprecated endpoint) me=%s`
- **PASS/FAIL**: 410 → PASS. 2xx/404/500 → FAIL.
- **실패 시 의심**: `backend_9005/app/routes/dm.py:281~293`.

#### RT-API-11. 공지 목록 17키 + 상세 +2키 계약 `[api]` (G8)
- **사전조건**: `<TEST_ADMIN_TOKEN>`, 기존 공지 `<notice-id>`(읽기 전용).
- **Given** 목록·상세 API, **When** ① `GET /api/admin/notices?page=1&limit=20` ② `GET /api/admin/notices/<notice-id>`, **Then** ① 각 행 키 집합이 **정확히 17키**(RT-API-03 목록) ② 상세는 목록 행 + **`text`, `official_id`** = **19키**.
- **기대결과**: 상세에만 본문 전문 존재(목록에는 `text_preview`(≤60자)·`text_len` 만). `text_preview` 길이 ≤ 60 이고 **말줄임 기호 미부착**. `text_len` == 원문 전체 길이(preview 길이와 다를 수 있음). **본문 원문은 산출물에 기재하지 않고 `text_len` 값만 기록.**
- **확인할 로그 라인**: `[admin-notices] detail admin=%s notice=%s` (notice 는 앞 8자)
- **PASS/FAIL**: 17/19키 정확 → PASS. 필드 증감 → FAIL(v195 는 백엔드 공지 무수정이므로 변동 자체가 회귀).
- **실패 시 의심**: `notice_service.py:136~172`, `admin_notices.py:101~`.

#### RT-API-12. 공지 API 에러 코드 — audience 400 / 잘못된 id 400 / 미존재 404 `[api]` (G8)
- **사전조건**: `<TEST_ADMIN_TOKEN>`.
- **Given/When/Then**:
  | 요청 | 기대 |
  |---|---|
  | `GET /api/admin/notices?audience=admins` | **400** `{"error":"발송 대상이 올바르지 않습니다."}` |
  | `GET /api/admin/notices?audience=users` | **200** (화이트리스트 통과) |
  | `GET /api/admin/notices/not-an-objectid` | **400** `{"error":"잘못된 공지 ID 입니다."}` |
  | `GET /api/admin/notices/<존재하지 않는 24자리 ObjectId>` | **404** |
  | `GET /api/admin/notices?page=0&limit=9999` | **200** + `pagination.page==1`, `limit` 이 `MAX_LIST_LIMIT` 로 클램프 |
- **기대결과**: 표대로. 500 이 나오면 FAIL.
- **확인할 로그 라인**: `[admin-notices] list admin=.. audience=admins` / `[admin-notices] detail admin=.. notice=..`
- **PASS/FAIL**: 5행 전부 일치 → PASS.
- **실패 시 의심**: `admin_notices.py:58~76`(클램프), `:76~78`(audience 400), `:110~`(id 400/404).

#### RT-API-13. 시각 **UTC `+00:00` 표기** `[api]` (G9)
- **사전조건**: `<TEST_ADMIN_TOKEN>`.
- **Given** 공지 목록·상세 응답의 `created_at`·`finished_at`, **When** 값을 검사하면, **Then** 전부 **`+00:00`(또는 명시적 오프셋) 접미가 붙은 ISO 8601** 이며 오프셋 없는 naive 문자열이 **0건**이다.
- **기대결과**: 정적 보강 — `grep -n "isoformat()" backend_9005/app/routes/admin_notices.py backend_9005/app/services/notice_service.py` 결과에서 **`_iso` 정의부 외 직접 호출 0건**. `finished_at` 이 `null` 인 행(발송중)은 허용.
- **확인할 로그 라인**: (계약 검사 — 응답 값으로 판정)
- **PASS/FAIL**: 오프셋 누락 0 + 직접 호출 0 → PASS.
- **실패 시 의심**: `notice_service.py` 의 `_iso` 정의부.

#### RT-API-14. 응답 **개인정보 미노출** `[api]` (G13)
- **사전조건**: `<TEST_ADMIN_TOKEN>`, `<TEST_USER_A_TOKEN>`.
- **Given** v195 이후 응답들, **When** 아래 6개 응답 본문에서 `birth`/`birthday`/`birth_date`/`gender`/`sex`/`email` 키를 재귀 탐색하면, **Then** **전부 0건**:
  `GET /api/admin/notices` · `GET /api/admin/notices/<notice-id>` · `GET /api/admin/cs/conversations` · `GET /api/admin/cs/conversations/<cid>/messages` · `GET /api/dm/conversations` · `GET /api/dm/conversations/<cid>/messages`
- **기대결과**: 위 키 0건. 관리자 하이드레이션은 `admin_nickname`·`admin_code` 만. **관측된 실제 값은 산출물에 옮겨 적지 않고 "키 0건" 만 기록.**
- **확인할 로그 라인**: 서버 로그 grep — `grep -nE "birth|gender|email" <9005 로그 tail>` 결과에서 v195 신규 라인(`self-unread`) 매칭 **0건**
- **PASS/FAIL**: 키 0건 + 로그 매칭 0건 → PASS. 1건이라도 → **FAIL + 즉시 보고**.
- **실패 시 의심**: `notice_service.py:163~165`(하이드레이션 화이트리스트), `dm_service._serialize_message`.

#### RT-API-15. official 계정 무해성 — `fanout ... sent=0 type=unread` `[api]` (G14, R6)
- **사전조건**: `<TEST_ADMIN_TOKEN>`, 미읽음이 있는 CS 대화 `<cid>`(테스트 계정이 official 에게 보낸 것). 9005 로그 tail 준비.
- **Given** 관리자 앱에 WS 사용처가 0건이므로 official 의 수신 소켓이 없다, **When** `POST /api/admin/cs/conversations/<cid>/read` 를 호출하면, **Then** 정상 200 + `{conversation_id, read, marked}` 이고 pubsub 로그에 **`sent=0`** 이 남는다.
- **기대결과**: `[dm-pubsub] fanout uid=<official 앞8자> sent=0 type=unread` — **`sent` 가 0 이 아니면** 관리자 세션이 사용자 WS 에 붙어 있다는 뜻이므로 원인 규명 필요. 관리자 앱 동작·화면 **무변화**(에러·리렌더 폭주 0). 이벤트 페이로드에 `conversation_id` 외 필드 없음.
- **확인할 로그 라인**: `[admin-cs] cid=.. admin=.. read` → `[dm] mark_read self-unread published conv=.. me=.. prev_unread=N marked=M` → `[dm-pubsub] fanout uid=.. sent=0 type=unread` (peer=테스트 계정 쪽은 `type=read`, `sent` 는 접속 여부에 따름)
- **PASS/FAIL**: 200 + `sent=0` + 관리자 앱 무변화 → PASS.
- **실패 시 의심**: `admin_cs.py:187~205`, `dm.py:460~475`(fanout 로그), `dm.py:55~91`(`ConnectionManager`).

#### RT-API-16. **9004 런타임 동등성** — 동일 요청·동일 응답·동일 신규 로그 `[api]` (G12 보완, R15)
- **사전조건**: 9004 가 기동 중이고 9005 와 동일 Mongo/Redis 를 바라보는지 먼저 확인(다르면 `SKIP` + planner 보고 — 인프라 조작 금지).
- **Given** RT-UNIT-19 로 파일 동일성이 확인된 상태, **When** 9004 에 `POST /api/dm/conversations/<cid>/read` 와 `GET /api/dm/unread-count` 를 보내면, **Then** 9005 와 **응답 키 집합·상태코드가 동일**하고 9004 로그에도 `self-unread` 라인이 남는다.
- **기대결과**: `{conversation_id, read, marked}` / `{count, requests}` 동일. 9004 로그에 `[dm] mark_read self-unread published ...` 또는 `... skipped (nothing to clear) ...` 출현.
- **확인할 로그 라인**: `[dm] mark_read self-unread published conv=%s me=%s prev_unread=%d marked=%d` (9004 로그)
- **PASS/FAIL**: 응답 동일 + 로그 출현 → PASS. 9004 에만 500/구버전 응답 → FAIL(미러 반영 누락).
- **실패 시 의심**: `backend_9004/app/services/dm_service.py:596~626`, 9004 프로세스 재기동 여부(핫리로드 미적용 가능성).

---

### 3. `[e2e]` 시나리오 — 8건

> 실행 방식: 브라우저 2창/2탭. **dev 서버**로 띄운 상태(§0-11). 시간 판정은 스톱워치 + 콘솔 타임스탬프.

#### RT-E2E-01. 두 탭 동시 로그인 → 한 탭 열람 → **다른 탭 뱃지가 폴링(30s) 전에 0** `[e2e]` (①)
- **사전조건**: `<test-user-a>` 로 **탭1·탭2** 동시 로그인(4000). 본인인증 완료 계정(미인증이면 봉투 비활성이라 시나리오 불성립). 미읽음 ≥ 1 인 대화 존재. 두 탭 모두 헤더 뱃지에 동일 숫자 표시. 두 탭 콘솔 열어 둠.
- **Given** 탭1·탭2 뱃지 = N(≥1), **When** **탭1** 에서 해당 대화를 열어 읽으면, **Then** **탭2** 의 헤더 뱃지가 **5초 이내**(30초 폴링 주기 이전)에 감소한다.
- **기대결과**: 탭2 콘솔에 `[Header] ws unread event {hasCount:false}` → 이어서 `GET /api/dm/unread-count` 1회 → 뱃지 갱신. 판정 기준은 **"30초 폴링 tick 이 오기 전에 값이 바뀌었는가"** — 스톱워치로 5초 이내 확인. 탭2 의 DM 목록 화면이 열려 있어도 **깜빡임·중복 재조회 없음**(DmInboxPage 는 `onUnread` 미구독).
- **확인할 로그 라인**: 탭2 `[Header] ws unread event {hasCount:false}` / 서버 `[dm] mark_read self-unread published conv=.. me=.. prev_unread=N marked=M` → `[dm-pubsub] fanout uid=.. sent=2 type=unread` (**`sent=2`** = 두 탭 소켓)
- **PASS/FAIL**: 5초 이내 감소 + `sent≥2` → PASS. 30초 뒤에야 바뀌면 FAIL(WS 미도달 — 원래 증상).
- **실패 시 의심**: `dm_service.py:616`, `dm.py:55~91`(멀티탭 소켓 집합), `frontend/src/components/Header.jsx:201~209`, `frontend/src/utils/dmSocket.js`(재연결 상태).

#### RT-E2E-02. 4000 에서 공지 DM 열람 → 4001 공지 읽음 수 **20~25초 내 +1**(새로고침 없이) `[e2e]` (②)
- **사전조건**: **기존 실공지 1건**(§0-3, 읽기 전용)의 **미읽음 수신자가 테스트 계정**인지 먼저 확인. 4001 공지 관리 페이지를 열어 그 공지 행의 `read_count`·`read_rate` 를 **스크린샷/메모로 기록**(본문은 기록하지 않는다). 4001 탭은 **포그라운드 유지**(`document.hidden=false`), 모달 닫힘.
- **Given** 4001 에 공지 목록이 떠 있고 `read_count = M`, **When** 4000 에서 테스트 계정으로 그 공지 DM 을 열어 읽으면, **Then** 4001 에서 **새로고침 없이 20~25초 이내** `read_count` 가 **M+1** 로 바뀌고 `read_rate` 도 재계산된다.
- **기대결과**: 페이지 스크롤 위치·페이지 번호·펼침 상태 불변. 표가 `로딩 중...` 으로 교체되지 않음. **공지 자체는 수정·재발송하지 않는다.**
- **확인할 로그 라인**: 4001 콘솔 `[AdminNotices] poll tick {page:1, silent:true}` → `[AdminNotices] poll merged {page:1, count:N, read_total:M+1}` / 4000 서버 `[dm] mark_read self-unread published ...`
- **PASS/FAIL**: 25초 이내 +1 → PASS. 새로고침해야 바뀌면 FAIL(원래 증상).
- **실패 시 의심**: `AdminNoticesPage.jsx:174~197`(폴링 이펙트), `notice_service.py:269~300`(`_read_stats` 집계 — `notice_id` sparse 인덱스), `dm_service.py:599~605`(`read=true` 일괄 갱신).

#### RT-E2E-03. 행 펼친 상태로 60초 → **접히지 않음 + 표 미깜빡임** `[e2e]` (②, R7/R8)
- **사전조건**: 4001 공지 관리 페이지, 임의 행 1개 클릭해 본문 확장. 콘솔 열어 둠. 화면 녹화 권장.
- **Given** 확장된 행 1개, **When** 60초(폴링 3 tick) 동안 아무 조작 없이 관찰하면, **Then** 행이 접히지 않고 본문이 계속 표시되며 `로딩 중...`·`본문 불러오는 중...` 이 **한 번도** 나타나지 않는다.
- **기대결과**: `poll tick` ×3 + `detail silent refresh` ×3. 표 `<tbody>` DOM 노드 유지(스크롤 위치 튐 0). 확장행 본문 텍스트가 공백으로 바뀌는 프레임 0.
- **확인할 로그 라인**: `[AdminNotices] poll tick` ×3 / `[AdminNotices] poll merged` ×3 / `[AdminNotices] detail silent refresh {notice:<8자>}` ×3 — **`[AdminNotices] list loaded` 는 0회**여야 한다.
- **PASS/FAIL**: 접힘 0 + 깜빡임 0 → PASS.
- **실패 시 의심**: `AdminNoticesPage.jsx:139~144`(`setExpandedId(null)` 이 폴링 경로를 타는지), `:148~154`.

#### RT-E2E-04. CS 대화 클릭 → 사이드바 뱃지 **즉시 감소** + 30초 폴링 후 **값 유지** `[e2e]` (③, R13)
- **사전조건**: 4001 로그인, 사이드바 CS 뱃지 값 T(≥2). 미읽음 `u`(≥1)인 CS 대화 존재.
- **Given** 뱃지 = T, 대화 미읽음 = u, **When** 그 대화를 클릭해 읽음 처리하면, **Then** 뱃지가 **1초 이내 `T-u`** 로 감소하고, **30초 폴링 tick 이후에도 `T-u` 를 유지**한다(드리프트 0).
- **기대결과**: 폴링이 권위값을 가져와도 값이 되돌아가거나 튀지 않음. 같은 대화를 **다시 클릭**해도 뱃지 불변(`unread=0` → emit 없음). 뱃지가 0 이 되면 미표시.
- **확인할 로그 라인**: `[AdminCs] marked read {cid:<8자>}` → `[AdminCs] csUnread signal {cid:<8자>, delta:-u}` → `[CsUnreadBus] delta {delta:-u}` → `[AdminLayout] csUnread delta applied {delta:-u}` / 30초 뒤 `GET /admin/cs/unread-count` 응답이 `T-u`
- **PASS/FAIL**: 즉시 감소 + 30초 후 동일 → PASS. 폴링 후 되돌아가면 FAIL(서버 읽음 처리 실패 또는 델타 과다).
- **실패 시 의심**: `AdminCsPage.jsx:153~172`, `AdminLayout.jsx:51~59`, `admin_cs.py:187~205`.

#### RT-E2E-05. 기존 DM 송수신 화면 회귀 — 낙관적 추가·롤백·과거 로드 `[e2e]` (G1)
- **사전조건**: `<test-user-a>`(창1) ↔ `<test-user-b>`(창2), 메시지 ≥ 25건인 대화.
- **Given** DM 화면, **When** ① A 가 메시지 전송 ② 네트워크 오프라인 상태에서 전송 ③ 스크롤 상단까지 올려 과거 로드, **Then** ① 즉시 화면에 붙고 서버 응답으로 확정 + 창2 에 실시간 도착 ② **낙관적 말풍선이 롤백**되고 에러 안내 ③ 이전 20건이 중복 없이 위로 붙고 스크롤 점프 없음.
- **기대결과**: v195 이전과 **동일 동작**. 본인 `unread` 이벤트로 인한 목록 깜빡임·중복 재조회 0.
- **확인할 로그 라인**: `[DmInbox] loading older messages {before:<8자>}` / 서버 `[dm] message sent conv=.. len=N notice=-`
- **PASS/FAIL**: 3동작 정상 → PASS.
- **실패 시 의심**: `frontend/src/pages/DmInboxPage.jsx:298~314`(과거 로드), `:368~`(onMessage).

#### RT-E2E-06. 받을 때 즉시 뱃지 — A→B 전송 시 B 헤더 뱃지가 **폴링 전에 +1** `[e2e]` (G2, R3)
- **사전조건**: A(창1)·B(창2) 각각 4000 로그인. B 는 **DM 화면이 아닌 다른 페이지**(홈)에 있어야 한다(활성 대화면 자동 읽음 처리됨). B 헤더 뱃지 = N.
- **Given** B 뱃지 = N, **When** A 가 B 에게 메시지 1건을 보내면, **Then** B 뱃지가 **5초 이내 N+1**.
- **기대결과**: `send_message` 의 peer 발행(무수정)이 그대로 동작. B 콘솔에는 `[Header] ws unread event` 가 **아니라** `onMessage` 경로가 타므로 `unread event` 로그는 안 나오는 것이 정상.
- **확인할 로그 라인**: 서버 `[dm] message sent conv=.. me=.. peer=.. len=N notice=-` → `[dm-pubsub] fanout uid=<B> sent=1 type=message`
- **PASS/FAIL**: 5초 이내 +1 → PASS. 30초 뒤에야 뜨면 FAIL(v195 가 peer 발행을 깼을 가능성).
- **실패 시 의심**: `dm_service.py:552~563`(`send_message` peer 발행), `Header.jsx:201`(onMessage 핸들러).

#### RT-E2E-07. 읽음표시 동기화 — 상대가 읽으면 ON / **내가 읽었을 때 내 메시지가 read 로 칠해지면 FAIL** `[e2e]` — 즉시 중단 조건 (G3, R1)
- **사전조건**: A(창1)·B(창2) 모두 해당 **대화 화면을 연 상태**. A 가 보낸 미읽음 메시지가 있고, B 가 보낸 미읽음 메시지도 있는 양방향 상태.
- **Given** 양쪽 대화 화면, **When** ① **B 가** 대화를 열어 읽으면 ② **A 가** (B 의 메시지를) 읽으면, **Then** ① **A 화면의 A 메시지**에 읽음표시가 켜진다 ② **A 화면의 A 메시지 읽음표시는 변하지 않는다**(B 가 아직 안 읽은 메시지가 갑자기 읽음으로 바뀌면 안 됨).
- **기대결과**: ②가 핵심 — 본인 대상 이벤트 타입이 `unread` 이므로 `DmInboxPage:443` 의 `onRead` 가 **호출되지 않는다**. A 화면에서 A 메시지의 읽음표시 개수가 ② 전후로 **동일**해야 한다. A 헤더 뱃지는 ②에서 감소하는 것이 정상.
- **확인할 로그 라인**: ① 서버 `[dm-pubsub] fanout uid=<A> sent=1 type=read` ② 서버 `[dm-pubsub] fanout uid=<A> sent=1 type=unread` (**②에서 `type=read` 가 A 에게 가면 FAIL**) / A 콘솔 ②에서 `[Header] ws unread event {hasCount:false}`
- **PASS/FAIL**: ① ON + ② 불변 → PASS. ②에서 A 메시지가 읽음으로 바뀌면 **FAIL + 즉시 중단**(R1 발현).
- **실패 시 의심**: `dm_service.py:616`(타입), `frontend/src/pages/DmInboxPage.jsx:443~452`(onRead 핸들러).

#### RT-E2E-08. 시각 표기 — 화면 **KST 9시간 밀림 없음** `[e2e]` (G9)
- **사전조건**: 4001 공지 관리 페이지 + 4001 CS 페이지. 브라우저 타임존 = Asia/Seoul. RT-API-13 에서 확인한 `created_at` 의 UTC 원값을 메모.
- **Given** API 가 `+00:00` 오프셋을 붙여 내려준다, **When** 화면의 공지 발송 시각·CS 메시지 시각을 UTC 원값과 대조하면, **Then** 화면 표기 = UTC + 9시간(정확히 KST)이며 **18시간 차·9시간 추가 밀림이 없다**.
- **기대결과**: 최근 발송 공지의 화면 시각이 실제 발송 시점과 일치. `finished_at` 이 `null` 인 행은 빈칸/`-` 표기(‘1970-01-01’·`Invalid Date` 노출 0).
- **확인할 로그 라인**: (화면 검증 — 로그 없음). 대조 근거는 RT-API-13 의 응답 값.
- **PASS/FAIL**: 9시간 정확 + 이상 표기 0 → PASS.
- **실패 시 의심**: `frontend_admin/src/utils/format.js` `formatDate`, `notice_service.py` `_iso`.

---

### 4. 추적 매트릭스 (요구 항목 → 케이스)

| 요구 | 케이스 |
|---|---|
| ① 본인 대상 unread 이벤트 | RT-UNIT-01·02·03·04·05·06 / RT-API-01·02 / RT-E2E-01 |
| ② 공지 읽음 수 자동 갱신 | RT-UNIT-07·08·09·10 / RT-API-03 / RT-E2E-02·03 |
| ③ 사이드바 CS 뱃지 | RT-UNIT-11·12·13·14 / RT-E2E-04 |
| G1 기존 DM 송수신 | RT-API-04 / RT-E2E-05 |
| G2 받을 때 즉시 뱃지 | RT-E2E-06 |
| G3 읽음표시 동기화 + 거짓 읽음표시 금지 | RT-UNIT-15 / RT-E2E-07 |
| G4 pending no-op 프라이버시 가드 | RT-UNIT-16 / RT-API-05 |
| G5 메시지 요청함 | RT-API-06 |
| G6 CS 전체발송 검증 분기 (200 금지) | RT-API-07·08·09 |
| G7 구버전 `/api/dm/broadcast` 410 | RT-API-10 |
| G8 공지 목록/상세 계약 | RT-API-11·12 |
| G9 시각 UTC 표기 | RT-API-13 / RT-E2E-08 |
| G10 관리자 CS 폴링 유지 | RT-UNIT-17 |
| G11 공지 목록 상태 보존 | RT-UNIT-18 |
| G12 9004 미러 | RT-UNIT-19 / RT-API-16 |
| G13 개인정보 미노출 | RT-UNIT-20 / RT-API-14 |
| G14 official 계정 무해성 | RT-API-15 |

---

### 5. planner 승인이 필요한 항목 (승인 전 실행 금지 — `SKIP(승인 대기)` 로 기록)

| # | 항목 | 사유 | 승인 없이 진행 시 대안 |
|---|---|---|---|
| A1 | **RT-API-09 의 429 락 분기** — Redis 브로드캐스트 락 키 1개 수동 선점 | §0-8 쓰기 항목. 락 TTL 동안 **관리자의 정상 발송을 차단**한다 | `SKIP` + 락 획득 코드 경로 정적 리뷰로 대체 |
| A2 | **RT-API-09 의 503 분기**(official 미시드) | 재현하려면 official 계정을 변조해야 하며 **CS 전체가 마비**된다 → **재현 시도 자체를 금지** 권고 | 코드 리뷰만으로 `SKIP(재현 불가)` 확정 |
| A3 | **RT-API-04 의 지정발송 1건**(`POST /api/admin/cs/send`, 테스트 계정 1명) | 실제 DM 이 생성되는 쓰기. 테스트 계정 한정이지만 CS 대화 이력이 남는다 | 테스트 계정끼리의 일반 DM 으로 대체 가능(그 경우 승인 불필요) |
| A4 | **RT-API-16 의 9004 호출** | 9004 가 9005 와 동일 DB 를 바라보는지 미확인. 별도 DB 면 데이터 오염 우려, 프로세스 재기동이 필요하면 인프라 조작에 해당 | DB 동일성 미확인 시 `SKIP` + RT-UNIT-19(파일 diff)로만 미러 판정 |
| A5 | **RT-UNIT-08 의 `inflight` 분기 재현**(네트워크 Slow 3G 스로틀) | 브라우저 devtools 한정이라 무해하나, 관리자 앱 실사용 세션에 영향이 있으면 안 됨 | 별도 브라우저 프로필/시크릿 창에서 수행 |
| A6 | **RT-E2E-02 의 대상 공지 선정** | 기존 실공지의 **미읽음 수신자가 테스트 계정인지** 확인이 선행돼야 한다. 아니면 시나리오 자체가 성립하지 않으며, 성립시키려 발송하면 §0-2 위반 | 조건 불성립 시 `BLOCKED` 로 기록하고 planner 에 대상 공지 지정 요청 |

**승인 없이도 진행 가능**: RT-UNIT 전 20건, RT-API-01·02·03·05·06·07·08·10·11·12·13·14·15, RT-E2E-01·03·04·05·06·07·08 (= 41건). 승인 대기로 인해 부분 `SKIP` 가능한 것은 RT-API-09(전체)·RT-API-16(전체)·RT-API-04(지정발송 대체 시 무영향)·RT-E2E-02(대상 공지 선정 결과에 따름).

---

### 6. v195 시나리오 집계

| 태그 | 건수 | 비율 | 요구 | 판정 |
|---|---|---|---|---|
| `[unit]` | **20** | **45.5%** | ≥ 40% | ✅ 충족 |
| `[api]` | **16** | **36.4%** | ≥ 35% | ✅ 충족 |
| `[e2e]` | **8** | **18.2%** | ≤ 25% | ✅ 충족 |
| **합계** | **44** | 100% | — | — |

- **승인 대기로 인한 최대 제외 시나리오**(RT-API-09·16 두 건 SKIP): `[unit]` 20 / `[api]` 14 / `[e2e]` 8 = 42건 → 47.6% / 33.3% / 19.0% → **`[api]` 가 35% 미달**. 이 경우 RT-API-04 의 `before` 커서 케이스를 **역방향 커서 1건으로 분리**해 `[api]` 15건(35.7%)으로 복구한다(대체 규칙 사전 확정).
- **쓰기 총량**(승인 전 기준): 테스트 계정 간 DM 메시지 수 건 · pending 요청 2건(수락 1·거절 1) · `POST .../read` 호출 다수(멱등). **전체발송 0건** · 기존 공지 수정/삭제/재발송 0건 · 인덱스 조작 0 · 컨테이너/볼륨/포트 조작 0 · MinIO·ES 무접촉 · 실사용자 데이터 열람만.
- **즉시 중단 조건**: RT-UNIT-01 / RT-UNIT-16 / RT-API-05 / RT-E2E-07 FAIL, `POST /api/admin/cs/broadcast` 가 예기치 않게 200 반환, 공지 본문·개인정보가 응답·로그·콘솔에 노출.
- **커버리지 공백(의도적)**: 관리자 앱 WS 신설·`unread` 이벤트 count 동봉·`DmInboxPage` 의 `onUnread` 구독은 **PLAN §5 범위 밖**이므로 시나리오를 두지 않는다. 다만 RT-UNIT-15 가 "`onUnread` 구독이 추가되지 않았음"을 **역방향으로 감시**한다.

## 개정 이력 (v195)

- 2026-08-19 초판 작성 (44건) — PLAN v195 §2 실측·§3 B1~B3/F1~F8·§4 R1~R17 전 항목 시나리오화. 최대 함정인 **본인 대상 이벤트 타입 고정**(`unread` ≠ `read`)을 RT-UNIT-01(즉시 중단 조건)·RT-UNIT-15(정적 감시)·RT-E2E-07(화면 발현) **3중으로** 배치. 발송 계열은 검증 400·인가 401/403·410·429(승인 대기)로만 설계하고 **200 을 만드는 항목 0건**. 기존 실공지는 **읽기 전용 관측 대상**으로만 사용(RT-E2E-02). 태그 균형은 정적 grep·`diff` 검사와 프론트 상태 검증을 unit 으로 배치해 45.5 / 36.4 / 18.2 확보. 작성 시점에 B1~B3·F1·F4~F8 구현분이 워킹트리에 **전부 착지**하여 라인 번호·로그 문자열·가드 조건을 **실측으로 고정**함(예: 폴링 skip 3분기 `AdminNoticesPage.jsx:176~187`, 레이스 가드 `:99~104`, emit 조건 `AdminCsPage.jsx:167~172`, self publish `dm_service.py:616`). planner 승인 대기 6건(§5). planner 검토 후 확정 예정.

## v196 — 2026-08-20 — 검증 발견 결함 5건 수정

팀: MAIDOL-HardeningSquad / test-designer 작성 (**설계 산출물 — 본 문서는 실행하지 않는다. 실행은 tester 담당**)
근거: PLAN.md v196 §2 실측(①비공개 곡 유출 — playlists·likes·tracks 3파일 / ②콜백 9005 잔존 / ③답글 알림 평탄화 변수 겸용 / ④피드 삭제 알림 미정리 / ⑤DM peer `read` 무가드), §3 수정 설계, §4 변경 매트릭스, §5 회귀 위험 R1~R18, §6 범위 밖, §7 절대 준수
BASE_REV: **45c7783**(메인 체크아웃, branch `backend`) + 워킹트리 v196 구현분(**작성 완료 시점 기준 7개 대상 전부 착지** — 아래 표는 착지 후 재실측값)

**⚠️ 작업 위치**: 모든 검증은 **메인 체크아웃** `/mnt/d/1_projects/0_myProjects/1_tripleJ` 기준. 세션 워크트리
`0_platform_music/.claude/worktrees/e2e-test-search-cs-admin-1db925` 에는 **`backend_9006` 이 존재하지 않는다**(구 커밋 `c4d160e`).
워크트리 안의 `0_platform_music/` 을 열람·검증 대상으로 삼으면 **9006 이전의 낡은 파일**을 보게 된다 — 금지.

**대상 파일 (착지 후 재실측 — 라인 번호는 이후에도 이동할 수 있으므로 *심볼명이 1차 앵커*, 라인은 보조)**

> ⚠️ 본 시나리오는 구현 착지 **전**에 설계되었고, 작성 완료 직후 7개 대상이 **전부 착지**했다. 아래 표와 각 케이스의 "실패 시 의심" 라인은 **착지 후 값으로 갱신**했다.
> 단, 본문 일부 케이스에는 착지 **전** 라인이 남아 있을 수 있다 — **불일치 시 심볼명을 우선**한다.

| # | 파일 | 착지 후 실측 앵커 |
|---|---|---|
| ① | `backend_9006/app/routes/playlists.py` | ✅ 착지 — `_TRACK_PROJECTION`(`:20`), `_short`(`:31`), `_is_hidden_track`(`:36`), 화이트리스트 `_serialize_track`(`:45`), `get_playlist` 숨김 제외 + `[playlists] detail … hidden_skipped`(`:162`), `add_track` 가드 + `private_denied` 로그(`:253`) |
| ① | `backend_9006/app/routes/likes.py` | ✅ 착지 — `_TRACK_PROJECTION`(`:20`), `_is_hidden_track`(`:36`), `_serialize_track`(`:44`), `[likes] list … hidden_skipped`(`:122`), `[likes] like private_denied`(`:151`) |
| ① | `backend_9006/app/routes/tracks.py` | ✅ 착지 — `get_track_music_video`(`:770`, `get_current_user_optional` `:772`, `mv_denied` `:789`), `get_track_lyrics_timeline`(`:807`, optional auth `:809`, `lyrics_denied` `:829`), `download_track`(`:1741`, **인증 필수 `get_current_user` 유지**, `download_denied` `:1757` — Redis 집계 앞). **정답 구현 `_is_hidden_track`(`:49`)·`_can_view_hidden_track`(`:57`)·`_TRACK_NOT_FOUND`(`:67`)·`get_track_stream`(`:1705`) 무변경** |
| ② | `backend_9006/.env.example:64` | ✅ 착지 — `OAUTH_CALLBACK_BASE=http://localhost:9006`, 파일 내 9005 **0건** |
| ② | `backendAPI정리.md` | ✅ 착지 — 콜백 4줄(`:559,:565,:566,:567`) 9006, 사용자 안내 문구 신설(`:570~573`). **🔴 승인 대기였던 `:3,:6,:8,:4782→:4788` 헤더·접속표도 함께 정정됨**(§5 A2 참조) |
| ③ | `backend_9006/app/routes/feeds.py` `add_feed_comment`(`:743`) | ✅ 착지 — `reply_target_author_id` 초기화(`:762`) / **평탄화 전 캡처**(`:770`) / `[feed] comment_add reply … parent_stored … notify_to`(`:774~775`) / 알림 분기(`:797~807`, 구 `find_one` **제거됨**) |
| ④ | `backend_9006/app/routes/feeds.py` `purge_feed_document`(`:582`) | ✅ 착지 — `notifications.delete_many`(`:604`), `notifications_removed`(`:602,:607,:618`), 실패 로그 `[feed] purge notifications_cleanup_failed`(`:609`), `purge ok … notifications_removed=%d`(`:611`) |
| ⑤ | `backend_9006/app/services/dm_service.py` `mark_read`(`:571`) | ✅ 착지 — **peer 가드 `if peer_id and result.modified_count > 0:`(`:610`)**, `peer-read published`(`:614`), `peer-read skipped`(`:619`). v155 pending·v195 self `unread` 블록 무변경 |
| 참조 | `frontend/src/pages/PlaylistDetailPage.jsx:24,:106,:121~131` · `components/SongItem.jsx:58,:61,:76` · `components/MusicPlayer.jsx:48,:57~58` · `contexts/PlayerContext.jsx:135~156` | 수정 대상 아님 — **회귀 검증 대상**. 프론트 변경 0건 |

---

### 0. 전제 및 안전 규칙 (최우선 — 위반 시 해당 항목 자체를 폐기)

1. 🚫 **유료 외부 API 호출 전면 금지** — 곡 생성·MV·캐릭터·보이스 클론·번역/LLM. `/api/generate`·`/api/mv`·`/api/character`·`/api/voice-*` 는 **호출 자체를 금지**한다. 시나리오 어디에도 이 경로가 등장하지 않는다.
2. 🚫 **`POST /api/tracks/upload` 호출 금지**(내부 유료 AI 2회 강제 — gpt-4o-mini 키워드 + 임베딩). 🚫 **`GET /api/tracks/search` 남용 금지**(유료 호출 유발).
   → **테스트 트랙은 업로드 API 가 아니라 `mongo.tracks` 직접 삽입으로 준비한다**(§0-A 픽스처). 모든 삽입 문서는 `v196t` 마커 보유.
3. 🚫 **별 차감 금지.** 🚫 **`POST /api/admin/cs/broadcast` 를 어떤 항목에서도 200 으로 성립시키지 않는다.**
4. **실사용자 계정·데이터 무접촉.** 테스트 계정 `<test-user-a>`(A) / `<test-user-b>`(B) / `<test-user-c>`(C) / `<admin-email>` 만 사용. 실사용자 트랙·재생목록·피드·DM 은 **열람/집계 조회만**.
   테스트로 만든 데이터는 전량 `v196t` 마커(트랙 `title` 접두 `v196t-`, 재생목록 `title` 접두 `v196t-`, 피드 `title` 접두 `v196t-`, 댓글 본문 접두 `v196t-`) + **종료 시 삭제 후 컬렉션/테이블 카운트 대조**(§0-C).
5. **개인정보 위생**: 생년월일·성별·이메일을 응답·화면·로그·본 문서·REPORT 에 **옮겨 적지 않는다**. 크리덴셜은 전부 플레이스홀더 — `<TEST_USER_A_TOKEN>`, `<TEST_USER_B_TOKEN>`, `<TEST_USER_C_TOKEN>`, `<TEST_ADMIN_TOKEN>`, `<MONGO_URI>`, `<PG_DSN>`. 가사·프롬프트·댓글 본문 **원문 인용 금지** → 길이·건수·키 존재 여부·불리언으로만 기재.
6. **인프라 무조작**: docker-compose·포트·바인딩·MinIO·ES·Redis 설정 조작 금지. **MinIO 9100 차단 금지.** Mongo/PG **인덱스 생성·삭제 금지**.
7. 🚫 **미러링 검증 항목 없음** — 백엔드는 `backend_9006` **하나뿐**. v195 `RT-UNIT-19`(9004 `diff -q`)·`RT-API-16`(9004 런타임 동등성)은 **승계하지 않는다**. `backend_9004`·`backend_9005` 는 **읽기 전용 참고 폴더**이며 어떤 시나리오도 이 둘에 쓰지 않는다.
8. **백엔드 `[unit]` 실행 방식**: 9006 파이썬 환경에서 대상 모듈을 import 해 **순수 함수를 직접 호출**하고 `publish_to_user`/`mongo`/`push_notification` 은 **스텁**으로 대체. **프로덕션 코드를 수정·몽키패치해 가드를 끄지 않는다**(가드를 우회해 통과시키는 테스트는 그 자체가 FAIL). **임시 테스트 파일은 사용 후 삭제**(레포 커밋 금지 — `git status` 로 untracked 0건 확인).
9. **프론트 `[e2e]` 선행 절차**: 착수 전 사용자 앱(4000)·관리자 앱(4001) **하드 새로고침(Ctrl+Shift+R) + 빌드 표기 기록**. DEV 콘솔 로그(`[SongItem] openAddToPlaylist` 등)는 `import.meta.env.DEV` 가드 안이므로 **dev 서버 상태에서만** 관측 가능 — 프로덕션 빌드로 검증하면 로그 부재를 FAIL 로 오판한다.
10. **서버에 `--reload` 가 없다.** 백엔드 코드 변경 후 **수동 재기동**이 선행되지 않으면 모든 `[api]` 결과가 무효다. 각 `[api]` 블록 착수 전 §0-B 선행 절차를 반드시 수행한다.
11. 기준 URL: 백엔드 = `http://localhost:9006`, 사용자 앱 = `http://localhost:4000`, 관리자 앱 = `http://localhost:4001`.

#### 0-A. 픽스처 준비 — `mongo.tracks` 직접 삽입 (업로드 API 미사용)

> 목적: 유료 경로를 타지 않고 "전 필드가 채워진 비공개 곡"을 만들어 **유출 여부를 키 단위로 단언**할 수 있게 한다.
> 삽입은 `mongo` 셸 또는 9006 파이썬 환경의 motor 스크립트로 수행하고, 스크립트는 **사용 후 삭제**한다.

| 픽스처 | uploader_id | 핵심 필드 | 용도 |
|---|---|---|---|
| `TRK-PRIV-B` | B | `is_public: False`, `title:"v196t-priv-b"`, **`audio_url`·`lyrics`·`prompt`·`generation_id`·`user_character_snapshot`·`search_keywords`·`waveform_data`·`beats`·`downbeats`·`tempo`·`beats_status`·`recognized_timestamps`(3줄) 전부 채움** | ① 유출 차단 본체 |
| `TRK-PUB-B` | B | `is_public: True`, `title:"v196t-pub-b"`, `recognized_timestamps`(3줄), `generation_id` 없음 | R5a 공개 곡 무인증 접근 |
| `TRK-LEGACY-B` | B | **`is_public` 키 자체 없음**, `title:"v196t-legacy-b"` | 🔴 R2 레거시 회귀 |
| `TRK-PRIV-A` | A | `is_public: False`, `title:"v196t-priv-a"` | R3 본인 비공개 곡 |
| `TRK-BLIND-B` | B | `is_public: True`, **`report_blinded: True`**, `title:"v196t-blind-b"` | R4 블라인드 동시 차단 |

- `audio_url` 은 **MinIO 에 실제로 존재하지 않는 더미 오브젝트 키**(`v196t/nonexistent.mp3`)를 넣는다. presign 은 오브젝트 존재를 검증하지 않으므로 200 경로 판정에는 영향이 없고, 만에 하나 URL 이 유출돼도 **재생 가능한 실파일이 아니다**(2차 피해 차단).
- `recognized_timestamps` 는 `_filter_segments`(`app/services/share_video.py:96~126`) 통과 형태 `[{"text":"v196t line 1","start":0.0,"end":2.0}, ...]` 3줄. **가사 원문이 아닌 마커 문자열**만 사용.
- 별도 `mv_jobs` 문서는 **만들지 않는다** — MV 200 판정은 §API-08 의 **404 본문 구분**으로 대체한다(아래 R5a 설계 노트).

#### 0-B. 각 `[api]` 블록 선행 절차 (`--reload` 부재 대응 — 생략 시 전 결과 무효)

1. `cd /mnt/d/1_projects/0_myProjects/1_tripleJ && git status --short` → 대상 파일 착지 확인.
2. 서버 재기동: `cd /mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music/backend_9006 && setsid ./run.sh > /dev/null 2>&1 &`
3. 재기동 확인: `GET http://localhost:9006/health`(또는 `/docs`) 200 + **서버 로그의 startup 타임스탬프가 재기동 이후**인지 확인.
4. 스모크: `GET /api/playlists/` 200(`<TEST_USER_A_TOKEN>`).
5. **위 4단계 기록 없이 판정된 `[api]` 케이스는 무효로 간주하고 재실행한다.**

#### 0-C. 종료 시 정리 및 카운트 대조 (필수)

착수 **전** / 종료 **후** 두 시점에 아래를 집계해 **차이 0** 을 확인한다. 차이가 남으면 잔여 데이터를 지목해 삭제하고 재대조한다.

| 대상 | 집계 쿼리 |
|---|---|
| `mongo.tracks` | 전체 `count_documents({})` + `count_documents({"title": {"$regex": "^v196t-"}})` |
| `mongo.feeds` | 전체 + `{"title": {"$regex": "^v196t-"}}` |
| `mongo.feed_comments` | 전체 + `{"text": {"$regex": "^v196t-"}}` |
| `mongo.notifications` | 전체 + 타입별 5종 각각 |
| `mongo.dm_conversations` / `dm_messages` | 전체 |
| PG `playlists` / `playlist_tracks` / `likes` / `feed_likes` | `SELECT count(*)` |
| Redis | `chart:downloads:*`·`chart:dl_tracks:*` 중 `v196t` 트랙 id 를 포함한 키 목록 (§API-05 전용) |

---

### 0-D. ⚠️ v195 테스트 2건 supersede (필수 — 승계하지 않으면 정상 동작을 FAIL 판정한다)

v196 ⑤ 가 바꾸는 동작을 v195 케이스가 명시적으로 못박고 있다. **아래 2건은 v196 에서 폐기**하고, 신규 번호의 대체 케이스로 대신한다.
**v195 문단(TESTPLAN 상단)은 이력 보존 — 수정 금지.**

| v195 케이스 | v195 기대 (폐기) | v196 대체 | v196 기대 |
|---|---|---|---|
| **RT-UNIT-03** | "peer `read` 발행 **유지** + 순서 peer→self … peer 발행 누락/변형 → FAIL" | **V196-UNIT-15** | `modified_count > 0` 일 때만 peer 발행. 순서 peer→self 는 그대로 유지 |
| **RT-UNIT-04** | "`prev_unread==0 && modified_count==0` → `publish_to_user` 는 **peer 1회만**(read) 호출" | **V196-UNIT-14** | 같은 조건에서 **peer 호출도 0회**가 정상. peer 발행이 있으면 FAIL |

> v195 `RT-UNIT-05`(`prev_unread>0 && modified_count==0` → **본인** 발행 필수)는 **폐기하지 않는다**. 그 경계에서 **본인 `unread` 는 계속 발행**되고 **peer `read` 만 사라지는** 것이 v196 의 정확한 동작이며, 이 구분을 **V196-UNIT-16** 이 단독으로 감시한다(R13).
> v195 `RT-UNIT-19`·`RT-API-16`(9004 미러) 2건도 **승계하지 않는다** — 백엔드는 `backend_9006` 하나뿐(§0-7).

---

### 0-E. 🛑 즉시 중단 조건 (하나라도 발생 → 이후 항목 진행 금지, planner 즉시 보고)

| # | 조건 | 감시 케이스 |
|---|---|---|
| S1 | **비공개 곡의 금지 필드가 하나라도 응답에 남음** (`audio_url`·`lyrics`·`prompt`·`generation_id`·`user_character_snapshot`·`search_keywords`·`waveform_data`·`beats*` 중 1개라도) | V196-UNIT-05·06, V196-API-03·04 |
| S2 | **레거시 문서(`is_public` 키 부재)가 차단됨** (R2) — 추가 400 또는 목록에서 사라짐 | V196-UNIT-01, V196-API-09 |
| S3 | **저장된 `parent_id` 가 평탄화 값이 아님** (R6 — v191 트리 계약 파손) | V196-UNIT-11, V196-API-10 |
| S4 | **무관한 알림이 삭제됨** (R9) — 다른 피드의 알림 또는 `follow` 알림 건수 감소 | V196-API-14 |
| S5 | **공개 곡 비로그인 접근이 401/404 로 파손** (R5a) | V196-API-08 |
| S6 | **유료 API 가 1회라도 호출됨** — `/api/generate`·`/api/mv`·`/api/character`·`/api/voice-*`·`/api/tracks/upload`·`/api/tracks/search` 접근 로그 발견 | 전 항목 (서버 로그 상시 감시) |
| S7 | `POST /api/admin/cs/broadcast` 가 예기치 않게 200 반환 | 전 항목 |
| S8 | 개인정보(생년월일·성별·이메일)·가사/프롬프트/댓글 원문이 응답·로그·콘솔에 노출 | V196-UNIT-21 |

---

### 1. `[unit]` 시나리오 — 21건

> 실행: 9006 파이썬 환경에서 대상 모듈 import → 순수 함수 직접 호출(DB 불필요, 목킹). 정적 항목은 `grep`/`git diff`. **프로덕션 코드 무수정.**

#### V196-UNIT-01. `_is_hidden_track` — `is_public` **키 부재** → **공개 판정** `[unit]` — 🔴 핵심 / 즉시 중단 조건 S2 (①, R2)
- **사전조건**: `from app.routes.playlists import _is_hidden_track` (9006 파이썬 환경).
- **Given** `is_public` 키가 **아예 없는** 레거시 문서 `{"_id": <oid>, "title": "v196t-legacy-b", "uploader_id": "<B>"}`, **When** `_is_hidden_track(doc)` 를 호출하면, **Then** 반환값이 **`False`**(= 공개 취급)이다.
- **기대결과**: `False`. 구현이 `not doc.get("is_public")`(feeds 식)이면 `True` 가 되어 **레거시 공개곡이 전량 숨겨지고 추가도 400** 이 된다.
- **확인할 로그 라인**: 없음(순수 함수). 대신 정적으로 함수 본문이 `(t.get("is_public") is False) or bool(t.get("report_blinded"))` 형태인지 확인 — `not t.get("is_public")` 이 등장하면 **즉시 FAIL**.
- **PASS/FAIL**: `False` + 본문이 `is` 비교 → PASS. `True` 또는 `not` 식 사용 → **FAIL + 즉시 중단(S2)**.
- **실패 시 의심**: `backend_9006/app/routes/playlists.py:36` (`_is_hidden_track` 본문), 참조 규약 `backend_9006/app/routes/tracks.py:49`.

#### V196-UNIT-02. `_is_hidden_track` 진리표 3분기 `[unit]` (①, R4)
- **사전조건**: V196-UNIT-01 과 동일 import.
- **Given/When/Then** 아래 표대로 각각 호출한다.
  | 입력 | 기대 |
  |---|---|
  | `{"is_public": False}` | `True` (숨김) |
  | `{"is_public": True, "report_blinded": True}` | `True` (숨김 — R4 의도된 확장) |
  | `{"is_public": True}` | `False` (공개) |
  | `{"is_public": True, "report_blinded": False}` | `False` |
  | `{"report_blinded": True}` (is_public 키 없음) | `True` |
- **기대결과**: 5행 전부 일치. `report_blinded` 가 truthy 이면 `is_public:True` 여도 숨김.
- **확인할 로그 라인**: 없음.
- **PASS/FAIL**: 5행 전부 일치 → PASS. 1행이라도 불일치 → FAIL.
- **실패 시 의심**: `playlists.py:36`.

#### V196-UNIT-03. `likes._is_hidden_track` 이 `playlists` 와 **동일 규약** `[unit]` (①, R2)
- **사전조건**: `from app.routes.likes import _is_hidden_track as likes_hidden` / `from app.routes.playlists import _is_hidden_track as pl_hidden`.
- **Given** V196-UNIT-01·02 의 전체 입력 집합(6종), **When** 두 함수에 같은 입력을 주면, **Then** 모든 입력에서 반환값이 **동일**하다.
- **기대결과**: 6/6 일치. 특히 레거시 문서에서 양쪽 모두 `False`.
- **확인할 로그 라인**: 없음. 정적 보조 — `grep -n "not doc.get(\"is_public\")\|not t.get(\"is_public\")" backend_9006/app/routes/likes.py` → **0건**.
- **PASS/FAIL**: 전 입력 동치 → PASS. 한쪽만 feeds 식이면 → **FAIL + 즉시 중단(S2)**.
- **실패 시 의심**: `backend_9006/app/routes/likes.py:36`(`_is_hidden_track`), `:44`(`_serialize_track`).

#### V196-UNIT-04. 소유자 예외 — `uploader_id == 요청자` 면 숨김이어도 **항상 통과** `[unit]` (①, R3)
- **사전조건**: `get_playlist` / `list_likes` 내부 판정식을 그대로 재현한 헬퍼를 호출하거나, 해당 라인의 조건식을 정적으로 대조.
- **Given** `doc = {"is_public": False, "report_blinded": True, "uploader_id": "<A>"}`, `viewer_id = "<A>"`, **When** 결합 조건 `_is_hidden_track(doc) and doc.get("uploader_id") != viewer_id` 를 평가하면, **Then** **`False`**(= 제외하지 않음)이다. `viewer_id = "<B>"` 이면 **`True`**(= 제외).
- **기대결과**: 소유자 본인 → 노출 유지. 타인 → 제외. **가드가 `uploader_id` 비교 없이 `_is_hidden_track` 단독**이면 본인 비공개 곡이 본인 목록에서 사라진다(R3 파손).
- **확인할 로그 라인**: 없음. 정적 — `playlists.py:154` 가 `if _is_hidden_track(doc) and doc.get("uploader_id") != viewer_id:` 형태인지, `likes.py` 의 대응 라인도 동일한지 확인.
- **PASS/FAIL**: 두 방향 모두 기대치 일치 → PASS.
- **실패 시 의심**: `playlists.py` `get_playlist` 제외 루프, `likes.py` `list_likes` 제외 루프.

#### V196-UNIT-05. `playlists._serialize_track` 가 **정확히 지정된 키 집합만** 반환 `[unit]` — 즉시 중단 조건 S1 (①)
- **사전조건**: `from app.routes.playlists import _serialize_track`. 입력은 §0-A `TRK-PRIV-B` 와 동일 형태의 **전 필드 dict**(`_id` 포함).
- **Given** 전 필드가 채워진 트랙 문서, **When** `_serialize_track(doc)` 를 호출하면, **Then** 반환 dict 의 키 집합이 **정확히**
  `{"id","title","artist_id","artist_name","cover_image","uploader_id","uploader_nickname","cover_image_url","duration_sec","is_public"}` (10키)이다.
- **기대결과**: `set(result.keys()) == 위 10키`. 그리고 **금지 키 8종이 하나도 없다**:
  `audio_url`, `lyrics`, `prompt`, `generation_id`, `user_character_snapshot`, `search_keywords`, `waveform_data`, `beats`(+`downbeats`·`tempo`·`beats_status`·`beats_*`).
  추가로 `report_blinded`·`recognized_timestamps`·`created_at`·`updated_at`·`play_count`·`like_count`·`ai_model`·`language`·`genre`·`mood`·`tags`·`categories`·`bpm`·`key` **부재**.
  값 매핑: `artist_id == doc["uploader_id"]`, `cover_image == doc["cover_image_url"]`, 원본 키 `uploader_id`/`uploader_nickname`/`cover_image_url` **병행 존재**(R1 폴백 무손상).
  **입력 dict 가 변형되지 않는다**(구 구현의 `doc.pop("_id")` 부작용 제거 확인 — 호출 후 `"_id" in doc` 이 여전히 참).
- **확인할 로그 라인**: 없음(순수 함수).
- **PASS/FAIL**: 키 집합 정확 일치 + 금지 키 0 + 입력 무변형 → PASS. 금지 키 1개라도 존재 → **FAIL + 즉시 중단(S1)**. 키가 부족(예: `uploader_nickname` 누락) → FAIL(R1).
- **실패 시 의심**: `backend_9006/app/routes/playlists.py:45`.

#### V196-UNIT-06. `likes._serialize_track` 화이트리스트 + `liked_at` 주입 후 11키 `[unit]` — 즉시 중단 조건 S1 (①)
- **사전조건**: `from app.routes.likes import _serialize_track`.
- **Given** V196-UNIT-05 와 동일 입력, **When** `_serialize_track(doc)` 후 호출부가 `t["liked_at"] = ...` 를 주입하면, **Then** 최종 키 집합이 **정확히 11키**(UNIT-05 의 10키 + `liked_at`)이다.
- **기대결과**: 금지 키 8종 부재. `position` **부재**(playlists 전용 키가 likes 응답에 섞이면 FAIL). 값 매핑은 UNIT-05 와 동일.
- **확인할 로그 라인**: 없음.
- **PASS/FAIL**: 11키 정확 일치 + 금지 키 0 → PASS. 그 외 → **FAIL + 즉시 중단(S1)**.
- **실패 시 의심**: `backend_9006/app/routes/likes.py:44`, `list_likes` `:122` 주변.

#### V196-UNIT-07. `_TRACK_PROJECTION` — 조회 필드 최소화 + `report_blinded` **응답 미포함** `[unit]` (①)
- **사전조건**: `from app.routes.playlists import _TRACK_PROJECTION` (및 likes 측 동명 상수).
- **Given** 두 모듈의 상수, **When** 키 집합을 조사하면, **Then** 정확히
  `{"title","uploader_id","uploader_nickname","cover_image_url","duration_sec","is_public","report_blinded"}` (7키)이며 값은 전부 `1`이다.
- **기대결과**: `audio_url`·`lyrics`·`prompt`·`generation_id` 등이 프로젝션에 **없다**(전송량·메모리 + 심층 방어). `report_blinded` 는 **조회는 하되 `_serialize_track` 반환에는 없다**(V196-UNIT-05 와 교차 확인 — 가드 판정 전용).
- **확인할 로그 라인**: 없음. 정적 보조 — `grep -n "find(" backend_9006/app/routes/playlists.py backend_9006/app/routes/likes.py` 결과의 `mongo.tracks.find(...)` 호출이 **전부 2번째 인자로 `_TRACK_PROJECTION` 을 넘기는지** 확인(프로젝션 없는 `find` 잔존 0건).
- **PASS/FAIL**: 7키 일치 + 전 호출부 프로젝션 적용 → PASS.
- **실패 시 의심**: `playlists.py:20`·`get_playlist` 조회부; `likes.py:20`·`list_likes` 조회부.

#### V196-UNIT-08. 레거시·결측 문서 직렬화 기본값 `[unit]` (①, R1/R2)
- **사전조건**: V196-UNIT-05 와 동일 import.
- **Given** `{"_id": <oid>, "title": "v196t-legacy-b", "uploader_id": "<B>"}` (닉네임·커버·`is_public`·`duration_sec` 전부 결측), **When** `_serialize_track(doc)`, **Then**
  `artist_name == "AI"`(기본값), `cover_image is None`, `cover_image_url is None`, `duration_sec is None`, `is_public is False`(직렬화 기본값), `id == str(_id)`.
- **기대결과**: 예외 없이 10키 반환. **`artist_name` 이 `None` 이면 FAIL** — `MusicPlayer.jsx:58`·`PlayerPage.jsx:365,:592` 는 폴백이 없어 화면이 공백이 된다(선재 버그 해소 요건).
- **주의**: `is_public` 이 직렬화에서 `False` 로 나오는 것은 **표시용 기본값**일 뿐이며, **가시성 판정은 `_is_hidden_track`(V196-UNIT-01)이 담당**한다. 두 값이 다른 것은 정상 — 여기서 `is_public:False` 를 보고 "숨김이어야 한다"고 판단하면 오판이다.
- **확인할 로그 라인**: 없음.
- **PASS/FAIL**: 6개 단언 전부 일치 → PASS.
- **실패 시 의심**: `playlists.py:45~64`(`doc.get("uploader_nickname", "AI")` 의 기본값 처리 — 키가 존재하고 값이 `None` 이면 `.get` 기본값이 먹지 않는 점 주의).

#### V196-UNIT-09. ② `.env.example` 콜백 베이스 정적 grep `[unit]` (②, R16)
- **사전조건**: 메인 체크아웃 기준 경로 `0_platform_music/backend_9006/.env.example`.
- **Given/When/Then**:
  | 검사 | 명령 | 기대 |
  |---|---|---|
  | 9005 잔존 | `grep -n "9005" backend_9006/.env.example` | **0건** |
  | 9006 존재 | `grep -n "OAUTH_CALLBACK_BASE=http://localhost:9006" backend_9006/.env.example` | **1건** (`:64`) |
  | 프론트 URL 불변 | `grep -n "FRONTEND_URL" backend_9006/.env.example` | `https://localhost:4000` 유지 (`:65`) |
  | 실값 무접촉 | `cd /mnt/d/.../1_tripleJ && git status --short -- 0_platform_music/backend_9006/.env` | **출력 0줄** (`.env` 는 gitignore 대상일 수 있으므로 파일 `mtime` 도 착수 전 값과 대조) |
- **기대결과**: 4행 전부 일치. `.env`(실값)는 **읽지도 쓰지도 않는다** — 포트 확인이 필요하면 `grep -c "9006" .env` 처럼 **값을 출력하지 않는 형태**로만.
- **확인할 로그 라인**: 없음(정적).
- **PASS/FAIL**: 4행 일치 → PASS. `.env` 가 변경됐으면 → FAIL(R16).
- **실패 시 의심**: `backend_9006/.env.example:64~65`.

#### V196-UNIT-10. ② `backendAPI정리.md` 콜백 4줄 정정 + **이력 보존** 정적 grep `[unit]` (②, R17)
- **사전조건**: 착수 **전** `grep -c "9005" 0_platform_music/backendAPI정리.md` 기준값 **22** 를 기록.
- **Given/When/Then**:
  | 검사 | 기대 |
  |---|---|
  | 콜백 4줄 | `sed -n '559p;565p;566p;567p' backendAPI정리.md` → **9005 0건 / 9006 4건** |
  | 안내 문구 추가 | 해당 절에 "각 제공자 개발자 콘솔의 Redirect URI 등록 변경은 **사용자가 직접** 수행해야 한다"는 취지의 문장이 **1건 이상** 존재 |
  | 총량 대조 | `grep -c "9005" backendAPI정리.md` → **18** (착지 후 실측 확인값. **18 미만이면 이력 마커까지 손댄 것 → FAIL**) |
  | 범위 밖 보존 | 버전 마커(`v77, 9005`) 5곳 · 검증 이력 제목(`9005 기준 전면 검증 (2026-08-03)`) 및 그 본문 · 과거 스크립트 경로(`backend_9005/scripts/backfill_snapshot_sheets.py`) · 로그 경로 3곳(`backend_9005/logs/…`, `server_9005.log`) · Suno 콜백 설명 1곳 에 **9005 잔존** |
  | 🔴 승인 대기 라인 | `:3,:6,:8,:4788` — **착지 시점 실측 결과 이 4곳이 이미 9006 으로 정정되었다**(§5 A2 는 "미승인 시 미변경"을 기대했으나 실제로는 변경됨). tester 는 **FAIL 로 판정하지 말고 `OBSERVED` 로 기록**하고 planner 에 사후 승인 여부를 확인한다. 정정 내용 자체는 사실 관계상 옳다(9006 단일 백엔드) |
  | 과거 산출물 불변 | `git diff --stat -- claude_skills_outputs/team-dev/REPORT.md` → **출력 0줄**, `sed -n '13014p' REPORT.md` 내용이 착수 전과 동일 |
- **기대결과**: 6행 중 5행 일치 + 3행째(승인 대기)는 `OBSERVED` 기록.
- **확인할 로그 라인**: 없음(정적).
- **PASS/FAIL**: 콜백 4줄·안내 문구·총량 18·범위 밖 보존·REPORT 불변 → PASS. 총량이 18 미만 → **FAIL(R17 이력 훼손)**. REPORT.md 가 변경됐으면 → **FAIL(R17)**.
- **실패 시 의심**: `0_platform_music/backendAPI정리.md:559,565,566,567,570~573` / 승인 범위 이슈는 `:3,:6,:8,:4788`.

#### V196-UNIT-11. ③ 저장되는 `parent_id` 가 **평탄화 값(최상위 댓글 id)** 유지 `[unit]` — 🔴 즉시 중단 조건 S3 (③, R6 — v191 계약)
- **사전조건**: `feeds.add_feed_comment` 를 호출하되 `mongo` 를 **인메모리 더블**로 목킹 — `feed_comments.find_one` 은 요청 id 에 따라 ①최상위 댓글 `CA = {_id:<ca>, feed_id:<f>, author_id:<A>, parent_id:None}` ②1단 답글 `CB = {_id:<cb>, feed_id:<f>, author_id:<B>, parent_id:<ca>}` 를 반환. `feeds.find_one` 은 `{_id:<f>, author_id:<C>}`. `push_notification` 은 호출 인자 기록 스텁. `insert_one` 은 삽입 문서를 그대로 보존.
- **Given** C 의 피드에 A 최상위(`CA`) → B 답글(`CB`) 이 있는 상태, **When** C 가 `parent_id=<cb>`(= B 의 1단 답글)로 댓글을 추가하면, **Then** `feed_comments.insert_one` 에 전달된 문서의 **`parent_id == <ca>`**(= 최상위 A 댓글 id)이다.
- **기대결과**: 저장 `parent_id` 는 **평탄화 값 그대로**. `<cb>` 로 저장되면 v191 트리 계약(2단 이상 1단 평탄화)이 파손된다.
- **확인할 로그 라인**: `[feed] comment_add reply feed=%s parent_stored=%s notify_to=%s` — `parent_stored` 가 `<ca>[:8]`, `notify_to` 가 `<B>[:8]` 여야 한다(둘 다 8자).
- **PASS/FAIL**: 저장값이 `<ca>` → PASS. `<cb>` 또는 `None` → **FAIL + 즉시 중단(S3)**.
- **실패 시 의심**: `backend_9006/app/routes/feeds.py:770`(평탄화 전 캡처)·`:771~772`(평탄화)·문서 조립부(`"parent_id": parent_id`), 신설 `reply_target_author_id` 가 실수로 `parent_id` 변수를 덮어썼는지.

#### V196-UNIT-12. ③ 자기 답글 → self-skip 으로 `reply` 알림 **0건** `[unit]` (③)
- **사전조건**: V196-UNIT-11 과 동일 목킹. **단 `push_notification` 은 스텁이 아니라 실제 함수**를 쓰고, `mongo.notifications.insert_one` 만 기록 스텁(= self-skip 가드가 실제로 동작하는 경로를 타야 함).
- **Given** B 가 작성한 댓글 `CB` 에 **B 본인이** 답글을 달면, **When** `add_feed_comment` 호출, **Then** `ntype="reply"` 인 `notifications.insert_one` 호출이 **0건**이다.
- **기대결과**: `reply` 삽입 0건. (피드 주인 C 에게 가는 `comment` 알림은 **1건 발행되는 것이 정상** — 그건 자기 자신이 아니다.)
- **확인할 로그 라인**: `[notify] push ok type=comment to=%s actor=%s` 1건 / `type=reply` 라인 **0건**.
- **PASS/FAIL**: reply 0건 + comment 1건 → PASS. reply 가 발행되면 FAIL(자기 알림).
- **실패 시 의심**: `backend_9006/app/routes/notifications.py:35`(`if not user_id or str(user_id) == str(actor_id): return`), `feeds.py:773~780`(가드를 우회하는 직접 insert 를 새로 넣었는지).

#### V196-UNIT-13. ③ 알림 대상 산정이 **평탄화 전 `parent`** 를 쓰고, `find_one` 이 제거됨 `[unit]` — 정적 (③, R6)
- **사전조건**: `backend_9006/app/routes/feeds.py` 정적 열람.
- **Given/When/Then** `add_feed_comment` 본문에 대해:
  | 검사 | 기대 |
  |---|---|
  | 캡처 순서 | `reply_target_author_id = parent.get("author_id")` 가 **`if parent.get("parent_id"): parent_id = parent["parent_id"]` 보다 앞 줄**에 있다 |
  | 왕복 제거 | 알림 블록(구 `:773~780`)에 `feed_comments.find_one` 이 **없다**. `grep -c "feed_comments.find_one" ` 결과가 **1**(부모 검증용 `:749` 1곳만) |
  | 비교 대상 | `if reply_target_author_id and str(reply_target_author_id) != str(doc.get("author_id")):` — 비교 우변이 **피드 주인**(`doc["author_id"]`) 그대로 유지(R8 의도 보존) |
  | 알림 인자 | `push_notification(..., user_id=reply_target_author_id, ntype="reply", target_id=feed_id, ...)` — **`target_id` 는 `feed_id` 유지**(계약 불변) |
- **기대결과**: 4행 전부 일치.
- **확인할 로그 라인**: 없음(정적). 보조로 `[feed] comment_add reply ... notify_to=` 라인이 신설됐는지 확인.
- **PASS/FAIL**: 4행 일치 → PASS. 캡처가 평탄화 **뒤**면 → **FAIL + 즉시 중단(S3 인접 — 결함 미수정)**. `target_id` 가 댓글 id 로 바뀌었으면 FAIL(앱팀 라우팅 계약 파손).
- **실패 시 의심**: `backend_9006/app/routes/feeds.py:757~807`.

#### V196-UNIT-14. ⑤ `modified_count == 0` → **peer 발행 0회** `[unit]` — **v195 RT-UNIT-04 supersede** (⑤, R12)
- **사전조건**: `dm_service.publish_to_user` 를 호출 인자·순서 기록 스텁으로 교체. `_get_conv` 가 `{_id:<cid>, participants:[me,peer], status:"accepted", unread:{me:0}}` 반환. `dm_messages.update_many` 가 **`modified_count=0`** 반환.
- **Given** 이미 다 읽은 accepted 대화, **When** `await mark_read(mongo, <cid>, me)`, **Then** `publish_to_user` 호출 기록에 **`uid == peer` 인 건이 0회**이고, `uid == me` 인 건도 0회(v195 RT-UNIT-04 의 본인 skip 은 유지)이다. **총 호출 0회.**
- **기대결과**: 반환값은 정상 `{"conversation_id": <cid>, "read": True, "marked": 0}` (**스키마 불변**).
  ⚠️ **v195 RT-UNIT-04 는 여기서 "peer 1회" 를 기대했다 — v196 에서는 그 기대가 폐기된다.** peer 발행이 1회라도 있으면 **FAIL**.
- **확인할 로그 라인**: `[dm] mark_read peer-read skipped (nothing marked) conv=%s me=%s` (**published 라인이 나오면 FAIL**) + `[dm] mark_read self-unread skipped (nothing to clear) conv=%s me=%s` + `[dm] mark_read conv=%s me=%s marked=0`
- **PASS/FAIL**: 총 발행 0회 + skipped 로그 2줄 + 반환 스키마 3키 → PASS.
- **실패 시 의심**: `backend_9006/app/services/dm_service.py:610`(`if peer_id and result.modified_count > 0:` — 착지 확인됨).

#### V196-UNIT-15. ⑤ `modified_count > 0` → **peer `read` 1회** + 순서 peer → self `[unit]` — **v195 RT-UNIT-03 supersede** (⑤, R12)
- **사전조건**: V196-UNIT-14 목킹에서 `unread:{me:3}`, `update_many` 가 **`modified_count=2`** 반환. 스텁이 **호출 순서를 리스트로 보존**.
- **Given** 실제로 읽을 메시지가 있는 대화, **When** `mark_read` 호출, **Then** 호출 기록이 정확히
  `[(peer, {"type":"read","conversation_id":<cid>}), (me, {"type":"unread","conversation_id":<cid>})]` 2건이다.
- **기대결과**: peer 이벤트 키 집합이 **정확히 `{"type","conversation_id"}`**(v194 이전 페이로드 불변). 순서 **peer → self** 유지. 반환 `{"conversation_id","read":True,"marked":2}`.
  ⚠️ v195 RT-UNIT-03 의 "peer 발행 무조건 유지" 는 폐기되고, **조건부 유지**로 대체된다. 이 케이스가 "읽을 게 있을 때는 반드시 간다"를 보장한다(R12).
- **확인할 로그 라인**: `[dm] mark_read peer-read published conv=%s me=%s marked=2` → `[dm] mark_read self-unread published conv=%s me=%s prev_unread=3 marked=2`
- **PASS/FAIL**: 2건·순서·타입·키집합 전부 일치 → PASS. peer 누락 → **FAIL(읽음표시 동기화 회귀 — R12)**. 순서가 self→peer 로 바뀌면 FAIL.
- **실패 시 의심**: `dm_service.py:610`(가드 조건), 이어지는 self 블록 위치.

#### V196-UNIT-16. ⑤ 🔴 `prev_unread > 0 && modified_count == 0` → **peer 미발행 + 본인 발행** `[unit]` — 핵심 경계 (⑤, R13)
- **사전조건**: `unread:{me:1}` (카운터만 남음), `update_many` 가 **`modified_count=0`** 반환. 스텁 순서 보존.
- **Given** 메시지는 이미 전부 read 인데 **내 뱃지 카운터만 1 남은** 경계(= v195 RT-UNIT-05 와 동일 입력), **When** `mark_read` 호출, **Then**
  ① `uid == peer` 발행 **0회** (v196 신규 가드)
  ② `uid == me` 로 `{"type":"unread", ...}` 발행 **1회** (v195 RT-UNIT-05 불변 — 폐기하지 않음)
- **기대결과**: 총 발행 1회, 대상은 **본인만**. 이 케이스가 **v195 RT-UNIT-05 경계와 v196 ⑤ 를 구분하는 유일한 지점**이다.
  - peer 조건에 `prev_unread` 를 섞으면(`if peer_id and (prev_unread > 0 or result.modified_count > 0)`) 여기서 peer 가 발행돼 **FAIL**.
  - 반대로 본인 가드까지 `modified_count` 단독으로 바꾸면 본인 발행이 사라져 **FAIL**(뱃지가 안 줄어드는 v195 원증상 재발).
- **확인할 로그 라인**: `[dm] mark_read peer-read skipped (nothing marked) conv=%s me=%s` **그리고** `[dm] mark_read self-unread published conv=%s me=%s prev_unread=1 marked=0` — **두 줄이 동시에** 나와야 한다.
- **PASS/FAIL**: peer 0 + self 1 + 로그 2줄 동시 → PASS. 하나라도 어긋나면 FAIL(R13).
- **실패 시 의심**: `dm_service.py:610`(peer 가드에 `prev_unread` 혼입 여부), 본인 가드가 `or` 에서 바뀌었는지, `prev_unread` 캡처가 `unread=0` 업데이트 뒤로 밀렸는지.

#### V196-UNIT-17. ⑤ pending no-op → peer·본인 **양쪽 미발행** (v155 가드 불변) `[unit]` (⑤, R2 계열)
- **사전조건**: `_get_conv` 가 `{_id:<cid>, participants:[me,peer], status:"pending", requester_id:<peer>, unread:{me:2}}` 반환(= 내가 **수신자**). 스텁 기록.
- **Given** 요청함(pending) 대화를 **수신자**가 여는 상황, **When** `mark_read` 호출, **Then**
  ① `publish_to_user` 호출 **0회**(peer·본인 모두)
  ② `dm_conversations.update_one`·`dm_messages.update_many` **미호출**(unread 보존)
  ③ 반환값이 **정확히 `{"conversation_id": <cid>, "read": False, "marked": 0}`**
- **기대결과**: v155 프라이버시 계약 완전 불변. v196 의 peer 가드가 이 조기 반환보다 **앞으로 이동하면 안 된다**.
- **확인할 로그 라인**: `[dm] mark_read skipped (pending request) conv=%s me=%s` 1줄. `peer-read published`·`peer-read skipped`·`self-unread` 라인 **전부 미출력**(신설 skipped 로그가 pending 경로에서도 나오면 조기 반환이 깨진 것 → FAIL).
- **PASS/FAIL**: 3개 단언 + 로그 1줄 단독 → PASS.
- **실패 시 의심**: `dm_service.py` pending 조기 반환 블록, v196 신설 `peer-read skipped` 로그(`:619`)가 이 위로 올라갔는지.

#### V196-UNIT-18. ④ `purge_feed_document` — Mongo 예외 주입에도 **삭제 성공 유지** `[unit]` (④, R10)
- **사전조건**: `feeds.purge_feed_document` 를 목킹 mongo/conn 으로 직접 호출. `mongo.notifications.delete_many` 가 **`Exception("v196t injected")`** 을 던지도록 설정. `feeds.delete_one`·`feed_comments.delete_many`(→ `deleted_count=2`)·`conn.execute` 는 정상.
- **Given** 알림 정리만 실패하는 상황, **When** `await purge_feed_document(mongo, conn, doc)`, **Then**
  ① 예외가 **호출자에게 전파되지 않는다**
  ② 반환 dict 에 `feed_id`·`owner_id`·`comments_removed`(=2) 가 **그대로** 있다(기존 계약 불변)
  ③ `feeds.delete_one`·`feed_comments.delete_many`·PG `DELETE FROM feed_likes` 는 **정상 호출**됐다
- **기대결과**: best-effort 패턴 준수(PG `feed_likes` 정리 `:593~596` 와 동일). `notifications_removed` 키가 추가되었다면 **실패 시 `0`**(또는 미포함) — 어느 쪽이든 라우트 응답은 `{"message":"피드가 삭제되었습니다."}` 로 고정이므로 외부 계약 불변.
- **확인할 로그 라인**: `[feed] purge notifications_cleanup_failed feed=%s err=%s` (err 에 **본문·닉네임 원문이 섞이지 않는지** 동시 확인) + `[feed] purge ok feed=%s author=%s comments_removed=2 notifications_removed=0`
- **PASS/FAIL**: 예외 미전파 + 반환 계약 유지 + 3개 삭제 호출 → PASS. 예외가 새면 → **FAIL(R10 — 알림 정리 실패가 피드 삭제를 깨뜨림)**.
- **실패 시 의심**: `backend_9006/app/routes/feeds.py:602~612`(신설 `try/except` 범위가 `feeds.delete_one`·`feed_comments.delete_many` 까지 감싸버렸는지).

#### V196-UNIT-19. ④ 알림 삭제 필터 정적 검증 — `type` 화이트리스트에 **`follow` 미포함** `[unit]` — 정적, S4 정적 방어 (④, R9)
- **사전조건**: `feeds.py` 정적 열람 + V196-UNIT-18 목킹의 `delete_many` **호출 인자 캡처**.
- **Given/When/Then**:
  | 검사 | 기대 |
  |---|---|
  | 필터 형태 | 캡처된 인자가 `{"target_id": <feed_id>, "type": {"$in": [...]}}` |
  | 화이트리스트 | `$in` 리스트가 정확히 `{"feed","like","comment","reply"}` (순서 무관, 집합 동일) |
  | `follow` 배제 | `"follow" not in $in` — **`follow` 은 `target_id=None` 이라 충돌 불가하지만 이중 방어** |
  | `target_id` 타입 | `str(feed_id)` — `ObjectId` 를 그대로 넘기면 `push_notification:45` 가 `str()` 로 저장하므로 **매칭 0건**이 되어 조용히 무효화된다 |
  | 전역 안전 | `grep -rn "notifications.delete" backend_9006/app/` → **1건(이 호출)만** 존재. 무조건 삭제(`delete_many({})`·`delete_many({"user_id":...})`) 형태 **0건** |
- **기대결과**: 5행 전부 일치.
- **확인할 로그 라인**: `[feed] purge ok ... notifications_removed=%d`
- **PASS/FAIL**: 5행 일치 → PASS. `follow` 포함 또는 `type` 필터 부재 → **FAIL + 즉시 중단(S4)**. `target_id` 가 `ObjectId` → FAIL(정리가 조용히 무효).
- **실패 시 의심**: `feeds.py:582~605`.

#### V196-UNIT-20. v138 직링크 가드 블록 **무변경** 정적 확인 `[unit]` — 회귀 (§6-7 무접촉)
- **사전조건**: `git diff -- 0_platform_music/backend_9006/app/routes/tracks.py` (메인 체크아웃).
- **Given/When/Then**:
  | 검사 | 기대 |
  |---|---|
  | `_is_hidden_track`(`:49~54`) | diff **없음** — 규약 원본은 손대지 않는다 |
  | `_can_view_hidden_track`(`:57~64`) | diff **없음** |
  | `_TRACK_NOT_FOUND`(`:67`) | diff **없음** |
  | `get_track_stream`(`:1682~1714`) | diff **없음** (정답 구현 — 복사 대상이지 수정 대상이 아님) |
  | `/stream-proxy/{id}`(`:906~`) · `/{track_id}`(`:1151~`) | diff **없음** |
  | 변경 허용 범위 | diff 가 `get_track_music_video`·`get_track_lyrics_timeline`·`download_track` **3개 함수 블록에만** 국한 |
  | 범위 밖 파일 무접촉 | `git status --short` 에 `albums.py`·`reports.py`·`upload.py`·`backend_9004/`·`backend_9005/` **0줄** |
- **기대결과**: 7행 전부 일치.
- **확인할 로그 라인**: 없음(정적).
- **PASS/FAIL**: 7행 일치 → PASS. `backend_9004`/`backend_9005` 에 변경이 있으면 → **FAIL(§0-7 미러링 폐기 위반)**.
- **실패 시 의심**: `backend_9006/app/routes/tracks.py`, `git status`.

#### V196-UNIT-21. 신규 로그 위생 정적 grep `[unit]` — 즉시 중단 조건 S8 (R18)
- **사전조건**: 변경 5파일(`playlists.py`·`likes.py`·`tracks.py`·`feeds.py`·`dm_service.py`)의 **신규 로그 라인 전량**을 diff 에서 추출.
- **Given/When/Then**:
  | 검사 | 기대 |
  |---|---|
  | 원문 인자 부재 | 신규 `logger.*` 호출 인자에 `text`·`body.text`·`preview`·`lyrics`·`prompt`·`title`(트랙/피드 제목 원문)·`nickname`·`author_nickname` **직접 전달 0건** (길이·건수·bool 만 허용) |
  | id 8자 | id 를 찍는 인자는 전부 `_short(...)` 또는 `[:8]` 경유. `grep -n "logger.info" | grep -v "_short\|\[:8\]\|=%d\|len("` 로 **예외 라인 목록화** 후 육안 확인 |
  | 개인정보 부재 | 신규 로그에 `email`·`birth`·`gender`·`phone` 토큰 **0건** |
  | 프리픽스 관행 | 신규 라인이 `[playlists]`·`[likes]`·`[report]`·`[feed]`·`[dm]` 중 하나로 시작 |
  | 예외 문자열 | `[feed] purge notifications_cleanup_failed ... err=%s` 의 `err` 가 **예외 메시지만**이고 문서 내용을 담지 않음 |
  | 런타임 확인 | 전 `[api]` 케이스 수행 후 서버 로그를 `grep -iE "lyrics|prompt|birth|gender|@"` → **v196 신규 라인 매치 0건** |
- **기대결과**: 6행 전부 일치.
- **확인할 로그 라인**: 위 grep 결과 자체가 산출물. **매치된 원문은 본 문서·REPORT 에 옮겨 적지 않고 파일:라인만 기재**한다.
- **PASS/FAIL**: 6행 일치 → PASS. 1건이라도 원문/개인정보 노출 → **FAIL + 즉시 중단(S8)**.
- **실패 시 의심**: `playlists.py:162`, `likes.py:122,:151`, `tracks.py` `*_denied` 3줄, `feeds.py:609,:611`·reply 로그 `:774~775`, `dm_service.py:614,:619`.

---

### 2. `[api]` 시나리오 — 17건

> 실행: `curl`/HTTP 클라이언트. **각 블록 착수 전 §0-B 선행 절차 필수.** 모든 요청은 `http://localhost:9006` 기준.
> 🚫 이 절의 어떤 케이스도 `/api/tracks/upload`·`/api/tracks/search`·`/api/generate`·`/api/mv`·`/api/character`·`/api/voice-*` 를 호출하지 않는다.

#### V196-API-01. ① `POST /api/playlists/{내것}/tracks` 에 **타인 비공개 곡** → **400** `[api]` — 공격 경로 1 차단 (①)
- **사전조건**: A 로 재생목록 `PL-A`(`title:"v196t-pl-a"`) 생성. §0-A `TRK-PRIV-B`(B 소유, `is_public:False`) 준비.
- **Given** A 의 재생목록과 B 의 비공개 곡, **When** `POST /api/playlists/<PL-A>/tracks` `{"track_id":"<TRK-PRIV-B>"}` (`<TEST_USER_A_TOKEN>`), **Then** **`400`** 이고 본문이 **`{"error":"다른 사용자의 비공개 곡은 사용할 수 없습니다."}`** 이다(문구 정확 일치).
- **기대결과**: PG `playlist_tracks` 에 행이 **삽입되지 않는다**(`SELECT count(*) FROM playlist_tracks WHERE playlist_id=<PL-A>` 가 호출 전후 동일). `TRK-BLIND-B`(`report_blinded:True`)로 반복해도 **동일하게 400**(R4).
- **확인할 로그 라인**: `[playlists] add_track private_denied user=%s track=%s` (양쪽 8자)
- **PASS/FAIL**: 400 + 문구 정확 일치 + 미삽입 → PASS. **201 이면 FAIL(결함 미수정 — 공격 경로 1 생존)**. 403/404 면 FAIL(설계는 400 — "행위 거부" 의미).
- **실패 시 의심**: `backend_9006/app/routes/playlists.py` `add_track` 가드 + `private_denied` 로그(`:253`).

#### V196-API-02. ① `POST /api/likes/{타인 비공개 곡}` → **400** `[api]` — 최단 공격 경로 차단 (①, 신규 발견분)
- **사전조건**: `TRK-PRIV-B` 준비. A 는 해당 곡을 좋아요한 적 없음.
- **Given** B 의 비공개 곡, **When** `POST /api/likes/<TRK-PRIV-B>` (`<TEST_USER_A_TOKEN>`), **Then** **`400`** + **`{"error":"다른 사용자의 비공개 곡은 사용할 수 없습니다."}`**.
- **기대결과**: PG `likes` 미삽입. **Mongo `tracks.like_count` 미증가**(`likes.py:110~113` 의 `$inc` 가 가드 앞에 있으면 카운트가 오염된다 — 가드는 반드시 `$inc` **앞**). `TRK-BLIND-B` 로 반복해도 400.
- **확인할 로그 라인**: `[likes] like private_denied user=%s track=%s`
- **PASS/FAIL**: 400 + 문구 + `likes` 미삽입 + `like_count` 불변 → PASS. 201 이면 **FAIL(재생목록 없이도 유출 가능한 최단 경로 생존)**.
- **실패 시 의심**: `backend_9006/app/routes/likes.py:151`(`private_denied` 로그 지점 — 가드가 `like_count` `$inc` 보다 앞인지 확인).

#### V196-API-03. ① `GET /api/playlists/{id}` — **금지 키 부재** + 타인 숨김 곡 **배열 제외** `[api]` — 즉시 중단 조건 S1 (①)
- **사전조건**: 🔴 **가드 착지 전에** PG `playlist_tracks` 에 **직접 INSERT** 하여 `PL-A` 에 `TRK-PRIV-B`·`TRK-BLIND-B`·`TRK-PUB-B`·`TRK-LEGACY-B`·`TRK-PRIV-A` 5곡을 담아 둔다(이미 담긴 곡의 조회 처리를 검증하는 것이 목적이므로 **API-01 의 400 을 우회하기 위해 DB 직접 삽입**한다 — 프로덕션 가드는 건드리지 않는다).
- **Given** 5곡이 담긴 A 의 재생목록, **When** `GET /api/playlists/<PL-A>` (`<TEST_USER_A_TOKEN>`), **Then**
  ① `tracks` 배열 길이 **3** — `TRK-PUB-B`·`TRK-LEGACY-B`·`TRK-PRIV-A` 만 남는다(`TRK-PRIV-B`·`TRK-BLIND-B` 제외)
  ② 남은 각 원소의 **키 집합이 정확히 11키**(V196-UNIT-05 의 10키 + `position`)
  ③ **금지 키 존재 자체를 assert** — 각 원소에 대해 `"audio_url" not in t`, `"lyrics" not in t`, `"prompt" not in t`, `"generation_id" not in t`, `"user_character_snapshot" not in t`, `"search_keywords" not in t`, `"waveform_data" not in t`, `"beats" not in t`, `"downbeats" not in t`, `"tempo" not in t`, `"beats_status" not in t`, `"report_blinded" not in t`
- **기대결과**: 위 3항 전부. 최상위 응답 키는 `{id,user_id,title,description,is_public,created_at,tracks}` **불변**(`track_count` 는 원래 없음 — 개수 불일치 노출 없음). `position` 값은 원본 PG 값 유지(연속성은 프론트가 `idx+1` 로 재계산하므로 빈 번호가 생기지 않는다).
- **확인할 로그 라인**: `[playlists] detail id=%s user=%s tracks=3 hidden_skipped=2`
- **PASS/FAIL**: 3항 전부 일치 → PASS. 금지 키 1개라도 존재 → **FAIL + 즉시 중단(S1)**. `TRK-LEGACY-B` 가 사라지면 → **FAIL + 즉시 중단(S2)**. `TRK-PRIV-A`(본인 비공개)가 사라지면 FAIL(R3).
- **실패 시 의심**: `playlists.py:45`(직렬화), `:162` 주변(프로젝션·제외 루프·로그), 소유자 예외 조건.

#### V196-API-04. ① `GET /api/likes/` — **금지 키 부재** + 숨김 제외 + 페이지네이션 계약 불변 `[api]` — 즉시 중단 조건 S1 (①)
- **사전조건**: 🔴 가드 착지 전에 PG `likes` 에 A → (`TRK-PRIV-B`, `TRK-BLIND-B`, `TRK-PUB-B`, `TRK-LEGACY-B`, `TRK-PRIV-A`) 5행 직접 INSERT.
- **Given** 5건을 좋아요한 A, **When** `GET /api/likes/?page=1&limit=20` (`<TEST_USER_A_TOKEN>`), **Then**
  ① `likes` 배열 길이 **3**(`TRK-PRIV-B`·`TRK-BLIND-B` 제외)
  ② 각 원소 키 집합이 정확히 **11키**(10키 + `liked_at`), `position` **부재**
  ③ 금지 키 12종 **존재 자체 부재**(API-03 ③ 과 동일 목록)
  ④ `pagination` 이 `{page,limit,total,totalPages}` **4키 불변**
- **기대결과**: 위 4항. **`pagination.total` 은 PG `likes` 기준 5 를 유지**하는 것이 정상(숨김 제외는 하이드레이션 단계에서 일어나며 PG 카운트를 바꾸지 않는다). 배열 길이(3)와 `total`(5)의 불일치는 **설계상 허용** — 이 케이스에서 `total==3` 을 기대하면 오판이다.
- **확인할 로그 라인**: `[likes] list user=%s returned=3 hidden_skipped=2`
- **PASS/FAIL**: 4항 일치 → PASS. 금지 키 존재 → **FAIL + 즉시 중단(S1)**. `TRK-LEGACY-B` 누락 → **FAIL(S2)**.
- **실패 시 의심**: `likes.py:44`(직렬화), `:122`(제외 루프·로그), `list_likes` 의 `pagination` 블록(불변).

#### V196-API-05. ①-C `POST /api/tracks/download/{타인 비공개 곡}` → **404** + **Redis 차트 미증가** `[api]` (①-C, R5c)
- **사전조건**: §0-C 의 Redis 집계를 **호출 직전에** 스냅샷 — `SCARD chart:downloads:hourly:<YYYYMMDDHH>:<TRK-PRIV-B>`, `SCARD chart:downloads:daily:…`, `SISMEMBER chart:dl_tracks:hourly:<YYYYMMDDHH> <TRK-PRIV-B>`, Mongo `download_logs.count_documents({"track_id":"<TRK-PRIV-B>"})`, `tracks.download_count`.
- **Given** B 의 비공개 곡, **When** `POST /api/tracks/download/<TRK-PRIV-B>` (`<TEST_USER_A_TOKEN>`), **Then** **`404`** + 본문 **`{"error":"트랙을 찾을 수 없습니다."}`**(`_TRACK_NOT_FOUND` — 존재 은닉 정책).
- **기대결과**: 응답에 `download_url`·`filename` **부재**. 그리고 **호출 후 스냅샷이 전부 호출 전과 동일**:
  `SCARD` 4종 불변 · `SISMEMBER` 여전히 0 · `download_logs` 카운트 불변 · `tracks.download_count` 불변.
  ⚠️ 가드가 Redis 파이프라인(`tracks.py:1742~1765`) **뒤**에 있으면 404 를 받아도 **차트가 이미 오염**된다 — 응답 코드만 보고 PASS 판정하면 R5c 를 놓친다.
- **확인할 로그 라인**: `[report] track download_denied track=%s` (8자)
- **PASS/FAIL**: 404 + `_TRACK_NOT_FOUND` 문구 + 5종 스냅샷 전부 불변 → PASS. 스냅샷이 하나라도 증가 → **FAIL(R5c)**.
- **실패 시 의심**: `backend_9006/app/routes/tracks.py:1741`(`download_track` — 인증 필수 `get_current_user` 유지) · `:1757`(`download_denied` — 반드시 Redis 집계 **앞**).

#### V196-API-06. ①-C `GET /api/tracks/{타인 비공개 곡}/music-video` **비로그인** → **404** `[api]` (①-C)
- **사전조건**: `TRK-PRIV-B`. **Authorization 헤더 없이** 호출.
- **Given** B 의 비공개 곡, **When** `GET /api/tracks/<TRK-PRIV-B>/music-video` (헤더 없음), **Then** **`404`** + 본문 **`{"error":"트랙을 찾을 수 없습니다."}`**.
- **기대결과**: `music_video_url`·`has_music_video` 키 **부재**. `<TEST_USER_A_TOKEN>`(타인 로그인)으로 반복해도 **동일 404**. `<TEST_USER_B_TOKEN>`(소유자)으로 호출하면 가드를 통과해 **MV 미존재 404 = `{"error":"뮤직비디오를 찾을 수 없습니다."}`** 로 **본문이 달라진다** — 이 본문 차이가 "가드가 정확히 작동했다"의 증거다.
- **확인할 로그 라인**: `[report] track mv_denied track=%s`
- **PASS/FAIL**: 비로그인·타인 → `트랙을 찾을 수 없습니다.` / 소유자 → `뮤직비디오를 찾을 수 없습니다.` 로 **본문 구분** → PASS. 소유자에게도 `트랙을…` 이 나오면 FAIL(소유자 차단 — 과교정).
- **실패 시 의심**: `tracks.py:770~789`(`get_track_music_video` — optional auth `:772`, `mv_denied` `:789`).

#### V196-API-07. ①-C `GET /api/tracks/{타인 비공개 곡}/lyrics-timeline` **비로그인** → **404** `[api]` — 광역 except 함정 (①-C, R5b)
- **사전조건**: `TRK-PRIV-B` 에 `recognized_timestamps` 3줄이 시드되어 있어야 한다(가드가 없으면 **가사가 실제로 나오는** 상태여야 유출 재현이 성립).
- **Given** 가사 타임스탬프가 있는 B 의 비공개 곡, **When** `GET /api/tracks/<TRK-PRIV-B>/lyrics-timeline` (헤더 없음), **Then** **HTTP `404`** + **`{"error":"트랙을 찾을 수 없습니다."}`**.
- **기대결과**: ⚠️ **`200 {"has_timestamps": false, "segments": [], "source": "none"}` 이 오면 FAIL** — 이는 가드가 던진 404 를 `:820~824` 의 `except Exception` 이 **삼킨** 신호다(R5b). `segments` 배열이 비어 있어도 **상태 코드가 200 이면 FAIL**.
  `<TEST_USER_A_TOKEN>`(타인)으로 반복해도 404. `<TEST_USER_B_TOKEN>`(소유자)이면 **200 + `has_timestamps:true` + `segments` 3개 + `source:"recognized"`**.
- **확인할 로그 라인**: `[report] track lyrics_denied track=%s` — **`[lyrics-timeline] failed track=%s` traceback 이 함께 나오면 FAIL**(가드 반환이 예외로 취급된 것).
- **PASS/FAIL**: 404 + 본문 + traceback 부재 → PASS. 200 응답 또는 traceback → **FAIL(R5b)**.
- **실패 시 의심**: `tracks.py:807~829`(`get_track_lyrics_timeline` — optional auth `:809`, `lyrics_denied` `:829`). 가드가 `try` **진입 전**인지, `JSONResponse` 반환이 광역 `except` 에 삼켜지지 않는 경로인지 확인.

#### V196-API-08. 🔴 회귀: **공개 곡 비로그인** MV·가사 접근 **파손 없음** `[api]` — 즉시 중단 조건 S5 (R5a)
- **사전조건**: `TRK-PUB-B`(`is_public:True`, `recognized_timestamps` 3줄, `generation_id` 없음). **Authorization 헤더 없이** 호출.
- **Given/When/Then**:
  | 요청(비로그인) | 기대 상태 | 기대 본문 |
  |---|---|---|
  | `GET /api/tracks/<TRK-PUB-B>/lyrics-timeline` | **200** | `{"has_timestamps": true, "segments":[3건], "source":"recognized"}` |
  | `GET /api/tracks/<TRK-PUB-B>/music-video` | **404** | **`{"error":"뮤직비디오를 찾을 수 없습니다."}`** ← MV 미존재 404 이지 가드 404 가 **아니어야** 한다 |
  | `GET /api/tracks/stream/<TRK-PUB-B>` | 200 또는 404(오디오 파일 없음) | **401 이면 FAIL** |
  | `GET /api/tracks/<TRK-PUB-B>/lyrics-timeline` + 임의 만료 토큰 | 200 | optional auth 가 잘못된 토큰에 401 을 던지지 않는지 |
- **기대결과**: **어떤 행에서도 `401` 이 나오지 않는다.** MV 행의 본문이 `트랙을 찾을 수 없습니다.` 이면 가드가 **공개 곡에도 발동**한 것 → FAIL.
  > 설계 노트: MV 200 을 만들려면 완료된 MV 작업물이 필요하지만 **MV 생성은 유료 API** 라 금지다(§0-1). 따라서 R5a 는 **404 본문 구분**으로 검증한다 — 가드 404(`_TRACK_NOT_FOUND`)와 MV 미존재 404(`뮤직비디오를…`)는 문자열이 다르므로 판별 가능하다. 실 MV 보유 곡으로 200 을 확인하려면 **실사용자 데이터 열람**이 되므로 planner 승인 항목(§5 A1)으로 분리한다.
- **확인할 로그 라인**: `[lyrics-timeline] track=%s has=True count=3` / `*_denied` 라인 **미출력**
- **PASS/FAIL**: 4행 전부 기대치 → PASS. 401 발생 또는 가드 404 문구 → **FAIL + 즉시 중단(S5)**.
- **실패 시 의심**: `tracks.py:772`·`:809` 의 의존성이 `get_current_user`(필수)로 잘못 붙었는지 — 반드시 `get_current_user_optional`(`app/auth.py:51`).

#### V196-API-09. 🔴 회귀: **레거시 곡(R2) + 본인 비공개 곡(R3)** 정상 동작 `[api]` — 즉시 중단 조건 S2 (R2, R3)
- **사전조건**: `TRK-LEGACY-B`(`is_public` **키 자체 없음**, B 소유), `TRK-PRIV-A`(A 소유 비공개). A 의 새 재생목록 `PL-A2`.
- **Given/When/Then**:
  | 시나리오 | 요청 | 기대 |
  |---|---|---|
  | R2-추가 | A 가 `POST /api/playlists/<PL-A2>/tracks` `{"track_id":"<TRK-LEGACY-B>"}` | **201** `{"message":"트랙이 추가되었습니다."}` |
  | R2-좋아요 | A 가 `POST /api/likes/<TRK-LEGACY-B>` | **201** |
  | R2-조회 | `GET /api/playlists/<PL-A2>` | `tracks` 에 `TRK-LEGACY-B` **포함**, `is_public:false`(직렬화 기본값)로 표기되지만 **노출은 됨** |
  | R3-추가 | A 가 `POST /api/playlists/<PL-A2>/tracks` `{"track_id":"<TRK-PRIV-A>"}` | **201**(본인 비공개 곡) |
  | R3-조회 | `GET /api/playlists/<PL-A2>` (A 토큰) | `TRK-PRIV-A` **포함** |
  | R3-타인조회 | `PL-A2` 를 `is_public:true` 로 바꾼 뒤 B 가 `GET /api/playlists/<PL-A2>` | `TRK-PRIV-A` **제외**, `TRK-LEGACY-B` **포함** |
  | R3-좋아요목록 | A 가 `POST /api/likes/<TRK-PRIV-A>` → `GET /api/likes/` | 201 + 목록에 **포함** |
- **기대결과**: 7행 전부. 특히 **R2 행이 400/제외로 나오면 즉시 중단(S2)** — feeds 식 `not is_public` 을 복사한 것이며 실서비스의 레거시 공개곡이 전부 사라진다.
- **확인할 로그 라인**: `[playlists] detail id=%s user=%s tracks=%d hidden_skipped=0`(A 조회 시) / `hidden_skipped=1`(B 조회 시)
- **PASS/FAIL**: 7행 일치 → PASS. R2 행 실패 → **FAIL + 즉시 중단(S2)**. R3 행 실패 → FAIL(R3).
- **실패 시 의심**: `playlists.py:36`(`is` 비교)·소유자 예외 조건, `likes.py:36` 대응분.

#### V196-API-10. ③ 3단 답글 알림 대상 교정 — **B 수신 1건, A 수신 0건** + `parent_id` 직접 확인 `[api]` — 즉시 중단 조건 S3 (③, R6)
- **사전조건**: C 가 피드 `F`(`title:"v196t-feed-c"`) 작성. 착수 전 각 계정의 `GET /api/notifications/?limit=100` 스냅샷(타입별 건수) 기록. A·B·C 는 서로 팔로우하지 않은 상태(팔로우 알림 혼입 방지).
- **Given/When/Then** 순서대로:
  1. A 가 `POST /api/feeds/<F>/comments` `{"text":"v196t-c1"}` → 최상위 댓글 `CA` 생성 (201)
  2. B 가 `POST /api/feeds/<F>/comments` `{"text":"v196t-c2","parent_id":"<CA>"}` → 1단 답글 `CB`
  3. **C 가** `POST /api/feeds/<F>/comments` `{"text":"v196t-c3","parent_id":"<CB>"}` → 2단(평탄화 대상)
  **Then** 3번 호출 직후:
  | 대상 | 검사 | 기대 |
  |---|---|---|
  | B | `GET /api/notifications/` 의 `type=="reply" && actor_id==<C> && target_id==<F>` | **1건** |
  | A | 동일 조건 | **0건** (스냅샷 대비 `reply` 증가 0) |
  | C | `type=="comment"` | **0건** — 피드 주인이 C 본인이므로 self-skip |
  | Mongo | `feed_comments.find_one({"_id": <CC>})["parent_id"]` | 🔴 **`<CA>`**(최상위 댓글 id) — `<CB>` 면 v191 계약 파손 |
- **기대결과**: 4행 전부. 수정 전 동작(= 결함)은 **B 0건 / A 1건** 이었다.
- **확인할 로그 라인**: `[feed] comment_add reply feed=%s parent_stored=<CA 8자> notify_to=<B 8자>` + `[notify] push ok type=reply to=<B 8자> actor=<C 8자>`
- **PASS/FAIL**: 4행 일치 → PASS. Mongo `parent_id != <CA>` → **FAIL + 즉시 중단(S3)**. A 가 수신하면 FAIL(결함 미수정).
- **실패 시 의심**: `feeds.py:770`(평탄화 전 캡처)·`:797~807`(알림 분기).

#### V196-API-11. ③ 회귀: 1단 답글 정상 케이스 — **A 수신 1건** `[api]` — 과교정 방지 (③, R7)
- **사전조건**: C 의 새 피드 `F2`. 알림 스냅샷 기록.
- **Given** A 가 `F2` 에 최상위 댓글 `CA2` 작성, **When** B 가 `POST /api/feeds/<F2>/comments` `{"text":"v196t-r1","parent_id":"<CA2>"}`, **Then**
  ① A 의 `reply` 알림 **+1**(`actor_id==<B>`, `target_id==<F2>`)
  ② C(피드 주인)의 `comment` 알림 **+1**
  ③ B 자신의 알림 **증가 0**
  ④ 저장된 `parent_id == <CA2>`(평탄화 대상 아님 — 원본 유지)
- **기대결과**: 4행 전부. **A 가 0건이면 과교정** — 새 변수가 평탄화 값을 참조하도록 잘못 배선된 것.
- **확인할 로그 라인**: `[feed] comment_add reply feed=%s parent_stored=<CA2 8자> notify_to=<A 8자>` + `[notify] push ok type=reply to=<A 8자>` + `[notify] push ok type=comment to=<C 8자>`
- **PASS/FAIL**: 4행 일치 → PASS. A 미수신 → **FAIL(R7)**.
- **실패 시 의심**: `feeds.py:797~807`(`reply_target_author_id` 배선).

#### V196-API-12. ③ 회귀: 부모 작성자 == 피드 주인 → **`comment`+`reply` 이중 발송 없음** `[api]` (③, R8)
- **사전조건**: **C 자신의 피드 `F3` 에 C 가 최상위 댓글 `CC3` 을 단다**(부모 작성자 = 피드 주인 = C). 알림 스냅샷 기록.
- **Given** 위 상태, **When** A 가 `POST /api/feeds/<F3>/comments` `{"text":"v196t-dup","parent_id":"<CC3>"}`, **Then**
  ① C 의 `comment` 알림 **+1**
  ② C 의 `reply` 알림 **+0** — `:775` 의 "부모 작성자 == 피드 주인이면 중복 방지" 의도 유지
  ③ C 의 총 알림 증가가 **정확히 1건**
- **기대결과**: 3행 전부. **+2 이면 R8 회귀**(한 행위로 알림 2개 — 앱팀 화면에 중복 표시).
- **확인할 로그 라인**: `[notify] push ok type=comment to=<C 8자> actor=<A 8자>` **1줄만**. `type=reply` 라인 **미출력**.
- **PASS/FAIL**: 총 증가 1건 → PASS. 2건 → **FAIL(R8)**.
- **실패 시 의심**: `feeds.py:798`(비교 우변이 `doc.get("author_id")` 로 유지됐는지 — 새 변수로 바꿔치기하면 조건이 무력화된다).

#### V196-API-13. ④ 피드 삭제 후 해당 `target_id` 알림 **0건** `[api]` (④)
- **사전조건**: C 의 피드 `F4` 에 대해 **알림 4종을 전부 발생**시킨다 — ① C 가 `F4` 업로드(팔로워가 있으면 `feed`; 없으면 이 행은 0으로 두고 나머지 3종만) ② A 가 좋아요(`like`) ③ A 가 댓글(`comment`) ④ B 가 A 댓글에 답글(`reply`). 삭제 **직전** `notifications.count_documents({"target_id":"<F4>"})` = **N(≥3)** 을 기록.
- **Given** 알림 N 건이 달린 피드, **When** C 가 `DELETE /api/feeds/<F4>` (`<TEST_USER_C_TOKEN>`), **Then**
  ① 응답 **200** `{"message":"피드가 삭제되었습니다."}`
  ② `notifications.count_documents({"target_id":"<F4>"})` == **0**
  ③ `feeds.find_one({"_id":<F4>})` is None, `feed_comments.count_documents({"feed_id":"<F4>"})` == 0, PG `feed_likes WHERE feed_id='<F4>'` == 0 (기존 파기 계약 불변)
- **기대결과**: 3항 전부. 수정 전에는 ② 가 **N 건 그대로** 잔존했다.
- **확인할 로그 라인**: `[feed] purge ok feed=%s author=%s comments_removed=%d notifications_removed=<N>`
- **PASS/FAIL**: 3항 일치 + `notifications_removed == N` → PASS.
- **실패 시 의심**: `feeds.py:604`(`delete_many`), `target_id` 를 `str()` 로 넘겼는지(V196-UNIT-19).

#### V196-API-14. ④ 🔴 **무관한 알림 전수 불변** `[api]` — 즉시 중단 조건 S4 (④, R9)
- **사전조건**: V196-API-13 과 **같은 세션**에서 수행. 삭제 대상 `F4` 외에 ① C 의 **다른 피드 `F5`** 에도 좋아요·댓글 알림을 만들어 두고 ② **A → C 팔로우**로 `follow` 알림 1건(`target_id=None`)을 만들어 둔다.
- **Given/When/Then**: `DELETE /api/feeds/<F4>` **직전·직후** 아래를 전수 집계해 대조한다.
  | 집계 | 삭제 전 | 삭제 후 기대 |
  |---|---|---|
  | `notifications.count_documents({})` | `T` | **`T − N`** (정확히 N 감소, 그 이상 감소하면 오삭제) |
  | `count({"target_id":"<F5>"})` | `M` | **`M`** (불변) |
  | `count({"type":"follow"})` | `Kf` | **`Kf`** (불변) |
  | `count({"target_id": None})` | `Kn` | **`Kn`** (불변 — `follow` 는 전부 여기) |
  | 타입별 5종 각각 `count({"type": t})` | 기록 | `F4` 귀속분만 감소, `F5`·`follow` 귀속분 **불변** |
  | 다른 사용자(실사용자 포함) 수신 알림 총계 | 기록 | **불변** |
- **기대결과**: 6행 전부. `T − N` 보다 더 줄면 **광역 삭제**가 일어난 것.
- **확인할 로그 라인**: `[feed] purge ok ... notifications_removed=<N>` — 이 값이 사전 기록한 N 과 **정확히 일치**해야 한다.
- **PASS/FAIL**: 6행 일치 → PASS. 무관 알림 1건이라도 감소 → **FAIL + 즉시 중단(S4)**.
- **실패 시 의심**: `feeds.py:604~607`(`type` 화이트리스트 누락 시 `follow` 의 `target_id=None` 이 `feed_id` 와 매칭되지는 않지만, 필터에서 `target_id` 를 빠뜨리면 **전량 삭제**된다).

#### V196-API-15. ④ 범위 밖 확인: **댓글 개별 삭제 시 알림 불변** + 댓글 트리 회귀 `[api]` (④ §2-4, 회귀)
- **사전조건**: C 의 피드 `F6` + A 최상위 `CA6` + B 답글 `CB6`(1단) + C 답글 `CC6`(2단→평탄화). 각 계정 알림 스냅샷.
- **Given/When/Then**:
  | 검사 | 요청 | 기대 |
  |---|---|---|
  | 알림 불변(범위 밖) | A 가 `DELETE /api/feeds/comments/<CA6>` | 200 + `notifications.count({"target_id":"<F6>"})` **불변**(§2-4: 스키마상 식별 불가 — 정리하지 않는 것이 **정상**) |
  | `comment_count` 감소 | 위 삭제 후 `GET /api/feeds/<F6>` | `comment_count` **−1** |
  | 음수 방지 | `comment_count` 를 0 으로 만든 뒤 추가 삭제 시도 | 0 미만으로 내려가지 않음 |
  | 삭제 권한 | B 가 `DELETE /api/feeds/comments/<CC6>`(C 의 댓글, B 는 피드 주인 아님) | **403** `{"error":"댓글을 삭제할 권한이 없습니다."}` |
  | 피드 주인 권한 | C 가 `DELETE /api/feeds/comments/<CB6>`(B 의 댓글, C 는 피드 주인) | **200** |
  | 트리 저장 구조 | `GET /api/feeds/<F6>/comments?page=1&limit=20` | `parent_id` 가 `None`(최상위) / `<CA6>`(1단·평탄화 2단) 3종만 등장. **2단 값 없음** |
  | 정렬·페이지네이션 | `limit=2` 로 2페이지 조회 | `created_at` 오름차순, `pagination` `{page,limit,total,totalPages}` 4키 불변, 중복·누락 0 |
- **기대결과**: 7행 전부.
- **확인할 로그 라인**: `[feed] comment_delete ok comment=%s feed=%s user=%s by=author|feed_owner` / `[feed] comments_list ok feed=%s returned=%d total=%d`
- **PASS/FAIL**: 7행 일치 → PASS. 댓글 삭제 시 알림이 줄면 → **FAIL(범위를 넘어선 구현 — §6-2 위반, 오삭제 위험)**.
- **실패 시 의심**: `feeds.py:788~826`(무수정이어야 함 — `git diff` 로 이 블록 diff 0 확인).

#### V196-API-16. 회귀: 재생목록 기존 동작 전수 + 좋아요 기존 동작 전수 `[api]` (R1 계약면)
- **사전조건**: A 계정, `TRK-PUB-B` 등 공개 픽스처.
- **Given/When/Then** — 재생목록:
  | 검사 | 기대 |
  |---|---|
  | 생성 | `POST /api/playlists/` `{"title":"v196t-reg"}` → **201**, 응답 6키 `{id,user_id,title,description,is_public,created_at}` |
  | 제목 누락 | `POST` `{"title":""}` → **400** `{"error":"플레이리스트 제목은 필수입니다."}` |
  | 수정 | `PUT /api/playlists/{id}` `{"title":"v196t-reg2","is_public":true}` → 200, 6키 불변 |
  | 삭제 | `DELETE /api/playlists/{id}` → 200 `{"message":"플레이리스트가 삭제되었습니다."}` |
  | 트랙 추가 | `POST /{id}/tracks` 공개 곡 → **201** `{"message":"트랙이 추가되었습니다."}` |
  | 중복 추가 | 같은 곡 재추가 → **409** `{"error":"이미 추가된 트랙입니다."}` |
  | 트랙 제거 | `DELETE /{id}/tracks/{track_id}` → 200 / 없는 곡 → **404** |
  | 비공개 재생목록 타인 조회 | B 가 A 의 비공개 `PL` 조회 → **403** `{"error":"비공개 플레이리스트입니다."}` |
  | 공개 재생목록 타인 조회 | B 가 A 의 공개 `PL` 조회 → **200** |
  | 목록 `track_count` | `GET /api/playlists/` → 각 원소 7키 + `track_count` 가 **PG `playlist_tracks` 실제 행 수**(숨김 제외와 무관 — 목록은 PG 카운트 그대로) |
  | 잘못된 id | `GET /api/playlists/not-a-uuid` → **400** / 존재하지 않는 uuid → **404** |
- **Given/When/Then** — 좋아요:
  | 검사 | 기대 |
  |---|---|
  | 좋아요 | `POST /api/likes/<TRK-PUB-B>` → **201** `{"message":"좋아요가 추가되었습니다."}`, Mongo `like_count` +1 |
  | 중복 | 재호출 → **409** `{"error":"이미 좋아요한 트랙입니다."}`, `like_count` **불변** |
  | 취소 | `DELETE /api/likes/<TRK-PUB-B>` → 200, `like_count` −1(0 미만 방지) |
  | 미좋아요 취소 | 재호출 → **404** `{"error":"좋아요하지 않은 트랙입니다."}` |
  | check | `GET /api/likes/check?song_ids=a,b,c` → `{"liked_ids":[...]}` 1키 불변, 빈 입력 → `{"liked_ids":[]}` |
  | 페이지네이션 | `GET /api/likes/?page=2&limit=1` → `pagination` 4키, `liked_at` **ISO 문자열 유지**, 정렬 `created_at DESC` |
  | 잘못된 id | `POST /api/likes/notanoid` → **400** |
- **기대결과**: 18행 전부 v195 이전과 동일.
- **확인할 로그 라인**: `[playlists] create user=%s title_len=%d desc_len=%d` / `[playlists] update id=%s user=%s title_len=%d desc_len=%d` / `[playlists] detail ...` — **제목 원문이 아니라 길이**로 찍히는지 동시 확인(R18).
- **PASS/FAIL**: 18행 일치 → PASS.
- **실패 시 의심**: `playlists.py` 전역, `likes.py` 전역.

#### V196-API-17. 회귀: 트랙 직링크 가드 + 알림 5종 계약 + DM/pending/관리자 CS `[api]` (v138 불변, R15)
- **사전조건**: `TRK-PRIV-B`·`TRK-PUB-B`. A·B 간 accepted DM 대화 1건 + A·C 간 pending 요청 1건. `<TEST_ADMIN_TOKEN>`.
- **Given/When/Then** — 직링크 가드 불변(v138):
  | 요청 | 기대 |
  |---|---|
  | 비로그인 `GET /api/tracks/stream/<TRK-PRIV-B>` | **404** `_TRACK_NOT_FOUND` + 로그 `[report] track stream_denied track=%s` |
  | 소유자 B `GET /api/tracks/stream/<TRK-PRIV-B>` | 가드 통과(오디오 미존재로 404 가능 — **문구가 `오디오 파일을 찾을 수 없습니다.`** 여야 함) |
  | 비로그인 `GET /api/tracks/stream-proxy/<TRK-PRIV-B>` | 차단 유지(기존 동작 불변) |
  | 비로그인 `GET /api/tracks/<TRK-PRIV-B>` | 차단 유지 |
  | 비로그인 `GET /api/tracks/stream/<TRK-PUB-B>` | **401 아님** |
- **Given/When/Then** — 알림 계약 불변:
  | 요청 | 기대 |
  |---|---|
  | `GET /api/notifications/?page=1&limit=30` | 최상위 3키 `{notifications,unread,pagination}`, 원소에 `{id,user_id,type,actor_id,actor_nickname,target_id,preview,read,created_at}`, 정렬 `created_at DESC` |
  | `GET /api/notifications/unread-count` | `{"count": <int>}` 1키 |
  | `POST /api/notifications/read-all` | `{"marked": <int>}` 1키, 이후 `unread-count` 가 **0** |
  | 5종 발행 | `follow`(팔로우 시, `target_id` **null**) / `comment` / `reply` / `like` / `feed` 가 각각 1건씩 생성됨 |
- **Given/When/Then** — DM·pending·관리자 CS:
  | 요청 | 기대 |
  |---|---|
  | A→B 메시지 전송 후 B 가 `POST /api/dm/conversations/<cid>/read` | **200** `{"conversation_id","read":true,"marked":<n>}` **3키 불변** |
  | 곧바로 재호출(읽을 것 0) | **200** `{"...","read":true,"marked":0}` — **스키마 동일**, peer 이벤트만 사라짐 |
  | `GET /api/dm/conversations/<cid>/messages?before=<msg_id>` | 커서 페이지네이션 정상, 중복·누락 0 |
  | 🔴 pending 수신자 C 가 `POST /api/dm/conversations/<pending-cid>/read` | **200** `{"read": false, "marked": 0}` + Mongo `unread.<C>` **보존**(0으로 리셋되지 않음) + 발신자 A 에게 이벤트 0건 |
  | 🔴 관리자 `POST /api/admin/cs/conversations/<cs-cid>/read` (`<TEST_ADMIN_TOKEN>`) | **200** + 반환 **3키 스키마 불변**(R15) — `mark_read` 를 그대로 반환하므로 ⑤ 변경의 영향이 없음을 확인 |
  | 비참여자 접근 | `POST /api/dm/conversations/<cid>/read`(제3자) → **403** |
- **기대결과**: 16행 전부.
- **확인할 로그 라인**: `[report] track stream_denied track=%s` / `[notify] read_all user=%s marked=%d` / `[dm] mark_read conv=%s me=%s marked=%d` / `[dm] mark_read skipped (pending request) conv=%s me=%s` / `[admin-cs] cid=%s admin=%s read`
- **PASS/FAIL**: 16행 일치 → PASS. 공개 곡 stream 이 401 → **FAIL + 즉시 중단(S5)**. 관리자 CS 반환 스키마 변형 → FAIL(R15).
- **실패 시 의심**: `tracks.py:1705`(`get_track_stream`)·stream-proxy·`/{track_id}`, `notifications.py:83~123`, `dm_service.py:571~630`, `dm.py:217~229`, `admin_cs.py:190~205`.

---

### 3. `[e2e]` 시나리오 — 8건

> 선행: 4000·4001 **하드 새로고침 + 빌드 표기 기록**(§0-9). DevTools Console·Network 를 열고 시작한다. **Network 에 `/api/generate`·`/api/mv`·`/api/character`·`/api/voice-*`·`/api/tracks/upload`·`/api/tracks/search` 요청이 뜨면 즉시 중단(S6)** — 화면 조작 중 실수로 유료 경로를 밟는 것을 상시 감시한다.

#### V196-E2E-01. 재생목록 상세 렌더 — **아티스트명·커버 표시** `[e2e]` — 🔴 최대 회귀 위험 (R1)
- **사전조건**: A 로 4000 로그인. `PL-A`(공개 곡 2곡 + `TRK-LEGACY-B` 1곡 포함). 착수 전 하드 새로고침.
- **Given** `/playlist/<PL-A>` 진입, **When** 목록이 렌더되면, **Then**
  ① 헤더에 제목·설명·**`N곡 · 날짜`**(`PlaylistDetailPage.jsx:106`) 표시 — N 은 **응답 `tracks` 길이**
  ② 각 행에 **커버 이미지 또는 그라데이션 폴백**이 뜬다(`SongItem.jsx:58,:61~62` — `cover_image` 또는 `album_id||id` 시드)
  ③ 각 행의 **아티스트명이 공백이 아니다**(`SongItem.jsx:76` — `artist_name || uploader_nickname || 'AI'`)
  ④ 아티스트 링크 `href` 가 `/artist/<uploader_id>` 로 채워진다(`artist_id` 별칭 또는 `uploader_id` 폴백)
  ⑤ 행 번호가 **1..N 연속**(`:125` `idx+1`)
  ⑥ **Console 에러 0건**(특히 `Cannot read properties of undefined`)
- **기대결과**: 6항 전부. Network 탭에서 `GET /api/playlists/<PL-A>` 응답 payload 에 `audio_url`·`lyrics` 등이 **없는데도** 화면이 정상인 것을 함께 확인(제거가 프론트에 무영향임을 실증).
- **확인할 로그 라인**: 서버 `[playlists] detail id=%s user=%s tracks=%d hidden_skipped=%d` / 브라우저 콘솔 에러 0
- **PASS/FAIL**: 6항 전부 → PASS. 아티스트명 공백 → **FAIL(R1 — 화이트리스트가 `uploader_nickname`/`artist_name` 을 빠뜨림)**. 커버 미표시 → FAIL(`cover_image`/`cover_image_url` 누락).
- **실패 시 의심**: `playlists.py:45`(별칭·원본 키 병행), `frontend/src/components/SongItem.jsx:58,:61~62,:76`.

#### V196-E2E-02. 전체 재생 → `/tracks/stream/{id}` 200 → **실제 재생** `[e2e]` (R1)
- **사전조건**: V196-E2E-01 상태. Network 필터 `stream`.
- **Given** 재생목록 상세, **When** **"전체 재생"** 버튼(`PlaylistDetailPage.jsx:109~111`) 클릭, **Then**
  ① `PlayerContext.jsx:135~156` 이 `GET /api/tracks/stream/<첫 곡 id>` 를 발사하고 **200 `{stream_url}`** 수신
  ② `audio.src` 가 설정되고 **재생이 시작**된다(재생 시간이 증가)
  ③ 하단 플레이어 바에 **제목**(`MusicPlayer.jsx:57`)과 **아티스트명**(`:58` — **폴백 없음**)이 **둘 다 공백이 아니게** 표시된다
  ④ 커버 썸네일 또는 그라데이션 표시(`:48,:50~51`)
  ⑤ 큐가 재생목록 전체로 설정되어 다음 곡 이동이 동작한다(`play(tracks[0], tracks)` `:42`)
- **기대결과**: 5항 전부. **③ 이 v196 의 부수 개선 지점** — 기존 `playlists.py::_serialize_track` 은 별칭을 안 붙여 여기가 공백이었다.
- **확인할 로그 라인**: 서버 `[playlists] detail ...` 이후 `/api/tracks/stream/` 200. `[report] track stream_denied` 라인 **미출력**.
- **PASS/FAIL**: 5항 전부 → PASS. ③ 이 공백이면 FAIL(별칭 누락). stream 이 404 면 FAIL(가드 과교정 — 공개 곡을 막았거나 오디오 파일 부재 픽스처를 잘못 고름).
- **실패 시 의심**: `playlists.py:45`(직렬화), `frontend/src/contexts/PlayerContext.jsx:135~156`, `components/MusicPlayer.jsx:57~58`.

#### V196-E2E-03. 행 재생 → `/player` 상세 화면 `[e2e]` (R1)
- **사전조건**: V196-E2E-01 상태.
- **Given** 재생목록 상세, **When** 임의 행의 제목 또는 커버를 클릭해 재생하고 플레이어 바를 눌러 `/player` 로 이동하면, **Then**
  ① 곡이 바뀌고 새 `GET /api/tracks/stream/<해당 id>` 200
  ② `/player` 상단에 **제목·아티스트명 둘 다 표시**(`PlayerPage.jsx:358,:365`,`:591~592` — 아티스트는 폴백 없음)
  ③ 커버 표시(`:289~290,:584~585`)
  ④ `/player` 가 `api.getTrackDetail(id)`(`:90`, `GET /api/tracks/{id}`)로 **가사·프롬프트·BPM 을 별도 재조회**하는 것을 Network 에서 확인 — **재생목록 payload 에서 오는 게 아님을 실증**
  ⑤ Console 에러 0건
- **기대결과**: 5항 전부.
- **확인할 로그 라인**: `/api/tracks/stream/` 200 + `/api/tracks/<id>` 200
- **PASS/FAIL**: 5항 전부 → PASS. ② 공백 → FAIL(R1).
- **실패 시 의심**: `frontend/src/pages/PlayerPage.jsx:90,:358,:365,:591~592`.

#### V196-E2E-04. 타인 비공개 곡이 담긴 재생목록 — **조용히 사라지고 화면은 정상** `[e2e]` (①, R1)
- **사전조건**: §V196-API-03 의 `PL-A`(5곡 중 2곡이 타인 숨김). A 로 로그인.
- **Given** `/playlist/<PL-A>` 진입, **When** 렌더 완료, **Then**
  ① 행이 **3개**만 보이고 행 번호가 **1,2,3 연속**(빈 번호·건너뛴 번호 없음 — `idx+1` 재계산)
  ② 헤더의 `N곡` 표기가 **3곡** (응답 배열 길이 기준 — `track_count` 를 쓰지 않으므로 불일치 노출 없음)
  ③ 빈 자리·깨진 카드·"삭제된 곡" 같은 **마스킹 UI 가 나타나지 않는다**(신규 UI 계약 없음이 설계)
  ④ Console 에러 0건, 렌더 경고 0건
  ⑤ `checkLikes` 호출(`PlaylistDetailPage.jsx:28`)이 **남은 3곡 id 로만** 발사된다
- **기대결과**: 5항 전부.
- **확인할 로그 라인**: 서버 `[playlists] detail id=%s user=%s tracks=3 hidden_skipped=2`
- **PASS/FAIL**: 5항 전부 → PASS. 번호가 끊기면 FAIL. 빈 카드가 뜨면 FAIL(설계 위반).
- **실패 시 의심**: `playlists.py` `get_playlist` 제외 루프, `frontend/src/pages/PlaylistDetailPage.jsx:106,:121~131`.

#### V196-E2E-05. **본인 비공개 곡**이 본인 재생목록에 보인다 `[e2e]` (R3)
- **사전조건**: A 로 로그인. `PL-A2` 에 `TRK-PRIV-A`(A 소유 비공개) 포함.
- **Given** `/playlist/<PL-A2>` 진입, **When** 렌더, **Then**
  ① `TRK-PRIV-A` 행이 **표시**된다
  ② 해당 행 재생 시 `GET /api/tracks/stream/<TRK-PRIV-A>` 가 **404 가 아니다**(소유자 통과 — `_can_view_hidden_track`)
  ③ 같은 재생목록을 공개로 바꾼 뒤 **B 계정(다른 브라우저 프로필/시크릿 창)** 으로 열면 그 행이 **보이지 않는다**
- **기대결과**: 3항 전부. ①②가 실패하면 사용자가 자기 비공개 곡을 자기 목록에서 못 듣게 되는 심각 회귀(R3).
- **확인할 로그 라인**: A 조회 시 `hidden_skipped=0`, B 조회 시 `hidden_skipped=1`
- **PASS/FAIL**: 3항 전부 → PASS.
- **실패 시 의심**: `playlists.py` 소유자 예외 조건, `tracks.py:57`(`_can_view_hidden_track`).

#### V196-E2E-06. 곡 추가 모달 — 타인 비공개 곡 차단이 화면에 반영 `[e2e]` (①)
- **사전조건**: A 로 로그인. `TRK-PRIV-B` 를 **화면에서 만날 수 있는 지점**(예: 직접 URL `/player`?)이 없다면, 이 케이스는 `AddToPlaylistModal` 의 **정상 경로만** 수행하고 400 경로는 §V196-API-01 로 대체한다(**대체 시 `BLOCKED` 가 아니라 `PARTIAL` 로 기록**).
- **Given** 임의 곡의 "재생목록에 저장" 버튼 클릭 → 모달 오픈, **When**
  ① 공개 곡을 기존 재생목록에 추가 → **성공 메시지**
  ② 같은 곡 재추가 → **`이미 추가된 곡입니다`**(409 분기, `AddToPlaylistModal.jsx:36`)
  ③ (가능한 경우) 타인 비공개 곡 추가 → **`추가에 실패했습니다`**(`:38` 일반 400 분기)
  **Then** 모달이 닫히거나 메시지가 뜨고 **Console 에러 0건**.
- **기대결과**: ③ 의 화면 문구는 **일반 문구**다 — 서버의 `"다른 사용자의 비공개 곡은 사용할 수 없습니다."` 는 **Network 응답 본문에서만** 확인한다(프론트가 400 을 세분화하지 않음). 문구가 다르다고 FAIL 로 판정하지 말 것.
- **확인할 로그 라인**: DEV 콘솔 `[SongItem] openAddToPlaylist {track: <id>}` / 서버 `[playlists] add_track private_denied ...`(③ 수행 시)
- **PASS/FAIL**: ①② 정상 + Console 에러 0 → PASS(③ 미수행 시 PARTIAL).
- **실패 시 의심**: `frontend/src/components/AddToPlaylistModal.jsx:31~38`.

#### V196-E2E-07. ⑤ DM 읽음표시·헤더 뱃지·다른 탭 동기화 **불변** `[e2e]` (R12, v195 회귀)
- **사전조건**: 브라우저 프로필 2개(또는 시크릿 창) — A 창 2개(탭1·탭2), B 창 1개. A·B accepted 대화. B 가 A 에게 메시지 2건 전송(A 미읽음 2).
- **Given** A 헤더 뱃지에 미읽음이 표시된 상태, **When** A 탭1 에서 해당 대화를 연다, **Then**
  ① A 헤더 뱃지가 **감소**(`Header.jsx` `onUnread` → `refreshUnread()`)
  ② A **탭2** 의 뱃지도 동기화되어 감소(다른 탭 동기화 — v195 계약)
  ③ **B 화면**의 자기 발신 메시지에 **읽음표시가 켜진다**(peer `read` 이벤트 — `modified_count>0` 이므로 **반드시 발행**되어야 함, R12)
  ④ B 의 대화 목록에서 해당 대화가 정상 갱신
- **기대결과**: 4항 전부. **③ 이 실패하면 R12 회귀** — 가드 조건이 과하게 좁아 실제 읽음도 안 알린 것.
- **확인할 로그 라인**: `[dm] mark_read peer-read published conv=%s me=%s marked=2` + `[dm] mark_read self-unread published conv=%s me=%s prev_unread=2 marked=2`
- **PASS/FAIL**: 4항 전부 → PASS. ③ 실패 → **FAIL(R12)**.
- **실패 시 의심**: `dm_service.py:610~620`, `frontend/src/utils/dmSocket.js`, `components/Header.jsx:201~210`, `pages/DmInboxPage.jsx:443`.

#### V196-E2E-08. ⑤ 효과 발현 — **읽을 것이 0일 때 peer 의 헛 요청이 사라짐** `[e2e]` (⑤ 본체)
- **사전조건**: V196-E2E-07 직후 상태(A 가 이미 다 읽음). **B 창의 DevTools Network 를 열고 필터 `unread-count`**, 요청 카운터를 0 으로 리셋.
- **Given** 더 이상 읽을 메시지가 없는 대화, **When** **A 가 같은 대화를 3회 반복 클릭/재진입**한다(`DmInboxPage:385` 가 활성 대화 수신마다 `markDmRead` 호출 → `POST /api/dm/conversations/<cid>/read` 가 3회 발사됨), **Then**
  ① A 측 `POST .../read` 는 **3회 200**(멱등, 스키마 `{conversation_id,read,marked:0}`)
  ② **B 창의 `GET /api/dm/unread-count` 추가 요청이 0건** — 수정 전에는 A 의 클릭 1회마다 B 가 1회씩 쐈다
  ③ B 화면에 **변화가 없다**(읽음표시·목록·뱃지 모두 그대로 — 원래도 화면 오동작은 없었으므로 **불변이 정상**)
  ④ A 자신의 화면도 변화 없음
- **기대결과**: 4항 전부. ② 가 이 결함 수정의 **유일한 관측 가능한 효과**다.
- **확인할 로그 라인**: `[dm] mark_read peer-read skipped (nothing marked) conv=%s me=%s` **3줄** + `[dm] mark_read self-unread skipped (nothing to clear) conv=%s me=%s` 3줄 (첫 진입이 아니므로 `prev_unread=0`)
- **PASS/FAIL**: ②가 0건 + skipped 로그 → PASS. B 가 `unread-count` 를 쏘면 → **FAIL(가드 미작동)**. ③에서 B 의 읽음표시가 **꺼지면** FAIL(peer 미발행이 기존 표시를 되돌리는 부작용 — 설계상 발생하면 안 됨).
- **실패 시 의심**: `dm_service.py:610~620`, `frontend/src/components/Header.jsx:210`(`onRead` → `refreshUnread`), `pages/DmInboxPage.jsx:443`.

---

### 4. 커버리지 매핑 (PLAN §5 회귀 위험 → 시나리오)

| 위험 | 시나리오 |
|---|---|
| **R1** 화이트리스트로 프론트 깨짐 | V196-UNIT-05·06·08 / V196-API-03·04·16 / **V196-E2E-01·02·03** |
| **R2** 🔴 레거시 문서 오차단 | **V196-UNIT-01**(즉시중단) · UNIT-03 · **V196-API-09**(즉시중단) |
| **R3** 본인 비공개 곡 소실 | V196-UNIT-04 / V196-API-03·09 / **V196-E2E-05** |
| **R4** `report_blinded` 동시 차단 | V196-UNIT-02 / V196-API-01·02·03 |
| **R5** 앱팀 계약 변경(제거 필드) | V196-UNIT-05·06 (제거 키 목록을 REPORT 에 명시하도록 산출) |
| **R5a** 🔴 공개 곡 무인증 파손 | **V196-API-08**(즉시중단) · API-17 |
| **R5b** lyrics 광역 except | **V196-API-07** |
| **R5c** download 차트 오염 | **V196-API-05** |
| **R6** 🔴 v191 트리 계약 파손 | **V196-UNIT-11**(즉시중단) · UNIT-13 · **V196-API-10**(즉시중단) · API-15 |
| **R7** 답글 알림 과교정 | **V196-API-11** |
| **R8** 중복 알림 부활 | **V196-API-12** · UNIT-13 |
| **R9** 🔴 알림 오삭제 | **V196-UNIT-19**(정적) · **V196-API-14**(즉시중단) |
| **R10** 삭제 실패가 피드 삭제를 깨뜨림 | **V196-UNIT-18** |
| **R11** 인덱스 부재 지연 | 시나리오 없음 — **범위 밖**(§6-3). 다만 V196-API-13·14 수행 시 `DELETE /api/feeds/{id}` 응답 시간을 기록해 REPORT 에 남긴다 |
| **R12** 읽음표시 회귀 | **V196-UNIT-15** · **V196-E2E-07** |
| **R13** ⑤ 가드 조건 오작성 | **V196-UNIT-16** |
| **R14** v195 테스트 충돌 | **§0-D supersede 표** (UNIT-14·15 가 대체) |
| **R15** 관리자 CS 부작용 | **V196-API-17** |
| **R16** ② 실런타임 오손 | **V196-UNIT-09** |
| **R17** ② 이력 산출물 훼손 | **V196-UNIT-10** |
| **R18** 신규 로그 정보 노출 | **V196-UNIT-21** · API-16(길이 로깅 확인) |

**의도적 커버리지 공백**(PLAN §6 범위 밖 — 시나리오를 두지 않는다):
`upload.py` 커버 이미지 IDOR(쓰기) / `notifications` 스키마 `comment_id` 추가·인덱스 / `albums.py`·`reports.py`·`feeds.py` LOW 3건 / 알림 UI 신설 / `backendAPI정리.md` `:3,:6,:8,:4782` 헤더 정정(승인 대기) / **9004·9005 미러 검증**.
다만 **V196-UNIT-20** 이 "범위 밖 파일에 변경이 없음"을 **역방향으로 감시**하고, **V196-API-15** 가 "댓글 개별 삭제 시 알림을 건드리지 않음"을 감시한다.

---

### 5. planner 승인 필요 항목

| # | 항목 | 사유 | 승인 없이 진행 시 대안 |
|---|---|---|---|
| **A1** | **V196-API-08 의 MV 200 확인을 실 MV 보유 공개 곡으로 수행** | 실사용자 트랙 열람이 필요. MV 를 새로 만드는 것은 **유료 API 라 절대 금지**(§0-1) | 승인 없이는 **404 본문 구분**(`뮤직비디오를 찾을 수 없습니다.` vs `트랙을 찾을 수 없습니다.`)으로만 판정 — 현재 설계 기본값. R5a 는 이것으로 충분히 감시된다 |
| **A2** | 🔴 **`backendAPI정리.md` `:3,:6,:8,:4782→:4788` 헤더·접속표 정정 — 이미 실행됨(사후 승인 필요)** | PLAN §3-② 와 §6-9 는 이 4곳을 "**승인 전 착수 금지**"로 유보했으나, 착지 실측 결과 **이미 9006 으로 정정되어 있다**. 정정 내용 자체는 사실 관계상 옳다(9006 단일 백엔드 전환 완료) | tester 는 이를 **FAIL 이 아니라 `OBSERVED`** 로 기록한다(V196-UNIT-10). planner 가 ① 사후 승인하거나 ② 되돌릴지 결정해야 하며, 되돌리는 경우 `:3,:6,:8` 이 **사실과 다른 9005 안내로 회귀**한다는 점을 함께 고려한다. 총량 기대치는 **18 로 확정**(승인 여부와 무관 — 정정된 4곳도 "9005 미러 폐기" 설명 문구로 9005 를 여전히 포함) |
| **A3** | **PG `playlist_tracks`·`likes` 직접 INSERT**(V196-API-03·04 의 사전조건) | 가드 착지 후에는 API 로 숨김 곡을 담을 수 없으므로 **DB 직접 쓰기**가 불가피. 테스트 계정 소유 재생목록 한정이고 `v196t` 마커 + 종료 시 삭제 | 미승인 시 **가드 착지 *전*에 API 로 담아두고**(현 결함 상태에서는 201 이 된다) 착지 후 조회만 수행 — 순서 제약이 생기므로 tester 일정에 반영 필요 |
| **A4** | **V196-UNIT-18 의 Mongo 예외 주입** | 목킹 더블 한정이라 실 DB 무영향이나, 주입 코드가 실수로 프로덕션 모듈을 패치하면 위험 | 미승인 시 `try/except` 존재만 **정적 확인**으로 대체(`SKIP(정적)`) — R10 커버리지가 약해짐을 REPORT 에 명시 |
| **A5** | **V196-API-13·14 의 피드 삭제 실행** | 되돌릴 수 없는 삭제(쓰기). 단 **테스트 계정 C 가 이번에 만든 `v196t` 피드 한정** | 승인 불필요 판단이지만, 실사용자 피드를 대상으로 삼는 순간 **즉시 중단**. 대상 선정 결과를 REPORT 에 피드 id 8자로 기록 |
| **A6** | **V196-E2E-06 의 ③ 분기**(타인 비공개 곡을 화면에서 만나는 경로) | 웹 UI 에 타인 비공개 곡이 노출되는 지점이 원래 없어야 정상 — 재현 경로 자체가 없을 가능성 | 없으면 `PARTIAL` 로 기록하고 400 경로는 V196-API-01 로 대체(이미 설계에 반영) |

**승인 없이도 진행 가능**: `[unit]` 21건 중 20건(A4 제외), `[api]` 17건 중 15건(A1·A3 조건부), `[e2e]` 8건 중 7건(A6 조건부) = **42건**.

---

### 6. v196 시나리오 집계

| 태그 | 건수 | 비율 | 요구 | 판정 |
|---|---|---|---|---|
| `[unit]` | **21** | **45.7%** | ≥ 40% | ✅ 충족 |
| `[api]` | **17** | **37.0%** | ≥ 35% | ✅ 충족 |
| `[e2e]` | **8** | **17.4%** | ≤ 25% | ✅ 충족 |
| **합계** | **46** | 100% | — | — |

**결함별 배분**

| 결함 | unit | api | e2e | 계 |
|---|---|---|---|---|
| ① 비공개 곡 유출 (playlists·likes·tracks) | 8 (UNIT-01~08) | 9 (API-01~09) | 4 (E2E-01·04·05·06) | **21** |
| ② 콜백 주소 | 2 (UNIT-09·10) | 0 | 0 | **2** |
| ③ 답글 알림 | 3 (UNIT-11~13) | 3 (API-10~12) | 0 | **6** |
| ④ 피드 삭제 알림 정리 | 2 (UNIT-18·19) | 3 (API-13~15) | 0 | **5** |
| ⑤ DM peer read | 4 (UNIT-14~17) | 0 | 2 (E2E-07·08) | **6** |
| 회귀·위생 공통 | 2 (UNIT-20·21) | 2 (API-16·17) | 2 (E2E-02·03) | **6** |

- **승인 대기로 인한 최대 제외 시 비율**: A1·A3·A4·A6 이 전부 미승인이어도 케이스는 **대체 절차로 수행**되며 **삭제되지 않는다**(A1→404 본문 구분, A3→순서 조정, A4→정적 확인, A6→PARTIAL). 따라서 **46건·45.7/37.0/17.4 비율은 승인 결과와 무관하게 유지**된다. v195 처럼 SKIP 으로 비율이 깨질 위험이 없다.
- **쓰기 총량**: Mongo `tracks` 픽스처 5건(직접 삽입) · PG `playlists` 3~4건 + `playlist_tracks` 다수 + `likes` 다수 · Mongo `feeds` 6건(F~F6) + `feed_comments` 다수 + `notifications` 다수(부수 발생) · 테스트 계정 간 DM 메시지 수 건 + pending 1건 · 피드 삭제 1건(A5). **전부 `v196t` 마커 + §0-C 카운트 대조로 회수.**
  **유료 API 호출 0건** · `POST /api/tracks/upload` 0건 · `GET /api/tracks/search` 0건 · 별 차감 0건 · 전체발송 0건 · 인덱스 조작 0 · 컨테이너/포트/MinIO/ES 조작 0 · `backend_9004`·`backend_9005` 접근 0(읽기조차 불요) · 실사용자 데이터 **열람만**.
- **즉시 중단 조건**: §0-E 의 S1~S8. 감시 케이스는 V196-UNIT-01·05·06·11·19·21 / V196-API-03·04·08·10·14 / 전 항목의 유료 경로 상시 감시.
- **v195 승계 처리**: `RT-UNIT-03`·`RT-UNIT-04` **supersede**(→ V196-UNIT-15·14), `RT-UNIT-19`·`RT-API-16`(9004 미러) **미승계**. `RT-UNIT-05`(prev_unread>0 → 본인 발행)는 **유효 유지**하며 V196-UNIT-16 이 그 경계를 v196 기준으로 재확인한다.
- **구현 착지 상태(작성 완료 시점 재실측)**: 7개 대상 **전부 착지**. 라인 참조는 착지 후 값으로 갱신했으며, tester 는 **심볼명(함수/상수 이름)을 1차 앵커**로 삼고 라인은 보조 참조로만 사용한다. 착지 후 라인이 다시 이동해도 시나리오는 유효하다.
- **착지분 사전 정적 대조 결과(설계 ↔ 구현 일치 확인)** — 아래 5개 앵커가 설계대로 들어간 것을 **정적으로만** 확인했다(테스트 실행 아님). 시나리오는 그대로 유효하다.
  | 앵커 | 실측 | 대응 시나리오 |
  |---|---|---|
  | `dm_service.py:610` | `if peer_id and result.modified_count > 0:` — **`prev_unread` 혼입 없음** | V196-UNIT-14·15·16 (R13) |
  | `feeds.py:770` | `reply_target_author_id = parent.get("author_id")` 가 평탄화(`:771~772`) **앞** | V196-UNIT-13 (R6) |
  | `feeds.py:797~807` | 알림 분기에서 구 `feed_comments.find_one` **제거됨**, 비교 우변 `doc.get("author_id")` 유지 | V196-UNIT-13, V196-API-12 (R8) |
  | `tracks.py:772`·`:809` | MV·가사 타임라인에 **`get_current_user_optional`** — 필수 인증 아님 | V196-API-08 (R5a) |
  | `tracks.py:1741`·`:1757` | `download_track` 는 **`get_current_user`(필수) 유지** + `download_denied` 가 Redis 집계 **앞** | V196-API-05 (R5c) |
  ⚠️ 위는 **정적 대조일 뿐 PASS 판정이 아니다.** 동작 검증은 tester 가 §0-B 재기동 후 각 케이스를 실행해 판정한다.
- **🔴 planner 확인 필요(사후)**: PLAN §6-9 가 승인 전 착수를 금지한 `backendAPI정리.md` `:3,:6,:8,:4782→:4788` 이 **이미 정정되어 있다**. §5 A2 참조 — tester 는 `OBSERVED` 로 기록하고 FAIL 로 판정하지 않는다.

## 개정 이력 (v196)

- 2026-08-20 초판 작성 (46건) — PLAN v196 §2 실측·§3 수정 설계·§4 변경 매트릭스·§5 R1~R18 전 항목 시나리오화.
  최대 위험인 **① 비공개 곡 유출**에 21건(45.7%)을 집중 배치하고, 그중 **금지 키 존재 자체를 assert** 하는 케이스를 unit(UNIT-05·06)·api(API-03·04) **4중**으로 두었다.
  두 번째 함정인 **R2 레거시 오차단**은 UNIT-01(정적+동적)·UNIT-03(동치)·API-09(7행 매트릭스) **3중**으로 감시하며 전부 즉시 중단 조건(S2)에 연결했다.
  **R5b**(광역 except 가 404 를 삼킴)는 "200 `{has_timestamps:false}` 이면 FAIL" 을 명문화해 오판을 차단했고, **R5a**(공개 곡 무인증 200 유지)는 유료 MV 생성 없이 **404 본문 문자열 구분**으로 검증하도록 설계해 §0-1 을 위반하지 않는다.
  **⑤** 는 v195 `RT-UNIT-03`·`RT-UNIT-04` 를 §0-D 표로 명시 supersede 하고(미처리 시 정상 동작을 FAIL 판정), `RT-UNIT-05` 경계와의 차이를 **UNIT-16 단독 케이스**로 분리했다.
  **미러링 검증 0건** — 백엔드는 `backend_9006` 하나뿐이며, UNIT-20 이 9004·9005 무접촉을 역방향 감시한다.
  테스트 트랙은 **업로드 API 를 쓰지 않고 Mongo 직접 삽입**(§0-A)하며, `audio_url` 은 존재하지 않는 더미 키를 넣어 만일의 유출 시에도 재생 불가하도록 했다.
  `--reload` 부재에 대응해 **§0-B 재기동 선행 절차**를 두고, 이를 기록하지 않은 `[api]` 결과는 무효로 규정했다.
  태그 균형은 정적 grep·순수 함수 호출을 unit 으로, 화면 발현을 e2e 로 배치해 **45.7 / 37.0 / 17.4** 확보. planner 승인 대기 6건(§5) — 전부 **대체 절차가 있어 비율이 깨지지 않는다**. planner 검토 후 확정 예정.

---

## v197 — 2026-08-21 — 커버 이미지 저장 실패 + 소유권 미검사 수정

팀: MAIDOL-CoverFixSquad / test-designer 작성 (**설계 산출물 — 본 문서는 실행하지 않는다. 실행은 tester 담당**)
근거: PLAN.md v197 §2 실측(①`type=track`↔`cover|profile` 불일치 400 + 프론트 `.catch(()=>{})` 삼킴 / ②커버 변경 소유권 미검사 / ③`/upload/mv-status` 인가 부재 / ④커버 변경 후 Redis 캐시 미무효화 / ⑤`type=profile` 레거시 중복 경로), §3 수정 설계, §4 변경 매트릭스 A1~A6·F1, §5 회귀 위험 R1~R11, §6 범위 밖, §7 절대 준수
BASE_REV: **b1f05cd**(메인 체크아웃, branch `backend`) + 워킹트리 v197 구현분(**작성 시점 기준 A1~A6·F1 7개 대상 전부 착지** — 아래 앵커표는 착지 후 재실측값)

**⚠️ 작업 위치**: 모든 검증은 **메인 체크아웃** `/mnt/d/1_projects/0_myProjects/1_tripleJ` 기준.
세션 워크트리 `0_platform_music/.claude/worktrees/e2e-test-search-cs-admin-1db925` 는 **구 커밋 `c4d160e`** 이며 **`backend_9006` 이 존재하지 않는다**. 워크트리 안의 `0_platform_music/` 을 열람·검증 대상으로 삼으면 9006 이전의 낡은 파일을 보게 된다 — 금지.

### 💰 예상 유료 호출 횟수 (착수 전 planner 고지 — 초과 시 즉시 중단)

| 경로 | 예상 | 상한 | 소비 케이스 |
|---|---|---|---|
| `POST /api/tracks/upload` (내부 gpt-4o-mini 키워드 + 임베딩, 회당 약 0.2원) | **1회** | **2회** | **V197-E2E-01 1회**. 나머지 1회는 **E2E-01 실패 시 재시도 여유** 전용 |
| `GET /api/tracks/search` | **0회** | 0회 | 없음 |
| `/api/generate`·`/api/mv/**`·`/api/character`·`/api/voice-*`·`/upload/generate-cover`·`/upload/refine-cover` | **0회** | **0회 (금지)** | **어떤 케이스에도 등장하지 않음** |
| 별 차감(`POINT_COSTS`) | **0회** | 0회 | 없음 |
| `POST /api/admin/cs/broadcast` 200 | **0회** | 0회 | 없음 |

> **V197-E2E-03 은 `/api/tracks/upload` 를 소비하지 않는다.** 브라우저 네트워크 인터셉트로 `POST /api/tracks/upload` 를 합성 200 으로 대체하기 때문이다(§E2E-03 사전조건). 이 설계 덕에 상한 2회 중 **1회가 재시도 예비로 온전히 남는다.**

**대상 파일 (착지 후 실측 — *심볼명이 1차 앵커*, 라인은 보조. A1~A6 삽입으로 `upload.py` 라인이 전부 밀렸다)**

| # | 파일 | 착지 후 실측 앵커 |
|---|---|---|
| A1 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `ALLOWED_UPLOAD_IMAGE_TYPES`(`:89`), `DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES`(`:90`), **`_normalize_upload_image_type`**(`:93`, `_normalize_vocal_gender` 아래) |
| A2 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `upload_image`(`:128`) 진입부 `norm_type, used_alias = _normalize_upload_image_type(type)`(`:136`), `type_invalid` 로그(`:139`), **400 본문·코드 불변**(`:142`), `type_alias_deprecated` 로그(`:144`) |
| A3 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `if norm_type == "cover":`(`:161`) 분기, **`put_object` 이전** `find_one({"uploader_id":1})`(`:169`) → 404(`:172`) → 403(`:175`) |
| A4 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `result = await mongo.tracks.update_one(...)`(`:189`), `try: get_redis(); delete("cache:track:{id}"); delete("cache:track:v3:{id}") except: warning`(`:196~202`), `cover_ok … matched=%d`(`:203`) |
| A5 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `else:`(profile) 분기 진입 `profile_legacy_route` 로그(`:212`). **그 아래 동작 무변경** |
| A6 | `backend_9006/app/routes/upload.py` | ✅ 착지 — `mv_status`(`:895`), `find_one`(`:908`) 직후 403 가드(`:917~919`) |
| F1 | `frontend/src/pages/UploadPage.jsx` | ✅ 착지 — `handleSubmit`(`:1490`) 커버 블록(`:1563~1574`): `append('type','cover')`(`:1566`), `try { await api.uploadImage(...) } catch`(`:1568~1574`), `console.error('[UploadPage] cover image upload failed', …)`(`:1571`), `setError('곡은 업로드되었지만 …')`(`:1572`), `return;`(`:1573`). **`finally { setUploading(false); }`(`:1587`) 무변경 — R6 재활성 보장** |
| 참조 | `frontend/src/api/index.js:299` `uploadImage` | **무변경** — 회귀 검증 대상 |
| 참조 | `backend_9006/app/routes/tracks.py:43`(`cover_image` 매핑)·`:1183`/`:1298`(`cache:track:v3:` 읽기/`setex 600`)·`:1656`(AI 커버 쓰기) | **무변경** — 회귀 검증 대상 |
| 참조 | `backend_9006/app/routes/mv.py` | **무변경** — RT-07 diff 감시 대상 |
| 참조 | `frontend_admin/**` | **무변경** — `/upload/image` 호출 0건(PLAN §2-1 실측). RT-08 스모크 |
| 참조 | `backend_9004`·`backend_9005` | **무변경 · 무접촉** — 미러링 폐기(PLAN §0-2). 🚫 검증 항목 없음 |

---

### 0. 전제 및 안전 규칙 (최우선 — 위반 시 해당 항목 자체를 폐기)

1. 🚫 **유료 외부 API 전면 금지** — `/api/generate`·`/api/mv/**`·`/api/character`·`/api/voice-*`·`/upload/generate-cover`·`/upload/refine-cover`. **본 문서 어디에도 이 경로가 등장하지 않으며**, tester 는 이를 호출하는 어떤 대체 절차도 만들지 않는다.
2. **`POST /api/tracks/upload` 예산 = 최대 2회.** 실사용 흐름 1회(E2E-01) + 재시도 여유 1회. 3회째는 **즉시 중단(S2)**.
3. 🚫 **`GET /api/tracks/search` 남용 금지**(유료 호출 유발). 본 문서 사용 0회.
4. **`[unit]`·`[api]` 픽스처는 전부 `mongo.tracks` 직접 삽입**(v196 §0-A 관행 승계). `/upload/image` 는 `uploader_id` 만 읽고 `cover_image_url` 만 쓰므로 직접 삽입 문서로 **완전히 검증된다** — 업로드 API 로 픽스처를 만들 이유가 없다.
5. 🚫 **별 차감 금지.** 🚫 `POST /api/admin/cs/broadcast` 를 어떤 항목에서도 200 으로 성립시키지 않는다.
6. **실사용자 데이터 무접촉.** 소유권 증명은 **테스트 계정 A·B 소유의 `v197t` 트랙 사이에서만** 수행한다. 실사용자 트랙은 **조회도 하지 않는다** — 유일한 예외는 RT-06 의 **집계 카운트 1회**(문서 본문을 읽지 않고 `count_documents` 만).
7. **테스트 데이터 마커**: 트랙 `title` 접두 **`v197t-`**, `mv_jobs` 는 `result_video_url` 접두 `v197t/`. 종료 시 삭제 후 §0-C 카운트 대조.
8. **개인정보 위생**: 생년월일·성별·이메일·파일명 원문을 응답·화면·로그·본 문서·REPORT 에 옮겨 적지 않는다. 크리덴셜은 전부 플레이스홀더 — `<TEST_USER_A_TOKEN>`, `<TEST_USER_B_TOKEN>`, `<A>`(계정 A uuid), `<B>`(계정 B uuid), `<MONGO_URI>`, `<PG_DSN>`, `<MINIO_KEY>`.
9. **백엔드 `[unit]` 실행 방식**: 9006 파이썬 환경에서 `app.routes.upload` 를 import 해 **대상 함수를 직접 호출**하고 `get_mongo`/`get_minio`/`get_redis` 만 **모듈 네임스페이스 스텁**으로 대체한다.
   🚫 **가드 자체를 몽키패치·주석처리·우회해 통과시키지 않는다 — 그런 테스트는 그 자체가 FAIL.** 스텁은 인프라 접근점(`get_*`)에만 허용되며, `_normalize_upload_image_type`·소유권 `if` 문·`try/except` 블록은 **원본 그대로** 실행되어야 한다.
   임시 테스트 파일은 **사용 후 삭제**(`git status --short` 로 untracked 0건 확인).
10. **서버에 `--reload` 가 없다.** 각 `[api]` 블록 착수 전 §0-B 를 수행하고 **그 기록을 REPORT 에 남긴다.** 기록 없는 `[api]` 결과는 **무효**이며 재실행 대상이다.
11. 🚫 **미러링 검증 항목 없음.** `backend_9004`·`backend_9005` 는 읽기 전용 참고 폴더이며 본 문서의 어떤 케이스도 두 폴더에 접근하지 않는다(읽기조차 불요).
12. **인프라 무조작**: docker-compose·포트·바인딩·MinIO·Redis·ES 설정 조작 금지. Mongo/PG **인덱스 생성·삭제 금지**.
13. 기준 URL: 백엔드 `http://localhost:9006`, 사용자 앱 `http://localhost:4000`, 관리자 앱 `http://localhost:4001`. MinIO 버킷: 커버 = **`aimu-images`**.

#### 0-A. 픽스처 준비 — `mongo.tracks` / `mongo.mv_jobs` 직접 삽입 (업로드 API 미사용)

> 삽입은 9006 파이썬 환경의 motor 스크립트로 수행하고 **스크립트는 사용 후 삭제**한다.
> 모든 트랙은 `is_public: True`, `created_at`/`updated_at` 현재시각, `uploader_nickname: "v197t"` 를 함께 넣는다(상세 조회 경로가 `_is_hidden_track` 에서 걸리지 않게).

| 이름 | 컬렉션 | uploader_id | 핵심 필드 | 용도 |
|---|---|---|---|---|
| **`TRK-A`** | `tracks` | **`<A>`** | `title:"v197t-a"`, **`cover_image_url` 키 없음** | API-01·02·06 본체 (저장 성공 + 캐시 무효화) |
| **`TRK-B`** | `tracks` | **`<B>`** | `title:"v197t-b"`, `cover_image_url:"covers/<B>/v197t-b-original.jpg"` | 🔴 API-03 교체 시도 대상 (무변경 단언) |
| **`TRK-NOOWNER`** | `tracks` | **(키 자체 없음)** | `title:"v197t-noowner"` | RT-06 레거시 회귀(R3) |
| **`TRK-GONE`** | — | — | **삽입하지 않는다.** 유효한 형식의 ObjectId 문자열만 준비 | API-04 404 판정 |
| **`TRK-AICOVER`** | `tracks` | `<A>` | `title:"v197t-aicover"`, `cover_image_url` = **E2E-01 이 만든 실존 객체 키**(`covers/<A>/<TRK-A>.jpg`) | E2E-04 AI 커버 렌더 회귀 |
| **`MVJOB-B`** | `mv_jobs` | `user_id:"<B>"` | `status:"completed"`, `progress:100`, `total_scenes:2`, `completed_scenes:2`, `scene_thumbnails:["v197t/nonexistent-thumb-1.jpg","v197t/nonexistent-thumb-2.jpg"]`, **`result_video_url:"v197t/nonexistent.mp4"`** | 🔴 API-07 A6 가드 |

- **`v197t/nonexistent.mp4`·`v197t/nonexistent-thumb-*.jpg` 는 MinIO 에 실제로 존재하지 않는 더미 키**다. presign/proxy URL 생성은 객체 존재를 검증하지 않으므로 200 경로 판정에는 영향이 없고, **만에 하나 URL 이 유출돼도 재생 가능한 실파일이 아니다**(v196 §0-A 관행 승계 — 2차 피해 차단).
- `TRK-B.cover_image_url` 은 **B 폴더 아래의, 역시 존재하지 않는 더미 키**다. API-03 의 단언 대상은 "이 문자열이 그대로 남아 있는가" 이므로 실파일이 필요 없다.
- **`TRK-AICOVER` 는 E2E-01 이후에 삽입한다**(실존 객체 키를 재사용하기 위함). `/upload/generate-cover` 는 **호출하지 않는다**.
- 픽스처 트랙의 `_id` 8자 절단값을 REPORT 에 기록해 두면 로그 대조가 쉬워진다(전체 id 는 기록하지 않아도 무방).

#### 0-B. 각 `[api]` 블록 선행 절차 (`--reload` 부재 대응 — 생략 시 해당 블록 전 결과 무효)

1. `cd /mnt/d/1_projects/0_myProjects/1_tripleJ && git status --short` → **A1~A6 착지 확인**(`0_platform_music/backend_9006/app/routes/upload.py` 가 `M` 로 보일 것). 출력을 REPORT 에 붙인다.
2. 서버 재기동: `cd /mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music/backend_9006 && setsid ./run.sh > /dev/null 2>&1 &`
3. 재기동 확인: **`GET http://localhost:9006/api/health` → 200**(`app/main.py:657`) **AND** `server.log` 의 **startup 타임스탬프가 2번 실행 시각 이후**임을 확인. 두 조건을 **둘 다** 기록한다.
4. 스모크: `GET /api/tracks/{TRK-A}` 200(`<TEST_USER_A_TOKEN>`) — 픽스처 가시성 확인.
5. **위 4단계 기록 없이 판정된 `[api]` 케이스는 무효로 간주하고 재실행한다.**

#### 0-C. 종료 시 정리 및 카운트 대조 (필수)

착수 **전** / 종료 **후** 두 시점에 아래를 집계해 **차이 0** 을 확인한다. 차이가 남으면 잔여 항목을 **지목 삭제**하고 **재대조**한다.

| 대상 | 집계 |
|---|---|
| `mongo.tracks` | 전체 `count_documents({})` **+** `count_documents({"title": {"$regex": "^v197t-"}})` |
| `mongo.mv_jobs` | 전체 `count_documents({})` |
| MinIO `aimu-images` — `covers/<A>/` | `v197t` 관련 객체 키 목록(= 픽스처 트랙 id 를 파일명으로 갖는 객체 + E2E-01 산출물) |
| MinIO `aimu-images` — `covers/<B>/` | 동일. **API-03 성공 시 이 목록은 착수 전과 완전히 동일해야 한다** |
| MinIO `aimu-images` — `profiles/<A>.*` | RT-04(§API-02 부속)·E2E-05 수행 시에만. **수행 전 기존 객체 유무·PG `users.profile_image` 원래 값을 기록해 두고 종료 시 원복** |
| Redis | `cache:track:v3:<TRK-A>`·`cache:track:<TRK-A>` 잔여 키 (API-06 전용, 종료 시 삭제) |

- **삭제 순서**: ① `mongo.tracks` 의 `^v197t-` 문서 → ② `mongo.mv_jobs` 의 `result_video_url` 접두 `v197t/` 문서 → ③ MinIO `covers/<A>/`·`covers/<B>/` 의 v197t 객체 → ④ Redis 잔여 캐시 키 → ⑤ PG `users.profile_image` 원복(수행했다면).
- **실사용자 데이터는 어떤 삭제 대상에도 포함되지 않는다.** 삭제 필터는 전부 `v197t` 마커 기반이며, 실행 전 `find` 로 **대상 건수와 title 목록을 먼저 출력해 눈으로 확인**한 뒤 `delete_many` 를 돌린다.

---

### 0-D. 🛑 즉시 중단 조건 (하나라도 발생 → 이후 항목 진행 금지, planner 즉시 보고)

| # | 조건 | 감시 케이스 |
|---|---|---|
| **S1** | 🔴 **가드 우회로 통과시킴** — `[unit]` 에서 `_normalize_upload_image_type`·소유권 `if`·`try/except` 를 몽키패치/주석처리/치환해 PASS 를 만든 정황. **통과했다는 사실 자체가 FAIL** | V197-UNIT-06·07·08 (§0-9) |
| **S2** | 🔴 **유료 API 가 1회라도 호출됨** — `/api/generate`·`/api/mv/**`·`/api/character`·`/api/voice-*`·`/upload/generate-cover`·`/upload/refine-cover` 접근 로그 발견, **또는 `POST /api/tracks/upload` 가 3회째 호출됨** | 전 항목 (server.log 상시 감시) |
| **S3** | 🔴 **실사용자 트랙이 변조됨** — `v197t` 마커가 없는 `tracks` 문서의 `cover_image_url` 이 변경되거나 삭제됨 | 전 항목 (§0-C 전체 카운트 + API-03) |
| **S4** | 🔴 **소유권 가드가 뚫림** — A 토큰으로 `TRK-B` 에 대해 201 이 반환되거나, `TRK-B.cover_image_url` 이 바뀌거나, **`covers/<A>/<TRK-B>.*` 객체가 MinIO 에 생김** | **V197-API-03** |
| **S5** | 🔴 **`/upload/mv-status` 가 타인에게 `result_video_url`·`scene_thumbnails` 를 반환** | **V197-API-07** |
| **S6** | **Redis 장애가 커버 업로드를 500 으로 바꿈**(R4) — `cache_invalidate_failed` 경로에서 예외가 밖으로 새어나옴 | **V197-UNIT-06** |
| **S7** | 개인정보(생년월일·성별·이메일)·파일명 원문·크리덴셜 실값이 응답·로그·콘솔·산출물에 노출 | 전 항목 |
| **S8** | 별 차감 발생 또는 `POST /api/admin/cs/broadcast` 가 200 반환 | 전 항목 |

---

### 1. `[unit]` 시나리오 — 8건

> 실행: 9006 파이썬 환경에서 `import app.routes.upload as U`. **DB·서버 불필요.**
> 공통 스텁(UNIT-06·07·08): `U.get_mongo`/`U.get_minio`/`U.get_redis` 만 페이크로 교체하고 **원복**한다. 페이크 업로드 파일은 `class FakeUpload: filename="v197t-cover.jpg"; async def read(self): return b"\x00"*16` 형태.
> ⚠️ `upload_image` 를 직접 호출하면 **FastAPI 데코레이터의 `status_code=201` 은 적용되지 않는다** — 성공 시 반환값은 **평문 `dict`**, 실패 시 **`JSONResponse`** 다. "201" 자체의 단언은 `[api]` 층(§API-01)에서 한다. `[unit]` 은 **"dict 반환 + 키 존재"** 로 판정한다(이 구분을 혼동해 FAIL 판정하지 말 것).

#### V197-UNIT-01. `_normalize_upload_image_type("cover")` → `("cover", False)` `[unit]` (A1)
- **사전조건**: `from app.routes.upload import _normalize_upload_image_type as N`.
- **Given** 정식 값 `"cover"`, **When** `N("cover")` 를 호출하면, **Then** 반환값이 **정확히 튜플 `("cover", False)`** 이다.
- **기대결과**: `("cover", False)`. 두 번째 원소가 `True` 면 정식 값이 별칭으로 오분류된 것이고, A2 가 매 요청 `type_alias_deprecated` 로그를 쏟아 **계측이 무의미해진다**(R10 악화).
- **확인할 로그 라인**: 없음(순수 함수). 대신 정적으로 `ALLOWED_UPLOAD_IMAGE_TYPES == {"cover","profile"}` 임을 확인.
- **PASS/FAIL**: 튜플 동치 → PASS. 문자열만 반환하거나 `True` → FAIL.
- **실패 시 의심**: `upload.py` `_normalize_upload_image_type`(`:93`), `ALLOWED_UPLOAD_IMAGE_TYPES`(`:89`).

#### V197-UNIT-02. `_normalize_upload_image_type("profile")` → `("profile", False)` `[unit]` — **RT-04 1차 감시** (A1, R-A2)
- **사전조건**: UNIT-01 과 동일.
- **Given** `"profile"`, **When** `N("profile")`, **Then** `("profile", False)`.
- **기대결과**: `("profile", False)`. 🔴 **`("cover", ...)` 가 나오면 별칭 도입이 profile 분기를 삼킨 것**이며, 프로필 업로드가 트랙 커버 코드로 흘러 **엉뚱한 Mongo 문서를 건드린다**.
- **확인할 로그 라인**: 없음. 추가로 **정적 검사**: `grep -n 'if type == "cover"' backend_9006/app/routes/upload.py` → **0건**(A2 의 `norm_type` 교체 누락 검출), `grep -n 'if norm_type == "cover"' …` → **1건**.
- **PASS/FAIL**: `("profile", False)` + 정적 검사 2건 모두 충족 → PASS. 하나라도 어긋나면 FAIL.
- **실패 시 의심**: `_normalize_upload_image_type`(`:93`) 의 `ALLOWED_UPLOAD_IMAGE_TYPES` 검사 순서, `upload_image` 분기문(`:161`).

#### V197-UNIT-03. 🔴 별칭 — `_normalize_upload_image_type("track")` → `("cover", True)` `[unit]` (A1, ① 본체)
- **사전조건**: UNIT-01 과 동일.
- **Given** 구 클라이언트가 보내던 값 `"track"`, **When** `N("track")`, **Then** **`("cover", True)`**.
- **기대결과**: `("cover", True)`. 이 한 줄이 **v197 ①의 서버 측 본체**다. `(None, False)` 면 400 이 그대로 남아 **버그가 전혀 고쳐지지 않은 것**이고, `("cover", False)` 면 별칭 계측이 죽어 **앱팀 사용량을 영원히 알 수 없다**(PLAN §3-1 옵션 ③의 목적 상실).
- **확인할 로그 라인**: 없음. 정적으로 `DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES == {"track": "cover"}` 확인.
- **PASS/FAIL**: `("cover", True)` 정확 일치 → PASS. 그 외 전부 FAIL.
- **실패 시 의심**: `DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES`(`:90`), `_normalize_upload_image_type` 두 번째 `if`(`:98~99`).

#### V197-UNIT-04. 알 수 없는 값 4종 → 전부 `(None, False)` `[unit]` (A1, 400 계약 유지)
- **사전조건**: UNIT-01 과 동일.
- **Given** `""`, `None`, `"banner"`, `"track_cover"`, **When** 각각 `N(x)`, **Then** **4건 모두 `(None, False)`**.
- **기대결과**: 전건 `(None, False)`. `None` 입력이 예외를 던지면 라우트가 **400 이 아니라 500** 이 된다(`(raw or "")` 방어 확인). `"track_cover"` 가 통과하면 별칭 매칭이 **접두/부분일치로 잘못 구현**된 것이다.
- **확인할 로그 라인**: 없음.
- **PASS/FAIL**: 4/4 `(None, False)` + 예외 0건 → PASS. 1건이라도 다르면 FAIL.
- **실패 시 의심**: `_normalize_upload_image_type` 의 `v = (raw or "").strip().lower()`(`:96`) 와 마지막 `return None, False`(`:100`).

#### V197-UNIT-05. R5 관용 확대가 **의도대로만** 넓어졌는지 `[unit]` (A1, R5)
- **사전조건**: UNIT-01 과 동일.
- **Given** `" Cover "`(앞뒤 공백 + 대문자)와 `"TRACK"`(전부 대문자), **When** 각각 `N(x)`, **Then** `" Cover "` → **`("cover", False)`**, `"TRACK"` → **`("cover", True)`**.
- **기대결과**: 위 2건. 이는 v197 이 **의도적으로 도입한 완화**(PLAN §3-1 ⚠️, R5)이며 기존에는 둘 다 400 이었다. 동시에 **허용 집합은 여전히 닫혀 있어야 한다** — 같은 실행에서 `"cover2"`, `" "`, `"co ver"` 가 **전부 `(None, False)`** 임을 함께 단언한다(관용이 부분일치로 새지 않았는지).
- **확인할 로그 라인**: 없음.
- **PASS/FAIL**: 관용 2건 통과 **AND** 비허용 3건 차단 → PASS. 관용이 안 되면 R5 미구현으로 FAIL(REPORT 에 "설계와 불일치"), **비허용이 통과하면 즉시 FAIL**(계약 파손).
- **실패 시 의심**: `.strip().lower()`(`:96`).

#### V197-UNIT-06. 🔴 A4 회귀 — **Redis 예외가 커버 저장을 깨뜨리지 않는다** `[unit]` — 즉시 중단 조건 S6 (A4, R4)
- **사전조건**: `import app.routes.upload as U`. 스텁 3종을 **모듈 네임스페이스에만** 설치(원본 가드 코드 무수정):
  - `U.get_mongo` → 페이크. `tracks.find_one(...)` → `{"_id": <oid>, "uploader_id": "<A>"}`, `tracks.update_one(...)` → `matched_count=1` 을 갖는 객체.
  - `U.get_minio` → 페이크. `put_object` 는 **호출 횟수만 기록**하고 아무것도 하지 않음.
  - **`U.get_redis` → 호출 시 `delete` 가 `RuntimeError("stub redis down")` 를 던지는 객체를 반환.**
  - 로깅 캡처 핸들러를 `app.routes.upload` 로거에 부착.
- **Given** 위 상태에서, **When** `await U.upload_image(file=FakeUpload(), type="cover", id=str(<TRK-A oid>), current_user={"id":"<A>"}, conn=None)` 를 호출하면, **Then**
  ① **예외가 밖으로 새어나오지 않고**, ② 반환값이 **`JSONResponse` 가 아닌 `dict`** 이며 **`object_name` 키를 포함**하고(값 = `covers/<A>/<TRK-A>.jpg`), ③ `file_url` 키도 존재하고, ④ **`put_object` 호출 1회**, ⑤ `update_one` 호출 1회다.
- **기대결과**: 위 5건 전부. 예외가 새면 **운영에서 Redis 장애 시 커버 업로드가 500** 이 되어 v197 이 새 장애를 만든 것이다(R4). 캐시 삭제 실패는 **최대 600초 표시 지연**일 뿐 데이터 손실이 아니므로 삼키는 것이 정답이다.
- **확인할 로그 라인**: **`[upload] image cover cache_invalidate_failed track=<8자>` WARNING 정확히 1건** + `[upload] image cover_ok track=<8자> obj=covers/<A>/<TRK-A>.jpg matched=1` INFO 1건. 두 로그의 track 값은 **8자 절단**이어야 한다(전체 id 가 찍히면 §0-8 위반 → REPORT 기재).
- **PASS/FAIL**: ①~⑤ + 로그 2건 → PASS. 예외 전파 또는 `cache_invalidate_failed` 부재 → **FAIL + 즉시 중단(S6)**. `try/except` 를 지우고 통과시킨 정황 → **FAIL(S1)**.
- **실패 시 의심**: `upload.py` `upload_image` 의 `try: redis = get_redis() … except Exception:` 블록(`:196~202`), `cover_ok` 로그(`:203`), `..database.redis.get_redis` import(`:20`).
  ℹ️ 참고: 운영에서 `init_redis` 전이면 `get_redis()` 가 `None` 을 반환해 `await None.delete()` 가 `AttributeError` 를 낸다 — 이 역시 같은 `except Exception` 이 잡아야 정상이다. 여유가 되면 `U.get_redis → lambda: None` 변형으로 1회 더 확인한다(같은 케이스 내 부속 단언).

#### V197-UNIT-07. 🔴 A3 소유권 가드 3분기 + **put_object 미도달 증명** `[unit]` (A3, ②)
- **사전조건**: UNIT-06 과 동일한 스텁 구성. 단 `U.get_redis` 는 정상 동작 페이크(`delete` no-op). `put_object` 호출 카운터를 **분기마다 0 으로 리셋**한다.
- **Given/When/Then** — 같은 함수를 3회 호출하며 `find_one` 반환만 바꾼다:

| 분기 | `find_one` 반환 | 호출 | 기대 반환 | **`put_object` 호출 수** |
|---|---|---|---|---|
| a | **`None`** | `type="cover"`, `id=<유효 oid>`, `current_user={"id":"<A>"}` | `JSONResponse` **404**, 본문 `{"error": "트랙을 찾을 수 없습니다."}` | **0** |
| b | `{"uploader_id": "<B>"}` | 동일 | `JSONResponse` **403**, 본문 `{"error": "자신의 트랙만 수정할 수 있습니다."}` | **0** |
| c | `{"uploader_id": "<A>"}` | 동일 | **`dict`** (`object_name`·`file_url` 포함) | **1** |

- **기대결과**: 표 그대로. **403·404 분기에서 `put_object` 호출이 0 이라는 것이 이 케이스의 핵심 단언**이다 — 가드가 `put_object` **뒤**에 있으면 반환 코드는 똑같이 403 이면서도 **MinIO 에 객체가 이미 생겨** 저장소 오염·대역 낭비가 발생한다(PLAN §3-3 ③). 상태코드만 보는 테스트로는 이 결함을 잡지 못한다.
  본문 자구는 `tracks.py update_track`(`:736`/`:738`)과 **완전히 동일**해야 한다 — 신규 문구가 나오면 FAIL(관행 이탈).
  분기 b 에서 **404 가 아니라 403** 인 것도 단언한다(PLAN §3-3 ②: 노출된 식별자 → 404/403 2단계).
- **확인할 로그 라인**: a → `[upload] image cover_not_found track=<8자>` 1건 / b → `[upload] image cover_denied track=<8자> user=<8자>` 1건 / c → `[upload] image cover_ok track=… obj=… matched=1` 1건. **a·b 에서 `cover_ok` 가 함께 찍히면 FAIL**(가드 뒤로 흐름이 샌 것).
- **PASS/FAIL**: 3분기 전부 반환·본문·put 카운트 일치 → PASS. put 카운트가 0 이 아닌 분기가 있으면 **FAIL + 즉시 중단(S4 예비)**. 가드를 스텁으로 무력화했다면 **FAIL(S1)**.
- **실패 시 의심**: `upload.py` `upload_image` 의 `doc = await mongo.tracks.find_one({"_id": ObjectId(id)}, {"uploader_id": 1})`(`:169`) 위치가 `object_name = f"covers/…"` / `minio_client.put_object`(`:180~186`) **앞**인지, 404 블록(`:171~173`), 403 블록(`:174~176`).

#### V197-UNIT-08. A6 `mv_status` 소유권 가드 2분기 `[unit]` (A6, ③)
- **사전조건**: `U.get_mongo` 만 스텁(`mv_jobs.find_one` 반환값 제어). `browser_image_url`/`browser_video_url` 은 `MEDIA_URL_MODE=proxy` 기본값에서 MinIO 접근이 없으므로 그대로 둔다.
- **Given/When/Then**:

| 분기 | `mv_jobs.find_one` 반환 | 호출 | 기대 |
|---|---|---|---|
| a | `{"user_id": "<B>", "status": "completed", "result_video_url": "v197t/nonexistent.mp4", "scene_thumbnails": [...]}` | `await U.mv_status(job_id=str(<MVJOB-B oid>), current_user={"id":"<A>"})` | `JSONResponse` **403**, 본문 `{"error": "이 작업에 접근할 권한이 없습니다."}`. **직렬화된 본문에 `result_video_url`·`scene_thumbnails` 키가 없다** |
| b | 동일 | `current_user={"id":"<B>"}` | **`dict`**, `status=="completed"`, `result_video_url` 비어있지 않음, `scene_thumbnails` 길이 2 |

- **기대결과**: 표 그대로. 403 본문이 **`{"error": ...}`** 형태여야 한다 — `mv.py` 헬퍼를 그대로 import 했다면 `HTTPException` → `{"detail": ...}` 가 되어 `upload.py` 의 응답 관행이 깨진다(PLAN §3-4). 문구는 `mv.py:207` 과 **자구 동일**.
- **확인할 로그 라인**: a → `[upload] mv_status denied job=<8자> user=<8자>` INFO 1건. b → 없음(+ `[media-url] mode=proxy kind=image obj=v197t/…` 정보 로그는 무관).
- **PASS/FAIL**: 2분기 일치 + 403 본문에 유출 키 부재 → PASS. 403 인데 본문에 URL 이 들어있거나 `{"detail":...}` 형태 → FAIL.
- **실패 시 의심**: `upload.py` `mv_status`(`:895`) 의 `if job.get("user_id") != current_user["id"]:`(`:917`) 가 `find_one`(`:908`) **직후**·`scene_thumbnail_urls` 조립(`:921~923`) **앞**에 있는지.

---

### 2. `[api]` 시나리오 — 7건

> 전제: §0-B 선행 절차 완료(기록 필수). 픽스처는 §0-A 직접 삽입분. **`POST /api/tracks/upload` 호출 0회.**
> 공통 요청 형태: `POST http://localhost:9006/api/upload/image`, `multipart/form-data`, 헤더 `Authorization: Bearer <TEST_USER_A_TOKEN>`(또는 B), 파트 `file`(작은 `.jpg`, 수 KB) · `type` · `id`.
> 🚫 응답·로그를 REPORT 에 옮길 때 **파일명·전체 id·토큰 실값은 기재하지 않는다**(8자 절단·플레이스홀더).

#### V197-API-01. A 토큰 · `type=cover` · `id=TRK-A` → **201 + Mongo 반영** `[api]` — ① 완결 (A2·A3·A4)
- **사전조건**: §0-B 완료. `TRK-A` 삽입 완료(`cover_image_url` 키 없음). MinIO `covers/<A>/` 에 `<TRK-A>` 관련 객체 **없음**을 사전 확인.
- **Given** A 소유 트랙 `TRK-A`, **When** A 토큰으로 `type=cover`, `id=<TRK-A>` 로 이미지를 올리면, **Then**
  ① HTTP **201**, ② 본문이 **정확히 `{file_url, object_name}` 2키**(스키마 무변경 — PLAN §4 "변경하지 않는 것"), ③ `object_name == "covers/<A>/<TRK-A>.jpg"`, ④ `mongo.tracks` 의 `TRK-A.cover_image_url` 이 **③과 동일 문자열**로 저장됨, ⑤ MinIO `aimu-images` 에 그 키의 객체가 **실제로 존재**함.
- **기대결과**: ①~⑤ 전부. ④가 없으면 ① 결함이 그대로다. 상태코드가 200 이면 `status_code=201` 데코레이터가 훼손된 것(계약 파손).
- **확인할 로그 라인**: `[upload] image cover_ok track=<8자> obj=covers/<A>/<TRK-A>.jpg matched=1` INFO **1건**.
  🚫 `type_alias_deprecated`·`type_invalid`·`cover_denied`·`cover_not_found`·`profile_legacy_route` 는 **0건**이어야 한다.
  ℹ️ **설계 대비 구현 델타(무해, 승인 항목 A1)**: PLAN §3-5 는 `cover_ok track=%s obj=%s` 로 적었으나 구현은 **`matched=%d` 가 추가**되어 있다. tester 는 이를 FAIL 이 아니라 `OBSERVED` 로 기록한다 — 오히려 경합 시 no-op update 를 관측할 수 있어 유익하다(PLAN §3-3 "중복 조회 안 함" 주석과 정합).
- **PASS/FAIL**: ①~⑤ + 로그 1건 → PASS. ④ 미반영 또는 400 → **FAIL(① 미수정)**.
- **실패 시 의심**: `upload_image`(`:128`) → `norm_type` 분기(`:161`) → `update_one`(`:189`) → `cover_ok`(`:203`).

#### V197-API-02. A 토큰 · **`type=track`**(별칭) → **201 + 별칭 로그** `[api]` — 하위호환 (A2, R1) / **RT-04 부속 절차 포함**
- **사전조건**: API-01 직후(같은 서버 세션). `TRK-A` 재사용 가능(같은 키로 덮어써도 무방 — 확장자 동일).
- **Given** 구 클라이언트가 보내던 값, **When** A 토큰으로 `type=track`, `id=<TRK-A>` 로 올리면, **Then** ① **201**, ② 본문 `{file_url, object_name}`, ③ `object_name` 이 **`covers/…` 접두**(= cover 분기로 정규화됨. `profiles/…` 면 별칭이 profile 분기로 샌 것 → 🔴), ④ `TRK-A.cover_image_url` 갱신.
- **기대결과**: ①~④. **400 이 나오면 별칭이 동작하지 않는 것**이고, 앱팀 클라이언트가 계속 고장난 채 남는다(PLAN §3-1 옵션 ③ 채택 이유의 핵심).
- **확인할 로그 라인**: **`[upload] image type_alias_deprecated raw=track→cover user=<8자>` INFO 정확히 1건** + `[upload] image cover_ok …` 1건. `raw=` 값이 **32자 이내로 절단**되는지도 확인.
- **PASS/FAIL**: ①~④ + 별칭 로그 1건 → PASS. `object_name` 이 `profiles/` 로 시작 → **FAIL(RT-04 위반 — A2 의 `norm_type` 교체 누락)**.
- **실패 시 의심**: `_normalize_upload_image_type`(`:93`), `used_alias` 로그(`:143~145`), 분기문 `if norm_type == "cover":`(`:161`).
- **📎 부속 절차 (RT-04 실동작 확인 — planner 승인 항목 A2)**: 같은 세션에서 `type=profile`, `id=<A>` 로 **1회** 올려 **201** 과 `object_name == "profiles/<A>.jpg"` 를 확인하고, `[upload] image profile_legacy_route user=<8자>` INFO 1건을 확인한다.
  ⚠️ 이 호출은 **PG `users.profile_image` 를 쓰고 MinIO `profiles/<A>.jpg` 를 생성/덮어쓴다.** 착수 전 A 계정의 기존 `profile_image` 값과 객체 유무를 기록하고, **종료 시 원복**한다(§0-C). 승인이 없으면 이 부속 절차는 **생략**하고 RT-04 는 **UNIT-02(정규화) + API-02 ③(별칭이 profile 로 새지 않음) + 정적 diff(A5 가 로그만 추가)** 3중으로만 감시한다 — 커버리지 손실은 "레거시 profile 분기의 런타임 201 미확인" 하나뿐이며 REPORT 에 명시한다.

#### V197-API-03. 🔴 A 토큰 · `type=cover` · **`id=TRK-B`(타인 트랙)** → **403 + 무흔적** `[api]` — 즉시 중단 조건 S4 (A3, ② 본체)
- **사전조건**: §0-B 완료. `TRK-B`(uploader `<B>`, `cover_image_url:"covers/<B>/v197t-b-original.jpg"`) 삽입 완료.
  **직전에 다음 2개를 기록**: ⓐ `TRK-B.cover_image_url` 현재 값, ⓑ MinIO `aimu-images` 의 `covers/<A>/` 객체 키 **전체 목록**.
- **Given** B 소유 트랙, **When** **A 토큰**으로 `type=cover`, `id=<TRK-B>` 를 올리면, **Then**
  ① HTTP **403**, ② 본문 **`{"error": "자신의 트랙만 수정할 수 있습니다."}`**(자구 동일 — `tracks.py:738`), ③ **`TRK-B.cover_image_url` 이 ⓐ 와 완전히 동일**(무변경), ④ **🔴 MinIO `covers/<A>/<TRK-B>.jpg` 객체가 존재하지 않음** — 즉 `covers/<A>/` 목록이 ⓑ 와 **완전히 동일**.
- **기대결과**: ①~④ 전부. **④ 가 이 케이스의 핵심 단언**이다. 가드가 `put_object` 뒤에 있으면 ①②③ 은 똑같이 통과하면서 ④ 만 깨진다 — **403 만 확인하는 테스트는 이 결함을 놓친다.** 객체가 생겼다면 v197 은 "인가는 막았지만 저장소 오염은 그대로" 인 반쪽 수정이다(PLAN §3-3 ③).
- **확인할 로그 라인**: **`[upload] image cover_denied track=<TRK-B 8자> user=<A 8자>` INFO 정확히 1건.**
  🚫 `cover_ok` **0건**, `cache_invalidate_failed` **0건**(캐시 삭제 지점에 도달조차 하면 안 됨).
- **PASS/FAIL**: ①~④ + 로그 → PASS. **①이 201/200 이거나 ③④ 중 하나라도 깨지면 FAIL + 즉시 중단(S4)** 후 planner 보고. 403 이지만 ④ 만 깨진 경우도 **FAIL(즉시 중단)** — 부분 수정으로 종결하지 않는다.
- **실패 시 의심**: `upload_image` 의 `find_one`(`:169`)·403 블록(`:174~176`) 이 `minio_client.put_object`(`:181`) **앞**인지. `doc.get("uploader_id") != current_user["id"]` 의 **타입 불일치**(ObjectId vs str) 가능성도 함께 확인 — 양쪽 다 문자열이어야 한다.

#### V197-API-04. `id=TRK-GONE`(존재하지 않는 유효 ObjectId) → **404** `[api]` (A3, PLAN §3-3 ②)
- **사전조건**: §0-B 완료. **삽입하지 않은** 유효 형식 ObjectId 문자열 1개 준비(`TRK-GONE`). 사전에 `mongo.tracks.find_one({"_id": ObjectId(TRK-GONE)})` → `None` 확인.
- **Given** DB 에 없는 트랙 id, **When** A 토큰으로 `type=cover`, `id=<TRK-GONE>` 을 올리면, **Then** ① HTTP **404**(**403 아님**), ② 본문 **`{"error": "트랙을 찾을 수 없습니다."}`**(`tracks.py:736` 자구 동일).
- **기대결과**: ①②. **403 이 나오면 코드베이스 관행 위반**이다 — 트랙 계열은 일관되게 404→403 2단계이고(`tracks.py:713`·`:736`, `mv.py:205`), 트랙 id 는 차트·목록·URL 로 이미 공개되어 존재 은닉의 실익이 없다(PLAN §3-3 ②). 반대로 400 이 나오면 `ObjectId.is_valid` 앞단에서 걸린 것이므로 **준비한 id 형식이 잘못된 것** — 케이스 자체를 재구성한다(구현 결함 아님).
- **확인할 로그 라인**: **`[upload] image cover_not_found track=<8자>` INFO 1건.** 🚫 `cover_denied`·`cover_ok` 0건.
- **PASS/FAIL**: 404 + 본문 자구 일치 → PASS. 403/400/500 → FAIL.
- **실패 시 의심**: 404 블록(`:171~173`), `if not doc:` 조건이 `if doc is None:` 이 아닌지(빈 dict 오판 여지 — 프로젝션 결과는 항상 `_id` 를 포함하므로 실무상 동일하나 기록).

#### V197-API-05. `type=banner`(알 수 없는 값) → **400 본문 불변 + 계측 로그** `[api]` (A2, R1)
- **사전조건**: §0-B 완료.
- **Given** 허용 집합·별칭 어디에도 없는 값, **When** A 토큰으로 `type=banner`, `id=<TRK-A>` 를 올리면, **Then** ① HTTP **400**, ② 본문 **`{"error": "type은 'cover' 또는 'profile'이어야 합니다."}`** — **v197 이전과 자구·코드가 완전히 동일**(계약 무변경), ③ MinIO 에 새 객체 **0건**, ④ Mongo 무변경.
- **기대결과**: ①~④. 문구가 바뀌었다면 클라이언트 에러 처리에 대한 **미고지 계약 변경**이므로 FAIL.
- **확인할 로그 라인**: **`[upload] image type_invalid raw=banner user=<8자>` INFO 1건.**
  이 로그가 R1(앱팀이 제3의 값을 보낼 가능성) 대응의 **유일한 회수 수단**이다 — 없으면 배포 후 어떤 값이 오는지 영원히 알 수 없다. 부재 시 FAIL.
- **PASS/FAIL**: ①~④ + 로그 1건 → PASS. 로그만 없으면 **FAIL(R1 미대응)**.
- **실패 시 의심**: `type_invalid` 로그(`:138~140`), 400 반환(`:142`).

#### V197-API-06. 🔴 A4 — **커버 교체 후 트랙 상세가 즉시 새 커버를 반환** `[api]` (A4, §2-5, R11)
- **사전조건**: §0-B 완료. **`TRK-A` 를 커버 없는 초기 상태로 되돌린다**(`$unset: {cover_image_url: ""}`) 후 Redis 에서 `cache:track:v3:<TRK-A>`·`cache:track:<TRK-A>` 를 **삭제해 깨끗한 상태**로 시작.
- **Given/When/Then** — 순서가 이 케이스의 전부다. **반드시 아래 순서대로** 수행한다:
  1. **When** `GET /api/tracks/<TRK-A>`(A 토큰) → **Then** 200, `cover_image` 가 **`null`**. → 이 호출이 `tracks.py:1298` 의 `setex(cache:track:v3:<TRK-A>, 600, …)` 로 **캐시를 적재**한다.
  2. **확인**: `redis exists cache:track:v3:<TRK-A>` → **1**(적재 성공. 0 이면 이 케이스는 성립하지 않으므로 1단계를 재수행).
  3. **When** API-01 과 동일하게 `type=cover`, `id=<TRK-A>` 커버 업로드 → **Then** 201.
  4. **확인**: `redis exists cache:track:v3:<TRK-A>` → **0**, `redis exists cache:track:<TRK-A>` → **0**.
  5. **When** 즉시(600초 대기 없이) `GET /api/tracks/<TRK-A>` 재조회 → **Then** 200 이고 **`cover_image == "covers/<A>/<TRK-A>.jpg"`**(3단계 응답의 `object_name` 과 동일 문자열. `tracks.py:43` 이 `cover_image_url` 을 그대로 매핑한다).
- **기대결과**: 1~5 전부. **5단계에서 `null` 이 그대로면 A4 미구현**이며, ①을 고쳐 커버가 실제로 저장돼도 **최대 600초 동안 사용자에게는 아무 변화가 없다** — "저장은 됐는데 안 보인다" 는 원래 증상과 구별되지 않는 재발이다.
- **확인할 로그 라인**: 3단계에서 `[upload] image cover_ok track=<8자> obj=… matched=1` 1건. 🚫 **`cache_invalidate_failed` 0건**(Redis 정상 상태이므로 이 경고가 뜨면 삭제가 실패한 것 → 4·5단계가 깨진다).
- **PASS/FAIL**: 4단계 두 키 모두 0 **AND** 5단계 새 값 → PASS. 4 는 0 인데 5 가 `null` → **FAIL(다른 캐시 계층 의심)**. 4 가 1 → **FAIL(A4 미착지)**.
- **실패 시 의심**: `upload.py` `redis.delete(f"cache:track:{id}")`/`delete(f"cache:track:v3:{id}")`(`:198~199`) 의 **키 문자열**, `tracks.py` 읽기 키(`:1183`)·쓰기 키(`:1298`) 와의 일치. R11(`cache:track:v2:` 계열 누락) 여부는 `admin.py:862` 와 대조해 **REPORT 에 기록만**(현행 읽기 경로는 `v3` 뿐이므로 FAIL 사유 아님).

#### V197-API-07. 🔴 A6 — `/upload/mv-status` 타인 접근 차단 `[api]` — 즉시 중단 조건 S5 (A6, ③, R8)
- **사전조건**: §0-B 완료. `MVJOB-B`(`mv_jobs`, `user_id:"<B>"`, `status:"completed"`, `result_video_url:"v197t/nonexistent.mp4"`, `scene_thumbnails` 2건) 삽입 완료.
- **Given** B 소유 MV 작업, **When/Then** 2회 호출:

| 호출 | 토큰 | 기대 |
|---|---|---|
| a | **`<TEST_USER_A_TOKEN>`** | HTTP **403**, 본문 `{"error": "이 작업에 접근할 권한이 없습니다."}`. 🔴 **본문에 `result_video_url`·`scene_thumbnails`·`object_name` 키가 하나도 없음**(응답 원문을 키 단위로 검사) |
| b | `<TEST_USER_B_TOKEN>` | HTTP **200**, `status=="completed"`, `scene_thumbnails` 길이 2, `result_video_url` 비어있지 않음, `object_name == "v197t/nonexistent.mp4"` |

- **기대결과**: 표 그대로. **a 의 키 부재 단언이 핵심**이다 — 이 결함의 실제 피해는 "상태 코드" 가 아니라 **타인의 미공개 MV 썸네일 URL 과 최종 영상 presigned URL 유출**(유료 생성물 사전 유출)이기 때문이다.
  **b 는 R8(정상 폴링 파손) 회귀 감시**다. b 가 403/404 면 소유자 본인의 폴링이 깨진 것으로 **FAIL**.
- **확인할 로그 라인**: a → **`[upload] mv_status denied job=<8자> user=<8자>` INFO 1건.** b → denied 로그 **0건**.
- **PASS/FAIL**: a·b 전부 일치 → PASS. **a 가 200 이거나 403 본문에 URL 키가 하나라도 있으면 FAIL + 즉시 중단(S5).**
- **실패 시 의심**: `mv_status`(`:895`) 의 403 가드(`:917~919`) 가 `find_one`(`:908`) 직후·`scene_thumbnail_urls` 조립(`:921`) 앞인지. `job.get("user_id")` 저장 타입(문자열)과 `current_user["id"]` 타입 일치 여부.

---

### 3. `[e2e]` 시나리오 — 5건

> 공통 선행: 사용자 앱 `http://localhost:4000` **하드 새로고침(Ctrl+Shift+R)** + 빌드 표기 기록. dev 서버 상태에서 수행(프로덕션 빌드로 검증하면 `import.meta.env.DEV` 가드 로그 부재를 FAIL 로 오판한다).
> **`POST /api/tracks/upload` 는 E2E-01 에서 1회만 발생한다**(E2E-03 은 인터셉트로 0회, E2E-02·04·05 는 0회).

#### V197-E2E-01. 🔴 **유료 1회** — 직접 첨부 커버가 실제로 저장·표시된다 `[e2e]` (F1 + A2·A3·A4, ① 완결, R7)
- **사전조건**: 4000 하드 새로고침. 테스트 계정 **A** 로그인. DevTools **Network 탭 열고 기록 시작** + Console 탭 동시 관찰. 오디오 파일 1개(짧은 것) + 커버 이미지 1개(`.jpg`, 수백 KB) 준비. 곡 제목은 **`v197t-e2e-01`** 로 입력(마커 필수).
  ⚠️ **이 케이스가 v197 유일한 `/api/tracks/upload` 소비처다. 실패 시 재시도는 1회만 허용**(§0-2). 2회째도 실패하면 진행을 멈추고 planner 에 보고한다.
- **Given** 업로드 화면에서 AI 커버를 **쓰지 않고**(`aiCoverObjectName` 미설정) **커버 이미지를 직접 첨부**한 상태, **When** 업로드를 실행하면, **Then**
  ① 화면에 **"업로드가 완료되었습니다!"** 노출 후 약 1.5초 뒤 홈(`/`)으로 자동 이동,
  ② **Network 탭에 `POST /api/upload/image` 요청이 1건** 있고 **요청 payload 의 `type` 파트 값이 `cover`**(🔴 `track` 이면 F1 미배포 — 하드 새로고침 재수행 후 재확인),
  ③ 그 요청의 응답이 **201**이고 본문에 `object_name: "covers/<A>/<새 트랙 id>.jpg"`,
  ④ Console 에 **`[UploadPage] cover image upload failed` 가 없음**,
  ⑤ 홈/내 음악 **목록**에서 해당 곡의 썸네일에 **첨부한 이미지가 실제로 보임**(회색 placeholder 아님),
  ⑥ **곡 상세** 화면에서도 커버가 보이고 **레이아웃이 무너지지 않음**(R7 — 지금까지 커버 없이 렌더되던 화면에 처음으로 이미지가 들어가는 경로).
- **기대결과**: ①~⑥ 전부. ②가 `track` 이면 F1 이 브라우저에 반영되지 않은 것이고, ③이 400 이면 A2 미착지, 403/404 면 A3 오작동(본인 곡인데 막힘 → **심각**), ⑤가 placeholder 면 A4 캐시 문제 또는 `cover_image` 매핑 문제다.
- **확인할 로그 라인**: 서버 `[upload] image cover_ok track=<8자> obj=… matched=1` 1건. 🚫 `type_alias_deprecated` **0건**(프론트가 정정됐으므로 웹에서 별칭이 나오면 안 된다 — 나온다면 R1 계측이 웹 트래픽으로 오염된다). Console 에 `[UploadPage] cover image upload failed` **0건**.
- **PASS/FAIL**: ①~⑥ + 로그 조건 → PASS. ② 또는 ③ 실패 → **FAIL(① 미수정)**. ⑤⑥ 만 실패 → FAIL 이되 원인을 렌더/캐시로 분리해 기록.
- **실패 시 의심**: `UploadPage.jsx` `handleSubmit`(`:1490`) 커버 블록(`:1563~1574`), `api/index.js:299 uploadImage`, `upload.py upload_image`(`:128`), `tracks.py:43` `cover_image` 매핑.
- **정리**: 이 곡(`v197t-e2e-01`)과 그 커버 객체는 §0-C 대상. 단 **E2E-02·04 가 이 곡/객체를 재사용**하므로 **삭제는 전 케이스 종료 후**에 한다.

#### V197-E2E-02. 커버 노출 화면 2곳 렌더 회귀 `[e2e]` (R7)
- **사전조건**: E2E-01 성공. 추가 업로드 없음(**유료 호출 0회**).
- **Given** E2E-01 로 커버가 붙은 곡, **When** ⓐ 곡 **상세 페이지**, ⓑ **목록형 화면**(홈 또는 내 음악의 곡 리스트) 2곳을 각각 열면, **Then** 두 화면 모두 ① 커버 이미지가 **깨짐 아이콘 없이** 표시되고, ② **주변 요소가 밀리거나 겹치지 않으며**(제목·아티스트·재생 버튼 위치 정상), ③ Console 에 이미지 로드 실패(4xx/`ERR_`) 에러 **0건**.
- **기대결과**: ①~③ 두 화면 모두. R7 은 "지금까지 커버가 **없어서** 안 보이던 자리에 처음으로 이미지가 들어간다" 는 위험이며, AI 커버 경로로 이미 이미지가 들어오던 렌더 경로와 **동일한 컴포넌트**를 타므로 문제 가능성은 낮다 — 그래서 2곳 육안 확인으로 한정한다(PLAN §5 R7).
- **확인할 로그 라인**: 브라우저 Console 에러 0건. Network 탭에서 커버 이미지 요청(`/api/upload/cover-preview/…`, `MEDIA_URL_MODE=proxy` 기본) 응답 **200**.
- **PASS/FAIL**: 두 화면 ①~③ → PASS. 깨짐/붕괴 1건이라도 → FAIL(스크린샷 첨부).
- **실패 시 의심**: `media_urls.browser_image_url`(`app/services/media_urls.py:95`) 의 모드 분기, `upload.py cover_preview`(`:417` 계열, v197 무변경), 목록 컴포넌트의 썸네일 스타일.

#### V197-E2E-03. 🔴 F1 — **커버 실패가 사용자에게 정직하게 노출된다** `[e2e]` (F1, R6)
- **사전조건**: 4000 하드 새로고침, 계정 A 로그인, DevTools 열기.
  **네트워크 인터셉트 2건을 설치한다(🚫 서버 코드·설정 무수정, 브라우저 계층에서만):**
  1. **`POST **/api/tracks/upload` → 서버로 보내지 않고 합성 200 응답으로 fulfill**: 본문 `{"id": "<TRK-A>", "title": "v197t-e2e-03", "cover_image": null}`.
     → **이 인터셉트가 `/api/tracks/upload` 유료 호출을 0회로 만든다**(§예산표). 프론트는 `track.id` 만 사용하므로(`UploadPage.jsx:1565·1567`) 합성 응답으로 충분하다.
  2. **`POST **/api/upload/image` → 합성 403 응답으로 fulfill**: 본문 `{"error": "자신의 트랙만 수정할 수 있습니다."}`.
  파일 입력에는 오디오 1개 + **커버 이미지 1개를 반드시 첨부**한다(커버 블록 진입 조건 `imageFile && !aiCoverObjectName && track?.id`).
- **Given** 곡 업로드는 성공하고 커버 업로드만 실패하는 상황, **When** 업로드를 실행하면, **Then**
  ① 화면에 **"곡은 업로드되었지만 커버 이미지 저장에 실패했습니다. 내 음악에서 커버를 다시 등록해 주세요."** 가 **에러로 노출**되고,
  ② **"업로드가 완료되었습니다!" 는 노출되지 않으며**(`setSuccess` 미도달),
  ③ **1.5초 후 홈으로 자동 이동하지 않는다**(같은 화면에 머무름 — 최소 5초 관찰),
  ④ Console 에 **`[UploadPage] cover image upload failed`** 가 **정확히 1건**(객체 인자에 `trackId` 포함),
  ⑤ 🔴 **업로드 버튼이 다시 활성화된다**(`disabled` 해제 — `finally { setUploading(false) }`, `UploadPage.jsx:1586~1588`).
- **기대결과**: ①~⑤ 전부. ①이 이 결함의 본질에 대한 답이다 — 원래 해악은 400 자체가 아니라 **"완료되었습니다" 라는 거짓 보고**였다(PLAN §3-2).
  **①의 문구에 "곡은 업로드되었지만" 이 반드시 남아 있어야 한다** — R6 대응이며, 이 말이 없으면 사용자가 실패로 오인해 **곡을 중복 업로드**한다.
  ⑤가 깨지면 `return` 이 `finally` 를 건너뛴 것이 되어(문법상 불가하지만 코드 구조 변경 시 가능) 사용자는 **버튼이 죽은 화면**에 갇힌다.
- **확인할 로그 라인**: Console `[UploadPage] cover image upload failed` 1건. 🚫 서버 `server.log` 에 **`[upload] image …` 계열 로그 0건**(인터셉트로 서버에 도달하지 않았음의 증거) **AND `/api/tracks/upload` 접근 로그 0건**(예산 미소비 증명 — REPORT 에 필수 기재).
- **PASS/FAIL**: ①~⑤ → PASS. ②③ 중 하나라도 깨지면(성공 메시지가 뜨거나 자동 이동) **FAIL — 거짓 성공 보고가 그대로 남은 것**.
- **대안 절차(인터셉트 1 이 불가한 경우)**: 인터셉트 2(`/upload/image` → 403)만 걸고 **실제 곡 업로드를 수행**한다. 이 경우 **`/api/tracks/upload` 예비 1회를 소비**하므로, ⓐ E2E-01 이 1회에 성공했음을 먼저 확인하고, ⓑ **planner 에 사전 보고**한 뒤 진행한다(승인 항목 A3). 생성된 곡은 `v197t-e2e-03` 마커로 §0-C 정리 대상.
- **실패 시 의심**: `UploadPage.jsx` `try/catch`(`:1568~1574`), `setError`(`:1572`), `return`(`:1573`), `setSuccess`(`:1576`), `finally`(`:1586~1588`).

#### V197-E2E-04. 회귀 — **AI 커버 경로가 `/upload/image` 를 타지 않는다** `[e2e]` — RT-01 (PLAN §2-1, R-무영향)
- **사전조건**: 🚫 **`/upload/generate-cover`·`/upload/refine-cover` 호출 절대 금지.**
  대신 §0-A 의 **`TRK-AICOVER` 를 Mongo 직접 삽입**한다 — `uploader_id:"<A>"`, `title:"v197t-aicover"`, `cover_image_url` = **E2E-01 이 만든 실존 객체 키**(`covers/<A>/<E2E-01 트랙 id>.jpg`). 이렇게 하면 유료 생성 없이 "AI 커버가 이미 박힌 트랙"(`tracks.py:1656` 이 만드는 것과 **같은 형태의 문서**)을 재현할 수 있다.
  4000 하드 새로고침 + **Network 탭 기록 시작(필터: `upload/image`)**.
- **Given** `cover_object_name` 경로로 커버가 박힌 트랙, **When** 내 음악 목록과 그 곡의 **상세 페이지**를 열면, **Then**
  ① 커버가 정상 렌더되고, ② 🔴 **관찰 구간 전체에서 `/api/upload/image` 요청이 0건**이며, ③ Console 에러 0건.
- **기대결과**: ①~③. ②가 이 케이스의 단언이다 — AI 커버는 트랙 **생성 시점**에 `cover_image_url` 로 직접 박히므로(`tracks.py:1656`) `/upload/image` 를 **구조적으로 타지 않는다**. v197 의 A2·A3 변경이 이 경로에 **어떤 영향도 주지 않았음**을 요청 부재로 증명한다.
- **확인할 로그 라인**: 서버 `[upload] image …` 계열 **0건**. 🚫 `/upload/generate-cover` 접근 로그 **0건**(있으면 즉시 중단 S2).
- **PASS/FAIL**: ①~③ → PASS. `/upload/image` 요청이 1건이라도 있으면 FAIL(경로 혼선 — 프론트가 AI 커버를 재업로드하고 있다는 뜻).
- **실패 시 의심**: `UploadPage.jsx:1563` 의 `!aiCoverObjectName` 가드(AI 커버와 직접 첨부의 상호 배타성), `tracks.py:1656`.
- **정적 보강(RT-01)**: `git diff b1f05cd -- 0_platform_music/backend_9006/app/routes/tracks.py` → **변경 0줄** 확인(특히 `:1656` 라인 무변경).

#### V197-E2E-05. 회귀 — **프로필 이미지는 `/auth/me/profile-image` 로 나간다** `[e2e]` — RT-02 (PLAN §2-4)
- **사전조건**: 4000 하드 새로고침, 계정 A 로그인, Network 탭 기록 시작.
  **착수 전 A 의 현재 `profile_image` 값과 MinIO `profiles/<A>.*` 객체 유무를 기록**(§0-C — 종료 시 원복 대상).
- **Given** 프로필 편집 화면, **When** 프로필 이미지를 1장 변경·저장하면, **Then**
  ① Network 탭에 **`POST /api/auth/me/profile-image` 요청 1건**이 있고 **응답 200**,
  ② 🔴 같은 구간에 **`POST /api/upload/image` 요청 0건**(레거시 경로로 새지 않음),
  ③ 저장된 이미지가 **512×512 로 크롭**되어 있음(`auth.py:825 _process_profile_image` — 응답/재조회 URL 의 이미지 실측 또는 MinIO 객체 크기·해상도 확인),
  ④ **헤더 아바타가 즉시 갱신**됨(새로고침 없이 — `_update_session_profile_image`, `auth.py:854`/`:909`).
- **기대결과**: ①~④. ②가 단언의 핵심이다. A5 는 `type=profile` 분기에 **로그 한 줄만** 추가했으므로 웹 프로필 흐름은 **아무것도 달라지지 않아야 한다**.
- **확인할 로그 라인**: 🚫 서버 **`[upload] image profile_legacy_route user=…` 0건**(웹은 이 경로를 쓰지 않는다 — 1건이라도 나오면 프론트가 레거시 경로를 타는 것이고, 그 경우 §2-4 표의 3가지 처리(크롭·이전 이미지 정리·세션 갱신)를 잃는다). 🚫 `[upload] image …` 계열 전부 0건.
- **PASS/FAIL**: ①~④ → PASS. ② 위반 또는 `profile_legacy_route` 관측 → FAIL(경로 회귀).
- **실패 시 의심**: `frontend/src/api/index.js:140~146 uploadProfileImage`, `auth.py:865~912`(`/me/profile-image`), `upload.py` A5 로그(`:212`).
- **정리**: 종료 시 A 의 `profile_image` 를 착수 전 값으로 **원복**한다. 원복 불가하면 REPORT 에 명시.
- **정적 보강(RT-02)**: `git diff b1f05cd -- …/upload.py` 의 `else:`(profile) 분기 hunk 가 **`logger.info("[upload] image profile_legacy_route …")` 한 줄 추가뿐**이고 `object_name`·`put_object`·PG `UPDATE` 는 무변경임을 확인.

---

### 4. 회귀 항목 (RT-01 ~ RT-08)

> 별도 케이스 번호를 부여하지 않는다 — 위 20건과 정적 diff 로 커버되며, tester 는 **이 표 자체를 체크리스트로** 사용해 8건 전부에 PASS/FAIL 을 남긴다.

| # | 회귀 대상 | 검증 수단 | PASS 조건 | 🚫 금지 |
|---|---|---|---|---|
| **RT-01** | **AI 커버 생성 경로 무영향** | **V197-E2E-04** + `git diff b1f05cd -- backend_9006/app/routes/tracks.py` | E2E-04 ①~③ 전부 통과 **AND** `tracks.py` 변경 **0줄**(특히 `:1656` `"cover_image_url": body.cover_object_name`) | 🚫 `/upload/generate-cover` 호출 |
| **RT-02** | **프로필 업로드 무영향** | **V197-E2E-05** + `upload.py` profile 분기 diff | E2E-05 ①~④ 통과 **AND** diff 가 **로그 1줄 추가뿐**(`object_name`·`put_object`·PG `UPDATE users SET profile_image` 무변경) | — |
| **RT-03** | **곡 업로드 전체 흐름 무영향 (커버 미선택)** | **수동 1회** — 4000 에서 **커버를 고르지 않고** 업로드 화면을 채운 뒤 제출. ⚠️ **유료 예산상 실제 제출은 하지 않는다**: E2E-03 의 인터셉트 1(`/api/tracks/upload` → 합성 200)을 **재사용**해 커버 미첨부 상태로 제출한다 | ① Network 탭 **`/api/upload/image` 요청 0건**(`imageFile` 이 없어 블록 미진입), ② **"업로드가 완료되었습니다!" 정상 노출**, ③ 홈 자동 이동 정상, ④ Console 에러 0건 | 🚫 추가 `/api/tracks/upload` 실호출 |
| **RT-04** | **`type=profile` 이 여전히 201** (별칭이 profile 분기를 삼키지 않았는지 — A2 `norm_type` 교체 누락 검출) | **V197-UNIT-02**(정규화) + **V197-API-02 ③**(별칭 결과가 `covers/` 접두) + **정적** `grep 'if type == "cover"'` → 0건 + **(승인 시) API-02 부속 절차**의 런타임 201 | 3중(승인 시 4중) 전부 통과. 승인 미취득 시 **런타임 201 미확인**을 REPORT 에 명시 | ⚠️ 부속 절차는 PG·MinIO 쓰기 — 승인 필요(A2), 종료 시 원복 |
| **RT-05** | **`refine-cover`·`revert-cover`·`cover-history` 무변경** | **`git diff b1f05cd -- backend_9006/app/routes/upload.py`** 에서 `refine_cover`·`revert_cover`·`cover_history`·`_load_cover_session` 심볼이 **hunk 에 등장하지 않음** 확인 | 4개 심볼 관련 변경 **0줄**(라인 이동은 무관 — diff hunk 기준) | 🚫 **호출 금지**(유료 + 포인트 차감). diff 확인으로 **대체** |
| **RT-06** | **`uploader_id` 부재 레거시 트랙 → 403 이 정상**(R3) | **`TRK-NOOWNER`** 에 A 토큰으로 `type=cover` 업로드 시도(API 블록에 부속) + **집계 1회** | ① **403 `"자신의 트랙만 수정할 수 있습니다."`** 반환(= `delete_track`·`update_track` 기존 정책과 **동일** — v197 이 새로 만드는 breakage 가 아니다), ② `cover_denied` 로그 1건, ③ **실 DB 의 `uploader_id` 부재 문서 건수**를 `count_documents({"uploader_id": {"$exists": False}})` 로 **집계만** 기록 | 🚫 집계 외 **실사용자 문서 열람·수정 금지**(본문·title 을 REPORT 에 옮기지 않는다. **건수만**) |
| **RT-07** | **`mv.py` 무영향** | **`git diff b1f05cd -- backend_9006/app/routes/mv.py`** | 변경 **0줄**(`_get_job_with_ownership`(`:202~208`) 포함 전 파일) | 🚫 `/api/mv/**` **호출 금지** — diff 로만 확인 |
| **RT-08** | **`frontend_admin`(4001) 무영향** | **스모크 1회** — 4001 하드 새로고침 → 로그인 → 임의의 관리자 화면 1개 진입 | ① 정상 렌더, ② Console 에러 0건, ③ Network 탭 **`/api/upload/image` 요청 0건**(PLAN §2-1 실측: 관리자 앱은 이 엔드포인트를 전혀 쓰지 않는다), ④ `git diff b1f05cd -- 0_platform_music/frontend_admin/` **변경 0줄** | 🚫 전체발송·별 지급 등 쓰기 조작 금지 |

**회귀 위험(R1~R11) ↔ 감시 케이스 대응표**

| 위험 | 감시 |
|---|---|
| **R1** 앱팀이 제3의 값 전송 | **V197-API-05**(`type_invalid` 로그 회수) · UNIT-04 |
| **R2** 타인 커버 변경의 정당한 유스케이스 존재 | 시나리오 없음 — PLAN §5 R2 에서 **정적 전수 조사로 "존재하지 않음" 확정**(어드민 커버 변경 미구현). **RT-08 ③**(관리자 앱 `/upload/image` 요청 0건)이 역방향 감시 |
| **R3** 레거시 `uploader_id` 부재 문서 403 | **RT-06** |
| **R4** 🔴 Redis 장애 → 500 | **V197-UNIT-06**(즉시 중단 S6) |
| **R5** `.strip().lower()` 관용 확대 | **V197-UNIT-05**(관용 2건 + 비허용 3건 양방향) |
| **R6** 🔴 `return` 으로 화면에 갇힘·중복 업로드 유도 | **V197-E2E-03 ①⑤**(문구에 "곡은 업로드되었지만" + 버튼 재활성) |
| **R7** 커버가 처음 들어가며 레이아웃 붕괴 | **V197-E2E-01 ⑥** · **V197-E2E-02** |
| **R8** `/mv-status` 403 이 정상 폴링 파손 | **V197-API-07 b**(B 토큰 200) · UNIT-08 b |
| **R9** `find_one` 추가로 Mongo 왕복 1회 증가 | 시나리오 없음 — **무시 등급**. 다만 API-01·03 응답 시간을 기록해 REPORT 에 남긴다(403 은 `put_object` 를 건너뛰어 **더 빨라야** 정상) |
| **R10** 별칭 로그 볼륨 | **V197-E2E-01**(웹에서 `type_alias_deprecated` **0건** — 프론트 정정 후 웹 트래픽이 로그를 오염시키지 않음) · API-02(1요청 1줄) |
| **R11** 캐시 키 누락(`v2` 계열) | **V197-API-06 4·5단계**. `v2` 는 현행 읽기 경로에 없으므로 **기록만**, FAIL 사유 아님 |

**의도적 커버리지 공백**(PLAN §6 범위 밖 — 시나리오를 두지 않는다):
`type=profile` → `/auth/me/profile-image` 통합 / 무인증 프록시 `cover-preview`·`mv-preview`(특히 **`mv-preview` 의 `..` 차단 부재 — 별도 보안 항목으로 승계 권고**) / 확장자 변경 시 고아 객체 / `StudioTab2.jsx:1616` cleanup catch / 커버 변경 이력·되돌리기 / 커버 변경 알림 / **9004·9005 미러 검증** / ES 색인·차트 캐시의 커버 필드.
다만 **RT-05·RT-07** 이 "범위 밖 파일·심볼에 변경이 없음" 을 **역방향으로 감시**한다.

---

### 5. planner 승인 필요 항목

| # | 항목 | 사유 | 승인 없이 진행 시 대안 |
|---|---|---|---|
| **A1** | **`cover_ok` 로그 포맷의 설계↔구현 델타 사후 승인** | PLAN §3-5 는 `[upload] image cover_ok track=%s obj=%s`, 구현은 **`matched=%d` 가 추가**되어 있다(`upload.py:203`). 내용상 유익한 추가(경합 시 no-op update 관측)이나 **설계 문서와 문자열이 다르다** | tester 는 **FAIL 이 아니라 `OBSERVED`** 로 기록하고 진행한다(V197-API-01). planner 가 ① 사후 승인하거나 ② PLAN §3-5 를 구현에 맞춰 정정한다. **어느 쪽이든 시나리오·건수는 영향 없음** |
| **A2** | 🔴 **RT-04 부속 절차의 `type=profile` 실호출** (V197-API-02 부속) | **PG `users.profile_image` 쓰기 + MinIO `profiles/<A>.jpg` 생성/덮어쓰기**가 발생한다. 테스트 계정 A 한정이고 종료 시 원복하지만, **원복 실패 시 계정 A 의 프로필 이미지가 바뀐 채 남는다** | 미승인 시 **부속 절차 생략**. RT-04 는 UNIT-02 + API-02 ③ + 정적 grep **3중**으로 유지된다. 손실은 "레거시 profile 분기의 런타임 201 미확인" 1건뿐이며 REPORT 에 명시. **건수·비율 불변** |
| **A3** | **V197-E2E-03 의 대안 절차 발동**(인터셉트 1 불가 시 `/api/tracks/upload` 실호출) | **유료 예비 1회를 소비**한다. 이 경우 E2E-01 재시도 여유가 사라진다 | 기본 설계는 **인터셉트로 0회** 소비이므로 통상 발동하지 않는다. 발동이 필요하면 **사전 보고 후** 진행하고, E2E-01 이 1회에 성공했음을 먼저 확인한다. **미승인 시 E2E-03 을 `PARTIAL`** 로 기록(①②③④는 인터셉트 2 만으로도 관측 가능, ⑤만 조건부) — 건수는 유지 |
| **A4** | **`[unit]` 의 인프라 스텁 주입**(UNIT-06·07·08 의 `U.get_mongo`/`get_minio`/`get_redis` 교체) | 실 DB·MinIO 무영향이나, 스텁 코드가 실수로 **프로덕션 모듈 상태를 원복하지 않으면** 같은 프로세스의 후속 테스트가 오염된다 | 미승인 시 A3·A4·A6 가드의 **존재만 정적 확인**으로 대체(`SKIP(정적)`) — **R4·A3 put 미도달 커버리지가 크게 약해지므로 비권장**. 승인 시 조건: ① 별도 임시 파일에서만 수행, ② `try/finally` 로 원본 속성 **반드시 원복**, ③ 실행 후 파일 삭제 + `git status --short` untracked 0건 확인 |
| **A5** | **RT-06 의 실 DB 집계 쿼리 1회**(`tracks.count_documents({"uploader_id": {"$exists": False}})`) | 실사용자 데이터 영역에 대한 **읽기**다(§0-6 은 "조회도 하지 않는다" 를 명시) | **건수만** 반환하는 집계이므로 문서 내용 노출이 없다 — 승인 없이 진행 가능하다고 판단하나, planner 가 불허하면 **RT-06 을 `TRK-NOOWNER` 픽스처 403 확인만으로 축소**하고 "실 DB 내 레거시 문서 존재 여부 미확인" 을 REPORT 에 명시 |

**승인 없이도 진행 가능**: `[unit]` 8건 중 **5건**(UNIT-01~05) — A4 미승인 시 UNIT-06·07·08 은 정적 대체 / `[api]` **7건 전부**(A2 는 부속 절차만 영향) / `[e2e]` **5건 전부**(A3 미승인 시 E2E-03 만 `PARTIAL`).
→ **A1~A5 가 전부 미승인이어도 20건 중 20건이 수행되며 삭제되는 케이스는 없다.** 비율(40/35/25)은 승인 결과와 **무관하게 유지**된다.

---

### 6. v197 시나리오 집계

| 태그 | 건수 | 비율 | 요구 | 판정 |
|---|---|---|---|---|
| `[unit]` | **8** | **40.0%** | 40% (하한) | ✅ 충족 |
| `[api]` | **7** | **35.0%** | 35% | ✅ 충족 |
| `[e2e]` | **5** | **25.0%** | ≤ 25% (상한) | ✅ 충족 |
| **합계** | **20** | 100% | — | — |

**결함·변경 항목별 배분**

| 대상 | unit | api | e2e | 계 |
|---|---|---|---|---|
| ① `type` 불일치 — 서버 별칭 (A1·A2) | 5 (UNIT-01~05) | 2 (API-02·05) | 0 | **7** |
| ①-b 프론트 정정 + 실패 노출 (F1) | 0 | 0 | 2 (E2E-01·03) | **2** |
| ② 커버 소유권 (A3) | 1 (UNIT-07) | 2 (API-03·04) | 0 | **3** |
| ②-b Redis 캐시 무효화 (A4) | 1 (UNIT-06) | 1 (API-06) | 0 | **2** |
| ③ `/mv-status` 인가 (A6) | 1 (UNIT-08) | 1 (API-07) | 0 | **2** |
| 회귀·렌더·경로 무영향 (A5 · RT 계열) | 0 | 1 (API-01, ① 완결 겸용) | 3 (E2E-02·04·05) | **4** |

- **`[unit]` 을 8건(40%)으로 잡은 근거**: v197 변경의 **절반 이상이 순수 함수 1개(A1)와 3개의 조기 반환 가드(A3·A4·A6)** 에 있다. 이 넷은 전부 **DB·서버 없이 직접 호출로 분기를 전수 확인**할 수 있고, 특히 **"403·404 시 `put_object` 호출 0회"(UNIT-07)** 와 **"Redis 예외를 삼킨다"(UNIT-06)** 는 `[api]` 층에서 관측하기 번거롭거나(전자) 재현 자체가 어렵다(후자 — 실 Redis 를 죽여야 한다). 유닛에 배치하는 편이 **더 확실하고 더 싸다**.
- **`[e2e]` 를 5건(상한)으로 묶은 근거**: 화면 발현이 반드시 필요한 것은 **F1 의 2건(성공 경로·실패 경로)** 과 **렌더 회귀 3건**뿐이다. 나머지를 e2e 로 올리면 `/api/tracks/upload` 예산(2회)을 초과한다. 그래서 **E2E-03 은 인터셉트로 유료 호출 0회**, **E2E-04 는 Mongo 직접 삽입 + E2E-01 산출 객체 재사용**, **E2E-02·05 는 추가 업로드 0회**로 설계했다.
- **쓰기 총량**: Mongo `tracks` 픽스처 **4건**(`TRK-A`·`TRK-B`·`TRK-NOOWNER`·`TRK-AICOVER`) + E2E-01 실업로드 트랙 **1건**(+대안 절차 발동 시 E2E-03 트랙 1건) · Mongo `mv_jobs` **1건**(`MVJOB-B`) · MinIO `covers/<A>/` 객체 **1~2개** · (승인 시) PG `users.profile_image` **1행 갱신 + 원복** · MinIO `profiles/<A>.jpg` **1개(원복 대상)** · Redis 캐시 키 임시 생성·삭제.
  **전부 `v197t` 마커 + §0-C 카운트 대조로 회수.**
- **금지 항목 실적(기대치)**: 유료 외부 API **0건** · `POST /api/tracks/upload` **1회(상한 2)** · `GET /api/tracks/search` **0회** · 별 차감 **0** · 전체발송 **0** · 인덱스 조작 **0** · 컨테이너/포트/MinIO/Redis/ES 설정 조작 **0** · `backend_9004`·`backend_9005` 접근 **0**(읽기조차 불요) · 실사용자 트랙 **변조 0 · 열람 0**(RT-06 의 **집계 1회** 예외, 승인 항목 A5).
- **즉시 중단 조건**: §0-D 의 **S1~S8**. 핵심 감시 케이스는 **V197-API-03**(S4 — 403 + MinIO 무흔적), **V197-API-07**(S5 — MV URL 유출), **V197-UNIT-06**(S6 — Redis 예외), 그리고 **전 항목 상시**(S2 유료 호출 / S3 실사용자 변조 / S1 가드 우회).
- **가드 우회 금지의 재확인(S1)**: `[unit]` 스텁은 **`get_mongo`·`get_minio`·`get_redis` 세 개의 인프라 접근점에만** 허용된다. `_normalize_upload_image_type` 을 교체하거나, 소유권 `if` 를 `False` 로 만들거나, `try/except` 를 제거해 얻은 PASS 는 **PASS 가 아니라 FAIL** 이다.
- **구현 착지 상태(작성 시점 재실측)**: **A1~A6·F1 7개 전부 착지.** 라인 참조는 착지 후 값이며, tester 는 **심볼명(함수·상수·로그 문자열)을 1차 앵커**로 삼고 라인은 보조로만 쓴다(A1~A6 삽입으로 `upload.py` 라인이 전부 밀렸다 — 이후 추가 이동에도 시나리오는 유효).
- **착지분 사전 정적 대조 결과(설계 ↔ 구현 일치 — 테스트 실행 아님)**:

  | 앵커 | 실측 | 대응 시나리오 |
  |---|---|---|
  | `upload.py:93` | `_normalize_upload_image_type` — `(raw or "").strip().lower()`, 허용 집합 → 별칭 → `None` 3단 | UNIT-01~05 |
  | `upload.py:169~176` | `find_one({"uploader_id":1})` → 404 → 403 이 **`object_name=` / `put_object`(`:180~186`) 앞** | UNIT-07, **API-03**(S4) |
  | `upload.py:196~202` | 캐시 삭제가 **`try/except Exception`** 으로 감싸짐, 키는 `cache:track:{id}` + `cache:track:v3:{id}`(= `update_track` 과 동일) | **UNIT-06**(S6), API-06 |
  | `upload.py:212` | profile 분기는 **로그 1줄만** 추가, 이하 무변경 | E2E-05, RT-02 |
  | `upload.py:917~919` | `mv_status` 403 이 `find_one`(`:908`) 직후 · 썸네일 조립(`:921`) 앞 | UNIT-08, **API-07**(S5) |
  | `UploadPage.jsx:1566·1568~1574` | `type='cover'`, `try/catch` + `console.error` + `setError` + `return`. **`finally { setUploading(false) }`(`:1586~1588`) 무변경** | E2E-01, **E2E-03**(R6) |

  ⚠️ 위는 **정적 대조일 뿐 PASS 판정이 아니다.** 동작 검증은 tester 가 §0-B 재기동 후 각 케이스를 실행해 판정한다.
- **🔴 planner 확인 필요**: §5 의 **A1**(로그 포맷 델타 — 사후 승인 또는 PLAN 정정)과 **A2**(RT-04 실호출로 인한 PG·MinIO 쓰기) 2건이 실질 판단을 요한다. A3~A5 는 조건부이며 대안 절차가 준비되어 있다.

## 개정 이력 (v197)

- 2026-08-21 초판 작성 (20건) — PLAN v197 §2 실측·§3 수정 설계·§4 매트릭스 A1~A6·F1·§5 R1~R11 전 항목 시나리오화.
  설계의 중심축은 **"상태코드만 보면 통과하지만 실제로는 반쪽인 수정"을 잡아내는 단언**에 두었다.
  ② 소유권의 경우 403 만 확인하면 가드를 `put_object` **뒤**에 둔 구현도 통과하므로, **V197-API-03 ④(MinIO `covers/<A>/<TRK-B>.*` 객체 부재)** 와 **V197-UNIT-07(403·404 분기의 `put_object` 호출 0회)** 을 **2중 배치**하고 둘 다 즉시 중단 조건(S4)에 연결했다.
  ①은 서버 별칭만으로는 "사용자가 실제로 커버를 본다" 까지 가지 못한다 — **V197-API-06** 이 캐시 적재→업로드→즉시 재조회 **5단계 순서**로 A4 를 감시해, 저장은 됐는데 최대 600초 안 보이는 재발(원증상과 구별되지 않는다)을 차단한다.
  가장 값비싼 제약인 **`/api/tracks/upload` 2회 예산**은 **V197-E2E-03 에서 `POST /api/tracks/upload` 자체를 브라우저 인터셉트로 합성 200 처리**해 해결했다 — 덕분에 e2e 5건을 유지하면서도 유료 호출은 **1회(예비 1회 온전)** 에 머문다. E2E-04 도 `/upload/generate-cover` 대신 **Mongo 직접 삽입 + E2E-01 산출 객체 재사용**으로 유료 경로를 우회했다.
  R4(Redis 신규 의존)는 실 Redis 를 죽이지 않고 **UNIT-06 의 예외 던지는 스텁**으로 재현하며, `get_redis()` 가 `None` 을 반환하는 실운영 초기 상태까지 부속 단언으로 덮었다.
  **가드 우회 금지(S1)** 를 명문화해, 스텁 허용 범위를 `get_mongo`·`get_minio`·`get_redis` **3개 인프라 접근점**으로 못박고 "가드를 꺼서 얻은 PASS 는 FAIL" 을 판정 규칙으로 세웠다.
  미러링 검증 **0건**(백엔드는 `backend_9006` 하나뿐), 실사용자 트랙 **변조·열람 0**(RT-06 집계 1회만, 승인 항목 A5).
  태그 균형은 순수 함수·가드 분기를 unit 으로, 화면 발현만 e2e 로 배치해 **40.0 / 35.0 / 25.0** 정확히 확보. planner 승인 대기 5건(§5) — **전부 대안 절차가 있어 20건·비율이 깨지지 않는다.** planner 검토 후 확정 예정.
