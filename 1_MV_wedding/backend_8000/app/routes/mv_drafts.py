"""v33 — Wizard 작성중 draft 영속화.

사용자별 1개 draft 를 `mv_drafts` 컬렉션에 저장한다. wizard 가 매 변경마다
debounced PUT 으로 자동 저장하고, "내 작품" 페이지가 draft 가 있으면 작성중
카드를 노출하기 위해 GET 한다. 잡 생성 완료 시 wizard 가 DELETE 호출.

데이터 모델:
  {
    _id: ObjectId,
    user_id: str (uuid),       # unique index — 1 user = 1 draft
    payload: dict,             # wizard data 통째로 (sheets/story/...)
    step: int,                 # 마지막 작성 단계 (카드 노출 단서)
    title: Optional[str],      # 작성 중 제목 단서
    created_at: datetime,
    updated_at: datetime,
  }

엔드포인트:
  GET    /api/mv/drafts/mine    →  {draft: {...} | null}
  PUT    /api/mv/drafts/mine    →  upsert.  {ok, updated_at}
  DELETE /api/mv/drafts/mine    →  {ok}

추적자: `[MVDraftRoute]` prefix + `user_id` (uuid 앞 8자만 로그) — 민감 정보 보호.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..database.mongodb import get_mongo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mv/drafts", tags=["mv-drafts"])


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────


class PutDraftBody(BaseModel):
    """wizard 가 보내는 draft body. payload 는 자유 dict (검증 X — wizard 가
    자기 데이터 구조 책임)."""

    payload: dict[str, Any] = Field(default_factory=dict)
    step: int = Field(default=1, ge=1, le=20)
    title: Optional[str] = Field(default=None, max_length=200)


def _short_uid(user_id: str) -> str:
    return (user_id or "")[:8]


def _serialize(doc: dict) -> dict:
    """Mongo 문서 → 응답 페이로드."""
    return {
        "payload": doc.get("payload") or {},
        "step": int(doc.get("step") or 1),
        "title": doc.get("title"),
        "updated_at": (doc.get("updated_at") or doc.get("created_at")).isoformat()
        if (doc.get("updated_at") or doc.get("created_at"))
        else None,
        "created_at": doc.get("created_at").isoformat()
        if doc.get("created_at")
        else None,
    }


# ──────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────


@router.get("/mine")
async def get_my_draft(current_user=Depends(get_current_user)):
    """현재 사용자의 작성중 draft. 없으면 null."""
    user_id = current_user["id"]
    logger.info(
        "[MVDraftRoute] GET /mine entry user_id=%s",
        _short_uid(user_id),
    )
    mongo = get_mongo()
    try:
        doc = await mongo.mv_drafts.find_one({"user_id": user_id})
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[MVDraftRoute] GET /mine lookup failed user_id=%s err=%s",
            _short_uid(user_id), str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="draft 조회에 실패했어요.")
    if not doc:
        logger.info(
            "[MVDraftRoute] GET /mine empty user_id=%s",
            _short_uid(user_id),
        )
        return {"draft": None}
    payload = _serialize(doc)
    logger.info(
        "[MVDraftRoute] GET /mine ok user_id=%s step=%d payload_keys=%d",
        _short_uid(user_id), payload["step"], len(payload["payload"]),
    )
    return {"draft": payload}


@router.put("/mine")
async def put_my_draft(
    body: PutDraftBody, current_user=Depends(get_current_user),
):
    """upsert. 같은 user_id 이면 갱신, 없으면 insert."""
    user_id = current_user["id"]
    payload_keys = len(body.payload or {})
    logger.info(
        "[MVDraftRoute] PUT /mine entry user_id=%s step=%d payload_keys=%d title_len=%d",
        _short_uid(user_id), body.step, payload_keys, len(body.title or ""),
    )
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    try:
        result = await mongo.mv_drafts.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "payload": body.payload or {},
                    "step": int(body.step or 1),
                    "title": (body.title or "").strip() or None,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[MVDraftRoute] PUT /mine upsert failed user_id=%s err=%s",
            _short_uid(user_id), str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="draft 저장에 실패했어요.")
    logger.info(
        "[MVDraftRoute] PUT /mine ok user_id=%s matched=%s upserted_id=%s",
        _short_uid(user_id), result.matched_count, bool(result.upserted_id),
    )
    return {"ok": True, "updated_at": now.isoformat()}


@router.delete("/mine")
async def delete_my_draft(current_user=Depends(get_current_user)):
    """내 draft 삭제 (없어도 200).

    v36 — 같은 user 의 draft 단계 자산 (wedding_assets type=place,
    meta.mv_job_id=None) 도 함께 cleanup. 잡에 transfer 된 장소는 유지.
    """
    user_id = current_user["id"]
    logger.info(
        "[MVDraftRoute] DELETE /mine entry user_id=%s",
        _short_uid(user_id),
    )
    mongo = get_mongo()
    try:
        result = await mongo.mv_drafts.delete_one({"user_id": user_id})
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[MVDraftRoute] DELETE /mine failed user_id=%s err=%s",
            _short_uid(user_id), str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="draft 삭제에 실패했어요.")
    # v36 — draft 단계 장소 자산 cleanup (잡에 transfer 된 건 그대로).
    try:
        place_del = await mongo.wedding_assets.delete_many(
            {
                "user_id": user_id,
                "type": "place",
                "$or": [
                    {"meta.mv_job_id": None},
                    {"meta.mv_job_id": {"$exists": False}},
                ],
            }
        )
        logger.info(
            "[MVDraftRoute] DELETE /mine draft place cleanup user_id=%s deleted=%d",
            _short_uid(user_id), place_del.deleted_count,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[MVDraftRoute] DELETE /mine draft place cleanup failed user_id=%s err=%s",
            _short_uid(user_id), str(e)[:200],
        )
    logger.info(
        "[MVDraftRoute] DELETE /mine ok user_id=%s deleted=%d",
        _short_uid(user_id), result.deleted_count,
    )
    return {"ok": True}
