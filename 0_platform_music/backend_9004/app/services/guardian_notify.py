"""GuardSquad — 보호자 동의 요청 알림 어댑터.

인터페이스: send_guardian_consent_notification(consent_token, guardian_name, guardian_phone)
→ {"sent": bool, "method": str, "consent_url": str|None}

현재 구현은 mock — 실제 SMS 대신 로그만 남기고 consent_url 을 반환한다
(테스트모드에서 FE 가 이 URL 을 바로 표시). 실서비스 전환 시 이 함수의 본문만
SMS 발송 구현으로 교체하면 된다 (호출부 변경 불필요).

로그 규칙: token 은 앞 8자만, guardian_name/guardian_phone 은 값 금지(길이만).
"""

import logging

from ..config import settings

logger = logging.getLogger(__name__)


async def send_guardian_consent_notification(
    consent_token: str, guardian_name: str, guardian_phone: str, message: str = ""
) -> dict:
    """보호자에게 동의 링크 발송 — mock: 로그 + 즉시 성공, consent_url 반환.

    message: 발송 문구 override(선택) — v135 얼굴 인증 동의는 "1회 동의=계속 이용" 안내를
    포함해 전달한다. 실 SMS 전환 시 이 문구+링크가 문자 본문이 된다.
    """
    consent_url = f"{settings.frontend_url}/guardian-consent/{consent_token}"
    logger.info(
        "[guardian] notify mock sent token=%s name_len=%d phone_len=%d msg_len=%d",
        consent_token[:8], len(guardian_name or ""), len(guardian_phone or ""), len(message or ""),
    )
    return {"sent": True, "method": "mock", "consent_url": consent_url, "message": message or None}
