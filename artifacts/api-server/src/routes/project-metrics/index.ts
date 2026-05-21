/**
 * Project Phase-3 (MetricArchitectAgent) routes.
 *
 *   POST /api/projects/:id/agents/metric-architect/suggest
 *     Runs the agent and persists proposed metrics in project_metrics.
 *
 *   GET  /api/projects/:id/metrics
 *     List metrics (any status) ordered newest-first.
 *
 *   POST /api/projects/:id/metrics/:mid/accept
 *   POST /api/projects/:id/metrics/:mid/reject
 *   DELETE /api/projects/:id/metrics/:mid
 *   PATCH /api/projects/:id/metrics/:mid
 *     Manual edits to name / description / sqlFormula. Re-runs the formula
 *     validator before persisting so a hand-edited measure cannot bypass the
 *     guardrail.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workspaces as workspacesTable,
  projectMetrics,
  projectSemanticModels,
  listWarehouseTables,
  masterPool,
  warehouseSchema,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { runAgent } from "../../agents/shared/runner";
import { buildMetricArchitectPrompt } from "../../agents/metric-architect/system-prompt";
import { METRIC_ARCHITECT_OPENAI_TOOLS } from "../../agents/metric-architect/tools";
import { makeMetricArchitectExecutor, assertMeasureFormula } from "../../agents/metric-architect/executor";

const router: IRouter = Router();

function isMissingTable(err: unknown): boolean {
  return /relation .* does not exist/i.test(err instanceof Error ? err.message : String(err));
}

function withMigrationGuard(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (isMissingTable(err)) {
        res.status(503).json({
          error: "Database schema is out of date. Run `pnpm db:push` to create the required tables, then restart the API server.",
          code: "SCHEMA_NOT_MIGRATED",
        });
        return;
      }
      throw err;
    }
  };
}

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function loadProjectOr404(projectId: number, res: Response) {
  const [row] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, projectId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return row;
}

async function loadWarehouseTablesWithColumns(projectId: number) {
  const tables = await listWarehouseTables(projectId);
  const schema = warehouseSchema(projectId);
  return Promise.all(tables.map(async (t) => {
    const cols = await masterPool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, t.tableName],
    );
    return {
      tableName: t.tableName,
      rowCount: t.rowCount,
      columns: cols.rows.map((c) => ({ name: c.column_name, type: c.data_type })),
    };
  }));
}

// ---------------------------------------------------------------------------
// /agents/metric-architect/suggest
// ---------------------------------------------------------------------------

router.post("/projects/:id/agents/metric-architect/suggest", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const project = await loadProjectOr404(projectId, res);
  if (!project) return;

  let warehouseTables: Awaited<ReturnType<typeof loadWarehouseTablesWithColumns>>;
  try {
    warehouseTables = await loadWarehouseTablesWithColumns(projectId);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not read warehouse" });
    return;
  }
  if (warehouseTables.length === 0) {
    res.status(400).json({ error: "Warehouse is empty. Apply transformations in Data Engineering first." });
    return;
  }

  const [appliedSm] = await db
    .select()
    .from(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.workspaceId, projectId),
      eq(projectSemanticModels.status, "applied"),
    ))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);

  const existingMetrics = await db
    .select({
      metricName: projectMetrics.metricName,
      sqlFormula: projectMetrics.sqlFormula,
      status: projectMetrics.status,
    })
    .from(projectMetrics)
    .where(eq(projectMetrics.workspaceId, projectId))
    .orderBy(desc(projectMetrics.createdAt));

  const systemPrompt = buildMetricArchitectPrompt({
    projectId,
    projectName: project.name,
    projectDescription: project.description ?? null,
    warehouseTables,
    semanticGraph: appliedSm?.graphDefinition ?? null,
    existingMetrics,
  });

  const userMessage = [
    `Define business KPIs for this project:`,
    `1. Call read_semantic_model to confirm the join graph.`,
    `2. Call suggest_metrics once for inspiration.`,
    `3. For each KPI you want to persist, call save_measure_metadata.`,
    `4. Stop after 4–8 well-justified metrics.`,
  ].join("\n");

  try {
    const result = await runAgent({
      systemPrompt,
      userMessage,
      tools: METRIC_ARCHITECT_OPENAI_TOOLS,
      executeTool: makeMetricArchitectExecutor(projectId, req.log),
      maxIterations: 12,
      maxTokens: 4096,
    });

    const proposed = await db
      .select()
      .from(projectMetrics)
      .where(and(
        eq(projectMetrics.workspaceId, projectId),
        eq(projectMetrics.status, "proposed"),
      ))
      .orderBy(desc(projectMetrics.createdAt))
      .limit(40);

    res.json({
      iterations: result.iterations,
      toolCalls: result.toolCallsByName,
      finalText: result.finalText,
      proposedCount: result.toolCallsByName["save_measure_metadata"] ?? 0,
      metrics: proposed,
    });
  } catch (err) {
    req.log.error({ err, projectId }, "metric-architect suggest failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Agent run failed" });
  }
}));

// ---------------------------------------------------------------------------
// Metrics CRUD
// ---------------------------------------------------------------------------

router.get("/projects/:id/metrics", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const rows = await db
    .select()
    .from(projectMetrics)
    .where(eq(projectMetrics.workspaceId, projectId))
    .orderBy(desc(projectMetrics.createdAt));
  res.json({ metrics: rows });
}));

router.post("/projects/:id/metrics/:mid/accept", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const mid = parseId(req.params.mid as string);
  if (projectId === null || mid === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const [updated] = await db
    .update(projectMetrics)
    .set({ status: "applied" })
    .where(and(eq(projectMetrics.id, mid), eq(projectMetrics.workspaceId, projectId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Metric not found" }); return; }
  res.json({ ok: true, status: "applied", metric: updated });
});

router.post("/projects/:id/metrics/:mid/reject", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const mid = parseId(req.params.mid as string);
  if (projectId === null || mid === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .update(projectMetrics)
    .set({ status: "rejected" })
    .where(and(eq(projectMetrics.id, mid), eq(projectMetrics.workspaceId, projectId)));
  res.json({ ok: true, status: "rejected" });
});

router.delete("/projects/:id/metrics/:mid", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const mid = parseId(req.params.mid as string);
  if (projectId === null || mid === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .delete(projectMetrics)
    .where(and(eq(projectMetrics.id, mid), eq(projectMetrics.workspaceId, projectId)));
  res.status(204).send();
});

router.patch("/projects/:id/metrics/:mid", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const mid = parseId(req.params.mid as string);
  if (projectId === null || mid === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof projectMetrics.$inferInsert> = {};

  if (typeof body.metricName === "string") {
    const name = body.metricName.trim();
    if (!/^[a-z][a-z0-9_]{1,127}$/.test(name)) {
      res.status(400).json({ error: "metricName must be snake_case, start with a letter, ≤128 chars." });
      return;
    }
    updates.metricName = name;
  }
  if (typeof body.description === "string") updates.description = body.description.slice(0, 2000);
  if (typeof body.sqlFormula === "string") {
    try {
      assertMeasureFormula(body.sqlFormula);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid sqlFormula" });
      return;
    }
    updates.sqlFormula = body.sqlFormula;
  }
  if (Array.isArray(body.dependsOnTables)) {
    updates.dependsOnTables = body.dependsOnTables.map(String);
  }

  const [updated] = await db
    .update(projectMetrics)
    .set(updates)
    .where(and(eq(projectMetrics.id, mid), eq(projectMetrics.workspaceId, projectId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Metric not found" }); return; }
  res.json({ metric: updated });
});

export default router;
