"""v50.1 — Anti-example 블록 확장 (군중 클리셰 차단) 테스트.

T1 — `ANTI_EXAMPLE_BLOCK` 정합성 (Fix B + Fix A 단락 + 기존 v50 보존).
T2 — Stage 1 + Stage 2 system prompt 안에 새 cliché 문자열 등장 검증.

T3~T5 는 v50 회귀 테스트(기존 `tests/test_v50.py`) + 사용자 정성 검증으로 커버.
"""

from app.services.mv_generator import (
    ANTI_EXAMPLE_BLOCK,
    _build_brainstorm_prompts,
    _build_drama_scenario_prompts,
)


# v50.1 신규 추가 단락에 등장해야 하는 핵심 문자열 (B = 일반 가드, A = 구체 클리셰).
# 모두 anti-example 블록 안에만 등장해야 한다.
V50_1_NEW_CLICHE_TERMS = [
    # Fix B — 일반 가드 (군중 임의 등장 금지)
    "학생 단체",
    "관광객 무리",
    "길거리 행인",
    "웨딩 하객",
    "분위기 채우기용 군중 묘사는 금지",
    # Fix A — 구체 클리셰 인물·행동
    "교복 입은 학생들",
    "까르르 웃는 학생",
    "단체 셀카",
    "까페 옆자리 손님 단체",
    "봄나들이 가족 무리",
    "벚꽃놀이 군중",
    "지나가다 박수 쳐주는 행인",
    "우산 쓰고 웃는 연인 무리",
]


# v50 에서 정의된 forbidden 단어 — v50.1 hot-patch 후에도 보존되어야 함.
V50_LEGACY_FORBIDDEN_TERMS = [
    "이지훈", "김수민", "박서준", "정민호", "한동훈",
    "머리핀", "옛 LP", "젖은 코트", "스니커즈", "운동화 끈",
    "재즈 카페", "백스테이지", "옛 동네 골목",
    "머리핀 돌려주기", "어깨 두드림", "주먹 쥐기", "번호 주기",
]


def _build_stage1_system_prompt():
    s, _u = _build_brainstorm_prompts(
        title="테스트 곡",
        genre="ballad",
        mood="sad",
        lyrics="가사 샘플",
        vocal_gender="female",
        relationship=None,
        user_event_seed=None,
    )
    return s


def _build_stage2_system_prompt():
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


# ── T1 — ANTI_EXAMPLE_BLOCK 정합성 ──────────────────────────────────────────────


def test_t1a_v50_1_new_cliche_terms_in_anti_example_block():
    """T1 (a) — Fix B + Fix A 핵심 문자열이 ANTI_EXAMPLE_BLOCK 상수 안에 모두 포함."""
    for term in V50_1_NEW_CLICHE_TERMS:
        assert term in ANTI_EXAMPLE_BLOCK, (
            f"v50.1 new cliché term '{term}' missing from ANTI_EXAMPLE_BLOCK"
        )


def test_t1b_v50_legacy_forbidden_terms_preserved():
    """T1 (b) — v50 기존 forbidden-words 리스트가 hot-patch 후에도 보존."""
    for term in V50_LEGACY_FORBIDDEN_TERMS:
        assert term in ANTI_EXAMPLE_BLOCK, (
            f"v50 legacy forbidden term '{term}' got removed by v50.1 hot-patch"
        )


def test_t1c_closing_sentences_preserved():
    """T1 (c) — 마무리 안내 (소설가 비유 + 예시와 다른 단어) 보존 + 여전히 마지막 위치."""
    # 마무리 두 문장 존재
    assert "소설가가 매번 새 인물·새 무대를 창작하듯" in ANTI_EXAMPLE_BLOCK
    assert "예시와 다른 단어로 채워야 합니다" in ANTI_EXAMPLE_BLOCK
    assert (
        "대신 입력 곡의 가사·분위기·캐릭터·장소에 어울리는"
        in ANTI_EXAMPLE_BLOCK
    )
    # 새 cliché 단락이 마무리 문장보다 먼저 등장해야 함 (LLM attention 의 마지막 instruction
    # 은 여전히 "소설가 비유" 문장이어야 함).
    idx_cliche = ANTI_EXAMPLE_BLOCK.find("교복 입은 학생들")
    idx_closing = ANTI_EXAMPLE_BLOCK.find("소설가가 매번")
    assert 0 < idx_cliche < idx_closing, (
        f"cliche block (idx={idx_cliche}) must appear BEFORE closing sentence "
        f"(idx={idx_closing}) so closing is the final instruction."
    )


