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

---

## v21 — 2026-05-28 — 시나리오 기반 식전영상 파이프라인 재설계

### 1. 요구사항 요약
- Phase 0 을 **가사 라인 매핑** 에서 **스토리 → 한 편의 단편 시나리오(5~10p 한국어 서술체) 풀어쓰기** 로 재설계.
- Phase 1 을 **가사 라인 1:1 분할** 에서 **음악 섹션(`[Verse]`/`[Chorus]` 등) 기반 N=18~22 씬 분할** 로 재설계 (씬 입력은 `scenario_text` + `scenario_events[]` + 음악 섹션 경계).
- Phase 2/3/4 는 입력 `scenes[]` 형식이 동일하므로 **코드 변경 없음**. 가사·timestamp 라인별 timing 의존 제거 (섹션 경계만 사용).
- 회귀 안전: variant 선택(v19), 일괄 삭제(v20), admin 분기, force confirm UI 모두 그대로 유지.
- LLM 모델 선택은 기존과 동일 (`claude_4_7_opus` 기본 / `gpt_latest`).

### 2. Plan verification findings (0단계 코드 검증 결과)

**A. backend services**
- `backend_8000/app/services/pre_mv_phase0_mapper.py` (533줄) — 가사 라인 ⇄ story_slot 매퍼. `generate_scene_plan(*, pre_mv_job_id, story_snapshot, lyrics_snapshot, lyric_timestamps, scenario_model) -> list[dict]` (L449~532). 라인 수 강제 정렬 (`_validate_and_align` L395~442). **v21 에선 가사 라인 정렬 폐기 — replace 대상.**
- `backend_8000/app/services/pre_mv_phase1_splitter.py` (471줄) — `split_into_scenes(*, pre_mv_job_id, scene_plan, music_spec) -> list[dict]` (L356~470). 라인 1:1 매핑 (`scene_number = i+1`, L434), `_compute_use_seconds` 로 lyric_end-lyric_start 기반 길이 산정 (L78~84). **v21 에선 음악 섹션 기반 분할로 rewrite.**
- `backend_8000/app/services/pre_mv_phase2_image_generator.py` (471줄) — scenes[i] 입력 필드 (L260~264): `image_prompt`, `image_prompt_ko`, `ref_sheet_ids`, `ref_place_ids`, `story_slot`. **v21 신규 scenes[] 와 100% 호환 — 변경 없음.**
- `backend_8000/app/services/pre_mv_video_prompts.py` (527줄) — `compose_video_prompt(scene, video_model)` 사용 필드 (L362~364): `image_prompt`, `description`, `video_prompt`, `use_seconds`, `ref_sheet_ids`. **호환 — 변경 없음.**
- `backend_8000/app/services/pre_mv_phase4_compositor.py` (369줄) — `compose_pre_mv_result(*, pre_mv_job_id, scenes, audio_object_name)` (L216~). scenes 에서 `video_object_name` 만 사용. 오디오는 `mv_jobs.audio_variants[variant-1]` 에서 가져온 mp3 전체 길이를 `-shortest` 옵션으로 머지 (L170~206). **씬 timing 의존 없음 — 호환 OK, 변경 없음.**
- `backend_8000/app/services/suno_timestamp_service.py` (183줄) — Suno API 가 반환하는 단어를 라인으로 묶음 (`_words_to_segments` L116~182). 라인 텍스트에 `[Intro]` `[Verse 1]` `[Chorus]` `[Pre-Chorus]` `[Bridge]` `[Outro]` 같은 섹션 마커가 한 라인으로 그대로 들어옴 (Suno 가 본문 그대로 단어화). **v21 Phase 1 의 섹션 경계 추출 소스.**

**B. backend route**
- `backend_8000/app/routes/pre_mv.py` (2814줄).
  - `_serialize_pre_mv_job` (L159~195) — light/full 시리얼라이저. **v21 에 `scenario_text`/`scenario_events`/`section_markers` 추가 필요.**
  - `_run_phase0` (L504~577) — `generate_scene_plan(...)` 호출 + `scene_plan` 저장 + `status=phase0_ready`. **v21 — `generate_scenario(...)` 호출로 교체, 저장 키 `scenario_text`/`scenario_events`.**
  - `start_phase0` (L584~683) — body 그대로 (`scenario_model`, `force`). force 시 `scenes` 초기화 (L657~659). **v21 — force 시 `scenario_text`/`scenario_events`/`section_markers` 까지 초기화.**
  - `_run_phase1` (L690~769) — `split_into_scenes(scene_plan, music_spec)` 호출. **v21 — `split_into_scenes_v21(scenario_text, scenario_events, lyric_timestamps, music_spec)` 로 시그니처 변경.**
  - `start_phase1` (L772~841) — `pre_doc.get("scene_plan")` 비어있으면 422 (L802~806). **v21 — `pre_doc.get("scenario_text")` 검사로 교체.**
  - `create_pre_mv_job` (L258~426) — `new_doc` 생성 시 `scene_plan: []` 박혀있음 (L396). **v21 — `scenario_text: None`, `scenario_events: []`, `section_markers: []` 추가, `scene_plan` 은 deprecated 로 유지(빈 배열).**

**C. frontend**
- `frontend/src/components/PreCeremonyMVPanel.jsx` (2367줄).
  - `PreMVScenarioStep` (L1007~1144) — Step 1. `scenePlan` (가사 라인 매핑 목록) 을 `pre-mv-plan__line` 리스트로 렌더 (L1115~1140) — slot 라벨 / lyric_line / story_excerpt / refs. **v21 — `scenario_text` 본문 + `scenario_events[]` 시점별 요약을 보여주는 새 렌더로 교체. force confirm 메시지 L1043~1044 유지.**
  - `PreMVScenesStep` (L1150~) — Step 2. `scenes[]` 카드. **v21 와 호환 — 변경 없음 (백엔드 scenes[] 형식 동일).**
  - Step 진입 게이트 — `phase0Done = ['phase0_ready', ...].includes(status)` 패턴 유지.
  - `loadJob` (L271~) 의 디버그 로그 `scene_plan_count` 는 호환을 위해 유지하되 `scenario_text_len`/`scenario_events_count` 추가.
- `frontend/src/api/index.js` (L259~349) — Pre-MV API 함수들. **시그니처 변경 없음 — runPreMVPhase0/1 그대로.** 응답 payload 에 신규 키가 추가되는 것뿐이라 API 시그니처는 stable.

**D. 영향 범위 요약**
- 핵심 rewrite: 2 파일 (`pre_mv_phase0_mapper.py`, `pre_mv_phase1_splitter.py`).
- 라우트 수정: 1 파일 (`pre_mv.py`) — `_run_phase0` / `_run_phase1` 본문, `_serialize_pre_mv_job` 필드, `create_pre_mv_job` 초기 필드, `start_phase0/1` 가드 메시지.
- 프론트 수정: 1 파일 (`PreCeremonyMVPanel.jsx`) — `PreMVScenarioStep` 렌더 부분만.
- API 시그니처: 변경 없음. payload 만 키 추가.
- Phase 2/3/4 코드: 손 안 댐.

### 3. 데이터 모델 변경 (`pre_mv_jobs` 도큐)

**신규 필드 (Phase 0 결과물)**:
- `scenario_text: str | null` — 한국어 서술체 본문 (5~10 페이지 분량, 대략 3000~8000자). `@멘션` 토큰 보존.
- `scenario_events: list[dict]` — 시점별 키 사건 요약. 각 항목 shape:
  ```
  {
    "story_slot": "meeting"|"first_date"|"memory"|"proposal"|"wedding_prep"|"rituals",
    "memory_index": int | null,     # story_slot=="memory" 일 때 0-based 인덱스
    "summary": str,                 # 한 문장 ≤120자, 시각화 가능한 사건/장면
    "refs": [MentionRef],           # @멘션 dump (sheet|place|wedding_photo)
  }
  ```
- `section_markers: list[dict]` — Phase 1 의 음악 섹션 경계 (Phase 1 시작 시 lyric_timestamps_variants[selected] 의 본문에서 추출되어 저장). 각 항목 shape:
  ```
  {"label": "Verse 1"|"Chorus"|..., "start": float, "end": float}
  ```
  - lyric_timestamps 의 text 가 `^\[\s*[^\]]+\s*\]$` 패턴 (대괄호 단독 라인) 인 segment 를 마커로 인식.
  - Suno 가 본문 그대로 단어화하므로 `[ Intro]`, `[ Verse 1]`, `[ Chorus 1]`, `[ Outro]` 처럼 공백/번호 변형이 있을 수 있음 → 정규식 `re.match(r"^\[\s*([A-Za-z][A-Za-z0-9 \-]+?)\s*\]\s*$", text)` 로 추출.
  - 다음 마커의 start 가 직전 마커의 end → start 가 됨. 마지막 마커는 lyric_timestamps 의 마지막 end (또는 음악 길이) 까지.
  - fallback: 마커가 하나도 없으면 lyric_timestamps 전체 길이를 균등 분할 (4 구간) 후 라벨 "Section 1..4" 부여.
- `scenario_model: str | null` — 기존 필드 그대로 사용. Phase 0 마지막 실행 모델 저장.

**기존 필드**:
- `scene_plan: list[dict]` — **deprecated 마크**. v21 새 Phase 0/1 에서는 사용하지 않음. 기존 v17~v20 잡 호환을 위해 도큐 스키마에선 유지 (빈 배열로 신규 잡 생성). Phase 0 재실행 (force=true) 시 빈 배열로 클리어.
- `scenes: list[dict]` — v21 신규 Phase 1 가 동일한 shape 으로 채움 (`scene_number, description, description_ko, image_prompt, image_prompt_ko, video_prompt, video_prompt_ko, section, section_start, section_end, use_seconds, story_slot, event_index, ref_sheet_ids, ref_place_ids, image_*, video_*, user_edited_fields`). Phase 2/3/4 와의 인터페이스 유지.

### 4. 변경 매트릭스 (파일별)

| 파일 | 변경 종류 | 항목 | 로깅 prefix |
|------|-----------|------|-------------|
| `backend_8000/app/services/pre_mv_phase0_mapper.py` | REPLACE (rewrite) | `generate_scenario(*, pre_mv_job_id, story_snapshot, scenario_model) -> {"scenario_text": str, "scenario_events": list[dict]}` 로 시그니처 변경. 가사·timestamps 인자 제거. PHASE0_SYSTEM_PROMPT 를 "단편 풀어쓰기" 로 재작성. JSON 응답: `{"scenario_text": "...", "scenario_events": [{"story_slot","memory_index","summary","refs"}, ...]}`. `_validate_scenario` 로 길이/슬롯/시간역행 검증. 1회 retry. | `[PreMVScenario]` + `pre_mv_job_id`, `model`, `phase=phase0`, `provider`, `text_len`, `events_count`, `elapsed_ms` |
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | REWRITE (큰 rewrite) | `split_into_scenes_v21(*, pre_mv_job_id, scenario_text, scenario_events, lyric_timestamps, music_spec) -> list[dict]` 신규 함수. 내부 헬퍼: `_extract_section_markers(lyric_timestamps) -> list[dict]`, `_decide_scene_count_per_section(section, target_total=20) -> int`, LLM call (`Claude/OpenAI`) 로 events → sections 매핑 + 섹션별 N개 씬 분할. 출력은 9004 호환 scenes[]. 연속 컷 prepend 룰 유지. fallback: LLM 실패 시 events 를 시간순으로 섹션에 분배. | `[PreMVSplit]` + `pre_mv_job_id`, `phase=phase1`, `model`, `scene_count`, `section_count`, `events_count`, `elapsed_ms` |
| `backend_8000/app/routes/pre_mv.py` | EDIT | 1) `_serialize_pre_mv_job` 에 `scenario_text`, `scenario_events`, `section_markers` 추가 (light 에선 길이만). 2) `_run_phase0` 본문 — `generate_scenario(...)` 호출, `scenario_text`/`scenario_events` 저장. 3) `_run_phase1` 본문 — `_extract_section_markers` 호출 후 `section_markers` 저장 + `split_into_scenes_v21(scenario_text, scenario_events, lyric_timestamps, music_spec)` 호출. 4) `start_phase0` — force=true 시 `scenario_text/events/section_markers/scenes/scene_plan` 모두 초기화. 5) `start_phase1` — `scene_plan` 검사를 `scenario_text` 검사로 교체 (`if not pre_doc.get("scenario_text"): 422`). 6) `create_pre_mv_job` 의 `new_doc` 에 신규 필드 기본값 추가. | `[PreMVRoute]` 그대로 + `phase=phase0/phase1` 토큰 + `pre_mv_job_id` |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | EDIT | `PreMVScenarioStep` 렌더 영역 (L1115~1140) 교체: `scenario_text` 본문을 줄바꿈 보존으로 큰 `<div className="pre-mv-scenario__body">` 안에 표시 + `scenario_events[]` 를 시점별 카드 (`pre-mv-scenario__event`) 리스트로 표시 (slot 라벨, summary, refs chips). 폴링 트레이스에 `scenario_text_len`/`scenario_events_count` 추가. force confirm 메시지 ("기존 씬이 모두 사라져요...") 는 그대로 사용. | `[PreMVScenarioStep]` 그대로 |
| `frontend/src/api/index.js` | NONE | 시그니처 변경 없음. payload 키만 추가됨. | — |

### 5. REST API 변경

**시그니처 변경**: 없음.

**응답 페이로드 변경** (`GET /api/pre-mv/jobs/{id}` 및 `GET /jobs/{id}/status`):
- 추가 (full): `scenario_text` (str|null), `scenario_events` (list[dict]), `section_markers` (list[dict]).
- 추가 (light): `scenario_text_len` (int), `scenario_events_count` (int), `section_markers_count` (int).
- 유지 (deprecated): `scene_plan` (list[dict], 신규 잡에서는 항상 `[]`).
- 유지: `scenes`, `status`, `progress`, `audio_variant`, `phase0_error`~`phase4_error`, etc.

**Body 시그니처**:
- `POST /jobs/{id}/phase0` — `{scenario_model, force}` 그대로.
- `POST /jobs/{id}/phase1` — `{force}` 그대로.

### 6. 회귀 위험 점검

1. **variant 선택 (v19)** — 영향 없음. Phase 1 는 `mv_jobs.lyric_timestamps_variants[selected]` 를 `lyric_timestamps` 키로 그대로 받아 섹션 마커 추출에 사용. Phase 4 의 `audio_variants[variant-1]` 선택은 그대로 유지.
2. **일괄 삭제 (v20)** — 영향 없음. `pre_mv_jobs` 도큐 자체를 지우므로 신규 필드 유무 무관.
3. **admin 분기** — 영향 없음. `_resolve_pre_mv_job` 의 owner/admin 가드 변경 없음.
4. **force confirm UI** — `PreMVScenarioStep` 의 "기존 씬이 모두 사라져요" 메시지 (L1043~1044) 유지. Phase 1 의 "기존 씬 분할을 다시 만들어요..." (L1188~1189) 유지.
5. **기존 잡 (`scene_plan` 만 있는 v17~v20 잡)** — 백필 안 함. UI 가 `scenario_text` 가 비어있으면 "다시 매핑" 버튼 노출 (force=true) → 새 시나리오 모드 진입. 기존 도큐 손상 없음.
6. **음악 섹션 인식 fallback** — Suno 가사 본문에 마커 없거나 정규식 매칭 0건이면 lyric_timestamps 전체 시간을 4 구간 균등 분할 + 라벨 "Section 1..4" 부여. Phase 1 fail 하지 않음.
7. **Phase 2/3/4** — 입력 scenes[] 형식 동일. 손 안 댐. ffmpeg merge 는 `-shortest` 라 오디오/영상 길이 어떤 조합이든 안전.
8. **scenario_text 길이 폭주 위험** — Claude Opus 4.7 `max_tokens` 16k 안에서 5~10p 한국어는 충분 (한국어 1p ≈ 1500자 ≈ 1000 토큰, 10p ≈ 10000 토큰). GPT-5.x 도 동일. 안전 마진 확보.
9. **scenes[] 수 폭주 위험** — Phase 1 LLM 응답 `scene_count` 검증 (clamp 8 ≤ N ≤ 30). 초과 시 truncate, 미만 시 fallback 균등 분할 추가.

### 7. 테스트 항목

**A. Phase 0 라이브**
1. **Claude 4.7 Opus 시나리오 생성**: 6시점 다 채워진 스토리(@멘션 포함) 로 `POST /jobs/{id}/phase0` (`scenario_model=claude_4_7_opus`). 완료 후 `scenario_text` 가 3000~8000자 한국어 서술체. `@groom_casual`, `@bride_casual`, `@장소이름` 같은 토큰이 본문에 그대로 남아있는지.
2. **GPT 시나리오 생성**: 같은 입력으로 `scenario_model=gpt_latest`. 동일 검증.
3. **scenario_events 순서 검증**: events[].story_slot 이 meeting → first_date → memory → proposal → wedding_prep → rituals 시간순. 역행 시 LLM 재호출 후에도 역행이면 검증 fail (이번 버전은 PASS 기준 elastic — events 순서가 시간순이면 OK, 약간의 memory_index 흐트러짐은 허용).
4. **scenario_events 의 refs**: events[].refs 의 type/asset_id/display_name 이 입력 story_snapshot 의 *_refs 풀 안에 있는 것만 사용했는지 (새로 만든 ref 없어야 함).
5. **force 재실행**: `force=true` 로 두 번째 실행 → `scenario_text` 가 바뀜, `scenes` 가 비어있음, `scene_plan` 도 빈 배열.

**B. Phase 1 라이브**
6. **음악 섹션 추출**: `lyric_timestamps` 본문에 `[Verse 1]`, `[Chorus]` 등 마커 라인이 있는 잡에서 `POST /jobs/{id}/phase1`. 완료 후 `section_markers[]` length ≥ 3, label 들이 raw 그대로 (`Verse 1`, `Chorus`, `Bridge`, `Outro` 등), start/end 가 단조 증가.
7. **마커 없을 때 fallback**: 가사 본문에 마커가 없는 잡(예: lyrics body 가 [tag] 없이 평문) → `section_markers` length=4, labels `Section 1..4`, end-start 가 균등.
8. **씬 수 적정**: `scenes[]` length 가 18 ~ 22 (clamp 안에서 8~30). 음악 3분 기준.
9. **씬 use_seconds 적정**: 각 씬 `use_seconds` ∈ [3, 12]. clamp 검증.
10. **연속 컷 prepend**: 인접 두 씬의 `story_slot` 이 같으면 두 번째 씬 `video_prompt` 가 `"Continuing seamlessly from the previous scene,"` 로 시작, `video_prompt_ko` 가 `"이전 씬에서 이어지는 연속 컷,"` 로 시작.
11. **scenes 의 section 필드**: 각 씬 `section` 라벨이 `section_markers[].label` 중 하나 (또는 fallback "Section 1..4"). `section_start`/`section_end` 가 해당 섹션 경계와 일치.
12. **ref_sheet_ids / ref_place_ids 분배**: scenario_events 의 refs 가 sheet vs place/wedding_photo 로 정확히 분리되어 scenes 에 할당.

**C. Phase 2~4 호환**
13. **Phase 2 image gen**: v21 scenes[] 한 씬에 대해 `POST /jobs/{id}/phase2` (`image_model=gpt_image_2`). 한 씬이라도 image_status=completed → MinIO `photos` 버킷에 PNG 업로드 확인. (코드 변경 없음 — sanity check.)
14. **Phase 3 video gen**: 한 씬 `POST /scenes/{n}/regenerate-video` (Veo). video_status=completed.
15. **Phase 4 머지**: 모든 씬 video 완료 후 `POST /jobs/{id}/phase4`. `status=completed`, `result_video_object_name` 존재.

**D. 회귀**
16. **기존 v17~v20 pre_mv_jobs 도큐**: `db.pre_mv_jobs.find({"scene_plan": {"$ne": []}, "scenario_text": null})` 조회 시 도큐가 깨지지 않고 정상 직렬화 (응답 `scenario_text=null`, `scenes=[기존값]`).
17. **variant 선택**: variant=2 로 만든 신규 pre_mv_job 에서 Phase 1 가 `mv_jobs.lyric_timestamps_variants["2"]` 의 본문에서 섹션 마커 추출하는지 (variant 1 마커가 아닌).
18. **일괄 삭제 (v20)**: pre_mv_jobs 전체 삭제 라우트가 v21 신규 잡도 동일하게 지우는지.
19. **프론트 빌드**: `cd frontend && npm run build` 무에러.

### 7-1. AI 모델 한계 점검

- **Claude 4.7 Opus**: `max_tokens` 16k 안에서 한국어 서술체 5~10p (8000~12000자) 가능. JSON 응답이므로 escape 비용 +20% 감안하여 max_tokens=14000 잡으면 안전.
- **GPT-5.x (gpt-5.4 가정)**: `max_completion_tokens` 16k 동일. `response_format={"type":"json_object"}` 지원.
- **JSON 응답 안정성**: 둘 다 system prompt 에 "오직 JSON 만 출력. 마크다운 코드펜스 금지" 강제 + `_strip_code_fence`/`_parse_response` 의 robust 파서 재사용. JSON 파싱 실패 시 1회 retry (강제 지시 추가).
- **Suno 가사 섹션 마커 패턴 다양성**: 실측 사례 — `[Intro]`, `[Verse 1]`, `[Pre-Chorus]`, `[Chorus]`, `[Chorus 1]`, `[Bridge]`, `[Outro]`. 공백 포함 변형 (`[ Intro ]`) 도 가능. 정규식 `^\s*\[\s*([A-Za-z][A-Za-z0-9 \-]+?)\s*\]\s*$` 로 모두 캡처. 한 라인이 마커 + 가사 혼합인 경우는 마커로 인식하지 않음 (안전).

### 8. 마이그레이션 정책

- **기존 pre_mv_jobs 도큐 (scene_plan 만 있고 scenario_text null)**: 그대로 둠. UI 가 `scenario_text` 가 비어있으면 Phase 0 "다시 매핑" 버튼을 force=true 로 노출 → 사용자가 클릭하면 v21 모드로 재실행되며 `scene_plan` 은 빈 배열로 클리어, `scenario_text`/`scenario_events`/`section_markers` 가 채워짐.
- **새 phase 0/1 코드는 분기 X — 일괄 적용**: 기존 함수 시그니처/이름 자체를 교체 (`generate_scene_plan` → `generate_scenario`, `split_into_scenes` → `split_into_scenes_v21`). 라우트의 `_run_phase0`/`_run_phase1` 가 새 함수만 호출.
- **백필 스크립트 없음**: v21 적용 후 기존 잡 자동 변환 안 함. 사용자가 Phase 0 재실행하면 자동 마이그레이션.
- **`scene_plan` 필드는 도큐 schema 에선 유지** (도큐가 깨지지 않도록). `_serialize_pre_mv_job` 도 deprecated 마크 후 응답에 유지 (프론트 호환).

### 9. 작업 분배

**backend-dev 지시 요약 (5줄 이내)**
1. `pre_mv_phase0_mapper.py` 를 REPLACE — `generate_scenario(*, pre_mv_job_id, story_snapshot, scenario_model) -> {scenario_text, scenario_events}`. PHASE0_SYSTEM_PROMPT 를 "한 편의 단편 시나리오 풀어쓰기" 로 재작성. 시간순/멘션 보존/스토리 외 사실 추가 금지 규칙. 1회 retry. 로그 `[PreMVScenario]`.
2. `pre_mv_phase1_splitter.py` 를 REWRITE — `split_into_scenes_v21(*, pre_mv_job_id, scenario_text, scenario_events, lyric_timestamps, music_spec) -> scenes[]`. 헬퍼 `_extract_section_markers(lyric_timestamps)` 와 LLM-based 섹션→씬 분할. fallback 균등 분할 보장. 9004 호환 scenes[] 출력. 연속컷 prepend, ref 분배, scene_count clamp 8~30. 로그 `[PreMVSplit]`.
3. `pre_mv.py` 의 `_serialize_pre_mv_job` / `_run_phase0` / `_run_phase1` / `start_phase0` / `start_phase1` / `create_pre_mv_job` 6 곳 편집 — 신규 필드 (`scenario_text`, `scenario_events`, `section_markers`) 추가, force 시 cascade 클리어, Phase 1 가드 검사 변경.
4. 회귀 — 기존 도큐 (`scenario_text=null`) 도 정상 직렬화. Phase 2/3/4 코드는 손대지 않음. variant/admin/일괄삭제 모두 무관.
5. 로깅 — 두 신규 prefix (`[PreMVScenario]`, `[PreMVSplit]`) 에 `pre_mv_job_id`, `phase`, `model`, `text_len`/`scene_count`, `elapsed_ms` 표준 포함.

**frontend-dev 지시 요약 (5줄 이내)**
1. `PreCeremonyMVPanel.jsx` 의 `PreMVScenarioStep` 만 수정 — `scenePlan` prop 제거, `preMVJob` 에서 `scenario_text` + `scenario_events` 를 받아 렌더. 본문은 `<pre>` 또는 `white-space: pre-wrap` div 로 줄바꿈 보존, events 는 시점별 카드 리스트.
2. `PreMVScenesStep` 는 손대지 않음 (v21 scenes[] 형식 동일 — 호환).
3. force confirm 메시지 ("기존 씬이 모두 사라져요...") 유지. 단 v21 에선 추가 안내 한 줄: "스토리도 새로 풀어쓰기 합니다".
4. `loadJob` 의 디버그 로그 (L271~) 에 `scenario_text_len`, `scenario_events_count`, `section_markers_count` 추가 (옵셔널).
5. API 시그니처 변경 없음 — `runPreMVPhase0/1` 그대로. 단, payload 에서 신규 키 읽도록 `preMVJob.scenario_text` / `preMVJob.scenario_events` 접근만 추가. `npm run build` 무에러 확인.

### 10. 위험·갭

- **갭 1 — `scenario_events.story_slot` 의 값 도메인**: 기존 v17 매퍼는 `memories` 슬롯 하나로 여러 메모리를 묶었음. v21 에선 `memory_index` 로 분리하려는데, scene 단위에서는 `story_slot` 한 값만 들어가 — 표기 일관성을 위해 v21 신규 슬롯명 `memory` (단수) 사용. v17 의 `memories` 값과 다름 → 프론트 `SLOT_LABEL_KO` 매핑 키 추가 필요 (`memory: '추억'` 또는 `memory_0: '추억 1'`). **frontend-dev 가 라벨 매핑 확장.**
- **갭 2 — `_decide_scene_count_per_section`**: 음악 섹션별 적정 씬 수 산정 로직이 heuristic. 첫 버전 정책 — 섹션 길이 비례 분배 후 clamp (섹션당 최소 2 씬, 최대 6 씬). 실측 후 튜닝 여지.
- **위험 1 — LLM JSON 응답 길이 폭주**: scenario_text 가 너무 길게 나오면 (10p 초과) 토큰 컷오프로 JSON 파싱 실패. system prompt 에 "본문 5~8 페이지(한국어 5000~8000자)" 명시 + max_tokens=14000 보수적 설정으로 대응. 그래도 실패 시 retry 1회.
- **위험 2 — events 시간 역행**: LLM 이 가끔 events 순서를 흐트림. `_validate_scenario` 에서 슬롯 인덱스 시간역행이 감지되면 정렬 보정 (단순 stable sort by `_SLOT_ORDER[event.story_slot] * 100 + memory_index`).
- **위험 3 — 음악 섹션 마커 없는 가사**: v21 fallback (균등 4분할) 으로 처리. 하지만 사용자 입장에서 "음악 섹션 분할" 의도가 깨지므로 — 프론트에 안내 한 줄 ("이 음악은 섹션 마커가 없어 4 구간 균등 분할로 작업되었어요") 노출하면 더 친절. **선택사항, 본 PLAN 범위 밖.**

### v21 작업 끝(append).

---

## v21.1 — 2026-05-28 — fallback 제거 + 곡 구조 인식 강화 + Phase 0 안정화

### 1. 요구사항 요약

1. Phase 1 `_fallback_section_markers` 완전 제거. 마커 추출 실패 = `phase1_failed`.
2. 마커 인식 강화 — `mv_job.lyrics.body` 단독 라인 마커(`[Intro]`/`[Verse 1]` 등) 의 **기대 시퀀스** 추출 + Suno raw alignedWords 에서 마커 단어를 **직접 스캔** 한 결과와 1:1 비교. 한 개라도 누락/불일치 → 실패.
3. Phase 0 시나리오 분량 가이드를 "5~6 페이지 / 3000~5000자" 로 축소, `_MAX_TOKENS` 14000 → 10000. JSON 응답 안정성 강화.
4. 프론트 Step 2 phase1_error 배너에 한국어 친화 안내 문구 명확화.
5. 기존 v21 fallback 으로 만들어진 잡은 자동 무효화 없음 — force=true 재실행 시 v21.1 검증으로 통과/실패 판정.

### 2. Plan verification findings (v21.1)

각 파일·함수별 현재 동작 + 변경 영향:

