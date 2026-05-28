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


## v7 — 2026-05-26 — 시트 display_name + 장소 이미지 자산 + wedding_assets 통합 컬렉션

### 사용자 요구
1. 캐릭터 시트 4슬롯 각각에 "시트 이름" (`display_name`) 입력칸 추가 — 예: "평상복 신랑", "턱시도 신랑".
2. 캐릭터 시트 4슬롯 그리드 **바로 밑**에 신규 "장소 이미지 자산" 섹션 추가. 사용자가 `[+ 장소 추가]` 로 슬롯을 N개 만들고, 슬롯마다:
   - "장소 이름" (`display_name`) — 예: "한강 카페"
   - "메모" (선택) — 프롬프트 조립용
   - 이미지 업로드 OR 이미지 생성 (모델 선택: `gpt_image_2` (기본) / `nb_pro`) — fire-and-poll 비동기 잡 패턴
   - 삭제 버튼
3. Mongo `wedding_assets` 단일 컬렉션으로 두 자산을 통합 관리.
   - 시트 저장(`/sheets/save`) 시 자산 자동 등록(type=`character_sheet`).
   - 장소 업로드/생성 시 자산 자동 등록(type=`place`).
   - 추후 영상 자동 생성 단계에서 이 컬렉션을 단일 진입점으로 사용.

### Plan verification findings (현재 코드 사실, 2026-05-26 기준)

**백엔드 코드 확인:**
- `backend_8000/app/routes/character.py`
  - `SaveSheetRequest` (라인 186): `sheet_object_name`, `role`, `style`, `used_items`, `image_model`, `user_text` 만 받음 — `display_name` 필드 **없음**.
  - `POST /sheets/save` (라인 715–863): `slot_doc` (라인 818–824) 에 `sheet_object_name`, `used_items`, `image_model`, `user_text`, `updated_at` 만 기록.
  - `_run_sheet_generation` (라인 261–377): 완료 시 `wedding_sheet_jobs` 만 업데이트 — 자산 컬렉션 hooked **없음**.
  - `GET /sheets` (라인 1139–1172): 응답 슬롯에 `display_name` 미포함.
  - 라우터 prefix: `/api/character`.
- `backend_8000/app/routes/assets.py`: `POST /api/assets/upload` (kind=photo|audio|video) 만 존재. Mongo 미연동, 단순 MinIO put.
- `backend_8000/app/main.py`: `from .routes import auth, story, mv, character, assets, share` (라인 25). 신규 라우터 import + include_router 1줄 추가 필요.
- `backend_8000/app/services/openai_image.py`: `generate_image(prompt, ref_images, size, quality)` (라인 144 가정) — 장소 이미지 생성에 재사용 가능.
- `backend_8000/app/services/character_generator.py`: `_call_gemini_text` (timeout 300s) 가 텍스트 프롬프트 합성에 사용됨 — 장소 프롬프트는 단순 조립이라 별도 LLM 호출 불필요.
- `backend_8000/app/config.py`: MinIO 버킷 `mv-wedding-photos` 하나가 사진·이미지 공용. 장소 이미지도 동일 버킷의 `places/{user_id}/{place_id}.png` prefix 로 둘 예정.
- `backend_8000/app/database/mongodb.py`: `get_mongo()` → `AsyncIOMotorDatabase`, 동적 컬렉션 접근 (`mongo.wedding_assets`).

**프론트엔드 코드 확인:**
- `frontend/src/api/index.js`
  - 라인 60–84: 시트 관련 API (`generateCharacterSheet`, `saveCharacterSheet`, `refineCharacterSheet`, `getCharacterSheets`, `getSheetJob`).
  - 라인 89–107: 의상 CRUD (`createOutfitItem`, `getMyOutfitItems`, `updateOutfitItem`, `deleteOutfitItem`).
  - 라인 112–115: `sheetPreviewUrl(objectName)` — `?token=...` 쿼리 포함 절대 URL 빌더. **장소 이미지 미리보기에도 그대로 재사용**.
  - 라인 118–125: `uploadAsset(file, kind='photo')` — 사전 업로드. 장소 이미지 업로드 시에도 그대로 사용 가능.
- `frontend/src/pages/StoryWizardPage.jsx`
  - 라인 22–46: `emptySheetSlot()` — 시트 슬롯 초기 객체. `display_name: ''` 추가 필요.
  - 라인 49–75: `sanitizeSheetsForStorage` — `display_name` 보존.
  - 라인 123–131: `mergeSheets` — 새 슬롯 필드 자동 머지.
  - 라인 163–199: `initialData()` — 신규 `places: []` 추가 필요.
  - 라인 536–556: Step1 캐릭터 시트 그리드 `.sheets-block`. 닫힘 `</div>` 직후, `</div>` 닫기 직전(라인 556) 에 `<PlaceAssetPanel ... />` 삽입.
  - sessionStorage 키: `DRAFT_KEY = 'wedding-wizard-draft'`.
- `frontend/src/components/CharacterSheetPanel.jsx`
  - 라인 24: `prefix = `[CharSheetPanel:${role}_${style}]``.
  - 라인 588–597: `user_text` input — 그 바로 위(라인 587 직전)에 `display_name` 입력칸 삽입.
  - 라인 160–175: `buildBaseFormData` — `display_name` append 추가.
  - 라인 227–266: `handleSave` — `saveCharacterSheet({..., display_name})` 페이로드에 추가.

