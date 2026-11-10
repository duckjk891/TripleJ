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

## 일부러 안 건드린 것
- **Veo**: 남은 호출이 1곳이 아님. MV 영상 모델의 **기본값이 "veo"**(routes/mv.py, 웹 MV·웨딩 프리MV가 veo 전송). 삭제하면 기본 모델을 무엇으로 바꿀지 결정 필요 → AI Studio 옛 키 그대로 둠.
- 관리자 점검(admin_health) — 옛 경로 확인용 그대로.
- 재시도: Claude·OpenAI SDK 기본 재시도(2회) + Gemini 호출 대부분 자체 재시도 이미 있음. 예비 모델·이미지 트랙 교차 예비는 동작이 바뀌므로 별도 작업.

## 새 경로 켤 때 확인할 것 (스테이징)
- Claude on Vertex: 4개 모델 ID 그대로 동작하는지, cache_control·output_config(effort·json_schema)·adaptive thinking 지원
- Azure: 이미지 edits(multipart) 응답 형식, 임베딩 1536차원 동일
- 컨테이너에 서비스 계정 JSON + GOOGLE_APPLICATION_CREDENTIALS
- 라우트 파일(character·generate·mv·reference_link·upload)은 import 한 줄과 조건식만 바뀜 — 배포 시 route→함수 매핑 확인
