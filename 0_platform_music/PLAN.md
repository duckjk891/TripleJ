# 음악 플랫폼 완성 계획서

## 1. 현재 상태 분석

### 백엔드 (FastAPI + SQLite)
- **완성된 기능**: 인증(회원가입/로그인/토큰), 곡 조회/검색, 앨범 조회, 아티스트 조회, 차트 TOP100/장르별, 플레이리스트 CRUD, 좋아요 API
- **DB 스키마**: users, artists, albums, songs, playlists, playlist_songs, likes, charts
- **시드 데이터**: 2 유저, 12 아티스트, 15 앨범, 67곡
- **미구현**: 파일 업로드/서빙, 곡 업로드 API, 앨범/아티스트 생성 API, 이미지 업로드

### 프론트엔드 (React 19 + Vite 7)
- **완성된 페이지**: 메인, 차트, 검색, 앨범상세, 아티스트상세, 플레이리스트(목록/상세), 로그인, 회원가입
- **컴포넌트**: Header, Footer, MusicPlayer, SongItem, AlbumCard, PlaylistCard
- **미구현**: 실제 오디오 재생(현재 1초 타이머 시뮬레이션), 좋아요 버튼 연결, 플레이리스트에 곡 추가 UI, 업로드 페이지

### 파일 구조
```
0_platform_music/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 앱, CORS, 라우터 등록
│   │   ├── database.py       # SQLite, 스키마, 시드 데이터
│   │   ├── auth.py           # JWT 인증 헬퍼
│   │   └── routes/
│   │       ├── auth.py       # POST /register, /login, GET /me
│   │       ├── songs.py      # GET /songs, /songs/search, /songs/:id
│   │       ├── albums.py     # GET /albums, /albums/latest, /albums/:id
│   │       ├── artists.py    # GET /artists, /artists/:id, /artists/:id/albums, /artists/:id/songs
│   │       ├── charts.py     # GET /charts/top100, /charts/genre/:genre
│   │       ├── playlists.py  # CRUD + 곡 추가/제거
│   │       └── likes.py      # GET /likes, POST/DELETE /likes/:song_id
│   ├── music.db
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/index.js      # Axios API 클라이언트 (모든 API 함수)
    │   ├── contexts/
    │   │   ├── AuthContext.jsx
    │   │   └── PlayerContext.jsx  # 재생 시뮬레이션 (setInterval 1초)
    │   ├── components/
    │   │   ├── Header.jsx, MusicPlayer.jsx, SongItem.jsx
    │   │   ├── AlbumCard.jsx, PlaylistCard.jsx, Footer.jsx
    │   └── pages/
    │       ├── MainPage.jsx, ChartPage.jsx, SearchPage.jsx
    │       ├── AlbumDetailPage.jsx, ArtistDetailPage.jsx
    │       ├── PlaylistPage.jsx, PlaylistDetailPage.jsx
    │       └── LoginPage.jsx, RegisterPage.jsx
    ├── package.json
    └── vite.config.js
```

---

## 2. 전체 아키텍처 설계

### 파일 저장 구조
```
backend/
├── uploads/
│   ├── music/          # 음악 파일 (.mp3, .wav, .ogg, .flac, .m4a)
│   └── images/         # 이미지 파일 (.jpg, .png, .webp)
│       ├── albums/     # 앨범 커버
│       └── artists/    # 아티스트 이미지
```

### 새 API 엔드포인트 설계

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/songs/upload | 곡 업로드 (오디오 + 메타데이터) | 필요 |
| GET | /api/stream/{song_id} | 오디오 파일 스트리밍 | 불필요 |
| POST | /api/upload/image | 이미지 업로드 (앨범커버/아티스트) | 필요 |
| GET | /api/likes/check/{song_id} | 특정 곡 좋아요 여부 확인 | 필요 |
| GET | /api/likes/check | 여러 곡 좋아요 여부 일괄 확인 (?song_ids=1,2,3) | 필요 |

### 프론트엔드 컴포넌트 구조 (추가)

| 컴포넌트/페이지 | 설명 |
|----------------|------|
| UploadPage.jsx | 음악 업로드 폼 (아티스트/앨범 선택 또는 새로 만들기, 오디오 파일, 커버 이미지) |
| AddToPlaylistModal.jsx | 곡을 플레이리스트에 추가하는 모달 (플레이리스트 목록 표시, 선택, 새로 만들기) |

---

## 3. 백엔드 에이전트 (backend-dev) 임무

### 임무 B1: 파일 업로드 인프라 구축

**파일: `backend/app/main.py`**
- `python-multipart` 의존성 추가 (requirements.txt)
- `fastapi.staticfiles.StaticFiles`로 `/uploads` 디렉토리를 `/api/files`로 마운트
- 앱 시작 시 `uploads/music`, `uploads/images/albums`, `uploads/images/artists` 디렉토리 자동 생성

**파일: `backend/requirements.txt`**
- `python-multipart` 추가

### 임무 B2: 곡 업로드 API

**파일: `backend/app/routes/songs.py`**
- `POST /api/songs/upload` 엔드포인트 추가
  - multipart/form-data로 받기: `file` (오디오 파일), `title`, `artist_id`, `album_id` (선택), `genre` (선택), `lyrics` (선택)
  - 오디오 파일은 `uploads/music/{uuid}_{원본이름}` 형태로 저장
  - duration은 `mutagen` 라이브러리로 추출 (없으면 0)
  - DB에 songs 테이블에 INSERT
  - file_path에는 `/api/files/music/{파일이름}` 저장
  - 허용 확장자: .mp3, .wav, .ogg, .flac, .m4a
  - 파일 크기 제한: 50MB

**파일: `backend/requirements.txt`**
- `mutagen` 추가 (오디오 메타데이터 파싱)

### 임무 B3: 오디오 스트리밍 엔드포인트

**파일: `backend/app/routes/songs.py`**
- `GET /api/stream/{song_id}` 엔드포인트 추가
  - songs 테이블에서 file_path 조회
  - `FileResponse`로 오디오 파일 반환
  - Content-Type을 파일 확장자에 맞게 설정 (audio/mpeg, audio/wav 등)
  - Range 요청 지원 (HTML5 Audio의 seek를 위해 필수): `StreamingResponse` 사용
  - play_count 증가

### 임무 B4: 이미지 업로드 API

**파일: `backend/app/routes/upload.py` (새 파일)**
- `POST /api/upload/image` 엔드포인트
  - multipart/form-data: `file` (이미지), `type` ("album" 또는 "artist"), `id` (앨범/아티스트 ID)
  - 이미지를 `uploads/images/{type}s/{uuid}_{원본이름}` 형태로 저장
  - 해당 albums/artists 테이블의 cover_image/image 필드 업데이트
  - 허용 확장자: .jpg, .jpeg, .png, .webp
  - 파일 크기 제한: 10MB

**파일: `backend/app/main.py`**
- upload 라우터 등록

### 임무 B5: 좋아요 체크 API

**파일: `backend/app/routes/likes.py`**
- `GET /api/likes/check` 엔드포인트 추가
  - query param: `song_ids` (쉼표 구분)
  - 응답: `{ "liked_ids": [1, 3, 5] }` 형태로 유저가 좋아요한 곡 ID 목록 반환
  - 인증 필요

### 임무 B6: 아티스트/앨범 생성 API (곡 업로드 시 새 아티스트/앨범 지원)

**파일: `backend/app/routes/artists.py`**
- `POST /api/artists` 엔드포인트 추가
  - body: `name`, `genre` (선택), `description` (선택)
  - 인증 필요

**파일: `backend/app/routes/albums.py`**
- `POST /api/albums` 엔드포인트 추가
  - body: `title`, `artist_id`, `genre` (선택), `description` (선택)
  - 인증 필요

---

## 4. 프론트엔드 에이전트 (frontend-dev) 임무 (v1.0)

### 임무 F1: HTML5 Audio 실제 재생 구현

**파일: `frontend/src/contexts/PlayerContext.jsx`**
- `useRef`로 `Audio` 객체 관리
- 기존 `setInterval` 1초 시뮬레이션을 Audio의 `timeupdate`, `ended`, `loadedmetadata` 이벤트로 교체
- `play()` 호출 시 `audio.src = http://localhost:8001/api/stream/{song.id}` 설정
- `seekTo()`를 `audio.currentTime = time`으로 변경
- `changeVolume()`를 `audio.volume = vol / 100`으로 변경
- `pause()`를 `audio.pause()`로 변경
- `next()`, `prev()`에서 새 src 설정 후 play
- `ended` 이벤트에서 자동 다음 곡 전환
- `duration`은 `audio.duration`에서 가져오기 (NaN이면 song.duration 사용)

