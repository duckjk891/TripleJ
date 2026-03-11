import math
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database import get_db, dict_row, dict_rows

router = APIRouter(prefix="/api/albums")


class AlbumCreate(BaseModel):
    title: str
    artist_id: int
    genre: Optional[str] = None
    description: Optional[str] = None


@router.get("/")
def list_albums(page: int = 1, limit: int = 20, db=Depends(get_db)):
    offset = (page - 1) * limit

    rows = db.execute("""
        SELECT al.*, a.name as artist_name
        FROM albums al JOIN artists a ON al.artist_id = a.id
        ORDER BY al.release_date DESC LIMIT ? OFFSET ?
    """, (limit, offset)).fetchall()

    total = db.execute("SELECT COUNT(*) FROM albums").fetchone()[0]

    return {
        "albums": dict_rows(rows),
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.post("/", status_code=201)
def create_album(body: AlbumCreate, current_user=Depends(get_current_user), db=Depends(get_db)):
    if not body.title:
        return JSONResponse(status_code=400, content={"error": "앨범 제목은 필수입니다."})

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


@router.get("/latest")
def latest_albums(limit: int = 10, db=Depends(get_db)):
    rows = db.execute("""
        SELECT al.*, a.name as artist_name
        FROM albums al JOIN artists a ON al.artist_id = a.id
        ORDER BY al.release_date DESC LIMIT ?
    """, (limit,)).fetchall()
    return dict_rows(rows)


@router.get("/{album_id}")
def get_album(album_id: int, db=Depends(get_db)):
    row = db.execute("""
        SELECT al.*, a.name as artist_name, a.image as artist_image
        FROM albums al JOIN artists a ON al.artist_id = a.id
        WHERE al.id = ?
    """, (album_id,)).fetchone()

    if not row:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})

    songs = db.execute("""
        SELECT s.*, a.name as artist_name
        FROM songs s JOIN artists a ON s.artist_id = a.id
        WHERE s.album_id = ? ORDER BY s.id
    """, (album_id,)).fetchall()

    album = dict_row(row)
    album["songs"] = dict_rows(songs)
    return album
