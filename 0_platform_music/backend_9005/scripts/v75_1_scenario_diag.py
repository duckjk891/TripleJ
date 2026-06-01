"""v75.1 진단 — scenario 호출이 빈 응답을 받는 원인 추적.

raw 길이, stop_reason, usage(thinking_tokens / reasoning_tokens) 출력.
"""

from __future__ import annotations

import asyncio
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
except Exception:
    pass

import anthropic
from openai import AsyncOpenAI

from app.config import settings
from app.services.mv_generator import _build_scenario_prompts_dispatch


async def main():
    common = dict(
        scenario_style="drama",
        title="봄날의 산책",
        genre="ballad",
        mood="peaceful",
        lyrics="[Verse]\n봄바람이 불어와\n[Chorus]\n함께 걷자 우리",
        character_name="민지",
        vocal_gender="female",
        relationship="solo",
        has_user_character=False,
        has_cover_person=False,
        character1_meta=None,
        location_name=None,
        brainstorm_candidates=None,
        audio_duration_sec=None,
        user_event_seed=None,
    )
    system_prompt, user_prompt, is_drama = _build_scenario_prompts_dispatch(**common)
    print(f"is_drama={is_drama}, system_prompt_len={len(system_prompt)}, user_prompt_len={len(user_prompt)}")

    # --- Anthropic ---
    print("\n=== Anthropic claude-opus-4-6 scenario (max_tokens=8000) ===")
    aclient = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    aresp = await aclient.messages.create(
        model="claude-opus-4-6",
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
        max_tokens=8000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
    )
    print(f"stop_reason={aresp.stop_reason}")
    print(f"usage={aresp.usage}")
    text_blocks = [b for b in aresp.content if getattr(b, 'type', None) == 'text']
    thinking_blocks = [b for b in aresp.content if getattr(b, 'type', None) == 'thinking']
    print(f"content block types: {[getattr(b,'type',None) for b in aresp.content]}")
    print(f"text_blocks_count={len(text_blocks)}, thinking_blocks_count={len(thinking_blocks)}")
    if text_blocks:
        t = text_blocks[0].text or ""
        print(f"first text len={len(t)} head={t[:200]!r} tail={t[-200:]!r}")
    else:
        print("NO TEXT BLOCKS — response truncated by thinking exhausting max_tokens")

    # --- OpenAI ---
    print("\n=== OpenAI gpt-5.5 scenario (max_completion_tokens=8000) ===")
    oclient = AsyncOpenAI(api_key=settings.openai_api_key)
    oresp = await oclient.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_completion_tokens=8000,
        reasoning_effort="high",
        response_format={"type": "json_object"},
    )
    choice = oresp.choices[0]
    print(f"finish_reason={choice.finish_reason}")
    print(f"usage={oresp.usage}")
    content = choice.message.content or ""
    print(f"content len={len(content)} head={content[:200]!r} tail={content[-200:]!r}")


if __name__ == "__main__":
    asyncio.run(main())
