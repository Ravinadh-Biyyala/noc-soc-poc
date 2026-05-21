import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pool,
  datasets as datasetsTable,
  userDashboards,
  dashboardCharts,
} from "@workspace/db";
import type { DatasetColumn, ChartConfig } from "@workspace/db";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function serializeDashboard(d: typeof userDashboards.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    flatTableName: d.flatTableName,
    sourceDatasetIds: (d.sourceDatasetIds as number[]) ?? [],
    rowCount: d.rowCount,
    status: d.status,
    agentLog: d.agentLog,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeChart(c: typeof dashboardCharts.$inferSelect) {
  return {
    id: c.id,
    dashboardId: c.dashboardId,
    title: c.title,
    chartType: c.chartType,
    config: c.config,
    position: c.position,
    colSpan: c.colSpan ?? 1,
    hidden: c.hidden ?? false,
    createdAt: c.createdAt.toISOString(),
  };
}

// Converts a snake_case column name to human-readable Title Case,
// stripping any leading aggregation prefix the column may already contain.
function colToLabel(col: string): string {
  const cleaned = col.replace(/^(total_|avg_|average_|sum_|count_|num_|distinct_)/i, "");
  return cleaned.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fuzzy-resolves a chart xKey/yKey against the actual columns present in dsRows.
// Returns exact match first, then falls back to a column whose name contains all
// words from the target (handles mismatches like "membership_tier" vs "owner_membership_tier").
function resolveColumn(target: string | undefined, available: string[]): string | undefined {
  if (!target) return undefined;
  if (available.includes(target)) return target;
  const words = target.toLowerCase().split("_").filter((w) => w.length > 2);
  return available.find((col) => words.every((w) => col.toLowerCase().includes(w)));
}

// Extracts a short human-readable label from an ISO date string (e.g. "2000-12-31T18:30:00Z" → "2000").
function extractDateLabel(v: string): string {
  const m = String(v).match(/^(\d{4})/);
  return m ? m[1] : String(v);
}

// Cleans up AI-generated KPI titles that contain raw snake_case column names.
// "Total total_annual_revenue" → "Total Annual Revenue"
function sanitizeKpiTitle(raw: string): string {
  const m = raw.match(/^(Total|Avg|Average|Distinct|Count)\s+(.+)$/i);
  if (m) {
    const prefix = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const body = colToLabel(m[2]);
    return body.toLowerCase().startsWith(prefix.toLowerCase()) ? body : `${prefix} ${body}`;
  }
  if (raw.includes("_") || /^[A-Z_\s]+$/.test(raw)) return colToLabel(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Helper: programmatically generate up to 4 KPI charts for a dashboard
// that has fewer than 4, without calling the AI.
// ---------------------------------------------------------------------------
async function ensureKpis(
  flatTableName: string,
  dashId: number,
  existingCharts: ReturnType<typeof serializeChart>[],
  maxPosition: number,
): Promise<ReturnType<typeof serializeChart>[]> {
  const existingKpis = existingCharts.filter((c) => c.chartType === "kpi");
  if (existingKpis.length >= 4) return [];

  const existingTitles = new Set(existingCharts.map((c) => c.title.toLowerCase()));

  const client = await pool.connect();
  try {
    // Detect numeric and categorical columns from the flat table
    const colResult = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = $1 AND column_name != '_row_id'
       ORDER BY ordinal_position`,
      [flatTableName]
    );
    const colDefs = colResult.rows as Array<{ column_name: string; data_type: string }>;

    const numericCols = colDefs
      .filter((c) => /int|float|numeric|double|real|decimal/i.test(c.data_type))
      .map((c) => c.column_name);
    const categoricalCols = colDefs
      .filter((c) => !/int|float|numeric|double|real|decimal|bool/i.test(c.data_type))
      .map((c) => c.column_name);

    const bestNumeric =
      numericCols.find((c) => /revenue|amount|sales|price|value|total|cost|fee|premium/i.test(c)) ??
      numericCols[0];
    const bestCategorical =
      categoricalCols.find((c) => /customer|category|region|product|user|type|status|name|brand|city|segment|tier/i.test(c)) ??
      categoricalCols[0];

    // Four KPI candidates — only generate the ones not already present
    const candidates: Array<{ title: string; sql: string; yKey: string }> = [
      {
        title: "Total Records",
        sql: `SELECT COUNT(*) AS total_records FROM "${flatTableName}"`,
        yKey: "total_records",
      },
    ];
    if (bestNumeric) {
      candidates.push(
        {
          title: `Total ${colToLabel(bestNumeric)}`,
          sql: `SELECT SUM("${bestNumeric}") AS total_${bestNumeric} FROM "${flatTableName}"`,
          yKey: `total_${bestNumeric}`,
        },
        {
          title: `Avg ${colToLabel(bestNumeric)}`,
          sql: `SELECT ROUND(AVG("${bestNumeric}")::numeric, 2) AS avg_${bestNumeric} FROM "${flatTableName}"`,
          yKey: `avg_${bestNumeric}`,
        },
      );
    }
    if (bestCategorical) {
      candidates.push({
        title: `Distinct ${colToLabel(bestCategorical)}`,
        sql: `SELECT COUNT(DISTINCT "${bestCategorical}") AS distinct_${bestCategorical} FROM "${flatTableName}"`,
        yKey: `distinct_${bestCategorical}`,
      });
    }

    const needed = 4 - existingKpis.length;
    const toCreate = candidates
      .filter((c) => !existingTitles.has(c.title.toLowerCase()))
      .slice(0, needed);

    if (toCreate.length === 0) return [];

    const newChartValues: Array<typeof dashboardCharts.$inferInsert> = [];
    let pos = maxPosition + 1;

    for (const kpi of toCreate) {
      try {
        await client.query("SET statement_timeout = 5000");
        const result = await client.query(kpi.sql);
        const data = result.rows.slice(0, 1).map((r: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            if (k !== "_row_id") out[k] = v;
          }
          return out;
        });
        if (data.length === 0) continue;
        newChartValues.push({
          dashboardId: dashId,
          title: kpi.title,
          chartType: "kpi",
          config: { xKey: kpi.yKey, yKey: kpi.yKey, data, sql: kpi.sql },
          position: pos++,
        });
      } catch {
        // individual KPI query failed — skip
      }
    }

    if (newChartValues.length === 0) return [];
    const inserted = await db.insert(dashboardCharts).values(newChartValues).returning();
    return inserted.map(serializeChart);
  } finally {
    client.release();
  }
}

// GET /user-dashboards
router.get("/user-dashboards", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(userDashboards)
    .orderBy(desc(userDashboards.createdAt));
  res.json(rows.map(serializeDashboard));
});

// GET /user-dashboards/:id
router.get("/user-dashboards/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dashboard ID" }); return; }

  const [dash] = await db
    .select()
    .from(userDashboards)
    .where(eq(userDashboards.id, id))
    .limit(1);
  if (!dash) { res.status(404).json({ error: "Dashboard not found" }); return; }

  const charts = await db
    .select()
    .from(dashboardCharts)
    .where(eq(dashboardCharts.dashboardId, id))
    .orderBy(asc(dashboardCharts.position));

  // Start with serialized charts from DB
  let allCharts = charts.map(serializeChart);

  // Fetch raw flat-table rows so the frontend can render slicers + Data Scientist agent.
  // Also re-execute SQL for any charts whose stored data is empty (self-healing).
  let dsRows: Record<string, unknown>[] = [];
  let dsCols: Array<{ name: string; type: string }> = [];
  {
    const client = await pool.connect();
    try {
      const colResult = await client.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = $1 AND column_name != '_row_id'
         ORDER BY ordinal_position`,
        [dash.flatTableName]
      );
      dsCols = (colResult.rows as Array<{ column_name: string; data_type: string }>).map((c) => ({
        name: c.column_name,
        type: /int|float|numeric|double|real|decimal/i.test(c.data_type) ? "number"
             : /bool/i.test(c.data_type) ? "boolean"
             : "string",
      }));
      const rowResult = await client.query(
        `SELECT * FROM "${dash.flatTableName}" LIMIT 1000`
      );
      dsRows = rowResult.rows.map((r: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k !== "_row_id") out[k] = v;
        }
        return out;
      });

      // Re-execute SQL for charts that have an empty data array
      for (const chart of allCharts) {
        const cfg = chart.config as ChartConfig;
        if ((!Array.isArray(cfg.data) || cfg.data.length === 0) && cfg.sql) {
          try {
            await client.query("SET statement_timeout = 8000");
            const result = await client.query(cfg.sql);
            if (result.rows.length > 0) {
              const freshData = result.rows.slice(0, 1000).map((r: Record<string, unknown>) => {
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r)) {
                  if (k !== "_row_id") out[k] = v;
                }
                return out;
              });
              await db
                .update(dashboardCharts)
                .set({ config: { ...cfg, data: freshData } as ChartConfig })
                .where(eq(dashboardCharts.id, chart.id));
              chart.config = { ...cfg, data: freshData };
            }
          } catch {
            // leave as-is if re-execution fails
          }
        }
      }

      // For charts still empty after re-execution: derive from raw flat-table rows,
      // then hide only if derivation also yields nothing.
      const availableCols = dsRows.length > 0 ? Object.keys(dsRows[0]) : [];
      for (const chart of allCharts) {
        const cfg = chart.config as ChartConfig;
        if (chart.chartType === "kpi" || chart.hidden) continue;
        const dataIsEmpty = !Array.isArray(cfg.data) || cfg.data.length === 0;
        if (!dataIsEmpty) continue;

        let xKey = resolveColumn(cfg.xKey, availableCols);
        // Last-resort: if the stored xKey doesn't resolve, use the first string column from the schema
        if (!xKey) xKey = dsCols.find((c) => c.type === "string")?.name;

        const yKeyRaw = Array.isArray(cfg.yKey) ? cfg.yKey[0] : cfg.yKey;
        let yKey = resolveColumn(yKeyRaw, availableCols);
        // Prefer a numeric column for yKey if available
        if (!yKey || yKey === xKey) yKey = dsCols.find((c) => c.type === "number" && c.name !== xKey)?.name;

        if (xKey && dsRows.length > 0) {
          const agg: Record<string, number> = {};
          for (const row of dsRows) {
            const xVal = String(row[xKey] ?? "Unknown");
            const useYKey = yKey && yKey !== xKey;
            agg[xVal] = (agg[xVal] || 0) + (useYKey ? Number(row[yKey!] || 0) : 1);
          }
          const limit = chart.chartType === "pie" ? 8 : 10;
          const derivedData = Object.entries(agg)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([k, v]) => ({ [xKey]: k, [yKey || "count"]: v }));

          if (derivedData.length > 0) {
            const resolvedYKey = yKey || "count";
            const newCfg = { ...cfg, data: derivedData, xKey, yKey: resolvedYKey };
            await db
              .update(dashboardCharts)
              .set({ config: newCfg as ChartConfig })
              .where(eq(dashboardCharts.id, chart.id));
            chart.config = newCfg;
            continue;
          }
        }

        // Truly unrecoverable — hide so no blank box appears
        await db
          .update(dashboardCharts)
          .set({ hidden: true })
          .where(eq(dashboardCharts.id, chart.id));
        chart.hidden = true;
      }
    } catch {
      // flat table missing or inaccessible — skip gracefully
    } finally {
      client.release();
    }
  }

  // Sanitize KPI titles that still contain raw snake_case from initial AI creation.
  // Runs on every GET but only writes to DB when the title actually changes.
  for (const chart of allCharts) {
    if (chart.chartType !== "kpi") continue;
    const sanitized = sanitizeKpiTitle(chart.title);
    if (sanitized !== chart.title) {
      await db
        .update(dashboardCharts)
        .set({ title: sanitized })
        .where(eq(dashboardCharts.id, chart.id));
      chart.title = sanitized;
    }
  }

  // Auto-generate missing KPIs (self-healing for dashboards created before the 4-KPI requirement)
  const kpiCount = allCharts.filter((c) => c.chartType === "kpi").length;
  if (kpiCount < 4) {
    const maxPos = allCharts.reduce((m, c) => Math.max(m, c.position), -1);
    const newKpis = await ensureKpis(dash.flatTableName, id, allCharts, maxPos);
    allCharts = [...allCharts, ...newKpis];
  }

  res.json({
    ...serializeDashboard(dash),
    charts: allCharts,
    dataScience: { rows: dsRows, columns: dsCols },
  });
});

