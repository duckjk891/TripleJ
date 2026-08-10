"""HybridSearch — Elasticsearch BM25 (Korean nori + fuzzy) side of the hybrid
track search, plus the RRF fusion that merges it with pgvector semantic results.

Track bodies live in MongoDB; this module keeps a lightweight searchable mirror
of each public track in the ES `tracks` index (title / lyrics / prompt / tags /
genre / mood + is_public). The route layer (routes/tracks.py) calls:

- es_index_track(doc)        -> best-effort upsert of one track into ES
- es_search(query, k)        -> BM25 + fuzzy multi_match -> ranked [track_id]
- rrf_fuse(vec_ids, es_ids)  -> Reciprocal Rank Fusion of the two ranked lists

Logging: entry / external-call / branch / warn / error are logged with the
query *length* and identifiers only — never the raw query, lyrics or any key.
Every ES call is best-effort: failures are logged and degrade gracefully so the
route can fall back to vector-only or regex search.
"""

import logging
from typing import List, Optional

from ..database.elasticsearch import get_es

logger = logging.getLogger(__name__)

# ES index name for the searchable track mirror.
ES_TRACKS_INDEX = "tracks"

# HybridSearch — analyzer name applied to every korean text field (index + search).
KO_SEARCH_ANALYZER = "ko_search"

# Music-search filler stopwords (한국어 음악검색 *필러* 큐레이션). Only generic
# "listen to a song / playlist / when / good / recommend" plumbing words — NEVER
# meaning-bearing emotion/topic words. nori splits e.g. "설레일때 듣는 노래" into
# ['설레이','때','들','노래']; the 노래/때/들 fillers match lyrics ("노래해") and
# inflate noise (es_weight=2.0), so they are removed at both index + search time.
# NOTE: these are matched AFTER nori_tokenizer + nori_part_of_speech, so they must
# be the analyzed *stem* forms. e.g. "듣는"/"들을"/"들어" all reduce to the verb
# stem 들 (듣다); "노래" stays 노래. The leftover verb stem 들 was the noise that let
# "심장을 깨워" outrank the 벚꽃 cluster on "설레일때 듣는 노래" — so 들 is included.
_MUSIC_STOPWORDS = [
    "노래", "음악", "곡", "사운드", "트랙",
    "듣다", "듣", "들", "듣기", "들기",
    # 싶(싶다 auxiliary; "듣고싶어"→[들,싶]) and 하(generic verb; "할때"→[하,때])
    # are filler stems that otherwise leak — the 싶 token lexically matched the
    # title "잊고 싶어 너를" and pushed that ballad to #1 on "신나는 노래 듣고싶어".
    "싶", "하",
    "때", "때문", "좋다", "좋", "최고",
    "추천", "플레이리스트", "플리", "리스트", "모음",
    "song", "songs", "music", "listen", "playlist", "track", "sound", "good",
]

# Inflection / synonym groups (활용형·동의어 정규화). Each group collapses Korean
# inflected forms + close synonyms of a single *mood* onto one canonical token so
# query form (설레이/설레임/설레는/설렘) no longer has to glyph-match the indexed
# keyword. Single-token RHS → safe for synonym_graph at both index and search time.
# Scope deliberately narrow (music-mood centric) to avoid regressions.
_MOOD_SYNONYMS = [
    "설레임,설레는,설레이,설레일,설렘,두근,두근거리는,두근거림 => 설렘",
    "신나다,신나는,신남,신나,흥겨운,들뜨는,업,텐션 => 신남",
    "잔잔,잔잔한,잔잔하다,차분,차분한,고요한,평온한 => 잔잔",
    "위로,위로되는,위로받는,위안,토닥 => 위로",
    "슬프다,슬픈,슬픔,눈물,울적,우울한 => 슬픔",
    "행복,행복한,기쁨,기쁜,즐거운 => 행복",
    "그립다,그리운,그리움,보고싶은,애틋한 => 그리움",
    "사랑,사랑하는,러브,연애,설레이는사랑 => 사랑",
    "이별,헤어짐,헤어진,이별한,결별 => 이별",
    "에너지,에너제틱,파워,활기찬,힘찬 => 에너지",
]

