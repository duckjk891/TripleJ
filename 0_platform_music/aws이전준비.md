# AWS 이전 준비 체크리스트

> 기준 문서: 클로드코드 2차 요청서 (2026-08-19, claude in chrome 작성)
> 이 파일 기준일: 2026-08-24 — 각 항목 상태는 코드 실측으로 확인한 값
> 표기: ✅ 완료 / 🔶 부분 완료 / ❌ 미착수 / 🚫 해당 없어짐

---

## 확정 전제 (요청서 [0])

- EC2 t3.large (x86_64, 2 vCPU / 8GB), Ubuntu 24.04, 서울(ap-northeast-2)
- 도메인 `api.maidol.ai.kr`, 열린 포트 80/443만 (SSH는 SSM)
- **DB 4종(PG·Mongo·Redis·ES)은 컨테이너 그대로, MinIO만 S3 교체**
- S3 자격증명은 EC2 IAM 역할 (액세스 키 발급 안 함)
- S3 버킷 3개: `maidol-media-images` / `maidol-media-audio` / `maidol-faces-secure`

---

## 1. P0 — 이거 안 하면 AWS에 못 올라감 (요청서 [4])

| # | 할 일 (쉬운 설명) | 상태 | 근거 위치 |
|---|---|---|---|
| 4-8 | **빌드 재료 고정** — madmom 커밋 고정 + 락파일 + (torch는 아예 제거됨) | ✅ v198·v199 | `requirements.txt:48`, `requirements.lock` |
| 4-9 | **앱용 Dockerfile** + .dockerignore + 홈경로 제거 | ✅ v198 | `backend_9006/Dockerfile` (빌드 검증 완료, 이미지 2.09GB) |
| 4-1 | **presign 리전** 설정화 | ✅ v202 | `s3_region` 신설(로컬 us-east-1 유지, EC2 는 .env 로 ap-northeast-2) |
| 4-2 | **S3 접속 스위치** | ✅ v202 (코드) | `secure=False` 0건, 키 빈 값→IamAwsProvider. ⚠️ EC2 실접속 검증은 배포 때 |
| 4-3 | **헬퍼 우회 presign 통합** | ✅ v202 | `presigned_get_object` 가 media_urls 밖 0건. 픽스 루프에서 internal_presign 으로 로컬 회귀 해소 |
| 4-4 | **공인 도메인 주입** — localhost 기본값 교체 + `PUBLIC_BASE_URL` .env 추가 | ❌ | `app/config.py:145,147,184` — ⚠️ 아래 "요청서 주의점" 참조 |
| 4-5 | **CORS 축소** | ✅ v204 (스위치) | `CORS_ORIGINS` env. 로컬 기본 `*`(유동 IP·공인IP 커밋 회피), **EC2 배포 시 명단 설정 필수** |
| 4-6 | **로그 JWT 유출 차단** | ✅ v200+v203 | 액세스 로그 `?token=` 전 경로 + 프런트 로그 Bearer·생 JWT 마스킹. 실전 재현으로 검증 |
| 4-7 | **/docs 잠그기** | ✅ v204 (스위치) | `DOCS_ENABLED` env. 로컬 true, **EC2 배포 시 false 필수** |
| 4-10 | **헬스체크 보강** | ✅ v204 | `/api/ready` 신설 — 5종(PG·Mongo·Redis·ES·MinIO) 병렬 2s, 실서버 200 실증. `/api/health` 는 생존 신호로 존치 |

## 2. ES 보안 후속 (요청서 [1] 중 수정 요구분)

| 할 일 | 상태 | 근거 |
|---|---|---|
| ES 인증을 앱 코드에 반영 | ✅ v189 | `app/database/elasticsearch.py:21` (`basic_auth`) |
| `read_me` 인덱스 삭제 | ✅ | 현재 인덱스 `tracks` 하나뿐 (실조회) |
| compose 약한 기본값 폴백 제거 | ✅ v203 | 비밀 6곳 `:?` 필수화(약한 비번 5 + ES 빈값 기동 1). 나머지 12건은 무해한 편의 기본값이라 유지 |

## 3. 버전 정리 (요청서 [2])

| 할 일 | 상태 | 메모 |
|---|---|---|
| es 클라이언트 8.19.3 → 8.12.x 정합 | ❌ 보류 중 | 권장사항. v198 락파일이 "현 동작 조합 박제" 원칙이라 의도적 유지. 메이저 동일이라 실동작 문제 없음 |

## 4. 확인·판단 요청 (요청서 [3])

| 항목 | 상태 | 메모 |
|---|---|---|
| 3-1 얼굴인증 앱팀 인계 자료 | ✅ | 2026-08-19 인계 문서 작성 완료 |
| 3-1-2 웹 얼굴인증 화면 유지 | ✅ 준수 중 | 삭제 안 함 |
| 3-2 faces 3번째 버킷 공수 추정 | ✅ 답변 완료 | 실작업은 4-2 와 함께 |
| 3-3 minio-py vs boto3 판단 | ✅ 답변 완료 | 실전환은 4-2 와 함께 |
| 3-4 부하 시 메모리 실측 | 🚫 **질문 소멸** | demucs 를 v199 에서 제거 → "demucs 부하" 대상 없음. ffmpeg 단독 피크는 미실측 (필요 시 별도) |
| 3-5 MV tempfile 최대 크기 | ❌ 미실측 | |
| 3-6 9004/9005 정리 | ✅ 다른 방식 해결 | **9006 단일화** (2026-08-20 결정, 미러링 전면 폐기) |

## 5. P1 — 올린 직후 정리 (요청서 [5]) — 전부 미착수

