"""
MV job routes — POST/GET /api/mv/jobs
v2: 잡 생성 시 백그라운드로 가사 생성을 띄우고 즉시 반환한다.
v3: 가사 ready 잡에 음악 생성 트리거(POST /jobs/{id}/music)와
     오디오 스트리밍(GET /jobs/{id}/audio) 추가.
완료/실패 시 Mongo mv_jobs 문서를 업데이트한다.
"""

import asyncio
import io
import logging
import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..models.story import MusicSpec
from ..services.lyrics_generator import generate_wedding_lyrics
from ..services.suno_generator import generate_music_for_job
from ..services.suno_timestamp_service import get_suno_timestamps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mv")


class MVJobCreate(BaseModel):
    story_id: str
    music_spec: MusicSpec


class MVJobLyricsPatch(BaseModel):
    """v25 — 작성된 가사 (title / body) 부분 편집용 요청 모델.

    둘 다 Optional 이지만 둘 중 하나는 반드시 와야 한다 (model_validator 로 보증).
    문자열은 strip 후 길이 가드 (title 1~200, body 1~5000).
    """

    title: str | None = Field(default=None)
    body: str | None = Field(default=None)

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > 200:
            raise ValueError("title은 1~200자여야 합니다.")
        return s

    @field_validator("body")
    @classmethod
    def _validate_body(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > 5000:
            raise ValueError("body는 1~5000자여야 합니다.")
        return s

    @model_validator(mode="after")
    def _at_least_one(self) -> "MVJobLyricsPatch":
        if self.title is None and self.body is None:
            raise ValueError("title 또는 body 중 최소 하나는 입력해야 합니다.")
        return self


def _serialize_job(doc: dict) -> dict:
    admin_requested_at = doc.get("admin_requested_at")
    # v19 — variant 별 timestamps. dict("1": [...], "2": [...]).
    lyric_timestamps_variants = doc.get("lyric_timestamps_variants") or {}
    variants_count: dict[str, int] = {}
    if isinstance(lyric_timestamps_variants, dict):
        for k, v in lyric_timestamps_variants.items():
            if isinstance(v, list):
                variants_count[str(k)] = len(v)
    return {
        "job_id": str(doc["_id"]),
        "user_id": doc.get("user_id"),
        "story_id": doc.get("story_id"),
        "music_spec": doc.get("music_spec"),
        "status": doc.get("status", "queued"),
        "progress": doc.get("progress", 0),
        "lyrics": doc.get("lyrics"),
        "audio_object_name": doc.get("audio_object_name"),
        "audio_variants": doc.get("audio_variants") or [],
        "suno_task_id": doc.get("suno_task_id"),
        # v19 — 두 variant 의 audio_id (list). 회귀 호환 위해 단수 필드도 그대로.
        "suno_audio_ids": doc.get("suno_audio_ids") or [],
        # v17.0 — 라인별 timestamp (Phase 0 매핑 입력). 없으면 빈 배열.
        "lyric_timestamps": doc.get("lyric_timestamps") or [],
        "lyric_timestamps_status": doc.get("lyric_timestamps_status") or (
            "ready" if (doc.get("lyric_timestamps") or []) else "missing"
        ),
        # v19 — variant 별 segments 카운트 (실 본문은 무거우므로 카운트만 노출).
        "lyric_timestamps_variants_count": variants_count,
        # v22 — 가사 타임스탬프 토글 UI 용 본문 노출 (variant 별 segments dict).
        "lyric_timestamps_variants": lyric_timestamps_variants,
        "error_message": doc.get("error_message"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
        "updated_at": doc["updated_at"].isoformat() if doc.get("updated_at") else None,
        "admin_requested": bool(doc.get("admin_requested", False)),
        "admin_requested_at": admin_requested_at.isoformat()
        if isinstance(admin_requested_at, datetime)
        else admin_requested_at,
    }


async def _run_lyrics_generation(job_id: str) -> None:
    """
    Background task: load story → call generate_wedding_lyrics → update mv_jobs doc.
    실패 시 status="lyrics_failed" + error_message 기록.
    """
    mongo = get_mongo()
    try:
        job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            return  # 잡이 사라진 경우 (삭제 등) — 조용히 종료

        story_id = job.get("story_id")
        if not story_id:
            raise ValueError("job has no story_id")

        try:
            story_oid = ObjectId(story_id)
        except (InvalidId, TypeError) as e:
            raise ValueError(f"invalid story_id: {story_id}") from e

        story = await mongo.stories.find_one({"_id": story_oid})
        if not story:
            raise ValueError("story not found")

        music_spec = job.get("music_spec") or {}
        lyrics = await generate_wedding_lyrics(
            story=story,
            music=music_spec,
            model=music_spec.get("model"),
        )

        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "lyrics_ready",
                    "progress": 100,
                    "lyrics": lyrics,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
    except Exception as e:
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "lyrics_failed",
                    "error_message": str(e)[:500],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


@router.post("/jobs")
async def create_job(body: MVJobCreate, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": current_user["id"],
        "story_id": body.story_id,
        "music_spec": body.music_spec.model_dump(),
        "status": "generating_lyrics",
        "progress": 0,
        "lyrics": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await mongo.mv_jobs.insert_one(doc)
    job_id = str(result.inserted_id)

    # v36 — 작성중 draft 의 장소들을 이 잡으로 transfer (meta.mv_job_id 박음).
    # wizard 의 [새로 만들기] 가 draft 장소를 cleanup 하므로 이 시점의 user 의
    # mv_job_id 없는 장소들은 모두 "이 잡 만들기 위해 만든 장소" 로 간주.
    try:
        upd = await mongo.wedding_assets.update_many(
            {
                "user_id": current_user["id"],
                "type": "place",
                "$or": [
                    {"meta.mv_job_id": None},
                    {"meta.mv_job_id": {"$exists": False}},
                ],
            },
            {"$set": {"meta.mv_job_id": job_id, "updated_at": now}},
        )
        logger.info(
            "[MVRoute] /jobs transferred draft places user_id=%s job_id=%s matched=%d modified=%d",
            current_user["id"], job_id, upd.matched_count, upd.modified_count,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[MVRoute] /jobs place transfer failed user_id=%s job_id=%s err=%s",
            current_user["id"], job_id, str(e)[:200],
        )

    # background lyrics generation (fire-and-forget; FastAPI 요청 종료 후에도 살아남는다)
    asyncio.create_task(_run_lyrics_generation(job_id))

    return {"job_id": job_id, "status": "generating_lyrics"}


@router.get("/jobs")
async def list_jobs(current_user=Depends(get_current_user)):
    mongo = get_mongo()
    cursor = mongo.mv_jobs.find({"user_id": current_user["id"]}).sort("created_at", -1)
    jobs = [_serialize_job(d) async for d in cursor]
    return {"jobs": jobs}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user=Depends(get_current_user)):
    """v36 — 작품 삭제. 잡 도큐먼트 + 그 잡에 묶인 wedding_assets 도 cleanup.

    가드: owner. (admin 도 본인 잡만 삭제 가능 — 다른 사용자 잡 삭제 별도 API 필요 시 추후)
    """
    user_id = current_user["id"]
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] /jobs/delete invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")
    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] /jobs/delete not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=404, detail="작품을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] /jobs/delete forbidden user_id=%s job_id=%s owner=%s",
            user_id, job_id, doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    cur_status = doc.get("status") or ""
    if cur_status in ("queued", "generating_lyrics", "generating_music"):
        logger.warning(
            "[MVRoute] /jobs/delete busy user_id=%s job_id=%s status=%s",
            user_id, job_id, cur_status,
        )
        raise HTTPException(
            status_code=409,
            detail="진행 중인 작품은 삭제할 수 없어요. 잠시 후 다시 시도해주세요.",
        )
    # 1) 그 잡에 묶인 wedding_assets (place 등) cleanup
    try:
        place_del = await mongo.wedding_assets.delete_many(
            {"user_id": user_id, "meta.mv_job_id": job_id},
        )
        logger.info(
            "[MVRoute] /jobs/delete assets cleanup user_id=%s job_id=%s assets_deleted=%d",
            user_id, job_id, place_del.deleted_count,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[MVRoute] /jobs/delete assets cleanup failed user_id=%s job_id=%s err=%s",
            user_id, job_id, str(e)[:200],
        )
    # 2) 잡 도큐먼트 삭제
    try:
        await mongo.mv_jobs.delete_one({"_id": oid})
        logger.info(
            "[MVRoute] /jobs/delete ok user_id=%s job_id=%s",
            user_id, job_id,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "[MVRoute] /jobs/delete mongo delete failed user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=500, detail="작품 삭제에 실패했습니다.")
    return {"ok": True, "job_id": job_id}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    # v12.1 — admin role 은 다른 사용자의 job 디테일 조회 허용 (요청작 페이지에서 상세보기 진입).
    is_owner = doc.get("user_id") == current_user["id"]
    is_admin = current_user.get("role") == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return _serialize_job(doc)


def _serialize_wedding_photo_asset(d: dict) -> dict:
    """v13 — shape a wedding_assets (type=wedding_photo) doc for /context view."""
    obj = d.get("object_name") or ""
    created = d.get("created_at")
    return {
        "photo_id": str(d.get("_id")) if d.get("_id") is not None else None,
        "object_name": obj or None,
        "preview_url": ("/api/character/preview/" + obj) if obj else None,
        "meta": d.get("meta") or {},
        "created_at": created.isoformat() if isinstance(created, datetime) else created,
    }


@router.get("/jobs/{job_id}/context")
async def get_job_context(job_id: str, current_user=Depends(get_current_user)):
    """v13 — 웨딩사진 패널용 컨텍스트.

    작품 소유자의 시트 4슬롯 + 장소 자산 + 이 작품에 등록된 웨딩사진 자산을
    한 번에 반환한다. 멘션 옵션 풀 빌드와 갤러리 초기 로딩에 쓰인다.
    가드: owner OR admin.
    """
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    logger.info(
        "[MVRoute] /context entry user_id=%s is_admin=%s job_id=%s",
        user_id, is_admin, job_id,
    )
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] /context invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")
    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": oid})
    if not job:
        logger.warning(
            "[MVRoute] /context not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    is_owner = job.get("user_id") == user_id
    if not is_owner and not is_admin:
        logger.warning(
            "[MVRoute] /context forbidden user_id=%s job_id=%s owner=%s",
            user_id, job_id, job.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    owner_user_id = job.get("user_id")

    # 시트 4슬롯 (없는 슬롯은 skip).
    cs_doc = await mongo.wedding_character_sheets.find_one(
        {"user_id": owner_user_id}
    )
    owner_sheets: list[dict] = []
    for slot in ("groom_casual", "groom_wedding", "bride_casual", "bride_wedding"):
        sd = ((cs_doc or {}).get("sheets") or {}).get(slot)
        if not sd:
            continue
        owner_sheets.append({
            "slot": slot,
            "display_name": (sd.get("display_name") or "").strip() or slot,
            "sheet_object_name": sd.get("sheet_object_name") or "",
        })

    # 장소 자산.
    owner_places: list[dict] = []
    async for d in mongo.wedding_assets.find({
        "user_id": owner_user_id, "type": "place",
    }).sort("created_at", -1):
        owner_places.append({
            "place_id": str(d.get("_id")) if d.get("_id") is not None else None,
            "display_name": d.get("display_name") or "",
            "memo": (d.get("meta") or {}).get("memo") or "",
            "object_name": d.get("object_name") or "",
        })

    # 이 mv_job 의 웨딩사진 자산.
    photos: list[dict] = []
    async for d in mongo.wedding_assets.find({
        "user_id": owner_user_id,
        "type": "wedding_photo",
        "meta.mv_job_id": job_id,
    }).sort("created_at", -1):
        photos.append(_serialize_wedding_photo_asset(d))

    # v26 — 식전영상 씬 이미지를 추가영상생성 탭의 @멘션 풀에 노출.
    # pre_mv_jobs (mv_job_id 로 1:1 연결) 의 scenes 중 image_object_name 이 채워진
    # 씬들만 토큰화. 토큰 = `{story_slot}_{seq_in_slot}` (seq_in_slot = 같은 slot
    # 안 scene_number 오름차순 1-base 순번).
    pre_mv_scenes: list[dict] = []
    try:
        pre_doc = await mongo.pre_mv_jobs.find_one({"mv_job_id": job_id})
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[MVRoute] /context pre_mv_jobs lookup failed job_id=%s err=%s",
            job_id, str(e)[:200],
        )
        pre_doc = None
    if pre_doc:
        scenes_raw = pre_doc.get("scenes") or []
        # story_slot 별로 묶어 scene_number 오름차순 정렬.
        per_slot: dict[str, list[dict]] = {}
        for s in scenes_raw:
            if not isinstance(s, dict):
                continue
            obj = (s.get("image_object_name") or "").strip()
            if not obj:
                continue
            slot = (s.get("story_slot") or "").strip()
            if not slot:
                continue
            per_slot.setdefault(slot, []).append(s)
        for slot, lst in per_slot.items():
            lst.sort(key=lambda x: int(x.get("scene_number") or 0))
            for seq_in_slot, s in enumerate(lst, start=1):
                token = "{}_{}".format(slot, seq_in_slot)
                pre_mv_scenes.append({
                    "token": token,
                    "label": token,
                    "story_slot": slot,
                    "seq_in_slot": seq_in_slot,
                    "scene_number": int(s.get("scene_number") or 0),
                    "object_name": s.get("image_object_name") or "",
                })
        # 보기 좋게 story_slot 순서 → seq_in_slot 순서로 정렬.
        pre_mv_scenes.sort(key=lambda r: (r["story_slot"], r["seq_in_slot"]))

    logger.info(
        "[MVRoute] /context ok user_id=%s is_admin=%s job_id=%s owner_user_id=%s "
        "sheets=%d places=%d photos=%d pre_mv_scenes=%d",
        user_id, is_admin, job_id, owner_user_id,
        len(owner_sheets), len(owner_places), len(photos), len(pre_mv_scenes),
    )
    return {
        "owner_user_id": owner_user_id,
        "owner_sheets": owner_sheets,
        "owner_places": owner_places,
        "wedding_photos": photos,
        "pre_mv_scenes": pre_mv_scenes,
    }


async def _run_music_generation(job_id: str) -> None:
    """
    Background task: load job → call generate_music_for_job → update mv_jobs doc.
    실패 시 status="music_failed" + error_message 기록.
    """
    mongo = get_mongo()
    try:
        job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            return  # 잡이 사라진 경우 (삭제 등) — 조용히 종료
        lyrics = job.get("lyrics") or {}
        lyrics_body = lyrics.get("body") or ""
        lyrics_title = lyrics.get("title")
        music_spec = job.get("music_spec") or {}
        if not lyrics_body.strip():
            raise ValueError("lyrics body is empty — cannot generate music")

        result = await generate_music_for_job(
            job_id=job_id,
            lyrics_body=lyrics_body,
            lyrics_title=lyrics_title,
            music_spec=music_spec,
            mongo_db=mongo,
        )

        # v19 — Suno timestamped-lyrics best-effort fetch (두 variant 다).
        # 실패해도 음악 자체는 ready 로 처리(timestamps 없으면 Phase 0 만 차단).
        suno_task_id = result.get("suno_task_id") or ""
        suno_audio_id = result.get("suno_audio_id") or ""
        suno_audio_ids: list[str] = list(result.get("suno_audio_ids") or [])
        # 회귀 안전망 — 단수만 있고 list 가 비었으면 list 로 승격.
        if not suno_audio_ids and suno_audio_id:
            suno_audio_ids = [suno_audio_id]

        # v21.1 — get_suno_timestamps 가 dict 반환 ({"segments": [...], "aligned_words": [...]}).
        # segments 는 기존대로 lyric_timestamps_variants 에, raw aligned_words 는
        # suno_aligned_words_variants 에 저장한다.
        ts_by_variant_segments: dict[str, list[dict]] = {}
        ts_by_variant_words: dict[str, list[dict]] = {}
        for idx, aid in enumerate(suno_audio_ids, start=1):
            if not aid:
                continue
            try:
                logger.info(
                    "[MVRoute] action=fetch_timestamps entry job_id=%s variant=%d "
                    "suno_task_id=%s suno_audio_id=%s",
                    job_id, idx, suno_task_id, aid,
                )
                ts = await get_suno_timestamps(suno_task_id, aid)
                # 안전망: 구버전 호환 — 만약 dict 가 아니면 빈 dict 처리.
                if not isinstance(ts, dict):
                    ts = {"segments": [], "aligned_words": []}
                seg_list = ts.get("segments") or []
                words_list = ts.get("aligned_words") or []
                if seg_list:
                    ts_by_variant_segments[str(idx)] = seg_list
                if words_list:
                    ts_by_variant_words[str(idx)] = words_list
                logger.info(
                    "[MVRoute] timestamps backfill mv_job=%s variant=%d segments=%d aligned_words=%d",
                    job_id, idx, len(seg_list), len(words_list),
                )
            except Exception as ts_err:
                # get_suno_timestamps 는 자체적으로 빈 dict 를 반환하지만, 만일의 경우 보호.
                logger.exception(
                    "[MVRoute] action=fetch_timestamps failed job_id=%s variant=%d "
                    "err=%s: %s",
                    job_id, idx, type(ts_err).__name__, str(ts_err)[:200],
                )

        timestamps_status = "ready" if ts_by_variant_segments else "missing"

        update_doc: dict = {
            "status": "music_ready",
            "progress": 100,
            "audio_object_name": result["audio_object_name"],
            "audio_variants": result["audio_variants"],
            "suno_task_id": result["suno_task_id"],
            "suno_audio_id": result["suno_audio_id"],
            "suno_audio_ids": suno_audio_ids,
            "lyric_timestamps_variants": ts_by_variant_segments,
            "suno_aligned_words_variants": ts_by_variant_words,  # v21.1 신규
            "lyric_timestamps_status": timestamps_status,
            "updated_at": datetime.now(timezone.utc),
        }
        # 회귀 호환: 기존 lyric_timestamps 단수 필드 = variant 1 segments (있으면).
        if ts_by_variant_segments.get("1"):
            update_doc["lyric_timestamps"] = ts_by_variant_segments["1"]
        else:
            update_doc["lyric_timestamps"] = []

        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": update_doc},
        )
    except Exception as e:
        await mongo.mv_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {
                "$set": {
                    "status": "music_failed",
                    "error_message": str(e)[:500],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )


@router.post("/jobs/{job_id}/regenerate")
async def regenerate_job(
    job_id: str,
    body: MVJobCreate,
    current_user=Depends(get_current_user),
):
    """v35 — 같은 job 안에서 lyrics/music 갈아엎기 (사용자가 wizard 에서 수정 후
    다시 생성하는 흐름).

    Body: `{story_id, music_spec}` — 새로 만든 story_id 와 갱신된 music_spec.
    동작: 기존 lyrics / audio_variants / progress / error_message 를 초기화하고
    `status="generating_lyrics"` 로 갱신 + 백그라운드 가사 재생성 시작.
    가드: owner 검증. 진행 중(`generating_*`) 일 땐 409.
    """
    mongo = get_mongo()
    user_id = current_user["id"]
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] /regenerate invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")
    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] /regenerate not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] /regenerate forbidden user_id=%s job_id=%s owner=%s",
            user_id, job_id, doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    cur_status = doc.get("status") or ""
    if cur_status in ("queued", "generating_lyrics", "generating_music"):
        logger.warning(
            "[MVRoute] /regenerate busy user_id=%s job_id=%s status=%s",
            user_id, job_id, cur_status,
        )
        raise HTTPException(
            status_code=409,
            detail="진행 중인 잡은 다시 생성할 수 없어요. 잠시 후 시도해주세요.",
        )

    now = datetime.now(timezone.utc)
    logger.info(
        "[MVRoute] /regenerate entry user_id=%s job_id=%s new_story_id=%s prev_status=%s",
        user_id, job_id, body.story_id, cur_status,
    )
    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {
            "$set": {
                "story_id": body.story_id,
                "music_spec": body.music_spec.model_dump(),
                "status": "generating_lyrics",
                "progress": 0,
                "lyrics": None,
                "audio_variants": [],
                "error_message": None,
                "updated_at": now,
            }
        },
    )
    asyncio.create_task(_run_lyrics_generation(job_id))
    logger.info(
        "[MVRoute] /regenerate ok user_id=%s job_id=%s status=generating_lyrics",
        user_id, job_id,
    )
    return {"job_id": job_id, "status": "generating_lyrics"}


