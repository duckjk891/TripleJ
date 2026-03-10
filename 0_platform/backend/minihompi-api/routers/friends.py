from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import Friend
from schemas import FriendCreate, FriendResponse

router = APIRouter(prefix="/api/friends", tags=["friends"])


@router.post("", response_model=FriendResponse)
def create_friend_request(friend: FriendCreate, db: Session = Depends(get_db)):
    existing = (
        db.query(Friend)
        .filter(
            or_(
                (Friend.user_id == friend.user_id)
                & (Friend.friend_id == friend.friend_id),
                (Friend.user_id == friend.friend_id)
                & (Friend.friend_id == friend.user_id),
            )
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Friend request already exists")

    db_friend = Friend(**friend.model_dump())
    db.add(db_friend)
    db.commit()
    db.refresh(db_friend)
    return db_friend


@router.get("", response_model=List[FriendResponse])
def get_friends(user_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Friend)
        .filter(
            or_(Friend.user_id == user_id, Friend.friend_id == user_id),
            Friend.status == "accepted",
        )
        .all()
    )


@router.get("/pending", response_model=List[FriendResponse])
def get_pending_requests(user_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Friend)
        .filter(Friend.friend_id == user_id, Friend.status == "pending")
        .all()
    )


@router.put("/{friend_id}/accept", response_model=FriendResponse)
def accept_friend_request(friend_id: int, db: Session = Depends(get_db)):
    friend = db.query(Friend).filter(Friend.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="Friend request not found")

    friend.status = "accepted"
    db.commit()
    db.refresh(friend)
    return friend


@router.delete("/{friend_id}")
def delete_friend(friend_id: int, db: Session = Depends(get_db)):
    friend = db.query(Friend).filter(Friend.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="Friend not found")

    db.delete(friend)
    db.commit()
    return {"detail": "Friend deleted"}
