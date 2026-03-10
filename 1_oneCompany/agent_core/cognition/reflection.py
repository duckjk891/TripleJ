"""Reflection Module - 중요도 누적 시 고차원 인사이트 생성

논문 구현:
- 5개의 인사이트 생성 (3개 질문에서 분배)
- LLM 기반 중요도 평가 (하드코딩 8 대신)
- 연쇄 반성 (chained reflection): 반성이 임계값을 다시 초과하면 반성에 대한 반성 생성
- depth 추적: observation=0, reflection=1, reflection-on-reflection=2+
"""

from __future__ import annotations

import logging
from typing import List, Optional, TYPE_CHECKING
from datetime import datetime

from agent_core.prompt_template.gpt_structure import get_gpt
from agent_core.memory.retrieval import RetrievalModule

if TYPE_CHECKING:
    from agent_core.agent import Agent

logger = logging.getLogger(__name__)

MAX_CHAIN_DEPTH = 3  # 무한 반성 방지: 최대 연쇄 깊이


class ReflectionModule:
    """논문의 Reflection 모듈 - 중요도 임계값 초과 시 고차원 인사이트 생성"""

    def __init__(self, threshold: int = 150):
        self.threshold = threshold
        self.retrieval = RetrievalModule()

    def check_and_reflect(
        self,
        agent: Agent,
        game_time: Optional[datetime] = None,
    ) -> List[str]:
        """중요도 누적 체크 후 필요 시 반성 생성 (연쇄 반성 포함)"""
        all_reflections: List[str] = []
        current_depth = 1

        while (
            agent.memory_stream.importance_sum >= self.threshold
            and current_depth <= MAX_CHAIN_DEPTH
        ):
            logger.info(
                "%s triggering reflection depth=%d (importance sum=%d >= %d)",
                agent.name, current_depth,
                agent.memory_stream.importance_sum, self.threshold,
            )

            reflections = self._generate_reflections(agent, game_time, depth=current_depth)

            # 카운터 리셋
            agent.memory_stream.reset_importance_counter()

            all_reflections.extend(reflections)

            if not reflections:
                break

            # 연쇄 반성: 새로 추가된 반성들의 importance가 다시 threshold를 넘는지 체크
            # (add_reflection 내부에서 importance_sum에 합산됨)
            current_depth += 1

        return all_reflections

    def _generate_reflections(
        self,
        agent: Agent,
        game_time: Optional[datetime] = None,
        depth: int = 1,
    ) -> List[str]:
        """반성 생성 2단계: 질문 -> 인사이트 (총 5개 목표)"""
        recent = agent.memory_stream.get_recent(100)
        if not recent:
            return []

        # 최근 기억 포맷팅
        memory_text = "\n".join(
            f"- {m.content[:80]}" for m in recent
        )

        # Step 1: 중요 질문 3개 생성
        q_prompt = f"""Given only the statements below, what are 3 most salient high-level questions we can answer about the subjects in the statements?

Statements:
{memory_text}

Write exactly 3 questions, one per line:"""

        try:
            q_response = get_gpt().call(q_prompt, max_tokens=200, temperature=0.7)
            questions = [
                q.strip().lstrip("0123456789.-) ")
                for q in q_response.strip().split("\n")
                if q.strip() and "?" in q
            ][:3]
        except Exception as e:
            logger.warning("Question generation failed: %s", e)
            return []

        if not questions:
            return []

        # Step 2: 각 질문에 대한 인사이트 도출 (총 5개 목표: 질문 1,2에서 2개씩, 질문 3에서 1개)
        reflections = []
        insights_per_question = [2, 2, 1]  # 총 5개

        for qi, question in enumerate(questions):
            n_insights = insights_per_question[qi] if qi < len(insights_per_question) else 1
            try:
                relevant = self.retrieval.retrieve(question, agent.memory_stream, k=10, game_time=game_time)
                insights = self._generate_insights(agent, question, relevant, n_insights)
                for insight in insights:
                    # LLM으로 중요도 평가
                    importance = self._rate_reflection_importance(insight)
                    associated = [m.id for m in relevant[:5]]
                    agent.memory_stream.add_reflection(
                        insight,
                        importance=importance,
                        associated_ids=associated,
                        game_time=game_time,
                        depth=depth,
                    )
                    reflections.append(insight)
                    logger.info(
                        "%s reflected (depth=%d, importance=%d): %s",
                        agent.name, depth, importance, insight[:80],
                    )
            except Exception as e:
                logger.warning("Insight generation failed for question '%s': %s", question[:30], e)

        return reflections

    def _generate_insights(
        self,
        agent: Agent,
        question: str,
        relevant_memories: List,
        n: int = 1,
    ) -> List[str]:
        """관련 기억에서 n개의 인사이트 도출"""
        if not relevant_memories:
            return []

        evidence = "\n".join(f"- {m.content}" for m in relevant_memories)

        if n == 1:
            prompt = f"""Statements about {agent.name}:
{evidence}

What high-level insight can you infer from the above statements?
(Write a single sentence insight from {agent.name}'s perspective, starting with "I" or "{agent.name}")"""
        else:
            prompt = f"""Statements about {agent.name}:
{evidence}

What {n} high-level insights can you infer from the above statements?
Write {n} insights, each on a new line, numbered 1-{n}.
Each insight should be a single sentence from {agent.name}'s perspective, starting with "I" or "{agent.name}"."""

        try:
            response = get_gpt().call(prompt, max_tokens=150 * n, temperature=0.7)
            if n == 1:
                text = response.strip()
                return [text] if text else []
            else:
                insights = []
                for line in response.strip().split("\n"):
                    line = line.strip().lstrip("0123456789.-) ")
                    if line and len(line) > 10:
                        insights.append(line)
                return insights[:n]
        except Exception:
            return []

    def _generate_insight(
        self,
        agent: Agent,
        question: str,
        relevant_memories: List,
    ) -> Optional[str]:
        """관련 기억에서 인사이트 도출 (하위 호환용)"""
        results = self._generate_insights(agent, question, relevant_memories, n=1)
        return results[0] if results else None

    def _rate_reflection_importance(self, insight: str) -> int:
        """LLM으로 반성의 중요도 평가 (1-10)"""
        prompt = (
            "On the scale of 1 to 10, where 1 is purely mundane "
            "and 10 is extremely important and insightful, "
            "rate the importance of the following reflection.\n\n"
            f"Reflection: {insight}\n"
            "Rating (respond with just the number):"
        )

        try:
            response = get_gpt().call_with_format(prompt, max_tokens=5, temperature=0.1)
            for char in response:
                if char.isdigit():
                    return max(1, min(10, int(char)))
            return 7  # 파싱 실패 시 기본값
        except Exception as e:
            logger.warning("Reflection importance rating failed: %s", e)
            return 7
