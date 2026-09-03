"""v229 (B-2) — 가사 자산화: 계정 귀속 가사 보관함 CRUD.

기존에는 작사 결과가 곡 생성 요청의 lyrics 문자열로 일회성 소비되고
(FE 보관함은 로컬 AsyncStorage 전용), 서버에 계정 자산으로 남지 않았다.
`lyrics_assets` Mongo 컬렉션에 가사를 저장해 재설치·타기기에서도 재사용한다.

Collection: lyrics_assets
  {lyrics_id(hex), user_id, title, content, genre?, mood?,
   source('ai'|'manual'), created_at, updated_at}
"""

import logging
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lyrics", tags=["Lyrics Assets"])

TITLE_MAX = 120
CONTENT_MAX = 20000
LIST_LIMIT = 200


class LyricsAssetIn(BaseModel):
    title: str
    content: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    source: Optional[str] = "ai"  # 'ai' | 'manual'


class LyricsAssetPatch(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    genre: Optional[str] = None
    mood: Optional[str] = None


def _serialize(doc: dict) -> dict:
    return {
        "lyrics_id": doc.get("lyrics_id"),
        "title": doc.get("title") or "",
        "content": doc.get("content") or "",
        "genre": doc.get("genre"),
        "mood": doc.get("mood"),
        "source": doc.get("source") or "ai",
        "created_at": str(doc.get("created_at") or ""),
        "updated_at": str(doc.get("updated_at") or ""),
    }


async def save_lyrics_asset(
    user_id: str, title: str, content: str,
    genre: str = None, mood: str = None, source: str = "ai",
) -> Optional[str]:
    """공용 저장 헬퍼 — generate.py의 save 옵션도 이 함수를 사용. 실패 시 None."""
    title = (title or "").strip()[:TITLE_MAX]
    content = (content or "").strip()
    if not content:
        return None
    try:
        mongo = get_mongo()
        lyrics_id = uuid_lib.uuid4().hex
        now = datetime.now(timezone.utc)
        await mongo.lyrics_assets.insert_one({
            "lyrics_id": lyrics_id,
            "user_id": user_id,
            "title": title or "무제",
            "content": content[:CONTENT_MAX],
            "genre": (genre or "").strip() or None,
            "mood": (mood or "").strip() or None,
            "source": source if source in ("ai", "manual") else "ai",
            "created_at": now,
            "updated_at": now,
        })
        logger.info(
            "[lyrics-asset] saved user=%s lyrics_id=%s title_len=%d content_len=%d",
            user_id[:8], lyrics_id, len(title), len(content),
        )
        return lyrics_id
    except Exception as e:  # noqa: BLE001 — 저장 실패가 작사 응답을 깨면 안 됨
        logger.error("[lyrics-asset] save failed user=%s: %s", user_id[:8], str(e)[:200])
        return None


@router.post("", status_code=201)
@router.post("/", status_code=201, include_in_schema=False)
async def create_lyrics_asset(body: LyricsAssetIn, current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    if not (body.content or "").strip():
        return JSONResponse(status_code=400, content={"error": "가사 내용이 비어 있습니다."})
    lyrics_id = await save_lyrics_asset(
        user_id, body.title, body.content, body.genre, body.mood, body.source or "ai",
    )
    if not lyrics_id:
        return JSONResponse(status_code=500, content={"error": "가사 저장에 실패했습니다."})
    return {"lyrics_id": lyrics_id}


@router.get("")
@router.get("/", include_in_schema=False)
async def list_lyrics_assets(current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    mongo = get_mongo()
    docs = (
        await mongo.lyrics_assets.find({"user_id": user_id})
        .sort("created_at", -1)
        .to_list(length=LIST_LIMIT)
    )
    logger.info("[lyrics-asset] list user=%s count=%d", user_id[:8], len(docs))
    return {"items": [_serialize(d) for d in docs]}


@router.get("/{lyrics_id}")
async def get_lyrics_asset(lyrics_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    doc = await mongo.lyrics_assets.find_one(
        {"lyrics_id": lyrics_id, "user_id": current_user["id"]}
    )
    if not doc:
        return JSONResponse(status_code=404, content={"error": "가사를 찾을 수 없습니다."})
    return _serialize(doc)


@router.patch("/{lyrics_id}")
async def patch_lyrics_asset(
    lyrics_id: str, body: LyricsAssetPatch, current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip()[:TITLE_MAX] or "무제"
    if body.content is not None:
        if not body.content.strip():
            return JSONResponse(status_code=400, content={"error": "가사 내용이 비어 있습니다."})
        updates["content"] = body.content.strip()[:CONTENT_MAX]
    if body.genre is not None:
        updates["genre"] = body.genre.strip() or None
    if body.mood is not None:
        updates["mood"] = body.mood.strip() or None
    if not updates:
        return JSONResponse(status_code=400, content={"error": "수정할 내용이 없습니다."})
    updates["updated_at"] = datetime.now(timezone.utc)
    mongo = get_mongo()
    res = await mongo.lyrics_assets.update_one(
        {"lyrics_id": lyrics_id, "user_id": user_id}, {"$set": updates}
    )
    if res.matched_count == 0:
        return JSONResponse(status_code=404, content={"error": "가사를 찾을 수 없습니다."})
    logger.info("[lyrics-asset] patch user=%s lyrics_id=%s fields=%s", user_id[:8], lyrics_id, list(updates.keys()))
    return {"ok": True}


@router.delete("/{lyrics_id}")
async def delete_lyrics_asset(lyrics_id: str, current_user=Depends(get_current_user)):
    user_id = current_user["id"]
    mongo = get_mongo()
    res = await mongo.lyrics_assets.delete_one(
        {"lyrics_id": lyrics_id, "user_id": user_id}
    )
    if res.deleted_count == 0:
        return JSONResponse(status_code=404, content={"error": "가사를 찾을 수 없습니다."})
    logger.info("[lyrics-asset] delete user=%s lyrics_id=%s", user_id[:8], lyrics_id)
    return {"ok": True}
