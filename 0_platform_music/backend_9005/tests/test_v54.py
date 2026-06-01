"""v54 — user_edited_fields 보존 정책 통합 테스트.

T1 — `_v54_is_field_user_edited` 통합 헬퍼 단위 (3 레벨 + 옛 도큐먼트 + 범위 초과).
T2 — v51/v52/v53 cascade 헬퍼가 v54 통합 헬퍼와 일관 분기 (회귀).
T3 — POST /user-edited/reset (scope=all / scope=scene / scope=event / scope=scenario / 부분 fields / 옛 도큐먼트).
T4 — GET /user-edited/summary (정상 응답 / 빈 도큐먼트 / 옛 도큐먼트).
T5 — (프론트) — 단위 테스트 범위 외 (Vite build PASS 로 대체).
T6 — (프론트) — 단위 테스트 범위 외.
T7 — 회귀 — v37~v53 무회귀 (기존 helper 호출 + Mongo schema 호환).
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest


# ── Fake Mongo (v53 패턴 재사용 + dotted-path $set + array index 지원) ─────────


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


def make_v54_baseline():
    """3 레벨 모두 user_edited_fields 가 있는 baseline."""
    job_oid = "job_v54"
    scenes = [
        {"scene_number": 1, "user_edited_fields": []},
        {"scene_number": 2, "user_edited_fields": ["description"]},
        {"scene_number": 3, "user_edited_fields": ["image_prompt", "video_prompt"]},
    ]
    events = [
        {"order": 1, "user_edited_fields": []},
        {"order": 2, "user_edited_fields": ["trigger"]},
        {"order": 3, "user_edited_fields": ["motivation", "emotion_shift"]},
    ]
    job = {
        "_id": job_oid,
        "scenes": scenes,
        "scenario_events": events,
        "scenario_user_edited_fields": ["narrative", "events"],
        "scenario_narrative": "x" * 200,
    }
    return job, FakeMongoDB(FakeMVJobsCollection([job]))


# ─── T1 — _v54_is_field_user_edited 단위 ────────────────────────────────────


def test_t1_v54_is_field_user_edited_scene_true():
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "scene", 1, "description") is True
    assert _v54_is_field_user_edited(job, "scene", 2, "image_prompt") is True
    assert _v54_is_field_user_edited(job, "scene", 2, "video_prompt") is True


def test_t1_v54_is_field_user_edited_scene_false():
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "scene", 0, "description") is False
    assert _v54_is_field_user_edited(job, "scene", 1, "image_prompt") is False  # 씬1엔 image_prompt 편집 X


def test_t1_v54_is_field_user_edited_event():
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "event", 1, "trigger") is True
    assert _v54_is_field_user_edited(job, "event", 2, "motivation") is True
    assert _v54_is_field_user_edited(job, "event", 1, "motivation") is False


def test_t1_v54_is_field_user_edited_scenario():
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "scenario", None, "narrative") is True
    assert _v54_is_field_user_edited(job, "scenario", None, "events") is True
    assert _v54_is_field_user_edited(job, "scenario", None, "premise") is False


def test_t1_v54_old_doc_returns_false():
    """옛 도큐먼트 (user_edited_fields 키 누락) → 모든 케이스 False."""
    from app.services.mv_pipeline import _v54_is_field_user_edited
    old_job = {"_id": "old", "scenes": [{"scene_number": 1}], "scenario_events": [{"order": 1}]}
    assert _v54_is_field_user_edited(old_job, "scene", 0, "description") is False
    assert _v54_is_field_user_edited(old_job, "event", 0, "trigger") is False
    assert _v54_is_field_user_edited(old_job, "scenario", None, "narrative") is False


def test_t1_v54_out_of_range_returns_false():
    """target 범위 초과 → False (안전)."""
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "scene", 999, "description") is False
    assert _v54_is_field_user_edited(job, "event", -1, "trigger") is False
    assert _v54_is_field_user_edited(job, "scene", None, "description") is False


def test_t1_v54_invalid_scope_returns_false():
    """알 수 없는 scope → False."""
    from app.services.mv_pipeline import _v54_is_field_user_edited
    job, _ = make_v54_baseline()
    assert _v54_is_field_user_edited(job, "garbage", 0, "x") is False
    assert _v54_is_field_user_edited({}, "scene", 0, "x") is False
    assert _v54_is_field_user_edited(None, "scene", 0, "x") is False  # type: ignore


# ─── T2 — v51/v52/v53 cascade 헬퍼 일관성 (회귀) ─────────────────────────────


def test_t2_v51_is_user_edited_uses_v54_helper():
    """`_v51_is_user_edited` 가 `_v54_is_field_user_edited` 결과와 동일."""
    from app.services.mv_pipeline import _v51_is_user_edited, _v54_is_field_user_edited

    job, fake_db = make_v54_baseline()

    # v51 wrapper 호출 결과는 통합 헬퍼와 동일해야 함
    async def run():
        a = await _v51_is_user_edited(fake_db, "job_v54", 2, "image_prompt")
        b = _v54_is_field_user_edited(job, "scene", 2, "image_prompt")
        return a, b

    a, b = asyncio.run(run())
    assert a is True
    assert b is True
    assert a == b


def test_t2_v51_wrapper_old_doc_safe():
    """`_v51_is_user_edited` 옛 도큐먼트 (user_edited_fields 누락) → False."""
    from app.services.mv_pipeline import _v51_is_user_edited
    old_job = {"_id": "old", "scenes": [{"scene_number": 1}]}
    fake_db = FakeMongoDB(FakeMVJobsCollection([old_job]))

    async def run():
        return await _v51_is_user_edited(fake_db, "old", 0, "description")
    assert asyncio.run(run()) is False


# ─── T3, T4 — 라우트 단위 테스트는 FastAPI 라우트의 함수 직접 호출 ──────────


def _make_fake_route_deps(job):
    """라우트 함수가 사용하는 get_mongo / get_current_user 를 monkeypatch 위한 helpers."""
    fake_db = FakeMongoDB(FakeMVJobsCollection([job]))
    return fake_db


def _make_full_baseline_for_routes():
    """라우트 테스트용 — _id 는 ObjectId 호환 형태."""
    from bson import ObjectId
    oid = ObjectId()
    job = {
        "_id": oid,
        "user_id": "user_v54",
        "scenes": [
            {"scene_number": 1, "user_edited_fields": []},
            {"scene_number": 2, "user_edited_fields": ["description"]},
            {"scene_number": 3, "user_edited_fields": ["image_prompt", "video_prompt"]},
        ],
        "scenario_events": [
            {"order": 1, "user_edited_fields": []},
            {"order": 2, "user_edited_fields": ["trigger"]},
            {"order": 3, "user_edited_fields": ["motivation", "emotion_shift"]},
        ],
        "scenario_user_edited_fields": ["narrative", "events"],
    }
    return oid, job


def test_t3_reset_scope_all():
    """scope=all → 모든 레벨 일괄 해제."""
    from app.routes.mv import reset_user_edits, UserEditedResetRequest
    from bson import ObjectId

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)

    # 사용자 (ownership) 우회 — _get_job_with_ownership 가 user_id 비교
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="all")
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    # cleared = scenario(2) + event2(1) + event3(2) + scene2(1) + scene3(2) = 8
    assert result == {"cleared": 8}
    assert job["scenario_user_edited_fields"] == []
    assert job["scenes"][1]["user_edited_fields"] == []
    assert job["scenes"][2]["user_edited_fields"] == []
    assert job["scenario_events"][1]["user_edited_fields"] == []
    assert job["scenario_events"][2]["user_edited_fields"] == []


def test_t3_reset_scope_scene_partial():
    """scope=scene + target=3 + fields=["image_prompt"] → 씬 3 의 image_prompt 만 해제."""
    from app.routes.mv import reset_user_edits, UserEditedResetRequest

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="scene", target=3, fields=["image_prompt"])
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    assert result == {"cleared": 1}
    assert job["scenes"][2]["user_edited_fields"] == ["video_prompt"]


def test_t3_reset_scope_event_full():
    """scope=event + target=3 (no fields) → event 3 통째 해제."""
    from app.routes.mv import reset_user_edits, UserEditedResetRequest

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="event", target=3)
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    assert result == {"cleared": 2}
    assert job["scenario_events"][2]["user_edited_fields"] == []


def test_t3_reset_scope_scenario_partial():
    """scope=scenario + fields=["narrative"] → narrative 만 해제, events 보존."""
    from app.routes.mv import reset_user_edits, UserEditedResetRequest

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="scenario", fields=["narrative"])
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    assert result == {"cleared": 1}
    assert job["scenario_user_edited_fields"] == ["events"]


def test_t3_reset_old_doc_zero():
    """옛 도큐먼트 (모든 키 누락) → 200 + cleared=0."""
    from bson import ObjectId
    from app.routes.mv import reset_user_edits, UserEditedResetRequest

    oid = ObjectId()
    old_job = {"_id": oid, "user_id": "user_v54"}
    fake_db = _make_fake_route_deps(old_job)
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="all")
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    assert result == {"cleared": 0}


def test_t3_reset_scene_not_found():
    """scope=scene + target=999 → 404."""
    from fastapi.responses import JSONResponse
    from app.routes.mv import reset_user_edits, UserEditedResetRequest

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    body = UserEditedResetRequest(scope="scene", target=999)
    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(reset_user_edits(str(oid), body, current_user=user))

    assert isinstance(result, JSONResponse)
    assert result.status_code == 404


def test_t4_summary_full():
    """3 레벨 모두 일부 편집된 도큐먼트 → 정확한 dict 반환."""
    from app.routes.mv import get_user_edited_summary

    oid, job = _make_full_baseline_for_routes()
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(get_user_edited_summary(str(oid), current_user=user))

    assert result["scenario"] == ["narrative", "events"]
    # event order=1 은 비어 있어 dict 에 포함되지 X
    assert "1" not in result["events"]
    assert result["events"]["2"] == ["trigger"]
    assert result["events"]["3"] == ["motivation", "emotion_shift"]
    assert "1" not in result["scenes"]
    assert result["scenes"]["2"] == ["description"]
    assert result["scenes"]["3"] == ["image_prompt", "video_prompt"]


def test_t4_summary_empty_doc():
    """빈 도큐먼트 (모든 user_edited_fields = []) → 빈 list/dict + 200."""
    from bson import ObjectId
    from app.routes.mv import get_user_edited_summary

    oid = ObjectId()
    job = {
        "_id": oid, "user_id": "user_v54",
        "scenes": [{"scene_number": 1, "user_edited_fields": []}],
        "scenario_events": [{"order": 1, "user_edited_fields": []}],
        "scenario_user_edited_fields": [],
    }
    fake_db = _make_fake_route_deps(job)
    user = {"id": "user_v54"}

    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(get_user_edited_summary(str(oid), current_user=user))

    assert result == {"scenario": [], "events": {}, "scenes": {}}


def test_t4_summary_old_doc():
    """옛 도큐먼트 (모든 키 누락) → 빈 list/dict + 200."""
    from bson import ObjectId
    from app.routes.mv import get_user_edited_summary

    oid = ObjectId()
    old_job = {"_id": oid, "user_id": "user_v54"}
    fake_db = _make_fake_route_deps(old_job)
    user = {"id": "user_v54"}

    with patch("app.routes.mv.get_mongo", return_value=fake_db):
        result = asyncio.run(get_user_edited_summary(str(oid), current_user=user))

    assert result == {"scenario": [], "events": {}, "scenes": {}}


# ─── T7 — 회귀: v51/v52/v53 동작 변경 X ──────────────────────────────────────


def test_t7_regression_v51_helper_still_works():
    """v51 _v51_is_user_edited wrapper 가 통합 헬퍼 위임 후에도 동일 결과."""
    from app.services.mv_pipeline import _v51_is_user_edited

    job = {
        "_id": "j",
        "scenes": [{"scene_number": 1, "user_edited_fields": ["description"]}],
    }
    fake_db = FakeMongoDB(FakeMVJobsCollection([job]))

    async def run():
        return (
            await _v51_is_user_edited(fake_db, "j", 0, "description"),
            await _v51_is_user_edited(fake_db, "j", 0, "image_prompt"),
        )

    a, b = asyncio.run(run())
    assert a is True
    assert b is False


def test_t7_regression_module_imports():
    """v51/v52/v53 cascade 헬퍼 모듈 import 정상 (회귀 차단)."""
    from app.services.mv_pipeline import (
        _v51_run_cascade,
        _v52_event_cascade,
        _v53_full_cascade,
        _v54_is_field_user_edited,
    )
    assert callable(_v51_run_cascade)
    assert callable(_v52_event_cascade)
    assert callable(_v53_full_cascade)
    assert callable(_v54_is_field_user_edited)


def test_t7_regression_routes_module():
    """v54 신규 라우트 함수 import + UserEditedResetRequest 모델 정상."""
    from app.routes.mv import reset_user_edits, get_user_edited_summary, UserEditedResetRequest
    assert callable(reset_user_edits)
    assert callable(get_user_edited_summary)
    # Pydantic 모델 — scope 필수
    body = UserEditedResetRequest(scope="all")
    assert body.scope == "all"
    assert body.target is None
    assert body.fields is None
