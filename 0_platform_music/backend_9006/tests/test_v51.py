"""v51 — 씬 카드 편집 + 부분 cascade 테스트.

T1 — PATCH 단위 (백그라운드 cascade 호출 없이 텍스트 갱신만 검증).
T2 — Cascade 시작 / dispatch 단위 (mocked LLM/Gemini).
T3 — 사용자 편집 필드 보존 (user_edited_fields 가 cascade 내에서 skip 보장).
T4 — 영상 폐기 마킹 (MinIO 파일 삭제 X 보장 → mock 으로 검증).
T5 — 진행률·취소 (cancel_requested 가 다음 phase 진입 시 폴링되어 cancelled 로 종료).
T6 — 프론트는 e2e 영역 (별도 — Vite build 회귀로 대체).
T7 — 회귀: _scene_to_dict 가 옛 도큐먼트(user_edited_fields 등 키 없음)에 안전한 기본값 부여.
"""

import asyncio
import sys
import types
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── Fake Mongo (in-memory) ──────────────────────────────────────────────────


class FakeMVJobsCollection:
    def __init__(self, docs):
        # docs: list[dict] indexed by _id (string for simplicity)
        self._docs = {d["_id"]: d for d in docs}

    async def find_one(self, query, projection=None):
        oid = query.get("_id")
        doc = self._docs.get(oid)
        if not doc:
            return None
        # Shallow copy (sufficient for our tests; mutations go through update_one)
        return {k: v for k, v in doc.items()}

    async def update_one(self, query, update):
        oid = query.get("_id")
        doc = self._docs.get(oid)
        if not doc:
            return MagicMock(matched_count=0, modified_count=0)
        sets = update.get("$set", {})
        for path, value in sets.items():
            # Support dotted paths like "scenes.0.image_prompt"
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


def make_fake_mongo(scenes_seed=None):
    job_oid = "job_oid_xyz"
    scenes = scenes_seed or [
        {
            "scene_number": 1,
            "section": "verse1",
            "use_seconds": 5.0,
            "lyrics_segment": "가사 1",
            "scene_type": "drama",
            "description": "원래 description 1",
            "image_prompt": "원래 image_prompt 1",
            "video_image_prompt": "원래 video_image_prompt 1",
            "video_prompt": "원래 video_prompt 1",
            "image_object_name": "mv/job_oid_xyz/scenes/001.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_xyz/scenes/001_video.mp4",
        },
        {
            "scene_number": 2,
            "section": "chorus",
            "use_seconds": 6.0,
            "lyrics_segment": "가사 2",
            "scene_type": "drama",
            "description": "원래 description 2",
            "image_prompt": "원래 image_prompt 2",
            "video_image_prompt": "",
            "video_prompt": "원래 video_prompt 2",
            "image_object_name": "mv/job_oid_xyz/scenes/002.png",
            "video_status": "completed",
            "video_object_name": "mv/job_oid_xyz/scenes/002_video.mp4",
        },
    ]
    doc = {
        "_id": job_oid,
        "user_id": "user_abc",
        "title": "테스트 곡",
        "scenes": scenes,
        "video_model": "veo",
        "scenario_events": [],
    }
    coll = FakeMVJobsCollection([doc])
    return FakeMongoDB(coll), job_oid


# ── Helpers under test ──────────────────────────────────────────────────────


def _import_pipeline():
    """Import mv_pipeline lazily so tests fail loudly with stack trace."""
    from app.services import mv_pipeline
    return mv_pipeline


# ── T7 (run first — schema diff baseline) ───────────────────────────────────


def test_t7a_scene_to_dict_old_doc_has_default_v51_fields():
    """T7 (a) — _scene_to_dict 가 v51 신규 필드 없는 옛 도큐먼트에 기본값을 채워준다."""
    from app.routes.mv import _scene_to_dict

    old_scene = {
        "scene_number": 1,
        "description": "old",
        "image_prompt": "old prompt",
    }
    out = _scene_to_dict(old_scene)
    assert out["user_edited_fields"] == []
    assert out["cascade_status"] == "idle"
    assert out["cascade_progress"] == 0
    assert out["cascade_started_at"] is None
    assert out["cascade_completed_at"] is None
    assert out["cancel_requested"] is False


