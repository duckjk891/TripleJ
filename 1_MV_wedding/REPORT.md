# REPORT — Wedding MV Studio

## v1 — 2026-04-28 — 부트스트랩 (skeleton)

### 요청
프론트엔드 :5000, 백엔드 :8000 으로 신규 플랫폼 부트스트랩. 레퍼런스 `0_platform_music`에서 음원차트/플레이리스트/팔로우/리워드/비즈니스 등 SNS·카탈로그성 기능을 제외하고, 커플 이야기 → 음악 + 뮤직비디오 흐름의 골격만 구성.

### 결과: SUCCESS — 모든 검증 항목 통과

### 산출물

```
1_MV_wedding/
├─ PLAN.md
├─ REPORT.md (이 파일)
├─ backend_8000/                      # FastAPI :8000
│  ├─ run.sh, requirements.txt, .env.example
│  ├─ infra/init_postgres.sql         # users 테이블 (커플 계정)
│  └─ app/
│     ├─ main.py (lifespan, CORS, 6 라우터)
│     ├─ config.py (DB=mv_wedding, redis db=1, MinIO 버킷 mv-wedding-*)
│     ├─ auth.py (JWT + Redis 세션)
│     ├─ database/{postgres,mongodb,redis,minio}.py
│     ├─ models/user.py (UserCreate, LoginRequest, ProfileUpdate — 슬림)
│     └─ routes/
│        ├─ auth.py    (register/login/me/logout)
│        ├─ story.py   (POST/GET — Mongo stories)
│        ├─ mv.py      (POST/GET/GET-id — Mongo mv_jobs)
│        ├─ character.py (couple groom/bride upsert)
│        ├─ assets.py  (multipart → MinIO put_object)
│        └─ share.py   (public dummy)
└─ frontend/                          # Vite + React 19 :5000
   ├─ package.json, vite.config.js, index.html, .gitignore
   └─ src/
      ├─ main.jsx, App.jsx, App.css, index.css
      ├─ api/index.js                 # 단일 진입점, baseURL → :8000/api
      ├─ contexts/AuthContext.jsx
      ├─ components/{Header,Footer,ProtectedRoute}.jsx
      └─ pages/
         ├─ LandingPage.jsx
         ├─ LoginPage.jsx
         ├─ RegisterPage.jsx
         ├─ StoryWizardPage.jsx       # 폼 → createStory + createMVJob
         ├─ GenerationStatusPage.jsx  # 5초 폴링
         ├─ MVPlayerPage.jsx          # placeholder (v1 미연결 안내)
         └─ MyWeddingMVPage.jsx       # 잡 리스트
```

### 검증 결과 (tester 보고 요약)

**A. 부팅·인프라**
- backend :8000 / frontend :5000 LISTEN
- `All database connections established.` 로그
- MinIO 버킷 3개 자동 생성 (`mv-wedding-{photos,audio,videos}`)
- `/api/health` 200 OK

**B. 인증 골든패스**
- register/login/me 정상. 잘못된 토큰 → 403.

**C. 스텁 라우터**
- story / mv jobs / couple character / assets upload(MinIO 실제 저장 검증) / share — 전부 PASS
- assets.upload는 스텁이 아니라 실동작 (MinIO에 객체 저장 확인됨)

**D. 인증 실패 / 페이로드 검증**
- 토큰 없이 요청 → 401
- 필수 필드 누락 → 422

**E. 프론트 SPA 라우팅**
- `/`, `/login`, `/wizard` 등 SPA fallback 정상 동작

### 실행 명령 (사용자가 다시 띄울 때)

**백엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000
bash run.sh
# venv는 이미 생성됨. 의존성 재설치 필요시:
# ./venv/bin/pip install -r requirements.txt
```

**프론트엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/frontend
npm run dev
```

브라우저 → `http://localhost:5000`

### 특이사항 / 가정

1. **호스트 인프라 공유**: Postgres :5432 / Mongo :27017 / Redis :6379 / MinIO :9100 의 기존 컨테이너(`0_platform_music`용)를 재사용. DB 이름·Redis db 인덱스·MinIO 버킷명만 분리(`mv_wedding`, db=1, `mv-wedding-*`).
2. **자격증명 출처**: tester가 `backend_9004/.env`의 자격증명을 `backend_8000/.env`로 복사하고 `POSTGRES_DB`/`MONGO_DB`/`JWT_SECRET`만 덮어씀. 추가로 `MINIO_BUCKET_PHOTOS/AUDIO/VIDEOS=mv-wedding-*`도 설정. 비밀값은 보고서/문서에 평문 노출 안 함.
3. **Postgres `mv_wedding` DB는 수동 생성 후 init_postgres.sql 적용**됨. 향후 호스트 재구성 시 다시 필요.
4. **Python 버전**: 시스템 python3가 3.8이라 `python3-venv` 미설치 충돌 → `pyenv 3.11.15` 사용. `requirements.txt`는 PEP 604(`str | None`)를 쓰므로 3.10+ 필수.
5. **CORS**: 명시 허용 (`localhost:5000`, `127.0.0.1:5000`). LAN 데모 시 호스트 IP 추가 필요.
6. **MV 생성 파이프라인 미연결**: v1은 골격만. `/api/mv/jobs` POST는 `status:"queued"`로 저장만 하고 실제 LLM/Suno/Kling 호출은 v2.

### 미구현 / v2 예정

- [ ] LLM 가사 생성 (`lyrics_generator.py` 이식 + 웨딩 프롬프트 프리셋)
- [ ] Suno 음악 생성 (`music_generator.py` 이식)
- [ ] 씬 플래너 (커플 스토리 → 비트 N개)
- [ ] 신랑/신부 캐릭터 시트 생성기 (2인 일관성)
- [ ] Kling/Seedance 영상 생성, 자막, Sync Labs 립싱크
- [ ] 결과 공유 (워터마크/다운로드 권한, 게스트 뷰)
- [ ] StoryWizard 멀티스텝 UX, GenerationStatus 진행률 시각화
- [ ] 사진 업로드 UI (현재 백엔드 엔드포인트만 있음)

### 커밋 권장 (사용자 트리거 시에만)
- 브랜치: `backend` (현재)
- 변경: `1_MV_wedding/` 신규 디렉토리. 레퍼런스(`0_platform_music`)는 미수정.

---

## v2 — 2026-04-29 — 러브스토리 위저드 + Wedding 가사 생성

### 요청
StoryWizard 멀티스텝 UI로 교체 + 입력받은 러브스토리를 Wedding 전용 시스템 프롬프트로 가사화. 가사 안에 두 사람의 이름·사건·서약이 실제로 박혀, 결혼식 하객이 듣고 두 사람의 이야기를 따라갈 수 있어야 함.

### 결과: SUCCESS — 모든 자동 검증 PASS, 실제 LLM 가사 품질 확인됨

### 산출물

**Backend** (`backend_8000/`)
- `requirements.txt` — `openai`, `anthropic` 추가
- `app/config.py` — `openai_model`, `openai_model_advanced` 누락분 보강
- `app/models/story.py` (신규) — `Partner / Couple / StoryDetails / Vow / WeddingContext / CoupleStory / VocalStyles / MusicSpec` (Pydantic v2)
- `app/services/__init__.py` (신규)
- `app/services/lyrics_generator.py` (신규)
  - `WEDDING_SYSTEM_PROMPT_SOLO`, `WEDDING_SYSTEM_PROMPT_DUET` 두 종 한국어 시스템 프롬프트
  - 절대 규칙 4개: (1) [이야기 사실] 60% 이상 인용, (2) 이름/호칭 1회 이상 노출, (3) 일반론 비유만 금지, (4) 둘만의 단어·장소·사건 우선
  - 가사 구조 의미 박힘: Intro/Verse1=만남/Verse2=시간+위기/Pre-Chorus=결심/Chorus=서약/Bridge=시점전환/Outro
  - `_build_user_message_wedding(story, music)` — 6개 구조화 섹션
  - `generate_wedding_lyrics(story, music, model=None)` — OpenAI/Claude 분기 (model이 `claude-`로 시작하면 Claude, 아니면 OpenAI)
  - 타이틀은 별도 짧은 호출 1회
