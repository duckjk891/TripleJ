import asyncio
import re
import io
import json
import logging
import math
import mimetypes
import os
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, Header, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..auth import get_current_user, get_current_user_optional
from ..config import settings
from ..database.mongodb import get_mongo
from ..database.redis import get_redis
from ..database.minio import get_minio
from ..database.postgres import get_pg
from ..services import gen_jobs as gj  # v3.228 — 영상 요청 원장·중복 차단 / Inst 죽은 작업 정리
from ..services.media_urls import browser_video_url, internal_presign
from ..services import kids_policy  # v3.232 F3·F6 — 어린이 곡 댓글·음원 업로드(킬 스위치 OFF 면 no-op)
from ..services.word_filter import social_filter_on, word_filter_response  # v3.232 G1 · v3.233 소통 경로 전체 적용

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
    # v236 — 곡에 기록된 아티스트명(발매 시 character 해석값) 우선, 없으면 기획사명(닉네임) 폴백
    #        (대표 확정 2026-09-11: 아티스트 미지정 곡은 기획사명으로 차트 표기가 맞다).
    doc["agency_name"] = doc.get("uploader_nickname", "AI")
    doc["artist_name"] = doc.get("artist_name") or doc.get("uploader_nickname", "AI")
    doc["cover_image"] = doc.get("cover_image_url")
    # v137 — 신고 블라인드 플래그 (소유자 사유 표시용, 기본 false)
    doc["report_blinded"] = bool(doc.get("report_blinded", False))
    # B-11 — 소속 앨범 (기본 null, _attach_album_info 가 배치 역조회로 채움)
    doc.setdefault("album_id", None)
    doc.setdefault("album_title", None)
    return doc


async def _attach_album_info(mongo, tracks: list) -> None:
    """B-11 — 직렬화된 트랙 dict 목록에 album_id/album_title 배치 첨부.

    albums.track_ids(멀티키 인덱스, main.py 보장) 역조회 **1쿼리** 후 매핑 —
    목록 직렬화에서 곡당 개별 쿼리 금지 (_attach_uploader_profiles 패턴).
    곡이 여러 앨범에 속하면 최신(created_at DESC) 앨범 1개, 무소속은 null.
    best-effort — 실패해도 응답은 깨지 않는다 (null 유지).
    """
    items = [t for t in tracks if t and t.get("id")]
    for t in items:
        t["album_id"] = None
        t["album_title"] = None
    if not items:
        return
    ids = list({t["id"] for t in items})
    try:
        cursor = mongo.albums.find(
            {"track_ids": {"$in": ids}},
            {"track_ids": 1, "title": 1, "created_at": 1},
        ).sort("created_at", -1)
        albums = await cursor.to_list(length=1000)
    except Exception:
        logger.warning("[tracks] album attach failed n=%d", len(ids))
        return
    album_by_track = {}
    for a in albums:  # 최신 앨범 우선 — 먼저 매핑된 것이 승리
        aid = str(a["_id"])
        title = a.get("title") or ""
        for tid in a.get("track_ids") or []:
            if tid not in album_by_track:
                album_by_track[tid] = (aid, title)
    for t in items:
        hit = album_by_track.get(t["id"])
        if hit:
            t["album_id"], t["album_title"] = hit


async def _build_character_snapshot(mongo, user_id: str, character_id: str):
    """v236 — 발매/업로드 시점의 아티스트 착장 스냅샷을 characters 도큐먼트로부터 생성.

    mv_jobs.user_character_snapshot 과 동일 shape (get_track 의 cover_character
    폴백이 그대로 읽는다). 시트는 SnapFix 관행대로 불변 경로로 복사(best-effort).
    실패/미발견 시 None — 발매는 절대 막지 않는다.
    """
    try:
        from .character import _find_artist_by_cid
        artist = await _find_artist_by_cid(mongo, user_id, character_id)
        if not artist:
            logger.warning(
                "[SongSource] snapshot char not found user=%s cid=%s",
                user_id[:8], character_id[:36],
            )
            return None
        sheet = artist.get("sheet_object_name")
        copied = None
        if sheet:
            try:
                from ..services.snapshot_service import snapshot_sheet_copy
                copied = snapshot_sheet_copy(get_minio(), user_id, sheet)
            except Exception:
                logger.warning("[SongSource] snapshot sheet copy failed cid=%s", character_id[:36])
        snap = {
            "name": artist.get("name") or "",
            "age": artist.get("age") or "",
            "gender": artist.get("gender") or "",
            "personality_tags": artist.get("personality_tags") or [],
            "personality_text": artist.get("personality_text") or "",
            "sheet_object_name": copied or sheet,
            "used_items": artist.get("used_items") or [],
            "character_id": character_id,
        }
        if copied:
            snap["sheet_object_name_origin"] = sheet
        logger.info(
            "[SongSource] snapshot built cid=%s items=%d has_sheet=%s",
            character_id[:36], len(snap["used_items"]), bool(snap["sheet_object_name"]),
        )
        return snap
    except Exception:
        logger.exception("[SongSource] snapshot build failed cid=%s", (character_id or "")[:36])
        return None


# v3.234 — 곡 스타일링 = 곡 커버에 쓰인 착장. 커버 대화에서 옷을 갈아입힌 뒤 만든 커버를
# 곡에 붙이면 tracks.user_character_snapshot 도 그 착장으로 교체한다(대표 D1·D2·D5 기본값).
_PERMANENT_SHEET_RE = re.compile(r"^characters/([^/]+)/([0-9a-f]{32})/sheet\.png$")


def _naive_utc(dt):
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def _cover_outfit_snapshot(mongo, user_id: str, cover_value: str, track: dict, allow_legacy: bool = True):
    """v3.234 S2·S3 결정 함수 — 커버(cover_sessions 산출물)에 쓰인 착장 스냅샷을 곡에 적용할지.

    반환 (snap|None, src, reason). snap 이 None 이면 곡 스냅샷 무변경.
    - 곡 아티스트 = track.character_id → 없으면 기존 스냅샷 character_id.
    - ① 세션 character_snapshot(v3.234 이후 생성분) 의 character_id == 곡 아티스트 → 채택(src=session).
    - 세션에 character_snapshot_state 가 있으면(v3.234 이후 생성분인데 스냅샷 없음 — 인물 없음·
      가상 슬롯·옷 변경 중 생성·실패) 구세션 추정을 하지 않는다 → 무변경.
    - ② 구세션: gen_params.character_object_name 이 같은 아티스트 permanent 시트이고 그 시트의
      MinIO last_modified ≤ 세션 created_at(=커버 생성 시점, refine 은 같은 착장) 이면 현재
      characters 로 재구성(src=legacy_session). 커버 이후 시트가 바뀐 곡(가을산 밤바람)은 무변경.
    - ③ 아티스트 불일치·캐릭터 미포함 커버·세션 없음 = 무변경.
    - ④ v3.255 — 곡 아티스트가 아예 없는 곡(character_id null·스냅샷 없음, 보이스 만료 스킵 발매 등)에
      아티스트 인물 커버(세션 character_snapshot 에 character_id + used_items 보유)가 붙으면 그 세션
      스냅샷을 채택한다(src=session, reason=session_artist_no_track_artist — 커버가 착장을 정한다는
      v3.234 원칙의 확장). track.character_id / artist_name 은 절대 세팅하지 않는다(v3.242 무아티스트
      발매 정책 유지 — 표기는 기획사명). used_items 가 빈 세션 스냅샷은 채택하지 않는다(채택해도
      _styling_precheck ② no_snapshot 미노출 — 빈 케이스 의미 불변 유지).
    채택 시 name 은 현재 characters.name(v3.229 개명 동기화 정합). 예외는 호출측에서 격리.
    """
    if not cover_value:
        return None, "none", "no_cover"
    old = track.get("user_character_snapshot") if isinstance(track.get("user_character_snapshot"), dict) else {}
    target_cid = (track.get("character_id") or old.get("character_id") or "").strip().lower()
    if not target_cid:
        # v3.255 ④ — 무아티스트 곡: 커버 세션 스냅샷(아티스트+착장)이 있으면 그대로 채택.
        sess0 = await mongo.cover_sessions.find_one(
            {
                "user_id": user_id,
                "$or": [
                    {"cover_object_name": cover_value},
                    {"cover_refine_history.object_name": cover_value},
                ],
            },
            {"character_snapshot": 1},
        )
        snap0 = (sess0 or {}).get("character_snapshot")
        if isinstance(snap0, dict) and snap0.get("character_id") and (snap0.get("used_items") or []):
            from .character import _find_artist_by_cid

            adopt_cid = (snap0.get("character_id") or "").strip().lower()
            new_snap = dict(snap0)
            artist = await _find_artist_by_cid(mongo, user_id, adopt_cid)
            if artist and artist.get("name"):
                new_snap["name"] = artist.get("name")
            logger.info(
                "[CoverOutfitSnap] track=%s cid=%s src=session decision=adopt "
                "reason=session_artist_no_track_artist items=%d",
                str(track.get("_id") or "")[:8], adopt_cid[:8],
                len(new_snap.get("used_items") or []),
            )
            return new_snap, "session", "session_artist_no_track_artist"
        return None, "none", "no_track_artist"
    sess = await mongo.cover_sessions.find_one(
        {
            "user_id": user_id,
            "$or": [
                {"cover_object_name": cover_value},
                {"cover_refine_history.object_name": cover_value},
            ],
        },
        {"character_snapshot": 1, "character_snapshot_state": 1, "gen_params": 1, "created_at": 1},
    )
    if not sess:
        return None, "none", "session_not_found"

    from .character import _find_artist_by_cid

    snap = sess.get("character_snapshot")
    if isinstance(snap, dict) and snap.get("character_id"):
        if (snap.get("character_id") or "").strip().lower() != target_cid:
            return None, "session", "cid_mismatch"
        new_snap = dict(snap)
        artist = await _find_artist_by_cid(mongo, user_id, target_cid)
        if artist and artist.get("name"):
            new_snap["name"] = artist.get("name")
        return new_snap, "session", "session_snapshot"
    if "character_snapshot_state" in sess:
        return None, "session", "session_" + str(sess.get("character_snapshot_state") or "none")[:32]

    if not allow_legacy:
        return None, "legacy_session", "legacy_disabled"
    cpath = ((sess.get("gen_params") or {}).get("character_object_name") or "").strip()
    m = _PERMANENT_SHEET_RE.match(cpath)
    if not m or m.group(1) != user_id:
        return None, "legacy_session", "no_permanent_sheet"
    if m.group(2) != target_cid:
        return None, "legacy_session", "cid_mismatch"
    artist = await _find_artist_by_cid(mongo, user_id, target_cid)
    if not artist:
        return None, "legacy_session", "artist_missing"
    if (artist.get("sheet_object_name") or "") != cpath:
        return None, "legacy_session", "sheet_path_changed"
    created = _naive_utc(sess.get("created_at"))
    if created is None:
        return None, "legacy_session", "session_time_missing"
    try:
        lm = _naive_utc(get_minio().stat_object(settings.minio_bucket_images, cpath).last_modified)
    except Exception:
        lm = None
    if lm is None:
        return None, "legacy_session", "sheet_stat_failed"
    if lm > created:
        return None, "legacy_session", "sheet_changed_after_cover"
    new_snap = await _build_character_snapshot(mongo, user_id, target_cid)
    if not new_snap or not new_snap.get("sheet_object_name_origin"):
        return None, "legacy_session", "build_failed"  # 시트 불변 복사 실패 포함
    return new_snap, "legacy_session", "sheet_unchanged_since_cover"


def _log_cover_outfit(track_id: str, cid: str, src: str, snap, reason: str, old) -> None:
    logger.info(
        "[CoverOutfitSnap] track=%s cid=%s src=%s decision=%s reason=%s items %d→%s",
        (track_id or "")[:8], (cid or "")[:8], src, "apply" if snap else "skip", reason,
        len((old or {}).get("used_items") or []),
        len(snap.get("used_items") or []) if snap else "-",
    )


# v3.235 S5·S6 — 발매 시점에 진행 중이던 같은 아티스트 옷 입히기(작곡 중 옷 변경)는 저장되는 순간
# 그 곡 스타일링에 반영(대표 D1). 발매 뒤 새로 시작한 옷 입히기·24h 경과 = 동결(D2).
# 추적 표시는 별도 컬렉션 track_outfit_follows {track_id, user_id, character_id, job_id, until, armed_at}
# (tracks 문서에 두면 charts·likes·playlists·albums·admin 의 전체 문서 직렬화로 응답에 섞인다 — 응답 불변 원칙).
OUTFIT_FOLLOW_COLLECTION = "track_outfit_follows"
OUTFIT_FOLLOW_JOB_WINDOW = timedelta(hours=2)  # 발매 전 2h 안에 시작된 job 만(옷 입히기 4~7분)
OUTFIT_FOLLOW_TTL = timedelta(hours=24)  # 발매 후 24h 안에 저장돼야 반영
_CID32_RE = re.compile(r"^[0-9a-f]{32}$")


async def _arm_outfit_follow(mongo, user_id: str, cid: str, track_id: str, now: datetime):
    """v3.235 S5 — 발매 시 같은 아티스트의 미소비 옷 입히기 job(processing|done) 최신 1건 → 추적 표시 doc.

    반환 dict|None(호출측이 곡 insert 뒤 track_outfit_follows 에 저장). 조회 실패·대상 없음 = None —
    발매는 절대 막지 않는다.
    """
    try:
        cid_n = (cid or "").strip().lower()
        if not _CID32_RE.match(cid_n):
            return None
        now_n = _naive_utc(now) or datetime.utcnow()
        job = await mongo.character_jobs.find_one(
            {
                "user_id": user_id,
                "character_id": cid_n,
                "status": {"$in": ["processing", "done"]},
                "consumed_at": {"$exists": False},
                "dismissed_at": {"$exists": False},
                "refunded": {"$ne": True},
                "created_at": {"$gte": now_n - OUTFIT_FOLLOW_JOB_WINDOW},
            },
            {"_id": 1, "status": 1, "created_at": 1},
            sort=[("created_at", -1)],
        )
        if not job:
            return None
        follow = {
            "track_id": str(track_id),
            "user_id": user_id,
            "character_id": cid_n,
            "job_id": str(job["_id"]),
            "until": now_n + OUTFIT_FOLLOW_TTL,
            "armed_at": now_n,
        }
        logger.info(
            "[OutfitFollow] armed track=%s cid=%s job=%s status=%s",
            (track_id or "")[:8], cid_n[:8], follow["job_id"], job.get("status"),
        )
        return follow
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[OutfitFollow] arm failed track=%s err=%s: %s — publish continues",
            (track_id or "")[:8], type(e).__name__, str(e)[:160],
        )
        return None


async def _cover_person_cid(mongo, user_id: str, cover_value):
    """v3.235 S6 — 곡 커버에 들어간 아티스트 cid 판정(v3.234 세션 기록 재사용).

    반환 (cid|""|None, reason): cid = 그 아티스트 인물 커버 · "" = 아티스트 인물 없음(커버 없음·파일 커버·
    인물 없이·캐릭터 미포함) · None = 인물은 있으나 누구인지 모름(가상 슬롯·레거시 경로 등 — 보수적 skip).
    """
    if not cover_value:
        return "", "no_cover"
    sess = await mongo.cover_sessions.find_one(
        {
            "user_id": user_id,
            "$or": [
                {"cover_object_name": cover_value},
                {"cover_refine_history.object_name": cover_value},
            ],
        },
        {"character_snapshot": 1, "character_snapshot_state": 1, "gen_params": 1},
    )
    if not sess:
        return "", "file_cover"
    snap = sess.get("character_snapshot")
    if isinstance(snap, dict) and snap.get("character_id"):
        return (snap.get("character_id") or "").strip().lower(), "session_snapshot"
    state = sess.get("character_snapshot_state")
    if state in ("no_person", "no_character"):
        return "", "session_" + state
    cpath = ((sess.get("gen_params") or {}).get("character_object_name") or "").strip()
    if not cpath:
        return "", "no_character"
    m = _PERMANENT_SHEET_RE.match(cpath)
    if m and m.group(1) == user_id:
        return m.group(2), "permanent_sheet"
    return None, "person_unknown"


# v3.238 S1 — 스타일링(착장) 노출 = 곡 커버 이미지에 곡 아티스트가 들어간 곡만(대표 D1 변경 — v3.235 D1
# "커버 없으면 발매 때 옷" 폐기). 착장 데이터(user_character_snapshot)는 지우지도 고치지도 않고 읽기 시점에
# 노출만 판정한다(D2 — 소급·DB 쓰기 0, 코드 롤백으로 즉시 원복). 커버 판정 재료 = _cover_person_cid 와 같은
# cover_sessions 기록. 판정 불가(레거시 가상·기타 경로) = 미노출(D3 보수) — 단 커버 시트가 곡 스냅샷 원본 시트거나
# 곡 아티스트의 현재 시트면 같은 아티스트로 인정(방학하면 바다가자 — 레거시 가상 시트).
# reason: mv_character | no_snapshot | no_cover | file_cover | cover_artist | cover_artist_sheet |
#         cover_other_artist | cover_no_artist | cover_person_unknown  (get_track 판정 예외 = error)
STYLING_VISIBLE_REASONS = ("mv_character", "cover_artist", "cover_artist_sheet")
STYLING_HIDDEN_REASONS = ("no_snapshot", "no_cover", "file_cover", "cover_other_artist",
                          "cover_no_artist", "cover_person_unknown", "error")


def _styling_target_cid(track: dict) -> str:
    """곡 아티스트 cid — track.character_id → 없으면 스냅샷 character_id(소문자). 없으면 ""."""
    snap = track.get("user_character_snapshot") if isinstance(track.get("user_character_snapshot"), dict) else {}
    return (track.get("character_id") or snap.get("character_id") or "").strip().lower()


def _styling_precheck(track: dict, mv_job=None):
    """S1 ①~④ 순수 판정 — (visible, reason) 또는 None(커버 세션 조회가 필요)."""
    if (
        mv_job
        and mv_job.get("include_my_character") is True
        and mv_job.get("user_character_snapshot")
    ):
        return True, "mv_character"  # ① 부착 MV(아티스트 포함) 스냅샷 — 현행 1순위 유지(D4)
    snap = track.get("user_character_snapshot") if isinstance(track.get("user_character_snapshot"), dict) else None
    if not snap or not (snap.get("used_items") or []):
        return False, "no_snapshot"  # ② 보여줄 착장 자체가 없음
    if not (track.get("cover_image_url") or "").strip():
        return False, "no_cover"  # ④
    return None


def _styling_decide_session(track: dict, sess, artist=None) -> tuple:
    """S1 ⑤~⑨ 순수 판정 — sess = cover_sessions 문서(없으면 None), artist = 곡 아티스트 characters 문서(⑨ 보조, 선택).

    ⑤ 세션 없음(파일·직접 업로드 커버) → 미노출 ⑥ 세션 character_snapshot cid 일치/불일치
    ⑦ state no_person·no_character 또는 character_object_name 없음 → 미노출 ⑧ 본인 permanent 시트 cid 일치/불일치
    ⑨ 그 밖(레거시 가상·스냅샷 경로·not_permanent·outfit_changed·failed): 커버 시트 경로 ∈ {스냅샷 원본 시트,
       스냅샷 시트, 곡 아티스트 현재 sheet/virtual_sheet} → 노출, 아니면 미노출(누군지 모름 — 보수).
    """
    if not sess:
        return False, "file_cover"
    target = _styling_target_cid(track)
    cs = sess.get("character_snapshot")
    if target and isinstance(cs, dict) and cs.get("character_id"):
        if (cs.get("character_id") or "").strip().lower() == target:
            return True, "cover_artist"
        return False, "cover_other_artist"
    state = sess.get("character_snapshot_state")
    cpath = ((sess.get("gen_params") or {}).get("character_object_name") or "").strip()
    if state in ("no_person", "no_character") or not cpath:
        return False, "cover_no_artist"
    m = _PERMANENT_SHEET_RE.match(cpath)
    if target and m and m.group(1) == (track.get("uploader_id") or ""):
        if m.group(2) == target:
            return True, "cover_artist_sheet"
        return False, "cover_other_artist"
    snap = track.get("user_character_snapshot") if isinstance(track.get("user_character_snapshot"), dict) else {}
    sheets = {snap.get("sheet_object_name_origin"), snap.get("sheet_object_name")}
    if isinstance(artist, dict):
        sheets |= {artist.get("sheet_object_name"), artist.get("virtual_sheet_object_name")}
    sheets = {(s or "").strip() for s in sheets} - {""}
    if cpath in sheets:
        return True, "cover_artist_sheet"
    return False, "cover_person_unknown"


