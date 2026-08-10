import asyncio
import io
import json
import logging
import math
import mimetypes
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.redis import get_redis
from ..database.minio import get_minio
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/tracks")

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".ogg", ".flac", ".m4a"}
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50MB


def _serialize_track(doc: dict) -> dict:
    """Convert MongoDB document to JSON-serializable dict."""
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    # Add aliases for frontend compatibility
    doc["artist_id"] = doc.get("uploader_id")
    doc["artist_name"] = doc.get("uploader_nickname", "AI")
    doc["cover_image"] = doc.get("cover_image_url")
    # v137 — 신고 블라인드 플래그 (소유자 사유 표시용, 기본 false)
    doc["report_blinded"] = bool(doc.get("report_blinded", False))
    return doc


def _is_hidden_track(t: dict) -> bool:
    """v138 직링크 가드 — 명시적 비공개(is_public=False) 또는 신고 블라인드.

    is_public 필드가 없는 레거시 도큐먼트는 공개로 취급(회귀 방지 —
    기존 공개 곡 비로그인 200 불변이 최우선)."""
    return (t.get("is_public") is False) or bool(t.get("report_blinded"))


def _can_view_hidden_track(t: dict, current_user) -> bool:
    """숨김 트랙 열람 허용 — 소유자 본인 또는 admin."""
    if not current_user:
        return False
    return (
        current_user.get("id") == t.get("uploader_id")
        or current_user.get("role") == "admin"
    )


_TRACK_NOT_FOUND = {"error": "트랙을 찾을 수 없습니다."}


async def _find_completed_mv(mongo, generation_id: str) -> Optional[dict]:
    """Find a completed MV job linked to the given generation_id."""
    if not generation_id:
        return None
    mv_job = await mongo.mv_jobs.find_one({
        "audio_generation_id": generation_id,
        "status": "completed",
        "result_music_video_url": {"$exists": True, "$ne": None},
    })
    return mv_job


def _mv_presigned_url(object_name: Optional[str]) -> Optional[str]:
    """Generate a presigned URL for an MV object in the images bucket."""
    if not object_name:
        return None
    try:
        minio_client = get_minio()
        return minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            expires=timedelta(hours=24),
        )
    except Exception:
        return None


def _serialize_tracks(docs: list) -> list:
    return [_serialize_track(d) for d in docs]


def _parse_sns_links_jsonb(value) -> list:
    """asyncpg JSONB 는 str 로 올 수 있음 — list 로 정규화 (실패 시 [])."""
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return value if isinstance(value, list) else []


async def _attach_uploader_profiles(tracks: list, conn) -> None:
    """각 트랙에 uploader_profile_image / uploader_sns_links 첨부
    (PG users 1쿼리 join, best-effort).

    실패해도 응답은 깨지 않고 None/[] 으로 채운다. list_tracks/상세 전용 —
    다른 콜러(search 등)는 범위 밖. 캐시 밖에서 항상 fresh 하게 첨부.
    """
    ids = sorted({t.get("uploader_id") for t in tracks if t and t.get("uploader_id")})
    profiles = {}
    if ids:
        try:
            rows = await conn.fetch(
                "SELECT id::text, profile_image, sns_links FROM users WHERE id::text = ANY($1)", ids
            )
            profiles = {
                r["id"]: (r["profile_image"], _parse_sns_links_jsonb(r["sns_links"]))
                for r in rows
            }
        except Exception:
            logger.warning("[tracks] uploader profile join failed ids=%d", len(ids))
    for t in tracks:
        if t is not None:
            image, sns = profiles.get(t.get("uploader_id"), (None, []))
            t["uploader_profile_image"] = image
            t["uploader_sns_links"] = sns