def test_t1d_block_still_ends_with_newline():
    """T1 (d) — 블록은 newline 으로 끝나야 함 (Stage 1/2 빌더가 system_prompt + ANTI…
    형태로 직접 concat 하므로 최종 prompt 가 깔끔하게 끝남)."""
    assert ANTI_EXAMPLE_BLOCK.endswith("\n")


# ── T2 — Stage 1 + Stage 2 system prompt 정합성 ─────────────────────────────────


def test_t2a_stage1_ends_with_anti_example_block():
    """T2 (a) — Stage 1 system prompt 가 여전히 ANTI_EXAMPLE_BLOCK 으로 끝남
    (v50 동작 무회귀)."""
    sp = _build_stage1_system_prompt()
    assert sp.endswith(ANTI_EXAMPLE_BLOCK)


def test_t2b_stage2_ends_with_anti_example_block():
    """T2 (b) — Stage 2 system prompt 가 여전히 ANTI_EXAMPLE_BLOCK 으로 끝남
    (v50 동작 무회귀)."""
    sp = _build_stage2_system_prompt()
    assert sp.endswith(ANTI_EXAMPLE_BLOCK)


def test_t2c_stage1_contains_all_new_cliche_terms():
    """T2 (c) — Stage 1 system prompt 안에 새 cliché 문자열 13개 모두 등장."""
    sp = _build_stage1_system_prompt()
    for term in V50_1_NEW_CLICHE_TERMS:
        assert term in sp, (
            f"Stage 1 system prompt missing v50.1 cliché term '{term}'"
        )


def test_t2d_stage2_contains_all_new_cliche_terms():
    """T2 (d) — Stage 2 system prompt 안에 새 cliché 문자열 13개 모두 등장."""
    sp = _build_stage2_system_prompt()
    for term in V50_1_NEW_CLICHE_TERMS:
        assert term in sp, (
            f"Stage 2 system prompt missing v50.1 cliché term '{term}'"
        )


def test_t2e_v50_1_section_header_present():
    """T2 (e) — v50.1 섹션 헤더 (`### v50.1 — 군중 인물 임의 등장 금지`) 가 두
    빌더 system prompt 안에 모두 등장."""
    header = "### v50.1 — 군중 인물 임의 등장 금지"
    sp1 = _build_stage1_system_prompt()
    sp2 = _build_stage2_system_prompt()
    assert header in sp1
    assert header in sp2
    assert header in ANTI_EXAMPLE_BLOCK


# ── T3 — v50 forbidden-words 누출 방지 (회귀 안전망) ───────────────────────────


def test_t3a_v50_legacy_forbidden_terms_not_outside_anti_example_stage1():
    """T3 (a) — v50 legacy forbidden 단어가 Stage 1 의 anti-example 블록 외 영역에
    0회 등장 (v50 의 t2f 와 동일 보장)."""
    sp = _build_stage1_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in V50_LEGACY_FORBIDDEN_TERMS:
        assert term not in sp_no_anti, (
            f"v50 legacy forbidden term '{term}' leaked into Stage 1 outside "
            f"anti-example block after v50.1 hot-patch"
        )


def test_t3b_v50_legacy_forbidden_terms_not_outside_anti_example_stage2():
    """T3 (b) — v50 legacy forbidden 단어가 Stage 2 의 anti-example 블록 외 영역에
    0회 등장 (v50 의 t1d 와 동일 보장)."""
    sp = _build_stage2_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in V50_LEGACY_FORBIDDEN_TERMS:
        assert term not in sp_no_anti, (
            f"v50 legacy forbidden term '{term}' leaked into Stage 2 outside "
            f"anti-example block after v50.1 hot-patch"
        )


def test_t3c_v50_1_new_cliche_terms_only_in_anti_example_stage1():
    """T3 (c) — Stage 1 — 새 cliché 단어들도 anti-example 블록 외 영역에 0회 등장
    (실수로 archetype 정의나 few-shot 예시에 들어가지 않았는지 확인)."""
    sp = _build_stage1_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in V50_1_NEW_CLICHE_TERMS:
        assert term not in sp_no_anti, (
            f"v50.1 new cliché term '{term}' leaked into Stage 1 outside "
            f"anti-example block"
        )


def test_t3d_v50_1_new_cliche_terms_only_in_anti_example_stage2():
    """T3 (d) — Stage 2 — 새 cliché 단어들도 anti-example 블록 외 영역에 0회 등장."""
    sp = _build_stage2_system_prompt()
    sp_no_anti = sp.replace(ANTI_EXAMPLE_BLOCK, "")
    for term in V50_1_NEW_CLICHE_TERMS:
        assert term not in sp_no_anti, (
            f"v50.1 new cliché term '{term}' leaked into Stage 2 outside "
            f"anti-example block"
        )
