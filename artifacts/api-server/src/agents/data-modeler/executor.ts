/**
 * Concrete tool implementations for DataModelerAgent.
 *
 * The semantic-model pass is READ-ONLY against the warehouse and writes a
 * single graphDefinition row into project_semantic_models. The agent never
 * issues DDL — physical join shape is not its responsibility.
 *
 * The dashboard-generation pass (Pass 2B, retained) writes to user_dashboards
 * + dashboard_charts. Kept here for back-compat until the consumption-side
 * dashboard generator moves out of the modeler in a follow-up.
 */
import {
  db,
  userDashboards,
  dashboardCharts,
  projectSemanticModels,
  masterPool,
  warehouseSchema,
  quoteIdent,
  type SemanticGraphDefinition,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { assertSelectOnly, assertSchemaScope } from "../shared/validation";
import type { AgentToolCall } from "../shared/runner";
import type pino from "pino";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

export async function listWarehouseTables(projectId: number) {
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

export async function executeWarehouseQuery(projectId: number, sqlText: string) {
  assertSelectOnly(sqlText);
  assertSchemaScope(sqlText, [warehouseSchema(projectId)]);
  const result = await masterPool.query(sqlText);
  return {
    columns: result.fields.map((f) => f.name),
    rows: result.rows.slice(0, 200),
    truncated: result.rows.length > 200,
  };
}

// ---------------------------------------------------------------------------
// Semantic model tools — propose_star_schema (in-memory) +
// generate_semantic_graph (writes the row).
// ---------------------------------------------------------------------------

interface StarSchemaState {
  facts: string[];
  dimensions: string[];
  rationale: string;
}

export interface GenerateSemanticGraphArgs {
  facts: string[];
  dimensions: string[];
  joins: Array<{ from: string; to: string; cardinality: "1:1" | "1:N" | "N:1" | "N:N" }>;
  rationale: string;
}

export async function saveSemanticGraph(
  projectId: number,
  args: GenerateSemanticGraphArgs,
): Promise<{ id: number; status: string }> {
  // Replace any prior "proposed" row for this project — we keep one open
  // proposal at a time. Accepted rows are immutable history.
  await db
    .delete(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.projectId, projectId),
      eq(projectSemanticModels.status, "proposed"),
    ));

  const graphDefinition: SemanticGraphDefinition = {
    facts: args.facts,
    dimensions: args.dimensions,
    joins: args.joins,
  };

  const [row] = await db
    .insert(projectSemanticModels)
    .values({
      projectId: projectId,
      status: "proposed",
      graphDefinition,
      agentRationale: args.rationale,
    })
    .returning();

  return { id: row.id, status: row.status };
}

export async function getAppliedSemanticGraph(projectId: number) {
  const [row] = await db
    .select()
    .from(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.projectId, projectId),
      eq(projectSemanticModels.status, "applied"),
    ))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// create_dashboard tool — kept for the dashboard-generation pass. Writes
// user_dashboards + dashboard_charts so the existing GeneratedDashboard
// component can render the result.
// ---------------------------------------------------------------------------

interface ChartShape {
  title: string;
  chartType: string;
  config: Record<string, unknown>;
}

export interface CreateDashboardArgs {
  title: string;
  charts: ChartShape[];
}

const NUMERIC_TYPE = /int|float|numeric|double|real|decimal|money|serial/i;
const BOOL_TYPE = /bool/i;
const NUM_KEYWORD = /revenue|amount|sales|price|value|total|cost|fee|premium|spend|deal|commission/i;
const CAT_KEYWORD = /customer|category|region|product|user|type|status|name|brand|city|segment|tier|owner|broker|supplier/i;

