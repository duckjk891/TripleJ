from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import GuestBook, MiniHompi, User
from schemas import (
    GuestBookCreate,
    GuestBookCreateByNickname,
    GuestBookResponse,
    GuestBookUpdate,
)

router = APIRouter(prefix="/api/guestbook", tags=["guestbook"])


def _get_minihompi_by_user_id(user_id: int, db: Session) -> MiniHompi:
    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user_id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")
    return hompi


@router.post("/{user_id}", response_model=GuestBookResponse)
def create_guestbook_entry(
    user_id: int,
    entry: GuestBookCreateByNickname,
    db: Session = Depends(get_db),
):
    hompi = _get_minihompi_by_user_id(user_id, db)

    author = db.query(User).filter(User.nickname == entry.nickname).first()
    if not author:
        raise HTTPException(status_code=404, detail="Author not found by nickname")

    db_entry = GuestBook(
        minihompi_id=hompi.id,
        author_id=author.id,
        content=entry.content,
        is_secret=entry.is_secret,
    )
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry


@router.get("/{user_id}", response_model=List[GuestBookResponse])
def get_guestbook_entries(user_id: int, db: Session = Depends(get_db)):
    hompi = _get_minihompi_by_user_id(user_id, db)
    return (
        db.query(GuestBook)
        .filter(GuestBook.minihompi_id == hompi.id)
        .order_by(GuestBook.created_at.desc())
        .all()
    )


@router.put("/{user_id}/{entry_id}", response_model=GuestBookResponse)
def update_guestbook_entry(
    user_id: int,
    entry_id: int,
    update: GuestBookUpdate,
    db: Session = Depends(get_db),
):
    hompi = _get_minihompi_by_user_id(user_id, db)
    entry = (
        db.query(GuestBook)
        .filter(GuestBook.id == entry_id, GuestBook.minihompi_id == hompi.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="GuestBook entry not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(entry, key, value)

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{user_id}/{entry_id}")
def delete_guestbook_entry(
    user_id: int, entry_id: int, db: Session = Depends(get_db)
):
    hompi = _get_minihompi_by_user_id(user_id, db)
    entry = (
        db.query(GuestBook)
        .filter(GuestBook.id == entry_id, GuestBook.minihompi_id == hompi.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="GuestBook entry not found")

    db.delete(entry)
    db.commit()
    return {"detail": "GuestBook entry deleted"}
