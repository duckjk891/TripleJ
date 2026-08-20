"""FaceGuardSquad(v135) — 얼굴 인증(생체 대조) API.

/api/face-verify:
  GET  /status           인증 상태·게이트 조회
  POST /consent          성인 본인 동의 기록 (face_biometric)
  POST /guardian/request 미성년(만 19세 미만) 보호자 동의 요청 — 문자 mock 링크,
                         guardian_consents consent_type='face_biometric' ("1회 동의=계속 이용" 안내)
  POST /verify           multipart(photo + selfie?) 얼굴 대조 — 저장 얼굴 매칭 →
                         불일치 need_recapture → 셀피 재검증 → 저장 갱신
  POST /session          AWS Face Liveness 세션 골격 (FE Amplify 통합 전 mock 세션)
  DELETE /               동의 철회 — 철회 이력 append + 얼굴 데이터 전체 파기

게이트 순서(verify): flag → 본인인증(is_verified) → 동의(성인 본인/미성년 보호자) → 대조.
로그 규칙: [face-verify], user·photo_sha 앞 8자만, 이미지 바이트·전체 해시 로그 금지.
"""

import logging
import re
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings
from ..database.postgres import get_pg
from ..models.user import age_years
from ..services import face_verify_service as fv
from ..services.guardian_notify import send_guardian_consent_notification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/face-verify", tags=["FaceVerify"])

# 미성년 기준 — 민법상 만 19세 미만 (생체정보 처리는 법정대리인 동의 필요)
FACE_MINOR_AGE = 19

MAX_FACE_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB

# 보호자 연락처 형식 (routes/auth.py 와 동일 규칙) — 값 자체는 로그 금지
_GUARDIAN_PHONE_RE = re.compile(r"^[0-9+\-\s]{8,20}$")

# 보호자 발송 메시지 — "1회 동의=계속 이용" 문구 필수 포함
GUARDIAN_ONCE_NOTICE = "한 번 동의하시면 이후 얼굴 인증 이용 시 계속 적용됩니다(언제든 철회 가능)."


class ConsentBody(BaseModel):
    version: str = Field(default="v1.0", max_length=20)


class GuardianFaceRequestBody(BaseModel):
    guardian_name: Optional[str] = Field(default=None, max_length=60)
    guardian_phone: Optional[str] = Field(default=None, max_length=20)


# ---------------------------------------------------------------------------
# 공통 헬퍼
# ---------------------------------------------------------------------------


def _uid(current_user) -> uuid.UUID:
    return uuid.UUID(str(current_user["id"]))


def _is_minor(birth_date) -> bool:
    """만 19세 미만 여부 — birth_date 미입력이면 성인 취급(게이트 미적용)."""
    if birth_date is None:
        return False
    return age_years(birth_date) < FACE_MINOR_AGE


async def _fetch_user(conn, user_id):
    return await conn.fetchrow(
        "SELECT id, is_verified, birth_date FROM users WHERE id = $1", user_id
    )


async def _latest_face_consent(conn, user_id):
    return await conn.fetchrow(
        """SELECT agreed, version FROM user_consents
           WHERE user_id = $1 AND consent_key = 'face_biometric'
           ORDER BY created_at DESC, id DESC LIMIT 1""",
        user_id,
    )


async def _latest_guardian_face_row(conn, user_id):
    return await conn.fetchrow(
        """SELECT status, requested_at, decided_at FROM guardian_consents
           WHERE child_user_id = $1 AND consent_type = 'face_biometric'
           ORDER BY requested_at DESC LIMIT 1""",
        user_id,
    )


def _disabled_response():
    return JSONResponse(
        status_code=503,
        content={"error": "face_verify_disabled", "message": "얼굴 인증 기능이 아직 활성화되지 않았습니다."},
    )


