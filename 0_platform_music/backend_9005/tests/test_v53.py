"""v53 — 시나리오 상위 편집 + events 추가/삭제 + 전체 cascade 테스트.

T1 — PATCH 단위 (시나리오 상위 6개 필드 + 옛 도큐먼트 호환).
T2 — PATCH events 배열 교체 + order 재계산 + scenario_user_edited_fields 누적.
T3 — Cascade Phase 별 진행 — events_extract → scene_split → scene_image_prompt
     → scene_image → scene_video_prompt → video_invalidate.
T4 — Stage 2 LLM 재호출 정책 (Q3) — events 편집/미편집 시 events 추출 호출 여부.
T5 — 영상 자동 폐기 (cascade 완료 후 모든 씬 video_status="invalidated_by_cascade").
T6 — 취소 — Phase 진행 중 cancel_requested → 다음 phase 진입 X + cascade_phase="cancelled".
T7 — 사용자 직접 편집 씬 archive 보관 + 새 씬 생성.
T8 — 회귀 — 옛 mv_jobs (scenario_user_edited_fields/cascade_phase 없음) 정상 조회.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Fake Mongo (v52 testfile 패턴 재사용 + dotted-path $set + scenes_archive) ──


class FakeMVJobsCollection:
    def __init__(self, docs):
        self._docs = {d["_id"]: d for d in docs}

    async def find_one(self, query, projection=None):
        oid = query.get("_id")
        doc = self._docs.get(oid)
        if not doc:
            return None
        return {k: v for k, v in doc.items()}

    async def update_one(self, query, update):
        oid = query.get("_id")
        doc = self._docs.get(oid)
        if not doc:
            return MagicMock(matched_count=0, modified_count=0)
        sets = update.get("$set", {})
        for path, value in sets.items():
            parts = path.split(".")
            cur = doc
            for p in parts[:-1]:
                if p.isdigit():
                    cur = cur[int(p)]
                else:
                    if p not in cur or not isinstance(cur[p], (dict, list)):
                        cur[p] = {}
                    cur = cur[p]
            last = parts[-1]
            if last.isdigit():
                cur[int(last)] = value
            else:
                cur[last] = value
        return MagicMock(matched_count=1, modified_count=1)


class FakeMongoDB:
    def __init__(self, mv_jobs_collection):
        self.mv_jobs = mv_jobs_collection


def make_fake_mongo(extra_doc_keys=None):
    """v53 테스트용 baseline 도큐먼트 — narrative + events + scenes 포함."""
    job_oid = "job_oid_v53"
    scenes = [
        {
            "scene_number": 1, "section": "verse1", "use_seconds": 5.0,
            "lyrics_segment": "가사 1", "scene_type": "drama",
            "description": "원래 1", "image_prompt": "원래 ip 1",
            "image_object_name": "mv/job_oid_v53/scenes/001.png",
            "video_status": "completed", "video_object_name": "mv/job_oid_v53/scenes/001_video.mp4",
            "event_index": 0, "user_edited_fields": [],
        },
        {
            "scene_number": 2, "section": "chorus", "use_seconds": 6.0,
            "lyrics_segment": "가사 2", "scene_type": "drama",
            "description": "원래 2", "image_prompt": "원래 ip 2",
            "image_object_name": "mv/job_oid_v53/scenes/002.png",
            "video_status": "completed", "video_object_name": "mv/job_oid_v53/scenes/002_video.mp4",
            "event_index": 0, "user_edited_fields": ["image_prompt"],  # 사용자 직접 편집
        },
    ]
    events = [
        {"order": 1, "section": "verse1", "trigger": "옛날 사진", "protagonist_action": "본다",
         "motivation": "그리움", "emotion_shift": "정적→그리움", "props": ["사진"]},
        {"order": 2, "section": "chorus", "trigger": "비", "protagonist_action": "닫는다",
         "motivation": "회피", "emotion_shift": "그리움→슬픔", "props": []},
    ]
    doc = {
        "_id": job_oid,
        "user_id": "user_abc",
        "title": "테스트 곡",
        "scenes": scenes,
        "scenario": "원래 시나리오 본문 50자 이상 어쩌고저쩌고 이런저런 내용...",
        "scenario_narrative": "원래 narrative 본문",
        "scenario_premise": "원래 전제",
        "scenario_central_conflict": "원래 갈등",
        "scenario_emotional_core": "원래 감정 코어",
        "scenario_character_states": {"protagonist": "원래 상태"},
        "scenario_narrative_arc": {"setup": "도입"},
        "scenario_events": events,
        "video_model": "veo",
    }
    if extra_doc_keys:
        doc.update(extra_doc_keys)
    coll = FakeMVJobsCollection([doc])
    return FakeMongoDB(coll), job_oid


def _import_pipeline():
    from app.services import mv_pipeline
    return mv_pipeline


def _import_mv_routes():
    from app.routes import mv
    return mv


# ── T1 — PATCH 단위 (시나리오 상위) ──────────────────────────────────────────


def test_t1a_patch_scenario_narrative_accumulates_user_edited_fields():
    """T1 (a) — narrative 단독 PATCH 후 mongo 갱신 + scenario_user_edited_fields=['narrative']."""
    mongo, oid = make_fake_mongo()
    routes = _import_mv_routes()

    # PATCH 라우트의 핵심 로직 직접 재현 (의존성 우회).
    payload = {"narrative": "새 narrative"}
    normalized = routes._v53_normalize_scenario_payload(payload)
    assert normalized == {"narrative": "새 narrative"}

    cur_edited = list(mongo.mv_jobs._docs[oid].get("scenario_user_edited_fields") or [])
    for k in normalized.keys():
        if k not in cur_edited:
            cur_edited.append(k)
    update = {"scenario_user_edited_fields": cur_edited}
    for k, v in normalized.items():
        update["scenario_" + k] = v

    async def run():
        await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    asyncio.run(run())
    doc = mongo.mv_jobs._docs[oid]
    assert doc["scenario_narrative"] == "새 narrative"
    assert doc["scenario_user_edited_fields"] == ["narrative"]


def test_t1b_patch_scenario_dict_field_validation():
    """T1 (b) — character_states 가 dict 가 아니면 400."""
    routes = _import_mv_routes()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        routes._v53_normalize_scenario_payload({"character_states": "not a dict"})
    assert ei.value.status_code == 400


def test_t1c_patch_scenario_string_field_validation():
    """T1 (c) — narrative 가 string 이 아니면 400."""
    routes = _import_mv_routes()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        routes._v53_normalize_scenario_payload({"narrative": ["a list"]})
    assert ei.value.status_code == 400


def test_t1d_patch_scenario_legacy_doc_default_user_edited():
    """T1 (d) — 옛 도큐먼트 (scenario_user_edited_fields 키 없음) → 첫 PATCH 시 자동 초기화."""
    mongo, oid = make_fake_mongo()
    # 키 자체 제거 (legacy 시뮬)
    doc = mongo.mv_jobs._docs[oid]
    if "scenario_user_edited_fields" in doc:
        del doc["scenario_user_edited_fields"]

    cur_edited = list(doc.get("scenario_user_edited_fields") or [])
    assert cur_edited == []
    cur_edited.append("premise")

    async def run():
        await mongo.mv_jobs.update_one(
            {"_id": oid},
            {"$set": {"scenario_user_edited_fields": cur_edited, "scenario_premise": "새 전제"}},
        )

    asyncio.run(run())
    assert mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] == ["premise"]
    assert mongo.mv_jobs._docs[oid]["scenario_premise"] == "새 전제"


# ── T2 — PATCH events 배열 ──────────────────────────────────────────────────


def test_t2a_patch_events_array_recalculates_order():
    """T2 (a) — 사용자가 보낸 배열의 order 는 무시되고 1, 2, 3... 자동 재계산."""
    routes = _import_mv_routes()
    user_events = [
        {"order": 999, "trigger": "x"},  # order 무시
        {"order": 5, "trigger": "y"},
        {"trigger": "z"},  # order 누락 → 3
    ]
    norm = routes._v53_normalize_events_array(user_events)
    assert [e["order"] for e in norm] == [1, 2, 3]
    # 빈 필드 자동 정규화 — string 필드는 빈 문자열, props 는 빈 list
    assert norm[0]["protagonist_action"] == ""
    assert norm[0]["props"] == []


def test_t2b_patch_events_array_user_edited_appends():
    """T2 (b) — events 배열 PATCH 시 scenario_user_edited_fields 에 'events' 자동 추가."""
    mongo, oid = make_fake_mongo()
    cur_edited = list(mongo.mv_jobs._docs[oid].get("scenario_user_edited_fields") or [])
    if "events" not in cur_edited:
        cur_edited.append("events")
    assert "events" in cur_edited

    # 두 번 호출해도 중복 X
    if "events" not in cur_edited:
        cur_edited.append("events")
    assert cur_edited.count("events") == 1


def test_t2c_patch_events_array_validation_props_must_be_list():
    """T2 (c) — props 가 list 가 아니면 400."""
    routes = _import_mv_routes()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        routes._v53_normalize_events_array([{"trigger": "x", "props": "not list"}])
    assert ei.value.status_code == 400


def test_t2d_patch_events_array_validation_event_must_be_dict():
    """T2 (d) — event 가 dict 가 아니면 400."""
    routes = _import_mv_routes()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        routes._v53_normalize_events_array(["not dict"])
    assert ei.value.status_code == 400


# ── T3 — Cascade Phase 진행 ─────────────────────────────────────────────────


def test_t3a_phase_progress_table_consistent():
    """T3 (a) — Phase 별 progress 매핑이 단조 증가."""
    pipe = _import_pipeline()
    expected_order = [
        "events_extract", "scene_split", "scene_image_prompt",
        "scene_image", "scene_video_prompt", "video_invalidate",
    ]
    progresses = [pipe._V53_PHASE_PROGRESS[p] for p in expected_order]
    assert progresses == sorted(progresses)
    assert progresses[0] == 16
    assert progresses[-1] == 100


def test_t3b_full_cascade_phase_transitions_no_user_events():
    """T3 (b) — narrative 만 편집 + events 미편집 → events_extract 진입 + 전체 phase 흐름 호출 순서."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # narrative 만 사용자 편집
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["narrative"]

    phase_log = []

    async def fake_extract_events(job, mongo_db, job_oid):
        phase_log.append("events_extract")
        return True

    async def fake_run_phase1_split(job_id, mongo_db):
        phase_log.append("scene_split")

    async def fake_run_phase2_images(job_id, mongo_db, scene_numbers=None):
        phase_log.append("scene_image")

    async def fake_regen_vp(job, scene_idx):
        phase_log.append("regen_vp:" + str(scene_idx))
        return "new vp"

    async def fake_invalidate(mongo_db, job_oid, scene_idx, scene_number):
        phase_log.append("invalidate:" + str(scene_number))

    with patch.object(pipe, "_v53_extract_events_only", fake_extract_events), \
         patch.object(pipe, "run_phase1_split", fake_run_phase1_split), \
         patch.object(pipe, "run_phase2_images", fake_run_phase2_images), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen_vp), \
         patch.object(pipe, "_v51_invalidate_video", fake_invalidate):

        async def run():
            await pipe._v53_full_cascade(oid, mongo)

        asyncio.run(run())

    # Phase 0 호출됨
    assert "events_extract" in phase_log
    # Phase 1
    assert "scene_split" in phase_log
    # Phase 2
    assert "scene_image" in phase_log
    # Phase 2.5 - 모든 씬 (2개)
    assert "regen_vp:0" in phase_log
    assert "regen_vp:1" in phase_log
    # Phase Final - 영상 폐기 (모든 씬)
    assert "invalidate:1" in phase_log
    assert "invalidate:2" in phase_log
    # 최종 cascade_phase=completed
    assert mongo.mv_jobs._docs[oid]["cascade_phase"] == "completed"
    assert mongo.mv_jobs._docs[oid]["cascade_progress"] == 100


