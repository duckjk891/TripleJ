import logging
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import get_current_user, get_current_user_optional
from ..database.postgres import get_pg
from ..database.mongodb import get_mongo
from ..models.playlist import PlaylistCreate, PlaylistUpdate, AddTrack

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/playlists")


# v196 ① — 재생목록 트랙 하이드레이션에 필요한 필드만 조회.
# report_blinded 는 가드 판정 전용이며 응답에는 포함하지 않는다.
_TRACK_PROJECTION = {
    "title": 1,
    "uploader_id": 1,
    "uploader_nickname": 1,
    "artist_name": 1,  # v3.229 N3 — 가수명(아티스트) 우선 표기
    "character_id": 1,  # v3.229 N4 — 앱 재생 큐 개명 즉시 반영(playerStore character_id 매칭)
    "cover_image_url": 1,
    "duration_sec": 1,
    "is_public": 1,
    "report_blinded": 1,
}


def _short(value) -> str:
    """로그 추적자 — id 앞 8자."""
    return str(value)[:8] if value else "?"


# ---------------------------------------------------------------------------
# v3.245 [Club] — 클럽 공유 플레이리스트 (PG playlists.club_id · playlist_tracks.added_by)
# 권한: 회원=트랙 추가·본인 추가분 제거·읽기 / 플리 소유자·클럽장=이름변경·삭제·모든 트랙 제거.
# 개인 플레이리스트 경로는 club_id 미보유(NULL) — 기존 동작 불변.
# ---------------------------------------------------------------------------


async def _club_role(club_id: str, user_id) -> str:
    """'owner' | 'member' | '' (비회원/조회 불가)."""
    from .clubs import get_membership

    try:
        m = await get_membership(get_mongo(), club_id, user_id)
    except Exception:
        logger.warning("[Club] playlist role lookup failed club=%s user=%s", _short(club_id), _short(user_id))
        return ""
    return (m.get("role") or "member") if m else ""


def _club_members_only_response():
    from .clubs import CLUB_MEMBERS_ONLY_CODE

    return JSONResponse(
        status_code=403,
        content={"error": "클럽 회원만 이용할 수 있습니다.", "code": CLUB_MEMBERS_ONLY_CODE},
    )


def _is_hidden_track(t: dict) -> bool:
    """v196 ① — tracks.py:49 `_is_hidden_track` 규약 준수.

    명시적 비공개(is_public=False) 또는 신고 블라인드만 숨김으로 판정한다.
    is_public 키가 없는 레거시 도큐먼트는 공개로 취급(회귀 방지 — 재생목록은
    레거시 곡을 이미 담고 있으므로 `not is_public` 식을 쓰면 안 된다)."""
    return (t.get("is_public") is False) or bool(t.get("report_blinded"))


def _serialize_track(doc: dict) -> dict:
    """v196 ① — 화이트리스트 직렬화.

    audio_url·lyrics·prompt·generation_id 등 내부 필드 전량 유출을 차단한다.
    별칭(artist_id/artist_name/cover_image)과 원본 키를 함께 내보내
    프론트 폴백 경로(SongItem)를 무손상 유지한다."""
    if doc is None:
        return None
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title"),
        "artist_id": doc.get("uploader_id"),
        # v3.229 N3 — v236 규칙 통일: 곡의 가수명(아티스트) 우선, 없으면 기획사명(닉네임) 폴백
        "artist_name": doc.get("artist_name") or doc.get("uploader_nickname") or "AI",
        "character_id": str(doc["character_id"]) if doc.get("character_id") else None,  # v3.229 N4 (없으면 null)
        "cover_image": doc.get("cover_image_url"),
        "uploader_id": doc.get("uploader_id"),
        "uploader_nickname": doc.get("uploader_nickname"),
        "cover_image_url": doc.get("cover_image_url"),
        "duration_sec": doc.get("duration_sec"),
        "is_public": doc.get("is_public", False),
    }