@router.patch("/jobs/{job_id}/lyrics")
async def patch_job_lyrics(
    job_id: str,
    body: MVJobLyricsPatch,
    current_user=Depends(get_current_user),
):
    """v25 — 생성된 가사 (title / body) 를 사용자가 직접 편집.

    title 만 / body 만 / 둘 다 부분 업데이트 지원. body 가 바뀐 경우
    `lyric_timestamps_status='stale'` 로 마킹하여 Phase 0 재매핑이 필요함을 표시.
    가드: ObjectId 형식 / 잡 존재 / owner / 진행 중 아님.
    """
    user_id = current_user["id"]
    has_title = body.title is not None
    has_body = body.body is not None
    logger.info(
        "[MVRoute] /lyrics-patch entry job_id=%s has_title=%s has_body=%s",
        job_id, has_title, has_body,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] /lyrics-patch invalid job_id user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=400, detail="잘못된 job_id 형식")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] /lyrics-patch not found user_id=%s job_id=%s",
            user_id, job_id,
        )
        raise HTTPException(status_code=404, detail="작품을 찾을 수 없습니다")

    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] /lyrics-patch forbidden job_id=%s user_id=%s",
            job_id, user_id,
        )
        raise HTTPException(status_code=403, detail="권한이 없습니다")

    cur_status = doc.get("status") or ""
    if cur_status in ("queued", "generating_lyrics", "generating_music"):
        logger.warning(
            "[MVRoute] /lyrics-patch busy job_id=%s status=%s",
            job_id, cur_status,
        )
        raise HTTPException(
            status_code=409,
            detail="진행 중인 작품은 수정할 수 없습니다",
        )

    # 기존 lyrics dict 부분 업데이트.
    prev_lyrics = doc.get("lyrics") or {}
    if not isinstance(prev_lyrics, dict):
        prev_lyrics = {}
    new_lyrics = dict(prev_lyrics)
    if has_title:
        new_lyrics["title"] = body.title
    if has_body:
        new_lyrics["body"] = body.body

    now = datetime.now(timezone.utc)
    set_doc: dict = {
        "lyrics": new_lyrics,
        "updated_at": now,
    }
    # body 가 실제로 바뀐 경우 timestamps stale 마킹.
    prev_body = prev_lyrics.get("body") if isinstance(prev_lyrics, dict) else None
    if has_body and body.body != prev_body:
        set_doc["lyric_timestamps_status"] = "stale"

    await mongo.mv_jobs.update_one({"_id": oid}, {"$set": set_doc})
    updated = await mongo.mv_jobs.find_one({"_id": oid})
    logger.info("[MVRoute] /lyrics-patch ok job_id=%s", job_id)
    return _serialize_job(updated)