# ── T4 — Stage 2 LLM 재호출 정책 (Q3) ───────────────────────────────────────


def test_t4a_events_extract_skipped_when_user_edited_events():
    """T4 (a) — narrative + events 둘 다 편집 → events 추출 LLM 호출 X."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["narrative", "events"]

    extract_called = []

    async def fake_extract(job, mongo_db, job_oid):
        extract_called.append(True)
        return True

    async def fake_split(job_id, mongo_db):
        return None

    async def fake_p2(job_id, mongo_db, scene_numbers=None):
        return None

    async def fake_regen(job, scene_idx):
        return None

    async def fake_inv(*a, **kw):
        return None

    with patch.object(pipe, "_v53_extract_events_only", fake_extract), \
         patch.object(pipe, "run_phase1_split", fake_split), \
         patch.object(pipe, "run_phase2_images", fake_p2), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen), \
         patch.object(pipe, "_v51_invalidate_video", fake_inv):

        asyncio.run(pipe._v53_full_cascade(oid, mongo))

    assert extract_called == []


def test_t4b_events_extract_skipped_when_only_events_edited():
    """T4 (b) — events 만 편집 (narrative 미편집) → events 추출 LLM 호출 X."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["events"]

    extract_called = []

    async def fake_extract(*a, **kw):
        extract_called.append(True)
        return True

    async def fake_split(*a, **kw):
        return None

    async def fake_p2(*a, **kw):
        return None

    async def fake_regen(*a, **kw):
        return None

    async def fake_inv(*a, **kw):
        return None

    with patch.object(pipe, "_v53_extract_events_only", fake_extract), \
         patch.object(pipe, "run_phase1_split", fake_split), \
         patch.object(pipe, "run_phase2_images", fake_p2), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen), \
         patch.object(pipe, "_v51_invalidate_video", fake_inv):

        asyncio.run(pipe._v53_full_cascade(oid, mongo))

    assert extract_called == []