async def _styling_visibility(mongo, track: dict, mv_job=None) -> tuple:
    """v3.238 S1 — 곡 스타일링(착장) 노출 여부 (visible: bool, reason: str).

    track = tracks 문서(또는 _serialize_track 결과 — uploader_id·character_id·cover_image_url·
    user_character_snapshot 사용), mv_job = 부착 MV(get_track 의 _find_attached_mv 결과, 없으면 None).
    DB 조회: 커버 세션 1회(커버·착장이 있을 때만) + ⑨ 에서 스냅샷 시트로 못 가릴 때만 아티스트 1회. 쓰기 0.
    예외는 호출측이 격리(get_track = 미노출·캐시 미저장, 광고 집계 = 제외).
    """
    pre = _styling_precheck(track, mv_job)
    if pre is not None:
        return pre
    uid = track.get("uploader_id") or ""
    cover_value = (track.get("cover_image_url") or "").strip()
    sess = await mongo.cover_sessions.find_one(
        {
            "user_id": uid,
            "$or": [
                {"cover_object_name": cover_value},
                {"cover_refine_history.object_name": cover_value},
            ],
        },
        {"character_snapshot": 1, "character_snapshot_state": 1, "gen_params": 1},
    )
    visible, reason = _styling_decide_session(track, sess, None)
    if reason == "cover_person_unknown":
        target = _styling_target_cid(track)
        if target and uid:
            from .character import _find_artist_by_cid

            artist = await _find_artist_by_cid(mongo, uid, target)
            if artist:
                visible, reason = _styling_decide_session(track, sess, artist)
    return visible, reason


async def apply_outfit_follow(mongo, user_id: str, cid: str, job_id: str, via: str) -> int:
    """v3.235 S6 — 옷 입히기 job 이 아티스트에 저장(save 경로①·③)된 직후 호출.

    track_outfit_follows(job_id, user_id) 표시 곡마다: 곡 아티스트 불일치·기한 경과·같은 아티스트 인물 커버
    (커버가 착장을 정함 — cover_owns)·인물 판정 불가 → skip, 아니면 현재 착장으로 스냅샷 교체(시트 불변 복사,
    name = 현재 이름) + 곡 캐시 2키 삭제. 어느 쪽이든 표시 doc 은 삭제(job 은 이미 소비돼 다시 오지 않음 —
    같은 시트 재저장도 추가 변경 0). 반환 = 적용 곡 수. 전 과정 best-effort — save 응답·과금·consume 표시 불변.
    """
    applied = 0
    try:
        if not job_id or not cid:
            return 0
        cid_n = (cid or "").strip().lower()
        coll = mongo[OUTFIT_FOLLOW_COLLECTION]
        marks = await coll.find({"user_id": user_id, "job_id": job_id}).to_list(length=20)
        if not marks:
            return 0
        now_n = datetime.utcnow()
        for mk in marks:
            tid = str(mk.get("track_id") or "")
            try:
                snap, reason, old = None, None, None
                t = None
                if ObjectId.is_valid(tid):
                    t = await mongo.tracks.find_one(
                        {"_id": ObjectId(tid), "uploader_id": user_id},
                        {"character_id": 1, "cover_image_url": 1, "user_character_snapshot": 1},
                    )
                until = _naive_utc(mk.get("until"))
                if not t:
                    reason = "track_missing"
                else:
                    old = t.get("user_character_snapshot") if isinstance(t.get("user_character_snapshot"), dict) else None
                    tcid = (t.get("character_id") or mk.get("character_id") or "").strip().lower()
                    if tcid != cid_n:
                        reason = "cid_mismatch"
                    elif until is None or until < now_n:
                        reason = "expired"
                    else:
                        pcid, preason = await _cover_person_cid(mongo, user_id, t.get("cover_image_url"))
                        if pcid is None:
                            reason = "cover_" + preason
                        elif pcid and pcid == cid_n:
                            reason = "cover_owns"  # 같은 아티스트 인물 커버 — 커버가 착장을 정한다
                        else:
                            snap = await _build_character_snapshot(mongo, user_id, cid_n)
                            if not snap or not snap.get("sheet_object_name_origin"):
                                snap, reason = None, "build_failed"  # 시트 불변 복사 실패 — 가변 경로를 곡에 남기지 않음
                            else:
                                reason = "follow_" + (preason or "no_cover")
                if snap:
                    await mongo.tracks.update_one(
                        {"_id": t["_id"], "uploader_id": user_id}, {"$set": {"user_character_snapshot": snap}},
                    )
                    applied += 1
                    try:
                        _r = get_redis()
                        await _r.delete(f"cache:track:{tid}")
                        await _r.delete(f"cache:track:v4:{tid}")
                    except Exception:  # noqa: BLE001
                        logger.warning("[OutfitFollow] cache delete failed track=%s", tid[:8])
                try:
                    await coll.delete_one({"_id": mk["_id"]})
                except Exception:  # noqa: BLE001 — 남아도 무해(다음 같은 job 저장 시 같은 판정)
                    logger.warning("[OutfitFollow] mark delete failed track=%s", tid[:8])
                logger.info(
                    "[OutfitFollow] %s track=%s cid=%s job=%s via=%s reason=%s items %d→%s",
                    "apply" if snap else "skip", tid[:8], cid_n[:8], job_id, via, reason,
                    len((old or {}).get("used_items") or []),
                    len(snap.get("used_items") or []) if snap else "-",
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "[OutfitFollow] error track=%s job=%s err=%s: %s — save continues",
                    tid[:8], job_id, type(e).__name__, str(e)[:160],
                )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[OutfitFollow] error user=%s job=%s err=%s: %s — save continues",
            (user_id or "")[:8], job_id, type(e).__name__, str(e)[:160],
        )
    return applied


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


async def _find_attached_mv(mongo, track_id) -> Optional[dict]:
    """v211 — 트랙에 **명시 부착**된 완성 MV job 조회.

    구 `_find_completed_mv`(generation_id 암묵 자동연결) 전면 대체 — "생성 완료
    ≠ 마음에 드는 완성" 사양. 부착은 POST /mv/jobs/{id}/attach 로만 성립하며,
    track 소스 MV(v209 audio_track_id) 노출 갭도 이 경로로 동시 해소.
    main.py 시동 시 mv_jobs.attached_track_id 인덱스 보장 (플레이어 hot path).
    """
    if not track_id:
        return None
    mv_job = await mongo.mv_jobs.find_one({
        "attached_track_id": str(track_id),
        "status": "completed",
        "result_music_video_url": {"$exists": True, "$ne": None},
    })
    return mv_job


async def _resolve_source_meta(
    mongo,
    user_id: str,
    character_id: Optional[str],
    persona_id: Optional[str],
    lyrics_id: Optional[str],
    lyrics_source: Optional[dict] = None,
):
    """v214 — 곡 출처 표시 스냅샷(source_meta) 서버 생성 + persona 정규화.

    원칙 (PLAN v214 T1):
      - 4필드 id 는 "받은 값 그대로" 저장 (검증 400 없음)
      - 표시 명칭은 **본인 소유 문서 일치 시에만** 생성 — 불일치·부재면 해당
        명칭 생략(스푸핑 차단, 표기 생략은 사양 5 기존 곡과 동일 경로)
      - persona_id 는 clone_id·Suno voice_id 어느 쪽이 와도
        {user_id, $or:[{_id},{voice_id}]} 역매핑으로 **clone_id 정규화**
        (실패 시 받은 값 그대로 저장 + 명칭 생략)
      - lyrics 명칭: lyrics_source(작곡 시점 동결 스냅샷, T2) 우선 →
        lyrics_id 의 본인 generations 문서 title resolve

    Returns (normalized_persona_id, source_meta | None)
      source_meta = {artist_name?, persona_name?, lyrics_title?, lyrics_is_mine?}
    """
    meta: dict = {}

    # 아티스트 명칭 — 본인 characters 문서 일치 시에만
    if character_id:
        try:
            char = await mongo.characters.find_one(
                {"user_id": user_id, "character_id": character_id}, {"name": 1},
            )
            if char is not None:
                meta["artist_name"] = char.get("name") or ""
            else:
                logger.info(
                    "[SongSource] character unresolved user=%s cid=%s — 명칭 생략",
                    user_id[:8], character_id[:36],
                )
        except Exception as e:
            logger.warning("[SongSource] character resolve failed cid=%s: %s", character_id[:36], e)

    # persona — clone_id/voice_id 양쪽 흡수 역매핑 + 명칭
    normalized_persona_id = persona_id
    if persona_id:
        try:
            ors = [{"voice_id": persona_id}]
            if ObjectId.is_valid(persona_id):
                ors.append({"_id": ObjectId(persona_id)})
            clone = await mongo.voice_clones.find_one(
                {"user_id": user_id, "$or": ors}, {"voice_name": 1},
            )
            if clone is not None:
                normalized_persona_id = str(clone["_id"])
                meta["persona_name"] = clone.get("voice_name") or ""
                if normalized_persona_id != persona_id:
                    logger.info(
                        "[SongSource] persona normalized voice_id->clone_id user=%s %s->%s",
                        user_id[:8], persona_id[:36], normalized_persona_id,
                    )
            else:
                logger.info(
                    "[SongSource] persona unresolved user=%s pid=%s — 받은 값 유지·명칭 생략",
                    user_id[:8], persona_id[:36],
                )
        except Exception as e:
            logger.warning("[SongSource] persona resolve failed pid=%s: %s", persona_id[:36], e)

    # 가사 명칭 — 작곡 시점 동결 스냅샷(lyrics_source) 우선 (draft 는 이미 삭제됨)
    ls = lyrics_source or {}
    ls_id = (ls.get("lyrics_id") or "").strip() if isinstance(ls, dict) else ""
    if isinstance(ls, dict) and (ls.get("title") or "").strip() and (not lyrics_id or lyrics_id == ls_id):
        meta["lyrics_title"] = (ls.get("title") or "").strip()[:100]
        meta["lyrics_is_mine"] = bool(ls.get("is_mine", True))
    elif lyrics_id:
        try:
            if ObjectId.is_valid(lyrics_id):
                gen = await mongo.generations.find_one(
                    {"_id": ObjectId(lyrics_id), "user_id": user_id}, {"title": 1},
                )
                if gen is not None and (gen.get("title") or "").strip():
                    meta["lyrics_title"] = (gen.get("title") or "").strip()[:100]
                    meta["lyrics_is_mine"] = True
                elif gen is None:
                    logger.info(
                        "[SongSource] lyrics unresolved user=%s lid=%s — 명칭 생략",
                        user_id[:8], lyrics_id[:36],
                    )
        except Exception as e:
            logger.warning("[SongSource] lyrics resolve failed lid=%s: %s", lyrics_id[:36], e)

    return normalized_persona_id, (meta or None)


def _mv_presigned_url(object_name: Optional[str]) -> Optional[str]:
    """v173: MV 비디오 URL — 중앙 헬퍼(media_urls.browser_video_url) 위임.

    비디오는 프록시 제외(메모리 부담) — 항상 public presign.
    """
    return browser_video_url(object_name)


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
    await _attach_album_info(mongo, serialized)  # B-11 — 배치 1쿼리

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


# ─── v3.231 S2 — 장르·느낌 한/영 별칭 (ES 관련도 쿼리에만 덧붙임) ─────────────────
# 저장된 장르 표기가 한/영 혼재(Hip-hop·힙합, R&B, K-Pop …)라 "힙합" 검색이 Hip-hop
# 표기 곡을, "알앤비" 가 R&B 곡을 놓치던 문제. DB 표기는 정리하지 않고(대표 결정 D6)
# 검색 쪽에서 흡수한다. 관련도 순 유지(D5) — 장르 필터가 아니라 ES multi_match 에
# 대응 표기를 추가할 뿐, 벡터 쿼리·응답 형태·페이지네이션은 불변.
# 각 항목 = (트리거 키 — `_alias_key` 정규화 값, 덧붙일 표기). 트리거가 쿼리에 있을
# 때만, 쿼리에 이미 없는 표기만 덧붙인다. 로맨스는 단방향(로맨스 → 로맨틱·Romantic —
# 저장 mood 표기 흡수; "로맨틱" 검색은 이미 12/12 로 잘 잡혀 역방향 불필요).
_SEARCH_ALIAS_GROUPS = [
    (("힙합", "hiphop"), ("힙합", "Hip-hop")),
    (("알앤비", "알엔비", "rnb", "rb"), ("알앤비", "R&B")),
    (("케이팝", "k팝", "kpop"), ("케이팝", "K-Pop")),
    (("시티팝", "citypop"), ("시티팝", "City pop")),
    (("댄스", "dance"), ("댄스", "Dance")),
    (("재즈", "jazz"), ("재즈", "Jazz")),
    (("발라드", "ballad"), ("발라드", "Ballad")),
    (("트로트", "trot"), ("트로트", "Trot")),
    (("록", "락", "rock"), ("록", "Rock")),
    (("로맨스",), ("로맨틱", "Romantic")),
]
_ALIAS_SPLIT_RE = re.compile(r"[\s,;/|·]+")
_ALIAS_STRIP_RE = re.compile(r"[\-_&.'’`]+")
_HANGUL_RE = re.compile(r"[가-힣]")
# 판정은 **어절(토큰) 단위** — 글자 포함으로 보지 않는다("기록"·"초록"에 Rock 을 붙이지 않음).
# 한글 트리거는 어절 전체가 트리거이거나 아래 음악 접미어만 붙은 경우(힙합곡·재즈풍·록음악)만
# 인정한다 — 앞부분 일치로 넓히면 "로맨스ㅁㄴ" 같은 아무말에 별칭이 붙어 게이트가 풀린다.
_ALIAS_KO_SUFFIXES = ("", "음악", "곡", "노래", "밴드", "풍", "장르", "송")
_ALIAS_MAX_ADDED = 6


def _alias_key(s: str) -> str:
    """별칭 비교용 정규화: NFKC → casefold → 하이픈·&·점 등 제거(Hip-hop→hiphop, R&B→rb)."""
    v = unicodedata.normalize("NFKC", s or "").casefold()
    return _ALIAS_STRIP_RE.sub("", v).strip()


def _alias_trigger_hit(cands: list, key: str) -> bool:
    """cands = 어절 키 + 인접 두 어절 결합 키. 어절 단위 판정(부분 문자열 아님)."""
    if not key:
        return False
    if _HANGUL_RE.search(key):
        # 한글: 어절 전체 일치 또는 음악 접미어만 붙은 어절(힙합곡·재즈풍·록음악)
        return any(c.startswith(key) and c[len(key):] in _ALIAS_KO_SUFFIXES for c in cands)
    # 영문·혼합(k팝 포함): 어절 또는 인접 두 어절 결합이 정확히 일치(hip hop, city pop)
    return key in cands


def _expand_search_aliases(q: str) -> list:
    """v3.231 S2 — 쿼리에 장르·느낌 트리거가 있으면 대응 표기 목록을 돌려준다(없으면 []).

    순수 함수·never raise. 반환 표기는 ES multi_match 에만 덧붙인다(_hybrid_search_core).
    """
    try:
        toks = [_alias_key(t) for t in _ALIAS_SPLIT_RE.split(q or "") if t and t.strip()]
        toks = [t for t in toks if t]
        if not toks:
            return []
        cands = list(toks) + [toks[i] + toks[i + 1] for i in range(len(toks) - 1)]
        # "이미 있음" 판정은 표기 그대로(하이픈·& 유지) — "hiphop" 과 "Hip-hop" 은 ES 토큰이
        # 달라([hiphop] vs [hip, hop]) 정규화 키로 같다고 보면 대응 표기를 못 붙인다.
        raw = [unicodedata.normalize("NFKC", t).casefold() for t in _ALIAS_SPLIT_RE.split(q or "") if t and t.strip()]
        raw_cands = list(raw) + [raw[i] + " " + raw[i + 1] for i in range(len(raw) - 1)]
        added: list = []
        for triggers, forms in _SEARCH_ALIAS_GROUPS:
            if not any(_alias_trigger_hit(cands, _alias_key(t)) for t in triggers):
                continue
            for form in forms:
                # 쿼리에 이미 있는 표기는 중복 추가하지 않는다(어절 단위).
                fcf = unicodedata.normalize("NFKC", form).casefold()
                present = (
                    _alias_trigger_hit(raw_cands, fcf) if _HANGUL_RE.search(fcf) else (fcf in raw_cands)
                )
                if present or form in added:
                    continue
                added.append(form)
        return added[:_ALIAS_MAX_ADDED]
    except Exception as e:  # pragma: no cover — 방어
        logger.warning("[tracks.search] alias_expand failed q_len=%d: %s", len(q or ""), e)
        return []


def _category_exact_match(q: str) -> Optional[str]:
    """v3.231 S2 — 쿼리가 느낌 카테고리명과 정확히 같으면(공백 무시) 그 이름, 아니면 None.

    "로맨스"·"행복한 기분"·"에너지충전" 처럼 느낌 칩 이름 그대로 친 검색은 아무말 게이트를
    적용하지 않는다(ES top1 2.87·벡터 0.322 로 게이트에 걸려 0건이던 실측). 부분 일치
    ("로맨스 노래")는 해당 없음 — 게이트를 과하게 풀지 않는다.
    """
    try:
        from ..constants.categories import CATEGORIES

        k = re.sub(r"\s+", "", q or "")
        if not k:
            return None
        for c in CATEGORIES:
            if re.sub(r"\s+", "", c) == k:
                return c
    except Exception as e:  # pragma: no cover — 방어
        logger.warning("[tracks.search] category exact check failed q_len=%d: %s", len(q or ""), e)
    return None


