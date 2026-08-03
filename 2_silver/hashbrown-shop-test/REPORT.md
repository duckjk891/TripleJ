# REPORT.md — hashbrown-shop-test 음성 입출력(STT/TTS) 추가

- **버전**: v1
- **수정일자**: 2026-07-07
- **요청 작업**: AI 채팅에 음성 입출력 추가 — OpenAI 음성 API 방식 (STT: gpt-4o-transcribe/whisper-1, TTS: gpt-4o-mini-tts). PLAN.md v1 기준.

---

## 1. 수행 결과

### 1.1 백엔드 (`server.mjs`) — backend-dev
- **`POST /api/stt` 신설**: raw 오디오 바이너리 수신(`express.raw({ type: 'audio/*', limit: '25mb' })`, 멀티파트 불필요). Content-Type(webm/mp4/mpeg → 확장자 매핑, codecs 파라미터 포함 매칭) 기반으로 Node 22 내장 fetch/FormData/Blob으로 OpenAI transcriptions 호출. `gpt-4o-transcribe` 실패 시 `whisper-1` 자동 폴백(1회), `language: 'ko'`. 응답 `{ "text": "..." }`.
- **`POST /api/tts` 신설**: JSON `{ text(1~4096자), voice? }` → OpenAI `/v1/audio/speech` (`gpt-4o-mini-tts`, 기본 voice `nova`, 어르신 친화 한국어 톤 instructions) → `audio/mpeg`(mp3) 반환.
- **공통 에러 형식**: `{ error: { code, message, requestId } }` + `X-Request-Id` 헤더. 코드: `EMPTY_AUDIO`/`EMPTY_TEXT`/`TEXT_TOO_LONG`(400), `OPENAI_STT_FAILED`/`OPENAI_TTS_FAILED`(502).
- 모델/voice는 환경변수(`STT_MODEL`/`TTS_MODEL`/`TTS_VOICE`)로 오버라이드 가능 — `.env.example`에 변수명 추가(키 값 미기록).
- **신규 npm 의존성 없음.** 기존 `/api/chat` 무변경.
- 로그: `[stt:<requestId>]`/`[tts:<requestId>]` prefix로 진입(바이트/텍스트 길이)·OpenAI 호출 전후(모델·상태코드·소요 ms)·에러 기록. STT 결과는 앞 50자만. API 키는 어디에도 미출력.

### 1.2 프론트엔드 — frontend-dev
- **`src/api/index.ts` 신설**: 백엔드 호출 전용 모듈. `transcribeAudio(blob)` / `synthesizeSpeech(text, voice?)` + 공통 에러 스펙 파싱 `ApiError`(code/requestId 보존). 상대경로 `/api/*`만 사용, 호스트/포트 하드코딩 없음. 컴포넌트의 직접 fetch 없음(검증 완료).
- **`src/hooks/useVoiceRecorder.ts` 신설**: MediaRecorder 래퍼. mimeType 분기 — `audio/webm;codecs=opus`(안드로이드/PC) → `audio/mp4`(iOS Safari) → 브라우저 기본. stop/언마운트 시 마이크 트랙 해제, 권한 거부·장치 없음 등 한국어 에러 메시지 제공.
- **`src/components/ChatPanel.tsx`**:
  - 🎤 버튼(58×58px, 녹음 중 펄스): 탭→녹음 시작("🔴 말씀하세요…" 안내), 재탭→STT→인식 텍스트를 기존 `sendMessage` 경로로 자동 전송. 빈 녹음/빈 인식 결과는 안내만 표시.
  - 🔊 음성응답 토글(켜짐/꺼짐 라벨 명시, `aria-pressed`): 켜는 클릭 시점에 무음 WAV로 audio unlock(iOS 자동재생 정책 대응), 공유 `<audio>` 엘리먼트 재사용.
  - TTS 트리거: `isWorking`(isSending‖isReceiving‖isRunningToolCalls) true→false 전이 감지 → `lastAssistantMessage.content.ui`에서 `$tag === 'Markdown'` 노드의 텍스트만 재귀 수집(상품카드/장바구니/주문카드는 자동 제외) → 마크다운 기호 제거 → 4096자 절단 → 재생. 메시지 인덱스 기반 중복 발화 방지, 세대 토큰으로 새 요청 시작 시 이전 재생 중지(중첩 방지), objectURL revoke 정리.
