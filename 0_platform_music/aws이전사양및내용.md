# AWS 이전 — 사양 및 준비 내용 총정리

> **용도**: 새 세션의 Claude Code 에게 상황을 즉시 전달하기 위한 브리핑 문서.
> 작성일 2026-08-26. 상태 체크리스트는 [aws이전준비.md](aws이전준비.md), 작업 이력 상세는 `claude_skills_outputs/team-dev/{PLAN,TESTPLAN,REPORT}.md` (v194~v206).
> ⚠️ 이 문서에 비밀값(키·비번·토큰) 실값 기재 금지 — 키 이름만.

---

## 1. AWS 인프라 사양 (전부 콘솔 실측 확인됨, 2026-08-24)

| 항목 | 값 |
|---|---|
| 계정 | `551372961804` (표시명 jaekyulee) |
| 리전 | **ap-northeast-2 (서울)** — 모든 리소스 |
| EC2 | `maidol-app` (`i-032be68ce82f30dfb`) — **t3.large** (x86_64, 2 vCPU / 8GB), Ubuntu 24.04, 150GB gp3 암호화, ap-northeast-2a |
| 고정 IP | 탄력적 IP **13.125.142.12** (연결됨) |
| 도메인 | `maidol.ai.kr` — Route 53 호스팅 영역 `Z0100030NCWEOB6ZOKSS`. **`api.maidol.ai.kr` A 레코드 → 13.125.142.12 생성 완료**(INSYNC, nslookup 실확인). `www`·`admin` 레코드는 아직 없음(프런트 배포 때 추가) |
| 보안그룹 | `maidol-app`(sg-0326dc7b8e50bd267) — 인바운드 **80·443 TCP 만**. SSH(22) 없음 |
| 서버 접속 | **SSM Session Manager** (콘솔 「연결」 버튼 또는 로컬 CLI+플러그인으로 SSH-over-SSM 가능) |
| IAM 역할 | `maidol-ec2` — EC2 부착됨, IMDSv2 Required. 정책 2개: `AmazonSSMManagedInstanceCore` + **인라인 `maidol-s3-least-privilege`**(2026-08-24 부착: 버킷 3개 한정 객체 Get/Put/Delete·멀티파트·ListBucket·GetBucketLocation) |
| S3 버킷 | `maidol-media-images` / `maidol-media-audio` / `maidol-faces-secure` — 전부 서울, 퍼블릭 차단 활성, SSE-S3 암호화 |
| 콘솔 로그인 | 루트 = 이메일+암호 방식. IAM 사용자 2명 존재: `jaekyu-admin`(사람용) · `aidol-face-verify`(얼굴인증 기계용). IAM 로그인 시 계정 칸에는 숫자 `551372961804` |

**구성 방침(확정)**: PG·Mongo·Redis·ES 는 **관리형 안 씀** — docker-compose 그대로 EC2 컨테이너로. **MinIO 만 S3 로 교체**. (관리형 ES 는 최고 7.10 이라 우리 8.12+nori 와 비호환 — 컨테이너라 문제 소멸)

## 2. 코드 준비 상태 — "스위치 설계" (v198~v206, 전부 커밋·푸시됨 `28bfe82` 까지)

코드는 한 벌이고, **EC2 의 `.env` 값만으로 운영 모드 전환**. 로컬 기본값 = 현행 개발 동작 그대로.

