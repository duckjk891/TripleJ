"""새 경로(Vertex·Azure) 주요 기능 한 번씩 호출 — 시험 컨테이너 안에서만 실행.

- DB·MinIO 를 쓰지 않는 함수만 부른다(운영 데이터에 쓰기 없음). 입력은 전부 합성 문장·빈 이미지.
- 사용자 음원은 외부 AI 로 보내지 않는다(Gemini 음악 구조 분석은 부르지 않음).
- 키·응답 원문은 출력하지 않는다. 결과는 PASS/FAIL + 짧은 사유(예외 이름·HTTP 코드)만.
- SMOKE_SKIP_IMAGES=1 이면 이미지(비용 큰 항목) 생략.

실행: python /chk/smoke_newpaths.py   (작업 디렉터리 /srv/app, PYTHONPATH=/srv/app)
"""
import asyncio
import os
import re
import sys
import time

sys.path.insert(0, "/srv/app")

import httpx  # noqa: E402

from app.config import settings  # noqa: E402
from app.services import ai_providers as ap  # noqa: E402

CLAUDE_MODELS = ["claude-opus-4-6", "claude-opus-4-7", "claude-opus-5-5", "claude-haiku-5-5"]
OPENAI_CHAT_MODELS = [settings.openai_model, settings.openai_model_advanced, "gpt-5.5"]
GEMINI_TEXT = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
SKIP_IMAGES = os.environ.get("SMOKE_SKIP_IMAGES") == "1"

results = []


def _short(e):
    s = "{}: {}".format(type(e).__name__, str(e))
    s = re.sub(r"(key=|api-key[\"']?: ?|Bearer )[A-Za-z0-9._-]+", r"\1***", s)
    return s[:160]


async def step(name, coro_fn):
    t = time.monotonic()
    try:
        info = await coro_fn()
        results.append((True, name))
        print("PASS {:<38} {:>5.1f}s {}".format(name, time.monotonic() - t, info or ""), flush=True)
    except Exception as e:  # noqa: BLE001
        results.append((False, name))
        print("FAIL {:<38} {:>5.1f}s {}".format(name, time.monotonic() - t, _short(e)), flush=True)


async def main():
    print("경로:", "claude=" + ap.claude_provider(), "gemini_vertex_ratio={}".format(ap.gemini_vertex_ratio()),
          "aistudio_fallback={}".format(bool(settings.gemini_aistudio_fallback)), "openai=" + ap.openai_provider())
    if ap.claude_provider() != "vertex" or ap.gemini_vertex_ratio() < 100 or ap.openai_provider() != "azure":
        print("주의: 새 경로 스위치가 전부 켜져 있지 않아요(newpaths.env 확인).")

    # ── Claude on Vertex ──
    claude = ap.make_anthropic_client(timeout=60.0, max_retries=1)
    for m in CLAUDE_MODELS:
        async def _c(m=m):
            r = await claude.messages.create(model=m, max_tokens=16,
                                             messages=[{"role": "user", "content": "Reply with the word OK."}])
            return "stop={} out_tokens={}".format(r.stop_reason, r.usage.output_tokens)
        await step("claude " + m, _c)

    async def _cache():
        r = await claude.messages.create(
            model="claude-opus-4-6", max_tokens=16,
            system=[{"type": "text", "text": "You are a test. " * 300, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": "Reply OK."}])
        return "cache_write={} cache_read={}".format(getattr(r.usage, "cache_creation_input_tokens", None),
                                                     getattr(r.usage, "cache_read_input_tokens", None))
    await step("claude cache_control", _cache)

    async def _schema():
        # story_reader 와 같은 모양: output_config effort + json_schema
        schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"],
                  "additionalProperties": False}
        r = await claude.messages.create(
            model="claude-opus-5-5", max_tokens=256,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": "Return ok=true."}])
        text = "".join(getattr(b, "text", "") for b in r.content)
        assert '"ok"' in text, "no json"
        return "stop={}".format(r.stop_reason)
    await step("claude output_config json_schema", _schema)

    async def _translate():
        from app.services.translation import translate_ko_to_en
        out = await translate_ko_to_en("밤하늘의 별을 보며 노래해요")
        assert out and re.search(r"[A-Za-z]", out), "empty translation"
        return "len={}".format(len(out))
    await step("service: translation(Claude)", _translate)

    # ── Gemini on Vertex (express key) ──
    for model in ["gemini-2.5-flash", "gemini-2.5-pro"]:
        async def _g(model=model):
            async with httpx.AsyncClient(timeout=120.0) as c:
                resp = await ap.gemini_post(c, GEMINI_TEXT.format(model), json={
                    "contents": [{"parts": [{"text": "Reply with the word OK."}]}],
                    "generationConfig": {"maxOutputTokens": 64}})
            host = resp.request.url.host
            assert resp.status_code == 200, "HTTP {} via {}".format(resp.status_code, host)
            return "via {}".format(host)
        await step("gemini text " + model, _g)

    if not SKIP_IMAGES:
        async def _gimg():
            from app.services.mv_assets import _gemini_generate_image
            b = await _gemini_generate_image("A simple flat icon of a yellow star on a white background.")
            assert b and len(b) > 1000, "empty image"
            return "bytes={}".format(len(b))
        await step("service: Gemini image(mv_assets)", _gimg)

    # ── OpenAI on Azure ──
    oa = ap.make_openai_client(timeout=60.0)
    for m in OPENAI_CHAT_MODELS:
        async def _o(m=m):
            r = await oa.chat.completions.create(model=m, max_completion_tokens=256,
                                                 messages=[{"role": "user", "content": "Reply with the word OK."}])
            return "finish={}".format(r.choices[0].finish_reason)
        await step("azure chat " + m, _o)

    async def _emb():
        from app.services.embedding_service import embed_text
        v = await embed_text("별이 빛나는 밤의 노래")
        assert len(v) == 1536, "dim={}".format(len(v))
        return "dim=1536 model={}".format(settings.embedding_model)
    await step("service: embedding", _emb)

    async def _kw():
        from app.services.keyword_service import generate_search_keywords
        kws = await generate_search_keywords({"title": "밤하늘", "lyrics": "별을 보며 노래해", "genre": "ballad"},
                                             track_id="smoke-test")
        assert kws, "empty (함수가 실패 시 [] 를 돌려줌 — 로그 확인)"
        return "keywords={}".format(len(kws or []))
    await step("service: search keywords(OpenAI)", _kw)

    if not SKIP_IMAGES:
        from app.services import openai_image as oi

        async def _img():
            b = await oi.generate_image("A simple flat icon of a blue circle on white.", size="1024x1024", quality="low")
            assert b and len(b) > 1000, "empty image"
            return "bytes={} url_host={}".format(len(b), httpx.URL(oi.OPENAI_GEN_URL).host)
        await step("service: GPT image generations", _img)

        async def _edit():
            b = await oi.generate_image("Make the background light pink.", ref_images=[oi._neutral_placeholder_png()],
                                        size="1024x1024", quality="low")
            assert b and len(b) > 1000, "empty image"
            return "bytes={}".format(len(b))
        await step("service: GPT image edits(multipart)", _edit)

    print("429 counts:", ap.rate_limit_counts())
    bad = [n for ok, n in results if not ok]
    print("SMOKE {}/{} PASS".format(len(results) - len(bad), len(results)), ("FAILED: " + ", ".join(bad)) if bad else "")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
