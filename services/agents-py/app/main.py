"""FastAPI entrypoint for the Python agent service.

Boots the connection pool + LangGraph PostgresSaver, configures LangSmith
tracing, and mounts the agent routers. Run with:

    uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

# psycopg's async mode cannot run on Windows' default ProactorEventLoop. Set the
# Selector policy at import time so uvicorn creates a compatible loop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .checkpoint.saver import close_saver, open_saver
from .config import get_settings
from .db.pool import close_pool, open_pool, fetch_one
from .routes import agents, auto_dashboard, metrics, modeling, pipeline, transformations
from .tracing import configure_tracing

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("agents.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_tracing(settings)
    await open_pool(settings.database_url)
    await open_saver(settings.database_url)
    log.info("Agent service ready on port %s", settings.agents_port)
    yield
    await close_saver()
    await close_pool()


app = FastAPI(title="Gen-BI Agents (Python)", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.cors_origin] if _settings.cors_origin else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The agent vertical — same paths the Express routers serve, mounted under /api.
app.include_router(transformations.router, prefix="/api")
app.include_router(modeling.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(auto_dashboard.router, prefix="/api")


@app.get("/healthz")
async def healthz():
    try:
        await fetch_one("SELECT 1 AS ok")
        return {"status": "ok", "project": _settings.langsmith_project}
    except Exception as err:  # noqa: BLE001
        return {"status": "error", "message": str(err)}