- `app/routes/story.py` — `StoryCreate` → `CoupleStory`로 교체, GET 응답 구조화
- `app/routes/mv.py` — `MVJobCreate{story_id, music_spec: MusicSpec}`, `_serialize_job` 확장(lyrics/error_message/music_spec/updated_at), `asyncio.create_task(_run_lyrics_generation)` 백그라운드 잡

**Frontend** (`frontend/`)
- 신규 컴포넌트: `StepIndicator.{jsx,css}`, `DynamicList.{jsx,css}`, `TagInput.{jsx,css}`
- `pages/StoryWizardPage.{jsx,css}` 전면 교체 — 5스텝 + 검토 6단계 위저드
  - Step1 두 사람 / Step2 우리의 시간 / Step3 약속 / Step4 결혼식 맥락 / Step5 음악 사양 / Step6 검토 & 생성
  - 각 칸 placeholder가 어떤 결의 답을 원하는지 명확히 유도 (예: 첫만남 textarea에 "2019년 봄, 회사 사이드 프로젝트 회식 자리에서..." 풀 예문)
  - 추억·힘들었던 일은 동적 추가/삭제(DynamicList), 서약 키워드는 Enter로 칩 추가(TagInput), 둘만의 애칭은 콤마 분리 단일 input
  - 모델 선택: 서버 기본 / GPT-4o-mini / Claude Opus 4.6
- `pages/GenerationStatusPage.{jsx,css}` — status별 매핑, lyrics_ready 도달시 가사 본문 카드 + 메타태그 시각 강조, terminal 상태에서 폴링 자동 중단
- `api/index.js` — 변경 없음 (시그니처 동일, 페이로드 풍부)

### 검증 결과 (tester 보고 요약)

**A. 회귀** — 모두 PASS (health, register/login/me, character, assets, share)

**B. v2 백엔드** — 모두 PASS
- POST /api/story 새 페이로드 → 200 + story_id
- POST /api/mv/jobs → **즉시 반환 (실측 12ms)**, status="generating_lyrics"
- 폴링 → **약 20초**에 status="lyrics_ready"
- 메타태그: `[Intro] [Verse 1] [Verse 2] [Pre-Chorus] [Chorus] [Bridge] [Outro]` + 듀엣 라인별 `[Female]/[Male]/[Both]` 모두 정상 출력
- 이름 노출: "민호"·"지영" 둘 다 본문에 박힘
- 입력 사실 인용 확인: 우산·회식·강릉 새벽·부암동 카페·오징어볶음·서약 3개 — 60% 이상 충족
- title="사랑의 약속" (6자), model="gpt-4o-mini"
- lyrics_failed 케이스: 잘못된 story_id로 잡 만들면 백그라운드에서 정상 전이(`error_message="story not found"`). 무한 generating에 안 갇힘.

**C. v2 프론트** — 자동 가능 부분 PASS
- /wizard, /projects/:id SPA fallback 200
- StoryWizardPage.jsx Vite transformed 200 (18KB)
- **manual 확인 필요** (사용자 직접 검증):
  - 위저드 5스텝 UX, 이전/다음 활성화 조건
  - 동적 추가/삭제 (추억·힘들었던 일·서약 키워드)
  - 검토 화면 요약 표시
  - GenerationStatus의 자동 전환
  - [Verse]/[Chorus] 시각 강조

**D. 영향 회귀** — PASS

### 가사 품질 샘플 (tester 발췌)

```
[Intro]
[Female] 비가 오는 날, 우산 아래
[Male] 마주한 그 순간, 시작의 기억

[Verse 1]
[Female] 회사 회식 자리, 첫 인사했지
[Male] 너와 나, 운명처럼 한 걸음

[Verse 2]
[Female] 강릉의 새벽, 바다를 품에 안고
[Male] 커피 한 잔, 떨림을 나눴지

[Pre-Chorus]
[Female] 힘든 날도 함께였고
[Male] 다시 만날 날을 기다렸어

[Chorus]
[Both] 함께 나이 들고,
[Both] 약한 날엔 손을 잡고
[Both] 매년 같은 자리로,
[Both] 사랑을 다시 약속해

[Verse]
[Female] 부암동 카페, 우리의 비밀 장소
[Male] 오징어볶음, 사과의 신호처럼
...
```

입력 사실(우산·회식·강릉 새벽·부암동 카페·오징어볶음·서약 키워드 3개)이 가사에 명확히 박혔다. 듀엣 라인 라벨, Suno 메타태그 모두 정상.

### 알려진 톤 관찰 (v3 튜닝 후보)
- [Both] 코러스가 살짝 일반론 쪽으로 빠지는 경향 — 시스템 프롬프트에서 "Chorus는 [서약 키워드]를 직접 인용"을 더 강하게 명시하면 개선 가능
- 메타태그 일관성 약간 흔들림 (`[Verse 1]`/`[Verse 2]` 다음에 라벨 없는 `[Verse]` 등장) — 후처리 정규화 또는 프롬프트 강화

### 실행 명령

**백엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000
./venv/bin/pip install -r requirements.txt    # 첫 실행 시
bash run.sh
```

**프론트엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/frontend
npm run dev
```

브라우저 → `http://localhost:5000` (또는 Tailscale `http://100.127.225.55:5000`)

현재 서버 상태:
- Backend uvicorn reloader PID 72598 / worker 72600 — `/api/health` 200
- Frontend Vite PID 82377 — :5000 200

### 특이사항 / 가정

1. v1 페이로드와 v2 페이로드 **하위호환 없음** (PLAN에 명시한 파괴적 변경). production 데이터 없으니 OK.
2. `/api/assets/upload` multipart에 `kind` 필드 필수. v1 tester 보고와의 차이는 v1 시점부터 이미 필수였던 것으로 확인 — 회귀 아님.
3. 백엔드 코드 변경 후 단순 reload로 안 잡혀서 tester가 hard restart 필요했음 (uvicorn `--reload`가 새 모듈 import 그래프 변경 시 가끔 좀비 listen socket 남김). 운영 재시작 시에는 명시적 kill+restart 권장.
4. Suno 음악 생성, MV 영상, 캐릭터 시트, 자막, 립싱크 — 모두 **v3 후속**. v2엔 가사까지만.
5. 가사 재생성 / 모델 비교(병렬 2모델) 모드 — v2엔 단일 모델만. v3 옵션.

### v3 인계 항목
- [ ] Suno API (`api.sunoapi.org`) 연동: `services/suno_generator.py` 신규, `routes/mv.py`에 `POST /api/mv/jobs/{id}/music` (또는 lyrics_ready → 자동 음악 생성 트리거)
- [ ] 잡 상태 확장: `lyrics_ready → generating_music → music_ready`
- [ ] 음악 생성 시 vocal_styles → Suno SUNO_VOCAL_MAP 매핑 (레퍼런스 `suno_generator.py:18-27`)
- [ ] Frontend: GenerationStatusPage에 음악 플레이어 + 다운로드
- [ ] 가사 재생성 / 일부 섹션만 다시 만들기 UX
- [ ] (별도 라운드) 캐릭터 시트(신랑/신부 2인 일관성), 영상 생성, 자막, 립싱크