async def _record_face_consent(conn, user_id, agreed: bool, version: str):
    """user_consents append + [face-verify] 로그 (routes/auth._record_consents 와 동일 규칙)."""
    await conn.execute(
        "INSERT INTO user_consents (user_id, consent_key, agreed, version) VALUES ($1, 'face_biometric', $2, $3)",
        user_id, agreed, version,
    )
    logger.info(
        "[face-verify] consent recorded user=%s agreed=%s version=%s",
        str(user_id)[:8], agreed, version,
    )


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------


@router.get("/status")
async def face_verify_status(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """얼굴 인증 상태 — FE 가 플로우(본인인증→동의→촬영) 분기를 결정."""
    user_id = _uid(current_user)
    user = await _fetch_user(conn, user_id)
    if not user:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})

    is_verified = bool(user["is_verified"])
    minor = _is_minor(user["birth_date"])
    consent = await _latest_face_consent(conn, user_id)
    consent_ok = bool(consent and consent["agreed"])
    guardian_row = await _latest_guardian_face_row(conn, user_id)
    registered = bool(
        await conn.fetchrow("SELECT 1 FROM face_biometrics WHERE user_id = $1", user_id)
    )
    logger.info(
        "[face-verify] status user=%s enabled=%s verified=%s minor=%s consent=%s registered=%s",
        str(user_id)[:8], settings.face_verify_enabled, is_verified, minor, consent_ok, registered,
    )
    return {
        "enabled": settings.face_verify_enabled,
        "mode": fv.get_mode(),
        "is_verified": is_verified,
        "minor": minor,
        "consent_needed": not consent_ok,
        "guardian_needed": minor and not consent_ok,
        "guardian_status": guardian_row["status"] if guardian_row else None,
        "registered": registered,
    }


# ---------------------------------------------------------------------------
# POST /consent — 성인 본인 동의
# ---------------------------------------------------------------------------


@router.post("/consent")
async def face_verify_consent(
    body: ConsentBody, current_user=Depends(get_current_user), conn=Depends(get_pg)
):
    """성인 본인 동의 기록 — 미성년은 보호자 동의 절차(guardian/request)로 안내."""
    if not settings.face_verify_enabled:
        return _disabled_response()
    user_id = _uid(current_user)
    user = await _fetch_user(conn, user_id)
    if not user:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})
    if not user["is_verified"]:
        return JSONResponse(
            status_code=403,
            content={"error": "identity_verification_required", "message": "본인인증 완료 후 이용할 수 있습니다."},
        )
    if _is_minor(user["birth_date"]):
        return JSONResponse(
            status_code=403,
            content={"error": "guardian_consent_required", "message": "미성년 회원은 보호자 동의가 필요합니다."},
        )
    version = (body.version or "").strip() or "v1.0"
    await _record_face_consent(conn, user_id, True, version)
    return {"consented": True, "message": "얼굴 인증(생체정보 처리) 동의가 기록되었습니다."}


# ---------------------------------------------------------------------------
# POST /guardian/request — 미성년 보호자 동의 요청 (v125 골격 재사용)
# ---------------------------------------------------------------------------


