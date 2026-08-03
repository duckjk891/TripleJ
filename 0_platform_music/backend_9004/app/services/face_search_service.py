"""TrustSquad(v138) BE-2 — 인물 기반 일괄 수색 서비스.

신고 증거 스냅샷(reports.evidence)의 기준 얼굴(original_photo 우선, 없으면 cover)로
피신고 사용자(owner_id)의 ①characters 이미지(원본 사진·실사 시트·가상 시트)
②전 트랙 커버(공개+비공개, 최신 MAX_TRACK_SCAN 건)를 face_verify_service.compare_faces
로 순차 대조해 동일 인물 매치를 찾는다 (Rekognition CompareFaces 재사용).

- 매치 판정: compare_faces match + similarity >= FACE_SEARCH_THRESHOLD(90).
- 그림체 커버 등 얼굴 미검출 이미지는 FaceCompareError → skipped (한계 명시).
- AWS 호출 간 COMPARE_INTERVAL_SEC(0.2s) 간격 + 비용 로그(compare_calls).
- 트랙 커버는 images 버킷 object name 관행이나 http(s) 외부 URL 도 존재 → 다운로드 분기.

is_blocked_source_photo: 생성 입력 차단 게이트(routes/character.py generate-sheet 4종) —
업로드 사진 sha256 이 face_source_blacklist(신고 확정 등록분)에 있으면 True.

로그 규칙: [face-search]/[moderation] prefix. id·sha 는 앞 8자만,
이미지 바이트·전체 해시는 로그 금지.
"""

import asyncio
import hashlib
import io
import json
import logging
import uuid
from typing import Optional

from PIL import Image

from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from .face_verify_service import FaceCompareError, compare_faces

logger = logging.getLogger(__name__)

# AWS Rekognition CompareFaces 바이트 입력 한도(5MB) 회피 + 비용 절감:
# 대조 전 긴 변을 이 값으로 축소하고 JPEG 재인코딩. 얼굴 대조 정확도엔 충분.
_REKOG_MAX_DIM = 1600


def _downscale_for_rekognition(data: bytes) -> bytes:
    """대조용 이미지 축소(긴 변 ≤ _REKOG_MAX_DIM, JPEG). 실패 시 원본 반환."""
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
        w, h = img.size
        longest = max(w, h)
        if longest > _REKOG_MAX_DIM:
            scale = _REKOG_MAX_DIM / float(longest)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        return buf.getvalue()
    except Exception:
        logger.warning("[face-search] downscale failed — 원본 사용 len=%d", len(data or b""))
        return data

# 수색 매치 임계 유사도 (compare_faces 내부 threshold 와 별개로 한 번 더 검사).
FACE_SEARCH_THRESHOLD = 90.0
# 전 트랙 커버 스캔 상한 — 초과분은 최신순 우선, 로그로 명시.
MAX_TRACK_SCAN = 200
# AWS CompareFaces 호출 간 간격(초) — rate 완화.
COMPARE_INTERVAL_SEC = 0.2

REPORT_NOT_FOUND_MSG = "신고를 찾을 수 없습니다."
NO_BASE_FACE_MSG = "수색 기준이 될 얼굴 자료가 없습니다."

# 생성 입력 차단 403 응답 본문 (routes/character.py 공용).
BLOCKED_SOURCE_PHOTO_RESPONSE = {
    "error": "blocked_source_photo",
    "message": "이 사진은 신고 처리에 따라 사용할 수 없습니다.",
}

# characters 문서에서 수색 대상으로 삼는 이미지 필드 → kind 라벨.
_CHARACTER_IMAGE_FIELDS = (
    ("original_photo_object_name", "original_photo"),
    ("sheet_object_name", "sheet"),
    ("virtual_sheet_object_name", "virtual_sheet"),
)


class FaceSearchError(Exception):
    """수색 불가(신고 미존재/기준 얼굴 없음) — str() 이 사용자 노출용 메시지."""


def _short(value) -> str:
    return str(value)[:8] if value else "?"


