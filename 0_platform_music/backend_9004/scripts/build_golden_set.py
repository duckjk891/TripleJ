"""v169 — 검색 golden set 생성기: Mongo public 트랙에서 평가용 쿼리를 추출한다.

실제 카탈로그에서 유형별 쿼리 30~50개를 뽑아 scripts/search_golden.json 에
`[{query, expected_track_ids, type}]` 형태로 저장한다. scripts/search_eval.py 가
이 파일을 읽어 MRR@10 / Recall@10 을 산출한다.

쿼리 유형:
  - title_exact    제목 그대로
  - title_partial  제목 앞부분(2어절 이상 제목의 앞 2어절)
  - artist         uploader_nickname (기대 정답 = 그 아티스트의 공개 트랙 전부)
  - lyrics_phrase  가사 중간의 한 구절(8~24자 라인)
  - mood_genre     "{mood} {genre} 노래" 서술형 (기대 정답 = 같은 mood+genre 트랙)

결정적(deterministic): 트랙을 _id 오름차순으로 정렬해 앞에서부터 뽑는다.
재실행하면 같은 카탈로그에서는 같은 golden set 이 나온다.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/build_golden_set.py [--out scripts/search_golden.json]
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s", stream=sys.stdout)
logger = logging.getLogger("build_golden_set")

# 유형별 상한 (총합 30~50 목표)
_MAX_TITLE_EXACT = 12
_MAX_TITLE_PARTIAL = 8
_MAX_ARTIST = 8
_MAX_LYRICS = 10
_MAX_MOOD_GENRE = 8


def _txt(val) -> str:
    if not val:
        return ""
    if isinstance(val, (list, tuple)):
        return " ".join(str(x) for x in val if x)
    return str(val)


def _first(val) -> str:
    """list 필드(genre/mood)의 첫 항목, 스칼라면 그대로."""
    if isinstance(val, (list, tuple)):
        return str(val[0]) if val else ""
    return str(val) if val else ""


def _pick_lyrics_phrase(lyrics: str) -> str:
    """가사 중간의 8~24자 짜리 한 라인을 뽑는다 (없으면 "")."""
    lines = [ln.strip() for ln in (lyrics or "").splitlines()]
    lines = [ln for ln in lines if 8 <= len(ln) <= 24 and not ln.startswith("[")]
    if not lines:
        return ""
    return lines[len(lines) // 2]  # 후렴 반복이 많은 도입부 대신 중간 라인


async def build(out_path: Path) -> int:
    client = AsyncIOMotorClient(settings.computed_mongo_url)
    db = client[settings.mongo_db]
    try:
        docs = await db.tracks.find(
            {"is_public": True},
            {"title": 1, "lyrics": 1, "uploader_nickname": 1, "genre": 1, "mood": 1},
        ).sort("_id", 1).to_list(length=2000)
    finally:
        client.close()

    logger.info("public tracks loaded: %d", len(docs))
    if not docs:
        logger.error("no public tracks — golden set not generated")
        return 1

    golden = []
    seen_queries = set()

    def add(query: str, expected: list, qtype: str) -> None:
        query = " ".join((query or "").split()).strip()
        if not query or query.lower() in seen_queries or not expected:
            return
        seen_queries.add(query.lower())
        golden.append({"query": query, "expected_track_ids": expected, "type": qtype})

    # --- title_exact / title_partial ---
    n_exact = n_partial = 0
    for d in docs:
        title = _txt(d.get("title")).strip()
        if len(title) < 2:
            continue
        tid = str(d["_id"])
        if n_exact < _MAX_TITLE_EXACT:
            add(title, [tid], "title_exact")
            n_exact += 1
        words = title.split()
        if n_partial < _MAX_TITLE_PARTIAL and len(words) >= 3:
            add(" ".join(words[:2]), [tid], "title_partial")
            n_partial += 1

    # --- artist (기대 정답 = 그 아티스트의 공개 트랙 전부, 최대 10) ---
    by_artist: dict = {}
    for d in docs:
        artist = _txt(d.get("uploader_nickname")).strip()
        if len(artist) >= 2:
            by_artist.setdefault(artist, []).append(str(d["_id"]))
    for artist in sorted(by_artist.keys())[:_MAX_ARTIST]:
        add(artist, by_artist[artist][:10], "artist")

    # --- lyrics_phrase ---
    n_lyrics = 0
    for d in docs:
        if n_lyrics >= _MAX_LYRICS:
            break
        phrase = _pick_lyrics_phrase(_txt(d.get("lyrics")))
        if phrase:
            add(phrase, [str(d["_id"])], "lyrics_phrase")
            n_lyrics += 1

    # --- mood_genre 서술형 (기대 정답 = 같은 mood+genre 공개 트랙, 최대 10) ---
    by_mg: dict = {}
    for d in docs:
        mood = _first(d.get("mood")).strip()
        genre = _first(d.get("genre")).strip()
        if mood and genre:
            by_mg.setdefault((mood, genre), []).append(str(d["_id"]))
    for (mood, genre) in sorted(by_mg.keys())[:_MAX_MOOD_GENRE]:
        add(f"{mood} {genre} 노래", by_mg[(mood, genre)][:10], "mood_genre")

    by_type: dict = {}
    for g in golden:
        by_type[g["type"]] = by_type.get(g["type"], 0) + 1
    logger.info("golden queries: total=%d by_type=%s", len(golden), by_type)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(golden, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("written: %s", out_path)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the search golden set from Mongo public tracks")
    parser.add_argument("--out", default=str(ROOT / "scripts" / "search_golden.json"))
    args = parser.parse_args()
    return asyncio.run(build(Path(args.out)))


if __name__ == "__main__":
    sys.exit(main())