@router.post("/guardian/request", status_code=201)
async def face_guardian_request(
    body: GuardianFaceRequestBody, current_user=Depends(get_current_user), conn=Depends(get_pg)
):
    """미성년 회원의 보호자 동의 요청 — mock 문자 링크 발송, consent_type='face_biometric'.

    보호자 정보 미입력 시 기존 guardian_consents(가입 동의) 최근 기록에서 재사용.
    발송 메시지에 "1회 동의=계속 이용" 안내 포함.
    """
    if not settings.face_verify_enabled:
        return _disabled_response()
    user_id = _uid(current_user)
    user = await _fetch_user(conn, user_id)
    if not user:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})
    if not user["is_verified"]:
        return JSONResponse(
            status_code=403,
            content={"error": "identity_verification_required", "message": "본인인증 완료 후 이용할 수 있습니다."},
        )
    if not _is_minor(user["birth_date"]):
        return JSONResponse(
            status_code=400,
            content={"error": "성인 회원은 본인 동의(POST /consent)로 이용할 수 있습니다."},
        )

    guardian_name = (body.guardian_name or "").strip()
    guardian_phone = (body.guardian_phone or "").strip()
    if not guardian_name or not guardian_phone:
        # 가입 시 보호자 동의 이력이 있으면 그 보호자 정보 재사용
        prev = await conn.fetchrow(
            """SELECT guardian_name, guardian_phone FROM guardian_consents
               WHERE child_user_id = $1 ORDER BY requested_at DESC LIMIT 1""",
            user_id,
        )
        if prev:
            guardian_name = guardian_name or (prev["guardian_name"] or "")
            guardian_phone = guardian_phone or (prev["guardian_phone"] or "")
    if not guardian_name:
        return JSONResponse(status_code=400, content={"error": "보호자 이름을 입력해주세요."})
    if not _GUARDIAN_PHONE_RE.match(guardian_phone):
        return JSONResponse(status_code=400, content={"error": "보호자 연락처 형식이 올바르지 않습니다."})

    consent_token = secrets.token_urlsafe(32)
    await conn.execute(
        """INSERT INTO guardian_consents (child_user_id, guardian_name, guardian_phone, consent_token, status, method, consent_type)
           VALUES ($1, $2, $3, $4, 'pending', 'mock', 'face_biometric')""",
        user_id, guardian_name, guardian_phone, consent_token,
    )
    logger.info(
        "[face-verify] guardian request child=%s token=%s name_len=%d phone_len=%d",
        str(user_id)[:8], consent_token[:8], len(guardian_name), len(guardian_phone),
    )

    message = (
        "[MAIDOL] 자녀의 얼굴 인증(생체정보 처리)에 대한 보호자 동의 요청입니다. "
        + GUARDIAN_ONCE_NOTICE
    )
    notify = await send_guardian_consent_notification(
        consent_token, guardian_name, guardian_phone, message=message
    )
    return {
        "status": "pending",
        "message": "보호자 동의 요청을 발송했습니다. " + GUARDIAN_ONCE_NOTICE,
        "consent_url": notify.get("consent_url"),  # mock — FE 가 테스트모드에서 바로 표시
    }


# ---------------------------------------------------------------------------
# POST /verify — 얼굴 대조 (photo 필수 + selfie 선택: 최초 등록·재촬영)
# ---------------------------------------------------------------------------


