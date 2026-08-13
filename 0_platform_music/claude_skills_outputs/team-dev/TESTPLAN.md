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