### 임무 F2: 좋아요 버튼 연결

**파일: `frontend/src/components/SongItem.jsx`**
- 좋아요 버튼에 onClick 핸들러 추가
- `api.likeSong(song.id)` / `api.unlikeSong(song.id)` 호출
- 좋아요 상태를 prop으로 받아 하트 아이콘 색상 변경 (빨간색 채움/빈하트)
- 로그인 안 된 경우 로그인 페이지로 이동

**파일: `frontend/src/api/index.js`**
- `checkLikes(songIds)` API 함수 추가: `GET /api/likes/check?song_ids=1,2,3`

**파일: 좋아요 상태를 관리할 상위 컴포넌트들**
- `ChartPage.jsx`, `MainPage.jsx`, `SearchPage.jsx`, `AlbumDetailPage.jsx`, `ArtistDetailPage.jsx`, `PlaylistDetailPage.jsx`
- 각 페이지에서 곡 목록 로드 후 `checkLikes`로 좋아요 상태 조회
- `likedIds` Set을 SongItem에 전달

### 임무 F3: 플레이리스트에 곡 추가 모달

**파일: `frontend/src/components/AddToPlaylistModal.jsx` (새 파일)**
- 모달 컴포넌트: 유저의 플레이리스트 목록 표시
- 플레이리스트 선택 시 `api.addSongToPlaylist(playlistId, songId)` 호출
- "새 플레이리스트 만들기" 옵션 포함
- 성공 시 토스트/알림 표시

**파일: `frontend/src/components/SongItem.jsx`**
- 플레이리스트 추가 버튼(+) 클릭 시 AddToPlaylistModal 열기
- songId를 모달에 전달

**파일: `frontend/src/components/AddToPlaylistModal.css` (새 파일)**
- 모달 오버레이, 리스트 스타일

### 임무 F4: 음악 업로드 페이지

**파일: `frontend/src/pages/UploadPage.jsx` (새 파일)**
- 업로드 폼:
  - 곡 제목 (필수)
  - 아티스트 선택 (드롭다운, 기존 아티스트 목록) 또는 새 아티스트 이름 입력
  - 앨범 선택 (선택사항, 아티스트 선택 후 해당 아티스트의 앨범 목록) 또는 새 앨범 이름 입력
  - 장르 선택 (선택사항)
  - 오디오 파일 선택 (필수, drag&drop 지원)
  - 앨범 커버 이미지 (선택사항)
  - 가사 (textarea, 선택사항)
- 업로드 진행률 표시
- 업로드 완료 후 곡 상세 페이지로 이동

**파일: `frontend/src/pages/UploadPage.css` (새 파일)**

**파일: `frontend/src/api/index.js`**
- `uploadSong(formData)` API 함수 추가
- `uploadImage(formData)` API 함수 추가
- `createArtist(name, genre, description)` API 함수 추가
- `createAlbum(title, artistId, genre, description)` API 함수 추가

**파일: `frontend/src/App.jsx`**
- `/upload` 라우트 추가

**파일: `frontend/src/components/Header.jsx`**
- 내비게이션에 "업로드" 링크 추가

### 임무 F5: MusicPlayer에 앨범 커버 이미지 표시

**파일: `frontend/src/components/MusicPlayer.jsx`**
- cover_image가 있으면 실제 이미지 표시, 없으면 기존 그라데이션 유지

**파일: `frontend/src/components/AlbumCard.jsx`**
- cover_image가 있으면 실제 이미지 표시, 없으면 기존 그라데이션 유지

**파일: `frontend/src/components/SongItem.jsx`**
- cover_image가 있으면 실제 이미지 표시, 없으면 기존 그라데이션 유지

---

## 5. 테스트 에이전트 (tester) 임무

### 임무 T1: API 테스트 스크립트

**파일: `backend/tests/test_api.py` (새 파일)**
- requests 라이브러리 사용하여 모든 신규 API 테스트
- 테스트 항목:
  1. 회원가입/로그인 -> 토큰 획득
  2. 곡 업로드 (multipart/form-data)
  3. 오디오 스트리밍 (GET /api/stream/{id})
  4. 이미지 업로드
  5. 좋아요 추가/확인/취소
  6. 플레이리스트 생성 -> 곡 추가 -> 조회 -> 곡 제거
  7. 아티스트 생성
  8. 앨범 생성
- 테스트용 오디오 파일은 짧은 WAV 파일을 프로그래밍적으로 생성

### 임무 T2: 프론트엔드 빌드 검증

- `npm run build`가 에러 없이 완료되는지 확인
- import 경로, 컴포넌트 props 확인

---

## 6. 작업 순서 및 의존 관계

```
Phase 1: 백엔드 기반 구축 (병렬 작업 가능)
  B1 (파일 업로드 인프라) ─────────┐
  B5 (좋아요 체크 API) ───────────┤
  B6 (아티스트/앨범 생성 API) ────┤
                                    │
Phase 2: 핵심 백엔드 기능           │
  B2 (곡 업로드 API) ─── [B1에 의존]
  B3 (오디오 스트리밍) ── [B1에 의존]
  B4 (이미지 업로드) ─── [B1에 의존]
                                    │
Phase 3: 프론트엔드 (백엔드 완료 후)│
  F1 (HTML5 Audio 재생) ── [B3에 의존]
  F2 (좋아요 버튼 연결) ── [B5에 의존]
  F3 (플레이리스트 곡 추가) ── [기존 API 사용, 독립]
  F4 (업로드 페이지) ──── [B2, B4, B6에 의존]
  F5 (이미지 표시) ────── [B4에 의존]

Phase 4: 테스트
  T1 (API 테스트) ── [B1-B6 완료 후]
  T2 (빌드 검증) ── [F1-F5 완료 후]
```

### 실제 실행 순서

1. **backend-dev**: B1 → B2, B3, B4, B5, B6 (B1 완료 후 나머지 순차)
2. **frontend-dev**: F3 (독립) → F1, F2, F4, F5 (백엔드 완료 후)
3. **tester**: T1 (백엔드 완료 후) → T2 (프론트 완료 후)

---

## 7. 각 에이전트별 상세 구현 가이드

### backend-dev 상세 가이드

#### B1: 파일 업로드 인프라
```python
# main.py 수정사항
import os
from fastapi.staticfiles import StaticFiles

# uploads 디렉토리 생성
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
for subdir in ["music", "images/albums", "images/artists"]:
    os.makedirs(os.path.join(UPLOAD_DIR, subdir), exist_ok=True)

# static files 마운트 (라우터 등록 후에)
app.mount("/api/files", StaticFiles(directory=UPLOAD_DIR), name="uploads")
```

```
# requirements.txt
fastapi
uvicorn
pyjwt
bcrypt
python-multipart
mutagen
```

#### B2: 곡 업로드 API
```python
# routes/songs.py에 추가
import os, uuid
from fastapi import UploadFile, File, Form
from ..auth import get_current_user

ALLOWED_AUDIO = {".mp3", ".wav", ".ogg", ".flac", ".m4a"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")

@router.post("/upload", status_code=201)
async def upload_song(
    file: UploadFile = File(...),
    title: str = Form(...),
    artist_id: int = Form(...),
    album_id: int = Form(None),
    genre: str = Form(None),
    lyrics: str = Form(None),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    # 확장자 검사
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_AUDIO:
        return JSONResponse(status_code=400, content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO)})"})

    # 아티스트 존재 확인
    if not db.execute("SELECT id FROM artists WHERE id = ?", (artist_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    # 파일 저장
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, "music", filename)
    content = await file.read()
    if len(content) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB를 초과할 수 없습니다."})
    with open(filepath, "wb") as f:
        f.write(content)

    # duration 추출 (mutagen)
    duration = 0
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(filepath)
        if audio and audio.info:
            duration = int(audio.info.length)
    except:
        pass

    # DB INSERT
    file_url = f"/api/files/music/{filename}"
    cur = db.execute(
        "INSERT INTO songs (title, album_id, artist_id, duration, file_path, lyrics, genre) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (title, album_id, artist_id, duration, file_url, lyrics, genre),
    )
    db.commit()

    song = db.execute("""
        SELECT s.*, a.name as artist_name
        FROM songs s JOIN artists a ON s.artist_id = a.id
        WHERE s.id = ?
    """, (cur.lastrowid,)).fetchone()
    return dict_row(song)
```

