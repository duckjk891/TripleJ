"""[SIWA] 애플 로그인 — 운영 이미지 격리 컨테이너(--network none)에서 실행.

  docker run --rm --network none -v <staging>:/stage -w /srv/app maidol-app:latest \
    sh -c 'cp /stage/app/routes/apple_auth.py app/routes/ && cp /stage/app/routes/auth.py app/routes/ && python /stage/_tests/test_ios1.py'

검증: identity_token 서명·aud·iss·만료, client_secret(ES256) 구조, 신규/재로그인/정지 계정 분기, 이메일 미확인 시 연동 금지,
탈퇴 해지(키 미설정·토큰 없음·정상), 서버 알림 시 토큰 정리.
"""
import asyncio, base64, json, os, sys, time
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)

import app.routes.apple_auth as aa

# ── 가짜 애플 키 세트 ─────────────────────────────────────────────
rsa_priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
class FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        class K: key = rsa_priv.public_key()
        return K()
aa._jwks_client = FakeJWKS()
def idtok(**over):
    now = int(time.time())
    c = {"iss": aa.APPLE_ISSUER, "aud": "com.maidol.app", "sub": "001234.abcdef.0001", "iat": now, "exp": now + 600,
         "email": "x@privaterelay.appleid.com", "email_verified": "true", "is_private_email": "true"}
    c.update(over)
    return jwt.encode(c, rsa_priv, algorithm="RS256", headers={"kid": "k1"})

ok("identity_token 정상 검증", aa.verify_identity_token(idtok())["sub"] == "001234.abcdef.0001")
for name, tok in [("aud 불일치 거부", idtok(aud="com.other.app")), ("iss 불일치 거부", idtok(iss="https://evil.example")),
                  ("만료 거부", idtok(exp=int(time.time()) - 10))]:
    try:
        aa.verify_identity_token(tok); ok(name, False)
    except jwt.PyJWTError:
        ok(name, True)
other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
try:
    aa.verify_identity_token(jwt.encode({"iss": aa.APPLE_ISSUER, "aud": "com.maidol.app", "sub": "s", "exp": int(time.time()) + 60}, other, algorithm="RS256"))
    ok("다른 키 서명 거부", False)
except jwt.PyJWTError:
    ok("다른 키 서명 거부", True)

# ── client_secret ───────────────────────────────────────────────
for k in ("APPLE_SIWA_KEY_B64", "APPLE_TEAM_ID", "APPLE_SIWA_KEY_ID"):
    os.environ.pop(k, None)
ok("키 미설정 → client_secret None", aa.client_secret() is None)
ec_priv = ec.generate_private_key(ec.SECP256R1())
pem = ec_priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
os.environ.update({"APPLE_SIWA_KEY_B64": base64.b64encode(pem).decode(), "APPLE_TEAM_ID": "TEAM123456", "APPLE_SIWA_KEY_ID": "KEY1234567"})
cs = aa.client_secret(now=int(time.time()))
hdr = jwt.get_unverified_header(cs)
cl = jwt.decode(cs, ec_priv.public_key(), algorithms=["ES256"], audience=aa.APPLE_ISSUER, options={"verify_exp": False})
ok("client_secret ES256·kid·iss·sub·aud", hdr["kid"] == "KEY1234567" and hdr["alg"] == "ES256" and cl["iss"] == "TEAM123456"
   and cl["sub"] == "com.maidol.app" and cl["exp"] - cl["iat"] == 300)

# ── 가짜 DB·Mongo·HTTP ───────────────────────────────────────────
class Coll:
    def __init__(s): s.docs = []
    async def update_one(s, q, u, upsert=False):
        for d in s.docs:
            if all(d.get(k) == v for k, v in q.items()): d.update(u["$set"]); return
        s.docs.append({**q, **u["$set"]})
    async def find_one(s, q): return next((d for d in s.docs if all(d.get(k) == v for k, v in q.items())), None)
    async def delete_many(s, q):
        n = len(s.docs); s.docs = [d for d in s.docs if not all(d.get(k) == v for k, v in q.items())]; return n - len(s.docs)
class Mongo(dict):
    def __missing__(s, k): s[k] = Coll(); return s[k]
mongo = Mongo()
aa.get_mongo = lambda: mongo

calls = {"resolve": [], "credit": [], "beta": 0, "follow": 0, "http": []}
ROW = {"id": "11111111-2222-3333-4444-555555555555", "email": "x@privaterelay.appleid.com", "nickname": "민지",
       "profile_image": None, "role": "user", "account_status": "active"}
action_next = {"v": "signup", "status": "active"}
async def fake_resolve(conn, provider, uid, email, nickname, image, **kw):
    calls["resolve"].append((provider, uid, email, nickname))
    return action_next["v"], {**ROW, "account_status": action_next["status"]}