# Custom analyzer settings shared by every korean text field. nori tokenizer →
# lowercase → music_stop (filler removal) → mood_syn (inflection/synonym
# normalization). Same analyzer at index + search time so tokens align.
_KO_ANALYSIS = {
    "analysis": {
        "tokenizer": {
            "ko_nori_tokenizer": {"type": "nori_tokenizer"},
        },
        "filter": {
            # Drop Korean grammatical particles / endings / determiners by POS tag
            # (J=josa, E=endings, MM/MAG/MAJ=adnominal/adverbs, X*=affixes, S*=symbols).
            # This removes leftover particles like the 는 in "듣는" that otherwise stay
            # as a token and create lexical noise. Mirrors nori default + extras.
            "ko_pos": {
                "type": "nori_part_of_speech",
                "stoptags": [
                    "E", "IC", "J", "MAG", "MAJ", "MM",
                    "SP", "SSC", "SSO", "SC", "SE",
                    "XPN", "XSA", "XSN", "XSV",
                    "UNA", "NA", "VSV",
                ],
            },
            "music_stop": {
                "type": "stop",
                "stopwords": _MUSIC_STOPWORDS,
            },
            "mood_syn": {
                "type": "synonym_graph",
                "lenient": True,
                "synonyms": _MOOD_SYNONYMS,
            },
        },
        "analyzer": {
            KO_SEARCH_ANALYZER: {
                "type": "custom",
                "tokenizer": "ko_nori_tokenizer",
                # order: POS-strip particles → lowercase → filler stop → mood synonym.
                "filter": ["ko_pos", "lowercase", "music_stop", "mood_syn"],
            },
        },
    }
}


def _ko_text_field() -> dict:
    """A korean text field bound to the shared ko_search analyzer (index+search)."""
    return {"type": "text", "analyzer": KO_SEARCH_ANALYZER}


# Single source of truth for the `tracks` index mapping (ko_search analyzer =
# nori + filler-stop + mood-synonym). Used by ensure_tracks_index() here and
# re-used by main.py lifespan + scripts/backfill_es.py so the mapping can never
# drift between the three call sites.
TRACKS_INDEX_BODY = {
    "settings": _KO_ANALYSIS,
    "mappings": {
        "properties": {
            "track_id": {"type": "keyword"},
            "title": _ko_text_field(),
            "lyrics": _ko_text_field(),
            "prompt": _ko_text_field(),
            "genre": _ko_text_field(),
            "mood": _ko_text_field(),
            "tags": _ko_text_field(),
            # HybridSearch — LLM-extracted concept keywords (Mongo `search_keywords`).
            # Lets abstract→concrete BM25 hits (e.g. "음식" → '사랑의 김장') surface.
            "keywords": _ko_text_field(),
            # v169 — artist (Mongo `uploader_nickname`). 아티스트명 검색이 ES 를 전혀
            # 타지 못하고 regex 폴백에만 의존하던 실버그 픽스. 최상위 부스트 대상.
            "artist": _ko_text_field(),
            # v169 — play_count mirror for function_score popularity boosting.
            "play_count": {"type": "integer"},
            "is_public": {"type": "boolean"},
        }
    },
}


def _as_text(val) -> str:
    """None-safe coercion of a scalar-or-list field into a single string."""
    if not val:
        return ""
    if isinstance(val, (list, tuple)):
        return " ".join(str(x) for x in val if x)
    return str(val)


def _track_to_doc(doc: dict) -> dict:
    """Project a MongoDB track document onto the ES `tracks` mapping fields."""
    return {
        "track_id": str(doc.get("_id")),
        "title": _as_text(doc.get("title")),
        "lyrics": _as_text(doc.get("lyrics")),
        "prompt": _as_text(doc.get("prompt")),
        "tags": _as_text(doc.get("tags")),
        "genre": _as_text(doc.get("genre")),
        "mood": _as_text(doc.get("mood")),
        # HybridSearch — concept keywords shared with the pgvector embedding text.
        "keywords": _as_text(doc.get("search_keywords")),
        # v169 — artist name (uploader_nickname) + play_count popularity signal.
        "artist": _as_text(doc.get("uploader_nickname")),
        "play_count": int(doc.get("play_count") or 0),
        "is_public": bool(doc.get("is_public", False)),
    }


