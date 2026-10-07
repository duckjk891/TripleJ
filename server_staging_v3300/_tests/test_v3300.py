"""v3.300 얼굴 인증 면제(사용자 지정) — 격리 컨테이너 + 가짜 DB."""
import asyncio, sys
FAILS = []
def ok(n, c):
    print(("PASS " if c else "FAIL ") + n)
    if not c: FAILS.append(n)
import app.services.face_verify_service as fv
import app.database.mongodb as mdb
EX = "18bd8131-2097-47c8-b055-1680b2eb51c3"
class Ex:
    docs = [{"user_id": EX}]
    async def find_one(s, q, proj=None):
        for d in s.docs:
            if d["user_id"] == q["user_id"] and ("revoked_at" not in d): return d
class DB: face_verify_exemptions = Ex()
mdb.get_mongo = lambda: DB()
pg_calls = []
class Conn:
    async def fetchrow(s, q, *a): pg_calls.append(a); return None
class Acq:
    async def __aenter__(s): return Conn()
    async def __aexit__(s, *a): return False
class Pool:
    def acquire(s): return Acq()
import app.database.postgres as pg
pg._pool = Pool()
async def main():
    ok("면제 사용자 판별", await fv.is_face_verify_exempt(EX) is True)
    ok("면제 사용자 사진 게이트 통과(대조 조회 없음)", await fv.is_photo_verified(EX, b"photo") is True and not pg_calls)
    other = "00000000-0000-0000-0000-000000000001"
    ok("다른 사용자는 면제 아님", await fv.is_face_verify_exempt(other) is False)
    ok("다른 사용자는 기존 대조 게이트(미인증 → 거부)", await fv.is_photo_verified(other, b"photo") is False and len(pg_calls) == 1)
    Ex.docs[0]["revoked_at"] = "2026-10-07"
    fv._EXEMPT_CACHE.clear()
    ok("revoked_at 지정 시 해제", await fv.is_face_verify_exempt(EX) is False)
asyncio.run(main())
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
