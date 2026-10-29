"""
MAIDOL 곡 공유 랜딩 (v3.235 S7·S8) — 무인증 공개 표면.

- GET/HEAD /track/{track_id}         카톡·브라우저 사람용 HTML 랜딩(OG 카드) → 웹앱 즉시 이동
- GET/HEAD /track/{track_id}/og.jpg  OG 썸네일 1200×630 JPEG(커버 레터박스, MinIO 캐시)

main.py 무변경 원칙: referral.public_router 에 합류(v3.233 guardian_manage 관행) — main.py 가 이미
include 하는 루트 라우터라 경로 프리픽스가 없다. 앱 공유 URL = https://api.maidol.ai.kr/track/{id}
(v3.221 이전 마이페이지 공유 링크와 같은 형식 — 과거에 뿌려진 링크도 이 랜딩으로 살아난다).

보안(무인증 표면):
- id 는 소문자 24hex 만 통과(그 외 DB 조회 0). 공개(is_public != False)·비블라인드 곡만 노출.
  비공개·블라인드·삭제·없는 id·형식 오류 = 곡 정보 없는 **고정 404 HTML**(바이트 동일 — 존재 여부 비노출).
  인증 헤더는 읽지 않는다(소유자도 비공개 곡은 404 — 공유 표면은 공개 곡 전용).
- 노출 필드 = 곡 제목·곡 아티스트명(tracks.artist_name)뿐. 업로더 닉네임(기획사명) 폴백 없음(어린이 보호 D10).
- 제목·아티스트명은 제어문자 제거 후 html.escape(quote=True). 이동 URL·og URL 은 검증된 id 로만 조립.
- og.jpg: 요청마다 공개 여부를 다시 확인한 뒤에만 캐시/변환본을 준다(비공개 전환 후 캐시 제공 0).
  커버 경로는 covers/ 만 + cover-preview 가드(faces/·evidence/·원본 얼굴 사진·경로 탈출) 재사용.
  변환 실패·비공개·커버 없음 = 기본 OG 이미지로 302.

v3.237 (곡 공유 메시지 개선 API-2):
- OG·twitter·meta description + 본문 lede = 공유 문구 설정 `og_description`(routes/share_messages 60초 캐시,
  기본 "이런 날엔 이런 노래 🎵 탭하면 재생 · 나도 1분 만에 만들기", 로더 실패 = 같은 상수). title·image·url 불변.
- 쿼리 `s`(공유 ID, ^[0-9a-z]{8}$ 만) → 바로 듣기 URL 에 `&s=` 전달(`/?track={id}&s={s}` — 스크립트 이동 동일).
  형식이 다르면 조용히 버린다(URL 은 여전히 검증 id·검증 s 로만 조립 — XSS/오픈 리다이렉트 0).
- 공개 곡 방문 1건 = `share_link_visits` {track_id, share_id|null, bot, at} best-effort 기록(IP·UA 원문 미저장,
  TTL 180일). HEAD·스크래퍼 UA = bot=True(카카오 인앱 브라우저 'KAKAOTALK' 은 사람). 404 경로·og.jpg 는 기록 없음.
  기록 실패·지연(1초 상한)이어도 응답은 200.
- 로그의 UA 원문 제거 → 분류만(`ua=browser|kakaotalk|kakao-scrap|bot|head|empty`) — TESTPLAN v3.237 LD-S3·X-L1.
"""

import asyncio
import hashlib
import html
import io
import logging
import re
import threading
import unicodedata
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .share_messages import OG_DESCRIPTION_FALLBACK, get_og_description

router = APIRouter()

logger = logging.getLogger(__name__)

_PUBLIC_BASE_URL = "https://api.maidol.ai.kr"
_WEBAPP_URL = "https://app.maidol.ai.kr"
_APP_TRACK_SCHEME = "aidol://track/"  # app.json scheme — '앱에서 열기' best-effort (App Links 는 D13 이월)
_DEFAULT_OG_URL = f"{_PUBLIC_BASE_URL}/static/og/invite_og_v2.png"  # 1200×630 (invite 랜딩과 공용)

