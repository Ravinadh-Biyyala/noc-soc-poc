import { CHART_RULES, SQL_SAFETY_RULES } from "../shared/blocks";
import { getProjectSchemaName } from "@workspace/db";

interface WarehouseTableSummary {
  tableName: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
}

interface SemanticModelContext {
  projectId: number;
  projectName: string;
  projectDescription: string | null;
  warehouseTables: WarehouseTableSummary[];
  existingGraph?: {
    facts: string[];
    dimensions: string[];
    joins: Array<{ from: string; to: string; cardinality: string }>;
    status: string;
  } | null;
}

function formatTables(schema: string, tables: WarehouseTableSummary[]): string {
  if (tables.length === 0) return "(warehouse is empty — refuse to model and tell the user to finish Phase 1 first)";
  return tables.map((t) => {
    const cols = t.columns.map((c) => `${c.name} ${c.type}`).join(", ");
    return `- "${schema}"."${t.tableName}" (${t.rowCount} rows) — ${cols}`;
  }).join("\n");
}

/**
 * Phase 2 — Semantic Model pass.
 *
 * Persona: dimensional modeler. Output is a Semantic Graph (facts / dims /
 * joins) written to project_semantic_models. NEVER issues DDL.
 */
export function buildDataModelerSemanticPrompt(ctx: SemanticModelContext): string {
  const warehouseSchema = getProjectSchemaName(ctx.projectId, "warehouse");
  const tablesSummary = formatTables(warehouseSchema, ctx.warehouseTables);

  const existingSummary = !ctx.existingGraph
    ? "(no semantic model yet — design one from scratch)"
    : [
        `Status: ${ctx.existingGraph.status}`,
        `Facts: ${ctx.existingGraph.facts.join(", ") || "(none)"}`,
        `Dimensions: ${ctx.existingGraph.dimensions.join(", ") || "(none)"}`,
        `Joins: ${ctx.existingGraph.joins.map((j) => `${j.from} → ${j.to} (${j.cardinality})`).join("; ") || "(none)"}`,
      ].join("\n");

  return [
    `You are a dimensional-modeling expert for one user project.`,
    ``,
    `PROJECT CONTEXT:`,
    `- Name: ${ctx.projectName}`,
    ctx.projectDescription ? `- User-stated goal: ${ctx.projectDescription}` : `- No stated goal — focus on the most obvious star pattern.`,
    `- Warehouse schema (read-only for you): ${warehouseSchema}`,
    ``,
    `WAREHOUSE TABLES:`,
    tablesSummary,
    ``,
    `EXISTING SEMANTIC MODEL:`,
    existingSummary,
    ``,
    `YOUR JOB:`,
    `1. Inspect the table list. If columns are not visible, call list_warehouse_tables once.`,
    `2. Call propose_star_schema ONCE with:`,
    `   - facts:       tables that hold transactional / event-style rows`,
    `                  (heavy on FK columns, numeric measures, dates).`,
    `   - dimensions:  tables that hold descriptive / lookup rows`,
    `                  (one row per real-world entity, low cardinality changes).`,
    `   - rationale:   1–2 sentences explaining the classification.`,
    `3. Call generate_semantic_graph ONCE with:`,
    `   - facts, dimensions: same as in step 2 (or refined).`,
    `   - joins: every fact→dimension edge plus any dimension→dimension edge`,
    `     you're highly confident about. Format each as`,
    `     { from: "<table>.<column>", to: "<table>.<column>", cardinality: "1:1"|"1:N"|"N:1"|"N:N" }.`,
    `   - rationale: 1–3 sentences on why this shape fits the project goal.`,
    `4. Stop after generate_semantic_graph returns. ONE semantic graph per project.`,
    ``,
    `WHAT YOU NEVER DO:`,
    `- Never issue CREATE / ALTER / DROP. You are a metadata layer — the graph is your output.`,
    `- Never propose a join you couldn't defend in one sentence. Skip uncertain edges.`,
    `- Never emit charts, KPIs, or formulas. Phase 3 (Metric Architect) handles those.`,
    ``,
    `RULES:`,
    `- Prefer "id" / "<entity>_id" matches; treat shared "name" / "status" columns as unlikely joins.`,
    `- Cardinality picks: PK side is "1", FK side is "N". Bridge tables get N:N.`,
    `- A fact with no dimensions is suspicious — re-examine your classification before submitting.`,
  ].join("\n");
}

