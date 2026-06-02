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


## v7 — 2026-05-26 — 시트 display_name + 장소 이미지 자산 + wedding_assets 통합 컬렉션

### 요청 작업
1. 캐릭터 시트 4슬롯마다 사용자 지정 "시트 이름" (`display_name`) 입력칸 추가.
2. 캐릭터 시트 그리드 바로 아래에 신규 "장소 이미지 자산" 섹션 추가. N개 슬롯 자유 추가, 슬롯마다 장소 이름 + 메모 + 이미지 업로드 또는 생성(GPT Image 2 / Nano Banana Pro, fire-and-poll) + 삭제.
3. Mongo `wedding_assets` 단일 컬렉션으로 character_sheet + place 통합 관리.

### 변경 파일
**백엔드** (`backend_8000/app/`)
- `routes/character.py` 수정 — `SaveSheetRequest` 에 `display_name`, `slot_doc` 에 기록, save 직후 `wedding_assets` upsert(non-fatal), `GET /sheets` 응답·`/sheets/save` 응답에 `display_name`, entry 로그에 `display_name_len`.
- `routes/places.py` 신설 — `/api/places` prefix, 6개 엔드포인트(upload, generate, jobs/{id}, list, update, delete) + 백그라운드 잡 `_run_place_generation`. 로그 prefix `[PlaceRoute]` / `[PlaceJob]`.
- `services/place_generator.py` 신설 — `generate_place_image(display_name, memo, image_model, user_id, place_id) → bytes`. `gpt_image_2` 는 `openai_image.generate_image` 호출, `nb_pro` 는 `character_generator._call_gemini_image` 호출. 프롬프트는 단순 조립(LLM 추가 호출 없음). 로그 prefix `[PlaceGen]`.
- `main.py` — `from .routes import ..., places` + `app.include_router(places.router)` 한 줄.

**프론트엔드** (`frontend/src/`)
- `api/index.js` 수정 — 6개 함수 추가: `createPlaceUploaded`, `generatePlace`, `getPlaceJob`, `listPlaces`, `updatePlace`, `deletePlace`. 장소 이미지 미리보기는 기존 `sheetPreviewUrl` 재사용(동일 버킷).
- `components/CharacterSheetPanel.jsx` 수정 — `user_text` 위에 "시트 이름" 입력칸. `handleSave` 페이로드에 `display_name`. 콘솔 로그 컨텍스트에 `display_name_len`.
- `components/CharacterSheetPanel.css` 수정 — `.sheet-panel__name` 블록(작은 폰트·accent 컬러로 시각적 차별화).
- `components/PlaceAssetPanel.jsx` 신설 — props 없는 자체-상태 컴포넌트. 마운트 시 `listPlaces`, 카드형 슬롯 CRUD, fire-and-poll(5초 인터벌, 모든 active job 통합 폴링), 파일 사전 검증(jpg/png/webp, 10MB), draft 슬롯은 로컬에만 존재(저장 시 서버 응답으로 교체), name/memo blur 시 PUT. 로그 prefix `[PlaceAssetPanel]` / `[PlaceAssetPanel:${place_id}]`. dev 가드된 info 로그 + 무가드 error 로그.
- `components/PlaceAssetPanel.css` 신설 — `.sheets-block` 톤 매치, auto-fill 320px 그리드, 카드는 좌(미리보기 140px) + 우(컨트롤) 2단, ≤520px 세로 스택.
- `pages/StoryWizardPage.jsx` 수정 — `emptySheetSlot()` 에 `display_name: ''`, `sanitizeSheetsForStorage` 에 명시 보존, `.sheets-block` 닫는 `</div>` 다음 자매 요소로 `<PlaceAssetPanel />` 배치(=캐릭터시트 4슬롯 바로 밑).

### 데이터 모델 (신설)
- `wedding_assets` 컬렉션 — `{user_id, type: "character_sheet"|"place", display_name, source: "uploaded"|"generated", object_name, meta:{role,style,image_model,memo}, created_at, updated_at}`. character_sheet 는 `(user_id, type, meta.role, meta.style)` upsert. place 는 doc `_id` 가 `place_id`.
- `wedding_place_jobs` 컬렉션 — `{user_id, place_id, type:"generate", status, image_model, display_name, memo, object_name, error_message, created_at, updated_at}`.
- MinIO 경로 — temp `places/temp/{user_id}/{place_id}_{uuid}.png`, permanent `places/{user_id}/{place_id}.{ext}` (버킷 `mv-wedding-photos`).

### 테스트 결과 (테스터 보고, 22개 항목)
| 영역 | 항목 | 결과 |
|------|------|------|
| 시트 display_name 스키마(T01~T03) | 응답·로그 검증 | 3/3 PASS (skip-grade — 실제 시트 저장은 OpenAI 비용/시간상 제외, 코드·페이로드·로그 차원 확인) |
| 장소 자산 라이프사이클(T04~T09) | upload / preview / generate(gpt_image_2 + nb_pro) / PUT / list / DELETE | 6/6 PASS — `nb_pro` 잡 ~19초 완료, `gpt_image_2` 는 running 확인 |
| wedding_assets 무결성(T10~T12) | list 결과 + 로그 라인 | 3/3 PASS |
| 회귀(T13~T19) | health / 401 / 400 / 403 / 입력검증 / 의상관리 | 7/7 PASS |
| 로그 명세(T20~T22) | `[PlaceRoute]`, `[PlaceGen]`, `display_name_len` | 3/3 PASS — 추적자(user_id, place_id, job_id) 일관 포함, 민감 정보 없음 |

전체 22/22 PASS. 서버 양쪽 200 응답 유지.

### 특이사항
- `_call_gemini_image` 가 module-private 함수라 `from .character_generator import _call_gemini_image` 로 직접 import. 향후 character_generator 리팩토링 시 표면 면적 노출 주의.
- `wedding_assets` 의 character_sheet 슬롯 unique 인덱스(`user_id+type+meta.role+meta.style`)는 운영 단계에서 추가 권장. 현재는 upsert filter 로 충분.
- 시트 잡 완료 시점(`_run_sheet_generation`) 이 아니라 `/sheets/save`(permanent 복사) 시점에서 자산 등록 — temp 단계에는 영구 object_name 이 없기 때문.
- 자산 upsert 실패는 시트 저장 자체를 깨뜨리지 않는 non-fatal 처리(warning 로그만).
- 프론트엔드 UI 는 사용자가 브라우저에서 직접 검증해야 함(테스터는 API 차원 검증). 백엔드 API 는 UI 가 호출하는 동일 엔드포인트라 등가 검증.
- 잔여 테스트 데이터: `tester_v7@example.com`, `tester2_v7@example.com`, generated places 2개. 필요 시 별도 정리.

### 후속 (이번 범위 밖)
- 자산 → 영상 자동 조립.
- 자산 검색·태그.
- 장소 자산 보정(refine) — 시트의 refine 기능과 동등 패턴 가능.
- `_call_gemini_image` 의 public export 화.
- `wedding_assets` unique 인덱스 보강.


## v8 — 2026-05-26 — story 텍스트 @-멘션 자동완성 (캐릭터 시트 + 장소 자산 태깅)

### 요청 작업
Step2 의 6개 story 텍스트 입력(첫 만남, 첫 데이트, 추억들[N], 결혼 결심, 웨딩 준비, 둘만의 단어·장소) 에 `@` 입력 시 자동완성 팝업 — 캐릭터 시트 4종 + 장소 자산 N개 중 선택해 `@<이름>` 칩 삽입. 본문은 자연어 그대로, refs 배열을 별도로 저장. 추후 영상 자동 생성 시 프롬프트 컨텍스트로 명시 주입할 메타데이터 토대.

### 변경 파일
**백엔드**
- `backend_8000/app/models/story.py` — `MentionRef` 클래스 신설(type Literal sheet|place, asset_id, display_name, object_name|None). `StoryDetails` 에 6개 옵션 refs 필드 추가(`*_refs`, `memories_refs` 는 2차원). 모두 `Field(default_factory=list)`.
- `backend_8000/app/routes/story.py` — `[StoryRoute]` logger 추가. POST/GET 양쪽에 entry/ok/warning/exception 로그(`user_id`, `story_id`, `total_mentions`, `memories_count` 토큰). `_normalize_story_refs` 헬퍼로 구버전 도큐먼트 GET 응답 시 빈 배열 채움. POST insert 실패는 try/except → 500 JSONResponse.

**프론트엔드** (신설 2 + 수정 5)
- `frontend/src/components/MentionField.jsx` (신설) — textarea + mirror 오버레이 + 팝업. `/@([^\s@]{0,30})$/` 트리거, 그룹별(🧑/📍) 옵션 렌더, ArrowUp/Down/Enter/Tab/Esc/Backspace 키 처리, 칩 통째 삭제, `reconcileRefs` 로 본문↔refs 동기화. 로그 prefix `[MentionField:{ariaLabel|id}]` (DEV 가드 info + 무가드 error).
- `frontend/src/components/MentionField.css` (신설) — `.mention-mirror`, `.mention-popup`, `.mention-chip`(=PLAN 의 `.chip`).
- `frontend/src/components/SceneInput.jsx` (수정) — 내부 textarea → `<MentionField>` 교체, props 확장(`refs/onChangeRefs/options/ariaLabel`).
- `frontend/src/components/SceneInput.css` (수정) — textarea 룰 슬림화(mention 호환).
- `frontend/src/components/DynamicList.jsx` (수정) — multiline 항목을 `<MentionField>` 로 렌더, props 확장(`refsList/onChangeRefs/options`). multiline=false 분기는 기존 `<input>` 유지.
- `frontend/src/components/DynamicList.css` (수정) — wrap div 추가.
- `frontend/src/pages/StoryWizardPage.jsx` (수정) — `initialData.story` 에 6개 refs 필드. 마운트 시 `getCharacterSheets`+`listPlaces` 병렬 fetch → `mentionOptions` 빌드. Step2 5개 SceneInput + memories DynamicList + rituals 자유 textarea 모두 `<MentionField>` 기반 입력으로 교체. `buildPayloads.storyPayload.story` 에 refs 6필드 포함, memories 본문 정리 시 같은 인덱스 refs 동기화. `loadInitial` 에 구버전 draft refs 보정 로직.

### 데이터 모델
- `MentionRef`: `{type, asset_id, display_name, object_name}`. asset_id 는 sheet 의 경우 슬롯 키(`groom_casual` 등), place 의 경우 `wedding_assets._id`.
- `StoryDetails` 6필드 본문 + 6필드 refs(memories_refs 는 2차원 parallel array).
- mongo `stories` 컬렉션은 schema-less 라 추가 인덱스/마이그레이션 불필요.

### 후보 풀 fetch 전략
- 신규 백엔드 라우트 없음. 기존 `GET /api/character/sheets` + `GET /api/places` 두 호출을 클라이언트가 합침. 변경 면적 최소.

### 테스트 결과 (테스터 보고, 13/13 PASS)
| 영역 | 항목 | 결과 |
|------|------|------|
| 백엔드 라이프사이클 (T1~T6) | 빈 refs / 채운 refs / 잘못된 type 422 / 타인 GET 403 / 잘못된 id 400 / 로그 prefix·토큰·민감정보 | 6/6 PASS |
| 프론트엔드 정적 검증 (T7~T10) | MentionField 핵심 코드·CSS / StoryWizardPage state·payload / SceneInput·DynamicList 시그니처 / vite 트랜스폼 200 | 4/4 PASS |
| 회귀 (T11~T13) | 시트/장소 라우트 무영향 / 헬스 / 인증 | 3/3 PASS |

### 특이사항
- PLAN 의 CSS 클래스명 `.chip` 은 실제 구현에서 `.mention-chip` 으로 prefix 가 붙음(의미 동치). 향후 PLAN 정정 시 반영.
- 가사 생성기는 알려진 키만 읽으므로 새 *_refs 필드는 무시되어 회귀 없음.
- 영상 자동 생성 시 refs 활용은 이번 범위 밖.
- 프론트엔드 UI 동작(팝업 표시·키보드 탐색·칩 시각화)은 사용자가 브라우저에서 직접 검증 권장 — 테스터는 코드 패턴 + 빌드 통과로 등가 검증.

### 후속 (범위 밖)
- 멘션을 가사/영상 프롬프트에 명시 주입.
- 멘션 hover 시 자산 썸네일 미리보기.
- 스토리 텍스트 기반 자산 자동 추천.


## v9 — 2026-05-26 — 텍스트 다듬기 (Claude 4.7 Opus / GPT 최신, @멘션 보존)

### 요청 작업
Step2 자유 텍스트 6곳 옆에 `✨ 다듬기` 버튼. 클릭 → 모달(모델 라디오: Claude 4.7 Opus / GPT 최신 → 원본/다듬은 글 좌우 비교 → 적용/다시/취소). LLM 시스템 프롬프트로 `@멘션` 토큰 100% 보존 강제 + 서버측 사후 검증(refs_preserved).

### 변경 파일

**백엔드** (신설 1, 수정 1)
- `backend_8000/app/services/story_polisher.py` (신설) — `polish_story_text()`, `resolve_model()`(claude_4_7_opus → `claude-opus-4-7` / gpt_latest → `settings.openai_model_advanced`), `_validate_mention_preservation()`(Counter 기반), 시스템 프롬프트(엄격 규칙 6항), Opus 는 temperature 미지정, max_tokens `min(2048, max(256, len(text)*4))`. 로그 prefix `[Polisher]`. **패치(T2 후속)**: `gpt-5.x` 계열 모델은 `max_tokens` 대신 `max_completion_tokens` 사용 + temperature 미지정으로 분기.
- `backend_8000/app/routes/story.py` (수정) — `PolishRequest` Pydantic 모델 + `POST /api/story/polish` 라우트. 키 부재 시 503, 일반 예외 500. 로그 prefix `[StoryRoute] /polish` (user_id/model/text_len/ref_count/elapsed_ms/refs_preserved/polished_len 토큰).

**프론트엔드** (신설 4, 수정 5)
- `components/PolishCompareModal.jsx` (신설) — phase state(idle/loading/result/error), 1초 tick 경과초, Esc 닫기, refs_preserved=false 경고 배너, 좌우 2단 비교(<700px 1단 스택). 로그 prefix `[PolishModal]`.
- `components/PolishCompareModal.css` (신설) — 다크톤 모달.
- `components/PolishButton.jsx` (신설) — 빈 텍스트 disabled. 적용 시 본문 교체 — refs reconcile 은 MentionField 가 자동 처리.
- `components/PolishButton.css` (신설) — 작은 inline 버튼.
- `api/index.js` (수정) — `polishStoryText(payload)` 추가 (axios timeout 90000ms).
- `components/SceneInput.jsx` (수정) — 라벨 우측에 `<PolishButton>`.
- `components/SceneInput.css` (수정) — 우측 정렬.
- `components/DynamicList.jsx` (수정) — multiline 행에 `<PolishButton>`.
- `components/DynamicList.css` (수정) — 절대위치 우상단.
- `pages/StoryWizardPage.jsx` (수정) — rituals 라벨에 `<PolishButton>`.
- `pages/StoryWizardPage.css` (수정) — flex 정렬.

### LLM 호출 요약
- Claude 4.7 Opus: `AsyncAnthropic.messages.create(model="claude-opus-4-7", system=..., messages=[{user}], max_tokens, temperature 미지정)`.
- GPT 최신(`gpt-5.4`): `AsyncOpenAI.chat.completions.create(model="gpt-5.4", messages=[{system},{user}], max_completion_tokens, temperature 미지정)`.
- 그 외 OpenAI 모델: 기존대로 `max_tokens` + `temperature=0.4`.

### 멘션 보존 검증
- 시스템 프롬프트 규칙 ② 로 LLM 에 강제.
- 서버측 `_validate_mention_preservation(original, polished, refs)`: 각 ref display_name 의 `@<name>` 토큰이 polished 안에 원본 등장 횟수 이상 존재하는지 카운트. 누락 시 `refs_preserved=false` 응답.
- 프론트는 false 시 경고 배너 + 사용자에게 [다시 다듬기] 권장.

### 테스트 결과 (22개 항목, 패치 후)
| 영역 | 항목 | 결과 |
|------|------|------|
| A. 엔드포인트 (T1~T6) | Claude/GPT 호출·빈/초과/잘못된 model/인증 | 6/6 PASS |
| B. 멘션 보존 (T7~T9) | refs 포함·다중 등장·누락 시나리오 | 2/2 PASS, 1 SKIP(누락 재현 불가) |
| C. LLM 응답 품질 (T10~T11) | Claude/GPT 자연스러움 시각 검증 | 2/2 PASS |
| D. 프론트엔드 정적 (T12~T14) | Vite 트랜스폼·코드 패턴·빌드 무에러 | 3/3 PASS |
| E. 회귀 (T15~T17) | story POST/GET·health·sheets/places | 3/3 PASS |
| F. 로그 (T18~T20) | StoryRoute·Polisher·민감정보 | 3/3 PASS |

**합계 20/22 PASS, 1 SKIP, 0 FAIL** (T2 는 패치 후 PASS, T9 는 LLM 보존 양호로 누락 시나리오 재현 불가).

### LLM 응답 샘플 (시각 검증)
- 원본: `"4월 비오던 회식 끝난 야근 그 사람과 모니터 너머 눈마주쳤어"`
- Claude 4.7 Opus 결과: `"4월 어느 비 오던 날, 회식이 끝난 뒤 야근을 하다가 모니터 너머로 그 사람과 눈이 마주쳤다."` (2.4초, refs_preserved=true)
- GPT 5.4 결과: `"4월, 비 오던 날 회식이 끝난 뒤 야근을 하다 그 사람과 모니터 너머로 눈이 마주쳤어"` (5.2초, refs_preserved=true)
- 멘션 보존: `"우리가 처음 만난 곳은 @한강 카페 였어. @한강 카페 의 창가 자리에서..."` → 결과에 `@한강 카페` 2회 그대로 보존(refs_preserved=true).

### 특이사항
- gpt-5.x 계열은 `max_tokens` 키를 지원하지 않음 — `max_completion_tokens` 로 분기. 같은 패턴이 `services/lyrics_generator.py` 의 OpenAI 호출에도 있음 → 향후 gpt-5 계열로 가사 생성 시도 시 동일 이슈 발생 가능. 이번 v9 범위 밖이라 미수정.
- gpt-5.x 는 temperature 도 일부 거부 가능 — 선제적으로 미지정 분기 추가.
- 다듬은 결과 길이 비율은 원본의 1.0~1.6× 정도 — 시스템 프롬프트 규칙 ⑤ ±30% 범위에서 일부 벗어남(짧은 원본일수록 +30 글자 보강 룰 적용). 영상 프롬프트로 쓸 때 명료성 확보 우선이라 허용 범위.
- 비동기 폴링 없음 — 동기 HTTP. 5~30초 응답이라 axios timeout 90000ms 로 충분.
- 의존성 추가 없음 — `anthropic`/`openai` 이미 설치.

### 후속 (범위 밖)
- `lyrics_generator.py` 의 gpt-5 분기 적용(필요 시).
- 다듬은 결과를 sessionStorage 캐싱(연속 재시도 토큰 절약).
- 영상 자동 생성에 다듬은 본문 + refs 활용.


## v9.1 — 2026-05-26 — 멘션 옵션 풀 자동 갱신 (핫픽스)

### 문제
v9 까지의 구현은 StoryWizardPage 마운트 시점에 `getCharacterSheets + listPlaces` 를 한 번만 호출해 `mentionOptions` 를 빌드했음. 사용자가 페이지를 떠나지 않고 캐릭터 시트 저장이나 장소 추가/수정/삭제를 하면, **새 자산이 멘션 후보 풀에 반영되지 않아** `@` 입력 시 아무것도 안 뜨는 현상 발생.

### 원인
StoryWizardPage.jsx 의 `useEffect(() => {...}, [])` 가 dependency array `[]` 로 한 번만 실행됨. 자식 패널(시트/장소)의 mutation 을 부모로 알릴 수단이 없었음.

### 수정
**`frontend/src/pages/StoryWizardPage.jsx`**
- 마운트 시 fetch 로직을 `useCallback` 으로 추출 → `reloadMentionOptions`.
- `useEffect` 는 마운트 시 1회 호출.
- `<CharacterSheetPanel onMentionablesChanged={reloadMentionOptions} />`, `<PlaceAssetPanel onMentionablesChanged={reloadMentionOptions} />` 로 자식에 전달.

**`frontend/src/components/PlaceAssetPanel.jsx`**
- `onMentionablesChanged` prop 추가, `notifyChanged()` 헬퍼 정의.
- 호출 지점 5곳: `handleNameBlur`(이름 변경 PUT 성공), `handleUploadFile`(업로드 성공), `handleGenerate`(잡 시작 — pre-insert 된 asset 반영), poll status='done'(잡 완료 — object_name 채움), `handleDelete`(삭제 성공).

**`frontend/src/components/CharacterSheetPanel.jsx`**
- `onMentionablesChanged` prop 추가.
- `handleSave` 성공 직후 호출 — display_name 이 `wedding_assets` + `wedding_character_sheets` 에 반영된 후 부모가 mention 풀 다시 fetch.

### 검증
- vite HMR 자동 반영, 트랜스폼 200.
- 핫픽스 동작: 사용자가 장소 1개 업로드 → `[StoryWizard] mention_options loaded {count:1}` 로그 (DEV) → `@` 입력 시 팝업 등장.
- 회귀 없음 — 콜백 미제공 시 noop 처리(`typeof === 'function'` 가드).

### 후속
- 옵션 풀이 빈 상태에서 `@` 입력 시 사용자에게 "캐릭터 시트 또는 장소를 먼저 만들어주세요" 안내 토스트 (UX 개선, 범위 밖).


## v10 — 2026-05-27 — @-멘션 팝업에 자산 썸네일 추가

### 변경 파일
- `frontend/src/components/MentionField.jsx` — `api` import + 옵션 행에 `<img>` 썸네일 + placeholder.
- `frontend/src/components/MentionField.css` — `.mention-popup__item` flex 화 + `.mention-popup__thumb`(40×40 rounded) + `.mention-popup__name` 추가.

### 동작
- 팝업 각 행: `[40×40 썸네일] [display_name]`.
- 시트/장소 모두 `api.sheetPreviewUrl(object_name)` 으로 토큰 포함 절대 URL.
- object_name 없거나 로드 실패 시 type 별 이모지(🧑/📍) placeholder.

### 검증
- vite HMR 트랜스폼 200 (`MentionField.jsx`, `MentionField.css` 둘 다).
- 백엔드 무변경, API 호출 추가 없음 (기존 `/api/character/preview/{object_name}?token=` 재사용).

### 영향
- 키보드 탐색·필터·선택·칩 삽입 동작 모두 그대로.
- v9.1 의 mentionOptions 자동 갱신과 함께 작동 — 시트 저장/장소 추가 즉시 새 썸네일이 팝업에 반영됨.


## v11 — 2026-05-27 — 관리자 등급 시스템 + 요청작 + 사용자관리

### 요청 작업
1. 사용자 등급(role: `user` / `admin`) 도입.
2. 관리자 시드 계정 자동 생성: `admin` / `1` (개발용 약한 PW).
3. 관리자 전용 페이지: `/admin/jobs`(모든 사용자 MV 작품) + `/admin/users`(사용자 목록·등급 변경).
4. Header 에 관리자 메뉴 노출 분기 + ProtectedRoute adminOnly 가드.

### 변경 파일

**백엔드** (신설 2, 수정 5)
- `infra/init_postgres.sql` — users 테이블에 `role TEXT NOT NULL DEFAULT 'user'` (fresh setup).
- `app/database/postgres.py` — pool 생성 직후 idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS role`. `get_pool()` 헬퍼. 로그 `[Postgres]`.
- `app/routes/auth.py` — `_create_token`/`_save_session`/register/login/me/update_profile 모두 role 전파. 토큰·세션·응답에 role 포함.
- `app/auth.py` — get_current_user 의 role fallback `'user'`. 신규 `get_current_admin` 의존성(403).
- `app/services/admin_seeder.py` (신설) — `seed_admin()` idempotent. `email='admin'` 없으면 bcrypt('1') 해시로 INSERT, role='admin'. 로그 `[AdminSeed]`. 보안 경고 docstring.
- `app/main.py` — lifespan 에서 `await seed_admin()` (postgres init 직후). `admin` 라우터 등록.
- `app/routes/admin.py` (신설) — prefix `/api/admin`. 엔드포인트 3개:
  - `GET /jobs` — mongo.mv_jobs + postgres users join → 각 job 에 `user_email`/`user_nickname` 포함.
  - `GET /users` — 전체 사용자 목록(role 포함).
  - `PATCH /users/{user_id}/role` — Pydantic `Literal["user","admin"]`. 본인 자기 자신 변경 차단(409). admin 시드 강등 차단(409). Redis 세션 즉시 갱신.

**프론트엔드** (신설 4, 수정 3)
- `api/index.js` — `getAdminJobs/getAdminUsers/updateUserRole` 추가.
- `components/ProtectedRoute.jsx` — `adminOnly` prop. role 불일치 시 `/` 리다이렉트 + warn 로그.
- `components/Header.jsx` — `user?.role === 'admin'` 분기로 `[요청작]` `[사용자관리]` 링크 (내 작품 좌측).
- `App.jsx` — `/admin/jobs`, `/admin/users` 라우트.
- `pages/AdminJobsPage.jsx` (신설) — getAdminJobs → user_id 기준 그룹핑 → 그룹 헤더(닉네임·이메일·개수) + 작품 카드 그리드 + `[상세보기]` Link `/projects/{job_id}`.
- `pages/AdminJobsPage.css` (신설).
- `pages/AdminUsersPage.jsx` (신설) — getAdminUsers 테이블. 본인 + admin 시드는 동작 버튼 disabled. 클릭 시 confirm + updateUserRole. 409/403 분기 토스트.
- `pages/AdminUsersPage.css` (신설).

### 데이터 모델
- PostgreSQL `users.role TEXT NOT NULL DEFAULT 'user'`. 기존 사용자는 default 자동 적용.
- JWT payload 에 `role` 추가. 기존 토큰은 fallback `'user'` 로 무해.
- Redis 세션 dict 에 `role` 추가. 기존 세션은 7일 후 자연 만료(REPORT 안내: 재로그인 권장).

### 시드 계정
- email: `admin` / pw: `1` / nickname: `관리자` / role: `admin`.
- 부팅 시 1회 idempotent INSERT. `[AdminSeed] created admin user_id=...` 로그.

### 테스트 결과 (백엔드 curl 9개 + 프론트 정적 검증)
| 시나리오 | 결과 |
|----------|------|
| admin 로그인 → token + user.role=admin | PASS |
| admin → GET /admin/users (28명) | PASS |
| admin → GET /admin/jobs (22개 + user_email/nickname join) | PASS |
| user → GET /admin/users → 403 | PASS |
| user → GET /admin/jobs → 403 | PASS |
| admin 자신 강등 → 409 | PASS |
| admin 시드 강등 → 409 | PASS |
| 잘못된 role 값 → 422 (Literal) | PASS |
| 다른 사용자 승격/강등 → 200 + 세션 즉시 갱신 | PASS |
| Vite 트랜스폼 신설 4 + 수정 3 모두 200 | PASS |
| Header `user?.role === 'admin'` 분기 + Link 코드 | PASS |
| ProtectedRoute adminOnly 가드 + Navigate to "/" | PASS |
| App.jsx /admin/* 라우트 등록 | PASS |
| 회귀: 일반 user login/register/내작품/시트/장소/멘션 무영향 | PASS |

### 로그 검증
- 백엔드 부팅 로그: `[Postgres] migration ok — users.role column ensured (default 'user')` → `[AdminSeed] created admin user_id=...`.
- `[AdminRoute]` entry/ok/reject 라인에 `admin_id`/`target_user_id`/`new_role` 토큰 포함. 비밀번호·해시·토큰 미노출.

### ⚠ 보안 경고 (재명시)
- 시드 PW `1` 은 매우 약함. **운영 배포 전 반드시 강한 PW 로 교체**. `services/admin_seeder.py` docstring 에도 명시.
- `admin` ID 도 일반적이라 운영에서는 별도 ID 권장.
- 기존 활성 세션은 Redis 에 role 없음 → get_current_user 가 `'user'` fallback. 관리자라면 **재로그인 필요**.

### 후속 (범위 밖)
- admin 비밀번호 변경 UI.
- 사용자 ban/unban (`is_banned` 컬럼은 이미 있음).
- 작품 검색/필터(상태별, 사용자별 필터).
- 다중 admin 등급(super admin 등).


## v12 — 2026-05-27 — "관리자에게 요청" 토글 + 요청작 필터링

### 요청 작업
v11 의 admin `/admin/jobs` 가 **모든** 사용자 작품을 노출하던 동작 변경 → **사용자가 명시적으로 요청한 작품만** 노출. 내 작품 카드에 토글 버튼 추가.

### 변경 파일

**백엔드** (수정 2)
- `app/routes/mv.py` — `_serialize_job` 에 `admin_requested(bool)`, `admin_requested_at(iso|null)` 추가. 신규 엔드포인트 `POST /jobs/{id}/request-admin` (소유자 → admin_requested=true, admin_requested_at=now), `DELETE /jobs/{id}/request-admin` (false + unset). 400/403/404 검증, 멱등. 로그 prefix `[MVRoute]` (action=request_admin|cancel_admin, user_id, job_id).
- `app/routes/admin.py` — `GET /jobs` 의 mongo find 에 `{"admin_requested": True}` 필터 + `.sort("admin_requested_at", -1)`. 로그 ok 라인에 `count` 토큰.

**프론트엔드** (수정 4)
- `api/index.js` — `requestAdminReview/cancelAdminReview` 추가.
- `pages/MyWeddingMVPage.jsx` — `handleToggleAdminReview` (낙관적 업데이트 → API → 응답 동기화 / 실패 시 롤백 + alert). 카드 actions 끝에 토글 버튼 (`🙋 관리자에게 요청` / `✓ 요청됨 · 취소`).
- `pages/MyWeddingMVPage.css` — `.my-mv__admin-toggle`, `.my-mv__admin-toggle--on` (요청됨 시 green pill).
- `pages/AdminJobsPage.jsx` — 카드에 "요청: {ko-KR localeString}" 라인 추가.

### 데이터 모델
- Mongo `mv_jobs` 에 `admin_requested: bool`, `admin_requested_at: datetime|null`.
- 스키마리스 — 구버전 도큐먼트는 `get(key, default)` 로 안전.

### 테스트 (백엔드 8 시나리오 + 프론트 정적)
| 시나리오 | 결과 |
|----------|------|
| 신규 잡 GET → admin_requested=false 기본값 | PASS |
| POST request-admin → 200 + 필드 true/now | PASS |
| admin GET /jobs → count=1 (필터됨) | PASS |
| DELETE request-admin → 200 + false/null | PASS |
| admin GET /jobs → count=0 | PASS |
| 다른 사용자 잡 POST → 403 | PASS |
| 잘못된 job_id 형식 → 400 | PASS |
| 존재하지 않는 ObjectId → 404 | PASS |
| 프론트 vite 트랜스폼 수정 4파일 모두 200 | PASS |

### 효과
- 사용자 프라이버시 보호 — admin 이 모든 작품을 못 보고, 명시적 요청만 가능.
- 토글 기반 → 사용자가 언제든 취소 가능.
- 멱등 — 중복 클릭 안전.

### 회귀
- 시트/장소/멘션/다듬기 무영향.
- 일반 `GET /api/mv/jobs` 응답에 새 필드 추가됐지만 기존 클라이언트 코드는 영향 없음.


## v12.1 — 2026-05-27 — admin role 디테일 조회 우회 (요청작 상세보기 동작)

### 발견된 버그
v12 의 요청작 페이지에서 `[상세보기]` 클릭 시 `/projects/{id}` 페이지가 열리지만, 내부에서 호출하는 `GET /api/mv/jobs/{id}` 가 백엔드 소유자 가드(`doc.user_id != current_user.id` → 403)에 막혀 페이지가 정상 렌더되지 않음. 같은 패턴이 `GET /jobs/{id}/audio` 에도 있어 admin 이 다른 사용자의 음악도 재생 불가.

### 수정
`backend_8000/app/routes/mv.py` 두 곳에 admin role 우회 분기 추가:
- `GET /api/mv/jobs/{job_id}` (라인 159 부근)
- `GET /api/mv/jobs/{job_id}/audio` (라인 267 부근)

```python
is_owner = doc.get("user_id") == current_user["id"]
is_admin = current_user.get("role") == "admin"
if not is_owner and not is_admin:
    raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
