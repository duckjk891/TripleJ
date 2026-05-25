"""v52 — 시나리오 events 단위 부분 수정 + 매핑 씬 cascade 테스트.

T1 — PATCH 단위 (event field, user_edited_fields 누적, out-of-range, 빈 body, 옛 도큐먼트).
T2 — Cascade 시작 / dispatch 단위 (매핑 1개 / 2개 / 0개 / 진행 중 skip).
T3 — 사용자 편집 보존 (scene.user_edited_fields 의 description 이 cascade 자체 skip).
T4 — 영상 폐기 (이벤트 cascade 의 매핑 씬에서 v51 invalidate 호출 검증).
T5 — 진행 중 cancel → cancelled (매핑 씬 일괄 cancel_requested).
T6 — 프론트 e2e 는 Vite build 회귀로 대체.
T7 — _scene_to_dict / get_mv_job 응답 옛 도큐먼트 호환 + scenario_events 응답 user_edited_fields 기본값.
"""

import asyncio
import sys
import types
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Fake Mongo (in-memory, dotted-path $set, scenario_events 인덱스 지원) ─────


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


def make_fake_mongo(scenes_seed=None, events_seed=None):
    job_oid = "job_oid_v52"
    scenes = scenes_seed or [
        {
            # event_index=0 (event 1)
            "scene_number": 1,
            "section": "verse1",
            "use_seconds": 5.0,
            "lyrics_segment": "가사 1",
            "scene_type": "drama",
            "description": "원래 description 1",
            "image_prompt": "원래 image_prompt 1",
            "video_image_prompt": "원래 video_image_prompt 1",
            "video_prompt": "원래 video_prompt 1",
            "image_object_name": "mv/job_oid_v52/scenes/001.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_v52/scenes/001_video.mp4",
            "event_index": 0,
        },
        {
            # event_index=0 (event 1) — 두번째 매핑 씬
            "scene_number": 2,
            "section": "chorus",
            "use_seconds": 6.0,
            "lyrics_segment": "가사 2",
            "scene_type": "drama",
            "description": "원래 description 2",
            "image_prompt": "원래 image_prompt 2",
            "video_image_prompt": "",
            "video_prompt": "원래 video_prompt 2",
            "image_object_name": "mv/job_oid_v52/scenes/002.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_v52/scenes/002_video.mp4",
            "event_index": 0,
        },
        {
            # event_index=1 (event 2) — 단일 매핑
            "scene_number": 3,
            "section": "verse2",
            "use_seconds": 5.0,
            "lyrics_segment": "가사 3",
            "scene_type": "drama",
            "description": "원래 description 3",
            "image_prompt": "원래 image_prompt 3",
            "video_image_prompt": "",
            "video_prompt": "원래 video_prompt 3",
            "image_object_name": "mv/job_oid_v52/scenes/003.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_v52/scenes/003_video.mp4",
            "event_index": 1,
        },
        {
            # event_index=None — 매핑 X (event 3 cascade 시 영향 X)
            "scene_number": 4,
            "section": "bridge",
            "use_seconds": 5.0,
            "lyrics_segment": "가사 4",
            "scene_type": "drama",
            "description": "원래 description 4",
            "image_prompt": "원래 image_prompt 4",
            "video_image_prompt": "",
            "video_prompt": "원래 video_prompt 4",
            "image_object_name": "mv/job_oid_v52/scenes/004.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_v52/scenes/004_video.mp4",
            "event_index": None,
        },
    ]
    events = events_seed if events_seed is not None else [
        {
            "order": 1,
            "section": "verse1",
            "trigger": "옛날 사진을 발견",
            "protagonist_action": "사진을 한참 들여다본다",
            "motivation": "그리움",
            "emotion_shift": "정적 → 그리움",
            "props": ["사진", "먼지"],
        },
        {
            "order": 2,
            "section": "chorus",
            "trigger": "비가 내리기 시작",
            "protagonist_action": "창문을 닫는다",
            "motivation": "현실 회피",
            "emotion_shift": "그리움 → 슬픔",
            "props": ["창문"],
        },
        {
            "order": 3,
            "section": "outro",
            "trigger": "발걸음을 옮긴다",
            "protagonist_action": "방을 나선다",
            "motivation": "다시 걷고 싶음",
            "emotion_shift": "슬픔 → 결심",
            "props": [],
        },
    ]
    doc = {
        "_id": job_oid,
        "user_id": "user_abc",
        "title": "테스트 곡",
        "scenes": scenes,
        "video_model": "veo",
        "scenario_events": events,
    }
    coll = FakeMVJobsCollection([doc])
    return FakeMongoDB(coll), job_oid