// DELETE /user-dashboards/:id
router.delete("/user-dashboards/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dashboard ID" }); return; }

  const [dash] = await db
    .select()
    .from(userDashboards)
    .where(eq(userDashboards.id, id))
    .limit(1);
  if (!dash) { res.status(404).json({ error: "Dashboard not found" }); return; }

  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS "${dash.flatTableName}"`);
  } finally {
    client.release();
  }

  await db.delete(userDashboards).where(eq(userDashboards.id, id));
  req.log.info({ dashboardId: id, flatTableName: dash.flatTableName }, "User dashboard deleted");
  res.status(204).send();
});

// POST /user-dashboards — AI agent creates flat table + initial charts
router.post("/user-dashboards", async (req: Request, res: Response) => {
  const body = req.body as { datasetIds?: unknown; name?: unknown };

  if (!Array.isArray(body.datasetIds) || body.datasetIds.length === 0) {
    res.status(400).json({ error: "datasetIds must be a non-empty array" });
    return;
  }

  const datasetIds = (body.datasetIds as unknown[])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (datasetIds.length === 0) {
    res.status(400).json({ error: "No valid dataset IDs provided" });
    return;
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : "My Dashboard";

  const flatTableName = `flat_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  // Fetch dataset metadata
  const datasetRows = await db
    .select()
    .from(datasetsTable)
    .where(inArray(datasetsTable.id, datasetIds));

  if (datasetRows.length === 0) {
    res.status(404).json({ error: "No datasets found for the given IDs" });
    return;
  }

  req.log.info({ datasetIds, flatTableName, name }, "Dashboard creation started");

  // Fetch sample rows for each dataset
  const tableInfos: Array<{
    dataset: typeof datasetsTable.$inferSelect;
    sampleRows: Record<string, unknown>[];
  }> = [];

  {
    const client = await pool.connect();
    try {
      for (const ds of datasetRows) {
        const result = await client.query(
          `SELECT * FROM "${ds.tableName}" LIMIT 20`
        );
        tableInfos.push({ dataset: ds, sampleRows: result.rows });
      }
    } finally {
      client.release();
    }
  }

  // Build prompt for OpenAI
  const tableDescriptions = tableInfos
    .map(({ dataset, sampleRows }) => {
      const cols = dataset.columnSchema as DatasetColumn[];
      const colList = cols
        .map((c) => `  "${c.pgName}" ${c.pgType}  -- original: "${c.originalName}"`)
        .join("\n");
      const sample = JSON.stringify(sampleRows.slice(0, 3), null, 2);
      return (
        `Table: "${dataset.tableName}"` +
        ` (file: ${dataset.fileName}, sheet: ${dataset.sheetName}, ${dataset.rowCount} rows)\n` +
        `Columns:\n${colList}\nSample (3 rows):\n${sample}`
      );
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a data engineering expert. Given PostgreSQL tables, create a merged flat analysis table and suggest analysis queries for an analytics dashboard.

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "mergeSQL": "CREATE TABLE \\"${flatTableName}\\" AS SELECT ...",
  "rationale": "1-2 sentence explanation of merge strategy",
  "analysisQueries": [
    { "question": "plain English question", "sql": "SELECT ... FROM \\"${flatTableName}\\" ...", "chartType": "bar|line|pie|scatter|kpi|area|table", "title": "short chart title" }
  ]
}

Rules:
1. flatTableName MUST be exactly "${flatTableName}" — double-quote it in SQL
2. mergeSQL MUST be CREATE TABLE AS SELECT (one statement, no semicolons inside)
3. If tables share a join key (e.g. policy_id, customer_id, id), JOIN them; otherwise UNION ALL or pick the largest table
4. All column references MUST use the pg names (sanitized names shown), NOT the original names
5. analysisQueries: exactly 9 items total. Items 1–4 MUST be KPI queries (chartType: "kpi"). Items 5–9 are visualization charts.
6. chartType rules: "kpi" = single aggregate (SELECT COUNT(*) or SUM/AVG with no GROUP BY); "bar" = top-N categories (ORDER BY value DESC LIMIT 10); "line" = time trend (requires date/year/month column, ORDER BY that column); "area" = cumulative trend; "pie" = distribution ≤8 rows (LIMIT 8); "scatter" = numeric vs numeric; "table" = detail rows
7. REQUIRED KPI composition (items 1–4, all chartType "kpi"):
   - KPI 1: Total record count — SELECT COUNT(*) as total_records FROM "${flatTableName}"
   - KPI 2: SUM of the most important numeric column (revenue, amount, sales, price, value, etc.)
   - KPI 3: AVG of the same or another key numeric column
   - KPI 4: COUNT(DISTINCT ...) of the most meaningful categorical column (customer, id, category, region, etc.)
   Use descriptive titles like "Total Records", "Total Revenue", "Average Order Value", "Distinct Customers"
8. REQUIRED chart composition — each item MUST use exactly the specified chartType:
   - Item 5: chartType MUST be "bar" — top category breakdown, ORDER BY value DESC LIMIT 10
   - Item 6: chartType MUST be "pie" — distribution by most meaningful categorical column, GROUP BY + LIMIT 8
   - Item 7: chartType MUST be "line" if any date/year/month column exists, else "area" — trend over time
   - Item 8: chartType MUST be "bar" — different GROUP BY column than item 5
   - Item 9: chartType MUST be "scatter" if 2+ numeric columns are available, else "area" — NEVER use "bar" for item 9
9. CRITICAL for pie charts: query MUST return ≤8 rows. Use GROUP BY + ORDER BY count DESC + LIMIT 8
10. CRITICAL for kpi: query must return exactly 1 row with exactly 1 numeric column
11. Do NOT include _row_id in any SELECT
12. Every query must be guaranteed to return at least 1 row — use simple aggregates, not complex joins`;

  const userMsg = `Tables to merge:\n\n${tableDescriptions}\n\nCreate flat table "${flatTableName}" and 9 initial analysis queries (4 KPIs + 5 charts).`;

  let agentResult: {
    mergeSQL: string;
    rationale: string;
    analysisQueries: Array<{
      question: string;
      sql: string;
      chartType: string;
      title: string;
    }>;
  };

  try {
    const aiResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      max_completion_tokens: 4500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    });

    const rawContent = (aiResponse.choices[0]?.message?.content ?? "{}").trim();
    agentResult = JSON.parse(rawContent);
  } catch (err) {
    req.log.error({ err }, "AI agent failed");
    res.status(500).json({ error: "AI agent failed to generate merge strategy" });
    return;
  }

  if (!agentResult.mergeSQL) {
    res.status(500).json({ error: "AI agent did not return merge SQL" });
    return;
  }

  // Execute merge SQL to create flat table
  let flatRowCount = 0;
  {
    const client = await pool.connect();
    try {
      await client.query(agentResult.mergeSQL);
      const countResult = await client.query(
        `SELECT COUNT(*) as cnt FROM "${flatTableName}"`
      );
      flatRowCount = parseInt((countResult.rows[0] as any)?.cnt ?? "0", 10);
      req.log.info({ flatTableName, rowCount: flatRowCount }, "Flat table created");
    } catch (err) {
      req.log.error({ err, mergeSQL: agentResult.mergeSQL }, "Failed to create flat table");
      try { await client.query(`DROP TABLE IF EXISTS "${flatTableName}"`); } catch {}
      res.status(500).json({ error: "Failed to create merged table", detail: String(err) });
      return;
    } finally {
      client.release();
    }
  }

  // Execute analysis queries to build initial charts
  const analysisQueries = Array.isArray(agentResult.analysisQueries)
    ? agentResult.analysisQueries
    : [];

  const chartValues: Array<{
    dashboardId: number;
    title: string;
    chartType: string;
    config: ChartConfig;
    position: number;
  }> = [];

  {
    const client = await pool.connect();
    try {
      for (let i = 0; i < analysisQueries.length; i++) {
        const aq = analysisQueries[i];
        if (!aq?.sql) continue;

        const firstWord = aq.sql
          .replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, "")
          .trim()
          .split(/\s+/)[0]
          ?.toUpperCase();
        if (firstWord !== "SELECT") continue;

        try {
          await client.query("SET statement_timeout = 8000");
          const result = await client.query(aq.sql);
          let data = result.rows.slice(0, 1000).map((r) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) {
              if (k !== "_row_id") out[k] = v;
            }
            return out;
          });
          const columns = result.fields
            .map((f) => f.name)
            .filter((c) => c !== "_row_id");

          const numericCols = columns.filter((col) => {
            const vals = data.map((r) => r[col]);
            const nc = vals.filter((v) => v !== null && !isNaN(Number(v))).length;
            return nc / Math.max(vals.length, 1) > 0.7;
          });
          const categoricalCols = columns.filter((c) => !numericCols.includes(c));

          let xKey = categoricalCols[0] ?? columns[0] ?? "x";
          let yKey = numericCols[0] ?? columns[1] ?? columns[0] ?? "y";
          let finalSql = aq.sql;

          // When AI query returns 0 rows for a visualization chart, try a reliable fallback
          // using the actual column names from the result fields.
          if (data.length === 0 && aq.chartType !== "kpi" && columns.length >= 1) {
            const catField = columns[0]; // first column (usually the group-by key)
            const numField = columns[1]; // second column (usually the aggregate)
            const limit = aq.chartType === "pie" ? 8 : 10;
            const fbSql = numField
              ? `SELECT "${catField}", SUM("${numField}") AS total FROM "${flatTableName}" GROUP BY "${catField}" ORDER BY total DESC LIMIT ${limit}`
              : `SELECT "${catField}", COUNT(*) AS count FROM "${flatTableName}" GROUP BY "${catField}" ORDER BY count DESC LIMIT ${limit}`;
            try {
              const fbResult = await client.query(fbSql);
              if (fbResult.rows.length > 0) {
                data = fbResult.rows.slice(0, limit).map((r) => {
                  const out: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(r)) if (k !== "_row_id") out[k] = v;
                  return out;
                });
                xKey = catField;
                yKey = numField ? "total" : "count";
                finalSql = fbSql;
              }
            } catch { /* fallback failed — GET derive will recover */ }
          }

          // Normalize ISO date strings on the x-axis of time-series charts to plain year labels.
          if ((aq.chartType === "line" || aq.chartType === "area") && data.length > 0) {
            const sampleX = String(data[0][xKey] ?? "");
            if (/^\d{4}-\d{2}/.test(sampleX)) {
              data = data.map((row) => ({ ...row, [xKey]: extractDateLabel(String(row[xKey] ?? "")) }));
            }
          }

          chartValues.push({
            dashboardId: 0,
            title: aq.title || aq.question,
            chartType: aq.chartType || "bar",
            config: {
              xKey,
              yKey,
              data,
              sql: finalSql,
              question: aq.question,
            },
            position: i,
          });
        } catch (err) {
          req.log.warn({ err, sql: aq.sql }, "Analysis query failed — skipping chart");
        }
      }
    } finally {
      client.release();
    }
  }

  // Store dashboard in DB
  const [dashboard] = await db
    .insert(userDashboards)
    .values({
      name,
      flatTableName,
      sourceDatasetIds: datasetIds,
      rowCount: flatRowCount,
      status: "ready",
      agentLog: agentResult.rationale ?? null,
    })
    .returning();

  // Store initial charts with correct dashboardId
  let charts: ReturnType<typeof serializeChart>[] = [];
  if (chartValues.length > 0) {
    const inserted = await db
      .insert(dashboardCharts)
      .values(chartValues.map((c) => ({ ...c, dashboardId: dashboard.id })))
      .returning();
    charts = inserted.map(serializeChart);
  }

  // Fallback: ensure exactly 4 KPIs even if AI prompt underdelivered
  const aiKpiCount = charts.filter((c) => c.chartType === "kpi").length;
  if (aiKpiCount < 4) {
    const maxPos = charts.reduce((m, c) => Math.max(m, c.position), -1);
    const extraKpis = await ensureKpis(flatTableName, dashboard.id, charts, maxPos);
    charts = [...charts, ...extraKpis];
  }

  // Enforce chart diversity: cap bar charts at 2, convert excess to pie/line/area
  const barChartIds = charts
    .filter((c) => c.chartType === "bar" && !c.hidden)
    .map((c) => c.id);
  if (barChartIds.length > 2) {
    for (const barId of barChartIds.slice(2)) {
      const bar = charts.find((c) => c.id === barId)!;
      const cfg = bar.config as ChartConfig;
      const data = Array.isArray(cfg.data) ? cfg.data : [];
      const distinctX = new Set(data.map((r) => r[cfg.xKey ?? ""])).size;
      const hasDate = /date|year|month|quarter|week|period|time/i.test(cfg.xKey ?? "");
      const newType = distinctX <= 8 ? "pie" : hasDate ? "line" : "area";
      await db
        .update(dashboardCharts)
        .set({ chartType: newType })
        .where(eq(dashboardCharts.id, barId));
      bar.chartType = newType;
    }
  }

  req.log.info(
    { dashboardId: dashboard.id, chartCount: charts.length, kpiCount: charts.filter((c) => c.chartType === "kpi").length, flatTableName },
    "User dashboard created"
  );
  res.status(201).json({ ...serializeDashboard(dashboard), charts });
});

// POST /user-dashboards/:id/charts — add a new chart via NL question
router.post("/user-dashboards/:id/charts", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dashboard ID" }); return; }

  const [dash] = await db
    .select()
    .from(userDashboards)
    .where(eq(userDashboards.id, id))
    .limit(1);
  if (!dash) { res.status(404).json({ error: "Dashboard not found" }); return; }

  const body = req.body as { question?: unknown; title?: unknown; chartData?: unknown };

  // Fast path: caller provides pre-built chart data (e.g. pinned from chat).
  if (body.chartData && typeof body.chartData === "object") {
    const cd = body.chartData as Record<string, unknown>;
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : typeof cd.title === "string" ? cd.title : "Pinned Chart";

    const existingForPin = await db
      .select({ position: dashboardCharts.position })
      .from(dashboardCharts)
      .where(eq(dashboardCharts.dashboardId, id));
    const maxPinPos = existingForPin.reduce((m, c) => Math.max(m, c.position), -1);

    const [pinChart] = await db
      .insert(dashboardCharts)
      .values({
        dashboardId: id,
        title,
        chartType: typeof cd.type === "string" ? cd.type : "bar",
        config: {
          xKey: typeof cd.xKey === "string" ? cd.xKey : "x",
          yKey: typeof cd.yKey === "string" ? cd.yKey : "y",
          data: Array.isArray(cd.data) ? cd.data : [],
        },
        position: maxPinPos + 1,
      })
      .returning();

    await db
      .update(userDashboards)
      .set({ updatedAt: new Date() })
      .where(eq(userDashboards.id, id));

    res.status(201).json(serializeChart(pinChart));
    return;
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3) {
    res.status(400).json({ error: "question must be at least 3 characters" });
    return;
  }

  // Get flat table column info from information_schema
  let colDefs: Array<{ column_name: string; data_type: string }> = [];
  {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = $1 AND column_name != '_row_id'
         ORDER BY ordinal_position`,
        [dash.flatTableName]
      );
      colDefs = result.rows as typeof colDefs;
    } finally {
      client.release();
    }
  }

  const schemaDescription = colDefs
    .map((c) => `  "${c.column_name}" ${c.data_type}`)
    .join("\n");

  const nlSqlPrompt = `You are a PostgreSQL expert. Write a SELECT query to answer the user's question.

Table: "${dash.flatTableName}"
Schema:
${schemaDescription}

Question: ${question}

Rules:
1. Return ONLY valid JSON (no markdown) with this structure: {"sql": "SELECT ...", "chartType": "bar|line|area|pie|scatter|kpi|table"}
2. sql: a SELECT query, LIMIT at most 1000 rows, no _row_id in SELECT
3. chartType: "kpi" if result is a single aggregate value; "pie" if ≤8 categories (add LIMIT 8); "line" if there is a date/time/year column; "scatter" if comparing two numeric columns; "table" for detail rows; "bar" for category breakdowns
4. For pie: query must return ≤8 rows — use ORDER BY + LIMIT 8
5. For kpi: return exactly 1 row with 1 numeric column`;

  const sqlResponse = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    max_completion_tokens: 512,
    messages: [{ role: "user", content: nlSqlPrompt }],
    response_format: { type: "json_object" },
  });

  let rawSql: string;
  let aiChartType: string = "bar";
  try {
    const parsed = JSON.parse(sqlResponse.choices[0]?.message?.content ?? "{}");
    rawSql = (parsed.sql ?? "").trim();
    aiChartType = (parsed.chartType ?? "bar").trim().toLowerCase();
  } catch {
    rawSql = (sqlResponse.choices[0]?.message?.content ?? "").trim();
  }

  const firstWord = rawSql
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, "")
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase();

  if (firstWord !== "SELECT") {
    res.status(400).json({ error: "AI generated a non-SELECT query — only SELECT is allowed" });
    return;
  }

  let data: Record<string, unknown>[] = [];
  let columns: string[] = [];
  {
    const client = await pool.connect();
    try {
      await client.query("SET statement_timeout = 5000");
      const result = await client.query(rawSql);
      data = result.rows.slice(0, 1000).map((r: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k !== "_row_id") out[k] = v;
        }
        return out;
      });
      columns = result.fields.map((f: { name: string }) => f.name).filter((c: string) => c !== "_row_id");
    } finally {
      client.release();
    }
  }

  const numericCols = columns.filter((col) => {
    const vals = data.map((r) => r[col]);
    const nc = vals.filter((v) => v !== null && !isNaN(Number(v))).length;
    return nc / Math.max(vals.length, 1) > 0.7;
  });
  const categoricalCols = columns.filter((c) => !numericCols.includes(c));

  // Use AI-suggested chart type, but also validate it with the actual data shape
  function inferChartType(): string {
    if (data.length === 1 && numericCols.length >= 1 && categoricalCols.length === 0) return "kpi";
    if (data.length <= 8 && categoricalCols.length >= 1 && numericCols.length === 1 && aiChartType === "pie") return "pie";
    if (numericCols.length >= 2 && categoricalCols.length === 0) return "scatter";
    const hasDate = categoricalCols.some((c) => /date|year|month|quarter|week|period|time/i.test(c));
    if (hasDate && numericCols.length >= 1 && (aiChartType === "line" || aiChartType === "area")) return aiChartType;
    if (["bar", "line", "area", "pie", "scatter", "kpi", "table"].includes(aiChartType)) return aiChartType;
    return "bar";
  }

  const chartType = inferChartType();
  const xKey = categoricalCols[0] ?? columns[0] ?? "x";
  const yKey = numericCols[0] ?? columns[1] ?? columns[0] ?? "y";

  const existingCharts = await db
    .select({ position: dashboardCharts.position })
    .from(dashboardCharts)
    .where(eq(dashboardCharts.dashboardId, id));
  const maxPosition = existingCharts.reduce(
    (max, c) => Math.max(max, c.position),
    -1
  );

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : question;

  const [chart] = await db
    .insert(dashboardCharts)
    .values({
      dashboardId: id,
      title,
      chartType,
      config: { xKey, yKey, data, sql: rawSql, question },
      position: maxPosition + 1,
    })
    .returning();

  await db
    .update(userDashboards)
    .set({ updatedAt: new Date() })
    .where(eq(userDashboards.id, id));

  req.log.info({ dashboardId: id, chartId: chart.id }, "Chart added to dashboard");
  res.status(201).json(serializeChart(chart));
});

