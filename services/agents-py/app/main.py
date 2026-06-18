"""FastAPI entrypoint for the Loki logs service.

Exposes the read-only Loki vertical (labels / values / query) consumed by the
"Loki Logs" dashboard tab. Run with:

    python run.py            # serves on :8000
"""
from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

# Keep the Windows Selector event loop policy for consistency with httpx/uvicorn.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import loki

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("loki.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("Loki service ready on port %s (loki_url=%s)", settings.agents_port, settings.loki_url)
    yield


app = FastAPI(title="Loki Logs Service", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.cors_origin] if _settings.cors_origin else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(loki.router, prefix="/api")


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