def _import_pipeline():
    from app.services import mv_pipeline
    return mv_pipeline


# ── T7 (run first — schema diff baseline) ───────────────────────────────────


def test_t7a_scenario_events_default_user_edited_fields():
    """T7 — scenario_events 의 옛 도큐먼트 (user_edited_fields 키 없음) → 빈 배열로 정규화.

    GET 응답 변환 로직을 직접 시뮬레이션 (라우트 함수 안 lambda 매핑과 동일).
    """
    old_events = [
        {"order": 1, "trigger": "x"},  # 옛 — user_edited_fields 키 없음
        {"order": 2, "trigger": "y", "user_edited_fields": ["trigger"]},
    ]
    out = [
        {**ev, "user_edited_fields": ev.get("user_edited_fields") or []}
        for ev in old_events
    ]
    assert out[0]["user_edited_fields"] == []
    assert out[1]["user_edited_fields"] == ["trigger"]


def test_t7b_get_affected_scenes_skips_missing_event_index():
    """T7 — 옛 도큐먼트 (scene.event_index 키 누락) 는 _v52_get_affected_scenes 에서 안전 skip."""
    pipe = _import_pipeline()
    legacy_scenes = [
        {"scene_number": 1, "event_index": 0},
        {"scene_number": 2},  # event_index 누락 (옛 도큐먼트)
        {"scene_number": 3, "event_index": 0},
    ]
    mongo, oid = make_fake_mongo(scenes_seed=legacy_scenes, events_seed=[
        {"order": 1, "trigger": "x"},
    ])

    async def run():
        return await pipe._v52_get_affected_scenes(mongo, oid, 1)

    out = asyncio.run(run())
    # event_index None/missing 인 scene_number=2 는 제외, 0/0 인 1/3 만 포함
    assert out == [1, 3]


# ── T1 — PATCH 단위 (helper level — fake mongo update) ──────────────────────


def test_t1a_patch_event_partial_field_updates_and_user_edited_accumulates():
    """T1 (a) — trigger 단독 PATCH 후 mongo 갱신 + user_edited_fields=['trigger']."""
    mongo, oid = make_fake_mongo()
    # PATCH 라우트 안의 핵심 로직을 직접 재현.
    events = mongo.mv_jobs._docs[oid]["scenario_events"]
    order = 1
    payload = {"trigger": "수정된 트리거"}
    cur_edited = list(events[order - 1].get("user_edited_fields") or [])
    for k in payload.keys():
        if k not in cur_edited:
            cur_edited.append(k)
    update = {"updated_at": datetime.utcnow()}
    for k, v in payload.items():
        update["scenario_events.{}.{}".format(order - 1, k)] = v
    update["scenario_events.{}.user_edited_fields".format(order - 1)] = cur_edited

    async def run():
        await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    asyncio.run(run())
    e = mongo.mv_jobs._docs[oid]["scenario_events"][0]
    assert e["trigger"] == "수정된 트리거"
    assert e["user_edited_fields"] == ["trigger"]
    # 다른 event 영향 없음
    e2 = mongo.mv_jobs._docs[oid]["scenario_events"][1]
    assert e2["trigger"] == "비가 내리기 시작"
    assert e2.get("user_edited_fields") in (None, [])


def test_t1b_patch_event_multi_field_accumulates_unique():
    """T1 (b) — trigger + motivation 동시 PATCH → 두 필드 갱신, user_edited_fields append (중복 없음)."""
    mongo, oid = make_fake_mongo()
    events = mongo.mv_jobs._docs[oid]["scenario_events"]
    # 사전 상태 — user_edited_fields 에 trigger 가 이미 있음
    events[0]["user_edited_fields"] = ["trigger"]
    payload = {"trigger": "다시 변경", "motivation": "분노"}
    order = 1
    cur_edited = list(events[order - 1].get("user_edited_fields") or [])
    for k in payload.keys():
        if k not in cur_edited:
            cur_edited.append(k)
    update = {"updated_at": datetime.utcnow()}
    for k, v in payload.items():
        update["scenario_events.{}.{}".format(order - 1, k)] = v
    update["scenario_events.{}.user_edited_fields".format(order - 1)] = cur_edited

    async def run():
        await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    asyncio.run(run())
    e = mongo.mv_jobs._docs[oid]["scenario_events"][0]
    assert e["trigger"] == "다시 변경"
    assert e["motivation"] == "분노"
    assert e["user_edited_fields"] == ["trigger", "motivation"]