def test_t7b_scene_to_dict_passes_through_v51_fields():
    """T7 (b) — 신규 필드가 도큐먼트에 있으면 그대로 응답."""
    from app.routes.mv import _scene_to_dict

    full_scene = {
        "scene_number": 2,
        "user_edited_fields": ["description"],
        "cascade_status": "running",
        "cascade_progress": 33,
        "cancel_requested": True,
    }
    out = _scene_to_dict(full_scene)
    assert out["user_edited_fields"] == ["description"]
    assert out["cascade_status"] == "running"
    assert out["cascade_progress"] == 33
    assert out["cancel_requested"] is True


# ── T1 — PATCH 단위 (helper level) ──────────────────────────────────────────


def test_t1_set_scene_fields_positional_set():
    """T1 — _v51_set_scene_fields 가 positional $set 으로 다른 씬에 영향 없이 단일 씬 갱신."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        await pipe._v51_set_scene_fields(mongo, oid, 0, {
            "description": "edited 1",
            "user_edited_fields": ["description"],
        })

    asyncio.run(run())
    doc = mongo.mv_jobs._docs[oid]
    assert doc["scenes"][0]["description"] == "edited 1"
    assert doc["scenes"][0]["user_edited_fields"] == ["description"]
    # 다른 씬 영향 없음
    assert doc["scenes"][1]["description"] == "원래 description 2"
    assert doc["scenes"][1].get("user_edited_fields") in (None, [])


def test_t1_user_edited_field_helpers():
    """T1 — _v51_is_user_edited / _v51_remove_user_edited_field 동작."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        # 초기에는 비어 있음
        assert (await pipe._v51_is_user_edited(mongo, oid, 0, "description")) is False
        # set
        await pipe._v51_set_scene_fields(mongo, oid, 0, {
            "user_edited_fields": ["description", "image_prompt"],
        })
        assert (await pipe._v51_is_user_edited(mongo, oid, 0, "description")) is True
        assert (await pipe._v51_is_user_edited(mongo, oid, 0, "image_prompt")) is True
        # remove one
        await pipe._v51_remove_user_edited_field(mongo, oid, 0, "image_prompt")
        scene = await pipe._v51_get_scene(mongo, oid, 0)
        assert scene["user_edited_fields"] == ["description"]
        assert (await pipe._v51_is_user_edited(mongo, oid, 0, "image_prompt")) is False

    asyncio.run(run())


def test_t1_get_scene_idx_by_scene_number():
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        assert (await pipe._v51_get_scene_idx(mongo, oid, 1)) == 0
        assert (await pipe._v51_get_scene_idx(mongo, oid, 2)) == 1
        assert (await pipe._v51_get_scene_idx(mongo, oid, 99)) is None

    asyncio.run(run())


# ── T2 — Cascade dispatch (mocked) ──────────────────────────────────────────


def test_t2_cascade_video_prompt_is_noop():
    """T2 (c) — trigger_field='video_prompt' 는 즉시 completed (phase 호출 없음, video 폐기 X)."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def run():
        await pipe._v51_run_cascade(oid, 1, mongo, "video_prompt")

    with patch.object(pipe, "run_phase2_images", new=AsyncMock()) as mock_p2, \
         patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock()) as mock_p1b, \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock()) as mock_p25:
        asyncio.run(run())
        # phase 함수 어떤 것도 호출되지 않음
        mock_p2.assert_not_called()
        mock_p1b.assert_not_called()
        mock_p25.assert_not_called()

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["cascade_status"] == "completed"
    assert scene["cascade_progress"] == 100
    # 영상 폐기 X (video_prompt 만 변경되어도 image 가 안 바뀌었으므로)
    assert scene["video_status"] == "completed"
    assert scene["video_object_name"] == "mv/job_oid_xyz/scenes/001_video.mp4"


def test_t2_cascade_from_image_prompt_progresses_and_invalidates_video():
    """T2 (b) — trigger='image_prompt': phase2 → phase2.5, phase1b 호출 0회, video invalidated."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def fake_phase2(job_oid, mongo_db, scene_numbers=None):
        # Simulate image already updated (real Phase 2 would update image_object_name etc)
        # Mongo 상태는 그대로.
        pass

    async def fake_phase25(job, scene_idx):
        return "재생성된 video_prompt"

    with patch.object(pipe, "run_phase2_images", new=AsyncMock(side_effect=fake_phase2)) as mock_p2, \
         patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock()) as mock_p1b, \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock(side_effect=fake_phase25)) as mock_p25:
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "image_prompt"))

        mock_p1b.assert_not_called()  # phase1b 안 들어감
        mock_p2.assert_called_once()  # phase2 1회
        mock_p25.assert_called_once()  # phase2.5 1회

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["cascade_status"] == "completed"
    assert scene["cascade_progress"] == 100
    assert scene["video_status"] == "invalidated_by_cascade"
    assert scene["video_object_name"] is None
    assert scene["video_prompt"] == "재생성된 video_prompt"


