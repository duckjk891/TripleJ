# PLAN — Wedding MV Studio

> Team: **Wedding MV Studio Team** (planner / frontend-dev / backend-dev / tester)
> Project root: `/mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding`
> Reference: `/mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music` (frontend :4000, backend :9004)

---

## v1 — 2026-04-28 — 부트스트랩 (skeleton)

### 요청 작업
- 프론트엔드 :5000, 백엔드 :8000 으로 신규 플랫폼 부트스트랩
- 음원차트/플레이리스트/팔로우/리워드/비즈니스 등 SNS·카탈로그성 기능은 제외
- 커플의 이야기를 입력받아 → 음악 + 뮤직비디오를 생성하는 흐름

### Plan verification findings (0단계 분석 결과)
실제로 읽고 확인한 사실만 기록한다 (추정 금지).

- **Backend 패턴** (`backend_9004`):
  - `app/main.py:20-68` — `@asynccontextmanager lifespan`으로 Postgres/Mongo/Redis/MinIO 초기화. MV 잡 복구 + 차트 복구 + playcount 스케줄러 + asset cleanup 백그라운드 태스크.
  - `app/main.py:73-79` — CORS `allow_origins=["*"]`.
  - `app/main.py:81-100` — 라우터 22개 include_router. prefix는 각 라우터에서 `/api/...`.
  - `app/config.py:8-115` — pydantic-settings(BaseSettings), `.env` 파일 로드. DB 호스트/포트/계정, JWT, 외부 API 키들.
  - `app/database/postgres.py:11-28` — asyncpg.create_pool(dsn, min=2, max=20).
  - `app/database/mongodb.py:12-30` — motor AsyncIOMotorClient + `client[db_name]`.
  - `app/database/redis.py:11-27` — `aioredis.from_url(url, decode_responses=True)`.
  - `app/database/minio.py:11-19` — `Minio(endpoint, access_key, secret_key, secure=False)`.
  - `app/auth.py:13-48` — JWT(HS256) 검증 + `redis.get(f"session:{user_id}")` 이중 체크. `Authorization: Bearer ...` 헤더 또는 `?token=` 쿼리.
  - `app/routes/auth.py:14-187` — `/api/auth/{register,login,me,me/profile,logout}`. bcrypt + JWT + Redis SETEX 7일.
  - `requirements.txt` — fastapi, uvicorn, asyncpg, motor, redis[hiredis], minio, pyjwt, bcrypt, pydantic-settings, python-dotenv 등.

- **Frontend 패턴** (`frontend`):
  - `vite.config.js:6-9` — `server: { port: 4000, host: '0.0.0.0' }`.
  - `package.json:12-31` — React 19 + react-router-dom 7 + axios. (phaser/soundtouchjs는 음악플레이어 전용 → 제거 가능)
  - `src/api/index.js:3-5` — **baseURL = `${window.location.protocol}//${window.location.hostname}:9004/api`**. 모든 API 함수가 여기 한 곳에 정의됨 (팀 규약 일치).
  - `src/api/index.js:8-26` — JWT 자동 첨부 인터셉터 + 401 토큰 제거.
  - `src/contexts/AuthContext.jsx:1-72` — `localStorage('token','user')` + `api.login/register` 호출.

- **인프라 (호스트에 이미 떠 있음)**:
  - Postgres :5432, MongoDB :27017, Redis :6379, MinIO :9100/9101, ES :9200.
  - 신규 플랫폼은 **DB 이름과 MinIO 버킷만 분리**해서 같은 인스턴스 공유 (충돌 없음).

- **MV 파이프라인 엔드포인트 (참고용 — 이번 v1에선 스텁만 만든다)**:
  - `/api/mv/create`, `/api/mv/jobs`, `/api/mv/jobs/{id}`, `.../generate-images`, `.../generate-videos`, `.../concatenate`, `.../save-draft`, `.../cancel`, `.../merge-audio`
  - 씬 단위: `.../scenes/{n}/upload-image`, `.../regenerate-image`, `.../generate-video`, `.../retry-sync`, `.../separate-vocal`
  - 잡 상태: `splitting | generating_images | generating_videos | concatenating | paused`

### 사양과 코드 충돌 / 조정안
- **충돌 1**: 사용자가 처음 추천한 `9005`를 거절하고 `8000`을 선택 → 문제 없음. 다만 폴더명 컨벤션은 `backend_9001/2/3/4` 패턴이지만 이번엔 `backend_8000/`으로 통일.
- **조정 1**: 레퍼런스의 `/api/mv/create` 본문은 `scenario_style/vocal_gender/relationship`을 받는데, 웨딩 도메인은 `couple_story(텍스트) + photos[]`가 1차 입력이 돼야 한다. v1에서는 스키마만 새로 정의하고 실제 LLM 호출은 v2에서 붙인다.
- **조정 2**: 캐릭터 시트가 1인용(`/character/me`) → 웨딩은 신랑+신부 2인 일관성이 필요. v1에서는 `groom`/`bride` 두 슬롯을 가진 `couple_character` 모델 스텁만 넣고, 실제 생성기는 v2.

### 범위(Scope) — v1 (부트스트랩)
**목표**: 두 서버가 :5000 / :8000 에서 정상 부팅되고, 프론트가 백엔드 `/api/health` 와 `/api/auth/*` 를 정상 호출할 수 있는 골격.

**KEEP (레퍼런스에서 발췌·이식)**
- 백엔드 인프라 모듈: `config.py`, `database/{postgres,mongodb,redis,minio}.py`, `auth.py`(JWT 유틸)
- `app/routes/auth.py` (register/login/me/logout) — `users` 테이블 컬럼 일부 슬림
- 프론트 `AuthContext`, `api/index.js`(껍데기만 새로 작성), JWT 인터셉터

**STUB (이번 라운드는 더미 응답만)**
- `/api/story` (POST/GET) — 커플 이야기 등록/조회
- `/api/mv/jobs` (POST/GET, GET/{id}) — 잡 생성·조회 (Mongo)
- `/api/character/couple` (POST/GET) — 신랑/신부 시트 슬롯
- `/api/assets/upload` (POST) — 커플 사진 업로드 (MinIO)
- `/api/share/{token}` (GET) — 결과 공유 링크

**DROP (이식하지 않음)**
- charts, playcount_sync, chart_recovery, playlists, likes, follows, albums, artists(catalog), rewards, business, wondera, voice_persona, voice_convert, vocal_repair, kits, lalal, songs, tracks, admin(통계), MusicPlayer 글로벌 재생바, phaser/soundtouchjs 의존성

**NEW (이번 라운드엔 페이지 껍데기만)**
- 프론트 페이지: Landing / Login / Register / StoryWizard / GenerationStatus / MVPlayer / MyWeddingMV (총 7)

### 디렉토리 구조 (목표 산출물)

```
1_MV_wedding/
├─ PLAN.md
├─ REPORT.md
├─ start_dev.sh                          # 두 서버 동시 기동 헬퍼
├─ backend_8000/
│  ├─ run.sh                             # uvicorn :8000 --reload
│  ├─ requirements.txt
│  ├─ .env.example                       # 시크릿은 placeholder
│  ├─ infra/
│  │  └─ init_postgres.sql               # users 테이블 (couple용 슬림)
│  └─ app/
│     ├─ __init__.py
│     ├─ main.py                         # lifespan, CORS, 라우터 등록
│     ├─ config.py                       # pydantic-settings (DB 이름 mv_wedding)
│     ├─ auth.py                         # JWT 유틸 (이식)
│     ├─ database/
│     │  ├─ __init__.py
│     │  ├─ postgres.py
│     │  ├─ mongodb.py
│     │  ├─ redis.py
│     │  └─ minio.py
│     ├─ models/
│     │  ├─ __init__.py
│     │  └─ user.py                      # UserCreate, LoginRequest, ProfileUpdate
│     └─ routes/
│        ├─ __init__.py
│        ├─ auth.py                      # register/login/me/logout (이식·슬림)
│        ├─ story.py                     # 커플 스토리 (스텁)
│        ├─ mv.py                        # MV 잡 (스텁)
│        ├─ character.py                 # 신랑/신부 시트 (스텁)
│        ├─ assets.py                    # 사진/오디오 업로드 (스텁)
│        └─ share.py                     # 공유 링크 (스텁)
└─ frontend/
   ├─ package.json                       # axios, react, react-dom, react-router-dom
   ├─ vite.config.js                     # port 5000
   ├─ index.html
   └─ src/
      ├─ main.jsx
      ├─ App.jsx
      ├─ App.css
      ├─ index.css
      ├─ api/
      │  └─ index.js                     # baseURL :8000, wedding API 함수만
      ├─ contexts/
      │  └─ AuthContext.jsx
      ├─ components/
      │  ├─ Header.jsx
      │  └─ Footer.jsx
      └─ pages/
         ├─ LandingPage.jsx
         ├─ LoginPage.jsx
         ├─ RegisterPage.jsx
         ├─ StoryWizardPage.jsx
         ├─ GenerationStatusPage.jsx
         ├─ MVPlayerPage.jsx
         └─ MyWeddingMVPage.jsx
```

### 라우팅 (프론트)

| Path | Page | 보호 |
|---|---|---|
| `/` | LandingPage | public |
| `/login` | LoginPage | public |
| `/register` | RegisterPage | public |
| `/wizard` | StoryWizardPage | auth required |
| `/projects/:id` | GenerationStatusPage | auth required |
| `/projects/:id/play` | MVPlayerPage | auth required |
| `/my` | MyWeddingMVPage | auth required |

### REST API (백엔드, 모두 `/api` prefix)

| Method | Path | 본문/응답 | v1 동작 |
|---|---|---|---|
| GET | `/health` | `{status, timestamp}` | 실제 동작 |
| POST | `/auth/register` | `{email, password, nickname}` → `{token, user}` | 실제 동작 (Postgres) |
| POST | `/auth/login` | `{email, password}` → `{token, user}` | 실제 동작 |
| GET | `/auth/me` | → `{user}` | 실제 동작 |
| POST | `/auth/logout` | → `{message}` | 실제 동작 |
| POST | `/story` | `{title, partner_a, partner_b, story_text}` → `{story_id}` | **stub**: Mongo 저장 + id 리턴 |
| GET | `/story/{id}` | → 저장된 스토리 | **stub** |
| POST | `/mv/jobs` | `{story_id, style?}` → `{job_id, status:"queued"}` | **stub**: Mongo 저장 |
| GET | `/mv/jobs` | → 내 잡 목록 | **stub** |
| GET | `/mv/jobs/{id}` | → 잡 상세 + 진행률 | **stub**: 항상 `status:"queued", progress:0` |
| POST | `/character/couple` | `{groom:{name,...}, bride:{name,...}}` | **stub** |
| GET | `/character/couple` | 내 신랑/신부 시트 | **stub** |
| POST | `/assets/upload` | multipart file → `{object_name}` | **stub**: MinIO put_object |
| GET | `/share/{token}` | 공유 링크로 보는 MV | **stub**: 더미 페이로드 |

### 환경/포트
- Frontend dev server: `0.0.0.0:5000`
- Backend dev server: `0.0.0.0:8000`
- DB는 호스트의 기존 컨테이너 재사용:
  - Postgres :5432 — DB 이름 `mv_wedding`
  - MongoDB :27017 — DB 이름 `mv_wedding`
  - Redis :6379 — DB index `1` (레퍼런스가 `0` 사용)
  - MinIO :9100 — 버킷 `mv-wedding-photos`, `mv-wedding-audio`, `mv-wedding-videos`
- 시크릿은 `.env.example`에 placeholder만 (`YOUR_*_KEY`). 실제 키는 `.env`로 별도 관리.

### 작업 분배

**backend-dev (Phase 2A)**
1. `backend_8000/` 디렉토리 + 모든 모듈 파일 생성
2. `config.py` — DB 이름 `mv_wedding`, redis db `1`, JWT secret 별도
3. `database/*` — 레퍼런스에서 그대로 이식
4. `auth.py` + `routes/auth.py` + `models/user.py` — 슬림 버전 (company_name, display_title, profile_image, bio 컬럼은 일단 유지하되 NULLABLE)
5. `routes/{story,mv,character,assets,share}.py` — 스텁 응답 (Mongo 저장은 실제로 동작)
6. `infra/init_postgres.sql` — `users` 테이블만 (couple용)
7. `requirements.txt` — fastapi/uvicorn/asyncpg/motor/redis/minio/pyjwt/bcrypt/pydantic-settings/python-dotenv/python-multipart
8. `run.sh` — uvicorn `--port 8000 --reload`
9. `.env.example` — placeholder
10. **테스터를 위한 검증 포인트**: `curl http://localhost:8000/api/health` → 200, `/api/auth/register` → 201

**frontend-dev (Phase 2B)**
1. `frontend/` Vite 프로젝트 (npm init 없이 파일 직접 작성 — 의존성은 `npm install`로 설치)
2. `package.json`, `vite.config.js`(port 5000), `index.html`, `src/main.jsx`, `src/App.jsx`
3. `src/api/index.js` — **baseURL `${protocol}//${hostname}:8000/api`** + JWT 인터셉터. wedding API 함수만:
   - `login/register/getMe/logout/updateProfile`
   - `createStory/getStory`
   - `createMVJob/getMVJobs/getMVJob`
   - `saveCoupleCharacter/getCoupleCharacter`
   - `uploadAsset`
   - `getSharedMV`
4. `src/contexts/AuthContext.jsx` — 레퍼런스에서 가져와 `displayTitle/companyName` 인자 제거 가능 (옵션)
5. 페이지 7개: 일단 placeholder 마크업 + 라우팅만 동작하면 된다 (실제 폼 동작은 Login/Register만 진짜로)
6. `Header`/`Footer` — 단순 네비
7. 시각적 톤: 웨딩 → 화이트/베이지/장미금 톤. 글꼴은 시스템 default 유지 (v1 미니멀)

