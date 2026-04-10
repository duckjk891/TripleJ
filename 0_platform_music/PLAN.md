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

---

## v2.1 -- AI 커버 이미지 자동 생성 (나노바나나)
### 작성일: 2026-03-16

---

### 1. 개요

트랙 업로드 시 커버 이미지를 **Google 나노바나나 (Gemini Image Generation)** 모델로 자동 생성하는 기능.
사용자가 곡 제목, 장르, 분위기 등을 입력하면 AI가 적합한 앨범 커버 이미지를 만들어 자동으로 설정한다.

### 2. 기술 스택

| 항목 | 기술 |
|------|------|
| AI 모델 | Google Gemini (`gemini-2.0-flash-exp` 또는 최신 이미지 생성 모델) |
| SDK | `google-genai` Python 패키지 |
| 인증 | Google AI Studio API Key (환경변수 `GOOGLE_API_KEY`) |
| 이미지 저장 | MinIO (`aimu-images` 버킷) |
| 프론트엔드 | UploadPage.jsx 내 "AI 커버 생성" 버튼 추가 |

### 3. 구현 계획

#### B7: 백엔드 — AI 커버 이미지 생성 API

**파일**: `backend/app/services/cover_generator.py` (신규)

```python
# google-genai SDK를 사용한 이미지 생성
from google import genai
from google.genai import types

async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
) -> bytes:
    """곡 메타데이터 기반 커버 이미지 생성. PNG bytes 반환."""
```

- 프롬프트 구성: 곡 제목 + 장르 + 분위기를 조합하여 "앨범 커버 아트" 프롬프트 생성
- 응답에서 `inline_data` 파트의 이미지 바이너리 추출
- 생성된 이미지를 MinIO에 업로드 후 object_name 반환

**파일**: `backend/app/routes/upload.py` (수정)

```
POST /api/upload/generate-cover
Body: { "title": str, "genre": str?, "mood": str?, "style": str? }
Response: { "image_url": str (presigned URL), "object_name": str }
```

- 인증 필요 (get_current_user)
- rate limit 고려 (사용자당 분당 5회)
- 생성된 이미지를 MinIO `aimu-images` 버킷에 저장
- presigned URL과 object_name 반환

**파일**: `backend/app/config.py` (수정)
- `google_api_key: str = ""` 필드 추가
- `.env`에 `GOOGLE_API_KEY` 추가

#### F6: 프론트엔드 — AI 커버 생성 UI

**파일**: `frontend/src/pages/UploadPage.jsx` (수정)

- 커버 이미지 섹션에 "AI 커버 생성" 버튼 추가
- 버튼 클릭 시:
  1. 현재 입력된 곡 제목/장르/분위기 수집
  2. `POST /api/upload/generate-cover` 호출
  3. 생성된 이미지를 미리보기로 표시
  4. 업로드 시 해당 이미지를 커버로 사용
- 로딩 상태 표시 (스피너 + "AI가 커버를 그리고 있습니다...")
- "다시 생성" 버튼으로 재생성 가능

#### T3: 테스트

1. API 단위 테스트: `/api/upload/generate-cover` 엔드포인트 응답 확인
2. 통합 테스트: 업로드 페이지에서 AI 커버 생성 → 미리보기 → 트랙 업로드 플로우
3. 에러 케이스: API 키 없을 때, 모델 에러 시 fallback 처리

### 4. 작업 순서

```
B7-1: google-genai 설치 + config 설정 ─┐
B7-2: cover_generator.py 서비스 구현   ─┤→ B7-3: API 엔드포인트 구현 → F6: 프론트 UI → T3: 테스트
```

### 5. 주의사항

1. **API 비용**: 이미지 1장당 약 $0.04. 무분별한 생성 방지를 위해 rate limit 적용
2. **프롬프트 품질**: "album cover art" 키워드 포함, 정사각형(1:1) 비율 지정
3. **Fallback**: API 실패 시 기존 수동 업로드 방식으로 대체 가능하도록 UI 구성
4. **이미지 크기**: 생성 후 적절한 크기(512x512 또는 1024x1024)로 설정

---

## v2.2 작업실2 → 새 업로드 연동 (생성 음악 바로 업로드)

### 1. 개요

작업실2(StudioTab2)에서 완료된 AI 생성 음악을 "업로드하기" 버튼 한 번으로 새 업로드 탭으로 전달.
제목, 장르, 분위기, 프롬프트, 가사, 오디오 파일이 자동 세팅되어 사용자는 수정 후 바로 업로드 가능.

### 2. 데이터 흐름

```
StudioTab2 (완료된 생성 카드)
  → "업로드하기" 클릭
  → onSendToUpload({ generationId, title, genre, mood, prompt, lyrics })

MyMusicPage (부모 컴포넌트)
  → generationPrefill 상태 설정
  → activeTab을 'upload'로 전환
  → UploadPage에 prefill props 전달

UploadPage
  → useEffect로 폼 필드 자동 입력
  → "AI 생성 오디오 (자동 연결)" 배지 표시
  → 사용자 수정 → AI 커버 생성 → 업로드
  → POST /api/tracks/upload-from-generation 호출

Backend (tracks.py)
  → generation 레코드 확인 (소유자, 완료 상태)
  → MinIO에서 오디오 복사 (generated/ → tracks/)
  → MongoDB에 트랙 문서 생성
  → generation 레코드에 result_track_id 연결
```

### 3. 작업 분담

#### B8: 백엔드 — `POST /api/tracks/upload-from-generation` 엔드포인트

**파일**: `backend/app/routes/tracks.py`

- `generation_id` (필수), `title`, `genre`, `mood`, `tags`, `prompt`, `lyrics`, `cover_object_name`, `ai_model` 파라미터
- generation 레코드 검증 (소유자 확인, status=completed, result_audio_url 존재)
- MinIO 오디오 복사: `generated/{id}/mix.wav` → `tracks/{user_id}/{track_id}.wav`
- mutagen으로 duration 추출
- MongoDB tracks 컬렉션에 문서 삽입
- generation 문서에 `result_track_id` 업데이트

#### F7: 프론트엔드 — 3개 파일 수정

1. **`MyMusicPage.jsx`**: `generationPrefill` 상태 추가, StudioTab2에 `onSendToUpload` 전달, UploadPage에 prefill props 전달
2. **`StudioTab2.jsx`**: 완료된 생성 카드에 "업로드하기" 버튼 추가, `onSendToUpload` prop 수신
3. **`UploadPage.jsx`**: `generationPrefill` prop 수신, useEffect로 폼 자동 입력, `fromGeneration` 상태로 오디오 파일 대체 표시, submit 시 `uploadFromGeneration` API 호출
4. **`api/index.js`**: `uploadFromGeneration` 함수 추가

#### T4: 테스트

1. "업로드하기" 클릭 → 탭 전환 + 폼 자동 입력 확인
2. 오디오 파일 없이 generation 연결로 업로드 성공 확인
3. AI 커버 생성 후 업로드 확인
4. 일반 업로드(prefill 없이) 기존 동작 유지 확인

---

## v2.3 AI 뮤직비디오 생성 (Veo 2)

### 1. 개요

업로드 페이지에서 커버 이미지를 기반으로 Google Veo 2 모델을 사용하여 뮤직비디오 동영상을 자동 생성.
커버 이미지를 초기 프레임으로 사용하고, 곡 정보(제목, 장르, 분위기)로 프롬프트를 구성.

### 2. Veo 2 API 구조

- **모델**: `veo-2`
- **엔드포인트**: `POST /v1beta/models/veo-2:predictLongRunning`
- **비동기 처리**: 작업 시작 → operation name 반환 → 폴링(10초 간격) → 완료 시 video URI 추출 → 다운로드
- **이미지 기반 생성**: 커버 이미지를 base64로 전달 → 초기 프레임으로 사용
- **제약**: 최대 8초, 오디오 미포함, 비디오 2일 보관

### 3. 데이터 흐름

```
UploadPage (커버 이미지 + 곡 정보)
  → "뮤직비디오 생성" 버튼 클릭
  → POST /api/upload/generate-mv

Backend (upload.py)
  → 커버 이미지를 MinIO에서 가져오기
  → base64 인코딩
  → Veo 2 API 호출 (predictLongRunning)
  → operation name 반환

Frontend
  → 폴링 시작: GET /api/upload/mv-status/{operation_id}
  → 완료 시 미리보기 표시

Backend (폴링 응답)
  → Google API 폴링
  → 완료 시 비디오 다운로드 → MinIO 저장
  → 비디오 URL 반환
```

### 4. 작업 분담

#### B9: 백엔드 — 뮤직비디오 생성 서비스 + API

1. **`backend/app/services/mv_generator.py`** (신규)
   - `start_mv_generation(cover_image_bytes, title, genre, mood)` → operation_name 반환
   - `check_mv_status(operation_name)` → {done, video_url} 반환
   - `download_and_store_mv(video_uri, user_id)` → MinIO object_name 반환

2. **`backend/app/routes/upload.py`** (수정)
   - `POST /api/upload/generate-mv` — 뮤직비디오 생성 시작
   - `GET /api/upload/mv-status/{operation_id}` — 상태 폴링
   - `GET /api/upload/mv-preview/{object_name:path}` — MinIO 프록시

#### F8: 프론트엔드 — 뮤직비디오 생성 UI

1. **`UploadPage.jsx`** — 커버 이미지 아래에 "뮤직비디오 생성" 버튼, 진행 상태, 미리보기
2. **`UploadPage.css`** — 뮤직비디오 관련 스타일
3. **`api/index.js`** — `generateMV`, `checkMVStatus` 함수 추가

#### T5: 테스트

1. API 엔드포인트 동작 확인
2. 폴링 → 완료 → 미리보기 플로우 확인
3. 업로드 시 뮤직비디오 연결 확인

---

## v2.4 -- 20장면 AI 뮤직비디오 파이프라인 (Enhanced MV)
### 작성일: 2026-03-17

---

### 1. 개요

기존 v2.3의 단일 텍스트→영상 방식을 **20장면 파이프라인**으로 교체.
가사를 장면별로 분할하고, 각 장면의 이미지를 생성한 뒤, 이미지 기반 영상 클립을 만들어 합치는 구조.

### 2. 파이프라인 흐름

```
가사 + 메타데이터
      │
      ▼
[1] ChatGPT: 가사 → ~20개 장면 분할 (각 장면에 시각적 설명)
      │
      ▼
[2] Gemini (gemini-3-pro-image-preview): 장면별 이미지 생성 (순차)
      │                    ↓ MinIO에 썸네일 저장
      ▼
[3] Veo 3.1 (veo-3.1-generate-preview): 이미지 → 8초 영상 클립 (순차, rate limit 대응)
      │     referenceImages + bytesBase64Encoded 방식
      ▼
[4] ffmpeg: 모든 클립 합치기 (stream-copy → fallback re-encode)
      │
      ▼
[5] MinIO: 최종 영상 업로드 + MongoDB 상태 업데이트
```

### 3. 핵심 기술 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 영상 생성 모델 | Veo 3.1 (not Veo 2) | Veo 3.1만 이미지 입력(referenceImages) 지원 |
| 이미지 입력 포맷 | `bytesBase64Encoded` + `referenceType: "asset"` | `inlineData` 방식은 Veo에서 미지원 |
| durationSeconds | **반드시 8초** | referenceImages 사용 시 4초/6초 → 400 에러 발생 |
| personGeneration | 미사용 (omit) | Veo 3.1에서 이 파라미터 포함 시 에러 |
| 동시 영상 생성 | Semaphore(1) + 장면별 2초 지연 | Semaphore(3)은 429 rate limit 유발 |
| 429 에러 대응 | 최대 3회 재시도 + 60/120/180초 백오프 | API rate limit 대응 |
| 이미지 일관성 | 커버 이미지를 Gemini `inlineData`로 참조 전달 | 장면 이미지가 커버와 동일한 화풍 유지 |
| 이미지 생성 간격 | 3초 딜레이 | Gemini rate limit 방지 |
| 실패 처리 | 장면별 3회 재시도, 50% 이상 실패 시 전체 중단 | 부분 실패 허용 |
| 합치기 도구 | ffmpeg (imageio-ffmpeg fallback) | 범용, pip으로 설치 가능 |

### 3-1. 디버깅 이력 (트러블슈팅)

| 문제 | 원인 | 해결 |
|------|------|------|
| `mv-status/undefined` 폴링 | localStorage에 잘못된 값 잔존 + useRef 미사용으로 interval 추적 불가 | `useRef`로 interval 관리, ObjectId 형식 검증, cleanup 함수 추가 |
| Veo 3.1 400 "use case not supported" | `durationSeconds: 4`로 설정 — referenceImages는 8초 필수 | `durationSeconds: 8`로 변경 |
| Veo 3.1 429 rate limit | Semaphore(3) 동시 요청이 API 할당량 초과 | Semaphore(1) + 장면별 2초 stagger + 429 시 60초 백오프 |
| 장면 이미지가 커버와 전혀 다른 스타일 | 장면 이미지를 커버 참조 없이 독립 생성 | 커버 이미지를 Gemini에 `inlineData`로 전달 + 스타일 매칭 프롬프트 |

### 4. 파일 변경 내역

#### 백엔드

**`app/services/mv_generator.py`** — 전면 재작성
- `split_lyrics_into_scenes()` — ChatGPT로 가사 → ~20 장면
- `generate_scene_image()` — Gemini 이미지 생성 (커버 이미지 참조로 스타일 일관성 유지)
- `start_scene_video()` — Veo 3.1 영상 생성 (이미지 입력, 8초, Semaphore(1))
- `check_scene_video_status()` — 영상 생성 상태 폴링
- `download_video()` — Google URI에서 영상 다운로드
- `concatenate_videos()` — ffmpeg로 클립 합치기
- `run_mv_pipeline()` — 전체 오케스트레이터 (BackgroundTask)

**`app/routes/upload.py`** — MV 엔드포인트 교체
- `POST /api/upload/generate-mv` → job_id 기반 (operation_name → job_id)
- `GET /api/upload/mv-status/{job_id}` → MongoDB mv_jobs 조회
- 기존 엔드포인트(cover, image, presigned-url) 변경 없음

#### 프론트엔드

**`src/pages/UploadPage.jsx`** — MV UI 업데이트
- 진행률 바 + 퍼센트 표시
- 장면 썸네일 그리드 (4열)
- 상태별 한국어 라벨 (장면 분석 중 → 이미지 생성 중 → 영상 생성 중 → 합치는 중)
- localStorage로 job_id 유지 (페이지 이탈 후 복귀 시 재개)
- `useRef`로 interval 관리 + cleanup 함수
- ObjectId 형식 검증 (24자 hex) + 잘못된 localStorage 자동 제거
- 5초 간격 폴링 (기존 10초 → 5초)

**`src/pages/UploadPage.css`** — 진행률 바, 썸네일 그리드 스타일

**`src/api/index.js`** — `checkMVStatus` 파라미터 변경 (operationName → jobId)

### 5. MongoDB 스키마: mv_jobs

```json
{
  "_id": ObjectId,
  "user_id": "uuid-string",
  "title": "곡 제목",
  "status": "pending|splitting|generating_images|generating_videos|concatenating|completed|failed",
  "progress": 0-100,
  "total_scenes": 20,
  "completed_scenes": 15,
  "scene_thumbnails": ["mv/thumbnails/{job_id}/000.png", ...],
  "result_video_url": "mv/generated/{job_id}/final.mp4",
  "error_message": "",
  "created_at": ISODate,
  "updated_at": ISODate
}
```

### 6. 의존성 추가

- `imageio-ffmpeg` — pip으로 설치 가능한 ffmpeg 바이너리 (시스템 ffmpeg 없을 때 fallback)

---

## v2.5 — MV 임시저장/이어하기 시스템

### 1. 배경 및 문제점
- v2.4의 MV 파이프라인은 단일 백그라운드 태스크로, 중간 실패 시 생성물(이미지 포함) 소실
- 429 에러로 영상 생성 중단 시, 이미 만든 씬 이미지를 다시 만들어야 함 → 크레딧 낭비
- 사용자가 직접 이미지를 업로드하거나 교체할 수 없음
- 작업 중간에 저장하고 나중에 이어할 수 없음

### 2. 핵심 컨셉: 이메일 임시저장 방식
- 새업로드 탭에서 작업 중 [임시저장] → MongoDB에 전체 상태 저장
- 내 음악 페이지 > "임시저장" 탭에서 저장 목록 확인
- [불러오기] 클릭 → 새업로드 탭으로 이동, 모든 상태 복원 → 이어서 작업

### 3. 새업로드 탭 (UploadPage) MV 섹션 변경

#### STEP 1: 씬 생성
- [씬 생성하기] 버튼 → 가사 기반으로 ChatGPT가 ~20개 씬 분할 + Gemini가 씬 이미지 생성
- 생성된 씬 목록: 이미지 썸네일 + 설명 + 가사 구간
- 씬별 액션: [이미지 업로드] (사용자 파일), [이미지 재생성] (Gemini 재호출)

#### STEP 2: 영상 생성
- [영상 생성하기] 버튼 → Veo 3.1로 씬 이미지 기반 8초 클립 순차 생성
- 진행률 표시: 프로그레스 바 + 완료 씬 수
- 429 에러 시: "일시정지" 상태 + [재시도하기] 버튼 (완료된 씬 스킵)
- 전체 완료 시: ffmpeg 합치기 → 최종 영상 미리보기

#### 임시저장 버튼
- 새업로드 탭 하단에 [임시저장] 버튼
- 저장 내용: 제목, 장르, 분위기, 가사, 커버이미지, 씬 이미지+스토리, 영상 진행상태 전부
- MongoDB mv_drafts 컬렉션에 사용자별 저장

### 4. 내 음악 페이지 (MyMusicPage) "임시저장" 탭
- 기존 탭 옆에 "임시저장" 탭 추가
- 임시저장 목록: 커버 썸네일, 제목, 씬/영상 진행도, 저장일
- [불러오기] → /upload 페이지로 이동 + 상태 전부 복원
- [삭제] → MongoDB + MinIO 파일 삭제

### 5. API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/mv/create` | MV 작업 생성 + 씬 분할 시작 |
| GET | `/api/mv/jobs` | 사용자 임시저장 목록 |
| GET | `/api/mv/jobs/{id}` | 작업 상세 (씬별 presigned URL) |
| POST | `/api/mv/jobs/{id}/generate-images` | 씬 이미지 생성 |
| POST | `/api/mv/jobs/{id}/scenes/{n}/upload-image` | 사용자 이미지 업로드 |
| POST | `/api/mv/jobs/{id}/scenes/{n}/regenerate-image` | 단일 씬 이미지 재생성 |
| POST | `/api/mv/jobs/{id}/generate-videos` | 영상 생성/이어하기 |
| POST | `/api/mv/jobs/{id}/concatenate` | 합치기 |
| DELETE | `/api/mv/jobs/{id}` | 작업 삭제 |

### 6. 파일 구조
```
backend/app/
├── routes/mv.py            # EXISTING — MV API 라우터 (이미 구현됨)
├── services/mv_pipeline.py  # EXISTING — 4단계 파이프라인 (이미 구현됨)
└── services/mv_generator.py # EXISTING — 저수준 API 호출 함수들

frontend/src/
├── pages/UploadPage.jsx    # MODIFIED — MV 섹션을 STEP1/STEP2 구조로 변경 + 임시저장 버튼
├── pages/UploadPage.css    # MODIFIED — 씬 목록, 프로그레스, 임시저장 스타일
├── pages/MyMusicPage.jsx   # MODIFIED — "임시저장" 탭 추가
├── pages/MyMusicPage.css   # MODIFIED — 임시저장 탭 스타일
├── api/index.js            # MODIFIED — MV API 함수 추가
```

### 7. 429 Rate Limit 대응
- 씬당 최대 5회 재시도 (백오프: 3분 → 5분 → 7분 → 10분 → 15분)
- 연속 3개 씬 실패 시 파이프라인 조기 중단 → status "paused"
- 사용자가 [재시도하기] 클릭 → 완료된 씬 스킵, 미완료 씬만 처리

### v2.5.1 — 커버 확정 후 씬 생성 분리

#### 문제
씬 이미지 생성 시 커버 스타일을 참조하는데, 커버가 없거나 커버를 나중에 바꾸면 20장을 다시 만들어야 함.

#### 변경사항
- [씬 생성하기] 버튼: 커버 이미지 없으면 비활성(disabled) + 안내 텍스트
- 백엔드: `POST /api/mv/create`에서 `cover_object_name` 필수 검증 (400 에러)
- 커버 변경 감지: 씬 생성 후 커버를 바꾸면 경고 배너 + [씬 초기화] 버튼
- 드래프트 복원 시 `mvCoverObjectName` 복원

---

## v2.6 — Suno 모델 통합

### 개요
기존 YuE 모델 옆에 Suno 모델 선택 카드를 추가하여, 사용자가 Suno API로 고품질 AI 음악을 생성할 수 있게 한다. 간편 모드와 커스텀 모드 모두 지원.

### Suno API 스펙
- **Base URL**: `https://api.sunoapi.org/api/v1`
- **인증**: `Authorization: Bearer {SUNO_API_KEY}`
- **생성 요청**: `POST /generate`
  - Body: `{ "prompt": str, "model": "V4", "customMode": bool, "instrumental": bool, "style": str, "title": str }`
  - 응답: `{ "code": 200, "data": { "taskId": "xxx" } }`
- **상태 확인**: `GET /generate/record-info?taskId={taskId}`
  - 응답: `{ "data": { "status": "SUCCESS", "response": { "sunoData": [{ "audioUrl": "...", "title": "...", "duration": 198 }] } } }`
- 비동기 생성 → polling 필요
- 매 요청당 2곡 생성
- `customMode: true`이면 prompt에 가사 포함 가능

### 백엔드 변경사항

#### 1. `config.py` — Suno API 키 설정 추가
- `suno_api_key: str` 필드 추가 (환경변수 `SUNO_API_KEY`에서 로드)

#### 2. `.env` — 환경변수 추가
```
SUNO_API_KEY=your-suno-api-key-here
```

#### 3. `backend/app/services/suno_generator.py` — 새 파일 생성
- **함수**: `generate_music_suno(generation_id, lyrics, genre, mood, style, vocal, title, mongo_db)`
- **흐름**:
  1. Suno API POST `/generate` 호출 → `taskId` 수신
  2. GET `/generate/record-info?taskId={taskId}`로 polling (5초 간격, 최대 5분)
  3. `status == "SUCCESS"` 시 `sunoData[0].audioUrl`에서 mp3 다운로드
  4. MinIO에 업로드 → MongoDB generation 문서 업데이트
  5. 2곡 생성되므로 첫 번째 곡 기본 사용 (output_files에 둘 다 저장 가능)
- **prompt 구성**:
  - 간편 모드 (`customMode: false`): genre + mood + style 조합으로 prompt 생성
  - 커스텀 모드 (`customMode: true`): lyrics를 prompt에 포함, style 태그 설정
- **progress 업데이트**: 10%(요청 완료) → 50%(polling 중) → 100%(완료)
- **에러 처리**: API 실패, timeout, 다운로드 실패 시 status "failed" + error 메시지

#### 4. `generate.py` — 라우트 분기 추가
- `_run_music_generation`에서 `model == "suno"` 분기:
  ```python
  if model == "suno":
      await generate_music_suno(generation_id, lyrics, genre, mood, style, vocal, title, mongo_db)
  else:
      await generate_music(...)  # 기존 YuE
  ```
- `GenerateRequest`에 `title: Optional[str] = None` 필드 추가 (Suno용)

#### 5. `/models/` 엔드포인트 — Suno 모델 정보 추가
```python
{
    "id": "suno",
    "name": "Suno",
    "description": "AI 음악 생성 서비스 (고품질 보컬 + 반주)",
    "status": "available"
}
```

### 프론트엔드 변경사항

#### 1. `StudioTab2.jsx` — MODEL_OPTIONS에 Suno 추가
```javascript
{ id: 'suno', name: 'Suno', desc: 'AI 음악 생성 서비스 (고품질 보컬 + 반주)' }
```

#### 2. 모델별 UI 분기 처리
- **Suno 선택 시 숨길 항목**:
  - Duration(곡 길이) 설정 → Suno가 자동 결정하므로 숨기기 또는 비활성화
  - BPM 설정 → 불필요, 숨기기
  - Key(조성) 설정 → 불필요, 숨기기
- **조건 분기**: `selectedModel === 'suno'`일 때 해당 섹션 렌더링 스킵
- 간편 모드 / 커스텀 모드 모두 동일하게 적용

### 수정 파일 목록
```
backend/
├── app/config.py                    # MODIFIED — suno_api_key 추가
├── app/routes/generate.py           # MODIFIED — suno 분기 + title 파라미터
├── app/services/suno_generator.py   # NEW — Suno API 연동 서비스
├── .env                             # MODIFIED — SUNO_API_KEY 추가

frontend/
├── src/components/StudioTab2.jsx    # MODIFIED — MODEL_OPTIONS + 모델별 UI 분기
```

---

## v2.6.1 — Suno 보컬 연동 수정

### 목적
Suno 모델로 음악 생성 시 보컬이 가사를 실제로 부르도록 수정.
현재 instrumental 곡만 나오는 문제를 3가지 축으로 해결한다.

### 원인 분석
1. Suno API의 `style` 문자열에 보컬 관련 정보가 빠져 있음
2. `instrumental` 파라미터가 명시적으로 `false`로 전달되지 않을 가능성
3. 가사에 `[Verse]`, `[Chorus]` 등 구조 태그가 없으면 Suno가 가사를 무시할 수 있음

### 수정 사항

#### 백엔드 (`suno_generator.py`)

##### 1. SUNO_VOCAL_MAP 딕셔너리 추가
프론트에서 전달되는 vocal 프리셋 값을 Suno style 문자열로 변환하는 매핑 테이블.

```python
SUNO_VOCAL_MAP = {
    "male_warm":      "soft male vocal, warm, smooth",
    "male_powerful":  "powerful male vocal, belted, strong",
    "male_husky":     "raspy male vocal, husky, gritty",
    "female_warm":    "soft female vocal, breathy, warm",
    "female_powerful":"powerful female vocal, belted, strong",
    "female_husky":   "raspy female vocal, husky, sultry",
}
```

##### 2. style 구성 시 보컬 정보 추가
- `vocal` 파라미터가 `SUNO_VOCAL_MAP`에 존재하면 해당 값을 `style_parts` 리스트에 추가
- 최종 style 문자열: `"{장르}, {분위기}, {보컬 스타일}"` 형태

##### 3. vocalGender 파라미터 추가
- `vocal`이 `male_*`이면 `"m"`, `female_*`이면 `"f"` → Suno API payload에 `vocalGender` 포함
- `instrumental`일 경우 `vocalGender` 생략

##### 4. instrumental 명시적 bool 변환
- `vocal == "instrumental"`이면 `instrumental = True`, 그 외에는 `instrumental = False`
- Suno API payload에 `"instrumental": bool(instrumental)` 명시 전달

##### 5. 가사 구조 태그 자동 추가 헬퍼 함수
```python
def ensure_lyrics_structure(lyrics: str) -> str:
    """가사에 [Verse], [Chorus] 등 구조 태그가 없으면 자동으로 추가"""
```
- 정규식으로 `[Verse]`, `[Chorus]`, `[Bridge]`, `[Intro]`, `[Outro]` 등 존재 여부 확인
- 태그가 하나도 없으면:
  - 줄 단위로 분할 → 빈 줄 기준으로 블록 분리
  - 첫 번째 블록: `[Verse 1]`
  - 두 번째 블록: `[Chorus]`
  - 세 번째 블록: `[Verse 2]`
  - 네 번째 블록: `[Chorus]`
  - 다섯 번째 이후: `[Bridge]` → `[Outro]` 순
- `instrumental=True`이면 이 함수 스킵

#### 프론트엔드
- **변경 없음** — 이미 `VOCAL_PRESETS` 상수와 vocal state가 존재하며, API 호출 시 `vocal` 값을 전달 중

### 수정 파일 목록
```
backend/
├── app/services/suno_generator.py   # MODIFIED — SUNO_VOCAL_MAP, vocalGender, instrumental 명시, 가사 구조 태그 헬퍼
```

---

## v2.7 — 뮤직비디오 음악 합치기 (STEP 3)

### 목표
MV 영상 생성 완료 후 STEP 3으로 "뮤직비디오 합치기" 단계를 추가. 영상(final_video.mp4)과 음악 파일(suno/yue로 생성된 mp3)을 ffmpeg로 합쳐서 최종 뮤직비디오를 만드는 기능.

### mvStep 매핑 변경
| mvStep | 상태 | 설명 |
|--------|------|------|
| 0 | draft/failed | 없음 |
| 1 | splitting, generating_images | 씬 생성 중 |
| 2 | scenes_ready, images_ready, videos_ready | 씬 완료 |
| 3 | generating_videos, concatenating | 영상 생성 중 |
| 4 | paused | 일시정지 |
| 5 | video_ready, merging_audio | 영상 완료, 음악 합치기 대기/진행 |
| 6 | completed | 최종 완료 |

### 백엔드

#### 1. mv_pipeline.py — `run_phase5_merge_audio` 추가
- MinIO에서 `final.mp4` 다운로드
- MinIO에서 음악 파일(mp3) 다운로드
- ffmpeg: `ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -c:a aac -shortest output.mp4`
- 결과를 `mv/{job_id}/music_video.mp4`로 MinIO 업로드
- MongoDB 업데이트: `result_music_video_url` 필드, status "completed"

#### 2. Phase4 상태 변경
- 기존: phase4 완료 → status "completed"
- 변경: phase4 완료 → status "video_ready" (음악 합치기 전)

#### 3. mv.py — `POST /api/mv/jobs/{id}/merge-audio` 엔드포인트 추가
- `MergeAudioRequest(audio_object_name: str)` 파라미터
- 백그라운드로 `run_phase5_merge_audio` 실행
- ACTIVE_STATUSES에 "merging_audio" 추가

#### 4. Job 응답에 `result_music_video_url` 필드 추가

### 프론트엔드

#### 1. api/index.js — `mergeAudioMV(jobId, audioObjectName)` 추가

#### 2. UploadPage.jsx
- `mapStatusToStep` 수정: video_ready/merging_audio → 5, completed → 6
- 새 state: `mvMergingAudio`, `mvMusicVideoPreview`, `mvMusicVideoObjectName`
- `handleMergeAudio` 함수 추가 — AI 생성 오디오 경로 자동 연결
- STEP 3 UI 추가:
  - 영상 미리보기 (무음)
  - 오디오 파일 연결 상태 표시
  - [뮤직비디오 합치기] 버튼
  - 합치는 중이면 스피너
- 완료 시 최종 뮤직비디오 미리보기 + 다시 만들기/제거 버튼
- 업로드 시 `mv_object_name`에 최종 뮤직비디오 우선 사용

#### 3. UploadPage.css — STEP 3 관련 스타일 추가

### 수정 파일 목록
```
backend/
├── app/routes/mv.py                # MODIFIED — MergeAudioRequest, merge-audio endpoint, ACTIVE_STATUSES, result_music_video_url 응답
├── app/services/mv_pipeline.py     # MODIFIED — phase4 status "video_ready", run_phase5_merge_audio 추가

frontend/
├── src/api/index.js                # MODIFIED — mergeAudioMV 함수 추가
├── src/pages/UploadPage.jsx        # MODIFIED — STEP 3 UI, mvStep 6단계, handleMergeAudio
├── src/pages/UploadPage.css        # MODIFIED — STEP 3 스타일
```

---

## v2.8 — 내 캐릭터 시스템 + 씬 프롬프트

### 개요

두 가지 기능을 동시에 구현한다:

**A. 내 캐릭터 시스템** — 사용자가 사진을 업로드하면 Gemini로 실사(photorealistic) 캐릭터 시트를 생성하고, 이를 커버 이미지 및 MV 씬 이미지 생성 시 참조 이미지로 활용한다.

**B. 씬 이미지 프롬프트 입력** — MV 씬 생성 전에 "도시 배경 위주로", "밤 분위기로" 같은 사용자 지시사항을 입력할 수 있는 필드를 추가한다.

---

### 백엔드 변경 사항

#### 1. `backend/app/services/character_generator.py` (신규)

캐릭터 시트 생성 서비스. Gemini REST API를 사용한다.

```python
"""
AI Character Sheet Generator using Google Gemini REST API.
Generates photorealistic character sheet from a reference photo.
"""
import base64
import httpx
from ..config import settings

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3-pro-image-preview:generateContent"
)

async def generate_character_sheet(photo_bytes: bytes, mime_type: str = "image/jpeg") -> bytes:
    """Generate photorealistic character sheet from reference photo.

    Returns PNG bytes of the character sheet image.
    """
    photo_b64 = base64.b64encode(photo_bytes).decode("utf-8")

    prompt = (
        "Based on the person in this reference photo, create a photorealistic character sheet. "
        "The character sheet MUST include the following angles/poses of the SAME person, "
        "arranged in a grid layout on a single image:\n"
        "1. Front-facing portrait (head and shoulders)\n"
        "2. Left 45-degree angle portrait\n"
        "3. Right 45-degree angle portrait\n"
        "4. Full body standing pose\n"
        "5. Smiling expression close-up\n"
        "6. Serious/neutral expression close-up\n\n"
        "CRITICAL REQUIREMENTS:\n"
        "- MUST be photorealistic style — like real photographs taken with a high-end camera\n"
        "- Do NOT use anime, cartoon, illustration, or any stylized art style\n"
        "- Maintain consistent appearance (face, hair, skin tone, clothing) across all angles\n"
        "- Use neutral studio-like background (light gray or white)\n"
        "- High quality, sharp details, realistic lighting\n"
        "- Label each view with small text (Front, Left 45°, Right 45°, Full Body, Smile, Serious)\n"
        "- Output as a single combined image in landscape orientation"
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inlineData": {"mimeType": mime_type, "data": photo_b64}},
            ]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            GEMINI_API_URL,
            params={"key": settings.google_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise ValueError("Gemini API error (HTTP {}): {}".format(resp.status_code, detail))

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates in Gemini response")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("data"):
            return base64.b64decode(inline_data["data"])

    raise ValueError("No image generated from Gemini response")
```

**핵심 포인트:**
- `cover_generator.py`와 동일한 Gemini REST API 패턴 사용 (httpx + base64)
- 원본 사진을 `inlineData`로 전달하여 Gemini가 해당 인물을 기반으로 캐릭터 시트를 생성
- 프롬프트에서 실사(photorealistic) 스타일을 명시적으로 요구하고 애니메이션 스타일을 금지
- 6개 앵글/표정을 하나의 그리드 이미지로 출력

#### 2. `backend/app/routes/character.py` (신규)

캐릭터 CRUD API 라우터.

```python
"""
Character API routes — generate, save, retrieve, delete user's AI character.
"""
import io
import os
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo

router = APIRouter(prefix="/api/character", tags=["Character"])

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
```

**엔드포인트:**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/character/generate-sheet` | 사진 업로드 → Gemini 캐릭터 시트 생성 → 임시 저장 → presigned URL 반환 |
| `POST` | `/api/character/save` | 임시 캐릭터 시트를 확정 저장 (MongoDB `characters` 컬렉션) |
| `GET` | `/api/character/me` | 내 캐릭터 조회 (시트 이미지 presigned URL 포함) |
| `DELETE` | `/api/character/me` | 내 캐릭터 삭제 (MongoDB + MinIO) |

**`POST /api/character/generate-sheet` 상세:**
```python
@router.post("/generate-sheet")
async def generate_sheet(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    # 1. 파일 검증 (확장자, 크기)
    # 2. character_generator.generate_character_sheet(photo_bytes, mime_type) 호출
    # 3. 결과를 MinIO에 임시 저장: characters/temp/{user_id}/{uuid}.png
    # 4. presigned URL + object_name 반환
    # 5. proxy endpoint도 제공: /api/character/preview/{object_name}
```

**`POST /api/character/save` 상세:**
```python
class SaveCharacterRequest(BaseModel):
    sheet_object_name: str  # generate-sheet에서 받은 object_name

@router.post("/save")
async def save_character(body: SaveCharacterRequest, current_user=...):
    # 1. temp 위치의 이미지를 확인
    # 2. characters/{user_id}/sheet.png 으로 복사 (또는 이동)
    # 3. MongoDB characters 컬렉션에 upsert:
    #    { user_id, sheet_object_name, created_at, updated_at }
    # 4. 기존 캐릭터 있으면 덮어쓰기 (1인 1캐릭터)
```

**`GET /api/character/me` 상세:**
```python
@router.get("/me")
async def get_my_character(current_user=...):
    # 1. MongoDB characters 컬렉션에서 user_id로 조회
    # 2. 없으면 {"character": null}
    # 3. 있으면 sheet_object_name의 presigned URL과 함께 반환
```

**`DELETE /api/character/me` 상세:**
```python
@router.delete("/me")
async def delete_my_character(current_user=...):
    # 1. MongoDB에서 삭제
    # 2. MinIO에서 characters/{user_id}/ 하위 파일 삭제
```

**`GET /api/character/preview/{object_name:path}` 상세:**
```python
@router.get("/preview/{object_name:path}")
async def character_preview(object_name: str):
    # MinIO 프록시 (cover_preview와 동일 패턴)
```

#### 3. `backend/app/services/cover_generator.py` (수정)

`generate_cover_image` 함수에 `character_image_bytes` 파라미터를 추가한다.

```python
async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    character_image_bytes: bytes = None,  # ← 추가
) -> bytes:
```

**변경 내용:**
- `character_image_bytes`가 제공되면 프롬프트에 다음을 추가:
  ```
  "IMPORTANT: The provided character reference sheet shows the main character. "
  "Feature this person prominently in the album cover as the main subject. "
  "Maintain the person's exact appearance (face, hair, features) from the reference."
  ```
- `request_parts`에 캐릭터 시트 이미지를 `inlineData`로 추가 (cover_image_bytes를 전달하는 것과 동일한 패턴)

#### 4. `backend/app/routes/upload.py` (수정)

`GenerateCoverRequest`에 `character_object_name` 필드를 추가한다.

```python
class GenerateCoverRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    character_object_name: Optional[str] = None  # ← 추가
```

`generate_cover` 엔드포인트에서:
- `character_object_name`이 있으면 MinIO에서 캐릭터 시트 이미지를 로드
- `generate_cover_image()`에 `character_image_bytes=character_bytes` 전달

#### 5. `backend/app/services/mv_generator.py` (수정)

**5-1. `split_lyrics_into_scenes` 수정:**

```python
async def split_lyrics_into_scenes(
    lyrics: Optional[str],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scene_count: int = 20,
    user_scene_prompt: Optional[str] = None,  # ← 추가
) -> List[dict]:
```

- `user_scene_prompt`가 있으면 시스템 프롬프트에 추가:
  ```
  Additional user direction for scene imagery: "{user_scene_prompt}"
  Incorporate this direction into each scene's visual description.
  ```

**5-2. `generate_scene_image` 수정:**

```python
async def generate_scene_image(
    scene_description: str,
    style_prompt: str = "",
    cover_image_bytes: Optional[bytes] = None,
    character_image_bytes: Optional[bytes] = None,  # ← 추가
) -> bytes:
```

- `character_image_bytes`가 제공되면:
  - 프롬프트에 추가:
    ```
    "IMPORTANT: The provided character reference sheet shows the main character "
    "of this music video. This character MUST appear prominently in this scene, "
    "maintaining their exact appearance from the reference. Photorealistic style."
    ```
  - `request_parts`에 캐릭터 시트를 `inlineData`로 추가 (cover_image와 별도)

#### 6. `backend/app/services/mv_pipeline.py` (수정)

**6-1. `_load_character_image` 헬퍼 추가:**
```python
def _load_character_image(character_object_name: Optional[str]) -> Optional[bytes]:
    """Load character sheet image bytes from MinIO."""
    # _load_cover_image와 동일한 패턴
```

**6-2. `run_phase1_split` 수정:**
- job에서 `user_scene_prompt` 필드를 읽어서 `split_lyrics_into_scenes()`에 전달

**6-3. `run_phase2_images` 수정:**
- job에서 `character_object_name` 필드를 읽어서 캐릭터 이미지 로드
- `generate_scene_image()`에 `character_image_bytes=...` 전달

#### 7. `backend/app/routes/mv.py` (수정)

**7-1. `CreateMVRequest` 수정:**
```python
class CreateMVRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    scene_prompt: Optional[str] = None           # ← 추가
    character_object_name: Optional[str] = None   # ← 추가
```

**7-2. `create_mv` 수정:**
- `job_doc`에 `scene_prompt`와 `character_object_name` 필드를 저장

**7-3. `regenerate_scene_image_endpoint` 수정:**
- 캐릭터 이미지도 로드하여 `generate_scene_image()`에 전달

**7-4. `get_mv_job` 응답에 `scene_prompt`, `character_object_name` 필드 추가**

#### 8. `backend/app/main.py` (수정)

```python
from .routes import admin, auth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character  # character 추가

app.include_router(character.router)  # 추가
```

---

### 프론트엔드 변경 사항

#### 1. `frontend/src/api/index.js` (수정)

캐릭터 API 함수 추가:

```javascript
// Character
export const generateCharacterSheet = (formData) =>
  API.post('/character/generate-sheet', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });

export const saveCharacter = (data) =>
  API.post('/character/save', data);

export const getMyCharacter = () =>
  API.get('/character/me');

export const deleteMyCharacter = () =>
  API.delete('/character/me');
```

`generateCover`에 `character_object_name` 전달 가능하도록 (기존 `data` 객체에 이미 포함 가능하므로 변경 불필요).

#### 2. `frontend/src/pages/MyMusicPage.jsx` (수정)

**2-1. "내 캐릭터" 탭 추가:**
```jsx
// 탭 버튼 추가 (tracks, upload, studio, studio2, drafts와 같은 레벨)
<button
  className={`mymusic-tab ${activeTab === 'character' ? 'mymusic-tab--active' : ''}`}
  onClick={() => setActiveTab('character')}
>
  내 캐릭터
</button>
```

**2-2. `CharacterSection` 컴포넌트 (MyMusicPage.jsx 내부에 정의):**

```jsx
function CharacterSection() {
  const [character, setCharacter] = useState(null);      // 저장된 캐릭터
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);    // 시트 생성 중
  const [previewUrl, setPreviewUrl] = useState(null);     // 임시 시트 미리보기
  const [previewObjectName, setPreviewObjectName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const photoInputRef = useRef(null);

  // 초기 로드: 내 캐릭터 조회
  useEffect(() => {
    api.getMyCharacter().then(({data}) => {
      setCharacter(data.character);
    }).finally(() => setLoading(false));
  }, []);

  // 캐릭터 시트 생성
  const handleGenerate = async () => {
    if (!photoFile) { alert('사진을 먼저 선택해주세요.'); return; }
    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append('file', photoFile);
      const { data } = await api.generateCharacterSheet(formData);
      setPreviewUrl(data.preview_url);
      setPreviewObjectName(data.object_name);
    } catch (err) {
      alert(err.response?.data?.error || '캐릭터 시트 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  // 저장
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveCharacter({ sheet_object_name: previewObjectName });
      // 재조회
      const { data } = await api.getMyCharacter();
      setCharacter(data.character);
      setPreviewUrl(null);
      setPreviewObjectName(null);
      setPhotoFile(null);
    } catch (err) {
      alert(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 삭제
  const handleDelete = async () => {
    if (!window.confirm('캐릭터를 삭제하시겠습니까?')) return;
    await api.deleteMyCharacter();
    setCharacter(null);
  };

  // UI:
  //   캐릭터 없으면 → 사진 업로드 영역 + [캐릭터 시트 생성하기] 버튼
  //   생성 중이면 → 스피너
  //   미리보기 있으면 → 시트 이미지 표시 + [저장하기] [다시 생성] 버튼
  //   캐릭터 있으면 → 시트 이미지 표시 + [수정] [삭제] 버튼
}
```

**2-3. 탭 콘텐츠 영역에 렌더링:**
```jsx
{activeTab === 'character' && (
  <CharacterSection />
)}
```

#### 3. `frontend/src/pages/UploadPage.jsx` (수정)

**3-1. 새 state 추가:**
```javascript
const [includeCharacter, setIncludeCharacter] = useState(false);
const [myCharacter, setMyCharacter] = useState(null);
const [scenePrompt, setScenePrompt] = useState('');   // 씬 프롬프트
```

**3-2. 초기 로드 시 내 캐릭터 조회:**
```javascript
useEffect(() => {
  api.getMyCharacter().then(({data}) => {
    if (data.character) setMyCharacter(data.character);
  }).catch(() => {});
}, []);
```

**3-3. 커버 이미지 영역에 "내 캐릭터 포함하기" 토글 추가:**
- `myCharacter`가 있을 때만 노출
- 토글 ON이면 `handleGenerateCover` 호출 시 `character_object_name`을 함께 전달:
  ```javascript
  const { data } = await api.generateCover({
    title: title.trim(),
    genre: genre || null,
    mood: mood || null,
    style: null,
    character_object_name: includeCharacter ? myCharacter.sheet_object_name : null,
  });
  ```

**3-4. MV STEP 1 영역에 두 가지 추가:**

a) "내 캐릭터를 주인공으로" 토글:
```jsx
{myCharacter && (
  <label className="upload-mv-character-toggle">
    <input
      type="checkbox"
      checked={includeCharacter}
      onChange={(e) => setIncludeCharacter(e.target.checked)}
    />
    내 캐릭터를 주인공으로
  </label>
)}
```

b) 씬 프롬프트 입력란:
```jsx
<div className="upload-card__field">
  <label className="upload-card__label">씬 분위기 지시 (선택)</label>
  <textarea
    className="upload-card__textarea"
    value={scenePrompt}
    onChange={(e) => setScenePrompt(e.target.value)}
    placeholder="예: 도시 배경 위주로, 밤 분위기, 네온 조명 강조"
    rows={2}
  />
</div>
```

**3-5. `handleCreateScenes` 수정:**
```javascript
const { data } = await api.createMVJob({
  title: title.trim(),
  genre: genre || null,
  mood: mood || null,
  lyrics: lyrics.trim() || null,
  cover_object_name: aiCoverObjectName || null,
  audio_duration_sec: audioDuration || null,
  scene_prompt: scenePrompt.trim() || null,                              // ← 추가
  character_object_name: includeCharacter ? myCharacter?.sheet_object_name : null,  // ← 추가
});
```

#### 4. `frontend/src/pages/MyMusicPage.css` (수정)

캐릭터 섹션 스타일 추가:

```css
/* Character Section */
.mymusic-character { margin-top: 8px; }

.mymusic-character__sheet {
  text-align: center;
  padding: 24px;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.mymusic-character__sheet-img {
  width: 100%;
  max-width: 600px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  margin-bottom: 16px;
}

.mymusic-character__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.mymusic-character__btn { /* 기본 버튼 */ }
.mymusic-character__btn--primary { /* AI 생성 그라데이션 */ }
.mymusic-character__btn--danger { /* 삭제 빨간색 */ }

.mymusic-character__upload-area { /* 사진 업로드 드롭존 */ }
.mymusic-character__preview { /* 생성된 시트 미리보기 */ }
```

#### 5. `frontend/src/pages/UploadPage.css` (수정)

캐릭터 토글 + 씬 프롬프트 스타일 추가:

```css
/* Character toggle */
.upload-mv-character-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  margin-bottom: 10px;
}

.upload-mv-character-toggle input[type="checkbox"] {
  accent-color: var(--color-primary);
}

/* Scene prompt textarea — 기존 upload-card__textarea 스타일 재사용 */
```

---

### 데이터 모델

#### MongoDB `characters` 컬렉션

```json
{
  "_id": ObjectId,
  "user_id": "uuid-string",
  "sheet_object_name": "characters/{user_id}/sheet.png",
  "original_photo_object_name": "characters/{user_id}/original.jpg",
  "created_at": ISODate,
  "updated_at": ISODate
}
```

#### MongoDB `mv_jobs` 컬렉션 (기존 필드에 추가)

```json
{
  "scene_prompt": "도시 배경 위주로, 밤 분위기",
  "character_object_name": "characters/{user_id}/sheet.png"
}
```

---

### 작업 흐름 상세

#### A. 캐릭터 생성 흐름

```
1. 사용자 → MyMusicPage "내 캐릭터" 탭 클릭
2. 사진 업로드 (원본 얼굴 사진)
3. [캐릭터 시트 생성하기] 클릭
   → POST /api/character/generate-sheet (multipart: file)
   → character_generator.generate_character_sheet(photo_bytes)
   → Gemini가 실사 캐릭터 시트 이미지 생성
   → MinIO에 임시 저장
   → 미리보기 URL 반환
4. 사용자가 시트를 확인
5. [저장하기] 클릭
   → POST /api/character/save {sheet_object_name}
   → MongoDB characters 컬렉션에 upsert
6. 완료: 시트 이미지가 표시됨
```

#### B. 커버 이미지에 캐릭터 활용

```
1. UploadPage 진입 시 api.getMyCharacter()로 내 캐릭터 조회
2. 캐릭터 있으면 "내 캐릭터 포함하기" 토글 표시
3. 토글 ON + [AI 커버 생성] 클릭
   → POST /api/upload/generate-cover {title, genre, mood, character_object_name}
   → upload.py에서 MinIO에서 캐릭터 시트 로드
   → cover_generator.generate_cover_image(character_image_bytes=...)
   → Gemini가 캐릭터를 포함한 커버 이미지 생성
```

#### C. MV 씬에 캐릭터 + 프롬프트 활용

```
1. STEP 1 영역에서:
   - "내 캐릭터를 주인공으로" 토글
   - "씬 분위기 지시" textarea 입력
2. [씬 생성하기] 클릭
   → POST /api/mv/create {title, genre, mood, lyrics, cover_object_name,
                            scene_prompt, character_object_name}
   → Phase 1: split_lyrics_into_scenes(user_scene_prompt=scene_prompt)
     → ChatGPT가 씬 분할 시 사용자 지시사항 반영
   → Phase 2: generate_scene_image(character_image_bytes=...)
     → Gemini가 각 씬 이미지 생성 시 캐릭터 참조
3. MV 영상 (Veo): 씬 이미지에 이미 캐릭터가 포함되어 있으므로 자연스럽게 반영
```

---

### 수정 파일 목록

```
backend/
├── app/services/character_generator.py   # NEW — Gemini 캐릭터 시트 생성
├── app/routes/character.py               # NEW — 캐릭터 CRUD API
├── app/main.py                           # MODIFIED — character 라우터 등록
├── app/services/cover_generator.py       # MODIFIED — character_image_bytes 파라미터 추가
├── app/services/mv_generator.py          # MODIFIED — split에 user_scene_prompt, generate_scene_image에 character_image_bytes 추가
├── app/services/mv_pipeline.py           # MODIFIED — 캐릭터 이미지 로드 + 전달, scene_prompt 전달
├── app/routes/upload.py                  # MODIFIED — GenerateCoverRequest에 character_object_name 추가
├── app/routes/mv.py                      # MODIFIED — CreateMVRequest에 scene_prompt, character_object_name 추가

frontend/
├── src/api/index.js                      # MODIFIED — 캐릭터 API 함수 4개 추가
├── src/pages/MyMusicPage.jsx             # MODIFIED — "내 캐릭터" 탭 + CharacterSection 컴포넌트
├── src/pages/MyMusicPage.css             # MODIFIED — 캐릭터 섹션 스타일
├── src/pages/UploadPage.jsx              # MODIFIED — 캐릭터 토글 + 씬 프롬프트 입력란
├── src/pages/UploadPage.css              # MODIFIED — 캐릭터 토글 + 씬 프롬프트 스타일
```

### 구현 순서

```
Phase 1: 백엔드 캐릭터 인프라 (독립)
  1. character_generator.py 생성
  2. character.py 라우터 생성
  3. main.py에 라우터 등록

Phase 2: 백엔드 캐릭터 통합
  4. cover_generator.py 수정 (character_image_bytes)
  5. upload.py 수정 (character_object_name 전달)
  6. mv_generator.py 수정 (user_scene_prompt + character_image_bytes)
  7. mv_pipeline.py 수정 (캐릭터 로드 + 전달)
  8. mv.py 수정 (scene_prompt + character_object_name)

Phase 3: 프론트엔드
  9. api/index.js — 캐릭터 API 함수
  10. MyMusicPage.jsx + CSS — 내 캐릭터 탭
  11. UploadPage.jsx + CSS — 캐릭터 토글 + 씬 프롬프트
```

---

## v2.9 — Kling 영상 모델 통합

### 목표
MV 영상 생성 시 Veo 3.1(Google) 외에 Kling v1(Kling AI) 모델을 선택할 수 있도록 지원.
음악 생성에서 YuE/Suno를 선택하는 것처럼, 영상 모델도 Veo/Kling 중 선택 가능.

### 변경 파일

#### 백엔드
```
├── backend/app/config.py                        # MODIFIED — kling_access_key, kling_secret_key 추가
├── backend/.env                                 # MODIFIED — KLING_ACCESS_KEY, KLING_SECRET_KEY 추가
├── backend/app/services/kling_video_generator.py # NEW — Kling API 서비스
│   ├── _generate_jwt_token()      — JWT 토큰 생성 (HS256)
│   ├── start_scene_video_kling()  — image-to-video 요청, task_id 반환
│   ├── check_scene_video_status_kling() — 상태 확인
│   └── download_video_kling()     — 영상 다운로드
├── backend/app/routes/mv.py                     # MODIFIED
│   ├── CreateMVRequest.video_model 필드 추가 ("veo" | "kling")
│   ├── GenerateVideosRequest.video_model 필드 추가
│   ├── create_mv() — video_model 검증 + job_doc 저장
│   ├── generate_videos() — video_model 분기 + pipeline 전달
│   ├── get_mv_job() — video_model 응답 포함
│   └── GET /api/mv/models — 사용 가능한 영상 모델 목록
├── backend/app/services/mv_pipeline.py          # MODIFIED
│   ├── kling_video_generator import 추가
│   └── run_phase3_videos() — video_model 파라미터 + Kling/Veo 분기
```

#### 프론트엔드
```
├── frontend/src/api/index.js                    # MODIFIED — generateMVVideos에 videoModel 파라미터, getMVModels 추가
├── frontend/src/pages/UploadPage.jsx            # MODIFIED — videoModel state, 모델 선택 카드 UI
├── frontend/src/pages/UploadPage.css            # MODIFIED — 영상 모델 선택 카드 스타일
```

### Kling API 스펙
- **Base URL**: `https://api.klingai.com`
- **인증**: JWT 토큰 (HS256, 30분 유효)
- **Image-to-Video**: `POST /v1/videos/image2video`
- **상태 확인**: `GET /v1/videos/image2video/{task_id}`
- **응답**: `task_status` = submitted | processing | succeed | failed

### 구현 순서
```
Phase 1: 백엔드 Kling 인프라
  1. config.py — kling_access_key, kling_secret_key
  2. .env — KLING_ACCESS_KEY, KLING_SECRET_KEY
  3. kling_video_generator.py 신규 생성

Phase 2: 백엔드 파이프라인 통합
  4. mv.py — CreateMVRequest/GenerateVideosRequest에 video_model 추가
  5. mv.py — create_mv()에 video_model 저장, generate_videos()에 분기
  6. mv.py — GET /api/mv/models 엔드포인트
  7. mv_pipeline.py — run_phase3_videos()에 video_model 분기

Phase 3: 프론트엔드
  8. api/index.js — generateMVVideos videoModel 파라미터, getMVModels
  9. UploadPage.jsx — videoModel state + 모델 선택 카드 UI
  10. UploadPage.css — 영상 모델 선택 카드 스타일
```

---

## v2.9.1 — 모델별 씬 계산 + 스토리 아크

### 변경 사항

#### A. 영상 모델별 씬 개수 동적 계산
- 영상 모델 선택을 STEP 1 (씬 생성 전)으로 이동
- 씬 개수 계산 로직: `ceil(음악길이 / 클립길이)`
  - Veo: 클립 8초 → `ceil(audio_duration / 8)`
  - Kling: 클립 10초 → `ceil(audio_duration / 10)`
- 씬 생성 후 모델 변경 불가 (STEP 2에서는 읽기 전용 표시)

#### B. Kling duration "5" → "10" 변경
- `kling_video_generator.py`: `"duration": "5"` → `"duration": "10"`
- `mv.py` GET /api/mv/models: Kling 설명을 "10초"로 업데이트

#### C. 씬 분할 프롬프트에 스토리 아크 추가
- `SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE`: 도입-전개-클라이맥스-결말 구조 지시 추가
- `SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE`: 동일한 스토리 아크 지시 추가
- 시각적 연속성 규칙 추가 (setting, lighting, character 일관성)

### 수정 파일
```
백엔드:
  1. mv.py — video_model 검증을 scene_count 계산 전으로 이동, 모델별 CLIP_DURATION 분기
  2. kling_video_generator.py — duration "5" → "10"
  3. mv_generator.py — 두 프롬프트 템플릿에 스토리 아크 + 시각 연속성 지시 추가

프론트엔드:
  4. UploadPage.jsx — 영상 모델 선택 UI를 STEP 1로 이동, STEP 2에서는 읽기 전용 표시
```

---

## v1 - 2026-03-23 - 폴더명 변경 영향 점검 및 수정
### 요청 작업
상위 폴더명 1_oneCompany → 1_tripleJ 변경에 따른 코드 점검 및 수정

### 점검 결과
- **전체 코드베이스 검색** (소스코드, 설정파일, docker-compose, package.json, requirements.txt, import문 등)
- `1_oneCompany` 또는 `oneCompany` 문자열 발견: **1건**
  - `backend/.env` 41~42번째 줄: `YUE_MODEL_DIR`, `YUE_OUTPUT_DIR` 절대 경로에 `1_oneCompany` 하드코딩
- 프론트엔드 소스코드: 해당 문자열 없음 (문제 없음)
- 백엔드 소스코드(app/): 해당 문자열 없음 (문제 없음)
- docker-compose.yml: 해당 문자열 없음 (상대경로 사용)
- package.json, requirements.txt: 해당 문자열 없음
- .env.example: 상대경로 사용, 문제 없음
- vite.config.js: 절대경로 미사용, 문제 없음

### 프론트엔드 에이전트 할당 업무
- 수정 사항 없음 (프론트엔드 코드에 영향 없음)

### 백엔드 에이전트 할당 업무
- `backend/.env` 파일의 `YUE_MODEL_DIR`, `YUE_OUTPUT_DIR` 경로를 `1_oneCompany` → `1_tripleJ`로 수정 (**완료**)

### 테스터 에이전트 테스트 항목
- [ ] 백엔드 서버(port 9000) 정상 기동 확인
- [ ] 프론트엔드 서버(port 4000) 정상 기동 확인
- [ ] 프론트엔드 → 백엔드 API 호출 정상 동작 확인
- [ ] 주요 기능 동작 확인 (페이지 로드, API 응답 등)
- [ ] .env 환경변수 로드 정상 확인 (YUE_MODEL_DIR, YUE_OUTPUT_DIR 경로)

## v2 - 2026-03-23 - Voice Persona (내 목소리) 기능 추가
### 요청 작업
- 내 캐릭터 탭에 목소리 추가 기능
- 목소리 파일 업로드 → Suno Persona 자동 생성 (4단계 워크플로우)
- 작업실2에서 내 Persona 보컬 선택 가능

### 워크플로우 (Suno 써드파티 API)
1. 사용자가 노래 파일(mp3/wav) 업로드 → MinIO 저장 → presigned URL 생성
2. upload-cover API: presigned URL → Suno AI 커버 곡 생성 (내 목소리 톤 반영)
3. separate-vocals API: AI 커버 곡에서 보컬 스템 추출
4. generate-persona API: 추출된 보컬로 Suno Persona 생성

### MongoDB 컬렉션 설계: voice_personas
```json
{
  "_id": ObjectId,
  "user_id": "uuid",
  "name": "내 목소리 1",
  "description": "따뜻한 남성 보컬",
  "persona_id": "suno-persona-id",
  "status": "pending|uploading|covering|separating|creating_persona|completed|failed",
  "progress": 0-100,
  "error_message": null,
  "source_audio_object": "voice-personas/{user_id}/{uuid}.mp3",
  "cover_task_id": null,
  "cover_audio_url": null,
  "separate_task_id": null,
  "vocal_audio_url": null,
  "persona_task_id": null,
  "created_at": datetime,
  "updated_at": datetime
}
```

### 백엔드 작업
1. **새 서비스 파일**: `backend/app/services/voice_persona_service.py`
   - Suno API 4단계 워크플로우 구현 (upload-cover → separate-vocals → generate-persona)
   - 각 단계별 상태/진행률 업데이트
   - 폴링 로직으로 각 API 완료 대기

2. **새 라우트 파일**: `backend/app/routes/voice_persona.py`
   - POST `/api/voice-persona/create` - 음성 파일 업로드 + Persona 생성 시작
   - GET `/api/voice-persona/list` - 내 Persona 목록 조회
   - GET `/api/voice-persona/{id}` - Persona 상태 조회
   - DELETE `/api/voice-persona/{id}` - Persona 삭제

3. **generate.py 수정**: GenerateRequest에 persona_id 필드 추가, Suno 생성 시 전달
4. **suno_generator.py 수정**: persona_id 파라미터 지원
5. **main.py 수정**: voice_persona 라우터 등록

### 프론트엔드 작업
1. **api/index.js**: Voice Persona API 함수 추가
2. **MyMusicPage.jsx (CharacterSection)**: 목소리 추가 UI
   - 음성 파일 업로드 영역
   - Persona 이름/설명 입력
   - 생성 진행률 표시
   - 내 Persona 목록 표시 (삭제 가능)
3. **StudioTab2.jsx**: 보컬 선택에 "내 목소리" 옵션 추가
   - Persona 목록 fetch → 보컬 프리셋에 동적 추가
   - Persona 선택 시 persona_id를 generation 요청에 포함

### 테스터 테스트 항목
- [ ] 내 캐릭터 탭에서 음성 파일 업로드 가능 확인
- [ ] Persona 생성 요청 정상 동작 (4단계 상태 전이)
- [ ] Persona 목록 조회 정상 동작
- [ ] Persona 삭제 정상 동작
- [ ] 작업실2에서 Persona 보컬 선택 옵션 노출 확인
- [ ] Persona 선택 후 음악 생성 시 persona_id 전달 확인
- [ ] 백엔드 서버(port 9000) 정상 기동 확인
- [ ] 프론트엔드 서버(port 4000) 정상 기동 확인

---

## v3 — Voice Persona 보컬/커버 미리듣기 및 다운로드

### 배경
Voice Persona 4단계 워크플로우 완료 후 cover_audio_url, vocal_audio_url은 Suno 임시 URL이라 시간이 지나면 만료됨. 보컬/커버 오디오를 MinIO에 영구 저장하고 미리듣기/다운로드 기능을 추가해야 함.

### 백엔드 구현 계획

1. **voice_persona_service.py** — 보컬 분리 성공 후 vocal_url, cover_audio_url을 MinIO에 다운로드/저장
   - 저장 경로: `voice-personas/{user_id}/{persona_id}/vocal.mp3`, `voice-personas/{user_id}/{persona_id}/cover.mp3`
   - 버킷: settings.minio_bucket_music
   - MongoDB에 `vocal_object_name`, `cover_object_name` 필드 추가

2. **voice_persona.py 라우트** — 스트리밍/다운로드 엔드포인트 추가
   - `GET /api/voice-persona/{id}/vocal/stream` — 보컬 스트리밍 (미리듣기)
   - `GET /api/voice-persona/{id}/cover/stream` — 커버 스트리밍
   - `GET /api/voice-persona/{id}/vocal/download` — 보컬 다운로드
   - `GET /api/voice-persona/{id}/cover/download` — 커버 다운로드
   - list/get API 응답에 `vocal_url`, `cover_url` (presigned URL), `has_vocal`, `has_cover` 필드 추가
   - delete 시 vocal/cover MinIO 객체도 함께 삭제

### 프론트엔드 구현 계획

1. **MyMusicPage.jsx** VoicePersonaSection — 보컬/커버 재생 및 다운로드 버튼
2. **MyMusicPage.css** — 오디오 액션 버튼 스타일
3. **api/index.js** — stream/download URL 헬퍼 추가

### 테스터 테스트 항목
- [ ] 완료된 Persona에서 보컬 미리듣기 재생 가능
- [ ] 완료된 Persona에서 커버 미리듣기 재생 가능
- [ ] 보컬 다운로드 버튼 정상 동작
- [ ] 커버 다운로드 버튼 정상 동작
- [ ] Persona 삭제 시 MinIO 저장 파일도 함께 삭제
- [ ] 새로 생성하는 Persona의 보컬/커버가 MinIO에 영구 저장

---

## v4 — Kits.AI 보컬 변환 (Voice Conversion) 기능

### 목표
Suno에서 생성된 음악의 보컬을 사용자의 Kits.AI 목소리 모델로 교체하는 기능 구현

### 기술 스택
- **Kits.AI API**: 보컬/반주 분리 (Vocal Separation) + 음성 변환 (Voice Conversion)
- **ffmpeg**: 변환된 보컬 + 반주 합치기
- **MinIO**: 결과 파일 저장
- **MongoDB**: 변환 상태/결과 추적

### 백엔드 구현 계획

#### 1. 설정 추가
- `.env`: `KITS_API_KEY`, `KITS_API_URL`
- `app/config.py`: `kits_api_key`, `kits_api_url` 설정 필드

#### 2. `app/services/kits_service.py` (신규)
- `convert_voice(generation_id, voice_model_id, mongo_db)` — 전체 파이프라인:
  a. MinIO에서 Suno 출력 다운로드
  b. Kits API: POST /vocal-separations (보컬/반주 분리) + 폴링
  c. 분리된 보컬/반주 다운로드
  d. Kits API: POST /voice-conversions (보컬→사용자 목소리) + 폴링
  e. 변환된 보컬 다운로드
  f. ffmpeg amix로 변환 보컬 + 반주 합치기
  g. 결과 MinIO 업로드: `generated/{id}/voice_converted.mp3`
  h. MongoDB 업데이트
- `get_voice_models()` — Kits API 모델 목록 조회
- `_poll_kits_job()` — 상태 폴링 헬퍼 (진행률 MongoDB 반영)
- ffmpeg 경로: `shutil.which` → miniconda fallback → `imageio_ffmpeg`

#### 3. `app/routes/voice_convert.py` (신규)
- `POST /api/voice-convert/{generation_id}` — 변환 시작 (BackgroundTasks)
- `GET /api/voice-convert/{generation_id}/status` — 상태 조회
- `GET /api/voice-convert/{generation_id}/stream` — 변환 결과 스트리밍
- `GET /api/voice-convert/{generation_id}/download` — 변환 결과 다운로드
- `GET /api/kits/voice-models` — Kits 모델 목록 프록시

#### 4. `app/main.py` — voice_convert 라우터 등록

### 프론트엔드 구현 계획

#### 1. `api/index.js`
- `startVoiceConvert()`, `getVoiceConvertStatus()`, `getKitsVoiceModels()`
- `voiceConvertStreamUrl()`, `voiceConvertDownloadUrl()` 헬퍼

#### 2. `StudioTab2.jsx`
- 완료된 Suno 생성 카드에 "내 목소리로 변환" 버튼
- 변환 중 진행률 표시 (프로그레스바)
- 변환 완료 시 재생/다운로드 버튼
- Kits 모델 선택 모달 (강도, 볼륨 믹스, 피치 조절 옵션)

### MongoDB generations 컬렉션 추가 필드
- `voice_conversion_status`: pending | converting | merging | uploading | completed | failed
- `voice_conversion_progress`: 0~100
- `voice_conversion_error`: 에러 메시지
- `voice_converted_url`: MinIO 오브젝트 경로
- `voice_converted_backing_url`: 반주 트랙 경로
- `voice_model_id`: 사용된 Kits 모델 ID
- `voice_conversion_completed_at`: 완료 시간

### 테스트 항목
- [ ] Kits 모델 목록 조회 정상 동작
- [ ] Suno 완료 카드에서 "내 목소리로 변환" 버튼 표시
- [ ] 변환 시작 후 진행률 실시간 표시
- [ ] 변환 완료 후 재생/다운로드 정상 동작
- [ ] 변환 실패 시 에러 메시지 표시 + 재시도 가능
- [ ] 이미 변환 중일 때 중복 요청 방지

---

## v5 — 내 목소리 섹션 분리 (우회 방식 / Kits.AI)

### 목표
"내 캐릭터" 탭의 "내 목소리" 섹션을 **우회 방식**(Suno Persona)과 **Kits.AI** 두 서브탭으로 분리하고,
작업실2의 "내 목소리로 변환" 모달에서도 두 그룹을 구분하여 표시한다.

### 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `frontend/src/pages/MyMusicPage.jsx` | VoicePersonaSection에 서브탭(suno/kits) 추가, Kits.AI 모델 목록 조회 및 표시 |
| `frontend/src/pages/MyMusicPage.css` | 서브탭 스타일(.vp-subtabs, .vp-subtab), Kits.AI 탭 스타일(.vp-kits) 추가 |
| `frontend/src/components/StudioTab2.jsx` | VC 모달에 두 그룹(우회 방식/Kits.AI) 표시, 선택 타입에 따른 분기 처리 |
| `frontend/src/components/StudioTab2.css` | 그룹 헤더 스타일(.s2__vc-group-header) 추가 |

### 구현 상세

#### 1. MyMusicPage — VoicePersonaSection
- `voiceSubTab` state 추가 ('suno' | 'kits')
- **우회 방식 탭**: 기존 Persona CRUD 로직 그대로 유지
- **Kits.AI 탭**: `getKitsVoiceModels()` 호출하여 모델 목록 표시, demoUrl 있으면 미리듣기, 하단에 kits.ai 모델 생성 링크

#### 2. StudioTab2 — VC 모달
- `vcSelectedType` state 추가 ('suno_persona' | 'kits')
- 모달 내 목소리 목록을 두 그룹으로 분리 (그룹 헤더로 구분)
- 우회 방식 선택 시: 원곡의 가사/스타일을 복사하여 persona_id로 새 Suno 생성
- Kits.AI 선택 시: 기존 voice-convert API로 보컬분리→변환→합치기
- 고급 설정(강도, 볼륨, 피치)은 Kits.AI 선택 시에만 표시

### 테스트 항목
- [ ] 내 캐릭터 > 내 목소리 섹션에 "우회 방식" / "Kits.AI" 서브탭 표시
- [ ] 우회 방식 탭: 기존 Persona 업로드/목록/미리듣기/삭제 정상 동작
- [ ] Kits.AI 탭: 모델 목록 자동 조회 및 표시
- [ ] Kits.AI 탭: demoUrl 있는 모델 미리듣기 가능
- [ ] Kits.AI 탭: 하단 안내 문구 및 모델 생성 링크 표시
- [ ] 작업실2 VC 모달: 두 그룹(우회 방식/Kits.AI) 구분 표시
- [ ] 우회 방식 선택 시 Suno persona로 새 곡 생성
- [ ] Kits.AI 선택 시 기존 voice-convert API 호출

---

## v6 — 업로드 페이지: 원본/내 목소리 버전 오디오 소스 선택

### 목표
작업실2에서 "업로드하기" 버튼을 눌러 업로드 페이지로 넘어갈 때, voice conversion이 완료된 곡이라면 **원본(AI 보컬)** 또는 **내 목소리 버전** 중에서 선택하여 업로드할 수 있게 한다. 선택한 오디오를 미리 재생할 수 있다.

### 변경 파일

1. **`frontend/src/components/StudioTab2.jsx`**
   - `onSendToUpload` 호출 시 `hasVoiceConverted: gen.voice_conversion_status === 'completed'` 플래그 추가

2. **`frontend/src/pages/MyMusicPage.jsx`**
   - 변경 불필요 (`handleSendToUpload`가 genData를 그대로 전달)

3. **`frontend/src/pages/UploadPage.jsx`**
   - `hasVoiceConverted`, `useVoiceConverted` state 추가
   - prefill useEffect에서 `hasVoiceConverted` 설정
   - 오디오 소스 선택 UI (원본 / 내 목소리 버전 버튼)
   - `<audio>` 태그의 src를 선택에 따라 원본 스트림 또는 voice-convert 스트림으로 전환
   - `uploadFromGeneration` 호출 시 `use_voice_converted` 파라미터 추가
   - `getAudioDuration`에서 선택된 소스 사용
   - `handleMergeAudio`에서 voice_converted_url 지원

4. **`frontend/src/pages/UploadPage.css`**
   - `.upload-card__audio-source-selector` 및 관련 스타일 추가

5. **`backend/app/routes/tracks.py`**
   - `UploadFromGenerationBody`에 `use_voice_converted: Optional[bool] = False` 추가
   - `upload_from_generation` 엔드포인트에서 `use_voice_converted`가 true면 `voice_converted_url`에서 MinIO 파일 복사

### 체크리스트
- [x] StudioTab2에서 hasVoiceConverted 플래그 전달
- [x] UploadPage에서 오디오 소스 선택 UI 표시
- [x] 선택에 따라 미리 재생 가능 (audio 태그 src 전환)
- [x] 업로드 시 use_voice_converted 파라미터 전달
- [x] 백엔드에서 voice_converted_url 기반 파일 복사 지원
- [x] MV 합치기 시 선택된 오디오 소스 반영

---

## v7 — 뮤직비디오 생성 파이프라인: 음악 구조 싱크 개선

### 목표
뮤직비디오 생성 시 음악 구조(Intro/Verse/Chorus 등)에 맞춰 영상 씬 전환이 싱크되도록 파이프라인을 개선한다. Gemini API로 음악 파일을 분석하여 섹션 구조를 추출하고, 이를 기반으로 ChatGPT가 섹션별 클립 계획을 수립한다.

### 변경 파일

#### 1. `backend/app/services/mv_generator.py`
- **신규 함수** `analyze_music_structure(audio_bytes, mime_type)`: Gemini에 오디오를 보내 섹션 구조 분석 (label, start, end, mood)
- **신규 함수** `trim_video_clip(input_path, output_path, duration)`: ffmpeg로 영상 클립을 지정 시간만큼 트림
- **신규 프롬프트** `SECTION_SCENE_PLAN_SYSTEM_PROMPT`: 섹션 구조 기반 씬 계획 프롬프트
- **신규 함수** `_split_with_music_sections()`: 섹션 구조 기반 ChatGPT 씬 계획 (내부 함수)
- **수정 함수** `split_lyrics_into_scenes()`: `music_sections` 파라미터 추가, 있으면 섹션 기반 계획 수행

#### 2. `backend/app/services/mv_pipeline.py`
- **신규 함수** `_load_audio_from_minio()`: MinIO 음악 버킷에서 오디오 로드
- **신규 함수** `_resolve_audio_object_name()`: job 또는 연결된 generation에서 오디오 경로 해석
- **수정 함수** `run_phase1_split()`:
  - 오디오 파일이 있으면 먼저 `analyze_music_structure()` 호출
  - 결과를 `music_sections`로 MongoDB에 저장
  - `split_lyrics_into_scenes()`에 `music_sections` 전달
  - scenes 배열에 `use_seconds`, `section`, `section_mood`, `clip_mood` 필드 추가
- **수정** `run_phase3_videos()`: 영상 생성 후 `use_seconds` 필드가 있으면 ffmpeg trim 수행

#### 3. `backend/app/routes/mv.py`
- `CreateMVRequest`에 `audio_generation_id` 필드 추가
- job_doc 생성 시 `audio_generation_id` 저장
- `_scene_to_dict()`에 `use_seconds`, `section`, `section_mood`, `clip_mood` 필드 추가
- job detail 응답에 `music_sections` 필드 추가

#### 4. `frontend/src/pages/UploadPage.jsx`
- `createMVJob` 호출 시 `audio_generation_id` 전달
- 씬 카드에 section label, use_seconds, section_mood 정보 표시

#### 5. `frontend/src/pages/UploadPage.css`
- `.upload-mv-scene-card__section-info`, `__section-label`, `__use-seconds`, `__section-mood` 스타일 추가

### 파이프라인 흐름

```
Phase 1a: Gemini 음악 구조 분석 (audio → sections JSON)
    ↓
Phase 1b: ChatGPT 섹션 기반 씬 계획 (sections + lyrics → clips)
    ↓
Phase 2: 씬 이미지 생성 (Gemini, 기존과 동일)
    ↓
Phase 3: 씬 영상 생성 (Veo/Kling) + ffmpeg trim(use_seconds)
    ↓
Phase 4: 트림된 클립 이어붙이기 (ffmpeg concat)
    ↓
Phase 5: 오디오 합치기 (기존과 동일)
```

### 호환성
- `music_sections`가 없으면(오디오 없음/분석 실패) 기존 flat scene 분할로 fallback
- `use_seconds` 필드가 없는 기존 씬은 trim 없이 그대로 사용
- 기존 MV job은 영향 없음

### 체크리스트
- [x] `analyze_music_structure()` 함수 구현
- [x] `trim_video_clip()` 함수 구현
- [x] 섹션 기반 씬 계획 프롬프트 및 로직
- [x] `run_phase1_split()` 음악 구조 분석 단계 추가
- [x] `run_phase3_videos()` 트림 단계 추가
- [x] `_scene_to_dict()` 섹션 정보 필드 추가
- [x] 프론트엔드 씬 카드에 섹션 정보 표시
- [x] 기존 MV job 호환성 유지

---

## v8 — 캐릭터 시트 생성 마스터 프롬프트 적용

### 배경
기존 캐릭터 시트 생성은 단일 Gemini 이미지 모델 호출로 하드코딩된 프롬프트를 사용했다. 결과물의 품질과 일관성이 부족했다. 마스터 프롬프트(전문가가 설계한 다단계 캐릭터 시트 생성 절차)를 도입하여 고품질 캐릭터 시트를 생성한다.

### 핵심 변경: 2단계 프로세스

#### Step A — Gemini 텍스트 모델로 캐릭터 시트 프롬프트 생성
- **모델**: `gemini-2.5-flash` (텍스트 전용)
- **입력**: 마스터 프롬프트 전체 + 원본 사진 (inlineData) + 미리 작성된 답변
  - STEP 1 답변: "첨부된 사진 속 인물의 외모 특징을 분석하여 사용"
  - STEP 2 답변: "Photorealistic (실사)"
- **출력**: 코드블록 안의 완전한 캐릭터 시트 프롬프트 텍스트
- Gemini가 사진을 분석하여 Identity, Body, Face, Hair, Outfit 등 모든 항목을 상세하게 채움

#### Step B — Gemini 이미지 모델로 캐릭터 시트 이미지 생성
- **모델**: `gemini-3-pro-image-preview` (나노바나나 Pro)
- **입력**: Step A에서 생성된 캐릭터 시트 프롬프트 + 원본 사진 (참조 이미지)
- **출력**: PNG 캐릭터 시트 이미지

### 수정 파일

#### 1. `backend/app/services/character_generator.py` (전면 재작성)
- 마스터 프롬프트를 `MASTER_PROMPT` 상수로 하드코딩
- `_call_gemini_text()`: Gemini 텍스트 모델 호출 (Step A)
- `_call_gemini_image()`: Gemini 이미지 모델 호출 (Step B)
- `_extract_code_block()`: 응답에서 코드블록 추출
- `generate_character_sheet()`: 기존 시그니처 유지, 내부를 2단계 프로세스로 변경

### 프론트엔드
- 변경 없음 (백엔드 함수 시그니처 동일)

### 라우트
- 변경 없음 (`routes/character.py` 그대로)

### 체크리스트
- [x] 마스터 프롬프트 txt 파일 내용 확인 및 코드에 포함
- [x] `_call_gemini_text()` 구현 (gemini-2.5-flash)
- [x] `_call_gemini_image()` 구현 (gemini-3-pro-image-preview)
- [x] `generate_character_sheet()` 2단계 프로세스로 재작성
- [x] 함수 시그니처 유지 (라우트 변경 불필요)
- [x] 기존 단일 호출 대비 품질 향상 기대

---

## v9 — 캐릭터 시트 의상 이미지 선택적 첨부 (8가지 프롬프트 분기)

### 목표
캐릭터 시트 생성 시, 사용자가 상의/하의/신발 이미지를 선택적으로 첨부하면, 첨부 조합(000~111)에 따라 8가지 STEP 1 답변 중 적합한 것을 선택하여 캐릭터 시트를 생성한다.

### 설계
- 분기 키: `key = f"{1 if top else 0}{1 if bottom else 0}{1 if shoes else 0}"` → "000"~"111"
- 마스터 프롬프트 전체와 STEP 2 답변("Photorealistic 실사")은 항상 동일
- STEP 1 답변 부분만 8가지로 분기
- 각 프롬프트에서 "두번째/세번째/네번째 이미지" 순서는 실제 첨부 순서(사진→상의→하의→신발)에 대응

### 백엔드
1. `backend/app/services/character_generator.py`
   - `STEP1_ANSWERS` 딕셔너리 (8가지 답변)
   - `_build_inline_images()` 헬퍼 (사진 + 의상 이미지 동적 구성)
   - `_call_gemini_text()`, `_call_gemini_image()` 시그니처를 image_parts 리스트로 변경
   - `generate_character_sheet()` 시그니처에 top/bottom/shoes 파라미터 추가

2. `backend/app/routes/character.py`
   - `generate_sheet` 엔드포인트에 `top_image`, `bottom_image`, `shoes_image` 옵션 파라미터 추가
   - `_read_optional_image()` 헬퍼 함수

### 프론트엔드
1. `frontend/src/pages/MyMusicPage.jsx`
   - `topFile`, `bottomFile`, `shoesFile` 상태 추가
   - 의상 업로드 영역 3개 (상의/하의/신발) 나란히 배치
   - 각각 미리보기 + X(제거) 버튼
   - FormData에 의상 파일 포함하여 API 전송

2. `frontend/src/pages/MyMusicPage.css`
   - `.mymusic-character__outfit-*` 스타일 추가

3. `frontend/src/api/index.js`
   - 변경 없음 (기존 FormData 방식 그대로 활용)

### 체크리스트
- [x] STEP1_ANSWERS 8가지 딕셔너리 정의
- [x] _build_inline_images() 헬퍼 구현
- [x] _call_gemini_text/image 시그니처 image_parts 리스트로 변경
- [x] generate_character_sheet() 시그니처 확장 (top/bottom/shoes)
- [x] routes/character.py에 옵션 파일 파라미터 추가
- [x] 프론트엔드 의상 업로드 UI 구현
- [x] FormData에 의상 파일 포함
- [x] 상태 초기화 로직 (save/regenerate 시 outfit 파일도 클리어)

---

## v10 — 캐릭터 시트 수정 요청 (Refine) 기능

### 목표
캐릭터 시트 생성 후 미리보기 상태에서, 사용자가 수정 요청 텍스트를 입력하면 현재 캐릭터 시트 이미지 + 원본 사진을 Gemini에 다시 보내서 수정된 캐릭터 시트를 생성. 반복 수정 가능.

### 백엔드

1. `backend/app/services/character_generator.py`
   - `refine_character_sheet()` 함수 추가
   - 현재 시트 이미지(PNG) + 원본 사진 + 수정 요청 텍스트 → Gemini image model → 수정된 시트 이미지
   - 기존 `_call_gemini_image()` 재활용

2. `backend/app/routes/character.py`
   - `POST /api/character/refine` 엔드포인트 추가
   - 파라미터: `sheet_image` (UploadFile), `photo` (UploadFile), `refine_request` (str Form)
   - 수정된 이미지를 MinIO temp에 저장, preview_url + object_name 반환

### 프론트엔드

1. `frontend/src/api/index.js`
   - `refineCharacterSheet(formData)` 함수 추가

2. `frontend/src/pages/MyMusicPage.jsx` — CharacterSection
   - state 추가: `refineMode`, `refineText`, `refining`
   - 미리보기 상태에서 [수정 요청] 버튼 추가
   - 클릭 시 textarea + [수정 적용하기] 버튼 표시
   - 현재 미리보기 이미지를 fetch → blob, photoFile, refineText를 FormData로 `/api/character/refine` POST
   - 응답으로 미리보기 교체 (반복 수정 가능)

3. `frontend/src/pages/MyMusicPage.css`
   - `.mymusic-character__refine` 관련 스타일 추가

### 체크리스트
- [x] refine_character_sheet() 서비스 함수 구현
- [x] POST /api/character/refine 엔드포인트 구현
- [x] refineCharacterSheet API 함수 추가
- [x] 프론트엔드 수정 요청 UI (버튼 + textarea + 적용 버튼)
- [x] 반복 수정 지원 (수정 결과가 새 미리보기로 교체)
- [x] 상태 초기화 로직 (save/regenerate/cancel 시 refine 상태도 클리어)
- [x] CSS 스타일 추가

---

## v11 — 캐릭터 시트 생성 시 사용자 텍스트 입력 지원 (16가지 프롬프트 분기)

### 목적
캐릭터 시트 생성 시, 사용자가 캐릭터 특징을 텍스트로 직접 입력할 수 있게 한다. 기존 8가지 프롬프트(의상 조합)에 텍스트 유무를 추가하여 총 16가지 프롬프트로 분기한다.

### 분기 키 설계
```
key = f"{1 if user_text else 0}_{1 if top else 0}{1 if bottom else 0}{1 if shoes else 0}"
```
- 텍스트 없음 (0_xxx): 기존 8가지와 동일, 변경 없음
- 텍스트 있음 (1_xxx): 기존 프롬프트 + 사용자 텍스트 우선 반영 문구 추가
- user_text가 비어있으면 key가 "0_xxx"가 되므로 기존과 완전히 동일하게 동작

### 백엔드 수정

1. `backend/app/services/character_generator.py`
   - `STEP1_ANSWERS` 딕셔너리 8개 → 16개 확장 (키 형식: "0_000"~"0_111", "1_000"~"1_111")
   - `_USER_TEXT_SUFFIX` 상수 추가 — `{user_text}` 플레이스홀더 포함
   - `generate_character_sheet()` 에 `user_text: str = ""` 파라미터 추가
   - 분기 키 계산: `"{text_flag}_{top}{bottom}{shoes}"`
   - 선택된 프롬프트에서 `.format(user_text=user_text)` 으로 치환

2. `backend/app/routes/character.py`
   - `generate_sheet` 엔드포인트에 `user_text: str = Form("")` 파라미터 추가
   - `generate_character_sheet()` 호출 시 `user_text=user_text.strip()` 전달

### 프론트엔드 수정

1. `frontend/src/pages/MyMusicPage.jsx` — CharacterSection
   - `characterText` state 추가
   - 사진 업로드 영역과 의상 이미지 영역 사이에 textarea 추가
   - FormData에 `user_text` 추가
   - handleSave, handleRegenerate 시 `characterText` 초기화

2. `frontend/src/pages/MyMusicPage.css`
   - `.mymusic-character__text-section`, `__text-label`, `__text-input` 스타일 추가

### 체크리스트
- [x] STEP1_ANSWERS 16개로 확장 (0_xxx 기존 유지, 1_xxx 텍스트 블록 추가)
- [x] _USER_TEXT_SUFFIX 상수 정의
- [x] generate_character_sheet() user_text 파라미터 추가
- [x] 분기 키 계산 로직 변경
- [x] .format(user_text=...) 치환 로직
- [x] POST /generate-sheet 엔드포인트 user_text Form 파라미터 추가
- [x] 프론트엔드 characterText state + textarea UI
- [x] FormData에 user_text append
- [x] 상태 초기화 로직 (save/regenerate 시 characterText 클리어)
- [x] CSS 스타일 추가

---

## v12 — 마스터 프롬프트 구조 개선: 답변을 질문 바로 뒤에 삽입

### 배경
기존에는 STEP 1/2 답변을 마스터 프롬프트 앞에 별도 블록으로 배치하고, 마스터 프롬프트 원본을 그 뒤에 통째로 붙였다. 이 구조는 LLM이 답변과 질문을 매칭하기 어렵게 만들 수 있다.

### 목표
마스터 프롬프트 안에서 STEP 1, STEP 2 질문 바로 뒤에 사용자 답변이 인라인으로 삽입되도록 변경한다.

### 수정 대상
- `backend/app/services/character_generator.py`

### 수정 내용

#### 1. MASTER_PROMPT 상수 수정
- STEP 1: "사용자의 답변이 오기 전에는..." 문구 제거, `[사용자 답변]: {step1_answer}` 플레이스홀더 삽입
- STEP 2: "사용자의 답변이 오기 전에는..." 문구 제거, `[사용자 답변]: Photorealistic (실사)` 고정 답변 삽입
- STEP 4~8, CHARACTER SHEET TEMPLATE 등 나머지는 원본 그대로 유지
- MASTER_PROMPT 안에 `{step1_answer}` 외 중괄호 없음 확인 완료 (이스케이프 불필요)

#### 2. step_a_prompt 조립 방식 변경
- 기존: 답변 블록 + "=== 마스터 프롬프트 ===" + MASTER_PROMPT 를 `.format(step1_answer, MASTER_PROMPT)` 로 조립
- 변경: 간결한 지시문 + `MASTER_PROMPT.format(step1_answer=step1_answer)` 로 인라인 치환

#### 3. 변경하지 않는 것
- STEP1_ANSWERS 딕셔너리 (16가지) — 그대로 유지
- `refine_character_sheet()` 함수
- `_call_gemini_text()`, `_call_gemini_image()`, `_build_inline_images()` 등 헬퍼 함수
- 프론트엔드 코드

### 체크리스트
- [x] MASTER_PROMPT STEP 1에 `{step1_answer}` 플레이스홀더 삽입
- [x] MASTER_PROMPT STEP 2에 고정 답변 "Photorealistic (실사)" 삽입
- [x] STEP 1/2 "사용자의 답변이 오기 전에는..." 문구 제거
- [x] step_a_prompt 조립: 답변 분리 블록 제거, MASTER_PROMPT.format() 인라인 치환으로 변경
- [x] 중괄호 충돌 없음 확인

---

## v13 — Git Pull 후 환경 복원 (2026-03-30)

### 배경
프로젝트 폴더를 삭제 후 Git에서 새로 pull 받은 상태이다. `.env` 파일은 `.gitignore`에 의해 제외되어 존재하지 않고, Docker 인프라도 재구성이 필요하다.

### 현재 상태 확인 결과
- `backend/.env` — **없음** (Git에서 pull 시 제외됨)
- `backend/app/config.py` — `kits_api_key`, `kits_api_url` 필드 **이미 존재** (수정 불필요)
- `backend/docker-compose.yml` — 환경변수 기반 설정 **정상**, MinIO 포트 매핑 `${MINIO_API_PORT:-9100}:9000` **정상**
- `backend/requirements.txt` — 의존성 목록 **정상**
- `frontend/package.json` — **존재** (npm install 필요)

### 작업 계획

총 6단계, 3개 에이전트가 병렬/순차로 수행한다.

---

#### STEP 1: backend/.env 파일 생성 [백엔드 에이전트]

`backend/.env` 파일을 아래 내용으로 생성한다. `config.py`의 `Settings` 클래스가 `env_file=".env"`로 자동 로드하므로 변수명은 config.py 필드명과 동일하게 맞춘다 (대소문자 무관, pydantic-settings가 case-insensitive 매칭).

```env
# === 인프라 서비스 ===

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=aimu
POSTGRES_USER=aimu_user
POSTGRES_PASSWORD=aimu_pass_2024

# MongoDB
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=aimu
MONGO_USER=aimu_user
MONGO_PASSWORD=aimu_pass_2024

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=aimu_pass_2024

# Elasticsearch
ES_HOST=localhost
ES_PORT=9200

# MinIO (호스트 포트 9100 -> 컨테이너 9000)
MINIO_HOST=localhost
MINIO_API_PORT=9100
MINIO_ACCESS_KEY=aimu_minio_admin
MINIO_SECRET_KEY=aimu_minio_pass_2024
MINIO_BUCKET_MUSIC=music-platform-audio
MINIO_BUCKET_IMAGES=music-platform-images

# === 인증 ===

# JWT
JWT_SECRET=aimu-platform-secret-key-2024
JWT_ALGORITHM=HS256

# === 외부 AI API 키 ===

# OpenAI
OPENAI_API_KEY=your-openai-api-key-here
OPENAI_MODEL=gpt-4o-mini

# Google Gemini
GOOGLE_API_KEY=your-google-api-key-here

# Kling AI
KLING_ACCESS_KEY=your-kling-access-key-here
KLING_SECRET_KEY=your-kling-secret-key-here

# Suno
SUNO_API_KEY=your-suno-api-key-here
SUNO_API_URL=https://api.sunoapi.org

# Kits.AI
KITS_API_KEY=your-kits-api-key-here
KITS_API_URL=https://arpeggi.io/api/kits/v1

# === YuE Music Generation ===
YUE_MODEL_DIR=/mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music/backend/YuEGP
YUE_OUTPUT_DIR=/mnt/d/1_projects/0_myProjects/1_tripleJ/0_platform_music/backend/yue_output
YUE_VRAM_PROFILE=4
YUE_PYTHON=/home/duckjk89/miniconda3/envs/yuegp/bin/python
```

**주의사항:**
- `MINIO_API_PORT=9100`으로 설정 — docker-compose.yml이 이 값을 호스트 포트로 사용하고 컨테이너 내부 9000에 매핑함
- config.py의 `minio_api_port` 기본값이 `9000`이므로, .env에서 `MINIO_API_PORT=9100`을 명시해야 docker-compose 포트 매핑과 일치함
- `MINIO_BUCKET_MUSIC`, `MINIO_BUCKET_IMAGES` 값이 config.py 기본값(`aimu-music`, `aimu-images`)과 다름 — .env 값이 우선 적용됨

---

#### STEP 2: Docker Compose로 인프라 서비스 시작 [백엔드 에이전트]

STEP 1 완료 후 수행한다. docker-compose.yml이 `.env`에서 환경변수를 자동으로 읽는다.

```bash
cd /mnt/d/projects/TripleJ/0_platform_music/backend
docker compose up -d
```

시작 후 헬스체크 확인:
```bash
docker compose ps
```

모든 5개 서비스(postgres, mongodb, redis, elasticsearch, minio)가 healthy 상태인지 확인한다.

**트러블슈팅:**
- 기존 볼륨이 다른 비밀번호로 초기화된 경우: `docker compose down -v && docker compose up -d` (볼륨 삭제 후 재생성)
- Elasticsearch 메모리 부족: `vm.max_map_count` 설정 확인 (`sudo sysctl -w vm.max_map_count=262144`)

---

#### STEP 3: 백엔드 의존성 설치 [백엔드 에이전트]

STEP 2와 병렬 수행 가능하다.

```bash
cd /mnt/d/projects/TripleJ/0_platform_music/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**참고:** 시스템 Python이 3.8인 경우 `google-genai` SDK가 설치 불가하지만, 이미 httpx 기반 REST API 호출로 대체되어 있으므로 문제없다 (requirements.txt 주석 참조).

---

#### STEP 4: 프론트엔드 의존성 설치 [프론트엔드 에이전트]

STEP 1~3과 병렬 수행 가능하다.

```bash
cd /mnt/d/projects/TripleJ/0_platform_music/frontend
npm install
```

---

#### STEP 5: 서버 시작 [백엔드 에이전트 + 프론트엔드 에이전트]

STEP 2, 3, 4 모두 완료 후 수행한다.

**백엔드 (포트 9000):**
```bash
cd /mnt/d/projects/TripleJ/0_platform_music/backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
```

**프론트엔드 (포트 4000):**
```bash
cd /mnt/d/projects/TripleJ/0_platform_music/frontend
npm run dev -- --port 4000
```

---

#### STEP 6: 검증 [테스터 에이전트]

STEP 5 완료 후 수행한다.

| # | 검증 항목 | 방법 | 기대 결과 |
|---|----------|------|----------|
| 1 | 백엔드 헬스 | `curl http://localhost:9000/docs` | Swagger UI 응답 |
| 2 | DB 연결 | `curl http://localhost:9000/api/songs` | 곡 목록 JSON |
| 3 | 프론트엔드 | 브라우저에서 `http://localhost:4000` | 메인 페이지 렌더링 |
| 4 | 회원가입/로그인 | 프론트엔드에서 회원가입 후 로그인 | 토큰 발급, 유저 정보 표시 |
| 5 | MinIO | `curl http://localhost:9100/minio/health/live` | OK |
| 6 | Redis | `docker exec aimu-redis redis-cli -a aimu_pass_2024 ping` | PONG |

---

### 에이전트별 작업 할당 요약

| 에이전트 | 작업 | 순서 |
|---------|------|------|
| **백엔드 에이전트** | STEP 1: .env 생성 | 1st |
| **백엔드 에이전트** | STEP 2: Docker Compose 시작 | 2nd (STEP 1 후) |
| **백엔드 에이전트** | STEP 3: pip install | 2nd (STEP 1 후, STEP 2와 병렬) |
| **프론트엔드 에이전트** | STEP 4: npm install | 1st (독립 수행) |
| **백엔드 에이전트** | STEP 5a: 백엔드 서버 시작 | 3rd (STEP 2,3 후) |
| **프론트엔드 에이전트** | STEP 5b: 프론트엔드 서버 시작 | 2nd (STEP 4 후) |
| **테스터 에이전트** | STEP 6: 통합 검증 | 4th (STEP 5 후) |

### 의존성 그래프

```
STEP 1 (.env 생성)
  ├──> STEP 2 (Docker) ──┐
  └──> STEP 3 (pip)    ──┼──> STEP 5a (백엔드 시작) ──┐
                          │                              ├──> STEP 6 (검증)
STEP 4 (npm) ────────────────> STEP 5b (프론트 시작) ──┘
```

### 체크리스트
- [ ] STEP 1: backend/.env 파일 생성 완료
- [ ] STEP 2: Docker Compose 서비스 5개 healthy
- [ ] STEP 3: Python venv + pip install 완료
- [ ] STEP 4: npm install 완료
- [ ] STEP 5a: 백엔드 서버 포트 9000 정상 시작
- [ ] STEP 5b: 프론트엔드 서버 포트 4000 정상 시작
- [ ] STEP 6: 통합 검증 6항목 통과

---

## v14 — 내 목소리 녹음 + Dolby.io 보컬 다듬기 (2026-03-30)

### 목적
'내 캐릭터' 탭에서 사용자가 자신의 목소리를 녹음(또는 파일 업로드)하고, Dolby.io Media Enhance API를 통해 노이즈 제거/보컬 프레즌스 부스트 등 보컬 다듬기 처리를 할 수 있는 기능을 추가한다. 처리된 음성은 향후 보이스 모델 학습의 입력으로 사용된다.

### 전체 흐름
```
사용자 녹음/파일 업로드
  → POST /api/vocal-repair/upload (MinIO에 원본 저장)
  → POST /api/vocal-repair/{id}/enhance (Dolby.io Media Enhance API 호출)
  → GET /api/vocal-repair/{id}/status (폴링으로 상태 확인)
  → 완료 시 원본 vs 다듬어진 파일 나란히 미리듣기
  → 다운로드 / 보이스 모델 학습 연결
```

### 파일 변경 목록

| 구분 | 파일 경로 | 작업 |
|------|----------|------|
| 백엔드 | `backend/app/config.py` | `dolby_api_key` 필드 추가 |
| 백엔드 | `backend/.env` | `DOLBY_API_KEY=` 추가 |
| 백엔드 | `backend/app/services/dolby_service.py` | **신규 생성** — Dolby.io Media Enhance API 연동 서비스 |
| 백엔드 | `backend/app/routes/vocal_repair.py` | **신규 생성** — 보컬 다듬기 API 라우트 7개 |
| 백엔드 | `backend/app/main.py` | `vocal_repair` 라우터 import + 등록 |
| 프론트 | `frontend/src/api/index.js` | vocal-repair API 함수 7개 추가 |
| 프론트 | `frontend/src/pages/MyMusicPage.jsx` | `VoiceRecordSection` 컴포넌트 추가 |
| 프론트 | `frontend/src/pages/MyMusicPage.css` | VoiceRecordSection 스타일 추가 |

---

### STEP 1: 백엔드 — 환경설정 [백엔드 에이전트]

#### 1-1. `backend/app/config.py` — `dolby_api_key` 추가

`kits_api_url` 필드 아래에 추가:

```python
# Dolby.io Media Enhance
dolby_api_key: str = ""
```

#### 1-2. `backend/.env` — `DOLBY_API_KEY` 추가

Kits.AI 섹션 아래에 추가:

```env
# Dolby.io Media Enhance
DOLBY_API_KEY=
```

사용자가 나중에 https://dashboard.dolby.io 에서 API 키를 발급받아 입력한다.

---

### STEP 2: 백엔드 — Dolby.io 서비스 [백엔드 에이전트]

**파일:** `backend/app/services/dolby_service.py` (신규 생성)

Dolby.io Media Enhance API 연동 서비스 클래스를 구현한다.

#### 주요 메서드

```python
class DolbyService:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.dolby.com/media"

    async def upload_to_dolby(self, file_bytes: bytes, filename: str) -> str:
        """Dolby.io 임시 스토리지에 파일 업로드, dlb:// URL 반환"""
        # 1. POST /media/input 으로 presigned URL 획득
        # 2. PUT presigned URL 에 파일 업로드
        # 3. dlb:// input URL 반환

    async def start_enhance(self, input_url: str, output_url: str) -> str:
        """Media Enhance API 호출, job_id 반환"""
        # POST /media/enhance
        # content.type = "voice_recording"
        # audio.noise.reduction.enable = True
        # audio.voice.isolation.enable = True  (보컬 분리/강화)

    async def check_status(self, job_id: str) -> dict:
        """작업 상태 조회 → {"status": "Pending"|"Running"|"Success"|"Failed", "progress": 0~100}"""
        # GET /media/enhance?job_id=...

    async def download_from_dolby(self, dlb_output_url: str) -> bytes:
        """Dolby.io 임시 스토리지에서 결과 파일 다운로드"""
        # POST /media/output → presigned URL → GET 다운로드
```

#### Dolby.io API 인증 헤더
```
Authorization: Bearer {dolby_api_key}
Content-Type: application/json
```

#### Enhance 요청 파라미터 (content.type = "voice_recording")
```json
{
    "input": "dlb://input/user_voice.wav",
    "output": "dlb://output/user_voice_enhanced.wav",
    "content": {
        "type": "voice_recording"
    },
    "audio": {
        "noise": {
            "reduction": {
                "enable": true
            }
        }
    }
}
```

#### 에러 처리
- API 키 미설정 시 `HTTPException(503, "Dolby.io API 키가 설정되지 않았습니다")`
- Dolby.io API 오류 시 상태 코드 및 메시지 전달
- httpx.AsyncClient 사용 (timeout=120초)

---

### STEP 3: 백엔드 — API 라우트 [백엔드 에이전트]

**파일:** `backend/app/routes/vocal_repair.py` (신규 생성)

`router = APIRouter(prefix="/api/vocal-repair", tags=["vocal-repair"])`

#### 3-1. `POST /api/vocal-repair/upload`

- 인증 필요 (`get_current_user`)
- `UploadFile` 로 음성 파일 수신 (허용 확장자: mp3, wav, m4a, ogg, flac, webm)
- webm 포함 — 브라우저 MediaRecorder 기본 출력 형식
- MinIO `aimu-music` 버킷에 `vocal-repair/{user_id}/{uuid}.{ext}` 경로로 저장
- MongoDB `vocal_repairs` 컬렉션에 문서 생성:
  ```json
  {
      "_id": ObjectId,
      "user_id": "...",
      "original_minio_path": "vocal-repair/user123/abc-def.wav",
      "enhanced_minio_path": null,
      "dolby_job_id": null,
      "status": "uploaded",
      "original_filename": "my_voice.wav",
      "content_type": "audio/wav",
      "file_size": 1234567,
      "created_at": "2026-03-30T...",
      "updated_at": "2026-03-30T..."
  }
  ```
- 응답: `{"id": "...", "status": "uploaded"}`

#### 3-2. `POST /api/vocal-repair/{id}/enhance`

- 인증 필요 + 소유자 확인
- MongoDB에서 문서 조회, status가 "uploaded" 또는 "failed"인 경우만 허용
- DolbyService를 사용:
  1. MinIO에서 원본 파일 읽기
  2. `upload_to_dolby()` → dlb:// input URL
  3. `start_enhance()` → job_id
  4. MongoDB 문서 업데이트: `status="processing"`, `dolby_job_id=job_id`
- 응답: `{"id": "...", "status": "processing", "dolby_job_id": "..."}`

#### 3-3. `GET /api/vocal-repair/{id}/status`

- 인증 필요 + 소유자 확인
- status가 "processing"이면 DolbyService.check_status() 호출하여 최신 상태 확인
  - Dolby 상태가 "Success"이면:
    1. `download_from_dolby()` → 결과 파일 bytes
    2. MinIO에 `vocal-repair/{user_id}/{uuid}_enhanced.{ext}` 저장
    3. MongoDB 업데이트: `status="completed"`, `enhanced_minio_path=...`
  - Dolby 상태가 "Failed"이면:
    1. MongoDB 업데이트: `status="failed"`, `error_message=...`
- 응답: `{"id": "...", "status": "uploaded|processing|completed|failed", "progress": 0~100}`

#### 3-4. `GET /api/vocal-repair/{id}/original/stream`

- 인증 (query param `token` 방식 — 오디오 `<audio src>` 용)
- MinIO에서 원본 파일 읽어 `StreamingResponse` 반환
- Content-Type 설정 (저장된 content_type 사용)

#### 3-5. `GET /api/vocal-repair/{id}/enhanced/stream`

- 3-4와 동일 구조, `enhanced_minio_path` 사용
- status가 "completed"가 아니면 404

#### 3-6. `GET /api/vocal-repair/{id}/original/download`

- 3-4와 동일, `Content-Disposition: attachment` 헤더 추가

#### 3-7. `GET /api/vocal-repair/{id}/enhanced/download`

- 3-5와 동일, `Content-Disposition: attachment` 헤더 추가

#### 3-8. `GET /api/vocal-repair/list`

- 인증 필요
- 해당 사용자의 vocal_repairs 목록 반환 (최신순)
- 응답: `[{"id": "...", "status": "...", "original_filename": "...", "created_at": "..."}]`

---

### STEP 4: 백엔드 — 라우터 등록 [백엔드 에이전트]

**파일:** `backend/app/main.py`

#### 4-1. import 추가

`voice_convert` import 라인에 `vocal_repair` 추가:

```python
from .routes import admin, auth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character, voice_persona, voice_convert, vocal_repair
```

#### 4-2. 라우터 등록 추가

`voice_convert.router` 아래에 추가:

```python
app.include_router(vocal_repair.router)
```

---

### STEP 5: 프론트엔드 — API 함수 [프론트엔드 에이전트]

**파일:** `frontend/src/api/index.js`

Voice Conversion 섹션 아래에 추가:

```javascript
// Vocal Repair (Dolby.io Enhance)
export const uploadVocalRepair = (formData) =>
  API.post('/vocal-repair/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

export const startVocalEnhance = (id) =>
  API.post(`/vocal-repair/${id}/enhance`);

export const getVocalRepairStatus = (id) =>
  API.get(`/vocal-repair/${id}/status`);

export const getVocalRepairList = () =>
  API.get('/vocal-repair/list');

export const vocalRepairOriginalStreamUrl = (id) => {
  const base = API.defaults.baseURL.replace('/api', '');
  const token = localStorage.getItem('token') || '';
  return `${base}/api/vocal-repair/${id}/original/stream?token=${encodeURIComponent(token)}`;
};

export const vocalRepairEnhancedStreamUrl = (id) => {
  const base = API.defaults.baseURL.replace('/api', '');
  const token = localStorage.getItem('token') || '';
  return `${base}/api/vocal-repair/${id}/enhanced/stream?token=${encodeURIComponent(token)}`;
};

export const vocalRepairOriginalDownloadUrl = (id) => {
  const base = API.defaults.baseURL.replace('/api', '');
  const token = localStorage.getItem('token') || '';
  return `${base}/api/vocal-repair/${id}/original/download?token=${encodeURIComponent(token)}`;
};

export const vocalRepairEnhancedDownloadUrl = (id) => {
  const base = API.defaults.baseURL.replace('/api', '');
  const token = localStorage.getItem('token') || '';
  return `${base}/api/vocal-repair/${id}/enhanced/download?token=${encodeURIComponent(token)}`;
};
```

---

### STEP 6: 프론트엔드 — VoiceRecordSection 컴포넌트 [프론트엔드 에이전트]

**파일:** `frontend/src/pages/MyMusicPage.jsx`

CharacterSection과 VoicePersonaSection 사이에 `VoiceRecordSection` 컴포넌트를 추가한다.

#### 6-1. 컴포넌트 상태 (state)

```javascript
const [isRecording, setIsRecording] = useState(false);
const [recordedBlob, setRecordedBlob] = useState(null);
const [uploadedFile, setUploadedFile] = useState(null);
const [repairId, setRepairId] = useState(null);
const [repairStatus, setRepairStatus] = useState(null);  // uploaded | processing | completed | failed
const [repairProgress, setRepairProgress] = useState(0);
const [repairList, setRepairList] = useState([]);
const [selectedRepairId, setSelectedRepairId] = useState(null);
const mediaRecorderRef = useRef(null);
const audioChunksRef = useRef([]);
```

#### 6-2. 녹음 기능 (MediaRecorder API)

```javascript
const startRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mediaRecorderRef.current = mediaRecorder;
  audioChunksRef.current = [];

  mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    setRecordedBlob(blob);
    stream.getTracks().forEach(t => t.stop());
  };

  mediaRecorder.start();
  setIsRecording(true);
};

const stopRecording = () => {
  mediaRecorderRef.current?.stop();
  setIsRecording(false);
};
```

#### 6-3. 파일 업로드 옵션

- `<input type="file" accept=".mp3,.wav,.m4a,.ogg,.flac" />`
- 파일 선택 시 `setUploadedFile(file)`
- 녹음 결과 또는 업로드 파일 중 하나를 사용

#### 6-4. 업로드 + 보컬 다듬기 흐름

```javascript
const handleUploadAndEnhance = async () => {
  const formData = new FormData();
  if (recordedBlob) {
    formData.append('file', recordedBlob, 'recording.webm');
  } else if (uploadedFile) {
    formData.append('file', uploadedFile);
  }

  // 1. 업로드
  const uploadRes = await uploadVocalRepair(formData);
  const id = uploadRes.data.id;
  setRepairId(id);
  setRepairStatus('uploaded');

  // 2. 다듬기 시작
  await startVocalEnhance(id);
  setRepairStatus('processing');

  // 3. 폴링
  const pollInterval = setInterval(async () => {
    const statusRes = await getVocalRepairStatus(id);
    setRepairProgress(statusRes.data.progress || 0);
    if (statusRes.data.status === 'completed' || statusRes.data.status === 'failed') {
      clearInterval(pollInterval);
      setRepairStatus(statusRes.data.status);
      setSelectedRepairId(id);
      fetchRepairList();  // 목록 갱신
    }
  }, 3000);
};
```

#### 6-5. UI 레이아웃

```
┌─────────────────────────────────────────────────────┐
│  🎙️ 내 목소리 녹음 & 보컬 다듬기                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [● 녹음 시작]  [■ 녹음 정지]                          │
│  ── 또는 ──                                          │
│  [📁 파일 업로드] (mp3, wav, m4a, ogg, flac)           │
│                                                     │
│  선택된 파일: recording.webm (2.3MB)                   │
│                                                     │
│  [✨ 보컬 다듬기 시작]                                  │
│                                                     │
│  처리 중... ████████░░░░░░░ 55%                       │
│                                                     │
│  ┌──────────────────┬──────────────────┐             │
│  │  🔊 원본          │  🔊 다듬어진 버전   │             │
│  │  ▶ ━━━━━━━ 0:45  │  ▶ ━━━━━━━ 0:45  │             │
│  │  [⬇ 다운로드]     │  [⬇ 다운로드]     │             │
│  └──────────────────┴──────────────────┘             │
│                                                     │
│  [🎤 보이스 모델 학습하기 →]                            │
│                                                     │
│  ── 이전 녹음 목록 ──                                  │
│  • my_voice.wav (2026-03-30) — 완료 [선택]            │
│  • test_voice.mp3 (2026-03-29) — 실패 [재시도]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 6-6. character 탭 렌더링 순서 변경

기존:
```jsx
{activeTab === 'character' && (
  <>
    <CharacterSection ... />
    <VoicePersonaSection ... />
  </>
)}
```

변경:
```jsx
{activeTab === 'character' && (
  <>
    <CharacterSection ... />
    <VoiceRecordSection ... />
    <VoicePersonaSection ... />
  </>
)}
```

---

### STEP 7: 프론트엔드 — CSS 스타일 [프론트엔드 에이전트]

**파일:** `frontend/src/pages/MyMusicPage.css`

기존 `mymusic-voice-persona` 스타일 패턴을 참고하여 아래 클래스 추가:

- `.mymusic-vocal-repair` — 섹션 컨테이너
- `.mymusic-vocal-repair__title` — 섹션 제목
- `.mymusic-vocal-repair__record-controls` — 녹음 버튼 영역
- `.mymusic-vocal-repair__record-btn` — 녹음 시작/정지 버튼 (녹음 중 빨간색 깜빡임)
- `.mymusic-vocal-repair__file-upload` — 파일 업로드 영역
- `.mymusic-vocal-repair__enhance-btn` — 보컬 다듬기 버튼
- `.mymusic-vocal-repair__progress` — 프로그레스 바
- `.mymusic-vocal-repair__preview` — 원본 vs 다듬어진 파일 나란히 보기 (display: grid, grid-template-columns: 1fr 1fr)
- `.mymusic-vocal-repair__preview-card` — 각 오디오 카드
- `.mymusic-vocal-repair__download-btn` — 다운로드 버튼
- `.mymusic-vocal-repair__next-step` — 보이스 모델 학습 연결 버튼
- `.mymusic-vocal-repair__history` — 이전 녹음 목록

---

### STEP 8: 테스트 [테스터 에이전트]

#### 8-1. 백엔드 API 테스트

| # | 테스트 항목 | 방법 | 기대 결과 |
|---|-----------|------|----------|
| 1 | 파일 업로드 | `curl -X POST -F "file=@test.wav" http://localhost:9000/api/vocal-repair/upload -H "Authorization: Bearer {token}"` | `{"id": "...", "status": "uploaded"}` |
| 2 | 목록 조회 | `GET /api/vocal-repair/list` | 업로드한 파일 목록 반환 |
| 3 | 다듬기 시작 | `POST /api/vocal-repair/{id}/enhance` | `{"status": "processing"}` |
| 4 | 상태 조회 | `GET /api/vocal-repair/{id}/status` | progress 값 변화 확인 |
| 5 | 원본 스트리밍 | `GET /api/vocal-repair/{id}/original/stream?token=...` | 오디오 스트리밍 응답 |
| 6 | 다듬어진 파일 스트리밍 | `GET /api/vocal-repair/{id}/enhanced/stream?token=...` | 완료 후 오디오 스트리밍 |
| 7 | 다운로드 | `GET /api/vocal-repair/{id}/original/download?token=...` | Content-Disposition 헤더 포함 |
| 8 | API 키 미설정 | DOLBY_API_KEY 비어있는 상태에서 enhance 호출 | 503 응답 |
| 9 | 잘못된 파일 형식 | `.txt` 파일 업로드 시도 | 400 응답 |
| 10 | 권한 없는 접근 | 다른 사용자의 repair ID로 접근 | 403 응답 |

#### 8-2. 프론트엔드 UI 테스트

| # | 테스트 항목 | 기대 결과 |
|---|-----------|----------|
| 1 | 녹음 시작/정지 | 녹음 버튼 토글, 녹음 중 UI 표시, 정지 후 Blob 생성 |
| 2 | 파일 업로드 | 허용 확장자만 선택 가능, 파일명/크기 표시 |
| 3 | 보컬 다듬기 | 업로드 → 처리 시작 → 프로그레스 → 완료 |
| 4 | 미리듣기 | 원본/다듬어진 오디오 나란히 재생 |
| 5 | 다운로드 | 원본/다듬어진 파일 다운로드 |
| 6 | 이전 녹음 목록 | 목록 표시, 선택 시 미리듣기 전환 |
| 7 | 에러 처리 | 마이크 권한 거부 시 안내 메시지, API 오류 시 사용자 알림 |

---

### 에이전트별 작업 할당 요약

| 에이전트 | STEP | 작업 내용 | 의존성 |
|---------|------|----------|--------|
| **백엔드 에이전트** | STEP 1 | config.py에 dolby_api_key 추가, .env에 DOLBY_API_KEY 추가 | 없음 |
| **백엔드 에이전트** | STEP 2 | `dolby_service.py` 생성 (Dolby.io API 연동) | STEP 1 |
| **백엔드 에이전트** | STEP 3 | `vocal_repair.py` 라우트 생성 (API 8개) | STEP 2 |
| **백엔드 에이전트** | STEP 4 | main.py에 라우터 등록 | STEP 3 |
| **프론트엔드 에이전트** | STEP 5 | api/index.js에 vocal-repair API 함수 추가 | 없음 (STEP 3과 병렬) |
| **프론트엔드 에이전트** | STEP 6 | VoiceRecordSection 컴포넌트 구현 | STEP 5 |
| **프론트엔드 에이전트** | STEP 7 | CSS 스타일 추가 | STEP 6과 병렬 |
| **테스터 에이전트** | STEP 8 | 백엔드 API + 프론트엔드 UI 통합 테스트 | STEP 4, 6, 7 완료 후 |

### 의존성 그래프

```
STEP 1 (config/env)
  └──> STEP 2 (dolby_service.py)
         └──> STEP 3 (vocal_repair.py 라우트)
                └──> STEP 4 (main.py 등록) ──────────────┐
                                                          ├──> STEP 8 (테스트)
STEP 5 (API 함수) ──> STEP 6 (VoiceRecordSection) ──┐    │
                      STEP 7 (CSS) ──────────────────┼────┘
                                                     │
                                        (STEP 6, 7 병렬 가능)
```

### 주의사항

1. **Dolby.io API 키 필요**: 실제 동작을 위해 https://dashboard.dolby.io 에서 API 키를 발급받아 `.env`에 설정해야 함. 키가 없으면 업로드까지만 동작하고, enhance 호출 시 503 응답.
2. **webm 지원**: 브라우저 MediaRecorder는 기본적으로 webm 포맷으로 녹음함. 업로드 허용 확장자에 webm 포함 필수.
3. **폴링 간격**: 3초 간격으로 상태 폴링. Dolby.io 처리는 보통 파일 길이의 50~100% 시간 소요.
4. **MinIO 경로**: `vocal-repair/{user_id}/{uuid}.{ext}` — 기존 voice-persona와 분리.
5. **MongoDB 컬렉션**: `vocal_repairs` — 기존 컬렉션과 분리.
6. **보이스 모델 학습 연결**: '보이스 모델 학습하기' 버튼은 이번 버전에서는 UI만 배치. 실제 학습 로직은 다음 버전에서 구현.

### 체크리스트
- [ ] STEP 1: config.py dolby_api_key 추가
- [ ] STEP 1: .env DOLBY_API_KEY 추가
- [ ] STEP 2: dolby_service.py 생성 (upload_to_dolby, start_enhance, check_status, download_from_dolby)
- [ ] STEP 3: vocal_repair.py 라우트 8개 (upload, enhance, status, stream x2, download x2, list)
- [ ] STEP 4: main.py 라우터 import + 등록
- [ ] STEP 5: api/index.js vocal-repair 함수 8개
- [ ] STEP 6: VoiceRecordSection 컴포넌트 (녹음, 업로드, 다듬기, 미리듣기, 다운로드)
- [ ] STEP 7: CSS 스타일 추가
- [ ] STEP 8-1: 백엔드 API 테스트 10항목
- [ ] STEP 8-2: 프론트엔드 UI 테스트 7항목

---

## v15 — Dolby.io → Wondera API 교체 (2026-03-30)

### 배경

v14에서 구현한 보컬 다듬기(Vocal Enhancement) 기능은 Dolby.io Media API를 사용했으나, Wondera API로 교체한다. 기존 기능 동작(업로드 → enhance → 상태 조회 → 다운로드/스트리밍)의 흐름은 동일하게 유지하며, 내부 서비스 레이어만 교체한다.

### 변경 대상 파일 (백엔드 4개)

| # | 파일 | 작업 내용 |
|---|------|----------|
| 1 | `backend/.env` | `DOLBY_API_KEY=` 항목 삭제, `WONDERA_API_KEY=wk_9edb4ebb...` 추가 |
| 2 | `backend/app/config.py` | `dolby_api_key: str = ""` → `wondera_api_key: str = ""` 변경 |
| 3 | `backend/app/services/dolby_service.py` | 파일 삭제 후 `backend/app/services/wondera_service.py` 신규 생성 (Wondera API 연동) |
| 4 | `backend/app/routes/vocal_repair.py` | `from ..services.dolby_service import enhance_vocal` → `from ..services.wondera_service import enhance_vocal` 변경, API 키 검증 로직에서 `dolby_api_key` → `wondera_api_key` 변경, 에러 메시지 텍스트 수정 |

### STEP별 작업 계획

#### STEP 1: 환경 변수 교체 [백엔드 에이전트]

- `backend/.env`
  - `DOLBY_API_KEY=` 행 삭제
  - `WONDERA_API_KEY=wk_9edb4ebb41e19a142a39c74a0c9f49ec4fbac6a387311a62b8b638a56cd78647` 추가
- `backend/app/config.py`
  - `dolby_api_key: str = ""` → `wondera_api_key: str = ""` 변경

#### STEP 2: 서비스 레이어 교체 [백엔드 에이전트]

- `backend/app/services/dolby_service.py` 삭제
- `backend/app/services/wondera_service.py` 신규 생성
  - Wondera API 엔드포인트 연동
  - `enhance_vocal(file_bytes, filename, settings)` 함수 시그니처 유지 (라우트 호환)
  - `wondera_api_key` 사용하여 인증

#### STEP 3: 라우트 수정 [백엔드 에이전트]

- `backend/app/routes/vocal_repair.py`
  - import 경로 변경: `dolby_service` → `wondera_service`
  - API 키 검증: `settings.dolby_api_key` → `settings.wondera_api_key`
  - 에러 메시지: `"Dolby API 키가 설정되지 않았습니다."` → `"Wondera API 키가 설정되지 않았습니다."`

#### STEP 4: 테스트 [테스터 에이전트]

- 기존 v14 테스트 항목 재실행 (STEP 8-1의 항목 1~10)
- 특히 항목 8: `WONDERA_API_KEY` 비어있는 상태에서 enhance 호출 시 503 응답 확인

### 의존성 그래프

```
STEP 1 (env/config 교체)
  └──> STEP 2 (wondera_service.py 생성, dolby_service.py 삭제)
         └──> STEP 3 (vocal_repair.py import/검증 수정)
                └──> STEP 4 (테스트)
```

### 주의사항

1. **함수 시그니처 호환**: `wondera_service.py`의 `enhance_vocal` 함수는 기존 `dolby_service.py`와 동일한 인자/반환값을 유지해야 라우트 수정을 최소화할 수 있다.
2. **프론트엔드 변경 없음**: API 경로(`/api/vocal-repair/*`)는 그대로 유지되므로 프론트엔드 수정은 불필요하다.
3. **API 키 보안**: `.env` 파일은 `.gitignore`에 포함되어 있으므로 커밋되지 않음을 확인할 것.

### 체크리스트

- [ ] STEP 1: `.env` — `DOLBY_API_KEY` 삭제, `WONDERA_API_KEY` 추가
- [ ] STEP 1: `config.py` — `dolby_api_key` → `wondera_api_key` 변경
- [ ] STEP 2: `dolby_service.py` 삭제
- [ ] STEP 2: `wondera_service.py` 생성 (Wondera API 연동, enhance_vocal 함수)
- [ ] STEP 3: `vocal_repair.py` — import 및 API 키 검증 로직 수정
- [ ] STEP 4: 백엔드 API 테스트 재실행 (v14 STEP 8-1 항목 기준)

---

## v16 — 보컬 수리 투트랙: LALAL.AI + Demucs 비교 선택 (2026-03-30)

### 배경

v14~v15에서 구현한 보컬 다듬기(Vocal Enhancement)는 단일 외부 API(Dolby.io → Wondera)에 의존했다. 이번 버전에서는 두 가지 처리 방식(LALAL.AI API / Demucs 로컬 처리)을 동시에 제공하여 사용자가 직접 결과를 비교하고 선택할 수 있도록 한다.

### 처리 파이프라인

```
녹음/업로드 (기존 POST /upload 유지)
  ↓
[1] 노멀라이즈 → pyloudnorm (서버 내)
  ↓
[2] 노이즈+에코 제거 → LALAL.AI API 또는 Demucs (사용자 선택)
  ↓
[3] 볼륨 균일화(컴프레션) → ffmpeg (서버 내)
  ↓
결과 비교 (원본 / LALAL.AI 결과 / Demucs 결과)
```

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/config.py` | `wondera_api_key` → `lalal_api_key` 변경 |
| 2 | `backend/app/services/wondera_service.py` | 삭제 |
| 3 | `backend/app/services/lalal_service.py` | 신규 생성 — LALAL.AI API 연동 |
| 4 | `backend/app/services/demucs_service.py` | 신규 생성 — Demucs 로컬 처리 |
| 5 | `backend/app/routes/vocal_repair.py` | 대폭 수정 — 파이프라인 + 듀얼 방식 |
| 6 | `backend/requirements.txt` | `pyloudnorm`, `demucs` 추가 |
| 7 | `frontend/src/api/index.js` | enhance 호출 시 method 파라미터, stream/download URL에 method 쿼리 |
| 8 | `frontend/src/pages/MyMusicPage.jsx` | VoiceRecordSection 수정 — 방식 선택 + 비교 UI |

### STEP별 작업 계획

#### STEP 1: 환경 변수 및 설정 교체 [백엔드 에이전트]

**config.py 수정**
- `wondera_api_key: str = ""` 행을 `lalal_api_key: str = ""` 로 변경
- 주석도 `# Wondera Vocal Enhancement` → `# LALAL.AI Vocal Enhancement` 변경

**requirements.txt 추가**
- 파일 끝에 다음 추가:
```
pyloudnorm
demucs
soundfile
```

**.env 확인**
- `LALAL_API_KEY=a68fd72f25624a9b` 이미 등록 확인 (변경 불필요)
- `WONDERA_API_KEY=...` 행 삭제

#### STEP 2: 서비스 레이어 교체 [백엔드 에이전트]

**wondera_service.py 삭제**
- `backend/app/services/wondera_service.py` 삭제

**lalal_service.py 신규 생성**
- 파일: `backend/app/services/lalal_service.py`
- LALAL.AI REST API v2 연동 (https://www.lalal.ai/api/)
- 함수:
  - `async def enhance_vocal_lalal(audio_bytes: bytes, filename: str) -> bytes`
    1. `POST https://www.lalal.ai/api/upload/` — 파일 업로드, `id` 반환
    2. `POST https://www.lalal.ai/api/split/` — 분리 시작 (stem: `voice_clean`, filter_type: 2=noise+echo)
    3. 폴링: `GET https://www.lalal.ai/api/check/?id={id}` — status가 2(완료)가 될 때까지 3초 간격
    4. 완료 시 `stem_track` URL에서 WAV 다운로드
- 인증: 헤더 `Authorization: license {LALAL_API_KEY}`
- settings.lalal_api_key 사용

**demucs_service.py 신규 생성**
- 파일: `backend/app/services/demucs_service.py`
- 함수:
  - `async def enhance_vocal_demucs(audio_bytes: bytes, filename: str) -> bytes`
    1. 임시 디렉토리에 입력 파일 저장
    2. `demucs.separate.main(["--two-stems", "vocals", "-n", "htdemucs", input_path])` 호출 (asyncio.to_thread로 감싸기)
    3. 출력 디렉토리에서 `vocals.wav` 읽기
    4. 임시 디렉토리 정리 후 bytes 반환
- GPU 없는 환경 대비: `--device cpu` 옵션 추가

#### STEP 3: 파이프라인 유틸 함수 [백엔드 에이전트]

**vocal_repair.py 내부에 헬퍼 함수 추가** (또는 별도 `audio_pipeline.py` 생성)

1. `normalize_audio(audio_bytes: bytes) -> bytes`
   - pyloudnorm으로 -14 LUFS 타겟 노멀라이즈
   - soundfile로 읽기/쓰기

2. `compress_audio(audio_bytes: bytes) -> bytes`
   - ffmpeg subprocess로 컴프레션 적용
   - `ffmpeg -i input.wav -af "acompressor=threshold=-20dB:ratio=4:attack=5:release=50" output.wav`
   - asyncio.create_subprocess_exec 사용

#### STEP 4: vocal_repair.py 라우트 대폭 수정 [백엔드 에이전트]

**POST /upload** — 변경 없음 (기존 유지)

**POST /{repair_id}/enhance** — 수정
- Request body에 `method` 파라미터 추가: `"lalal"` | `"demucs"` | `"both"` (기본값: `"lalal"`)
- Pydantic 모델 추가:
  ```python
  class EnhanceRequest(BaseModel):
      method: str = "lalal"  # "lalal", "demucs", "both"
  ```
- API 키 검증: method가 `"lalal"` 또는 `"both"`일 때만 lalal_api_key 체크
- 파이프라인 실행 (background task):
  1. MinIO에서 원본 다운로드
  2. `normalize_audio()` 적용
  3. method에 따라 분기:
     - `"lalal"`: `enhance_vocal_lalal()` 호출
     - `"demucs"`: `enhance_vocal_demucs()` 호출
     - `"both"`: 두 함수를 asyncio.gather로 병렬 호출
  4. 각 결과에 `compress_audio()` 적용
  5. MinIO에 저장:
     - LALAL.AI 결과: `vocal-repair/{user_id}/{repair_id}/enhanced_lalal.wav`
     - Demucs 결과: `vocal-repair/{user_id}/{repair_id}/enhanced_demucs.wav`
  6. MongoDB 업데이트:
     - `enhanced_lalal_object`: LALAL.AI 결과 경로 (또는 null)
     - `enhanced_demucs_object`: Demucs 결과 경로 (또는 null)
     - `method`: 사용된 방식
     - `status`: "completed"

**MongoDB 문서 스키마 변경**
- 기존: `enhanced_object: str | null`
- 변경: `enhanced_lalal_object: str | null`, `enhanced_demucs_object: str | null`, `method: str`
- upload 시 초기값: 둘 다 null

**GET /{repair_id}/status** — 수정
- 응답에 `method` 필드 추가
- `enhanced_lalal_object`, `enhanced_demucs_object` 존재 여부를 `has_lalal`, `has_demucs` boolean으로 반환

**GET /{repair_id}/enhanced/stream** — 수정
- 쿼리 파라미터 `method` 추가: `"lalal"` | `"demucs"` (필수)
- method에 따라 `enhanced_lalal_object` 또는 `enhanced_demucs_object` 스트리밍

**GET /{repair_id}/enhanced/download** — 수정
- 쿼리 파라미터 `method` 추가: `"lalal"` | `"demucs"` (필수)
- 파일명: `enhanced_lalal_{id[:8]}.wav` 또는 `enhanced_demucs_{id[:8]}.wav`

**GET /list** — 수정
- 응답에 `method`, `has_lalal`, `has_demucs` 필드 추가

#### STEP 5: 프론트엔드 API 함수 수정 [프론트엔드 에이전트]

**`frontend/src/api/index.js`**

- `startVocalEnhance` 수정:
  ```javascript
  export const startVocalEnhance = (repairId, method = 'lalal') =>
    API.post(`/vocal-repair/${repairId}/enhance`, { method });
  ```

- `vocalRepairEnhancedStreamUrl` 수정:
  ```javascript
  export const vocalRepairEnhancedStreamUrl = (repairId, method = 'lalal') =>
    `${API.defaults.baseURL}/vocal-repair/${repairId}/enhanced/stream?method=${method}`;
  ```

- `vocalRepairEnhancedDownloadUrl` 수정:
  ```javascript
  export const vocalRepairEnhancedDownloadUrl = (repairId, method = 'lalal') =>
    `${API.defaults.baseURL}/vocal-repair/${repairId}/enhanced/download?method=${method}`;
  ```

- 나머지 함수(upload, status, original stream/download, list)는 변경 없음

#### STEP 6: VoiceRecordSection UI 수정 [프론트엔드 에이전트]

**`frontend/src/pages/MyMusicPage.jsx` — VoiceRecordSection 함수 내부**

1. **상태 추가**:
   ```javascript
   const [enhanceMethod, setEnhanceMethod] = useState('both');
   // 'lalal', 'demucs', 'both'
   const [lalalProgress, setLalalProgress] = useState(0);
   const [demucsProgress, setDemucsProgress] = useState(0);
   const [hasLalal, setHasLalal] = useState(false);
   const [hasDemucs, setHasDemucs] = useState(false);
   ```

2. **방식 선택 UI** (업로드 완료 후, "다듬기" 버튼 위에 표시):
   - 라디오 버튼 3개: "LALAL.AI" / "Demucs" / "둘 다 비교"
   - "LALAL.AI": 클라우드 기반, 빠름, API 키 필요
   - "Demucs": 서버 로컬 처리, GPU 있으면 빠름
   - "둘 다 비교": 두 결과를 나란히 비교

3. **다듬기 버튼 클릭 핸들러 수정**:
   - `startVocalEnhance(repairId, enhanceMethod)` 호출
   - 폴링 시 `has_lalal`, `has_demucs` 상태 반영

4. **결과 비교 영역** (status === 'completed' 일 때):
   - 3칸 나란히 배치 (flexbox):
     - **원본**: 기존 오디오 플레이어 + 다운로드 버튼
     - **LALAL.AI 결과** (hasLalal일 때): 오디오 플레이어 + 다운로드 버튼
     - **Demucs 결과** (hasDemucs일 때): 오디오 플레이어 + 다운로드 버튼
   - 각 오디오 플레이어는 `<audio>` 태그 + 인증 토큰을 위해 fetch blob URL 패턴 사용 (기존 방식 따름)
   - 다운로드 버튼: method별 downloadUrl 사용

5. **프로그레스바**:
   - method가 "both"일 때 프로그레스바 2개 표시 (LALAL.AI / Demucs)
   - 단일 방식일 때 프로그레스바 1개

#### STEP 7: 테스트 [테스터 에이전트]

**백엔드 API 테스트** (총 12항목)

1. POST /upload — 정상 업로드 → 200, id 반환
2. POST /upload — 허용되지 않는 확장자 → 400
3. POST /upload — 50MB 초과 → 400
4. POST /{id}/enhance `{"method": "lalal"}` — LALAL_API_KEY 없으면 503
5. POST /{id}/enhance `{"method": "demucs"}` — API 키 없어도 정상 시작 (Demucs는 로컬)
6. POST /{id}/enhance `{"method": "both"}` — 정상 시작
7. POST /{id}/enhance — 이미 처리 중 → 409
8. GET /{id}/status — 상태 반환 (method, has_lalal, has_demucs 포함)
9. GET /{id}/enhanced/stream?method=lalal — 정상 스트리밍
10. GET /{id}/enhanced/stream?method=demucs — 정상 스트리밍
11. GET /{id}/enhanced/download?method=lalal — 파일 다운로드
12. GET /{id}/enhanced/download?method=demucs — 파일 다운로드

**프론트엔드 UI 테스트** (총 8항목)

1. 방식 선택 라디오 버튼 3개 표시 확인
2. "LALAL.AI" 선택 후 다듬기 → enhance 호출 시 method=lalal 확인
3. "Demucs" 선택 후 다듬기 → enhance 호출 시 method=demucs 확인
4. "둘 다 비교" 선택 후 다듬기 → enhance 호출 시 method=both 확인
5. 완료 후 결과 비교 영역에 원본 + 해당 방식 결과 표시 확인
6. "둘 다 비교" 완료 시 3칸 나란히 표시 확인
7. 각 결과 오디오 재생 정상 확인
8. 각 결과 다운로드 버튼 동작 확인

### 의존성 그래프

```
STEP 1 (config/env/requirements)
  └──> STEP 2 (wondera 삭제, lalal_service + demucs_service 생성)
         └──> STEP 3 (파이프라인 유틸: normalize + compress)
                └──> STEP 4 (vocal_repair.py 라우트 대폭 수정)
                       └──────────────────────────────────────────┐
                                                                   ├──> STEP 7 (테스트)
STEP 5 (API 함수 수정) ──> STEP 6 (VoiceRecordSection UI 수정) ──┘
```

### 주의사항

1. **LALAL.AI API 키**: `.env`에 `LALAL_API_KEY=a68fd72f25624a9b` 이미 등록됨. LALAL.AI는 license 기반 인증이므로 헤더 형식 확인 필요 (`Authorization: license {key}`).
2. **Demucs 설치 크기**: demucs 패키지는 PyTorch 의존성이 크므로 (약 2GB+), 서버 디스크 여유 확인. CPU 모드 기본 사용.
3. **ffmpeg 필수**: 컴프레션 단계에서 ffmpeg를 subprocess로 호출하므로 서버에 ffmpeg 설치 필요 (`apt install ffmpeg`).
4. **pyloudnorm + soundfile**: 노멀라이즈에 사용. soundfile은 libsndfile 시스템 라이브러리 필요 (`apt install libsndfile1`).
5. **MongoDB 하위 호환**: 기존 `enhanced_object` 필드를 사용하는 문서가 있을 수 있음. 마이그레이션은 불필요하나, 조회 시 `enhanced_object` 필드도 fallback으로 확인할 것.
6. **"both" 모드 시간**: LALAL.AI (네트워크) + Demucs (CPU 처리) 병렬 실행이므로, 둘 중 느린 쪽 시간이 전체 소요 시간. Demucs CPU 모드는 1분 음원 기준 약 2~5분 소요 가능.
7. **MinIO 경로 분리**: LALAL.AI 결과(`enhanced_lalal.wav`)와 Demucs 결과(`enhanced_demucs.wav`)를 동일 prefix 아래 파일명으로 구분.
8. **프론트엔드 인증 토큰**: stream/download URL에 쿼리 파라미터로 method를 추가할 때, 기존 인증 방식(Authorization 헤더 또는 쿠키)과 충돌 없는지 확인.

### 체크리스트

- [ ] STEP 1: `config.py` — `wondera_api_key` → `lalal_api_key` 변경
- [ ] STEP 1: `.env` — `WONDERA_API_KEY` 행 삭제 (LALAL_API_KEY는 이미 존재)
- [ ] STEP 1: `requirements.txt` — `pyloudnorm`, `demucs`, `soundfile` 추가
- [ ] STEP 2: `wondera_service.py` 삭제
- [ ] STEP 2: `lalal_service.py` 생성 (upload → split → check → download)
- [ ] STEP 2: `demucs_service.py` 생성 (로컬 demucs 처리)
- [ ] STEP 3: 파이프라인 유틸 함수 (normalize_audio, compress_audio)
- [ ] STEP 4: `vocal_repair.py` — enhance 엔드포인트에 method 파라미터 추가
- [ ] STEP 4: `vocal_repair.py` — 파이프라인 적용 (normalize → 처리 → compress)
- [ ] STEP 4: `vocal_repair.py` — MongoDB 스키마 변경 (enhanced_lalal_object, enhanced_demucs_object)
- [ ] STEP 4: `vocal_repair.py` — stream/download에 method 쿼리 파라미터 추가
- [ ] STEP 5: `api/index.js` — startVocalEnhance에 method 파라미터 추가
- [ ] STEP 5: `api/index.js` — stream/download URL에 method 쿼리 추가
- [ ] STEP 6: VoiceRecordSection — 방식 선택 라디오 버튼 UI
- [ ] STEP 6: VoiceRecordSection — 결과 비교 3칸 레이아웃
- [ ] STEP 6: VoiceRecordSection — 각 방식별 다운로드 버튼
- [ ] STEP 7: 백엔드 API 테스트 12항목
- [ ] STEP 7: 프론트엔드 UI 테스트 8항목

---

## v17 — RVC 변환 후 MR 음정 조절 미리듣기 + 수동 합치기 (2026-03-30)

### 배경

현재 음성 변환(Voice Conversion) 파이프라인은 RVC 변환 완료 후 자동으로 보컬+MR을 합치고(Step f) 최종 mp3를 생성한다. 사용자가 MR 음정을 변경하고 싶거나 보컬/MR 볼륨 비율을 조절하고 싶어도, 다시 전체 파이프라인을 돌려야 한다. 이번 버전에서는 RVC 변환 후 합치기 전에 "일시정지"하여, 프론트엔드에서 Web Audio API로 MR 피치와 볼륨을 실시간 미리듣기한 뒤 사용자가 만족하면 서버에서 최종 합치기를 수행하도록 변경한다.

### 변경된 파이프라인

```
[기존]
Step b: 보컬 분리 → vocal.wav + backing.wav
Step d: RVC 변환 → converted_vocal.wav
Step f: ffmpeg 자동 합치기 → voice_converted.mp3 (상태: completed)

[변경]
Step b: 보컬 분리 → vocal.wav + backing.wav
Step d: RVC 변환 → converted_vocal.wav
Step NEW: converted_vocal.wav + backing.wav를 MinIO에 저장
          상태를 "awaiting_merge"로 변경
          → 사용자가 프론트에서 MR 피치/볼륨 실시간 조절 + 미리듣기
          → 사용자가 "최종 합치기" 클릭
Step f: 서버에서 ffmpeg로 MR 피치 조절 + 보컬/MR 볼륨 조절 + 합치기
        → voice_converted.mp3 생성, 상태를 "completed"로 변경
```

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/services/kits_service.py` | `convert_voice` 함수에서 Step f(합치기) 제거, Step NEW(awaiting_merge) 추가 |
| 2 | `backend/app/routes/voice_convert.py` | 새 엔드포인트 3개 추가 (보컬 스트리밍, MR 스트리밍, 최종 합치기) |
| 3 | `frontend/src/api/index.js` | 새 API 함수 3개 추가 |
| 4 | `frontend/src/components/StudioTab2.jsx` | MR 음정 조절 패널 UI + Web Audio API 미리듣기 |
| 5 | `frontend/src/components/StudioTab2.css` | MR 조절 패널 스타일 |

### STEP별 작업 계획

#### STEP 1: kits_service.py — 파이프라인 분리 [백엔드 에이전트]

**파일: `backend/app/services/kits_service.py`**

현재 `convert_voice` 함수의 Step f(합치기) ~ Step h(MongoDB 업데이트)를 변경한다.

**변경 내용:**

1. Step e(변환된 보컬 다운로드) 후, 기존 Step f(ffmpeg 합치기)를 **제거**
2. 대신 converted_vocal.wav를 MinIO에 업로드:
   ```python
   # Step NEW: Upload converted vocal to MinIO (backing은 이미 업로드됨)
   converted_vocal_object = f"generated/{generation_id}/converted_vocal.wav"
   minio_client.put_object(
       bucket_name=settings.minio_bucket_music,
       object_name=converted_vocal_object,
       data=io.BytesIO(cv_bytes),
       length=len(cv_bytes),
       content_type="audio/wav",
   )
   ```
3. backing.wav MinIO 업로드는 기존 코드 유지 (이미 `generated/{id}/backing.wav`로 업로드 중)
4. MongoDB 상태를 `"awaiting_merge"`로 변경:
   ```python
   await _update_vc_progress(mongo_db, generation_id, 80, "awaiting_merge", {
       "voice_converted_vocal_url": converted_vocal_object,
       "voice_converted_backing_url": backing_object,
       "voice_model_id": voice_model_id,
   })
   ```
5. 기존 Step g(최종 mp3 업로드), Step h(completed 상태 변경) 코드를 삭제
6. 함수가 `{"status": "awaiting_merge"}` 반환

**주의:** 합치기 로직(ffmpeg amix)은 삭제하지 않고 별도 함수 `merge_vocal_and_backing`으로 추출한다 (STEP 2에서 사용).

**새 함수 추가: `merge_vocal_and_backing`**
```python
async def merge_vocal_and_backing(
    generation_id: str,
    mongo_db,
    mr_pitch_shift: float = 0,
    vocal_volume: float = 1.0,
    mr_volume: float = 1.0,
) -> dict:
    """Merge converted vocal + backing with optional MR pitch shift and volume control.

    Args:
        mr_pitch_shift: MR 피치 변경량 (반음 단위, -12 ~ +12)
        vocal_volume: 보컬 볼륨 (0.0 ~ 2.0)
        mr_volume: MR 볼륨 (0.0 ~ 2.0)
    """
```

이 함수의 처리 흐름:
1. MinIO에서 `generated/{id}/converted_vocal.wav`와 `generated/{id}/backing.wav` 다운로드
2. ffmpeg로 MR 피치 조절 (mr_pitch_shift != 0인 경우):
   - `rubberband` 필터 사용: `rubberband=pitch={2^(mr_pitch_shift/12)}`
   - rubberband 미설치 시 fallback: `asetrate=44100*{2^(shift/12)},aresample=44100,atempo={2^(-shift/12)}`
3. ffmpeg로 보컬/MR 볼륨 조절 + 합치기:
   ```
   ffmpeg -y
     -i converted_vocal.wav -i backing_pitched.wav
     -filter_complex "[0:a]volume={vocal_volume}[v];[1:a]volume={mr_volume}[m];[v][m]amix=inputs=2:duration=longest:dropout_transition=2[out]"
     -map "[out]" -codec:a libmp3lame -b:a 192k
     output.mp3
   ```
4. 결과를 MinIO에 `generated/{id}/voice_converted.mp3`로 업로드
5. MongoDB 상태를 `"completed"`로 변경:
   ```python
   await _update_vc_progress(mongo_db, generation_id, 100, "completed", {
       "voice_converted_url": result_object,
       "voice_conversion_completed_at": datetime.utcnow(),
       "merge_settings": {
           "mr_pitch_shift": mr_pitch_shift,
           "vocal_volume": vocal_volume,
           "mr_volume": mr_volume,
       },
   })
   ```

#### STEP 2: voice_convert.py — 새 엔드포인트 3개 추가 [백엔드 에이전트]

**파일: `backend/app/routes/voice_convert.py`**

**2-1. 변환된 보컬 스트리밍 엔드포인트**
```python
@router.get("/api/voice-convert/{generation_id}/converted-vocal/stream")
async def stream_converted_vocal(generation_id: str, current_user=Depends(get_current_user)):
```
- 인증 + 소유권 확인
- `voice_conversion_status`가 `"awaiting_merge"` 또는 `"completed"`일 때만 허용
- MinIO에서 `voice_converted_vocal_url` 필드의 객체를 스트리밍
- Content-Type: `audio/wav`

**2-2. MR(backing) 스트리밍 엔드포인트**
```python
@router.get("/api/voice-convert/{generation_id}/backing/stream")
async def stream_backing(generation_id: str, current_user=Depends(get_current_user)):
```
- 인증 + 소유권 확인
- `voice_conversion_status`가 `"awaiting_merge"` 또는 `"completed"`일 때만 허용
- MinIO에서 `voice_converted_backing_url` 필드의 객체를 스트리밍
- Content-Type: `audio/wav`

**2-3. 최종 합치기 엔드포인트**
```python
class MergeRequest(BaseModel):
    mr_pitch_shift: float = 0       # -12 ~ +12 반음
    vocal_volume: float = 1.0       # 0.0 ~ 2.0
    mr_volume: float = 1.0          # 0.0 ~ 2.0

@router.post("/api/voice-convert/{generation_id}/merge")
async def merge_voice_conversion(
    generation_id: str,
    body: MergeRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
```
- 인증 + 소유권 확인
- `voice_conversion_status`가 `"awaiting_merge"`일 때만 허용 (이미 `completed`면 재합치기 허용할지는 선택)
- 입력값 검증: `mr_pitch_shift`는 -12~+12, `vocal_volume`/`mr_volume`은 0.0~2.0
- 상태를 `"merging"`으로 변경 후 백그라운드 태스크로 `merge_vocal_and_backing` 호출
- 백그라운드 태스크 래퍼: `_run_merge` (기존 `_run_voice_convert`와 동일한 패턴, 별도 이벤트 루프 생성)

**2-4. status 응답 필드 추가**
기존 `get_voice_conversion_status` 엔드포인트의 응답에 필드 추가:
```python
return {
    ...기존 필드,
    "voice_converted_vocal_url": doc.get("voice_converted_vocal_url"),
    "voice_converted_backing_url": doc.get("voice_converted_backing_url"),
    "merge_settings": doc.get("merge_settings"),
}
```

**2-5. 기존 폴링 상태 체크에 "awaiting_merge" 반영**
기존 `start_voice_conversion`의 상태 체크에서 `"awaiting_merge"`도 재변환 가능하도록 허용:
```python
if vc_status in ("converting", "merging", "uploading"):
    return JSONResponse(status_code=409, content={"error": "이미 변환 중입니다."})
```

#### STEP 3: api/index.js — 새 API 함수 추가 [프론트엔드 에이전트]

**파일: `frontend/src/api/index.js`**

기존 Voice Conversion 섹션 아래에 추가:
```javascript
// Voice Conversion — MR Pitch Preview & Merge
export const voiceConvertVocalStreamUrl = (generationId) => {
  const token = localStorage.getItem('token');
  const base = `${window.location.protocol}//${window.location.hostname}:9000`;
  return `${base}/api/voice-convert/${generationId}/converted-vocal/stream?token=${encodeURIComponent(token)}`;
};
export const voiceConvertBackingStreamUrl = (generationId) => {
  const token = localStorage.getItem('token');
  const base = `${window.location.protocol}//${window.location.hostname}:9000`;
  return `${base}/api/voice-convert/${generationId}/backing/stream?token=${encodeURIComponent(token)}`;
};
export const mergeVoiceConvert = (generationId, data) =>
  API.post(`/voice-convert/${generationId}/merge`, data);
```

#### STEP 4: StudioTab2.jsx — MR 음정 조절 패널 UI [프론트엔드 에이전트]

**파일: `frontend/src/components/StudioTab2.jsx`**

**4-1. 새 state 변수 추가**
```javascript
// MR Pitch Merge Panel
const [mrPanelGenId, setMrPanelGenId] = useState(null);  // 현재 패널이 열린 generation ID
const [mrPitchShift, setMrPitchShift] = useState(0);      // -12 ~ +12 반음
const [vocalVolume, setVocalVolume] = useState(1.0);       // 0 ~ 2
const [mrVolume, setMrVolume] = useState(1.0);             // 0 ~ 2
const [merging, setMerging] = useState(false);

// Web Audio API refs
const audioCtxRef = useRef(null);
const vocalSourceRef = useRef(null);
const mrSourceRef = useRef(null);
const vocalGainRef = useRef(null);
const mrGainRef = useRef(null);
const vocalBufferRef = useRef(null);
const mrBufferRef = useRef(null);
const [previewPlaying, setPreviewPlaying] = useState(false);
const [buffersLoaded, setBuffersLoaded] = useState(false);
```

**4-2. Web Audio API 함수들**

`loadAudioBuffers(genId)`:
- `voiceConvertVocalStreamUrl(genId)`와 `voiceConvertBackingStreamUrl(genId)`에서 AudioBuffer 로드
- `fetch` + `audioCtx.decodeAudioData`
- 두 버퍼를 `vocalBufferRef`, `mrBufferRef`에 저장
- `setBuffersLoaded(true)`

`startPreview()`:
- AudioContext 생성 (없으면)
- vocalBuffer → AudioBufferSourceNode → GainNode → destination
- mrBuffer → AudioBufferSourceNode (detune 적용) → GainNode → destination
- `mrSource.detune.value = mrPitchShift * 100` (cents 단위)
- `vocalGain.gain.value = vocalVolume`
- `mrGain.gain.value = mrVolume`
- 두 소스 동시 start

`stopPreview()`:
- 재생 중인 소스 노드 stop + disconnect

`updatePreviewParams()` (useEffect):
- mrPitchShift, vocalVolume, mrVolume 변경 시 실시간 업데이트
- `mrSourceRef.current.detune.value = mrPitchShift * 100`
- `vocalGainRef.current.gain.value = vocalVolume`
- `mrGainRef.current.gain.value = mrVolume`

**4-3. 합치기 요청 함수**

`handleMerge(genId)`:
```javascript
setMerging(true);
try {
  await api.mergeVoiceConvert(genId, {
    mr_pitch_shift: mrPitchShift,
    vocal_volume: vocalVolume,
    mr_volume: mrVolume,
  });
  // 합치기가 백그라운드로 시작됨 → 폴링이 자동으로 감지
  setMrPanelGenId(null);
  fetchHistory();
} catch (err) { ... }
finally { setMerging(false); }
```

**4-4. UI 변경 — 기존 voice_conversion_status 분기 수정**

현재 (line 1039~1049): `status !== 'completed' && status !== 'failed'`일 때 진행 표시
변경: `"awaiting_merge"`를 별도 분기로 처리

```jsx
{/* 변환 진행 중 (pending, converting, merging, uploading) */}
{gen.voice_conversion_status &&
 !['completed', 'failed', 'awaiting_merge'].includes(gen.voice_conversion_status) && (
  <div className="s2__vc-status">
    <FiRepeat className="s2__spin" />
    <span>목소리 변환: {vcStatusLabel(gen.voice_conversion_status)}</span>
    {gen.voice_conversion_progress > 0 && (
      <span className="s2__vc-progress">{gen.voice_conversion_progress}%</span>
    )}
    <div className="s2__vc-bar">
      <div className="s2__vc-bar-fill" style={{ width: `${gen.voice_conversion_progress || 0}%` }} />
    </div>
  </div>
)}

{/* awaiting_merge: MR 음정 조절 패널 */}
{gen.voice_conversion_status === 'awaiting_merge' && (
  <div className="s2__mr-panel">
    <div className="s2__mr-panel-header">
      <FiSliders /> MR 음정 조절 & 미리듣기
    </div>

    {/* 음정 슬라이더 */}
    <div className="s2__mr-pitch">
      <label>MR 음정: {mrPanelGenId === gen.id ? (mrPitchShift > 0 ? `+${mrPitchShift}` : mrPitchShift) : 0} 반음</label>
      <div className="s2__mr-pitch-controls">
        <button onClick={() => setMrPitchShift(p => Math.max(-12, p - 1))}>-1</button>
        <button onClick={() => setMrPitchShift(p => Math.max(-12, p - 0.5))}>-0.5</button>
        <input type="range" min="-12" max="12" step="0.5"
          value={mrPanelGenId === gen.id ? mrPitchShift : 0}
          onChange={e => { setMrPanelGenId(gen.id); setMrPitchShift(parseFloat(e.target.value)); }}
        />
        <button onClick={() => setMrPitchShift(p => Math.min(12, p + 0.5))}>+0.5</button>
        <button onClick={() => setMrPitchShift(p => Math.min(12, p + 1))}>+1</button>
      </div>
    </div>

    {/* 볼륨 슬라이더 */}
    <div className="s2__mr-volumes">
      <div className="s2__mr-vol">
        <label>보컬 볼륨: {Math.round((mrPanelGenId === gen.id ? vocalVolume : 1) * 100)}%</label>
        <input type="range" min="0" max="2" step="0.05"
          value={mrPanelGenId === gen.id ? vocalVolume : 1}
          onChange={e => { setMrPanelGenId(gen.id); setVocalVolume(parseFloat(e.target.value)); }}
        />
      </div>
      <div className="s2__mr-vol">
        <label>MR 볼륨: {Math.round((mrPanelGenId === gen.id ? mrVolume : 1) * 100)}%</label>
        <input type="range" min="0" max="2" step="0.05"
          value={mrPanelGenId === gen.id ? mrVolume : 1}
          onChange={e => { setMrPanelGenId(gen.id); setMrVolume(parseFloat(e.target.value)); }}
        />
      </div>
    </div>

    {/* 미리듣기 버튼 */}
    <div className="s2__mr-preview">
      <button onClick={() => previewPlaying ? stopPreview() : startPreview(gen.id)}
              disabled={!buffersLoaded && !previewPlaying}>
        {previewPlaying ? <><FiPause /> 미리듣기 중지</> : <><FiPlay /> 합친 미리듣기</>}
      </button>
      <button onClick={() => { setMrPitchShift(0); setVocalVolume(1); setMrVolume(1); }}>
        <FiRefreshCw /> 초기화
      </button>
    </div>

    {/* 최종 합치기 버튼 */}
    <button className="s2__mr-merge-btn" onClick={() => handleMerge(gen.id)} disabled={merging}>
      {merging ? <><FiLoader className="s2__spin" /> 합치는 중...</> : <><FiCheck /> 이 설정으로 최종 합치기</>}
    </button>
  </div>
)}
```

**4-5. 폴링 로직 수정**

기존 (line 124-126): `voice_conversion_status`가 `completed`/`failed`/`null`이 아니면 폴링
변경: `"awaiting_merge"`도 폴링 중지 대상에 추가:
```javascript
const hasProcessing = generations.some((g) =>
  g.status === 'processing' || g.status === 'pending' ||
  (g.voice_conversion_status &&
   !['completed', 'failed', 'awaiting_merge'].includes(g.voice_conversion_status))
);
```

**4-6. vcStatusLabel 함수에 "awaiting_merge" 추가**
```javascript
case 'awaiting_merge': return 'MR 음정 조절 대기 중';
```

**4-7. 패널 열릴 때 AudioBuffer 자동 로드**

`useEffect`로 `mrPanelGenId` 또는 generation의 `voice_conversion_status`가 `"awaiting_merge"`로 바뀔 때 자동으로 `loadAudioBuffers` 호출:
```javascript
useEffect(() => {
  const awaitingGen = generations.find(g =>
    g.voice_conversion_status === 'awaiting_merge' && g.id
  );
  if (awaitingGen && mrPanelGenId !== awaitingGen.id) {
    setMrPanelGenId(awaitingGen.id);
    setMrPitchShift(0);
    setVocalVolume(1);
    setMrVolume(1);
    setBuffersLoaded(false);
    loadAudioBuffers(awaitingGen.id);
  }
}, [generations]);
```

#### STEP 5: StudioTab2.css — MR 조절 패널 스타일 [프론트엔드 에이전트]

**파일: `frontend/src/components/StudioTab2.css`**

새 클래스 추가:
- `.s2__mr-panel` — 패널 컨테이너 (배경색, 패딩, 둥근 모서리, 그라데이션 보더)
- `.s2__mr-panel-header` — 패널 제목 (아이콘 + 텍스트)
- `.s2__mr-pitch` — 음정 슬라이더 영역
- `.s2__mr-pitch-controls` — 버튼 + range input 가로 배치 (flexbox)
- `.s2__mr-volumes` — 볼륨 슬라이더 2개 가로 배치
- `.s2__mr-vol` — 개별 볼륨 슬라이더
- `.s2__mr-preview` — 미리듣기/초기화 버튼 영역
- `.s2__mr-merge-btn` — 최종 합치기 버튼 (강조색, 큰 크기)
- range input 커스텀 스타일 (accent-color 또는 -webkit-slider)

### 테스트 계획

#### 백엔드 테스트

1. RVC 변환 완료 후 상태가 `"awaiting_merge"`로 변경되는지 확인
2. MinIO에 `converted_vocal.wav`와 `backing.wav`가 정상 저장되는지 확인
3. `GET /status` 응답에 `voice_converted_vocal_url`, `voice_converted_backing_url` 포함 확인
4. `GET /converted-vocal/stream` — WAV 스트리밍 정상 확인
5. `GET /backing/stream` — WAV 스트리밍 정상 확인
6. `POST /merge` — `mr_pitch_shift=0` (기본값)으로 합치기 정상 확인
7. `POST /merge` — `mr_pitch_shift=2` (2반음 올림)으로 합치기 후 피치 변경 확인
8. `POST /merge` — `mr_pitch_shift=-3` (3반음 내림)으로 합치기 확인
9. `POST /merge` — `vocal_volume=0.5, mr_volume=1.5`로 볼륨 조절 확인
10. `POST /merge` — 잘못된 상태(`converting`)에서 호출 시 에러 응답 확인
11. 합치기 완료 후 상태가 `"completed"`로 변경, `voice_converted_url` 설정 확인
12. 합치기 완료 후 기존 stream/download 엔드포인트로 최종 mp3 재생/다운로드 확인

#### 프론트엔드 테스트

1. RVC 변환 완료 시 MR 음정 조절 패널 자동 표시 확인
2. 음정 슬라이더 드래그 시 값 실시간 표시 확인
3. ±0.5, ±1 버튼 클릭 시 슬라이더 값 변경 확인
4. 보컬/MR 볼륨 슬라이더 동작 확인
5. "합친 미리듣기" 클릭 시 Web Audio API로 두 소스 동시 재생 확인
6. 미리듣기 중 음정/볼륨 변경 시 실시간 반영 확인 (detune + gain)
7. "초기화" 버튼 클릭 시 모든 값 기본값 복원 확인
8. "이 설정으로 최종 합치기" 클릭 → POST /merge 호출 → 진행 표시 확인
9. 합치기 완료 후 기존 completed UI(재생/다운로드/업로드) 정상 표시 확인
10. 페이지 새로고침 후 `awaiting_merge` 상태 유지 + 패널 재표시 확인

### 의존성 그래프

```
STEP 1 (kits_service.py — 파이프라인 분리 + merge 함수)
  └──> STEP 2 (voice_convert.py — 새 엔드포인트 3개)
         └──────────────────────────────────────┐
STEP 3 (api/index.js — API 함수) ──────────────┤
                                                ├──> STEP 4 (StudioTab2.jsx — UI)
STEP 5 (StudioTab2.css — 스타일) ──────────────┘
```

### 주의사항

1. **rubberband 필터**: ffmpeg에 `librubberband`가 설치되어 있어야 `rubberband` 피치 필터 사용 가능. 미설치 시 `asetrate+aresample+atempo` 조합으로 fallback 구현 필수.
2. **WAV 파일 크기**: converted_vocal.wav와 backing.wav는 비압축 WAV이므로 1분 기준 약 10MB. 프론트엔드에서 fetch 시 로딩 시간 고려하여 로딩 인디케이터 표시.
3. **Web Audio API detune**: `AudioBufferSourceNode.detune`은 cents 단위 (100 cents = 1 반음). `mrPitchShift * 100`으로 변환.
4. **AudioBufferSourceNode 재사용 불가**: `source.start()` 후에는 재사용 불가. 재생할 때마다 새 소스 노드 생성 필요.
5. **CORS**: MinIO 또는 백엔드 프록시에서 WAV 스트리밍 시 CORS 헤더가 올바르게 설정되어 있어야 `fetch` + `decodeAudioData` 가능.
6. **awaiting_merge 상태 폴링 제외**: `awaiting_merge`는 사용자 액션을 기다리는 상태이므로 자동 폴링 대상에서 제외해야 불필요한 API 호출을 방지.
7. **재합치기 허용**: `completed` 상태에서도 "다시 합치기" 버튼을 제공하여 다른 피치/볼륨으로 재합치기 가능하도록 고려. 이 경우 `POST /merge`에서 `completed` 상태도 허용.
8. **백그라운드 태스크 이벤트 루프**: `_run_merge` 래퍼는 기존 `_run_voice_convert`와 동일한 패턴으로 별도 이벤트 루프에서 실행해야 함 (Motor 클라이언트 새로 생성 필요).

### 체크리스트

- [ ] STEP 1: `kits_service.py` — `convert_voice`에서 Step f(ffmpeg 합치기) 제거
- [ ] STEP 1: `kits_service.py` — converted_vocal.wav MinIO 업로드 추가
- [ ] STEP 1: `kits_service.py` — 상태를 `"awaiting_merge"`로 변경
- [ ] STEP 1: `kits_service.py` — `merge_vocal_and_backing` 함수 신규 작성
- [ ] STEP 1: `kits_service.py` — ffmpeg MR 피치 조절 (rubberband + fallback)
- [ ] STEP 1: `kits_service.py` — ffmpeg 보컬/MR 볼륨 조절 + 합치기
- [ ] STEP 2: `voice_convert.py` — `GET /converted-vocal/stream` 엔드포인트
- [ ] STEP 2: `voice_convert.py` — `GET /backing/stream` 엔드포인트
- [ ] STEP 2: `voice_convert.py` — `POST /merge` 엔드포인트 + `MergeRequest` 모델
- [ ] STEP 2: `voice_convert.py` — `_run_merge` 백그라운드 래퍼
- [ ] STEP 2: `voice_convert.py` — status 응답에 `voice_converted_vocal_url`, `voice_converted_backing_url` 추가
- [ ] STEP 2: `voice_convert.py` — 상태 체크에 `"awaiting_merge"` 반영
- [ ] STEP 3: `api/index.js` — `voiceConvertVocalStreamUrl` 함수
- [ ] STEP 3: `api/index.js` — `voiceConvertBackingStreamUrl` 함수
- [ ] STEP 3: `api/index.js` — `mergeVoiceConvert` 함수
- [ ] STEP 4: `StudioTab2.jsx` — MR 패널 state 변수 추가
- [ ] STEP 4: `StudioTab2.jsx` — Web Audio API 함수 (loadBuffers, startPreview, stopPreview)
- [ ] STEP 4: `StudioTab2.jsx` — 음정 슬라이더 + ±0.5/±1 버튼 UI
- [ ] STEP 4: `StudioTab2.jsx` — 보컬/MR 볼륨 슬라이더 UI
- [ ] STEP 4: `StudioTab2.jsx` — 미리듣기/초기화 버튼
- [ ] STEP 4: `StudioTab2.jsx` — "최종 합치기" 버튼 + handleMerge 함수
- [ ] STEP 4: `StudioTab2.jsx` — 폴링 로직에 `"awaiting_merge"` 제외 추가
- [ ] STEP 4: `StudioTab2.jsx` — vcStatusLabel에 `"awaiting_merge"` 추가
- [ ] STEP 5: `StudioTab2.css` — MR 패널 전체 스타일

## v18 — MR 음정 조절 품질 개선: asetrate → rubberband (2026-03-30)

### 배경

현재 `merge_vocal_and_backing` 함수에서 MR 음정 조절 시 ffmpeg의 `asetrate + aresample` 필터를 사용한다. 이 방식은 샘플레이트를 변경하여 피치를 조절하는 원시적인 방법으로, 음질 열화(포먼트 왜곡, 메탈릭한 느낌)가 발생한다. ffmpeg에 내장된 `rubberband` 필터로 교체하면 타임스트레칭 알고리즘 기반의 고품질 피치 시프트가 가능하다.

### 현재 코드 (변경 전)

**파일: `backend/app/services/kits_service.py` — `merge_vocal_and_backing` 함수 (L395~L404)**

```python
# MR: pitch shift (using asetrate + aresample) + volume
# asetrate changes pitch by changing sample rate, atempo compensates speed
if mr_pitch_shift != 0:
    # Calculate rate multiplier: 2^(semitones/12)
    import math
    rate_mult = math.pow(2, mr_pitch_shift / 12.0)
    # asetrate changes both pitch and speed, aresample restores original speed
    mr_filter = "asetrate=44100*{},aresample=44100,volume={}".format(rate_mult, mr_volume)
else:
    mr_filter = "volume={}".format(mr_volume)
```

**문제점:**
- `asetrate`는 샘플레이트를 물리적으로 변경하여 피치를 올림/내림 → 포먼트(음색)까지 함께 변형
- `aresample`로 원래 샘플레이트로 복원하지만, 이미 왜곡된 음질은 복원 불가
- 반음 단위 이상 시프트 시 "치프먼크"/"로봇" 같은 부자연스러운 소리 발생

### 변경 내용

**파일: `backend/app/services/kits_service.py` — `merge_vocal_and_backing` 함수**

`asetrate + aresample` 필터를 `rubberband` 필터로 교체한다.

```python
# MR: pitch shift (using rubberband for high-quality pitch shifting) + volume
if mr_pitch_shift != 0:
    import math
    ratio = math.pow(2, mr_pitch_shift / 12.0)
    mr_filter = "rubberband=pitch={},volume={}".format(ratio, mr_volume)
else:
    mr_filter = "volume={}".format(mr_volume)
```

**변경 포인트:**
- `asetrate=44100*{rate_mult},aresample=44100` → `rubberband=pitch={ratio}`
- rubberband 라이브러리는 타임스트레칭 기반으로 속도를 유지하면서 피치만 변경
- 포먼트 보존으로 자연스러운 음정 변경
- `ratio` 계산식은 동일: `2^(semitones/12)`

### 사전 조건

- ffmpeg이 `--enable-librubberband` 옵션으로 빌드되어 있어야 함
- 시스템에 `librubberband-dev` 패키지 설치 필요:
  ```bash
  # Ubuntu/Debian
  sudo apt install librubberband-dev

  # 확인: ffmpeg이 rubberband 필터를 지원하는지 체크
  ffmpeg -filters 2>/dev/null | grep rubberband
  ```
- Docker 환경이라면 Dockerfile에 패키지 추가 필요

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/services/kits_service.py` | `merge_vocal_and_backing` 함수의 MR 피치 조절 필터를 `asetrate/aresample` → `rubberband=pitch=` 로 교체 |

### 체크리스트

- [ ] STEP 1: `kits_service.py` — `merge_vocal_and_backing` 함수에서 `asetrate/aresample` 필터를 `rubberband=pitch=` 필터로 교체
- [ ] STEP 2: 서버에서 `ffmpeg -filters | grep rubberband` 로 rubberband 필터 지원 확인
- [ ] STEP 3: (필요시) `librubberband-dev` 패키지 설치 또는 Dockerfile 업데이트
- [ ] STEP 4: MR 음정 ±1~±6 반음 범위에서 합치기 테스트 → 음질 비교

---

## v19 — StudioTab2 "테스트 Wondera" 탭 추가 (2026-03-30)

### 배경

Wondera API를 통한 음악 생성 기능을 테스트하기 위해 StudioTab2에 새로운 모드 탭을 추가한다. 브라우저에서 직접 Wondera API를 호출하면 Cloudflare가 차단하므로, 백엔드에서 프록시 라우트를 구성하여 우회한다.

### Wondera API 정보

- Base URL: `https://api.wondera.ai/v1`
- 인증: `x-api-key: {key}` 헤더
- 보컬 업로드: `POST /v1/files/upload` (multipart/form-data, fields: file + purpose="vocal")
- 음악 생성: `POST /v1/song/generate` (JSON body: lyrics, model, prompt, vocal_id)
- 상태 조회: `GET /v1/song/query/{task_id}`

### 변경 내용

#### 1. 백엔드 — Wondera 프록시 라우트

**신규 파일: `backend/app/routes/wondera.py`**

3개의 프록시 엔드포인트를 생성한다. 모든 요청에 `x-api-key` 헤더와 브라우저 유사 `User-Agent`를 붙여 Cloudflare 우회를 시도한다.

```python
# backend/app/routes/wondera.py
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
from app.config import settings

router = APIRouter(prefix="/api/wondera", tags=["wondera"])

WONDERA_BASE = "https://api.wondera.ai/v1"
HEADERS = {
    "x-api-key": settings.wondera_api_key,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# ── 보컬 업로드 프록시 ──
@router.post("/upload-vocal")
async def upload_vocal(file: UploadFile = File(...)):
    """보컬 파일을 Wondera에 업로드하고 vocal_id를 반환"""
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{WONDERA_BASE}/files/upload",
            headers=HEADERS,
            files={"file": (file.filename, await file.read(), file.content_type)},
            data={"purpose": "vocal"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ── 음악 생성 프록시 ──
class GenerateRequest(BaseModel):
    lyrics: str
    model: str = "auto"
    prompt: str = ""
    vocal_id: Optional[str] = None

@router.post("/generate")
async def generate_song(req: GenerateRequest):
    """Wondera 음악 생성 요청을 프록시"""
    body = req.dict(exclude_none=True)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{WONDERA_BASE}/song/generate",
            headers={**HEADERS, "Content-Type": "application/json"},
            json=body,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ── 생성 상태 조회 프록시 ──
@router.get("/query/{task_id}")
async def query_task(task_id: str):
    """task_id로 생성 진행 상황 조회"""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{WONDERA_BASE}/song/query/{task_id}",
            headers=HEADERS,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()
```

#### 2. 백엔드 — config.py에 wondera_api_key 추가

**파일: `backend/app/config.py` (L66 `lalal_api_key` 아래)**

현재 Wondera 관련 설정이 없으므로 추가한다.

```python
    # LALAL.AI Vocal Enhancement
    lalal_api_key: str = ""

    # Wondera Music Generation
    wondera_api_key: str = ""
```

#### 3. 백엔드 — .env에 WONDERA_API_KEY 추가

**파일: `backend/.env`**

```
WONDERA_API_KEY=여기에_실제_키_입력
```

#### 4. 백엔드 — main.py에 wondera 라우터 등록

**파일: `backend/app/main.py` (L81 `vocal_repair` 라우터 아래)**

```python
from app.routes import wondera          # 추가
...
app.include_router(vocal_repair.router)
app.include_router(wondera.router)      # 추가
```

#### 5. 프론트엔드 — StudioTab2.jsx mode에 'wondera' 추가

**파일: `frontend/src/components/StudioTab2.jsx`**

**(a) mode 상태 — L310 변경 없음 (기본값 'custom' 유지)**

**(b) 모드 토글 바 — L770~L783 영역에 버튼 추가**

```jsx
{/* ─── Mode Toggle ─── */}
<div className="s2__mode-bar">
  <button
    className={`s2__mode-btn ${mode === 'simple' ? 's2__mode-btn--active' : ''}`}
    onClick={() => setMode('simple')}
  >
    <FiZap /> 간편 모드
  </button>
  <button
    className={`s2__mode-btn ${mode === 'custom' ? 's2__mode-btn--active' : ''}`}
    onClick={() => setMode('custom')}
  >
    <FiSliders /> 커스텀 모드
  </button>
  {/* ▼ 추가 */}
  <button
    className={`s2__mode-btn ${mode === 'wondera' ? 's2__mode-btn--active' : ''}`}
    onClick={() => setMode('wondera')}
  >
    🧪 테스트 Wondera
  </button>
</div>
```

**(c) WonderaTestSection — mode === 'wondera' 블록 추가 (custom 블록 닫힌 직후)**

StudioTab2.jsx 내부에 인라인으로 작성한다. 별도 컴포넌트 파일이 아닌 같은 파일 내 JSX 블록으로 구현.

```jsx
{mode === 'wondera' && (
  <div className="s2__form">
    <h3 style={{ marginBottom: 12 }}>🧪 Wondera 음악 생성 테스트</h3>

    {/* 보컬 업로드 */}
    <div className="s2__section">
      <label className="s2__label">보컬 파일 업로드 (mp3, m4a)</label>
      <input
        type="file"
        accept=".mp3,.m4a"
        onChange={handleWonderaVocalUpload}
      />
      {wonderaVocalId && (
        <p style={{ color: '#4caf50', fontSize: 13 }}>
          ✅ vocal_id: {wonderaVocalId}
        </p>
      )}
    </div>

    {/* 가사 */}
    <div className="s2__section">
      <label className="s2__label">가사</label>
      <textarea
        className="s2__textarea"
        rows={8}
        value={wonderaLyrics}
        onChange={e => setWonderaLyrics(e.target.value)}
        placeholder="가사를 입력하세요..."
      />
    </div>

    {/* 스타일 프롬프트 */}
    <div className="s2__section">
      <label className="s2__label">스타일 프롬프트</label>
      <input
        className="s2__input"
        value={wonderaPrompt}
        onChange={e => setWonderaPrompt(e.target.value)}
        placeholder="예: K-pop, ballad, female vocal"
      />
    </div>

    {/* 모델 선택 */}
    <div className="s2__section">
      <label className="s2__label">모델</label>
      <select
        className="s2__select"
        value={wonderaModel}
        onChange={e => setWonderaModel(e.target.value)}
      >
        <option value="auto">auto (자동 선택)</option>
        <option value="wondera-2.1">wondera-2.1</option>
        <option value="wondera-2.2">wondera-2.2</option>
        <option value="wondera-o1">wondera-o1</option>
        <option value="wondera-o2">wondera-o2</option>
      </select>
    </div>

    {/* 생성 버튼 */}
    <div className="s2__section" style={{ display: 'flex', gap: 12 }}>
      <button
        className="s2__btn s2__btn--primary"
        onClick={() => handleWonderaGenerate(false)}
        disabled={wonderaLoading}
      >
        🎵 AI 보컬로 생성
      </button>
      <button
        className="s2__btn s2__btn--secondary"
        onClick={() => handleWonderaGenerate(true)}
        disabled={wonderaLoading || !wonderaVocalId}
      >
        🎤 내 목소리로 생성
      </button>
    </div>

    {/* 로딩 / 상태 */}
    {wonderaLoading && (
      <p style={{ color: '#ff9800' }}>⏳ 생성 중... (task: {wonderaTaskId})</p>
    )}

    {/* 결과 2칸 비교 */}
    {wonderaResults.length > 0 && (
      <div className="s2__section">
        <label className="s2__label">결과 비교</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {wonderaResults.map((r, i) => (
            <div key={i} style={{ background: '#1e1e2e', borderRadius: 8, padding: 12 }}>
              <p style={{ fontSize: 13, marginBottom: 8 }}>#{i + 1}</p>
              <audio controls src={r.url} style={{ width: '100%' }} />
              <a
                href={r.url}
                download
                style={{ display: 'block', marginTop: 8, color: '#7c5cfc', fontSize: 13 }}
              >
                ⬇ 다운로드
              </a>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

**(d) 상태 변수 추가 — 컴포넌트 상단 (L310 근처)**

```jsx
// Wondera test states
const [wonderaVocalId, setWonderaVocalId] = useState(null);
const [wonderaLyrics, setWonderaLyrics] = useState(
  '[verse]\n여기에 기본 가사\n\n[chorus]\n후렴 가사'
);
const [wonderaPrompt, setWonderaPrompt] = useState('K-pop, dance, energetic');
const [wonderaModel, setWonderaModel] = useState('auto');
const [wonderaLoading, setWonderaLoading] = useState(false);
const [wonderaTaskId, setWonderaTaskId] = useState(null);
const [wonderaResults, setWonderaResults] = useState([]);
```

**(e) 핸들러 함수 추가**

```jsx
// ── Wondera: 보컬 업로드 ──
const handleWonderaVocalUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/wondera/upload-vocal', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');
    setWonderaVocalId(data.id || data.file_id || data.vocal_id);
  } catch (err) {
    alert('보컬 업로드 실패: ' + err.message);
  }
};

// ── Wondera: 음악 생성 ──
const handleWonderaGenerate = async (useMyVocal) => {
  setWonderaLoading(true);
  setWonderaResults([]);
  try {
    const body = {
      lyrics: wonderaLyrics,
      model: wonderaModel,
      prompt: wonderaPrompt,
    };
    if (useMyVocal && wonderaVocalId) {
      body.vocal_id = wonderaVocalId;
    }
    const res = await fetch('/api/wondera/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Generate failed');
    const taskId = data.task_id;
    setWonderaTaskId(taskId);
    // Poll until complete
    pollWonderaTask(taskId);
  } catch (err) {
    alert('생성 실패: ' + err.message);
    setWonderaLoading(false);
  }
};

// ── Wondera: 폴링 ──
const pollWonderaTask = async (taskId) => {
  const MAX_POLLS = 120; // 최대 10분 (5초 간격)
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await fetch(`/api/wondera/query/${taskId}`);
      const data = await res.json();
      if (data.status === 'completed' || data.status === 'success') {
        const songs = data.songs || data.data?.songs || [];
        setWonderaResults(songs.map(s => ({ url: s.url || s.audio_url })));
        setWonderaLoading(false);
        return;
      }
      if (data.status === 'failed' || data.status === 'error') {
        throw new Error(data.message || 'Generation failed');
      }
      // else: still processing, continue polling
    } catch (err) {
      alert('조회 실패: ' + err.message);
      setWonderaLoading(false);
      return;
    }
  }
  alert('타임아웃: 10분 초과');
  setWonderaLoading(false);
};
```

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/routes/wondera.py` | **신규** — Wondera API 프록시 라우트 3개 (upload-vocal, generate, query) |
| 2 | `backend/app/config.py` | `wondera_api_key` 설정 추가 (L66 lalal_api_key 아래) |
| 3 | `backend/.env` | `WONDERA_API_KEY` 환경변수 추가 |
| 4 | `backend/app/main.py` | wondera 라우터 import + include_router 등록 (L81 아래) |
| 5 | `frontend/src/components/StudioTab2.jsx` | mode='wondera' 토글 버튼 + 상태변수 + 핸들러 + JSX 블록 추가 |

### 체크리스트

- [ ] STEP 1: `backend/app/config.py` — `wondera_api_key: str = ""` 추가 (lalal_api_key 아래)
- [ ] STEP 2: `backend/.env` — `WONDERA_API_KEY=실제키` 추가
- [ ] STEP 3: `backend/app/routes/wondera.py` — 신규 생성 (upload-vocal, generate, query 프록시)
- [ ] STEP 4: `backend/app/main.py` — `from app.routes import wondera` + `app.include_router(wondera.router)` 추가
- [ ] STEP 5: `frontend/src/components/StudioTab2.jsx` — Wondera 상태변수 7개 추가 (L310 근처)
- [ ] STEP 6: `frontend/src/components/StudioTab2.jsx` — 핸들러 3개 추가 (handleWonderaVocalUpload, handleWonderaGenerate, pollWonderaTask)
- [ ] STEP 7: `frontend/src/components/StudioTab2.jsx` — 모드 토글에 "테스트 Wondera" 버튼 추가 (L783 근처)
- [ ] STEP 8: `frontend/src/components/StudioTab2.jsx` — `{mode === 'wondera' && (...)}` JSX 블록 추가
- [ ] STEP 9: 백엔드 재시작 후 `POST /api/wondera/generate` 테스트
- [ ] STEP 10: 프론트에서 "테스트 Wondera" 탭 → AI 보컬로 생성 → 결과 확인

## v20 — MV 생성 파이프라인 개선: 시나리오 생성 + image_prompt/video_prompt 분리 (2026-03-31)

### 배경

현재 MV 파이프라인은 씬 분할 시 `description` 하나로 이미지 생성과 영상 생성을 모두 처리한다. 이미지에 필요한 정보(구도, 조명, 색감)와 영상에 필요한 정보(카메라 무빙, 화면 전환, 움직임)가 혼재되어 있어 각각의 품질이 최적화되지 않는다.

또한 씬 분할 GPT가 전체 스토리를 즉흥적으로 만들기 때문에, 먼저 소설형 시나리오를 생성한 뒤 이를 기반으로 씬을 분할하면 더 일관된 스토리텔링이 가능하다.

### 현재 파이프라인 흐름

```
1. 씬 분할 (GPT) → [{scene_number, description, lyrics_segment}]
2. 커버 이미지 생성 (Gemini) → 제목+장르+분위기만 사용
3. 씬 이미지 생성 (Gemini) → description으로 이미지 생성
4. 영상 생성 (Veo/Kling) → description + "smooth cinematic camera movement"
5. 합치기
```

### 개선 파이프라인 흐름

```
1. [NEW] 시나리오 생성 (GPT) → 소설형 스토리 텍스트
2. [개선] 커버 이미지 생성 (Gemini) → 시나리오 전문 포함
3. [개선] 씬 분할 (GPT) → image_prompt + video_prompt 분리
4. [개선] 씬 이미지 생성 (Gemini) → image_prompt 사용
5. [개선] 영상 생성 (Veo/Kling) → image_prompt + video_prompt 합쳐서 사용
6. 합치기 (기존 유지)
```

### 1단계: 시나리오 생성 (NEW)

`mv_generator.py`에 `generate_mv_scenario()` 함수를 신규 추가한다.

**입력:**
- `title` (str) — 곡 제목
- `genre` (str, optional) — 장르
- `mood` (str, optional) — 분위기
- `lyrics` (str, optional) — 가사
- `character_name` (str, optional) — 캐릭터 이름 (사용 시 주인공 이름으로)

**출력:**
- `str` — 짧은 소설형 시나리오 텍스트 (500~1000자 내외, 한국어)

**GPT 시스템 프롬프트 설계:**

```
You are a music video scenario writer. Write a short cinematic scenario 
(a mini novel, 500-1000 characters in Korean) for a music video.

Input: song title, genre, mood, lyrics, and optionally a character name.

Rules:
- Write a vivid, cinematic short story that captures the emotional arc of the song.
- If a character name is provided, use that name as the protagonist.
- If no character name, use a generic protagonist (e.g., "한 남자", "한 여자").
- Structure: 도입(분위기 설정) → 전개(감정 심화) → 절정(클라이맥스) → 결말(여운)
- Focus on visual imagery: locations, lighting, weather, character actions/expressions.
- Do NOT include dialogue or song lyrics in the scenario.
- Output the scenario text only, no JSON, no markdown.
```

### 2단계: 커버 이미지 생성 개선

`cover_generator.py`의 `generate_cover_image()` 함수 시그니처를 변경한다.

**현재:**
```python
async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    character_image_bytes: bytes = None,
) -> bytes:
```

**변경:**
```python
async def generate_cover_image(
    title: str,
    genre: str = None,
    mood: str = None,
    style: str = None,
    character_image_bytes: bytes = None,
    scenario: str = None,           # NEW
) -> bytes:
```

**프롬프트 변경:**
- `scenario`가 있으면 프롬프트에 추가:
  ```
  "Story synopsis for visual reference: {scenario}"
  ```

### 3단계: 씬 분할 개선

`mv_generator.py`의 `split_lyrics_into_scenes()` 함수에 `scenario` 파라미터를 추가하고, 출력 JSON 구조를 변경한다.

**현재 시그니처:**
```python
async def split_lyrics_into_scenes(
    lyrics: Optional[str],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scene_count: int = 20,
    user_scene_prompt: Optional[str] = None,
    music_sections: Optional[List[dict]] = None,
) -> List[dict]:
```

**변경 시그니처:**
```python
async def split_lyrics_into_scenes(
    lyrics: Optional[str],
    title: str,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    scene_count: int = 20,
    user_scene_prompt: Optional[str] = None,
    music_sections: Optional[List[dict]] = None,
    scenario: Optional[str] = None,     # NEW
) -> List[dict]:
```

**현재 출력 JSON:**
```json
[
  {"scene_number": 1, "description": "...", "lyrics_segment": "..."}
]
```

**변경 출력 JSON:**
```json
[
  {
    "scene_number": 1,
    "image_prompt": "카메라 구도, 조명, 색감, 인물 배치, 배경 묘사 포함한 스틸 이미지 프롬프트",
    "video_prompt": "카메라 무빙(패닝, 틸트, 줌 등), 인물 동작, 화면 전환 효과 프롬프트",
    "lyrics_segment": "가사 구간"
  }
]
```

**시스템 프롬프트 변경 핵심:**
- `SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE`에 시나리오 컨텍스트 추가
- `description` 대신 `image_prompt`와 `video_prompt` 두 필드를 출력하도록 변경
- `image_prompt`: 정적인 한 장면 — 구도(wide shot, close-up 등), 조명(golden hour, neon 등), 색감(warm tones, desaturated 등), 인물 위치와 표정, 배경 디테일
- `video_prompt`: 동적인 움직임 — 카메라 무빙(slow pan left, dolly in 등), 인물 동작(walks slowly, turns around 등), 환경 변화(wind blows hair, rain starts 등)
- `SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE`도 동일하게 변경
- `SECTION_SCENE_PLAN_SYSTEM_PROMPT`도 동일하게 변경 (clip 내에 `image_prompt`, `video_prompt` 분리)

**하위호환:** `_split_with_music_sections()` 내부 flatten 로직에서 `description` 대신 `image_prompt` 사용. 기존 `description` 필드는 `image_prompt`로 대체됨.

### 4단계: 씬 이미지 생성 개선

`mv_pipeline.py`의 `run_phase2_images()`에서:

**현재 (L338-339):**
```python
img_bytes = await generate_scene_image(
    scene["description"],
    ...
)
```

**변경:**
```python
img_bytes = await generate_scene_image(
    scene.get("image_prompt") or scene.get("description", ""),
    ...
)
```

`image_prompt`가 있으면 사용하고, 없으면 기존 `description`으로 폴백한다.

### 5단계: 영상 생성 개선

`mv_pipeline.py`의 `run_phase3_videos()`에서:

**현재 (L498-504):**
```python
if use_kling:
    task_or_op = await start_scene_video_kling(
        scene["description"], image_bytes
    )
else:
    task_or_op = await start_scene_video(
        scene["description"], image_bytes
    )
```

**변경:**
```python
# image_prompt + video_prompt 합치기
video_full_prompt = scene.get("image_prompt") or scene.get("description", "")
if scene.get("video_prompt"):
    video_full_prompt = "{} | Camera/Motion: {}".format(
        video_full_prompt, scene["video_prompt"]
    )

if use_kling:
    task_or_op = await start_scene_video_kling(
        video_full_prompt, image_bytes
    )
else:
    task_or_op = await start_scene_video(
        video_full_prompt, image_bytes
    )
```

`start_scene_video()` 내부에서 기존에 붙이던 `"smooth cinematic camera movement"`는 제거하거나 `video_prompt`가 없을 때만 폴백으로 유지한다.

### 6단계: mv_pipeline.py Phase 1 수정

`run_phase1_split()`에서 시나리오 생성 단계를 Phase 1a 전에 추가한다.

**현재 흐름:**
```
Phase 1a: 음악 구조 분석 (Gemini Audio)
Phase 1b: 씬 분할 (GPT)
```

**변경 흐름:**
```
Phase 1-scenario: 시나리오 생성 (GPT) — NEW
Phase 1a: 음악 구조 분석 (Gemini Audio) — 기존 유지
Phase 1b: 씬 분할 (GPT) — scenario 파라미터 추가
```

**코드 변경 (L143 `run_phase1_split` 함수 내부):**

```python
# ── Phase 1-scenario: Generate MV scenario ──
scenario = None
try:
    from .mv_generator import generate_mv_scenario
    scenario = await generate_mv_scenario(
        title=job["title"],
        genre=job.get("genre"),
        mood=job.get("mood"),
        lyrics=job.get("lyrics"),
        character_name=None,  # TODO: job에 character_name 추가 시 연결
    )
    await _update_job(mongo_db, job_id, {
        "scenario": scenario,
        "progress": 1,
    })
    logger.info("Phase1: scenario generated for job %s (%d chars)", job_id, len(scenario))
except Exception as e:
    logger.warning("Phase1: scenario generation failed for job %s: %s (continuing without)", job_id, e)
    # Non-fatal: continue without scenario

# ... (기존 Phase 1a: music structure analysis) ...

# ── Phase 1b: Scene planning ── (scenario 전달 추가)
scenes_raw = await split_lyrics_into_scenes(
    lyrics=job.get("lyrics"),
    title=job["title"],
    genre=job.get("genre"),
    mood=job.get("mood"),
    scene_count=scene_count,
    user_scene_prompt=job.get("scene_prompt"),
    music_sections=music_sections,
    scenario=scenario,          # NEW
)
```

### 7단계: scene_doc 필드 변경

`run_phase1_split()`에서 scenes 배열 생성 시:

**현재 (L222-231):**
```python
scene_doc = {
    "scene_number": s.get("scene_number", len(scenes) + 1),
    "description": s.get("description", ""),
    "lyrics_segment": s.get("lyrics_segment", ""),
    ...
}
```

**변경:**
```python
scene_doc = {
    "scene_number": s.get("scene_number", len(scenes) + 1),
    "description": s.get("image_prompt") or s.get("description", ""),  # 하위호환
    "image_prompt": s.get("image_prompt", ""),
    "video_prompt": s.get("video_prompt", ""),
    "lyrics_segment": s.get("lyrics_segment", ""),
    ...
}
```

`description`은 `image_prompt`의 값으로 채워서 기존 로직과의 하위호환성을 유지한다.

### 8단계: routes/mv.py 변경

**`_scene_to_dict()` 함수 (L110-133):**
- `image_prompt`와 `video_prompt` 필드를 응답에 추가:

```python
result = {
    "scene_number": scene.get("scene_number"),
    "description": scene.get("description", ""),
    "image_prompt": scene.get("image_prompt", ""),      # NEW
    "video_prompt": scene.get("video_prompt", ""),      # NEW
    "lyrics_segment": scene.get("lyrics_segment", ""),
    ...
}
```

**`job_doc` (L186-209):**
- `scenario` 필드 추가:

```python
job_doc = {
    ...
    "scenario": None,       # NEW — Phase 1에서 자동 생성됨
    "status": "draft",
    ...
}
```

**job 응답에 `scenario` 포함:**
- `GET /api/mv/jobs/{id}` 응답에 `scenario` 필드가 자동으로 포함됨 (MongoDB doc 그대로 반환)

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/services/mv_generator.py` | `generate_mv_scenario()` 신규 추가 + `split_lyrics_into_scenes()` 시그니처/프롬프트 수정 (image_prompt/video_prompt 분리 출력) + `start_scene_video()` 프롬프트 조건부 변경 |
| 2 | `backend/app/services/cover_generator.py` | `generate_cover_image()` — `scenario` 파라미터 추가 + 프롬프트 반영 |
| 3 | `backend/app/services/mv_pipeline.py` | `run_phase1_split()` — 시나리오 생성 단계 추가 + `split_lyrics_into_scenes()` 호출에 scenario 전달 + scene_doc에 image_prompt/video_prompt 필드 추가 + Phase 2에서 image_prompt 사용 + Phase 3에서 video_prompt 사용 |
| 4 | `backend/app/routes/mv.py` | `job_doc`에 `scenario: None` 추가 + `_scene_to_dict()`에 image_prompt/video_prompt 추가 |

### 체크리스트

- [ ] STEP 1: `backend/app/services/mv_generator.py` — `generate_mv_scenario()` 함수 추가 (GPT 호출, 소설형 시나리오 반환)
- [ ] STEP 2: `backend/app/services/mv_generator.py` — `SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE` 수정 (description → image_prompt + video_prompt 분리, scenario 컨텍스트)
- [ ] STEP 3: `backend/app/services/mv_generator.py` — `SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE` 수정 (동일)
- [ ] STEP 4: `backend/app/services/mv_generator.py` — `SECTION_SCENE_PLAN_SYSTEM_PROMPT` 수정 (clip 내 image_prompt/video_prompt 분리)
- [ ] STEP 5: `backend/app/services/mv_generator.py` — `split_lyrics_into_scenes()` 시그니처에 `scenario` 파라미터 추가, user_message에 시나리오 포함
- [ ] STEP 6: `backend/app/services/mv_generator.py` — `_split_with_music_sections()` 시그니처에 `scenario` 전달, flatten 시 `image_prompt` 사용
- [ ] STEP 7: `backend/app/services/mv_generator.py` — `start_scene_video()` 내 프롬프트 조건부 변경 (`video_prompt`가 이미 포함된 경우 `"smooth cinematic camera movement"` 생략)
- [ ] STEP 8: `backend/app/services/cover_generator.py` — `generate_cover_image()`에 `scenario` 파라미터 추가 + 프롬프트 반영
- [ ] STEP 9: `backend/app/services/mv_pipeline.py` — `run_phase1_split()` 상단에 시나리오 생성 단계 추가, MongoDB에 저장
- [ ] STEP 10: `backend/app/services/mv_pipeline.py` — `split_lyrics_into_scenes()` 호출에 `scenario=scenario` 추가
- [ ] STEP 11: `backend/app/services/mv_pipeline.py` — scene_doc 생성 시 `image_prompt`, `video_prompt` 필드 추가
- [ ] STEP 12: `backend/app/services/mv_pipeline.py` — `run_phase2_images()` L338에서 `scene.get("image_prompt") or scene.get("description")` 사용
- [ ] STEP 13: `backend/app/services/mv_pipeline.py` — `run_phase3_videos()` L498에서 image_prompt + video_prompt 합친 프롬프트 사용
- [ ] STEP 14: `backend/app/routes/mv.py` — `job_doc`에 `"scenario": None` 추가
- [ ] STEP 15: `backend/app/routes/mv.py` — `_scene_to_dict()`에 `image_prompt`, `video_prompt` 필드 추가
- [ ] STEP 16: 테스트 — MV 생성 실행, 시나리오 생성 확인, scene에 image_prompt/video_prompt 분리 확인
- [ ] STEP 17: 테스트 — 생성된 이미지가 image_prompt 기반인지 확인
- [ ] STEP 18: 테스트 — 생성된 영상이 video_prompt의 카메라 무빙을 반영하는지 확인

## v21 — 시나리오/프롬프트 생성 실패 시 재시도 로직 추가 (2026-03-31)

### 배경

현재 Phase 0 시나리오 생성이 실패하면 `logger.warning` 후 시나리오 없이 진행(continue)하고,
Phase 1b에서 `split_lyrics_into_scenes` 결과의 `image_prompt`/`video_prompt`가 비어있어도 그대로 사용한다.
GPT API 일시 장애나 타임아웃 등으로 생성이 실패하는 경우, 폴백 대신 **최대 3회 재시도**하고
그래도 실패 시 명확한 에러 처리를 하도록 개선한다.

### 변경 사항

#### 1단계: `mv_pipeline.py` — Phase 0 시나리오 생성 재시도

**현재 (L162-180):**
```python
# ── Phase 0: Generate MV Scenario ──
scenario = None
try:
    from .mv_generator import generate_mv_scenario
    ...
    scenario = await generate_mv_scenario(...)
    ...
except Exception as e:
    logger.warning("Phase0: scenario generation failed for job %s: %s (continuing without)", job_id, e)
```

**변경:**
```python
# ── Phase 0: Generate MV Scenario ──
scenario = None
MAX_RETRIES = 3
for attempt in range(1, MAX_RETRIES + 1):
    try:
        from .mv_generator import generate_mv_scenario
        character_name = job.get("character_name")
        scenario = await generate_mv_scenario(
            title=job["title"],
            genre=job.get("genre"),
            mood=job.get("mood"),
            lyrics=job.get("lyrics"),
            character_name=character_name,
        )
        await _update_job(mongo_db, job_id, {
            "scenario": scenario,
            "progress": 1,
        })
        logger.info("Phase0: scenario generated for job %s (%d chars, attempt %d)", job_id, len(scenario), attempt)
        break  # 성공 시 루프 탈출
    except Exception as e:
        logger.warning("Phase0: scenario generation failed for job %s (attempt %d/%d): %s", job_id, attempt, MAX_RETRIES, e)
        if attempt == MAX_RETRIES:
            logger.error("Phase0: scenario generation failed after %d attempts for job %s", MAX_RETRIES, job_id)
            await _update_job(mongo_db, job_id, {
                "status": "failed",
                "error_message": "시나리오 생성 실패 ({}회 재시도 후): {}".format(MAX_RETRIES, str(e)[:300]),
            })
            return
        await asyncio.sleep(2 * attempt)  # 백오프: 2초, 4초
```

- `warning` 후 `continue` 대신, 최대 3회 재시도 + 지수 백오프
- 3회 모두 실패 시 job 상태를 `"failed"`로 설정하고 `return` (파이프라인 중단)

#### 2단계: `mv_pipeline.py` — Phase 1b 씬 분할 후 image_prompt/video_prompt 검증 및 재생성

**위치:** Phase 1b `split_lyrics_into_scenes` 호출 직후, `scenes` 배열 생성 전 (L240 부근)

**추가:**
```python
# ── Phase 1b-1: Validate & retry scenes with missing prompts ──
MAX_PROMPT_RETRIES = 3
for prompt_attempt in range(1, MAX_PROMPT_RETRIES + 1):
    missing = [
        s for s in scenes_raw
        if not (s.get("image_prompt") or s.get("description", "")).strip()
        or not s.get("video_prompt", "").strip()
    ]
    if not missing:
        break  # 모든 씬에 프롬프트 존재

    logger.warning(
        "Phase1b: %d scenes missing image_prompt/video_prompt (attempt %d/%d), re-requesting",
        len(missing), prompt_attempt, MAX_PROMPT_RETRIES,
    )
    if prompt_attempt == MAX_PROMPT_RETRIES:
        logger.error("Phase1b: still %d scenes with missing prompts after %d retries for job %s", len(missing), MAX_PROMPT_RETRIES, job_id)
        await _update_job(mongo_db, job_id, {
            "status": "failed",
            "error_message": "씬 프롬프트 생성 실패: {}개 씬의 image_prompt/video_prompt 누락 ({}회 재시도 후)".format(len(missing), MAX_PROMPT_RETRIES),
        })
        return

    await asyncio.sleep(2 * prompt_attempt)
    scenes_raw = await split_lyrics_into_scenes(
        lyrics=job.get("lyrics"),
        title=job["title"],
        genre=job.get("genre"),
        mood=job.get("mood"),
        scene_count=scene_count,
        user_scene_prompt=job.get("scene_prompt"),
        music_sections=music_sections,
        scenario=scenario,
    )
```

- 씬 분할 결과에서 `image_prompt`(또는 `description`)와 `video_prompt`가 비어있는 씬을 검출
- 누락된 씬이 있으면 전체 씬 분할을 재요청 (최대 3회)
- 3회 재시도 후에도 누락 씬이 있으면 job을 `"failed"`로 처리

#### 3단계: `mv_generator.py` — `split_lyrics_into_scenes` 결과 검증

**위치:** `split_lyrics_into_scenes()` 함수 끝, `return` 직전

**추가:**
```python
# Validate all scenes have required prompt fields
for i, scene in enumerate(result_scenes):
    ip = (scene.get("image_prompt") or scene.get("description", "")).strip()
    vp = scene.get("video_prompt", "").strip()
    if not ip:
        logger.warning("split_lyrics_into_scenes: scene %d missing image_prompt", i + 1)
    if not vp:
        logger.warning("split_lyrics_into_scenes: scene %d missing video_prompt", i + 1)
```

- 반환 전에 각 씬의 `image_prompt`와 `video_prompt` 존재 여부를 로그로 경고
- 파이프라인 레벨에서 재시도 판단에 활용되도록 정보 제공

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/services/mv_pipeline.py` | Phase 0 시나리오 생성: warning+continue → 최대 3회 재시도 + 실패 시 job `"failed"` 처리 |
| 2 | `backend/app/services/mv_pipeline.py` | Phase 1b 후: image_prompt/video_prompt 누락 씬 검증 → 최대 3회 재시도 + 실패 시 job `"failed"` 처리 |
| 3 | `backend/app/services/mv_generator.py` | `split_lyrics_into_scenes()` 반환 전 image_prompt/video_prompt 존재 검증 로그 추가 |

### 체크리스트

- [ ] STEP 1: `backend/app/services/mv_pipeline.py` — Phase 0 시나리오 생성 try/except를 최대 3회 재시도 루프로 변경, 실패 시 job `"failed"` 처리
- [ ] STEP 2: `backend/app/services/mv_pipeline.py` — Phase 1b `split_lyrics_into_scenes` 호출 후 image_prompt/video_prompt 누락 검증 및 최대 3회 재시도 추가
- [ ] STEP 3: `backend/app/services/mv_generator.py` — `split_lyrics_into_scenes()` 반환 전 각 씬 프롬프트 필드 검증 로그 추가
- [ ] STEP 4: 테스트 — 시나리오 생성 실패 시 재시도 동작 확인 (모킹 등)
- [ ] STEP 5: 테스트 — image_prompt/video_prompt 누락 시 재시도 후 에러 처리 확인

## v22 — 가사 생성 프롬프트 Suno 최적화 (2026-03-31)

### 배경

현재 `lyrics_generator.py`의 시스템 프롬프트는 기본적인 섹션 태그(`[Verse]`, `[Chorus]` 등)만 지시하고 있어, Suno의 메타태그 시스템을 활용하지 못하고 있음. 프론트엔드에서 이미 genre, mood 등 풍부한 데이터를 수집하고 있으므로, 이를 최대한 활용하여 Suno 최적화 가사를 생성하도록 개선.

### 프론트엔드에서 가사 생성 시 전달하는 데이터 (Step 1)

| 필드 | 설명 | 비고 |
|------|------|------|
| `description` | 곡 설명 (자유 텍스트) | 필수 |
| `genres` | 장르 다중선택 | Pop, K-Pop, Hip-hop, R&B, Rock, Electronic, Lo-fi, Jazz, Classical, Ambient, Cinematic, 발라드, 댄스, 인디, Folk, Reggae, Metal, Soul |
| `moods` | 분위기 다중선택 | Energetic, Chill, Dark, Happy, Sad, Epic, Romantic, Dreamy, Aggressive, Peaceful, Nostalgic, Funky |
| `language` | 언어 | ko / en |

> **참고:** vocal preset, BPM, Key 등은 Step 2/3에서 선택하므로 가사 생성 시점에는 사용 불가. 보컬 방향은 genre/mood로부터 GPT가 자동 추론하도록 유도.

### 개선 내용: SYSTEM_PROMPT 전면 교체

#### 현재 프롬프트 (Before)

```python
SYSTEM_PROMPT = """You are a professional songwriter and lyricist.
Generate song lyrics based on the user's description.

Rules:
1. Use section tags: [Verse], [Chorus], [Bridge], [Outro], [Intro], [Pre-Chorus]
2. Each section should have 2-4 lines
3. Include at least 2 verses and 1 chorus
4. Match the mood, genre, and theme described by the user
5. If the user specifies a language, write in that language. Default to Korean.
6. Keep each line concise (under 30 characters for Korean, under 60 for English)
7. Make the lyrics emotionally resonant and singable
8. Separate sections with a blank line

Output ONLY the lyrics with section tags. No explanations or commentary."""
```

#### 새 프롬프트 (After)

```python
SYSTEM_PROMPT = """You are an elite songwriter who writes lyrics optimized for Suno AI music generation.
Generate song lyrics based on the user's description, genre, and mood.

## Suno Meta-Tag Rules

### Section Tags (필수)
- 기본 태그: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro]
- 추가 태그: [Hook], [Break], [Interlude], [Drop], [Refrain]
- 보컬 방향 포함 가능: [Verse: whispered, soft], [Chorus: belting, powerful], [Bridge: falsetto, ethereal]
- 보컬 방향은 장르/분위기에서 자연스럽게 추론하여 적절한 섹션에만 추가

### Performance Hints (선택적, 괄호 안에)
- (ad-lib), (harmonize), (falsetto), (spoken), (whispered), (raspy)
- (call and response), (layered vocals), (vocal chop)
- 남용 금지: 곡 전체에 2-4회만 사용

### Instrumental Cues (선택적)
- [Instrumental Break], [Guitar Solo], [Piano Interlude]
- 적절한 위치에 짧은 인스트루멘탈 구간 배치 가능

## 장르별 가사 구조 가이드

- **발라드/R&B/Soul**: Intro → Verse 1 → Chorus → Verse 2 → Chorus → Bridge → Chorus → Outro. 서정적이고 감정적인 표현. 보컬 방향: soft → building → powerful.
- **K-Pop/Pop/댄스**: Intro → Verse 1 → Pre-Chorus → Chorus → Verse 2 → Pre-Chorus → Chorus → Bridge → Final Chorus → Outro. 캐치한 훅과 반복. Pre-Chorus로 빌드업.
- **Hip-hop**: Intro → Verse 1 (8-16줄) → Hook → Verse 2 (8-16줄) → Hook → Bridge/Verse 3 → Hook → Outro. 라임 스킴과 플로우 강조. 긴 벌스 허용.
- **Rock/Metal**: Intro → Verse 1 → Chorus → Verse 2 → Chorus → Guitar Solo/Break → Chorus → Outro. 강렬한 에너지 빌드업.
- **Electronic/Lo-fi/Ambient**: Intro → Verse 1 → Drop/Chorus → Break → Verse 2 → Drop/Chorus → Outro. 반복적 구조. 짧은 가사 + 공간감.
- **Jazz/Folk/인디**: Verse 1 → Verse 2 → Chorus → Verse 3 → Chorus → Outro. 스토리텔링 중심.

## 작성 규칙

1. 장르에 맞는 구조를 선택하되, 유연하게 변형 가능
2. 각 섹션은 2-6줄 (힙합 벌스는 8-16줄 허용)
3. Chorus는 기억에 남는 멜로디감 있는 가사로 작성
4. 한국어: 줄당 15-25자 / 영어: 줄당 30-50자 (Suno가 잘 처리하는 길이)
5. 전체 가사 길이: 3000자 이내 (Suno 최적 범위)
6. 분위기(mood)를 가사 톤과 어휘 선택에 적극 반영
7. 섹션 사이에 빈 줄 하나씩 삽입
8. 가사만 출력. 설명, 주석, 코멘트 없음.

## 분위기별 톤 가이드

- **Energetic/Happy/Funky**: 밝고 리듬감 있는 어휘, 짧은 문장, 감탄사 활용
- **Chill/Dreamy/Peaceful**: 부드럽고 여유로운 표현, 자연/감각 이미지
- **Dark/Aggressive**: 강렬하고 날카로운 어휘, 대비와 긴장감
- **Sad/Nostalgic**: 회상적 표현, 과거 시제, 감정적 디테일
- **Epic/Cinematic**: 웅장한 스케일, 메타포, 서사적 구조
- **Romantic**: 친밀한 2인칭 화법, 감각적 디테일"""
```

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `backend/app/services/lyrics_generator.py` | `SYSTEM_PROMPT` 상수를 Suno 최적화 버전으로 전면 교체 |

### 체크리스트

- [ ] STEP 1: `backend/app/services/lyrics_generator.py` — `SYSTEM_PROMPT` 상수를 위의 새 프롬프트로 교체
- [ ] STEP 2: 테스트 — 발라드 장르 + Sad 분위기로 가사 생성하여 섹션 태그/보컬 방향/톤 확인
- [ ] STEP 3: 테스트 — Hip-hop 장르 + Energetic 분위기로 가사 생성하여 긴 벌스/라임/Hook 구조 확인
- [ ] STEP 4: 테스트 — Electronic 장르 + Dreamy 분위기로 가사 생성하여 Drop/Break 태그 확인
- [ ] STEP 5: 생성된 가사를 Suno에 입력하여 메타태그 인식 및 음악 품질 확인

---

## v23 — Sync Labs 립싱크 통합: Chorus 구간 자동 립싱크 영상 생성 (2026-03-31)

### 목적

뮤직비디오의 Chorus 구간에 캐릭터가 실제로 노래하는 것처럼 보이는 립싱크 영상을 자동 생성한다. Sync Labs API를 활용하여 이미지 + 오디오 → 립싱크 영상을 만들고, 기존 MV 파이프라인에 자연스럽게 통합한다.

### Sync Labs API 정보

- **SDK**: `pip install syncsdk`
- **인증**: `SYNC_API_KEY` 환경변수
- **생성**: `sync.generations.create(input=[Video(url=...), Audio(url=...)], model="lipsync-2")`
- **폴링**: `sync.generations.get(job_id)` → status: `COMPLETED` / `FAILED` / `REJECTED`
- **결과**: `generation.output_url`
- **제한**: 오디오 최대 300초, 파일 최대 20MB
- **입력**: 비디오 URL + 오디오 URL (공개 URL 필요)

### 현재 파이프라인 (변경 전)

```
1. 음악 분석 → 섹션 라벨 (Intro, Verse, Chorus 등) + 시작/끝 시간
2. 시나리오 생성
3. 씬 분할 → image_prompt + video_prompt
4. 씬 이미지 생성 (Gemini)
5. 영상 생성 (Veo/Kling) ← 모든 씬 동일 방식
6. 합치기
```

### 변경 후 파이프라인

```
1. 음악 분석 → 섹션 라벨 + 시작/끝 시간
2. 섹션별 scene_type 자동 배정 (Chorus → lipsync, 나머지 → drama)
3. 시나리오 생성
4. 씬 분할 → image_prompt + video_prompt + scene_type
5. 씬 이미지 생성 (Gemini)
   - lipsync 씬: 정면 클로즈업 캐릭터 이미지 프롬프트
   - drama 씬: 기존 방식
6. 영상 생성 (scene_type 분기)
   - drama → 기존 Veo/Kling
   - lipsync → ffmpeg 오디오 구간 자르기 + 이미지→정지영상 변환 + Sync Labs API
7. 합치기
```

### 변경 대상 파일

| # | 파일 | 작업 |
|---|------|------|
| 1 | `.env` | `SYNC_API_KEY` 환경변수 추가 |
| 2 | `backend/app/config.py` | `sync_api_key: Optional[str]` 필드 추가 |
| 3 | `requirements.txt` | `syncsdk` 패키지 추가 |
| 4 | `backend/app/services/sync_labs_service.py` | **신규** — Sync Labs API 래퍼 서비스 |
| 5 | `backend/app/services/mv_pipeline.py` | scene_type 분기 로직 + 립싱크 흐름 추가 |
| 6 | `backend/app/services/mv_generator.py` | 씬 분할 프롬프트에 scene_type 반영 |

### 상세 구현

#### STEP 1: 환경 설정

- `.env`에 `SYNC_API_KEY=sk-...` 추가
- `config.py`에 `sync_api_key: Optional[str] = Field(default=None, env="SYNC_API_KEY")` 추가
- `requirements.txt`에 `syncsdk` 추가

#### STEP 2: `services/sync_labs_service.py` 신규 생성

```python
# 핵심 함수
async def generate_lipsync(video_url: str, audio_url: str, model: str = "lipsync-2") -> str:
    """
    비디오 URL + 오디오 URL → 립싱크 영상 URL 반환
    1. sync.generations.create() 호출
    2. 폴링으로 완료 대기 (최대 5분, 10초 간격)
    3. generation.output_url 반환
    """

async def image_to_static_video(image_path: str, duration: float, output_path: str) -> str:
    """
    ffmpeg로 이미지를 정지 영상으로 변환
    ffmpeg -loop 1 -i image.png -c:v libx264 -t {duration} -pix_fmt yuv420p output.mp4
    """

async def extract_audio_segment(audio_path: str, start: float, end: float, output_path: str) -> str:
    """
    ffmpeg로 오디오의 특정 구간 자르기
    ffmpeg -i audio.mp3 -ss {start} -to {end} -c copy output.mp3
    """

async def upload_to_minio_presigned(file_path: str) -> str:
    """
    MinIO에 파일 업로드 후 presigned URL 반환
    Sync Labs는 공개 URL이 필요하므로 presigned URL 사용
    """

async def process_lipsync_scene(image_path: str, audio_path: str, start: float, end: float) -> str:
    """
    전체 립싱크 처리 파이프라인:
    1. 오디오 구간 자르기 (extract_audio_segment)
    2. 이미지 → 정지 영상 변환 (image_to_static_video)
    3. MinIO 업로드 + presigned URL 생성
    4. Sync Labs API 호출 (generate_lipsync)
    5. 결과 영상 다운로드 + 저장
    """
```

#### STEP 3: `mv_pipeline.py` 수정

- 음악 분석 결과에서 섹션 라벨 확인 후 `scene_type` 자동 배정:
  - `Chorus`, `Final Chorus` → `scene_type: "lipsync"`
  - 그 외 (`Intro`, `Verse`, `Bridge`, `Outro` 등) → `scene_type: "drama"`
- Phase 3 (영상 생성) 에서 scene_type 분기:
  ```
  if scene.scene_type == "lipsync":
      result = await sync_labs_service.process_lipsync_scene(...)
  else:
      result = await generate_video_veo_or_kling(...)
  ```

#### STEP 4: `mv_generator.py` 수정

- 씬 분할 프롬프트에 `scene_type` 정보 포함
- lipsync 씬의 `image_prompt`에 자동으로 정면 클로즈업 지시 추가:
  - "캐릭터 정면 클로즈업, 입이 잘 보이는 각도, 중립 표정 또는 살짝 미소"
  - 배경은 단순하게 (립싱크 품질에 영향)

### 주의사항

1. **공개 URL 필요**: Sync Labs는 공개 접근 가능한 URL만 허용 → MinIO presigned URL (만료 1시간) 사용
2. **보컬 분리 권장**: 전체 믹스보다 보컬만 전달하면 립싱크 품질 향상 → 향후 Demucs 연동 고려
3. **이미지→비디오 변환**: Sync Labs는 비디오 입력만 지원 → ffmpeg로 이미지를 짧은 정지 영상으로 변환
4. **파일 크기 제한**: 20MB 이내로 유지 → 오디오/비디오 압축 필요 시 ffmpeg 옵션 조정
5. **오디오 길이 제한**: 300초(5분) 이내 → Chorus 구간은 보통 30~60초이므로 문제없음
6. **타임아웃**: Sync Labs 생성은 수 분 소요 가능 → 비동기 폴링 + 적절한 타임아웃 설정

### 체크리스트

- [ ] STEP 1: `.env`에 `SYNC_API_KEY` 추가
- [ ] STEP 1: `config.py`에 `sync_api_key` 필드 추가
- [ ] STEP 1: `requirements.txt`에 `syncsdk` 추가
- [ ] STEP 2: `services/sync_labs_service.py` 신규 생성 — Sync Labs API 래퍼
- [ ] STEP 3: `mv_pipeline.py` — scene_type 자동 배정 + 립싱크 분기 로직
- [ ] STEP 4: `mv_generator.py` — 씬 분할 프롬프트에 scene_type 반영
- [ ] STEP 5: 테스트 — Chorus 포함 곡으로 MV 생성하여 립싱크 씬 확인
- [ ] STEP 6: 테스트 — 립싱크 영상 품질 및 싱크 정확도 확인

## v24 — 씬 한글 설명 + 이미지 확대 모달 (2026-03-31)

### 목적

1. 씬 설명을 한글로 표시: GPT가 씬 분할 시 영어 `image_prompt`와 함께 한글 `description_ko`를 동시 생성하여, 프론트엔드에서 사용자에게 한글 장면 설명을 보여준다.
2. 씬 이미지 클릭 시 확대 다이얼로그: 이미지 + 한글 설명 + 가사를 포함한 모달 팝업을 띄워 씬 상세 정보를 확인할 수 있게 한다.

### 현재 구조

- 씬 분할 시 JSON: `{scene_number, image_prompt(영어), video_prompt(영어), lyrics_segment}`
- 프론트엔드: `scene.description`으로 영어 설명 표시 (UploadPage.jsx, line 983)
- 이미지 클릭 기능 없음

### 구현 계획

#### STEP 1: `mv_generator.py` — 씬 분할 프롬프트에 `description_ko` 필드 추가

- 3개 시스템 프롬프트(20씬/기본/캐릭터) 모두 수정
- 각 씬 JSON 출력 형식에 `"description_ko": "한글 장면 설명"` 필드 추가
- GPT가 `image_prompt`(영어)와 `description_ko`(한글)를 동시 생성하도록 지시

**변경 전 JSON 형식:**
```json
{
  "scene_number": 1,
  "image_prompt": "A lonely figure standing...",
  "video_prompt": "Camera slowly zooms in...",
  "lyrics_segment": "첫 번째 가사..."
}
```

**변경 후 JSON 형식:**
```json
{
  "scene_number": 1,
  "image_prompt": "A lonely figure standing...",
  "video_prompt": "Camera slowly zooms in...",
  "lyrics_segment": "첫 번째 가사...",
  "description_ko": "외로운 인물이 비 내리는 거리에 서 있다"
}
```

#### STEP 2: `mv_pipeline.py` — scene_doc에 `description_ko` 저장

- 씬 분할 결과 파싱 시 `description_ko` 필드를 scene_doc에 포함
- DB(MongoDB)에 `description_ko` 필드 저장

#### STEP 3: `routes/mv.py` — API 응답에 `description_ko` 포함

- `_scene_to_dict()` 함수에서 `description_ko` 필드를 응답 JSON에 포함
- 프론트엔드가 `scene.description_ko`로 접근 가능하도록 함

#### STEP 4: `UploadPage.jsx` — 한글 설명 표시 + 이미지 클릭 모달

**4-1. 한글 설명 표시:**
- 씬 카드의 설명 텍스트: `scene.description` → `scene.description_ko || scene.description`
- `description_ko`가 없는 기존 데이터는 영어 `description`으로 폴백

**4-2. 이미지 클릭 모달 상태 추가:**
- `selectedScene` 상태 추가 (클릭한 씬 정보 저장)
- 씬 이미지에 `onClick` → `setSelectedScene(scene)` 핸들러
- 이미지에 `cursor: pointer` 스타일 + hover 효과

**4-3. SceneDetailModal 컴포넌트:**
- 오버레이 배경 (클릭 시 닫기)
- 확대된 이미지 (최대 80vw × 80vh)
- 한글 설명 (`description_ko || description`)
- 가사 (`lyrics_segment`)
- 닫기 버튼 (X)
- ESC 키 닫기 지원

#### STEP 5: `UploadPage.css` — 모달 스타일

- `.scene-modal-overlay`: 반투명 검정 배경, z-index 최상위, flex 중앙 정렬
- `.scene-modal-content`: 흰색 카드, 둥근 모서리, 그림자
- `.scene-modal-image`: max-width/max-height 제한, object-fit: contain
- `.scene-modal-description`: 한글 설명 텍스트 스타일
- `.scene-modal-lyrics`: 가사 영역 스타일 (이탤릭 또는 인용 블록)
- `.scene-modal-close`: 우상단 X 버튼

### 체크리스트

- [ ] STEP 1: `mv_generator.py` — 3개 프롬프트에 `description_ko` 필드 추가
- [ ] STEP 2: `mv_pipeline.py` — scene_doc에 `description_ko` 저장
- [ ] STEP 3: `routes/mv.py` — `_scene_to_dict()`에 `description_ko` 포함
- [ ] STEP 4: `UploadPage.jsx` — 한글 설명 표시 + 이미지 클릭 모달
- [ ] STEP 5: `UploadPage.css` — 모달 오버레이 + 확대 스타일
- [ ] STEP 6: 테스트 — 새 MV 생성 시 `description_ko` 정상 생성 확인
- [ ] STEP 7: 테스트 — 이미지 클릭 모달 동작 확인 (확대 이미지 + 한글 설명 + 가사)

---

## v25 — MR 음정 조절: detune → SoundTouchJS 피치 시프트 교체 (2026-04-01)

### 배경 / 문제

현재 `MrPitchAdjustPanel` 컴포넌트(`StudioTab2.jsx` L40-306)에서 MR 음정 조절 시 `AudioBufferSourceNode.detune`을 사용한다.
`detune`은 리샘플링 방식이라 **피치를 올리면 속도가 빨라지고, 내리면 느려진다** (키보드 샘플러 효과).
사용자가 MR 반주의 키(음정)만 변경하고 싶은데 템포까지 바뀌어 보컬과 싱크가 틀어지는 문제가 있다.

### 해결 방안

**SoundTouchJS** (WSOLA 알고리즘 기반, `npm install soundtouchjs` 완료)로 교체한다.
SoundTouchJS는 피치와 속도를 독립적으로 제어할 수 있어, 피치만 변경하면서 원래 속도를 유지할 수 있다.

- **라이브러리**: `soundtouchjs` v0.3.0 (이미 설치됨)
- **핵심 클래스**: `SoundTouch`, `SimpleFilter`, `WebAudioBufferSource`, `getWebAudioNode`
- **알고리즘**: WSOLA (Waveform Similarity Overlap-Add) — 타임스트레칭/피치시프팅을 독립 수행

### 변경 파일

`frontend/src/components/StudioTab2.jsx` — `MrPitchAdjustPanel` 컴포넌트 (1개 파일만)

### 상세 변경 내역

#### STEP 1: import 추가

```jsx
// StudioTab2.jsx 최상단에 추가
import { SoundTouch, SimpleFilter, WebAudioBufferSource, getWebAudioNode } from 'soundtouchjs';
```

#### STEP 2: ref 추가

기존 `mrSourceRef`는 SoundTouch 노드 참조용으로 계속 사용.
SoundTouch 인스턴스를 유지할 ref를 추가한다.

```jsx
const soundTouchRef = useRef(null);     // SoundTouch 인스턴스
const stNodeRef = useRef(null);         // getWebAudioNode() 반환값 (ScriptProcessorNode)
```

#### STEP 3: `startPlayback()` 함수 — MR 재생 로직 교체

**변경 전** (L109-116):
```jsx
const mrSource = ctx.createBufferSource();
mrSource.buffer = mrBufferRef.current;
mrSource.detune.value = mrPitch * 100;
const mrGain = ctx.createGain();
mrGain.gain.value = playMode === 'vocal' ? 0 : mrVolume;
mrSource.connect(mrGain).connect(ctx.destination);
mrGainRef.current = mrGain;
mrSourceRef.current = mrSource;
```

**변경 후**:
```jsx
// SoundTouch 인스턴스 생성
const st = new SoundTouch();
st.pitch = Math.pow(2, mrPitch / 12);   // 반음 → 배율 변환 (0 = 1.0, +12 = 2.0, -12 = 0.5)
st.tempo = 1.0;                          // 속도 유지
soundTouchRef.current = st;

// WebAudioBufferSource로 AudioBuffer 래핑
const stSource = new WebAudioBufferSource(mrBufferRef.current);
const stFilter = new SimpleFilter(stSource, st);

// ScriptProcessorNode 생성 (Web Audio 파이프라인 연결)
const stNode = getWebAudioNode(ctx, stFilter);
stNodeRef.current = stNode;

// Gain 노드 연결
const mrGain = ctx.createGain();
mrGain.gain.value = playMode === 'vocal' ? 0 : mrVolume;
stNode.connect(mrGain).connect(ctx.destination);
mrGainRef.current = mrGain;
mrSourceRef.current = stNode;  // stopPlayback에서 disconnect 용도로 사용
```

#### STEP 4: `stopPlayback()` 함수 — SoundTouch 정리

**변경 전** (L89-93):
```jsx
const stopPlayback = () => {
  try { vocalSourceRef.current?.stop(); } catch {}
  try { mrSourceRef.current?.stop(); } catch {}
  setIsPlaying(false);
};
```

**변경 후**:
```jsx
const stopPlayback = () => {
  try { vocalSourceRef.current?.stop(); } catch {}
  try { stNodeRef.current?.disconnect(); } catch {}
  stNodeRef.current = null;
  soundTouchRef.current = null;
  setIsPlaying(false);
};
```

> `ScriptProcessorNode`는 `.stop()`이 없으므로 `.disconnect()`로 정지시킨다.

#### STEP 5: `useEffect([mrPitch])` — 실시간 피치 변경 로직

**변경 전** (L138-142):
```jsx
useEffect(() => {
  if (mrSourceRef.current) {
    mrSourceRef.current.detune.value = mrPitch * 100;
  }
}, [mrPitch]);
```

**변경 후**:
```jsx
useEffect(() => {
  if (soundTouchRef.current) {
    soundTouchRef.current.pitch = Math.pow(2, mrPitch / 12);
  }
}, [mrPitch]);
```

> 슬라이더를 움직이면 SoundTouch 인스턴스의 `pitch` 속성이 실시간 변경됨.
> 재생 중 즉시 반영됨 (재시작 불필요).

#### STEP 6: cleanup `useEffect` — 언마운트 시 정리

기존 cleanup (L83-86)에 SoundTouch 정리 추가:

```jsx
return () => {
  stopPlayback();
  if (audioCtxRef.current) audioCtxRef.current.close();
};
```

> `stopPlayback()` 내에서 `stNodeRef`, `soundTouchRef`를 null 처리하므로 별도 수정 불필요.

### 피치 변환 공식

| mrPitch (반음) | `Math.pow(2, mrPitch / 12)` | 효과 |
|---|---|---|
| 0 | 1.0 | 원래 음정 |
| +1 | 1.0595 | 반음 올림 |
| +12 | 2.0 | 1옥타브 올림 |
| -1 | 0.9439 | 반음 내림 |
| -12 | 0.5 | 1옥타브 내림 |

### 주의사항

1. **`getWebAudioNode()`는 내부적으로 `ScriptProcessorNode`를 사용** — 향후 `AudioWorklet` 기반으로 마이그레이션 필요할 수 있음 (현재 브라우저 호환성 우수)
2. **보컬은 변경 없음** — 보컬은 기존 `AudioBufferSourceNode`로 그대로 재생
3. **서버 합치기(`handleMerge`)는 변경 없음** — 서버 쪽은 이미 `pydub`로 독립적 피치시프트 처리 중 (`mr_pitch_shift` 파라미터)
4. **`onended` 이벤트 처리** — `ScriptProcessorNode`는 `onended`가 없으므로, 보컬의 `onended`로 재생 종료를 감지 (기존 로직 유지)

### 체크리스트

- [ ] STEP 1: `soundtouchjs` import 추가
- [ ] STEP 2: `soundTouchRef`, `stNodeRef` ref 추가
- [ ] STEP 3: `startPlayback()` — `AudioBufferSourceNode.detune` → SoundTouch 파이프라인으로 교체
- [ ] STEP 4: `stopPlayback()` — `disconnect()` 방식으로 변경
- [ ] STEP 5: `useEffect([mrPitch])` — `detune` → `SoundTouch.pitch` 실시간 변경
- [ ] STEP 6: 테스트 — 피치 변경 시 속도 유지 확인
- [ ] STEP 7: 테스트 — 보컬/MR/합쳐서 모드 전환 정상 동작 확인
- [ ] STEP 8: 테스트 — 슬라이더 실시간 피치 변경 확인 (재생 중)

## v26 — MR 음정 미리듣기: 클라이언트 SoundTouchJS → 서버 rubberband 처리로 변경 (2026-04-01)

### 배경 및 문제

v25에서 SoundTouchJS(WSOLA)로 클라이언트 피치 시프트를 구현했으나, 내부적으로 **피치 변환 → 템포 보상**을 순차 처리하기 때문에 체감될 만큼 재생 속도가 변하는 문제가 있음.

### 해결 방향

피치 변환을 클라이언트에서 처리하지 않고, **서버에서 rubberband**로 고품질 피치 시프트 수행 후 변환된 MR 파일을 받아서 재생하는 방식으로 변경.

**플로우**: 슬라이더로 음정 선택 → "이 음정으로 미리듣기" 버튼 클릭 → 서버에서 rubberband 피치 변환 → 변환된 MR 파일(또는 스트리밍 URL) 수신 → 클라이언트에서 재생

### 백엔드 변경 (voice_convert.py)

#### 새 엔드포인트 추가

```
POST /api/voice-convert/{id}/preview-mr
Body: { "pitch_shift": float }  // 반음 단위 (예: +2, -3)
```

- `backing.wav`를 rubberband CLI로 피치 변환
  ```bash
  rubberband -p {pitch_shift} input.wav output.wav
  ```
- **옵션 A**: 변환된 MR을 MinIO에 임시 저장 → 스트리밍 URL 반환
  - 장점: 같은 피치 재요청 시 캐시 가능
  - 단점: 임시 파일 정리 필요
- **옵션 B**: 변환된 MR을 직접 스트리밍 응답으로 반환
  - 장점: 별도 저장/정리 불필요
  - 단점: 매번 변환 수행

**권장: 옵션 A** (동일 피치 반복 미리듣기 시 캐시 활용 가능)

#### 응답 형식

```json
{
  "url": "https://minio.../temp/preview_mr_{id}_{pitch}.wav",
  "pitch_shift": 2,
  "duration": 180.5
}
```

### 프론트엔드 변경 (StudioTab2.jsx — MrPitchAdjustPanel)

#### STEP 1: SoundTouchJS 제거

- `soundtouchjs` import 제거
- `SoundTouch`, `SimpleFilter`, `getWebAudioNode` 관련 코드 삭제
- `soundTouchRef`, `stNodeRef` ref 제거

#### STEP 2: MR 재생을 일반 AudioBufferSourceNode로 변경

- 피치 변환 없이 원본 MR을 `AudioBufferSourceNode`로 재생 (v25 이전 방식)
- `detune` 조작 없음 — 순수 원본 재생

#### STEP 3: "이 음정으로 미리듣기" 버튼 추가

```jsx
<Button
  onClick={handlePreviewPitchedMr}
  disabled={isLoadingPreview || mrPitch === 0}
>
  {isLoadingPreview ? '변환 중...' : '이 음정으로 미리듣기'}
</Button>
```

- 클릭 시 `POST /api/voice-convert/{id}/preview-mr` 호출 (body: `{ pitch_shift: mrPitch }`)
- 로딩 상태 표시 (예상 2~3초)
- 응답으로 받은 URL을 `fetch` → `arrayBuffer` → `decodeAudioData`하여 `previewMrBufferRef`에 저장
- 즉시 변환된 MR 재생 시작

#### STEP 4: 재생 모드별 동작

| 모드 | 보컬 | MR |
|---|---|---|
| MR만 | — | 서버에서 받은 피치 변환 MR 재생 |
| 보컬만 | 원본 보컬 재생 | — |
| 합쳐서 미리듣기 | 원본 보컬 재생 | 서버에서 받은 피치 변환 MR + 원본 보컬 동시 재생 |

#### STEP 5: 상태 관리

```jsx
const [isLoadingPreview, setIsLoadingPreview] = useState(false);
const [previewPitch, setPreviewPitch] = useState(null);  // 현재 변환된 MR의 피치
const previewMrBufferRef = useRef(null);  // 변환된 MR AudioBuffer
```

- 슬라이더 변경 시 `previewPitch !== mrPitch`이면 "이 음정으로 미리듣기" 버튼 활성화
- 변환 완료 후 `previewPitch = mrPitch`로 업데이트
- 피치 0(원본)이면 버튼 비활성화, 기존 원본 MR 재생

### 체크리스트

- [ ] 백엔드: `POST /api/voice-convert/{id}/preview-mr` 엔드포인트 구현
- [ ] 백엔드: rubberband CLI 연동 및 MinIO 임시 저장 로직
- [ ] 프론트엔드: SoundTouchJS 관련 코드 제거
- [ ] 프론트엔드: MR 재생을 원본 AudioBufferSourceNode로 복원
- [ ] 프론트엔드: "이 음정으로 미리듣기" 버튼 및 API 호출 로직 추가
- [ ] 프론트엔드: 로딩 상태 UI 표시
- [ ] 프론트엔드: 합쳐서 미리듣기 모드에서 변환된 MR + 원본 보컬 동시 재생
- [ ] 테스트: 피치 변환 품질 확인 (속도 변화 없이 음정만 변경되는지)
- [ ] 테스트: 캐시 동작 확인 (같은 피치 재요청 시 즉시 응답)
- [ ] 테스트: 모드 전환(MR만/보컬만/합쳐서) 정상 동작 확인

## v27 — Veo 3.1 Fast GA 전환 및 립싱크 씬 우선순위 개선 (2026-04-01)

### 배경

- Veo preview 모델이 내일(4/2) 폐기 예정 → GA 모델(`veo-3.1-fast-generate-001`)로 전환 필요
- Veo 3.1 Fast는 가사 립싱크를 자동 처리하므로 Sync Labs 외부 서비스가 불필요
- 립싱크 씬 우선순위: Rap 구간이 립싱크에 가장 적합하므로 Rap > Chorus 순으로 배정

### 변경 사항

#### 1. `mv_generator.py` — Veo 모델 GA 전환 + 가사 프롬프트 포함

- `VEO31_GENERATE_URL`: `veo-3.1-generate-preview` → `veo-3.1-fast-generate-001` 변경
- `start_scene_video()` 함수 매개변수 추가:
  - `lyrics_segment: str = None` — 해당 씬의 가사 텍스트
  - `scene_type: str = "drama"` — 씬 유형 (drama / lipsync)
- lipsync 씬일 때 프롬프트에 가사를 포함하여 Veo가 립싱크를 자동 생성하도록 처리

#### 2. `mv_pipeline.py` — 씬 타입 배정 및 Sync Labs 제거

- scene_type 배정 로직 개선:
  - Rap 구간이 있으면 → Rap 씬만 `lipsync`으로 배정
  - Rap 구간이 없으면 → Chorus 씬을 `lipsync`으로 배정
- Phase 3에서 `start_scene_video()` 호출 시 `lyrics_segment`, `scene_type` 전달
- Sync Labs 분기 코드 제거 또는 비활성화 (Veo 3.1 Fast가 직접 처리)

#### 3. `mv_generator.py` — 씬 분할 프롬프트 업데이트

- scene_type 결정 규칙을 Rap > Chorus 우선순위로 업데이트
- 씬 분할 시 Rap 구간을 lipsync 후보로 우선 지정

### 체크리스트

- [ ] `mv_generator.py`: `VEO31_GENERATE_URL`을 `veo-3.1-fast-generate-001`로 변경
- [ ] `mv_generator.py`: `start_scene_video()`에 `lyrics_segment`, `scene_type` 매개변수 추가
- [ ] `mv_generator.py`: lipsync 씬일 때 가사를 프롬프트에 포함하는 로직 추가
- [ ] `mv_generator.py`: 씬 분할 프롬프트에서 scene_type 규칙 업데이트 (Rap > Chorus)
- [ ] `mv_pipeline.py`: Rap > Chorus 우선순위로 scene_type 배정 로직 구현
- [ ] `mv_pipeline.py`: Phase 3에서 `lyrics_segment`, `scene_type` 전달
- [ ] `mv_pipeline.py`: Sync Labs 분기 코드 제거/비활성화
- [ ] 테스트: GA 모델로 영상 생성 정상 동작 확인
- [ ] 테스트: Rap 구간 립싱크 품질 확인
- [ ] 테스트: Rap 없는 곡에서 Chorus 립싱크 폴백 확인

## v28 — Veo 영상 기반 Sync Labs 립싱크 후보정 Phase 3.5 추가 (2026-04-01)

### 배경

- Veo 3.1 Fast의 자체 립싱크 품질이 불안정한 경우가 있음
- 전략 변경: 모든 씬을 Veo로 먼저 생성한 뒤, lipsync 씬만 Sync Labs로 후보정
- 기존 `sync_labs_service.py`는 이미지→정지영상→Sync Labs 호출 방식 → Veo 영상을 직접 전달하는 방식으로 확장

### 변경 사항

#### 1. `sync_labs_service.py` — 영상 기반 립싱크 함수 추가

- 새 함수 `generate_lipsync_from_video(video_bytes, audio_bytes)` 추가
  - 기존 `generate_lipsync(image_bytes, audio_bytes)`는 유지 (하위 호환)
  - 이미지→정지영상 변환 단계 없이 Veo 영상을 직접 Sync Labs에 전달
  - MinIO presigned URL로 영상/오디오 업로드 후 Sync Labs API에 URL 전달
  - 폴링 방식으로 결과 대기, 완료 시 결과 영상 bytes 반환

#### 2. `mv_pipeline.py` — Phase 3.5 (Sync Labs 후보정) 추가

- Phase 3 (Veo 영상 생성) 이후, Phase 4 (합치기) 이전에 **Phase 3.5** 삽입
- Phase 3.5 로직:
  1. 모든 씬 중 `scene_type == "lipsync"` 이고 Veo 영상 생성이 완료된 씬만 필터링
  2. 각 lipsync 씬에 대해:
     - MinIO에서 Veo 영상 다운로드 (video_bytes)
     - `cut_audio_segment()`로 해당 구간 오디오 자르기 (audio_bytes)
     - `generate_lipsync_from_video(video_bytes, audio_bytes)` 호출
     - 성공 시: 결과 영상으로 MinIO에 교체 저장 (같은 키)
     - 실패 시: Veo 원본 영상 유지 (폴백), 로그 경고 출력
  3. 모든 lipsync 씬 처리 완료 후 Phase 4로 진행

### 체크리스트

- [ ] `sync_labs_service.py`: `generate_lipsync_from_video(video_bytes, audio_bytes)` 함수 추가
- [ ] `sync_labs_service.py`: MinIO presigned URL 생성 및 Sync Labs API 호출 로직 구현
- [ ] `mv_pipeline.py`: Phase 3.5 단계 추가 (Phase 3 이후, Phase 4 이전)
- [ ] `mv_pipeline.py`: lipsync 씬 필터링 로직 구현
- [ ] `mv_pipeline.py`: MinIO에서 Veo 영상 다운로드 → Sync Labs 호출 → 결과 교체 저장
- [ ] `mv_pipeline.py`: Sync Labs 실패 시 Veo 원본 유지 폴백 처리
- [ ] `mv_pipeline.py`: Phase 3.5 진행 상태 로깅
- [ ] 테스트: Sync Labs API에 Veo 영상 전달 정상 동작 확인
- [ ] 테스트: 실패 시 폴백(Veo 원본 유지) 정상 동작 확인
- [ ] 테스트: Phase 3 → 3.5 → 4 전체 파이프라인 정상 흐름 확인

## v29 — Kling 영상 생성 3.0 Omni 업그레이드 + 립싱크 씬 가사 프롬프트 (2026-04-01)

### 배경

- Kling v3 → v3 Omni 모델로 업그레이드하여 오디오+립싱크 내장 지원 활용
- 기존 `/v1/videos/image2video` 엔드포인트를 `/v1/videos/omni`로 전환
- lipsync 씬에 해당 구간 가사를 프롬프트에 포함하여 립싱크 품질 향상
- "music video" 컨텍스트를 프롬프트에 추가하여 영상 스타일 일관성 강화

### 변경 사항

#### 1. `kling_video_generator.py`

- 엔드포인트 변경: `/v1/videos/image2video` → `/v1/videos/omni`
- model_name 변경: `kling-v3` → `kling-v3-omni`
- 요청 body에 `motion_has_audio: true` 추가 (오디오+립싱크 활성화)
- `start_scene_video_kling()` 함수 시그니처에 `lyrics_segment`, `scene_type` 매개변수 추가
- lipsync 씬(`scene_type == "lipsync"`)일 때 해당 구간 가사를 프롬프트에 포함
  - 예: `"[Lyrics: 가사 내용] Singer performing with emotional expression..."`
- 모든 씬 프롬프트에 "music video" 컨텍스트 키워드 추가

#### 2. `mv_pipeline.py`

- Phase 3에서 Kling 호출 시 `lyrics_segment`, `scene_type` 인자 전달
  - 기존 씬 데이터에서 해당 구간 가사 및 씬 타입 추출하여 전달

### 체크리스트

- [ ] `kling_video_generator.py`: 엔드포인트 `/v1/videos/image2video` → `/v1/videos/omni` 변경
- [ ] `kling_video_generator.py`: model_name `kling-v3` → `kling-v3-omni` 변경
- [ ] `kling_video_generator.py`: `motion_has_audio: true` 추가
- [ ] `kling_video_generator.py`: `start_scene_video_kling()` 시그니처에 `lyrics_segment`, `scene_type` 추가
- [ ] `kling_video_generator.py`: lipsync 씬 가사 프롬프트 포함 로직 구현
- [ ] `kling_video_generator.py`: "music video" 컨텍스트 프롬프트 추가
- [ ] `mv_pipeline.py`: Phase 3 Kling 호출 시 `lyrics_segment`, `scene_type` 전달
- [ ] 테스트: Omni 엔드포인트로 영상 생성 정상 동작 확인
- [ ] 테스트: lipsync 씬 가사 포함 프롬프트 정상 생성 확인
- [ ] 테스트: motion_has_audio 활성화 시 오디오+립싱크 품질 확인

## v32 — 씬 영상 개별 그리드 + 재생/다운로드 + 모달 팝업 UI (2026-04-02)

### 배경

- 백엔드: 씬별 `video_url` (presigned URL) 이미 반환 중
- 프론트엔드: 씬 이미지는 그리드로 보여주고 있지만, 영상은 최종 합본만 보여줌
- 개별 씬 영상을 확인하고 다운로드할 수 있는 UI가 필요

### 변경 사항 (프론트엔드만)

#### 1. `UploadPage.jsx`

- 씬 카드에 영상 완료 시 **재생 버튼(▶)** 오버레이 표시 (기존 "영상 완료" 배지 대체)
- 재생 버튼 클릭 시 **모달 팝업** 열기:
  - `<video>` 플레이어로 해당 씬 영상 재생 (presigned URL 사용)
  - 한글 씬 설명 텍스트 표시
  - 다운로드 버튼 (presigned URL을 `<a download>` 링크로 제공)
  - 모달 외부 클릭 또는 X 버튼으로 닫기
- 각 씬 카드에 **개별 다운로드 버튼(⬇)** 추가 (영상 완료 상태일 때만 활성화)
- 씬 영상 생성 중: **프로그레스 표시** (스피너 + "영상 생성 중..." 텍스트)
- 씬 영상 대기 중: **⏳ 아이콘** + "대기 중" 텍스트 표시

#### 2. `UploadPage.css`

- 씬 영상 카드 스타일:
  - 재생 버튼 오버레이 (반투명 원형 배경 + ▶ 아이콘, 호버 시 확대)
  - 다운로드 버튼 위치 및 스타일 (카드 우하단, 아이콘 버튼)
  - 생성 중/대기 중 상태 오버레이 스타일
- 모달 스타일:
  - 풀스크린 백드롭 (반투명 검정)
  - 중앙 정렬 모달 컨테이너 (max-width: 800px)
  - `<video>` 플레이어: width 100%, controls 속성
  - 씬 설명 텍스트 영역
  - 다운로드 버튼 스타일
  - 닫기(X) 버튼 (모달 우상단)

### 체크리스트

- [ ] `UploadPage.jsx`: 씬 카드에 영상 완료 시 재생 버튼(▶) 오버레이 추가
- [ ] `UploadPage.jsx`: 모달 컴포넌트 구현 (video 플레이어 + 한글 설명 + 다운로드)
- [ ] `UploadPage.jsx`: 모달 열기/닫기 상태 관리 (useState)
- [ ] `UploadPage.jsx`: 각 씬 카드에 개별 다운로드 버튼(⬇) 추가
- [ ] `UploadPage.jsx`: 생성 중 씬 프로그레스 표시 (스피너 + 텍스트)
- [ ] `UploadPage.jsx`: 대기 중 씬 ⏳ 아이콘 표시
- [ ] `UploadPage.css`: 재생 버튼 오버레이 스타일
- [ ] `UploadPage.css`: 다운로드 버튼 스타일
- [ ] `UploadPage.css`: 생성 중/대기 중 상태 오버레이 스타일
- [ ] `UploadPage.css`: 모달 백드롭 + 컨테이너 스타일
- [ ] `UploadPage.css`: 모달 내 video 플레이어 스타일
- [ ] `UploadPage.css`: 모달 닫기 버튼 스타일
- [ ] 테스트: 씬 카드 재생 버튼 클릭 시 모달 정상 열림 확인
- [ ] 테스트: 모달 내 영상 재생 정상 동작 확인
- [ ] 테스트: 개별 다운로드 버튼 정상 동작 확인
- [ ] 테스트: 생성 중/대기 중 상태 표시 정상 확인

## v33 — 개별 씬 영상 생성 기능 (2026-04-02)

### 배경

- 현재 `POST /api/mv/jobs/{job_id}/generate-videos`로 전체 씬 영상을 일괄 생성
- 특정 씬만 개별적으로 영상을 생성/재생성할 수 있는 기능 필요
- 기존 전체 생성 기능은 그대로 유지하면서 개별 생성 추가

### 변경 사항

#### 1. 백엔드 — `app/routes/mv.py`

- `POST /api/mv/jobs/{job_id}/scenes/{scene_number}/generate-video` 엔드포인트 추가
  - 기존 `regenerate-image` 엔드포인트 패턴 참고 (job 소유권 확인, 씬 조회 등)
  - 해당 씬의 이미지 바이트를 MinIO에서 로드
  - 캐릭터 시트(`character_object_name`)가 있으면 함께 로드
  - `BackgroundTasks`로 비동기 영상 생성 실행
  - job의 `video_model` 설정에 따라 Kling 또는 Veo 호출
  - 생성 완료 시 해당 씬의 `video_object_name`, `video_url` 업데이트
  - 생성 중 해당 씬의 `video_status`를 `generating` → `completed` / `failed`로 관리

#### 2. 프론트엔드 — `frontend/src/api/index.js`

- `generateSceneVideo(jobId, sceneNumber)` API 함수 추가
  - `API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/generate-video`)`
  - 기존 `regenerateMVSceneImage` 패턴과 동일한 형태

#### 3. 프론트엔드 — `frontend/src/pages/UploadPage.jsx`

- 각 씬 카드에 **[🎬 생성]** 버튼 추가 (영상 미생성 상태일 때만 표시)
- 클릭 시 `generateSceneVideo(jobId, sceneNumber)` 호출
- 호출 후 해당 씬의 상태를 `generating`으로 변경하여 UI에 스피너 표시
- 기존 폴링 로직(`fetchJobStatus`)으로 생성 완료 감지 및 UI 업데이트
- 전체 영상 생성 버튼은 기존 그대로 유지

### 체크리스트

- [ ] `app/routes/mv.py`: `POST .../scenes/{scene_number}/generate-video` 엔드포인트 추가
- [ ] `app/routes/mv.py`: 씬 이미지 MinIO 로드 로직
- [ ] `app/routes/mv.py`: 캐릭터 시트 로드 로직
- [ ] `app/routes/mv.py`: BackgroundTasks로 비동기 영상 생성 (Kling/Veo 분기)
- [ ] `app/routes/mv.py`: 생성 완료 시 씬 video_object_name, video_url DB 업데이트
- [ ] `app/routes/mv.py`: 씬 video_status 상태 관리 (generating → completed/failed)
- [ ] `frontend/src/api/index.js`: `generateSceneVideo(jobId, sceneNumber)` 함수 추가
- [ ] `UploadPage.jsx`: 씬 카드에 [🎬 생성] 버튼 추가 (영상 미생성 시)
- [ ] `UploadPage.jsx`: 버튼 클릭 시 API 호출 및 로컬 상태 업데이트
- [ ] `UploadPage.jsx`: 폴링으로 생성 완료 감지 및 UI 반영
- [ ] 테스트: 개별 씬 영상 생성 API 정상 동작 확인
- [ ] 테스트: 전체 영상 생성과 개별 생성 간 충돌 없음 확인
- [ ] 테스트: 생성 중 폴링으로 상태 업데이트 정상 동작 확인

## v38 — Sync Labs 후보정 개선: 오디오 재합치기, 에러 저장, 자동/수동 재시도 (2026-04-02)

### 배경

- Sync Labs 결과 영상에 자체 오디오가 포함되어 원본 음악과 불일치하는 문제 발생
- Sync Labs 호출 실패 시 에러 정보가 저장되지 않아 디버깅 어려움
- 일시적 API 장애에 대한 자동 재시도가 없어 수동 개입 필요
- 사용자가 실패한 립싱크를 직접 재시도할 수 있는 수단이 없음

### 변경 사항

#### 1. `app/routes/mv.py` — Sync Labs 결과 오디오 제거 + 원본 음악 재합치기

- Sync Labs 결과 영상에서 `ffmpeg -an`으로 오디오 트랙 제거
- 원본 음악의 해당 구간을 `cut_audio_segment()`로 추출
- 오디오 제거된 영상 + 원본 음악 구간을 `ffmpeg`로 합치기 (mux)
- 최종 결과물을 MinIO에 저장

#### 2. `app/routes/mv.py` — sync_error 필드에 에러 메시지 저장

- Sync Labs API 호출 실패 시 에러 메시지를 씬의 `sync_error` 필드에 저장
- DB 업데이트하여 에러 상태 영구 기록

#### 3. `app/routes/mv.py` — Sync Labs 자동 재시도 (최대 2회, 지수 백오프)

- Sync Labs API 호출 실패 시 자동 재시도 로직 추가
- 최대 2회 재시도 (총 3회 시도)
- 지수 백오프: 1차 재시도 30초 대기, 2차 재시도 60초 대기
- 모든 재시도 실패 시 `sync_error`에 최종 에러 저장

#### 4. `app/routes/mv.py` — 수동 재시도 엔드포인트

- `POST /api/mv/jobs/{job_id}/scenes/{scene_number}/retry-sync` 엔드포인트 추가
- job 소유권 확인, 해당 씬 조회
- `BackgroundTasks`로 Sync Labs 후보정 비동기 재실행
- 기존 동일 로직 적용 (오디오 제거+재합치기, 에러 저장, 자동 재시도)

#### 5. `app/routes/mv.py` — `_scene_to_dict`에 sync_error 반환

- `_scene_to_dict` 함수에 `sync_error` 필드 추가하여 프론트엔드에 에러 정보 전달

#### 6. `mv_pipeline.py` — Phase 3.5에 동일 적용

- Phase 3.5 (Sync Labs 후보정)에도 동일한 개선 사항 적용:
  - Sync Labs 결과 오디오 제거 + 원본 음악 구간 재합치기
  - `sync_error` 필드에 에러 메시지 저장
  - 자동 재시도 (최대 2회, 지수 백오프)

#### 7. `frontend/src/api/index.js` — retrySyncLabs 함수 추가

- `retrySyncLabs(jobId, sceneNumber)` API 함수 추가
  - `API.post(`/mv/jobs/${jobId}/scenes/${sceneNumber}/retry-sync`)`

#### 8. `frontend/src/pages/UploadPage.jsx` — sync 실패 에러 표시 + 재시도 버튼

- 씬 카드에 `sync_error`가 있을 경우 에러 메시지 표시 (빨간색 텍스트)
- **[🔄 립싱크 재시도]** 버튼 표시 (sync 실패 상태일 때만)
- 버튼 클릭 시 `retrySyncLabs(jobId, sceneNumber)` 호출
- 호출 후 해당 씬 상태를 `syncing`으로 변경하여 UI에 스피너 표시
- 폴링으로 재시도 완료 감지 및 UI 업데이트

### 체크리스트

- [ ] `app/routes/mv.py`: Sync Labs 결과에서 ffmpeg -an으로 오디오 제거
- [ ] `app/routes/mv.py`: 원본 음악 구간 추출 및 오디오 제거된 영상과 합치기
- [ ] `app/routes/mv.py`: sync_error 필드에 에러 메시지 저장 로직
- [ ] `app/routes/mv.py`: 자동 재시도 로직 (최대 2회, 지수 백오프 30초/60초)
- [ ] `app/routes/mv.py`: `POST .../scenes/{scene_number}/retry-sync` 엔드포인트 추가
- [ ] `app/routes/mv.py`: `_scene_to_dict`에 sync_error 필드 추가
- [ ] `mv_pipeline.py`: Phase 3.5에 오디오 제거+재합치기 적용
- [ ] `mv_pipeline.py`: Phase 3.5에 sync_error 저장 적용
- [ ] `mv_pipeline.py`: Phase 3.5에 자동 재시도 적용
- [ ] `frontend/src/api/index.js`: `retrySyncLabs(jobId, sceneNumber)` 함수 추가
- [ ] `UploadPage.jsx`: sync_error 에러 메시지 표시 (빨간색 텍스트)
- [ ] `UploadPage.jsx`: [🔄 립싱크 재시도] 버튼 추가 및 API 호출
- [ ] `UploadPage.jsx`: 재시도 중 스피너 표시 및 폴링 업데이트
- [ ] 테스트: Sync Labs 결과 오디오 제거 + 원본 음악 합치기 정상 동작
- [ ] 테스트: 에러 발생 시 sync_error 필드 저장 확인
- [ ] 테스트: 자동 재시도 및 지수 백오프 정상 동작
- [ ] 테스트: 수동 재시도 엔드포인트 정상 동작
- [ ] 테스트: 프론트엔드 에러 표시 및 재시도 버튼 정상 동작

---

# v4.0 -- Phase 3.5 자동 Sync Labs 적용 코드 검토 및 테스트

- **수정일자**: 2026-04-03
- **요청 작업**: MV 파이프라인 Phase 3.5 자동 Sync Labs 활성화, Phase 4 / Phase 3.6 Sync Labs 우선 사용 코드에 대한 면밀한 검토 및 테스트

---

## 1. 백엔드 검토 항목

### 1-1. Phase 3.5 코드 로직 검증
- [ ] 립싱크 씬 판별 로직 (lipsync == True) 정확성 확인
- [ ] Demucs 보컬 분리 호출 로직 검증 (입력 파일 경로, 출력 경로, 에러 처리)
- [ ] Sync Labs API 호출 파라미터 검증 (영상 URL, 오디오 URL, 모델 선택)
- [ ] Sync Labs 결과 다운로드 및 무음 영상 저장 로직 검증
- [ ] `video_synclabs_object` 필드가 씬 데이터에 올바르게 저장되는지 확인
- [ ] 비동기 처리 흐름 (async/await) 정합성 확인

### 1-2. Phase 4 Sync Labs 우선 로직 검증
- [ ] `video_synclabs_object` 존재 시 원본 대신 사용하는 분기문 확인
- [ ] `video_synclabs_object` 미존재 시 기존 로직으로 fallback 되는지 확인
- [ ] concatenate 시 영상 해상도/코덱 호환성 이슈 여부 확인

### 1-3. Phase 3.6 수정 검증
- [ ] 오디오 합치기에서 `video_synclabs_object` 우선 사용 로직 확인
- [ ] Sync Labs 영상의 오디오 트랙 처리 방식 확인 (무음 처리 vs 원본 오디오)
- [ ] 기존 씬과 Sync Labs 씬이 혼재할 때의 오디오 합치기 정합성

### 1-4. 에러 핸들링
- [ ] Sync Labs API 실패 시 fallback 처리 확인 (원본 영상 유지)
- [ ] Demucs 분리 실패 시 예외 처리 확인
- [ ] 네트워크 타임아웃 / 429 Rate Limit 처리 여부
- [ ] 파일 I/O 에러 (디스크 공간 부족, 권한 문제) 처리 여부

### 1-5. Edge Case 확인
- [ ] 립싱크 씬이 0개인 경우 (Phase 3.5 스킵 여부)
- [ ] 모든 씬이 립싱크인 경우
- [ ] Sync Labs 결과 영상 길이가 원본과 다른 경우
- [ ] 이미 Sync Labs 처리된 씬에 대해 재실행 시 동작
- [ ] 씬 번호 순서가 비연속적인 경우

---

## 2. 프론트엔드 검토 항목

### 2-1. 파이프라인 변경에 따른 영향도 확인
- [ ] MV 생성 진행상태 표시에서 Phase 3.5 단계가 반영되는지 확인
- [ ] Sync Labs 처리 중 상태 메시지 / 프로그레스 표시 확인
- [ ] Sync Labs 성공/실패 결과가 UI에 올바르게 반영되는지 확인

### 2-2. Sync Labs 결과 반영 UI
- [ ] 씬 미리보기에서 Sync Labs 적용된 영상이 표시되는지 확인
- [ ] 최종 MV 결과물에서 Sync Labs 영상이 올바르게 포함되는지 확인
- [ ] 기존 v3.0 에러 표시/재시도 UI와의 호환성 확인

---

## 3. 테스트 항목

### 3-1. 코드 정적 분석
- [ ] import 문제 확인 (누락된 모듈, 미사용 import)
- [ ] 변수명 일관성 검증 (`video_synclabs_object` 등 필드명 통일)
- [ ] 로직 흐름 검증 (분기문 조건, 반복문, 예외 전파)
- [ ] 타입 힌트 / 파라미터 검증

### 3-2. 서버 기동 확인
- [ ] 백엔드 서버 정상 기동 (import 에러 없음)
- [ ] 프론트엔드 빌드 정상 완료
- [ ] 기존 API 엔드포인트 비파괴 확인 (regression 없음)

### 3-3. API 엔드포인트 기본 동작 확인
- [ ] `POST /mv/generate` 정상 호출 가능 여부
- [ ] MV 파이프라인 전체 흐름 (Phase 1 ~ Phase 5) 시뮬레이션
- [ ] 립싱크 씬 포함 MV 생성 요청 시 Phase 3.5 자동 실행 확인
- [ ] Sync Labs 결과가 Phase 4 / Phase 3.6에 올바르게 전달되는지 확인

---

## 4. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 검토 | 20 | 0/20 |
| 프론트엔드 검토 | 6 | 0/6 |
| 테스트 | 8 | 0/8 |
| **합계** | **34** | **0/34** |

---

# v4.1 — 영상 생성 중 씬 리스트 유지 (Hotfix)

- **수정일자**: 2026-04-03
- **요청**: "Kling으로 영상 생성하기" 버튼 클릭 시 씬 리스트가 사라지는 문제 수정

## 1. 문제 분석

| 항목 | 내용 |
|------|------|
| 증상 | 영상 생성 버튼 클릭 후 polling 시작 시 씬 리스트 UI가 사라짐 |
| 원인 | `startMvPolling` 콜백에서 `setMvJob(data)`로 상태를 전체 교체하면서, API 응답에 `scenes`가 포함되지 않으면 기존 scenes 데이터가 유실됨 |
| 영향 범위 | 프론트엔드 1파일 (`UploadPage.jsx`) |

## 2. 수정 내역

| # | 파일 | 수정 내용 |
|---|------|-----------|
| 1 | `frontend/src/pages/UploadPage.jsx` (line 265) | `setMvJob(data)` → functional updater 패턴으로 변경. 새 응답에 `scenes`가 없으면 이전 `scenes`를 보존 |

## 3. 검증

- 렌더링 조건 `mvStep >= 2`는 step 3(영상 생성 중)을 포함하므로 조건 자체는 정상
- polling 시 scenes 데이터 보존 로직 추가로 씬 리스트 유지 확인

---

# v5.0 — 뮤직비디오 카라오케 스타일 가사 자막

- **작성일자**: 2026-04-03
- **목표**: 뮤직비디오에 가사를 카라오케 스타일(노래방) 자막으로 burn-in
- **방식**: ffmpeg ASS 자막의 `\kf` 태그로 왼→오 색 채우기 효과 (간단 버전 — 균등 배분)

## 배경

- 각 씬에 `lyrics_segment`, `section_start`, `section_end` 데이터가 이미 존재
- ffmpeg ASS 자막의 `\kf` 태그로 노래방 스타일 효과 (왼→오 색 채우기) 구현 가능
- 간단 버전: 씬 구간에 가사를 균등 배분하여 대략적 카라오케 효과
- 현재 파이프라인: Phase 3 → 3.5 → 3.6 → Phase 4 (영상 합치기) → Phase 5 (오디오 합치기)

## 1. 백엔드 변경

### 1-1. ASS 자막 생성 함수 신규 작성

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/subtitle_generator.py` (신규) |
| 역할 | 모든 씬의 가사 데이터로부터 ASS 자막 파일 내용을 생성 |

**구현 요구사항**:

- **입력**: 씬 리스트 (각 씬에 `lyrics_segment`, `section_start`, `section_end` 포함)
- **출력**: ASS 형식 문자열 (파일로 저장)
- **가사 타이밍 처리**:
  - 각 씬의 `section_start` ~ `section_end` 구간을 가사 줄 수로 균등 분할
  - 각 줄에 `\kf` 태그 적용 (해당 줄의 지속 시간을 글자 수로 균등 배분)
- **ASS 스타일링**:
  - 한글 폰트 지정 (Noto Sans KR 또는 시스템 가용 폰트 fallback)
  - 화면 하단 중앙 배치 (`Alignment=2`)
  - 테두리(outline) 및 그림자(shadow) 적용으로 가독성 확보
  - Primary 컬러: 흰색, Secondary 컬러(채우기 색): 노란색 또는 하늘색
  - 폰트 크기: 영상 해상도에 맞게 적절히 설정

**핵심 로직 (의사코드)**:

```
for each scene:
    lines = lyrics_segment.split('\n')
    duration = section_end - section_start
    line_duration = duration / len(lines)

    for i, line in enumerate(lines):
        start = section_start + i * line_duration
        end = start + line_duration
        k_per_char = (line_duration * 100) / len(line)  # centiseconds
        kf_text = build_kf_tags(line, k_per_char)
        emit ASS Dialogue line(start, end, kf_text)
```

### 1-2. Phase 5에서 자막 burn-in 적용

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/mv_pipeline.py` |
| 위치 | Phase 5 (merge audio) |
| 변경 | 오디오 합치기 시 자막도 함께 burn-in |

**변경 내용**:

- Phase 5 시작 시 `subtitle_generator`를 호출하여 ASS 파일 생성
- 기존 ffmpeg 명령에 `-vf "ass=lyrics.ass"` 필터 추가
- 최종 명령 형태:
  ```
  ffmpeg -i video.mp4 -i audio.mp3 -vf "ass=lyrics.ass" -c:v libx264 -c:a aac output.mp4
  ```
- 자막 생성 실패 시 자막 없이 기존 방식으로 fallback (파이프라인 중단 방지)

## 2. 프론트엔드 변경

- **변경 없음** — Phase 5 결과물에 자막이 자동 포함됨
- 추후 자막 on/off 토글이 필요하면 별도 버전에서 추가

## 3. 테스트

### 3-1. 단위 테스트

- [ ] ASS 헤더 생성 정상 확인 (스타일, 해상도 등)
- [ ] 가사 줄 분할 및 타이밍 계산 정확성 검증
- [ ] `\kf` 태그 생성 로직 검증 (글자 수 기반 균등 배분)
- [ ] 빈 가사 / 가사 없는 씬 처리 (에러 없이 스킵)
- [ ] 특수문자 포함 가사 처리 확인

### 3-2. 통합 테스트

- [ ] 생성된 ASS 파일이 ffmpeg `ass` 필터로 정상 적용되는지 확인
- [ ] Phase 5 전체 흐름에서 자막 burn-in 포함 최종 영상 생성 확인
- [ ] 자막 생성 실패 시 fallback 동작 확인

### 3-3. 서버 기동 확인

- [ ] 백엔드 서버 정상 기동 (import 에러 없음)
- [ ] 기존 API 엔드포인트 비파괴 확인 (regression 없음)

## 4. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (subtitle_generator.py 신규) | 1 | 0/1 |
| 백엔드 (mv_pipeline.py 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 9 | 0/9 |
| **합계** | **11** | **0/11** |

---

# v5.1 — 씬별 미리보기 영상에 카라오케 가사 자막 burn-in

- **작성일자**: 2026-04-03
- **목표**: Phase 3.6 (씬별 오디오 합치기)에서도 카라오케 스타일 가사 자막을 burn-in하여, 씬 단위 미리보기 영상에서 가사가 보이도록 한다
- **선행 작업**: v5.0 (카라오케 자막 기능 — `subtitle_generator.py` 및 Phase 5 적용)

## 배경

- v5.0에서 Phase 5 (최종 오디오 합치기)에 카라오케 자막 기능을 구현 완료
- `subtitle_generator.py`의 `generate_lyrics_ass(scenes)` 함수가 이미 존재
- Phase 3.6은 씬별 미리보기 전용 (`video_with_audio_object`)이며, Phase 4/5는 원본 영상을 사용하므로 자막 중첩 문제 없음
- Phase 3.6에서는 **해당 씬 1개의 가사만** 자막으로 넣어야 함 (전체 씬이 아닌)
- 씬별 영상은 `section_start`~`section_end`가 아닌 **0초부터 시작**하므로, 자막 타이밍을 0 기준으로 보정해야 함

## 1. 백엔드 변경

### 1-1. 단일 씬용 ASS 생성 함수 추가

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/subtitle_generator.py` |
| 변경 | 단일 씬용 ASS 생성 함수 추가 (또는 기존 함수 래핑) |

**구현 요구사항**:

- **방법 A (래핑)**: 기존 `generate_lyrics_ass(scenes)`에 단일 씬을 리스트로 감싸서 전달하되, 타이밍을 0 기준으로 보정
- **방법 B (신규 함수)**: `generate_scene_lyrics_ass(scene)` 함수 신규 작성
- **핵심**: 씬의 `section_start` 값을 오프셋으로 빼서, 자막 타이밍이 0초부터 시작하도록 보정

**타이밍 보정 로직**:

```
offset = scene['section_start']
adjusted_scene = copy(scene)
adjusted_scene['section_start'] = 0
adjusted_scene['section_end'] = scene['section_end'] - offset
# 이 adjusted_scene을 단일 리스트로 generate_lyrics_ass에 전달
```

### 1-2. Phase 3.6에서 자막 burn-in 적용

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/mv_pipeline.py` |
| 위치 | Phase 3.6 (씬별 오디오 합치기 — `video_with_audio_object` 생성 부분) |
| 변경 | 자막 burn-in 추가 |

**변경 내용**:

- Phase 3.6에서 각 씬의 오디오를 합칠 때, 해당 씬의 가사 ASS 파일을 생성
- 기존 ffmpeg 명령 변경:
  - **기존**: `-c:v copy` (영상 스트림 복사)
  - **변경**: `-vf "ass=scene_lyrics.ass" -c:v libx264 -preset fast -crf 23` (자막 필터 + 재인코딩)
- ASS 파일은 임시 파일로 생성 후 ffmpeg 완료 시 삭제
- 자막 생성 실패 시 자막 없이 기존 방식(`-c:v copy`)으로 fallback (파이프라인 중단 방지)

**ffmpeg 명령 변경 예시**:

```
# 기존
ffmpeg -i scene_video.mp4 -i scene_audio.mp3 -c:v copy -c:a aac output.mp4

# 변경
ffmpeg -i scene_video.mp4 -i scene_audio.mp3 \
  -vf "ass=scene_lyrics.ass" \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac output.mp4
```

## 2. 프론트엔드 변경

- **변경 없음** — 이미 씬별 미리보기 영상을 재생하는 UI가 존재

## 3. 주의사항

- Phase 3.6의 자막은 **미리보기 전용**이며, Phase 5의 최종 영상 자막과는 독립적
- `-c:v copy` → 재인코딩으로 변경되므로 Phase 3.6 처리 시간이 다소 증가할 수 있음
- `preset fast`와 `crf 23`으로 품질/속도 균형 유지 (미리보기용이므로 최고 품질 불필요)

## 4. 테스트

### 4-1. 단위 테스트

- [ ] 단일 씬 ASS 생성 시 타이밍이 0초부터 시작하는지 확인
- [ ] 타이밍 보정 로직 정확성 검증 (`section_start` 오프셋 차감)
- [ ] 가사가 없는 씬 처리 (에러 없이 자막 스킵)

### 4-2. 통합 테스트

- [ ] Phase 3.6에서 자막 burn-in 포함 씬별 미리보기 영상 생성 확인
- [ ] 생성된 미리보기 영상에서 카라오케 자막이 정상 표시되는지 확인
- [ ] 자막 생성 실패 시 fallback 동작 확인 (자막 없이 `-c:v copy`로 정상 생성)
- [ ] Phase 5 최종 영상에 자막 중첩이 발생하지 않는지 확인

### 4-3. 서버 기동 확인

- [ ] 백엔드 서버 정상 기동 (import 에러 없음)
- [ ] 기존 API 엔드포인트 비파괴 확인 (regression 없음)

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (subtitle_generator.py 수정) | 1 | 0/1 |
| 백엔드 (mv_pipeline.py 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 7 | 0/7 |

---

# v5.2 — 개별 씬 영상 생성 시 가사 자막 누락 수정 + Phase 5 경로 이스케이프 수정

- **작성일자**: 2026-04-03
- **목표**: 개별 씬 영상 재생성 시 가사 자막이 누락되는 문제 수정 및 Phase 5 ASS 경로 이스케이프 수정

## 배경

- v5.1에서 Phase 3.6 (파이프라인 내 씬별 미리보기)에 가사 자막 burn-in을 추가했으나, 개별 씬 영상 재생성 경로(`mv.py`의 `_generate_single_scene_video`)에는 자막 적용이 누락됨
- Phase 5 (`mv_pipeline.py`)에서 ASS 경로에 Windows 경로 구분자(`\`, `:`)가 이스케이프 없이 ffmpeg에 전달되어 필터 파싱 오류 가능성 존재

## 1. 백엔드 변경

### 1-1. 개별 씬 영상 자막 burn-in 추가

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/routes/mv.py` |
| 위치 | `_generate_single_scene_video` 함수 |
| 변경 | Phase 3.6과 동일한 방식으로 `generate_scene_lyrics_ass` 호출 및 자막 burn-in 적용 |

**변경 내용**:

- 씬에 가사(`lyrics_segment`)가 있을 경우, `generate_scene_lyrics_ass(scene)`으로 ASS 파일 생성
- ffmpeg 명령에 `-vf "ass=scene_lyrics.ass"` 필터 추가 (재인코딩)
- 가사가 없거나 자막 생성 실패 시 기존 방식(`-c:v copy`)으로 fallback

### 1-2. Phase 5 ASS 경로 이스케이프 수정

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/mv_pipeline.py` |
| 위치 | Phase 5 (오디오 합치기 — 최종 영상 생성) |
| 변경 | ASS 경로에 `ass_path.replace("\\", "/").replace(":", "\\:")` 이스케이프 추가 |

**변경 내용**:

- Windows 환경에서 ffmpeg의 ASS 필터는 경로 내 `\`와 `:`를 특수 문자로 해석
- `\` → `/`로 변환, `:` → `\:`로 이스케이프하여 ffmpeg 필터 파싱 오류 방지

## 2. 프론트엔드 변경

- **변경 없음**

## 3. 자막 적용 3곳 일관성 확인

| # | 위치 | 함수 | 상태 |
|---|------|------|------|
| 1 | Phase 3.6 (`mv_pipeline.py`) | `generate_scene_lyrics_ass` | 기존 정상 |
| 2 | Phase 5 (`mv_pipeline.py`) | `generate_lyrics_ass` | 경로 이스케이프 수정 |
| 3 | 개별 씬 (`mv.py`) | `generate_scene_lyrics_ass` | 신규 추가 |

## 4. 테스트

- [ ] Python import 확인
- [ ] 개별 씬 영상 재생성 시 자막 burn-in 적용 확인
- [ ] 가사 없는 씬 재생성 시 fallback 동작 확인
- [ ] Phase 5 최종 영상 ASS 경로 이스케이프 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv.py` 수정) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 5 | 0/5 |

---

# v5.3 — Freesentation 폰트 설치 + ASS 자막 폰트/크기 변경

- **수정일자**: 2026-04-03
- **요청**: ASS 자막 폰트를 한글 지원 폰트(Freesentation)로 교체하고 크기를 키워 가독성 향상

## 1. 백엔드 변경

### 1-1. Freesentation 폰트 설치

| 항목 | 내용 |
|------|------|
| 폰트 | Freesentation v2.001 (9개 웨이트) |
| 설치 경로 | `~/.fonts/` |
| 설치 방식 | GitHub Release에서 TTF 다운로드 후 `fc-cache -fv` 적용 |

### 1-2. ASS 자막 스타일 변경

| 항목 | 내용 |
|------|------|
| 파일 | `backend/app/services/subtitle_generator.py` |
| 위치 | ASS 스타일 정의부 (2곳) |
| 변경 | 폰트: Arial → Freesentation, 크기: 28 → 44 |

**변경 내용**:

- `generate_lyrics_ass()` (전체 뮤직비디오용) 스타일: Arial,28 → Freesentation,44
- `generate_scene_lyrics_ass()` (개별 씬용) 스타일: Arial,28 → Freesentation,44
- 한글 자막 깨짐 방지 및 가독성 향상

## 2. 프론트엔드 변경

- **변경 없음**

## 3. 테스트

- [ ] Freesentation 폰트 설치 확인 (`fc-list | grep Freesentation`)
- [ ] ASS 스타일에 Freesentation,44 적용 확인
- [ ] 한글 가사 자막 정상 생성 확인
- [ ] ffmpeg 렌더링 시 폰트 정상 반영 확인
- [ ] 서버 기동 확인

## 4. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 폰트 설치 | 1 | 0/1 |
| 백엔드 (`subtitle_generator.py` 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 5 | 0/5 |

---

# v5.4 — 카라오케 효과(\kf 태그) 제거

- **수정일자**: 2026-04-03
- **요청**: 가사 자막의 카라오케 색 채우기 효과(\kf 태그)를 제거하여 일반 텍스트로 표시

## 1. 백엔드 변경

| # | 파일 | 수정 내용 |
|---|------|-----------|
| 1 | `backend/app/services/subtitle_generator.py` | `generate_lyrics_ass()` — \kf 태그 제거, 일반 텍스트 출력 |
| 2 | `backend/app/services/subtitle_generator.py` | `generate_scene_lyrics_ass()` — \kf 태그 제거, 일반 텍스트 출력 |

**변경 내용**:

- `generate_lyrics_ass()` (전체 뮤직비디오용): \kf 태그 제거 → 가사가 해당 타이밍에 일반 흰색 텍스트로 표시
- `generate_scene_lyrics_ass()` (개별 씬용): \kf 태그 제거 → 동일하게 일반 텍스트로 표시
- 카라오케 색 채우기 애니메이션 완전 제거

## 2. 프론트엔드 변경

- **변경 없음**

## 3. 테스트

- [ ] ASS 파일에 \kf 태그 없음 확인
- [ ] 가사가 일반 흰색 텍스트로 표시 확인
- [ ] 서버 기동 확인

## 4. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`subtitle_generator.py` 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 3 | 0/3 |

---

# v6.0 — 가사 섹션 기반 씬 매칭 시스템 재설계

- **수정일자**: 2026-04-03
- **요청**: 가사 생성 GPT와 씬 분할 GPT가 독립적으로 섹션을 만들어 불일치 발생 (예: 가사에 없는 `[Post-Chorus]`를 씬에서 생성). 가사 섹션을 마스터로 삼아 씬 섹션이 반드시 가사 섹션에서 파생되도록 재설계.

## 핵심 설계 원칙

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **가사 섹션이 마스터** | 씬의 section 이름은 반드시 원본 가사의 `[SectionTag]`에서 파생 |
| 2 | **1:N 매핑** | 가사 섹션 1개 → 씬 N개 (예: `Chorus1-1`, `Chorus1-2`, ...) |
| 3 | **가사 줄 분배** | 같은 가사 섹션에 속한 씬들에 가사 줄을 시간 비율로 분배 |
| 4 | **방법 A** | 가사 줄보다 씬이 많으면 남는 씬은 자막 없음 (빈 `lyrics_segment`) |

## 1. 백엔드 변경

### 1-1. `backend/app/services/mv_generator.py` — GPT 프롬프트 수정

| 항목 | 내용 |
|------|------|
| 대상 | `SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE` (L445~L534) |
| 목적 | GPT가 씬 섹션 이름을 가사의 섹션 태그에서 그대로 가져오도록 강제 |

**추가할 프롬프트 지시 사항**:

```
Section naming rules:
- You MUST use the exact section tags from the provided lyrics as your section names.
- Do NOT invent new section names that do not exist in the lyrics (e.g., do NOT create "Post-Chorus" if the lyrics have no [Post-Chorus] tag).
- If a section produces multiple clips, name them with a hyphenated sub-index: Section-1, Section-2, etc.
  Example: lyrics have [Chorus 1] → clips become "Chorus1-1", "Chorus1-2", ...
- Instrumental sections (Intro/Outro) without lyrics tags are allowed as-is.
```

**현재 동작**: GPT가 음악 구조 분석 결과를 기반으로 자유롭게 섹션 이름을 생성 → 가사와 불일치.
**변경 후**: GPT가 가사의 `[SectionTag]`를 그대로 사용 → 가사-씬 섹션 1:1 대응 보장.

### 1-2. `backend/app/services/mv_pipeline.py` — `_assign_lyrics_to_scenes()` 재작성

| 항목 | 내용 |
|------|------|
| 대상 | `_assign_lyrics_to_scenes()` 함수 (L144~L225) |
| 목적 | 1:N 매핑 기반 가사 줄 분배 로직으로 교체 |

**현재 로직의 문제점**:
- 씬의 section 이름과 가사 섹션을 단순 문자열 매칭 → GPT가 다른 이름을 쓰면 매칭 실패
- 복수 씬 분배 시 균등 분할만 지원 (시간 비율 미반영)

**새 로직 (의사코드)**:

```python
def _assign_lyrics_to_scenes(scenes: list, lyrics: str) -> None:
    # Step 1: 가사를 섹션별로 파싱
    #   [Verse 1] → {"tag": "Verse 1", "base": "verse", "number": 1, "lines": [...]}
    #   [Chorus 1] → {"tag": "Chorus 1", "base": "chorus", "number": 1, "lines": [...]}

    # Step 2: 씬의 section 필드에서 부모 섹션명 추출
    #   "Chorus1-2" → parent="Chorus1", sub_index=2
    #   "Verse1"    → parent="Verse1",  sub_index=None
    #   정규식: r'^(.+?)(?:-(\d+))?$'

    # Step 3: 같은 parent 섹션에 속한 씬들을 그룹핑
    #   parent_groups = {"chorus1": [scene_a, scene_b], "verse1": [scene_c], ...}

    # Step 4: 각 그룹에 대해 가사 줄 분배
    #   - 해당 parent에 매칭되는 parsed lyrics 섹션 찾기
    #   - 씬들의 use_seconds 비율로 줄 수 배분
    #   - 줄이 남으면 마지막 씬에 몰아주기
    #   - 씬이 남으면 빈 lyrics_segment (방법 A)
```

**분배 알고리즘 상세**:

```
lines = ["가사줄1", "가사줄2", ..., "가사줄8"]
scenes_in_group = [scene_A(5s), scene_B(5s), scene_C(3s)]  # total 13s

비율: A=5/13=0.385, B=5/13=0.385, C=3/13=0.231
줄 배분: A=floor(8*0.385)=3줄, B=floor(8*0.385)=3줄, C=나머지 2줄

결과:
  scene_A.lyrics_segment = "가사줄1\n가사줄2\n가사줄3"
  scene_B.lyrics_segment = "가사줄4\n가사줄5\n가사줄6"
  scene_C.lyrics_segment = "가사줄7\n가사줄8"
```

## 2. 프론트엔드 변경

- **변경 없음** (씬 데이터 구조 자체는 동일, section 이름 규칙만 변경)

## 3. 데이터 흐름 (변경 전 vs 변경 후)

### 변경 전

```
[가사 GPT]          [씬 분할 GPT]
  Verse 1              Verse1
  Chorus 1             Chorus1
  Verse 2              Post-Chorus1  ← 가사에 없음!
  Chorus 2             Verse2
  Bridge               Chorus2
  Outro                Bridge1
                       Outro1
→ 매칭 실패 (Post-Chorus1에 대응하는 가사 없음)
```

### 변경 후

```
[가사 GPT]          [씬 분할 GPT]
  Verse 1              Verse1-1, Verse1-2
  Chorus 1             Chorus1-1, Chorus1-2
  Verse 2              Verse2-1
  Chorus 2             Chorus2-1, Chorus2-2
  Bridge               Bridge1-1
  Outro                Outro1-1
→ 모든 씬이 가사 섹션에서 파생, 1:N 매핑으로 가사 줄 분배
```

## 4. 테스트

- [ ] 가사에 없는 섹션이 씬에 생성되지 않는지 확인
- [ ] 1:N 매핑 (Chorus1-1, Chorus1-2 등) 정상 생성 확인
- [ ] 가사 줄이 시간 비율로 올바르게 분배되는지 확인
- [ ] 가사 줄 < 씬 수일 때 남는 씬의 lyrics_segment가 빈 문자열인지 확인
- [ ] 가사 줄 > 씬 수일 때 마지막 씬에 남은 줄이 몰리는지 확인
- [ ] Instrumental 섹션(Intro/Outro)에 가사 없이 정상 처리되는지 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_generator.py` 프롬프트 수정) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` 함수 재작성) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 8 | 0/8 |

---

# v7.0 — 가사 섹션 마스터 기반 씬 구조 재설계

> 수정일자: 2026-04-03

## 0. 현재 문제

1. **Gemini 오디오 분석이 자체 섹션명을 생성** — 가사에 정의된 섹션 태그와 불일치
2. **GPT가 오디오 분석 섹션 기반으로 씬을 분할** — 가사 섹션과 안 맞음
3. **가사 배정 실패** — 씬 섹션명 ≠ 가사 섹션명이므로 매칭 불가

## 1. 해결 방향

```
1. 가사에서 섹션 태그 파싱 → [Intro, Verse 1, Break, Chorus, ...]
2. Gemini 오디오 분석에 가사 섹션 목록 전달 → "이 섹션들의 시작/끝 시간을 찾아라"
3. 결과: 각 가사 섹션의 정확한 시간 확보
4. GPT에게 전달: "Verse 1은 5.5~20.0초(14.5초)다. 이 안에서 클립을 나눠라"
5. GPT 결과의 각 클립: section = 부모 가사 섹션명 유지
6. 가사 배정: 섹션명으로 매칭 (v6.0 로직)
```

**데이터 흐름 요약**

```
가사 파싱                    Gemini 오디오 분석              GPT 씬 분할
──────────                 ──────────────────            ──────────────
[Verse 1]  ──┐             "Verse 1: 5.5~20.0s"  ──┐    Verse1-1 (5.5~12.0s)
[Chorus]   ──┼─ 섹션 목록 ─→ "Chorus: 20.0~35.0s" ──┼──→ Chorus1-1 (20.0~27.0s)
[Bridge]   ──┘             "Bridge: 35.0~45.0s"  ──┘    Chorus1-2 (27.0~35.0s)
                                                         Bridge1-1 (35.0~45.0s)
```

## 2. 구체적 변경

### 2-1. `mv_generator.py`

| 변경 대상 | 변경 내용 |
|-----------|----------|
| `analyze_music_structure()` | 가사 섹션 태그 목록을 입력으로 받아서, Gemini에게 "이 섹션들의 타이밍을 찾아라"고 지시 |
| `SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE` | GPT에게 섹션명+타이밍이 **확정된** 상태로 전달. GPT는 클립 수와 길이만 결정 |
| `_split_with_music_sections()` | 플래트닝 시 `section` 필드에 가사 섹션명 유지 |

### 2-2. `mv_pipeline.py`

| 변경 대상 | 변경 내용 |
|-----------|----------|
| Phase 1a | 가사에서 섹션 태그 파싱 → `analyze_music_structure()`에 전달 |
| Phase 1b | 이미 가사 섹션 기반으로 매칭되므로 `_assign_lyrics_to_scenes()`는 v6.0 유지 |
| `section_start`/`section_end` 계산 | `use_seconds` 누적 방식 유지 |

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (v6.0)

```
[가사 GPT]          [Gemini 오디오]       [씬 분할 GPT]
  Verse 1              Verse A              VerseA-1, VerseA-2
  Chorus               Post-Chorus          PostChorus1
  Bridge               Chorus2              Chorus2-1
  Outro                Bridge1              Bridge1-1
                       Outro1               Outro1-1
→ Gemini이 자체 섹션명 생성 → GPT가 그대로 사용 → 가사 섹션과 불일치 → 매칭 실패
```

### 변경 후 (v7.0)

```
[가사 GPT]          [Gemini 오디오]              [씬 분할 GPT]
  Verse 1    ──→     Verse 1: 5.5~20.0s   ──→    Verse1-1, Verse1-2
  Chorus     ──→     Chorus: 20.0~35.0s   ──→    Chorus1-1, Chorus1-2
  Bridge     ──→     Bridge: 35.0~45.0s   ──→    Bridge1-1
  Outro      ──→     Outro: 45.0~55.0s    ──→    Outro1-1
→ 가사 섹션이 마스터, Gemini는 타이밍만 탐색, GPT는 클립만 분할
→ 모든 씬의 section이 가사 섹션에서 파생 → 매칭 보장
```

## 4. 테스트

- [ ] 가사 섹션 태그 파싱이 정확한지 확인 (`[Intro]`, `[Verse 1]` 등)
- [ ] Gemini에 가사 섹션 목록 전달 시 올바른 타이밍이 반환되는지 확인
- [ ] GPT 씬 분할 결과의 section 필드가 가사 섹션명과 일치하는지 확인
- [ ] 가사에 없는 섹션이 씬에 생성되지 않는지 확인
- [ ] 1:N 매핑 (Chorus1-1, Chorus1-2 등) 정상 생성 확인
- [ ] 가사 줄이 시간 비율로 올바르게 분배되는지 확인
- [ ] Instrumental 섹션(Intro/Outro)에 가사 없이 정상 처리되는지 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_generator.py` 수정) | 3 | 0/3 |
| 백엔드 (`mv_pipeline.py` 수정) | 3 | 0/3 |
| 프론트엔드 | 0 | — |
| 테스트 | 9 | 0/9 |

---

# v8.0 — Whisper 기반 가사 자막 타이밍 정확도 개선

> 수정일자: 2026-04-03

## 0. 현재 문제

- 가사 자막은 씬 구간 내에서 **줄 수로 균등 분배** → 실제 노래 속도와 안 맞음
- 빠른 구간은 자막이 너무 일찍 넘어가고, 느린 구간은 자막이 늦게 넘어감
- 실제 음성 타이밍 정보가 없어 정확한 자막 전환 불가

## 1. 해결 방향

```
1. 씬의 오디오 구간을 Whisper API에 전송
2. Whisper가 줄별 타이밍(start/end) 반환
3. 해당 타이밍으로 ASS 자막 생성 (기존 균등 분배 대체)
4. Whisper 실패 시 기존 균등 분배로 fallback
```

**데이터 흐름 요약**

```
오디오 구간           Whisper API                   ASS 자막 생성
──────────          ──────────────────            ──────────────
씬 A (0.0~15.0s)  → "벚꽃 피는..."  0.0~3.2s   → Dialogue: 0:00:00.00,0:00:03.20,...
                    "봄바람 불어..." 3.2~6.8s   → Dialogue: 0:00:03.20,0:00:06.80,...
                    "하늘 아래..."  6.8~12.1s   → Dialogue: 0:00:06.80,0:00:12.10,...

씬 B (15.0~30.0s) → "사랑의 노래..." 0.0~4.5s  → Dialogue: 0:00:15.00,0:00:19.50,...
                    ...
```

## 2. 구체적 변경

### 2-1. 새 서비스: `whisper_service.py`

| 항목 | 내용 |
|------|------|
| 함수 | `get_lyrics_timestamps(audio_bytes, lyrics_text) -> list[dict]` |
| 역할 | 오디오 구간을 Whisper API에 전송하여 줄별 타이밍 추출 |
| 반환 형식 | `[{"text": "벚꽃 피는...", "start": 0.0, "end": 3.2}, ...]` |
| API 호출 | `client.audio.transcriptions.create(model="whisper-1", response_format="verbose_json", timestamp_granularities=["segment"])` |

### 2-2. `subtitle_generator.py` 수정

| 변경 대상 | 변경 내용 |
|-----------|----------|
| `generate_scene_lyrics_ass(scene, timestamps=None)` | `timestamps`가 있으면 Whisper 타이밍 사용, 없으면 기존 균등 분배 (fallback) |
| `generate_lyrics_ass(scenes, all_timestamps=None)` | Phase 5용 전체 자막도 동일하게 timestamps 지원 |

### 2-3. 자막 생성 호출부 수정 (3곳)

| 호출부 | 파일 | 변경 내용 |
|--------|------|----------|
| 개별 씬 생성 | `mv.py` | 오디오 구간 자르기 → Whisper → timestamps → ASS 생성 |
| Phase 3.6 | `mv_pipeline.py` | 동일 |
| Phase 5 | `mv_pipeline.py` | 전체 오디오 → 씬별 Whisper → 전체 ASS 생성 |

### 2-4. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전

```
씬 구간: 0.0 ~ 12.0초 (12초)
가사 3줄 → 균등 분배: 각 4.0초씩

Dialogue: 0:00:00.00,0:00:04.00,벚꽃 피는 거리를 걸어가며
Dialogue: 0:00:04.00,0:00:08.00,봄바람이 살며시 불어오면
Dialogue: 0:00:08.00,0:00:12.00,하늘 아래 너와 나의 이야기
→ 실제 노래 속도와 무관하게 4초씩 고정
```

### 변경 후

```
씬 구간: 0.0 ~ 12.0초 (12초)
Whisper 분석 결과 기반:

Dialogue: 0:00:00.00,0:00:03.20,벚꽃 피는 거리를 걸어가며
Dialogue: 0:00:03.20,0:00:06.80,봄바람이 살며시 불어오면
Dialogue: 0:00:06.80,0:00:12.00,하늘 아래 너와 나의 이야기
→ 실제 음성 타이밍에 맞춰 자막 전환
```

## 4. 테스트

- [ ] `whisper_service.py` 단독 호출 시 타이밍이 올바르게 반환되는지 확인
- [ ] Whisper API 실패 시 기존 균등 분배 fallback 정상 동작 확인
- [ ] 개별 씬 생성 (`mv.py`) 경로에서 Whisper 타이밍 기반 ASS 자막 생성 확인
- [ ] Phase 3.6 (`mv_pipeline.py`) 경로에서 Whisper 타이밍 기반 ASS 자막 생성 확인
- [ ] Phase 5 (`mv_pipeline.py`) 전체 자막에서 Whisper 타이밍 기반 ASS 자막 생성 확인
- [ ] 한국어/영어/일본어 등 다국어 가사에서 Whisper 타이밍 정확도 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`whisper_service.py` 신규) | 1 | 0/1 |
| 백엔드 (`subtitle_generator.py` 수정) | 2 | 0/2 |
| 백엔드 (호출부 수정: `mv.py`, `mv_pipeline.py`) | 3 | 0/3 |
| 프론트엔드 | 0 | — |
| 테스트 | 8 | 0/8 |

---

# v8.1 — 2단계 타이밍 비율 보정

> 수정일자: 2026-04-03

## 0. 문제

1. **Gemini 섹션 시간 합 ≠ 음악 총 길이 (ffprobe)**
   - Gemini가 분석한 섹션들의 시간 합계가 ffprobe로 측정한 실제 음악 길이와 불일치
2. **GPT 클립 use_seconds 합 ≠ Gemini 섹션 길이**
   - GPT가 반환한 클립들의 use_seconds 합계가 해당 Gemini 섹션의 길이와 불일치

## 1. 해결 방향

2단계 비율 보정을 적용하여, AI가 추정한 시간 값을 실제 음악 길이에 맞춤.

```
보정 1: Gemini 섹션 → ffprobe 총 길이
─────────────────────────────────────
ffprobe 총 길이 = 159초
Gemini 섹션 합  = 238초 (Intro 30 + Verse 60 + Chorus 48 + ...)
비율            = 159 / 238 = 0.6681
→ 모든 섹션 시간 × 0.6681 (Intro 30→20.04, Verse 60→40.08, ...)

보정 2: GPT 클립 → Gemini 섹션 길이 (보정 후)
─────────────────────────────────────
Chorus 섹션 보정 후 = 19초
GPT 클립 합         = 20초 (clip1 8 + clip2 7 + clip3 5)
비율                = 19 / 20 = 0.95
→ 각 클립 use_seconds × 0.95 (clip1 8→7.6, clip2 7→6.65, clip3 5→4.75)
```

## 2. 구체적 변경

### 2-1. `mv_pipeline.py` 수정

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1a 후 (Gemini 분석 직후) | ffprobe로 음악 총 길이 확정 → Gemini 섹션 시간 비율 보정 |
| Phase 1b 후 (GPT 클립 생성 직후) | 각 섹션별 GPT 클립 use_seconds 합 확인 → 섹션 길이에 맞춰 비율 보정 |

**보정 1 로직 (Phase 1a 후)**

```python
# ffprobe로 실제 총 길이 확정
actual_duration = get_audio_duration(audio_path)  # ffprobe

# Gemini 섹션 합 계산
gemini_total = sum(s["duration"] for s in sections)

# 비율 보정
if abs(gemini_total - actual_duration) > 0.5:  # 0.5초 이상 차이 시
    ratio = actual_duration / gemini_total
    for s in sections:
        s["duration"] *= ratio
        s["start_time"] = recalculate  # 누적 합으로 재계산
```

**보정 2 로직 (Phase 1b 후)**

```python
# 각 섹션별 GPT 클립 보정
for section in sections:
    section_duration = section["duration"]  # 보정 1 적용 후 값
    clip_total = sum(c["use_seconds"] for c in section["clips"])
    
    if abs(clip_total - section_duration) > 0.1:  # 0.1초 이상 차이 시
        ratio = section_duration / clip_total
        for c in section["clips"]:
            c["use_seconds"] *= ratio
```

### 2-2. `mv_generator.py` 수정

| 변경 대상 | 변경 내용 |
|-----------|----------|
| `_split_with_music_sections()` | 플래트닝 시 보정된 시간 값 사용 확인, 필요 시 최종 보정 적용 |

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전

```
Gemini 분석: Intro 30s + Verse1 60s + Chorus 48s + ... = 238s
실제 음악:   159s
→ 모든 타이밍 37% 초과 → 영상이 음악보다 길어짐

GPT 클립: clip1 8s + clip2 7s + clip3 5s = 20s
Gemini Chorus: 19s
→ 클립 합이 섹션보다 1s 초과 → 마지막 클립이 음악 밖으로 넘침
```

### 변경 후

```
보정 1 적용: Intro 20.04s + Verse1 40.08s + Chorus 32.06s + ... = 159s ✓
보정 2 적용: clip1 7.6s + clip2 6.65s + clip3 4.75s = 19s ✓
→ 영상 길이 = 음악 길이, 모든 클립이 섹션 내에 정확히 수용
```

## 4. 테스트

- [ ] ffprobe 총 길이 추출 정상 동작 확인
- [ ] 보정 1: Gemini 섹션 합 = ffprobe 총 길이 확인
- [ ] 보정 1: 각 섹션 start_time 누적 합 정확성 확인
- [ ] 보정 2: 각 섹션 내 GPT 클립 use_seconds 합 = 섹션 duration 확인
- [ ] 보정 차이가 임계값 이하(0.5초/0.1초)일 때 보정 스킵 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_pipeline.py` 수정) | 2 | 0/2 |
| 백엔드 (`mv_generator.py` 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 7 | 0/7 |

---

# v9.0 — Gemini 오디오 분석을 Whisper 기반 섹션 타이밍으로 대체

> 수정일자: 2026-04-03

## 0. 문제

Gemini 오디오 분석이 섹션 경계를 부정확하게 잡아서 가사-음악 싱크가 맞지 않음.
238초로 분석된 것을 159초로 비율 보정(v8.1)해도, 상대적인 섹션 위치 자체가 틀리기 때문에 근본적으로 해결되지 않음.

## 1. 해결 방향

Whisper로 전체 음악을 분석하여 가사 텍스트의 실제 위치(타임스탬프)를 찾고, 이를 기반으로 섹션 경계를 확정한다.

```
전체 음악 → Whisper API → 세그먼트별 텍스트+타이밍
    ↓
가사 섹션별 텍스트와 Whisper 세그먼트 매칭
    ↓
각 섹션의 실제 시작/끝 시간 확정
    ↓
인스트루멘탈 구간(보컬 없는 곳)은 빈 공간으로 자동 계산
```

## 2. 구체적 변경

### 2-1. `whisper_service.py` 수정

| 변경 대상 | 변경 내용 |
|-----------|----------|
| `get_full_audio_timestamps()` 신규 | 전체 오디오를 Whisper에 보내서 모든 세그먼트의 텍스트+타이밍 반환 |

**함수 시그니처**

```python
def get_full_audio_timestamps(audio_bytes: bytes, file_format: str = "mp3") -> list[dict]:
    """전체 오디오를 Whisper API에 보내 세그먼트별 텍스트+타이밍을 반환.

    Returns:
        List of {"text": str, "start": float, "end": float}
    """
```

- 기존 `get_lyrics_timestamps()`와 구현은 동일하나, 용도와 네이밍을 구분하여 전체 음원 분석 전용으로 사용
- 기존 함수가 이미 동일 기능을 제공하므로, 래퍼 함수로 구현하거나 기존 함수를 그대로 재사용해도 무방

### 2-2. `mv_pipeline.py` Phase 1a 수정

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1a 전체 | Gemini `analyze_music_structure()` 대신 Whisper 기반 섹션 타이밍 추출 |
| Gemini 코드 | 삭제하지 않고 Whisper 실패 시 fallback으로 유지 |
| 보정 1 로직 | Whisper 경로에서는 불필요 (실제 타이밍이므로), Gemini fallback 시에만 적용 |

**Phase 1a 새 로직**

```python
# ── Phase 1a: Whisper 기반 섹션 타이밍 추출 ──

# Step 1: 가사 섹션 태그 파싱 → 각 섹션의 가사 텍스트 확보
lyrics_text = job.get("lyrics", "")
sections_with_lyrics = parse_lyrics_sections(lyrics_text)
# → [{"label": "Verse 1", "lines": ["벚꽃 피는 거리를", "봄바람이 불어오면"]},
#    {"label": "Chorus", "lines": ["사랑해 너를", "영원히"]}, ...]

# Step 2: 전체 오디오를 Whisper에 전송 → 세그먼트별 타이밍
from .whisper_service import get_full_audio_timestamps
whisper_segments = get_full_audio_timestamps(audio_bytes, file_format)
# → [{"text": "벚꽃 피는 거리를 걸어가며", "start": 15.2, "end": 19.8},
#    {"text": "봄바람이 살며시 불어오면", "start": 19.8, "end": 24.1}, ...]

# Step 3: 각 가사 섹션의 텍스트를 Whisper 세그먼트에서 순서대로 매칭
music_sections = match_sections_to_whisper(sections_with_lyrics, whisper_segments, audio_duration)

# Step 4: 결과를 기존 music_sections 형식으로 변환
# → [{"label": "Intro", "start": 0.0, "end": 15.2, "mood": "..."},
#    {"label": "Verse 1", "start": 15.2, "end": 38.5, "mood": "..."}, ...]
```

**섹션-Whisper 매칭 알고리즘 (`match_sections_to_whisper`)**

```python
def match_sections_to_whisper(
    sections_with_lyrics: list[dict],
    whisper_segments: list[dict],
    audio_duration: float,
) -> list[dict]:
    """가사 섹션 텍스트를 Whisper 세그먼트에 순서대로 매칭하여 섹션 경계를 확정.

    매칭 로직:
    1. Whisper 세그먼트를 순서대로 소비 (인덱스 포인터 방식)
    2. 각 가사 섹션의 첫 줄 텍스트가 현재 Whisper 세그먼트와 유사하면 섹션 시작
    3. 다음 섹션의 첫 줄이 매칭될 때까지 현재 섹션에 포함
    4. 보컬 없는 섹션 (Intro, Interlude, Outro 등 가사 없는 것)은
       앞뒤 보컬 섹션 사이의 빈 공간으로 자동 계산
    5. 텍스트 유사도는 공백/특수문자 제거 후 부분 문자열 매칭 또는
       SequenceMatcher ratio >= 0.5 기준
    """
```

**보컬 없는 섹션 처리**

```
예시:
  Whisper 세그먼트: 15.2초 ~ 140.5초 (보컬 구간)
  음악 총 길이: 159초

  Intro (가사 없음): 0.0 ~ 15.2  ← 첫 보컬 세그먼트 시작 전
  Verse 1 (가사 있음): 15.2 ~ 38.5  ← Whisper 매칭
  Chorus (가사 있음): 38.5 ~ 55.0  ← Whisper 매칭
  Interlude (가사 없음): 55.0 ~ 62.3  ← Chorus 끝 ~ Bridge 시작
  Bridge (가사 있음): 62.3 ~ 80.0  ← Whisper 매칭
  ...
  Outro (가사 없음): 140.5 ~ 159.0  ← 마지막 보컬 세그먼트 끝 ~ 음악 끝
```

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (Gemini + 비율 보정)

```
Gemini 분석: Intro 30s + Verse1 60s + Chorus 48s + ... = 238s
비율 보정:   Intro 20.04s + Verse1 40.08s + Chorus 32.06s + ... = 159s
→ 비율은 맞지만 섹션 경계 위치 자체가 부정확
→ Verse1이 실제로 15~38초인데 Gemini는 20~60초로 분석
→ 보정해도 13.4~40.1초가 되어 시작점부터 어긋남
```

### 변경 후 (Whisper 기반)

```
Whisper 세그먼트: "벚꽃 피는 거리를" 15.2~19.8s, "봄바람이" 19.8~24.1s, ...
가사 매칭: Verse1의 첫 줄 "벚꽃 피는 거리를" → 15.2초에서 시작
→ Verse1: 15.2 ~ 38.5초 (실제 보컬 위치 기반)
→ Intro: 0.0 ~ 15.2초 (자동 계산)
→ 실제 음성 위치에 기반하므로 가사-음악 싱크 정확
```

## 4. 테스트

- [ ] `whisper_service.py`의 `get_full_audio_timestamps()` 전체 음원으로 호출 시 세그먼트 정상 반환 확인
- [ ] 가사 섹션 파싱 (`parse_lyrics_sections`) 정상 동작 확인 (다양한 태그 형식)
- [ ] 섹션-Whisper 매칭 (`match_sections_to_whisper`) 정상 동작 확인
- [ ] 보컬 없는 섹션 (Intro, Interlude, Outro) 자동 계산 정확성 확인
- [ ] Whisper 실패 시 Gemini fallback 정상 동작 확인
- [ ] 기존 보정 1 로직이 Gemini fallback 시에만 적용되는지 확인
- [ ] 한국어/영어/일본어 가사에서 Whisper 세그먼트 매칭 정확도 확인
- [ ] 결과가 기존 `music_sections` 형식과 호환되는지 확인 (후속 Phase에 영향 없음)
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`whisper_service.py` 수정) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` Phase 1a 수정) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 10 | 0/10 |

# v10.0 — 가사 섹션 1개 = 씬 1개 단순화

> 수정일자: 2026-04-03

## 0. 문제

기존 파이프라인이 불필요하게 복잡함:
- Gemini 분석 → GPT 씬 분할 → 가사 매칭의 3단계 파이프라인
- GPT가 씬 개수와 경계를 자의적으로 결정하여 가사 섹션과 불일치
- `_assign_lyrics_to_scenes()`에서 가사를 씬에 재매칭하는 과정에서 누락/중복 발생

## 1. 해결 방향

가사 섹션 1개 = 씬 1개로 단순화한다.

```
가사 텍스트 → 섹션 태그 파싱 → 섹션 목록
    ↓
전체 오디오 → Whisper → 각 섹션의 실제 타이밍 확정
    ↓
가사 섹션 1개 = 씬 1개 (가사는 섹션 내용 그대로)
    ↓
GPT는 각 씬의 이미지/영상 프롬프트만 생성
```

## 2. 구체적 변경

### 2-1. `mv_pipeline.py` Phase 1a 수정

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1a | Gemini 분석 제거, 가사 파싱 + Whisper 타이밍 → 씬 목록 직접 생성 |
| `_assign_lyrics_to_scenes()` | 호출 제거 (가사는 이미 씬에 직접 배정) |

**Phase 1a 새 로직**

```python
# ── Phase 1a: 가사 파싱 + Whisper 타이밍 → 씬 목록 직접 생성 ──

# Step 1: 가사 섹션 태그 파싱 → 섹션 목록
lyrics_text = job.get("lyrics", "")
sections = parse_lyrics_sections(lyrics_text)
# → [{"label": "Verse 1", "lines": ["벚꽃 피는 거리를", ...]},
#    {"label": "Chorus", "lines": ["사랑해 너를", ...]}, ...]

# Step 2: Whisper로 각 섹션의 실제 타이밍 확정
whisper_segments = get_full_audio_timestamps(audio_bytes, file_format)
music_sections = match_sections_to_whisper(sections, whisper_segments, audio_duration)

# Step 3: 가사 섹션 1개 = 씬 1개로 직접 변환
scenes = []
for i, sec in enumerate(music_sections):
    label_lower = sec["label"].lower()
    # scene_type 결정: rap/chorus → lipsync, 나머지 → drama
    if "rap" in label_lower or "chorus" in label_lower:
        scene_type = "lipsync"
    else:
        scene_type = "drama"

    scenes.append({
        "scene_number": i + 1,
        "section_label": sec["label"],
        "section_start": sec["start"],
        "section_end": sec["end"],
        "scene_type": scene_type,
        "lyrics": "\n".join(sec.get("lines", [])),
        "image_prompt": None,   # Phase 1b에서 GPT가 채움
        "video_prompt": None,   # Phase 1b에서 GPT가 채움
    })
```

### 2-2. `mv_pipeline.py` Phase 1b 수정

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1b | GPT에게 씬 목록 전달 → 이미지/영상 프롬프트만 생성 요청 |
| GPT 프롬프트 | 씬 분할/가사 배정 지시 제거, 프롬프트 생성만 요청 |

**Phase 1b 새 로직**

```python
# ── Phase 1b: GPT → 각 씬의 이미지/영상 프롬프트 생성 ──

# scenes 리스트를 GPT에 전달하여 각 씬의 image_prompt, video_prompt만 받기
# GPT는 씬 개수/경계/가사를 변경하지 않음
# 입력: scenes (scene_number, section_label, lyrics, scene_type)
# 출력: 각 scene_number에 대한 image_prompt, video_prompt
```

### 2-3. 제거 항목

| 제거 대상 | 사유 |
|-----------|------|
| Gemini `analyze_music_structure()` 호출 | 가사 파싱 + Whisper로 대체 |
| GPT 씬 분할 로직 | 가사 섹션 = 씬이므로 불필요 |
| `_assign_lyrics_to_scenes()` 호출 | 가사가 이미 씬에 직접 포함 |

### 2-4. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (v9.0: Whisper 타이밍 + GPT 씬 분할 + 가사 매칭)

```
가사 파싱 → 섹션 목록
Whisper → 섹션 타이밍 확정
GPT → 씬 분할 (씬 개수/경계를 GPT가 결정)
_assign_lyrics_to_scenes() → 가사를 씬에 재매칭
→ GPT가 섹션과 다른 씬 경계를 만들어 가사 누락/중복 발생
```

### 변경 후 (v10.0: 가사 섹션 = 씬)

```
가사 파싱 → 섹션 목록
Whisper → 섹션 타이밍 확정
가사 섹션 1개 = 씬 1개 (직접 변환, GPT 개입 없음)
GPT → 이미지/영상 프롬프트만 생성
→ 가사-씬 매칭이 100% 정확, 파이프라인 단순화
```

## 4. 테스트

- [ ] 가사 섹션 파싱 → 씬 직접 변환 정상 동작 확인
- [ ] scene_type 자동 할당 정확성 확인 (rap/chorus → lipsync, 나머지 → drama)
- [ ] section_start/end가 Whisper 타이밍 그대로 사용되는지 확인
- [ ] GPT가 씬 구조를 변경하지 않고 프롬프트만 생성하는지 확인
- [ ] `_assign_lyrics_to_scenes()` 호출이 제거되었는지 확인
- [ ] Gemini 분석 호출이 제거되었는지 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_pipeline.py` Phase 1a 수정) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` Phase 1b 수정) | 1 | 0/1 |
| 백엔드 (제거: Gemini, GPT 씬 분할, 가사 매칭) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 8 | 0/8 |

# v10.1 — Demucs 보컬 분리 후 Whisper 분석으로 안정성 개선

> 수정일자: 2026-04-04

## 0. 문제

원본 음악(보컬+악기)을 Whisper에 넣으면 결과가 매번 달라서 섹션 타이밍이 불안정함.
- 반주(드럼, 기타, 베이스 등)가 섞인 상태에서 Whisper가 음성을 인식
- 같은 파일을 반복 분석해도 세그먼트 경계가 달라짐
- 섹션 타이밍이 불안정하여 가사-영상 싱크 품질 저하

## 1. 해결 방향

원본 음악 → Demucs(보컬 분리) → 분리된 보컬만 → Whisper → 안정적 타이밍

```
원본 음악 파일 (보컬 + 악기)
    ↓
Demucs 보컬 분리 (기존 enhance_vocal_demucs 재사용)
    ↓
분리된 보컬 트랙 (악기 제거됨)
    ↓
Whisper 분석 (깨끗한 보컬만 → 인식 안정적)
    ↓
안정적인 세그먼트 타이밍
    ↓
_build_sections_from_whisper → 씬 생성 (기존과 동일)
```

## 2. 구체적 변경

### 2-1. `mv_pipeline.py` Phase 1a 수정

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1a (Whisper 호출 전) | Demucs로 보컬 분리 후, 분리된 보컬을 Whisper에 전달 |

**Phase 1a 변경 로직**

```python
# ── Phase 1a: 가사 파싱 + Demucs 보컬 분리 + Whisper 타이밍 → 씬 목록 ──

# Step 1: 가사 섹션 태그 파싱 → 섹션 목록 (기존과 동일)
lyrics_text = job.get("lyrics", "")
sections = parse_lyrics_sections(lyrics_text)

# Step 2: Demucs로 보컬 분리 (NEW)
from app.services.demucs_service import enhance_vocal_demucs
vocal_bytes = await enhance_vocal_demucs(audio_bytes, file_name)

# Step 3: 분리된 보컬을 Whisper에 전달 (기존: audio_bytes → 변경: vocal_bytes)
whisper_segments = get_full_audio_timestamps(vocal_bytes, file_format)

# Step 4: 결과 검증 + 재시도 (NEW)
music_sections = _build_sections_from_whisper(sections, whisper_segments, audio_duration)
music_sections = _validate_and_retry_whisper(
    music_sections, vocal_bytes, file_format, sections, audio_duration, max_retries=2
)

# Step 5: 가사 섹션 1개 = 씬 1개로 직접 변환 (기존과 동일)
```

### 2-2. 결과 검증 로직 추가 (`mv_pipeline.py`)

| 변경 위치 | 변경 내용 |
|-----------|----------|
| `mv_pipeline.py` 신규 함수 | `_validate_and_retry_whisper()` 추가 |

**검증 로직**

```python
def _validate_and_retry_whisper(
    music_sections: list,
    vocal_bytes: bytes,
    file_format: str,
    sections: list,
    audio_duration: float,
    max_retries: int = 2,
) -> list:
    """Whisper 결과 검증 후 비정상이면 재시도, 최종 실패 시 균등 분할 fallback."""

    for attempt in range(max_retries + 1):
        if _is_valid_sections(music_sections, audio_duration):
            return music_sections

        if attempt < max_retries:
            # 재시도: Whisper 재분석
            logger.warning(f"Whisper 결과 비정상 (시도 {attempt + 1}), 재시도...")
            whisper_segments = get_full_audio_timestamps(vocal_bytes, file_format)
            music_sections = _build_sections_from_whisper(
                sections, whisper_segments, audio_duration
            )

    # 최종 실패 → 균등 분할 fallback
    logger.warning("Whisper 재시도 모두 실패, 균등 분할 fallback 적용")
    return _fallback_even_split(sections, audio_duration)


def _is_valid_sections(music_sections: list, audio_duration: float) -> bool:
    """하나의 섹션이 전체의 40% 이상이면 비정상으로 판단."""
    if not music_sections:
        return False
    for sec in music_sections:
        sec_duration = sec["end"] - sec["start"]
        if sec_duration / audio_duration > 0.4:
            return False
    return True


def _fallback_even_split(sections: list, audio_duration: float) -> list:
    """섹션을 균등하게 분할."""
    n = len(sections)
    if n == 0:
        return []
    seg_len = audio_duration / n
    result = []
    for i, sec in enumerate(sections):
        result.append({
            "label": sec["label"],
            "lines": sec.get("lines", []),
            "start": round(seg_len * i, 2),
            "end": round(seg_len * (i + 1), 2),
        })
    return result
```

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (v10.0: 원본 음원 → Whisper)

```
원본 음원 (보컬+악기) → Whisper → 세그먼트 타이밍
→ 악기 간섭으로 인식 불안정
→ 같은 파일 반복 분석 시 결과 달라짐
→ 검증/재시도 없음
```

### 변경 후 (v10.1: Demucs 보컬 분리 → Whisper)

```
원본 음원 → Demucs 보컬 분리 → 깨끗한 보컬 → Whisper → 세그먼트 타이밍
→ 악기 제거되어 인식 안정적
→ 반복 분석해도 결과 일관됨
→ 비정상 결과 검증 + 재시도 (최대 2회) + 균등 분할 fallback
```

## 4. 테스트

- [ ] Demucs 보컬 분리가 정상 동작하는지 확인 (`enhance_vocal_demucs` 호출)
- [ ] 분리된 보컬만으로 Whisper 분석 시 세그먼트 정상 반환 확인
- [ ] 같은 파일 반복 분석 시 결과 일관성 확인 (3회 반복)
- [ ] `_is_valid_sections()` 40% 초과 섹션 감지 정상 동작 확인
- [ ] 비정상 결과 시 재시도 로직 동작 확인 (최대 2회)
- [ ] 재시도 실패 시 균등 분할 fallback 정상 동작 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_pipeline.py` Phase 1a 수정: Demucs 추가) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` 검증 로직 추가) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 8 | 0/8 |

---

# v10.2 — 15초 초과 섹션 자동 분할 (Whisper 줄 타이밍 기반)

> 수정일자: 2026-04-04

## 0. 문제

Kling 영상 생성 API 최대 길이는 **15초**인데, Whisper 기반 섹션 타이밍에서 15초를 초과하는 섹션이 빈번하게 발생한다.

| 섹션 예시 | 실측 길이 | 문제 |
|-----------|-----------|------|
| Chorus | 19초 | Kling 15초 제한 초과 |
| Bridge | 24초 | Kling 15초 제한 초과 |
| Outro | 28초 | Kling 15초 제한 초과 |

현재 코드는 섹션 1개 = 씬 1개로 매핑하므로, 15초 초과 섹션은 영상 생성 시 잘리거나 실패한다.

## 1. 해결 방향

Phase 1a에서 Whisper 세그먼트(줄 단위 타이밍)를 job에 보존하고, 씬 생성 시 15초 초과 섹션을 **가사 줄 경계**에서 자동 분할하여 각 클립이 10초 이하가 되도록 한다.

```
Phase 1a: Whisper 세그먼트 → job.whisper_segments에 저장
    ↓
씬 생성 시: 섹션별 duration 확인
    ↓
15초 초과? → 해당 섹션의 Whisper 줄 타이밍으로 분할
    ↓
분할 기준: 줄 경계에서 나눠서 각 클립 ≤ 10초
    ↓
분할된 씬: "Chorus-1", "Chorus-2" 등으로 명명
    ↓
가사도 줄 단위로 분배
```

## 2. 구체적 변경

### 2-1. Phase 1a: Whisper 세그먼트 저장 (`mv_pipeline.py`)

| 변경 위치 | 변경 내용 |
|-----------|----------|
| Phase 1a (Whisper 분석 후) | `whisper_segments`를 job에 저장 (`job.whisper_segments`) |

**변경 로직**

```python
# Step 2: Whisper 분석 후 세그먼트 저장
whisper_segments = get_full_audio_timestamps(...)

# whisper_segments를 job에 저장 (씬 분할 시 줄 타이밍 참조용)
await _update_job(mongo_db, job_id, {
    "whisper_segments": whisper_segments,
})
```

### 2-2. 씬 생성 시 15초 초과 섹션 자동 분할 (`mv_pipeline.py`)

| 변경 위치 | 변경 내용 |
|-----------|----------|
| 씬 생성 루프 (기존 `for i, sec in enumerate(music_sections)`) | 15초 초과 시 `_split_long_section()` 호출 |
| 신규 함수 `_split_long_section()` | Whisper 줄 타이밍 기반으로 10초 이하 클립 분할 |

**15초 초과 섹션 분할 로직**

```python
MAX_CLIP_SEC = 15.0
TARGET_CLIP_SEC = 10.0


def _split_long_section(
    sec: dict,
    whisper_segments: list[dict],
    lyrics_lines: list[str],
) -> list[dict]:
    """15초 초과 섹션을 Whisper 줄 타이밍 기반으로 분할.

    Args:
        sec: {"label", "start", "end", "mood"} 섹션 정보
        whisper_segments: [{"text", "start", "end"}, ...] 전체 Whisper 세그먼트
        lyrics_lines: 해당 섹션의 가사 줄 리스트

    Returns:
        분할된 서브섹션 리스트:
        [{"label": "Chorus-1", "start", "end", "mood", "lyrics_lines": [...]}, ...]
    """
    duration = sec["end"] - sec["start"]
    if duration <= MAX_CLIP_SEC:
        return [sec]

    # 해당 섹션 범위 내의 Whisper 세그먼트 필터링
    seg_in_range = [
        s for s in whisper_segments
        if s["start"] >= sec["start"] - 0.5 and s["end"] <= sec["end"] + 0.5
    ]

    if not seg_in_range:
        # Whisper 세그먼트 없으면 균등 분할 fallback
        return _fallback_split(sec, duration)

    # 줄 경계에서 분할: 누적 시간이 TARGET_CLIP_SEC 초과 시 분할점
    sub_sections = []
    sub_start = seg_in_range[0]["start"]
    sub_lines = []
    sub_idx = 1

    for i, seg in enumerate(seg_in_range):
        sub_lines.append(seg["text"])
        sub_end = seg["end"]
        sub_duration = sub_end - sub_start
        is_last = (i == len(seg_in_range) - 1)

        if sub_duration >= TARGET_CLIP_SEC or is_last:
            sub_sections.append({
                "label": f"{sec['label']}-{sub_idx}",
                "start": round(sub_start, 3),
                "end": round(sub_end, 3),
                "mood": sec.get("mood", ""),
                "lyrics_lines": sub_lines[:],
            })
            sub_idx += 1
            sub_lines = []
            if not is_last:
                sub_start = seg_in_range[i + 1]["start"]

    return sub_sections


def _fallback_split(sec: dict, duration: float) -> list[dict]:
    """Whisper 세그먼트 없을 때 균등 분할."""
    n_parts = max(2, int(duration / TARGET_CLIP_SEC) + 1)
    part_dur = duration / n_parts
    result = []
    for i in range(n_parts):
        result.append({
            "label": f"{sec['label']}-{i + 1}",
            "start": round(sec["start"] + part_dur * i, 3),
            "end": round(sec["start"] + part_dur * (i + 1), 3),
            "mood": sec.get("mood", ""),
            "lyrics_lines": [],
        })
    return result
```

**씬 생성 루프 변경**

```python
# ── 씬 생성: 가사 섹션 1개 = 씬 1개 (15초 초과 시 자동 분할) ──
whisper_segments_saved = job.get("whisper_segments", [])

scenes = []
scene_num = 1
for i, sec in enumerate(music_sections):
    label = sec["label"]
    duration = sec["end"] - sec["start"]

    if duration < 0.5:
        continue

    matching_section = next((s for s in sections if s["tag"] == label), None)
    lyrics_content = matching_section["content"] if matching_section else ""
    lyrics_lines = [l.strip() for l in lyrics_content.split("\n") if l.strip()]

    # 15초 초과 섹션 자동 분할
    if duration > MAX_CLIP_SEC:
        sub_sections = _split_long_section(sec, whisper_segments_saved, lyrics_lines)
    else:
        sub_sections = [{
            **sec,
            "lyrics_lines": lyrics_lines,
        }]

    for sub in sub_sections:
        sub_duration = sub["end"] - sub["start"]
        sub_label = sub["label"]
        sub_lyrics = "\n".join(sub.get("lyrics_lines", []))

        # scene_type 결정 (기존 로직 동일)
        label_lower = sub_label.lower()
        if has_rap:
            scene_type = "lipsync" if any(k in label_lower for k in ("rap", "hiphop", "hip-hop")) else "drama"
        else:
            scene_type = "lipsync" if label_lower.startswith("chorus") else "drama"

        scenes.append({
            "scene_number": scene_num,
            "section": sub_label,
            "scene_type": scene_type,
            "lyrics_segment": sub_lyrics,
            "use_seconds": round(sub_duration, 2),
            "section_start": round(sub["start"], 3),
            "section_end": round(sub["end"], 3),
            "section_mood": sub.get("mood", ""),
            "description": "",
            "image_prompt": "",
            "video_prompt": "",
            "description_ko": "",
            "image_object_name": None,
            "image_source": None,
            "video_object_name": None,
            "video_status": "pending",
            "video_error": None,
        })
        scene_num += 1
```

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (v10.1: 섹션 1개 = 씬 1개)

```
Chorus (19초) → 씬 1개 (19초) → Kling 15초 제한 초과 → 영상 잘림/실패
Bridge (24초) → 씬 1개 (24초) → Kling 15초 제한 초과
Outro  (28초) → 씬 1개 (28초) → Kling 15초 제한 초과
```

### 변경 후 (v10.2: 15초 초과 자동 분할)

```
Chorus (19초) → Chorus-1 (10초) + Chorus-2 (9초) → 각각 Kling 제한 이내
Bridge (24초) → Bridge-1 (8초) + Bridge-2 (8초) + Bridge-3 (8초) → OK
Outro  (28초) → Outro-1 (10초) + Outro-2 (10초) + Outro-3 (8초) → OK
```

## 4. 테스트

- [ ] Phase 1a에서 `whisper_segments`가 job에 정상 저장되는지 확인
- [ ] 15초 이하 섹션은 분할 없이 그대로 1개 씬으로 생성되는지 확인
- [ ] 15초 초과 섹션이 `_split_long_section()`으로 자동 분할되는지 확인
- [ ] 분할된 씬 이름이 "Section-1", "Section-2" 형식인지 확인
- [ ] 분할된 각 클립이 10초 이하인지 확인
- [ ] 가사가 줄 단위로 분배되는지 확인
- [ ] Whisper 세그먼트 없는 경우 균등 분할 fallback 동작 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_pipeline.py` Phase 1a: whisper_segments 저장) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` 신규 함수: `_split_long_section`) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py` 씬 생성 루프: 분할 적용) | 1 | 0/1 |
| 프론트엔드 | 0 | — |
| 테스트 | 9 | 0/9 |

---

# v10.3 — 15초 초과 클립 재분할 + Sync Labs 후 자막 자동 재적용

> 수정일자: 2026-04-04

## 0. 문제

### 문제 A: 가사 줄 경계 분할 후에도 15초 초과 클립 발생

`_split_long_section()`은 Whisper 세그먼트의 줄 경계에서 분할하지만, 가사 줄 간격이 넓어 하나의 줄이 15초를 넘는 경우 분할 결과에 여전히 15초 초과 클립이 남을 수 있다. 이 경우 Kling 영상 생성 API 제한에 걸린다.

### 문제 B: Sync Labs 결과 영상에 자막이 사라짐

Phase 3.6에서 자막 burn-in을 수행하지만, Sync Labs를 거치면 영상이 대체되므로 자막이 사라진다. Phase 3.5 (자동 Sync Labs)와 수동 retry-sync 모두에서 자막이 손실된다.

## 1. 해결 방향

| 문제 | 해결 |
|------|------|
| A: 15초 초과 잔여 클립 | `_split_long_section()` 결과를 후처리하여, 15초 초과 클립이 있으면 시간 기반 균등 재분할 (`ceil(길이/10)`개) |
| B: Sync Labs 후 자막 손실 | 재사용 가능한 `_burn_subtitles_on_video()` 함수를 만들어, Sync Labs 결과 저장 직전에 호출 |

## 2. 변경 상세

### 2-1. `_split_long_section()` 후처리 — 15초 초과 클립 재분할 (`mv_pipeline.py`)

| 변경 위치 | 변경 내용 |
|-----------|----------|
| `_split_long_section()` 함수 끝 (return 직전) | 결과 리스트를 순회하며 15초 초과 클립을 시간 기반 균등 재분할 |

**변경 로직**

```python
import math

# 기존 분할 결과 (clips) 에서 15초 초과 클립 재분할
final_clips = []
for clip in clips:
    clip_dur = clip["end"] - clip["start"]
    if clip_dur > MAX_CLIP_SEC:
        # 시간 기반 균등 분할: ceil(길이/10)개
        n_parts = math.ceil(clip_dur / TARGET_CLIP_SEC)
        part_dur = clip_dur / n_parts
        clip_lines = clip.get("lyrics_segment", "").split("\n") if clip.get("lyrics_segment") else []
        lines_per_part = max(1, len(clip_lines) // n_parts) if clip_lines else 0

        # 기존 section 이름에서 base와 suffix 추출
        base_section = clip["section"]
        for j in range(n_parts):
            p_start = clip["start"] + j * part_dur
            p_end = clip["start"] + (j + 1) * part_dur
            if clip_lines:
                l_s = j * lines_per_part
                l_e = l_s + lines_per_part if j < n_parts - 1 else len(clip_lines)
                p_lyrics = "\n".join(clip_lines[l_s:l_e])
            else:
                p_lyrics = ""
            final_clips.append({
                "section": "{}.{}".format(base_section, j + 1),
                "start": round(p_start, 3),
                "end": round(p_end, 3),
                "lyrics_segment": p_lyrics,
            })
    else:
        final_clips.append(clip)

return final_clips
```

**재분할 예시**

```
Chorus-1 (8초)  → 그대로 유지
Chorus-2 (18초) → Chorus-2.1 (9초) + Chorus-2.2 (9초)   # ceil(18/10) = 2
Chorus-3 (6초)  → 그대로 유지
```

### 2-2. Sync Labs 후 자막 재적용 — `_burn_subtitles_on_video()` 신규 함수 (`mv_pipeline.py`)

| 변경 위치 | 변경 내용 |
|-----------|----------|
| 신규 함수 `_burn_subtitles_on_video()` | 영상 bytes + scene + audio_bytes → 자막 burn-in된 영상 bytes 반환 |
| Phase 3.5 (자동 Sync Labs) | `synclabs_obj` 저장 직전에 `_burn_subtitles_on_video()` 호출 |
| `mv.py` `_retry_sync_for_scene()` (수동 retry-sync) | `synclabs_object` 저장 직전에 `_burn_subtitles_on_video()` 호출 |

**신규 함수**

```python
def _burn_subtitles_on_video(
    video_bytes: bytes,
    scene: dict,
    audio_bytes: bytes | None = None,
) -> bytes:
    """Sync Labs 결과 영상에 가사 자막을 burn-in하여 반환.

    Args:
        video_bytes: 자막을 입힐 영상 (mp4)
        scene: 씬 정보 dict (lyrics_segment, section_start, section_end 등)
        audio_bytes: 해당 구간 오디오 bytes (Whisper 타이밍 추출용, 없으면 기본 타이밍)

    Returns:
        자막이 burn-in된 영상 bytes. 실패 시 원본 video_bytes 그대로 반환.
    """
    import tempfile, subprocess
    from .subtitle_generator import generate_scene_lyrics_ass

    if not scene.get("lyrics_segment"):
        return video_bytes

    try:
        # Whisper 타이밍 추출 (audio_bytes가 있는 경우)
        timestamps = None
        if audio_bytes:
            try:
                from .whisper_service import get_lyrics_timestamps
                timestamps = get_lyrics_timestamps(audio_bytes)
            except Exception:
                pass

        ass_content = generate_scene_lyrics_ass(scene, timestamps=timestamps)
        if not ass_content:
            return video_bytes

        with tempfile.TemporaryDirectory() as tmpdir:
            vid_path = os.path.join(tmpdir, "input.mp4")
            ass_path = os.path.join(tmpdir, "lyrics.ass")
            out_path = os.path.join(tmpdir, "output.mp4")

            with open(vid_path, "wb") as f:
                f.write(video_bytes)
            with open(ass_path, "w", encoding="utf-8") as f:
                f.write(ass_content)

            escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
            ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"

            subprocess.run(
                [ffmpeg_bin, "-y",
                 "-i", vid_path,
                 "-vf", "ass={}".format(escaped_ass),
                 "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                 "-c:a", "copy",
                 out_path],
                capture_output=True, timeout=60,
            )

            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    return f.read()

        return video_bytes

    except Exception as e:
        logger.warning("_burn_subtitles_on_video failed: %s", str(e)[:200])
        return video_bytes
```

**Phase 3.5 호출 지점 (자동 Sync Labs)**

```python
# 기존: silent_video를 바로 저장
# 변경: silent_video에 자막 burn-in 후 저장

# Sync Labs 결과에 자막 재적용
segment_audio_for_sub = cut_audio_segment(full_audio_for_merge, start, end)
silent_video = _burn_subtitles_on_video(silent_video, scene, segment_audio_for_sub)

synclabs_obj = "mv/{}/scenes/{:03d}_video_synclabs.mp4".format(str(job_id), sn)
minio_client.put_object(...)
```

**수동 retry-sync 호출 지점 (`mv.py` `_retry_sync_for_scene()`)**

```python
# 기존: final_video를 바로 저장
# 변경: final_video에 자막 burn-in 후 저장

from ..services.mv_pipeline import _burn_subtitles_on_video
final_video = _burn_subtitles_on_video(final_video, scene, original_segment_audio)

synclabs_object = "mv/{}/scenes/{:03d}_video_synclabs.mp4".format(job_id, scene_number)
minio_client.put_object(...)
```

### 2-3. 프론트엔드

변경 없음.

## 3. 변경 전후 비교

### 변경 전 (v10.2)

```
_split_long_section() 결과:
  Chorus-1 (8초)  → OK
  Chorus-2 (18초) → Kling 15초 제한 초과 (줄 경계 분할로도 해결 안 됨)

Sync Labs 결과:
  씬 영상 (자막 있음) → Sync Labs → 씬 영상 (자막 없음) → 최종 영상에서 자막 누락
```

### 변경 후 (v10.3)

```
_split_long_section() 결과 + 재분할:
  Chorus-1 (8초)  → OK
  Chorus-2 (18초) → Chorus-2.1 (9초) + Chorus-2.2 (9초) → 모든 클립 15초 이하

Sync Labs 결과:
  씬 영상 → Sync Labs → _burn_subtitles_on_video() → 씬 영상 (자막 복원) → 최종 영상 자막 유지
```

## 4. 테스트

- [ ] 가사 줄 경계 분할 후 15초 초과 클립이 시간 기반 재분할되는지 확인
- [ ] 재분할된 클립 이름이 "Section-N.M" 형식인지 확인
- [ ] 재분할 시 가사가 균등 분배되는지 확인
- [ ] 15초 이하 클립은 재분할 없이 유지되는지 확인
- [ ] Phase 3.5 (자동 Sync Labs) 후 자막이 영상에 burn-in되는지 확인
- [ ] 수동 retry-sync 후 자막이 영상에 burn-in되는지 확인
- [ ] `_burn_subtitles_on_video()` 실패 시 원본 영상이 그대로 반환되는지 확인
- [ ] 가사가 없는 씬에서 `_burn_subtitles_on_video()`가 원본을 그대로 반환하는지 확인
- [ ] 기존 뮤직비디오 생성 파이프라인 정상 동작 확인
- [ ] 서버 기동 확인

## 5. 체크리스트 요약

| 구분 | 항목 수 | 완료 |
|------|---------|------|
| 백엔드 (`mv_pipeline.py`: `_split_long_section()` 15초 초과 재분할) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py`: 신규 함수 `_burn_subtitles_on_video()`) | 1 | 0/1 |
| 백엔드 (`mv_pipeline.py`: Phase 3.5 자막 재적용 호출) | 1 | 0/1 |
| 백엔드 (`mv.py`: retry-sync 자막 재적용 호출) | 1 | 0/1 |
| 프론트엔드 | 0 | — |

---

## v30 — 멜론 기반 음원차트 알고리즘 구현 (2026-04-07)

### 요청 사항
멜론 차트 계산 방식(`melonChart.md`)을 기반으로 AIMU 플랫폼의 음원차트 시스템을 전면 재설계한다.

### 현재 상태
- 백엔드: `charts.py`에 단순 `play_count` 정렬만 존재
- 프론트엔드: `ChartPage.jsx`에 장르별 탭(TOP100, 발라드, 댄스...) 구조
- Redis: `chart:daily:YYYYMMDD` 등 Sorted Set 존재하나, 순 청취자 로직 없음
- 재생 기록: `stream_track()` 엔드포인트에서 presigned URL만 반환, 재생 기록 미저장

### 목표
1. **멜론식 차트 탭**: TOP100, HOT100, 일간, 주간, 월간
2. **순 청취자 기반 점수 계산**: 1인 1시간/1일 1회 카운트
3. **멜론식 점수 공식**: 스트리밍 100% (다운로드 기능 미구현이므로)
4. **TOP100**: 24시간 이용량 50% + 1시간 이용량 50% (심야 01~07시: 24시간 100%)
5. **HOT100**: 최근 1시간 이용량만 (발매 30일 이내 곡)
6. **일간/주간/월간**: 해당 기간 순 청취자 수 기준
7. **재생 기록 API**: 곡 재생 시 백엔드에 기록 → Redis에 순 청취자 집계

### 작업 분배

#### 백엔드 (backend-dev)
1. **재생 기록 API** (`POST /api/charts/record-play`)
   - 로그인 사용자 + track_id → Redis에 순 청취자 기록
   - `chart:hourly:{YYYYMMDDHH}:{track_id}` SET에 user_id 추가 (1시간 윈도우)
   - `chart:daily:{YYYYMMDD}:{track_id}` SET에 user_id 추가 (1일 윈도우)
   - `chart:weekly:{YYYY-W##}:{track_id}` SET에 user_id 추가
   - `chart:monthly:{YYYYMM}:{track_id}` SET에 user_id 추가

2. **차트 계산 API** (`GET /api/charts/{chart_type}`)
   - `top100`: 24h 순청취자 50% + 1h 순청취자 50% (심야 01~07시: 24h 100%)
   - `hot100`: 최근 1h 순청취자 (발매 30일 이내 곡만)
   - `daily`: 오늘 순 청취자 수 순위
   - `weekly`: 이번 주 순 청취자 수 순위
   - `monthly`: 이번 달 순 청취자 수 순위

3. **`charts.py` 전면 재작성**

#### 프론트엔드 (frontend-dev)
1. **ChartPage.jsx 전면 재작성**
   - 탭: TOP100 / HOT100 / 일간 / 주간 / 월간
   - 차트 기준 시간 표시
   - 1~100위 리스트 (순위 + 등락 + 곡명 + 아티스트 + 앨범)
2. **재생 기록 호출**: PlayerContext에서 곡 재생 시 `POST /api/charts/record-play` 호출
3. **API 클라이언트**: `api/index.js`에 새 차트 API 함수 추가

#### 테스트 항목
1. 곡 재생 시 `record-play` API 호출 확인
2. 같은 곡 반복 재생 시 1시간 내 1회만 카운트 확인
3. TOP100 탭에서 차트 데이터 로드 확인
4. HOT100 탭에서 발매 30일 이내 곡만 표시 확인
5. 일간/주간/월간 탭 전환 시 데이터 로드 확인
6. 차트 기준 시간 표시 확인
7. 심야(01~07시) TOP100에서 1시간 이용량 무시 확인

---

## v31 — 프론트엔드 API 호출 통일 (2026-04-07)

### 요청 사항
프론트엔드에서 백엔드로 접근하는 모든 통신을 `api/index.js` API 모듈을 경유하도록 통일한다.
직접 URL 구성(`window.location.hostname:9000`)과 `fetch()` 직접 호출을 모두 제거한다.

### 수정 대상 (총 19곳)

#### A. 직접 URL 구성 (11곳)
1. `api/index.js:234` - voiceConvertStreamUrl
2. `api/index.js:239` - voiceConvertDownloadUrl
3. `StudioTab2.jsx:916` - getStreamUrl 헬퍼
4. `UploadPage.jsx:222` - 커버 프리뷰 URL
5. `UploadPage.jsx:325` - 오디오 스트림 URL
6. `UploadPage.jsx:775-776` - JSX 내 인라인 오디오 src
7. `MyMusicPage.jsx:193` - 캐릭터시트 프리뷰 URL
8. `MyMusicPage.jsx:270` - 캐릭터시트 수정 프리뷰 URL
9. `MyMusicPage.jsx:1262` - 보이스페르소나 다운로드 URL

#### B. fetch() 직접 호출 (8곳)
1. `StudioTab2.jsx:67` - 변환 보컬 스트림
2. `StudioTab2.jsx:73` - MR 스트림
3. `MyMusicPage.jsx:261` - 캐릭터시트 프리뷰 fetch
4. `MyMusicPage.jsx:788` - 보컬수리 원본 스트림
5. `MyMusicPage.jsx:792` - 보컬수리 LALAL 스트림
6. `MyMusicPage.jsx:796` - 보컬수리 Demucs 스트림
7. `MyMusicPage.jsx:849` - 보컬수리 다운로드
8. `MyMusicPage.jsx:1265` - 보이스페르소나 다운로드

### 해결 방식
1. `api/index.js`에 누락된 API 함수 추가 (arraybuffer/blob responseType)
2. 각 컴포넌트에서 직접 URL/fetch 제거 → api 모듈 함수 호출로 교체
3. `<audio src={url}>` 등 HTML 요소에는 api/index.js의 URL 헬퍼 함수 사용
4. `api/index.js:4`의 baseURL 구성은 Axios 인스턴스 설정이므로 유지 (이것이 유일한 URL 구성 포인트)

### 작업 분배
- **프론트엔드**: 위 19곳 전부 수정
- **백엔드**: 변경 없음 (API 엔드포인트 이미 정상)
- **테스트**: 빌드 확인 + API 호출 패턴 검증

---

## v32 — 트랙 다운로드 기능 + 차트 다운로드 가중치 반영 (2026-04-07)

### 요청 사항
1. 트랙 다운로드 기능 구현 (MP3 파일 다운로드)
2. 멜론 방식으로 차트 점수에 다운로드 반영: 스트리밍 40% + 다운로드 60%
3. 다운로드 카운트 규칙: 1인당 최초 1회만 카운트 (재다운로드 미반영)
4. 모든 API 호출은 api/index.js 경유

### 작업 분배

#### 백엔드 (backend-dev)
1. **다운로드 API** (`POST /api/tracks/{track_id}/download`)
   - 인증 필수
   - MinIO에서 오디오 파일을 가져와 StreamingResponse로 반환
   - Redis에 다운로드 순이용자 기록 (1인 1회 중복 제거)
     - `chart:downloads:daily:{YYYYMMDD}:{track_id}` SET에 user_id
     - `chart:downloads:weekly:{YYYY-W##}:{track_id}` SET에 user_id
     - `chart:downloads:monthly:{YYYYMM}:{track_id}` SET에 user_id
   - 다운로드 트랙 인덱스도 기록
     - `chart:dl_tracks:daily:{YYYYMMDD}` SET에 track_id
     - etc.
   - MongoDB에 download_count 증가

2. **차트 계산 수정** (`charts.py`)
   - TOP100: `(스트리밍순청취자 × 40% + 다운로드순이용자 × 60%)` 기반으로 변경
     - 주간: 위 점수의 24h×50% + 1h×50%
     - 심야: 위 점수의 24h×100%
   - 일간/주간/월간: 스트리밍 40% + 다운로드 60%
   - HOT100: 스트리밍 40% + 다운로드 60% (1시간 기준)

#### 프론트엔드 (frontend-dev)
1. **다운로드 버튼** 추가: SongItem 컴포넌트에 다운로드 아이콘 추가
2. **api/index.js**: `downloadTrackFile(trackId)` 함수 추가
3. 다운로드 시 blob으로 받아서 브라우저 다운로드 트리거

#### 테스트 항목
1. 다운로드 버튼 클릭 시 파일 다운로드 동작 확인
2. 다운로드 시 Redis에 순이용자 기록 확인
3. 같은 트랙 재다운로드 시 Redis SET 크기 변화 없음 확인
4. 차트 점수에 다운로드 가중치(60%) 반영 확인
5. 빌드 정상 확인

---

## v33 — 차트 통계 컬럼 표시 (24h청취, 1h청취, 다운로드) (2026-04-07)

### 요청 사항
차트 리스트에 각 곡의 24시간 청취자 수, 1시간 청취자 수, 다운로드 수를 숫자 컬럼으로 표시한다.
테스트 시 차트 점수 계산 데이터를 눈으로 확인할 수 있도록.

### 작업 분배

#### 백엔드
- `_build_chart_response`에서 각 트랙에 통계 필드 추가:
  - `listeners_24h`: 24시간 순 청취자 수
  - `listeners_1h`: 1시간 순 청취자 수
  - `downloads`: 다운로드 순 이용자 수 (해당 차트 기간 기준)
- 차트 계산 함수에서 개별 카운트를 ranked 결과에 포함시켜 전달

#### 프론트엔드
- ChartPage.jsx: 헤더 + 아이템에 3개 숫자 컬럼 추가
- ChartPage.css: 새 컬럼 스타일 + 모바일 대응

---

## v34 — 차트 아티스트명 클릭 → 크리에이터 프로필 이동 (2026-04-08)

### 요청 사항
차트에서 아티스트명을 클릭하면 해당 크리에이터의 프로필 페이지로 이동하여 그 사람의 공개 트랙 목록을 볼 수 있게 한다.
- 본인 계정: 모든 탭 접근 가능 (기존 /my-music)
- 타인 계정: 공개 트랙만 볼 수 있음 (/artist/{id})

### 현재 상태
- `/artist/:id` 라우트 + ArtistDetailPage 이미 존재
- 백엔드 `GET /api/artists/{id}/tracks`에서 `is_public: True` 필터 적용됨
- 차트에서 아티스트명이 텍스트로만 표시 (클릭 불가)
- 차트 API 응답에 `uploader_id` 포함됨

### 작업 분배

#### 프론트엔드
1. ChartPage.jsx: 아티스트명을 클릭 가능한 Link로 변경
   - 본인이면 → `/my-music`으로 이동
   - 타인이면 → `/artist/{uploader_id}`로 이동
2. ChartPage.css: 아티스트명 링크 스타일 (호버 시 밑줄/색상)

#### 백엔드
- 변경 없음 (이미 구현됨)

#### 테스트
1. 차트에서 아티스트명 클릭 시 프로필 페이지 이동 확인
2. 프로필 페이지에서 해당 크리에이터의 트랙 목록 표시 확인
3. 빌드 정상 확인

---

## v35 — 차트 데이터 MongoDB 영구 저장 + 서버 시작 시 Redis 복구 (2026-04-08)

### 요청 사항
차트 데이터(재생/다운로드 기록)를 Redis에만 저장하면 서버 재시작 시 날아가는 문제 해결.
MongoDB에 영구 기록 저장 + 서버 시작 시 Redis 자동 복구.

### 작업 내용 (백엔드만)

#### 1. MongoDB 컬렉션 추가
- `play_logs`: {user_id, track_id, played_at(KST)}
- `download_logs`: {user_id, track_id, downloaded_at(KST)}
- 인덱스: {user_id: 1, track_id: 1, played_at: -1}

#### 2. record-play 수정 (charts.py)
- 기존: Redis에만 저장
- 변경: Redis + MongoDB play_logs에 동시 저장

#### 3. download 수정 (tracks.py)
- 기존: Redis에만 저장
- 변경: Redis + MongoDB download_logs에 동시 저장

#### 4. Redis 복구 함수 (신규: services/chart_recovery.py)
- MongoDB play_logs/download_logs에서 현재 시간 기준으로 읽어서 Redis SET 재구축
- 시간 윈도우: hourly(1시간), daily(오늘), weekly(이번주), monthly(이번달)

#### 5. 서버 시작 시 복구 호출 (main.py)
- lifespan에서 Redis 복구 함수 호출

### 프론트엔드: 변경 없음
### 테스트 항목
1. 재생 시 MongoDB play_logs에 기록 저장 확인
2. 다운로드 시 MongoDB download_logs에 기록 저장 확인
3. 서버 재시작 후 Redis에 데이터 복구 확인
4. 복구 후 차트 순위 정상 표시 확인

---

## v36 — 차트 탭별 컬럼 분기 (2026-04-08)

### 요청 사항
각 차트 탭에 해당 차트 계산에 사용되는 컬럼만 표시:
- TOP100: 24h 청취 / 1h 청취 / 다운로드 (3개)
- HOT100: 1h 청취 / 다운로드 (2개)
- 일간: 청취자 / 다운로드 (2개)
- 주간: 청취자 / 다운로드 (2개)
- 월간: 청취자 / 다운로드 (2개)

### 작업: 프론트엔드만
- ChartPage.jsx: 탭별 조건부 컬럼 렌더링
- ChartPage.css: 2컬럼 grid 추가 (일간/주간/월간용)
- 백엔드: 변경 없음

---

## v37 — Suno 상세 파라미터 ON/OFF 토글 UI + 백엔드 연동 (2026-04-08)

### 요청 사항
작업실2 커스텀 모드 3단계(음악 생성)에서 Suno API의 모든 상세 파라미터를 ON/OFF 토글로 제어 가능하게 구현.
각 파라미터마다 설명 + placeholder 예시 + 비활성 상태 관리.
하단에 비공식 API 미지원 기능(보이스클로닝, 커스텀모델, My Taste, MIDI) 잠금 표시.

### 새로 추가할 ON/OFF 파라미터 (Suno 전용)
1. 제외 스타일 (negativeTags) - 텍스트 입력
2. 스타일 강도 (styleWeight) - 0~1 숫자
3. 실험성 조절 (weirdnessConstraint) - 0~1 숫자
4. 오디오 영향도 (audioWeight) - 0~1 숫자
5. BPM - 숫자 입력 (현재 프론트에서 받지만 Suno에 미전송)
6. Key (조성) - 드롭다운 (현재 프론트에서 받지만 Suno에 미전송)
7. 페르소나 타입 (personaModel) - style_persona / voice_persona

### 작업 분배

#### 백엔드 (backend-dev)
1. generate.py GenerateRequest 모델에 필드 추가:
   - negative_tags, style_weight, weirdness, audio_weight, persona_model
2. generate.py에서 새 필드를 MongoDB에 저장 + suno_generator에 전달
3. suno_generator.py에서 새 파라미터를 Suno API body에 포함
4. BPM/Key를 style 텍스트에 append하여 전송

#### 프론트엔드 (frontend-dev)
1. StudioTab2.jsx 3단계에 ON/OFF 토글 파라미터 UI 추가 (Suno 선택 시만 표시)
2. 각 파라미터: 토글 + 설명 텍스트 + placeholder 예시 + input
3. OFF면 비활성(회색), ON이면 활성
4. handleGenerateMusic에서 ON인 파라미터만 request body에 포함
5. 하단에 잠금 기능 4개 표시 (보이스클로닝, 커스텀모델, My Taste, MIDI)

---

## v38 — Whisper 타임스탬프 1회 호출 후 재사용 (2026-04-08)

### 요청 사항
현재 Whisper를 Phase 1a, Phase 3, Phase 3.5, Phase 3.6, Phase 5에서 중복 호출하고 있어서 자막 타이밍이 일관되지 않음. Phase 1a에서 1번만 호출하고 저장한 뒤, 이후 단계에서는 저장된 타임스탬프를 재사용하도록 수정.

### 현재 문제
- Phase 1a: Whisper 호출 ① → whisper_segments를 job에 저장 ✅
- Phase 3.5 _burn_subtitles_on_synced_video: Whisper 호출 ② (불필요)
- Phase 3.6: Whisper 호출 ③ (불필요)
- Phase 5: Whisper 호출 ④ (불필요)

### 해결 방법
1. Phase 1a에서 뽑은 whisper_segments가 이미 job document에 저장돼있음
2. 각 씬의 section_start/section_end 범위에 해당하는 세그먼트를 필터링하여 사용
3. Phase 3.5, 3.6, 5에서 Whisper 호출 제거 → job에서 저장된 데이터 사용

### 작업: 백엔드만 (mv_pipeline.py)
- `_get_scene_timestamps(whisper_segments, section_start, section_end)` 헬퍼 함수 추가
  - 전체 whisper_segments에서 해당 씬 시간 범위의 세그먼트만 필터링
  - 시작 시간을 0 기준으로 조정 (씬 영상은 0초부터 시작하므로)
- `_burn_subtitles_on_synced_video`: Whisper 호출 → job의 whisper_segments에서 필터링
- Phase 3.6: Whisper 호출 → job의 whisper_segments에서 필터링
- Phase 5: Whisper 호출 → job의 whisper_segments에서 필터링

### 프론트엔드: 변경 없음

---

## v40 — 플레이어 전용 페이지 (/player) 구현 (2026-04-08)

### 요청 사항
곡 재생 시 플레이어 전용 페이지로 이동.
- 좌측: 커버 이미지 크게 + 곡명/아티스트
- 우측 2개 탭: 프롬프트 정보 / 플레이리스트(재생 큐)
- 하단: 기존 재생 컨트롤러 유지
- "+" 버튼 누르면 재생 큐(플레이리스트 탭)에 추가

### 작업 분배

#### 백엔드
- api/index.js에 `getTrackDetail(id)` 함수 추가 (GET /api/tracks/{id} 호출)
- 백엔드 GET /api/tracks/{track_id}는 이미 존재 (prompt, genre, mood, ai_model, lyrics 등 포함)

#### 프론트엔드
1. **PlayerPage.jsx + PlayerPage.css** 신규 생성
   - 좌측: 커버 이미지(대형) + 곡명 + 아티스트명
   - 우측: 2개 탭
     - 프롬프트 정보: GET /api/tracks/{id}에서 가져온 prompt, genre, mood, ai_model, lyrics, 커버 프롬프트
     - 플레이리스트: PlayerContext의 playlist 배열 표시 (현재 재생곡 하이라이트)
   - 하단: 기존 MusicPlayer 컴포넌트 그대로 사용

2. **App.jsx**: `/player` 라우트 추가

3. **SongItem.jsx / ChartPage.jsx**: "+" 버튼 → PlayerContext.addToPlaylist 호출로 변경
   - 재생 큐에 곡 추가 (기존 saved playlist 모달 대신)

4. **api/index.js**: `getTrackDetail(id)` 함수 추가

---

## v41 — 프롬프트 정보 탭에 generation 상세 파라미터 표시 (2026-04-08)

### 요청 사항
플레이어 페이지 프롬프트 정보 탭에 모든 음악 생성 파라미터를 표시.
tracks의 generation_id로 generations 컬렉션을 조회하여 세밀한 파라미터도 가져온다.
값이 없는 항목은 레이블은 보이되 값을 `-`로 표시.

### 작업: 프론트엔드만 (PlayerPage.jsx)
- track의 generation_id로 api.getGeneration() 추가 호출
- 모든 파라미터 레이블 항상 표시, 값 없으면 `-`
