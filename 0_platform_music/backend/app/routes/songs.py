import math
import mimetypes
import os
import uuid
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from ..auth import get_current_user
from ..database import get_db, dict_row, dict_rows

router = APIRouter(prefix="/api/songs")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".ogg", ".flac", ".m4a"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB


@router.get("/")
def list_songs(page: int = 1, limit: int = 20, genre: str = None, db=Depends(get_db)):
    offset = (page - 1) * limit

    base = """
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
    """
    where = ""
    params = []
    if genre:
        where = " WHERE s.genre = ?"
        params.append(genre)

    total = db.execute(f"SELECT COUNT(*) as total {base}{where}", params).fetchone()[0]
    rows = db.execute(
        f"SELECT s.*, a.name as artist_name, al.title as album_title, al.cover_image {base}{where} ORDER BY s.play_count DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()

    return {
        "songs": dict_rows(rows),
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.get("/search")
def search_songs(q: str = Query(None), page: int = 1, limit: int = 20, db=Depends(get_db)):
    if not q:
        return JSONResponse(status_code=400, content={"error": "검색어를 입력해주세요."})

    offset = (page - 1) * limit
    keyword = f"%{q}%"

    rows = db.execute("""
        SELECT s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.title LIKE ? OR a.name LIKE ?
        ORDER BY s.play_count DESC LIMIT ? OFFSET ?
    """, (keyword, keyword, limit, offset)).fetchall()

    total = db.execute("""
        SELECT COUNT(*) FROM songs s
        JOIN artists a ON s.artist_id = a.id
        WHERE s.title LIKE ? OR a.name LIKE ?
    """, (keyword, keyword)).fetchone()[0]

    return {
        "songs": dict_rows(rows),
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.get("/{song_id}")
def get_song(song_id: int, db=Depends(get_db)):
    row = db.execute("""
        SELECT s.*, a.name as artist_name, a.image as artist_image,
               al.title as album_title, al.cover_image
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.id = ?
    """, (song_id,)).fetchone()

    if not row:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    db.execute("UPDATE songs SET play_count = play_count + 1 WHERE id = ?", (song_id,))
    db.commit()
    return dict_row(row)


@router.post("/upload", status_code=201)
def upload_song(
    file: UploadFile = File(...),
    title: str = Form(...),
    artist_id: int = Form(...),
    album_id: int = Form(None),
    genre: str = Form(None),
    lyrics: str = Form(None),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(status_code=400, content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"})

    contents = file.file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB 이하여야 합니다."})

    if not db.execute("SELECT id FROM artists WHERE id = ?", (artist_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    if album_id and not db.execute("SELECT id FROM albums WHERE id = ?", (album_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, "music", filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    duration = 0
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(filepath)
        if audio and audio.info:
            duration = int(audio.info.length)
    except Exception:
        pass

    file_path_url = f"/api/files/music/{filename}"
    cur = db.execute(
        "INSERT INTO songs (title, album_id, artist_id, duration, file_path, lyrics, play_count, like_count, genre) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)",
        (title, album_id, artist_id, duration, file_path_url, lyrics, genre),
    )
    db.commit()

    row = db.execute("""
        SELECT s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.id = ?
    """, (cur.lastrowid,)).fetchone()
    return dict_row(row)


@router.get("/stream/{song_id}")
def stream_song(song_id: int, db=Depends(get_db)):
    row = db.execute("SELECT file_path FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    file_path = row["file_path"]
    if not file_path or not file_path.startswith("/api/files/music/"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    filename = file_path.replace("/api/files/music/", "")
    actual_path = os.path.join(UPLOAD_DIR, "music", filename)

    if not os.path.isfile(actual_path):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    media_type = mimetypes.guess_type(actual_path)[0] or "audio/mpeg"
    return FileResponse(actual_path, media_type=media_type)