### 테스터 검증 항목 (Phase 3)

**부팅·인프라**
- [ ] `backend_8000/run.sh` 실행 시 :8000 LISTEN, 4-DB 연결 로그 출력
- [ ] `frontend npm run dev` 실행 시 :5000 LISTEN
- [ ] `curl http://localhost:8000/api/health` → `{"status":"ok"}`
- [ ] `curl http://localhost:5000` → HTML 200

**인증 골든패스**
- [ ] `POST /api/auth/register` → 201 + token
- [ ] `POST /api/auth/login` → 200 + token
- [ ] `GET /api/auth/me` (Bearer) → 200
- [ ] 잘못된 토큰 → 401/403

**스텁 라우터**
- [ ] `POST /api/story` (auth) → 200 + `story_id`
- [ ] `POST /api/mv/jobs` (auth) → 200 + `job_id, status:"queued"`
- [ ] `GET /api/mv/jobs` (auth) → 빈 배열 또는 본인 잡들
- [ ] `POST /api/assets/upload` (auth, multipart) → MinIO 버킷 자동 생성 + `object_name` 리턴

**프론트 동선 (브라우저)**
- [ ] `/` 랜딩 보임
- [ ] `/register` 폼 → 가입 후 `/wizard` 리다이렉트
- [ ] `/login` 로그인 → `/my` 리다이렉트
- [ ] 로그아웃 → `/` 리턴
- [ ] axios baseURL이 :8000을 가리키는지 (네트워크 탭 확인)
- [ ] CORS 에러 없는지

**회귀(regression) 영향 — 없음**
- 신규 디렉토리만 생성하므로 레퍼런스 프로젝트 코드는 건드리지 않는다.

### v2 (다음 라운드 — 이번엔 안 함)
- LLM 기반 가사 생성: 레퍼런스 `lyrics_generator.py` 이식 + 웨딩 프롬프트 프리셋
- Suno 음악 생성: `music_generator.py` 이식
- 씬 플래너: 커플 스토리 → 비트(beat) N개 분할 (LLM)
- 신랑/신부 캐릭터 시트: `character_generator.py` 이식 + 2인 일관성 유지 로직
- 영상 생성: Kling/Seedance 라우팅 + Sync Labs 립싱크 + 자막
- 결과 공유: 워터마크/다운로드 권한

---

## v2 — 2026-04-29 — 러브스토리 위저드 + Wedding 가사 생성

### 요청 작업
- StoryWizard 멀티스텝(5단계) UI로 교체. 입력칸마다 placeholder가 어떤 결을 원하는지 유도.
- 입력받은 러브스토리를 **Wedding 전용 시스템 프롬프트**로 가사화. 가사 안에 두 사람의 이름·사건·서약이 실제로 박혀서 결혼식 하객이 듣고 두 사람의 이야기를 따라갈 수 있어야 함.
- 음악(Suno)·MV는 다음 라운드(v3) 분리.

### Plan verification findings (0단계 분석 결과 — 현재 시점 코드 직접 확인)

**현재 1_MV_wedding/backend_8000 상태**
- `routes/story.py:19-23` — `StoryCreate(title, partner_a, partner_b, story_text)` 4필드 단순 모델. 이걸 구조화 모델로 교체해야 함.
- `routes/mv.py:36-48` — `POST /jobs`가 status="queued"로 저장만 하고 끝. bg task 없음. `MVJobCreate(story_id, style?)` 페이로드. music_spec 확장 필요.
- `routes/mv.py:24-33` `_serialize_job` — lyrics/error_message 필드 없음. 확장 필요.
- `app/services/` 디렉토리 자체가 **없음**. 신규 생성 필요.
- `models/user.py`만 있음. `models/story.py` 신규 필요.
- `requirements.txt` — openai, anthropic 미포함. 추가 필요.
- `main.py:27-54` lifespan — bg task 패턴 없음. asyncio.create_task로 가사 생성 잡 띄우는 구조 신규 도입.
- `.env`에 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` **둘 다 존재** (tester가 v1에서 레퍼런스에서 복사). 별도 키 발급 불필요.

**현재 1_MV_wedding/frontend 상태**
- `pages/StoryWizardPage.jsx:1-91` — 4필드 단일 폼. 위저드 형태로 전면 교체 필요.
- `pages/GenerationStatusPage.jsx:1-68` — status/progress만 렌더. 가사가 ready되면 가사 본문 표시하는 섹션 추가 필요.
- `api/index.js` — `createStory(data)` / `createMVJob(data)` 둘 다 페이로드 자유라 시그니처 변경 없이 데이터 형태만 풍부하게 보내면 됨. 새 함수 추가 없음. 단, `getMVJob` 응답 스키마 확장 대응만.

**레퍼런스 시그니처 재확인** (`0_platform_music/backend_9004`)
- `services/lyrics_generator.py:298-367` `generate_lyrics(prompt, genre, mood, style, duration_minutes, duet, duet_main_vocal_style, duet_sub_vocal_style, language, models=[])` — `models` 비어있으면 OpenAI 기본, 1개면 그 모델, 2개면 병렬 비교.
- `services/lyrics_generator.py:32-97` SYSTEM_PROMPT_SOLO — Suno 메타태그 + 장르/무드/구조 가이드만. 도메인 0.
- `services/lyrics_generator.py:100-155` SYSTEM_PROMPT_DUET — 라인별 [Female]/[Male]/[Both] 라벨 강제. 우리는 듀엣 모드도 동일 패턴 차용.

### 사양과 코드 충돌 / 조정안
- **충돌 1**: 현재 v1의 `POST /api/story` 4필드 페이로드가 위저드 5스텝 입력과 호환 안 됨.
  → **조정**: `StoryCreate`를 구조화 모델(`CoupleStory`)로 전면 교체. 기존 v1 페이로드는 더 이상 받지 않음(파괴적 변경 OK — 아직 production 데이터 없음).
- **충돌 2**: `POST /api/mv/jobs`가 동기적으로 끝나는데, LLM 호출은 ~15-30s. 동기로 묶으면 클라이언트 타임아웃·UX 나쁨.
  → **조정**: 잡 생성 즉시 반환(`status="generating_lyrics"`), `asyncio.create_task`로 가사 생성을 백그라운드에서 돌리고 완료 시 Mongo 문서 업데이트(`status="lyrics_ready"` + `lyrics` 필드). 프론트는 기존 5초 폴링 그대로 사용.
- **충돌 3**: `models/user.py`의 `str | None` PEP 604 문법은 Python 3.10+. 현재 venv는 pyenv 3.11 (v1 tester 확인). 새 모델도 동일 문법 사용 가능.

### 범위(Scope) — v2
**KEEP from v1**
- 인증, MinIO 자산 업로드, character/share 스텁, 5000/8000 포트, CORS `*`

**NEW Backend**
1. `app/models/story.py` — Pydantic v2 구조화 모델
   - `Partner(name: str, age: int | None)`
   - `Couple(partner_a: Partner, partner_b: Partner, endearments: list[str])`
   - `StoryDetails(meeting: str, memories: list[str], turning_points: list[str], rituals: str | None)`
   - `Vow(keywords: list[str], line: str | None)`
   - `WeddingContext(tone: str, audience_line: str | None)`
   - `MusicSpec(genre: str, moods: list[str], duration_minutes: int, vocal_form: Literal["solo","duet"], vocal_styles: VocalStyles | None, language: Literal["ko","en"], model: str | None)`
   - `VocalStyles(main: str, sub: str)` (듀엣일 때만)
   - `CoupleStory(couple, story, vow, wedding_context)`
2. `app/services/__init__.py` (빈 패키지 마커)
3. `app/services/lyrics_generator.py` — wedding 전용
   - `WEDDING_SYSTEM_PROMPT_SOLO`, `WEDDING_SYSTEM_PROMPT_DUET` 신규 작성
     - 핵심 규칙: 입력 fact 60% 이상 가사 인용, partner_a/b 이름 1회 이상 노출, "어디서 본 듯한 일반 비유"만으로 채우기 금지, verse=시간순 이야기, chorus=서약 키워드
   - `_build_user_message_wedding(story: CoupleStory, music: MusicSpec) -> str` — 구조화 섹션 ([커플 정보]/[이야기 사실]/[서약 키워드]/[결혼식 맥락]/[음악 사양]/[요구]) 포맷
   - `generate_wedding_lyrics(story, music, model=None) -> {title, body, model}` — OpenAI/Claude 분기는 레퍼런스와 동일 패턴 (model_name이 `claude-`로 시작하면 Claude, 아니면 OpenAI). 타이틀은 별도 1회 짧은 호출.
4. `app/routes/story.py` — `CoupleStory`를 받아 Mongo `stories`에 저장. 응답은 `{story_id}`. GET은 전체 문서 리턴(직렬화).
5. `app/routes/mv.py`
   - `POST /api/mv/jobs` body: `{story_id: str, music_spec: MusicSpec}`. 잡 문서 생성(status="generating_lyrics") + `asyncio.create_task(_run_lyrics(job_id))`. 즉시 `{job_id, status}` 반환.
   - `_run_lyrics(job_id)` 백그라운드 함수: story 조회 → `generate_wedding_lyrics` 호출 → Mongo `mv_jobs` 문서에 `lyrics`, `status="lyrics_ready"` 저장. 실패 시 `status="lyrics_failed"`, `error_message` 기록.
   - `GET /api/mv/jobs/{id}` — `lyrics`, `error_message`, `music_spec` 필드 추가 직렬화.
6. `requirements.txt` — `openai`, `anthropic` 추가.
7. `main.py` — 변경 없음 (CORS·라우터 그대로). 단, asyncio.create_task가 lifespan 이후에도 살아남도록 Task 핸들을 별도로 잡지 않아도 됨 (FastAPI request 컨텍스트 종료 후에도 task가 완료될 때까지 살아있음).

**NEW Frontend**
1. `src/components/StepIndicator.jsx` (+ css) — 진행 도트
2. `src/components/DynamicList.jsx` — `+ 항목 추가` 버튼이 있는 textarea 리스트 (추억·힘들었던 일에서 사용)
3. `src/components/TagInput.jsx` (+ css) — Enter로 추가되는 칩 입력 (서약 키워드·분위기에서 사용)
4. `src/pages/StoryWizardPage.jsx` (+ css) — 전면 교체. 5스텝 + 검토.
   - 페이지 안에 step state(1~6) 관리. 각 스텝 컴포넌트는 같은 파일 안 inline 또는 별도 파일.
   - 마지막 검토 단계의 "가사 생성 시작" 버튼이 `createStory(...)` → `createMVJob({story_id, music_spec})` 두 번 순차 호출. 성공시 `/projects/:job_id`로 이동.
5. `src/pages/GenerationStatusPage.jsx` (+ css) — status별 메시지 매핑(`generating_lyrics`→"가사 만드는 중...", `lyrics_ready`→가사 본문 렌더). 가사 본문은 메타태그 `[Verse]/[Chorus]/...` 그대로 표시(보존). `lyrics_failed`이면 에러 메시지 + 재시도 안내(v2엔 재시도 버튼은 없어도 됨).
6. `src/api/index.js` — 함수 시그니처 변경 없음 (페이로드 풍부하게). 응답 스키마만 늘어난 것.

**OUT OF SCOPE (v3 이후)**
- Suno 음악 생성, MV 영상 생성, 캐릭터 시트, 자막, 립싱크
- 가사 재생성 / 모델 비교 모드(병렬 2모델) — v2엔 단일 모델만
- 사진 업로드 UI

### 데이터 스키마 (v2)

```
POST /api/story
body:
{
  "couple": {
    "partner_a": {"name": "김민호", "age": 31},
    "partner_b": {"name": "이지영", "age": 29},
    "endearments": ["초코", "자기"]
  },
  "story": {
    "meeting": "2019년 봄, 회사 사이드 프로젝트 회식 자리에서...",
    "memories": ["강릉 새벽 바다 ...", "한강 망원 벤치 ..."],
    "turning_points": ["2021년 여름 6개월 떨어짐 ..."],
    "rituals": "오징어볶음=사과신호, 부암동 그 카페"
  },
  "vow": {
    "keywords": ["함께 나이 들기", "약한 날 먼저 손잡기"],
    "line": "지영아, 평생 너의 가장 가까운 친구로 살게."
  },
  "wedding_context": {
    "tone": "잔잔하다가 따뜻하게 차오르는",
    "audience_line": "우리 둘이 여기까지 온 이야기 들어주세요"
  }
}
→ 200 {"story_id": "..."}

POST /api/mv/jobs
body:
{
  "story_id": "...",
  "music_spec": {
    "genre": "발라드",
    "moods": ["따뜻한", "잔잔한"],
    "duration_minutes": 2,
    "vocal_form": "duet",
    "vocal_styles": {"main": "female_warm", "sub": "male_warm"},
    "language": "ko",
    "model": "claude-opus-4-6"   // 또는 "gpt-4o-mini" / "gpt-5.4". null이면 서버 기본
  }
}
→ 200 {"job_id": "...", "status": "generating_lyrics"}

GET /api/mv/jobs/{id}
→ 200
{
  "job_id": "...",
  "user_id": "...",
  "story_id": "...",
  "music_spec": { ... },
  "status": "generating_lyrics" | "lyrics_ready" | "lyrics_failed",
  "progress": 0 | 50 | 100,
  "lyrics": null | {"title": "...", "body": "[Intro]\n...\n[Verse]\n...", "model": "claude-opus-4-6"},
  "error_message": null | "..."
  "created_at": "...",
  "updated_at": "..."
}
```

### Wedding 시스템 프롬프트 (요지 — 실제 본문은 backend-dev가 코드에 박음)

```
당신은 결혼식에서 신랑·신부의 실제 러브스토리를 노래로 옮기는 전문 웨딩 송라이터입니다.
결과 가사는 결혼식장에서 재생되며, 하객은 가사를 들으며 두 사람이 어떻게 만나,
어떤 시간을 거쳐, 어떤 약속으로 서약에 이르렀는지를 따라갈 수 있어야 합니다.