- **`src/styles.css`**: 음성 UI 스타일(대형 버튼·펄스·상태줄) + 768px 이하 모바일 시트 대응.
- **`src/vite-env.d.ts` 신설**: `import.meta.env` 타입 참조.
- 로그: DEV 가드 하 `[ChatPanel]`/`[useVoiceRecorder]`/`[api]` prefix `console.info`, 에러는 항상 `console.error`.

## 2. 테스트 결과 요약 (tester — 전 항목 PASS)

| # | 항목 | 결과 |
|---|---|---|
| A1 | TTS 정상 (200, audio/mpeg, mp3 유효) | PASS |
| A2 | TTS→STT 왕복 검증 (의미 일치) | PASS (오인식 1건 minor, §3 참조) |
| A3 | STT Content-Type 분기 (webm/mp4/mpeg, codecs 파라미터 포함) | PASS — gpt-4o-transcribe 확장자 불일치 400 시 whisper-1 폴백 실동작 확인 |
| A4 | 에러 3종 (EMPTY_AUDIO/EMPTY_TEXT/TEXT_TOO_LONG) 400 형식 + requestId/X-Request-Id | PASS |
| A5 | 서버 로그 API 키 유출 검사 | PASS (0건) |
| B6 | 채팅 스트리밍 + ProductCard 툴콜 회귀 | PASS |
| B7 | 툴콜 연쇄 (담기→CartCard→주문→OrderCard) 회귀 | PASS |
| B8 | /api/chat 직접+프록시 회귀, 외부 터널 경유 /api/tts 200 | PASS |
| B9 | `tsc --noEmit` / `vite build` | PASS |

**미검증 잔여**: 브라우저 실기기 수동 테스트(마이크 권한 플로우, iOS Safari 재생 정책·audio/mp4 녹음) — 사용자가 직접 수행 예정.

## 3. 특이사항
1. **STT 오인식 1건 (minor)**: 왕복 테스트에서 "지팡이" → "집합이" 오인식. 코드 결함이 아닌 음성인식 모델 정확도 문제. 실사용 시 인식 결과가 사용자 말풍선으로 표시되므로 오인식 여부를 눈으로 확인 가능.
2. **iOS 실기기 미검증**: audio unlock(토글 클릭 시 무음 재생)으로 자동재생 정책에 대응했으나 실기기 확인 전까지 잔여 리스크 있음. cloudflare https 터널 경유 접속 필요(getUserMedia는 https 필수).
3. **1차 테스트 blocker는 코드 결함 아님**: 오케스트레이터가 백엔드를 잘못된 cwd에서 재기동한 운영 실수였고, 올바른 디렉토리에서 재기동 후 해소됨.
4. **계획 대비 이탈 없음** (planner 최종 코드 검수): API 스펙(경로/요청/응답/에러 형식) 일치, 로그 규칙(requestId prefix·DEV 가드·키 미출력) 준수, 프론트는 `src/api/index.ts` 경유만 호출, 신규 의존성 없음. 사소한 개선 구현 2건 — 프론트에서 TTS 입력을 4096자로 선절단(불필요한 400 방지), STT 인식 텍스트를 입력창에 잠깐 표시 후 전송(사용자 피드백).

## 4. 남은 권장사항
- iOS Safari / 안드로이드 크롬 실기기에서 §2 미검증 항목 수동 확인 (마이크 권한 허용/거부, 음성응답 재생, 모바일 시트 내 버튼 크기).
- 오인식 완화가 필요해지면: STT 결과를 바로 전송하지 않고 확인 후 전송하는 옵션, 또는 `prompt` 파라미터로 도메인 단어(지팡이·보행보조차 등) 힌트 제공 검토.
- 응답이 길 때 TTS 지연이 체감되면 문장 단위 분할 스트리밍 재생 검토 (현재는 응답 완료 후 일괄 합성).
- 장기적으로 음성응답 토글 상태 localStorage persist 고려 (현재 세션 한정).

