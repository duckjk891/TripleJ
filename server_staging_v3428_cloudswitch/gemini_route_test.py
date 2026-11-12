"""Gemini 비율 분배 + AI Studio 예비 경로 + 429 급증 알림 시험 (네트워크 없음, httpx.MockTransport)."""
import os, sys, asyncio, random, re, glob, logging
sys.path.insert(0, os.path.expanduser("~/cloudswitch/base"))
import httpx
import app.config as cfg
from app.services import ai_providers as ap

ENV_KEYS = ["CLAUDE_PROVIDER", "GEMINI_PROVIDER", "OPENAI_PROVIDER", "VERTEX_API_KEY", "GOOGLE_API_KEY",
            "VERTEX_GEMINI_MODEL_MAP", "GEMINI_VERTEX_RATIO", "GEMINI_AISTUDIO_FALLBACK",
            "AI_429_ALERT_THRESHOLD", "AI_429_ALERT_WINDOW_SEC", "AI_429_ALERT_EMAIL"]


def reload(**env):
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    base = dict(GOOGLE_API_KEY="gk-old", VERTEX_API_KEY="vk",
                VERTEX_GEMINI_MODEL_MAP="gemini-3-pro-image-preview=gemini-3-pro-image")
    base.update(env)
    for k, v in list(base.items()):
        if v is None:
            base.pop(k)
    os.environ.update(base)
    cfg.settings = cfg.Settings(_env_file=None)
    ap.settings = cfg.settings


fails = 0


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (("  " + str(extra)) if extra else ""))
    fails += (not cond)


U = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent"
V = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-pro-image:generateContent"


def run(behaviour):
    """behaviour(host) -> httpx.Response | Exception. 돌려줌: (최종 status 또는 예외 이름, [(host, key)])"""
    calls = []

    def handler(req):
        calls.append((req.url.host, req.url.params.get("key")))
        r = behaviour(req.url.host)
        if isinstance(r, Exception):
            raise r
        return r

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            try:
                resp = await ap.gemini_post(c, U, json={"contents": []})
                return resp.status_code, calls
            except Exception as e:
                return type(e).__name__, calls
    return asyncio.run(go())


ok200 = lambda h: httpx.Response(200, json={"candidates": []})
AIS, VTX = "generativelanguage.googleapis.com", "aiplatform.googleapis.com"

# 1) 0% = 옛 경로 (기본값)
reload()
st, calls = run(ok200)
check("0% default -> AI Studio only", st == 200 and calls == [(AIS, "gk-old")], calls)
check("0% default ratio", ap.gemini_vertex_ratio() == 0)
# 0% 에서는 429 여도 재시도 없이 그대로(예전 동작)
st, calls = run(lambda h: httpx.Response(429))
check("0% 429 -> unchanged (no extra call)", st == 429 and len(calls) == 1, calls)

# 2) 100% = Vertex (+ 모델 치환)
reload(GEMINI_VERTEX_RATIO="100")
st, calls = run(ok200)
check("100% -> Vertex only", st == 200 and calls == [(VTX, "vk")], calls)
reload(GEMINI_PROVIDER="vertex")
st, calls = run(ok200)
check("GEMINI_PROVIDER=vertex == 100%", st == 200 and calls == [(VTX, "vk")] and ap.gemini_vertex_ratio() == 100, calls)
check("vertex non-model url stays AI Studio",
      ap.pick_gemini_route("https://generativelanguage.googleapis.com/v1beta/operations/x") == "aistudio")

# 3) 비율 분배 (30%)
reload(GEMINI_VERTEX_RATIO="30")
random.seed(1234)
picks = [ap.pick_gemini_route(U) for _ in range(5000)]
share = picks.count("vertex") / len(picks)
check("30% split ~ 0.30", 0.27 < share < 0.33, round(share, 3))
reload(GEMINI_VERTEX_RATIO="250")
check("ratio clamp >100 -> 100", ap.gemini_vertex_ratio() == 100)
reload(GEMINI_VERTEX_RATIO="-5")
check("ratio clamp <0 -> 0", ap.gemini_vertex_ratio() == 0)

# 4) Vertex 429·5xx·시간 초과 -> AI Studio 1회 재시도
reload(GEMINI_VERTEX_RATIO="100")
vtx_fail = lambda code: (lambda h: httpx.Response(code) if h == VTX else httpx.Response(200, json={}))
for code in (429, 500, 503):
    st, calls = run(vtx_fail(code))
    check("vertex %d -> AI Studio retry" % code, st == 200 and calls == [(VTX, "vk"), (AIS, "gk-old")], calls)
st, calls = run(lambda h: httpx.ReadTimeout("t") if h == VTX else httpx.Response(200, json={}))
check("vertex timeout -> AI Studio retry", st == 200 and calls == [(VTX, "vk"), (AIS, "gk-old")], calls)
# 재시도도 실패하면 그 응답을 그대로(호출부 기존 재시도 로직이 처리) — 재시도는 딱 1번
st, calls = run(lambda h: httpx.Response(429))
check("both 429 -> 429 returned, exactly 2 calls", st == 429 and len(calls) == 2, calls)

