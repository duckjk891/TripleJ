"""Retrieval Module - Recency + Importance + Relevance 기반 기억 검색

논문 구현에 따라 모든 메모리에 대해 raw score를 먼저 계산한 뒤,
min-max 정규화를 적용하고 가중 합산합니다.
기본 가중치는 논문의 gw=[0.5, 3, 2] (recency=0.5, relevance=3, importance=2)를 따릅니다.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from agent_core.memory.stream import MemoryStream, MemoryObject
from agent_core.prompt_template.gpt_structure import get_gpt, cosine_similarity

logger = logging.getLogger(__name__)


def _min_max_normalize(values: List[float]) -> List[float]:
    """값 리스트를 [0, 1] 범위로 min-max 정규화합니다.

    모든 값이 동일하면 0.0으로 반환합니다.
    """
    min_v = min(values)
    max_v = max(values)
    spread = max_v - min_v
    if spread == 0:
        return [0.0] * len(values)
    return [(v - min_v) / spread for v in values]


class RetrievalModule:
    """논문의 Retrieval 모듈 구현

    Score = recency_w · norm(recency) + relevance_w · norm(relevance) + importance_w · norm(importance)

    논문 기본 가중치: gw = [recency=0.5, relevance=3.0, importance=2.0]
    각 점수 배열은 전체 메모리에 대해 min-max 정규화된 후 가중 합산됩니다.
    """

    def __init__(
        self,
        decay_factor: float = 0.995,       # 논문 설정값
        recency_w: float = 0.5,            # recency 가중치 (논문 gw[0])
        relevance_w: float = 3.0,          # relevance 가중치 (논문 gw[1])
        importance_w: float = 2.0,         # importance 가중치 (논문 gw[2])
    ):
        self.decay_factor = decay_factor
        self.recency_w = recency_w
        self.relevance_w = relevance_w
        self.importance_w = importance_w

    def retrieve(
        self,
        query: str,
        memory_stream: MemoryStream,
        k: int = 30,
        game_time: Optional[datetime] = None,
    ) -> List[MemoryObject]:
        """쿼리에 대해 가장 관련된 기억 k개 반환"""
        memories = memory_stream.get_all()
        if not memories:
            return []

        now = game_time or datetime.now()

        # 쿼리 임베딩
        try:
            query_embedding = get_gpt().get_embedding(query)
        except Exception as e:
            logger.warning("Query embedding failed, falling back to recency+importance: %s", e)
            query_embedding = None

        # --- 1단계: 모든 메모리에 대해 raw score 계산 ---
        raw_recency: List[float] = []
        raw_importance: List[float] = []
        raw_relevance: List[float] = []

        for memory in memories:
            # Recency: decay_factor ^ (경과 게임 시간, 시 단위)
            hours = (now - memory.last_accessed_at).total_seconds() / 3600
            raw_recency.append(self.decay_factor ** hours)

            # Importance: raw 값 그대로 (정규화는 min-max에서 처리)
            raw_importance.append(float(memory.importance))

            # Relevance: 코사인 유사도 raw 값 (-1 ~ 1)
            if query_embedding and any(v != 0 for v in memory.embedding):
                raw_relevance.append(
                    cosine_similarity(query_embedding, memory.embedding)
                )
            else:
                raw_relevance.append(0.0)

        # --- 2단계: 각 점수 배열을 min-max 정규화 [0, 1] ---
        norm_recency = _min_max_normalize(raw_recency)
        norm_importance = _min_max_normalize(raw_importance)
        norm_relevance = _min_max_normalize(raw_relevance)

        # --- 3단계: 가중 합산 ---
        scored = []
        for i, memory in enumerate(memories):
            score = (
                self.recency_w * norm_recency[i]
                + self.relevance_w * norm_relevance[i]
                + self.importance_w * norm_importance[i]
            )
            scored.append((memory, score))

        # 상위 k개 정렬
        scored.sort(key=lambda x: x[1], reverse=True)
        top_k = [m for m, _ in scored[:k]]

        # last_accessed_at 업데이트
        for m in top_k:
            m.last_accessed_at = now

        logger.debug(
            "Retrieved %d memories for query: %.30s...",
            len(top_k), query,
        )

        return top_k

    def retrieve_by_type(
        self,
        query: str,
        memory_stream: MemoryStream,
        memory_type: str,
        k: int = 5,
        game_time: Optional[datetime] = None,
    ) -> List[MemoryObject]:
        """특정 타입의 기억만 검색"""
        # 임시로 해당 타입만 포함하는 스트림 생성
        filtered = MemoryStream()
        filtered.memories = memory_stream.get_by_type(memory_type)
        return self.retrieve(query, filtered, k=k, game_time=game_time)