@router.post("/verify")
async def face_verify(
    photo: UploadFile = File(...),
    selfie: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
    conn=Depends(get_pg),
):
    """얼굴 대조 플로우 (PLAN v135 + v136 라이브니스):

    v136: aws 모드에서 session_id(Face Liveness 세션) 제공 시 —
      GetFaceLivenessSessionResults 로 confidence·참조 이미지 조회 →
      confidence < threshold → {verified:false, reason:'liveness_failed'} (재시도 유도) /
      통과 → 참조 이미지를 selfie 로 삼아 아래 기존 흐름 그대로.
      mock 모드는 session_id 무시(기존 selfie 파일 경로 — 하위호환).
    ① 저장 얼굴 有 → compare(저장, photo): match → 검증 기록 {verified, method:'stored'} /
      mismatch(셀피 없음) → {verified:false, reason:'stored_mismatch', need_recapture:true}
    ② selfie 제공(최초 등록·재촬영) → compare(selfie, photo): match → 저장 갱신+기록
      {verified, method:'live'} / mismatch → {verified:false, reason:'live_mismatch'} 이용불가.
    촬영 원본은 처리 후 즉시 폐기(디스크 저장 금지 — 암호화 저장분 제외).
    """
    if not settings.face_verify_enabled:
        return _disabled_response()
    user_id = _uid(current_user)
    user = await _fetch_user(conn, user_id)
    if not user:
        return JSONResponse(status_code=404, content={"error": "사용자를 찾을 수 없습니다."})
    if not user["is_verified"]:
        return JSONResponse(
            status_code=403,
            content={"error": "identity_verification_required", "message": "본인인증 완료 후 이용할 수 있습니다."},
        )

    # 동의 게이트 — 성인: 본인 동의 / 미성년: 보호자 동의(완료 시 아동 계정에 동의 append 됨)
    consent = await _latest_face_consent(conn, user_id)
    if not (consent and consent["agreed"]):
        minor = _is_minor(user["birth_date"])
        return JSONResponse(
            status_code=403,
            content={
                "error": "guardian_consent_required" if minor else "face_consent_required",
                "message": "보호자 동의가 필요합니다." if minor else "얼굴 인증(생체정보 처리) 동의가 필요합니다.",
            },
        )

    photo_bytes = await photo.read()
    if not photo_bytes or len(photo_bytes) > MAX_FACE_IMAGE_SIZE:
        return JSONResponse(
            status_code=400, content={"error": "사진은 10MB 이하이며 비어있을 수 없습니다."}
        )
    selfie_bytes = None
    if selfie is not None:
        selfie_bytes = await selfie.read()
        if not selfie_bytes or len(selfie_bytes) > MAX_FACE_IMAGE_SIZE:
            return JSONResponse(
                status_code=400, content={"error": "촬영 이미지는 10MB 이하이며 비어있을 수 없습니다."}
            )

    # v136: 라이브니스 세션 경로 — aws 모드에서만. 참조 이미지가 selfie 를 대체한다.
    #       mock 모드는 session_id 를 무시하고 기존 selfie 파일 경로 유지(하위호환).
    session_id = (session_id or "").strip()
    if session_id and fv.get_mode() == "aws":
        try:
            live = await fv.get_liveness_result(session_id)
        except fv.LivenessSessionError as e:
            return JSONResponse(status_code=400, content={"error": str(e)})
        status = live.get("status")
        confidence = float(live.get("confidence") or 0.0)
        logger.info(
            "[face-verify] liveness session=%s confidence=%.1f",
            session_id[:8], confidence,
        )
        if status in ("CREATED", "IN_PROGRESS"):
            # 실측(v136): 검사 미수행 세션은 Status=CREATED, Confidence/참조 이미지 없음
            return JSONResponse(
                status_code=400,
                content={
                    "error": "liveness_not_completed",
                    "message": "실물 검사가 완료되지 않았습니다. 검사를 마친 후 다시 시도해주세요.",
                },
            )
        if status == "EXPIRED":
            return JSONResponse(status_code=400, content={"error": fv.LIVENESS_SESSION_INVALID_MSG})
        if status != "SUCCEEDED" or confidence < float(settings.face_liveness_confidence_threshold):
            # FAILED 또는 confidence 미달 — 재시도 유도(200)
            return {
                "verified": False,
                "reason": "liveness_failed",
                "confidence": confidence,
                "message": "실물 확인에 실패했습니다. 다시 시도해주세요.",
            }
        ref_bytes = live.get("reference_image_bytes")
        if not ref_bytes:
            return JSONResponse(status_code=400, content={"error": fv.LIVENESS_SESSION_INVALID_MSG})
        selfie_bytes = bytes(ref_bytes)

    sha = fv.photo_sha256(photo_bytes)
    user_tag = str(user_id)[:8]

    async def _record_verification():
        await conn.execute(
            """INSERT INTO face_photo_verifications (user_id, photo_sha256) VALUES ($1, $2)
               ON CONFLICT (user_id, photo_sha256) DO NOTHING""",
            user_id, sha,
        )

    # ① 저장 얼굴과 즉시 매칭
    stored_bytes = await fv.load_face(conn, user_id)
    if stored_bytes is not None:
        try:
            result = await fv.compare_faces(stored_bytes, photo_bytes)
        except fv.FaceCompareError as e:
            return JSONResponse(status_code=400, content={"error": str(e)})
        finally:
            del stored_bytes
        logger.info(
            "[face-verify] verify stored user=%s photo_sha=%s match=%s mode=%s",
            user_tag, sha[:8], result["match"], result["mode"],
        )
        if result["match"]:
            await _record_verification()
            return {"verified": True, "method": "stored", "similarity": result["similarity"]}
        if selfie_bytes is None:
            return {
                "verified": False,
                "reason": "stored_mismatch",
                "need_recapture": True,
                "message": "저장된 얼굴 정보와 일치하지 않습니다. 본인 확인을 위해 실시간 촬영이 필요합니다.",
            }
        # 재촬영 셀피가 함께 온 경우 → ② live 재검증으로 진행

    # ② 최초 등록 / 재촬영 — 셀피 vs 사진 대조
    if selfie_bytes is None:
        return JSONResponse(
            status_code=400,
            content={"error": "selfie_required", "message": "최초 등록에는 실시간 촬영 이미지가 필요합니다."},
        )
    if not fv.encryption_ready():
        return JSONResponse(
            status_code=503,
            content={"error": "face_key_missing", "message": "얼굴 데이터 암호화 키가 설정되지 않아 등록할 수 없습니다."},
        )
    try:
        result = await fv.compare_faces(selfie_bytes, photo_bytes)
    except fv.FaceCompareError as e:
        del selfie_bytes  # 촬영 원본 즉시 폐기
        return JSONResponse(status_code=400, content={"error": str(e)})
    logger.info(
        "[face-verify] verify live user=%s photo_sha=%s match=%s mode=%s",
        user_tag, sha[:8], result["match"], result["mode"],
    )
    if not result["match"]:
        del selfie_bytes  # 촬영 원본 즉시 폐기
        return {
            "verified": False,
            "reason": "live_mismatch",
            "message": "실시간 촬영 얼굴과 사진 속 얼굴이 일치하지 않아 이용할 수 없습니다.",
        }
    stored_ok = await fv.store_face(conn, user_id, selfie_bytes)
    del selfie_bytes  # 촬영 원본 즉시 폐기 (암호화 저장분 제외)
    if not stored_ok:
        return JSONResponse(
            status_code=503,
            content={"error": "face_store_failed", "message": "얼굴 정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요."},
        )
    await _record_verification()
    return {"verified": True, "method": "live", "similarity": result["similarity"]}