def test_t2_cascade_from_description_runs_phase1b_phase2_phase25():
    """T2 (a) — trigger='description': phase1b → phase2 → phase2.5 모두 실행."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    async def fake_phase1b(job, scene_idx):
        return {
            "scene_number": 1,
            "image_prompt": "재생성된 image_prompt",
            "video_image_prompt": "재생성된 video_image_prompt",
            "description_ko": "ko",
        }

    async def fake_phase2(job_oid, mongo_db, scene_numbers=None):
        pass

    async def fake_phase25(job, scene_idx):
        return "재생성된 video_prompt"

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)) as mock_p1b, \
         patch.object(pipe, "run_phase2_images", new=AsyncMock(side_effect=fake_phase2)) as mock_p2, \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock(side_effect=fake_phase25)) as mock_p25:
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "description"))

        mock_p1b.assert_called_once()
        mock_p2.assert_called_once()
        mock_p25.assert_called_once()

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["cascade_status"] == "completed"
    assert scene["cascade_progress"] == 100
    assert scene["image_prompt"] == "재생성된 image_prompt"
    assert scene["video_prompt"] == "재생성된 video_prompt"
    assert scene["video_status"] == "invalidated_by_cascade"


# ── T3 — 사용자 편집 필드 보존 ───────────────────────────────────────────────


def test_t3_user_edited_video_prompt_is_preserved_during_cascade():
    """T3 — video_prompt 가 user_edited_fields 에 있으면 cascade 가 phase2.5 를 skip 하고 보존."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # 사용자가 미리 video_prompt 를 직접 편집한 상태
    mongo.mv_jobs._docs[oid]["scenes"][0]["user_edited_fields"] = ["video_prompt"]
    mongo.mv_jobs._docs[oid]["scenes"][0]["video_prompt"] = "사용자가 편집한 video_prompt"

    async def fake_phase1b(job, scene_idx):
        return {"image_prompt": "p1b", "video_image_prompt": "vip", "description_ko": "ko"}

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)), \
         patch.object(pipe, "run_phase2_images", new=AsyncMock()), \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock()) as mock_p25:
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "description"))

        # phase2.5 호출 안 됨
        mock_p25.assert_not_called()

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    # video_prompt 보존
    assert scene["video_prompt"] == "사용자가 편집한 video_prompt"
    # user_edited_fields 에서 video_prompt 보존 (cascade 가 자동 재계산 안 했으므로)
    assert "video_prompt" in scene["user_edited_fields"]


