"""TrustSquad(v138) BE-2 — 인물 기반 일괄 수색·몰수 어드민 라우트.

POST /api/admin/moderation/face-search {report_id}
    → 신고 증거의 기준 얼굴로 피신고 사용자 콘텐츠 수색(동기, services/face_search_service).
POST /api/admin/moderation/purge {report_id, targets:[{type: track|character, id}]}
    → 선택 일괄 몰수: 트랙은 tracks.purge_track_document 재사용 완전 파기,
      캐릭터는 characters 문서+MinIO(원본·시트) 삭제(소유자 캐릭터 삭제 로직 준용).
      user_violations(kind='face_purge') 1건 + 수색 기준 원본 사진 sha256
      face_source_blacklist upsert + admin_logs 감사 기록.

admin.py 는 BE-1 전유 — _log_admin_action 함수 import 재사용만.
로그 prefix [moderation]. id 는 앞 8자만.
"""

import asyncio
import logging
import uuid
from typing import List

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_admin_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services.face_search_service import (
    NO_BASE_FACE_MSG,
    REPORT_NOT_FOUND_MSG,
    FaceSearchError,
    _parse_jsonb,
    search_user_content_by_face,
)
from .admin import _log_admin_action
from .tracks import purge_track_document

router = APIRouter(prefix="/api/admin/moderation", tags=["AdminModeration"])

logger = logging.getLogger(__name__)


def _short(value) -> str:
    return str(value)[:8] if value else "?"


class FaceSearchBody(BaseModel):
    report_id: str


class PurgeTarget(BaseModel):
    type: str  # 'track' | 'character'
    id: str


class PurgeBody(BaseModel):
    report_id: str
    targets: List[PurgeTarget]


# ---------------------------------------------------------------------------
# POST /face-search
# ---------------------------------------------------------------------------