// PATCH /user-dashboards/:id/charts/:chartId — update title, chartType, or position
router.patch(
  "/user-dashboards/:id/charts/:chartId",
  async (req: Request, res: Response) => {
    const dashId = parseId(req.params.id as string);
    const chartId = parseId(req.params.chartId as string);
    if (dashId === null || chartId === null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [chart] = await db
      .select()
      .from(dashboardCharts)
      .where(eq(dashboardCharts.id, chartId))
      .limit(1);
    if (!chart || chart.dashboardId !== dashId) {
      res.status(404).json({ error: "Chart not found" });
      return;
    }

    const body = req.body as {
      title?: unknown;
      chartType?: unknown;
      position?: unknown;
      colSpan?: unknown;
      hidden?: unknown;
    };
    const updates: Partial<typeof dashboardCharts.$inferInsert> = {};

    if (typeof body.title === "string" && body.title.trim())
      updates.title = body.title.trim();
    if (typeof body.chartType === "string" && body.chartType.trim())
      updates.chartType = body.chartType.trim();
    if (typeof body.position === "number") updates.position = body.position;
    if (typeof body.colSpan === "number") updates.colSpan = body.colSpan;
    if (typeof body.hidden === "boolean") updates.hidden = body.hidden;

    const [updated] = await db
      .update(dashboardCharts)
      .set(updates)
      .where(eq(dashboardCharts.id, chartId))
      .returning();

    res.json(serializeChart(updated));
  }
);

// DELETE /user-dashboards/:id/charts/:chartId
router.delete(
  "/user-dashboards/:id/charts/:chartId",
  async (req: Request, res: Response) => {
    const dashId = parseId(req.params.id as string);
    const chartId = parseId(req.params.chartId as string);
    if (dashId === null || chartId === null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [chart] = await db
      .select()
      .from(dashboardCharts)
      .where(eq(dashboardCharts.id, chartId))
      .limit(1);
    if (!chart || chart.dashboardId !== dashId) {
      res.status(404).json({ error: "Chart not found" });
      return;
    }

    await db.delete(dashboardCharts).where(eq(dashboardCharts.id, chartId));
    await db
      .update(userDashboards)
      .set({ updatedAt: new Date() })
      .where(eq(userDashboards.id, dashId));

    req.log.info({ dashboardId: dashId, chartId }, "Chart deleted from dashboard");
    res.status(204).send();
  }
);

export default router;
