import asyncio
import io
import logging
import mimetypes
import os
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..database.minio import get_minio
from ..database.mongodb import get_mongo
from ..database.postgres import get_pg
from ..database.redis import get_redis
from ..services.media_urls import browser_image_url, browser_video_url, public_presign

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/upload")


# v55: image model enum + validator.
ALLOWED_IMAGE_MODELS = {"nb_pro", "gpt_image_2"}


def _normalize_image_model(raw: Optional[str]) -> Optional[str]:
    """Return validated image_model string, or None if input is invalid.

    Empty/whitespace/None → default ("nb_pro"). Unknown value → None (caller
    should return HTTP 400).
    """
    if raw is None:
        return "nb_pro"
    v = raw.strip()
    if not v:
        return "nb_pro"
    if v in ALLOWED_IMAGE_MODELS:
        return v
    return None


# v57: vocal_gender 정규화 — 커버 생성 라우트 진입부에서 사용.
# 출력: ("female","male","neutral") 또는 None (빈/없음).
# 잘못된 값(미정의 enum, "queer" 등) → _INVALID 센티넬 반환 → 라우트에서 400.
# 한국어 별칭(여자/여성, 남자/남성, 중성/지정 없음) 도 지원.
_INVALID_VOCAL_GENDER = object()
_VOCAL_GENDER_ALIASES = {
    # 영어 enum (자기 자신 — passthrough)
    "female": "female",
    "male": "male",
    "neutral": "neutral",
    # 한국어 별칭
    "여자": "female",
    "여성": "female",
    "남자": "male",
    "남성": "male",
    "중성": "neutral",
    "지정 없음": "neutral",
    "지정없음": "neutral",
}


def _normalize_vocal_gender(raw):
    """Return ("female","male","neutral") | None | _INVALID_VOCAL_GENDER.

    None / "" / 공백 → None (전달 안 함 — 기존 동작 byte-level 유지).
    정상 enum / 한국어 별칭 → 영어 enum 으로 정규화.
    그 외 → _INVALID_VOCAL_GENDER (라우트에서 400).
    """
    if raw is None:
        return None
    v = str(raw).strip()
    if not v:
        return None
    key = v.lower() if v.isascii() else v  # ASCII 만 소문자화 (한국어 보존)
    if key in _VOCAL_GENDER_ALIASES:
        return _VOCAL_GENDER_ALIASES[key]
    return _INVALID_VOCAL_GENDER


# v197: /upload/image 의 type 정규화.
# 'track' 은 구 클라이언트(웹 UploadPage, 앱팀 가능성) 하위호환 별칭 — 폐기 예정.
ALLOWED_UPLOAD_IMAGE_TYPES = {"cover", "profile"}
DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES = {"track": "cover"}


def _normalize_upload_image_type(raw):
    """(정규화된 type, 별칭_사용_여부) 반환. 알 수 없는 값 → (None, False)."""
    v = (raw or "").strip().lower()
    if v in ALLOWED_UPLOAD_IMAGE_TYPES:
        return v, False
    if v in DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES:
        return DEPRECATED_UPLOAD_IMAGE_TYPE_ALIASES[v], True
    return None, False


class GenerateCoverRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    style: Optional[str] = None
    character_object_name: Optional[str] = None
    user_prompt: Optional[str] = None  # user's free-form style description
    prompt_model: Optional[str] = None  # AI model for enhanced prompt (e.g. "claude-opus-4-7")
    location_id: Optional[str] = None    # v42: user-saved location anchor
    # v55: 커버 이미지 생성 모델. "nb_pro" (default) | "gpt_image_2".
    image_model: Optional[str] = "nb_pro"
    # v57: 보컬 성별 — 커버 이미지 prompt 에 주입. None 이면 미주입 (기존 동작).
    # 영어 enum ("female","male","neutral") 또는 한국어 별칭(여자/여성/남자/남성/중성/지정 없음).
    vocal_gender: Optional[str] = None
    # v215 — 보관함(커버촬영실) 출처 표기: 'coverstudio' | 'coveredit' | 'upload'.
    # 화이트리스트 외/미전송은 None 저장 (additive — 구 클라이언트 무영향).
    source: Optional[str] = None


# v215 — 보관함 source 화이트리스트
COVER_SOURCE_WHITELIST = {"coverstudio", "coveredit", "upload"}


