"""v161 — Claude 프롬프트 캐싱: 호출부별 "고정부" 토큰 실측 (일회성 dev 스크립트).

각 Claude 호출부(7 stage)의 system 고정부를 `client.messages.count_tokens`
(무료 엔드포인트)로 실사용 모델에 대해 실측하고, 모델별 최소 캐시 길이
(opus-4-6/4-5/haiku-4-5=4096, opus-4-7=2048, opus-4-8 계열=1024) 대비
적용/비적용을 확정한다. borderline 3종(#2 브레인스톰 / #3 드라마 시나리오 /
#4 씬프롬프트)의 판정이 목적.

실행:  (backend_9005 루트에서)  venv/bin/python scripts/measure_prompt_tokens.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import anthropic  # noqa: E402

from app.config import settings  # noqa: E402

# 모델별 최소 캐시 가능 prefix 길이 (미달 시 에러 없이 조용히 캐싱 안 됨)
MIN_CACHEABLE = {
    "claude-opus-4-6": 4096,
    "claude-opus-4-7": 2048,
}

DUMMY_MSG = [{"role": "user", "content": "측정용 더미 메시지"}]


def main() -> None:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    baselines = {}

    def count_system_tokens(model: str, system_text: str) -> int:
        """system 고정부의 토큰 수 = (system 포함 카운트) - (더미 메시지만 카운트)."""
        if model not in baselines:
            baselines[model] = client.messages.count_tokens(
                model=model, messages=DUMMY_MSG
            ).input_tokens
        total = client.messages.count_tokens(
            model=model, system=system_text, messages=DUMMY_MSG
        ).input_tokens
        return total - baselines[model]

    rows = []

    def add(stage: str, variant: str, model: str, text: str) -> None:
        tok = count_system_tokens(model, text)
        threshold = MIN_CACHEABLE[model]
        verdict = "적용" if tok >= threshold else "비적용(미달)"
        rows.append((stage, variant, model, len(text), tok, threshold, verdict))

    # ── #1 작사 (system 전체 고정 — solo/duet 2 엔트리) ──
    from app.services.lyrics_generator import _system_prompt_for

    add("#1 lyrics_json", "solo", "claude-opus-4-6", _system_prompt_for(False))
    add("#1 lyrics_json", "duet", "claude-opus-4-6", _system_prompt_for(True))

    # ── #2 브레인스톰 (고정 head = BRAINSTORM_SYSTEM_PROMPT) ──
    from app.services import mv_generator as mv

    add("#2 brainstorm", "fixed_head", "claude-opus-4-6", mv.BRAINSTORM_SYSTEM_PROMPT)

    # ── #3 시나리오 (drama 고정 head / 비드라마 전체) ──
    add(
        "#3 scenario", "drama_fixed_head", "claude-opus-4-6",
        mv.DRAMA_SCENARIO_SYSTEM_FIXED_HEAD,
    )
    _nondrama_system, _, = mv._build_scenario_prompts("측정", None, None, None, None)
    add("#3 scenario", "non_drama_full", "claude-opus-4-6", _nondrama_system)

    # ── #4 씬프롬프트 (video_model 별 formatted 고정 head) ──
    _head_tpl = mv.SCENE_PROMPT_ONLY_SYSTEM.split("{scenario_context}", 1)[0]
    for vm in ("veo", "kling", "seedance"):
        fixed_head = _head_tpl.format(
            video_image_prompt_guide=mv._get_video_image_prompt_guide(vm)
        )
        add("#4 scene_prompts", "head[{}]".format(vm), "claude-opus-4-6", fixed_head)

    # ── #5 영상프롬프트 (8종 템플릿 — 변동 3값 user 이동 후 고정 system) ──
    for vm in ("veo", "kling", "seedance", "grok"):
        for has_char in (True, False):
            raw = mv._select_video_prompt_template(vm, has_char)
            fixed = (
                raw
                .replace("{duration:.1f}", "[CLIP DURATION]")
                .replace(
                    "{scene_event_block}",
                    "(see the [SCENE EVENT] block at the top of the user message)",
                )
                .replace(
                    "{emotional_core}",
                    "(see the [EMOTIONAL CORE] line at the top of the user message)",
                )
            )
            add(
                "#5 video_prompt",
                "{}_{}".format(vm, "char" if has_char else "free"),
                "claude-opus-4-7",
                fixed,
            )

    # ── #6 커버 (대표 최소 조립 — 조건 분기 변동이라 비적용 확정, 참고 실측) ──
    cover_base = (
        "You are a world-class album cover art director. "
        "Given song metadata and optional user direction, write a detailed, vivid prompt "
        "for an AI image generator to create a stunning album cover. "
        "Include specific details about composition, lighting, color palette, atmosphere, and visual elements. "
        "Output ONLY the image generation prompt, nothing else. 2-4 sentences, English."
        " You may use any artistic style that fits the song's mood."
        " The image must NOT contain any text or letters."
    )
    add("#6 cover_enhance", "base(no-char)", "claude-opus-4-7", cover_base)

    # ── #7 번역 (ko→en / en→ko — context_hint 중간 삽입 구조라 비적용 확정, 참고 실측) ──
    from app.services.translation import _build_translation_system_prompt

    add(
        "#7 translation", "ko_to_en", "claude-opus-4-7",
        _build_translation_system_prompt("ko_to_en", "visual/video prompt"),
    )
    add(
        "#7 translation", "en_to_ko", "claude-opus-4-7",
        _build_translation_system_prompt("en_to_ko", "visual/video prompt"),
    )

    # ── 결과 표 ──
    header = (
        "stage", "variant", "model", "chars", "tokens", "min_cacheable", "판정",
    )
    fmt = "{:<18} {:<18} {:<18} {:>7} {:>7} {:>13}  {}"
    print(fmt.format(*header))
    print("-" * 100)
    for r in rows:
        print(fmt.format(*[str(x) for x in r]))


if __name__ == "__main__":
    main()
