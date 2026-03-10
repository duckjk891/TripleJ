from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import MiniHompi, User
from schemas import HompiWithUserResponse, MiniHompiResponse, MiniHompiUpdate

router = APIRouter(prefix="/api/minihompi", tags=["minihompi"])


@router.get("/u/{username}", response_model=HompiWithUserResponse)
def get_minihompi_by_username(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user.id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")

    return HompiWithUserResponse(
        id=hompi.id,
        owner_id=hompi.owner_id,
        title=hompi.title,
        bgm_url=hompi.bgm_url,
        skin=hompi.skin,
        today_count=hompi.today_count,
        total_count=hompi.total_count,
        username=user.username,
        nickname=user.nickname,
        profile_image=user.profile_image,
        bio=user.bio,
    )


@router.post("/u/{username}/visit")
def visit_minihompi_by_username(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user.id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")

    hompi.today_count += 1
    hompi.total_count += 1
    db.commit()
    db.refresh(hompi)
    return {"today_count": hompi.today_count, "total_count": hompi.total_count}


@router.get("/{user_id}", response_model=MiniHompiResponse)
def get_minihompi(user_id: int, db: Session = Depends(get_db)):
    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user_id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")
    return hompi


@router.post("/{user_id}/visit")
def visit_minihompi(user_id: int, db: Session = Depends(get_db)):
    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user_id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")

    hompi.today_count += 1
    hompi.total_count += 1
    db.commit()
    db.refresh(hompi)
    return {"today_count": hompi.today_count, "total_count": hompi.total_count}


@router.put("/{user_id}", response_model=MiniHompiResponse)
def update_minihompi(
    user_id: int, update: MiniHompiUpdate, db: Session = Depends(get_db)
):
    hompi = db.query(MiniHompi).filter(MiniHompi.owner_id == user_id).first()
    if not hompi:
        raise HTTPException(status_code=404, detail="MiniHompi not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(hompi, key, value)

    db.commit()
    db.refresh(hompi)
    return hompi
