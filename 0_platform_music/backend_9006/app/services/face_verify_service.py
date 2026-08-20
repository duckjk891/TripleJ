"""FaceGuardSquad(v135) — 얼굴 인증(생체 대조) 어댑터 서비스.

A안: AWS Rekognition CompareFaces(서울 ap-northeast-2) + Face Liveness(도쿄 ap-northeast-1).
mode 판정: AWS 키 쌍이 모두 설정되면 aws, 아니면 mock — 키를 꽂으면 코드 수정 없이 동작.

- compare_faces(source, target): aws → boto3 CompareFaces(threshold), mock → SHA256 동일 여부.
  FACE_MOCK_FORCE(off|match|mismatch) 는 mock 모드에서만 판정을 오버라이드(테스트용).
- create_liveness_session()/get_liveness_result(): aws liveness 골격(FE Amplify 통합 전 미사용),
  mock 은 FE 첨부 셀피를 사용하므로 reference_image_bytes=None.
- 저장 얼굴: Fernet(FACE_DATA_KEY) 암호화 → MinIO {images bucket}/faces/{user_id}.bin.
  키 빈값이면 기동 경고 + 저장/로드 불가(mock 전용). 촬영 원본은 대조·저장 후 즉시 메모리
  폐기 — 디스크 저장 금지(암호화 저장분 제외).

로그 규칙: [face-verify] prefix, user·photo_sha 는 앞 8자만. 이미지 바이트·전체 해시·키 로그 금지.
"""

import asyncio
import hashlib
import io
import logging
import uuid
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings
from ..database.minio import get_minio

logger = logging.getLogger(__name__)

# 저장 얼굴 MinIO 경로 prefix — 백엔드 전용. 이미지 프록시/presign 라우트에서 차단됨.
FACE_OBJECT_PREFIX = "faces/"


class LivenessSessionError(Exception):
    """v136: 라이브니스 세션 무효(미존재/만료/형식오류) — str() 이 사용자 노출용 정리 메시지.

    boto 예외 원문(HTML/스택/AWS 메시지)은 라우트 응답에 노출하지 않기 위한 래핑.
    """


class FaceCompareError(Exception):
    """v136: CompareFaces 입력 오류(얼굴 미검출/이미지 형식) — str() 이 사용자 노출용 정리 메시지."""


LIVENESS_SESSION_INVALID_MSG = "라이브니스 세션이 유효하지 않습니다. 다시 시도해주세요."


def _aws_error_code(e: Exception) -> str:
    """botocore ClientError 의 Error.Code — 그 외 예외는 빈 문자열."""
    try:
        return (getattr(e, "response", None) or {}).get("Error", {}).get("Code", "") or ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# 어댑터 판정 / 기동 점검
# ---------------------------------------------------------------------------


def get_mode() -> str:
    """aws(키 쌍 모두 존재) | mock."""
    if settings.aws_face_access_key_id and settings.aws_face_secret_access_key:
        return "aws"
    return "mock"


