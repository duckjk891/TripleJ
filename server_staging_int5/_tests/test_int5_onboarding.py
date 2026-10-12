"""int5 — 신규 가입 본인확인 필수(IDENTITY_REQUIRED_SINCE) + 통합 시작 시각 스위치. 가짜 DB, 격리 컨테이너."""
import asyncio, os, sys, uuid
from datetime import date, datetime, timedelta, timezone

os.environ.update({"IDENTITY_VERIFY_PROVIDER": "mock", "IDENTITY_CI_SALT": "salt", "SOCIAL_ONBOARDING_ENABLED": "true"})
import app.routes.identity as ri  # noqa: E402
from app.models.user import REQUIRED_CONSENT_KEYS  # noqa: E402

FAILS = []
ri._schema_ready = True


def ok(n, c, info=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else f"  {info}"))
    if not c:
        FAILS.append(n)


NOW = datetime.now(timezone.utc)


class Conn:
    def __init__(s, created, verified=False, role="user", birth=date(1990, 1, 1), guardian_verified=False, consents=True):
        s.created, s.verified, s.role, s.birth, s.gv, s.consents = created, verified, role, birth, guardian_verified, consents

    async def fetchrow(s, q, *a):
        if "SELECT birth_date, is_verified" in q:
            return {"birth_date": s.birth, "is_verified": s.verified}
        if "SELECT created_at, role" in q:
            return {"created_at": s.created, "role": s.role}
        raise AssertionError(q)

    async def fetch(s, q, *a):
        return [{"consent_key": k, "agreed": True} for k in REQUIRED_CONSENT_KEYS] if s.consents else []

    async def fetchval(s, q, *a):
        if "guardian_verified_at IS NOT NULL" in q:
            return 1 if s.gv else None
        return None


async def onb(conn):
    return await ri.onboarding_status(current_user={"id": str(uuid.uuid4())}, conn=conn)


async def main():
    since = NOW - timedelta(hours=1)
    os.environ["IDENTITY_REQUIRED_SINCE"] = since.isoformat()
    r = await onb(Conn(created=NOW))
    ok("new email user unverified → required + birth_missing(앱 본인확인 버튼)", r["required"] and r["birth_date_missing"] and r["identity_required"], r)
    r = await onb(Conn(created=NOW, verified=True))
    ok("new verified → not required", not r["required"] and not r["identity_required"], r)
    r = await onb(Conn(created=since - timedelta(days=3)))
    ok("existing user → not required", not r["required"] and not r["birth_date_missing"], r)
    r = await onb(Conn(created=NOW, role="admin"))
    ok("official/admin exempt", not r["required"], r)
    r = await onb(Conn(created=NOW, birth=date(2016, 5, 5), guardian_verified=True))
    ok("guardian-verified child exempt", not r["identity_required"] and not r["required"], r)
    r = await onb(Conn(created=NOW, birth=date(2016, 5, 5), guardian_verified=False))
    ok("child without verified guardian → required", r["identity_required"], r)
    os.environ.pop("IDENTITY_REQUIRED_SINCE")
    r = await onb(Conn(created=NOW))
    ok("switch unset → old behavior", not r["required"] and not r["identity_required"], r)
    os.environ["IDENTITY_REQUIRED_SINCE"] = "garbage"
    r = await onb(Conn(created=NOW))
    ok("bad since value → off", not r["required"], r)
    os.environ.pop("IDENTITY_REQUIRED_SINCE")
    os.environ["SOCIAL_ONBOARDING_ENABLED"] = "false"
    os.environ["IDENTITY_REQUIRED_SINCE"] = since.isoformat()
    r = await onb(Conn(created=NOW))
    ok("onboarding off → required false (identity flag still reported)", not r["required"] and r["identity_required"], r)
    os.environ["SOCIAL_ONBOARDING_ENABLED"] = "true"

    # 통합 시작 시각
    os.environ.pop("ACCOUNT_MERGE_ENABLED", None)
    os.environ.pop("ACCOUNT_MERGE_ENABLED_FROM", None)
    ok("merge off by default", not ri._merge_enabled())
    os.environ["ACCOUNT_MERGE_ENABLED_FROM"] = "2026-10-19T00:00:00+09:00"
    ok("merge FROM future → off (today)", ri._merge_enabled() == (NOW >= datetime(2026, 10, 18, 15, tzinfo=timezone.utc)))
    os.environ["ACCOUNT_MERGE_ENABLED_FROM"] = (NOW - timedelta(minutes=1)).isoformat()
    ok("merge FROM past → on", ri._merge_enabled())
    cfg = await ri.identity_config()
    ok("config reports account_merge_enabled", cfg["account_merge_enabled"] is True, cfg)
    os.environ.pop("ACCOUNT_MERGE_ENABLED_FROM")
    os.environ["ACCOUNT_MERGE_ENABLED"] = "true"
    ok("merge explicit true → on", ri._merge_enabled())
    print("RESULT:", "ALL PASS" if not FAILS else f"FAIL {FAILS}")
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
