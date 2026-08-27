"""TrustSquad(v137) — 콘텐츠 신고 접수.

POST /api/reports (auth) — track|feed|comment 대상 신고.
PG `reports` 테이블 (마이그레이션은 main.py lifespan, 부분 유니크:
동일 reporter+target 의 pending 1건). 처리(블라인드/삭제/기각)는 admin.py.

v138 — 접수 시 자동 증거 스냅샷(비동기 best-effort — 실패해도 접수 201):
대상 사본을 MinIO images 버킷 `evidence/{report_id}/` 에 격리 복사 + sha256,
reports.evidence JSONB 갱신. evidence/ 는 공개 프록시·presign 전부 차단
(character /preview, upload /presigned-url·/cover-preview·/mv-preview) —
열람은 admin 전용 GET /api/admin/reports/{id}/evidence/{idx} 만.

로그 prefix [report]/[evidence] — id 앞 8자만, 내용 원문 미로그.
"""
import asyncio
import hashlib
import io
import json
import logging
import mimetypes
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from asyncpg.exceptions import UniqueViolationError
from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database import postgres as _pgmod
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/reports", tags=["Reports"])

logger = logging.getLogger(__name__)

TARGET_TYPES = ("track", "feed", "comment", "dm_message")
REASON_CODES = ("portrait", "copyright", "sexual", "abuse", "other")
MAX_REASON_TEXT = 500

# 대상 실존 검증용 — (Mongo 컬렉션명, 소유자 필드)
_TARGET_META = {
    "track": ("tracks", "uploader_id"),
    "feed": ("feeds", "author_id"),
    "comment": ("feed_comments", "author_id"),
    "dm_message": ("dm_messages", "sender_id"),  # v152 DmSquad — DM 메시지 신고
}


def _short(value) -> str:
    return str(value)[:8] if value else "?"


# ---------------------------------------------------------------------------
# v138 — 증거 스냅샷 (접수 시 비동기, 실패 무해)
#
# evidence JSONB 스키마:
#   {"owner_id": <피신고 콘텐츠 소유자 user_id>, "captured_at": iso8601,
#    "items": [{"kind", "object_name", "sha256"}]}
# kind: meta|cover|original_photo|sheet|virtual_sheet (track)
#       content (feed·comment — 내용 JSON)
# 전 항목 images 버킷 evidence/{report_id}/ 아래 격리 저장.
# ---------------------------------------------------------------------------

EVIDENCE_PREFIX = "evidence/"
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def _evidence_ext(object_name: str) -> str:
    ext = os.path.splitext(object_name or "")[1].lower()
    return ext if ext in _IMAGE_EXTS else ".png"


