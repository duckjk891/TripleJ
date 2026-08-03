"""FeedSquad — 스타 채널 음악 피드 (v131 1단계).

Mongo `feeds`/`feed_comments` + PG `feed_likes`.
피드 글 = 작성자 종속 독립 문서 (향후 인스타형 글로벌 노출 대비).
로그 prefix [feed] — feed_id/author 앞8자만, 본문·댓글 텍스트 원문 로그 금지(길이만).
"""
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg

router = APIRouter(prefix="/api/feeds", tags=["Feeds"])

logger = logging.getLogger(__name__)

FEED_KINDS = ("feed", "community")  # v133: community = 채널 공지 글 (텍스트만)

MAX_BLOCKS = 50
TIMELINE_CANDIDATES = 200  # v134: 타임라인 랭킹 후보 풀 (is_public 최신순)
TIMELINE_MAX_LIMIT = 30
TIMELINE_FOLLOWING_BOOST = 1000.0  # 로그인 시 팔로잉 작성자 글 최우선 블록
MAX_TITLE_LEN = 100
MAX_TEXT_TOTAL = 10_000
MAX_COMMENT_LEN = 1_000

# 트랙 하이드레이션 시 필요한 필드만 조회
_TRACK_PROJECTION = {
    "title": 1,
    "uploader_id": 1,
    "uploader_nickname": 1,
    "cover_image_url": 1,
    "duration_sec": 1,
    "is_public": 1,
}


def _short(value) -> str:
    """로그 추적자 — id 앞 8자."""
    return str(value)[:8] if value else "?"


class FeedBody(BaseModel):
    title: Optional[str] = None
    blocks: List[dict]
    bgm_track_id: Optional[str] = None
    is_public: bool = True
    kind: str = "feed"  # v133: "feed" | "community" (수정 시엔 무시 — 저장된 kind 유지)


class CommentBody(BaseModel):
    text: str


def _track_view(doc: dict) -> dict:
    """tracks 문서 → 피드 하이드레이션용 축약 뷰 (_serialize_track 별칭 관행 동일)."""
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title"),
        "artist_id": doc.get("uploader_id"),
        "artist_name": doc.get("uploader_nickname", "AI"),
        "cover_image": doc.get("cover_image_url"),
        "duration_sec": doc.get("duration_sec"),
        "is_public": doc.get("is_public", False),
    }