#### B3: 오디오 스트리밍
```python
# routes/songs.py에 추가
import mimetypes
from fastapi.responses import FileResponse

@router.get("/stream/{song_id}")
def stream_song(song_id: int, db=Depends(get_db)):
    row = db.execute("SELECT file_path FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    file_path = row[0]  # /api/files/music/xxx.mp3
    # /api/files/music/xxx.mp3 -> uploads/music/xxx.mp3
    actual_path = os.path.join(UPLOAD_DIR, file_path.replace("/api/files/", ""))

    if not os.path.exists(actual_path):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    media_type = mimetypes.guess_type(actual_path)[0] or "audio/mpeg"
    return FileResponse(actual_path, media_type=media_type)
```

#### B4: 이미지 업로드
```python
# routes/upload.py (새 파일)
import os, uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse
from ..auth import get_current_user
from ..database import get_db, dict_row

router = APIRouter(prefix="/api/upload")

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")

@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    type: str = Form(...),       # "album" or "artist"
    id: int = Form(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    if type not in ("album", "artist"):
        return JSONResponse(status_code=400, content={"error": "type은 'album' 또는 'artist'여야 합니다."})

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE:
        return JSONResponse(status_code=400, content={"error": "허용되지 않는 이미지 형식입니다."})

    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB를 초과할 수 없습니다."})

    subdir = f"images/{type}s"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, subdir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    file_url = f"/api/files/{subdir}/{filename}"

    if type == "album":
        db.execute("UPDATE albums SET cover_image = ? WHERE id = ?", (file_url, id))
    else:
        db.execute("UPDATE artists SET image = ? WHERE id = ?", (file_url, id))
    db.commit()

    return {"url": file_url}
```

#### B5: 좋아요 체크 API
```python
# routes/likes.py에 추가
@router.get("/check")
def check_likes(song_ids: str = "", current_user=Depends(get_current_user), db=Depends(get_db)):
    if not song_ids:
        return {"liked_ids": []}
    ids = [int(x.strip()) for x in song_ids.split(",") if x.strip().isdigit()]
    if not ids:
        return {"liked_ids": []}
    placeholders = ",".join("?" * len(ids))
    rows = db.execute(
        f"SELECT song_id FROM likes WHERE user_id = ? AND song_id IN ({placeholders})",
        [current_user["id"]] + ids,
    ).fetchall()
    return {"liked_ids": [r[0] for r in rows]}
```

#### B6: 아티스트/앨범 생성 API
```python
# routes/artists.py에 추가
from pydantic import BaseModel
from typing import Optional
from ..auth import get_current_user

class ArtistCreate(BaseModel):
    name: str
    genre: Optional[str] = None
    description: Optional[str] = None

@router.post("/", status_code=201)
def create_artist(body: ArtistCreate, current_user=Depends(get_current_user), db=Depends(get_db)):
    cur = db.execute(
        "INSERT INTO artists (name, genre, description) VALUES (?, ?, ?)",
        (body.name, body.genre, body.description),
    )
    db.commit()
    row = db.execute("SELECT * FROM artists WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict_row(row)
```

```python
# routes/albums.py에 추가
from pydantic import BaseModel
from typing import Optional
from ..auth import get_current_user

class AlbumCreate(BaseModel):
    title: str
    artist_id: int
    genre: Optional[str] = None
    description: Optional[str] = None

@router.post("/", status_code=201)
def create_album(body: AlbumCreate, current_user=Depends(get_current_user), db=Depends(get_db)):
    if not db.execute("SELECT id FROM artists WHERE id = ?", (body.artist_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})
    cur = db.execute(
        "INSERT INTO albums (title, artist_id, genre, description) VALUES (?, ?, ?, ?)",
        (body.title, body.artist_id, body.genre, body.description),
    )
    db.commit()
    row = db.execute("""
        SELECT al.*, a.name as artist_name
        FROM albums al JOIN artists a ON al.artist_id = a.id
        WHERE al.id = ?
    """, (cur.lastrowid,)).fetchone()
    return dict_row(row)
```

### frontend-dev 상세 가이드

#### F1: HTML5 Audio 재생
PlayerContext.jsx를 수정하여 Audio 객체를 사용. 핵심 변경:
- `audioRef = useRef(new Audio())`
- play 시: `audio.src = \`http://localhost:8001/api/stream/${song.id}\``
- `audio.addEventListener('timeupdate', ...)` 로 currentTime 업데이트
- `audio.addEventListener('ended', ...)` 로 자동 다음곡
- `audio.addEventListener('loadedmetadata', ...)` 로 duration 갱신
- seekTo: `audio.currentTime = time`
- volume: `audio.volume = volume / 100`

#### F2: 좋아요 버튼 연결
SongItem.jsx에 `isLiked`, `onToggleLike` prop 추가:
- 하트 클릭 시 좋아요/취소 API 호출
- 색상 변경: 좋아요시 `color: #e74c3c`, 아닐 때 기본

각 페이지에서:
```jsx
const [likedIds, setLikedIds] = useState(new Set());
// 곡 로드 후
if (user) {
  const ids = songs.map(s => s.id).join(',');
  const { data } = await api.checkLikes(ids);
  setLikedIds(new Set(data.liked_ids));
}
```

#### F3: 플레이리스트 곡 추가 모달
AddToPlaylistModal 컴포넌트:
- props: `songId`, `onClose`
- 마운트 시 `api.getPlaylists()` 호출하여 목록 표시
- 플레이리스트 클릭 시 `api.addSongToPlaylist(pl.id, songId)` 호출
- 새 플레이리스트 만들기 인라인 폼

#### F4: 업로드 페이지
UploadPage:
- 아티스트 드롭다운 (api.getArtists로 로드)
- 새 아티스트 입력 모드 토글
- 앨범 드롭다운 (아티스트 선택 후 api.getArtistAlbums로 로드)
- 새 앨범 입력 모드 토글
- 오디오 파일 input + drag&drop 영역
- 업로드 시 순서: 새 아티스트 생성 (필요시) → 새 앨범 생성 (필요시) → 곡 업로드
- 진행률: `axios.post`의 `onUploadProgress` 활용

#### F5: 이미지 표시
cover_image 경로가 `/api/files/...`인 경우 `http://localhost:8001` + cover_image로 img 태그 표시.
기존 HSL 그라데이션은 이미지가 없을 때 폴백으로 유지.

### tester 상세 가이드

#### T1: API 테스트
Python requests 사용, 순차적으로:
1. POST /api/auth/register로 테스트 계정 생성
2. POST /api/auth/login으로 토큰 획득
3. POST /api/artists - 새 아티스트 생성 확인
4. POST /api/albums - 새 앨범 생성 확인
5. POST /api/songs/upload - WAV 파일 업로드 (프로그래밍적으로 생성한 짧은 오디오)
6. GET /api/stream/{id} - 스트리밍 확인 (status 200, content-type audio)
7. POST /api/likes/{song_id} - 좋아요
8. GET /api/likes/check?song_ids={id} - 좋아요 확인
9. DELETE /api/likes/{song_id} - 좋아요 취소
10. POST /api/playlists - 플레이리스트 생성
11. POST /api/playlists/{id}/songs - 곡 추가
12. GET /api/playlists/{id} - 곡 포함 확인
13. POST /api/upload/image - 이미지 업로드

테스트용 오디오 파일:
```python
import struct, wave
# 0.5초짜리 무음 WAV 파일 생성
```

#### T2: 빌드 검증
```bash
cd frontend && npm run build
```
에러 없이 완료되는지 확인.

---

## 8. 주의사항

1. **CORS**: main.py에 이미 localhost:3001 허용됨. 추가 설정 불필요.
2. **Vite 프록시**: vite.config.js에 `/api` -> `localhost:8001` 프록시 설정 있음. 프론트에서 `/api/stream/1`로 요청 가능.
3. **기존 시드 데이터**: 시드 곡들의 file_path는 `/music/{album_id}/{title}.mp3` 형태인데 실제 파일은 없음. 스트리밍 시 파일이 없으면 404 반환하도록 처리.
4. **파일 크기**: 오디오 50MB, 이미지 10MB 제한.
5. **보안**: 파일 업로드 시 확장자 검사, 크기 제한 필수. path traversal 방지를 위해 uuid 기반 파일명 사용.

---
---

## v2.0 -- 멀티 DB 아키텍처 전환
### 작성일: 2026-03-11

---

## 1. 현재 상태 분석 (v1.0 기준)

### 현재 기술 스택
- **백엔드**: FastAPI + SQLite (단일 DB 파일: `music.db`)
- **인증**: PyJWT + bcrypt (직접 구현)
- **파일 저장**: 로컬 `uploads/` 디렉토리 + StaticFiles 마운트
- **의존성**: fastapi, uvicorn, pyjwt, bcrypt, python-multipart, mutagen

