"""HybridSearch — concept-keyword extraction (index-time only).

Weakness this fixes: abstract→concrete queries (e.g. "음식" → '사랑의 김장')
failed because the literal words never appear in the title/lyrics. At index time
we ask a cheap LLM (settings.keyword_model = gpt-4o-mini) for 5~10 Korean concept
keywords that someone might search to find the song — including higher-level
concepts NOT present in the lyrics (음식/요리/계절/감정/상황 …).

The result is written ONCE to the Mongo track doc field `search_keywords` and is
then SHARED by both indexers:
  - embedding_service.build_track_text() (→ pgvector embedding text)
  - search_service._track_to_doc()       (→ ES `keywords` field)
so the LLM is never called again — search time does NO LLM calls, and the ES
self-heal backfill just reads the stored field.

Logging: entry / external-call / branch / warn / error are logged with the
track_id and counts/lengths only — never the API key or the full lyrics.
"""

import json
import logging
import re
from typing import List, Optional, Tuple

from openai import AsyncOpenAI

from ..config import settings

logger = logging.getLogger(__name__)

# Keep lyrics short so the prompt stays cheap; concepts come from the gist, not
# every line.
_MAX_LYRICS_CHARS = 1200
# Hard cap on returned keywords regardless of model output (raised to 15 to make
# room for the English + abstract-mood keywords added below).
_MAX_KEYWORDS = 15

_SYSTEM_PROMPT = (
    "너는 음악 검색용 키워드 추출기다. 주어진 곡 정보를 보고, 사용자가 이 곡을 "
    "검색으로 찾을 때 입력할 법한 키워드를 세 종류로 뽑아라.\n"
    "\n"
    "1) ko (한국어 구체 키워드, 4~8개): 곡의 소재·상황·관계·감정·계절 등 구체 키워드. "
    "**반드시** 곡의 핵심 소재를 아우르는 '상위 카테고리어'를 먼저 포함하라. "
    "구체적 소재가 있으면 그것의 상위 개념을 꼭 같이 넣어라. "
    "예: 김장/김치 → '음식','요리'; 벚꽃/단풍 → '계절','자연'; 이별/그리움 → '감정','이별'; "
    "운동/달리기 → '스포츠','운동'; 커피/카페 → '일상','음료'. "
    "(상위어가 가사·제목에 안 나와도 반드시 추가)\n"
    "\n"
    "2) en (영어 구체 키워드, 3~6개): 제목/가사/개념을 영어로 표현한 검색어. "
    "사용자가 영어로 검색해도 곡이 잡히게 한다. "
    "예: 이별 → breakup; 운동 → workout/gym; 로봇 → robot; 김장/요리 → kimchi/food/cooking; "
    "벚꽃 → cherry blossom/spring; 어머니 → mother.\n"
    "\n"
    "3) mood (추상 무드/느낌 키워드, 정확히 3개): 곡의 전반적 분위기·감정. 한국어와 영어를 섞어도 된다. "
    "예: 잔잔한/calm, 신나는/energetic, 위로되는/comforting, 슬픈/sad, 설레는/romantic.\n"
    "\n"
    "추가 규칙 — 별칭(v169): 제목과 아티스트명의 로마자 표기·통용 영문 표기·한글 음차 별칭을 "
    "2~4개 반드시 포함하라 (영문 표기는 en 목록에, 한글 음차는 ko 목록에 넣는다). "
    "예: 비티에스↔BTS, 뉴진스↔NewJeans, 아이유↔IU, '봄날'→'bomnal'. "
    "아티스트명이 주어지면 그 별칭도 포함하라.\n"
    "\n"
    "- 곡의 주제와 무관한 일반어(예: 노래/음악/좋다/song/music)는 금지.\n"
    "- 각 키워드는 짧은 단어나 짧은 구로.\n"
    '반드시 JSON 객체 하나만 출력: {"ko": ["..."], "en": ["..."], "mood": ["..."]}'
)


def _build_keyword_input(doc: dict) -> str:
    """Build the compact user message describing the track for keyword extraction.

    Uses title + (truncated) lyrics + prompt + genre/mood. None-safe; lists are
    space-joined. Returns "" if there is nothing useful to describe.
    """
    if not doc:
        return ""

    def _txt(val) -> str:
        if not val:
            return ""
        if isinstance(val, (list, tuple)):
            return " ".join(str(x) for x in val if x)
        return str(val)

    title = _txt(doc.get("title"))
    # v169 — 아티스트명(uploader_nickname): 별칭(로마자/음차) 키워드 추출 입력.
    artist = _txt(doc.get("uploader_nickname"))
    prompt = _txt(doc.get("prompt"))
    genre = _txt(doc.get("genre"))
    mood = _txt(doc.get("mood"))
    lyrics = _txt(doc.get("lyrics"))[:_MAX_LYRICS_CHARS]

    parts: List[str] = []
    if title:
        parts.append(f"제목: {title}")
    if artist:
        parts.append(f"아티스트: {artist}")
    if prompt:
        parts.append(f"곡 설명: {prompt}")
    if genre:
        parts.append(f"장르: {genre}")
    if mood:
        parts.append(f"분위기: {mood}")
    if lyrics:
        parts.append(f"가사(일부): {lyrics}")
    return "\n".join(parts).strip()


