import math
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..database import get_db, dict_row, dict_rows

router = APIRouter(prefix="/api/songs")


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
