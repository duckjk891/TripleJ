"""Albums API — v69 (revived).

Albums are owned by users and contain ordered references to one or more
tracks. Covers can be auto-borrowed from the first track, uploaded, or
AI-generated via ``cover_generator``.
"""

import io
import json
import logging
import math
import mimetypes
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import jwt as _jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from ..auth import JWT_ALGORITHM, JWT_SECRET, get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..models.album import (
    AlbumCoverGenerateBody,
    AlbumCreate,
    AlbumTracksAdd,
    AlbumTracksReorder,
    AlbumUpdate,
)
from ..services.album_cover_generator import aggregate_track_metadata
from ..services.cover_generator import generate_cover_image

router = APIRouter(prefix="/api/albums")

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
MAX_COVER_SIZE = 10 * 1024 * 1024  # 10MB
COVER_PRESIGN_HOURS = 24


# ── Helpers ─────────────────────────────────────────────────────────────────


def _presign_cover(object_name: Optional[str]) -> Optional[str]:
    """Generate a presigned GET URL for a cover object in the images bucket."""
    if not object_name:
        return None
    # If already a fully-qualified URL, return as-is.
    if object_name.startswith("http://") or object_name.startswith("https://"):
        return object_name
    try:
        client = get_minio()
        return client.presigned_get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=COVER_PRESIGN_HOURS),
        )
    except Exception:
        return None


def _serialize_track(doc: dict) -> dict:
    if doc is None:
        return None
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    doc["artist_name"] = doc.get("uploader_nickname") or "AI"
    # Presign cover for embedded tracks too — clients render straight from this.
    cover_obj = doc.get("cover_image_url")
    doc["cover_image"] = _presign_cover(cover_obj) if cover_obj else None
    return doc


def _serialize_album(
    doc: dict,
    *,
    include_tracks: bool = False,
    tracks: Optional[List[dict]] = None,
) -> dict:
    if doc is None:
        return None
    album_id = str(doc["_id"])
    created = doc.get("created_at")
    updated = doc.get("updated_at")
    created_iso = created.isoformat() if isinstance(created, datetime) else None
    updated_iso = updated.isoformat() if isinstance(updated, datetime) else None
    cover_obj = doc.get("cover_image_url")
    out = {
        "id": album_id,
        "owner_id": doc.get("owner_id"),
        "artist_id": doc.get("owner_id"),
        "artist_name": doc.get("owner_nickname") or "AI",
        "title": doc.get("title") or "",
        "description": doc.get("description"),
        "cover_image": _presign_cover(cover_obj),
        "cover_source": doc.get("cover_source") or "auto",
        "is_public": bool(doc.get("is_public", True)),
        "release_date": created_iso,
        "track_count": len(doc.get("track_ids") or []),
        "tracks": tracks if include_tracks else None,
        "created_at": created_iso,
        "updated_at": updated_iso,
    }
    return out


async def _load_tracks_ordered(mongo, track_ids: List[str]) -> List[dict]:
    """Load tracks by ObjectId list and return in the same order."""
    if not track_ids:
        return []
    obj_ids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(t)]
    if not obj_ids:
        return []
    docs = await mongo.tracks.find({"_id": {"$in": obj_ids}}).to_list(length=len(obj_ids))
    by_id = {str(d["_id"]): d for d in docs}
    ordered = [by_id[tid] for tid in track_ids if tid in by_id]
    return ordered


async def _verify_tracks_owned(
    mongo, track_ids: List[str], owner_id: str
) -> tuple[bool, list[str]]:
    """Return (ok, missing_or_not_owned_ids)."""
    if not track_ids:
        return False, []
    obj_ids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(t)]
    if len(obj_ids) != len(track_ids):
        invalid = [t for t in track_ids if not ObjectId.is_valid(t)]
        return False, invalid
    docs = await mongo.tracks.find(
        {"_id": {"$in": obj_ids}}, {"uploader_id": 1}
    ).to_list(length=len(obj_ids))
    if len(docs) != len(track_ids):
        found = {str(d["_id"]) for d in docs}
        return False, [t for t in track_ids if t not in found]
    not_owned = [
        str(d["_id"]) for d in docs if d.get("uploader_id") != owner_id
    ]
    if not_owned:
        return False, not_owned
    return True, []