@router.get("/")
async def list_playlists(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    user_id = uuid.UUID(current_user["id"])
    # v3.247 대표 결정 — 내가 만든 클럽 플리도 내 목록에 포함(v3.245 의 club_id IS NULL 제외를 해제).
    # 정렬(created_at DESC)·기존 개인 플리 응답 키는 그대로, 전 항목에 club_id·club_name 키만 추가
    # (개인 플리 = null) — 앱이 배지·중복 구분에 사용. 클럽 이름은 Mongo clubs 1쿼리($in) 조인.
    rows = await conn.fetch("""
        SELECT p.id, p.user_id, p.title, p.description, p.is_public, p.created_at, p.club_id,
               (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) as track_count
        FROM playlists p WHERE p.user_id = $1 ORDER BY p.created_at DESC
    """, user_id)

    club_names = {}
    club_ids = sorted({r["club_id"] for r in rows if r["club_id"]})
    if club_ids:
        try:
            coids = [ObjectId(c) for c in club_ids if ObjectId.is_valid(c)]
            docs = await get_mongo().clubs.find({"_id": {"$in": coids}}, {"name": 1}).to_list(length=len(coids))
            club_names = {str(d["_id"]): d.get("name") for d in docs}
        except Exception:  # noqa: BLE001 — best-effort(실패 시 club_name None, 목록은 유지)
            logger.warning("[Club] my-playlists club_name lookup failed user=%s n=%d",
                           _short(current_user["id"]), len(club_ids))

    return [
        {
            "id": str(r["id"]),
            "user_id": str(r["user_id"]),
            "title": r["title"],
            "description": r["description"],
            "is_public": r["is_public"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "track_count": r["track_count"],
            "club_id": r["club_id"],
            "club_name": club_names.get(r["club_id"]) if r["club_id"] else None,
        }
        for r in rows
    ]


@router.post("/", status_code=201)
async def create_playlist(body: PlaylistCreate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    if not body.title:
        return JSONResponse(status_code=400, content={"error": "플레이리스트 제목은 필수입니다."})

    user_id = uuid.UUID(current_user["id"])

    # v3.245 [Club] — club_id 지정 시: 실존·비블라인드 클럽 + 개설자가 회원이어야 한다.
    club_id = None
    if body.club_id:
        from .clubs import get_club_or_404

        club_doc, club_err = await get_club_or_404(get_mongo(), str(body.club_id), viewer=current_user)
        if club_err:
            return club_err
        club_id = str(club_doc["_id"])
        if not await _club_role(club_id, current_user["id"]):
            logger.info("[Club] playlist create not_member club=%s user=%s", _short(club_id), _short(current_user["id"]))
            return _club_members_only_response()

    logger.info(
        "[playlists] create user=%s title_len=%d desc_len=%d club=%s",
        current_user["id"], len(body.title or ""), len(body.description or ""),
        _short(club_id) if club_id else "-",
    )
    if club_id:
        row = await conn.fetchrow(
            "INSERT INTO playlists (user_id, title, description, is_public, club_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id, title, description, is_public, created_at, club_id",
            user_id, body.title, body.description, body.is_public, club_id,
        )
        logger.info("[Club] playlist create ok club=%s playlist=%s user=%s", _short(club_id), _short(row["id"]), _short(current_user["id"]))
    else:
        row = await conn.fetchrow(
            "INSERT INTO playlists (user_id, title, description, is_public) VALUES ($1, $2, $3, $4) RETURNING id, user_id, title, description, is_public, created_at",
            user_id, body.title, body.description, body.is_public,
        )

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "description": row["description"],
        "is_public": row["is_public"],
        "club_id": club_id,
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.get("/{playlist_id}")
async def get_playlist(playlist_id: str, current_user=Depends(get_current_user_optional), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1", pl_uuid)
    if not row:
        return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})

    # v3.344 — 비로그인: 크루 플레이리스트만 열람(공개 크루 — 목록 GET /clubs/{id}/playlists 도 무인증). 개인 플리는 종전대로 401.
    # 크루 공유 링크로 온 방문자가 곡 목록을 보고 1분 미리 듣기를 할 수 있게(그 외 비로그인은 종전대로 401).
    if not current_user:
        if not row["club_id"]:
            return JSONResponse(status_code=401, content={"error": "로그인이 필요합니다."})
        if row["club_id"]:
            try:
                from .clubs import get_club_or_404
                _cdoc, _cerr = await get_club_or_404(get_mongo(), str(row["club_id"]), viewer=None)
                if _cerr:
                    return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
            except Exception:
                logger.warning("[playlists] guest club check failed id=%s", _short(playlist_id))
                return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
    else:
        user_id = uuid.UUID(current_user["id"])
        if not row["is_public"] and row["user_id"] != user_id:
            # v3.245 [Club] — 클럽 플레이리스트는 회원이면 비공개여도 읽기 가능
            if not (row["club_id"] and await _club_role(row["club_id"], current_user["id"])):
                return JSONResponse(status_code=403, content={"error": "비공개 플레이리스트입니다."})

    # v3.345 크루 플리 — 크루 멤버(크루장 포함)는 미발매(비공개) 곡도 보고 재생, 비멤버는 대표곡만 1분 미리 듣기
    club_member = False
    if row["club_id"] and current_user:
        club_member = bool(await _club_role(row["club_id"], current_user["id"]))

    # Get track IDs from PostgreSQL (v3.245 — added_by 는 클럽 플레이리스트 표시·권한용)
    track_rows = await conn.fetch(
        "SELECT track_id, position, added_by FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position",
        pl_uuid,
    )

    # Cross-query MongoDB for track details
    tracks = []
    hidden_skipped = 0
    viewer_id = str(current_user["id"]) if current_user else ""
    if track_rows:
        track_ids = [ObjectId(r["track_id"]) for r in track_rows if ObjectId.is_valid(r["track_id"])]
        mongo = get_mongo()
        docs = await mongo.tracks.find(
            {"_id": {"$in": track_ids}}, _TRACK_PROJECTION
        ).to_list(length=len(track_ids))
        docs_map = {str(d["_id"]): d for d in docs}

        for r in track_rows:
            doc = docs_map.get(r["track_id"])
            if not doc:
                continue
            # v196 ① — 타인의 비공개·블라인드 곡은 배열에서 제외(마스킹 아님).
            # 본인 곡은 비공개여도 본인 재생목록에서 계속 보인다.
            # v3.345: 크루 플리의 미발매(비공개) 곡은 크루 멤버에게 보인다 — 신고 블라인드는 종전대로 제외.
            if _is_hidden_track(doc) and doc.get("uploader_id") != viewer_id:
                if not (club_member and not doc.get("report_blinded")):
                    hidden_skipped += 1
                    continue
            t = _serialize_track(doc)
            t["position"] = r["position"]
            if row["club_id"]:
                t["added_by"] = str(r["added_by"]) if r["added_by"] else None  # v3.245 클럽 전용 키
                t["unreleased"] = doc.get("is_public") is False  # v3.345 미발매 표시(레거시 키 없음 = 공개)
            tracks.append(t)

    # v3.345 대표곡 — 지정곡이 목록에 있고 발매(공개)곡이면 그 곡, 아니면 첫 발매곡. 비멤버는 대표곡 외 locked.
    extra = {}
    if row["club_id"]:
        stored_rep = dict(row).get("representative_track_id")
        public_ids = [t["id"] for t in tracks if not t.get("unreleased")]
        rep_id = stored_rep if stored_rep in public_ids else (public_ids[0] if public_ids else None)
        if not club_member:
            for t in tracks:
                t["locked"] = t["id"] != rep_id
        extra = {
            "representative_track_id": rep_id,
            "representative_set": bool(stored_rep) and rep_id == stored_rep,
            "viewer_is_member": club_member,
        }
        if stored_rep and rep_id != stored_rep:
            logger.info("[playlists] rep fallback id=%s stored=%s effective=%s", _short(playlist_id), _short(stored_rep), _short(rep_id))

    logger.info(
        "[playlists] detail id=%s user=%s tracks=%d hidden_skipped=%d club_member=%s rep=%s",
        _short(playlist_id), _short(viewer_id), len(tracks), hidden_skipped, club_member,
        _short(extra.get("representative_track_id") or ""),
    )

    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "title": row["title"],
        "description": row["description"],
        "is_public": row["is_public"],
        "club_id": row["club_id"],  # v3.245 — 개인 플레이리스트는 NULL(키 추가만)
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "tracks": tracks,
        **extra,
    }


@router.put("/{playlist_id}")
async def update_playlist(playlist_id: str, body: PlaylistUpdate, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        # v3.245 [Club] — 클럽 플레이리스트는 클럽장도 이름·설정 변경 가능(그 외는 기존 404 동일)
        row = await conn.fetchrow("SELECT * FROM playlists WHERE id = $1 AND club_id IS NOT NULL", pl_uuid)
        if not row or await _club_role(row["club_id"], current_user["id"]) != "owner":
            return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
        logger.info("[Club] playlist update by_club_owner club=%s playlist=%s user=%s",
                    _short(row["club_id"]), _short(playlist_id), _short(current_user["id"]))

    title = body.title if body.title is not None else row["title"]
    is_public = body.is_public if body.is_public is not None else row["is_public"]
    description = body.description if body.description is not None else row["description"]

    # v3.345 대표곡 지정 — 이 플리에 담긴 발매(공개) 곡만. "" = 해제(첫 곡 기본)
    rep_id = dict(row).get("representative_track_id")
    if body.representative_track_id is not None:
        want = body.representative_track_id.strip()
        if not want:
            rep_id = None
        else:
            in_pl = await conn.fetchval(
                "SELECT 1 FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2", pl_uuid, want,
            )
            doc = await get_mongo().tracks.find_one(
                {"_id": ObjectId(want)}, {"is_public": 1, "report_blinded": 1},
            ) if (in_pl and ObjectId.is_valid(want)) else None
            if not doc:
                logger.info("[playlists] rep rejected not_in_playlist id=%s track=%s", _short(playlist_id), _short(want))
                return JSONResponse(status_code=400, content={"error": "이 플레이리스트에 담긴 곡만 대표곡으로 지정할 수 있어요."})
            if _is_hidden_track(doc):
                logger.info("[playlists] rep rejected unreleased id=%s track=%s", _short(playlist_id), _short(want))
                return JSONResponse(status_code=400, content={"error": "미발매곡은 대표곡으로 지정할 수 없어요. 대표곡은 크루 밖 사람도 미리 듣는 곡이에요."})
            rep_id = want
        logger.info("[playlists] rep set id=%s track=%s user=%s", _short(playlist_id), _short(rep_id or ""), _short(current_user["id"]))

    logger.info(
        "[playlists] update id=%s user=%s title_len=%d desc_len=%d",
        playlist_id, current_user["id"], len(title or ""), len(description or ""),
    )

    updated = await conn.fetchrow(
        "UPDATE playlists SET title = $1, is_public = $2, description = $3, representative_track_id = $5 WHERE id = $4 RETURNING id, user_id, title, description, is_public, created_at, representative_track_id",
        title, is_public, description, pl_uuid, rep_id,
    )

    return {
        "id": str(updated["id"]),
        "user_id": str(updated["user_id"]),
        "title": updated["title"],
        "description": updated["description"],
        "is_public": updated["is_public"],
        "created_at": updated["created_at"].isoformat() if updated["created_at"] else None,
        "representative_track_id": updated["representative_track_id"],  # v3.345
    }


@router.delete("/{playlist_id}")
async def delete_playlist(playlist_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        # v3.245 [Club] — 클럽 플레이리스트는 클럽장도 삭제 가능(그 외는 기존 404 동일)
        crow = await conn.fetchrow("SELECT id, club_id FROM playlists WHERE id = $1 AND club_id IS NOT NULL", pl_uuid)
        if not crow or await _club_role(crow["club_id"], current_user["id"]) != "owner":
            return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
        logger.info("[Club] playlist delete by_club_owner club=%s playlist=%s user=%s",
                    _short(crow["club_id"]), _short(playlist_id), _short(current_user["id"]))

    await conn.execute("DELETE FROM playlists WHERE id = $1", pl_uuid)
    return {"message": "플레이리스트가 삭제되었습니다."}


@router.post("/{playlist_id}/tracks", status_code=201)
async def add_track(playlist_id: str, body: AddTrack, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id, club_id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    club_pl = row["club_id"] if row else None
    if not row:
        # v3.245 [Club] — 클럽 플레이리스트는 회원 누구나 트랙 추가 가능(added_by 기록)
        crow = await conn.fetchrow("SELECT id, club_id FROM playlists WHERE id = $1 AND club_id IS NOT NULL", pl_uuid)
        if not crow:
            return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
        if not await _club_role(crow["club_id"], current_user["id"]):
            logger.info("[Club] playlist add_track not_member club=%s playlist=%s user=%s",
                        _short(crow["club_id"]), _short(playlist_id), _short(current_user["id"]))
            return _club_members_only_response()
        club_pl = crow["club_id"]

    # Verify track exists in MongoDB
    if not ObjectId.is_valid(body.track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    track = await mongo.tracks.find_one({"_id": ObjectId(body.track_id)}, _TRACK_PROJECTION)
    if not track:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # v196 ① — 타인의 비공개·블라인드 곡은 재생목록에 담을 수 없다.
    if _is_hidden_track(track) and track.get("uploader_id") != str(current_user["id"]):
        logger.info(
            "[playlists] add_track private_denied user=%s track=%s",
            _short(current_user["id"]), _short(body.track_id),
        )
        return JSONResponse(status_code=400, content={"error": "다른 사용자의 비공개 곡은 사용할 수 없습니다."})

    # Check duplicate
    existing = await conn.fetchrow(
        "SELECT playlist_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, body.track_id,
    )
    if existing:
        return JSONResponse(status_code=409, content={"error": "이미 추가된 트랙입니다."})

    # Get next position
    max_pos = await conn.fetchval("SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = $1", pl_uuid)
    position = (max_pos or 0) + 1

    if club_pl:
        # v3.245 [Club] — 추가자 기록(본인 추가분 제거 권한·표시용)
        await conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by) VALUES ($1, $2, $3, $4)",
            pl_uuid, body.track_id, position, user_id,
        )
        logger.info(
            "[Club] playlist add_track ok club=%s playlist=%s user=%s track=%s position=%d",
            _short(club_pl), _short(playlist_id), _short(current_user["id"]), _short(body.track_id), position,
        )
    else:
        await conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, $3)",
            pl_uuid, body.track_id, position,
        )

    # v111: 플레이리스트 추가 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    logger.info(
        "[playlists] add_track ok user=%s track=%s position=%d",
        _short(current_user["id"]), _short(body.track_id), position,
    )
    return {"message": "트랙이 추가되었습니다."}


