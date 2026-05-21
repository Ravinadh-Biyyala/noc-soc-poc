/**
 * Project Phase-2 (DataModelerAgent) routes.
 *
 *   POST /api/projects/:id/agents/data-modeler/suggest
 *     Runs the agent against the warehouse and writes one proposed row into
 *     project_semantic_models (facts / dimensions / joins as JSONB).
 *
 *   GET  /api/projects/:id/semantic-model
 *     Returns the latest (proposed + applied) semantic model rows.
 *
 *   POST /api/projects/:id/semantic-model/:smId/accept
 *   POST /api/projects/:id/semantic-model/:smId/reject
 *   DELETE /api/projects/:id/semantic-model/:smId
 *
 *   POST /api/projects/:id/agents/data-modeler/generate-dashboard
 *     Runs the second agent pass — design 4–6 charts and persist them as a
 *     dashboard via the existing user_dashboards / dashboard_charts tables.
 *
 * Legacy aliases (kept so the UI doesn't break mid-migration):
 *   POST /api/projects/:id/agents/data-modeler/suggest-relationships  → suggest
 *   GET  /api/projects/:id/relationships                              → semantic-model
 *   POST /api/projects/:id/relationships/:rid/(accept|reject)         → semantic-model/:smId/...
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workspaces as workspacesTable,
  projectSemanticModels,
  userDashboards,
  dashboardCharts,
  listWarehouseTables,
  masterPool,
  warehouseSchema,
  type SemanticGraphDefinition,
} from "@workspace/db";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { runAgent } from "../../agents/shared/runner";
import { assertSelectOnly, assertSchemaScope } from "../../agents/shared/validation";
import {
  buildDataModelerSemanticPrompt,
  buildDataModelerDashboardPrompt,
} from "../../agents/data-modeler/system-prompt";
import {
  DATA_MODELER_SEMANTIC_TOOLS,
  DATA_MODELER_DASHBOARD_TOOLS,
} from "../../agents/data-modeler/tools";
import {
  makeSemanticModelExecutor,
  makeDashboardExecutor,
} from "../../agents/data-modeler/executor";

const router: IRouter = Router();

/** Returns true when the error is a Postgres "relation does not exist" —
 *  i.e. the Phase-2 tables haven't been pushed yet. */
function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist/i.test(msg);
}

/** Wraps a route handler; converts "relation does not exist" into a 503 with
 *  a clear migration instruction so the UI can surface it to the user. */
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
// Warehouse browsing
// ---------------------------------------------------------------------------

router.get("/projects/:id/warehouse-tables", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const tables = await loadWarehouseTablesWithColumns(projectId);
    res.json({ tables });
  } catch (err) {
    req.log.warn({ err, projectId }, "Failed to read warehouse");
    res.json({ tables: [] });
  }
});

// ---------------------------------------------------------------------------
// Phase 2 — suggest semantic model
// ---------------------------------------------------------------------------

async function runSuggestSemanticModel(projectId: number, req: Request, res: Response) {
  const project = await loadProjectOr404(projectId, res);
  if (!project) return;

  let warehouseTables: Awaited<ReturnType<typeof loadWarehouseTablesWithColumns>>;
  try {
    warehouseTables = await loadWarehouseTablesWithColumns(projectId);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not read warehouse" });
    return;
  }

  if (warehouseTables.length < 2) {
    res.status(400).json({ error: "Need at least 2 warehouse tables before modeling. Apply more transformations first." });
    return;
  }

  const [existing] = await db
    .select()
    .from(projectSemanticModels)
    .where(eq(projectSemanticModels.workspaceId, projectId))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);

  const existingGraph = existing
    ? {
        facts: existing.graphDefinition.facts ?? [],
        dimensions: existing.graphDefinition.dimensions ?? [],
        joins: existing.graphDefinition.joins ?? [],
        status: existing.status,
      }
    : null;

  const systemPrompt = buildDataModelerSemanticPrompt({
    projectId,
    projectName: project.name,
    projectDescription: project.description ?? null,
    warehouseTables,
    existingGraph,
  });

  const userMessage = [
    `Design the semantic graph for this project:`,
    `1. Call propose_star_schema with the fact/dimension classification.`,
    `2. Call generate_semantic_graph with the facts, dimensions, and joins.`,
    `3. Stop after generate_semantic_graph records the row.`,
  ].join("\n");

  try {
    const result = await runAgent({
      systemPrompt,
      userMessage,
      tools: DATA_MODELER_SEMANTIC_TOOLS,
      executeTool: makeSemanticModelExecutor(projectId, req.log),
      maxIterations: 6,
    });

    const [proposed] = await db
      .select()
      .from(projectSemanticModels)
      .where(and(
        eq(projectSemanticModels.workspaceId, projectId),
        eq(projectSemanticModels.status, "proposed"),
      ))
      .orderBy(desc(projectSemanticModels.createdAt))
      .limit(1);

    res.json({
      iterations: result.iterations,
      toolCalls: result.toolCallsByName,
      finalText: result.finalText,
      semanticModel: proposed ?? null,
    });
  } catch (err) {
    req.log.error({ err, projectId }, "data-modeler suggest failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Agent run failed" });
  }
}

