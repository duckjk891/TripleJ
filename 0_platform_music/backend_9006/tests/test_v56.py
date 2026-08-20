"""v56 — 씬 한국어/영어 병존 + Opus 4.7 자동 번역 cascade 테스트.

T1 — 씬 분할 LLM system prompt 6 필드 schema 확인 + v50.1 sentinel 보존.
T2 — 파서 단위 (legacy + section-aware): _ko 필드 누락 시 빈 문자열 백필.
T3 — translation.py 단위: ko↔en, 빈 입력 패스, 1회 retry, 실패 시 빈 문자열.
T4 — cascade 흐름 (mocked translate): _ko trigger → translate_to_en phase → 영어 cascade.
T5 — lazy 번역: 옛 잡 GET → 빈 _ko 자동 채움 + Mongo $set (mocked translate).
T6 — frontend 변경 — 정적 검증 (UploadPage.jsx 에 한국어 textarea + 영어 details + scene_ko log).
T7 — 회귀: v50/v50.1 sentinel 키워드 보존, v51~v55 cascade 무회귀.
"""

import asyncio
import inspect
from unittest.mock import AsyncMock, patch

import pytest


# ── T1: Scene-split system prompts include 6 fields & v50/v50.1 sentinels ───


def test_t1_scene_generate_prompt_includes_image_prompt_ko():
    from app.services.mv_generator import SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE
    assert "image_prompt_ko" in SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE
    assert "video_prompt_ko" in SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE
    assert "description_ko" in SCENE_GENERATE_SYSTEM_PROMPT_TEMPLATE


def test_t1_scene_split_prompt_includes_image_prompt_ko():
    from app.services.mv_generator import SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE
    assert "image_prompt_ko" in SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE
    assert "video_prompt_ko" in SCENE_SPLIT_SYSTEM_PROMPT_TEMPLATE


def test_t1_section_scene_plan_prompt_includes_image_prompt_ko():
    from app.services.mv_generator import SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE
    assert "image_prompt_ko" in SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE
    assert "video_prompt_ko" in SECTION_SCENE_PLAN_SYSTEM_PROMPT_TEMPLATE


def test_t1_v50_1_anti_example_sentinel_preserved():
    """v50/v50.1 ANTI_EXAMPLE_BLOCK + 군중 인물 차단 단락 보존 확인."""
    from app.services import mv_generator as mg
    src = inspect.getsource(mg)
    # v50.1 — 군중 인물 임의 등장 금지 단락 존재
    assert "v50.1" in src and "군중 인물" in src
    # ANTI_EXAMPLE_BLOCK 변수 존재
    assert "ANTI_EXAMPLE_BLOCK" in src


def test_t1_scene_prompt_only_template_includes_image_prompt_ko():
    """Phase 1b LLM (`SCENE_PROMPT_ONLY_SYSTEM`) 도 image_prompt_ko 추가 확인."""
    from app.services.mv_generator import SCENE_PROMPT_ONLY_SYSTEM
    assert "image_prompt_ko" in SCENE_PROMPT_ONLY_SYSTEM


# ── T2: Parser backfills missing _ko fields ──────────────────────────────────


def test_t2_legacy_parser_backfills_missing_ko_fields():
    """split_lyrics_into_scenes 의 legacy path 출력에서 _ko 누락 시 빈 문자열 백필."""
    from app.services import mv_generator as mg

    fake_scenes_raw = (
        "["
        "{\"scene_number\": 1, \"scene_type\": \"drama\", "
        "\"image_prompt\": \"English IP\", \"video_prompt\": \"English VP\", "
        "\"description_ko\": \"설명\", \"lyrics_segment\": \"\"}"
        "]"
    )

    class FakeMsg:
        def __init__(self, content): self.content = content

    class FakeChoice:
        def __init__(self, content): self.message = FakeMsg(content)

    class FakeResponse:
        def __init__(self, content): self.choices = [FakeChoice(content)]

    fake_client = type("FakeClient", (), {})()
    fake_client.chat = type("X", (), {})()
    fake_client.chat.completions = type("Y", (), {})()

    async def fake_create(*args, **kwargs):
        return FakeResponse(fake_scenes_raw)

    fake_client.chat.completions.create = fake_create

    async def run():
        with patch.object(mg, "_get_openai_client", return_value=fake_client):
            scenes = await mg.split_lyrics_into_scenes(
                lyrics="dummy lyrics line 1\nline 2",
                title="T",
                genre="Pop",
                mood="bright",
                scene_count=1,
                music_sections=None,
            )
            assert isinstance(scenes, list) and len(scenes) == 1
            # _ko 누락 필드는 빈 문자열로 백필되어야 함
            assert scenes[0]["image_prompt_ko"] == ""
            assert scenes[0]["video_prompt_ko"] == ""
            # 영어 / description_ko 는 보존
            assert scenes[0]["image_prompt"] == "English IP"
            assert scenes[0]["video_prompt"] == "English VP"
            assert scenes[0]["description_ko"] == "설명"

    asyncio.run(run())