async def _regex_search_tracks(mongo, q: str, page: int, limit: int) -> dict:
    """Original MongoDB regex search. Used as the semantic-search fallback."""
    # v3.231 S2 — 검색어를 정규식 리터럴로 이스케이프("R&B"·"(" ·".*" 가 정규식 오류나
    # 전체 매치가 되지 않게). 두 검색 백엔드가 모두 죽었을 때만 타는 경로.
    pat = re.escape(q or "")
    logger.info("[tracks.search] regex fallback q_len=%d fields=+genre,mood,categories", len(q or ""))
    query = {
        "is_public": True,
        "$or": [
            {"title": {"$regex": pat, "$options": "i"}},
            {"tags": {"$regex": pat, "$options": "i"}},
            {"prompt": {"$regex": pat, "$options": "i"}},
            {"uploader_nickname": {"$regex": pat, "$options": "i"}},
            # v236a — 곡에 기록된 아티스트명(가수)으로도 검색 매치 (필드 없는 레거시 곡은 미매치 — 무해)
            {"artist_name": {"$regex": pat, "$options": "i"}},
            # v3.231 S2 — 두 검색 백엔드가 모두 죽었을 때도 장르·무드·느낌으로 찾히게.
            {"genre": {"$regex": pat, "$options": "i"}},
            {"mood": {"$regex": pat, "$options": "i"}},
            {"categories": {"$regex": pat, "$options": "i"}},
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
    from ..services.search_service import es_anchor_hits, es_search, rrf_fuse

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

    # --- v3.231 S2: 장르·느낌 별칭(ES 관련도 쿼리에만) + 느낌명 정확 일치 ---
    alias_terms = _expand_search_aliases(q)
    if alias_terms:
        logger.info("[tracks.search] alias_expand q_len=%d added=%d", q_len, len(alias_terms))
    cat_exact = _category_exact_match(q)
    if cat_exact:
        logger.info("[tracks.search] category_exact q_len=%d", q_len)

    # --- Elasticsearch BM25 candidates (best-effort, never raises) ---
    es_ids: list = []
    es_ok = False
    es_top1: float = 0.0
    try:
        if alias_terms:
            es_ids, es_top1 = await es_search(q, _SEMANTIC_TOP_K, extra_terms=alias_terms)
        else:
            es_ids, es_top1 = await es_search(q, _SEMANTIC_TOP_K)
        es_ok = True
    except Exception as e:
        logger.warning("[tracks.search] es backend failed q_len=%d: %s", q_len, e)

    # --- v171: 아무말(gibberish) 게이트 ---
    # ES 가 정상 동작했는데(lexical) 히트가 0건 — 또는 top1 점수가 weak 임계
    # 미만(fuzziness AUTO 잔여 노이즈: 아무말도 저점수 히트를 몇 건 만든다.
    # 실측 아무말 es_top1 ≤ 2.54 vs 정상 최저 3.24) — 이고 vec_top1 이
    # gibberish 임계 미만이면 카탈로그와 무관한 쿼리로 판정 → 빈 결과.
    # 정상 쿼리는 ES 의 강한 lexical 앵커가 잡아준다(v169 artist 필드).
    # es_ok=False(ES 다운)나 vec_ok=False(판정 근거 부재)면 게이트 미적용 —
    # 가용성 우선.
    es_weak = (not es_ids) or (es_top1 < settings.search_es_weak_score)
    if es_ok and es_weak and vec_ok and vec_top1 < settings.search_gibberish_cosine and cat_exact:
        # v3.231 S2 — 느낌 카테고리명 그대로 친 검색은 게이트 비적용(카탈로그 분류어).
        logger.info(
            "[tracks.search] gibberish gate skipped reason=category_exact q_len=%d vec_top1=%.4f es_top1=%.2f",
            q_len, vec_top1, es_top1,
        )
    elif es_ok and es_weak and vec_ok and vec_top1 < settings.search_gibberish_cosine:
        # v171.1 — prefix 앵커(제3의 어휘 증거): nori 가 합성어를 분해하지 않아
        # BM25 0히트가 된 정상 쿼리("면접" → 가사 "면접관을") 오폭 방지. 어절
        # 서브필드 phrase_prefix 로 부분어 히트가 1건이라도 있으면 게이트 해제.
        # -1(probe 실패 = 판정 불가)도 해제 — 가용성 우선.
        anchor_hits = await es_anchor_hits(q)
        if anchor_hits == 0 and alias_terms:
            # v3.231 S2 — 별칭 표기가 카탈로그에 실재하면(예: "알앤비" → 저장 장르 R&B)
            # 그것도 어휘 증거. 원 검색어 앵커가 0 일 때만, 별칭별 1회씩(최대 6).
            for term in alias_terms:
                h = await es_anchor_hits(term)
                if h != 0:
                    logger.info(
                        "[tracks.search] alias anchor q_len=%d term_len=%d hits=%d",
                        q_len, len(term), h,
                    )
                    anchor_hits = h
                    break
        if anchor_hits == 0:
            logger.info(
                "[tracks.search] mode=gibberish q_len=%d vec_top1=%.4f es_top1=%.2f gib=%.3f anchor_hits=%d",
                q_len, vec_top1, es_top1, settings.search_gibberish_cosine, anchor_hits,
            )
            return (
                {
                    "tracks": [],
                    "pagination": {"page": page, "limit": limit, "total": 0, "totalPages": 0},
                },
                "gibberish",
            )
        logger.info(
            "[tracks.search] gibberish gate released q_len=%d vec_top1=%.4f es_top1=%.2f anchor_hits=%d",
            q_len, vec_top1, es_top1, anchor_hits,
        )

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
    # v3.269 [피드백2-30] — 발매 후 아티스트 재지정: 본인 캐릭터 id, "" = 아티스트 해제(기획사명 폴백).
    # 배경: 만료 팝업 [아티스트 없이 진행]으로 발매된 곡(slow·Yoon 실사고)을 나중에 귀속시킬 길이 없었다.
    character_id: Optional[str] = None


async def _validate_cover_image_url(mongo, value: str, doc: dict, user_id: str):
    """v207 — update_track `cover_image_url` 서버측 검증.

    기존 곡 커버 수정(CoverEditModal)에서 AI 세션 산출물을 커버로 지정하는
    경로가 열리면서, 임의 문자열이 그대로 저장되던 구멍(타인 오브젝트·
    faces/·evidence/ 백엔드 전용 경로·외부 URL 지정 가능)을 막는다.

    허용 (반환 (True, src)):
      - "revert": 현 track.cover_image_url 과 동일 값 — 되돌리기/유지.
        (레거시 http(s) 전체 URL 저장분도 "기존 값 유지"로만 통과 —
        2026-08-26 실측 기준 http 저장분 0건이지만 방어적으로 유지)
      - "file":   본인 파일 업로드 커버 `covers/{user_id}/{track_id}.{ext}`
        (/upload/image type=cover 의 결정적 경로 — 파일 커버로 되돌리기용)
      - "session": 본인 소유 cover_sessions 산출물 (user_id 일치 +
        cover_object_name 또는 cover_refine_history[].object_name 에 포함)

    차단 (반환 (False, None)) — 호출측에서 400 + [cover-edit] warning:
      - faces/·evidence/ 접두 (백엔드 전용 경로 — 무조건, 동일값이어도)
      - `..` 경로 탈출 (cover-preview v173 관행과 정합)
      - http(s):// 외부 URL (동일 기존값 제외)
      - 타인 세션 산출물·그 외 임의 문자열
    """
    value = value or ""
    # 백엔드 전용 경로 — 기존값과 동일해도 무조건 차단.
    if value.startswith(("faces/", "evidence/")):
        return False, None
    if ".." in value:
        return False, None

    # 되돌리기/유지 — 현 커버와 동일 값 (레거시 http 저장분 포함 유일 통로).
    current = doc.get("cover_image_url")
    if current and value == current:
        return True, "revert"

    if value.startswith(("http://", "https://")):
        return False, None
    if not value:
        return False, None

    # 본인 파일 업로드 커버 — /upload/image 가 쓰는 결정적 object name.
    track_id = str(doc["_id"])
    if value.startswith(f"covers/{user_id}/{track_id}."):
        return True, "file"

    # 본인 소유 cover_sessions 산출물 (현재본 + refine 이력 전체).
    sess = await mongo.cover_sessions.find_one(
        {
            "user_id": user_id,
            "$or": [
                {"cover_object_name": value},
                {"cover_refine_history.object_name": value},
            ],
        },
        {"_id": 1},
    )
    if sess:
        return True, "session"

    return False, None


async def _validate_cover_object_name_for_create(mongo, value: str, user_id: str):
    """v210 — 생성 경로(/upload · /upload-from-generation) cover_object_name 검증.

    v207 `_validate_cover_image_url` 의 유효 분기 재사용판: 업로드(생성) 시점엔
    track doc 이 아직 없어 revert/file 분기가 성립하지 않으므로,
    **session 분기(본인 cover_sessions 산출물 증명)만** 허용한다.

    허용 (True, "session"): 본인 소유 cover_sessions 의 cover_object_name
      또는 cover_refine_history[].object_name 과 일치.
    차단 (False, None): faces/·evidence/ 접두(백엔드 전용 경로) · `..` 경로
      탈출 · http(s):// 외부 URL · 빈 값 · 타인 세션 산출물·임의 문자열.
    """
    value = value or ""
    if value.startswith(("faces/", "evidence/")):
        return False, None
    if ".." in value:
        return False, None
    if value.startswith(("http://", "https://")):
        return False, None
    if not value:
        return False, None

    sess = await mongo.cover_sessions.find_one(
        {
            "user_id": user_id,
            "$or": [
                {"cover_object_name": value},
                {"cover_refine_history.object_name": value},
            ],
        },
        {"_id": 1},
    )
    if sess:
        return True, "session"

    return False, None


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

    serialized = _serialize_tracks(tracks)
    await _attach_album_info(mongo, serialized)  # B-11 — 배치 1쿼리
    for _t in serialized:  # v3.235 — 곡 아티스트 cid 키 보장(없던 레거시 곡 = null, 앱 커버 인물 결정용)
        _t.setdefault("character_id", None)

    return {
        "tracks": serialized,
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
    # v215 C3 — 수명 재설계: covers/generated/·covers/refined/ 접두(세션 산출물 =
    # 보관함 소유 자산)는 **오브젝트 삭제 스킵**(트랙 doc 만 파기). 곡=참조자·
    # 보관함=소유자 — 커버 다곡 재사용 시 한 곡 삭제가 타 곡·보관함을 파손하지
    # 않는다. 오브젝트 파기는 보관함 DELETE(미사용 한정, upload.py) 단일 통로.
    # ⚠ 별건 기록: 이 함수는 유저 삭제·admin 몰수 공용 — 몰수 시에도 세션 커버
    # 오브젝트가 남는다. 문제 이미지 완전 파기가 필요한 몰수 케이스는
    # cover_sessions 몰수 확장 별건(▲사용자 인지 항목, v215 REPORT).
    cover = doc.get("cover_image_url")
    if cover and not str(cover).startswith("http"):
        if str(cover).startswith(("covers/generated/", "covers/refined/")):
            logger.info(
                "[CoverLib] purge skip session-cover track=%s obj=%s (보관함 소유 — C3)",
                str(doc.get("_id")), cover,
            )
        else:
            # 파일 첨부 커버(covers/{uid}/{tid}.ext — 트랙 전속)만 기존대로 삭제
            try:
                minio_client.remove_object(
                    bucket_name=settings.minio_bucket_images, object_name=cover
                )
                removed.append("cover")
            except Exception:
                pass

    # MinIO — 공유영상 캐시. v3.179: 스타일 변형 다수 → prefix 목록 삭제로 전 변형 정리
    # (v3.215: 캐시 v8 승격 — 구 v5/v6/v7 잔존 객체 포함 정리)
    try:
        objs = []
        for _pfx in (f"share/v5/{track_id}", f"share/v6/{track_id}",
                     f"share/v7/{track_id}", f"share/v8/{track_id}"):
            objs += list(minio_client.list_objects(
                bucket_name=settings.minio_bucket_music,
                prefix=_pfx,
                recursive=True,
            ))
        for obj in objs:
            try:
                minio_client.remove_object(
                    bucket_name=settings.minio_bucket_music,
                    object_name=obj.object_name,
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
    await redis.delete(f"cache:track:v4:{track_id}")
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


# v3.231 S3 — ES `tracks` 문서에 들어가는 TrackUpdateBody 필드(search_service._track_to_doc).
# v3.269: artist_name 추가 — ES "artist" 필드(artist_name→uploader_nickname) 원천이라 재지정 시 재색인 필요
_TRACK_ES_FIELDS = frozenset({"title", "genre", "mood", "tags", "prompt", "is_public", "artist_name"})
_TRACK_ES_SYNC_TIMEOUT_S = 5.0


async def _es_sync_updated_track(track_id: str, doc: dict, touched: list) -> bool:
    """v3.231 S3 — 곡 수정 직후 ES 색인 갱신(admin.py _es_reindex_track 패턴). never raise.

    ES 장애·지연이 수정 응답을 막지 않도록 5초 상한. 실패해도 다음 기동의 자가 치유
    (search_service.backfill_es_if_needed 공개 드리프트 검사)가 공개곡을 다시 맞춘다.
    """
    ok = False
    logger.info(
        "[tracks.update] es_sync start track=%s fields=%s is_public=%s",
        track_id[:8], ",".join(touched), bool(doc.get("is_public", False)),
    )
    try:
        from ..services.search_service import es_index_track

        ok = bool(await asyncio.wait_for(es_index_track(doc), timeout=_TRACK_ES_SYNC_TIMEOUT_S))
    except asyncio.TimeoutError:
        logger.warning("[tracks.update] es_sync timeout track=%s after=%.1fs", track_id[:8], _TRACK_ES_SYNC_TIMEOUT_S)
    except Exception as e:
        logger.warning("[tracks.update] es_sync failed track=%s err=%s", track_id[:8], e)
    logger.info("[tracks.update] es_sync track=%s ok=%s", track_id[:8], ok)
    return ok


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

    # v3.232 G1 — 곡 제목 금칙어(1차: 어린이만, 성인은 즉시 통과·DB 0회). 저장 전.
    if body.title is not None:
        _wf = await word_filter_response(current_user["id"], [body.title], "track_update")
        if _wf is not None:
            return _wf

    # v207 — cover_image_url 서버 검증 (body 에 없으면(None) 기존대로 무시 —
    # 다른 필드만 수정하는 기존 사용처 무영향).
    if body.cover_image_url is not None:
        cover_ok, cover_src = await _validate_cover_image_url(
            mongo, body.cover_image_url, doc, current_user["id"]
        )
        if not cover_ok:
            logger.warning(
                "[cover-edit] rejected track=%s user=%s value=%s",
                track_id[:8], current_user["id"][:8],
                str(body.cover_image_url)[:120],
            )
            return JSONResponse(
                status_code=400,
                content={"error": "유효하지 않은 커버 이미지입니다."},
            )
        logger.info(
            "[cover-edit] track=%s user=%s src=%s",
            track_id[:8], current_user["id"][:8], cover_src,
        )

    # v3.269 [30] — 아티스트 재지정: 본인 캐릭터 검증 후 character_id+artist_name 동시 갱신.
    # ""(빈 문자열) = 해제(둘 다 None — 기획사명 폴백). 착장 스냅샷은 발매 시점 기록이라 불변(정직 기재).
    _artist_retag = None
    if body.character_id is not None:
        _cid = (body.character_id or "").strip()[:64]
        if _cid == "":
            _artist_retag = {"character_id": None, "artist_name": None}
        else:
            _ch = await mongo.characters.find_one(
                {"user_id": current_user["id"], "character_id": _cid}, {"name": 1},
            )
            if _ch is None:
                logger.info("[tracks.update] artist_retag reject track=%s cid=%s", track_id[:8], _cid[:36])
                return JSONResponse(status_code=400, content={"error": "본인 아티스트만 지정할 수 있습니다."})
            _artist_retag = {"character_id": _cid, "artist_name": (_ch.get("name") or "").strip() or None}

    # Build update dict from non-None fields
    update_data = {k: v for k, v in body.dict().items() if v is not None}
    update_data.pop("character_id", None)  # v3.269: 원값 대신 검증된 _artist_retag만 반영
    if _artist_retag is not None:
        update_data.update(_artist_retag)
    if not update_data:
        return JSONResponse(status_code=400, content={"error": "수정할 항목이 없습니다."})

    update_data["updated_at"] = datetime.now(timezone.utc)

    # v3.234 S2 — AI 커버(세션 산출물) 적용 시 곡 스타일링을 그 커버에 쓰인 착장으로 교체.
    # revert·file·다른 아티스트·인물 없음 커버는 무변경. 실패는 격리(커버 갱신은 그대로).
    if body.cover_image_url is not None and cover_src == "session":
        try:
            _cov_snap, _cov_src, _cov_reason = await _cover_outfit_snapshot(
                mongo, current_user["id"], body.cover_image_url, doc,
            )
            _old_snap = doc.get("user_character_snapshot") if isinstance(doc.get("user_character_snapshot"), dict) else None
            if _cov_snap and _cov_snap == _old_snap:
                _cov_snap, _cov_reason = None, "unchanged"
            _log_cover_outfit(
                track_id, (_cov_snap or _old_snap or {}).get("character_id") or doc.get("character_id"),
                _cov_src, _cov_snap, _cov_reason, _old_snap,
            )
            if _cov_snap:
                update_data["user_character_snapshot"] = _cov_snap
        except Exception as e:
            logger.warning(
                "[CoverOutfitSnap] track=%s decision=error err=%s: %s — cover update continues",
                track_id[:8], type(e).__name__, str(e)[:160],
            )

    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$set": update_data},
    )

    # Clear Redis cache (both legacy v1 and current v2 keys)
    redis = get_redis()
    await redis.delete(f"cache:track:{track_id}")
    await redis.delete(f"cache:track:v4:{track_id}")
    await redis.delete(f"playcount:buffer:{track_id}")

    # Fetch and return updated document
    updated_doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})

    # v3.231 S3 — 검색 색인(ES) 동기화. 이전엔 Mongo·Redis 만 갱신해서 비공개로 만든 뒤
    # 공개로 바꾼 곡이 ES 에 is_public=false 로 남아 키워드 검색에서 빠졌다(실측 6곡).
    # 색인 필드(제목·장르·무드·태그·프롬프트·공개 여부)가 바뀐 경우만, 직렬화(_id pop)
    # 전에 갱신된 문서로 upsert. best-effort — 실패·지연해도 응답(200)은 그대로.
    touched = sorted(k for k in update_data if k in _TRACK_ES_FIELDS)
    if updated_doc and touched:
        await _es_sync_updated_track(track_id, updated_doc, touched)
    elif updated_doc:
        logger.info("[tracks.update] es_sync skip track=%s reason=no_indexed_field", track_id[:8])
    return _serialize_track(updated_doc)


@router.get("/{track_id}/music-video")
async def get_track_music_video(
    track_id: str,
    current_user=Depends(get_current_user_optional),
):
    """Return presigned URL for the track's music video, or 404 if none exists."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"generation_id": 1, "uploader_id": 1, "is_public": 1, "report_blinded": 1},
    )
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # v196 ① 직링크 가드 — 비공개·블라인드 트랙 MV 는 소유자(또는 admin) 외 404.
    # 인증은 optional 이므로 공개 곡의 비로그인 접근은 그대로 200 유지.
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, current_user):
        logger.info("[report] track mv_denied track=%s", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    # v211 — 명시 부착 기준 조회 (암묵 generation 링크 폐기)
    mv_job = await _find_attached_mv(mongo, track_id)
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
async def get_track_lyrics_timeline(
    track_id: str,
    current_user=Depends(get_current_user_optional),
):
    """Return line-level lyric segments for a track (unauthenticated, public playback).

    Response: {"has_timestamps": bool, "segments": [{"text","start","end"}], "source": str}
    """
    logger.info("[lyrics-timeline] track=%s", track_id[:8] if track_id else "?")
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

    mongo = get_mongo()
    # v196: _fetch_lyric_segments 가 문서 전체를 요구하므로 프로젝션은 축소하지 않는다.
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})

    # v196 ① 직링크 가드 — 광역 except 진입 **전에** 배치한다.
    # (아래 try 안에 두면 404 응답이 삼켜져 200 {"has_timestamps": false} 로 바뀔 수 있다)
    # 인증은 optional 이므로 공개 곡의 비로그인 접근은 그대로 200 유지.
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, current_user):
        logger.info("[report] track lyrics_denied track=%s", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    try:
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

    # v3.244 — 박자분석 전역 중지 스위치: 문서 상태 무접촉, 친절 응답(200)
    if not settings.beats_extraction_enabled:
        return {"message": "박자 분석 기능이 일시 중지되었습니다.", "status": "disabled"}

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
    from ..services.beat_extraction import run_track_beat_extraction_in_background
    # v205: 기존 create_task(detect_beats_for_track(...)) 는 madmom CPU 작업을
    # 메인 이벤트 루프에서 직접 돌리는 선재 결함(detect_beats 내부에 스레드
    # 오프로딩 없음 — audio_utils.py 실측). 전체를 to_thread 로 워커 스레드에
    # 옮기고, 그 안(sync 래퍼)에서 heavy_job_slot 을 획득한다.
    _asyncio.create_task(
        _asyncio.to_thread(run_track_beat_extraction_in_background, track_id)
    )

    return {"message": "비트 재추출이 시작되었습니다.", "status": "pending"}


async def _stream_minio_body(response, chunk_size: int = 64 * 1024):
    """v3.258 [perf]: MinIO(urllib3) 응답 바디를 워커 스레드 경유로 비동기 반복.

    기존에는 urllib3 HTTPResponse(동기 이터레이터)를 StreamingResponse 에 그대로
    넘겼다 — Starlette 이 sync 이터레이터를 threadpool 로 감싸 주긴 하지만,
    io.IOBase 상속이라 라인(\\n) 단위 분할이어서 청크 경계가 내용 의존적이고,
    소진/취소 후 커넥션 반납(close+release_conn)이 없었다. 여기서는 read(64KiB)
    를 asyncio.to_thread 로 반복해 **연결 바이트 스트림은 완전 동일**하게 유지
    (총량·순서 불변 — 경계만 고정 64KiB)하고, 정상 종료·클라이언트 중단 모두
    finally 에서 커넥션을 반납한다. (2026-09-28 성능 진단: 단일 uvicorn 워커의
    이벤트 루프에서 동기 S3 I/O 가 전 요청을 세우던 관문 해소 패치의 일부.)
    """
    try:
        while True:
            chunk = await asyncio.to_thread(response.read, chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            response.close()
            response.release_conn()
        except Exception:  # noqa: BLE001 — 반납 실패는 스트림 결과에 영향 없음
            pass


@router.get("/stream-proxy/{track_id}")
async def stream_track_proxy(
    track_id: str,
    request: Request,
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
        content_type = "audio/mpeg"
        if doc["audio_url"].endswith(".wav"):
            content_type = "audio/wav"
        elif doc["audio_url"].endswith(".ogg"):
            content_type = "audio/ogg"
        elif doc["audio_url"].endswith(".flac"):
            content_type = "audio/flac"
        elif doc["audio_url"].endswith(".m4a"):
            content_type = "audio/mp4"

        # v193: HTTP Range 지원 — 모바일/웹 오디오 시크 안정화 (기존: Accept-Ranges 만 선언하고 미구현)
        # v3.258 [perf]: stat/get 동기 MinIO 호출을 asyncio.to_thread 로 오프로드 —
        # 응답 상태코드·헤더·바이트는 기존과 동일, 예외는 그대로 전파되어 아래
        # except 의 기존 404 경로로 수렴(_stream_minio_body docstring 참조).
        range_header = (request.headers.get("range") or "").strip()
        stat = await asyncio.to_thread(
            minio_client.stat_object, settings.minio_bucket_music, doc["audio_url"]
        )
        total = stat.size
        if range_header.startswith("bytes="):
            try:
                spec = range_header[6:].split(",")[0].strip()
                start_s, _, end_s = spec.partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else total - 1
                end = min(end, total - 1)
                if start > end or start >= total:
                    return JSONResponse(status_code=416, content={"error": "요청 범위가 올바르지 않습니다."},
                                        headers={"Content-Range": f"bytes */{total}"})
                length = end - start + 1
                response = await asyncio.to_thread(
                    minio_client.get_object,
                    bucket_name=settings.minio_bucket_music,
                    object_name=doc["audio_url"],
                    offset=start, length=length,
                )
                logger.info("[track] stream_proxy range track=%s %d-%d/%d", track_id[:8], start, end, total)
                return StreamingResponse(
                    _stream_minio_body(response), status_code=206, media_type=content_type,
                    headers={
                        "Accept-Ranges": "bytes",
                        "Content-Range": f"bytes {start}-{end}/{total}",
                        "Content-Length": str(length),
                    },
                )
            except ValueError:
                logger.warning("[track] stream_proxy bad range track=%s header=%s", track_id[:8], range_header[:40])

        response = await asyncio.to_thread(
            minio_client.get_object,
            bucket_name=settings.minio_bucket_music,
            object_name=doc["audio_url"],
        )
        return StreamingResponse(
            _stream_minio_body(response),
            media_type=content_type,
            headers={"Accept-Ranges": "bytes", "Content-Length": str(total)},
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})


# RelatedTracks — vector NN over-fetch headroom beyond limit+exclude count.
_RELATED_EXTRA_K = 10
# v3.271 [RelatedVariety] (대표 지적 "같은 곡만 반복"):
#  - 세 단계 모두 결정적(같은 입력→같은 출력)이라 소형 카탈로그에서 반복 체감 필연.
#    vector 는 상위 후보 rank-가중 샘플링, genre/popular 폴백은 상위 풀에서 무작위 추출로 다양화.
#  - "(Inst.)" 곡은 추천에서 제외(대표 확정 — 자동 재생 체인 유입 차단, 직접 재생은 그대로).
import random as _random
_INST_TITLE_RE = re.compile(r"\(Inst\.\)\s*$")
_RELATED_POOL_MULT = 5       # 폴백 풀 = need*5 (최소 15) 중 무작위
_RELATED_VEC_TEMP = 3.0      # rank 가중 w=1/(rank+TEMP) — 클수록 상위 쏠림 완화


_RELATED_SAME_UPLOADER_MULT = 0.35  # v3.286 — 같은 제작자 연속 쏠림 감쇠(실측 52~54% vs 무작위 27%)
_RELATED_RELAX_KEEP = 15            # v3.286 — 후보 소진 시 최근 N곡만 계속 제외(나머지는 다시 허용)


def _weighted_sample_ranks(n_cands: int, need: int, temp: float = _RELATED_VEC_TEMP, mults=None) -> list:
    """0..n-1 랭크에서 need개 비복원 가중 샘플(w=1/(rank+temp)×mult). 순수 함수 — 하니스 검증.
    v3.286 mults: 랭크별 가중 배수(None=모두 1) — 같은 제작자 곡 감쇠용."""
    idxs = list(range(n_cands))
    out = []
    while idxs and len(out) < need:
        weights = [(1.0 / (i + temp)) * (mults[i] if mults else 1.0) for i in idxs]
        total = sum(weights)
        r = _random.random() * total
        acc = 0.0
        pick_pos = 0
        for pos, w in enumerate(weights):
            acc += w
            if r <= acc:
                pick_pos = pos
                break
        out.append(idxs.pop(pick_pos))
    return out


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
    exclude_order: list = []  # v3.286 — 앞쪽 = 최근 재생(완화 단계에서 이 앞부분만 계속 제외)
    if exclude:
        exclude_order = [tid.strip() for tid in exclude.split(",") if tid.strip()]
        exclude_ids = set(exclude_order)
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
                    "title": {"$not": _INST_TITLE_RE},  # v3.271 — Inst 추천 제외
                })
                docs = await cursor.to_list(length=len(cand_ids))
                docs.sort(key=lambda d: rank_by_id.get(str(d["_id"]), len(rank_by_id)))
                # v3.271 — 상위 고정 대신 rank-가중 샘플링(유사도 우선은 유지하되 매번 다른 조합)
                _seed_up = str(seed_doc.get("uploader_id") or "")
                _mults = [(_RELATED_SAME_UPLOADER_MULT if (_seed_up and str(d.get("uploader_id") or "") == _seed_up) else 1.0)
                          for d in docs]
                sel = _weighted_sample_ranks(len(docs), limit, mults=_mults)
                logger.info("[related] track=%s vector sample n=%d sel=%s", track_id, len(docs), sel[:8])
                for i in sel:
                    d = docs[i]
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
                pool_n = max(need * _RELATED_POOL_MULT, 15)
                cursor = mongo.tracks.find({
                    "is_public": True,
                    "genre": genre_cond,
                    "_id": {"$nin": skip_oids},
                    "title": {"$not": _INST_TITLE_RE},  # v3.271
                }).sort("play_count", -1).limit(pool_n)
                pool = await cursor.to_list(length=pool_n)
                docs = _random.sample(pool, min(need, len(pool)))  # v3.271 — 상위 풀 무작위
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
            pool_n = max(need * _RELATED_POOL_MULT, 15)
            cursor = mongo.tracks.find({
                "is_public": True,
                "_id": {"$nin": skip_oids},
                "title": {"$not": _INST_TITLE_RE},  # v3.271
            }).sort("play_count", -1).limit(pool_n)
            pool = await cursor.to_list(length=pool_n)
            docs = _random.sample(pool, min(need, len(pool)))  # v3.271
            for d in docs:
                picked_ids.add(str(d["_id"]))
                picked.append(_serialize_track(d))
            if docs:
                sources_used.append("popular")
        except Exception:
            logger.exception("[related] track=%s popular stage failed", track_id)

    # ── 4차(v3.286): 제외 목록이 카탈로그를 다 덮어 비었을 때 — 최근 N곡만 계속 제외하고 나머지 허용 ──
    # 실측(09-23~10-06): exclude ≥95 요청의 83%가 빈 응답 → 자동재생 종료·저장 큐 같은 순서 반복의 주원인.
    if len(picked) < limit and len(exclude_order) > _RELATED_RELAX_KEEP:
        try:
            keep = set(exclude_order[:_RELATED_RELAX_KEEP]) | picked_ids | {track_id}
            keep_oids = [ObjectId(t) for t in keep if ObjectId.is_valid(t)]
            need = limit - len(picked)
            pool_n = max(need * _RELATED_POOL_MULT, 15)
            # 기준곡과 같은 장르 우선, 없으면 전체
            cond = {"is_public": True, "_id": {"$nin": keep_oids}, "title": {"$not": _INST_TITLE_RE}}
            g = seed_doc.get("genre")
            pool = []
            if g:
                pool = await mongo.tracks.find({**cond, "genre": {"$in": list(g)} if isinstance(g, (list, tuple)) else g}).limit(pool_n).to_list(length=pool_n)
            if len(pool) < need:
                more = await mongo.tracks.find(cond).limit(pool_n).to_list(length=pool_n)
                seen = {str(d["_id"]) for d in pool}
                pool += [d for d in more if str(d["_id"]) not in seen]
            # 오래전에 들은 곡 우선 = exclude 목록 뒤쪽일수록(또는 목록에 없을수록) 가중 ↑
            pos = {t: i for i, t in enumerate(exclude_order)}
            pool.sort(key=lambda d: -pos.get(str(d["_id"]), len(exclude_order) + 1))
            sel = _weighted_sample_ranks(len(pool), need)
            for i in sel:
                d = pool[i]
                picked_ids.add(str(d["_id"]))
                picked.append(_serialize_track(d))
            if sel:
                sources_used.append("relaxed")
            logger.info("[related] track=%s relaxed exclude=%d keep=%d pool=%d picked=%d",
                        track_id, len(exclude_order), len(keep), len(pool), len(sel))
        except Exception:
            logger.exception("[related] track=%s relaxed stage failed", track_id)

    source = sources_used[0] if len(sources_used) == 1 else ("mixed" if sources_used else "popular")
    await _attach_album_info(mongo, picked)  # B-11 — 배치 1쿼리
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
    cached = await redis.get(f"cache:track:v4:{track_id}")
    if cached:
        track = json.loads(cached)
        # v138 직링크 가드 — 캐시 히트 경로에도 동일 적용 (캐시 데이터는 전체
        # 도큐먼트 직렬화라 is_public/report_blinded 포함 — 스키마 승격 불필요)
        if _is_hidden_track(track) and not _can_view_hidden_track(track, current_user):
            logger.info("[report] track direct_link_denied track=%s cached=1", track_id[:8])
            return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)
        # v3.229 P — 상세 조회는 재생이 아니다: playcount:buffer 증가 제거
        #   (재생 집계는 POST /api/charts/record-play 단일 경로. playcount_sync 는 잔여 버퍼 소진용으로 유지)
        # uploader_profile_image 는 캐시 밖에서 항상 fresh 하게 첨부
        await _attach_uploader_profiles([track], pg)
        # B-11 — album 소속도 캐시 밖 fresh 첨부 (앨범 편집 즉시 반영)
        await _attach_album_info(mongo, [track])
        return track

    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)})
    if not doc:
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    # v138 직링크 가드 — 비공개·블라인드 트랙은 소유자(또는 admin) 외 404
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, current_user):
        logger.info("[report] track direct_link_denied track=%s cached=0", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    track = _serialize_track(doc)

    # v193: 곡 생성 프롬프트 파라미터 병합 — 보컬/스타일/악기 등은 generations 에만 있어
    # 소유자 전용 API 로만 보였음 → 공개 필드만 추려 트랙 응답에 동봉(모든 사용자 열람 가능).
    try:
        gen_id = track.get("generation_id")
        if gen_id and ObjectId.is_valid(str(gen_id)):
            gen = await mongo.generations.find_one(
                {"_id": ObjectId(str(gen_id))},
                {"vocal": 1, "style": 1, "instruments": 1, "reference_style": 1,
                 "negative_tags": 1, "style_weight": 1, "weirdness": 1,
                 "audio_weight": 1, "persona_model": 1, "bpm": 1, "key": 1},
            )
            if gen:
                params = {k: v for k, v in gen.items() if k != "_id" and v not in (None, "", [])}
                if params:
                    track["generation_params"] = params
                    logger.info("[track] generation_params attached track=%s keys=%d", track_id[:8], len(params))
    except Exception:
        logger.exception("[track] generation_params merge failed track=%s", track_id[:8])

    # Look up linked completed mv_job once; reuse for both music_video and cover_character.
    # v211 — 명시 부착(attached_track_id) 기준으로 전환. cover_character 1순위
    # 소스도 부착 job 기준 — 무부착 시 track snapshot 폴백은 현행 유지.
    mv_job = None
    try:
        mv_job = await _find_attached_mv(mongo, track_id)
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

    # v3.238 S2 — 스타일링은 커버에 곡 아티스트가 들어간 곡만 노출(S1 판정). 미노출이면 used_items 만 비우고
    # cover_character 의 이름·시트 등 나머지 키는 유지(아티스트명 표시·v3.229 이름 동기화 정합). additive 필드
    # styling_visible·styling_reason. 판정 예외 = 비움 + reason=error + 이번 응답은 캐시 저장 생략(다음 요청 재시도).
    # 캐시 키 v4 유지(스키마 additive — 배포 전 캐시는 TTL 600초 안에 소멸).
    styling_cacheable = True
    styling_items = len(cover_character.get("used_items") or []) if cover_character else 0
    try:
        styling_visible, styling_reason = await _styling_visibility(mongo, track, mv_job)
    except Exception as e:  # noqa: BLE001
        styling_visible, styling_reason, styling_cacheable = False, "error", False
        logger.warning(
            "[StylingVisible] error track=%s err=%s: %s — used_items hidden, cache skipped",
            track_id[:8], type(e).__name__, str(e)[:160],
        )
    if not styling_visible and cover_character is not None:
        cover_character["used_items"] = []
    logger.info(
        "[StylingVisible] track=%s visible=%s reason=%s items=%d",
        track_id[:8], bool(styling_visible), styling_reason, styling_items,
    )

    track["cover_character"] = cover_character
    track["styling_visible"] = bool(styling_visible)
    track["styling_reason"] = styling_reason

    # v3.229 P — 상세 조회는 재생이 아니다: playcount:buffer 증가 제거(재생 집계 = record-play 단일 경로)

    # Cache for 10 minutes (v2 key) — v3.238: 스타일링 판정 오류 응답은 캐시하지 않는다
    if styling_cacheable:
        await redis.setex(f"cache:track:v4:{track_id}", 600, json.dumps(track, default=str))

    # uploader_profile_image 는 캐시에 넣지 않고 매 요청 fresh 첨부
    await _attach_uploader_profiles([track], pg)
    # B-11 — album 소속도 캐시에 넣지 않고 매 요청 fresh 첨부
    await _attach_album_info(mongo, [track])

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
    # v210: AI 커버 산출물 — 프론트는 이미 전송 중(UploadPage :425)이었으나 서버가
    # 드롭하던 갭 봉합. 본인 cover_sessions 산출물 증명 실패 시 400 (silent drop 금지).
    cover_object_name: str = Form(None),
    # v214 곡 출처 4필드 (optional — 받은 값 그대로, 64자 캡. 명칭은 서버 생성)
    character_id: str = Form(None),
    persona_id: str = Form(None),
    persona_model: str = Form(None),
    lyrics_id: str = Form(None),
    is_public: bool = Form(True),
    current_user=Depends(get_current_user),
):
    # v3.232 F6 — 어린이 음원 파일 업로드 차단(파일 읽기·저장 전). OFF 면 DB 0회.
    _kids_block = await kids_policy.kids_guard(current_user["id"], "audio_upload")
    if _kids_block is not None:
        return _kids_block
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 파일 형식입니다. ({', '.join(ALLOWED_AUDIO_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_AUDIO_SIZE:
        return JSONResponse(status_code=400, content={"error": "파일 크기는 50MB 이하여야 합니다."})

    # v210: cover_object_name 검증 — MinIO put/doc insert **이전** 수행 (실패 400,
    # 불필요 업로드 방지). 미전송(None)은 기존과 동일하게 cover_image_url=None.
    validated_cover = None
    if cover_object_name:
        _mongo_for_cover = get_mongo()
        cover_ok, cover_src = await _validate_cover_object_name_for_create(
            _mongo_for_cover, cover_object_name, current_user["id"],
        )
        if not cover_ok:
            # 값 본문은 로그 미출력 (길이만) — 임의 문자열/경로 주입 시도 가능성.
            logger.warning(
                "[tracks] upload cover rejected user=%s len=%d",
                current_user["id"][:8], len(cover_object_name),
            )
            return JSONResponse(
                status_code=400,
                content={"error": "유효하지 않은 커버 이미지입니다."},
            )
        validated_cover = cover_object_name
        logger.info(
            "[tracks] upload cover accepted src=%s user=%s",
            cover_src, current_user["id"][:8],
        )

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
    # ── v214 곡 출처 기록 (경로 B — body 값만, gen_doc 승계 없음) ────────────
    src_character_id = (character_id or "").strip()[:64] or None
    src_persona_id = (persona_id or "").strip()[:64] or None
    src_persona_model = (persona_model or "").strip()[:64] or None
    src_lyrics_id = (lyrics_id or "").strip()[:64] or None
    # v230 (가사 DB 단일화, 대표 확정 2026-09-08): 가사가 있는데 자산 출처가 없으면
    # 발매 시점에 가사 자산으로 자동 등록 — lyrics_assets 가 모든 가사의 단일 저장소.
    if (lyrics or "").strip() and not src_lyrics_id:
        from .lyrics_assets import save_lyrics_asset
        _auto_lid = await save_lyrics_asset(
            uploader_id, title=title or "", content=lyrics,
            genre=(genre_list[0] if genre_list else None),
            mood=(mood_list[0] if mood_list else None), source="manual",
        )
        if _auto_lid:
            src_lyrics_id = _auto_lid
            logger.info("[SongSource] auto lyrics-asset on upload lid=%s", _auto_lid)
    # v3.264 — categories 서버 폴백 (from-generation 경로와 동일 규칙).
    if not categories_list:
        from ..services.category_infer import resolve_categories
        categories_list = await resolve_categories(
            get_mongo(), uploader_id, src_lyrics_id, mood=mood_list, genre=genre_list,
        )
    src_persona_id_norm, source_meta = await _resolve_source_meta(
        get_mongo(), uploader_id, src_character_id, src_persona_id, src_lyrics_id,
    )
    if src_character_id or src_persona_id or src_lyrics_id:
        logger.info(
            "[SongSource] track=%s path=file char=%s persona=%s(norm=%s) lyrics=%s meta=%s",
            str(track_id), src_character_id or "-", src_persona_id or "-",
            src_persona_id_norm or "-", src_lyrics_id or "-",
            sorted(source_meta.keys()) if source_meta else None,
        )
    # v236 — 아티스트 지정 곡: 표시용 아티스트명 + 착장 스냅샷을 곡에 동결
    # (차트/플레이어 아티스트 표기와 착장 탭의 근거. 미지정은 둘 다 None — 기획사명 폴백).
    upload_artist_name = (source_meta or {}).get("artist_name") or None
    upload_char_snapshot = (
        await _build_character_snapshot(get_mongo(), uploader_id, src_character_id)
        if src_character_id else None
    )

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
        # v209: Form 으로 받던 lyrics 가 doc 에 저장되지 않던 갭 봉합 —
        # upload-from-generation(:1731 "lyrics": body.lyrics) 관행과 동일하게 원값 그대로(None 허용).
        "lyrics": lyrics,
        "audio_url": object_name,
        # v210: 검증 통과한 AI 커버 산출물 (미전송 시 None — 기존 동작 동일).
        "cover_image_url": validated_cover,
        # v214 — 곡 출처 4필드 + 표시 스냅샷 (경로 B)
        "character_id": src_character_id,
        "persona_id": src_persona_id_norm,
        "persona_model": src_persona_model,
        "lyrics_id": src_lyrics_id,
        "source_meta": source_meta,
        # v236 — 아티스트 표기·착장 (미지정 시 None: 직렬화가 기획사명 폴백)
        "artist_name": upload_artist_name,
        "user_character_snapshot": upload_char_snapshot,
        "waveform_data": [],
        "play_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "is_public": is_public,
        "created_at": now,
        "updated_at": now,
        # v44 — beat extraction status (background task fires after insert)
        # v3.244 — 스위치 OFF 면 "skipped" (부팅 복구의 pending 스캔에 안 걸림)
        "beats_status": "pending" if settings.beats_extraction_enabled else "skipped",
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

    # v3.251 인지도 — 발매 +100 RP (best-effort, 발매 응답 불변 — star-econ 훅 관행)
    if src_character_id:
        try:
            from ..services.recognition import RP_RELEASE, award_rp
            await award_rp(mongo, src_character_id, RP_RELEASE, "release", actor=uploader_id, ref=str(track_id))
        except Exception as e:
            logger.warning("[Recog] release hook failed track=%s: %s", str(track_id)[:8], e)

    # v44 — fire-and-forget beat extraction in a fresh event loop
    # v3.244 — BEATS_EXTRACTION_ENABLED=false 면 큐잉 생략(발매는 그대로 진행)
    if settings.beats_extraction_enabled:
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
    # v211: mv_object_name 데드 필드 제거 확정 (v210 유보 종결) — MV→트랙 연결은
    # 부착 API(POST /mv/jobs/{id}/attach) 로 대체. pydantic extra 기본 ignore 라
    # 구 클라이언트가 보내도 무해.
    ai_model: Optional[str] = "Suno"
    # ── v214 곡 출처 기록 (앱팀 B-4) — 받은 값 그대로 저장(400·422 없음).
    # 캡은 저장부 수동 [:64] 자름(경로 B 와 통일 — planner 판정: 출처는 부가 메타,
    # 출처 때문에 업로드 본 동작이 실패하면 안 됨. 잘린 id 는 resolve 실패 →
    # meta 없음 → 표기 생략으로 자연 무해).
    # persona_id 는 clone_id 권장이나 Suno voice_id 로 와도 서버가 역매핑 정규화.
    # 표시 명칭(source_meta)은 본인 소유 문서 일치 시에만 서버 생성 — 스푸핑 차단.
    character_id: Optional[str] = None
    persona_id: Optional[str] = None
    persona_model: Optional[str] = None
    lyrics_id: Optional[str] = None
    # v71: MV 안 만들고 cover 만 만든 곡도 cover_character 노출 가능하도록
    # publish 시점의 사용자 캐릭터 snapshot 을 트랙 도큐먼트에 박음.
    # 구조는 mv_jobs.user_character_snapshot 와 동일.
    user_character_snapshot: Optional[dict] = None
    # v74: 두 클립 variant 중 어느 것을 트랙으로 업로드할지 선택
    # 0 = result_audio_url (BC), >=1 = variants[variant_index].audio_url
    variant_index: Optional[int] = 0
    # ── v3.200 ② 트랙 유형 — 'standard' 고정(현행), 프로모션 때 'copyright_ready' 추가 예정
    track_type: Optional[str] = "standard"
    # v3.200 창작 기록 계층 — FINALIZE 연동 (미전송 시 gen_doc.session_id 폴백,
    # 세션 미존재 시 무해 통과 — 구버전 앱 하위호환)
    session_id: Optional[str] = None
    lyrics_version_id: Optional[str] = None


@router.post("/upload-from-generation", status_code=201)
async def upload_from_generation(
    body: UploadFromGenerationBody,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Create a track from a completed AI generation."""
    # v3.232 G1 — 곡 공개 제목 금칙어(1차: 어린이만, 성인은 즉시 통과·DB 0회). 저장 전.
    _wf = await word_filter_response(current_user["id"], [body.title], "track_publish")
    if _wf is not None:
        return _wf
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

    # v74 — Determine audio source: specific variant
    # v199: 「내 목소리로 변환」 기능 제거에 따라 보이스 변환 분기를 삭제했다.
    import logging as _logging
    _log = _logging.getLogger(__name__)
    variant_index = body.variant_index or 0
    if variant_index < 0:
        return JSONResponse(status_code=400, content={"error": "variant_index는 0 이상이어야 합니다."})

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
        "[UploadVariant] gen=%s variant=%d source=%s",
        body.generation_id, variant_index, source_object_name,
    )

    # v210: cover_object_name 무검증 저장 구멍 봉합 — /upload(분기 B)와 동일 헬퍼.
    # MinIO 복사/doc insert 이전 검증. 미전송(None)은 기존대로 None 저장 (400 아님).
    if body.cover_object_name:
        cover_ok, cover_src = await _validate_cover_object_name_for_create(
            mongo, body.cover_object_name, current_user["id"],
        )
        if not cover_ok:
            logger.warning(
                "[tracks] upload cover rejected user=%s len=%d (from-generation)",
                current_user["id"][:8], len(body.cover_object_name),
            )
            return JSONResponse(
                status_code=400,
                content={"error": "유효하지 않은 커버 이미지입니다."},
            )
        logger.info(
            "[tracks] upload cover accepted src=%s user=%s (from-generation)",
            cover_src, current_user["id"][:8],
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
            # v3.244 — 스위치 OFF 면 "skipped"
            "beats_status": "pending" if settings.beats_extraction_enabled else "skipped",
            "tempo": None,
            "beats": [],
            "downbeats": [],
            "beats_started_at": None,
            "beats_completed_at": None,
            "beats_error": None,
        }

    # ── v214 곡 출처 기록 (앱팀 B-4) ─────────────────────────────────────────
    # 승계 규칙: body 값 > gen_doc 값(persona 는 voice_id→clone_id 역매핑 정규화)
    # > gen_doc.lyrics_source(작곡 시점 동결 스냅샷). 받은 값 그대로 — 400 없음.
    src_character_id = (body.character_id or "").strip()[:64] or None
    src_persona_id = (body.persona_id or "").strip()[:64] or None
    src_persona_model = (body.persona_model or "").strip()[:64] or None
    src_lyrics_id = (body.lyrics_id or "").strip()[:64] or None
    gen_lyrics_source = gen_doc.get("lyrics_source") or None
    if not src_persona_id and gen_doc.get("persona_id"):
        # gen_doc.persona_id = Suno voice_id (v213 실측) — 역매핑이 clone_id 로 정규화
        src_persona_id = str(gen_doc["persona_id"])[:64]
        if not src_persona_model and gen_doc.get("persona_model"):
            src_persona_model = str(gen_doc["persona_model"])[:64]
    if not src_lyrics_id and isinstance(gen_lyrics_source, dict):
        src_lyrics_id = (gen_lyrics_source.get("lyrics_id") or "").strip()[:64] or None
    # v236 — 작곡 시 선택한 아티스트 승계 (body 미전송 시 gen_doc.character_id 폴백)
    if not src_character_id and gen_doc.get("character_id"):
        src_character_id = str(gen_doc["character_id"]).strip()[:64] or None
    # v230 (가사 DB 단일화): 자산 출처 없는 가사는 발매 시 자동 등록 (파일 경로와 동일)
    if (body.lyrics or "").strip() and not src_lyrics_id:
        from .lyrics_assets import save_lyrics_asset
        _auto_lid = await save_lyrics_asset(
            uploader_id, title=(body.title or ""), content=body.lyrics, source="ai",
        )
        if _auto_lid:
            src_lyrics_id = _auto_lid
            logger.info("[SongSource] auto lyrics-asset on upload-from-generation lid=%s", _auto_lid)
    src_persona_id_norm, source_meta = await _resolve_source_meta(
        mongo, uploader_id, src_character_id, src_persona_id, src_lyrics_id,
        lyrics_source=gen_lyrics_source,
    )
    logger.info(
        "[SongSource] track=%s path=from-generation char=%s persona=%s(norm=%s) lyrics=%s meta=%s",
        str(track_id), src_character_id or "-", src_persona_id or "-",
        src_persona_id_norm or "-", src_lyrics_id or "-",
        sorted(source_meta.keys()) if source_meta else None,
    )
    # v3.264 — categories 서버 폴백: 앱이 categories 를 싣지 않아(09-23 이후 전곡 [])
    # 느낌 칩·느낌명 검색에서 최신곡이 사라진 버그. 비었으면 가사 자산 LLM 선택 →
    # mood/genre 매핑 순으로 서버가 채운다 (best-effort, 발매 무영향).
    if not categories_list:
        from ..services.category_infer import resolve_categories
        categories_list = await resolve_categories(
            mongo, uploader_id, src_lyrics_id, mood=mood_list, genre=genre_list,
        )

    # v243(대표) — '이야기' 서버 폴백: FE가 prompt(이야기 요약)를 못 실었을 때
    # (기기 변경·store 유실 등) 가사 자산의 story 필드로 서버가 구성한다.
    release_prompt = (body.prompt or "").strip() or None
    if not release_prompt and src_lyrics_id:
        try:
            _asset = await mongo.lyrics_assets.find_one(
                {"lyrics_id": src_lyrics_id, "user_id": uploader_id}, {"story": 1},
            )
            _st = (_asset or {}).get("story") or {}
            _lines = []
            for _label, _key in (("주제", "topic"), ("꼭 들어갈 말", "keywords"), ("시점", "perspective"), ("추가 요청", "reference")):
                if _st.get(_key):
                    _lines.append(f"{_label}: {_st[_key]}")
            if _lines:
                release_prompt = "\n".join(_lines)
                logger.info("[SongSource] story fallback from lyrics asset lid=%s lines=%d", src_lyrics_id, len(_lines))
        except Exception:
            logger.warning("[SongSource] story fallback failed lid=%s", src_lyrics_id)

    # v236 — 아티스트 지정 곡: 곡의 아티스트명 동결 + 스냅샷은 "그 아티스트" 기준 서버 생성이
    # body 스냅샷(레거시: /character/me 대표 캐릭터 기준 — 선택 아티스트와 다를 수 있음)보다 우선.
    release_artist_name = (source_meta or {}).get("artist_name") or None
    # v3.234 S3 — 보관함 커버(cover_object_name)로 발매: 그 커버 세션에 같은 아티스트 착장
    # 스냅샷이 있으면 서버 현재 착장 대신 채택(곡 스타일링 = 커버 착장). 커버 없이 발매·다른
    # 아티스트 커버·구세션(현재 착장 = v236 과 동일)은 현행 그대로. 실패는 격리.
    _cover_snap = None
    if body.cover_object_name:
        try:
            _cover_snap, _cov_src, _cov_reason = await _cover_outfit_snapshot(
                mongo, uploader_id, body.cover_object_name,
                {"character_id": src_character_id, "user_character_snapshot": user_character_snapshot},
                allow_legacy=False,
            )
            _log_cover_outfit(
                str(track_id), src_character_id or (user_character_snapshot or {}).get("character_id"),
                _cov_src, _cover_snap, _cov_reason, user_character_snapshot,
            )
        except Exception as e:
            _cover_snap = None
            logger.warning(
                "[CoverOutfitSnap] track=%s decision=error err=%s: %s — publish continues",
                str(track_id)[:8], type(e).__name__, str(e)[:160],
            )
    if _cover_snap:
        user_character_snapshot = _cover_snap
    elif src_character_id:
        _server_snap = await _build_character_snapshot(mongo, uploader_id, src_character_id)
        if _server_snap:
            user_character_snapshot = _server_snap
    # v3.235 S5 — 스냅샷 출처가 커버 세션이 아니면, 발매 시점에 진행 중인 같은 아티스트 옷 입히기를
    # 추적 표시(저장되는 순간 이 곡 스타일링에 반영 — S6). 조회 실패 = 표시 없음(발매 불변).
    _outfit_follow = None
    if src_character_id and not _cover_snap:
        _outfit_follow = await _arm_outfit_follow(mongo, uploader_id, src_character_id, str(track_id), now)

    doc = {
        "_id": track_id,
        "title": body.title,
        "uploader_id": uploader_id,
        "uploader_nickname": current_user.get("nickname", ""),
        "ai_model": body.ai_model,
        "prompt": release_prompt,  # v243 — body.prompt 또는 가사 자산 story 폴백
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
        # v3.200 ② — 발매 트랙 유형 (화이트리스트 밖 값은 standard 로 정규화)
        "track_type": (body.track_type or "standard") if (body.track_type or "standard") in ("standard", "copyright_ready") else "standard",
        "user_character_snapshot": user_character_snapshot,
        # v236 — 아티스트 표기 (미지정 시 None: 직렬화가 기획사명 폴백)
        "artist_name": release_artist_name,
        # v214 — 곡 출처 4필드(받은 값 그대로, persona 만 정규화) + 서버 생성 표시 스냅샷.
        # 응답면 전부 pass-through(projection 0) — 저장만으로 my/상세/charts/채널 자동 동봉.
        "character_id": src_character_id,
        "persona_id": src_persona_id_norm,
        "persona_model": src_persona_model,
        "lyrics_id": src_lyrics_id,
        "source_meta": source_meta,
        "created_at": now,
        "updated_at": now,
        **beats_fields,
    }

    await mongo.tracks.insert_one(doc)
    if _outfit_follow:  # v3.235 S5 — 곡 저장 뒤 추적 표시(실패 = 표시 없음, 발매 불변)
        try:
            await mongo[OUTFIT_FOLLOW_COLLECTION].insert_one(_outfit_follow)
        except Exception as e:  # noqa: BLE001
            logger.warning("[OutfitFollow] arm store failed track=%s err=%s — publish continues", str(track_id)[:8], type(e).__name__)
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

    # v3.251 인지도 — 발매 +100 RP (best-effort, 발매 응답 불변 — star-econ 훅 관행)
    if src_character_id:
        try:
            from ..services.recognition import RP_RELEASE, award_rp
            await award_rp(mongo, src_character_id, RP_RELEASE, "release", actor=uploader_id, ref=str(track_id))
        except Exception as e:
            logger.warning("[Recog] release hook failed track=%s: %s", str(track_id)[:8], e)

    # Update generation with result_track_id
    await mongo.generations.update_one(
        {"_id": ObjectId(body.generation_id)},
        {"$set": {"result_track_id": str(track_id), "updated_at": now}},
    )

    # ── v3.200 창작 기록 계층 — FINALIZE 훅 (발매=세션 종료 §4.2, best-effort) ──
    # session: body.session_id > gen_doc.session_id. 세션 미존재/기록 실패는
    # 무해 통과 — 발매 본 동작은 절대 실패하지 않는다 (구버전 앱 하위호환).
    # candidate 미존재(구버전 세션 등)면 경고만 남기고 기록(완전 검증은 후속).
    try:
        _cl_session_id = (body.session_id or "").strip() or gen_doc.get("session_id")
        if _cl_session_id:
            import hashlib as _hashlib
            from ..services.creation_log import finalize_session as _cl_finalize
            _cl_lyrics_vid = (
                (body.lyrics_version_id or "").strip()
                or gen_doc.get("lyrics_version_id")
                or None
            )
            # 최종본 오디오 SHA-256 — 방금 복사한 원본 바이트에서 직접 계산
            # (gen variants.audio_sha256 과 동일해야 정상 — 복사는 무변환).
            _cl_audio_sha = _hashlib.sha256(audio_data).hexdigest()
            _cl_res = await _cl_finalize(
                _cl_session_id,
                candidate_id=f"{body.generation_id}:v{variant_index}",
                audio_sha256=_cl_audio_sha,
                lyrics_version_id=_cl_lyrics_vid,
                trigger="publish",
                track_type=doc.get("track_type"),
                actor="user",
                strict_candidate=False,  # BC — 경고 기록만, 발매는 막지 않음(PLAN §4-5)
            )
            logger.info(
                "[creation-log] FINALIZE hook track=%s session=%s result=%s",
                str(track_id), str(_cl_session_id)[:8],
                "already_finalized" if _cl_res.get("already_finalized") else "ok",
            )
    except Exception as _cl_exc:
        logger.warning("[creation-log] FINALIZE hook failed track=%s: %s", str(track_id), _cl_exc)

    # v211 — MV 부착 발매 승계 (promote): 이 generation 에 부착된 MV job 을
    # attached_track_id 로 승격 → 배지 🕓발매 전 → ✅발매됨 자동 전환.
    # best-effort (발매보상 훅 관행 — 업로드는 절대 비실패). 같은 generation
    # 재업로드(variant 포함)는 attached_track_id 기존재 조건으로 no-op.
    try:
        _promote = await mongo.mv_jobs.update_one(
            {
                "attached_generation_id": body.generation_id,
                "$or": [
                    {"attached_track_id": None},
                    {"attached_track_id": {"$exists": False}},
                ],
            },
            {"$set": {"attached_track_id": str(track_id), "updated_at": now}},
        )
        if _promote.modified_count:
            logger.info(
                "[MVAttach] promote gen=%s -> track=%s",
                body.generation_id, str(track_id),
            )
            # 방어적 캐시 무효화 — 신생 트랙이라 캐시 無 예상(무해).
            try:
                _redis = get_redis()
                await _redis.delete(f"cache:track:{str(track_id)}")
                await _redis.delete(f"cache:track:v4:{str(track_id)}")
            except Exception:
                pass
    except Exception as e:
        logger.warning("[MVAttach] promote failed gen=%s: %s", body.generation_id, e)

    # v44 — Trigger background extraction only if we couldn't inherit
    # v3.244 — BEATS_EXTRACTION_ENABLED=false 면 큐잉 생략
    if not inherit_beats and settings.beats_extraction_enabled:
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

    # v202-r: 중앙 헬퍼 internal_presign — 내부 endpoint 서명 유지(종전 동작),
    # secure/region/자격증명 스위치만 중앙 반영. (public host 는 hairpin NAT 로 회귀 유발)
    url = internal_presign(doc["audio_url"], bucket=settings.minio_bucket_music, expires=timedelta(hours=1))
    if not url:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    return {"stream_url": url}


