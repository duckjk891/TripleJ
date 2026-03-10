"""SimulationLoop - 에이전트 행동 사이클 실행"""

from __future__ import annotations

import asyncio
import sys
import os
import logging
from typing import List, Dict, Any, Optional, Callable, Awaitable

# agent_core 모듈 경로 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from agent_core.agent import Agent
from agent_core.cognition.planning import PlanItem
from agent_core.prompt_template.gpt_structure import get_gpt
from app.services.time_manager import time_manager
from app.services.world_data import WORLD_TREE
from app.services.object_manager import ObjectManager

logger = logging.getLogger(__name__)

# 위치 ID → 이름 매핑
LOCATION_MAP = {
    "open_space": "Main Office > Open Space",
    "meeting_room": "Main Office > Meeting Room",
    "kitchen": "Main Office > Kitchen",
    "cafe": "Cafe",
    "park": "Park",
}

# 위치 이름 → 좌표 매핑
LOCATION_POSITIONS = {
    "Open Space": {"x": 10, "y": 10},
    "Meeting Room": {"x": 10, "y": 17},
    "Kitchen": {"x": 19, "y": 17},
    "Cafe": {"x": 35, "y": 8},
    "Park": {"x": 15, "y": 30},
}


def _build_world_tree_text(tree: Dict = None, indent: int = 0) -> str:
    """월드 트리를 LLM이 읽을 수 있는 텍스트로 변환"""
    if tree is None:
        tree = WORLD_TREE

    lines = []
    prefix = "  " * indent
    node_type = tree.get("type", "")
    name = tree.get("name", "")

    if node_type == "world":
        lines.append(f"{prefix}{name}")
    elif node_type in ("area", "room"):
        pos = tree.get("position", {})
        pos_str = f" (x={pos['x']}, y={pos['y']})" if pos else ""
        lines.append(f"{prefix}- {name} [{node_type}]{pos_str}")
    elif node_type == "object":
        state = tree.get("state", "")
        state_str = f" ({state})" if state else ""
        lines.append(f"{prefix}- {name} [{node_type}]{state_str}")

    for child in tree.get("children", []):
        lines.extend(_build_world_tree_text(child, indent + 1).split("\n"))

    return "\n".join(lines)


def _collect_positions_from_tree(tree: Dict = None) -> Dict[str, Dict[str, int]]:
    """월드 트리에서 모든 위치의 좌표를 수집"""
    if tree is None:
        tree = WORLD_TREE
    positions: Dict[str, Dict[str, int]] = {}

    def _traverse(node: Dict, path: List[str]) -> None:
        name = node.get("name", "")
        current_path = [*path, name] if node.get("type") != "world" else path
        pos = node.get("position")
        if pos and node.get("type") in ("area", "room", "object"):
            path_str = " > ".join(current_path)
            positions[path_str] = pos
            positions[name] = pos
        for child in node.get("children", []):
            _traverse(child, current_path)

    _traverse(tree, [])
    return positions


# 트리에서 모든 위치-좌표 매핑 미리 구축
_ALL_POSITIONS = _collect_positions_from_tree()


def resolve_location_position(location_str: str) -> Optional[Dict[str, int]]:
    """위치 문자열에서 좌표 찾기 (확장된 트리 기반 매핑 + hardcoded fallback)"""
    if not location_str:
        return None

    # 정확한 매칭
    if location_str in _ALL_POSITIONS:
        return _ALL_POSITIONS[location_str]

    # 부분 매칭 (트리 기반)
    location_lower = location_str.lower()
    for key, pos in _ALL_POSITIONS.items():
        if key.lower() in location_lower or location_lower in key.lower():
            return pos

    # 기존 hardcoded fallback
    for key, pos in LOCATION_POSITIONS.items():
        if key.lower() in location_lower:
            return pos

    return None


def resolve_location_with_llm(action_description: str, agent_name: str = "") -> Optional[Dict[str, int]]:
    """LLM을 사용하여 행동 설명에 가장 적합한 위치를 월드 트리에서 선택

    논문 구현: LLM이 world tree를 순회하여 적절한 장소를 고른다.
    실패 시 hardcoded fallback을 사용한다.
    """
    world_text = _build_world_tree_text()

    prompt = f"""Here is the world map:
{world_text}

{agent_name + ' wants to: ' if agent_name else 'Action: '}{action_description}

Which specific location in the world map is most suitable for this action?
Reply with ONLY the location name (e.g. "Open Space", "Kitchen", "Cafe", "Park", "Meeting Room").
Do not add any explanation."""

    try:
        response = get_gpt().call_with_format(prompt, max_tokens=30, temperature=0.3)
        chosen = response.strip().strip('"').strip("'")
        logger.debug("LLM chose location '%s' for action '%s'", chosen, action_description[:40])

        pos = resolve_location_position(chosen)
        if pos:
            return pos

        logger.warning("LLM chose unknown location '%s', falling back", chosen)
    except Exception as e:
        logger.warning("LLM location selection failed: %s", e)

    return None


