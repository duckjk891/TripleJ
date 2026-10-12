"""[AccountMerge 2026-10-12] 1인 1계정 — 같은 사람(본인확인 DI 일치) 계정 통합.

대표 결정(2026-10-12): 남길 계정은 사용자가 고른다 · 별은 보너스 포함 전부 이관 · 본인인증을 안 하는 사람은 그대로.
흐름: identity 콜백에서 DI 가 다른 활성 계정과 같으면 merge_candidate → 앱 통합 화면 → confirm → run_merge().

S = 남기지 않는 계정(source), T = 남기는 계정(target).
- 콘텐츠·작업·알림 등 user_id 류 필드를 S→T 로 바꾼다(유일 인덱스 충돌 시 T 쪽을 남기고 S 문서 삭제).
- 별 잔액·추가 슬롯은 T 에 합산, 별 이력은 S 에 남기고 T 에 account_merge 이벤트 1건.
- 좋아요·팔로우·크루 멤버·DM 은 겹침을 정리해 합친다. S↔T 사이 관계·대화는 지운다.
- S 는 account_status='merged', merged_into=T. 개인정보는 탈퇴처럼 파기하되 로그인 연결용으로
  provider·provider_user_id·password_hash 와 merged_email_hash(sha256(lower(trim(email))))는 남긴다.
- 통계·로그(play_logs·download_logs·analytics_events·ad_*·search_*)는 옮기지 않는다(재생수 규칙 보존).
작업 일지(Mongo account_merges, _id=rid)에 단계별로 기록 → 중간에 서버가 재기동돼도 resume_pending_merges()로 이어서 완료.
로그 규칙: 사용자·rid 앞 8자만, 이메일·DI·생년월일 값 금지.
"""

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from ..database.mongodb import get_mongo
from ..database.redis import get_redis

logger = logging.getLogger(__name__)

JOURNAL = "account_merges"
MERGED_NICKNAME = "통합된계정"
RESUME_AFTER = timedelta(minutes=2)

# (컬렉션, 사용자 필드, 닉네임 캐시 필드|None) — 주인만 바꾸면 되는 것
MONGO_REPOINT = [
    ("characters", "user_id", None),
    ("character_jobs", "user_id", None),
    ("character_locations", "user_id", None),
    ("tracks", "uploader_id", "uploader_nickname"),
    ("albums", "owner_id", "owner_nickname"),
    ("feeds", "author_id", "author_nickname"),
    ("feed_comments", "author_id", "author_nickname"),
    ("track_comments", "author_id", "author_nickname"),
    ("generations", "user_id", "user_nickname"),
    ("gen_jobs", "user_id", None),
    ("lyrics_assets", "user_id", None),
    ("cover_sessions", "user_id", None),
    ("voice_clones", "user_id", None),
    ("voice_samples", "user_id", None),
    ("vocal_repairs", "user_id", None),
    ("inst_jobs", "user_id", None),
    ("mv_jobs", "user_id", None),
    ("notifications", "user_id", None),
    ("cs_cases", "user_id", None),
    ("issue_reports", "user_id", None),
    ("dm_messages", "sender_id", None),
    ("club_chat_messages", "sender_id", None),
    ("crew_rp_events", "user_id", None),
    ("recognition_events", "user_id", None),
    ("push_subscriptions", "user_id", None),
    ("apple_tokens", "user_id", None),
    ("business_profiles", "user_id", None),
    ("club_promo_receipts", "user_id", None),
    ("club_join_requests", "user_id", None),
    ("attendance_progress", "user_id", None),
    ("weekly_mission_progress", "user_id", None),
    ("tutorial_seen", "user_id", None),
    ("director_fatigue", "user_id", None),
    ("face_verify_exemptions", "user_id", None),
]

# 진행 중 작업(재기동 가드와 같은 기준) — 있으면 통합하지 않는다
_ACTIVE = ["pending", "queued", "running", "processing", "generating"]


def _u8(v) -> str:
    return str(v)[:8]


def email_hash(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return hashlib.sha256(e.encode("utf-8")).hexdigest() if e else None


def mask_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email or email.endswith(".invalid"):
        return None
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}"