class GenerateMVRequest(BaseModel):
    title: str
    genre: Optional[str] = None
    mood: Optional[str] = None
    lyrics: Optional[str] = None
    cover_object_name: Optional[str] = None  # MinIO object name of cover image

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("/image", status_code=201)
async def upload_image(
    file: UploadFile = File(...),
    type: str = Form(...),        # "cover" (track cover) or "profile" (user profile)
    id: str = Form(...),          # track_id (ObjectId string) or user_id (UUID string)
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    # v197: 구 클라이언트 별칭('track') 수용 + 알 수 없는 값 계측
    norm_type, used_alias = _normalize_upload_image_type(type)
    if norm_type is None:
        # v197: 실제로 어떤 값이 오는지 회수 — 앱팀 클라이언트 값 파악용 (R1)
        logger.info("[upload] image type_invalid raw=%s user=%s",
                    (type or "")[:32], current_user["id"][:8])
        return JSONResponse(status_code=400, content={"error": "type은 'cover' 또는 'profile'이어야 합니다."})
    if used_alias:
        logger.info("[upload] image type_alias_deprecated raw=%s→%s user=%s",
                    (type or "")[:32], norm_type, current_user["id"][:8])

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return JSONResponse(
            status_code=400,
            content={"error": f"허용되지 않는 이미지 형식입니다. ({', '.join(ALLOWED_IMAGE_EXT)})"},
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        return JSONResponse(status_code=400, content={"error": "이미지 크기는 10MB 이하여야 합니다."})

    minio_client = get_minio()
    content_type = mimetypes.guess_type(file.filename or "")[0] or "image/jpeg"

    if norm_type == "cover":
        # Track cover image -> stored in images bucket
        if not ObjectId.is_valid(id):
            return JSONResponse(status_code=400, content={"error": "유효하지 않은 트랙 ID입니다."})

        # v197: 소유권 가드 — put_object 이전에 둔다.
        # 뒤에 두면 인가 실패한 요청이 MinIO 에 객체를 남긴다(저장소 오염 + 대역 낭비).
        mongo = get_mongo()
        doc = await mongo.tracks.find_one({"_id": ObjectId(id)}, {"uploader_id": 1})
        if not doc:
            logger.info("[upload] image cover_not_found track=%s", id[:8])
            return JSONResponse(status_code=404, content={"error": "트랙을 찾을 수 없습니다."})
        if doc.get("uploader_id") != current_user["id"]:
            logger.info("[upload] image cover_denied track=%s user=%s", id[:8], current_user["id"][:8])
            return JSONResponse(status_code=403, content={"error": "자신의 트랙만 수정할 수 있습니다."})

        object_name = f"covers/{current_user['id']}/{id}{ext}"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )

        # Update MongoDB track's cover_image_url
        result = await mongo.tracks.update_one(
            {"_id": ObjectId(id)},
            {"$set": {"cover_image_url": object_name}},
        )
        # v197: update_track(tracks.py:758~761) 과 동일 키. Redis 장애가 커버 업로드를
        # 500 으로 바꾸면 안 되므로 반드시 삼킨다 — 최악은 최대 600초 표시 지연.
        # playcount:buffer 는 재생수 유실 방지를 위해 지우지 않는다.
        try:
            redis = get_redis()
            await redis.delete(f"cache:track:{id}")
            await redis.delete(f"cache:track:v3:{id}")
        except Exception:
            logger.warning("[upload] image cover cache_invalidate_failed track=%s", id[:8])
        logger.info("[upload] image cover_ok track=%s obj=%s matched=%d",
                    id[:8], object_name, result.matched_count)

        # v173: 즉시 표시용 브라우저 URL — 중앙 헬퍼 (proxy/presign 모드)
        url = browser_image_url(object_name)
        return {"file_url": url, "object_name": object_name}

    else:
        # v197: 정식 경로는 /auth/me/profile-image (크롭·이전 이미지 정리·세션 갱신 포함).
        # 여기는 그 셋이 없는 레거시 경로 — 동작은 그대로 두고 사용량만 계측한다.
        logger.info("[upload] image profile_legacy_route user=%s", current_user["id"][:8])
        # Profile image -> update PostgreSQL users.profile_image
        object_name = f"profiles/{current_user['id']}{ext}"
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(contents),
            length=len(contents),
            content_type=content_type,
        )

        user_uuid = uuid_lib.UUID(current_user["id"])
        await conn.execute(
            "UPDATE users SET profile_image = $1 WHERE id = $2",
            object_name, user_uuid,
        )

        # v173: 즉시 표시용 브라우저 URL — 중앙 헬퍼 (proxy/presign 모드)
        url = browser_image_url(object_name)
        return {"file_url": url, "object_name": object_name}


@router.get("/presigned-url")
async def get_presigned_url(
    bucket: str = "images",
    object_name: str = "",
    current_user=Depends(get_current_user),
):
    """Get a presigned URL for an object in MinIO."""
    if not object_name:
        return JSONResponse(status_code=400, content={"error": "object_name은 필수입니다."})
    # FaceGuardSquad(v135) — faces/ 는 암호화 얼굴 데이터(백엔드 전용) 경로. presign 노출 금지.
    # TrustSquad(v138) — evidence/ 는 신고 증거 격리 보존 경로(어드민 전용). 동일 차단.
    if object_name.startswith(("faces/", "evidence/")):
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})

    bucket_name = settings.minio_bucket_images if bucket == "images" else settings.minio_bucket_music

    # v173: 범용 presign 도 public 클라이언트 경유 (외부/https 접근 가능 host 로 서명)
    url = public_presign(object_name, bucket=bucket_name)
    if url is None:
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})

    return {"url": url}