@router.get("/")
async def list_tracks(
    page: int = 1,
    limit: int = 20,
    genre: str = None,
    mood: str = None,
    tag: str = None,
    sort: str = "play_count",
    pg=Depends(get_pg),
):
    mongo = get_mongo()
    query = {"is_public": True}

    if genre:
        query["genre"] = genre
    if mood:
        query["mood"] = mood
    if tag:
        query["tags"] = tag

    sort_field = sort if sort in ("play_count", "like_count", "created_at") else "play_count"
    sort_dir = -1

    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort(sort_field, sort_dir).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)

    serialized = _serialize_tracks(tracks)
    await _attach_uploader_profiles(serialized, pg)

    return {
        "tracks": serialized,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# VectorSearch — number of semantic candidates pulled from pgvector before
# the public-filter + pagination is applied. Generous so paging works.
_SEMANTIC_TOP_K = 100

# HybridSearch (B3) — obvious music-search filler phrases stripped from the
# *embedding* query only (the ES side handles fillers via the ko_search analyzer).
# Keeps the semantic vector focused on the mood/topic ("설레일때 듣는 노래" →
# "설레일때") instead of being pulled toward energetic/"노래" neighbours. Order
# matters: longer phrases first so "듣고싶어" is removed before "듣". Conservative —
# if stripping empties the query we fall back to the original text.
_VEC_FILLER_PHRASES = [
    "듣고싶은", "듣고싶어", "들을때", "들을래", "들으면", "들으며",
    "듣는", "들을", "들어", "듣기", "노래", "음악", "곡", "트랙", "사운드",
    "추천곡", "추천", "플레이리스트", "플리", "리스트", "모음", "좋은", "최고",
]


def _strip_vec_fillers(q: str) -> str:
    """Lightweight filler strip for the embedding query (B3).

    Removes obvious music-search plumbing words/phrases so the semantic vector
    centers on the mood/topic. Never raises; returns the original query if the
    result would be empty (meaning the query was *all* filler). The raw query is
    still passed unchanged to ES, whose ko_search analyzer does the real work.
    """
    if not q:
        return q
    stripped = q
    for ph in _VEC_FILLER_PHRASES:
        stripped = stripped.replace(ph, " ")
    stripped = " ".join(stripped.split()).strip()
    if not stripped:
        logger.info("[tracks.search] vec filler strip emptied q_len=%d, using original", len(q))
        return q
    if stripped != q:
        logger.info("[tracks.search] vec filler strip q_len=%d -> q_len=%d", len(q), len(stripped))
    return stripped


async def _regex_search_tracks(mongo, q: str, page: int, limit: int) -> dict:
    """Original MongoDB regex search. Used as the semantic-search fallback."""
    query = {
        "is_public": True,
        "$or": [
            {"title": {"$regex": q, "$options": "i"}},
            {"tags": {"$regex": q, "$options": "i"}},
            {"prompt": {"$regex": q, "$options": "i"}},
            {"uploader_nickname": {"$regex": q, "$options": "i"}},
        ],
    }
    total = await mongo.tracks.count_documents(query)
    cursor = mongo.tracks.find(query).sort("play_count", -1).skip((page - 1) * limit).limit(limit)
    tracks = await cursor.to_list(length=limit)
    return {
        "tracks": _serialize_tracks(tracks),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


async def _hybrid_search_core(mongo, pg, q: str, page: int, limit: int) -> tuple:
    """Hybrid track search core: pgvector (semantic) + Elasticsearch BM25 (nori +
    fuzzy), fused with Reciprocal Rank Fusion (RRF). Returns (payload, mode)
    where payload is the unchanged {tracks, pagination} response body.

    Both backends return up to _SEMANTIC_TOP_K ranked track_ids; rrf_fuse merges
    them, matching public tracks are fetched from MongoDB, re-ordered to the
    fused rank, then paginated.

    Graceful degrade:
      - both vector + ES available  -> mode=hybrid
      - only vector available       -> mode=vec
      - only ES available           -> mode=es
      - vec ran but nothing survived the cosine floor and ES empty -> mode=cutoff
      - neither backend usable      -> mode=regex (original MongoDB regex)
    """
    q_len = len(q)

    from ..services.embedding_service import search_similar
    from ..services.search_service import es_search, rrf_fuse

    # --- pgvector (semantic) candidates, with cosine cutoff ---
    # search_similar returns [(track_id, score)] where score = cosine similarity
    # (0~1, higher = closer). We keep only candidates above settings.search_min_cosine
    # so irrelevant queries (whose nearest neighbours are still far) get dropped.
    floor = settings.search_min_cosine
    vec_ids: list = []
    vec_ok = False
    vec_top1: float = 0.0
    try:
        vec_q = _strip_vec_fillers(q)
        matches = await search_similar(pg, vec_q, _SEMANTIC_TOP_K)
        if matches:
            vec_top1 = matches[0][1]
        vec_ids = [tid for tid, score in matches if score >= floor]
        vec_ok = True
    except Exception as e:
        logger.warning("[tracks.search] vec backend failed q_len=%d: %s", q_len, e)

    # --- Elasticsearch BM25 candidates (best-effort, never raises) ---
    es_ids: list = []
    es_ok = False
    try:
        es_ids = await es_search(q, _SEMANTIC_TOP_K)
        es_ok = True
    except Exception as e:
        logger.warning("[tracks.search] es backend failed q_len=%d: %s", q_len, e)

    # --- determine mode from what produced usable signal ---
    if vec_ids and es_ids:
        mode = "hybrid"
    elif vec_ids:
        mode = "vec"
    elif es_ids:
        mode = "es"
    elif vec_ok:
        # The vector backend ran but every candidate fell below the cosine floor,
        # and ES (lexical) found nothing either -> the query is plainly unrelated
        # to the catalog. Return an explicit empty result; do NOT regex-fall back.
        logger.info(
            "[tracks.search] mode=cutoff floor=%.3f vec_kept=0 es=0 vec_top1=%.4f n=0 total=0 (no match)",
            floor, vec_top1,
        )
        return (
            {
                "tracks": [],
                "pagination": {"page": page, "limit": limit, "total": 0, "totalPages": 0},
            },
            "cutoff",
        )
    else:
        # Vector backend itself failed AND ES yielded nothing -> we cannot judge
        # relevance, so degrade to the original regex fallback.
        logger.info(
            "[tracks.search] mode=regex q_len=%d reason=no_candidates vec_ok=%s es_ok=%s",
            q_len, vec_ok, es_ok,
        )
        return await _regex_search_tracks(mongo, q, page, limit), "regex"

    try:
        fused_ids = rrf_fuse(
            vec_ids,
            es_ids,
            vec_weight=settings.rrf_vec_weight,
            es_weight=settings.rrf_es_weight,
        )
        rank_by_id = {tid: i for i, tid in enumerate(fused_ids)}
        object_ids = [ObjectId(tid) for tid in fused_ids if ObjectId.is_valid(tid)]

        cursor = mongo.tracks.find({"_id": {"$in": object_ids}, "is_public": True})
        docs = await cursor.to_list(length=len(object_ids))

        # Preserve fused RRF order.
        docs.sort(key=lambda d: rank_by_id.get(str(d["_id"]), len(rank_by_id)))

        total = len(docs)
        start = (page - 1) * limit
        page_docs = docs[start:start + limit]

        logger.info(
            "[tracks.search] mode=%s floor=%.3f vec_kept=%d es=%d n=%d total=%d",
            mode, floor, len(vec_ids), len(es_ids), len(page_docs), total,
        )
        return (
            {
                "tracks": _serialize_tracks(page_docs),
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": total,
                    "totalPages": math.ceil(total / limit) if limit else 0,
                },
            },
            mode,
        )
    except Exception as e:
        logger.warning("[tracks.search] mode=regex q_len=%d reason=fuse_error: %s", q_len, e)
        return await _regex_search_tracks(mongo, q, page, limit), "regex"


def _engkor_retry_query(q: str) -> Optional[str]:
    """v169 — wrong-IME retry candidate for a zero-result query.

    All-ASCII-letter queries (spaces allowed) are converted qwerty→한글, all-
    Korean queries 한글→qwerty. Returns the converted query, or None when the
    query mixes scripts / contains digits-symbols / converts to itself. Pure
    check — never raises.
    """
    from ..services.keyboard_layout import eng_to_kor, kor_to_eng

    if not q:
        return None
    stripped = q.replace(" ", "")
    if not stripped:
        return None
    if all("a" <= c.lower() <= "z" for c in stripped):
        converted = eng_to_kor(q)
    elif all(0xAC00 <= ord(c) <= 0xD7A3 or 0x3131 <= ord(c) <= 0x3163 for c in stripped):
        converted = kor_to_eng(q)
    else:
        return None
    converted = (converted or "").strip()
    if not converted or converted == q:
        return None
    return converted


async def _log_search(mongo, q: str, mode: str, payload: dict, user_id: Optional[str]) -> None:
    """v169 — best-effort search-log insert (Mongo `search_logs`).

    Stores the raw query for offline relevance analysis (the collection is the
    one sanctioned place for raw queries; app logs still log q_len only). Any
    failure is swallowed with a warning — the search response is never affected.
    """
    try:
        tracks = payload.get("tracks") or []
        pagination = payload.get("pagination") or {}
        entry = {
            "q": q,
            "q_len": len(q),
            "mode": mode,
            "result_count": int(pagination.get("total", len(tracks))),
            "top_ids": [str(t.get("id")) for t in tracks[:10] if t and t.get("id")],
            "created_at": datetime.now(timezone.utc),
        }
        if user_id:
            entry["user_id"] = user_id
        await mongo.search_logs.insert_one(entry)
        logger.info(
            "[search.log] mode=%s q_len=%d results=%d user=%s",
            mode, len(q), entry["result_count"], "y" if user_id else "n",
        )
    except Exception as e:
        logger.warning("[search.log] insert failed q_len=%d: %s", len(q), e)


@router.get("/search")
async def search_tracks(
    q: str = Query(None),
    page: int = 1,
    limit: int = 20,
    pg=Depends(get_pg),
    current_user=Depends(get_current_user_optional),
):
    """Hybrid track search endpoint. Response shape unchanged: {tracks, pagination}.

    v169 additions on top of _hybrid_search_core:
      - zero-result + single-script query -> ONE internal retry with the 한/영
        키보드 변환 query (mode=retry_engkor:<inner_mode>); the retry result is
        returned only when it actually has hits.
      - best-effort search_logs insert (raw q stored for relevance analysis).
    Empty q -> 400 (unchanged).
    """
    if not q:
        return JSONResponse(status_code=400, content={"error": "검색어를 입력해주세요."})

    mongo = get_mongo()
    payload, mode = await _hybrid_search_core(mongo, pg, q, page, limit)

    # --- v169: wrong-IME (한/영키) fallback — single retry, no recursion ---
    if int((payload.get("pagination") or {}).get("total", 0)) == 0:
        converted = _engkor_retry_query(q)
        if converted:
            logger.info(
                "[tracks.search] mode=retry_engkor q_len=%d converted_len=%d",
                len(q), len(converted),
            )
            retry_payload, retry_mode = await _hybrid_search_core(
                mongo, pg, converted, page, limit
            )
            if int((retry_payload.get("pagination") or {}).get("total", 0)) > 0:
                payload, mode = retry_payload, f"retry_engkor:{retry_mode}"

    user_id = None
    if current_user:
        user_id = str(current_user.get("id") or current_user.get("user_id") or "") or None
    await _log_search(mongo, q, mode, payload, user_id)

    return payload


class SearchClickBody(BaseModel):
    q: str
    track_id: str


@router.post("/search/click")
async def record_search_click(
    body: SearchClickBody,
    current_user=Depends(get_current_user_optional),
):
    """v169 — search-result click log (Mongo `search_clicks`), auth optional.

    Feeds the offline relevance evaluation (CTR@rank / golden-set mining).
    Insert is best-effort but validation failures return 400.
    """
    track_id = (body.track_id or "").strip()
    if not track_id:
        return JSONResponse(status_code=400, content={"error": "track_id가 필요합니다."})

    q = (body.q or "").strip()
    user_id = None
    if current_user:
        user_id = str(current_user.get("id") or current_user.get("user_id") or "") or None

    mongo = get_mongo()
    try:
        entry = {
            "q": q,
            "track_id": track_id,
            "created_at": datetime.now(timezone.utc),
        }
        if user_id:
            entry["user_id"] = user_id
        await mongo.search_clicks.insert_one(entry)
        logger.info("[search.click] q_len=%d track=%s user=%s", len(q), track_id, "y" if user_id else "n")
    except Exception as e:
        logger.warning("[search.click] insert failed track=%s: %s", track_id, e)
    return {"ok": True}


class TrackUpdateBody(BaseModel):
    title: Optional[str] = None
    genre: Optional[List[str]] = None
    mood: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    prompt: Optional[str] = None
    ai_model: Optional[str] = None
    is_public: Optional[bool] = None
    cover_image_url: Optional[str] = None


@router.get("/my")
async def get_my_tracks(
    page: int = 1,
    limit: int = 20,
    sort: str = "created_at",
    current_user=Depends(get_current_user),
):
    """Get current user's uploaded tracks (including hidden ones)."""
    mongo = get_mongo()
    query = {"uploader_id": current_user["id"]}

    sort_field = sort if sort in ("created_at", "play_count", "like_count") else "created_at"

    total = await mongo.tracks.count_documents(query)
    cursor = (
        mongo.tracks.find(query)
        .sort(sort_field, -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    tracks = await cursor.to_list(length=limit)

    return {
        "tracks": _serialize_tracks(tracks),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


async def purge_track_document(doc: dict, conn) -> dict:
    """v138 — 트랙 완전 파기(재사용 함수). 소유자 DELETE 라우트와
    admin confirm_delete(신고 확정 삭제)가 공용으로 호출한다.

    파기 대상(각 단계 best-effort — 실패해도 다음 단계 진행):
      MinIO: 오디오(music 버킷) + 커버(images 버킷, object name 저장분만)
             + 공유영상 캐시 share/v3 3종(music 버킷)
      Mongo: tracks 도큐먼트
      Redis: cache:track(v1/v2) + playcount 버퍼 + 차트 캐시(cache:chart:*)
      ES:    tracks 색인 문서
      PG:    track_embeddings, likes
      기타:  소유자 앨범 카스케이드(v69 — track id pull 후 빈 앨범 삭제)

    Args:
        doc: Mongo tracks 도큐먼트 (find_one 결과 원본, `_id` 포함).
        conn: asyncpg connection (embeddings/likes 삭제용).
    Returns:
        {"track_id", "owner_id", "removed": [단계 태그]} — 감사 로그용.
    """
    mongo = get_mongo()
    track_id = str(doc["_id"])
    owner_id = doc.get("uploader_id")
    removed = []

    minio_client = get_minio()

    # MinIO — 오디오
    audio_url = doc.get("audio_url")
    if audio_url:
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_music, object_name=audio_url
            )
            removed.append("audio")
        except Exception:
            pass  # Continue even if MinIO deletion fails

    # MinIO — 커버 (object name 저장분만 — http(s) 외부 URL 은 스킵)
    cover = doc.get("cover_image_url")
    if cover and not str(cover).startswith("http"):
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images, object_name=cover
            )
            removed.append("cover")
        except Exception:
            pass

    # MinIO — 공유영상 캐시 (v126/v129 — share/v3/{id}[ _wide|_kakao ].mp4)
    try:
        from ..services.share_video import FORMATS, share_object_name
        for fmt in FORMATS:
            try:
                minio_client.remove_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=share_object_name(track_id, fmt),
                )
            except Exception:
                pass
        removed.append("share_video")
    except Exception:
        pass

    # Mongo 도큐먼트
    await mongo.tracks.delete_one({"_id": doc["_id"]})
    removed.append("mongo")

    # Redis 캐시 (legacy v1 + current v2) + playcount 버퍼
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"cache:track:v2:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # 차트 캐시(TTL 300s) 즉시 무효화 — 삭제 곡 차트 잔존 방지
    try:
        chart_keys = [k async for k in redis.scan_iter(match="cache:chart:*")]
        if chart_keys:
            await redis.delete(*chart_keys)
    except Exception:
        logger.warning("[TrackDelete] chart cache invalidate failed track=%s", track_id)

    # ES 문서 제거
    try:
        from ..services.search_service import es_delete_track
        if await es_delete_track(track_id):
            removed.append("es")
    except Exception:
        logger.warning("[TrackDelete] es delete failed track=%s", track_id)

    # PG — 임베딩 + 좋아요
    try:
        await conn.execute("DELETE FROM track_embeddings WHERE track_id = $1", track_id)
        removed.append("embedding")
    except Exception:
        logger.warning("[TrackDelete] embedding delete failed track=%s", track_id)
    try:
        await conn.execute("DELETE FROM likes WHERE track_id = $1", track_id)
        removed.append("likes")
    except Exception:
        logger.warning("[TrackDelete] likes delete failed track=%s", track_id)

    # v69 — cascade: pull this track id from owner's albums, then delete
    # any albums that ended up empty.
    if owner_id:
        affected = await mongo.albums.update_many(
            {"track_ids": track_id, "owner_id": owner_id},
            {"$pull": {"track_ids": track_id}},
        )
        deleted = await mongo.albums.delete_many({
            "owner_id": owner_id,
            "track_ids": {"$size": 0},
        })
        logger.info(
            "[TrackDelete] cascade track=%s affected_albums=%d deleted_albums=%d",
            track_id, affected.modified_count, deleted.deleted_count,
        )

    logger.info(
        "[TrackDelete] purge ok track=%s owner=%s removed=%s",
        track_id, str(owner_id)[:8] if owner_id else "?", ",".join(removed),
    )
    return {"track_id": track_id, "owner_id": owner_id, "removed": removed}


@router.delete("/{track_id}")
async def delete_track(
    track_id: str,
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """Delete own track — 파기 로직은 purge_track_document (v138 공용 함수)."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 삭제할 수 있습니다."})

    await purge_track_document(doc, conn)

    return {"message": "트랙이 삭제되었습니다."}


@router.put("/{track_id}")
async def update_track(
    track_id: str,
    body: TrackUpdateBody,
    current_user=Depends(get_current_user),
):
    """Update own track metadata."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 수정할 수 있습니다."})

    # v137 — 신고 블라인드 트랙은 소유자가 재공개(공개 전환) 불가
    if body.is_public is True and doc.get("report_blinded"):
        logger.info("[report] track republish_blocked track=%s owner=%s", track_id[:8], current_user["id"][:8])
        return JSONResponse(status_code=400, content={"error": "신고 처리로 제한된 콘텐츠입니다."})

    # Build update dict from non-None fields
    update_data = {k: v for k, v in body.dict().items() if v is not None}
    if not update_data:
        return JSONResponse(status_code=400, content={"error": "수정할 항목이 없습니다."})

    update_data["updated_at"] = datetime.now(timezone.utc)

    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": update_data},
    )

    # Clear Redis cache (both legacy v1 and current v2 keys)
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"cache:track:v2:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # Fetch and return updated document
    updated_doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    return _serialize_track(updated_doc)


