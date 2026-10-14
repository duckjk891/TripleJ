import asyncio, json
from bson import ObjectId
from starlette.requests import Request
import app.routes.tracks as T

TID = str(ObjectId())
OWNER = {"id": "owner-1", "role": "user"}
OTHER = {"id": "other-2", "role": "user"}
ADMIN = {"id": "adm", "role": "admin"}
DOC = {}

class Coll:
    async def find_one(self, q, proj=None):
        return dict(DOC) if DOC else None
class Mongo:
    tracks = Coll()
T.get_mongo = lambda: Mongo()

class AgeOff:
    @staticmethod
    async def gate(*a, **k): return None
    @staticmethod
    def filter_enabled(): return False
T.age_rating = AgeOff
async def fake_stream(request, name, fn, download=False): return "STREAM"
T._stream_video_with_range = fake_stream

def req(qs=""):
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": qs.encode()})

ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok += cond; fail += (not cond)
    print("PASS" if cond else "FAIL", name, info)

def code(r):
    return getattr(r, "status_code", 200)

async def main():
    import jwt
    from app.auth import JWT_SECRET, JWT_ALGORITHM
    from datetime import datetime, timedelta, timezone
    tok = lambda uid: jwt.encode({"id": uid, "role": "user", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    obj = f"share/v8/{TID}_sns.mp4"
    # --- POST gate (cover missing → 400 proves gate passed, before any charge)
    base = dict(_id=ObjectId(TID), uploader_id="owner-1", audio_url="a.mp3", title="t")
    async def post(user, **d):
        DOC.clear(); DOC.update(base, **d)
        return await T.create_share_video(TID, format="sns", layout="full", shape="square", lyrics="scroll", font="basic",
            fontcolor="white", bg="blur", bgblur="mid", bgcolor="", bgalpha="45", fontbold="0", fontitalic="0",
            subpos="auto", fontoutline="1", outlinecolor="", clip_start=None, clip_end=None, current_user=user, x_gen_request_id=None)
    r = await post(OWNER, is_public=False); check("POST private owner passes gate", code(r) == 400 and "커버" in r.body.decode(), r.body.decode()[:60])
    r = await post(OTHER, is_public=False); check("POST private other 404", code(r) == 404)
    r = await post(ADMIN, is_public=False); check("POST private admin passes", code(r) == 400)
    r = await post(OTHER, is_public=True); check("POST public other passes", code(r) == 400)
    r = await post(OTHER); check("POST legacy(no field) passes", code(r) == 400)
    # --- clip-info
    async def clip(user, **d):
        DOC.clear(); DOC.update(base, duration_sec=120, **d)
        return await T.get_share_video_clip_info(TID, req(), current_user=user)
    r = await clip(None, is_public=False); check("clip private anon 404", code(r) == 404)
    r = await clip(OTHER, is_public=False); check("clip private other 404", code(r) == 404)
    r = await clip(OWNER, is_public=False); check("clip private owner 200", code(r) == 200, str(r)[:80])
    r = await clip(None, is_public=True); check("clip public anon 200", code(r) == 200)
    # --- by-object
    async def byobj(user, token=None, **d):
        DOC.clear(); DOC.update(base, **d)
        return await T.get_share_video_by_object(obj, req(), download=0, token=token, current_user=user)
    r = await byobj(None, is_public=False); check("object private anon 404", code(r) == 404)
    r = await byobj(OTHER, is_public=False); check("object private other 404", code(r) == 404)
    r = await byobj(OWNER, is_public=False); check("object private owner stream", r == "STREAM")
    r = await byobj(None, token=tok("owner-1"), is_public=False); check("object private ?token owner stream", r == "STREAM")
    r = await byobj(None, token=tok("other-2"), is_public=False); check("object private ?token other 404", code(r) == 404)
    r = await byobj(None, token="garbage", is_public=False); check("object bad token 404", code(r) == 404)
    r = await byobj(None, is_public=True); check("object public anon stream", r == "STREAM")
    DOC.clear(); r = await T.get_share_video_by_object(obj, req(), download=0, token=None, current_user=None)
    check("object missing track 404", code(r) == 404)
    print(f"TOTAL ok={ok} fail={fail}")

asyncio.run(main())
