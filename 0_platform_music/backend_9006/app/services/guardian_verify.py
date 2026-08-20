"""GuardSquad — 보호자 본인인증 어댑터.

인터페이스: verify_guardian_identity(consent_token, guardian_name, guardian_phone)
→ {"verified": bool, "method": str}

현재 구현은 mock — 실제 본인인증(PASS/휴대폰 인증 등) 대신 로그만 남기고
즉시 통과시킨다. 실서비스 전환 시 이 함수의 본문만 교체하면 된다.

로그 규칙: token 은 앞 8자만, guardian_name/guardian_phone 은 값 금지(길이만).
"""

import logging

logger = logging.getLogger(__name__)


async def verify_guardian_identity(
    consent_token: str, guardian_name: str = "", guardian_phone: str = ""
) -> dict:
    """보호자 본인인증 — mock: 로그 + 즉시 통과."""
    logger.info(
        "[guardian] verify mock pass token=%s name_len=%d phone_len=%d",
        consent_token[:8], len(guardian_name or ""), len(guardian_phone or ""),
    )
    return {"verified": True, "method": "mock"}