_TRACK_ID_RE = re.compile(r"^[0-9a-f]{24}$")
_OG_DESC = OG_DESCRIPTION_FALLBACK  # v3.237 — 설정 og_description 로더 실패 시 상수(요청서 §7 TO-BE)
_SHARE_ID_RE = re.compile(r"^[0-9a-z]{8}$")  # v3.237 공유 ID(앱 newShareId — 8자 base36 소문자)
_TITLE_MAX = 100  # 표시용 제목 길이 상한(초과 시 … — 저장값은 무변경)
_ARTIST_MAX = 40

OG_W, OG_H = 1200, 630
OG_QUALITY = 82
OG_TARGET_BYTES = 300 * 1024
OG_MAX_SOURCE_BYTES = 30 * 1024 * 1024  # 원본 커버 상한(실측 최대 7.5MB)
OG_MAX_PIXELS = 40_000_000  # 디컴프레션 폭탄 방어(헤더 크기로 선판정)
OG_CACHE_PREFIX = "og/tracks/"
_OG_CACHE_CONTROL = "public, max-age=86400"
_RENDER_SEM = threading.BoundedSemaphore(2)  # 동시 변환 상한(워커 스레드 안에서 획득 — 루프 무관)
_OG_INFLIGHT: dict = {}  # (loop id, cache key) → Task — 같은 키 동시 miss 는 변환·저장 1회

# v3.237 방문 기록 — 스크래퍼/봇 UA(카카오 링크 미리보기 = "kakaotalk-scrap", 인앱 브라우저 "KAKAOTALK" 은 사람)
VISITS_COLLECTION = "share_link_visits"
VISIT_RETENTION_DAYS = 180
VISIT_INSERT_TIMEOUT = 1.0
# 알려진 스크래퍼 토큰 + 단어 경계 \b(bot|crawler|spider)\b — 'CUBOT X30' 같은 기기 모델명은 사람(tester 버그 2)
_BOT_UA_RE = re.compile(
    r"kakaotalk-scrap|facebookexternalhit|facebookcatalog|twitterbot|slackbot|slack-imgproxy|discordbot|telegrambot"
    r"|whatsapp|googlebot|bingbot|bingpreview|yeti/|daumoa|linkedinbot|skypeuripreview|applebot|pinterestbot"
    r"|\b(?:bot|crawler|spider)\b|headlesschrome|link ?preview"
    r"|curl/|wget/|python-requests|python-urllib|httpx|aiohttp|go-http-client|java/|okhttp/|node-fetch|axios/",
    re.IGNORECASE,
)
_visit_index_ready = False

_SEC_HEADERS = {"X-Content-Type-Options": "nosniff"}
_HTML_HEADERS = {**_SEC_HEADERS, "Cache-Control": "no-cache"}


def _t8(track_id: str) -> str:
    return track_id[:8] if _TRACK_ID_RE.match(track_id or "") else "invalid"


def _ua(request: Request) -> str:
    """v3.237: 로그용 UA 분류(원문 미기록)."""
    if getattr(request, "method", "GET") == "HEAD":
        return "head"
    ua = request.headers.get("user-agent") or ""
    if not ua.strip():
        return "empty"
    low = ua[:512].lower()
    if "kakaotalk-scrap" in low:
        return "kakao-scrap"
    if _BOT_UA_RE.search(low):
        return "bot"
    if "kakaotalk" in low:
        return "kakaotalk"
    return "browser"


def _clean_text(value, limit: int) -> str:
    """제어문자(NULL·줄바꿈 등) 제거 + 공백 정리 + 길이 상한. escape 는 호출측에서."""
    s = "".join(ch if unicodedata.category(ch)[0] != "C" else " " for ch in str(value or ""))
    s = " ".join(s.split())
    if len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


async def _find_public_track(track_id: str, fields: dict) -> tuple:
    """(doc|None, reason). 형식 오류는 DB 조회 0. 비공개·블라인드·없음은 모두 None."""
    if not _TRACK_ID_RE.match(track_id or ""):
        return None, "bad_id"
    proj = {"is_public": 1, "report_blinded": 1, **fields}
    doc = await get_mongo().tracks.find_one({"_id": ObjectId(track_id)}, proj)
    if not doc:
        return None, "not_found"
    if doc.get("is_public") is False:
        return None, "private"
    if doc.get("report_blinded"):
        return None, "blinded"
    return doc, "ok"


