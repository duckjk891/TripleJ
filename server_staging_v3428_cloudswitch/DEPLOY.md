# v3.428 클라우드 결제 전환 — 경로 스위치 (운영 미반영)

- 기준: 운영 컨테이너 maidol-app 의 v3.427 코드 스냅샷(11-10, 읽기 전용으로 내려받음). origin/backend 는 오래됨.
- **아직 운영에 배포하지 않음.** 배포해도 환경변수를 안 바꾸면 지금과 똑같이 동작(기본값 = 옛 경로).
- 전체 변경: `cloudswitch.diff` (21개 파일, 서버 기준 md5 는 `files.txt`)
- 시험(네트워크 없음, `bash ~/cloudswitch/tools/run_tests.sh`): `behave_test.py` 14+13 · `fallback_test.py` 5 · `gemini_route_test.py` 33 · `routecheck.py` 라우트 파일 5개 SAME — 11-12 전부 PASS
- **절차서**: 스위치 끈 채 사전 배포 `RUNBOOK_dark_deploy.md`(+`_deploy/deploy_v3428_dark.sh`·`rollback_v3428.sh`) / 키 생긴 뒤 새 경로 시험 컨테이너 `RUNBOOK_testcontainer.md`(+`_deploy/testcontainer_v3428.sh`·`smoke_newpaths.py`)
- 스테이징 갱신: base 에서 고친 뒤 `bash ~/cloudswitch/tools/sync_staging.sh` (app/·diff·files.txt 재생성 + py_compile)

## 무엇을 바꿨나
- 새 파일 `app/services/ai_providers.py` — 공급 경로 스위치 한 곳 (SDK 가 아니라 **REST URL·키 스위치**: Gemini 는 기존 httpx 호출 그대로 URL·키만 바꿈)
- Claude 클라이언트 생성부 6곳(가사·캐릭터·낙서 읽기·번역·MV·연령 분류) → `make_anthropic_client()`
- OpenAI 클라이언트 6곳(CS·가사·임베딩·키워드·참고 링크·생성) + 이미지(httpx 직접 호출) → Azure 전환 가능
- Gemini REST 9개 URL(호출 13곳: 캐릭터 2·커버 2·MV 8·MV 자산 1) → `gemini_post()` 한 함수 경유, 호출마다 비율 분배 + 예비 경로
- "키 없음" 검사들 → 스위치 기준(새 경로에서 옛 키를 지워도 막히지 않게). 관리자 점검(admin_health)은 옛 경로 확인용으로 그대로 → 스위치 대상 4개(Claude·Gemini·OpenAI·이미지 예비)
- 429 급증 알림(공급자별) — 아래
- `config.py` 설정 14개 추가 (아래 표)

## 스위치 (.env)
| 변수 | 기본(옛) | 새 경로 |
|---|---|---|
| CLAUDE_PROVIDER | anthropic | vertex (GCP_PROJECT_ID=maidol-509006, VERTEX_REGION=global, 인증=서비스 계정 ADC) |
| GEMINI_VERTEX_RATIO | 0 | 0~100. 호출마다 이 비율만 Vertex 로 (VERTEX_API_KEY, VERTEX_GEMINI_MODEL_MAP=gemini-3-pro-image-preview=gemini-3-pro-image) |
| GEMINI_PROVIDER | aistudio | vertex = 비율 100 과 같음(예전 스위치 호환) |
| GEMINI_AISTUDIO_FALLBACK | true | Vertex 429·5xx·시간 초과 → AI Studio 로 1회 재시도. GOOGLE_API_KEY 있을 때만. 400·안전 차단(200 안 blockReason)은 넘기지 않음 |
| OPENAI_PROVIDER | openai | azure (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY) — Azure 배포 이름 = 지금 모델 이름 그대로 |
| AI_429_ALERT_THRESHOLD / AI_429_ALERT_WINDOW_SEC | 10 / 300 | 공급자별 429 가 5분에 10건 이상이면 경고 로그 |
| AI_429_ALERT_EMAIL | (비움) | 넣으면 같은 경고를 SES 메일로도(기본 = 로그만) |
| EMBEDDING_MODEL | text-embedding-3-small | (원래부터 환경변수로 바꿀 수 있음. 바꾸면 track_embeddings 전부 재생성) |
| FAL_API_KEY | 기존 키 | 마켓플레이스 키로 교체만 (코드 변경 없음) |

## Veo 사용 중지 (11-11 대표 확정: 씨댄스·클링만)
- 새 파일 `app/services/video_models.py` — MV 영상 모델 = seedance(기본) | kling
- 예전 요청·저장된 작업의 "veo"·"grok"·빈 값 → seedance 로 바꿔 계속 동작(400 안 냄). 그 밖의 값은 400.
- routes/mv.py·services/mv_pipeline.py 의 모델 결정 지점 전부 `normalize_video_model` 경유 → Veo 분기에 도달 불가
- `start_scene_video`(Veo) 는 호출되면 즉시 실패
- `GET /api/mv/models` 목록: Veo 대신 Seedance 2 + Kling
- 옛 경로 `POST /api/upload/generate-mv`(Veo 전용 20씬 파이프라인, 쓰는 화면 없음 — 웹 api/index.js 에 정의만) → 410
- 라우트→함수 매핑 변경 없음 확인(`routecheck.py`, 바뀐 라우트 파일 5개 SAME)
- 웨딩 프론트(1_MV_wedding)는 기본값 'veo' 를 보내지만 서버가 seedance 로 바꿔 줌 — 프론트 수정은 선택
- 그록(xAI)도 선택지에서 빠짐(xAI 키 정리 예정과 일치)