def login_methods(row) -> list:
    out = []
    prov = (row["provider"] or "").strip().lower()
    if prov in ("google", "kakao", "naver", "apple"):
        out.append(prov)
    if row["has_password"]:
        out.append("email")
    if not out:
        out.append("email" if prov in ("", "local") else prov)
    return out


async def ensure_schema(conn) -> None:
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into UUID")
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ")
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_email_hash TEXT")
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_users_merged_email_hash ON users(merged_email_hash) WHERE merged_email_hash IS NOT NULL")


# ── 미리보기·차단 사유 ────────────────────────────────────────────────────────

async def _user_row(conn, uid):
    return await conn.fetchrow(
        """SELECT id, email, nickname, provider, created_at, role, is_banned, account_status,
                  (password_hash IS NOT NULL AND password_hash <> '') AS has_password
           FROM users WHERE id = $1""", uid)


async def account_card(conn, uid, current_id) -> Optional[dict]:
    row = await _user_row(conn, uid)
    if not row:
        return None
    mongo = get_mongo()
    sid = str(uid)
    bal = await mongo.point_balances.find_one({"user_id": sid}, {"balance": 1})
    return {
        "id": sid,
        "is_current": sid == str(current_id),
        "login_methods": login_methods(row),
        "nickname": row["nickname"],
        "email_masked": mask_email(row["email"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "artists": await mongo.characters.count_documents({"user_id": sid}),
        "tracks": await mongo.tracks.count_documents({"uploader_id": sid}),
        "feeds": await mongo.feeds.count_documents({"author_id": sid}),
        "stars": int((bal or {}).get("balance") or 0),
    }


async def blocked_reason(conn, a, b) -> Optional[str]:
    """통합할 수 없는 사유 — None 이면 가능.
    jobs_running(만드는 중) · two_crews(둘 다 크루장 — 위임 후 가능) · account_restricted(정지·제한) · special_account(운영·공식)."""
    rows = [await _user_row(conn, a), await _user_row(conn, b)]
    if any(r is None for r in rows):
        return "account_restricted"
    for r in rows:
        if (r["role"] or "user") != "user":
            return "special_account"
        if r["is_banned"] or (r["account_status"] or "active") != "active":
            return "account_restricted"
    mongo = get_mongo()
    ids = [str(a), str(b)]
    since = datetime.now(timezone.utc) - timedelta(minutes=30)
    busy = (
        await mongo.gen_jobs.count_documents({"user_id": {"$in": ids}, "status": {"$in": _ACTIVE}})
        or await mongo.generations.count_documents({"user_id": {"$in": ids}, "status": {"$in": _ACTIVE},
                                                     "created_at": {"$gte": since}})
        or await mongo.character_jobs.count_documents({"user_id": {"$in": ids}, "status": "processing"})
        or await mongo.inst_jobs.count_documents({"user_id": {"$in": ids}, "status": {"$in": _ACTIVE}})
        or await mongo.mv_jobs.count_documents({"user_id": {"$in": ids}, "status": {"$in": _ACTIVE}})
    )
    if busy:
        return "jobs_running"
    if await mongo.clubs.count_documents({"owner_id": {"$in": ids}}) >= 2:
        return "two_crews"
    return None


# ── 단계 ────────────────────────────────────────────────────────────────────

async def _repoint(coll, field: str, nick_field: Optional[str], s: str, t: str, t_nick: str) -> int:
    """S→T. 유일 인덱스 충돌이면 T 쪽 문서를 남기고 S 문서는 지운다."""
    upd = {field: t}
    if nick_field:
        upd[nick_field] = t_nick
    try:
        res = await coll.update_many({field: s}, {"$set": upd})
        return res.modified_count
    except DuplicateKeyError:
        pass
    moved = 0
    async for doc in coll.find({field: s}, {"_id": 1}):
        try:
            await coll.update_one({"_id": doc["_id"]}, {"$set": upd})
            moved += 1
        except DuplicateKeyError:
            await coll.delete_one({"_id": doc["_id"]})
    return moved


async def _step_mongo_repoint(s, t, t_nick, counts):
    mongo = get_mongo()
    for name, field, nick in MONGO_REPOINT:
        n = await _repoint(mongo[name], field, nick, s, t, t_nick)
        if n:
            counts[name] = n


async def _step_points(rid, s, t):
    """별 전부 이관 — S 잔액을 먼저 원자적으로 0으로 만들고(일지에 금액 기록) T 에 더한다."""
    mongo = get_mongo()
    j = await mongo[JOURNAL].find_one({"_id": rid}, {"points_taken": 1})
    taken = (j or {}).get("points_taken")
    if taken is None:
        old = await mongo.point_balances.find_one_and_update({"user_id": s}, {"$set": {"balance": 0}})
        taken = int((old or {}).get("balance") or 0)
        await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {"points_taken": taken}})
    if taken > 0:
        now = datetime.now(timezone.utc)
        try:
            await mongo.point_events.insert_one({"user_id": t, "action": "account_merge", "track_id": s, "day": "-",
                                                 "amount": taken, "created_at": now})
        except DuplicateKeyError:
            return taken  # 이미 지급(재개)
        await mongo.point_balances.update_one({"user_id": t}, {"$inc": {"balance": taken},
                                                               "$setOnInsert": {"created_at": now}}, upsert=True)
    return taken