@router.delete("/{playlist_id}/tracks/{track_id}")
async def remove_track(playlist_id: str, track_id: str, current_user=Depends(get_current_user), conn=Depends(get_pg)):
    try:
        pl_uuid = uuid.UUID(playlist_id)
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 플레이리스트 ID입니다."})

    user_id = uuid.UUID(current_user["id"])
    row = await conn.fetchrow("SELECT id FROM playlists WHERE id = $1 AND user_id = $2", pl_uuid, user_id)
    if not row:
        # v3.245 [Club] — 클럽 플레이리스트: 본인 추가분은 회원 본인이, 나머지는
        # 플리 소유자(위에서 통과)·클럽장만 제거 가능. 그 외는 기존 404 동일.
        crow = await conn.fetchrow("SELECT id, club_id FROM playlists WHERE id = $1 AND club_id IS NOT NULL", pl_uuid)
        if not crow:
            return JSONResponse(status_code=404, content={"error": "플레이리스트를 찾을 수 없습니다."})
        role = await _club_role(crow["club_id"], current_user["id"])
        if not role:
            return _club_members_only_response()
        if role != "owner":
            trow = await conn.fetchrow(
                "SELECT added_by FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
                pl_uuid, track_id,
            )
            if not trow:
                return JSONResponse(status_code=404, content={"error": "플레이리스트에 해당 트랙이 없습니다."})
            if not trow["added_by"] or trow["added_by"] != user_id:
                logger.info("[Club] playlist remove_track forbidden club=%s playlist=%s user=%s",
                            _short(crow["club_id"]), _short(playlist_id), _short(current_user["id"]))
                return JSONResponse(status_code=403, content={"error": "본인이 추가한 트랙만 제거할 수 있습니다."})
        logger.info("[Club] playlist remove_track club=%s playlist=%s user=%s role=%s track=%s",
                    _short(crow["club_id"]), _short(playlist_id), _short(current_user["id"]), role, _short(track_id))

    result = await conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2",
        pl_uuid, track_id,
    )

    if result == "DELETE 0":
        return JSONResponse(status_code=404, content={"error": "플레이리스트에 해당 트랙이 없습니다."})
    return {"message": "트랙이 제거되었습니다."}