**갭/충돌:**
- `wedding_assets` 컬렉션 — 현재 없음, 신설.
- 시트 잡 완료 콜백에 자산 등록 훅 없음 — `_run_sheet_generation` 의 status="done" 업데이트 시점에는 **temp 경로**라 자산 등록 부적합. 자산 등록은 `/sheets/save` (permanent 복사 직후) 에서 수행하는 게 자연스러움 → **결정: `/sheets/save` 에서 자산 upsert**.
- 장소 이미지 fire-and-poll: 시트와 동일 패턴 적용 — `wedding_place_jobs` 컬렉션, `_run_place_generation` 백그라운드 태스크.
- 장소 슬롯의 "이미지 업로드" 는 동기 — 업로드 + 자산 insert 한 번에. 잡 불필요.
- 장소 슬롯의 "이미지 생성" 만 잡 패턴.
- MinIO prefix 충돌: `places/{user_id}/...` 기존 prefix 와 겹침 없음. temp 는 `places/temp/{user_id}/...`.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/routes/character.py` | (a) `SaveSheetRequest` 에 `display_name: Optional[str] = None` 추가. (b) `/sheets/save` 의 `slot_doc` 에 `display_name` 기록. (c) `/sheets/save` 완료 시 `wedding_assets` upsert(type=character_sheet, key=(user_id, role, style)). (d) `GET /sheets` 응답 슬롯에 `display_name` 포함. |
| 2 | `backend_8000/app/routes/places.py` (신설) | 라우터 prefix `/api/places`. 엔드포인트: `POST /upload`(파일 업로드 → place asset insert), `POST /generate`(잡 시작), `GET /jobs/{job_id}`(폴링), `GET /` (내 장소 자산 list), `PUT /{place_id}` (이름/메모 수정), `DELETE /{place_id}` (자산 + MinIO 정리). 디버그 로그 prefix `[PlaceRoute]`, 추적자 `place_id`, `job_id`. |
| 3 | `backend_8000/app/services/place_generator.py` (신설) | `generate_place_image(display_name, memo, image_model, user_id, place_id) -> bytes`. 내부에서 simple prompt 합성 → `openai_image.generate_image` 또는 Gemini 3 Pro Image. 로그 prefix `[PlaceGen]`, 추적자 `place_id`. |
| 4 | `backend_8000/app/main.py` | `from .routes import ..., places` + `app.include_router(places.router)` 1줄. |
| 5 | `backend_8000/app/routes/assets.py` | 변경 없음 (재사용). |
| 6 | `frontend/src/api/index.js` | 신규 함수: `createPlaceUploaded(formData)`, `generatePlace({display_name, memo, image_model})`, `getPlaceJob(jobId)`, `listPlaces()`, `updatePlace(placeId, payload)`, `deletePlace(placeId)`. `saveCharacterSheet` 페이로드에 `display_name` 사용처는 호출부에서 처리. 타임아웃: 업로드 30s 기본, 생성 잡 시작은 ~10s, 폴링은 기본. |
| 7 | `frontend/src/components/CharacterSheetPanel.jsx` | (a) `user_text` 입력 위에 "시트 이름" 입력칸 추가 (placeholder: "예: 평상복 신랑"). (b) `buildBaseFormData` 에 `display_name` append. (c) `handleSave` 에서 `saveCharacterSheet` 페이로드에 `display_name` 추가. 로그 prefix 기존 `[CharSheetPanel:${role}_${style}]` 유지. |
| 8 | `frontend/src/components/PlaceAssetPanel.jsx` (신설) | 카드형 슬롯 N개 + `[+ 장소 추가]` 버튼. 각 슬롯: display_name input, memo textarea, 이미지 dropzone or 생성 버튼(모델 선택), 미리보기, 삭제. fire-and-poll: 잡 생성 시 polling 시작 (`getPlaceJob`). 로그 prefix `[PlaceAssetPanel:${place_id}]`, 추적자 `place_id`, `job_id`. |
| 9 | `frontend/src/components/PlaceAssetPanel.css` (신설) | 스타일. |
| 10 | `frontend/src/pages/StoryWizardPage.jsx` | (a) `emptySheetSlot()` 에 `display_name: ''` 추가. (b) `sanitizeSheetsForStorage` + `mergeSheets` 로 보존(자동). (c) `renderStep1` 에서 `.sheets-block__grid` 닫힘 `</div>` 다음에 `<PlaceAssetPanel ... />` 삽입. PlaceAssetPanel 은 자체적으로 `listPlaces` 로 서버에서 자산을 끌어와 렌더(sessionStorage 의존 안 함 — 자산이 서버 단일 진실의 원천). |

### 데이터 모델

**Mongo `wedding_assets` (신설)**
```
{
  _id: ObjectId,
  user_id: str,
  type: "character_sheet" | "place",
  display_name: str,        # 사용자 지정 (없으면 빈 문자열)
  source: "uploaded" | "generated",
  object_name: str,         # MinIO 키 (mv-wedding-photos 버킷)
  meta: {
    # character_sheet
    role:  "groom"|"bride",
    style: "casual"|"wedding",
    image_model: "gpt_image_2"|"nb_pro",
    sheet_id: <wedding_character_sheets._id>,
    # place
    memo: str,
    prompt_used: str (optional)
  },
  created_at, updated_at
}
```
- 인덱스: `(user_id, type, created_at)` 정렬용. character_sheet 는 `(user_id, role, style)` 로 upsert 키 사용.

**Mongo `wedding_place_jobs` (신설)**
```
{
  _id: ObjectId,
  user_id, place_id (자산 _id 와 동일),
  type: "generate",
  status: "queued"|"running"|"done"|"failed",
  image_model: "gpt_image_2"|"nb_pro",
  display_name, memo,
  object_name: str | None (완료 시),
  error_message: str | None,
  created_at, updated_at
}
```

**MinIO 경로**
- 장소 temp: `places/temp/{user_id}/{place_id}_{uuid}.png`
- 장소 permanent: `places/{user_id}/{place_id}.png`

### 백엔드 API 명세

**`POST /api/places/upload`** (multipart)
- Body: `image: File`, `display_name: str`, `memo: str = ""`
- 처리: MinIO put → `wedding_assets` insert(type=place, source=uploaded).
- 응답: `{place_id, display_name, memo, object_name, preview_url, source:"uploaded"}`

**`POST /api/places/generate`** (JSON or Form — JSON 권장)
- Body: `{display_name: str, memo: str = "", image_model: "gpt_image_2"|"nb_pro"}`
- 처리: place asset pre-insert(status=pending) + job insert + asyncio.create_task → 즉시 반환.
- 응답: `{place_id, job_id, status:"queued"}`

**`GET /api/places/jobs/{job_id}`**
- 응답: `{job_id, place_id, status, display_name, image_model, object_name, preview_url, error_message, created_at, updated_at}`

**`GET /api/places`**
- 응답: `{items: [{place_id, display_name, memo, source, object_name, preview_url, image_model, created_at}, ...]}`

**`PUT /api/places/{place_id}`**
- Body: `{display_name?: str, memo?: str}` — 이름/메모만 수정.
- 응답: 갱신된 자산 객체.

**`DELETE /api/places/{place_id}`**
- 처리: 소유자 검증 후 자산 doc 삭제 + MinIO 객체 best-effort 삭제.
- 응답: `{ok: true}`

### 디버깅 로그 명세 (추적자)

| 모듈 | prefix | 추적자 |
|------|--------|--------|
| `routes/places.py` | `[PlaceRoute]` | `user_id`, `place_id`, `job_id` |
| `services/place_generator.py` | `[PlaceGen]` | `user_id`, `place_id`, `image_model` |
| `routes/character.py` (변경분) | `[CharRoute]` (기존), 신규 라인에 `display_name_len` 포함 | `user_id`, `role`, `style` |
| Frontend `PlaceAssetPanel` | `[PlaceAssetPanel:${place_id}]` | `place_id`, `job_id` |
| Frontend `CharacterSheetPanel` (변경분) | `[CharSheetPanel:${role}_${style}]` (기존) | + `display_name_len` |

민감 정보 금지: 토큰·API 키·전체 프롬프트 본문 출력 금지(길이만).

### 테스트 시나리오 (테스터에게 전달)

**시트 display_name:**
1. 4슬롯 각각에 시트 이름 입력 → 시트 생성(빠른 모델 또는 기존 결과 재사용) → 저장.
2. 페이지 새로고침 → 4슬롯 모두 입력했던 이름 그대로 노출(`GET /sheets` 응답에 `display_name` 포함).
3. 빈 시트 이름 허용(빈 문자열 OK).

**장소 자산 라이프사이클:**
4. `[+ 장소 추가]` → 슬롯 등장.
5. 슬롯에 장소 이름 "한강 카페" 입력 → 이미지 업로드(JPG) → 미리보기 렌더.
6. `[+ 장소 추가]` 2번째 → "남산 N타워" 입력 → "이미지 생성"(gpt_image_2) → 폴링 → done → 미리보기.
7. 슬롯 이름 수정 → `PUT /places/{id}` → 즉시 반영.
8. 슬롯 삭제 → `DELETE /places/{id}` → DOM 에서 사라짐.
9. 페이지 새로고침 → `GET /places` 호출 → 모든 장소 슬롯 복원(서버가 진실의 원천).

**`wedding_assets` 검증 (백엔드 로그/Mongo 직접):**
10. 시트 저장 후 `mongo wedding_assets` 에 type=character_sheet doc 존재.
11. 장소 업로드/생성 후 type=place doc 존재.
12. 장소 삭제 시 자산 doc 삭제 + MinIO 객체 정리 로그 확인.

**회귀:**
13. 기존 시트 생성/리파인/저장 흐름 정상.
14. 의상 관리(ItemManagePage) CRUD 정상.
15. 위자드 Step2~5 정상.
16. 토큰 없이 `/api/places/*` 호출 → 401.
17. 다른 사용자 place_id → `PUT`/`DELETE`/`GET jobs` 모두 403.
18. 이미지 모델 검증: `gpt_image_2` 키 없으면 503, `nb_pro` 키 없으면 503.

**로그 검증:**
19. `grep "\[PlaceRoute\]" /tmp/mv_backend_8000.log` 에서 entry/ok 라인 출현(place_id 포함).
20. `grep "\[PlaceGen\]" /tmp/mv_backend_8000.log` 에서 잡 라이프사이클 라인.
21. 프론트 콘솔: `[PlaceAssetPanel:...] ...` prefix 로 grep 가능.

### 영향·회귀
- `/sheets/save` 응답에 `display_name` 추가 — 프론트 동시 변경이라 호환.
- `wedding_assets` 신규 컬렉션 — 기존 컬렉션 무영향.
- 기존 시트 잡(`_run_sheet_generation`) 변경 없음 — temp 경로 단계, 자산 등록은 save 시점만.
- MinIO `places/...` 신규 prefix — 기존과 겹침 없음.

### 후속 (이번 범위 밖)
- 자산 → 영상 자동 조립.
- 자산 검색/태그.
- 장소 자산에도 refine(보정) 기능.


## v8 — 2026-05-26 — story 텍스트에 @-멘션 자동완성 (캐릭터 시트 + 장소 자산 태깅)

### 사용자 요구
스토리위자드 Step2 의 텍스트 입력란(첫 만남, 첫 데이트, 추억들, 결혼 결심, 웨딩 준비, 둘만의 단어·장소) 에 `@` 입력 시 자동완성 팝업이 떠서, 미리 만들어 둔 **캐릭터 시트 4종 + 장소 자산 N개** 중 하나를 선택하면 본문에 `@평상복 신랑`, `@한강 카페` 형태로 칩 형태 멘션이 삽입된다. 본문은 사람이 읽을 수 있는 자연어 그대로 보관하고, 각 입력 옆에 `refs` 메타데이터(어떤 자산을 참조했는지 type+asset_id+display_name+object_name)를 별도 배열로 저장. 추후 영상 자동 생성 시 프롬프트 컨텍스트로 명시 주입해 모호함을 제거하는 게 목적.

### Plan verification findings (현재 코드 사실, 2026-05-26 기준)

**백엔드:**
- `backend_8000/app/models/story.py` — `StoryDetails` 는 단순 `str | list[str]` 필드만. refs 없음. 6개 시점 필드: `meeting, first_date, memories, proposal, wedding_prep, rituals`.
- `backend_8000/app/routes/story.py` — `POST /api/story` 는 `body.model_dump()` 그대로 mongo `stories` 컬렉션에 insert. 갱신/검증 없음. `GET /api/story/{story_id}` 는 doc 그대로 응답.
- 자산 후보 풀:
  - 캐릭터 시트: `GET /api/character/sheets` 가 4슬롯(`groom_casual, groom_wedding, bride_casual, bride_wedding`) dict 반환. 각 슬롯에 `sheet_object_name, display_name, image_model, user_text, updated_at` (v7 에서 `display_name` 추가됨).
  - 장소 자산: `GET /api/places` 가 `{items:[{place_id, display_name, memo, source, object_name, preview_url, image_model, created_at}, ...]}` 반환 (v7 신설).
- 기존 가사 생성기(`services/lyrics_generator.py`)는 story dict 의 알려진 키만 읽으므로 `*_refs` 필드 추가는 무시되어 회귀 없음 (Python dict 키 무시).

**프론트엔드:**
- `frontend/src/pages/StoryWizardPage.jsx`
  - 라인 167–176: `data.story` 초기 객체. `memories: ['']` 동적 리스트.
  - 라인 405–432: `buildPayloads` 의 `storyPayload.story` — 본문 6필드만. refs 미전송.
  - 라인 560–624: Step2 렌더 — `SceneInput` 5회 + `DynamicList`(memories) 1회 + `textarea`(rituals) 1회.
- `frontend/src/components/SceneInput.jsx` — 단순 `<textarea value onChange placeholder>` 래퍼. mention 처리 없음.
- `frontend/src/components/DynamicList.jsx` — 항목별 `<textarea value onChange>` + 삭제 버튼. mention 처리 없음.
- `frontend/src/api/index.js` — `createStory, getStory` 존재. 후보 풀 fetch 함수: `getCharacterSheets`, `listPlaces` 모두 존재.
- 원격 로깅 인프라 없음 — `console.*` 로 진행.

**갭/충돌:**
- 새 컴포넌트 `MentionField` 필요 — `<textarea>` 위에 오버레이 트릭으로 칩 하이라이트 + `@` 트리거 팝업.
- `SceneInput`, `DynamicList`(memories), `rituals` 자유 textarea 3종을 `MentionField` 기반으로 교체. 단, **외부 시그니처(onChange(string))는 깨지 말고**, 추가로 `refs` 전달용 부 시그니처(`onChangeRefs(refs[])`) 를 부수적으로 노출. 기존 호출부 손상 최소화.
- `memories` 는 항목별 본문 + 항목별 refs → parallel array `memories_refs: list[list[MentionRef]]` (길이는 본문 배열과 동일).
- 후보 풀 조회: 통합 엔드포인트는 만들지 않고 **클라이언트가 `getCharacterSheets` + `listPlaces` 둘을 mount 시 호출해 합침**. 백엔드 추가 라우트 없음 → 변경 면적 최소화.
- `wedding_assets` 의 character_sheet 도 asset_id 를 갖지만, MentionRef 의 `asset_id` 는 슬롯 기반(`groom_casual` 등)으로도 충분 — 어차피 슬롯 키가 유일성을 보장하고 UI 가 같은 정보로 즉시 참조 가능. 일관성 차원에서 `asset_id` 는 type 별로 다른 의미를 가짐:
  - `type="sheet"`: asset_id = 슬롯 키(`groom_casual` 등).
  - `type="place"`: asset_id = `wedding_assets._id` 문자열.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/models/story.py` | `MentionRef` 모델 신설 (`type: Literal["sheet","place"]`, `asset_id: str`, `display_name: str`, `object_name: str \| None = None`). `StoryDetails` 에 `meeting_refs`, `first_date_refs`, `memories_refs`(list of list), `proposal_refs`, `wedding_prep_refs`, `rituals_refs` 6개 필드 추가 (모두 `Field(default_factory=list)`, 옵션). |
| 2 | `backend_8000/app/routes/story.py` | `GET /api/story/{id}` 응답에 별도 처리 불필요(이미 doc 그대로 응답). 단, 로그에 `mention_count` 요약 추가(`meeting_refs len + memories_refs total + ... `). `POST` 도 entry 로그에 `total_mentions=N` 토큰. |
| 3 | `frontend/src/components/MentionField.jsx` (신설) | `<textarea>` 기반 자체 입력 필드. props: `{value: string, refs: MentionRef[], onChange(value), onChangeRefs(refs), options: [{type, asset_id, display_name, object_name, group_label}], placeholder, rows, ariaLabel}`. 동작: (a) `@` 입력 시 팝업 띄움(textarea caret 위치 기반 절대 좌표). (b) 팝업에 그룹 헤더(🧑 캐릭터 / 📍 장소) + 항목 리스트. (c) 키보드 ↑↓ 탐색, Enter 선택, Esc 닫기. (d) `@` 이후 타이핑은 필터(부분일치). (e) 선택 시 본문에 `@{display_name} ` 삽입, refs 배열에 `{type, asset_id, display_name, object_name}` push. (f) Backspace 로 칩 통째 삭제(본문에서 `@display_name` 토큰 단위로). (g) 칩 하이라이트는 mirror div 오버레이 (`pre-wrap` 동일 폰트로 같은 영역 그려 `@...` 부분에 chip 스타일 span 적용). 로그 prefix `[MentionField]`. |
| 4 | `frontend/src/components/MentionField.css` (신설) | mirror 오버레이 + 칩 스타일 + 팝업 카드 (그림자 + 모서리 둥글림). dark theme 친화. |
| 5 | `frontend/src/components/SceneInput.jsx` | textarea 를 `<MentionField>` 로 교체. 호환을 위해 새 props `refs`, `onChangeRefs`, `options` 받음. 기존 호출부에서 옵션·refs 전달 안 하면 mention 없는 기본 textarea처럼 동작(`options=[]` 또는 undefined → 팝업 비활성). |
| 6 | `frontend/src/components/DynamicList.jsx` | 각 항목을 `MentionField` 로 렌더. props 확장: `refsList: MentionRef[][]`, `onChangeRefs(idx, refs)`, `options`. 부재 시 기본 textarea 동작. 빈 옵션 가드. |
| 7 | `frontend/src/pages/StoryWizardPage.jsx` | (a) `initialData()` story 에 6개 `*_refs` 필드 추가(빈 배열). (b) `loadInitial`/sessionStorage 직렬화는 자동(JSON 가능 타입). (c) Step2 마운트 시 `useEffect` 로 `getCharacterSheets` + `listPlaces` 둘을 병렬 fetch → mentionOptions 빌드(시트 4슬롯 + 장소 N개). 캐싱: 이 페이지 lifetime 동안만, useState. (d) 렌더에서 SceneInput / DynamicList(memories) / rituals textarea 에 `options={mentionOptions}` 전달. rituals 는 기존 자유 textarea 도 `MentionField` 로 교체. (e) `buildPayloads.storyPayload.story` 에 `meeting_refs`, `first_date_refs`, `memories_refs`(각 항목별 refs 배열의 배열), `proposal_refs`, `wedding_prep_refs`, `rituals_refs` 포함. memories 본문 trim 시 빈 항목 제거할 때 refs 도 동일 인덱스 제거. 로그: `[StoryWizard]` prefix 에 `mention_options_count`, `total_mentions_in_payload` 추가. |
| 8 | `frontend/src/api/index.js` | 변경 없음. `getCharacterSheets`, `listPlaces`, `createStory`, `getStory` 그대로 사용. |

### 데이터 모델

**`MentionRef` (Pydantic 백엔드 + JS 객체)**
```
{
  type: "sheet" | "place",
  asset_id: str,        # sheet: slot key("groom_casual" 등) / place: wedding_assets._id
  display_name: str,    # 사용자가 본문에서 본 라벨
  object_name: str | None  # MinIO 키 (영상 생성 단계에서 직접 참조 가능)
}
```

**`StoryDetails` 신규 모양** (기존 6필드 + 6 refs 필드)
```python
class StoryDetails(BaseModel):
    meeting: str
    meeting_refs: list[MentionRef] = Field(default_factory=list)
    first_date: str | None = None
    first_date_refs: list[MentionRef] = Field(default_factory=list)
    memories: list[str] = Field(default_factory=list)
    memories_refs: list[list[MentionRef]] = Field(default_factory=list)
    proposal: str | None = None
    proposal_refs: list[MentionRef] = Field(default_factory=list)
    wedding_prep: str | None = None
    wedding_prep_refs: list[MentionRef] = Field(default_factory=list)
    rituals: str | None = None
    rituals_refs: list[MentionRef] = Field(default_factory=list)
```

**프론트 `data.story` 상태** (StoryWizardPage)
```
story: {
  meeting: '', meeting_refs: [],
  first_date: '', first_date_refs: [],
  memories: [''], memories_refs: [[]],
  proposal: '', proposal_refs: [],
  wedding_prep: '', wedding_prep_refs: [],
  rituals: '', rituals_refs: []
}
```

### MentionField 동작 명세 (프론트엔드 구현 핵심)

1. **트리거**: `onChange` 콜백에서 caret 직전 문자가 `@` 또는 `@<검색어>` 패턴이면 팝업 open.
   - 정규식: `/@([^\s@]{0,30})$/` 매치되는 substring 의 시작 위치 기록(`mentionStart`).
2. **필터**: 매치 그룹 1을 검색어로 사용 → `options.filter(o => o.display_name.toLowerCase().includes(query.toLowerCase()))`.
3. **팝업 렌더**: 그룹 헤더 두 줄(`🧑 캐릭터`, `📍 장소`) + 각 그룹 항목. 그룹 안에서 사전순.
4. **선택**: 본문에서 `@<query>` 구간(`mentionStart`~caret)을 `@<display_name> `(공백 한 칸) 로 치환. refs 에 push. 팝업 닫음. caret 을 치환 끝 위치로 이동.
5. **칩 시각화**: textarea 와 동일 폰트/사이즈/패딩의 `<div class="mention-mirror">` 를 absolute 로 textarea 위에 깔고, `pre-wrap` 으로 동일 줄바꿈. refs.display_name 들을 본문에서 토큰 매칭으로 찾아 `<span class="chip">@한강 카페</span>` 으로 교체 렌더. 본문 변경/스크롤마다 동기화.
6. **칩 삭제**: Backspace 시 caret 직전 칩 토큰(`@display_name`) 통째 삭제(공백 포함). refs 에서 제거.
7. **고스트 칩 정리**: 본문 텍스트에서 display_name 토큰이 사라진 refs 는 (예: 사용자가 직접 텍스트를 편집한 경우) onChange 마다 reconcile — refs 의 display_name 이 본문에 안 나타나면 그 ref 제거. 한 본문에 같은 display_name 이 N번 나타나면 refs 에 그 ref 가 N번 있게 보정.
8. **키보드**: 팝업 열렸을 때 ArrowUp/Down 선택, Enter 확정, Esc 취소, Tab 도 확정 OK.

### 디버깅 로그 명세

| 위치 | prefix | 핵심 키 |
|------|--------|--------|
| Backend `routes/story.py` POST/GET | `[StoryRoute]` (신규 추가) | `user_id`, `story_id`, `total_mentions` |
| Backend `models/story.py` | n/a | 검증은 pydantic |
| Frontend `MentionField.jsx` | `[MentionField:{ariaLabel|id}]` | 트리거 위치, 검색어 길이, 선택한 asset_id+type, reconcile 결과 |
| Frontend `StoryWizardPage.jsx` (변경분) | `[StoryWizard]` (기존) | `mention_options_count`, `total_mentions_in_payload`, fetch 실패 시 fallback 진입 |

민감 정보 금지. dev 가드는 `if (import.meta.env.DEV)` 로 `console.info`. `console.error` 무가드.

### 테스트 시나리오

**A. 후보 풀 fetch**
1. Step2 진입 시 콘솔에서 `[StoryWizard] mention_options_count={N}` 로깅 확인 (시트4 + 장소N).
2. `getCharacterSheets` / `listPlaces` 둘 다 200 응답.

**B. @-멘션 팝업**
3. 첫 만남 textarea 에 텍스트 작성 중 `@` 입력 → 팝업 등장.
4. `@한` 입력 → "한강 카페" 만 남는 필터.
5. ↓ ↓ Enter → 본문에 `@한강 카페 ` 삽입.
6. Esc → 팝업 닫힘, 텍스트는 `@한` 그대로.

**C. 칩 시각화/삭제**
7. 삽입 직후 mirror 오버레이에 chip 스타일 적용된 게 보임(시각).
8. caret 을 칩 직후로 두고 Backspace → `@한강 카페 ` 전체 삭제 + refs 에서도 제거.
9. 같은 display_name 두 번 멘션 → refs 도 두 번 push, 본문에서 한 개만 지우면 refs 도 한 개만 제거.

**D. 전 입력란 적용**
10. 첫 데이트 / 추억(여러 항목) / 결혼 결심 / 웨딩 준비 / 둘만의 단어 모두 동일 동작.
11. memories 두 번째 칸에서 멘션 → `memories_refs[1]` 에만 들어가고 [0] 은 영향 없음.

**E. 영속화**
12. Step2 내용 작성 → Step3 진행 → 새로고침 → Step2 복원 시 본문/칩 그대로.
13. 위자드 끝까지 진행 → `POST /api/story` → 응답 200 + story_id.
14. `GET /api/story/{id}` → 응답에 `meeting_refs`, `memories_refs`(중첩 배열) 등 v8 필드 포함.

**F. 회귀**
15. 멘션 미사용 케이스: refs 모두 빈 배열로 저장 → 200.
16. 가사 생성(`POST /api/mv/jobs`) 정상 시작 — story 의 새 필드는 무시되되 깨지지 않음.
17. v7 시트·장소 UI 모두 정상.
18. sessionStorage 직렬화 깨짐 없음 (refs 가 plain JSON).

**G. 로그**
19. `grep "\[MentionField:" frontend console` 시 트리거/선택/reconcile 라인 확인.
20. 백엔드 `grep "\[StoryRoute\]" /tmp/mv_backend_8000.log` 에서 entry/ok + total_mentions 토큰 확인.

### 영향·회귀
- `models/story.py` 에 옵션 필드 추가만 — 기존 mongo 도큐먼트 read 시 빈 배열로 기본값 적용되어 무해.
- 가사 생성기는 알려진 키만 읽어 영향 없음.
- 위자드 sessionStorage 키 동일 (`wedding-wizard-draft`) — 기존 사용자 reload 시 refs 가 없는 구버전 draft 도 `{...base, ...parsed.data}` spread 로 빈 배열 기본값 적용되어 호환.
- 사용자가 본문에서 `@` 단어 자체를 사용하려는 경우(예: 이메일) — 팝업이 떴다가 Esc/외부 클릭으로 닫힘. 본문 텍스트는 손상 없음.

### 후속 (이번 범위 밖)
- 멘션을 가사/영상 생성 프롬프트에 명시 주입(이번엔 저장만).
- 멘션에 미리보기 hover(썸네일 카드).
- 멘션 자동 추천(스토리 텍스트 기반 자산 제안).


## v9 — 2026-05-26 — 텍스트 다듬기 (Claude 4.7 Opus / GPT 최신, @멘션 보존)

### 사용자 요구
Step2 의 자유 텍스트 6곳(첫 만남, 첫 데이트, 추억 N개, 결혼 결심, 웨딩 준비, 둘만의 단어·장소) 옆에 `✨ 다듬기` 버튼 — 클릭 시 모달이 열려 (a) 모델 선택(Claude 4.7 Opus / GPT 최신) (b) 원본/다듬은 글 좌우 비교 (c) [적용/다시 다듬기/취소]. 다듬기 결과는 `@<멘션>` 토큰 100% 보존 — LLM 시스템 프롬프트로 강제 + 서버측 사후 검증. 영상 자동 생성 단계에서 프롬프트로 쓸 텍스트를 또렷하게 만들기 위함.

### Plan verification findings (현재 코드 사실, 2026-05-26 기준)

**LLM 인프라:**
- `backend_8000/app/services/lyrics_generator.py:11–12`
  - `from anthropic import ...` + `from openai import AsyncOpenAI` — SDK 두 개 모두 이미 import 됨.
  - 라인 43: `_openai_client = AsyncOpenAI(api_key=settings.openai_api_key)`.
  - 라인 50: `_anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)`.
- 라인 524–553: `_generate_via_openai` — `client.chat.completions.create(model, messages=[{system},{user}], temperature, max_tokens)`. 응답 `choices[0].message.content`.
- 라인 556–584: `_generate_via_anthropic` — `client.messages.create(model, system=..., messages=[{user}], max_tokens, temperature)`. `claude-opus-4-7` 만 temperature 미설정(기본값). 응답 `content[0].text`.
- 라인 604–607: 모델 분기 — `chosen_model.startswith("claude-")` 면 Anthropic, 아니면 OpenAI.
- `backend_8000/app/config.py:44–51`:
  - `openai_api_key: str = ""`, `anthropic_api_key: str = ""`.
  - `openai_model: str = "gpt-4o-mini"`, `openai_model_advanced: str = "gpt-5.4"` ← **"GPT 최신" 매핑값**.
  - `wedding_lyrics_default_model: str = "claude-opus-4-7"` ← **"Claude 4.7 Opus" 매핑값**.
- `backend_8000/requirements.txt`: `anthropic`, `openai` 둘 다 이미 존재 — 추가 의존성 불필요.
- `backend_8000/.env.example`: `OPENAI_API_KEY=...`, `ANTHROPIC_API_KEY=...` — 키 이름 그대로 사용.

**Story 라우터:**
- `backend_8000/app/routes/story.py` (v8 완료 상태) — POST `/api/story`, GET `/api/story/{id}` 두 엔드포인트. 라우터 prefix `/api/story`. 신규 `POST /polish` 추가 위치는 GET 라우트 다음.

**프론트엔드 입력 컴포넌트:**
- `frontend/src/components/SceneInput.jsx` — `.scene-input__label` 안에 라벨/req/opt 표기. **버튼 삽입**은 라벨 우측 inline.
- `frontend/src/components/DynamicList.jsx` — 각 행 `dyn-list__row` 안에 wrap div + `MentionField` + `✕` 삭제 버튼. **다듬기 버튼**은 `MentionField` 우측, `✕` 좌측.
- `frontend/src/pages/StoryWizardPage.jsx` — rituals `<MentionField>` (라인 780 부근) 의 라벨 우측에 버튼.
- `frontend/src/api/index.js` — `createStory`, `getStory` 패턴 그대로. 신규 `polishStoryText({text, refs, model, label?})` 추가.
- 모달 컴포넌트 전례 없음 — 신규 컴포넌트 `PolishCompareModal` 추가.
- DEV 가드 로그 컨벤션 (`import.meta.env.DEV` + `console.info`/`console.error`).

**갭/제약:**
- 동기식(폴링 미사용): 5~30초 내 응답 — 클라이언트 axios 타임아웃 길게 잡아야(60–90초).
- `@멘션` 보존 검증: 원본의 `@<display_name>` 토큰 카운트 ≥ 다듬은 결과의 동일 토큰 카운트면 통과. 사라진 멘션은 응답 `refs_preserved=false` 로 알리고 클라이언트가 토스트 + 원본 유지.
- 모델 선택 UI: 매 입력마다 라디오 두면 화면 잡음 큼 → **모달 내부에 모델 라디오**를 두어 한 곳에서 결정. 기본값은 Claude 4.7 Opus.
- 길이: 다듬은 결과는 원본의 ±30% 범위 (시스템 프롬프트 규칙으로 명시).

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/services/story_polisher.py` (신설) | `async def polish_story_text(text, refs, model_alias, label)`. model_alias: `"claude_4_7_opus"` → `claude-opus-4-7`, `"gpt_latest"` → `settings.openai_model_advanced`. 시스템 프롬프트(아래 명세). `_generate_via_anthropic` / `_generate_via_openai` 패턴은 lyrics_generator 모방하되 단일 호출(제목 없음). temperature=0.4 (Opus는 미설정). max_tokens는 `min(2048, max(256, len(text)*4))`. `_validate_mention_preservation(polished, refs) → bool`. 로그 prefix `[Polisher]`, 추적자 `user_id`, `model`, `text_len`, `ref_count`, `refs_preserved`. |
| 2 | `backend_8000/app/routes/story.py` | `POST /polish` 신설. Pydantic body `PolishRequest`: `{text: str, refs: list[MentionRef] = [], model: Literal["claude_4_7_opus","gpt_latest"] = "claude_4_7_opus", label: str = ""}`. 검증: text 1~4000자, refs 0~32개. 키 부재 시 503(모델별). 정상 시 `{polished_text, model_used, elapsed_ms, refs_preserved}` 반환. 라우트 로그 prefix `[StoryRoute] /polish`. |
| 3 | `frontend/src/api/index.js` | `polishStoryText(payload)` 추가 — `POST /story/polish`. axios timeout 90000ms. |
| 4 | `frontend/src/components/PolishCompareModal.jsx` (신설) | props: `{open, onClose, originalText, refs, label, onApply(polishedText), defaultModel="claude_4_7_opus"}`. 단계: (a) idle — 모델 라디오(◉Claude 4.7 Opus / ○GPT 최신) + [다듬기 시작] 버튼 + 원본 미리보기. (b) loading — 스피너 + 경과초. (c) result — 좌(원본)/우(다듬은 글) 좌우 비교 + 멘션 칩 시각화 양쪽 동일. refs_preserved=false 시 경고 배너. 버튼 [적용하기][다시 다듬기][취소]. 로그 prefix `[PolishModal]`. |
| 5 | `frontend/src/components/PolishCompareModal.css` (신설) | 다크톤 모달 — 백드롭(rgba(0,0,0,0.7))·중앙 카드(min 760px, max 1080px)·좌우 컬럼 2단·반응형(<700px 세로 스택). |
| 6 | `frontend/src/components/PolishButton.jsx` (신설) | 작은 inline 버튼 `<button class="polish-btn">✨ 다듬기</button>`. props: `{value, refs, onChange(newText), onChangeRefs(newRefs), label, disabled}`. 내부에서 PolishCompareModal 호출 후 `onApply` 시 본문 교체. 로그 prefix `[PolishButton:{label}]`. |
| 7 | `frontend/src/components/PolishButton.css` (신설) | 작은 버튼 스타일. 비활성/로딩 상태 시각화. |
| 8 | `frontend/src/components/SceneInput.jsx` | `.scene-input__label` 끝에 `<PolishButton>` 추가 (value/refs/onChange/onChangeRefs/label 그대로 전달). 본문 빈 문자열이면 disabled. |
| 9 | `frontend/src/components/DynamicList.jsx` | multiline 행에서 `MentionField` 우측에 `<PolishButton>` 추가. 본문 빈 인덱스는 disabled. |
| 10 | `frontend/src/pages/StoryWizardPage.jsx` | rituals 라벨 우측에 `<PolishButton>` 추가. memories DynamicList 의 `onChangeRefs(idx, refs)` 가 폴리시 적용 시에도 동일 경로로 들어오므로 추가 작업 없음. |

### LLM 시스템 프롬프트 명세 (`services/story_polisher.py`)

```
역할: 결혼식 뮤직비디오 영상을 만들기 위한 사용자 입력 텍스트를 다듬는 한국어 에디터.

[엄격 규칙]
① 사실 변경·새 정보 추가 금지. 추측·창작 금지. 원문에 없는 사건/사람/장소/시간 추가하지 말 것.
② "@" 로 시작하는 토큰(예: "@한강 카페", "@평상복 신랑")은 단어 단위로 100% 그대로 보존.
   - 띄어쓰기, 조사("@한강 카페에서"의 "에서") 외 문자를 토큰 내부에 끼우지 말 것.
   - 같은 토큰이 여러 번 나오면 원문 등장 횟수만큼 유지.
③ 육하원칙(누가/언제/어디서/무엇을/어떻게/왜) 기준으로 문장 순서·연결 보강.
   - 부족한 정보 보충 금지(추측 금지). 있는 정보만 더 또렷하게.
④ 한국어 자연체. 결혼식 영상 내레이션 톤. 과도한 격식체·시적 미사여구 회피.
⑤ 길이는 원문의 ±30% 범위. 짧으면 ±30 글자.
⑥ 출력은 다듬은 본문 텍스트만. 따옴표·머리말·해설·코드블록·번호 매김 없이.

[입력 라벨] {label}   ← "첫 만남" "첫 데이트" 등 톤 힌트
[원문]
{text}

[보존해야 할 멘션 목록]
{mention_list}   ← "@한강 카페", "@평상복 신랑" 등 한 줄에 하나
```

### `_validate_mention_preservation` 명세

```python
def _validate_mention_preservation(polished: str, refs: list[MentionRef]) -> bool:
    """원본 refs 의 각 display_name 이 polished 내에 "@<name>" 토큰으로
    원본 등장 횟수 이상 보존됐는지 확인."""
    for r in refs:
        token = "@" + r.display_name
        original_count = ...   # 원본에서의 카운트는 caller 가 미리 전달
        polished_count = polished.count(token)
        if polished_count < original_count:
            return False
    return True
```
(실제 구현은 caller 에서 `Counter` 로 비교 — 위는 명세상 표현)

### 디버깅 로그 명세

| 위치 | prefix | 추적자 키 |
|------|--------|-----------|
| `routes/story.py POST /polish` | `[StoryRoute]` | `user_id`, `model`, `text_len`, `ref_count` |
| `services/story_polisher.py` | `[Polisher]` | `user_id`, `model`, `text_len`, `ref_count`, `elapsed_ms`, `refs_preserved` |
| Frontend `PolishButton` | `[PolishButton:{label}]` | `label`, `text_len`, `ref_count`, `model` |
| Frontend `PolishCompareModal` | `[PolishModal]` | `model`, `phase`(idle/loading/result), `refs_preserved` |

민감 정보 금지: API 키·전체 본문 텍스트 로그 출력 금지(길이만).

### 테스트 시나리오

**A. 백엔드 엔드포인트**
1. `POST /api/story/polish` `{text:"비오던 회식 끝 야근", model:"claude_4_7_opus"}` → 200 + `polished_text` 비어있지 않음. `model_used` 가 `claude-opus-4-7` 매핑.
2. 같은 호출 `model:"gpt_latest"` → 200 + `model_used` 가 `settings.openai_model_advanced`.
3. `text` 빈 문자열 → 400.
4. `text` 4001자 → 400.
5. 잘못된 model alias → 422.
6. 키 부재 시 503 (해당 모델만).
7. 토큰 없이 호출 → 401.

**B. 멘션 보존**
8. `text:"한강 카페에서 봤어 @한강 카페", refs:[{type:"place",asset_id:"x",display_name:"한강 카페",object_name:null}]` 호출.
9. 응답 `refs_preserved=true` (LLM이 토큰 유지). 만약 false 면 폴백 동작 검증.
10. 같은 토큰 2번 원문 → 응답에 2번 이상 존재해야 true.

**C. 라이브 LLM 호출**
11. 실제 Claude 키로 호출: 다듬은 결과가 자연스러운 한국어인지 시각 검증(샘플 1건).
12. 실제 GPT 키로 호출: 동일.
13. 응답 시간 5~30초 범위 — 90초 안에 종료.

**D. 프론트엔드 정적 검증** (UI 자동화 대신 코드 패턴)
14. `PolishCompareModal.jsx` 에 모델 라디오, 좌우 비교, 적용/다시/취소 버튼 존재.
15. `PolishButton.jsx` 가 disabled 핸들링.
16. `SceneInput.jsx`, `DynamicList.jsx`, `StoryWizardPage.jsx` 에 `<PolishButton>` 호출부 존재.
17. vite 트랜스폼 200 — 신설 4파일 + 수정 3파일 빌드 통과.

**E. 회귀**
18. 가사 생성 / 시트 생성 / 장소 자산 / 멘션 입력 영향 없는지(시트/장소/멘션 GET).
19. story `POST/GET` 무영향.

**F. 로그**
20. 백엔드 `grep "\[StoryRoute\] /polish" /tmp/mv_backend_8000.log` entry/ok + 토큰 확인.
21. `grep "\[Polisher\]" /tmp/mv_backend_8000.log` 라이프사이클 + 외부 호출 라인.
22. 프론트 콘솔 `[PolishButton:...]`, `[PolishModal]` prefix grep 가능.

### 영향·회귀
- 신규 라우트 하나(POST `/story/polish`) + 신규 서비스 파일 하나. 기존 라우트·서비스 무변경.
- LLM SDK 추가 의존성 없음 — `anthropic`, `openai` 이미 import.
- 프론트엔드 컴포넌트 신설 3개(PolishButton/PolishCompareModal + CSS×2) + 기존 3개에 버튼 한 줄씩 추가.
- @멘션(v8)·시트(v7)·장소(v7) 무영향. mentionOptions·refs 흐름 그대로.

### 후속 (이번 범위 밖)
- 영상 자동 생성에 다듬은 본문 + refs 활용(이미 v8 에서 refs 저장 — 이번 v9 는 본문 품질 개선).
- 다듬기 결과를 sessionStorage 에 별도 캐싱(연속 재시도 시 토큰 절약).
- 다듬기 모델 비용/시간 metric 수집.


## v10 — 2026-05-27 — @-멘션 팝업에 자산 썸네일 추가

### 요구
`@` 입력 시 뜨는 팝업 옵션에 display_name 텍스트만 아니라 해당 캐릭터 시트/장소의 작은 썸네일 이미지도 함께 노출. 사용자가 한눈에 어떤 자산인지 식별 가능.

### Plan verification findings
- `MentionField.jsx` 의 옵션 렌더(라인 394–422)는 `{opt.display_name}` 텍스트만 표시.
- `mentionOptions` 의 각 항목에 이미 `object_name` 이 채워져 있음 (StoryWizardPage 의 reloadMentionOptions 에서 시트/장소 fetch 시 함께).
- 백엔드/API 변경 불필요 — `api.sheetPreviewUrl(object_name)` (모든 캐릭터/장소 이미지 동일 버킷 `mv-wedding-photos` 서빙) 재사용.

### 변경 매트릭스
| 파일 | 변경 |
|------|------|
| `frontend/src/components/MentionField.jsx` | `import * as api from '../api'`. 옵션 행에 `<img>` + placeholder div 추가. object_name 있으면 썸네일, 없으면 type 별 이모지 placeholder. onError 시 placeholder fallback. |
| `frontend/src/components/MentionField.css` | `.mention-popup__item` 을 flex 로 변경(gap 10px). `.mention-popup__thumb` (40×40, rounded 6px, object-fit cover) + `.mention-popup__thumb--placeholder` (flex center, 이모지) + `.mention-popup__name` (flex 1, ellipsis) 추가. |

### 동작
- 사용자가 `@` 입력 → 팝업.
- 각 옵션: `[40×40 썸네일] display_name` 형태.
- sheet/place 모두 동일 `sheetPreviewUrl` 헬퍼로 토큰 포함 절대 URL 생성.
- object_name 없으면 (예: 시트 저장 직후 잠깐) `🧑`/`📍` 이모지 placeholder.
- 이미지 로드 실패(MinIO 객체 없음 등) onError → placeholder 노출.

### 영향·회귀
- 백엔드 무변경.
- 키보드 탐색·필터·선택·칩 삽입 로직 그대로.
- HMR 트랜스폼 200, 빌드 에러 없음.


## v11 — 2026-05-27 — 관리자 등급 시스템 + 요청작 + 사용자관리

### 사용자 요구
1. PostgreSQL `users` 테이블에 사용자 등급(role) 컬럼 추가 — `user` / `admin`.
2. 관리자 시드 계정: ID=`admin`, PW=`1` (개발용 약한 PW — 운영 전 교체 필요, REPORT 에도 명시).
3. 관리자 전용 페이지 2종:
   - **`/admin/jobs` (요청작)**: 모든 사용자의 MV 작품(mv_jobs) 사용자별 그룹핑 노출 — 관리자가 모든 작품에 접근 가능.
   - **`/admin/users` (사용자관리)**: 사용자 목록 + 등급 변경 버튼.
4. Header 에서 `[요청작]` `[사용자관리]` 링크는 admin role 일 때만 노출. ProtectedRoute 에 adminOnly 옵션 추가.

### Plan verification findings (현재 코드 사실)

**백엔드**:
- `backend_8000/infra/init_postgres.sql`: `users` 테이블에 `role` 컬럼 **없음**. `is_banned` BOOL 만 있음.
- `backend_8000/app/database/postgres.py:11–20`: asyncpg pool, raw SQL 마이그레이션 없음 — `init_postgres` 안에서 idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 한 줄로 처리 가능.
- `backend_8000/app/routes/auth.py:21–29`: `_create_token(user_id, email, nickname)` → payload `{id, email, nickname, exp}`. **`role` 미포함**.
- `routes/auth.py:32–41` `_save_session(...)`: Redis 세션에 `{id, email, nickname, profile_image}`. **role 미포함**.
- `app/auth.py:13–45` `get_current_user`: Redis 세션 dict 반환 — `role` 키 추가 필요.
- `routes/auth.py:44–73` register: `INSERT INTO users (email, password_hash, nickname)` — 새 default 'user' 가 자동 적용.
- `routes/auth.py:76–107` login: SELECT 컬럼에 role 추가 + 토큰/세션에 포함.
- `routes/mv.py:35–50` `_serialize_job`: user 정보(닉네임/이메일) 미포함 — admin 응답엔 user join 필요.
- `routes/mv.py:132–137` GET `/jobs`: 본인 user_id 필터링만.
- `requirements.txt`: `bcrypt` 이미 있음.

**프론트엔드**:
- `frontend/src/contexts/AuthContext.jsx`: user 상태는 login/register 응답 그대로 보관. login 응답에 role 추가되면 자동 반영.
- `frontend/src/components/Header.jsx:24–36`: `user ? 인증됨 : 미인증` 분기. admin 분기 자리 — `user?.role === 'admin'` 조건 추가.
- `frontend/src/components/ProtectedRoute.jsx`: 현재 인증만 가드 — `adminOnly` prop 추가.
- `frontend/src/App.jsx`: 라우트 패턴 `<Route path=... element={<ProtectedRoute><Page/></ProtectedRoute>}/>`. /admin/* 두 라우트 추가.
- `frontend/src/pages/MyWeddingMVPage.jsx`: getMVJobs → setJobs → 카드 그리드. AdminJobsPage 가 동일 패턴으로 + user 정보 헤더 추가.
- `frontend/src/api/index.js`: 기존 axios 인스턴스, Bearer 자동 주입. 신규 admin 함수 3개 추가 위치.

**갭/제약**:
- `admin` 이 이메일 형식이 아님 — register POST 의 이메일 검증을 우회하기 위해 **lifespan 시드에서 직접 SQL INSERT** 사용.
- 비밀번호 `1` 은 매우 약함 — 개발/테스트 환경 전용. PLAN.md/REPORT.md 에 경고 명시. 운영 전 교체 필수.
- 본인을 강등하면 admin 페이지에서 즉시 튕김 — 백엔드에서 자기 자신의 role 변경 금지. admin 시드 계정도 강등 금지.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/infra/init_postgres.sql` | users 테이블 정의에 `role TEXT DEFAULT 'user' NOT NULL` 추가(fresh setup용). |
| 2 | `backend_8000/app/database/postgres.py` | init_postgres 후 `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' NOT NULL` 1회 실행 (기존 DB 마이그레이션). |
| 3 | `backend_8000/app/routes/auth.py` | (a) `_create_token` 시그니처에 `role` 추가, payload 에 포함. (b) `_save_session` 에도 role. (c) register INSERT 후 RETURNING 에 role 포함. (d) login SELECT 에 role 추가, 토큰·세션·응답에 모두 포함. (e) `/me` 응답에 role 포함. 로그 prefix `[AuthRoute]`. |
| 4 | `backend_8000/app/auth.py` | get_current_user 반환 dict 에 role 포함(session 에서 가져옴). 신규 의존성 `get_current_admin` 추가 — `get_current_user` 호출 후 `role != 'admin'` 이면 403. |
| 5 | `backend_8000/app/services/admin_seeder.py` (신설) | `async def seed_admin()`: users 테이블에 `email='admin'` 가 없으면 bcrypt('1') 해시로 직접 INSERT. role='admin', nickname='관리자'. idempotent. 로그 prefix `[AdminSeed]`. |
| 6 | `backend_8000/app/main.py` | lifespan 에서 `await seed_admin()` 호출 (postgres init 직후, outfit seed 이전). |
| 7 | `backend_8000/app/routes/admin.py` (신설) | prefix `/api/admin`. 엔드포인트 3개: (a) `GET /jobs` — 모든 mv_jobs 목록 + users 테이블에서 email/nickname join 해 함께 반환. 사용자별 그룹핑은 클라이언트가 처리. (b) `GET /users` — users 테이블 전체(role 포함). (c) `PATCH /users/{user_id}/role` — body `{role: Literal["user","admin"]}`. 본인 자신과 admin 시드 계정(email='admin')은 강등 차단(409). 모두 `get_current_admin` 의존성. 로그 prefix `[AdminRoute]`. |
| 8 | `backend_8000/app/main.py` | `from .routes import ..., admin` + `app.include_router(admin.router)`. |
| 9 | `frontend/src/api/index.js` | `getAdminJobs()`, `getAdminUsers()`, `updateUserRole(userId, role)`. |
| 10 | `frontend/src/contexts/AuthContext.jsx` | login/register 응답에 role 포함되면 자동 보관. 변경 없을 수도 있지만 spread 안전 확인. |
| 11 | `frontend/src/components/Header.jsx` | `user?.role === 'admin' && (...)` 블록으로 `[요청작]` `[사용자관리]` 링크 추가. 일반 `[내 작품]` 좌측에 배치(요구사항). |
| 12 | `frontend/src/components/ProtectedRoute.jsx` | `adminOnly` prop. role 불일치 시 `<Navigate to="/" replace />`. |
| 13 | `frontend/src/App.jsx` | `/admin/jobs`, `/admin/users` Route 등록. |
| 14 | `frontend/src/pages/AdminJobsPage.jsx` (신설) | `getAdminJobs` 호출 → 사용자별 그룹핑 렌더. 각 사용자 그룹 헤더 + 작품 카드 그리드. 카드: 제목·상태·생성일·[상세] 링크. 로그 prefix `[AdminJobsPage]`. |
| 15 | `frontend/src/pages/AdminJobsPage.css` (신설) | 그룹 카드 + 그리드. |
| 16 | `frontend/src/pages/AdminUsersPage.jsx` (신설) | `getAdminUsers` 테이블 + 등급 변경 버튼. 본인/admin 시드 계정 행은 비활성. 확인 다이얼로그. 로그 prefix `[AdminUsersPage]`. |
| 17 | `frontend/src/pages/AdminUsersPage.css` (신설) | 테이블 스타일. |

### 디버깅 로그 명세

| 위치 | prefix | 추적자 |
|------|--------|--------|
| `routes/admin.py` | `[AdminRoute]` | `user_id`(관리자), `target_user_id`, `new_role` |
| `services/admin_seeder.py` | `[AdminSeed]` | 시드 결과(created/exists) |
| `routes/auth.py` (수정분) | 기존 `[AuthRoute]` | `role` 토큰 추가 |
| Frontend AdminJobsPage | `[AdminJobsPage]` | `count_users`, `count_jobs` |
| Frontend AdminUsersPage | `[AdminUsersPage]` | `count`, `target_user_id`, `new_role` |

민감 정보 금지: API 키·토큰·비밀번호 로그 출력 금지. admin 시드 PW 도 코드/로그에 노출 안 함(코드 상수 사용 + 로그에는 "created admin" 만).

### 테스트 시나리오

**A. 시드 + 로그인**
1. 백엔드 재시작 → `[AdminSeed]` 로그에 created 또는 exists.
2. `POST /api/auth/login` body `{email:"admin", password:"1"}` → 200 + token + `user.role="admin"`.
3. 일반 사용자 로그인 → `user.role="user"`.

**B. 관리자 라우트**
4. admin 토큰으로 `GET /api/admin/users` → 200 + 사용자 목록.
5. admin 토큰으로 `GET /api/admin/jobs` → 200 + 모든 사용자 jobs (user_email/user_nickname 포함).
6. user 토큰으로 `GET /api/admin/users` → 403.
7. user 토큰으로 `GET /api/admin/jobs` → 403.

**C. role 변경**
8. admin → `PATCH /api/admin/users/{other_user_id}/role` body `{role:"admin"}` → 200. 다시 로그인하면 새 토큰에 role=admin.
9. admin 이 본인 자신을 user 로 강등 → 409.
10. admin 시드 계정을 user 로 강등 → 409.
11. 잘못된 role 값 → 422.

**D. 프론트 정적**
12. `Header.jsx` 에 `user?.role === 'admin'` 분기 + `[요청작]`/`[사용자관리]` Link.
13. `ProtectedRoute.jsx` 에 `adminOnly` prop 처리.
14. `App.jsx` 에 두 라우트 등록.
15. Vite 트랜스폼 신설 4파일 모두 200.

**E. 회귀**
16. 일반 사용자 register/login/내작품/시트/장소/멘션 모두 무영향.
17. 기존 user 들에게 role 컬럼이 default 'user' 로 적용됐는지 mongo/postgres 확인.

**F. 로그**
18. `[AdminSeed]`, `[AdminRoute]` prefix 라인 확인.

### 영향·회귀
- ALTER TABLE 은 idempotent (IF NOT EXISTS), 기존 사용자 영향 없음(default 'user' 자동 적용).
- JWT 페이로드에 role 추가 — 기존 토큰은 여전히 유효, 단 role 키 부재 시 user 로 fallback.
- Redis 세션에 role 추가 — 기존 세션은 7일 후 자연스럽게 만료. 명시적으로 새로 로그인 권장(REPORT 에 안내).

### ⚠ 보안 경고 (개발 환경 한정)
- 시드 PW `1` 은 매우 약함. 운영 배포 전 반드시 강한 PW 로 교체.
- `admin` ID 도 일반적인 이름이라 운영에서는 별도 ID 권장.
- 본 항목은 REPORT.md 에 함께 명시.


## v12 — 2026-05-27 — "관리자에게 요청" 토글 + 요청작 필터링

### 사용자 요구
v11 의 admin `/admin/jobs` 가 **모든** mv_jobs 를 노출하던 동작을, **사용자가 명시적으로 요청한 작품만** 노출하도록 변경. 내 작품 카드에 `[관리자에게 요청]` 토글 버튼. 클릭하면 admin 요청작에 올라오고, 다시 누르면 취소.

### Plan verification findings
- `backend_8000/app/routes/mv.py:35–50` `_serialize_job`: `admin_requested` 필드 없음.
- `backend_8000/app/routes/admin.py` (v11): `GET /api/admin/jobs` 가 `mongo.mv_jobs.find()` 그대로 — 필터 없음.
- `frontend/src/pages/MyWeddingMVPage.jsx:67–72`: 카드 actions 에 `[진행 상황]` `[재생]` 만 있음 — `[관리자에게 요청]` 추가 자리.
- 정렬: admin 페이지에서 `admin_requested_at` desc 가 자연스러움.
- `_serialize_job` 는 mv.py + admin.py 모두에서 import 사용 — 한 곳만 수정하면 양쪽 응답에 반영됨.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/routes/mv.py` | (a) `_serialize_job` 에 `admin_requested: bool`, `admin_requested_at: iso\|None` 추가. (b) 신규 엔드포인트 `POST /api/mv/jobs/{job_id}/request-admin` — 소유자 검증 후 `$set admin_requested=true, admin_requested_at=now`. (c) `DELETE /api/mv/jobs/{job_id}/request-admin` — `$set admin_requested=false, $unset admin_requested_at`. 둘 다 갱신된 job 직렬화 반환. 로그 prefix `[MVRoute]` `request_admin`/`cancel_admin`, 추적자 `user_id`/`job_id`. |
| 2 | `backend_8000/app/routes/admin.py` | `GET /jobs` 의 `mongo.mv_jobs.find()` 를 `find({"admin_requested": True})` 로 변경 + `.sort("admin_requested_at", -1)`. 로그 entry/ok 에 `count` 토큰. |
| 3 | `frontend/src/api/index.js` | `requestAdminReview(jobId)` = POST, `cancelAdminReview(jobId)` = DELETE. |
| 4 | `frontend/src/pages/MyWeddingMVPage.jsx` | 카드 actions 에 토글 버튼. `admin_requested=true` 면 `[✓ 요청됨 · 취소]`, 아니면 `[🙋 관리자에게 요청]`. 클릭 시 낙관적 업데이트(로컬 state 즉시 반영) + API 호출 실패 시 롤백 + 토스트. 로그 prefix `[MyWeddingMV]`, 추적자 `job_id`/`next_state`. |
| 5 | `frontend/src/pages/AdminJobsPage.jsx` | 카드에 "요청: {admin_requested_at}" 한 줄 추가. 새 응답에 admin_requested_at 있음. |
| 6 | `frontend/src/pages/MyWeddingMVPage.css` | 토글 버튼 스타일(요청 안 됨: ghost 톤, 요청됨: 강조 톤). |

### 데이터 모델
- Mongo `mv_jobs` 에 `admin_requested: bool` (default false on read), `admin_requested_at: datetime|null`.
- 구버전 도큐먼트(필드 부재) → `_serialize_job` 에서 `doc.get("admin_requested", False)` fallback.
- 마이그레이션 불필요 (스키마리스).

### API

**POST `/api/mv/jobs/{job_id}/request-admin`**
- 소유자 검증 (current_user.id == doc.user_id). 아니면 403.
- 잡 doc 미존재 → 404.
- 이미 admin_requested=true → 멱등 200(no-op 또는 갱신).
- 응답: 갱신된 job 직렬화.

**DELETE `/api/mv/jobs/{job_id}/request-admin`**
- 동일 검증. admin_requested=false 로 set, admin_requested_at unset.
- 응답: 갱신된 job 직렬화.

### 디버깅 로그 명세
| 위치 | prefix | 추적자 |
|------|--------|--------|
| `routes/mv.py` 토글 엔드포인트 | `[MVRoute]` | `user_id`, `job_id`, `action=request_admin\|cancel_admin` |
| `routes/admin.py /jobs` | `[AdminRoute]` | `admin_id`, `count` (이미) |
| Frontend `MyWeddingMVPage` 토글 | `[MyWeddingMV]` | `job_id`, `next_state` |

### 테스트 시나리오
1. 일반 user 로그인 → 작품 카드에 `[관리자에게 요청]` 버튼.
2. 클릭 → 즉시 `[✓ 요청됨 · 취소]` 로 토글 (낙관적), 백엔드 `[MVRoute] request_admin` 로그.
3. admin 로그인 → `/admin/jobs` 에 그 작품만 노출 (다른 사용자의 요청 안 한 작품은 안 보임).
4. user 가 다시 토글 → `[관리자에게 요청]` 로 돌아옴. admin 페이지 새로고침 → 사라짐.
5. 다른 사용자 job_id 로 POST → 403.
6. 잘못된 job_id → 400/404.
7. 회귀: GET `/api/mv/jobs` 응답에 admin_requested 필드 포함.
8. 회귀: 시트/장소/멘션/다듬기 등 모두 무영향.

### 영향·회귀
- v11 의 admin 전체 노출 동작 제거 — admin 이 요청 안 된 작품 못 봄(의도).
- 기존 도큐먼트는 fallback false → 누구도 admin 페이지에 안 보임. 사용자가 명시적 요청 후에만 노출.
- 시트/장소/멘션/다듬기 무영향.

### 후속 (범위 밖)
- 요청 사유(comment) 첨부.
- admin 이 요청을 처리한 후 "확인 완료" 마킹.
- 요청 알림(이메일/푸시).


## v13 — 2026-05-27 — 웨딩사진 생성 (잡 + 멘션 통합 + 갤러리/디테일)

### 사용자 요구
- 작품 디테일 페이지(`/projects/:id`) 하단에 "📸 웨딩사진 생성" 패널.
- 입력: ① 신랑 시트(평상복/웨딩) ② 신부 시트(평상복/웨딩) ③ 장소(작품 소유자 장소 자산 OR 새 업로드) ④ 모델(gpt_image_2/nb_pro) ⑤ 지시사항 textarea (`@`-멘션 가능 — 시트 4 + 장소 N).
- 새 장소 업로드는 작품 소유자의 영구 장소 자산으로 등록(결정 B).
- 생성된 웨딩사진은 누적 갤러리. 카드 클릭 시 디테일 모달(원본 + 사용 자산 + 멘션 칩).
- 작품 소유자 + 관리자 모두 사용 가능(결정 B).

### Plan verification findings (현재 코드 사실)

**잡 패턴 답습 기준**:
- `routes/character.py:540–713` POST `/sheets/generate` — validate → MinIO stash → mongo insert → `asyncio.create_task` → 즉시 반환.
- `routes/character.py:270–378` `_run_sheet_generation` — load → generate → put → mongo update → 실패 처리.
- `routes/character.py:1121–1176` GET `/sheets/jobs/{id}` — `_serialize_sheet_job` 응답.

**이미지 호출**:
- `services/openai_image.py:144–149` `generate_image(prompt, ref_images, size, quality)` → bytes. ref_images 최대 10개. timeout 3600s.
- `services/character_generator.py:703–709` `_call_gemini_image(prompt, image_parts, ...)` → bytes. Gemini 3 Pro Image Preview. timeout 180s.
- `services/character_generator.py:596–602` `_call_gemini_text(prompt, image_parts, ...)` → str. Gemini 2.5 Flash. timeout 300s.
- ref_images 3개 입력(신랑+신부+장소) 두 SDK 모두 여유.

**권한 가드**:
- `routes/mv.py:159–163` v12.1 `is_owner or is_admin` 분기 — 그대로 답습.

**wedding_assets 컬렉션**:
- 현재 type 값: `character_sheet`, `place`. `wedding_photo` 추가 시 충돌 없음.
- doc 구조: `{user_id, type, display_name, source, object_name, meta:{...}, created_at, updated_at}`.

**places upload**:
- `routes/places.py` 현재 user_id = current_user.id 고정. admin 이 다른 사용자 명의로 등록하려면 `owner_user_id` 옵션 추가 + admin role 검증.

**프론트엔드**:
- `pages/GenerationStatusPage.jsx` — 음악 상태 표시 페이지. 하단에 `<WeddingPhotoPanel/>` 끼움.
- `components/MentionField.jsx` — props/동작 그대로 재사용. options 만 새로 빌드.
- AuthContext `user.role === 'admin'` 으로 어드민 판단 가능.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/routes/mv.py` | `GET /jobs/{id}/context` 신설 (owner+admin 가드) — owner의 시트 4슬롯 + 장소 자산 N개 + 등록된 wedding_photos 자산 한 번에 반환. 멘션 옵션 풀 빌드용. 로그 prefix `[MVRoute]` `/context`. |
| 2 | `backend_8000/app/routes/wedding_photos.py` (신설) | prefix `/api/mv/jobs/{mv_job_id}/wedding-photos`. 엔드포인트: (a) `POST /generate` — Pydantic body `WeddingPhotoGenerate{groom_sheet_slot, bride_sheet_slot, place_object_name, image_model, user_text, user_text_refs:[MentionRef]}`. 작품 owner OR admin. wedding_photo_jobs insert + asyncio.create_task → `{photo_id, job_id, status:"queued"}`. (b) `GET /jobs/{job_id}` 폴링. (c) `GET /` 갤러리 (이 mv_job 의 wedding_assets type=wedding_photo). (d) `GET /{photo_id}` 디테일 — 사용 자산 메타 포함. (e) `DELETE /{photo_id}`. 로그 prefix `[PhotoRoute]`, 추적자 `mv_job_id`, `photo_id`, `job_id`, `user_id`. |
| 3 | `backend_8000/app/routes/places.py` | upload_place 에 `owner_user_id: str = Form(None)` 옵션 추가. admin role 일 때만 허용 — 그 owner 명의로 자산 등록. 비admin 이 owner_user_id 지정 시 403. |
| 4 | `backend_8000/app/services/wedding_photo_generator.py` (신설) | `generate_wedding_photo(groom_sheet_bytes, bride_sheet_bytes, place_bytes, user_text, user_text_refs, image_model, ...) → bytes`. **두 단계**: Step A — Gemini 2.5 Flash 텍스트 합성(신랑/신부/장소 컨텍스트 + user_text + @멘션 → photorealistic 웨딩 사진 프롬프트). Step B — gpt_image_2/nb_pro 분기로 ref_images=[groom_sheet, bride_sheet, place] 호출. 시스템 프롬프트에 "@<이름> 멘션 토큰은 시각적 설명으로 변환" 명시. 로그 prefix `[WeddingPhotoGen]`, 추적자 `mv_job_id`, `photo_id`, `image_model`. |
| 5 | `backend_8000/app/main.py` | `from .routes import ..., wedding_photos` + `app.include_router(wedding_photos.router)`. |
| 6 | `frontend/src/api/index.js` | 신규 함수: `getJobContext(jobId)`, `uploadPlace(formData)` (existing reuse — owner_user_id 옵션 활용), `generateWeddingPhoto(jobId, payload)`, `getWeddingPhotoJob(jobId, photoJobId)`, `listWeddingPhotos(jobId)`, `getWeddingPhoto(jobId, photoId)`, `deleteWeddingPhoto(jobId, photoId)`. |
| 7 | `frontend/src/pages/GenerationStatusPage.jsx` | 하단에 `<WeddingPhotoPanel mvJobId={id} ownerUserId={job.user_id}/>` 끼움. Auth 검사로 owner OR admin 만 노출. |
| 8 | `frontend/src/components/WeddingPhotoPanel.jsx` (신설) | 마운트 시 `getJobContext(mvJobId)` → 시트 4슬롯 + 장소 N + 갤러리 fetch. UI: ①~⑤ + 생성 버튼 + 갤러리. 멘션 옵션 풀 = sheets+places (object_name 포함). 직접 업로드 폼: 장소 이름 필수 + 메모 선택 + 파일 → `uploadPlace(owner_user_id=ownerUserId)` (admin 일 때만 owner_user_id 전달, owner 본인은 미전달) → 응답 자산 ID → place_object_name 사용 + 옵션 풀에 즉시 추가. 잡 시작 후 5s 폴링. 완료 시 갤러리 prepend. 로그 prefix `[WeddingPhotoPanel]`, 추적자 `mv_job_id`, `photo_id`. |
| 9 | `frontend/src/components/WeddingPhotoPanel.css` (신설) | 시트/장소 선택 라디오 카드, 업로드 dropzone, 갤러리 그리드, 생성 결과 카드. |
| 10 | `frontend/src/components/WeddingPhotoDetailModal.jsx` (신설) | 큰 결과 이미지 + 사용 자산 썸네일 3개(신랑 시트, 신부 시트, 장소) + user_text(refs 칩 하이라이트 — v8 mirror 패턴) + 모델/생성일 메타 + [삭제] 버튼. 로그 prefix `[WeddingPhotoDetail]`. |
| 11 | `frontend/src/components/WeddingPhotoDetailModal.css` (신설) | 다크톤 모달, 좌(큰 이미지)/우(메타) 2단. <700px 세로 스택. |

### 데이터 모델

**Mongo `wedding_photo_jobs` (신설)** — 잡 추적용
```
{
  _id: ObjectId,
  mv_job_id: str,
  owner_user_id: str,
  requested_by_user_id: str,         # owner 본인 또는 admin
  type: "generate",
  status: "queued"|"running"|"done"|"failed",
  image_model: "gpt_image_2"|"nb_pro",
  groom_sheet_slot: "groom_casual"|"groom_wedding",
  bride_sheet_slot: "bride_casual"|"bride_wedding",
  place_object_name: str,            # 자산 또는 직접 업로드 결과
  place_source: "asset"|"uploaded",
  place_asset_id: str|null,
  user_text: str,
  user_text_refs: list[MentionRef],
  photo_id: str,                     # 사전 발급한 wedding_assets._id
  photo_object_name: str|null,       # 완료 시
  error_message: str|null,
  created_at, updated_at
}
```

**Mongo `wedding_assets` 에 `type="wedding_photo"` 추가**
```
{
  _id, user_id (= owner), type:"wedding_photo",
  display_name: "" (이번 범위 밖, 추후),
  source: "generated",
  object_name: "wedding_photos/{owner_id}/{mv_job_id}/{photo_id}.png",
  meta: {
    mv_job_id: str,
    image_model: str,
    groom_sheet_slot: str,
    bride_sheet_slot: str,
    place_object_name: str,
    place_source: "asset"|"uploaded",
    place_asset_id: str|null,
    user_text: str,
    user_text_refs: list[MentionRef]
  },
  created_at, updated_at
}
```

**MinIO 경로**:
- temp: `wedding_photos/temp/{owner_id}/{photo_id}_{uuid}.png`
- 영구: `wedding_photos/{owner_id}/{mv_job_id}/{photo_id}.png`

### Backend API 명세

`/api/mv/jobs/{mv_job_id}/context` (GET)
- 가드: owner OR admin.
- 응답: `{ owner_user_id, owner_sheets:[{slot, display_name, sheet_object_name}], owner_places:[{place_id, display_name, memo, object_name}], wedding_photos:[{photo_id, object_name, meta, created_at}] }`.

`/api/mv/jobs/{mv_job_id}/wedding-photos/generate` (POST, JSON)
- body: `{groom_sheet_slot, bride_sheet_slot, place_object_name, image_model, user_text, user_text_refs:[MentionRef]}`.
- 검증: 슬롯 4 종 OR. 시트 실제 존재 확인(`wedding_character_sheets.sheets.{slot}.sheet_object_name`). place_object_name 이 owner 또는 admin-uploaded 객체인지 prefix 확인. image_model 별 API 키 503 분기.
- 처리: photo_id 사전 발급(ObjectId) → wedding_photo_jobs insert + wedding_assets pre-insert(type=wedding_photo, object_name=null) → asyncio.create_task.
- 응답: `{photo_id, job_id, status:"queued"}`.

`/api/mv/jobs/{mv_job_id}/wedding-photos/jobs/{job_id}` (GET) — 폴링
- 응답 `_serialize_photo_job`: `{job_id, photo_id, status, image_model, object_name, preview_url, error_message, created_at, updated_at}`.

`/api/mv/jobs/{mv_job_id}/wedding-photos` (GET) — 갤러리
- 응답 `{items: [{photo_id, object_name, preview_url, meta, created_at}, ...]}`. created_at desc.

`/api/mv/jobs/{mv_job_id}/wedding-photos/{photo_id}` (GET) — 디테일
- 응답: 자산 doc + 사용된 시트/장소 부가정보 join.

`/api/mv/jobs/{mv_job_id}/wedding-photos/{photo_id}` (DELETE)
- MinIO 객체 best-effort 삭제 + 자산 doc 삭제 + 관련 잡 doc 삭제.

`/api/places/upload` (확장) — Form 필드 `owner_user_id: str = Form("")` 추가. admin 일 때만 다른 사용자 명의 허용, 비admin 이 보낸 owner_user_id 무시(자기 자신으로).

### LLM 시스템 프롬프트 (services/wedding_photo_generator.py)

```
역할: 결혼식 웨딩 사진 한 장을 photorealistic 으로 그려내기 위한 이미지 모델용
프롬프트를 작성하는 전문가.

[입력 컨텍스트]
- 신랑 캐릭터 시트 (이미지 참조 1): {groom_display_name}, 평상복 or 웨딩 촬영복
- 신부 캐릭터 시트 (이미지 참조 2): {bride_display_name}, 평상복 or 웨딩 촬영복
- 장소 (이미지 참조 3): {place_display_name}, 메모: {place_memo}
- 사용자 지시사항: {user_text}
- 멘션 목록 (지시사항 안의 @ 토큰): {mentions_list}

[규칙]
① ref_image_1=신랑 인물 일관성, ref_image_2=신부 인물 일관성, ref_image_3=장소 배경 일관성.
② @<이름> 토큰은 그대로 출력하지 말고 해당 인물/장소의 시각적 설명으로 변환.
③ Photorealistic, natural lighting, cinematic wedding photography 톤.
④ 두 인물의 표정·자세·소품·시선·거리·구도까지 구체적으로 묘사.
⑤ 출력은 이미지 모델 prompt 영문 1단락만. 따옴표/머리말/번호매김/해설 없음.
⑥ 사용자 지시사항이 비어 있어도 자연스럽고 따뜻한 기본 웨딩 컷 묘사.
```

### 디버깅 로그 명세

| 위치 | prefix | 추적자 |
|------|--------|--------|
| `routes/wedding_photos.py` | `[PhotoRoute]` | `mv_job_id`, `photo_id`, `job_id`, `user_id`, `is_admin` |
| `services/wedding_photo_generator.py` | `[WeddingPhotoGen]` | `mv_job_id`, `photo_id`, `image_model`, `elapsed_ms` |
| `routes/mv.py /context` | `[MVRoute] /context` | `mv_job_id`, `owner_user_id`, `user_id`, counts |
| `routes/places.py admin upload` | `[PlaceRoute] admin_owner` | `admin_id`, `owner_user_id` |
| Frontend `WeddingPhotoPanel` | `[WeddingPhotoPanel]` | `mv_job_id`, `photo_id`, `job_id`, phase |
| Frontend `WeddingPhotoDetailModal` | `[WeddingPhotoDetail]` | `photo_id` |

민감 정보 금지. 본문(user_text 긴 텍스트) 로그 출력 금지(길이만).

### 테스트 시나리오

**A. context 엔드포인트**
1. owner 토큰 `GET /api/mv/jobs/{owned_id}/context` → 200 + 시트/장소/포토 배열.
2. admin 토큰 같은 호출 → 200.
3. 다른 사용자 토큰 → 403.

**B. 잡 라이프사이클**
4. 최소 body 로 POST → 200 + queued. 폴링 → running → done.
5. 결과 자산이 wedding_assets type=wedding_photo 로 insert 확인.
6. GET 갤러리 → 새 photo 포함.

**C. 장소 업로드**
7. owner 가 직접 업로드 → 자기 자산.
8. admin 이 owner_user_id 지정 업로드 → owner 명의 자산.
9. 비admin 이 다른 owner 지정 → 403.

**D. 멘션 보존**
10. user_text="@한강 카페 에서 @신랑 평상복 이 ..." + user_text_refs → 잡 시작 OK.
11. 결과 자산 meta.user_text_refs 보존.

**E. 권한**
12. 다른 사용자 작품의 generate 호출 → 403.
13. owner 토큰으로 본인 작품 generate → 200.
14. admin 토큰으로 다른 사용자 작품 generate → 200.

**F. 회귀**
15. 시트/장소 자산 라이프사이클 무영향.
16. /admin/jobs, /mv/jobs/{id} 무영향.
17. 멘션 풀이 v9.1 reload 콜백과 무관하게 자체 fetch.

**G. 라이브 LLM**
18. 짧은 user_text 로 실제 gpt_image_2 호출 → 5~10분 내 완료 또는 timeout/적절 에러.
19. nb_pro 호출 → 1~3분 내 완료.

### 영향·회귀
- 신규 라우트/서비스 추가만, 기존 라우트 변경은 `routes/places.py` upload 의 옵션 필드 추가뿐(비admin 동작 무변경).
- 기존 잡 패턴, 멘션 인프라, 시트/장소 자산 무영향.
- `wedding_assets` type 확장은 기존 character_sheet/place 조회에 무영향.

### 후속 (범위 밖)
- 웨딩사진 보정(refine).
- 디테일에 display_name/메모 편집.
- 식전영상 생성(다음 단계).
- 자동 작품 갤러리 공개 페이지.


## v15 — 2026-05-27 — 웨딩사진 멀티턴 수정 (refine 체인)

### 사용자 요구
생성된 웨딩사진에 대해 자연어 수정 요청을 연속(멀티턴)으로 보내어 v2, v3, v4 … 로 누적되는 refine 체인. 디테일 모달에서 채팅처럼 누적 노출.

### Plan verification findings
- `routes/wedding_photos.py` 현재 `POST /generate` + `_run_wedding_photo_generation` 만. refine 엔드포인트/체인 조회 없음.
- `services/wedding_photo_generator.py` `generate_wedding_photo()` 가 ref_images=[groom, bride, place] 3개 입력. refine 시 부모 사진을 ref_image 1번 자리에 추가하면 OpenAI Image edits 최대 10개, Gemini 3 Pro 도 여유 — 4개 입력 가능.
- `wedding_assets` (type=wedding_photo) doc 의 `meta` 에 새 필드 추가 가능. 스키마리스 안전.
- `wedding_photo_jobs` 에도 type 필드 이미 있음(`"generate"`). `"refine"` 값만 새로 추가하면 됨.
- 캐릭터 시트 refine 패턴 답습: `routes/character.py:866–1078` POST `/sheets/refine` + `_run_sheet_refinement`.
- 프론트 `WeddingPhotoDetailModal.jsx` 가 현재 단일 사진 메타 노출 — chain 타임라인 + refine 폼 추가 위치.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/routes/wedding_photos.py` | (a) Pydantic `WeddingPhotoRefine{refine_request: str(1~1000), refine_request_refs: list[MentionRef]=[], image_model: Literal["gpt_image_2","nb_pro"]="gpt_image_2"}`. (b) `POST /{photo_id}/refine` — owner/admin 가드. 부모 자산 존재 + object_name 확인. chain_root_photo_id 계산(부모의 meta.chain_root_photo_id 가 있으면 그 값, 없으면 부모의 photo_id). 새 photo_id 사전 발급. wedding_assets pre-insert(type=wedding_photo, source=generated, object_name=None, meta에 부모정보+refine_request+chain_root 포함). wedding_photo_jobs insert(type="refine", based_on_photo_id, refine_request, refine_request_refs). asyncio.create_task. 응답 `{photo_id(new), job_id, status:"queued"}`. (c) `GET /{photo_id}/chain` — 부모의 chain_root_photo_id 기준으로 wedding_assets type=wedding_photo 중 같은 chain_root 인 것들 created_at asc 정렬 반환 `{items:[v1,v2,...]}`. (d) `_run_wedding_photo_generation` 에 refine 분기 추가 — 부모 사진 bytes 로드 + ref_images 에 추가 + generator 의 refine 모드 호출. 로그 prefix `[PhotoRoute]` action=refine. |
| 2 | `backend_8000/app/services/wedding_photo_generator.py` | `generate_wedding_photo()` 에 옵션 인자 `parent_bytes: bytes \| None = None`, `parent_mime: str = "image/png"`, `refine_request: str = ""`, `refine_request_refs: list[dict] = None`, `mode: Literal["generate","refine"] = "generate"` 추가. mode="refine" 일 때 시스템 프롬프트에 부모 이미지 = 참조 1, "원본의 인물·장소·구도·색감 유지하고 요청한 부분만 변경" 강제. ref_images 앞에 parent_bytes prepend. 다른 동작은 동일. 로그 prefix `[WeddingPhotoGen]` 에 mode 토큰. |
| 3 | `frontend/src/api/index.js` | 신규: `refineWeddingPhoto(jobId, photoId, payload)` = POST `.../wedding-photos/{photoId}/refine`. `getWeddingPhotoChain(jobId, photoId)` = GET `.../wedding-photos/{photoId}/chain`. |
| 4 | `frontend/src/components/WeddingPhotoDetailModal.jsx` | (a) 마운트 시 `getWeddingPhotoChain` 추가 호출 → `chain` state. (b) 좌측 큰 이미지 위쪽에 작은 타임라인 (v1, v2, ..., current 강조) — 항목 클릭 시 main 이미지/메타 그 버전으로 전환. (c) 메타 영역 하단에 "🔧 다시 수정 요청" 폼 — 모델 라디오(gpt_image_2/nb_pro) + MentionField (mvJobId 의 context options 풀 재사용 — props 로 받아오거나 자체 fetch) + 생성 버튼. (d) 잡 시작 후 5s 폴링 → done 시 chain refetch + 자동으로 최신 버전 선택 + 부모 패널에 onChained 콜백으로 reloadContext. (e) WeddingPhotoPanel 에서 onChained 콜백 prop 전달. 로그 prefix `[WeddingPhotoDetail]`, 추적자 photo_id, chain_size, active_version. |
| 5 | `frontend/src/components/WeddingPhotoPanel.jsx` | DetailModal 에 `mentionOptions` (이미 계산된 옵션 풀) + `onChained` 콜백 전달. onChained 는 `reloadContext` 호출. |
| 6 | `frontend/src/components/WeddingPhotoDetailModal.css` | 타임라인 (가로 또는 세로 작은 카드 행), refine 폼 영역 추가 스타일. |

### 데이터 모델
- `wedding_photo_jobs.type = "refine"` 신규 값 (기존 "generate" 와 공존).
- `wedding_photo_jobs.based_on_photo_id`, `refine_request`, `refine_request_refs` 신규 필드.
- `wedding_assets` (type=wedding_photo) meta 신규:
  - `based_on_photo_id: str | null`
  - `refine_request: str` (refine 결과면 채움)
  - `refine_request_refs: list[MentionRef]`
  - `chain_root_photo_id: str` (체인 그룹핑 키 — v1 의 photo_id)
  - v1(원본) 의 chain_root_photo_id = 본인 _id, based_on_photo_id = null.

### Backend API 명세

**POST `/api/mv/jobs/{mv_job_id}/wedding-photos/{photo_id}/refine`** (JSON)
- body: `{refine_request: str(1~1000), refine_request_refs: list[MentionRef]=[], image_model: "gpt_image_2"|"nb_pro"}`.
- 검증: 부모 photo_id 존재 + object_name 확인(없으면 400 "원본 사진을 찾을 수 없습니다"). 모델 키 503 분기.
- 처리: 새 photo_id 사전 발급 → wedding_assets pre-insert → wedding_photo_jobs insert(type=refine) → asyncio.create_task.
- 응답: `{photo_id, job_id, status:"queued"}`.

**GET `/api/mv/jobs/{mv_job_id}/wedding-photos/{photo_id}/chain`**
- 부모 photo_id 의 chain_root_photo_id 추출 → 같은 chain_root 의 자산들 ordered by created_at asc.
- 응답: `{items: [{photo_id, object_name, preview_url, meta, created_at}, ...]}`.

### LLM 시스템 프롬프트 — refine 모드 추가 규칙
```
[모드: refine]
참조 1 = 직전 결과 사진. 인물·장소·구도·색감을 최대한 보존.
참조 2~4 = 신랑 시트 / 신부 시트 / 장소 (인물·장소 일관성 강제용 보조 참조).

[수정 요청] {refine_request}
[멘션 토큰] {mention_list}

규칙:
- 원본의 분위기·구도·인물 일관성을 최대한 보존하고 요청한 부분만 변경.
- "원본을 완전히 새로 그리기" 같은 큰 변경은 피하고 점진적 수정.
- @-토큰은 텍스트로 출력하지 말고 시각적 설명으로 변환.
- Photorealistic, natural lighting 톤 유지.
```

### 디버깅 로그

| 위치 | prefix | 추적자 |
|------|--------|--------|
| `routes/wedding_photos.py` refine/chain | `[PhotoRoute]` | `mv_job_id`, `photo_id`(new), `parent_photo_id`, `chain_root_photo_id`, `job_id`, `user_id`, `action=refine\|chain` |
| `services/wedding_photo_generator.py` | `[WeddingPhotoGen]` (기존) | + `mode=refine\|generate`, `parent_bytes_len` |
| Frontend `WeddingPhotoDetailModal` | `[WeddingPhotoDetail]` | `photo_id`, `chain_size`, `active_version`, `refine_phase` |

민감 정보 금지(전체 본문 길이만).

### 테스트 시나리오
1. 기존 generate 잡 정상 동작(회귀).
2. v1 사진 디테일 모달 진입 → chain 응답에 v1 1개만.
3. v1 refine 요청 → 200 queued → 폴링 done → chain 에 v2 추가.
4. v2 다시 refine → v3 추가. chain 3개, created_at 정렬.
5. 디테일 모달에서 v1 클릭 → main 이미지/메타 v1 로 전환. v3 다시 → 전환.
6. 다른 사용자가 다른 사람 photo 에 refine 시도 → 403.
7. 존재하지 않는 photo_id → 404.
8. refine_request 빈 문자열 → 422.
9. 같은 chain_root 자산 삭제(중간 v2 삭제) → chain 응답에서 빠짐(기존 v1,v3 만).
10. 부모 photo 가 아직 object_name=None (생성 중) → refine 시도 400.

### 영향·회귀
- 기존 generate 잡: chain_root_photo_id 가 본인 _id 로 자동 설정 — 이전 v1~vN 회귀 데이터에는 chain_root 없음 → fallback 로직 필요(없으면 photo_id 자체를 root 로 간주).
- 갤러리(`GET /wedding-photos`) 응답에 chain_root_photo_id 가 추가 노출되지만 기존 클라이언트는 무시.
- 시트/장소/멘션/다듬기 무영향.

### 후속 (범위 밖)
- 체인 트리 시각화(분기 가능 시).
- 사용자가 refine 도중 직접 stop.
- chain export(여러 버전 한꺼번에 zip).


## v15.1 + v15.2 — 2026-05-27 — 웨딩사진 refine 안정화 (모델 락 + 폴링 승격)

### v15.1 — 모델 락
**문제**: refine 마다 image_model 을 다시 선택할 수 있어 chain 도중 모델이 바뀌면 톤·디테일 drift 가능.
**조치**:
- 백엔드 `routes/wedding_photos.py` `refine_wedding_photo`: body.image_model 무시. parent.meta.image_model 강제. 로그 prefix `[PhotoRoute]` action=refine 에 `model_locked=...` 토큰.
- 프론트 `components/WeddingPhotoDetailModal.jsx`: refine 폼 모델 라디오 → readonly 표시 ("이 작품은 {model} 로 시작했어요"). 모델 state 는 chain 의 first 자산 meta.image_model 로 초기화.

### v15.2 — refine 폴링 패널 레벨로 승격 (핵심 문제 해결)
**진단**: 백엔드 로그에서 refine 잡 두 건 모두 4분 가까이 걸려 정상 완료(`[PhotoJob] done`). 그러나 사용자가 결과를 못 봤음. 원인: 폴링이 `WeddingPhotoDetailModal` 안에만 있어 **모달 닫히면 폴링 cleanup → 결과 도착 후에도 갤러리/모달 갱신 안 됨**.

**Plan verification findings**:
- `WeddingPhotoPanel.jsx`: 이미 generate 잡 폴링을 패널 레벨에서 수행 중 (`activeJobId` state + 5초 useEffect). 단일 잡만 추적.
- `WeddingPhotoDetailModal.jsx`: refine 폴링이 모달 안의 `refineJobId` state + useEffect. 모달 unmount 시 cancelled=true 로 중단.
- 백엔드 `GET /wedding-photos/jobs/{job_id}` 는 owner+admin 가드만, photo type 무관 폴링 가능.

**변경 매트릭스**:
| 파일 | 변경 |
|------|------|
| `WeddingPhotoPanel.jsx` | (a) `activeJobIds: Set<string>` state(generate + refine 통합). 기존 `activeJobId` 단일은 generate 첫 시작 시 이 set 에 같이 들어가게 호환. (b) handleRefine 시작 시 패널에 잡 등록(현재는 모달 안에서만 처리). 모달 → 패널로 onJobStarted({job_id, photo_id, parent_photo_id}) 콜백 호출. (c) 통합 폴링 effect — 5초마다 모든 activeJobIds 폴링. done/failed 시 set 에서 제거 + reloadContext + DEV info 로그 + (옵션)alert("수정 완료"). (d) localStorage 백업(키: `wedding_photo_active_jobs:{mvJobId}:{user_id}`) — 새로고침 후 복원. (e) 모달에 props 로 `activeJobIds`, `onRefineStart(jobInfo)` 전달. |
| `WeddingPhotoDetailModal.jsx` | (a) 내부 refine 폴링 제거. handleRefine 은 잡 시작 후 `onRefineStart` 콜백 호출 → 패널이 폴링 인계. (b) refine 진행 표시: props 의 activeJobIds 안에 있으면 "수정 생성 중... N초" UI. 완료 시 props 의 chain 자동 갱신(부모가 reloadContext → context.wedding_photos 변경 → useEffect 으로 chain refetch). (c) 모달이 닫혀 있어도 잡은 계속 → 다시 열면 패널이 갖고 있는 activeJobIds 로 즉시 진행상태 복원. |

### 디버깅 로그
- 백엔드: `[PhotoRoute] /refine` 에 model_locked 토큰.
- 프론트: `[WeddingPhotoPanel] refine job registered`, `[WeddingPhotoPanel] job poll done`, `[WeddingPhotoDetail] refine started (delegated to panel)`.

### 테스트 시나리오
1. v1 → refine 시작 → 잡 진행 중 모달 닫음 → 갤러리 카드에 "생성 중" 표시 → 4분 후 done → 갤러리에 v2 자동 추가.
2. v1 → refine 시작 → 잡 진행 중 페이지 새로고침 → 패널 mount 시 localStorage 의 active jobs 복원 → 폴링 재개.
3. body.image_model="nb_pro" 로 refine POST → 응답에 실제 model_locked="gpt_image_2" 보존.
4. 디테일 모달의 모델 라디오는 disabled + 안내 노출.


## v16 — 2026-05-27 — 웨딩사진 다운로드 + 일괄 선택 삭제

### 사용자 요구
- 디테일 모달에서 단일 다운로드.
- 갤러리 선택 모드 → 여러 장 선택 → ZIP 일괄 다운로드.
- 같은 선택 모드에서 일괄 삭제도 가능.

### 결정사항 (사용자 "추천대로")
- ① 카드 hover 단일 다운로드 버튼 — **노출하지 않음** (디테일 모달에서만).
- ② ZIP 포맷 — **원본 PNG 그대로**.

### Plan verification findings
- `routes/wedding_photos.py` 에 단일 사진 다운로드/ZIP/bulk-delete 엔드포인트 모두 **없음**. DELETE 는 단일만 존재.
- `services` 에 zip 만들기 코드 없음. Python `zipfile` + `io.BytesIO` 로 in-memory ZIP 생성.
- MinIO get_object 응답이 streaming object → bytes 로 read 가능. `routes/character.py:1188 /preview` 패턴 답습.
- 프론트 `WeddingPhotoPanel.jsx` — `activeJobIds` state 이미 있음(v15.2). 선택 모드 state 추가만.
- 프론트 axios 인스턴스(`api/index.js`) — `responseType: 'blob'` 옵션으로 binary 응답 처리 가능.

### 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| 1 | `backend_8000/app/routes/wedding_photos.py` | (a) `GET /{photo_id}/download` — owner/admin 가드, MinIO get_object, `StreamingResponse(image/png)`, `Content-Disposition: attachment; filename=wedding-{mv_short}-{photo_short}.png`. (b) `POST /download` (Pydantic body `{photo_ids: list[str](max=50)}`) — 각 자산 조회+권한+object_name 검증 → `zipfile.ZipFile` in-memory ZIP → `StreamingResponse(application/zip)`, filename=`wedding-photos-{mv_short}-{N}.zip`. (c) `POST /bulk-delete` (Pydantic body `{photo_ids: list[str](max=50)}`) — 각 자산 owner/admin 검증 → MinIO 객체 best-effort 삭제 + wedding_assets doc 삭제 + wedding_photo_jobs 관련 삭제. 응답 `{deleted_count, failed: [{photo_id, reason}]}`. 로그 prefix `[PhotoRoute]` actions `download_single`/`download_zip`/`bulk_delete`. 추적자 user_id, mv_job_id, photo_ids(count), is_admin. |
| 2 | `frontend/src/api/index.js` | `downloadWeddingPhoto(jobId, photoId)` (`responseType:'blob'`), `downloadWeddingPhotosZip(jobId, photoIds)` (`responseType:'blob'`), `bulkDeleteWeddingPhotos(jobId, photoIds)` 3종. |
| 3 | `frontend/src/components/WeddingPhotoPanel.jsx` | (a) state `selectMode: bool`, `selectedIds: Set<string>`. (b) 상단 우측 [☑ 선택 모드] 토글. ON 시 [✕ 끄기] 로 라벨 변경 + 액션바(선택 N개 / 전체 선택 / [⬇ 다운로드] / [🗑 삭제]). (c) 카드 onClick 분기: selectMode 면 selectedIds 토글, 아니면 디테일 모달. 카드 좌상단 체크박스 표시(selectMode 시). (d) handleBulkDownload: api 호출 → blob 받아 anchor download(URL.createObjectURL). (e) handleBulkDelete: confirm 후 api 호출 → reloadContext + 토스트("N장 삭제 완료"). failed 있으면 추가 alert. 진행 중 잡(activeJobIds 의 photo_id) 은 삭제 차단(체크박스 클릭 시 안내). 로그 prefix `[WeddingPhotoPanel]`. |
| 4 | `frontend/src/components/WeddingPhotoPanel.css` | `.wedding-photo__bulk-actions`(상단 액션바), `.wedding-photo__card.is-selected`(체크 상태), `.wedding-photo__card-check`(체크박스 좌상단), `.wedding-photo__select-toggle`(우측 토글 버튼) 등 추가. |
| 5 | `frontend/src/components/WeddingPhotoDetailModal.jsx` | 기존 [🗑 삭제]/[닫기] 옆에 [⬇ 다운로드] 버튼. 클릭 시 `downloadWeddingPhoto` 호출 → blob → anchor download. 로그 prefix `[WeddingPhotoDetail]`. |

### Backend API
- `GET /api/mv/jobs/{mv_job_id}/wedding-photos/{photo_id}/download` — 단일 PNG.
- `POST /api/mv/jobs/{mv_job_id}/wedding-photos/download` — body `{photo_ids:[...]}`, ZIP.
- `POST /api/mv/jobs/{mv_job_id}/wedding-photos/bulk-delete` — body `{photo_ids:[...]}`, `{deleted_count, failed}`.

### 디버깅 로그
| 위치 | prefix | 추적자 |
|------|--------|--------|
| `routes/wedding_photos.py` 다운로드/일괄삭제 | `[PhotoRoute]` action=download_single\|download_zip\|bulk_delete | user_id, mv_job_id, photo_count, is_admin, deleted_count(bulk-delete 만) |
| Frontend `WeddingPhotoPanel` | `[WeddingPhotoPanel]` | select_mode, selected_count, action |
| Frontend `WeddingPhotoDetailModal` | `[WeddingPhotoDetail]` | photo_id, action=download |

### 안전장치
- bulk-delete: 진행 중 잡의 photo 는 선택 자체 불가(체크박스 disabled + 툴팁) 또는 클릭 시 토스트 안내.
- 다운로드/삭제 최대 50개 제한.
- bulk-delete 는 사용자 confirm 다이얼로그 필수("선택한 N장을 영구 삭제할까요? 되돌릴 수 없습니다").

### 테스트 시나리오
1. 디테일 모달에서 단일 다운로드 → 브라우저 PNG 저장.
2. 선택 모드 ON → 3장 체크 → ZIP 다운로드 → 압축 풀어보면 PNG 3개.
3. 선택 모드 → 1장 체크 → bulk-delete → confirm → 갤러리에서 사라짐.
4. 다른 사용자 토큰으로 download/delete 시도 → 403.
5. 51개 선택 시도 → 422.
6. 회귀: 단일 DELETE, refine, generate 모두 정상.

### 영향·회귀
- 신규 엔드포인트만 추가, 기존 동작 무영향.
- DELETE single 은 그대로 유지(디테일 모달에서 사용).
- v15.2 의 activeJobIds 로직 그대로 사용.


## v17 — 2026-05-27 — 식전영상(MV) 파이프라인 이식 (Phase 0~4 + 단계별 UI)

### 요구사항 요약 (사용자 합의)
1. **Phase 0 — 스토리⇄가사 매핑 LLM**: 9004 의 "music-meta brainstorm" 단계 대체. 입력 = 사용자 스토리 6시점(meeting / first_date / memories[] / proposal / wedding_prep / rituals) + @멘션 refs + 생성된 가사(라인별 timestamp). 출력 = `scene_plan[]` (가사 라인마다 `{lyric_line, lyric_start, lyric_end, story_slot, story_excerpt, refs[]}`). 스토리에 없는 장면 생성 금지. @멘션은 그대로 전파. 모델 = 사용자 선택, 기본 Claude 4.7 Opus, 옵션 GPT 최신.
2. **Phase 1 — 씬 분할**: 단위 = **가사 라인 1줄 = 씬 1개** (영상모델 8~15s 제약). `story_slot` 그룹핑 추가 — 같은 slot 의 인접 씬은 video_prompt 에 "이전 씬에서 이어지는 연속 컷" 명시. 음악 섹션·비트 logic 은 9004 그대로. **립싱크 씬 없음, scene_type 필드 자체 미사용(또는 drama 고정).** scenes[] 필드는 9004 와 동일 set.
3. **Phase 2 — 씬 이미지**: 모델 = `gpt_image_2`(기본) | `nb_pro`. reference 는 **스토리 본문 @멘션 그대로 사용** (자동 분기 금지). 자산 풀 = 캐릭터 시트 4종 + wedding_assets place 전체 + **v13 wedding_photo 결과물도 reference 후보**. wedding_prep/마지막 웨딩촬영 시점은 v13 웨딩사진의 장소 자산 reference 사용. 출력 PNG = 캐릭터+장소 합성 1장 (Phase 3 가 씬 이미지 1장만 받기 때문).
4. **Phase 3 — 씬 영상**: 4개 모델 사용자 선택 — **Veo 3.1 / Kling 3.0 Omni / Seedance 2.0 / Grok Imagine Video**. **with-character 템플릿만 이식** (9004 `VIDEO_PROMPT_VEO_CHARACTER` / `_KLING_CHARACTER` / `_SEEDANCE_CHARACTER` / `_GROK_CHARACTER` 4종). FREE(no-character) 4종은 미이식. `_select_video_prompt_template(model, has_character)` 의 has_character 분기는 제거 — **항상 character 변형**. 신랑+신부 두 인물 동시 reference 때문에 템플릿의 "the main character" 같은 단수 표현은 합성부에서 "the bride and the groom — both must match their reference sheets" 식 보강.
5. **Phase 4 — concat + audio merge**: ffmpeg concat → 무음 영상 → mv_jobs.audio_object_name 머지. **자막 출력 없음**. Suno lipsync sync 옵션 OFF.
6. **단계별 진행**: 9004 패턴 — phase 마다 사용자 검토 후 [다음 단계] 버튼 누르면 시작. 한번에 자동 실행 금지. UI 는 요청작 디테일 페이지 안에 [웨딩사진] / [식전영상] 탭, 식전영상 탭에 단계별 카드(시나리오 매핑 → 씬 분할 → 이미지 → 영상 → 최종).
7. **권한**: owner + admin 둘 다 작업 가능 (웨딩사진과 동일).

---

### Plan verification findings (v17)

#### backend_8000 현재 상태 (0단계 분석)
| 영역 | 경로 / 위치 | 현재 동작 | v17 갭 |
|------|-------------|-----------|--------|
| 라우터 등록 | `app/main.py` L25-35, L99-107 | `auth, story, mv, character, assets, share, places, wedding_photos, admin` 9개 등록 | `pre_mv` 라우터 신규 등록 필요. lifespan 에 Mongo 인덱스 ensure 추가 가능 (옵션). |
| 기존 MV 라우터 | `app/routes/mv.py` 전체 (L1-541) | `mv_jobs` 컬렉션 = `{user_id, story_id, music_spec, status, lyrics, audio_object_name, audio_variants, suno_task_id, suno_audio_id, admin_requested, ...}`. status 머신: `generating_lyrics → lyrics_ready → generating_music → music_ready`. `/jobs/{id}/context` 가 시트 4+장소+wedding_photos 반환 (L181-267). `/jobs/{id}/audio` 가 StreamingResponse 로 MP3 (L357-395). `request-admin` 토글 (L398-541). | v17 작업 시 `mv_jobs` 는 **수정하지 않는다**. 별도 `pre_mv_jobs` (또는 `mv_video_jobs`) 신규 컬렉션. mv_jobs.audio_object_name 을 read-only 입력으로 사용. mv_jobs.status 가 `music_ready` 인 잡만 식전영상 작업 가능. |
| 웨딩사진 라우터 | `app/routes/wedding_photos.py` 전체 (L1-1500+) | prefix `/api/mv/jobs/{mv_job_id}/wedding-photos`. owner OR admin 가드(`_resolve_mv_job` L165-194). 컬렉션 2개: `wedding_photo_jobs` (실행) + `wedding_assets` (type=wedding_photo 결과). fire-and-poll: POST /generate → asyncio.create_task → 폴링 GET /jobs/{photo_job_id}. 모델 게이팅: `ALLOWED_IMAGE_MODELS=("gpt_image_2","nb_pro")` (L51). 로그 prefix `[PhotoRoute]` / `[PhotoJob]`. | 식전영상은 5 phase 가 있어 단일 fire-and-poll 보다 **phase 별 POST 트리거 + 각 phase 별 백그라운드 잡** 형태가 적합. 가드·로그·MinIO put 패턴은 그대로 차용. |
| Story 모델 | `app/models/story.py` | `StoryDetails` 6필드(meeting/first_date/memories[]/proposal/wedding_prep/rituals) + 각각 `*_refs: list[MentionRef]`. `MentionRef = {type:"sheet"|"place", asset_id, display_name, object_name?}`. v8 명세 — wedding_photo 타입은 아직 MentionRef 의 `type` Literal 에 **없음**. | Phase 0 LLM 에 그대로 주입. 단, v17 의 Phase 2 reference 자산 풀에 "wedding_photo" 자산도 포함시키려면 MentionRef.type 에 `"wedding_photo"` 추가하거나 별도 ref 채널 마련 필요 (사용자 합의 사항 #3). 본 PLAN 에서는 MentionRef.type 확장 채택. |
| MusicSpec | `app/models/story.py` L85-93 | duration_minutes Literal[2,3], language ko/ko_en_*/en, model | 변경 없음. v17 Phase 0 LLM 입력에 그대로 전달. |
| 인증 | `app/auth.py` L16-64 | JWT + Redis session. `get_current_user` 는 `?token=` 쿼리 fallback 지원(MinIO preview 용). `role` 키 fallback="user". `get_current_admin` 별도 dependency. | owner+admin 가드는 wedding_photos.py 의 `_resolve_mv_job` 패턴 그대로 재사용. |
| Postgres / Mongo / Redis / MinIO 초기화 | `app/database/{postgres,mongodb,redis,minio}.py` + `app/config.py` | 4개 모두 startup 시 init, shutdown 시 close. MinIO 3 bucket: photos/audio/**videos**(`mv-wedding-videos`). asyncpg pool. motor AsyncIOMotorDatabase getter `get_mongo()`. | `videos` 버킷 이미 존재 — Phase 3/4 산출 영상은 이 버킷에 저장. `places` MinIO 객체 path 패턴은 `places/{owner}/...`, 영상은 신규 prefix `pre_mv/{mv_job_id}/{pre_mv_job_id}/...` 제안. |
| 외부 API SDK 사용 패턴 | `app/services/wedding_photo_generator.py`(Gemini text+image) + `app/services/character_generator.py`(`_call_gemini_text`/`_call_gemini_image`) + `app/services/openai_image.py`(GPT Image 2 generations/edits) + `app/services/lyrics_generator.py`(`_get_anthropic_client` Claude + AsyncOpenAI) | 이미 anthropic / openai / google(httpx 직접 호출) 4종 모두 인프라 존재. `_get_anthropic_client()` / `_get_openai_client()` 헬퍼 lyrics_generator.py L40-51 에 있음. | Phase 0 LLM 은 lyrics_generator 패턴을 미러링 (Claude / OpenAI 사용자 선택). Phase 2 이미지 모델은 wedding_photo_generator.py 가 거의 그대로 재사용 가능 (Step A Gemini text → Step B 모델 분기). |
| .env 키 (이름만) | `.env`(40개) | `OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, SUNO_API_KEY, SUNO_API_URL, KLING_ACCESS_KEY, KLING_SECRET_KEY, FAL_API_KEY, SYNC_API_KEY, REPLICATE_API_TOKEN, KITS_API_KEY, KITS_API_URL, LALAL_API_KEY, WONDERA_API_KEY, LOG_ACCESS_TOKEN` 등. **GROK_API_KEY 는 없음.** | Veo=GOOGLE_API_KEY, Kling=KLING_ACCESS_KEY+KLING_SECRET_KEY, Seedance=FAL_API_KEY 모두 보유. **Grok 사용 시 `XAI_API_KEY` 또는 `GROK_API_KEY` 신규 등록 필요** (값은 PLAN 미기재). `config.py` 에 `xai_api_key: str=""` 필드 추가. |
| requirements | `backend_8000/requirements.txt` | fastapi, uvicorn, pyjwt, bcrypt, asyncpg, motor, redis[hiredis], minio, python-dotenv, httpx, openai, anthropic, Pillow | Phase 3 Kling JWT 는 `pyjwt` 그대로 사용. ffmpeg 는 시스템 바이너리(`/home/duckjk89/.local/bin/ffmpeg` v8.0 확인됨) — 신규 의존성 무. |
| 프론트 API 모듈 | `frontend/src/api/index.js` L1-235 | axios 인스턴스 baseURL=`:8000/api`, JWT interceptor, blob 다운로드/sheet preview 패턴, FormData multipart 패턴 모두 정립. `getJobContext`, `generateWeddingPhoto`, `getWeddingPhotoJob` 등 wedding 함수군. | v17 신규 함수 9개 추가 (REST 매트릭스 참조). |
| 프론트 라우팅 | `frontend/src/App.jsx` L37-44 | `/projects/:id` → `GenerationStatusPage`. 추가 라우트 변경 없음. | 신규 페이지 없음. `GenerationStatusPage` 안에서 [웨딩사진] / [식전영상] 탭으로 분기. |
| 디테일 페이지 진입 | `frontend/src/pages/AdminJobsPage.jsx` L156-161 + `frontend/src/pages/MyWeddingMVPage.jsx` | `<Link to={`/projects/${jobId}`}>` 패턴 (admin / my 둘 다). | 변경 없음 — 같은 페이지 안에 탭만 추가. |
| 디테일 페이지 본문 | `frontend/src/pages/GenerationStatusPage.jsx` L252-254 | `{job && <WeddingPhotoPanel mvJobId={id} ownerUserId={job.user_id} />}` 단일 패널. mv_job status 폴링 (5초). | 패널 옆에 `<PreCeremonyMVPanel mvJobId={id} ownerUserId={job.user_id} mvJob={job} />` 추가. 두 패널 사이를 탭으로 묶거나 위/아래 배치 — v17 합의 사항 #6 의 "탭" 채택. |
| 패널 패턴 | `frontend/src/components/WeddingPhotoPanel.jsx` (1000+ 줄) | owner||admin 가드 → `WeddingPhotoPanelInner` 분리. `useEffect` 5초 폴링, `getJobContext` 마운트 fetch, `MentionField` 통합, `activeJobIds: Set` 으로 통합 폴링 (v15.2). DEV-only `console.info` 로깅. | `PreCeremonyMVPanel` 도 동일 가드+탭 외피. 내부는 단계 카드 5개 (Phase 0~4) — 단계 도달 여부에 따라 disabled/expanded. |
| 가사 timestamps | **현재 없음**: `app/services/lyrics_generator.py` 는 가사 본문 텍스트만 반환. `app/services/suno_generator.py` 는 audio_object_name + audio_variants + suno_task_id + suno_audio_id 만 저장. **라인별 timestamp 없음**. | 9004 의 `services/suno_timestamp_service.py` (`get_suno_timestamps(task_id, audio_id)` → Suno `get-timestamped-lyrics` 엔드포인트 호출 → 단어 timestamp → 라인 단위 group) 패턴을 그대로 이식. v17-pre 작업으로 진행. |
| 원격 로깅 | `app/main.py` 는 `logging.basicConfig(level=INFO)` + `print()`. .env 에 `LOG_ACCESS_TOKEN` 키가 있으나 backend_8000 코드에선 미사용. **원격 인프라 없음.** | v17 은 백엔드 `logger.info/warning/error` + 프론트 `console.info/warn/error` 만. prefix 통일. |

#### 결정사항 (분석 결과 반영)
1. **신규 컬렉션 `pre_mv_jobs`** (또는 `mv_video_jobs`) 채택 — 식전영상은 5단계 상태 + scenes[] + 잡 트리거 분리가 mv_jobs 와 너무 달라 서브문서로 두면 mv_jobs 가 비대해진다. **본 PLAN 에서는 `pre_mv_jobs` 명칭 채택.**
2. `mv_jobs.audio_object_name` 는 v17 의 read-only 입력. Suno 결과(`mv_jobs/{job_id}/track_1.mp3`) 형식 그대로 사용.
3. **MentionRef.type 에 `"wedding_photo"` 추가** — v17.0 pre-work. story 모델은 변경 없이도 Phase 0 LLM 에 v13 wedding_photos 풀을 별도 컨텍스트로 주입할 수 있으나, Phase 2 에서 wedding_prep 시점이 해당 photo 의 place 를 location ref 로 끌고 와야 하므로 MentionRef.type 확장이 깔끔.
4. **Suno timestamped lyrics 이식 (v17-pre)** — Phase 0 가 라인별 timestamp 필요. `services/suno_timestamp_service.py` 신규 + `mv_jobs.lyric_timestamps` 필드 추가 + `_run_music_generation` 끝에 best-effort fetch + Mongo 업데이트.
5. **Veo / Kling / Seedance 키 OK, Grok 키 등록 필요 (v17-pre).** config.py 와 .env.example 에 `xai_api_key` 추가.

---

### v17 sub-version split (작업 분할)
큰 v17 을 4 sub-version 으로 쪼개 단계적으로 진행한다. backend-dev / frontend-dev 가 각 sub 별로 PR 만들 수 있게.

| sub | 제목 | 범위 |
|-----|------|------|
| **v17.0** | 사전 인프라 (pre-infra) | `services/suno_timestamp_service.py` 신규 + `mv_jobs.lyric_timestamps` 채우기 + `models/story.py` MentionRef.type 확장 + `config.py xai_api_key` + `.env.example` 갱신 + Mongo 인덱스 ensure. 실제 식전영상 라우터는 v17.1 부터. |
| **v17.1** | 데이터모델 + Phase 0/1 + 골격 UI | `pre_mv_jobs` 컬렉션 정의, `app/routes/pre_mv.py` 라우터 신설(POST /jobs, GET /jobs/{id}, POST /phase0, POST /phase1), `app/services/pre_mv_scenario.py` (Phase 0 Claude/GPT), `app/services/pre_mv_scene_split.py` (Phase 1 가사 라인 단위 분할), `frontend/src/components/PreCeremonyMVPanel.jsx` (탭 + 5 step cards, Phase 0/1 까지 동작). |
| **v17.2** | Phase 2 씬 이미지 | `app/services/pre_mv_scene_image.py` (wedding_photo_generator 패턴 차용, multi-ref 신랑+신부+장소+필요 시 wedding_photo), `routes/pre_mv.py` POST /phase2 + scenes/{n}/regenerate-image + PATCH /scenes/{n}, 프론트 PreMVScenesStep.jsx 컴포넌트. |
| **v17.3** | Phase 3/4 영상 + 최종 머지 | `app/services/{veo,kling,seedance,grok}_video_generator.py` 4종 이식, `app/services/pre_mv_video.py` 오케스트레이션, `app/services/pre_mv_concat.py` (ffmpeg concat + audio merge), POST /phase3 + scenes/{n}/regenerate-video + POST /phase4 + GET /result, 프론트 PreMVVideosStep.jsx + PreMVFinalStep.jsx. |

> 단, 본 PLAN 의 데이터 모델 / REST / 변경 매트릭스 / 테스트는 v17 전체 기준으로 한 번에 적는다. 구현 PR 분할은 위 매트릭스대로.

---

### 데이터 모델

#### Mongo 컬렉션 — `pre_mv_jobs` (신규)
```
{
  _id: ObjectId,
  mv_job_id: str,                      // 부모 mv_jobs._id (FK 역할)
  user_id: str,                        // owner (mv_jobs.user_id 와 동일, 캐시)
  status: str,                         // 상태 머신 (아래 참조)
  scenario_model: str | null,          // "claude_4_7_opus" | "gpt_latest"
  image_model: str | null,             // "gpt_image_2" | "nb_pro"
  video_model: str | null,             // "veo" | "kling" | "seedance" | "grok"
  story_snapshot: dict,                // 잡 생성 시점의 story 6시점 + refs 스냅샷
  lyrics_snapshot: dict,               // {title, body, model} 스냅샷
  lyric_timestamps: list[dict],        // [{text, start, end}] — mv_jobs 에서 copy
  audio_object_name: str,              // mv_jobs.audio_object_name 스냅샷
  scene_plan: list[dict],              // Phase 0 결과 (아래 참조)
  scenes: list[dict],                  // Phase 1 결과 (아래 참조, 9004 와 동일 필드)
  final_video_object_name: str | null, // Phase 4 결과 (mv-wedding-videos 버킷)
  phase_progress: dict,                // {phase0:{started_at,finished_at,error,model}, ...}
  error_message: str | null,
  created_at: datetime,
  updated_at: datetime,
}
```

##### `scene_plan[]` 원소 (Phase 0 산출)
```
{
  lyric_line: str,
  lyric_start: float,                  // seconds
  lyric_end: float,
  story_slot: str,                     // "meeting"|"first_date"|"memories"|"proposal"|"wedding_prep"|"rituals"
  story_excerpt: str,                  // story[slot] 에서 인용한 부분 (LLM 이 발췌)
  refs: list[dict],                    // MentionRef 그대로 (sheet|place|wedding_photo)
}
```

##### `scenes[]` 원소 (Phase 1 산출, 9004 와 동일 필드)
```
{
  scene_number: int,                   // 1..N (가사 라인과 1:1)
  description: str,                    // 영문 행동/감정 묘사
  description_ko: str,                 // 한국어 미러
  image_prompt: str,                   // Phase 2 입력 (영문)
  image_prompt_ko: str,                // 한국어 미러
  video_prompt: str,                   // Phase 3 입력 (카메라 워크 영문)
  video_prompt_ko: str,
  section: str,                        // 음악 섹션 라벨 (Verse/Chorus/...)
  section_start: float,
  section_end: float,
  use_seconds: float,                  // 이 씬에 할당된 영상 길이
  event_index: int,                    // 0-based, scene_plan idx 와 동일
  ref_sheet_ids: list[str],            // 사용한 sheet slot 키들 ("groom_wedding" 등)
  ref_place_ids: list[str],            // 사용한 place asset_id 들 + (v17 확장) wedding_photo asset_id 들
  story_slot: str,                     // Phase 0 의 story_slot 전파 (그룹핑용)
  // 산출 후 채워지는 필드들
  image_object_name: str | null,       // Phase 2 결과 (MinIO photos 버킷)
  video_object_name: str | null,       // Phase 3 결과 (MinIO videos 버킷)
  image_status: str,                   // "pending"|"generating"|"done"|"failed"
  video_status: str,                   // "pending"|"generating"|"done"|"failed"
  image_error: str | null,
  video_error: str | null,
  image_started_at, image_finished_at, video_started_at, video_finished_at,
  // 사용자 편집 흔적 (편집된 필드는 자동 재생성 cascade 에서 보존)
  user_edited_fields: list[str],       // 예: ["description","video_prompt"]
}
```

#### 상태 머신
```
draft
  └─[POST /phase0]→ phase0_mapping (백그라운드 실행 중)
                       ├─ ok → phase0_ready (scene_plan 있음, 사용자 확인 대기)
                       └─ fail → phase0_failed
  └─[POST /phase1]→ phase1_splitting
                       ├─ ok → phase1_ready (scenes[] 있음)
                       └─ fail → phase1_failed
  └─[POST /phase2]→ phase2_images (각 씬 직렬 또는 작은 동시)
                       ├─ ok (전 씬 done) → phase2_ready
                       └─ 일부 fail → phase2_partial (사용자가 실패 씬만 regenerate 가능)
  └─[POST /phase3]→ phase3_videos
                       ├─ ok → phase3_ready
                       └─ 일부 fail → phase3_partial
  └─[POST /phase4]→ phase4_concat
                       ├─ ok → completed (final_video_object_name 있음)
                       └─ fail → phase4_failed
```
- 각 phase 의 `*_ready` 상태에서 사용자가 [다음 단계 시작] 버튼을 눌러야 다음 POST 가 호출된다. 자동 진행 금지.
- `phase2_partial` / `phase3_partial` 에서는 사용자가 (a) 실패 씬만 재생성 (b) 그래도 다음 단계 진행 둘 다 가능. 미완료 씬이 있으면 phase3/phase4 진입은 막는다(422).
- 어떤 상태에서도 [씬 텍스트 편집] (description/image_prompt/video_prompt 등) 가능. 편집 시 해당 씬의 `image_status / video_status` 를 "pending" 으로 invalidate (9004 의 `_v51_invalidate_video` 패턴).

---

### REST API 매트릭스 (신규 — prefix `/api/pre-mv`)
모든 엔드포인트는 owner OR admin 가드. 404=pre_mv_job 없음, 403=권한, 409=상태 불일치, 422=입력 검증, 503=외부 키 미설정. 응답 표준 shape `{pre_mv_job_id, status, ...}`.

| # | Method | Path | Body | 응답 | 권한 | 비고 |
|---|--------|------|------|------|------|------|
| 1 | POST | `/api/pre-mv/jobs` | `{mv_job_id: str}` | `{pre_mv_job_id, status:"draft"}` | owner+admin (mv_jobs 기준) | mv_jobs.status 가 `music_ready` 여야 함. mv_jobs.lyric_timestamps 가 있어야 함 (v17.0 보장). 동일 mv_job_id 의 기존 pre_mv_jobs 가 있으면 그 doc 반환 (멱등). |
| 2 | GET | `/api/pre-mv/jobs/{id}` | — | 전체 doc(serialize) | owner+admin | 5초 폴링용. scene_plan / scenes / 각 phase progress 반환. |
| 3 | POST | `/api/pre-mv/jobs/{id}/phase0` | `{scenario_model: "claude_4_7_opus"|"gpt_latest"}` | `{pre_mv_job_id, status:"phase0_mapping"}` | owner+admin | status ∈ {draft, phase0_failed, phase0_ready (재실행 허용)}. 그 외 409. asyncio.create_task 백그라운드 실행. |
| 4 | POST | `/api/pre-mv/jobs/{id}/phase1` | `{}` | `{pre_mv_job_id, status:"phase1_splitting"}` | owner+admin | status ∈ {phase0_ready, phase1_failed, phase1_ready}. 그 외 409. |
| 5 | POST | `/api/pre-mv/jobs/{id}/phase2` | `{image_model: "gpt_image_2"|"nb_pro"}` | `{pre_mv_job_id, status:"phase2_images", queued_scene_numbers:[...]}` | owner+admin | status ∈ {phase1_ready, phase2_failed, phase2_partial, phase2_ready(재생성)}. |
| 6 | POST | `/api/pre-mv/jobs/{id}/phase3` | `{video_model: "veo"|"kling"|"seedance"|"grok"}` | `{pre_mv_job_id, status:"phase3_videos"}` | owner+admin | status ∈ {phase2_ready, phase3_failed, phase3_partial}. 미완료 씬 있으면 422. |
| 7 | POST | `/api/pre-mv/jobs/{id}/phase4` | `{}` | `{pre_mv_job_id, status:"phase4_concat"}` | owner+admin | status ∈ {phase3_ready, phase4_failed}. |
| 8 | POST | `/api/pre-mv/jobs/{id}/scenes/{n}/regenerate-image` | `{}` | `{scene_number, image_status:"generating"}` | owner+admin | 단일 씬 이미지 재생성. scene.image_model 은 phase2 잡의 모델 lock. |
| 9 | POST | `/api/pre-mv/jobs/{id}/scenes/{n}/regenerate-video` | `{}` | `{scene_number, video_status:"generating"}` | owner+admin | 단일 씬 영상 재생성. scene.video_model lock. |
| 10 | PATCH | `/api/pre-mv/jobs/{id}/scenes/{n}` | `{description?, image_prompt?, video_prompt?, description_ko?, image_prompt_ko?, video_prompt_ko?}` | `{scene_number, updated_fields:[...]}` | owner+admin | 편집된 필드는 `user_edited_fields` 에 누적. invalidate: image_prompt 변경 → image_status=pending+video_status=pending. video_prompt 만 변경 → video_status=pending. |
| 11 | GET | `/api/pre-mv/jobs/{id}/result` | — | `{pre_mv_job_id, final_video_object_name, preview_url}` | owner+admin | status=completed 일 때만 200. 그 외 409. preview_url = `/api/pre-mv/jobs/{id}/result/stream?token=...`. |
| 12 | GET | `/api/pre-mv/jobs/{id}/result/stream` | — (query token) | StreamingResponse(video/mp4) | owner+admin | 최종 MP4 스트리밍. wedding_photos.py 의 audio 스트리밍 패턴. |
| 13 | DELETE | `/api/pre-mv/jobs/{id}` | — | `{ok:true}` | owner+admin | 잡 + 모든 씬 image/video MinIO 객체 + 최종 MP4 정리. wedding_assets type=pre_mv_scene 자산(만약 두면) 도 삭제. v17.3 에서 구현. |

#### Phase 별 백그라운드 로직 요약
- **Phase 0** (`pre_mv_scenario.py`): story_snapshot + lyrics_snapshot + lyric_timestamps → Claude/OpenAI system prompt → JSON 출력(scene_plan[]) → 검증(라인 수 == lyric_timestamps 라인 수, story_slot 유효, refs 가 story_snapshot 의 *_refs 에서 유래). 실패 시 1회 재시도. 성공 시 status=phase0_ready.
- **Phase 1** (`pre_mv_scene_split.py`): 9004 `mv_pipeline._split_with_music_sections` 로직 차용 + Gemini text 로 image_prompt / video_prompt 생성 (9004 `generate_video_prompts_from_images` 의 텍스트-only 분기 패턴). 인접 동일 story_slot 의 video_prompt 에 "continuing from previous scene" 자동 prepend. 결과 scenes[] 저장.
- **Phase 2** (`pre_mv_scene_image.py`): 씬마다 `wedding_photo_generator.generate_wedding_photo` 와 거의 동일 — multi-ref (signed groom_sheet bytes + bride_sheet bytes + place bytes + 옵션 wedding_photo bytes). user_text=image_prompt. 동시 실행 수 = 2 (Gemini/OpenAI rate 보호). 각 씬 완료 시 MinIO photos 버킷 `pre_mv/{mv_job_id}/{pre_mv_job_id}/scenes/{n}.png` 저장.
- **Phase 3** (`pre_mv_video.py` 오케스트레이션): video_model 에 따라 `veo_video_generator.start_scene_video` / `kling_video_generator.start_scene_video` / `seedance_video_generator.start_scene_video` / `grok_video_generator.start_scene_video` 중 하나 호출. 각 씬의 image_object_name 을 MinIO 에서 로드 → bytes → API. 결과 영상 bytes → MinIO videos `pre_mv/{mv_job_id}/{pre_mv_job_id}/scenes/{n}.mp4`. 동시 실행 수 = 1 (외부 API 비싸고 폴링 오래 걸림). 각 모델별 폴링 함수 사용.
- **Phase 4** (`pre_mv_concat.py`): scenes 순서대로 MinIO 영상 다운로드 → ffmpeg concat (`-f concat -safe 0`) → 무음 mp4 → ffmpeg audio merge with `mv_jobs.audio_object_name` 다운로드 본 → 최종 MP4. videos 버킷에 `pre_mv/{mv_job_id}/{pre_mv_job_id}/final.mp4` 저장. status=completed.

---

### 변경 매트릭스

#### v17.0 — 사전 인프라
| # | 파일 | 변경 | 추적자 |
|---|------|------|--------|
| 0.1 | `backend_8000/app/services/suno_timestamp_service.py` (신규) | 9004 동명 파일 복사. `get_suno_timestamps(task_id, audio_id)` + `_words_to_segments(words)`. 반환 `[{text,start,end}]`. | `suno_task_id`, `suno_audio_id`, `job_id` |
| 0.2 | `backend_8000/app/routes/mv.py` `_run_music_generation` | 음악 ready 직후 `get_suno_timestamps(task_id, audio_id)` best-effort 호출. 결과를 `mv_jobs.lyric_timestamps` 에 저장. 실패 시 빈 배열로 두고 warning. | `[MVRoute] action=fetch_timestamps job_id, segments_count` |
| 0.3 | `backend_8000/app/models/story.py` | `MentionRef.type` Literal 에 `"wedding_photo"` 추가. 기존 type Literal 확장만, 필드 호환. | — |
| 0.4 | `backend_8000/app/config.py` + `.env.example` | `xai_api_key: str = ""` 추가. .env.example 에 `XAI_API_KEY=` 한 줄. | — |
| 0.5 | `backend_8000/app/main.py` lifespan | (옵션) Mongo `pre_mv_jobs` 인덱스 ensure: `mv_job_id`, `(user_id, status)`, `created_at desc`. 멱등. | `[Startup] pre_mv_jobs indexes ensured` |

#### v17.1 — 데이터모델 + Phase 0/1 + 골격 UI
| # | 파일 | 변경 | 추적자 |
|---|------|------|--------|
| 1.1 | `backend_8000/app/routes/pre_mv.py` (신규) | prefix `/api/pre-mv`. 가드 헬퍼 `_resolve_pre_mv(pre_mv_job_id, current_user)` (mv_jobs.user_id 기준 owner+admin). 엔드포인트 1,2,3,4,11(GET result placeholder 만). `_run_phase0`, `_run_phase1` 백그라운드 헬퍼. 직렬화 `_serialize_pre_mv_job`. `main.py` 에 등록. | `[PreMVRoute]` `pre_mv_job_id`, `phase`, `model` |
| 1.2 | `backend_8000/app/services/pre_mv_scenario.py` (신규) | `generate_scene_plan(story_snapshot, lyrics_snapshot, lyric_timestamps, model)` → scene_plan[]. Claude / OpenAI 클라이언트는 lyrics_generator 의 `_get_anthropic_client` / `_get_openai_client` 패턴. JSON only system prompt — story 6시점 + lyric_timestamps 라인별 매핑 강제. Mention refs 는 story_snapshot 의 *_refs 풀에서만 유효. **모델 기본=`settings.wedding_lyrics_default_model`("claude-opus-4-7"), 선택 옵션=`gpt-5.4`(settings.openai_model_advanced).** | `[PreMVScenario]` `pre_mv_job_id`, `model`, `lines_in`, `lines_out`, `elapsed_ms` |
| 1.3 | `backend_8000/app/services/pre_mv_scene_split.py` (신규) | `split_lyrics_into_scenes(scene_plan, lyric_timestamps, music_spec)` → scenes[]. 9004 `mv_pipeline._split_with_music_sections` 로직 차용(읽기 전용 참고). image_prompt / video_prompt 는 Gemini text 호출(`character_generator._call_gemini_text`) — 가사라인 + scene_plan.story_excerpt + story_slot 그룹핑(연속 컷) 힌트 + 영문 1단락 출력 강제. | `[PreMVSplit]` `pre_mv_job_id`, `scene_count` |
| 1.4 | `backend_8000/app/main.py` | `from .routes import pre_mv` + `app.include_router(pre_mv.router)`. | — |
| 1.5 | `frontend/src/api/index.js` | 신규 9개 함수: `createPreMVJob(mvJobId)`, `getPreMVJob(id)`, `startPreMVPhase0(id, scenarioModel)`, `startPreMVPhase1(id)`, `startPreMVPhase2(id, imageModel)`, `startPreMVPhase3(id, videoModel)`, `startPreMVPhase4(id)`, `regeneratePreMVSceneImage(id, sceneNumber)`, `regeneratePreMVSceneVideo(id, sceneNumber)`, `patchPreMVScene(id, sceneNumber, fields)`, `getPreMVResult(id)`, `preMVResultStreamUrl(id)`. (v17.1 에선 1~4번까지 호출, 나머진 stub.) | — |
| 1.6 | `frontend/src/components/PreCeremonyMVPanel.jsx` + `.css` (신규) | 권한 가드(`owner||admin`) → `PreCeremonyMVPanelInner`. props=`{mvJobId, ownerUserId, mvJob}`. `useEffect` 마운트 시 `getPreMVJob` (없으면 자동 createPreMVJob). 5초 폴링. 5 step card: Phase 0 / Phase 1 / Phase 2 / Phase 3 / Phase 4. v17.1 단계에선 Phase 0/1 active, Phase 2~4 는 "준비 중". Phase 0 카드: scenario_model select(Claude 4.7 Opus 기본 / GPT 최신) + [매핑 시작]. ready 시 scene_plan 테이블 표시(가사 라인 / story_slot / story_excerpt / refs chips). Phase 1 카드: [씬 분할 시작]. ready 시 scenes 목록 표시. | `[PreCeremonyMVPanel]`, `[PreMVScenarioStep]`, `[PreMVScenesStep]` |
| 1.7 | `frontend/src/pages/GenerationStatusPage.jsx` | 음악 ready 이상일 때 panel area 에 탭 2개([웨딩사진] / [식전영상]). 식전영상 탭에 `<PreCeremonyMVPanel mvJobId={id} ownerUserId={job.user_id} mvJob={job} />`. 기본 탭 = 웨딩사진(회귀 보호). lyric_timestamps 없으면 식전영상 탭 disable + "음악 timestamp 준비 중" 안내. | `[GenStatus]` action=tab_change |

#### v17.2 — Phase 2 씬 이미지
| # | 파일 | 변경 | 추적자 |
|---|------|------|--------|
| 2.1 | `backend_8000/app/routes/pre_mv.py` | 엔드포인트 5(POST /phase2), 8(regenerate-image), 10(PATCH /scenes/{n}) 추가. `_run_phase2`, `_run_single_scene_image` 백그라운드. owner/admin 가드 그대로. image_model 키 503 게이팅(gpt_image_2→openai_api_key, nb_pro→google_api_key). | `[PreMVRoute] phase=phase2` `pre_mv_job_id, scene_number, image_model` |
| 2.2 | `backend_8000/app/services/pre_mv_scene_image.py` (신규) | `generate_scene_image(scene, refs, image_model, mv_job_id, pre_mv_job_id, scene_number)` → PNG bytes. wedding_photo_generator 패턴 — Step A Gemini text(scene.image_prompt + refs metadata) → Step B openai_image / nb_pro. refs 는 ref_sheet_ids + ref_place_ids + (옵션) wedding_photo_ids 풀에서 MinIO bytes 로 로드. 두 인물 ref 강제 — 단수 표현 보강 문구 prepend. | `[PreMVSceneImage]` `pre_mv_job_id, scene_number, image_model, refs_count, elapsed_ms` |
| 2.3 | `frontend/src/components/PreMVScenesStep.jsx` (신규) | Phase 1 → Phase 2 카드 확장. scenes 그리드: 카드마다 thumbnail(완료 시) + image_status + [재생성] 버튼 + [✏ 편집] 버튼. 편집 모달은 description / image_prompt / video_prompt textarea. 미완료 씬 있으면 Phase 3 진입 비활성. | `[PreMVScenesStep]` action=regen_image\|patch_scene |
| 2.4 | `frontend/src/api/index.js` | (v17.1 stub 채움) | — |

#### v17.3 — Phase 3/4 영상 + 최종 머지
| # | 파일 | 변경 | 추적자 |
|---|------|------|--------|
| 3.1 | `backend_8000/app/services/veo_video_generator.py` (신규) | 9004 `mv_generator.py` L5157-5270 `start_scene_video` 복사 + 단순화(립싱크 분기 제거, 항상 drama). Veo 3.1 fast preview URL 그대로. `check_scene_video_status(operation_name)` 폴링 헬퍼 9004 `mv_generator.py` L5276-5427 차용. **출처**: `/0_platform_music/backend_9004/app/services/mv_generator.py:5157~5270` (start), `:5276~5427` (poll). | `[VeoVideo]` `pre_mv_job_id, scene_number` |
| 3.2 | `backend_8000/app/services/kling_video_generator.py` (신규) | 9004 동명 파일 거의 그대로 복사 (293 줄). JWT HS256(`pyjwt`), `kling-v3-omni` 엔드포인트. 단, FREE 변형 제거(우리는 항상 character). **출처**: `/0_platform_music/backend_9004/app/services/kling_video_generator.py` 전체. | `[KlingVideo]` `pre_mv_job_id, scene_number` |
| 3.3 | `backend_8000/app/services/seedance_video_generator.py` (신규) | 9004 동명 파일 그대로 복사 (215 줄). fal.run queue API. **출처**: 동상. | `[SeedanceVideo]` |
| 3.4 | `backend_8000/app/services/grok_video_generator.py` (신규) | 9004 동명 파일 그대로 복사 (229 줄). `api.x.ai/v1/videos/generations`. `settings.xai_api_key` 사용. **출처**: 동상. | `[GrokVideo]` |
| 3.5 | `backend_8000/app/services/pre_mv_video.py` (신규) | video_model 디스패치 + 폴링 + with-character 템플릿 prompt 합성. 9004 `mv_generator.py` 의 4개 character 템플릿(L134-201/L259-319/L376-438/L497-554) 그대로 차용하되 단수→복수 보강. **출처**: 동상. | `[PreMVVideo]` `pre_mv_job_id, scene_number, video_model, elapsed_ms` |
| 3.6 | `backend_8000/app/services/pre_mv_concat.py` (신규) | ffmpeg concat + audio merge. 9004 `mv_pipeline.run_phase4_concatenate` + `run_phase5_merge_audio` 의 ffmpeg 호출 부분만 차용(자막 코드 제외). tempdir 에 mp4 다운로드 → concat list.txt → `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4` → `ffmpeg -i out.mp4 -i audio.mp3 -c:v copy -c:a aac -shortest final.mp4`. | `[PreMVConcat]` `pre_mv_job_id, scenes_count, final_bytes` |
| 3.7 | `backend_8000/app/routes/pre_mv.py` | 엔드포인트 6, 7, 9, 11, 12, 13 추가. `_run_phase3`, `_run_phase4`, `_run_single_scene_video` 백그라운드. ffmpeg 미설치 시 503 — startup 시 `which ffmpeg` 1회 체크 결과 캐시. | `[PreMVRoute] phase=phase3\|phase4` |
| 3.8 | `frontend/src/components/PreMVVideosStep.jsx` (신규) | Phase 3 카드. video_model select 4종 + [영상 시작]. scenes 그리드 — 각 카드에 비디오 ✓/✗ + [재생성]. | `[PreMVVideosStep]` |
| 3.9 | `frontend/src/components/PreMVFinalStep.jsx` (신규) | Phase 4 카드. [최종 합치기] 버튼. completed 시 `<video>` 플레이어 + [다운로드]. | `[PreMVFinalStep]` |

---

### 테스트 항목

#### 정상 진행
1. mv_jobs.status=music_ready + lyric_timestamps 채워진 잡 → POST /api/pre-mv/jobs → draft 생성.
2. POST /phase0 (scenario_model=claude_4_7_opus) → 폴링 → phase0_ready, scene_plan 라인 수 == lyric_timestamps 라인 수.
3. POST /phase0 (scenario_model=gpt_latest) → 동일.
4. POST /phase1 → phase1_ready, scenes[] 길이 == scene_plan 길이.
5. POST /phase2 (image_model=gpt_image_2) → 각 씬 image_object_name 채워짐 → phase2_ready.
6. POST /phase2 (image_model=nb_pro) → 동일.
7. POST /phase3 (video_model 4종 각각) → phase3_ready.
8. POST /phase4 → completed, final_video_object_name 존재.
9. GET /result/stream → MP4 재생 가능, 영상 길이 ≈ audio 길이.

#### 권한 / 에러
10. 비owner+비admin 토큰 → 모든 phase POST 403.
11. admin 토큰으로 다른 사용자 잡 phase0 호출 → 200 (admin 허용).
12. status 가 아직 phase0_ready 가 아닌데 phase1 호출 → 409.
13. lyric_timestamps 빈 mv_job 으로 POST /api/pre-mv/jobs → 422 + 안내 메시지.
14. xai_api_key 미설정에서 phase3(video_model=grok) → 503.
15. scenes 한 개 image_status=failed 인데 phase3 호출 → 422 + 어느 씬 누락인지 메시지.

#### 회귀
16. 웨딩사진 패널 / 음악 생성 / 가사 생성 / admin 요청작 / audio 다운로드 모두 정상.
17. 기존 mv_jobs 컬렉션 read 경로(`GET /api/mv/jobs/{id}`)에 lyric_timestamps 노출되어도 프론트가 깨지지 않음(\_serialize_job 에 추가 시 옵션 필드).

#### 모델 선택 UI
18. Phase 0 카드에서 scenario_model 변경 후 [매핑 시작] 다시 → 새 scene_plan 으로 덮어쓰기. user_edited_fields 는 보존 정책 명시: scene_plan 재생성 시 scenes[]가 아직 비어있으면 영향 없음. scenes[] 가 있으면 사용자에게 confirm("기존 씬도 초기화됩니다") 후 진행.
19. Phase 2 / Phase 3 모델 변경은 잡 단위 lock — 한 번 시작한 phase 의 모델은 변경 불가(재시작 시에만 변경). 모달로 안내.

#### 실패 재시도
20. phase2 1씬 실패 → phase2_partial → POST /scenes/{n}/regenerate-image → done → phase2_ready 로 승격(모든 씬 done 시).
21. phase3 1씬 실패 → 동일 흐름.
22. phase4 ffmpeg 실패 시 phase4_failed + error_message. [다시 시도] 버튼 → POST /phase4 재호출.

#### 씬 편집
23. PATCH /scenes/{n} image_prompt 변경 → image_status=pending, video_status=pending. Phase 3 진입 비활성.
24. PATCH /scenes/{n} video_prompt 만 변경 → video_status=pending. Phase 2 영향 없음.

---

### 민감 정보 보호
- 외부 API 키 노출 금지. 본 PLAN 에는 키 이름만:
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (Phase 0)
  - `GOOGLE_API_KEY` (Phase 1 image prompt 합성, Phase 2 nb_pro, Phase 3 Veo, v17.0 Suno timestamps 와 무관)
  - `SUNO_API_KEY`, `SUNO_API_URL` (v17.0 timestamps)
  - `KLING_ACCESS_KEY`, `KLING_SECRET_KEY` (Phase 3 Kling)
  - `FAL_API_KEY` (Phase 3 Seedance)
  - `XAI_API_KEY` (v17.0 신규 — Phase 3 Grok)
- 로그 가이드:
  - 본문 / 사용자 텍스트: **길이만** 로깅(`text_len=`). 절대 본문 출력 금지.
  - 이미지/영상 bytes: **`bytes=` 만**. base64 / hex 금지.
  - JWT token / API response body: `resp.status_code` + `resp.text[:300]` 까지만. 키는 절대 포함 금지.
  - 사용자 식별: `user_id` 만. email / nickname 은 admin 라우터 외 출력 금지.

---

### 디버그 로그 추적자 (필수)
| 위치 | prefix | 필수 토큰 |
|------|--------|----------|
| `routes/pre_mv.py` | `[PreMVRoute]` | `user_id`, `is_admin`, `pre_mv_job_id`, `mv_job_id`, `phase`, `model`, `action` |
| `services/pre_mv_scenario.py` | `[PreMVScenario]` | `pre_mv_job_id`, `model`, `lines_in`, `lines_out`, `elapsed_ms` |
| `services/pre_mv_scene_split.py` | `[PreMVSplit]` | `pre_mv_job_id`, `scene_count`, `elapsed_ms` |
| `services/pre_mv_scene_image.py` | `[PreMVSceneImage]` | `pre_mv_job_id`, `scene_number`, `image_model`, `refs_count`, `elapsed_ms`, `bytes` |
| `services/pre_mv_video.py` | `[PreMVVideo]` | `pre_mv_job_id`, `scene_number`, `video_model`, `elapsed_ms`, `bytes` |
| `services/{veo,kling,seedance,grok}_video_generator.py` | `[VeoVideo]` / `[KlingVideo]` / `[SeedanceVideo]` / `[GrokVideo]` | `pre_mv_job_id`, `scene_number`, `operation_name`(있으면), `http_status` |
| `services/pre_mv_concat.py` | `[PreMVConcat]` | `pre_mv_job_id`, `scenes_count`, `final_bytes`, `elapsed_ms` |
| `services/suno_timestamp_service.py` | `[SunoTimestamps]` | `suno_task_id`, `suno_audio_id`, `segments_count` |
| Frontend `PreCeremonyMVPanel.jsx` | `[PreCeremonyMVPanel]` | `pre_mv_job_id`, `status`, `action` |
| Frontend `PreMVScenarioStep.jsx` | `[PreMVScenarioStep]` | `pre_mv_job_id`, `scenario_model`, `lines` |
| Frontend `PreMVScenesStep.jsx` | `[PreMVScenesStep]` | `pre_mv_job_id`, `image_model`, `scene_count`, `action` |
| Frontend `PreMVVideosStep.jsx` | `[PreMVVideosStep]` | `pre_mv_job_id`, `video_model`, `scene_count`, `action` |
| Frontend `PreMVFinalStep.jsx` | `[PreMVFinalStep]` | `pre_mv_job_id`, `status`, `action` |

---

### 사전 인프라 / 인덱스 / 의존성 체크리스트
- [x] **ffmpeg 설치 확인** — `/home/duckjk89/.local/bin/ffmpeg` v8.0 (`which ffmpeg`). 추가 설치 불필요.
- [ ] **Mongo 인덱스** (v17.0 lifespan): `pre_mv_jobs` 에 `{mv_job_id: 1}`, `{user_id: 1, status: 1}`, `{created_at: -1}` 3개 멱등 ensure.
- [ ] **`xai_api_key`** — `config.py` 필드 + `.env.example` 키 추가 (v17.0). 실제 키 값은 운영 .env 에 사용자가 추가.
- [ ] **MinIO videos 버킷** — 이미 `mv-wedding-videos` 존재 (`main.py` REQUIRED_BUCKETS L40-44 확인).
- [ ] **Suno timestamped lyrics 엔드포인트** — `${SUNO_API_URL}/api/v1/generate/get-timestamped-lyrics`. 9004 의 `suno_timestamp_service.py` 그대로 이식 가능(`api-key` 헤더 형태).
- [ ] **Whisper fallback** — Suno timestamps 가 일부 곡에서 비어 올 수 있음. v17.0 에선 빈 배열 허용 + Phase 0 시 422("음악 timestamp 가 준비되지 않았습니다 — 잠시 후 재시도") 안내만. Whisper alignment 추가는 v17.x 후속.
- [ ] **Grok API 등록** — v17.3 진입 전 사용자가 xai 계정 발급 + .env 값 채우기. PLAN 에는 키 값 미기재.

---

### 위험 / 갭 / 권고
1. **외부 영상 API 비용·시간**: 4모델 모두 씬당 30초~3분 + 토큰/크레딧 소비. 합의 사양 #6 의 "단계별 버튼" + 씬 단일 재생성 UI 가 안전장치. 추가로 잡 단위 [전체 취소] 버튼은 v17.3 의 옵션 — 우선순위 낮음. ⇒ 권고: phase3 시작 시 예상 시간/씬 수/모델별 라이센스 안내 모달.
2. **lyric_timestamps 불완전**: Suno API 가 모든 곡에 timestamps 를 항상 채우지 못한다. v17.0 에서 timestamps 가 비어 있으면 mv_jobs.lyric_timestamps_status="missing" 으로 기록 + 식전영상 탭에 안내. Whisper-based fallback 은 후속 (`replicate openai/whisper` 또는 `fal-ai/whisper`). ⇒ 권고: v17.0 직후 Whisper fallback 1회 시도 로직 추가 검토.
3. **MentionRef.type 확장의 데이터 마이그레이션**: 기존 stories doc 의 *_refs 는 `"sheet"|"place"` 만 있었음. 새 type `"wedding_photo"` 추가는 신규 doc 에만 영향(기존 doc invalid 안 됨). 그러나 프론트 MentionField 가 옵션 풀에서 wedding_photo 를 자동 노출하면 의도치 않게 wedding 사진이 스토리 본문 멘션에 섞일 수 있음. ⇒ 권고: v17.1 PreCeremonyMVPanel 안의 멘션 옵션 풀에만 wedding_photo 노출하고, StoryWizardPage 의 MentionField 풀에는 노출하지 않는다(v13 이전 동작 유지).
4. **자동 cascade vs 사용자 편집 보존**: PATCH /scenes/{n} 으로 description 편집 후 phase2 재시작하면 새 description 기반으로 image 재생성. 사용자 편집 흔적(`user_edited_fields`)은 scenes[] 단위로 가져가지만, scene_plan 재실행(POST /phase0) 시점에 scenes[] 전체 무효화될 수 있음. ⇒ 권고: phase0 재실행 시 사용자에게 명시 confirm 필수, 백엔드는 `scenes[]` 가 비어 있어야 200 — 차 있으면 422 + force=true 쿼리 필요.
5. **scenes 그리드 UI 의 카드 수 폭증**: 곡 2분/3분이면 가사 라인 수 ≈ 24~48 → 씬 ≈ 24~48 개. 그리드 + 썸네일 미리보기로 한 화면에 다 띄우면 무겁다. ⇒ 권고: 카드 가상 스크롤(react-window) 또는 페이지네이션 5x5. v17.2 구현 시 결정.

---

### v17 작업 끝(append).

---

## v18 — 2026-05-28 — 관리자 아이템 전체 가시화 + owner 뱃지

### 요구사항 요약
1. "아이템 관리" 페이지에서 **관리자는 모든 사용자의 outfit items 를 본다**(현재는 본인 것만).
2. 관리자는 본인 외 아이템도 **수정·삭제** 가능. 일반 사용자는 기존대로 본인 것만.
3. 관리자 카드/행에는 **owner(email 또는 nickname) 뱃지** 노출. 일반 사용자에게는 owner 정보 비노출.
4. 생성(POST) 로직은 그대로(생성자는 항상 본인 = `created_by`).
5. 회귀 금지: 일반 사용자의 본인-전용 동작은 그대로.

---

### Plan verification findings (v18)
0단계 분석에서 직접 확인한 사실:

**A. 백엔드 outfit 라우트** (`backend_8000/app/routes/character.py`)
- `list_my_outfits` (GET `/api/character/outfits/mine`) — `L1499~L1562`.
  - `L1516`: `query: dict = {"created_by": user_id}` — **항상 본인 `created_by` 로 필터**. role/admin 분기 없음.
  - 응답: `{"items": [_serialize_outfit_doc(doc), ...]}`.
- `update_outfit` (PUT `/api/character/outfits/{item_id}`) — `L1565~L1769`.
  - `L1616~L1621`: `if doc.get("created_by") != user_id: → 403 "본인 아이템만 수정할 수 있습니다."` — **owner-only, admin 우회 없음**.
- `delete_outfit` (DELETE `/api/character/outfits/{item_id}`) — `L1772~L1860`.
  - `L1813~L1818`: `if doc.get("created_by") != user_id: → 403 "본인 아이템만 삭제할 수 있습니다."` — **owner-only, admin 우회 없음**.
- `create_outfit` (POST) — `L1336~L1496`. `L1458`: `"created_by": user_id` 항상 본인. 변경 불필요.
- `_serialize_outfit_doc` — `L1318~L1333`. 현재 응답 키: `id / name / role / style / category / image_object_name / preview_url / product_url / created_at / created_by`. **`owner_email`, `owner_nickname` 키는 없음**. `created_by` 는 항상 노출되고 있음(일반 사용자에게도 자기 user_id 가 보임 — 본인 것이라 의미 없음).

**B. 데이터 영속화 구조**
- `outfit items` 는 **MongoDB** 컬렉션 `wedding_outfit_items` (코드 전반 `mongo.wedding_outfit_items` 호출).
- owner 식별 컬럼: **`created_by`** (문자열 user_id = Postgres `users.id` UUID 의 string 표현).
- users 는 PostgreSQL `users` 테이블 — `id, email, nickname, profile_image, role, created_at, updated_at` (확인: `routes/admin.py:118~143` `list_users`).

**C. 권한 시스템** (`backend_8000/app/auth.py`)
- `get_current_user` (`L16~L51`): JWT decode → Redis `session:{user_id}` 검증 → session dict 반환. session 에 `role` 키 없으면 `"user"` fallback (`L49~L50`).
- `get_current_admin` (`L54~L64`): role 이 `"admin"` 이 아니면 403.
- 따라서 outfit 라우트 안에서 `current_user.get("role") == "admin"` 으로 분기 가능 (admin 전용 의존성으로 갈아끼우는 게 아니라 같은 엔드포인트에서 분기).

**D. admin user-join 참고 패턴** (`routes/admin.py:47~115`)
- mongo doc 의 `user_id` 문자열 모음 → `uuid.UUID(str(uid))` 변환 → `SELECT id, email, nickname FROM users WHERE id = ANY($1::uuid[])` → user_map 구성 → 응답에 `user_email`, `user_nickname` 병합.
- v18 의 outfit join 도 **동일 패턴** 사용. 단 키 이름은 본 plan 의 `owner_email`, `owner_nickname` 으로 통일.

**E. 프론트엔드 아이템 관리 페이지**
- 파일: `frontend/src/pages/ItemManagePage.jsx` (총 647 라인).
- 라우트 등록: `frontend/src/App.jsx:69~76` — path `/items`, `<ProtectedRoute>` 안. **adminOnly 가 아님** — 일반 사용자도 접근.
- 호출: `L84~L104` `api.getMyOutfitItems()` (params 없음).
- 행 렌더링: `L595~L639` — 컬럼 (이미지/이름/신랑·신부/스타일/카테고리/등록일/작업). **owner 컬럼 없음**.
- 카드 카운트: `L552` `${filteredItems.length} / ${items.length}`.
- 빈 상태 메시지: `L570` "아직 등록한 아이템이 없습니다…" — 관리자에게는 "전체 아이템이 없습니다" 류로 분기 필요.
- role 확인: `useAuth()` 의 `user?.role === 'admin'` 패턴 사용 (Header.jsx:27, ProtectedRoute.jsx:15, PreCeremonyMVPanel.jsx:159 등에서 검증된 패턴).
- **현재 `useAuth` import 없음** — v18 에서 추가 필요.

**F. api/index.js** (`frontend/src/api/index.js`)
- `getMyOutfitItems = (params={}) => API.get('/character/outfits/mine', { params })` — `L108~L109`.
- admin 함수 패턴: `getAdminJobs = () => API.get('/admin/jobs')` — `L247`.
- v18 에서 신규 함수는 만들지 않음. 동일 `getMyOutfitItems` 가 백엔드에서 admin 분기 처리하므로 `params.scope='all'` 같은 옵션을 받아 admin 일 때 전달. (또는 backend 가 무조건 role 으로 분기 → 프론트 인자 변경 불필요. — **권고: backend role 으로만 분기. 프론트 인자 변경 없음**.)

**G. 로그 인프라**
- `character.py` 의 logger prefix 는 `[CharRoute]` 통일 (예: `L1511`, `L1559`). v18 의 새 코드도 **`[CharRoute]`** 유지.

#### 현재 동작과 요구사항의 갭
| 항목 | 현재 | v18 목표 |
|---|---|---|
| GET `/outfits/mine` 필터 | `created_by == user_id` 강제 | role==admin 이면 전체. user 면 그대로. |
| GET 응답 owner 정보 | `created_by` 만 (id 문자열) | admin 응답에 `owner_user_id / owner_email / owner_nickname` 추가. user 응답에는 owner 키 생략(또는 본인 정보만). |
| PUT `/outfits/{id}` 권한 | owner-only, admin 우회 없음 | role==admin 이면 우회. user 면 그대로. |
| DELETE `/outfits/{id}` 권한 | owner-only, admin 우회 없음 | role==admin 이면 우회. user 면 그대로. |
| 프론트 페이지 컬럼 | owner 컬럼 없음 | admin 일 때 "소유자" 컬럼 추가, 뱃지 렌더. |
| 프론트 페이지 카피 | "내 아이템 / 아직 등록한 아이템이 없습니다" | admin 일 때 "전체 아이템 / 등록된 아이템이 없습니다". |

#### 회귀 위험 지점
1. `_serialize_outfit_doc` 의 시그니처를 바꾸면 `create_outfit` / `update_outfit` 의 단일-아이템 응답 경로에도 영향. **단일 응답에도 owner 키를 admin 응답에만 노출**하려면 함수에 `user_map` 또는 `include_owner` 옵션을 추가. → 권고: 함수에 optional `owner_info: dict|None = None` 인자 추가, 채워졌으면 추가 키 노출.
2. `created_by` 키는 이미 일반 사용자 응답에도 있음(자기 user_id 라 무의미). 이번에는 **추가 키만 노출 / 제거하지 않음** — 호환성 유지.
3. `OutfitSelectPage` / 위저드의 `getWeddingOutfits` (`GET /character/outfits`) 는 별개 엔드포인트 → 영향 없음.
4. PUT/DELETE 라우트가 admin 우회를 허용하면 **반드시 로그에 `is_admin=True override=True` 추가** — 감사 추적.
5. `created_by` 가 비정상(non-UUID 문자열) 인 레거시 doc 이 있다면 `uuid.UUID(...)` 변환 실패. → `admin.py:74~79` 와 동일하게 `try/except ValueError` skip + warning.

---

### 변경 매트릭스

| # | 파일 | 변경 항목 | 로그 추적자 |
|---|---|---|---|
| B1 | `backend_8000/app/routes/character.py` `_serialize_outfit_doc` (L1318~L1333) | optional 인자 `owner_info: dict\|None = None` 추가. 채워졌으면 응답에 `owner_user_id`, `owner_email`, `owner_nickname` 추가. | — (pure helper) |
| B2 | `backend_8000/app/routes/character.py` `list_my_outfits` (L1499~L1562) | role==admin 이면 `query` 에서 `created_by` 필터 제거 + Postgres 에서 user join (admin.py 패턴 차용). 응답 직렬화 시 `_serialize_outfit_doc(doc, owner_info=user_map.get(str(doc.get("created_by"))))`. user 일 땐 기존 동작. 라우트 의존성은 `get_current_user` 그대로 (라우트 자체는 둘 다 접근). | `[CharRoute] /outfits/mine entry user_id=%s is_admin=%s role=%s style=%s category=%s`, `... ok ... is_admin=%s items=%d owner_resolved=%d` |
| B3 | `backend_8000/app/routes/character.py` `update_outfit` (L1565~L1769) | `L1616~L1621` 의 owner 가드를 `if doc.get("created_by") != user_id and current_user.get("role") != "admin":` 로 완화. admin 우회 시 별도 warning 로그. | `[CharRoute] /outfits PUT admin override user_id=%s item_id=%s owner=%s`, `... ownership reject ... is_admin=False` |
| B4 | `backend_8000/app/routes/character.py` `delete_outfit` (L1772~L1860) | `L1813~L1818` 동일 패턴으로 admin 우회. | `[CharRoute] /outfits DELETE admin override user_id=%s item_id=%s owner=%s` |
| B5 | `backend_8000/app/routes/character.py` `create_outfit` (L1336~L1496) — `L1496` `return _serialize_outfit_doc(new_doc)` | (선택) admin 이 본인 아이템 생성해도 owner 키를 무조건 채울지 결정. **권고: 생성 응답은 owner 키 생략 (호출자가 본인이라 무의미)**. | 변경 없음 |
| B6 | `backend_8000/app/routes/character.py` `update_outfit` 마지막 `return _serialize_outfit_doc(updated_doc or {})` (L1769) | admin 이 타인 아이템 수정 시 응답에도 owner 키 채우기. user 일 때는 안 채움. → `owner_info` 를 옵션 전달. | — |
| F1 | `frontend/src/pages/ItemManagePage.jsx` | `useAuth` import 추가 (`L1` 부근). `const { user } = useAuth(); const isAdmin = user?.role === 'admin';` 추가. | `console.info('[ItemManagePage] role check', { is_admin })` |
| F2 | 동 (L84~L104 초기 로드) | 변동 없음 (`api.getMyOutfitItems()` 그대로 호출). 단, 로그에 `is_admin` 추가. | `[ItemManagePage] getMyOutfitItems result count=%d is_admin=%s` |
| F3 | 동 (L548~L644 리스트 영역) | 헤더 카피 분기: admin 일 때 "전체 아이템" / 빈 메시지 "등록된 아이템이 없습니다." | — |
| F4 | 동 테이블 thead `L583~L592` | `isAdmin` 이면 컬럼 "소유자" 추가 (이름 컬럼 뒤). | — |
| F5 | 동 테이블 tbody `L595~L639` | `isAdmin` 이면 `<td>{it.owner_nickname || it.owner_email || '—'}</td>` 셀 추가 (owner 뱃지 스타일). | — |
| F6 | `frontend/src/pages/ItemManagePage.css` | `.item-manage__owner-badge` 스타일 추가 (작은 pill 형태). | — |
| F7 | `frontend/src/api/index.js` `getMyOutfitItems` (L106~L109) 주석 갱신 | "관리자는 전체, 일반 사용자는 본인 아이템" 으로 docstring 수정. 시그니처/인자 변경 없음. | — |

로그 prefix 통일: **backend `[CharRoute]`**, **frontend `[ItemManagePage]`**. 모든 새 로그에 `is_admin` 트레이서 포함.

---

### REST API 변경

#### GET `/api/character/outfits/mine`
- 인자: 동일 (`role`, `style`, `category` query). 추가 파라미터 없음.
- 응답 (200) — `items[]` 의 각 항목:
  - user 호출: 기존 동일 (`id, name, role, style, category, image_object_name, preview_url, product_url, created_at, created_by`).
  - **admin 호출**: 위 키 + **`owner_user_id`** (str, == created_by), **`owner_email`** (str|null), **`owner_nickname`** (str|null).
- 동작: admin 이면 전체 doc 조회, Postgres 에서 `created_by` 들을 batch join 하여 user_map 구성. user 면 기존 `created_by == user_id` 필터.

#### PUT `/api/character/outfits/{item_id}`
- 인자 동일. 401/400/404 동일.
- 403 가드 완화: `created_by != user_id AND role != "admin"` 일 때만 403. admin 우회 시 200 + 응답에 owner 키 추가 (admin 이 타인 것 수정).
- 응답: admin 이 타인 doc 수정 시 owner 키 추가. 그 외 동일.

#### DELETE `/api/character/outfits/{item_id}`
- 동일 패턴: 403 가드를 admin 우회 허용. 응답 본문은 기존 `{"message": "..."}` 그대로 (owner 정보 불필요).

#### POST `/api/character/outfits`
- 변경 없음. 응답에도 owner 키 추가하지 않음 (호출자가 본인이라 무의미).

---

### 테스트 항목 (tester 체크리스트)

**관리자 시나리오**
1. admin 로그인 → `/items` 접근 → 다른 사용자가 올린 아이템도 보임. 카운트가 전체 합과 일치.
2. admin 응답의 각 item 에 `owner_user_id / owner_email / owner_nickname` 키 존재. 본인 것/타인 것 모두.
3. 테이블에 "소유자" 컬럼 노출, 뱃지에 nickname (없으면 email) 표시.
4. admin 이 타인 아이템 수정 → 200, MinIO swap 동작, mongo doc 의 `created_by` 는 **변경 없이 원소유자 유지** (회귀 체크).
5. admin 이 타인 아이템 삭제 → 200, MinIO object 삭제, mongo doc 삭제.
6. 로그에 `is_admin=True admin override user_id=... owner=...` 라인 기록 확인.

**일반 사용자 회귀**
7. user 로그인 → `/items` → 본인 아이템만 보임 (다른 사용자 것 없음).
8. user 응답에 `owner_email / owner_nickname / owner_user_id` 키 **없음** (또는 null/undefined). 프론트에 "소유자" 컬럼 미노출.
9. user 가 타인 item_id 로 PUT/DELETE 시도 → 403 "본인 아이템만 수정/삭제할 수 있습니다." 유지.
10. user 본인 아이템 수정·삭제 → 기존과 동일하게 정상 동작.

**경계/실패**
11. `created_by` 가 UUID 형식이 아닌 레거시 doc 이 있어도 admin GET 500 아님. user_map 조인 실패는 warning + owner 키 null.
12. user_map 조회 자체 실패(Postgres down) 시 admin GET 은 owner 키 null 로 응답 (또는 500). 권고: 조회 실패 시 owner 키 null + warning 로그, 200 반환 (사용자 경험 우선).
13. admin 권한이 박탈된 직후(role 강등) 다음 요청에서 user 응답으로 즉시 회귀(`get_current_user` 가 Redis 의 최신 role 사용).

---

### 민감 정보 보호
- owner 정보(`owner_email`, `owner_nickname`, `owner_user_id`) 는 **관리자 응답에만** 포함. `current_user.get("role") == "admin"` 분기 통과 시에만 직렬화에 owner_info 주입.
- 일반 사용자 응답에는 `created_by` 만 그대로 (이미 자신의 user_id 라 추가 노출 없음).
- 프론트는 `isAdmin === true` 일 때만 owner 컬럼/뱃지 렌더 — 응답에 키가 없으면 자연스럽게 hide.
- 감사 로그: admin 이 타인 아이템 PUT/DELETE 한 모든 호출은 `[CharRoute] admin override` warning 으로 남긴다 (user_id=admin, owner=원소유자, item_id 포함).
- Postgres user join 시 `email`, `nickname` 만 SELECT — `password_hash` 등 민감 컬럼은 절대 join 대상에 포함하지 않음.

---

### backend-dev 작업 지시 요약
1. `routes/character.py` `_serialize_outfit_doc` 시그니처에 `owner_info: dict|None = None` 추가, 채워졌을 때 `owner_user_id/owner_email/owner_nickname` 키 머지.
2. `list_my_outfits` 에서 `current_user.get("role") == "admin"` 분기 — admin 이면 `created_by` 필터 제거 + `routes/admin.py:69~97` 패턴으로 user_map 조인 후 직렬화에 주입. `get_pg` 의존성 추가.
3. `update_outfit` / `delete_outfit` 의 owner 가드 조건을 `... and current_user.get("role") != "admin"` 로 완화. admin 우회 시 별도 warning 로그(`[CharRoute] /outfits PUT|DELETE admin override`).
4. `update_outfit` 의 최종 응답에서 admin 이 타인 아이템 수정 시에만 owner_info 채워 반환. 로그에 `is_admin` 트레이서 추가.
5. 모든 신규 로그 라인에 `is_admin=%s` 키 포함, prefix `[CharRoute]` 유지.

### frontend-dev 작업 지시 요약
1. `pages/ItemManagePage.jsx` 상단에 `useAuth` import, `const isAdmin = user?.role === 'admin'` 도출. `[ItemManagePage] role check is_admin=...` 로그.
2. 헤더 카피·빈 메시지·카운트 라벨을 `isAdmin` 분기 (admin "전체 아이템 / 등록된 아이템이 없습니다", user 기존 문구 유지).
3. 테이블 thead 에 `isAdmin` 이면 "소유자" 컬럼 추가, tbody 에 `it.owner_nickname || it.owner_email || '—'` 셀 렌더. 새 CSS 클래스 `item-manage__owner-badge` 추가 (pill 형태).
4. `api.getMyOutfitItems()` 호출 시그니처/인자 변경 없음 — 응답 키 차이만 처리. `data.items[i].owner_*` 키 사용.
5. `api/index.js:106~109` 의 docstring 만 갱신("관리자는 전체, 일반 사용자는 본인 아이템").

---

### 위험 / 갭 / 권고
1. **레거시 created_by 비-UUID**: 초창기 doc 이 `created_by` 를 다른 포맷으로 저장했다면 `uuid.UUID(str(uid))` 변환 실패. `admin.py:73~79` 와 동일하게 try/except 로 skip + warning. owner 키는 null 로 응답.
2. **Postgres join 실패 시 응답 정책**: user_map 조회가 통째로 실패해도 admin GET 은 500 대신 owner 키 null 로 200 반환을 권고 (목록은 보여야 사용자 경험 정상). 명시적으로 결정 필요.
3. **단일 PUT 응답의 owner 키 누락 가능성**: admin 이 타인 아이템 수정 후 응답에 owner_info 가 없으면 프론트가 행을 setState 머지할 때 owner 컬럼이 사라진다. → PUT 응답 직렬화 시 admin && 다른 owner 면 한 번 더 user_map[created_by] 조회 후 owner_info 주입. (B6 항목)
4. **admin 행위 감사 부족**: 현재 mongo doc 에는 누가 마지막으로 수정·삭제했는지 흔적이 없다. v18 에서 `updated_by_admin: user_id`, `updated_by_at: now` 필드를 추가하는 안도 가능. → 우선순위 낮음, 로그로 우선 커버하고 v19 후속에서 결정.
5. **/items 라우트 admin 가시성 변경의 UX**: 현재 모든 로그인 유저가 접근하는 화면이 admin 에게는 "전체 카탈로그 관리" 로 의미가 바뀐다. 메뉴/타이틀에 "(관리자 모드)" 같은 표식 권고. v18 에서 `<h1>` 옆에 admin 일 때 작은 뱃지 추가하는 안.