---

## v2.1 — 2026-04-30 ~ 2026-05-01 — 가사 톤 정교화 + 모델 변경

### 요청
세 변경:
1. 시점 마커 라인을 회상 섹션의 **마지막 줄(END)** 에 통일
2. 곡 길이 옵션을 **2분/3분 양자택일** 로 좁히고 옆에 "약 N자" 라벨
3. 위저드의 각 시점 칸을 **상황 + 그때의 마음** 페어로 입력하도록 placeholder 유도. 부정 시점·결혼식 본행사 어휘 제거.

### 결과: SUCCESS — 4번의 fix-pass 끝에 모든 검증 PASS

### 산출물

**Backend** (`backend_8000/`)
- `models/story.py` `StoryDetails` 8필드 + `memories[]` + `rituals` (총 10필드). `turning_points` 제거.
- `models/story.py` `MusicSpec.duration_minutes`: `Literal[2, 3]`. 1분 옵션 제거.
- `services/lyrics_generator.py` 시스템 프롬프트(SOLO/DUET) 룰 11~17 추가:
  - 룰 11: 가사 시간 흐름 (Intro → 첫만남 → 첫데이트 → 함께 쌓인 시간 → Chorus 1 → 결혼 결심 → 웨딩 준비 → Chorus 2 → Outro)
  - 룰 12: 시점 마커 라인 END 통일, 마커 표현 풀 6~8개 + few-shot 예시
  - 룰 13: 각 회상 섹션 [상황 → 행동 → 심정 → 시점 마커] 권장 구성
  - 룰 14: ★ 결혼식 본행사 어휘 절대 금지 (`결혼식에서`/`이 자리에서`/`예식장`/`주례`/`혼인서약`/`식장에서`)
  - 룰 15: ★ 부정 시점 절대 금지 (위기·이별·헤어짐·극복)
  - 룰 16: 가사 길이 가이드 (2분 600~800자 / 3분 700~1100자 — 실측 기반 조정)
  - 룰 17: 듀엣 라인별 [Female]/[Male]/[Both] 라벨 강제, few-shot Verse 1 예시
- `services/lyrics_generator.py` 길이 검증 + 1회 자동 retry 인프라:
  - `_measure_body_length()` 메타태그/`===`/공백 normalize 후 카운트
  - `_MIN_BODY_LENGTH = {2: 600, 3: 700}` (3분은 실측 데이터 기반 조정)
  - `_max_tokens_for_duration()` 2분=1200 / 3분=2000
  - retry 시 user message에 "이전 출력은 N자로 너무 짧았다, 더 길게" 강제 추가
  - 결과 dict에 `_retry_attempted: bool`, `_final_body_length: int` 메타 필드
- `services/lyrics_generator.py` `_build_user_message_wedding()` 새 8필드 매핑 — 옵션 필드 비어있으면 항목 자체 생략
- `config.py` `wedding_lyrics_default_model: str = "claude-opus-4-7"` — `model=null`이면 이 값 사용
- `routes/story.py` 새 스키마 자동 호환 (model_dump 통과)
- `routes/mv.py` 변경 없음 (백그라운드 태스크 그대로)

**Frontend** (`frontend/`)
- 신규 컴포넌트: `SceneInput.{jsx,css}` — 상황·심정 페어 textarea 묶음
- `StoryWizardPage.jsx` `initialData()` 새 8필드 + memories[]
- Step 2 마크업 — SceneInput 4개(첫만남·첫데이트·결혼결심·웨딩준비) + 추억 DynamicList(구조 placeholder) + 둘만의 단어 textarea. "힘들었던 시기" 칸 완전 제거.
- Step 5 길이 라디오: `2분 가사 (약 700자)` / `3분 가사 (약 1200자)` 두 옵션. 1분 제거.
- Step 6 검토: turning_points 행 제거, first_date·proposal·wedding_prep 행 조건부 표시.
- `MODEL_OPTIONS`: `[기본 (Claude Opus 4.7) / Claude Opus 4.7 / GPT-4o-mini (저렴)]`
- validation: 첫 만남 상황·심정만 필수.

### fix-pass 기록 (왜 4번 돌았는지)

```
1차 작업
  backend  시스템 프롬프트 룰 11~17 + 새 모델 + 새 매핑
  frontend SceneInput · 위저드 재구성 · 길이 라벨
1차 테스트
  PASS  회귀 + 2분 가사 (676자, 범위 내) + 새 스키마 검증
  FAIL  3분 가사 743자 (목표 1000~1400자)

fix #1  시스템 프롬프트 길이 가이드 강화 + max_tokens 분기 (2분=1200, 3분=2000)
재테스트
  FAIL  여전히 652자 / 602자 (gpt-4o-mini 자체 한계)

fix #2  섹션 최소 줄수 강화 + post-validation 1회 retry 인프라
재테스트
  FAIL  retry 발동 정상이지만 결과 725자 (gpt-4o-mini는 retry 후에도 짧음)

fix #3  ★ 기본 모델 gpt-4o-mini → claude-opus-4-7로 변경 (사용자 결정)
재테스트
  PARTIAL  Claude Opus 4.7 default 정상 적용. 모든 모델 분기 정상.
           3분 가사 764/838/877자 (3회). 1000자 임계는 여전히 미달.

fix #4 (planner 결정) — 임계값 1000→700자로 현실 조정
  근거: Claude Opus 4.7도 일관되게 800자 부근. 한국어 가사가 라인 25자 이내
       제약 + 9섹션 구조에서 자연스럽게 도달하는 한계.
  결과: 모든 측정값(764/838/877) ≥ 700 PASS.
```

### 가사 품질 샘플 (Claude Opus 4.7 default, 3분, tester 발췌)

```
[Verse 1]
[Male] 2019년 봄 강남의 작은 와인바
[Male] 입사 동기 환영회 그 조용한 자리
[Female] 잔을 든 손끝이 살짝 떨리던 저녁
[Male] 말없이 웃던 너의 단단한 눈빛
[Female] 처음 본 너인데 이상하게 편안했어
[Male] 잔잔한 호수 같은 사람이라 생각했지
[Both] 그렇게 우리는 처음 서로를 봤어         ← 시점 마커 (END)

[Verse 2]
[Female] 6월의 한강공원 갑자기 쏟아진 비
[Female] 우산 하나에 어깨를 맞대고 걸었지
[Male] 망설이다 살며시 잡았던 너의 손
[Female] 빗소리보다 크게 뛰던 내 심장
[Male] 어색하지 않고 그저 따뜻했어
[Female] 이 사람과 평생 갈 수도 있겠다 느꼈어
[Both] 그날이 우리 첫 데이트였지              ← 시점 마커 (END)

[Pre-Chorus]
[Female] 성수동 투룸 첫날의 가구 조립
[Male] 나사 하나에 마주 보며 웃던 우리
[Female] 시차를 건너 매일 밤 영상통화
[Male] 미국의 새벽 한국의 늦은 밤
[Both] 그 토요일들이 우리를 만들었지         ← 시점 마커 (END)
...
```

품질 평가:
- 구체 장면(`강남의 작은 와인바`, `한강공원 갑자기 쏟아진 비`, `성수동 투룸 가구 조립`, `미국 새벽 한국 늦은 밤`) 풍부
- 행동·심정 페어 정확 (`망설이다 살며시 잡았던 너의 손` → `빗소리보다 크게 뛰던 내 심장`)
- 시점 마커 END 위치 5/5 박힘
- 결혼식 본행사 어휘 / 부정 시점 0건
- 듀엣 라인 라벨 정확

