# CS AI 워커 — 관리자 API 명세 (v3.282)

관리자 웹 연동용. 모든 엔드포인트는 기존 `get_admin_user`가 필요합니다. 토큰이 없으면 401, role이 admin이 아니면 403입니다.
prefix는 기존 CS API와 같은 `/api/admin/cs`입니다.

## 개념

- **케이스(case)**: 사용자가 공식 계정 DM으로 보낸 문의 묶음 1건입니다. 연달아 보낸 메시지는 60초 디바운스로 묶입니다.
- **status** (5종)
  - `processing`: AI가 처리하는 중입니다(보통 수 초).
  - `ai_answered`: AI가 사용자에게 답변을 발송했습니다(auto 모드에서만).
  - `needs_admin`: 관리자 확인이 필요합니다. **관리자 큐입니다.** shadow 모드에서는 모든 케이스가 여기로 옵니다.
  - `admin_answered`: 관리자가 기존 reply API로 답했습니다(자동 전이).
  - `closed`: 관리자가 종결했습니다.
- **답장은 기존 API를 그대로 씁니다**: `POST /api/admin/cs/conversations/{cid}/reply {text}`. 성공하면 그 대화의 열린 케이스(processing·ai_answered·needs_admin)가 모두 `admin_answered`로 바뀝니다. closed 케이스는 그대로 둡니다.
- AI가 보낸 메시지는 `dm_messages`에 `ai_generated: true`와 `cs_case_id`가 붙습니다. 기존 메시지 조회 응답 스키마는 바뀌지 않으므로, 구분이 필요하면 케이스의 `sent_message_id`와 대조하세요.

## GET /api/admin/cs/cases

케이스 목록입니다. 최신순입니다.

| 쿼리 | 설명 |
|---|---|
| `status` | 하나 또는 쉼표로 여러 개(예: `needs_admin`, `needs_admin,ai_answered`). 잘못된 값이면 400. |
| `conversation_id` | 특정 대화의 케이스만 |
| `user_id` | 특정 사용자의 케이스만 |
| `page`, `limit` | 기본 1, 20. limit 최대 100. |

응답 200:
```json
{
  "cases": [ <Case> ... ],
  "counts": {"processing": 0, "ai_answered": 3, "needs_admin": 5, "admin_answered": 2, "closed": 1},
  "pagination": {"page": 1, "limit": 20, "total": 5, "pages": 1}
}
```
`counts`는 필터와 무관한 전체 상태별 건수입니다. 배지에 쓰면 됩니다.

### Case 객체
| 필드 | 설명 |
|---|---|
| `id` | 케이스 id |
| `user` | `{id, nickname, profile_image, code}` |
| `user_id`, `conversation_id` | 기존 대화 API(`/conversations/{cid}`·`/messages`·`/reply`)에 그대로 사용 |
| `message_ids` | 묶인 사용자 메시지 id |
| `status` | 위 5종 |
| `category` | how_to · policy · account_info · star_balance · bug_report · feedback · greeting_test · refund_payment · account_security · legal_report · minor_guardian · abuse_dispute · agent_request · other |
| `ai_decision` | `answer` 또는 `escalate`. auto 모드였다면 AI가 어떻게 판단했는지를 보여 줍니다. shadow 검증용입니다. |
| `ai_reply` | **AI 초안**(LLM 원문). 이관된 케이스에서도 관리자 참고용으로 생성됩니다. 상담원 요청·일일 상한·LLM 오류일 때만 null입니다. |
| `ai_reply_final` | 발송(후보) 문구. answer면 초안에 AI 고지가 붙은 문구이고, escalate면 접수 안내 템플릿입니다. |
| `send_kind` | `reply` · `ack_agent` · `ack_bug` · `ack_general` |
| `ai_confidence` | 0~1. LLM이 호출되지 않았으면 null. |
| `escalate_reason` | 이관 사유. 아래 표를 참고하세요. |
| `reasons`, `used_facts` | AI의 판단 근거(관리자용) |
| `known_issue_id` | 일치한 알려진 문제의 id(`cs_knowledge.KNOWN_ISSUES`) |
| `is_bug_report`, `is_child` | 오류 신고 여부, 어린이(또는 만 14세 미만) 여부 |
| `mode`, `shadow` | 처리 당시 모드 |
| `trigger` | `hook`(실시간) · `sweep`(재처리) · `backfill` |
| `delivery` | `sent`(발송됨) · `shadow`(발송 안 함) · `skipped`(접수 안내 중복 생략 또는 관리자가 먼저 답함) · `failed`(차단 등으로 발송 실패) · `none` |
| `sent_message_id`, `ack_sent` | AI가 보낸 메시지 id, 접수 안내였는지 여부 |
| `issue_ids` | 같은 메시지로 자동 접수된 `issue_reports` id(오류 신고 화면과 연결) |
| `admin_id`, `admin_message_id` | 관리자 답장 정보 |
| `closed_by`, `close_note` | 종결 정보 |
| `created_at`, `updated_at` | ISO8601(UTC) |