function colToLabel(raw: string): string {
  return raw.replace(/[_\s]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function valueIsNumeric(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n);
}

/** A data column reads as numeric when >=70% of its values coerce to finite numbers. */
function columnIsNumeric(rows: Array<Record<string, unknown>>, key: string): boolean {
  if (!rows.length) return false;
  let n = 0;
  for (const r of rows) if (valueIsNumeric(r[key])) n++;
  return n / rows.length >= 0.7;
}

/**
 * Validate + repair the agent's visualization charts so none render as bare
 * numbers. Drops charts with no data or no usable label+measure pair, infers
 * missing xKey/yKey from the data, and downgrades scatters that lack two
 * numeric columns. KPI charts are dropped here — they are (re)generated by
 * ensureProjectKpis so every project dashboard has a consistent KPI row.
 */
function normalizeAgentCharts(charts: ChartShape[]): ChartShape[] {
  const out: ChartShape[] = [];
  for (const chart of charts) {
    if (chart.chartType === "kpi") continue;
    const cfg = (chart.config ?? {}) as Record<string, unknown>;
    const data = Array.isArray(cfg.data) ? (cfg.data as Array<Record<string, unknown>>) : [];
    if (data.length === 0) continue;
    const keys = Object.keys(data[0] ?? {});
    if (keys.length === 0) continue;

    const numericKeys = keys.filter((k) => columnIsNumeric(data, k));
    const categoricalKeys = keys.filter((k) => !numericKeys.includes(k));

    let xKey = typeof cfg.xKey === "string" && keys.includes(cfg.xKey) ? cfg.xKey : undefined;
    let yKey: unknown = cfg.yKey;

    if (chart.chartType === "scatter" || chart.chartType === "bubble") {
      if (numericKeys.length < 2) {
        if (!categoricalKeys.length || !numericKeys.length) continue;
        chart.chartType = "bar";
        xKey = categoricalKeys[0];
        yKey = numericKeys[0];
      } else {
        if (!xKey || !numericKeys.includes(xKey)) xKey = numericKeys[0];
        const yStr = Array.isArray(yKey) ? yKey[0] : yKey;
        yKey = typeof yStr === "string" && numericKeys.includes(yStr) && yStr !== xKey
          ? yStr
          : numericKeys.find((k) => k !== xKey) ?? numericKeys[1];
      }
    } else {
      // Categorical chart: needs a label column AND a numeric measure, else it
      // is really a scalar and would render as bare numbers — drop it.
      if (!categoricalKeys.length || !numericKeys.length) continue;
      if (!xKey || !categoricalKeys.includes(xKey)) xKey = categoricalKeys[0];
      const keepArray = Array.isArray(yKey) && yKey.every((k) => typeof k === "string" && numericKeys.includes(k));
      if (!keepArray) {
        const yStr = Array.isArray(yKey) ? yKey[0] : yKey;
        yKey = typeof yStr === "string" && numericKeys.includes(yStr) ? yStr : numericKeys[0];
      }
    }

    chart.config = { ...cfg, xKey, yKey };
    out.push(chart);
  }
  return out;
}

/**
 * Programmatically guarantee up to 4 KPI stat cards for a project dashboard,
 * mirroring the gold-path ensureKpis() but querying the warehouse directly
 * (project dashboards have no single flat table). Skips silently on any
 * failure so a missing KPI never blocks dashboard creation.
 */
export async function ensureProjectKpis(projectId: number, dashId: number): Promise<void> {
  const existing = await db
    .select()
    .from(dashboardCharts)
    .where(eq(dashboardCharts.dashboardId, dashId));
  const existingKpis = existing.filter((c) => c.chartType === "kpi");
  if (existingKpis.length >= 4) return;

  const existingTitles = new Set(existing.map((c) => c.title.toLowerCase()));
  const maxPosition = existing.reduce((m, c) => Math.max(m, c.position ?? 0), -1);

  const tables = await listWarehouseTables(projectId).catch(
    () => [] as Awaited<ReturnType<typeof listWarehouseTables>>,
  );
  if (!tables.length) return;

  // Prefer a table that has a meaningful numeric measure; fall back to any
  // table with a numeric column, then the first table.
  let chosen = tables.find((t) => t.columns.some((c) => NUMERIC_TYPE.test(c.type) && NUM_KEYWORD.test(c.name)));
  if (!chosen) chosen = tables.find((t) => t.columns.some((c) => NUMERIC_TYPE.test(c.type)));
  if (!chosen) chosen = tables[0];

  const numericCols = chosen.columns.filter((c) => NUMERIC_TYPE.test(c.type)).map((c) => c.name);
  const categoricalCols = chosen.columns
    .filter((c) => !NUMERIC_TYPE.test(c.type) && !BOOL_TYPE.test(c.type))
    .map((c) => c.name);
  const bestNumeric = numericCols.find((c) => NUM_KEYWORD.test(c)) ?? numericCols[0];
  const bestCategorical = categoricalCols.find((c) => CAT_KEYWORD.test(c)) ?? categoricalCols[0];

  const schema = warehouseSchema(projectId);
  const qualified = `${quoteIdent(schema)}.${quoteIdent(chosen.tableName)}`;

  const candidates: Array<{ title: string; expr: string }> = [
    { title: "Total Records", expr: "COUNT(*)" },
  ];
  if (bestNumeric) {
    candidates.push(
      { title: `Total ${colToLabel(bestNumeric)}`, expr: `SUM(${quoteIdent(bestNumeric)})` },
      { title: `Avg ${colToLabel(bestNumeric)}`, expr: `ROUND(AVG(${quoteIdent(bestNumeric)})::numeric, 2)` },
    );
  }
  if (bestCategorical) {
    candidates.push({ title: `Distinct ${colToLabel(bestCategorical)}`, expr: `COUNT(DISTINCT ${quoteIdent(bestCategorical)})` });
  }

  const needed = 4 - existingKpis.length;
  const toCreate = candidates.filter((c) => !existingTitles.has(c.title.toLowerCase())).slice(0, needed);
  if (!toCreate.length) return;

  const client = await masterPool.connect();
  const values: Array<typeof dashboardCharts.$inferInsert> = [];
  let pos = maxPosition + 1;
  try {
    await client.query("SET statement_timeout = 5000");
    for (const cand of toCreate) {
      const kpiSql = `SELECT ${cand.expr} AS kpi_value FROM ${qualified}`;
      try {
        assertSelectOnly(kpiSql);
        assertSchemaScope(kpiSql, [schema]);
        const r = await client.query(kpiSql);
        const data = r.rows.slice(0, 1);
        if (!data.length) continue;
        values.push({
          dashboardId: dashId,
          title: cand.title,
          chartType: "kpi",
          config: { xKey: "kpi_value", yKey: "kpi_value", data, sql: kpiSql } as never,
          position: pos++,
        });
      } catch {
        // individual KPI query failed — skip it
      }
    }
  } finally {
    client.release();
  }

  if (values.length) await db.insert(dashboardCharts).values(values);
}

export async function createProjectDashboard(projectId: number, args: CreateDashboardArgs) {
  if (!args.title || !Array.isArray(args.charts) || args.charts.length === 0) {
    return { error: "title and at least one chart are required" };
  }

  const safeTitle = args.title.trim().slice(0, 255);
  const flatTableName = `proj_${projectId}_dash_${Date.now().toString(36)}`;

  const [dashboard] = await db
    .insert(userDashboards)
    .values({
      name: safeTitle,
      flatTableName,
      sourceDatasetIds: [],
      rowCount: 0,
      status: "ready",
      agentLog: `Generated by DataModelerAgent for project ${projectId}`,
    })
    .returning();

  const charts = normalizeAgentCharts(args.charts);
  if (charts.length) {
    await db.insert(dashboardCharts).values(
      charts.map((c, i) => ({
        dashboardId: dashboard.id,
        title: c.title,
        chartType: c.chartType,
        config: c.config as never,
        position: i,
        colSpan: 1,
      })),
    );
  }

  await ensureProjectKpis(projectId, dashboard.id);

  return { dashboardId: dashboard.id, name: safeTitle, chartCount: charts.length };
}

// ---------------------------------------------------------------------------
// Dispatchers — one for the "semantic model" pass (no dashboard tool), one
// for the "generate dashboard" pass. Each agent run sees only the tools that
// match its current task.
// ---------------------------------------------------------------------------

export function makeSemanticModelExecutor(projectId: number, log: pino.Logger) {
  // Hold the in-flight star-schema classification across tool calls so
  // generate_semantic_graph can default to it if the model omits facts/dims.
  let starSchema: StarSchemaState | null = null;

  return async (call: AgentToolCall): Promise<string> => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "Could not parse tool arguments as JSON." });
    }

    switch (call.name) {
      case "list_warehouse_tables": {
        log.info({ projectId, tool: "list_warehouse_tables" }, "data-modeler tool");
        const result = await listWarehouseTables(projectId).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "propose_star_schema": {
        starSchema = {
          facts: Array.isArray(parsed.facts) ? parsed.facts.map(String) : [],
          dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions.map(String) : [],
          rationale: String(parsed.rationale ?? ""),
        };
        log.info({ projectId, tool: "propose_star_schema", starSchema }, "data-modeler tool");
        return JSON.stringify({ recorded: true, ...starSchema });
      }
      case "generate_semantic_graph": {
        const args: GenerateSemanticGraphArgs = {
          facts: Array.isArray(parsed.facts) ? parsed.facts.map(String) : (starSchema?.facts ?? []),
          dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions.map(String) : (starSchema?.dimensions ?? []),
          joins: Array.isArray(parsed.joins) ? parsed.joins as GenerateSemanticGraphArgs["joins"] : [],
          rationale: String(parsed.rationale ?? starSchema?.rationale ?? ""),
        };
        log.info({ projectId, tool: "generate_semantic_graph", joinCount: args.joins.length }, "data-modeler tool");
        const result = await saveSemanticGraph(projectId, args).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      // Back-compat alias: callers that still call the old name get redirected
      // to the new semantic-graph flow.
      case "propose_relationship": {
        const join = {
          from: `${parsed.sourceTable}.${parsed.sourceColumn}`,
          to: `${parsed.targetTable}.${parsed.targetColumn}`,
          cardinality: (String(parsed.cardinality ?? "1:N") as "1:1" | "1:N" | "N:1" | "N:N"),
        };
        log.info({ projectId, tool: "propose_relationship", join }, "data-modeler tool (back-compat)");
        return JSON.stringify({ note: "propose_relationship is deprecated; aggregating into a single semantic graph. Call generate_semantic_graph when done.", recordedJoin: join });
      }
      default:
        return JSON.stringify({ error: `Tool ${call.name} is not available during the semantic-model pass.` });
    }
  };
}

/** Back-compat name used by the legacy /suggest-relationships route. */
export const makeRelationshipsExecutor = makeSemanticModelExecutor;

export function makeDashboardExecutor(projectId: number, log: pino.Logger) {
  return async (call: AgentToolCall): Promise<string> => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "Could not parse tool arguments as JSON." });
    }

    switch (call.name) {
      case "list_warehouse_tables": {
        log.info({ projectId, tool: "list_warehouse_tables" }, "data-modeler tool");
        const result = await listWarehouseTables(projectId).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "execute_warehouse_query": {
        const sqlText = String(parsed.sql ?? "");
        if (!sqlText) return JSON.stringify({ error: "sql is required" });
        log.info({ projectId, tool: "execute_warehouse_query" }, "data-modeler tool");
        const result = await executeWarehouseQuery(projectId, sqlText).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "create_dashboard": {
        log.info({ projectId, tool: "create_dashboard", title: parsed.title }, "data-modeler tool");
        const result = await createProjectDashboard(projectId, parsed as unknown as CreateDashboardArgs).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ error: `Tool ${call.name} is not available during dashboard generation.` });
    }
  };
}