@router.post("/generate-cover")
async def generate_cover(
    body: GenerateCoverRequest,
    current_user=Depends(get_current_user),
):
    """Generate AI cover image using Google Gemini or OpenAI GPT Image 2."""
    # v55: image_model 검증.
    norm_image_model = _normalize_image_model(body.image_model)
    if norm_image_model is None:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 image_model 입니다. (nb_pro, gpt_image_2)"},
        )

    # v57: vocal_gender 정규화 + 검증. 빈/없음 → None (기존 동작). 영어 enum /
    # 한국어 별칭 → 정규화. 잘못된 값 → 400.
    norm_vocal_gender = _normalize_vocal_gender(body.vocal_gender)
    if norm_vocal_gender is _INVALID_VOCAL_GENDER:
        return JSONResponse(
            status_code=400,
            content={"error": "지원하지 않는 vocal_gender 입니다. (female, male, neutral)"},
        )
    if norm_image_model == "nb_pro" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if norm_image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    title = body.title.strip()
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "곡 제목을 입력해주세요."},
        )

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (포인트 차감 전 403)
    from ..services.strike_service import check_generation_allowed
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    # Points — 커버 AI 생성 선차감 (부족 시 402 차단, 실패 시 환불).
    # StarEcon(v158) — 단가는 POINT_COSTS 단일 소스 (cover: 2 → 5).
    # ref 는 시도당 유니크 uuid (point_events 유니크 인덱스 재시도 충돌 회피).
    from ..services.points_service import POINT_COSTS, refund_points, spend_points
    cover_point_cost = POINT_COSTS["cover"]
    point_ref = uuid_lib.uuid4().hex
    if not await spend_points(current_user["id"], "cover", cover_point_cost, point_ref):
        return JSONResponse(
            status_code=402,
            content={"error": "포인트가 부족합니다 (필요: {})".format(cover_point_cost)},
        )

    # Load character sheet if requested
    # v67-pre: 디버그 로그 강화 — character_object_name 수신 여부 + MinIO 로드 결과
    logger.info(
        "[CoverGenEntry] user=%s character_object_name=%s vocal_gender=%s image_model=%s",
        current_user["id"],
        body.character_object_name or "(none)",
        norm_vocal_gender,
        norm_image_model,
    )
    character_image_bytes = None
    if body.character_object_name:
        try:
            minio_client = get_minio()
            response = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=body.character_object_name,
            )
            character_image_bytes = response.read()
            response.close()
            response.release_conn()
            logger.info(
                "[CoverGenEntry] character bytes loaded len=%d from %s",
                len(character_image_bytes), body.character_object_name,
            )
        except Exception as e:
            logger.warning(
                "[CoverGenEntry] character image LOAD FAILED object=%s err=%s",
                body.character_object_name, str(e)[:200],
            )
    else:
        logger.info("[CoverGenEntry] no character_object_name in request payload")

    # v42: Load user-saved location anchor (Mode B) if requested.
    user_location_image_bytes = None
    user_location_name = None
    if body.location_id:
        try:
            from .character import _load_user_location

            mongo = get_mongo()
            loc = await _load_user_location(mongo, current_user["id"], body.location_id)
            if loc:
                user_location_image_bytes = loc.get("image_bytes")
                user_location_name = loc.get("name") or None
            else:
                logger.info(
                    "generate_cover: location_id=%s not found for user=%s — proceeding without location anchor",
                    body.location_id, current_user["id"],
                )
        except Exception as e:
            logger.warning("generate_cover: failed to load user location: %s", e)

    try:
        from ..services.cover_generator import generate_cover_image

        # v41: LoRA system removed — generate_cover_image returns plain bytes.
        # v55: image_model 분기. v57: vocal_gender 주입.
        logger.info(
            "generate_cover: image_model=%s vocal_gender=%s user=%s",
            norm_image_model,
            norm_vocal_gender,
            current_user["id"],
        )
        image_bytes = await generate_cover_image(
            title=title,
            genre=body.genre,
            mood=body.mood,
            style=body.style,
            character_image_bytes=character_image_bytes,
            user_prompt=body.user_prompt,
            prompt_model=body.prompt_model,
            user_location_image_bytes=user_location_image_bytes,
            user_location_name=user_location_name,
            image_model=norm_image_model,
            vocal_gender=norm_vocal_gender,
        )

        # Save to MinIO
        object_name = "covers/generated/{}/{}.png".format(
            current_user["id"], uuid_lib.uuid4().hex
        )

        minio_client = get_minio()
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(image_bytes),
            length=len(image_bytes),
            content_type="image/png",
        )

        # v58: 신규 cover_sessions 도큐먼트 insert. 매 [다시 생성] 마다 신규
        # session 발급 (Q4 a — 옛 history 폐기). v0 entry 1개 + image_model 박제.
        cover_session_id: Optional[str] = None
        try:
            mongo = get_mongo()
            now_utc = datetime.now(timezone.utc)
            # v215 — 보관함 카드 라벨·재현 재료 스냅샷 (additive, 신규 생성분만)
            _src = (body.source or "").strip().lower()
            session_doc = {
                "user_id": current_user["id"],
                "image_model": norm_image_model,
                "cover_object_name": object_name,
                "title": title[:100],
                "gen_params": {
                    "genre": body.genre,
                    "mood": body.mood,
                    "user_prompt": (body.user_prompt or "")[:500],
                    "prompt_model": body.prompt_model,
                    "location_id": body.location_id,
                    "vocal_gender": norm_vocal_gender,
                    "character_object_name": body.character_object_name,
                },
                "source": _src if _src in COVER_SOURCE_WHITELIST else None,
                "current_version": 0,
                "cover_refine_history": [
                    {
                        "version": 0,
                        "object_name": object_name,
                        "refine_prompt": None,
                        "image_model": norm_image_model,
                        "created_at": now_utc,
                    }
                ],
                "created_at": now_utc,
                "updated_at": now_utc,
            }
            result = await mongo.cover_sessions.insert_one(session_doc)
            cover_session_id = str(result.inserted_id)
            logger.info(
                "[CoverSession] new session=%s user=%s image_model=%s",
                cover_session_id,
                current_user["id"],
                norm_image_model,
            )
        except Exception as e:  # noqa: BLE001
            # 세션 insert 실패는 치명적이지 않음 (커버 자체는 이미 MinIO 에 저장됨).
            # 옛 클라이언트(v57 이하) 와도 호환 — cover_session_id 없이 응답.
            logger.warning(
                "[CoverSession] insert failed user=%s err=%s: %s",
                current_user["id"],
                type(e).__name__,
                str(e)[:200],
            )

        response_body = {
            "image_url": "/api/upload/cover-preview/{}".format(object_name),
            "object_name": object_name,
            "image_model": norm_image_model,  # v55 — echo back
            "message": "커버 이미지가 생성되었습니다.",
        }
        if cover_session_id:
            response_body["cover_session_id"] = cover_session_id
        return response_body
    except Exception as e:
        # Points — 생성 실패 시 선차감분 환불.
        await refund_points(current_user["id"], "cover", cover_point_cost, point_ref)
        return JSONResponse(
            status_code=500,
            content={"error": "커버 생성 실패: {}".format(str(e)[:200])},
        )