async def _borrow_cover_from_first_track(
    mongo, track_ids: List[str]
) -> tuple[Optional[str], Optional[str]]:
    """Return (cover_object_name, source_track_id) borrowed from the first track."""
    if not track_ids:
        return None, None
    first_id = track_ids[0]
    if not ObjectId.is_valid(first_id):
        return None, None
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(first_id)}, {"cover_image_url": 1}
    )
    if not doc:
        return None, None
    return doc.get("cover_image_url"), first_id


# ── Routes ──────────────────────────────────────────────────────────────────


@router.get("/")
async def list_albums(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """List all public albums, paginated by created_at desc."""
    mongo = get_mongo()
    query = {"is_public": True}
    total = await mongo.albums.count_documents(query)
    cursor = (
        mongo.albums.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return {
        "albums": [_serialize_album(d) for d in docs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/latest")
async def latest_albums(limit: int = Query(20, ge=1, le=100)):
    """Latest N public albums (created_at desc)."""
    mongo = get_mongo()
    cursor = (
        mongo.albums.find({"is_public": True})
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return [_serialize_album(d) for d in docs]


@router.get("/my")
async def list_my_albums(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
):
    """List the current user's albums (including private ones)."""
    mongo = get_mongo()
    query = {"owner_id": current_user["id"]}
    total = await mongo.albums.count_documents(query)
    cursor = (
        mongo.albums.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return {
        "albums": [_serialize_album(d) for d in docs],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/", status_code=201)
async def create_album(
    title: str = Form(...),
    description: Optional[str] = Form(None),
    is_public: bool = Form(True),
    track_ids: str = Form(...),  # JSON list of track id strings
    cover_source: str = Form("auto"),
    cover_object_name: Optional[str] = Form(None),
    cover_file: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
):
    """Create an album. Multipart form; ``track_ids`` is a JSON-encoded list.

    Cover sources:
      - auto: borrow cover from track_ids[0]
      - upload: requires ``cover_file``
      - ai: requires ``cover_object_name`` (returned by /cover/generate)
    """
    # Parse track_ids JSON
    try:
        parsed_ids = json.loads(track_ids) if track_ids else []
        if not isinstance(parsed_ids, list):
            raise ValueError("track_ids must be a JSON array")
        parsed_ids = [str(t) for t in parsed_ids]
    except Exception:
        return JSONResponse(status_code=400, content={"error": "track_ids 형식이 잘못되었습니다."})

    if not parsed_ids:
        return JSONResponse(status_code=400, content={"error": "트랙을 1개 이상 선택해주세요."})

    if cover_source not in ("auto", "upload", "ai"):
        return JSONResponse(status_code=400, content={"error": "cover_source 값이 잘못되었습니다."})

    user_id = current_user["id"]
    logger.info(
        "[Albums] action=create user=%s title_len=%d tracks=%d cover_source=%s",
        user_id, len(title or ""), len(parsed_ids), cover_source,
    )

    mongo = get_mongo()

    # Ownership verification
    ok, bad = await _verify_tracks_owned(mongo, parsed_ids, user_id)
    if not ok:
        logger.info(
            "[Albums] create rejected user=%s reason=track_ownership bad_count=%d",
            user_id, len(bad),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "본인이 업로드한 트랙만 앨범에 포함할 수 있습니다."},
        )

    # Determine cover
    final_cover_object: Optional[str] = None
    final_cover_source = cover_source
    if cover_source == "upload":
        if not cover_file:
            return JSONResponse(status_code=400, content={"error": "커버 이미지 파일이 필요합니다."})
        ext = os.path.splitext(cover_file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": f"허용되지 않는 이미지 형식입니다. ({', '.join(ALLOWED_IMAGE_EXT)})"},
            )
        contents = await cover_file.read()
        if len(contents) == 0 or len(contents) > MAX_COVER_SIZE:
            return JSONResponse(status_code=400, content={"error": "커버 이미지 크기가 올바르지 않습니다."})

        album_oid = ObjectId()
        object_name = f"covers/{user_id}/album_{str(album_oid)}{ext}"
        content_type = mimetypes.guess_type(cover_file.filename or "")[0] or "image/png"
        minio_client = get_minio()
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )
        final_cover_object = object_name
        # Reuse the oid we already chose so cover key matches album id.
        album_id_to_use = album_oid
    elif cover_source == "ai":
        if not cover_object_name:
            return JSONResponse(status_code=400, content={"error": "AI 커버 객체명이 필요합니다."})
        final_cover_object = cover_object_name
        album_id_to_use = ObjectId()
    else:  # auto
        borrowed_obj, source_track_id = await _borrow_cover_from_first_track(mongo, parsed_ids)
        final_cover_object = borrowed_obj
        final_cover_source = "borrowed" if borrowed_obj else "auto"
        album_id_to_use = ObjectId()
        if source_track_id:
            logger.info(
                "[Albums] auto-borrow cover album=pending from_track=%s borrowed=%s",
                source_track_id, bool(borrowed_obj),
            )

    now = datetime.now(timezone.utc)
    doc = {
        "_id": album_id_to_use,
        "owner_id": user_id,
        "owner_nickname": current_user.get("nickname", ""),
        "title": title,
        "description": description,
        "cover_image_url": final_cover_object,
        "cover_object_name": final_cover_object,
        "cover_source": final_cover_source,
        "track_ids": parsed_ids,
        "is_public": bool(is_public),
        "created_at": now,
        "updated_at": now,
    }
    await mongo.albums.insert_one(doc)
    logger.info(
        "[Albums] created album=%s user=%s tracks=%d cover_source=%s",
        str(album_id_to_use), user_id, len(parsed_ids), final_cover_source,
    )
    tracks = await _load_tracks_ordered(mongo, parsed_ids)
    return _serialize_album(doc, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.patch("/{album_id}")
async def update_album(
    album_id: str,
    body: AlbumUpdate,
    current_user=Depends(get_current_user),
):
    """Update album metadata (owner only)."""
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 수정할 수 있습니다."})

    update_data = {k: v for k, v in body.dict().items() if v is not None}
    if not update_data:
        return JSONResponse(status_code=400, content={"error": "수정할 항목이 없습니다."})
    update_data["updated_at"] = datetime.now(timezone.utc)

    logger.info(
        "[Albums] action=update user=%s album=%s fields=%d",
        current_user["id"], album_id, len(update_data) - 1,
    )
    await mongo.albums.update_one({"_id": ObjectId(album_id)}, {"$set": update_data})
    updated = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    tracks = await _load_tracks_ordered(mongo, updated.get("track_ids") or [])
    return _serialize_album(updated, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.delete("/{album_id}")
async def delete_album(album_id: str, current_user=Depends(get_current_user)):
    """Delete an album (owner only)."""
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 삭제할 수 있습니다."})

    logger.info(
        "[Albums] action=delete user=%s album=%s tracks=%d",
        current_user["id"], album_id, len(doc.get("track_ids") or []),
    )
    await mongo.albums.delete_one({"_id": ObjectId(album_id)})

    # Best-effort cleanup of upload/AI cover objects that belong to this album.
    cover_obj = doc.get("cover_object_name") or ""
    if cover_obj and cover_obj.startswith(f"covers/{current_user['id']}/album_"):
        try:
            get_minio().remove_object(
                bucket_name=settings.minio_bucket_images,
                object_name=cover_obj,
            )
        except Exception:
            pass
    elif cover_obj.startswith(f"covers/generated/{current_user['id']}/album_"):
        try:
            get_minio().remove_object(
                bucket_name=settings.minio_bucket_images,
                object_name=cover_obj,
            )
        except Exception:
            pass

    return {"message": "앨범이 삭제되었습니다."}


@router.post("/{album_id}/tracks")
async def add_tracks(
    album_id: str,
    body: AlbumTracksAdd,
    current_user=Depends(get_current_user),
):
    """Append tracks to an album. Idempotent (existing ids are dropped)."""
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 수정할 수 있습니다."})

    if not body.track_ids:
        return JSONResponse(status_code=400, content={"error": "추가할 트랙 ID가 없습니다."})

    ok, bad = await _verify_tracks_owned(mongo, body.track_ids, current_user["id"])
    if not ok:
        logger.info(
            "[Albums] add_tracks rejected user=%s album=%s bad_count=%d",
            current_user["id"], album_id, len(bad),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "본인이 업로드한 트랙만 추가할 수 있습니다."},
        )

    existing = list(doc.get("track_ids") or [])
    seen = set(existing)
    new_ids = [tid for tid in body.track_ids if tid not in seen]
    for tid in new_ids:
        seen.add(tid)
    merged = existing + new_ids

    logger.info(
        "[Albums] action=add_tracks user=%s album=%s added=%d total=%d",
        current_user["id"], album_id, len(new_ids), len(merged),
    )
    await mongo.albums.update_one(
        {"_id": ObjectId(album_id)},
        {"$set": {"track_ids": merged, "updated_at": datetime.now(timezone.utc)}},
    )
    updated = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    tracks = await _load_tracks_ordered(mongo, updated.get("track_ids") or [])
    return _serialize_album(updated, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.delete("/{album_id}/tracks/{track_id}")
async def remove_track(
    album_id: str,
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Remove a single track from the album. Auto-deletes album when empty."""
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 수정할 수 있습니다."})

    existing = list(doc.get("track_ids") or [])
    if track_id not in existing:
        return JSONResponse(status_code=404, content={"error": "앨범에 없는 트랙입니다."})

    remaining = [t for t in existing if t != track_id]
    logger.info(
        "[Albums] action=remove_track user=%s album=%s track=%s remaining=%d",
        current_user["id"], album_id, track_id, len(remaining),
    )

    if not remaining:
        await mongo.albums.delete_one({"_id": ObjectId(album_id)})
        logger.info(
            "[Albums] auto-deleted album=%s user=%s reason=empty",
            album_id, current_user["id"],
        )
        return {"message": "마지막 트랙이 제거되어 앨범이 삭제되었습니다.", "album_deleted": True}

    await mongo.albums.update_one(
        {"_id": ObjectId(album_id)},
        {"$set": {"track_ids": remaining, "updated_at": datetime.now(timezone.utc)}},
    )
    updated = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    tracks = await _load_tracks_ordered(mongo, updated.get("track_ids") or [])
    return _serialize_album(updated, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.put("/{album_id}/tracks/order")
async def reorder_tracks(
    album_id: str,
    body: AlbumTracksReorder,
    current_user=Depends(get_current_user),
):
    """Reorder album tracks. ``track_ids`` set must match the current set."""
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 수정할 수 있습니다."})

    current_set = set(doc.get("track_ids") or [])
    requested = list(body.track_ids or [])
    if set(requested) != current_set or len(requested) != len(current_set):
        logger.info(
            "[Albums] reorder rejected user=%s album=%s current_size=%d requested_size=%d",
            current_user["id"], album_id, len(current_set), len(requested),
        )
        return JSONResponse(
            status_code=400,
            content={"error": "재정렬 요청의 트랙 집합이 현재 앨범과 일치하지 않습니다."},
        )

    logger.info(
        "[Albums] action=reorder user=%s album=%s tracks=%d",
        current_user["id"], album_id, len(requested),
    )
    await mongo.albums.update_one(
        {"_id": ObjectId(album_id)},
        {"$set": {"track_ids": requested, "updated_at": datetime.now(timezone.utc)}},
    )
    updated = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    tracks = await _load_tracks_ordered(mongo, updated.get("track_ids") or [])
    return _serialize_album(updated, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.patch("/{album_id}/cover")
async def update_cover(
    album_id: str,
    cover_file: Optional[UploadFile] = File(None),
    cover_object_name: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """Update album cover.

    - cover_file present → upload path.
    - cover_object_name present → AI-generated path.
    - both empty → re-apply auto-borrow from first track.
    """
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})
    if doc.get("owner_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 앨범만 수정할 수 있습니다."})

    user_id = current_user["id"]
    new_cover_obj: Optional[str] = None
    new_cover_source: str

    if cover_file is not None:
        ext = os.path.splitext(cover_file.filename or "")[1].lower()
        if ext not in ALLOWED_IMAGE_EXT:
            return JSONResponse(
                status_code=400,
                content={"error": f"허용되지 않는 이미지 형식입니다. ({', '.join(ALLOWED_IMAGE_EXT)})"},
            )
        contents = await cover_file.read()
        if len(contents) == 0 or len(contents) > MAX_COVER_SIZE:
            return JSONResponse(status_code=400, content={"error": "커버 이미지 크기가 올바르지 않습니다."})
        object_name = f"covers/{user_id}/album_{album_id}{ext}"
        content_type = mimetypes.guess_type(cover_file.filename or "")[0] or "image/png"
        get_minio().put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )
        new_cover_obj = object_name
        new_cover_source = "upload"
    elif cover_object_name:
        new_cover_obj = cover_object_name
        new_cover_source = "ai"
    else:
        borrowed_obj, source_track_id = await _borrow_cover_from_first_track(
            mongo, doc.get("track_ids") or []
        )
        new_cover_obj = borrowed_obj
        new_cover_source = "borrowed" if borrowed_obj else "auto"
        if source_track_id:
            logger.info(
                "[Albums] auto-borrow cover album=%s from_track=%s borrowed=%s",
                album_id, source_track_id, bool(borrowed_obj),
            )

    logger.info(
        "[Albums] action=update_cover user=%s album=%s cover_source=%s has_obj=%s",
        user_id, album_id, new_cover_source, bool(new_cover_obj),
    )
    await mongo.albums.update_one(
        {"_id": ObjectId(album_id)},
        {"$set": {
            "cover_image_url": new_cover_obj,
            "cover_object_name": new_cover_obj,
            "cover_source": new_cover_source,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    updated = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    tracks = await _load_tracks_ordered(mongo, updated.get("track_ids") or [])
    return _serialize_album(updated, include_tracks=True, tracks=[_serialize_track(t) for t in tracks])


@router.post("/cover/generate")
async def generate_album_cover(
    body: AlbumCoverGenerateBody,
    current_user=Depends(get_current_user),
):
    """Generate an AI cover image for a (prospective) album.

    The image is stored under ``covers/generated/{owner_id}/album_{uuid}.png``
    and the object name is returned. The client then passes the object name
    to ``POST /api/albums`` (cover_source=ai) or
    ``PATCH /api/albums/{id}/cover`` (cover_object_name) to finalize.
    """
    user_id = current_user["id"]
    mongo = get_mongo()

    # Load owned tracks (best effort — empty list means no metadata aggregation).
    track_ids = [str(t) for t in (body.track_ids or [])]
    tracks: List[dict] = []
    if track_ids:
        ok, bad = await _verify_tracks_owned(mongo, track_ids, user_id)
        if not ok:
            return JSONResponse(
                status_code=400,
                content={"error": "본인이 업로드한 트랙만 메타데이터로 사용할 수 있습니다."},
            )
        tracks = await _load_tracks_ordered(mongo, track_ids)

    genres, moods = aggregate_track_metadata(tracks)

    # Optional character sheet bytes
    character_bytes: Optional[bytes] = None
    if body.include_character:
        char_doc = await mongo.characters.find_one({"user_id": user_id})
        sheet_obj = (char_doc or {}).get("sheet_object_name")
        if sheet_obj:
            try:
                resp = get_minio().get_object(
                    bucket_name=settings.minio_bucket_images,
                    object_name=sheet_obj,
                )
                character_bytes = resp.read()
                resp.close()
                resp.release_conn()
            except Exception:
                character_bytes = None

    logger.info(
        "[AlbumCover] gen user=%s gender=%s model=%s incl_char=%s has_char_bytes=%s genres=%d moods=%d tracks=%d title_len=%d",
        user_id,
        body.gender,
        body.image_model,
        body.include_character,
        bool(character_bytes),
        len(genres),
        len(moods),
        len(tracks),
        len(body.title or ""),
    )

    try:
        image_bytes = await generate_cover_image(
            title=body.title,
            genre=", ".join(genres) if genres else None,
            mood=", ".join(moods) if moods else None,
            user_prompt=body.description,
            character_image_bytes=character_bytes,
            image_model=body.image_model,
            vocal_gender=body.gender,
        )
    except Exception as e:  # noqa: BLE001
        err_text = f"{type(e).__name__}: {str(e)[:200] or '(no message)'}"
        logger.error("[AlbumCover] generation failed user=%s err=%s", user_id, err_text)
        return JSONResponse(status_code=502, content={"error": "AI 커버 생성에 실패했습니다."})

    # Persist as a temporary generated object.
    object_name = f"covers/generated/{user_id}/album_{uuid.uuid4().hex}.png"
    try:
        get_minio().put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type="image/png",
        )
    except Exception as e:  # noqa: BLE001
        err_text = f"{type(e).__name__}: {str(e)[:200] or '(no message)'}"
        logger.error("[AlbumCover] minio put failed user=%s err=%s", user_id, err_text)
        return JSONResponse(status_code=500, content={"error": "AI 커버 저장에 실패했습니다."})

    presigned = _presign_cover(object_name)
    logger.info(
        "[AlbumCover] gen success user=%s object=%s bytes=%d",
        user_id, object_name, len(image_bytes),
    )
    return {
        "cover_object_name": object_name,
        "cover_image_url": presigned,
    }


def _soft_resolve_viewer_id(request: Request) -> Optional[str]:
    """Best-effort: decode JWT without raising; return user id or None."""
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    raw_token: Optional[str] = None
    if auth and auth.startswith("Bearer "):
        raw_token = auth.split(" ", 1)[1].strip() or None
    if not raw_token:
        raw_token = request.query_params.get("token")
    if not raw_token:
        return None
    try:
        payload = _jwt.decode(
            raw_token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            options={"verify_exp": True},
        )
    except Exception:
        return None
    uid = payload.get("id")
    return str(uid) if uid else None


@router.get("/{album_id}")
async def get_album(album_id: str, request: Request):
    """Album detail with embedded tracks.

    Public albums: anonymous OK. Private albums: only the owner may view —
    JWT is soft-decoded so the public-album path stays anonymous-friendly.
    """
    if not ObjectId.is_valid(album_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 앨범 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.albums.find_one({"_id": ObjectId(album_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "앨범을 찾을 수 없습니다."})

    if not doc.get("is_public", True):
        viewer_id = _soft_resolve_viewer_id(request)
        if viewer_id != doc.get("owner_id"):
            return JSONResponse(status_code=403, content={"error": "비공개 앨범입니다."})

    tracks = await _load_tracks_ordered(mongo, doc.get("track_ids") or [])
    return _serialize_album(
        doc,
        include_tracks=True,
        tracks=[_serialize_track(t) for t in tracks],
    )