### 현재 SQLite 스키마 (7개 테이블)
| 테이블 | 역할 | PK | 주요 컬럼 |
|--------|------|-----|-----------|
| users | 사용자 | INTEGER AUTO | email, password, nickname, profile_image, created_at |
| artists | 아티스트 | INTEGER AUTO | name, image, debut_date, genre, description |
| albums | 앨범 | INTEGER AUTO | title, artist_id(FK), cover_image, release_date, genre, description |
| songs | 곡 | INTEGER AUTO | title, album_id(FK), artist_id(FK), duration, file_path, lyrics, play_count, like_count, genre |
| playlists | 플레이리스트 | INTEGER AUTO | user_id(FK), title, description, cover_image, is_public, created_at |
| playlist_songs | 플레이리스트-곡 연결 | INTEGER AUTO | playlist_id(FK), song_id(FK), order_num |
| likes | 좋아요 | INTEGER AUTO | user_id(FK), song_id(FK), created_at, UNIQUE(user_id, song_id) |
| charts | 차트 | INTEGER AUTO | song_id(FK), rank, chart_type, chart_date |

### 현재 API 구조 (8개 라우터, 27개 엔드포인트)
- `routes/auth.py` -- POST /register, /login, GET /me
- `routes/songs.py` -- GET /, /search, /{id}, POST /upload, GET /stream/{id}
- `routes/albums.py` -- GET /, /latest, /{id}, POST /
- `routes/artists.py` -- GET /, /{id}, /{id}/albums, /{id}/songs, POST /
- `routes/charts.py` -- GET /top100, /genre/{genre}
- `routes/playlists.py` -- GET /, /{id}, POST /, PUT /{id}, DELETE /{id}, POST /{id}/songs, DELETE /{id}/songs/{song_id}
- `routes/likes.py` -- GET /, /check, POST /{song_id}, DELETE /{song_id}
- `routes/upload.py` -- POST /image

### 현재 구조의 한계
1. **SQLite 동시 쓰기 제한**: 단일 writer lock으로 동시 접속 시 병목
2. **고정 스키마**: 트랙 메타데이터(genre[], mood[], tags[])에 유연한 스키마 필요
3. **차트/랭킹 성능**: 매번 SQL 쿼리로 정렬하는 방식은 대규모 데이터에서 비효율적
4. **전문 검색 부재**: LIKE 검색만 지원, 형태소 분석/관련도 정렬 불가
5. **파일 저장 한계**: 로컬 디스크 저장으로 수평 확장 불가

---

## 2. 목표 멀티 DB 아키텍처

### DB별 역할 분담
```
+------------------+--------------------------------------------------+
| DB               | 역할                                             |
+------------------+--------------------------------------------------+
| PostgreSQL 16    | 사용자, 인증, 팔로우, 좋아요, 결제, 플레이리스트 |
|                  | (관계형 데이터, 트랜잭션 무결성)                 |
+------------------+--------------------------------------------------+
| MongoDB 7        | 트랙 메타데이터, 댓글                            |
|                  | (유연한 스키마, 배열 필드)                       |
+------------------+--------------------------------------------------+
| Redis 7          | 실시간 차트, 세션, 캐시, 재생수 버퍼             |
|                  | (고속 읽기/쓰기, Sorted Set)                     |
+------------------+--------------------------------------------------+
| Elasticsearch 8  | 트랙 전문 검색 (2단계)                           |
|                  | (태그/장르/프롬프트 풀텍스트 검색)               |
+------------------+--------------------------------------------------+
| MinIO (S3 호환)  | 오디오 파일, 커버 이미지 오브젝트 스토리지       |
|                  | (Presigned URL 직접 업로드)                      |
+------------------+--------------------------------------------------+
```

### 아키텍처 다이어그램
```
                          +------------------+
                          |   클라이언트     |
                          |  (React + Vite)  |
                          +--------+---------+
                                   |
                        HTTPS / WebSocket
                                   |
                          +--------v---------+
                          |  FastAPI 백엔드  |
                          |    (Port 8001)   |
                          +--+--+--+--+--+--+
                             |  |  |  |  |
              +--------------+  |  |  |  +---------------+
              |                 |  |  |                   |
     +--------v-------+ +------v--v------+ +------v------+------v-------+
     |  PostgreSQL 16 | |   MongoDB 7    | |   Redis 7   | MinIO (S3)  |
     |  Port: 5432    | |  Port: 27017   | |  Port: 6379 | Port: 9000  |
     |                | |                | |             | API: 9001   |
     | - users        | | - tracks       | | - chart:*   | - audio/    |
     | - follows      | | - comments     | | - session:* | - images/   |
     | - likes        | |                | | - cache:*   | - profiles/ |
     | - playlists    | |                | | - playcount |             |
     | - playlist_    | |                | |   :buffer:* |             |
     |   tracks       | |                | |             |             |
     +----------------+ +----------------+ +-------------+-------------+
                                                  |
                                          +-------v--------+
                                          | Elasticsearch  |
                                          |   8.12.0       |
                                          |  Port: 9200    |
                                          | (2단계 추가)   |
                                          +----------------+
```

---

## 3. 상세 스키마 설계

### 3.1 PostgreSQL (music_platform DB)

```sql
-- ======================================
-- users 테이블
-- ======================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname    VARCHAR(100) NOT NULL,
    profile_image VARCHAR(500) DEFAULT NULL,
    bio         TEXT DEFAULT NULL,
    plan        VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ======================================
-- follows 테이블
-- ======================================
CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id != followee_id)
);
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followee ON follows(followee_id);

-- ======================================
-- likes 테이블
-- track_id는 MongoDB ObjectId를 문자열로 저장
-- ======================================
CREATE TABLE likes (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id  VARCHAR(24) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, track_id)
);
CREATE INDEX idx_likes_track ON likes(track_id);

-- ======================================
-- playlists 테이블
-- ======================================
CREATE TABLE playlists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL,
    is_public  BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_playlists_user ON playlists(user_id);

-- ======================================
-- playlist_tracks 테이블
-- ======================================
CREATE TABLE playlist_tracks (
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    VARCHAR(24) NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    added_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
```

**변경 포인트 (v1.0 -> v2.0)**:
- PK: INTEGER AUTOINCREMENT -> UUID
- users: password -> password_hash, bio 추가, plan 추가, updated_at 추가
- likes: song_id(INTEGER FK) -> track_id(VARCHAR 24, MongoDB ObjectId 문자열)
- playlists: description/cover_image 제거 (간소화), UUID PK
- playlist_songs -> playlist_tracks: song_id -> track_id(VARCHAR 24)
- follows: 신규 테이블
- artists, albums, songs, charts 테이블: PostgreSQL에서 제거 -> MongoDB로 이동

### 3.2 MongoDB (music_platform DB)

**tracks 컬렉션**:
```javascript
{
  _id: ObjectId,
  title: String,                    // 곡 제목
  uploader_id: String,              // PostgreSQL users.id (UUID 문자열)
  uploader_nickname: String,        // 비정규화 (조회 성능)
  ai_model: String,                 // AI 모델명 (suno, udio 등)
  prompt: String,                   // AI 생성 프롬프트
  ai_model_version: String,         // 모델 버전

  genre: [String],                  // 장르 배열 ["발라드", "R&B"]
  mood: [String],                   // 분위기 ["잔잔한", "감성적인"]
  tags: [String],                   // 자유 태그 ["겨울", "새벽"]
  bpm: Number,                      // BPM
  key: String,                      // 음악 키 ("C Major")
  duration_sec: Number,             // 길이 (초)
  language: String,                 // 언어 ("ko", "en")

  audio_url: String,                // MinIO S3 경로
  cover_image_url: String,          // MinIO S3 경로
  waveform_data: [Number],          // 파형 데이터 배열

  play_count: Number,               // 재생수 (Redis 배치 동기화)
  like_count: Number,               // 좋아요수 (이벤트 동기화)
  comment_count: Number,            // 댓글수

  is_public: Boolean,               // 공개 여부
  created_at: Date,
  updated_at: Date
}

// 인덱스
db.tracks.createIndex({ uploader_id: 1 })
db.tracks.createIndex({ genre: 1 })
db.tracks.createIndex({ tags: 1 })
db.tracks.createIndex({ ai_model: 1 })
db.tracks.createIndex({ created_at: -1 })
db.tracks.createIndex({ play_count: -1 })
db.tracks.createIndex({ is_public: 1, created_at: -1 })
```

