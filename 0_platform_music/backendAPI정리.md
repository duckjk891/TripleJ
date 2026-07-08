# AIMU 백엔드 API 문서

> 백엔드 서버: `http://localhost:9004`
> 모든 API 경로 접두사: `/api`
> 작성일: 2026-05-25
> 기준 버전: **9004 백엔드 (backend_9004)**

본 문서는 9004 백엔드의 모든 REST API 를 앱팀이 바로 연동할 수 있도록 정리한 레퍼런스입니다. 모든 항목은 `backend_9004/app/routes/` 의 실제 코드를 기준으로 작성되었습니다.

---

## 목차

1. [인증 방식](#1-인증-방식)
2. [에러 응답 형식](#2-에러-응답-형식)
3. [인증 API](#3-인증-api-apiauth)
4. [트랙 API](#4-트랙-api-apitracks)
5. [앨범 API](#5-앨범-api-apialbums)
6. [차트 API](#6-차트-api-apicharts)
7. [플레이리스트 API](#7-플레이리스트-api-apiplaylists)
8. [좋아요 API](#8-좋아요-api-apilikes)
9. [팔로우 API](#9-팔로우-api-apifollows)
10. [아티스트(크리에이터) API](#10-아티스트크리에이터-api-apiartists)
11. [업로드 / 커버 생성 API](#11-업로드--커버-생성-api-apiupload)
12. [AI 음악 생성 API](#12-ai-음악-생성-api-apigenerate)
13. [뮤직비디오(MV) API](#13-뮤직비디오mv-api-apimv)
14. [캐릭터 API](#14-캐릭터-api-apicharacter)
15. [보이스 페르소나 API](#15-보이스-페르소나-api-apivoice-persona)
16. [보컬 변환(Voice Convert) API](#16-보컬-변환voice-convert-api-apivoice-convert--apikits)
17. [보컬 수리(Vocal Repair) API](#17-보컬-수리vocal-repair-api-apivocal-repair)
18. [Wondera API](#18-wondera-api-apiwondera)
19. [관리자 API](#19-관리자-api-apiadmin)
20. [고객사(Business) / 광고 API](#20-고객사business--광고-api-apibusiness)
21. [보상(Rewards) API](#21-보상rewards-api-apirewards)
22. [로그 조회 / 프론트엔드 로그 수집 API](#22-로그-조회--프론트엔드-로그-수집-api-api_logs)
23. [헬스체크](#23-헬스체크-apihealth)
24. [부록: ID/상태값/공통 객체](#24-부록-id상태값공통-객체)
25. [변경 이력](#25-변경-이력)

---

## 1. 인증 방식

### JWT 토큰

대부분의 API 는 HTTP 헤더에 JWT 토큰을 포함해야 합니다.

```
Authorization: Bearer {token}
```

토큰은 `/api/auth/register` 또는 `/api/auth/login` 응답에서 받을 수 있고, 만료 기간은 7일입니다.

### 인증 수준 표기

| 표기 | 의미 |
|------|------|
| **필수** | 토큰 없거나 만료 시 401 |
| **선택** | 토큰 있으면 사용자 정보 활용, 없어도 동작 |
| **없음** | 인증 불필요 (공개) |
| **관리자** | `role=admin` 필수 |
| **고객사** | `role=customer` 또는 `role=admin` 필수 |
| **로그 토큰** | `LOG_ACCESS_TOKEN` (헤더 `X-Log-Token` 또는 쿼리 `token`) |

---

## 2. 에러 응답 형식

모든 에러는 아래 형식으로 반환됩니다:

```json
{"error": "에러 메시지"}
```

| 상태 코드 | 의미 |
|-----------|------|
| 400 | 잘못된 요청 (파라미터 오류, 유효성 검증 실패) |
| 401 | 인증 필요 (토큰 없음/만료) |
| 403 | 권한 없음 (소유자 아님 / 차단 사용자 등) |
| 404 | 리소스 없음 |
| 409 | 충돌 (이미 존재 / 이미 진행 중) |
| 422 | 본문 검증 실패 (FastAPI/Pydantic) |
| 500 | 서버 내부 오류 |
| 502 | 외부 API(LLM/이미지 모델 등) 호출 실패 |
| 503 | 외부 API 키 미설정 |

---

## 3. 인증 API (`/api/auth`)

### 회원가입

```
POST /api/auth/register
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "nickname": "닉네임",
  "company_name": "선택. 회사명 (≤100자)",
  "display_title": "선택. 직함, 기본 \"대표\" (≤20자)"
}
```

**응답 (201):**
```json
{
  "message": "회원가입이 완료되었습니다.",
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "닉네임",
    "company_name": null,
    "display_title": "대표",
    "role": "user"
  }
}
```

---

### 로그인

```
POST /api/auth/login
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| Content-Type | application/json |

**요청 본문:**
```json
{"email": "user@example.com", "password": "password123"}
```

**응답 (200):**
```json
{
  "message": "로그인 성공",
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "닉네임",
    "profile_image": "object_name 또는 null",
    "company_name": null,
    "display_title": "대표",
    "role": "user"
  }
}
```

차단된 계정은 403 (`계정이 정지되었습니다.`).

---

### 내 정보 조회

```
GET /api/auth/me
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "nickname": "닉네임",
  "profile_image": null,
  "bio": null,
  "plan": null,
  "role": "user",
  "company_name": null,
  "display_title": "대표",
  "created_at": "2026-05-01T00:00:00"
}
```

---

### 프로필 부분 수정

```
PATCH /api/auth/me/profile
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문 (모두 선택, 보낸 필드만 갱신):**
```json
{
  "company_name": "선택. ≤100자",
  "display_title": "선택. ≤20자",
  "bio": "선택. ≤500자"
}
```

빈 본문은 400. 응답은 `/api/auth/me` 와 동일한 사용자 객체.

---

### 로그아웃

```
POST /api/auth/logout
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):** `{"message": "로그아웃 되었습니다."}`

Redis 세션을 삭제합니다. JWT 자체는 만료 전까지 유효하므로 클라이언트에서도 토큰을 폐기해야 합니다.

---

### 소셜 로그인 (OAuth 2.0 Authorization Code) — `/api/auth/oauth`

구글 / 카카오 / 네이버 소셜 로그인·회원가입. 기존 이메일 로그인과 동일한 JWT(7일) + Redis 세션을 발급하므로,
발급된 토큰은 다른 인증 API(`/api/auth/me` 등)에서 그대로 사용됩니다.

지원 `provider`: `google`, `kakao`, `naver`.

#### 1) 로그인 시작

```
GET /api/auth/oauth/{provider}/login
```

| 항목 | 값 |
|------|---|
| 인증 | 불필요 |

- 정상: CSRF 방지용 `state`(난수, Redis 에 300초 TTL 저장) 를 만들고 provider 인가 페이지로 **302 Redirect**.
- provider 키 미설정: **503** `{"error": "...아직 설정되지 않았습니다.", "detail": "..."}`.
- 미지원 provider: **400**.

> 프론트는 이 경로로 사용자를 이동시키기만 하면 됩니다(`<baseURL>/api/auth/oauth/google/login` 등).

#### 2) 콜백 (provider → 백엔드)

```
GET /api/auth/oauth/{provider}/callback?code=&state=&error=
```

provider 가 호출하는 경로(프론트가 직접 호출하지 않음). 백엔드가 처리 후 **프론트로 302 Redirect**:

- 성공: `{FRONTEND_URL}/oauth/callback#token={JWT}`
- 실패(동의 거부/state 오류/교환 실패 등): `{FRONTEND_URL}/oauth/callback#error={메시지}`

> 프론트는 `/oauth/callback` 라우트에서 URL fragment(`#token=` / `#error=`)를 파싱해
> 토큰을 저장하거나 에러를 표시하면 됩니다. (`state` Redis 검증 실패는 400 JSON)

**계정 처리 정책 (find / link / create):**

1. `(provider, provider_user_id)` 일치하는 계정이 있으면 → 그 계정으로 **로그인**.
2. 없고 provider 이메일과 일치하는 기존 계정이 있으면 → 그 계정에 `provider`/`provider_user_id` 를 연동(UPDATE)하고 **로그인**.
3. 둘 다 없으면 → **신규 가입**(`password_hash` = NULL). 이메일 미제공 시 `{provider}_{uid}@social.aidol.local`, 닉네임 미제공 시 `{provider}_{uid앞8자}` 로 대체.

#### .env 키 (플레이스홀더 — 키 없으면 503, 앱은 정상 기동)

```
GOOGLE_CLIENT_ID=        GOOGLE_CLIENT_SECRET=
KAKAO_CLIENT_ID=         KAKAO_CLIENT_SECRET=    # KAKAO_CLIENT_ID 는 REST API 키
NAVER_CLIENT_ID=         NAVER_CLIENT_SECRET=
OAUTH_CALLBACK_BASE=http://localhost:9005        # provider 가 돌아올 우리 콜백 베이스
FRONTEND_URL=https://localhost:4000              # 최종 토큰 전달 대상
```

**각 콘솔에 등록할 Redirect URI** (`{OAUTH_CALLBACK_BASE}/api/auth/oauth/{provider}/callback`):

- Google Cloud Console: `http://localhost:9005/api/auth/oauth/google/callback`
- Kakao Developers:      `http://localhost:9005/api/auth/oauth/kakao/callback`
- Naver Developers:      `http://localhost:9005/api/auth/oauth/naver/callback`

---

## 4. 트랙 API (`/api/tracks`)

트랙은 MongoDB `tracks` 컬렉션에 저장되며, ID 는 ObjectId 문자열입니다. 응답에는 프론트 호환을 위해 `artist_id`, `artist_name`, `cover_image` 별칭이 함께 내려갑니다.

### 트랙 목록 조회

```
GET /api/tracks/
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리:**

| 파라미터 | 타입 | 기본 | 설명 |
|----------|------|------|------|
| page | int | 1 | |
| limit | int | 20 | |
| genre | str | - | 장르 필터 |
| mood | str | - | 분위기 필터 |
| tag | str | - | 태그 필터 |
| sort | str | `play_count` | `play_count` / `like_count` / `created_at` |

**응답 (200):**
```json
{
  "tracks": [ /* track 객체 배열 */ ],
  "pagination": {"page": 1, "limit": 20, "total": 123, "totalPages": 7}
}
```

---

### 트랙 검색

```
GET /api/tracks/search?q={검색어}&page={page}&limit={limit}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리:** `q` (필수, 빈 값이면 400), `page`(기본 1), `limit`(기본 20)

**하이브리드 검색(pgvector 의미 + Elasticsearch BM25) + 정규식 폴백.** 두 백엔드를 동시에 질의해 RRF(Reciprocal Rank Fusion)로 융합한다.
- **의미(벡터):** `q` 를 OpenAI 임베딩(`text-embedding-3-small`, 1536차원)으로 변환해 PostgreSQL `pgvector` 의 `track_embeddings` 와 코사인 유사도 최근접 매칭(top-K=100).
- **키워드(BM25):** Elasticsearch `tracks` 인덱스에 `multi_match`(필드 부스트 `title^3/lyrics^2/keywords^2/prompt/tags/genre/mood`, 커스텀 한국어 분석기 `ko_search`, `fuzziness:AUTO`) + `is_public=true` 필터(top-K=100). "기계/로봇" 같은 내용·변형어 검색, 그리고 "어머니"처럼 가사에만 등장하는 희귀 키워드를 해당 곡으로 끌어올린다.
- **자연어 쿼리 정규화(`ko_search` 분석기, index+search 동일 적용):** `nori_tokenizer` → `nori_part_of_speech`(조사·어미·관형사·접사 등 문법형태소 POS 제거: `J/E/MM/MAG/MAJ/X*/S*` 등 — "듣**는**"의 잔여 `는` 같은 어휘 노이즈 제거) → `lowercase` → **필러 불용어(`music_stop`)** → **무드 동의어/활용형 정규화(`mood_syn`, synonym_graph)** 순으로 적용한다. ① **필러 불용어**: 음악검색 plumbing 어만 큐레이션 제거(노래/음악/곡/듣다(듣·들)/때/추천/플레이리스트/song/music/listen/playlist 등) — 감정·소재 등 **의미어는 절대 제거하지 않음**. ② **무드 동의어**: 활용형·동의어를 단일 대표 토큰으로 합침(`설레임/설레는/설레이/설레일/설렘 → 설렘`, `신나는/신남 → 신남`, `잔잔한/차분한 → 잔잔`, `위로되는/위안 → 위로`, `슬픈/슬픔 → 슬픔`, `행복한 → 행복`, `그리운 → 그리움`, 사랑/이별/에너지 등 음악무드 중심). 이로써 `"설레일때 듣는 노래"`가 nori 단독에서 `[설레이,때,들,노래]` 로 쪼개져 '노래/때/들' 필러가 가사("노래해")에 매칭돼 오답(잊고 싶어 너를)이 상위로 오던 증상이, `ko_search` 에선 설레임/설레는/설렘/설레일때/원문이 **모두 단일 토큰 `[설레]`** 로 정규화돼 벚꽃 곡이 상위 1~6위로 일관되게 나온다. 분석기 변경은 **인덱스 재생성**이 필요하다(`scripts/backfill_es.py` 또는 startup 자가복구가 새 설정으로 생성+재색인).
- **벡터 쿼리 경량 필러 strip(검색시, 벡터 한정):** 임베딩에 넣는 쿼리에 한해 명백한 음악검색 필러(노래/음악/곡/듣는·듣고싶어/들을때/추천/플레이리스트 등)를 경량 제거해 의미 벡터가 무드·소재에 집중하도록 한다(`"설레일때 듣는 노래" → "설레일때"`). strip 결과가 빈 문자열이면 원문을 사용한다. ES 측은 `ko_search` 분석기가 필러를 처리하므로 **원문을 그대로** 전달한다. 응답 shape·degrade 불변.
- **개념 키워드 의미보강(index-time):** 색인 시점에 LLM(`gpt-4o-mini`, `KEYWORD_MODEL`)으로 곡당 키워드를 세 종류로 1회 추출해 Mongo 트랙 문서의 `search_keywords` 필드(단일 문자열 리스트, 최대 15개)에 합쳐 저장한다 — ① **한국어 구체 키워드**(소재·상황·관계·감정·계절 + 가사에 없는 상위개념 음식/요리/계절/감정 등), ② **영어 구체 키워드**(제목/가사/개념의 영어 표현: 이별→breakup, 운동→workout/gym, 로봇→robot, 김장→kimchi/food/cooking, 벚꽃→cherry blossom 등 — 영어 쿼리 보강), ③ **추상 무드/느낌 키워드 3개**(한+영 혼용: 잔잔한/calm, 신나는/energetic, 위로되는/comforting 등 — 추상 무드 쿼리 보강). 이 단일 필드를 ES 색인(`keywords` 필드, nori)과 pgvector 임베딩 텍스트가 **공유**하므로 LLM 중복 호출이 없고, 검색 시점엔 LLM 을 호출하지 않는다. 이로써 "음식"→'사랑의 김장', "sad breakup"→'잊고 싶어 너를', "workout"→'심장을 깨워' 같은 **추상/영어 → 구체 사례** 검색이 양쪽(BM25+벡터)에서 강화된다.
- **무관 쿼리 코사인 컷오프(index-free, 검색시):** 벡터 후보는 쿼리와의 **코사인 유사도**(1−cosine_distance, 0~1, 높을수록 유사)가 `SEARCH_MIN_COSINE`(기본 `0.15`, 19곡 캘리브레이션으로 결정 — 관련 쿼리 최저치 아래로 느슨하게) 이상인 것만 채택한다(RRF 점수가 아니라 순수 코사인 바닥값). 컷 통과한 벡터 후보와 ES(어휘) 히트가 **둘 다 비면** 명백 무관으로 보고 **빈 결과**(`total:0`)를 반환하며 이 경우 정규식 폴백도 하지 않는다(예: 무관 외국어/노이즈 쿼리). 어휘(ES) 매칭이 있거나 코사인 통과 후보가 있으면 기존대로 RRF 융합. 멀쩡한 쿼리(음식/기계/이별/벚꽃/운동/어머니 등)는 절대 빈 결과가 되지 않도록 바닥값을 보수적으로 낮게 둔다.
- **융합(가중 RRF):** 각 순위 리스트를 가중 RRF(`score = Σ weight/(60+rank)`, 기본 `벡터 weight=1.0 / ES weight=2.0`, `RRF_VEC_WEIGHT/RRF_ES_WEIGHT` 환경변수로 조정)로 합산·내림차순 정렬 → 공개 트랙을 MongoDB 에서 조회 → 융합 순서로 정렬 후 페이지네이션. ES 가중을 높여 희귀 키워드 BM25 매칭이 일반 의미 유사곡에 희석되지 않게 한다. 트랙 본체는 MongoDB, 벡터는 PostgreSQL, 키워드 색인은 Elasticsearch.
- **색인 자가복구(self-heal):** 서버 startup 에서 ES `tracks` 문서수 < Mongo 공개곡수면(재기동 사이 인덱스가 비워진 경우 등) 공개곡을 비차단 백그라운드로 자동 재색인한다(멱등, best-effort, ES 다운이어도 startup 무영향). 자가복구는 Mongo 의 `search_keywords` 를 그대로 읽어 `keywords` 필드에 색인하므로 LLM 호출이 필요 없다. 검색이 조용히 벡터-only 로 degrade 되는 것을 방지.

**graceful degrade:** 두 백엔드 모두 결과 → `mode=hybrid`. ES 다운/무결과 → 벡터만(코사인 컷 적용, `mode=vec`). 벡터 실패 → ES만(`mode=es`). 벡터는 정상 동작했으나 코사인 컷 통과 후보·ES 히트가 모두 0 → 무관 쿼리로 판정해 빈 결과(`mode=cutoff`, 정규식 폴백 안 함). 벡터 자체가 실패 + ES 무결과(관련성 판단 불가) → 기존 정규식 매칭(`title / tags / prompt / uploader_nickname`, case-insensitive, `mode=regex`)으로 자동 폴백. 빈 `q` 는 400 유지.

**응답 shape 불변:** `{ tracks: [...], pagination: { page, limit, total, totalPages } }` — 프론트 계약 변경 없음.

> 색인: 트랙 발행(직접 업로드 / 생성물 업로드) 시 단일 백그라운드 훅이 **순서 보장**으로 ①개념 키워드 추출→Mongo `search_keywords` 저장 ②pgvector 임베딩 upsert ③Elasticsearch 색인을 수행한다(발행 성공 여부와 무관, best-effort — 키워드 실패해도 색인/발행 진행). 발행 시 입력하는 `title / lyrics / prompt / genre / mood / tags / categories` + LLM 개념 키워드(`search_keywords`)가 색인 텍스트로 쓰인다. 전수 재색인은 `scripts/backfill_search_keywords.py`(키워드+벡터+ES 통합) / `scripts/backfill_embeddings.py`(벡터) / `scripts/backfill_es.py`(ES).
> nori 플러그인은 ES 커스텀 이미지(`infra/elasticsearch.Dockerfile`)에 내장되어 영구 적용된다.
> 분석기 보강(`ko_search`: nori + POS필터 + 필러 불용어 + 무드 동의어): `TRACKS_INDEX_BODY.settings.analysis` 단일 출처에 정의되어 startup 자가복구·`ensure_tracks_index`·`scripts/backfill_es.py` 가 공유한다. 불용어/동의어 목록은 `app/services/search_service.py` 의 `_MUSIC_STOPWORDS` / `_MOOD_SYNONYMS` 에서 큐레이션한다. 기존 인덱스에는 매핑·분석기 변경이 반영되지 않으므로 적용 시 인덱스 재생성(삭제 후 재색인)이 필요하다.

---

### 내 트랙 목록

```
GET /api/tracks/my
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**쿼리:** `page`, `limit`, `sort` (`created_at`/`play_count`/`like_count`, 기본 `created_at`)

본인이 업로드한 트랙(비공개 포함)을 반환합니다.

---

### 트랙 상세 조회

```
GET /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

Redis 캐시(`cache:track:v2:{id}`, TTL 10분) 사용. 조회 시 `playcount:buffer:{id}` 카운터가 증가합니다(배치로 MongoDB 에 반영).

연동된 완료 MV 가 있으면 `has_music_video`, `music_video_url` 가 포함되고, MV 가 "내 캐릭터 포함" 으로 만들어졌거나 트랙에 `user_character_snapshot` 이 있으면 `cover_character` 가 포함됩니다.

**SnapFix — cover_character 시트 불변 사본:** `cover_character.sheet_preview_path` 가 가리키는 스냅샷 시트는 발행/MV 생성 시점에 MinIO 불변 경로 `character_snapshots/{user_id}/{uuid}.png` 로 서버측 복사된 사본입니다(원본 경로는 스냅샷의 `sheet_object_name_origin` 에 보존). 캐릭터 영구 시트(`characters/{uid}/sheet.png`·`sheet_virtual.png`)는 재생성 시 덮어써지지만, 사본은 `characters/` prefix 밖에 있어 캐릭터 재생성·삭제(`DELETE /character/me` 의 prefix 재귀 삭제) 후에도 발행 당시 모습이 유지됩니다. 기존 데이터도 백필 스크립트(`backend_9005/scripts/backfill_snapshot_sheets.py`)로 불변 사본으로 전환됨 — 단, **백필 시점 이전에 이미 캐릭터 재생성으로 덮어써진 곡의 원래 이미지는 복원 불가**(현재 파일 기준 사본이며, 이후 변경으로부터의 격리가 목적).

**응답 (200) 주요 필드:**
```json
{
  "id": "objectid",
  "title": "곡 제목",
  "uploader_id": "uuid",
  "uploader_nickname": "닉네임",
  "artist_id": "uuid",
  "artist_name": "닉네임",
  "cover_image": "covers/...",
  "cover_image_url": "covers/...",
  "audio_url": "tracks/...",
  "genre": ["pop"],
  "mood": ["dreamy"],
  "tags": ["k-pop"],
  "bpm": 120,
  "key": "Am",
  "duration_sec": 180,
  "play_count": 0,
  "like_count": 0,
  "is_public": true,
  "has_music_video": true,
  "music_video_url": "https://presigned...",
  "cover_character": {
    "name": "...",
    "age": "...",
    "personality_tags": [],
    "personality_text": "...",
    "sheet_preview_path": "/api/character/preview/...",
    "used_items": []
  },
  "beats_status": "completed",
  "tempo": 120.0,
  "beats": [0.5, 1.0, ...],
  "downbeats": [0.5, 2.5, ...],
  "created_at": "2026-05-01T00:00:00+00:00"
}
```

---

### 트랙 메타데이터 수정

```
PUT /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택):**
```json
{
  "title": "string",
  "genre": ["string"],
  "mood": ["string"],
  "tags": ["string"],
  "prompt": "string",
  "ai_model": "string",
  "is_public": true,
  "cover_image_url": "object_name"
}
```

본인 트랙이 아니면 403. 응답은 갱신된 트랙 객체.

---

### 트랙 삭제

```
DELETE /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

MinIO 오디오 파일까지 삭제. 본인이 소유한 앨범에서도 자동으로 제외되며, 마지막 트랙이 빠지면 앨범도 함께 삭제됩니다.

**응답 (200):** `{"message": "트랙이 삭제되었습니다."}`

---

### 트랙 업로드 (사용자 직접 업로드)

```
POST /api/tracks/upload
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 오디오 (`.mp3/.wav/.ogg/.flac/.m4a`, ≤50MB) |
| title | str | O | 제목 |
| genre | str | - | 콤마 구분 |
| mood | str | - | 콤마 구분 |
| tags | str | - | 콤마 구분 |
| categories | str | - | 콤마 구분 (v77, 9005). 고정 10종 화이트리스트로 필터 |
| ai_model | str | - | |
| prompt | str | - | |
| bpm | int | - | |
| key | str | - | |
| language | str | - | |
| lyrics | str | - | |
| is_public | bool | - | 기본 `true` |

업로드 후 백그라운드로 비트 추출이 실행됩니다.

**응답 (201):** 트랙 객체 (`categories: string[]` 포함).

---

### 생성(generation) 으로부터 트랙 등록

```
POST /api/tracks/upload-from-generation
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

`/api/generate` 에서 완료된 결과물을 트랙으로 정식 등록합니다.

**요청 본문:**
```json
{
  "generation_id": "objectid (필수)",
  "title": "string (필수)",
  "genre": "콤마구분 문자열",
  "mood": "콤마구분 문자열",
  "tags": "콤마구분 문자열",
  "categories": ["휴식", "잠자기"],
  "prompt": "string",
  "lyrics": "string",
  "cover_object_name": "covers/...",
  "mv_object_name": "mv/...",
  "ai_model": "Suno",
  "use_voice_converted": false,
  "user_character_snapshot": {
    "name": "...",
    "age": "...",
    "personality_tags": [],
    "personality_text": "...",
    "sheet_object_name": "characters/.../sheet.png",
    "used_items": []
  }
}
```

- `use_voice_converted=true` 면 보이스 변환된 오디오를 소스로 사용.
- `user_character_snapshot` 은 MV 안 만들었어도 트랙 상세에 `cover_character` 가 나오도록 박제합니다.
- **SnapFix**: 서버가 `sheet_object_name` 의 시트를 불변 경로 `character_snapshots/{user_id}/{uuid}.png` 로 복사해 저장하고 원본 경로는 `sheet_object_name_origin` 에 보존합니다(캐릭터 재생성/삭제로부터 곡 표시 격리). 복사는 best-effort — 실패해도 발행은 성공하며 원본 경로가 그대로 저장됩니다. MV 생성(`POST /api/mv/create`)의 서버측 스냅샷도 동일하게 처리됩니다.
- `categories` (v77, 9005): 고정 10종 화이트리스트. list 또는 콤마구분 문자열 허용. body 우선, 없으면 generation doc 의 `categories` fallback. 저장 전 항상 화이트리스트 필터. 트랙 응답에 `categories: string[]` 포함.

**응답 (201):** 트랙 객체 (`categories: string[]` 포함).

---

### 트랙 스트림 URL (presigned)

```
GET /api/tracks/stream/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):** `{"stream_url": "https://presigned..."}` (1시간 유효)

---

### 모바일 직접 스트리밍 프록시

```
GET /api/tracks/stream-proxy/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | 오디오 바이트 스트림 (`Accept-Ranges: bytes`) |

MinIO 객체를 직접 프록시 스트리밍. 모바일 클라이언트에서 presigned URL 도메인 문제가 있을 때 사용.

---

### 트랙 다운로드 (presigned + 다운로드 카운트)

```
POST /api/tracks/download/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

다운로드 시점에 차트 점수 계산용 다운로드 집계가 Redis 에 기록됩니다.

**응답 (200):** `{"download_url": "https://presigned...", "filename": "곡제목.mp3"}`

---

### 트랙 음악비디오 조회

```
GET /api/tracks/{track_id}/music-video
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

연동 MV 작업의 최종 결과 URL 만 반환.

**응답 (200):** `{"has_music_video": true, "music_video_url": "..."}`
없으면 404.

---

### 트랙 비트(Beats) 조회

```
GET /api/tracks/{track_id}/beats
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자 또는 공개 트랙) |

**응답 (200):**
```json
{
  "status": "completed",
  "tempo": 120.0,
  "beats": [0.5, 1.0, 1.5],
  "downbeats": [0.5, 2.5],
  "started_at": "2026-05-01T00:00:00",
  "completed_at": "2026-05-01T00:00:10",
  "error": null
}
```

---

### 트랙 비트 재추출

```
POST /api/tracks/{track_id}/beats/retry
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

상태를 `pending` 으로 리셋하고 백그라운드로 재추출.

---

## 5. 앨범 API (`/api/albums`)

앨범은 사용자가 소유한 트랙 묶음입니다. 커버는 다음 3 가지 방식 중 선택:

- `auto` — `track_ids[0]` 의 커버를 빌려서 사용 (`borrowed`).
- `upload` — 클라이언트가 직접 이미지 업로드.
- `ai` — `/api/albums/cover/generate` 로 미리 생성한 객체명 전달.

### 공개 앨범 목록

```
GET /api/albums/
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리:** `page` (≥1, 기본 1), `limit` (1~100, 기본 20).

**응답 (200):**
```json
{
  "albums": [
    {
      "id": "objectid",
      "owner_id": "uuid",
      "artist_id": "uuid",
      "artist_name": "닉네임",
      "title": "...",
      "description": "...",
      "cover_image": "https://presigned...",
      "cover_source": "borrowed",
      "is_public": true,
      "release_date": "2026-05-01T...",
      "track_count": 3,
      "tracks": null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {"page": 1, "limit": 20, "total": 12, "totalPages": 1}
}
```

---

### 최신 공개 앨범 N개

```
GET /api/albums/latest?limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`limit` 1~100 (기본 20). 응답은 앨범 객체 배열.

---

### 내 앨범 목록

```
GET /api/albums/my
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

비공개 포함. `page`, `limit` 동일.

---

### 앨범 생성

```
POST /api/albums/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| title | str | O | 앨범 제목 |
| description | str | - | 설명 |
| is_public | bool | - | 기본 `true` |
| track_ids | str (JSON 배열) | O | 본인 소유 트랙 ID 배열. 1개 이상 |
| cover_source | str | - | `auto` / `upload` / `ai` (기본 `auto`) |
| cover_object_name | str | - | `cover_source=ai` 일 때 필수 (커버 생성 결과 객체명) |
| cover_file | File | - | `cover_source=upload` 일 때 필수 (≤10MB, jpg/jpeg/png/webp) |

본인이 업로드한 트랙만 포함 가능. 위반 시 400.

**응답 (201):** 앨범 객체 + `tracks` 배열 포함.

---

### 앨범 메타데이터 수정

```
PATCH /api/albums/{album_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택):**
```json
{"title": "...", "description": "...", "is_public": true, "cover_source": "auto"}
```

---

### 앨범 삭제

```
DELETE /api/albums/{album_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

업로드/AI 커버는 best-effort 삭제됩니다.

---

### 앨범에 트랙 추가

```
POST /api/albums/{album_id}/tracks
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"track_ids": ["objectid", ...]}`

본인 소유 트랙만 추가 가능. 이미 포함된 ID 는 자동으로 제거(idempotent).

---

### 앨범에서 단일 트랙 제거

```
DELETE /api/albums/{album_id}/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

마지막 트랙을 빼면 앨범도 자동 삭제. 그 경우 응답에 `album_deleted: true`.

---

### 앨범 트랙 순서 변경

```
PUT /api/albums/{album_id}/tracks/order
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"track_ids": ["objectid", ...]}` (앨범의 현재 트랙 집합과 정확히 일치해야 함)

---

### 앨범 커버 변경

```
PATCH /api/albums/{album_id}/cover
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | multipart/form-data |

**폼 필드 (셋 중 하나):**

- `cover_file` 업로드 → 업로드 커버
- `cover_object_name` (Form) → AI 생성 커버
- 둘 다 빈 값 → 첫 번째 트랙에서 자동 borrow

---

### 앨범용 AI 커버 생성

```
POST /api/albums/cover/generate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "title": "앨범 제목 (필수)",
  "description": "선택. 추가 스타일 설명",
  "track_ids": ["objectid", ...],
  "gender": "female|male|neutral (기본 neutral)",
  "image_model": "nb_pro|gpt_image_2 (기본 nb_pro)",
  "include_character": false
}
```

`track_ids` 가 주어지면 본인 소유 검증 후 트랙 메타데이터(장르/분위기) 를 집계. `include_character=true` 면 저장된 주인공 캐릭터 시트를 함께 사용합니다.

**응답 (200):**
```json
{
  "cover_object_name": "covers/generated/{uid}/album_{hex}.png",
  "cover_image_url": "https://presigned..."
}
```

---

### 앨범 상세 조회

```
GET /api/albums/{album_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 선택 (비공개 앨범은 소유자만) |

JWT 가 있으면 본인의 비공개 앨범도 조회 가능. 응답에는 `tracks` 배열이 포함됩니다.

---

## 6. 차트 API (`/api/charts`)

차트는 Redis 의 유니크 청취자/다운로드 셋을 기반으로 5분 캐시. 한국 표준시(KST) 기준.

### 재생 기록

```
POST /api/charts/record-play
```

| 항목 | 값 |
|------|---|
| 인증 | 선택 |
| Content-Type | application/json |

**요청 본문:** `{"track_id": "objectid"}`

비로그인 호출도 200 으로 처리되지만 차트 점수에는 반영되지 않습니다(레거시 `play_count` 만 증가).

**응답 (200):** `{"ok": true}`

---

### 차트 조회

```
GET /api/charts/{chart_type}?limit=100
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`chart_type` ∈ `top100 / hot100 / daily / weekly / monthly`. 그 외 값은 400.

**응답 (200):** 트랙 객체 배열 (각 항목에 `rank / score / change / chart_type / chart_update_time / listeners_24h / listeners_1h / downloads` 포함).

차트 유형별 계산식:

- **top100**: 낮(08~24 KST) = 24h 점수 50% + 1h 점수 50%, 밤(01~07 KST) = 24h 점수 100%. 점수 = 스트림 0.4 + 다운로드 0.6.
- **hot100**: 1h 점수 (30일 내 출시 트랙만).
- **daily / weekly / monthly**: 해당 기간 유니크 스트림 0.4 + 다운로드 0.6.

데이터가 없으면 `play_count` 폴백.

---

### 장르 차트

```
GET /api/charts/genre/{genre}?limit=50
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`play_count` 내림차순.

---

### 카테고리 목록 (v77, 9005)

```
GET /api/charts/categories
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

고정 10종 카테고리 화이트리스트를 반환.

```json
{ "categories": ["운동", "에너지 충전", "휴식", "출퇴근길", "행복한 기분", "집중", "로맨스", "파티", "슬픔", "잠자기"] }
```

---

### 카테고리별 차트 (v77, 9005)

```
GET /api/charts/category/{category}?limit=50
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`tracks.categories` 배열 멤버십으로 필터(`is_public:true`), `play_count` 내림차순. 응답은 genre 차트와 동일한 트랙 직렬화 배열. 화이트리스트 밖의 `{category}` 는 빈 배열 `[]` 반환.

각 트랙 응답에는 `categories: string[]` 필드가 포함된다.

---

## 7. 플레이리스트 API (`/api/playlists`)

플레이리스트는 PostgreSQL `playlists`/`playlist_tracks`, 트랙 본문은 MongoDB.

> v89 — `description`(선택, 텍스트) 필드 지원. `POST /api/playlists/` 및 `PUT /api/playlists/{playlist_id}` 가 선택 항목 `description` 을 받고, `GET /api/playlists/` 및 `GET /api/playlists/{playlist_id}` 응답에 `description` 이 포함된다. 시작 시 idempotent 마이그레이션으로 `playlists.description` 컬럼을 보장.

### 내 플레이리스트 목록

```
GET /api/playlists/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 플레이리스트 생성

```
POST /api/playlists/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:** `{"title": "필수", "description": "선택", "is_public": true}`

**응답 (201):** 플레이리스트 객체 (`description` 포함).

---

### 플레이리스트 상세

```
GET /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

비공개는 소유자만(403). 응답에 `tracks: [...]` 포함.

---

### 플레이리스트 수정

```
PUT /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"title": "...", "description": "...", "is_public": true/false}` (모두 선택)

---

### 플레이리스트 삭제

```
DELETE /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

---

### 트랙 추가

```
POST /api/playlists/{playlist_id}/tracks
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"track_id": "objectid"}`

이미 추가된 트랙은 409.

---

### 트랙 제거

```
DELETE /api/playlists/{playlist_id}/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

---

## 8. 좋아요 API (`/api/likes`)

### 좋아요 여부 일괄 확인

```
GET /api/likes/check?song_ids=id1,id2,id3
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):** `{"liked_ids": ["id1", "id3"]}`

---

### 좋아요 한 트랙 목록

```
GET /api/likes/?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "likes": [ /* track + liked_at */ ],
  "pagination": {"page": 1, "limit": 20, "total": 5, "totalPages": 1}
}
```

---

### 좋아요 추가

```
POST /api/likes/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

이미 좋아요 된 트랙은 409.

---

### 좋아요 취소

```
DELETE /api/likes/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 9. 팔로우 API (`/api/follows`)

### 팔로우 하기

```
POST /api/follows/{user_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

자기 자신 팔로우 400, 이미 팔로우중 409.

---

### 팔로우 해제

```
DELETE /api/follows/{user_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 나를 팔로우한 사람들

```
GET /api/follows/followers?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 내가 팔로우한 사람들

```
GET /api/follows/following?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 10. 아티스트(크리에이터) API (`/api/artists`)

v2 에서 아티스트는 별도 엔티티가 아니라 "트랙을 업로드한 사용자(크리에이터)" 로 동작합니다.

### 크리에이터 목록 (재생수 순)

```
GET /api/artists/?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

---

### 크리에이터 상세

```
GET /api/artists/{artist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`artist_id` 는 사용자 UUID.

---

### 크리에이터의 트랙

```
GET /api/artists/{artist_id}/tracks?limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

공개 트랙만, `play_count` 내림차순.

---

### 크리에이터의 앨범

```
GET /api/artists/{artist_id}/albums?limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

공개 앨범만, 최신순.

---

## 11. 업로드 / 커버 생성 API (`/api/upload`)

### 이미지 업로드 (트랙 커버 / 프로필)

```
POST /api/upload/image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | jpg/jpeg/png/webp, ≤10MB |
| type | str | O | `cover` / `profile` |
| id | str | O | `cover` 면 track_id (ObjectId), `profile` 면 user_id (UUID) |

**응답 (200):** `{"file_url": "https://presigned...", "object_name": "..."}`

---

### Presigned URL 발급

```
GET /api/upload/presigned-url?bucket=images&object_name=path/to/file
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

`bucket` ∈ `images` (기본) / `music`. 24시간 유효.

**응답 (200):** `{"url": "https://presigned..."}`

---

### AI 커버 이미지 생성

```
POST /api/upload/generate-cover
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "title": "곡 제목 (필수)",
  "genre": "string",
  "mood": "string",
  "style": "string",
  "character_object_name": "characters/{uid}/sheet.png",
  "user_prompt": "자유 설명",
  "prompt_model": "claude-opus-4-7",
  "location_id": "주인공 장소 ID (선택)",
  "image_model": "nb_pro|gpt_image_2 (기본 nb_pro)",
  "vocal_gender": "female|male|neutral 또는 한국어 별칭(여자/여성/남자/남성/중성/지정 없음)"
}
```

- `image_model=nb_pro` → Google API 키 필요, `gpt_image_2` → OpenAI API 키 필요.
- 잘못된 `image_model` / `vocal_gender` 는 400.

**응답 (200):**
```json
{
  "image_url": "/api/upload/cover-preview/covers/generated/...",
  "object_name": "covers/generated/...",
  "image_model": "nb_pro",
  "cover_session_id": "objectid",
  "message": "커버 이미지가 생성되었습니다."
}
```

`cover_session_id` 는 추가 수정(refine)/되돌리기(revert)/이력(history) 호출에 사용.

---

### 커버 부분 수정 (multi-turn refine)

```
POST /api/upload/refine-cover
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "cover_session_id": "objectid (필수)",
  "refine_prompt": "수정 요청 ≤500자 (필수)"
}
```

해당 세션의 현재 커버를 ref 로 사용하여 새 버전(`v{N}`) 을 만들고 history 에 append (최대 10개 유지).

**응답 (200):**
```json
{
  "cover_object_name": "covers/refined/{uid}/{session}/v3.png",
  "image_url": "/api/upload/cover-preview/...",
  "current_version": 3,
  "cover_refine_history": [
    {"version": 0, "object_name": "...", "refine_prompt": null, "image_model": "nb_pro", "created_at": "..."},
    {"version": 1, "object_name": "...", "refine_prompt": "...", "image_model": "nb_pro", "created_at": "..."}
  ]
}
```

---

### 이전 버전으로 되돌리기

```
POST /api/upload/revert-cover
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"cover_session_id": "objectid", "target_version": 1}
```

history 자체는 보존, `cover_object_name`/`current_version` 만 갱신.

---

### 커버 수정 이력 조회

```
GET /api/upload/cover-history/{cover_session_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (세션 소유자) |

**응답 (200):**
```json
{
  "cover_session_id": "objectid",
  "current_version": 2,
  "image_model": "nb_pro",
  "cover_object_name": "covers/refined/...",
  "cover_refine_history": [ /* entries */ ]
}
```

---

### 커버 이미지 프록시 (퍼블릭 미리보기)

```
GET /api/upload/cover-preview/{object_name:path}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | PNG 바이트 |

`/api/upload/generate-cover` 응답의 `image_url` 이 가리키는 경로.

---

### 레거시 MV 생성 (간단 파이프라인)

```
POST /api/upload/generate-mv
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "title": "제목 (필수)",
  "genre": "string",
  "mood": "string",
  "lyrics": "string",
  "cover_object_name": "covers/..."
}
```

> 참고: 정식 MV 워크플로우는 `/api/mv/*` 를 사용하세요. 본 엔드포인트는 단일 단계로 작업을 시작하고 `job_id` 만 반환합니다.

**응답 (200):** `{"job_id": "objectid", "message": "뮤직비디오 생성이 시작되었습니다. (20장면 파이프라인)"}`

---

### 레거시 MV 상태 폴링

```
GET /api/upload/mv-status/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "status": "pending|generating|completed|failed",
  "progress": 0,
  "total_scenes": 0,
  "completed_scenes": 0,
  "scene_thumbnails": ["presigned URL..."],
  "result_video_url": "presigned URL 또는 /api/upload/mv-preview/...",
  "object_name": "mv/...",
  "error_message": ""
}
```

---

### MV / 썸네일 프록시

```
GET /api/upload/mv-preview/{object_name:path}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | 이미지 또는 비디오 바이트 (확장자 기반) |

---

## 12. AI 음악 생성 API (`/api/generate`)

생성 요청은 MongoDB `generations` 컬렉션에 저장됩니다. 모델은 `suno` 만 지원.

### 모델 목록

```
GET /api/generate/models/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{"models": [
  {
    "id": "suno",
    "name": "Suno",
    "description": "AI 음악 생성 서비스 (고품질 보컬 + 반주)",
    "supports_vocal": true,
    "supports_instrumental": true,
    "max_duration": 240,
    "default": true
  }
]}
```

---

### 가사 생성

```
POST /api/generate/lyrics/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "prompt": "필수",
  "genre": "string",
  "mood": "string",
  "style": "string",
  "duration_minutes": 2,
  "duet": false,
  "duet_main_vocal_style": "string",
  "duet_sub_vocal_style": "string",
  "language": "ko",
  "models": ["gpt-4o-mini", "claude-opus-4-6"]
}
```

`models` 가 여러 개면 모델별 비교 결과를 함께 반환.

**응답 (200) — v77, 9005:** LLM 이 `title`/`lyrics`/`categories` 를 JSON 한 번에 산출하고 백엔드가 방어적으로 파싱해 재조립한다. `categories` 는 항상 고정 10종 화이트리스트로 필터된 문자열 배열(0개~다수).

단일 모델:
```json
{ "title": "...", "lyrics": "...(섹션 태그 [Verse] 포함)...", "categories": ["휴식", "잠자기"], "model": "gpt-4o-mini" }
```
2모델 비교:
```json
{ "results": [
  { "title": "...", "lyrics": "...", "categories": ["운동"], "model": "gpt-4o-mini" },
  { "title": "...", "lyrics": "...", "categories": [], "model": "claude-opus-4-6" }
] }
```

> 프론트는 생성 폼에서 받은 `categories` 를 그대로 `POST /api/generate/` 와 `POST /api/tracks/upload-from-generation` 의 `categories` 로 전달하면 된다.

---

### 스타일 태그 영어 번역

```
POST /api/generate/translate-tags
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:** `{"tags": ["국악", "재즈"]}`

**응답 (200):** `{"translated": ["Korean traditional", "Jazz"]}`

---

### 참고 오디오 업로드

```
POST /api/generate/upload-reference/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:** `file` (`.mp3/.wav/.m4a/.ogg/.flac`, ≤50MB, ≤8분)

**응답 (200):**
```json
{
  "upload_url": "presigned (24h)",
  "object_name": "reference/{uid}/{hex}.mp3",
  "filename": "원본 파일명",
  "duration_sec": 123.45
}
```

---

### 생성 요청 생성

```
POST /api/generate/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문 주요 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| prompt | str (필수) | |
| title | str | |
| genre / mood / style / vocal / instruments / reference_style | str | |
| duration | int | 초, 기본 30 |
| bpm | int | |
| key | str | |
| lyrics | str | |
| start_music_gen | bool | `true` 면 즉시 백그라운드 음악 생성 시작 |
| model | str | 기본 `suno` |
| persona_id | str | Suno Voice Persona ID |
| negative_tags | str | |
| style_weight / weirdness / audio_weight | float (0~1) | |
| persona_model | str | `style_persona` / `voice_persona` |
| reference_audio_url | str | upload-reference 응답의 presigned URL |
| reference_audio_name | str | |
| reference_audio_duration | float | |
| duet_main_vocal_style / duet_sub_vocal_style | str | |
| categories | string[] | v77, 9005. 고정 10종 화이트리스트. 저장 전 필터되어 generations doc 의 `categories` 로 저장 |

**응답 (201):** generation 객체 (`id`, `status="pending"`, `progress`, `categories`, ...).

---

### 음악 생성 시작 (별도 호출)

```
POST /api/generate/{gen_id}/start/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

이미 `processing` 이면 409.

---

### 생성 목록

```
GET /api/generate/?page=1&limit=20&status=completed
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

`status` 선택 (`pending` / `processing` / `completed` / `failed`).

---

### 생성 상세

```
GET /api/generate/{gen_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

---

### 생성 삭제

```
DELETE /api/generate/{gen_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

---

### 비트 추출 결과

```
GET /api/generate/{gen_id}/beats
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

응답 스키마는 [트랙 비트 조회](#트랙-비트beats-조회) 와 동일.

---

### 비트 재추출

```
POST /api/generate/{gen_id}/beats/retry
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

완료된 생성만 가능.

---

### 가사 타임스탬프 재수집 (v113 문서화 — 기존 엔드포인트)

```
POST /api/generate/{gen_id}/timestamps/refetch?force=false
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Query | `force` (bool, 기본 false) |
| Body | 없음 |

**동작:** Suno 에서 variant 별 가사 타임스탬프를 온디맨드 재수집.
- `force=false`(기본): 타임스탬프가 **비어있는 variant 만** 채움 (이미 있는 것은 유지).
- `force=true`: 모든 variant 재수집. 단 병합은 안전 — 새 수집이 비어있으면(일시 실패 등) 기존 값을 유지해 좋은 데이터가 덮어써지지 않음.

**제약:** `status='completed'` 생성물만 가능(아니면 400). variants 없으면 400. 타인 403, 없는 ID 404.

**응답 (200):** 갱신된 generation 문서 전체 — `GET /api/generate/{gen_id}` 와 동일 shape.

---

### 결과 오디오 스트림 (다운로드)

```
GET /api/generate/{gen_id}/stream/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | 오디오 (`Content-Disposition: attachment`) |

---

## 13. 뮤직비디오(MV) API (`/api/mv`)

본격 MV 워크플로우. MongoDB `mv_jobs` 컬렉션 기반. 페이즈가 백그라운드로 진행되며 폴링으로 진행 상태를 확인합니다.

### 작업 상태(Status) 값

| 값 | 설명 |
|------|------|
| `draft` | 초기 |
| `splitting` | 시나리오/씬 분할 중 |
| `generating_images` | 씬 이미지 생성 중 |
| `generating_videos` | 씬 영상 생성 중 |
| `concatenating` | 영상 합치기 중 |
| `merging_audio` | 음악과 합치기 중 |
| `completed` | 완료 |
| `paused` | 일시정지 (서버 재시작/외부 한도 등) |
| `failed` | 실패 |
| `cancelled` | 사용자 취소 |

### MV 작업 생성

```
POST /api/mv/create
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문 주요 필드:**

| 필드 | 타입 | 기본/제약 | 설명 |
|------|------|----------|------|
| title | str (필수) | | |
| genre | str | | |
| mood | str | | |
| lyrics | str | | |
| cover_object_name | str (필수) | | 사전 생성된 커버 객체명 |
| audio_duration_sec | float | | 씬 수 자동 계산 (5~60) |
| scene_prompt | str | | |
| character_object_name | str | | 캐릭터 시트 객체명 |
| character_variant | str | 기본 `real` | `real`/`virtual` — 커버에 쓴 캐릭터 기준으로 `user_character_snapshot` 을 실사(real: sheet_object_name/used_items) 또는 가상(virtual: virtual_sheet_object_name/virtual_used_items)으로 생성. 미전송/그 외 값은 `real` 정규화 |
| video_model | str | 기본 `veo` | `veo`/`kling`/`seedance`/`grok` |
| audio_generation_id | str | | 연동할 generation ID |
| scenario_models | str[] | | 시나리오 생성 모델 (예: `["gpt-4o-mini","claude-opus-4-6"]`) |
| prompt_models | str[] | | 이미지 프롬프트 생성 모델 |
| video_prompt_model | str | | 비디오 프롬프트 생성 모델 |
| scenario_style | str | 기본 `drama` | 현재 drama 만 구현 |
| vocal_gender | str | | `female`/`male`/`neutral` |
| relationship | str | | `lover`/`crush`/`ex_lover`/`friend`/`colleague`/`family`/`none` 또는 한국어 별칭 |
| include_my_character | bool | 기본 `false` | 저장된 주인공 캐릭터 포함 |
| location_id | str | | 저장된 장소 ID (선택) |
| user_event_seed | str | ≤300자 | 시나리오 사건 시드 |
| image_model | str | 기본 `nb_pro` | `nb_pro`/`gpt_image_2` |
| cover_image_model | str | | 커버 생성 시 사용한 모델 스냅샷 |
| use_cover_person_as_character1 | bool | 기본 `true` | 커버 인물을 주인공 자산으로 |

**응답 (200):** `{"job_id": "objectid", "status": "splitting", "message": "..."}`

---

### 내 MV 작업 목록

```
GET /api/mv/jobs?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "jobs": [
    {
      "job_id": "objectid",
      "title": "...",
      "status": "completed",
      "progress": 100,
      "total_scenes": 20,
      "completed_image_count": 20,
      "completed_video_count": 20,
      "cover_object_name": "...",
      "thumbnail_url": "presigned",
      "result_video_url": "presigned",
      "result_music_video_url": "presigned",
      "error_message": "",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

---

### MV 작업 상세

```
GET /api/mv/jobs/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

응답에는 씬 배열(영문/한국어 프롬프트, presigned URL 등), 시나리오 본문, 자산(`assets`) 메타, cascade 진행 상태, 사용자 편집 표시(user_edited_fields) 가 포함됩니다. `_ko`/`_en` 한쪽이 비어 있으면 GET 시점에 lazy 번역 및 저장.

**주요 응답 필드:**
```json
{
  "job_id": "objectid",
  "title": "...",
  "genre": "...",
  "mood": "...",
  "lyrics": "...",
  "cover_object_name": "...",
  "cover_url": "presigned",
  "assets": {"character1": {"object_name": "...", "image_url": "presigned", ...}},
  "status": "...",
  "progress": 0,
  "error_message": "",
  "total_scenes": 0,
  "completed_image_count": 0,
  "completed_video_count": 0,
  "scenes": [/* 씬 객체 */],
  "result_video_url": "presigned 또는 null",
  "result_object_name": "...",
  "result_music_video_url": "presigned 또는 null",
  "result_music_video_object_name": "...",
  "retry_info": null,
  "synclabs_total": null,
  "synclabs_completed": null,
  "scenario": "...",
  "scenario_meta": {...},
  "scenario_style": "drama",
  "scenario_narrative": "...",
  "scenario_premise": "...",
  "scenario_character_states": {...},
  "scenario_central_conflict": "...",
  "scenario_emotional_core": "...",
  "scenario_narrative_arc": {...},
  "scenario_events": [
    {"order": 1, "trigger": "...", "protagonist_action": "...", "motivation": "...",
     "emotion_shift": "...", "props": [], "user_edited_fields": []}
  ],
  "scenario_brainstorm": {...},
  "scenario_inferred_relationship": "lover|null",
  "scenario_selected_archetype": "...",
  "scenario_archetype_weights": {...},
  "user_event_seed": "...",
  "image_model": "nb_pro",
  "cover_image_model": "nb_pro|null",
  "scenario_user_edited_fields": [],
  "cascade_phase": null,
  "cascade_progress": 0,
  "cascade_started_at": null,
  "cascade_completed_at": null,
  "cancel_requested": false,
  "cascade_id": null,
  "scenes_archive_count": 0,
  "vocal_gender": "female|male|neutral|null",
  "relationship": "...",
  "include_my_character": false,
  "scene_prompt": "...",
  "character_object_name": "...",
  "video_model": "veo",
  "music_sections": null,
  "has_subtitles": true,
  "audio_generation_id": "...",
  "audio_file_name": "...",
  "tags": "...",
  "prompt": "...",
  "ai_model": "Suno",
  "created_at": "...",
  "updated_at": "..."
}
```

씬 객체(요약):
```json
{
  "scene_number": 1,
  "description": "...",
  "image_prompt": "...",
  "video_image_prompt": "...",
  "video_prompt": "...",
  "description_ko": "...",
  "image_prompt_ko": "...",
  "video_prompt_ko": "...",
  "lyrics_segment": "...",
  "image_object_name": "...",
  "image_url": "presigned",
  "image_source": "gemini|upload|...",
  "video_object_name": "...",
  "video_url": "presigned",
  "video_with_audio_url": "presigned",
  "video_synclabs_url": "presigned",
  "video_with_audio_synclabs_url": "presigned",
  "video_status": "pending|generating|completed|failed",
  "video_error": null,
  "sync_error": null,
  "video_source": "...",
  "use_seconds": 8.0,
  "section": "intro|verse|...",
  "section_mood": "...",
  "scene_type": "drama|lipsync|...",
  "section_start": 0.0,
  "section_end": 8.0,
  "clip_mood": "...",
  "event_index": 0,
  "user_edited_fields": [],
  "cascade_status": "idle|running|completed|cancelled",
  "cascade_progress": 0,
  "cascade_started_at": null,
  "cascade_completed_at": null,
  "cascade_id": null,
  "cancel_requested": false
}
```

---

### 시나리오 선택 (이중 모델 결과 중)

```
POST /api/mv/jobs/{job_id}/select-scenario
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"model": "gpt-4o-mini"}`

선택 후 씬 분할이 자동 진행됩니다.

---

### 이미지 프롬프트 선택

```
POST /api/mv/jobs/{job_id}/select-prompts
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"model": "gpt-5.4"}`

선택 후 이미지 생성이 자동 진행됩니다.

---

### 씬 이미지 일괄 생성 / 재생성

```
POST /api/mv/jobs/{job_id}/generate-images
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (선택):** `{"scene_numbers": [1, 3, 5]}` 미지정 시 이미지 없는 씬 전체.

작업이 active 중이면 409.

---

### 씬 이미지 업로드(사용자 직접)

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/upload-image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | multipart/form-data |

**폼:** `file` (jpg/jpeg/png/webp, ≤10MB)

이미지를 바꾸면 해당 씬의 비디오는 `pending` 으로 리셋.

---

### 씬 이미지 단일 재생성 (동기)

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/regenerate-image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

해당 씬의 `image_prompt` 와 자산(`@character1` 등) 을 사용하여 1장 합성.

---

### 씬 필드 부분 수정

```
PATCH /api/mv/jobs/{job_id}/scenes/{scene_number}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택, 최소 1개 필수):**
```json
{
  "description": "string",
  "image_prompt": "string",
  "video_prompt": "string",
  "description_ko": "string",
  "image_prompt_ko": "string",
  "video_prompt_ko": "string"
}
```

수정된 필드는 `user_edited_fields` 에 누적. cascade 는 별도 호출.

---

### 씬 cascade 재생성 시작

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/cascade-regenerate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"trigger_field": "description"}`

`trigger_field` ∈ `description / image_prompt / video_prompt` 또는 `*_ko` 변형. 이미 running 이면 409.

**응답 (202):**
```json
{
  "accepted": true,
  "scene_number": 5,
  "cascade_id": "uuid",
  "trigger_field": "description",
  "estimated_phases": ["phase1b", "phase2", "phase2.5"]
}
```

---

### 씬 cascade 취소

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/cancel-cascade
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

idempotent. 다음 phase 진입 시점에 종료됩니다.

---

### 시나리오 사건(event) 부분 수정

```
PATCH /api/mv/jobs/{job_id}/scenario/events/{order}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

`order` 는 1-based.

**요청 본문 (모두 선택, 최소 1개):**
```json
{
  "trigger": "...",
  "protagonist_action": "...",
  "motivation": "...",
  "emotion_shift": "...",
  "props": ["..."]
}
```

수정 필드는 해당 event 의 `user_edited_fields` 에 누적.

---

### 시나리오 사건 단위 cascade

```
POST /api/mv/jobs/{job_id}/scenario/events/{order}/cascade-regenerate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

해당 event 에 매핑된 모든 씬을 description 기준으로 cascade. 영향 씬이 없어도 202.

**응답 (202):** `{"accepted": true, "event_order": 3, "affected_scenes": [5, 6, 7]}`

---

### 사건 cascade 취소

```
POST /api/mv/jobs/{job_id}/scenario/events/{order}/cancel-cascade
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):** `{"event_order": 3, "cancelled_scenes": [5, 6]}`

---

### 시나리오 상위 필드 부분 수정

```
PATCH /api/mv/jobs/{job_id}/scenario
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택, 최소 1개):**
```json
{
  "narrative": "string",
  "premise": "string",
  "character_states": {"character1": {"state": "..."}},
  "central_conflict": "string",
  "emotional_core": "string",
  "narrative_arc": {"intro": "...", "climax": "..."}
}
```

타입 불일치(예: `narrative` 가 string 이 아님) 시 400.

---

### 시나리오 사건 배열 일괄 교체

```
PATCH /api/mv/jobs/{job_id}/scenario/events
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "events": [
    {"trigger": "...", "protagonist_action": "...", "motivation": "...",
     "emotion_shift": "...", "props": ["..."], "user_edited_fields": []}
  ]
}
```

최소 1개 필수. `order` 는 백엔드가 1,2,3,... 자동 재계산.

---

### 시나리오 전체 cascade

```
POST /api/mv/jobs/{job_id}/scenario/cascade-regenerate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

이미 진행 중이면 409. 시나리오 자체가 없으면 400.

**응답 (202):** `{"accepted": true, "cascade_id": "uuid", "estimated_phases": 5}`

---

### 시나리오 cascade 취소

```
POST /api/mv/jobs/{job_id}/scenario/cancel-cascade
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):** `{"cancelled": true, "cascade_phase": "scene_split"}`

---

### user_edited_fields 일괄 / 부분 해제

```
POST /api/mv/jobs/{job_id}/user-edited/reset
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "scope": "all|scene|event|scenario",
  "target": 5,
  "fields": ["description", "image_prompt"]
}
```

- `scope=all` → 모두 비움 (`target`/`fields` 무시).
- `scope=scenario` → 시나리오 상위 표시 해제.
- `scope=scene`+`target=scene_number` → 해당 씬.
- `scope=event`+`target=order` → 해당 사건.
- `fields` 미지정 시 entity 전체 표시 해제.

**응답 (200):** `{"cleared": 7}`

---

### user_edited_fields 요약 조회

```
GET /api/mv/jobs/{job_id}/user-edited/summary
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):**
```json
{
  "scenario": ["narrative", "events"],
  "events": {"3": ["trigger"]},
  "scenes": {"5": ["image_prompt"]}
}
```

---

### 단일 씬 영상 생성

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

이미지가 없는 씬은 400. 이미 generating 이면 409.

---

### 씬 영상 일괄 생성 / 재시도

```
POST /api/mv/jobs/{job_id}/generate-videos
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택):**
```json
{
  "scene_numbers": [1, 2],
  "video_model": "veo|kling|seedance|grok"
}
```

`video_model` 을 주면 작업의 video_model 도 갱신. 작업이 active 중이면 409.

---

### 영상 합치기 (concat)

```
POST /api/mv/jobs/{job_id}/concatenate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

완료된 영상이 한 개도 없으면 400.

---

### 영상 + 음악 합치기 (최종 MV)

```
POST /api/mv/jobs/{job_id}/merge-audio
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"audio_object_name": "tracks/.../song.mp3"}`

`result_video_url` 이 없으면 400.

---

### 임시저장(폼 메타 저장)

```
POST /api/mv/jobs/{job_id}/save-draft
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문 (모두 선택):**
```json
{
  "audio_generation_id": "...",
  "audio_file_name": "...",
  "genre": "...",
  "mood": "...",
  "tags": "...",
  "prompt": "...",
  "ai_model": "..."
}
```

---

### 작업 중지 요청

```
POST /api/mv/jobs/{job_id}/cancel
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

active 상태가 아니면 400. 현재 처리 중인 씬이 끝나는 시점에 멈춥니다.

---

### 작업 삭제

```
DELETE /api/mv/jobs/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

처리 중이면 409. MinIO `mv/{job_id}/` 하위 객체까지 삭제.

---

### 영상 모델 목록

```
GET /api/mv/models
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):**
```json
{"models": [
  {"id": "veo", "name": "Veo 3.1", "provider": "Google", "description": "...", "duration": "8초", "available": true},
  {"id": "kling", "name": "Kling V3", "provider": "Kling AI", "description": "...", "duration": "10초", "available": true}
]}
```

---

### 립싱크 씬 보컬 분리

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/separate-vocal
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

립싱크 씬에서 해당 구간의 원본+보컬 오디오를 base64 data URL 로 반환. 이미 캐시되어 있으면 `cached: true`.

**응답 (200):**
```json
{
  "original_audio_url": "data:audio/mpeg;base64,...",
  "vocal_audio_url": "data:audio/wav;base64,...",
  "scene_number": 5,
  "cached": false
}
```

---

### Sync Labs 립싱크 재시도

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/retry-sync
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

립싱크 씬 + 영상이 있어야 함. Sync Labs API 키 미설정 시 503.

---

## 14. 캐릭터 API (`/api/character`)

주인공 캐릭터(시트 + 메타) 1인 보관. 이미지/MV 생성 시 자동 활용. `사용자 장소(location)` 라이브러리도 함께 관리.

### 성격 태그 추천

```
GET /api/character/personality-tags
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):**
```json
{"tags": ["내향적", "외향적", "감성적", "이성적", "유머러스", "진지함", "쿨함", "따뜻함", "반항적", "순수함", "냉소적", "낙천적"]}
```

---

### 원본 사진 영구 업로드

```
POST /api/character/upload-original-photo
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:** `file` (jpg/jpeg/png/webp, ≤10MB).

영구 경로(`characters/{uid}/original.{ext}`) 에 저장하고 `characters.original_photo_object_name` 갱신.

**응답 (200):** `{"object_name": "characters/.../original.jpg", "message": "원본 사진이 업로드되었습니다."}`

---

### 캐릭터 시트 생성

```
POST /api/character/generate-sheet
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 얼굴 사진 (jpg/jpeg/png/webp, ≤10MB) |
| top_image | File | - | 상의 이미지 직접 업로드 (선택) |
| bottom_image | File | - | 하의 이미지 직접 업로드 (선택) |
| shoes_image | File | - | 신발 이미지 직접 업로드 (선택) |
| top_object_name | str | - | 광고상품 상의 아이템 MinIO `image_object_name` (선택) |
| bottom_object_name | str | - | 광고상품 하의 아이템 MinIO `image_object_name` (선택) |
| shoes_object_name | str | - | 광고상품 신발 아이템 MinIO `image_object_name` (선택) |
| user_text | str | - | 추가 설명 |
| image_model | str | - | `nb_pro` (기본) / `gpt_image_2` |

> **아이템 해석 우선순위**: 각 부위별로 `*_object_name` 이 있으면 images 버킷에서
> 로딩해 우선 사용, 없으면 `*_image` 업로드 사용, 둘 다 없으면 미참조(사진 기반/자유 생성).
> 로딩 실패(없는 키 등)는 앱을 죽이지 않고 해당 아이템만 미참조 처리.
> 프롬프트 조립은 **동적**(`_build_step1_answer`) — 선택분만 `[X 참조]` 이미지 분석,
> 미선택은 사진 기반/자유 생성. 이미지 식별은 첨부 순번이 아니라 **역할 라벨**
> (`[인물 사진]`/`[상의 참조]`/`[하의 참조]`/`[신발 참조]`)로 한다.

**응답 (200):**
```json
{
  "object_name": "characters/temp/{uid}/{hex}.png",
  "original_object_name": "characters/temp/{uid}/original_{hex}.jpg",
  "preview_url": "/api/character/preview/...",
  "image_model": "nb_pro",
  "message": "캐릭터 시트가 생성되었습니다."
}
```

---

### 가상화(그림/만화 화풍) 캐릭터 시트 생성

실사 시트와 **동일 절차**(2-step Gemini text→image)이되 별도 프롬프트
`MASTER_PROMPT_CARTOON` 사용. 선택 아이템(상의/하의/신발)은 **선택 화풍으로 변환되어**
캐릭터에게 착용된 상태로 그려진다. 실사 기능과 완전 분리(무손상).
**정체성 보존 강화(2+3):** 정체성(얼굴형/이목구비/머리/체형/피부톤)은 **오직 [인물 사진]**
에서만 추출하고 [화풍 참조] 인물은 절대 복제 금지(스타일만 차용). 사진에서 추출한 굵직한 식별
특징(얼굴형·머리·안경·피부톤·특이점)을 **[고정 요소]로 명시·고정**하고, 과도한 스타일화로
정체성을 덮지 않도록 억제하여 원본 인물을 알아볼 수 있게 그린다.
**Step A 인물 묘사 정석화:** Step A(사진→텍스트)에서 얼굴 이목구비의 미세 기하(얼굴형/턱/광대/
눈매/코/입술/눈썹 두께·표정)와 머리카락 세부 질감은 **주관적 형용사(refined/delicate/두꺼운/
얇은/natural thickness 등)로 단정하지 않고 [인물 사진]을 직접 따른다**(이미지=정체성 앵커).
텍스트 시트에는 **식별용 객관·범주값만** 남긴다 — 얼굴: `Eye color`/`Glasses`/`Skin tone`/
`Facial hair`/`Distinctive marks`, 머리: `Length`/`Part`/`Style`/`Color`/`Volume`/`Flow`/`State`.
STEP 6 의 Position/Size/Shape/Material/State 상세 규격·모호 표현 금지 규칙은 **의상·소품·배경·
레이아웃 등 새로 정의하는 시각 요소에만** 적용하고, 사진에서 가져오는 얼굴·머리 정체성 요소는
이 규격 대상에서 제외한다(실사 `MASTER_PROMPT` 는 불변).

```
POST /api/character/generate-sheet-cartoon
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 얼굴(인물) 사진 (jpg/jpeg/png/webp, ≤10MB) |
| top_image | File | - | 상의 이미지 직접 업로드 (선택, 화풍으로 변환되어 착용) |
| bottom_image | File | - | 하의 이미지 직접 업로드 (선택) |
| shoes_image | File | - | 신발 이미지 직접 업로드 (선택) |
| top_object_name | str | - | 광고상품 상의 아이템 MinIO `image_object_name` (선택) |
| bottom_object_name | str | - | 광고상품 하의 아이템 MinIO `image_object_name` (선택) |
| shoes_object_name | str | - | 광고상품 신발 아이템 MinIO `image_object_name` (선택) |
| user_text | str | - | 추가 설명 |
| image_model | str | - | `nb_pro` (기본) / `gpt_image_2` |
| style_preset | str | △ | `webtoon` / `anime` / `manga90` 중 1 (번들 샘플 화풍) |
| style_image | File | △ | 사용자 업로드 화풍 reference 이미지 |

> 아이템 해석 우선순위는 실사 `/generate-sheet` 와 동일(`*_object_name` 우선 → `*_image`).
> 동적 조립(`_build_step1_answer`)·역할 라벨 식별 경로를 실사와 **공유**한다.
> `style_image` 가 있으면 우선 사용(art_style="the art style of the attached style
> reference image"). 없으면 `style_preset` 의 번들 샘플 사용. 둘 다 없으면 **400**.
> style reference 는 `[화풍 참조]` 라벨 파트와 함께 inline 이미지 뒤에 추가되어
> 역할 라벨로 식별된다(순번 비의존).

**응답 (200):**
```json
{
  "object_name": "characters/temp/{uid}/{hex}.png",
  "original_object_name": "characters/temp/{uid}/original_{hex}.jpg",
  "preview_url": "/api/character/preview/...",
  "image_model": "nb_pro",
  "art_style": "Korean webtoon style",
  "art_style_key": "webtoon",
  "message": "가상화 캐릭터 시트가 생성되었습니다."
}
```

키 미설정 시 503(nb_pro→Google, gpt_image_2→OpenAI), 잘못된 image_model 400.

---

### 캐릭터 시트 생성 — 비동기 접수 + 폴링 (권장)

시트 생성은 3~6분+ 걸릴 수 있어 동기 호출은 클라이언트 타임아웃에 걸리기 쉽다.
아래 비동기 패턴을 권장한다 (동기 `/generate-sheet(-cartoon)` 은 하위호환으로 유지).

```
POST /api/character/generate-sheet-async
POST /api/character/generate-sheet-cartoon-async
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:** 각각 동기판 `/generate-sheet`, `/generate-sheet-cartoon` 과 **완전히 동일**.
검증(image_model 400, 키 미설정 503, 파일 형식/크기 400, cartoon 화풍 미지정 400)도
동일하게 **접수 시점에 즉시** 수행 — 검증 실패면 job 이 생성되지 않는다.

**응답 (200, 즉시):**
```json
{"job_id": "665f0c...24hex", "status": "processing"}
```

접수 후 생성은 백그라운드에서 진행되고 MongoDB `character_jobs` 에 기록된다.

```
GET /api/character/job/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (본인 job 만 — 남의 job / 없는 id / 잘못된 id 모두 404) |

**응답 (200):**
```json
{
  "job_id": "665f0c...",
  "mode": "real | cartoon",
  "status": "processing | done | failed",
  "created_at": "2026-07-06T04:00:00.000000",
  "updated_at": "2026-07-06T04:05:12.000000",

  // status=done 일 때 추가 (동기판 응답과 동일 의미):
  "object_name": "characters/temp/{uid}/{hex}.png",
  "original_object_name": "characters/temp/{uid}/original_{hex}.jpg",
  "preview_url": "/api/character/preview/...",
  "image_model": "nb_pro",
  "completed_at": "2026-07-06T04:05:12.000000",
  // cartoon job 이면 추가:
  "art_style": "Korean webtoon style",
  "art_style_key": "webtoon",

  // status=failed 일 때 추가:
  "error": "실패 사유 (200자 이내)"
}
```

**폴링 권장 간격: 5초.** `status` 가 `done` 이면 `object_name`/`preview_url` 을
동기판 응답과 똑같이 사용하면 된다 (이후 `/api/character/save` 로 저장).
`failed` 면 `error` 표시 후 재시도 유도.

서버 재시작 시 30분 이상 `processing` 에 머문 job 은 lifespan 에서
`failed`(error="서버 재시작으로 중단됨") 로 일괄 마킹된다 — 폴링이 영원히
`processing` 에 갇히지 않는다.

---

### 화풍 샘플 목록 / 이미지

```
GET /api/character/style-samples
GET /api/character/style-sample/{key}
```

인증 불필요. `style-samples` 는 3종 프리셋 메타 반환:
```json
{"samples": [
  {"key": "webtoon", "label": "웹툰", "art_style": "Korean webtoon style", "preview_url": "/api/character/style-sample/webtoon"},
  {"key": "anime", "label": "애니", "art_style": "Japanese anime style", "preview_url": "/api/character/style-sample/anime"},
  {"key": "manga90", "label": "90년대 만화", "art_style": "1990s retro manga style", "preview_url": "/api/character/style-sample/manga90"}
]}
```
`style-sample/{key}` 는 번들 PNG(image/png) 반환, 없는 key 는 404.
번들 이미지는 `infra/style_samples/` 의 더미 플레이스홀더 — 저작권 안전 이미지로 교체 가능.

---

### 캐릭터 시트 부분 수정 (refine)

```
POST /api/character/refine
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| sheet_image | File | O | 현재 캐릭터 시트 |
| photo | File | O | 원본 사진 |
| refine_request | str | O | 수정 요청 본문 |
| image_model | str | - | 기본 `nb_pro` |

**응답 (200):** `{"object_name": "...", "preview_url": "...", "image_model": "nb_pro", "message": "..."}`

---

### 캐릭터 저장 (영구화)

```
POST /api/character/save
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "sheet_object_name": "characters/temp/.../{hex}.png (필수)",
  "used_items": [
    {"id": "...", "name": "...", "image_object_name": "...", "product_url": "...", "category": "상의|하의|신발"}
  ],
  "name": "≤50자",
  "age": "≤30자",
  "personality_tags": ["≤20자, 최대 20개"],
  "personality_text": "≤500자",
  "original_photo_object_name": "characters/{uid}/original.jpg",
  "image_model": "nb_pro|gpt_image_2",
  "variant": "real|virtual (기본 real)",
  "art_style": "Korean webtoon style (variant=virtual 일 때만 사용)"
}
```

- `variant="real"` (기본): temp 시트를 `characters/{uid}/sheet.png` 로 복사,
  실사 필드(sheet_object_name/used_items/name/age/personality/image_model) 갱신.
- `variant="virtual"`: temp 시트를 **`characters/{uid}/sheet_virtual.png`** 로 복사,
  `virtual_sheet_object_name` / `virtual_art_style` / `virtual_used_items` 만 갱신.
  **실사 슬롯(sheet_object_name 등)은 절대 건드리지 않음.**

**응답 (200, real):**
```json
{
  "variant": "real",
  "sheet_object_name": "characters/{uid}/sheet.png",
  "name": "...",
  "age": "...",
  "personality_tags": [],
  "personality_text": "...",
  "original_photo_object_name": "...",
  "message": "캐릭터가 저장되었습니다."
}
```

**응답 (200, virtual):**
```json
{
  "variant": "virtual",
  "virtual_sheet_object_name": "characters/{uid}/sheet_virtual.png",
  "virtual_art_style": "Korean webtoon style",
  "sheet_object_name": "characters/{uid}/sheet.png (기존 실사값, 불변)",
  "message": "가상화 캐릭터가 저장되었습니다."
}
```

---

### 내 캐릭터 조회

```
GET /api/character/me
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

저장된 캐릭터가 없으면 `{"character": null}`.

**응답 (200):**
```json
{
  "character": {
    "sheet_object_name": "characters/{uid}/sheet.png",
    "sheet_url": "/api/character/preview/characters/{uid}/sheet.png",
    "used_items": [],
    "name": "",
    "age": "",
    "personality_tags": [],
    "personality_text": "",
    "original_photo_object_name": "",
    "image_model": "nb_pro",
    "virtual_sheet_object_name": "",
    "virtual_sheet_url": null,
    "virtual_art_style": "",
    "virtual_used_items": [],
    "created_at": "...",
    "updated_at": "..."
  }
}
```

> `virtual_*` 필드는 가상화 시트 저장 전이면 빈값/null. 실사 슬롯과 독립.

---

### 내 캐릭터 삭제

```
DELETE /api/character/me
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

MinIO `characters/{uid}/` 하위 객체까지 best-effort 삭제.

---

### 캐릭터 이미지 프록시

```
GET /api/character/preview/{object_name:path}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | PNG 바이트 |

---

### 주인공 장소 등록

```
POST /api/character/locations
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | jpg/jpeg/png/webp, ≤10MB |
| name | str | O | ≤50자 |

**응답 (200):**
```json
{
  "id": "objectid",
  "name": "장소 이름",
  "object_name": "characters/{uid}/locations/{id}.jpg",
  "preview_url": "/api/character/preview/characters/{uid}/locations/{id}.jpg"
}
```

---

### 주인공 장소 목록

```
GET /api/character/locations
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

최신순. **응답 (200):** `{"locations": [...]}`.

---

### 주인공 장소 삭제

```
DELETE /api/character/locations/{location_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

타인 소유 ID 는 404. MinIO 객체도 best-effort 삭제.

---

## 15. 보이스 페르소나 API (`/api/voice-persona`)

Suno Voice Persona 생성/관리.

### Persona 생성 (백그라운드 워크플로우)

```
POST /api/voice-persona/create
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 보이스 샘플 (`.mp3/.wav/.m4a/.ogg/.flac`, ≤50MB) |
| name | str | O | ≤50자 |
| description | str | - | ≤200자 |

Suno API 키 미설정 시 503.

**응답 (200):** `{"id": "objectid", "name": "...", "status": "pending", "message": "..."}`

---

### Persona 목록

```
GET /api/voice-persona/list
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):** `{"personas": [{"id": "...", "name": "...", "status": "...", "progress": 0, "has_vocal": true, "has_cover": true, "vocal_url": "presigned", "cover_url": "presigned", ...}]}`

---

### Persona 단건 조회

```
GET /api/voice-persona/{persona_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

---

### Vocal / Cover 스트림 & 다운로드

```
GET /api/voice-persona/{persona_id}/vocal/stream
GET /api/voice-persona/{persona_id}/vocal/download
GET /api/voice-persona/{persona_id}/cover/stream
GET /api/voice-persona/{persona_id}/cover/download
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | mp3 스트림 (`inline` 또는 `attachment`) |

해당 오디오가 없으면 404.

---

### Persona 삭제

```
DELETE /api/voice-persona/{persona_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

source/vocal/cover 모든 MinIO 객체까지 best-effort 삭제.

---

## 16. 보컬 변환(Voice Convert) API (`/api/voice-convert` / `/api/kits`)

Suno 결과 보컬을 Kits.AI Voice Model 로 변환.

### 변환 시작

```
POST /api/voice-convert/{generation_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "voice_model_id": 12345,
  "conversion_strength": 0.5,
  "model_volume_mix": 0.5,
  "pitch_shift": 0
}
```

generation 상태가 `completed` 가 아니면 400. 이미 변환 중이면 409.

**응답 (200):** `{"message": "...", "generation_id": "...", "voice_model_id": 12345}`

---

### 변환 상태 폴링

```
GET /api/voice-convert/{generation_id}/status
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):**
```json
{
  "generation_id": "...",
  "voice_conversion_status": "pending|converting|merging|uploading|awaiting_merge|completed|failed",
  "voice_conversion_progress": 0,
  "voice_conversion_error": null,
  "voice_converted_url": "...",
  "voice_converted_vocal_url": "...",
  "voice_converted_backing_url": "...",
  "voice_model_id": 12345
}
```

---

### 변환 결과 스트림 / 다운로드

```
GET /api/voice-convert/{generation_id}/stream
GET /api/voice-convert/{generation_id}/download
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | mp3 스트림 |

---

### 변환된 보컬만 스트림

```
GET /api/voice-convert/{generation_id}/converted-vocal/stream
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | wav |

---

### MR(반주) 스트림

```
GET /api/voice-convert/{generation_id}/backing/stream
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | wav |

---

### MR 피치 시프트 미리듣기

```
POST /api/voice-convert/{generation_id}/preview-mr
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |
| 응답 | wav |

**요청 본문:** `{"pitch_shift": 2.0}`

서버 측 `ffmpeg + rubberband` 로 피치 변환. `pitch_shift=0` 이면 원본 그대로.

---

### 보컬 + MR 합치기 (피치/볼륨 조정)

```
POST /api/voice-convert/{generation_id}/merge
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "mr_pitch_shift": 0.0,
  "vocal_volume": 1.0,
  "mr_volume": 1.0
}
```

상태가 `awaiting_merge` 또는 `completed` 가 아니면 400. 백그라운드로 진행.

---

### Kits Voice Model 목록

```
GET /api/kits/voice-models
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

Kits API 키 미설정 시 503.

**응답 (200):** `{"voice_models": [/* Kits 응답 */]}`

---

## 17. 보컬 수리(Vocal Repair) API (`/api/vocal-repair`)

LALAL.AI / Demucs 로 보컬 다듬기.

### 보이스 업로드

```
POST /api/vocal-repair/upload
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:** `file` (`.mp3/.wav/.m4a/.ogg/.flac/.webm`, ≤50MB)

**응답 (200):** `{"id": "uuid", "message": "업로드 완료", "status": "uploaded"}`

---

### 다듬기 시작

```
POST /api/vocal-repair/{repair_id}/enhance
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | application/json |

**요청 본문:** `{"method": "lalal|demucs|both"}` (기본 `both`)

이미 `enhancing` 이면 409. LALAL 사용 시 LALAL API 키 필요(미설정 503).

---

### 상태 조회

```
GET /api/vocal-repair/{repair_id}/status
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):**
```json
{
  "id": "uuid",
  "status": "uploaded|enhancing|completed|failed",
  "progress": 100,
  "status_detail": "완료",
  "lalal_status": "completed|processing|failed|null",
  "demucs_status": "completed|processing|failed|null",
  "lalal_error": null,
  "demucs_error": null,
  "error_message": null
}
```

---

### 원본 / 다듬은 결과 스트림 & 다운로드

```
GET /api/vocal-repair/{repair_id}/original/stream
GET /api/vocal-repair/{repair_id}/original/download
GET /api/vocal-repair/{repair_id}/enhanced/stream?method=lalal|demucs
GET /api/vocal-repair/{repair_id}/enhanced/download?method=lalal|demucs
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| 응답 | audio/wav 또는 원본 mime |

`method` 기본 `demucs`.

---

### 내 보컬 수리 목록

```
GET /api/vocal-repair/list
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

최근 20개.

---

## 18. Wondera API (`/api/wondera`)

외부 Wondera 음악 생성 API 프록시. Wondera API 키 미설정 시 모두 503.

### 보컬 파일 업로드

```
POST /api/wondera/upload-vocal
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:** `file` (audio/mpeg)

응답은 Wondera 응답 원본을 그대로 반환.

---

### 범용 파일 업로드 (purpose 지정)

```
POST /api/wondera/upload-file
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:** `file`, `purpose` (`reference` / `vocal` / `melody`)

---

### 곡 생성 요청

```
POST /api/wondera/generate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "lyrics": "필수",
  "model": "auto|wondera-2.1|wondera-2.2|wondera-o1|wondera-o2",
  "number": 2,
  "prompt": "≤1024자",
  "reference_id": "...",
  "vocal_id": "...",
  "melody_id": "...",
  "enable_stream": false
}
```

`prompt`/`reference_id`/`melody_id`/`vocal_id` 충돌 조합은 400 (코드 참고).

---

### 생성 상태 조회

```
GET /api/wondera/query/{task_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

Wondera 응답 그대로 반환.

---

## 19. 관리자 API (`/api/admin`)

모두 `role=admin` 필수. 모든 변경 액션은 PG `admin_logs` 에 기록됩니다.

### 대시보드

```
GET /api/admin/dashboard
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

**응답 (200):**
```json
{
  "total_users": 0,
  "total_tracks": 0,
  "total_plays": 0,
  "today_signups": 0,
  "recent_tracks": [],
  "recent_users": []
}
```

---

### 사용자 목록

```
GET /api/admin/users?page=1&limit=20&search=&role=user&banned=false
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

`search` 는 email/nickname ILIKE. `role`/`banned` 선택.

---

### 사용자 상세

```
GET /api/admin/users/{user_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

---

### 사용자 역할 변경

```
PUT /api/admin/users/{user_id}/role
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |
| Content-Type | application/json |

**요청 본문:** `{"role": "user|customer|admin"}` (자기 자신 변경 400).

---

### 사용자 정지 / 해제

```
PUT /api/admin/users/{user_id}/ban
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |
| Content-Type | application/json |

**요청 본문:** `{"is_banned": true, "reason": "사유 (선택)"}`

정지 시 Redis 세션 즉시 삭제. 자기 자신 400.

---

### 관리자용 트랙 목록

```
GET /api/admin/tracks?page=1&limit=20&search=&is_public=true
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

---

### 트랙 강제 삭제

```
DELETE /api/admin/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

MinIO 오디오 + Mongo 문서 + Redis 캐시까지 삭제.

---

### 트랙 공개/비공개 토글

```
PUT /api/admin/tracks/{track_id}/visibility
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |
| Content-Type | application/json |

**요청 본문:** `{"is_public": true}`

---

### 관리자 로그

```
GET /api/admin/logs?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 관리자 |

`admin_logs` 의 결과를 닉네임과 함께 반환.

---

## 20. 고객사(Business) / 광고 API (`/api/business`)

`role=customer` 또는 `role=admin` 필수 (`/ads/active` 만 공개, impression/click 은 일반 사용자).

### 고객사 프로필 조회

```
GET /api/business/profile
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 |

문서가 없으면 빈 값으로 자동 생성 후 반환.

---

### 고객사 프로필 수정

```
PUT /api/business/profile
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 |
| Content-Type | application/json |

**요청 본문 (모두 선택):**
```json
{
  "company_name": "...",
  "industry": "...",
  "contact_name": "...",
  "contact_phone": "..."
}
```

---

### 광고 아이템 생성

```
POST /api/business/ads
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 |
| Content-Type | multipart/form-data |

**폼:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| image | File | O | jpg/png/gif/webp, ≤10MB |
| name | str | O | |
| product_url | str | O | |
| category | str | O | `상의 / 하의 / 신발 / 장소` |
| gender | str | O | `남성용 / 여성용 / 공용` |

**응답 (201):** ad_item 객체 (`is_active: true` 기본).

---

### 내 광고 목록

```
GET /api/business/ads?category=상의
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 |

`category` 잘못된 값은 400.

---

### 광고 수정

```
PUT /api/business/ads/{item_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 (소유자만) |
| Content-Type | multipart/form-data |

**폼 (모두 선택):** `name`, `product_url`, `category`, `gender`, `image`.

`image` 가 있으면 새 객체로 교체(기존은 best-effort 삭제).

---

### 광고 삭제

```
DELETE /api/business/ads/{item_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 (소유자만) |

---

### 활성/비활성 토글

```
PATCH /api/business/ads/{item_id}/toggle
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 (소유자만) |

**응답 (200):** `{"message": "...", "item_id": "...", "is_active": false}`

---

### 광고 이미지 프록시

```
GET /api/business/items/image/{object_name:path}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | 이미지 바이트 |

---

### 활성 광고 추첨 (앱 진열용)

```
GET /api/business/ads/active?category=상의
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

`is_active=true` 인 아이템에서 최대 100개를 `$sample` 로 무작위 추출. 광고주 닉네임이 포함됩니다.

**응답 (200):** `{"items": [{..., "advertiser_nickname": "..."}]}`

---

### 노출 기록

```
POST /api/business/ads/{item_id}/impression
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

같은 사용자의 6시간 내 중복 노출은 `{"status": "duplicate", "message": "6시간 내 중복"}`.

---

### 클릭 기록

```
POST /api/business/ads/{item_id}/click
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

위와 동일한 6시간 중복 정책.

---

### 광고 대시보드

```
GET /api/business/dashboard?period=daily&category=상의
```

| 항목 | 값 |
|------|---|
| 인증 | 고객사 |

`period` ∈ `daily / weekly / monthly`.

**응답 (200):**
```json
{
  "category": "상의|null",
  "total_impressions": 0,
  "total_clicks": 0,
  "ctr": 0.0,
  "items": [{"item_id": "...", "name": "...", "impressions": 0, "clicks": 0, "ctr": 0.0, "image_object_name": "...", "product_url": "..."}],
  "total_users": 0,
  "chart_data": [
    {"label": "05-19", "impressions": 0, "clicks": 0, "ctr": 0.0, "users": 0}
  ]
}
```

`chart_data` 의 시간 범위:
- daily: 최근 7일 (날짜별)
- weekly: 최근 4주 (주차별)
- monthly: 최근 6개월 (월별)

---

## 21. 보상(Rewards) API (`/api/rewards`)

Google AdMob 보상형 광고 SSV(서버 사이드 검증) + 사용자 잔여량.

### AdMob SSV 콜백

```
GET /api/rewards/admob-callback
```

| 항목 | 값 |
|------|---|
| 인증 | Google ECDSA 서명 |

Google AdMob 가 `signature / key_id / custom_data / reward_amount / reward_item / transaction_id / ad_unit` 등의 쿼리 파라미터로 GET 요청. ECDSA-SHA256 검증 후 `reward_transactions` 에 dedupe insert, `reward_balances.skip_wait_count` 증가.

응답 예:
- 정상: `{"status": "ok"}`
- 이미 처리됨: `{"status": "already_processed"}`
- 서명 실패: 403 `{"error": "Invalid signature"}`
- 누락/형식: 400

`custom_data` 에는 사용자 UUID 를 그대로 넣어야 합니다.

---

### 보상 내역

```
GET /api/rewards/history
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

최근 50건.

**응답 (200):**
```json
{
  "transactions": [
    {"transaction_id": "...", "user_id": "uuid", "ad_unit": "...", "reward_amount": 1,
     "reward_item": "skip_wait", "created_at": "2026-05-25T12:00:00", "verified": true}
  ]
}
```

---

### 보상 잔여량

```
GET /api/rewards/balance
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):** `{"user_id": "uuid", "skip_wait_count": 5, "last_updated": "..."}`

---

## 22. 로그 조회 / 프론트엔드 로그 수집 API (`/api/_logs`)

서버 로그(`backend_9004/logs/server.log`) 조회와 브라우저 콘솔 로그(`frontend.log`) 수집용. GET 3종은 운영용 토큰 보호.

### 서버 로그 tail

```
GET /api/_logs/tail?lines=200
```

| 항목 | 값 |
|------|---|
| 인증 | 로그 토큰 (`X-Log-Token` 헤더 또는 `token` 쿼리) |
| 응답 | `text/plain` (마지막 N줄) |

`lines` 1~5000 (기본 200). 토큰 미설정 시 503, 미일치 시 401.

---

### 서버 로그 다운로드

```
GET /api/_logs/download
```

| 항목 | 값 |
|------|---|
| 인증 | 로그 토큰 |
| 응답 | `text/plain` (`Content-Disposition: attachment; filename="server_9004.log"`) |

---

### 로그 파일 메타정보

```
GET /api/_logs/info
```

| 항목 | 값 |
|------|---|
| 인증 | 로그 토큰 |

**응답 (200):**
```json
{
  "exists": true,
  "size_bytes": 123456,
  "modified_at": "...",
  "line_count_estimate": 0
}
```

---

### 프론트엔드 콘솔 로그 수집

```
POST /api/_logs/frontend
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (axios 인터셉터 또는 `?token={jwt}`) |
| Content-Type | application/json |

브라우저에서 발생한 `console.error / window.onerror / unhandledrejection` 등을 배치로 받아 `backend_9004/logs/frontend.log` 에 1 이벤트 1 라인으로 기록.

**요청 본문:**
```json
{
  "events": [
    {
      "level": "info|warn|warning|error|debug (기본 info)",
      "message": "string ≤8KB",
      "context": {"key": "value"},
      "ts": "ISO timestamp",
      "url": "현재 페이지 URL",
      "user_agent": "string",
      "stack": "string ≤16KB"
    }
  ]
}
```

제약: 본문 ≤256KB, `events` 1~50개. 위반 시 422.

**응답 (200):** `{"received": 5}` — 기록된 이벤트 수.

---

## 23. 헬스체크 (`/api/health`)

```
GET /api/health
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):** `{"status": "ok", "timestamp": "2026-05-25T..."}`

---

## 24. 부록: ID/상태값/공통 객체

### ID 타입

| 종류 | 형식 | 예시 |
|------|------|------|
| 사용자 ID | UUID | `18bd8131-2097-47c8-b055-1680b2eb51c3` |
| 트랙 ID / 생성 ID / MV job ID / 앨범 ID / 광고 ID / 페르소나 ID / 캐릭터 장소 ID / cover_session_id | MongoDB ObjectId | `69ce4c72b3d9beab06ce01f9` |
| 플레이리스트 ID | UUID (PG) | |
| Vocal Repair ID | UUID v4 | |

### 상태값

| 대상 | 상태값 |
|------|--------|
| 음악 생성 (generations.status) | pending → processing → completed / failed |
| MV 작업 (mv_jobs.status) | draft / splitting / generating_images / generating_videos / concatenating / merging_audio / completed / paused / failed / cancelled |
| MV 씬 (scene.video_status) | pending / generating / completed / failed |
| MV cascade (scene.cascade_status, scenario cascade_phase) | idle / running / completed / cancelled / failed |
| 보컬 변환 (generations.voice_conversion_status) | pending / converting / merging / uploading / awaiting_merge / completed / failed |
| 보컬 수리 (vocal_repairs.status) | uploaded → enhancing → completed / failed (`lalal_status`, `demucs_status` 는 개별) |
| 비트 추출 (beats_status) | pending / running / completed / failed |
| 보이스 페르소나 (voice_personas.status) | pending → 진행 → completed / failed |

### Presigned URL 유효기간

- 트랙/이미지 일반 조회: 24시간
- 트랙 스트림 / 다운로드: 1시간
- 광고/생성 결과/MV 자산 등: 24시간

### Bucket 구조 요약

| 용도 | 경로 패턴 |
|------|----------|
| 트랙 오디오 | `tracks/{uploader_id}/{track_id}.{ext}` |
| 참고 오디오 | `reference/{user_id}/{hex}.{ext}` |
| 보컬 수리 | `vocal-repair/{user_id}/{doc_id}/...` |
| 보이스 페르소나 | `voice-personas/{user_id}/{hex}.{ext}` |
| 트랙/프로필 이미지 | `covers/{user_id}/{track_id}.{ext}`, `profiles/{user_id}.{ext}` |
| AI 생성 커버 | `covers/generated/{user_id}/{hex}.png` |
| 커버 추가 수정 | `covers/refined/{user_id}/{session_id}/v{N}.png` |
| 앨범 커버 (업로드) | `covers/{user_id}/album_{album_id}.{ext}` |
| 앨범 커버 (AI) | `covers/generated/{user_id}/album_{hex}.png` |
| 광고 이미지 | `ads/{user_id}/{hex}.{ext}` |
| 캐릭터 시트 | `characters/{user_id}/sheet.png`, 원본 `characters/{user_id}/original.{ext}` |
| 캐릭터 장소 | `characters/{user_id}/locations/{location_id}.{ext}` |
| MV 자산/씬 | `mv/{job_id}/scenes/{NNN}.png`, `mv/{job_id}/scenes/{NNN}_video.mp4`, `mv/{job_id}/scenes/{NNN}_video_audio.mp4` 등 |

---

## 25. 변경 이력

### 9004 기준 본 갱신 (2026-05-25)

#### 추가된 섹션 / 엔드포인트

- **앨범 API (`/api/albums`) 전면 정식 라우터로 승격** (12개 엔드포인트). 기존 문서의 "레거시" 표기 삭제.
  - `GET /` / `GET /latest` / `GET /my` / `POST /` / `PATCH /{id}` / `DELETE /{id}` / `POST /{id}/tracks` / `DELETE /{id}/tracks/{tid}` / `PUT /{id}/tracks/order` / `PATCH /{id}/cover` / `POST /cover/generate` / `GET /{id}`.
- **고객사(Business) / 광고 API (`/api/business`)** 신규 섹션. 프로필 / 광고 CRUD / 노출·클릭 / 대시보드 / 활성 광고 추첨까지 12개 엔드포인트.
- **로그 조회 / 프론트엔드 로그 수집 (`/api/_logs`)** 신규 섹션. `tail`, `download`, `info` 는 로그 토큰 보호, `POST /frontend` 는 일반 사용자 JWT 보호.
- **트랙 API** 에 다음 누락 엔드포인트 추가
  - `GET /api/tracks/my`
  - `PUT /api/tracks/{track_id}` (메타데이터 수정)
  - `POST /api/tracks/upload-from-generation`
  - `GET /api/tracks/{track_id}/music-video`
  - `GET /api/tracks/{track_id}/beats`, `POST /api/tracks/{track_id}/beats/retry`
  - `GET /api/tracks/stream-proxy/{track_id}` (모바일 직접 프록시)
- **업로드 API** 에 v58 커버 refine/revert/history 흐름 추가: `POST /refine-cover`, `POST /revert-cover`, `GET /cover-history/{session_id}`.
- **AI 음악 생성** 에 `POST /api/generate/upload-reference/`, `POST /api/generate/translate-tags`, `POST /api/generate/{id}/start/`, beats 조회/재시도, 스트림 추가.
- **MV API** 거의 전부 신규 반영. 대표 추가:
  - 시나리오 선택/프롬프트 선택: `POST /jobs/{id}/select-scenario`, `POST /jobs/{id}/select-prompts`.
  - 씬 cascade 워크플로우(`PATCH /scenes/{n}`, `POST /scenes/{n}/cascade-regenerate`, `POST /scenes/{n}/cancel-cascade`).
  - 사건/시나리오 cascade(`PATCH /scenario/events/{order}`, `POST /scenario/events/{order}/cascade-regenerate`, `POST /scenario/events/{order}/cancel-cascade`, `PATCH /scenario`, `PATCH /scenario/events`, `POST /scenario/cascade-regenerate`, `POST /scenario/cancel-cascade`).
  - user_edited_fields 통합 관리(`POST /user-edited/reset`, `GET /user-edited/summary`).
  - 씬 단위 영상 생성/Sync Labs 재시도/보컬 분리: `POST /scenes/{n}/generate-video`, `POST /scenes/{n}/retry-sync`, `POST /scenes/{n}/separate-vocal`.
  - 영상 합치기/음악 합치기/임시저장/취소/삭제/모델 목록: `POST /jobs/{id}/concatenate`, `/merge-audio`, `/save-draft`, `/cancel`, `DELETE /jobs/{id}`, `GET /models`.
- **캐릭터 API**: `POST /upload-original-photo`, `POST /refine`, `POST /save`, `GET /me`, `DELETE /me`, `GET /preview/{path}`, 그리고 v42 사용자 장소 라이브러리(`POST /locations`, `GET /locations`, `DELETE /locations/{id}`) 신규 반영.
- **보이스 페르소나** (`/api/voice-persona`) 신규 섹션.
- **보컬 변환** (`/api/voice-convert` + `/api/kits`) 신규 섹션. preview-mr / merge / converted-vocal / backing 스트림 포함.
- **보컬 수리** (`/api/vocal-repair`) 신규 섹션.

#### 제거된 섹션

- **Songs API (`/api/songs`)** — 9004 `main.py` 에서 `include_router` 되지 않는 dead code. 본 문서에서 완전 제거. 신규 연동에는 `/api/tracks` 사용.
- **앨범 "레거시" 표기** 삭제. 정식 라우터로 갱신.

#### 갱신된 항목

- 서버 URL `http://localhost:9000` → `http://localhost:9004`.
- 작성일 / 버전 표기를 2026-05-25, "9004 백엔드 기준" 으로 갱신.
- 인증 API 의 `register`/`login` 응답에 `company_name`, `display_title` 필드 포함. `PATCH /api/auth/me/profile` 도 신규.
- 차트 API 의 점수 계산식 명확화 (KST 시간대, 다운로드 0.6 / 스트림 0.4, 30일 컷 등).
- 아티스트 API 응답 별칭(`artist_id`, `artist_name`, `cover_image`) 명시.
- 보상 잔여량 필드명 정정 (`skip_wait_count`).
- 트랙 응답에 `cover_character`, `has_music_video`, `music_video_url`, `beats_*` 필드 추가 반영.
- 모든 새 엔드포인트의 인증 수준, multipart 여부, presigned 여부, 백그라운드 task 여부, 폴링 패턴 등을 표기.

---

## 26. 앱팀 통합 가이드 (Day-1 빠른 참조)

본문 외에 앱팀이 가장 자주 묻게 되는 통합 항목을 한 곳에 정리.

### 26.1 baseURL / 환경

| 환경 | URL | 비고 |
|------|-----|------|
| 로컬 (백엔드 동일 머신) | `http://localhost:9004` | WSL/Mac/Linux 직접 |
| **사내 (Tailscale)** | **`http://100.127.225.55:9004`** | 앱팀이 tailnet 가입돼 있으면 이걸로 호출. 현재 운영 중인 dev 서버 |
| Staging | _미구성_ | 추후 별도 공지 |
| Production | _미구성_ | 추후 별도 공지 |

- 앱 빌드 시 환경변수 (`API_BASE_URL` 같은 컨벤션) 로 분리 권장. 코드에 하드코딩 금지.
- 모든 라우트는 `<baseURL>/api/...` 형태. (`/api/health`, `/api/auth/login`, …)

### 26.2 CORS 정책

- 현재 `Access-Control-Allow-Origin: *` (와이드 오픈, `main.py` 의 `CORSMiddleware`).
- 도메인 화이트리스트 없음 → 모바일 네이티브 / 웹 / Postman 어디서든 호출 가능.
- 운영 단계로 가면 도메인 제한할 수 있으므로, 모바일 앱은 origin 헤더에 의존하는 로직을 만들지 말 것.

### 26.3 인증 플로우 한눈에

```
1. POST /api/auth/register   →  user 생성
2. POST /api/auth/login      →  { access_token, token_type: "bearer", user: {...} }
3. 이후 모든 보호된 호출:
     Header:  Authorization: Bearer <access_token>
4. 토큰 만료 (기본 7일 = JWT_ACCESS_TOKEN_EXPIRE_MINUTES=10080)
     → 401 응답
     → 앱이 로그인 화면으로 라우팅 + 재로그인 요구
5. 로그아웃: 클라이언트 측에서 토큰 폐기만 (서버 invalidate 없음)
```

**⚠️ Refresh token 미구현**: `.env` 에 `JWT_REFRESH_TOKEN_EXPIRE_DAYS` 변수는 있으나, 실제 refresh 엔드포인트는 **현재 백엔드에 없음**. 만료 = 재로그인이 유일 동작. 앱팀이 refresh 흐름을 가정하고 짜지 말 것. (필요해지면 백엔드에서 별도 공지)

**토큰 저장 권장**:
- iOS: Keychain
- Android: EncryptedSharedPreferences 또는 Keystore
- 일반 SharedPreferences / NSUserDefaults 평문 저장 금지

### 26.4 에러 응답 포맷 (두 형태 공존, 둘 다 처리 필요)

**A. 비즈니스/일반 에러 — 우리 코드가 직접 발생시키는 4xx/5xx**

```json
{ "error": "비밀번호가 일치하지 않습니다." }
```
- status: 400, 401, 403, 404, 409, 500 등
- 메시지는 한국어 사용자 표시 가능 텍스트인 경우가 많음 (`detail` 필드 아님)

**B. Pydantic 검증 에러 — FastAPI 기본 422**

```json
{
  "detail": [
    {
      "loc": ["body", "email"],
      "msg": "value is not a valid email address",
      "type": "value_error.email"
    }
  ]
}
```
- status: 422 고정
- 요청 바디 / 쿼리 파라미터 검증 실패 시
- `detail` 은 **객체 배열** (A의 `error` 와 다름)

**앱팀 에러 핸들러 예시 (의사 코드)**

```javascript
function parseError(res) {
  if (res.status === 422 && Array.isArray(res.body.detail)) {
    return res.body.detail.map(d => `${d.loc.join('.')}: ${d.msg}`).join('\n');
  }
  if (res.body && typeof res.body.error === 'string') {
    return res.body.error;
  }
  return `요청 실패 (HTTP ${res.status})`;
}
```

### 26.5 알아둘 운영 특성

- **실시간 채널 없음**: WebSocket / SSE 미제공. MV 생성·음악 생성·보컬 변환 등 장시간 작업은 **모두 폴링** (status 필드 — 22.5장 상태값 표 참고). 권장 폴링 간격 2~5초.
- **presigned URL 만료** (부록 23 참고): 24h / 1h. 만료되면 해당 리소스의 GET 엔드포인트 재호출로 새 URL 발급.
- **Rate limit / 동시성 제한 없음**: 현재 별도 limiter 미구성. 그러나 외부 API (Suno/Seedance/Sync Labs 등) 호출 단계는 사용자/잡 단위로 1회 보장됨 (`status` 필드로 중복 방지). idempotent 처리에는 본문 각 엔드포인트의 `already_processed` / `status` 응답을 신뢰.
- **JWT_SECRET**: 운영 .env 에 30자 커스텀 값 설정됨 (디폴트 `change-me-in-production` 아님).

---

## 27. 보이스 클로닝 API (`/api/voice-clone`) — v76 (Suno V5_5)

사용자가 본인 음성을 업로드 → Suno V5_5 의 **voice persona** 로 학습 → 음악 생성 시 "내 목소리"로 노래 부르게 한다.

기존 `15. 보이스 페르소나 API` (구버전 워크플로) 와는 **별개** 라우트 / 컬렉션. 둘 다 살아있음.

### 27.0 4단계 워크플로 한눈에

```
1. POST /create                 — source 음성 업로드 → Suno voice/validate POST
2. (백엔드 폴링) validate-info  → status=awaiting_verify + validate_info(검증 문구) 도착
3. POST /{id}/verify            — 사용자가 위 문구 따라 부른 verify 음성 업로드 → Suno voice/generate POST
4. (백엔드 폴링) record-info    → status=ready + voice_id 도착 → 음악 생성에 사용 가능
```

- 음원은 자동으로 ffmpeg 정규화 (stereo/44.1kHz/192kbps mp3) → mono/저비트레이트/webm/ogg 어떤 입력이든 OK.
- 콜백 노출 안 된 환경에서도 `GET /{id}` 호출이 자동으로 Suno 측 폴링 동시 수행 → frontend 는 doc 만 보면 됨.
- 상태 진행: `validating → awaiting_verify → generating → ready` (또는 중간에 `failed`).

---

### Voice clone 생성 (source 음성 업로드)

```
POST /api/voice-clone/create
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| source_file | File | O | 음원 (`.mp3/.wav/.m4a/.webm/.ogg`, ≤50MB). 자동 정규화 |
| voice_name | str | O | 비공백, ≤40자 권장 (사용자가 카드에서 보는 이름) |
| description | str | - | 메모 |
| vocal_start_s | int | O | 사용할 구간 시작 초 (정규화 후 duration 초과 시 0 으로 자동 클립) |
| vocal_end_s | int | O | 사용할 구간 끝 초 (정규화 후 duration 초과 시 자동 클립) |
| language | str | - | `ko` (기본) 또는 `en/zh/es/fr/pt/de/ja/hi/ru` |
| style_mode | str | O | `sing` / `speak` / `rap` |

정규화 후 duration < 5초이면 422 ("오디오가 너무 짧거나..."). voice_name 빈값/공백은 422 (Pydantic).

**응답 (200):** `{"clone_id": "...", "validate_task_id": "...", "status": "validating"}`

---

### Voice clone 단건 조회 (자동 폴링 포함)

```
GET /api/voice-clone/{clone_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**동작:** doc.status 가 `validating` (그리고 validate_info 비어있음) 이면 자동으로 `/voice/validate-info` 1회 폴링. `generating` (voice_id 없음) 이면 `/voice/record-info` 1회 폴링. 결과를 doc 에 반영해 반환.

**응답 (200):** 다음 필드 포함.

| 필드 | 타입 | 설명 |
|------|------|------|
| clone_id | str | objectid |
| user_id | str | uuid |
| voice_name | str | |
| description | str | |
| source_object_name | str | MinIO key |
| verify_object_name | str / null | verify 후 채워짐 |
| vocal_start_s / vocal_end_s | float | |
| language | str | |
| style_mode | str | |
| singer_skill_level | str / null | `beginner/intermediate/advanced/professional` |
| status | str | `validating/awaiting_verify/generating/ready/failed` |
| validate_task_id | str / null | Suno 측 |
| generate_task_id | str / null | Suno 측 |
| validate_info | str / null | 검증 문구 (status=awaiting_verify 일 때 채워짐) |
| voice_id | str / null | Suno persona id — 음악 생성 시 `persona_id` 로 사용 |
| validate_retry_count | int | 자동 재시도 횟수 |
| error_message | str / null | |
| created_at / updated_at | ISO8601 str | |

---

### Voice clone 목록

```
GET /api/voice-clone/list
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**응답 (200):** `{"clones": [ {위 단건 조회와 동일 스키마} ]}` (created_at desc).

---

### Voice clone 삭제

```
DELETE /api/voice-clone/{clone_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

MongoDB doc 삭제 + MinIO source/verify 객체 자동 정리.

**응답 (200):** `{"deleted": true}` (없으면 404)

---

### 검증 녹음 업로드 (verify)

```
POST /api/voice-clone/{clone_id}/verify
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |
| Content-Type | multipart/form-data |

**폼:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| verify_file | File | O | 사용자가 `validate_info` 문구 따라 부른 음원 (`.mp3/.wav/.m4a/.webm/.ogg`, ≤50MB). 자동 정규화 |
| singer_skill_level | str | O | `beginner/intermediate/advanced/professional` (string enum, 대소문자 무관) |

doc.status 가 `awaiting_verify` 가 아니면 그래도 진행하되 Suno 측에서 거부 가능.

**응답 (200):** `{"clone_id": "...", "generate_task_id": "...", "status": "generating"}`. 422 면 schema (필드 누락 등), 400 이면 skill enum 또는 음원 형식.

---

### 검증 문구 재생성 (다른 문구)

```
POST /api/voice-clone/{clone_id}/regenerate-phrase
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (소유자만) |

**동작:** Suno `/voice/regenerate` 호출. 이미 `wait_validating` 상태(phrase 발급 성공) 이라 Suno 가 거부하면 **백엔드가 자동 폴백** 으로 `/voice/validate` 새 호출 → 새 task 발급. 결과만 다른 문구가 나오면 됨.

**응답 (200):** `{"validate_task_id": "<new>"}`. doc.status 는 `validating` 으로 되돌리고, validate_info / error_message 클리어.

---

### 만료 클론 정리 (v79)

```
POST /api/voice-clone/cleanup-expired
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Body | 없음 |

**동작:** 내 클론 중 `status='expired'` 인 항목만 일괄 영구삭제. ready/진행중 클론은 절대 건드리지 않음.

**응답 (200):** `{"deleted": <int>, "deleted_ids": ["<clone_id>"...], "deleted_names": ["<voice_name>"...]}`.

---

### 보이스 사용 가능 여부 일괄 확인 (v113 문서화 — 기존 엔드포인트)

```
POST /api/voice-clone/check-availability
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Body | 없음 |

**동작:** 내 `ready` 보이스 전체의 Suno 실사용 가능 여부를 확인하고, **만료로 확인된 보이스는 자동 삭제**. 일시 오류(네트워크/API)는 `errors` 카운트로만 집계하고 삭제하지 않음(오탐 방지).

**응답 (200):** `{"checked": <int>, "available": ["<clone_id>"...], "expired": [{"clone_id", "voice_name"}...], "errors": <int>}`.

> 참고: 부록의 "expired 상태" 설명과 함께 사용 — 이 엔드포인트는 음악 생성 전에 능동적으로 만료를 감지·정리하는 용도.

---

### Suno → 우리 콜백 (외부 노출 시 활성)

```
POST /api/voice-clone/callback/validate?clone_id={id}
POST /api/voice-clone/callback/generate?clone_id={id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 (body 검증으로만 처리) |
| Content-Type | application/json |

Suno 가 외부에서 우리 9005/9004 에 접근 가능한 환경에서만 동작. 개발환경(외부 노출 X)에서는 위 폴링 폴백으로 동일 결과 도달.

**응답 (200):** `{"ok": true}` (예외 시에도 200 — Suno 재시도 회피).

---

### 27.1 음악 생성과 연동 — `/api/generate/` 관련 필드 (suno_model 신규 + persona 2종)

v76.10 부터 `POST /api/generate/` body 에 다음 두 필드 추가됨.

| 필드 | 타입 | 설명 |
|------|------|------|
| **suno_model** | str / null | `'V5'` 또는 `'V5_5'`. **voice clone 사용 시 반드시 `'V5_5'`**. 미지정 시 백엔드가 자동 결정 (upload-cover면 V5_5, 아니면 V5) |
| persona_id | str / null | 위 voice clone 의 `voice_id` (status=ready 도달한 항목) |
| persona_model | str / null | voice clone 사용 시 **`'voice_persona'`** (구버전 voice_persona 와 동일 키 — 구분은 voice_id 출처로) |

기존 `model` 필드는 **provider 식별자** (`'suno'` 등) 로 그대로 유지. `'V5_5'` 같은 값을 `model` 에 박으면 400 거부 (provider 미지원).

**호출 예시 (voice clone 보컬로 생성)**:
```json
{
  "prompt": "happy upbeat song",
  "title": "내 목소리 노래",
  "lyrics": "[Verse]\nHello world\n[Chorus]\nLa la la",
  "genre": "pop",
  "mood": "happy",
  "style": "uplifting",
  "duration": 30,
  "start_music_gen": true,
  "model": "suno",
  "suno_model": "V5_5",
  "persona_id": "<voice_clone.voice_id>",
  "persona_model": "voice_persona"
}
```

**Polling timeout (v76.11)**: `persona_model=voice_persona` 일 때 Suno 폴링 한도 = 20분 (240회×5초). 일반 = 5분. timeout 시 `doc.status = "failed"` 마킹 + `error_message` 에 마지막 본 status 와 폴 횟수 기록.

---

### 27.2 상태값 정리

| status | 의미 |
|---|---|
| validating | Suno 가 voice/validate task 처리 중. validate_info(문구) 도착 대기 |
| awaiting_verify | validate_info 도착. 사용자가 verify 녹음 올려야 함 |
| generating | verify 업로드 완료. Suno 가 voice/generate 진행 중 |
| ready | voice_id 도착. 음악 생성에 사용 가능 |
| failed | 외부 측 fail 또는 timeout. `error_message` 확인 |
| expired | 만료됨. 음악 생성 시 Suno 가 "voice has expired" 로 실패하면 해당 클론이 자동으로 이 상태로 플래그됨 (작곡 선택목록에서 자동 제외). `POST /cleanup-expired` 로 일괄 삭제 가능. **check-voice/record-info 로는 만료 감지 불가** — 오직 음악 생성 시점에만 감지됨 |

### 27.3 운영 특이사항 (앱팀 참고)

- 음원은 백엔드가 ffmpeg 으로 stereo/44.1kHz/192kbps mp3 정규화. 클라가 형식 변환 X 해도 됨.
- 마이크 녹음은 webm/opus 가 일반적 — backend 가 받아서 mp3 로 변환.
- voice clone 학습은 일반 음악 생성보다 오래 걸림 (보통 1~3분, 부하 시 5~10분). 클라이언트는 `GET /{id}` 폴링을 5~10초 간격으로 권장.
- voice_id 가 채워진 voice clone 은 영구. 사용자 삭제(DELETE) 전까지 계속 음악 생성에 사용 가능.

---

## 28. 포인트 API (`/api/points`) — v81 (적립 확대 + 차감 도입: 2026-07)

사용자 활동 포인트. 기존 rewards(AdMob) 시스템과는 **완전히 별개**.

### 28.1 엔드포인트

| Method | Path | 인증 | 응답 |
|---|---|---|---|
| GET | `/api/points/balance` | 필요 | `{ "balance": int }` — 계정 생성 시 0 |
| GET | `/api/points/history?limit=50` | 필요 | `{ "history": [ { "action", "track_id", "day", "amount", "created_at" } ] } ` |

- `GET /balance` : 로그인 사용자의 현재 누적 포인트. 적립 이력이 없으면 `0`.
- `GET /history` : 최근 포인트 이벤트(최신순). `limit` 기본 50, 최대 200 (초과 시 거부). 각 항목은 `action`, `track_id`(적립은 곡/생성 ID, 차감·환불은 시도별 유니크 ref), `day`(KST `YYYYMMDD`), `amount`(+1 / −2 / +2), `created_at`(ISO8601 UTC).

### 28.2 포인트 규칙

**적립 (+1, 하루 1회 / 대상당 / 행위별 — KST 자정 기준):**

| action | 시점 | ref (track_id 필드) |
|---|---|---|
| `play` | 로그인 재생 듣기 | track_id |
| `generate` | 곡 생성 completed 마킹 시 (생성 요청자) | generation_id |
| `upload` | 곡 발행 시 (`POST /api/tracks/upload`, `/upload-from-generation`) | track_id |

> **v111 (2026-07-08)**: `like` / `playlist_add` / `download` 적립 **제거** — 좋아요·플레이리스트 추가·다운로드는 더 이상 포인트가 쌓이지 않음. 기존에 적립된 이벤트/잔액은 소급 변경 없음. history 에 과거 like/playlist_add/download 이벤트는 그대로 보일 수 있음.

- **비로그인은 적립 없음.** 적립 대상은 **행위자**.
- **멱등**: 같은 (사용자·행위·대상·날짜) 중복은 무시 (point_events 유니크 인덱스).
- 적립은 best-effort 훅 — 실패/중복이 본 기능 응답에 절대 영향 없음.

**차감 (−2, 요청 시 즉시 차감 · 실패 시 자동 환불):**

| action | 대상 엔드포인트 |
|---|---|
| `spend:character` | `POST /api/character/generate-sheet`, `/generate-sheet-cartoon`, `/generate-sheet-async`, `/generate-sheet-cartoon-async` |
| `spend:cover` | `POST /api/upload/generate-cover` |

- **잔액 부족 시 402** `{ "error": "포인트가 부족합니다 (필요: 2)" }` — 생성/작업 미시작 (async 는 job 미생성).
- 차감은 원자적 조건부 갱신(`balance >= 2` 일 때만 `-2`) — 음수 잔액 불가.
- **실패 시 자동 환불** (`refund:character` / `refund:cover`, +2): 동기 생성 예외, async job 실패, 서버 재시작 stale job 복구(30분↑ processing → failed) 모두 환불. job 의 `refunded` 플래그로 **이중 환불 방지**.
- history 의 차감/환불 `track_id` 는 시도별 유니크 ref (uuid) — 곡 ID 아님.

