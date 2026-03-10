from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from ..auth import get_current_user
from ..database import get_db, dict_row, dict_rows

router = APIRouter(prefix="/api/playlists")


class PlaylistCreate(BaseModel):
    title: str
    description: Optional[str] = None
    is_public: bool = True


class PlaylistUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None


class AddSong(BaseModel):
    song_id: int


@router.get("/")
def list_playlists(current_user=Depends(get_current_user), db=Depends(get_db)):
    rows = db.execute("""
        SELECT p.*, (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = p.id) as song_count
        FROM playlists p WHERE p.user_id = ? ORDER BY p.created_at DESC
    """, (current_user["id"],)).fetchall()
    return dict_rows(rows)


@router.post("/", status_code=201)
def create_playlist(body: PlaylistCreate, current_user=Depends(get_current_user), db=Depends(get_db)):
    if not body.title:
        return JSONResponse(status_code=400, content={"error": "플레이리스트 제목은 필수입니다."})

    cur = db.execute(
        "INSERT INTO playlists (user_id, title, description, is_public) VALUES (?, ?, ?, ?)",
        (current_user["id"], body.title, body.description, 1 if body.is_public else 0),
    )
    db.commit()
    row = db.execute("SELECT * FROM playlists WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict_row(row)


@router.get("/{playlist_id}")
def get_playlist(playlist_id: int, current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    playlist = dict_row(row)
    if not playlist["is_public"] and playlist["user_id"] != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "비공개 플레이리스트입니다."})

    songs = db.execute("""
        SELECT ps.order_num, s.*, a.name as artist_name, al.title as album_title, al.cover_image
        FROM playlist_songs ps
        JOIN songs s ON ps.song_id = s.id
        JOIN artists a ON s.artist_id = a.id
        LEFT JOIN albums al ON s.album_id = al.id
        WHERE ps.playlist_id = ? ORDER BY ps.order_num
    """, (playlist_id,)).fetchall()

    playlist["songs"] = dict_rows(songs)
    return playlist


@router.put("/{playlist_id}")
def update_playlist(playlist_id: int, body: PlaylistUpdate, current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, current_user["id"])).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    playlist = dict_row(row)
    title = body.title if body.title is not None else playlist["title"]
    desc = body.description if body.description is not None else playlist["description"]
    is_public = (1 if body.is_public else 0) if body.is_public is not None else playlist["is_public"]

    db.execute("UPDATE playlists SET title = ?, description = ?, is_public = ? WHERE id = ?", (title, desc, is_public, playlist_id))
    db.commit()
    updated = db.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    return dict_row(updated)


@router.delete("/{playlist_id}")
def delete_playlist(playlist_id: int, current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, current_user["id"])).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    db.commit()
    return {"message": "플레이리스트가 삭제되었습니다."}


@router.post("/{playlist_id}/songs", status_code=201)
def add_song(playlist_id: int, body: AddSong, current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, current_user["id"])).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    if not db.execute("SELECT id FROM songs WHERE id = ?", (body.song_id,)).fetchone():
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    if db.execute("SELECT id FROM playlist_songs WHERE playlist_id = ? AND song_id = ?", (playlist_id, body.song_id)).fetchone():
        return JSONResponse(status_code=409, content={"error": "이미 추가된 곡입니다."})

    max_order = db.execute("SELECT MAX(order_num) FROM playlist_songs WHERE playlist_id = ?", (playlist_id,)).fetchone()[0]
    order_num = (max_order or 0) + 1

    db.execute("INSERT INTO playlist_songs (playlist_id, song_id, order_num) VALUES (?, ?, ?)", (playlist_id, body.song_id, order_num))
    db.commit()
    return {"message": "곡이 추가되었습니다."}


@router.delete("/{playlist_id}/songs/{song_id}")
def remove_song(playlist_id: int, song_id: int, current_user=Depends(get_current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, current_user["id"])).fetchone()
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    cur = db.execute("DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?", (playlist_id, song_id))
    db.commit()

    if cur.rowcount == 0:
        return JSONResponse(status_code=404, content={"error": "플레이리스트에 해당 곡이 없습니다."})
    return {"message": "곡이 제거되었습니다."}