| 파일 | 함수 / 위치 | 현재 동작 | v21.1 변경 영향 |
|------|-------------|-----------|------------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` L94~99 | `_SECTION_LABEL_RE` | `^\s*\[\s*(Intro\|Outro\|Verse\s*\d?\|Chorus\s*\d?\|Pre[-\s]?Chorus\|Bridge\|Hook\|Break\|Interlude)[^\]]*\]\s*$`. 줄 전체가 마커일 때만 매치. **충분** — `[Male]/[Female]/[Both]` 는 매치 안 됨(domain 외). | 신규 `_extract_expected_markers(lyrics_body)` 에서도 같은 정규식 재사용 가능. (lyrics_generator 의 허용 태그 풀과 일치.) |
| 동 L122~172 | `_extract_section_markers(lyric_timestamps, audio_duration)` | **세그먼트 단위** lyric_timestamps 의 각 `text` 가 마커 정규식과 일치하는지 검사. _words_to_segments 결과를 받음 — 마커 단어가 같은 라인의 가사 텍스트와 묶이면 매치 실패. | **DEPRECATE / 폐기.** v21.1 신규 함수 `_extract_section_markers_v2(aligned_words)` 가 raw alignedWords 의 **단어 단위** 스캔으로 마커 추출 (정확도↑). 기존 함수는 호환을 위해 남겨두되 호출 안 함. |
| 동 L175~192 | `_fallback_section_markers(audio_duration)` | 4구간 균등 분할 (Intro 10% / Verse 1 35% / Chorus 1 35% / Outro 20%). | **완전 제거.** 호출처는 split_into_scenes_v21 L639~645 한 곳 — 이 분기에서 즉시 `raise ValueError(KOREAN_PHASE1_FAIL_MSG)` 로 교체. |
| 동 L613~812 | `split_into_scenes_v21` | L636: `_extract_section_markers(...)` → 0개면 L640 `_fallback_section_markers(...)` 로 보정. 그 뒤 LLM 호출 + scenes 합성. | L634~645 흐름 전면 교체: (a) `lyrics_body = mv_job.lyrics.body` 로드, (b) `expected = _extract_expected_markers(lyrics_body)`, (c) `aligned_words = mv_job.suno_aligned_words_variants[variant]` 로드, (d) `extracted = _extract_section_markers_v2(aligned_words)`, (e) `len(expected) != len(extracted)` or label 시퀀스 mismatch → `raise PreMVPhase1MarkerMismatch(expected_count, extracted_count, KOREAN_MSG)`. (f) 통과 시 `section_markers = extracted` 로 진행. |
| `backend_8000/app/services/pre_mv_phase0_mapper.py` L95~153 | `PHASE0_SYSTEM_PROMPT` (분량 가이드 L105) | "5~8 페이지 분량(약 2500~5000자 권장)". JSON 출력. | **EDIT** — "5~6 페이지 분량(3000~5000자)" 로 변경. 본문 너무 길면 max_tokens 컷오프 위험이라 보수적으로. user message 의 분량 지시 (L278~284) 도 동기화. |
| 동 L302 | `_MAX_TOKENS = 14000` | Claude / OpenAI 양쪽 호출에 동일 적용. | **EDIT** — `10000` 으로 축소. Claude Opus 4.7 한국어 5000자(약 5000~7000 토큰) + JSON escape 마진 + scenario_events 1500 토큰 추정 합쳐 8500~9500 토큰. 10k 면 충분. 컷오프 위험 더 낮춤. |
| 동 L409~414 | `_validate_scenario` | `scenario_text` len < 200자 → ValueError. | **유지** — 그대로. (선택) 더 엄격하게 ≥1500자도 가능하지만 회귀 위험 있어 본 PLAN 범위 밖. |
| `backend_8000/app/services/suno_timestamp_service.py` L26~113 | `get_suno_timestamps(task_id, audio_id)` | Suno API `/api/v1/generate/get-timestamped-lyrics` 호출 → `data.alignedWords` 추출 → 즉시 `_words_to_segments()` 로 line/segment 합치고 **raw alignedWords 는 버림**. | **현재 mongo 에 raw alignedWords 가 저장돼 있지 않음.** v21.1-pre 필요 — `get_suno_timestamps` 가 raw aligned_words 도 반환하도록 시그니처 확장 + 호출처(`mv.py::_run_music_generation` L322~344) 가 raw 를 `mv_jobs.suno_aligned_words_variants` 에 저장. 자세한 내용은 §3. |
| `backend_8000/app/routes/mv.py` L320~365 | `_run_music_generation` 의 timestamps fetch + 저장 부분 | `ts = await get_suno_timestamps(suno_task_id, aid)` → segments 만 받아 `ts_by_variant[str(idx)] = ts` 에 저장. raw 는 손실. | **EDIT** — fetch 결과를 `{segments, aligned_words_raw}` dict 로 받아 `lyric_timestamps_variants` (segments) 와 `suno_aligned_words_variants` (raw) 둘 다 저장. 자세한 내용은 §3. |
| `backend_8000/app/routes/pre_mv.py` L710~799 | `_run_phase1` | `lyric_timestamps` 를 doc 에서 읽어 `split_into_scenes_v21` 로 넘김. 실패 시 `phase1_failed` + `phase1_error` 저장. | **EDIT** — splitter 가 raw aligned_words 도 필요하므로, `_run_phase1` 가 mv_job 도큐에서 `suno_aligned_words_variants[str(audio_variant)]` 를 로드해 `split_into_scenes_v21(..., aligned_words=...)` 로 전달. 또 `lyrics_body = mv_job.lyrics.body` 도 로드해 함께 전달. |
| 동 L399~418 | `create_pre_mv_job` 의 `new_doc` | 신규 잡 도큐 스키마. `lyric_timestamps` (segments) 만 복사. | **EDIT** — `aligned_words` 신규 필드 추가 (`mv_job.suno_aligned_words_variants[str(audio_variant)]` 복사). `lyrics_body` 도 `lyrics_snapshot.body` 로 동일 도큐에 보존. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` L1265~1267 | Phase 1 phase1_error 배너 | `<div className="pre-mv-step__error">{preMVJob.phase1_error}</div>` 단순 표시. | **EDIT** — `isFailed && preMVJob?.phase1_error` 일 때 강화된 빨간 배너 + 한국어 친화 prefix "[Phase 1 실패] 곡 구조 인식에 실패했어요. 새로 만들거나 운영자에게 문의해 주세요." + 백엔드 phase1_error 본문(예 "기대 9개 / 인식 7개") 을 그 아래에 사이즈 작게. CSS `.pre-mv-step__error` 는 기존 그대로 재사용 가능. |

핵심 결론:
- **mv_job.lyrics.body 단독 라인 마커 정규식**은 기존 `_SECTION_LABEL_RE` (L94~99) 가 충분. lyrics_generator (L74~82, L243) 가 정의한 허용 태그 풀 `[Intro] [Verse 1] [Verse 2] [Verse 3] [Pre-Chorus] [Chorus 1] [Chorus 2] [Bridge] [Outro]` 와 정확히 일치.
- **보컬 라벨 `[Male]/[Female]/[Both]`** 는 정규식 도메인 외라 자동 제외. 명시 스킵 코드 불필요.
- **Suno raw alignedWords** 는 현재 mongo 에 저장돼 있지 않음 → §3 의 v21.1-pre 단계 필요.

### 3. 데이터 의존 점검 — raw alignedWords 저장

#### 현재 상태
`suno_timestamp_service.get_suno_timestamps()` (L26~113) 가 Suno API 응답의 `data.alignedWords` 를 즉시 `_words_to_segments()` 로 가공해 라인/세그먼트 단위로만 반환. raw 단어 리스트는 **함수 안에서 폐기**.

따라서 `mv_jobs` 컬렉션에는:
- 있음: `lyric_timestamps` / `lyric_timestamps_variants` (segments).
- 없음: raw alignedWords (마커 단어 단위 스캔에 필요).

#### 두 가지 옵션 비교

**옵션 A — record-info 재호출 매번 fetch**
- 장점: schema 변경 없음, 기존 잡도 동작.
- 단점: Phase 1 진입할 때마다 Suno API 호출 → 외부 의존성 + rate limit + 비용 + 음악 만든 시점과 마커 추출 시점이 떨어져 있어 API 가 timestamps 미보장.
- 위험: Suno 의 timestamped-lyrics 엔드포인트가 일정 시간 후 응답 안 할 수도 (Suno API 보장 X).

**옵션 B — 신규 mv_jobs 컬럼 `suno_aligned_words_variants` 저장 (권장)**
- 장점: 한 번 fetch 한 raw 를 영구 저장 → Phase 1 가 idempotent, 외부 의존성 없음. Suno API 가 나중에 만료돼도 안전.
- 단점: 도큐 크기 증가 (한 곡 ~3분 = 약 300~600 단어 = 약 30~60KB JSON). variant 2개 합쳐도 100KB 미만 — Mongo 16MB 제한 대비 미미.
- 마이그레이션: 신규 잡부터 자동 채워짐. 기존 v21 잡은 raw 없으므로 Phase 1 진입 시 `record-info` 1회 백업 fetch (옵션 A 의 fallback path) 후 mv_jobs 도큐에 백필 저장.

**결정**: **옵션 B + 1회 백필 fallback**.

#### v21.1-pre 단계 (옵션 B 구현)

1. `suno_timestamp_service.get_suno_timestamps(task_id, audio_id)` 의 반환 타입을 `list[dict]` 에서 `{"segments": list[dict], "aligned_words": list[dict]}` 로 확장 (segments 는 기존 그대로, aligned_words 추가).
2. `mv.py::_run_music_generation` (L320~365) 가 반환값 dict 에서 두 키 모두 받아:
   - `lyric_timestamps_variants[str(idx)] = result.segments` (기존)
   - `suno_aligned_words_variants[str(idx)] = result.aligned_words` (신규)
3. `pre_mv.py::create_pre_mv_job` (L399~418) 의 `new_doc` 에 `aligned_words` 신규 필드 — `mv_job.suno_aligned_words_variants[str(audio_variant)]` 복사 + `lyrics_body` (mv_job.lyrics.body) 복사.
4. `pre_mv.py::_run_phase1` (L710~799) — pre_mv_job 도큐에서 `aligned_words` / `lyrics_body` 로드해 `split_into_scenes_v21` 로 전달.
5. 기존 잡 백필 — 두 가지 path:
   - (자동) `_run_phase1` 진입 시 `aligned_words` 가 비어있으면 mv_job.suno_task_id + suno_audio_ids[variant-1] 로 record-info 한 번 더 호출 → mv_jobs 와 pre_mv_jobs 둘 다 채움.
   - (수동) admin 스크립트로 모든 v21 잡 일괄 백필. 별도 작업 — 본 PLAN 범위 밖, 필요시 별도 진행.

### 4. 변경 매트릭스 (v21.1)

| 파일 | 변경 종류 | 항목 | 로깅 추적자 |
|------|-----------|------|-------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | EDIT | (a) 신규 `_extract_expected_markers(lyrics_body: str) -> list[str]` — `_SECTION_LABEL_RE` 로 단독 라인 추출 + `_normalize_section_label` 적용. (b) 신규 `_extract_section_markers_v2(aligned_words: list[dict]) -> list[dict]` — Suno raw 단어 시퀀스에서 `_SECTION_LABEL_RE` 매치 단어 모음. 보컬 라벨 자동 스킵 (정규식 도메인 외). 인접 마커 사이 단어들이 해당 섹션의 본문. (c) 신규 예외 `class PreMVPhase1MarkerMismatch(ValueError)` — `__init__(expected_count, extracted_count, mismatched_labels)` + 한국어 메시지. (d) `_fallback_section_markers` 삭제. (e) `split_into_scenes_v21` 시그니처에 `lyrics_body: str` + `aligned_words: list[dict]` 추가 (lyric_timestamps 는 회귀호환 위해 유지). (f) L634~645 분기 교체 — `_extract_expected_markers` + `_extract_section_markers_v2` 비교 후 mismatch 면 `raise`. | `[PreMVSplit] phase1_marker_check pre_mv_job_id=%s expected=%d extracted=%d mismatch_labels=%s` |
| `backend_8000/app/services/pre_mv_phase0_mapper.py` | EDIT | (a) `PHASE0_SYSTEM_PROMPT` L105 "5~8 페이지" → "5~6 페이지 (3000~5000자)" 로 교체 + 본문 안 "약 2500~5000자" → "약 3000~5000자". (b) `_build_user_message` L279 "5~8 페이지" → "5~6 페이지 (3000~5000자)" 동기화. (c) `_MAX_TOKENS = 14000` → `10000`. (d) 응답 정규화 가드 — `_strip_code_fence` 가 마크다운 펜스 포함 케이스 추가 처리 (선택, 기존 코드도 robust). | `[PreMVScenario] entry max_tokens=10000` 로 변동 확인. |
| `backend_8000/app/services/suno_timestamp_service.py` | EDIT | `get_suno_timestamps(task_id, audio_id)` 반환을 `{"segments": [...], "aligned_words": [...]}` 로 확장. 호출처가 dict 결과 키만 읽도록 변경 안내. 빈 응답 시 `{"segments": [], "aligned_words": []}`. | `[SunoTimestamps] fetch ok ... words=%d segments=%d aligned_words_kept=%d` |
| `backend_8000/app/routes/mv.py` | EDIT | `_run_music_generation` L322~358 — `ts` 가 dict 반환 형식이므로 `ts.segments` / `ts.aligned_words` 두 키 모두 처리. `update_doc` 에 `suno_aligned_words_variants` 추가 저장. 회귀 호환: 단수 `lyric_timestamps` 도 그대로 유지. | `[MVRoute] timestamps backfill mv_job=%s variant=%d segments=%d aligned_words=%d` |
| `backend_8000/app/routes/pre_mv.py` | EDIT | (a) `create_pre_mv_job` `new_doc` 에 `aligned_words` (mv_job.suno_aligned_words_variants[variant]) + `lyrics_body` (mv_job.lyrics.body) 두 필드 추가. (b) `_run_phase1` — doc 에서 `aligned_words` / `lyrics_body` 로드. 비어있으면 1회 record-info 백업 fetch (옵션 A 의 fallback). 그래도 비어있으면 `phase1_failed` + 한국어 메시지. (c) `split_into_scenes_v21(..., aligned_words=..., lyrics_body=...)` 호출. (d) `_serialize_pre_mv_job` — light 응답에 `aligned_words_count`, `lyrics_body_len` 추가 (선택, 디버깅 편의). | `[PreMVRoute] phase=phase1 bg marker_check pre_mv_job_id=%s expected=%d extracted=%d` |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | EDIT | Phase 1 phase1_error 배너 (L1265~1267) 강화 — `isFailed && preMVJob?.phase1_error` 일 때 ① 상단 큰 글자 "[Phase 1 실패] 곡 구조 인식에 실패했어요." ② 본문 "새로 만들거나 운영자에게 문의해 주세요." ③ 백엔드 phase1_error (작은 글자, 디버깅용). 클래스는 기존 `.pre-mv-step__error` 재사용 가능. | — |
| `frontend/src/components/PreCeremonyMVPanel.css` | (선택) | `.pre-mv-step__error--phase1-fail` 신규 클래스로 더 큰 상단 글자 (`font-weight:700; font-size:14px`) + 본문 (`font-size:12px`). 또는 기존 클래스 그대로 두고 jsx 안에 inline `<strong>` 사용. **inline 권장 — CSS 변경 0.** | — |

### 5. 에러 메시지 텍스트 (한국어 확정)

- **phase1 (백엔드 ValueError 본문)**: `"곡 구조 인식에 실패했어요 (기대 {N}개 / 인식 {M}개). Suno 가사 데이터에 결함이 있어 진행할 수 없어요. 새로 음악을 만들거나 운영자에게 문의해 주세요."`
  - {N} = `_extract_expected_markers(lyrics_body)` 결과 count.
  - {M} = `_extract_section_markers_v2(aligned_words)` 결과 count.
- **phase1 (프론트 배너 상단 prefix)**: `"[Phase 1 실패] 곡 구조 인식에 실패했어요. 새로 만들거나 운영자에게 문의해 주세요."`
- **phase1 (프론트 배너 하단 본문)**: 백엔드 phase1_error 그대로 (위 메시지 + 카운트).
- **phase1 (raw aligned_words 미저장 케이스)**: `"이 잡은 마커 분석에 필요한 원본 데이터가 없어요. 새로 식전영상 잡을 만들어 주세요."`

### 6. 테스트 항목

**A. Phase 1 마커 검증 (v21.1 핵심)**

1. **N=M 일치 PASS**: lyrics.body 의 단독 라인 마커가 `[Intro] [Verse 1] [Verse 2] [Pre-Chorus] [Chorus 1] [Verse 3] [Bridge] [Chorus 2] [Outro]` (9개), Suno raw alignedWords 안에서도 9개 마커 단어 시퀀스 추출 → `_run_phase1` 성공, `section_markers` length=9, status=`phase1_ready`.
2. **N≠M FAIL**: lyrics.body 는 9개인데 alignedWords 에서 7개만 추출 (Suno 가 일부 마커를 단어로 변환 못함) → `phase1_failed`, phase1_error 본문 = "곡 구조 인식에 실패했어요 (기대 9개 / 인식 7개). ...".
3. **lyrics.body 단독 라인 추출 정확성**: `_extract_expected_markers` 가 보컬 라벨 `[Male]` `[Female]` `[Both]` 가 같은 줄에 있는 라인을 마커로 오인식하지 않음. (정규식 도메인 외라 자동 스킵.)
4. **`_normalize_section_label` 일관성**: 기대 마커 시퀀스와 추출 마커 시퀀스 둘 다 동일 normalize 거쳐 비교.
5. **fallback 함수 제거**: `_fallback_section_markers` import 가 라우트/테스트/유틸 어디에서도 호출되지 않음 (grep 확인).

**B. Phase 0 안정화**

6. **시나리오 분량 정상**: Phase 0 실행 후 `scenario_text` length 가 3000~5500자 사이 (이전 v21 평균 4500~6500자 대비 축소).
7. **`_MAX_TOKENS=10000` 응답 컷오프 없음**: JSON 응답이 truncated 안 됨 (json.loads 성공). retry 1회 안 일어남 (attempt=1 에서 성공 로그 확인).
8. **응답 정규화 가드**: 모델이 마크다운 펜스 ```json ... ``` 로 감싸도 `_strip_code_fence` 가 처리해 success.

**C. 프론트 배너**

9. **phase1_error 배너 노출**: Phase 1 실패 후 PreCeremonyMVPanel Step 2 에 빨간 배너 + "[Phase 1 실패] ..." prefix + 백엔드 메시지 본문.
10. **Step 1 phase0_error 배너 회귀 없음**: Phase 0 실패 케이스도 기존 동작 유지.

**D. raw alignedWords 저장 흐름**

11. **신규 잡 저장**: 새 mv_job 음악 생성 → `mv_jobs.suno_aligned_words_variants["1"]` length > 0.
12. **신규 pre_mv_job 복사**: 새 pre_mv_job 생성 → `pre_mv_jobs.aligned_words` length > 0 + `pre_mv_jobs.lyrics_body` 채워짐.
13. **기존 v21 잡 (raw 없음) 처리**: `aligned_words` 비어있는 잡에서 `_run_phase1` 진입 시 record-info 백업 fetch 시도 → 성공하면 phase1 진행, 실패하면 한국어 메시지로 fail.

**E. 회귀 (Phase 0 / Phase 2 / Phase 3 / Phase 4 / variant 선택 / 일괄 삭제)**

14. **Phase 0 회귀**: 시나리오 생성 자체 동작은 변경 없음 (분량 가이드만 축소). force=true 재실행 후 scenes/scenario_events 초기화 정상.
15. **Phase 2 회귀**: scenes[] 형식 변경 없음. 이미지 생성 정상.
16. **Phase 3 회귀**: 영상 생성 정상.
17. **Phase 4 회귀**: concat + audio merge 정상.
18. **variant 선택**: variant=2 잡에서 `aligned_words` 가 `mv_jobs.suno_aligned_words_variants["2"]` 에서 정확히 복사되는지.
19. **일괄 삭제 (v20)**: 신규 필드 추가에도 일괄 삭제 동작 정상.

### 7. 회귀 위험

1. **Phase 0** — 영향 없음. 분량 가이드 + max_tokens 만 변경. JSON 응답 schema/검증 로직 동일. 기존 시나리오 잡 도큐 손상 없음.
2. **Phase 2/3/4** — 영향 없음. scenes[] 형식 변경 없음. section_markers 형식도 동일 (`{label, start, end}`).
3. **variant 선택 (v19)** — `mv_jobs.suno_aligned_words_variants[str(variant)]` 와 `lyric_timestamps_variants[str(variant)]` 가 같은 키 체계 → 신규 잡에서 정합성 보장. 기존 잡은 v21.1-pre 의 백업 fetch path 로 처리.
4. **일괄 삭제 (v20)** — 신규 필드 추가만 — 영향 없음.
5. **admin 가드** — `_resolve_pre_mv_job` 변경 없음 — 영향 없음.
6. **v21 fallback 잡 자동 무효화 안 함** — 사용자가 force=true 재실행하면 v21.1 검증 통과/실패 판정. 기존 도큐 schema 그대로 유지 (마커 N!=M 이라도 도큐 자체는 유효).
7. **raw alignedWords 저장 후 도큐 크기** — 한 곡 평균 30~60KB, variant 2개 = 60~120KB. Mongo 16MB 제한 대비 0.7% 미만 — 안전.
8. **Suno API 의 record-info 백업 fetch** — rate limit + 응답 신뢰성 의존. 실패 시 phase1_failed 로 명확히 떨어뜨림. 사용자 입장에서 "다시 시도" 자유.
9. **lyrics_generator 의 마커 풀 vs `_SECTION_LABEL_RE`** — lyrics_generator (L243) 가 허용한 풀과 정확히 일치. 둘 다 `[Intro] [Verse 1] [Verse 2] [Verse 3] [Pre-Chorus] [Chorus 1] [Chorus 2] [Bridge] [Outro]` 위주. 향후 마커 풀 확장 시 양쪽 동시 업데이트 필요 (문서 메모).

### 8. 작업 분배

**backend-dev 지시 요약 (5줄 이내)**
1. `suno_timestamp_service.get_suno_timestamps()` 반환을 `{"segments": [...], "aligned_words": [...]}` 로 확장. `mv.py::_run_music_generation` 에서 두 키 모두 mongo 저장 (`lyric_timestamps_variants` + 신규 `suno_aligned_words_variants`).
2. `pre_mv_phase1_splitter.py` — `_extract_expected_markers(lyrics_body)` + `_extract_section_markers_v2(aligned_words)` 신규 추가. `_fallback_section_markers` 삭제. `split_into_scenes_v21` 시그니처에 `lyrics_body` + `aligned_words` 추가, L634~645 분기를 expected vs extracted 비교 + mismatch 시 `raise ValueError(한국어 메시지)` 로 교체.
3. `pre_mv_phase0_mapper.py` — `PHASE0_SYSTEM_PROMPT` 분량 가이드 "5~6 페이지 (3000~5000자)", `_build_user_message` 동기화, `_MAX_TOKENS = 10000`.
4. `pre_mv.py::create_pre_mv_job` 의 `new_doc` 에 `aligned_words` + `lyrics_body` 두 필드 추가 (mv_job 에서 복사). `_run_phase1` — doc 에서 두 필드 로드해 splitter 로 전달. 비어있으면 1회 record-info 백업 fetch.
5. 로깅 — `[PreMVSplit]` 에 `phase1_marker_check expected=%d extracted=%d mismatch_labels=%s`, `[SunoTimestamps]` 에 `aligned_words_kept=%d` 추가.

**frontend-dev 지시 요약 (3줄 이내)**
1. `PreCeremonyMVPanel.jsx` L1265~1267 의 Step 2 phase1_error 배너 강화 — `isFailed && phase1_error` 일 때 `<div className="pre-mv-step__error"><strong>[Phase 1 실패]</strong> 곡 구조 인식에 실패했어요. 새로 만들거나 운영자에게 문의해 주세요.<div className="pre-mv-step__error-detail">{phase1_error}</div></div>`.
2. CSS 변경 없음 (기존 `.pre-mv-step__error` 재사용, `<strong>` + `<div>` 만 inline 추가). 필요 시 `.pre-mv-step__error-detail { font-size:11px; opacity:0.75; margin-top:4px; }` 한 줄만 추가.
3. `npm run build` 무에러 확인.

### v21.1 작업 끝(append).

---

## v22 — 2026-05-28 — 음악 플레이어 가사 타임스탬프 토글

### 1. 요구사항
1. GenerationStatusPage 의 `audio-card` 영역에서, 트랙 1·2 의 `<audio>` 플레이어 바로 아래에 variant 별 **가사 타임스탬프 토글 패널**을 노출한다 (기본 접힘).
2. 표시 형식: 한 줄당 `[mm:ss.SS] 라인 텍스트` (예: `[00:14.20] [Male] 작은 벤치 위로 불어오던 바람`). 데이터 소스는 `mv_jobs.lyric_timestamps_variants["1"|"2"]` 의 segments 리스트 (각 `{text, start, end}`).
3. 회귀 보호: 음악 플레이어 `<audio>`, 다운로드 버튼, 트랙 라벨/배지, 식전영상 탭 모두 그대로. 백엔드 schema 변경 없음.

### 2. Plan verification findings — 0단계 결과

1. **`GenerationStatusPage.jsx` L189~L224** — `isMusicReady && <div className="card audio-card">` 내부에 트랙 1 `<audio>` (L194~198) + `variantsCount > 1` 가드 아래 `.audio-card__variant` 내 트랙 2 `<audio>` (L199~210). 다운로드/내 작품 액션은 L211~222 의 `.audio-card__actions`. 토글 패널 삽입 지점은 **각 `<audio>` 직후**, 액션 블록 위.
2. **`variantsCount` 정의 L130** — `job?.audio_variants?.length || 0`. 트랙 2 노출 가드는 이미 이 변수로 통제됨 → 가사 토글도 같은 가드로 일관 처리 가능 (variant 1 토글은 무조건 노출, variant 2 토글은 `variantsCount > 1` 일 때만).
3. **`mv_job` 응답 페이로드 — 중요한 발견** — `backend_8000/app/routes/mv.py::_serialize_job` (L48~75) 는 **현재 segments 본문을 응답에 포함하지 않음**. 노출되는 것은 `lyric_timestamps_variants_count: { "1": N, "2": M }` 카운트만 (L67) 과 `lyric_timestamps` 단수 (variant 1 alias, L62). variant 2 segments 가 응답에 없음 → 프런트가 직접 segments 를 렌더하려면 **백엔드 응답 확장이 필요**.
4. **데이터 형태 확인** — `suno_timestamp_service.py` L41 "segments: 라인/세그먼트 리스트. 각 원소 `{"text": str, "start": float, "end": float}`". mongo 저장 위치는 `mv.py::_run_music_generation` L367 `lyric_timestamps_variants: ts_by_variant_segments` (dict, 키는 `"1"`/`"2"`, 값은 segments 리스트). v21.1 변경으로도 segments 형식은 유지됨.
5. **`GenerationStatusPage.css` 회귀 보호 영역** — `.audio-card` (L104), `.audio-card__title` (L109), `.audio-card__player` (L114), `.audio-card__variant` (L119, 트랙 2 그룹 컨테이너 — `border-top` 으로 트랙 구분), `.audio-card__variant .muted` (L125), `.audio-card__actions` (L130), `.audio-card__variant-tag` (L177, 트랙 번호 배지). v22 신규 클래스는 기존 클래스 영역을 침범하지 않도록 `.audio-card__lyrics-toggle` / `.audio-card__lyrics-line` 등 별도 네임스페이스 사용.

### 3. 변경 매트릭스

| 파일 | 변경 내용 | 비고 |
|---|---|---|
| `backend_8000/app/routes/mv.py` (`_serialize_job`) | 응답에 `lyric_timestamps_variants` (segments 본문 dict) 추가 — 기존 `lyric_timestamps_variants_count` 도 그대로 유지. | 단일 한 줄 추가. 회귀 0. 트래픽 부담: variant 한 곡당 ~10~20KB × 2 ≒ 최대 40KB. polling 5s 간격이지만 `music_ready` 후 polling 정지(TERMINAL_STATUSES) — 1~2회만 전송됨. |
| `frontend/src/pages/GenerationStatusPage.jsx` | 트랙 1 `<audio>` 직후 / 트랙 2 `<audio>` 직후에 `<LyricsTimestampToggle variant="1" segments={...} />` 컴포넌트 삽입. `formatTimestamp(sec)` 헬퍼 추가. | 컴포넌트는 동일 파일 내부 정의 (LyricsBody 와 동일 패턴). 기존 audio/다운로드/탭 영역 무수정. |
| `frontend/src/pages/GenerationStatusPage.css` | `.audio-card__lyrics-toggle`, `.audio-card__lyrics-summary`, `.audio-card__lyrics-list`, `.audio-card__lyrics-line`, `.audio-card__lyrics-ts`, `.audio-card__lyrics-empty` 신규 추가. | 기존 `.audio-card*` 클래스 정의는 손대지 않음. |