### EC2 `.env` 에 설정해야 하는 스위치 (배포 시 필수)
| 키 | EC2 값 | 의미 |
|---|---|---|
| `MINIO_HOST` / `MINIO_API_PORT` | `s3.ap-northeast-2.amazonaws.com` / `443` | 창고 주소를 S3 로 |
| `MINIO_SECURE` | `true` | HTTPS 필수 |
| `S3_REGION` | `ap-northeast-2` | presign 서명 리전 (로컬 기본 us-east-1) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | **빈 값** | 빈 값이면 `IamAwsProvider`(IAM 역할) 자동 사용 |
| `CORS_ORIGINS` | `https://www.maidol.ai.kr,https://admin.maidol.ai.kr` | 로컬 기본 `*` |
| `DOCS_ENABLED` | `false` | Swagger/openapi 차단 (로컬 기본 true) |
| `HEAVY_JOB_CONCURRENCY` | (기본 2, 필요 시 조정) | 무거운 작업 동시 상한 |
| `OAUTH_CALLBACK_BASE` | `https://api.maidol.ai.kr` | 4-4 |
| `FRONTEND_URL` | `https://www.maidol.ai.kr` | ⚠️ 웹용. 앱 딥링크 분기는 **앱팀 소관으로 이관됨**(2026-08-24 결정) |
| `PUBLIC_BASE_URL` | `https://api.maidol.ai.kr` | Suno voice-clone 콜백 활성화용 |
| DB 비번 6종 | **새로 생성** (`POSTGRES_PASSWORD`·`MONGO_PASSWORD`·`REDIS_PASSWORD`·`MINIO_SECRET_KEY`(로컬용)·`ES_PASSWORD` 등) | v203 부터 compose 가 `:?` 필수 — **없으면 기동 거부**(의도된 fail-fast) |

### 빌드·배포 산출물
- **`backend_9006/Dockerfile`** — python3.11-slim 2스테이지, 빌드 검증 완료(이미지 **2.09GB**, /opt/venv 799MiB). ffmpeg+rubberband+ass+나눔폰트 빌드 시점 자기검증 내장. CMD 는 `--workers` 없음(워커 수는 배포 때 결정, 1~2 권장)
- `requirements.lock` 92핀(재현 빌드), madmom 커밋 고정, torch 계열 완전 제거(v199)
- `infra/docker-compose.app.yml.example` — 앱 서비스 정의 초안
- **`/api/ready`** — PG·Mongo·Redis·ES·S3 5종 병렬 점검(2s 타임아웃). LB/모니터링용. `/api/health` 는 생존 신호(도커 HEALTHCHECK 용)

### presign 구조 (v202 — 중요)
- 모든 presign 은 `services/media_urls.py` 중앙 모듈로 통일 (`presigned_get_object` 직접 호출 0건)
- `internal_presign`(스트림·다운로드, 내부 endpoint 서명) / `public_presign`(공개 host 서명) 2종 — **S3 모드에선 endpoint 가 같아 자연 수렴**
- ⚠️ 로컬 `.env` 에 `MINIO_PUBLIC_HOST` 가 공개 IP 로 설정돼 있음 — 이 전제 때문에 v202 픽스 루프가 있었음. EC2 에선 불필요(빈 값 권장)

## 3. 용량 설계 (김진주 실장 질문 대응, v205~v206 로 구현 완료)

- **설계 가정치**: 가입 1,000 / DAU 100 / 동시접속 20~30 / 무거운 작업 동시 2건
- 가벼운 API 실측 2~23ms(비동기 단일 워커로 충분). RAM 예산: DB ~1.8GB + OS 0.5GB → 앱·작업용 ~5.5GB 여유 (MinIO 715MB 는 S3 전환으로 소멸)
- **무거운 작업**(박자 분석 곡당 ~30s, 공유영상 ffmpeg 수십 초~2분): `heavy_job_slot` 세마포어(기본 2) — **시간당 ~240곡 처리 용량**. `[heavy] wait` 로그 발생 = 증설 판단 지표
- 메인 루프 madmom 직행 결함 3곳 전부 해소(v205·v206) — 재기동 41ms 후 health 응답 실증
- MV 캐스케이드는 슬롯 미적용(외부 API 대기 위주 — 의도적 제외)
- 증설 경로: 대기 잦음 → `HEAVY_JOB_CONCURRENCY` 상향/t3.xlarge → 작업서버 분리+큐 → 다중화+nginx LB
- ⚠️ t3 는 버스트형(CPU 크레딧) — 상시 인코딩 부하엔 부적합, 베타 산발 부하엔 적합