@router.post("/jobs/{job_id}/music")
async def start_music_generation(job_id: str, current_user=Depends(get_current_user)):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    if doc.get("status") != "lyrics_ready":
        raise HTTPException(
            status_code=409,
            detail="가사 생성이 끝난 잡에서만 음악을 만들 수 있습니다.",
        )

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "generating_music",
                "progress": 0,
                "error_message": None,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    asyncio.create_task(_run_music_generation(job_id))

    return {"job_id": job_id, "status": "generating_music"}


# v27 — 음악만 재생성. 가사는 그대로 두고 Suno 호출만 다시 실행.
# 기존 audio_variants / suno_audio_ids / lyric_timestamps_variants 모두 초기화.
@router.post("/jobs/{job_id}/music/regenerate")
async def regenerate_music(job_id: str, current_user=Depends(get_current_user)):
    user_id = current_user.get("id")
    logger.info(
        "[MVRoute] /music-regenerate entry user_id=%s job_id=%s",
        user_id,
        job_id,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] /music-regenerate forbidden user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    status = doc.get("status")
    if status not in ("music_ready", "music_failed"):
        logger.info(
            "[MVRoute] /music-regenerate busy job_id=%s status=%s",
            job_id,
            status,
        )
        raise HTTPException(
            status_code=409,
            detail="음악이 준비된 후에만 재생성할 수 있습니다.",
        )

    if not (doc.get("lyrics") or {}).get("body"):
        raise HTTPException(
            status_code=409,
            detail="가사가 없어 음악을 재생성할 수 없습니다.",
        )

    await mongo.mv_jobs.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "generating_music",
                "progress": 0,
                "error_message": None,
                "audio_object_name": None,
                "audio_variants": [],
                "suno_task_id": None,
                "suno_audio_id": "",
                "suno_audio_ids": [],
                "lyric_timestamps_variants": {},
                "lyric_timestamps_status": "stale",
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    asyncio.create_task(_run_music_generation(job_id))

    logger.info("[MVRoute] /music-regenerate ok job_id=%s", job_id)
    return {"job_id": job_id, "status": "generating_music"}


