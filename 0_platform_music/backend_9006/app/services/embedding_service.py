"""
VectorSearch embedding service.

Hybrid semantic search backing: track vector embeddings live in PostgreSQL
(pgvector, table `track_embeddings`), while the track body stays in MongoDB.

Flow:
- build_track_text(doc)      -> synthesize a single text blob from a track doc
- embed_text(text)           -> OpenAI embedding (settings.embedding_model)
- upsert_track_embedding(..) -> content-hash gated upsert into track_embeddings
- search_similar(..)         -> cosine nearest-neighbour query -> [(track_id, score)]

Logging: entry / external-call / branch / warn / error are logged. We never log
API keys, raw query text or lyrics — only lengths and identifiers.
"""

import hashlib
import logging
from typing import List, Optional, Tuple

from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)

# OpenAI embedding models have an 8191-token limit; truncate generously by chars.
_MAX_INPUT_CHARS = 8000


def build_track_text(doc: dict) -> str:
    """Synthesize a single searchable text blob from a track document.

    Combines title, lyrics, prompt and the list-valued metadata fields
    (genre / mood / tags / categories / search_keywords). All fields are
    None-safe; lists are joined with spaces.

    HybridSearch — `search_keywords` (LLM-extracted concept keywords, stored once
    on the Mongo doc) is folded in here so abstract→concrete queries surface in
    the pgvector embedding too. Including it changes content_hash → re-embed.
    """
    if not doc:
        return ""

    parts: List[str] = []

    # v169 — uploader_nickname (artist name) leads the text alongside title so
    # artist-name queries also land on the semantic side, not just ES/regex.
    # Adding it changes content_hash → the existing re-embed pipeline
    # automatically re-embeds every track on its next index pass.
    for key in ("uploader_nickname", "title", "lyrics", "prompt"):
        val = doc.get(key)
        if val:
            parts.append(str(val))

    for key in ("genre", "mood", "tags", "categories", "search_keywords"):
        val = doc.get(key)
        if not val:
            continue
        if isinstance(val, (list, tuple)):
            joined = " ".join(str(x) for x in val if x)
            if joined:
                parts.append(joined)
        else:
            parts.append(str(val))

    return " ".join(parts).strip()


async def embed_text(text: str) -> List[float]:
    """Return the OpenAI embedding vector for `text`.

    Truncates overly long input to ~8000 chars. Logs only the length, never
    the content. Raises on API failure (callers decide fallback behaviour).
    """
    snippet = (text or "")[:_MAX_INPUT_CHARS]
    logger.info("[embedding.embed] text_len=%d (truncated_from=%d)", len(snippet), len(text or ""))

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    try:
        resp = await client.embeddings.create(model=settings.embedding_model, input=snippet)
    except Exception as e:
        logger.error("[embedding.embed] OpenAI embeddings.create failed text_len=%d: %s", len(snippet), e)
        raise
    return resp.data[0].embedding


def _vec_literal(v) -> str:
    """Render a float sequence as a pgvector literal string for `$N::vector` binding.

    No new python package needed — asyncpg binds this TEXT and PG casts it.
    """
    return "[" + ",".join(repr(float(x)) for x in v) + "]"


def _content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


async def upsert_track_embedding(conn, track_id: str, doc: dict) -> bool:
    """Embed a track and upsert its vector into track_embeddings.

    Content-hash gated: if the stored hash matches the current text, the
    expensive embedding call is skipped. Returns True if an embedding was
    written, False if it was cached/skipped.
    """
    text = build_track_text(doc)
    if not text:
        logger.warning("[embedding.upsert] track_id=%s empty text, skip", track_id)
        return False

    new_hash = _content_hash(text)
    logger.info("[embedding.upsert] track_id=%s text_len=%d", track_id, len(text))

    try:
        existing = await conn.fetchrow(
            "SELECT content_hash FROM track_embeddings WHERE track_id = $1", track_id
        )
    except Exception as e:
        logger.error("[embedding.upsert] track_id=%s hash lookup failed: %s", track_id, e)
        raise

    if existing and existing["content_hash"] == new_hash:
        logger.info("[embedding.upsert] track_id=%s cached=True, skip embed", track_id)
        return False

    vector = await embed_text(text)
    vec_lit = _vec_literal(vector)

    try:
        await conn.execute(
            """
            INSERT INTO track_embeddings (track_id, embedding, content_hash, model, updated_at)
            VALUES ($1, $2::vector, $3, $4, now())
            ON CONFLICT (track_id) DO UPDATE
            SET embedding = EXCLUDED.embedding,
                content_hash = EXCLUDED.content_hash,
                model = EXCLUDED.model,
                updated_at = now()
            """,
            track_id,
            vec_lit,
            new_hash,
            settings.embedding_model,
        )
    except Exception as e:
        logger.error("[embedding.upsert] track_id=%s insert failed: %s", track_id, e)
        raise

    logger.info("[embedding.upsert] track_id=%s written model=%s", track_id, settings.embedding_model)
    return True


async def search_similar(conn, query: str, k: int) -> List[Tuple[str, float]]:
    """Embed `query` and return the top-k nearest tracks as [(track_id, score)].

    score = 1 - cosine_distance (higher is closer). Raises on embedding failure
    so callers can fall back to regex search.
    """
    q_len = len(query or "")
    logger.info("[embedding.search] q_len=%d k=%d", q_len, k)

    vector = await embed_text(query)
    vec_lit = _vec_literal(vector)

    try:
        rows = await conn.fetch(
            """
            SELECT track_id, 1 - (embedding <=> $1::vector) AS score
            FROM track_embeddings
            ORDER BY embedding <=> $1::vector
            LIMIT $2
            """,
            vec_lit,
            k,
        )
    except Exception as e:
        logger.error("[embedding.search] q_len=%d nn query failed: %s", q_len, e)
        raise

    results = [(r["track_id"], float(r["score"])) for r in rows]
    logger.info("[embedding.search] q_len=%d returned=%d", q_len, len(results))
    return results