@router.get("/cover-preview/{object_name:path}")
async def cover_preview(object_name: str):
    """Proxy cover image from MinIO for external access.

    v173: 무인증 유지(비로그인 홈 커버 노출), faces/·evidence/ 차단 유지.
    보강 — `..` 경로 차단, media_type 확장자 기반 guess (png 고정 → jpg/webp 오헤더 수정).
    """
    # v135 faces/ + v138 evidence/ — 백엔드 전용 경로 프록시 노출 금지.
    if object_name.startswith(("faces/", "evidence/")):
        return JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})
    # v173: 경로 탈출(`..`) 차단 — profile/ad 프록시 관행과 정합.
    if ".." in object_name:
        logger.info("[cover-preview] blocked path traversal obj=%s", object_name)
        return JSONResponse(status_code=404, content={"error": "이미지를 찾을 수 없습니다."})
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()
        # v173: 확장자 기반 media_type — 알 수 없으면 기존 기본값 png 유지.
        media_type = mimetypes.guess_type(object_name)[0] or "image/png"
        return Response(content=data, media_type=media_type)
    except Exception as e:
        logger.info("[cover-preview] 404 obj=%s err=%s", object_name, e)
        return JSONResponse(
            status_code=404,
            content={"error": "이미지를 찾을 수 없습니다."},
        )


# ─── v58: cover refine / revert / history routes ───
#
# 신규 [추가 수정] 플로우. cover_sessions 컬렉션 기반:
#  - POST /refine-cover    — 현재 커버를 ref 로 부분 수정 (multi-turn)
#  - POST /revert-cover    — 이전 버전으로 되돌리기 (history 보존)
#  - GET  /cover-history   — 이력 조회

REFINE_PROMPT_MAX_LEN = 500
COVER_REFINE_HISTORY_CAP = 10


class RefineCoverRequest(BaseModel):
    cover_session_id: str
    refine_prompt: str


