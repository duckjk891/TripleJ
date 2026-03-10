from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Photo
from schemas import PhotoCreate, PhotoCreateByPath, PhotoResponse, PhotoUpdate

router = APIRouter(prefix="/api/photos", tags=["photos"])


# --- Legacy: query-param based (backward compat) ---
@router.post("", response_model=PhotoResponse)
def create_photo(photo: PhotoCreate, db: Session = Depends(get_db)):
    db_photo = Photo(**photo.model_dump())
    db.add(db_photo)
    db.commit()
    db.refresh(db_photo)
    return db_photo


@router.get("", response_model=List[PhotoResponse])
def get_photos(
    owner_id: Optional[int] = None,
    album_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Photo)
    if owner_id is not None:
        query = query.filter(Photo.owner_id == owner_id)
    if album_name is not None:
        query = query.filter(Photo.album_name == album_name)
    return query.order_by(Photo.created_at.desc()).all()


# --- New: path-param based (frontend pattern) ---
@router.get("/{user_id}", response_model=List[PhotoResponse])
def get_photos_by_user(user_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Photo)
        .filter(Photo.owner_id == user_id)
        .order_by(Photo.created_at.desc())
        .all()
    )


@router.post("/{user_id}", response_model=PhotoResponse)
def create_photo_by_user(
    user_id: int, photo: PhotoCreateByPath, db: Session = Depends(get_db)
):
    db_photo = Photo(owner_id=user_id, **photo.model_dump())
    db.add(db_photo)
    db.commit()
    db.refresh(db_photo)
    return db_photo


# --- Single-item operations (moved to /detail/ to avoid path conflict) ---
@router.get("/detail/{photo_id}", response_model=PhotoResponse)
def get_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo


@router.put("/detail/{photo_id}", response_model=PhotoResponse)
def update_photo(
    photo_id: int, update: PhotoUpdate, db: Session = Depends(get_db)
):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(photo, key, value)

    db.commit()
    db.refresh(photo)
    return photo


@router.delete("/detail/{photo_id}")
def delete_photo(photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(Photo).filter(Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    db.delete(photo)
    db.commit()
    return {"detail": "Photo deleted"}