**백엔드 추가 변경 1줄 만 필요** — 0단계에서 발견한 응답 누락 이슈 때문. PreCeremonyMVPanel 은 이미 동일 데이터를 별도 endpoint(`getPreMVJob`) 로 받아왔지만, GenerationStatusPage 는 `getMVJob` 만 호출 → variant 2 segments 가 응답에 없음. 단일 키 추가로 해결.

### 4. UI 구현

**위치 및 구조 (GenerationStatusPage.jsx)**:
```
<div className="card audio-card">
  <h2>음악 <span>🎵 트랙 1번</span></h2>
  <audio controls src=... />
  <LyricsTimestampToggle variant="1" segments={job?.lyric_timestamps_variants?.["1"] || []} />   ← v22 신규
  {variantsCount > 1 && (
    <div className="audio-card__variant">
      <p>다른 버전 <span>🎵 트랙 2번</span></p>
      <audio controls src=... />
      <LyricsTimestampToggle variant="2" segments={job?.lyric_timestamps_variants?.["2"] || []} />  ← v22 신규
    </div>
  )}
  <div className="audio-card__actions">...</div>
</div>
```

**컴포넌트 (LyricsBody 옆에 동일 파일 내부 정의)**:
```jsx
function formatTimestamp(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);  // centiseconds (SS)
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function LyricsTimestampToggle({ variant, segments }) {
  const list = Array.isArray(segments) ? segments : [];
  return (
    <details className="audio-card__lyrics-toggle">
      <summary className="audio-card__lyrics-summary">
        🎼 가사 타임스탬프 (트랙 {variant}번 · {list.length}줄)
      </summary>
      {list.length === 0 ? (
        <p className="audio-card__lyrics-empty muted">
          가사 타임스탬프가 아직 준비되지 않았어요.
        </p>
      ) : (
        <ol className="audio-card__lyrics-list">
          {list.map((seg, idx) => (
            <li key={idx} className="audio-card__lyrics-line">
              <span className="audio-card__lyrics-ts">[{formatTimestamp(seg?.start)}]</span>
              {' '}{(seg?.text || '').trim()}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
```

**선택 사유**: `<details>/<summary>` 사용 — useState 불필요, 접근성 무료 보장, `open` 속성 미지정 → 기본 접힘. 토글 상태가 polling 으로 리렌더되어도 브라우저가 native 로 유지.

**CSS (GenerationStatusPage.css 신규 블록)** — `.audio-card__variant` 의 `border-top` 과 시각 충돌 방지 위해 토글 본체는 padding/배경만 갖는 가벼운 박스로:
```css
.audio-card__lyrics-toggle {
  margin: 6px 0 8px 0;
  padding: 0;
  font-size: 13px;
}
.audio-card__lyrics-summary {
  cursor: pointer;
  padding: 6px 8px;
  color: var(--muted);
  border-radius: 6px;
  user-select: none;
}
.audio-card__lyrics-summary:hover { background: rgba(0,0,0,0.04); color: var(--text); }
.audio-card__lyrics-list {
  list-style: none;
  margin: 6px 0 4px 0;
  padding: 8px 10px;
  background: #fafafa;
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 280px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.6;
}
.audio-card__lyrics-line { padding: 2px 0; }
.audio-card__lyrics-ts { color: #2b5fad; font-weight: 500; margin-right: 4px; }
.audio-card__lyrics-empty { margin: 6px 0; font-size: 12px; }
```

### 5. 테스트 항목

1. **표시 — variant 1**: `music_ready` + `lyric_timestamps_variants.["1"]` 가 있는 잡 (예: `6a169ecc055984d6edae45e2`). 토글 펼침 → 첫 줄 `[00:??.??] [Verse 1] ...` 마지막 줄까지 정렬, 줄 수 표기 일치.
2. **표시 — variant 2**: 동일 잡의 `["2"]` 도 별도 토글에서 펼침. variant 1 과 시작 시각 다르게 표시.
3. **카운트 일치**: `summary` 의 "N줄" 이 실제 `<li>` 개수와 일치, 또한 기존 `lyric_timestamps_variants_count[str(variant)]` 와도 일치.
4. **포맷 헬퍼**: `formatTimestamp(0)` → `00:00.00`, `formatTimestamp(14.2)` → `00:14.20`, `formatTimestamp(83.456)` → `01:23.45`, `formatTimestamp(undefined)` → `00:00.00`, `formatTimestamp(-1)` → `00:00.00`.
5. **빈 segments**: `lyric_timestamps_variants.["1"]` 가 `[]` 또는 미정의일 때 토글 펼침 → 빈 안내 메시지 ("가사 타임스탬프가 아직 준비되지 않았어요.") 노출, 에러 throw 없음.
6. **variant 2 미존재**: `variantsCount === 1` 일 때 트랙 2 블록 자체 미노출 → variant 2 토글도 미노출 (회귀).
7. **회귀 — 음악 플레이어**: 트랙 1·2 의 `<audio controls>` 정상 재생, src 변경 없음.
8. **회귀 — 다운로드**: `.audio-card__actions` 의 `<a download>` 버튼 정상 다운로드 (다운로드 파일명 `lyrics.title.mp3` 유지).
9. **회귀 — 식전영상 탭**: `gen-status__tabs-area` 의 [웨딩사진]/[식전영상] 탭 전환 정상, `PreCeremonyMVPanel` props (`mvJob`) 에 새 필드(`lyric_timestamps_variants`) 추가되어도 기존 게이팅 (`lyric_timestamps_variants_count` 기반) 동작 그대로.
10. **회귀 — polling**: `music_ready` 도달 후 polling 정지 (`TERMINAL_STATUSES`) — segments 본문이 응답에 포함되어도 추가 polling 비용 없음.

### 6. 회귀 위험

1. **백엔드 응답 크기 증가** — `lyric_timestamps_variants` segments 본문 추가 = variant 당 평균 80~150 segments × ~80B ≒ 10~15KB, variant 2개 = 20~30KB. polling 은 `music_ready` 도달 즉시 정지하므로 1~2 회만 전송 — 무시 가능. 단, 만약 향후 `music_ready` 잡에서도 polling 이 켜져 있는 화면(예: PreCeremonyMVPanel 의 별도 폴링)이 생기면 트래픽 검토 필요.
2. **PreCeremonyMVPanel 의 게이팅 회귀** — `mvJob` prop 으로 `lyric_timestamps_variants` 가 새로 들어와도 panel 내부는 `lyric_timestamps_variants_count` 와 `lyric_timestamps_status` 만 참조 (코드 확인됨: PreCeremonyMVPanel.jsx L207~217). 영향 없음.
3. **`<details>` 접근성/스타일** — 일부 브라우저(Safari < 15) 의 default disclosure triangle 위치 차이. `summary::-webkit-details-marker` 는 그대로 두고 텍스트 앞에 🎼 이모지로 시각적 보강 → 큰 문제 없음. 필요 시 후속 PR 에서 `list-style: none` + 자체 화살표 추가.
4. **세그먼트 형식 호환** — 백엔드가 `text/start/end` 외 키를 추가해도 프런트는 무시(필요한 키만 읽음). 반대로 `text` 누락 시 `(seg?.text || '').trim()` 으로 빈 줄만 노출 — 에러 없음.
5. **GenerationStatusPage 다른 상태(generating_music/music_failed)** — `isMusicReady` 가드 안에서만 렌더 → 다른 상태 화면 영향 없음.

### 7. 작업 분배

**backend-dev 지시 요약 (2줄 이내)**
1. `backend_8000/app/routes/mv.py::_serialize_job` 의 반환 dict 에 `"lyric_timestamps_variants": doc.get("lyric_timestamps_variants") or {},` 한 줄 추가. 위치는 `lyric_timestamps_variants_count` 바로 위/아래 (가독성). 기존 키 모두 유지.
2. 추가 테스트: `pytest` 로 `_serialize_job` 단위 테스트가 있으면 새 키 검증 한 줄 추가 (없으면 생략). 실제 잡 (`6a169ecc055984d6edae45e2`) `GET /api/mv/jobs/{id}` 로 응답에 `lyric_timestamps_variants["1"]` segments 본문이 포함됨을 확인.

**frontend-dev 지시 요약 (3줄 이내)**
1. `frontend/src/pages/GenerationStatusPage.jsx` — `LyricsBody` 옆에 `formatTimestamp(sec)` 와 `LyricsTimestampToggle({variant, segments})` 두 함수 정의 (위 "4. UI 구현" 코드 그대로). 트랙 1 `<audio>` (L194~198) 직후, 트랙 2 `<audio>` (L204~208) 직후에 각각 `<LyricsTimestampToggle variant="1" segments={job?.lyric_timestamps_variants?.["1"] || []} />` / `variant="2"` 삽입.
2. `frontend/src/pages/GenerationStatusPage.css` — 파일 끝에 `.audio-card__lyrics-toggle`, `.audio-card__lyrics-summary`, `.audio-card__lyrics-list`, `.audio-card__lyrics-line`, `.audio-card__lyrics-ts`, `.audio-card__lyrics-empty` 6개 클래스 추가 (위 코드 그대로). 기존 `.audio-card*` 정의는 무수정.
3. 테스트: 실제 잡 ID 로 `/generation/{id}` 진입 → 트랙 1·2 토글 펼침 / 접힘, 타임스탬프 포맷 `00:14.20`, 다운로드/탭 정상. `npm run build` 무에러.

### v22 작업 끝(append).


## v23 — 2026-05-28 — 추가영상 생성 (Higgsfield-style) 편집자 공간

### 1. 요구사항 요약

작품 디테일 페이지 [웨딩사진]/[식전영상] 옆에 **[추가영상생성]** 탭 추가. owner+admin 접근.
영역 A — 씬 이미지 만들기. 입력: 자산 멘션(시트 4종 + place + 웨딩사진 v13 결과) + 추가 이미지 직접 업로드(최대 4장) + 자유 텍스트 프롬프트(@-멘션 인식) + 이미지 모델(gpt_image_2 / nb_pro). 비동기 잡, fire-and-poll. 결과 PNG → `extra_scene_images` 컬렉션 + MinIO `extra/{mv_job_id}/scene_images/{id}.png`. 갤러리: 그리드, 카드별 [📹 이걸로 영상 만들기] + 단일/일괄 다운로드/삭제(v16/v20 패턴).
영역 B — 씬 영상 만들기. 입력: 소스 이미지 1장(A 결과 가져오기 OR 직접 업로드, 둘 중 하나 필수) + 연출 프롬프트 + 카메라 모션 프리셋(11종, 다중 선택, prompt 에 영문 문장 자동 prepend) + 영상 모델 4종(veo/kling/seedance/grok, 모델별 클립 길이 한계) + 변주 N개(1/2/4 — Veo seed 미지원 시 단일). 결과 mp4 → `extra_videos` 컬렉션 + MinIO `extra/{mv_job_id}/videos/{id}.mp4`. 카드별 [재생/다운로드/삭제/🔄 추가 수정(멀티턴 refine 체인 — v15 모델 lock 패턴)/▶ 이어붙이기(마지막 프레임 추출, 비-체인)].
v23 의 작품 디테일 내 다른 탭(웨딩사진/식전영상/음악 플레이어)과 아이템관리 페이지에는 영향 0.

### 2. Plan verification findings (0단계 코드 검증 결과)

| # | 파일 | 라인 | 함수 / 심볼 | 현재 동작 | v23 에서의 변경 영향 |
|---|------|-----:|------------|-----------|---------------------|
| 1 | `backend_8000/app/routes/wedding_photos.py` | L44~47 | `router = APIRouter(prefix="/api/mv/jobs/{mv_job_id}/wedding-photos")` | mv_job 종속 prefix + `_resolve_mv_job` 가드 (owner+admin) | **참고 패턴**. v23 신규 라우터는 동일 prefix root + 자체 sub-prefix (`/extra-scene-images`, `/extra-videos`) 채택. `_resolve_mv_job` 헬퍼는 신규 파일에 동일 패턴으로 복사 (의존성 늘리지 않음). |
| 1b | 〃 | L165~194 | `_resolve_mv_job(mv_job_id, current_user)` | mv_jobs find_one → owner==user_id OR is_admin 가드. 반환 (job, owner_user_id, is_admin) 또는 JSONResponse. | v23 신규 라우트 2개에 동일 사본 — 일관성. |
| 1c | 〃 | L77~101 | `_serialize_wedding_photo_asset`, `_serialize_photo_job` | object_name → preview_url 변환 + meta 펼치기 | 신규 `_serialize_extra_scene_image`, `_serialize_extra_video` 가 같은 패턴 따름 (preview_url = `/api/character/preview/{object_name}`). |
| 1d | 〃 | L224~452 | `POST /generate` | (a) 잡 oid 사전 발급 → wedding_assets pre-insert + wedding_photo_jobs insert → asyncio.create_task. (b) image_model 별 API 키 게이팅 (settings.openai_api_key / google_api_key). (c) Mention refs dict 화. | **A 영역**: 동일 흐름으로 `POST /extra-scene-images/generate`. asset pre-insert 는 `extra_scene_images` 컬렉션에 (object_name=null 자리표시), job 은 `extra_scene_image_jobs` 컬렉션에. 추가 업로드 이미지(최대 4장)는 이미 `/api/assets/upload` 로 올라간 object_name 들을 body 에 받음. |
| 1e | 〃 | L458~712 | `POST /{photo_id}/refine` | v15 멀티턴 — parent meta 의 chain_root_photo_id 그룹핑, image_model **lock**, parent meta 복사. | **B3 멀티턴 refine** 동일 패턴: 부모 `extra_videos` doc 의 meta.chain_root_video_id 그룹핑 + video_model lock + parent 의 source/prompt/preset 메타 일부 carry-over. |
| 1f | 〃 | L714~817 | `GET /{photo_id}/chain` | chain_root_photo_id 로 그룹 조회, created_at asc 정렬 | **B3 chain 조회**: `GET /extra-videos/{video_id}/chain` 동일 형태. 디테일 모달의 v1/v2/v3 타임라인용. |
| 1g | 〃 | L819~949 | `POST /download` (bulk ZIP) | 50장 한도, owner+admin, mv_job_id 일치 검증, MinIO 로드 실패 skip | **A/B 일괄 다운로드**: `POST /extra-scene-images/download`, `POST /extra-videos/download` (ZIP 으로 mp4 묶기). 50개 한도 동일. |
| 1h | 〃 | L955~1064 | `POST /bulk-delete` | 잡 doc + MinIO + (관련) jobs cleanup. failed 리스트 반환. | **A/B 일괄 삭제**: 신규 라우트 2개에 동일 구조. `extra_scene_image_jobs` / `extra_video_jobs` cleanup 포함. |
| 1i | 〃 | L1070~1367 | `_run_wedding_photo_generation` 백그라운드 | jobs → assets PNG 업로드 → done 마킹 | **A 백그라운드**: `_run_extra_scene_image_generation` 동일 흐름. PNG 생성은 `wedding_photo_generator.generate_wedding_photo` 가 아니라 신규 헬퍼 또는 `pre_mv_phase2_image_generator.generate_scene_image` 의 **API 호출부만** 추출해 재사용 (3-i 참조). |
| 2 | `backend_8000/app/routes/pre_mv.py` | L1862~1875 | `_put_scene_video_to_minio` | videos 버킷, `pre_mv/{id}/scenes/{N:03d}.mp4` 경로 | **B 영역**: 동일 패턴 — `extra/{mv_job_id}/videos/{id}.mp4` 경로로 신규 헬퍼 `_put_extra_video_to_minio` 작성. |
| 2b | 〃 | L1830 | `ALLOWED_VIDEO_MODELS = ("veo","kling","seedance","grok")` | 4종 lock 가능 | v23 동일 4종 그대로 사용. 라우트 body Literal 재선언. |
| 2c | 〃 | L1833~1859 | `_gate_video_model_key` | 모델별 API 키 503 게이팅 (google/kling/fal/xai) | 신규 라우트에 동일 헬퍼 사본. 환경변수 신규 추가 없음. |
| 2d | 〃 | L2022~2239 | `_run_single_scene_video` | 씬 단일 영상 백그라운드. 모델별 generate_scene_video_* 분기 (veo/kling/seedance/grok). 실패 isolation (다른 씬 영향 X). | **B 백그라운드**: `_run_extra_video_generation` 의 **변주 루프 안쪽 1회 단위**가 이와 동일 구조 (semaphore 로 변주 동시성 제어). 다만 v23 의 입력은 씬 doc 이 아니라 신규 doc shape — generator 호출부의 `scene` 인자에 들어갈 dict 만 어댑터로 만들어 주면 그대로 재사용 가능. |
| 2e | 〃 | L2086~2087 | Grok 만 image_bytes 가 None 이어도 OK 분기 | presigned URL 만 받음 | **B 영역 Grok 호출 시**: 직접 업로드 이미지든 A 결과 이미지든 MinIO 에 있어야 presigned 가능 — 즉 업로드 이미지도 우선 MinIO 에 put 한 뒤 그 object_name 으로 presigned. 이는 source_object_name 을 항상 MinIO 에 두는 정책으로 해결. |
| 3a | `backend_8000/app/services/pre_mv_veo_generator.py` | L1~50 | `_VEO_DURATION = 8` 고정, `predictLongRunning` payload 에 `referenceImages[0].image.bytesBase64Encoded` 1장 | **seed 파라미터 없음** (`parameters` 키: aspectRatio, durationSeconds 만) — 변주 N개 동시 생성 시 **같은 seed 가 강제됨** | v23 Veo: 변주 2/4 선택해도 **단일로 강제 다운그레이드** (라우트가 1로 클램프). UI 에서 "Veo 는 seed 미지원이라 단일만 가능" 안내. |
| 3b | `pre_mv_kling_generator.py` | L158~167 | `_start_kling` payload: model_name/prompt/mode/duration/aspect_ratio/sound/image_list. **seed 키 없음** | Kling Omni 가 결정적 — 동일 입력 결과 동일 (실측 9004 케이스) | v23 Kling: 변주 N개 만들려면 **prompt 에 미세 변주 문구를 자동 prepend** (예: "Take 1 — variation A: ...", "Take 2 — variation B: ..."). 또는 **단일로 강제 다운그레이드** + UI 안내. 결정: 안전을 위해 v23.2 는 **단일 강제**, v23.3 의 카메라 모션 프리셋 다중 선택과 결합해 사용자가 직접 변주를 작성하게 유도. |
| 3c | `pre_mv_seedance_generator.py` | L120~124 | `_start_seedance` body: prompt/image_url(data URI)/duration. seed 키 없음. | fal.ai Seedance 2.0 API 가 seed 인자를 받지만 (`seed: int`, 옵션) 현재 코드엔 미사용 | v23 Seedance: 변주 N개 = body 에 `"seed": random_int_per_variation` 추가하는 어댑터로 N번 호출. 단, **레거시 식전영상 경로엔 영향 X** — 신규 generator 함수 (`generate_extra_video_seedance` 또는 인자에 `seed: Optional[int]` 추가) 로 격리. |
| 3d | `pre_mv_grok_generator.py` | L147~155 | `_start_grok` body: model/prompt/image{url}/duration. xAI Grok Imagine Video 가 seed 인자 미지원 (공식 문서 기준 prompt+image+duration 3개만) | **seed 미지원** | v23 Grok: Veo 와 동일하게 변주 단일 강제. |
| 3 결론 | — | — | seed 지원 매트릭스 | veo: **X** / kling: **X** / seedance: **O(미사용)** / grok: **X** | **v23.2**: 모두 단일 변주(N=1)만 허용 — UI 에 변주 셀렉터 자체를 표시하지만 4개 모델 모두 1만 활성화. **v23.2.1(후속)**: Seedance 한정으로 N∈{1,2,4} 활성. **결정**: 첫 출시는 단순화를 위해 모든 모델 단일. 변주는 후속 sub-version 으로 분리. |
| 4 | `backend_8000/app/services/pre_mv_phase2_image_generator.py` | L227~471 | `generate_scene_image(pre_mv_job_id, scene_number, image_model, scene, owner_user_id)` | 시트 슬롯 ref + 장소/photo asset ref → Step A(Gemini text 합성) → Step B(gpt_image_2 또는 nb_pro) → PNG bytes 반환 | **A 영역 재사용 분석**: scene dict 에 `image_prompt/image_prompt_ko/ref_sheet_ids/ref_place_ids/story_slot` 만 들어가면 그대로 호출 가능. v23 의 A 영역은 (a) ref_sheet_ids = body 의 멘션 ref 중 sheet 타입의 slot 들, (b) ref_place_ids = 멘션 ref 중 place/wedding_photo 타입의 asset_id 들, (c) image_prompt = body.user_text + (옵션) 직접 업로드 ref 합성, (d) image_prompt_ko = body.user_text(원문). story_slot 은 빈 문자열로. **다만 직접 업로드 이미지 (최대 4장) 를 ref 로 보내려면 별도 경로 필요**: phase2 함수는 wedding_assets / character_sheets 의 ref 만 받는다. 따라서 신규 헬퍼 `generate_extra_scene_image(...)` 를 만들어 (1) 직접 업로드 object_name 들의 bytes 도 ref 풀에 합치고, (2) `_MAX_REFS=4` 한도 안에서 시트+장소+wedding_photo+업로드 합쳐 max 4장으로 클램프, (3) Step A/B 호출. 기존 phase2 의 Step A/B 코드 자체는 단순 함수 분리로 재사용 가능 (또는 신규 파일에 헬퍼 복사 — 안전한 격리). |
| 5 | `backend_8000/app/services/pre_mv_video_prompts.py` | L26~310 | `VIDEO_PROMPT_*_CHARACTER` 4종 system 템플릿 (Veo/Kling/Seedance/Grok) | 식전영상의 신랑+신부 동시 등장 보강 prefix + 모델별 후속 가이드 | **B 영역**: 추가영상은 신랑/신부 동시 등장이 강제 아님 (사용자가 시트 멘션을 선택적으로 사용). 따라서 prefix 의 "the bride and the groom" 강제는 제거하거나 약화. **결정**: 신규 헬퍼 `compose_extra_video_prompt(...)` 를 같은 모듈에 추가 (또는 별도 모듈 `extra_video_prompts.py`). 식전영상용 `compose_video_prompt` 는 무수정 (회귀 보호). |
| 5b | 〃 | L344~461 | `compose_video_prompt(video_model, scene, duration)` | scene dict 의 image_prompt/description/video_prompt + duration | v23 의 `scene` 어댑터: body.user_prompt 를 description 으로, body.camera_prompt(프리셋 합성 결과)를 video_prompt 로, image_prompt 는 source 이미지의 alt 텍스트(또는 빈 문자열). 변경 없이 호출 가능 — 다만 reinforcement_for_scene 의 "두 인물" 검사가 ref_sheet_ids 기반이라 ref_sheet_ids=[] 면 단수 표현으로 떨어짐. 검증 OK. |
| 5c | 〃 | L492~527 | `sanitize_for_seedance(prompt)` | 안전 어휘 치환 | Seedance 경로에서 그대로 사용 (재사용). |
| 6 | `backend_8000/app/services/pre_mv_phase4_compositor.py` | L40~52 | `get_ffmpeg_path()`, `ffmpeg_available()` | shutil.which → imageio_ffmpeg fallback | **B4 이어붙이기** 마지막 프레임 추출에 그대로 사용. 신규 헬퍼 `extract_last_frame_png(video_object_name) -> bytes` 가 이 ffmpeg 바이너리로 `ffmpeg -sseof -0.5 -i in.mp4 -vframes 1 -f image2 out.png` 실행. |
| 7 | `backend_8000/app/routes/mv.py` | L200~286 | `GET /api/mv/jobs/{job_id}/context` | owner+admin, owner_user_id + owner_sheets[4슬롯] + owner_places + wedding_photos(이 mv_job 의 type=wedding_photo) | **A 영역 멘션 풀**: 이 응답 그대로 사용 → 시트 4종 + 장소 + 웨딩사진 결과 모두 멘션 가능. wedding_photos 는 `meta.mv_job_id` 필터로 이 작품의 결과만. **응답 shape 변경 없음** — v23 라우트가 별도로 호출. |
| 8 | `frontend/src/pages/GenerationStatusPage.jsx` | L8~9, L273~322 | `const TAB_PHOTO='photo'; const TAB_PRE_MV='pre_mv';` + `<button role="tab">` 2개 | `isMusicReady` 일 때만 2탭 노출, 그 외는 WeddingPhotoPanel 단독 | **탭 추가**: `TAB_EXTRA = 'extra'` 상수 + 세 번째 `<button>` "추가영상생성" + `{activeTab === TAB_EXTRA && <ExtraVideoStudioPanel mvJobId={id} ownerUserId={job.user_id} mvJob={job} />}` 한 줄. isMusicReady 분기 안에 위치 (식전영상 탭과 동일 게이트). |
| 9 | `frontend/src/components/WeddingPhotoPanel.jsx` | L43~71 + L73~225 | 권한 가드 + 멘션 옵션 풀 (`useMemo` mentionOptions), context API 호출, polling 패턴 | 자산 멘션 풀 빌드 패턴 (sheet/place 두 그룹) | **참고**: v23 의 A 영역에서 `mentionOptions` 빌드 시 wedding_photo 그룹을 추가 (사양). type='wedding_photo' 옵션을 group_label='💑 웨딩사진'으로 push. **그 외 모든 패턴**(권한 가드, polling 5s, localStorage activeJobIds, 일괄 선택, ZIP 다운로드, 디테일 모달 등) 동일하게 차용. WeddingPhotoPanel 본체 무수정. |
| 10 | `frontend/src/components/PreCeremonyMVPanel.jsx` | L68~79 + L657~810 | VIDEO_MODELS 상수 + 영상 모델 선택 + regenerate-video polling | 영상 모델 4종 라벨 / 잡 단위 lock 패턴 | **참고**: v23 B 영역에서 동일 4종 라벨 그대로 import. **PreCeremonyMVPanel 무수정**. |
| 11 | `frontend/src/components/MentionField.jsx` | L1~120 | `value/refs/onChange/onChangeRefs/options` props, group_label 지원 | 칩 하이라이트 + @-팝업, reconcileRefs 자동 보정 | **재사용 OK** — A 영역(자유 텍스트 + 자산 멘션) 및 B 영역(연출 프롬프트) 텍스트박스에 그대로 사용. options 풀만 다르게 구성. |
| 12 | `frontend/src/api/index.js` | L188~247, L259~350 | wedding-photos + pre-mv API 함수들 + sheetPreviewUrl/downloadAssetByObjectName 헬퍼 | 잡 fire-and-poll 패턴 통일 | **신규 함수 추가 위치**: L247 (wedding-photos 블록 끝) 다음에 `// v23 — Extra video studio (Higgsfield-style)` 블록. 또는 파일 끝 `getSharedMV` 직전. 함수명은 §5 매트릭스 참조. |

### 3. sub-version 분할 권고

한 라운드는 너무 큼 — 다음 5개로 분할:

**v23.0 — 인프라**
- `extra_scene_images` / `extra_scene_image_jobs` / `extra_videos` / `extra_video_jobs` 4개 컬렉션 + 인덱스(ensure_indexes 추가).
- 라우터 골격 2개 (`routes/extra_scene_images.py`, `routes/extra_videos.py`) — 권한 가드 + serialize 헬퍼만, 잡 로직은 placeholder (501).
- main.py 에 include_router 2줄.
- frontend `api/index.js` 함수 스켈레톤 (실제 호출은 v23.1 부터 활성).
- `GenerationStatusPage.jsx` 의 [추가영상생성] 탭 버튼 + `ExtraVideoStudioPanel.jsx` 빈 컨테이너 컴포넌트 (탭 클릭 시 "준비 중" 표시).
- 회귀 보호: 기존 4 패널/탭 무수정 확인.

**v23.1 — A 씬 이미지 만들기**
- `POST /api/mv/jobs/{mv_job_id}/extra-scene-images/generate` + `GET /jobs/{id}` (폴링) + `GET /` (갤러리) + `GET /{id}` (디테일) + `DELETE /{id}` (단일 삭제) + `POST /download` (ZIP) + `POST /bulk-delete`.
- 백그라운드 잡 `_run_extra_scene_image_generation`.
- A 영역 컴포넌트 — 멘션 풀(시트+장소+wedding_photo 3그룹), 직접 업로드(최대 4장, `/api/assets/upload?kind=photo` 재사용), 모델 셀렉터, 폼 submit, 폴링, 갤러리, 단일/일괄 다운로드/삭제, 디테일 모달.
- 카드 [📹 이걸로 영상 만들기] 버튼 — 클릭 시 B 영역의 "씬 이미지 가져오기" 셀렉터를 자동 채우는 prop 콜백(상위 패널 상태로 lift up).

**v23.2 — B 씬 영상 만들기 (기본)**
- `POST /api/mv/jobs/{mv_job_id}/extra-videos/generate` + `GET /jobs/{id}` 폴링 + `GET /` 갤러리 + `GET /{id}` 디테일 + `DELETE /{id}` + `POST /download` + `POST /bulk-delete`.
- 백그라운드 잡 — 소스 이미지 2 모드(A 결과 가져오기 / 직접 업로드 → MinIO put), 모델 4종 분기, 클립 길이 클램프.
- 변주 N개: 첫 출시는 **N=1 고정** (모든 모델). 변주 셀렉터는 UI 만 만들고 비활성화 + 툴팁 "현재 단일 변주만 지원, 추후 모델별 활성화 예정".
- B 영역 컴포넌트 — 소스 이미지 picker(A 결과 셀렉터 + 직접 업로드 토글), MentionField 프롬프트, 모델 라디오, 길이 슬라이더(모델별 min/max), 갤러리, 카드별 [재생/다운로드/삭제].