def _extract_agent_id_from_observation(observation: str, all_agents: List[Agent], self_id: str) -> Optional[str]:
    """관찰 문자열에서 상대 에이전트 ID를 추출

    관찰에 다른 에이전트의 이름이 포함되어 있으면 해당 에이전트 ID를 반환.
    """
    for agent in all_agents:
        if agent.id == self_id:
            continue
        if agent.name in observation:
            return agent.id
    return None


class SimulationLoop:
    """에이전트 시뮬레이션 루프"""

    def __init__(self):
        self.agents: Dict[str, Agent] = {}
        self.object_manager = ObjectManager(WORLD_TREE)
        self.world_objects: List[Dict[str, Any]] = self.object_manager.get_objects_as_list()
        self._last_plan_day: int = -1
        self._use_llm_location: bool = True  # LLM 기반 위치 선택 활성화

    def add_agent(self, agent: Agent) -> None:
        self.agents[agent.id] = agent

    def remove_agent(self, agent_id: str) -> None:
        self.agents.pop(agent_id, None)

    def get_agent(self, agent_id: str) -> Optional[Agent]:
        return self.agents.get(agent_id)

    def get_all_agents(self) -> List[Agent]:
        return list(self.agents.values())

    def set_world_objects(self, objects: List[Dict[str, Any]]) -> None:
        """외부에서 world_objects를 설정할 때 object_manager도 동기화"""
        self.world_objects = objects
        # object_manager에 반영: 외부 오브젝트 목록에 있는 상태를 동기화
        for obj in objects:
            obj_id = obj.get("id")
            if obj_id and obj_id in self.object_manager.objects:
                if "state" in obj:
                    self.object_manager.objects[obj_id]["state"] = obj["state"]

    def run_timestep(self) -> Dict[str, Any]:
        """한 타임스텝 실행 - 모든 에이전트 처리"""
        time_info = time_manager.to_dict()
        hour = time_info["hour"]
        minute = time_info["minute"]
        day = time_info["day"]

        results = {
            "time": time_info,
            "actions": [],
            "conversations": [],
            "reflections": [],
        }

        agent_list = self.get_all_agents()
        if not agent_list:
            return results

        # 새로운 날이면 모든 에이전트 재계획
        if day != self._last_plan_day:
            self._last_plan_day = day
            for agent in agent_list:
                try:
                    agent.daily_plan = []
                    agent.plan(f"Day {day}")
                except Exception as e:
                    logger.warning("Agent %s plan failed, using default: %s", agent.name, e)

                # 일과를 5-15분 단위 세부 행동으로 분해
                detailed: List[PlanItem] = []
                for plan_item in agent.daily_plan:
                    try:
                        actions = agent.planning_module.decompose_to_actions(agent, plan_item)
                        detailed.extend(actions)
                    except Exception as e:
                        logger.warning("Agent %s decompose failed: %s", agent.name, e)
                        detailed.append(plan_item)
                agent._detailed_actions = detailed
                logger.info(
                    "Agent %s decomposed %d plan items into %d detailed actions",
                    agent.name, len(agent.daily_plan), len(detailed),
                )

        for agent in agent_list:
            if agent.is_conversing:
                continue

            # 1. Perceive
            try:
                new_obs = agent.perceive(agent_list, self.world_objects)
            except Exception as e:
                logger.warning("Agent %s perceive failed, skipping: %s", agent.name, e)
                new_obs = []

            # 2. React to observations (B-6: 반응 시 계획 재생성)
            for obs in new_obs:
                try:
                    other_id = _extract_agent_id_from_observation(obs, agent_list, agent.id)
                    reaction = agent.react_and_replan(obs, hour, minute, other_id)
                    if reaction:
                        results["actions"].append({
                            "agent_id": agent.id,
                            "type": "reaction",
                            "description": reaction,
                        })
                        logger.info(
                            "Agent %s reacted: %s → %s",
                            agent.name, obs, reaction,
                        )
                except Exception as e:
                    logger.warning("Agent %s react failed: %s", agent.name, e)

            # 3. Get current planned action (prefer detailed decomposed actions)
            plan_action = agent.get_detailed_action(hour, minute) or agent.get_current_plan_action(hour, minute)
            if plan_action:
                agent.set_action(plan_action.description)

                # 이전 오브젝트 점유 해제
                self.object_manager.release_object(agent.id)

                # 위치 이동: 기존 매핑 -> LLM fallback -> 행동 키워드 fallback
                pos = resolve_location_position(plan_action.location) if plan_action.location else None
                if pos is None and self._use_llm_location:
                    pos = resolve_location_with_llm(plan_action.description, agent.name)
                if pos is None:
                    pos = resolve_location_position(plan_action.description)
                if pos:
                    agent.set_position(pos["x"], pos["y"])
                    agent.set_location_name(plan_action.location or plan_action.description)

                # 행동 키워드 기반 오브젝트 상호작용
                target_obj = self.object_manager.match_action_to_object(
                    plan_action.description,
                    agent.position["x"],
                    agent.position["y"],
                )
                if target_obj:
                    self.object_manager.use_object(target_obj["id"], agent.id)
                    logger.debug(
                        "Agent %s using %s (%s)",
                        agent.name, target_obj["name"], target_obj["state"],
                    )

                results["actions"].append({
                    "agent_id": agent.id,
                    "type": "plan",
                    "description": plan_action.description,
                    "location": plan_action.location,
                })

            # 4. Reflect
            try:
                reflections = agent.reflect()
                if reflections:
                    results["reflections"].append({
                        "agent_id": agent.id,
                        "reflections": reflections,
                    })
            except Exception as e:
                logger.warning("Agent %s reflect failed, skipping: %s", agent.name, e)

        # 5. Check conversations between nearby agents
        conversations = self._check_conversations(agent_list)
        results["conversations"] = conversations

        # 6. object_manager 상태를 world_objects에 반영 (perceive()가 업데이트된 상태를 볼 수 있도록)
        self.world_objects = self.object_manager.get_objects_as_list()

        # 오브젝트 상태 변경 내역을 결과에 포함
        results["world_objects"] = self.world_objects

        return results

    def _check_conversations(self, agents: List[Agent]) -> List[Dict]:
        """근접 에이전트 간 대화 체크"""
        conversations = []

        for i, a in enumerate(agents):
            for b in agents[i + 1:]:
                if a.is_conversing or b.is_conversing:
                    continue

                # 맨해튼 거리
                dist = abs(a.position["x"] - b.position["x"]) + abs(a.position["y"] - b.position["y"])
                if dist > 5:
                    continue

                try:
                    should_converse = a.should_start_conversation(b)
                except Exception as e:
                    logger.warning("Conversation check failed (%s <-> %s): %s", a.name, b.name, e)
                    should_converse = False

                if should_converse:
                    a.is_conversing = True
                    b.is_conversing = True
                    a.conversation_partner = b.id
                    b.conversation_partner = a.id

                    try:
                        dialogue = a.converse(b)
                    except Exception as e:
                        logger.warning("Conversation generation failed (%s <-> %s): %s", a.name, b.name, e)
                        dialogue = []

                    a.is_conversing = False
                    b.is_conversing = False
                    a.conversation_partner = None
                    b.conversation_partner = None

                    if dialogue:
                        conversations.append({
                            "agents": [a.id, b.id],
                            "dialogue": [
                                {"speaker": d.speaker, "content": d.content}
                                for d in dialogue
                            ],
                        })

        return conversations


