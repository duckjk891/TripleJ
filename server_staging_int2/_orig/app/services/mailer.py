"""v3.207 ⑦ — 비밀번호 재설정 메일 어댑터 (AWS SES).

배포 경로: app/services/mailer.py

전송 수단: AWS SES(sesv2, boto3 — 서버 의존성 기존 보유, 얼굴인증 Rekognition
사용 중). IAM 자격은 **boto3 기본 체인(EC2 인스턴스 롤 maidol-ec2 → 환경변수)**
— 코드/설정에 키 하드코딩 금지. region·발신 주소는 settings(.env SES_REGION /
MAIL_FROM)로만 참조.

**dev 폴백**: settings.mail_enabled=false(기본) 이거나 SES 발신이 실패하면
(자격 미구성·샌드박스 미검증 수신자 거부 포함) 예외로 죽지 않고 서버 로그에
코드를 기록한다 — 테스트 항목 6 "dev 모드에서 로그 코드로 E2E" 의 설계된
유일한 코드 로그 예외. 실발송 성공 경로에서는 코드 값 미로그.

인터페이스 (호출부 auth.py — 구현 교체 시에도 시그니처 유지, 예외 미전파):
  - await send_password_reset_email(email, code) -> {"sent": bool, "method": "ses"|"dev"}
  - await send_password_reset_social_notice(email) -> {"sent": bool, "method": "ses"|"dev"}

boto3 SES 호출은 블로킹 — run_in_executor 로 이벤트루프 밖에서 실행.
로그 규칙: prefix [mailer], 이메일은 마스킹(앞2자+도메인)만. 발신 실패는
logger.warning + dev 폴백, 성공은 logger.info.
"""

import asyncio
import functools
import logging

from ..config import settings

logger = logging.getLogger(__name__)

_ses_client = None

_RESET_SUBJECT = "[MAIDOL] 비밀번호 재설정 인증 코드"
_RESET_BODY_TEMPLATE = (
    "안녕하세요, MAIDOL 입니다.\n\n"
    "비밀번호 재설정 인증 코드는 아래와 같습니다.\n\n"
    "인증 코드: {code}\n\n"
    "이 코드는 {ttl_minutes}분 동안만 유효합니다.\n"
    "본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 변경되지 않습니다.\n"
)

_SOCIAL_SUBJECT = "[MAIDOL] 비밀번호 재설정 안내"
_SOCIAL_BODY = (
    "안녕하세요, MAIDOL 입니다.\n\n"
    "요청하신 계정은 소셜 로그인(구글/카카오/네이버)으로 가입된 계정으로,\n"
    "별도의 비밀번호가 없습니다. 가입하신 소셜 계정으로 로그인해주세요.\n\n"
    "본인이 요청하지 않았다면 이 메일을 무시해주세요.\n"
)


def _mask_email(email: str) -> str:
    """이메일 로그 마스킹 (앞2자 + 도메인만) — auth._mask_email 과 동일 규칙."""
    if not email or "@" not in email:
        return "?"
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}"


def _get_ses_client():
    """sesv2 클라이언트 lazy 싱글턴 — 자격은 boto3 기본 체인(인스턴스 롤 우선).

    import/생성 실패는 호출부(_send)에서 dev 폴백으로 수렴하도록 전파.
    """
    global _ses_client
    if _ses_client is None:
        import boto3
        from botocore.config import Config as BotoConfig

        _ses_client = boto3.client(
            "sesv2",
            region_name=settings.ses_region,
            config=BotoConfig(
                connect_timeout=5, read_timeout=10, retries={"max_attempts": 1}
            ),
        )
    return _ses_client


def _send_ses_sync(to_email: str, subject: str, body: str) -> None:
    """블로킹 SES 발신 — executor 에서만 호출. 실패는 예외 전파(호출부 폴백)."""
    _get_ses_client().send_email(
        FromEmailAddress=settings.mail_from,
        Destination={"ToAddresses": [to_email]},
        Content={
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            }
        },
    )


async def _try_send(to_email: str, subject: str, body: str, kind: str) -> bool:
    """SES 발신 시도 — 성공 True. mail_enabled=false 또는 실패 시 False(예외 미전파)."""
    masked = _mask_email(to_email)
    if not settings.mail_enabled:
        logger.info("[mailer] mail disabled (dev mode) kind=%s email=%s", kind, masked)
        return False
    logger.info("[mailer] ses send start kind=%s email=%s region=%s", kind, masked, settings.ses_region)
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, functools.partial(_send_ses_sync, to_email, subject, body)
        )
    except Exception as e:
        # 자격 미구성·샌드박스 수신자 거부·네트워크 등 — 죽지 않고 dev 폴백.
        logger.warning(
            "[mailer] ses send failed kind=%s email=%s err=%s — dev 폴백",
            kind, masked, str(e)[:200],
        )
        return False
    logger.info("[mailer] ses send ok kind=%s email=%s", kind, masked)
    return True


async def send_password_reset_email(email: str, code: str) -> dict:
    """재설정 코드 메일 발송. 미구성/실패 시 dev 폴백 — 서버 로그에 코드 기록."""
    body = _RESET_BODY_TEMPLATE.format(
        code=code, ttl_minutes=settings.password_reset_code_ttl_minutes
    )
    if await _try_send(email, _RESET_SUBJECT, body, kind="reset"):
        return {"sent": True, "method": "ses"}
    # dev 폴백 — 설계된 유일한 코드 로그(테스트 항목 6). 실발송 성공 시 미도달.
    logger.info(
        "[mailer] DEV MODE password-reset code=%s email=%s (실발송 없음)",
        code, _mask_email(email),
    )
    return {"sent": True, "method": "dev"}


async def send_password_reset_social_notice(email: str) -> dict:
    """소셜 전용 계정(password_hash NULL) 안내 메일 — 코드 미발급.

    계정 존재 여부는 API 응답이 아니라 메일로만 전달(존재 비노출 정책).
    """
    if await _try_send(email, _SOCIAL_SUBJECT, _SOCIAL_BODY, kind="social"):
        return {"sent": True, "method": "ses"}
    logger.info(
        "[mailer] DEV MODE social-account notice email=%s (실발송 없음)",
        _mask_email(email),
    )
    return {"sent": True, "method": "dev"}