class RevertCoverRequest(BaseModel):
    cover_session_id: str
    target_version: int


def _serialize_history_entry(entry: dict) -> dict:
    """Normalize a history entry for JSON output (datetime → isoformat)."""
    out = dict(entry)
    ca = out.get("created_at")
    if hasattr(ca, "isoformat"):
        out["created_at"] = ca.isoformat()
    return out


async def _load_cover_session(mongo, cover_session_id: str, user_id: str):
    """Load + auth check a cover_sessions doc. Returns dict or None."""
    if not ObjectId.is_valid(cover_session_id):
        return None
    doc = await mongo.cover_sessions.find_one({"_id": ObjectId(cover_session_id)})
    if not doc:
        return None
    if doc.get("user_id") != user_id:
        return None  # 권한 없음 — 보안상 not_found 와 동일 응답
    return doc


@router.post("/refine-cover")
async def refine_cover(
    body: RefineCoverRequest,
    current_user=Depends(get_current_user),
):
    """v58: refine an existing cover image (image-to-image multi-turn).

    Loads the current cover from MinIO, calls refine_cover_image with the user's
    change request, saves the new PNG to MinIO under
    ``covers/refined/{user}/{session}/v{N}.png``, and appends a new entry to
    ``cover_sessions.cover_refine_history``.
    """
    # 길이 검증
    rp = (body.refine_prompt or "").strip()
    if not rp:
        return JSONResponse(
            status_code=400,
            content={"error": "수정 요청을 입력해주세요."},
        )
    if len(rp) > REFINE_PROMPT_MAX_LEN:
        return JSONResponse(
            status_code=400,
            content={
                "error": "수정 요청은 {}자 이하여야 합니다.".format(REFINE_PROMPT_MAX_LEN)
            },
        )

    mongo = get_mongo()
    session = await _load_cover_session(mongo, body.cover_session_id, current_user["id"])
    if not session:
        logger.info(
            "[RefineCover] session=%s not_found user=%s",
            body.cover_session_id,
            current_user["id"],
        )
        return JSONResponse(
            status_code=404,
            content={"error": "커버 세션을 찾을 수 없습니다."},
        )

    image_model = session.get("image_model") or "nb_pro"
    current_object_name = session.get("cover_object_name")
    if not current_object_name:
        return JSONResponse(
            status_code=404,
            content={"error": "커버 세션의 현재 커버가 없습니다."},
        )

    # API 키 가드
    if image_model == "nb_pro" and not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )
    if image_model == "gpt_image_2" and not settings.openai_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "OpenAI API 키가 설정되지 않았습니다."},
        )

    # 현재 커버 PNG bytes 로드
    minio_client = get_minio()
    try:
        resp = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=current_object_name,
        )
        current_cover_bytes = resp.read()
        resp.close()
        resp.release_conn()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[RefineCover] failed to load current cover session=%s err=%s",
            body.cover_session_id,
            type(e).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "현재 커버 이미지를 불러올 수 없습니다."},
        )

    # refine 호출
    try:
        from ..services.cover_generator import refine_cover_image

        new_bytes = await refine_cover_image(
            current_cover_bytes=current_cover_bytes,
            refine_prompt=rp,
            image_model=image_model,
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": "커버 수정 실패: {}".format(str(e)[:200])},
        )

    # 새 버전 번호 산정 — history 최신 version + 1
    history = list(session.get("cover_refine_history") or [])
    max_version = -1
    for entry in history:
        v = entry.get("version")
        if isinstance(v, int) and v > max_version:
            max_version = v
    new_version = max_version + 1 if max_version >= 0 else 0

    new_object_name = "covers/refined/{}/{}/v{}.png".format(
        current_user["id"], body.cover_session_id, new_version
    )

    # MinIO 저장
    try:
        minio_client.put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=new_object_name,
            data=io.BytesIO(new_bytes),
            length=len(new_bytes),
            content_type="image/png",
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": "이미지 저장 실패: {}".format(str(e)[:200])},
        )

    # history append + cap
    now_utc = datetime.now(timezone.utc)
    new_entry = {
        "version": new_version,
        "object_name": new_object_name,
        "refine_prompt": rp,
        "image_model": image_model,
        "created_at": now_utc,
    }
    history.append(new_entry)
    # cap 10 — 가장 옛 entry drop. version 번호는 단조 증가 유지.
    if len(history) > COVER_REFINE_HISTORY_CAP:
        history = history[-COVER_REFINE_HISTORY_CAP:]

    # Mongo update
    try:
        await mongo.cover_sessions.update_one(
            {"_id": ObjectId(body.cover_session_id)},
            {
                "$set": {
                    "cover_object_name": new_object_name,
                    "current_version": new_version,
                    "cover_refine_history": history,
                    "updated_at": now_utc,
                }
            },
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": "세션 업데이트 실패: {}".format(str(e)[:200])},
        )

    logger.info(
        "[RefineCover] session=%s user=%s prompt_len=%d image_model=%s new_version=%d",
        body.cover_session_id,
        current_user["id"],
        len(rp),
        image_model,
        new_version,
    )

    return {
        "cover_object_name": new_object_name,
        "image_url": "/api/upload/cover-preview/{}".format(new_object_name),
        "current_version": new_version,
        "cover_refine_history": [_serialize_history_entry(e) for e in history],
    }


