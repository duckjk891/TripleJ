# PLAN.md — hashbrown-shop-test 음성 입출력(STT/TTS) 추가

- **버전**: v1
- **수정일자**: 2026-07-07
- **요청 작업**: AI 채팅에 음성 입출력 추가 (방법 B: OpenAI 음성 API)
  - 음성입력(STT): 프론트 녹음(MediaRecorder) → 백엔드 `/api/stt` → OpenAI 음성인식 → 텍스트를 `sendMessage`로 전송
  - 음성출력(TTS): AI 응답 완료 후 Markdown 텍스트만 추출 → 백엔드 `/api/tts` → OpenAI TTS(gpt-4o-mini-tts, 한국어) → 오디오 재생. 상품카드 등 UI 컴포넌트는 화면 표시만.
  - UI: 노인 친화적 큰 🎤 버튼(누르면 녹음 시작, 다시 누르면 전송), 음성 응답 켜기/끄기 토글(🔊)
  - iOS(audio/mp4) / 안드로이드·PC(audio/webm) 녹음 포맷 차이 대응

---

## 1. Plan verification findings (사전 코드 분석 결과 — 추정 아님, 직접 확인)

### 1.1 백엔드 (`server.mjs`)
- Express 4, 포트 3100(`process.env.PORT` 기본 3100), host 기본 `localhost`.
- 전역 미들웨어: `cors()`, `express.json()`. **`express.json()`은 `Content-Type: application/json`만 파싱**하므로, `/api/stt`에 라우트 전용 `express.raw()`를 붙여도 충돌 없음 (audio/* 요청은 json 파서가 건드리지 않고 통과).
- 엔드포인트는 `POST /api/chat` 하나뿐: `HashbrownOpenAI.stream.text({ apiKey, request: req.body })`를 `application/octet-stream`으로 스트리밍.
- `OPENAI_API_KEY`는 `.env`에서 로드, 부재 시 기동 실패. (키 값은 어떤 로그/문서에도 기록 금지)

### 1.2 Node 런타임
- **Node v22.19.0 확인** (`node --version`). 내장 `fetch` / `FormData` / `Blob` / `crypto.randomUUID()` 모두 사용 가능.
- 결론: **multer 등 멀티파트 파서 불필요**. 프론트가 오디오를 raw binary body로 보내고, 백엔드는 `express.raw({ type: 'audio/*', limit: '25mb' })`로 Buffer로 받은 뒤, 내장 `FormData` + `new Blob([buffer], { type })`로 OpenAI `/v1/audio/transcriptions`에 전달하는 방식이 성립. `openai` npm 패키지 추가 불필요(내장 fetch로 REST 직접 호출).

### 1.3 프론트 구조
- `vite.config.ts`: 포트 5180, `host: 0.0.0.0`, `allowedHosts: ['.trycloudflare.com']`, `usePolling`, **`/api` → `http://localhost:3100` 프록시**. 신규 엔드포인트도 `/api/*` 경로면 추가 설정 없이 프록시됨.
- `src/App.tsx`: `HashbrownProvider url="/api/chat"`, 모바일 채팅 시트(`chatOpen` state + `.chat-fab` 💬 버튼).
- `src/store.ts`: zustand. `cart/orders/addToCart/removeFromCart/setQuantity/clearCart/checkout`. 음성 기능과 직접 충돌 없음 — **store 변경 불필요** (음성 상태는 ChatPanel 로컬 state로 충분).
- `src/data/products.ts`: 상품 8종 정적 데이터. 변경 불필요.
- **API 클라이언트 모듈 없음 확인**: `src/api/` 디렉토리 부재. 프론트에서 fetch를 직접 쓰는 곳도 현재 없음(채팅은 Hashbrown 내부 transport). → `src/api/index.ts` 신설.

### 1.4 `ChatPanel.tsx` / `useUiChat` 핵심 사실 (node_modules d.ts 직접 확인)
- `useUiChat` 반환값 (node_modules/@hashbrownai/react/src/hooks/use-ui-chat.d.ts):
  - `messages: UiChatMessage<Tools>[]`, `sendMessage(message: Chat.Message<UiChatSchema, Tools>)`, `isSending/isReceiving/isRunningToolCalls: boolean`, **`lastAssistantMessage: UiAssistantMessage<Tools> | undefined`** (현재 ChatPanel에서 미사용이지만 훅이 제공 — TTS 트리거에 사용).
- **응답 완료 시점**: ChatPanel은 이미 `isWorking = isSending || isReceiving || isRunningToolCalls`를 계산 중. `isWorking`이 true → false로 전이하는 순간(= 스트리밍·툴콜 모두 종료)이 "응답 완료". `useEffect` + `useRef`(직전 isWorking 값)로 감지 가능.
- **Markdown 원본 텍스트 접근 (핵심)**: `UiAssistantMessage<Tools> = Chat.AssistantMessage<UiChatSchema, Tools> & { ui: ReactElement[] | null }`. 그리고 core의 `AssistantMessage`는 `{ role: 'assistant'; content?: Output; toolCalls: [...] }` (core/src/models/view.models.d.ts:52).
  - 즉 `message.content`가 **구조화된 `UiChatSchema`**:
    ```ts
    interface UiChatSchemaComponent {
      $tag: string;                                  // 예: 'Markdown', 'ProductCard'
      $children: string | UiChatSchemaComponent[];   // Markdown은 children: 'text' → string
      $props: Record<string, any>;
    }
    interface UiChatSchema { ui: UiChatSchemaComponent[]; }
    ```
  - **React 엘리먼트 트리(`message.ui`)를 파싱할 필요 없음.** `lastAssistantMessage.content?.ui`를 순회하며 `$tag === 'Markdown'`인 노드의 `$children`(string)만 모으면 TTS 입력 텍스트가 나옴. `$children`이 배열인 경우(중첩 컴포넌트)는 재귀 처리하되 Markdown 외 태그는 건너뜀 → 상품카드/장바구니/주문카드는 자동으로 음성 제외.
  - 스트리밍 중에는 `content`가 부분 파싱 상태일 수 있으므로 **반드시 isWorking 완료 전이 후에만** 추출.
- ChatPanel 입력부: `.chat-input-row`에 textarea + 보내기/중지 버튼. `onSubmit`이 `Chat.UserMessage { role:'user', content }`를 `sendMessage`로 전송 — STT 결과도 동일 경로 사용.

### 1.5 사양 vs 코드 충돌 여부
- 충돌 없음. 단 2가지 **조정안**:
  1. STT 모델: 1순위 `gpt-4o-transcribe`, 호출 실패(4xx: 모델 미지원 등) 시 `whisper-1`로 1회 폴백. 모델명은 server.mjs 상수(환경변수 `STT_MODEL`로 오버라이드 가능)로 두어 교체 용이하게.
  2. iOS 자동재생 정책: 응답 완료 후 fetch를 거쳐 재생하면 사용자 제스처 체인이 끊겨 iOS Safari가 `audio.play()`를 거부할 수 있음. 대응: **음성 토글을 켜는 클릭 시점에 `<audio>` 엘리먼트를 1회 unlock**(무음 재생)하고 이후 같은 엘리먼트를 재사용(src 교체). 이는 표준적인 우회책이며 이번 구현에 포함.

---

## 2. 확정 REST API 스펙 (backend-dev / frontend-dev 공통 계약 — 병렬 작업 기준)

공통 에러 응답 형식 (모든 신규 엔드포인트):
```json
{ "error": { "code": "STRING_CODE", "message": "사람이 읽을 메시지", "requestId": "ab12cd34" } }
```
- `requestId`: 백엔드가 `crypto.randomUUID().slice(0, 8)`로 생성, 응답 헤더 `X-Request-Id`에도 포함.

### 2.1 `POST /api/stt` — 음성 → 텍스트
- **요청**: raw binary body (멀티파트 아님).
  - `Content-Type`: `audio/webm`(안드로이드/PC) | `audio/mp4`(iOS) | `audio/mpeg`(테스트용 mp3). 기타 `audio/*`는 webm으로 간주.
  - 본문 최대 25MB (OpenAI transcription 파일 한도와 동일; `express.raw({ type: 'audio/*', limit: '25mb' })`).
- **백엔드 처리**: Content-Type → 확장자 매핑(webm/mp4/mp3) 후 내장 `FormData`에 `file`(Blob, filename `audio.<ext>`), `model`(기본 `gpt-4o-transcribe`, 실패 시 `whisper-1` 폴백 1회), `language: 'ko'` 첨부 → `POST https://api.openai.com/v1/audio/transcriptions`.
- **응답 200**: `{ "text": "인식된 문장" }`
- **에러**:
  - `400 EMPTY_AUDIO` — body 없음/0바이트
  - `413` — 25MB 초과 (express.raw가 자동 처리; 프론트는 `error.code` 없을 수 있음을 허용)
  - `502 OPENAI_STT_FAILED` — OpenAI 호출 실패(폴백 포함 모두 실패)

### 2.2 `POST /api/tts` — 텍스트 → 음성
- **요청**: `Content-Type: application/json`
  ```json
  { "text": "읽어줄 한국어 텍스트", "voice": "nova" }
  ```
  - `text`: 필수, 1~4096자 (OpenAI TTS input 한도).
  - `voice`: 선택, 기본 `"nova"` (허용: OpenAI 지원 voice 문자열, 검증은 OpenAI에 위임).
- **백엔드 처리**: `POST https://api.openai.com/v1/audio/speech` with `{ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3', instructions: '한국어로 어르신께 말하듯 따뜻하고 또박또박, 너무 빠르지 않게 읽어주세요.' }` → 응답 바디를 그대로 클라이언트로 전달(버퍼 후 send 또는 스트림 파이프).
- **응답 200**: `Content-Type: audio/mpeg`, mp3 바이너리.
- **에러**:
  - `400 EMPTY_TEXT` — text 누락/공백만
  - `400 TEXT_TOO_LONG` — 4096자 초과
  - `502 OPENAI_TTS_FAILED` — OpenAI 호출 실패
- 모델명은 환경변수 `TTS_MODEL`(기본 `gpt-4o-mini-tts`)로 오버라이드 가능.

### 2.3 기존 `POST /api/chat` — 변경 없음 (회귀 대상)

---

## 3. 변경 매트릭스

### 3.1 backend-dev
| 파일 | 작업 |
|---|---|
| `server.mjs` | (1) `POST /api/stt` 추가 — 라우트 전용 `express.raw({ type: 'audio/*', limit: '25mb' })`, §2.1 스펙 구현. Node 내장 fetch/FormData/Blob 사용, 신규 npm 의존성 금지. gpt-4o-transcribe → whisper-1 폴백 로직 포함. (2) `POST /api/tts` 추가 — §2.2 스펙 구현. (3) 두 라우트 공통 requestId 생성 + `X-Request-Id` 헤더 + 통일 에러 JSON 헬퍼. |
| `.env.example` | `STT_MODEL=`, `TTS_MODEL=`, `TTS_VOICE=` 주석 예시 추가 (키 값 기록 금지, 변수명만). |

**백엔드 디버깅 로그 규칙** (필수):
- 형식: `console.log('[stt:<requestId>] ...')` / `[tts:<requestId>]`.
- 필수 로그 지점: ① 요청 진입(수신 바이트 수·Content-Type / text 길이) ② OpenAI 호출 직전(모델명) ③ OpenAI 응답 수신(상태코드, 소요 ms, 결과 크기 또는 텍스트 길이) ④ 에러(`console.error`, OpenAI 에러 바디 포함하되 **Authorization 헤더/키 값은 절대 출력 금지**).
- STT 인식 결과 텍스트는 앞 50자만 로그(개인정보 최소화).

### 3.2 frontend-dev
| 파일 | 작업 |
|---|---|
| `src/api/index.ts` **(신설)** | 백엔드 호출 전용 모듈. `transcribeAudio(blob: Blob): Promise<string>` — `POST /api/stt`, `Content-Type: blob.type \|\| 'audio/webm'`, body는 blob 그대로. `synthesizeSpeech(text: string): Promise<Blob>` — `POST /api/tts` JSON, 응답 blob 반환. 비-2xx면 §2 에러 JSON을 파싱해 `Error(code + message)` throw. **경로는 상대경로 `/api/*`만 사용, 호스트/포트 하드코딩 금지.** |
| `src/hooks/useVoiceRecorder.ts` **(신설)** | MediaRecorder 래퍼 훅. mimeType 선택: `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')` → webm, 아니면 `'audio/mp4'`(iOS Safari), 둘 다 아니면 브라우저 기본(`''`). `start()/stop(): Promise<Blob>`(onstop에서 `recorder.mimeType` 기반 Blob 조립), `isRecording`, `error`(마이크 권한 거부 등) 노출. stop 후 `MediaStream` 트랙 정리(getTracks().stop()). |
| `src/components/ChatPanel.tsx` | (1) 🎤 버튼 추가(`.chat-input-row` 옆, 최소 56px 터치 타깃): 탭 → 녹음 시작(버튼 빨강/펄스 + "말씀하세요…"), 다시 탭 → 녹음 종료 → "인식 중…" 표시 → `transcribeAudio` → 결과 텍스트를 기존 `sendMessage({ role:'user', content:text })` 경로로 즉시 전송(빈 결과면 안내만). (2) 🔊 음성응답 토글(chat-header 영역, 큰 버튼, on/off 라벨 명시): 켜는 클릭 시 공유 `<audio>` 엘리먼트 unlock(무음 play) — iOS 대응. (3) TTS 트리거: `isWorking` true→false 전이를 `useEffect`+`useRef`로 감지 → `lastAssistantMessage.content?.ui`에서 `$tag === 'Markdown'` 노드의 `$children`(string) 재귀 수집·`'\n'` join → 마크다운 기호 간단 제거(`**`, `#`, 리스트 마커 등) → `synthesizeSpeech` → 공유 audio로 재생(`URL.createObjectURL`, 재생 종료/교체 시 revoke, 새 재생 전 기존 중지). 같은 메시지 중복 발화 방지(마지막 발화 메시지 식별자 ref). 에러 메시지(role:'error')는 발화 금지. useUiChat 구조분해에 `lastAssistantMessage` 추가. |
| `src/styles.css` | 🎤 버튼(대형, 녹음 중 펄스 애니메이션), 🔊 토글, "인식 중…" 상태 스타일. 768px 이하 모바일 시트에서도 버튼 크기 유지. |

**프론트 디버깅 로그 규칙** (필수):
- `if (import.meta.env.DEV)` 가드 하에 `console.info('[ChatPanel] ...')` / `[useVoiceRecorder]` / `[api]` prefix.
- 필수 지점: 녹음 시작(선택된 mimeType), 녹음 종료(blob size/type), STT 요청/응답(텍스트 앞 50자), TTS 추출 텍스트 길이, 재생 시작/실패. `console.error`는 가드 없이 항상.

### 3.3 공통 금지사항
- OPENAI_API_KEY 값을 코드 주석/로그/문서/커밋 메시지 어디에도 기록 금지.
- 프론트 컴포넌트에서 `fetch` 직접 호출 금지 — 반드시 `src/api/index.ts` 경유.
- 신규 npm 의존성 추가 금지(백엔드 내장 fetch, 프론트 브라우저 API로 충분). 필요 시 planner 승인 후 추가.

---

## 4. 테스트 항목 (tester)

전제: `npm run dev`로 서버(3100)+클라이언트(5180) 기동. curl 테스트는 3100 직접 또는 5180 프록시 어느 쪽이든 가능(프록시 경유 1회 이상 포함할 것).

### 4.1 신규 백엔드 엔드포인트
1. **TTS 정상**: `curl -s -X POST localhost:3100/api/tts -H 'Content-Type: application/json' -d '{"text":"안녕하세요. 사만오천원입니다."}' -o /tmp/tts.mp3` → HTTP 200, `Content-Type: audio/mpeg`, 파일 1KB 이상, `file /tmp/tts.mp3`가 MPEG/audio로 식별.
2. **STT-TTS 왕복 검증**: 1번에서 만든 `/tmp/tts.mp3`를 `curl -X POST localhost:3100/api/stt -H 'Content-Type: audio/mpeg' --data-binary @/tmp/tts.mp3` → 200 `{ "text": ... }`, 텍스트에 "안녕" 및 금액 관련 표현이 포함되는지(완전 일치 아닌 의미 일치) 확인.
3. **STT Content-Type 분기**: 같은 오디오를 `Content-Type: audio/webm`, `audio/mp4`로도 전송(가능하면 ffmpeg로 실제 webm/mp4 변환본 사용) → 각각 200 또는 OpenAI 측 포맷 오류 시 502 JSON(서버 크래시 없어야 함).
4. **에러 형식**: (a) `/api/stt` 빈 바디 → 400 `{error:{code:'EMPTY_AUDIO',...,requestId}}` + `X-Request-Id` 헤더. (b) `/api/tts` `{"text":""}` → 400 `EMPTY_TEXT`. (c) `/api/tts` 4097자 텍스트 → 400 `TEXT_TOO_LONG`.
5. **키 유출 검사**: 서버 콘솔 로그 전체에 `sk-` 문자열이 찍히지 않는지 확인.

### 4.2 기존 기능 회귀
6. **채팅 스트리밍**: UI에서 "지팡이 추천해줘" → 스트리밍 응답 + ProductCard 렌더(getProducts 툴콜 동작).
7. **툴콜 연쇄**: "그거 2개 담아줘" → 장바구니 반영 + CartCard, "주문해줘" → 확인 후 checkout → OrderCard. (기존 플로우가 STT/TTS 추가로 깨지지 않는지)
8. **/api/chat 직접 회귀**: 채팅 요청이 여전히 `application/octet-stream` 스트림으로 응답하는지 (express.raw 추가가 json 라우트에 영향 없음 확인).

### 4.3 프론트 빌드/타입
9. `npx tsc --noEmit` 통과.
10. `npm run build` 통과.

### 4.4 UI/브라우저 수동 테스트 (가능한 범위)
11. PC Chrome: 🎤 탭 → 말하기 → 재탭 → 인식 텍스트가 사용자 말풍선으로 전송되고 AI 응답 수신.
12. 🔊 토글 ON 상태에서 텍스트 질문 → 응답 완료 후 Markdown 부분만 음성 재생(상품카드 내용은 발화 안 됨), 토글 OFF 시 무음.
13. 응답 중 새 질문/중지 시 이전 오디오 재생이 중첩되지 않는지.
14. 모바일 뷰포트(≤768px) 채팅 시트에서 🎤/🔊 버튼 노출·터치 크기 확인. (실 iOS 기기는 cloudflare https 터널 경유 — getUserMedia는 https 필수)
15. 마이크 권한 거부 시 앱이 죽지 않고 안내 문구 표시.

---

## 5. 리스크 / 주의사항
- **iOS 자동재생 정책**: fetch 이후 `audio.play()`가 NotAllowedError로 거부될 수 있음 → 토글 ON 클릭 시 audio unlock으로 대응(§1.5). 실기기 검증 전까지 잔여 리스크.
- **iOS MediaRecorder**: Safari 14.1+에서 지원되나 `audio/mp4`(AAC)로 녹음됨 — OpenAI transcription은 mp4/m4a 지원하므로 확장자 매핑만 정확하면 됨.
- **스트리밍 중 부분 content**: TTS 추출은 반드시 응답 완료 전이 후 수행(§1.4). 도중 추출 시 잘린 텍스트 발화 위험.
- **gpt-4o-transcribe 가용성**: 계정/리전에 따라 미제공 가능 → whisper-1 폴백 필수.
- **비용**: STT/TTS 호출당 과금 발생 — 테스트 시 짧은 문장 사용 권장.

---

# PLAN v2 — TTS 목소리·말투 개선

- **버전**: v2
- **수정일자**: 2026-07-13
- **요청 작업**: 음성 응답이 기계같이 들린다는 피드백 반영
  1. TTS 기본 voice `nova` → 더 자연스러운 최신 목소리로 교체 (1순위 `marin`, 폴백 `cedar` → `coral`/`sage`). marin/cedar의 gpt-4o-mini-tts 지원 여부는 실제 API 호출로 검증.
  2. `TTS_INSTRUCTIONS`를 "상냥하고 또박또박하면서 나긋나긋하게" 톤으로 재작성 — 어르신 대상 안내 앱임을 반영.

## Plan verification findings (v2)

1. **현재 코드 상태** (직접 확인, v1 이후 무변경 — `git diff` 결과 해당 파일 변경 없음):
   - `server.mjs:17` — `const TTS_VOICE = process.env.TTS_VOICE || 'nova';`
   - `server.mjs:18-19` — `TTS_INSTRUCTIONS = '한국어로 어르신께 말하듯 따뜻하고 또박또박, 너무 빠르지 않게 읽어주세요.'`
   - `/api/tts` 라우트(98행~)는 요청 body의 `voice`가 있으면 그것을, 없으면 `TTS_VOICE`를 사용. 로그 `[tts:<requestId>] incoming textLength=.. voice=..`에 **voice가 이미 출력되고 있음** → 로그 규칙 추가 변경 불필요.
   - `.env.example:8` — `# TTS_VOICE=nova` 주석.
2. **voice 지원 사전 검증 (실제 OpenAI API 호출, 2026-07-13)**: `POST /v1/audio/speech` + `model: gpt-4o-mini-tts`로 4종 모두 호출 →
   - `marin` **200 OK** (48,000 bytes, `file` 판정: MPEG ADTS layer III, 24 kHz mono — 유효 mp3)
   - `cedar` 200 OK / `coral` 200 OK / `sage` 200 OK
   - → **1순위 `marin` 확정.** 400 폴백 시나리오는 발생하지 않음(단, tester 절차에는 만일의 400 대비 폴백 경로 유지).
3. **프론트엔드 변경 불필요 (frontend-dev 할당 생략 사유)**: `src/api/index.ts`의 `synthesizeSpeech(text, voice?)`는 voice 미전달 시 요청 body에 voice 필드를 아예 포함하지 않음(`JSON.stringify(voice ? { text, voice } : { text })`) → 서버 기본값(`TTS_VOICE`)이 그대로 적용됨. `ChatPanel.tsx`의 `speakText`도 `synthesizeSpeech(text)`로 voice 미전달 호출. 따라서 백엔드 상수 교체만으로 전 구간 반영.
4. 사양-코드 충돌 없음.

## 변경 매트릭스 (v2)

### backend-dev
| 파일 | 작업 |
|---|---|
| `server.mjs` | (1) `TTS_VOICE` 기본값 `'nova'` → `'marin'`. (2) `TTS_INSTRUCTIONS` 재작성: "상냥하고 또박또박하면서 나긋나긋하게" 톤 + 어르신 안내 목적 명시. (3) 그 외 로직·로그 무변경 (voice는 기존 `[tts:<id>]` 로그에 이미 출력됨). |
| `.env.example` | `# TTS_VOICE=nova` → `# TTS_VOICE=marin` 주석 갱신. |

확정 instructions 문안:
> 당신은 어르신을 모시는 쇼핑 안내 도우미입니다. 상냥하고 나긋나긋한 말투로, 서두르지 않고 한 마디 한 마디 또박또박, 어르신께 차분히 안내해 드리듯 부드럽고 자연스럽게 한국어로 읽어주세요.

### frontend-dev
- **할당 없음** — findings 3항 참조 (voice 미전달 시 서버 기본값 사용 구조라 무변경).

### 공통
- API 키 값 로그/문서 기록 금지 유지. 백엔드 재시작은 반드시 프로젝트 디렉토리에서 실행.

## 테스트 항목 (v2 — tester)
1. 백엔드 재시작(프로젝트 디렉토리에서, 기존 3100 프로세스 kill 포함) 후 `POST /api/tts` → 200 + `Content-Type: audio/mpeg` + 바이트 수 확인, `file`로 mp3 유효성.
2. 서버 로그에 `voice=marin` 출력 확인.
3. (조건부) marin이 400(`OPENAI_TTS_FAILED` 502로 표면화) 시 → backend-dev에 폴백 voice(cedar → coral/sage) 수정 요청. ※ 사전 검증에서 marin 200 확인되어 발생 가능성 낮음.
4. 회귀: `POST /api/stt`(TTS 산출 mp3 왕복) 정상, `POST /api/chat` 스트리밍 정상.
5. 로그에 API 키 문자열 미출력 재확인.

---

# PLAN v3 — 어르신 친화 UI 리디자인 (Figma 승인 시안 반영)

- **버전**: v3
- **수정일자**: 2026-07-13
- **요청 작업**: 승인된 Figma 홈 화면 시안의 디자인 언어(크림 배경 + 진초록/주황 팔레트 + 대형 타이포)를 앱 전체에 적용. 채팅 화면은 시안 없이 동일 디자인 언어로 구현. **순수 프론트 스타일/마크업/문구 작업 — 기능 로직 변경 금지.**

## Plan verification findings (v3)

1. **`src/styles.css` (593줄, 전체 정독)**: 현재 주 색상은 파랑 `#3b74d8`, 배경 `#f5f6f8`. 데스크톱 상품 그리드 `repeat(auto-fill, minmax(210px, 1fr))`, 모바일(≤768px) `repeat(2, 1fr)`. 채팅 본문 14px(모바일 15px). `.chat-fab`은 데스크톱 `display:none`, 모바일에서 우하단 58px 원형.
   - **핵심 제약**: `.chat-side-open ~ .chat-fab` **형제 선택자**로 "채팅 열림 시 ✕를 우상단 소형으로 이동"을 처리 → App.tsx의 DOM 순서(`aside.chat-side` 다음에 `button.chat-fab`)를 반드시 유지해야 함. FAB→전폭 바 교체는 이 구조를 보존한 채 CSS와 버튼 내용만 변경하면 됨.
2. **`src/App.tsx`**: `chatOpen` state + `.chat-fab` 버튼(`{chatOpen ? '✕' : '💬'}`), `chat-side-open` 클래스 토글. 로직은 setState 토글뿐 — 버튼 문구/클래스/DEV 로그만 변경하면 됨.
3. **`src/components/ChatPanel.tsx`**: 렌더 구조 확인 — 변경 대상은 문구 2곳(헤더 h2/p, 토글 라벨)뿐. 툴 5종·useUiChat·useVoiceRecorder·TTS 재생 로직(51~425행)은 접근 금지 영역으로 지정.
4. **`ProductGrid.tsx` / `CartPanel.tsx` / `chat/*.tsx` 카드 3종**: 전부 클래스 기반 렌더 → **TSX 무변경, CSS만으로 리스타일 가능** 확인.
5. **카테고리 필터: 현재 미구현 확인 → 스코프 아웃** (시안에 있었더라도 이번 작업에서 추가하지 않음 — 코디네이터 지시).
6. **백엔드 무변경 (backend-dev 할당 생략 사유)**: 요청이 스타일/마크업/문구에 한정되고, API 계약·server.mjs에 영향 주는 변경이 전혀 없음. 확인만 수행(회귀 테스트 항목에 포함).

## 변경 매트릭스 (v3 — frontend-dev)

| 파일 | 작업 |
|---|---|
| `src/styles.css` | 전면 리스타일(클래스명 유지). 팔레트: 배경 `#FFF9F2`, 카드 `#FFF`+테두리 `#E6DBCC` 1.5px+radius 20px+그림자 `0 4px 12px rgba(77,64,38,0.08)`, 주색 `#1C784D`, 강조 `#D96B21`(가격 텍스트 `#BF5414`), 본문 `#212121`/보조 `#6B6357`. 타이포: 페이지 제목 30px/부제 18px, 섹션 23px, 상품명 22px/설명 16px/가격 24px, 버튼 20px bold, 채팅 본문 18px. 모바일: 상품 그리드 1열, `.chat-fab`을 전폭 주황 바(높이 64px+, radius 18px, 하단 고정)로, 열림 시 우상단 소형 ✕는 기존 형제 선택자 유지. 채팅: 말풍선 radius 16px/18px 본문, 어시스턴트 흰 카드·사용자 진초록, 토글 pill(켜짐 진초록/꺼짐 회색), 🎤 58px 이상 + 주황, 채팅 내 카드 4종 동일 카드 스타일+큰 글씨. |
| `src/App.tsx` | `.chat-fab` 버튼 내용 `💬` → `🎤 말로 주문하기` (열림 시 `✕` 유지), aria-label 갱신, 클릭 핸들러에 DEV 가드 `[App]` console.info 추가. DOM 순서(형제 선택자 의존) 불변. |
| `src/components/ChatPanel.tsx` | 문구만: 헤더 `🤖 AI 도우미`(24px는 CSS) + 부제 `말씀만 하세요, 다 찾아드려요`, 토글 라벨 `🔊 켜짐`/`🔇 꺼짐`. **로직·클래스 구조 무변경.** |

### backend-dev — 할당 없음 (findings 6항)
### 금지: zustand store / useUiChat / useVoiceRecorder / TTS 재생 로직 / api 모듈 변경.

## 테스트 항목 (v3 — tester)
1. `npx tsc --noEmit` / `npm run build` 통과.
2. vite(5180) 응답: HTML 200, styles.css에 새 팔레트 토큰(`#FFF9F2`, `#1C784D`, `#D96B21`)과 `@media (max-width: 768px)` 내 1열 그리드·전폭 바 규칙 존재 확인 (usePolling 자동 반영 — 재시작 불필요).
3. 코드 레벨 회귀: (a) App.tsx의 `chat-side` → `chat-fab` 형제 DOM 순서 유지 + `chat-side-open ~ .chat-fab` 선택자 생존, (b) ChatPanel의 `mic-btn`/`voice-toggle`/`chat-input-row` 등 기능 연결 클래스가 CSS에 모두 존재, (c) 카드/장바구니 컴포넌트 TSX 무변경(git diff), (d) store·훅·api 모듈 무변경(git diff).
4. API 무영향: `/api/tts`·`/api/stt`·`/api/chat` 정상 응답 (server.mjs 무변경 git diff 확인 포함).

---

# PLAN v4 — 이용 로깅 보강 (누가·언제·어떻게)

- **버전**: v4
- **수정일자**: 2026-07-14
- **요청 작업**: ① 모든 백엔드 로그에 시각 ② 접속자 IP+User-Agent(터널/프록시 경유 실 IP 해석) ③ 대화 내용 로깅(사용자 입력+AI 응답, 프론트 원격 로깅 방식) ④ 장바구니/주문 이벤트 ⑤ 세션 ID(X-Session-Id) ⑥ 영속 로그 파일(logs/, gitignore).

## Plan verification findings (v4)

1. **백엔드 로그 현황**: `server.mjs`의 모든 로그는 `console.log/error` 직접 호출 — 시각 없음, 파일 기록 없음. `[stt:<id>]`/`[tts:<id>]` requestId 체계는 v1부터 존재 → 시각·파일 기록을 헬퍼로 일원화하면 형식 유지 가능. `/api/chat`은 requestId 없음(에러 로그만) → 진입 로그+requestId 추가 여지.
2. **IP 경로**: 요청이 cloudflared → vite(5180) http-proxy → 3100 이므로 `req.socket.remoteAddress`는 127.0.0.1. vite 프록시는 현재 문자열 축약형(`'/api': 'http://localhost:3100'`) — `xfwd` 옵션을 주려면 객체형으로 전환 필요. cloudflared가 붙이는 `cf-connecting-ip` 헤더는 vite http-proxy가 그대로 전달하므로 백엔드에서 `cf-connecting-ip` → `x-forwarded-for`(첫 항목) → `socket.remoteAddress` 순 해석이 성립.
3. **대화 로깅 위치 (프론트)**: `/api/chat` 응답은 hashbrown 바이너리 프레임 스트림 — 서버 파싱 대신 코디네이터 권장안(프론트 원격 로깅) 채택.
   - 사용자 입력: `ChatPanel.onSubmit`(키보드)과 `onMicClick` STT 성공 경로(음성) 두 곳 모두 `sendMessage` 직전 텍스트 확보 가능 → `source: 'keyboard'|'voice'` 구분 로깅.
   - AI 응답: 기존 `isWorking` true→false 전환 감지 useEffect + `collectMarkdownText`/`stripMarkdownSyntax` 재사용. **현재 effect는 `!voiceEnabled`면 조기 return** → 텍스트 추출을 voice 게이트 앞으로 이동하고, 발화 dedup(`lastSpokenIndexRef`)과 별도의 로깅 dedup(`lastLoggedIndexRef`)을 추가. 발화 로직 자체(순서·조건·speakSeqRef)는 불변.
4. **장바구니/주문 로깅 위치 판단**: 변경 경로 3종 — AI 툴(`useShopStore.getState().addToCart/removeFromCart/checkout`), 상품 목록·채팅 카드 담기 버튼(`addToCart`), 장바구니 +/− 버튼(**`setQuantity`**) — 이 **전부가 zustand store 액션을 경유함을 확인** → `src/store.ts` 액션 내부가 단일 로깅 지점 (양쪽 핸들러 중복 삽입 불필요). +/− 수량 조절은 `setQuantity`이므로 `cart_set_quantity` 이벤트도 포함해야 누락이 없음. 순환 import 없음(`api/index.ts`는 store 미참조).
5. **세션 ID**: 프론트 localStorage 8자리 생성 → `logEvent`/`transcribeAudio`/`synthesizeSpeech`에 `X-Session-Id` 헤더. `/api/chat`은 Hashbrown 내부 transport라 헤더 주입이 어려움 → 대화 내용은 어차피 `/api/log`(세션 포함)로 남으므로 chat 진입 로그는 IP/UA만 (한계로 기록). cors()는 요청 헤더를 반사(reflect)하므로 커스텀 헤더 추가에 서버 CORS 변경 불필요.
6. **.gitignore**: 현재 `node_modules/ dist/ .env` — `logs/` 추가 필요.

## 확정 스펙

### 로그 라인 포맷 (백엔드 공통)
```
[YYYY-MM-DD HH:mm:ss] [태그:requestId] [sess:세션ID] [ip:주소] 내용 ua="User-Agent"
```
- 시각: KST(Asia/Seoul), 모든 라인 접두. stdout + `logs/access.log` 동시 기록(비동기 append).
- ip/sess/ua는 요청 진입 라인에 기록(이후 라인은 requestId로 연결).

### `POST /api/log` (신규)
- 요청: JSON `{ "event": "이벤트명(≤64자)", "data": { 임의 } }`, 헤더 `X-Session-Id`.
- 응답 204 (본문 없음). 에러: 400 `EMPTY_EVENT` (공통 에러 형식+X-Request-Id).
- data는 JSON.stringify 후 2000자 절단해 로그.
- 프론트 이벤트 어휘: `user_message`(source,text), `assistant_response`(text), `cart_add`/`cart_remove`/`cart_set_quantity`(productId,name,quantity), `order_checkout`(orderId,total,items).

## 변경 매트릭스 (v4)

### backend-dev — `server.mjs`
1. `fs`/`path` 도입, 기동 시 `logs/` 생성, `log()/logError()` 헬퍼(시각 접두 + stdout + access.log append) — 기존 console.* 호출 전부 이 헬퍼로 치환(태그 형식 유지).
2. `clientInfo(req)` 헬퍼: `cf-connecting-ip` → `x-forwarded-for` 첫 항목 → `socket.remoteAddress`, ua, `x-session-id`.
3. `/api/stt`·`/api/tts` 진입 라인에 `[sess:][ip:] ... ua=""` 추가. TTS 진입 라인에 `preview="80자"` 추가(이중 안전망).
4. `/api/chat`: requestId 부여 + 진입 로그(ip/ua) + 스트림 완료 바이트 로그 + 에러 로그 시각화. **스트리밍 로직 자체 무변경.**
5. `POST /api/log` 신설 (위 스펙).
- `.gitignore`에 `logs/` 추가.

### frontend-dev
| 파일 | 작업 |
|---|---|
| `vite.config.ts` | `/api` 프록시 객체형 전환 + `xfwd: true` |
| `src/api/index.ts` | `getSessionId()`(localStorage 8자리) 신설, `logEvent(event, data)` 신설(fire-and-forget, 실패 무해화, keepalive), `transcribeAudio`/`synthesizeSpeech`에 `X-Session-Id` 헤더 추가 |
| `src/components/ChatPanel.tsx` | 로깅 훅만: `onSubmit`에 `user_message`(keyboard), `onMicClick` STT 성공 경로에 `user_message`(voice), 전환 감지 effect에 `assistant_response` 로깅(별도 `lastLoggedIndexRef` dedup, 음성 OFF여도 수행). **음성 로직(useVoiceRecorder/TTS 재생/speakSeqRef) 불변.** |
| `src/store.ts` | 액션 내 `logEvent`: `addToCart` 성공→`cart_add`, `removeFromCart`→`cart_remove`, `setQuantity`→`cart_set_quantity`, `checkout` 성공→`order_checkout`(주문번호·총액·품목 요약) |

### 재기동
- 백엔드: 프로젝트 디렉토리에서 kill & 재시작. vite: config 변경(xfwd)이라 재시작 필수(usePolling은 config 미반영). 터널은 5180 고정이므로 유지.

## 테스트 항목 (v4 — tester)
1. `tsc --noEmit` / `vite build` 통과.
2. `/api/log` 직접+프록시: 204 + 로그 라인에 `[시각][sess][ip] event=... ua=` 실출력, `EMPTY_EVENT` 400.
3. `/api/stt`·`/api/tts` 회귀 + `X-Session-Id` 전달 시 로그 포함 확인, TTS preview 80자 확인.
4. `/api/chat` 회귀(스트림 정상) + 진입/완료 로그.
5. **터널 경유** `/api/*` 1회 이상: 로그의 ip가 127.0.0.1이 아닌 실 IP(`cf-connecting-ip`)로 찍히는지.
6. `logs/access.log` 생성·append 확인 + `git status`에 logs/ 미노출(gitignore).
7. 대화/장바구니 이벤트: `user_message`/`assistant_response`/`cart_*`/`order_checkout` 라인 확인 (curl 시뮬레이션 + 코드 레벨 배선 검증, 실브라우저 E2E는 사용자 확인).
8. 로그 전체에 API 키 미출력.
