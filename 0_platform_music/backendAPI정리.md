# AIMU 백엔드 API 문서

> 백엔드 서버: `http://localhost:9000`
> 모든 API 경로 접두사: `/api`
> 작성일: 2026-04-07

---

## 목차

1. [인증 방식](#1-인증-방식)
2. [에러 응답 형식](#2-에러-응답-형식)
3. [인증 API](#3-인증-api-apiauthrouter)
4. [트랙 API](#4-트랙-api-apitracks)
5. [차트 API](#5-차트-api-apicharts)
6. [플레이리스트 API](#6-플레이리스트-api-apiplaylists)
7. [좋아요 API](#7-좋아요-api-apilikes)
8. [팔로우 API](#8-팔로우-api-apifollows)
9. [아티스트 API](#9-아티스트-api-apiartists)
10. [업로드 API](#10-업로드-api-apiupload)
11. [AI 음악 생성 API](#11-ai-음악-생성-api-apigenerate)
12. [뮤직비디오 API](#12-뮤직비디오-api-apimv)
13. [캐릭터 API](#13-캐릭터-api-apicharacter)
14. [보이스 페르소나 API](#14-보이스-페르소나-api-apivoice-persona)
15. [보컬 변환 API](#15-보컬-변환-api-apivoice-convert)
16. [보컬 수리 API](#16-보컬-수리-api-apivocal-repair)
17. [Wondera API](#17-wondera-api-apiwondera)
18. [관리자 API](#18-관리자-api-apiadmin)
19. [헬스체크](#19-헬스체크)

---

## 1. 인증 방식

### JWT 토큰

모든 인증 필요 API는 HTTP 헤더에 JWT 토큰을 포함해야 합니다.

```
Authorization: Bearer {token}
```

토큰은 로그인 API 응답에서 받을 수 있습니다.

### 인증 수준

| 표기 | 의미 |
|------|------|
| **필수** | 토큰 없으면 401 에러 |
| **선택** | 토큰 있으면 사용자 정보 활용, 없어도 동작 |
| **없음** | 인증 불필요 |
| **관리자** | admin 역할 필수 |

---

## 2. 에러 응답 형식

모든 에러는 아래 형식으로 반환됩니다:

```json
{"error": "에러 메시지"}
```

| 상태 코드 | 의미 |
|-----------|------|
| 400 | 잘못된 요청 (파라미터 오류) |
| 401 | 인증 필요 (토큰 없음/만료) |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 (이미 존재) |
| 503 | 서비스 불가 (외부 API 키 미설정) |

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
  "nickname": "닉네임"
}
```

**응답 (201):**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "닉네임",
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
{
  "email": "user@example.com",
  "password": "password123"
}
```

**응답 (200):**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "닉네임",
    "profile_image": "object_name 또는 null",
    "role": "user"
  }
}
```

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
  "created_at": "2026-04-01T00:00:00"
}
```

---

### 로그아웃

```
POST /api/auth/logout
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{"message": "로그아웃 되었습니다."}
```

---

## 4. 트랙 API (`/api/tracks`)

### 트랙 목록 조회

```
GET /api/tracks/
```

| 항목 | 값 |
|------|---|
| 인증 | 선택 |

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| page | int | 1 | 페이지 번호 |
| limit | int | 20 | 페이지당 항목 수 |
| genre | str | - | 장르 필터 |
| mood | str | - | 분위기 필터 |
| tag | str | - | 태그 필터 |
| sort | str | "play_count" | 정렬 기준 (play_count / like_count / created_at) |

**응답 (200):**
```json
{
  "tracks": [
    {
      "id": "objectid",
      "title": "곡 제목",
      "artist_name": "크리에이터명",
      "uploader_id": "uuid",
      "genre": ["K-Pop"],
      "mood": ["Happy"],
      "tags": [],
      "duration_sec": 180,
      "play_count": 42,
      "like_count": 5,
      "cover_image": "covers/...",
      "audio_url": "tracks/...",
      "is_public": true,
      "created_at": "2026-04-01T00:00:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

### 트랙 검색

```
GET /api/tracks/search
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| q | str | O | 검색어 |
| page | int | - | 페이지 (기본 1) |
| limit | int | - | 항목 수 (기본 20) |

---

### 내 트랙 목록

```
GET /api/tracks/my
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**쿼리 파라미터:** page, limit, sort (기본 "created_at")

---

### 트랙 상세 조회

```
GET /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

---

### 트랙 수정

```
PUT /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (본인 트랙만) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "title": "새 제목",
  "genre": ["K-Pop", "힙합"],
  "mood": ["Happy"],
  "tags": ["봄"],
  "is_public": true
}
```

---

### 트랙 삭제

```
DELETE /api/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (본인 트랙만) |

---

### 트랙 업로드

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
| file | File | O | 오디오 파일 (mp3, wav, ogg, flac, m4a / 최대 50MB) |
| title | str | O | 곡 제목 |
| genre | str | - | 장르 |
| mood | str | - | 분위기 |
| tags | str | - | 태그 |
| ai_model | str | - | AI 모델명 |
| prompt | str | - | 생성 프롬프트 |
| lyrics | str | - | 가사 |
| is_public | bool | - | 공개 여부 (기본 true) |

---

### AI 생성 음악 → 트랙 등록

```
POST /api/tracks/upload-from-generation
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "generation_id": "objectid",
  "title": "곡 제목",
  "genre": ["K-Pop"],
  "mood": ["Happy"],
  "tags": [],
  "cover_object_name": "covers/.../image.png",
  "ai_model": "Suno",
  "use_voice_converted": false
}
```

---

### 트랙 스트리밍 URL 조회

```
GET /api/tracks/stream/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):**
```json
{
  "stream_url": "https://minio-presigned-url..."
}
```

---

## 5. 차트 API (`/api/charts`)

### 재생 기록

```
POST /api/charts/record-play
```

| 항목 | 값 |
|------|---|
| 인증 | 선택 (로그인 사용자만 차트에 반영) |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "track_id": "objectid"
}
```

**응답 (200):**
```json
{"ok": true}
```

**동작 방식:**
- 비로그인: play_count만 증가, 차트 미반영
- 로그인: Redis에 순 청취자 기록 (1인 1시간/1일 1회 자동 중복 제거)

---

### 차트 조회

```
GET /api/charts/{chart_type}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**경로 파라미터:**

| chart_type | 설명 | 계산 방식 |
|-----------|------|----------|
| top100 | 실시간 차트 | 주간(08~24시): 24h순청취자×50% + 1h순청취자×50%, 심야(01~07시): 24h×100% |
| hot100 | 신곡 차트 | 최근 1시간 순청취자 (발매 30일 이내 곡만) |
| daily | 일간 차트 | 오늘 순 청취자 수 |
| weekly | 주간 차트 | 이번 주 순 청취자 수 |
| monthly | 월간 차트 | 이번 달 순 청취자 수 |

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| limit | int | 100 | 최대 항목 수 |

**응답 (200):**
```json
[
  {
    "id": "objectid",
    "title": "곡 제목",
    "artist_name": "크리에이터명",
    "cover_image": "covers/...",
    "rank": 1,
    "score": 42.5,
    "change": 0,
    "chart_type": "top100",
    "chart_update_time": "2026-04-07T20:00:00+09:00"
  }
]
```

---

### 장르별 차트

```
GET /api/charts/genre/{genre}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리 파라미터:** limit (기본 50)

---

## 6. 플레이리스트 API (`/api/playlists`)

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

**요청 본문:**
```json
{
  "title": "플레이리스트 이름",
  "is_public": true
}
```

---

### 플레이리스트 상세 (트랙 포함)

```
GET /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "id": "objectid",
  "user_id": "uuid",
  "title": "플레이리스트 이름",
  "is_public": true,
  "created_at": "...",
  "tracks": [...]
}
```

---

### 플레이리스트 수정

```
PUT /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (본인만) |

---

### 플레이리스트 삭제

```
DELETE /api/playlists/{playlist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 (본인만) |

---

### 플레이리스트에 트랙 추가

```
POST /api/playlists/{playlist_id}/tracks
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"track_id": "objectid"}
```

---

### 플레이리스트에서 트랙 제거

```
DELETE /api/playlists/{playlist_id}/tracks/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 7. 좋아요 API (`/api/likes`)

### 좋아요 여부 일괄 확인

```
GET /api/likes/check?song_ids=id1,id2,id3
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{"liked_ids": ["id1", "id3"]}
```

---

### 좋아요 목록

```
GET /api/likes/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**쿼리 파라미터:** page, limit

---

### 좋아요 누르기

```
POST /api/likes/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (201):** `{"message": "좋아요 완료"}`

---

### 좋아요 취소

```
DELETE /api/likes/{track_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 8. 팔로우 API (`/api/follows`)

### 팔로우하기

```
POST /api/follows/{user_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (201):** `{"message": "팔로우 완료"}`

---

### 팔로우 취소

```
DELETE /api/follows/{user_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 팔로워 목록

```
GET /api/follows/followers
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**쿼리 파라미터:** page, limit

**응답 (200):**
```json
{
  "followers": [
    {"id": "uuid", "nickname": "닉네임", "profile_image": null, "followed_at": "..."}
  ],
  "total": 10
}
```

---

### 팔로잉 목록

```
GET /api/follows/following
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 9. 아티스트 API (`/api/artists`)

### 아티스트(크리에이터) 목록

```
GET /api/artists/
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**쿼리 파라미터:** page, limit

**응답 (200):**
```json
{
  "artists": [
    {
      "id": "uuid",
      "name": "크리에이터명",
      "image": null,
      "bio": null,
      "track_count": 5,
      "total_plays": 120
    }
  ],
  "pagination": {...}
}
```

---

### 아티스트 프로필

```
GET /api/artists/{artist_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

---

### 아티스트의 트랙 목록

```
GET /api/artists/{artist_id}/tracks?limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

---

## 10. 업로드 API (`/api/upload`)

### 이미지 업로드

```
POST /api/upload/image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| file | File | 이미지 파일 |
| type | str | "cover" 또는 "profile" |
| id | str | track_id 또는 user_id |

**응답 (201):**
```json
{"file_url": "presigned_url", "object_name": "covers/..."}
```

---

### Presigned URL 조회

```
GET /api/upload/presigned-url?bucket=images&object_name=path/to/file
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

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
  "title": "곡 제목",
  "genre": "K-Pop",
  "mood": "Happy",
  "style": "minimal",
  "character_object_name": "characters/uuid/sheet.png"
}
```

**응답 (200):**
```json
{"image_url": "presigned_url", "object_name": "covers/.../image.png", "message": "..."}
```

---

### 커버 이미지 프리뷰

```
GET /api/upload/cover-preview/{object_name}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 (토큰 쿼리 파라미터 가능) |
| 응답 | PNG 이미지 파일 |

---

### MV 프리뷰

```
GET /api/upload/mv-preview/{object_name}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | PNG/MP4 파일 |

---

## 11. AI 음악 생성 API (`/api/generate`)

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
  "prompt": "벚꽃피는 봄날의 사랑",
  "genre": "K-Pop",
  "mood": "Happy",
  "language": "ko"
}
```

---

### 음악 생성 요청

```
POST /api/generate/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "prompt": "봄 느낌의 K-Pop",
  "title": "벚꽃피는 날",
  "genre": "K-Pop",
  "mood": "Happy",
  "style": "pop ballad",
  "vocal": "female",
  "duration": 180,
  "lyrics": "[Verse 1]...",
  "model": "suno",
  "start_music_gen": true,
  "persona_id": "objectid"
}
```

**응답 (201):**
```json
{
  "id": "objectid",
  "status": "processing",
  "message": "음악 생성이 시작되었습니다."
}
```

---

### 음악 생성 시작 (기존 요청)

```
POST /api/generate/{gen_id}/start/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 생성 모델 목록

```
GET /api/generate/models/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "models": [
    {
      "id": "suno",
      "name": "Suno",
      "description": "...",
      "supports_vocal": true,
      "supports_instrumental": true,
      "max_duration": 240,
      "default": false
    }
  ]
}
```

---

### 내 생성 목록

```
GET /api/generate/?page=1&limit=20&status=completed
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 생성 상세 조회

```
GET /api/generate/{gen_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 생성 삭제

```
DELETE /api/generate/{gen_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 생성 음악 스트리밍

```
GET /api/generate/{gen_id}/stream/
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| 응답 | 오디오 파일 (audio/wav 또는 audio/mpeg) |

---

## 12. 뮤직비디오 API (`/api/mv`)

### MV 작업 생성

```
POST /api/mv/create
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "title": "곡 제목",
  "genre": "K-Pop",
  "mood": "Happy",
  "lyrics": "[Verse 1]\n가사...",
  "cover_object_name": "covers/.../image.png",
  "audio_duration_sec": 180.0,
  "character_object_name": "characters/uuid/sheet.png",
  "video_model": "kling",
  "audio_generation_id": "objectid"
}
```

**응답 (201):**
```json
{"job_id": "objectid", "status": "splitting", "message": "..."}
```

---

### MV 작업 목록

```
GET /api/mv/jobs?page=1&limit=20
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### MV 작업 상세

```
GET /api/mv/jobs/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답에 포함되는 씬 정보:**
```json
{
  "scenes": [
    {
      "scene_number": 1,
      "description_ko": "벚꽃이 흩날리는 거리",
      "image_prompt": "...",
      "video_prompt": "...",
      "lyrics_segment": "봄바람이 불어와",
      "image_url": "presigned_url",
      "video_url": "presigned_url",
      "video_status": "completed",
      "section": "Verse 1-1",
      "section_start": 15.2,
      "section_end": 25.0,
      "use_seconds": 9.8
    }
  ]
}
```

---

### 씬 이미지 생성

```
POST /api/mv/jobs/{job_id}/generate-images
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**요청 본문 (선택):**
```json
{"scene_numbers": [1, 3, 5]}
```

---

### 씬 이미지 직접 업로드

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/upload-image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |

**폼 필드:** `file` (이미지)

---

### 씬 이미지 재생성

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/regenerate-image
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 개별 씬 영상 생성

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 전체 영상 생성 (Phase 3)

```
POST /api/mv/jobs/{job_id}/generate-videos
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**요청 본문 (선택):**
```json
{
  "scene_numbers": [1, 2, 3],
  "video_model": "kling"
}
```

---

### 영상 합치기 (Phase 4)

```
POST /api/mv/jobs/{job_id}/concatenate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 오디오 합치기 (Phase 5)

```
POST /api/mv/jobs/{job_id}/merge-audio
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"audio_object_name": "tracks/uuid/track.mp3"}
```

---

### 초안 저장

```
POST /api/mv/jobs/{job_id}/save-draft
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 작업 취소

```
POST /api/mv/jobs/{job_id}/cancel
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 작업 삭제

```
DELETE /api/mv/jobs/{job_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

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
{
  "models": [
    {"id": "kling", "name": "Kling V3 Omni", "provider": "Kling AI", "duration": "3-15초", "available": true}
  ]
}
```

---

### Sync Labs 립싱크 재시도

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/retry-sync
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 보컬 분리 (립싱크용)

```
POST /api/mv/jobs/{job_id}/scenes/{scene_number}/separate-vocal
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| 타임아웃 | 300초 |

**응답 (200):**
```json
{
  "original_audio_url": "data:audio/wav;base64,...",
  "vocal_audio_url": "data:audio/wav;base64,...",
  "scene_number": 1,
  "cached": false
}
```

---

## 13. 캐릭터 API (`/api/character`)

### 캐릭터 시트 생성

```
POST /api/character/generate-sheet
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |
| 타임아웃 | 120초 |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 참조 사진 |
| top_image | File | - | 상의 이미지 |
| bottom_image | File | - | 하의 이미지 |
| shoes_image | File | - | 신발 이미지 |
| user_text | str | - | 텍스트 설명 |

**응답 (200):**
```json
{
  "object_name": "characters/temp/uuid/xxx.png",
  "preview_url": "/api/character/preview/characters/temp/uuid/xxx.png",
  "message": "..."
}
```

---

### 캐릭터 시트 수정

```
POST /api/character/refine
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |
| 타임아웃 | 180초 |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| sheet_image | File | O | 기존 시트 이미지 |
| photo | File | O | 참조 사진 |
| refine_request | str | O | 수정 요청 사항 |

---

### 캐릭터 저장

```
POST /api/character/save
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"sheet_object_name": "characters/temp/uuid/xxx.png"}
```

---

### 내 캐릭터 조회

```
GET /api/character/me
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 내 캐릭터 삭제

```
DELETE /api/character/me
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 캐릭터 시트 프리뷰

```
GET /api/character/preview/{object_name}
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |
| 응답 | PNG 이미지 파일 |

---

## 14. 보이스 페르소나 API (`/api/voice-persona`)

### 페르소나 생성

```
POST /api/voice-persona/create
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |
| 타임아웃 | 60초 |

**폼 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | O | 음성 샘플 (오디오) |
| name | str | O | 페르소나 이름 |
| description | str | - | 설명 |

---

### 페르소나 목록

```
GET /api/voice-persona/list
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 페르소나 상세

```
GET /api/voice-persona/{persona_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 보컬 스트리밍 / 다운로드

```
GET /api/voice-persona/{persona_id}/vocal/stream     ← 스트리밍
GET /api/voice-persona/{persona_id}/vocal/download   ← 다운로드
GET /api/voice-persona/{persona_id}/cover/stream     ← AI 커버 스트리밍
GET /api/voice-persona/{persona_id}/cover/download   ← AI 커버 다운로드
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| 응답 | 오디오 파일 |

---

### 페르소나 삭제

```
DELETE /api/voice-persona/{persona_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 15. 보컬 변환 API (`/api/voice-convert`)

### 보컬 변환 시작

```
POST /api/voice-convert/{generation_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
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

---

### 변환 상태 확인

```
GET /api/voice-convert/{generation_id}/status
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

**응답 (200):**
```json
{
  "generation_id": "objectid",
  "voice_conversion_status": "completed",
  "voice_conversion_progress": 100,
  "voice_converted_url": "...",
  "voice_converted_vocal_url": "...",
  "voice_converted_backing_url": "..."
}
```

---

### 오디오 스트리밍 / 다운로드

```
GET /api/voice-convert/{generation_id}/stream             ← 변환 결과 스트리밍
GET /api/voice-convert/{generation_id}/download           ← 변환 결과 다운로드
GET /api/voice-convert/{generation_id}/converted-vocal/stream  ← 변환 보컬만
GET /api/voice-convert/{generation_id}/backing/stream          ← MR(반주)만
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| 응답 | 오디오 파일 |

---

### MR 음정 미리듣기

```
POST /api/voice-convert/{generation_id}/preview-mr
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"pitch_shift": -2.0}
```

**응답:** 오디오 파일 (arraybuffer)

---

### 보컬 + MR 합치기

```
POST /api/voice-convert/{generation_id}/merge
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{
  "mr_pitch_shift": -2.0,
  "vocal_volume": 1.0,
  "mr_volume": 0.8
}
```

---

### Kits.AI 보이스 모델 목록

```
GET /api/kits/voice-models
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 16. 보컬 수리 API (`/api/vocal-repair`)

### 음성 업로드

```
POST /api/vocal-repair/upload
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |
| 타임아웃 | 60초 |

**폼 필드:** `file` (오디오 파일)

**응답 (200):**
```json
{"id": "objectid", "message": "...", "status": "uploaded"}
```

---

### 보컬 강화 시작

```
POST /api/vocal-repair/{repair_id}/enhance
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |

**요청 본문:**
```json
{"method": "both"}
```

method 값: `"lalal"` / `"demucs"` / `"both"` (기본 "both")

---

### 상태 확인

```
GET /api/vocal-repair/{repair_id}/status
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

### 오디오 스트리밍 / 다운로드

```
GET /api/vocal-repair/{repair_id}/original/stream          ← 원본 스트리밍
GET /api/vocal-repair/{repair_id}/enhanced/stream?method=demucs  ← 강화 스트리밍
GET /api/vocal-repair/{repair_id}/original/download        ← 원본 다운로드
GET /api/vocal-repair/{repair_id}/enhanced/download?method=demucs  ← 강화 다운로드
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| 응답 | 오디오 파일 |

---

### 수리 목록

```
GET /api/vocal-repair/list
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 17. Wondera API (`/api/wondera`)

### 보컬 업로드

```
POST /api/wondera/upload-vocal
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | multipart/form-data |
| 타임아웃 | 60초 |

**폼 필드:** `file` (보컬 오디오)

---

### 음악 생성

```
POST /api/wondera/generate
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |
| Content-Type | application/json |
| 타임아웃 | 60초 |

**요청 본문:**
```json
{
  "lyrics": "가사 텍스트",
  "model": "auto",
  "prompt": "스타일 설명",
  "vocal_id": "wondera_vocal_id"
}
```

---

### 생성 상태 조회

```
GET /api/wondera/query/{task_id}
```

| 항목 | 값 |
|------|---|
| 인증 | 필수 |

---

## 18. 관리자 API (`/api/admin`)

> 모든 관리자 API는 `role: "admin"` 계정 필수

### 대시보드

```
GET /api/admin/dashboard
```

**응답 (200):**
```json
{
  "total_users": 50,
  "total_tracks": 200,
  "total_plays": 5000,
  "today_signups": 3,
  "recent_tracks": [...],
  "recent_users": [...]
}
```

---

### 사용자 관리

```
GET /api/admin/users?page=1&limit=20&search=키워드&role=user&banned=false
GET /api/admin/users/{user_id}
PUT /api/admin/users/{user_id}/role     ← {"role": "admin"}
PUT /api/admin/users/{user_id}/ban      ← {"is_banned": true, "reason": "사유"}
```

---

### 트랙 관리

```
GET /api/admin/tracks?page=1&limit=20&search=키워드&is_public=true
DELETE /api/admin/tracks/{track_id}
PUT /api/admin/tracks/{track_id}/visibility  ← {"is_public": false}
```

---

### 관리자 로그

```
GET /api/admin/logs?page=1&limit=20
```

---

## 19. 헬스체크

```
GET /api/health
```

| 항목 | 값 |
|------|---|
| 인증 | 없음 |

**응답 (200):**
```json
{"status": "ok", "timestamp": "2026-04-07T21:00:00Z"}
```

---

## 부록: ID 타입 정리

| 종류 | 형식 | 예시 |
|------|------|------|
| 사용자 ID | UUID | `18bd8131-2097-47c8-b055-1680b2eb51c3` |
| 트랙/생성/작업 ID | MongoDB ObjectId | `69ce4c72b3d9beab06ce01f9` |

## 부록: 상태값 정리

| 대상 | 상태값 |
|------|--------|
| 음악 생성 | pending → processing → completed / failed |
| MV 작업 | draft → splitting → generating_images → generating_videos → concatenating → merging_audio → completed / paused |
| 보컬 변환 | pending → processing → completed / failed |
| 보컬 수리 | uploaded → processing → completed / failed |
