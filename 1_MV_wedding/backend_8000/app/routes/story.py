"""
Couple story routes — POST/GET /api/story
v2: 구조화된 CoupleStory 페이로드를 받아 Mongo 'stories' 컬렉션에 저장.
"""

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..database.mongodb import get_mongo
from ..models.story import CoupleStory

router = APIRouter(prefix="/api/story")


@router.post("")
async def create_story(body: CoupleStory, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    story_data = body.model_dump()
    doc = {
        "user_id": current_user["id"],
        **story_data,
        "created_at": datetime.now(timezone.utc),
    }
    result = await mongo.stories.insert_one(doc)
    return {"story_id": str(result.inserted_id)}


@router.get("/{story_id}")
async def get_story(story_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    try:
        oid = ObjectId(story_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 story_id 입니다.")

    doc = await mongo.stories.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다.")
    if doc.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return {
        "story_id": str(doc["_id"]),
        "user_id": doc.get("user_id"),
        "couple": doc.get("couple"),
        "story": doc.get("story"),
        "vow": doc.get("vow"),
        "wedding_context": doc.get("wedding_context"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
    }
