// Shared agent tools + project-context helpers used by both the legacy
// /api/openai chat routes and the CopilotKit runtime (/api/copilotkit).
// Extracted here so the dataset-query tool and metric/semantic-model context
// are defined once and reused by both transports.

import {
  db,
  pool,
  datasets as datasetsTable,
  projectMetrics,
  projectSemanticModels,
  warehouseSchema,
  listWarehouseTables,
  quoteIdent,
} from "@workspace/db";
import type { DatasetColumn } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

export interface ProjectCopilotContext {
  semanticGraph: {
    facts: string[];
    dimensions: string[];
    joins: Array<{ from: string; to: string; cardinality: string }>;
  } | null;
  metrics: Array<{ metricName: string; description: string | null; sqlFormula: string; dependsOnTables: string[] }>;
  warehouseSchema: string;
}

/** Loads the applied semantic model + metrics for a project, used to ground the
 *  Copilot and to substitute {{metric:name}} placeholders in generated SQL. */
export async function loadProjectCopilotContext(projectId: number): Promise<ProjectCopilotContext | null> {
  if (!Number.isFinite(projectId) || projectId <= 0) return null;

  const [sm] = await db
    .select()
    .from(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.projectId, projectId),
      eq(projectSemanticModels.status, "applied"),
    ))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);

  const metrics = await db
    .select()
    .from(projectMetrics)
    .where(and(
      eq(projectMetrics.projectId, projectId),
      eq(projectMetrics.status, "applied"),
    ))
    .orderBy(desc(projectMetrics.createdAt));

  return {
    semanticGraph: sm?.graphDefinition ?? null,
    metrics: metrics.map((m) => ({
      metricName: m.metricName,
      description: m.description,
      sqlFormula: m.sqlFormula,
      dependsOnTables: m.dependsOnTables,
    })),
    warehouseSchema: warehouseSchema(projectId),
  };
}

export function renderProjectContextBlock(ctx: ProjectCopilotContext | null): string {
  if (!ctx) return "";
  const semanticBlock = !ctx.semanticGraph ? "(no semantic model accepted)" : [
    `Facts: ${ctx.semanticGraph.facts.join(", ") || "(none)"}`,
    `Dimensions: ${ctx.semanticGraph.dimensions.join(", ") || "(none)"}`,
    `Joins: ${ctx.semanticGraph.joins.map((j) => `${j.from} → ${j.to} (${j.cardinality})`).join("; ") || "(none)"}`,
  ].join("\n  ");

  const metricsBlock = ctx.metrics.length === 0
    ? "(no metrics defined yet)"
    : ctx.metrics.map((m) => `- ${m.metricName} := ${m.sqlFormula}${m.description ? ` — ${m.description}` : ""}`).join("\n");

  return [
    ``,
    `PROJECT WAREHOUSE: ${ctx.warehouseSchema}`,
    `SEMANTIC MODEL:`,
    `  ${semanticBlock}`,
    ``,
    `AVAILABLE METRICS (use {{metric:name}} in SQL to inject the formula):`,
    metricsBlock,
    ``,
    `RULES:`,
    `- When the user asks about a known metric, reference it by name in your prose AND use {{metric:name}} in SQL — the server substitutes the formula at query time. Do NOT inline the formula yourself.`,
    `- When joining warehouse tables, use only the joins listed above. If a needed join is missing, say so plainly rather than improvising.`,
  ].join("\n");
}

/**
 * Substitutes {{metric:name}} placeholders in a SQL string with the stored
 * sqlFormula from project_metrics. The replacement is wrapped in parens so it
 * stays a single SELECT expression. Unknown metric names are left intact so
 * the executor surfaces a clear "column does not exist" error rather than
 * silently dropping the placeholder.
 */
export function substituteMetricPlaceholders(sql: string, metrics: ProjectCopilotContext["metrics"]): string {
  if (!sql.includes("{{metric:")) return sql;
  const byName = new Map(metrics.map((m) => [m.metricName, m.sqlFormula]));
  return sql.replace(/\{\{metric:([a-z][a-z0-9_]*)\}\}/gi, (match, name: string) => {
    const formula = byName.get(name);
    return formula ? `(${formula})` : match;
  });
}

/** Runs a guarded SELECT against an uploaded dataset and maps pg column names
 *  back to their original (human) names. Reused by both chat transports. */
export async function runDatasetQuery(
  datasetId: number,
  sql: string,
  projectCtx: ProjectCopilotContext | null = null,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  const [dataset] = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.id, datasetId))
    .limit(1);

  if (!dataset) {
    return { columns: [], rows: [], rowCount: 0, error: `Dataset ${datasetId} not found` };
  }

  const cols = dataset.columnSchema as DatasetColumn[];

  // Substitute {{metric:name}} placeholders BEFORE the SELECT guard so the
  // user can reference metric names directly.
  const substitutedSql = projectCtx ? substituteMetricPlaceholders(sql, projectCtx.metrics) : sql;

  const firstWord = substitutedSql.replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, "").trim().split(/\s+/)[0]?.toUpperCase();
  if (firstWord !== "SELECT") {
    return { columns: [], rows: [], rowCount: 0, error: "Only SELECT queries are allowed" };
  }

  if (!substitutedSql.includes(dataset.tableName)) {
    return { columns: [], rows: [], rowCount: 0, error: `Query must reference table "${dataset.tableName}"` };
  }

  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 3000");
    const result = await client.query(substitutedSql);
    const nameMap = new Map(cols.map((c) => [c.pgName, c.originalName]));
    const rows: Record<string, unknown>[] = result.rows.map((r: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === "_row_id") continue;
        out[nameMap.get(k) ?? k] = v;
      }
      return out;
    });
    const columns = result.fields
      .map((f: { name: string }) => f.name)
      .filter((c: string) => c !== "_row_id")
      .map((c: string) => nameMap.get(c) ?? c);
    return { columns, rows, rowCount: rows.length };
  } finally {
    client.release();
  }
}

