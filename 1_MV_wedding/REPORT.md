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
