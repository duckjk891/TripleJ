"""에이전트 API - Phase B 에이전트 생성/관리/시뮬레이션"""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.simulation_loop import simulation, auto_simulator
from app.services.world_data import get_spawn_locations
from agent_core.agent import Agent

router = APIRouter()

_agent_counter = itertools.count(1)


class AgentCreate(BaseModel):
    name: str
    occupation: str
    avatar_id: str
    spawn_location: str
    traits: str = ""
    backstory: str = ""
    daily_routine: str = ""


class AgentResponse(BaseModel):
    id: str
    name: str
    occupation: str
    traits: str
    position: dict
    location_name: str
    current_action: str
    current_plan: Optional[str]
    memory_count: int
    recent_memories: list
    daily_plan: list
    is_conversing: bool


@router.post("", status_code=201)
async def create_agent(data: AgentCreate):
    """Phase B 에이전트 생성"""
    locations = get_spawn_locations()
    location = next((l for l in locations if l["id"] == data.spawn_location), None)
    if not location:
        raise HTTPException(status_code=400, detail=f"Invalid spawn location: {data.spawn_location}")

    agent_id = f"agent_{next(_agent_counter)}"

    agent = Agent(
        agent_id=agent_id,
        name=data.name,
        occupation=data.occupation,
        traits=data.traits,
        backstory=data.backstory,
        daily_routine=data.daily_routine,
    )
    agent.set_position(location["x"], location["y"])
    agent.set_location_name(location["name"])

    # 초기화 (seed memories + daily plan)
    agent.initialize()

    simulation.add_agent(agent)

    return agent.to_dict()


@router.get("")
async def get_agents():
    """모든 에이전트 목록"""
    return [a.to_dict() for a in simulation.get_all_agents()]


# ── Preset loading (MUST be before /{agent_id} to avoid path conflict) ──

PRESETS_DIR = Path(__file__).resolve().parent.parent.parent / "presets"


@router.post("/preset/{preset_name}")
async def load_preset(preset_name: str):
    """프리셋 JSON 파일에서 에이전트 일괄 생성"""
    global _agent_counter

    preset_file = PRESETS_DIR / f"{preset_name}.json"
    if not preset_file.exists():
        # 사용 가능한 프리셋 목록 안내
        available = [f.stem for f in PRESETS_DIR.glob("*.json")] if PRESETS_DIR.exists() else []
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_name}' not found. Available: {available}",
        )

    agents_data = json.loads(preset_file.read_text(encoding="utf-8"))
    locations = get_spawn_locations()

    # 기존 에이전트 모두 제거
    for agent_id in list(simulation.agents.keys()):
        simulation.remove_agent(agent_id)
    _agent_counter = itertools.count(1)

    created = []
    for data in agents_data:
        location = next((l for l in locations if l["id"] == data["spawn_location"]), None)
        if not location:
            continue

        agent_id = f"agent_{next(_agent_counter)}"
        agent = Agent(
            agent_id=agent_id,
            name=data["name"],
            occupation=data["occupation"],
            traits=data.get("traits", ""),
            backstory=data.get("backstory", ""),
            daily_routine=data.get("daily_routine", ""),
        )
        agent.set_position(location["x"], location["y"])
        agent.set_location_name(location["name"])
        agent.initialize()
        simulation.add_agent(agent)
        created.append({"id": agent_id, "name": data["name"]})

    return {"status": "loaded", "preset": preset_name, "agents": created}


@router.get("/presets")
async def list_presets():
    """사용 가능한 프리셋 목록"""
    if not PRESETS_DIR.exists():
        return {"presets": []}
    return {"presets": [f.stem for f in PRESETS_DIR.glob("*.json")]}


# ── Auto simulation control (MUST be before /{agent_id} to avoid path conflict) ──


@router.post("/simulate/auto/start")
async def start_auto_simulation(interval: float = 2.0):
    """자동 시뮬레이션 시작"""
    if auto_simulator.is_running:
        return {"status": "already_running", "interval": auto_simulator.interval}
    auto_simulator.interval = interval
    await auto_simulator.start()
    return {"status": "started", "interval": auto_simulator.interval}