def _cover_path_allowed(obj) -> bool:
    """og 원천 커버 경로 가드 — covers/ 만, cover-preview 가드(faces/·evidence/·원본 사진·탈출) 재사용."""
    if not isinstance(obj, str) or not obj or len(obj) > 512:
        return False
    if not obj.startswith("covers/"):
        return False
    if obj.startswith(("faces/", "evidence/")) or ".." in obj:
        return False
    from .upload import _original_photo_owner, _suspicious_object_path

    return not (_suspicious_object_path(obj) or _original_photo_owner(obj) is not None)


def _og_cache_key(track_id: str, cover: str) -> str:
    return f"{OG_CACHE_PREFIX}{track_id}_{hashlib.md5(cover.encode('utf-8')).hexdigest()[:8]}.jpg"


# ── HTML ──────────────────────────────────────────────────────────────────────
_STYLE = """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      background: #0a0a1a; color: #f1efff;
      font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
                   "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
      display: flex; flex-direction: column; align-items: center;
      padding: 40px 20px 28px;
      background-image: radial-gradient(60% 40% at 50% 0%, rgba(124, 58, 237, 0.28), transparent 70%);
      -webkit-font-smoothing: antialiased;
    }
    .card { width: 100%; max-width: 420px; text-align: center; }
    .wordmark { font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #f2f0fa; margin-bottom: 24px; }
    .wordmark-ai {
      background: linear-gradient(120deg, #a78bfa, #8b5cf6 55%, #6d28d9);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #8b5cf6;
    }
    .cover {
      width: 100%; max-width: 320px; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 16px;
      display: block; margin: 0 auto 20px; background: #1a1830;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
    }
    h1 { font-size: 22px; line-height: 1.4; font-weight: 700; margin-bottom: 6px; word-break: keep-all; overflow-wrap: anywhere; }
    .artist { font-size: 15px; color: #a9a3c8; margin-bottom: 20px; overflow-wrap: anywhere; }
    .lede { font-size: 14px; line-height: 1.7; color: #a9a3c8; margin-bottom: 24px; word-break: keep-all; }
    .cta {
      display: block; width: 100%; text-decoration: none; text-align: center;
      font-size: 17px; font-weight: 700; border-radius: 14px; padding: 16px 0; margin-bottom: 14px;
      background: linear-gradient(120deg, #8b5cf6, #6d28d9); color: #ffffff;
      box-shadow: 0 6px 24px rgba(109, 40, 217, 0.45);
    }
    .cta:active { opacity: 0.85; }
    .open-app { display: inline-block; font-size: 13px; color: #a9a3c8; text-decoration: underline; }
    footer { margin-top: 48px; font-size: 11px; line-height: 1.7; color: #6f6890; text-align: center; max-width: 420px; }
"""

_FOOTER = """  <footer>
    MAIDOL | 주식회사 로터스에이아이<br>
    &copy; 2026 Lotus AI. All Rights Reserved.
  </footer>"""


