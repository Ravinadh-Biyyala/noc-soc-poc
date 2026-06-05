"""Narrative report assembler.

Stitches the profiler / cleaning / merging context and the 5 analysis findings
into a business-readable Markdown report. Stored in user_dashboards.agent_log
and returned to the frontend alongside the dashboard.
"""
from __future__ import annotations

from typing import Any

from .state import ANALYSIS_LENSES

_LENS_TITLE = {
    "descriptive": "Descriptive Analysis — What Happened",
    "diagnostic": "Diagnostic Analysis — Why It Happened",
    "predictive": "Predictive Analysis — What's Likely Next",
    "prescriptive": "Prescriptive Analysis — Recommended Actions",
    "comparative": "Comparative Analysis — How Groups Differ",
}


def _exec_summary(state: dict[str, Any]) -> list[str]:
    findings = state.get("findings") or {}
    bullets: list[str] = []
    for lens in ANALYSIS_LENSES:
        f = findings.get(lens) or {}
        kf = f.get("keyFindings") or []
        if kf:
            bullets.append(f"- {kf[0]}")
    return bullets[:6]


def _questions_section(state: dict[str, Any]) -> list[str]:
    """Render the guided-mode interview Q/A so the report explicitly answers the user."""
    answers = state.get("intent_raw") or {}
    questions = state.get("questions") or []
    if not isinstance(answers, dict) or not answers:
        return []
    q_by_id = {q.get("id"): q for q in questions}
    rows: list[str] = []
    for qid, val in answers.items():
        text = (str(val) if val is not None else "").strip()
        if not text:
            continue
        label = (q_by_id.get(qid) or {}).get("question") or qid
        rows.append(f"- **{label}** {text}")
    if not rows:
        return []
    return ["## What You Asked", "", *rows, ""]


def assemble_report(state: dict[str, Any]) -> str:
    name = state.get("project_name") or "Project"
    profile = state.get("profile") or {}
    cleaned = state.get("cleaned") or {}
    merge = state.get("merge") or {}
    kpis = state.get("kpis") or {}
    findings = state.get("findings") or {}

    out: list[str] = [f"# {name} — Automated Insight Report", ""]

    out += _questions_section(state)

    summary_bullets = _exec_summary(state)
    if summary_bullets:
        out += ["## Executive Summary", *summary_bullets, ""]

    # Data preparation context
    out += ["## How This Was Built", ""]
    if profile.get("summary"):
        out.append(f"**Data profiled:** {profile['summary']}")
    if cleaned.get("summary"):
        out.append(f"**Cleaning:** {cleaned['summary']}")
    if merge.get("summary"):
        strat = merge.get("strategy", "")
        out.append(f"**Merging ({strat}):** {merge['summary']}")
    if kpis.get("summary"):
        out.append(f"**KPIs built:** {kpis['summary']}")
        if kpis.get("categorization"):
            out.append(f"**Performance rule:** {kpis['categorization']}")
    out.append("")

    # Per-lens findings
    all_recommendations: list[str] = []
    for lens in ANALYSIS_LENSES:
        f = findings.get(lens)
        if not f:
            continue
        out += [f"## {_LENS_TITLE.get(lens, lens.title())}", ""]
        if f.get("summary"):
            out += [f["summary"], ""]
        for kf in f.get("keyFindings") or []:
            out.append(f"- {kf}")
        if f.get("keyFindings"):
            out.append("")
        for rec in f.get("recommendations") or []:
            all_recommendations.append(rec)

    if all_recommendations:
        out += ["## Recommended Actions", ""]
        for rec in dict.fromkeys(all_recommendations):  # dedupe, keep order
            out.append(f"- {rec}")
        out.append("")

    errors = state.get("errors") or []
    if errors:
        out += ["## Notes", "", *[f"- {e}" for e in errors], ""]

    return "\n".join(out).strip() + "\n"