**v23.3 — 카메라 모션 프리셋 + 멀티턴 refine**
- 카메라 모션 프리셋 11개 → 클릭 시 프롬프트 텍스트박스에 영문 한 줄 자동 prepend (다중 선택 가능, 다시 클릭 시 토글 off).
- `POST /api/mv/jobs/{mv_job_id}/extra-videos/{video_id}/refine` (v15 패턴) — parent doc 의 chain_root_video_id + video_model lock + source 이미지는 parent 의 source 와 동일하게.
- `GET /api/mv/jobs/{mv_job_id}/extra-videos/{video_id}/chain` (chain 조회) — created_at asc.
- 카드 [🔄 추가 수정] 버튼 + 디테일 모달의 chain 타임라인.

**v23.4 — 영상 이어붙이기 (Continue)**
- 신규 서비스 `services/extra_video_frame.py::extract_last_frame_png(object_name) -> bytes` (ffmpeg `-sseof -0.5 -i in.mp4 -vframes 1 -f image2 -frames:v 1 out.png`).
- `POST /api/mv/jobs/{mv_job_id}/extra-videos/{video_id}/continue` — parent 영상의 마지막 프레임을 추출 → MinIO `extra/{mv_job_id}/continue_frames/{new_id}.png` put → 새 잡 시작 (source_kind="prev_video_last_frame", parent_video_id 저장, **chain_root_video_id 는 비움 — refine 과 다른 경로**).
- 카드 [▶ 이어붙이기] 버튼 + 디테일에 parent 영상 미리보기.

(변주 N개 활성은 별도 v23.2.1 — Seedance 한정 N∈{1,2,4} — 후속 PR. 본 분할에 포함 안 함.)

### 4. 데이터 모델

#### 4-A. `extra_scene_images` (자산 컬렉션 — 정답 PNG 한 장당 1 doc)

| 필드 | 타입 | 의미 |
|---|---|---|
| `_id` | ObjectId | 사전 발급 |
| `user_id` | str | owner (asset owner = mv_job owner) |
| `mv_job_id` | str | 부모 작품 |
| `object_name` | str / null | MinIO 키 (`extra/{mv_job_id}/scene_images/{_id}.png`). 잡 완료 전 null. |
| `image_model` | str | "gpt_image_2" / "nb_pro" |
| `user_text` | str | 자유 텍스트 프롬프트 원문 |
| `user_text_refs` | list[MentionRef] | @-멘션 메타 (type∈{sheet,place,wedding_photo}) |
| `uploaded_ref_object_names` | list[str] (≤4) | 직접 업로드 ref 들의 MinIO 키 |
| `created_at` / `updated_at` | datetime | — |

인덱스: `(mv_job_id, created_at desc)`, `(user_id, created_at desc)`.

#### 4-B. `extra_scene_image_jobs` (잡 상태 — fire-and-poll 추적)

| 필드 | 타입 | 의미 |
|---|---|---|
| `_id` | ObjectId | photo_job_id |
| `mv_job_id` | str | 부모 작품 |
| `owner_user_id` | str | 자산 owner |
| `requested_by_user_id` | str | 호출자 (admin 의 경우 owner 와 다를 수 있음) |
| `status` | str | "queued" / "running" / "done" / "failed" |
| `image_model` | str | 잡 단위 |
| `user_text`, `user_text_refs`, `uploaded_ref_object_names` | (위와 동일) | 잡 시점 스냅샷 |
| `image_id` | str | 사전 발급된 `extra_scene_images._id` |
| `image_object_name` | str / null | 완료 시점에 채움 |
| `error_message` | str / null | 실패 시 사유 |
| `created_at` / `updated_at` | datetime | — |

인덱스: `(mv_job_id, status)`, `(image_id)`.

#### 4-C. `extra_videos` (자산 컬렉션 — mp4 한 영상당 1 doc)

| 필드 | 타입 | 의미 |
|---|---|---|
| `_id` | ObjectId | 사전 발급 |
| `user_id` | str | owner |
| `mv_job_id` | str | 부모 작품 |
| `object_name` | str / null | MinIO 키 (`extra/{mv_job_id}/videos/{_id}.mp4`). |
| `video_model` | str | "veo"/"kling"/"seedance"/"grok" |
| `duration_sec` | float | 최종 길이 (clamp + trim 후) |
| `source_kind` | str | "scene_image" / "uploaded" / "prev_video_last_frame" |
| `source_scene_image_id` | str / null | extra_scene_images._id (source_kind="scene_image") |
| `source_uploaded_object_name` | str / null | (source_kind="uploaded") |
| `source_frame_object_name` | str / null | (source_kind="prev_video_last_frame") |
| `user_prompt` | str | 사용자 자유 텍스트 (연출) |
| `user_prompt_refs` | list[MentionRef] | @-멘션 (옵션) |
| `camera_motion_presets` | list[str] | 선택한 프리셋 키들 (예: ["zoom_in","pan_left"]) |
| `composed_prompt` | str | 최종 호출 prompt (감사·재현용) |
| `seed` | int / null | Seedance 변주용 (v23.2.1 부터). v23.2 는 null. |
| `variation_group_id` | str / null | 같은 클릭에서 만든 변주 묶음 id. v23.2 는 항상 null (단일). |
| `variation_index` | int / null | 같은 그룹 내 순번 (1-based). v23.2 는 null. |
| `based_on_video_id` | str / null | refine 부모 (B3) |
| `chain_root_video_id` | str / null | refine 체인 그룹핑 (v15 패턴) |
| `parent_video_id` | str / null | continue (B4) 의 직전 영상 (refine 과 다른 키) |
| `refine_request` | str / null | 후속 지시 (B3) |
| `refine_request_refs` | list[MentionRef] | (B3) |
| `error_message` | str / null | (잡 실패 시 자산도 남기되 에러를 마킹할 수도 있음 — 정책: 자산은 잡 완료 시에만 object_name 채움, 실패 시 자산 doc 삭제 → 단순화) |
| `created_at` / `updated_at` | datetime | — |

인덱스: `(mv_job_id, created_at desc)`, `(user_id, created_at desc)`, `(chain_root_video_id)`, `(parent_video_id)`.

#### 4-D. `extra_video_jobs`

`extra_scene_image_jobs` 와 동일 구조 + `video_id`(자산 id), `video_object_name`(완료 시), `source_kind`/`source_*`/`camera_motion_presets`/`based_on_video_id`/`parent_video_id`/`seed`/`variation_*` 필드 carry.

인덱스: `(mv_job_id, status)`, `(video_id)`.

### 5. REST API 매트릭스

prefix: `/api/mv/jobs/{mv_job_id}/extra-scene-images` (이하 ESI), `/api/mv/jobs/{mv_job_id}/extra-videos` (이하 EV).
모든 엔드포인트는 owner OR admin 가드(`_resolve_mv_job` 사본).

| Method | Path | Body | 응답 |
|---|---|---|---|
| POST | ESI `/generate` | `{image_model, user_text, user_text_refs[], uploaded_ref_object_names[≤4]}` | `{image_id, job_id, status:"queued"}` |
| GET | ESI `/jobs/{photo_job_id}` | — | `{job_id, image_id, status, image_model, object_name?, preview_url?, error_message?, created_at, updated_at}` |
| GET | ESI `/` | — | `{items:[{image_id, object_name, preview_url, meta, created_at},...]}` (이 mv_job 의 모든 자산) |
| GET | ESI `/{image_id}` | — | 디테일 (자산 + 사용 ref 펼침) |
| DELETE | ESI `/{image_id}` | — | `{deleted:true}` |
| POST | ESI `/download` | `{image_ids[1~50]}` | application/zip 스트림 |
| POST | ESI `/bulk-delete` | `{image_ids[1~50]}` | `{deleted_count, failed:[{image_id, reason}]}` |
| POST | EV `/generate` | `{video_model, source_kind, source_scene_image_id?, source_uploaded_object_name?, user_prompt, user_prompt_refs[], camera_motion_presets[], duration_sec, variation_count(1\|2\|4)}` | `{video_ids:[...], job_ids:[...], status:"queued", variation_group_id?}` (v23.2 는 ids 길이 1 고정) |
| GET | EV `/jobs/{video_job_id}` | — | (위와 유사) |
| GET | EV `/` | — | `{items:[...]}` |
| GET | EV `/{video_id}` | — | 디테일 |
| DELETE | EV `/{video_id}` | — | `{deleted:true}` |
| POST | EV `/download` | `{video_ids[1~20]}` (영상은 큼) | application/zip 스트림 |
| POST | EV `/bulk-delete` | `{video_ids[1~20]}` | (위와 유사) |
| POST | EV `/{video_id}/refine` | `{refine_request(1~1000), refine_request_refs[], camera_motion_presets[]?, duration_sec?}` | `{video_id(new), job_id, status:"queued"}` — video_model 은 parent lock |
| GET | EV `/{video_id}/chain` | — | `{items:[...]}` created_at asc |
| POST | EV `/{video_id}/continue` | `{video_model?, user_prompt?, camera_motion_presets[]?, duration_sec?}` (생략 시 parent 와 동일) | `{video_id(new), job_id, status:"queued", source_frame_object_name}` |

(스트리밍/preview 는 기존 `/api/character/preview/{object_name}` 라우트가 photos 버킷 prefix 기반 — videos 버킷용은 별도 필요. **결정**: v23.0 에서 `/api/mv/jobs/{mv_job_id}/extra-videos/{video_id}/stream?token=...` StreamingResponse 추가. 이미지(PNG)는 photos 버킷 prefix `extra/...` 도 기존 preview 라우트가 광역 prefix 라면 그대로 사용 가능 — 0단계 검증 시 character preview 라우트의 prefix 화이트리스트 확인 필요. **v23.0 PLAN 의 검증 항목**으로 표시.)

### 6. 변경 매트릭스

| 파일 | 변경 | 로그 prefix |
|---|---|---|
| `backend_8000/app/routes/extra_scene_images.py` | 신규 | `[ExtraSceneImageRoute]` / `[ExtraSceneImageJob]` |
| `backend_8000/app/routes/extra_videos.py` | 신규 | `[ExtraVideoRoute]` / `[ExtraVideoJob]` |
| `backend_8000/app/services/extra_scene_image_generator.py` | 신규 — phase2 의 Step A/B 패턴 차용 + 직접 업로드 ref 합성 | `[ExtraSceneImage]` |
| `backend_8000/app/services/extra_video_generator.py` | 신규 — 4 모델 dispatcher 래퍼 (기존 generate_scene_video_* 함수에 어댑터 scene dict 만들어 위임). 변주 N개 루프(v23.2 는 N=1 고정). | `[ExtraVideo]` |
| `backend_8000/app/services/extra_video_frame.py` | 신규 (v23.4) — `extract_last_frame_png(video_object_name) -> bytes` | `[ExtraVideoFrame]` |
| `backend_8000/app/services/extra_video_prompts.py` | 신규 — `compose_extra_video_prompt(video_model, source_caption, user_prompt, camera_preset_lines, duration)` + `CAMERA_MOTION_PRESETS` 매핑 | `[ExtraVideoPrompt]` |
| `backend_8000/app/database/mongodb.py::ensure_indexes` | 4 컬렉션 인덱스 추가 (위 §4 인덱스) | `[Startup]` |
| `backend_8000/app/main.py` | include_router 2줄 (extra_scene_images, extra_videos) + routes import 갱신 | — |
| `backend_8000/app/routes/character.py` (또는 preview 라우트) | preview 라우트의 object_name prefix 화이트리스트에 `extra/` 추가 (검증 후 — 이미 자유롭게 받는다면 무변경) | — |
| `frontend/src/components/ExtraVideoStudioPanel.jsx` | 신규 — 권한 가드 + A/B 두 영역 컨테이너 | `[ExtraStudioPanel]` |
| `frontend/src/components/ExtraSceneImageSection.jsx` | 신규 (v23.1) — A 영역 | `[ExtraSceneImageSection]` |
| `frontend/src/components/ExtraVideoSection.jsx` | 신규 (v23.2) — B 영역 | `[ExtraVideoSection]` |
| `frontend/src/components/ExtraVideoDetailModal.jsx` | 신규 (v23.3) — chain 타임라인 / continue parent 미리보기 | `[ExtraVideoDetailModal]` |
| `frontend/src/components/CameraMotionPresets.jsx` | 신규 (v23.3) — 11개 칩 토글 | `[CameraMotionPresets]` |
| `frontend/src/api/index.js` | 신규 함수 약 16개 (위 §5 매트릭스 1:1 매핑) | — |
| `frontend/src/pages/GenerationStatusPage.jsx` | `TAB_EXTRA` 상수 + 탭 버튼 + panel 마운트. **다른 코드 무수정** | `[GenStatus]` (기존) |

### 7. AI 모델 한계 점검

| 모델 | seed 지원 | 변주 N>1 전략 | 클립 길이 | image-to-video 입력 |
|---|---|---|---|---|
| Veo 3.1 | **X** (parameters: aspectRatio, durationSeconds 만) | 단일 강제 (N>1 선택 시 1 로 클램프) | 8s 고정 (그 미만은 ffmpeg trim) | base64 referenceImages[0] |
| Kling 3.0 Omni | **X** (body 스키마에 seed 키 없음, 결정적) | 단일 강제 | 3~15s 정수 | image_list[0].image_url (base64) |
| Seedance 2.0 (fal.ai) | **O** (fal.ai 문서 `seed:int`) — 현재 코드 미사용 | v23.2 단일 / v23.2.1 N∈{1,2,4} 활성 | 5~15s 정수 | data:image/png;base64 (image_url) |
| Grok Imagine Video (xAI) | **X** | 단일 강제 | 1~10s 정수 | presigned URL (`image.url`) |

**ffmpeg 의존성**: 이미 `pre_mv_phase4_compositor.get_ffmpeg_path()` 가 PATH → imageio_ffmpeg fallback 으로 보장. v23.4 의 마지막 프레임 추출, v23.2 의 영상 trim 모두 이 헬퍼 재사용.

**환경변수 신규 추가 없음**: GOOGLE_API_KEY / KLING_ACCESS_KEY+SECRET / FAL_API_KEY / XAI_API_KEY / OPENAI_API_KEY 모두 기존 사용 키.

### 8. 회귀 위험

| # | 위험 | 영향 범위 | 완화 |
|---|---|---|---|
| 1 | **`pre_mv_video_prompts.compose_video_prompt` 식전영상 호환** | v17 식전영상 영상 모델 호출이 바뀌면 기존 작품 영향 | 본 함수 **무수정**. v23 은 신규 `compose_extra_video_prompt` 만 추가. |
| 2 | **`pre_mv_phase2_image_generator.generate_scene_image` 시그니처 변경** | 식전영상 Phase 2 회귀 | 본 함수 **무수정**. v23 은 신규 `generate_extra_scene_image` 만 추가 (내부에서 Step A 의 system prompt 와 image-model 분기 로직을 _복사_ 또는 _공통 헬퍼 추출_). 안전 우선 → 일단 복사. |
| 3 | **각 영상 generator 의 시그니처 변경** | 식전영상 Phase 3 회귀 | 본 함수 **무수정**. v23 generator 어댑터는 기존 `generate_scene_video_{veo,kling,seedance,grok}` 의 `scene` 인자에 어댑터 dict 만 만들어서 그대로 호출. **단** Seedance 의 seed 활성(v23.2.1)은 신규 wrapper 함수 (`generate_extra_video_seedance_with_seed`) 추가 권고 — 식전영상 경로 무관. |
| 4 | **`/api/character/preview/{object_name}` 가 `extra/...` prefix 거부 가능성** | A/B 갤러리에서 이미지가 표시되지 않음 | v23.0 0단계에서 preview 라우트의 화이트리스트/owner 검증 코드 확인. 거부하면 prefix 추가 또는 별도 `/api/mv/jobs/{id}/extra-scene-images/{id}/preview` 라우트 작성. |
| 5 | **videos 버킷 스트리밍 라우트 부재** | B 영역 영상 재생 안 됨 | v23.0 에서 EV `/{video_id}/stream` StreamingResponse 추가 (audio_stream 패턴 차용). |
| 6 | **wedding_photo 멘션 자산이 v8 의 StoryWizardPage 풀에 노출 안 되도록 명시** | v17 회귀 위험 #3 | v23 은 **별도 패널**에서만 멘션 풀에 wedding_photo 포함. StoryWizardPage 풀 빌더 무수정. |
| 7 | **GenerationStatusPage 탭 추가로 인한 음악 플레이어/가사 토글(v22) 영향** | v22 회귀 | 탭 영역 외부의 `<audio>` + `<LyricsTimestampToggle>` 마크업 무수정. |
| 8 | **`wedding_assets` 컬렉션 폐오염 방지** | 갤러리/디테일 오인 | v23 자산은 별도 컬렉션(`extra_scene_images`, `extra_videos`) — `wedding_assets` 에 어떤 write 도 하지 않음. |
| 9 | **owner 가 admin 으로 등급 변경된 경우** | 가드 일관성 | `_resolve_mv_job` 로 owner+admin 모두 허용 — 기존 패턴 동일. |
| 10 | **아이템관리(v18/v20) 영향** | 별도 컬렉션 사용으로 무관 | 무영향 확인. |

### 9. 테스트 항목 (sub-version 별)

**v23.0**
- pytest: `extra_scene_images` / `extra_videos` 인덱스가 startup 시 생성됨 (`db.list_indexes()`).
- 라우터 골격이 401/403/501 만 반환 (잡 placeholder).
- `[추가영상생성]` 탭 클릭 시 "준비 중" 메시지 노출. 다른 탭/플레이어 정상.

**v23.1**
- A 영역 폼: 멘션 풀에 시트 + 장소 + 웨딩사진(이 작품의 결과만) 노출.
- 직접 업로드: 1~4장 첨부 후 generate → 잡 queued → 5초 폴링 → done → PNG 표시.
- 모델 분기: gpt_image_2 / nb_pro 둘 다 200, 키 없으면 503.
- 갤러리: 단일 다운로드 / 단일 삭제 / 일괄 선택 모드 ZIP 다운로드 + bulk delete + failed 리스트.
- 권한: 다른 사용자 토큰 403. admin 토큰 200.
- 회귀: 웨딩사진/식전영상 탭 영향 없음.

**v23.2**
- B 영역 폼: 소스 이미지 picker 두 모드. A 결과 셀렉터에 v23.1 산출물만 노출.
- 직접 업로드: photos 버킷에 put 되고 그 object_name 으로 generator 호출 → 4 모델 모두 mp4 산출.
- 길이 슬라이더: Veo 8 고정, Kling 3~15, Seedance 5~15, Grok 1~10. 범위 밖은 클램프.
- 변주 셀렉터: UI 표시 but 비활성(disabled + 툴팁).
- 카드: 재생/다운로드/삭제 ok. 모델 키 없으면 503.
- 회귀: 식전영상 Phase 3 동일 영상 동일 결과 (체크리스트).

**v23.3**
- 카메라 모션 11개 칩 — 다중 선택/해제 → prompt 텍스트박스 상단에 프리셋 문장 자동 prepend/제거.
- refine: parent 영상 카드 [🔄 추가 수정] → 모달 → 후속 지시 입력 → 잡 queued → 완료 시 chain 타임라인에 v2 추가.
- video_model lock: refine body 에 다른 모델 보내도 parent 모델로 강제 (warning 로그).
- chain API: created_at asc 정렬 확인.
- 카메라 프리셋 문구가 실제 호출 prompt 에 포함되는지 (`composed_prompt` 필드로 확인).

**v23.4**
- continue: parent 영상에서 ffmpeg 로 마지막 프레임 png 추출 → 새 잡의 source_kind="prev_video_last_frame".
- chain_root_video_id 와 parent_video_id 분리 확인 (refine 과 continue 의 구분).
- 디테일 모달에 parent 영상 미리보기 + "이어붙이기 결과입니다" 뱃지.

### 10. 운영 환경변수

**신규 환경변수 없음.** 기존 키 모두 재사용:

- `OPENAI_API_KEY` — gpt_image_2 (placeholder: `sk-...`)
- `GOOGLE_API_KEY` — nb_pro + Veo 3.1 (placeholder: `AIza...`)
- `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` — Kling Omni
- `FAL_API_KEY` — Seedance 2.0
- `XAI_API_KEY` — Grok Imagine Video
- `MINIO_*`, `MONGO_*` — 기존 그대로
- `MINIO_BUCKET_PHOTOS` / `MINIO_BUCKET_VIDEOS` — 기존 그대로 (extra/* prefix 만 추가)

ffmpeg 는 `imageio_ffmpeg` fallback 으로 자동 — Dockerfile/requirements 무변경.

### 11. 민감 정보 보호

모든 라우트/서비스 로그는 다음 규칙 준수 (식전영상 v17.3 패턴 차용):

- API 키 본문 출력 금지. 게이팅 실패 시 "{model} API 키가 설정되지 않았습니다" 로 사용자 메시지만.
- 사용자 텍스트는 길이만 (`text_len=%d`), 본문은 로그하지 않음. dev 모드 console.info 도 동일.
- presigned URL 은 길이만 (`image_url_len=%d`), 토큰 본체 미출력.
- JWT(Kling) 은 길이만.
- 백엔드 응답에 키 echo 금지.
- 문서/PLAN.md 내 키 표기는 모두 placeholder (`sk-...`, `AIza...` 등). 실키 절대 포함 금지.

### 12. 작업 지시 요약 (backend-dev / frontend-dev)

**backend-dev**
- **v23.0**: mongodb.py 에 4 컬렉션 인덱스 추가, `routes/extra_scene_images.py` + `routes/extra_videos.py` 빈 스켈레톤(라우터 등록 + `_resolve_mv_job` 사본 + serialize 헬퍼만), main.py include_router 2줄, EV `/stream` 엔드포인트 작성, character preview 라우트의 `extra/` prefix 화이트리스트 확인·수정.
- **v23.1**: `services/extra_scene_image_generator.py` 작성 (phase2 의 Step A 시스템 prompt + Step B 이미지 모델 분기 패턴 복사 + 직접 업로드 ref bytes 결합 + _MAX_REFS=4 클램프). `extra_scene_images.py` 의 7 엔드포인트 구현 (wedding_photos.py L224~452 + L819~949 + L955~1064 패턴 미러).
- **v23.2**: `services/extra_video_generator.py` 작성 (4 모델 dispatcher, 어댑터 scene dict 빌더, 변주 루프는 N=1 고정). `services/extra_video_prompts.py` 작성 (compose_extra_video_prompt + CAMERA_MOTION_PRESETS 매핑). `extra_videos.py` 의 7 엔드포인트 구현. source_kind 별 소스 이미지 로딩 분기.
- **v23.3**: `extra_videos.py` 에 `POST /{video_id}/refine` + `GET /{video_id}/chain` 추가 (wedding_photos.py L458~712 + L714~817 패턴 미러). video_model lock 로그 prefix `[ExtraVideoRoute]`.
- **v23.4**: `services/extra_video_frame.py::extract_last_frame_png` 작성 (phase4_compositor.get_ffmpeg_path 재사용). `extra_videos.py::POST /{video_id}/continue` 엔드포인트 추가.

**frontend-dev**
- **v23.0**: `GenerationStatusPage.jsx` 에 TAB_EXTRA 상수 + 탭 버튼 + ExtraVideoStudioPanel 마운트 (식전영상 탭 패턴 미러). 빈 `ExtraVideoStudioPanel.jsx` 권한 가드 외피만. `api/index.js` 에 16개 함수 스켈레톤(엔드포인트는 v23.0 라우트, 호출은 v23.1 부터 활성).
- **v23.1**: `ExtraSceneImageSection.jsx` 작성 (WeddingPhotoPanel.jsx L43~1010 패턴 미러 — 멘션 풀에 wedding_photo 그룹 추가, 직접 업로드 multi 4장, 5s 폴링, 일괄 선택/다운로드/삭제). 디테일 모달은 v23.3 까지 단순 thumbnail 만.
- **v23.2**: `ExtraVideoSection.jsx` 작성 (B 영역 — 소스 picker 2모드, MentionField 프롬프트, 모델 라디오 4종 with VIDEO_MODELS import, 길이 슬라이더 모델별 min/max, 변주 비활성 셀렉터). A 카드 [📹 이걸로 영상 만들기] 클릭 시 B 영역 sourceSceneImageId 자동 채움 (lift up via callback prop).
- **v23.3**: `CameraMotionPresets.jsx` (11개 칩, 다중 선택, 영문 문장 매핑은 frontend 상수). `ExtraVideoDetailModal.jsx` (chain 타임라인). 카드 [🔄 추가 수정] 버튼 + 모달.
- **v23.4**: 카드 [▶ 이어붙이기] 버튼 + confirm + continue API 호출. 디테일 모달에 parent 영상 미리보기.

### 13. 위험·갭

| # | 위험·갭 | 권고 |
|---|---|---|
| G1 | **Kling 의 변주 한계** — body 에 seed 키가 없어 동일 입력 → 동일 결과. 사용자 사양은 "변주 N개 동시 생성"인데 Kling 만 의미적 변주 불가. | v23.2 는 모든 모델 단일 강제. UI 에 "현재 단일만 지원" 명시. 후속 v23.2.1 에서 Seedance 한정 활성. |
| G2 | **Veo seed 미지원** — Kling 과 동일 문제. | 동상. |
| G3 | **Grok 의 presigned URL 정책** — 직접 업로드 이미지도 MinIO put → presigned 발급 필요. presigned URL 발급에서 expires 가 1시간 — Grok 잡이 1시간 넘게 polling 되면 만료. | 호출 시점 직전 presign + polling 중 만료 가능성 모니터링. v23.2 검증 항목. |
| G4 | **`/api/character/preview/{object_name}`** 라우트가 `extra/` prefix 를 받는지 미확인 (코드 검증 못함). | v23.0 의 0단계에서 `routes/character.py` (또는 어디 정의됐든) preview 핸들러 확인. 거부 시 prefix 화이트리스트 추가 또는 별도 preview 라우트. |
| G5 | **B4 continue 의 마지막 프레임 신뢰성** — 어떤 codec/keyframe 위치인지에 따라 `-sseof -0.5` 가 frame 을 못 잡을 수도. | 1차 시도 실패 시 `-vf "select=eq(n\,N-1)"` 로 fallback. v23.4 의 헬퍼에서 처리. |
| G6 | **변주 그룹 디스플레이** — variation_group_id 가 같은 영상을 한 묶음 카드로 그리는 UX vs 개별 카드. | v23.2 가 단일이라 무의미. v23.2.1 에서 결정. |
| G7 | **`extra_videos.refine` 의 source 이미지 정책** — parent 영상의 source 가 "prev_video_last_frame" 인 경우 refine 의 source 는 무엇? | 정책: refine 의 source 는 parent 영상의 source 와 동일하게 carry (parent.source_scene_image_id 또는 parent.source_uploaded_object_name 또는 parent.source_frame_object_name). source_kind 도 carry. |
| G8 | **응답 시간** — gpt_image_2 + 4ref 5~10분, Veo 30~120s, Kling 1~5분, Seedance 1~3분, Grok 30~90s. polling 부하 — 5s 간격 + activeJobIds 다수일 때 동시 polling. | WeddingPhotoPanel 가 이미 같은 수준 부하 처리 — 패턴 재사용으로 무영향. |
| G9 | **wedding_photo 멘션이 식전영상 phase2 의 fallback 과 충돌하는가** — v23 A 영역에서 wedding_photo 를 ref 로 보내면 wedding_assets type=wedding_photo 의 object_name 이 ref bytes 로 들어감. phase2 의 `_resolve_asset_ref` 가 type=wedding_photo 허용 — OK. | 신규 `generate_extra_scene_image` 도 동일 정책. |
| G10 | **PLAN 분량** — 한 라운드 코드 변경량이 큼 (백 라우터 2 + 서비스 4, 프론트 컴포넌트 5 + api 16 함수). | sub-version 5개로 강제 분할 (§3). 한 sub-version 당 PR 1개 권고. |

### v23 작업 끝(append).

## v24 — 2026-05-29 — 식전영상 Phase 2/3 일관성 (챕터 안 체인 + FFLF)

> 목적: Phase 2 의 같은 챕터(=연속된 동일 `story_slot`) 안 두 번째 이후 씬에 **이전 씬 이미지**를 ref 로 추가해 외형 일관성을 강화하고, Phase 3 에서는 같은 챕터 안 컷이 **이전 영상 마지막 프레임 → 다음 씬 이미지** 로 이어지도록(=FFLF, First-Frame/Last-Frame) 모델별 파라미터 분기를 적용. 챕터끼리는 그대로 컷 전환·병렬.

### 1) 요구사항 요약 (사용자 합의)

1. Phase 2 — 같은 `story_slot` 안 둘째·셋째 씬은 ref 에 **이전 씬 이미지 1장** 추가.
2. Phase 2 ref 우선순위 (c안): **시트 2 + 이전 씬 1 + 장소 1 = 4장**, `wedding_photo` 는 양보(자리 없으면 미첨부). `_MAX_REFS=4` 유지.
3. 챕터 첫 씬은 carry 안 함 (이전 ref 없음 → 기존 패턴 그대로).
4. 챕터끼리는 병렬, 챕터 안은 **직렬** (이전 씬 image_status=completed 후 다음 진입).
5. Phase 3 — 같은 챕터 안 둘째 이후 씬은 시작 프레임 = **이전 씬 영상의 마지막 프레임**(ffmpeg 추출, v23.4 `extract_last_frame_png` 헬퍼 재사용), 끝 프레임 = **Phase 2 가 만든 이번 씬 이미지**.
6. 챕터 첫 씬은 기존대로 Phase 2 이미지 1장만 시작 프레임. 챕터 마지막 씬은 끝 프레임 자유.
7. 모델별 분기:
   · Veo 3.1 — Gemini `predictLongRunning` payload 에 `instances[0].lastFrame.inlineData` 추가 (검색 확정).
   · Kling 3.0 Omni — body 에 `image_tail` 키로 끝 프레임 url/base64 (자동 pro mode 잠금, 검색 확정).
   · Seedance 2.0 — **동일 endpoint** `fal-ai/seedance-2.0/image-to-video` 에 `end_image_url` 추가 (검색 확정, 별도 endpoint 가 아님).
   · Grok — 끝 프레임 미지원. **시작 프레임만** (v23.4 Continue 패턴), 챕터 안 두번째부터도 끝 프레임 무시.
8. `compose_video_prompt(...)` 에 `has_last_frame: bool` 인자 추가 — True 일 때 모델별 "start frame = ref 1, end frame = ref 2" 잠금 문장 prepend.
9. UI — `PreCeremonyMVPanel.jsx` 모델 라디오에서 Grok 선택 시 "Grok 은 끝 프레임 잠금이 안 돼요. 시작 프레임만 사용해요." 안내.
10. `scene_number` / `story_slot` / `use_seconds` / 챕터 안 직렬 비용(~3배) 정책 유지.

### 2) Plan verification findings (코드 0단계 + 외부 API 검증)

**파일별 현재 동작**

| 파일 | 함수 | 현재 동작 | v24 변경 필요? |
|---|---|---|---|
| `backend_8000/app/services/pre_mv_phase2_image_generator.py` | `generate_scene_image(...)` | scene 의 `ref_sheet_ids` + `ref_place_ids` 만으로 ref 결정. 첫 asset → place 슬롯, 둘째 → extra 슬롯. `_MAX_REFS=4`. 인자에 `prev_scene_image_bytes` 같은 carry 채널 없음. wedding_prep fallback 은 `_wedding_photo_fallback_for_owner`. | **Yes** — 새 인자 `prev_scene_image_bytes: Optional[bytes]` 추가. 우선순위 재배치: 시트 2 + prev 1 + place 1. extra(=wedding_photo) 는 prev 가 있으면 양보. SCENE_IMAGE_SYSTEM_PROMPT 에 "이전 씬 ref" 블록 추가. |
| `backend_8000/app/routes/pre_mv.py` `_run_phase2(...)` (L1273~) | 모든 target_indices 를 `Semaphore(3)` 로 동시 디스패치 — 챕터 무관. | **Yes** — 챕터(=연속 same `story_slot`) 단위로 그룹화 후 `asyncio.gather` 로 챕터끼리 병렬, 각 챕터 내부는 `for` 로 직렬. 챕터 안 둘째 씬부터 이전 씬 image_object_name 을 MinIO 에서 fetch → bytes 로 `_run_single_scene_image` 에 전달. |
| `backend_8000/app/routes/pre_mv.py` `_run_single_scene_image(...)` (L1095~) | `scene` dict 만 전달. | **Yes** — `prev_scene_image_bytes: Optional[bytes]` 추가 → `generate_scene_image` 로 forward. |
| `backend_8000/app/routes/pre_mv.py` `_run_phase3(...)` / `_run_single_scene_video(...)` (L2022~, L2242~) | `Semaphore(2)` 로 모든 씬 동시 디스패치. 모델별 분기는 video_model 4종 (Veo/Kling/Seedance/Grok). 끝 프레임 개념 없음. | **Yes** — 챕터 단위 병렬, 챕터 안 직렬. 챕터 안 둘째 씬부터: (a) 이전 씬 video_object_name → ffmpeg 로 last frame PNG 추출(=`extract_last_frame_png` 재사용), (b) generator 호출 시 `start_frame_bytes` + `end_frame_bytes` 전달. |
| `backend_8000/app/services/pre_mv_video_prompts.py` `compose_video_prompt(...)` (L344~) | 시그니처: `(video_model, scene, duration)`. 4 템플릿 + 복수 인물 보강. has_last_frame 인자 없음. | **Yes** — `has_last_frame: bool = False` 추가. True 일 때 Veo/Kling/Seedance 에 한 줄 "start frame matches ref image 1; end frame matches ref image 2; interpolate smoothly between them, preserving identity and wardrobe." 추가. Grok 은 변경 없음. |
| `backend_8000/app/services/pre_mv_veo_generator.py` `_start_veo(...)` (L136~) | payload `instances[0]` 에 `prompt` + `referenceImages[]` 만. `lastFrame` 없음. | **Yes** — 함수 인자 `end_frame_bytes: Optional[bytes]` 추가. 있으면 `instances[0].lastFrame.inlineData = {"mimeType":"image/png","data": b64}` 삽입. `compose_video_prompt(..., has_last_frame=True)`. 추적자 `last_frame_attached=true`. |
| `backend_8000/app/services/pre_mv_kling_generator.py` `_start_kling(...)` (L135~) | body 에 `image_list[]` 만 (첫번째 `type=first_frame`). `image_tail` 없음. | **Yes** — `end_frame_bytes` 추가. 있으면 body 에 `image_tail` 키로 base64(또는 data URI) 첨부. mode 는 이미 `"pro"` 고정 → 호환 OK. |
| `backend_8000/app/services/pre_mv_seedance_generator.py` `_start_seedance(...)` (L111~) | body `image_url` (시작 프레임 base64 data URI) + `prompt`/`duration`. endpoint = `fal-ai/seedance-2/image-to-video`. | **Yes** — 같은 endpoint 유지, body 에 `end_image_url` 추가 (data URI base64). 검색에서 별도 first-last endpoint 없이 image-to-video 가 end_image_url 을 받는 게 확인됨. |
| `backend_8000/app/services/pre_mv_grok_generator.py` | first frame only. 끝 프레임 무지원 — 그대로 둠. | **No** — 챕터 안 두번째 씬도 시작 프레임만 사용. 단 시작 프레임의 source 가 (Phase 2 이미지 → 이전 씬 last frame) 으로 바뀌면 chain 효과는 유지. 정책 결정: **Grok 은 챕터 안 carry 안 함** (사용자 합의 D — Grok 분기, "다른 모델과 분기"). |
| `backend_8000/app/services/extra_video_frame.py` `extract_last_frame_png(...)` | v23.4 — videos 버킷의 mp4 → photos 버킷 PNG. 인자 `extra_video_id`/`mv_job_id` 는 라벨용. | **재사용 OK** — Phase 3 에서도 같은 함수 호출. 단 PNG object_name 의 prefix 가 `extra/...` 라 v24 용으론 새 헬퍼 `extract_scene_last_frame_png(*, pre_mv_job_id, scene_number, video_object_name)` 를 같은 모듈에 추가 권고 (object_name = `pre_mv/{id}/last_frames/{N:03d}.png`). 내부 ffmpeg/MinIO 로직은 공통화 가능. |

**외부 API 정확 파라미터 (검증)**

| 모델 | API | 시작 프레임 키 | 끝 프레임 키 | 비고 |
|---|---|---|---|---|
| **Veo 3.1** | Gemini `models/veo-3.1-fast-generate-preview:predictLongRunning` | `instances[0].referenceImages[0].image.bytesBase64Encoded` (또는 `instances[0].image.{bytesBase64Encoded,mimeType}` — 첫 프레임은 보통 image, reference 는 subject 보존용) | **`instances[0].lastFrame.inlineData.{mimeType, data}`** (또는 `bytesBase64Encoded`) | 검증: Google Developers Forum + Cloud docs. Veo 3.1 fast/standard 모두 지원. `referenceImages` 와 `lastFrame` 은 독립 필드. v24 에선 기존 첫 프레임을 첫 씬 image 로 보내던 패턴을 유지(referenceImages=asset) + lastFrame 만 추가. |
| **Kling 3.0 Omni** | `api-singapore.klingai.com/v1/videos/omni-video` | `image_list[0]` with `type=first_frame` (현재 코드) | **`image_tail`** (top-level, base64 또는 url) | 검증: useapi.net 및 Freepik wrapper. `image_tail` 사용 시 자동 pro mode — 현 코드가 이미 `mode=pro` 고정이라 호환. Kling 공식 docs 가 폐쇄적이라 backend-dev 는 v24-impl 직전 시범 호출 1회로 키 이름 재확인. fallback: `image_list[].type="last_frame"` 도 시험. |
| **Seedance 2.0** | fal.ai `fal-ai/seedance-2.0/image-to-video` (같은 endpoint!) | `image_url` (data URI) | **`end_image_url`** (data URI 또는 URL) | 검증: fal.ai docs + 모델 페이지. 별도 `first-last-frame-to-video` endpoint 가 있는 건 **Veo 3.1** (`fal-ai/veo3.1/fast/first-last-frame-to-video`) 이고 Seedance 는 image-to-video 가 end_image_url 을 native 로 지원. length/format 제약은 image-to-video 와 동일 (5~15s). |
| **Grok** | xAI Imagine | image-to-video 시작 프레임 (presigned URL) | **미지원** | 변경 없음. UI 안내. |

**Plan verification 핵심 의문 해결**

· `scenes[i]` 에 `chapter_seq` 필드 없음 → 챕터 그룹화는 **scene 순회 시 `prev_scene.story_slot == cur.story_slot` 비교**로 즉석 계산. 사용자 합의 D: `scene_number` 보장 유지.
· `_MAX_REFS=4` 와 ref 슬롯(groom/bride/place/extra) 매핑 → v24 는 extra 슬롯을 prev_scene 우선 점유 (wedding_photo 양보).
· Phase 3 의 `_load_scene_image_bytes` 는 photos 버킷 fetch — last frame 추출은 videos 버킷 mp4 fetch 추가 필요 (extra_video_frame.py 패턴).
· Phase 4 (concat) 와의 영향 — Phase 4 는 씬 mp4 끝-시작 컷 전환을 그대로 concat. v24 의 FFLF 는 화면 외형 일관성만 강화, concat 동작 영향 없음.

### 3) 데이터 모델 변경 (`pre_mv_jobs.scenes[i]` 추가 필드)

| 필드 | 타입 | 의미 | 기록 시점 |
|---|---|---|---|
| `image_prev_scene_ref_used` | bool | Phase 2 에서 이전 씬 ref 가 실제로 첨부됐는지. 챕터 첫 씬은 False. | `_run_single_scene_image` 성공 마크 시 set. |
| `video_start_frame_source` | `"scene_image" \| "prev_video_last_frame"` | Phase 3 의 시작 프레임 출처. 챕터 첫 씬은 "scene_image". | `_run_single_scene_video` 성공 마크 시 set. |
| `video_end_frame_source` | `"next_scene_image" \| "free" \| null` | Phase 3 의 끝 프레임 출처. 챕터 마지막/Grok 은 "free". null 은 미정 (legacy). | 위와 동일. |
| `chapter_seq` (선택) | int | 챕터(=연속 same story_slot) 안에서의 순번(1-base). 디버깅·UI 표기용. 0=챕터 첫 씬. | Phase 1 splitter 가 채울 수도 있고, Phase 2/3 가 동적 계산해도 됨. v24 는 **Phase 1 시점에 1회 채워두는 쪽**을 권고 (회귀 안전한 deterministic 값). |

추가 1: **MinIO last-frame PNG object_name** — `pre_mv/{pre_mv_job_id}/last_frames/{N:03d}.png` (N = 이전 씬 number). 정리 정책은 Phase 4 완료 후 보존(디버깅).

추가 2: 로그 추적자 필드 — `image_prev_ref_attached_count` (`refs_count` 와 별도로 prev_scene 한 장이 들어갔는지 1/0 카운트).

### 4) 변경 매트릭스

| 파일 | 변경 항목 | 로깅 추적자 |
|---|---|---|
| `pre_mv_video_prompts.py` | `compose_video_prompt(..., has_last_frame: bool = False)` + 4 템플릿에 FFLF 보강 문장. | (없음 — generator 가 prompt_len 만) |
| `pre_mv_phase2_image_generator.py` | `generate_scene_image(..., prev_scene_image_bytes: Optional[bytes] = None)` 추가. ref 우선순위: 시트 2 + prev 1 + place 1. extra 슬롯은 prev 가 있으면 점유, 없으면 wedding_photo. SCENE_IMAGE_SYSTEM_PROMPT 에 `prev_scene_block` 항목 추가. | `pre_mv_job_id, scene_number, phase=phase2, refs_count, prev_attached(bool), elapsed_ms, bytes` |
| `pre_mv_veo_generator.py` | `generate_scene_video_veo(..., end_frame_bytes: Optional[bytes] = None)`. payload 에 `lastFrame` 추가. `compose_video_prompt(..., has_last_frame=end_frame_bytes is not None)`. | `last_frame_attached, op_name, bytes` |
| `pre_mv_kling_generator.py` | 동상. body 에 `image_tail` 추가. | `last_frame_attached, task_id, bytes` |
| `pre_mv_seedance_generator.py` | 동상. body 에 `end_image_url` 추가. | `last_frame_attached, request_id, bytes` |
| `pre_mv_grok_generator.py` | **무변경**. | (변경 없음) |
| `extra_video_frame.py` | 신규 `extract_scene_last_frame_png(*, pre_mv_job_id, scene_number, video_object_name)` 추가. 내부 로직은 기존 `extract_last_frame_png` 와 동일 패턴, photos 버킷 prefix 만 다름. | `pre_mv_job_id, scene_number, phase=phase3_fflf, in_bytes, png_bytes, rc, elapsed_ms` |
| `routes/pre_mv.py` `_run_phase2` | 챕터 단위 그룹화 + 챕터 안 직렬. `_run_single_scene_image` 호출 직전 이전 씬 image_object_name → bytes fetch → 전달. | `chapter_count, max_chapter_len` |
| `routes/pre_mv.py` `_run_single_scene_image` | `prev_scene_image_bytes` 인자 추가 → generator forward + scenes[i].image_prev_scene_ref_used 기록. | `prev_attached(bool)` |
| `routes/pre_mv.py` `_run_phase3` | 챕터 단위 그룹화 + 챕터 안 직렬. 챕터 안 둘째 씬부터: 이전 씬 video_object_name 으로 last frame PNG 생성 → MinIO get → bytes 로 dispatch. video_model="grok" 일 때는 직렬·이전 last frame carry **건너뛰기** (기존 병렬 패턴 유지). | `chapter_count, max_chapter_len, model_branch` |
| `routes/pre_mv.py` `_run_single_scene_video` | `start_frame_override_bytes: Optional[bytes]` + `end_frame_bytes: Optional[bytes]` 인자 추가 → 모델별 generator 로 forward. scenes[i] 의 video_{start,end}_frame_source 기록. | `start_frame_source, end_frame_source` |
| `routes/pre_mv.py` `regenerate_scene_video` | 단일 재생성 시에도 챕터 carry 적용 (현재 씬 자신만 재생성하지만, 시작/끝 프레임은 인접 씬에서 재계산). 사용자 합의 D 의 챕터 내 직렬은 전체 재생성에만 강제 — 단일 재생성은 인접 씬 결과 그대로 사용. | `start_frame_source, end_frame_source` |
| `frontend/PreCeremonyMVPanel.jsx` VIDEO_MODELS | Grok 라디오 desc 에 "끝 프레임 잠금 미지원 — 시작 프레임만 사용" 추가. 선택 시 안내 텍스트. | (UI) |
| `frontend/PreCeremonyMVPanel.jsx` 씬 상세 카드 | (선택) scenes[i] 의 video_start_frame_source / video_end_frame_source 뱃지 표기 — "↩ 이전 컷 끝 프레임", "↪ 다음 컷 시작 이미지" 같은 작은 라벨. 디버깅 가시성. | (UI) |

### 5) REST API 변경

· 라우트 시그니처(`POST /api/pre-mv/jobs/{id}/phase2`, `POST .../phase3`, `POST .../scenes/{n}/regenerate-{image,video}`) **불변**.
· 응답 payload(`scenes[i]`) 에 새 필드 3종 (`image_prev_scene_ref_used`, `video_start_frame_source`, `video_end_frame_source`) + 선택 `chapter_seq` 노출. `_serialize_pre_mv_job` 는 `scenes` 를 그대로 dump 하므로 자동 노출 — 별도 변경 불필요.
· 새 에러 메시지: "이전 씬 마지막 프레임 추출 실패 — 영상 끝 프레임 잠금 없이 진행합니다." (FFLF fallback 시).

### 6) 모델별 호출 패턴 (확정 — 검증된 키)

**Veo 3.1 (Gemini)**
```jsonc
POST .../v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning
{
  "instances": [{
    "prompt": "<compose_video_prompt(has_last_frame=True)>",
    "referenceImages": [
      { "image": {"bytesBase64Encoded": "<scene image OR prev last frame>", "mimeType": "image/png"},
        "referenceType": "asset" }
    ],
    "lastFrame": {"inlineData": {"mimeType": "image/png", "data": "<next scene image>"}}
  }],
  "parameters": {"aspectRatio": "16:9", "durationSeconds": 8}
}
```
챕터 안 둘째 씬부터의 의미: `referenceImages[0]` = 이전 씬 영상의 last frame PNG, `lastFrame` = 이번 씬 Phase 2 이미지. (= 시작 프레임 = 이전 끝, 끝 프레임 = 다음 이미지.) 챕터 첫 씬은 `lastFrame` 키 제거.

**Kling 3.0 Omni**
```jsonc
POST https://api-singapore.klingai.com/v1/videos/omni-video
{
  "model_name": "kling-v3-omni",
  "prompt": "...",
  "mode": "pro",
  "duration": "5",
  "aspect_ratio": "16:9",
  "sound": "off",
  "image_list": [
    {"image_url": "<base64 of start frame>", "type": "first_frame"},
    {"image_url": "<base64 of sheet 1>"}, {"image_url": "<base64 of sheet 2>"}
  ],
  "image_tail": "<base64 of next scene image>"     // 챕터 안 둘째 씬부터만
}
```

**Seedance 2.0 (fal.ai)**
```jsonc
POST https://queue.fal.run/fal-ai/seedance-2/image-to-video
{
  "prompt": "<sanitized>",
  "image_url": "data:image/png;base64,<start frame>",
  "end_image_url": "data:image/png;base64,<next scene image>",    // 챕터 안 둘째 씬부터만
  "duration": 5
}
```

**Grok**
```jsonc
POST xAI /v1/imagine/video
{
  "prompt": "<motion-first>",
  "image_url": "<presigned URL of start frame>",
  // 끝 프레임 키 없음
  "duration": 5
}
```
정책: 챕터 안 두번째 씬도 시작 프레임 = (이전 씬 last frame 도 아니고) **이번 씬 Phase 2 이미지** 유지. 즉 Grok 만 챕터 안 carry 안 함 — 이유: 그러면 Grok 만 챕터 안 직렬화로 시간만 늘고 시각적 이득 없음. v24 의 Grok 분기는 "병렬 + 시작=phase2_image only" 그대로 유지.

### 7) 회귀 위험

| # | 위험 | 완화 |
|---|---|---|
| W1 | 챕터 안 직렬화로 Phase 2/3 의 wall-clock 시간 ~3배 증가. 6~10씬 잡(평균 1~3 챕터) 에서 phase3 가 분당 1~2 컷 → 챕터당 5~15분 추가. | 챕터끼리는 병렬 유지 — 1~3 챕터 동시 진행. UI 의 진행도 갱신은 그대로. 사용자에게 "더 안정적인 일관성을 위해 시간이 약 2~3배 더 걸려요" 안내. |
| W2 | 모델별 분기 폭증 — Veo/Kling/Seedance/Grok 4갈래 + has_last_frame True/False 2분기 = 8 경로. generator 별 통합 테스트 부담. | v24 의 매 generator 가 `end_frame_bytes` 1개만 받는 좁은 인터페이스로 통일. v24 테스트 매트릭스 (§ 8) 강제. |
| W3 | ref 우선순위 변경 — wedding_photo 양보 정책으로 wedding_prep 시점의 wedding_photo 첨부가 빠질 수 있음. v17.2 의 fallback 의존 잡에 회귀. | wedding_prep + 챕터 안 둘째 씬 동시 조건은 드묾 (보통 챕터 첫 씬에서 wedding_photo 필요). 검증: PLAN.md 의 wedding_prep 잡 1건 수동 회귀. |
| W4 | Kling `image_tail` 키 이름 비공식 — 공식 docs 미공개. 응답 거부 시 fallback 가 필요. | backend-dev 가 v24-impl 1차 commit 후 dry-run 1회. 거부 시 즉시 `image_list[].type="last_frame"` 시도. PLAN 에 fallback 명시. |
| W5 | last frame 추출 실패 시 처리 — ffmpeg `-sseof -0.5` 가 일부 codec 에서 frame 못 잡음 (v23.4 G5 와 동일). | fallback: `-vf "select=eq(n\,N-1)"` 시도. 둘 다 실패 시 끝 프레임 잠금 포기 + phase3 진행, scene.video_end_frame_source="free" + 경고 로그. |
| W6 | Phase 3 단일 재생성(`regenerate-video`) 시 챕터 안 carry 가 부분만 적용 — 인접 씬 mp4 가 사라졌으면 last frame 추출 실패. | regenerate 단일 호출은 인접 씬 video_status=completed 일 때만 carry. 아니면 시작=phase2 image + 끝=free 로 fallback (정상 진행). |
| W7 | `chapter_seq` 를 Phase 1 splitter 에서 채우면 splitter 변경 필요 — 회귀 면 증가. | 합의: **chapter_seq 는 Phase 2/3 에서 동적 계산만**. scenes 도큐에는 저장하지 않음. (스키마 추가 후보로만 명시.) |
| W8 | Phase 2 의 `_resolve_asset_ref` 우회 — prev_scene 이미지가 wedding_assets 도 character_sheets 도 아닌 photos 버킷의 다른 prefix(`pre_mv/.../scenes/`). 기존 `_load_image_from_photos` 가 prefix 무관해 OK. | 검증 — `get_object` 는 prefix 검사 없음. 정상. |

### 8) 테스트 항목

· **T1 Phase 2 chain** — 같은 story_slot 3씬 챕터 잡 → scene #1 image_prev_scene_ref_used=False, scene #2/#3 image_prev_scene_ref_used=True. 로그에 `prev_attached=true` 기록.
· **T2 Phase 2 wedding_photo 양보** — wedding_prep 챕터 + 둘째 씬에서 prev 이미지가 점유 → extra 슬롯에 wedding_photo 미포함. refs_count=4.
· **T3 Phase 3 Veo FFLF** — 3씬 챕터, video_model=veo. scene #2 payload 에 `lastFrame` 키 존재 확인 (curl mock 캡처). scene #1 lastFrame 키 없음.
· **T4 Phase 3 Kling FFLF** — body 에 `image_tail` 존재 + mode=pro 자동 잠금 확인.
· **T5 Phase 3 Seedance FFLF** — body 에 `end_image_url` (data URI) 존재.
· **T6 Phase 3 Grok 분기** — video_model=grok 잡에서 챕터 안 두번째 씬도 시작=phase2 image, 끝 프레임 키 없음. video_end_frame_source="free".
· **T7 챕터 병렬** — 2 챕터 (slot a 3씬, slot b 2씬) 잡 → 챕터 a/b 동시 시작, 각 챕터 안 직렬. 로그에서 챕터 시작 시간이 ±2초 안.
· **T8 챕터 안 직렬** — 챕터 안 scene #2 의 image_started_at > scene #1 의 image_finished_at.
· **T9 last frame 추출 실패 fallback** — 일부러 망가뜨린 mp4 → scene.video_end_frame_source="free" + scene 자체는 completed.
· **T10 단일 regenerate 인접 누락** — regenerate-video on scene #2 with scene #1 video_object_name=None → 시작=phase2 image, 끝=free. completed.
· **T11 UI Grok 안내** — PreCeremonyMVPanel 에서 grok 라디오 클릭 → "끝 프레임 잠금 미지원" 안내 텍스트 노출.
· **T12 회귀 — 단일 챕터 잡** — 모든 씬 story_slot 동일한 6씬 잡 → 1챕터 직렬, 시간 ~6배. completed 확인.

### 9) AI 모델 한계 점검

· **Veo 3.1 lastFrame** — `referenceImages`(asset, 최대 3장) 와 `lastFrame` 은 독립 슬롯. asset reference 3장 + lastFrame 1장이 동시 가능 — 그러나 동일 인물 일관성 유지를 위해 v24 는 첫 프레임 image 하나만(=referenceImages[0]) + lastFrame 하나만 보냄. 캐릭터 시트 추가 첨부는 reference asset 슬롯에 채워도 OK (남는 2 슬롯 활용 가능 — v24+ 후속 검토).
· **Kling image_tail** — 자동 pro mode 잠금. Kling 3.0 standard 가 명시적이지 않은 한 영향 X (현 코드 pro 고정).
· **Seedance end_image_url** — 같은 endpoint, 별도 cost 없음. 단 length 가 5~15s 로 제약 (현 코드 동일). 포맷은 image-to-video 와 동일 (data URI base64 또는 https URL).
· **Veo 3.1 fast 의 lastFrame 지원 시점** — Google AI Developers Forum 게시(v3.1 official release post) 에서 standard 와 fast 둘 다 지원 확정. 다만 fast tier 에서 lastFrame 의 품질이 standard 보다 떨어진다는 user report 있음 — 일관성은 충분.
· **Grok 끝 프레임 미지원** — xAI Imagine Video 의 image-to-video 는 start frame 만. 변경 불가.

### 10) 민감 정보

· Veo: `google_api_key`, Kling: `kling_access_key`/`kling_secret_key`, Seedance: `fal_api_key`, Grok: `xai_api_key`. 모두 `settings.*` 에서만 읽고 로깅 금지(현 코드 정책 유지). last frame base64 / image bytes 는 길이만 로깅.
· last frame PNG MinIO object_name 은 평문 (= `pre_mv/{id}/last_frames/{N:03d}.png`) — owner 검증은 `_resolve_pre_mv_job` 가드로 보호. 외부 노출 X (frontend 가 직접 접근하지 않음).

### v24 작업 끝(append).

## v21.2 — 2026-05-29 — Phase 1 음악 sync 의존 제거 + clips_per_event 균등 분배

### 1) 요구사항 요약

· Suno alignedWords timing 결함(첫 ~60줄이 0~1.5초에 박힘) 으로 v21.1 `use_seconds` 가 0.01~0.04s 로 잘못 계산되는 문제.
· 사용자 결단: **Phase 1 에서 음악 sync 자체를 폐기** + 충분한 영상 클립을 자동 생성 + 편집기에서 손편집.
· 새 입력: `scenario_text`, `scenario_events`, `clips_per_event ∈ {2,3,4}` (UI 라디오 선택, 기본 3). 출력 씬 개수 = `len(scenario_events) × clips_per_event`.
· 출력 `use_seconds` 는 모든 씬 = `video_clip_default(8.0s)` 균등 고정. 사용자가 편집 단계에서 자른다.
· `section_markers` / `section_start` / `section_end` 키는 호환을 위해 유지하되 빈 배열 / 0 으로 채움.
· LLM 마커 검증(`_validate_marker_match`) 폐기. JSON 파싱 실패만 fallback 으로 처리.
· v22 가사 timestamp 토글 / 음악 플레이어 UI 는 무변경 — `lyric_timestamps`, `lyric_timestamps_variants`, `aligned_words_variants` 는 데이터로 보존만 (Phase 1 입력 X).
· v24 챕터(`story_slot` 그룹) 직렬화는 자연 호환 — scenes 는 events 순서 × clips_per_event 로 같은 slot 이 연속 배치됨.

### 2) Plan verification findings

| 파일 | 라인 | 현재 동작 | 변경 |
|---|---|---|---|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | 38~76 | docstring + client init. | docstring 을 v21.2 로 갱신 (마커 검증 폐기 명시). |
| 동상 | 78~110 | `_VIDEO_CLIP_MAX_DEFAULT=10.0`, `_MIN_TOTAL_SCENES=8`, `_MAX_TOTAL_SCENES=30`, `_SECTION_LABEL_RE`, `_VOCAL_LABEL_RE`. | `_VIDEO_CLIP_MAX_DEFAULT` 명칭 → `_VIDEO_CLIP_DEFAULT=8.0` 로 의미 교체. min/max total/per-section 상수와 마커 정규식 2종은 **삭제 후보**(보존해도 dead code). |
| 동상 | 117~264 | `_normalize_section_label` / `_extract_expected_markers` / `_extract_section_markers_v2` / `_validate_marker_match`. | **전부 dead code 로 전환**. v21.2 진입점은 호출 안 함. 1차 commit 에서 함수 정의는 남기되 주석 `# DEPRECATED (v21.2)` 추가, 2차 cleanup commit 에서 삭제. |
| 동상 | 271~285 | `_decide_scene_count_per_section`. | 사용 안 함 → `# DEPRECATED`. |
| 동상 | 292~312 | `_infer_audio_duration`. | 사용 안 함 → `# DEPRECATED`. |
| 동상 | 319~369 | `SCENE_SPLIT_SYSTEM_PROMPT` (입력 4종 — scenario_text/events/section_markers/scene_quota). | 입력에서 `section_markers` / `scene_quota` 제거. 새 입력: `scenario_text`, `scenario_events`, `clips_per_event`. 절대 규칙 8(시간 역행) 삭제, 규칙 9(연속성) 의 단서 "section_markers 시간 순서" 표현 삭제. 출력 씬 shape 의 `section` 필드 설명 → "story_slot 라벨 그대로 복사(시간 의미 없음)". |
| 동상 | 372~424 | `_build_user_message` — section_markers / scene_quota 블록 포함. | section / quota 블록 제거. 새 블록: `clips_per_event=N` 명시. 총 씬 목표 수 = `len(events)*N`. |
| 동상 | 607~643 | `_build_scene_quota`. | 호출처 사라짐 → `# DEPRECATED`. |
| 동상 | 650~678 | `_compute_initial_use_seconds`, `_adjust_use_seconds_to_audio`. | 둘 다 사용 안 함 → `# DEPRECATED`. |
| 동상 | 685~902 | `split_into_scenes_v21` — audio_duration 추정 → 마커 검증 → quota → LLM → fallback → 정규화. | **`split_into_scenes_v212` 신규 함수**로 교체. `split_into_scenes_v21` 는 stub raise 로 변환(상위 호출자 단일). |
| 동상 | 971~1008 | `_build_fallback_scenes` — section_label_order 기반 라운드로빈. | events × clips_per_event 라운드로빈으로 단순화. 새 함수 `_build_fallback_scenes_v212`. |
| 동상 | 1015~1020 | 폐기 stub. | `split_into_scenes` stub 유지 + `split_into_scenes_v21` 도 같은 패턴으로 폐기 안내. |
| `backend_8000/app/routes/pre_mv.py` | 43 | `from ..services.pre_mv_phase1_splitter import split_into_scenes_v21`. | `split_into_scenes_v212` 로 교체. |
| 동상 | 223~225 | `StartPhase1Body(BaseModel): force: bool = False`. | `clips_per_event: Literal[2,3,4] = 3` 필드 추가. |
| 동상 | 269~451 | `create_pre_mv_job` — lyrics_body / aligned_words 적재 + new_doc 초기 키. | new_doc 에 `clips_per_event: 3` 추가. `lyrics_body` / `aligned_words` 적재 라인 + 초기 키 2종은 **유지** (Phase 4 호환 + 데이터 보존). 단 주석을 "Phase 1 입력 아님 — 데이터 보존용" 으로 갱신. |
| 동상 | 723~896 | `_run_phase1` — lyrics_body / aligned_words / mv_doc 로드 + `get_suno_timestamps` 백업 fetch + 검증 후 splitter 호출. | lyrics_body / aligned_words 로드 + 백업 fetch + 부재 검증(`834~839`) **전부 삭제**. `mv_doc` 로드도 삭제(다른 용도 없음 — 음악 spec 도 사용 안 함). 새 호출: `split_into_scenes_v212(pre_mv_job_id=..., scenario_text=..., scenario_events=..., clips_per_event=doc.get("clips_per_event") or 3)`. |
| 동상 | 899~974 | `start_phase1` 핸들러. | `body.clips_per_event` 를 받아 `pre_mv_jobs.$set.clips_per_event` 로 잡 도큐에 영속화 후 `_run_phase1` task. (= 사용자가 라디오 바꾸면 재실행 시 그 값으로 갈아엎힘.) |
| `frontend/src/api/index.js` | 295~296 | `runPreMVPhase1(id, { force = false } = {}) => API.post(.../phase1, { force })`. | `runPreMVPhase1(id, { force = false, clips_per_event = 3 } = {}) => API.post(.../phase1, { force, clips_per_event })`. JSDoc 도 갱신. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | 487~518 | `startPhase1(force)` — phase1 호출. | 시그니처 → `startPhase1(force, clipsPerEvent)` 로 변경. `runPreMVPhase1(id, { force, clips_per_event: clipsPerEvent })`. dev console log 에 `clips_per_event` 추가. |
| 동상 | 963 일대 | `<PreMVScenesStep ... onStart={startPhase1} />`. | `onStart(force, clipsPerEvent)` 시그니처 유지하도록 wrapping. |
| 동상 | 1172~1289 | `PreMVScenesStep` 컴포넌트 — 라디오 X. | 라디오 그룹 `event 당 클립 수: 2 / 3 / 4` 추가 (기본 3, state `clipsPerEvent`). 라벨: "각 시점마다 몇 컷씩 만들까요?". `onClickStart` / `onClickRerun` 에서 `onStart(false, clipsPerEvent)` / `onStart(true, clipsPerEvent)`. 라디오는 `canStart || canRerun` 일 때만 enable, `isRunning` / `phase2_*` 진행 중엔 disable. |

핵심 발견: 백엔드 변경면이 비교적 깨끗 — splitter 의 외부 시그니처 1개 + 라우트의 `_run_phase1` 본문 + body 1키 + new_doc 1키. 프런트는 step 카드 라디오 + props 1개 + api 1키만.

### 3) 데이터 모델

· `pre_mv_jobs` 도큐에 새 필드: `clips_per_event: int` (값 ∈ {2,3,4}, 기본 3). 신규 잡은 `create_pre_mv_job` 에서 3 으로 초기화. 기존 잡은 부재 → `_run_phase1` 에서 `doc.get("clips_per_event") or 3` 로 안전한 default. (기존 잡 force 재실행 시 라디오 값 그대로 영속화.)
· `pre_mv_jobs.scenes[i].use_seconds = 8.0` 모든 씬 동일.
· `pre_mv_jobs.scenes[i].section = scenario_events[k].story_slot` (시간 정보 없음 — 챕터 라벨용).
· `pre_mv_jobs.scenes[i].section_start = 0.0`, `section_end = 0.0` (호환 키).
· `pre_mv_jobs.section_markers = []` (호환 키, 사용 안 함).
· `pre_mv_jobs.lyrics_body`, `pre_mv_jobs.aligned_words` 는 **데이터로 보존** (Phase 1 입력 X — v22 가사 timestamp 토글 UI, Phase 4 audio merge 의 plumbing 미래 확장용).

### 4) 변경 매트릭스 — 파일별 변경 + 로깅 추적자

| 파일 | 변경 | 로깅 추적자 |
|---|---|---|
| `services/pre_mv_phase1_splitter.py` | `split_into_scenes_v212(pre_mv_job_id, scenario_text, scenario_events, clips_per_event, video_clip_default=8.0)` 신규. v21.1 의 마커 추출 / 검증 / quota / use_seconds 보정 코드는 DEPRECATED 주석 후 삭제 보류(2차 cleanup). `_build_fallback_scenes_v212(events, clips_per_event)` 신규 — events 순회 × clips_per_event 라운드로빈. `SCENE_SPLIT_SYSTEM_PROMPT` / `_build_user_message` 개정. | `pre_mv_job_id, phase=phase1, clips_per_event, events_count, scenes_target, model, provider, max_tokens, elapsed_ms` |
| `routes/pre_mv.py::_run_phase1` | lyrics_body / aligned_words / mv_doc / get_suno_timestamps 흐름 삭제. 새 splitter 호출. `result["section_markers"] = []` 그대로 저장(스키마 유지). | `pre_mv_job_id, phase=phase1, clips_per_event, events_count, scenes_count` |
| `routes/pre_mv.py::StartPhase1Body` | `clips_per_event: Literal[2,3,4] = 3` 추가. | (Pydantic 검증) |
| `routes/pre_mv.py::start_phase1` | body.clips_per_event 영속화 → `$set: {status, ..., clips_per_event}`. | `pre_mv_job_id, force, clips_per_event` |
| `routes/pre_mv.py::create_pre_mv_job` | new_doc 초기값에 `clips_per_event: 3` 추가. | `pre_mv_job_id, clips_per_event=3` |
| `frontend/src/api/index.js` | `runPreMVPhase1(id, {force, clips_per_event=3})`. | n/a |
| `frontend/src/components/PreCeremonyMVPanel.jsx` PreCeremonyMVPanel.startPhase1 | 시그니처 (force, clipsPerEvent). | `pre_mv_job_id, force, clips_per_event` (dev console) |
| 동상 PreMVScenesStep | 라디오 그룹 신규, state `clipsPerEvent`. | `pre_mv_job_id, clips_per_event` (라디오 변경 시) |

### 5) REST API 변경

· `POST /api/pre-mv/jobs/{id}/phase1` body 스키마:
  - 기존: `{ "force": bool }`.
  - 새: `{ "force": bool, "clips_per_event": 2|3|4 }` (기본 3).
· 응답 body: `{ "pre_mv_job_id": str, "status": "phase1_splitting" }` — **변경 없음**.
· `GET /api/pre-mv/jobs/{id}` 응답 페이로드 변화:
  - `scenes[].use_seconds` = 모든 씬 일정 값(8.0). (= 클라이언트의 가사 토글 / 음악 플레이어 sync 호환은 데이터 보존된 `lyric_timestamps_variants` 로 처리됨, scenes 의 timing 키 의존 X.)
  - `scenes[].section_start = 0.0`, `section_end = 0.0`.
  - `section_markers = []` (빈 배열).
  - 새 필드 `clips_per_event` 가 잡 도큐에 노출 (= `_serialize_pre_mv_job` 가 dict dump 이므로 자동).
· 호환성: 클라이언트가 `scenes[i].use_seconds > 0` 만 확인하면 OK. `section_markers` 의 길이로 검증하던 코드는 없음(검증 — `frontend/` grep 결과 `section_markers` 직접 의존 코드 없음).

### 6) v24 호환

· v24 의 Phase 2/3 챕터 그룹화 = scenes 를 `story_slot` 기준 연속 그룹으로 묶어 챕터 안 직렬, 챕터끼리 병렬.
· v21.2 의 scenes 순서: `events[0] → clip 1..N`, `events[1] → clip 1..N`, ... — events 가 phase0 에서 시간 순으로 정렬되어 들어옴. 같은 story_slot 의 인접 event 도 자연 인접 → 챕터 그룹화 정합 OK.
· 다만 `story_slot` 이 같은 두 인접 event 가 있을 때 챕터 길이가 `2 × clips_per_event` 까지 커짐. v24 의 W1 "챕터 안 wall-clock 시간 증가" 위험이 더 두드러질 가능성. 현 정책: clips_per_event=3 + 같은 slot 인접 event 2개 = 챕터 6씬 × 분당 1~2 컷 = 3~6분 (acceptable).
· `scenes[i].section` 값이 v24 이전엔 `Verse 1` 같은 음악 라벨, v21.2 부터는 `meeting` 같은 story_slot 라벨. v24 Phase 2/3 챕터 그룹화는 `story_slot` 기준이므로 `section` 의 의미 변경 무영향. UI 의 씬 카드가 `section` 을 텍스트 표기하는 부분은 v22 의 SceneCard 헤더에서 확인 필요 — 표기 자체는 깨지지 않지만 라벨 인상이 바뀜.

### 7) 회귀 위험

| # | 위험 | 완화 |
|---|---|---|
| W1 | Phase 4 audio merge 동작 변경 — scenes 의 use_seconds 합이 음악 길이와 다를 때 ffmpeg concat 의 끝 처리. `_adjust_use_seconds_to_audio` 가 더 이상 안 불림. | Phase 4 compositor 는 음악 길이를 별도 입력으로 받음 (mv_jobs.audio_object_name) — 영상은 use_seconds 합만큼 짜고 음악은 트랙 길이대로 흐름. ffmpeg 가 짧은 쪽으로 자르거나 마지막 프레임 freeze 처리. **검증 필요**: T3 회귀 테스트. |
| W2 | v22 가사 timestamp 토글 UI — scenes 에 timing 없음. | `lyric_timestamps_variants` 는 mv_jobs 에 보존되어 있고 UI 는 그쪽을 직접 본다. scenes 의 section_start 의존 없음. (코드 검증: 토글은 mv_job 에서 ts variants 를 직접 fetch.) |
| W3 | LLM 이 출력 씬 개수를 quota 가 아닌 events × clips_per_event 로 안 맞춤. | 시스템 프롬프트에 "scenes 항목 수 정확히 `len(events) × clips_per_event`" 명시. 부족하면 `_build_fallback_scenes_v212` 로 결정론적 채움. 초과는 splitter 가 truncate. |
| W4 | 기존 v21~v24 잡(scenes timing 기반)의 폴링 응답 호환. | force=true 재실행 전엔 기존 scenes 그대로. 사용자가 [다시 씬 분할] 누르는 순간 새 균등 분배로 교체. 자동 무효화 안 함. |
| W5 | StartPhase1Body 의 `clips_per_event` 가 invalid (e.g. 5) → Pydantic 422. 프런트 라디오는 enum 보호하지만 직접 호출 가능성. | 422 에러 메시지 friendly 처리 — `start_phase1` 핸들러는 Pydantic 422 가 FastAPI 기본 처리로 노출됨. 프런트 setActionError 가 detail.error 또는 detail.detail 표시. (현 코드 OK.) |
| W6 | 마이그레이션 — 기존 잡의 `clips_per_event` 부재. | `_run_phase1` 에서 `doc.get("clips_per_event") or 3`. `start_phase1` 가 매 호출 시 영속화. → first re-run 부터 명시값. 별도 백필 스크립트 불필요. |
| W7 | `section_markers = []` 로 변경되면 어떤 클라이언트가 깨지나? | grep 결과 frontend 내 `section_markers` 직접 의존 코드 없음 (코드 검증 — PreCeremonyMVPanel.jsx 에서 검색 0건). 백엔드 `_serialize_pre_mv_job` 가 그대로 dump. 안전. |
| W8 | DEPRECATED 함수가 dead code 로 남으면 lint / coverage 노이즈. | 1차 commit 에서 함수 보존(이력 추적 + 마이그레이션 안전망), 2차 cleanup commit 에서 삭제. PLAN 에 명시. |

### 8) 테스트 항목

· **T1 clips_per_event=2** — events 5개 잡 → scenes 10개. 모든 use_seconds=8.0. section 라벨 = story_slot. `section_markers=[]`.
· **T2 clips_per_event=3** — events 5개 잡 → scenes 15개. memory_index 가 다른 두 memory event 가 각각 3씬씩 자기 memory_index 보존.
· **T3 clips_per_event=4** — events 4개 잡 → scenes 16개. video_clip_default=8.0 → 영상 합 128s. Phase 4 audio merge 회귀 검증 (음악 트랙 길이 ~150s 와 mismatch).
· **T4 같은 story_slot 인접 event** — events: [meeting, meeting, first_date, ...] + clips_per_event=3 → scenes 의 처음 6개 모두 meeting. v24 Phase 2/3 챕터 그룹화 시 1챕터 6씬 으로 묶임 확인. 챕터 안 직렬 + image_prev_scene_ref_used 카운트.
· **T5 force 재실행 마이그레이션** — v21.1 로 만들어진 기존 잡(scenes 의 use_seconds=0.04 같이 깨진 값) → force=true + clips_per_event=3 호출 → scenes 새로 균등 8.0s 로 교체. 기존 scenes user_edited_fields 는 사라짐 (사용자 confirm 후만).
· **T6 LLM 실패 fallback** — anthropic_api_key/openai_api_key 둘 다 비움 → `_resolve_prompt_model` raise → `_build_fallback_scenes_v212` 호출 → events × clips_per_event 결정론적 채움. scene 개수 정확.
· **T7 LLM 부분 응답 — 씬 개수 부족** — LLM 이 quota=15 인데 10개만 응답 → splitter 가 fallback 으로 5개 보충 OR truncate 정책 명시. 현 합의: **응답이 부족하면 fallback 전부로 교체**(부분 merge 안 함, 안정성 우선).
· **T8 v22 가사 토글 UI 회귀** — 같은 잡의 mv_jobs.lyric_timestamps_variants 가 그대로 → 음악 플레이어 가사 토글 동작 변화 없음.
· **T9 Phase 4 audio merge 회귀** — 영상 길이 vs 음악 트랙 길이 mismatch 시 ffmpeg 동작. scenes use_seconds 합 = N*8s, 음악 = duration_minutes*60. mismatch 가 30s 이상 시 어떻게 마무리되는지 mp4 메타 확인.
· **T10 라디오 UI** — Step 2 에서 라디오 2/3/4 클릭 → state 변경. [씬 분할 시작] 클릭 시 body 에 그 값 전송. canStart=false 일 때 라디오도 disable.

### 9) 민감 정보

· 변경 없음 — Anthropic / OpenAI 키만 사용. lyrics_body / aligned_words 는 잡 도큐 내 저장(기존). `clips_per_event` 는 정수 1개 — 민감도 없음.

### v21.2 작업 끝(append).

## v21.3 — 2026-05-29 — LLM use_seconds 유동 결정 + 모델별 클램프 확정

### 1) 요구사항

· v21.2 의 모든 씬 `use_seconds = 8.0` 강제(`split_into_scenes_v212` 본문 1348 라인)를 폐기. LLM 이 씬마다 description 의 호흡에 맞춰 길이(초)를 직접 결정한다.
· 시스템 프롬프트에 길이 결정 가이드라인 추가 — 짧은 정적 컷 3~5초 / 보통 동작 6~9초 / 복잡 액션·전환 10~15초. 출력 범위 **3 ~ 15초** (정수 또는 소수).
· 응답 JSON 스키마에 `use_seconds: float` 필드 추가. 누락 시 `video_clip_default=8.0` 으로 보강. 가이드라인 어김 시 splitter 가 3~15 안전 clamp.
· Phase 3 모델별 클램프는 이미 구현되어 있음(v21~v23.2 누적 — 확인만): Veo 8.0 고정, Kling clamp(3,15), Seedance clamp(5,15), Grok clamp(1,10).
· Fallback (`_build_fallback_scenes_v212`) 은 그대로 — 결정론적 채움 시 use_seconds=8.0 균등 유지(고민 거리 없음).
· UI: Step 4 영상 모델 라디오 Veo desc — "Veo 3.1 — 8초 고정. LLM 이 정한 길이가 적용되지 않아요" 식으로 안내 갱신.

### 2) Plan verification findings — 0단계 결과

| 파일 | 라인 | 현재 동작 |
|------|------|----------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` | 77~78 | `_VIDEO_CLIP_DEFAULT = 8.0` 상수. |
| 동상 | 327~377 | `SCENE_SPLIT_SYSTEM_PROMPT_V212` — scene shape 에 use_seconds 키 없음 (모든 씬 8.0 균등 정책). |
| 동상 | 434~472 | `_build_user_message_v212` — clips_per_event 전달, scene 형식 가이드 X. |
| 동상 | 608~631 | `_parse_scenes_response` — 단순 dict.scenes 추출, use_seconds 추출 X. |
| 동상 | 1151~1172 | `_build_fallback_scenes_v212` — 결정론 fallback (events × cpe). |
| 동상 | 1179~1378 | `split_into_scenes_v212` — LLM 호출 + 정규화. **1348 라인**: `"use_seconds": float(video_clip_default)` — 무조건 8.0 박힘. |
| 동상 | 1322~1334 | `_maybe_prepend_continuity` 등 prompts 머지 — use_seconds 합성 X. |
| `backend_8000/app/services/pre_mv_veo_generator.py` | 45 | `_VEO_DURATION = 8` 상수. |
| 동상 | 358~364 | `target_sec = float(scene.get("use_seconds") or _VEO_DURATION)` + `_trim_to_duration` 시 `duration=min(_VEO_DURATION, max(2.0, target_sec))`. Veo API 호출은 항상 8초로 보내고, 응답 mp4 를 ffmpeg 로 자른다. **= Veo 본체는 8초 고정**. |
| `backend_8000/app/services/pre_mv_kling_generator.py` | 45~46 | `_KLING_MIN = 3`, `_KLING_MAX = 15`. |
| 동상 | 359~360 | `target_sec = scene.use_seconds or 5.0`; `kling_duration = max(_KLING_MIN, min(_KLING_MAX, int(round(target_sec))))`. → clamp(3, 15). |
| `backend_8000/app/services/pre_mv_seedance_generator.py` | 40~41 | `_SEEDANCE_MIN = 5`, `_SEEDANCE_MAX = 15`. |
| 동상 | 293~294 | `target_sec = scene.use_seconds or 5.0`; `seedance_duration = max(_SEEDANCE_MIN, min(_SEEDANCE_MAX, int(round(target_sec))))`. → clamp(5, 15). |
| `backend_8000/app/services/pre_mv_grok_generator.py` | 43~44 | `_GROK_MIN = 1`, `_GROK_MAX = 10`. |
| 동상 | 294~295 | `target_sec = scene.use_seconds or 5.0`; `grok_duration = max(_GROK_MIN, min(_GROK_MAX, int(round(target_sec))))`. → clamp(1, 10). |
| `frontend/src/components/PreCeremonyMVPanel.jsx` | 70~75 | `VIDEO_MODELS` 상수. Veo desc = `'구글 — 8초 고정, 안정적·고품질'`. |

핵심 발견: **Phase 3 모델별 클램프는 모두 v23.2 이전에 이미 정상 구현 완료.** v21.3 코드 변경면은 splitter 1개 파일 + 프런트 desc 문구 1줄뿐.

### 3) 변경 매트릭스 — 파일별 변경 + 로깅 추적자

| 파일 | 변경 | 로깅 추적자 |
|------|------|------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 27~32 (헤더 docstring) | "모든 씬 use_seconds = video_clip_default" → "각 씬 use_seconds 는 LLM 이 description 호흡에 맞춰 3~15초로 결정. 누락 시 video_clip_default(8.0)." | n/a |
| 동상 327~377 (`SCENE_SPLIT_SYSTEM_PROMPT_V212`) | shape 에 `use_seconds: number  # 3.0~15.0 (정수 또는 소수)` 추가. 절대 규칙에 길이 결정 가이드라인 1항목 추가 — 짧은 정적/표정 3~5초, 보통 동작 6~9초, 복잡 액션/전환 10~15초. "모델 한계 클램프는 시스템이 처리한다" 명시. | (LLM 응답 본문 — log 변화 없음) |
| 동상 1316~1335 (LLM scene 머지 블록) | `sc.get("use_seconds")` 안전 추출 + float 캐스팅 + `clamp(3.0, 15.0)`. None / non-number / 범위 밖 → `video_clip_default(8.0)`. | use_seconds_raw, use_seconds_final |
| 동상 1336~1365 (final scene dict) | `"use_seconds": float(video_clip_default)` → `"use_seconds": resolved_use_seconds` (위 블록 결과). | n/a |
| 동상 1368~1374 (ok log) | 추가 metric: `use_seconds_min`, `use_seconds_max`, `use_seconds_mean`, `use_seconds_default_fallback_count` (LLM 누락 → 8.0 fallback 한 씬 수). | 위 4개 metric. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 71 | Veo desc → `'구글 — 8초 고정 (LLM 길이 결정 미적용), 안정적·고품질'`. | n/a |

### 4) 모델별 클램프 정책 확정

| 모델 | 정책 | 구현 위치 | 비고 |
|------|------|----------|------|
| Veo 3.1 fast | **8.0초 고정** (모델 한계). use_seconds 가 8 미만이면 8초 응답 mp4 를 ffmpeg 로 trim. | `pre_mv_veo_generator.py:358-364` + `_trim_to_duration` | API 한계 — LLM 가이드라인 무관. |
| Kling 3.0 Omni | clamp(3, 15) 정수. | `pre_mv_kling_generator.py:359-360` | LLM 출력 그대로 통과(3~15 안). |
| Seedance 2.0 | clamp(5, 15) 정수. | `pre_mv_seedance_generator.py:293-294` | LLM 이 3~4 줘도 5 로 올림. |
| Grok Imagine | clamp(1, 10) 정수. | `pre_mv_grok_generator.py:294-295` | LLM 이 11~15 주면 10 으로 내림. |

핵심: **splitter 단에서 3~15 안전 clamp** → 모델 단에서 각자 추가 clamp. Veo 만 본체 한계로 trim 처리.

### 5) 테스트 항목

· **T1 phase1 health/auth** — 백엔드 reload 후 import OK, GET `/api/health` 200, POST `/api/pre-mv/jobs/{id}/phase1` no-auth → 401, body invalid → 422.
· **T2 LLM 분포 라이브** — 기존 잡 `6a17f8eb...` 으로 force=true clips_per_event=3 phase1 재실행. scenes 18개. use_seconds 가 **단일 값(8.0) 이 아니라 다양한 값** (Counter 결과 3~15 사이 N종 분포). 최소/최대/평균/모드 기록.
· **T3 LLM 응답 누락 안전망** — LLM 이 use_seconds 빠뜨린 씬 → splitter 가 `video_clip_default=8.0` 으로 채움. 로그에 default_fallback_count.
· **T4 LLM 가이드라인 위반 clamp** — LLM 이 0.5 / 20 / "8s" 같은 값 → splitter 가 3.0 / 15.0 / 8.0 으로 정규화.
· **T5 Phase 3 모델별 clamp grep 검증** — 위 4개 라인 grep 으로 그대로 존재 확인.
· **T6 Fallback** — `_build_fallback_scenes_v212` 의 결정론 fallback 시 모든 씬 use_seconds=8.0 (변경 없음 — `_fallback_prompts_from_event` 에 use_seconds 키 없으므로 splitter 정규화 단계에서 8.0 박힘 자동).
· **T7 v21.2 회귀** — clips_per_event=2/3/4 모두 scenes 개수 정확.

### 6) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| W1 | Phase 4 audio merge mismatch 가 더 커짐 — 다양한 use_seconds 합 ≠ 음악 길이. | v21.2 결론과 동일 — 사용자가 편집기에서 손편집. mismatch 30s 이상이라도 ffmpeg 가 짧은 쪽 자르거나 freeze. 변화 없음. |
| W2 | 기존 잡(scenes use_seconds=8.0 모두) 재실행 시 라우트 force=true 필수. | `start_phase1` body force=true 명시. 자동 무효화 없음. |
| W3 | LLM 이 use_seconds 를 정수로만 줄 가능성 — UI 표기에서 분수 처리 안 함. | scene 카드 UI 는 이미 `use_seconds.toFixed(1)` 류 표기 — 정수도 8.0 로 표시. 영향 없음. |
| W4 | Veo 본체 8초 고정 + LLM 이 15초 → 8초로 잘림 (사용자 의도 불일치). | UI desc 에 명시("LLM 길이 결정 미적용"). 사용자가 모델 선택 시 인지. |
| W5 | Seedance 5초 미만 LLM 출력 → 5 로 올림 (사용자 의도 불일치). | 동상 — desc 에 "5~15초" 이미 명시. 추가 변경 없음. |
| W6 | LLM JSON 출력 안정성 — use_seconds 가 string "8s" 같은 값. | splitter `_coerce_use_seconds` 헬퍼: float() try/except → 실패 시 default. |
| W7 | 회귀: clips_per_event=2 잡의 짧은 영상 길이 합. 음악 트랙 대비 mismatch 더 큼. | v21.2 합의 그대로. |

### 7) 작업 끝(append).

## v24.1 — 2026-05-29 — Scene patch 시 한국어/영문 mirror 자동 동기화 (LLM)

### 1) 요구사항

· UI 는 한국어 텍스트(`description_ko` / `image_prompt_ko` / `video_prompt_ko`) 편집을 노출하지만 모델 입력은 영문 필드만 사용 (`pre_mv_video_prompts.compose_video_prompt` 와 `pre_mv_phase2_image_generator` 모두 영문 메인). 사용자가 한국어만 수정하면 모델에 반영이 안 됨.
· `PATCH /api/pre-mv/jobs/{id}/scenes/{n}` 가 사용자가 보낸 한국어 ↔ 영문 쌍 중 한쪽만 들어왔으면 LLM 으로 자동 번역해서 반대편 필드를 동기화. 둘 다 들어오면 LLM 호출 없이 그대로 둠.
· 한 번의 LLM 호출에 세 쌍(`description`, `image_prompt`, `video_prompt`) 중 동기화 필요한 것만 묶어 처리. LLM 은 Claude Opus 4.7 우선, 실패 시 OpenAI fallback. 둘 다 실패하면 사용자 변경은 저장하되 응답에 `mirror_sync_failed: true` 플래그.
· 응답에 `mirror_synced_fields`(자동 갱신된 필드 리스트), `mirror_sync_failed` 추가. `user_edited_fields` 에는 사용자가 명시한 필드만 누적 — mirror 갱신된 필드는 누적 안 함.
· Invalidate 정책 확장: image_prompt_ko 만 보냈는데 LLM 이 image_prompt 까지 동기화한 경우 → 모델 입력이 실제로 바뀜 → image+video 둘 다 pending. video_prompt_ko 만 동기화로 video_prompt 갱신 → video pending. 인접 씬 cascade 없음.

### 2) Plan verification findings — 0단계 결과

| 파일 | 라인 | 현재 동작 / 발견 |
|------|------|------------------|
| `backend_8000/app/routes/pre_mv.py` 1765~1868 | `patch_scene` | body 의 (`description`, `description_ko`, `image_prompt`, `image_prompt_ko`, `video_prompt`, `video_prompt_ko`) 6개를 단순 덮어쓰기. 한국어↔영문 동기화 없음. `image_prompt` 또는 `image_prompt_ko` 변경 시 image+video pending, `video_prompt` 또는 `video_prompt_ko` 변경 시 video pending (이미 _ko 도 invalidate 트리거). 그러나 _ko 만 바뀌면 모델 입력이 안 바뀌므로 재생성해도 결과가 같아질 위험. |
| 동상 258~264 | `PatchSceneBody` | 6 필드 Optional, max_length 만 있음. v24.1 신호용 추가 필드 불필요 — 동기화 대상 결정은 백엔드가 dump 보고 판단. |
| `backend_8000/app/services/pre_mv_phase0_mapper.py` 45,84~88,305~322 | LLM 호출 패턴 | `anthropic.AsyncAnthropic` 싱글톤 + `_call_claude(model_id, user_message, max_tokens)` + 실패 시 `_call_openai`. 본 v24.1 mirror 서비스도 같은 패턴 차용. |
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 557~563 | `_resolve_prompt_model` | 환경에 anthropic_api_key 있으면 ("claude", `wedding_lyrics_default_model`="claude-opus-4-7") / 없으면 ("openai", `openai_model_advanced`="gpt-5.4") / 둘 다 없으면 raise. v24.1 mirror 도 동일 우선순위. |
| `backend_8000/app/services/pre_mv_video_prompts.py` 367~503 | `compose_video_prompt` | 영문 필드 (`image_prompt`, `description`, `video_prompt`) 만 사용. `_ko` 미러 무시. → 사용자가 한국어만 수정해도 영상 모델 호출 prompt 가 안 바뀜. |
| `backend_8000/app/services/pre_mv_phase2_image_generator.py` 277~289,451~452 | image_prompt vs image_prompt_ko | `image_prompt` 가 비어 있을 때만 `image_prompt_ko` 를 보조 fallback 으로 user_prompt 에 박음. **사실상 영문 메인.** |
| `backend_8000/app/config.py` 44~51 | 모델 키 | `openai_api_key`, `anthropic_api_key`, `wedding_lyrics_default_model="claude-opus-4-7"`, `openai_model_advanced="gpt-5.4"` 모두 존재. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 1407~1466 | `SceneCard` 편집 폼 | 사용자는 `description_ko`(한국어), `image_prompt`(영문), `video_prompt`(영문) 3 필드만 편집. 즉 디폴트 UI 케이스 = (한국어 description 만 수정) → 영문 자동 동기화 필요. image_prompt/video_prompt 는 영문 편집 → 한국어 미러 자동 동기화 필요. |

핵심 발견: **현 PATCH 는 단순 dict 덮어쓰기 + invalidate 만 한다. 한국어↔영문 의미 동기화는 없다.** v24.1 핵심 동작 = LLM 1회 호출로 누락된 미러 필드 채워넣기.

### 3) 변경 매트릭스

| 파일 | 변경 | 로깅 추적자 |
|------|------|------------|
| `backend_8000/app/services/pre_mv_scene_mirror.py` (신규) | `sync_scene_mirrors(...)` 비동기 함수. Claude Opus 4.7 우선 + OpenAI fallback. 입력 pairs_to_sync = [(source_field, target_field, source_value), ...] → 출력 dict {target_field: translated_value}. LLM 실패 시 빈 dict. 시스템 프롬프트에 멘션 토큰 보존 / 한 줄 출력 / description vs image/video_prompt 길이 가이드라인 / 결혼식 본행사 어휘 금지 명시. | `[PreMVMirror]` prefix + `pre_mv_job_id, scene_number, source_fields, target_fields, model, elapsed_ms`. |
| `backend_8000/app/routes/pre_mv.py` 1765~1868 (`patch_scene` 본문) | 사용자 변경 dict 정규화 → 3 쌍(description, image_prompt, video_prompt) 중 한쪽만 바뀐 페어를 mirror 대상으로 모음 → `sync_scene_mirrors` 호출 → 성공 시 target 필드도 갱신. mirror 갱신된 영문 image_prompt 도 image+video pending 트리거. user_edited_fields 는 mirror 갱신 필드 제외. 응답에 `mirror_synced_fields` / `mirror_sync_failed`. | `[PreMVRoute] action=patch_scene mirror_pairs=... synced=... failed=... user_fields=... invalidate_image=... invalidate_video=...` |
| `backend_8000/app/routes/pre_mv.py` 상단 import | `from ..services.pre_mv_scene_mirror import sync_scene_mirrors` 추가. | n/a |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 783~809 (`patchScene` 핸들러) | api 시그니처 그대로. 응답 data 에서 `mirror_synced_fields`, `mirror_sync_failed` 읽어서 호출자에 전달. | `[PreMVScenesStep] patchScene` 로그에 mirror_synced_fields/mirror_sync_failed 추가. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` `SceneCard.onSave` 1446~1467 | 저장 성공 시 result.data.mirror_synced_fields 있으면 안내 메시지(green) "영문도 자동 동기화됐어요" 표시. mirror_sync_failed 면 경고(amber) "한국어/영문 자동 동기화에 실패했어요. 영문도 직접 수정해 주세요". | n/a |

### 4) LLM 호출 정책

· **provider 우선순위**: anthropic_api_key 있으면 Claude (`wedding_lyrics_default_model` = claude-opus-4-7) → 없으면 OpenAI (`openai_model_advanced` = gpt-5.4) → 둘 다 없으면 LLM 호출 자체 skip + `mirror_sync_failed = True`.
· **호출 횟수**: PATCH 당 최대 1회. 3 쌍 중 동기화 필요한 항목 모두 한 번에 묶음. 동기화 대상 0개면 호출 skip.
· **timeout / retry**: Claude 1차 호출 실패(network/모델 에러) → OpenAI 자동 fallback. fallback 도 실패 → `mirror_sync_failed = True`. 사용자 변경분은 그대로 저장.
· **응답 검증**: JSON parse 실패, translations 키 누락, 요청한 target_field 결과 누락 → 누락된 페어는 mirror 안 갱신. 일부만 성공한 경우 성공한 것만 반영.
· **max_tokens**: 페어당 ~200 토큰 추정 × 3쌍 + 안전 마진 → 1500. Claude opus 4.7 출력 한계 안.

### 5) 테스트 항목

· **T1 health/auth** — 백엔드 reload 후 import OK, GET `/api/health` 200, PATCH no-auth → 401, body 빈 객체 → 200 + `updated_fields=[]`.
· **T2 한국어만 수정** — `{"description_ko": "신랑이 코트를 건넨다"}` PATCH → 응답 `updated_fields=["description_ko"]`, `mirror_synced_fields=["description"]`, `mirror_sync_failed=false`. mongo 도큐의 `description` 도 LLM 영문 번역으로 갱신. `user_edited_fields` 에는 description_ko 만 누적.
· **T3 영문만 수정** — `{"description": "Groom offers his coat to the bride"}` → `mirror_synced_fields=["description_ko"]`. description_ko 한국어 번역 갱신.
· **T4 둘 다 수정** — `{"description": "...", "description_ko": "..."}` → `mirror_synced_fields=[]` (LLM 호출 안 함). 둘 다 사용자 값 그대로.
· **T5 image_prompt_ko 만 수정 + invalidate** — `{"image_prompt_ko": "..."}` → mirror_synced_fields=["image_prompt"] + scene.image_status=pending + scene.video_status=pending.
· **T6 video_prompt_ko 만 수정 + invalidate** — video_status=pending. image_status 는 그대로.
· **T7 LLM 실패 fallback 시뮬레이션** — Anthropic 키 임시로 빈 문자열 + OpenAI 키도 빈 → `mirror_sync_failed=true` + 사용자 값만 저장. 로그에 fallback path 확인.
· **T8 변경 없음** — 같은 값으로 PATCH → `updated_fields=[]`, mirror 호출 안 함.
· **T9 회귀 (둘 다 변경, 다른 페어는 한쪽만)** — `{"description_ko": "..", "image_prompt": ".."}` → mirror_synced_fields = ["description", "image_prompt_ko"] 두 항목 한 번에.

### 6) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| W1 | 기존 PATCH 호출자(프런트 SceneCard / e2e 테스트 / admin tool)가 새 응답 키를 모름. | 신규 키는 추가만 — 기존 `scene_number`, `updated_fields`, `scene` 그대로 유지. mirror_synced_fields default []. mirror_sync_failed default false. 호환 OK. |
| W2 | LLM 호출 지연으로 PATCH p99 가 늘어남(Claude opus 4.7 응답 ~3-7s). | 사용자가 편집 저장 시점만 추가 호출 — 인터랙티브 가능 시간. 동기화 필요 없는 페어(둘 다 보냄/하나도 안 보냄) 케이스는 호출 없음. 응답 size 작아 max_tokens=1500 안에 끝남. |
| W3 | LLM 이 멘션 토큰(@groom_casual 등)을 번역 또는 누락 시 모델 입력 깨짐. | 시스템 프롬프트에 "멘션 토큰 그대로 보존" 절대 규칙 + 길이 가이드라인. 응답 검증 단계에서 멘션 토큰 카운트 비교는 v24.2 로 보류 — 현 단계는 프롬프트 신뢰. |
| W4 | LLM 이 결혼식 본행사 어휘(ceremony, altar, vows) 를 생성해 식전영상 컨셉 깨뜨림. | 시스템 프롬프트 금지 어휘 명시 + 본 라우트의 mirror 는 사용자의 한국어/영문 입력의 번역만 — 큰 컨텍스트 변환 아님. |
| W5 | LLM 실패 시 사용자가 한국어만 수정했는데 영문이 안 따라가 → 영상 재생성해도 변화 없음. | 응답에 `mirror_sync_failed=true` 명시 + 프런트 SceneCard 가 사용자에게 "영문도 직접 수정해 달라" 경고. invalidate 는 그대로(pending) 이지만 재생성 시 모델 입력은 똑같음 → 사용자가 인지 후 영문 수정 필요. |
| W6 | image_prompt_ko 만 보냈는데 LLM 이 image_prompt 까지 갱신 → 사용자가 의도하지 않은 영문 변화 → user_edited_fields 에 들어가야 하는지. | 합의: mirror 갱신 필드는 user_edited_fields 에 안 박음. 사용자가 명시적으로 보낸 필드만 누적. |
| W7 | "변경 없음" PATCH 가 LLM 호출 트리거할 위험. | `field_dump` 보고 prev == val 이면 updated_fields 추가 안 함. updated_fields 없으면 mirror 결정 단계 자체 skip. |

### 7) 작업 끝(append).



---

## v24.2 — 2026-05-29 — Step 4 라이브 갤러리 + 일괄 다운로드

### 1) 요구사항 (10줄)
1. Step 4(씬 영상 / Phase 3) 카드 내부에 영상 생성 중에도 **씬 카드 그리드를 항상 노출**.
2. 그리드는 **챕터(story_slot 연속 묶음) 단위로 그룹핑** — v24 백엔드 `_group_scenes_into_chapters` 와 동일 패턴.
3. 각 챕터 헤더에 "Chapter: {slot} — N/M 완료" + 미니 progress bar.
4. 각 씬 카드: `#N` | story_slot 배지 | video_status 배지(색) + **씬 이미지 썸네일 상단 항상** + 영상 영역 하단(상태별 분기).
5. completed 씬은 인라인 `<video controls preload="metadata">` 200x113 + [⬇ 다운로드] anchor.
6. failed 씬은 에러 + [🔄 다시 시도] 버튼.
7. **선택 모드** — 카드 우측 상단 체크박스, 액션 바: [선택] / [전체 선택] / [해제] / [⬇ 선택 ZIP] / [⬇ 전체 ZIP] / [취소].
8. 신규 백엔드: `POST /api/pre-mv/jobs/{id}/scenes/download-zip` (body `{scene_numbers: [int] | null}`) → ZIP stream.
9. 파일명 규칙: `{NN}_{story_slot}_{seq_in_slot}.mp4` (예: `01_meeting_a.mp4`, `04_first_date_a.mp4`). seq_in_slot = 같은 챕터 안 a/b/c 순서.
10. 폴링은 기존 5초 그대로 — generating → completed 전이 시 자연 갱신으로 `<video>` 활성화.

### 2) Plan verification findings — 0단계 결과
- 단일 다운로드 라우트 **이미 존재**: `GET /api/pre-mv/jobs/{id}/scenes/{n}/video` (`pre_mv.py:2909`) — Bearer/token 둘 다 지원, StreamingResponse video/mp4. 신규 추가 불필요. 다운로드 anchor 도 같은 URL 에 `download` 속성만 추가하면 됨.
- 챕터 그룹핑 헬퍼: `_group_scenes_into_chapters(scenes)` (`pre_mv.py:924`) — story_slot 연속 묶음 0-based index 리스트. 프런트도 동일 패턴.
- `PreMVVideosStep` 은 현재 헤더/모델 선택/시작 버튼/전체 progress bar 만 — **씬 카드 그리드 노출 안 함** (씬 카드 본체는 Step 2 의 `PreMVScenesStep`). v24.2 는 Step 4 안에 **읽기 전용 라이브 갤러리** 를 새로 추가.
- 호출처가 `PreMVVideosStep` 에 `preMVJobId` / `onRegenerateSceneVideo` 미전달 — 본 작업에서 추가.
- `api.preMVSceneVideoUrl(id, n)` 함수 이미 존재 — `<video src>` 와 `<a download href>` 양쪽에 그대로 사용.
- 기존 ZIP 패턴은 `downloadExtraSceneImage(id)` 의 `responseType:'blob'` GET — 본 작업은 POST blob.

### 3) 변경 매트릭스

| # | 파일 | 변경 |
|---|------|------|
| B1 | `backend_8000/app/routes/pre_mv.py` | (a) 단일 영상 라우트 응답에 `Content-Disposition: attachment` 헤더 추가. (b) 신규 라우트 `POST /jobs/{id}/scenes/download-zip`. (c) Pydantic body `DownloadZipBody`. (d) 헬퍼 `_compute_scene_filename(scenes, idx)` — `{NN}_{slot}_{seq}.mp4`. |
| F1 | `frontend/src/api/index.js` | (a) `downloadPreMVSceneVideo(id, n)` 별칭. (b) `downloadPreMVScenesZip(id, sceneNumbers)` POST blob. |
| F2 | `frontend/src/components/PreCeremonyMVPanel.jsx` | (a) `PreMVVideosStep` 시그니처에 `preMVJobId`, `onRegenerateSceneVideo` 추가. (b) 헬퍼 `groupScenesByChapter`, `computeSceneFilename`. (c) 컴포넌트 `ChapterGroup`, `LiveSceneCard`. (d) 선택 모드 상태 + 액션 바. (e) ZIP 다운로드 핸들러. |
| F3 | `frontend/src/components/PreCeremonyMVPanel.css` | (a) `.pre-mv-videos__live-gallery`. (b) `.pre-mv-chapter-group` + `__header` + `__progress`. (c) `.pre-mv-live-scene-card` + 상태별 색. (d) 액션 바. |

### 4) REST API (신규 + 보강)

#### B1-a. GET `/api/pre-mv/jobs/{pre_mv_job_id}/scenes/{n}/video` (보강)
- 기존 동작 그대로 — Bearer OR `?token=` 인증. owner+admin 가드.
- **추가**: 응답 헤더 `Content-Disposition: attachment; filename="{NN}_{slot}_{seq}.mp4"`.
- 인라인 `<video src>` 사용 시에도 attachment 헤더 무시하고 재생 — 회귀 안전.

#### B1-b. POST `/api/pre-mv/jobs/{pre_mv_job_id}/scenes/download-zip` (신규)
- body: `{"scene_numbers": [int] | null}` — null/빈 배열 → 전체(completed 만 자동 필터).
- 명시 시 → 명시된 씬 번호만(없거나 완료 안 된 씬은 skip).
- 권한: owner + admin (`_resolve_pre_mv_job`).
- 응답: `StreamingResponse(io.BytesIO, media_type="application/zip")` + `Content-Disposition: attachment; filename="pre_mv_{id}_{YYYYMMDD}.zip"`.
- ZIP 안: 파일명 `{NN}_{story_slot}_{seq_in_slot}.mp4`. ZIP_STORED 모드(이미 압축된 mp4 재압축 안 함).
- 422: 명시했는데 완료된 씬이 하나도 없으면 `{"error": "다운로드할 완료된 씬이 없어요."}`.
- 401: Bearer 미전송.

#### F1. 프런트 함수
- `downloadPreMVSceneVideo(id, sceneNumber)` — `preMVSceneVideoUrl` 의 별칭. `<a download href={url}>`.
- `downloadPreMVScenesZip(id, sceneNumbers=null)` — POST blob.

### 5) UI 변경 — Step 4 내부 라이브 갤러리

- 기존 헤더 + 모델 + 시작버튼 + 전체 progress 그대로. 그 아래에 **라이브 갤러리 + 액션 바** 추가.
- `ChapterGroup` — props: `chapter, preMVJobId, selectMode, selectedSet, onToggle, onRegenerate, computeFilename`.
- `LiveSceneCard` — props: `scene, preMVJobId, selectMode, selected, onToggle, onRegenerate, filename`.
  - 상태별 영상 영역: pending(회색), generating(노랑+스피너), completed(`<video>` + 다운로드 anchor), failed(빨강+재시도).
  - 상단 항상 씬 이미지(`api.preMVSceneImageUrl`).
  - 우상단 체크박스(선택 모드 시) — `disabled={video_status !== 'completed'}`.
- 액션 바: 선택 모드 OFF → `[☑ 선택]`; ON → `[N개 선택]` `[전체 선택]` `[해제]` `[⬇ 선택 ZIP]` `[⬇ 전체 ZIP]` `[취소]`.
- ZIP 다운로드 최대 50개 클라이언트 제한.

#### 챕터 그룹핑 헬퍼 (프런트)
```js
function groupScenesByChapter(scenes) {
  const out = [];
  let cur = null;
  let prevSlot = null;
  scenes.forEach((s, idx) => {
    const slot = s?.story_slot || '';
    if (!cur || slot !== prevSlot) {
      cur = { slot, scenes: [], startIdx: idx };
      out.push(cur);
      prevSlot = slot;
    }
    cur.scenes.push({ ...s, _origIdx: idx });
  });
  return out;
}
```

#### 파일명 (프런트 = 백엔드 동일)
```js
function computeSceneFilename(chapters, scene) {
  const ch = chapters.find(c => c.scenes.some(s => s.scene_number === scene.scene_number));
  const seqIdx = ch.scenes.findIndex(s => s.scene_number === scene.scene_number);
  const seqChar = String.fromCharCode(97 + seqIdx);
  const slot = scene.story_slot || 'unknown';
  return `${String(scene.scene_number).padStart(2,'0')}_${slot}_${seqChar}.mp4`;
}
```

### 6) 테스트 항목
- **T1 health/import** — 백엔드 reload 후 import OK, GET `/api/health` 200.
- **T2 단일 영상 라우트 회귀** — Content-Disposition 추가 후에도 인라인 `<video>` 정상.
- **T3 ZIP 401** — POST `/scenes/download-zip` Bearer 없이 → 401.
- **T4 ZIP 422 invalid body** — `{"scene_numbers": "abc"}` → 422.
- **T5 ZIP 전체 (null)** — 200 application/zip, 완료 씬만 포함, 파일명 규칙 일치.
- **T6 ZIP 선택** — `{"scene_numbers": [1, 4]}` → 두 파일만.
- **T7 ZIP 모두 미완료** → 422.
- **T8 프런트 build** — `npm run build` 통과.
- **T9 시뮬레이션 — 잡 6a17f8eb** — scenes 의 story_slot 시퀀스로 챕터 5개 분리 확인.

### 7) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| W1 | `Content-Disposition: attachment` 가 인라인 `<video>` 재생 깨뜨릴 위험. | Chrome/Safari/Firefox 모두 `<video>` element 가 attachment 헤더 무시하고 재생 — 회귀 없음. |
| W2 | ZIP 메모리 폭발(50개 × 10MB). | `io.BytesIO` + ZipFile mode='w' compression=ZIP_STORED (mp4 재압축 X). 50개 제한 + per-scene MinIO stream→write. ~500MB 까지 안전 한계. |
| W3 | 한국어 파일명 인코딩. | story_slot 키는 영문 고정 — 안전. |
| W4 | 선택 모드에서 미완료 씬 선택 가능 시 422. | 체크박스 `disabled={video_status !== 'completed'}`. |
| W5 | 폴링 5초 — completed 전이 후 src 갱신 안 됨. | 기존 `video_finished_at` cacheKey 패턴 유지. |
| W6 | `PreMVVideosStep` 시그니처 추가로 호출처 미수정 시 런타임 오류. | 호출처 동시 갱신. |
| W7 | 챕터 그룹핑이 백엔드와 어긋나면 파일명 불일치. | 프런트=백엔드 동일 로직(story_slot 연속). |

### 8) 작업 끝(append).

## v21.4 — 2026-05-29 — LLM 자율 결정 (씬 개수 + 길이 + 총합 ≥ 음악×2)

### 1) 요구사항

· v21.2 의 `clips_per_event` 사용자 입력(2/3/4 라디오)을 폐기 — LLM 이 각 `scenario_event` 의 내용 풍부도에 맞춰 씬 개수(권장 1~6)를 자체 결정.
· 씬 길이도 v21.3 의 3~15초 가이드라인을 **5~15초** 로 갱신 + LLM 이 description 호흡에 맞춰 자체 결정. 결정론적 채움(Fallback)도 동일 범위.
· **음악 길이** 를 splitter 에 입력으로 전달 (`music_duration_sec`). mv_jobs 의 `lyric_timestamps_variants[str(variant)][-1].end` 1순위, `lyric_timestamps[-1].end` 2순위, 180s fallback.
· LLM 응답 JSON 스키마 확장: `{ "total_use_seconds": float, "scenes": [...] }`. 모든 씬의 use_seconds 합 ≥ `music_duration_sec × 2` 보장(최소). 풍부하면 더 늘려도 좋음 / 빈약하면 자연스러운 한도까지만.
· 검증: 응답 총합 < `music_duration_sec × 1.8` 면 강조 prompt 로 1회 retry. retry 도 미달이면 그 결과를 채택 (LLM 한도로 간주).
· Fallback (`_build_fallback_scenes_v212`) 음악 길이 받음 — event 당 평균 5 씬 × 평균 13s 로 결정론 분배 (짧·중·긴 패턴 섞기, 대략 음악×2 보장).
· 라우트 응답에 `target_total_seconds` (= music_duration_sec × 2) + `actual_total_seconds` (= 실제 씬 합) 노출. UI 가 "총합 X분 Y초 (음악의 Z배)" 표시.
· UI: Step 2 라디오 제거 + 안내문구 한 줄. Step 4 Veo `disabled: true` + 기본 모델 Seedance.
· `api/index.js` `runPreMVPhase1` 시그니처 단순화 (clips_per_event 인자 받아도 무시 — backward compat).

### 2) Plan verification findings — 0단계 결과

| 파일 / 위치 | 라인 | 현재 동작 / 발견 |
|------|------|------------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 92 | `_VIDEO_CLIP_DEFAULT = 8.0` | 결정론 fallback / use_seconds 누락 시 박는 기본값. |
| 동상 679~680 | `_USE_SECONDS_MIN_V213 = 3.0`, `_USE_SECONDS_MAX_V213 = 15.0` | v21.3 안전 clamp 범위 — v21.4 에선 LLM 가이드라인을 5~15 로 올리되 splitter clamp 는 5~15 로 함께 갱신. |
| 동상 342~403 | `SCENE_SPLIT_SYSTEM_PROMPT_V212` | `clips_per_event` 강제 분배 안내 + use_seconds 3~15. v21.4 에서 "event 당 1~6 씬 자율 결정 + 총합 ≥ 음악×2" 안내로 교체. |
| 동상 460~498 | `_build_user_message_v212` | clips_per_event/events_count 출력. v21.4 에서 `music_duration_sec` + `target_total_seconds` 출력. |
| 동상 1239~1260 | `_build_fallback_scenes_v212` | event 당 정확히 cpe 씬 균등 채움. v21.4 에서 음악 길이 받아 평균 5 씬 / 13s 분배로 교체. |
| 동상 1267~1488 | `split_into_scenes_v212` | 시그니처 `clips_per_event: int` 필수. v21.4 에서 `music_duration_sec: float` 추가 + clips_per_event 제거. 응답에 `target_total_seconds`/`actual_total_seconds` 키 추가. |
| 동상 1267~1356 (LLM 호출 블록) | scenes 부족 시 fallback. v21.4 에서 총합 < target×0.9 시 1회 retry (강조 system prompt). |
| `backend_8000/app/routes/pre_mv.py` 229~232 | `StartPhase1Body` — `clips_per_event: Literal[2,3,4] = 3`. v21.4 에서 Optional 로 변경(받아도 무시) + Deprecated 주석. |
| 동상 165~211 (`_serialize_pre_mv_job`) | `clips_per_event` 응답. v21.4 에서 `target_total_seconds` / `actual_total_seconds` 키 추가 (저장된 값 노출). |
| 동상 743~836 (`_run_phase1`) | doc.clips_per_event 사용. v21.4 에서 mv_job 조회 → music_duration 계산 → splitter 에 전달. 응답 저장 시 `target_total_seconds` / `actual_total_seconds` 채움. |
| **mv_jobs schema (라이브)** | mongo 직접 조회 결과 | `lyric_timestamps_variants[str(variant)][-1].end` 가 음악 종료 지점 (잡 6a169ecc v1 = 196.755s / v2 = 264.176s). 별도 `audio_duration` 필드 없음. fallback: `lyric_timestamps[-1].end`. 둘 다 없으면 180.0 사용. |
| `frontend/src/components/PreCeremonyMVPanel.jsx` 70~75 | `VIDEO_MODELS` Veo desc 갱신. v21.4 — Veo `disabled: true` 플래그 추가 + 기본 `initialModel = 'seedance'`. |
| 동상 1209~1352 (`PreMVScenesStep`) | clips_per_event 라디오 + 상태. v21.4 — 라디오 제거 + 안내 문구 + 결과 표시. |
| 동상 510~542 (`startPhase1`) | `clipsPerEvent=3` 인자 받음. v21.4 — 그대로 받되 무시 (UI 콜 사이트도 인자 미전달로 단순화). |
| 동상 2504~ (`PreMVVideosStep`) | `initialModel = 'veo'`. v21.4 — `'seedance'`. radio disabled 분기에 model 자체 disabled 추가. |
| `frontend/src/api/index.js` 296~297 | `runPreMVPhase1(id, { force, clips_per_event=3 })`. v21.4 — `runPreMVPhase1(id, { force })` 시그니처, body 도 force 만 전송. |

### 3) 변경 매트릭스 — 파일별 변경 + 로깅 추적자

| 파일 | 변경 | 로깅 추적자 |
|------|------|------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 헤더 docstring | v21.4 정책 (LLM 자율 결정 + music×2 보장 + retry) 추가. | n/a |
| 동상 `_USE_SECONDS_MIN_V213` = 5.0 (3.0→5.0). 시스템 프롬프트 길이 가이드라인 5~15 으로 갱신. | clamp 범위 갱신. | n/a |
| 동상 `SCENE_SPLIT_SYSTEM_PROMPT_V212` 본문 교체 — clips_per_event 강제 분배 안내 제거 + event 당 1~6 씬 자율 / use_seconds 5~15 / total_use_seconds ≥ music×2 / 응답 JSON 에 total_use_seconds 포함. | n/a |
| 동상 `_build_user_message_v212(scenario_text, scenario_events, music_duration_sec)` 으로 시그니처 변경. | n/a |
| 동상 `_build_fallback_scenes_v212(events, music_duration_sec, video_clip_default)` — 음악×2 목표로 event 당 평균 5 씬 / 평균 13s 결정론 분배. | n/a |
| 동상 `split_into_scenes_v212` 시그니처 — `clips_per_event` 제거, `music_duration_sec: float` 추가. LLM 호출 후 총합 검증 → < music×1.8 retry 1회 → 결과 채택. response 에 `target_total_seconds`, `actual_total_seconds` 키 추가. | music_duration_sec, target_total_seconds, actual_total_seconds, total_ratio, retry_attempted, retry_total_seconds |
| `backend_8000/app/routes/pre_mv.py` `StartPhase1Body` | `clips_per_event` Optional + Deprecated (받아도 무시). | n/a |
| 동상 `_run_phase1` | mv_job 조회 → music_duration 계산 (lyric_timestamps_variants→lyric_timestamps→180 fallback). splitter 호출 시그니처 갱신. 응답 저장 시 `target_total_seconds`, `actual_total_seconds` 키 영속화. | music_duration_sec, target_total_seconds, actual_total_seconds, scene_count, scene_count_per_slot |
| 동상 `_serialize_pre_mv_job` | `target_total_seconds`, `actual_total_seconds` 노출. | n/a |
| `frontend/src/api/index.js` 296~297 (`runPreMVPhase1`) | body 에서 clips_per_event 제거. force 만 전송. backward-compat: 함수는 clips_per_event 받아도 무시. | n/a |
| `frontend/src/components/PreCeremonyMVPanel.jsx` `VIDEO_MODELS` (70~75) | Veo 항목 `disabled: true` + desc "Veo 3.1 — 8초 고정 / 현재 비활성화". | n/a |
| 동상 `PreMVVideosStep` initialModel | `'veo'` → `'seedance'`. 라디오 disabled 시 시각적 회색 + 클릭 방지 (`disabled` 속성 + radio disabled). | n/a |
| 동상 `PreMVScenesStep` | clips_per_event 라디오 제거 + 안내문구 한 줄 + 결과 표시 (총합 X분 Y초 / 음악의 Z배). | n/a |
| 동상 `startPhase1` 호출처 | clipsPerEvent 인자 폐기. force 만 전달. | n/a |

### 4) LLM 호출 정책 (자율 결정 + retry)

| 단계 | 동작 |
|------|------|
| 1. system prompt | v21.4 신규 — "event 당 자율 결정 1~6 씬, 길이 5~15 자율, 총합 ≥ 음악×2 보장, 빈약하면 자연한도까지만, 응답에 total_use_seconds 포함" |
| 2. user message | music_duration_sec / target_total_seconds (=music×2) 명시. events 전체 리스트. |
| 3. LLM call | Claude opus-4-7 기본. max_tokens = scene_count × 600 (cap 12000). scene_count 미지 → events × 5 추정. |
| 4. parse | `{ total_use_seconds, scenes[] }` 추출. scenes 의 실제 use_seconds 합산 → `actual_total`. |
| 5. retry 조건 | `actual_total < music_duration_sec × 1.8` 이면 retry 1회. 강조 system prompt: "총합 부족 — music×2 이상 보장하라". |
| 6. fallback | LLM 실패 / 빈 응답 → `_build_fallback_scenes_v212(events, music_duration_sec)` 결정론. |
| 7. 정규화 | 씬당 use_seconds clamp(5.0, 15.0). 누락 시 video_clip_default(=8.0) — 단 fallback 결정론은 이미 분포 채움. |

### 5) 테스트 항목

· **T1** — `python -c "import app.services.pre_mv_phase1_splitter; import app.routes.pre_mv"` import OK.
· **T2** — GET `/api/health` 200.
· **T3** — POST `/api/pre-mv/jobs/{id}/phase1` no-auth → 401.
· **T4** — 라이브 잡 `6a17f8eb90a2818ef41ee885` force=true phase1 재실행.
  - 응답 `target_total_seconds ≈ 393.51` (music 196.755 × 2). `actual_total_seconds ≥ 354` (≥ music×1.8). 이상적으로 ≥ 393.
  - 씬 개수가 챕터(scenario_event)마다 같지 않음 (분산 ≥ 1).
  - use_seconds 분포가 ≥ 4종 (단일 값 아님).
· **T5** — Phase 1 응답 (light=False) 에 `target_total_seconds`, `actual_total_seconds` 두 키 노출.
· **T6** — UI: Step 2 라디오 0개. Step 2 안내문구 노출. Step 4 Veo 라디오 disabled. 기본 선택 Seedance.
· **T7** — 프론트 `npm run build` 통과.
· **T8** — 회귀: `StartPhase1Body` 가 `clips_per_event: 3` body 받아도 422 안 남 + 무시.
· **T9** — Fallback only 경로: LLM 키 일시 제거 시뮬레이션은 skip (시간), 코드 리뷰만.

### 6) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| W1 | 총합 ≥ music×2 강요 → LLM 이 억지로 늘려 의미없는 씬 양산. | 시스템 프롬프트 "내용 빈약하면 자연 한도까지만" 명시 + retry 1회만. |
| W2 | clips_per_event 폐기로 기존 잡(`clips_per_event` 저장된) 재실행 시 무시. | StartPhase1Body Optional 유지 + `_run_phase1` 에서 doc.clips_per_event 미참조. |
| W3 | mv_job 의 lyric_timestamps_variants 가 비어 있는 잡 (legacy) → 단수 lyric_timestamps → 180 fallback 까지 떨어짐. | 단계별 fallback 명시 + 로그. |
| W4 | LLM 응답에 total_use_seconds 누락 → splitter 가 scenes 직접 합산 사용. | 코드: response.get("total_use_seconds") 만 신뢰 X, scenes 합산으로 actual_total 결정. |
| W5 | Veo disabled 로 인해 기존 video_model="veo" 락된 잡의 재시작 거부 위험. | UI 단순 라디오만 disabled. `lockedModel` 경로는 그대로 유지(잡이 이미 veo 로 락이면 그 모델 표시). |
| W6 | Phase 3 generator 들이 use_seconds 5 미만 받지 않게 — 기존 clamp 가 처리. Kling clamp(3,15) / Seedance(5,15) / Grok(1,10) 그대로. | 영향 없음. |
| W7 | max_tokens scene 추정 (events × 5) 이 LLM 출력 길이 초과 시 truncation. | per_scene 600 + cap 12000. event 6개 × 5 = 30 씬 = 18000 → cap 12000 트리거 가능. cap 14000 으로 살짝 상향 검토. (v21.3 는 18000 부분 잘렸음). 본 라운드는 12000 유지(현 잡 6 events × 6 max = 36 씬 한계). |
| W8 | 프론트 build 에서 PreMVVideosStep 의 disabled 라디오 클래스 미정의 시 시각 회색 불일치. | inline style `opacity: 0.5` + radio `disabled` 속성으로 처리. |

### 7) 작업 끝(append).

## v21.5 — 2026-05-29 — LLM 라벨 의존 제거 (event_index + 코드 로직)

### 1) 요구사항

· v21.4-hotfix 라이브 검증에서 LLM 이 마지막 4개 씬의 `story_slot` 을 "wedding_prep" 대신 "proposal" 로 잘못 박는 라벨링 실수 발생. story_slot 같은 결정론적 값은 LLM 한테 받지 말고 코드 로직으로 박는다.
· LLM 응답 스키마에서 `story_slot` / `memory_index` / `ref_sheet_ids` / `ref_place_ids` 4개 필드를 제거하고, **`event_index: int` 단 하나만** 받는다 (0 ~ events.length-1, 이 씬이 어느 event 의 컷인지).
· 백엔드 post-process 에서 `event_index` 로 events 룩업 → 그 event 의 `story_slot` / `memory_index` / `refs` 를 코드가 강제 박음 (`section` 도 호환 위해 `story_slot` 같이 채움).
· 모든 event 에 최소 1 씬 분배 보장 — LLM 응답에서 추출한 event_index 집합과 expected events 인덱스 집합 비교 → 누락 시 강조 prompt 1회 retry → 그래도 부족하면 누락된 event 마다 fallback 씬 1개씩 자동 추가.
· event 순서 보장 — scenes 배열의 `event_index` 가 단조 증가 또는 동일하지 않으면 코드가 자동 정렬 (asc + 동일 안에서 응답 순서 유지).

### 2) Plan verification findings — 0단계 결과

| 파일 / 위치 | 라인 | 현재 동작 / 발견 |
|------|------|------------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 355~432 | `SCENE_SPLIT_SYSTEM_PROMPT_V212` | event 당 1~6 씬 자율 + `story_slot` 도메인을 LLM 이 결정 + ref_sheet/place_ids 도 LLM 이 채움. v21.5 에서 스키마 4개 필드 (`story_slot`/`memory_index`/`ref_sheet_ids`/`ref_place_ids`) 제거 + `event_index: int` 추가. 절대 규칙에 "결정론적 값은 시스템이 자동으로 채운다 — 절대 응답에 박지 마라" 추가. |
| 동상 496~533 | `_build_user_message_v212` | events 순서 보존 + 자율 분할 안내. v21.5 — event_index 가 0 ~ events_count-1 정수, 각 씬에 명시, 단조 증가, 모든 event 한 번 이상 등장 추가. |
| 동상 1320~1643 | `split_into_scenes_v212` | LLM 응답 받은 후 LLM 의 `story_slot` 변경 시점으로 ev_idx 진행 (휴리스틱). v21.5 — `event_index` 정수 직접 사용 + 안전 보정. 모든 event 분배 검증 + retry 1회 + fallback 자동 추가 + event_index 단조 증가 정렬. |
| 동상 1494~1597 (출력 정규화 루프) | LLM 응답의 `story_slot`/`memory_index`/`ref_sheet_ids`/`ref_place_ids` 신뢰 (없으면 events fallback). v21.5 — LLM 응답에서 위 4개 필드 무시 + `event_index` 만 사용 + `events[event_index]` 에서 모든 라벨/refs 강제 박기. |
| 동상 1404~1418 `_try_call` | system_prompt 인자 받음. v21.5 — retry 시 누락 event_index 명시 prompt 로 갱신. |
| (참고) `backend_8000/app/routes/pre_mv.py` 826 | `split_into_scenes_v212` 호출. 시그니처 변경 없음 → 영향 없음. |
| (참고) `_build_fallback_scenes_v212` 1274~1313 | event 당 정확히 3 씬 결정론 분배 (`event_index` 키 안 박음). v21.5 — fallback 도 결과 dict 에 `event_index` 키 추가 (post-process 가 공통 경로로 처리 가능). |

### 3) LLM 응답 스키마 before/after

#### Before (v21.4)
```json
{
  "section": str,
  "story_slot": "meeting|first_date|memory|proposal|wedding_prep|rituals",
  "memory_index": int|null,
  "ref_sheet_ids": [str],
  "ref_place_ids": [str],
  "description": str, "description_ko": str,
  "image_prompt": str, "image_prompt_ko": str,
  "video_prompt": str, "video_prompt_ko": str,
  "use_seconds": number
}
```

#### After (v21.5)
```json
{
  "event_index": int,
  "description": str, "description_ko": str,
  "image_prompt": str, "image_prompt_ko": str,
  "video_prompt": str, "video_prompt_ko": str,
  "use_seconds": number
}
```

### 4) post-process 로직 (story_slot / memory_index / refs / section 강제 박기)

```python
for sc in llm_scenes:
    ev_idx = sc.get("event_index")
    # 검증: 정수 0 ~ len(events)-1. 실패 시 안전 보정.
    if not isinstance(ev_idx, int) or not (0 <= ev_idx < len(events)):
        try:
            ev_idx = int(ev_idx) if ev_idx is not None else 0
        except (TypeError, ValueError):
            ev_idx = 0
        ev_idx = max(0, min(len(events) - 1, ev_idx))
    ev = events[ev_idx] or {}
    sc["event_index"] = ev_idx
    # story_slot — events 의 값을 강제. 도메인 밖이면 "memory".
    slot = ev.get("story_slot") or "memory"
    if slot not in VALID_STORY_SLOTS:
        slot = "memory"
    sc["story_slot"] = slot
    # memory_index — memory 슬롯에서만 의미.
    if slot == "memory":
        try:
            mem = int(ev.get("memory_index")) if ev.get("memory_index") is not None else 0
        except (TypeError, ValueError):
            mem = 0
    else:
        mem = None
    sc["memory_index"] = mem
    # refs — events.refs 에서 자동 추출.
    refs = ev.get("refs") or []
    sc["ref_sheet_ids"] = [
        str(r["asset_id"]) for r in refs
        if isinstance(r, dict) and r.get("type") == "sheet" and r.get("asset_id")
    ]
    sc["ref_place_ids"] = [
        str(r["asset_id"]) for r in refs
        if isinstance(r, dict)
           and r.get("type") in ("place", "wedding_photo")
           and r.get("asset_id")
    ]
    # section — 호환 키. story_slot 그대로.
    sc["section"] = slot
```

### 5) 검증 — 모든 event 분배 보장 + 순서 보장

```python
# (A) 분배 검증
scene_ev_indices = {sc.get("event_index") for sc in llm_scenes if isinstance(sc.get("event_index"), int)}
expected_indices = set(range(len(events)))
missing = expected_indices - scene_ev_indices

if missing:
    # 1회 retry — 강조 prompt 로 누락 event_index 명시.
    retry_prompt = (
        SCENE_SPLIT_SYSTEM_PROMPT_V215
        + f"\n\n[중요 보강] 직전 응답에서 event_index = {sorted(missing)} 에 대한 씬이 누락됨.\n"
        "이번 응답에서는 그 event 들을 빠뜨리지 말고 모든 event_index 0 ~ N-1 에 최소 1 씬을 분배하라."
    )
    retry_parsed = await _try_call(retry_prompt)
    retry_missing = expected_indices - {
        sc.get("event_index") for sc in retry_parsed if isinstance(sc.get("event_index"), int)
    }
    if len(retry_missing) < len(missing):
        llm_scenes = retry_parsed
        missing = retry_missing

# retry 도 부족하면 fallback 씬 직접 추가.
if missing:
    for mi in sorted(missing):
        ev = events[mi]
        fb = _fallback_prompts_from_event(ev, ev.get("story_slot") or "memory")
        fb["event_index"] = mi
        fb["use_seconds"] = 8.0
        llm_scenes.append(fb)

# (B) 순서 보장 — event_index 단조 증가 (같은 값은 응답 순서 유지).
llm_scenes.sort(key=lambda sc: (sc.get("event_index", 0)))
```

### 6) 변경 매트릭스 — 파일별 변경 + 로깅 추적자

| 파일 | 변경 | 로깅 추적자 |
|------|------|------------|
| `backend_8000/app/services/pre_mv_phase1_splitter.py` 헤더 docstring | v21.5 정책 (event_index + 코드 로직 라벨) 추가. | n/a |
| 동상 `SCENE_SPLIT_SYSTEM_PROMPT_V215` 신설 | 출력 스키마 갱신 (event_index 단일, story_slot/refs 제거). 절대 규칙 갱신 ("결정론 라벨 응답 금지" + "모든 event 분배" + "event_index 단조 증가"). | n/a |
| 동상 `_build_user_message_v212` 본문 | events 출력 시 `index=N` 명시. 요구문에 "각 씬에 event_index (0~N-1) 박아라 / 모든 event 한 번 이상" 추가. | n/a |
| 동상 `_build_fallback_scenes_v212` | 결과 dict 에 `event_index` 키 추가 (post-process 공통 경로 호환). | n/a |
| 동상 `split_into_scenes_v212` | (1) `SCENE_SPLIT_SYSTEM_PROMPT_V215` 사용. (2) LLM 응답에서 `event_index` 만 사용. (3) 분배 검증 → 부족 시 1회 retry → fallback 보충. (4) event_index asc 정렬. (5) 출력 루프에서 events[ev_idx] 로 story_slot/memory_index/refs/section 강제. | event_indices_in_response, missing_events_after_first, retry_attempted_for_events, missing_events_after_retry, fallback_added_for_events, chapter_scene_counts |

### 7) 테스트 항목

· **T1** — `python -c "import app.services.pre_mv_phase1_splitter; import app.routes.pre_mv"` import OK.
· **T2** — GET `/api/health` 200.
· **T3** — 라이브 잡 `6a17f8eb90a2818ef41ee885` force=true phase1 재실행 →
  - 응답 200 + 백그라운드 잡 phase1_ready 도달.
  - 챕터 (meeting / first_date / memory / proposal / wedding_prep) 5개 모두 최소 1 씬 등장.
  - 모든 씬의 `story_slot` 라벨이 scenario_events 의 `story_slot` 과 정확히 일치 (Phase 0 결과와 100% 매칭).
  - 모든 씬의 `ref_sheet_ids` / `ref_place_ids` 가 events.refs 의 type 별 자동 추출과 일치.
· **T4** — LLM 응답 로그 확인 — 첫 응답에 `story_slot`/`memory_index`/`ref_*` 4 필드 없고 `event_index` 만 있음.
· **T5** — event_index 누락 시뮬레이션 — (로깅 + 코드 리뷰만, retry 동작 경로 코드 리뷰 PASS).
· **T6** — fallback only 경로 (LLM 실패 시) — `_build_fallback_scenes_v212` 결과에 `event_index` 키가 채워지는지 코드 리뷰.

### 8) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| W1 | LLM 이 새 스키마(event_index)를 이해 못 하고 옛 형식 (story_slot) 으로 응답 → ev_idx 결손. | 응답에서 옛 4 필드 무시 (post-process 가 events 기준으로 덮어씀). event_index 누락 시 안전 보정 (0 또는 직전 ev_idx). |
| W2 | event_index 가 범위 밖 (-1, 9999) 으로 박힘. | clamp `max(0, min(len(events)-1, int(x or 0)))`. |
| W3 | retry 가 LLM 토큰 cap 으로 또 truncation. | retry 도 실패하면 결정론 fallback 씬 자동 추가 — 절대 missing 잔존 X. |
| W4 | LLM 이 event 순서를 섞어 박음 (events[3] 다음 events[1]). | scenes 배열 `sort(key=event_index)` 로 자동 정렬. 같은 event_index 안 응답 순서는 stable sort 로 유지. |
| W5 | v24 Phase 2 의 챕터 그룹화 (story_slot 연속 기반) — 같은 slot 의 인접 event 두 개가 한 챕터로 합쳐지는 기존 동작 변화 가능. | story_slot 자체는 그대로(events 의 라벨). 챕터 그룹화는 story_slot 의 연속을 보므로 동일. memory_index 가 달라도 같은 챕터로 묶이는 기존 동작 유지. |
| W6 | `_build_fallback_scenes_v212` 가 event_index 안 박으면 post-process 가 ev 0 으로 강제. | fallback 도 dict 에 `event_index` 추가 (라인 1306~1313 영역). |
| W7 | LLM 응답에서 옛 story_slot 박혔는데 post-process 가 덮어쓰는 동안 로깅이 잘못된 챕터 표시. | logger metric 은 final_scenes 후 chapter_counts 계산 — 정확. |

### 9) 작업 끝(append).

## v25 — 2026-06-01 — 가사 제목/내용 수정 API (PATCH /api/mv/jobs/{job_id}/lyrics)

### 1) 요청 작업 요약

· 사용자 원문: "가사 제목, 가사 내용을 수정하는 API 엔드포인트가 있는 백엔드 코드를 수정한 다음에 백엔드 서버를 재실행하는거야."
· 현재 `backend_8000/app/routes/mv.py` 에 가사 제목(`lyrics.title`) / 내용(`lyrics.body`) 만 부분 수정하는 엔드포인트 없음 — `POST /jobs/{job_id}/regenerate` 는 story_id + music_spec 기반 전체 재생성 흐름이라 "사용자가 직접 가사 텍스트만 손보고 저장" 시나리오를 못 푼다.
· 이번 턴은 **백엔드 PATCH 엔드포인트 신설 + 서버 자동 재시작 (uvicorn --reload 가 git pull 후 감지)** 까지. 프론트는 다음 턴.

### 2) 백엔드 작업 항목 (backend agent)

대상 파일: `/Users/pearl/TripleJ/1_MV_wedding/backend_8000/app/routes/mv.py`

#### 2-A) 엔드포인트 스펙

| 항목 | 값 |
|------|------|
| Method | `PATCH` |
| Path | `/api/mv/jobs/{job_id}/lyrics` |
| Auth | `Depends(get_current_user)` — owner 검증 |
| 가드 | 진행 중(`generating_lyrics`, `generating_music`, `queued`) 일 땐 409 — 사용자 수정이 백그라운드 결과로 덮어쓰여지는 race 방지 |

#### 2-B) 요청 바디 (Pydantic)

```python
class MVJobLyricsPatch(BaseModel):
    title: str | None = None   # None 이면 미수정. 공백만 트림 후 검사.
    body: str | None = None    # None 이면 미수정. 공백만 트림 후 검사.
```

검증 규칙:
- `title` / `body` 둘 다 `None` 이면 **422** (수정할 항목이 없음).
- `title` 길이 1~200 글자 (strip 후). 벗어나면 **422**.
- `body` 길이 1~5000 글자 (strip 후). 벗어나면 **422**.

#### 2-C) 동작 (의사 코드)

```python
@router.patch("/jobs/{job_id}/lyrics")
async def patch_job_lyrics(
    job_id: str,
    body: MVJobLyricsPatch,
    current_user=Depends(get_current_user),
):
    # 1) ObjectId 파싱 — 실패 시 400.
    # 2) doc 조회 — 없으면 404.
    # 3) owner 검증 — 실패 시 403.
    # 4) status race 가드 — generating_* / queued 면 409.
    # 5) body.title is None and body.body is None → 422.
    # 6) 새 lyrics dict 구성:
    #    cur = doc.get("lyrics") or {}
    #    new_lyrics = dict(cur)
    #    if body.title is not None: new_lyrics["title"] = body.title.strip()
    #    if body.body is not None:  new_lyrics["body"]  = body.body.strip()
    # 7) update_one $set lyrics, updated_at; status 는 그대로(또는 lyrics_ready 유지).
    # 8) 로깅: [MVRoute] /lyrics-patch ok user_id=%s job_id=%s title_changed=%s body_changed=%s
    # 9) 응답: _serialize_job(updated_doc)
```

추가 메모:
- 가사 본문이 바뀌면 기존 `lyric_timestamps_variants` 는 의미가 어긋날 수 있음 — v25 에서는 **수동 가사 편집은 음악 재생성 트리거 안 함** (사용자가 별도로 `POST /jobs/{id}/music` 다시 부르거나 `regenerate` 호출하는 흐름). 단, body 가 바뀐 경우 `lyric_timestamps`, `lyric_timestamps_variants`, `lyric_timestamps_variants_count`, `lyric_timestamps_status` 는 **stale 표시** 위해 `lyric_timestamps_status="stale"` 으로 마킹 (timestamps 자체는 보존, UI 가 경고만 띄움).
- title 만 바뀐 경우는 timestamps 영향 없음 → stale 마킹 안 함.

#### 2-D) 로깅 추적자

- `[MVRoute] /lyrics-patch entry user_id=%s job_id=%s has_title=%s has_body=%s`
- `[MVRoute] /lyrics-patch invalid job_id ...`
- `[MVRoute] /lyrics-patch not found ...`
- `[MVRoute] /lyrics-patch forbidden ...`
- `[MVRoute] /lyrics-patch busy status=%s`
- `[MVRoute] /lyrics-patch noop` (둘 다 None)
- `[MVRoute] /lyrics-patch ok user_id=%s job_id=%s title_changed=%s body_changed=%s body_marked_stale=%s`

### 3) 프론트엔드 작업 항목 (frontend agent — 다음 턴)

· 이번 턴 **NO-OP**. 프론트는 v26 에서 다룸.
· 예고: `frontend/src/api/mv.ts` (또는 동등 위치) 에 `patchMvJobLyrics(jobId, {title?, body?})` 추가 + 가사 카드 편집 모드 UI (제목/본문 textarea + 저장 버튼 → PATCH 호출 → 응답으로 job 캐시 교체).

### 4) 테스터 작업 항목 (tester agent)

도구: curl (백엔드 PC `100.127.225.55:8000` 대상). JWT 는 사용자 로그인으로 받은 토큰 사용.

#### T1 — 정상 PATCH (title + body 동시)
```bash
curl -i -X PATCH "http://100.127.225.55:8000/api/mv/jobs/$JOB_ID/lyrics" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"우리 결혼해요 (수정본)","body":"1절...\n2절..."}'
```
기대: `200 OK`, 응답 JSON 의 `lyrics.title` / `lyrics.body` 가 보낸 값. `lyric_timestamps_status="stale"`.

#### T2 — title 만
```bash
curl -i -X PATCH ... -d '{"title":"새 제목만"}'
```
기대: `200 OK`. `lyrics.title` 갱신. `lyrics.body` 보존. `lyric_timestamps_status` 미변경.

#### T3 — body 만
```bash
curl -i -X PATCH ... -d '{"body":"본문만 갈아끼움"}'
```
기대: `200 OK`. `lyric_timestamps_status="stale"`.

#### T4 — DB 직접 확인
```bash
ssh -p 2222 duckjk89@100.127.225.55 \
  'mongosh "$MONGO_URI" --quiet --eval "db.mv_jobs.findOne({_id: ObjectId(\"'$JOB_ID'\")}, {lyrics:1, lyric_timestamps_status:1, updated_at:1})"'
```
기대: `lyrics.title` / `lyrics.body` 가 PATCH 로 보낸 값과 동일. `updated_at` 갱신.

#### T5 — 잘못된 입력 검증
| 케이스 | 요청 바디 | 기대 응답 |
|------|---------|----------|
| 둘 다 누락 | `{}` | 422 (또는 400) — "수정할 항목이 없습니다" |
| title 빈 문자열 | `{"title":"   "}` | 422 — strip 후 길이 1 미만 |
| title 너무 김 | `{"title":"x".repeat(201)}` | 422 |
| body 너무 김 | `{"body":"x".repeat(5001)}` | 422 |

#### T6 — 권한/상태 가드
- 다른 유저 토큰으로 PATCH → 403.
- 잘못된 job_id (`"abc"`) → 400.
- 존재하지 않는 ObjectId → 404.
- `status="generating_lyrics"` 상태 잡에 PATCH → 409.

#### T7 — 회귀
- `GET /api/mv/jobs/{id}` 응답 스키마 변화 없음 (필드 추가/제거 X).
- `POST /jobs/{id}/regenerate` 여전히 정상 동작.

### 5) 백엔드 재시작 절차 (운영)

`uvicorn --reload` 가 백엔드 PC 에서 항상 가동 중 → **파일 변경 감지로 자동 재시작**.

#### 5-A) 맥(개발자) 측 — 코드 push
```bash
cd /Users/pearl/TripleJ
git add 1_MV_wedding/backend_8000/app/routes/mv.py 1_MV_wedding/PLAN.md
git commit -m "feat(mv): add PATCH /api/mv/jobs/{job_id}/lyrics (v25)"
git push origin <current-branch>
```
주의: 메모리 규칙 (`2_housing/` / `0_platform*` / `에셋/` 건드리지 말 것) — `1_MV_wedding/` 만 스테이징.

#### 5-B) 백엔드 PC 측 — pull → reload 확인
```bash
ssh -p 2222 duckjk89@100.127.225.55 \
  'cd /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding && git pull --ff-only'
```
이어서 uvicorn 로그에서 reload 메시지 확인:
```bash
ssh -p 2222 duckjk89@100.127.225.55 \
  'tail -n 30 /mnt/d/1_projects/0_myProjects/1_tripleJ/1_MV_wedding/backend_8000/logs/uvicorn.out 2>/dev/null || \
   journalctl --user -u mv-backend -n 30 --no-pager 2>/dev/null || \
   pgrep -af "uvicorn.*backend_8000"'
```
기대 로그 패턴: `WARNING: WatchFiles detected changes in 'app/routes/mv.py'. Reloading...` → `Application startup complete.`

#### 5-C) Smoke
```bash
curl -s "http://100.127.225.55:8000/api/health" | head
curl -s -X OPTIONS "http://100.127.225.55:8000/api/mv/jobs/000000000000000000000000/lyrics" -i | head
```
기대: health 200, OPTIONS preflight 도 라우터 등록되어 있음 (404 가 아니라 405 / 200).

### 6) 회귀 위험

| # | 위험 | 완화 |
|---|------|------|
| R1 | body 만 바뀌었는데 timestamps 가 stale 표시 안 돼서 UI 가 잘못된 줄에 노래 진행. | `lyric_timestamps_status="stale"` 마킹 + 프론트(v26)가 stale 일 때 토글 비활성화. |
| R2 | `status="lyrics_ready"` 가 아닌 잡(예: `music_ready`) 에 가사 수정 시 음악 본문/가사 mismatch. | v25 는 "lyrics 가 한 번 생성된 모든 잡" 에 수정 허용(`status not in busy_set`). mismatch 는 사용자가 의도적으로 만든 상태 → UI 에서 "수동 편집됨" 배지. |
| R3 | 두 클라이언트 동시 PATCH → race. | mongo `update_one` 원자성 + 마지막 쓰기 승. 충돌 감지 불필요 (단일 사용자 owner). |
| R4 | uvicorn --reload 가 syntax error 로 죽음 → 서비스 다운. | `python -c "import app.routes.mv"` 로컬 (맥) 에서 임포트 확인 후 push. 백엔드 PC 도 reload 실패 시 직전 워커 유지. |
| R5 | PLAN.md 가 의도치 않게 `2_housing/` 또는 루트 파일에 변경 포함된 채 commit. | `git add` 시 `1_MV_wedding/` 경로만 명시 — `git add -A` / `git add .` 금지. |

### 7) 작업 끝(append).