@router.post("/revert-cover")
async def revert_cover(
    body: RevertCoverRequest,
    current_user=Depends(get_current_user),
):
    """v58: revert to a previous version. History itself is preserved."""
    if not isinstance(body.target_version, int) or body.target_version < 0:
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 target_version 입니다."},
        )

    mongo = get_mongo()
    session = await _load_cover_session(mongo, body.cover_session_id, current_user["id"])
    if not session:
        return JSONResponse(
            status_code=404,
            content={"error": "커버 세션을 찾을 수 없습니다."},
        )

    history = list(session.get("cover_refine_history") or [])
    target_entry = None
    for entry in history:
        if entry.get("version") == body.target_version:
            target_entry = entry
            break
    if not target_entry:
        return JSONResponse(
            status_code=404,
            content={"error": "해당 버전을 찾을 수 없습니다."},
        )

    prev_version = session.get("current_version")
    new_cover_object = target_entry.get("object_name")
    now_utc = datetime.now(timezone.utc)
    await mongo.cover_sessions.update_one(
        {"_id": ObjectId(body.cover_session_id)},
        {
            "$set": {
                "cover_object_name": new_cover_object,
                "current_version": body.target_version,
                "updated_at": now_utc,
            }
        },
    )

    logger.info(
        "[RevertCover] session=%s target_version=%d prev_version=%s user=%s",
        body.cover_session_id,
        body.target_version,
        prev_version,
        current_user["id"],
    )

    return {
        "cover_object_name": new_cover_object,
        "image_url": "/api/upload/cover-preview/{}".format(new_cover_object),
        "current_version": body.target_version,
    }


@router.get("/cover-history/{cover_session_id}")
async def get_cover_history(
    cover_session_id: str,
    current_user=Depends(get_current_user),
):
    """v58: fetch the refine history for a cover session."""
    mongo = get_mongo()
    session = await _load_cover_session(mongo, cover_session_id, current_user["id"])
    if not session:
        return JSONResponse(
            status_code=404,
            content={"error": "커버 세션을 찾을 수 없습니다."},
        )

    history = list(session.get("cover_refine_history") or [])
    logger.info(
        "[CoverHistory] session=%s entries=%d user=%s",
        cover_session_id,
        len(history),
        current_user["id"],
    )

    return {
        "cover_session_id": cover_session_id,
        "current_version": session.get("current_version"),
        "image_model": session.get("image_model") or "nb_pro",
        "cover_object_name": session.get("cover_object_name"),
        "cover_refine_history": [_serialize_history_entry(e) for e in history],
    }


# ── v215: 커버 보관함 (커버촬영실 — PLAN C2) ────────────────────────────────
# 저장소 = cover_sessions 재활용 (신규 컬렉션 없음 — 기존 29건 자동 소급).
# 실경로 /api/upload/cover-sessions (앱팀 가안 "GET /api/covers" 아님 — 계약서 명시).


def _session_object_names(session: dict) -> set:
    """세션의 오브젝트명 전량 (현재본 + refine 이력 전 버전)."""
    names = set()
    if session.get("cover_object_name"):
        names.add(session["cover_object_name"])
    for entry in session.get("cover_refine_history") or []:
        if entry.get("object_name"):
            names.add(entry["object_name"])
    return names