router.post("/projects/:id/agents/data-modeler/suggest", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  await runSuggestSemanticModel(projectId, req, res);
}));

// Legacy URL — kept so older UI calls still work during the migration.
router.post("/projects/:id/agents/data-modeler/suggest-relationships", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  await runSuggestSemanticModel(projectId, req, res);
}));

// ---------------------------------------------------------------------------
// Semantic model CRUD
// ---------------------------------------------------------------------------

router.get("/projects/:id/semantic-model", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const rows = await db
    .select()
    .from(projectSemanticModels)
    .where(eq(projectSemanticModels.workspaceId, projectId))
    .orderBy(desc(projectSemanticModels.createdAt));
  res.json({ semanticModels: rows });
}));

router.post("/projects/:id/semantic-model/:smId/accept", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const smId = parseId(req.params.smId as string);
  if (projectId === null || smId === null) { res.status(400).json({ error: "Invalid id" }); return; }

  // Only one applied row at a time — demote any older applied row.
  await db
    .update(projectSemanticModels)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(
      eq(projectSemanticModels.workspaceId, projectId),
      eq(projectSemanticModels.status, "applied"),
    ));

  const [updated] = await db
    .update(projectSemanticModels)
    .set({ status: "applied", updatedAt: new Date() })
    .where(and(
      eq(projectSemanticModels.id, smId),
      eq(projectSemanticModels.workspaceId, projectId),
    ))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Semantic model not found in this project" });
    return;
  }
  res.json({ ok: true, status: "applied", semanticModel: updated });
});

router.post("/projects/:id/semantic-model/:smId/reject", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const smId = parseId(req.params.smId as string);
  if (projectId === null || smId === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .update(projectSemanticModels)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(projectSemanticModels.id, smId), eq(projectSemanticModels.workspaceId, projectId)));
  res.json({ ok: true, status: "rejected" });
});

router.delete("/projects/:id/semantic-model/:smId", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const smId = parseId(req.params.smId as string);
  if (projectId === null || smId === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .delete(projectSemanticModels)
    .where(and(eq(projectSemanticModels.id, smId), eq(projectSemanticModels.workspaceId, projectId)));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Back-compat: /relationships → /semantic-model
// Legacy UI calls these — they read the latest semantic model and project
// each join row back into the old { sourceTable, sourceColumn, ... } shape so
// older consumers don't immediately break.
// ---------------------------------------------------------------------------

function splitTableColumn(qualified: string): { table: string; column: string } {
  const idx = qualified.lastIndexOf(".");
  if (idx === -1) return { table: qualified, column: "" };
  return { table: qualified.slice(0, idx), column: qualified.slice(idx + 1) };
}

router.get("/projects/:id/relationships", withMigrationGuard(async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const rows = await db
    .select()
    .from(projectSemanticModels)
    .where(eq(projectSemanticModels.workspaceId, projectId))
    .orderBy(desc(projectSemanticModels.createdAt));

  const relationships = rows.flatMap((sm) =>
    (sm.graphDefinition.joins ?? []).map((j, i) => {
      const src = splitTableColumn(j.from);
      const tgt = splitTableColumn(j.to);
      return {
        id: sm.id * 100 + i,
        sourceTable: src.table,
        sourceColumn: src.column,
        targetTable: tgt.table,
        targetColumn: tgt.column,
        cardinality: j.cardinality,
        status: sm.status,
        agentRationale: sm.agentRationale,
        createdAt: sm.createdAt,
      };
    }),
  );

  res.json({ relationships });
}));

// ---------------------------------------------------------------------------
// Phase 2B — generate dashboard
// ---------------------------------------------------------------------------

router.post("/projects/:id/agents/data-modeler/generate-dashboard", async (req: Request, res: Response) => {
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

  const semanticGraph: SemanticGraphDefinition | null = appliedSm?.graphDefinition ?? null;

  const systemPrompt = buildDataModelerDashboardPrompt({
    projectId,
    projectName: project.name,
    projectDescription: project.description ?? null,
    warehouseTables,
    semanticGraph,
  });

  const userMessage = [
    `Design a project dashboard now:`,
    `1. Query the warehouse for the numbers you'll plot (execute_warehouse_query, several calls).`,
    `2. Pick 4–6 chart types that together answer the project's goal.`,
    `3. Call create_dashboard ONCE with all the charts. Stop after that.`,
  ].join("\n");

  try {
    const result = await runAgent({
      systemPrompt,
      userMessage,
      tools: DATA_MODELER_DASHBOARD_TOOLS,
      executeTool: makeDashboardExecutor(projectId, req.log),
      maxIterations: 12,
      maxTokens: 6000,
    });

    res.json({
      iterations: result.iterations,
      toolCalls: result.toolCallsByName,
      finalText: result.finalText,
      created: (result.toolCallsByName["create_dashboard"] ?? 0) > 0,
    });
  } catch (err) {
    req.log.error({ err, projectId }, "data-modeler generate-dashboard failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Agent run failed" });
  }
});

