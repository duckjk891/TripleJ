"""v3.281 arrange — 일회용 컨테이너 TestClient 검증(네트워크 없음, 가짜 Mongo/MinIO, Suno 미호출)."""
import asyncio, sys, re
from datetime import datetime, timezone, timedelta
from bson import ObjectId

sys.path.insert(0, "/srv/app")
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.routes.generate as G
from app.auth import get_current_user
from app.services import gen_jobs as gj
from app.services import kids_policy
import app.services.strike_service as strike
import app.services.creation_log as cl


def _get(doc, path):
    cur = doc
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None, False
        cur = cur[p]
    return cur, True


def _match(doc, flt):
    for k, v in (flt or {}).items():
        if k == "$or":
            if not any(_match(doc, f) for f in v):
                return False
            continue
        val, present = _get(doc, k)
        if isinstance(v, dict) and any(str(x).startswith("$") for x in v):
            for op, arg in v.items():
                if op == "$ne" and val == arg:
                    return False
                if op == "$in" and val not in arg:
                    return False
        elif val != v:
            return False
    return True


class Cursor:
    def __init__(self, docs): self.docs = docs
    def sort(self, *a, **k): return self
    def skip(self, n): return self
    def limit(self, n): return self
    def __aiter__(self):
        self._it = iter(self.docs); return self
    async def __anext__(self):
        try: return next(self._it)
        except StopIteration: raise StopAsyncIteration
    async def to_list(self, length=None): return list(self.docs)


class Coll:
    def __init__(self): self.docs = []
    async def find_one(self, flt=None, proj=None, sort=None, **kw):
        for d in self.docs:
            if _match(d, flt): return dict(d)
        return None
    def find(self, flt=None, proj=None, **kw):
        return Cursor([dict(d) for d in self.docs if _match(d, flt)])
    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId()); self.docs.append(dict(doc))
        class R: pass
        r = R(); r.inserted_id = doc["_id"]; return r
    async def update_one(self, flt, upd, **kw):
        for d in self.docs:
            if _match(d, flt):
                d.update(upd.get("$set", {})); return
    async def find_one_and_update(self, flt, upd, **kw):
        for d in self.docs:
            if _match(d, flt):
                old = dict(d); d.update(upd.get("$set", {})); return old
        return None
    async def count_documents(self, flt): return len([d for d in self.docs if _match(d, flt)])


class DB:
    def __init__(self): self._c = {}
    def __getattr__(self, n):
        if n.startswith("_"): raise AttributeError(n)
        return self._c.setdefault(n, Coll())


class Stat:
    def __init__(self, size): self.size = size


class FakeMinio:
    objects = {}
    def stat_object(self, bucket, obj):
        if obj not in self.objects: raise Exception("NoSuchKey")
        return Stat(self.objects[obj])


DBI = DB()
G.get_mongo = lambda: DBI
G.get_minio = lambda: FakeMinio()
G.public_presign = lambda obj, bucket=None, **k: f"https://s3.example/{bucket}/{obj}?X-Amz-Signature=abc"
FakeMinio.objects = {"generated/SRC/suno_output.mp3": 3_000_000, "generated/SRC/suno_output_2.mp3": 3_100_000}

SPENT, RUNS, SESS = [], [], []

async def fake_spend(uid, action, amount, ref, db=None):
    SPENT.append((uid, action, amount, ref)); return BALANCE["ok"]
BALANCE = {"ok": True}
G.spend_points = fake_spend

async def no_strike(conn, uid): return None
strike.check_generation_allowed = no_strike

FATIGUE = {"on": False}
async def fake_fatigue(uid, director="composer"):
    if FATIGUE["on"]:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=429, content={"error": "director_fatigue"})
    return None
G._fatigue_gate_response = fake_fatigue

async def no_voice(uid, pid): return None
G._voice_expired_response = no_voice

async def fake_sweep_user(*a, **k): return 0
gj.sweep_user = fake_sweep_user

async def fake_create_session(uid, app_version=None, platform=None, engine_list=None, parent_session_id=None):
    sid = f"sess-{len(SESS)+1}"; SESS.append({"sid": sid, "parent": parent_session_id}); return sid
cl.create_session = fake_create_session
async def fake_ensure(sid, uid, **k): return "sess-ensure"
cl.ensure_session = fake_ensure

kids_policy.kids_enabled = lambda: False

def fake_run(**kw): RUNS.append(kw)
G._run_music_generation = fake_run

USER = {"id": "u_owner_000000000000", "nickname": "owner"}
app = FastAPI()
app.include_router(G.router)
app.dependency_overrides[get_current_user] = lambda: USER
client = TestClient(app)
noauth = TestClient((lambda a: (a.include_router(G.router), a)[1])(FastAPI()))

