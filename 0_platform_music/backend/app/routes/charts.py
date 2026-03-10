from fastapi import APIRouter, Depends

from ..database import get_db, dict_rows

router = APIRouter(prefix="/api/charts")


@router.get("/top100")
def top100(db=Depends(get_db)):
    rows = db.execute("""
        SELECT c.rank, c.chart_date, c.chart_type,
               s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM charts c
        JOIN songs s ON c.song_id = s.id
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE c.chart_type = 'daily'
        ORDER BY c.rank ASC LIMIT 100
    """).fetchall()
    return dict_rows(rows)


@router.get("/genre/{genre}")
def genre_chart(genre: str, limit: int = 50, db=Depends(get_db)):
    rows = db.execute("""
        SELECT s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM songs s
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE s.genre = ? ORDER BY s.play_count DESC LIMIT ?
    """, (genre, limit)).fetchall()
    return dict_rows(rows)
