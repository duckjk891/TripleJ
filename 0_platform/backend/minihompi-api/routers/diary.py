from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Diary
from schemas import DiaryCreate, DiaryCreateByPath, DiaryResponse, DiaryUpdate

router = APIRouter(prefix="/api/diary", tags=["diary"])


# --- Legacy: query-param based (backward compat) ---
@router.post("", response_model=DiaryResponse)
def create_diary(diary: DiaryCreate, db: Session = Depends(get_db)):
    db_diary = Diary(**diary.model_dump())
    db.add(db_diary)
    db.commit()
    db.refresh(db_diary)
    return db_diary


@router.get("", response_model=List[DiaryResponse])
def get_diaries(author_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Diary)
    if author_id is not None:
        query = query.filter(Diary.author_id == author_id)
    return query.order_by(Diary.created_at.desc()).all()


# --- New: path-param based (frontend pattern) ---
@router.get("/{user_id}", response_model=List[DiaryResponse])
def get_diaries_by_user(user_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Diary)
        .filter(Diary.author_id == user_id)
        .order_by(Diary.created_at.desc())
        .all()
    )


@router.post("/{user_id}", response_model=DiaryResponse)
def create_diary_by_user(
    user_id: int, diary: DiaryCreateByPath, db: Session = Depends(get_db)
):
    db_diary = Diary(author_id=user_id, **diary.model_dump())
    db.add(db_diary)
    db.commit()
    db.refresh(db_diary)
    return db_diary


# --- Single-item operations (moved to /detail/ to avoid path conflict) ---
@router.get("/detail/{diary_id}", response_model=DiaryResponse)
def get_diary(diary_id: int, db: Session = Depends(get_db)):
    diary = db.query(Diary).filter(Diary.id == diary_id).first()
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")
    return diary


@router.put("/detail/{diary_id}", response_model=DiaryResponse)
def update_diary(
    diary_id: int, update: DiaryUpdate, db: Session = Depends(get_db)
):
    diary = db.query(Diary).filter(Diary.id == diary_id).first()
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(diary, key, value)

    db.commit()
    db.refresh(diary)
    return diary


@router.delete("/detail/{diary_id}")
def delete_diary(diary_id: int, db: Session = Depends(get_db)):
    diary = db.query(Diary).filter(Diary.id == diary_id).first()
    if not diary:
        raise HTTPException(status_code=404, detail="Diary not found")

    db.delete(diary)
    db.commit()
    return {"detail": "Diary deleted"}