@router.get("/jobs/{job_id}/audio")
async def get_job_audio(
    job_id: str,
    variant: int = 1,
    download: int = 0,
    current_user=Depends(get_current_user),
):
    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    # v12.1 — admin role 은 다른 사용자 작품의 오디오 재생 허용 (요청작 페이지 재생).
    is_owner = doc.get("user_id") == current_user["id"]
    is_admin = current_user.get("role") == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    variants = doc.get("audio_variants") or []
    if not variants:
        raise HTTPException(status_code=404, detail="아직 음악이 준비되지 않았습니다.")
    idx = max(1, int(variant)) - 1
    if idx >= len(variants):
        raise HTTPException(status_code=404, detail=f"variant {variant} 가 없습니다.")
    object_name = variants[idx]

    minio_client = get_minio()
    try:
        stream = minio_client.get_object(settings.minio_bucket_audio, object_name)
        data = stream.read()
        stream.close()
        stream.release_conn()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"오디오 로드 실패: {e}")

    # v43 — download=1 일 때 attachment 헤더로 강제 다운로드 (cross-origin 도 동작).
    headers: dict[str, str] = {}
    if int(download or 0):
        lyrics_title = ((doc.get("lyrics") or {}).get("title") or "").strip()
        # ASCII-only safe filename (RFC 6266 의 filename= 단순 형태).
        ascii_safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", lyrics_title)[:60].strip("_")
        base = ascii_safe or "wedding_mv_audio"
        safe_name = f"{base}_v{variant}.mp3"
        headers["Content-Disposition"] = f'attachment; filename="{safe_name}"'

    return StreamingResponse(
        io.BytesIO(data), media_type="audio/mpeg", headers=headers,
    )


