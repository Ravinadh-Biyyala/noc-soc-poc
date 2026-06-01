"""LangSmith tracing setup.

LangChain / LangGraph auto-emit traces when the LANGSMITH_* env vars are
present. pydantic-settings reads them into our Settings object but does NOT
push them into os.environ, so we copy them across here at boot. After this runs
every agent / LLM / tool call in the process is traced into the configured
project (default: ``genbi-agents``) with no per-call code.
"""
from __future__ import annotations

import logging
import os

from .config import Settings

log = logging.getLogger("agents.tracing")


def configure_tracing(settings: Settings) -> None:
    if not settings.langsmith_tracing or not settings.langsmith_api_key:
        log.warning(
            "LangSmith tracing disabled (LANGSMITH_TRACING=%s, api_key set=%s)",
            settings.langsmith_tracing,
            bool(settings.langsmith_api_key),
        )
        os.environ["LANGSMITH_TRACING"] = "false"
        return

    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    # Legacy aliases some langchain versions still read.
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_API_KEY", settings.langsmith_api_key)
    os.environ.setdefault("LANGCHAIN_ENDPOINT", settings.langsmith_endpoint)
    os.environ.setdefault("LANGCHAIN_PROJECT", settings.langsmith_project)

    log.info("LangSmith tracing enabled -> project '%s'", settings.langsmith_project)