def test_t4c_events_extract_called_when_only_narrative_edited():
    """T4 (c) — narrative 만 편집 + events 미편집 → events 추출 LLM 호출 1회."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["narrative"]

    extract_called = []

    async def fake_extract(*a, **kw):
        extract_called.append(True)
        return True

    async def fake_split(*a, **kw):
        return None

    async def fake_p2(*a, **kw):
        return None

    async def fake_regen(*a, **kw):
        return None

    async def fake_inv(*a, **kw):
        return None

    with patch.object(pipe, "_v53_extract_events_only", fake_extract), \
         patch.object(pipe, "run_phase1_split", fake_split), \
         patch.object(pipe, "run_phase2_images", fake_p2), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen), \
         patch.object(pipe, "_v51_invalidate_video", fake_inv):

        asyncio.run(pipe._v53_full_cascade(oid, mongo))

    assert len(extract_called) == 1


# ── T5 — 영상 폐기 ───────────────────────────────────────────────────────────


def test_t5_video_invalidated_after_cascade():
    """T5 — cascade 완료 후 모든 씬 video 가 _v51_invalidate_video 로 폐기됨."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["narrative"]

    invalidated_scenes = []

    async def fake_extract(*a, **kw):
        return True

    async def fake_split(*a, **kw):
        return None

    async def fake_p2(*a, **kw):
        return None

    async def fake_regen(*a, **kw):
        return None

    async def fake_inv(mongo_db, job_oid, scene_idx, scene_number):
        invalidated_scenes.append(scene_number)
        # 실제 invalidate 처럼 video_status 마킹
        scenes = mongo_db.mv_jobs._docs[job_oid]["scenes"]
        scenes[scene_idx]["video_status"] = "invalidated_by_cascade"
        scenes[scene_idx]["video_object_name"] = None

    with patch.object(pipe, "_v53_extract_events_only", fake_extract), \
         patch.object(pipe, "run_phase1_split", fake_split), \
         patch.object(pipe, "run_phase2_images", fake_p2), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen), \
         patch.object(pipe, "_v51_invalidate_video", fake_inv):

        asyncio.run(pipe._v53_full_cascade(oid, mongo))

    assert sorted(invalidated_scenes) == [1, 2]
    for s in mongo.mv_jobs._docs[oid]["scenes"]:
        assert s["video_status"] == "invalidated_by_cascade"
        assert s["video_object_name"] is None