def test_t2_section_aware_parser_backfills_and_keeps_provided():
    """section-aware planner: image_prompt_ko 제공 / video_prompt_ko 미제공 케이스."""
    from app.services import mv_generator as mg

    fake_plans_raw = (
        "["
        "{\"section\": \"Verse\", \"section_start\": 0.0, \"section_end\": 10.0, "
        "\"section_mood\": \"\", "
        "\"clips\": [{"
        "\"clip_number\": 1, \"use_seconds\": 10.0, "
        "\"image_prompt\": \"english IP\", \"video_prompt\": \"english VP\", "
        "\"description_ko\": \"한글\", \"image_prompt_ko\": \"한글 IP\", "
        "\"lyrics_segment\": \"\", \"mood\": \"\", \"scene_type\": \"drama\""
        "}]}"
        "]"
    )

    class FakeMsg:
        def __init__(self, content): self.content = content

    class FakeChoice:
        def __init__(self, content): self.message = FakeMsg(content)

    class FakeResponse:
        def __init__(self, content): self.choices = [FakeChoice(content)]

    fake_client = type("FakeClient", (), {})()
    fake_client.chat = type("X", (), {})()
    fake_client.chat.completions = type("Y", (), {})()

    async def fake_create(*args, **kwargs):
        return FakeResponse(fake_plans_raw)

    fake_client.chat.completions.create = fake_create

    async def run():
        with patch.object(mg, "_get_openai_client", return_value=fake_client):
            scenes = await mg.split_lyrics_into_scenes(
                lyrics="",
                title="T",
                genre=None,
                mood=None,
                scene_count=1,
                music_sections=[{"section": "Verse", "start": 0.0, "end": 10.0, "mood": ""}],
            )
            assert len(scenes) == 1
            s = scenes[0]
            # 제공된 image_prompt_ko 보존
            assert s["image_prompt_ko"] == "한글 IP"
            # 누락된 video_prompt_ko 는 빈 문자열로 백필
            assert s["video_prompt_ko"] == ""
            assert s["description_ko"] == "한글"

    asyncio.run(run())


# ── T3: translation.py unit tests ────────────────────────────────────────────


def test_t3_translate_empty_input_returns_empty_without_llm_call():
    """빈 입력 (None / 빈 / 공백만) → 빈 출력 + LLM 호출 X (비용 0)."""
    from app.services import translation

    async def run():
        with patch.object(
            translation, "_get_anthropic_client_for_translation"
        ) as mock_client:
            assert await translation.translate_ko_to_en("") == ""
            assert await translation.translate_ko_to_en("   ") == ""
            assert await translation.translate_ko_to_en(None) == ""
            assert await translation.translate_en_to_ko("") == ""
            mock_client.assert_not_called()

    asyncio.run(run())


def test_t3_translate_ko_to_en_success_strips_codefence():
    """성공 시 응답 strip + 마크다운 코드펜스 제거."""
    from app.services import translation

    async def run():
        # Anthropic 응답 흉내: messages.create() 가 .content[0].text 반환
        fake_resp_block = type("Block", (), {"text": "```\nEnglish out\n```"})()
        fake_resp = type("Resp", (), {"content": [fake_resp_block]})()

        fake_client = type("C", (), {})()
        fake_client.messages = type("M", (), {})()
        fake_client.messages.create = AsyncMock(return_value=fake_resp)

        with patch.object(
            translation, "_get_anthropic_client_for_translation", return_value=fake_client,
        ):
            out = await translation.translate_ko_to_en("한국어 입력")
            assert out == "English out"
            assert fake_client.messages.create.called

    asyncio.run(run())