async def _step_slots(rid, s, t):
    """추가 슬롯 합산 — 아티스트 수가 한도를 넘어도 그대로 둔다(통합분 예외)."""
    mongo = get_mongo()
    j = await mongo[JOURNAL].find_one({"_id": rid}, {"slots_taken": 1, "slots_given": 1}) or {}
    taken = j.get("slots_taken")
    if taken is None:
        old = await mongo.user_slots.find_one_and_delete({"user_id": s})
        taken = int((old or {}).get("extra_slots") or 0)
        await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {"slots_taken": taken}})
    if taken > 0 and not j.get("slots_given"):
        await mongo.user_slots.update_one({"user_id": t}, {"$inc": {"extra_slots": taken},
                                                           "$set": {"updated_at": datetime.now(timezone.utc)}}, upsert=True)
    await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {"slots_given": True}})
    return taken


_ROLE_RANK = {"owner": 3, "manager": 2, "admin": 2, "member": 1}


async def _step_clubs(s, t):
    mongo = get_mongo()
    if not await mongo.clubs.find_one({"owner_id": t}, {"_id": 1}):
        await mongo.clubs.update_many({"owner_id": s}, {"$set": {"owner_id": t}})
    n = 0
    async for m in mongo.club_members.find({"user_id": s}):
        mine = await mongo.club_members.find_one({"club_id": m["club_id"], "user_id": t})
        if mine is None:
            await mongo.club_members.update_one({"_id": m["_id"]}, {"$set": {"user_id": t}})
        else:
            # 둘 다 멤버 — 높은 역할 쪽을 남기고 인원 1 감소
            if _ROLE_RANK.get(m.get("role") or "member", 1) > _ROLE_RANK.get(mine.get("role") or "member", 1):
                await mongo.club_members.delete_one({"_id": mine["_id"]})
                await mongo.club_members.update_one({"_id": m["_id"]}, {"$set": {"user_id": t}})
            else:
                await mongo.club_members.delete_one({"_id": m["_id"]})
            await _dec_count(mongo.clubs, m["club_id"], "member_count")
        n += 1
    return n


def _pair(a, b):
    x, y = sorted([str(a), str(b)])
    return f"{x}_{y}", [x, y]