# ─── BackgroundTasks wrapper for routes/tracks.py publish hooks ──────────────

def index_track_in_background(track_id: str) -> None:
    """FastAPI BackgroundTasks entrypoint: embed & upsert a newly published track.

    Spins up its own event loop and asyncpg connection (independent of the
    request lifecycle), loads the track doc from MongoDB, and upserts its
    embedding. Never raises — publishing must succeed even if indexing fails.
    Mirrors the beat-extraction background pattern.
    """
    import asyncio

    async def _run() -> None:
        import asyncpg
        import motor.motor_asyncio
        from bson import ObjectId as _ObjectId

        logger.info("[tracks.index] track_id=%s indexing start", track_id)

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        pg_conn = None
        try:
            db = mongo_client[settings.mongo_db]
            if not _ObjectId.is_valid(track_id):
                logger.warning("[tracks.index] track_id=%s invalid id, skip", track_id)
                return
            doc = await db.tracks.find_one({"_id": _ObjectId(track_id)})
            if not doc:
                logger.warning("[tracks.index] track_id=%s doc not found, skip", track_id)
                return

            pg_conn = await asyncpg.connect(settings.postgres_dsn)
            await upsert_track_embedding(pg_conn, track_id, doc)
            logger.info("[tracks.index] track_id=%s indexing done", track_id)
        except Exception as e:
            logger.error("[tracks.index] track_id=%s indexing failed: %s", track_id, e)
        finally:
            if pg_conn is not None:
                try:
                    await pg_conn.close()
                except Exception:
                    pass
            mongo_client.close()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except Exception as e:  # pragma: no cover
        logger.error("[tracks.index] track_id=%s background runner failed: %s", track_id, e)
    finally:
        loop.close()


def enrich_and_index_track_in_background(track_id: str) -> None:
    """HybridSearch — unified publish hook: keywords → Mongo → pgvector + ES.

    Replaces the two separate background hooks (index_track_in_background +
    index_track_es_in_background) so ordering is guaranteed:
      1. load the track doc from MongoDB
      2. LLM-extract concept keywords and persist to Mongo `search_keywords`
         (best-effort — keyword failure never blocks publish/indexing)
      3. re-embed into pgvector (build_track_text now folds in search_keywords →
         content_hash changes → re-embed) using the *updated* doc
      4. mirror into the ES `tracks` index (now carrying the `keywords` field)

    Runs in its own event loop with short-lived Mongo / asyncpg / ES clients
    (independent of the request lifecycle). Never raises — publishing must
    succeed even if every enrichment/indexing step fails.
    """
    import asyncio

    async def _run() -> None:
        import asyncpg
        import motor.motor_asyncio
        from bson import ObjectId as _ObjectId
        from elasticsearch import AsyncElasticsearch

        from .keyword_service import generate_search_keywords
        from .search_service import ES_TRACKS_INDEX, _track_to_doc

        logger.info("[tracks.index.kw] track_id=%s enrich+index start", track_id)

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        pg_conn = None
        es_local = None
        try:
            db = mongo_client[settings.mongo_db]
            if not _ObjectId.is_valid(track_id):
                logger.warning("[tracks.index.kw] track_id=%s invalid id, skip", track_id)
                return
            oid = _ObjectId(track_id)
            doc = await db.tracks.find_one({"_id": oid})
            if not doc:
                logger.warning("[tracks.index.kw] track_id=%s doc not found, skip", track_id)
                return

            # 1) concept keywords → Mongo `search_keywords` (best-effort)
            try:
                keywords = await generate_search_keywords(doc, track_id=track_id)
                if keywords:
                    await db.tracks.update_one({"_id": oid}, {"$set": {"search_keywords": keywords}})
                    doc["search_keywords"] = keywords
                    logger.info("[tracks.index.kw] track_id=%s saved n=%d", track_id, len(keywords))
                else:
                    logger.warning("[tracks.index.kw] track_id=%s no keywords, indexing without", track_id)
            except Exception as e:
                logger.error("[tracks.index.kw] track_id=%s keyword step failed: %s", track_id, e)

            # 2) pgvector re-embed from the (possibly enriched) doc
            try:
                pg_conn = await asyncpg.connect(settings.postgres_dsn)
                await upsert_track_embedding(pg_conn, track_id, doc)
            except Exception as e:
                logger.error("[tracks.index.kw] track_id=%s embed step failed: %s", track_id, e)

            # 3) ES mirror (carries the new `keywords` field)
            try:
                # v189: ES 인증 — basic_auth None 이면 기존 동작(미전달)
                es_local = AsyncElasticsearch(
                    hosts=[settings.es_url], request_timeout=30,
                    basic_auth=settings.es_basic_auth,
                )
                await es_local.index(index=ES_TRACKS_INDEX, id=track_id, document=_track_to_doc(doc))
            except Exception as e:
                logger.error("[tracks.index.kw] track_id=%s es step failed: %s", track_id, e)

            logger.info("[tracks.index.kw] track_id=%s enrich+index done", track_id)
        except Exception as e:
            logger.error("[tracks.index.kw] track_id=%s enrich+index failed: %s", track_id, e)
        finally:
            if pg_conn is not None:
                try:
                    await pg_conn.close()
                except Exception:
                    pass
            if es_local is not None:
                try:
                    await es_local.close()
                except Exception:
                    pass
            mongo_client.close()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except Exception as e:  # pragma: no cover
        logger.error("[tracks.index.kw] track_id=%s background runner failed: %s", track_id, e)
    finally:
        loop.close()