# 5) 안전 거절·4xx 는 넘기지 않음
st, calls = run(lambda h: httpx.Response(400, json={"error": {"message": "safety"}}))
check("vertex 400 -> returned as-is (no fallback)", st == 400 and calls == [(VTX, "vk")], calls)
st, calls = run(lambda h: httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}))
check("vertex 200 safety block -> as-is", st == 200 and calls == [(VTX, "vk")], calls)
st, calls = run(lambda h: httpx.Response(403))
check("vertex 403 -> as-is", st == 403 and len(calls) == 1, calls)
st, calls = run(lambda h: httpx.ConnectError("x"))
check("vertex connect error -> raised (not timeout)", st == "ConnectError" and len(calls) == 1, calls)

# 6) 예비 경로 꺼짐 / AI Studio 키 없음
reload(GEMINI_VERTEX_RATIO="100", GEMINI_AISTUDIO_FALLBACK="false")
st, calls = run(vtx_fail(429))
check("fallback off -> 429 as-is", st == 429 and len(calls) == 1, calls)
st, calls = run(lambda h: httpx.ReadTimeout("t"))
check("fallback off timeout -> raised", st == "ReadTimeout" and len(calls) == 1, calls)
reload(GEMINI_VERTEX_RATIO="100", GOOGLE_API_KEY=None)
st, calls = run(vtx_fail(429))
check("no AI Studio key -> 429 as-is", st == 429 and len(calls) == 1, calls)

# 7) 429 급증 알림
reload(AI_429_ALERT_THRESHOLD="10", AI_429_ALERT_WINDOW_SEC="300")
ap._rl_hits.clear(); ap._rl_last_alert.clear()
records = []
h = logging.Handler(); h.emit = lambda r: records.append(r.getMessage())
ap.logger.addHandler(h); ap.logger.setLevel(logging.INFO)
fired = [ap.record_rate_limit("gemini-vertex", now=1000 + i) for i in range(12)]
check("alert fires on 10th within window only once", fired.index(True) == 9 and fired.count(True) == 1, fired)
check("alert log line", any("[ai-429-alert] provider=gemini-vertex" in m for m in records))
check("other provider separate", ap.record_rate_limit("openai", now=1005) is False)
fired2 = [ap.record_rate_limit("gemini-vertex", now=1400 + i) for i in range(10)]
check("new window -> fires again", fired2[-1] is True and fired2.count(True) == 1, fired2)
check("spread out (9 per 5min) never fires",
      not any(ap.record_rate_limit("claude-vertex", now=5000 + i * 34) for i in range(40)))
# gemini_post 가 429 를 공급자별로 기록
ap._rl_hits.clear()
reload(GEMINI_VERTEX_RATIO="100")
run(vtx_fail(429))
check("gemini_post records vertex 429", ap.rate_limit_counts().get("gemini-vertex") == 1, ap.rate_limit_counts())

# 8) SDK 클라이언트에 429 훅 (옛·새 경로 둘 다), 생성 설정은 그대로
reload()
os.environ.update(ANTHROPIC_API_KEY="ak-old", OPENAI_API_KEY="ok-old")
cfg.settings = cfg.Settings(_env_file=None); ap.settings = cfg.settings
c = ap.make_anthropic_client(timeout=60.0, max_retries=2)
o = ap.make_openai_client(timeout=45.0)
check("anthropic hook attached, settings kept",
      len(c._client.event_hooks["response"]) == 1 and c.max_retries == 2 and c.timeout == 60.0)
check("openai hook attached, settings kept",
      len(o._client.event_hooks["response"]) == 1 and o.timeout == 45.0 and str(o.base_url) == "https://api.openai.com/v1/")
ap._rl_hits.clear()
asyncio.run(c._client.event_hooks["response"][0](httpx.Response(429)))
asyncio.run(o._client.event_hooks["response"][0](httpx.Response(200)))
check("sdk hook counts 429 only", ap.rate_limit_counts() == {"claude-anthropic": 1}, ap.rate_limit_counts())

# 9) 호출 지점: Gemini REST 호출 13곳 모두 gemini_post, 옛 직접 키 전달 없음, URL 상수 9개
src = ""
for f in ["character_generator.py", "mv_generator.py", "cover_generator.py", "mv_assets.py"]:
    src += open(os.path.expanduser("~/cloudswitch/base/app/services/" + f)).read()
check("13 gemini_post call sites", src.count("await gemini_post(") == 13, src.count("await gemini_post("))
check("no direct google key params", "params={\"key\": settings.google_api_key}" not in src and "gemini_params" not in src)
# 모델 URL 10개 = Gemini 9개 + Veo 1개(VEO31_GENERATE_URL, 사용 중지·도달 불가 코드라 그대로 둠)
n_models = len(re.findall(r'generativelanguage\.googleapis\.com/v1beta/models/', src))
n_veo = src.count("veo-3.1-fast-generate-preview:predictLongRunning")
check("9 Gemini model URLs (+1 dead Veo)", n_models - n_veo == 9 and n_veo == 1, (n_models, n_veo))

print("GEMINI_ROUTE_FAILS", fails)
