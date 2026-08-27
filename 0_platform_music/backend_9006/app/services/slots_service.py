"""v212 — 아티스트 슬롯 서비스 (Mongo `user_slots` 컬렉션, PLAN D2).

max_slots = BASE_SLOTS(1) + extra_slots(구매 누적) — 파생값은 저장하지 않는다
($inc 업서트 시 기본값 시드 충돌 원천 회피, 기본 1 변경도 코드 1줄).

used = characters 문서 수 — legacy 무character_id 문서는 real/virtual 시트
보유 수로 환산 (마이그레이션 전 계정 공존기 대응).
"""

import logging
from datetime import datetime
from typing import Optional, Tuple

from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

BASE_SLOTS = 1


async def count_used_slots(user_id: str, db=None) -> int:
    """사용 중 슬롯 수 = cid 보유 doc 수 + legacy doc 의 시트 보유 수 환산."""
    mongo = db if db is not None else get_mongo()
    used = 0
    async for doc in mongo.characters.find(
        {"user_id": user_id},
        {"character_id": 1, "sheet_object_name": 1, "virtual_sheet_object_name": 1},
    ):
        if doc.get("character_id"):
            used += 1
        else:
            # legacy 단일 문서 — real/virtual 슬롯 각각 1로 환산
            if doc.get("sheet_object_name"):
                used += 1
            if doc.get("virtual_sheet_object_name"):
                used += 1
    return used


async def get_max_slots(user_id: str, db=None) -> int:
    mongo = db if db is not None else get_mongo()
    slot_doc = await mongo.user_slots.find_one({"user_id": user_id}, {"extra_slots": 1})
    extra = int((slot_doc or {}).get("extra_slots") or 0)
    return BASE_SLOTS + extra


async def get_slots(user_id: str, db=None) -> Tuple[int, int]:
    """Returns (used, max)."""
    used = await count_used_slots(user_id, db=db)
    mx = await get_max_slots(user_id, db=db)
    return used, mx


async def check_slot_available(user_id: str, db=None):
    """v212 — 슬롯 여유 검사 **단일 관문** (generate 4종 미지정 신규 · save ②형 공용).

    used >= max → 409 JSONResponse(slot_limit_exceeded, 동일 shape) 반환, 여유면 None.
    테스트 등가 검증 전제 — 409 shape 는 반드시 이 함수에서만 만든다.
    """
    from fastapi.responses import JSONResponse

    used, mx = await get_slots(user_id, db=db)
    if used >= mx:
        logger.info("[ArtistV212] slot limit user=%s used=%d max=%d -> 409", user_id[:8], used, mx)
        return JSONResponse(
            status_code=409,
            content={
                "error": "slot_limit_exceeded",
                "used": used,
                "max": mx,
                "message": "아티스트 슬롯이 가득 찼습니다. ⭐15로 슬롯을 추가하세요.",
            },
        )
    return None


async def grant_extra_slot(user_id: str, db=None) -> int:
    """extra_slots +1 원자 업서트. 성공 시 신규 max_slots 반환. 실패 시 raise
    (호출측 points.py 가 refund 처리 — ⭐만 나가는 기존 버그의 역방향 방지)."""
    mongo = db if db is not None else get_mongo()
    result = await mongo.user_slots.find_one_and_update(
        {"user_id": user_id},
        {
            "$inc": {"extra_slots": 1},
            "$set": {"updated_at": datetime.utcnow()},
        },
        upsert=True,
        return_document=True,
    )
    new_max = BASE_SLOTS + int((result or {}).get("extra_slots") or 1)
    logger.info("[SlotGrant] user=%s new_max=%d", user_id[:8], new_max)
    return new_max
