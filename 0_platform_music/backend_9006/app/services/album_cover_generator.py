"""Album cover helpers — v69.

Pure helpers for album cover generation. The actual image generation is
delegated to ``cover_generator.generate_cover_image``.
"""

from typing import Iterable, Tuple, List


def aggregate_track_metadata(tracks: Iterable[dict]) -> Tuple[List[str], List[str]]:
    """Return (unique_genres, unique_moods) preserving first-seen order.

    Tracks may contain ``genre`` / ``mood`` as list[str]. Empty / missing
    values are skipped.
    """
    genres: List[str] = []
    moods: List[str] = []
    seen_g: set = set()
    seen_m: set = set()
    for t in tracks or []:
        for g in (t.get("genre") or []):
            if not g:
                continue
            key = str(g).strip()
            if not key or key in seen_g:
                continue
            seen_g.add(key)
            genres.append(key)
        for m in (t.get("mood") or []):
            if not m:
                continue
            key = str(m).strip()
            if not key or key in seen_m:
                continue
            seen_m.add(key)
            moods.append(key)
    return genres, moods