def test_t3_translate_retry_once_then_success():
    """첫 호출 실패 → 1회 retry → 성공."""
    from app.services import translation

    async def run():
        fake_resp_block = type("Block", (), {"text": "Korean out"})()
        fake_resp = type("Resp", (), {"content": [fake_resp_block]})()

        fake_client = type("C", (), {})()
        fake_client.messages = type("M", (), {})()
        call_count = {"n": 0}

        async def flaky(**kw):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("simulated transient")
            return fake_resp

        fake_client.messages.create = flaky

        with patch.object(
            translation, "_get_anthropic_client_for_translation", return_value=fake_client,
        ):
            out = await translation.translate_en_to_ko("english input")
            assert out == "Korean out"
            assert call_count["n"] == 2

    asyncio.run(run())


def test_t3_translate_both_attempts_fail_returns_empty_string():
    """두 번 모두 실패 → 빈 문자열 반환 (호출자가 폴백)."""
    from app.services import translation

    async def run():
        fake_client = type("C", (), {})()
        fake_client.messages = type("M", (), {})()

        async def always_fail(**kw):
            raise RuntimeError("network down")

        fake_client.messages.create = always_fail

        with patch.object(
            translation, "_get_anthropic_client_for_translation", return_value=fake_client,
        ):
            out = await translation.translate_ko_to_en("한국어")
            assert out == ""

    asyncio.run(run())


def test_t3_translation_model_id_is_opus_4_7():
    """모델 ID 가 사용자가 결정한 claude-opus-4-7 인지 확인."""
    from app.services.translation import TRANSLATION_MODEL_ID
    assert TRANSLATION_MODEL_ID == "claude-opus-4-7"


# ── T4: Cascade _ko trigger flow ─────────────────────────────────────────────


def test_t4_cascade_image_prompt_ko_triggers_translate_then_english_cascade():
    """trigger_field=image_prompt_ko → translate_image_prompt_to_en phase →
    이후 영어 image_prompt cascade (phase2 → phase2.5) 로 위임."""
    from app.services import mv_pipeline as mp

    # In-memory scene store (단일 씬)
    scene = {
        "scene_number": 1,
        "image_prompt": "old en",
        "image_prompt_ko": "새 한글 이미지",
        "video_prompt": "vp en",
        "video_prompt_ko": "vp ko",
        "description": "old desc",
        "description_ko": "old desc ko",
        "user_edited_fields": ["image_prompt_ko"],
    }
    job_doc = {"_id": "job123", "scenes": [scene]}

    captured_writes = []

    async def fake_get_scene_idx(mongo_db, oid, sn):
        return 0 if sn == 1 else None

    async def fake_get_scene(mongo_db, oid, idx):
        return job_doc["scenes"][idx]

    async def fake_set_fields(mongo_db, oid, idx, fields):
        captured_writes.append(dict(fields))
        for k, v in fields.items():
            job_doc["scenes"][idx][k] = v

    async def fake_remove_edited(mongo_db, oid, idx, field):
        cur = list(job_doc["scenes"][idx].get("user_edited_fields") or [])
        if field in cur:
            cur = [f for f in cur if f != field]
            job_doc["scenes"][idx]["user_edited_fields"] = cur

    async def fake_check_cancel(mongo_db, oid, idx):
        return False

    async def fake_translate_ko_en(text, context_hint="visual/video prompt"):
        return "TRANSLATED:" + (text or "")

    # phase2 / phase2.5 / invalidate_video 는 noop 으로 mock
    async def fake_run_phase2_images(*args, **kwargs):
        return None

    async def fake_invalidate_video(*args, **kwargs):
        return None

    async def fake_get_job(*args, **kwargs):
        return job_doc

    # _v51_is_user_edited 도 정확한 값 반환 (image_prompt_ko cascade 진입 시점에서
    # video_prompt 는 사용자 편집 X, image_prompt 는 사용자 편집 X — 자동 재생성 허용)
    async def fake_is_user_edited(mongo_db, oid, idx, field):
        return field in (job_doc["scenes"][idx].get("user_edited_fields") or [])

    async def fake_regen_video_prompt_single(job, idx):
        return None  # phase2.5 not exercised in this single test (LLM mocked)

    async def run():
        from app.services import translation
        with patch.object(mp, "_v51_get_scene_idx", new=fake_get_scene_idx), \
             patch.object(mp, "_v51_get_scene", new=fake_get_scene), \
             patch.object(mp, "_v51_set_scene_fields", new=fake_set_fields), \
             patch.object(mp, "_v51_remove_user_edited_field", new=fake_remove_edited), \
             patch.object(mp, "_v51_check_cancel", new=fake_check_cancel), \
             patch.object(mp, "_v51_invalidate_video", new=fake_invalidate_video), \
             patch.object(mp, "_v51_is_user_edited", new=fake_is_user_edited), \
             patch.object(mp, "_get_job", new=fake_get_job), \
             patch.object(mp, "run_phase2_images", new=fake_run_phase2_images), \
             patch.object(mp, "_v51_regen_video_prompt_single", new=fake_regen_video_prompt_single), \
             patch.object(translation, "translate_ko_to_en", new=fake_translate_ko_en), \
             patch.object(translation, "translate_en_to_ko", new=AsyncMock(return_value="")):
            await mp._v51_run_cascade("job123", 1, mongo_db=None, trigger_field="image_prompt_ko")

        # image_prompt 가 번역된 영어로 갱신되었는지 확인
        assert job_doc["scenes"][0]["image_prompt"] == "TRANSLATED:새 한글 이미지"
        # cascade 완료 마킹
        all_writes_merged = {}
        for w in captured_writes:
            all_writes_merged.update(w)
        assert all_writes_merged.get("cascade_status") == "completed"

    asyncio.run(run())


