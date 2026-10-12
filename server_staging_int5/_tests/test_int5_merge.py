"""int5 계정 통합 테스트 — 임시 DB(운영 스키마·인덱스 복제, 데이터 없음)에서만 실행.
실행: 임시 컨테이너 안에서 python /stage/_tests/test_int5_merge.py (env 로 임시 DB 지정)."""
import asyncio
import hashlib
import json
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import asyncpg
from bson import ObjectId

from app.config import settings
from app.database.mongodb import get_mongo, init_mongodb
from app.database.redis import get_redis, init_redis
from app.routes import identity as idr
from app.services import account_merge as am
from app.services import identity_verify as iv

PASS, FAIL = [], []


def check(name, cond, info=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  {info}"))


async def mk_user(c, email, nick, provider="local", pw=True, role="user"):
    uid = uuid.uuid4()
    await c.execute(
        """INSERT INTO users (id, email, nickname, provider, provider_user_id, password_hash, role, account_status, birth_date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8, now())""",
        uid, email, nick, provider, None if provider == "local" else f"pid-{uid.hex[:6]}",
        "$2b$12$fakehash" if pw else None, role, date(1990, 1, 1))
    return uid


async def seed_content(m, uid, n_tracks, nick):
    s = str(uid)
    await m.characters.insert_one({"user_id": s, "character_id": uuid.uuid4().hex, "name": f"art-{nick}"})
    ids = []
    for i in range(n_tracks):
        r = await m.tracks.insert_one({"uploader_id": s, "uploader_nickname": nick, "title": f"{nick}-{i}", "like_count": 1})
        ids.append(str(r.inserted_id))
    await m.feeds.insert_one({"author_id": s, "author_nickname": nick, "like_count": 1})
    return ids


async def new_rid(c, uid):
    rid = "rid" + uuid.uuid4().hex[:12]
    await c.execute("INSERT INTO identity_verifications (id, user_id, purpose, provider) VALUES ($1,$2,'verify','mock')", rid, uid)
    return rid, await c.fetchrow("SELECT * FROM identity_verifications WHERE id=$1", rid)


async def callback(c, rid, row, ci="DI-SAME-PERSON"):
    res = iv.IdentityResult(birth_date=date(1992, 3, 4), gender="female", ci=ci)
    out = await idr._apply_result(c, row, "mock", res)
    await c.execute("UPDATE identity_verifications SET status=$2, completed_at=now() WHERE id=$1", rid, out["status"])
    return out


def body(r):
    if hasattr(r, "body"):
        return r.status_code, json.loads(r.body)
    return 200, r


async def main():
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    m = get_mongo()
    idx = json.load(open("/stage_idx/idx.json"))
    for name, specs in idx.items():
        for sp in specs:
            kw = {"unique": sp["unique"]}
            if sp.get("partialFilterExpression"):
                kw["partialFilterExpression"] = sp["partialFilterExpression"]
            if sp.get("sparse"):
                kw["sparse"] = True
            try:
                await m[name].create_index([(k, v) for k, v in sp["key"]], **kw)
            except Exception as e:  # noqa: BLE001
                print("idx skip", name, sp["key"], type(e).__name__)
    c = await asyncpg.connect(settings.postgres_dsn)
    await idr._ensure_schema(c)

    A = await mk_user(c, "olduser@example.com", "올드", provider="kakao", pw=False)   # 먼저 인증한 계정
    B = await mk_user(c, "Second@Example.com ", "세컨", provider="local", pw=True)     # 지금 인증하는 계정
    P = await mk_user(c, "peer@example.com", "피어")
    X = await mk_user(c, "x@example.com", "엑스")
    h = iv.ci_hash("DI-SAME-PERSON")
    await c.execute("UPDATE users SET ci_hash=$2, is_verified=TRUE WHERE id=$1", A, h)
    a_tr = await seed_content(m, A, 1, "올드")
    b_tr = await seed_content(m, B, 2, "세컨")
    sA, sB, sP, sX = str(A), str(B), str(P), str(X)
    await m.point_balances.insert_many([{"user_id": sA, "balance": 100}, {"user_id": sB, "balance": 70}])
    await m.user_slots.insert_many([{"user_id": sA, "extra_slots": 1}, {"user_id": sB, "extra_slots": 2}])
    await m.point_events.insert_one({"user_id": sB, "action": "signup_bonus", "track_id": "-", "day": "-", "amount": 50})
    await m.attendance_progress.insert_many([{"user_id": sA, "streak": 3}, {"user_id": sB, "streak": 9}])
    # 둘 다 좋아한 곡 X1(겹침) + B 만 좋아한 곡
    x_tr = await seed_content(m, X, 2, "엑스")
    await m.tracks.update_one({"_id": ObjectId(x_tr[0])}, {"$set": {"like_count": 2}})
    await c.execute("INSERT INTO likes (user_id, track_id) VALUES ($1,$3),($2,$3),($2,$4)", A, B, x_tr[0], x_tr[1])
    # 팔로우: A→X, B→X(겹침), X→B, B→A(자기 자신 될 것), P→B
    await c.execute("INSERT INTO follows (follower_id, followee_id) VALUES ($1,$3),($2,$3),($3,$2),($2,$1),($4,$2)", A, B, X, P)
    # 크루: B 가 크루장, A 는 그 크루 멤버
    club = await m.clubs.insert_one({"owner_id": sB, "name": "c1", "name_lc": "c1", "member_count": 2})
    cid = str(club.inserted_id)
    await m.club_members.insert_many([{"club_id": cid, "user_id": sB, "role": "owner"}, {"club_id": cid, "user_id": sA, "role": "member"}])
    # DM: B–P(A–P 도 있음 → 합치기), B–X(이동), A–B(삭제)
    def conv(a, b, last, unread):
        k, parts = am._pair(a, b)
        return {"pair_key": k, "participants": parts, "requester_id": a, "status": "accepted", "last_at": last,
                "last_message_text": "hi", "last_sender_id": a, "unread": unread}
    now = datetime.now(timezone.utc)
    cAP = (await m.dm_conversations.insert_one(conv(sA, sP, now - timedelta(days=2), {sA: 0, sP: 1}))).inserted_id
    cBP = (await m.dm_conversations.insert_one(conv(sB, sP, now, {sB: 2, sP: 0}))).inserted_id
    cBX = (await m.dm_conversations.insert_one(conv(sB, sX, now, {sB: 0, sX: 1}))).inserted_id
    cAB = (await m.dm_conversations.insert_one(conv(sA, sB, now, {sA: 0, sB: 0}))).inserted_id
    await m.dm_messages.insert_many([{"conversation_id": str(cBP), "sender_id": sB, "text": "b-p"},
                                     {"conversation_id": str(cAB), "sender_id": sA, "text": "a-b"},
                                     {"conversation_id": str(cBX), "sender_id": sB, "text": "b-x"}])
    await m.dm_blocks.insert_one({"blocker_id": sB, "blocked_id": sX})
    await get_redis().set(f"session:{sB}", "{}")

    # 1) 스위치 꺼짐 → duplicate (기존 동작)
    os.environ.pop("ACCOUNT_MERGE_ENABLED", None)
    rid0, row0 = await new_rid(c, B)
    out = await callback(c, rid0, row0)
    check("off: duplicate", out["status"] == "duplicate", out)

    # 2) 켜짐 → merge_candidate, 결과 보류(B 미반영)
    os.environ["ACCOUNT_MERGE_ENABLED"] = "true"
    rid, row = await new_rid(c, B)
    out = await callback(c, rid, row)
    check("on: merge_candidate", out["status"] == "merge_candidate", out)
    b = await c.fetchrow("SELECT is_verified, ci_hash, birth_date FROM users WHERE id=$1", B)
    check("pending not applied to B", (not b["is_verified"]) and b["ci_hash"] is None and b["birth_date"] == date(1990, 1, 1), dict(b))
    res = await idr.identity_result(rid, current_user={"id": sB}, conn=c)
    check("result merge_candidate flag", res.get("merge_candidate") is True, res)

    # 3) 미리보기
    code, pv = body(await idr.merge_preview(rid, current_user={"id": sB}, conn=c))
    cards = {a["id"]: a for a in pv.get("accounts", [])}
    check("preview 2 cards", code == 200 and len(cards) == 2, pv)
    check("preview counts", cards.get(sB, {}).get("tracks") == 2 and cards.get(sA, {}).get("tracks") == 1
          and cards[sB]["stars"] == 70 and cards[sB]["is_current"] and not cards[sA]["is_current"], pv)
    check("preview login methods/mask", cards[sA]["login_methods"] == ["kakao"] and cards[sB]["login_methods"] == ["email"]
          and cards[sB]["email_masked"].startswith("Se***@"), pv)
    check("preview not blocked", pv.get("blocked_reason") is None, pv)
    code, _ = body(await idr.merge_preview(rid, current_user={"id": sP}, conn=c))
    check("preview other user 404", code == 404)

    # 4) 차단 사유
    j = await m.gen_jobs.insert_one({"user_id": sA, "status": "running"})
    check("blocked jobs_running", await am.blocked_reason(c, B, A) == "jobs_running")
    code, cf = body(await idr.merge_confirm(idr.MergeConfirmBody(rid=rid, keep_user_id=sA), current_user={"id": sB}, conn=c))
    check("confirm blocked 409", code == 409 and cf.get("blocked_reason") == "jobs_running", cf)
    await m.gen_jobs.update_one({"_id": j.inserted_id}, {"$set": {"status": "done"}})
    c2 = await m.clubs.insert_one({"owner_id": sA, "name": "c2", "name_lc": "c2", "member_count": 1})
    check("blocked two_crews", await am.blocked_reason(c, B, A) == "two_crews")
    await m.clubs.delete_one({"_id": c2.inserted_id})
    code, cf = body(await idr.merge_confirm(idr.MergeConfirmBody(rid=rid, keep_user_id=sP), current_user={"id": sB}, conn=c))
    check("confirm invalid keep 400", code == 400, cf)

    # 5) 통합: 지금 계정 B 에서 A(먼저 인증한 계정)를 남김
    code, cf = body(await idr.merge_confirm(idr.MergeConfirmBody(rid=rid, keep_user_id=sA), current_user={"id": sB}, conn=c))
    check("confirm merged + token for A", code == 200 and cf.get("status") == "merged" and cf.get("user", {}).get("id") == sA
          and bool(cf.get("token")), cf)
    check("session B dropped, A created", (await get_redis().get(f"session:{sB}")) is None and bool(await get_redis().get(f"session:{sA}")))
    ub = await c.fetchrow("SELECT * FROM users WHERE id=$1", B)
    check("B merged marker", ub["account_status"] == "merged" and ub["merged_into"] == A and ub["merged_at"] is not None, dict(ub))
    check("B pii wiped, login keys kept", ub["email"].endswith("@removed.invalid") and ub["nickname"] == am.MERGED_NICKNAME
          and ub["birth_date"] is None and ub["password_hash"] == "$2b$12$fakehash" and ub["provider"] == "local" and ub["ci_hash"] is None)
    check("B merged_email_hash", ub["merged_email_hash"] == hashlib.sha256(b"second@example.com").hexdigest(), ub["merged_email_hash"])
    ua = await c.fetchrow("SELECT * FROM users WHERE id=$1", A)
    check("A verified with new result", ua["is_verified"] and ua["birth_date"] == date(1992, 3, 4) and ua["gender"] == "female" and ua["ci_hash"] == h)
    check("tracks moved + nickname", await m.tracks.count_documents({"uploader_id": sA}) == 3
          and await m.tracks.count_documents({"uploader_id": sA, "uploader_nickname": "올드"}) == 3
          and await m.tracks.count_documents({"uploader_id": sB}) == 0)
    check("artists/feeds moved", await m.characters.count_documents({"user_id": sA}) == 2 and await m.feeds.count_documents({"author_id": sA}) == 2)
    bal = {d["user_id"]: d["balance"] async for d in m.point_balances.find({})}
    check("stars all moved (+30 verify bonus once)", bal.get(sA) == 100 + 70 + 30 and bal.get(sB) == 0, bal)
    check("merge event", await m.point_events.count_documents({"user_id": sA, "action": "account_merge", "track_id": sB, "amount": 70}) == 1)
    slots = {d["user_id"]: d.get("extra_slots") async for d in m.user_slots.find({})}
    check("slots summed", slots == {sA: 3}, slots)
    check("attendance unique kept A", await m.attendance_progress.count_documents({"user_id": {"$in": [sA, sB]}}) == 1
          and (await m.attendance_progress.find_one({"user_id": sA}))["streak"] == 3)
    likes = await c.fetch("SELECT user_id, track_id FROM likes ORDER BY track_id")
    check("likes deduped", sorted((str(r["user_id"]), r["track_id"]) for r in likes) == sorted([(sA, x_tr[0]), (sA, x_tr[1])]), likes)
    check("like_count corrected", (await m.tracks.find_one({"_id": ObjectId(x_tr[0])}))["like_count"] == 1)
    fol = sorted((str(r[0]), str(r[1])) for r in await c.fetch("SELECT follower_id, followee_id FROM follows"))
    check("follows merged", fol == sorted([(sA, sX), (sX, sA), (sP, sA)]), fol)
    club_doc = await m.clubs.find_one({"_id": ObjectId(cid)})
    mem = [(d["user_id"], d["role"]) async for d in m.club_members.find({"club_id": cid})]
    check("crew owner moved, member deduped", club_doc["owner_id"] == sA and mem == [(sA, "owner")] and club_doc["member_count"] == 1, (club_doc, mem))
    convs = [d async for d in m.dm_conversations.find({})]
    keys = sorted(d["pair_key"] for d in convs)
    check("dm convs merged/moved/dropped", keys == sorted([am._pair(sA, sP)[0], am._pair(sA, sX)[0]]), keys)
    ap = await m.dm_conversations.find_one({"_id": cAP})
    check("dm A-P gets B-P messages + unread", await m.dm_messages.count_documents({"conversation_id": str(cAP)}) == 1
          and ap["unread"].get(sA) == 2 and ap["unread"].get(sP) == 1 and ap["last_sender_id"] == sA, ap)
    check("dm A-B messages deleted", await m.dm_messages.count_documents({"conversation_id": str(cAB)}) == 0)
    check("dm sender repointed", await m.dm_messages.count_documents({"sender_id": sB}) == 0)
    check("dm block moved", await m.dm_blocks.count_documents({"blocker_id": sA, "blocked_id": sX}) == 1)
    ivr = await c.fetchrow("SELECT status FROM identity_verifications WHERE id=$1", rid)
    check("verification marked merged", ivr["status"] == "merged")
    jr = await m[am.JOURNAL].find_one({"_id": rid})
    check("journal done, verify payload removed", jr["status"] == "done" and "verify" not in jr)

    # 6) 다시 눌러도(재실행) 이중 지급 없음
    code, cf2 = body(await idr.merge_confirm(idr.MergeConfirmBody(rid=rid, keep_user_id=sA), current_user={"id": sB}, conn=c))
    check("confirm again idempotent", cf2.get("status") == "merged" and (await m.point_balances.find_one({"user_id": sA}))["balance"] == 200, cf2)
    r2 = await am.run_merge(c, rid)
    check("run_merge again no-op", r2.get("status") == "done" and (await m.point_balances.find_one({"user_id": sA}))["balance"] == 200)

    # 7) 거절 경로 — 새 사람 C(이메일 가입)가 A 와 같은 DI
    C = await mk_user(c, "third@example.com", "써드")
    ridc, rowc = await new_rid(c, C)
    out = await callback(c, ridc, rowc)
    check("C merge_candidate vs A", out["status"] == "merge_candidate"
          and (await c.fetchval("SELECT merge_with FROM identity_verifications WHERE id=$1", ridc)) == A)
    code, dc = body(await idr.merge_decline(idr.MergeDeclineBody(rid=ridc), current_user={"id": str(C)}, conn=c))
    rc = await c.fetchrow("SELECT status, pending_ci_hash, pending_birth_date FROM identity_verifications WHERE id=$1", ridc)
    uc = await c.fetchrow("SELECT is_verified, ci_hash, account_status FROM users WHERE id=$1", C)
    check("decline", dc.get("status") == "declined" and rc["status"] == "declined" and rc["pending_ci_hash"] is None
          and not uc["is_verified"] and uc["ci_hash"] is None and uc["account_status"] == "active", (dc, dict(rc), dict(uc)))
    code, _ = body(await idr.merge_confirm(idr.MergeConfirmBody(rid=ridc, keep_user_id=sA), current_user={"id": str(C)}, conn=c))
    check("confirm after decline 404", code == 404)

    # 8) 시간 지난 제안 → 404
    D = await mk_user(c, "fourth@example.com", "포스")
    ridd, rowd = await new_rid(c, D)
    await callback(c, ridd, rowd)
    await c.execute("UPDATE identity_verifications SET completed_at = now() - interval '25 hours' WHERE id=$1", ridd)
    code, _ = body(await idr.merge_preview(ridd, current_user={"id": str(D)}, conn=c))
    check("expired preview 404", code == 404)

    # 9) 중간에 멈춘 통합 재개 — E(이메일)에서 E 를 남김(현재 계정 유지), points 단계까지만 하고 멈춘 상황
    E = await mk_user(c, "fifth@example.com", "피프스")
    await m.point_balances.insert_one({"user_id": str(E), "balance": 5})
    await seed_content(m, E, 1, "피프스")
    ride, rowe = await new_rid(c, E)
    await callback(c, ride, rowe)
    a_before = (await m.point_balances.find_one({"user_id": sA}))["balance"]
    verify = {"ci_hash": h, "gender": "female", "birth_date": "1992-03-04", "verify_provider": "identity:mock",
              "source_email_hash": None}
    await am.start_journal(ride, A, E, E, verify)
    await am._step_mongo_repoint(sA, str(E), "피프스", {})
    await am._step_points(ride, sA, str(E))
    await m[am.JOURNAL].update_one({"_id": ride}, {"$set": {"steps.mongo": True, "updated_at": now - timedelta(minutes=10)}})
    # points 단계 표식 전에 멈춤 → 재개 시 points 다시 실행돼도 이중 지급 없어야
    await get_redis().set(f"session:{sA}", "{}")
    code, st = body(await idr.merge_status(ride, current_user={"id": str(E)}, conn=c))
    eb = (await m.point_balances.find_one({"user_id": str(E)}))["balance"]
    check("resume completes", st.get("status") == "merged" and st["user"]["id"] == str(E), st)
    check("resume no double stars (+30 first verify bonus for E)", eb == 5 + a_before + 30 and (await m.point_balances.find_one({"user_id": sA}))["balance"] == 0, (eb, a_before))
    check("resume dropped source session", (await get_redis().get(f"session:{sA}")) is None)
    ua = await c.fetchrow("SELECT account_status, merged_into, merged_email_hash FROM users WHERE id=$1", A)
    check("chain: A merged into E (social → no email hash)", ua["account_status"] == "merged" and ua["merged_into"] == E
          and ua["merged_email_hash"] is None)
    check("all content now on E", await m.tracks.count_documents({"uploader_id": str(E)}) == 4)

    # 9b) v3.355 — 본인확인 성인이면 age14 자동 기록(이메일 가입은 체크 없음), 미성년·기존 기록은 그대로
    async def age14_rows(u):
        return [tuple(r) for r in await c.fetch(
            "SELECT agreed, version FROM user_consents WHERE user_id=$1 AND consent_key='age14'", u)]
    check("merge target got age14 (identity)", (True, "identity") in await age14_rows(E))
    F = await mk_user(c, "sixth@example.com", "식스")
    ridf, rowf = await new_rid(c, F)
    outf = await callback(c, ridf, rowf, ci="DI-OTHER-ADULT")
    check("verified adult → age14 identity", outf["status"] == "verified" and await age14_rows(F) == [(True, "identity")], (outf, await age14_rows(F)))
    ridf2, rowf2 = await new_rid(c, F)
    await callback(c, ridf2, rowf2, ci="DI-OTHER-ADULT")
    check("no duplicate age14 on re-verify", len(await age14_rows(F)) == 1)
    G = await mk_user(c, "kid@example.com", "키드")
    ridg, rowg = await new_rid(c, G)
    resg = iv.IdentityResult(birth_date=date(2016, 5, 5), gender="male", ci="DI-KID")
    outg = await idr._apply_result(c, rowg, "mock", resg)
    check("under-14 → no age14", outg.get("under_14") is True and await age14_rows(G) == [])
    H = await mk_user(c, "had@example.com", "해드")
    await c.execute("INSERT INTO user_consents (user_id, consent_key, agreed, version) VALUES ($1,'age14',TRUE,'2026-07-23.v1')", H)
    ridh, rowh = await new_rid(c, H)
    await callback(c, ridh, rowh, ci="DI-HAD")
    check("existing age14 kept, not duplicated", await age14_rows(H) == [(True, "2026-07-23.v1")])

    # 10) 운영·공식 계정은 통합 불가
    O = await mk_user(c, "official@example.com", "운영", role="admin")
    check("special account blocked", await am.blocked_reason(c, O, X) == "special_account")

    await c.close()
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    sys.exit(1 if FAIL else 0)


asyncio.run(main())