---

# REPORT v2 — TTS 목소리·말투 개선

- **버전**: v2
- **수정일자**: 2026-07-13
- **요청 작업**: 음성 응답이 기계같이 들린다는 피드백 반영 — TTS 기본 voice 교체(nova → 최신 자연 음성) + 말투 지시문(TTS_INSTRUCTIONS)을 "상냥하고 또박또박하면서 나긋나긋하게" 톤으로 재작성.

## 1. 수행 결과

### 1.1 voice 지원 사전 검증 (실제 OpenAI API 호출)
`gpt-4o-mini-tts`에 후보 4종을 직접 호출한 결과 **전부 지원 확인** (모두 200 + 유효 mp3):

| voice | HTTP | 비고 |
|---|---|---|
| **marin** | 200 | **채택 (1순위)** — MPEG layer III, 24 kHz mono 정상 |
| cedar | 200 | 폴백 1순위 (미사용) |
| coral | 200 | 폴백 후보 (미사용) |
| sage | 200 | 폴백 후보 (미사용) |

→ marin/cedar가 realtime 계열 출신이지만 gpt-4o-mini-tts에서도 정상 동작. 400 폴백 시나리오 발생하지 않음.

### 1.2 변경 내역 (backend)
- `server.mjs:17` — `TTS_VOICE` 기본값 `'nova'` → **`'marin'`**
- `server.mjs:18-19` — `TTS_INSTRUCTIONS` 재작성 (전문):
  > 당신은 어르신을 모시는 쇼핑 안내 도우미입니다. 상냥하고 나긋나긋한 말투로, 서두르지 않고 한 마디 한 마디 또박또박, 어르신께 차분히 안내해 드리듯 부드럽고 자연스럽게 한국어로 읽어주세요.
- `.env.example` — `# TTS_VOICE=nova` → `# TTS_VOICE=marin`
- 그 외 로직·로그 무변경 (voice는 기존 `[tts:<requestId>]` 로그에 이미 출력됨을 확인).

### 1.3 frontend — 무변경 (계획대로 할당 생략)
`src/api/index.ts`의 `synthesizeSpeech`는 voice 미전달 시 요청 body에 voice 필드를 포함하지 않아 서버 기본값이 적용되고, `ChatPanel.tsx`도 voice 미전달로 호출 → 백엔드 상수 교체만으로 전 구간 반영.

## 2. 테스트 결과 (v2 — 전 항목 PASS)

백엔드는 프로젝트 디렉토리(2_silver/hashbrown-shop-test)에서 기존 프로세스 종료 후 재기동 (v1 때 cwd 실수 재발 없음. 잔여 stale 프로세스 1개도 함께 정리).

| # | 항목 | 결과 |
|---|---|---|
| 1 | `/api/tts` 200 + `audio/mpeg` + 112,128 bytes, `file` 판정 유효 mp3, `X-Request-Id` 정상 | PASS |
| 2 | 서버 로그 `[tts:<id>] incoming ... voice=marin` 출력 | PASS |
| 3 | marin 400 시 폴백 교체 (조건부) | 해당 없음 — marin 200 확인, 폴백 불필요 |
| 4a | 회귀 `/api/stt` — 새 marin 음성 mp3 왕복 인식 | PASS (의미 일치; "안녕하세요"→"안녕하십겠어요" 경미한 오인식 1건, 모델 정확도 문제·minor) |
| 4b | 회귀 `/api/chat` — 200 + `application/octet-stream` 스트림(628B) 수신 | PASS |
| 5 | 에러 형식 회귀 (`EMPTY_TEXT` 400 + requestId) | PASS |
| 6 | 서버 로그 API 키 유출 검사 | PASS (0건) |

## 3. 특이사항
- 없음 (계획 대비 이탈 없음). 실제 청감(자연스러움 체감) 확인은 사용자 브라우저에서 🔊 토글 후 직접 확인 권장.
- 참고: `.env`에 `TTS_VOICE`를 명시 설정한 환경이라면 그 값이 우선함 — 현재 프로젝트 `.env`에는 미설정이라 새 기본값 marin이 적용됨(확인 완료).