@router.post("/download/{track_id}")
async def download_track(track_id: str, user: dict = Depends(get_current_user)):
    """Download a track file and record it for chart calculation."""
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})
    logger.info(
        "[TrackDownload] enter track=%s user=%s",
        track_id[:8], str(user.get("id") or user.get("user_id") or "")[:8],
    )

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"audio_url": 1, "title": 1, "uploader_id": 1, "is_public": 1, "report_blinded": 1,
         "character_id": 1},  # v3.251 — 인지도 훅용(귀속 아티스트)
    )
    if not doc or not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # v196 ① 직링크 가드 — 비공개·블라인드 트랙 다운로드는 소유자(또는 admin) 외 404.
    # 반드시 아래 Redis 차트 집계보다 **앞**에 둔다(차단된 다운로드가 차트에 계상되면 안 됨).
    if _is_hidden_track(doc) and not _can_view_hidden_track(doc, user):
        logger.info("[report] track download_denied track=%s", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

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

    # v3.230 S2(D5) — 본인 곡 다운로드는 차트 셋 미가산(download_logs 에 is_owner 기록,
    # download_count 총계는 현행 유지). 시간 셋 TTL 2h→26h(롤링 24시간 원천, charts.HOURLY_SET_TTL 과 동일).
    is_owner = bool(doc.get("uploader_id")) and str(doc.get("uploader_id")) == user_id
    if is_owner:
        logger.info(
            "[ChartOwnerExclude] download track=%s user=%s owner=True skip_chart=True",
            track_id[:8], user_id[:8],
        )
    else:
        pipe = redis.pipeline()
        # Download dedup sets (1 user = 1 count per period)
        dl_keys_ttl = [
            (f"chart:downloads:hourly:{keys['hourly']}:{track_id}", 26 * 3600),
            (f"chart:downloads:daily:{keys['daily']}:{track_id}", 2 * 86400),
            (f"chart:downloads:weekly:{keys['weekly']}:{track_id}", 8 * 86400),
            (f"chart:downloads:monthly:{keys['monthly']}:{track_id}", 32 * 86400),
        ]
        for key, ttl in dl_keys_ttl:
            pipe.sadd(key, user_id)
            pipe.expire(key, ttl)

        # Download track index sets
        dl_index_ttl = [
            (f"chart:dl_tracks:hourly:{keys['hourly']}", 26 * 3600),
            (f"chart:dl_tracks:daily:{keys['daily']}", 2 * 86400),
            (f"chart:dl_tracks:weekly:{keys['weekly']}", 8 * 86400),
            (f"chart:dl_tracks:monthly:{keys['monthly']}", 32 * 86400),
        ]
        for key, ttl in dl_index_ttl:
            pipe.sadd(key, track_id)
            pipe.expire(key, ttl)

        await pipe.execute()
        logger.info("[ChartOwnerExclude] download track=%s user=%s owner=False counted=True", track_id[:8], user_id[:8])

    # v111: 다운로드 포인트 적립 제거 (사용자 정책 — 적립은 play/generate/upload 만).

    # Save to MongoDB for persistence
    await mongo.download_logs.insert_one({
        "user_id": user_id,
        "track_id": track_id,
        "downloaded_at": now,
        "is_owner": is_owner,
    })

    # Increment download_count in MongoDB
    await mongo.tracks.update_one(
        {"_id": ObjectId(track_id)},
        {"$inc": {"download_count": 1}},
    )

    # v3.251 인지도 — 유효 다운로드 +30 RP (본인 다운로드 미지급 — is_owner 다운로드 관행, best-effort)
    if not is_owner and doc.get("character_id"):
        try:
            from ..services.recognition import RP_DOWNLOAD, award_rp
            await award_rp(mongo, str(doc["character_id"]), RP_DOWNLOAD, "download", actor=user_id, ref=track_id)
        except Exception as e:
            logger.warning("[Recog] download hook failed track=%s: %s", track_id[:8], e)

    # Get presigned URL for download
    # v202-r: 중앙 헬퍼 internal_presign — 내부 endpoint 서명 유지(종전 동작),
    # secure/region/자격증명 스위치만 중앙 반영. (public host 는 hairpin NAT 로 회귀 유발)
    url = internal_presign(doc["audio_url"], bucket=settings.minio_bucket_music, expires=timedelta(hours=1))
    if not url:
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    title = doc.get("title", "track")
    ext = doc["audio_url"].rsplit(".", 1)[-1] if "." in doc["audio_url"] else "mp3"

    return {"download_url": url, "filename": f"{title}.{ext}"}


@router.post("/{track_id}/share-performed")
async def share_performed(track_id: str, user: dict = Depends(get_current_user)):
    """v3.251 인지도 — 공유 = 공연: 앱이 공유 완료 시 기록 → 아티스트 RP +10.

    dedup = 유저·곡·KST일 1회(recognition_events 유니크 키 — point_events 패턴).
    비공개·블라인드 곡은 타인에게 404(존재 비노출 — 다운로드 가드 관행), 열람 가능해도
    비공개면 미지급(공연 = 공개 곡 전제). 미귀속 곡(character_id 없음)은 rp_granted 0.
    응답: {rp_granted: 0|10, recognition: {...갱신본}|null}.
    """
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})
    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"character_id": 1, "uploader_id": 1, "is_public": 1, "report_blinded": 1},
    )
    if not doc:
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)
    hidden = _is_hidden_track(doc)
    if hidden and not _can_view_hidden_track(doc, user):
        logger.info("[Recog] share denied(hidden) track=%s", track_id[:8])
        return JSONResponse(status_code=404, content=_TRACK_NOT_FOUND)

    from ..services.recognition import RP_SHARE, award_rp, claim_share_once, get_recognition

    user_id = str(user.get("id") or user.get("user_id"))
    cid = str(doc.get("character_id") or "").strip()
    granted = 0
    recognition = None
    if cid and not hidden:
        if await claim_share_once(mongo, user_id, track_id):
            recognition = await award_rp(mongo, cid, RP_SHARE, "share", actor=user_id, ref=track_id)
            if recognition is not None:
                granted = RP_SHARE
        else:
            logger.info("[Recog] share dedup user=%s track=%s", user_id[:8], track_id[:8])
    if recognition is None and cid:
        recognition = await get_recognition(mongo, cid)
    logger.info(
        "[Recog] share-performed track=%s user=%s cid=%s granted=%d",
        track_id[:8], user_id[:8], (cid or "-")[:8], granted,
    )
    return {"rp_granted": granted, "recognition": recognition}