async def ensure_tracks_index(es) -> bool:
    """Ensure the ES `tracks` index exists with the nori mapping (idempotent).

    Returns True if the index exists (or was created), False on any failure.
    Best-effort: logs and returns False rather than raising so startup / backfill
    callers can degrade gracefully.
    """
    if es is None:
        logger.warning("[search.es.index.ensure] skipped: ES client not initialized")
        return False
    try:
        exists = await es.indices.exists(index=ES_TRACKS_INDEX)
        if not exists:
            await es.indices.create(index=ES_TRACKS_INDEX, body=TRACKS_INDEX_BODY)
            logger.info("[search.es.index.ensure] created index '%s'", ES_TRACKS_INDEX)
        else:
            logger.info("[search.es.index.ensure] index '%s' present", ES_TRACKS_INDEX)
            # v169 migration — put_mapping is additive & idempotent: fields that
            # already exist with the same definition are a no-op, brand-new fields
            # (artist / play_count) are added without recreating the index. A
            # mapping failure must NOT disable search (index still works with the
            # old mapping), so it only logs.
            try:
                await es.indices.put_mapping(
                    index=ES_TRACKS_INDEX,
                    body={"properties": TRACKS_INDEX_BODY["mappings"]["properties"]},
                )
                logger.info("[search.es.migrate] put_mapping ok on '%s'", ES_TRACKS_INDEX)
            except Exception as me:
                logger.error("[search.es.migrate] put_mapping failed on '%s': %s", ES_TRACKS_INDEX, me)
        return True
    except Exception as e:
        logger.error("[search.es.index.ensure] failed for '%s': %s", ES_TRACKS_INDEX, e)
        return False


async def backfill_es_if_needed(es, mongo_db, force: bool = False) -> dict:
    """Self-heal the ES `tracks` index from MongoDB when it has drifted/emptied.

    Ensures the index, then compares ES doc count vs. Mongo public-track count.
    If force=True OR es_count < mongo_public_count, re-indexes every public track
    (idempotent upsert by track_id) and refreshes the index. Best-effort: any
    failure is logged and the partial result is returned — never raises so it is
    safe to schedule from startup. Returns a summary dict with counts.
    """
    result = {
        "ok": False,
        "es_count": 0,
        "mongo_public_count": 0,
        "reindexed": 0,
        "errors": 0,
        "skipped": False,
    }
    if es is None or mongo_db is None:
        logger.warning(
            "[search.es.heal] skipped: es=%s mongo=%s",
            es is not None, mongo_db is not None,
        )
        return result

    if not await ensure_tracks_index(es):
        logger.warning("[search.es.heal] aborted: index ensure failed")
        return result

    try:
        # ES count (refresh first so freshly-indexed docs are visible/countable).
        try:
            await es.indices.refresh(index=ES_TRACKS_INDEX)
        except Exception:
            pass
        es_count = (await es.count(index=ES_TRACKS_INDEX)).get("count", 0)
        mongo_public_count = await mongo_db.tracks.count_documents({"is_public": True})
        result["es_count"] = es_count
        result["mongo_public_count"] = mongo_public_count
    except Exception as e:
        logger.error("[search.es.heal] count failed: %s", e)
        return result

    need = force or (es_count < mongo_public_count)

    # v169 migration auto-detect — adding `artist`/`play_count` to the mapping
    # (put_mapping) does NOT touch already-indexed documents, and the count-based
    # skip above would leave them without the new fields forever. Sample one doc:
    # if its _source lacks the `artist` key the index predates v169 → one-off
    # force reindex from Mongo. Idempotent: after that reindex every _source has
    # the key, so this never triggers again.
    if not need and es_count > 0:
        try:
            sample = await es.search(
                index=ES_TRACKS_INDEX, body={"size": 1, "query": {"match_all": {}}}
            )
            sample_hits = sample.get("hits", {}).get("hits", [])
            if sample_hits and "artist" not in (sample_hits[0].get("_source") or {}):
                need = True
                logger.info(
                    "[search.es.migrate] sample doc missing 'artist' -> force full reindex (v169)"
                )
        except Exception as e:
            logger.warning("[search.es.migrate] sample probe failed: %s", e)

    if not need:
        result["ok"] = True
        result["skipped"] = True
        logger.info(
            "[search.es.heal] es=%d mongo=%d reindexed=0 (in sync, skip)",
            es_count, mongo_public_count,
        )
        return result

    ok = err = 0
    try:
        cursor = mongo_db.tracks.find({"is_public": True})
        async for doc in cursor:
            track_id = str(doc.get("_id"))
            try:
                await es.index(index=ES_TRACKS_INDEX, id=track_id, document=_track_to_doc(doc))
                ok += 1
            except Exception as e:
                err += 1
                logger.error("[search.es.heal] track_id=%s reindex failed: %s", track_id, e)
        try:
            await es.indices.refresh(index=ES_TRACKS_INDEX)
        except Exception:
            pass
    except Exception as e:
        logger.error("[search.es.heal] reindex cursor failed: %s", e)

    result["reindexed"] = ok
    result["errors"] = err
    result["ok"] = err == 0
    logger.info(
        "[search.es.heal] es=%d mongo=%d reindexed=%d errors=%d force=%s",
        es_count, mongo_public_count, ok, err, force,
    )
    return result


