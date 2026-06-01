"""Service configuration.

Loaded from the repo-root `.env` (shared with the Express server) plus an
optional service-local `.env` that overrides it — e.g. to point tracing at the
new `genbi-agents` LangSmith project without touching the Express config.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# services/agents-py/app/config.py -> parents[3] == repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SERVICE_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    # Read the shared root .env first, then the service-local .env (which wins).
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_ROOT / ".env"), str(_SERVICE_ROOT / ".env")),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database (same Postgres as Express / Drizzle) ---
    database_url: str

    # --- LLM (mirrors lib/integrations-openai-ai-server/src/client.ts) ---
    ai_integrations_openai_api_key: str
    ai_integrations_openai_base_url: str
    openai_model: str = "gpt-4.1-mini"
    openai_max_tokens: int = 4096

    # --- LangSmith tracing ---
    langsmith_tracing: bool = True
    langsmith_api_key: str | None = None
    langsmith_endpoint: str = "https://api.smith.langchain.com"
    langsmith_project: str = "genbi-agents"

    # --- HTTP server ---
    agents_port: int = 8000
    cors_origin: str = "http://localhost:5173"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