def test_t4_cascade_video_prompt_ko_terminates_after_translate():
    """trigger_field=video_prompt_ko → translate phase 만 실행 → 즉시 completed."""
    from app.services import mv_pipeline as mp

    scene = {
        "scene_number": 1,
        "video_prompt": "old en vp",
        "video_prompt_ko": "새 한국 비디오 프롬프트",
        "user_edited_fields": ["video_prompt_ko"],
    }
    job_doc = {"_id": "j", "scenes": [scene]}

    async def fake_get_scene_idx(*a, **k): return 0
    async def fake_get_scene(*a, **k): return job_doc["scenes"][0]
    async def fake_set_fields(mongo_db, oid, idx, fields):
        for k, v in fields.items():
            job_doc["scenes"][idx][k] = v
    async def fake_remove_edited(*a, **k): return None
    async def fake_translate_ko_en(text, **kw): return "EN:" + text

    async def run():
        from app.services import translation
        with patch.object(mp, "_v51_get_scene_idx", new=fake_get_scene_idx), \
             patch.object(mp, "_v51_get_scene", new=fake_get_scene), \
             patch.object(mp, "_v51_set_scene_fields", new=fake_set_fields), \
             patch.object(mp, "_v51_remove_user_edited_field", new=fake_remove_edited), \
             patch.object(translation, "translate_ko_to_en", new=fake_translate_ko_en):
            await mp._v51_run_cascade("j", 1, mongo_db=None, trigger_field="video_prompt_ko")

        assert job_doc["scenes"][0]["video_prompt"] == "EN:새 한국 비디오 프롬프트"
        assert job_doc["scenes"][0]["cascade_status"] == "completed"

    asyncio.run(run())


# ── T5: GET lazy translation ─────────────────────────────────────────────────


def test_t5_lazy_translate_fills_missing_ko_and_persists():
    """GET 시점 lazy 번역: 빈 _ko + 영어 채워짐 → 자동 ko 채움 + Mongo $set."""
    from app.routes import mv as mv_route

    # In-memory mongo mock
    written = []

    class FakeColl:
        async def update_one(self, q, u):
            written.append(u)

    class FakeMongo:
        def __init__(self):
            self.mv_jobs = FakeColl()

    fake_mongo = FakeMongo()

    scenes = [
        {
            "scene_number": 1,
            "image_prompt": "english IP",
            "image_prompt_ko": "",  # 빈 ko → lazy 번역 대상
            "video_prompt": "english VP",
            "video_prompt_ko": "",  # 빈 ko → lazy 번역 대상
            "description": "english desc",
            "description_ko": "기존 한글 설명",  # 채워짐 → skip
        },
    ]

    async def fake_en_to_ko(text, ctx=""): return "ko[" + text + "]"
    async def fake_ko_to_en(text, ctx=""): return "en[" + text + "]"

    async def run():
        from app.services import translation as t
        with patch.object(t, "translate_en_to_ko", new=fake_en_to_ko), \
             patch.object(t, "translate_ko_to_en", new=fake_ko_to_en):
            await mv_route._v56_lazy_translate_scenes(fake_mongo, "fake_oid", scenes)

        # Both empty _ko fields should be filled.
        assert scenes[0]["image_prompt_ko"] == "ko[english IP]"
        assert scenes[0]["video_prompt_ko"] == "ko[english VP]"
        # description_ko was already filled → preserved
        assert scenes[0]["description_ko"] == "기존 한글 설명"
        # Mongo persistence happened
        assert len(written) >= 1

    asyncio.run(run())