/** Back-compat — legacy /suggest-relationships callers reuse the same prompt. */
export const buildDataModelerRelationshipsPrompt = buildDataModelerSemanticPrompt;

interface DashboardContext {
  projectId: number;
  projectName: string;
  projectDescription: string | null;
  warehouseTables: WarehouseTableSummary[];
  semanticGraph?: {
    facts: string[];
    dimensions: string[];
    joins: Array<{ from: string; to: string; cardinality: string }>;
  } | null;
}

/**
 * Phase 2B — Dashboard generation pass.
 * Reads the accepted semantic graph and designs 4-6 charts.
 */
export function buildDataModelerDashboardPrompt(ctx: DashboardContext): string {
  const warehouseSchema = getProjectSchemaName(ctx.projectId, "warehouse");
  const tablesSummary = formatTables(warehouseSchema, ctx.warehouseTables);

  const graphSummary = !ctx.semanticGraph
    ? "(no accepted semantic model yet — chart from single-table queries only)"
    : [
        `Facts: ${ctx.semanticGraph.facts.join(", ") || "(none)"}`,
        `Dimensions: ${ctx.semanticGraph.dimensions.join(", ") || "(none)"}`,
        `Accepted joins: ${ctx.semanticGraph.joins.map((j) => `${j.from} → ${j.to} (${j.cardinality})`).join("; ") || "(none)"}`,
      ].join("\n");

  return [
    `You are a BI dashboard designer for one user project.`,
    ``,
    `PROJECT CONTEXT:`,
    `- Name: ${ctx.projectName}`,
    ctx.projectDescription ? `- User-stated goal: ${ctx.projectDescription}` : `- No stated goal — design a balanced overview dashboard.`,
    `- Warehouse schema (read-only): ${warehouseSchema}`,
    ``,
    `WAREHOUSE TABLES:`,
    tablesSummary,
    ``,
    `SEMANTIC MODEL:`,
    graphSummary,
    ``,
    `YOUR JOB:`,
    `1. Design 5–6 VISUALIZATION charts that together answer the project goal.`,
    `   KPI stat cards (single big numbers) are generated automatically — do NOT`,
    `   create them yourself, and never emit a chart whose query returns a single scalar.`,
    `2. For EACH chart:`,
    `   a. Run execute_warehouse_query with a fully-qualified SELECT against "${warehouseSchema}".`,
    `   b. Inspect the rows you got back.`,
    `   c. Pick a chart type from CHART_RULES below.`,
    `   d. In the chart's config, include ALL of:`,
    `      - sql: the exact SELECT you ran (copy it verbatim)`,
    `      - data: the rows returned (copy from tool result)`,
    `      - xKey / yKey: the column names used for axes`,
    `3. When all charts are ready, call create_dashboard ONCE.`,
    ``,
    `CRITICAL — never omit sql from a chart config. The dashboard re-executes`,
    `this SQL at view time so charts always reflect the latest warehouse data.`,
    ``,
    `CHART QUALITY RULES (charts that break these are dropped):`,
    `- Every non-scatter chart MUST return at least 3 rows, and each row MUST contain`,
    `  BOTH a category/label column (the xKey) AND a numeric measure column (the yKey).`,
    `- A chart query that SELECTs only a numeric aggregate with no label column is invalid`,
    `  — that is a KPI, which is handled for you. Always GROUP BY the label column.`,
    `- "Top N" charts: SELECT the label column AND the measure, ORDER BY the measure DESC,`,
    `  LIMIT N (so bars have names, not bare numbers).`,
    `- Only use scatter/bubble when you have TWO numeric measure columns to plot against each other.`,
    `- Aim for variety across the dashboard: a time-trend (line/area) if a date/year column`,
    `  exists, a categorical comparison (bar/horizontal-bar), and a share view (pie/donut).`,
    ``,
    `RULES:`,
    `- Never invent data. The data array MUST come from a query result.`,
    `- Limit each query to 100 rows max — use GROUP BY / aggregation where the visual demands it.`,
    `- Use accepted joins from the semantic model only; do not improvise edges.`,
    ``,
    SQL_SAFETY_RULES,
    ``,
    CHART_RULES,
  ].join("\n");
}

/** Back-compat for project-agents/preview-prompt. */
export const buildDataModelerPrompt = buildDataModelerSemanticPrompt;
