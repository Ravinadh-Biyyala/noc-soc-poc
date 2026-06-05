"""Intent interview for guided (human-in-the-loop) mode.

After the profiler runs, this module asks the LLM to propose a short set of
business-intent questions tailored to the profiled columns. The questions are
surfaced to the user (via the graph's `interrupt`), the user answers, and the
answers are rendered into a compact `user_intent` block that the cleaning, KPI
builder, analysis and visualization phases consume so the dashboard answers what
the user actually wants to know.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")

NAME = "auto-interview"

# The first question is always this open-ended intent prompt; the LLM adds
# tailored follow-ups. Kept as a constant so the deterministic fallback and the
# generated set agree on the primary question id.
PRIMARY_QUESTION = {
    "id": "intent",
    "question": "What do you want to understand about your data?",
    "kind": "text",
    "options": [],
    "hint": "e.g. \"Find the properties that are underperforming and why\".",
}


class IntentQuestion(BaseModel):
    id: str = Field(description="Short stable snake_case id, e.g. 'time_window'.")
    question: str = Field(description="The question shown to the user.")
    kind: Literal["text", "choice"] = Field(default="text")
    options: list[str] = Field(default_factory=list, description="Choices when kind='choice'.")
    hint: str = Field(default="", description="Optional one-line example / clarification.")


class QuestionSet(BaseModel):
    questions: list[IntentQuestion] = Field(
        default_factory=list,
        description="3-5 questions total. Cover: the entity to categorise, the metrics that define "
                    "good vs bad performance, and the time window for any rolling trend.",
    )


def _fallback_questions() -> list[dict[str, Any]]:
    return [
        dict(PRIMARY_QUESTION),
        {
            "id": "entity",
            "question": "Which entity should we score and categorise (e.g. property, hotel, region)?",
            "kind": "text", "options": [], "hint": "Name the thing you want ranked as performing vs underperforming.",
        },
        {
            "id": "metrics",
            "question": "Which metrics define under-performance?",
            "kind": "text", "options": [],
            "hint": "e.g. revenue vs maintenance cost vs other costs.",
        },
        {
            "id": "time_window",
            "question": "What time window should trends use?",
            "kind": "choice", "options": ["Rolling 3 months", "Rolling 6 months", "Rolling 12 months", "No trend"],
            "hint": "Used for rolling-average KPIs.",
        },
    ]


def _profile_context(profile: dict[str, Any]) -> str:
    lines = ["PROFILER SUMMARY: " + (profile.get("summary") or "")]
    raw_tables = profile.get("rawTables") or []
    if raw_tables:
        lines.append("")
        lines.append("RAW TABLES:")
        for t in raw_tables:
            cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t.get("columns", [])[:24])
            lines.append(f'- "{t["tableName"]}": {cols}')
    for note in profile.get("tables") or []:
        role = note.get("role") or ""
        keys = ", ".join(note.get("keyColumns") or [])
        extra = f" (role: {role}; keys: {keys})" if (role or keys) else ""
        if note.get("note"):
            lines.append(f"  · {note['table']}{extra}: {note['note']}")
    return "\n".join(lines)


def _build_prompt(project_name: str, description: str | None, profile: dict[str, Any]) -> str:
    lines = [
        "You are the Intake agent for a guided BI pipeline. Your job is to ask the USER a few sharp "
        "questions so the rest of the pipeline builds exactly the KPIs and dashboard they want.",
        f'PROJECT: "{project_name}".',
    ]
    if description:
        lines.append(f"PROJECT GOAL (context): {description}")
    lines += [
        "",
        _profile_context(profile),
        "",
        "YOUR JOB:",
        f'1. Start with this exact open-ended question (id="{PRIMARY_QUESTION["id"]}"): '
        f'"{PRIMARY_QUESTION["question"]}".',
        "2. Then add 2-4 tailored follow-ups grounded in the columns above. Cover: which ENTITY to "
        "categorise (performing vs underperforming), which METRICS define performance (e.g. revenue "
        "vs maintenance/other cost), and the TIME WINDOW for rolling trends (offer choices like "
        "'Rolling 3 months').",
        "3. Prefer kind='choice' with concrete options when the column data implies a small set.",
        "4. Call submit_questions ONCE with 3-5 questions total. Then stop. Do not run any other tools.",
    ]
    return "\n".join(lines)


async def generate_questions(state: dict[str, Any]) -> dict[str, Any]:
    """Graph node: produce intent questions from the profile. Returns {"questions": [...]}."""
    project_id = state["project_id"]
    profile = state.get("profile") or {}

    holder: dict[str, Any] = {}
    tools = [
        make_submit_tool(
            name="submit_questions",
            description="Hand back the 3-5 intent questions for the user. Call once.",
            model=QuestionSet, holder=holder,
        ),
    ]
    system_prompt = _build_prompt(
        state.get("project_name", ""), state.get("project_description"), profile
    )
    await run_subagent(
        name=NAME, project_id=project_id, system_prompt=system_prompt,
        user_message="Generate the intent questions now, then call submit_questions.",
        tools=tools, max_iterations=4, max_tokens=2048,
    )

    questions = holder.get("questions") or []
    if not questions:
        questions = _fallback_questions()
    else:
        # Guarantee the primary open-ended question leads the set.
        if not any((q.get("id") == PRIMARY_QUESTION["id"]) for q in questions):
            questions = [dict(PRIMARY_QUESTION), *questions]
    return {"questions": questions}


def _normalize_intent(
    answers: Any, questions: list[dict[str, Any]] | None = None, fallback: str | None = None
) -> str:
    """Render the user's answers into a compact Q/A block threaded into downstream
    prompts. Tolerates empty/blank answers — falls back to the project description."""
    questions = questions or []
    q_by_id = {q.get("id"): q for q in questions}

    pairs: list[str] = []
    if isinstance(answers, dict):
        for qid, val in answers.items():
            text = (str(val) if val is not None else "").strip()
            if not text:
                continue
            q = q_by_id.get(qid)
            label = (q or {}).get("question") or qid
            pairs.append(f"- {label} -> {text}")

    if not pairs:
        return (fallback or "").strip()
    return "USER INTENT (answers from the user; prioritise these):\n" + "\n".join(pairs)
