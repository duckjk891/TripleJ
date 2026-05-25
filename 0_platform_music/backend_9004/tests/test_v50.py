"""v50 — 시나리오 LLM 창의성 회복 테스트 (Fix 1+2+3+5).

T1 — Stage 2 system prompt (Fix 1+2+3): 추상 슬롯 + 압축 + anti-example.
T2 — Stage 1 BRAINSTORM_SYSTEM_PROMPT (Fix 1+3): archetype 추상화 + anti-example.
T3 — Temperature 변경 (Fix 5): 1.0/1.1, 0.85/1.0, _claude_temp_cap.
T4 — 회귀 (v45~v49 sentinel 키워드 보존).
T6 — 로깅 라인 형식 검증.

T5 (정성적 비교) 는 실 LLM 호출 영역으로 사용자 검증 단계 — 자동 외.
"""

from app.services.mv_generator import (
    BRAINSTORM_SYSTEM_PROMPT,
    ANTI_EXAMPLE_BLOCK,
    DRAMA_FEW_SHOT_EXAMPLES,
    _claude_temp_cap,
    _build_brainstorm_prompts,
    _build_drama_scenario_prompts,
)


FORBIDDEN_TERMS = [
    # 인물 이름
    "이지훈", "김수민", "박서준", "정민호", "한동훈",
    # 소품
    "머리핀", "옛 LP", "젖은 코트", "스니커즈", "운동화 끈",
    # 공간
    "재즈 카페", "백스테이지", "옛 동네 골목",
    # 구체 행동
    "머리핀 돌려주기", "어깨 두드림", "주먹 쥐기", "번호 주기",
    # v50 추상화 대상
    "벚꽃잎", "편의점", "첫눈에 반함",
]


# ── T1 — Stage 2 system prompt (Fix 1+2+3) ─────────────────────────────────────


def _build_stage2_system_prompt():
    """Helper — build Stage 2 system prompt (no seed)."""
    s, _u = _build_drama_scenario_prompts(
        title="테스트 곡",
        genre="ballad",
        mood="sad",
        lyrics="가사 샘플",
        vocal_gender="female",
        relationship=None,
        has_user_character=False,
        has_cover_person=False,
    )
    return s


def test_t1a_stage2_contains_abstract_slots():
    """T1 (a) — 추상 슬롯 패턴 포함."""
    sp = _build_stage2_system_prompt()
    assert "[관계 인물]" in sp
    assert "[일상 공간]" in sp
    assert "[입력 곡 정서에 맞는 작은 소품 = 감정 1]" in sp
    assert "[예측 못한 형태로 접촉]" in sp


def test_t1b_stage2_contains_anti_example_block():
    """T1 (b) — anti-example 블록 존재."""
    sp = _build_stage2_system_prompt()
    assert "## ⚠ 예시 단어 사용 금지" in sp
    assert "예시 단어 사용 금지 (모방 방지)" in sp
    assert sp.endswith(ANTI_EXAMPLE_BLOCK)


def test_t1c_stage2_ballad_example_compressed():
    """T1 (c) — 압축된 발라드 예시 포함, 옛 1500자 narrative 미포함."""
    sp = _build_stage2_system_prompt()
    # 압축형: "narrative 핵심 줄거리:" 패턴
    assert "narrative 핵심 줄거리:" in sp
    assert "발라드 / 옛 인연의 우연한 재회" in sp
    # 옛 1500자 풀 narrative 의 시그니처 문장
    assert "시청 앞 재즈 카페로 들어선다" not in sp
    assert "[LYRICS_PLACEHOLDER 가 여기 자연스럽게 흘러간다.]" not in sp
    # 옛 events JSON 8개 (order:5 …) 미포함
    assert "order:5, section:\"Chorus1\"" not in sp


def test_t1d_stage2_forbidden_terms_only_in_anti_example():
    """T1 (d) — 금지 단어가 anti-example 블록 외 영역에 0회 등장."""
    sp = _build_stage2_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in FORBIDDEN_TERMS:
        assert term not in sp_no_anti, (
            f"forbidden term '{term}' leaked outside anti-example block"
        )


