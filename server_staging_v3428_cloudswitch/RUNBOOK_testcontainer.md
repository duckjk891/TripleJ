# 절차서 ② 새 경로 시험 컨테이너 검증

**목적**: 운영과 **같은 이미지**에 새 경로 환경변수만 덮어써서, 운영과 따로(포트 9106) 띄우고 주요 AI 기능을 한 번씩 호출해 본다. 운영 컨테이너·`.env` 는 건드리지 않는다.
**실행 시점**: 사전 배포(절차서 ①) 뒤 + 키 3종이 생긴 뒤 (Vertex 익스프레스 API 키, GCP 서비스 계정 JSON, Azure OpenAI 엔드포인트·키)
**스크립트**: `_deploy/testcontainer_v3428.sh` (WSL에서 실행) · 기능 호출 `_deploy/smoke_newpaths.py`
**비용**: Claude 7회(+번역 1)·Gemini 텍스트 2회·이미지 1장·Azure 채팅 4회·임베딩 1회·GPT 이미지 2장(저화질 1024). `noimage` 로 이미지 3장 생략 가능.

## 왜 lifespan 을 끄나 (중요)
운영 앱은 기동할 때 운영 DB에 대고 **MV 작업 멈춤 처리, 아티스트 생성 실패 처리·환불, 작곡 작업 재개, CS 워커, 연령 스위퍼, 재생수 동기화** 등을 돌린다. 같은 DB로 두 번째 서버를 정상 기동하면 이 작업들이 겹쳐 사용자 작업을 죽이거나 중복 처리한다.
그래서 시험 컨테이너는
- HTTP 서버는 `uvicorn --lifespan off`(백그라운드 작업 0개)로 9106 에 띄워 **라우팅·공개 경로만** 확인하고,
- AI 기능은 DB·MinIO 를 쓰지 않는 서비스 함수를 **일회성 컨테이너에서 직접 호출**한다(합성 입력만, 사용자 음원 전송 없음).
- 추가 안전장치로 `CS_WORKER_MODE=off`.

## 1. 준비 (한 번)
```bash
ssh maidol-ec2 "mkdir -p /home/ubuntu/maidol/cloudswitch && chmod 700 /home/ubuntu/maidol/cloudswitch"
```
- `newpaths.env.example` 를 EC2 `/home/ubuntu/maidol/cloudswitch/newpaths.env` 로 복사해 값 채우기 → `chmod 600`
- GCP 서비스 계정 JSON(Vertex AI User 권한, maidol-509006)을 `/home/ubuntu/maidol/cloudswitch/gcp-sa.json` 으로 → `chmod 600`
- 키 값은 채팅·로그에 붙이지 않는다. 스크립트도 값은 출력하지 않는다(있음/없음만).

## 2. 실행
```bash
bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/testcontainer_v3428.sh
```
이미지 생략:
```bash
bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/testcontainer_v3428.sh noimage
```
스크립트 단계:
1. 준비물 확인(파일 존재, 필수 키가 비어 있지 않은지)
2. 실행 중인 `maidol-app` 의 이미지 ID를 그대로 사용 + 그 이미지에 `ai_providers.py` 가 있는지(=사전 배포 됨)
3. 시험 컨테이너의 스위치 상태(`claude=vertex gemini_vertex_ratio=100 ... openai=azure` 여야 함)
4. `maidol-cloudtest` 를 127.0.0.1:9106 에 lifespan off 로 띄워 health·MV 모델 목록·아티스트 생성 경로(401·403·422) 확인
5. `smoke_newpaths.py`: 아래 표 항목을 차례로 호출, 결과를 `/tmp/v3428/smoke_*.log` 에도 저장
6. 시험 컨테이너 정리 + 운영 health·운영 스위치(옛 경로 그대로) 확인

| 항목 | 확인하는 것 |
|---|---|
| claude claude-opus-4-6 / 4-7 / opus-5-5 / haiku-5-5 | Vertex 에서 지금 모델 ID 그대로 동작 |
| claude cache_control | 프롬프트 캐시 쓰기/읽기 토큰이 나오는지 |
| claude output_config json_schema | 낙서 읽기(story_reader)와 같은 effort + json_schema 형식 |
| service: translation | 실제 서비스 함수(make_anthropic_client 경유) |
| gemini text 2.5-flash / 2.5-pro | Vertex 익스프레스 키, 응답 호스트 `aiplatform.googleapis.com` |
| service: Gemini image | `gemini-3-pro-image` 매핑(VERTEX_GEMINI_MODEL_MAP) |
| azure chat gpt-4o-mini / gpt-5.4 / gpt-5.5 | Azure 배포 이름 = 모델 이름 |
| service: embedding | 1536차원(바뀌면 벡터 전부 재생성 필요 → 전환 중단) |
| service: search keywords | json_object 응답 형식 |
| service: GPT image generations / edits | Azure 이미지 엔드포인트, edits multipart 응답 형식 |

## 3. 판정
- `SMOKE n/n PASS` + 6단계 운영 health ok·운영 스위치 `anthropic 0 openai` → 전환 준비 완료(절차서 ① 5절 순서로 .env 변경, 별도 승인)
- FAIL 이 있으면 해당 공급자 스위치만 켜지 않는다. 흔한 원인:
  - Claude 404/403: Vertex Model Garden 에서 해당 모델 사용 설정 안 됨, 서비스 계정 권한
  - Gemini 403: 익스프레스 키 제한(API 제한·프로젝트), 404: 모델 매핑
  - Azure 404 `DeploymentNotFound`: 배포 이름이 모델 이름과 다름, 이미지 403: gpt-image Limited Access 미승인
- 시험 컨테이너가 남아 있으면: `ssh maidol-ec2 "docker stop maidol-cloudtest; docker rm maidol-cloudtest"` (운영 `maidol-app` 과 이름이 다름 — 헷갈리지 않게)
