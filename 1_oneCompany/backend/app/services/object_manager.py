"""ObjectManager - 월드 오브젝트 상태 관리

에이전트의 행동에 따라 오브젝트 상태를 동적으로 변경합니다.
예: coffee_machine "idle" -> "brewing" (에이전트가 커피를 내릴 때)
"""

from __future__ import annotations

import logging
import math
import re
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# 오브젝트 ID 접두사 → (사용 중 상태, 기본 상태) 매핑
_STATE_MAP: Dict[str, tuple[str, str]] = {
    "desk": ("in use", "empty"),
    "coffee_machine": ("brewing", "idle"),
    "refrigerator": ("open", "idle"),
    "sink": ("running", "idle"),
    "meeting_table": ("in use", "empty"),
    "counter": ("serving", "idle"),
    "cafe_table": ("occupied", "empty"),
    "bench": ("occupied", "empty"),
}

# 상태 변경 불가 오브젝트 (항상 고정)
_IMMUTABLE_OBJECTS = {"fountain", "tree"}

# 행동 키워드 → 우선 사용 오브젝트 접두사 매핑
_ACTION_KEYWORDS: List[tuple[List[str], List[str]]] = [
    (["coffee", "brew", "drink", "커피", "음료"], ["coffee_machine"]),
    (["work", "code", "email", "typing", "write", "업무", "코딩", "이메일", "작업", "개발"], ["desk"]),
    (["eat", "food", "snack", "lunch", "meal", "식사", "먹", "간식", "점심"], ["refrigerator", "cafe_table"]),
    (["wash", "clean", "dishes", "세척", "씻"], ["sink"]),
    (["meet", "discuss", "meeting", "회의", "미팅", "토론"], ["meeting_table"]),
    (["sit", "rest", "relax", "break", "앉", "휴식", "쉬"], ["bench", "cafe_table"]),
    (["order", "buy", "purchase", "주문", "구매"], ["counter"]),
]


def _get_object_prefix(object_id: str) -> str:
    """오브젝트 ID에서 접두사 추출 (숫자 접미사 제거)

    예: "desk_01" -> "desk", "coffee_machine" -> "coffee_machine",
        "cafe_table_02" -> "cafe_table"
    """
    # 끝에 _XX 숫자가 있으면 제거
    match = re.match(r"^(.+?)_\d+$", object_id)
    if match:
        return match.group(1)
    return object_id


def _is_immutable(object_id: str) -> bool:
    """상태 변경 불가 오브젝트인지 확인"""
    prefix = _get_object_prefix(object_id)
    for immutable in _IMMUTABLE_OBJECTS:
        if prefix == immutable or prefix.startswith(immutable):
            return True
    return False


