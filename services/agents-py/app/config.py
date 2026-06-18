"""Service configuration.

Loaded from the repo-root `.env` (shared with the Express server) plus an
optional service-local `.env` that overrides it. Only the Loki + HTTP-server
settings are used; any other keys in `.env` are ignored.
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

    # --- HTTP server ---
    agents_port: int = 8000
    cors_origin: str = "http://localhost:5173"

    # --- Loki logs server (read-only HTTP API) ---
    loki_url: str = "http://65.0.120.127:3100"
    # The dashboard fires ~11 queries in parallel; the metric `unwrap` ranking over
    # ~112 devices is the slow one (~10s+ alone, more under contention). Keep this
    # comfortably above it so those panels populate instead of 502-ing (which the UI
    # showed as "Peak CPU 0%").
    loki_timeout: int = 60
    # Lookback window for discovering label values in the filter dropdowns. Loki's
    # label endpoints are time-bounded; a wide default surfaces every value
    # (e.g. all devices) regardless of the smaller query time-range.
    loki_label_window: str = "30d"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