@router.post("/face-search")
async def face_search(
    body: FaceSearchBody,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """신고 기준 인물 수색 — 매치 목록(유사도·썸네일) 반환 (동기).

    기준 얼굴 자료 없음 → 400, 신고 미존재 → 404.
    thumbnail_url 은 어드민 media 프록시(/api/admin/media/{object}) 경유 —
    외부 http(s) 커버 URL 은 그대로 반환.
    """
    logger.info(
        "[moderation] face-search enter report=%s admin=%s",
        _short(body.report_id), _short(current_admin["id"]),
    )
    try:
        result = await search_user_content_by_face(body.report_id, conn)
    except FaceSearchError as e:
        status = 404 if str(e) == REPORT_NOT_FOUND_MSG else 400
        return JSONResponse(status_code=status, content={"error": str(e) or NO_BASE_FACE_MSG})

    for m in result["matches"]:
        obj = m.get("object_name") or ""
        m["thumbnail_url"] = (
            obj if obj.startswith("http") else "/api/admin/media/{}".format(obj)
        )

    logger.info(
        "[moderation] face-search done report=%s admin=%s matches=%d scanned=%d "
        "skipped=%d compare_calls=%d",
        _short(body.report_id), _short(current_admin["id"]),
        len(result["matches"]), result["scanned"], result["skipped"],
        result["compare_calls"],
    )
    return result


# ---------------------------------------------------------------------------
# POST /purge
# ---------------------------------------------------------------------------


async def _purge_character_document(mongo, char: dict) -> None:
    """캐릭터 몰수 — characters 문서 + MinIO 원본·시트 삭제.

    소유자 자진 삭제 라우트(character.py DELETE /me, v137 ②) 로직 준용:
    characters/{user_id}/ prefix 일괄 삭제 + prefix 밖 원본 사진 명시 삭제.
    """
    user_id = char.get("user_id")
    original_photo = char.get("original_photo_object_name") or ""
    minio_client = get_minio()

    await mongo.characters.delete_one({"_id": char["_id"]})

    prefix = "characters/{}/".format(user_id)

    def _sweep():
        objects = minio_client.list_objects(
            bucket_name=settings.minio_bucket_images, prefix=prefix, recursive=True
        )
        from minio.deleteobjects import DeleteObject

        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        if delete_list:
            errors = minio_client.remove_objects(
                bucket_name=settings.minio_bucket_images,
                delete_object_list=delete_list,
            )
            for err in errors:
                logger.warning("[moderation] character minio delete failed: %s", err)
        return len(delete_list)

    try:
        removed = await asyncio.to_thread(_sweep)
        logger.info(
            "[moderation] character purged user=%s objects=%d", _short(user_id), removed
        )
    except Exception as e:
        logger.warning(
            "[moderation] character minio sweep failed user=%s err=%s",
            _short(user_id), str(e)[:120],
        )

    # temp 경로 등 prefix 밖에 박제된 원본 사진 명시 삭제 (v137 ② 준용).
    if original_photo and not original_photo.startswith(prefix):
        try:
            await asyncio.to_thread(
                minio_client.remove_object, settings.minio_bucket_images, original_photo
            )
            logger.info(
                "[moderation] character original_photo deleted user=%s (explicit)",
                _short(user_id),
            )
        except Exception as e:
            logger.warning(
                "[moderation] character original photo delete failed user=%s err=%s",
                _short(user_id), str(e)[:120],
            )


@router.post("/purge")
async def purge_targets(
    body: PurgeBody,
    current_admin=Depends(get_admin_user),
    conn=Depends(get_pg),
):
    """수색 매치 대상 일괄 몰수.

    트랙: purge_track_document 재사용(MinIO·Mongo·Redis·ES·PG 완전 파기).
    캐릭터: characters 문서 + MinIO 원본·시트 삭제.
    1건 이상 몰수 시 user_violations(kind='face_purge') 기록 + 수색 기준
    원본 사진 sha256 face_source_blacklist upsert + admin_logs 감사 기록.
    안전 가드: 신고 증거의 owner_id 소유 콘텐츠만 몰수(불일치 → failed).
    """
    admin_id = current_admin["id"]
    logger.info(
        "[moderation] purge enter report=%s admin=%s targets=%d",
        _short(body.report_id), _short(admin_id), len(body.targets),
    )

    try:
        rid = uuid.UUID(body.report_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"error": REPORT_NOT_FOUND_MSG})
    report = await conn.fetchrow("SELECT id, evidence FROM reports WHERE id = $1", rid)
    if not report:
        return JSONResponse(status_code=404, content={"error": REPORT_NOT_FOUND_MSG})
    if not body.targets:
        return JSONResponse(status_code=400, content={"error": "몰수할 대상을 선택해주세요."})

    evidence = _parse_jsonb(report["evidence"]) or {}
    owner_id = str(evidence.get("owner_id") or "")

    mongo = get_mongo()
    purged_tracks = 0
    purged_characters = 0
    failed: list = []

    for target in body.targets:
        ttype = (target.type or "").strip()
        tid = (target.id or "").strip()
        if ttype not in ("track", "character"):
            failed.append({"type": ttype, "id": tid, "reason": "unsupported_type"})
            continue
        if not ObjectId.is_valid(tid):
            failed.append({"type": ttype, "id": tid, "reason": "invalid_id"})
            continue

        coll = mongo.tracks if ttype == "track" else mongo.characters
        doc = await coll.find_one({"_id": ObjectId(tid)})
        if not doc:
            failed.append({"type": ttype, "id": tid, "reason": "not_found"})
            continue

        doc_owner = doc.get("uploader_id") if ttype == "track" else doc.get("user_id")
        if owner_id and str(doc_owner) != owner_id:
            # 신고 증거의 피신고자 소유 콘텐츠만 몰수 가능 — 오폭 방지 가드.
            failed.append({"type": ttype, "id": tid, "reason": "owner_mismatch"})
            logger.warning(
                "[moderation] purge owner_mismatch report=%s type=%s target=%s",
                _short(body.report_id), ttype, _short(tid),
            )
            continue

        try:
            if ttype == "track":
                await purge_track_document(doc, conn)
                purged_tracks += 1
            else:
                await _purge_character_document(mongo, doc)
                purged_characters += 1
        except Exception as e:
            logger.error(
                "[moderation] purge failed report=%s type=%s target=%s err=%s",
                _short(body.report_id), ttype, _short(tid), str(e)[:150],
            )
            failed.append({"type": ttype, "id": tid, "reason": "purge_failed"})

    # ── 위반 기록 (1건, kind='face_purge') — 실제 몰수가 있었던 경우만 ──────
    # v139 — strike_service 로 일원화 (누적 1/2/3건 자동 제재 포함)
    violation_recorded = False
    if (purged_tracks or purged_characters) and owner_id:
        try:
            from ..services.strike_service import apply_strike

            await apply_strike(conn, owner_id, rid, "face_purge")
            violation_recorded = True
        except Exception as e:
            logger.error(
                "[moderation] violation record failed report=%s err=%s",
                _short(body.report_id), str(e)[:150],
            )

    # ── 수색 기준 원본 사진 sha256 블랙리스트 upsert ─────────────────────────
    # v142 Low — 몰수 0건이면 등록 스킵, blacklisted 는 실제 신규 등록 수만 집계
    # (ON CONFLICT DO NOTHING 결과 태그 "INSERT 0 0" = 기존재 → 미집계).
    blacklisted = 0
    if purged_tracks or purged_characters:
        for item in evidence.get("items") or []:
            if item.get("kind") == "original_photo" and item.get("sha256"):
                try:
                    result = await conn.execute(
                        """INSERT INTO face_source_blacklist (sha256, report_id)
                           VALUES ($1, $2) ON CONFLICT (sha256) DO NOTHING""",
                        item["sha256"], rid,
                    )
                    if result and result.split()[-1] == "1":
                        blacklisted += 1
                except Exception as e:
                    logger.error(
                        "[moderation] blacklist upsert failed report=%s err=%s",
                        _short(body.report_id), str(e)[:150],
                    )

    await _log_admin_action(
        conn, admin_id, "face_purge", "report", body.report_id,
        details={
            "owner_id": owner_id or None,
            "purged_tracks": purged_tracks,
            "purged_characters": purged_characters,
            "blacklisted": blacklisted,
            "violation_recorded": violation_recorded,
            "failed": failed,
        },
    )
    logger.info(
        "[moderation] purge done report=%s admin=%s tracks=%d characters=%d "
        "blacklisted=%d violation=%s failed=%d",
        _short(body.report_id), _short(admin_id), purged_tracks, purged_characters,
        blacklisted, violation_recorded, len(failed),
    )
    return {
        "purged": {"tracks": purged_tracks, "characters": purged_characters},
        "blacklisted": blacklisted,
        "violation_recorded": violation_recorded,
        "failed": failed,
    }