## 4. 남은 권장사항
- 사용자 실청취 후 톤이 여전히 딱딱하면 `TTS_VOICE=cedar`(.env 한 줄)로 즉시 교체 가능 — 코드 수정 불필요.
- 말투 미세 조정도 `TTS_INSTRUCTIONS` 문안만 다듬으면 됨 (속도·높낮이 지시 추가 여지).

---

# REPORT v3 — 어르신 친화 UI 리디자인

- **버전**: v3
- **수정일자**: 2026-07-13
- **요청 작업**: 승인된 Figma 홈 화면 시안의 디자인 언어(크림 배경 `#FFF9F2` + 진초록 `#1C784D` / 주황 `#D96B21` + 대형 타이포)를 실제 앱에 구현. 채팅 화면은 동일 디자인 언어로 구현. 순수 프론트 스타일/마크업/문구 — 기능 로직 무변경.

## 1. 변경 파일 목록
| 파일 | 변경 내용 |
|---|---|
| `src/styles.css` | 전면 리스타일 (클래스명 전부 유지, CSS 변수 토큰화) |
| `src/App.tsx` | 모바일 하단 버튼 문구 `💬` → `🎤 말로 주문하기`(열림 시 `✕` 유지), aria-label 갱신, 클릭 핸들러에 DEV 가드 `[App]` 로그 추가 |
| `src/components/ChatPanel.tsx` | 문구만 2곳: 헤더 `🤖 AI 도우미` + `말씀만 하세요, 다 찾아드려요`, 토글 라벨 `🔊 켜짐`/`🔇 꺼짐` |

**무변경 확인(git diff)**: `store.ts`, `hooks/`, `api/`, `data/`, `components/chat/*`(카드 3종+Markdown), `ProductGrid.tsx`, `CartPanel.tsx`, `server.mjs`(v2 상태 그대로) — 기능 로직 0건 변경.

## 2. 주요 클래스/스타일 변경 요약
- **토큰**: `:root` CSS 변수 도입 (`--bg #FFF9F2`, `--green #1C784D`, `--orange #D96B21`, `--price #BF5414`, `--card-border #E6DBCC`, `--text #212121`, `--text-sub #6B6357`).
- **카드 공통** (`.product-card`/`.cart-panel`): 흰 배경 + 1.5px `#E6DBCC` 테두리 + radius 20px + 그림자 `0 4px 12px rgba(77,64,38,0.08)`. 채팅 내 카드(`.chat-product-card`/`.chat-cart-card`/`.chat-order-card`/어시스턴트 말풍선)는 radius 16px 동일 언어.
- **타이포 확대**: 페이지 제목 30px/부제 18px, 섹션 23px, 상품명 22px/설명 16px/가격 24px(`#BF5414`), 전역 버튼 20px bold, 채팅 본문 14→18px, 채팅 헤더 24px/부제 15px.
- **버튼**: 전역 파랑 → 진초록(`--green`), radius 12px. `.mic-btn` 58→62px 원형 **주황**(녹음 중 빨강 펄스 유지), `.voice-toggle` pill — 켜짐 진초록/꺼짐 회색(`#EFEAE2`).
- **모바일(≤768px)**: 상품 그리드 2열 → **1열 큰 카드**. `.chat-fab` 우하단 58px 원형 → **전폭 주황 바 "🎤 말로 주문하기"** (left/right 16px, min-height 64px, radius 18px, 하단 고정, shop-side 하단 여백 104px). 채팅 열림 시 우상단 소형 ✕(48px 원형)는 기존 `.chat-side-open ~ .chat-fab` 형제 선택자 그대로 유지 — App.tsx DOM 순서 불변으로 동작 보장.
- **스코프 아웃**: 카테고리 필터는 현재 미구현 상태라 추가하지 않음 (PLAN v3 findings 5항, 지시 준수).