async def es_index_track(doc: dict) -> bool:
    """Upsert one track document into the ES `tracks` index by track_id.

    Best-effort: returns True on success, False (with a logged warning/error) on
    any failure so callers never raise on indexing problems.
    """
    es = get_es()
    track_id = str(doc.get("_id")) if doc else None
    if es is None:
        logger.warning("[search.es.index] track_id=%s skipped: ES client not initialized", track_id)
        return False
    if not track_id:
        logger.warning("[search.es.index] skipped: doc has no _id")
        return False

    body = _track_to_doc(doc)
    logger.info("[search.es.index] track_id=%s indexing is_public=%s", track_id, body["is_public"])
    try:
        await es.index(index=ES_TRACKS_INDEX, id=track_id, document=body)
    except Exception as e:
        logger.error("[search.es.index] track_id=%s index failed: %s", track_id, e)
        return False
    logger.info("[search.es.index] track_id=%s indexed", track_id)
    return True


async def es_delete_track(track_id: str) -> bool:
    """v138 — 트랙 완전 파기 시 ES 문서 제거 (best-effort, 404 무해).

    es_index_track 과 동일한 계약: 실패해도 raise 하지 않고 False 반환.
    """
    es = get_es()
    if es is None:
        logger.warning("[search.es.delete] track_id=%s skipped: ES client not initialized", track_id)
        return False
    if not track_id:
        return False
    try:
        await es.delete(index=ES_TRACKS_INDEX, id=track_id)
    except Exception as e:
        # 색인 안 된 트랙(비공개 생성 직후 등)은 404 NotFound — 정상 케이스.
        if "NotFoundError" in type(e).__name__ or "not_found" in str(e):
            logger.info("[search.es.delete] track_id=%s not in index (ok)", track_id)
            return True
        logger.error("[search.es.delete] track_id=%s delete failed: %s", track_id, e)
        return False
    logger.info("[search.es.delete] track_id=%s deleted", track_id)
    return True


async def es_update_play_count(track_id: str, play_count: int) -> bool:
    """v169 — best-effort ES partial update of a track's play_count mirror.

    Called from the charts record-play hook after the Mongo $inc so the
    function_score popularity boost stays fresh. Never raises: a track that is
    not in the index (private / not yet published) 404s and is logged as info;
    any other failure logs a warning. Search correctness never depends on this.
    """
    es = get_es()
    if es is None:
        logger.warning("[search.es.playcount] track_id=%s skipped: ES client not initialized", track_id)
        return False
    if not track_id:
        return False
    try:
        await es.update(index=ES_TRACKS_INDEX, id=track_id, doc={"play_count": int(play_count)})
    except Exception as e:
        if "NotFoundError" in type(e).__name__ or "not_found" in str(e):
            logger.info("[search.es.playcount] track_id=%s not in index (ok)", track_id)
        else:
            logger.warning("[search.es.playcount] track_id=%s update failed: %s", track_id, e)
        return False
    logger.info("[search.es.playcount] track_id=%s play_count=%d", track_id, int(play_count))
    return True


async def es_search(query: str, k: int) -> List[str]:
    """BM25 + fuzzy search the ES `tracks` index, return ranked [track_id].

    multi_match over lyrics/title/prompt/tags/genre/mood using the nori analyzer
    with fuzziness AUTO, filtered to public tracks. Best-effort: on any failure
    (ES down, index missing) logs and returns []. Raising is the caller's job to
    decide via empty-result degrade.
    """
    q_len = len(query or "")
    es = get_es()
    if es is None:
        logger.warning("[search.es] q_len=%d skipped: ES client not initialized", q_len)
        return []
    if not query:
        return []

    body = {
        "size": k,
        "_source": ["track_id"],
        # v169 — function_score wraps the relevance query with a small popularity
        # boost: log1p(play_count) * 0.1 ADDED to the BM25 score (boost_mode=sum).
        # factor 0.1 is deliberately low so relevance can never be inverted by a
        # popular-but-unrelated track — it only lifts popular tracks within a
        # near-tied relevance cluster (log1p also flattens whale play counts).
        "query": {
            "function_score": {
                "query": {
                    "bool": {
                        "must": {
                            "multi_match": {
                                "query": query,
                                # Field boosts: artist strongest (v169 — exact artist-name
                                # searches must top-rank their tracks), then title,
                                # lyrics + concept keywords next so rare lyric keywords
                                # (e.g. "어머니") and abstract concepts (e.g. "음식")
                                # surface; prompt/tags/genre/mood baseline.
                                "fields": ["artist^4", "title^3", "lyrics^2", "keywords^2", "prompt", "tags", "genre", "mood"],
                                # ko_search = nori + filler-stop + mood-synonym (same analyzer
                                # the fields are indexed with): strips 노래/때/들 fillers and
                                # normalizes 설레이→설렘 so query form no longer has to glyph-match.
                                "analyzer": KO_SEARCH_ANALYZER,
                                "fuzziness": "AUTO",
                            }
                        },
                        "filter": {"term": {"is_public": True}},
                    }
                },
                "functions": [
                    {
                        "field_value_factor": {
                            "field": "play_count",
                            "modifier": "log1p",
                            "factor": 0.1,
                            "missing": 0,
                        }
                    }
                ],
                "boost_mode": "sum",
            }
        },
    }

    try:
        resp = await es.search(index=ES_TRACKS_INDEX, body=body)
    except Exception as e:
        logger.error("[search.es] q_len=%d search failed: %s", q_len, e)
        return []

    hits = resp.get("hits", {}).get("hits", [])
    ids: List[str] = []
    for h in hits:
        tid = (h.get("_source") or {}).get("track_id") or h.get("_id")
        if tid:
            ids.append(str(tid))
    logger.info("[search.es] q_len=%d hits=%d", q_len, len(ids))
    return ids


