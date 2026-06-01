"""Visuals-catalog knowledge source loader.

`visuals_catalog.json` is extracted from the frontend's VisualsCatalog page and
fed to the Data Visualization agent so it picks a chart type the dashboard
renderer can actually draw. The full catalog is large, so the system prompt gets
a compact digest and the agent fetches detail on demand via a tool.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_CATALOG_PATH = Path(__file__).with_name("visuals_catalog.json")


@lru_cache(maxsize=1)
def load_catalog() -> list[dict[str, Any]]:
    data = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return data.get("charts", [])


def supported_charts() -> list[dict[str, Any]]:
    return [c for c in load_catalog() if c.get("supported")]


def supported_chart_types() -> list[str]:
    seen: list[str] = []
    for c in supported_charts():
        ct = c.get("dashboardChartType")
        if ct and ct not in seen:
            seen.append(ct)
    return seen


def catalog_digest() -> str:
    """One compact line per *supported* chart for the system prompt."""
    lines = []
    for c in supported_charts():
        lines.append(
            f"- {c['dashboardChartType']} ({c['name']}): {c['whenToUse']} Needs: {c['dataNeeded']}"
        )
    return "\n".join(lines)


def lookup(query: str | None = None) -> list[dict[str, Any]]:
    """Return full catalog entries, optionally filtered by category or a term in
    name/tags/whenToUse. Used by the get_visuals_catalog tool."""
    charts = supported_charts()
    if not query:
        return charts
    q = query.strip().lower()
    out = [
        c
        for c in charts
        if q == (c.get("category") or "").lower()
        or q in c["name"].lower()
        or q in (c.get("whenToUse") or "").lower()
        or any(q in t.lower() for t in c.get("tags", []))
    ]
    return out or charts
