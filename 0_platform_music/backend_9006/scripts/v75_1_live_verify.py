"""v75.1 — 모델별 API 호출 라이브 검증 스크립트.

PLAN/REPORT v75.1 의 4단계 테스터 작업을 자동화한다.
- Anthropic: translation / lyrics / scenario 각 1회
- OpenAI: lyrics / scenario / brainstorm 각 1회
- 각 호출 status (200/예외), 응답 길이, 모델 ID 로그 발생 여부 출력.

사용:
    cd backend_9005
    venv/bin/python scripts/v75_1_live_verify.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import traceback

# v75.1 — 프로젝트 루트(app/) 가 PYTHONPATH 에 있도록 보정
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# .env 로드
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
except Exception:
    pass

# 로깅 — INFO 레벨 + ThinkingOn/ReasoningOn 보이게
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("v75_1_verify")


async def _run_step(name: str, coro):
    """Run a coroutine, return (ok, elapsed_ms, summary_or_err)."""
    t0 = time.time()
    try:
        result = await coro
        elapsed = int((time.time() - t0) * 1000)
        # Summarize
        if isinstance(result, str):
            summary = f"str len={len(result)} head={result[:80]!r}"
        elif isinstance(result, dict):
            keys = list(result.keys())[:8]
            summary = f"dict keys={keys}"
        elif isinstance(result, list):
            summary = f"list len={len(result)} head={str(result[0])[:80] if result else '<empty>'}"
        else:
            summary = f"type={type(result).__name__}"
        logger.info("[STEP_OK] %s elapsed_ms=%d %s", name, elapsed, summary)
        return True, elapsed, summary
    except Exception as e:  # noqa: BLE001
        elapsed = int((time.time() - t0) * 1000)
        err_short = str(e)[:300]
        logger.error("[STEP_ERR] %s elapsed_ms=%d err=%s", name, elapsed, err_short)
        logger.error("traceback:\n%s", traceback.format_exc()[:1500])
        return False, elapsed, err_short


async def main():
    # ---- Imports ----
    from app.services.translation import translate_ko_to_en
    from app.services.lyrics_generator import (
        _generate_lyrics_openai,
        _generate_lyrics_claude,
    )
    from app.services.mv_generator import (
        _generate_brainstorm_openai,
        _generate_scenario_openai,
        _generate_scenario_claude,
    )

    results = []

    # ===== Anthropic 측 (claude-opus-4-7) =====
    # 1) translation
    results.append(
        ("anthropic/translation",) + await _run_step(
            "anthropic/translation",
            translate_ko_to_en(
                "노을 진 바닷가에서 두 사람이 손을 잡고 천천히 걷는다.",
                context_hint="visual/video prompt",
            ),
        )
    )

    # 2) lyrics claude (opus-4-6 default in source)
    results.append(
        ("anthropic/lyrics",) + await _run_step(
            "anthropic/lyrics",
            _generate_lyrics_claude(
                prompt="첫사랑의 설렘",
                genre="ballad",
                mood="dreamy",
                style=None,
                duration_minutes=1,
                duet=False,
                duet_main_vocal_style=None,
                duet_sub_vocal_style=None,
                language="ko",
                model_name="claude-opus-4-6",
            ),
        )
    )

    # 3) scenario claude
    results.append(
        ("anthropic/scenario",) + await _run_step(
            "anthropic/scenario",
            _generate_scenario_claude(
                title="봄날의 산책",
                genre="ballad",
                mood="peaceful",
                lyrics="[Verse]\n봄바람이 불어와\n[Chorus]\n함께 걷자 우리",
                character_name="민지",
                model_name="claude-opus-4-6",
                temperature=0.85,
                strict=False,
            ),
        )
    )

    # ===== OpenAI 측 (gpt-5.5) =====
    # 4) lyrics openai
    results.append(
        ("openai/lyrics",) + await _run_step(
            "openai/lyrics",
            _generate_lyrics_openai(
                prompt="첫사랑의 설렘",
                genre="pop",
                mood="happy",
                style=None,
                duration_minutes=1,
                duet=False,
                duet_main_vocal_style=None,
                duet_sub_vocal_style=None,
                language="ko",
            ),
        )
    )

    # 5) scenario openai
    results.append(
        ("openai/scenario",) + await _run_step(
            "openai/scenario",
            _generate_scenario_openai(
                title="봄날의 산책",
                genre="pop",
                mood="peaceful",
                lyrics="[Verse]\n봄바람이 불어와\n[Chorus]\n함께 걷자 우리",
                character_name="민지",
                temperature=0.85,
                strict=False,
            ),
        )
    )

    # 6) brainstorm openai
    results.append(
        ("openai/brainstorm",) + await _run_step(
            "openai/brainstorm",
            _generate_brainstorm_openai(
                title="봄날의 산책",
                genre="pop",
                mood="peaceful",
                lyrics="[Verse]\n봄바람이 불어와\n[Chorus]\n함께 걷자 우리",
                vocal_gender="female",
                relationship="solo",
                temperature=0.95,
            ),
        )
    )

    # ---- Summary ----
    print("\n=========== V75.1 LIVE VERIFY SUMMARY ===========")
    n_ok = sum(1 for r in results if r[1])
    for name, ok, elapsed, summary in results:
        flag = "OK" if ok else "FAIL"
        print(f"[{flag}] {name:30s} elapsed_ms={elapsed:6d}  {summary[:160]}")
    print(f"\nTotal: {n_ok}/{len(results)} OK")
    return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(rc)