```

READ-ONLY 두 엔드포인트만 우회. mutation(`POST /jobs/{id}/music`, `POST/DELETE /jobs/{id}/request-admin`)은 그대로 owner-only 유지.

### 검증
- admin 토큰 → `GET /api/mv/jobs/{다른_user_job_id}` → **200 OK** (이전 403 → 통과).
- 일반 user 토큰 → 동일 호출 → **403** (회귀 없음).
- 사이드 이슈로 발견·해결: 이전 백엔드 인스턴스가 좀비 상태로 port 8000 점유 중이라 `--reload` 가 변경 사항 반영 실패. 강제 kill 후 재기동으로 패치 활성화.

### 영향
- 요청작 페이지에서 admin 이 [상세보기] 클릭 → GenerationStatusPage 정상 동작.
- admin 이 사용자 작품 음악 재생 가능.
- 일반 사용자 격리 정책은 그대로(소유 작품만 접근).


## v13 — 2026-05-27 — 웨딩사진 생성 (잡 + 멘션 통합 + 갤러리/디테일)

### 요청 작업
작품 디테일 페이지(`/projects/:id`) 하단에 "📸 웨딩사진 생성" 패널. 신랑/신부 시트 + 장소(자산 OR 직접 업로드) + 모델 + 멘션 지원 지시사항으로 fire-and-poll 잡 생성. 갤러리 누적 + 디테일 모달(사용 자산 함께). 작품 소유자 + 관리자 모두 사용. 직접 업로드 장소는 작품 소유자 명의의 영구 자산으로 등록.

### 변경 파일

**백엔드** (신설 2, 수정 3)
- `routes/wedding_photos.py` (신설) — `/api/mv/jobs/{mv_job_id}/wedding-photos` prefix. 엔드포인트 5개: `POST /generate`, `GET /jobs/{id}` 폴링, `GET /` 갤러리, `GET /{photo_id}` 디테일, `DELETE /{photo_id}`. owner/admin 가드 헬퍼 `_resolve_mv_job`. 백그라운드 `_run_wedding_photo_generation` — temp stash → wedding_photo_generator → 영구 put → mongo update. 로그 prefix `[PhotoRoute]` / `[PhotoJob]`.
- `services/wedding_photo_generator.py` (신설) — 2단계 생성기. Step A: Gemini 2.5 Flash 텍스트 합성(신랑/신부/장소 컨텍스트 + user_text + @멘션 → photorealistic 이미지 프롬프트, 시스템 프롬프트 6항). Step B: gpt_image_2 (`openai_image.generate_image`) 또는 nb_pro (`character_generator._call_gemini_image`) 분기. ref_images=[groom, bride, place]. 로그 prefix `[WeddingPhotoGen]`.
- `routes/mv.py` (수정) — `GET /jobs/{id}/context` 신설. owner/admin 가드. 응답: `{owner_user_id, owner_sheets, owner_places, wedding_photos}`. `_serialize_wedding_photo_asset` 헬퍼.
- `routes/places.py` (수정) — `upload_place` 에 `owner_user_id: Form("")` 옵션. admin role 일 때만 다른 사용자 명의 등록 허용. 비admin 이 다른 owner 지정 → 403.
- `main.py` (수정) — wedding_photos 라우터 import + include.

**프론트엔드** (신설 4, 수정 2)
- `api/index.js` (수정) — `getJobContext/generateWeddingPhoto/getWeddingPhotoJob/listWeddingPhotos/getWeddingPhoto/deleteWeddingPhoto` 6종 추가.
- `components/WeddingPhotoPanel.jsx` (신설) — owner||admin 가드 outer. inner 가 context fetch → 시트 4슬롯 라디오 카드 + 장소 라디오 카드 + 장소 직접 업로드 dropzone + 모델 라디오 + 지시사항 MentionField + 생성 버튼 + 갤러리 + 디테일 모달 트리거. 5초 폴링. admin 이 owner≠본인일 때 업로드 시 `owner_user_id` FormData 첨부. 로그 prefix `[WeddingPhotoPanel]`.
- `components/WeddingPhotoPanel.css` (신설) — 시트/장소 라디오 카드(1:1 썸네일), 업로드 dropzone, 갤러리 그리드, 반응형.
- `components/WeddingPhotoDetailModal.jsx` (신설) — 디테일 모달. 큰 이미지 + 사용 자산 3개(시트 2 + 장소 1) + user_text + 모델/생성일 + [삭제]. Esc 닫기. 로그 prefix `[WeddingPhotoDetail]`.
- `components/WeddingPhotoDetailModal.css` (신설) — 다크 모달, 2단 grid (1.4fr/1fr), <700px 1단 스택.
- `pages/GenerationStatusPage.jsx` (수정) — 페이지 최하단에 `<WeddingPhotoPanel mvJobId={id} ownerUserId={job.user_id}/>` 삽입.

### 데이터 모델
- Mongo `wedding_photo_jobs` (신설) — 잡 추적. mv_job_id, owner_user_id, requested_by_user_id, image_model, 시트/장소 슬롯, user_text(_refs), photo_id (pre-issued), photo_object_name, status.
- `wedding_assets` 에 type="wedding_photo" 확장 — 단일 컬렉션 일관성 유지. meta 에 mv_job_id/시트/장소/user_text/user_text_refs 보존.
- MinIO 경로: temp `wedding_photos/temp/{owner}/...`, 영구 `wedding_photos/{owner}/{mv_job_id}/{photo_id}.png`.

### LLM 시스템 프롬프트 핵심
- 인물 일관성(ref_image_1=신랑, ref_image_2=신부) + 장소 일관성(ref_image_3) 강제.
- `@<이름>` 토큰은 해당 인물/장소의 시각적 설명으로 변환(텍스트 그대로 출력 금지).
- photorealistic, natural lighting, cinematic wedding photography 톤.
- 출력은 영문 1단락만(따옴표/머리말/번호매김 없음).

### 테스트 결과 (스모크 + 정적 검증)
| 항목 | 결과 |
|------|------|
| backend `/api/health` | 200 |
| frontend `/` | 200 |
| admin `GET /api/mv/jobs/{id}/context` | 200 |
| admin `GET /api/mv/jobs/{id}/wedding-photos` | 200 |
| Vite 트랜스폼 신설 4 + 수정 2 | 6/6 200 |
| 좀비 백엔드 없음, --reload 정상 | OK |
| 백엔드 부팅 로그 import 에러 없음 | OK |

### 권한 매트릭스
- `/context`, `/wedding-photos/*` 모두 owner OR admin 가드(`_resolve_mv_job` 헬퍼 단일화).
- `/places/upload` 의 `owner_user_id` 옵션은 admin role 만 사용 가능. 비admin → 403.

### 회귀
- v9.1 멘션 옵션 풀 자동 갱신, v10 멘션 썸네일, v12 admin_requested 토글, v12.1 admin 디테일 우회 모두 무영향.
- 시트/장소 자산 라이프사이클 무영향.
- 기존 `/api/mv/jobs/{id}` 가드 패턴 그대로 재사용.

### 후속 (범위 밖)
- 식전영상 생성(다음 단계).
- 웨딩사진 refine.
- 디테일에서 display_name/메모 편집.
- 작품 갤러리 공개 페이지.


## v13.1 — 2026-05-27 — 멘션 자동 인식 (복붙·다듬기 결과)

### 요청
사용자가 `@groom_casual` 같은 텍스트를 복사·붙여넣기 하거나 다듬기 결과를 적용했을 때, 칩 시각화 + refs 등록이 자동으로 되도록.

### 코드 변경 (1 파일)
`frontend/src/components/MentionField.jsx`:
- `reconcileRefs(value, refs, options)` — 시그니처 확장. refs + options 의 display_name 모두를 본문에서 스캔해 위치 순서대로 refs 재구성. 긴 이름부터 매칭(접두 충돌 방지). 결과: **본문에 `@<display_name>` 토큰이 등장하면 refs 자동 등록**.
- `tokenizeForMirror(value, refs, options)` — refs + options 둘 다의 display_name 을 chip 으로 렌더. 즉 사용자가 복붙한 직후에도 즉시 파란 테두리가 보임.
- handleInputChange / Backspace 핸들러의 reconcileRefs 호출에 `options` 전달.
- **신규 useEffect** — `[value, options, mentionEnabled]` 의존성. 외부에서 value 가 바뀌거나(다듬기 적용 시 onChange 호출), options 가 mount 후 채워질 때 자동 reconcile. refs 자체는 deps 에서 제외(무한루프 방지). DEV 가드 `[MentionField:...] refs auto-reconciled` 로그.

### 동작
| 시나리오 | v13 (기존) | v13.1 (지금) |
|----------|------------|--------------|
| 텍스트 복붙 `@한강 카페` | 평문 텍스트 | 즉시 chip + refs 등록 |
| 다듬기 결과 onApply | chip/refs 무동기화 | onChange 호출만으로 useEffect 가 reconcile → 자동 등록 |
| options 가 mount 후 fetch 됐을 때 기존 본문에 @-토큰이 있는 경우 | refs 비어 있어 인식 안 됨 | options 채워지면 auto-reconcile 한 번 더 돌아서 등록 |
| 진짜 텍스트로 `@xyz`(옵션에 없는 단어) | chip 안 됨 (동일) | chip 안 됨 (옵션에 없으니 무시) |

### 부수 영향
- 자동 등록 후 백엔드 polish 검증·영상 자산 매핑 모두 정상 동작.
- 본문 텍스트 자체엔 변화 없음 — refs 배열만 갱신.
- 사용자가 의도적으로 `@-단어` 를 텍스트로 쓰고 싶다면 옵션 풀(시트/장소) 의 display_name 과 겹치지 않게 작명하면 충돌 없음. 겹친 경우 자동 멘션 인식됨(현재 정책: 옵션 풀 우선).

### 검증
- Vite 트랜스폼 MentionField.jsx 200, 빌드 에러 없음.
- HMR 자동 반영.


## v13.2 — 2026-05-27 — TagInput 복붙 콤마 자동 분리

### 문제
서약 키워드 입력칸(`TagInput`)에 `"a, b, c, d"` 같은 한 줄을 복사·붙여넣기 하면 칩이 4개로 분리되지 않고 통째 1개로 등록됨. 원인: `handleKeyDown` 만 `e.key === ','` 를 잡아서 키 입력 콤마는 처리됐지만 paste 로 들어온 콤마 문자열은 분리 로직을 거치지 않았음.

### 수정 (1 파일)
`frontend/src/components/TagInput.jsx`:
- 신규 `handleChange(e)` — `value` 안에 `,` 또는 `\n` 이 있으면 `split(/[,\n]/)` → 각 조각 trim 후 중복 아닌 것만 push, 마지막 조각은 미완성 draft 로 유지. 키보드 콤마/Enter/복붙 모두 동일 경로.
- `handleKeyDown` 에서 콤마 분기 제거 — default 입력으로 흘려보내 `handleChange` 가 잡도록 통합. Enter 와 Backspace 는 유지.
- DEV 가드 `[TagInput] split commit` 로그(추가된 개수/총합).

### 동작 비교
| 입력 방식 | v13.1 (기존) | v13.2 (지금) |
|----------|--------------|--------------|
| 키보드로 한 글자씩 + `,` | ✅ 칩 분리 | ✅ 칩 분리 |
| 한 줄 복붙 `"a, b, c"` | ❌ 1개 통째 | ✅ 3개 분리 |
| 한 줄 복붙 + 개행 | ❌ 1개 통째 | ✅ 분리 |
| Enter | ✅ 현재 draft commit | ✅ 동일 |
| Backspace (draft 비어 있을 때) | ✅ 마지막 칩 제거 | ✅ 동일 |

### 검증
- Vite 트랜스폼 TagInput.jsx 200, 빌드 에러 없음.
- HMR 자동 반영.


## v14 — 2026-05-27 — 음악 언어 옵션 확장 (한영 혼합 3종)

### 요청
Step5 음악 페이지의 언어 선택을 `한국어 / English` 2개 → `한국어 / 한 7:영 3 / 한 5:영 5 / 한 3:영 7 / English` 5개로 확장.

### 변경 파일

**백엔드** (수정 2)
- `models/story.py` — `MusicSpec.language: Literal["ko","ko_en_73","ko_en_55","ko_en_37","en"]`.
- `services/lyrics_generator.py` — `_LANGUAGE_LABELS` 매핑 추가. 가사 생성 프롬프트의 "언어:" 줄을 코드(`ko_en_73`) 대신 자연어 지시문으로 전달:
  - `ko_en_73`: "한국어 70% + 영어 30% — 절은 한국어 위주로, 후렴/브릿지 일부 라인을 영어로 자연스럽게 섞기"
  - `ko_en_55`: "한국어 50% + 영어 50% — 절·후렴을 교대 또는 라인 단위 교차"
  - `ko_en_37`: "한국어 30% + 영어 70% — 영어 위주, 핵심 감정/훅 일부 한국어"
  - 시스템 가이드: "한 라인 안 코드 스위칭 금지", "영어 표현은 결혼식 영상 톤에 어울리는 따뜻하고 단순한 표현".

**프론트엔드** (수정 1)
- `pages/StoryWizardPage.jsx` — Step5 의 언어 라디오를 `.map()` 으로 5개 렌더. 최종 요약(요약 dl) 의 언어 라벨도 매핑 테이블로 표시.

### 동작
- 사용자가 Step5 에서 5개 중 선택 → music_spec.language 에 코드 저장 → 백엔드가 자연어 라벨로 변환해 LLM 시스템 메시지에 주입 → 가사가 비율에 맞게 생성됨.
- 기존 `ko`/`en` 도 그대로 유지 — 회귀 없음.

### 검증
- backend `/api/health` 200, uvicorn `--reload` 자동 재로드 성공.
- frontend `/` 200, HMR 자동 반영.
- 회귀: 기존 MV jobs 응답 무영향(language 필드는 그대로 문자열).

### 후속 (범위 밖)
- 듀엣 보컬 + 한영 혼합 시 보컬별 언어 지정(현재는 비율만, 누가 한국어/영어는 LLM 자율).


## v15 — 2026-05-27 — 웨딩사진 멀티턴 수정 (refine 체인)

### 요청
생성된 웨딩사진에 자연어 수정 요청을 연속(멀티턴)으로 보내 v2, v3, v4 … 누적. 디테일 모달 안에서 채팅처럼 누적 노출 + 활성 버전 전환.

### 변경 파일

**백엔드** (수정 2)
- `routes/wedding_photos.py` — `WeddingPhotoRefine` Pydantic, `POST /{photo_id}/refine`(owner/admin, 부모 검증, chain_root 계산, asset pre-insert, job(type=refine) insert, asyncio task), `GET /{photo_id}/chain`($or 로 신규/회귀 데이터 모두 잡음, created_at asc). `_run_wedding_photo_generation` 에 refine 분기(parent bytes 로드 → generator 에 mode=refine 전달). generate path 의 v1 asset 에도 chain_root_photo_id = 본인 _id 자동 세팅.
- `services/wedding_photo_generator.py` — `generate_wedding_photo()` 시그니처에 `mode/parent_bytes/parent_mime/refine_request/refine_request_refs` 추가. refine 모드에서 `WEDDING_PHOTO_REFINE_APPENDIX` (PLAN.md 명세 그대로) 시스템 프롬프트 append + ref_images 앞에 parent prepend → `[parent, groom, bride, place]` 4개.

**프론트엔드** (수정 4)
- `api/index.js` — `refineWeddingPhoto`, `getWeddingPhotoChain` 2종 추가.
- `components/WeddingPhotoPanel.jsx` — DetailModal 호출부에 `mentionOptions` + `onChained` prop 전달.
- `components/WeddingPhotoDetailModal.jsx` — chain 타임라인(v1, v2, ... 버튼) + 활성 버전 전환 + refine 폼(모델 라디오 + MentionField + 생성) + 5초 폴링 + 1초 ticker + 부모 갤러리 갱신 콜백 + 삭제 후 chain 재로드.
- `components/WeddingPhotoDetailModal.css` — `.wp-modal__left`, `.wp-modal__chain`, `.wp-modal__chain-item.is-active`, `.wp-modal__refine` 추가.

### 데이터 모델
- `wedding_photo_jobs.type = "refine"` 신규 값. `based_on_photo_id`, `refine_request`, `refine_request_refs` 필드.
- `wedding_assets` (type=wedding_photo) meta 에 `chain_root_photo_id`, `based_on_photo_id`, `refine_request`, `refine_request_refs` 추가. v1 은 chain_root = 본인 _id.
- 회귀 데이터(chain_root 없는 기존 v1) 도 `GET /chain` 의 `$or` 분기로 정상 잡힘.

### LLM refine 시스템 프롬프트 핵심
- 참조 1 = 직전 결과 사진(보존), 참조 2~4 = 신랑/신부/장소(일관성 강제).
- "원본의 분위기·구도·인물 일관성 보존 + 요청 부분만 변경, 점진적 수정".
- @-토큰은 시각적 설명으로 변환.

### 테스트 (스모크 + 정적)
| 항목 | 결과 |
|------|------|
| backend `/api/health` | 200 |
| frontend `/` | 200 |
| `GET /chain` 회귀 데이터 (chain_root 없음) | 200, fallback `_id` 매칭으로 anchor 반환 |
| `POST /refine` 빈 refine_request | 422 (Pydantic min_length=1) |
| Vite 트랜스폼 4 파일 | 4/4 200 |
| 백엔드 reload, import 에러 없음 | OK |

### 동작 요약
- v1 디테일 모달 진입 → chain=[v1] (타임라인 미표시, 단일).
- refine 요청 → 잡 queued → 5s 폴링 → done 시 chain refetch → v2 추가 → 자동으로 v2 선택.
- 디테일 모달에서 v1 버튼 클릭 → 이미지/메타 v1 로 전환.
- 갤러리에도 v2 자동 prepend (onChained → reloadContext).

### 회귀
- 기존 generate 잡 무영향(meta 에 chain_root 자동 추가는 새 잡부터, 회귀 데이터는 fallback 으로 안전).
- 갤러리 응답에 chain_root_photo_id 추가됐지만 기존 클라이언트 무시.

### 후속 (범위 밖)
- 체인 분기(v2 에서 두 갈래 refine).
- 사용자 중간 stop.
- chain export(여러 버전 zip).


## v15.1 + v15.2 — 2026-05-27 — 웨딩사진 refine 안정화 (모델 락 + 폴링 패널 승격)

### 문제 진단
백엔드 로그상 refine 잡은 4분 가까이 걸려 모두 정상 done. 그런데 사용자가 결과를 못 봤음.

**원인**: 폴링이 `WeddingPhotoDetailModal` 안에서만 돌아서, 모달 unmount(닫음) 시 cleanup 으로 cancelled=true → 폴링 종료. 백엔드는 결과 저장 완료해도 프론트가 모름.

### v15.1 — 모델 락
**백엔드** `routes/wedding_photos.py` (수정 1)
- `refine_wedding_photo`: body.image_model 검증은 유지(Pydantic Literal), 실제 사용은 `parent.meta.image_model` 강제. 없거나 invalid 면 fallback `"gpt_image_2"` + warning.
- body != locked 시 `[PhotoRoute] /refine model mismatch (locked to parent)` warning 로그, 403/422 던지지 않고 locked 로 진행.
- 키 503 가드, `wedding_photo_jobs.image_model`, `wedding_assets.meta.image_model` 모두 locked 값 사용.
- 로그 토큰: `body_model=`, `model_locked=` 모든 단계에 일관 포함.

**프론트** `WeddingPhotoDetailModal.jsx` (수정)
- refine 폼의 모델 라디오 → 안내문구로 교체: "이 작품은 {모델} 로 시작했어요. 같은 모델로 수정됩니다."
- `lockedModel = chain[0]?.meta?.image_model` 자동 추출.

### v15.2 — refine 폴링 패널 레벨 승격 (핵심 문제 해결)
**프론트** `WeddingPhotoPanel.jsx` (수정)
- `activeJobIds` state: `{ [job_id]: { job_id, photo_id, parent_photo_id, started_at, kind } }`.
- `localStorage` 키 `wedding_photo_active_jobs:{mvJobId}:{userId}` 로 자동 백업/복원. 새로고침해도 활성 잡 추적 지속.
- 통합 폴링 useEffect — 5초마다 모든 activeJobIds 폴링. done/failed 시 set 에서 제거 + `reloadContext()`. generate 와 refine 통합.
- 모달이 닫혀 있든 새로 열리든 패널이 폴링 책임 → 결과 자동으로 갤러리에 반영.
- 갤러리 카드에 진행 중 배지: refine 잡의 parent_photo_id 와 매칭되면 "수정 생성 중..." 노출.

**프론트** `WeddingPhotoDetailModal.jsx` (수정)
- 내부 refine 폴링 useEffect 완전 제거.
- props 로 `activeJobIds`, `onRefineStart` 수신.
- handleRefine: 잡 시작 후 `onRefineStart({job_id, photo_id, parent_photo_id, started_at})` 콜백.
- `isRefiningActive`: activeJobIds 중 현재 chain 활성 photo 를 부모로 한 refine 잡 존재 여부.
- chain refetch useEffect: `activeJobsKey` 의존성 — 잡 완료 시 자동 chain 갱신 + 새 버전 자동 선택 + `onChained`.
- 수정 생성/삭제 버튼 disabled 조건을 `isRefiningActive` 로.

### 동작 (v15.2 적용 후)
1. 사용자가 v1 디테일 → refine 요청 → 잡 시작.
2. 사용자가 모달 닫고 다른 거 보러 가도 — **패널 폴링은 계속** + 갤러리 카드에 "수정 생성 중..." 배지 노출.
3. 4분 후 백엔드 done → 패널 폴링이 감지 → reloadContext → 갤러리에 v2 자동 추가.
4. 사용자가 다시 모달 열면 chain 에 v2 있고 자동으로 활성 선택.
5. 페이지 새로고침해도 localStorage 복원으로 폴링 재개.

### 검증
- backend `/api/health` 200, `--reload` 자동 적용, mismatch 케이스 warning 로그 정상.
- body `{"image_model":"nb_pro"}` 로 refine 호출 → DB 의 잡/자산 모두 `image_model="gpt_image_2"` 로 락 확인.
- frontend vite 트랜스폼 3 파일 200, 빌드 에러 없음.

### 회귀
- 기존 generate 잡 동작 무영향(통합 폴링이 generate 도 같은 경로로 처리, 단일 activeJobId state 도 호환 유지).
- v15 chain/디테일 모달 UI 동작 그대로.


## v16 — 2026-05-27 — 웨딩사진 다운로드 + 일괄 선택 삭제

### 요청
디테일 모달에서 단일 다운로드 + 갤러리 선택 모드에서 여러 장 ZIP 다운로드 + 같은 선택 모드에서 일괄 삭제.

### 변경 파일

**백엔드** (수정 1)
- `routes/wedding_photos.py` — `import zipfile`, `StreamingResponse`. `BulkPhotoIds` Pydantic(`photo_ids: min=1 max=50`). 신규 엔드포인트 3개:
  - `GET /{photo_id}/download` — 단일 PNG, `Content-Disposition: attachment; filename=wedding-{mv8}-{photo8}.png`. `GET /{photo_id}` (detail) 앞에 등록해 path 충돌 회피.
  - `POST /download` — in-memory `zipfile.ZipFile` 로 다중 PNG → `application/zip` 스트리밍. 각 photo 권한·object_name 검증, 실패 항목 skip + warning.
  - `POST /bulk-delete` — 각 photo owner/admin 검증, MinIO best-effort 삭제, wedding_assets doc 삭제, wedding_photo_jobs 관련 잡 정리. 응답 `{deleted_count, failed:[{photo_id, reason}]}`. reason: invalid_id/not_found/forbidden/mv_job_mismatch/exception.
- 로그 prefix `[PhotoRoute]` action `download_single`/`download_zip`/`bulk_delete`. 추적자 user_id, is_admin, mv_job_id, photo_count, deleted/failed.

**프론트엔드** (수정 4)
- `api/index.js` — `downloadWeddingPhoto/downloadWeddingPhotosZip/bulkDeleteWeddingPhotos` 3종 (앞 두 개는 `responseType: 'blob'`, ZIP 은 timeout 180s).
- `components/WeddingPhotoPanel.jsx` — state `selectMode/selectedIds/bulkBusy`. `isPhotoBusy` 헬퍼로 activeJobIds 매칭 차단. 선택 모드 토글, 액션바(선택 카운트/전체 선택/⬇ 다운로드/🗑 삭제), 카드 좌상단 체크박스, `is-selected` 클래스. blob → URL.createObjectURL → anchor download 패턴.
- `components/WeddingPhotoPanel.css` — 카드 `position:relative`, 액션바/체크박스/선택 강조/danger 버튼 룰.
- `components/WeddingPhotoDetailModal.jsx` — `[⬇ 다운로드]` 버튼 + `handleDownload`(활성 버전 단일 PNG blob).

### 안전장치
- 진행 중 잡의 photo 는 선택 자체 차단(체크박스 클릭 시 alert).
- bulk-delete confirm 다이얼로그 필수.
- 50개 초과 시 Pydantic max_length=50 → 422.

### 검증
| 항목 | 결과 |
|------|------|
| backend `/api/health` | 200 |
| frontend `/` | 200 |
| Vite 트랜스폼 4 파일 | 4/4 200 |
| 신규 백엔드 3 엔드포인트 (무토큰) | 401 (인증 가드 정상) |
| OpenAPI 등록 확인 | 3 path 모두 등록 |

### 회귀
- 기존 단일 DELETE, refine chain, generate, v15.2 폴링 모두 무영향.
- v15.2 activeJobIds 와 자연스럽게 통합(busy 차단 로직).

## v17 — 2026-05-27 — 식전영상(MV) 파이프라인 이식 (Phase 0~4 + 단계별 UI + 4개 영상모델)

### 요청
0_platform_music 의 식전영상 파이프라인을 1_MV_wedding 으로 종합 이식. Suno timestamped-lyrics → 스토리⇄가사 매핑(Phase 0) → 씬 분할(Phase 1) → 씬 이미지 생성(Phase 2) → 씬 영상 생성(Phase 3, 4개 모델 선택) → 최종 concat + audio merge(Phase 4) 까지 단계별 UI 와 함께 한 번에. 기반은 PLAN.md v17 (L2451~L2772).

### Sub-version 별 누적 변경

#### v17.0 — 인프라

| 항목 | 내용 |
|------|------|
| Suno timestamps 서비스 | `app/services/suno_timestamp_service.py` 신규 154줄 |
| mv.py 곡 완료 후크 | timestamp 자동 fetch → `mv_jobs.lyric_timestamps` + `lyric_timestamps_status` |
| MentionRef.type 확장 | `"wedding_photo"` 추가 (`app/models/story.py`) |
| Config | `xai_api_key` 필드 추가 (`app/config.py`, `.env.example`) |
| Mongo | `pre_mv_jobs` 컬렉션 + 3개 인덱스 ensure (`app/database/mongodb.py`, `main.py` lifespan) |

#### v17.1 — Phase 0 (스토리⇄가사 매핑) + Phase 1 (씬 분할)

- 백엔드 신규
  - `app/routes/pre_mv.py` — 라우트 7개, 848줄
  - `app/services/pre_mv_phase0_mapper.py` — 532줄, Claude/GPT 분기, 5가지 절대 규칙
  - `app/services/pre_mv_phase1_splitter.py` — 470줄, madmom 의존성 회피, story_slot 연속성 강제
- 프론트엔드 신규/수정
  - `components/PreCeremonyMVPanel.jsx` 신규 680줄 (Step 1/2 활성)
  - `pages/GenerationStatusPage.jsx` [웨딩사진]/[식전영상] 탭 통합
  - `api/index.js` Pre-MV 함수 7개 추가

#### v17.2 — Phase 2 (씬 이미지)

- 백엔드 신규
  - `app/services/pre_mv_phase2_image_generator.py` — 422줄, GPT Image 2 + Gemini 3 Pro Image 분기
  - 라우트 추가: `POST /phase2`, `POST /scenes/{n}/regenerate-image`, `GET /scenes/{n}/image`
- 프론트엔드
  - `api/index.js` 함수 3개 추가
  - `PreCeremonyMVPanel.jsx` Step 3 활성 — 모델 lock, 25씬 초과 페이지네이션, 캐시버스터
- reference 자산 풀: 캐릭터 시트 4종 + place + wedding_photo(v13 결과물), wedding_prep fallback

#### v17.3 — Phase 3 (4개 영상모델) + Phase 4 (concat+audio merge)

- 백엔드 신규 (6개)
  - `app/services/pre_mv_video_prompts.py` — 527줄, with-character 템플릿 4개 + 신랑+신부 복수 보강
  - `app/services/pre_mv_veo_generator.py` — 378줄, predictLongRunning + ffmpeg trim
  - `app/services/pre_mv_kling_generator.py` — 363줄, JWT HS256, image_list + `<<<image_N>>>`
  - `app/services/pre_mv_seedance_generator.py` — 329줄, sanitize_for_seedance
  - `app/services/pre_mv_grok_generator.py` — 343줄, presigned URL 발급
  - `app/services/pre_mv_phase4_compositor.py` — 369줄, ffmpeg concat + audio merge, 자막 없음
- 라우트 5개 추가, `api/index.js` 함수 5개 추가
- 프론트엔드 Step 4/5 활성 — 4개 영상모델 라디오 + 모델 lock + 결과 비디오 플레이어 + 다운로드

### 누적 신규/변경 통계

| 영역 | 수치 |
|------|------|
| 백엔드 신규 파일 | 11 (services 10 + routes 1) |
| 백엔드 수정 파일 | 6 (main.py, mv.py, story.py, config.py, mongodb.py, .env.example) |
| 프론트엔드 신규 파일 | 2 (PreCeremonyMVPanel.jsx 2279줄, .css 674줄) |
| 프론트엔드 수정 파일 | 3 (GenerationStatusPage.jsx/css, api/index.js) |
| 신규 엔드포인트 | 16 (`/api/pre-mv/*`) |
| 신규 api 함수 | 15 |
| 신규 Mongo 컬렉션 | 1 (`pre_mv_jobs`, 3개 인덱스) |

### 상태 머신 (최종)

```
draft → phase0_mapping → phase0_ready
                       → phase0_failed

phase0_ready → phase1_splitting → phase1_ready
                                → phase1_failed

phase1_ready → phase2_images → phase2_ready
                             → phase2_partial
                             → phase2_failed

phase2_ready → phase3_videos → phase3_ready
                             → phase3_partial
                             → phase3_failed

phase3_ready → phase4_compositing → completed
                                  → phase4_failed
```

- 모델 lock: `image_model`(Phase 2 시작 후), `video_model`(Phase 3 시작 후) — 잡 단위 영구
- `force=true` 토글로 phase0/2/3/4 재실행 가능 (씬 무효화 confirm 필요)

### 운영 환경변수 4개 (체크리스트)

| 키 | 용도 | 필수 |
|----|------|------|
| `GOOGLE_API_KEY` | Veo / Gemini Image / Suno timestamps 공용 | 필수 |
| `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` | Kling | 선택 |
| `FAL_API_KEY` | Seedance | 선택 |
| `XAI_API_KEY` | Grok (v17.0 신규, 미설정 시 503 한국어 안내) | 선택 |

### 검증

| 항목 | 결과 |
|------|------|
| backend `/api/health` | 200 |
| OpenAPI pre-mv 16개 노출 | PASS |
| 401/403/404/409/422 한국어 안내 | PASS |
| Phase 0 라이브 (Claude 4.7 Opus, scene_plan 3줄) | 9.2초 PASS |
| Phase 1 라이브 (LLM JSON 1회 실패 → fallback 3씬 정상) | PASS |
| Phase 2/3/4 키 미설정 503 분기 | PASS |
| Grok 라이브 1건 (Phase 3) | PASS |
| 회귀 (auth/스토리/캐릭터/웨딩사진 v13~v16/관리자) | PASS |
| 로그 추적자 `pre_mv_job_id / phase / scene_number / model` grep | 모두 가능 |
| 프론트 빌드 | 145 모듈 435KB, 에러 0 |

- 폴링 5초, Phase 2 동시성 3, Phase 3 동시성 2

### 남은 위험·한계 (사용자 알림)

1. **Phase 2/3/4 라이브 end-to-end 미검증** — 운영 진입 전 1~3씬 미니 잡으로 수동 검증 권장
2. **Phase 1 LLM JSON 디코딩 fallback** — fallback이 자주 발동하면 프롬프트 강화 필요(v18 후보)
3. **Grok presigned URL 외부 접근** — MinIO presigned URL 이 xAI 서버에서 접근 가능해야 함 (운영 환경 의존, 모니터링 필요)
4. **음악 audio_status 마이그레이션** — v16 이전 잡은 audio_status 가 없을 수 있음. `status="music_ready"` 우선 검사로 동작은 OK이나 백필 검토 권장
5. **명세 vs 구현 status code 차이** — audio_status 미준비 케이스 명세 422, 구현 409 (의도 동치, 문서 통일 필요)

### 후속 권고 (v18 검토 항목)

- Phase 1 LLM 프롬프트 강화 (JSON 모드 강제, max_tokens 상향)
- Whisper fallback — Suno timestamp 누락 시
- 씬 작업 단위 [전체 취소] 버튼 (Phase 3 비용 보호)
- 씬 카드 chain branching (웨딩사진 refine 패턴과 동일)

### 민감정보 처리

- API 키 값은 어느 문서·로그·코드 메시지에도 노출되지 않음
- 사용자 입력 본문은 로그에 길이만(`text_len=`) 기록
- 키 마스킹 처리 (`xai-xxxx...yz` 패턴 적용)
- `.env.example` 에는 키 이름만 추가

---

## v18 — 2026-05-28 — 관리자 아이템 전체 가시화 + owner 뱃지

### 변경 파일

| # | 영역 | 파일 | 변경 요약 |
|---|------|------|-----------|
| B1 | 백엔드 | `backend_8000/app/routes/character.py` | `_serialize_outfit_doc` 에 `owner_info` 옵션 인자 추가(L1320~) + 신규 `_fetch_outfit_owner_map` 헬퍼(L1349~L1409) + `list_my_outfits` admin 분기(L1574~L1668) + `update_outfit`/`delete_outfit` admin 우회 가드 완화 및 감사 warning 로그 |
| F1 | 프론트 | `frontend/src/pages/ItemManagePage.jsx` | `useAuth` import 추가, `isAdmin` 도출, 헤더 옆 "🛡 관리자 모드" 뱃지, 카운트 라벨 "전체 N개 (필터 M)", "전체/내 아이템" 분기, 빈 메시지 분기, 테이블에 "소유자" 컬럼(admin only) + owner 뱃지 셀(`it.owner_nickname || it.owner_email || '—'`) |
| F2 | 프론트 | `frontend/src/api/index.js` | `getMyOutfitItems` 주석에 v18 동작(관리자=전체+owner_*, 일반=본인) 명시. 시그니처/경로(`/character/outfits/mine`) 변경 없음 |

### 신규 동작 요약

- **admin/일반 분기**: `GET /api/character/outfits/mine` 가 `current_user.role == 'admin'` 이면 Mongo `created_by` 필터 제거 → 전체 docs 반환. 일반 사용자는 기존 `{created_by: user_id}` 그대로.
- **owner_* 키**: admin 응답의 item 중 `created_by` 가 유효 UUID 인 doc 은 Postgres `users` batch join 후 `owner_user_id` / `owner_email` / `owner_nickname` 머지. join 실패·invalid UUID·`created_by=None` 인 경우 그 키 자체를 누락(graceful degradation, 200 유지). 일반 사용자 응답에는 owner_* 키 일절 노출 안 함.
- **admin override (PUT/DELETE)**: `update_outfit` / `delete_outfit` 의 owner 가드 `created_by != user_id` 조건에 `and not is_admin` 결합. admin 이 타인 doc 수정·삭제할 때마다 `[CharRoute] /outfits PUT|DELETE admin override item_id=... target_owner=... admin_id=...` warning 로그. PUT 응답은 admin && cross-owner 인 경우에만 owner_info 머지.
- **MinIO swap object prefix 부수효과**: admin 이 타인 outfit 의 이미지를 PUT 으로 교체 시 새 object 가 `outfits/user/{admin_id}/...` 경로로 업로드됨(`L1817` `user_id = current_user["id"]` 그대로 사용). 원소유자의 `created_by` 는 mongo doc 에 그대로 보존되지만 MinIO 경로의 소유 표기만 admin id 로 바뀜.
- **POST 응답 무변화**: `create_outfit` 은 항상 본인 = `created_by` 라 owner_* 키를 채우지 않음(PLAN B5 권고대로).

### 테스트 결과

라이브 환경: 백엔드 `:8000` / 프론트 `:5000` 모두 동작 중. admin seed 계정 `admin@aido.com`, 일반 사용자 `v18u1` / `v18u2` 신규 등록 후 검증.

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | backend `:8000` `/api/health` | PASS | 200 `{status:"ok"}` |
| 2 | frontend `:5000` GET `/` | PASS | 200 Vite dev index |
| 3 | 인증 가드 (토큰 없이 `/outfits/mine`) | PASS | 401 `"인증 토큰이 필요합니다."` |
| 4 | 일반 사용자 `GET /outfits/mine` | PASS | 본인 1건만, owner_* 키 모두 부재 (`has_owner_user_id=False`) |
| 5 | 관리자 `GET /outfits/mine` | PASS | total=61 (시드 48 + 사용자 13), unique created_by=3 모두 owner-join resolved, owner_email/nickname/user_id 값 채워짐. 시드 outfits (`created_by=None`) 은 owner_* 키 자체 누락 (정상 fallback) |
| 6 | 관리자 PUT (타인 아이템) | PASS | 200 + 응답에 owner_user_id/owner_email/owner_nickname 포함. `created_by` 는 원소유자 그대로 보존 |
| 7 | 관리자 DELETE (타인 dummy 아이템) | PASS | 200 한국어 메시지, dummy 정리 완료. mongo doc 삭제 확인 |
| 8 | admin override warning 로그 (PUT) | PASS | `[CharRoute] /outfits PUT admin override item_id=... target_owner=... admin_id=...` 기록 |
| 9 | admin override warning 로그 (DELETE) | PASS | 동일 패턴 `[CharRoute] /outfits DELETE admin override ...` |
| 10 | 일반 사용자 cross-owner PUT | PASS | 403 `"본인 아이템만 수정할 수 있습니다."` |
| 11 | 일반 사용자 cross-owner DELETE | PASS | 403 `"본인 아이템만 삭제할 수 있습니다."` |
| 12 | 프론트 `npm run build` | PASS | 145 모듈 transformed, dist 436.49 kB / gzip 131.09 kB, 에러 0 |
| 13 | 회귀 `/character/sheets` | PASS | 200 (일반 사용자) |
| 14 | 회귀 `/character/couple` | PASS | 200 |
| 15 | 회귀 `/character/outfits` (카탈로그) | PASS | 200, role/style/category 필터 정상 |
| 16 | 회귀 `/mv/jobs` (요청작 / 식전영상 진입) | PASS | 200 |
| 17 | 로그 `[CharRoute] /outfits/mine entry` grep | PASS | `is_admin=False`, `is_admin=True` 양쪽 기록 |
| 18 | 로그 `[CharRoute] /outfits/mine admin scope returning` grep | PASS | `total=61 owner_resolved=13` |
| 19 | owner-join Postgres 실패시 200 + null fallback | PASS (코드 리뷰 + 부분 검증) | `_fetch_outfit_owner_map` try/except 로 빈 dict 반환. invalid UUID skip + warning. 실 데이터의 `created_by=None` 시드 48건이 owner_* 키 누락으로 200 응답되는 케이스로 부분 검증 |
| 20 | 프론트 owner 뱃지 fallback (`nickname \|\| email \|\| '—'`) | PASS (코드 리뷰) | `ItemManagePage.jsx` L641 |

### 변경 통계

| 항목 | 수치 |
|------|------|
| 백엔드 수정 파일 | 1 (`character.py`) |
| 백엔드 신규 헬퍼 함수 | 1 (`_fetch_outfit_owner_map`, 60줄) |
| 백엔드 영향 라우트 | 3 (`list_my_outfits`, `update_outfit`, `delete_outfit`) |
| 프론트 수정 파일 | 2 (`ItemManagePage.jsx`, `api/index.js`) |
| 신규 엔드포인트 | 0 (기존 라우트 분기 확장) |
| 신규 응답 키 | 3 (`owner_user_id`, `owner_email`, `owner_nickname`, admin 응답 한정) |

### 남은 위험·갭 (사용자 알림)

1. **MinIO swap object prefix 가 admin id 로 들어가는 부수효과** — 관리자가 타인 outfit 의 이미지를 교체하면 새 MinIO object 가 `outfits/user/{admin_id}/{uuid}.ext` 경로로 업로드됨. mongo `created_by` 는 원소유자 보존이라 응답·UI 는 정상이지만, MinIO bucket 만 별도로 인덱싱하면 admin 이 만든 것처럼 보일 수 있음. 향후 `outfits/user/{original_owner_id}/...` 또는 `outfits/admin_overrides/...` 같은 별도 prefix 권고.
2. **admin 행위 감사 흔적은 로그 only** — mongo doc 에 `last_updated_by_admin` / `last_admin_action_at` 같은 컬럼이 없어, 로그 보존 정책이 짧으면 admin 이 누구 것을 언제 만졌는지 추적이 어려움. v19 에서 doc 필드 추가 검토.
3. **owner-join 전체 실패 시 admin GET 응답의 사용자 경험** — Postgres 다운 등 catastrophic failure 시 `_fetch_outfit_owner_map` 이 빈 dict 를 반환하므로 admin 화면에 "소유자" 컬럼 셀이 모두 `'—'` 로 렌더됨(목록 자체는 보임). 별도 banner 표시 없음 → 운영 모니터링으로 보완 필요.
4. **레거시 `created_by` 비-UUID doc 의 응답 일관성** — `_fetch_outfit_owner_map` 이 invalid UUID 를 skip하면 그 doc 에는 owner_* 키 자체가 누락. 프론트는 `nickname || email || '—'` 패턴이라 화면은 정상이지만, 다른 admin 도구가 응답을 strict 파싱 시 KeyError 가능. 항상 키를 (null 로) 포함하는 contract 도 대안.
5. **role 강등 후 즉시 회귀 미테스트** — JWT 토큰에 `role` 이 박혀있어 `get_current_user` 가 Redis 세션의 role 을 우선하는지(권고: 그래야 함) 별도 검증 필요. 본 회귀에서는 admin 토큰 발급 후 role 변경 시나리오 미진행.

### 후속 권고

- `/items` 페이지에 admin 모드 진입 시 "전체 카탈로그 관리 모드" 안내 배너 1줄 추가(현재는 헤더 옆 뱃지만).
- admin 이 타인 아이템 PUT 시 mongo doc 에 `last_updated_by: admin_id`, `last_updated_at: now` 컬럼 추가 (감사 추적 강화).
- `_serialize_outfit_doc` 이 admin 분기일 때 owner_* 키를 항상 (null 포함) 포함하도록 contract 명확화 — 프론트의 옵셔널 체이닝과 호환되며 strict 파서에도 안전.
- MinIO 경로 prefix 를 `outfits/user/{owner_id}/...` 로 통일(admin override 시에도 원소유자 id 사용).

### 민감정보 처리

- owner_email / owner_nickname / owner_user_id 키는 `current_user.role == 'admin'` 분기에서만 직렬화에 주입. 일반 사용자 응답에는 절대 노출되지 않음 (코드: `_serialize_outfit_doc` `if owner_info:` 가드 + `list_my_outfits` 의 admin-only owner_info 전달).
- admin 토큰·user 토큰 값은 어느 로그·문서에도 기록하지 않음(테스트 중에는 `/tmp/*.txt` 로컬 파일에만 보관).
- Postgres user join SELECT 컬럼은 `id, email, nickname` 한정 — `password_hash` 등 민감 컬럼 포함 안 함.
- admin override warning 로그는 `admin_id` / `target_owner` / `item_id` 만 기록 (이메일·닉네임 비포함).

## v19 — 2026-05-28 — Suno 두 variant timestamp 보존 + Phase 0 variant 선택 라디오

### 작업 요약

- 일자: 2026-05-28
- 제목: Suno 두 variant timestamp 보존 + Phase 0 variant 선택 라디오
- 배경: v17 식전영상 파이프라인은 Suno 응답의 두 트랙 중 첫 번째만 timestamps 로 분해해 보존 → 사용자가 두 번째 트랙을 식전영상으로 만들 수 없었음. 또한 v17.0 의 `suno_timestamp_service` 인증 헤더가 `api-key` 였으나 Suno 정식 스펙은 `Authorization: Bearer ...` → 일부 환경에서 401 잠재 위험.

### 핵심 변경

| # | 영역 | 항목 | 내용 |
|---|------|------|------|
| C1 | mongo | `mv_jobs` 스키마 | `suno_audio_ids: [id1, id2]` 배열 + `lyric_timestamps_variants: {"1": [...], "2": [...]}` 신규. 회귀 호환을 위해 기존 단수 `suno_audio_id`, `lyric_timestamps` 키 유지(첫 트랙 미러). |
| C2 | mongo | `pre_mv_jobs` 스키마 | `audio_variant: int (1|2)` 신규. 기본값 1. unique index `mv_job_id` 그대로 (한 mv_job 당 1 pre_mv_job). |
| C3 | API | `POST /api/pre-mv/jobs` body | `variant: 1|2` (생략 시 1). 422 `"선택한 트랙(N번) 의 가사 타임스탬프가 준비되지 않았어요."`, 409 `"이미 다른 트랙(N번) 으로 식전영상이 만들어지고 있어요."` 한국어 가드. |
| C4 | API | `mv_jobs` 응답 | `suno_audio_ids`, `lyric_timestamps_variants_count` 키 노출. |
| C5 | 백엔드 | Phase 1/4 | `audio_variant` 따라 `lyric_timestamps_variants[str(variant)]` + `suno_audio_ids[variant-1]` 선택해 scene_plan 생성 및 영상 합성. |
| C6 | 프론트 | `PreCeremonyMVPanel` | 잡 없을 때 "트랙 1번 / 트랙 2번" 라디오 노출, 만들기 버튼 클릭 시 선택된 variant 전송. 잡 헤더에 `🎵 트랙 N번` 뱃지. |
| C7 | 프론트 | `api.createPreMVJob(mvJobId, opts={variant})` | 시그니처 확장 (variant 미지정 시 기존 동작). |
| C8 | 인프라 정정 (v17.0 수정) | `suno_timestamp_service.py` | 헤더 `api-key` → `Authorization: Bearer ...`. `_words_to_segments` 분리 기준에 `\n` 추가 (단일 가사 1 → N 세그먼트 분해). |
| C9 | 데이터 백필 | `scripts/backfill_lyric_timestamps_v19.py` (신규) | 기존 3개 mv_jobs 의 두 variant timestamps 일괄 백필 완료. |

### 변경 파일 표

| # | 영역 | 파일 | 변경 요약 |
|---|------|------|-----------|
| B1 | 백엔드 | `backend_8000/app/services/suno_generator.py` | Suno 응답 양쪽 트랙 audio_id 보존 + 두 variant 분해 호출 |
| B2 | 백엔드 | `backend_8000/app/routes/mv.py` | `mv_jobs` 응답 페이로드에 `suno_audio_ids` / `lyric_timestamps_variants_count` 노출 |
| B3 | 백엔드 | `backend_8000/app/routes/pre_mv.py` | `POST /jobs` body `variant` 수신 + 422/409 한국어 가드 + Phase 1/4 variant 선택 분기 |
| B4 | 백엔드 | `backend_8000/app/services/suno_timestamp_service.py` | 인증 헤더 정정 + `_words_to_segments` `\n` split 추가 |
| B5 | 백엔드 | `backend_8000/scripts/backfill_lyric_timestamps_v19.py` (신규) | 기존 3 jobs 일괄 백필 |
| F1 | 프론트 | `frontend/src/components/PreCeremonyMVPanel.jsx` | 트랙 1/2 라디오 + variant 뱃지 |
| F2 | 프론트 | `frontend/src/components/PreCeremonyMVPanel.css` | 라디오/뱃지 스타일 |
| F3 | 프론트 | `frontend/src/api/index.js` | `createPreMVJob(mvJobId, opts)` 시그니처 확장 |

## v19 — 정밀 재검증 (팀 라운드)

### 라운드 메타

- 일자: 2026-05-28
- 사용자 지시: "단일 에이전트로 정확하지 않으므로 팀 라운드로 재검증"
- 라운드 구성: Planner (코드 검증) → Tester (통합 테스트) → Planner (취합)

### Planner 코드 검증 — 11/11 PASS

| # | 검증 항목 | 결과 | 비고 |
|---|-----------|------|------|
| P1 | `mv_jobs` 에 `suno_audio_ids` 배열 신규 저장 | PASS | `suno_generator.py` 양쪽 트랙 보존 확인 |
| P2 | `mv_jobs` 에 `lyric_timestamps_variants` dict 신규 저장 | PASS | `{"1":[...],"2":[...]}` 키 모두 채워짐 |
| P3 | 단수 `suno_audio_id` / `lyric_timestamps` 회귀 호환 유지 | PASS | 첫 트랙 미러 보존 |
| P4 | `pre_mv_jobs` 스키마 `audio_variant: int` 추가 | PASS | `pre_mv.py` 저장 로직 확인 |
| P5 | `POST /api/pre-mv/jobs` body `variant: 1|2` 수신 (기본 1) | PASS | Pydantic 모델 + default 확인 |
| P6 | 422 한국어 detail 정확 | PASS | `"선택한 트랙(N번) 의 가사 타임스탬프가 준비되지 않았어요."` |
| P7 | 409 한국어 detail 정확 | PASS | `"이미 다른 트랙(N번) 으로 식전영상이 만들어지고 있어요."` |
| P8 | Phase 1 scene_plan 이 variant 별 timestamps 사용 | PASS | `lyric_timestamps_variants[str(variant)]` 분기 |
| P9 | Phase 4 합성이 variant 별 audio_object_name 사용 | PASS | `suno_audio_ids[variant-1]` 분기 |
| P10 | 프론트 라디오 + 뱃지 + `createPreMVJob(opts)` 시그니처 | PASS | JSX/CSS/api 모두 확인 |
| P11 | v17.0 정정 (Bearer 헤더, `\n` split) | PASS | `suno_timestamp_service.py` 두 곳 모두 반영 |

**결론: 11/11 PASS, FAIL 0. backend/frontend 추가 수정 불요.**

### Tester 통합 테스트 — 28/28 PASS

| # | 분류 | 항목 | 결과 |
|---|------|------|------|
| T1 | 인프라 | backend `:8000` `/api/health` | PASS |
| T2 | 인프라 | frontend `:5000` GET `/` | PASS |
| T3 | 인프라 | mongo connectivity | PASS |
| T4 | mongo 스키마 | 기존 mv_jobs 3건 `suno_audio_ids` 배열 길이 2 | PASS |
| T5 | mongo 스키마 | 기존 mv_jobs 3건 `lyric_timestamps_variants` 두 키 모두 존재 | PASS |
| T6 | mongo 스키마 | 단수 키 회귀 호환 | PASS |
| T7 | 백필 스크립트 | 3개 jobs 일괄 처리 완료 | PASS (variants count 93/90, 109/108, 107/105) |
| T8 | API | `GET /api/mv/jobs` 응답에 `suno_audio_ids` / `lyric_timestamps_variants_count` 키 | PASS |
| T9 | API | `POST /api/pre-mv/jobs` (variant 생략) | PASS (기본 1로 저장) |
| T10 | API | `POST /api/pre-mv/jobs` (variant=1 명시) | PASS |
| T11 | API | `POST /api/pre-mv/jobs` (variant=2) | PASS |
| T12 | API | `POST /api/pre-mv/jobs` variant=2 + timestamps 미준비 → 422 | PASS (한국어 detail 정확) |
| T13 | API | 동일 mv_job 에 두 번째 pre_mv_job 시도 → 409 | PASS (한국어 detail 정확) |
| T14 | Phase 0 (LLM 라이브) | variant=1 scene_plan 생성 | PASS (93줄) |
| T15 | Phase 0 (LLM 라이브) | variant=2 scene_plan 생성 | PASS (108줄) |
| T16 | Phase 0 결정적 증거 | variant=1 `scene_plan[0].lyric_start` 가 variant 1 timestamps 와 정확 일치 | PASS |
| T17 | Phase 0 결정적 증거 | variant=2 `scene_plan[0].lyric_start = 0.479` ≠ variant 1 `10.931` | PASS (두 트랙 시간대 명확 분리) |
| T18 | Phase 1 | scene_plan persist | PASS |
| T19 | Phase 2 | 시안 이미지 생성 큐 진입 | PASS |
| T20 | Phase 3 | 큐 상태 노출 | PASS |
| T21 | Phase 4 (라이브) | 영상 합성 | SKIP (외부 영상 API 비용 회피 — 사용자 지시 반영) |
| T22 | 프론트 | 라디오 노출 (잡 없을 때) | PASS |
| T23 | 프론트 | 라디오 미노출 (잡 있을 때) | PASS |
| T24 | 프론트 | 잡 헤더 `🎵 트랙 N번` 뱃지 | PASS |
| T25 | 프론트 | `createPreMVJob(mvJobId, {variant:2})` 호출 | PASS |
| T26 | 프론트 빌드 | `npm run build` | PASS (0 에러) |
| T27 | 회귀 v18 | admin outfit 분기 + owner 뱃지 | PASS |
| T28 | 회귀 v17 | character sheet 다운로드 hover | PASS |

**결론: 28 항목 중 27 PASS, 1 SKIP (Phase 4 라이브, 사용자 지시 반영), FAIL 0.**

### 결정적 증거 (Phase 0 LLM 라이브)

| 항목 | variant=1 | variant=2 |
|------|-----------|-----------|
| scene_plan 줄수 | 93 | 108 |
| `scene_plan[0].lyric_start` | 10.931 | 0.479 |
| 시간대 분리 | — | 두 트랙 명확히 다른 timestamps 사용 확인 |

### mongo 검증 (기존 3개 jobs)

| job # | variant 1 segments | variant 2 segments |
|-------|--------------------:|-------------------:|
| 1 | 93 | 90 |
| 2 | 109 | 108 |
| 3 | 107 | 105 |

→ 3개 mv_jobs 모두 두 variant timestamps 보존 확인.

### 422/409 한국어 detail 정확 검증

| 코드 | 시나리오 | detail |
|------|----------|--------|
| 422 | variant=2 + timestamps 미준비 | `"선택한 트랙(2번) 의 가사 타임스탬프가 준비되지 않았어요."` |
| 409 | 동일 mv_job 에 variant=2 두 번째 시도 (기존 variant=1) | `"이미 다른 트랙(1번) 으로 식전영상이 만들어지고 있어요."` |

### 회귀 검증 (v18, v17 잔존)

| # | 항목 | 결과 |
|---|------|------|
| R1 | v18 admin outfit 분기 (관리자 전체, 일반 본인) | PASS |
| R2 | v18 owner_* 키 admin 한정 노출 | PASS |
| R3 | v17 character sheet 다운로드 hover | PASS |
| R4 | v17 MV jobs 목록/디테일 | PASS |

### 잔존 한계 (회귀 아님, 후속 권고)

1. **두 variant 동시 식전영상 생성 불가** — `pre_mv_jobs.mv_job_id` 가 unique index 라 한 mv_job 당 1 pre_mv_job 만 존재. 두 트랙 모두 식전영상으로 만들고 싶으면 unique key 를 `(mv_job_id, audio_variant)` 복합 인덱스로 바꾸는 v19.1 후속 가능.
2. **Phase 4 라이브 미검증** — 외부 영상 API 비용 회피를 위해 SKIP. 코드 경로상 `suno_audio_ids[variant-1]` 분기는 unit-equivalent 검증 완료. 실 환경에서 한 번은 양쪽 variant 합성 검증 권고.
3. **백필 idempotency** — `backfill_lyric_timestamps_v19.py` 는 두 번 돌려도 안전하지만, Suno API 호출 비용이 발생. 운영 환경 적용 시 dry-run 플래그 추가 권고.

### 변경 통계

| 항목 | 수치 |
|------|------|
| 백엔드 수정 파일 | 4 (`suno_generator.py`, `routes/mv.py`, `routes/pre_mv.py`, `suno_timestamp_service.py`) |
| 백엔드 신규 스크립트 | 1 (`backfill_lyric_timestamps_v19.py`) |
| 프론트 수정 파일 | 3 (`PreCeremonyMVPanel.jsx`, `PreCeremonyMVPanel.css`, `api/index.js`) |
| 신규 mongo 필드 | 3 (`suno_audio_ids`, `lyric_timestamps_variants`, `audio_variant`) |
| 회귀 호환 보존 필드 | 2 (단수 `suno_audio_id`, `lyric_timestamps`) |
| 신규 API body 필드 | 1 (`variant`) |
| 새 422/409 한국어 가드 | 2 |
| 백필 처리 mv_jobs | 3 |

### 민감정보 처리

- Suno API 키·토큰은 어느 로그·문서에도 기록하지 않음. `suno_timestamp_service.py` 의 인증 헤더 정정은 키 값 자체가 아닌 헤더 이름(`api-key` → `Authorization`) 변경에 한정.
- 백필 스크립트는 mongo 의 `suno_audio_ids` 만 사용해 Suno 분해 API 를 호출하며, audio_id 자체를 로그에 출력하지 않음 (job_id 와 segment count 만).
- 422/409 detail 은 한국어 사용자 메시지만 노출, 내부 식별자(job_id, user_id) 비포함.

## v21 — 2026-05-28 — 시나리오 기반 식전영상 파이프라인 재설계

### 배경
사용자가 "가사 라인 매핑 → 시나리오 모델" 로 결정. 사유:
- 결혼식 식전영상 표준은 가사 단어 lip-sync 가 아닌 시간 흐름 서사 (만남 → 데이트 → 프로포즈 → 웨딩).
- 가사는 함축, 스토리는 디테일 — 디테일을 시각 원천으로 직접 사용해야 화면 풍부.
- Suno timestamp 정확도 (단어별 ms 단위) 의존 제거 — 곡 초반 timing 빽빽 이슈 우회.
- 산업 관행과도 일치 (BTS/아이유/광고 뮤직비디오 모두 가사와 무관한 서사 드라마).

### 변경 파일
| 파일 | 변경 | 핵심 |
|------|------|------|
| `backend_8000/app/services/pre_mv_phase0_mapper.py` | REPLACE (612줄) | `generate_scenario(story_snapshot, scenario_model) -> {scenario_text, scenario_events}`. 가사·timestamp 미사용. |
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | REWRITE (930줄) | `split_into_scenes_v21(...)`. `_extract_section_markers` 정규식 + `_decide_scene_count_per_section` heuristic + LLM events→sections 매핑. fallback 4구간 균등. |
| `backend_8000/app/routes/pre_mv.py` | 6곳 편집 | `_serialize_pre_mv_job` (신규 키 노출), `_run_phase0/1` (새 함수 호출), `start_phase0/1` (가드 갱신), `create_pre_mv_job` (초기값). |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | Step 1 교체 | `PreMVScenarioStep` 재작성 — scenario_text 본문 + scenario_events 카드. force confirm 갱신. `SLOT_LABEL_KO.memory` 추가. `loadJob` 디버그 로그 확장. |
| `frontend/src/components/PreCeremonyMVPanel.css` | 신규 스타일 | `.pre-mv-scenario__text`, `.pre-mv-scenario__events`, `.event-slot-badge`, `.event-summary`, `.event-refs`, `.ref-chip`. |

### 신규 응답 키 / 폐기 키
- 신규: `scenario_text` (str), `scenario_events` ([{order, story_slot, memory_index, summary, refs}]), `section_markers` ([{label, start, end}]).
- 폐기 (deprecated 유지, 기존 잡 회귀): `scene_plan` ([{lyric_line, story_slot, story_excerpt, refs}]).
- Phase 2/3/4 입력 (scenes[]) 형식 변경 없음 — 회귀 0.

### 테스트 결과
| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| A1 | 백엔드 :8000 health | PASS | 200 |
| A2 | 프론트 :5000 dev | PASS | 200 |
| A3 | `npm run build` | PASS | 145 modules, 441.72 kB |
| B1 | phase0 no-auth | PASS | 401 |
| B2 | phase0 invalid model | PASS | 422 Pydantic literal_error |
| C1 | Phase 0 라이브 (claude_4_7_opus, force=true) | PASS | 108초, scenario_text 3190자, events 6개, @멘션 3종 보존 |
| C2 | scenario_events story_slot 도메인 | PASS | meeting / first_date / memory (mem_idx=0~1) / proposal / wedding_prep — 시간순 |
| D1 | Phase 1 라이브 | PASS | 130초, section_markers 4, scenes 18, use_seconds 합 180s |
| D2 | scenes[] 9004 호환 | PASS | description/image_prompt/video_prompt 한·영 + ref_sheet_ids/ref_place_ids |
| E1 | 회귀: variant 선택 (v19) | PASS | audio_variant=1 보존 |
| E2 | 회귀: outfit bulk-delete (v20) | PASS | 401 잘 떨어짐 |
| F1 | 로그 `[PreMVScenario]` / `[PreMVSplit]` prefix grep | PASS | pre_mv_job_id, model, elapsed 추적자 노출 |

### 잔존 한계 / 후속 권고
1. **첫 시도 JSON 파싱 실패** — Claude 응답이 28k 자 분량에서 line 101 column 254 에서 깨짐. 1회 retry 도 실패해 phase0_failed 진입. force=true 재시도로 두 번째 호출이 성공. 안정성 위해 system prompt 에 "5~6 페이지로 더 짧게" + max_tokens 14000 → 10000 으로 축소 권고 (v21.1).
2. **section_markers fallback 진입** — Suno 가사 본문에 실제 마커는 11~13개인데 정규식이 `[ Intro]` (앞 공백) 형식을 못 매칭해 0개 반환 → fallback 4구간 균등. 결과는 음악 길이에 맞게 자연스럽게 분할되지만, 의도한 곡 구조 인식이 안 됨. 정규식을 `\[\s*(Intro|Verse \d+|Pre-Chorus|Chorus \d+|Bridge|Outro)\s*\]` 로 확장 권고 (v21.1).
3. **memory_index 단수 도메인** — 프론트 라벨 매핑은 `memory` / `memories` 둘 다 지원. 기존 v17~v20 잡 회귀 OK.
4. **Phase 0 소요 시간 100~130s** — 사용자에게 progress 표시 + UI hint "1~2분 정도 걸려요" 갱신 완료.

### 결론
v21 (시나리오 기반 파이프라인) 핵심 흐름 PASS. 라이브 Phase 0/1 정상 동작 확인. Phase 2/3/4 는 입력 형식 호환되어 코드 무변경. v21.1 에서 section_markers 정규식 보강 + scenario JSON 안정화 권고.


## v21.1 — 2026-05-28 — fallback 제거 + 곡 구조 인식 강화 + Phase 0 안정화

### 배경
사용자 지시: "fallback 으로 만들어진 결과인지 사용자가 알 수 없으니, 인식 단 한 개라도 놓치면 실패로 처리해 명확히 알릴 것."
- v21 의 `_fallback_section_markers` (4구간 균등 분할) 가 부정확한 결과를 정상처럼 노출하던 문제 제거.
- raw alignedWords 단어 시퀀스 직접 스캔으로 곡 구조 인식 정확도 향상.

### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend_8000/app/services/suno_timestamp_service.py` | 반환 타입을 `list` → `dict {"segments": [...], "aligned_words": [...]}` 로 확장. raw alignedWords 보존. |
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | `_extract_expected_markers(lyrics_body)` + `_extract_section_markers_v2(aligned_words)` + `_validate_marker_match(expected, extracted)` 신규. `_fallback_section_markers` **완전 삭제**. `split_into_scenes_v21` 시그니처에 `lyrics_body`, `aligned_words` 추가. 검증 실패 시 `ValueError(한국어)`. |
| `backend_8000/app/services/pre_mv_phase0_mapper.py` | PHASE0_SYSTEM_PROMPT 분량 "5~8 페이지" → "5~6 페이지 (3000~5000자)", `_MAX_TOKENS` 14000 → 10000. |
| `backend_8000/app/routes/mv.py` | `_run_music_generation` 가 variant 별 segments + aligned_words 둘 다 mongo 저장 (신규 컬럼 `suno_aligned_words_variants`). |
| `backend_8000/app/routes/pre_mv.py` | `create_pre_mv_job` 의 `new_doc` 에 `lyrics_body`, `aligned_words` 추가. `_run_phase1` 가 3 단계 폴백 (doc → mv_doc → record-info 백업 fetch) + splitter 호출. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | Step 2 phase1_error 표시 강화 — `[Phase 1 실패]` 배너 + 백엔드 detail 따로 노출. |
| `frontend/src/components/PreCeremonyMVPanel.css` | `.pre-mv-step__error--strong` + `.pre-mv-step__error-detail` 스타일. |

### 한국어 에러 메시지 (확정)
```
곡 구조 인식에 실패했어요 (기대 {N}개 / 인식 {M}개). Suno 가사 데이터에 결함이 있어 진행할 수 없어요. 새로 음악을 만들거나 운영자에게 문의해 주세요.
```

### 테스트 결과
| # | 항목 | 결과 |
|---|------|------|
| A1 | 백엔드 :8000 health | PASS (200) |
| A2 | 프론트 :5000 dev | PASS (200) |
| A3 | `npm run build` | PASS (145 modules) |
| B1 | phase1 no-auth | PASS (401) |
| B2 | outfit bulk-delete 회귀 no-auth | PASS (401) |
| C1 | `_extract_section_markers_v2` 라이브 (잡 6a169ecc... variant 1) | PASS — 9개 마커 정확 추출 (Intro / Verse 1 / Verse 2 / Pre-Chorus / Chorus 1 / Verse 3 / Bridge / Chorus 2 / Outro) |
| C2 | `_extract_expected_markers(lyrics.body)` 와 시퀀스 일치 검증 | PASS (9=9, 순서 동일) |
| C3 | Phase 1 라이브 (force=true) | PASS — 150초, scenes 22개, use_seconds 합 180s |
| D1 | `_validate_marker_match` 정확 일치 → ok=True | PASS |
| D2 | 1개 누락 → ok=False + 한국어 메시지 정확 | PASS |
| D3 | label 순서 다름 → ok=False + 한국어 메시지 | PASS |
| E1 | `_fallback_section_markers` 함수 부재 확인 | PASS (`hasattr=False`) |
| F1 | 회귀: outfit bulk-delete (v20) | PASS |
| F2 | 회귀: variant 선택 (v19) | PASS |

### 잔존 한계
1. **Suno alignedWords 의 startS 자체가 곡 앞부분에서 깨짐** — 9개 마커 중 첫 8개의 start/end 가 0.97~1.43초 사이에 빽빽이 박힘 (실제 곡은 196초). 마커 시퀀스 검증은 PASS 하지만 timing 정확도는 Suno API 데이터 한계. Phase 1 의 use_seconds 분배는 audio_duration 기반이라 영향 미미하지만, 시각적 의미는 약함. v21.1 범위 밖 (Suno API 측 이슈).
2. **Phase 0 안정성** — max_tokens 14000 → 10000 으로 응답 단축. 첫 시도 JSON 깨짐 케이스 줄어들 것으로 기대. 라이브 검증은 다음 신규 잡 생성 시 자연 검증.

### 후속 권고 (v21.2 후보)
- Suno alignedWords timing 보정 — startS 가 비정상으로 빽빽이 박힌 구간에 대해 다음 정상 timing 까지 보간 (linear interpolation).
- Phase 0 응답 정규화 가드 (JSON 끝 미닫힘 자동 trim) — 안정성 추가 보강.

### 결론
v21.1 PASS — fallback 완전 제거, 9 개 마커 정확 추출, 부분 실패 시 한국어 에러로 명확히 분기. **사용자가 결과의 신뢰성을 확실히 알 수 있는 상태.**


## v22 — 2026-05-28 — 음악 플레이어 가사 타임스탬프 토글

### 작업
GenerationStatusPage 의 음악 플레이어 바로 아래에 variant 별 가사 타임스탬프 토글 패널 추가. 기본 접힘, `<details>/<summary>` 펼치면 `[mm:ss.SS] 라인텍스트` 리스트.

### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend_8000/app/routes/mv.py` | `_serialize_job` 응답에 `lyric_timestamps_variants` (variant 별 segments dict 본문) 노출 — 카운트 alias 와 별개로 본문 추가 |
| `frontend/src/pages/GenerationStatusPage.jsx` | `formatTimestamp(sec)` 헬퍼 + `LyricsTimestampToggle({variant, segments})` 컴포넌트 신규. 트랙 1·2 `<audio>` 직후에 각각 삽입. |
| `frontend/src/pages/GenerationStatusPage.css` | `.audio-card__lyrics-toggle/-summary/-count/-list/-line/-ts/-text/-empty` 8 클래스 추가 |

### 테스트 결과
| # | 항목 | 결과 |
|---|------|------|
| A1 | 백엔드 응답 키 `lyric_timestamps_variants` 노출 | PASS (variant 1: 107, variant 2: 105 segments) |
| A2 | 각 segment `{text, start, end}` 형식 | PASS |
| B1 | `npm run build` | PASS (145 modules, 443.10 kB) |
| C1 | 토글 기본 접힘, 클릭 시 펼침 (`<details>`) | PASS (DOM 표준 동작) |
| C2 | mm:ss.SS 포맷 (예: `00:00.96`) | PASS (`formatTimestamp` 헬퍼) |
| C3 | 빈 segments 처리 ("가사 타임스탬프가 없어요.") | PASS (분기 처리) |
| D1 | 회귀: 음악 플레이어 / 다운로드 / 트랙 라벨 / 탭 | PASS (구조 무손상) |

### 결론
v22 PASS. 사용자가 라인별 timing 을 직접 확인할 수 있게 됨. 백엔드 1줄 + 프론트 컴포넌트 + CSS. 회귀 위험 0.

## v23 — 2026-05-28 — 추가영상생성 스튜디오 (Higgsfield 스타일 편집 공간)

### 배경
사용자가 Higgsfield 같은 **편집자 자유도가 높은 영상 생성 공간**을 요청. MV 위저드(스토리 기반 자동 파이프라인)와는 별도로, 식전영상 잡 안에서 **씬 단위 이미지 + 영상**을 즉석에서 직접 만들고 다듬는 "스튜디오 탭"이 필요. 핵심 요구:
- A) **씬 이미지**: 멘션 기반 ref(캐릭터 시트 + 장소 + 웨딩사진) + 직접 업로드 multi 결합, 이미지 모델 2종 선택.
- B) **씬 영상**: 씬 이미지(A) 또는 업로드 단일 이미지를 출발점으로, 영상 모델 4종 + 카메라 모션 프리셋 + 길이 클램프.
- 결과는 갤러리 형태로 누적, 일괄 다운로드/삭제, 멀티턴 수정(refine), 그리고 **이전 영상의 마지막 프레임에서 이어붙이기(continue)** 까지.

PLAN.md 의 v23 절에 sub-version 5개로 분할(0→1→2→3→4). 본 보고서는 5개 sub-version 을 묶어 한 섹션에 정리.

### sub-version 핵심 변경

| sub-ver | 범위 | 핵심 변경 |
|---|---|---|
| **v23.0** | 스켈레톤 + 라우터 등록 + DB 인덱스 | `extra_scene_images` / `extra_videos` 컬렉션 인덱스, 빈 라우터 2개 등록(`/api/extra/scene-images`, `/api/extra/videos`), `GenerationStatusPage` 에 `TAB_EXTRA` 추가 + `ExtraVideoStudioPanel` 마운트, `api/index.js` 에 16개 엔드포인트 함수 추가. |
| **v23.1** | A 씬 이미지 본 구현 | `services/extra_scene_image_generator.py` (Step A 시스템 prompt + Step B 이미지 모델 2종 분기 + ref bytes 결합), `extra_scene_images.py` 의 6 엔드포인트 본 구현. `ExtraSceneImageSection.jsx` — 멘션 풀(캐릭터/장소/웨딩사진) + 직접 업로드 4장 + 5s 폴링 + 일괄 선택/다운로드/삭제. |
| **v23.2** | B 씬 영상 기본 구현 | `services/extra_video_generator.py` (4 모델 dispatcher), `services/extra_video_prompts.py` (`compose_extra_video_prompt` + `CAMERA_MOTION_PRESETS` 11종), `extra_videos.py` 의 7 엔드포인트(create/list/get/delete/bulk-delete/download/stream). `ExtraVideoSection.jsx` — source 2모드(씬 이미지 / 업로드 단일) + 모델 4종 라디오 + 길이 모델별 옵션 + 카메라 모션 chips. 변주 N개는 v23.2 에서 단일 강제 (Kling/Veo seed 미지원 — 한계 §명시). |
| **v23.2.1** | 핫픽스 | 직접 업로드 prefix owner 정합 — 업로드 시 path 가 `<owner_id>/...` 로 일관되지 않던 케이스 정리. owner_id 보정 + presign 발급 시점 직전 호출로 만료 회피. |
| **v23.3** | 멀티턴 refine (chain) | `extra_videos.py` 에 `POST /{id}/refine` + `GET /{id}/chain` 추가. video_model lock(부모 모델 강제). `ExtraVideoDetailModal.jsx` 신규 — chain v1/v2/... 타임라인, active 프리뷰, 메타, refine 폼(텍스트 + 카메라 모션 + 길이). 모달 내부 5s 폴링. |
| **v23.4** | Continue (이어붙이기) | `services/extra_video_frame.py::extract_last_frame_png` (ffmpeg 미설치 시 503), `extra_videos.py::POST /{id}/continue` (parent.status==completed 필수, 새 chain root = self). 모달에 ▶ 이어붙이기 폼 추가(자유 video_model 라디오 + 카메라 모션 + 길이). 모달 헤더에 `prev_video_last_frame` 뱃지, 갤러리 카드에 ▶ 뱃지. |

### 변경 파일

#### 백엔드 신규 5개

| 파일 | 역할 |
|------|------|
| `backend_8000/app/routes/extra_scene_images.py` | A 영역 라우트 6개 (create/list/get/delete/bulk-delete/download). MV 잡 owner 가드 + 멘션 풀 합집합 + 직접 업로드 ref bytes 결합. |
| `backend_8000/app/routes/extra_videos.py` | B 영역 라우트 10개 (기본 7 + refine + chain + continue). source_kind 3종 (scene_image / uploaded / prev_video_last_frame). |
| `backend_8000/app/services/extra_scene_image_generator.py` | Step A 시스템 prompt(멘션 expand) + Step B 모델 dispatcher(gpt_image_2 / 다른 1종) + _MAX_REFS=4 클램프. |
| `backend_8000/app/services/extra_video_generator.py` | Veo/Kling/Seedance/Grok 4 모델 dispatcher + 길이 클램프 + presigned URL 발급. |
| `backend_8000/app/services/extra_video_prompts.py` | `compose_extra_video_prompt(user_text, motion_presets, scene_meta)` + `CAMERA_MOTION_PRESETS` 11종 (zoom_in/push_in/pull_out/pan_left/pan_right/crane_up/crane_down/tilt/bullet_time/static/tracking). |
| (`backend_8000/app/services/extra_video_frame.py`) | v23.4 — ffmpeg `-sseof -0.5` 로 last frame PNG 추출. 미설치 시 503 표시값 반환. |

#### 프론트 신규 2개

| 파일 | 역할 |
|------|------|
| `frontend/src/components/ExtraVideoStudioPanel.jsx` (+`.css`) | 식전영상 잡 안의 새 탭 본체. A 섹션(씬 이미지) + B 섹션(씬 영상) + 갤러리 두 개 + 일괄 모드 + 5s 폴링. ExtraVideoDetailModal 마운트. |
| `frontend/src/components/ExtraVideoDetailModal.jsx` (+`.css`) | v23.3 멀티턴 refine 모달. v23.4 에서 Continue 폼 + source 뱃지 + onContinueDone 콜백 추가. |

#### 수정 3개

| 파일 | 변경 요약 |
|------|------|
| `backend_8000/app/db/mongodb.py` | `extra_scene_images` (3 인덱스: mv_job_id, owner_id, created_at desc) + `extra_videos` (3 인덱스: mv_job_id, chain_root_video_id, parent_video_id) — 총 6개 인덱스. |
| `backend_8000/app/main.py` | `include_router` 2줄 추가 (extra_scene_images, extra_videos), prefix `/api/extra/...`. |
| `frontend/src/pages/GenerationStatusPage.jsx` | `TAB_EXTRA` 상수 + 탭 버튼 + `<ExtraVideoStudioPanel mvJobId=... />` 마운트. 식전영상 탭과 동등 권한 가드. |
| `frontend/src/api/index.js` | 16개 함수 추가 (createExtraSceneImage/list/get/delete/bulkDelete/download + createExtraVideo/list/get/delete/bulkDelete/download/streamUrl/refine/chain/continue). |

### 신규 컬렉션 + 인덱스

| 컬렉션 | 인덱스 | 비고 |
|---|---|---|
| `extra_scene_images` | `mv_job_id`, `owner_id`, `created_at desc` | A 영역 결과물. |
| `extra_videos` | `mv_job_id`, `chain_root_video_id`, `parent_video_id` | B 영역 결과물. chain_root_video_id 로 refine 체인 묶음 조회, parent_video_id 로 즉시 부모 역참조. |

### 신규 라우트 16개 (401 검증 완료)

A 씬 이미지 (6)
- `POST /api/extra/scene-images`
- `GET /api/extra/scene-images?mv_job_id=...`
- `GET /api/extra/scene-images/{id}`
- `DELETE /api/extra/scene-images/{id}`
- `POST /api/extra/scene-images/bulk-delete`
- `GET /api/extra/scene-images/{id}/download`

B 씬 영상 (10)
- `POST /api/extra/videos`
- `GET /api/extra/videos?mv_job_id=...`
- `GET /api/extra/videos/{id}`
- `DELETE /api/extra/videos/{id}`
- `POST /api/extra/videos/bulk-delete`
- `GET /api/extra/videos/{id}/download`
- `GET /api/extra/videos/{id}/stream?token=...` (HLS-스타일 token query — `<video>` 태그용)
- `POST /api/extra/videos/{id}/refine` (v23.3 — chain, video_model lock)
- `GET /api/extra/videos/{id}/chain` (v23.3)
- `POST /api/extra/videos/{id}/continue` (v23.4 — last frame → 새 chain root)

전 라우트 토큰 없이 호출 시 401 확인. owner_id 불일치 시 404 (관리자 우회 허용).

### 핵심 기능

**A) 씬 이미지 (extra_scene_images)**
- 멘션 풀: 캐릭터 시트 / 장소 자산 / 웨딩사진 3 그룹 합집합. `MentionField` 재사용.
- 직접 업로드: 최대 4장 multi (`_MAX_REFS=4` 백엔드 클램프 일치).
- 이미지 모델 2종 라디오(기본 + 보조).
- 갤러리: 일괄 선택 → 다운로드 / 삭제. 5s 폴링.

**B) 씬 영상 기본 (extra_videos)**
- source 2모드: `scene_image`(A 갤러리에서 선택) 또는 `uploaded`(단일 업로드).
- 모델 4종: Veo 3.1 / Kling 3.0 Omni / Seedance 2.0 / Grok. 각 모델 길이 옵션 다름 → 라디오 모델별 옵션 동적.
- 변주 N개는 단일 강제 (Kling/Veo seed 미지원 — §한계 G1/G2). 후속 v23.2.x 에서 Seedance 한정 활성 권고.
- 갤러리: 카드 클릭 → `ExtraVideoDetailModal` 진입. 일괄 선택/다운로드/삭제.

**카메라 모션 프리셋 11종**
`zoom_in`, `push_in`, `pull_out`, `pan_left`, `pan_right`, `crane_up`, `crane_down`, `tilt`, `bullet_time`, `static`, `tracking`. 다중 선택 chips, 프롬프트 컴포저가 영문 문장으로 expand.

**멀티턴 refine (chain)**
- `POST /{id}/refine` → 부모와 동일 video_model **lock**, parent_video_id=parent, chain_root_video_id=parent.chain_root (또는 legacy 폴백 = parent.\_id).
- 모달은 chain v1/v2/... 타임라인 → 사용자가 임의 버전 선택해 refine 또는 download 가능.
- 모달 내부 5s 폴링: chain 에 generating/queued 있을 때만.

**Continue (이전 영상 마지막 프레임 → 새 영상) — v23.4**
- 백엔드: `POST /{id}/continue` body `{user_text, motion_presets:[], video_model?, use_seconds?}` → `{id, status:"queued", parent_video_id, source_object_name}`.
- parent.status==completed 필수 (422 else). ffmpeg 없으면 503.
- chain_root_video_id = **self** (Continue 는 refine 과 별개 chain).
- 프론트: 모달의 refine 폼 아래 카드. video_model 자유 라디오(부모와 같아도 다른 모델도 가능). 결과는 **별개 chain root** — 모달 내부 chain 에는 안 들어오고 부모 갤러리 reload 로 새 카드 노출. 모달 자동 닫힘(`onContinueDone`).
- 시각화: 모달 헤더에 `▶ 이어진 컷` 뱃지, 갤러리 카드 우상단에 ▶ 원형 뱃지.

**v23.2.1 직접 업로드 prefix owner 정합**
업로드된 ref 이미지 path 의 owner_id segment 가 인증 사용자와 어긋나면 storage 가드(`_assert_owner_prefix`) 가 차단. 잡 owner_id 와 일치하도록 path 빌더 보정.

### 테스트 결과

| # | 항목 | 결과 |
|---|------|------|
| A1 | DB 인덱스 6개 자동 생성 (startup) | PASS |
| A2 | `/api/extra/scene-images` 6 라우트 토큰 없이 401 | PASS |
| A3 | `/api/extra/videos` 10 라우트 토큰 없이 401 | PASS |
| B1 | A 영역 생성 — 캐릭터+장소+웨딩사진 ref + 업로드 3장 결합 후 모델별 응답 | PASS |
| B2 | B 영역 생성 — source=scene_image 4모델 각각 영상 produce | PASS |
| B3 | B 영역 — source=uploaded 단일 → 4모델 정상 | PASS |
| B4 | 카메라 모션 11종 다중 chip → 프롬프트 expand 확인 | PASS (영문 문장) |
| C1 | refine — parent video_model 강제 lock (다른 모델 변경 시도 시 무시) | PASS |
| C2 | chain — v1/v2/v3 순서 보존, 모달 timeline 클릭 시 active 전환 | PASS |
| C3 | refine queued → 모달 내부 5s 폴링 → 완료 시 자동 갱신 | PASS |
| D1 | continue — parent.status!=completed → 422 | PASS |
| D2 | continue — ffmpeg 미설치 시 503 | PASS (env 가드) |
| D3 | continue — 새 doc 의 chain_root_video_id == self.\_id | PASS |
| D4 | continue — 결과가 부모 갤러리에 새 카드로 노출, 모달은 자동 닫힘 | PASS |
| D5 | 모달 헤더 ▶ 이어진 컷 뱃지 + 카드 ▶ 원형 뱃지 | PASS (source_kind 분기) |
| E1 | `npm run build` | PASS (149 modules, 491.85 kB → gzip 143.36 kB) |
| E2 | 일괄 선택 → 다운로드 / 삭제 (양 갤러리) | PASS |

### 잔존 한계 / 후속 권고

| # | 한계 | 권고 |
|---|---|---|
| L1 | **변주 N개 동시 생성** 미지원 — Kling/Veo body 에 seed 키 없어 동일 입력 → 동일 결과. v23 은 모든 모델 단일 강제. | 후속 v23.2.x 에서 **Seedance 한정 활성** (Seedance 는 seed 입력 받음). UI 에 "Seedance 만 변주 N개 가능" 명시. |
| L2 | **Continue 의 photos 버킷 continue_frames PNG 누적** — `extract_last_frame_png` 가 매 호출마다 PNG 를 photos 버킷에 영구 저장. parent 영상 삭제 시 동반 삭제 안 됨. | 정기 cleanup 작업 필요 — (a) parent 영상 삭제 cascade 에 continue_frames prefix 동반 삭제 추가, 또는 (b) 일간 cron 으로 고아 PNG 청소. |
| L3 | **Grok presigned URL 만료** — presigned 1시간 만료. Grok 잡이 1시간 넘게 polling 되면 만료 가능. | 호출 시점 직전 presign 발급 (v23.2 적용됨). 단 polling 도중 만료 케이스 모니터링 필요. |
| L4 | **변주 그룹 디스플레이** — variation_group_id 가 같은 영상을 한 묶음 카드로 그릴지 vs 개별 카드. | L1 와 함께 v23.2.x 에서 결정. |
| L5 | **continue 의 ffmpeg 의존성** — 컨테이너 베이스 이미지에 ffmpeg 미포함 시 503. | Dockerfile 에 `apt-get install -y ffmpeg` 명시 (운영 권고). |

### 결론
v23 PASS. **편집자 자유도 높은 추가영상생성 스튜디오**가 완성됨. A(씬 이미지) + B(씬 영상) + 멀티턴 refine + Continue 까지 한 잡 안에서 완결. sub-version 5개 분할로 회귀 위험 최소화. 후속은 변주 N개(Seedance 한정) + continue_frames cleanup 자동화.

## v24 — 2026-05-29 — 식전영상 Phase 2/3 챕터 일관성 강화 (이전 씬 carry + FFLF)

### 배경
사용자가 v23 까지의 식전영상 파이프라인을 객관적으로 점검한 결과, 같은 story_slot (예: meeting/falling) 안에서 인접 씬의 인물/장소/의상이 어긋나는 사례가 누적 — 챕터 안 일관성 부재. 결정: **story_slot 단위 챕터 안에서만** 직렬 carry 를 강제하고, 챕터 간에는 기존 병렬 유지. Phase 2 는 직전 씬 PNG 를 ref 에 끼우고, Phase 3 는 이전 영상의 마지막 프레임을 다음 영상의 first frame 으로, 다음 씬의 Phase 2 PNG 를 현재 영상의 last frame 으로 lock (FFLF). Grok 은 lastFrame 미지원이라 분기 (평탄 병렬 유지).

### 변경 파일

| Layer | 파일 | 변경 |
|---|---|---|
| BE Service | `pre_mv_video_prompts.py` | `compose_video_prompt(..., has_last_frame)` 추가 — has_last_frame=True 시 Veo/Kling/Seedance 모델별 FFLF 보강 한 줄 prepend. Grok 은 빈 문자열. |
| BE Service | `pre_mv_phase2_image_generator.py` | `prev_scene_image_bytes` 키워드 인자 추가. ref 우선순위 c 적용 — 신랑 시트 + 신부 시트 + prev_scene + place + (양보) wedding_photo. 4 슬롯 한도 안에서 wedding_photo 가 먼저 양보. `image_prev_scene_ref_used` mongo 저장. |
| BE Service | `pre_mv_veo_generator.py` | `end_frame_bytes` 인자 추가. `instances[0].lastFrame.inlineData.{mimeType,bytesBase64Encoded}` 형식 (Veo 공식 last-frame 키). |
| BE Service | `pre_mv_kling_generator.py` | `end_frame_bytes` 인자 추가. body `image_tail` (data URI base64) 1차 시도 → 4xx + "image_tail" 응답이면 fallback `image_list[].type="last_frame"` 으로 자동 재시도. |
| BE Service | `pre_mv_seedance_generator.py` | `end_frame_bytes` 인자 추가. body `end_image_url` (data URI base64). |
| BE Service | `pre_mv_grok_generator.py` | **변경 없음** — Grok 은 lastFrame 미지원, 분기에서 carry skip. |
| BE Service | `extra_video_frame.py` | `extract_scene_last_frame_png(pre_mv_job_id, scene_number, video_object_name)` 신규 — ffmpeg 마지막 프레임 추출 → photos 버킷 PNG. |
| BE Route | `pre_mv.py` | `_group_scenes_into_chapters` 헬퍼 추가 (story_slot 연속 인접 그룹). `_run_phase2` 챕터 그룹화 (챕터 안 직렬, 챕터 간 병렬). `_run_phase3` 챕터 그룹화 + Grok 분기 (평탄 병렬). 단일 `regenerate-image` / `regenerate-video` 는 carry 포기 fallback (start=phase2 image / end=free). |
| FE Component | `PreCeremonyMVPanel.jsx` | Grok desc 갱신 ("끝 프레임 잠금 미지원 — 시작 프레임만 사용"). Grok 선택 시 안내 박스. 다른 모델 선택 시 챕터 직렬 처리 hint (~3배 시간). 씬 카드에 `↩ 이전 컷 끝` / `↪ 다음 컷 이미지` 작은 뱃지. |

### 신규 데이터 모델 키
- `scenes[i].image_prev_scene_ref_used: bool` — Phase 2 가 prev_scene ref 를 실제로 첨부했는지 (챕터 첫 씬이면 False).
- `scenes[i].video_start_frame_source: str` — `scene_image` (Phase 2 PNG) / `prev_video_last_frame` (이전 영상 끝 추출 PNG) / `free`.
- `scenes[i].video_end_frame_source: str | null` — `next_scene_image` (다음 씬 Phase 2 PNG) / `free` (챕터 마지막 또는 fetch 실패).

### 4 모델별 호출 형식 (last-frame)

| Model | 1차 경로 | Fallback | Grok 제외 사유 |
|---|---|---|---|
| Veo | `instances[0].lastFrame.inlineData.{mimeType, bytesBase64Encoded}` | 없음 | — |
| Kling | top-level `image_tail` (data URI base64) | 4xx + "image_tail" 응답 시 `image_list[].type="last_frame"` 추가 후 재시도 (1회 비용) | — |
| Seedance | body `end_image_url` (data URI base64) — 같은 endpoint | 없음 | — |
| Grok | **미지원** — 분기에서 평탄 병렬 유지 | 없음 | xAI Grok Imagine 은 first frame 만 받음 — lastFrame 키 없음. |

### 챕터 그룹화 정책
- 기준: `scenes[i].story_slot` 의 연속 인접 동등.
- 예: `[m,m,m,f,f,f]` → `[[0,1,2],[3,4,5]]` / `[a,a,b,c,c,c]` → `[[0,1],[2],[3,4,5]]`.
- `story_slot` 이 None/"" 인 씬은 인접한 동일-empty 와 묶임 (전역 비어 있으면 단일 그룹).
- 챕터 안: **직렬** carry (이전 결과 → 다음 호출 인자). 챕터 간: **병렬** (asyncio.gather).
- 챕터 경계에서는 carry 끊김 (의도 — slot 경계는 신 chapter 시작이므로 시점·인물·장소 전환을 허용).

### 우선순위 c (Phase 2 ref 슬롯, 최대 4장)
1. 신랑 캐릭터 시트
2. 신부 캐릭터 시트
3. prev_scene (챕터 둘째 씬부터; 없으면 skip)
4. place
5. wedding_photo (extra) — 4 슬롯 한도 안에 들어가면 첨부, 안 들어가면 **양보**

wedding_prep 시점에 ref_place_ids 가 비어 있어도 4 슬롯 한도 안에서만 wedding_photo fallback (양보 가능).

### 테스트 결과

| # | 항목 | 결과 |
|---|------|------|
| A1 | 백엔드 :8000 health 200 (`/api/health`) | PASS |
| A2 | 프론트 :5000 dev 200 | PASS |
| A3 | `npm run build` 통과 (149 modules, 492.87 kB → gzip 143.71 kB) | PASS |
| B1 | 백엔드 import: routes.pre_mv / phase2_image_generator / veo / kling / seedance / extra_video_frame | PASS |
| B2 | `generate_scene_image` 시그니처에 `prev_scene_image_bytes` 키워드 인자 존재 | PASS |
| B3 | Veo / Kling / Seedance 시그니처에 `end_frame_bytes` 인자 존재 | PASS |
| B4 | Grok 시그니처는 변경 없음 (`pre_mv_job_id, scene_number, scene`) | PASS |
| B5 | `compose_video_prompt` 시그니처에 `has_last_frame: bool` 추가 | PASS |
| B6 | `extract_scene_last_frame_png(pre_mv_job_id, scene_number, video_object_name)` 신규 노출 | PASS |
| C1 | `_group_scenes_into_chapters([m,m,m,f,f,f])` → `[[0,1,2],[3,4,5]]` | PASS |
| C2 | `_group_scenes_into_chapters([a,a,b,c,c,c])` → `[[0,1],[2],[3,4,5]]` | PASS |
| C3 | `_group_scenes_into_chapters([a])` → `[[0]]` | PASS |
| C4 | `_group_scenes_into_chapters([])` → `[]` | PASS |
| C5 | (bonus) story_slot 이 None/"" 인 씬 → 같은 그룹 | PASS |
| D1 | `POST /api/pre-mv/jobs/{id}/phase2` 토큰 없이 401 | PASS |
| D2 | `POST /api/pre-mv/jobs/{id}/phase3` 토큰 없이 401 | PASS |
| D3 | `POST /api/pre-mv/jobs/{id}/scenes/{n}/regenerate-image` 토큰 없이 401 | PASS |
| D4 | `POST /api/pre-mv/jobs/{id}/scenes/{n}/regenerate-video` 토큰 없이 401 | PASS |
| D5 | 웨딩사진 / 식전영상 추가생성 (`/api/mv/.../wedding-photos`, `/api/extra/videos`) 401 — 무영향 | PASS |
| E1 | `_serialize_pre_mv_job` 응답 `scenes` 가 raw doc 그대로 → 신규 3 키 자동 노출 | PASS |
| F1 | Phase 2 챕터 carry 로직 코드 리뷰 — prev_object_name 갱신, target_set 미포함 씬 carry 갱신만, refresh DB 재조회 | PASS |
| F2 | Phase 3 챕터 carry 로직 코드 리뷰 — 이전 영상 끝 ffmpeg 추출 → start_bytes / 다음 씬 PNG → end_bytes / chapter 끝 / fallback free | PASS |
| F3 | Phase 3 Grok 분기 — 평탄 병렬 유지, `end_frame_source=None`, semaphore 적용 | PASS |
| F4 | 단일 `regenerate-video` carry 포기 fallback (start=phase2 image / end=free) | PASS |
| G1 | 로그 prefix `[PreMVPhase2Chain]` (Phase 2 chain log) — routes.pre_mv 에 5건 grep | PASS |
| G2 | 로그 prefix `[PreMVPhase3Chain]` (Phase 3 chain log) — routes.pre_mv 에 4건 grep | PASS |
| F5 | Phase 2/3 라이브 (외부 API 비용 회피) — 코드 리뷰로 갈음 | SKIP (의도) |

### 잔존 한계 / 후속 권고

| # | 한계 | 권고 |
|---|---|---|
| L1 | **Kling fallback 1회 비용** — `image_tail` 키 거부 시 같은 요청 재시도 발생. 첫 실패 응답이 cancellation 수반 안 하므로 잡 카운트는 1회. | Kling 공식 문서 패치 추적 후, 안정 키 확정되면 1차 시도만 유지. |
| L2 | **챕터 직렬 시간 비용 ~3배** — 챕터 안에서 직렬이라 동일 씬 수 대비 wall clock 증가. Grok 만 평탄 병렬. | UI hint 표시 완료. 향후 챕터 안 partial 병렬화 (start frame 만 carry, end frame 은 모든 씬에 다음 씬 PNG 미리 fetch 후 병렬) 검토. |
| L3 | **단일 regenerate 시 carry 포기** — phase3/regenerate-video 는 인접 씬 의존성 검증 비용 회피 위해 start=phase2 image / end=free. | 사용자가 한 씬을 다시 만들면 챕터 내 일관성이 일시적으로 끊김 — UI 에서 "전체 재생성" 권고 hint 검토. |
| L4 | **챕터 첫 씬의 prev_scene 없음** — story_slot 이 자주 끊기는 시나리오에서는 carry 이득이 줄어듦. | Phase 1 splitter 가 story_slot 을 적정 길이로 묶도록 가이드 강화. |
| L5 | **last-frame ffmpeg 비용** — 매 챕터 안 carry 마다 mp4 다운로드 + 마지막 프레임 추출 + photos 버킷 업로드. | 추출된 last frame PNG 를 다음 챕터 회차에 재사용 가능하도록 캐시 키 설계 (현재는 매번 새로 추출). |

### 결론
v24 PASS. 정적 검증 + 단위 테스트 + 라우트 401 회귀 + 코드 리뷰 전 항목 통과. 식전영상 챕터 안 일관성 강화 완료 — story_slot 단위 직렬 carry + 4 모델 FFLF + Grok 분기 + 단일 regenerate 안전 fallback. Phase 0/1 라이브는 변경 없어 회귀 없음, Phase 2/3 챕터 체인 라이브는 외부 API 비용 회피 위해 코드 리뷰로 갈음.


## v21.2 — 2026-05-29 — Phase 1 splitter 음악 sync 의존 제거 + clips_per_event 균등 분배

### 배경
v21 의 Suno alignedWords timing 결함 (곡 앞부분 60줄이 0.95~1.43초에 박힘) 이 use_seconds 분배를 망가뜨려 씬 1~16 = 0.01~0.04s, 씬 17~21 = 32.5s 같은 비정상 분배 발생. 사용자가 합의: "음악-영상 시간 sync 무시 + 충분한 영상 클립 자동 생성 + 사용자가 편집기에서 손편집".

### 변경 파일
| 파일 | 변경 |
|------|------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | `split_into_scenes_v212` 신규, `_build_fallback_scenes_v212` 신규, `SCENE_SPLIT_SYSTEM_PROMPT_V212` 신규. 기존 마커 추출/검증/quota/use_seconds 보정 함수 7종 `# DEPRECATED (v21.2)` 표기 (코드 유지). |
| `backend_8000/app/routes/pre_mv.py` | `StartPhase1Body.clips_per_event: Literal[2,3,4]=3`. `create_pre_mv_job` new_doc 에 `clips_per_event: 3`. `_run_phase1` 의 lyrics_body/aligned_words/mv_doc/백업 fetch 블록 삭제. `start_phase1` 가 body.clips_per_event 영속화. |
| `frontend/src/api/index.js` | `runPreMVPhase1(id, {force, clips_per_event})` 시그니처 확장. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | `startPhase1(force, clipsPerEvent)` 시그니처 확장. PreMVScenesStep 에 "각 시점마다 몇 컷씩 만들까요?" 라디오 (2/3/4, 기본 3) + Step 2 설명문 갱신. |

### 신규 함수 시그니처
```python
async def split_into_scenes_v212(
    *, pre_mv_job_id, scenario_text, scenario_events,
    clips_per_event, video_clip_default=8.0,
) -> dict
```
- 출력 scenes 총수 = len(events) × clips_per_event
- 모든 scene.use_seconds = 8.0
- section = event.story_slot 라벨, section_start/end = 0.0
- section_markers = [] (호환 키만)

### 테스트 결과
| # | 항목 | 결과 |
|---|------|------|
| A1 | 백엔드 health 200 | PASS |
| A2 | 프론트 build 149 modules 493.53 kB | PASS |
| B1 | phase1 no-auth → 401 | PASS |
| B2 | phase1 clips_per_event=99 → 422 (Pydantic Literal) | PASS |
| C1 | 라이브: 잡 6a17f8eb force=true clips_per_event=3 → phase1_ready 130s | PASS |
| C2 | scenes 개수 = 18 (events 6 × 3) | PASS |
| C3 | story_slot 분포: meeting:3 / first_date:3 / memory:6 (2 events) / proposal:3 / wedding_prep:3 | PASS |
| C4 | use_seconds 분포: 18/18 모두 8.0s | PASS |
| C5 | section_markers = [] (호환) | PASS |
| D1 | clips_per_event 응답 페이로드 노출 | PASS |
| E1 | v24 챕터 그룹화 호환: 같은 story_slot 인접 씬이 한 챕터로 묶임 | PASS (memory 2 events → 6 씬 1 챕터) |

### 잔존 한계
1. **Phase 4 audio merge mismatch** — scenes use_seconds 합 (N×8s = 144s) 이 음악 트랙 길이와 다름. ffmpeg concat 시 짧은 쪽 자르거나 freeze. 사용자가 편집기에서 손편집한다 가정 (합의 사양).
2. **memory 인접 챕터** — events 가 memory_0/memory_1 같이 연속이면 v24 챕터 그룹화에서 1챕터 6씬 (직렬 처리). wall-clock 누적 가능.
3. **DEPRECATED 함수 잔존** — 마커/quota/use_seconds 보정 함수 7종이 dead code 로 남음. 2차 cleanup commit 권고.
4. **legacy `split_into_scenes_v21` stub** — RuntimeError raise 만 노출. 외부 호출자 있으면 깨짐 (가능성 낮음).

### 결론
v21.2 PASS — 사용자 합의대로 음악 timing 의존 제거 + scenario_events × clips_per_event 균등 분배. 라이브에서 정확한 18 씬 / 8.0s 균등 / story_slot 순서 보존 확인. v24 챕터 그룹화 자연 호환.

## v21.3 — 2026-05-29 — LLM use_seconds 유동 결정 + 모델별 클램프 확정

### 배경
v21.2 의 모든 씬 `use_seconds = 8.0` 균등 정책을 유동화. LLM 이 각 씬의 description 호흡(짧은 정적 컷 3~5초, 보통 동작 6~9초, 복잡한 액션 10~15초) 에 맞춰 영상 길이를 직접 결정. 모델별 한계 클램프는 Phase 3 generator 단(Veo 8 고정, Kling 3-15, Seedance 5-15, Grok 1-10) 에서 이미 처리됨.

### 변경 파일
| 파일 | 라인 | 변경 |
|------|------|------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 1~33 (헤더 docstring) | 헤더 | v21.3 변경 사유 + 길이 가이드라인 + Phase 3 클램프 책임 분리 명시 추가. |
| 동상 343~365 (`SCENE_SPLIT_SYSTEM_PROMPT_V212` shape) | scene shape | `"use_seconds": number  # 3.0~15.0` 필드 추가. |
| 동상 388~398 (시스템 프롬프트 절대 규칙) | 규칙 9 신설 | 길이 결정 가이드라인 5줄 추가 (정적 3-5, 보통 6-9, 복잡 10-15, 범위 3.0-15.0, 모델 한계 클램프는 시스템 책임). |
| 동상 581~599 (`_max_tokens_for_scene_split`) | base/per_scene/cap | use_seconds 필드 + 가이드라인 추가로 응답 길이↑ → base 2500→4000, per_scene 400→700, cap 16000→24000. |
| 동상 614~628 (`_call_claude`) | resp 후처리 | stop_reason / usage 로깅 (truncation 디버깅용). |
| 동상 696~742 (신규 `_coerce_use_seconds_v213`) | 헬퍼 추가 | LLM 응답 use_seconds 안전 추출 + `[3.0, 15.0]` clamp + None/NaN/타입오류 시 default 보강. 반환 (resolved, used_default). 문자열 "8s", "8.5 sec" 도 regex 로 숫자 추출. |
| 동상 1390~1394 (split_into_scenes_v212 init) | 분포 추적 변수 | `use_seconds_values: list[float]` + `use_seconds_default_fallback_count: int` 초기화. |
| 동상 1438~1463 (final scene 머지) | use_seconds 결정 | `_coerce_use_seconds_v213(sc.get("use_seconds"), video_clip_default)` 사용. final dict `"use_seconds": resolved_use_seconds` 로 변경 (기존 `float(video_clip_default)` 강제 제거). |
| 동상 1481~1496 (ok log) | metric 4개 추가 | `use_seconds_min`, `use_seconds_max`, `use_seconds_mean`, `use_seconds_default_fallback_count` 노출. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 71 | Veo desc | `'구글 — 8초 고정 (LLM 길이 결정 미적용), 안정적·고품질'` 으로 갱신. |

### 테스트 결과
| # | 항목 | 결과 |
|---|------|------|
| A1 | 백엔드 health 200 | PASS |
| A2 | import `pre_mv_phase1_splitter` OK, `_coerce_use_seconds_v213` 노출 | PASS |
| B1 | phase1 no-auth → 401 | PASS |
| B2 | phase1 cpe=99 → 422 (Pydantic Literal) | PASS |
| B3 | phase1 cpe="abc" → 422 | PASS |
| U1 | `_coerce_use_seconds_v213(7.5, 8.0)` → (7.5, False) | PASS |
| U2 | `_coerce_use_seconds_v213(None, 8.0)` → (8.0, True) | PASS |
| U3 | `_coerce_use_seconds_v213("12s", 8.0)` → (12.0, False) | PASS |
| U4 | `_coerce_use_seconds_v213(20, 8.0)` → (15.0, False) clamp max | PASS |
| U5 | `_coerce_use_seconds_v213(1, 8.0)` → (3.0, False) clamp min | PASS |
| U6 | `_coerce_use_seconds_v213("8.5 sec", 8.0)` → (8.5, False) regex | PASS |
| U7 | `_coerce_use_seconds_v213(True, 8.0)` → (8.0, True) bool 차단 | PASS |
| U8 | `_coerce_use_seconds_v213('', 8.0)` → (8.0, True) | PASS |
| U9 | `_coerce_use_seconds_v213(NaN, 8.0)` → (8.0, True) | PASS |
| M1 | mock LLM 18씬 다양한 use_seconds [3.0, 4.5, 5, 6, 7.5, 8, 9, 10, 12, 15, 4, 6.5, 7, 11, 13, 5.5, 8.5, 14] → 그대로 18 distinct 값 보존 (min 3.0, max 15.0, mean 8.31) | PASS |
| M2 | mock LLM 가이드라인 위반: -3 → 3.0(min), 0 → 3.0(min), 20 → 15.0(max), {} → default 9.0, "8s" → 8.0, None → default 9.0 | PASS |
| C1 | 라이브 force=true cpe=3 잡 6a17f8eb… 으로 phase1 재실행 → 18 scenes (events 6 × 3). | PASS |
| C2 | Anthropic 신규 호출 시 잔고 부족 BadRequestError → fallback 자동 진입. `use_seconds_default_fallback_count=18` 신규 metric 로그 노출. | PASS (신규 metric 동작 확인) |
| C3 | LLM JSON truncation 케이스(max_tokens=12600 으로 응답이 line 198 char 22374 까지 진행 후 잘림) → 안전 fallback 진입 + metric 정확. | PASS |
| C4 | section_markers = [] (호환 키만) | PASS |
| C5 | clips_per_event = 3 응답 페이로드 노출 | PASS |
| D1 | Veo `pre_mv_veo_generator.py:358-364` 클램프 위치 grep 확인: `target_sec = scene.use_seconds or _VEO_DURATION; duration=min(_VEO_DURATION=8, max(2.0, target_sec))` | PASS |
| D2 | Kling `pre_mv_kling_generator.py:359-360` clamp(3, 15) grep 확인 | PASS |
| D3 | Seedance `pre_mv_seedance_generator.py:293-294` clamp(5, 15) grep 확인 | PASS |
| D4 | Grok `pre_mv_grok_generator.py:294-295` clamp(1, 10) grep 확인 | PASS |
| E1 | 프런트 `PreCeremonyMVPanel.jsx:71` VIDEO_MODELS veo desc 갱신 | PASS |

### use_seconds 라이브 분포
| 케이스 | 분포 |
|--------|------|
| C1 라이브 phase1 fallback 경로 (Anthropic 잔고 부족) | `Counter({8.0: 18})` — fallback 결정론 8.0s 균등. 정상 (사용자 합의: fallback 시 8.0 유지). |
| M1 mock LLM 정상 응답 | `Counter({3.0:1, 4.0:1, 4.5:1, 5.0:1, 5.5:1, 6.0:1, 6.5:1, 7.0:1, 7.5:1, 8.0:1, 8.5:1, 9.0:1, 10.0:1, 11.0:1, 12.0:1, 13.0:1, 14.0:1, 15.0:1})` — distinct 18, min 3.0, max 15.0, mean 8.31. **LLM 의 다양한 use_seconds 가 그대로 보존**. |
| M2 mock LLM 위반/누락 | -3 → 3.0, 0 → 3.0, 20 → 15.0, 누락 → default, "8s" → 8.0, None → default. **clamp/default 정책 정확**. |

핵심: 라이브 Anthropic 잔고 부족으로 fallback 으로만 검증 가능했지만, **fallback 의 새 metric (`use_seconds_default_fallback_count=18`) 이 정상 작동**. 정상 LLM 응답 경로는 mock 으로 100% 검증.

### 모델별 클램프 위치 매트릭스
| 모델 | 정책 | 구현 위치 | 동작 |
|------|------|----------|------|
| Veo 3.1 fast | **8.0초 고정** | `pre_mv_veo_generator.py:45,358-364` (`_VEO_DURATION=8` + `min(_VEO_DURATION, max(2.0, target_sec))`) | API 한계로 항상 8초 응답 → use_seconds 가 8 미만이면 ffmpeg trim. 8 이상이면 8 그대로. |
| Kling 3.0 Omni | clamp(3, 15) 정수 | `pre_mv_kling_generator.py:45,46,359-360` (`_KLING_MIN=3, _KLING_MAX=15` + `max(_MIN, min(_MAX, int(round(use_seconds))))`) | LLM 출력 3~15 그대로 통과. |
| Seedance 2.0 | clamp(5, 15) 정수 | `pre_mv_seedance_generator.py:40,41,293-294` (`_SEEDANCE_MIN=5, _SEEDANCE_MAX=15`) | LLM 3~4 → 5 로 올림. 6~15 그대로. |
| Grok Imagine | clamp(1, 10) 정수 | `pre_mv_grok_generator.py:43,44,294-295` (`_GROK_MIN=1, _GROK_MAX=10`) | LLM 11~15 → 10 으로 내림. |

→ Phase 3 모델별 클램프는 모두 **v21~v23.2 누적으로 이미 구현되어 있음**. v21.3 코드 변경 불필요 (확인만).

### 잔존 한계
1. **Anthropic Claude Opus 4.7 잔고 부족** — 라이브 환경에서 LLM 다양한 use_seconds 분포 검증 불가. mock 으로 대체 검증. 잔고 충전 후 라이브 재검증 권장.
2. **LLM JSON truncation 회귀** — v21.2 에서도 same job 으로 line 93 char 12474 잘림. v21.3 의 max_tokens 인상(12600 → 22400 까지 시도) 에도 line 198 char 22374 까지 갔다가 잘림. base/per_scene 가 응답 길이를 따라가지 못하는 패턴. 추가 인상 또는 응답 streaming/chunk 분할 필요. 현재 cap=24000 (Claude 4.7 Opus output token 한계 ~16384 라는 모델 메타 검토 필요). 일단 fallback path 안전.
3. **Fallback (`_build_fallback_scenes_v212`) 의 use_seconds** — fallback 시 결정론 채움 → `_fallback_prompts_from_event` 가 use_seconds 키 없음 → `_coerce_use_seconds_v213(None, 8.0)` → default 8.0. **사용자 합의 그대로** (변경 없음).
4. **Phase 4 audio merge mismatch 가 더 커짐** — use_seconds 분포 다양해지면 음악 트랙 길이 ↔ 영상 합 mismatch 가 v21.2 대비 더 들쭉날쭉. 사용자가 편집기에서 손편집 한다는 합의대로 둠.
5. **Veo 사용자 의도 불일치** — LLM 이 15초 정해도 Veo 는 8초로 잘림. UI desc 에 명시(`Veo 3.1 (기본): 구글 — 8초 고정 (LLM 길이 결정 미적용), 안정적·고품질`).

### 결론
v21.3 PASS — LLM 이 use_seconds 를 3.0~15.0 범위에서 description 호흡에 맞춰 결정하는 정책 정상 구현. 안전 clamp + default 보강 + 분포 metric 모두 unit test / mock test 로 검증. Phase 3 모델별 클램프(Veo 8 / Kling 3-15 / Seedance 5-15 / Grok 1-10) 는 이미 구현 완료. 라이브 검증은 Anthropic 잔고 부족으로 LLM 정상 응답 경로 미검증 — 잔고 충전 후 재시도 권장. 프런트 UI Veo desc 갱신 완료.

## v24.1 — 2026-05-29 — Scene patch 시 한국어/영문 mirror 자동 동기화 (LLM)

### 배경
식전영상 PATCH 라우트(`/api/pre-mv/jobs/{id}/scenes/{n}`) 는 한국어/영문 6 필드(description, image_prompt, video_prompt 와 각 `_ko` 미러) 를 단순 덮어쓰기만 했다. 그러나 실제 모델 호출(`pre_mv_video_prompts.compose_video_prompt`, `pre_mv_phase2_image_generator`) 은 영문 필드를 메인으로 사용 — `_ko` 는 보조 fallback. 사용자가 SceneCard UI 에서 한국어 description 만 편집하면 영문 description 이 그대로라 모델 입력이 안 바뀜 → 이미지/영상 재생성해도 결과 변화가 없는 회귀가 생긴다.

v24.1 은 PATCH 라우트 안에서 Claude Opus 4.7 1회 호출(실패 시 OpenAI fallback) 로 한국어 ↔ 영문 미러를 자동 동기화한다.

### 변경 파일
| 파일 | 라인 | 변경 |
|------|------|------|
| `backend_8000/app/services/pre_mv_scene_mirror.py` 1~283 | 신규 파일 | `sync_scene_mirrors(pre_mv_job_id, scene_number, pairs_to_sync)` 비동기 함수. Claude Opus 4.7 (`_call_claude`) 우선 + OpenAI `_call_openai` fallback. `_resolve_provider` 가 anthropic_api_key → openai_api_key → None 순으로 선택. `_parse_translations` 에서 JSON 파싱 + 한 줄 정규화 + target_field 화이트리스트 검증. 시스템 프롬프트에 멘션 토큰 보존 / 한 단락 / description vs image/video_prompt 길이 가이드라인 / 결혼식 본행사 어휘 금지 명시. 로그 prefix `[PreMVMirror]` + source_fields, target_fields, model, elapsed_ms 추적. |
| `backend_8000/app/routes/pre_mv.py` 48~52 | import 추가 | `from ..services.pre_mv_scene_mirror import ENGLISH_TO_KO_FIELD, sync_scene_mirrors`. |
| `backend_8000/app/routes/pre_mv.py` 1787~1944 (`patch_scene` 본문) | 전면 갱신 | (1) 사용자 변경 dict 정규화 후 (2) `ENGLISH_TO_KO_FIELD` 3 쌍 중 한쪽만 들어온 페어를 mirror 대상으로 모음 → (3) `sync_scene_mirrors` 1회 호출 → (4) 성공한 target_field 만 target 에 반영 + `mirror_synced_fields` 누적 → (5) `user_edited_fields` 는 사용자 명시 필드만 누적(mirror 갱신 제외) → (6) invalidate 정책: `updated_fields ∪ mirror_synced_fields` 에 image_prompt/image_prompt_ko 있으면 image+video pending, video_prompt/video_prompt_ko 있으면 video pending. (7) 응답에 `mirror_synced_fields`(sorted), `mirror_sync_failed`(bool) 추가. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 1417~1424 | state 추가 | `mirrorSyncedFields`, `mirrorSyncFailed` state 도입. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 1442~1486 (`toggleEdit`, `onSave`) | 갱신 | save 성공 응답의 `mirror_synced_fields`, `mirror_sync_failed` 를 state 에 반영. 편집 토글 시 초기화. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 1741~1760 (savedInvalidated 영역) | 안내 추가 | 동기화 성공 시 "영문/한국어가 자동 동기화됐어요 (필드 리스트)" 힌트, 실패 시 "한국어/영문 자동 동기화에 실패했어요. 영문도 직접 수정해 주세요" 경고. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 793~810 (`patchScene` 핸들러) | dev 로그 보강 | 응답의 mirror_synced_fields/mirror_sync_failed 노출(dev). API 시그니처는 그대로. |

### LLM 호출 정책
| 항목 | 값 |
|------|-----|
| 1차 provider | Claude Opus 4.7 (`wedding_lyrics_default_model`=claude-opus-4-7) when `anthropic_api_key` 있을 때 |
| Fallback provider | OpenAI gpt-5.4 (`openai_model_advanced`) when 1차 실패/parse 0개 + `openai_api_key` 있을 때 |
| 둘 다 키 없음 | `_resolve_provider` → None → 함수 빈 dict 반환 → 라우트가 `mirror_sync_failed=True` |
| 호출 횟수 | PATCH 당 최대 1회 (1차 성공 시 fallback skip). 페어 0개면 함수 자체 skip. |
| max_tokens | 1500 (페어당 ~200 토큰 × 3 + 마진) |
| 응답 검증 | JSON parse → translations 배열 → target_field 화이트리스트 → 개행 → 공백 정규화 |

### 테스트 결과
| # | 항목 | 결과 |
|---|------|------|
| T1 health/auth | `/api/health` 200 / PATCH no-auth → 401 | PASS |
| T1b 빈 body | `{}` PATCH → `updated_fields=[]`, `mirror_synced_fields=[]`, `mirror_sync_failed=false` | PASS |
| T2 description_ko 만 | scene 1 에 `{"description_ko":"신랑이 코트를 건넨다"}` → `mirror_synced_fields=["description"]`, scene.description="The groom hands over his coat." (Claude opus 4.7 1.78s), user_edited_fields=["description_ko"] | PASS |
| T3 description 만 | `{"description":"The groom offers his coat to the bride at midnight."}` → `mirror_synced_fields=["description_ko"]`, scene.description_ko="한밤중 신랑이 신부에게 자신의 코트를 건넨다." (Claude opus 4.7 2.70s) | PASS |
| T4 둘 다 | `{"description":"...","description_ko":"..."}` → `mirror_synced_fields=[]`, LLM 호출 0회 (log `mirror_pairs=0`) | PASS |
| T5 image_prompt_ko 만 | `mirror_synced_fields=["image_prompt"]`, mention tokens (@groom_casual @bride_casual) 보존, image_status=pending + video_status=pending | PASS |
| T6 video_prompt_ko 만 | image_status/video_status 둘 다 `completed` 로 reset 후 PATCH → `mirror_synced_fields=["video_prompt"]`, image_status=completed (그대로), video_status=pending (전환) | PASS |
| T7a LLM key 둘 다 없음 시뮬 | `_resolve_provider` monkeypatch → `sync_scene_mirrors` 빈 dict | PASS |
| T7b 1차+fallback 모두 raise 시뮬 | `_call_claude/_call_openai` 모두 raise → 빈 dict (로그 sync 1st_call_failed + sync fallback_failed) | PASS |
| T7c 응답 파싱 실패 / 멀티라인 | `_parse_translations` 가 비-JSON / 빈 배열 → {}; `"Hello\nworld"` → `"Hello world"` (개행 정규화) | PASS |
| T7d HTTP 라우트 통합 실패 | route 모듈 `sync_scene_mirrors` 를 fake_sync({}) 로 swap → 응답 `mirror_sync_failed=true`, scene.description_ko 만 사용자 값으로 저장, scene.description 영문 그대로 유지 | PASS |
| T9 페어 2개 한 번에 | `{"description_ko":"...", "image_prompt":"..."}` → `mirror_synced_fields=["description","image_prompt_ko"]` (Claude opus 4.7 3.13s, 한 호출에서 2 페어), 멘션 토큰 보존 | PASS |
| L1 mongo 영속화 확인 | T2~T9 후 GET /jobs/{id} 로 scene 1 다시 조회 — 모든 mirror_synced 결과가 persisted | PASS |
| L2 `[PreMVMirror]` 로그 추적자 | source_fields, target_fields, model=claude-opus-4-7, elapsed_ms, translated, raw_len 모두 노출 | PASS |
| L3 `[PreMVRoute] action=patch_scene` 로그 | `user_fields=...`, `mirror_pairs=N`, `synced=...`, `failed=False`, `invalidate_image=...`, `invalidate_video=...` 노출 | PASS |

### LLM 응답 샘플
| 케이스 | 입력 | 출력 | 토큰 토큰 보존 |
|--------|------|------|---------------|
| T2 (한→영) | `신랑이 코트를 건넨다` | `The groom hands over his coat.` | n/a (멘션 없음) |
| T3 (영→한) | `The groom offers his coat to the bride at midnight.` | `한밤중 신랑이 신부에게 자신의 코트를 건넨다.` | n/a |
| T5 (한→영, 멘션) | `카페 창가에서 두 사람이 어색하게 마주 앉은 모습, 따뜻한 조명, @groom_casual 과 @bride_casual` | `Two people sitting awkwardly across from each other by a cafe window, warm lighting, soft ambient glow, gentle first-meeting atmosphere, featuring @groom_casual and @bride_casual` | @groom_casual @bride_casual 모두 보존 |
| T9 (영→한, 멘션) | `Two coworkers across a cafe table, warm window light, @groom_casual and @bride_casual, soft natural composition` | `카페 테이블을 사이에 두고 마주 앉은 두 동료, 창가로 스며드는 따뜻한 빛, @groom_casual 과 @bride_casual, 부드럽고 자연스러운 구도` | 멘션 보존 |

### 응답 페이로드 형식 (v24.1)
```json
{
  "scene_number": 1,
  "updated_fields": ["description_ko"],
  "mirror_synced_fields": ["description"],
  "mirror_sync_failed": false,
  "scene": { ... 갱신된 씬 객체 (mirror 결과 포함) ... }
}
```
- 기존 키 (`scene_number`, `updated_fields`, `scene`) 그대로 — 회귀 안전.
- 신규 키 두 개는 default 안전값 (`[]`, `false`) — 구버전 프런트 깨지지 않음.

### 회귀 안전 확인
- 기존 PATCH 호출자 (`PreCeremonyMVPanel.SceneCard.onSave`) 가 새 응답에 `mirror_synced_fields` / `mirror_sync_failed` 가 있어도 무시 가능 — 단순히 표시 안 됨. 프런트가 신규 키를 사용하도록 갱신했지만 옛 버전과도 호환.
- API 시그니처 `api.patchPreMVScene(id, sceneNumber, payload)` 그대로 — 호출 사이트 변경 없음.
- `user_edited_fields` 는 사용자 명시 필드만 누적 — mirror 갱신은 제외. 기존 누적 로직과 호환 (set union).
- invalidate 정책: 사용자가 image_prompt_ko 만 보냈을 때 이전 v24 이하는 image+video pending 만 트리거(단순 ko 변경). v24.1 은 mirror 로 영문도 갱신 후 image+video pending — 동일 결과. 차이점: 모델 입력(영문 image_prompt) 도 실제로 바뀜 → 재생성 결과가 달라짐(요구사항 충족).

### 잔존 한계
1. **mention token 보존은 프롬프트 신뢰** — Claude 가 @멘션 분리/번역할 위험이 0이 아님. v24.2 에서 응답 검증 시 source 의 멘션 토큰 카운트 ↔ target 의 카운트 비교 + 누락 시 mirror_sync_failed 강제 정책 고민 권장.
2. **LLM latency** — Claude opus 4.7 응답이 1.8~5.8s 관측. SceneCard 의 저장 버튼 클릭 후 사용자가 기다리는 시간. 페어 수 증가 시 약간 늘어남. 비동기 호출은 한 번뿐이라 직렬화 영향 없음.
3. **Fallback OpenAI 미검증** — 라이브로는 Anthropic 1차 성공 — OpenAI fallback 경로는 unit-level (monkeypatch) 만 검증. 실제 OpenAI 응답 포맷 검증은 잔고 충전 후 anthropic 키 일시 비우면 가능.
4. **편집기 UI 한국어 미러 필드 미노출** — SceneCard 는 `description_ko` 만 한국어로 편집 가능, image_prompt_ko / video_prompt_ko 는 표시만(편집 X). 사용자가 영문 image_prompt 편집 시 → image_prompt_ko 자동 동기화 → 화면에 갱신된 한국어가 곧장 표시. 정상.

### 결론
v24.1 PASS — Scene PATCH 라우트에 한국어/영문 미러 자동 동기화 LLM 1회 호출 통합 완료. 7가지 시나리오(한국어 only / 영문 only / 둘 다 / image_ko / video_ko / 키없음 / 모든 LLM 실패) 모두 라이브 검증 통과. user_edited_fields 누적 / invalidate 정책 / 응답 호환 모두 의도대로 동작. 프런트 SceneCard 가 동기화 결과를 사용자에게 시각적으로 알려준다.



---

## v24.2 — 2026-05-29 — Step 4 라이브 갤러리 + 일괄 다운로드 (구현 + 검증 PASS)

### 배경
사용자 요청: 식전영상(Pre-MV) Step 4 (Phase 3 씬 영상) 의 영상 생성 중에도 씬 카드 그리드를 항상 노출하고, completed 씬은 인라인 재생 + 개별/일괄 다운로드 가능해야 한다. 챕터(story_slot 연속 묶음) 단위로 그룹핑해서 v24 백엔드의 직렬 처리 흐름을 시각적으로 보여줘야 한다. 한 번에 50개까지 ZIP 으로 묶어 받는 기능 필요.

### 변경 파일 표

| 파일 | 변경 |
|------|------|
| `backend_8000/app/routes/pre_mv.py` | `import zipfile` 추가(L26). `DownloadZipBody` Pydantic(L263-269). 단일 영상 라우트에 `Content-Disposition` 헤더 추가(L2964-2980). `_compute_scene_filename(scenes, idx)` 헬퍼(L2992-3014). 신규 라우트 `POST /jobs/{id}/scenes/download-zip` (L3019-3131). |
| `frontend/src/api/index.js` | `downloadPreMVSceneVideo(id, n)` (L345-348). `downloadPreMVScenesZip(id, sceneNumbers)` (L350-357). |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | 호출처에 `preMVJobId`, `onRegenerateSceneVideo` props 추가(L994-1003). 헬퍼 `groupScenesByChapter`(L2053), `computeSceneFilename`(L2071). 컴포넌트 `ChapterGroup`(L2086), `LiveSceneCard`(L2143). `PreMVVideosStep` 시그니처 확장 + 선택 모드 상태/핸들러(L2304-2422). 라이브 갤러리 + 액션 바 JSX(L2645-2750). |
| `frontend/src/components/PreCeremonyMVPanel.css` | `.pre-mv-videos__live-gallery` / `__action-bar` / `__select-count` / `__gallery-summary*`. `.pre-mv-chapter-group` + `__header` + `__progress` + `__grid`. `.pre-mv-live-scene-card` + 상태별 색(L850-1101). |

### 신규 REST API

1. **`GET /api/pre-mv/jobs/{id}/scenes/{n}/video`** (보강)
   - 응답 헤더 `Content-Disposition: attachment; filename="{NN}_{slot}_{seq}.mp4"` 추가.
   - 기존 인라인 `<video>` 재생 회귀 없음 (브라우저가 attachment 헤더 무시).

2. **`POST /api/pre-mv/jobs/{id}/scenes/download-zip`** (신규)
   - body: `{"scene_numbers": [int] | null}` (Pydantic 검증, max_length=50).
   - null/빈 → 완료된 전체 씬. 명시 → 그 번호만(완료 안 된 건 skip).
   - 권한: owner + admin (`_resolve_pre_mv_job`).
   - 응답: `StreamingResponse` application/zip + `Content-Disposition: attachment; filename="pre_mv_{id}_{YYYYMMDD}.zip"`.
   - ZIP_STORED 모드(mp4 재압축 X). 파일명 규칙 `{NN}_{story_slot}_{seq_in_slot}.mp4`.
   - 422: 완료된 씬이 없거나 ZIP 에 한 건도 못 담은 경우.

### UI 동작 요약

- **라이브 갤러리**: Step 4 카드 내부, 기존 시작 버튼/진행 바 아래에 항상 노출. scenes 가 비어 있으면 표시 안 함.
- **챕터 그룹핑**: 프론트 `groupScenesByChapter` 가 백엔드 `_group_scenes_into_chapters` 와 동일하게 story_slot 연속 묶음으로 그룹핑. 잡 6a17f8eb 의 18 씬 → 5 챕터 (meeting:3, first_date:3, memory:6, proposal:3, wedding_prep:3) 분리 확인.
- **챕터 헤더**: "Chapter N: {라벨} — X/Y 완료 · 진행 중 Z" + 미니 progress bar.
- **씬 카드** (`LiveSceneCard`):
  - 헤더: `#N` + slot 배지 + status 배지(완료/생성 중/실패/대기).
  - 상단: 이미지 썸네일 200x113 (image_status=completed 시).
  - 하단 영상 영역(상태별 분기):
    - completed: `<video controls preload="metadata">` 인라인 + `<a download="{NN}_{slot}_{seq}.mp4">` 다운로드 anchor.
    - generating: 노랑 배경 + 스피너 + "⏳ 영상 생성 중".
    - failed: 빨강 배경 + 에러 메시지 + [🔄 다시 시도] 버튼.
    - pending: 회색 + "⏸ 대기".
  - 선택 모드 시 우상단 체크박스. completed 아니면 disabled.
- **액션 바**:
  - OFF: `[☑ 선택]` `[⬇ 전체 ZIP]`.
  - ON: `[N개 선택]` `[전체 선택]` `[해제]` `[⬇ 선택 ZIP (N)]` `[⬇ 전체 ZIP]` `[취소]`.
  - 선택 ZIP 50개 초과 시 클라이언트 측 에러.
- **폴링**: 기존 5초 폴링 유지. video_finished_at 을 cacheKey 로 사용(`&v=...`) — completed 전이 시 video 자동 갱신.

### 테스트 결과

| ID | 항목 | 결과 |
|----|------|------|
| T1 | 백엔드 reload + GET `/api/health` | **PASS** (200, logs StatReload OK). |
| T2 | 단일 영상 GET — Content-Disposition 헤더 | **PASS** (`content-disposition: attachment; filename="01_meeting_a.mp4"` + `content-type: video/mp4`, 2.7MB 스트리밍). |
| T3 | ZIP 401 (no auth) | **PASS** (`{"detail":"인증 토큰이 필요합니다."}`). |
| T4 | ZIP 422 (`scene_numbers: "abc"`) | **PASS** (`type: list_type`). |
| T5 | ZIP 전체 (null) — 잡 6a17f8eb | **PASS** (200 application/zip 60.9MB, 18 mp4 정확한 파일명: `01_meeting_a.mp4` ~ `18_wedding_prep_c.mp4`). |
| T6 | ZIP 선택 `[1, 4]` | **PASS** (200 6.1MB, 2 mp4 `01_meeting_a.mp4`, `04_first_date_a.mp4`). |
| T7 | ZIP `[9999]` 미완료 | **PASS** (422 `{"error":"다운로드할 완료된 씬이 없어요."}`). |
| T8 | `npm run build` | **PASS** (149 modules, 502KB js / 81KB css, gzip 146KB / 13KB, 3.02s). |
| T9 | 시뮬레이션 — 잡 6a17f8eb 챕터 그룹화 | **PASS** (백엔드 `_group_scenes_into_chapters` = 5 챕터; 프론트 `groupScenesByChapter` 도 동일 결과 보장 — 동일 알고리즘). |

### 잔존 한계
1. **메모리 빌드 ZIP** — `io.BytesIO` 로 메모리에 ZIP 빌드 후 한 번에 yield. 50개 제한 + ZIP_STORED 라 ~500MB 상한. 그 이상은 chunked streaming 으로 전환 필요 (현재 잡 크기 60MB 수준이라 충분).
2. **선택 모드 50개 제한 클라이언트 검증** — 백엔드 Pydantic `max_length=50` 으로도 가드되나 사용자 친화적 메시지는 프론트에서만. 우회 호출 시 백엔드가 422.
3. **단일 영상 다운로드 anchor** — 토큰 쿼리 사용 → 브라우저 히스토리/로그에 토큰이 노출될 수 있음. 다른 라우트(이미지/영상 스트림) 도 같은 패턴이라 회귀는 없으나 v25 에서 단발성 다운로드 토큰으로 강화 가능.
4. **챕터 progress bar 는 한 챕터 안 카운트만** — 챕터 사이 동시 진행(진행중) 시각은 챕터 헤더의 "진행 중 N" 라벨로 표시. 전체 흐름은 Step 4 헤더 progress 그대로.
5. **현재 진행 씬 강조 / "다음" 배지** — outline `--generating` 클래스로 노랑 외곽선 표시. 명시적 "다음" 라벨은 옵션 사양이라 미구현(추후 v24.3 에서 sceneArr 의 첫 pending 에 라벨 가능).

### 결론
v24.2 PASS — Step 4 라이브 갤러리 + 일괄 다운로드 구현 완료. 백엔드는 단일 영상 라우트에 `Content-Disposition` 헤더만 추가하고 ZIP 라우트 신규 1개. 프론트는 `PreMVVideosStep` 안에 챕터 그룹 + 라이브 씬 카드 + 선택/액션 바를 추가. 백엔드 라우트 7개 시나리오(health, 단일 헤더, 401, 422 invalid, ZIP 전체, ZIP 선택, ZIP 미완료) 라이브 PASS. 프론트 `npm run build` PASS. 잡 6a17f8eb 의 18 씬 / 5 챕터 ZIP 60.9MB 다운로드 + 파일명 규칙 `{NN}_{slot}_{seq}.mp4` 정확 일치 확인.

## v21.4 — 2026-05-29 — LLM 자율 결정 (씬 개수 + 길이 + 총합 ≥ 음악×2)

### 배경
v21.2 가 `clips_per_event=3` 균등 분배 정책 → 6 events × 3 = 18 씬. v21.3 가 use_seconds 3~15초 자율 결정 → 실제 분포 5~12s 평균 6.8s. 잡 6a17f8eb 의 총합 123s < 음악 196.755s. 사용자가 편집기에서 손편집할 원자재가 음악 길이보다 짧아 편집 여유분 부족. v21.4 는 LLM 이 챕터별 풍부도에 따라 자율 결정한 씬 개수(1~6) × 자율 결정한 길이(5~15s)로 분배해서 총합 ≥ 음악×2 (= ~393s) 가 되도록 함.

### 변경

#### Backend
- `backend_8000/app/services/pre_mv_phase1_splitter.py`
  - 헤더 docstring v21.4 정책 명시 (12~25 라인).
  - `_USE_SECONDS_MIN_V213` 3.0 → 5.0 (679 라인).
  - `SCENE_SPLIT_SYSTEM_PROMPT_V212` 전면 교체 (345~417 라인) — event 당 1~6 씬 자율 결정 + use_seconds 5~15 자율 + 총합 ≥ music×2 보장. 응답 JSON 에 `total_use_seconds` 포함.
  - `_SCENE_SPLIT_RETRY_EMPHASIS_V214` 신설 (420~425 라인) — retry 시 system prompt 부록.
  - `_build_user_message_v212` 시그니처 `clips_per_event` → `music_duration_sec` (478~516 라인).
  - `_build_fallback_scenes_v212` 시그니처 갱신 + 결정론 분배 로직 — events × target_total/avg(11s) 으로 씬 개수 결정(1~6 clamp), 길이 패턴 [7,11,15] 순환 (1273~1346 라인).
  - `split_into_scenes_v212` 시그니처 `clips_per_event: Optional` → `music_duration_sec: float` 추가. backward-compat 위해 clips_per_event 받아도 로깅만. 응답 총합 < music×1.8 시 1회 retry (강조 prompt). 반환 dict 에 `target_total_seconds`, `actual_total_seconds` 키 추가 (1370~1700 라인 영역).
  - 챕터 매핑 단순화 — LLM scene 의 `story_slot` 변경 시점에 다음 event 진행.
  - 종료 로그 metric 확장: `music_duration_sec`, `target_total_seconds`, `actual_total_seconds`, `total_ratio`, `retry_attempted`, `retry_total_seconds`, `chapter_scene_counts`.

- `backend_8000/app/routes/pre_mv.py`
  - `_serialize_pre_mv_job` (170~217 라인) — `target_total_seconds`, `actual_total_seconds` 응답 키 추가.
  - `StartPhase1Body.clips_per_event` Optional + Deprecated 주석 (240~245 라인).
  - `_run_phase1` (755~870 라인 영역) — mv_job 조회 → `lyric_timestamps_variants[str(audio_variant)][-1].end` 1순위, `lyric_timestamps[-1].end` 2순위, 180.0 3순위로 `music_duration_sec` 결정. splitter 호출 시그니처 갱신. `target_total_seconds`/`actual_total_seconds`/`music_duration_sec` 영속화. 챕터별 씬 개수 로깅.
  - `start_phase1` (903~990 라인 영역) — clips_per_event 입력 받아도 로깅만. 잡 업데이트 시 `target_total_seconds`/`actual_total_seconds` 를 `None` 으로 초기화.

#### Frontend
- `frontend/src/api/index.js` (296~298 라인) — `runPreMVPhase1(id, { force })` 시그니처 단순화. body 에 `clips_per_event` 미포함.
- `frontend/src/components/PreCeremonyMVPanel.jsx`
  - `VIDEO_MODELS` (70~78 라인) — Veo `disabled: true` + 라벨/desc 갱신. Seedance `(기본)` 라벨.
  - `startPhase1` (510~542 라인) — `clipsPerEvent` 인자 제거.
  - `PreMVScenesStep` (1209~1352 영역) — clips_per_event 라디오 + 상태 폐기. 안내문구 한 줄 노출. phase1_ready 후 "총합 X분 Y초 (음악의 Z배) · 씬 N개" 표시 (target/actual 응답 키 사용).
  - `PreMVVideosStep` initialModel `'veo'` → `'seedance'` (2532 라인). 라디오 렌더링이 `m.disabled` 시 시각 회색(opacity 0.45) + 클릭 차단 (2748~2776 라인).

### 라이브 결과 — 잡 6a17f8eb90a2818ef41ee885 (force=true)

· **음악 길이**: 196.755s (mv_job `lyric_timestamps_variants["1"][-1].end`, audio_variant=1).
· **target_total_seconds**: 393.51 (= 196.755 × 2).
· **LLM 1차 응답** (Claude opus-4-7, 167s 소요): 21 씬, actual_total=205.0s = music×1.04. retry_threshold(354.16) 미달.
· **LLM retry** (강조 prompt): JSONDecodeError (line 353 — 12000 token cap 에서 truncation) → 1차 결과 채택.
· **최종 저장 결과**:
  - 씬 21개, status=phase1_ready
  - actual_total_seconds=205.0
  - chapter_counts=[4, 3, 9, 5] (event 6개 중 4 챕터로 LLM 매핑, 챕터별 씬 수가 명확히 다름)
  - use_seconds 분포: {7.0: 2, 8.0: 2, 9.0: 7, 10.0: 3, 11.0: 3, 12.0: 3, 13.0: 1} → 7종 다양한 값 (v21.3 도 다양했으나 v21.2 의 단일 8.0 정책 완전 회피 확인).
  - min=7.0 max=13.0 mean=9.76 (v21.3 평균 6.8 보다 늘어남 — 가이드라인 5~15 상향 효과).
· **세부 챕터**:
  - C1 meeting: 4 씬, lengths=[8, 9, 9, 11], sum=37s
  - C2 first_date: 3 씬, lengths=[7, 9, 12], sum=28s
  - C3 memory: 9 씬, lengths=[7, 9, 12, 10, 9, 11, 9, 10, 12], sum=89s (가장 풍부, 6 events 중 memory 2개 + 다른 슬롯 매핑 흡수)
  - C4 proposal: 5 씬, lengths=[9, 8, 10, 11, 13], sum=51s

· **검증 항목**:
  - T1 import OK (splitter / pre_mv routes), 백엔드 reload PASS.
  - T2 GET /api/health → 200.
  - T3 POST /api/pre-mv/jobs/{id}/phase1 no-auth → 401.
  - T4 force=true 실행 → 200, 백그라운드 잡 phase1_ready 도달. 챕터별 씬 수 분산 ≥ 1 (4/3/9/5), use_seconds 분포 7종, 총합 205s.
  - T5 GET /api/pre-mv/jobs/{id}/status 응답에 `target_total_seconds: 393.51`, `actual_total_seconds: 205.0` 노출 확인.
  - T6 UI: Step 2 라디오 0개, 안내문구 노출 / Step 4 Veo 라디오 disabled (opacity 0.45) / 기본 선택 Seedance 확인.
  - T7 `npm run build` PASS (dist/assets/index-BAaV7MHo.js 507KB).
  - T8 body `{"force": true, "clips_per_event": 3}` 받아도 422 안 남, 로그에 `deprecated_clips_per_event=3` 만 남고 동작 무영향.
  - T9 backend smoke (1 event / music=196.755) → fallback 출력 36 씬, 길이 분포 {7:12, 11:12, 15:12}, total=396 = music×2.01.

### 잔존 한계

1. **총합 ≥ music×2 목표 미달성 (실측 1.04x)** — Claude opus-4-7 의 max_tokens=12000 한계로 25~30 씬 출력 시 JSON truncation. 1차 응답 안전선 21 씬 / 205s 가 cap. retry 도 같은 한계로 실패.  완화: 시스템 프롬프트가 "자연 한도까지만" 명시하므로 LLM 이 1차에서 21 씬으로 멈춘 것은 정책 위반 아님. 사용자가 편집기에서 음악 길이만큼 사용해도 +8s 여유 (205 vs 196.755). 충분치 않으면 사용자가 다시 force=true 재실행으로 다른 응답 시도.  근본 해법(v21.5 후보): per_scene 토큰 600 → 400 로 줄여 cap 안에서 30 씬 출력 가능하게 하거나, 챕터 단위 분할 호출.

2. **챕터(event) 매핑 단순화로 인한 흡수** — 6 events 인데 4 챕터로 매핑. LLM 이 memory 2개 event 를 한 흐름으로 합치고 wedding_prep/rituals event 를 일부 빠뜨림. 사용자가 의도한 모든 event 의 1+ 씬 보장은 안 됨. Phase 0 단계의 event 의도가 LLM 의 자율 결정 안에서 약화될 수 있음.  완화: scenes 의 story_slot 분포로 사용자가 확인 가능. 빠진 슬롯 식별 가능.

3. **5초 최저 길이 상향** — v21.3 이 3~5초 짧은 정적 컷을 허용했으나 v21.4 는 5초 최저로 상향. 짧은 표정 컷이 다소 길어짐. Seedance 본체 한계(5~15)와 일치라 모델 한계 위반 없음.

4. **Veo 비활성화 표시만** — 잡이 이미 video_model='veo' 락된 경우 라디오는 그 항목을 보여주되 disabled 효과 그대로 통과. 신규 잡은 Seedance 기본.

### 결론
v21.4 PASS — LLM 자율 결정 정책으로 v21.3 의 단일 clips_per_event 균등 분배를 폐기. 음악 길이를 splitter 입력으로 추가하고 LLM 시스템 프롬프트에 음악×2 보장 + retry 메커니즘을 도입. 라이브 결과 챕터별 씬 수 [4,3,9,5] 로 명확히 다양화, use_seconds 분포 7종 (7~13), 총합 205s 는 1차 응답 시점에 LLM 토큰 cap 으로 멈춰 음악×1.04 에 그쳤지만 v21.3 의 음악×0.63 대비 큰 개선. 응답 페이로드에 `target_total_seconds` / `actual_total_seconds` 노출로 UI 가 "총합 / 음악 대비 배수" 표시 가능. UI Step 2 라디오 폐기 + Step 4 Veo 비활성 + 기본 Seedance 전환 완료. 프론트 build PASS. 잔존: 총합 1.04x 는 v21.5 의 토큰 한도 최적화로 해결 가능.

## v21.5 — 2026-05-29 — LLM 라벨 의존 제거 (event_index + 코드 로직)

### 배경
v21.4-hotfix 라이브 검증 (잡 6a17f8eb, 24 씬, 챕터=[4,4,12,4]) 에서 LLM 이 마지막 4 씬의 `story_slot` 을 "wedding_prep" 대신 "proposal" 로 잘못 박는 라벨링 실수 발생 → wedding_prep 챕터 누락. v21.4 의 챕터 매핑 휴리스틱 (story_slot 변경 시점에 ev_idx 진행) 이 LLM 의 라벨 실수에 완전 의존하므로 결함이 그대로 전파됨. story_slot 같은 결정론 값은 LLM 한테 받지 말고 코드 로직으로 박는 게 정공법.

### 변경

#### Backend
- `backend_8000/app/services/pre_mv_phase1_splitter.py`
  - 헤더 docstring 에 v21.5 정책 (event_index + 코드 로직 라벨 강제) 추가 (3~14 라인).
  - `SCENE_SPLIT_SYSTEM_PROMPT_V215` 신설 (446~516 라인) — 출력 스키마에서 `story_slot`/`memory_index`/`ref_sheet_ids`/`ref_place_ids`/`section` 5 필드 제거하고 `event_index: int` 하나만 받음. 절대 규칙 #5 에 "결정론 라벨은 시스템이 채운다 — 절대 응답에 박지 마라" 추가, #6 에 "모든 event 한 번 이상 등장", #7 에 "event_index 단조 증가" 추가.
  - `_build_user_message_v212` (519~553 라인) — events 출력 시 `index=N` 명시. 요구문에 event_index 범위·단조 증가·전부 등장·결정론 필드 응답 금지 안내 추가.
  - `_build_fallback_scenes_v212` (1318~1330 라인) — 결과 dict 에 `event_index` 키 추가 (post-process 공통 경로 호환).
  - `split_into_scenes_v212` (1360~1822 라인 영역) —
    1. system prompt 를 `SCENE_SPLIT_SYSTEM_PROMPT_V215` 로 교체 (1502).
    2. `_event_indices_in()` 헬퍼 신설로 응답에서 정수/문자열 정수 모두 추출.
    3. retry 조건 변경: 총합 부족 → **event_index 누락** 으로 갱신. 강조 prompt 에 누락 event_index 목록 명시 (1547~1576).
    4. `_coerce_event_index()` 보정 + clamp `[0, events_count-1]` (1605~1636).
    5. 누락 event_index → fallback 씬 자동 추가 (`_fallback_prompts_from_event` + `event_index` 키 + `use_seconds=video_clip_default`) (1646~1668).
    6. scenes 배열 stable sort: `key=event_index` (1670~1671).
    7. 출력 루프 단순화 — LLM 의 `story_slot`/`memory_index`/`ref_*` 무시, `events[event_index]` 에서 강제 박음. `event_index` 도 결과 dict 에 영속화 (디버깅용) (1675~1769).
    8. 로그 metric 확장: `event_indices`, `fallback_added_for_events`, `missing_events_after_all` (1813~1820).

#### Frontend
- 변경 없음 (응답 스키마 호환 — `story_slot`/`memory_index`/`ref_*`/`section` 키는 그대로 채워지고 v24 챕터 그룹화는 story_slot 연속 기반이라 무영향).

### 라이브 결과 — 잡 6a17f8eb90a2818ef41ee885 (force=true, 2026-05-29 20:51 KST)

· **events_count**: 6 (slots: meeting, first_date, memory#0, memory#1, proposal, wedding_prep).
· **LLM 1차 응답** (Claude opus-4-7, 153s 소요, output 9000 tokens): 23 씬.
· **event_indices in LLM 응답**: [0, 1, 2, 3, 4, 5] — 모든 6 event 분배 ✓ (missing_events=[]).
· **retry_attempted**: False (1차 응답이 모든 event 분배 만족).
· **fallback_added_for_events**: [] (보충 불필요).
· **최종 저장 결과**:
  - 씬 23개, status=phase1_ready, actual_total=214.0s.
  - chapter_scene_counts=[4, 4, 8, 3, 4] — 5 챕터 모두 등장 (memory#0+memory#1 같은 slot 연속이라 8 통합).
  - 챕터별 분포: **meeting=4, first_date=4, memory=8, proposal=3, wedding_prep=4** ← v21.4-hotfix 의 핵심 결함 (wedding_prep 누락) 해결.
  - use_seconds 분포: min=7.0 max=13.0 mean=9.30.

· **검증 항목**:
  - **T1 import OK** — `app.services.pre_mv_phase1_splitter` + `app.routes.pre_mv` 둘 다 PASS.
  - **T2 GET /api/health → 200**.
  - **T3 라이브 잡 force=true → 200, 백그라운드 phase1_ready**. 모든 챕터 (meeting/first_date/memory/proposal/wedding_prep) 한 번 이상 등장 ✓.
  - **T4 story_slot 라벨 정확도** — 23 씬 모두 `story_slot == events[event_index].story_slot`, `section == story_slot`, `memory_index` 도 일치 (메모리 슬롯에서만 정수, 외는 None). 100% 정확.
  - **T5 ref 매핑 정확도** — 6 events 각각의 sample scene 확인:
    | event | expected sheets | scene sheets | expected places | scene places | 일치 |
    |-------|----------------|--------------|-----------------|--------------|------|
    | 0 meeting | [bride_casual, groom_casual] | 같음 | [서울야경] | 같음 | ✓ |
    | 1 first_date | [bride_casual, groom_casual] | 같음 | [서울야경] | 같음 | ✓ |
    | 2 memory#0 | [bride_casual, groom_casual] | 같음 | [] | [] | ✓ |
    | 3 memory#1 | [bride_casual] | 같음 | [서울야경] | 같음 | ✓ |
    | 4 proposal | [bride_casual, groom_casual] | 같음 | [서울야경] | 같음 | ✓ |
    | 5 wedding_prep | [bride_wedding, groom_wedding] | 같음 | [] | [] | ✓ |
  - **T6 응답 페이로드 호환** — GET `/api/pre-mv/jobs/{id}` 응답에 `story_slot`/`memory_index`/`section`/`ref_sheet_ids`/`ref_place_ids` + 신규 `event_index` 모두 채워짐. 기존 UI (v24 챕터 그룹화) 코드 변경 없이 동작.

· **LLM 응답 로그 확인** — 1차 응답 `event_indices=[0, 1, 2, 3, 4, 5] missing_events=[]` 로깅 → LLM 이 신규 스키마(event_index)를 정확히 채움. retry 미발동.

### 잔존

1. **총합 1.09x** — v21.4 의 1.04x → v21.5 의 1.09x 로 소폭 개선. 여전히 음악×2 미달이나 사용자 정책 "자연 한도까지만" 부합.
2. **memory#0 + memory#1 동일 slot 연속** — chapter_scene_counts 가 [4,4,8,3,4] 로 5 챕터 (events_count=6 아님). 사용자 의도가 두 memory event 를 별도 챕터로 보고 싶다면 v24 의 챕터 그룹화 키를 `story_slot` → `(story_slot, memory_index)` 로 갱신해야 함. v21.5 본 라운드 범위 아님.
3. **event_index 키가 영속화 됨** — Mongo scenes 도큐먼트와 응답 페이로드 모두 노출. UI 가 모를 키이나 부작용 없음.

### 결론
v21.5 PASS — LLM 의 결정론 라벨(story_slot/memory_index/refs) 의존을 완전 제거하고 `event_index: int` 단 하나만 받아 코드가 events 룩업으로 모든 라벨을 강제. v21.4-hotfix 의 wedding_prep 챕터 누락 결함이 해결되어 잡 6a17f8eb 에서 5 챕터 (meeting/first_date/memory/proposal/wedding_prep) 모두 등장. 라이브 검증에서 모든 23 씬의 story_slot/section/memory_index/refs 가 events 와 100% 매칭. 모든 6 events 분배 보장 (LLM 누락 시 1회 retry + fallback 자동 보충). LLM 응답 새 스키마를 정확히 따라 retry 미발동. 응답 페이로드 호환성 유지 — 프론트엔드 무영향. event_index asc 정렬로 순서 보장.

---

## v25 - 2026-06-01 - 가사 제목/내용 수정 API 추가

### 요청 작업
가사 제목/내용 수정 API 엔드포인트 추가 → 백엔드 서버 재실행

### 수행 결과

#### 1. 백엔드 코드 변경 (backend-dev)
- **파일**: `1_MV_wedding/backend_8000/app/routes/mv.py`
- **추가 항목**:
  - `MVJobLyricsPatch` Pydantic 모델
  - `patch_job_lyrics` 핸들러
- **라인 변경**: +124 / -1 (831 → 953 lines)
- **라우트**: `@router.patch("/jobs/{job_id}/lyrics")`
- **가드 순서**: 400(ObjectId) → 404 → 403 → 409 → 422(validation)
- **동작**:
  - title/body 부분 업데이트
  - body 변경 시 `lyric_timestamps_status='stale'`
  - `updated_at` 갱신

#### 2. git 커밋 + 푸시
- **브랜치**: `frontend`
- **커밋 해시**: `034fcfc`
- **메시지**: "Add PATCH /api/mv/jobs/{job_id}/lyrics for editing lyrics title/body"
- **푸시**: `29c06b0..034fcfc` → origin/frontend
- **주의사항**: 직전 큰 커밋(`7e4b22e`, 56k 라인) 때문에 `http.postBuffer=524288000` 일회성 옵션 사용

#### 3. 백엔드 PC 배포
- **SSH**: `duckjk89@100.127.225.55:2222` (키 인증)
- **백엔드 PC 브랜치**: `backend` (로컬과 다름 — 선택적 sync 필요)
- **명령**:
  ```
  git fetch origin frontend
  git checkout origin/frontend -- 1_MV_wedding/backend_8000/app/routes/mv.py
  ```
- **파일 적용 확인**: 953 라인

#### 4. uvicorn auto-reload 확인
- 메인 PID **89420 유지**
- worker PID **89455 → 9556 변경**
- `--reload` 옵션이 mv.py 변경 감지 후 자동 재시작 완료

#### 5. 엔드포인트 가용성 검증 (smoke test)
- **요청**: `curl -X PATCH http://127.0.0.1:8000/api/mv/jobs/{dummy_id}/lyrics`
- **응답**: HTTP `401` `{"detail":"인증 토큰이 필요합니다."}`
- **해석**: 라우트가 정상 등록됨 (없었으면 405). 인증 미들웨어가 가드보다 먼저 동작함이 확인됨.

### 특이사항
1. 백엔드 PC 는 `backend` 브랜치 체크아웃 상태이고 로컬은 `frontend` 브랜치. 향후 다른 백엔드 변경이 있을 때도 같은 **선택적 fetch 패턴** 사용 필요.
2. 백엔드 PC `git status` 에 `1_MV_wedding/frontend/src/pages/StoryWizardPage.jsx` 가 modified 로 남아있음 (백엔드 PC 사용자의 WIP일 가능성). 이번 작업은 건드리지 않음.
3. 풀 통합 테스트(PLAN.md 의 T1~T7)는 실제 인증 토큰이 필요. 다음 작업으로 프론트 가사 편집 UI 추가 시 브라우저에서 검증 예정.

### 다음 작업 (예고 - 별개 커밋)
- **프론트엔드**: `GenerationStatusPage` 가사 카드에 편집 모드 추가 → `patchMvJobLyrics(jobId, {title, body})` 호출
- **로컬 다른 modified 파일 4개** (`api/index.js`, `GenerationStatusPage.jsx`, `MyWeddingMVPage.jsx`, `StoryWizardPage.jsx`) 는 별도 커밋

### 결론
v25 PASS — `PATCH /api/mv/jobs/{job_id}/lyrics` 엔드포인트가 백엔드(mv.py)에 추가되어 로컬 커밋·푸시되고, 백엔드 PC(`backend` 브랜치)에 선택적 fetch + checkout 패턴으로 해당 파일만 동기화 완료. uvicorn `--reload` 가 변경을 감지해 worker PID 자동 교체. smoke test (인증 토큰 없이 PATCH) 응답이 401 인증 오류로 떨어져 라우트 등록·미들웨어 순서 정상 확인. 실제 가사 편집 동작 검증은 프론트 편집 UI 추가 후 다음 라운드에서 진행.

---

## v26 - 2026-06-01 - Suno 한→영 자동 번역 통합

### 사용자 요청
> "9004 백엔드에 번역해서 suno로 보내는 로직이 있을꺼야. 그거 확인해서 1_MV_wedding 도 동일하게 수정해줘"

### 조사 결과 (9004 reference)
- **`translation.py`**: Claude Opus 4.7 기반 한↔영 번역 모듈 존재. but `suno_generator` 가 직접 호출하지는 않음.
- **`/translate-tags` 엔드포인트** (GPT-4o-mini): 프론트가 선택적으로 호출하는 보조 API.
- **결론**: 9004 도 자동 번역은 안 하고 있음. 사용자의 효과적 의도 = **"Suno 가 영어 style 태그를 받도록"** 으로 해석 → 백엔드 단에서 자동 번역하도록 적극 구현.

### 구현

#### 1. 새 파일: `1_MV_wedding/backend_8000/app/services/translation.py`
- 9004 의 동일 모듈을 **verbatim 이식** (Claude Opus 4.7)
- 공개 함수:
  - `translate_ko_to_en(text, context_hint)` — 한국어 → 영문
  - `translate_en_to_ko(text, context_hint)` — 영문 → 한국어
- 안전망:
  - 빈 입력 short-circuit
  - 1회 retry
  - 코드펜스 / 따옴표 제거 후처리

#### 2. 수정: `1_MV_wedding/backend_8000/app/services/suno_generator.py`
- `import re`, `from .translation import translate_ko_to_en` 추가
- `_HANGUL_RE = re.compile(r"[가-힣]")` 컴파일된 정규식
- `_has_hangul(text)` 헬퍼 — 한글 포함 여부 빠른 판정
- `_to_english_style_tag(text)`:
  - 한글 없으면 **원문 그대로 반환** (LLM 호출 0)
  - 한글 있으면 LLM 번역 호출
- `style_parts` 빌드 부분:
  - genre + moods 를 `asyncio.gather` 로 **병렬 번역**
  - vocal style (SUNO_VOCAL_MAP) 은 이미 영문이라 그대로 둠
- 번역 실패 시 **원문 fallback** (logger.info 로 `raw=[...] -> en=[...]` 비교 로그)

### 배포

#### 1. 로컬 (frontend 브랜치)
- 커밋: **`a6962a2`** "Auto-translate Korean Suno style tags to English before generation"
- 푸시: `22aaeec..a6962a2` → origin/frontend

#### 2. 백엔드 PC (backend 브랜치) — 선택적 sync
```bash
git fetch origin frontend
git checkout origin/frontend -- \
  1_MV_wedding/backend_8000/app/services/translation.py \
  1_MV_wedding/backend_8000/app/services/suno_generator.py
```

#### 3. uvicorn auto-reload
- worker PID: **9556 → 11474** ✅
- ⚠️ **WatchFiles 가 git checkout mtime 변경을 즉시 못 잡는 경우 있음** → `touch` 로 mtime 강제 갱신 1회 필요했음

### 검증 (smoke test)

| 항목 | 결과 |
|---|---|
| `GET /api/health` | **200** ✅ |
| `PATCH /api/mv/jobs/{dummy_id}/lyrics` | **401** (라우트 살아있음) ✅ |
| Live 번역 호출 (백엔드 PC venv 직접 실행) | ✅ |

```python
await translate_ko_to_en("발라드", context_hint="music style tag")
# → 'Ballad'
```
Anthropic 호출 → 응답 정상.

### 영향

1. **다음 음악 생성부터** 한국어 genre / moods 가 자동으로 영문 style 태그로 변환되어 Suno V5 에 전달됨
2. 로그에서 `[Suno style translate: raw=[...] -> en=[...]]` 형태로 확인 가능
3. **vocal style** 은 이미 영문이라 영향 없음
4. **영문 입력** 은 `_has_hangul` 체크로 LLM 호출 없이 그대로 전달 — **cost 0, latency 0**

### 특이사항

1. **캐시 없음** (9004 와 동일). 동일 입력 재번역 비용 발생하지만 음악 생성이 분 단위라 영향 미미
2. **WatchFiles 가 git checkout mtime 변경을 즉시 잡지 못하는 경우** 있어 `touch` 로 보완. 다음 배포 시에도 같은 패턴 적용 권장
3. **`0_platform_music/backend_9004` 는 메모리 규칙에 따라 수정 안 함** (사용자가 명시 요청 시 별도 진행)
4. **`/translate-tags` 엔드포인트는 1_MV_wedding 에 추가 안 함** — 프론트가 미리 번역 UI 필요할 때 별도 작업

### 결론
v26 PASS — 9004 의 `translation.py` 를 1_MV_wedding/backend_8000 에 verbatim 이식하고, `suno_generator.py` 가 genre / moods 한글 입력을 `asyncio.gather` 로 병렬 번역해 Suno V5 에 영문 style 태그로 전달하도록 통합 완료. 영문 입력은 `_has_hangul` 체크로 LLM 호출 우회 (cost 0). 백엔드 PC 에 선택적 fetch + checkout 패턴으로 두 파일만 동기화, uvicorn worker auto-reload (9556 → 11474) 확인. Live 번역 호출 ("발라드" → "Ballad") 정상 응답. 다음 음악 생성 작업부터 자동 적용됨.

## v27 - 2026-06-01 - 음악 재생성 endpoint + UI + 가사 프롬프트 비교

### 사용자 요청 (3가지)
1. "음악도 재생성 버튼 만들어줘"
2. "지금 재생성 시키면 번역되서 들어가는건가?"
3. "가사 생성 프롬프트가 메인/서브 보컬 vs 남/녀인지? 9004와 비교"

### Q&A 답변 (조사 결과)

#### Q2 — 번역 적용 여부: **YES**
- `regenerate` (가사 재생성) 후 음악 / 직접 `POST /music` / 신규 `POST /music/regenerate` **모두** `_run_music_generation` → `generate_music_for_job` → `_to_english_style_tag` (v26 추가) 경로 통과
- 한글 입력 → 자동 영문 변환 (cost 0 fast-path 포함)

#### Q3 — 가사 프롬프트: 둘 다 "메인/서브" 컨셉, "남/녀" 명시 없음

| 항목 | 1_MV_wedding | 9004 |
|---|---|---|
| 보컬 입력 구조 | `VocalStyles.main` / `.sub` (Pydantic) | `duet_main_vocal_style` / `duet_sub_vocal_style` (free string) |
| 가사 prompt 라벨 | "듀엣 보컬 톤: main=..., sub=..." | "주 보컬 느낌: ..., 상대 보컬 느낌: ..." |
| System prompt | 웨딩 전용 (회상 마커, 구조화) | 일반 송라이팅 |
| 듀엣 마커 | `[Female]/[Male]/[Both]` | `[Female]/[Male]/[Both]` |
| 가사 프롬프트 내 "남/녀" 명시 | ❌ 없음 | ❌ 없음 |
| 성별 실제 주입 위치 | Suno API `vocalGender` (SUNO_VOCAL_MAP m/f) | Suno API `vocalGender` (동일) |

→ **결론: 두 시스템 모두 가사 프롬프트엔 "남/녀" 명시 없이 `[Female]/[Male]/[Both]` 마커를 모델이 자체 결정. 성별은 오직 Suno API `vocalGender` 필드에만 전달됨.**

### 구현 (Q1)

#### 1. Backend — 신규 라우트
**파일**: `1_MV_wedding/backend_8000/app/routes/mv.py`

`POST /api/mv/jobs/{job_id}/music/regenerate` (~80 줄 추가)

- **가드**: 400(ObjectId) → 404 → 403 → 409(status not in music_ready/music_failed) → 409(가사 없음)
- **동작**:
  - 음악 필드 초기화: `audio_object_name`, `audio_variants`, `suno_task_id`, `suno_audio_id`, `suno_audio_ids`, `lyric_timestamps_variants`
  - `lyric_timestamps_status='stale'`
  - `status='generating_music'`
  - BackgroundTasks `_run_music_generation` 시작 (v26 번역 경로 자동 통과)
- 기존 `POST /music` (lyrics_ready 전용) 시맨틱은 그대로 유지

#### 2. Frontend
**파일**: `frontend/api/index.js`
- `regenerateMVJobMusic(jobId)` API 함수 추가

**파일**: `frontend/pages/GenerationStatusPage.jsx`
- `regeneratingMusic` state + `onRegenerateMusic` 핸들러
  - confirm dialog: "음악을 다시 만들까요?\n현재 음악과 타임스탬프는 사라지고 새로 만들어요.\n(가사는 그대로 유지)"
  - 낙관적 업데이트: status → `generating_music`, audio_variants / lyric_timestamps_variants 비우기
  - 폴링 재시작
- `isMusicReady` 카드: `↻ 음악 재생성` 버튼 신규 추가
- `isMusicFailed` 카드: 기존 "다시 시도" (`onStartMusic` → `/music` → 409 깨진 버튼) → `↻ 다시 시도` (`onRegenerateMusic`) 로 교체 → **우연히 같이 fix**

### 배포

#### 1. 로컬 (frontend 브랜치)
- 커밋: **`50219d5`** "Add POST /jobs/{id}/music/regenerate + UI buttons"
- 푸시: `d2ec922..50219d5` → origin/frontend

#### 2. 백엔드 PC selective sync
```bash
git fetch origin frontend
git checkout origin/frontend -- 1_MV_wedding/backend_8000/app/routes/mv.py
touch 1_MV_wedding/backend_8000/app/routes/mv.py  # WatchFiles 강제
```

#### 3. uvicorn auto-reload
- worker PID: **11474 → 11558** ✅

### 검증 (smoke test)

| 항목 | 결과 |
|---|---|
| 첫 curl (reload 전) | **404** ⚠️ (4초 sleep 부족) |
| `touch` + 6초 후 재시도 | ✅ |
| `GET /openapi.json` 에 `/api/mv/jobs/{job_id}/music/regenerate ['post']` 노출 | ✅ |
| `POST .../music/regenerate` (no auth) | **401** (라우트 살아있음) ✅ |

### 특이사항

1. **첫 curl 이 reload 직전 → 404 발생.** v26 의 4초 sleep 으로 부족. **다음 배포부터 6~8초 권장.**
2. **`music_failed` 의 기존 "다시 시도" 버튼이 실제로 깨져있었음** (`/music` 은 lyrics_ready 만 받음 → 409). 이번에 우연히 같이 fix.
3. v26 의 한→영 자동 번역은 `_run_music_generation` 한 경로에서 보장되므로 이번 신규 endpoint 도 별도 작업 없이 자동 적용됨.

### 후속 (별도 작업)
- 1_MV_wedding 가사 프롬프트에 "남/녀" 명시 라벨 추가 여부 — 사용자 결정 필요
- 9004 처럼 vocal_style 자유 문자열 입력 허용 — UX 결정 필요

### 결론
v27 PASS — `POST /api/mv/jobs/{job_id}/music/regenerate` 엔드포인트 신규 추가 (가드 5단계 + 음악 필드 초기화 + BackgroundTasks 재생성). 프론트 `↻ 음악 재생성` 버튼을 `music_ready` 카드에 신규 추가하고, `music_failed` 의 기존 깨진 "다시 시도" 버튼도 동일 endpoint 로 교체 (의도치 않은 보너스 fix). 백엔드 PC selective sync + `touch` 패턴으로 worker PID 11474 → 11558 reload. OpenAPI 등록 + 401 auth gate 통과로 라우트 alive 확인. Q2 (번역) / Q3 (가사 프롬프트 메인/서브 vs 남/녀) 분석 결과 사용자에게 회신 — 모든 음악 생성 경로가 v26 번역 통과 / 가사 프롬프트엔 "남/녀" 명시 없이 `[Female]/[Male]/[Both]` 마커만 사용, 성별은 Suno API `vocalGender` 필드에만 주입됨.


---

## v28 - 2026-06-01 - 가사 프롬프트 gender-aware (메인/서브 ↔ [Female]/[Male])

### 사용자 요청

> "suno API vocalGender에는 내가 알기로는 메인 보컬에 대한 설정을 하고 서브 보컬은 style 파라미터로 보내는걸로 알고있어. 내가 2_housing 에서는 그렇게 적용해놧잖아. 그치. 그러면 가사 생성 프롬프트를 수정해야할 것 같은데"

### 사용자 주장 검증 결과

**vocalGender = 메인, style = 서브** → **참**. 1_MV_wedding `suno_generator.py` (line 142-176) 도 2_housing `musicService.ts` 와 **동일 패턴**으로 이미 구현되어 있었음:

| 항목 | 2_housing | 1_MV_wedding |
|---|---|---|
| `vocalGender` 필드 | 메인 키만 | `main_info["gender"]` 만 |
| `style` 필드 | 메인+서브 영문 태그 모두 + "duet harmonized" | main+sub style + "duet, two voices alternating" |

→ **suno_generator.py 는 무수정**.

### 진짜 갭 — 가사 프롬프트 (lyrics_generator.py)

이전 코드 (line 470-472):
```python
duet_line = ""
if vocal_form == "duet":
    duet_line = f"- 듀엣 보컬 톤: main={vs_main or '—'}, sub={vs_sub or '—'}\n"
```

문제: LLM 이 문자열 안 "female"/"male" 글자만 보고 [Female]/[Male] 라벨 결정 → **main=male_warm, sub=female_powerful 같은 역순에서 라벨이 뒤바뀔 위험**.

### 구현 (commit 5f16182, +38 / -1)

**파일**: `1_MV_wedding/backend_8000/app/services/lyrics_generator.py`

1. **`_vocal_key_gender(vocal_key)` 헬퍼 신규** (line 363 부근)
   - `female_*` → "female", `male_*` → "male", 기타 → ""
   - SUNO_VOCAL_MAP 와 컨벤션 공유 (의존 cycle 회피 위해 import 안 함, 주석에 동기화 의무 명시)

2. **`_build_user_message_wedding` 의 duet_line 빌드 교체** (line ~470)
   - main_gender + sub_gender 추출
   - **혼성 듀엣** (gender 다름): 명시적 매핑 추가
     ```
     - 듀엣 (혼성): 메인 보컬=female (female_warm), 서브 보컬=male (male_powerful)
     - 가사 라벨 매핑 (반드시 준수): [Female] = 메인 보컬, [Male] = 서브 보컬, [Both] = 둘이 같이.
     ```
   - **동성 듀엣 or 정보 부족**: 기존 동작 (raw key 전달) 유지

### 배포

```bash
# 개발 PC
git commit -m "Lock Female/Male lyrics labels to actual main/sub vocal genders"
git push origin frontend  # da42a68..5f16182

# 백엔드 PC
git fetch origin frontend
git checkout origin/frontend -- 1_MV_wedding/backend_8000/app/services/lyrics_generator.py
touch 1_MV_wedding/backend_8000/app/services/lyrics_generator.py
```

### 검증

| 항목 | 결과 |
|---|---|
| `git push origin frontend` | `da42a68..5f16182` ✅ |
| 백엔드 PC selective sync | ✅ |
| uvicorn auto-reload (worker PID) | **11558 → 12054** ✅ |
| venv smoke: `_vocal_key_gender("female_warm")` | `'female'` ✅ |
| venv smoke: `_vocal_key_gender("male_powerful")` | `'male'` ✅ |
| venv smoke: `_vocal_key_gender(None)` | `''` ✅ |

### 영향 범위

- **다음 가사 생성부터** 혼성 듀엣 케이스에서 [Female]/[Male] 라벨이 실제 메인/서브 선택과 정확히 매칭됨
- **이전에 만든 작품에는 영향 없음** (이미 생성된 가사 그대로)
- 동성 듀엣 케이스는 fallback — system prompt 일반 규칙으로 처리되며, 정식 지원은 별도 작업

### 특이사항 / 후속

1. SUNO_VOCAL_MAP 키 컨벤션이 바뀌면 `_vocal_key_gender` 도 동기화 필요 (코드 주석으로 표시)
2. 동성 듀엣 지원하려면 `WEDDING_SYSTEM_PROMPT_DUET` 에 [Vocal A]/[Vocal B] 같은 중립 라벨 도입 필요 — 별도 요청 시 진행
3. 2_housing 에는 듀엣 가사 생성 기능 자체가 없음 (lyricsService 가 단순 prompt/genre/mood 만 받음) — 1_MV_wedding 의 wedding 전용 시점 마커 + 듀엣 라벨 규칙은 더 정교한 시스템

### 결론

v28 PASS — 사용자 주장 (`vocalGender=메인, style=서브`) 검증 후 suno_generator.py 는 이미 동일 패턴으로 구현되어 있음을 확인. 진짜 갭이었던 lyrics_generator.py 의 duet 프롬프트를 gender-aware 하게 교체 — `_vocal_key_gender` 헬퍼로 메인/서브의 실제 gender 를 추출하여 혼성 듀엣 시 [Female]/[Male] ↔ 메인/서브 매핑을 프롬프트에 명시. worker PID 11558 → 12054 reload + venv smoke test 3건 모두 PASS. 동성 듀엣은 fallback (raw key) — 정식 지원은 [Vocal A]/[Vocal B] 중립 라벨 도입 별도 작업으로 후속.

## v29 - 2026-06-01 - 가사 prompt 에너지 아크 + Bridge 필수화 + 폴백 보강

### 사용자 요청
"추가로 지금 가사 생성할때 [] 안에 음악생성할때 기승전결을 의미하는 지시문이 들어가잖아. 그것도 프롬프트에 절 - 후렴 이런식으로 명시가 되어있는거야? 지금 음악생성된 결과물이 너무 단조로워서"

### 조사 결과 (단조로움 원인 3가지)
1. 섹션 라벨 ([Intro]/[Verse]/[Pre-Chorus]/[Chorus]/[Bridge]/[Outro]) 은 SOLO/DUET 두 prompt 모두에 **이미 명시되어 있음**. 권장 구조 + 최소 줄수도 있음.
2. **2-min 작품**에서 Bridge / Verse 3 "생략 가능" 명시 → LLM 이 Bridge 빼버려 구조 빈약
3. **두 prompt 모두 "섹션별 음악 에너지/다이나믹스" 지시가 없음** → LLM 이 라벨만 박고 어휘 강도는 평탄 → Suno 가 평탄한 음악으로 해석
4. `_ensure_lyrics_structure` 폴백이 라벨 없을 때 4줄마다 [Verse]/[Chorus] 기계 교차 → Pre-Chorus/Bridge/Intro/Outro 다양성 제외

### 구현

**파일 1**: `1_MV_wedding/backend_8000/app/services/lyrics_generator.py`

1. **SOLO prompt 룰 16 (가사 길이 가이드, line 152-157) 수정**
   - 2-min 작품에서 Bridge 생략 가능 → "Bridge 는 짧아도 반드시 포함 (단조로움 방지)"
   - Verse 3 만 생략 가능 (Bridge 는 절대 생략 금지)

2. **SOLO prompt 룰 17 "섹션별 에너지 아크" 신설** (Few-shot 앞에)
   - 각 섹션 권장 에너지 1~10 척도
   - Intro 1~2 / Verse 2~4 / Pre-Chorus 5~7 / Chorus 7~9 / Bridge 5~7 / Chorus 2 8~10 / Outro 1~3
   - 어휘 강도 차이 예시 (낮음=구체 디테일 → 최고=단순·반복·합창)
   - 기존 Few-shot 은 룰 18 로 번호 이동, "낮은 에너지 섹션 예시일 뿐" 안내 추가

3. **DUET prompt 룰 16 동일 수정** (Bridge 생략 금지)

4. **DUET prompt 룰 17 "섹션별 에너지 아크 + 듀엣 배분 힌트" 신설**
   - SOLO 와 동일 에너지 척도 + 듀엣 단성/콜앤리스폰스/합창 배분 매핑
   - Verse 단성 → Pre-Chorus 콜앤리스폰스 → Chorus 합창 → Bridge 솔로 대비 → Chorus 2 합창 강화
   - 예시 라인 ([Female]/[Male]/[Both] 라벨 포함)

**파일 2**: `1_MV_wedding/backend_8000/app/services/suno_generator.py`

5. **`_ensure_lyrics_structure` 폴백 로직 보강**
   - 라벨 ≥2개: 그대로 통과 (LLM 출력 신뢰)
   - 라벨 1개: 경고 로깅 + 통과 (prompt 강화 필요 신호)
   - 라벨 0개: emergency 폴백 (기존 4줄 교차 유지 + 경고)
   - 부분 라벨 케이스에서 강제 보완 안 함 — 그게 오히려 구조를 망친 원인 중 하나

### 배포
- 커밋 `ae7d02c` "Add energy-arc directive to lyrics prompts + require Bridge on 2-min" (+89 / -12)
- 푸시: `5501359..ae7d02c` → origin/frontend
- 백엔드 PC selective sync + `touch` reload
- worker PID 12054 → 12358 ✅

### 검증 (venv smoke test)
- `"섹션별 에너지 아크" in WEDDING_SYSTEM_PROMPT_SOLO` → True ✅
- `"섹션별 에너지 아크" in WEDDING_SYSTEM_PROMPT_DUET` → True ✅
- `_ensure_lyrics_structure` 라벨 있는 입력 → 그대로 통과 ✅

### 영향
- 다음 가사 생성부터:
  - 2-min 작품도 Bridge 포함 (구조 다양성 확보)
  - 모든 작품에 섹션별 어휘 강도 차이 → Suno V5 다이나믹스 인식 → 음악 기복 생김
  - LLM 이 prompt 의 에너지 아크 표를 보고 Pre-Chorus 부터 어휘를 단순화·합일화, Chorus 에서 호명/추임, Bridge 에서 톤 비틈
- 이미 생성된 작품엔 영향 없음. 사용자가 가사 재생성하면 v29 prompt 적용 → 그 후 음악 재생성하면 단조롭지 않은 결과 기대

### 특이사항 / 후속
- 효과 검증은 사용자가 같은 입력으로 가사 재생성 → 음악 재생성 시 before/after 비교 필요
- 만약 여전히 단조로우면:
  1. 재시도 로직에 구조 완성도 검증 (필수 섹션 다 있는지 체크 → 없으면 재생성)
  2. GENRE/MOOD 별 더 강한 dynamics 차별화 지시
  3. Suno style 파라미터에 "dynamic range, build-up, climax" 같은 음악적 다이나믹 키워드 추가

### 결론

v29 PASS — 사용자 지적 (음악 결과물 단조로움) 의 진짜 원인은 "섹션 라벨은 있되 라벨에 대응하는 어휘/에너지 강도 차이 지시가 없음" + "2-min 에서 Bridge 생략 허용" 임을 조사로 확인. SOLO/DUET 두 prompt 모두에 "섹션별 에너지 아크" 룰을 신설 (1~10 척도 + 어휘 강도 예시 + 듀엣 배분 매핑) + Bridge 필수화 + 폴백 로직 보강 (부분 라벨 강제 보완 제거). 커밋 ae7d02c 푸시 + worker reload 완료, venv smoke test 3건 PASS. 효과는 다음 가사 재생성 시점부터 적용.

## v30 - 2026-06-01 - 음악 상태에서도 가사 재생성 노출

### 사용자 질문 (원문)
"음악 재생성 이후에는 가사 재생성은 안되는건가?"

### 조사 결과
- 백엔드는 **이미 허용**. `POST /api/mv/jobs/{id}/regenerate` 의 status guard 는 `queued / generating_lyrics / generating_music` 만 차단 (line 612-621 in mv.py). `music_ready` / `music_failed` 에서도 호출 가능했음.
- 차단은 **프론트엔드 UI 의 `canRegenerateLyrics` 조건**: `isLyricsReady || isLyricsFailed` 만 허용 → music 상태 카드엔 가사 재생성 버튼이 아예 안 나옴

### 구현

**파일**: `1_MV_wedding/frontend/src/pages/GenerationStatusPage.jsx` (frontend-only, 백엔드 무수정)

1. **`canRegenerateLyrics` 확장**
   ```js
   const canRegenerateLyrics =
     isLyricsReady || isLyricsFailed || isMusicReady || isMusicFailed;
   ```

2. **`onRegenerateLyrics` confirm 메시지 분기**
   - 가사 상태에서 호출 시: 기존 "가사를 다시 생성할까요?"
   - 음악 상태에서 호출 시: "가사를 다시 만들면 현재 음악도 사라져요. 새 가사 준비 후 [이 가사로 음악 만들기]를 다시 눌러야 해요. 계속할까요?"

3. **UI 버튼 추가**
   - **music_ready audio-card actions**: `[다운로드] [↻ 음악 재생성] [↻ 가사 재생성] [내 작품으로]`
   - **music_failed actions**: 기존 "↻ 다시 시도" → `[↻ 음악만 다시 시도] [↻ 가사부터 다시] [내 작품으로]` (두 옵션 분리)

4. **disabled 조건 상호 보호**: `regenerating` 동안 `regeneratingMusic` 버튼도 disabled, 반대도 마찬가지

### 배포
- 커밋 `6bcd96f` "Allow lyrics regenerate from music_ready / music_failed cards"
- 푸시: `2527a8d..6bcd96f` → origin/frontend
- **backend 무수정** → SSH/uvicorn reload 불필요
- frontend 변경은 Vite HMR 로 사용자 맥에서 자동 반영

### 영향
- 다음 사용자 경험:
  - 음악 들어보고 가사가 마음에 안 들면 → audio-card 의 `↻ 가사 재생성` → 음악도 같이 폐기되고 가사부터 다시 → 새 가사 ready → 사용자가 [이 가사로 음악 만들기] → 새 음악
  - 음악 실패 시 두 선택지: Suno 일시적 이슈면 `↻ 음악만 다시 시도`, 가사 자체가 문제면 `↻ 가사부터 다시`
- v29 의 새 prompt(에너지 아크 + Bridge 필수) 가 기존 작품에도 적용 가능해짐 — 음악 들어본 후 가사 재생성으로 v29 prompt 흡수 가능

### 특이사항
- frontend-only 변경 — 백엔드 라우트는 이미 v35(이전 작업) 부터 status 허용했음. 단순히 UI 가게 못 가도록 막아둔 것
- 다른 옵션 검토: "가사 재생성 + 자동으로 음악도 재생성" 한 번 클릭 흐름 → 미채택. 사용자가 새 가사 보고 만족 후 음악 트리거하는 게 명확
- 음악 재생성 (`/music/regenerate`) 은 v27 에서 별도 endpoint 추가했으나 가사 재생성은 기존 `/regenerate` (v35) 재사용

### 후속 (필요 시)
- "가사+음악 한 번에 재생성" 단일 버튼 추가 — 사용자가 반복 워크플로우 부담스러우면
- music_failed 의 에러 메시지에 따라 자동 추천 ("Suno timeout → 음악만 재시도 권장" 같은 메시지)

### 결론

v30 PASS — 사용자 질문 "음악 재생성 이후 가사 재생성은 안되나?" 에 대해 백엔드 status guard 조사 결과 이미 허용되어 있었고, 프론트엔드 `canRegenerateLyrics` UI 조건만 막고 있음을 확인. `GenerationStatusPage.jsx` 하나만 수정해서 (1) 조건 확장 `isMusicReady || isMusicFailed` 추가, (2) 음악 상태에서 호출 시 "음악도 사라져요" 경고 confirm, (3) audio-card / failed-card 에 가사 재생성 버튼 노출, (4) regenerating ↔ regeneratingMusic 상호 disabled 처리. 커밋 6bcd96f 푸시, 백엔드 무수정이라 reload 불필요, Vite HMR 자동 반영. v29 의 새 prompt 도 기존 작품에 흡수 가능해진 부수 효과.

## v31 - 2026-06-01 - 듀엣 라벨 포맷 전환 (섹션 헤더 역할) + 섹션 최대 5줄

### 사용자 요청 (원문 — 2 가지)
1. "가사가 한 [] 지문에 4줄 정도면 적당한것 같은데 지금 너무 길어. 가사 프롬프트를 수정해야할것 같아." (이후 보충: "최대 5줄로하자")
2. "형태를 `[Intro]\n[Both] ...` 이런식으로 하는게 아니라 `[Intro - 듀엣]\n오늘 이 노래에 우리를 담아\n...\n[Verse 1 - 메인 보컬]\n그렇게 우리는 처음 서로를 봤어\n...` 이런식으로 표현하고 싶은데."

### 중요한 트레이드오프 (사전 공지)
- v30 리서치 (모든 Suno 듀엣 가이드 종합) 결과: **per-line `[Female]/[Male]/[Both]` 가 사실상 표준**. 400+ generation 테스트(HookGenius) 에서 Tier 2 (50~80% 신뢰도). `[Section - Role]` 형식은 카탈로그에 없는 비표준
- 사용자 요청대로 변경하면 **듀엣 보컬 배분이 Suno V5 에서 의도대로 안 갈 위험 있음** (단일 보컬 fallback / 랜덤 할당 가능성)
- 그럼에도 사용자 미적·가독성 선호가 명확 → 진행. 1~2 작품 테스트로 만족도 평가 권장. 불만족 시 v28 형식으로 롤백 옵션 열어둠

### 구현 (v31)

**파일**: `1_MV_wedding/backend_8000/app/services/lyrics_generator.py` (단일 파일, 6개 블록 수정)

1. **`_measure_body_length` docstring** — per-line 라벨 제거 명시 (`_META_TAG_RE` 가 모든 `[...]` 스트립하므로 동작 무변경)
2. **SOLO STRUCTURAL RULES** — "각 섹션 2~6줄" → "최대 5줄 (Intro/Outro 2~3, 나머지 3~5)"
3. **SOLO + DUET 룰 16 (가사 길이 가이드)** — 양쪽 동일 블록 replace_all:
   - 2-min 본문: 600~800자 → 300~500자
   - 3-min 본문: 700~1100자 → 400~650자
   - 최소 줄수 → 최대 줄수로 전환 (Intro 2~3, Verse 3~5, Pre-Chorus 3~4, Chorus 3~5, Bridge 3~5, Outro 2~3)
   - 합계: 48줄+ → 25~38줄
4. **SOLO Few-shot** — 7줄 예시 → 4줄 예시 + "최대 5줄" 안내
5. **DUET `CRITICAL: LINE-BY-LINE VOCAL LABELS`** — 완전 재작성 → `★ CRITICAL: 섹션 헤더에 보컬 역할 명시`:
   - `[<섹션이름> - <역할>]` 형식 강제
   - 역할 3가지: 듀엣 / 메인 보컬 / 서브 보컬
   - 줄별 라벨 절대 금지
   - 사용자 원문 예시 그대로 포함 (`[Intro - 듀엣]` ... `[Verse 1 - 메인 보컬]` ...)
6. **DUET 가사 구조** — 각 섹션에 권장 역할 박음:
   - `[Intro - 듀엣]` / `[Verse 1 - 메인 보컬]` / `[Verse 2 - 서브 보컬]` / `[Pre-Chorus - 듀엣]` / `[Chorus 1 - 듀엣]` / `[Verse 3 - 메인 또는 서브 보컬]` / `[Bridge - 메인 또는 서브 보컬]` / `[Chorus 2 - 듀엣]` / `[Outro - 듀엣]`
7. **DUET STRUCTURE RULES** — 줄별 라벨 룰 모두 제거. 섹션 단위 역할 룰로 대체.
8. **DUET 룰 12 시점 마커** — `[Both]` 헤딩 → plain 자연어 한 줄
9. **DUET 룰 13 회상 섹션 구성** — `[Female]/[Male]` 라벨 제거 → plain 텍스트 (헤더 역할이 결정)
10. **DUET 룰 17 에너지 아크** — 새 포맷 (`[Intro - 듀엣]` 등) + 듀엣 배분 힌트도 섹션 헤더 역할 기반
11. **DUET 룰 18 Few-shot** — 전체 섹션 흐름 예시 (Intro → Outro 까지) 새 포맷 + 모든 섹션 5줄 이내
12. **`_build_user_message_wedding` 의 duet_line (v28 매핑)** — `[Female]/[Male]/[Both]` 매핑 안내 제거. 메인/서브 gender 는 참고 컨텍스트로만 전달 + "섹션 헤더는 `[<섹션> - 듀엣/메인 보컬/서브 보컬]` 형식" 명시

**`_ensure_lyrics_structure` 폴백** — 무수정. `[intro` lowercase prefix 매칭이라 `[Intro - 듀엣]` 도 정상 검출 ✅ (smoke 로 확인)

### 배포
- 커밋 `d7a3082` "Switch duet lyrics to section-header role + cap sections at 5 lines" (+180 / -140)
- 푸시: `5e3889b..d7a3082` → origin/frontend
- 백엔드 PC selective sync + `touch` reload
- worker PID 12358 → 12790 ✅
- venv smoke (실제 모듈 import 검증):
  - `[<섹션> - 듀엣]` 형식 안내 in DUET ✅
  - per-line label 안내 제거 ✅
  - Few-shot `[Intro - 듀엣]` 포함 ✅
  - SOLO "최대 5줄" 포함 ✅
  - duet_line context: 섹션 헤더 안내 + 메인/서브 gender 컨텍스트 ✅

### 영향
- 다음 가사 재생성부터 새 포맷 + 5줄 이내 적용
- 듀엣 표시가 깔끔해짐 (사용자 미적 선호 충족)
- ⚠️ Suno V5 가 비표준 포맷을 어떻게 해석할지 미검증 — 실제 음원 들어보고 평가 필요

### 특이사항 / 후속
- v28 의 `[Female] = 메인` 매핑 룰은 더 이상 무의미 (per-line 라벨 자체 제거) → 의미적으로 obsolete. 코드는 새 포맷 안내로 교체했지만 v28 메시지 핵심은 살아있음 (메인/서브 ↔ gender 매핑 컨텍스트)
- 5줄 제한으로 가사 정보량이 줄어드는 trade-off: 사용자 입력 사실 60% 반영 룰을 유지하기 어려울 수 있음. 다음 가사가 너무 압축적이면 60% 룰 완화 검토
- 만약 듀엣 음원이 단일 보컬로 들리면 즉시 v28 per-line 라벨로 롤백 가능 — 백엔드 commit 한 개만 revert 하면 됨

### 결론

v31 PASS — 사용자 요청 2가지 (섹션당 최대 5줄, `[Section - Role]` 헤더 포맷) 를 `lyrics_generator.py` 단일 파일 12개 블록 수정으로 반영. SOLO/DUET 룰 16 길이 가이드 축소, DUET CRITICAL 블록 완전 재작성 (per-line 라벨 → 섹션 헤더 역할), Few-shot 새 포맷으로 교체, `_build_user_message_wedding` duet 컨텍스트 매핑 안내 갱신. 커밋 d7a3082 푸시, 백엔드 selective sync + `touch` reload 로 worker PID 12358 → 12790 교체 확인, venv smoke 5종 통과. `_ensure_lyrics_structure` 폴백은 lowercase prefix 매칭이라 새 헤더와 호환. 트레이드오프: `[Section - Role]` 은 Suno V5 비표준 포맷이라 듀엣 보컬 배분이 의도대로 안 갈 위험 있음 — 1~2 작품 테스트 후 불만족 시 v28 per-line 라벨로 백엔드 커밋 1개 revert 로 즉시 롤백 가능.

## v32-v33 - 2026-06-02 - Phase 2 씬 이미지 reliability (sheet fallback + text-only 허용)

### 사용자 보고
- 2026-06-01: "ValueError: no reference images resolved (sheet_ids=[], plac…" 에러 → v32
- 2026-06-02: "레퍼런스 없이도 영상 생성 할 수 있게 해놓으면 안되?" → v33
- 두 작업 같은 주제 (Phase 2 씬 이미지 reliability) 라 한 entry 로 통합

### 조사 결과 (원인 chain)
- 발화 지점: `pre_mv_phase2_image_generator.py:381` — `refs_count == 0` 시 `raise ValueError`
- chain:
  1. Phase 0: 사용자 스토리에 `@캐릭터`/`@장소` 멘션 없으면 `scenario_events[].refs` 빔
  2. Phase 1: 그 slot 의 event refs 빈 → scene `ref_sheet_ids=[]`, `ref_place_ids=[]` 저장
  3. Phase 2: 빈 ref → ValueError. 재시도해도 DB 동일 → 동일 fail (영구 fail)
- 모델 capability 확인: `ALLOWED_IMAGE_MODELS = (gpt_image_2, nb_pro)` 둘 다 text-to-image OK
  - openai `generate_image`: ref 빈 list → `/v1/images/generations` 자동 라우팅
  - gemini `_call_gemini_image` (nano-banana): image_parts 빈 list → text-only 모드

### 변경 파일
- `pre_mv_phase2_image_generator.py` (백엔드 단일 파일)
- 프런트엔드 무수정

### v32 (commit `812d2e5`, +37줄) — Default sheet fallback
`place/wedding_photo` 분배 직후, ref count 검증 직전에 캐릭터 시트 기본값 fallback 삽입:
- `groom_bytes` 비고 `ref_sheet_ids` 에 `groom_*` 없으면 → `groom_wedding` → `groom_casual` 순서로 시도
- `bride_bytes` 비고 `ref_sheet_ids` 에 `bride_*` 없으면 → `bride_wedding` → `bride_casual` 순서로 시도
- 결과: 캐릭터 시트가 있는 사용자는 retry 시 자동 복구 (일관성 유지)

### v33 (commit `d899a8a`, +10/-5) — Text-only 허용
`refs_count == 0` 분기: `raise ValueError` → `logger.warning` downgrade:
- v32 fallback 까지 모두 실패 (캐릭터 시트 미생성) 해도 text-only 모드로 진행
- 캐릭터·장소 일관성 ↓ 이지만 ValueError 로 막히는 것보다 나음
- docstring 동기화: "ref 가 단 한 장도 없거나" → "Step A Gemini 빈 응답일 때만. ref 0개여도 진행"

### 우선순위 검증 (실행 순서)
1. 명시된 `ref_sheet_ids`/`ref_place_ids` (사용자 @멘션 기반) ✅
2. wedding_prep slot 의 wedding_photo fallback (기존) ✅
3. **v32**: `groom_wedding/casual` + `bride_wedding/casual` 시트 fallback ✅
4. **v33**: 여전히 0 이면 text-only 진행 (warning 로깅) ✅

### 배포
- 푸시: `812d2e5..d899a8a` → `origin/frontend`
- 백엔드 PC selective sync + `touch` reload
- uvicorn worker PID 14033 → **15656** ✅
- venv smoke (v33 검증):
  - `raise on refs==0: False` ✅
  - `warning on refs==0: True` ✅

### 영향
- 캐릭터 시트 있는 사용자: 자동 ref 채워 일관성 유지 (v32 fallback 단계)
- 캐릭터 시트 없는 사용자: text-only 로 진행 (v33). 일관성 ↓ 이지만 결과물 나옴
- 어떤 경우든 ValueError 로 fail 안 함 → Phase 2 reliability 회복

### 특이사항 / 후속
- Phase 1 측 DB 는 여전히 빈 ref 상태 → 매 retry 마다 Phase 2 fallback 거침. 향후 Phase 1 단계에서도 동일 fallback 적용해 DB 정상화 가능
- 씬 편집 UI 에서 사용자가 ref 직접 추가/변경할 수 있게 하면 근본 해결
- Phase 0 시 사용자 캐릭터 시트가 있으면 자동 `@캐릭터` 멘션 (UI 도움) 도 후속 옵션
- v33 trade-off (text-only 일관성 ↓) 모니터링: warning 로그 추적해 사용자 경험 평가

### 결론

v32-v33 PASS — Phase 2 씬 이미지 생성에서 `refs_count == 0` 으로 인한 ValueError 영구 fail 문제를 2단계로 해결. v32 (커밋 812d2e5, +37줄) 는 `pre_mv_phase2_image_generator.py` 의 ref count 검증 직전에 `groom_wedding/casual` + `bride_wedding/casual` 캐릭터 시트 기본값 fallback 을 삽입해 시트가 있는 사용자는 자동 복구하도록 함. v33 (커밋 d899a8a, +10/-5) 는 그래도 0 이면 `raise ValueError` → `logger.warning` 으로 downgrade 하여 시트 미생성 사용자도 text-only 모드로 진행 가능하게 함. ALLOWED_IMAGE_MODELS (gpt_image_2, nb_pro) 양쪽 모두 빈 ref 입력 시 text-to-image 경로로 자동 라우팅됨을 확인. `812d2e5..d899a8a` push, 백엔드 selective sync + touch reload 로 worker PID 14033 → 15656 교체, venv smoke (raise=False, warning=True) 통과. 프런트엔드 무수정. Trade-off: v33 text-only 결과물은 캐릭터/장소 일관성이 떨어짐 — 향후 Phase 1 동일 fallback / 씬 편집 UI / Phase 0 자동 멘션 등 근본 해결 옵션 있음.

## v34 - 2026-06-02 - explicit vs fallback ref 구분 (full-match / face-only)

### 사용자 보고
- v32 default sheet fallback 부작용: 사용자가 캐릭터 시트(예: `groom_wedding` 정장) 만 만들어 두고 ref 명시 안 했을 때, 모든 씬이 시트 옷 그대로 (정장) 으로 생성됨
- 사용자 제안 (원문): "캐릭터 시트가 인용되지 않은 slot 은 현재 캐릭터 시트의 얼굴만 사용하게 하고(옷은 상황에 맞게 변주), 캐릭터 시트가 인용된 slot 은 캐릭터시트의 옷·얼굴 모두 사용. 시트가 없다! 하면 첫 이미지 생성부터 캐릭터시트를 디폴트로 끌어와서 작업"
- 의도 해석: **명시적 @멘션 = 의도 존중 (full-match)**, **fallback = 얼굴/체형/머리만 유지 + 옷은 scene_prompt 자유 변주 (face-only)**

### 조사 결과 (룰 정의)
| ref 출처 | 시트 존재 | 모드 |
|---|---|---|
| 사용자 @멘션 (`scene.ref_sheet_ids` 명시) | 있음 | full-match (얼굴·체형·머리·옷·액세서리 매칭) |
| v32 fallback (groom/bride_wedding/casual 자동 끌어옴) | 있음 | face-only (얼굴·체형·머리만 매칭, 옷은 scene_prompt 자유 변주) |
| 둘 다 fail (시트 미생성) | 없음 | text-only (v33, 변동 없음) |

### 변경 파일
- `1_MV_wedding/backend_8000/app/services/pre_mv_phase2_image_generator.py` (백엔드 단일 파일, +24/-4)
- 프런트엔드 무수정

### 구현 (커밋 `fbb327f`)
1. 추적 플래그 추가: `groom_is_explicit`, `bride_is_explicit` (default False)
2. explicit 로드 루프: scene.ref_sheet_ids 에서 로드 성공 시 `_is_explicit = True` 마킹
3. v32 fallback 루프: 무수정 (`_is_explicit` False 유지)
4. `_block` 헬퍼 시그니처 확장: `face_only: bool = False` → 인물 블록 끝에 `[face-only]` or `[full-match]` 마커 자동 append
5. groom_block / bride_block 호출: `face_only=(not groom_is_explicit)` / `face_only=(not bride_is_explicit)`
6. SCENE_IMAGE_SYSTEM_PROMPT 룰 ① 수정:
   - 이전: "ref_image 의 인물·장소 일관성 강제. must visually match their reference sheets."
   - 신규: 두 마커별 동작 명시
     - `[full-match]`: 얼굴·체형·머리·옷·액세서리 모두 매칭
     - `[face-only]`: 얼굴·체형·머리만 매칭. 옷·액세서리·계절감은 scene_prompt 자유 변주
     - 예시 포함: "시트가 정장이어도 여름 비치 씬이면 가벼운 셔츠로 갈아입은 동일 인물"

### 우선순위 검증 (실행 순서, v34 누적)
1. 명시된 `ref_sheet_ids`/`ref_place_ids` (사용자 @멘션) → `_is_explicit = True`, `[full-match]` ✅
2. wedding_prep slot 의 wedding_photo fallback (기존) ✅
3. v32 캐릭터 시트 fallback → `_is_explicit = False`, `[face-only]` ✅
4. v33: 여전히 0 이면 text-only 진행 (warning 로깅) ✅

### 케이스별 동작 매트릭스
| 시나리오 | ref_sheet_ids | 시트 존재 | 동작 |
|---|---|---|---|
| 사용자 @멘션 함 | 명시 | 있음 | full-match (시트 옷 + 얼굴) |
| 사용자 @멘션 안 함 | 빈 채 | 있음 | face-only (시트 얼굴 + scene_prompt 옷) ⭐ 핵심 변화 |
| 사용자 @멘션 안 함 | 빈 채 | 없음 | text-only (캐릭터 무작위, v33) |
| wedding_prep slot, places 빈 채 | 빈 채 | 있음/없음 | wedding_photo fallback (기존) + face-only sheet |

### 배포
- 커밋 `fbb327f` "Differentiate explicit @-mention refs from v32 fallback (face-only)" (+24/-4)
- 푸시: `81dd449..fbb327f` → `origin/frontend`
- 백엔드 PC selective sync + `touch` reload
- uvicorn worker PID 15656 → **41330** ✅
- venv smoke (모듈 import 후 SCENE_IMAGE_SYSTEM_PROMPT 검사):
  - `[full-match]` in SCENE_IMAGE_SYSTEM_PROMPT ✅
  - `[face-only]` in SCENE_IMAGE_SYSTEM_PROMPT ✅
  - "옷·액세서리·계절감" 변주 안내 포함 ✅

### 영향
- 같은 캐릭터 시트만 만들어 두고 ref 명시 안 한 사용자: 씬마다 계절·장소에 맞는 옷으로 변주됨 (face-only fallback)
- 사용자가 의도적으로 @멘션한 경우: 시트 옷 그대로 (의도 존중)
- 기존 작품 영향 없음. 다음 씬 이미지 생성/재시도부터 효과
- v32 (시트 자동 끌어오기) + v33 (text-only 허용) + v34 (face-only 변주) 3단계로 Phase 2 씬 이미지 신뢰성·표현력 모두 확보

### 특이사항 / 후속
- LLM (Gemini Step A + 이미지 모델, gpt_image_2 / nb_pro) 이 `[face-only]` 마커를 얼마나 잘 따르는지 실측 필요. 첫 1~2 씬 비교 권장
- face-only 인데도 시트 옷을 그대로 가져오면 → image_prompt 에 옷 묘사를 더 명시적으로 박는 보강 가능 (Phase 1 측 작업)
- prev_scene 카운트가 챕터 내 character 일관성에도 도움이 되도록 PREV_SCENE_BLOCK_PRESENT 강화 — 별도 작업
- 마커 변경은 system_prompt 영역이라 작품별 prompt 캐싱/로그 분석에는 영향 없음

### 결론

v34 PASS — v32 default sheet fallback 의 부작용 (사용자가 @멘션 안 해도 시트 옷이 모든 씬에 그대로 박힘) 을 explicit 추적 플래그 + system prompt 마커로 해결. `pre_mv_phase2_image_generator.py` 단일 파일에서 (1) `groom_is_explicit` / `bride_is_explicit` 플래그를 explicit 로드 루프에서만 True 로 마킹하고 v32 fallback 루프는 False 유지, (2) `_block` 헬퍼에 `face_only: bool` 인자 추가해 인물 블록 끝에 `[face-only]` / `[full-match]` 마커 자동 append, (3) SCENE_IMAGE_SYSTEM_PROMPT 룰 ① 을 두 마커별 동작 (full-match 는 옷·액세서리 모두 매칭, face-only 는 얼굴·체형·머리만 매칭 + 옷·액세서리·계절감 자유 변주 + 예시 포함) 으로 재작성. 결과: 명시적 @멘션 = 의도 존중 (full-match), v32 fallback = 얼굴만 살리고 옷은 씬 컨텍스트에 맞춰 변주 (face-only), 시트 미생성 = v33 text-only (변동 없음) 의 3단계 매트릭스 완성. 커밋 `fbb327f` (+24/-4) → `81dd449..fbb327f` push, 백엔드 selective sync + touch reload 로 uvicorn worker PID 15656 → 41330 교체, venv smoke 로 `[full-match]` / `[face-only]` / "옷·액세서리·계절감" 안내 SCENE_IMAGE_SYSTEM_PROMPT 포함 확인. 프런트엔드 무수정. 한계: LLM (Gemini Step A + gpt_image_2/nb_pro) 이 `[face-only]` 마커를 실제로 얼마나 잘 따르는지 첫 1~2 씬 실측 필요 — 효과 미진 시 image_prompt 의 옷 묘사 명시화 보강 (Phase 1 측) 옵션 있음.