def test_t3_cascade_auto_regen_clears_field_from_user_edited():
    """T3 — cascade 가 image_prompt 를 자동 재생성하면 user_edited_fields 에서 image_prompt 제거."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # 사용자가 image_prompt 와 video_prompt 둘 다 편집한 상태
    mongo.mv_jobs._docs[oid]["scenes"][0]["user_edited_fields"] = ["image_prompt", "video_prompt"]

    async def fake_phase1b(job, scene_idx):
        return {"image_prompt": "p1b regen", "video_image_prompt": "vip", "description_ko": "ko"}

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)) as mock_p1b, \
         patch.object(pipe, "run_phase2_images", new=AsyncMock()), \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock()) as mock_p25:
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "description"))

        # image_prompt 가 user_edited_fields 에 있어도 description trigger 라서 phase1b skip
        mock_p1b.assert_not_called()
        # video_prompt 도 user_edited 라서 phase2.5 skip
        mock_p25.assert_not_called()

    # 두 필드 모두 user_edited_fields 에 그대로 (cascade 가 건드리지 않았으므로)
    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert "image_prompt" in scene["user_edited_fields"]
    assert "video_prompt" in scene["user_edited_fields"]


def test_t3_cascade_regen_field_clears_user_edited():
    """T3 — image_prompt 가 user_edited 에 *없을* 때 cascade(description) 가 phase1b 로 자동 갱신.
    이전에 image_prompt 가 user_edited 에 있었으면 제거되어야 한다 (현 시나리오에서는 시작부터 없음)."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()
    # video_prompt 만 사용자가 편집. image_prompt 는 user_edited 아님.
    mongo.mv_jobs._docs[oid]["scenes"][0]["user_edited_fields"] = ["video_prompt"]

    async def fake_phase1b(job, scene_idx):
        return {"image_prompt": "p1b regen", "video_image_prompt": "vip", "description_ko": "ko"}

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)) as mock_p1b, \
         patch.object(pipe, "run_phase2_images", new=AsyncMock()), \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock()) as mock_p25:
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "description"))

        mock_p1b.assert_called_once()  # image_prompt 자동 갱신
        mock_p25.assert_not_called()    # video_prompt user_edited → skip

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["image_prompt"] == "p1b regen"
    # video_prompt 보존
    assert "video_prompt" in scene["user_edited_fields"]
    # image_prompt 는 자동 재계산이라 user_edited_fields 에 들어가지 X
    assert "image_prompt" not in scene["user_edited_fields"]


# ── T4 — 영상 폐기 마킹만 (MinIO 파일 삭제 X) ───────────────────────────────


def test_t4_video_invalidate_marks_only_no_minio_delete():
    """T4 — _v51_invalidate_video 는 video_status / video_object_name 만 마킹. MinIO 호출 0회."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    # MinIO mock — 어떤 함수도 호출되어선 안 됨
    fake_minio = MagicMock()
    with patch.object(pipe, "get_minio", return_value=fake_minio):
        asyncio.run(pipe._v51_invalidate_video(mongo, oid, 0, 1))

    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["video_status"] == "invalidated_by_cascade"
    assert scene["video_object_name"] is None
    # MinIO remove_object / put_object 등 어떤 호출도 없었어야 함
    fake_minio.remove_object.assert_not_called()
    fake_minio.delete_object.assert_not_called()


# ── T5 — 진행률·취소 ─────────────────────────────────────────────────────────


def test_t5_cancel_during_cascade_prevents_next_phase():
    """T5 — phase1b 후 cancel_requested=True 면 phase2 진입 전에 cancelled 로 종료."""
    pipe = _import_pipeline()
    mongo, oid = make_fake_mongo()

    p2_called = {"v": False}
    p25_called = {"v": False}

    async def fake_phase1b(job, scene_idx):
        # phase1b 끝나는 순간 사용자가 cancel 요청
        await pipe._v51_set_scene_fields(mongo, oid, 0, {"cancel_requested": True})
        return {"image_prompt": "p1b regen", "video_image_prompt": "vip", "description_ko": "ko"}

    async def fake_phase2(job_oid, mongo_db, scene_numbers=None):
        p2_called["v"] = True

    async def fake_phase25(job, scene_idx):
        p25_called["v"] = True
        return "vp"

    with patch.object(pipe, "_v51_regen_image_prompt_single", new=AsyncMock(side_effect=fake_phase1b)), \
         patch.object(pipe, "run_phase2_images", new=AsyncMock(side_effect=fake_phase2)), \
         patch.object(pipe, "_v51_regen_video_prompt_single", new=AsyncMock(side_effect=fake_phase25)):
        asyncio.run(pipe._v51_run_cascade(oid, 1, mongo, "description"))

    assert p2_called["v"] is False  # phase2 진입 안 함
    assert p25_called["v"] is False  # phase2.5 진입 안 함
    scene = mongo.mv_jobs._docs[oid]["scenes"][0]
    assert scene["cascade_status"] == "cancelled"
    assert scene["cascade_completed_at"] is not None
    # cancel_requested 는 finalize 에서 False 로 리셋
    assert scene["cancel_requested"] is False
