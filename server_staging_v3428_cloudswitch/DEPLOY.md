# v3.428 클라우드 결제 전환 — 경로 스위치 (운영 미반영)

- 기준: 운영 컨테이너 maidol-app 의 v3.427 코드 스냅샷(11-10, 읽기 전용으로 내려받음). origin/backend 는 오래됨.
- **아직 운영에 배포하지 않음.** 배포해도 환경변수를 안 바꾸면 지금과 똑같이 동작(기본값 = 옛 경로).
- 전체 변경: `cloudswitch.diff` / 동작 시험: `behave_test.py` (옛 경로 8개·새 경로 6개 항목 PASS)

## 무엇을 바꿨나
- 새 파일 `app/services/ai_providers.py` — 공급 경로 스위치 한 곳
- Claude 클라이언트 6곳(가사·캐릭터·낙서 읽기·번역·MV·연령 분류) → `make_anthropic_client()`
- OpenAI 클라이언트 6곳(CS·가사·임베딩·키워드·참고 링크·생성) + 이미지(httpx 직접 호출) → Azure 전환 가능
- Gemini REST 9개 URL·키(캐릭터·커버·MV·MV 자산) → Vertex 전환 가능
- "키 없음" 검사들 → 스위치 기준(새 경로에서 옛 키를 지워도 막히지 않게)
- `config.py` 설정 9개 추가 (아래 표)

## 스위치 (.env)
| 변수 | 기본(옛) | 새 경로 |
|---|---|---|
| CLAUDE_PROVIDER | anthropic | vertex (GCP_PROJECT_ID=maidol-509006, VERTEX_REGION=global, 인증=서비스 계정 ADC) |
| GEMINI_PROVIDER | aistudio | vertex (VERTEX_API_KEY, VERTEX_GEMINI_MODEL_MAP=gemini-3-pro-image-preview=gemini-3-pro-image) |
| OPENAI_PROVIDER | openai | azure (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY) — Azure 배포 이름 = 지금 모델 이름 그대로 |
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

## 일부러 안 건드린 것
- Veo 함수·프롬프트 본문(도달 불가 코드)은 남겨 둠 — 정리는 나중에
- 관리자 점검(admin_health) — 옛 경로 확인용 그대로.
- 재시도: Claude·OpenAI SDK 기본 재시도(2회) + Gemini 호출 대부분 자체 재시도 이미 있음. 예비 모델·이미지 트랙 교차 예비는 동작이 바뀌므로 별도 작업.

## 새 경로 켤 때 확인할 것 (스테이징)
- Claude on Vertex: 4개 모델 ID 그대로 동작하는지, cache_control·output_config(effort·json_schema)·adaptive thinking 지원
- Azure: 이미지 edits(multipart) 응답 형식, 임베딩 1536차원 동일
- 컨테이너에 서비스 계정 JSON + GOOGLE_APPLICATION_CREDENTIALS
- 라우트 파일(character·generate·mv·reference_link·upload)은 import 한 줄과 조건식만 바뀜 — 배포 시 route→함수 매핑 확인