# ── v126: SNS 공유영상 (커버+음원 9:16 스틸 mp4) ──────────────────────────────

# v3.228 — 같은 사용자·같은 조합 인코딩 in-flight 합류(재과금·ffmpeg 이중 실행 방지).
# key = 조합 과금 ref(share_video:{track}:{fmt}[:스타일]) — 단일 워커 프로세스 로컬.
# 합류 대기는 앱 timeout(300s)·nginx proxy_read_timeout(320s)보다 짧게 둔다.
_SV_INFLIGHT: dict = {}
SV_JOIN_WAIT_SEC = 240


async def _sv_recut_free(user_id: str, track_id: str, fmt: str, style_kw: dict) -> tuple:
    """v3.282 [대표 "15초 구간은 편집만 하는 건데 별이 들어가면 안 되지"] — 구간 재편집 무과금 판정(서버).

    같은 곡·형식·스타일 조합(구간 제외)의 영상이 이미 만들어진 적 있으면 True:
      ① 캐시: 원본(구간 미지정) 객체 또는 같은 조합의 구간 객체(`{stem}_t…`)가 MinIO 에 있음
         — 원본 재요청이 캐시 히트 무과금인 기존 관행과 같은 기준(누가 만들었든 조합 단위).
      ② 원장: 본인의 gen_jobs(kind=video, status=done, charged=true) 중 같은 track·format·style.
         (캐시 객체가 사라져도 본인이 과금해 만든 조합이면 편집은 무료)
    반환 (bool, basis). 조회 실패는 False(=기존대로 과금 — 보수적).
    """
    from ..services.share_video import share_object_name

    stem = share_object_name(track_id, fmt, **style_kw)[:-4]

    def _cache():
        mc = get_minio()
        try:
            mc.stat_object(bucket_name=settings.minio_bucket_music, object_name=stem + ".mp4")
            return "cache-base"
        except Exception:
            pass
        try:
            for _o in mc.list_objects(bucket_name=settings.minio_bucket_music, prefix=stem + "_t", recursive=True):
                return "cache-clip"
        except Exception:
            logger.warning("[ShareVideo] recut cache scan failed track=%s fmt=%s", track_id, fmt)
        return None

    why = await asyncio.to_thread(_cache)
    if why:
        return True, why
    try:
        q = {"user_id": user_id, "kind": "video", "status": "done", "charged": True,
             "meta.track_id": track_id, "meta.format": fmt}
        for k, v in style_kw.items():
            q["meta.style." + k] = v
        prev = await get_mongo().gen_jobs.find_one(q, {"_id": 1})
        if prev:
            return True, "ledger:" + str(prev["_id"])[-8:]
    except Exception:
        logger.warning("[ShareVideo] recut ledger lookup failed track=%s fmt=%s", track_id, fmt)
    return False, None