# 절대 규칙
- 입력으로 받은 [이야기 사실] 항목 중 60% 이상을 가사에 직접 또는 은유로 반영하라.
- partner_a / partner_b 이름(또는 둘만의 호칭) 중 하나를 가사 안에 최소 1회 노출하라.
- "어디선가 본 듯한 사랑 비유"만으로 가사를 채우는 것을 금지한다.
- 둘만의 단어·장소·사건을 일반론보다 우선한다.

# 가사 구조 의미 (Suno 메타태그 호환 유지)
[Intro]    : 결혼식 분위기 환기, 만남 직전의 정서
[Verse 1]  : 만남 — 언제·어디서·어떤 계기로
[Verse 2]  : 둘만의 시간 — 의미 있던 장소/단어/추억 + 위기
[Pre-Chorus]: 분기점에서의 결심
[Chorus]   : 서약 키워드 / 현재의 사랑 — 결혼식의 핵심 메시지(반복가능)
[Bridge]   : 시점 전환 — 회중에게 또는 미래의 우리에게
[Chorus]   : 반복 (결의 강화)
[Outro]    : 결혼식 마무리, 두 사람의 새 출발

(이하 Suno 메타태그·VOCAL DIRECTION·STRUCTURAL RULES는 레퍼런스 SOLO/DUET 가이드 동일 차용)
```

### 작업 분배

**backend-dev (v2 Phase 2A)**
1. `requirements.txt`에 `openai`, `anthropic` 추가 후 `pip install`
2. `app/services/__init__.py`, `app/services/lyrics_generator.py` 신규
3. `app/models/story.py` 신규 (CoupleStory + MusicSpec)
4. `app/routes/story.py` `StoryCreate` → `CoupleStory` 교체
5. `app/routes/mv.py` 페이로드 확장 + `asyncio.create_task` bg lyrics task + 직렬화 확장
6. **셀프 검증**: import 체인, 라우터 prefix `/api/mv` `/api/story` 유지, models import 경로

**frontend-dev (v2 Phase 2B)**
1. 컴포넌트 3개 신규: `StepIndicator`, `DynamicList`, `TagInput`
2. `StoryWizardPage` 5스텝 + 검토 단계로 전면 교체
3. `GenerationStatusPage` 가사 본문 렌더 (메타태그 보존, 줄바꿈 유지)
4. `api/index.js` 변경 없음(호출 시그니처 동일, 페이로드만 풍부) — 단, 새 응답 스키마 처리 OK
5. **셀프 검증**: `fetch(` 미사용, 직접 axios import 미사용, 하드코딩 호스트/포트 미사용

### 테스터 검증 항목 (v2 Phase 3)

**A. 회귀 (v1 PASS 항목 그대로 유지)**
- [ ] /api/health 200
- [ ] register/login/me/logout 정상
- [ ] character/couple, assets/upload, share 스텁 정상

**B. v2 신규 — 백엔드**
- [ ] POST /api/story 새 페이로드 → 200 + story_id
- [ ] POST /api/story 누락 필드 → 422
- [ ] POST /api/mv/jobs 새 페이로드 → 200, status="generating_lyrics", 즉시 반환(<2s)
- [ ] 5~60초 후 GET /api/mv/jobs/{id} → status="lyrics_ready" + lyrics.body 존재
- [ ] lyrics.body에 partner_a 또는 partner_b 이름이 포함됨 (휴리스틱 검증)
- [ ] lyrics.body에 [Verse]/[Chorus] 같은 Suno 메타태그가 포함됨
- [ ] OPENAI_API_KEY 잘못됐을 때(임시로 비워서) → status="lyrics_failed", error_message 존재 (재설정 후 정상 복귀)

**C. v2 신규 — 프론트**
- [ ] /wizard 5스텝 진행 가능, "이전/다음" 동작
- [ ] 추억·힘들었던 일 동적 추가/삭제 동작
- [ ] 서약 키워드 Enter로 칩 추가 동작
- [ ] 마지막 검토 단계에서 입력 요약 표시
- [ ] "가사 생성 시작" 클릭 → /projects/:job_id 이동
- [ ] GenerationStatus가 "가사 만드는 중..." 표시 후 자동으로 가사 본문으로 전환
- [ ] 가사가 [Verse]/[Chorus] 구분 보이게 렌더됨

**D. 영향 범위 회귀**
- [ ] /api/character/couple, /api/assets/upload — 기능 영향 없음
- [ ] 프론트 Header/Footer/AuthContext — 영향 없음
- [ ] 모델 호출 실패 시 잡 문서가 무한 generating 상태로 남지 않는지 (timeout 또는 fail 전이)


---

## v2.1 — 2026-04-30 — 가사 톤 정교화 (END 마커 / 2분·3분 / 상황·심정 페어)

### 요청 작업
세 가지 변경:
1. 시점 마커 라인을 각 회상 섹션의 **마지막 줄(END)** 에 통일.
2. 곡 길이를 **2분 / 3분 양자택일**로 좁히고, 각 옵션 옆에 "약 N자" 라벨 노출.
3. 위저드의 각 시점 칸이 **상황 + 그때의 마음**을 모두 적도록 placeholder로 유도. 부정 시점(힘들었던 일·극복) 제거. 결혼식 본행사 어휘 사용 금지.

### Plan verification findings (현재 코드 직접 재확인)

**Backend** (`backend_8000/`)
- `models/story.py:22-26` — `StoryDetails(meeting, memories[], turning_points[], rituals)` 4필드. v2.1에서 8필드(상황·심정 페어)로 재정의.
- `models/story.py:54` — `MusicSpec.duration_minutes: Literal[1, 2, 3] = 2`. v2.1에서 `Literal[2, 3] = 2` 로 좁힘.
- `services/lyrics_generator.py:36-95` `WEDDING_SYSTEM_PROMPT_SOLO` — 현재 시점 마커 위치 룰 부재, "위기·전환점" 언급(line 44, 54, 83), 결혼식 본행사 어휘 미금지. 모두 v2.1에서 갱신.
- `services/lyrics_generator.py:98-...` `WEDDING_SYSTEM_PROMPT_DUET` — 동일 갱신 필요.
- `routes/story.py` — `CoupleStory` 받아 Mongo 저장. 새 스키마 자동 호환되지만 응답 직렬화는 그대로 OK.
- `routes/mv.py` — `MVJobCreate(story_id, music_spec)`, `_run_lyrics_generation` bg task. 변경 없음.

**Frontend** (`frontend/`)
- `pages/StoryWizardPage.jsx:39-68` `initialData()` — 현재 `turning_points: []`, `audience_line` 보유. 새 구조로 재정의.
- 5스텝 + 검토 6단계 위저드 골격은 유지. Step 2 / Step 5 마크업 재작성.
- `components/DynamicList.jsx`, `TagInput.jsx`, `StepIndicator.jsx` 그대로 재사용.
- 신규 컴포넌트 `SceneInput.jsx` 1개 추가 (라벨 + 상황·심정 2 textarea 페어).
- `api/index.js` — 시그니처 동일, 페이로드만 풍부. 변경 없음.

### 사양과 코드 충돌 / 조정안
- **충돌 1**: `turning_points`가 모델·라우트·위저드·시스템 프롬프트 4곳에 박혀있다. v2.1에서 4곳 모두 제거 (production 데이터 없으니 파괴적 변경 OK).
- **충돌 2**: `duration_minutes: Literal[1, 2, 3]` → `Literal[2, 3]`로 좁히면 기존 v2 페이로드(1) 거부됨. v2 데이터 없어 OK.
- **조정 1**: `wedding_context.audience_line`은 여전히 유효(Outro 또는 Bridge에서 사용 가능). 단 결혼식 본행사 어휘로 변환 금지(룰로 명시).
- **조정 2**: `lyrics_generator`의 `_build_user_message_wedding`가 새 8필드(상황·심정 페어)를 user message에 풀어 넣도록 빌더 재작성. 옵션 필드 비어있으면 해당 항목 자체 생략.

### 범위(Scope) — v2.1

**KEEP**
- v2 시스템 프롬프트의 절대 규칙 4개 (60% 인용·이름 노출·일반론 금지·구체 우선)
- 5스텝 + 검토 위저드 골격, 인증, MV 잡 폴링 플로우, GenerationStatus 가사 렌더

**CHANGE**
1. `services/lyrics_generator.py` 시스템 프롬프트 SOLO·DUET 룰 갱신
2. `models/story.py` `StoryDetails` 재정의 + `MusicSpec.duration_minutes`
3. `routes/story.py` 새 필드 직렬화
4. `routes/mv.py` `_run_lyrics_generation` `_strip_story_for_prompt` 매핑 갱신
5. `pages/StoryWizardPage.jsx` `initialData`/Step2/Step5/검토(Step6) 재구성
6. `components/SceneInput.jsx` 신규

**DROP**
- `turning_points` (모델·라우트·위저드·프롬프트 4곳)
- `duration_minutes=1` 옵션
- 결혼식 본행사 어휘(`결혼식에서`, `이 자리에서 모두 앞에`, `예식장`, `주례`, `혼인서약`)
- 부정 시점 가사화

### 시스템 프롬프트 — 새 룰셋 (v2.1)

```
1~10. (기존 v2 절대 규칙 — 60% 인용 / 이름 노출 / 일반론 금지 / 구체 우선
       / Suno 메타태그 / 섹션별 의미 / VOCAL DIRECTION / STRUCTURAL RULES / 등)

11.   가사 시간 흐름:
      [Intro] (frame, 마커 없음)
      → [Verse 1: 첫 만남]
      → [Verse 2: 첫 데이트]
      → [Pre-Chorus: 함께 쌓인 시간]
      → [Chorus 1: 그 시간들의 우리, 마커 없음]
      → [Verse 3: 결혼을 결심한 순간]
      → [Bridge: 웨딩 준비 — 드레스/촬영]
      → [Chorus 2: 두 사람의 다짐, 마커 없음]
      → [Outro: 새 페이지 여운, 마커 없음]

12.   ★ 시점 마커 라인 — END 통일
      회상 섹션(Verse 1/Verse 2/Pre-Chorus/Verse 3/Bridge)의
      마지막 줄에 시점 마커를 둔다.
      예) "그게 우리의 첫 만남이었어"
          "그날이 우리 첫 데이트였지"
          "그렇게 우리만의 시간이 쌓였어"
          "그게 우리가 함께 살기로 한 그 봄이었어"
          "그렇게 우리는 우리의 새 시작을 준비했어"
      Intro / Chorus / Outro 에는 시점 마커를 두지 않는다.
      마커 표현은 같은 곡 안에서 반복하지 마라.

13.   각 회상 섹션 권장 구성:
      [상황 라인 1~2] (시간·장소·소품 명시)
      → [행동 라인 1~2] (카메라가 찍을 수 있는 미시 동작)
      → [심정 라인 1~2] (사용자 입력 "그때의 마음"을 직접/짧게 변주 인용)
      → [시점 마커 라인 1] (END)

14.   ★ 결혼식 본행사 언급 절대 금지
      다음 어휘 사용 금지: "결혼식에서", "이 자리에서 모두 앞에", "예식장",
      "주례", "혼인서약", "오늘 이 식장에서"
      곡은 웨딩 준비(드레스 입어보기·웨딩 촬영) 단계까지에서 끝나야 한다.
      Outro는 "이제 곧 시작될 새 페이지" 정도의 여운으로 마무리한다.

15.   ★ 부정 시점 절대 금지
      위기·이별·어둠·헤어짐·갈등·극복 같은 부정 서사를 가사에 포함하지 마라.
      입력에 turning_points / hardships가 있어도 가사로 옮기지 않는다.
      결혼식용 곡은 긍정 일변도.

16.   가사 길이 가이드
      duration_minutes=2 → 본문 약 600~800자 (메타태그 제외).
        구성: Intro + Verse 1 + Verse 2 + Pre-Chorus + Chorus 1 + Chorus 2 + Outro
              (Verse 3 / Bridge 생략 또는 통합)
      duration_minutes=3 → 본문 약 1000~1400자.
        구성: 풀 8섹션 (Intro / V1 / V2 / Pre-Chorus / Chorus 1 / V3 / Bridge / Chorus 2 / Outro)

17.   user message 매핑
      [이야기 사실 — 가사에 반영해야 함]
        1) 첫 만남 — 상황: {meeting_situation} / 그때 마음: {meeting_emotion}
        2) 첫 데이트 — 상황: {first_date_situation or "—"} / 그때 마음: {first_date_emotion or "—"}
        3) 함께 쌓인 추억:
           · {memories[0]} ...
        4) 결혼을 결심한 순간 — 상황 / 마음
        5) 웨딩 준비 — 상황 / 마음
        6) 둘만의 단어·장소: {rituals or "—"}
      옵션 필드(2/4/5)가 비어 있으면 user message에서 해당 항목 자체를 생략.
```

### 데이터 스키마 (v2.1)

```
POST /api/story  body:
{
  "couple": {
    "partner_a": {"name": "...", "age": 31},
    "partner_b": {"name": "...", "age": 29},
    "endearments": ["초코", "자기"]
  },
  "story": {
    "meeting_situation": "...",          // 필수
    "meeting_emotion": "...",            // 필수
    "first_date_situation": "..." | null,
    "first_date_emotion": "..." | null,
    "memories": ["...", "..."],          // 추억 동적 리스트, 각 항목은 단일 텍스트
    "proposal_situation": "..." | null,
    "proposal_emotion": "..." | null,
    "wedding_prep_situation": "..." | null,
    "wedding_prep_emotion": "..." | null,
    "rituals": "..." | null
    // turning_points 필드 자체 제거
  },
  "vow": { "keywords": [...], "line": "..." | null },
  "wedding_context": { "tone": "...", "audience_line": "..." | null }
}

