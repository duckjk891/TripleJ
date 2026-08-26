import logging
import os
import re
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# v67-pre: app 모듈 logger 가 stdout 으로 출력되도록 root logger 설정.
# 이전엔 uvicorn 의 access 로그만 stdout 으로 나와서 우리 logger.info 등이
# server.log 에 안 찍혔음. INFO 레벨 + 단순 포맷.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
    force=True,
)


# GuardSquad — uvicorn access 로그의 요청 라인에 보호자 동의 토큰(URL 경로)이
# 그대로 남지 않도록 마스킹. 앱 로거는 토큰 앞 8자만 쓰지만 access 로그는
# 경로 전체를 기록하므로 여기서 걸러야 함.
# v203: guardian-consent 전용 필터를 일반 토큰 마스킹 필터로 확장 —
# 쿼리스트링 `?token=...` / `&token=...` 값도 access 로그에서 마스킹.
class _TokenMaskFilter(logging.Filter):
    _patterns = [
        re.compile(r"(/api/auth/guardian-consent/)[^/\s\"?]+"),
        re.compile(r"([?&]token=)[^&\s\"']+"),  # v203
    ]

    def _mask(self, text: str) -> str:
        for pattern in self._patterns:
            text = pattern.sub(r"\1<masked>", text)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.args:
                record.args = tuple(
                    self._mask(a) if isinstance(a, str) else a
                    for a in record.args
                )
            if isinstance(record.msg, str):
                record.msg = self._mask(record.msg)
        except Exception:
            pass
        return True


logging.getLogger("uvicorn.access").addFilter(_TokenMaskFilter())

load_dotenv()

from .config import settings
from .database.postgres import init_postgres, close_postgres
from .database.mongodb import init_mongodb, close_mongodb
from .database.redis import init_redis, close_redis
from .database.minio import init_minio
from .database.elasticsearch import init_elasticsearch, get_es, close_elasticsearch
from .routes import admin, admin_ads, admin_cs, admin_issues, admin_notices, admin_moderation, admin_points, auth, oauth, tracks, albums, artists, charts, playlists, likes, upload, follows, generate, mv, character, voice_clone, wondera, rewards, business, points, attendance, wishlist, feeds, face_verify, reports, dm, referral, fatigue, issues, _logs

logger = logging.getLogger(__name__)