def _parse_jsonb(value):
    """asyncpg JSONB 는 코덱 미설정 시 str — dict 로 정규화 (실패 None)."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return value


def _get_minio_bytes(object_name: str) -> bytes:
    """images 버킷 객체 bytes (blocking — to_thread 용)."""
    resp = get_minio().get_object(
        bucket_name=settings.minio_bucket_images, object_name=object_name
    )
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


async def _load_image(object_name_or_url: str) -> Optional[bytes]:
    """대상 이미지 bytes 로드 — http(s) 외부 URL 은 다운로드, 그 외 images 버킷.

    실패 시 None (호출부에서 skipped 처리).
    """
    src = (object_name_or_url or "").strip()
    if not src:
        return None
    try:
        if src.startswith("http://") or src.startswith("https://"):
            import httpx

            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(src)
                resp.raise_for_status()
                return resp.content
        return await asyncio.to_thread(_get_minio_bytes, src)
    except Exception as e:
        logger.warning(
            "[face-search] image load failed src=%s err=%s", src[:60], str(e)[:120]
        )
        return None


async def search_user_content_by_face(report_id: str, conn) -> dict:
    """신고 증거 기준 얼굴로 피신고 사용자 콘텐츠 일괄 수색.

    Args:
        report_id: reports.id (UUID 문자열).
        conn: asyncpg connection (reports.evidence 조회용).
    Returns:
        {"matches": [{"type": "track"|"character", "id", "title", "similarity",
                      "object_name", "matched_kind"}],
         "scanned", "skipped", "compare_calls",
         "total_tracks", "base_kind", "owner_id"}
    Raises:
        FaceSearchError: 신고 미존재(REPORT_NOT_FOUND_MSG) /
                         기준 얼굴 자료 없음(NO_BASE_FACE_MSG).
    """
    try:
        rid = uuid.UUID(str(report_id))
    except ValueError:
        raise FaceSearchError(REPORT_NOT_FOUND_MSG)

    row = await conn.fetchrow("SELECT evidence FROM reports WHERE id = $1", rid)
    if row is None:
        raise FaceSearchError(REPORT_NOT_FOUND_MSG)

    evidence = _parse_jsonb(row["evidence"]) or {}
    owner_id = evidence.get("owner_id")
    items = evidence.get("items") or []

    # 기준 얼굴 — original_photo 우선, 없으면 cover.
    base_item = None
    for wanted in ("original_photo", "cover"):
        base_item = next((i for i in items if i.get("kind") == wanted), None)
        if base_item:
            break
    if not owner_id or not base_item or not base_item.get("object_name"):
        logger.info(
            "[face-search] no base face report=%s owner=%s items=%d",
            _short(report_id), _short(owner_id), len(items),
        )
        raise FaceSearchError(NO_BASE_FACE_MSG)

    base_bytes = await _load_image(base_item["object_name"])
    if not base_bytes:
        raise FaceSearchError(NO_BASE_FACE_MSG)
    base_bytes = _downscale_for_rekognition(base_bytes)

    logger.info(
        "[face-search] start report=%s owner=%s base_kind=%s base_sha=%s",
        _short(report_id), _short(owner_id), base_item.get("kind"),
        hashlib.sha256(base_bytes).hexdigest()[:8],
    )

    matches: list = []
    scanned = 0
    skipped = 0
    compare_calls = 0

    async def _compare(target_bytes: bytes) -> dict:
        nonlocal compare_calls
        if compare_calls:
            await asyncio.sleep(COMPARE_INTERVAL_SEC)
        compare_calls += 1
        return await compare_faces(base_bytes, _downscale_for_rekognition(target_bytes))

    mongo = get_mongo()

    # ── ① characters 문서 (user_id 당 1문서 — 원본·실사 시트·가상 시트) ─────
    char = await mongo.characters.find_one({"user_id": str(owner_id)})
    if char:
        best = None  # (similarity, object_name, kind)
        for field, kind in _CHARACTER_IMAGE_FIELDS:
            obj = char.get(field)
            if not obj:
                continue
            data = await _load_image(obj)
            if data is None:
                skipped += 1
                continue
            scanned += 1
            try:
                result = await _compare(data)
            except FaceCompareError:
                # 얼굴 미검출(그림체 시트 등) — 스킵
                skipped += 1
                logger.info(
                    "[face-search] no-face skip type=character kind=%s report=%s",
                    kind, _short(report_id),
                )
                continue
            except Exception as _e:
                # AWS 일시 오류·용량 초과 등 — 한 대상만 스킵(전체 수색은 계속)
                skipped += 1
                logger.warning(
                    "[face-search] compare error skip type=character kind=%s report=%s err=%s",
                    kind, _short(report_id), str(_e)[:120],
                )
                continue
            sim = float(result.get("similarity") or 0.0)
            if result.get("match") and sim >= FACE_SEARCH_THRESHOLD:
                if best is None or sim > best[0]:
                    best = (sim, obj, kind)
        if best:
            matches.append({
                "type": "character",
                "id": str(char["_id"]),
                "title": char.get("name") or "캐릭터",
                "similarity": round(best[0], 2),
                "object_name": best[1],
                "matched_kind": best[2],
            })

    # ── ② 전 트랙 커버 (공개+비공개, 최신 MAX_TRACK_SCAN 건) ────────────────
    track_query = {"uploader_id": str(owner_id)}
    total_tracks = await mongo.tracks.count_documents(track_query)
    if total_tracks > MAX_TRACK_SCAN:
        logger.warning(
            "[face-search] track scan capped report=%s total=%d cap=%d (최신순 우선)",
            _short(report_id), total_tracks, MAX_TRACK_SCAN,
        )
    cursor = (
        mongo.tracks.find(track_query, {"cover_image_url": 1, "title": 1})
        .sort("created_at", -1)
        .limit(MAX_TRACK_SCAN)
    )
    docs = await cursor.to_list(length=MAX_TRACK_SCAN)
    for doc in docs:
        cover = doc.get("cover_image_url")
        if not cover:
            skipped += 1
            continue
        data = await _load_image(cover)
        if data is None:
            skipped += 1
            continue
        scanned += 1
        try:
            result = await _compare(data)
        except FaceCompareError:
            skipped += 1
            logger.info(
                "[face-search] no-face skip type=track track=%s report=%s",
                _short(doc.get("_id")), _short(report_id),
            )
            continue
        except Exception as _e:
            skipped += 1
            logger.warning(
                "[face-search] compare error skip type=track track=%s report=%s err=%s",
                _short(doc.get("_id")), _short(report_id), str(_e)[:120],
            )
            continue
        sim = float(result.get("similarity") or 0.0)
        if result.get("match") and sim >= FACE_SEARCH_THRESHOLD:
            matches.append({
                "type": "track",
                "id": str(doc["_id"]),
                "title": doc.get("title") or "",
                "similarity": round(sim, 2),
                "object_name": cover,
                "matched_kind": "cover",
            })

    logger.info(
        "[face-search] done report=%s owner=%s matches=%d scanned=%d skipped=%d "
        "compare_calls=%d total_tracks=%d",
        _short(report_id), _short(owner_id), len(matches), scanned, skipped,
        compare_calls, total_tracks,
    )
    return {
        "matches": matches,
        "scanned": scanned,
        "skipped": skipped,
        "compare_calls": compare_calls,
        "total_tracks": total_tracks,
        "base_kind": base_item.get("kind"),
        "owner_id": str(owner_id),
    }


# ---------------------------------------------------------------------------
# 생성 입력 차단 게이트 (routes/character.py generate-sheet 4종에서 호출)
# ---------------------------------------------------------------------------


async def is_blocked_source_photo(photo_bytes: bytes, user_id) -> bool:
    """업로드 사진 sha256 이 face_source_blacklist 에 있으면 True (PG 조회 1회).

    신고 확정(confirm_delete/purge) 등록분만 대상 — 임의 차단 무기화 불가.
    """
    sha = hashlib.sha256(photo_bytes).hexdigest()
    from ..database import postgres as _pg

    async with _pg._pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM face_source_blacklist WHERE sha256 = $1", sha
        )
    if row:
        logger.info(
            "[moderation] blocked_source user=%s sha=%s", _short(user_id), sha[:8]
        )
        return True
    return False