POST /api/mv/jobs  body:
{
  "story_id": "...",
  "music_spec": {
    "genre": "...",
    "moods": [...],
    "duration_minutes": 2 | 3,        // ★ 1 제거
    "vocal_form": "solo" | "duet",
    "vocal_styles": {...} | null,
    "language": "ko" | "en",
    "model": null | "gpt-4o-mini" | "claude-opus-4-6"
  }
}
```

### 위저드 — 변경 사양

**Step 2 — 우리의 시간** (전면 재구성)
| 칸 | 입력 방식 | 필수 | placeholder 핵심 |
|---|---|---|---|
| 첫 만남 — 상황 | textarea | * | "예) 4월 비 오던 회식 끝난 야근, 회의실 옆자리에 앉아 있던 그 사람과 모니터 너머로 눈이 마주쳤어요." |
| 첫 만남 — 그때의 마음 | textarea | * | "예) 눈 마주친 순간 숨이 한 번 막혔고, 키보드 소리도 안 들릴 만큼 가슴이 뛰었어요." |
| 첫 데이트 — 상황 | textarea | (선택) | "예) 다음 주 토요일 한강 망원 벤치에서 만났어요. 그 사람이 캔커피 두 개를 들고 왔는데..." |
| 첫 데이트 — 그때의 마음 | textarea | (선택) | "예) 자꾸 곁눈질하다 들킬까 고개 돌렸고, 옆얼굴만 시야에 들어와 어지러웠어요." |
| 함께 쌓인 추억 [동적 리스트] | DynamicList textarea | (선택) | "예) [상황] 매주 토요일 같은 벤치에서 노래 한 곡씩 같이 들었어요. [마음] 너의 어깨에 자연스럽게 기대게 됐고, 너 없는 토요일을 상상할 수 없게 됐어요." |
| 결혼을 결심한 순간 — 상황 | textarea | (선택) | "예) 부암동 그 카페 창가 자리에서, 두 잔의 커피 위에 그 사람의 손이 포개졌을 때 '같이 살자'고..." |
| 결혼을 결심한 순간 — 그때의 마음 | textarea | (선택) | "예) 그 한 마디에 눈물이 핑 돌았는데, 떨리지 않을 만큼 이미 단단해져 있었구나 싶었어요." |
| 웨딩 준비 — 상황 | textarea | (선택) | "예) 어느 토요일 드레스를 입어 봤어요. 그 다음 주말엔 야외 웨딩 촬영을 했고요." |
| 웨딩 준비 — 그때의 마음 | textarea | (선택) | "예) 거울 너머의 모습이 어색하면서도 '이게 우리구나' 실감이 나서 같이 웃었어요." |
| 둘만의 단어·장소·코드워드 | textarea | (선택) | "예) "오징어볶음"이 우리 사이의 사과 신호. 부암동 그 카페가 우리만의 비밀 장소." |

DROP: 힘들었던 시기/위기 칸 완전 제거.

**Step 5 — 음악 사양** (길이 라벨 변경)
- 길이 라디오: `2분 가사 (약 700자, Verse 2~3개 + Chorus)` / `3분 가사 (약 1200자, 풀 8섹션)`
- `1분` 옵션 제거.

**Step 6 — 검토** 카드: turning_points 행 제거 + 새 필드 행 추가 (첫 데이트 / 결혼 결심 / 웨딩 준비). 비어있는 옵션 필드는 표시 생략.

### 작업 분배

**backend-dev (v2.1 Phase 2A)**
1. `models/story.py` `StoryDetails` 재정의 (필드 10개), `MusicSpec.duration_minutes: Literal[2,3]`
2. `services/lyrics_generator.py` 시스템 프롬프트 SOLO·DUET 갱신:
   - 룰 11~17 추가 (END 마커, 흐름, 결혼식 본행사 금지, 부정 시점 금지, 길이 가이드)
   - 기존 룰 1~10 중 `turning_points`/`위기` 언급 제거
   - 마커 표현 풀 6~8개를 시스템 프롬프트 내 예시로 박기
3. `_build_user_message_wedding()` 새 매핑(첫 만남·첫 데이트·추억·결혼 결심·웨딩 준비·둘만의 단어). 옵션 필드 빈 값이면 항목 생략.
4. `routes/mv.py` `_strip_story_for_prompt`(또는 동등 로직) 새 필드 화이트리스트로 갱신. turning_points 키 제거.
5. **셀프 검증**: `python -c "from app.models.story import StoryDetails; print(StoryDetails.model_fields.keys())"` 새 키 확인. SOLO/DUET 시스템 프롬프트 grep으로 룰 14·15 어휘 금지 항목 포함 확인.

**frontend-dev (v2.1 Phase 2B)**
1. `components/SceneInput.jsx` (+ css) 신규 — props: `label`, `situationValue`, `emotionValue`, `onChange`, `situationPlaceholder`, `emotionPlaceholder`, `required` 등.
2. `pages/StoryWizardPage.jsx` `initialData()` 재정의 (새 8필드 + memories[]).
3. Step 2 마크업 재작성: SceneInput 4개 (첫만남·첫데이트·결혼결심·웨딩준비) + 추억 DynamicList(단일 textarea, 구조 placeholder) + 둘만의 단어 textarea.
4. Step 5 마크업: 길이 라디오 `2분` / `3분` 두 옵션 + `약 N자` 보조 라벨. 1분 제거.
5. Step 6(검토) 새 필드 표시. turning_points 표시 제거.
6. validation: 첫 만남 상황·심정만 필수. 나머지 옵션. "다음" 버튼 활성 조건 갱신.
7. `api.createStory` 호출 시 새 페이로드(상황/심정 페어 + memories 텍스트 배열) 전달. memories[] 필터링: trim 후 빈 항목 제거.
8. **셀프 검증**: `grep ":9004\|:4000\|fetch(\|localhost:" frontend/src/` 빈 결과. Step 2 마크업에 SceneInput 4개 확인.

### 테스터 검증 항목 (v2.1 Phase 3)

**A. 회귀**
- v2 인증/character/assets/share 정상

**B. v2.1 백엔드**
- POST /api/story 새 페이로드 → 200, 새 필드 모두 Mongo에 저장
- POST /api/story 첫 만남 상황 누락 → 422
- POST /api/mv/jobs `duration_minutes=2` → 가사 본문 길이 600~900자 범위
- POST /api/mv/jobs `duration_minutes=3` → 가사 본문 길이 1000~1500자 범위
- POST /api/mv/jobs `duration_minutes=1` → 422 (Literal 좁힘 검증)
- 가사 본문에 다음 금지 어휘 미포함 검증:
  - 결혼식 본행사: `결혼식에서`, `이 자리에서 모두 앞에`, `예식장`, `주례`, `혼인서약`, `식장에서`
  - 부정 시점: `어둠`, `이별`, `헤어짐`, `극복`, `위기` (휴리스틱)
- 가사 회상 섹션(Verse 1/Verse 2/Pre-Chorus/Verse 3/Bridge) 마지막 줄에 시점 마커류 어휘 포함 검증 (그게/그날이/그때/거기서/그렇게)
- 가사에 사용자 입력 "심정" 텍스트의 핵심 어휘(예: "숨이 막혔어", "가슴이 뛰었지") 직간접 인용 휴리스틱

**C. v2.1 프론트** (자동 가능 부분)
- /wizard SPA fallback HTML
- StoryWizardPage.jsx Vite transformed 200
- manual: 위저드 5스텝 + 검토. Step 2 SceneInput 4개·추억 DynamicList·둘만의 단어 칸. Step 5 길이 라디오 2개 + 보조 라벨.

**D. 영향 회귀**
- /api/character/couple, /api/assets/upload 영향 없음
- 백엔드 lifespan / 라우터 prefix 그대로

---

## v3 — 2026-05-01 — Suno 음악 생성 (가사 → 음악)

### 요청 작업
"내 작품"에서 가사 생성된 잡을 선택 → 그 가사로 Suno 음악 생성 → 결과 mp3 재생까지.

### Plan verification findings (현재 코드 직접 재확인)

**Backend** (`backend_8000/`)
- `routes/mv.py:23-26` `MVJobCreate(story_id, music_spec)` — 음악 트리거 엔드포인트는 없음.
- `routes/mv.py:28-40` `_serialize_job` — `audio_object_name`, `audio_variants`, `suno_task_id` 필드 직렬화 미포함.
- `routes/mv.py:43-95` `_run_lyrics_generation` 백그라운드 패턴은 음악 생성에 그대로 차용 가능 (asyncio.create_task).
- `config.py` (planner v1): `suno_api_key: str = ""`, `suno_api_url: str = "https://api.sunoapi.org"`, `minio_bucket_audio: str = "mv-wedding-audio"` 모두 정의됨. `.env`에 `SUNO_API_KEY` 실제 값 존재(레퍼런스에서 v1 tester가 복사해옴, 검증됨).
- `services/lyrics_generator.py` 옆에 `suno_generator.py` 신규 추가 필요. requirements `httpx` 이미 있음.
- `auth.py:22` 이미 `request.query_params.get("token")` 폴백 지원 — HTML `<audio src>`에 `?token=...` 박아 인증 가능.

**Frontend** (`frontend/`)
- `pages/GenerationStatusPage.jsx:7` `TERMINAL_STATUSES = new Set(['lyrics_ready', 'lyrics_failed'])` — lyrics_ready를 terminal에서 빼고 music 상태들을 추가해야 함.
- `pages/GenerationStatusPage.jsx:9-14` `STATUS_MESSAGE` — generating_music / music_ready / music_failed 메시지 추가.
- `pages/GenerationStatusPage.jsx:116-129` lyrics_ready 카드 — "이 가사로 음악 만들기" 버튼 추가.
- `pages/MyWeddingMVPage.jsx:50-66` 카드 — `status === 'ready'` 옛 라벨 사용 중. 새 status별 라벨/액션으로 교체.
- `api/index.js:41-43` MV 함수 — `startMusicGen(jobId)`, `audioStreamUrl(jobId, variant)` 추가 필요.

**레퍼런스 Suno** (`0_platform_music/.../suno_generator.py`)
- 엔드포인트:
  - POST `{base}/api/v1/generate` (또는 reference audio 있을 때 `/upload-cover`)
  - GET `{base}/api/v1/generate/record-info?taskId=X`
- 인증: `Authorization: Bearer {SUNO_API_KEY}` + JSON
- 요청 본문 핵심: `prompt`(가사 본문), `style`(콤마 결합 문자열), `model: "V5"`, `customMode: True`, `instrumental: False`, `title`, `vocalGender: "m"|"f"`, `callBackUrl`
- 응답 폴링 status: `PENDING / TEXT_SUCCESS / FIRST_SUCCESS / SUCCESS / FAILED`
- 성공 시 `data.response.sunoData[]` 배열에 1~2개 트랙 (`.audioUrl`, `.id` 등)
- 폴링 5초 간격, 60회까지 (총 5분 한도)
- SUNO_VOCAL_MAP 8개 (male_warm/powerful/husky/soft, female_warm/powerful/husky/sweet) → `{style, gender}`

### 사양과 코드 충돌 / 조정안
- **충돌 1**: 현재 lyrics_ready가 terminal이라 GenerationStatusPage 폴링이 멈춰버린다. 음악 트리거 후 폴링 재개 로직 필요.
  → **조정**: TERMINAL_STATUSES에서 `lyrics_ready` 제거. 단, 사용자가 "음악 만들기" 버튼 누르기 전까지는 폴링 중단(어차피 같은 lyrics_ready 응답만 옴) — 약간 비효율. 차라리 단순화: terminal을 `music_ready`/`music_failed`/`lyrics_failed` 셋으로 하고 lyrics_ready는 "정지된 진행" 상태로 폴링 계속하되 사용자 액션 대기.
  더 깔끔한 안: lyrics_ready를 terminal로 둔 채, 음악 트리거 직후 페이지에서 `setJob(...)` + 폴링 인터벌 재시작. terminal 검사 시점에서 `music_ready`/`music_failed` 추가만 하면 됨.
- **충돌 2**: `_serialize_job`이 새 필드 미포함 — 확장 필요 (추가만, 기존 응답 키 유지).
- **조정 3**: Suno API 평균 60~120s, 최대 300s. UI에서는 "1~3분 정도 걸려요" 안내 + progress 표시. lyrics 잡(약 30s)보다 길어 사용자 인내 필요.
- **조정 4**: Suno는 보통 2개 트랙 반환. 둘 다 MinIO에 저장하되 기본은 첫 번째 재생. UI에 "다른 버전 듣기" 토글.
- **조정 5**: MV/오디오 무허가 접근 막아야 함 → `/api/mv/jobs/{id}/audio` 엔드포인트는 `Depends(get_current_user)` 또는 `?token=` 쿼리 지원. HTML `<audio>`는 헤더 못 박으니 쿼리 토큰 필수.

### 범위(Scope) — v3
**KEEP**
- v2.2 가사 생성 흐름 그대로
- 위저드/검토/모델 선택 그대로

**NEW Backend**
1. `services/suno_generator.py` 신규 — 레퍼런스 베이스로 슬림(persona/reference_audio/advanced 옵션 제거):
   - `generate_music_for_job(job_id, lyrics_body, lyrics_title, music_spec, mongo_db) -> dict`
   - 내부: SUNO_VOCAL_MAP, style 문자열 빌드, `httpx` POST `/api/v1/generate`, polling `/record-info`, 결과 mp3 다운로드 → MinIO `mv-wedding-audio` 버킷에 `mv_jobs/{job_id}/track_1.mp3`, `track_2.mp3` 저장.
   - 진행률 콜백: `mv_jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"progress": N, "updated_at": ...}})`
   - 반환: `{audio_object_name, audio_variants[obj_name list], suno_task_id, suno_audio_id, model}`
2. `routes/mv.py`:
   - `POST /api/mv/jobs/{job_id}/music` — 잡 소유 검증 + status=='lyrics_ready' 검증 → status="generating_music", progress=0 → `asyncio.create_task(_run_music_generation(job_id))` → 즉시 `{job_id, status:"generating_music"}` 반환
   - `_run_music_generation(job_id)` 백그라운드 — story/lyrics/music_spec 조회 → `generate_music_for_job` 호출 → 결과를 `mv_jobs.update_one({...}, {"$set": {status: "music_ready", progress: 100, audio_object_name, audio_variants, suno_task_id, ...}})`. 실패 시 status="music_failed", error_message.
   - `GET /api/mv/jobs/{job_id}/audio?variant=1` — `Depends(get_current_user)` (헤더 또는 ?token=) → 잡 소유 검증 + status=='music_ready' 검증 → variant 매핑 (1=audio_object_name 또는 audio_variants[0], 2=audio_variants[1]) → MinIO get_object → `StreamingResponse(content_type="audio/mpeg")`. variant 없으면 404.
   - `_serialize_job`에 `audio_object_name`, `audio_variants`, `suno_task_id` 필드 추가.
3. `requirements.txt` 변경 없음 (httpx 이미 있음).
4. `config.py` 변경 없음 (suno_api_key/url, minio_bucket_audio 이미 있음).

**NEW Frontend**
1. `api/index.js`:
   - `startMusicGen(jobId)` → `API.post('/mv/jobs/${jobId}/music')`
   - `audioStreamUrl(jobId, variant=1)` → `${API.defaults.baseURL}/mv/jobs/${jobId}/audio?token=${encodeURIComponent(localStorage.getItem('token'))}&variant=${variant}`
2. `pages/GenerationStatusPage.jsx`:
   - `TERMINAL_STATUSES`: `{lyrics_failed, music_ready, music_failed}` 로 갱신 (lyrics_ready는 비-terminal)
   - `STATUS_MESSAGE` 추가: `generating_music`("음악을 만들고 있어요. 약 1~3분 정도 걸려요."), `music_ready`("음악이 준비됐어요."), `music_failed`("음악 생성에 실패했습니다.")
   - status==='lyrics_ready' UI: 가사 카드 하단에 "이 가사로 음악 만들기" 버튼. 클릭 시 `api.startMusicGen(id)` → 성공시 `setJob({...job, status:'generating_music', progress:0})` + 폴링 재시작.
   - status==='generating_music' UI: progress bar + "1~3분 정도 걸려요" 안내. 5초 폴링 유지.
   - status==='music_ready' UI: 가사 카드 + 오디오 플레이어 카드 (`<audio controls src={audioStreamUrl(id, 1)} />` + variant 2 있으면 토글 또는 두 번째 audio + 다운로드 링크).
   - status==='music_failed' UI: 에러 메시지 + "다시 시도하기" 버튼 (다시 startMusicGen 호출).
3. `pages/MyWeddingMVPage.jsx`:
   - status별 한글 라벨 매핑: `generating_lyrics`→"가사 만드는 중", `lyrics_ready`→"가사 준비됨", `lyrics_failed`→"가사 실패", `generating_music`→"음악 만드는 중", `music_ready`→"음악 준비됨", `music_failed`→"음악 실패"
   - 카드 액션: 항상 `진행 상황` 링크. status==='music_ready'면 "재생" 강조 액션 추가.

### REST API 변경 (v3)

| Method | Path | 요약 |
|---|---|---|
| POST | `/api/mv/jobs/{id}/music` | 잡 소유 + status=lyrics_ready 검증 → 음악 백그라운드 잡 시작 |
| GET | `/api/mv/jobs/{id}/audio?variant=1\|2` | mp3 StreamingResponse (Bearer 또는 ?token=) |
| GET | `/api/mv/jobs/{id}` | (확장) `audio_object_name`, `audio_variants`, `suno_task_id` 추가 |

### 잡 status 흐름 (v3)
```
generating_lyrics ──→ lyrics_ready ──[POST /music]──→ generating_music ──→ music_ready
       ↘ lyrics_failed                                    ↘ music_failed
