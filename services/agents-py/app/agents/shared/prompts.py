"""Shared prompt fragments — port of `src/agents/shared/blocks.ts`.

Each agent composes its system prompt from a small, situation-specific set of
these blocks so behaviour stays predictable per phase.
"""
from __future__ import annotations

CHART_RULES = """CHART / TABLE / METRIC VISUAL CONTRACT:
Every data question gets a visual. Emit one of these blocks:

[CHART:{"type":"<type>","title":"...","xKey":"...","yKey":"...","data":[...]}]
  type ∈ bar | horizontal-bar | stacked-bar | line | area | pie | donut |
         scatter | bubble | combo | funnel | radar | treemap | histogram |
         bullet | waterfall | heatmap | progress-bar | gauge

[TABLE:{"title":"...","columns":[...],"rows":[[...]]}]   max 10 rows

[METRIC:{"title":"...","value":"...","subtitle":"...","trend":"up|down|neutral"}]

Rules:
- Use real query results from your tool calls; never fabricate numbers.
- Numeric values in CHART data arrays must be raw numbers (no $ or commas).
- xKey/yKey must exactly match keys in each data object.
- Max 12 data points in a chart.
- Write a 1–2 sentence insight BEFORE the visual block."""

SQL_SAFETY_RULES = """SQL SAFETY:
- Only SELECT statements. No INSERT / UPDATE / DELETE / DROP / ALTER / CREATE.
- Always fully qualify table names with the schema (e.g. "proj_42_warehouse"."policies").
- If the schema/column you need doesn't exist, say so plainly — do not invent one."""

RESPONSE_RULES = """RESPONSE FORMAT:
- Use **bold** for entity names and key numbers.
- Each "- " bullet on its own line (preceded by blank line). NEVER inline bullets.
- Keep prose to 2–3 sentences before the bullet list.
- For data questions: emit the visual block AFTER the insight, BEFORE any
  closing sentence."""


def build_transform_sql_rules(raw_schema: str, warehouse_schema: str) -> str:
    return f"""TRANSFORMATION SQL — kind decides the DDL:
- kind="cleanse"   → CREATE TABLE "{warehouse_schema}"."<name>" AS SELECT ...   (materialised)
- kind="rename"    → CREATE TABLE "{warehouse_schema}"."<name>" AS SELECT ...   (materialised)
- kind="join"      → CREATE TABLE "{warehouse_schema}"."<name>" AS SELECT ...   (materialised)
- kind="aggregate" → CREATE OR REPLACE VIEW "{warehouse_schema}"."<name>" AS SELECT ...   (live view)
- kind="filter"    → CREATE OR REPLACE VIEW "{warehouse_schema}"."<name>" AS SELECT ...   (live view)
- kind="view"      → CREATE OR REPLACE VIEW "{warehouse_schema}"."<name>" AS SELECT ...   (live view)

Why: cleansed/joined data is the warehouse's source of truth — store it as a
table so downstream queries are cheap and reproducible. Aggregations and
filters stay as views so they always reflect the latest underlying data.

Other rules:
- Target schema is ALWAYS "{warehouse_schema}". Never write to "public", "{raw_schema}", or any other schema.
- Always fully-qualify the target: "{warehouse_schema}"."my_table".
- Source tables go in the sourceTables array AND in the FROM clause, fully
  qualified ("{raw_schema}"."x" or "{warehouse_schema}"."y").
- Column-renames in cleansing should preserve original meaning; do not invent
  computed columns the user didn't ask for.
- A join transformation that depends on cleansed data must reference the
  cleansed warehouse table, not the raw source."""
