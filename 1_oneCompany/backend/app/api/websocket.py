from __future__ import annotations
from typing import List
from fastapi import WebSocket, WebSocketDisconnect
import json

from app.services.character_manager import character_manager


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(data)
            except Exception:
                pass

    async def send_state(self, websocket: WebSocket):
        """현재 전체 캐릭터 상태 전송"""
        characters = [c.to_dict() for c in character_manager.get_all()]
        await websocket.send_text(json.dumps({
            "type": "state_sync",
            "characters": characters,
        }))

    async def broadcast_simulation_result(self, result: dict) -> None:
        """시뮬레이션 결과(actions, conversations, reflections)를 모든 클라이언트에 브로드캐스트"""
        if not self.active_connections:
            return

        # 에이전트 위치 조회를 위한 import (lazy)
        from app.services.simulation_loop import simulation

        # Broadcast each action as a position/action update
        for action in result.get("actions", []):
            agent_id = action.get("agent_id")
            # 에이전트 현재 위치 가져오기
            position = None
            agent = simulation.get_agent(agent_id) if agent_id else None
            if agent:
                position = agent.position

            await self.broadcast({
                "type": "simulation_action",
                "agent_id": agent_id,
                "agent_name": agent.name if agent else agent_id,
                "action_type": action.get("type"),
                "action": action.get("description"),    # FE expects "action"
                "location": action.get("location"),
                "position": position,                    # FE expects position
            })

        # Broadcast conversations
        for convo in result.get("conversations", []):
            # FE expects agents as [{id, name}], BE sends [agent_id, agent_id]
            raw_agents = convo.get("agents", [])
            agent_infos = []
            for aid in raw_agents:
                agent = simulation.get_agent(aid)
                agent_infos.append({
                    "id": aid,
                    "name": agent.name if agent else aid,
                })

            # FE expects dialogue as [{speaker, text}], BE sends [{speaker, content}]
            raw_dialogue = convo.get("dialogue", [])
            dialogue = [
                {"speaker": d.get("speaker", ""), "text": d.get("content", d.get("text", ""))}
                for d in raw_dialogue
            ]

            await self.broadcast({
                "type": "simulation_conversation",
                "agents": agent_infos,
                "dialogue": dialogue,
            })

        # Broadcast reflections
        for reflection in result.get("reflections", []):
            agent = simulation.get_agent(reflection.get("agent_id"))
            await self.broadcast({
                "type": "simulation_reflection",
                "agent_id": reflection.get("agent_id"),
                "agent_name": agent.name if agent else reflection.get("agent_id"),
                "reflections": reflection.get("reflections"),
            })

        # Broadcast time update
        if "time" in result:
            await self.broadcast({
                "type": "simulation_time",
                **result["time"],
            })

        # Broadcast world object state changes
        if "world_objects" in result:
            await self.broadcast({
                "type": "world_objects_update",
                "objects": result["world_objects"],
            })


ws_manager = ConnectionManager()


async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # 연결 즉시 현재 상태 전송
        await ws_manager.send_state(websocket)

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")

            if msg_type == "request_state":
                await ws_manager.send_state(websocket)

            elif msg_type == "position_update":
                char_id = message.get("character_id")
                x = message.get("x")
                y = message.get("y")
                if char_id and x is not None and y is not None:
                    character_manager.update_position(char_id, x, y)
                    await ws_manager.broadcast({
                        "type": "position_update",
                        "character_id": char_id,
                        "x": x,
                        "y": y,
                    })

            elif msg_type == "action_update":
                char_id = message.get("character_id")
                action = message.get("action")
                if char_id and action:
                    character_manager.update_action(char_id, action)
                    await ws_manager.broadcast({
                        "type": "action_update",
                        "character_id": char_id,
                        "action": action,
                    })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