**comments 컬렉션**:
```javascript
{
  _id: ObjectId,
  track_id: ObjectId,               // tracks._id 참조
  user_id: String,                  // PostgreSQL users.id (UUID 문자열)
  user_nickname: String,            // 비정규화
  content: String,
  created_at: Date
}

// 인덱스
db.comments.createIndex({ track_id: 1, created_at: -1 })
```

**v1.0 -> v2.0 매핑**:
- songs 테이블 -> tracks 컬렉션 (스키마 유연화, 배열 필드 지원)
- artists/albums 테이블 -> 트랙 내 필드로 비정규화 (uploader_id, uploader_nickname)
- charts 테이블 -> Redis Sorted Set으로 이동
- file_path -> audio_url (MinIO presigned URL)
- genre(TEXT) -> genre([String]) 배열화

### 3.3 Redis 키 구조

```
# ==========================================
# 차트 (Sorted Set: score = 재생수/가중치)
# ==========================================
chart:daily:{YYYYMMDD}          # 일간 차트, TTL 48시간
chart:weekly:{YYYY-Www}         # 주간 차트, TTL 14일
chart:alltime                   # 전체 차트, TTL 없음

# ==========================================
# 세션/인증
# ==========================================
session:{user_id}               # 세션 데이터, TTL 7일
refresh_token:{token_hash}      # 리프레시 토큰, TTL 30일

# ==========================================
# 캐시
# ==========================================
cache:track:{track_id}          # 트랙 상세 캐시, TTL 10분
cache:top100:daily              # 일간 TOP100 캐시, TTL 5분
cache:top100:weekly             # 주간 TOP100 캐시, TTL 10분

# ==========================================
# 재생수 버퍼 (1분 배치 -> MongoDB 동기화)
# ==========================================
playcount:buffer:{track_id}     # INCR로 카운트, 1분마다 MongoDB에 반영 후 DEL
```

### 3.4 Elasticsearch (2단계 추가)

**tracks 인덱스 매핑**:
```json
{
  "mappings": {
    "properties": {
      "track_id":          { "type": "keyword" },
      "title":             { "type": "text", "analyzer": "nori" },
      "uploader_id":       { "type": "keyword" },
      "uploader_nickname": { "type": "text" },
      "ai_model":          { "type": "keyword" },
      "prompt":            { "type": "text", "analyzer": "nori" },
      "genre":             { "type": "keyword" },
      "mood":              { "type": "keyword" },
      "tags":              { "type": "keyword" },
      "play_count":        { "type": "integer" },
      "like_count":        { "type": "integer" },
      "duration_sec":      { "type": "integer" },
      "is_public":         { "type": "boolean" },
      "created_at":        { "type": "date" },
      "cover_image_url":   { "type": "keyword", "index": false }
    }
  }
}
```

### 3.5 MinIO 버킷 구조

```
music-platform-audio/
  tracks/{uploader_id}/{track_id}.mp3

music-platform-images/
  covers/{uploader_id}/{track_id}.jpg
  profiles/{user_id}.jpg
```
- Presigned URL로 클라이언트가 직접 업로드
- 읽기 시에도 presigned URL 발급 (만료 시간 설정)

---

## 4. Docker Compose 구성

```yaml
# docker-compose.yml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: music-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: music_platform
      POSTGRES_USER: ${POSTGRES_USER:-music_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-music_pass_2024}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/init_postgres.sql:/docker-entrypoint-initdb.d/01_init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-music_user} -d music_platform"]
      interval: 5s
      timeout: 5s
      retries: 5

  mongo:
    image: mongo:7
    container_name: music-mongo
    restart: unless-stopped
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER:-music_user}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD:-music_pass_2024}
      MONGO_INITDB_DATABASE: music_platform
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
      - ./infra/init_mongo.js:/docker-entrypoint-initdb.d/01_init.js
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: music-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD:-music_pass_2024}
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-music_pass_2024}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  elasticsearch:
    image: elasticsearch:8.12.0
    container_name: music-elasticsearch
    restart: unless-stopped
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: music-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER:-music_minio}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:-music_minio_pass_2024}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  mongo_data:
  redis_data:
  es_data:
  minio_data:
```

---

## 5. 환경 변수 (.env)

```env
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=music_platform
POSTGRES_USER=music_user
POSTGRES_PASSWORD=music_pass_2024

# MongoDB
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=music_platform
MONGO_USER=music_user
MONGO_PASSWORD=music_pass_2024

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=music_pass_2024

# Elasticsearch (2단계)
ES_HOST=localhost
ES_PORT=9200

# MinIO
MINIO_HOST=localhost
MINIO_PORT=9000
MINIO_USER=music_minio
MINIO_PASSWORD=music_minio_pass_2024
MINIO_AUDIO_BUCKET=music-platform-audio
MINIO_IMAGE_BUCKET=music-platform-images

# JWT
JWT_SECRET=music-platform-secret-key-2024
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=10080
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30
```

---

## 6. 백엔드 코드 구조 변경 계획

### 6.1 새 디렉토리 구조

```
backend/
├── docker-compose.yml
├── .env
├── .env.example
├── requirements.txt              # 의존성 대폭 추가
├── infra/                        # DB 초기화 스크립트
│   ├── init_postgres.sql         # PostgreSQL 테이블 생성
│   ├── init_mongo.js             # MongoDB 인덱스 생성
│   └── seed_data.py              # 시드 데이터 삽입 스크립트
│
├── app/
│   ├── __init__.py
│   ├── main.py                   # FastAPI 앱 (수정)
│   ├── config.py                 # [신규] 환경 변수 로드 (pydantic-settings)
│   │
│   ├── database/                 # [신규] DB 연결 모듈 디렉토리
│   │   ├── __init__.py
│   │   ├── postgres.py           # asyncpg 연결 풀 + SQLAlchemy async
│   │   ├── mongodb.py            # motor 비동기 MongoDB 클라이언트
│   │   ├── redis.py              # redis.asyncio 연결
│   │   ├── elasticsearch.py      # elasticsearch-py async 클라이언트 (2단계)
│   │   └── minio.py              # minio-py S3 클라이언트
│   │
│   ├── models/                   # [신규] Pydantic 모델
│   │   ├── __init__.py
│   │   ├── user.py               # UserCreate, UserResponse 등
│   │   ├── track.py              # TrackCreate, TrackResponse 등
│   │   └── playlist.py           # PlaylistCreate, PlaylistResponse 등
│   │
│   ├── auth.py                   # JWT 인증 (수정: Redis 세션 연동)
│   │
│   ├── routes/                   # 라우트 (대폭 수정)
│   │   ├── __init__.py
│   │   ├── auth.py               # 수정: PostgreSQL + Redis 세션
│   │   ├── tracks.py             # 수정: songs.py -> tracks.py (MongoDB)
│   │   ├── charts.py             # 수정: Redis Sorted Set 기반
│   │   ├── playlists.py          # 수정: PostgreSQL + MongoDB 크로스 쿼리
│   │   ├── likes.py              # 수정: PostgreSQL likes + MongoDB like_count 동기화
│   │   ├── upload.py             # 수정: MinIO 업로드
│   │   ├── search.py             # [신규] Elasticsearch 검색 (2단계)
│   │   └── follows.py            # [신규] 팔로우/언팔로우
│   │
│   └── services/                 # [신규] 비즈니스 로직 분리
│       ├── __init__.py
│       ├── playcount_sync.py     # Redis -> MongoDB 재생수 동기화 배치
│       └── es_sync.py            # MongoDB -> Elasticsearch 동기화 (2단계)
│
└── tests/
    └── test_api.py               # 수정: 멀티 DB 대응
```

### 6.2 requirements.txt 변경

```
# 기존 유지
fastapi
uvicorn
pyjwt
bcrypt
python-multipart
mutagen

# 신규 추가
pydantic-settings           # 환경 변수 관리
asyncpg                     # PostgreSQL 비동기 드라이버
sqlalchemy[asyncio]         # SQLAlchemy 비동기 ORM (선택적 사용)
motor                       # MongoDB 비동기 드라이버 (pymongo 기반)
redis[hiredis]              # Redis 비동기 클라이언트 + C 파서
minio                       # MinIO S3 클라이언트
python-dotenv               # .env 파일 로드
elasticsearch[async]        # Elasticsearch 비동기 클라이언트 (2단계)
apscheduler                 # 배치 스케줄러 (재생수 동기화)
```

### 6.3 주요 코드 변경 상세

#### database.py -> database/ 패키지