async def fake_credit(uid, kind, amt, **kw): calls["credit"].append(kind)
async def fake_beta(uid, source): calls["beta"] += 1; return True
async def fake_follow(conn, uid, provider=None): calls["follow"] += 1
async def fake_save(*a, **k): return None
aa._resolve_account = fake_resolve
aa.credit_points = fake_credit
aa.grant_beta_signup_bonus = fake_beta
aa.ensure_mutual_follow = fake_follow
aa._save_session = fake_save
aa._create_token = lambda *a, **k: "JWT.TEST"

class Resp:
    def __init__(s, code, body): s.status_code = code; s._b = body; s.headers = {"content-type": "application/json"}
    def json(s): return s._b
class FakeClient:
    def __init__(s, *a, **k): pass
    async def __aenter__(s): return s
    async def __aexit__(s, *a): return False
    async def post(s, url, data=None):
        calls["http"].append((url, dict(data or {})))
        if url == aa.APPLE_TOKEN_URL: return Resp(200, {"refresh_token": "RT-1", "access_token": "AT"})
        if url == aa.APPLE_REVOKE_URL: return Resp(200, {})
        return Resp(404, {})
aa.httpx.AsyncClient = FakeClient

async def main():
    # 신규 가입
    r = await aa.apple_native_login(aa.NativeBody(identity_token=idtok(), authorization_code="CODE", full_name="민지"), conn=None)
    ok("신규: 토큰 반환", isinstance(r, dict) and r["token"] == "JWT.TEST" and r["action"] == "signup")
    ok("신규: provider=apple·sub·확인된 이메일·이름 전달", calls["resolve"][-1] == ("apple", "001234.abcdef.0001", "x@privaterelay.appleid.com", "민지"))
    ok("신규: 가입 보너스·베타·공식 맞팔", calls["credit"] == ["signup_bonus"] and calls["beta"] == 1 and calls["follow"] == 1)
    ok("refresh_token 보관", (await mongo[aa.TOKENS].find_one({"user_id": ROW["id"]}))["refresh_token"] == "RT-1")
    ok("code 교환 요청 client_id=번들", calls["http"][-1][0] == aa.APPLE_TOKEN_URL and calls["http"][-1][1]["client_id"] == "com.maidol.app")

    # 재로그인(코드 없음) — 보너스 없음
    action_next["v"] = "login"; n_credit = len(calls["credit"])
    r = await aa.apple_native_login(aa.NativeBody(identity_token=idtok()), conn=None)
    ok("재로그인: 보너스 재지급 없음", r["action"] == "login" and len(calls["credit"]) == n_credit)

    # 이메일 미확인 → 연동에 이메일 미사용
    await aa.apple_native_login(aa.NativeBody(identity_token=idtok(email_verified="false")), conn=None)
    ok("이메일 미확인 → 이메일 연동 안 함", calls["resolve"][-1][2] is None)

    # 정지 계정
    action_next["status"] = "suspended"
    r = await aa.apple_native_login(aa.NativeBody(identity_token=idtok()), conn=None)
    ok("이용 중지 계정 403", getattr(r, "status_code", None) == 403)
    action_next["status"] = "active"

    # 검증 실패
    r = await aa.apple_native_login(aa.NativeBody(identity_token=idtok(aud="x")), conn=None)
    ok("위조 토큰 401", getattr(r, "status_code", None) == 401)

    # 탈퇴 해지
    ok("탈퇴: 애플 토큰 해지 성공", await aa.revoke_for_user(ROW["id"]) is True)
    ok("탈퇴: revoke 요청 token_type_hint", calls["http"][-1][0] == aa.APPLE_REVOKE_URL and calls["http"][-1][1]["token_type_hint"] == "refresh_token")
    ok("탈퇴: 보관 토큰 삭제", await mongo[aa.TOKENS].find_one({"user_id": ROW["id"]}) is None)
    ok("탈퇴: 애플 계정 아님(토큰 없음) → no-op", await aa.revoke_for_user("someone-else") is False)

    # 키 미설정이면 로그인은 되고 보관만 생략
    saved = os.environ.pop("APPLE_SIWA_KEY_B64")
    n_http = len(calls["http"])
    r = await aa.apple_native_login(aa.NativeBody(identity_token=idtok(), authorization_code="CODE2"), conn=None)
    ok("키 미설정: 로그인 성공·애플 호출 없음", r["token"] == "JWT.TEST" and len(calls["http"]) == n_http)
    os.environ["APPLE_SIWA_KEY_B64"] = saved

asyncio.run(main())

# auth.py 탈퇴 훅이 존재하는지(소스 확인)
src = open("app/routes/auth.py", encoding="utf-8").read()
ok("auth.py 탈퇴에 애플 해지 훅", "from .apple_auth import revoke_for_user" in src and src.index("apple_revoke") < src.index("# ① users 익명화"))

print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL — {FAILS}")
sys.exit(1 if FAILS else 0)