async def _step_dm(s, t):
    mongo = get_mongo()
    moved = merged = dropped = 0
    async for c in mongo.dm_conversations.find({"participants": s}):
        cid = str(c["_id"])
        peer = next((p for p in c.get("participants") or [] if p != s), None)
        if peer is None or peer == t:
            await mongo.dm_messages.delete_many({"conversation_id": cid})
            await mongo.dm_conversations.delete_one({"_id": c["_id"]})
            dropped += 1
            continue
        key, parts = _pair(t, peer)
        tc = await mongo.dm_conversations.find_one({"pair_key": key})
        unread = c.get("unread") or {}
        if tc is None:
            new_unread = {peer: int(unread.get(peer, 0) or 0), t: int(unread.get(s, 0) or 0)}
            upd = {"participants": parts, "pair_key": key, "unread": new_unread}
            if c.get("requester_id") == s:
                upd["requester_id"] = t
            if c.get("last_sender_id") == s:
                upd["last_sender_id"] = t
            await mongo.dm_conversations.update_one({"_id": c["_id"]}, {"$set": upd})
            moved += 1
            continue
        tcid = str(tc["_id"])
        await mongo.dm_messages.update_many({"conversation_id": cid}, {"$set": {"conversation_id": tcid}})
        upd = {}
        if (c.get("last_at") and (not tc.get("last_at") or c["last_at"] > tc["last_at"])):
            upd.update({"last_at": c["last_at"], "last_message_text": c.get("last_message_text"),
                        "last_sender_id": t if c.get("last_sender_id") == s else c.get("last_sender_id")})
        if c.get("status") == "accepted" and tc.get("status") != "accepted":
            upd.update({"status": "accepted", "accepted_at": c.get("accepted_at")})
        inc = {f"unread.{t}": int(unread.get(s, 0) or 0), f"unread.{peer}": int(unread.get(peer, 0) or 0)}
        await mongo.dm_conversations.update_one({"_id": tc["_id"]}, {**({"$set": upd} if upd else {}), "$inc": inc})
        await mongo.dm_conversations.delete_one({"_id": c["_id"]})
        merged += 1
    # 차단 목록
    async for b in mongo.dm_blocks.find({"$or": [{"blocker_id": s}, {"blocked_id": s}]}):
        blocker = t if b.get("blocker_id") == s else b.get("blocker_id")
        blocked = t if b.get("blocked_id") == s else b.get("blocked_id")
        if blocker == blocked:
            await mongo.dm_blocks.delete_one({"_id": b["_id"]})
            continue
        try:
            await mongo.dm_blocks.update_one({"_id": b["_id"]}, {"$set": {"blocker_id": blocker, "blocked_id": blocked}})
        except DuplicateKeyError:
            await mongo.dm_blocks.delete_one({"_id": b["_id"]})
    return {"moved": moved, "merged": merged, "dropped": dropped}


async def _dedupe_pg(conn, table: str, key: str, S, T) -> list:
    """(user_id, key) 유일 테이블 — S 행을 T 로. 겹치는 S 행은 지우고 그 key 목록을 돌려준다."""
    await conn.execute(
        f"""UPDATE {table} x SET user_id = $2 WHERE x.user_id = $1
            AND NOT EXISTS (SELECT 1 FROM {table} y WHERE y.user_id = $2 AND y.{key} = x.{key})""", S, T)
    rows = await conn.fetch(f"DELETE FROM {table} WHERE user_id = $1 RETURNING {key}", S)
    return [r[key] for r in rows]