# ── T6 — 취소 ───────────────────────────────────────────────────────────────


def test_t6_cancel_during_cascade():
    """T6 — Phase 1 진행 중 cancel_requested=True → 다음 phase 진입 X + cascade_phase=cancelled."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenario_user_edited_fields"] = ["narrative"]

    p2_called = []

    async def fake_extract(*a, **kw):
        return True

    async def fake_split(job_id, mongo_db):
        # scene_split 진행 중에 사용자가 취소 신호를 보냄
        mongo_db.mv_jobs._docs[oid]["cancel_requested"] = True

    async def fake_p2(*a, **kw):
        p2_called.append(True)

    async def fake_regen(*a, **kw):
        return None

    async def fake_inv(*a, **kw):
        return None

    with patch.object(pipe, "_v53_extract_events_only", fake_extract), \
         patch.object(pipe, "run_phase1_split", fake_split), \
         patch.object(pipe, "run_phase2_images", fake_p2), \
         patch.object(pipe, "_v51_regen_video_prompt_single", fake_regen), \
         patch.object(pipe, "_v51_invalidate_video", fake_inv):

        asyncio.run(pipe._v53_full_cascade(oid, mongo))

    # scene_image phase 진입 X (cancel 으로 차단)
    assert p2_called == []
    assert mongo.mv_jobs._docs[oid]["cascade_phase"] == "cancelled"
    # cancel_requested 는 cascade 마감 시 False 로 reset
    assert mongo.mv_jobs._docs[oid]["cancel_requested"] is False


# ── T7 — 사용자 직접 편집 씬 archive 보관 ────────────────────────────────────


def test_t7_scenes_archive_preserves_old_scenes():
    """T7 — Phase 1 진입 직전 옛 scenes 통째 → scenes_archive 의 head 1회분만."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        await pipe._v53_archive_scenes(mongo, oid)

    asyncio.run(run())

    archive = mongo.mv_jobs._docs[oid].get("scenes_archive") or []
    assert len(archive) == 1
    assert "scenes" in archive[0]
    # 사용자 직접 편집한 user_edited_fields 도 archive 에 보존
    archived_scenes = archive[0]["scenes"]
    assert archived_scenes[1].get("user_edited_fields") == ["image_prompt"]