@router.get("/{track_id}/music-video")
async def get_track_music_video(track_id: str):
    """Return presigned URL for the track's music video, or 404 if none exists."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"generation_id": 1})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    mv_job = await _find_completed_mv(mongo, doc.get("generation_id"))
    if not mv_job:
        return JSONResponse(status_code=404, content={"error": "뮤직비디오를 찾을 수 없습니다."})

    mv_url = _mv_presigned_url(mv_job.get("result_music_video_url"))
    if not mv_url:
        return JSONResponse(status_code=404, content={"error": "뮤직비디오 파일을 찾을 수 없습니다."})

    return {"has_music_video": True, "music_video_url": mv_url}


# v149 — Line-level lyric timeline for live cover+lyrics "가사싱크 영상".
# Reuses share_video._fetch_lyric_segments (single source of truth) so the
# playback timing matches the SNS/download burn-in video exactly.
@router.get("/{track_id}/lyrics-timeline")
async def get_track_lyrics_timeline(track_id: str):
    """Return line-level lyric segments for a track (unauthenticated, public playback).

    Response: {"has_timestamps": bool, "segments": [{"text","start","end"}], "source": str}
    """
    logger.info("[lyrics-timeline] track=%s", track_id[:8] if track_id else "?")
    try:
        if not ObjectId.is_valid(track_id):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

        mongo = get_mongo()
        doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
        if not doc:
            return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

        from ..services.share_video import _fetch_lyric_segments

        segments = await _fetch_lyric_segments(mongo, doc)
        has_timestamps = len(segments) > 0
        source = "timestamps" if has_timestamps else "none"
        logger.info(
            "[lyrics-timeline] track=%s has=%s count=%d",
            track_id[:8] if track_id else "?", has_timestamps, len(segments),
        )
        return {"has_timestamps": has_timestamps, "segments": segments, "source": source}
    except Exception:
        logger.exception(
            "[lyrics-timeline] failed track=%s", track_id[:8] if track_id else "?"
        )
        return {"has_timestamps": False, "segments": [], "source": "none"}


# v44 — Beat extraction status & retry for tracks
def _serialize_track_beats_payload(doc: dict) -> dict:
    started = doc.get("beats_started_at")
    completed = doc.get("beats_completed_at")
    return {
        "status": doc.get("beats_status") or "pending",
        "tempo": doc.get("tempo"),
        "beats": doc.get("beats") or [],
        "downbeats": doc.get("downbeats") or [],
        "started_at": started.isoformat() if isinstance(started, datetime) else None,
        "completed_at": completed.isoformat() if isinstance(completed, datetime) else None,
        "error": doc.get("beats_error"),
    }


@router.get("/{track_id}/beats")
async def get_track_beats(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Return beat extraction status + data for a track. Public tracks accessible to anyone authenticated."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    is_owner = doc.get("uploader_id") == current_user["id"]
    if not is_owner and not doc.get("is_public", True):
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    return _serialize_track_beats_payload(doc)


@router.post("/{track_id}/beats/retry")
async def retry_track_beats(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Reset and re-trigger beat extraction for a track (owner only)."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})
    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "자신의 트랙만 재시도할 수 있습니다."})
    if not doc.get("audio_url"):
        return JSONResponse(status_code=400, content={"error": "오디오 파일이 없습니다."})

    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": {
            "beats_status": "pending",
            "beats_error": None,
            "beats_started_at": None,
            "beats_completed_at": None,
            "tempo": None,
            "beats": [],
            "downbeats": [],
        }},
    )

    import asyncio as _asyncio
    from ..services.beat_extraction import detect_beats_for_track
    _asyncio.create_task(detect_beats_for_track(track_id))

    return {"message": "비트 재추출이 시작되었습니다.", "status": "pending"}


@router.get("/stream-proxy/{track_id}")
async def stream_track_proxy(
    track_id: str,
    token: Optional[str] = Query(None),
    current_user=Depends(get_current_user_optional),
):
    """모바일 클라이언트용: MinIO 오디오를 직접 프록시 스트리밍.

    v138 직링크 가드 — 비공개·블라인드 트랙은 소유자(또는 admin) 외 404.
    앱 클라이언트는 <audio src> 에 헤더를 못 실으므로 ?token= 쿼리도 허용.
    """
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"audio_url": 1, "uploader_id": 1, "is_public": 1, "report_blinded": 1},
    )
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    if _is_hidden_track(doc):
        viewer = current_user
        if viewer is None and token:
            try:
                import jwt as _jwt
                from ..auth import JWT_SECRET, JWT_ALGORITHM
                payload = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": True})
                viewer = {"id": payload.get("id"), "role": payload.get("role")}
            except Exception:
                viewer = None
        if not _can_view_hidden_track(doc, viewer):
            logger.info("[report] track stream_proxy_denied track=%s", track_id[:8])
            return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
        )
        content_type = "audio/mpeg"
        if doc["audio_url"].endswith(".wav"):
            content_type = "audio/wav"
        elif doc["audio_url"].endswith(".ogg"):
            content_type = "audio/ogg"
        elif doc["audio_url"].endswith(".flac"):
            content_type = "audio/flac"
        elif doc["audio_url"].endswith(".m4a"):
            content_type = "audio/mp4"

        return StreamingResponse(
            response,
            media_type=content_type,
            headers={"Accept-Ranges": "bytes"},
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})


# RelatedTracks — vector NN over-fetch headroom beyond limit+exclude count.
_RELATED_EXTRA_K = 10


@router.get("/{track_id}/related")
async def get_related_tracks(
    track_id: str,
    exclude: str = Query(None),
    limit: int = 1,
    pg=Depends(get_pg),
):
    """관련곡 추천 (무인증).

    1차: pgvector NN (기존 track_embeddings 의 seed 임베딩 직조회 — 신규 임베딩 API 호출 없음)
    2차: 같은 genre 공개 트랙 play_count DESC
    3차: 전체 공개 트랙 play_count DESC
    Seed 가 Mongo 에 없으면(비ObjectId 포함) 404, 그 외 내부 실패는 폴백으로 흡수해 항상 200.
    응답: {"tracks": [...], "source": "vector"|"genre"|"popular"|"mixed"}
    """
    # limit clamp: default 1, max 5
    limit = max(1, min(limit, 5))

    # exclude: comma-separated track ids
    exclude_ids = set()
    if exclude:
        exclude_ids = {tid.strip() for tid in exclude.split(",") if tid.strip()}
    exclude_ids.discard(track_id)

    logger.info("[related] enter track=%s exclude=%d limit=%d", track_id, len(exclude_ids), limit)

    mongo = get_mongo()

    # Seed track must exist (non-ObjectId -> same 404)
    if not ObjectId.is_valid(track_id):
        logger.info("[related] track=%s invalid object id -> 404", track_id)
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})
    try:
        seed_doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    except Exception:
        logger.exception("[related] track=%s seed lookup failed", track_id)
        return {"tracks": [], "source": "popular"}
    if not seed_doc:
        logger.info("[related] track=%s not found -> 404", track_id)
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    picked: list = []          # serialized track dicts, in final order
    picked_ids: set = set()    # str ids already picked (dedupe across stages)
    sources_used: list = []    # stage names in the order they contributed

    def _skip_ids() -> set:
        return exclude_ids | picked_ids | {track_id}

    # ── 1차: pgvector NN from the stored seed embedding ──────────────────────
    try:
        row = await pg.fetchrow(
            "SELECT embedding FROM track_embeddings WHERE track_id = $1", track_id
        )
        if row is None or row["embedding"] is None:
            logger.warning("[related] track=%s no stored embedding, fallback to genre", track_id)
        else:
            k = limit + len(exclude_ids) + _RELATED_EXTRA_K
            rows = await pg.fetch(
                """
                SELECT track_id, 1 - (embedding <=> $1::vector) AS score
                FROM track_embeddings
                WHERE track_id != $2
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                row["embedding"],
                track_id,
                k,
            )
            cand_ids = [
                r["track_id"] for r in rows
                if r["track_id"] not in _skip_ids() and ObjectId.is_valid(r["track_id"])
            ]
            logger.info(
                "[related] track=%s vector hits=%d candidates=%d k=%d",
                track_id, len(rows), len(cand_ids), k,
            )
            if cand_ids:
                rank_by_id = {tid: i for i, tid in enumerate(cand_ids)}
                cursor = mongo.tracks.find({
                    "_id": {"$in": [ObjectId(tid) for tid in cand_ids]},
                    "is_public": True,
                })
                docs = await cursor.to_list(length=len(cand_ids))
                docs.sort(key=lambda d: rank_by_id.get(str(d["_id"]), len(rank_by_id)))
                for d in docs[:limit]:
                    picked_ids.add(str(d["_id"]))
                    picked.append(_serialize_track(d))
                if picked:
                    sources_used.append("vector")
    except Exception:
        logger.exception("[related] track=%s vector stage failed, fallback", track_id)

    # ── 2차: same-genre public tracks by play_count DESC ─────────────────────
    if len(picked) < limit:
        try:
            seed_genre = seed_doc.get("genre")
            if seed_genre:
                logger.info(
                    "[related] track=%s genre fallback enter have=%d need=%d",
                    track_id, len(picked), limit - len(picked),
                )
                genre_cond = {"$in": list(seed_genre)} if isinstance(seed_genre, (list, tuple)) else seed_genre
                skip_oids = [ObjectId(tid) for tid in _skip_ids() if ObjectId.is_valid(tid)]
                need = limit - len(picked)
                cursor = mongo.tracks.find({
                    "is_public": True,
                    "genre": genre_cond,
                    "_id": {"$nin": skip_oids},
                }).sort("play_count", -1).limit(need)
                docs = await cursor.to_list(length=need)
                for d in docs:
                    picked_ids.add(str(d["_id"]))
                    picked.append(_serialize_track(d))
                if docs:
                    sources_used.append("genre")
            else:
                logger.info("[related] track=%s seed has no genre, skip genre fallback", track_id)
        except Exception:
            logger.exception("[related] track=%s genre stage failed, fallback", track_id)

    # ── 3차: overall popular public tracks by play_count DESC ────────────────
    if len(picked) < limit:
        try:
            logger.info(
                "[related] track=%s popular fallback enter have=%d need=%d",
                track_id, len(picked), limit - len(picked),
            )
            skip_oids = [ObjectId(tid) for tid in _skip_ids() if ObjectId.is_valid(tid)]
            need = limit - len(picked)
            cursor = mongo.tracks.find({
                "is_public": True,
                "_id": {"$nin": skip_oids},
            }).sort("play_count", -1).limit(need)
            docs = await cursor.to_list(length=need)
            for d in docs:
                picked_ids.add(str(d["_id"]))
                picked.append(_serialize_track(d))
            if docs:
                sources_used.append("popular")
        except Exception:
            logger.exception("[related] track=%s popular stage failed", track_id)

    source = sources_used[0] if len(sources_used) == 1 else ("mixed" if sources_used else "popular")
    logger.info("[related] track=%s done n=%d source=%s", track_id, len(picked), source)
    return {"tracks": picked, "source": source}


