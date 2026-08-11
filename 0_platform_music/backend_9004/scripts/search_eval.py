"""v169 — 검색 품질 평가: golden set 을 로컬 검색 API 에 재생해 MRR@10 / Recall@10 산출.

scripts/search_golden.json (build_golden_set.py 산출물) 의 각 쿼리를
GET {base}/api/tracks/search?q=... 로 호출하고 상위 10개 결과로 지표를 계산한다.

  - MRR@10    : 첫 정답의 역순위 평균 (상위 10 밖이면 0)
  - Recall@10 : |상위10 ∩ 기대정답| / |기대정답| 평균

유형별(title_exact/title_partial/artist/lyrics_phrase/mood_genre) + 전체 표 출력.

Usage:
    cd backend_9005
    ./venv/bin/python scripts/search_eval.py [--base http://127.0.0.1:9005] \
        [--golden scripts/search_golden.json] [--stabilize] [--es http://127.0.0.1:9200]

--stabilize (v171.1): ES `tracks` 인덱스를 forcemerge(max_num_segments=1) 해
세그먼트별 통계 차이로 BM25 점수가 요동하는 것을 막는다 — 평가 수치 재현용.
"""

import argparse
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent

_TOP_K = 10


def stabilize_index(es_base: str) -> None:
    """v171.1 — forcemerge the ES tracks index to 1 segment for reproducible BM25."""
    try:
        r = httpx.post(f"{es_base}/tracks/_forcemerge", params={"max_num_segments": 1}, timeout=60)
        r.raise_for_status()
        httpx.post(f"{es_base}/tracks/_refresh", timeout=30)
        print(f"stabilized: forcemerge max_num_segments=1 ok ({es_base}/tracks)")
    except Exception as e:
        print(f"stabilize failed (continuing): {e}")


def evaluate(base: str, golden_path: Path) -> int:
    try:
        golden = json.loads(golden_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"golden set load failed: {golden_path}: {e}")
        return 1
    if not golden:
        print(f"golden set empty: {golden_path}")
        return 1

    rows = []  # (type, query, rr, recall, n_results)
    with httpx.Client(base_url=base, timeout=30) as client:
        for item in golden:
            query = item.get("query") or ""
            expected = [str(t) for t in (item.get("expected_track_ids") or [])]
            qtype = item.get("type") or "?"
            if not query or not expected:
                continue
            try:
                resp = client.get("/api/tracks/search", params={"q": query, "limit": _TOP_K})
                resp.raise_for_status()
                tracks = (resp.json() or {}).get("tracks") or []
            except Exception as e:
                print(f"  ! request failed type={qtype} q={query!r}: {e}")
                tracks = []
            top_ids = [str(t.get("id")) for t in tracks[:_TOP_K]]

            rr = 0.0
            for rank, tid in enumerate(top_ids, start=1):
                if tid in expected:
                    rr = 1.0 / rank
                    break
            recall = len(set(top_ids) & set(expected)) / len(expected)
            rows.append((qtype, query, rr, recall, len(top_ids)))

    if not rows:
        print("no evaluable queries")
        return 1

    def agg(subset):
        n = len(subset)
        mrr = sum(r[2] for r in subset) / n
        rec = sum(r[3] for r in subset) / n
        return n, mrr, rec

    print()
    print(f"base={base} golden={golden_path} queries={len(rows)} (top{_TOP_K})")
    print(f"{'type':<15}{'n':>4}{'MRR@10':>10}{'Recall@10':>12}")
    print("-" * 41)
    for qtype in sorted({r[0] for r in rows}):
        n, mrr, rec = agg([r for r in rows if r[0] == qtype])
        print(f"{qtype:<15}{n:>4}{mrr:>10.3f}{rec:>12.3f}")
    n, mrr, rec = agg(rows)
    print("-" * 41)
    print(f"{'ALL':<15}{n:>4}{mrr:>10.3f}{rec:>12.3f}")

    misses = [r for r in rows if r[2] == 0.0]
    if misses:
        print(f"\nzero-hit queries ({len(misses)}):")
        for qtype, query, _, _, n_res in misses:
            print(f"  [{qtype}] {query!r} (results={n_res})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate track search vs the golden set")
    parser.add_argument("--base", default="http://127.0.0.1:9005")
    parser.add_argument("--golden", default=str(ROOT / "scripts" / "search_golden.json"))
    parser.add_argument("--stabilize", action="store_true",
                        help="forcemerge the ES tracks index to 1 segment before evaluating")
    parser.add_argument("--es", default="http://127.0.0.1:9200")
    args = parser.parse_args()
    if args.stabilize:
        stabilize_index(args.es)
    return evaluate(args.base, Path(args.golden))


if __name__ == "__main__":
    sys.exit(main())