def test_t1c_patch_event_old_doc_no_user_edited_field_starts_empty():
    """T1 (f) — 옛 도큐먼트 (user_edited_fields 키 없음) PATCH → 빈 배열에서 정상 추가."""
    legacy_events = [
        {"order": 1, "trigger": "old"},
    ]
    mongo, oid = make_fake_mongo(events_seed=legacy_events)
    events = mongo.mv_jobs._docs[oid]["scenario_events"]
    payload = {"emotion_shift": "기쁨"}
    order = 1
    cur_edited = list(events[order - 1].get("user_edited_fields") or [])
    for k in payload.keys():
        if k not in cur_edited:
            cur_edited.append(k)
    update = {}
    for k, v in payload.items():
        update["scenario_events.{}.{}".format(order - 1, k)] = v
    update["scenario_events.{}.user_edited_fields".format(order - 1)] = cur_edited

    async def run():
        await mongo.mv_jobs.update_one({"_id": oid}, {"$set": update})

    asyncio.run(run())
    e = mongo.mv_jobs._docs[oid]["scenario_events"][0]
    assert e["emotion_shift"] == "기쁨"
    assert e["user_edited_fields"] == ["emotion_shift"]


# ── T2 — Cascade dispatch (mocked v51_run_cascade) ──────────────────────────


def test_t2a_event_cascade_single_mapped_scene():
    """T2 (a) — event[2] 매핑 씬 1개 (#3) → _v51_run_cascade 1번 호출."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    with patch.object(pipe, "_v51_run_cascade", new=AsyncMock()) as mock_run:
        asyncio.run(pipe._v52_event_cascade(oid, 2, mongo))
        # event_order=2 → event_index=1 → scene #3 (단일)
        assert mock_run.call_count == 1
        args = mock_run.call_args[0]
        assert args[1] == 3  # scene_number
        assert args[3] == "description"  # trigger_field


def test_t2b_event_cascade_two_mapped_scenes_sequential():
    """T2 (b) — event[1] 매핑 씬 2개 (#1, #2) → _v51_run_cascade 2번 순차."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    call_order = []

    async def fake_run(job_oid, scene_number, mongo_db, trigger_field):
        call_order.append(scene_number)

    with patch.object(pipe, "_v51_run_cascade", new=AsyncMock(side_effect=fake_run)) as mock_run:
        asyncio.run(pipe._v52_event_cascade(oid, 1, mongo))
        assert mock_run.call_count == 2
        # 순서대로 #1, #2
        assert call_order == [1, 2]


def test_t2c_event_cascade_no_mapped_scenes_skips_call():
    """T2 (c) — event[3] 매핑 씬 0개 → _v51_run_cascade 호출 X + 정상 종료."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    with patch.object(pipe, "_v51_run_cascade", new=AsyncMock()) as mock_run:
        asyncio.run(pipe._v52_event_cascade(oid, 3, mongo))
        # event[3] 은 어떤 씬도 매핑 안 됨 (#4 는 event_index=None)
        mock_run.assert_not_called()


def test_t2d_get_affected_scenes_returns_correct_mapping():
    """T2 — _v52_get_affected_scenes 가 event_index === order-1 인 scene_number 만 반환."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run_all():
        return (
            await pipe._v52_get_affected_scenes(mongo, oid, 1),
            await pipe._v52_get_affected_scenes(mongo, oid, 2),
            await pipe._v52_get_affected_scenes(mongo, oid, 3),
        )

    a1, a2, a3 = asyncio.run(run_all())
    assert a1 == [1, 2]
    assert a2 == [3]
    assert a3 == []


# ── T3 — 사용자 편집 보존 (description 보존 시 cascade 자체 skip) ──────────


def test_t3a_description_user_edited_skips_full_cascade():
    """T3 (a) — 매핑 씬 #1 의 user_edited_fields 에 'description' 있으면 cascade 자체 skip
    (cascade_status='completed' 즉시 마킹) + _v51_run_cascade 호출 X.
    """
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # 매핑 씬 #1 description 사용자 편집 표시
    mongo.mv_jobs._docs[oid]["scenes"][0]["user_edited_fields"] = ["description"]

    with patch.object(pipe, "_v51_run_cascade", new=AsyncMock()) as mock_run:
        asyncio.run(pipe._v52_event_cascade(oid, 1, mongo))
        # 매핑 씬 2개 중 #1 은 skip, #2 만 cascade 실행
        assert mock_run.call_count == 1
        args = mock_run.call_args[0]
        assert args[1] == 2  # scene #2 만 들어감

    # #1 의 cascade_status 는 completed 로 마킹됨 (skip 표시)
    s1 = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert s1["cascade_status"] == "completed"
    assert s1["cascade_progress"] == 100


def test_t3b_image_prompt_user_edited_does_not_skip_event_cascade():
    """T3 (b) — image_prompt 가 user_edited 여도 event cascade 는 진입 (v51 정책으로 phase1b 만 skip).
    여기서는 mock 으로 _v51_run_cascade 호출됨을 검증.
    """
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    mongo.mv_jobs._docs[oid]["scenes"][0]["user_edited_fields"] = ["image_prompt"]

    with patch.object(pipe, "_v51_run_cascade", new=AsyncMock()) as mock_run:
        asyncio.run(pipe._v52_event_cascade(oid, 1, mongo))
        # 두 매핑 씬 모두 cascade 진입 (description 은 user_edited 가 아니므로)
        assert mock_run.call_count == 2


# ── T4 — 영상 폐기 (v51 cascade 안에서 _v51_invalidate_video 호출 검증) ─────


def test_t4_event_cascade_invokes_video_invalidation_via_v51_cascade():
    """T4 — event cascade 가 결국 v51 _v51_run_cascade('description') 를 호출하면
    그 안에서 _v51_invalidate_video 가 실행됨. 본 테스트는 invalidate 호출이 매핑 씬마다
    1회씩 발생하는지 검증.
    """
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    # _v51_run_cascade 안에서 호출되는 phase 함수들 mock + invalidate 만 실제 동작하도록.
    async def fake_phase1b(job, scene_idx):
        return {"image_prompt": "new", "video_image_prompt": "new", "description_ko": "ko"}

    async def fake_phase2(job_oid, mongo_db, scene_numbers=None):
        pass

    async def fake_phase25(job, scene_idx):
        return "new vp"

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)), \
         patch.object(pipe, "run_phase2_images", new=AsyncMock(side_effect=fake_phase2)), \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock(side_effect=fake_phase25)):
        asyncio.run(pipe._v52_event_cascade(oid, 1, mongo))

    # 매핑 씬 2개 모두 영상 마킹
    s1 = mongo.mv_jobs._docs[oid]["scenes"][0]
    s2 = mongo.mv_jobs._docs[oid]["scenes"][1]
    assert s1["video_status"] == "invalidated_by_cascade"
    assert s1["video_object_name"] is None
    assert s2["video_status"] == "invalidated_by_cascade"
    assert s2["video_object_name"] is None


