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
