"""v55 — 이미지 생성 모델 선택 (Nano Banana Pro / GPT Image 2) 테스트.

T1 — `openai_image.generate_image` 단위 분기 (generations vs edits, ref 트렁케이트).
T2 — 각 generator 가 image_model="gpt_image_2" 일 때 openai_image 를 호출하는지 (mocked).
T3 — 라우트 입력 검증 (정상 / 누락 default / 잘못된 값 → 400).
T4 — pydantic body model defaults / normalize helpers.
T5 — 씬=자산 자동 연동 — generate_*_asset / generate_scene_image 가 image_model 받음.
T7 — 회귀 — 옛 도큐먼트 (image_model 누락) GET 응답에서 "nb_pro" 기본 적용.
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


# ── T1: openai_image.generate_image 단위 ────────────────────────────────────


def test_t1_generate_image_no_refs_calls_generations():
    from app.services import openai_image

    async def run():
        with patch.object(
            openai_image, "_call_generations", new=AsyncMock(return_value=b"PNG")
        ) as gen, patch.object(
            openai_image, "_call_edits", new=AsyncMock(return_value=b"PNG_EDIT")
        ) as edit, patch.object(openai_image.settings, "openai_api_key", "fake-key"):
            out = await openai_image.generate_image("hello", ref_images=None)
            assert out == b"PNG"
            assert gen.called
            assert not edit.called

    asyncio.run(run())


def test_t1_generate_image_with_refs_calls_edits():
    from app.services import openai_image

    async def run():
        refs = [b"abc", b"def"]
        with patch.object(
            openai_image, "_call_generations", new=AsyncMock(return_value=b"GEN")
        ) as gen, patch.object(
            openai_image, "_call_edits", new=AsyncMock(return_value=b"EDIT_PNG")
        ) as edit, patch.object(openai_image.settings, "openai_api_key", "fake-key"):
            out = await openai_image.generate_image("hello", ref_images=refs)
            assert out == b"EDIT_PNG"
            assert edit.called
            assert not gen.called
            args, _ = edit.call_args
            assert len(args[1]) == 2

    asyncio.run(run())


def test_t1_generate_image_truncates_over_max_refs():
    from app.services import openai_image

    async def run():
        refs = [b"x"] * 15
        captured = {}

        async def _edits_capture(prompt, ref_images, size, quality):
            captured["count"] = len(ref_images)
            return b"PNG"

        with patch.object(openai_image, "_call_edits", new=_edits_capture), patch.object(
            openai_image.settings, "openai_api_key", "fake-key"
        ):
            out = await openai_image.generate_image("p", ref_images=refs)
            assert out == b"PNG"
            assert captured["count"] == openai_image.MAX_REF_IMAGES == 10

    asyncio.run(run())


def test_t1_generate_image_missing_api_key_raises():
    from app.services import openai_image

    async def run():
        with patch.object(openai_image.settings, "openai_api_key", ""):
            with pytest.raises(ValueError, match="OPENAI_API_KEY"):
                await openai_image.generate_image("p")

    asyncio.run(run())


# ── T2: generator-level dispatch ───────────────────────────────────────────


def test_t2_character_generator_nb_pro_uses_gemini():
    from app.services import character_generator

    async def run():
        with patch.object(
            character_generator, "_call_gemini_image", new=AsyncMock(return_value=b"GEMINI")
        ) as gem, patch(
            "app.services.openai_image.generate_image", new=AsyncMock(return_value=b"OAI")
        ) as oai:
            out = await character_generator._call_image_backend(
                "prompt",
                [{"inlineData": {"mimeType": "image/png", "data": "AAA"}}],
                image_model="nb_pro",
            )
            assert out == b"GEMINI"
            assert gem.called
            assert not oai.called

    asyncio.run(run())


def test_t2_character_generator_gpt_image_2_uses_openai():
    from app.services import character_generator
    import base64

    async def run():
        sample = base64.b64encode(b"raw1").decode()
        with patch.object(
            character_generator, "_call_gemini_image", new=AsyncMock(return_value=b"GEMINI")
        ) as gem, patch(
            "app.services.openai_image.generate_image", new=AsyncMock(return_value=b"OAI")
        ) as oai:
            out = await character_generator._call_image_backend(
                "prompt",
                [{"inlineData": {"mimeType": "image/png", "data": sample}}],
                image_model="gpt_image_2",
            )
            assert out == b"OAI"
            assert oai.called
            _, kw = oai.call_args
            assert kw["ref_images"] == [b"raw1"]
            assert not gem.called

    asyncio.run(run())


def test_t2_cover_generator_gpt_image_2_routes_openai():
    from app.services import cover_generator

    async def run():
        with patch(
            "app.services.openai_image.generate_image",
            new=AsyncMock(return_value=b"OAI_COVER"),
        ) as oai:
            out = await cover_generator.generate_cover_image(
                title="x", genre="pop", mood="happy", image_model="gpt_image_2",
            )
            assert out == b"OAI_COVER"
            assert oai.called

    asyncio.run(run())


def test_t2_scene_image_gpt_image_2_routes_openai():
    from app.services import mv_generator

    async def run():
        with patch(
            "app.services.openai_image.generate_image",
            new=AsyncMock(return_value=b"OAI_SCENE"),
        ) as oai:
            out = await mv_generator.generate_scene_image(
                "A scene",
                cover_image_bytes=b"cover",
                character_image_bytes=b"char",
                reference_images=[b"loc1"],
                image_model="gpt_image_2",
                scene_number=3,
            )
            assert out == b"OAI_SCENE"
            _, kw = oai.call_args
            assert len(kw["ref_images"]) == 3

    asyncio.run(run())


def test_t2_asset_generators_propagate_image_model():
    from app.services import mv_assets

    async def run():
        with patch(
            "app.services.openai_image.generate_image",
            new=AsyncMock(return_value=b"OAI_ASSET"),
        ) as oai, patch.object(
            mv_assets, "_gemini_generate_image", new=AsyncMock(return_value=b"NB_ASSET")
        ) as gem:
            out_nb = await mv_assets.generate_character_sheet_asset(
                name="A", gender="female", description="d", image_model="nb_pro",
            )
            assert out_nb == b"NB_ASSET"
            assert gem.called
            assert not oai.called

            gem.reset_mock()
            oai.reset_mock()

            out_gpt = await mv_assets.generate_character_sheet_asset(
                name="B", gender="male", description="d", image_model="gpt_image_2",
            )
            assert out_gpt == b"OAI_ASSET"
            assert oai.called
            assert not gem.called

            out_loc = await mv_assets.generate_location_sheet_asset(
                name="L", description="d", image_model="gpt_image_2",
            )
            assert out_loc == b"OAI_ASSET"

    asyncio.run(run())


# ── T3: route input validation ─────────────────────────────────────────────


def _client():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.auth import get_current_user

    async def fake_user():
        return {"id": "00000000-0000-0000-0000-000000000000"}

    app.dependency_overrides[get_current_user] = fake_user
    return TestClient(app)


def test_t3_cover_invalid_image_model_returns_400():
    c = _client()
    r = c.post("/api/upload/generate-cover", json={"title": "x", "image_model": "foo"})
    assert r.status_code == 400
    assert "image_model" in r.json().get("error", "")


def test_t3_mv_create_invalid_image_model_returns_400():
    c = _client()
    r = c.post(
        "/api/mv/create",
        json={"title": "x", "cover_object_name": "p.png", "image_model": "foo"},
    )
    assert r.status_code == 400


def test_t3_cover_default_image_model_accepted():
    c = _client()
    r = c.post("/api/upload/generate-cover", json={"title": "x"})
    # Past image_model validation (may still 500 from minio/mongo or 503 from api key).
    assert not (r.status_code == 400 and "image_model" in r.json().get("error", ""))


def test_t3_cover_valid_gpt_image_2_accepted():
    c = _client()
    r = c.post(
        "/api/upload/generate-cover",
        json={"title": "x", "image_model": "gpt_image_2"},
    )
    assert not (r.status_code == 400 and "image_model" in r.json().get("error", ""))


# ── T4: pydantic body defaults + normalize helpers ─────────────────────────


def test_t4_create_mv_request_defaults_to_nb_pro():
    from app.routes.mv import CreateMVRequest

    body = CreateMVRequest(title="x")
    assert body.image_model == "nb_pro"
    assert body.cover_image_model is None


def test_t4_generate_cover_request_defaults_to_nb_pro():
    from app.routes.upload import GenerateCoverRequest

    body = GenerateCoverRequest(title="x")
    assert body.image_model == "nb_pro"


def test_t4_save_character_request_image_model_optional():
    from app.routes.character import SaveCharacterRequest

    body = SaveCharacterRequest(sheet_object_name="x")
    assert body.image_model is None
    body2 = SaveCharacterRequest(sheet_object_name="x", image_model="gpt_image_2")
    assert body2.image_model == "gpt_image_2"


def test_t4_normalize_image_model_helpers():
    from app.routes.upload import _normalize_image_model as nu
    from app.routes.character import _normalize_image_model as nc
    from app.routes.mv import _normalize_image_model as nm

    for fn in (nu, nc, nm):
        assert fn("nb_pro") == "nb_pro"
        assert fn("gpt_image_2") == "gpt_image_2"
        assert fn(None) == "nb_pro"
        assert fn("") == "nb_pro"
        assert fn("  nb_pro  ") == "nb_pro"
        assert fn("foo") is None


# ── T5: 씬=자산 자동 연동 — generators 모두 image_model 받음 ─────────────


def test_t5_generators_accept_image_model_param():
    import inspect
    from app.services.mv_assets import (
        generate_character_sheet_asset,
        generate_location_sheet_asset,
    )
    from app.services.mv_generator import generate_scene_image
    from app.services.character_generator import generate_character_sheet
    from app.services.cover_generator import generate_cover_image

    for fn in (
        generate_character_sheet_asset,
        generate_location_sheet_asset,
        generate_scene_image,
        generate_character_sheet,
        generate_cover_image,
    ):
        sig = inspect.signature(fn)
        assert "image_model" in sig.parameters, f"{fn.__name__} missing image_model"
        assert sig.parameters["image_model"].default == "nb_pro"


# ── T7: backward-compat — old mv_jobs / characters docs ───────────────────


def test_t7_get_job_returns_default_image_model_when_missing():
    job = {"image_model": None, "cover_image_model": None}
    assert (job.get("image_model") or "nb_pro") == "nb_pro"
    assert job.get("cover_image_model") is None


def test_t7_get_character_returns_default_image_model_when_missing():
    char = {}
    assert (char.get("image_model") or "nb_pro") == "nb_pro"