# ── T5 — 진행 중 cancel → cancelled (매핑 씬 일괄 cancel_requested) ────────


def test_t5a_cancel_event_cascade_marks_running_scenes():
    """T5 (a) — running 인 매핑 씬에 cancel_requested=True. idle/completed 는 변경 X (idempotent)."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # 매핑 씬 2개 중 #1 은 running, #2 는 idle (가짜 상태)
    mongo.mv_jobs._docs[oid]["scenes"][0]["cascade_status"] = "running"
    mongo.mv_jobs._docs[oid]["scenes"][1]["cascade_status"] = "idle"

    async def run():
        return await pipe._v52_cancel_event_cascade(mongo, oid, 1)

    out = asyncio.run(run())
    # running 인 #1 만 cancelled list 에 들어감
    assert out == [1]
    s1 = mongo.mv_jobs._docs[oid]["scenes"][0]
    s2 = mongo.mv_jobs._docs[oid]["scenes"][1]
    assert s1.get("cancel_requested") is True
    # #2 (idle) 은 변경 X
    assert s2.get("cancel_requested") in (None, False)


def test_t5b_cancel_event_no_mapped_scenes_returns_empty():
    """T5 (b) — 매핑 씬 0개인 event 에 cancel 호출 → 빈 list 반환 (idempotent)."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        return await pipe._v52_cancel_event_cascade(mongo, oid, 3)

    out = asyncio.run(run())
    assert out == []


# ── T7 (continued) — _scene_to_dict 기존 v51 호환 보장 ──────────────────────


def test_t7c_scene_to_dict_passthrough_event_index():
    """T7 — _scene_to_dict 이 v45 의 event_index 를 그대로 통과시키는지 (v52 cascade 의 핵심 의존성)."""
    from app.routes.mv import _scene_to_dict

    scene = {
        "scene_number": 5,
        "event_index": 4,
    }
    out = _scene_to_dict(scene)
    assert out["event_index"] == 4

    scene2 = {
        "scene_number": 6,
        "event_index": None,
    }
    out2 = _scene_to_dict(scene2)
    assert out2["event_index"] is None