@router.post("/{track_id}/share-video")
async def create_share_video(
    track_id: str,
    format: str = Query("sns"),
    layout: str = Query("full"),
    shape: str = Query("square"),
    lyrics: str = Query("scroll"),
    font: str = Query("basic"),
    fontcolor: str = Query("white"),
    bg: str = Query("blur"),
    bgblur: str = Query("mid"),
    bgcolor: str = Query(""),
    bgalpha: str = Query("45"),
    fontbold: str = Query("0"),
    fontitalic: str = Query("0"),
    subpos: str = Query("auto"),
    fontoutline: str = Query("1"),
    outlinecolor: str = Query(""),
    clip_start: Optional[float] = Query(None),  # v3.281 [52]: kakao 15초 클립 시작(초) — 미지정=자동(가사 시작)
    clip_end: Optional[float] = Query(None),  # v3.282: 구간 끝(초) — 전 포맷 트리머(최소 5초, kakao 최대 15초)
    current_user=Depends(get_current_user),
    x_gen_request_id: Optional[str] = Header(None),
):
    """공유영상 생성 (v247: 로그인 필수 — 신규 생성 시 ⭐ 과금, 캐시 히트는 무과금). 공개 트랙만.

    v3.228: 캐시 히트(무과금·무게이트) 불변 → 같은 사용자·같은 조합이 인코딩 중이면 합류 대기
    (최대 SV_JOIN_WAIT_SEC, 성공 시 200 cached:true·joined:true 무과금, 초과 시 409) → 피로 429 →
    요청 원장(gen_jobs kind=video) 진행 중 409(조합 무관 사용자당 1건) → 잔액 402. 과금 ref 는
    시도별 고유(`…:{job8}`) — 같은 날 두 번째 차감의 이벤트 유실(DuplicateKey) 해소.
    헤더 X-Gen-Request-Id(선택). 응답에 gen_job_id·request_id 가산.

    format(v129): sns(9:16 전체) / wide(16:9 블러배경) / kakao(1080x2340 15s).
    v3.179 스타일: layout(full|center) / shape(square|circle) / lyrics(scroll|line) —
    스타일 조합별 별도 캐시·별도 1회 과금(같은 조합 재요청은 무과금).
    v3.209: fontoutline("1" 기본|"0")·outlinecolor(""=검정 기본|hex6) — 자막 테두리 on/off·색.
    v3.214: ④ 가사 없는 곡(연주곡, Inst 파생 제외)은 제목 drawtext 전달, ⑦⑧ 캐시 v7,
    ⑨ video 디렉터 피로 게이트(429) → ⭐ 차감 → 성공 시 완성 훅 (캐시 히트는 무과금·무피로).
    v3.215: 정적 요소 PIL 사전 합성(인코딩 성능) — 캐시 v8 승격 (구 v6/v7 하위호환).
    v3.281 [52]: clip_start(선택, 초) — kakao 에서만 의미. 0.1s 양자화·[0, duration_sec−15] 클램프 후
    캐시 키(object name `_t{ds}`)·과금 ref·video_url 에 포함(미지정이면 전부 기존과 비트 동일).
    과금은 기존 관행 그대로 — 새 구간 = 캐시 미스 = 신규 1회 과금, 같은 구간 재요청 = 캐시 히트 무과금.
    v3.282 [59][52]: clip_start+clip_end 트리머(전 포맷, normalize_clip — 최소 5초·kakao ≤15초,
    sns/wide 곡 전체는 미지정으로 접음). 구간 미지정 요청은 키·과금·동작 바이트 동일.
    **구간 편집 무과금**: 구간 지정 요청이 캐시 미스여도, 같은 곡·형식·스타일 조합이 이미 만들어진 적
    있으면(_sv_recut_free — 캐시 원본/구간 객체 존재 또는 본인 과금 완료 원장) ⭐·피로 게이트·피로 적립 없이
    생성. 응답 charged(bool)·recut_free(bool) 가산.
    """
    from ..services.share_video import (
        FORMATS,
        STYLE_BGALPHAS,
        STYLE_BGBLURS,
        STYLE_BGS,
        STYLE_FONTOUTLINES,
        STYLE_FONTS,
        STYLE_LAYOUTS,
        STYLE_LYRICS,
        STYLE_SHAPES,
        STYLE_SUBPOS,
        _HEX6_RE,
        ShareVideoError,
        _fetch_lyric_segments,
        generate_share_video,
        normalize_clip,
        share_video_exists,
        valid_fontcolor,
    )

    if format not in FORMATS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 형식입니다."})
    if (layout not in STYLE_LAYOUTS or shape not in STYLE_SHAPES or lyrics not in STYLE_LYRICS
            or font not in STYLE_FONTS or not valid_fontcolor(fontcolor) or bg not in STYLE_BGS
            or bgblur not in STYLE_BGBLURS or bgalpha not in STYLE_BGALPHAS
            or fontbold not in ("0", "1") or fontitalic not in ("0", "1")
            or (subpos != "auto" and subpos not in STYLE_SUBPOS)
            or (bg == "color" and not _HEX6_RE.match(bgcolor or ""))
            # v3.209: 자막 테두리 축 검증 — outlinecolor 는 ""(기본 검정) 또는 hex6
            or fontoutline not in STYLE_FONTOUTLINES
            or (outlinecolor != "" and not _HEX6_RE.match(outlinecolor))):
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 스타일입니다."})
    # v3.183: subpos 기본(auto) — center 레이아웃이면 이미지 가까이(near), full 은 기존 하단(low)
    if subpos == "auto":
        subpos = "near" if layout == "center" else "low"
    _style_kw = dict(layout=layout, shape=shape, lyrics=lyrics, font=font, fontcolor=fontcolor,
                     bg=bg, bgblur=bgblur, bgcolor=bgcolor, bgalpha=bgalpha,
                     fontbold=fontbold, fontitalic=fontitalic, subpos=subpos,
                     fontoutline=fontoutline, outlinecolor=outlinecolor)

    logger.info(
        "[share-video] enter track=%s format=%s layout=%s shape=%s lyrics=%s font=%s color=%s bg=%s "
        "bgalpha=%s outline=%s/%s",
        track_id, format, layout, shape, lyrics, font, fontcolor, bg,
        bgalpha, fontoutline, outlinecolor or "default",
    )

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        # v3.214 ④: title(제목 drawtext)·source_track_id(Inst 파생 판별) 프로젝션 추가
        {"cover_image_url": 1, "audio_url": 1, "is_public": 1,
         "generation_id": 1, "variant_index": 1, "recognized_timestamps": 1,
         "title": 1, "source_track_id": 1, "duration_sec": 1},
    )
    if not doc or not doc.get("is_public", True):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    if not doc.get("cover_image_url"):
        return JSONResponse(status_code=400, content={"error": "커버 이미지가 없는 곡입니다."})
    if not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # v3.282: 구간 정규화(normalize_clip) — None = 미지정(기존 동작). v3.281 start 단독(kakao) 하위호환.
    _clip_req = (clip_start, clip_end)
    _clip = normalize_clip(format, clip_start, clip_end, doc.get("duration_sec"))
    clip_start, clip_end = _clip if _clip else (None, None)
    if _clip_req != (None, None):
        logger.info("[ShareVideo] clip=%s track=%s format=%s requested=%s duration=%s",
                    _clip, track_id, format, _clip_req, doc.get("duration_sec"))

    video_url = f"/api/tracks/{track_id}/share-video/file"
    _defaults = dict(format="sns", layout="full", shape="square", lyrics="scroll", font="basic",
                     fontcolor="white", bg="blur", bgblur="mid", bgcolor="", bgalpha="45",
                     fontbold="0", fontitalic="0", subpos="low",
                     fontoutline="1", outlinecolor="")  # v3.209: 비기본만 쿼리·과금 ref 직렬화
    _cur = dict(format=format, **_style_kw)
    _q = [f"{k}={v}" for k, v in _cur.items() if v != _defaults[k]]
    if _clip is not None:  # v3.282: 파일 프록시가 같은 object name 을 찾도록
        _q.append(f"clip_start={clip_start}")
        _q.append(f"clip_end={clip_end}")
    if _q:
        video_url += "?" + "&".join(_q)

    # v128: 가사 타임스탬프 조회 (없으면 자막 없이 진행)
    segments = await _fetch_lyric_segments(mongo, doc)
    subtitles = bool(segments)
    # v3.214 ④: 가사 없는 곡(연주곡)은 자막 대신 제목 drawtext — Inst 파생 트랙 제외
    # (기본안: 판별 = source_track_id(v3.210 inst_service 기록), 폴백 = "(Inst.)" 접미사).
    _marquee_title = ""
    if not segments and not doc.get("source_track_id") \
            and not (doc.get("title") or "").rstrip().endswith("(Inst.)"):
        _marquee_title = (doc.get("title") or "").strip()
    logger.info(
        "[share-video] segments=%d subtitled=%s marquee_title=%s track=%s format=%s",
        len(segments), subtitles, bool(_marquee_title), track_id, format,
    )

    if await asyncio.to_thread(lambda: share_video_exists(track_id, format, clip_start=clip_start, clip_end=clip_end, **_style_kw)):
        logger.info("[share-video] cache hit track=%s format=%s style=%s/%s/%s",
                    track_id, format, layout, shape, lyrics)
        return {"video_url": video_url, "cached": True, "subtitles": subtitles,
                "format": format, "clip_start": clip_start, "clip_end": clip_end,
                "charged": False, "recut_free": False}

    # v3.179: 스타일 조합별 별도 과금 ref (기본 조합은 기존 ref 유지 — 환불 멱등 하위호환)
    # v3.228: 조합 ref 는 in-flight 합류 key 로도 쓰고, 실제 과금 ref 는 원장 job8 을 덧붙여 고유화.
    _sv_ref = f"share_video:{track_id}:{format}"
    _nondef = [f"{k}={v}" for k, v in _style_kw.items() if v != _defaults[k]]
    if _clip is not None:
        _nondef.append(f"clip={clip_start}-{clip_end}")  # v3.282: 구간별 별도 ref(합류 key 도 구간 분리)
    if _nondef:
        _sv_ref += ":" + ",".join(_nondef)
    _video_on = gj.enabled("video")
    request_id = gj.normalize_request_id(x_gen_request_id)

    # v3.228 — 같은 사용자·같은 조합 인코딩 진행 중 → 합류 대기(무과금·무피로 — 캐시 히트와 같은 의미)
    _inflight = _SV_INFLIGHT.get(_sv_ref) if _video_on else None
    if _inflight and _inflight.get("user_id") == current_user["id"]:
        gj.logger.info("[VideoDedupe] join user=%s track=%s format=%s job=%s req=%s",
                       gj.u8(current_user["id"]), track_id, format, _inflight.get("job_id"),
                       gj.r8(request_id))
        try:
            await asyncio.wait_for(_inflight["event"].wait(), timeout=SV_JOIN_WAIT_SEC)
        except asyncio.TimeoutError:
            gj.logger.info("[VideoDedupe] join-timeout user=%s job=%s — 409",
                           gj.u8(current_user["id"]), _inflight.get("job_id"))
            return gj.busy_response("video", _inflight.get("job_id"), _inflight.get("request_id"),
                                    _inflight.get("created_at"), _inflight.get("meta"))
        if _inflight.get("ok"):
            gj.logger.info("[VideoDedupe] joined-done user=%s job=%s (no charge)",
                           gj.u8(current_user["id"]), _inflight.get("job_id"))
            return {"video_url": video_url, "cached": True, "subtitles": subtitles,
                    "format": format, "joined": True, "gen_job_id": _inflight.get("job_id"),
                    "clip_start": clip_start, "clip_end": clip_end,
                    "charged": False, "recut_free": False}
        gj.logger.info("[VideoDedupe] joined-failed user=%s job=%s — proceeding as new request",
                       gj.u8(current_user["id"]), _inflight.get("job_id"))

    # v3.282 [대표]: "영상 1편 = 1회 과금, 그 영상 자르기는 무료" — 같은 곡·형식·스타일 조합을 한 번이라도
    # 만들었으면 구간 지정·전체(구간 미지정) 어느 쪽으로 다시 만들어도 무료(서버 판정, 앱 불신).
    _recut_free, _recut_why = False, None
    if True:
        _recut_free, _recut_why = await _sv_recut_free(current_user["id"], track_id, format, _style_kw)
        if _recut_free:
            logger.info("[ShareVideo] clip recut free track=%s fmt=%s clip=%s-%s user=%s basis=%s",
                        track_id, format, clip_start, clip_end, str(current_user["id"])[:8], _recut_why)

    # v3.214 ⑨: video 디렉터 피로 게이트 — ⭐ 차감 **전** 429 (타 디렉터 게이트→과금
    # 순서 관행). 캐시 히트는 위에서 이미 무과금·무게이트 반환 (무비용 재다운로드 유지).
    # v3.282: 구간 편집 무과금도 캐시 히트처럼 무게이트(무피로).
    if not _recut_free:
        from .fatigue import fatigue_gate_response
        _fatigued = await fatigue_gate_response(current_user["id"], director="video")
        if _fatigued:
            return _fatigued

    # v247(대표 확정): 신규 생성만 ⭐ 과금(캐시 히트는 위에서 무과금 반환) — 실패 시 자동 환불
    from ..services.points_service import POINT_COSTS, refund_points, spend_points
    _sv_cost = 0 if _recut_free else POINT_COSTS["share_video"]

    # v3.228 — 요청 원장 + 진행 중 409(과금 전, 조합 무관 사용자당 1건). 순서: 429 → 409 → 402.
    # v3.282: 무과금 편집도 원장은 남긴다(중복 409·회수 유지) — point_ref 없음·cost 0(환불 대상 아님).
    _meta = {"track_id": track_id, "format": format, "style": _style_kw, "video_url": video_url,
             "clip_start": clip_start, "clip_end": clip_end, "recut_free": _recut_free}
    early, job = await gj.gate_and_begin(
        current_user["id"], "video", request_id, meta=_meta,
        point_ref=None if _recut_free else (lambda jid: "{}:{}".format(_sv_ref, jid[-8:])),
        point_cost=_sv_cost,
    )
    if early is not None:
        gj.logger.info("[VideoDedupe] early status=%s user=%s track=%s req=%s",
                       getattr(early, "status_code", "?"), gj.u8(current_user["id"]), track_id,
                       gj.r8(request_id))
        return early
    _charge_ref = (job["point_ref"] if job else _sv_ref) if not _recut_free else None

    if not _recut_free:
        if not await spend_points(current_user["id"], "share_video", _sv_cost, _charge_ref):
            await gj.discard(job)
            return JSONResponse(status_code=402, content={"error": "포인트가 부족합니다 (필요: {})".format(_sv_cost)})
        await gj.mark_charged(job)
        logger.info("[star-econ] share_video spend user=%s -%d ref=%s", current_user["id"][:8], _sv_cost, _charge_ref)

    _slot = None
    if job:
        _slot = {"user_id": current_user["id"], "job_id": str(job["_id"]), "request_id": request_id,
                 "created_at": job.get("created_at"), "meta": _meta, "event": asyncio.Event(), "ok": False}
        _SV_INFLIGHT[_sv_ref] = _slot

    async def _sv_fail(exc_name: str):
        if job:
            _refunded = await gj.fail(job, "video_failed: {}".format(exc_name), refund=not _recut_free)
            gj.logger.info("[VideoDedupe] failed user=%s job=%s refunded=%s",
                           gj.u8(current_user["id"]), str(job["_id"]), _refunded)
        elif not _recut_free:  # v3.282: 무과금 편집은 환불할 것이 없음
            await refund_points(current_user["id"], "share_video", _sv_cost, _charge_ref)

    logger.info("[share-video] cache miss track=%s format=%s style=%s/%s/%s — generating",
                track_id, format, layout, shape, lyrics)
    try:
        try:
            await asyncio.to_thread(
                lambda: generate_share_video(
                    track_id, doc["cover_image_url"], doc["audio_url"], segments, format,
                    layout, shape, lyrics, font, fontcolor, bg, bgblur, bgcolor, bgalpha,
                    fontbold, fontitalic, subpos, fontoutline, outlinecolor,
                    _marquee_title,  # v3.214 ④: 연주곡 제목 drawtext (빈 문자열 = 현행)
                    clip_start=clip_start, clip_end=clip_end,  # v3.282: 구간(None=기존 동작)
                )
            )
        except ShareVideoError:
            await _sv_fail("ShareVideoError")
            logger.warning("[star-econ] share_video refund (failed) user=%s ref=%s", current_user["id"][:8], _charge_ref)
            _err = {"error": "영상 생성에 실패했습니다."}
            if job:
                _err.update({"gen_job_id": str(job["_id"]), "request_id": request_id})
            return JSONResponse(status_code=502, content=_err)
        except Exception as _e:
            await _sv_fail(type(_e).__name__)
            logger.exception("[share-video] unexpected failure track=%s format=%s (refunded)", track_id, format)
            _err = {"error": "영상 생성에 실패했습니다."}
            if job:
                _err.update({"gen_job_id": str(job["_id"]), "request_id": request_id})
            return JSONResponse(status_code=502, content=_err)

        # v3.214 ⑨: 생성 성공 → video 디렉터 완성 카운트+사다리 쿨다운 (best-effort —
        # on_generation_completed 는 절대 raise 하지 않음. 실패 경로는 위에서 환불 후 반환).
        # v3.282: 구간 편집 무과금은 피로 적립 없음
        if not _recut_free:
            from ..services.fatigue_service import on_generation_completed
            await on_generation_completed(current_user["id"], director="video")

        _resp = {"video_url": video_url, "cached": False, "subtitles": subtitles,
                 "format": format, "clip_start": clip_start, "clip_end": clip_end,
                 "charged": not _recut_free, "recut_free": _recut_free}
        if job:
            _resp["gen_job_id"] = str(job["_id"])
            _resp["request_id"] = request_id
            await gj.finish(
                job,
                result={"video_url": video_url, "format": format, "subtitles": subtitles,
                        "track_id": track_id, "clip_start": clip_start, "clip_end": clip_end,
                        "charged": not _recut_free, "recut_free": _recut_free},
                response=_resp,
            )
            if _slot is not None:
                _slot["ok"] = True
        return _resp
    finally:
        if _slot is not None:
            _slot["event"].set()
            if _SV_INFLIGHT.get(_sv_ref) is _slot:
                _SV_INFLIGHT.pop(_sv_ref, None)


