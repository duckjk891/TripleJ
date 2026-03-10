"""Perceive Module - 에이전트 시야 범위 내 환경 감지

논문 구현: 관찰 시 계층적 공간 기억(hierarchical spatial memory)에 기록.
에이전트가 관찰한 장소만 기억 트리에 존재한다 (개인 서브그래프).
"""

from __future__ import annotations

import logging
from typing import List, Dict, Any, Optional, TYPE_CHECKING
from datetime import datetime

if TYPE_CHECKING:
    from agent_core.agent import Agent

logger = logging.getLogger(__name__)


class PerceiveModule:
    """에이전트 주변 환경 관찰"""

    def __init__(self, vision_radius: int = 8):
        self.vision_radius = vision_radius  # 타일 단위

    def perceive(
        self,
        agent: Agent,
        all_agents: List[Agent],
        world_objects: List[Dict[str, Any]],
        game_time: Optional[datetime] = None,
    ) -> List[str]:
        """주변 환경을 관찰하고 기억에 저장"""
        observations: List[str] = []

        agent_pos = agent.position  # {"x": int, "y": int}

        # 1. 주변 에이전트 감지
        for other in all_agents:
            if other.id == agent.id:
                continue
            other_pos = other.position
            dist = abs(agent_pos["x"] - other_pos["x"]) + abs(agent_pos["y"] - other_pos["y"])

            if dist <= self.vision_radius:
                obs = f"{agent.name} saw {other.name} {other.current_action} at {other.location_name}"
                observations.append(obs)

                # 계층적 공간 기억에 에이전트 위치 기록
                agent.update_spatial_memory(
                    node_id=f"agent_{other.id}",
                    name=other.name,
                    state=f"{other.current_action} at {other.location_name}",
                    game_time=game_time,
                    location_path=other.location_name,
                )

        # 2. 주변 오브젝트 상태 감지
        for obj in world_objects:
            obj_pos = obj.get("position", {})
            if not obj_pos:
                continue

            dist = abs(agent_pos["x"] - obj_pos.get("x", 999)) + abs(agent_pos["y"] - obj_pos.get("y", 999))

            if dist <= self.vision_radius:
                state = obj.get("state")
                if state:
                    obs = f"{agent.name} noticed {obj['name']} is {state}"
                    observations.append(obs)

                    # 계층적 공간 기억에 오브젝트 상태 기록
                    obj_id = obj.get("id", obj["name"])
                    location_path = obj.get("location_path", "")
                    agent.update_spatial_memory(
                        node_id=obj_id,
                        name=obj["name"],
                        state=state,
                        game_time=game_time,
                        location_path=location_path,
                    )

        # 3. 현재 에이전트의 위치도 공간 기억에 기록
        if agent.location_name:
            agent.update_spatial_memory(
                node_id=f"self_location",
                name=agent.name,
                state=f"{agent.current_action}",
                game_time=game_time,
                location_path=agent.location_name,
            )

        # 4. Memory Stream에 저장 (중복 방지)
        recent_contents = set()
        for m in agent.memory_stream.get_recent(20):
            recent_contents.add(m.content)

        new_observations = []
        for obs in observations:
            if obs not in recent_contents:
                agent.memory_stream.add_observation(obs, game_time=game_time)
                new_observations.append(obs)

        if new_observations:
            logger.debug(
                "%s perceived %d new observations",
                agent.name, len(new_observations),
            )

        return new_observations
