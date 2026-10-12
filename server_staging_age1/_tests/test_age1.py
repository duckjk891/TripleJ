"""age1 곡 연령 등급 — 통합 테스트(임시 DB 전용: 운영 스키마 복제, 데이터 없음).

실행: run_tests.sh(임시 컨테이너 안에서 스테이징 코드를 덮어쓴 뒤 python /stage/_tests/test_age1.py).
외부 호출 없음 — 분류기(Anthropic)는 가짜로 바꾼다. 실제 호출 점검은 test_age1_live.py(합성 데이터만).

확인하는 것
  A. 필터 OFF = 종전과 같음(19 곡도 그대로 보임, 응답에 차단 없음)
  B. 필터 ON — 어린이·청소년·성인·비로그인 토큰별 차트(TOP100·일간·장르·느낌)·검색·최신·추천·채널·앨범·피드·좋아요
     · 성인 응답 변화 = 19 곡 제외뿐(필터 OFF 성인 응답 − 19 곡 == 필터 ON 성인 응답)
     · 청소년·비로그인 = 성인과 같음, 어린이 = 전체 등급만
  C. 직접 접근 403 age_restricted(상세·스트림·다운로드·가사·공유영상), 본인은 통과
  D. 본인 19 곡 공개 전환 403, 관리자 등급 수정 → 차단 해제·공개 복원, 관리 기록
  E. 스위퍼(가짜 분류기) — 미분류 분류·실패 재시도 표시·거절·근거(제목) 변경 재분류·관리자 등급 유지·19 자동 차단
"""
import asyncio
import json
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
from bson import ObjectId
from fastapi import FastAPI

from app.config import settings
from app.database import postgres as pgmod
from app.database.mongodb import get_mongo, init_mongodb
from app.database.postgres import init_postgres
from app.database.redis import get_redis, init_redis

PASS, FAIL = [], []


