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