async def _step_pg(conn, rid, S, T, verify: dict, counts: dict):
    """Postgres 한 트랜잭션 — 관계 정리 + S 표식·파기 + T 본인확인 반영. 재실행해도 안전."""
    dropped_likes: list = []
    dropped_feed_likes: list = []
    async with conn.transaction():
        await conn.execute("UPDATE playlists SET user_id = $2 WHERE user_id = $1", S, T)
        dropped_likes = await _dedupe_pg(conn, "likes", "track_id", S, T)
        dropped_feed_likes = await _dedupe_pg(conn, "feed_likes", "feed_id", S, T)
        await _dedupe_pg(conn, "ad_wishlist", "item_id", S, T)
        # 팔로우: S→T 로 옮기되 겹침·자기 자신 팔로우는 제거
        await conn.execute(
            """UPDATE follows f SET follower_id = $2 WHERE f.follower_id = $1 AND f.followee_id <> $2
               AND NOT EXISTS (SELECT 1 FROM follows g WHERE g.follower_id = $2 AND g.followee_id = f.followee_id)""", S, T)
        await conn.execute(
            """UPDATE follows f SET followee_id = $2 WHERE f.followee_id = $1 AND f.follower_id <> $2
               AND NOT EXISTS (SELECT 1 FROM follows g WHERE g.followee_id = $2 AND g.follower_id = f.follower_id)""", S, T)
        await conn.execute("DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1", S)
        await conn.execute("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $1", T)
        await conn.execute("UPDATE reports SET reporter_id = $2 WHERE reporter_id = $1", S, T)
        await conn.execute("UPDATE report_appeals SET user_id = $2 WHERE user_id = $1", S, T)
        await conn.execute("UPDATE face_photo_verifications SET user_id = $2 WHERE user_id = $1", S, T)
        await conn.execute(
            """UPDATE face_biometrics SET user_id = $2 WHERE user_id = $1
               AND NOT EXISTS (SELECT 1 FROM face_biometrics WHERE user_id = $2)""", S, T)
        await conn.execute("DELETE FROM face_biometrics WHERE user_id = $1", S)
        # S — 통합 표식 + 개인정보 파기(로그인 연결용 provider·password_hash·merged_email_hash 는 남김)
        await conn.execute(
            """UPDATE users SET
                   merged_email_hash = CASE WHEN password_hash IS NOT NULL AND password_hash <> '' THEN $3 ELSE NULL END,
                   email = $4, nickname = $5, profile_image = NULL, bio = NULL, company_name = NULL,
                   display_title = NULL, birth_year = NULL, birth_date = NULL, gender = NULL, region = NULL,
                   nationality = NULL, sns_links = '[]'::jsonb, is_verified = FALSE, verify_provider = NULL,
                   ci_hash = NULL, account_status = 'merged', merged_into = $2, merged_at = now(), updated_at = now()
               WHERE id = $1 AND COALESCE(account_status, 'active') <> 'merged'""",
            S, T, verify.get("source_email_hash"), f"merged_{uuid.uuid4().hex}@removed.invalid", MERGED_NICKNAME,
        )
        # T — 이번 본인확인 결과 반영(_apply_result 와 같은 필드)
        await conn.execute(
            """UPDATE users SET is_verified = TRUE, verified_at = now(), verify_provider = $2,
                      birth_date = $3, gender = COALESCE($4, gender), ci_hash = COALESCE($5, ci_hash)
               WHERE id = $1""",
            T, verify.get("verify_provider"), verify.get("birth_date"), verify.get("gender"), verify.get("ci_hash"),
        )
    # 겹친 좋아요만큼 곡·피드 좋아요 수 보정
    mongo = get_mongo()
    for tid in dropped_likes:
        await _dec_count(mongo.tracks, tid, "like_count")
    for fid in dropped_feed_likes:
        await _dec_count(mongo.feeds, fid, "like_count")
    counts["likes_dedup"] = len(dropped_likes) + len(dropped_feed_likes)


async def _dec_count(coll, any_id, field):
    from bson import ObjectId
    q = {"_id": ObjectId(any_id)} if ObjectId.is_valid(str(any_id)) else {"_id": any_id}
    await coll.update_one({**q, field: {"$gt": 0}}, {"$inc": {field: -1}})


# ── 실행·재개 ────────────────────────────────────────────────────────────────

STEPS = ("mongo", "points", "slots", "clubs", "dm", "pg", "bonus")


async def start_journal(rid: str, source, target, current_id, verify: dict) -> str:
    """일지 생성 — 이미 있으면 그 상태('running'|'done'|'failed')를 돌려준다. 새로 만들면 'new'."""
    mongo = get_mongo()
    now = datetime.now(timezone.utc)
    try:
        await mongo[JOURNAL].insert_one({
            "_id": rid, "source": str(source), "target": str(target), "requested_by": str(current_id),
            "status": "running", "steps": {}, "verify": verify, "counts": {},
            "started_at": now, "updated_at": now,
        })
        return "new"
    except DuplicateKeyError:
        j = await mongo[JOURNAL].find_one({"_id": rid}, {"status": 1})
        return (j or {}).get("status") or "running"