**기존 (`database.py`)**:
- SQLite 직접 연결 (`sqlite3.connect`)
- 동기 제너레이터 (`get_db`)
- 스키마 직접 CREATE TABLE
- 시드 데이터 직접 INSERT

**변경 (`database/` 패키지)**:
- 각 DB별 분리된 연결 모듈
- 비동기 연결 풀 사용
- 앱 시작/종료 시 연결 관리 (lifespan)

```python
# database/postgres.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = None
async_session = None

async def init_postgres(database_url: str):
    global engine, async_session
    engine = create_async_engine(database_url, pool_size=20, max_overflow=10)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_pg():
    async with async_session() as session:
        yield session

async def close_postgres():
    if engine:
        await engine.dispose()
```

```python
# database/mongodb.py
from motor.motor_asyncio import AsyncIOMotorClient

client = None
db = None

async def init_mongodb(uri: str, db_name: str):
    global client, db
    client = AsyncIOMotorClient(uri)
    db = client[db_name]

def get_mongo():
    return db

async def close_mongodb():
    if client:
        client.close()
```

```python
# database/redis.py
import redis.asyncio as aioredis

redis_client = None

async def init_redis(url: str):
    global redis_client
    redis_client = aioredis.from_url(url, decode_responses=True)

def get_redis():
    return redis_client

async def close_redis():
    if redis_client:
        await redis_client.close()
```

```python
# database/minio.py
from minio import Minio

minio_client = None

def init_minio(endpoint: str, access_key: str, secret_key: str):
    global minio_client
    minio_client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=False)

def get_minio():
    return minio_client
```

#### main.py 변경

```python
# main.py (핵심 변경)
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .config import settings
from .database.postgres import init_postgres, close_postgres
from .database.mongodb import init_mongodb, close_mongodb
from .database.redis import init_redis, close_redis
from .database.minio import init_minio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_postgres(settings.postgres_url)
    await init_mongodb(settings.mongo_url, settings.mongo_db)
    await init_redis(settings.redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    yield
    # Shutdown
    await close_postgres()
    await close_mongodb()
    await close_redis()

app = FastAPI(title="Music Platform API v2", lifespan=lifespan)
```

#### 라우트 변경 예시: auth.py

```python
# routes/auth.py (v2.0)
# 주요 변경:
# 1. SQLite -> PostgreSQL (asyncpg/SQLAlchemy)
# 2. 세션을 Redis에 저장
# 3. 비동기 함수로 전환

@router.post("/register", status_code=201)
async def register(body: RegisterRequest, pg=Depends(get_pg)):
    # PostgreSQL에 사용자 생성
    result = await pg.execute(
        text("INSERT INTO users (email, password_hash, nickname) VALUES (:email, :pw, :nick) RETURNING id"),
        {"email": body.email, "pw": hashed, "nick": body.nickname}
    )
    await pg.commit()
    user_id = str(result.scalar())

    # Redis에 세션 저장
    redis = get_redis()
    await redis.setex(f"session:{user_id}", 604800, json.dumps(session_data))

    return {"token": token, "user": {"id": user_id, ...}}
```

#### 라우트 변경 예시: tracks.py (구 songs.py)

```python
# routes/tracks.py (v2.0)
# 주요 변경:
# 1. songs -> tracks
# 2. SQLite -> MongoDB
# 3. 파일 업로드 -> MinIO
# 4. 재생수 -> Redis 버퍼

@router.get("/")
async def list_tracks(page: int = 1, limit: int = 20, genre: str = None):
    mongo = get_mongo()
    query = {"is_public": True}
    if genre:
        query["genre"] = genre

    cursor = mongo.tracks.find(query).sort("play_count", -1).skip((page-1)*limit).limit(limit)
    tracks = await cursor.to_list(length=limit)
    total = await mongo.tracks.count_documents(query)
    return {"tracks": tracks, "pagination": {...}}

@router.get("/{track_id}")
async def get_track(track_id: str):
    mongo = get_mongo()
    redis = get_redis()

    # Redis 캐시 확인
    cached = await redis.get(f"cache:track:{track_id}")
    if cached:
        return json.loads(cached)

    track = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not track:
        raise HTTPException(404, "트랙을 찾을 수 없습니다.")

    # Redis에 재생수 버퍼 증가
    await redis.incr(f"playcount:buffer:{track_id}")

    # 캐시 저장
    await redis.setex(f"cache:track:{track_id}", 600, json.dumps(track, default=str))
    return track

@router.post("/upload", status_code=201)
async def upload_track(file: UploadFile, title: str = Form(...), ...):
    # MinIO에 파일 업로드
    minio = get_minio()
    track_id = str(ObjectId())
    object_name = f"tracks/{uploader_id}/{track_id}.mp3"
    minio.put_object("music-platform-audio", object_name, file.file, file.size)

    # MongoDB에 메타데이터 저장
    mongo = get_mongo()
    doc = {
        "_id": ObjectId(track_id),
        "title": title,
        "uploader_id": current_user["id"],
        "audio_url": f"tracks/{uploader_id}/{track_id}.mp3",
        "genre": genre.split(",") if genre else [],
        ...
    }
    await mongo.tracks.insert_one(doc)
    return doc
```

#### 라우트 변경 예시: charts.py

```python
# routes/charts.py (v2.0)
# 주요 변경: SQLite charts 테이블 -> Redis Sorted Set

@router.get("/top100")
async def top100(chart_type: str = "daily"):
    redis = get_redis()
    mongo = get_mongo()

    # Redis 캐시 확인
    cached = await redis.get(f"cache:top100:{chart_type}")
    if cached:
        return json.loads(cached)

    # Redis Sorted Set에서 TOP100
    if chart_type == "daily":
        key = f"chart:daily:{datetime.now().strftime('%Y%m%d')}"
    elif chart_type == "weekly":
        key = f"chart:weekly:{datetime.now().strftime('%Y-W%V')}"
    else:
        key = "chart:alltime"

    top_ids = await redis.zrevrange(key, 0, 99, withscores=True)

    # MongoDB에서 트랙 상세 배치 조회
    track_ids = [ObjectId(tid) for tid, score in top_ids]
    tracks = await mongo.tracks.find({"_id": {"$in": track_ids}}).to_list(100)

    # 캐시 저장
    ttl = 300 if chart_type == "daily" else 600
    await redis.setex(f"cache:top100:{chart_type}", ttl, json.dumps(result, default=str))
    return result
```

---

## 7. DB 간 데이터 흐름

### 7.1 재생수 동기화 (Redis -> MongoDB)
```
사용자 재생 요청
    |
    v
Redis INCR playcount:buffer:{track_id}   <-- 즉시 (밀리초)
    |
    | (1분 배치 스케줄러)
    v
MongoDB tracks.update_one(               <-- 1분마다
    {"_id": track_id},
    {"$inc": {"play_count": buffered_count}}
)
Redis DEL playcount:buffer:{track_id}
    |
    | (차트 갱신)
    v
Redis ZINCRBY chart:daily:{date} {count} {track_id}
Redis ZINCRBY chart:weekly:{week} {count} {track_id}
Redis ZINCRBY chart:alltime {count} {track_id}
```

### 7.2 트랙 업로드 흐름 (MinIO -> MongoDB -> ES)
```
클라이언트
    |
    | 1. Presigned URL 요청
    v
FastAPI -> MinIO: presigned PUT URL 발급
    |
    | 2. 파일 직접 업로드
    v
클라이언트 -> MinIO: PUT {presigned_url} (오디오/이미지)
    |
    | 3. 메타데이터 저장
    v
FastAPI -> MongoDB: tracks.insert_one({...})
    |
    | 4. 검색 인덱스 동기화 (2단계)
    v
FastAPI -> Elasticsearch: index document
    |
    | 5. 캐시 무효화
    v
Redis DEL cache:track:{track_id}
```

### 7.3 검색 흐름 (ES -> MongoDB)
```
사용자 검색 요청 ("잔잔한 발라드")
    |
    v
Elasticsearch: multi_match query
    -> track_id 목록 + 관련도 점수
    |
    v
Redis: 캐시 확인 (cache:track:{id})
    -> 캐시 히트 시 바로 반환
    |
    v
MongoDB: tracks.find({"_id": {"$in": [ids]}})
    -> 트랙 상세 정보 반환
```

---

## 8. 단계별 구현 계획

### 1단계: MVP (PostgreSQL + MongoDB + Redis + MinIO)

**목표**: 기존 기능을 멀티 DB로 전환, 기본 동작 보장