---

### v18 작업 끝(append).

---

## v19 검증 (2026-05-28)

단일 backend-dev/frontend-dev 에이전트가 처리한 v19 (Suno 듀얼 variant + variant 선택) 변경 사항이 명세대로 들어갔는지 planner 가 코드 직접 읽기로 재검증한 결과.

### 검증 결과 표

| # | 명세 | 코드 위치 | 결과 | 비고 |
|---|---|---|---|---|
| 1 | Suno 가 2 variant 생성 → `suno_audio_ids[]` 저장 + 단수 `suno_audio_id` 회귀 호환 | `backend_8000/app/services/suno_generator.py:225~245` | PASS | `audio_variants` 다운로드 후 `all_songs` 에서 truthy id 만 수집, list 길이 로그 남김. 단수 `suno_audio_id` = `(suno_data or {}).get("id","")` 로 1번 variant id 보존 |
| 2 | 음악 ready 후크에서 두 variant 다 `get_suno_timestamps` 호출 → `lyric_timestamps_variants` dict + 단수 `lyric_timestamps` 회귀 호환 | `backend_8000/app/routes/mv.py:312~365` (`_run_music_generation`) | PASS | `suno_audio_ids` 가 비어 있고 단수만 있을 때 list 로 승격하는 안전망 318~319 포함. variant 별 try/except 격리. variant 1 ts 가 있으면 단수 `lyric_timestamps` 도 같이 set, 없으면 빈 배열로 set (key 누락 방지). |
| 3 | mv_jobs 응답 페이로드에 `suno_audio_ids`, `lyric_timestamps_variants_count` 노출 | `backend_8000/app/routes/mv.py:39~75` (`_serialize_job`) | PASS | `suno_audio_ids` 그대로 노출. `lyric_timestamps_variants_count` 은 dict (`{"1": N, "2": M}`) 형태로 만들고 빈 dict 면 `{}` 노출 (프론트가 string key 로 접근 → 일치). |
| 4 | `POST /api/pre-mv/jobs` body 에 `variant: 1|2`, 422 (해당 variant timestamps 미준비) / 409 (다른 variant 잡 존재) | `backend_8000/app/routes/pre_mv.py:202~205, 296~324, 326~354` | PASS | Pydantic `Field(default=1, ge=1, le=2)` → wrong value 422. `selected_ts` 가 비었거나 ts_status≠ready → 422 한국어. 기존 잡 존재 + 다른 variant → 409 한국어. |
| 5 | `pre_mv_jobs` 도큐먼트에 `audio_variant: int` 저장 | `backend_8000/app/routes/pre_mv.py:394` (`new_doc`) + `:174` (`_serialize_pre_mv_job`) | PASS | insert 시 `audio_variant: audio_variant` 저장, serialize 시 `int(doc.get("audio_variant") or 1)` 로 legacy doc 도 1 로 폴백. |
| 6 | Phase 0/1 timestamps 는 선택된 variant 사용, 비어 있으면 단수 fallback | `backend_8000/app/routes/pre_mv.py:298~308, 393`; `pre_mv_phase0_mapper.py:449~500` (`generate_scene_plan`); `pre_mv_phase1_splitter.py:356~371` | PASS | create 시점에 `selected_ts` 가 `pre_mv_jobs.lyric_timestamps` 로 저장됨 → Phase 0 의 `generate_scene_plan(lyric_timestamps=doc.get("lyric_timestamps") or [])` 와 정합. Phase 1 은 `scene_plan` 만 입력으로 받음 — timestamps 직접 의존 없음 (Phase 0 출력에 time 정보 포함되어 흐름 안전). |
| 7 | Phase 4 audio merge 는 `mv_job.audio_variants[audio_variant - 1]` 사용 | `backend_8000/app/routes/pre_mv.py:2582~2615` (`_run_phase4`) | PASS | `audio_variant = int(doc.get("audio_variant") or 1)`, mv_jobs 다시 lookup → `variants_local[audio_variant - 1]` 우선, 없으면 `pre_mv_jobs.audio_object_name` → mv_jobs.audio_object_name fallback. compositor 는 단일 `audio_object_name` 인자만 받음 — 변경 없음. |
| 8 | 기존 3개 잡 backfill 스크립트 존재 + 두 variant ts 채움 | `backend_8000/scripts/backfill_lyric_timestamps_v19.py` | PASS | record-info → sunoData[] → variant 별 `get_suno_timestamps` 호출. `suno_audio_ids`, `lyric_timestamps_variants`, `lyric_timestamps_status`, `lyric_timestamps` (variant 1) 갱신. 멱등 — 두 번 돌려도 OK. (실제 backfill 수행 여부는 backend-dev 보고 기준; 본 검증은 스크립트 코드 존재/정합성만 확인) |
| 9 | 프론트 PreCeremonyMVPanel — 잡 없을 때 라디오 (둘 다 ready) / 단일 안내 (한 쪽만 ready) / 차단 (둘 다 missing), 잡 있을 때 헤더 트랙 N번 뱃지 | `frontend/src/components/PreCeremonyMVPanel.jsx:197~242, 854~933, 942~946` | PASS | `bothVariantsReady` 라디오, `onlyOneVariantReady` hint + auto-pick, 둘 다 missing 면 `timestampsReady=false` 분기로 859~865 의 안내 노출. 잡 있을 때 `pre-mv__variant-badge` 로 트랙 N번 뱃지. |
| 10 | `api/index.js createPreMVJob(mvJobId, opts={})` 시그니처 (`opts.variant`) | `frontend/src/api/index.js:270~274` | PASS | 시그니처: `(mvJobId, opts = {})` — 기존 단일 인자 호출자도 `opts={}` 디폴트로 안전, `variant: opts.variant || 1` 폴백 → 후방 호환 보장. |
| 11 | CSS — `pre-mv__variant-pick` / `pre-mv__variant-badge` 스타일 | `frontend/src/components/PreCeremonyMVPanel.css:99~157` | PASS | 라디오 카드 (`.radio-card`), 트랙 카운트 small, hint 안내문, pill 형태 badge 모두 스타일 추가. |