def _coerce_str_list(val) -> List[str]:
    """None-safe coercion of an arbitrary value into a list of trimmed strings."""
    if not isinstance(val, list):
        return []
    out: List[str] = []
    for item in val:
        if isinstance(item, str):
            kw = item.strip()
            if kw:
                out.append(kw)
    return out


def _parse_keywords(raw_text: str) -> Tuple[List[str], Tuple[int, int, int]]:
    """Defensively parse the LLM JSON into a clean, deduped, merged keyword list.

    Supports two schemas:
      - new:    {"ko": [...], "en": [...], "mood": [...]}  (preferred)
      - legacy: {"keywords": [...]}  or  a bare [...] list
    The three buckets are merged (ko → en → mood order) into ONE flat string list
    so downstream consumers (Mongo `search_keywords`, embedding text, ES keywords)
    stay unchanged.

    Steps: strip code fences → slice first '{' .. last '}' → json.loads (retry
    after removing trailing commas) → read buckets → coerce to trimmed strings,
    dedupe (case-insensitive, order-preserving), cap at _MAX_KEYWORDS.
    Never raises — returns ([], (0,0,0)) on any failure. The tuple is the kept
    (ko, en, mood) counts for logging.
    """
    raw = (raw_text or "").strip()
    if not raw:
        return [], (0, 0, 0)

    text = raw
    if text.startswith("```"):
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl + 1:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    text = text.strip()

    start = text.find("{")
    end = text.rfind("}")
    candidate = text[start:end + 1] if (start != -1 and end != -1 and end > start) else text

    parsed = None
    try:
        parsed = json.loads(candidate)
    except Exception:
        repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            parsed = json.loads(repaired)
        except Exception:
            parsed = None

    # Tag each bucket so we can count kept-per-bucket after merge+dedupe+cap.
    buckets: List[Tuple[str, str]] = []  # (kw, bucket)
    if isinstance(parsed, dict):
        if any(key in parsed for key in ("ko", "en", "mood")):
            for bucket in ("ko", "en", "mood"):
                for kw in _coerce_str_list(parsed.get(bucket)):
                    buckets.append((kw, bucket))
        else:
            for kw in _coerce_str_list(parsed.get("keywords")):
                buckets.append((kw, "ko"))
    elif isinstance(parsed, list):
        for kw in _coerce_str_list(parsed):
            buckets.append((kw, "ko"))

    if not buckets:
        return [], (0, 0, 0)

    out: List[str] = []
    seen = set()
    counts = {"ko": 0, "en": 0, "mood": 0}
    for kw, bucket in buckets:
        low = kw.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(kw)
        counts[bucket] = counts.get(bucket, 0) + 1
        if len(out) >= _MAX_KEYWORDS:
            break
    return out, (counts["ko"], counts["en"], counts["mood"])


async def generate_search_keywords(doc: dict, track_id: Optional[str] = None) -> List[str]:
    """Extract Korean-concrete + English-concrete + abstract-mood keywords via gpt-4o-mini.

    The LLM returns three buckets ({"ko","en","mood"}); they are merged into ONE
    deduped flat string list (capped at _MAX_KEYWORDS=15) so existing consumers
    stay unchanged. Returns [] on any failure (best-effort — the caller continues
    indexing/publishing regardless). The list is stored once in Mongo
    `search_keywords` and shared by both the pgvector embedding and ES indexers.
    """
    tid = track_id or (str(doc.get("_id")) if doc and doc.get("_id") else "?")
    user_message = _build_keyword_input(doc)
    if not user_message:
        logger.warning("[keywords] track_id=%s empty input, skip", tid)
        return []

    model = settings.keyword_model
    logger.info("[keywords] track_id=%s input_len=%d model=%s requesting", tid, len(user_message), model)

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
    except Exception as e:
        # response_format unsupported / API failure → retry once without it, then give up.
        logger.warning(
            "[keywords] track_id=%s json_object request failed (%s); retrying without response_format",
            tid, str(e)[:120],
        )
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.3,
            )
        except Exception as e2:
            logger.error("[keywords] track_id=%s extraction failed: %s", tid, e2)
            return []

    try:
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        logger.error("[keywords] track_id=%s response read failed: %s", tid, e)
        return []

    keywords, (n_ko, n_en, n_mood) = _parse_keywords(raw)
    if not keywords:
        logger.warning("[keywords] track_id=%s parsed n=0 (raw_len=%d)", tid, len(raw))
    else:
        logger.info(
            "[keywords] track_id=%s n=%d (ko=%d en=%d mood=%d) model=%s",
            tid, len(keywords), n_ko, n_en, n_mood, model,
        )
    return keywords