@router.get("/{track_id}/share-video/clip-info")
async def get_share_video_clip_info(track_id: str):
    """v3.281 [52]: 15초 클립(kakao) 구간 선택 보조 정보 (무인증·읽기 전용, 공개 곡만 — POST 와 동일 조건).

    응답: {track_id, duration(초|null — tracks.duration_sec), clip_seconds(15),
           lyric_start(기존 자동 시작점 = 첫 가사−0.5s), chorus_start(첫 [Chorus] 태그−0.5s, 없으면 null)}
    값은 모두 clamp_clip_start 정규화(0.1s 양자화·[0, duration−15]) — 앱이 그대로 clip_start 로 보내면
    POST 정규화 결과와 같아 파일 프록시 조회 키가 일치한다. 과금·원장 무관.
    """
    from ..services.share_video import (
        CLIP_MIN_SECONDS, KAKAO_CLIP_SECONDS, _fetch_lyric_segments, _generation_timestamps,
        auto_clip_start, clamp_clip_start, first_chorus_start,
    )

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"is_public": 1, "generation_id": 1, "variant_index": 1,
         "recognized_timestamps": 1, "duration_sec": 1},
    )
    if not doc or not doc.get("is_public", True):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    duration = doc.get("duration_sec")
    try:
        duration = float(duration) if duration else None
    except (TypeError, ValueError):
        duration = None
    segments = await _fetch_lyric_segments(mongo, doc)
    lyric_start = clamp_clip_start(auto_clip_start(segments), duration)
    chorus_raw = first_chorus_start(await _generation_timestamps(mongo, doc))
    chorus_start = (
        clamp_clip_start(max(0.0, chorus_raw - 0.5), duration) if chorus_raw is not None else None
    )
    logger.info(
        "[ShareVideo] clip-info track=%s duration=%s lyric_start=%s chorus_start=%s",
        track_id, duration, lyric_start, chorus_start,
    )
    return {
        "track_id": track_id, "duration": duration, "clip_seconds": KAKAO_CLIP_SECONDS,
        "lyric_start": lyric_start, "chorus_start": chorus_start,
        # v3.282 트리머 제약(앱 슬라이더와 서버 normalize_clip 공용 상수)
        "min_seconds": CLIP_MIN_SECONDS, "kakao_max_seconds": KAKAO_CLIP_SECONDS,
    }


@router.get("/{track_id}/share-video/quote")
async def quote_share_video(
    track_id: str,
    format: str = Query("sns"),
    layout: str = Query("full"),
    shape: str = Query("square"),
    lyrics: str = Query("scroll"),
    font: str = Query("basic"),
    fontcolor: str = Query("white"),
    bg: str = Query("blur"),
    bgblur: str = Query("mid"),
    bgcolor: str = Query(""),
    bgalpha: str = Query("45"),
    fontbold: str = Query("0"),
    fontitalic: str = Query("0"),
    subpos: str = Query("auto"),
    fontoutline: str = Query("1"),
    outlinecolor: str = Query(""),
    clip_start: Optional[float] = Query(None),
    clip_end: Optional[float] = Query(None),
    current_user=Depends(get_current_user),
):
    """v3.282: 생성 전 과금 미리보기(읽기 전용 — 차감·원장·피로 없음). 앱의 ⭐ 확인 팝업 문구용.

    응답: {cached, recut_free, charge(bool — 이대로 POST 하면 ⭐ 차감 예정), cost, clip_start, clip_end}
    판정은 POST 와 같은 함수(normalize_clip·share_video_exists·_sv_recut_free). 최종 판정은 POST 가 다시 한다.
    """
    from ..services.share_video import (
        FORMATS, STYLE_BGALPHAS, STYLE_BGBLURS, STYLE_BGS, STYLE_FONTOUTLINES,
        STYLE_FONTS, STYLE_LAYOUTS, STYLE_LYRICS, STYLE_SHAPES, STYLE_SUBPOS,
        _HEX6_RE, normalize_clip, share_video_exists, valid_fontcolor,
    )
    from ..services.points_service import POINT_COSTS

    if format not in FORMATS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 형식입니다."})
    if (layout not in STYLE_LAYOUTS or shape not in STYLE_SHAPES or lyrics not in STYLE_LYRICS
            or font not in STYLE_FONTS or not valid_fontcolor(fontcolor) or bg not in STYLE_BGS
            or bgblur not in STYLE_BGBLURS or bgalpha not in STYLE_BGALPHAS
            or fontbold not in ("0", "1") or fontitalic not in ("0", "1")
            or (subpos != "auto" and subpos not in STYLE_SUBPOS)
            or (bg == "color" and not _HEX6_RE.match(bgcolor or ""))
            or fontoutline not in STYLE_FONTOUTLINES
            or (outlinecolor != "" and not _HEX6_RE.match(outlinecolor))):
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 스타일입니다."})
    if subpos == "auto":
        subpos = "near" if layout == "center" else "low"
    _style_kw = dict(layout=layout, shape=shape, lyrics=lyrics, font=font, fontcolor=fontcolor,
                     bg=bg, bgblur=bgblur, bgcolor=bgcolor, bgalpha=bgalpha,
                     fontbold=fontbold, fontitalic=fontitalic, subpos=subpos,
                     fontoutline=fontoutline, outlinecolor=outlinecolor)
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    doc = await get_mongo().tracks.find_one({"_id": ObjectId(track_id)}, {"is_public": 1, "duration_sec": 1})
    if not doc or not doc.get("is_public", True):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    _clip = normalize_clip(format, clip_start, clip_end, doc.get("duration_sec"))
    cs, ce = _clip if _clip else (None, None)
    cached = await asyncio.to_thread(
        lambda: share_video_exists(track_id, format, clip_start=cs, clip_end=ce, **_style_kw))
    recut_free = False
    if not cached:
        recut_free, _ = await _sv_recut_free(current_user["id"], track_id, format, _style_kw)
    cost = POINT_COSTS["share_video"]
    logger.info("[ShareVideo] quote track=%s fmt=%s clip=%s cached=%s recut_free=%s user=%s",
                track_id, format, _clip, cached, recut_free, str(current_user["id"])[:8])
    return {"cached": cached, "recut_free": recut_free, "charge": not cached and not recut_free,
            "cost": cost, "clip_start": cs, "clip_end": ce}


@router.get("/{track_id}/share-video/file")
async def get_share_video_file(
    track_id: str,
    request: Request,
    download: int = Query(0),
    format: str = Query("sns"),
    layout: str = Query("full"),
    shape: str = Query("square"),
    lyrics: str = Query("scroll"),
    font: str = Query("basic"),
    fontcolor: str = Query("white"),
    bg: str = Query("blur"),
    bgblur: str = Query("mid"),
    bgcolor: str = Query(""),
    bgalpha: str = Query("45"),
    fontbold: str = Query("0"),
    fontitalic: str = Query("0"),
    subpos: str = Query("low"),
    fontoutline: str = Query("1"),
    outlinecolor: str = Query(""),
    clip_start: Optional[float] = Query(None),  # v3.281 [52]: POST video_url 의 정규화값 그대로
    clip_end: Optional[float] = Query(None),  # v3.282
):
    """공유영상 파일 프록시 (무인증). MinIO share/v8/{track_id}[_{format}][_style].mp4 스트리밍."""
    from ..services.share_video import (
        FORMATS, STYLE_BGALPHAS, STYLE_BGBLURS, STYLE_BGS, STYLE_FONTOUTLINES,
        STYLE_FONTS, STYLE_LAYOUTS, STYLE_LYRICS, STYLE_SHAPES, STYLE_SUBPOS,
        _HEX6_RE, normalize_clip, share_object_name, valid_fontcolor,
    )

    if format not in FORMATS:
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 형식입니다."})
    if (layout not in STYLE_LAYOUTS or shape not in STYLE_SHAPES or lyrics not in STYLE_LYRICS
            or font not in STYLE_FONTS or not valid_fontcolor(fontcolor) or bg not in STYLE_BGS
            or bgblur not in STYLE_BGBLURS or bgalpha not in STYLE_BGALPHAS
            or fontbold not in ("0", "1") or fontitalic not in ("0", "1")
            or (subpos != "auto" and subpos not in STYLE_SUBPOS)
            or (bg == "color" and not _HEX6_RE.match(bgcolor or ""))
            # v3.209: 자막 테두리 축 검증 — POST 와 동일
            or fontoutline not in STYLE_FONTOUTLINES
            or (outlinecolor != "" and not _HEX6_RE.match(outlinecolor))):
        return JSONResponse(status_code=400, content={"error": "지원하지 않는 스타일입니다."})
    # v3.183: subpos 기본(auto) — center 레이아웃이면 이미지 가까이(near), full 은 기존 하단(low)
    if subpos == "auto":
        subpos = "near" if layout == "center" else "low"
    _style_kw = dict(layout=layout, shape=shape, lyrics=lyrics, font=font, fontcolor=fontcolor,
                     bg=bg, bgblur=bgblur, bgcolor=bgcolor, bgalpha=bgalpha,
                     fontbold=fontbold, fontitalic=fontitalic, subpos=subpos,
                     fontoutline=fontoutline, outlinecolor=outlinecolor)

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    # v3.282: 구간 — POST video_url 의 정규화값(멱등 재정규화, duration 클램프는 POST 가 끝냄)
    _clip = normalize_clip(format, clip_start, clip_end)
    _cs, _ce = _clip if _clip else (None, None)

    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_music,
            object_name=share_object_name(
                track_id, format, layout, shape, lyrics, font, fontcolor, bg,
                bgblur, bgcolor, bgalpha, fontbold, fontitalic, subpos,
                fontoutline, outlinecolor,  # v3.209: 위치 인자 확장 동기
                clip_start=_cs, clip_end=_ce,  # v3.282
            ),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "공유 영상을 찾을 수 없습니다."})

    logger.info("[share-video] proxy served track=%s format=%s", track_id, format)
    # v3.269 [28b]: Range+inline 공용 헬퍼로 위임 — 위의 get_object 는 존재 확인 겸으로만
    # 쓰고 닫는다(스트림은 헬퍼가 stat+get 으로 다시 연다. 호출 1회 추가 — 정확성 우선).
    _obj_name = share_object_name(
        track_id, format, layout, shape, lyrics, font, fontcolor, bg,
        bgblur, bgcolor, bgalpha, fontbold, fontitalic, subpos,
        fontoutline, outlinecolor, clip_start=_cs, clip_end=_ce,
    )
    try:
        response.close()
        response.release_conn()
    except Exception:
        pass
    try:
        return await _stream_video_with_range(
            request, _obj_name, f"maidol_{track_id}_{format}.mp4", download=bool(download),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "공유 영상을 찾을 수 없습니다."})


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


# ==================================================================
# v3.177 — 곡 댓글 (track_comments) : 피드 댓글(feeds.py) 패턴 이식
#   Mongo `track_comments` + tracks.comment_count $inc, 대댓글 1단 평탄화,
#   알림(comment/reply, target_type='track'). 로그 prefix [track-comment].
# ==================================================================
from .notifications import push_notification  # noqa: E402  (지연 import — 순환 방지)

MAX_TRACK_COMMENT_LEN = 1_000


class TrackCommentBody(BaseModel):
    text: str
    parent_id: Optional[str] = None  # 같은 곡 내 부모 댓글 id (None=최상위)


def _serialize_track_comment(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


async def _get_track_or_404(mongo, track_id: str):
    """(doc, None) 또는 (None, JSONResponse404)."""
    if not ObjectId.is_valid(track_id):
        return None, JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"uploader_id": 1})
    if not doc:
        return None, JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    return doc, None


@router.get("/{track_id}/comments")
async def list_track_comments(track_id: str, page: int = 1, limit: int = 20, conn=Depends(get_pg)):
    """곡 댓글 목록 — 무인증 열람, created_at 오름차순 페이지네이션.

    v3.180: 작성자 프로필 이미지(author_profile_image) PG join 첨부 —
    _attach_uploader_profiles 관행(1쿼리 배치, best-effort, 항상 fresh).
    """
    mongo = get_mongo()
    page = max(1, page)
    limit = max(1, min(limit, 100))
    short = str(track_id)[:8]
    logger.info("[track-comment] list enter track=%s page=%d limit=%d", short, page, limit)

    doc, err = await _get_track_or_404(mongo, track_id)
    if err:
        return err

    query = {"track_id": track_id}
    total = await mongo.track_comments.count_documents(query)
    docs = (
        await mongo.track_comments.find(query)
        .sort("created_at", 1)
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    comments = [_serialize_track_comment(d) for d in docs]

    # v3.180: 작성자 프로필 이미지 배치 join (실패해도 목록은 깨지 않음)
    author_ids = sorted({c.get("author_id") for c in comments if c.get("author_id")})
    if author_ids:
        try:
            rows = await conn.fetch(
                "SELECT id::text, profile_image FROM users WHERE id::text = ANY($1)", author_ids
            )
            img_by_id = {r["id"]: r["profile_image"] for r in rows}
            for c in comments:
                c["author_profile_image"] = img_by_id.get(c.get("author_id"))
        except Exception:
            logger.warning("[track-comment] profile join failed track=%s ids=%d", short, len(author_ids))
            for c in comments:
                c.setdefault("author_profile_image", None)
    logger.info("[track-comment] list ok track=%s returned=%d total=%d", short, len(comments), total)
    return {
        "comments": comments,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": math.ceil(total / limit) if limit else 0,
        },
    }


@router.post("/{track_id}/comments", status_code=201)
async def add_track_comment(track_id: str, body: TrackCommentBody, current_user=Depends(get_current_user)):
    """곡 댓글 작성 — 인증 필수, 대댓글 1단 평탄화, comment_count +1, 알림 발행."""
    mongo = get_mongo()
    user_id = current_user["id"]
    text = (body.text or "").strip()
    short = str(track_id)[:8]
    logger.info("[track-comment] add enter track=%s user=%s text_len=%d", short, str(user_id)[:8], len(text))
    # v3.232 F3+G1 — 어린이 && 보호자 댓글 허용 없음 → 403(1차는 항상). 허용 시(2차)·전체 적용 시 금칙어.
    # v3.233 — 허용값 = 보호자 관리 설정(feed_post → comment) · 소통 경로 전체 적용(WORD_FILTER_SOCIAL_ALL_USERS) 시 성인도 금칙어.
    if kids_policy.kids_enabled() or getattr(settings, "word_filter_all_users", False) or social_filter_on():
        _kids_child = await kids_policy.is_child_user(user_id)
        if _kids_child and not await kids_policy.kids_allows_async(user_id, "comment"):
            return kids_policy.child_restricted("comment", user_id)
        _wf = await word_filter_response(user_id, [text], "track_comment", child=_kids_child)
        if _wf is not None:
            return _wf

    if not text:
        return JSONResponse(status_code=400, content={"error": "댓글 내용을 입력해주세요."})
    if len(text) > MAX_TRACK_COMMENT_LEN:
        return JSONResponse(status_code=400, content={"error": f"댓글은 {MAX_TRACK_COMMENT_LEN:,}자 이하여야 합니다."})

    doc, err = await _get_track_or_404(mongo, track_id)
    if err:
        return err

    # 대댓글 부모 검증 — 같은 곡의 실존 댓글, 2단 이상은 부모의 부모로 평탄화(인스타 방식)
    parent_id = (body.parent_id or "").strip() or None
    reply_target_author_id = None
    if parent_id:
        if not ObjectId.is_valid(parent_id):
            return JSONResponse(status_code=400, content={"error": "답글 대상 댓글을 찾을 수 없습니다."})
        parent = await mongo.track_comments.find_one({"_id": ObjectId(parent_id), "track_id": track_id})
        if not parent:
            logger.warning("[track-comment] add parent_missing track=%s parent=%s", short, str(parent_id)[:8])
            return JSONResponse(status_code=400, content={"error": "답글 대상 댓글을 찾을 수 없습니다."})
        reply_target_author_id = parent.get("author_id")  # 평탄화 전 = 실제 답글 대상
        if parent.get("parent_id"):
            parent_id = parent["parent_id"]

    comment = {
        "track_id": track_id,
        "author_id": user_id,
        "author_nickname": current_user.get("nickname"),
        "text": text,
        "parent_id": parent_id,
        "created_at": datetime.utcnow(),
    }
    result = await mongo.track_comments.insert_one(comment)
    await mongo.tracks.update_one({"_id": doc["_id"]}, {"$inc": {"comment_count": 1}})

    # 알림 — 곡 주인에게 comment, 답글이면 부모 댓글 작성자에게 reply (target_type='track')
    await push_notification(
        mongo, user_id=doc.get("uploader_id"), ntype="comment",
        actor_id=user_id, actor_nickname=current_user.get("nickname"),
        target_id=track_id, preview=text, target_type="track",
    )
    if reply_target_author_id and str(reply_target_author_id) != str(doc.get("uploader_id")):
        await push_notification(
            mongo, user_id=reply_target_author_id, ntype="reply",
            actor_id=user_id, actor_nickname=current_user.get("nickname"),
            target_id=track_id, preview=text, target_type="track",
        )
    logger.info(
        "[track-comment] add ok track=%s user=%s comment=%s text_len=%d",
        short, str(user_id)[:8], str(result.inserted_id)[:8], len(text),
    )
    return {"comment": _serialize_track_comment(comment)}


