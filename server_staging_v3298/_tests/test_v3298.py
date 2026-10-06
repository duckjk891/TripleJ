"""v3.298 웹 푸시 — 암호화 왕복(브라우저 측 복호화)·VAPID 서명 검증·만료 구독 정리·알림 훅. 격리 컨테이너."""
import asyncio, base64, json, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.services.webpush as wp
import app.routes.notifications as rn

def hk(salt, ikm, info, n): return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)
# 브라우저(UA) 키
ua_priv = ec.generate_private_key(ec.SECP256R1())
ua_pub = ua_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
auth = b"0123456789abcdef"
p256dh_b64, auth_b64 = wp.b64u(ua_pub), wp.b64u(auth)
msg = json.dumps({"title": "MAIDOL", "body": "테스트 푸시 ✓"}, ensure_ascii=False).encode()
body = wp.encrypt_payload(msg, p256dh_b64, auth_b64)
# UA 측 복호화(RFC 8291 §3.4)
salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
as_pub = body[21:21 + idlen]; ct = body[21 + idlen:]
shared = ua_priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
ikm = hk(auth, shared, b"WebPush: info\x00" + ua_pub + as_pub, 32)
cek = hk(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
nonce = hk(salt, ikm, b"Content-Encoding: nonce\x00", 12)
pt = AESGCM(cek).decrypt(nonce, ct, None)
ok("헤더 형식(rs=4096·키 65바이트)", rs == 4096 and idlen == 65)
ok("브라우저 측 복호화 = 원문(패딩 구분자 0x02)", pt == msg + b"\x02")
# VAPID
vpriv = ec.generate_private_key(ec.SECP256R1())
vpub = wp.b64u(vpriv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
h = wp.vapid_auth_header("https://fcm.googleapis.com/fcm/send/abc", vpriv, vpub, now=1_800_000_000)
tok = h.split("t=")[1].split(",")[0]; k = h.split("k=")[1]
hdr, clm, sig = tok.split(".")
claims = json.loads(wp.b64u_dec(clm))
ok("VAPID aud = 엔드포인트 origin", claims["aud"] == "https://fcm.googleapis.com" and claims["exp"] == 1_800_000_000 + 43200)
raw = wp.b64u_dec(sig); der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
pubkey = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.b64u_dec(k))
try:
    pubkey.verify(der, f"{hdr}.{clm}".encode(), ec.ECDSA(hashes.SHA256())); sig_ok = True
except Exception:
    sig_ok = False
ok("VAPID ES256 서명 검증", sig_ok)
# 문구
ok("푸시 대상 종류만", wp.payload_for_notification("feed", "a") is None and wp.payload_for_notification("club_promo", "a") is None)
ok("댓글 문구(곡)", "내 곡에 댓글" in wp.payload_for_notification("comment", "민지", target_type="track", preview="좋아요!")["body"])
ok("별 문구", wp.payload_for_notification("star", "MAIDOL", target_type="star_grant", amount=15)["body"].startswith("스타 15개를 받았어요"))

# 발송·만료 정리(가짜 DB·HTTP)
class Cur:
    def __init__(s, d): s.d = d
    def sort(s, *a): return s
    def skip(s, n): s.d = s.d[n:]; return s
    async def to_list(s, length=None): return list(s.d)
class Subs:
    def __init__(s): s.docs = []
    def find(s, q, proj=None): return Cur([d for d in s.docs if all(d.get(k) == v for k, v in q.items())])
    async def delete_many(s, q):
        ids = q["_id"]["$in"]; before = len(s.docs); s.docs = [d for d in s.docs if d["_id"] not in ids]
        class R: deleted_count = before - len(s.docs)
        return R()
class Sec:
    doc = None
    async def find_one(s, q): return s.doc
    async def insert_one(s, d): Sec.doc = d
class DB:
    def __init__(s): s.push_subscriptions = Subs(); s.app_secrets = Sec(); s.notifications = None
    def __getitem__(s, k): return getattr(s, k)
db = DB(); wp.get_mongo = lambda: db
db.push_subscriptions.docs = [
    {"_id": 1, "user_id": "u1", "endpoint": "https://push.example/ok", "p256dh": p256dh_b64, "auth": auth_b64},
    {"_id": 2, "user_id": "u1", "endpoint": "https://push.example/gone", "p256dh": p256dh_b64, "auth": auth_b64},
]
sent = []
class FakeResp:
    def __init__(s, c): s.status_code = c; s.text = ""
class FakeClient:
    def __init__(s, *a, **k): pass
    async def __aenter__(s): return s
    async def __aexit__(s, *a): return False
    async def post(s, url, content=None, headers=None):
        sent.append((url, headers)); return FakeResp(410 if url.endswith("gone") else 201)
wp.httpx.AsyncClient = FakeClient
async def main():
    r = await wp.send_to_user("u1", {"title": "t", "body": "b", "tag": "x"})
    ok("발송 결과 ok1·gone1", r == {"ok": 1, "gone": 1, "fail": 0})
    ok("만료 구독 삭제", [d["_id"] for d in db.push_subscriptions.docs] == [1])
    ok("필수 헤더(aes128gcm·TTL·vapid)", all(h["Content-Encoding"] == "aes128gcm" and h["TTL"] == "86400" and h["Authorization"].startswith("vapid t=") for _, h in sent))
    ok("VAPID 키 1회 생성·보관", Sec.doc is not None and Sec.doc["_id"] == "webpush_vapid")
    r0 = await wp.send_to_user("nobody", {"title": "t"})
    ok("구독 없으면 발송 없음", r0 == {"ok": 0, "gone": 0, "fail": 0})
    # 알림 훅 — push_notification 이 발송 예약
    calls = []
    async def fake_send(uid, payload): calls.append((uid, payload["tag"]))
    wp.send_to_user = fake_send
    class N:
        async def insert_one(s, d): pass
    class M: notifications = N()
    await rn.push_notification(M(), user_id="u9", ntype="comment", actor_id="u8", actor_nickname="민지", target_type="track", preview="굿")
    await rn.push_notification(M(), user_id="u9", ntype="feed", actor_id="u8", actor_nickname="민지")
    await asyncio.sleep(0.05)
    ok("알림 저장 시 푸시 예약(댓글만, 피드 제외)", calls == [("u9", "maidol-comment")])
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