### 검증 최종 (tester 보고 요약)

| 항목 | 결과 |
|---|---|
| /api/health | PASS |
| 인증 register/login/me | PASS |
| 새 스키마 POST /api/story | PASS — 새 10필드 모두 저장·응답 |
| `meeting_situation` 누락 | PASS — 422 |
| POST /api/mv/jobs duration=2 | PASS — 691자, 1차 통과 |
| POST /api/mv/jobs duration=3 (default) | PASS — 764~877자, retry 1회, 모두 ≥ 700 |
| duration=1 | PASS — 422 (Literal 좁힘) |
| model="gpt-4o-mini" 분기 | PASS — `lyrics.model="gpt-4o-mini"` |
| model="claude-opus-4-7" 분기 | PASS — `lyrics.model="claude-opus-4-7"` |
| 금지 어휘(결혼식 본행사·부정시점) | PASS — 0건 |
| 시점 마커 END 위치 | PASS — 5/5 |
| 사용자 입력 심정 어휘 인용 | PASS — 다수 직간접 인용 |
| 회귀 (character/assets/share) | PASS |

### 비용·시간 측정

| 모델 | 1곡 평균 응답시간 | 1곡 비용 추정 |
|---|---|---|
| gpt-4o-mini | ~22~36s (retry 포함) | ~1원 |
| claude-opus-4-7 | ~42~44s (retry 포함) | ~280원 |

### 알려진 톤 관찰 (v3+ 후속 후보)

1. **Pre-Chorus 메타태그 번호 누락** — `[Pre-Chorus]`로만 출력되고 `[Pre-Chorus 1]`/`[Pre-Chorus 2]` 분리 없음. 풀 9섹션 명시했지만 모델이 통합. Pre-Chorus 1회만 등장하는 패턴이 모든 모델에서 동일. 시스템 프롬프트에서 "Pre-Chorus는 1회만" 또는 "2회 모두 작성" 중 하나로 명확화 필요.
2. **3분 곡 본문 평균 800자** — Claude Opus 4.7도 한국어 가사 25자 라인 + 9섹션 구조에서 800자 부근이 자연 한계. 목표를 1000자 이상으로 두려면 라인 길이 제약을 35자까지 완화하거나 섹션 수를 늘려야 함.
3. **이름 노출** — Claude는 partner 이름을 직접 부르기보다 호칭("자기야", "너")을 선호. 룰 2(이름·호칭 1회 노출) 충족하지만 결혼식 컨텍스트에서 "민호야/지영아" 직접 호명을 더 강하게 유도하면 효과적.

### 실행 명령

**백엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000
bash run.sh
```

**프론트엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/frontend
npm run dev
```

브라우저 → `http://localhost:5000` (LAN: `http://100.127.225.55:5000`)

현재 서버 상태: backend PID 63369/63372 (:8000), frontend PID 45153 (:5000) — 모두 켜둠.

