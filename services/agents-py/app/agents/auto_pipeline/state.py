"""Shared state for the auto-mode orchestrator graph.

The 5 analysis lenses run as parallel branches, so `findings` and `errors` use
reducers to merge concurrent writes deterministically (LangGraph requires an
annotated reducer on any channel written by more than one node in a super-step).
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


def merge_dict(left: dict[str, Any] | None, right: dict[str, Any] | None) -> dict[str, Any]:
    return {**(left or {}), **(right or {})}


class AutoPipelineState(TypedDict, total=False):
    project_id: int
    project_name: str
    project_description: str | None

    # Phase outputs
    profile: dict[str, Any]          # Data Profiler — raw schema metadata + narrative
    cleaned: dict[str, Any]          # Data Cleaning — {tables: [...], summary}
    merge: dict[str, Any]            # Data Merging — {strategy, flatTable?, links?, summary}
    findings: Annotated[dict[str, Any], merge_dict]   # lens -> finding (parallel writers)
    charts: list[dict[str, Any]]     # Data Visualization — chart specs
    report: str                      # narrative report (markdown)
    dashboard_id: int

    errors: Annotated[list[str], operator.add]


ANALYSIS_LENSES: list[str] = [
    "descriptive",
    "diagnostic",
    "predictive",
    "prescriptive",
    "comparative",
]
