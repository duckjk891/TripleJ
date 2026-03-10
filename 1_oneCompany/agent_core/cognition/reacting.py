"""Reacting Module - 관찰에 대해 React vs Continue 판단"""

from __future__ import annotations

import logging
from typing import Tuple, Optional, TYPE_CHECKING

from agent_core.prompt_template.gpt_structure import get_gpt
from agent_core.memory.retrieval import RetrievalModule

if TYPE_CHECKING:
    from agent_core.agent import Agent

logger = logging.getLogger(__name__)


class ReactingModule:
    """관찰에 대한 반응 판단"""

    def __init__(self):
        self.retrieval = RetrievalModule()

    def should_react(
        self,
        agent: Agent,
        observation: str,
        other_agent_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """관찰에 대해 반응할지 계속할지 판단

        Args:
            agent: 반응 주체 에이전트
            observation: 관찰 내용
            other_agent_id: 관찰 대상 에이전트 ID (관계 컨텍스트 조회용)

        Returns:
            (should_react, reaction_description)
        """
        # 관련 기억 검색
        relevant = self.retrieval.retrieve(observation, agent.memory_stream, k=5)
        context = "\n".join(f"- {m.content}" for m in relevant) if relevant else "No relevant memories"

        current_plan_desc = ""
        if agent.current_plan:
            current_plan_desc = agent.current_plan.description
        else:
            current_plan_desc = "No specific plan"

        # 관계 컨텍스트 조회
        relationship_context = ""
        if other_agent_id:
            rel_text = agent.relationships.get_context_for(other_agent_id)
            relationship_context = f"\nRelationship with the other person: {rel_text}"

        prompt = f"""{agent.name} is currently {agent.current_action}.
Current plan: {current_plan_desc}

Observation: {observation}
{relationship_context}
Relevant memories:
{context}

Should {agent.name} react to this observation, or continue with the current plan?
- REACT if the observation is important, urgent, or involves someone {agent.name} knows well
- CONTINUE if it's mundane or {agent.name} is busy with something important

Answer format:
[REACT] or [CONTINUE]
If REACT, describe what {agent.name} should do in one sentence."""

        try:
            response = get_gpt().call(prompt, max_tokens=100, temperature=0.5)

            if "[REACT]" in response.upper():
                # 반응 내용 추출
                reaction = response.split("]", 1)[-1].strip()
                if not reaction:
                    reaction = f"React to: {observation}"
                logger.info("%s REACTS to: %s → %s", agent.name, observation[:50], reaction[:50])
                return True, reaction

            logger.debug("%s CONTINUES despite: %s", agent.name, observation[:50])
            return False, None

        except Exception as e:
            logger.warning("Reaction check failed for %s: %s", agent.name, e)
            return False, None
