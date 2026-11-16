"""공통 재시도(지수 백오프+지터)·Gemini 예비 모델·Priority PayGo 헤더·Claude 모델 매핑·SDK 재시도 횟수 시험.
네트워크 없음(httpx.MockTransport), 대기는 가짜 sleep 으로 기록만."""
import os, sys, asyncio, random, re
sys.path.insert(0, os.path.expanduser("~/cloudswitch/base"))
import httpx
import app.config as cfg
from app.services import ai_providers as ap

ENV_KEYS = ["CLAUDE_PROVIDER", "GEMINI_PROVIDER", "OPENAI_PROVIDER", "VERTEX_API_KEY", "GOOGLE_API_KEY",
            "VERTEX_GEMINI_MODEL_MAP", "GEMINI_VERTEX_RATIO", "GEMINI_AISTUDIO_FALLBACK", "GEMINI_RETRY_MAX",
            "GEMINI_RETRY_BASE_SEC", "GEMINI_RETRY_MAX_WAIT_SEC", "GEMINI_MODEL_FALLBACK", "GEMINI_FALLBACK_MODELS",
            "VERTEX_PRIORITY_PAYGO", "CLAUDE_MAX_RETRIES", "OPENAI_MAX_RETRIES", "VERTEX_CLAUDE_MODEL_MAP",
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]


def reload(**env):
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    base = dict(GOOGLE_API_KEY="gk", VERTEX_API_KEY="vk", ANTHROPIC_API_KEY="ak", OPENAI_API_KEY="ok")
    base.update(env)
    os.environ.update({k: v for k, v in base.items() if v is not None})
    cfg.settings = cfg.Settings(_env_file=None)
    ap.settings = cfg.settings


fails = 0


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (("  " + str(extra)) if extra else ""))
    fails += (not cond)


sleeps = []


async def fake_sleep(s):
    sleeps.append(s)

ap._sleep = fake_sleep

PRO = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent"
IMG = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent"
AIS, VTX = "generativelanguage.googleapis.com", "aiplatform.googleapis.com"


def run(seq, url=PRO, **post_kw):
    """seq: 호출 순서대로 돌려줄 값 목록(Response 코드 int 또는 Exception). 마지막 값은 반복.
    돌려줌: (최종 status 또는 예외 이름, [(host, model, priority 헤더)])"""
    calls = []
    sleeps.clear()

    def handler(req):
        model = req.url.path.rsplit("/", 1)[-1].split(":")[0]
        calls.append((req.url.host, model, req.headers.get(ap.PRIORITY_PAYGO_HEADER)))
        v = seq[min(len(calls) - 1, len(seq) - 1)]
        if isinstance(v, Exception):
            raise v
        return httpx.Response(v, json={})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            try:
                r = await ap.gemini_post(c, url, json={"contents": []}, **post_kw)
                return r.status_code, calls
            except Exception as e:
                return type(e).__name__, calls
    return asyncio.run(go())


T = lambda: httpx.ReadTimeout("t")

# ── 1) 기본값 = 지금 동작 (재시도·예비 모델·헤더 없음) ──
reload()
st, calls = run([429])
check("default: 429 -> 1 call, no sleep", st == 429 and len(calls) == 1 and not sleeps, calls)
st, calls = run([503])
check("default: 503 -> 1 call", st == 503 and len(calls) == 1, calls)
st, calls = run([T()])
check("default: timeout -> raised, 1 call", st == "ReadTimeout" and len(calls) == 1, calls)
check("default: no priority header", calls[0][2] is None)

