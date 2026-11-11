import os, sys, asyncio, types
sys.path.insert(0, os.path.expanduser("~/cloudswitch/base"))
os.environ["OPENAI_API_KEY"] = "ok"
# stub heavy deps of openai_image
wm = types.ModuleType("app.services.watermark"); wm.embed_image_metadata = lambda b: b
sys.modules["app.services.watermark"] = wm
ma = types.ModuleType("app.services.mv_assets")
async def fake_gemini(prompt, refs): return b"GEMINI"
ma._gemini_generate_image = fake_gemini
sys.modules["app.services.mv_assets"] = ma
from app.services import openai_image as oi
_real_sleep = asyncio.sleep
oi.asyncio.sleep = lambda s: _real_sleep(0)
fails = 0
def run(err, flag):
    oi.settings.image_fallback_gemini = flag
    async def boom(*a, **k): raise err
    oi._call_generations = boom
    try: return asyncio.run(oi.generate_image("p"))
    except ValueError: return "RAISED"
for name, err, flag, want in [
    ("429 flag off", ValueError("OpenAI generations error HTTP 429: rate"), False, "RAISED"),
    ("429 flag on", ValueError("OpenAI generations error HTTP 429: rate"), True, b"GEMINI"),
    ("503 flag on", ValueError("OpenAI generations error HTTP 503: x"), True, b"GEMINI"),
    ("timeout flag on", oi.httpx.ReadTimeout("t"), True, b"GEMINI"),
    ("400 safety flag on", ValueError("OpenAI generations error HTTP 400: moderation_blocked"), True, "RAISED"),
]:
    got = run(err, flag); ok = got == want; fails += not ok
    print(("PASS " if ok else "FAIL ") + name, got)
print("FALLBACK_FAILS", fails)