**요약: 11/11 PASS, 0 FAIL.**

### 발견된 결함 / 잠재 회귀

코드 직접 검증 기반으로 명백한 회귀 결함은 없음. 다음은 운영 시 주의해야 할 미세 갭(전체 PASS 유지) 메모.

1. **mv.py:357~364 — variant 2 만 있고 variant 1 이 빈 경우 `lyric_timestamps` 가 빈 배열로 강제 set 됨.**
   - 코드: `if ts_by_variant.get("1"): ... else: update_doc["lyric_timestamps"] = []`
   - 영향: variant 1 timestamps fetch 가 실패하고 variant 2 만 성공한 잡에서 단수 `lyric_timestamps` 가 `[]` 가 되어, 단수 fallback 으로만 변환되는 v19 이전 코드(없음) 가 보이지 않음. 현재 코드 경로에는 영향 없음 — variant 2 만 ready 면 pre_mv 라우트가 `ts_variants.get("2")` 로 직접 가져와 정상.
   - 단, **회귀 위험** : 만약 variant 1 ts fetch 가 일시적으로 실패해 reseat 후크가 다시 돌면(현재는 안 돎) `lyric_timestamps` 가 빈 배열로 덮어써질 수 있음. 현 흐름에선 `_run_music_generation` 이 1회만 호출되므로 문제 없음.
   - **권고**: 그대로 두되, 코드 주석에 "variant 1 ts 없으면 단수 `lyric_timestamps` 도 빈 배열 → variant 1 fallback path 가 비활성" 명시 (낮은 우선순위).