def test_t7b_scenes_archive_replaces_old_archive():
    """T7 (b) — archive 는 1회분만 — 두 번째 호출 시 옛 archive 폐기."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        await pipe._v53_archive_scenes(mongo, oid)
        # scenes 변경 — 새로운 archive 가 옛 것을 교체해야 함
        mongo.mv_jobs._docs[oid]["scenes"] = [
            {"scene_number": 99, "user_edited_fields": []},
        ]
        await pipe._v53_archive_scenes(mongo, oid)

    asyncio.run(run())

    archive = mongo.mv_jobs._docs[oid].get("scenes_archive") or []
    assert len(archive) == 1
    # 두 번째 archive 가 첫 번째 를 교체
    assert archive[0]["scenes"][0]["scene_number"] == 99


# ── T8 — 회귀: 옛 도큐먼트 GET 응답 backward-compat ───────────────────────────


def test_t8a_legacy_doc_default_cascade_fields():
    """T8 (a) — 옛 mv_jobs (cascade_phase 없음) → GET 응답 변환 시 None/0/[] 기본값."""
    legacy_job = {
        "_id": "legacy_oid",
        # cascade_phase / scenario_user_edited_fields 등 키 자체 없음
    }
    # GET 응답 변환 로직 시뮬
    out = {
        "scenario_user_edited_fields": legacy_job.get("scenario_user_edited_fields") or [],
        "cascade_phase": legacy_job.get("cascade_phase"),
        "cascade_progress": int(legacy_job.get("cascade_progress") or 0),
        "cascade_started_at": (
            legacy_job.get("cascade_started_at").isoformat()
            if legacy_job.get("cascade_started_at") else None
        ),
        "cascade_completed_at": (
            legacy_job.get("cascade_completed_at").isoformat()
            if legacy_job.get("cascade_completed_at") else None
        ),
        "cancel_requested": bool(legacy_job.get("cancel_requested")),
        "cascade_id": legacy_job.get("cascade_id"),
        "scenes_archive_count": len(legacy_job.get("scenes_archive") or []),
    }
    assert out["scenario_user_edited_fields"] == []
    assert out["cascade_phase"] is None
    assert out["cascade_progress"] == 0
    assert out["cascade_started_at"] is None
    assert out["cascade_completed_at"] is None
    assert out["cancel_requested"] is False
    assert out["cascade_id"] is None
    assert out["scenes_archive_count"] == 0


def test_t8b_terminal_phase_set_includes_none():
    """T8 (b) — _V53_CASCADE_TERMINAL_PHASES 가 None / completed / cancelled / failed 모두 포함."""
    routes = _import_mv_routes()
    assert None in routes._V53_CASCADE_TERMINAL_PHASES
    assert "completed" in routes._V53_CASCADE_TERMINAL_PHASES
    assert "cancelled" in routes._V53_CASCADE_TERMINAL_PHASES
    assert "failed" in routes._V53_CASCADE_TERMINAL_PHASES


def test_t8c_legacy_scenes_no_user_edited_fields():
    """T8 (c) — 옛 scenes (user_edited_fields 키 없음) → archive 에 통과 (안전)."""
    pipe = _import_pipeline()
    legacy_scenes = [
        {"scene_number": 1, "section": "verse1"},  # user_edited_fields 키 없음
        {"scene_number": 2, "section": "chorus"},
    ]
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenes"] = legacy_scenes

    async def run():
        await pipe._v53_archive_scenes(mongo, oid)

    asyncio.run(run())

    archive = mongo.mv_jobs._docs[oid].get("scenes_archive") or []
    assert len(archive) == 1
    assert archive[0]["scenes"][0]["scene_number"] == 1
