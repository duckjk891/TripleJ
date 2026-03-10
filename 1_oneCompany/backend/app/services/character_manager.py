"""인메모리 캐릭터 상태 관리"""

from __future__ import annotations
from typing import Optional, List, Dict, Any


class CharacterState:
    def __init__(self, id: str, name: str, occupation: str, avatar_id: str, x: int, y: int):
        self.id = id
        self.name = name
        self.occupation = occupation
        self.avatar_id = avatar_id
        self.x = x
        self.y = y
        self.current_action = "서 있는 중"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "occupation": self.occupation,
            "avatar_id": self.avatar_id,
            "position": {"x": self.x, "y": self.y},
            "current_action": self.current_action,
        }


class CharacterManagerService:
    def __init__(self):
        self._characters: dict[str, CharacterState] = {}
        self._id_counter = 0

    def create(self, name: str, occupation: str, avatar_id: str, x: int, y: int) -> CharacterState:
        self._id_counter += 1
        char_id = f"char_{self._id_counter}"
        char = CharacterState(char_id, name, occupation, avatar_id, x, y)
        self._characters[char_id] = char
        return char

    def get(self, char_id: str) -> Optional[CharacterState]:
        return self._characters.get(char_id)

    def get_all(self) -> list[CharacterState]:
        return list(self._characters.values())

    def delete(self, char_id: str) -> bool:
        if char_id in self._characters:
            del self._characters[char_id]
            return True
        return False

    def update_position(self, char_id: str, x: int, y: int) -> Optional[CharacterState]:
        char = self._characters.get(char_id)
        if char:
            char.x = x
            char.y = y
            return char
        return None

    def update_action(self, char_id: str, action: str) -> Optional[CharacterState]:
        char = self._characters.get(char_id)
        if char:
            char.current_action = action
            return char
        return None


# 싱글톤 인스턴스
character_manager = CharacterManagerService()