2. **pre_mv.py:330~354 — 멱등성: 같은 mv_job + 같은 variant 재호출은 200 (PASS), 다른 variant → 409 (PASS).**
   - 확인: `existing_variant = int(existing.get("audio_variant") or 1)`. legacy 잡(audio_variant 필드 없음) 은 1 로 간주. variant=1 재호출은 멱등 / variant=2 호출은 409 — 명세대로.
   - 회귀 위험 없음.

3. **pre_mv.py:2587~2604 — Phase 4 의 audio_variant 결정 시 mv_jobs lookup 실패해도 그대로 진행.**
   - `mv_doc_local` lookup 이 exception 나면 `audio_object_name` 은 `pre_mv_jobs.audio_object_name` 으로 유지 (이미 create 시점에 variant 별 audio 가 저장돼 있음) → 안전.
   - 회귀 위험 없음.

4. **legacy pre_mv_jobs (v19 이전 생성된 도큐) 의 audio_variant 부재.**
   - `_serialize_pre_mv_job`: `int(doc.get("audio_variant") or 1)` → 1 로 폴백 (PASS).
   - `_run_phase4`: `int(doc.get("audio_variant") or 1)` → 1 로 폴백 (PASS).
   - 멱등 hit 분기: `int(existing.get("audio_variant") or 1)` → 1 로 폴백 (PASS).
   - 모든 분기 안전.

