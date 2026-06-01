"""Entrypoint: `python run.py`.

psycopg's async mode cannot run on Windows' default ProactorEventLoop, and
uvicorn's own loop setup re-applies the Proactor policy. So we create the
Selector loop ourselves and start uvicorn with ``loop="none"`` so it uses our
loop instead of configuring its own.
"""
from __future__ import annotations

import asyncio
import sys

import uvicorn

from app.config import get_settings


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    settings = get_settings()
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