```

### 작업 분배

**backend-dev (v3 Phase 2A)**
1. `services/suno_generator.py` 신규 — 레퍼런스에서 핵심만 가져와 슬림화:
   - SUNO_VOCAL_MAP 그대로
   - `_ensure_lyrics_structure` 헬퍼 그대로 (혹시 가사에 메타태그 누락된 경우 보호)
   - `generate_music_for_job(job_id, lyrics_body, lyrics_title, music_spec, mongo_db)` 새 시그니처
   - 페르소나/reference audio/negative_tags/style_weight 등 advanced 파라미터 제거
   - 진행률 update는 `mv_jobs` 컬렉션의 `progress` 필드 직접 갱신 (별도 콜백 함수 없이 단순화)
2. `routes/mv.py`:
   - 새 엔드포인트 `POST /jobs/{id}/music` + `_run_music_generation` bg 함수
   - 새 엔드포인트 `GET /jobs/{id}/audio` (variant query param)
   - `_serialize_job` 확장
3. **셀프 검증**: `grep "generate_music_for_job\|/jobs/{job_id}/music\|/jobs/{job_id}/audio" backend_8000/app/`로 라우트·함수 등록 확인. `python -c "from app.services.suno_generator import generate_music_for_job"` import OK.

**frontend-dev (v3 Phase 2B)**
1. `api/index.js` 두 함수 추가
2. `pages/GenerationStatusPage.jsx` TERMINAL_STATUSES, STATUS_MESSAGE 갱신, 음악 트리거 버튼/플레이어/실패 처리 추가
3. `pages/MyWeddingMVPage.jsx` 한글 status 라벨 + music_ready 액션
4. CSS 약간 — 오디오 플레이어 카드 스타일
5. **셀프 검증**: `grep ":9004\|:4000\|fetch(\|localhost:" frontend/src/` 빈 결과. `grep "audioStreamUrl\|startMusicGen" frontend/src/pages/` 사용 확인.

### 테스터 검증 항목 (v3 Phase 3)

**A. 회귀 (v2.2)**
- /api/health, register/login/me, character, assets, share — 정상
- POST /api/story 새 4시점 단일 텍스트 → 200
- POST /api/mv/jobs → lyrics_ready 도달 (Claude Opus 4.7 기본)

**B. v3 백엔드 — 음악 생성**
- [ ] POST /api/mv/jobs/{lyrics_ready_job}/music → 200 즉시 반환, status="generating_music"
- [ ] POST /api/mv/jobs/{generating_lyrics_job}/music → 400/409 (lyrics_ready 아님)
- [ ] POST /api/mv/jobs/{nonexistent}/music → 404
- [ ] 폴링하여 status="music_ready" 도달 (~60~180s, 최대 5분 허용)
- [ ] mv_jobs 문서에 `audio_object_name`, `audio_variants[]`, `suno_task_id` 저장 확인
- [ ] MinIO `mv-wedding-audio` 버킷에 `mv_jobs/{job_id}/track_1.mp3` (그리고 `track_2.mp3` 있으면 둘 다) 저장 확인 (mc 또는 백엔드 로그)
- [ ] GET /api/mv/jobs/{id}/audio (Bearer 헤더) → 200, Content-Type: audio/mpeg, 응답 본문 길이 > 100KB
- [ ] GET /api/mv/jobs/{id}/audio?token=... (쿼리 토큰) → 200
- [ ] GET /api/mv/jobs/{id}/audio?variant=2 → 200 (있으면) 또는 404 (없으면)
- [ ] GET /api/mv/jobs/{id}/audio (다른 사용자 토큰) → 403

**C. v3 프론트 (자동 가능)**
- [ ] /projects/{lyrics_ready_id} curl SPA fallback 200
- [ ] 새 컴포넌트 import 확인 — `audioStreamUrl`, `startMusicGen` 사용처
- manual:
  - 가사 ready 화면에서 "이 가사로 음악 만들기" 버튼 노출
  - 클릭 → "음악을 만들고 있어요" 메시지 + progress
  - ~60~180s 후 자동 전환 → 오디오 플레이어 보임 + 재생
  - /my 카드에 한글 status 라벨 + music_ready인 잡에 "재생" 강조

**D. 영향 회귀**
- /api/character/couple, /api/assets/upload, /api/share 영향 없음
- 백엔드 lifespan / 라우터 prefix 그대로
- 가사 생성 (v2.2) 동작 영향 없음

---

## v3.1 — 2026-05-01 — 시점 마커 위치 END → START 통일

### 요청 작업
시점 마커 라인("그게 우리의 첫 만남이었어" 등)을 회상 섹션의 **마지막 줄(END)** → **첫 줄(START)** 로 통일.

### 결정 근거 (객관 분석 — 이전 v2.1에서도 동일 결론)
1. **첫 청취 + 평생 1회** — 발견의 즐거움 곡선 작동 안 함 (END 위치의 핵심 강점이 무력)
2. **청취자 멀티태스킹** (대화·식사·MV 영상·신랑신부 시선) — 인지 부하 ↑, 헤딩이 가장 큰 도움
3. **중간 합류 청취자 보호** — 헤딩 놓치는 건 1줄 손실, verse 통째 놓치는 건 6줄 손실
4. **MV 영상과 sync (v4 후속)** — verse 첫 컷이 시점 장면. 가사 헤딩과 영상 컷 1:1 매칭은 START여야 자연
5. **v3 실측 톤 검증** — `69f385a290b219a946ddca4a` 잡 청취 시 "Verse 1을 다 들어야 첫 만남임을 깨닫는다" 패턴 확인됨

### Plan verification findings (현재 코드 직접 확인)

**lyrics_generator.py** — 변경 위치 7곳:
- line 114-125  SOLO 룰 12 (시점 마커 위치 규정 + 마커 표현 풀)
- line 127-131  SOLO 룰 13 (회상 섹션 권장 구성, "[시점 마커 라인 1] (END)" 마지막)
- line 173-181  SOLO Few-shot Verse 1 (마지막 줄에 마커 "그게 우리의 첫 만남이었어")
- line 255-266  DUET 룰 12 (동일 + [Both] 라벨 명시)
- line 268-272  DUET 룰 13 (동일)
- line 313-321  DUET Few-shot Verse 1 (마지막 줄에 `[Both] 그게 우리의 첫 만남이었어`)
- line 475      user_message [요구] 섹션의 "[상황 → 행동 → 심정 → 시점 마커(END)] 순서로 작성"

**프론트엔드** — 변경 없음 (가사 표시는 라인 단위로 그대로 출력하는 구조)

**기존 잡 데이터** — 그대로 유지. 이미 생성된 잡들의 가사는 END 위치 그대로 남고, 다음 새 잡부터 START로 생성됨. 회귀 0.

### 변경 사양 — START 통일

**룰 12 새 본문 (SOLO·DUET 동일 구조)**
```
# 룰 12 — ★ 시점 마커 라인은 회상 섹션의 첫 줄(START)에 통일
회상 섹션(Verse 1 / Verse 2 / Pre-Chorus / Verse 3 / Bridge)의 첫 줄에
시점 마커 라인을 둔다. (DUET이면 [Both] 라벨)
이 곡은 결혼식에서 단 한 번 처음 듣는 곡이므로,
하객이 각 섹션이 어느 시점인지 즉시 알 수 있도록 헤딩 형식으로 박는다.
Intro / Chorus 1 / Chorus 2 / Outro 에는 시점 마커를 두지 않는다.
같은 곡 안에서 동일한 마커 표현을 두 번 이상 반복하지 마라.
```

**마커 표현 풀 — START 헤딩 스타일로 갱신**
```
첫 만남:        "우리 첫 만남은 그 해 [N월/계절]이었어"
                "그렇게 우리는 처음 서로를 봤어"
                "거기서 우리는 시작됐어"
첫 데이트:      "그 다음 [요일/날짜]이 우리 첫 데이트였지"
                "그날이 우리 첫 약속이었어"
함께 쌓인 시간: "그렇게 우리만의 시간이 쌓이기 시작했어"
                "그 [반복어]이 우리를 만들었지"
결혼 결심:      "그게 우리가 함께 살기로 한 그 [계절]이었어"
                "거기서 우리는 평생을 약속했지"
웨딩 준비:      "그렇게 우리는 우리의 새 시작을 준비했어"
                "그 [계절]에 우리는 결혼을 그리고 있었지"