def _put_evidence_bytes(dest_object: str, data: bytes, content_type: str) -> str:
    """images 버킷 evidence/ 에 bytes 저장 후 sha256 반환 (blocking — to_thread 용)."""
    minio_client = get_minio()
    minio_client.put_object(
        bucket_name=settings.minio_bucket_images,
        object_name=dest_object,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return hashlib.sha256(data).hexdigest()


def _copy_to_evidence(src_bucket: str, src_object: str, dest_object: str) -> str:
    """MinIO 객체 사본을 evidence/ 로 복사, sha256 반환 (blocking — to_thread 용)."""
    minio_client = get_minio()
    resp = minio_client.get_object(bucket_name=src_bucket, object_name=src_object)
    try:
        data = resp.read()
    finally:
        resp.close()
        resp.release_conn()
    content_type = mimetypes.guess_type(src_object)[0] or "image/png"
    return _put_evidence_bytes(dest_object, data, content_type)


async def _snapshot_image_item(items: list, report_id: str, kind: str, src_object: str):
    """이미지 1건 복사 — 개별 실패는 스킵(나머지 항목 계속)."""
    if not src_object or str(src_object).startswith("http"):
        return
    dest = f"{EVIDENCE_PREFIX}{report_id}/{kind}{_evidence_ext(src_object)}"
    try:
        sha = await asyncio.to_thread(
            _copy_to_evidence, settings.minio_bucket_images, src_object, dest
        )
        items.append({"kind": kind, "object_name": dest, "sha256": sha})
    except Exception as e:
        logger.warning(
            "[evidence] item copy failed report=%s kind=%s err=%s",
            _short(report_id), kind, e,
        )


async def _snapshot_json_item(items: list, report_id: str, kind: str, payload: dict):
    dest = f"{EVIDENCE_PREFIX}{report_id}/{kind}.json"
    try:
        data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        sha = await asyncio.to_thread(_put_evidence_bytes, dest, data, "application/json")
        items.append({"kind": kind, "object_name": dest, "sha256": sha})
    except Exception as e:
        logger.warning(
            "[evidence] json item failed report=%s kind=%s err=%s",
            _short(report_id), kind, e,
        )


async def _snapshot_evidence(report_id: str, target_type: str, target_id: str) -> None:
    """신고 대상 증거 스냅샷 — 전체가 best-effort (실패해도 신고는 유효)."""
    try:
        mongo = get_mongo()
        items: list = []
        owner_id = None
        captured_at = datetime.now(timezone.utc).isoformat()
        # v139fix — 대상 요약 인라인 스냅샷(제목·작성자 등). 확정삭제로 live 문서가
        # 사라져도 어드민 큐 대상 칸을 접수 시점 값으로 계속 표시하기 위함.
        target_summary = None

        if target_type == "track":
            doc = await mongo.tracks.find_one({"_id": ObjectId(target_id)})
            if not doc:
                logger.warning("[evidence] target gone report=%s type=track", _short(report_id))
                return
            owner_id = doc.get("uploader_id")
            target_summary = {
                "title": doc.get("title"),
                "cover_image_url": doc.get("cover_image_url"),
                "uploader_nickname": doc.get("uploader_nickname"),
            }
            await _snapshot_json_item(items, report_id, "meta", {
                "target_type": "track",
                "target_id": target_id,
                "owner_id": owner_id,
                "uploader_nickname": doc.get("uploader_nickname"),
                "title": doc.get("title"),
                "audio_url": doc.get("audio_url"),
                "cover_image_url": doc.get("cover_image_url"),
                "created_at": doc.get("created_at"),
                "captured_at": captured_at,
            })
            # 커버 이미지 사본
            await _snapshot_image_item(items, report_id, "cover", doc.get("cover_image_url"))
            # 업로더 characters 의 원본 사진·시트 사본
            # v212 — 아티스트 다중화: 전 아티스트 doc 순회 (안전측 — 단일 문서 가정 제거).
            # 첫 doc 라벨은 기존과 동일(original_photo/sheet/virtual_sheet — 원장 호환),
            # 2번째 doc 부터 _{i} 접미. 중복 object 는 1회만 스냅샷.
            chars = await mongo.characters.find(
                {"user_id": owner_id},
                {"original_photo_object_name": 1, "sheet_object_name": 1,
                 "virtual_sheet_object_name": 1, "character_id": 1},
            ).sort("updated_at", -1).to_list(length=None) if owner_id else []
            _seen_objs = set()
            for _ci, char in enumerate(chars):
                for _label, _field in (
                    ("original_photo", "original_photo_object_name"),
                    ("sheet", "sheet_object_name"),
                    ("virtual_sheet", "virtual_sheet_object_name"),
                ):
                    _obj = char.get(_field)
                    if not _obj or _obj in _seen_objs:
                        continue
                    _seen_objs.add(_obj)
                    _kind = _label if _ci == 0 else "{}_{}".format(_label, _ci)
                    await _snapshot_image_item(items, report_id, _kind, _obj)

        elif target_type == "feed":
            doc = await mongo.feeds.find_one({"_id": ObjectId(target_id)})
            if not doc:
                logger.warning("[evidence] target gone report=%s type=feed", _short(report_id))
                return
            owner_id = doc.get("author_id")
            target_summary = {
                "kind": doc.get("kind") or "feed",
                "text_excerpt": _feed_text_excerpt(doc),
                "author_nickname": doc.get("author_nickname"),
            }
            await _snapshot_json_item(items, report_id, "content", {
                "target_type": "feed",
                "target_id": target_id,
                "owner_id": owner_id,
                "author_nickname": doc.get("author_nickname"),
                "kind": doc.get("kind"),
                "blocks": doc.get("blocks"),
                "created_at": doc.get("created_at"),
                "captured_at": captured_at,
            })

        elif target_type == "comment":
            doc = await mongo.feed_comments.find_one({"_id": ObjectId(target_id)})
            if not doc:
                logger.warning("[evidence] target gone report=%s type=comment", _short(report_id))
                return
            owner_id = doc.get("author_id")
            target_summary = {
                "text": str(doc.get("text") or "")[:100],
                "author_nickname": doc.get("author_nickname"),
            }
            await _snapshot_json_item(items, report_id, "content", {
                "target_type": "comment",
                "target_id": target_id,
                "owner_id": owner_id,
                "author_nickname": doc.get("author_nickname"),
                "feed_id": doc.get("feed_id"),
                "text": doc.get("text"),
                "created_at": doc.get("created_at"),
                "captured_at": captured_at,
            })

        elif target_type == "dm_message":
            # v152 DmSquad — DM 메시지 신고 증거(발신자=소유자, 본문 100자 요약)
            doc = await mongo.dm_messages.find_one({"_id": ObjectId(target_id)})
            if not doc:
                logger.warning("[evidence] target gone report=%s type=dm_message", _short(report_id))
                return
            owner_id = doc.get("sender_id")
            target_summary = {
                "text": str(doc.get("text") or "")[:100],
            }
            await _snapshot_json_item(items, report_id, "content", {
                "target_type": "dm_message",
                "target_id": target_id,
                "owner_id": owner_id,
                "conversation_id": doc.get("conversation_id"),
                "text": doc.get("text"),
                "created_at": doc.get("created_at"),
                "captured_at": captured_at,
            })

        evidence = {
            "owner_id": owner_id,
            "captured_at": captured_at,
            "items": items,
            "target_summary": target_summary,
        }
        async with _pgmod._pool.acquire() as conn:
            await conn.execute(
                "UPDATE reports SET evidence = $1::jsonb WHERE id = $2",
                json.dumps(evidence, ensure_ascii=False), uuid.UUID(report_id),
            )
        logger.info(
            "[evidence] snapshot ok report=%s type=%s items=%d",
            _short(report_id), target_type, len(items),
        )
    except Exception as e:
        logger.warning("[evidence] snapshot failed report=%s err=%s", _short(report_id), e)


class ReportBody(BaseModel):
    target_type: str
    target_id: str
    reason_code: str
    reason_text: Optional[str] = None


class AppealBody(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# v139 — 대상 요약 하이드레이션 (소명·내 신고 내역 공용, 타인 정보 최소화:
# 닉네임·소유자 id 미노출. 삭제된 대상은 {"deleted": True}.)
# ---------------------------------------------------------------------------

_SUMMARY_EXCERPT_LEN = 100


def _feed_text_excerpt(doc: dict) -> str:
    for b in doc.get("blocks") or []:
        if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
            return str(b["text"])[:_SUMMARY_EXCERPT_LEN]
    return ""


async def _attach_target_summaries(mongo, items: list) -> None:
    """items(각각 target_type/target_id 보유)에 target 요약 일괄 첨부."""
    ids_by_type = {"track": set(), "feed": set(), "comment": set()}
    for it in items:
        if it["target_type"] in ids_by_type and ObjectId.is_valid(it["target_id"]):
            ids_by_type[it["target_type"]].add(it["target_id"])

    snap = {}
    if ids_by_type["track"]:
        oids = [ObjectId(t) for t in ids_by_type["track"]]
        docs = await mongo.tracks.find(
            {"_id": {"$in": oids}}, {"title": 1, "cover_image_url": 1}
        ).to_list(length=len(oids))
        for d in docs:
            snap[("track", str(d["_id"]))] = {
                "title": d.get("title"),
                "cover_image_url": d.get("cover_image_url"),
            }
    if ids_by_type["feed"]:
        oids = [ObjectId(t) for t in ids_by_type["feed"]]
        docs = await mongo.feeds.find(
            {"_id": {"$in": oids}}, {"kind": 1, "blocks": 1}
        ).to_list(length=len(oids))
        for d in docs:
            snap[("feed", str(d["_id"]))] = {
                "kind": d.get("kind") or "feed",
                "text_excerpt": _feed_text_excerpt(d),
            }
    if ids_by_type["comment"]:
        oids = [ObjectId(t) for t in ids_by_type["comment"]]
        docs = await mongo.feed_comments.find(
            {"_id": {"$in": oids}}, {"text": 1}
        ).to_list(length=len(oids))
        for d in docs:
            snap[("comment", str(d["_id"]))] = {
                "text_excerpt": str(d.get("text") or "")[:_SUMMARY_EXCERPT_LEN],
            }

    for it in items:
        it["target"] = snap.get((it["target_type"], it["target_id"])) or {"deleted": True}


# ---------------------------------------------------------------------------
# v139 — 소명: 내 피해 신고 조회 / 소명 제출 · 신고자: 내 신고 내역
# (경로 고정 세그먼트 my/my-affected 는 {report_id} 계열보다 먼저 선언)
# ---------------------------------------------------------------------------


@router.get("/my-affected")
async def list_my_affected_reports(
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """내 콘텐츠가 블라인드 처리된 신고 목록 — 소명 진입점.

    status=actioned·action=blind 이고 증거 스냅샷 owner_id 가 본인인 신고.
    report_id/target_type/대상 요약/action/resolution/handled_at/소명 유무 반환.
    신고자 정보는 미노출.
    """
    user_id = current_user["id"]
    rows = await conn.fetch(
        """SELECT r.id, r.target_type, r.target_id, r.reason_code,
                  r.action, r.resolution, r.handled_at,
                  a.text AS appeal_text, a.created_at AS appeal_created_at
           FROM reports r
           LEFT JOIN report_appeals a ON a.report_id = r.id
           WHERE r.status = 'actioned' AND r.action = 'blind'
             AND r.evidence->>'owner_id' = $1
           ORDER BY r.handled_at DESC NULLS LAST""",
        user_id,
    )

    items = [
        {
            "report_id": str(r["id"]),
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "reason_code": r["reason_code"],
            "action": r["action"],
            "resolution": r["resolution"],
            "handled_at": r["handled_at"].isoformat() if r["handled_at"] else None,
            "has_appeal": r["appeal_text"] is not None,
            "appeal": (
                {
                    "text": r["appeal_text"],
                    "created_at": r["appeal_created_at"].isoformat()
                    if r["appeal_created_at"] else None,
                }
                if r["appeal_text"] is not None else None
            ),
        }
        for r in rows
    ]
    await _attach_target_summaries(get_mongo(), items)

    logger.info(
        "[report] my-affected user=%s returned=%d", _short(user_id), len(items)
    )
    return {"reports": items}


@router.post("/{report_id}/appeal", status_code=201)
async def submit_appeal(
    report_id: str,
    body: AppealBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """블라인드 처리 신고에 대한 소유자 소명 제출 — 신고당 1회.

    소유자 아님 403 · blind 상태 아님 400 · 중복 409. 성공 201 {appeal_id}.
    """
    user_id = current_user["id"]
    text = (body.text or "").strip()
    if not text or len(text) > 2000:
        return JSONResponse(
            status_code=400, content={"error": "소명 내용은 1~2000자여야 합니다."}
        )

    try:
        rid = uuid.UUID(report_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    report = await conn.fetchrow(
        """SELECT id, target_type, target_id, status, action,
                  evidence->>'owner_id' AS owner_id
           FROM reports WHERE id = $1""",
        rid,
    )
    if not report:
        return JSONResponse(status_code=404, content={"error": "신고를 찾을 수 없습니다."})

    # 소유자 검증 — 증거 스냅샷 owner_id 우선, 없으면 Mongo 현재 소유자 fallback
    owner_id = report["owner_id"]
    if not owner_id and report["target_type"] in _TARGET_META \
            and ObjectId.is_valid(report["target_id"]):
        coll_name, owner_field = _TARGET_META[report["target_type"]]
        doc = await get_mongo()[coll_name].find_one(
            {"_id": ObjectId(report["target_id"])}, {owner_field: 1}
        )
        owner_id = doc.get(owner_field) if doc else None
    if str(owner_id or "") != str(user_id):
        logger.info(
            "[report] appeal forbidden report=%s user=%s", _short(report_id), _short(user_id)
        )
        return JSONResponse(status_code=403, content={"error": "본인 콘텐츠에 대해서만 소명할 수 있습니다."})

    if not (report["status"] == "actioned" and report["action"] == "blind"):
        return JSONResponse(
            status_code=400,
            content={"error": "블라인드 처리된 신고에 대해서만 소명할 수 있습니다."},
        )

    try:
        row = await conn.fetchrow(
            """INSERT INTO report_appeals (report_id, user_id, text)
               VALUES ($1, $2, $3) RETURNING id""",
            rid, uuid.UUID(str(user_id)), text,
        )
    except UniqueViolationError:
        logger.info(
            "[report] appeal duplicate report=%s user=%s", _short(report_id), _short(user_id)
        )
        return JSONResponse(status_code=409, content={"error": "이미 소명을 제출했습니다."})

    logger.info(
        "[report] appeal ok report=%s user=%s text_len=%d",
        _short(report_id), _short(user_id), len(text),
    )
    return {"appeal_id": str(row["id"])}


@router.get("/my")
async def list_my_reports(
    page: int = 1,
    limit: int = 20,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """내가 접수한 신고 내역 — 최신순 page/limit, 대상 요약 + 처리 상태.

    통지 인프라 없는 현 단계의 신고자 처리 결과 확인 수단.
    """
    user_id = current_user["id"]
    page = max(1, page)
    limit = max(1, min(limit, 50))

    reporter = uuid.UUID(str(user_id))
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM reports WHERE reporter_id = $1", reporter
    )
    rows = await conn.fetch(
        """SELECT id, target_type, target_id, reason_code, reason_text,
                  status, action, resolution, created_at, handled_at
           FROM reports WHERE reporter_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3""",
        reporter, limit, (page - 1) * limit,
    )

    items = [
        {
            "report_id": str(r["id"]),
            "target_type": r["target_type"],
            "target_id": r["target_id"],
            "reason_code": r["reason_code"],
            "reason_text": r["reason_text"],
            "status": r["status"],
            "action": r["action"],
            "resolution": r["resolution"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "handled_at": r["handled_at"].isoformat() if r["handled_at"] else None,
        }
        for r in rows
    ]
    await _attach_target_summaries(get_mongo(), items)

    logger.info(
        "[report] my list user=%s page=%d returned=%d total=%d",
        _short(user_id), page, len(items), total,
    )
    return {
        "reports": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit if limit else 0,
        },
    }


@router.post("/", status_code=201)
async def create_report(
    body: ReportBody,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """신고 접수 — 대상 실존 검증, 본인 콘텐츠 400, 중복 pending 409."""
    reporter_id = current_user["id"]
    target_type = (body.target_type or "").strip()
    target_id = (body.target_id or "").strip()
    reason_code = (body.reason_code or "").strip()
    reason_text = (body.reason_text or "").strip() or None

    logger.info(
        "[report] create enter reporter=%s type=%s target=%s code=%s text_len=%d",
        _short(reporter_id), target_type, _short(target_id), reason_code,
        len(reason_text or ""),
    )

    if target_type not in TARGET_TYPES:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 신고 대상입니다."})
    if reason_code not in REASON_CODES:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 신고 사유입니다."})
    if reason_text and len(reason_text) > MAX_REASON_TEXT:
        return JSONResponse(
            status_code=400, content={"error": f"신고 사유는 {MAX_REASON_TEXT}자 이하여야 합니다."}
        )

    # 대상 실존 검증 + 소유자 확인
    if not ObjectId.is_valid(target_id):
        logger.info("[report] create invalid_target reporter=%s type=%s", _short(reporter_id), target_type)
        return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다."})
    mongo = get_mongo()
    coll_name, owner_field = _TARGET_META[target_type]
    doc = await mongo[coll_name].find_one({"_id": ObjectId(target_id)}, {owner_field: 1})
    if not doc:
        logger.info(
            "[report] create target_not_found reporter=%s type=%s target=%s",
            _short(reporter_id), target_type, _short(target_id),
        )
        return JSONResponse(status_code=404, content={"error": "신고 대상을 찾을 수 없습니다."})
    if doc.get(owner_field) == reporter_id:
        logger.info(
            "[report] create self_report reporter=%s type=%s target=%s",
            _short(reporter_id), target_type, _short(target_id),
        )
        return JSONResponse(status_code=400, content={"error": "본인 콘텐츠는 신고할 수 없습니다."})

    # 접수 — 부분 유니크(pending 1건)가 중복을 막음 (경쟁 안전)
    try:
        row = await conn.fetchrow(
            """INSERT INTO reports (reporter_id, target_type, target_id, reason_code, reason_text)
               VALUES ($1, $2, $3, $4, $5) RETURNING id""",
            uuid.UUID(reporter_id), target_type, target_id, reason_code, reason_text,
        )
    except UniqueViolationError:
        logger.info(
            "[report] create duplicate reporter=%s type=%s target=%s",
            _short(reporter_id), target_type, _short(target_id),
        )
        return JSONResponse(status_code=409, content={"error": "이미 접수된 신고입니다."})

    report_id = str(row["id"])

    # v138 — 증거 스냅샷 (비동기 best-effort — 실패해도 접수는 201)
    try:
        asyncio.create_task(_snapshot_evidence(report_id, target_type, target_id))
    except Exception as e:
        logger.warning("[evidence] snapshot schedule failed report=%s err=%s", _short(report_id), e)

    logger.info(
        "[report] create ok report=%s reporter=%s type=%s target=%s code=%s text_len=%d",
        _short(report_id), _short(reporter_id), target_type, _short(target_id),
        reason_code, len(reason_text or ""),
    )
    return {"report_id": report_id}