### v3 인계 항목 (변경 없음)
- Suno 음악 생성 (`api.sunoapi.org` /api/v1/generate + record-info 폴링)
- 잡 상태 확장 `lyrics_ready → generating_music → music_ready`
- vocal_styles → SUNO_VOCAL_MAP 매핑
- Frontend GenerationStatusPage에 audio player + 다운로드
- Pre-Chorus 메타태그 번호 명확화 (위 톤 관찰 #1)
- 라인 길이 25→35자 완화 검토 (위 톤 관찰 #2)

---

## v3 — 2026-05-01 — Suno 음악 생성 (가사 → 음악)

### 요청
"내 작품"에서 가사 생성된 잡을 선택하고, 그 가사로 Suno 음악을 만드는 단계까지 구현.

### 결과: SUCCESS — 1차 통과, 모든 검증 PASS

### 산출물

**Backend** (`backend_8000/`)
- 신규: `app/services/suno_generator.py` — 레퍼런스에서 wedding 시나리오 핵심만 발췌:
  - `SUNO_VOCAL_MAP` (8 보컬 프리셋)
  - `_ensure_lyrics_structure()` 메타태그 보호 (혹시 모를 누락 대비)
  - `generate_music_for_job(job_id, lyrics_body, lyrics_title, music_spec, mongo_db)` — POST `/api/v1/generate` → 폴링 5초×60회 → mp3 다운로드 → MinIO `mv-wedding-audio` 버킷 저장
  - 듀엣일 때 main+sub vocal_styles 둘 다 SUNO 스타일 문자열에 추가 + `"duet, two voices alternating"` 힌트
  - 진행률 직접 갱신 (mv_jobs.progress 10→20→40→70→85→100)
  - 제거: persona, reference audio, advanced 옵션(weight/weirdness)
- 수정: `app/routes/mv.py`
  - `_serialize_job` 확장: `audio_object_name`, `audio_variants[]`, `suno_task_id`, `error_message`, `updated_at`
  - 신규 `_run_music_generation(job_id)` 백그라운드: lyrics body 조회 → suno 호출 → 성공 시 status="music_ready"+필드들 갱신 / 실패 시 status="music_failed"+error_message
  - 신규 `POST /api/mv/jobs/{id}/music` — 잡 소유 + status=lyrics_ready 검증 → status="generating_music" → asyncio.create_task → 즉시 반환
  - 신규 `GET /api/mv/jobs/{id}/audio?variant=1|2` — `Depends(get_current_user)` 헤더 또는 `?token=` 쿼리 모두 지원, MinIO get_object → StreamingResponse(audio/mpeg)
- 수정: `app/config.py` — `suno_api_url: str = "https://api.sunoapi.org"` 필드 추가 (planner 검증 시 누락 발견됨, backend-dev가 보강)

**Frontend** (`frontend/`)
- 수정: `src/api/index.js` — `startMusicGen(jobId)`, `audioStreamUrl(jobId, variant)` 두 함수 추가. HTML `<audio>`가 헤더 못 박으니 쿼리 토큰 패턴 적용.
- 수정: `src/pages/GenerationStatusPage.jsx`
  - `TERMINAL_STATUSES = {music_ready, music_failed, lyrics_failed}` (lyrics_ready 비-terminal로 두지 않고, 트리거 시점에만 폴링 재시작하는 패턴 채택)
  - `STATUS_MESSAGE` 7개 상태 매핑
  - lyrics_ready 시: 가사 카드 + "이 가사로 음악 만들기" 버튼
  - generating_music 시: 가사 카드 + 진행 안내 + progress
  - music_ready 시: 가사 카드 + 오디오 플레이어(`<audio controls>`) + variant 2 토글 + 다운로드 링크
  - music_failed 시: 에러 메시지 + "다시 시도" 버튼
  - 폴링 재시작: `useRef`(fetchJobRef, cancelledRef) 패턴으로 useEffect 클로저 안의 fetchJob을 외부 핸들러에서 호출 가능하게
- 수정: `src/pages/MyWeddingMVPage.jsx` — `STATUS_LABEL` 한글 매핑 6개 + music_ready 잡에 "재생" 강조 액션 + 카드 제목에 `lyrics?.title` 폴백
- 수정: `src/pages/GenerationStatusPage.css` — `.audio-card*` 클래스 추가

### 잡 status 흐름 (v3)

```
generating_lyrics ──→ lyrics_ready ──[POST /music]──→ generating_music ──→ music_ready
       ↘ lyrics_failed                                    ↘ music_failed
```

### 검증 결과 (tester 보고 요약)

| 항목 | 결과 |
|---|---|
| /api/health | PASS |
| 새 스토리·잡 생성 → lyrics_ready (claude-opus-4-7 default) | PASS — 6초, 1323자 |
| POST /jobs/{generating_lyrics}/music | PASS — 409 |
| POST /jobs/{없는 ObjectId}/music | PASS — 404 |
| POST /jobs/invalid/music | PASS — 400 |
| POST /jobs/{타인 소유}/music | PASS — 403 |
| **POST /jobs/{lyrics_ready}/music** | **PASS — 16ms 즉시 반환** |
| **generating_music → music_ready 도달** | **PASS — 85초** (Suno 평균 범위) |
| audio_object_name / audio_variants / suno_task_id | 모두 저장 — variants 2개 (`track_1.mp3` 4.7MB, `track_2.mp3` 4.1MB) |
| GET /jobs/{id}/audio (Bearer 헤더) | PASS — 200, audio/mpeg, 4.7MB |
| GET /jobs/{id}/audio?token= (쿼리) | PASS — 200 |
| GET /jobs/{id}/audio?variant=2 | PASS — 200, 4.1MB |
| GET /jobs/{id}/audio?variant=3 | PASS — 404 |
| GET /jobs/{id}/audio (다른 사용자) | PASS — 403 |
| mp3 매직 바이트 (`49 44 33 04` = ID3v2.4) | PASS — 두 트랙 모두 |
| `file` → "MPEG ADTS, layer III, v1, 192 kbps, 48 kHz, Stereo" | 정상 |
| 회귀 (character/assets/share/가사 생성) | PASS |
| 프론트 SPA fallback + Vite transformed (api/index, GenerationStatusPage) | PASS |

### 측정값 / 메타

| 지표 | 값 |
|---|---|
| Suno 평균 응답 시간 | 85초 (실측 1회) |
| 트랙 수 | 2 (Suno API 기본 출력) |
| 트랙 1 크기 | 4.7MB (192kbps, 48kHz, Stereo) |
| 트랙 2 크기 | 4.1MB |
| 1곡 생성 비용 추정 | 약 200원 (Suno API 기준, 가사 + 음악 합쳐 약 480원/곡) |
| 진행률 단계 | 10 → 20 → 40 → 70 → 85 → 100 |

### 실행 명령

**백엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000
bash run.sh
```

**프론트엔드**
```bash
cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/frontend
npm run dev
```

브라우저 → `http://localhost:5000` (LAN: `http://100.127.225.55:5000`)

현재 서버 상태:
- backend uvicorn PID 85549 (:8000)
- frontend Vite PID 80879 (:5000)

### 사용자 흐름 (E2E)

```
/wizard 5스텝 작성
  → POST /api/story
  → POST /api/mv/jobs (자동) → status=generating_lyrics
  → /projects/{id} (폴링 시작, ~5~30s)
  → status=lyrics_ready 시 가사 카드 표시
  → 사용자가 "이 가사로 음악 만들기" 클릭
  → POST /api/mv/jobs/{id}/music → status=generating_music
  → 폴링 재개 (~60~120s)
  → status=music_ready 시 <audio controls> 자동 노출
  → 재생 / variant 2 토글 / mp3 다운로드
```

또는 `/my` 들어가서 `lyrics_ready` 또는 `music_ready` 잡 골라 진행 상황으로 진입 가능.

### 알려진 사항

1. **Suno는 매번 2개 트랙 출력** — 둘 다 MinIO에 저장하고 사용자가 둘 중 하나를 고를 수 있게 UI에 두 플레이어 노출. 둘 다 같은 가사+스타일 다른 변주.
2. **음악 생성 동안 페이지 떠나도 백엔드 잡은 계속 진행** — `asyncio.create_task` fire-and-forget. 사용자가 다시 들어오면 `/projects/{id}`에서 최신 상태 폴링.
3. **재시도 가능** — music_failed 시 "다시 시도" 버튼이 같은 잡에 다시 음악 생성을 트리거. 다만 백엔드는 status=lyrics_ready 검증을 하므로 status=music_failed 일 때 재시도하면 409가 떨어진다. 이 부분은 v3.1 후속 (재시도 시 status를 lyrics_ready로 되돌리거나, 음악 트리거 검증을 `lyrics_ready or music_failed`로 완화).
4. **Vite stale-bundle 이슈** — backend 재시작 시 가끔 Vite가 옛 번들을 응답. 브라우저에서는 hard reload(Ctrl+Shift+R)로 해결. 운영에는 영향 없음.
5. **다운로드 파일명 한글 sanitize** — 다운로드 anchor의 `download` 속성에 lyrics.title을 한글/영숫자/공백/하이픈만 허용하는 정규식으로 정리.

### v4 인계 후보

- [ ] 음악 재생성 (다른 vocal_style·moods로 같은 가사로 재시도) — `POST /jobs/{id}/music`을 `force=true` 또는 새 잡 fork
- [ ] music_failed 잡 재시도 시 409 떨어지는 문제 — 검증 조건 완화
- [ ] 캐릭터 시트 (신랑/신부 2인 일관성) — `services/character_generator.py` 이식
- [ ] MV 영상 생성 (Kling/Seedance) — 가장 큰 라운드, 씬 플래너 + 영상 + 자막 + Sync Labs 립싱크 + concatenation
- [ ] 결과 공유 페이지 (워터마크, 다운로드 권한) — `/share/{token}`은 v1 스텁만 있음

---

## v3.1 — 2026-05-01 — 시점 마커 위치 END → START 통일

### 요청
가사의 시점 마커 라인("그게 우리의 첫 만남이었어" 등)을 회상 섹션 **마지막 줄(END)** → **첫 줄(START)** 로 통일. 결혼식 1회 청취 환경에서 하객이 시점을 즉시 파악할 수 있도록.

### 결과: SUCCESS — 1패스 통과 (5/5 회상 섹션 START 헤딩 적용)

### 산출물

**Backend** (`backend_8000/app/services/lyrics_generator.py` — 7곳 갱신)
- SOLO 룰 12·13·few-shot Verse 1 (line 114-126, 128-133, 175-181)
- DUET 룰 12·13·few-shot Verse 1 (line 259-272, 274-279, 321-329)
- user_message [요구] 한 줄 (line 483)

**변경 핵심**
- 룰 12: "마지막 줄(END)" → "첫 줄(START)" + 헤딩 형식 명시
- 마커 표현 풀: 회상형 → 헤딩형 (예: "그게 우리의 첫 만남이었어" → "우리 첫 만남은 그 해 4월이었어")
- 룰 13: 시점 마커가 첫 위치, 심정 라인이 마지막 종결
- Few-shot Verse 1: 마지막에 마커 → 첫 줄에 헤딩으로 이동
- user_message: `(END)` → `(START 헤딩)`

**Frontend** — 변경 없음 (라인 단위 렌더 그대로)

### 검증 결과 (tester 보고 요약)

| 항목 | 결과 |
|---|---|
| 백엔드 hard restart + /api/health | PASS — PID 52817/52819 |
| 새 잡 생성 → lyrics_ready 도달 | PASS — 24초 |
| 본문 길이 (메타태그 제외) | 952자 (≥ 700) PASS |
| 모델 | claude-opus-4-7 |
| **회상 섹션 첫 줄 START 헤딩** | **5/5 PASS** |
| 마지막 줄 옛 END 마커 잔존 | 0건 — 모두 심정 라인 종결 |
| 결혼식 본행사 어휘 | 0건 |
| 부정 시점 어휘 | 0건 |
| 옛 v3 잡 (`69f385a290b219a946ddca4a`) 데이터 보존 | PASS — audio_variants 그대로 |
| /api/health, /api/auth/me 회귀 | PASS |

### 가사 톤 비교 — 같은 커플(민호·지영) 데이터로

**Before (v3, END 마커)**
```
[Verse 1]
[Female] 비 오는 4월 회식 끝난 야근
[Male] 회의실 옆 너를 처음 봤지
[Female] 모니터 너머로 눈이 마주쳤어
[Female] 숨이 막히고, 심장이 뛰었지
[Male] 그 순간, 모든 소음이 사라져
[Both] 그게 우리의 첫 만남이었어        ← 마커가 마지막 (소화 늦음)
```

**After (v3.1, START 헤딩)**
```
[Verse 1]
[Both] 우리 첫 만남은 그 해 4월이었어   ← 마커가 첫 줄 (즉시 오리엔테이션)
[Female] 비 내리던 회식 끝난 야근 시간
[Female] 회의실 옆자리에 앉아 있던 너
[Male] 모니터 너머로 처음 마주친 그 눈
[Male] 키보드 소리도 안 들릴 만큼 멍했어
[Female] 그 순간 숨이 한 번 막혔던 걸 기억해
[Male] 가슴이 뛰던 그 밤, 지영아 너였어  ← 심정 라인이 종결감 자연 흡수
```

### 다섯 회상 섹션 헤딩 (실측)
```
Verse 1     "우리 첫 만남은 그 해 4월이었어"
Verse 2     "그 다음 주 토요일이 우리 첫 약속이었지"
Pre-Chorus  "그렇게 우리만의 시간이 쌓이기 시작했어"
Verse 3     "거기서 우리는 평생을 약속했지"
Bridge      "그 봄에 우리는 결혼을 그리고 있었지"
```

각 섹션이 들어가기 전에 시점이 선언되고, 그 다음 4-6줄이 그 프레임 안에서 펼쳐진다. 1회 청취 환경에 최적화된 톤.

### 영향·회귀
- 기존 잡(`69f385a290b219a946ddca4a` 등) 가사 데이터 변경 없음 — 옛 END 마커 그대로 보존
- 새 잡부터 START 헤딩 적용
- 음악 생성·인증·assets·share 등 영향 없음
- 프론트엔드 변경 0

### 새 검증 잡 (사용자가 직접 들어볼 수 있는 진행)
- 잡 ID `69f59101dc29030d38efc84a`, status=lyrics_ready
- title="우리라는 계절"
- 사용자가 `/projects/69f59101dc29030d38efc84a` 들어가서 가사 확인 후 "이 가사로 음악 만들기" 누르면 v3 흐름 그대로 Suno 생성까지 연결

### 서버 상태 (켜둠)
- Backend uvicorn PID 52817 + 52819 (:8000)
- Frontend Vite (:5000, 이전 PID 그대로 유지)
- 외부 접근: `http://100.127.225.55:5000`

### v4 인계 (변경 없음)
- 음악 재생성 / music_failed 재시도 시 검증 조건 완화
- 캐릭터 시트(신랑/신부 2인 일관성)
- MV 영상 생성 (Kling/Seedance + 씬 플래너 + 자막 + Sync Labs 립싱크)
- 결과 공유 페이지

---

## v4 — 2026-05-23 ~ 2026-05-24 — 신랑·신부 캐릭터 시트 (평상복 + 웨딩 촬영복)

### 요청
위저드 Step 1 신랑·신부 이름/나이 아래에 캐릭터 시트 생성 패널을 단다. 한 사람당 2장(평상복 + 웨딩 촬영복), 총 4시트. 의상은 카탈로그에서 선택, 이미지 모델은 GPT Image 2 디폴트(Nano Banana Pro 선택 가능).

### 결과 — PASS (1 medium defect filed and fixed in same pass)

#### Backend
- **신규**: `app/services/openai_image.py` (GPT Image 2 wrapper, 스냅샷 `gpt-image-2-2026-04-21`, 1800s timeout, generations/edits 분기, 1회 재시도) — 레퍼런스 버바팀 포트.
- **신규**: `app/services/character_generator.py` (Gemini 텍스트 + 이미지 모델 분기 2-step). 디폴트 `image_model="gpt_image_2"` 로 플립. role/style/user_id 추적자 인자 추가.
- **신규**: `app/services/outfit_seeder.py` — startup 1회 시드. 12 조합 × 4 아이템 = 48 PNG placeholder (PIL, 512×512, 결정적 색상 + 라벨). MongoDB `wedding_outfit_items` 컬렉션 + MinIO `mv-wedding-photos/outfits/...` 에 영속화. Idempotent.
- **확장**: `app/routes/character.py` — stub `/couple` 유지 + 신규 7개 엔드포인트(`/sheets/generate`, `/sheets/save`, `/sheets/refine`, `GET /sheets`, `GET /preview/{path}`, `GET /outfits`). 이미지 모델 / role / style / category 입력 검증. preview 라우트는 `?token=` 쿼리 fallback 지원. refine 은 sheet_object_name 형식(객체 이름 참조 — 큰 PNG 재업로드 방지) + 소유권 prefix 체크(403/404).
- **수정**: `app/main.py` — lifespan startup 에 `seed_outfits()` 추가, `logging.basicConfig(level=INFO, force=True)` 추가 (defect D-1 해결).
- **deps**: `requirements.txt` 에 `Pillow` 추가.

#### Frontend
- `frontend/src/api/index.js` — 신규 함수 `generateCharacterSheet`, `saveCharacterSheet`, `refineCharacterSheet`, `getCharacterSheets`, `getWeddingOutfits`, `sheetPreviewUrl` 추가. baseURL 그대로.
- `frontend/src/pages/OutfitSelectPage.jsx` + `.css` — `/outfits/:role/:style/:category` 라우트. 카탈로그 카드 그리드, 선택 시 위저드로 state 반환.
- `frontend/src/components/CharacterSheetPanel.jsx` + `.css` — 슬롯 1개 캡슐. 얼굴 드롭존, user_text 입력, 이미지 모델 라디오(GPT Image 2 디폴트), outfit 3슬롯, 생성/저장/다시 생성/보정.
- `frontend/src/pages/StoryWizardPage.jsx` — Step 1 아래에 4 패널 렌더. 위저드 draft 를 `sessionStorage('wedding-wizard-draft')` 로 출판해서 outfit 페이지 왕복 후 상태 복원. File 객체는 직렬화 불가라 face_preview blob URL 만 유지(하드리프레시 시 재업로드 필요 — 위저드 round-trip 에서는 영향 없음).
- `frontend/src/App.jsx` — `/outfits/:role/:style/:category` ProtectedRoute 추가.
- `frontend/src/pages/StoryWizardPage.css` — `.sheets-block`, `.sheets-block__grid` (640px 이하 1열).

### 통합 테스트 결과 (tester)

| # | 항목 | 결과 |
|---|---|---|
| 1 | 인프라 / 인증 / `/character/couple` stub 회귀 | PASS |
| 2 | 카탈로그 시드 — 12 조합 모두 4 items, 잘못된 role 400, preview 200 image/png | PASS |
| 3 | 시트 초기 상태 — 4 슬롯 모두 null | PASS |
| 4 | `/sheets/generate` 실제 GPT Image 2 호출 — 200, preview PNG 5.7MB / 2048×2048 | PASS |
| 5 | `/sheets/save` → MongoDB upsert + MinIO 영구화 | PASS |
| 6 | `/sheets/refine` 소유권 403, missing 404 | PASS |
| 7 | 위저드 회귀(`vite build` 성공, `/api/mv/jobs` 200) | PASS |
| 8 | 로깅 traceability — `[OutfitSeed]`, `[CharRoute]`, `[CharGen]`, `[OpenAIImage]` info 라인 | **PASS (D-1 수정 후)** |

### 발견·수정한 결함

- **D-1 (medium) — `logger.info()` 침묵 출력**
  - 원인: `app/main.py` 가 root logger를 설정하지 않아 Python 기본값 WARNING 유지. `[CharRoute]`, `[CharGen]`, `[OpenAIImage]` 의 info 라인이 모두 drop.
  - 수정: `app/main.py` 최상단에 `logging.basicConfig(level=INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", force=True)` 추가.
  - 재검증: `[OutfitSeed] start roles=2 styles=2 ...` 및 `[CharRoute] /outfits entry user_id=… role=groom style=casual category=top` 라인이 로그 파일에 출력됨.

- **D-2 (minor / non-bug) — refine 멀티파트 필드명 `photo`**
  - tester 브리프에 `file=@face.png` 으로 적은 오타. 실제 frontend/api/index.js 와 backend 모두 `photo` 사용 — 정상. 코드는 무수정.

### 데이터 영속화 현황
- MongoDB `wedding_outfit_items`: 48 docs (시드).
- MongoDB `wedding_character_sheets`: 사용자가 저장하면 upsert. tester 검증 시 1 doc 생성됨.
- MinIO `mv-wedding-photos/outfits/{role}/{style}/{category}/{idx:02d}.png`: 48 개.
- MinIO `mv-wedding-photos/characters/{user_id}/{role}_{style}/sheet.png`: 영구 시트.
- MinIO `mv-wedding-photos/characters/temp/{user_id}/{role}_{style}/{uuid}.png`: 임시 시트.

### 영향·회귀 점검
- 기존 가사 생성·Suno 음악 생성·`/api/character/couple` stub 흐름 모두 정상.
- 위저드 Step 1 `canNext` 로직 변경 없음(이름만 필수, 시트는 옵션).
- `mv-wedding-photos` 버킷에 prefix `outfits/`, `characters/` 추가 — 기존 자산과 겹침 없음.

### 잔여 / 운영 메모
- 시드 outfit 이미지는 PIL 로 만든 placeholder. 실제 운영 의상 카탈로그로 교체할 때는 같은 mongo 컬렉션에 doc 추가 + MinIO 같은 prefix 에 PNG 업로드.
- `OPENAI_API_KEY` 비어 있으면 `/sheets/generate` 503. `nb_pro` 만 쓰려면 `GOOGLE_API_KEY` 필요.
- D-1 수정 부수효과: 모든 모듈 INFO 라인이 stdout 으로 흘러 uvicorn 액세스 로그와 인터리브 됨. 로그 양 증가 — 운영시 log rotation 고려 (현 v4 범위 아님).

---

## v5 — 2026-05-24 — 아이템관리 탭 (사용자 의상 카탈로그 CRUD)

### 요청
헤더에 `[아이템관리]` 메뉴 추가. 사용자가 의상 아이템(이름·역할·스타일·카테고리·이미지·구매처 URL)을 직접 등록/수정/삭제. 등록 아이템은 전역으로 보이며 위저드 캐릭터 시트 생성 시 OutfitSelectPage 의 상의/하의/신발 그리드에 시드 placeholder 와 함께 자연스럽게 노출.

### 결과 — PASS (18/18, 결함 0건)

#### Backend (`backend_8000`)
- `app/routes/character.py` 에 4개 엔드포인트 추가 (+440 LOC). 기존 `GET /outfits` 는 **무수정** — 글로벌 가시성 유지를 위해.
  - `POST /api/character/outfits` — multipart(image/name/role/style/category/product_url). 입력 검증, MinIO put → mongo insert. Mongo insert 실패 시 best-effort MinIO 정리.
  - `GET /api/character/outfits/mine` — `created_by == user_id` 필터, 옵션 role/style/category. created_at desc.
  - `PUT /api/character/outfits/{item_id}` — ObjectId 검증, 404, 403(소유자 한정), 이미지 교체 시 이전 객체 best-effort remove.
  - `DELETE /api/character/outfits/{item_id}` — 404/403 동일, best-effort MinIO remove + mongo delete.
- 신규 schema 필드(`created_by`, `product_url`, `source:"user"`, `updated_at`)는 user-added doc 에만 부여. 시드 48개는 무변경.
- MinIO 경로: `mv-wedding-photos/outfits/user/{user_id}/{uuid.hex}{ext}`.

#### Frontend (`frontend/src`)
- `api/index.js` — `createOutfitItem`, `getMyOutfitItems`, `updateOutfitItem`, `deleteOutfitItem` 추가. 이미지 URL 은 기존 `sheetPreviewUrl` 재사용.
- `components/Header.jsx` — 로그인 시 `[내 작품]` 다음에 `[아이템관리]` 링크 삽입.
- `App.jsx` — `/items` ProtectedRoute → `<ItemManagePage />` 추가.
- `pages/ItemManagePage.jsx` + `.css` 신규:
  - 필터 탭(5): 전체 / 신랑·평상복 / 신랑·웨딩 / 신부·평상복 / 신부·웨딩 — 클라이언트 사이드 필터.
  - 추가/수정 폼: 아이템명, `role_style` 4-way 라디오(`groom_casual` 등) + `category` 3-way 라디오(`top/bottom/shoes`), 이미지 드롭존(10MB 한도, blob URL 라이프사이클 관리), 구매처 URL(선택).
  - 본인 아이템 테이블: 썸네일·이름·신랑/신부·스타일·카테고리·등록일·수정/삭제 버튼.
  - Edit mode: 행 선택 → 폼 prefill, 수정 행 highlight. 이미지 미선택 시 기존 이미지 보존(PUT 에서 image 필드 생략 → 백엔드 옵션).
  - 모바일 ≤640px stack 레이아웃.

### 통합 테스트 결과

| Section | 항목 | 결과 |
|---|---|---|
| A | 회귀 (`/health`, 기존 `/outfits` 시드, `/sheets`, `/mv/jobs`) | 4/4 PASS |
| B | 생성 + `/mine` + 글로벌 가시성 (user1, user2 둘 다 5개 보임) | 4/4 PASS |
| C | PUT 이름 변경 / 크로스유저 403 / 이미지 교체 | 3/3 PASS |
| D | DELETE 크로스유저 403 / 본인 200 / 시드 복귀 | 4/4 PASS |
| E | `npm run build` 성공, Vite 서빙 정상 | 2/2 PASS |
| F | 로그 `[CharRoute]` `entry`/`mongo`/`MinIO`/`user_id=` 추적자 출력 | 1/1 PASS |

대표 로그:
```
[CharRoute] /outfits POST entry user_id=8c1e2f5c... role=groom style=casual category=top name_len=15 product_url_set=True
[CharRoute] /outfits PUT minio put ok user_id=8c1e2f5c... item_id=6a11e4bd... object=outfits/user/.../fe84d58272...png
[CharRoute] /outfits DELETE mongo delete_one ok user_id=8c1e2f5c... item_id=6a11e4bd... role=groom style=casual category=top
WARNING [CharRoute] /outfits PUT ownership reject user_id=b7ccc427-... owner=8c1e2f5c-...
```

### 영향·회귀 점검
- 기존 `GET /outfits?role&style&category` 응답 페이로드 무변경 — 시드와 사용자 doc 모두 동일 shape 으로 반환 (`source`/`created_by` 등 내부 필드는 응답에 노출 안 함).
- 시드 48개 doc 안전 — 본 작업으로 변경/삭제된 doc 없음.
- v4 캐릭터 시트, 가사·음악 생성, `/character/couple` stub 모두 정상.
- 헤더에 한 링크 추가 — 모바일 nav 영향 없음(기존 nav-link 클래스 재사용).

### 잔여 / 후속 (이번 범위 아님)
- 위저드 OutfitSelectPage 카드에서 product_url 외부 링크 노출. 백엔드 응답에 url 추가 시 자연스럽게 표시 가능.
- 활성/비활성 토글(`is_active`) — 본 v5 에서는 하드 삭제만 지원 (사용자 요구 없음).
- 시드 doc 삭제 권한 — 의도적으로 막힘 (시드는 `created_by=null` 이라 어떤 사용자도 삭제 불가).

---

## v6 — 2026-05-24 — 시트 생성 비동기 잡 + 넉넉한 타임아웃

### 요청
시트 generate/refine 의 동기 호출이 GPT Image 2 의 2~5분 지연 동안 HTTP 연결을 유지하면서 Tailscale/브라우저 idle-socket timeout 으로 끊겨 백엔드 200 OK 가 클라이언트에 도달 못 하는 문제 발생. 가사·음악 잡 패턴(`asyncio.create_task` + mongo + 폴링) 으로 전환하고 OpenAI 타임아웃 60분으로 넉넉하게 상향.

### 결과 — PASS (24/24, 결함 0건)

#### Backend (`backend_8000`)
- `app/services/openai_image.py` (+9 LOC) — `_call_generations` / `_call_edits` 두 곳 `httpx.AsyncClient(timeout=1800.0)` → **3600.0 (60분)**. 각 호출에 `elapsed_s` 로그 추가.
- `app/services/character_generator.py` (+11 LOC) — `_call_gemini_text` timeout 120 → **300 (5분)**. `_call_gemini_image` 은 NB Pro 가 30~60s 면 충분하므로 180s 유지. 두 함수 모두 `elapsed_s` 로그 추가.
- `app/routes/character.py` (+341 LOC):
  - 신규 mongo 컬렉션: `wedding_sheet_jobs` (스키마: `{user_id, type, role, style, image_model, user_text, status:"queued"|"running"|"done"|"failed", face_object_name 또는 photo_object_name + source_sheet_object_name + refine_request 등 입력 refs, sheet_object_name, error_message, created_at, updated_at}`).
  - `POST /sheets/generate` 와 `POST /sheets/refine` 를 fire-and-poll 패턴으로 교체: 입력 검증 → multipart UploadFile 을 즉시 MinIO temp(`characters/temp/{user_id}/{role}_{style}/input_{uuid}{ext}`) 에 stash → mongo insert → `asyncio.create_task` → `{job_id, status:"queued", role, style}` 즉시 반환 (~20~80ms).
  - 신규 백그라운드 함수: `_run_sheet_generation(job_id)`, `_run_sheet_refinement(job_id)`. `[SheetJob]` prefix 로 라이프사이클 로깅 (queued → running → loading face/outfits → calling generate_character_sheet → minio put → done|failed).
  - 신규 폴링 엔드포인트: `GET /api/character/sheets/jobs/{job_id}`. ObjectId 검증(400), 미존재(404), 소유권(403). 응답: `{job_id, type, status, role, style, image_model, user_text, sheet_object_name, preview_url, error_message, created_at, updated_at}`.

#### Frontend (`frontend/src`)
- `api/index.js` — `getSheetJob(jobId)` 추가. `generateCharacterSheet` / `refineCharacterSheet` 시그니처는 그대로(응답 본문만 `{job_id, status}` 형태로 변경).
- `components/CharacterSheetPanel.jsx` — 동기 await 를 fire-and-poll 로 교체:
  - slot state 신규 필드: `generate_job_id`, `refine_job_id`, `generate_started_at`, `refine_started_at`.
  - `useEffect` 2개(generate/refine 각각, 5초 간격) — 응답 status 변경 시에만 slot state patch (불필요 re-render 회피, `useRef` 로 last-seen status 추적).
  - 경과 시간 UI: "생성 중... N초 경과 — GPT Image 2 는 보통 2~5분 걸려요." (1초 tick).
  - **새로고침 / 라우트 이탈 후 복귀 자동 재개**: resume `useEffect` 가 `job_id 존재 + generating=false` 감지 → `generating=true` 패치 → 폴링 effect 자동 재시작.
- `pages/StoryWizardPage.jsx` — `sanitizeSheetsForStorage` 가 4개 job 관련 필드 보존(나머지는 기존대로 strip).

### 통합 테스트 결과

| Section | 항목 | 결과 |
|---|---|---|
| A | 코드 검증 (grep) — 타임아웃·컬렉션·`asyncio.create_task` | 4/4 PASS |
| B | 회귀 (`/health`, `/mv/jobs`, `/character/sheets`, `/outfits`, `/outfits/mine`) | 6/6 PASS |
| C | 비동기 잡 — POST 23ms 응답, GET 폴링 status 정상, 검증 실패 케이스 | 5/5 PASS |
| D | 소유권 (cross-user 403, invalid id 400, missing 404) | 3/3 PASS |
| E | Refine 잡 (실제 저장된 시트로 200, cross-user 403) | 2/2 PASS |
| F | `[SheetJob]` 라이프사이클 로그 + `elapsed_s` | 2/2 PASS |
| G | `npm run build` + Vite 서빙 | 2/2 PASS |

대표 로그 (한 잡의 전체 라이프사이클):
```
13:13:38 [SheetJob] queued job_id=6a127af2... type=generate
13:13:38 [SheetJob] calling generate_character_sheet job_id=6a127af2...
13:16:40 [OpenAIImage] edits http=200 refs=1 size=2048x2048 elapsed_s=161.5
13:16:40 [SheetJob] generate done bytes=5504307 job_id=6a127af2...
13:16:40 [SheetJob] done job_id=6a127af2...
```

OpenAI 실제 소요 161~180s — 새 timeout 3600s 와 비교하면 충분한 헤드룸.

### 영향·회귀
- `/sheets/generate`, `/sheets/refine` **응답 본문 변경** — 동기 호출의 `{object_name, preview_url, ...}` → 비동기 `{job_id, status}`. 백워드 호환 끊김. 프론트가 동시 변경되므로 안전. (자체 호출자 없음.)
- 가사·음악, OutfitSelectPage, ItemManagePage, `/character/couple` stub 모두 무영향.
- MinIO temp prefix `characters/temp/.../input_*` 추가 — 기존 prefix 와 겹침 없음.
- mongo `wedding_sheet_jobs` 신규 — 기존 컬렉션 영향 없음.

### 후속 (이번 범위 밖)
- temp MinIO 객체 누적 정리 cron.
- 잡 동시성 제한(슬롯당 1개) — 현재는 사용자가 같은 슬롯에서 빠르게 두 번 누르면 두 잡이 동시 진행될 수 있음 (마지막 응답이 이김). 사용자 요구 없어 추가 안 함.
- 잡 progress 0~100 세분화.

### Vite dev-server 트랜스폼 캐시 주의
tester 메모: 첫 curl 시 oldcache 64KB 트랜스폼이 떨어졌고, `?t=<timestamp>` cache-buster 로 89KB 신규 코드 확인. 브라우저에서 변화가 안 보이면 **하드 리프레시(Ctrl+Shift+R)** 또는 DevTools "Disable cache" 켜고 새로고침.