```

**룰 13 권장 구성 — START로 재정렬**
```
[시점 마커 라인 1] (START)        ← 헤딩
[상황 라인 1~2]   시간·장소·소품
[행동 라인 1~2]   미시 동작
[심정 라인 1~2]   속마음 (행동 라인과 호응)
```

**Few-shot Verse 1 (SOLO)**
```
[Verse 1: soft, intimate]
우리 첫 만남은 그 해 4월이었어                 ← START 마커
비 오던 회식 끝난 야근 시간
회의실 옆자리에 앉아 있던 너
야근하다 고개를 들었을 때
모니터 너머로 처음 마주친 그 눈
눈이 마주친 그 순간 숨이 한 번 막혔어
키보드 소리도 안 들릴 만큼 가슴이 뛰었지       ← 심정 라인이 자연스럽게 종결감 흡수
```

**Few-shot Verse 1 (DUET)**
```
[Verse 1: soft, intimate]
[Both] 우리 첫 만남은 그 해 4월이었어
[Female] 비 오던 회식 끝난 야근 시간
[Female] 회의실 옆자리에 앉아 있던 너
[Male] 야근하다 고개를 들었을 때
[Male] 모니터 너머로 처음 마주친 그 눈
[Female] 눈이 마주친 그 순간 숨이 한 번 막혔어
[Male] 키보드 소리도 안 들릴 만큼 가슴이 뛰었지
```

**user_message [요구]**
- "(END)" → "(START)"
- "각 회상 섹션은 [상황 → 행동 → 심정 → 시점 마커(END)] 순서로 작성." →
  "각 회상 섹션은 [시점 마커(START) → 상황 → 행동 → 심정] 순서로 작성."

### 작업 분배

**backend-dev (Phase 2)**
1. lyrics_generator.py 7곳 일괄 갱신 (위치·문구 위에 명시)
2. 셀프 검증:
   - `grep -n "마지막 줄(END)" lyrics_generator.py` → 빈 결과
   - `grep -n "첫 줄(START)" lyrics_generator.py` → 2건 (SOLO+DUET 룰 12)
   - `grep -n "우리 첫 만남은 그 해 4월" lyrics_generator.py` → 2건 (SOLO+DUET few-shot)
   - `grep -n "(END)" lyrics_generator.py` → 빈 결과 (룰 13·user_message 모두 START로 갱신됐는지)
   - `python -c "from app.services.lyrics_generator import WEDDING_SYSTEM_PROMPT_SOLO, WEDDING_SYSTEM_PROMPT_DUET"` import OK

**frontend-dev** — 작업 없음 (라인 렌더링은 그대로)

### 테스터 검증 항목 (Phase 3)

1. 백엔드 hard restart (코드 변경 반영). `/api/health` 200.
2. 새 스토리 + 잡 생성 (기존 v2.1 페이로드 그대로)
3. lyrics_ready 도달 후 검증:
   - 회상 섹션(Verse 1/Verse 2/Pre-Chorus/Verse 3/Bridge)의 **첫 줄**(메타태그 직후 첫 가사 라인)에 시점 마커류 어휘(우리/그게/그날이/그렇게/거기서/그 + 시점명사) 포함
   - END 위치(섹션 마지막 줄)는 더 이상 마커가 아니어야 함 (심정 라인으로 끝남)
   - 본문 길이 회귀: 3분 ≥ 700자 / 2분 ≥ 600자
   - 결혼식 본행사 어휘 0건, 부정 시점 0건
   - 가사 본문 처음 30~40줄 발췌 (planner 톤 평가용)
4. 회귀 spot-check: /api/health, /api/auth/me, 음악 생성 잡 1회 (선택, 이전 lyrics_ready 잡 재사용 가능하면)

### 영향·회귀
- 기존 잡 가사 데이터 변경 없음
- 새 잡부터 START 위치
- 음악 생성·인증·assets·share 등 다른 흐름 영향 없음

---

## v4 — 2026-05-23 — 신랑·신부 캐릭터 시트 (평상복 + 웨딩 촬영복)

### 요청 작업
- 위저드 Step 1(신랑·신부 이름/나이) **바로 아래** 에 캐릭터 시트 생성 공간을 둔다.
- 한 사람당 **2장**: ① 평상복(`casual`) ② 웨딩 촬영복(`wedding`). 신랑·신부 합쳐 **총 4시트**.
- 의상은 **레퍼런스 패턴 그대로 — 아이템 선택 페이지** 로 이동해서 카드에서 고른 뒤 돌아오는 흐름. (file upload 단일슬롯 아님)
- 이미지 모델: **GPT Image 2 디폴트**, Nano Banana Pro 도 선택 가능.
- 출처 레퍼런스: `0_platform_music/backend_9004/app/routes/character.py` + `app/services/character_generator.py` + `app/services/openai_image.py` + `frontend/src/pages/{MyMusicPage,ItemSelectPage}.jsx`.

### Plan verification findings (0단계 분석 결과)
직접 파일을 읽어 확인한 사실만 기록.

- **웨딩 백엔드 현재 상태 (`backend_8000`)**
  - `app/main.py:17, 70` — `from .routes import auth, story, mv, character, assets, share` + `include_router(character.router)`. 이미 character 라우터가 마운트돼 있음.
  - `app/routes/character.py:1-60` — **현재는 stub**. `/api/character/couple` POST/GET 만 있고 `name/age/traits` 만 mongo 컬렉션 `couple_characters` 에 upsert. 시트 이미지·아이템·이미지 모델 개념 없음. → 신규 시트 엔드포인트를 **이 파일에 추가** 한다 (스텁은 호환을 위해 그대로 유지하되 비활성 영역으로 둠).
  - `app/routes/assets.py:1-65` — `/api/assets/upload` 이미 MinIO put_object 패턴 보유. bucket=`mv-wedding-photos`. 시트도 같은 버킷을 prefix `characters/...` 로 사용.
  - `app/main.py:20-24` — `REQUIRED_BUCKETS = (photos, audio, videos)`. 별도 images 버킷은 없음. **시트 PNG는 `mv-wedding-photos` 안에 `characters/{user_id}/{role}_{style}/...` 로 저장**.
  - `app/config.py:34-37` — `minio_bucket_photos="mv-wedding-photos"` 확인.
  - `app/config.py:44-58` — `openai_api_key`, `google_api_key` 슬롯 이미 존재. `.env` 에 키만 채우면 됨.
  - `app/services/` — `lyrics_generator.py`, `suno_generator.py` 만 있음. `character_generator.py`, `openai_image.py` 는 **신규 추가** 필요.
  - `app/auth.py:13-45` — `get_current_user(request, authorization)`. `Authorization: Bearer ...` 또는 `?token=...` 쿼리 fallback. **preview 라우트는 토큰 쿼리 fallback 사용**.
  - mongo 컬렉션은 자유 생성(스키마리스). 신규: `wedding_character_sheets`, `wedding_outfit_items`.

- **웨딩 프론트엔드 현재 상태**
  - `frontend/src/api/index.js:36-69` — axios 단일 진입점. baseURL `…:8000/api`, 401 시 token 정리. `createStory`, `createMVJob`, `audioStreamUrl`, `saveCoupleCharacter` 등 존재. **신규 API 함수는 모두 이 파일에 추가**.
  - `frontend/src/api/index.js:54-55` — 이미 `saveCoupleCharacter`, `getCoupleCharacter` 가 stub 라우트와 연결돼 있음. 그대로 두되 신규 함수는 별도 섹션으로 추가.
  - `frontend/src/pages/StoryWizardPage.jsx:219-283` — `renderStep1()`. `field-row > field` 2행(이름/나이 × 신랑/신부). **이 함수 마지막 직전에 4개 캐릭터 시트 패널을 삽입한다**.
  - `frontend/src/App.jsx` — 라우트 구성. **OutfitSelectPage** 를 `/outfits/:role/:style/:category` 로 추가.
  - `frontend/src/pages` 에는 ItemSelectPage 류가 없음 — 신규 작성.

- **레퍼런스 호출 규약 (포팅 대상)**
  - `0_platform_music/backend_9004/app/services/character_generator.py:683-764` — 2-step (gemini-text 으로 prompt 생성 → 이미지 모델로 시트 PNG 생성). `image_model="nb_pro"` 디폴트, `"gpt_image_2"` 분기.
  - `0_platform_music/backend_9004/app/services/openai_image.py:135-200` — GPT Image 2 `gpt-image-2-2026-04-21` 스냅샷. ref_images 없으면 `/v1/images/generations`, 있으면 `/v1/images/edits` multipart. 1800s timeout, 1회 재시도. **이 wrapper 그대로 포팅**.
  - `0_platform_music/backend_9004/app/routes/character.py:195-315` — `/generate-sheet` 멀티파트(file + top_image + bottom_image + shoes_image + user_text + image_model). 응답 `{object_name, original_object_name, preview_url, image_model, message}`. 폴리시 그대로 유지.
  - `0_platform_music/frontend/src/pages/ItemSelectPage.jsx:13-135` — `/items/:category` 경로에서 `api.getActiveAds(category)` 호출, `handleSelect` 가 `navigate('/my-music', { state: { selectedItem, category, tab } })`. **웨딩에서는 `/outfits/:role/:style/:category` 로 진입, 선택 후 `navigate('/wizard', { state: {…selectedOutfit, role, style, category} })`** 로 돌아오게 한다.
  - 레퍼런스 `getActiveAds` 는 광고 시스템에서 아이템을 가져옴 — **웨딩은 광고 시스템이 없으므로 별도 카탈로그 컬렉션을 시드** 한다.

### 사양 확정 사항 (사용자 확정)
- 시트 슬롯: `(role, style)` = {groom, bride} × {casual, wedding} = 4 슬롯.
- 의상 슬롯/카테고리: 레퍼런스와 동일하게 `top` / `bottom` / `shoes` 3슬롯 — 단 카탈로그는 (role, style) 별로 필터링.
- 이미지 모델: `gpt_image_2` 디폴트 / `nb_pro` 선택 가능. 두 라디오로 노출.
- 의상 선택 UI: 별도 페이지로 이동해서 카드에서 선택 → 위저드로 돌아옴.

### 사양과 코드 사이의 갭
- `wedding_outfit_items` 컬렉션이 비어 있으면 의상 카드가 안 보임 → 실 운영 사진 부재. **이번 버전에서는 PIL 로 placeholder PNG(category + role + style + 번호 라벨링) 4종 ×슬롯·페어 자동 시드**. 사용자가 추후 운영 아이템으로 교체 가능.
- `wedding_outfit_items` 이미지 저장 위치: `mv-wedding-photos` 버킷, prefix `outfits/{role}/{style}/{category}/{idx}.png`.
- 시트 본인 사진은 `characters/temp/{user_id}/...` 임시, 저장 확정 후 `characters/{user_id}/{role}_{style}/sheet.png`.

### 변경 매트릭스

#### Backend (`backend_8000`)
| 파일 | 변경 | 추적자(로그 prefix) |
|---|---|---|
| `app/services/openai_image.py` | **신규** — GPT Image 2 wrapper (snapshot `gpt-image-2-2026-04-21`, 1800s timeout, edits/generations 분기, 1회 재시도). 레퍼런스 그대로 포팅. | `[OpenAIImage]` |
| `app/services/character_generator.py` | **신규** — 2-step (Gemini text + 이미지 모델 분기). `image_model="gpt_image_2"` 디폴트로 변경. user_text + outfit 3슬롯 + STEP1_ANSWERS 그대로 포팅. | `[CharGen]` (+`user_id`, `role`, `style`) |
| `app/services/outfit_seeder.py` | **신규** — `seed_outfits()` 비동기 함수. mongo `wedding_outfit_items` 가 비면 PIL 로 placeholder PNG 생성해서 MinIO 에 put + 컬렉션 insert. 라이프스팬에서 1회 호출. | `[OutfitSeed]` |
| `app/routes/character.py` | **확장** — stub 유지하되 아래 추가: `POST /api/character/sheets/generate`, `POST /api/character/sheets/save`, `POST /api/character/sheets/refine`, `GET /api/character/sheets`, `GET /api/character/preview/{object_name:path}`, `GET /api/character/outfits?role&style&category` | `[CharRoute]` (+`user_id`, `role`, `style`) |
| `app/main.py` | `seed_outfits()` 를 lifespan startup에서 호출. | `[Startup]` |

규약:
- 모든 신규 함수/엔드포인트는 `logger = logging.getLogger(__name__)` 인스턴스 사용. **진입 / 외부 호출 전후 / 분기 / 경고 / 에러** 5종 로그 심기. 추적자(`user_id`, `role`, `style`, `image_model`, 요청 ID) 키워드 포함.
- 민감 정보 금지: API 키·토큰은 길이 또는 마스킹만.

#### Frontend (`frontend/src`)
| 파일 | 변경 | 컴포넌트 prefix |
|---|---|---|
| `api/index.js` | **신규 함수 추가** — `generateCharacterSheet(formData)`, `saveCharacterSheet(payload)`, `refineCharacterSheet(formData)`, `getCharacterSheets()`, `getWeddingOutfits({role, style, category})`, `sheetPreviewUrl(objectName)` (토큰 쿼리 포함 — preview 가 인증 필요시). | n/a |
| `pages/OutfitSelectPage.jsx` (+css) | **신규** — `useParams()` 로 `(role, style, category)` 받고 `getWeddingOutfits` 호출 → 그리드 → 선택 시 `navigate('/wizard', { state: { selectedOutfit: {...}, role, style, category, returnStep: 1 } })`. | `[OutfitSelectPage]` |
| `App.jsx` | `Route path="/outfits/:role/:style/:category" element={<OutfitSelectPage />}` 추가. ProtectedRoute 안에. | n/a |
| `pages/StoryWizardPage.jsx` | step1 useState 확장: `sheets: {groom_casual,groom_wedding,bride_casual,bride_wedding}` 각각 `{face_file, face_preview, user_text, image_model, items:{top,bottom,shoes}, generated:{object_name, preview_url}}`. `useLocation` 으로 OutfitSelectPage 가 돌려준 `state.selectedOutfit` 흡수. `renderStep1` 마지막에 4개 패널을 렌더. | `[StoryWizard]` |
| `components/CharacterSheetPanel.jsx` (+css) | **신규** — 한 슬롯의 UI 캡슐(얼굴 업로드 + user_text + 이미지 모델 라디오 + outfit 3슬롯 + 생성 버튼 + 결과 미리보기 + 다시 생성 + 보정 요청). props: `role`, `style`, `value`, `onChange`. | `[CharSheetPanel:{role}_{style}]` |
| `pages/StoryWizardPage.css` | 추가 클래스 (`.sheet-panel`, `.sheet-panel__photo`, `.outfit-slot` 등). | n/a |

규약:
- 새 axios 호출은 반드시 `src/api/index.js` 의 함수를 거친다 — 컴포넌트에서 직접 URL 조립 금지.
- 새 useEffect/이벤트 핸들러에는 `console.info("[ComponentName] …", {…})` / `console.error("[ComponentName] … failed", {err, ctx})` 심기 (DEV gating). 토큰 출력 금지.

### 테스트 항목 (tester)
1. 인프라 회귀
   - `GET /api/health` 200
   - 로그인 → JWT 유효
   - 기존 위저드 → 가사 생성 → 음악 생성 flow 정상 (회귀)
2. 카탈로그 시드
   - 백엔드 startup 후 `wedding_outfit_items` 컬렉션 row > 0, MinIO `mv-wedding-photos/outfits/...` 객체 존재.
   - `GET /api/character/outfits?role=groom&style=casual&category=top` → items 배열 ≥ 3.
   - role/style/category 12 조합 모두 응답.
3. 시트 생성 (한 케이스만 깊게)
   - 신랑 평상복: 샘플 얼굴 사진 + outfits 3개 선택 + user_text "" + image_model=gpt_image_2.
   - `POST /api/character/sheets/generate` 200, 응답 `{object_name, preview_url}`, MinIO 에 temp 객체 생성. 로그에 `[CharGen]`, `[OpenAIImage]`, `[CharRoute]` 모두 보임.
   - 같은 케이스 image_model=nb_pro 로도 한 번 (Gemini 키 있을 때만; 없으면 503 응답 확인).
4. 저장 / 조회
   - `POST /api/character/sheets/save` → `wedding_character_sheets` upsert, MinIO permanent 객체 생성.
   - `GET /api/character/sheets` → 저장된 슬롯 1개 반환.
5. 보정
   - `POST /api/character/sheets/refine` 한 번 → 응답 200, 새 temp 객체.
6. 회귀
   - 기존 `/api/character/couple` (POST/GET) 그대로 동작.
   - 위저드 Step 1 에서 캐릭터 시트 패널이 추가됐어도 **이름/나이만 입력하고 다음 단계 진행 가능** (시트 생성은 옵션). 가사·음악 생성 flow 영향 없음.
7. 로깅
   - 백엔드 stdout(uvicorn 로그) 에 `[CharRoute] user_id=… role=groom style=casual` 등 추적자가 보임.
   - 프론트 콘솔에 `[CharSheetPanel:groom_casual] calling generateCharacterSheet` 등 보임.

### 영향·회귀
- 기존 가사/음악 flow 무영향 — character 라우터는 별도 prefix.
- mongo `couple_characters` 컬렉션 stub 그대로. 신규는 `wedding_character_sheets` 와 `wedding_outfit_items`.
- MinIO photos 버킷에 `outfits/`, `characters/` prefix 추가됨 — 기존 자산과 prefix 겹침 없음.
- OpenAI/Google 키가 비어 있으면 generate-sheet 호출은 503 응답으로 명시적으로 실패하게 함 (앱 startup 은 영향 없음).

---

## v5 — 2026-05-24 — 아이템관리 탭 (사용자가 의상 카탈로그에 직접 추가)

### 요청 작업
- 헤더에 `[아이템관리]` 메뉴 추가 (`/items`).
- 페이지 안에서 사용자가 의상 아이템을 직접 등록/수정/삭제. 모든 등록 아이템은 모든 사용자에게 공통 노출(전역).
- 폼 필드: 아이템명, **`role+style` 4지선다 라디오**(신랑·평상복 / 신랑·웨딩 / 신부·평상복 / 신부·웨딩), **카테고리 3지선다 라디오**(상의/하의/신발), 이미지 업로드(필수), 구매처 URL(선택).
- 등록된 아이템이 위저드의 `OutfitSelectPage` 그리드에 시드 placeholder 와 **자연스럽게 같이** 노출되어야 함.

### Plan verification findings (0단계 분석 결과)
직접 파일을 읽어 확인한 사실만 기록.

- **레퍼런스 패턴** (`0_platform_music`):
  - `frontend/src/pages/BusinessPage.jsx` line 602 "회사관리" 페이지. `AdManageTab` (lines 104–397) — 카테고리 필터 탭 + 아이템 추가 폼 + 내 아이템 테이블.
  - `backend_9004/app/routes/business.py:142-188` — `POST /api/business/ads` 멀티파트(image, name, category, gender, product_url). `require_business` 권한 게이트(role∈{customer,admin}).
  - Mongo `ad_items`: `{user_id, name, image_object_name, product_url, category, gender, is_active, created_at, updated_at}`.
  - MinIO 경로: `ads/{user_id}/{uuid}.{ext}` in images 버킷.

- **웨딩 현재 상태**:
  - `backend_8000/app/routes/character.py:763-823` — `GET /api/character/outfits?role&style&category` 이미 존재. Mongo `wedding_outfit_items` 컬렉션을 `(role, style, category)` 필터로 조회해 반환. **추가/수정/삭제 엔드포인트는 없음**.
  - 시드된 48개 doc 스키마: `{_id, role, style, category, name, image_object_name, source:"seed", created_at}`. **`created_by`, `product_url`, `is_active` 필드 없음** — 신규 사용자 아이템에만 추가. 기존 seed 는 `created_by=null` 로 해석.
  - MinIO `mv-wedding-photos/outfits/{role}/{style}/{category}/{idx:02d}.png` — 시드용. **사용자 아이템은 별도 prefix `outfits/user/{user_id}/{uuid}.{ext}` 로 분리**.
  - `frontend/src/components/Header.jsx:24-37` — 로그인 시 `[내 작품]`, 로그아웃 버튼. **`[아이템관리]` 추가 위치 확정**.
  - `frontend/src/App.jsx:13-65` — `OutfitSelectPage` 라우트 이미 존재(`/outfits/:role/:style/:category`). **`/items` 라우트 신규 추가**.
  - `frontend/src/api/index.js` — 단일 진입점 axios. 함수 추가만으로 충분.

- **권한 / 가시성** — 사용자 확정:
  - 모든 등록 아이템은 모두에게 노출 (per-user filter 없음).
  - OutfitSelectPage 의 기존 `GET /outfits?role&style&category` 가 시드 + 사용자 아이템 모두 자동 반환 (어차피 `(role, style, category)` 만으로 필터링하므로 코드 변경 불필요).
  - "수정/삭제"는 `created_by == current_user_id` 만 허용 (시드는 `created_by=null` → 사용자 어떤 누구도 삭제 불가).

- **현 코드와 충돌 / 조정 필요 사항**: 없음. 기존 seeder/엔드포인트 그대로 두고 추가만 함.

### 사양 확정
- 폼: `role_style` 4-way 라디오(`groom_casual`/`groom_wedding`/`bride_casual`/`bride_wedding`) + `category` 3-way 라디오(`top`/`bottom`/`shoes`) + name + image + product_url(optional).
- 등록 아이템 가시성: 전역(시드 + 사용자분 통합 노출). 권한 게이트는 **편집/삭제 권한**만 (`created_by==self`).
- 헤더 메뉴 위치: `[내 작품]` 다음 `[아이템관리]`, 그 다음 로그아웃.

### 변경 매트릭스

#### Backend (`backend_8000`)
| 파일 | 변경 | 추적자 prefix |
|---|---|---|
| `app/routes/character.py` | **확장** — 추가: `POST /outfits` (멀티파트), `GET /outfits/mine` (옵션 필터), `PUT /outfits/{id}` (멀티파트, 소유자 한정), `DELETE /outfits/{id}` (소유자 한정). 기존 `GET /outfits?role&style&category` 는 그대로(시드+사용자 자연 합산). | `[CharRoute]` (+`user_id`, `item_id`, `role`, `style`, `category`) |

세부:
- `POST /outfits`:
  - 멀티파트 Form: `image` (File 필수, jpg/png/webp, ≤10MB), `name` (str 필수, max 80자), `role` (str 필수, ALLOWED_ROLES), `style` (str 필수, ALLOWED_STYLES), `category` (str 필수, ALLOWED_OUTFIT_CATEGORIES), `product_url` (str, optional max 500자).
  - MinIO 저장: `outfits/user/{user_id}/{uuid.hex}{ext}` in `mv-wedding-photos`.
  - Mongo insert: `{_id, role, style, category, name, image_object_name, product_url, source:"user", created_by:user_id, created_at, updated_at}`.
  - 응답: `{id, name, role, style, category, image_object_name, preview_url, product_url, created_at}`.
- `GET /outfits/mine?role?&style?&category?`:
  - 현재 사용자 본인 아이템 (`created_by == user_id`) 만 반환. 옵션 필터 적용 가능.
  - 응답: `{items: [...]}`.
- `PUT /outfits/{item_id}`:
  - 멀티파트 Form (모두 옵션): `image`, `name`, `role`, `style`, `category`, `product_url`.
  - `created_by != user_id` → 403 `"본인 아이템만 수정할 수 있습니다."`.
  - 이미지 교체 시: 이전 MinIO 객체 best-effort 제거 후 신규 put.
  - 응답: 갱신된 아이템.
- `DELETE /outfits/{item_id}`:
  - `created_by != user_id` → 403.
  - MinIO 객체 best-effort 제거 + mongo delete.
  - 응답: `{message: "아이템이 삭제되었습니다."}`.

로깅 규약 (재강조):
- 모든 신규 엔드포인트: 진입 로그(`logger.info`) + 외부 호출 전후 로그(MinIO put/remove, Mongo insert/update/delete) + 분기/경고 로그 + try/except 의 `logger.exception` (소유권 reject 는 `logger.warning`).
- 추적자: `user_id`, `item_id` (편집/삭제), `role`, `style`, `category`, 객체 크기/길이.
- 민감 정보 금지: 토큰·API 키 출력 금지. product_url 은 정상 데이터 — 그대로 출력 가능.

#### Frontend (`frontend/src`)
| 파일 | 변경 | 컴포넌트 prefix |
|---|---|---|
| `api/index.js` | 추가: `createOutfitItem(formData)`, `getMyOutfitItems({role?, style?, category?}?)`, `updateOutfitItem(id, formData)`, `deleteOutfitItem(id)`. (의상 이미지 URL 은 기존 `sheetPreviewUrl` 재사용 — 같은 prefix `/api/character/preview/`.) | n/a |
| `components/Header.jsx` | 로그인 상태 nav 에 `<Link to="/items">아이템관리</Link>` 추가 — `[내 작품]` 과 로그아웃 사이. | n/a |
| `App.jsx` | `<Route path="/items" element={<ProtectedRoute><ItemManagePage /></ProtectedRoute>} />` 추가. import 추가. | n/a |
| `pages/ItemManagePage.jsx` (+ `.css`) | **신규** — 필터 탭(전체/4-combo) + 추가 폼 + 본인 아이템 테이블. 수정은 인라인(폼을 row 선택으로 prefill) 또는 모달 — 단순함을 위해 prefill 패턴 사용. | `[ItemManagePage]` |

#### `ItemManagePage` 상세 동작
- mount 시 `api.getMyOutfitItems()` 호출 → 본인 아이템 전체 로드.
- 필터 탭 (5): `전체` / `신랑·평상복` / `신랑·웨딩` / `신부·평상복` / `신부·웨딩` — 클라이언트 사이드 필터(이미 받은 리스트를 role+style 로 필터). 백엔드 재호출 없음.
- 폼 상태: `{mode:"create"|"edit", editingId?, name, role_style, category, image_file, image_preview, product_url}`. `role_style` 라디오에서 선택된 값은 폼 제출 시 `role`/`style` 두 값으로 분리.
- 제출:
  - create: `createOutfitItem(formData)` 호출 → 성공 시 list 에 prepend.
  - edit: `updateOutfitItem(id, formData)` → 성공 시 list 에서 해당 아이템 교체.
- 행 액션: `[수정]` (폼에 prefill, mode=edit), `[삭제]` (confirm 후 `deleteOutfitItem(id)`).
- 빈 상태: "아직 등록한 아이템이 없습니다. 위 폼에서 첫 아이템을 추가해보세요."
- 로깅 규약 (재강조):
  - useEffect/이벤트 핸들러/API 호출 지점에 `console.info("[ItemManagePage] calling …", {…})` + try/catch 의 catch 에 `console.error("[ItemManagePage] xxx failed", {err, ctx})`.
  - DEV 가드 (`if (import.meta.env.DEV)`) — `console.error` 는 항상.
  - 사용자에게는 일반 메시지, 콘솔에는 상세.

### 테스트 항목 (tester)
1. 회귀 / 인프라:
   - `GET /api/health` 200.
   - 기존 `/api/character/sheets`, `/api/character/outfits?role=&style=&category=`, `/api/character/preview/{path}` 회귀 정상.
   - 위저드 Step 1 캐릭터 시트 패널 정상 표시 (v4 회귀).
2. POST /outfits (생성):
   - 유효 입력으로 201/200 응답. 응답 본문에 `id`, `preview_url`, `created_by==self`.
   - MinIO 객체 `outfits/user/{user_id}/{uuid}.{ext}` 존재.
   - Mongo `wedding_outfit_items.findOne({_id: <id>})` 에서 `created_by=user_id, source="user"`.
   - 잘못된 role/style/category → 400. 큰 파일 → 400. 빈 image → 400.
3. GET /outfits (전역) 통합:
   - 기존 `?role=groom&style=casual&category=top` 호출 시 신규 사용자 아이템이 시드 4개 와 함께 반환 (총 5+).
   - 다른 사용자 계정에서도 동일하게 보임 (전역 가시성 확인).
4. GET /outfits/mine:
   - 본인 아이템만 반환. 다른 사용자 계정의 아이템은 보이지 않음.
5. PUT /outfits/{id}:
   - 본인 아이템 수정 → 200. name/category 변경, 이미지 교체 모두 확인.
   - 다른 사용자 아이템 PUT → 403 `"본인 아이템만 수정할 수 있습니다."`.
   - 이미지 교체 시 이전 MinIO 객체 사라짐 확인 (best-effort — 실패해도 응답은 200).
6. DELETE /outfits/{id}:
   - 본인 아이템 → 200, mongo 에서 사라짐, MinIO 객체 사라짐.
   - 다른 사용자 아이템 → 403.
   - 시드 아이템 DELETE 시도 → 403 (`created_by != user_id`, seed 는 null).
7. 위저드 통합:
   - 사용자가 신규 아이템 등록 → 위저드 Step 1 의 OutfitSelectPage(`/outfits/groom/casual/top`) 에 그 아이템이 시드 4개와 함께 나타남.
8. 로깅:
   - 백엔드 log 파일에 `[CharRoute] /outfits POST entry user_id=… role=…` info 라인 출현.
   - 프론트 콘솔에 `[ItemManagePage] calling createOutfitItem` info 라인 출현.

### 영향·회귀 (변경이 줄 수 있는 영향)
- 기존 시드 doc 에 `created_by` 필드 없음 → `GET /outfits/mine` 의 `{created_by: user_id}` 필터로 자연히 제외됨. 시드 안전.
- 기존 `GET /outfits` 는 코드 변경 없음 — 응답 페이로드도 그대로(기존 필드만 노출). `product_url`/`created_by` 는 OutfitSelectPage 에서 무시 가능.
- `[아이템관리]` nav 링크 추가로 헤더 레이아웃 변경 — 모바일 폭에서 줄바꿈 확인 필요.
- ProtectedRoute 새 라우트 `/items` — 비로그인 상태에서 접근 시 기존 ProtectedRoute 로직대로 /login 으로 리다이렉트.

### 후속 (이번 작업 범위 아님)
- product_url 클릭 → 외부 쇼핑 페이지 새 탭 열기 (위저드 OutfitSelectPage 에서 응답에 url 포함 시 자연스럽게 추가 가능). 본 v5 에서는 등록만 다룸.
- 활성/비활성 토글(`is_active`) 컬럼 — 사용자가 요구하지 않음. 하드 삭제만으로 충분.

---

## v6 — 2026-05-24 — 시트 생성 비동기 잡 + 넉넉한 타임아웃

### 요청 작업
- 캐릭터 시트 generate/refine 을 **fire-and-poll 백그라운드 잡 패턴** 으로 전환 (가사·음악 잡 패턴 그대로 재활용).
- 이유: 현재 동기 호출은 OpenAI GPT Image 2 가 2~5분 걸리는 동안 HTTP 연결을 유지해야 하는데, Tailscale/브라우저/프록시 어디든 idle-socket timeout 으로 끊기면 백엔드는 200 OK 보내도 클라이언트는 못 받음(실제 발생). 비동기 잡 + 폴링으로 전환하면 끊김에 강건.
- 타임아웃은 **아주 넉넉하게** (사용자 명시: "gpt image2는 고화질이라 오래걸리더라고") → openai_image 1800s → 3600s, character_generator Gemini text 120s → 300s.

### Plan verification findings (0단계 분석 결과)
- **기존 가사·음악 잡 패턴 (참고 모델)** — `backend_8000/app/routes/mv.py`:
  - `mv.py:108-129` — `POST /api/mv/jobs` 가 mongo `mv_jobs` insert + `asyncio.create_task(_run_lyrics_generation(job_id))` + 즉시 `{job_id, status}` 반환.
  - `mv.py:53-105` — `_run_lyrics_generation(job_id)` 가 mongo find → 외부 호출 → mongo update("lyrics_ready") 또는 except 시 update("lyrics_failed", error_message).
  - `mv.py:140-154` — `GET /api/mv/jobs/{job_id}` 폴링 엔드포인트. 본인 잡만 반환.
  - `mv.py:208-241` — 음악도 같은 패턴 (`_run_music_generation`).
  - Frontend `GenerationStatusPage.jsx:6` — `POLL_INTERVAL_MS = 5000` + `TERMINAL_STATUSES` 셋 + setInterval. 이미 검증된 UX 패턴.

- **현재 시트 생성 (`backend_8000/app/routes/character.py`)**:
  - `character.py:193-364` — `POST /sheets/generate` 가 **동기**. `await generate_character_sheet(...)` 끝날 때까지(2~5분) HTTP 연결 유지. 그 다음 MinIO put → 응답.
  - `character.py:518-688` — `POST /sheets/refine` 도 동일.
  - 두 엔드포인트 모두 input file (face/photo) 를 multipart 로 받음 → 비동기 잡으로 바꾸려면 input 을 **잡 시작 직후 즉시 MinIO 임시 저장** 후 jobs 컬렉션에 object_name 만 기록해야 함 (백그라운드 태스크가 UploadFile 객체를 못 받음 — request 종료 후 파일 닫힘).

- **`openai_image.py:79, 116`** — 두 곳 다 `httpx.AsyncClient(timeout=1800.0)`. 3600s 로 상향.
- **`character_generator.py`** — Gemini text 호출 위치(`_call_gemini_text`)와 Gemini image 호출 위치(`_call_gemini_image`) 의 timeout 도 확인 후 상향 필요.
- **Mongo 스키마리스** — 신규 `wedding_sheet_jobs` 컬렉션 자유 생성.
- **MinIO** — face/photo 임시 저장 prefix: `characters/temp/{user_id}/{role}_{style}/input_{uuid}.{ext}`.
- **Frontend**: `CharacterSheetPanel.jsx:109-152` `handleGenerate` 는 await 끝까지 기다림. 폴링 패턴으로 교체 + sessionStorage 에 job_id 영속화(새로고침 후 재개) + 경과 시간 표시.

### 사양 확정
- **새 엔드포인트** (기존 동기 endpoint 의 동작을 비동기로 교체):
  - `POST /api/character/sheets/generate` — multipart 입력 동일. **응답이 `{job_id, status:"queued"}` 로 변경** (백워드 호환 깨짐, 프론트도 동시 변경하므로 OK).
  - `POST /api/character/sheets/refine` — 동일 패턴 변경.
  - `GET /api/character/sheets/jobs/{job_id}` — 신규. 본인 잡만 반환.
- **타임아웃 상향**:
  - `openai_image.py` 두 호출: 1800s → **3600s (60분)**.
  - `character_generator.py` Gemini text 호출: 120s → **300s (5분)**.
- **잡 상태**: `queued` → `running` → `done` | `failed`. (가사 잡의 `generating_lyrics`/`lyrics_ready`/`lyrics_failed` 와 패턴 동일.)
- **Frontend 폴링 간격**: 5초 (가사 잡과 동일).
- **새로고침 / 라우트 이탈 후 복귀**: job_id 가 sessionStorage 에 들어있으면 mount 시 자동으로 폴링 재개.

### 변경 매트릭스

#### Backend (`backend_8000`)
| 파일 | 변경 | 추적자 prefix |
|---|---|---|
| `app/routes/character.py` | **수정** — `POST /sheets/generate` 와 `POST /sheets/refine` 를 비동기 잡 패턴으로 교체: input 받자마자 MinIO 임시 put → mongo `wedding_sheet_jobs` insert → `asyncio.create_task` → `{job_id, status}` 즉시 반환. 신규 `GET /sheets/jobs/{job_id}`. 백그라운드 함수 `_run_sheet_generation(job_id)`, `_run_sheet_refinement(job_id)` 추가. | `[CharRoute]` `[SheetJob]` (+`user_id`, `job_id`, `role`, `style`) |
| `app/services/openai_image.py` | 두 곳 timeout 1800 → **3600**. 로그 추가 (시간 추적). | `[OpenAIImage]` |
| `app/services/character_generator.py` | Gemini text 호출 timeout 상향. (image 호출은 Gemini Nano Banana 라 기존 180s 가 OK — 확인 후 필요 시 상향.) | `[CharGen]` |

세부:
- `wedding_sheet_jobs` 스키마:
  ```
  {
    _id, user_id, type: "generate"|"refine",
    role, style, image_model, user_text,
    status: "queued"|"running"|"done"|"failed", progress: int,
    // generate
    face_object_name, top_image_object_name, bottom_image_object_name, shoes_image_object_name,
    // refine
    source_sheet_object_name, photo_object_name, refine_request,
    // result
    sheet_object_name, error_message,
    created_at, updated_at
  }
  ```
- `_run_sheet_generation(job_id)`:
  1. mongo find → status="running", updated_at 갱신.
  2. face / outfit refs 를 MinIO 에서 다시 load (object_name → bytes).
  3. `await generate_character_sheet(...)` 호출.
  4. 결과 PNG 를 MinIO `characters/temp/{user_id}/{role}_{style}/{uuid}.png` 에 put.
  5. status="done", sheet_object_name 기록.
  6. except: status="failed", error_message=str(e)[:500].
- `_run_sheet_refinement(job_id)`: 동일 패턴.
- 입력 검증/소유권 체크는 잡 생성 시점에 수행 (기존 로직 재사용). 잡 시작 후 발생하는 외부 에러는 `failed` 로 기록.

#### Frontend (`frontend/src`)
| 파일 | 변경 | 컴포넌트 prefix |
|---|---|---|
| `api/index.js` | 신규 함수 `getSheetJob(jobId)` 추가. `generateCharacterSheet`, `refineCharacterSheet` 시그니처 변경 없음(응답 본문만 `{job_id}` 형태로 변경). | n/a |
| `components/CharacterSheetPanel.jsx` | `handleGenerate` 와 `handleRefine` 를 fire-and-poll 로 교체. job_id 를 slot state 에 저장(`generate_job_id`, `refine_job_id`). 폴링 useEffect: 5초 간격, `done/failed` 시 stop. 경과 시간 표시. 컴포넌트 unmount/언락 시 interval clean-up. | `[CharSheetPanel:{role}_{style}]` (+ `job_id`) |
| `pages/StoryWizardPage.jsx` (선택) | `sanitizeSheetsForStorage` 가 `generate_job_id` / `refine_job_id` 는 보존하도록 수정 — 새로고침 후 재개 위해. (`generating`/`refining` 자체는 폴링이 재시작될 때 자동 true.) | `[StoryWizard]` |

로깅 규약 (재강조):
- 백엔드: `[SheetJob]` 으로 백그라운드 태스크 라이프사이클 로깅. 모든 라인에 `job_id`, `user_id`, `role`, `style`. 단계: `queued`, `running`, `loading face/outfits`, `calling generate_character_sheet`, `result_bytes=N`, `minio put`, `done` / `failed (exc=...)`.
- 프론트: 폴링 시작 / 각 폴링 응답 status / 최종 done/failed 모두 `console.info`. catch 는 `console.error`. DEV 가드 적용.

### 테스트 항목 (tester)
1. 회귀:
   - `GET /api/health` 200.
   - 가사·음악 잡 패턴 정상 (`GET /api/mv/jobs` 200).
   - 기존 `/api/character/outfits` 정상 (시드 + 사용자 아이템).
   - `/api/character/sheets` (저장된 시트 메타 조회) 정상.
2. 비동기 잡 흐름 (generate):
   - `POST /sheets/generate` 멀티파트 → **2초 이내** 200 응답에 `{job_id, status:"queued"}` 포함.
   - 즉시 `GET /sheets/jobs/{id}` → `status` ∈ {queued, running}.
   - 1분 간격으로 두세 번 폴링 → status 변화 추적.
   - 종료 시 `status:"done"` + `sheet_object_name`, `preview_url` 노출.
   - `GET /preview/{sheet_object_name}` → 200 PNG.
3. 비동기 잡 흐름 (refine):
   - 같은 패턴 — POST 즉시 응답, 폴링, done.
4. 실패 시나리오:
   - 일부러 잘못된 image_model 보내면 → POST 단계에서 400 (잡 생성 안 됨).
   - OPENAI_API_KEY 없는 환경에서 generate → 잡은 만들어지지만 status="failed", error_message="OPENAI_API_KEY is not configured" 가 폴링에서 보여야 함.
5. 소유권:
   - 다른 사용자 잡 `GET /sheets/jobs/{id}` → 403.
6. 타임아웃:
   - 백엔드 코드 검사: `httpx.AsyncClient(timeout=3600.0)` 두 곳, character_generator Gemini text 300s. 직접 호출 안 해도 됨 — grep 확인으로 충분.
7. 새로고침 재개 (수동, 가능하면):
   - 시트 생성 시작 → 폴링 중 페이지 새로고침 → 같은 슬롯에서 `생성 중` 다시 보임 → 완료 시 결과 노출.
   - sessionStorage 에 `generate_job_id` 가 보존됨.
8. 로깅:
   - `grep "\[SheetJob\]" /tmp/mv_backend_8000.log` → 백그라운드 태스크 라이프사이클 라인들 출현 (queued/running/done).
   - 프론트 콘솔: `[CharSheetPanel:...] starting poll`, `[CharSheetPanel:...] poll #N status=...`, `[CharSheetPanel:...] poll done` 등.

### 영향·회귀
- `/sheets/generate`, `/sheets/refine` 응답 본문 변경 — backward-incompatible 이지만 프론트도 동시 변경하므로 안전.
- 가사·음악 잡, OutfitSelectPage, ItemManagePage, /character/couple stub 무영향.
- mongo 신규 컬렉션 `wedding_sheet_jobs` 추가 — 기존 컬렉션 영향 없음.
- MinIO temp prefix `characters/temp/.../input_*` 사용 — 기존 prefix 와 겹침 없음. (저장 확정 후 임시 객체는 그대로 둠 — cleanup job 은 본 v6 범위 밖.)

### 후속 (이번 범위 밖)
- temp MinIO 객체 정리 cron (현재는 누적).
- 잡 progress 0~100 세분화 (현재는 queued/running/done 만).
- 잡 동시성 제한 (사용자당 1개 슬롯 동시 1개) — 사용자 요구 없음, 필요 시 추가.
