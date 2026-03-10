"""Memory Stream - 에이전트의 모든 경험을 저장하고 관리하는 시스템"""

from __future__ import annotations

import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from agent_core.prompt_template.gpt_structure import get_gpt, cosine_similarity

logger = logging.getLogger(__name__)


@dataclass
class MemoryObject:
    id: str
    content: str
    created_at: datetime
    last_accessed_at: datetime
    importance: int                    # 1-10
    embedding: List[float]             # 1536차원
    memory_type: str                   # "observation" | "reflection" | "plan"
    depth: int = 0                     # reflection depth (observation=0, reflection=1+)
    associated_ids: List[str] = field(default_factory=list)  # 관련 기억 ID


class MemoryStream:
    """에이전트의 기억 스트림"""

    def __init__(self):
        self.memories: List[MemoryObject] = []
        self._importance_sum_since_last_reflection: int = 0

    @property
    def importance_sum(self) -> int:
        return self._importance_sum_since_last_reflection

    def reset_importance_counter(self) -> None:
        self._importance_sum_since_last_reflection = 0

    def add_observation(self, content: str, game_time: Optional[datetime] = None) -> MemoryObject:
        """관찰 기억 추가"""
        return self._add_memory(content, "observation", game_time=game_time)

    def add_observations_batch(self, contents: List[str], game_time: Optional[datetime] = None) -> List[MemoryObject]:
        """여러 관찰 기억을 배치로 추가 (임베딩 배치 처리로 비용 절약)"""
        if not contents:
            return []

        now = game_time or datetime.now()

        # 중요도 일괄 평가 (휴리스틱)
        importances = [self._rate_importance_heuristic(c) for c in contents]

        # 임베딩 배치 생성
        try:
            embeddings = get_gpt().get_embeddings_batch(contents)
        except Exception as e:
            logger.warning("Batch embedding failed, using zero vectors: %s", e)
            embeddings = [[0.0] * 1536 for _ in contents]

        memories = []
        for content, importance, embedding in zip(contents, importances, embeddings):
            memory = MemoryObject(
                id=str(uuid.uuid4()),
                content=content,
                created_at=now,
                last_accessed_at=now,
                importance=importance,
                embedding=embedding,
                memory_type="observation",
                depth=0,
            )
            self.memories.append(memory)
            self._importance_sum_since_last_reflection += importance
            memories.append(memory)

        logger.debug("Batch added %d observations", len(memories))
        return memories

    def add_reflection(
        self,
        content: str,
        importance: int = 8,
        associated_ids: Optional[List[str]] = None,
        game_time: Optional[datetime] = None,
        depth: int = 1,
    ) -> MemoryObject:
        """반성 기억 추가 (중요도 직접 지정, depth: 1=reflection, 2+=chained)"""
        return self._add_memory(
            content, "reflection",
            override_importance=importance,
            associated_ids=associated_ids or [],
            game_time=game_time,
            depth=depth,
        )

    def add_plan(self, content: str, game_time: Optional[datetime] = None) -> MemoryObject:
        """계획 기억 추가"""
        return self._add_memory(content, "plan", game_time=game_time)

    def _add_memory(
        self,
        content: str,
        memory_type: str,
        override_importance: Optional[int] = None,
        associated_ids: Optional[List[str]] = None,
        game_time: Optional[datetime] = None,
        depth: Optional[int] = None,
    ) -> MemoryObject:
        """기억 추가 내부 로직"""
        now = game_time or datetime.now()

        # 중요도 결정
        if override_importance is not None:
            importance = override_importance
        else:
            importance = self._rate_importance(content)

        # 임베딩 생성
        try:
            embedding = get_gpt().get_embedding(content)
        except Exception as e:
            logger.warning("Embedding failed, using zero vector: %s", e)
            embedding = [0.0] * 1536

        if depth is None:
            depth = 1 if memory_type == "reflection" else 0

        memory = MemoryObject(
            id=str(uuid.uuid4()),
            content=content,
            created_at=now,
            last_accessed_at=now,
            importance=importance,
            embedding=embedding,
            memory_type=memory_type,
            depth=depth,
            associated_ids=associated_ids or [],
        )

        self.memories.append(memory)
        self._importance_sum_since_last_reflection += importance

        logger.debug(
            "Memory added [%s]: importance=%d, type=%s, content=%.50s...",
            memory.id[:8], importance, memory_type, content,
        )

        return memory

    # 휴리스틱으로 처리할 일상적 패턴
    _MUNDANE_KEYWORDS = [
        "saw", "noticed", "is idle", "is standing", "walking",
        "서 있는", "걷는", "앉아 있는", "is sitting",
    ]
    _IMPORTANT_KEYWORDS = [
        "conversation", "argument", "disagreed", "agreed", "learned",
        "realized", "discovered", "decided", "plan", "project",
        "대화", "결정", "발견", "깨달", "계획",
    ]

    def _rate_importance_heuristic(self, content: str) -> int:
        """휴리스틱 기반 중요도 평가 (LLM 호출 없음)"""
        content_lower = content.lower()

        # 중요 키워드 체크
        for kw in self._IMPORTANT_KEYWORDS:
            if kw in content_lower:
                return 7

        # 일상적 키워드 체크
        for kw in self._MUNDANE_KEYWORDS:
            if kw in content_lower:
                return 2

        # 짧은 관찰은 보통 일상적
        if len(content) < 30:
            return 3

        return 5  # 기본값

    def _rate_importance(self, content: str) -> int:
        """기억의 중요도 평가 - 휴리스틱 우선, 필요 시 LLM"""
        # 먼저 휴리스틱으로 판단
        heuristic = self._rate_importance_heuristic(content)
        # 극단값(명확한 일상/중요)은 LLM 호출 없이 반환
        if heuristic <= 3 or heuristic >= 7:
            return heuristic

        # 애매한 경우만 LLM 호출
        prompt = (
            "On the scale of 1 to 10, where 1 is purely mundane "
            "(e.g., brushing teeth, making bed) and 10 is extremely poignant "
            "(e.g., a break up, college acceptance), "
            "rate the likely poignancy of the following piece of memory.\n\n"
            f"Memory: {content}\n"
            "Rating (respond with just the number):"
        )

        try:
            response = get_gpt().call_with_format(prompt, max_tokens=5, temperature=0.1)
            # 숫자만 추출
            for char in response:
                if char.isdigit():
                    rating = int(char)
                    return max(1, min(10, rating))
            return 5  # 파싱 실패 시 기본값
        except Exception as e:
            logger.warning("Importance rating failed, using default (5): %s", e)
            return 5

    def get_recent(self, n: int = 100) -> List[MemoryObject]:
        """최근 기억 n개 반환"""
        return self.memories[-n:]

    def get_by_type(self, memory_type: str) -> List[MemoryObject]:
        """타입별 기억 반환"""
        return [m for m in self.memories if m.memory_type == memory_type]

    def get_all(self) -> List[MemoryObject]:
        """모든 기억 반환"""
        return list(self.memories)

    def count(self) -> int:
        return len(self.memories)

    def to_dict_list(self) -> List[dict]:
        """직렬화용"""
        return [
            {
                "id": m.id,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
                "last_accessed_at": m.last_accessed_at.isoformat(),
                "importance": m.importance,
                "memory_type": m.memory_type,
                "depth": m.depth,
            }
            for m in self.memories
        ]

    def to_serializable(self) -> List[dict]:
        """저장용 직렬화 - 임베딩 제외 (너무 큼, 로드 시 재생성)"""
        return [
            {
                "id": m.id,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
                "last_accessed_at": m.last_accessed_at.isoformat(),
                "importance": m.importance,
                "memory_type": m.memory_type,
                "depth": m.depth,
                "associated_ids": m.associated_ids,
            }
            for m in self.memories
        ]

    @classmethod
    def from_serializable(
        cls,
        data_list: List[dict],
        importance_sum: int = 0,
        game_time: Optional[datetime] = None,
    ) -> MemoryStream:
        """저장된 데이터에서 MemoryStream 복원 (임베딩은 영벡터로 초기화)"""
        stream = cls()
        for d in data_list:
            memory = MemoryObject(
                id=d["id"],
                content=d["content"],
                created_at=datetime.fromisoformat(d["created_at"]),
                last_accessed_at=datetime.fromisoformat(d["last_accessed_at"]),
                importance=d["importance"],
                embedding=[0.0] * 1536,  # 로드 시 영벡터, 필요 시 재생성
                memory_type=d["memory_type"],
                depth=d.get("depth", 0),
                associated_ids=d.get("associated_ids", []),
            )
            stream.memories.append(memory)
        stream._importance_sum_since_last_reflection = importance_sum
        return stream

    def regenerate_embeddings_batch(self) -> int:
        """모든 기억의 임베딩을 배치로 재생성 (로드 후 호출)"""
        contents = [m.content for m in self.memories]
        if not contents:
            return 0

        try:
            embeddings = get_gpt().get_embeddings_batch(contents)
            for memory, embedding in zip(self.memories, embeddings):
                memory.embedding = embedding
            logger.info("Regenerated embeddings for %d memories", len(contents))
            return len(contents)
        except Exception as e:
            logger.warning(
                "Batch embedding regeneration failed, keeping zero vectors: %s", e,
            )
            return 0
