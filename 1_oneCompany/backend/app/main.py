import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import characters, world, avatars, agents
from app.api.websocket import websocket_endpoint, ws_manager
from app.services.simulation_loop import auto_simulator

logger = logging.getLogger(__name__)

app = FastAPI(
    title="OneCompany Village API",
    description="Generative Agents Backend Server",
    version="0.1.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우터 등록
app.include_router(characters.router, prefix="/api/characters", tags=["characters"])
app.include_router(world.router, prefix="/api/world", tags=["world"])
app.include_router(avatars.router, prefix="/api/avatars", tags=["avatars"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])

# WebSocket 엔드포인트
app.add_api_websocket_route("/ws", websocket_endpoint)


@app.on_event("startup")
async def startup_event():
    """Wire AutoSimulator callback to WebSocket broadcast on startup."""
    auto_simulator.set_callback(ws_manager.broadcast_simulation_result)
    logger.info(
        "AutoSimulator callback wired to WebSocket broadcast. "
        "Call POST /api/agents/simulate/auto/start to begin."
    )


@app.get("/")
async def root():
    return {"message": "OneCompany Village API", "status": "running"}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}