- [ ] 미디어 프록시 9곳 → presign 전환 (특히 `upload.py` 파일 전체 메모리 적재 — 8GB 서버 위험)
- [ ] 마이그레이션 실패 시 fail-fast (지금은 logging.error 로 삼킴)
- [ ] 로그 로테이션 → CloudWatch
- [ ] README 재작성 (DB를 SQLite 로 기재하는 등 불일치 + 샘플 비번 평문)
- [ ] 테스트 스위트 복구 (pytest 미설치, test_api.py 가 8001 참조)
- [ ] MV 실패 job 중간 산출물 정리 (8.66GB 중 상당수 실패분)

## 6. 요청서에 없지만 이번에 추가로 발견·처리한 것

| 항목 | 상태 |
|---|---|
| 커버 이미지 URL 의 쓰이지 않는 세션 토큰 (액세스 로그에 JWT 잔류) | ✅ v200 제거 |
| 구버전 Voice Persona 799줄 + 안 쓰는 음성변환 4.8GB 의존성 | ✅ v199·v200 제거 |
| 차트 캐시 키 limit 누락 | ✅ v201 + 재검토(v201-r 클램프) 진행 중 |
| `frontendLogsBeaconUrl()` 함수 호출 버그 — pagehide 로그 무증상 유실 | ❌ 미수정 (괄호 2글자, `remoteLogger.js:146`) |
| 보이스 클론 3건 시도 / 완료 0건 — 원인 미조사 | ❌ 별건 |
| `mv-preview` 경로 탈출 가드 부재 (`cover-preview` 는 있음) | ❌ 별건 (v197 승계) |
| 앱팀이 쓰는 `backend_9004` 에 v196~v200 수정 미반영 | ⚠️ 앱팀 9006 이전까지 유보 (사용자 결정) |
| 무거운 작업 동시 상한 없음 (김진주 실장 지적) | ✅ v205 세마포어(기본 2, env 조정) + 메인루프 madmom 직행 결함 1곳 동시 해결 |
| 메인루프 madmom 직행 잔존 2곳 | ✅ v206 하청 전환 — 기동 41ms 후 health 5연타 200 실증. 이사 첫 기동 지뢰 해제 |

---

## 진행 순서 제안

1. **4-1 → 4-2 → 4-3** : S3/presign 묶음 (서로 얽혀 있어 한 사이클로)
2. **4-6 마무리 + 1-8** : 로그 마스킹 확장 + compose 폴백 제거 (보안 묶음)
3. **4-5 + 4-7 + 4-10** : CORS·docs·헬스체크 (main.py 묶음)
4. **4-4** : 도메인 주입 — ⚠️ 앱팀 딥링크 확정값 필요 (단독 완결 불가)
5. P1 은 배포 후

### ⚠️ 요청서 주의점 (그대로 따르면 안 되는 것)

- **4-4 의 "FRONTEND_URL → 딥링크 주소"** : 웹 서비스(4000)도 계속 운영되므로 단순 교체하면 **웹 OAuth 콜백이 깨진다**. 웹 URL 유지 + 앱 스킴은 별도 처리(또는 분기)로 설계해야 함. 앱팀과 값 확정 필요.
- **4-2 의 IAM 역할 자격증명** : 코드 준비는 로컬에서 가능하나 **실검증은 EC2 위에서만 가능** — 로컬 MinIO 병행 동작을 유지하는 스위치 필요.

---

## 7. AWS 콘솔 실측 결과 (2026-08-24, 루트 로그인 후 읽기 전용 확인)

### ✅ 요청서 전제와 일치 확인된 것
| 항목 | 실측 |
|---|---|
| S3 버킷 3개 | `maidol-faces-secure`·`maidol-media-audio`·`maidol-media-images` — 전부 서울, 8/19 생성 |
| 퍼블릭 차단 | `maidol-media-images` 에서 "모든 퍼블릭 액세스 차단: 활성화" 확인 |
| 암호화 | SSE-S3 (Amazon S3 관리형 키) 확인 |
| EC2 | `maidol-app` (i-032be68ce82f30dfb), **t3.large**, 실행 중, 3/3 검사 통과, ap-northeast-2a |
| OS | Ubuntu 24.04 (ubuntu-noble-24.04-amd64) |
| 고정 IP | 탄력적 IP **13.125.142.12** 연결됨 |
| IAM 역할 | `maidol-ec2` **부착됨** (+ IMDSv2 Required) |
| 보안그룹 | `maidol-app` — 인바운드 **80·443 TCP 딱 2개**, SSH 없음 |
| Route 53 | `maidol.ai.kr` 퍼블릭 호스팅 영역 존재 |

### 🔴 발견된 공백 2건 → ✅ 당일 해소 (사용자 승인 후 CloudShell 로 적용)
1. ~~IAM 역할에 S3 권한 없음~~ → ✅ **인라인 정책 `maidol-s3-least-privilege` 부착** (2026-08-24).
   버킷 3개 한정: 객체 Get/Put/Delete + 멀티파트 + ListBucket/GetBucketLocation. `list-role-policies` 로 부착 확인
2. ~~`api.maidol.ai.kr` A 레코드 없음~~ → ✅ **A 레코드 생성** → 13.125.142.12, TTL 300 (2026-08-24).
   Route 53 변경 상태 **INSYNC** + 로컬 nslookup 실조회로 확인
3. (파생) 443 이 열려 있어도 **TLS 인증서·리버스 프록시(nginx/certbot 등) 설치는 서버 내부 작업**으로 별도 — 요청서에도 미배정. 배포 단계 과제로 추가