now = datetime.now(timezone.utc)
src_id = ObjectId()
SRC = {
    "_id": src_id, "user_id": USER["id"], "status": "completed", "title": "봄날의 노래",
    "genre": "K-Ballad", "mood": "Calm, Relaxing", "style": "Piano-driven", "vocal": "female_warm",
    "lyrics": "[Verse]\n봄이 와요\n[Chorus]\n함께 걸어요", "prompt": "원 프롬프트",
    "persona_id": "persona-xyz", "persona_model": "voice_persona", "character_id": "char-1",
    "session_id": "sess-src", "lyrics_version_id": "lv-1", "duet": False,
    "lyrics_source": {"lyrics_id": "d1", "title": "봄", "is_mine": True},
    "result_audio_url": "generated/SRC/suno_output.mp3",
    "variants": [{"index": 0, "audio_url": "generated/SRC/suno_output.mp3"},
                 {"index": 1, "audio_url": "generated/SRC/suno_output_2.mp3"}],
    "point_ref": "old", "created_at": now - timedelta(days=1),
}
DBI.generations.docs.append(dict(SRC))
other_id = ObjectId()
DBI.generations.docs.append({**SRC, "_id": other_id, "user_id": "u_other"})
guest_id = ObjectId()
DBI.generations.docs.append({**SRC, "_id": guest_id, "user_id": "guest:dev1", "guest": True})
pending_id = ObjectId()
DBI.generations.docs.append({**SRC, "_id": pending_id, "status": "processing", "point_ref": None})

results = []
def check(name, cond, info=""):
    results.append((name, bool(cond))); print(("PASS" if cond else "FAIL"), name, info)

body = {"variant_index": 1, "genre": "Rock", "mood": None, "style": "강렬한 일렉 기타", "keep_melody": 0.8, "label": "록"}

# 401 (no auth override)
r = noauth.post(f"/api/generate/{src_id}/arrange", json=body)
check("401 unauthenticated", r.status_code in (401, 403), r.status_code)
# 400 bad id
r = client.post("/api/generate/zzz/arrange", json=body); check("400 bad id", r.status_code == 400)
# 400 no option
r = client.post(f"/api/generate/{src_id}/arrange", json={"variant_index": 0})
check("400 no option", r.status_code == 400 and r.json().get("code") == "arrange_no_option", r.text)
# 404 missing
r = client.post(f"/api/generate/{ObjectId()}/arrange", json=body); check("404 missing", r.status_code == 404)
# 403 others / guest
r = client.post(f"/api/generate/{other_id}/arrange", json=body); check("403 others", r.status_code == 403)
r = client.post(f"/api/generate/{guest_id}/arrange", json=body); check("403 guest doc", r.status_code == 403)
# 409 not completed (no charge)
r = client.post(f"/api/generate/{pending_id}/arrange", json=body)
check("409 not completed", r.status_code == 409 and r.json().get("code") == "arrange_source_not_ready", r.text)
# 400 bad variant
r = client.post(f"/api/generate/{src_id}/arrange", json={**body, "variant_index": 5}); check("400 bad variant", r.status_code == 400)
check("no spend so far", len(SPENT) == 0, SPENT)

# remove the processing doc so compose guard does not 409 the happy path
DBI.generations.docs = [d for d in DBI.generations.docs if d["_id"] != pending_id]

# 429 fatigue (no charge, no doc)
FATIGUE["on"] = True
n0 = len(DBI.generations.docs)
r = client.post(f"/api/generate/{src_id}/arrange", json=body)
check("429 fatigue passthrough", r.status_code == 429 and len(SPENT) == 0 and len(DBI.generations.docs) == n0)
FATIGUE["on"] = False
# 402 insufficient
BALANCE["ok"] = False
r = client.post(f"/api/generate/{src_id}/arrange", json=body)
check("402 insufficient", r.status_code == 402 and len(DBI.generations.docs) == n0, r.text)
BALANCE["ok"] = True
SPENT.clear()