// ---------------------------------------------------------------------------
// Project dashboards (list + get)
// ---------------------------------------------------------------------------

router.get("/projects/:id/dashboards", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const rows = await db
    .select()
    .from(userDashboards)
    .where(like(userDashboards.flatTableName, `proj_${projectId}_dash_%`))
    .orderBy(desc(userDashboards.createdAt));
  res.json({
    dashboards: rows.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
  });
});

router.get("/projects/:id/dashboards/:dashId", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const dashId = parseId(req.params.dashId as string);
  if (projectId === null || dashId === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [dash] = await db
    .select()
    .from(userDashboards)
    .where(and(
      eq(userDashboards.id, dashId),
      like(userDashboards.flatTableName, `proj_${projectId}_dash_%`),
    ))
    .limit(1);
  if (!dash) { res.status(404).json({ error: "Dashboard not found in this project" }); return; }

  const charts = await db
    .select()
    .from(dashboardCharts)
    .where(eq(dashboardCharts.dashboardId, dashId))
    .orderBy(asc(dashboardCharts.position));

  const kpis: unknown[] = [];
  const tables: unknown[] = [];
  const visualCharts: unknown[] = [];

  for (const c of charts) {
    const cfg = (c.config ?? {}) as unknown as Record<string, unknown>;

    // Re-execute the stored SQL to get fresh data when the chart has no
    // embedded rows. This keeps charts live against the current warehouse.
    const storedSql = typeof cfg.sql === "string" ? cfg.sql.trim() : null;
    const hasEmbeddedData = Array.isArray(cfg.data) && (cfg.data as unknown[]).length > 0;

    if (storedSql && !hasEmbeddedData) {
      try {
        assertSelectOnly(storedSql);
        assertSchemaScope(storedSql, [warehouseSchema(projectId)]);
        const qr = await masterPool.query(storedSql);
        (cfg as Record<string, unknown>).data = qr.rows.slice(0, 200);
      } catch (sqlErr) {
        req.log.warn({ err: sqlErr, dashId, title: c.title }, "live re-exec of chart SQL failed");
        (cfg as Record<string, unknown>).data = [];
        (cfg as Record<string, unknown>).sqlError = sqlErr instanceof Error ? sqlErr.message : String(sqlErr);
      }
    }

    if (c.chartType === "kpi") {
      kpis.push({ title: c.title, ...cfg });
    } else if (c.chartType === "table") {
      tables.push({ title: c.title, ...cfg });
    } else {
      visualCharts.push({
        title: c.title,
        type: c.chartType,
        colSpan: c.colSpan ?? 1,
        ...cfg,
      });
    }
  }

  res.json({
    id: dash.id,
    name: dash.name,
    createdAt: dash.createdAt.toISOString(),
    config: {
      title: dash.name,
      kpis,
      charts: visualCharts,
      tables,
    },
  });
});

router.delete("/projects/:id/dashboards/:dashId", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const dashId = parseId(req.params.dashId as string);
  if (projectId === null || dashId === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .delete(userDashboards)
    .where(and(
      eq(userDashboards.id, dashId),
      like(userDashboards.flatTableName, `proj_${projectId}_dash_%`),
    ));
  res.status(204).send();
});

export default router;
