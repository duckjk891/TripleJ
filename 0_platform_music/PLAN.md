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

## 4. 프론트엔드 에이전트 (frontend-dev) 임무

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