def rrf_fuse(
    vec_ids: List[str],
    es_ids: List[str],
    k: int = 60,
    vec_weight: float = 1.0,
    es_weight: float = 1.0,
) -> List[str]:
    """Weighted Reciprocal Rank Fusion of two ranked track_id lists.

    The vector list contributes vec_weight/(k+rank) per id and the ES (BM25) list
    es_weight/(k+rank) (rank is 1-based). Scores sum across lists; the result is
    ordered by descending fused score, ties broken by first-seen order. Boosting
    es_weight lifts rare-keyword BM25 hits above generic semantic neighbours. If
    one list is empty the other passes through (de-duplicated, order preserved).
    """
    scores: dict = {}
    first_seen: dict = {}
    order = 0

    for ranked, weight in ((vec_ids or [], vec_weight), (es_ids or [], es_weight)):
        for rank, tid in enumerate(ranked, start=1):
            if not tid:
                continue
            scores[tid] = scores.get(tid, 0.0) + weight / (k + rank)
            if tid not in first_seen:
                first_seen[tid] = order
                order += 1

    fused = sorted(scores.keys(), key=lambda t: (-scores[t], first_seen[t]))
    logger.info(
        "[search.rrf] vec=%d es=%d fused=%d wv=%.2f we=%.2f",
        len(vec_ids or []), len(es_ids or []), len(fused), vec_weight, es_weight,
    )
    return fused


# ─── BackgroundTasks wrapper for routes/tracks.py publish hooks ──────────────

def index_track_es_in_background(track_id: str) -> None:
    """FastAPI BackgroundTasks entrypoint: mirror a newly published track into ES.

    Runs in its own event loop with a short-lived Mongo + ES client (independent
    of the request lifecycle), loads the track doc and upserts it into the ES
    `tracks` index. Never raises — publishing must succeed even if ES indexing
    fails. Mirrors embedding_service.index_track_in_background.
    """
    import asyncio

    async def _run() -> None:
        import motor.motor_asyncio
        from bson import ObjectId as _ObjectId
        from elasticsearch import AsyncElasticsearch

        from ..config import settings

        logger.info("[tracks.index.es] track_id=%s indexing start", track_id)

        mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.computed_mongo_url)
        es_local: Optional[AsyncElasticsearch] = None
        try:
            db = mongo_client[settings.mongo_db]
            if not _ObjectId.is_valid(track_id):
                logger.warning("[tracks.index.es] track_id=%s invalid id, skip", track_id)
                return
            doc = await db.tracks.find_one({"_id": _ObjectId(track_id)})
            if not doc:
                logger.warning("[tracks.index.es] track_id=%s doc not found, skip", track_id)
                return

            es_local = AsyncElasticsearch(hosts=[settings.es_url], request_timeout=30)
            body = _track_to_doc(doc)
            await es_local.index(index=ES_TRACKS_INDEX, id=track_id, document=body)
            logger.info("[tracks.index.es] track_id=%s indexing done", track_id)
        except Exception as e:
            logger.error("[tracks.index.es] track_id=%s indexing failed: %s", track_id, e)
        finally:
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
        logger.error("[tracks.index.es] track_id=%s background runner failed: %s", track_id, e)
    finally:
        loop.close()