@router.get("/{track_id}")
async def get_track(
    track_id: str,
    pg=Depends(get_pg),
    current_user=Depends(get_current_user_optional),
):
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    redis = get_redis()
    mongo = get_mongo()

    # Check Redis cache (v2: schema bumped to include cover_character)
    cached = await redis.get(f"cache:track:v2:{track_id}")
    if cached:
        track = json.loads(cached)
        # v138 직링크 가드 — 캐시 히트 경로에도 동일 적용 (캐시 데이터는 전체
        # 도큐먼트 직렬화라 is_public/report_blinded 포함 — 스키마 승격 불필요)
        if _is_hidden_track(track) and not _can_view_hidden_track(track, current_user):
            logger.info("[report] track direct_link_denied track=%s cached=1", track_id[:8])
            return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)
        # Increment playcount buffer
        await redis.incr(f"playcount:buffer:{track_id}")
        # uploader_profile_image 는 캐시 밖에서 항상 fresh 하게 첨부
        await _attach_uploader_profiles([track], pg)
        return track

    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    # v138 직링크 가드 — 비공개·블라인드 트랙은 소유자(또는 admin) 외 404
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, current_user):
        logger.info("[report] track direct_link_denied track=%s cached=0", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    track = _serialize_track(doc)

    # Look up linked completed mv_job once; reuse for both music_video and cover_character.
    mv_job = None
    try:
        mv_job = await _find_completed_mv(mongo, track.get("generation_id"))
    except Exception:
        logger.exception("[TrackCoverChar] mv_job lookup failed track=%s", track_id)
        mv_job = None

    # Attach music video info
    if mv_job:
        track["has_music_video"] = True
        track["music_video_url"] = _mv_presigned_url(mv_job.get("result_music_video_url"))
    else:
        track["has_music_video"] = False
        track["music_video_url"] = None

    # Build cover_character (only when mv_job opted in and snapshot exists)
    cover_character = None
    try:
        logger.info(
            "[TrackCoverChar] track=%s mv_job=%s include=%s items=%d",
            track_id,
            str(mv_job.get("_id")) if mv_job else None,
            bool(mv_job and mv_job.get("include_my_character")),
            len((mv_job.get("user_character_snapshot") or {}).get("used_items") or []) if mv_job else 0,
        )
        # v71: mv_job 의 snapshot 이 1순위, 없으면 트랙 도큐먼트 자체의 snapshot 으로 fallback
        # (MV 없이 cover 만 만든 곡도 cover_character 노출 가능).
        snap_source = None
        if (
            mv_job
            and mv_job.get("include_my_character") is True
            and mv_job.get("user_character_snapshot")
        ):
            snap_source = mv_job.get("user_character_snapshot")
        elif track.get("user_character_snapshot"):
            snap_source = track.get("user_character_snapshot")
            logger.info("[TrackCoverChar] fallback to track snapshot track=%s", track_id)

        if snap_source:
            snap = snap_source or {}
            cover_character = {
                "name": snap.get("name") or "",
                "age": snap.get("age") or "",
                "personality_tags": snap.get("personality_tags") or [],
                "personality_text": snap.get("personality_text") or "",
                "sheet_preview_path": (
                    "/api/character/preview/" + snap["sheet_object_name"]
                    if snap.get("sheet_object_name") else None
                ),
                "used_items": [
                    {
                        "id": it.get("id"),
                        "name": it.get("name") or "",
                        "image_object_name": it.get("image_object_name") or "",
                        "product_url": it.get("product_url"),
                        "category": it.get("category"),
                    }
                    for it in (snap.get("used_items") or [])
                ],
            }
    except Exception:
        logger.exception("[TrackCoverChar] failed track=%s", track_id)
        cover_character = None

    track["cover_character"] = cover_character

    # Increment playcount buffer in Redis
    await redis.incr(f"playcount:buffer:{track_id}")

    # Cache for 10 minutes (v2 key)
    await redis.setex(f"cache:track:v2:{track_id}", 600, json.dumps(track, default=str))

    # uploader_profile_image 는 캐시에 넣지 않고 매 요청 fresh 첨부
    await _attach_uploader_profiles([track], pg)

    return track


@router.post("/upload", status_code=201)
async def upload_track(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    genre: str = Form(None),
    mood: str = Form(None),
    tags: str = Form(None),
    categories: str = Form(None),  # v77: comma-separated 고정 카테고리
    ai_model: str = Form(None),
    prompt: str = Form(None),
    bpm: int = Form(None),
    key: str = Form(None),
    language: str = Form(None),
    lyrics: str = Form(None),
    is_public: bool = Form(True),
    current_user=Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB 이하여야 합니다."})

    # Generate track ID
    track_id = ObjectId()
    uploader_id = current_user["id"]

    # Upload to MinIO
    minio_client = get_minio()
    object_name = f"tracks/{uploader_id}/{str(track_id)}{ext}"
    content_type = mimetypes.guess_type(file.filename or "")[0] or "audio/mpeg"
    minio_client.put_object(
        bucket_name=settings.minio_bucket_music,
        object_name=object_name,
        data=io.BytesIO(contents),
        length=len(contents),
        content_type=content_type,
    )

    # Extract duration with mutagen
    duration_sec = 0
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        from mutagen import File as MutagenFile
        audio = MutagenFile(tmp_path)
        if audio and audio.info:
            duration_sec = int(audio.info.length)
        os.unlink(tmp_path)
    except Exception:
        pass

    # Parse comma-separated fields into arrays
    genre_list = [g.strip() for g in genre.split(",") if g.strip()] if genre else []
    mood_list = [m.strip() for m in mood.split(",") if m.strip()] if mood else []
    tags_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    # v77 — categories: comma-separated 받아 화이트리스트 필터.
    from ..constants.categories import filter_categories
    cats_raw = [c.strip() for c in categories.split(",") if c.strip()] if categories else []
    categories_list = filter_categories(cats_raw)

    now = datetime.now(timezone.utc)
    doc = {
        "_id": track_id,
        "title": title,
        "uploader_id": uploader_id,
        "uploader_nickname": current_user.get("nickname", ""),
        "ai_model": ai_model,
        "prompt": prompt,
        "ai_model_version": None,
        "genre": genre_list,
        "mood": mood_list,
        "tags": tags_list,
        "categories": categories_list,
        "bpm": bpm,
        "key": key,
        "duration_sec": duration_sec,
        "language": language,
        "audio_url": object_name,
        "cover_image_url": None,
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": is_public,
        "created_at": now,
        "updated_at": now,
        # v44 — beat extraction status (background task fires after insert)
        "beats_status": "pending",
        "tempo": None,
        "beats": [],
        "downbeats": [],
        "beats_started_at": None,
        "beats_completed_at": None,
        "beats_error": None,
    }

    mongo = get_mongo()
    await mongo.tracks.insert_one(doc)
    logger.info("[tracks] publish track_id=%s cats=%s", str(track_id), categories_list)

    # StarEcon(v158) — 발매 보상 ⭐+5 (best-effort, never affects the upload).
    # day="-" + ref=track_id → 트랙당 영구 1회 멱등 (재호출/재발매 중복 없음).
    try:
        from ..services.points_service import credit_points
        await credit_points(uploader_id, "upload", 5, ref=str(track_id), day="-")
        logger.info("[star-econ] upload +5 user=%s track=%s", uploader_id[:8], str(track_id))
    except Exception as e:
        logger.warning("[star-econ] upload hook failed: %s", e)

    # v44 — fire-and-forget beat extraction in a fresh event loop
    from ..services.beat_extraction import run_track_beat_extraction_in_background
    background_tasks.add_task(run_track_beat_extraction_in_background, str(track_id))

    # HybridSearch — unified enrich+index hook (best-effort, ordered):
    # concept keywords → Mongo search_keywords → pgvector re-embed → ES mirror.
    from ..services.embedding_service import enrich_and_index_track_in_background
    background_tasks.add_task(enrich_and_index_track_in_background, str(track_id))

    return _serialize_track(doc)


class UploadFromGenerationBody(BaseModel):
    generation_id: str
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    tags: Optional[str] = None
    categories: Optional[List[str]] = None  # v77: 고정 카테고리 (list 또는 comma-string)
    prompt: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None
    mv_object_name: Optional[str] = None
    ai_model: Optional[str] = "Suno"
    use_voice_converted: Optional[bool] = False
    # v71: MV 안 만들고 cover 만 만든 곡도 cover_character 노출 가능하도록
    # publish 시점의 사용자 캐릭터 snapshot 을 트랙 도큐먼트에 박음.
    # 구조는 mv_jobs.user_character_snapshot 와 동일.
    user_character_snapshot: Optional[dict] = None
    # v74: 두 클립 variant 중 어느 것을 트랙으로 업로드할지 선택
    # 0 = result_audio_url (BC), >=1 = variants[variant_index].audio_url
    variant_index: Optional[int] = 0


@router.post("/upload-from-generation", status_code=201)
async def upload_from_generation(
    body: UploadFromGenerationBody,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Create a track from a completed AI generation."""
    if not ObjectId.is_valid(body.generation_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 생성 ID입니다."})

    mongo = get_mongo()

    # Find generation and verify ownership
    gen_doc = await mongo.generations.find_one({"_id": ObjectId(body.generation_id)})
    if not gen_doc:
        return JSONResponse(status_code=404, content={"error": "생성 요청을 찾을 수 없습니다."})
    if gen_doc.get("user_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})
    if gen_doc.get("status") != "completed":
        return JSONResponse(status_code=400, content={"error": "완료된 생성 요청만 업로드할 수 있습니다."})
    if not gen_doc.get("result_audio_url"):
        return JSONResponse(status_code=400, content={"error": "생성된 오디오 파일이 없습니다."})

    # v74 — Determine audio source: voice converted or specific variant
    import logging as _logging
    _log = _logging.getLogger(__name__)
    variant_index = body.variant_index or 0
    if variant_index < 0:
        return JSONResponse(status_code=400, content={"error": "variant_index는 0 이상이어야 합니다."})
    if variant_index > 0 and body.use_voice_converted:
        return JSONResponse(
            status_code=400,
            content={"error": "보이스 변환은 첫 번째 클립(variant 0)에만 사용할 수 있습니다."},
        )

    if body.use_voice_converted:
        vc_url = gen_doc.get("voice_converted_url")
        if not vc_url:
            return JSONResponse(status_code=400, content={"error": "보이스 변환된 오디오 파일이 없습니다."})
        source_object_name = vc_url
    else:
        gen_variants = gen_doc.get("variants") or []
        if variant_index == 0:
            if gen_variants and len(gen_variants) > 0:
                source_object_name = gen_variants[0].get("audio_url") or gen_doc["result_audio_url"]
            else:
                source_object_name = gen_doc["result_audio_url"]
        else:
            if not gen_variants or variant_index >= len(gen_variants):
                _log.warning(
                    "[UploadVariant] gen=%s variant=%d out of range (have=%d)",
                    body.generation_id, variant_index, len(gen_variants),
                )
                return JSONResponse(
                    status_code=400,
                    content={"error": f"variant {variant_index} 범위를 벗어났습니다."},
                )
            source_object_name = gen_variants[variant_index].get("audio_url")
            if not source_object_name:
                return JSONResponse(
                    status_code=400,
                    content={"error": "선택한 variant에 오디오가 없습니다."},
                )

    _log.info(
        "[UploadVariant] gen=%s variant=%d source=%s use_vc=%s",
        body.generation_id, variant_index, source_object_name, bool(body.use_voice_converted),
    )

    track_id = ObjectId()
    uploader_id = current_user["id"]

    # Determine extension from source
    ext = ".wav" if source_object_name.endswith(".wav") else ".mp3"
    dest_object_name = f"tracks/{uploader_id}/{str(track_id)}{ext}"

    # Copy audio file in MinIO (get + put since copy_object requires CopySource)
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=source_object_name,
        )
        audio_data = response.read()
        response.close()
        response.release_conn()

        content_type = "audio/wav" if ext == ".wav" else "audio/mpeg"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_music,
            object_name=dest_object_name,
            data=io.BytesIO(audio_data),
            length=len(audio_data),
            content_type=content_type,
        )
    except Exception:
        return JSONResponse(status_code=500, content={"error": "오디오 파일 복사에 실패했습니다."})

    # Extract duration with mutagen
    duration_sec = 0
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name
        from mutagen import File as MutagenFile
        audio = MutagenFile(tmp_path)
        if audio and audio.info:
            duration_sec = int(audio.info.length)
        os.unlink(tmp_path)
    except Exception:
        pass

    # Parse comma-separated fields into arrays
    genre_list = [g.strip() for g in body.genre.split(",") if g.strip()] if body.genre else []
    mood_list = [m.strip() for m in body.mood.split(",") if m.strip()] if body.mood else []
    tags_list = [t.strip() for t in body.tags.split(",") if t.strip()] if body.tags else []

    # v77 — categories: body 우선(없으면 generation doc fallback), 항상 화이트리스트 필터.
    # body.categories 는 list 또는 comma-separated string 모두 허용.
    from ..constants.categories import filter_categories
    if isinstance(body.categories, str):
        cats_source = [c.strip() for c in body.categories.split(",") if c.strip()]
    elif isinstance(body.categories, list):
        cats_source = body.categories
    else:
        cats_source = gen_doc.get("categories")
    categories_list = filter_categories(cats_source)

    now = datetime.now(timezone.utc)

    # SnapFix — 발행 시점의 캐릭터 시트를 불변 경로(character_snapshots/)로
    # 복사해 이후 캐릭터 재생성/삭제로부터 곡 표시를 격리한다.
    # best-effort: 복사 실패 시 원본 경로 그대로 저장 — 발행은 절대 실패하지 않는다.
    user_character_snapshot = body.user_character_snapshot
    if user_character_snapshot and user_character_snapshot.get("sheet_object_name"):
        from ..services.snapshot_service import snapshot_sheet_copy

        _origin_sheet = user_character_snapshot.get("sheet_object_name")
        _copied_sheet = snapshot_sheet_copy(minio_client, uploader_id, _origin_sheet)
        if _copied_sheet:
            user_character_snapshot = dict(user_character_snapshot)
            user_character_snapshot["sheet_object_name"] = _copied_sheet
            user_character_snapshot["sheet_object_name_origin"] = _origin_sheet
        logger.info(
            "[SnapFix] track publish user=%s track_id=%s copied=%s",
            uploader_id, str(track_id), bool(_copied_sheet),
        )

    # v44 — Inherit beats from the generation if already extracted, otherwise
    # mark pending and fire background extraction.
    # v74 — beats are extracted only from variant 0 (first clip). For variant>0
    # do not inherit; trigger fresh extraction in background.
    gen_beats_status = gen_doc.get("beats_status")
    inherit_beats = (
        variant_index == 0
        and gen_beats_status == "completed"
        and gen_doc.get("beats")
    )
    if inherit_beats:
        beats_fields = {
            "beats_status": "completed",
            "tempo": gen_doc.get("tempo"),
            "beats": gen_doc.get("beats") or [],
            "downbeats": gen_doc.get("downbeats") or [],
            "beats_started_at": gen_doc.get("beats_started_at"),
            "beats_completed_at": gen_doc.get("beats_completed_at"),
            "beats_error": None,
        }
    else:
        beats_fields = {
            "beats_status": "pending",
            "tempo": None,
            "beats": [],
            "downbeats": [],
            "beats_started_at": None,
            "beats_completed_at": None,
            "beats_error": None,
        }

    doc = {
        "_id": track_id,
        "title": body.title,
        "uploader_id": uploader_id,
        "uploader_nickname": current_user.get("nickname", ""),
        "ai_model": body.ai_model,
        "prompt": body.prompt,
        "ai_model_version": None,
        "genre": genre_list,
        "mood": mood_list,
        "tags": tags_list,
        "categories": categories_list,
        "bpm": gen_doc.get("bpm"),
        "key": gen_doc.get("key"),
        "duration_sec": duration_sec,
        "language": None,
        "lyrics": body.lyrics,
        "audio_url": dest_object_name,
        "cover_image_url": body.cover_object_name,
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": True,
        "generation_id": str(gen_doc["_id"]),
        "variant_index": variant_index,  # v74
        "user_character_snapshot": user_character_snapshot,
        "created_at": now,
        "updated_at": now,
        **beats_fields,
    }

    await mongo.tracks.insert_one(doc)
    _log.info(
        "[UploadVariant] gen=%s variant=%d track_id=%s inserted",
        body.generation_id, variant_index, str(track_id),
    )
    logger.info("[tracks] publish track_id=%s cats=%s", str(track_id), categories_list)

    # StarEcon(v158) — 발매 보상 ⭐+5 (best-effort, never affects the upload).
    # day="-" + ref=track_id → 트랙당 영구 1회 멱등 (재호출/재발매 중복 없음).
    try:
        from ..services.points_service import credit_points
        await credit_points(uploader_id, "upload", 5, ref=str(track_id), day="-")
        logger.info("[star-econ] upload +5 user=%s track=%s", uploader_id[:8], str(track_id))
    except Exception as e:
        logger.warning("[star-econ] upload hook failed: %s", e)

    # Update generation with result_track_id
    await mongo.generations.update_one(
        {"_id": ObjectId(body.generation_id)},
        {"$set": {"result_track_id": str(track_id), "updated_at": now}},
    )

    # v44 — Trigger background extraction only if we couldn't inherit
    if not inherit_beats:
        from ..services.beat_extraction import run_track_beat_extraction_in_background
        background_tasks.add_task(run_track_beat_extraction_in_background, str(track_id))

    # HybridSearch — unified enrich+index hook (best-effort, ordered):
    # concept keywords → Mongo search_keywords → pgvector re-embed → ES mirror.
    from ..services.embedding_service import enrich_and_index_track_in_background
    background_tasks.add_task(enrich_and_index_track_in_background, str(track_id))

    return _serialize_track(doc)


@router.get("/stream/{track_id}")
async def stream_track(
    track_id: str,
    current_user=Depends(get_current_user_optional),
):
    """Return a presigned URL for streaming the track from MinIO."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"audio_url": 1, "uploader_id": 1, "is_public": 1, "report_blinded": 1},
    )
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # v138 직링크 가드 — 비공개·블라인드 트랙 스트림은 소유자(또는 admin) 외 404
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, current_user):
        logger.info("[report] track stream_denied track=%s", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    minio_client = get_minio()
    try:
        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
            expires=timedelta(hours=1),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    return {"stream_url": url}


@router.post("/download/{track_id}")
async def download_track(track_id: str, user: dict = Depends(get_current_user)):
    """Download a track file and record it for chart calculation."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"audio_url": 1, "title": 1})
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # Record download for charts
    redis = get_redis()
    user_id = str(user.get("id") or user.get("user_id"))

    KST = timezone(timedelta(hours=9))
    now = datetime.now(KST)
    year, week, _ = now.isocalendar()
    keys = {
        "hourly": now.strftime("%Y%m%d%H"),
        "daily": now.strftime("%Y%m%d"),
        "weekly": f"{year}-W{week:02d}",
        "monthly": now.strftime("%Y%m"),
    }

    pipe = redis.pipeline()
    # Download dedup sets (1 user = 1 count per period)
    dl_keys_ttl = [
        (f"chart:downloads:hourly:{keys['hourly']}:{track_id}", 2 * 3600),
        (f"chart:downloads:daily:{keys['daily']}:{track_id}", 2 * 86400),
        (f"chart:downloads:weekly:{keys['weekly']}:{track_id}", 8 * 86400),
        (f"chart:downloads:monthly:{keys['monthly']}:{track_id}", 32 * 86400),
    ]
    for key, ttl in dl_keys_ttl:
        pipe.sadd(key, user_id)
        pipe.expire(key, ttl)

    # Download track index sets
    dl_index_ttl = [
        (f"chart:dl_tracks:hourly:{keys['hourly']}", 2 * 3600),
        (f"chart:dl_tracks:daily:{keys['daily']}", 2 * 86400),
        (f"chart:dl_tracks:weekly:{keys['weekly']}", 8 * 86400),
        (f"chart:dl_tracks:monthly:{keys['monthly']}", 32 * 86400),
    ]
    for key, ttl in dl_index_ttl:
        pipe.sadd(key, track_id)
        pipe.expire(key, ttl)

    await pipe.execute()

    # v111: 다운로드 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    # Save to MongoDB for persistence
    await mongo.download_logs.insert_one({
        "user_id": user_id,
        "track_id": track_id,
        "downloaded_at": now,
    })

    # Increment download_count in MongoDB
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"download_count": 1}},
    )

    # Get presigned URL for download
    minio_client = get_minio()
    try:
        url = minio_client.presigned_get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
            expires=timedelta(hours=1),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title = doc.get("title", "track")
    ext = doc["audio_url"].rsplit(".", 1)[-1] if "." in doc["audio_url"] else "mp3"

    return {"download_url": url, "filename": f"{title}.{ext}"}


# ── v126: SNS 공유영상 (커버+음원 9:16 스틸 mp4) ──────────────────────────────

@router.post("/{track_id}/share-video")
async def create_share_video(track_id: str, format: str = Query("sns")):
    """공유영상 생성 (무인증 — 공개 트랙만). 캐시 있으면 즉시 반환.

    format(v129): sns(9:16 전체) / wide(16:9 블러배경) / kakao(1080x2340 15s).
    """
    from ..services.share_video import (
        FORMATS,
        ShareVideoError,
        _fetch_lyric_segments,
        generate_share_video,
        share_video_exists,
    )

    if format not in FORMATS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 형식입니다."})

    logger.info("[share-video] enter track=%s format=%s", track_id, format)

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"cover_image_url": 1, "audio_url": 1, "is_public": 1,
         "generation_id": 1, "variant_index": 1, "recognized_timestamps": 1},
    )
    if not doc or not doc.get("is_public", True):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    if not doc.get("cover_image_url"):
        return JSONResponse(status_code=400, content={"error": "커버 이미지가 없는 곡입니다."})
    if not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    video_url = f"/api/tracks/{track_id}/share-video/file"
    if format != "sns":
        video_url += f"?format={format}"

    # v128: 가사 타임스탬프 조회 (없으면 자막 없이 진행)
    segments = await _fetch_lyric_segments(mongo, doc)
    subtitles = bool(segments)
    logger.info(
        "[share-video] segments=%d subtitled=%s track=%s format=%s",
        len(segments), subtitles, track_id, format,
    )

    if await asyncio.to_thread(share_video_exists, track_id, format):
        logger.info("[share-video] cache hit track=%s format=%s", track_id, format)
        return {"video_url": video_url, "cached": True, "subtitles": subtitles,
                "format": format}

    logger.info("[share-video] cache miss track=%s format=%s — generating", track_id, format)
    try:
        await asyncio.to_thread(
            generate_share_video, track_id, doc["cover_image_url"],
            doc["audio_url"], segments, format,
        )
    except ShareVideoError:
        return JSONResponse(status_code=502, content={"error": "영상 생성에 실패했습니다."})
    except Exception:
        logger.exception("[share-video] unexpected failure track=%s format=%s", track_id, format)
        return JSONResponse(status_code=502, content={"error": "영상 생성에 실패했습니다."})

    return {"video_url": video_url, "cached": False, "subtitles": subtitles,
            "format": format}


@router.get("/{track_id}/share-video/file")
async def get_share_video_file(track_id: str, format: str = Query("sns")):
    """공유영상 파일 프록시 (무인증). MinIO share/v2/{track_id}[_{format}].mp4 스트리밍."""
    from ..services.share_video import FORMATS, share_object_name

    if format not in FORMATS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 형식입니다."})

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=share_object_name(track_id, format),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "공유 영상을 찾을 수 없습니다."})

    logger.info("[share-video] proxy served track=%s format=%s", track_id, format)

    def _iter():
        try:
            for chunk in response.stream(64 * 1024):
                yield chunk
        finally:
            response.close()
            response.release_conn()

    headers = {
        "Content-Disposition": f'attachment; filename="maidol_{track_id}_{format}.mp4"',
    }
    content_length = response.headers.get("Content-Length")
    if content_length:
        headers["Content-Length"] = content_length

    return StreamingResponse(_iter(), media_type="video/mp4", headers=headers)


# ── v130: Wondera recognize 가사 타임스탬프 (골격 — 차단 해제 후 실검증) ──────

@router.post("/{track_id}/recognize-timestamps")
async def recognize_track_timestamps_route(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """트랙 오디오 → Wondera recognize → recognized_timestamps 저장 (소유자 전용).

    유료 추정 API — 자동 호출 없음, 본인 곡 명시 요청만. 성공 {cached, segments}.
    Wondera 실패(현재 Cloudflare 차단 포함) → 502 + 정리된 메시지.
    """
    from ..services.lyric_recognize_service import (
        LyricRecognizeError,
        recognize_track_timestamps,
    )

    short = track_id[:8]
    logger.info("[lyric-recognize] route enter track=%s", short)

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"uploader_id": 1})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "본인 곡만 요청할 수 있습니다."})

    try:
        result = await recognize_track_timestamps(track_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    except LyricRecognizeError as e:
        logger.warning("[lyric-recognize] route failed track=%s msg=%s", short, e)
        return JSONResponse(status_code=502, content={"error": str(e)})
    except Exception:
        logger.exception("[lyric-recognize] route unexpected failure track=%s", short)
        return JSONResponse(status_code=502, content={"error": "가사 타임스탬프 인식에 실패했습니다."})

    logger.info(
        "[lyric-recognize] route done track=%s cached=%s segments=%d",
        short, result.get("cached"), result.get("segments", 0),
    )
    return result