# ── 2) 공통 재시도: GEMINI_RETRY_MAX ──
reload(GEMINI_RETRY_MAX="2")
random.seed(7)
st, calls = run([503, 429, 200])
check("retry 2: 503,429,200 -> 200 in 3 calls", st == 200 and len(calls) == 3, calls)
check("backoff+jitter bounds (1s: 0.5~1, 2s: 1~2)", len(sleeps) == 2 and 0.5 <= sleeps[0] <= 1 and 1 <= sleeps[1] <= 2, sleeps)
st, calls = run([500, 502, 504, 200])
check("retry 2: exhausted -> last 5xx returned (3 calls)", st == 504 and len(calls) == 3, calls)
st, calls = run([T(), 200])
check("retry 2: timeout then 200", st == 200 and len(calls) == 2, calls)
st, calls = run([T()])
check("retry 2: timeouts exhausted -> raised after 3", st == "ReadTimeout" and len(calls) == 3, calls)
st, calls = run([400])
check("retry 2: 400 (safety) not retried", st == 400 and len(calls) == 1 and not sleeps, calls)
st, calls = run([200], )
check("retry 2: 200 first try, no sleep", st == 200 and len(calls) == 1 and not sleeps)
st, calls = run([429], retry=False)
check("retry=False call site -> no extra tries (no double retry)", st == 429 and len(calls) == 1, calls)
st, calls = run([httpx.ConnectError("x")])
check("connect error not retried (as before)", st == "ConnectError" and len(calls) == 1, calls)
reload(GEMINI_RETRY_MAX="3", GEMINI_RETRY_BASE_SEC="10", GEMINI_RETRY_MAX_WAIT_SEC="8")
st, calls = run([429])
check("max wait cap 8s", len(sleeps) == 3 and all(4 <= s <= 8 for s in sleeps), [round(s, 2) for s in sleeps])
reload(GEMINI_RETRY_MAX="99")
check("retry max clamp 10", ap._gemini_retry_max() == 10)