## 3. 테스트 결과 (v3 — 전 항목 PASS)
| # | 항목 | 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` / `npm run build` | PASS (build 3.58s, css 8.38 kB) |
| 2 | vite(5180) HTML 200 + 신규 CSS 토큰 서빙(`#FFF9F2`/`#1C784D`/`#D96B21`/768px 미디어쿼리/1열 그리드/64px 바/형제 선택자) | PASS (전 토큰 확인) |
| 3a | `chat-side` → `chat-fab` 형제 DOM 순서 유지 + 선택자 생존 | PASS |
| 3b | 기능 연결 클래스 18종(mic-btn/voice-toggle/chat-input-row/카드류 등) CSS 존재 | PASS (누락 0) |
| 3c | 로직 파일 무변경 (git diff: store/hooks/api/chat 컴포넌트/서버) | PASS |
| 4 | API 무영향 — `/api/tts`(5180 프록시) 200 audio/mpeg, `/api/stt` 왕복 인식 정상, `/api/chat`(3100) 200 octet-stream | PASS |

## 4. 특이사항
1. **vite(5180)가 실제로는 내려가 있었음**: 코디네이터는 3개 서버 기동 중으로 인지했으나, 확인 결과 5180에는 리스너가 없었고 떠 있던 vite 프로세스는 **다른 프로젝트(0_platform_music/frontend)** 소속이었음. 본 프로젝트 디렉토리에서 vite를 재기동 후 테스트 완료 (v1의 cwd 사고와 유사한 운영 이슈 — 코드 결함 아님). cloudflare 터널이 5180을 가리키므로 터널 경유 접속도 재기동으로 회복됐을 것이나, 터널 프로세스 상태는 별도 확인 권장.
2. 실 브라우저 스크린샷 검증 불가 환경 — 뷰포트별 실제 렌더 확인(모바일 1열 카드, 주황 바, 채팅 시트)은 사용자 육안 확인 필요.

## 5. 남은 권장사항
- 실기기(모바일)에서 하단 주황 바와 iOS 사파리 safe-area(홈 인디케이터) 겹침 확인 — 필요 시 `env(safe-area-inset-bottom)` 패딩 추가.
- 채팅 화면도 Figma 시안으로 역제작(코드→디자인)해 두면 이후 시안-코드 싱크에 유리.

---

# REPORT v4 — 이용 로깅 보강 (누가·언제·어떻게)

- **버전**: v4
- **수정일자**: 2026-07-14
- **요청 작업**: 백엔드 전 로그 시각화, 접속자 IP/User-Agent 기록(터널·프록시 경유 실 IP 해석), 대화 내용 로깅(프론트 원격 로깅), 장바구니/주문 이벤트, 세션 ID, 영속 로그 파일.

## 1. 수행 결과

### 1.1 백엔드 (`server.mjs`)
- 로그 헬퍼 신설: 모든 라인에 **KST 시각** 접두, stdout + `logs/access.log` 동시 기록 (단일 write stream — appendFile 비동기 경쟁으로 라인 순서 섞이는 문제를 테스트 중 발견해 수정).
- `clientInfo()` 헬퍼: `cf-connecting-ip`(터널) → `x-forwarded-for` 첫 항목(vite xfwd) → `socket.remoteAddress` 순 실 IP 해석 + User-Agent + `X-Session-Id`.
- `/api/stt`·`/api/tts` 진입 라인에 `[sess][ip] ... ua=""` 추가, **TTS에 preview 80자** 추가(응답 내용 이중 안전망).
- `/api/chat`: requestId 부여 + 진입 로그(메시지 수/IP/UA) + 스트림 완료 바이트 로그. 스트리밍 로직 무변경.
- **`POST /api/log` 신설**: `{event(≤64자), data}` 수신 → 로그 기록, 204 응답. `EMPTY_EVENT` 400(공통 에러 형식). data는 2000자 절단.
- `.gitignore`에 `logs/` 추가 (대화 내용 포함 — 커밋 금지).