# 201 happy path
r = client.post(f"/api/generate/{src_id}/arrange", json=body, headers={"X-Gen-Request-Id": "0123456789abcdef0123456789abcdef"})
check("201 created", r.status_code == 201, r.text[:300])
d = r.json()
new_id = d.get("id")
nd = next(x for x in DBI.generations.docs if str(x["_id"]) == new_id)
ref = nd["reference_audio_url"]
check("ref url short", ref.startswith(f"https://api.maidol.ai.kr/api/generate/arrange-audio/{src_id}/1/") and len(ref) < 200, ref)
check("audio_weight=0.8", nd["audio_weight"] == 0.8)
check("persona kept", nd["persona_id"] == "persona-xyz" and nd["persona_model"] == "voice_persona")
check("lyrics kept", nd["lyrics"] == SRC["lyrics"])
check("vocal/character kept", nd["vocal"] == "female_warm" and nd["character_id"] == "char-1")
check("genre new, mood dropped, style free", nd["genre"] == "Rock" and nd["mood"] is None and nd["style"] == "강렬한 일렉 기타")
check("title", nd["title"] == "봄날의 노래 (록 편곡)", nd["title"])
check("arranged_from", nd["arranged_from"]["generation_id"] == str(src_id) and nd["arranged_from"]["variant_index"] == 1)
check("charged compose 15", len(SPENT) == 1 and SPENT[0][1] == "compose" and SPENT[0][2] == G.POINT_COSTS["compose"], SPENT)
check("point_ref recorded", nd["point_ref"] == SPENT[0][3] and nd["point_cost"] == G.POINT_COSTS["compose"])
check("child session w/ parent", SESS[-1]["parent"] == "sess-src" and nd["session_id"] == SESS[-1]["sid"], SESS)
check("client_request_id", nd.get("client_request_id") == "0123456789abcdef0123456789abcdef")
check("bg run called w/ ref+aw+persona", len(RUNS) == 1 and RUNS[0]["reference_audio_url"] == ref and RUNS[0]["audio_weight"] == 0.8
      and RUNS[0]["persona_id"] == "persona-xyz" and RUNS[0]["suno_model"] is None and RUNS[0]["lyrics"] == SRC["lyrics"], {k: RUNS[0].get(k) for k in ("genre","mood","style","vocal","title")} if RUNS else None)
check("token hash not in response", "arrange_audio_token_hash" not in d)
check("status pending", nd["status"] == "pending")

# redirect route
token = ref.rsplit("/", 1)[1]
r = noauth.get(f"/api/generate/arrange-audio/{src_id}/1/{token}", follow_redirects=False)
check("redirect 302", r.status_code == 302 and "suno_output_2.mp3" in r.headers.get("location", ""), r.status_code)
r = noauth.get(f"/api/generate/arrange-audio/{src_id}/1/wrongtoken", follow_redirects=False)
check("redirect bad token 403", r.status_code == 403)
r = noauth.get(f"/api/generate/arrange-audio/{src_id}/0/{token}", follow_redirects=False)
check("redirect wrong variant 403", r.status_code == 403)
for x in DBI.generations.docs:
    if str(x["_id"]) == new_id: x["started_at"] = now - timedelta(hours=25)
r = noauth.get(f"/api/generate/arrange-audio/{src_id}/1/{token}", follow_redirects=False)
check("redirect expired 410", r.status_code == 410)

# 409 busy (new doc is pending + charged → compose guard) — 만료 테스트용 시각 복원
for x in DBI.generations.docs:
    if str(x["_id"]) == new_id: x["started_at"] = datetime.now(timezone.utc)
r = client.post(f"/api/generate/{src_id}/arrange", json={**body, "variant_index": 0})
check("409 busy via compose guard", r.status_code == 409 and len(SPENT) == 1, r.text[:200])

# keep_melody clamp + mood-only keeps genre
for x in DBI.generations.docs:
    if str(x["_id"]) == new_id: x["status"] = "completed"
r = client.post(f"/api/generate/{src_id}/arrange", json={"variant_index": 0, "mood": "Exciting, Groovy", "keep_melody": 5})
nd2 = next(x for x in DBI.generations.docs if str(x["_id"]) == r.json().get("id")) if r.status_code == 201 else {}
check("clamp 0.9 + genre kept on mood-only", r.status_code == 201 and nd2.get("audio_weight") == 0.9 and nd2.get("genre") == "K-Ballad" and nd2.get("mood") == "Exciting, Groovy"
      and nd2.get("title") == "봄날의 노래 (Exciting, Groovy 편곡)", (r.status_code, nd2.get("title")))

# variant omitted + released → track's variant_index
for x in DBI.generations.docs:
    x["status"] = "completed"
    if x["_id"] == src_id: x["result_track_id"] = str(ObjectId()); TID = x["result_track_id"]
DBI.tracks.docs.append({"_id": ObjectId(TID), "variant_index": 1})
r = client.post(f"/api/generate/{src_id}/arrange", json={"genre": "Jazz", "label": "재즈"})
nd3 = next(x for x in DBI.generations.docs if str(x["_id"]) == r.json().get("id")) if r.status_code == 201 else {}
check("omitted variant uses released track variant", r.status_code == 201 and nd3["arranged_from"]["variant_index"] == 1 and nd3["arrange_audio_object"].endswith("_2.mp3"), r.status_code)

# existing create path unchanged (regression: no extra fields, ensure_session used)
for x in DBI.generations.docs: x["status"] = "completed"
r = client.post("/api/generate/", json={"prompt": "p", "lyrics": "la", "start_music_gen": True})
cd = next(x for x in DBI.generations.docs if str(x["_id"]) == r.json().get("id")) if r.status_code == 201 else {}
check("create regression", r.status_code == 201 and "arranged_from" not in cd and cd.get("session_id") == "sess-ensure", r.status_code)

print("\nSUMMARY", sum(1 for _, ok in results if ok), "/", len(results))
sys.exit(0 if all(ok for _, ok in results) else 1)