def _serialize_feed(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    doc["kind"] = doc.get("kind") or "feed"  # v133: 기존 문서(kind 없음)=feed 취급
    # v137 — 신고 블라인드 플래그 (소유자 사유 표시용, 기본 false)
    doc["report_blinded"] = bool(doc.get("report_blinded", False))
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


def _serialize_comment(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


async def _validate_and_normalize(mongo, user_id: str, body: FeedBody, kind: str = "feed"):
    """생성/수정 공통 검증. 반환 (normalized: dict|None, error: JSONResponse|None).

    - kind "feed"|"community" 외 400 (수정 시엔 저장된 kind 가 전달됨 — body.kind 무시)
    - community(v133): 텍스트 블록만(track 400), bgm 400, title 무시(null 저장)
    - blocks 1~50개, text 블록 trim 후 비면 제거, 전체 비면 400
    - title ≤ 100자, text 합계 ≤ 10,000자
    - track 블록·bgm 실존 트랙만, 타인 곡은 is_public 필수
    """
    if kind not in FEED_KINDS:
        return None, JSONResponse(status_code=400, content={"error": "지원하지 않는 글 종류입니다."})
    is_community = kind == "community"

    if is_community:
        title = None  # 커뮤니티 글은 제목을 받지 않음 (무시·null 저장)
    else:
        title = body.title.strip() if isinstance(body.title, str) else None
    if title is not None and len(title) > MAX_TITLE_LEN:
        return None, JSONResponse(status_code=400, content={"error": f"제목은 {MAX_TITLE_LEN}자 이하여야 합니다."})

    if not isinstance(body.blocks, list) or len(body.blocks) == 0:
        return None, JSONResponse(status_code=400, content={"error": "블록은 1개 이상이어야 합니다."})
    if len(body.blocks) > MAX_BLOCKS:
        return None, JSONResponse(status_code=400, content={"error": f"블록은 최대 {MAX_BLOCKS}개까지 가능합니다."})

    normalized_blocks = []
    total_text = 0
    track_ids = set()
    for block in body.blocks:
        if not isinstance(block, dict):
            return None, JSONResponse(status_code=400, content={"error": "블록 형식이 올바르지 않습니다."})
        btype = block.get("type")
        if btype == "text":
            text = (block.get("text") or "").strip()
            if not text:
                continue  # 빈 텍스트 블록은 제거
            total_text += len(text)
            normalized_blocks.append({"type": "text", "text": text})
        elif btype == "track":
            if is_community:
                return None, JSONResponse(status_code=400, content={"error": "커뮤니티 글에는 곡을 넣을 수 없습니다."})
            track_id = block.get("track_id")
            if not track_id or not ObjectId.is_valid(str(track_id)):
                return None, JSONResponse(status_code=400, content={"error": "존재하지 않는 트랙이 포함되어 있습니다."})
            track_ids.add(str(track_id))
            normalized_blocks.append({"type": "track", "track_id": str(track_id)})
        else:
            return None, JSONResponse(status_code=400, content={"error": "지원하지 않는 블록 타입입니다."})

    if not normalized_blocks:
        return None, JSONResponse(status_code=400, content={"error": "피드 내용이 비어 있습니다."})
    if total_text > MAX_TEXT_TOTAL:
        return None, JSONResponse(
            status_code=400, content={"error": f"텍스트는 합계 {MAX_TEXT_TOTAL:,}자 이하여야 합니다."}
        )

    bgm_track_id = body.bgm_track_id
    if bgm_track_id and is_community:
        return None, JSONResponse(status_code=400, content={"error": "커뮤니티 글에는 BGM 을 설정할 수 없습니다."})
    if bgm_track_id:
        bgm_track_id = str(bgm_track_id)
        if not ObjectId.is_valid(bgm_track_id):
            return None, JSONResponse(status_code=400, content={"error": "BGM 트랙을 찾을 수 없습니다."})
        track_ids.add(bgm_track_id)
    else:
        bgm_track_id = None

    # 트랙 실존 + 타인 비공개 곡 차단 (1쿼리 $in)
    if track_ids:
        oids = [ObjectId(t) for t in track_ids]
        docs = await mongo.tracks.find({"_id": {"$in": oids}}, _TRACK_PROJECTION).to_list(length=len(oids))
        found = {str(d["_id"]): d for d in docs}
        logger.info("[feed] track_check author=%s requested=%d found=%d", _short(user_id), len(track_ids), len(found))
        for tid in track_ids:
            doc = found.get(tid)
            if not doc:
                return None, JSONResponse(status_code=400, content={"error": "존재하지 않는 트랙이 포함되어 있습니다."})
            if doc.get("uploader_id") != user_id and not doc.get("is_public"):
                logger.info("[feed] track_check private_denied author=%s track=%s", _short(user_id), _short(tid))
                return None, JSONResponse(status_code=400, content={"error": "다른 사용자의 비공개 곡은 사용할 수 없습니다."})

    return {
        "title": title,
        "blocks": normalized_blocks,
        "bgm_track_id": bgm_track_id,
        "is_public": bool(body.is_public),
        "text_len": total_text,
    }, None


async def _hydrate_feeds(mongo, conn, feeds: list, current_user=None) -> list:
    """직렬화된 피드 목록에 트랙 블록·bgm 하이드레이션 + 작성자 프로필 + is_liked 일괄 첨부."""
    # 1) 트랙 일괄 조회 (1쿼리 $in)
    track_ids = set()
    for f in feeds:
        for b in f.get("blocks", []):
            if b.get("type") == "track" and b.get("track_id"):
                track_ids.add(b["track_id"])
        if f.get("bgm_track_id"):
            track_ids.add(f["bgm_track_id"])
    track_map = {}
    if track_ids:
        oids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(t)]
        docs = await mongo.tracks.find({"_id": {"$in": oids}}, _TRACK_PROJECTION).to_list(length=len(oids))
        track_map = {str(d["_id"]): _track_view(d) for d in docs}

    # 2) 작성자 프로필 일괄 조회 (PG — nickname 은 현재값 우선, 라이브 참조 관행)
    author_ids = sorted({f.get("author_id") for f in feeds if f.get("author_id")})
    profiles = {}
    if author_ids:
        try:
            rows = await conn.fetch(
                "SELECT id::text, nickname, profile_image FROM users WHERE id::text = ANY($1)", author_ids
            )
            profiles = {r["id"]: (r["nickname"], r["profile_image"]) for r in rows}
        except Exception as e:
            logger.error("[feed] hydrate author_profile_failed n=%d err=%s", len(author_ids), e)

    # 3) is_liked 일괄 (로그인 시)
    liked_ids = set()
    if current_user and feeds:
        try:
            rows = await conn.fetch(
                "SELECT feed_id FROM feed_likes WHERE user_id = $1 AND feed_id = ANY($2::varchar[])",
                uuid.UUID(current_user["id"]), [f["id"] for f in feeds],
            )
            liked_ids = {r["feed_id"] for r in rows}
        except Exception as e:
            logger.error("[feed] hydrate is_liked_failed user=%s err=%s", _short(current_user.get("id")), e)

    for f in feeds:
        for b in f.get("blocks", []):
            if b.get("type") == "track":
                tid = b.get("track_id")
                b["track"] = track_map.get(tid) or {"id": tid, "deleted": True}
        if f.get("bgm_track_id"):
            f["bgm_track"] = track_map.get(f["bgm_track_id"]) or {"id": f["bgm_track_id"], "deleted": True}
        else:
            f["bgm_track"] = None
        nickname, profile_image = profiles.get(f.get("author_id"), (None, None))
        if nickname:
            f["author_nickname"] = nickname
        f["author_profile_image"] = profile_image
        f["is_liked"] = f["id"] in liked_ids
    return feeds


async def _get_feed_or_404(mongo, feed_id: str):
    """(doc, error) — 비정상 id/미존재 모두 404."""
    if not ObjectId.is_valid(feed_id):
        logger.info("[feed] lookup invalid_id feed=%s", _short(feed_id))
        return None, JSONResponse(status_code=404, content={"error": "피드를 찾을 수 없습니다."})
    doc = await mongo.feeds.find_one({"_id": ObjectId(feed_id)})
    if not doc:
        logger.info("[feed] lookup not_found feed=%s", _short(feed_id))
        return None, JSONResponse(status_code=404, content={"error": "피드를 찾을 수 없습니다."})
    return doc, None


# ---------------------------------------------------------------- CRUD


@router.post("/", status_code=201)
async def create_feed(body: FeedBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info(
        "[feed] create enter author=%s kind=%s blocks=%d bgm=%s",
        _short(user_id), body.kind, len(body.blocks or []), bool(body.bgm_track_id),
    )

    normalized, err = await _validate_and_normalize(mongo, user_id, body, kind=body.kind)
    if err:
        logger.info("[feed] create rejected author=%s kind=%s", _short(user_id), body.kind)
        return err

    now = datetime.utcnow()
    doc = {
        "author_id": user_id,
        "author_nickname": current_user.get("nickname"),
        "kind": body.kind,
        "title": normalized["title"],
        "blocks": normalized["blocks"],
        "bgm_track_id": normalized["bgm_track_id"],
        "like_count": 0,
        "comment_count": 0,
        "is_public": normalized["is_public"],
        "created_at": now,
        "updated_at": now,
    }
    result = await mongo.feeds.insert_one(doc)
    feed_id = str(result.inserted_id)
    logger.info(
        "[feed] create ok feed=%s author=%s kind=%s blocks=%d text_len=%d bgm=%s",
        _short(feed_id), _short(user_id), body.kind, len(normalized["blocks"]),
        normalized["text_len"], bool(normalized["bgm_track_id"]),
    )

    feed = _serialize_feed(doc)
    await _hydrate_feeds(mongo, conn, [feed], current_user)
    return {"feed": feed}


@router.get("/user/{user_id}")
async def list_user_feeds(
    user_id: str,
    page: int = 1,
    limit: int = 10,
    kind: str = Query("feed"),
    current_user=Depends(get_current_user_optional),
    conn=Depends(get_pg),
):
    mongo = get_mongo()
    page = max(1, page)
    limit = max(1, min(limit, 50))
    logger.info(
        "[feed] list enter author=%s kind=%s page=%d limit=%d viewer=%s",
        _short(user_id), kind, page, limit, _short(current_user.get("id")) if current_user else "anon",
    )

    if kind not in FEED_KINDS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 글 종류입니다."})
    query = {"author_id": user_id}
    if kind == "community":
        query["kind"] = "community"
    else:
        # 기존 문서(kind 없음)도 feed 로 취급
        query["kind"] = {"$ne": "community"}
    # v137 BUG-2 — 비공개(신고 블라인드 포함) 피드는 소유자 본인에게만 노출
    viewer_id = str(current_user.get("id")) if current_user else None
    if viewer_id != str(user_id):
        query["is_public"] = {"$ne": False}
    total = await mongo.feeds.count_documents(query)
    docs = (
        await mongo.feeds.find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    feeds = [_serialize_feed(d) for d in docs]
    await _hydrate_feeds(mongo, conn, feeds, current_user)
    logger.info("[feed] list ok author=%s kind=%s returned=%d total=%d", _short(user_id), kind, len(feeds), total)

    return {
        "feeds": feeds,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


# ---------------------------------------------------------------- 타임라인 (v134)
# 주의: FastAPI 는 정의 순서대로 매칭하므로 /timeline 은 반드시 /{feed_id} 보다 앞에 둔다.


def _feed_track_ids(doc: dict) -> set:
    """피드 문서의 삽입곡+BGM track_id 집합 (track_power 산정용)."""
    tids = {
        b.get("track_id")
        for b in doc.get("blocks", [])
        if isinstance(b, dict) and b.get("type") == "track" and b.get("track_id")
    }
    if doc.get("bgm_track_id"):
        tids.add(doc["bgm_track_id"])
    return tids


def _timeline_age_hours(created, now_utc: datetime) -> float:
    """created_at 이 tz-naive(utcnow 저장)/aware 혼재 가능 — 항상 UTC aware 로 맞춰 계산."""
    if not isinstance(created, datetime):
        return 24.0 * 365  # created_at 없음/이상 → 1년 취급 (사실상 최하 recency)
    aware = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
    return max(0.0, (now_utc - aware).total_seconds() / 3600.0)


@router.get("/timeline")
async def get_timeline(
    page: int = 1,
    limit: int = 10,
    current_user=Depends(get_current_user_optional),
    conn=Depends(get_pg),
):
    """인스타형 혼합 타임라인 — is_public 최신 200건 후보를 점수 랭킹해 페이징 반환.

    base = recency*2 + engagement + author_pop + track_power*0.5
    (recency=1/(1+age_hours/24), engagement=log1p(like)+0.5*log1p(comment),
     author_pop=log1p(팔로워 수), track_power=삽입곡·BGM 중 max(log1p(play)+log1p(like)))
    로그인 시 팔로잉 작성자 글 +1000 (팔로잉 최우선 블록). 동률은 created_at desc.
    """
    mongo = get_mongo()
    page = max(1, page)
    limit = max(1, min(limit, TIMELINE_MAX_LIMIT))
    viewer_id = current_user.get("id") if current_user else None
    logger.info(
        "[timeline] enter viewer=%s page=%d limit=%d",
        _short(viewer_id) if viewer_id else "anon", page, limit,
    )

    # 1) 후보: 공개 글 최신 200건 (전 kind — 피드+공지 혼합)
    docs = (
        await mongo.feeds.find({"is_public": True})
        .sort("created_at", -1)
        .limit(TIMELINE_CANDIDATES)
        .to_list(length=TIMELINE_CANDIDATES)
    )
    total = len(docs)

    # 2) 작성자 팔로워 수 일괄 (PG 1쿼리) — author_id 는 str(UUID)
    author_ids = sorted({d.get("author_id") for d in docs if d.get("author_id")})
    author_uuids = []
    for aid in author_ids:
        try:
            author_uuids.append(uuid.UUID(aid))
        except (ValueError, TypeError, AttributeError):
            continue
    follower_counts = {}
    if author_uuids:
        try:
            rows = await conn.fetch(
                "SELECT followee_id, COUNT(*) AS cnt FROM follows"
                " WHERE followee_id = ANY($1::uuid[]) GROUP BY followee_id",
                author_uuids,
            )
            follower_counts = {str(r["followee_id"]): int(r["cnt"]) for r in rows}
        except Exception as e:
            logger.error("[timeline] follower_counts_failed authors=%d err=%s", len(author_uuids), e)

    # 3) 내 팔로잉 (로그인 시 — 팔로잉 작성자 글 +1000)
    following = set()
    if viewer_id:
        try:
            rows = await conn.fetch(
                "SELECT followee_id FROM follows WHERE follower_id = $1", uuid.UUID(viewer_id)
            )
            following = {str(r["followee_id"]) for r in rows}
        except Exception as e:
            logger.error("[timeline] following_failed viewer=%s err=%s", _short(viewer_id), e)

    # 4) 곡 인기 일괄 (Mongo 1쿼리) — track_power 원자료
    all_track_ids = set()
    for d in docs:
        all_track_ids |= _feed_track_ids(d)
    track_pop = {}
    if all_track_ids:
        oids = [ObjectId(t) for t in all_track_ids if ObjectId.is_valid(t)]
        tdocs = await mongo.tracks.find(
            {"_id": {"$in": oids}}, {"play_count": 1, "like_count": 1}
        ).to_list(length=len(oids))
        track_pop = {
            str(t["_id"]): math.log1p(t.get("play_count") or 0) + math.log1p(t.get("like_count") or 0)
            for t in tdocs
        }

    # 5) 점수 계산 → 정렬 (동률은 created_at desc)
    now_utc = datetime.now(timezone.utc)
    scored = []
    for d in docs:
        age_hours = _timeline_age_hours(d.get("created_at"), now_utc)
        recency = 1.0 / (1.0 + age_hours / 24.0)
        engagement = math.log1p(d.get("like_count") or 0) + 0.5 * math.log1p(d.get("comment_count") or 0)
        author_pop = math.log1p(follower_counts.get(d.get("author_id"), 0))
        powers = [track_pop.get(t, 0.0) for t in _feed_track_ids(d)]
        track_power = max(powers) if powers else 0.0
        score = recency * 2 + engagement + author_pop + track_power * 0.5
        if viewer_id and d.get("author_id") in following:
            score += TIMELINE_FOLLOWING_BOOST
        scored.append((score, -age_hours, d))  # -age_hours: 동률 시 최신 우선
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    logger.info(
        "[timeline] scored candidates=%d following=%d authors=%d tracks=%d top3=%s",
        total, len(following), len(author_ids), len(all_track_ids),
        [(_short(str(item[2]["_id"])), round(item[0], 3)) for item in scored[:3]],
    )

    # 6) 페이징 슬라이스 → 하이드레이션 (is_liked 포함)
    start = (page - 1) * limit
    page_docs = [item[2] for item in scored[start:start + limit]]
    feeds = [_serialize_feed(d) for d in page_docs]
    await _hydrate_feeds(mongo, conn, feeds, current_user)
    logger.info(
        "[timeline] ok viewer=%s page=%d returned=%d total=%d",
        _short(viewer_id) if viewer_id else "anon", page, len(feeds), total,
    )

    return {
        "feeds": feeds,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.get("/{feed_id}")
async def get_feed(feed_id: str, current_user=Depends(get_current_user_optional), conn=Depends(get_pg)):
    mongo = get_mongo()
    logger.info(
        "[feed] get enter feed=%s viewer=%s",
        _short(feed_id), _short(current_user.get("id")) if current_user else "anon",
    )
    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err

    # v137 BUG-2 — 비공개(신고 블라인드 포함) 피드 단건은 소유자 외 404
    if doc.get("is_public") is False:
        viewer_id = str(current_user.get("id")) if current_user else None
        if viewer_id != str(doc.get("author_id")):
            logger.info("[feed] get blocked (non-public) feed=%s viewer=%s", _short(feed_id), viewer_id[:8] if viewer_id else "anon")
            return JSONResponse(status_code=404, content={"error": "글을 찾을 수 없습니다."})

    feed = _serialize_feed(doc)
    await _hydrate_feeds(mongo, conn, [feed], current_user)
    logger.info("[feed] get ok feed=%s author=%s", _short(feed_id), _short(feed.get("author_id")))
    return {"feed": feed}


@router.put("/{feed_id}")
async def update_feed(feed_id: str, body: FeedBody, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[feed] update enter feed=%s author=%s", _short(feed_id), _short(user_id))

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err
    if doc.get("author_id") != user_id:
        logger.info("[feed] update forbidden feed=%s author=%s", _short(feed_id), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "피드를 수정할 권한이 없습니다."})

    # v137 — 신고 블라인드 피드는 수정 불가 (is_public 강제 복구 방지)
    if doc.get("report_blinded"):
        logger.info("[report] feed update_blocked feed=%s author=%s", _short(feed_id), _short(user_id))
        return JSONResponse(status_code=400, content={"error": "신고 처리로 제한된 콘텐츠입니다."})

    # v133: kind 변경 불가 — body.kind 무시, 저장된 kind 기준으로 검증
    stored_kind = doc.get("kind") or "feed"
    normalized, verr = await _validate_and_normalize(mongo, user_id, body, kind=stored_kind)
    if verr:
        logger.info("[feed] update rejected feed=%s author=%s kind=%s", _short(feed_id), _short(user_id), stored_kind)
        return verr

    now = datetime.utcnow()
    await mongo.feeds.update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "title": normalized["title"],
            "blocks": normalized["blocks"],
            "bgm_track_id": normalized["bgm_track_id"],
            "is_public": normalized["is_public"],
            "updated_at": now,
        }},
    )
    logger.info(
        "[feed] update ok feed=%s author=%s kind=%s blocks=%d text_len=%d",
        _short(feed_id), _short(user_id), stored_kind, len(normalized["blocks"]), normalized["text_len"],
    )

    updated = await mongo.feeds.find_one({"_id": doc["_id"]})
    feed = _serialize_feed(updated)
    await _hydrate_feeds(mongo, conn, [feed], current_user)
    return {"feed": feed}


async def purge_feed_document(mongo, conn, doc: dict) -> dict:
    """v138 — 피드 완전 파기(재사용 함수). 소유자 DELETE 라우트와
    admin confirm_delete 가 공용으로 호출한다.

    파기: feeds 도큐먼트 + 하위 feed_comments 전체 + PG feed_likes.
    Returns: {"feed_id", "owner_id", "comments_removed"}.
    """
    feed_id = str(doc["_id"])
    owner_id = doc.get("author_id")
    await mongo.feeds.delete_one({"_id": doc["_id"]})
    comments_result = await mongo.feed_comments.delete_many({"feed_id": feed_id})
    try:
        await conn.execute("DELETE FROM feed_likes WHERE feed_id = $1", feed_id)
    except Exception as e:
        logger.error("[feed] delete likes_cleanup_failed feed=%s err=%s", _short(feed_id), e)
    logger.info(
        "[feed] purge ok feed=%s author=%s comments_removed=%d",
        _short(feed_id), _short(owner_id), comments_result.deleted_count,
    )
    return {
        "feed_id": feed_id,
        "owner_id": owner_id,
        "comments_removed": comments_result.deleted_count,
    }


@router.delete("/{feed_id}")
async def delete_feed(feed_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[feed] delete enter feed=%s author=%s", _short(feed_id), _short(user_id))

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err
    if doc.get("author_id") != user_id:
        logger.info("[feed] delete forbidden feed=%s author=%s", _short(feed_id), _short(user_id))
        return JSONResponse(status_code=403, content={"error": "피드를 삭제할 권한이 없습니다."})

    await purge_feed_document(mongo, conn, doc)
    return {"message": "피드가 삭제되었습니다."}


# ---------------------------------------------------------------- 좋아요 (멱등)


@router.post("/{feed_id}/like")
async def like_feed(feed_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[feed] like enter feed=%s user=%s", _short(feed_id), _short(user_id))

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err

    result = await conn.execute(
        "INSERT INTO feed_likes (user_id, feed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        uuid.UUID(user_id), feed_id,
    )
    inserted = result == "INSERT 0 1"
    if inserted:
        await mongo.feeds.update_one({"_id": doc["_id"]}, {"$inc": {"like_count": 1}})
    logger.info("[feed] like %s feed=%s user=%s", "ok" if inserted else "noop", _short(feed_id), _short(user_id))

    updated = await mongo.feeds.find_one({"_id": doc["_id"]}, {"like_count": 1})
    return {
        "message": "좋아요가 추가되었습니다.",
        "is_liked": True,
        "like_count": (updated or {}).get("like_count", 0),
    }


@router.delete("/{feed_id}/like")
async def unlike_feed(feed_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[feed] unlike enter feed=%s user=%s", _short(feed_id), _short(user_id))

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err

    result = await conn.execute(
        "DELETE FROM feed_likes WHERE user_id = $1 AND feed_id = $2",
        uuid.UUID(user_id), feed_id,
    )
    deleted = result == "DELETE 1"
    if deleted:
        # 음수 방지 가드
        await mongo.feeds.update_one(
            {"_id": doc["_id"], "like_count": {"$gt": 0}}, {"$inc": {"like_count": -1}}
        )
    logger.info("[feed] unlike %s feed=%s user=%s", "ok" if deleted else "noop", _short(feed_id), _short(user_id))

    updated = await mongo.feeds.find_one({"_id": doc["_id"]}, {"like_count": 1})
    return {
        "message": "좋아요가 취소되었습니다.",
        "is_liked": False,
        "like_count": (updated or {}).get("like_count", 0),
    }


# ---------------------------------------------------------------- 댓글


@router.get("/{feed_id}/comments")
async def list_feed_comments(feed_id: str, page: int = 1, limit: int = 20):
    mongo = get_mongo()
    page = max(1, page)
    limit = max(1, min(limit, 100))
    logger.info("[feed] comments_list enter feed=%s page=%d limit=%d", _short(feed_id), page, limit)

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err

    query = {"feed_id": feed_id}
    total = await mongo.feed_comments.count_documents(query)
    docs = (
        await mongo.feed_comments.find(query)
        .sort("created_at", 1)
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    comments = [_serialize_comment(d) for d in docs]
    logger.info("[feed] comments_list ok feed=%s returned=%d total=%d", _short(feed_id), len(comments), total)

    return {
        "comments": comments,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/{feed_id}/comments", status_code=201)
async def add_feed_comment(feed_id: str, body: CommentBody, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    user_id = current_user["id"]
    text = (body.text or "").strip()
    logger.info("[feed] comment_add enter feed=%s user=%s text_len=%d", _short(feed_id), _short(user_id), len(text))

    if not text:
        return JSONResponse(status_code=400, content={"error": "댓글 내용을 입력해주세요."})
    if len(text) > MAX_COMMENT_LEN:
        return JSONResponse(status_code=400, content={"error": f"댓글은 {MAX_COMMENT_LEN:,}자 이하여야 합니다."})

    doc, err = await _get_feed_or_404(mongo, feed_id)
    if err:
        return err

    comment = {
        "feed_id": feed_id,
        "author_id": user_id,
        "author_nickname": current_user.get("nickname"),
        "text": text,
        "created_at": datetime.utcnow(),
    }
    result = await mongo.feed_comments.insert_one(comment)
    await mongo.feeds.update_one({"_id": doc["_id"]}, {"$inc": {"comment_count": 1}})
    logger.info(
        "[feed] comment_add ok feed=%s user=%s comment=%s text_len=%d",
        _short(feed_id), _short(user_id), _short(result.inserted_id), len(text),
    )
    return {"comment": _serialize_comment(comment)}


@router.delete("/comments/{comment_id}")
async def delete_feed_comment(comment_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[feed] comment_delete enter comment=%s user=%s", _short(comment_id), _short(user_id))

    if not ObjectId.is_valid(comment_id):
        return JSONResponse(status_code=404, content={"error": "댓글을 찾을 수 없습니다."})
    comment = await mongo.feed_comments.find_one({"_id": ObjectId(comment_id)})
    if not comment:
        logger.info("[feed] comment_delete not_found comment=%s", _short(comment_id))
        return JSONResponse(status_code=404, content={"error": "댓글을 찾을 수 없습니다."})

    feed_id = comment.get("feed_id")
    feed = None
    if feed_id and ObjectId.is_valid(feed_id):
        feed = await mongo.feeds.find_one({"_id": ObjectId(feed_id)}, {"author_id": 1})

    is_comment_author = comment.get("author_id") == user_id
    is_feed_owner = bool(feed) and feed.get("author_id") == user_id
    if not (is_comment_author or is_feed_owner):
        logger.info(
            "[feed] comment_delete forbidden comment=%s feed=%s user=%s",
            _short(comment_id), _short(feed_id), _short(user_id),
        )
        return JSONResponse(status_code=403, content={"error": "댓글을 삭제할 권한이 없습니다."})

    await mongo.feed_comments.delete_one({"_id": comment["_id"]})
    if feed:
        # 음수 방지 가드
        await mongo.feeds.update_one(
            {"_id": feed["_id"], "comment_count": {"$gt": 0}}, {"$inc": {"comment_count": -1}}
        )
    logger.info(
        "[feed] comment_delete ok comment=%s feed=%s user=%s by=%s",
        _short(comment_id), _short(feed_id), _short(user_id),
        "author" if is_comment_author else "feed_owner",
    )
    return {"message": "댓글이 삭제되었습니다."}