# ── T2 — Stage 1 BRAINSTORM_SYSTEM_PROMPT (Fix 1+3) ────────────────────────────


def _build_stage1_system_prompt(seed=None):
    """Helper — build Stage 1 system prompt (with optional seed)."""
    s, _u = _build_brainstorm_prompts(
        title="테스트 곡",
        genre="ballad",
        mood="sad",
        lyrics="가사",
        vocal_gender="female",
        relationship=None,
        user_event_seed=seed,
    )
    return s


def test_t2a_stage1_archetype_definitions_abstract():
    """T2 (a) — archetype 7개 한국어 설명에서 구체 행동 단어 미포함."""
    sp = _build_stage1_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    # 옛 구체 행동
    assert "번호 주기" not in sp_no_anti
    assert "말 걸기" not in sp_no_anti
    assert "다가가기 vs 떠나보내기" not in sp_no_anti
    assert "첫눈에 반함" not in sp_no_anti
    # 새 추상 패턴
    assert "예상 못한 만남에서 시작되는 감정 변화와 능동적 결단" in sp_no_anti
    assert "시간이 지난 뒤 다시 마주친 인연이 흔드는 마음과 새 결정" in sp_no_anti
    assert "관계의 끝과 그 뒤에 남는 흔적" in sp_no_anti


def test_t2b_stage1_anti_example_block_present():
    """T2 (b) — Stage 1 빌더 결과 system prompt 에 anti-example 블록 존재 (마지막)."""
    sp = _build_stage1_system_prompt()
    assert "## ⚠ 예시 단어 사용 금지" in sp
    assert sp.endswith(ANTI_EXAMPLE_BLOCK)


def test_t2c_stage1_v47_archetype_diversity_intact():
    """T2 (c) — v47 ABSOLUTE RULE (4 distinct archetype) 무회귀."""
    assert "## v47 — ABSOLUTE RULE: plot archetype 다양성" in BRAINSTORM_SYSTEM_PROMPT
    assert "**모두 달라야 합니다**" in BRAINSTORM_SYSTEM_PROMPT


def test_t2d_stage1_v48_archetype_weights_intact():
    """T2 (d) — v48 archetype 가중치 가이드가 builder 에서 weights 주입 시 활성화."""
    from app.services.mv_generator import _compute_archetype_weights, _build_brainstorm_prompts
    weights = _compute_archetype_weights(title="테스트", genre="ballad", mood="sad")
    sp, _u = _build_brainstorm_prompts(
        title="테스트", genre="ballad", mood="sad", lyrics="가사",
        vocal_gender="female", relationship=None,
        archetype_weights=weights,
    )
    # 가중치 가이드 텍스트가 시스템 프롬프트에 inject 되었음
    assert "가중치" in sp
    # 가중치 가이드는 anti-example 블록 직전에 위치 (anti-example 가 마지막)
    assert sp.endswith(ANTI_EXAMPLE_BLOCK)


def test_t2e_stage1_v49_user_event_seed_intact():
    """T2 (e) — v49 user_event_seed 블록 동작 무회귀."""
    sp_no_seed = _build_stage1_system_prompt(seed=None)
    sp_with_seed = _build_stage1_system_prompt(seed="옛 친구와 우연히 마주침")
    assert "사용자 시드 — 핵심 사건 명시" not in sp_no_seed
    assert "사용자 시드 — 핵심 사건 명시" in sp_with_seed
    assert "옛 친구와 우연히 마주침" in sp_with_seed
    # 시드가 있어도 anti-example 가 마지막에 옴
    assert sp_with_seed.endswith(ANTI_EXAMPLE_BLOCK)


def test_t2f_stage1_forbidden_terms_only_in_anti_example():
    """T2 (f) — Stage 1 system prompt 의 금지 단어가 anti-example 블록 외에 0회."""
    sp = _build_stage1_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in FORBIDDEN_TERMS:
        assert term not in sp_no_anti, (
            f"forbidden term '{term}' leaked outside Stage 1 anti-example"
        )


# ── T3 — Temperature 변경 (Fix 5) ───────────────────────────────────────────────