def _run_beat_recovery(gen_ids: list, track_ids: list):
    """
    v206: pending 박자분석 복구 — 단일 데몬 스레드에서 순차 실행.
    각 sync 래퍼가 자체 이벤트 루프 + 자체 motor + heavy_job_slot 을 쓰므로
    메인 FastAPI 루프/anyio 스레드풀을 건드리지 않는다.
    ⚠️ to_thread × N 으로 바꾸지 말 것 — 슬롯 대기자가 anyio 스레드풀(기본 40)을
    고갈시켜 share_video·ready 등 다른 to_thread 사용자가 굶는다 (PLAN v206 §0).
    복구는 살림이지 급무가 아니다 — 순차로 돌려 라이브 사용자용 슬롯 여유를 남긴다.
    """
    from .services.beat_extraction import (
        run_generation_beat_extraction_in_background,
        run_track_beat_extraction_in_background,
    )

    logger.info(
        "[beat-recover] start: generations=%d tracks=%d", len(gen_ids), len(track_ids)
    )
    # v206-r: 건별 방탄 — 래퍼는 자체 try/except 이지만, 만에 하나 래퍼 밖에서
    # 예외가 새면 복구 스레드가 죽어 잔여 건이 통째로 유실된다 (tester 실측 권고).
    for i, gid in enumerate(gen_ids, 1):
        logger.info("[beat-recover] generation %d/%d id=%s", i, len(gen_ids), gid)
        try:
            run_generation_beat_extraction_in_background(gid)
        except Exception as e:
            logger.warning("[beat-recover] generation id=%s failed: %s", gid, e)
    for i, tid in enumerate(track_ids, 1):
        logger.info("[beat-recover] track %d/%d id=%s", i, len(track_ids), tid)
        try:
            run_track_beat_extraction_in_background(tid)
        except Exception as e:
            logger.warning("[beat-recover] track id=%s failed: %s", tid, e)
    logger.info(
        "[beat-recover] done: generations=%d tracks=%d", len(gen_ids), len(track_ids)
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to all databases
    await init_postgres(settings.postgres_dsn)
    await init_mongodb(settings.computed_mongo_url, settings.mongo_db)
    await init_redis(settings.computed_redis_url)
    init_minio(settings.minio_endpoint, settings.minio_user, settings.minio_password)
    print("All database connections established.")

    # v89 — ensure playlists.description column exists (idempotent, safe across shared DB backends)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE playlists ADD COLUMN IF NOT EXISTS description TEXT")
        print("[migration] playlists.description ensured")
    except Exception as _e:
        logging.getLogger(__name__).warning("[migration] playlists.description ensure failed: %s", _e)

    # Social OAuth — ensure users.provider columns + uniqueness, allow NULL password_hash
    # (소셜 가입 계정은 비밀번호가 없음). 멱등, 공유 DB 안전.
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'local'")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id TEXT")
            await _conn.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
            await _conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_provider_uid "
                "ON users(provider, provider_user_id) WHERE provider_user_id IS NOT NULL"
            )
        print("[migration] users.provider ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.provider ensure failed: %s", _e)

    # VectorSearch — ensure pgvector extension + track_embeddings table/index (idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS track_embeddings ("
                "track_id TEXT PRIMARY KEY, "
                "embedding vector(1536), "
                "content_hash TEXT, "
                "model TEXT, "
                "updated_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS track_embeddings_hnsw "
                "ON track_embeddings USING hnsw (embedding vector_cosine_ops)"
            )
        print("[migration] track_embeddings ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] track_embeddings ensure failed: %s", _e)

    # WishlistSquad — ensure ad_wishlist table (광고상품 위시리스트, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS ad_wishlist ("
                "user_id UUID NOT NULL, "
                "item_id TEXT NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now(), "
                "PRIMARY KEY(user_id, item_id))"
            )
        print("[migration] ad_wishlist ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] ad_wishlist ensure failed: %s", _e)

    # ProfileSquad — ensure users demographics columns (출생연도/성별/지역, 전부 선택, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_year INT")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(16)")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS region VARCHAR(40)")
            # birth_year(INT) → birth_date(DATE) 전환: 컬럼 추가 + 1월 1일 기준 backfill (idempotent)
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE")
            await _conn.execute(
                "UPDATE users SET birth_date = make_date(birth_year, 1, 1) "
                "WHERE birth_date IS NULL AND birth_year IS NOT NULL"
            )
        print("[migration] users.demographics ensured")
        print("[migration] users.birth_date ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.demographics ensure failed: %s", _e)

    # TrustSquad — ensure users verification columns (소셜 본인인증 트랙, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_provider VARCHAR(20)")
        print("[migration] users.verification ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.verification ensure failed: %s", _e)

    # SnsLinkSquad — ensure users.sns_links JSONB column (SNS 채널 URL 목록, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS sns_links JSONB DEFAULT '[]'::jsonb"
            )
        print("[migration] users.sns_links ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.sns_links ensure failed: %s", _e)

    # GuardSquad — ensure users.nationality/account_status (내·외국인 구분 + 만14세 동의 상태, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS nationality VARCHAR(16)")
            await _conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active'"
            )
        print("[migration] users.nationality/account_status ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.nationality/account_status ensure failed: %s", _e)

    # ReferralSquad(v154) — ensure users.referral_code/referred_by + 부분 유니크 인덱스
    # + NULL 유저 백필 (멱등 — 재기동마다 referral_code IS NULL 인 유저만 발급)
    try:
        from .database import postgres as _pg
        from .services.referral_service import backfill_referral_codes
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(8)")
            await _conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID")
            await _conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code "
                "ON users(referral_code) WHERE referral_code IS NOT NULL"
            )
            _n_backfilled = await backfill_referral_codes(_conn)
        print(f"[migration] users.referral_code ensured (backfilled={_n_backfilled})")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] users.referral_code ensure failed: %s", _e)

    # GuardSquad — ensure guardian_consents table (법정대리인 동의 기록 — 법정 증빙, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS guardian_consents ("
                "id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
                "child_user_id UUID NOT NULL, "
                "guardian_name VARCHAR(60), "
                "guardian_phone VARCHAR(20), "
                "consent_token TEXT UNIQUE NOT NULL, "
                "status VARCHAR(16) DEFAULT 'pending', "
                "method VARCHAR(20) DEFAULT 'mock', "
                "requested_at TIMESTAMPTZ DEFAULT now(), "
                "decided_at TIMESTAMPTZ)"
            )
        print("[migration] guardian_consents ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] guardian_consents ensure failed: %s", _e)

    # FaceGuardSquad(v135) — guardian_consents.consent_type + face_biometrics/face_photo_verifications
    # (얼굴 인증: 저장 얼굴 메타 + 사진별 검증 통과 기록, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "ALTER TABLE guardian_consents ADD COLUMN IF NOT EXISTS consent_type VARCHAR(30) DEFAULT 'signup'"
            )
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS face_biometrics ("
                "user_id UUID PRIMARY KEY, "
                "object_name TEXT NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now(), "
                "updated_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS face_photo_verifications ("
                "user_id UUID NOT NULL, "
                "photo_sha256 VARCHAR(64) NOT NULL, "
                "verified_at TIMESTAMPTZ DEFAULT now(), "
                "PRIMARY KEY(user_id, photo_sha256))"
            )
        print("[migration] face_verify tables ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] face_verify tables ensure failed: %s", _e)

    # FaceGuardSquad — 기동 점검 로그 (FACE_DATA_KEY 미설정 경고 등)
    try:
        from .services.face_verify_service import startup_check as _face_startup_check
        _face_startup_check()
    except Exception as _e:
        logging.getLogger(__name__).warning("[face-verify] startup check failed: %s", _e)

    # ConsentSquad — ensure user_consents table (가입/기능 동의 이력 — append 형, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS user_consents ("
                "id BIGSERIAL PRIMARY KEY, "
                "user_id UUID NOT NULL, "
                "consent_key VARCHAR(30) NOT NULL, "
                "agreed BOOLEAN NOT NULL, "
                "version VARCHAR(20) NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS user_consents_lookup "
                "ON user_consents(user_id, consent_key, created_at DESC)"
            )
        print("[migration] user_consents ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] user_consents ensure failed: %s", _e)

    # TrustSquad(v137) — ensure reports table (신고 시스템, idempotent)
    # 부분 유니크: 동일 reporter+target 의 pending 신고 1건만 허용.
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS reports ("
                "id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
                "reporter_id UUID NOT NULL, "
                "target_type VARCHAR(10) NOT NULL, "
                "target_id VARCHAR(40) NOT NULL, "
                "reason_code VARCHAR(20) NOT NULL, "
                "reason_text TEXT, "
                "status VARCHAR(12) NOT NULL DEFAULT 'pending', "
                "action VARCHAR(10), "
                "created_at TIMESTAMPTZ DEFAULT now(), "
                "handled_at TIMESTAMPTZ, "
                "handled_by UUID)"
            )
            await _conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS reports_pending_unique "
                "ON reports(reporter_id, target_type, target_id) WHERE status = 'pending'"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS reports_status_created "
                "ON reports(status, created_at DESC)"
            )
        print("[migration] reports ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] reports ensure failed: %s", _e)

    # TrustSquad(v138) — 신고 집행 기반: reports 증거/판정 컬럼 + user_violations
    # (위반 이력 — 차후 스트라이크 데이터) + face_source_blacklist (확정 삭제된
    # 도용 원본 사진 sha256 — 소비는 BE-2 생성 입력 차단). idempotent.
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS evidence JSONB")
            await _conn.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution VARCHAR(30)")
            await _conn.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS prev_state JSONB")
            # confirm_delete(14자) 등 확장 액션 수용
            await _conn.execute("ALTER TABLE reports ALTER COLUMN action TYPE VARCHAR(20)")
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS user_violations ("
                "id BIGSERIAL PRIMARY KEY, "
                "user_id UUID NOT NULL, "
                "report_id UUID, "
                "kind VARCHAR(20) NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS user_violations_user "
                "ON user_violations(user_id, created_at DESC)"
            )
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS face_source_blacklist ("
                "sha256 VARCHAR(64) PRIMARY KEY, "
                "report_id UUID, "
                "created_at TIMESTAMPTZ DEFAULT now())"
            )
        print("[migration] reports v138 evidence/user_violations/face_source_blacklist ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] reports v138 ensure failed: %s", _e)

    # TrustSquad(v139) — 소명(report_appeals, report_id 당 1건) + 스트라이크
    # 생성 제한(users.restricted_until). idempotent.
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS report_appeals ("
                "id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
                "report_id UUID NOT NULL UNIQUE, "
                "user_id UUID NOT NULL, "
                "text VARCHAR(2000) NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now())"
            )
            await _conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS restricted_until TIMESTAMPTZ"
            )
        print("[migration] report_appeals/users.restricted_until v139 ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] v139 appeals/restricted ensure failed: %s", _e)

    # FeedSquad — ensure PG feed_likes table + Mongo feeds/feed_comments indexes
    # (스타 채널 음악 피드 v131, idempotent)
    try:
        from .database import postgres as _pg
        async with _pg._pool.acquire() as _conn:
            await _conn.execute(
                "CREATE TABLE IF NOT EXISTS feed_likes ("
                "user_id UUID NOT NULL, "
                "feed_id VARCHAR(40) NOT NULL, "
                "created_at TIMESTAMPTZ DEFAULT now(), "
                "PRIMARY KEY(user_id, feed_id))"
            )
            await _conn.execute(
                "CREATE INDEX IF NOT EXISTS feed_likes_feed ON feed_likes(feed_id)"
            )
        print("[migration] feed_likes ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] feed_likes ensure failed: %s", _e)
    try:
        from .database.mongodb import get_mongo as _feed_get_mongo
        _feed_mongo = _feed_get_mongo()
        await _feed_mongo.feeds.create_index([("author_id", 1), ("created_at", -1)])
        # 향후 글로벌(팔로잉/추천) 피드용 선반영 인덱스
        await _feed_mongo.feeds.create_index([("is_public", 1), ("created_at", -1)])
        await _feed_mongo.feed_comments.create_index([("feed_id", 1), ("created_at", 1)])
        print("[migration] feed indexes ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] feed indexes ensure failed: %s", _e)

    # AdOps(v184) — 광고 이벤트 기간 집계용 인덱스 (idempotent, feeds 관행)
    try:
        from .database.mongodb import get_mongo as _ads_get_mongo
        _ads_mongo = _ads_get_mongo()
        await _ads_mongo.ad_impressions.create_index([("item_id", 1), ("timestamp", -1)])
        await _ads_mongo.ad_clicks.create_index([("item_id", 1), ("timestamp", -1)])
        print("[migration] ad event indexes ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] ad event indexes ensure failed: %s", _e)

    # IssueDesk(v185) — 오류 신고·자동 수집 에러 인덱스 (idempotent, feeds 관행)
    try:
        from .database.mongodb import get_mongo as _issues_get_mongo
        _issues_mongo = _issues_get_mongo()
        await _issues_mongo.issue_reports.create_index([("status", 1), ("created_at", -1)])
        await _issues_mongo.issue_reports.create_index([("created_at", -1)])
        await _issues_mongo.issue_reports.create_index("user_id")
        await _issues_mongo.frontend_errors.create_index([("fingerprint", 1), ("created_at", -1)])
        await _issues_mongo.frontend_errors.create_index([("created_at", -1)])
        # IssueDesk(v186) — 프로브 이력 (지속 여부 fold + 쿨다운 조회)
        await _issues_mongo.probe_history.create_index([("fingerprint", 1), ("created_at", -1)])
        await _issues_mongo.probe_history.create_index([("url", 1), ("created_at", -1)])
        await _issues_mongo.probe_history.create_index([("created_at", -1)])
        print("[migration] issue indexes ensured")
    except Exception as _e:
        logging.getLogger(__name__).error("[migration] issue indexes ensure failed: %s", _e)

    # HybridSearch — connect Elasticsearch + ensure the `tracks` index exists
    # (nori analyzer, idempotent), then schedule a non-blocking self-heal backfill:
    # if the ES index emptied/drifted across a restart, re-index public tracks from
    # Mongo so search never silently degrades to vector-only. Never break startup if
    # ES is down: log + continue.
    try:
        await init_elasticsearch(settings.es_url)
        es = get_es()
        from .services.search_service import ensure_tracks_index, backfill_es_if_needed
        await ensure_tracks_index(es)
        print("[migration] es tracks index ensured")

        import asyncio as _es_asyncio
        from .database.mongodb import get_mongo as _get_mongo
        _mongo_db = _get_mongo()
        _es_asyncio.create_task(backfill_es_if_needed(es, _mongo_db, force=False))
        print("[migration] es backfill check scheduled")
    except Exception as _e:
        logging.getLogger(__name__).warning("[migration] es tracks index/backfill ensure failed: %s", _e)

    # Recover stuck MV jobs (active status but no running task after server restart)
    try:
        from .database.mongodb import get_mongo
        mongo = get_mongo()
        stuck_result = await mongo.mv_jobs.update_many(
            {"status": {"$in": ["splitting", "generating_images", "generating_videos", "concatenating"]}},
            {"$set": {"status": "paused", "error_message": "서버 재시작으로 인해 중지됨", "cancel_requested": False, "retry_info": None}},
        )
        if stuck_result.modified_count > 0:
            print(f"Recovered {stuck_result.modified_count} stuck MV jobs → paused")
    except Exception as e:
        print(f"MV job recovery failed: {e}")

    # Recover stale character sheet jobs — a `processing` job older than 30min
    # has lost its background task (e.g. server restart) and will never finish.
    # Points: each recovered job also refunds its pre-deducted points (once —
    # guarded by the atomic `refunded` flag shared with the async runner).
    try:
        from .database.mongodb import get_mongo
        from .routes.character import refund_character_job_points
        mongo = get_mongo()
        _stale_filter = {
            "status": "processing",
            "created_at": {"$lt": datetime.utcnow() - timedelta(minutes=30)},
        }
        _n_failed = 0
        _n_refunded = 0
        async for _job in mongo.character_jobs.find(_stale_filter, {"_id": 1}):
            _claimed = await mongo.character_jobs.find_one_and_update(
                {"_id": _job["_id"], "status": "processing"},
                {"$set": {
                    "status": "failed",
                    "error": "서버 재시작으로 중단됨",
                    "updated_at": datetime.utcnow(),
                }},
            )
            if not _claimed:
                continue  # 러너/타 워커가 그 사이 상태를 바꿈 — 건드리지 않음
            _n_failed += 1
            if await refund_character_job_points(mongo, _job["_id"]):
                _n_refunded += 1
        if _n_failed > 0:
            print(f"[migration] character_jobs stale recovered n={_n_failed} refunded={_n_refunded}")
    except Exception as e:
        print(f"[migration] character_jobs stale recovery failed: {e}")

    # v44 — Recover stuck beat extractions (running → pending) and re-trigger
    # v206: lifespan 은 pending 목록 조회까지만. 처리는 단일 데몬 스레드가
    # 순차로 sync 래퍼들을 호출한다 (_run_beat_recovery 참조).
    try:
        from .database.mongodb import get_mongo
        mongo = get_mongo()

        # Reset stuck "running" rows back to pending
        gen_reset = await mongo.generations.update_many(
            {"beats_status": "running"},
            {"$set": {"beats_status": "pending"}},
        )
        track_reset = await mongo.tracks.update_many(
            {"beats_status": "running"},
            {"$set": {"beats_status": "pending"}},
        )
        if gen_reset.modified_count or track_reset.modified_count:
            logger.info(
                "[beat-recover] recovered stuck beat extractions: generations=%d tracks=%d → pending",
                gen_reset.modified_count,
                track_reset.modified_count,
            )

        # Re-trigger pending extractions for completed generations.
        # v206: 여기(async lifespan)서는 목록 조회만 하고, madmom 실행은
        # 데몬 스레드에 위임 — 메인 이벤트 루프에 CPU 작업을 걸지 않는다.
        pending_gens = await mongo.generations.find(
            {
                "beats_status": "pending",
                "status": "completed",
                "result_audio_url": {"$ne": None},
            },
            {"_id": 1},
        ).to_list(length=200)

        pending_tracks = await mongo.tracks.find(
            {"beats_status": "pending", "audio_url": {"$ne": None}},
            {"_id": 1},
        ).to_list(length=200)

        if pending_gens or pending_tracks:
            import threading as _threading

            _threading.Thread(
                target=_run_beat_recovery,
                args=(
                    [str(g["_id"]) for g in pending_gens],
                    [str(t["_id"]) for t in pending_tracks],
                ),
                daemon=True,
                name="beat-recover",
            ).start()
    except Exception as e:
        logger.warning("[beat-recover] beat extraction recovery failed: %s", e)

    # Recover Redis chart data from MongoDB
    try:
        from .database.redis import get_redis
        from .services.chart_recovery import rebuild_redis_from_mongo
        redis = get_redis()
        await rebuild_redis_from_mongo(mongo, redis)
    except Exception as e:
        print(f"Chart data recovery failed: {e}")

    # Start background task for playcount sync
    from .services.playcount_sync import start_playcount_scheduler
    sync_task = start_playcount_scheduler()

    # Start background task for MV asset cleanup (24h retention, hourly sweep)
    import asyncio as _asyncio
    from .services.mv_assets import cleanup_loop as _mv_asset_cleanup_loop
    asset_cleanup_task = _asyncio.create_task(_mv_asset_cleanup_loop(3600))

    # OfficialSquad — maidol_official 공식 계정 시드 + 전체 유저 양방향 맞팔 백필
    # (CS 오류신고 DM 문의 채널 기반). best-effort — 실패해도 서버 기동 계속.
    try:
        from .database import postgres as _pg
        from .services.official import ensure_official_account
        async with _pg._pool.acquire() as _conn:
            _official_id = await ensure_official_account(_conn)
            # 공식↔모든 기존 유저 양방향 맞팔 멱등 백필 (공식 자기 자신 제외)
            _r_in = await _conn.execute(
                """INSERT INTO follows (follower_id, followee_id)
                   SELECT u.id, $1::uuid FROM users u
                   WHERE u.id <> $1::uuid
                     AND NOT EXISTS (
                         SELECT 1 FROM follows f
                         WHERE f.follower_id = u.id AND f.followee_id = $1::uuid
                     )""",
                _official_id,
            )
            _r_out = await _conn.execute(
                """INSERT INTO follows (follower_id, followee_id)
                   SELECT $1::uuid, u.id FROM users u
                   WHERE u.id <> $1::uuid
                     AND NOT EXISTS (
                         SELECT 1 FROM follows f
                         WHERE f.follower_id = $1::uuid AND f.followee_id = u.id
                     )""",
                _official_id,
            )

        def _n(res):
            try:
                return int(str(res).split()[-1])
            except (ValueError, IndexError):
                return 0

        logging.getLogger(__name__).info(
            "[official] backfill mutual-follow count=%d", _n(_r_in) + _n(_r_out)
        )
        print(f"[official] seed ok id={_official_id[:8]}")
    except Exception as _e:
        logging.getLogger(__name__).error("[official] seed/backfill failed: %s", _e)

    # v152 DmSquad — Redis pub/sub 리스너(실시간 DM 팬아웃). Redis init(위) 이후 기동.
    from .routes.dm import dm_pubsub_listener
    dm_listener_task = _asyncio.create_task(dm_pubsub_listener())

    yield

    # Shutdown
    sync_task.cancel()
    asset_cleanup_task.cancel()
    dm_listener_task.cancel()
    await close_postgres()
    await close_mongodb()
    await close_redis()
    try:
        await close_elasticsearch()
    except Exception as _e:
        logging.getLogger(__name__).warning("[shutdown] es close failed: %s", _e)
    print("All database connections closed.")


