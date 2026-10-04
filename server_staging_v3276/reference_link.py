"""v3.276 — 작곡 디렉터 "참고 음원" 유튜브 링크 참조 (메타데이터 전용).

대표 결정(법적 제약): 유튜브 음원은 다운로드·추출하지 않는다(약관·저작권).
링크에서 oEmbed 로 **제목·채널명만** 읽고, LLM 으로 스타일 힌트(장르·분위기·템포·
Suno 스타일 문장)로 변환해 돌려준다. 앱은 style_text 를 reference_style 에 합쳐 작곡에 반영.

POST /api/generate/reference-link  body {url}
  → 200 {ok, title, author, genre, mood, tempo_hint, style_text, fallback}
  → 400 유튜브 URL 아님 / 404 영상 정보 없음 / 429 분당 10회 초과
캐시: Redis reflink:{sha1(canonical_url)} 24h. 레이트리밋: reflink:rl:{user}:{minute} INCR+EXPIRE.
"""

import hashlib
import json
import logging
import re
import time
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.redis import get_redis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate")

OEMBED_ENDPOINT = "https://www.youtube.com/oembed"
OEMBED_TIMEOUT_SEC = 8.0
CACHE_TTL_SEC = 24 * 3600
RATE_LIMIT_PER_MIN = 10
MAX_URL_LEN = 500

# 앱 작곡 디렉터 선택지(utils/lyricsPrompt.ts GENRE_OPTIONS / MOOD_OPTIONS)와 동일 어휘 —
# 앱은 이 목록과 정확히 일치할 때만 장르·분위기 선답에 쓴다. 목록 밖 값은 null 로 정규화.
GENRE_OPTIONS = ["댄스", "발라드", "힙합", "R&B", "트로트", "인디", "록", "포크", "인디팝", "시티팝", "재즈", "EDM", "클래식"]
MOOD_OPTIONS = ["밝고 경쾌한", "슬프고 우울한", "몽환적·신비로운", "에너지틱·강렬한", "로맨틱·달콤한", "그리운·따뜻한", "잔잔하고 편안한", "흥겹고 신나는"]
TEMPO_OPTIONS = ["느림", "보통", "빠름"]

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
_YT_SHORT_HOSTS = {"youtu.be", "www.youtu.be"}

_openai_client = None


class ReferenceLinkRequest(BaseModel):
    url: str


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


def _u8(user) -> str:
    return str((user or {}).get("id") or "")[:8]