@router.delete("/comments/{comment_id}")
async def delete_track_comment(comment_id: str, current_user=Depends(get_current_user)):
    """곡 댓글 삭제 — 댓글 작성자 또는 곡 주인만. comment_count -1(음수 가드)."""
    mongo = get_mongo()
    user_id = current_user["id"]
    short = str(comment_id)[:8]
    logger.info("[track-comment] delete enter comment=%s user=%s", short, str(user_id)[:8])

    if not ObjectId.is_valid(comment_id):
        return JSONResponse(status_code=404, content={"error": "댓글을 찾을 수 없습니다."})
    comment = await mongo.track_comments.find_one({"_id": ObjectId(comment_id)})
    if not comment:
        logger.info("[track-comment] delete not_found comment=%s", short)
        return JSONResponse(status_code=404, content={"error": "댓글을 찾을 수 없습니다."})

    track_id = comment.get("track_id")
    track = None
    if track_id and ObjectId.is_valid(track_id):
        track = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"uploader_id": 1})

    is_comment_author = comment.get("author_id") == user_id
    is_track_owner = bool(track) and track.get("uploader_id") == user_id
    if not (is_comment_author or is_track_owner):
        logger.info("[track-comment] delete forbidden comment=%s user=%s", short, str(user_id)[:8])
        return JSONResponse(status_code=403, content={"error": "댓글을 삭제할 권한이 없습니다."})

    # 최상위 댓글 삭제 시 하위 답글까지 함께 삭제(고아 방지 — count/UI 정합).
    # v3.179(검증픽스): 동시 삭제 경합 시 과차감 방지 — 실제 deleted_count 만큼만 차감.
    removed = 0
    if not comment.get("parent_id"):
        child_del = await mongo.track_comments.delete_many({"track_id": track_id, "parent_id": str(comment["_id"])})
        removed += child_del.deleted_count
    own_del = await mongo.track_comments.delete_one({"_id": comment["_id"]})
    removed += own_del.deleted_count
    if track and removed:
        # 음수 방지 — 남은 카운트만큼만 차감
        fresh = await mongo.tracks.find_one({"_id": track["_id"]}, {"comment_count": 1})
        cur = int((fresh or {}).get("comment_count") or 0)
        dec = min(removed, cur)
        if dec:
            await mongo.tracks.update_one({"_id": track["_id"]}, {"$inc": {"comment_count": -dec}})
    logger.info(
        "[track-comment] delete ok comment=%s track=%s removed=%d by=%s",
        short, str(track_id)[:8] if track_id else "?", removed,
        "author" if is_comment_author else "track_owner",
    )
    return {"message": "댓글이 삭제되었습니다."}


# ==================================================================
# v3.182 — 공유영상 보관함: 내 곡들의 캐시된 영상 목록 + object 직접 스트리밍
#   (스타일 suffix가 md5 해시라 파라미터 역산 불가 → object명 기반 재생 프록시 제공)
# ==================================================================
# v3.214: 캐시 v7 승격 — 구 v5/v6 객체도 보관함 재생·저장 하위호환 유지
# v3.215: 캐시 v8 승격(정적 사전 합성) — v[5678] 하위호환 (구 객체 자연 만료, 삭제 금지)
_SHARE_OBJ_RE = re.compile(r"^share/v[5678]/([a-f0-9]{24})[A-Za-z0-9_\-]*\.mp4$")


@router.get("/my/share-videos")
async def list_my_share_videos(current_user=Depends(get_current_user)):
    """내 곡들의 캐시된 공유영상 목록 (영상 디렉터 보관함)."""
    mongo = get_mongo()
    user_id = current_user["id"]
    logger.info("[share-video] library enter user=%s", str(user_id)[:8])
    docs = (
        await mongo.tracks.find({"uploader_id": user_id}, {"title": 1})
        .sort("created_at", -1).limit(50).to_list(length=50)
    )
    title_by_id = {str(d["_id"]): d.get("title") or "무제" for d in docs}
    minio_client = get_minio()

    def _scan():
        items = []
        for tid, title in title_by_id.items():
            # v3.215: v8 신규 경로 + 구 v6/v7 잔존 객체 병행 노출 (기존 보관함 유지)
            for pfx in (f"share/v6/{tid}", f"share/v7/{tid}", f"share/v8/{tid}"):
                try:
                    for obj in minio_client.list_objects(
                        bucket_name=settings.minio_bucket_music, prefix=pfx, recursive=True,
                    ):
                        name = obj.object_name
                        fmt = "wide" if "_wide" in name else "kakao" if "_kakao" in name else "sns"
                        items.append({
                            "track_id": tid, "title": title, "object_name": name,
                            "format": fmt, "size": obj.size,
                            "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
                        })
                except Exception:
                    logger.warning("[share-video] library scan failed track=%s", tid[:8])
        return items

    items = await asyncio.to_thread(_scan)
    items.sort(key=lambda x: x.get("last_modified") or "", reverse=True)
    logger.info("[share-video] library ok user=%s items=%d", str(user_id)[:8], len(items))
    return {"items": items}



async def _stream_video_with_range(request: Request, object_name: str, filename: str, download: bool):
    """v3.269 [피드백2-28b] — 공유영상 프록시 공용: Range(206)+inline 재생.

    기존 두 라우트는 attachment 고정 + Range 미지원이라 iOS 사파리가 인앱 재생을
    포기(검은 화면 — 실사고 캡처). stream_proxy(v193/v3.258) 패턴 그대로:
    stat/get은 to_thread, Range 파싱 → 206 partial, 기본 inline(재생),
    ?download=1 이면 attachment(저장 흐름 — 웹은 Blob이라 어느 쪽이든 무해).
    """
    minio_client = get_minio()
    disposition = ("attachment" if download else "inline") + f'; filename="{filename}"'
    stat = await asyncio.to_thread(
        minio_client.stat_object, settings.minio_bucket_music, object_name
    )
    total = stat.size
    range_header = (request.headers.get("range") or "").strip()
    if range_header.startswith("bytes="):
        try:
            spec = range_header[6:].split(",")[0].strip()
            start_s, _, end_s = spec.partition("-")
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            end = min(end, total - 1)
            if start > end or start >= total:
                return JSONResponse(status_code=416, content={"error": "요청 범위가 올바르지 않습니다."},
                                    headers={"Content-Range": f"bytes */{total}"})
            length = end - start + 1
            response = await asyncio.to_thread(
                minio_client.get_object,
                bucket_name=settings.minio_bucket_music,
                object_name=object_name, offset=start, length=length,
            )
            logger.info("[share-video] range %d-%d/%d obj=%s", start, end, total, object_name[-24:])
            return StreamingResponse(
                _stream_minio_body(response), status_code=206, media_type="video/mp4",
                headers={"Accept-Ranges": "bytes",
                         "Content-Range": f"bytes {start}-{end}/{total}",
                         "Content-Length": str(length),
                         "Content-Disposition": disposition},
            )
        except ValueError:
            logger.warning("[share-video] bad range header=%s", range_header[:40])
    response = await asyncio.to_thread(
        minio_client.get_object,
        bucket_name=settings.minio_bucket_music, object_name=object_name,
    )
    return StreamingResponse(
        _stream_minio_body(response), media_type="video/mp4",
        headers={"Accept-Ranges": "bytes", "Content-Length": str(total),
                 "Content-Disposition": disposition},
    )


@router.get("/share-video/object/{object_name:path}")
async def get_share_video_by_object(object_name: str, request: Request, download: int = Query(0)):
    """보관함 재생/저장용 — 검증된 share object 스트리밍 (공개 곡만, 무인증). v3.269: Range+inline."""
    m = _SHARE_OBJ_RE.match(object_name or "")
    if not m:
        return JSONResponse(status_code=404, content={"error": "영상을 찾을 수 없습니다."})
    track_id = m.group(1)
    mongo = get_mongo()
    doc = await mongo.tracks.find_one({"_id": ObjectId(track_id)}, {"is_public": 1})
    if not doc or not doc.get("is_public", True):
        return JSONResponse(status_code=404, content={"error": "영상을 찾을 수 없습니다."})
    try:
        return await _stream_video_with_range(
            request, object_name, f"maidol_{track_id}.mp4", download=bool(download),
        )
    except Exception:
        return JSONResponse(status_code=404, content={"error": "영상을 찾을 수 없습니다."})


# ── v3.210 ③: AI 곡 "(Inst.)" 버전 생성 (sunoapi.org vocal-removal) ───────────

@router.get("/inst-audio/{job_id}/{token}")
async def inst_audio_redirect(job_id: str, token: str):
    """v3.214: Suno vocal-removal 용 원곡 오디오 짧은 URL — 토큰 검증 후 presigned 302.

    무인증(게이트웨이 fetch) — 대신 job 별 1회성 난수 토큰 + 2시간 유효로 보호.
    게이트웨이가 긴 presigned URL(IAM 세션 토큰)을 거부해 도입(실증 v3.214).
    """
    import hmac as _hmac
    from datetime import timedelta as _td

    from ..services.inst_service import public_presign as _presign

    mongo = get_mongo()
    try:
        job = await mongo.inst_jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        job = None
    if not job:
        return JSONResponse(status_code=404, content={"error": "not found"})
    saved = job.get("audio_token") or ""
    if not saved or not _hmac.compare_digest(str(saved), str(token)):
        logger.warning("[inst] audio redirect token mismatch job=%s", job_id[:8])
        return JSONResponse(status_code=403, content={"error": "forbidden"})
    created = job.get("created_at")
    if created and isinstance(created, datetime):
        _now = datetime.utcnow() if created.tzinfo is None else datetime.now(timezone.utc)
        if _now - created > _td(hours=2):
            return JSONResponse(status_code=410, content={"error": "expired"})
    audio_object = job.get("audio_object")
    if not audio_object:
        return JSONResponse(status_code=404, content={"error": "audio not found"})
    url = _presign(audio_object, bucket=settings.minio_bucket_music)
    if not url:
        return JSONResponse(status_code=502, content={"error": "presign failed"})
    logger.info("[inst] audio redirect ok job=%s", job_id[:8])
    return RedirectResponse(url, status_code=302)


@router.post("/{track_id}/instrumental", status_code=202)
async def create_instrumental_version(
    track_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """원곡(AI 생성 곡)에서 보컬을 제거한 "(Inst.)" 트랙을 생성·자동 발매한다.

    계약(PLAN v3.210 확정 스펙 ③ — 앱 조 공유):
    - 소유자 본인만 · ai_model=suno 한정 · 연주곡(보컬 없음)·이미 Inst. 인 곡 거부.
    - 신규 생성만 ⭐ 과금(POINT_COSTS["instrumental"]) — 실패·타임아웃 시 자동 환불.
    - 202 {job_id, status, status_url, cost} 반환 후 백그라운드 진행 —
      진행 상태는 GET /api/tracks/{track_id}/instrumental/status.
    - 이미 Inst. 존재: 409 {error, existing_track_id} / 진행 중: 409 {error, job_id}.
    - 완료 시 신규 트랙: 제목 "{원제} (Inst.)", 커버·아티스트 원곡 상속,
      is_public 원곡 동일, source_track_id 기록 (inst_service 참조).
    - v3.215 ④: 작곡(composer) 디렉터 쿨다운 공유 — 쿨다운 중 429(+Retry-After,
      과금·클레임 이전), 성공 완료 시 작곡 사다리 1곡 카운트(일반 곡 생성과 합산).
    """
    from ..services.inst_service import (
        MAX_SOURCE_AUDIO_SIZE,
        run_instrumental_generation_in_background,
    )
    from ..services.points_service import POINT_COSTS, spend_points

    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)},
        {"uploader_id": 1, "title": 1, "ai_model": 1, "audio_url": 1, "lyrics": 1,
         "generation_id": 1, "source_track_id": 1, "is_public": 1},
    )
    if not doc:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    # 원곡 소유자 본인만
    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    # AI 곡(suno) 한정 — 업로드곡·타 모델 곡 거부 (PLAN ③: ai_model suno 한정)
    if (doc.get("ai_model") or "").lower() != "suno":
        return JSONResponse(status_code=400, content={"error": "AI 생성 곡만 Inst. 버전을 만들 수 있습니다."})

    # 이미 Inst. 파생 트랙 자체이거나 제목이 (Inst.) 인 곡 거부
    if doc.get("source_track_id") or (doc.get("title") or "").rstrip().endswith("(Inst.)"):
        return JSONResponse(status_code=400, content={"error": "이미 Inst. 버전인 곡입니다."})

    if not doc.get("audio_url"):
        return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})

    # 연주곡(보컬 없음) 원곡 거부 — generation doc 의 instrumental 플래그 우선,
    # 폴백: AI 발매 관행상 보컬곡은 lyrics 저장 → 가사 없는 곡은 연주곡으로 간주.
    _is_instrumental_src = False
    _gen_id = doc.get("generation_id")
    if _gen_id and ObjectId.is_valid(str(_gen_id)):
        _gen = await mongo.generations.find_one(
            {"_id": ObjectId(str(_gen_id))}, {"vocal": 1, "suno_request_body": 1},
        )
        if _gen:
            _req = _gen.get("suno_request_body") or {}
            _is_instrumental_src = bool(
                _req.get("instrumental") or (_gen.get("vocal") or "").lower() == "instrumental"
            )
    if _is_instrumental_src or not (doc.get("lyrics") or "").strip():
        return JSONResponse(status_code=400, content={"error": "이미 보컬이 없는 연주곡입니다."})

    # 이미 Inst. 버전 존재 (완료본) — 409 + 기존 트랙 안내 (PLAN 스펙)
    _existing = await mongo.tracks.find_one({"source_track_id": track_id}, {"_id": 1, "title": 1})
    if _existing:
        return JSONResponse(status_code=409, content={
            "error": "이미 Inst. 버전이 있습니다.",
            "existing_track_id": str(_existing["_id"]),
        })

    # v3.215 ④ — Inst = 작곡(composer) 디렉터 쿨다운: inst_jobs 클레임/⭐ 차감 **이전**
    # 429(+Retry-After) — 게이트→과금 순서(v3.214 share-video ⑨ 관행). 성공 완료 시
    # 사다리 카운트는 inst_service._run_pipeline 의 on_generation_completed(composer) 훅.
    from .fatigue import fatigue_gate_response
    _fatigued = await fatigue_gate_response(current_user["id"], director="composer")
    if _fatigued:
        return _fatigued

    # 원곡 오디오 ≤20MB 확인 (sunoapi.org vocal-removal audioUrl 스펙)
    _audio_obj = doc["audio_url"]
    if not _audio_obj.startswith(("http://", "https://")):
        minio_client = get_minio()
        try:
            _stat = await asyncio.to_thread(
                lambda: minio_client.stat_object(settings.minio_bucket_music, _audio_obj)
            )
        except Exception:
            return JSONResponse(status_code=404, content={"error": "오디오 파일을 찾을 수 없습니다."})
        if _stat.size and _stat.size > MAX_SOURCE_AUDIO_SIZE:
            return JSONResponse(status_code=400, content={
                "error": "원곡 오디오가 20MB를 초과하여 Inst. 생성을 지원하지 않습니다.",
            })

    # v3.228 — 이 곡의 죽은 active job(재시작·상한 초과)을 먼저 실패+1회 환불로 정리
    # → 서버 재시작 뒤 "영원히 409" 잠김 해소. (곡별 claim 은 그대로 — 사용자별 차단 없음)
    _swept = await gj.sweep_inst_track(track_id)
    if _swept:
        gj.logger.info("[GenJobs] inst unlock track=%s swept=%d user=%s",
                       track_id, _swept, gj.u8(current_user["id"]))

    # 진행 중 중복 방지 락 — inst_jobs (track_id, active=True) upsert 원자 클레임.
    # upsert 미발생 = 이미 활성 job 존재 → 409 (best-effort: 유니크 인덱스 없는
    # 동시 요청 초미세 경합은 job 별 ref 환불로 안전).
    now = datetime.now(timezone.utc)
    job_oid = ObjectId()
    _claim = await mongo.inst_jobs.update_one(
        {"track_id": track_id, "active": True},
        {"$setOnInsert": {
            "_id": job_oid,
            "track_id": track_id,
            "user_id": current_user["id"],
            "status": "pending",
            "result_track_id": None,
            "error_message": None,
            "point_ref": None,
            "point_cost": None,
            "refunded": False,
            "created_at": now,
            "updated_at": now,
            # v3.228 — 작업 추적(가산): 죽은 작업 판정·회수·확인
            "boot_id": gj.BOOT_ID,
            "consume_tracked": True,
            "acked_at": None,
        }},
        upsert=True,
    )
    if not _claim.upserted_id:
        _active = await mongo.inst_jobs.find_one(
            {"track_id": track_id, "active": True}, {"_id": 1},
        )
        return JSONResponse(status_code=409, content={
            "error": "이미 Inst. 생성이 진행 중입니다.",
            "job_id": str(_active["_id"]) if _active else None,
        })
    job_id = str(job_oid)
    # (참고) upsert 는 필터의 등치 조건(track_id, active=True)을 신생 doc 에 그대로
    # 합성하므로 active 필드는 이미 True 로 저장돼 있다.

    # ⭐ 선차감 (share_video v247 관행 — 실패 시 배경 래퍼가 자동 환불).
    # ref 는 시도별 유일(job_id 포함) — spend_points 계약(동일일 재시도 충돌 방지).
    _cost = POINT_COSTS["instrumental"]
    _ref = f"instrumental:{track_id}:{job_id}"
    if not await spend_points(current_user["id"], "instrumental", _cost, _ref):
        await mongo.inst_jobs.update_one(
            {"_id": job_oid},
            {"$set": {"active": False, "status": "failed",
                      "error_message": "insufficient points", "updated_at": now}},
        )
        return JSONResponse(status_code=402, content={"error": "포인트가 부족합니다 (필요: {})".format(_cost)})
    logger.info("[inst] [star-econ] spend user=%s -%d ref=%s", current_user["id"][:8], _cost, _ref)
    await mongo.inst_jobs.update_one(
        {"_id": job_oid},
        {"$set": {"point_ref": _ref, "point_cost": _cost, "updated_at": now}},
    )

    logger.info(
        "[inst] enter track=%s job=%s user=%s title=%s public=%s",
        track_id, job_id, current_user["id"][:8], (doc.get("title") or "")[:40],
        bool(doc.get("is_public", True)),
    )
    background_tasks.add_task(run_instrumental_generation_in_background, job_id, track_id)

    return {
        "job_id": job_id,
        "status": "processing",
        "status_url": f"/api/tracks/{track_id}/instrumental/status",
        "cost": _cost,
    }


@router.get("/{track_id}/instrumental/status")
async def get_instrumental_status(
    track_id: str,
    current_user=Depends(get_current_user),
):
    """Inst. 생성 진행 상태 조회 (소유자 본인만).

    반환: {status: pending|processing|completed|failed, job_id, result_track_id,
           error, refunded, created_at, updated_at} — 최신 job 기준.
    완료된 Inst. 트랙이 있으면 job 이 없어도 completed 로 응답한다.
    """
    if not ObjectId.is_valid(track_id):
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})

    mongo = get_mongo()
    doc = await mongo.tracks.find_one(
        {"_id": ObjectId(track_id)}, {"uploader_id": 1},
    )
    if not doc:
        return JSONResponse(status_code=404, content={"error": "곡을 찾을 수 없습니다."})
    if doc.get("uploader_id") != current_user["id"]:
        return JSONResponse(status_code=403, content={"error": "접근 권한이 없습니다."})

    job = await mongo.inst_jobs.find_one(
        {"track_id": track_id}, sort=[("created_at", -1)],
    )
    # v3.228 — 죽은 작업이면 즉시 failed + 1회 환불로 확정(InstLoading 이 실패·환불 문구를 받음)
    job = await gj.sweep_doc("inst", job)
    if not job:
        _existing = await mongo.tracks.find_one(
            {"source_track_id": track_id}, {"_id": 1},
        )
        if _existing:
            return {"status": "completed", "job_id": None,
                    "result_track_id": str(_existing["_id"]), "error": None}
        return JSONResponse(status_code=404, content={"error": "Inst. 생성 이력이 없습니다."})

    def _iso(v):
        return v.isoformat() if isinstance(v, datetime) else v

    return {
        "status": job.get("status"),
        "job_id": str(job["_id"]),
        "result_track_id": job.get("result_track_id"),
        "error": job.get("error_message"),
        "refunded": bool(job.get("refunded", False)),
        "created_at": _iso(job.get("created_at")),
        "updated_at": _iso(job.get("updated_at")),
    }