## GPT 이미지 → Gemini 이미지 예비 경로 (11-11)
- `IMAGE_FALLBACK_GEMINI=true` 일 때만 동작 (기본 false = 기존 동작 그대로)
- GPT 이미지가 재시도 후에도 **429·5xx·시간 초과**로 실패하면 Gemini 이미지(트랙 1)로 한 번 더 생성
- 안전 기준 거절(400 등)은 넘기지 않음 — 모델 우회 금지(v3.377)
- 시험: `fallback_test.py` 5개 PASS (꺼짐=실패 그대로, 429·503·시간초과=Gemini, 400=실패 그대로)
- 운영 호출량(10-20~11-08 로그 49건, 전부 200): 하루 최대 10건, **분당 최대 1건**, 10분 최대 4건 → Azure 기본 분당 2건으로도 현재는 충분. 전환 시 켜 두고, 증설은 여유분(예: 분당 10건)으로 신청

## Gemini 비율 분배 + AI Studio 예비 경로 (11-12)
- Gemini Vertex 한도는 30일 사용액 등급제라 처음엔 낮음 → 전부 켜기 대신 `GEMINI_VERTEX_RATIO` 로 조금씩(10→30→60→100)
- `gemini_post(client, url, json=...)`: 호출마다 `random < 비율` 이면 Vertex(URL·키·모델 치환), 아니면 AI Studio(예전 요청과 바이트 단위로 같음)
- Vertex 가 **429·500·502·503·504·시간 초과**면 같은 요청을 AI Studio 로 **딱 1번** 재시도 → 그 응답을 호출부에 돌려줌(호출부의 기존 재시도·오류 처리는 그대로 동작)
- 400·403·연결 오류·200 안의 안전 차단은 넘기지 않고 그대로(모델·경로 우회 금지, v3.377)
- AI Studio 키(GOOGLE_API_KEY)가 없거나 `GEMINI_AISTUDIO_FALLBACK=false` 면 재시도 없음
- 모델 URL 이 아닌 주소(Veo 작업 조회 등)는 비율과 상관없이 AI Studio
- 주의: 12월에도 AI Studio 예비·비율 미달분은 **AI Studio 카드 결제**로 남음(작업목록 일정 위험 참고)
- 시험: `gemini_route_test.py` — 0%=옛 경로(429 여도 추가 호출 없음), 100%·GEMINI_PROVIDER=vertex=Vertex, 30% 분배≈0.29, 429·500·503·시간초과=AI Studio 재시도, 둘 다 429=정확히 2회, 400·403·안전 차단·연결 오류=그대로, 예비 꺼짐·키 없음=그대로, 호출 13곳 전부 gemini_post

## 429 급증 알림 (11-12)
- 공급자별 429 를 센다: `gemini-vertex`·`gemini-aistudio`(gemini_post), `claude-anthropic`·`claude-vertex`·`openai`·`openai-azure`(SDK 클라이언트 내부 httpx 응답 훅 — SDK 자체 재시도분까지 실제 응답 수)
- 창(기본 300초) 안에 기준(기본 10건) 이상이면 `[ai-429-alert] provider=... 429 N건 / 최근 300초 (기준 10건)` 경고 로그, 창마다 공급자별 최대 1번
- 기존 관리자 알림 경로(슬랙·텔레그램·푸시 등)는 서버에 없음 → 기본 로그만. `AI_429_ALERT_EMAIL` 을 넣으면 기존 SES 메일러로도 보냄
- 동작(재시도·실패)은 바꾸지 않음. 클라이언트 생성 설정(timeout·max_retries·base_url)도 그대로(시험으로 확인)
- 확인: `docker logs --since 1h maidol-app 2>&1 | grep ai-429-alert`
- 참고: GPT 이미지(openai_image.py, httpx 직접)는 집계 대상 아님(호출량 하루 최대 10건)

## 일부러 안 건드린 것
- Veo 함수·프롬프트 본문(도달 불가 코드)과 `VEO31_GENERATE_URL` 상수는 남겨 둠 — 정리는 나중에
- 관리자 점검(admin_health) — 옛 경로 확인용 그대로.
- 재시도: Claude·OpenAI SDK 기본 재시도(2회) + Gemini 호출 대부분 자체 재시도 이미 있음. 예비 모델·이미지 트랙 교차 예비는 동작이 바뀌므로 별도 작업.
- `analyze_music_structure`(GEMINI_AUDIO_URL, MV 음악 구조 분석)는 v3.427 에도 있는 Gemini 오디오 호출 — 경로만 바뀜. 사용자 음원 외부 전송 금지 규칙과 맞는지 별도 확인 필요

## 새 경로 켤 때 확인할 것 → `RUNBOOK_testcontainer.md` 로 자동화
- Claude on Vertex: 4개 모델 ID, cache_control, output_config(effort·json_schema), adaptive thinking(번역 함수)
- Gemini: 텍스트 2모델·이미지 매핑, 응답 호스트 aiplatform
- Azure: 채팅 3모델, 이미지 generations·edits(multipart) 응답 형식, 임베딩 1536차원 동일, json_object
- 컨테이너에 서비스 계정 JSON + GOOGLE_APPLICATION_CREDENTIALS
- 라우트 파일(character·generate·mv·reference_link·upload)은 import 한 줄과 조건식만 바뀜 — 사전 배포 스크립트가 후보 이미지·배포 후 두 번 route→함수 매핑 비교