def test_t5_lazy_translate_caches_when_both_filled():
    """양쪽 모두 채워진 씬은 LLM 호출 없이 패스 (캐시)."""
    from app.routes import mv as mv_route

    class FakeColl:
        async def update_one(self, q, u): pass

    class FakeMongo:
        def __init__(self): self.mv_jobs = FakeColl()

    scenes = [{
        "scene_number": 1,
        "image_prompt": "en",
        "image_prompt_ko": "한",
        "video_prompt": "en2",
        "video_prompt_ko": "한2",
        "description": "en3",
        "description_ko": "한3",
    }]

    en_ko_calls = {"n": 0}
    ko_en_calls = {"n": 0}

    async def fake_en_to_ko(text, ctx=""):
        en_ko_calls["n"] += 1
        return "ko_out"

    async def fake_ko_to_en(text, ctx=""):
        ko_en_calls["n"] += 1
        return "en_out"

    async def run():
        from app.services import translation as t
        with patch.object(t, "translate_en_to_ko", new=fake_en_to_ko), \
             patch.object(t, "translate_ko_to_en", new=fake_ko_to_en):
            await mv_route._v56_lazy_translate_scenes(FakeMongo(), "oid", scenes)

        # No translation calls should fire
        assert en_ko_calls["n"] == 0
        assert ko_en_calls["n"] == 0

    asyncio.run(run())


def test_t5_lazy_translate_skips_both_empty():
    """양쪽 모두 빈 값 → 둘 다 빈 채로 유지 (할 일 없음)."""
    from app.routes import mv as mv_route

    class FakeColl:
        async def update_one(self, q, u): pass

    class FakeMongo:
        def __init__(self): self.mv_jobs = FakeColl()

    scenes = [{
        "scene_number": 1,
        "image_prompt": "",
        "image_prompt_ko": "",
        "video_prompt": "",
        "video_prompt_ko": "",
        "description": "",
        "description_ko": "",
    }]

    async def fake_en_to_ko(text, ctx=""): return "should_not_fire"
    async def fake_ko_to_en(text, ctx=""): return "should_not_fire"

    async def run():
        from app.services import translation as t
        with patch.object(t, "translate_en_to_ko", new=fake_en_to_ko), \
             patch.object(t, "translate_ko_to_en", new=fake_ko_to_en):
            await mv_route._v56_lazy_translate_scenes(FakeMongo(), "oid", scenes)
        # 빈 채로 유지 — 둘 다 LLM 입력이 빈 문자열이라 호출 자체 안 됨.
        assert scenes[0]["image_prompt_ko"] == ""
        assert scenes[0]["image_prompt"] == ""

    asyncio.run(run())


# ── T6: Frontend static checks ───────────────────────────────────────────────


def test_t6_uploadpage_has_korean_textarea_and_english_collapsible():
    """UploadPage.jsx 가 한국어 textarea (placeholder=한국어) + 영어 details collapsible 보유."""
    import pathlib
    fp = pathlib.Path(__file__).parent.parent.parent / "frontend" / "src" / "pages" / "UploadPage.jsx"
    src = fp.read_text(encoding="utf-8")
    # 한국어 편집 가능 마커
    assert "한국어로 입력하세요" in src or "한국어로 입력" in src
    # 영어 collapsible <details>
    assert "<details" in src and "영어 보기" in src
    # ko trigger 호출 가능성 (handleSceneEditSave 가 ko field 도 받도록)
    assert "scene_ko field edited" in src
    # renderField 가 ko + en 두 인자 받는 패턴
    assert "description_ko" in src
    assert "image_prompt_ko" in src
    assert "video_prompt_ko" in src