@router.post("/jobs/{job_id}/request-admin")
async def request_admin_review(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v12: 사용자가 자기 작품을 관리자 검토 목록에 올린다 (멱등)."""
    user_id = current_user.get("id")
    logger.info(
        "[MVRoute] POST /jobs/{job_id}/request-admin entry user_id=%s job_id=%s action=request_admin",
        user_id,
        job_id,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] request_admin reject invalid job_id user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] request_admin reject not_found user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] request_admin reject forbidden user_id=%s job_id=%s owner=%s",
            user_id,
            job_id,
            doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    now = datetime.now(timezone.utc)
    try:
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "admin_requested": True,
                    "admin_requested_at": now,
                    "updated_at": now,
                }
            },
        )
    except Exception as e:
        logger.error(
            "[MVRoute] request_admin update failed user_id=%s job_id=%s: %s: %s",
            user_id,
            job_id,
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="관리자 요청에 실패했습니다.")

    updated = await mongo.mv_jobs.find_one({"_id": oid})
    logger.info(
        "[MVRoute] POST /jobs/{job_id}/request-admin ok user_id=%s job_id=%s action=request_admin",
        user_id,
        job_id,
    )
    return _serialize_job(updated)


@router.delete("/jobs/{job_id}/request-admin")
async def cancel_admin_review(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """v12: 사용자가 관리자 검토 요청을 취소한다 (멱등)."""
    user_id = current_user.get("id")
    logger.info(
        "[MVRoute] DELETE /jobs/{job_id}/request-admin entry user_id=%s job_id=%s action=cancel_admin",
        user_id,
        job_id,
    )

    mongo = get_mongo()
    try:
        oid = ObjectId(job_id)
    except (InvalidId, TypeError):
        logger.warning(
            "[MVRoute] cancel_admin reject invalid job_id user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=400, detail="유효하지 않은 job_id 입니다.")

    doc = await mongo.mv_jobs.find_one({"_id": oid})
    if not doc:
        logger.warning(
            "[MVRoute] cancel_admin reject not_found user_id=%s job_id=%s",
            user_id,
            job_id,
        )
        raise HTTPException(status_code=404, detail="잡을 찾을 수 없습니다.")
    if doc.get("user_id") != user_id:
        logger.warning(
            "[MVRoute] cancel_admin reject forbidden user_id=%s job_id=%s owner=%s",
            user_id,
            job_id,
            doc.get("user_id"),
        )
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    now = datetime.now(timezone.utc)
    try:
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {
                "$set": {
                    "admin_requested": False,
                    "updated_at": now,
                },
                "$unset": {
                    "admin_requested_at": "",
                },
            },
        )
    except Exception as e:
        logger.error(
            "[MVRoute] cancel_admin update failed user_id=%s job_id=%s: %s: %s",
            user_id,
            job_id,
            type(e).__name__,
            str(e)[:200],
        )
        raise HTTPException(status_code=500, detail="관리자 요청 취소에 실패했습니다.")

    updated = await mongo.mv_jobs.find_one({"_id": oid})
    logger.info(
        "[MVRoute] DELETE /jobs/{job_id}/request-admin ok user_id=%s job_id=%s action=cancel_admin",
        user_id,
        job_id,
    )
    return _serialize_job(updated)
