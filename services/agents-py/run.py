"""Entrypoint: `python run.py`.

psycopg's async mode cannot run on Windows' default ProactorEventLoop, and
uvicorn's own loop setup re-applies the Proactor policy. So we create the
Selector loop ourselves and start uvicorn with ``loop="none"`` so it uses our
loop instead of configuring its own.
"""
from __future__ import annotations

import asyncio
import os
import sys

import uvicorn

from app.config import get_settings

# Truthy AGENTS_RELOAD turns on uvicorn's dev auto-reload so code edits take
# effect without a manual restart. It's opt-in (off in production) because the
# reloader spawns worker subprocesses — fine here since `app.main` sets the
# Windows Selector loop policy at import time, so each reloaded worker still
# gets a psycopg-compatible loop.
_RELOAD = os.environ.get("AGENTS_RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    settings = get_settings()

    if _RELOAD:
        # Let uvicorn own the supervisor + worker lifecycle so it can restart on
        # file changes. loop="none" keeps it from re-applying the Proactor policy;
        # the worker inherits the Selector loop via app.main's import-time setup.
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=settings.agents_port,
            log_level="info",
            loop="none",
            reload=True,
            reload_dirs=[os.path.join(os.path.dirname(__file__), "app")],
        )
        return

    config = uvicorn.Config(
        "app.main:app",
        host="0.0.0.0",
        port=settings.agents_port,
        log_level="info",
        loop="none",  # don't let uvicorn re-apply the Proactor policy
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    main()