## 4. 이사 실행 계획 (7단계 — 아직 미착수)

1. ~~푸시~~ ✅ (`28bfe82` 까지 완료) + **1'. EC2 용 `.env` 신규 작성** (비번 전부 새로, §2 스위치 값)
2. **기초공사**: SSM 접속 → docker 설치 → git clone → DB 컨테이너 5종 기동
3. **데이터 운반**: PG/Mongo 덤프·복원, Redis(1.76MB), **MinIO 오브젝트 → S3**(용량 실측 후), ES 는 미이전(Mongo 원본에서 재색인 — 현재 tracks 인덱스 21곡 수준)
4. **앱 기동**: 이미지 빌드(EC2 에서) → `/api/ready` 5종 확인
5. **nginx + TLS**: certbot(Let's Encrypt) 으로 `api.maidol.ai.kr` 인증서, 443→9006 프록시. (www/admin 은 프런트 배포 때)
6. **리허설 — EC2 에서만 가능한 실검증**: S3 presign 실서명(ap-northeast-2), IAM 역할 자격증명(IMDS), internal/public presign 수렴, CORS 명단, ffmpeg 피크 실측(요청서 3-4·3-5 잔여)
7. **컷오버**: 프런트·앱팀에 새 주소 공지. 구 서버(로컬 PC)는 롤백 보험으로 당분간 유지. ⚠️ 데이터 운반~컷오버 사이 "이중 운영" 구간 — 짧은 멈춤 또는 최종 차분 동기화 필요

## 5. 남은 항목 (이전과 직접 관련 없는 것 포함)

- **P1 (배포 후)**: 미디어 프록시 presign 전환(`upload.py` 전체 메모리 적재 — 8GB 위험), 마이그레이션 fail-fast, 로그 로테이션→CloudWatch, README 재작성, pytest 복구, MV 실패 잔해 8.66GB 정리
- 4-4 앱 딥링크 분기 — **앱팀 소관** ("소셜로그인은 앱팀이 알아서" 2026-08-24 확정)
- Dockerfile HEALTHCHECK 를 `/api/ready` 로 바꿀지 — 배포 라운드 판단
- 별건: `frontendLogsBeaconUrl()` 괄호 버그(remoteLogger.js:146), 보이스클론 완료 0건 원인, `mv-preview` 경로탈출 가드, es-py 8.19↔서버 8.12 정합(보류), `share_video_exists` 광역 except
- ⚠️ `backend_9004`(앱팀 사용)는 v196~v206 미반영 — 앱팀 9006 이전까지 유보 (사용자 결정)

## 6. 세션 공통 안전 규칙 (이 프로젝트 표준)

- 백엔드는 **`backend_9006` 단일** — 9004·9005 에 쓰기/미러링 절대 금지
- 실사용자 데이터 무접촉(테스트 계정만), 유료 외부 API(`/api/generate`·`tracks/upload`·`tracks/search`·MV·character·voice 계열) 호출 금지
- 인프라 컨테이너 무조작(재기동·중지 금지), MinIO 9100 차단 금지. 9006 앱 재기동만 허용(PID kill → `setsid ./run.sh`, **pkill 패턴 금지**)
- 실 `.env` 무접촉(.env.example 만). 산출물에 비밀값·실계정 이메일 금지(플레이스홀더)
- `git add -A` 금지, 커밋 전 시크릿 검사, **푸시는 명시 지시 시에만** (푸시는 WSL 자격증명이 없어 Windows git 경유: `"/mnt/c/Program Files/Git/cmd/git.exe" -C "D:\1_projects\0_myProjects\1_tripleJ" push origin backend`)
- 산출물(PLAN/TESTPLAN/REPORT)은 `claude_skills_outputs/team-dev/` 에 append, 버전 헤더에 실측 시각