@router.post("/simulate/auto/stop")
async def stop_auto_simulation():
    """자동 시뮬레이션 중지"""
    if not auto_simulator.is_running:
        return {"status": "already_stopped"}
    await auto_simulator.stop()
    return {"status": "stopped"}


@router.get("/simulate/auto/status")
async def get_auto_simulation_status():
    """자동 시뮬레이션 상태 조회"""
    return {
        "running": auto_simulator.is_running,
        "interval": auto_simulator.interval,
    }


# ── Persistence (save/load) - MUST be before /{agent_id} to avoid path conflict ──


@router.post("/save")
async def save_simulation():
    """시뮬레이션 상태 수동 저장"""
    from app.services.persistence import persistence_manager
    from app.services.time_manager import time_manager

    agents = simulation.get_all_agents()
    if not agents:
        return {"status": "nothing_to_save", "saved_agents": 0}

    try:
        result = persistence_manager.save_all(agents, time_manager)
        return {"status": "saved", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")


@router.post("/load")
async def load_simulation():
    """저장된 시뮬레이션 상태 복원"""
    from app.services.persistence import persistence_manager
    from app.services.time_manager import time_manager

    if not persistence_manager.has_save_data():
        raise HTTPException(status_code=404, detail="No save data found")

    try:
        agents, time_state = persistence_manager.load_all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Load failed: {str(e)}")

    if time_state is None:
        raise HTTPException(status_code=404, detail="Save data is corrupt or empty")

    # 기존 에이전트 모두 제거
    for agent_id in list(simulation.agents.keys()):
        simulation.remove_agent(agent_id)

    # 복원된 에이전트 추가
    for agent in agents:
        simulation.add_agent(agent)

    # 시간 매니저 상태 복원
    time_manager.total_game_minutes = time_state["total_game_minutes"]
    time_manager.speed = time_state["speed"]
    time_manager.paused = time_state.get("paused", False)
    time_manager._last_real_time = __import__("time").time()

    # agent_counter 업데이트 (복원된 에이전트 ID와 충돌 방지)
    global _agent_counter
    max_id = 0
    for agent in agents:
        try:
            num = int(agent.id.replace("agent_", ""))
            max_id = max(max_id, num)
        except ValueError:
            pass
    _agent_counter = itertools.count(max_id + 1)

    return {
        "status": "loaded",
        "loaded_agents": len(agents),
        "agent_ids": [a.id for a in agents],
        "time_state": {
            "day": time_state.get("day"),
            "hour": time_state.get("hour"),
            "minute": time_state.get("minute"),
        },
    }


@router.post("/simulate")
async def run_simulation_step():
    """시뮬레이션 한 스텝 실행"""
    result = simulation.run_timestep()
    return result


@router.get("/stats/api")
async def get_api_stats():
    """OpenAI API 호출 통계"""
    from agent_core.prompt_template.gpt_structure import get_gpt
    return get_gpt().get_stats()


# ── Dynamic path routes (MUST come LAST to avoid capturing /simulate, /save, /load, /stats) ──


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """에이전트 상세 정보"""
    agent = simulation.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent.to_dict()


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    """에이전트 삭제"""
    if not simulation.get_agent(agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    simulation.remove_agent(agent_id)
    return {"message": "Agent deleted", "id": agent_id}


@router.get("/{agent_id}/memories")
async def get_agent_memories(agent_id: str, limit: int = 20):
    """에이전트 기억 조회"""
    agent = simulation.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    memories = agent.memory_stream.get_recent(limit)
    return [
        {
            "id": m.id,
            "content": m.content,
            "importance": m.importance,
            "type": m.memory_type,
            "created_at": m.created_at.isoformat(),
        }
        for m in memories
    ]


@router.get("/{agent_id}/plan")
async def get_agent_plan(agent_id: str):
    """에이전트 계획 조회"""
    agent = simulation.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return {
        "daily_plan": [
            {"start": p.start_time, "end": p.end_time, "desc": p.description, "loc": p.location}
            for p in agent.daily_plan
        ],
        "current": agent.current_plan.description if agent.current_plan else None,
    }