# ---------------------------------------------------------------------------
# POST /session — AWS Face Liveness 세션 골격 (FE Amplify 통합 전 미사용)
# ---------------------------------------------------------------------------


@router.post("/session")
async def face_liveness_session(current_user=Depends(get_current_user)):
    """Face Liveness 세션 생성 — aws 모드: 도쿄 리전 실호출, mock: mock 세션 id."""
    if not settings.face_verify_enabled:
        return _disabled_response()
    session = await create_session_safe()
    logger.info(
        "[face-verify] session user=%s mode=%s", str(current_user["id"])[:8], session["mode"]
    )
    return session


async def create_session_safe() -> dict:
    try:
        return await fv.create_liveness_session()
    except Exception as e:
        logger.error("[face-verify] session create failed err=%s", str(e)[:150])
        return {"session_id": None, "mode": fv.get_mode(), "error": "세션 생성에 실패했습니다."}


# ---------------------------------------------------------------------------
# DELETE / — 동의 철회 + 데이터 전체 파기
# ---------------------------------------------------------------------------


@router.delete("")
async def face_verify_withdraw(current_user=Depends(get_current_user), conn=Depends(get_pg)):
    """철회 — user_consents 철회(agreed=false) append + 얼굴 데이터(PG·MinIO) 전체 파기.

    재이용 시 동의부터 다시 진행해야 한다 (미성년은 보호자 동의부터).
    """
    user_id = _uid(current_user)
    consent = await _latest_face_consent(conn, user_id)
    version = (consent["version"] if consent else None) or "v1.0"
    await _record_face_consent(conn, user_id, False, version)
    purge = await fv.delete_face_data(conn, user_id)
    return {
        "withdrawn": True,
        "purged": purge,
        "message": "얼굴 인증 동의가 철회되었으며 저장된 얼굴 정보가 모두 파기되었습니다.",
    }