def parse_youtube_video_id(raw: str) -> Optional[str]:
    """허용 형식에서 11자 video id 추출. 허용 외 형식·호스트면 None.

    허용: youtube.com/watch?v= · youtu.be/<id> · youtube.com/shorts/<id> · music.youtube.com/watch?v=
    (m.youtube.com 포함, http/https 만)
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if len(s) > MAX_URL_LEN:
        return None
    if not re.match(r"^https?://", s, re.IGNORECASE):
        s = "https://" + s  # 공유 시트가 스킴 없이 주는 경우("youtu.be/xxx")
    try:
        u = urlparse(s)
    except Exception:  # noqa: BLE001
        return None
    if u.scheme.lower() not in ("http", "https"):
        return None
    host = (u.hostname or "").lower()
    path = u.path or ""
    vid = None
    if host in _YT_SHORT_HOSTS:
        vid = path.lstrip("/").split("/")[0]
    elif host in _YT_HOSTS:
        if path.rstrip("/") == "/watch":
            vid = (parse_qs(u.query).get("v") or [None])[0]
        elif path.startswith("/shorts/"):
            vid = path[len("/shorts/"):].split("/")[0]
    if vid and _VIDEO_ID_RE.match(vid):
        return vid
    return None


def _scrub_names(text: str, names: list) -> str:
    """style_text 에서 실명(곡명·채널명) 제거 — Suno 가 실존 아티스트·곡명을 거부한다."""
    out = text or ""
    for n in names:
        n = (n or "").strip()
        if len(n) >= 2:
            out = re.sub(re.escape(n), "", out, flags=re.IGNORECASE)
    out = re.sub(r"[\"'“”‘’「」『』]", "", out)
    out = re.sub(r"\(\s*\)", "", out)
    out = re.sub(r"\s{2,}", " ", out).strip(" ,.-—·")
    return out[:240].strip()


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import AsyncOpenAI

        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=40.0)
    return _openai_client


_SYSTEM_PROMPT = (
    "너는 음악 프로듀서다. 유튜브 영상의 제목과 채널명만 보고, 그 곡의 음악 스타일을 추정해 "
    "작곡 AI 에 줄 스타일 힌트를 만든다. 반드시 JSON 객체 하나만 출력한다.\n"
    "키:\n"
    f"- genre: 다음 중 하나 또는 null — {', '.join(GENRE_OPTIONS)}\n"
    f"- mood: 다음 중 하나 또는 null — {', '.join(MOOD_OPTIONS)}\n"
    f"- tempo_hint: 다음 중 하나 또는 null — {', '.join(TEMPO_OPTIONS)}\n"
    "- style_text: 한국어 1~2문장. 악기 편성·사운드 질감·보컬 느낌·리듬 같은 음악적 특징만 묘사한다. "
    "실제 아티스트명·그룹명·곡명·채널명·앨범명은 절대 쓰지 않는다. 확신이 없으면 빈 문자열.\n"
    "추정이 불가능하면(음악 영상이 아님 등) 모든 값을 null, style_text 는 빈 문자열로 둔다."
)


def _parse_json_obj(raw: str) -> Optional[dict]:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except Exception:  # noqa: BLE001
            return None


async def _infer_style(title: str, author: str) -> Optional[dict]:
    """제목+채널명 → {genre, mood, tempo_hint, style_text}. 실패 시 None(폴백)."""
    if not settings.openai_api_key:
        return None
    client = _get_openai_client()
    model = settings.openai_model or "gpt-5.5"
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"영상 제목: {title}\n채널명: {author}"},
    ]
    logger.info("[ReasoningOn] stage=reference_link model=%s reasoning_effort=low", model)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            # gpt-5 계열: temperature 기본값만 허용, reasoning 토큰도 한도에서 차감(generate.py translate-tags 관행)
            max_completion_tokens=4000,
            reasoning_effort="low",
        )
    except Exception as e:  # noqa: BLE001 — 파라미터 미지원 모델 대비 1회 단순 재시도(lyrics_generator 관행)
        logger.warning("[RefLink] openai json/reasoning 요청 실패(%s) — 단순 재시도", str(e)[:120])
        try:
            resp = await client.chat.completions.create(
                model=model, messages=messages, max_completion_tokens=4000,
            )
        except Exception as e2:  # noqa: BLE001
            logger.warning("[RefLink] openai 실패 — 폴백: %s", str(e2)[:160])
            return None
    obj = _parse_json_obj(resp.choices[0].message.content if resp.choices else "")
    if not obj:
        return None
    genre = obj.get("genre") if obj.get("genre") in GENRE_OPTIONS else None
    mood = obj.get("mood") if obj.get("mood") in MOOD_OPTIONS else None
    tempo = obj.get("tempo_hint") if obj.get("tempo_hint") in TEMPO_OPTIONS else None
    style_text = obj.get("style_text") if isinstance(obj.get("style_text"), str) else ""
    style_text = _scrub_names(style_text, [title, author])
    return {"genre": genre, "mood": mood, "tempo_hint": tempo, "style_text": style_text}


async def _rate_limited(redis, user_id: str) -> bool:
    if redis is None or not user_id:
        return False
    key = f"reflink:rl:{user_id}:{int(time.time() // 60)}"
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, 70)
        return n > RATE_LIMIT_PER_MIN
    except Exception as e:  # noqa: BLE001 — Redis 장애가 기능을 막지 않게(fail-open)
        logger.warning("[RefLink] rate-limit redis 오류(통과): %s", str(e)[:120])
        return False


@router.post("/reference-link")
async def reference_link(
    body: ReferenceLinkRequest,
    current_user=Depends(get_current_user),
):
    """유튜브 링크 → 제목·채널명(oEmbed) → 스타일 힌트. 음원은 받지 않는다."""
    uid = str(current_user.get("id") or "")
    u8 = _u8(current_user)
    raw = (body.url or "").strip()
    host = (urlparse(raw if "://" in raw else "https://" + raw).hostname or "")[:60] if raw else ""

    vid = parse_youtube_video_id(raw)
    if not vid:
        logger.info("[RefLink] user=%s url_host=%s title_len=0 fail reason=not_youtube", u8, host)
        return _err(400, "유튜브 영상 링크만 사용할 수 있어요")

    redis = get_redis()
    if await _rate_limited(redis, uid):
        logger.info("[RefLink] user=%s url_host=%s title_len=0 fail reason=rate_limited", u8, host)
        return _err(429, "잠시 후 다시 시도해주세요")

    canonical = f"https://www.youtube.com/watch?v={vid}"
    cache_key = "reflink:" + hashlib.sha1(canonical.encode("utf-8")).hexdigest()
    if redis is not None:
        try:
            cached = await redis.get(cache_key)
            if cached:
                data = json.loads(cached)
                logger.info(
                    "[RefLink] user=%s url_host=%s title_len=%d ok cache=hit fallback=%s",
                    u8, host, len(data.get("title") or ""), data.get("fallback"),
                )
                return data
        except Exception as e:  # noqa: BLE001
            logger.warning("[RefLink] cache read 오류(무시): %s", str(e)[:120])

    # oEmbed — 제목·채널명만. 리다이렉트 비추종(고정 youtube.com 엔드포인트만 호출)
    title = author = ""
    try:
        async with httpx.AsyncClient(timeout=OEMBED_TIMEOUT_SEC, follow_redirects=False) as client:
            r = await client.get(OEMBED_ENDPOINT, params={"url": canonical, "format": "json"})
        if r.status_code == 200:
            meta = r.json()
            title = str(meta.get("title") or "").strip()[:200]
            author = str(meta.get("author_name") or "").strip()[:100]
        else:
            logger.info("[RefLink] oembed status=%s vid=%s", r.status_code, vid)
    except Exception as e:  # noqa: BLE001
        logger.warning("[RefLink] oembed 실패 vid=%s: %s", vid, str(e)[:120])
    if not title:
        logger.info("[RefLink] user=%s url_host=%s title_len=0 fail reason=oembed", u8, host)
        return _err(404, "영상 정보를 찾을 수 없어요")

    hint = await _infer_style(title, author)
    fallback = hint is None
    if fallback:
        hint = {"genre": None, "mood": None, "tempo_hint": None, "style_text": ""}
    data = {
        "ok": True,
        "title": title,
        "author": author,
        "genre": hint["genre"],
        "mood": hint["mood"],
        "tempo_hint": hint["tempo_hint"],
        "style_text": hint["style_text"],
        "fallback": fallback,
    }
    # 폴백(LLM 실패)은 캐시하지 않는다 — 일시 장애가 24h 고착되지 않게
    if redis is not None and not fallback:
        try:
            await redis.set(cache_key, json.dumps(data, ensure_ascii=False), ex=CACHE_TTL_SEC)
        except Exception as e:  # noqa: BLE001
            logger.warning("[RefLink] cache write 오류(무시): %s", str(e)[:120])
    logger.info(
        "[RefLink] user=%s url_host=%s title_len=%d ok fallback=%s genre=%s mood=%s style_len=%d",
        u8, host, len(title), fallback, data["genre"], data["mood"], len(data["style_text"]),
    )
    return data
