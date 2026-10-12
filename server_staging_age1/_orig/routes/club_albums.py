"""v3.305 [ClubAlbum] 크루 앨범 — 방장이 크루 플레이리스트로 만드는 테마 앨범 + 대표곡 + 참여 미션(대표 확정 2026-10-08).

- 생성: 크루장만, 그 크루의 플레이리스트(PG playlists.club_id)로만. 트랙 순서 = 플리 순서(생성 시 복사).
- 대표곡(representative_track_id) 필수 — 앨범 안의 곡이어야 함. 비회원은 대표곡만 재생 가능(나머지 locked).
  ※ 잠금은 앨범 화면 기준 — 개별 공개곡은 차트 등 다른 경로에서는 원래대로 들린다.
- 참여 미션: 멤버가 '앨범 생성 이후 발매한 내 공개곡'을 제출 → 크루장 승인 시 수록 + ⭐5(앨범당 1회).
  주간(KST 월~일) 지급 상한 ⭐15(=3회). 상한 초과분은 수록만 하고 ⭐ 미지급(응답 starred=false).
  지급 멱등 = credit_points(user, 'club_album_participation', 5, ref=album_id, day='-') 유니크 키.

컬렉션
- club_albums {club_id, source_playlist_id, title, theme, cover_image_url, track_ids[], representative_track_id,
               created_by, created_at, updated_at}
- club_album_submissions {album_id, club_id, user_id, track_id, status: pending|approved|rejected,
                          created_at, decided_at, decided_by}  — unique(album_id, track_id)

라우터는 routes/clubs.py 하단에서 clubs.router 에 합류(main.py 무변경 관행).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..services.points_service import credit_points
from ..services.word_filter import word_filter_response
from .clubs import _is_admin, _short, get_club_or_404, get_membership
from .notifications import push_notification
from .playlists import _TRACK_PROJECTION, _is_hidden_track, _serialize_track

logger = logging.getLogger(__name__)

router = APIRouter()

ALBUMS = "club_albums"
SUBMISSIONS = "club_album_submissions"
MAX_TITLE_LEN = 40
MAX_THEME_LEN = 200
MAX_ALBUM_TRACKS = 100
MAX_ALBUMS_PER_CLUB = 30
PARTICIPATION_ACTION = "club_album_participation"
PARTICIPATION_REWARD = 5
PARTICIPATION_WEEKLY_CAP = 15
SUB_PENDING, SUB_APPROVED, SUB_REJECTED = "pending", "approved", "rejected"
NOTIF_TYPE = "club_album"
KST = timezone(timedelta(hours=9))

ALBUM_NOT_FOUND = {"error": "앨범을 찾을 수 없습니다."}

_indexes_ready = False


class AlbumCreate(BaseModel):
    playlist_id: str
    title: str
    theme: Optional[str] = None
    representative_track_id: str


class AlbumUpdate(BaseModel):
    title: Optional[str] = None
    theme: Optional[str] = None
    representative_track_id: Optional[str] = None


class SubmissionCreate(BaseModel):
    track_id: str


async def _ensure_indexes(mongo) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await mongo[ALBUMS].create_index([("club_id", 1), ("created_at", -1)])
    await mongo[SUBMISSIONS].create_index([("album_id", 1), ("track_id", 1)], unique=True)
    await mongo[SUBMISSIONS].create_index([("club_id", 1), ("status", 1)])
    _indexes_ready = True


def _iso(dt) -> Optional[str]:
    if isinstance(dt, datetime):
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()
    return dt


def _week_start_utc(now: Optional[datetime] = None) -> datetime:
    """이번 KST 주(월 00:00) 시작 — UTC aware."""
    now_kst = (now or datetime.now(timezone.utc)).astimezone(KST)
    start = (now_kst - timedelta(days=now_kst.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc)


def _serialize_album(doc: dict, *, track_count: Optional[int] = None) -> dict:
    return {
        "id": str(doc["_id"]),
        "club_id": doc.get("club_id"),
        "source_playlist_id": doc.get("source_playlist_id"),
        "title": doc.get("title"),
        "theme": doc.get("theme"),
        "cover_image_url": doc.get("cover_image_url"),
        "representative_track_id": doc.get("representative_track_id"),
        "track_count": track_count if track_count is not None else len(doc.get("track_ids") or []),
        "created_by": doc.get("created_by"),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


async def _album_or_404(mongo, cid: str, album_id: str):
    if not ObjectId.is_valid(album_id):
        return None, JSONResponse(status_code=404, content=ALBUM_NOT_FOUND)
    doc = await mongo[ALBUMS].find_one({"_id": ObjectId(album_id), "club_id": cid})
    if not doc:
        return None, JSONResponse(status_code=404, content=ALBUM_NOT_FOUND)
    return doc, None


def _owner_only(club_doc, current_user, what: str):
    if str(club_doc.get("owner_id")) != str(current_user["id"]) and not _is_admin(current_user):
        logger.info("[ClubAlbum] %s forbidden club=%s user=%s", what, _short(club_doc["_id"]), _short(current_user["id"]))
        return JSONResponse(status_code=403, content={"error": "크루장만 할 수 있어요."})
    return None


async def _visible_tracks(mongo, track_ids: list) -> dict:
    """{track_id: doc} — 비공개·블라인드 제외."""
    oids = [ObjectId(t) for t in track_ids if ObjectId.is_valid(str(t))]
    if not oids:
        return {}
    docs = await mongo.tracks.find({"_id": {"$in": oids}}, _TRACK_PROJECTION).to_list(length=len(oids))
    return {str(d["_id"]): d for d in docs if not _is_hidden_track(d)}


# ─────────────────────────────────────────────────────────────── 목록·상세


@router.get("/{club_id}/albums")
async def list_club_albums(club_id: str, current_user=Depends(get_current_user_optional)):
    """크루 앨범 목록 — 비회원도 조회(대표곡 정보 동봉)."""
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    docs = await mongo[ALBUMS].find({"club_id": cid}).sort("created_at", -1).to_list(length=MAX_ALBUMS_PER_CLUB)
    reps = await _visible_tracks(mongo, [d.get("representative_track_id") for d in docs])
    albums = []
    for d in docs:
        item = _serialize_album(d)
        rep = reps.get(d.get("representative_track_id") or "")
        item["representative_track"] = _serialize_track(rep) if rep else None
        albums.append(item)
    logger.info("[ClubAlbum] list club=%s n=%d viewer=%s", _short(cid), len(albums),
                _short(current_user.get("id")) if current_user else "anon")
    return {"albums": albums}


@router.get("/{club_id}/albums/{album_id}")
async def get_club_album(club_id: str, album_id: str, current_user=Depends(get_current_user_optional)):
    """앨범 상세 — 회원: 전 곡 / 비회원: 대표곡만 재생 가능(나머지 locked=true, 제목·커버만)."""
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    viewer_id = str(current_user["id"]) if current_user else None
    membership = await get_membership(mongo, cid, viewer_id)
    is_member = membership is not None or _is_admin(current_user)
    rep_id = album.get("representative_track_id")
    vis = await _visible_tracks(mongo, album.get("track_ids") or [])
    tracks = []
    for tid in album.get("track_ids") or []:
        d = vis.get(str(tid))
        if not d:
            continue
        t = _serialize_track(d)
        t["is_representative"] = str(tid) == rep_id
        t["locked"] = (not is_member) and str(tid) != rep_id
        tracks.append(t)
    out = _serialize_album(album, track_count=len(tracks))
    out["tracks"] = tracks
    out["is_member"] = is_member
    out["role"] = (membership.get("role") or "member") if membership else None
    if viewer_id and membership:
        mine = await mongo[SUBMISSIONS].find({"album_id": str(album["_id"]), "user_id": viewer_id}).to_list(length=20)
        out["my_submissions"] = [{"track_id": s["track_id"], "status": s["status"]} for s in mine]
    logger.info("[ClubAlbum] detail club=%s album=%s tracks=%d member=%s viewer=%s", _short(cid), _short(album["_id"]),
                len(tracks), is_member, _short(viewer_id) if viewer_id else "anon")
    return out


# ─────────────────────────────────────────────────────────────── 생성·수정·삭제(크루장)


@router.post("/{club_id}/albums", status_code=201)
async def create_club_album(club_id: str, body: AlbumCreate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    await _ensure_indexes(mongo)
    uid = str(current_user["id"])
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "create")
    if forbidden:
        return forbidden
    title = (body.title or "").strip()
    theme = (body.theme or "").strip() or None
    if not title or len(title) > MAX_TITLE_LEN:
        return JSONResponse(status_code=400, content={"error": f"앨범 이름은 1~{MAX_TITLE_LEN}자로 입력해 주세요."})
    if theme and len(theme) > MAX_THEME_LEN:
        return JSONResponse(status_code=400, content={"error": f"앨범 테마는 {MAX_THEME_LEN}자 이하로 입력해 주세요."})
    filtered = await word_filter_response(uid, [title] + ([theme] if theme else []), "club_profile", conn)
    if filtered is not None:
        return filtered
    if await mongo[ALBUMS].count_documents({"club_id": cid}) >= MAX_ALBUMS_PER_CLUB:
        return JSONResponse(status_code=400, content={"error": f"크루 앨범은 {MAX_ALBUMS_PER_CLUB}개까지 만들 수 있어요."})
    try:
        pl_uuid = uuid.UUID(str(body.playlist_id))
    except (TypeError, ValueError):
        return JSONResponse(status_code=404, content={"error": "크루 플레이리스트를 찾을 수 없습니다."})
    pl = await conn.fetchrow("SELECT club_id FROM playlists WHERE id = $1", pl_uuid)
    if not pl or str(pl["club_id"] or "") != cid:
        logger.info("[ClubAlbum] create playlist_mismatch club=%s pl=%s", _short(cid), _short(body.playlist_id))
        return JSONResponse(status_code=404, content={"error": "이 크루의 플레이리스트로만 앨범을 만들 수 있어요."})
    rows = await conn.fetch(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position", pl_uuid
    )
    ordered = []
    for r in rows:
        t = str(r["track_id"])
        if t not in ordered:
            ordered.append(t)
    vis = await _visible_tracks(mongo, ordered)
    track_ids = [t for t in ordered if t in vis][:MAX_ALBUM_TRACKS]
    if not track_ids:
        return JSONResponse(status_code=400, content={"error": "플레이리스트에 공개곡이 있어야 앨범을 만들 수 있어요."})
    rep = str(body.representative_track_id or "")
    if rep not in track_ids:
        return JSONResponse(status_code=400, content={"error": "대표곡은 앨범에 들어간 곡 중에서 골라 주세요."})
    now = datetime.now(timezone.utc)
    doc = {
        "club_id": cid,
        "source_playlist_id": str(pl_uuid),
        "title": title,
        "theme": theme,
        "cover_image_url": vis[rep].get("cover_image_url"),
        "track_ids": track_ids,
        "representative_track_id": rep,
        "created_by": uid,
        "created_at": now,
        "updated_at": now,
    }
    res = await mongo[ALBUMS].insert_one(doc)
    doc["_id"] = res.inserted_id
    logger.info("[ClubAlbum] create ok club=%s album=%s pl=%s tracks=%d rep=%s", _short(cid), _short(res.inserted_id),
                _short(pl_uuid), len(track_ids), _short(rep))
    return _serialize_album(doc)


@router.patch("/{club_id}/albums/{album_id}")
async def update_club_album(club_id: str, album_id: str, body: AlbumUpdate,
                            current_user=Depends(get_current_user), conn=Depends(get_pg)):
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "update")
    if forbidden:
        return forbidden
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    sets: dict = {}
    texts = []
    if body.title is not None:
        title = body.title.strip()
        if not title or len(title) > MAX_TITLE_LEN:
            return JSONResponse(status_code=400, content={"error": f"앨범 이름은 1~{MAX_TITLE_LEN}자로 입력해 주세요."})
        sets["title"] = title
        texts.append(title)
    if body.theme is not None:
        theme = body.theme.strip()
        if len(theme) > MAX_THEME_LEN:
            return JSONResponse(status_code=400, content={"error": f"앨범 테마는 {MAX_THEME_LEN}자 이하로 입력해 주세요."})
        sets["theme"] = theme or None
        if theme:
            texts.append(theme)
    if body.representative_track_id is not None:
        rep = str(body.representative_track_id)
        if rep not in [str(t) for t in album.get("track_ids") or []]:
            return JSONResponse(status_code=400, content={"error": "대표곡은 앨범에 들어간 곡 중에서 골라 주세요."})
        vis = await _visible_tracks(mongo, [rep])
        if rep not in vis:
            return JSONResponse(status_code=400, content={"error": "비공개된 곡은 대표곡으로 지정할 수 없어요."})
        sets["representative_track_id"] = rep
        sets["cover_image_url"] = vis[rep].get("cover_image_url") or album.get("cover_image_url")
    if not sets:
        return JSONResponse(status_code=400, content={"error": "수정할 항목이 없습니다."})
    if texts:
        filtered = await word_filter_response(str(current_user["id"]), texts, "club_profile", conn)
        if filtered is not None:
            return filtered
    sets["updated_at"] = datetime.now(timezone.utc)
    await mongo[ALBUMS].update_one({"_id": album["_id"]}, {"$set": sets})
    fresh = await mongo[ALBUMS].find_one({"_id": album["_id"]})
    logger.info("[ClubAlbum] update ok club=%s album=%s fields=%s", _short(cid), _short(album["_id"]),
                sorted(k for k in sets if k != "updated_at"))
    return _serialize_album(fresh)


@router.delete("/{club_id}/albums/{album_id}/tracks/{track_id}")
async def remove_club_album_track(club_id: str, album_id: str, track_id: str, current_user=Depends(get_current_user)):
    """크루장 — 앨범에서 곡 빼기(대표곡은 다른 곡을 대표로 바꾼 뒤에만)."""
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "remove_track")
    if forbidden:
        return forbidden
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    if str(track_id) == album.get("representative_track_id"):
        return JSONResponse(status_code=400, content={"error": "대표곡은 뺄 수 없어요. 다른 곡을 대표곡으로 바꾼 뒤 빼 주세요."})
    await mongo[ALBUMS].update_one({"_id": album["_id"]},
                                   {"$pull": {"track_ids": str(track_id)}, "$set": {"updated_at": datetime.now(timezone.utc)}})
    logger.info("[ClubAlbum] remove_track club=%s album=%s track=%s", _short(cid), _short(album["_id"]), _short(track_id))
    return {"ok": True}


@router.delete("/{club_id}/albums/{album_id}")
async def delete_club_album(club_id: str, album_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "delete")
    if forbidden:
        return forbidden
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    await mongo[ALBUMS].delete_one({"_id": album["_id"]})
    await mongo[SUBMISSIONS].delete_many({"album_id": str(album["_id"]), "status": SUB_PENDING})
    logger.info("[ClubAlbum] delete ok club=%s album=%s", _short(cid), _short(album["_id"]))
    return {"ok": True}


# ─────────────────────────────────────────────────────────────── 참여 미션(제출·승인)


@router.post("/{club_id}/albums/{album_id}/submissions", status_code=201)
async def submit_to_club_album(club_id: str, album_id: str, body: SubmissionCreate,
                               current_user=Depends(get_current_user)):
    """멤버 — 앨범 테마에 맞춰 새로 만든 내 곡 제출(크루장 승인 대기)."""
    mongo = get_mongo()
    await _ensure_indexes(mongo)
    uid = str(current_user["id"])
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    if not await get_membership(mongo, cid, uid):
        return JSONResponse(status_code=403, content={"error": "크루 멤버만 앨범에 참여할 수 있어요."})
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    tid = str(body.track_id or "")
    if not ObjectId.is_valid(tid):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    track = await mongo.tracks.find_one({"_id": ObjectId(tid)},
                                        {"uploader_id": 1, "created_at": 1, "is_public": 1, "report_blinded": 1, "title": 1})
    if not track or str(track.get("uploader_id")) != uid:
        return JSONResponse(status_code=403, content={"error": "내가 발매한 곡만 낼 수 있어요."})
    if _is_hidden_track(track):
        return JSONResponse(status_code=400, content={"error": "공개된 곡만 낼 수 있어요."})
    created = track.get("created_at")
    album_created = album.get("created_at")
    if isinstance(created, datetime) and isinstance(album_created, datetime):
        c = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
        a = album_created if album_created.tzinfo else album_created.replace(tzinfo=timezone.utc)
        if c < a:
            logger.info("[ClubAlbum] submit too_old club=%s album=%s track=%s", _short(cid), _short(album["_id"]), _short(tid))
            return JSONResponse(status_code=400, content={"error": "앨범이 만들어진 뒤 새로 발매한 곡만 낼 수 있어요.", "code": "track_before_album"})
    if tid in [str(t) for t in album.get("track_ids") or []]:
        return JSONResponse(status_code=409, content={"error": "이미 앨범에 들어간 곡이에요."})
    now = datetime.now(timezone.utc)
    existing = await mongo[SUBMISSIONS].find_one({"album_id": str(album["_id"]), "track_id": tid})
    if existing and existing.get("status") in (SUB_PENDING, SUB_APPROVED):
        return JSONResponse(status_code=409, content={"error": "이미 낸 곡이에요. 크루장 확인을 기다려 주세요."})
    await mongo[SUBMISSIONS].update_one(
        {"album_id": str(album["_id"]), "track_id": tid},
        {"$set": {"club_id": cid, "user_id": uid, "status": SUB_PENDING, "created_at": now,
                  "decided_at": None, "decided_by": None}},
        upsert=True,
    )
    await push_notification(
        mongo, user_id=club.get("owner_id"), ntype=NOTIF_TYPE, actor_id=uid,
        actor_nickname=current_user.get("nickname"), target_id=cid, target_type=NOTIF_TYPE,
        preview=f"앨범 「{album.get('title')}」에 곡을 냈어요 — {track.get('title') or ''}"[:120],
    )
    logger.info("[ClubAlbum] submit ok club=%s album=%s track=%s user=%s", _short(cid), _short(album["_id"]), _short(tid), _short(uid))
    return {"status": SUB_PENDING}


@router.get("/{club_id}/albums/{album_id}/submissions")
async def list_album_submissions(club_id: str, album_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """크루장 — 승인 대기 제출곡 목록(곡 정보·제출자 닉네임)."""
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "list_submissions")
    if forbidden:
        return forbidden
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    subs = await mongo[SUBMISSIONS].find({"album_id": str(album["_id"]), "status": SUB_PENDING}).sort("created_at", 1).to_list(length=100)
    vis = await _visible_tracks(mongo, [s["track_id"] for s in subs])
    nick = {}
    uids = list({s["user_id"] for s in subs})
    if uids:
        try:
            rows = await conn.fetch("SELECT id::text AS id, nickname FROM users WHERE id::text = ANY($1::text[])", uids)
            nick = {r["id"]: r["nickname"] for r in rows}
        except Exception:
            logger.warning("[ClubAlbum] nickname lookup failed club=%s", _short(cid))
    out = []
    for s in subs:
        d = vis.get(s["track_id"])
        if not d:
            continue
        out.append({"track": _serialize_track(d), "user_id": s["user_id"], "nickname": nick.get(s["user_id"]),
                    "created_at": _iso(s.get("created_at"))})
    logger.info("[ClubAlbum] submissions club=%s album=%s pending=%d", _short(cid), _short(album["_id"]), len(out))
    return {"submissions": out}


async def _weekly_reward_total(mongo, user_id: str) -> int:
    start = _week_start_utc()
    rows = await mongo.point_events.find(
        {"user_id": user_id, "action": PARTICIPATION_ACTION, "created_at": {"$gte": start}}, {"amount": 1}
    ).to_list(length=50)
    return sum(int(r.get("amount") or 0) for r in rows)


async def _decide_submission(club_id: str, album_id: str, track_id: str, current_user, approve: bool):
    mongo = get_mongo()
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    forbidden = _owner_only(club, current_user, "decide")
    if forbidden:
        return forbidden
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    aid = str(album["_id"])
    now = datetime.now(timezone.utc)
    sub = await mongo[SUBMISSIONS].find_one_and_update(
        {"album_id": aid, "track_id": str(track_id), "status": SUB_PENDING},
        {"$set": {"status": SUB_APPROVED if approve else SUB_REJECTED, "decided_at": now, "decided_by": str(current_user["id"])}},
    )
    if not sub:
        return JSONResponse(status_code=404, content={"error": "대기 중인 제출곡이 없어요."})
    member_id = sub["user_id"]
    if not approve:
        await push_notification(
            mongo, user_id=member_id, ntype=NOTIF_TYPE, actor_id=str(current_user["id"]),
            actor_nickname=current_user.get("nickname"), target_id=cid, target_type=NOTIF_TYPE,
            preview=f"앨범 「{album.get('title')}」 참여곡이 이번엔 수록되지 않았어요",
        )
        logger.info("[ClubAlbum] reject club=%s album=%s track=%s", _short(cid), _short(aid), _short(track_id))
        return {"status": SUB_REJECTED}
    await mongo[ALBUMS].update_one({"_id": album["_id"]},
                                   {"$addToSet": {"track_ids": str(track_id)}, "$set": {"updated_at": now}})
    starred = False
    reason = None
    if not await get_membership(mongo, cid, member_id):
        reason = "not_member"
    elif await _weekly_reward_total(mongo, member_id) + PARTICIPATION_REWARD > PARTICIPATION_WEEKLY_CAP:
        reason = "weekly_cap"
    else:
        starred = await credit_points(member_id, PARTICIPATION_ACTION, PARTICIPATION_REWARD, ref=aid, day="-")
        if not starred:
            reason = "already_rewarded"
    preview = f"앨범 「{album.get('title')}」에 내 곡이 수록됐어요!"
    if starred:
        preview += f" 참여 미션 ⭐{PARTICIPATION_REWARD}"
    await push_notification(
        mongo, user_id=member_id, ntype=NOTIF_TYPE, actor_id=str(current_user["id"]),
        actor_nickname=current_user.get("nickname"), target_id=cid, target_type=NOTIF_TYPE, preview=preview[:120],
    )
    logger.info("[ClubAlbum] approve club=%s album=%s track=%s member=%s starred=%s reason=%s",
                _short(cid), _short(aid), _short(track_id), _short(member_id), starred, reason)
    return {"status": SUB_APPROVED, "starred": starred, "reward": PARTICIPATION_REWARD if starred else 0, "reason": reason}


@router.post("/{club_id}/albums/{album_id}/submissions/{track_id}/approve")
async def approve_album_submission(club_id: str, album_id: str, track_id: str, current_user=Depends(get_current_user)):
    return await _decide_submission(club_id, album_id, track_id, current_user, approve=True)


@router.post("/{club_id}/albums/{album_id}/submissions/{track_id}/reject")
async def reject_album_submission(club_id: str, album_id: str, track_id: str, current_user=Depends(get_current_user)):
    return await _decide_submission(club_id, album_id, track_id, current_user, approve=False)


@router.get("/{club_id}/albums/{album_id}/eligible-tracks")
async def eligible_tracks(club_id: str, album_id: str, current_user=Depends(get_current_user)):
    """멤버 — 이 앨범에 낼 수 있는 내 곡(앨범 생성 이후 발매·공개·미제출)."""
    mongo = get_mongo()
    uid = str(current_user["id"])
    club, err = await get_club_or_404(mongo, club_id, viewer=current_user)
    if err:
        return err
    cid = str(club["_id"])
    if not await get_membership(mongo, cid, uid):
        return JSONResponse(status_code=403, content={"error": "크루 멤버만 앨범에 참여할 수 있어요."})
    album, err = await _album_or_404(mongo, cid, album_id)
    if err:
        return err
    q = {"uploader_id": uid, "is_public": {"$ne": False}, "report_blinded": {"$ne": True}}
    if isinstance(album.get("created_at"), datetime):
        q["created_at"] = {"$gte": album["created_at"]}
    docs = await mongo.tracks.find(q, _TRACK_PROJECTION).sort("created_at", -1).to_list(length=50)
    taken = set(str(t) for t in album.get("track_ids") or [])
    subs = await mongo[SUBMISSIONS].find({"album_id": str(album["_id"]), "user_id": uid}).to_list(length=50)
    status_by = {s["track_id"]: s["status"] for s in subs}
    out = []
    for d in docs:
        t = _serialize_track(d)
        t["submission_status"] = "approved" if t["id"] in taken else status_by.get(t["id"])
        out.append(t)
    logger.info("[ClubAlbum] eligible club=%s album=%s user=%s n=%d", _short(cid), _short(album["_id"]), _short(uid), len(out))
    return {"tracks": out}