# v204: CORS 허용 Origin 파서 — "*" 면 현행과 동일한 전체 허용(["*"]),
# 아니면 쉼표 분리 + 공백 트림 + 빈 항목 제거한 명단을 돌려준다.
# 빈 문자열(.env 에 CORS_ORIGINS= 만 있고 값이 없는 경우)도 "*" 로 취급 —
# .env.example 을 그대로 복사해도 CORS 가 전부 막히는 사고 방지.
def _parse_cors_origins(raw: str) -> list:
    raw = raw.strip()
    if raw in ("", "*"):
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


# v204: DOCS_ENABLED=false(운영) 면 /docs·/redoc·/openapi.json 전부 비활성.
# True(기본) 면 kwargs 를 아예 넘기지 않아 현행 기본 경로 그대로.
_docs_kwargs = (
    {}
    if settings.docs_enabled
    else {"docs_url": None, "redoc_url": None, "openapi_url": None}
)

app = FastAPI(title="MAIDOL Platform API v2", lifespan=lifespan, **_docs_kwargs)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(settings.cors_origins),  # v204: .env CORS_ORIGINS
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(oauth.router)
app.include_router(admin.router)
app.include_router(tracks.router)
app.include_router(albums.router)
app.include_router(artists.router)
app.include_router(charts.router)
app.include_router(playlists.router)
app.include_router(likes.router)
app.include_router(upload.router)
app.include_router(follows.router)
app.include_router(generate.router)
app.include_router(mv.router)
app.include_router(character.router)
app.include_router(voice_clone.router)
app.include_router(wondera.router)
app.include_router(rewards.router)
app.include_router(business.router)
app.include_router(wishlist.router)
app.include_router(points.router)
app.include_router(fatigue.router)
app.include_router(attendance.router)
app.include_router(feeds.router)
app.include_router(face_verify.router)
app.include_router(reports.router)
app.include_router(dm.router)
app.include_router(referral.router)
app.include_router(admin_moderation.router)
app.include_router(admin_cs.router)
app.include_router(admin_points.router)
app.include_router(admin_ads.router)
app.include_router(admin_issues.router)
app.include_router(admin_notices.router)
app.include_router(issues.router)
from .routes import notifications as _notifications  # v192 인앱 알림
app.include_router(_notifications.router)
app.include_router(_logs.router, prefix="/api/_logs", tags=["_logs"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# v204: /api/ready 의 5종 체크 — 모듈 수준 async 함수로 분리 (P4).
# tester 가 인프라 컨테이너를 건드리지 않고 _READY_CHECKS 항목 교체(몽키패치)로
# 실패 경로(503)를 주입할 수 있어야 하므로 엔드포인트 안 클로저 금지.
async def _ready_check_postgres():
    from .database.postgres import ping_pg
    await ping_pg()


async def _ready_check_mongodb():
    from .database.mongodb import get_mongo
    await get_mongo().command("ping")


async def _ready_check_redis():
    from .database.redis import get_redis
    await get_redis().ping()


async def _ready_check_elasticsearch():
    # AsyncElasticsearch.ping() 은 실패 시 False 를 반환(예외 미발생) — 명시 격상
    if not await get_es().ping():
        raise RuntimeError("es ping returned False")


async def _ready_check_minio():
    import asyncio as _asyncio
    from .database.minio import get_minio
    # MinIO SDK 는 동기 — 이벤트루프 블로킹 방지 위해 스레드로
    exists = await _asyncio.to_thread(
        get_minio().bucket_exists, settings.minio_bucket_images
    )
    if not exists:
        raise RuntimeError("images bucket missing")


# v204(P4): 체크 레지스트리 — 키 이름은 TESTPLAN 과 일치(고정).
# 엔드포인트는 반드시 이 딕셔너리를 순회한다 (직접 호출 금지 — 패치 무력화됨).
_READY_CHECKS = {
    "postgres": _ready_check_postgres,
    "mongodb": _ready_check_mongodb,
    "redis": _ready_check_redis,
    "elasticsearch": _ready_check_elasticsearch,
    "minio": _ready_check_minio,
}


@app.get("/api/ready")
async def ready():
    """v204: LB readiness probe — PG/Mongo/Redis/ES/MinIO 5종 병렬 체크.

    각 체크는 2초 타임아웃(asyncio.wait_for), 전체는 gather 병렬. 전부 OK 면
    200 / 하나라도 실패면 503, 동일 구조 {"status","checks","timestamp"}.
    무인증(LB 헬스체크용). 에러 원문·호스트·비밀값은 응답에 절대 싣지 않고
    `[ready]` 태그로 서버 로그에만 남긴다.
    """
    import asyncio as _asyncio

    # P4/R1: 반드시 _READY_CHECKS 딕셔너리를 순회 — tester 가 항목 교체(몽키패치)로
    # 실패를 주입할 수 있어야 하므로 체크 함수 직접 호출 금지.
    items = list(_READY_CHECKS.items())
    names = [name for name, _ in items]
    results = await _asyncio.gather(
        *(_asyncio.wait_for(check(), timeout=2.0) for _, check in items),
        return_exceptions=True,
    )

    checks = {}
    for name, res in zip(names, results):
        ok = not isinstance(res, BaseException)
        if not ok:
            logging.getLogger(__name__).warning("[ready] %s check failed: %s", name, res)
        checks[name] = ok

    all_ok = all(checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={
            "status": "ready" if all_ok else "not_ready",
            "checks": checks,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "서버 내부 오류가 발생했습니다."})
