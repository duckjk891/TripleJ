"""월드 트리 데이터 및 아바타 정보 (프론트엔드 worldTree.ts, CharacterManager.ts 미러링)"""

from __future__ import annotations
from typing import List, Dict

WORLD_TREE = {
    "id": "world",
    "name": "OneCompany Village",
    "type": "world",
    "children": [
        {
            "id": "main_office",
            "name": "Main Office",
            "type": "area",
            "children": [
                {
                    "id": "open_space",
                    "name": "Open Space",
                    "type": "room",
                    "position": {"x": 10, "y": 10},
                    "children": [
                        {"id": "desk_01", "name": "Desk 01", "type": "object", "state": "empty", "position": {"x": 7, "y": 7}, "children": []},
                        {"id": "desk_02", "name": "Desk 02", "type": "object", "state": "empty", "position": {"x": 10, "y": 7}, "children": []},
                        {"id": "desk_03", "name": "Desk 03", "type": "object", "state": "empty", "position": {"x": 13, "y": 7}, "children": []},
                        {"id": "desk_04", "name": "Desk 04", "type": "object", "state": "empty", "position": {"x": 7, "y": 11}, "children": []},
                        {"id": "desk_05", "name": "Desk 05", "type": "object", "state": "empty", "position": {"x": 10, "y": 11}, "children": []},
                        {"id": "desk_06", "name": "Desk 06", "type": "object", "state": "empty", "position": {"x": 13, "y": 11}, "children": []},
                    ],
                },
                {
                    "id": "meeting_room",
                    "name": "Meeting Room",
                    "type": "room",
                    "position": {"x": 10, "y": 17},
                    "children": [
                        {"id": "meeting_table", "name": "Meeting Table", "type": "object", "state": "empty", "position": {"x": 8, "y": 16}, "children": []},
                    ],
                },
                {
                    "id": "kitchen",
                    "name": "Kitchen",
                    "type": "room",
                    "position": {"x": 19, "y": 17},
                    "children": [
                        {"id": "coffee_machine", "name": "Coffee Machine", "type": "object", "state": "idle", "position": {"x": 16, "y": 15}, "children": []},
                        {"id": "refrigerator", "name": "Refrigerator", "type": "object", "state": "idle", "position": {"x": 18, "y": 15}, "children": []},
                        {"id": "sink", "name": "Sink", "type": "object", "state": "idle", "position": {"x": 20, "y": 15}, "children": []},
                    ],
                },
            ],
        },
        {
            "id": "cafe",
            "name": "Cafe",
            "type": "area",
            "position": {"x": 35, "y": 8},
            "children": [
                {"id": "counter", "name": "Counter", "type": "object", "state": "idle", "position": {"x": 31, "y": 6}, "children": []},
                {"id": "cafe_table_01", "name": "Cafe Table 01", "type": "object", "state": "empty", "position": {"x": 32, "y": 10}, "children": []},
                {"id": "cafe_table_02", "name": "Cafe Table 02", "type": "object", "state": "empty", "position": {"x": 36, "y": 10}, "children": []},
                {"id": "cafe_table_03", "name": "Cafe Table 03", "type": "object", "state": "empty", "position": {"x": 40, "y": 10}, "children": []},
            ],
        },
        {
            "id": "park",
            "name": "Park",
            "type": "area",
            "position": {"x": 15, "y": 30},
            "children": [
                {"id": "bench_01", "name": "Bench 01", "type": "object", "state": "empty", "position": {"x": 8, "y": 28}, "children": []},
                {"id": "bench_02", "name": "Bench 02", "type": "object", "state": "empty", "position": {"x": 15, "y": 28}, "children": []},
                {"id": "bench_03", "name": "Bench 03", "type": "object", "state": "empty", "position": {"x": 22, "y": 28}, "children": []},
                {"id": "fountain", "name": "Fountain", "type": "object", "state": "running", "position": {"x": 14, "y": 32}, "children": []},
                {"id": "tree_01", "name": "Tree", "type": "object", "position": {"x": 7, "y": 26}, "children": []},
                {"id": "tree_02", "name": "Tree", "type": "object", "position": {"x": 12, "y": 26}, "children": []},
                {"id": "tree_03", "name": "Tree", "type": "object", "position": {"x": 20, "y": 26}, "children": []},
                {"id": "tree_04", "name": "Tree", "type": "object", "position": {"x": 25, "y": 26}, "children": []},
            ],
        },
    ],
}


def get_spawn_locations() -> List[Dict]:
    """position이 있는 area/room 노드를 스폰 위치로 반환"""
    locations: List[Dict] = []

    def traverse(node: Dict, path: List[str]) -> None:
        current_path = [] if node["type"] == "world" else [*path, node["name"]]

        if node.get("position") and node["type"] in ("area", "room"):
            locations.append({
                "id": node["id"],
                "name": " > ".join(current_path),
                "x": node["position"]["x"],
                "y": node["position"]["y"],
            })

        for child in node.get("children", []):
            traverse(child, current_path)

    traverse(WORLD_TREE, [])
    return locations


AVATAR_COLORS = [
    {"id": "blue", "name": "파랑", "color": 0x4A90D9},
    {"id": "red", "name": "빨강", "color": 0xD94A4A},
    {"id": "green", "name": "초록", "color": 0x4AD94A},
    {"id": "purple", "name": "보라", "color": 0x9B4AD9},
    {"id": "orange", "name": "주황", "color": 0xD9944A},
    {"id": "pink", "name": "분홍", "color": 0xD94A90},
    {"id": "cyan", "name": "하늘", "color": 0x4AD9D9},
    {"id": "yellow", "name": "노랑", "color": 0xD9D94A},
]
