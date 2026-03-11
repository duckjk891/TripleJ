import math
from typing import Optional
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database import get_db, dict_row, dict_rows

router = APIRouter(prefix="/api/artists")


class ArtistCreate(BaseModel):
    name: str
    genre: Optional[str] = None
    description: Optional[str] = None


@router.get("/")
def list_artists(page: int = 1, limit: int = 20, db=Depends(get_db)):
    offset = (page - 1) * limit

    rows = db.execute("""
        SELECT a.*,
            (SELECT COUNT(*) FROM albums WHERE artist_id = a.id) as album_count,
            (SELECT COUNT(*) FROM songs WHERE artist_id = a.id) as song_count
        FROM artists a ORDER BY a.name LIMIT ? OFFSET ?
    """, (limit, offset)).fetchall()

    total = db.execute("SELECT COUNT(*) FROM artists").fetchone()[0]

    return {
        "artists": dict_rows(rows),
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.post("/", status_code=201)
def create_artist(body: ArtistCreate, current_user=Depends(get_current_user), db=Depends(get_db)):
    if not body.name:
        return JSONResponse(status_code=400, content={"error": "아티스트 이름은 필수입니다."})

    cur = db.execute(
        "INSERT INTO artists (name, genre, description) VALUES (?, ?, ?)",
        (body.name, body.genre, body.description),
    )
    db.commit()
    row = db.execute("SELECT * FROM artists WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict_row(row)


@router.get("/{artist_id}")
def get_artist(artist_id: int, db=Depends(get_db)):
    row = db.execute("""
        SELECT a.*,
            (SELECT COUNT(*) FROM albums WHERE artist_id = a.id) as album_count,
            (SELECT COUNT(*) FROM songs WHERE artist_id = a.id) as song_count
        FROM artists a WHERE a.id = ?
    """, (artist_id,)).fetchone()

    if not row:
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})
    return dict_row(row)


@router.get("/{artist_id}/albums")
def get_artist_albums(artist_id: int, db=Depends(get_db)):
    if not db.execute("SELECT id FROM artists WHERE id = ?", (artist_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    rows = db.execute("""
        SELECT al.*, a.name as artist_name
        FROM albums al JOIN artists a ON al.artist_id = a.id
        WHERE al.artist_id = ? ORDER BY al.release_date DESC
    """, (artist_id,)).fetchall()
    return dict_rows(rows)


@router.get("/{artist_id}/songs")
def get_artist_songs(artist_id: int, limit: int = 10, db=Depends(get_db)):
    if not db.execute("SELECT id FROM artists WHERE id = ?", (artist_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    rows = db.execute("""
        SELECT s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.artist_id = ? ORDER BY s.play_count DESC LIMIT ?
    """, (artist_id, limit)).fetchall()
    return dict_rows(rows)
