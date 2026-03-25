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
SUNO_API_KEY=b0c13153451cf641dc692a107a816c77
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
