"""
Couple story routes — POST/GET /api/story
v2: 구조화된 CoupleStory 페이로드를 받아 Mongo 'stories' 컬렉션에 저장.
v8: @-멘션 refs 필드 추가, [StoryRoute] 로그 prefix 도입.
"""

import logging
from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings
from ..database.mongodb import get_mongo
from ..models.story import CoupleStory, MentionRef
from ..services.story_polisher import polish_story_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/story")


def _normalize_story_refs(story_dict):
    """기존(v7 이전) 도큐먼트가 *_refs 키 없이 저장돼 있을 수 있어
    GET 응답 시 일관되게 빈 배열을 채워 클라이언트가 무방어로 깨지지 않도록 한다."""
    if not isinstance(story_dict, dict):
        return story_dict
    out = dict(story_dict)
    out.setdefault("meeting_refs", [])
    out.setdefault("first_date_refs", [])
    out.setdefault("memories_refs", [])
    out.setdefault("proposal_refs", [])
    out.setdefault("wedding_prep_refs", [])
    out.setdefault("rituals_refs", [])
    return out


def _count_total_mentions(story_dict) -> int:
    if not isinstance(story_dict, dict):
        return 0
    meeting = len(story_dict.get("meeting_refs") or [])
    first_date = len(story_dict.get("first_date_refs") or [])
    proposal = len(story_dict.get("proposal_refs") or [])
    wedding_prep = len(story_dict.get("wedding_prep_refs") or [])
    rituals = len(story_dict.get("rituals_refs") or [])
    memories_refs = story_dict.get("memories_refs") or []
    memories_total = sum(len(rs or []) for rs in memories_refs)
    return meeting + first_date + proposal + wedding_prep + rituals + memories_total


@router.post("")
async def create_story(body: CoupleStory, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    story_data = body.model_dump()
    story_section = story_data.get("story") or {}
    total_mentions = _count_total_mentions(story_section)
    memories_count = len(story_section.get("memories") or [])
    user_id = current_user["id"]

    logger.info(
        "[StoryRoute] POST /story entry user_id=%s total_mentions=%d memories_count=%d",
        user_id,
        total_mentions,
        memories_count,
    )

    doc = {
        "user_id": user_id,
        **story_data,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = await mongo.stories.insert_one(doc)
    except Exception:
        logger.exception(
            "[StoryRoute] POST /story failed user_id=%s total_mentions=%d",
            user_id,
            total_mentions,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "스토리 저장 중 오류가 발생했습니다."},
        )

    story_id = str(result.inserted_id)
    logger.info(
        "[StoryRoute] POST /story ok user_id=%s story_id=%s total_mentions=%d",
        user_id,
        story_id,
        total_mentions,
    )
    return {"story_id": story_id}


@router.get("/{story_id}")
async def get_story(story_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info(
        "[StoryRoute] GET /story entry user_id=%s story_id=%s",
        user_id,
        story_id,
    )

    try:
        oid = ObjectId(story_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[StoryRoute] GET /story invalid_id user_id=%s story_id=%s",
            user_id,
            story_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 story_id 입니다.")

    doc = await mongo.stories.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[StoryRoute] GET /story not_found user_id=%s story_id=%s",
            user_id,
            story_id,
        )
        raise HTTPException(status_code=404, detail="스토리를 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[StoryRoute] GET /story forbidden user_id=%s story_id=%s owner_id=%s",
            user_id,
            story_id,
            doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    normalized_story = _normalize_story_refs(doc.get("story"))
    total_mentions = _count_total_mentions(normalized_story)
    logger.info(
        "[StoryRoute] GET /story ok user_id=%s story_id=%s total_mentions=%d",
        user_id,
        story_id,
        total_mentions,
    )

    return {
        "story_id": str(doc["_id"]),
        "user_id": doc.get("user_id"),
        "couple": doc.get("couple"),
        "story": normalized_story,
        "vow": doc.get("vow"),
        "wedding_context": doc.get("wedding_context"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
    }


class PolishRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    refs: list[MentionRef] = Field(default_factory=list, max_length=32)
    model: Literal["claude_4_7_opus", "gpt_latest"] = "claude_4_7_opus"
    label: str = ""


@router.post("/polish")
async def polish_story(body: PolishRequest, current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    text_len = len(body.text)
    ref_count = len(body.refs)
    logger.info(
        "[StoryRoute] /polish entry user_id=%s model=%s text_len=%d ref_count=%d label=%s",
        user_id, body.model, text_len, ref_count, (body.label or "")[:40],
    )

    # 모델별 키 존재 확인 → 503
    if body.model == "claude_4_7_opus" and not settings.anthropic_api_key:
        logger.warning("[StoryRoute] /polish anthropic key missing user_id=%s", user_id)
        raise HTTPException(status_code=503, detail="Anthropic API 키가 설정되지 않았습니다.")
    if body.model == "gpt_latest" and not settings.openai_api_key:
        logger.warning("[StoryRoute] /polish openai key missing user_id=%s", user_id)
        raise HTTPException(status_code=503, detail="OpenAI API 키가 설정되지 않았습니다.")

    try:
        result = await polish_story_text(
            text=body.text,
            refs=[r.model_dump() for r in body.refs],
            model_alias=body.model,
            label=body.label,
            user_id=user_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "[StoryRoute] /polish failed user_id=%s model=%s text_len=%d: %s: %s",
            user_id, body.model, text_len, type(e).__name__, str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="다듬기에 실패했습니다. 잠시 후 다시 시도해주세요.")

    logger.info(
        "[StoryRoute] /polish ok user_id=%s model=%s elapsed_ms=%d refs_preserved=%s polished_len=%d",
        user_id, body.model, result["elapsed_ms"], result["refs_preserved"], len(result["polished_text"]),
    )
    return result
