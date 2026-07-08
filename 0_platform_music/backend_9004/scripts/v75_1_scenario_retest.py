"""v75.1 — scenario truncation 정정 후 재검증.

max_tokens / max_completion_tokens 를 8000 → 32000 으로 확대한 뒤
시나리오 두 경로가 200 OK + 본문 파싱 성공하는지만 빠르게 확인.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import traceback

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("v75_1_retest")


async def _run(name, coro):
    t0 = time.time()
    try:
        r = await coro
        elapsed = int((time.time() - t0) * 1000)
        if isinstance(r, dict):
            narr_len = len(r.get("narrative", "") or "")
            events_n = len(r.get("events", []) or [])
            body_len = len(r.get("scenario", "") or "")
            summary = f"narrative={narr_len} events={events_n} body={body_len}"
        else:
            summary = f"type={type(r).__name__}"
        logger.info("[STEP_OK] %s elapsed_ms=%d %s", name, elapsed, summary)
        return True, elapsed, summary
    except Exception as e:  # noqa: BLE001
        elapsed = int((time.time() - t0) * 1000)
        logger.error("[STEP_ERR] %s elapsed_ms=%d err=%s", name, elapsed, str(e)[:300])
        logger.error("traceback:\n%s", traceback.format_exc()[:1500])
        return False, elapsed, str(e)[:300]


async def main():
    from app.services.mv_generator import (
        _generate_scenario_claude,
        _generate_scenario_openai,
    )

    common = dict(
        title="봄날의 산책",
        genre="ballad",
        mood="peaceful",
        lyrics="[Verse]\n봄바람이 불어와\n[Chorus]\n함께 걷자 우리",
        character_name="민지",
        temperature=0.85,
        strict=False,
    )

    results = []
    results.append(
        ("anthropic/scenario",) + await _run(
            "anthropic/scenario",
            _generate_scenario_claude(**common, model_name="claude-opus-4-6"),
        )
    )
    results.append(
        ("openai/scenario",) + await _run(
            "openai/scenario",
            _generate_scenario_openai(**common),
        )
    )

    print("\n=========== V75.1 SCENARIO RETEST SUMMARY ===========")
    n_ok = sum(1 for r in results if r[1])
    for name, ok, elapsed, summary in results:
        flag = "OK" if ok else "FAIL"
        print(f"[{flag}] {name:30s} elapsed_ms={elapsed:6d}  {summary[:200]}")
    print(f"\nTotal: {n_ok}/{len(results)} OK")
    return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(rc)
