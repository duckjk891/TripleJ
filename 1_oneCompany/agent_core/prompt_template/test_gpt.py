"""GPTWrapper 테스트 스크립트

사용법:
  cd 1_oneCompany
  python3 -m agent_core.prompt_template.test_gpt
"""

from __future__ import annotations

import sys
import os

# 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from agent_core.prompt_template.gpt_structure import get_gpt, cosine_similarity


def test_cosine_similarity():
    """코사인 유사도 단위 테스트 (API 호출 없음)"""
    print("=== Test: cosine_similarity ===")

    # 동일 벡터 → 1.0
    v1 = [1.0, 0.0, 0.0]
    assert abs(cosine_similarity(v1, v1) - 1.0) < 1e-6, "Same vector should be 1.0"
    print("  [PASS] Same vector = 1.0")

    # 직교 벡터 → 0.0
    v2 = [0.0, 1.0, 0.0]
    assert abs(cosine_similarity(v1, v2)) < 1e-6, "Orthogonal vectors should be 0.0"
    print("  [PASS] Orthogonal vectors = 0.0")

    # 반대 벡터 → -1.0
    v3 = [-1.0, 0.0, 0.0]
    assert abs(cosine_similarity(v1, v3) + 1.0) < 1e-6, "Opposite vectors should be -1.0"
    print("  [PASS] Opposite vectors = -1.0")

    # 영벡터 → 0.0
    v0 = [0.0, 0.0, 0.0]
    assert abs(cosine_similarity(v1, v0)) < 1e-6, "Zero vector should be 0.0"
    print("  [PASS] Zero vector = 0.0")

    print("  All cosine_similarity tests passed!\n")


def test_gpt_wrapper_init():
    """GPTWrapper 초기화 테스트"""
    print("=== Test: GPTWrapper init ===")

    gpt = get_gpt()
    print(f"  Model: {gpt.model}")
    print(f"  Embedding model: {gpt.embedding_model}")
    print(f"  API key set: {'yes' if gpt.api_key and not gpt.api_key.startswith('sk-your') else 'no (placeholder)'}")
    print(f"  Stats: {gpt.get_stats()}")
    print("  [PASS] Initialization OK\n")

    return gpt


def test_gpt_call(gpt):
    """LLM 호출 테스트 (실제 API 키 필요)"""
    print("=== Test: GPT call ===")

    if not gpt.api_key or gpt.api_key.startswith("sk-your"):
        print("  [SKIP] No valid API key set. Set OPENAI_API_KEY in backend/.env\n")
        return False

    try:
        response = gpt.call("Say 'Hello' in Korean. Reply with just one word.", max_tokens=10)
        print(f"  Response: {response}")
        print(f"  Stats: {gpt.get_stats()}")
        print("  [PASS] GPT call OK\n")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}\n")
        return False


def test_embedding(gpt):
    """임베딩 테스트 (실제 API 키 필요)"""
    print("=== Test: Embedding ===")

    if not gpt.api_key or gpt.api_key.startswith("sk-your"):
        print("  [SKIP] No valid API key set\n")
        return False

    try:
        emb = gpt.get_embedding("김서연이 커피를 마시고 있다")
        print(f"  Embedding dims: {len(emb)}")
        print(f"  First 5 values: {emb[:5]}")

        # 유사도 테스트
        emb2 = gpt.get_embedding("박민수가 차를 마시고 있다")
        emb3 = gpt.get_embedding("공원에서 산책을 하고 있다")

        sim_12 = cosine_similarity(emb, emb2)
        sim_13 = cosine_similarity(emb, emb3)

        print(f"  Similarity (커피/차): {sim_12:.4f}")
        print(f"  Similarity (커피/산책): {sim_13:.4f}")
        print(f"  커피↔차 > 커피↔산책: {sim_12 > sim_13}")
        print(f"  Stats: {gpt.get_stats()}")
        print("  [PASS] Embedding OK\n")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}\n")
        return False


def test_batch_embedding(gpt):
    """배치 임베딩 테스트"""
    print("=== Test: Batch Embedding ===")

    if not gpt.api_key or gpt.api_key.startswith("sk-your"):
        print("  [SKIP] No valid API key set\n")
        return False

    try:
        texts = [
            "김서연이 회의실에서 발표하고 있다",
            "박민수가 카페에서 점심을 먹고 있다",
            "이지영이 공원 벤치에서 책을 읽고 있다",
        ]
        embeddings = gpt.get_embeddings_batch(texts)
        print(f"  Batch size: {len(embeddings)}")
        print(f"  Each dims: {len(embeddings[0])}")
        print(f"  Stats: {gpt.get_stats()}")
        print("  [PASS] Batch embedding OK\n")
        return True
    except Exception as e:
        print(f"  [FAIL] {e}\n")
        return False


if __name__ == "__main__":
    print("=" * 50)
    print("GPTWrapper Test Suite")
    print("=" * 50 + "\n")

    # 오프라인 테스트 (항상 실행)
    test_cosine_similarity()

    # 초기화 테스트
    gpt = test_gpt_wrapper_init()

    # 온라인 테스트 (API 키 있을 때만)
    test_gpt_call(gpt)
    test_embedding(gpt)
    test_batch_embedding(gpt)

    print("=" * 50)
    print(f"Final stats: {gpt.get_stats()}")
    print("=" * 50)