async def run_merge(conn, rid: str) -> dict:
    """일지대로 남은 단계를 실행. 끝나면 {'status':'done', ...}. 단계는 모두 재실행해도 안전."""
    mongo = get_mongo()
    j = await mongo[JOURNAL].find_one({"_id": rid})
    if not j:
        return {"status": "missing"}
    if j["status"] == "done":
        return j
    s, t = j["source"], j["target"]
    S, T = uuid.UUID(s), uuid.UUID(t)
    steps = dict(j.get("steps") or {})
    counts = dict(j.get("counts") or {})
    verify = dict(j.get("verify") or {})
    if verify.get("birth_date"):  # 일지에는 ISO 문자열로 보관(BSON 은 date 불가)
        from datetime import date as _date
        verify["birth_date"] = _date.fromisoformat(str(verify["birth_date"])[:10])
    t_nick = await conn.fetchval("SELECT nickname FROM users WHERE id = $1", T) or ""

    async def mark(step):
        steps[step] = True
        await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {f"steps.{step}": True, "counts": counts,
                                                               "updated_at": datetime.now(timezone.utc)}})
    try:
        if not steps.get("mongo"):
            await _step_mongo_repoint(s, t, t_nick, counts)
            await mark("mongo")
        if not steps.get("points"):
            counts["stars"] = await _step_points(rid, s, t)
            await mark("points")
        if not steps.get("slots"):
            counts["extra_slots"] = await _step_slots(rid, s, t)
            await mark("slots")
        if not steps.get("clubs"):
            counts["club_members"] = await _step_clubs(s, t)
            await mark("clubs")
        if not steps.get("dm"):
            counts["dm"] = await _step_dm(s, t)
            await mark("dm")
        if not steps.get("pg"):
            # pg 단계 직전에 한 번 더 — 그사이 S 로 새로 생긴 콘텐츠도 옮긴다
            await _step_mongo_repoint(s, t, t_nick, counts)
            await _step_pg(conn, rid, S, T, verify, counts)
            await mark("pg")
        if not steps.get("bonus"):
            try:
                from .points_service import credit_points
                await credit_points(t, "verify_bonus", 30, ref="-", day="-")  # 1회 보상(멱등) — T 기준
            except Exception:  # noqa: BLE001
                logger.exception("[merge] verify_bonus failed rid=%s", rid[:8])
            await mark("bonus")
        await conn.execute("UPDATE identity_verifications SET status = 'merged', completed_at = now() WHERE id = $1", rid)
        now = datetime.now(timezone.utc)
        await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {"status": "done", "finished_at": now, "updated_at": now,
                                                               "counts": counts}, "$unset": {"verify": ""}})
        logger.info("[merge] done rid=%s source=%s target=%s counts=%s", rid[:8], _u8(s), _u8(t), counts)
        return {"status": "done", "source": s, "target": t, "counts": counts}
    except Exception as e:  # noqa: BLE001 — 일지에 남기고 재개 대상으로 둔다
        logger.exception("[merge] step failed rid=%s steps=%s", rid[:8], list(steps))
        await mongo[JOURNAL].update_one({"_id": rid}, {"$set": {"last_error": type(e).__name__,
                                                               "updated_at": datetime.now(timezone.utc)}})
        return {"status": "running"}


async def drop_session(user_id) -> None:
    try:
        await get_redis().delete(f"session:{user_id}")
    except Exception:  # noqa: BLE001
        logger.warning("[merge] session delete failed user=%s", _u8(user_id))


async def resume_pending_merges(conn) -> int:
    """멈춘 통합 이어서 완료 — 서버 시작 시(lifespan) 또는 상태 조회 때 호출. 완료하면 S 세션도 지운다."""
    mongo = get_mongo()
    cutoff = datetime.now(timezone.utc) - RESUME_AFTER
    n = 0
    async for j in mongo[JOURNAL].find({"status": "running", "updated_at": {"$lt": cutoff}}, {"_id": 1}):
        r = await run_merge(conn, j["_id"])
        if r.get("status") == "done":
            await drop_session(r["source"])
            n += 1
    if n:
        logger.info("[merge] resumed=%d", n)
    return n