def test_t3a_claude_temp_cap_helper():
    """T3 (a) — `_claude_temp_cap` 정상 동작 (≤ 1.0 → 그대로, > 1.0 → 1.0)."""
    assert _claude_temp_cap(0.5) == 0.5
    assert _claude_temp_cap(0.85) == 0.85
    assert _claude_temp_cap(1.0) == 1.0
    assert _claude_temp_cap(1.1) == 1.0
    assert _claude_temp_cap(1.5) == 1.0
    # int 입력도 안전
    assert _claude_temp_cap(1) == 1.0
    assert _claude_temp_cap(2) == 1.0


def test_t3b_brainstorm_retry_temperature_sourcecode():
    """T3 (b) — Stage 1 retry 루프의 temperature = 1.0 (attempt=0) / 1.1
    (attempt=1) — 소스 코드 string match."""
    import inspect
    from app.services import mv_generator
    src = inspect.getsource(mv_generator.generate_mv_brainstorm)
    assert "temperature = 1.0 if attempt == 0 else 1.1" in src
    assert "0.95 if attempt == 0 else 1.0" not in src


def test_t3c_stage2_default_temperatures():
    """T3 (c) — Stage 2 default temperature = 0.85 (4개 함수)."""
    import inspect
    from app.services.mv_generator import (
        _generate_scenario_openai,
        _generate_scenario_claude,
        _generate_scenario_gemini,
        generate_mv_scenario,
    )
    for fn in (
        _generate_scenario_openai,
        _generate_scenario_claude,
        _generate_scenario_gemini,
        generate_mv_scenario,
    ):
        sig = inspect.signature(fn)
        assert sig.parameters["temperature"].default == 0.85, (
            f"{fn.__name__}.temperature default = "
            f"{sig.parameters['temperature'].default} (expected 0.85)"
        )


def test_t3d_pipeline_caller_temperature_sourcecode():
    """T3 (d) — `mv_pipeline.py` Phase 0 caller — first 0.85 / retry 1.0."""
    import inspect
    from app.services import mv_pipeline
    src = inspect.getsource(mv_pipeline)
    assert "_temp = 1.0 if attempt > 0 else 0.85" in src
    assert "_temp = 0.95 if attempt > 0 else 0.8" not in src


def test_t3e_brainstorm_claude_applies_cap():
    """T3 (e) — `_generate_brainstorm_claude` 가 `_claude_temp_cap` 호출 +
    `[ClaudeTempCap]` 로그 prefix 사용."""
    import inspect
    from app.services import mv_generator
    src = inspect.getsource(mv_generator._generate_brainstorm_claude)
    assert "_claude_temp_cap(temperature)" in src
    assert "[ClaudeTempCap]" in src
    # capped value 가 SDK 호출에 전달되어야 함
    assert "kwargs[\"temperature\"] = capped_temp" in src


def test_t3f_scenario_claude_applies_cap():
    """T3 (f) — `_generate_scenario_claude` 가 `_claude_temp_cap` 호출."""
    import inspect
    from app.services import mv_generator
    src = inspect.getsource(mv_generator._generate_scenario_claude)
    assert "_claude_temp_cap(temperature)" in src
    assert "[ClaudeTempCap]" in src
    assert "scenario_kwargs[\"temperature\"] = capped_temp" in src


# ── T4 — 회귀 (v45~v49 sentinel 키워드 보존) ────────────────────────────────────


def test_t4a_v45_chain_of_thought_intact():
    """T4 (a) — v45 chain-of-thought 4단계 텍스트 무회귀."""
    sp = _build_stage2_system_prompt()
    assert "## v45 작성 순서" in sp
    assert "chain-of-thought" in sp
    assert "**1단계 — narrative 작성" in sp
    assert "**2단계 — narrative 에서 분리 필드 추출**" in sp
    assert "**3단계 — events 배열 구성" in sp
    assert "**4단계 — Self-verify" in sp


