"""v161 — Claude prompt-caching 공통 헬퍼 (cache_control 블록 조립 + [cache] 사용량 로깅).

원칙 (PLAN v161 설계 5):
- system 프롬프트를 [고정부 | 변동부] 블록 리스트로 분리하고, 고정부(반드시 앞)에만
  ``cache_control: {"type": "ephemeral"}`` (5분 TTL) 를 부착한다 — prefix 일치가 캐시 키.
- 고정부에 timestamp / uuid / 현재 날짜 삽입 금지. dict 를 프롬프트에 직렬화할 때는
  ``json.dumps(..., sort_keys=True)`` 로 결정적 직렬화를 지켜야 캐시가 무효화되지 않는다.
- 모델별 최소 캐시 길이 미달 시 마커는 에러 없이 조용히 무시된다(무과금·무해) —
  ``log_cache_usage`` 의 create=0/read=0 이 미달의 실측 증거가 된다.
- [cache] 로깅은 적용/비적용 무관 모든 Claude 호출부(7곳)에 부착한다.
  stream 호출은 final message 의 usage 로 로깅한다.
"""

import logging

logger = logging.getLogger(__name__)


def cached_system(fixed_text: str, variable_text: str = "") -> list:
    """system 문자열을 cache_control 블록 리스트로 변환한다.

    - ``fixed_text`` (고정부): 첫 블록, ``cache_control: ephemeral`` 부착.
    - ``variable_text`` (변동부, optional): 두 번째 블록, 마커 없음.

    고정부가 반드시 앞이어야 prefix 캐시가 성립한다. 최종 렌더 텍스트는
    ``fixed_text + variable_text`` 단일 문자열 system 과 의미 동일 (블록 경계만 추가).
    """
    blocks = [
        {
            "type": "text",
            "text": fixed_text,
            "cache_control": {"type": "ephemeral"},
        }
    ]
    if variable_text:
        blocks.append({"type": "text", "text": variable_text})
    return blocks


def log_cache_usage(stage: str, model: str, usage) -> None:
    """[cache] 사용량 로그. 어떤 경우에도 raise 하지 않는다.

    usage: anthropic 응답의 ``response.usage`` (stream 은 ``get_final_message().usage``).
    create = cache_creation_input_tokens (캐시 쓰기, ~1.25배 과금)
    read   = cache_read_input_tokens     (캐시 읽기, ~0.1배 과금)
    input  = input_tokens                (비캐시 입력, 정가)
    """
    try:
        create = getattr(usage, "cache_creation_input_tokens", None) or 0
        read = getattr(usage, "cache_read_input_tokens", None) or 0
        inp = getattr(usage, "input_tokens", None) or 0
        logger.info(
            "[cache] stage=%s model=%s create=%d read=%d input=%d",
            stage, model, int(create), int(read), int(inp),
        )
    except Exception as e:  # noqa: BLE001 — 로깅 실패가 호출 흐름을 깨면 안 됨
        logger.debug("[cache] stage=%s usage log failed: %s", stage, str(e)[:120])