| 순서 | 작업 | 담당 | 의존 |
|------|------|------|------|
| 1-1 | Docker Compose 작성 + DB 컨테이너 구동 | db-infra | - |
| 1-2 | .env 설정 + config.py 작성 | db-infra | - |
| 1-3 | PostgreSQL 초기화 스크립트 (테이블 생성) | db-infra | 1-1 |
| 1-4 | MongoDB 초기화 스크립트 (인덱스 생성) | db-infra | 1-1 |
| 1-5 | MinIO 버킷 생성 스크립트 | db-infra | 1-1 |
| 1-6 | database/ 패키지 (연결 모듈 4개) | db-infra | 1-1, 1-2 |
| 1-7 | main.py 리팩터링 (lifespan, 비동기) | be-migrate | 1-6 |
| 1-8 | auth.py 마이그레이션 (PG + Redis 세션) | be-migrate | 1-7 |
| 1-9 | routes/auth.py 마이그레이션 | be-migrate | 1-8 |
| 1-10 | routes/tracks.py 마이그레이션 (구 songs.py) | be-migrate | 1-7 |
| 1-11 | routes/upload.py 마이그레이션 (MinIO) | be-migrate | 1-7 |
| 1-12 | routes/charts.py 마이그레이션 (Redis) | be-migrate | 1-7 |
| 1-13 | routes/playlists.py 마이그레이션 (PG + Mongo) | be-migrate | 1-7, 1-10 |
| 1-14 | routes/likes.py 마이그레이션 (PG + Mongo) | be-migrate | 1-7, 1-10 |
| 1-15 | routes/follows.py 신규 작성 | be-migrate | 1-7 |
| 1-16 | 시드 데이터 스크립트 작성 | be-migrate | 1-6 |
| 1-17 | 재생수 동기화 서비스 (Redis -> Mongo) | be-migrate | 1-7 |
| 1-18 | 통합 테스트 수정 | be-migrate | 전체 |

### 2단계: Elasticsearch 추가

| 순서 | 작업 | 담당 |
|------|------|------|
| 2-1 | ES 인덱스 매핑 생성 | db-infra |
| 2-2 | database/elasticsearch.py 연결 모듈 | db-infra |
| 2-3 | routes/search.py 전문 검색 API | be-migrate |
| 2-4 | es_sync.py 동기화 서비스 | be-migrate |
| 2-5 | 기존 검색 API를 ES로 전환 | be-migrate |

### 3단계: 성능 최적화

| 순서 | 작업 | 담당 |
|------|------|------|
| 3-1 | Redis 캐시 전략 고도화 | be-migrate |
| 3-2 | 차트 배치 스케줄러 | be-migrate |
| 3-3 | MongoDB 복합 인덱스 최적화 | db-infra |
| 3-4 | 커넥션 풀 튜닝 | db-infra |

---

## 9. 에이전트별 태스크 분배

### db-infra 에이전트 태스크

| ID | 태스크 | 설명 | 의존 |
|----|--------|------|------|
| D1 | Docker Compose 작성 | docker-compose.yml + 5개 서비스 정의 | - |
| D2 | .env 파일 작성 | 환경 변수 파일 + .env.example | - |
| D3 | config.py 작성 | pydantic-settings 기반 설정 로더 | D2 |
| D4 | PostgreSQL 초기화 스크립트 | infra/init_postgres.sql (테이블 + 인덱스) | D1 |
| D5 | MongoDB 초기화 스크립트 | infra/init_mongo.js (컬렉션 + 인덱스) | D1 |
| D6 | MinIO 버킷 생성 | infra/init_minio.sh 또는 Python 스크립트 | D1 |
| D7 | database/ 연결 모듈 | postgres.py, mongodb.py, redis.py, minio.py | D1, D3 |
| D8 | requirements.txt 업데이트 | 신규 의존성 추가 | - |

### be-migrate 에이전트 태스크

| ID | 태스크 | 설명 | 의존 |
|----|--------|------|------|
| M1 | main.py 리팩터링 | lifespan 패턴, DB 초기화, 라우터 재등록 | D7 |
| M2 | Pydantic 모델 작성 | models/ 패키지 (User, Track, Playlist) | - |
| M3 | auth.py 마이그레이션 | JWT + Redis 세션 관리 | D7, M1 |
| M4 | routes/auth.py 마이그레이션 | 회원가입/로그인/me -> PostgreSQL | M1, M3 |
| M5 | routes/tracks.py 작성 | songs.py -> tracks.py (MongoDB + MinIO) | M1, M2 |
| M6 | routes/charts.py 마이그레이션 | SQLite charts -> Redis Sorted Set | M1 |
| M7 | routes/playlists.py 마이그레이션 | PG playlists + Mongo track 크로스 쿼리 | M1, M5 |
| M8 | routes/likes.py 마이그레이션 | PG likes + Mongo like_count 동기화 | M1, M5 |
| M9 | routes/upload.py 마이그레이션 | 로컬 -> MinIO presigned URL | M1 |
| M10 | routes/follows.py 신규 작성 | 팔로우/언팔로우/팔로워 목록 | M1, M4 |
| M11 | 시드 데이터 스크립트 | infra/seed_data.py (PG + Mongo + Redis) | D7 |
| M12 | 재생수 동기화 서비스 | services/playcount_sync.py (APScheduler) | M5, M6 |
| M13 | 테스트 수정 | tests/test_api.py 멀티 DB 대응 | 전체 |

### 작업 의존 관계 다이어그램
```
db-infra:                        be-migrate:
  D1 (Docker Compose)
  D2 (.env)                        M2 (Pydantic 모델)
  D8 (requirements.txt)
    |
  D3 (config.py) <-- D2
  D4 (PG init) <-- D1
  D5 (Mongo init) <-- D1
  D6 (MinIO init) <-- D1
    |
  D7 (연결 모듈) <-- D1, D3
    |
    +-----> M1 (main.py) <---------+
            |
            +---> M3 (auth.py)
            |     |
            |     +---> M4 (routes/auth.py)
            |           |
            |           +---> M10 (follows)
            |
            +---> M5 (tracks.py)
            |     |
            |     +---> M7 (playlists.py)
            |     +---> M8 (likes.py)
            |     +---> M12 (playcount sync)
            |
            +---> M6 (charts.py)
            +---> M9 (upload.py)
            |
            M11 (seed data) <-- D7
            |
            M13 (tests) <-- 전체
```

---

## 10. 주의사항

1. **데이터 일관성**: PostgreSQL-MongoDB 간 트랜잭션이 없으므로 보상 트랜잭션(compensating transaction) 패턴 사용
2. **ID 매핑**: PostgreSQL UUID <-> MongoDB ObjectId 문자열 변환 유틸 함수 필요
3. **비정규화 동기화**: MongoDB의 uploader_nickname은 PostgreSQL users.nickname 변경 시 별도 업데이트 필요
4. **CORS 유지**: main.py의 기존 CORS 설정 유지 (localhost:4000)
5. **기존 프론트엔드 호환**: API 응답 형식 가능한 한 유지, 변경 시 프론트엔드 동시 수정 필요
6. **SQLite 제거**: 마이그레이션 완료 후 database.py(구), music.db 파일 제거
7. **Docker 네트워크**: 개발 환경에서는 포트 포워딩, 프로덕션에서는 Docker 내부 네트워크 사용

---
---

# v3.0 -- 관리자 모드 (Admin System)

## 1. 개요

AIMU 플랫폼에 관리자(Admin) 시스템을 추가한다. 관리자는 플랫폼 전반을 모니터링하고, 사용자/트랙을 관리할 수 있다. 일반 사용자는 관리자 페이지에 접근할 수 없다.

### 핵심 목표
- 관리자 역할(role) 도입 (DB `users.role` 컬럼 추가)
- 관리자 전용 API 엔드포인트 (인증 + 역할 검증)
- 관리자 전용 프론트엔드 페이지 (대시보드, 사용자 관리, 트랙 관리)
- 관리자만 접근 가능한 라우트 보호

---

## 2. 데이터베이스 변경

### PostgreSQL: users 테이블 변경
```sql
-- role 컬럼 추가 (기존 plan 컬럼과 별도)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- is_banned 컬럼 추가 (밴 처리용)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT DEFAULT NULL;
```

### PostgreSQL: admin_logs 테이블 (감사 로그)
```sql
CREATE TABLE IF NOT EXISTS admin_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,    -- 'ban_user', 'unban_user', 'delete_track', 'change_role', etc.
    target_type VARCHAR(20) NOT NULL,    -- 'user', 'track'
    target_id   VARCHAR(100) NOT NULL,
    details     JSONB DEFAULT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);
```