def test_t4b_v46_eventful_60_rule_intact():
    """T4 (b) — v46 사건 비율 60% ABSOLUTE RULE 무회귀."""
    sp = _build_stage2_system_prompt()
    assert "## v46 — ABSOLUTE RULE: 사건 비율 60%" in sp
    assert "**최소 60%**" in sp
    assert "**40% 이하**" in sp


def test_t4c_v47_archetype_diversity_intact():
    """T4 (c) — v47 archetype 다양성 ABSOLUTE RULE 무회귀."""
    assert "## v47 — ABSOLUTE RULE: plot archetype 다양성" in BRAINSTORM_SYSTEM_PROMPT
    assert "## v47 — ABSOLUTE RULE: key_events 사건성" in BRAINSTORM_SYSTEM_PROMPT


def test_t4d_v48_archetype_weights_intact():
    """T4 (d) — v48 archetype 가중치 가이드 동작 무회귀.

    가중치 가이드는 builder 가 archetype_weights 인자를 받았을 때만 inject.
    `generate_mv_brainstorm` 진입 시 `_compute_archetype_weights` 로 1회 계산
    → builder 에 throughput. 단위 테스트는 두 단계를 직접 호출.
    """
    from app.services.mv_generator import _compute_archetype_weights, _build_brainstorm_prompts
    weights = _compute_archetype_weights(title="테스트", genre="ballad", mood="sad")
    assert isinstance(weights, dict)
    assert len(weights) >= 1
    sp, _u = _build_brainstorm_prompts(
        title="테스트", genre="ballad", mood="sad", lyrics="가사",
        vocal_gender="female", relationship=None,
        archetype_weights=weights,
    )
    assert "가중치" in sp


def test_t4e_v49_user_event_seed_throughput_intact():
    """T4 (e) — v49 user_event_seed throughput 무회귀 (Stage 1/2 양쪽)."""
    sp1_no_seed = _build_stage1_system_prompt(seed=None)
    sp1_with_seed = _build_stage1_system_prompt(seed="옛 친구와 만남")
    assert sp1_no_seed != sp1_with_seed
    assert "옛 친구와 만남" in sp1_with_seed

    s2_no_seed, _u = _build_drama_scenario_prompts(
        title="테스트", genre="ballad", mood="sad", lyrics="가사",
        vocal_gender="female", relationship=None,
        has_user_character=False, has_cover_person=False,
    )
    s2_with_seed, _u = _build_drama_scenario_prompts(
        title="테스트", genre="ballad", mood="sad", lyrics="가사",
        vocal_gender="female", relationship=None,
        has_user_character=False, has_cover_person=False,
        user_event_seed="비 오는 날 옛 인연을 마주침",
    )
    assert s2_no_seed != s2_with_seed
    assert "비 오는 날 옛 인연을 마주침" in s2_with_seed


# ── T6 — 로깅 라인 형식 검증 (소스 string match) ────────────────────────────────


def test_t6a_brainstorm_gen_log_line_present():
    """T6 (a) — `[BrainstormGen] attempt=%d temp=%.2f model=%s` 로그 형식 보존."""
    import inspect
    from app.services import mv_generator
    src = inspect.getsource(mv_generator.generate_mv_brainstorm)
    assert "[BrainstormGen] attempt=%d temp=%.2f model=%s" in src


def test_t6b_phase0_stage2_temp_log_present():
    """T6 (b) — `[Phase0] Stage2 attempt=...temp=...` 로그가 mv_pipeline.py 에 추가됨."""
    import inspect
    from app.services import mv_pipeline
    src = inspect.getsource(mv_pipeline)
    assert "[Phase0] Stage2 attempt=%d temp=%.2f" in src


def test_t6c_claude_temp_cap_log_present():
    """T6 (c) — `[ClaudeTempCap] requested=...capped=...` 로그가 brainstorm·scenario
    Claude 경로 양쪽에 존재."""
    import inspect
    from app.services import mv_generator
    src_b = inspect.getsource(mv_generator._generate_brainstorm_claude)
    src_s = inspect.getsource(mv_generator._generate_scenario_claude)
    assert "[ClaudeTempCap] requested=%.2f capped=%.2f" in src_b
    assert "[ClaudeTempCap] requested=%.2f capped=%.2f" in src_s
