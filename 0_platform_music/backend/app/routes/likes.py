import math
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database import get_db, dict_rows

router = APIRouter(prefix="/api/likes")


@router.get("/")
def list_likes(page: int = 1, limit: int = 20, current_user=Depends(get_current_user), db=Depends(get_db)):
    offset = (page - 1) * limit

    rows = db.execute("""
        SELECT l.created_at as liked_at, s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM likes l
        JOIN songs s ON l.song_id = s.id
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT ? OFFSET ?
    """, (current_user["id"], limit, offset)).fetchall()

    total = db.execute("SELECT COUNT(*) FROM likes WHERE user_id = ?", (current_user["id"],)).fetchone()[0]

    return {
        "likes": dict_rows(rows),
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit) if limit else 0},
    }


@router.post("/{song_id}", status_code=201)
def like_song(song_id: int, current_user=Depends(get_current_user), db=Depends(get_db)):
    if not db.execute("SELECT id FROM songs WHERE id = ?", (song_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    if db.execute("SELECT id FROM likes WHERE user_id = ? AND song_id = ?", (current_user["id"], song_id)).fetchone():
        return JSONResponse(status_code=409, content={"error": "이미 좋아요한 곡입니다."})

    db.execute("INSERT INTO likes (user_id, song_id) VALUES (?, ?)", (current_user["id"], song_id))
    db.execute("UPDATE songs SET like_count = like_count + 1 WHERE id = ?", (song_id,))
    db.commit()
    return {"message": "좋아요가 추가되었습니다."}


@router.delete("/{song_id}")
def unlike_song(song_id: int, current_user=Depends(get_current_user), db=Depends(get_db)):
    cur = db.execute("DELETE FROM likes WHERE user_id = ? AND song_id = ?", (current_user["id"], song_id))
    if cur.rowcount == 0:
        return JSONResponse(status_code=404, content={"error": "좋아요하지 않은 곡입니다."})

    db.execute("UPDATE songs SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?", (song_id,))
    db.commit()
    return {"message": "좋아요가 취소되었습니다."}
