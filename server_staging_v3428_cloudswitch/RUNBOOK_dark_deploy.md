# 절차서 ① v3.428 스위치 끈 채 운영 사전 배포

**목적**: 클라우드 전환 코드를 운영에 미리 올려 둔다. 스위치는 전부 기본값(옛 경로)이라 **배포 뒤에도 동작은 지금과 같다.** 실제 전환은 키가 생긴 뒤 `.env` 만 바꿔 재기동.
**실행 조건**: 대표 승인. (승인 전 실행 금지)
**스크립트**: `_deploy/deploy_v3428_dark.sh` (WSL에서 실행) · 롤백 `_deploy/rollback_v3428.sh`
**걸리는 시간**: 빌드 2~4분 + 진행 작업 0건 대기(최대 15분) + 재기동 30초 안팎(이 동안 API 끊김)

## 1. 사전 확인 (사람이 볼 것)
| # | 확인 | 방법 |
|---|---|---|
| 1 | 대표 승인 | 대화에 승인 문구 남기기 |
| 2 | 로컬 시험 4종 통과 | `bash ~/cloudswitch/tools/run_tests.sh` → `FAILS 0`·`VIDEO_FAILS 0`·`FALLBACK_FAILS 0`·`GEMINI_ROUTE_FAILS 0`·routes 5개 `SAME` (스크립트 0단계가 다시 돌림) |
| 3 | SSH 연결 | `ssh maidol-ec2 true`. WSL의 `~/.ssh/config` 는 HostName 이 인스턴스 ID 이고 SSM ProxyCommand 가 주석 처리돼 있음 → 연결이 안 되면 맥에서 쓰던 SSM 설정(aws cli + session-manager-plugin)부터 |
| 4 | 시간대 | 사용자 적은 시간(심야), 다른 배포와 묶어 재기동 1회 |
| 5 | 서버 파일이 v3.427 그대로 | 스크립트 3단계가 `files.txt` md5(스냅샷 기준)로 자동 확인. 다르면 중단 → 그사이 배포분을 base 에 합친 뒤 `sync_staging.sh` 로 다시 만들기 |
| 6 | `.env` 에 스위치 변수 없음 | 스크립트 2단계가 이름만 확인(값 출력 안 함) |

## 2. 명령
```bash
bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/deploy_v3428_dark.sh
```
스크립트가 하는 일(중간에 하나라도 어긋나면 파일·이미지를 되돌리고 멈춤, 운영 컨테이너는 그대로):
0. 로컬 시험 4종
1. `app/`·`files.txt`·점검 스크립트 3개를 EC2 `/tmp/v3428` 로 복사
2. `.env` 에 스위치 변수가 없는지(이름만)
3. 서버 파일 21개 md5 = 스냅샷 (새 파일 2개는 없어야 함)
4. 지금 컨테이너의 route→함수 매핑 저장
5. 원본 `*.bak_pre_v3428` 백업 후 교체, 복사 md5 확인
6. `maidol-app:pre-v3428-live` 태그(되돌리기용) → `nice` 빌드(후보 태그) → **후보 이미지에서 route 매핑이 배포 전과 같은지, 스위치가 기본값인지** 확인 후에만 `latest` 로
7. 진행 작업 4종(gen_jobs·generations 30분·character_jobs·inst_jobs) 0건 대기
8. 로그 저장 → `docker stop -t 60` → 옛 컨테이너 `maidol-app-old-v3428` 로 이름 바꿔 보관 → 정식 run(`--env-file .env -e S3_REGION=ap-northeast-2 -v /home/ubuntu/maidol/logs:/srv/app/logs`)
9. 사후 확인(아래)

> auto mode 분류기가 운영 배포를 막으면(전례: v3.389·v3.405b·v3.427) 대표가 터미널에서 위 한 줄을 직접 실행.

## 3. 사후 확인 (스크립트 9단계 출력)
| 항목 | 정상 |
|---|---|
| health | `{"status":"ok",...}` |
| route 매핑 | `배포 전과 동일` |
| 스위치 | `claude=anthropic gemini=aistudio gemini_vertex_ratio=0 ... openai=openai image_fallback_gemini=False` |
| oauth google·kakao·naver login | 302 |
| `GET /api/mv/models` | seedance≥1, kling≥1, veo=0 |
| `POST /api/upload/generate-mv` | 401 또는 410 (404·5xx 이상) |
| `POST /api/character/generate-sheet-async`, `POST /api/mv/create` | 401·403·422 (404·5xx 이상) |
| Traceback 수 | 0 |
| 새 경로 로그 | 0 |

추가로 10~30분 뒤:
- `ssh maidol-ec2 "docker logs --since 30m maidol-app 2>&1 | grep -cE 'Traceback|ai-429-alert'"` → 0
- 앱에서 작사 1회·커버 1회(가능하면) 정상
- 관리자 웹 헬스체크(admin_health) — 옛 경로 확인용이라 그대로 초록

## 4. 롤백
판단 기준: health 실패, route 매핑 다름, oauth 302 아님, Traceback 반복, 생성 실패 신고.
```bash
bash ~/TripleJ/server_staging_v3428_cloudswitch/_deploy/rollback_v3428.sh
```
- 진행 작업 0건을 기다린 뒤(최대 10분) 새 컨테이너를 `maidol-app-bad-v3428` 로 멈춰 두고, 멈춰 둔 `maidol-app-old-v3428`(v3.427)을 `maidol-app` 으로 되살림
- 호스트 파일을 `.bak_pre_v3428` 로 원복, 새 파일 2개는 `/tmp/v3428/removed_*` 로 치움, `latest` 태그를 `pre-v3428-live` 로 되돌림 → 다음 빌드도 v3.427
- 장애 중 급할 때: `... rollback_v3428.sh now` (대기 생략)
- 끝나면 health·oauth 302·`ai_providers 없음` 출력 확인
- 멈춘 컨테이너(`-old-`/`-bad-`) 정리(`docker rm`)는 대표

## 5. 사전 배포 뒤 실제 전환(별도 승인)
키가 생기면 → 절차서 ② 시험 컨테이너로 먼저 확인 → `.env` 에 스위치 추가 후 재기동(진행 작업 0건 확인 동일).
권장 순서: `IMAGE_FALLBACK_GEMINI=true` → `OPENAI_PROVIDER=azure` → `CLAUDE_PROVIDER=vertex` → `GEMINI_VERTEX_RATIO=10→30→60→100`(Vertex 한도 등급이 30일 사용액 따라 오르므로 단계적으로). 되돌릴 때는 해당 줄만 지우고 재기동.