def _page(*, og_type: str, og_title: str, og_desc: str, og_image: str, og_url: str, body: str,
          extra_head: str = "", script: str = "") -> str:
    """모든 인자는 호출측에서 escape 완료된 값(URL 은 검증 id 로만 조립된 상수 형식)."""
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{og_title}</title>
  <meta property="og:type" content="{og_type}">
  <meta property="og:site_name" content="MAIDOL">
  <meta property="og:title" content="{og_title}">
  <meta property="og:description" content="{og_desc}">
  <meta property="og:image" content="{og_image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="{og_url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{og_title}">
  <meta name="twitter:description" content="{og_desc}">
  <meta name="twitter:image" content="{og_image}">
  <meta name="description" content="{og_desc}">{extra_head}
  <style>{_STYLE}  </style>
</head>
<body>
  <div class="card">
    <div class="wordmark">M<span class="wordmark-ai">AI</span>DOL</div>
{body}
  </div>
{_FOOTER}{script}
</body>
</html>"""


def _share_id(request: Request) -> tuple:
    """(검증된 공유 ID | None, 로그 표기). 형식이 다르면 버린다 — 값 원문은 로그에도 남기지 않는다."""
    qp = request.query_params
    vals = qp.getlist("s") if hasattr(qp, "getlist") else ([qp["s"]] if "s" in qp else [])
    if not vals:
        return None, "-"
    raw = vals[0]
    if len(vals) == 1 and isinstance(raw, str) and _SHARE_ID_RE.match(raw):
        return raw, raw
    return None, "bad"  # 형식 오류·s 중복 = 미전달(결정적)


def _is_bot(request: Request) -> bool:
    if getattr(request, "method", "GET") == "HEAD":
        return True
    ua = request.headers.get("user-agent") or ""
    return (not ua.strip()) or bool(_BOT_UA_RE.search(ua[:512]))


async def _ensure_visit_indexes(coll) -> None:
    global _visit_index_ready
    if _visit_index_ready:
        return
    _visit_index_ready = True  # 실패해도 요청마다 재시도하지 않는다(다음 기동 때 재시도)
    await coll.create_index("at", expireAfterSeconds=VISIT_RETENTION_DAYS * 24 * 3600)
    await coll.create_index("share_id")
    await coll.create_index([("track_id", 1), ("at", 1)])


async def _record_visit(track_id: str, share_id: Optional[str], bot: bool) -> None:
    """best-effort — 예외·지연은 삼키고 경고만(응답 불변)."""
    try:
        coll = get_mongo()[VISITS_COLLECTION]
        try:
            await asyncio.wait_for(_ensure_visit_indexes(coll), VISIT_INSERT_TIMEOUT)
        except Exception:  # noqa: BLE001
            logger.warning("[ShareLanding] visit index ensure failed", exc_info=False)
        doc = {"track_id": track_id, "share_id": share_id, "bot": bot,
               "at": datetime.now(timezone.utc).replace(tzinfo=None)}  # Mongo 관행: naive UTC
        await asyncio.wait_for(coll.insert_one(doc), VISIT_INSERT_TIMEOUT)
    except Exception as e:  # noqa: BLE001
        logger.warning("[ShareLanding] visit insert failed track=%s err=%s", track_id[:8], type(e).__name__)


def _render_track_html(track_id: str, title: str, artist: str, has_cover: bool,
                       og_desc: str = _OG_DESC, share_id: Optional[str] = None) -> str:
    """공개 곡 랜딩. track_id 는 _TRACK_ID_RE 통과값(소문자 24hex), share_id 는 _SHARE_ID_RE 통과값 또는 None
    — URL 조립은 이 두 값만 사용."""
    t = html.escape(_clean_text(title, _TITLE_MAX) or "제목 없음", quote=True)
    a = html.escape(_clean_text(artist, _ARTIST_MAX), quote=True)
    og_title = f"「{t}」 {a}" if a else f"「{t}」"
    page_url = f"{_PUBLIC_BASE_URL}/track/{track_id}"
    og_image = f"{page_url}/og.jpg" if has_cover else _DEFAULT_OG_URL
    listen_url = f"{_WEBAPP_URL}/?track={track_id}"
    if share_id and _SHARE_ID_RE.match(share_id):
        listen_url += f"&s={share_id}"
    desc = html.escape(og_desc, quote=True)
    app_url = f"{_APP_TRACK_SCHEME}{track_id}"
    artist_line = f'\n    <p class="artist">{a}</p>' if a else ""
    body = f"""    <img class="cover" src="{og_image}" alt="">
    <h1>{t}</h1>{artist_line}
    <p class="lede">{desc}</p>
    <a class="cta" id="listen" href="{html.escape(listen_url, quote=True)}">바로 듣기</a>
    <a class="open-app" href="{app_url}">앱에서 열기</a>"""
    # 이동 URL 은 서버 검증 id(+ 검증된 s)로만 조립된 상수 형식(제목·기타 쿼리값 혼입 없음).
    script = f"""
  <script>
    (function () {{
      var u = "{listen_url}";
      try {{ window.location.replace(u); }} catch (e) {{ /* no-op — [바로 듣기] 버튼으로 이동 */ }}
    }})();
  </script>"""
    return _page(og_type="music.song", og_title=og_title, og_desc=desc,
                 og_image=og_image, og_url=page_url, body=body, script=script)


def _render_not_found_html() -> str:
    """비공개·블라인드·삭제·없음·형식 오류 공통 404 — 곡 정보·id 미포함 고정 본문."""
    body = f"""    <img class="cover" src="{_DEFAULT_OG_URL}" alt="">
    <h1>비공개로 바뀌었거나 삭제된 곡이에요</h1>
    <p class="lede">MAIDOL에서 다른 곡을 들어보세요.</p>
    <a class="cta" href="{_WEBAPP_URL}">MAIDOL 둘러보기</a>"""
    return _page(og_type="website", og_title="MAIDOL — 나의 AI 아이돌",
                 og_desc=html.escape("작사·작곡부터 앨범 커버까지 AI가 무료로 완성.", quote=True),
                 og_image=_DEFAULT_OG_URL, og_url=_WEBAPP_URL, body=body,
                 extra_head='\n  <meta name="robots" content="noindex">')


_NOT_FOUND_HTML = _render_not_found_html()


def _not_found() -> HTMLResponse:
    return HTMLResponse(status_code=404, content=_NOT_FOUND_HTML, headers=dict(_HTML_HEADERS))


# v3.198 invite 관행 — HEAD 명시 허용(카카오 등 스크래퍼 HEAD 프리플라이트). HEAD 본문은 서버(uvicorn)가 버린다.
@router.api_route("/track/{track_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def track_share_landing(request: Request, track_id: str):
    """v3.235 S7 곡 공유 랜딩(무인증). 공개 곡 = OG HTML 200 · 그 외 = 고정 404 HTML.
    v3.237: OG 설명 설정화 · `?s=` 공유 ID 전달 · 공개 곡 방문 기록(share_link_visits)."""
    ua = _ua(request)
    try:
        doc, reason = await _find_public_track(track_id, {"title": 1, "artist_name": 1, "cover_image_url": 1})
    except Exception as e:  # noqa: BLE001 — DB 장애도 곡 정보 없는 404(5xx 로 존재 여부를 흘리지 않음)
        doc, reason = None, "error:" + type(e).__name__
    if doc is None:
        logger.info("[ShareLanding] track=%s ok=False reason=%s ua=%s", _t8(track_id), reason, ua)
        return _not_found()
    cover = doc.get("cover_image_url")
    has_cover = _cover_path_allowed(cover)
    share_id, s_tag = _share_id(request)
    bot = _is_bot(request)
    logger.info("[ShareLanding] track=%s ok=True cover=%s s=%s bot=%s ua=%s", track_id[:8], has_cover, s_tag, bot, ua)
    og_desc = await get_og_description()
    content = _render_track_html(track_id, doc.get("title") or "", doc.get("artist_name") or "", has_cover,
                                 og_desc=og_desc, share_id=share_id)
    await _record_visit(track_id, share_id, bot)
    return HTMLResponse(status_code=200, content=content, headers=dict(_HTML_HEADERS))


# ── OG 썸네일 ────────────────────────────────────────────────────────────────
def _render_og_jpeg(src: bytes) -> bytes:
    """커버 → 1200×630 JPEG. 배경 = 커버 채움+블러+어둡게, 전경 = 커버 전체(비율 유지, 왜곡 0)."""
    from PIL import Image, ImageEnhance, ImageFilter

    with _RENDER_SEM:
        im = Image.open(io.BytesIO(src))
        w, h = im.size
        if w <= 0 or h <= 0 or w * h > OG_MAX_PIXELS:
            raise ValueError(f"source pixels out of range {w}x{h}")
        if im.mode not in ("RGB", "L"):
            rgba = im.convert("RGBA")
            base = Image.new("RGB", rgba.size, (10, 10, 26))
            base.paste(rgba, mask=rgba.getchannel("A"))
            im = base
        else:
            im = im.convert("RGB")
        im.thumbnail((1600, 1600), Image.LANCZOS)
        w, h = im.size
        scale = max(OG_W / w, OG_H / h)
        bw, bh = max(OG_W, round(w * scale)), max(OG_H, round(h * scale))
        bg = im.resize((bw, bh), Image.BILINEAR)
        left, top = (bw - OG_W) // 2, (bh - OG_H) // 2
        bg = bg.crop((left, top, left + OG_W, top + OG_H)).filter(ImageFilter.GaussianBlur(28))
        bg = ImageEnhance.Brightness(bg).enhance(0.45)
        fg = im.copy()
        fg.thumbnail((OG_W, OG_H), Image.LANCZOS)
        bg.paste(fg, ((OG_W - fg.width) // 2, (OG_H - fg.height) // 2))
        out = b""
        for q in (OG_QUALITY, 72, 62):
            buf = io.BytesIO()
            bg.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
            out = buf.getvalue()
            if len(out) <= OG_TARGET_BYTES:
                break
        return out


def _minio_read(bucket: str, name: str, limit: Optional[int] = None) -> bytes:
    resp = get_minio().get_object(bucket_name=bucket, object_name=name)
    try:
        data = resp.read()
    finally:
        try:
            resp.close()
            resp.release_conn()
        except Exception:  # noqa: BLE001
            pass
    if limit is not None and len(data) > limit:
        raise ValueError("source too large")
    return data


def _minio_put(bucket: str, name: str, data: bytes) -> None:
    get_minio().put_object(
        bucket_name=bucket, object_name=name, data=io.BytesIO(data), length=len(data), content_type="image/jpeg",
    )


async def _render_and_store(track_id: str, cover: str, key: str) -> Optional[bytes]:
    """miss 1회분 — 원본 읽기 → 변환 → 캐시 저장(같은 키 덮어쓰기라 중복 저장도 멱등). 실패 = None."""
    bucket = settings.minio_bucket_images
    try:
        src = await asyncio.to_thread(_minio_read, bucket, cover, OG_MAX_SOURCE_BYTES)
        data = await asyncio.to_thread(_render_og_jpeg, src)
    except Exception as e:  # noqa: BLE001 — 손상·폭탄·읽기 실패 → 기본 OG
        logger.warning("[ShareLanding] og track=%s render failed err=%s: %s", track_id[:8], type(e).__name__, str(e)[:120])
        return None
    try:
        await asyncio.to_thread(_minio_put, bucket, key, data)
    except Exception as e:  # noqa: BLE001 — 캐시 저장 실패여도 이번 응답은 준다
        logger.warning("[ShareLanding] og track=%s cache put failed err=%s", track_id[:8], type(e).__name__)
    return data


def _og_default_redirect() -> RedirectResponse:
    return RedirectResponse(_DEFAULT_OG_URL, status_code=302, headers={**_SEC_HEADERS, "Cache-Control": "public, max-age=300"})


def _jpeg_response(data: bytes) -> Response:
    return Response(content=data, media_type="image/jpeg", headers={**_SEC_HEADERS, "Cache-Control": _OG_CACHE_CONTROL})


@router.api_route("/track/{track_id}/og.jpg", methods=["GET", "HEAD"])
async def track_share_og_image(request: Request, track_id: str):
    """v3.235 S8 OG 썸네일(무인증). 요청마다 공개 여부 재확인 → 캐시 hit/miss 변환 · 그 외 302 기본 OG."""
    try:
        doc, reason = await _find_public_track(track_id, {"cover_image_url": 1})
    except Exception as e:  # noqa: BLE001
        doc, reason = None, "error:" + type(e).__name__
    if doc is None:
        logger.info("[ShareLanding] og track=%s cache=skip reason=%s", _t8(track_id), reason)
        return _og_default_redirect()
    cover = doc.get("cover_image_url")
    if not _cover_path_allowed(cover):
        logger.info("[ShareLanding] og track=%s cache=skip reason=%s", track_id[:8], "no_cover" if not cover else "cover_path_denied")
        return _og_default_redirect()
    key = _og_cache_key(track_id, cover)
    bucket = settings.minio_bucket_images
    try:
        data = await asyncio.to_thread(_minio_read, bucket, key, OG_TARGET_BYTES * 4)
        logger.info("[ShareLanding] og track=%s cache=hit", track_id[:8])
        return _jpeg_response(data)
    except Exception:  # noqa: BLE001 — 없음(NoSuchKey)·읽기 실패 = miss
        pass
    loop = asyncio.get_running_loop()
    k = (id(loop), key)
    task = _OG_INFLIGHT.get(k)
    if task is None:
        task = loop.create_task(_render_and_store(track_id, cover, key))
        _OG_INFLIGHT[k] = task
        task.add_done_callback(lambda _t, _k=k: _OG_INFLIGHT.pop(_k, None))
    data = await asyncio.shield(task)
    if not data:
        logger.info("[ShareLanding] og track=%s cache=miss result=fallback", track_id[:8])
        return _og_default_redirect()
    logger.info("[ShareLanding] og track=%s cache=miss bytes=%d", track_id[:8], len(data))
    return _jpeg_response(data)


# ── v3.305 [ClubInvite] 크루·크루 앨범 공유 랜딩 ─────────────────────────────────────
# /club/{club_id}?i={code}            → 앱 /?club={id}&i={code}
# /club/{club_id}/album/{album_id}?i= → 앱 /?club={id}&album={aid}&i={code}
# 블라인드·없음·형식 오류 = 고정 404(크루 정보 미포함). 코드는 형식만 검증(일치 검증은 가입 API).
_INVITE_CODE_RE = re.compile(r"^[a-z0-9]{8}$")
_CLUB_NAME_MAX = 30
_CLUB_DESC_MAX = 120


def _invite_code(request: Request) -> Optional[str]:
    raw = request.query_params.get("i")
    return raw if isinstance(raw, str) and _INVITE_CODE_RE.match(raw) else None


def _render_club_html(club_id: str, name: str, desc: str, members: int, code: Optional[str],
                      album_id: Optional[str] = None, album_title: str = "", album_theme: str = "",
                      og_image: str = _DEFAULT_OG_URL, playlist_id: Optional[str] = None,
                      playlist_title: str = "", playlist_count: int = 0) -> str:
    n = html.escape(_clean_text(name, _CLUB_NAME_MAX) or "크루", quote=True)
    page_url = f"{_PUBLIC_BASE_URL}/club/{club_id}" + (f"/album/{album_id}" if album_id else "") + (f"/playlist/{playlist_id}" if playlist_id else "")
    app_url = f"{_WEBAPP_URL}/?club={club_id}"
    if album_id:
        app_url += f"&album={album_id}"
    if playlist_id:
        app_url += f"&pl={playlist_id}"
    if code:
        app_url += f"&i={code}"
    if playlist_id:
        # v3.343 크루 플레이리스트 공유 · v3.345 비회원은 대표곡만 1분 미리 듣기, 전곡은 크루 가입(대표 10-12)
        pt = html.escape(_clean_text(playlist_title, _TITLE_MAX) or "크루 플레이리스트", quote=True)
        og_title = f"「{pt}」 — {n} 크루 플레이리스트"
        cnt = f"{int(playlist_count)}곡 · " if playlist_count else ""
        lede = html.escape(f"{cnt}크루 멤버가 함께 채운 플레이리스트예요. 대표곡을 1분 미리 듣고, 크루에 가입하면 전곡을 들을 수 있어요.", quote=True)
        cta = "대표곡 1분 미리 듣기"
    elif album_id:
        at = html.escape(_clean_text(album_title, _TITLE_MAX) or "크루 앨범", quote=True)
        og_title = f"「{at}」 — {n} 크루 앨범"
        lede = html.escape(_clean_text(album_theme, _CLUB_DESC_MAX) or "대표곡을 먼저 들어보고, 크루에 가입하면 전 곡을 들을 수 있어요.", quote=True)
        cta = "대표곡 듣기"
    else:
        og_title = f"{n} 크루에 초대해요"
        lede = html.escape(_clean_text(desc, _CLUB_DESC_MAX) or "MAIDOL 크루에서 함께 음악을 만들고 들어요.", quote=True)
        cta = "크루 보러 가기"
    sub = f'\n    <p class="artist">멤버 {int(members)}명</p>' if members else ""
    body = f"""    <img class="cover" src="{og_image}" alt="">
    <h1>{og_title}</h1>{sub}
    <p class="lede">{lede}</p>
    <a class="cta" id="listen" href="{html.escape(app_url, quote=True)}">{cta}</a>"""
    script = f"""
  <script>
    (function () {{
      var u = "{app_url}";
      try {{ window.location.replace(u); }} catch (e) {{ /* no-op */ }}
    }})();
  </script>"""
    return _page(og_type="website", og_title=og_title, og_desc=lede, og_image=og_image, og_url=page_url,
                 body=body, script=script)


def _club_not_found() -> HTMLResponse:
    body = f"""    <img class="cover" src="{_DEFAULT_OG_URL}" alt="">
    <h1>찾을 수 없는 크루예요</h1>
    <p class="lede">MAIDOL에서 다른 크루를 둘러보세요.</p>
    <a class="cta" href="{_WEBAPP_URL}">MAIDOL 둘러보기</a>"""
    content = _page(og_type="website", og_title="MAIDOL — 나의 AI 아이돌",
                    og_desc=html.escape("작사·작곡부터 앨범 커버까지 AI가 무료로 완성.", quote=True),
                    og_image=_DEFAULT_OG_URL, og_url=_WEBAPP_URL, body=body,
                    extra_head='\n  <meta name="robots" content="noindex">')
    return HTMLResponse(status_code=404, content=content, headers=dict(_HTML_HEADERS))


async def _find_club(club_id: str) -> Optional[dict]:
    if not _TRACK_ID_RE.match(club_id or ""):
        return None
    doc = await get_mongo().clubs.find_one({"_id": ObjectId(club_id)}, {"name": 1, "description": 1, "member_count": 1, "report_blinded": 1})
    if not doc or doc.get("report_blinded"):
        return None
    return doc


@router.api_route("/club/{club_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def club_share_landing(request: Request, club_id: str):
    try:
        doc = await _find_club(club_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("[ClubShare] lookup error club=%s err=%s", club_id[:8], type(e).__name__)
        doc = None
    code = _invite_code(request)
    logger.info("[ClubShare] club=%s ok=%s code=%s bot=%s ua=%s", club_id[:8], doc is not None, bool(code),
                _is_bot(request), _ua(request))
    if doc is None:
        return _club_not_found()
    content = _render_club_html(club_id, doc.get("name") or "", doc.get("description") or "",
                                int(doc.get("member_count") or 0), code)
    return HTMLResponse(status_code=200, content=content, headers=dict(_HTML_HEADERS))


@router.api_route("/club/{club_id}/album/{album_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def club_album_share_landing(request: Request, club_id: str, album_id: str):
    album = None
    try:
        doc = await _find_club(club_id)
        if doc is not None and _TRACK_ID_RE.match(album_id or ""):
            album = await get_mongo().club_albums.find_one(
                {"_id": ObjectId(album_id), "club_id": club_id},
                {"title": 1, "theme": 1, "representative_track_id": 1},
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("[ClubShare] album lookup error club=%s err=%s", club_id[:8], type(e).__name__)
        doc = None
    code = _invite_code(request)
    logger.info("[ClubShare] album club=%s album=%s ok=%s code=%s ua=%s", club_id[:8], (album_id or "")[:8],
                album is not None, bool(code), _ua(request))
    if doc is None or album is None:
        return _club_not_found()
    og_image = _DEFAULT_OG_URL
    rep = str(album.get("representative_track_id") or "")
    if _TRACK_ID_RE.match(rep):
        try:
            tdoc, _reason = await _find_public_track(rep, {"cover_image_url": 1})
            if tdoc is not None and _cover_path_allowed(tdoc.get("cover_image_url")):
                og_image = f"{_PUBLIC_BASE_URL}/track/{rep}/og.jpg"
        except Exception:  # noqa: BLE001
            pass
    content = _render_club_html(club_id, doc.get("name") or "", doc.get("description") or "",
                                int(doc.get("member_count") or 0), code, album_id=album_id,
                                album_title=album.get("title") or "", album_theme=album.get("theme") or "",
                                og_image=og_image)
    return HTMLResponse(status_code=200, content=content, headers=dict(_HTML_HEADERS))


# ── v3.343 크루 플레이리스트 공유 랜딩 ── /club/{club_id}/playlist/{playlist_uuid}?i= → 앱 /?club=&pl=&i=
_PLAYLIST_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


@router.api_route("/club/{club_id}/playlist/{playlist_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def club_playlist_share_landing(request: Request, club_id: str, playlist_id: str):
    pl = None
    pid = (playlist_id or "").lower()
    try:
        doc = await _find_club(club_id)
        if doc is not None and _PLAYLIST_ID_RE.match(pid):
            import uuid as _uuid
            from ..database import postgres as _pg
            async with _pg._pool.acquire() as conn:
                pl = await conn.fetchrow(
                    "SELECT p.title, (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) AS n "
                    "FROM playlists p WHERE p.id = $1 AND p.club_id = $2",
                    _uuid.UUID(pid), club_id,
                )
    except Exception as e:  # noqa: BLE001
        logger.warning("[ClubShare] playlist lookup error club=%s err=%s", club_id[:8], type(e).__name__)
        doc = None
    code = _invite_code(request)
    logger.info("[ClubShare] playlist club=%s pl=%s ok=%s code=%s ua=%s", club_id[:8], pid[:8],
                pl is not None, bool(code), _ua(request))
    if doc is None or pl is None:
        return _club_not_found()
    content = _render_club_html(club_id, doc.get("name") or "", doc.get("description") or "",
                                int(doc.get("member_count") or 0), code, playlist_id=pid,
                                playlist_title=pl["title"] or "", playlist_count=int(pl["n"] or 0))
    return HTMLResponse(status_code=200, content=content, headers=dict(_HTML_HEADERS))
