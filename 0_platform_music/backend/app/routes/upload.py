import os
import uuid
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/upload")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/image", status_code=201)
def upload_image(
    file: UploadFile = File(...),
    type: str = Form(...),
    id: int = Form(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    if type not in ("album", "artist"):
        return JSONResponse(status_code=400, content={"error": "type은 'album' 또는 'artist'여야 합니다."})

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(status_code=400, content={"error": f"허용되지 않는 이미지 형식입니다. ({', '.join(ALLOWED_IMAGE_EXT)})"})

    contents = file.file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."})

    if type == "album":
        if not db.execute("SELECT id FROM albums WHERE id = ?", (id,)).fetchone():
            return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    else:
        if not db.execute("SELECT id FROM artists WHERE id = ?", (id,)).fetchone():
            return JSONResponse(status_code=404, content={"error": "아티스트를 찾을 수 없습니다."})

    filename = f"{uuid.uuid4().hex}{ext}"
    subdir = f"{type}s"
    filepath = os.path.join(UPLOAD_DIR, "images", subdir, filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    file_url = f"/api/files/images/{subdir}/{filename}"

    if type == "album":
        db.execute("UPDATE albums SET cover_image = ? WHERE id = ?", (file_url, id))
    else:
        db.execute("UPDATE artists SET image = ? WHERE id = ?", (file_url, id))
    db.commit()

    return {"file_url": file_url}
