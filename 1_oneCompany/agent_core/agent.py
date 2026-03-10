"""Agent - 모든 인지 모듈을 통합한 에이전트 클래스"""

from __future__ import annotations

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from agent_core.memory.stream import MemoryStream
from agent_core.memory.retrieval import RetrievalModule
from agent_core.cognition.perceive import PerceiveModule
from agent_core.cognition.planning import PlanningModule, PlanItem
from agent_core.cognition.reacting import ReactingModule
from agent_core.cognition.reflection import ReflectionModule
from agent_core.conversation.dialogue import ConversationModule
from agent_core.social.relationships import RelationshipModule

logger = logging.getLogger(__name__)


class Agent:
    """Generative Agent - 논문의 인지 아키텍처 구현"""

    def __init__(
        self,
        agent_id: str,
        name: str,
        occupation: str,
        traits: str = "",
        backstory: str = "",
        daily_routine: str = "",
    ):
        self.id = agent_id
        self.name = name
        self.occupation = occupation
        self.traits = traits
        self.backstory = backstory
        self.daily_routine = daily_routine

        # 위치/상태
        self.position: Dict[str, int] = {"x": 0, "y": 0}
        self.location_name: str = "야외"
        self.current_action: str = "서 있는 중"

        # 계획
        self.daily_plan: List[PlanItem] = []
        self._detailed_actions: List[PlanItem] = []
        self.current_plan: Optional[PlanItem] = None

        # 인지 모듈
        self.memory_stream = MemoryStream()
        self.retrieval = RetrievalModule()
        self.perceive_module = PerceiveModule()
        self.planning_module = PlanningModule()
        self.reacting_module = ReactingModule()
        self.reflection_module = ReflectionModule()
        self.conversation_module = ConversationModule()
        self.relationships = RelationshipModule()

        # 개인 환경 서브트리 (B-4: Hierarchical Spatial Memory)
        # 계층 구조: { "area_name": { "rooms": { "room_name": { "objects": { ... } } } } }
        self.spatial_memory: Dict[str, Any] = {}
        # 하위 호환을 위한 flat 참조 (node_id -> entry)
        self._spatial_flat: Dict[str, Dict] = {}

        # 상태 플래그
        self.is_conversing = False
        self.conversation_partner: Optional[str] = None

    def initialize(self, game_time: Optional[datetime] = None) -> None:
        """에이전트 초기화 - Seed Memory 및 첫 계획 생성"""
        # 배경 스토리를 기억으로 변환 (배치 임베딩 사용)
        if self.backstory:
            seed_texts = [t.strip() for t in self.backstory.split(";") if t.strip()]
            if seed_texts:
                self.memory_stream.add_observations_batch(seed_texts, game_time=game_time)

        # 첫 하루 계획 생성
        self.daily_plan = self.planning_module.create_daily_plan(self)

        logger.info(
            "Agent initialized: %s (%s) - %d seed memories, %d plan items",
            self.name, self.occupation,
            self.memory_stream.count(), len(self.daily_plan),
        )

    def perceive(
        self,
        all_agents: List[Agent],
        world_objects: List[Dict[str, Any]],
        game_time: Optional[datetime] = None,
    ) -> List[str]:
        """주변 환경 관찰"""
        return self.perceive_module.perceive(self, all_agents, world_objects, game_time)

    def plan(self, game_date: str = "Day 1") -> List[PlanItem]:
        """하루 계획 생성"""
        self.daily_plan = self.planning_module.create_daily_plan(self, game_date)
        return self.daily_plan

    def get_current_plan_action(self, hour: int, minute: int) -> Optional[PlanItem]:
        """현재 시간에 해당하는 계획 항목"""
        action = self.planning_module.get_current_action(self.daily_plan, hour, minute)
        self.current_plan = action
        return action

    def get_detailed_action(self, hour: int, minute: int) -> Optional[PlanItem]:
        """현재 시간에 해당하는 세부 행동 반환 (decomposed actions)"""
        if not self._detailed_actions:
            return None

        current_str = f"{hour:02d}:{minute:02d}"
        best: Optional[PlanItem] = None

        for action in self._detailed_actions:
            if action.start_time <= current_str:
                if best is None or action.start_time > best.start_time:
                    best = action

        return best

    def react(self, observation: str, other_agent_id: Optional[str] = None) -> tuple:
        """관찰에 대한 반응 판단"""
        return self.reacting_module.should_react(self, observation, other_agent_id)

    def reflect(self, game_time: Optional[datetime] = None) -> List[str]:
        """반성 체크 및 생성"""
        return self.reflection_module.check_and_reflect(self, game_time)

    def should_start_conversation(self, other: Agent) -> bool:
        """대화 시작 여부 판단"""
        if self.is_conversing or other.is_conversing:
            return False
        return self.conversation_module.check_start_conversation(self, other)

    def converse(self, other: Agent, game_time: Optional[datetime] = None):
        """다른 에이전트와 대화"""
        return self.conversation_module.generate_dialogue(self, other, game_time)

    def retrieve_memories(self, query: str, k: int = 10, game_time: Optional[datetime] = None):
        """관련 기억 검색"""
        return self.retrieval.retrieve(query, self.memory_stream, k=k, game_time=game_time)

    # ── B-4: Hierarchical Spatial Memory ──

    def update_spatial_memory(
        self,
        node_id: str,
        name: str,
        state: str,
        game_time: Optional[datetime] = None,
        location_path: str = "",
    ) -> None:
        """계층적 공간 기억 업데이트

        location_path 예: "Main Office > Open Space" 또는 "Cafe"
        이 경로를 파싱하여 계층적 트리에 삽입한다.
        """
        timestamp = (game_time or datetime.now()).isoformat()

        entry = {
            "name": name,
            "state": state,
            "last_seen": timestamp,
        }

        # flat 참조 업데이트 (하위 호환)
        self._spatial_flat[node_id] = entry

        # 계층 트리 업데이트
        if location_path:
            parts = [p.strip() for p in location_path.split(">") if p.strip()]
        else:
            parts = []

        if not parts:
            # 경로 없으면 루트 레벨에 직접 저장
            self.spatial_memory.setdefault("_items", {})[node_id] = entry
            return

        # 경로를 따라 트리를 구축/탐색
        current = self.spatial_memory
        for part in parts:
            if part not in current:
                current[part] = {"_items": {}}
            elif "_items" not in current[part]:
                current[part]["_items"] = {}
            current = current[part]

        current["_items"][node_id] = entry

    def get_spatial_memory(self) -> Dict[str, Any]:
        """현재 공간 기억 반환 (계층 트리)"""
        return dict(self.spatial_memory)

    def get_spatial_memory_flat(self) -> Dict[str, Dict]:
        """flat 형태의 공간 기억 반환 (하위 호환)"""
        return dict(self._spatial_flat)

    def get_known_locations(self) -> List[str]:
        """에이전트가 방문/관찰한 장소 목록 반환"""
        locations: List[str] = []

        def _traverse(tree: dict, path: str) -> None:
            for key, value in tree.items():
                if key == "_items":
                    continue
                if isinstance(value, dict):
                    full_path = f"{path} > {key}" if path else key
                    locations.append(full_path)
                    _traverse(value, full_path)

        _traverse(self.spatial_memory, "")
        return locations

    # ── B-6: 반응 시 계획 재생성 (full replanning) ──

    def react_and_replan(self, observation: str, hour: int, minute: int, other_agent_id: Optional[str] = None) -> Optional[str]:
        """관찰에 반응하고, 반응 시 남은 스케줄을 재생성"""
        should_react, reaction = self.react(observation, other_agent_id)
        if not should_react or not reaction:
            return None

        # 현재 plan item의 description을 reaction으로 교체
        if self.current_plan:
            logger.info(
                "%s replan: '%s' -> '%s'",
                self.name, self.current_plan.description, reaction,
            )
            self.current_plan.description = reaction

        # 현재 행동도 갱신
        self.set_action(reaction)

        # 남은 일정 재생성 (논문 B-6: full schedule adjustment)
        try:
            new_remaining = self.planning_module.regenerate_remaining_plan(
                self, hour, minute, reaction,
            )
            if new_remaining:
                # 현재 시간 이전의 detailed_actions는 유지, 이후는 새로 교체
                current_str = f"{hour:02d}:{minute:02d}"
                kept = [a for a in self._detailed_actions if a.start_time < current_str]

                # 새 일정을 세부 행동으로 분해
                new_detailed: List[PlanItem] = []
                for plan_item in new_remaining:
                    actions = self.planning_module.decompose_to_actions(self, plan_item)
                    new_detailed.extend(actions)

                self._detailed_actions = kept + new_detailed

                # daily_plan도 업데이트: 현재 이전 것 유지 + 새 것 추가
                kept_daily = [p for p in self.daily_plan if p.end_time <= current_str]
                self.daily_plan = kept_daily + new_remaining

                logger.info(
                    "%s full replan from %s: %d new daily items, %d new detailed actions",
                    self.name, current_str, len(new_remaining), len(new_detailed),
                )
        except Exception as e:
            logger.warning("Full replanning failed for %s: %s", self.name, e)

        return reaction

    def set_position(self, x: int, y: int) -> None:
        self.position = {"x": x, "y": y}

    def set_location_name(self, name: str) -> None:
        self.location_name = name

    def set_action(self, action: str) -> None:
        self.current_action = action

    def to_save_dict(self) -> dict:
        """전체 저장용 직렬화 (persistence) - 모든 기억 포함, 임베딩 제외"""
        return {
            "id": self.id,
            "name": self.name,
            "occupation": self.occupation,
            "traits": self.traits,
            "backstory": self.backstory,
            "daily_routine": self.daily_routine,
            "position": self.position,
            "location_name": self.location_name,
            "current_action": self.current_action,
            "memories": self.memory_stream.to_serializable(),
            "importance_sum_since_last_reflection": self.memory_stream._importance_sum_since_last_reflection,
            "daily_plan": [
                {
                    "start_time": p.start_time,
                    "end_time": p.end_time,
                    "description": p.description,
                    "location": p.location,
                    "completed": p.completed,
                }
                for p in self.daily_plan
            ],
            "spatial_memory": self.spatial_memory,
            "spatial_flat": self._spatial_flat,
            "relationships": self.relationships.to_dict(),
        }

    @classmethod
    def from_save_dict(cls, data: dict) -> Agent:
        """저장된 데이터에서 Agent 복원"""
        agent = cls(
            agent_id=data["id"],
            name=data["name"],
            occupation=data["occupation"],
            traits=data.get("traits", ""),
            backstory=data.get("backstory", ""),
            daily_routine=data.get("daily_routine", ""),
        )

        # 위치/상태 복원
        pos = data.get("position", {"x": 0, "y": 0})
        agent.set_position(pos["x"], pos["y"])
        agent.set_location_name(data.get("location_name", "야외"))
        agent.set_action(data.get("current_action", "서 있는 중"))

        # 기억 스트림 복원 (임베딩은 영벡터)
        memories_data = data.get("memories", [])
        importance_sum = data.get("importance_sum_since_last_reflection", 0)
        agent.memory_stream = MemoryStream.from_serializable(
            memories_data, importance_sum=importance_sum,
        )

        # 일과 계획 복원
        for p in data.get("daily_plan", []):
            agent.daily_plan.append(PlanItem(
                start_time=p["start_time"],
                end_time=p["end_time"],
                description=p["description"],
                location=p.get("location", ""),
                completed=p.get("completed", False),
            ))

        # 공간 기억 복원 (계층 + flat)
        agent.spatial_memory = data.get("spatial_memory", {})
        agent._spatial_flat = data.get("spatial_flat", {})

        # 하위 호환: 이전 저장 형식(flat만 있던 경우) 처리
        if not agent.spatial_memory and agent._spatial_flat:
            # flat 데이터를 루트 _items로 변환
            agent.spatial_memory = {"_items": dict(agent._spatial_flat)}
        elif agent.spatial_memory and not agent._spatial_flat:
            # 계층 데이터에서 flat 참조 재구성
            def _extract_flat(tree: dict, out: dict) -> None:
                for key, value in tree.items():
                    if key == "_items" and isinstance(value, dict):
                        out.update(value)
                    elif isinstance(value, dict):
                        _extract_flat(value, out)
            _extract_flat(agent.spatial_memory, agent._spatial_flat)

        # 관계 복원
        relationships_data = data.get("relationships", {})
        if relationships_data:
            from agent_core.social.relationships import RelationshipModule
            agent.relationships = RelationshipModule.from_dict(relationships_data)

        logger.info(
            "Agent restored from save: %s (%s) - %d memories, %d plan items",
            agent.name, agent.occupation,
            agent.memory_stream.count(), len(agent.daily_plan),
        )

        return agent

    def to_dict(self) -> dict:
        """직렬화"""
        # B-11: 최근 반성 3개
        recent_reflections_raw = self.memory_stream.get_by_type("reflection")[-3:]
        recent_reflections = [
            {"content": m.content, "importance": m.importance}
            for m in recent_reflections_raw
        ]

        return {
            "id": self.id,
            "name": self.name,
            "occupation": self.occupation,
            "traits": self.traits,
            "position": self.position,
            "location_name": self.location_name,
            "current_action": self.current_action,
            "current_plan": self.current_plan.description if self.current_plan else None,
            "memory_count": self.memory_stream.count(),
            "recent_memories": [
                {"content": m.content, "type": m.memory_type, "importance": m.importance}
                for m in self.memory_stream.get_recent(5)
            ],
            "daily_plan": [
                {"start": p.start_time, "end": p.end_time, "desc": p.description, "loc": p.location}
                for p in self.daily_plan
            ],
            "is_conversing": self.is_conversing,
            "spatial_memory": self.spatial_memory,           # B-4 (hierarchical)
            "recent_reflections": recent_reflections,        # B-11
            "relationships": self.relationships.to_dict(),   # Social graph
        }