5. **프론트 응답 키 일치성 — `lyric_timestamps_variants_count` (snake_case)** 가 백엔드 응답 키와 프론트 접근키(`mvJob?.lyric_timestamps_variants_count`) 가 정확히 일치 (PASS).
   - 백엔드: `mv.py:67` `"lyric_timestamps_variants_count": variants_count` (dict, string key).
   - 프론트: `PreCeremonyMVPanel.jsx:216~222` `variantsCount?.['1']` / `variantsCount?.['2']` — 일치.

6. **`createPreMVJob` 후방 호환** — `(mvJobId)` 단일 인자 호출에도 `opts={}` 디폴트로 깨지지 않음, `variant: 1` 폴백 (PASS).

### 결론 / 다음 단계

- 명세 11개 항목 전수 PASS. **backend-dev 추가 수정 불필요.**
- 다음 단계: **tester 진입 가능.** 백필 스크립트 실제 실행 결과 (3개 잡 두 variant ts 채워졌는지) 만 tester 가 mongo 직접 확인. 실패 시 backend-dev 재호출.

---

## v19 검증 — 테스트 계획

tester 가 위 코드 검증 결과를 바탕으로 실측해야 할 시나리오. 모두 인증 토큰 필요 (테스트 대상 user_id 의 토큰을 미리 준비).