---

## 3. 백엔드 API 설계

### 3.1 인증 미들웨어
- `get_admin_user` 의존성 함수: `get_current_user` + `role == 'admin'` 검증
- 403 반환 시 "관리자 권한이 필요합니다." 메시지

### 3.2 관리자 API 엔드포인트 (`/api/admin/*`)

| 메서드 | 경로 | 설명 | DB |
|--------|------|------|----|
| GET | /api/admin/dashboard | 대시보드 통계 (총 사용자, 트랙, 재생수, 오늘 가입자 등) | PG + Mongo + Redis |
| GET | /api/admin/users | 사용자 목록 (검색, 필터, 페이지네이션) | PG |
| GET | /api/admin/users/{id} | 사용자 상세 정보 | PG + Mongo |
| PUT | /api/admin/users/{id}/role | 사용자 역할 변경 (user/admin) | PG |
| PUT | /api/admin/users/{id}/ban | 사용자 밴/밴 해제 | PG |
| GET | /api/admin/tracks | 전체 트랙 목록 (숨김 포함, 검색/필터) | Mongo |
| DELETE | /api/admin/tracks/{id} | 트랙 삭제 (MinIO 파일 + MongoDB 문서) | Mongo + MinIO |
| PUT | /api/admin/tracks/{id}/visibility | 트랙 공개/비공개 전환 | Mongo |
| GET | /api/admin/logs | 관리자 활동 로그 | PG |

### 3.3 기존 API 수정
- `POST /api/auth/login`: 응답에 `role` 필드 추가
- `GET /api/auth/me`: 응답에 `role` 필드 추가
- `POST /api/auth/register`: 응답에 `role` 필드 추가
- `get_current_user`: 세션에 `role` 저장/반환
- 밴된 사용자 로그인 차단 (is_banned 체크)

---

## 4. 프론트엔드 설계

### 4.1 관리자 전용 페이지
| 페이지 | 경로 | 설명 |
|--------|------|------|
| AdminDashboardPage | /admin | 대시보드 (통계 카드, 차트) |
| AdminUsersPage | /admin/users | 사용자 관리 (목록, 검색, 밴, 역할 변경) |
| AdminTracksPage | /admin/tracks | 트랙 관리 (목록, 검색, 삭제, 공개/비공개) |

### 4.2 컴포넌트
- `AdminLayout`: 사이드바 + 콘텐츠 영역 레이아웃
- `AdminRoute`: 관리자 역할 체크 + 리다이렉트 (ProtectedRoute)
- `AdminSidebar`: 관리자 네비게이션 (대시보드, 사용자, 트랙)
- `StatCard`: 대시보드 통계 카드 컴포넌트

### 4.3 기존 컴포넌트 수정
- `Header.jsx`: 관리자일 때 "관리자" 링크 표시
- `AuthContext.jsx`: user 객체에 `role` 포함, `isAdmin` 헬퍼 추가
- `api/index.js`: admin API 함수 추가

### 4.4 디자인 방향
- 관리자 페이지는 기존 AIMU 다크 테마 유지
- 사이드바 레이아웃 (기존 페이지와 차별화)
- Header/Footer는 기존 것 재사용하되, 관리자 전용 사이드바 추가

---

## 5. 태스크 분배

### planner (계획)
| ID | 태스크 |
|----|--------|
| P1 | PLAN.md v3.0 관리자 섹션 작성 |
| P2 | 백엔드/프론트 구현 결과 검증 |
| P3 | 미비한 부분 재지시 |
| P4 | REPORT.md v3.0 섹션 업데이트 |

### backend-admin (백엔드)
| ID | 태스크 | 의존성 |
|----|--------|--------|
| A1 | PostgreSQL 스키마 마이그레이션 (role, is_banned, admin_logs) | - |
| A2 | get_admin_user 미들웨어 | A1 |
| A3 | routes/admin.py 작성 (전체 9개 엔드포인트) | A2 |
| A4 | auth.py 수정 (role 반환, 밴 체크) | A1 |
| A5 | main.py에 admin router 등록 | A3 |

### frontend-admin (프론트엔드)
| ID | 태스크 | 의존성 |
|----|--------|--------|
| F1 | api/index.js에 admin API 함수 추가 | - |
| F2 | AuthContext 수정 (role, isAdmin) | - |
| F3 | AdminLayout + AdminSidebar 컴포넌트 | F2 |
| F4 | AdminDashboardPage 구현 | F1, F3 |
| F5 | AdminUsersPage 구현 | F1, F3 |
| F6 | AdminTracksPage 구현 | F1, F3 |
| F7 | AdminRoute (ProtectedRoute) 컴포넌트 | F2 |
| F8 | App.jsx에 admin 라우트 추가 | F4-F7 |
| F9 | Header.jsx에 관리자 링크 추가 | F2 |

### tester (테스트)
| ID | 태스크 |
|----|--------|
| T1 | 서버 실행 + 관리자 API 테스트 |
| T2 | 프론트엔드 빌드 검증 |
| T3 | 관리자 페이지 접근 제어 검증 |

---

## 6. 초기 관리자 계정 설정

```sql
-- 특정 이메일로 관리자 설정 (수동)
UPDATE users SET role = 'admin' WHERE email = 'admin@aimu.com';
```

또는 백엔드에서 환경변수 `ADMIN_EMAILS`를 읽어, 해당 이메일로 가입 시 자동으로 admin 역할 부여.

---

## 7. 파일 생성/수정 목록

### 신규 파일
| 파일 | 설명 |
|------|------|
| `backend/app/routes/admin.py` | 관리자 API 라우터 (9개 엔드포인트) |
| `frontend/src/pages/admin/AdminDashboardPage.jsx` | 대시보드 |
| `frontend/src/pages/admin/AdminDashboardPage.css` | |
| `frontend/src/pages/admin/AdminUsersPage.jsx` | 사용자 관리 |
| `frontend/src/pages/admin/AdminUsersPage.css` | |
| `frontend/src/pages/admin/AdminTracksPage.jsx` | 트랙 관리 |
| `frontend/src/pages/admin/AdminTracksPage.css` | |
| `frontend/src/components/AdminLayout.jsx` | 관리자 레이아웃 |
| `frontend/src/components/AdminLayout.css` | |

### 수정 파일
| 파일 | 변경 내용 |
|------|-----------|
| `backend/infra/init_postgres.sql` | role, is_banned, admin_logs 추가 |
| `backend/app/auth.py` | get_admin_user 함수 추가 |
| `backend/app/routes/auth.py` | role 반환, 밴 체크 |
| `backend/app/main.py` | admin router 등록 |
| `frontend/src/api/index.js` | admin API 함수 |
| `frontend/src/contexts/AuthContext.jsx` | role, isAdmin |
| `frontend/src/App.jsx` | admin 라우트 추가 |
| `frontend/src/components/Header.jsx` | 관리자 링크 |

---

## 보류 작업

### [보류] 스프라이트 캐릭터 깨짐 현상 수정
- **대상**: AIMU 작업실 탭 (StudioScene) + 사무실 게임 (OfficeScene)
- **증상**: 캐릭터가 가만히 있을 때(idle) 깨져서 보임. 걸을 때는 정상적으로 보이기도 함.
- **원인 분석**:
  - 스프라이트시트(`Adam_16x16.png` 등)는 실제 16x32 프레임 (캐릭터가 2타일 높이)
  - `frameHeight: 16`으로 로드하면 캐릭터 절반만 표시됨
  - PIL 분석으로 확인: 16x16 짝수행=상반신, 홀수행=하반신. 16x32로 합쳐야 완전한 캐릭터
- **시도한 수정**:
  1. `frameHeight: 16` → `32`로 변경
  2. 애니메이션 프레임 인덱스 재매핑 (14행→7행 레이아웃)
  3. 텍스트/말풍선 Y좌표 조정
  4. `Phaser.CANVAS` 모드, `roundPixels: true`, `pixelArt: true`
  5. `make.sprite({add:false})` 패턴
  - → 위 수정 적용 후에도 문제 해결되지 않음
- **수정된 파일** (롤백 필요 시 참고):
  - `frontend/src/components/studio/studioConfig.js` — ANIM 구조 변경
  - `frontend/src/components/studio/StudioScene.js` — preload, 애니메이션 생성, Y좌표
  - `0_platform/frontend/minihompi-web/components/game/scenes/OfficeScene.ts`
  - `0_platform/frontend/minihompi-web/src/components/game/scenes/OfficeScene.ts`
- **우선순위**: 낮음 (캐릭터 표시가 핵심 기능은 아님)