# 싱글톤 인스턴스
simulation = SimulationLoop()


class AutoSimulator:
    """자동 시뮬레이션 루프 - 백그라운드에서 주기적으로 timestep 실행"""

    def __init__(
        self,
        sim: SimulationLoop,
        interval: float = 2.0,
    ):
        self._sim = sim
        self._interval = interval  # seconds between timesteps
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._on_result: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def interval(self) -> float:
        return self._interval

    @interval.setter
    def interval(self, value: float) -> None:
        self._interval = max(0.5, value)  # minimum 0.5s

    def set_callback(self, callback: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        """Set the async callback invoked after each timestep with the result dict."""
        self._on_result = callback

    async def start(self) -> None:
        """Start the automatic simulation loop."""
        if self._running:
            logger.warning("AutoSimulator is already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("AutoSimulator started (interval=%.1fs)", self._interval)

    async def stop(self) -> None:
        """Stop the automatic simulation loop."""
        if not self._running:
            logger.warning("AutoSimulator is not running")
            return
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("AutoSimulator stopped")

    async def _loop(self) -> None:
        """Internal loop that runs timesteps at the configured interval."""
        logger.info("AutoSimulator loop entering")
        try:
            while self._running:
                try:
                    # run_timestep is synchronous; run in executor to avoid blocking
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(None, self._sim.run_timestep)

                    # Broadcast result via callback
                    if self._on_result is not None:
                        try:
                            await self._on_result(result)
                        except Exception:
                            logger.exception("AutoSimulator callback error")

                except asyncio.CancelledError:
                    raise  # propagate cancel
                except Exception:
                    logger.exception("AutoSimulator timestep error (continuing)")

                await asyncio.sleep(self._interval)
        except asyncio.CancelledError:
            logger.info("AutoSimulator loop cancelled")


# 자동 시뮬레이터 싱글톤
auto_simulator = AutoSimulator(simulation)