def test_t6_api_patchmv_scene_passes_payload_spread():
    """api/index.js 의 patchMVScene 가 spread payload 패턴 — ko 키 추가 자동 통과."""
    import pathlib
    fp = pathlib.Path(__file__).parent.parent.parent / "frontend" / "src" / "api" / "index.js"
    src = fp.read_text(encoding="utf-8")
    # patchMVScene 헬퍼가 payload 를 그대로 전달
    assert "patchMVScene" in src
    # payload 를 spread 가 아닌 객체로 통째 전달하는 것도 OK — body 전체가 객체로 전달되는지
    assert "patchMVScene = (jobId, sceneNumber, payload)" in src
    assert ".patch(`/mv/jobs/${jobId}/scenes/${sceneNumber}`, payload)" in src


# ── T7: Regression ───────────────────────────────────────────────────────────


def test_t7_v51_cascade_english_trigger_unchanged():
    """trigger_field='image_prompt' (영어) 시 기존 cascade flow 진입 동일 (byte-level
    동일은 아니나, 영어 cascade 진입 시 description_ko 같은 ko 트리거 분기로 빠지지 않음)."""
    from app.services import mv_pipeline as mp
    src = inspect.getsource(mp._v51_run_cascade)
    # 신규 분기는 ko trigger 만 처리 — 영어 trigger 흐름은 보존
    assert "_V56_KO_TRIGGERS" in src
    # description / image_prompt / video_prompt 영어 branch 가 그대로 존재
    assert "phase=video_prompt_noop" in src
    assert "phase=phase1b_skip_user_edited" in src or "phase=phase1b_enter" in src


def test_t7_patch_scene_request_pydantic_six_fields():
    """PatchSceneRequest 가 6 필드 (en + ko) 모두 Optional 보유."""
    from app.routes.mv import PatchSceneRequest
    fields = PatchSceneRequest.__fields__.keys()
    for k in ("description", "image_prompt", "video_prompt",
              "description_ko", "image_prompt_ko", "video_prompt_ko"):
        assert k in fields, "missing: {}".format(k)


def test_t7_cascade_regenerate_trigger_field_allows_ko_variants():
    """cascade-regenerate 라우트의 trigger_field 가드 가 ko 변형 허용."""
    import pathlib
    fp = pathlib.Path(__file__).parent.parent / "app" / "routes" / "mv.py"
    src = fp.read_text(encoding="utf-8")
    assert "_ALLOWED_TRIGGERS" in src
    assert "image_prompt_ko" in src
    assert "video_prompt_ko" in src
    assert "description_ko" in src


def test_t7_scene_to_dict_returns_six_fields():
    """_scene_to_dict 응답에 6 필드 모두 포함."""
    from app.routes.mv import _scene_to_dict
    out = _scene_to_dict({
        "scene_number": 1,
        "description": "d",
        "image_prompt": "ip",
        "video_prompt": "vp",
        "description_ko": "d_ko",
        "image_prompt_ko": "ip_ko",
        "video_prompt_ko": "vp_ko",
    })
    assert out["description"] == "d"
    assert out["image_prompt"] == "ip"
    assert out["video_prompt"] == "vp"
    assert out["description_ko"] == "d_ko"
    assert out["image_prompt_ko"] == "ip_ko"
    assert out["video_prompt_ko"] == "vp_ko"


def test_t7_scene_to_dict_old_doc_ko_fields_default_empty():
    """옛 잡 (image_prompt_ko / video_prompt_ko 누락) → 빈 문자열 default."""
    from app.routes.mv import _scene_to_dict
    out = _scene_to_dict({
        "scene_number": 5,
        "description": "d",
        "image_prompt": "ip",
        "video_prompt": "vp",
        # description_ko / image_prompt_ko / video_prompt_ko 누락
    })
    assert out["description_ko"] == ""
    assert out["image_prompt_ko"] == ""
    assert out["video_prompt_ko"] == ""


def test_t7_translation_module_independent_of_anthropic_call():
    """translation.py 가 mv_generator import cycle 없이 standalone 로드 가능."""
    import importlib
    m = importlib.import_module("app.services.translation")
    assert hasattr(m, "translate_ko_to_en")
    assert hasattr(m, "translate_en_to_ko")
    assert hasattr(m, "TRANSLATION_MODEL_ID")
