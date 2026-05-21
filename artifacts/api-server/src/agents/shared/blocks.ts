/**
 * Shared prompt fragments used by multiple agents.
 *
 * Each new agent (data-engineer / data-modeler / analyst-chat) composes its
 * system prompt from a small, situation-specific set of these blocks. This is
 * the architectural payoff for "instead of 1 single system prompt, make it
 * easy for the agent to understand various situations" — each agent gets only
 * the blocks that apply to its job, so behaviour is predictable per phase.
 */

export const CHART_RULES = `CHART / TABLE / METRIC VISUAL CONTRACT:
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
- Write a 1–2 sentence insight BEFORE the visual block.`;

export const SQL_SAFETY_RULES = `SQL SAFETY:
- Only SELECT statements. No INSERT / UPDATE / DELETE / DROP / ALTER / CREATE.
- Always fully qualify table names with the schema (e.g. "proj_42_warehouse"."policies").
- If the schema/column you need doesn't exist, say so plainly — do not invent one.`;

export function buildTransformSqlRules(rawSchema: string, warehouseSchema: string): string {
  return `TRANSFORMATION SQL — kind decides the DDL:
- kind="cleanse"   → CREATE TABLE "${warehouseSchema}"."<name>" AS SELECT ...   (materialised)
- kind="rename"    → CREATE TABLE "${warehouseSchema}"."<name>" AS SELECT ...   (materialised)
- kind="join"      → CREATE TABLE "${warehouseSchema}"."<name>" AS SELECT ...   (materialised)
- kind="aggregate" → CREATE OR REPLACE VIEW "${warehouseSchema}"."<name>" AS SELECT ...   (live view)
- kind="filter"    → CREATE OR REPLACE VIEW "${warehouseSchema}"."<name>" AS SELECT ...   (live view)
- kind="view"      → CREATE OR REPLACE VIEW "${warehouseSchema}"."<name>" AS SELECT ...   (live view)

Why: cleansed/joined data is the warehouse's source of truth — store it as a
table so downstream queries are cheap and reproducible. Aggregations and
filters stay as views so they always reflect the latest underlying data.

Other rules:
- Target schema is ALWAYS "${warehouseSchema}". Never write to "public", "${rawSchema}", or any other schema.
- Always fully-qualify the target: "${warehouseSchema}"."my_table".
- Source tables go in the sourceTables array AND in the FROM clause, fully
  qualified ("${rawSchema}"."x" or "${warehouseSchema}"."y").
- Column-renames in cleansing should preserve original meaning; do not invent
  computed columns the user didn't ask for.
- A join transformation that depends on cleansed data must reference the
  cleansed warehouse table, not the raw source.`;
}

/** @deprecated Use buildTransformSqlRules(rawSchema, warehouseSchema). */
export const TRANSFORM_SQL_RULES = buildTransformSqlRules("raw", "warehouse");

export const RESPONSE_RULES = `RESPONSE FORMAT:
- Use **bold** for entity names and key numbers.
- Each "- " bullet on its own line (preceded by blank line). NEVER inline bullets.
- Keep prose to 2–3 sentences before the bullet list.
- For data questions: emit the visual block AFTER the insight, BEFORE any
  closing sentence.`;
