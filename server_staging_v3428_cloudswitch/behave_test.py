import os, sys, importlib, types
sys.path.insert(0, os.path.expanduser("~/cloudswitch/base"))
# minimal package stubs so we import only config + ai_providers
import app.config as cfg
from app.services import ai_providers as ap

def reload(**env):
    for k in ["CLAUDE_PROVIDER","GEMINI_PROVIDER","OPENAI_PROVIDER","VERTEX_API_KEY","AZURE_OPENAI_ENDPOINT","AZURE_OPENAI_API_KEY","VERTEX_GEMINI_MODEL_MAP"]:
        os.environ.pop(k, None)
    os.environ.update(env)
    cfg.settings = cfg.Settings(_env_file=None)
    ap.settings = cfg.settings

os.environ.update(ANTHROPIC_API_KEY="ak-old", OPENAI_API_KEY="ok-old", GOOGLE_API_KEY="gk-old")
fails = 0
def check(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name); fails += (not cond)

U = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent"
# default = old paths
reload()
c = ap.make_anthropic_client(timeout=60.0, max_retries=2)
check("claude default AsyncAnthropic", type(c).__name__ == "AsyncAnthropic" and c.api_key == "ak-old" and c.max_retries == 2)
o = ap.make_openai_client(timeout=45.0)
check("openai default base", str(o.base_url) == "https://api.openai.com/v1/" and o.api_key == "ok-old")
check("image urls default", ap.openai_images_url("edits") == "https://api.openai.com/v1/images/edits")
check("image headers default", ap.openai_auth_headers() == {"Authorization": "Bearer ok-old"})
check("gemini url unchanged", ap.gemini_url(U) == U)
check("gemini params default", ap.gemini_params() == {"key": "gk-old"})
check("guards default", ap.openai_configured() and ap.claude_configured() and ap.gemini_key() == "gk-old")
check("embedding default", cfg.settings.embedding_model == "text-embedding-3-small")

# new paths
reload(CLAUDE_PROVIDER="vertex", GEMINI_PROVIDER="vertex", OPENAI_PROVIDER="azure", VERTEX_API_KEY="vk",
       AZURE_OPENAI_ENDPOINT="https://maidol.openai.azure.com/", AZURE_OPENAI_API_KEY="az",
       VERTEX_GEMINI_MODEL_MAP="gemini-3-pro-image-preview=gemini-3-pro-image")
try:
    c = ap.make_anthropic_client(timeout=60.0)
    check("claude vertex client", type(c).__name__ == "AsyncAnthropicVertex" and c.project_id == "maidol-509006")
except Exception as e:
    check("claude vertex client (%s)" % type(e).__name__, False)
o = ap.make_openai_client()
check("azure base", str(o.base_url) == "https://maidol.openai.azure.com/openai/v1/")
check("azure image url", ap.openai_images_url("generations") == "https://maidol.openai.azure.com/openai/v1/images/generations")
check("vertex gemini url+map", ap.gemini_url(U) == "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-pro-image:generateContent")
check("vertex non-model url untouched", ap.gemini_url("https://generativelanguage.googleapis.com/v1beta/operations/x") .startswith("https://generativelanguage"))
check("vertex key", ap.gemini_params() == {"key": "vk"})
print("FAILS", fails)