### A. 인증/가드
1. **401 가드**: `POST /api/pre-mv/jobs` 토큰 없이 호출 → 401.
2. **403 가드**: 다른 user 의 mv_job_id 로 호출 (non-admin) → 403 한국어 `"접근 권한이 없습니다."`.
3. **admin 우회**: admin 토큰으로 다른 user 의 mv_job_id 로 호출 → 200 (멱등 hit 가능).

### B. variant body validation
4. **422 wrong value**: `body.variant = 3` 또는 `0` → Pydantic 422 (FastAPI 기본 detail 포맷).
5. **422 wrong type**: `body.variant = "foo"` → 422.
6. **422 missing timestamps**: variant=2 인데 `mv_jobs.lyric_timestamps_variants["2"]` 없음 → 422 한국어 `"선택한 트랙(2번) 의 가사 타임스탬프가 준비되지 않았어요."`.

### C. 멱등성 / 409
7. **멱등 200**: 같은 mv_job + 같은 variant 재호출 → 200, 동일 `pre_mv_job_id` 반환, mongo 새 도큐 안 생김.
8. **409 다른 variant**: 같은 mv_job 으로 variant=1 잡 만든 뒤 variant=2 호출 → 409 한국어 `"이미 다른 트랙(1번) 으로 식전영상이 만들어지고 있어요."`.