@router.get("/cover-sessions")
async def list_cover_sessions(
    page: int = 1,
    limit: int = 20,
    current_user=Depends(get_current_user),
):
    """v215 — 내 커버 보관함 목록 (updated_at 최신순) + 연결 곡 역조회.

    연결 곡은 페이지 세션들의 오브젝트명 전량(현재본+이력)을 모아
    tracks **$in 1회** 조회로 매핑 (N+1 금지). uploader 본인 한정 —
    타인 곡이 내 세션 커버를 쓸 수 없는 현 검증 체계와 정합.
    """
    mongo = get_mongo()
    user_id = current_user["id"]
    limit = min(max(limit, 1), 100)
    skip = (max(page, 1) - 1) * limit

    total = await mongo.cover_sessions.count_documents({"user_id": user_id})
    sessions = await (
        mongo.cover_sessions.find({"user_id": user_id})
        .sort("updated_at", -1).skip(skip).limit(limit)
    ).to_list(length=limit)

    # 연결 곡 역조회 — 오브젝트명 전량 수집 → tracks $in 1회
    all_names: set = set()
    for s in sessions:
        all_names |= _session_object_names(s)
    linked_by_object: dict = {}
    if all_names:
        async for t in mongo.tracks.find(
            {"uploader_id": user_id, "cover_image_url": {"$in": list(all_names)}},
            {"title": 1, "cover_image_url": 1},
        ):
            linked_by_object.setdefault(t.get("cover_image_url"), []).append(
                {"id": str(t["_id"]), "title": t.get("title") or ""}
            )

    covers = []
    for s in sessions:
        linked_tracks = []
        _seen_track_ids = set()
        for name in _session_object_names(s):
            for t in linked_by_object.get(name, []):
                if t["id"] not in _seen_track_ids:
                    _seen_track_ids.add(t["id"])
                    linked_tracks.append(t)
        obj = s.get("cover_object_name")
        covers.append({
            "cover_session_id": str(s["_id"]),
            "cover_object_name": obj,
            "image_url": "/api/upload/cover-preview/{}".format(obj) if obj else None,
            # Q2(planner 확정) — 구형 doc(v215 이전)은 title/gen_params/source
            # **null 3키 통일 동봉**(키셋 고정). doc 저장은 키 부재 그대로 — 소급 쓰기 없음.
            "title": s.get("title"),
            "image_model": s.get("image_model") or "nb_pro",
            "current_version": s.get("current_version", 0),
            "history_count": len(s.get("cover_refine_history") or []),
            "gen_params": s.get("gen_params"),
            "source": s.get("source"),
            "linked_tracks": linked_tracks,
            "created_at": s.get("created_at").isoformat() if s.get("created_at") else None,
            "updated_at": s.get("updated_at").isoformat() if s.get("updated_at") else None,
        })

    logger.info(
        "[CoverLib] list user=%s page=%d count=%d total=%d linked_objs=%d",
        user_id[:8], page, len(covers), total, len(linked_by_object),
    )
    import math as _math
    return {
        "covers": covers,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": _math.ceil(total / limit) if limit else 0,
        },
    }


@router.delete("/cover-sessions/{cover_session_id}")
async def delete_cover_session(
    cover_session_id: str,
    current_user=Depends(get_current_user),
):
    """v215 — 보관함 커버 삭제. 연결 곡 존재 시 409 거부 (미사용만 hard delete).

    오브젝트 파기의 **단일 통로** (purge_track_document 는 세션 커버를 스킵 — C3).
    삭제 = 세션 doc + 오브젝트 전 버전(현재본+이력). 타인/부재/무효 404 은닉.
    """
    mongo = get_mongo()
    user_id = current_user["id"]
    session = await _load_cover_session(mongo, cover_session_id, user_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "커버 세션을 찾을 수 없습니다."})

    names = _session_object_names(session)
    linked_tracks = []
    _seen = set()
    if names:
        async for t in mongo.tracks.find(
            {"uploader_id": user_id, "cover_image_url": {"$in": list(names)}},
            {"title": 1},
        ):
            tid = str(t["_id"])
            if tid not in _seen:
                _seen.add(tid)
                linked_tracks.append({"id": tid, "title": t.get("title") or ""})
    if linked_tracks:
        logger.info(
            "[CoverLib] delete rejected (linked) session=%s user=%s tracks=%d",
            cover_session_id, user_id[:8], len(linked_tracks),
        )
        return JSONResponse(
            status_code=409,
            content={
                "error": "이 커버를 사용 중인 곡이 있어 삭제할 수 없습니다.",
                "linked_tracks": linked_tracks,
            },
        )

    # 미사용 — 오브젝트 전 버전 + doc hard delete (오브젝트 삭제는 best-effort)
    minio_client = get_minio()
    removed = 0
    for name in names:
        try:
            minio_client.remove_object(
                bucket_name=settings.minio_bucket_images, object_name=name,
            )
            removed += 1
        except Exception as e:
            logger.warning(
                "[CoverLib] object delete failed session=%s obj=%s: %s",
                cover_session_id, name, str(e)[:120],
            )
    await mongo.cover_sessions.delete_one({"_id": session["_id"]})
    logger.info(
        "[CoverLib] delete session=%s user=%s objects=%d/%d",
        cover_session_id, user_id[:8], removed, len(names),
    )
    return {"message": "커버가 삭제되었습니다.", "deleted_objects": removed}


