"""
Office Game API - Thin wrapper around 1_oneCompany backend.

This module adds the real 1_oneCompany backend packages to sys.path
and re-exports all routers under the /api/office prefix so that
the platform gateway can proxy to this service without route conflicts.
"""

import sys
import os

# ---------------------------------------------------------------------------
# Load .env from this directory first
# ---------------------------------------------------------------------------
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ---------------------------------------------------------------------------
# Path setup: make `app.*` and `agent_core.*` importable
# ---------------------------------------------------------------------------
# 1_oneCompany/backend  ->  provides `app` package
# 1_oneCompany/          ->  provides `agent_core` package
_ONE_COMPANY_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "1_oneCompany")
)
_ONE_COMPANY_BACKEND = os.path.join(_ONE_COMPANY_ROOT, "backend")

for _p in (_ONE_COMPANY_BACKEND, _ONE_COMPANY_ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ---------------------------------------------------------------------------
# Now we can import from the real implementation
# ---------------------------------------------------------------------------
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging

from app.api import characters, world, avatars, agents
from app.api.websocket import websocket_endpoint, ws_manager
from app.services.simulation_loop import auto_simulator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App creation
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Office Game API",
    description="Platform gateway for OneCompany Village (generative agents)",
    version="0.1.0",
)

# CORS - allow both the main platform UI and the office-game dev port
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Mount routers under /api (office-game-api runs on its own port 8001,
# so no namespace collision with minihompi-api on port 8000)
# ---------------------------------------------------------------------------
app.include_router(characters.router, prefix="/api/characters", tags=["characters"])
app.include_router(world.router,      prefix="/api/world",      tags=["world"])
app.include_router(avatars.router,    prefix="/api/avatars",    tags=["avatars"])
app.include_router(agents.router,     prefix="/api/agents",     tags=["agents"])

# WebSocket endpoint
app.add_api_websocket_route("/ws", websocket_endpoint)

# ---------------------------------------------------------------------------
# Startup: wire AutoSimulator -> WebSocket broadcast
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    auto_simulator.set_callback(ws_manager.broadcast_simulation_result)
    logger.info("AutoSimulator callback wired to WebSocket broadcast.")


# ---------------------------------------------------------------------------
# Convenience endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {
        "message": "Office Game API",
        "status": "running",
        "docs": "/docs",
        "routes_prefix": "/api",
    }


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}