def _get_fernet() -> Optional[Fernet]:
    """FACE_DATA_KEY 로 Fernet 인스턴스 생성 — 빈값/무효면 None (키 값 로그 금지)."""
    key = (settings.face_data_key or "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode())
    except Exception:
        logger.error("[face-verify] FACE_DATA_KEY 형식이 올바르지 않습니다 — 저장 얼굴 암호화 불가")
        return None


def startup_check() -> None:
    """서버 기동 시 상태 로그 — 키 없으면 경고(mock 전용)."""
    mode = get_mode()
    if settings.face_verify_enabled and _get_fernet() is None:
        logger.warning(
            "[face-verify] FACE_DATA_KEY 미설정 — 저장 얼굴 암호화 불가, 등록이 필요한 플로우는 동작하지 않습니다"
        )
    logger.info("[face-verify] startup enabled=%s mode=%s", settings.face_verify_enabled, mode)


def photo_sha256(photo_bytes: bytes) -> str:
    return hashlib.sha256(photo_bytes).hexdigest()


# ---------------------------------------------------------------------------
# AWS Rekognition 클라이언트 (모듈 레벨 분리 — 키 꽂으면 그대로 동작)
# ---------------------------------------------------------------------------


def _rekognition_client(region: str):
    import boto3

    return boto3.client(
        "rekognition",
        region_name=region,
        aws_access_key_id=settings.aws_face_access_key_id,
        aws_secret_access_key=settings.aws_face_secret_access_key,
    )


async def compare_faces(source_bytes: bytes, target_bytes: bytes) -> dict:
    """두 얼굴 이미지 대조 → {match, similarity, mode}.

    aws: CompareFaces(SimilarityThreshold=FACE_MATCH_THRESHOLD) 최고 유사도 기준.
    mock: SHA256 동일=match. FACE_MOCK_FORCE(match|mismatch) 오버라이드(테스트용).
    """
    if get_mode() == "mock":
        force = (settings.face_mock_force or "off").strip().lower()
        if force == "match":
            return {"match": True, "similarity": 100.0, "mode": "mock-force"}
        if force == "mismatch":
            return {"match": False, "similarity": 0.0, "mode": "mock-force"}
        same = hashlib.sha256(source_bytes).digest() == hashlib.sha256(target_bytes).digest()
        return {"match": same, "similarity": 100.0 if same else 0.0, "mode": "mock"}

    def _call():
        client = _rekognition_client(settings.face_compare_region)
        try:
            resp = client.compare_faces(
                SourceImage={"Bytes": source_bytes},
                TargetImage={"Bytes": target_bytes},
                SimilarityThreshold=float(settings.face_match_threshold),
            )
        except Exception as e:
            code = _aws_error_code(e)
            # 얼굴 미검출/이미지 형식 오류 — 사용자 입력 문제라 정리된 400 으로 안내(v136)
            if code in ("InvalidParameterException", "InvalidImageFormatException", "ImageTooLargeException"):
                logger.info("[face-verify] compare input rejected code=%s", code)
                raise FaceCompareError("이미지에서 얼굴을 인식할 수 없습니다. 얼굴이 선명한 사진으로 다시 시도해주세요.")
            logger.error("[face-verify] compare failed code=%s err=%s", code, str(e)[:150])
            raise
        matches = resp.get("FaceMatches") or []
        best = max((float(m.get("Similarity") or 0.0) for m in matches), default=0.0)
        return {
            "match": best >= float(settings.face_match_threshold),
            "similarity": best,
            "mode": "aws",
        }

    return await asyncio.to_thread(_call)


async def create_liveness_session() -> dict:
    """Face Liveness 세션 생성 → {session_id, mode}.

    aws: 도쿄 리전 CreateFaceLivenessSession (FE Amplify FaceLivenessDetector 통합 전 미사용 골격).
    mock: "mock-" prefix 세션 id — FE 는 getUserMedia 촬영 셀피를 /verify 에 직접 첨부.
    """
    if get_mode() == "mock":
        return {"session_id": "mock-" + uuid.uuid4().hex, "mode": "mock"}

    def _call():
        client = _rekognition_client(settings.face_liveness_region)
        resp = client.create_face_liveness_session()
        return {"session_id": resp["SessionId"], "mode": "aws"}

    return await asyncio.to_thread(_call)


async def get_liveness_result(session_id: str) -> dict:
    """Liveness 세션 결과 정규화 → {status, confidence, reference_image_bytes, mode}.

    aws: GetFaceLivenessSessionResults (도쿄) — 실측(v136): 검사 미수행(CREATED) 세션은
    Status="CREATED" 에 Confidence/ReferenceImage 없음, SUCCEEDED 시 ReferenceImage 는
    S3 미설정이라 Bytes 로 옴. 미존재 세션 SessionNotFoundException, 형식 오류(36자 미만)는
    client-side ParamValidationError → 모두 LivenessSessionError 로 정리(원문 미노출).
    mock: SUCCEEDED/100.0/reference 없음 (FE 첨부 셀피를 사용).
    """
    if get_mode() == "mock" or (session_id or "").startswith("mock-"):
        return {"status": "SUCCEEDED", "confidence": 100.0, "reference_image_bytes": None, "mode": "mock"}

    def _call():
        client = _rekognition_client(settings.face_liveness_region)
        try:
            resp = client.get_face_liveness_session_results(SessionId=session_id)
        except Exception as e:
            code = _aws_error_code(e)
            if code in ("SessionNotFoundException", "ValidationException") or type(e).__name__ == "ParamValidationError":
                logger.info(
                    "[face-verify] liveness session invalid session=%s code=%s",
                    (session_id or "")[:8], code or type(e).__name__,
                )
                raise LivenessSessionError(LIVENESS_SESSION_INVALID_MSG)
            logger.error(
                "[face-verify] liveness result failed session=%s code=%s err=%s",
                (session_id or "")[:8], code, str(e)[:150],
            )
            raise
        confidence = resp.get("Confidence")
        return {
            "status": resp.get("Status"),
            "confidence": float(confidence) if confidence is not None else None,
            "reference_image_bytes": (resp.get("ReferenceImage") or {}).get("Bytes"),
            "mode": "aws",
        }

    return await asyncio.to_thread(_call)


# ---------------------------------------------------------------------------
# 저장 얼굴 (Fernet 암호화 → MinIO faces/{user_id}.bin + PG face_biometrics)
# ---------------------------------------------------------------------------


def _face_object_name(user_id) -> str:
    return "{}{}.bin".format(FACE_OBJECT_PREFIX, user_id)


def encryption_ready() -> bool:
    return _get_fernet() is not None


async def store_face(conn, user_id, image_bytes: bytes) -> bool:
    """얼굴 이미지 암호화 저장(등록/갱신). FACE_DATA_KEY 없으면 False."""
    fernet = _get_fernet()
    if fernet is None:
        logger.warning("[face-verify] store skipped key_missing user=%s", str(user_id)[:8])
        return False
    encrypted = fernet.encrypt(image_bytes)
    object_name = _face_object_name(user_id)

    def _put():
        get_minio().put_object(
            bucket_name=settings.minio_bucket_images,
            object_name=object_name,
            data=io.BytesIO(encrypted),
            length=len(encrypted),
            content_type="application/octet-stream",
        )

    await asyncio.to_thread(_put)
    await conn.execute(
        """INSERT INTO face_biometrics (user_id, object_name) VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET object_name = EXCLUDED.object_name, updated_at = now()""",
        user_id, object_name,
    )
    logger.info("[face-verify] face stored user=%s", str(user_id)[:8])
    return True


async def load_face(conn, user_id) -> Optional[bytes]:
    """저장 얼굴 복호화 로드 — 미등록/키 없음/복호화 실패 시 None."""
    row = await conn.fetchrow(
        "SELECT object_name FROM face_biometrics WHERE user_id = $1", user_id
    )
    if not row:
        return None
    fernet = _get_fernet()
    if fernet is None:
        logger.warning("[face-verify] load skipped key_missing user=%s", str(user_id)[:8])
        return None

    def _get():
        resp = get_minio().get_object(
            bucket_name=settings.minio_bucket_images, object_name=row["object_name"]
        )
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    try:
        encrypted = await asyncio.to_thread(_get)
    except Exception as e:
        logger.warning("[face-verify] load minio failed user=%s err=%s", str(user_id)[:8], str(e)[:120])
        return None
    try:
        return fernet.decrypt(encrypted)
    except InvalidToken:
        logger.error("[face-verify] decrypt failed (키 변경 가능성) user=%s", str(user_id)[:8])
        return None


async def delete_face_data(conn, user_id) -> dict:
    """철회 파기 — MinIO bin + face_biometrics + face_photo_verifications 전체 삭제."""
    row = await conn.fetchrow(
        "SELECT object_name FROM face_biometrics WHERE user_id = $1", user_id
    )
    minio_removed = False
    if row:
        try:
            await asyncio.to_thread(
                get_minio().remove_object, settings.minio_bucket_images, row["object_name"]
            )
            minio_removed = True
        except Exception as e:
            logger.warning(
                "[face-verify] withdraw minio remove failed user=%s err=%s",
                str(user_id)[:8], str(e)[:120],
            )
    await conn.execute("DELETE FROM face_biometrics WHERE user_id = $1", user_id)
    result = await conn.execute("DELETE FROM face_photo_verifications WHERE user_id = $1", user_id)
    try:
        verifications_deleted = int(result.split()[-1])
    except Exception:
        verifications_deleted = 0
    logger.info(
        "[face-verify] withdraw purge user=%s biometric=%s minio=%s verifications=%d",
        str(user_id)[:8], bool(row), minio_removed, verifications_deleted,
    )
    return {
        "biometric_deleted": bool(row),
        "minio_removed": minio_removed,
        "verifications_deleted": verifications_deleted,
    }


# ---------------------------------------------------------------------------
# 캐릭터 생성 게이트 (routes/character.py 실사화 경로에서 호출)
# ---------------------------------------------------------------------------


async def is_photo_verified(user_id_str: str, photo_bytes: bytes) -> bool:
    """flag ON 실사화 게이트 — photo SHA256 이 face_photo_verifications 에 있으면 통과."""
    sha = photo_sha256(photo_bytes)
    from ..database import postgres as _pg

    async with _pg._pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM face_photo_verifications WHERE user_id = $1 AND photo_sha256 = $2",
            uuid.UUID(str(user_id_str)), sha,
        )
    verified = bool(row)
    logger.info(
        "[face-verify] gate user=%s photo_sha=%s verified=%s",
        str(user_id_str)[:8], sha[:8], verified,
    )
    return verified
