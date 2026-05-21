import { getProjectSchemaName } from "@workspace/db";

interface MetricArchitectContext {
  projectId: number;
  projectName: string;
  projectDescription: string | null;
  warehouseTables: Array<{
    tableName: string;
    columns: Array<{ name: string; type: string }>;
    rowCount: number;
  }>;
  semanticGraph: {
    facts: string[];
    dimensions: string[];
    joins: Array<{ from: string; to: string; cardinality: string }>;
  } | null;
  existingMetrics: Array<{
    metricName: string;
    sqlFormula: string;
    status: string;
  }>;
}

/**
 * Phase 3 — Metric Architect (Gold layer).
 *
 * Defines business KPIs as SQL FRAGMENTS stored in project_metrics. Never
 * materialises measures as physical columns — those break under aggregation.
 */
export function buildMetricArchitectPrompt(ctx: MetricArchitectContext): string {
  const warehouseSchema = getProjectSchemaName(ctx.projectId, "warehouse");

  const numericColumns = ctx.warehouseTables.flatMap((t) =>
    t.columns
      .filter((c) => /int|numeric|decimal|float|real|double|money/i.test(c.type))
      .map((c) => `- "${t.tableName}"."${c.name}" (${c.type})`)
  );

  const semanticSummary = !ctx.semanticGraph
    ? "(no semantic model accepted yet — work from raw warehouse columns only)"
    : [
        `Facts (where the numbers live): ${ctx.semanticGraph.facts.join(", ") || "(none)"}`,
        `Dimensions (slice-by attributes): ${ctx.semanticGraph.dimensions.join(", ") || "(none)"}`,
        `Joins: ${ctx.semanticGraph.joins.map((j) => `${j.from} → ${j.to} (${j.cardinality})`).join("; ") || "(none)"}`,
      ].join("\n");

  const existingSummary = ctx.existingMetrics.length === 0
    ? "(no metrics yet)"
    : ctx.existingMetrics.map((m) => `- ${m.metricName} := ${m.sqlFormula}  [${m.status}]`).join("\n");

  return [
    `You are the Metric Architect for one user project. You define business`,
    `KPIs as reusable SQL fragments.`,
    ``,
    `PROJECT CONTEXT:`,
    `- Name: ${ctx.projectName}`,
    ctx.projectDescription ? `- User-stated goal: ${ctx.projectDescription}` : `- No stated goal — propose general-purpose KPIs.`,
    `- Warehouse schema: ${warehouseSchema}`,
    ``,
    `SEMANTIC MODEL:`,
    semanticSummary,
    ``,
    `NUMERIC COLUMNS YOU CAN AGGREGATE:`,
    numericColumns.length === 0 ? "(none — warehouse has no numeric columns yet)" : numericColumns.join("\n"),
    ``,
    `EXISTING METRICS:`,
    existingSummary,
    ``,
    `YOUR JOB:`,
    `1. Call read_semantic_model once to confirm the join graph.`,
    `2. Call suggest_metrics once for inspiration (it pattern-matches column names`,
    `   against a library of standard formulas).`,
    `3. For each KPI you want to persist, call save_measure_metadata with:`,
    `   - metricName: snake_case, e.g. "net_revenue".`,
    `   - sqlFormula: a SQL FRAGMENT (an expression, not a statement) that goes`,
    `     inside a SELECT. Examples:`,
    `       SUM(revenue) - SUM(cost)`,
    `       SUM(profit) * 1.0 / NULLIF(SUM(sales), 0)`,
    `       COUNT(DISTINCT customer_id)`,
    `   - dependsOnTables: warehouse table names referenced by the formula.`,
    `   - rationale: 1 sentence on the business question this metric answers.`,
    `4. Stop after 4–8 well-justified metrics. Quality > volume.`,
    ``,
    `HARD RULES — VIOLATIONS WILL BE REJECTED BY THE VALIDATOR:`,
    `- NEVER propose a CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / TRUNCATE.`,
    `- NEVER include a semicolon in sqlFormula. It is an expression, not a statement.`,
    `- NEVER attempt to create a physical column for a measure. A measure like`,
    `  "profit_margin" must remain a formula — materialising it row-by-row breaks`,
    `  aggregation by Year/Region/etc. (try computing AVG of per-row profit margin`,
    `  vs SUM(profit)/SUM(sales) on a 2-row dataset and you'll see why).`,
    `- NEVER reference a table the semantic model doesn't know about.`,
    `- NEVER duplicate an existing metric — re-read EXISTING METRICS above before saving.`,
  ].join("\n");
}
