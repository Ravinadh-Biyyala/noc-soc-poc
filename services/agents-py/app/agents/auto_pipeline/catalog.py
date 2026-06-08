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


# Categories ordered so the digest reads top-to-bottom like a real dashboard
# narrative: headline scorecards first, then what-it's-made-of, how-it-moves,
# who-leads, how-it-spreads, what-relates, what-flows, and finally the detail grid.
_CATEGORY_ORDER = [
    "performance",
    "composition",
    "trend",
    "comparison",
    "distribution",
    "relationship",
    "flow",
    "tabular",
]
_CATEGORY_LABEL = {
    "performance": "PERFORMANCE vs TARGET — scorecards & dials",
    "composition": "COMPOSITION — part-to-whole",
    "trend": "TREND — change over time",
    "comparison": "COMPARISON & RANKING",
    "distribution": "DISTRIBUTION & SPREAD",
    "relationship": "RELATIONSHIP & CORRELATION",
    "flow": "FLOW & CHANGE",
    "tabular": "DETAIL & MULTI-KPI TABLES",
}


def catalog_digest_by_category() -> str:
    """The supported catalog grouped by business category.

    Lets the visualization agent walk the catalog systematically — one category
    at a time — instead of cherry-picking the first easy bar chart. The token
    immediately after the leading dash on each line is the `chartType` to emit.
    """
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for c in supported_charts():
        by_cat.setdefault(c.get("category") or "other", []).append(c)

    ordered = [c for c in _CATEGORY_ORDER if c in by_cat]
    ordered += [c for c in by_cat if c not in _CATEGORY_ORDER]

    lines: list[str] = []
    for cat in ordered:
        lines.append(_CATEGORY_LABEL.get(cat, cat.upper()) + ":")
        for c in by_cat[cat]:
            lines.append(
                f"  - {c['dashboardChartType']} ({c['name']}): {c['whenToUse']} Needs: {c['dataNeeded']}"
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
