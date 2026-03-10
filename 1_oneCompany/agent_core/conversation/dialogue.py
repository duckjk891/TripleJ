"""Conversation Module - 에이전트 간 턴-바이-턴 대화

논문 구현: 각 턴마다 발화하는 에이전트의 기억을 새로 검색하여 컨텍스트로 사용.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, TYPE_CHECKING
from datetime import datetime

from agent_core.prompt_template.gpt_structure import get_gpt
from agent_core.memory.retrieval import RetrievalModule

if TYPE_CHECKING:
    from agent_core.agent import Agent

logger = logging.getLogger(__name__)

MAX_TURNS = 8  # 최대 대화 턴 수


@dataclass
class DialogueLine:
    speaker: str
    content: str


class ConversationModule:
    """에이전트 간 대화 시스템 - 턴-바이-턴 메모리 검색"""

    def __init__(self):
        self.retrieval = RetrievalModule()

    def check_start_conversation(self, agent: Agent, other: Agent) -> bool:
        """대화를 시작할지 LLM으로 판단"""
        # 관련 기억 검색
        relevant = self.retrieval.retrieve(
            f"interaction with {other.name}", agent.memory_stream, k=3
        )
        context = "\n".join(f"- {m.content}" for m in relevant) if relevant else "No previous interaction"

        rel_context = agent.relationships.get_context_for(other.id)

        prompt = f"""{agent.name} sees {other.name} nearby.
{agent.name} is: {agent.current_action}
{other.name} is: {other.current_action}

Relationship with {other.name}:
{rel_context}

Previous memories about {other.name}:
{context}

Should {agent.name} start a conversation with {other.name}?
Consider: Are they free? Is there something to discuss? Would it be natural?

Answer: [YES] or [NO]"""

        try:
            response = get_gpt().call(prompt, max_tokens=20, temperature=0.5)
            return "[YES]" in response.upper()
        except Exception as e:
            logger.warning("Conversation check failed: %s", e)
            return False

    def generate_dialogue(
        self,
        initiator: Agent,
        responder: Agent,
        game_time: Optional[datetime] = None,
    ) -> List[DialogueLine]:
        """두 에이전트 간 턴-바이-턴 대화 생성

        각 턴마다 발화하는 에이전트의 기억을 새로 검색하여 컨텍스트를 구성한다.
        """
        conversation: List[DialogueLine] = []
        agents = [initiator, responder]
        turn_index = 0  # 0 = initiator, 1 = responder

        for turn in range(MAX_TURNS):
            speaker = agents[turn_index]
            listener = agents[1 - turn_index]

            # 이번 턴의 발화자 기준으로 메모리 검색
            query_parts = [f"conversation with {listener.name}"]
            if conversation:
                # 직전 발화를 검색 쿼리에 포함
                query_parts.append(conversation[-1].content[:60])
            query = " ".join(query_parts)

            speaker_memories = self.retrieval.retrieve(
                query, speaker.memory_stream, k=5, game_time=game_time,
            )
            memory_context = "\n".join(
                f"- {m.content}" for m in speaker_memories
            ) if speaker_memories else "None"

            # 대화 이력 구성
            dialogue_so_far = "\n".join(
                f"{d.speaker}: {d.content}" for d in conversation
            ) if conversation else "(conversation just started)"

            rel_context = speaker.relationships.get_context_for(listener.id)

            if turn == 0:
                # 첫 턴: 대화 시작
                prompt = f"""{speaker.name} ({speaker.occupation}, {speaker.traits}) starts a conversation with {listener.name}.
{speaker.name} is currently: {speaker.current_action}
{listener.name} is currently: {listener.current_action}

Relationship: {rel_context}

{speaker.name}'s relevant memories:
{memory_context}

What does {speaker.name} say to start the conversation?
Write ONLY the dialogue line, no name prefix. Keep it natural and brief (1-2 sentences)."""
            else:
                prompt = f"""{speaker.name} ({speaker.occupation}, {speaker.traits}) is in a conversation with {listener.name}.

Conversation so far:
{dialogue_so_far}

Relationship: {rel_context}

{speaker.name}'s relevant memories:
{memory_context}

What does {speaker.name} say next?
If the conversation has reached a natural end, respond with exactly: [END]
Otherwise, write ONLY the dialogue line, no name prefix. Keep it natural and brief (1-2 sentences)."""

            try:
                response = get_gpt().call(prompt, max_tokens=80, temperature=0.8)
                response = response.strip().strip('"')

                # 대화 종료 체크
                if "[END]" in response.upper():
                    break

                # 이름 접두사 제거 (LLM이 가끔 "Name: " 포맷으로 응답)
                for name in [speaker.name, listener.name]:
                    if response.lower().startswith(name.lower() + ":"):
                        response = response[len(name) + 1:].strip()

                if response:
                    conversation.append(DialogueLine(speaker=speaker.name, content=response))

            except Exception as e:
                logger.warning("Turn %d dialogue generation failed: %s", turn, e)
                break

            # 다음 턴으로
            turn_index = 1 - turn_index

            # 최소 3턴 후 자연스러운 종료 허용 (MAX_TURNS으로 강제 종료)
            if turn >= MAX_TURNS - 1:
                break

        # 대화 결과 처리
        if conversation:
            summary = self._summarize_conversation(initiator, responder, conversation)
            initiator.memory_stream.add_observation(
                f"{initiator.name} had a conversation with {responder.name}: {summary}",
                game_time=game_time,
            )
            responder.memory_stream.add_observation(
                f"{responder.name} had a conversation with {initiator.name}: {summary}",
                game_time=game_time,
            )

            # 관계 업데이트
            initiator.relationships.update_after_conversation(
                responder.id, responder.name, summary, game_time,
            )
            responder.relationships.update_after_conversation(
                initiator.id, initiator.name, summary, game_time,
            )

            logger.info(
                "Conversation: %s <-> %s (%d turns): %s",
                initiator.name, responder.name, len(conversation), summary[:60],
            )

        return conversation

    def _parse_dialogue(
        self,
        response: str,
        name1: str,
        name2: str,
    ) -> List[DialogueLine]:
        """LLM 응답에서 대화 파싱 (하위 호환용)"""
        lines = []
        for line in response.strip().split("\n"):
            line = line.strip()
            if not line:
                continue

            if ":" in line:
                speaker, content = line.split(":", 1)
                speaker = speaker.strip().strip('"')
                content = content.strip().strip('"')

                # 이름 매칭
                if name1.lower() in speaker.lower():
                    lines.append(DialogueLine(speaker=name1, content=content))
                elif name2.lower() in speaker.lower():
                    lines.append(DialogueLine(speaker=name2, content=content))

        return lines[:MAX_TURNS]

    def _summarize_conversation(
        self,
        initiator: Agent,
        responder: Agent,
        dialogue: List[DialogueLine],
    ) -> str:
        """대화 내용 요약"""
        if len(dialogue) <= 2:
            return " / ".join(f"{d.speaker}: {d.content}" for d in dialogue)

        dialogue_text = "\n".join(f"{d.speaker}: {d.content}" for d in dialogue)

        try:
            prompt = f"""Summarize this conversation in one sentence:

{dialogue_text}

Summary:"""
            return get_gpt().call(prompt, max_tokens=60, temperature=0.3).strip()
        except Exception:
            return dialogue[0].content[:100]