@router.post("/generate-mv")
async def generate_mv(
    body: GenerateMVRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """Start AI music video generation using the 20-scene pipeline.

    Creates a background job that:
      1. Splits lyrics into ~20 scenes (ChatGPT)
      2. Generates scene images (Gemini)
      3. Generates scene videos from images (Veo 3.1)
      4. Concatenates all clips into a final video (ffmpeg)

    Returns a job_id for polling via /mv-status/{job_id}.
    """
    if not settings.google_api_key:
        return JSONResponse(
            status_code=503,
            content={"error": "Google API 키가 설정되지 않았습니다."},
        )

    title = body.title.strip()
    if not title:
        return JSONResponse(
            status_code=400,
            content={"error": "곡 제목을 입력해주세요."},
        )

    # TrustSquad(v139) — 스트라이크 생성 제한 게이트 (제한 중이면 403)
    from ..services.strike_service import check_generation_allowed
    denied = await check_generation_allowed(None, current_user["id"])
    if denied:
        return denied

    mongo = get_mongo()

    # Optionally load cover image from MinIO
    cover_image_bytes = None
    if body.cover_object_name:
        try:
            minio_client = get_minio()
            response = minio_client.get_object(
                bucket_name=settings.minio_bucket_images,
                object_name=body.cover_object_name,
            )
            cover_image_bytes = response.read()
            response.close()
            response.release_conn()
        except Exception as e:
            logger.warning("Failed to load cover image: %s", e)

    # Create mv_jobs document
    job_doc = {
        "user_id": current_user["id"],
        "title": title,
        "status": "pending",
        "progress": 0,
        "total_scenes": 0,
        "completed_scenes": 0,
        "scene_thumbnails": [],
        "result_video_url": "",
        "error_message": "",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    result = await mongo.mv_jobs.insert_one(job_doc)
    job_id = result.inserted_id

    # Launch pipeline in background
    from ..services.mv_generator import run_mv_pipeline

    background_tasks.add_task(
        run_mv_pipeline,
        job_id=job_id,
        title=title,
        genre=body.genre,
        mood=body.mood,
        lyrics=body.lyrics,
        cover_image_bytes=cover_image_bytes,
        mongo_db=mongo,
    )

    return {
        "job_id": str(job_id),
        "message": "뮤직비디오 생성이 시작되었습니다. (20장면 파이프라인)",
    }


@router.get("/mv-status/{job_id}")
async def mv_status(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Check music video generation job status."""
    if not ObjectId.is_valid(job_id):
        return JSONResponse(
            status_code=400,
            content={"error": "유효하지 않은 작업 ID입니다."},
        )

    mongo = get_mongo()
    job = await mongo.mv_jobs.find_one({"_id": ObjectId(job_id)})

    if not job:
        return JSONResponse(
            status_code=404,
            content={"error": "작업을 찾을 수 없습니다."},
        )

    # v197: 소유권 가드 — mv.py:207 과 동일 문구. (upload.py 는 JSONResponse 관행 유지)
    if job.get("user_id") != current_user["id"]:
        logger.info("[upload] mv_status denied job=%s user=%s", job_id[:8], current_user["id"][:8])
        return JSONResponse(status_code=403, content={"error": "이 작업에 접근할 권한이 없습니다."})

    # v173: scene thumbnail 은 브라우저 노출 이미지 — 중앙 헬퍼 (proxy/presign 모드)
    scene_thumbnail_urls = []
    for thumb_name in (job.get("scene_thumbnails") or []):
        scene_thumbnail_urls.append(browser_image_url(thumb_name) or "")

    # v173: result video 는 브라우저 노출 비디오 — 항상 public presign
    result_video_url = ""
    if job.get("result_video_url"):
        result_video_url = browser_video_url(job["result_video_url"]) or (
            "/api/upload/mv-preview/{}".format(job["result_video_url"])
        )

    return {
        "status": job.get("status", "pending"),
        "progress": job.get("progress", 0),
        "total_scenes": job.get("total_scenes", 0),
        "completed_scenes": job.get("completed_scenes", 0),
        "scene_thumbnails": scene_thumbnail_urls,
        "result_video_url": result_video_url,
        "object_name": job.get("result_video_url", ""),
        "error_message": job.get("error_message", ""),
    }


@router.get("/mv-preview/{object_name:path}")
async def mv_preview(object_name: str):
    """Proxy music video or scene thumbnail from MinIO for playback."""
    # v135 faces/ + v138 evidence/ — 백엔드 전용 경로 프록시 노출 금지.
    if object_name.startswith(("faces/", "evidence/")):
        return JSONResponse(status_code=404, content={"error": "파일을 찾을 수 없습니다."})
    minio_client = get_minio()
    try:
        response = minio_client.get_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
        )
        data = response.read()
        response.close()
        response.release_conn()

        # Determine content type from extension
        if object_name.endswith(".png"):
            media_type = "image/png"
        elif object_name.endswith(".jpg") or object_name.endswith(".jpeg"):
            media_type = "image/jpeg"
        else:
            media_type = "video/mp4"

        return Response(content=data, media_type=media_type)
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "파일을 찾을 수 없습니다."},
        )
