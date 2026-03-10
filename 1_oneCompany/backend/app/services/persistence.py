"""PersistenceManager - JSON 파일 기반 에이전트 상태 저장/복원"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from agent_core.agent import Agent

logger = logging.getLogger(__name__)

# 기본 저장 경로
_DEFAULT_SAVE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "save_data",
)


class PersistenceManager:
    """JSON 파일 기반 시뮬레이션 상태 저장/복원 매니저"""

    def __init__(
        self,
        save_dir: str = _DEFAULT_SAVE_DIR,
        auto_save_interval: int = 300,
    ):
        self.save_dir = os.path.abspath(save_dir)
        self.auto_save_interval = auto_save_interval  # 초 단위 (기본 5분)
        self._last_save_time: float = 0.0

    def _ensure_dirs(self) -> None:
        """저장 디렉토리 생성"""
        os.makedirs(self.save_dir, exist_ok=True)
        os.makedirs(os.path.join(self.save_dir, "agents"), exist_ok=True)

    # ── 저장 ──

    def save_all(
        self,
        agents: List[Agent],
        time_manager,
    ) -> Dict[str, Any]:
        """전체 시뮬레이션 상태를 JSON 파일로 저장

        Returns:
            저장 결과 요약 dict
        """
        self._ensure_dirs()
        saved_agents = []

        # 1) game_state.json - 시간 매니저 상태
        game_state = {
            "total_game_minutes": time_manager.total_game_minutes,
            "speed": time_manager.speed,
            "paused": time_manager.paused,
            "day": time_manager.day,
            "hour": time_manager.hour,
            "minute": time_manager.minute,
            "saved_at": time.time(),
        }
        game_state_path = os.path.join(self.save_dir, "game_state.json")
        self._write_json(game_state_path, game_state)
        logger.info("Saved game state: Day %d %02d:%02d", game_state["day"], game_state["hour"], game_state["minute"])

        # 2) agents/agent_{id}.json - 에이전트별 파일
        for agent in agents:
            try:
                agent_data = agent.to_save_dict()
                agent_path = os.path.join(self.save_dir, "agents", f"agent_{agent.id}.json")
                self._write_json(agent_path, agent_data)
                saved_agents.append(agent.id)
                logger.info(
                    "Saved agent %s (%s): %d memories",
                    agent.name, agent.id, agent.memory_stream.count(),
                )
            except Exception as e:
                logger.error("Failed to save agent %s: %s", agent.id, e)

        self._last_save_time = time.time()

        return {
            "saved_agents": len(saved_agents),
            "agent_ids": saved_agents,
            "game_state": game_state,
            "save_dir": self.save_dir,
        }

    # ── 로드 ──

    def load_all(self) -> Tuple[List[Agent], Optional[Dict]]:
        """저장된 JSON 파일에서 시뮬레이션 상태 복원

        Returns:
            (agents_list, time_state_dict)
            time_state_dict는 game_state.json의 내용.
            저장 파일이 없으면 ([], None) 반환.
        """
        # 1) game_state.json 로드
        game_state_path = os.path.join(self.save_dir, "game_state.json")
        time_state = self._read_json(game_state_path)
        if time_state is None:
            logger.warning("No save data found at %s", self.save_dir)
            return [], None

        logger.info(
            "Loading game state: Day %d %02d:%02d",
            time_state.get("day", 0),
            time_state.get("hour", 0),
            time_state.get("minute", 0),
        )

        # 2) agents/ 디렉토리에서 에이전트 파일 로드
        agents_dir = os.path.join(self.save_dir, "agents")
        agents: List[Agent] = []

        if not os.path.isdir(agents_dir):
            logger.warning("No agents directory found at %s", agents_dir)
            return [], time_state

        for filename in sorted(os.listdir(agents_dir)):
            if not filename.endswith(".json"):
                continue

            agent_path = os.path.join(agents_dir, filename)
            try:
                agent_data = self._read_json(agent_path)
                if agent_data is None:
                    continue
                agent = Agent.from_save_dict(agent_data)
                agents.append(agent)
            except Exception as e:
                logger.error("Failed to load agent from %s: %s", filename, e)

        logger.info("Loaded %d agents from save data", len(agents))

        # 3) 임베딩 배치 재생성 (로드 후)
        total_regenerated = 0
        for agent in agents:
            try:
                count = agent.memory_stream.regenerate_embeddings_batch()
                total_regenerated += count
            except Exception as e:
                logger.warning(
                    "Embedding regeneration failed for %s, will use zero vectors: %s",
                    agent.name, e,
                )

        if total_regenerated > 0:
            logger.info("Regenerated embeddings for %d total memories", total_regenerated)

        return agents, time_state

    # ── 자동 저장 체크 ──

    def should_auto_save(self) -> bool:
        """자동 저장 시점인지 확인"""
        if self.auto_save_interval <= 0:
            return False
        return (time.time() - self._last_save_time) >= self.auto_save_interval

    # ── 저장 파일 존재 여부 ──

    def has_save_data(self) -> bool:
        """저장 파일이 존재하는지 확인"""
        game_state_path = os.path.join(self.save_dir, "game_state.json")
        return os.path.isfile(game_state_path)

    # ── 저장 데이터 삭제 ──

    def clear_save_data(self) -> None:
        """저장 데이터 전체 삭제"""
        import shutil
        if os.path.isdir(self.save_dir):
            shutil.rmtree(self.save_dir)
            logger.info("Cleared save data at %s", self.save_dir)

    # ── JSON 유틸리티 ──

    @staticmethod
    def _write_json(path: str, data: dict) -> None:
        """JSON 파일 쓰기 (원자적: 임시 파일 -> rename)"""
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            # 원자적 교체 (Windows에서는 기존 파일 먼저 삭제)
            if os.path.exists(path):
                os.remove(path)
            os.rename(tmp_path, path)
        except Exception:
            # 임시 파일 정리
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise

    @staticmethod
    def _read_json(path: str) -> Optional[dict]:
        """JSON 파일 읽기 (없거나 손상 시 None 반환)"""
        if not os.path.isfile(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error("Failed to read JSON file %s: %s", path, e)
            return None


# 싱글톤 인스턴스
persistence_manager = PersistenceManager()