def check(name, cond, info=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  {info}"))


def build_app():
    from app.routes import (admin_age_rating, albums, artists, charts, feeds, likes, playlists, tracks)

    app = FastAPI()
    for m in (tracks, charts, artists, albums, feeds, likes, playlists, admin_age_rating):
        app.include_router(m.router)
    return app


async def mk_user(c, nick, birth, role="user", verified=False):
    uid = uuid.uuid4()
    await c.execute(
        """INSERT INTO users (id, email, nickname, provider, password_hash, role, account_status, birth_date, is_verified, created_at)
           VALUES ($1,$2,$3,'local','$2b$12$fakehash',$4,'active',$5,$6, now())""",
        uid, f"{nick}-{uid.hex[:6]}@age1.test", nick, role, birth, verified)
    from app.routes.auth import _create_token, _save_session

    await _save_session(str(uid), f"{nick}@age1.test", nick, None, role)
    return str(uid), _create_token(str(uid), f"{nick}@age1.test", nick, role)


def ids(lst):
    return [t.get("id") for t in lst]


async def main():
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    m = get_mongo()
    r = get_redis()
    await r.flushdb()
    for coll in ("tracks", "albums", "feeds", "play_logs", "guest_play_logs"):
        await m[coll].delete_many({})

    from app.services import age_rating as ar

    os.environ.pop("AGE_RATING_FILTER_ENABLED", None)
    os.environ.pop("AGE_RATING_CLASSIFY_FROM", None)
    os.environ.pop("AGE_RATING_ADULT19_VISIBLE", None)
    os.environ.pop("AGE_RATING_FILTER_FROM", None)

    async with pgmod._pool.acquire() as c:
        await c.execute("DELETE FROM likes")
        today = date.today()
        owner, tok_owner = await mk_user(c, "owner", date(1990, 1, 1))
        child, tok_child = await mk_user(c, "child", date(today.year - 9, 1, 1))
        teen, tok_teen = await mk_user(c, "teen", date(today.year - 16, 1, 1))
        adult, tok_adult = await mk_user(c, "adult", date(1985, 5, 5))
        nobirth, tok_nobirth = await mk_user(c, "nobirth", None)
        admin, tok_admin = await mk_user(c, "admin", date(1980, 1, 1), role="admin")

    now = datetime.now(timezone.utc)

    async def mk_track(title, rating, pc, public=True, uploader=owner, genre="pop", cat="설렘", **extra):
        d = {"title": title, "uploader_id": uploader, "uploader_nickname": "owner", "is_public": public,
             "play_count": pc, "like_count": 0, "genre": [genre], "categories": [cat], "tags": [],
             "lyrics": f"{title} 가사", "audio_url": f"tracks/{uploader}/{title}.mp3",
             "cover_image_url": f"covers/{uploader}/{title}.png", "created_at": now - timedelta(minutes=pc)}
        if rating is not None:
            d["age_rating"] = rating
            d["age_rating_basis"] = {"title": title, "cover": d["cover_image_url"], "lyrics": ar.lyrics_hash(d["lyrics"])}
        d.update(extra)
        res = await m.tracks.insert_one(d)
        return str(res.inserted_id)

    tA = await mk_track("테스트곡 전체", "all", 60)
    t12 = await mk_track("테스트곡 열두", "12", 50)
    t15 = await mk_track("테스트곡 열다섯", "15", 40)
    t19 = await mk_track("테스트곡 열아홉", "19", 30)
    tU = await mk_track("테스트곡 미분류", None, 20)
    tP = await mk_track("테스트곡 비공개", "all", 10, public=False)
    tC = await mk_track("테스트곡 어린이본인", "15", 0, uploader=child)

    a1 = str((await m.albums.insert_one({"owner_id": owner, "owner_nickname": "owner", "title": "앨범 전체",
                                         "track_ids": [tA, t15, t19], "is_public": True, "age_rating": "all",
                                         "cover_image_url": "covers/x/album_1.png", "created_at": now})).inserted_id)
    a2 = str((await m.albums.insert_one({"owner_id": owner, "owner_nickname": "owner", "title": "앨범 열다섯",
                                         "track_ids": [t15], "is_public": True, "age_rating": "15",
                                         "cover_image_url": "covers/x/album_2.png", "created_at": now - timedelta(seconds=5)})).inserted_id)
    f1 = str((await m.feeds.insert_one({"author_id": adult, "author_nickname": "adult", "kind": "feed", "is_public": True,
                                        "blocks": [{"type": "track", "track_id": t19}, {"type": "track", "track_id": t15},
                                                   {"type": "track", "track_id": tA}],
                                        "like_count": 0, "comment_count": 0, "created_at": now})).inserted_id)
    async with pgmod._pool.acquire() as c:
        for t in (tA, t15, t19):
            await c.execute("INSERT INTO likes (user_id, track_id) VALUES ($1,$2)", uuid.UUID(child), t)
            await c.execute("INSERT INTO likes (user_id, track_id) VALUES ($1,$2)", uuid.UUID(adult), t)

    app = build_app()
    tr = httpx.ASGITransport(app=app)
    TOK = {"child": tok_child, "teen": tok_teen, "adult": tok_adult, "nobirth": tok_nobirth, "anon": None,
           "owner": tok_owner, "admin": tok_admin}

    async with httpx.AsyncClient(transport=tr, base_url="http://t") as cli:
        async def get(path, who, **params):
            h = {"Authorization": f"Bearer {TOK[who]}"} if TOK.get(who) else {}
            return await cli.get(path, headers=h, params=params)

        async def snapshot(who):
            out = {}
            out["top100"] = ids((await get("/api/charts/top100", who)).json())
            out["daily"] = ids((await get("/api/charts/daily", who)).json())
            out["genre"] = ids((await get("/api/charts/genre/pop", who)).json())
            out["category"] = []
            sr = await get("/api/tracks/search", who, q="테스트곡", limit=50) if TOK.get(who) or True else None
            out["search"] = ids(sr.json().get("tracks", [])) if sr.status_code == 200 else f"status {sr.status_code}"
            out["latest"] = ids((await get("/api/tracks/", who, sort="created_at", limit=50)).json()["tracks"])
            out["channel"] = ids((await get(f"/api/artists/{owner}/tracks", who, limit=50)).json())
            out["albums"] = [a["id"] for a in (await get("/api/albums/latest", who)).json()]
            ad = await get(f"/api/albums/{a1}", who)
            out["album1"] = ids(ad.json().get("tracks") or []) if ad.status_code == 200 else f"status {ad.status_code}"
            fd = await get(f"/api/feeds/{f1}", who)
            if fd.status_code == 200:
                blocks = fd.json().get("blocks") or fd.json().get("feed", {}).get("blocks") or []
                out["feed"] = [(b["track"]["id"], bool(b["track"].get("deleted"))) for b in blocks if b.get("type") == "track"]
            else:
                out["feed"] = f"status {fd.status_code}"
            rel = await get(f"/api/tracks/{tA}/related", who, limit=5)
            out["related"] = sorted(ids(rel.json().get("tracks", []))) if rel.status_code == 200 else f"status {rel.status_code}"
            return out

        # ── A. 필터 OFF ──
        base = {w: await snapshot(w) for w in ("adult", "child", "anon")}
        check("A off: adult top100 includes 19", t19 in base["adult"]["top100"], base["adult"]["top100"])
        check("A off: child sees same as adult (top100)", base["child"]["top100"] == base["adult"]["top100"])
        check("A off: child detail 15 = 200", (await get(f"/api/tracks/{t15}", "child")).status_code == 200)
        check("A off: search works (regex fallback)", isinstance(base["adult"]["search"], list) and t19 in base["adult"]["search"],
              base["adult"]["search"])
        print("baseline adult:", json.dumps(base["adult"], ensure_ascii=False))

        # ── B. 필터 ON ──
        os.environ["AGE_RATING_FILTER_ENABLED"] = "true"
        fixed = await ar.enforce_blocks()
        d19 = await m.tracks.find_one({"_id": ObjectId(t19)})
        check("B enforce: 19 blocked (is_public False, age_blocked, prev_public)",
              fixed >= 1 and d19["is_public"] is False and d19["age_blocked"] is True and d19["age_prev_public"] is True, d19)
        snaps = {w: await snapshot(w) for w in ("adult", "teen", "nobirth", "anon", "child")}

        def minus19(lst):
            return [x for x in lst if x != t19] if isinstance(lst, list) else lst

        for key in ("top100", "daily", "genre", "search", "latest", "channel", "albums", "album1", "related"):
            exp = minus19(base["adult"][key]) if key != "related" else sorted(minus19(base["adult"][key]))
            check(f"B adult {key} == baseline - 19", snaps["adult"][key] == exp, (snaps["adult"][key], exp))
        check("B adult feed: 19 → placeholder only", snaps["adult"]["feed"] == [(t19, True), (t15, False), (tA, False)], snaps["adult"]["feed"])
        for w in ("teen", "nobirth", "anon"):
            same = all(snaps[w][k] == snaps["adult"][k] for k in ("top100", "daily", "genre", "latest", "channel", "albums", "album1"))
            check(f"B {w} == adult", same, {k: snaps[w][k] for k in ("top100", "latest")})
        ch = snaps["child"]
        check("B child top100 = all only", ch["top100"] == [tA], ch["top100"])
        check("B child genre = all only", ch["genre"] == [tA], ch["genre"])
        check("B child search = all only", ch["search"] == [tA], ch["search"])
        check("B child latest = all only", ch["latest"] == [tA], ch["latest"])
        check("B child channel = all only", ch["channel"] == [tA], ch["channel"])
        check("B child related ⊆ all", all(x == tA for x in ch["related"]) if isinstance(ch["related"], list) else False, ch["related"])
        check("B child albums = all-rated album only", ch["albums"] == [a1], ch["albums"])
        check("B child album1 tracks = all only", ch["album1"] == [tA], ch["album1"])
        check("B child feed: 19·15 placeholders", ch["feed"] == [(t19, True), (t15, True), (tA, False)], ch["feed"])
        lk = await get("/api/likes/", "child")
        check("B child likes = all only", ids(lk.json()["likes"]) == [tA] or sorted(ids(lk.json()["likes"])) == [tA], lk.json())
        lk2 = await get("/api/likes/", "adult")
        check("B adult likes = minus 19", sorted(ids(lk2.json()["likes"])) == sorted([tA, t15]), lk2.json())
        cc = await get(f"/api/artists/{child}/tracks", "child")
        check("B child own channel shows own 15 track", ids(cc.json()) == [tC], cc.json())
        a2d = await get(f"/api/albums/{a2}", "child")
        check("B child album(15) detail 403 age_restricted", a2d.status_code == 403 and a2d.json().get("code") == "age_restricted", a2d.text)
        kc = await get("/api/charts/top100", "child")
        check("B child chart cache separate key", await r.exists("cache:chart:ageall:top100:100") == 1)

        # ── C. 직접 접근 ──
        def is_age403(resp):
            return resp.status_code == 403 and resp.json().get("code") == "age_restricted"

        check("C child detail 15 → 403", is_age403(await get(f"/api/tracks/{t15}", "child")))
        check("C child detail unrated → 403", is_age403(await get(f"/api/tracks/{tU}", "child")))
        check("C child detail all → 200", (await get(f"/api/tracks/{tA}", "child")).status_code == 200)
        check("C child detail own 15 → 200", (await get(f"/api/tracks/{tC}", "child")).status_code == 200)
        check("C adult detail 15 → 200", (await get(f"/api/tracks/{t15}", "adult")).status_code == 200)
        check("C adult detail 19 → 403", is_age403(await get(f"/api/tracks/{t19}", "adult")))
        check("C anon detail 19 → 403", is_age403(await get(f"/api/tracks/{t19}", "anon")))
        od = await get(f"/api/tracks/{t19}", "owner")
        check("C owner detail 19 → 200 + age_blocked", od.status_code == 200 and od.json().get("age_blocked") is True
              and od.json().get("age_rating") == "19", od.text[:200])
        # 캐시 히트 경로(상세는 600초 캐시) — 두 번째도 같은 판정
        check("C child detail 15 cached → 403", is_age403(await get(f"/api/tracks/{t15}", "child")))
        check("C adult detail 19 cached → 403", is_age403(await get(f"/api/tracks/{t19}", "adult")))
        check("C child stream 15 → 403", is_age403(await get(f"/api/tracks/stream/{t15}", "child")))
        check("C child stream-proxy ?token → 403",
              is_age403(await cli.get(f"/api/tracks/stream-proxy/{t15}", params={"token": tok_child})))
        check("C adult stream-proxy 19 → 403", is_age403(await get(f"/api/tracks/stream-proxy/{t19}", "adult")))
        check("C child lyrics 15 → 403", is_age403(await get(f"/api/tracks/{t15}/lyrics-timeline", "child")))
        check("C child music-video 15 → 403", is_age403(await get(f"/api/tracks/{t15}/music-video", "child")))
        dl = await cli.post(f"/api/tracks/download/{t15}", headers={"Authorization": f"Bearer {tok_child}"})
        check("C child download 15 → 403", is_age403(dl), dl.text[:120])
        check("C child share clip-info 15 → 403", is_age403(await get(f"/api/tracks/{t15}/share-video/clip-info", "child")))
        sv = await get(f"/api/tracks/{t15}/share-video/file", "child")
        check("C child share-video file 15 → 403", is_age403(sv), sv.status_code)

        # ── D. 소유자 공개 전환·관리자 수정 ──
        pu = await cli.put(f"/api/tracks/{t19}", json={"is_public": True}, headers={"Authorization": f"Bearer {tok_owner}"})
        check("D owner republish 19 → 403 age_restricted", is_age403(pu), pu.text[:200])
        check("D still private", (await m.tracks.find_one({"_id": ObjectId(t19)}))["is_public"] is False)
        nf = await cli.put(f"/api/admin/age-ratings/tracks/{t19}", json={"rating": "15", "note": "오분류"},
                           headers={"Authorization": f"Bearer {tok_adult}"})
        check("D non-admin rating change → 403", nf.status_code == 403)
        ad = await cli.put(f"/api/admin/age-ratings/tracks/{t19}", json={"rating": "15", "note": "오분류"},
                           headers={"Authorization": f"Bearer {tok_admin}"})
        d19b = await m.tracks.find_one({"_id": ObjectId(t19)})
        check("D admin 19→15 restores public", ad.status_code == 200 and d19b["is_public"] is True
              and d19b["age_blocked"] is False and d19b["age_rating_source"] == "admin", (ad.text[:200], d19b.get("is_public")))
        async with pgmod._pool.acquire() as c:
            n = await c.fetchval("SELECT count(*) FROM admin_logs WHERE action='set_age_rating' AND target_id=$1", t19)
        check("D admin log recorded", n == 1, n)
        top_after = ids((await get("/api/charts/top100", "adult")).json())
        check("D adult top100 back to baseline after unblock (cache purged)", top_after == base["adult"]["top100"], top_after)
        ad2 = await cli.put(f"/api/admin/age-ratings/tracks/{t19}", json={"rating": "19"}, headers={"Authorization": f"Bearer {tok_admin}"})
        d19c = await m.tracks.find_one({"_id": ObjectId(t19)})
        check("D admin →19 blocks again", ad2.status_code == 200 and d19c["is_public"] is False and d19c["age_blocked"] is True)
        # 관리자 공개 토글로 우회 → 스위퍼 enforce 가 다시 차단
        await m.tracks.update_one({"_id": ObjectId(t19)}, {"$set": {"is_public": True}})
        await ar.enforce_blocks()
        check("D enforce re-blocks after bypass", (await m.tracks.find_one({"_id": ObjectId(t19)}))["is_public"] is False)
        # 비공개였던 곡이 19 → 차단 해제돼도 비공개 유지
        pv = await mk_track("테스트곡 원래비공개", "19", 1, public=False)
        await ar.enforce_blocks()
        dpv = await m.tracks.find_one({"_id": ObjectId(pv)})
        check("D private 19 marked blocked, prev_public False", dpv["age_blocked"] is True and dpv["age_prev_public"] is False)
        await ar.apply_rating("tracks", dpv, "all", [], "admin", admin_id=admin)
        check("D private 19→all stays private", (await m.tracks.find_one({"_id": ObjectId(pv)}))["is_public"] is False)
        sm = await get("/api/admin/age-ratings/summary", "admin")
        check("D admin summary", sm.status_code == 200 and sm.json()["tracks"]["blocked"] >= 1, sm.text[:300])
        it = await get("/api/admin/age-ratings/items", "admin", rating="blocked")
        check("D admin items blocked filter", it.status_code == 200 and t19 in [x["id"] for x in it.json()["items"]], it.text[:200])

        # ── E. 스위퍼(가짜 분류기) ──
        calls = []

        async def fake_classify(title, lyrics, cover):
            calls.append(title)
            if "boom" in title:
                raise RuntimeError("upstream 500")
            if "refuse" in title:
                raise ar.ClassifyRefused("general_harms")
            if "explicit" in title:
                return {"rating": "19", "reasons": [{"category": "sexual", "source": "lyrics", "note": "노골적"}], "model": "fake", "cover_used": False}
            return {"rating": "all", "reasons": [], "model": "fake", "cover_used": False}

        ar.classify = fake_classify
        settings.anthropic_api_key = settings.anthropic_api_key or "test-key"
        st = await ar.sweep_once()
        check("E classify off before start date", st["rated"] == 0 and calls == [], (st, calls))
        os.environ["AGE_RATING_CLASSIFY_FROM"] = (now + timedelta(hours=1)).isoformat()
        check("E future start date = off", ar.classify_enabled() is False)
        os.environ["AGE_RATING_CLASSIFY_FROM"] = (now - timedelta(hours=1)).isoformat()
        tb = await mk_track("boom 곡", None, 1)
        trf = await mk_track("refuse 곡", None, 1)
        tx = await mk_track("explicit 곡", None, 1)
        calls.clear()
        st = await ar.sweep_once()
        dU = await m.tracks.find_one({"_id": ObjectId(tU)})
        check("E unrated classified", dU.get("age_rating") == "all" and dU.get("age_rating_source") == "ai", dU.get("age_rating"))
        db = await m.tracks.find_one({"_id": ObjectId(tb)})
        check("E failure recorded + next_try", db.get("age_rating") is None and db.get("age_rating_attempts") == 1
              and db.get("age_rating_next_try") is not None, {k: db.get(k) for k in ("age_rating_attempts", "age_rating_error")})
        drf = await m.tracks.find_one({"_id": ObjectId(trf)})
        check("E refusal recorded (stays unrated = 15)", (drf.get("age_rating_error") or "").startswith("refused"), drf.get("age_rating_error"))
        dx = await m.tracks.find_one({"_id": ObjectId(tx)})
        check("E new 19 auto-blocked", dx.get("age_rating") == "19" and dx["is_public"] is False and dx.get("age_blocked") is True)
        check("E rated-with-basis tracks not re-sent", not any(t in calls for t in ("테스트곡 전체", "테스트곡 열다섯")), calls)
        calls.clear()
        st2 = await ar.sweep_once()
        check("E failed item not retried before next_try", "boom 곡" not in calls, calls)
        # 제목 변경 → 재분류, 관리자 등급은 근거 그대로면 유지
        await m.tracks.update_one({"_id": ObjectId(t15)}, {"$set": {"title": "테스트곡 열다섯 수정"}})
        calls.clear()
        await ar.sweep_once()
        check("E title change → reclassified", "테스트곡 열다섯 수정" in calls, calls)
        check("E admin-set 19 kept (basis unchanged)", "테스트곡 열아홉" not in calls)
        await m.tracks.update_one({"_id": ObjectId(tx)}, {"$set": {"title": "clean 곡"}})
        calls.clear()
        await ar.sweep_once()
        dx2 = await m.tracks.find_one({"_id": ObjectId(tx)})
        check("E owner fixes 19 title → reclassified all → unblocked & public",
              dx2.get("age_rating") == "all" and dx2["is_public"] is True and dx2.get("age_blocked") is False, dx2.get("age_rating"))

        # ── F0. FILTER_FROM 시각 스위치 ──
        os.environ.pop("AGE_RATING_FILTER_ENABLED", None)
        os.environ["AGE_RATING_FILTER_FROM"] = (now + timedelta(hours=1)).isoformat()
        check("F0 filter_from future = off", ar.filter_enabled() is False)
        os.environ["AGE_RATING_FILTER_FROM"] = (now - timedelta(minutes=1)).isoformat()
        check("F0 filter_from past = on", ar.filter_enabled() is True)
        os.environ["AGE_RATING_FILTER_ENABLED"] = "false"
        check("F0 explicit false overrides from", ar.filter_enabled() is False)
        os.environ.pop("AGE_RATING_FILTER_FROM", None)
        os.environ["AGE_RATING_FILTER_ENABLED"] = "true"

        # ── F. 필터 OFF 로 되돌리면 19 차단 해제(킬 스위치 = 종전 상태) ──
        os.environ.pop("AGE_RATING_FILTER_ENABLED", None)
        await ar.enforce_blocks()
        d19d = await m.tracks.find_one({"_id": ObjectId(t19)})
        check("F kill switch restores 19 track to public", d19d["is_public"] is True and d19d.get("age_blocked") is False)
        check("F kill switch: child detail 15 → 200", (await get(f"/api/tracks/{t15}", "child")).status_code == 200)

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", FAIL)
        sys.exit(1)


asyncio.run(main())