### 1.2 프론트엔드
- `vite.config.ts`: `/api` 프록시 객체형 + `xfwd: true`.
- `src/api/index.ts`: `getSessionId()`(localStorage 8자리 영속), `logEvent()`(fire-and-forget, keepalive, 실패 무해화), `transcribeAudio`/`synthesizeSpeech`에 `X-Session-Id` 헤더.
- `ChatPanel.tsx`(로깅 훅만): `user_message` — 키보드(onSubmit)·음성(STT 성공 경로) 각각 `source` 구분 전송. `assistant_response` — 기존 isWorking 전환 감지 effect에서 `collectMarkdownText` 재사용, **별도 dedup(`lastLoggedIndexRef`)으로 음성 OFF여도 항상 로깅**. 발화 로직(순서·조건·speakSeqRef·dedup)은 불변.
- `store.ts`: 장바구니 변경 3경로(AI 툴/담기 버튼/± 버튼)가 모두 zustand 액션을 경유함을 확인하고 액션 내부에서 단일 로깅 — `cart_add`/`cart_remove`/`cart_set_quantity`/`order_checkout`(주문번호·총액·품목 요약).

### 1.3 새 로그 포맷 (실제 출력 예시)
```
[2026-07-14 17:03:54] [log:480c8d02] [sess:test1234] [ip:127.0.0.1] event=user_message data={"source":"keyboard","text":"지팡이 추천해줘"} ua="TestAgent/1.0"
[2026-07-14 17:03:54] [tts:a0be6daf] [sess:test1234] [ip:127.0.0.1] incoming textLength=26 voice=marin preview="로그 보강 확인용 문장입니다. 사만오천원입니다." ua="curl/7.68.0"
[2026-07-14 17:05:14] [log:0c69d17d] [sess:tunnelchk] [ip:211.217.32.183] event=user_message data={...} ua="curl/7.68.0"   ← 터널 경유: 실 공인 IP
[2026-07-14 17:03:58] [chat:d8eb6017] [sess:-] [ip:127.0.0.1] incoming messages=1 ua="curl/7.68.0"
[2026-07-14 17:04:00] [chat:d8eb6017] stream completed bytes=1291
```

## 2. 테스트 결과 (v4 — 전 항목 PASS)
| # | 항목 | 결과 |
|---|---|---|
| 1 | `tsc --noEmit` / `vite build` | PASS |
| 2 | `/api/log` 204(직접+프록시) + 로그 라인(시각/sess/ip/ua) + `EMPTY_EVENT` 400 | PASS |
| 3 | `/api/stt`·`/api/tts` 회귀 + 세션 헤더 로그 반영 + TTS preview 80자 | PASS |
| 4 | `/api/chat` 회귀(200 octet-stream) + 진입/완료(bytes) 로그 | PASS |
| 5 | **터널 경유 시 실 공인 IP**(`cf-connecting-ip` → 211.217.32.183) 기록 | PASS |
| 6 | `logs/access.log` 생성·append + 라인 순서 정상(write stream 수정 후) | PASS |
| 7 | `git status`에 logs/ 미노출 (gitignore 유효) | PASS |
| 8 | 로그 파일 API 키 유출 0건 | PASS |

재기동: 백엔드·vite 모두 프로젝트 디렉토리에서 수행(vite는 xfwd config 반영 위해 재시작). 터널(5180 고정)은 유지되어 경유 검증까지 완료.

## 3. 특이사항
1. **appendFile 순서 경쟁 결함을 테스트에서 발견·즉시 수정**: 초기 구현(fs.appendFile)에서 stt `calling` 라인이 `incoming`보다 먼저 기록되는 사례 확인 → 단일 `createWriteStream(flags:'a')`으로 교체 후 순서 정상 확인.
2. `/api/chat`은 Hashbrown 내부 transport라 `X-Session-Id` 헤더 미부착(`[sess:-]`) — 대화 내용 자체는 `/api/log`(세션 포함)로 기록되므로 추적에 공백 없음 (PLAN v4 findings 5항).
3. `user_message`/`assistant_response`/`cart_*` 이벤트의 실브라우저 E2E는 사용자 확인 필요 (배선은 코드 레벨 + 엔드포인트 시뮬레이션으로 검증).

## 4. 남은 권장사항
- 로그 파일이 커지면 날짜별 로테이션(`access-YYYY-MM-DD.log`) 도입.
- 대화 내용이 담기므로 운영 전 개인정보 안내(수집 고지) 문구 검토.
- 세션 ID는 localStorage 영속(브라우저당 1개) — "방문 단위" 구분이 필요해지면 sessionStorage 병행 검토.