### D. Mongo 직접 검증
9. **mv_jobs 3개 잡 (백필 대상)**: `db.mv_jobs.find({"status":"music_ready"})` 결과 도큐에 다음 키가 모두 있는지:
   - `suno_audio_ids: [id1, id2]` (길이 2)
   - `lyric_timestamps_variants: {"1": [...], "2": [...]}` (각 길이 > 0)
   - `lyric_timestamps_status: "ready"`
   - `lyric_timestamps`: variant 1 과 동일 (회귀 호환)
   - 백필 실행 전이라면 backend-dev 가 `python backend_8000/scripts/backfill_lyric_timestamps_v19.py` 실행 후 재확인.
10. **새 pre_mv_jobs.audio_variant**: 신규 생성한 pre_mv_job 도큐에 `audio_variant: 1` 또는 `2` 가 저장됐는지.

### E. Phase 0 live (LLM 호출 가능 한정)
11. **variant 1 Phase 0**: variant=1 으로 만든 pre_mv_job 에서 `POST /jobs/{id}/phase0` (force=false). 완료 후 `scene_plan[].lyric_line` 의 텍스트들이 `mv_jobs.lyric_timestamps_variants["1"]` 의 text 와 정확히 일치 (정렬도).
12. **variant 2 Phase 0**: variant=2 잡에서 같은 검증 — `lyric_timestamps_variants["2"]` 와 매칭.

### F. Phase 4 live (오디오 머지)
13. **variant 1 Phase 4**: variant=1 잡의 Phase 4 결과 영상의 오디오 길이가 `mv_jobs.audio_variants[0]` (track_1.mp3) 길이와 일치.
14. **variant 2 Phase 4**: variant=2 잡의 결과 영상 오디오 = `mv_jobs.audio_variants[1]` (track_2.mp3).

### G. 프론트 정적/빌드 점검
15. **빌드**: `cd frontend && npm run build` 무에러.
16. **라디오 노출**: 음악 ready + 두 variant 다 ready 인 잡에서 panel 진입 → `pre-mv__variant-pick` div + 라디오 2개 + 라인 수 표시 노출.
17. **단일 안내**: variant 1 만 ready 인 잡 → `pre-mv__variant-hint` 한 줄 안내 + auto-pick.
18. **헤더 뱃지**: 잡 있을 때 `🎵 트랙 N번` 뱃지 노출, hover title 표시.
19. **둘 다 missing**: variant 둘 다 timestamp 없음 → 859~865 의 차단 안내문 (createPreMVJob CTA 비노출).

### H. 회귀 검증 (기존 흐름)
20. **음악 생성**: `POST /api/mv/jobs/{id}/music` → 200, 폴링 후 `status=music_ready`, `audio_variants` length 1~2.
21. **웨딩사진/관리자/아이템 관리/캐릭터/장소 다운로드**: 기존 라우트 200 — v18 회귀 없음 확인. 특히 `/api/character/items/`, admin 페이지 owner_info 노출 유지.

### I. 로그 관찰
22. `[MVRoute] action=fetch_timestamps entry/ok/failed` (`mv.py:326~344`) — 잡 1개당 변경 후 변환 1회.
23. `[PreMVRoute] action=create reject timestamps ... audio_variant=2 variants_present=['1']` (variant 미준비 시 워닝).
24. `[PreMVRoute] phase=phase4 audio_resolve pre_mv_job_id=... audio_variant=2 audio_object_name=mv_jobs/.../track_2.mp3` (Phase 4 진입 시 audio 선택 트레이서).

### 우선순위
- D9 / D10 (mongo) → 가장 빠르게 검증 가능, fail 시 backend-dev 즉시 호출.
- B4~B6 (validation) → 5분 내 curl 수동 검증.
- C7~C8 (멱등/409) → 핵심 보호. fail 시 명세 재검토.
- E11~E12 (Phase 0 LLM) → 비용 들지만 의미적 정합성 확인의 마지막 관문.
- F13~F14 (Phase 4) → 가능하면 한 variant 만 실행해도 충분.

---

### v19 작업 끝(append).