# ── 3) 예비 모델 ──
reload()
st, calls = run([429, 200])
check("model fallback off -> no switch", st == 429 and len(calls) == 1, calls)
reload(GEMINI_MODEL_FALLBACK="true")
st, calls = run([429, 200])
check("3.1-pro 429 -> 2.5-pro", st == 200 and [c[1] for c in calls] == ["gemini-3.1-pro-preview", "gemini-2.5-pro"], calls)
st, calls = run([503, 200])
check("3.1-pro 503 -> 2.5-pro", st == 200 and calls[-1][1] == "gemini-2.5-pro", calls)
st, calls = run([T(), 200])
check("3.1-pro timeout -> 2.5-pro", st == 200 and calls[-1][1] == "gemini-2.5-pro", calls)
st, calls = run([400, 200])
check("3.1-pro 400 -> no fallback", st == 400 and len(calls) == 1, calls)
st, calls = run([429, 200], url=IMG)
check("unmapped model (image) -> no fallback", st == 429 and len(calls) == 1, calls)
st, calls = run([429, 429])
check("fallback model also 429 -> 429, exactly 2 calls", st == 429 and len(calls) == 2, calls)
reload(GEMINI_MODEL_FALLBACK="true", GEMINI_RETRY_MAX="1")
st, calls = run([429, 429, 429, 200])
check("retry wraps (model+fallback) attempt: 4 calls", st == 200 and [c[1] for c in calls] ==
      ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-2.5-pro"], calls)
reload(GEMINI_MODEL_FALLBACK="true", GEMINI_VERTEX_RATIO="100")
st, calls = run([429, 429, 200])
check("vertex 429 -> AI Studio 429 -> fallback model on vertex",
      st == 200 and [(c[0], c[1]) for c in calls] == [(VTX, "gemini-3.1-pro-preview"), (AIS, "gemini-3.1-pro-preview"),
                                                      (VTX, "gemini-2.5-pro")], calls)

# ── 4) Priority PayGo 헤더 ──
reload(GEMINI_VERTEX_RATIO="100")
st, calls = run([200], priority=True)
check("priority switch off -> no header", calls[0][2] is None, calls)
reload(GEMINI_VERTEX_RATIO="100", VERTEX_PRIORITY_PAYGO="true")
st, calls = run([200], priority=True)
check("vertex + priority call site -> header 'priority'", calls[0][2] == "priority" and calls[0][0] == VTX, calls)
st, calls = run([200])
check("vertex + non-waiting call site -> no header", calls[0][2] is None, calls)
st, calls = run([429, 200], priority=True)
check("AI Studio fallback request has no header", calls[0][2] == "priority" and calls[1] == (AIS, "gemini-3.1-pro-preview", None), calls)
reload(VERTEX_PRIORITY_PAYGO="true")
st, calls = run([200], priority=True)
check("AI Studio route (0%) -> no header", calls[0] == (AIS, "gemini-3.1-pro-preview", None), calls)
check("header name per docs", ap.PRIORITY_PAYGO_HEADER == "X-Vertex-AI-LLM-Shared-Request-Type")

# ── 5) Claude 모델 매핑 ──
class FakeMessages:
    def __init__(self): self.seen = []
    async def create(self, **kw): self.seen.append(("create", kw.get("model"))); return kw.get("model")
    def stream(self, **kw): self.seen.append(("stream", kw.get("model"))); return kw.get("model")


class FakeClient:
    def __init__(self): self.messages = FakeMessages()

reload()
fc = ap._apply_claude_model_map(FakeClient())
asyncio.run(fc.messages.create(model="claude-opus-4-6"))
check("map empty -> model untouched", fc.messages.seen == [("create", "claude-opus-4-6")])
reload(VERTEX_CLAUDE_MODEL_MAP="claude-opus-4-6=claude-opus-4-6@v1, claude-haiku-5-5=claude-haiku-5-5@v2")
fc = ap._apply_claude_model_map(FakeClient())
asyncio.run(fc.messages.create(model="claude-opus-4-6", max_tokens=1))
fc.messages.stream(model="claude-haiku-5-5")
asyncio.run(fc.messages.create(model="claude-opus-4-7"))
check("map applies to create/stream, others untouched", [m for _, m in fc.messages.seen] ==
      ["claude-opus-4-6@v1", "claude-haiku-5-5@v2", "claude-opus-4-7"], fc.messages.seen)
c = ap.make_anthropic_client()
check("anthropic (old path) client not wrapped even with map", getattr(c.messages.create, "__name__", "") != "wrapped")
reload(CLAUDE_PROVIDER="vertex", VERTEX_CLAUDE_MODEL_MAP="claude-opus-4-6=x")
try:
    cv = ap.make_anthropic_client(timeout=60.0)
    check("vertex client wrapped (create, stream)", cv.messages.create.__name__ == "wrapped" and cv.messages.stream.__name__ == "wrapped")
except Exception as e:
    check("vertex client wrapped (%s)" % type(e).__name__, False)
reload(CLAUDE_PROVIDER="vertex")
cv = ap.make_anthropic_client()
check("vertex client, map empty -> not wrapped", getattr(cv.messages.create, "__name__", "") != "wrapped")

# ── 6) SDK 재시도 횟수 ──
reload()
check("claude default max_retries = SDK default 2", ap.make_anthropic_client().max_retries == 2)
check("caller explicit kept (story_reader 1)", ap.make_anthropic_client(max_retries=1).max_retries == 1)
check("openai default max_retries = 2", ap.make_openai_client().max_retries == 2)
reload(CLAUDE_MAX_RETRIES="4", OPENAI_MAX_RETRIES="3")
check("CLAUDE_MAX_RETRIES=4", ap.make_anthropic_client().max_retries == 4)
check("CLAUDE_MAX_RETRIES does not override caller", ap.make_anthropic_client(max_retries=1).max_retries == 1)
check("OPENAI_MAX_RETRIES=3", ap.make_openai_client(timeout=45.0).max_retries == 3)
reload(CLAUDE_MAX_RETRIES="0")
check("CLAUDE_MAX_RETRIES=0 allowed", ap.make_anthropic_client().max_retries == 0)

# ── 7) 호출 지점 표시 ──
src = {}
for f in ["character_generator.py", "mv_generator.py", "cover_generator.py", "mv_assets.py"]:
    src[f] = open(os.path.expanduser("~/cloudswitch/base/app/services/" + f)).read()
allsrc = "".join(src.values())
# 캐릭터 2(자체 3회)·커버 다듬기 1(자체 2회)·MV 음악 분석 2·장면 이미지 2(429 30초)·브레인스톰 1·시나리오 1(상위 재시도)
check("retry=False at 9 own-retry call sites", allsrc.count("retry=False") == 9, allsrc.count("retry=False"))
check("priority=True at 4 user-waiting call sites (character 2, cover 2)",
      src["character_generator.py"].count("priority=True") == 2 and src["cover_generator.py"].count("priority=True") == 2
      and allsrc.count("priority=True") == 4)
check("still 13 gemini_post call sites", allsrc.count("await gemini_post(") == 13)

print("RETRY_FAILS", fails)
