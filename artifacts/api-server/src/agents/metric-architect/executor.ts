/**
 * Concrete tool implementations for MetricArchitectAgent.
 *
 * Read-only against the warehouse + semantic model, write-only to
 * project_metrics. The save tool enforces a hard validator that rejects any
 * formula containing a statement-level keyword (CREATE/ALTER/INSERT/...) — see
 * assertMeasureFormula below.
 */
import {
  db,
  projectMetrics,
  projectSemanticModels,
  warehouseSchema,
  masterPool,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import type { AgentToolCall } from "../shared/runner";
import type pino from "pino";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

export async function listWarehouseColumns(projectId: number) {
  const schema = warehouseSchema(projectId);
  const result = await masterPool.query<ColumnRow>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, ordinal_position`,
    [schema],
  );
  const grouped = new Map<string, Array<{ name: string; type: string }>>();
  for (const row of result.rows) {
    const existing = grouped.get(row.table_name) ?? [];
    existing.push({ name: row.column_name, type: row.data_type });
    grouped.set(row.table_name, existing);
  }
  return Array.from(grouped.entries()).map(([tableName, columns]) => ({ tableName, columns }));
}

export async function readSemanticModel(projectId: number) {
  const [row] = await db
    .select()
    .from(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.workspaceId, projectId),
      eq(projectSemanticModels.status, "applied"),
    ))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);
  if (!row) return { graph: null };
  return { graph: row.graphDefinition, agentRationale: row.agentRationale };
}

// ---------------------------------------------------------------------------
// suggest_metrics — pattern-match common metric names to formula templates.
// This is intentionally lightweight; the LLM uses these as inspiration and
// then decides which to persist via save_measure_metadata.
// ---------------------------------------------------------------------------

interface MetricSuggestion {
  metricName: string;
  description: string;
  sqlFormula: string;
  matchedColumn: string;
  matchedTable: string;
}

const REVENUE_PATTERNS = /revenue|sales|amount|total|price|gross/i;
const COST_PATTERNS = /cost|expense|spend|cogs|overhead/i;
const QUANTITY_PATTERNS = /quantity|qty|count|units|volume/i;
const CUSTOMER_PATTERNS = /customer|client|user|account/i;
const PROFIT_PATTERNS = /profit|margin|net/i;

export async function suggestMetrics(projectId: number, columnHints: string[] = []) {
  const tables = await listWarehouseColumns(projectId);
  const hintRe = columnHints.length === 0 ? null : new RegExp(columnHints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const suggestions: MetricSuggestion[] = [];

  for (const t of tables) {
    for (const c of t.columns) {
      if (!/int|numeric|decimal|float|real|double|money/i.test(c.type)) continue;
      if (hintRe && !hintRe.test(c.name)) continue;
      const qualified = `"${t.tableName}"."${c.name}"`;

      if (REVENUE_PATTERNS.test(c.name)) {
        suggestions.push({
          metricName: `total_${c.name.toLowerCase()}`,
          description: `Total ${c.name} across all rows.`,
          sqlFormula: `SUM(${qualified})`,
          matchedColumn: c.name,
          matchedTable: t.tableName,
        });
      }
      if (COST_PATTERNS.test(c.name)) {
        suggestions.push({
          metricName: `total_${c.name.toLowerCase()}`,
          description: `Total ${c.name} across all rows.`,
          sqlFormula: `SUM(${qualified})`,
          matchedColumn: c.name,
          matchedTable: t.tableName,
        });
      }
      if (QUANTITY_PATTERNS.test(c.name)) {
        suggestions.push({
          metricName: `total_${c.name.toLowerCase()}`,
          description: `Total ${c.name}.`,
          sqlFormula: `SUM(${qualified})`,
          matchedColumn: c.name,
          matchedTable: t.tableName,
        });
      }
      if (CUSTOMER_PATTERNS.test(c.name) && /id$/i.test(c.name)) {
        suggestions.push({
          metricName: `distinct_${c.name.toLowerCase()}s`,
          description: `Unique ${c.name} count.`,
          sqlFormula: `COUNT(DISTINCT ${qualified})`,
          matchedColumn: c.name,
          matchedTable: t.tableName,
        });
      }
      if (PROFIT_PATTERNS.test(c.name)) {
        suggestions.push({
          metricName: `avg_${c.name.toLowerCase()}_pct`,
          description: `Average ${c.name} as a fraction of revenue (if a revenue column is present, otherwise raw average).`,
          sqlFormula: `AVG(${qualified})`,
          matchedColumn: c.name,
          matchedTable: t.tableName,
        });
      }
    }
  }

  // Cross-column: revenue - cost = profit, etc.
  const revenueCols: Array<{ table: string; column: string }> = [];
  const costCols: Array<{ table: string; column: string }> = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (REVENUE_PATTERNS.test(c.name)) revenueCols.push({ table: t.tableName, column: c.name });
      if (COST_PATTERNS.test(c.name)) costCols.push({ table: t.tableName, column: c.name });
    }
  }
  if (revenueCols.length > 0 && costCols.length > 0) {
    const r = revenueCols[0];
    const c = costCols[0];
    if (r.table === c.table) {
      suggestions.push({
        metricName: "gross_profit",
        description: `Gross profit = total ${r.column} − total ${c.column}.`,
        sqlFormula: `SUM("${r.table}"."${r.column}") - SUM("${c.table}"."${c.column}")`,
        matchedColumn: `${r.column}, ${c.column}`,
        matchedTable: r.table,
      });
      suggestions.push({
        metricName: "profit_margin_pct",
        description: `Profit margin as a percentage = (revenue − cost) / revenue × 100.`,
        sqlFormula: `(SUM("${r.table}"."${r.column}") - SUM("${c.table}"."${c.column}")) * 100.0 / NULLIF(SUM("${r.table}"."${r.column}"), 0)`,
        matchedColumn: `${r.column}, ${c.column}`,
        matchedTable: r.table,
      });
    }
  }

  return { suggestions };
}

// ---------------------------------------------------------------------------
// save_measure_metadata — the hard guardrail. Rejects DDL/DML keywords and
// statement terminators before the row hits the DB.
// ---------------------------------------------------------------------------

const FORBIDDEN_IN_FORMULA = /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|MERGE|COPY|VACUUM|ANALYZE|BEGIN|COMMIT|ROLLBACK)\b/i;

export function assertMeasureFormula(formula: string): void {
  if (!formula || typeof formula !== "string") {
    throw new Error("sqlFormula is required.");
  }
  if (formula.includes(";")) {
    throw new Error("sqlFormula must be an expression, not a statement. Semicolons are forbidden.");
  }
  if (FORBIDDEN_IN_FORMULA.test(formula)) {
    throw new Error("sqlFormula contains a forbidden statement keyword (CREATE/ALTER/INSERT/...). Measures are runtime expressions, not statements.");
  }
  // Basic sanity: must contain at least one aggregation function or column ref.
  if (!/[A-Z_]+\(|"\w+"|\w+\.\w+/i.test(formula)) {
    throw new Error("sqlFormula does not look like a SQL expression.");
  }
}

export interface SaveMeasureArgs {
  metricName: string;
  description?: string;
  sqlFormula: string;
  dependsOnTables: string[];
  rationale?: string;
}

export async function saveMeasureMetadata(projectId: number, args: SaveMeasureArgs) {
  const metricName = String(args.metricName ?? "").trim();
  if (!/^[a-z][a-z0-9_]{1,127}$/.test(metricName)) {
    return { error: "metricName must be snake_case, start with a letter, and be ≤128 chars." };
  }

  try {
    assertMeasureFormula(args.sqlFormula);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid sqlFormula" };
  }

  const dependsOn = Array.isArray(args.dependsOnTables) ? args.dependsOnTables.map(String) : [];

  // Dedupe: if a metric with the same name already exists for this project,
  // update its formula (so the agent can iterate) rather than inserting.
  const [existing] = await db
    .select()
    .from(projectMetrics)
    .where(and(
      eq(projectMetrics.workspaceId, projectId),
      eq(projectMetrics.metricName, metricName),
    ))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(projectMetrics)
      .set({
        description: args.description ?? null,
        sqlFormula: args.sqlFormula,
        dependsOnTables: dependsOn,
        agentRationale: args.rationale ?? null,
        status: "proposed",
      })
      .where(eq(projectMetrics.id, existing.id))
      .returning();
    return { id: updated.id, status: updated.status, updated: true };
  }

  const [row] = await db
    .insert(projectMetrics)
    .values({
      workspaceId: projectId,
      metricName,
      description: args.description ?? null,
      sqlFormula: args.sqlFormula,
      dependsOnTables: dependsOn,
      status: "proposed",
      agentRationale: args.rationale ?? null,
    })
    .returning();

  return { id: row.id, status: row.status };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function makeMetricArchitectExecutor(projectId: number, log: pino.Logger) {
  return async (call: AgentToolCall): Promise<string> => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "Could not parse tool arguments as JSON." });
    }

    switch (call.name) {
      case "read_semantic_model": {
        log.info({ projectId, tool: "read_semantic_model" }, "metric-architect tool");
        const result = await readSemanticModel(projectId).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "list_warehouse_tables": {
        log.info({ projectId, tool: "list_warehouse_tables" }, "metric-architect tool");
        const result = await listWarehouseColumns(projectId).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "suggest_metrics": {
        const hints = Array.isArray(parsed.columnHints) ? parsed.columnHints.map(String) : [];
        log.info({ projectId, tool: "suggest_metrics", hints }, "metric-architect tool");
        const result = await suggestMetrics(projectId, hints).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "save_measure_metadata": {
        log.info({ projectId, tool: "save_measure_metadata", metricName: parsed.metricName }, "metric-architect tool");
        const result = await saveMeasureMetadata(projectId, parsed as unknown as SaveMeasureArgs).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ error: `Tool ${call.name} is not available to the Metric Architect.` });
    }
  };
}