### escalate_reason 값
| 값 | 뜻 |
|---|---|
| `agent_request` | 사용자가 "상담원" 또는 "사람"을 요청했습니다. LLM은 호출하지 않습니다. |
| `forced:<category>` | 키워드 규칙에 걸렸습니다(환불·결제·별 지급 / 탈퇴·해킹·개인정보·로그인 / 신고·표절·저작권·법적 / 미성년·보호자 / 욕설·분쟁). |
| `category:<category>` | LLM이 위 분류로 판단했습니다. |
| `child_user` | 어린이 계정 또는 만 14세 미만 사용자입니다. 항상 관리자에게 넘깁니다. |
| `new_bug` | 알려진 문제 목록에 없는 새 오류 신고입니다. "접수했어요" 안내를 보내고 큐에 올립니다. |
| `known_issue_open:<id>` | 알려진 문제지만 아직 개선 중(in_progress)입니다. |
| `repeat_after_ai` | AI가 답한 뒤 같은 대화에서 다시 문의했습니다(24시간 안에 AI 답변 2회 이상, 또는 1회 이상이면서 불만 표현). |
| `low_confidence` | 신뢰도가 0.75 미만입니다. |
| `llm_escalate`, `unanswerable` | LLM이 이관을 판단했거나, 지식 베이스나 데이터로 답할 수 없습니다. |
| `reply_promise`, `reply_pii`, `reply_too_long`, `empty_reply` | 답변 안전검사에 걸렸습니다(약속 표현, 개인정보, 900자 초과, 빈 답변). |
| `llm:daily_cap`, `llm:user_rate`, `llm:parse`, `llm:call:<Error>` | 호출 상한, JSON 파싱 실패, 호출 오류 |
| `send_failed:<Error>` | 답변 발송이 실패했습니다(사용자가 공식 계정을 차단한 경우 등). |
| `worker_interrupted` | 처리 도중 서버가 재시작됐습니다. |
| `worker_error` | 워커 내부 예외 |

## GET /api/admin/cs/cases/{case_id}

케이스 상세입니다. 응답 200:
```json
{"case": <Case>, "messages": [ <기존 DM 메시지 직렬화와 동일: id, sender_id, text, created_at, image_urls ...> ]}
```
id 형식이 잘못됐거나 케이스가 없으면 404입니다. 대화 전체 맥락은 기존 `GET /conversations/{cid}/messages`로 보세요.

**AI 초안으로 답하는 방법**: `case.ai_reply`를 입력창에 미리 채우고, 관리자가 고친 뒤 기존 `POST /conversations/{conversation_id}/reply`로 보내면 됩니다. 케이스는 자동으로 `admin_answered`가 됩니다. 초안을 쓸 때는 AI 고지 줄이 없는 `ai_reply`를 쓰세요.

## POST /api/admin/cs/cases/{case_id}/close

답장이 필요 없거나 처리를 마친 케이스를 종결합니다. body는 선택입니다: `{"note": "메모(최대 500자)"}`.
응답 200은 `{"case": <Case>}`이고 status는 `closed`입니다. 이미 closed여도 200을 돌려줍니다(멱등). 없으면 404입니다.
감사 로그 `admin_logs`에 `cs_case_close`가 남습니다(메모 원문은 남기지 않고 길이만 남깁니다).

## GET /api/admin/cs/worker

운영 상태입니다.
```json
{"mode": "shadow", "base_mode": "shadow", "override": null, "llm_calls_today": 12, "daily_llm_cap": 300,
 "user_per_min": 3, "debounce_sec": 60.0, "min_confidence": 0.75, "lookback_hours": 48.0, "model": "gpt-5.5"}
```
`mode`는 실제로 적용 중인 모드입니다(override가 있으면 override가 우선). `base_mode`는 .env의 `CS_WORKER_MODE` 값입니다.

## POST /api/admin/cs/worker/mode

재시작 없이 모드를 바꿉니다. 바꾼 모드는 Redis `cs:worker:mode`에 저장되고 최대 10초 안에 반영됩니다.
body: `{"mode": "off" | "shadow" | "auto"}`. `{"mode": null}`이나 `""`를 보내면 override를 해제해 .env 값으로 돌아갑니다.
응답 200은 `{"mode": <적용 모드>, "override": <값|null>}`입니다. 잘못된 값이면 400, Redis를 쓸 수 없으면 503입니다. 감사 로그 `cs_worker_mode`가 남습니다.

## 관리자 화면 권장 구성(참고)

1. CS 메뉴에 'AI 큐' 탭을 두고 `status=needs_admin` 목록을 띄웁니다. 배지는 `counts.needs_admin`입니다.
2. 행에는 닉네임, category, escalate_reason, 경과 시간, delivery(접수 안내 발송 여부)를 표시합니다.
3. 행을 클릭하면 기존 대화 뷰를 열고(`/cs?cid=`), 입력창에 `ai_reply` 초안을 채우고, [종결] 버튼을 둡니다.
4. 'AI 답변함' 탭에서는 `status=ai_answered`를 보여 줍니다. 사후 검수용입니다.
5. 설정 영역에 모드 토글(off/shadow/auto)과 오늘 LLM 호출 수를 둡니다.