// ─── Project warehouse (data-analyst tool) ───────────────────────────────────

/**
 * Lists the project warehouse's tables/views with their columns, as a compact
 * text block the Copilot uses to write correct SQL. Reads information_schema
 * directly (not through the guarded query path). Bounded so the prompt stays small.
 */
export async function describeWarehouse(projectId: number): Promise<string> {
  if (!Number.isFinite(projectId) || projectId <= 0) return "";
  const schema = warehouseSchema(projectId);
  let tables: Array<{ tableName: string; rowCount: number }>;
  try {
    tables = await listWarehouseTables(projectId);
  } catch {
    return "";
  }
  if (tables.length === 0) {
    return `PROJECT WAREHOUSE (${schema}): no curated tables yet. Accept transformations or generate a dashboard first.`;
  }

  // information_schema is safe to read here (this is NOT the user-supplied query path).
  const colRes = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, ordinal_position`,
    [schema],
  );

  const byTable = new Map<string, string[]>();
  for (const r of colRes.rows) {
    const list = byTable.get(r.table_name) ?? [];
    if (list.length < 40) list.push(`${r.column_name} ${r.data_type}`);
    byTable.set(r.table_name, list);
  }

  const lines = tables.slice(0, 30).map((t) => {
    const cols = byTable.get(t.tableName) ?? [];
    return `- ${t.tableName} (~${t.rowCount} rows): ${cols.join(", ")}`;
  });

  return [
    `PROJECT WAREHOUSE — call query_project_warehouse to run read-only SQL against these curated tables/views.`,
    `Schema "${schema}" is on the search_path, so reference tables by bare name (e.g. SELECT ... FROM ${tables[0]?.tableName}).`,
    `Tables & views:`,
    ...lines,
  ].join("\n");
}

/**
 * Runs a read-only SELECT against the project's warehouse schema. Guards:
 * SELECT/WITH only, single statement, no system/other-project schema access,
 * executed in a READ ONLY transaction with the warehouse schema on search_path
 * and a hard statement timeout. Returns up to 1000 rows.
 */
export async function runWarehouseQuery(
  projectId: number,
  sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; error?: string }> {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { columns: [], rows: [], rowCount: 0, error: "No active project — open a project first." };
  }
  const schema = warehouseSchema(projectId);

  const cleaned = sql.replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, "").trim().replace(/;\s*$/, "");
  const first = cleaned.split(/\s+/)[0]?.toUpperCase();
  if (first !== "SELECT" && first !== "WITH") {
    return { columns: [], rows: [], rowCount: 0, error: "Only read-only SELECT/WITH queries are allowed." };
  }
  if (cleaned.includes(";")) {
    return { columns: [], rows: [], rowCount: 0, error: "Only a single statement is allowed." };
  }
  if (/\b(pg_catalog|information_schema|pg_[a-z_]+)\b/i.test(cleaned)) {
    return { columns: [], rows: [], rowCount: 0, error: "System catalog access is not allowed." };
  }
  // Block references to a DIFFERENT project's schema (own warehouse/raw is fine).
  const otherProj = cleaned.match(/\bproj_(\d+)_(?:warehouse|raw)\b/gi)?.find((m) => !m.toLowerCase().startsWith(`proj_${projectId}_`));
  if (otherProj) {
    return { columns: [], rows: [], rowCount: 0, error: "Cross-project schema access is not allowed." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    await client.query(`SET LOCAL search_path TO ${quoteIdent(schema)}, pg_temp`);
    const result = await client.query(cleaned);
    await client.query("COMMIT");
    const columns = result.fields.map((f: { name: string }) => f.name);
    const rows = result.rows.slice(0, 1000) as Record<string, unknown>[];
    return { columns, rows, rowCount: rows.length };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    let message = err instanceof Error ? err.message : String(err);
    // If the agent referenced a missing table/column, append the real table
    // names so it can self-correct in one step instead of guessing again.
    if (/does not exist/i.test(message)) {
      try {
        const tables = await listWarehouseTables(projectId);
        if (tables.length) {
          message += ` — available warehouse tables: ${tables.map((t) => t.tableName).join(", ")}. Call list_warehouse_tables for columns, then retry.`;
        }
      } catch { /* ignore */ }
    }
    return { columns: [], rows: [], rowCount: 0, error: message };
  } finally {
    client.release();
  }
}