class ObjectManager:
    """월드 오브젝트 상태 관리"""

    def __init__(self, world_tree: dict):
        # id -> {id, name, state, default_state, position, occupied_by}
        self.objects: Dict[str, Dict] = {}
        self._extract_objects(world_tree)
        logger.info("ObjectManager initialized with %d objects", len(self.objects))

    def _extract_objects(self, node: dict) -> None:
        """트리에서 type=='object'인 노드들을 재귀적으로 추출"""
        if node.get("type") == "object":
            obj_id = node["id"]
            state = node.get("state", "")
            self.objects[obj_id] = {
                "id": obj_id,
                "name": node["name"],
                "state": state,
                "default_state": state,  # 리셋용 원래 상태 저장
                "position": node.get("position", {}),
                "occupied_by": None,
            }

        for child in node.get("children", []):
            self._extract_objects(child)

    # ── 오브젝트 사용/해제 ────────────────────────────────

    def use_object(self, object_id: str, agent_id: str) -> bool:
        """에이전트가 오브젝트 사용 시작

        Returns:
            True if the object state was changed, False otherwise.
        """
        obj = self.objects.get(object_id)
        if obj is None:
            return False

        if _is_immutable(object_id):
            return False

        prefix = _get_object_prefix(object_id)
        state_pair = _STATE_MAP.get(prefix)
        if state_pair is None:
            return False

        active_state, _ = state_pair

        obj["state"] = active_state
        obj["occupied_by"] = agent_id

        logger.debug(
            "Object %s (%s) -> '%s' by agent %s",
            object_id, obj["name"], active_state, agent_id,
        )
        return True

    def release_object(self, agent_id: str) -> List[str]:
        """에이전트가 점유한 모든 오브젝트 해제

        Returns:
            해제된 오브젝트 ID 목록
        """
        released: List[str] = []
        for obj in self.objects.values():
            if obj["occupied_by"] == agent_id:
                obj["state"] = obj["default_state"]
                obj["occupied_by"] = None
                released.append(obj["id"])

        if released:
            logger.debug(
                "Agent %s released objects: %s", agent_id, released,
            )
        return released

    # ── 탐색 ─────────────────────────────────────────────

    def find_nearest_object(
        self, x: int, y: int, radius: int = 3
    ) -> Optional[Dict]:
        """좌표 근처의 가장 가까운 오브젝트 반환 (반경 내)"""
        best: Optional[Dict] = None
        best_dist = float("inf")

        for obj in self.objects.values():
            pos = obj.get("position", {})
            ox = pos.get("x")
            oy = pos.get("y")
            if ox is None or oy is None:
                continue

            dist = math.sqrt((x - ox) ** 2 + (y - oy) ** 2)
            if dist <= radius and dist < best_dist:
                best_dist = dist
                best = obj

        return best

    def find_nearest_object_by_prefix(
        self, x: int, y: int, prefixes: List[str], radius: int = 8
    ) -> Optional[Dict]:
        """특정 접두사를 가진 오브젝트 중 가장 가까운 것을 반환"""
        best: Optional[Dict] = None
        best_dist = float("inf")

        for obj in self.objects.values():
            obj_prefix = _get_object_prefix(obj["id"])
            if obj_prefix not in prefixes:
                continue

            pos = obj.get("position", {})
            ox = pos.get("x")
            oy = pos.get("y")
            if ox is None or oy is None:
                continue

            dist = math.sqrt((x - ox) ** 2 + (y - oy) ** 2)
            if dist <= radius and dist < best_dist:
                best_dist = dist
                best = obj

        return best

    # ── 행동 키워드 매칭 ──────────────────────────────────

    def match_action_to_object(
        self, action: str, x: int, y: int, radius: int = 5
    ) -> Optional[Dict]:
        """에이전트 행동 텍스트를 분석하여 사용할 오브젝트를 결정

        행동 키워드에 매칭되는 오브젝트 접두사를 찾고,
        해당 접두사를 가진 오브젝트 중 가장 가까운 것을 반환합니다.
        """
        action_lower = action.lower()

        for keywords, prefixes in _ACTION_KEYWORDS:
            if any(kw in action_lower for kw in keywords):
                obj = self.find_nearest_object_by_prefix(x, y, prefixes, radius)
                if obj is not None:
                    return obj

        # 키워드 매칭 실패 시 가장 가까운 오브젝트 (immutable 제외) 반환
        return None

    # ── 직렬화/출력 ───────────────────────────────────────

    def get_objects_as_list(self) -> List[Dict]:
        """simulation_loop의 world_objects 형식으로 반환

        perceive() 모듈이 기대하는 형식:
        [{"id": str, "name": str, "state": str, "position": {"x": int, "y": int}}, ...]
        """
        result: List[Dict] = []
        for obj in self.objects.values():
            entry: Dict = {
                "id": obj["id"],
                "name": obj["name"],
                "position": obj["position"],
            }
            if obj["state"]:
                entry["state"] = obj["state"]
            if obj["occupied_by"]:
                entry["occupied_by"] = obj["occupied_by"]
            result.append(entry)
        return result

    def to_dict(self) -> Dict:
        """상태 직렬화 (저장/API 용)"""
        return {
            obj_id: {
                "id": obj["id"],
                "name": obj["name"],
                "state": obj["state"],
                "default_state": obj["default_state"],
                "position": obj["position"],
                "occupied_by": obj["occupied_by"],
            }
            for obj_id, obj in self.objects.items()
        }

    def from_dict(self, data: Dict) -> None:
        """직렬화된 상태 복원"""
        for obj_id, obj_data in data.items():
            if obj_id in self.objects:
                self.objects[obj_id]["state"] = obj_data.get("state", self.objects[obj_id]["default_state"])
                self.objects[obj_id]["occupied_by"] = obj_data.get("occupied_by")
