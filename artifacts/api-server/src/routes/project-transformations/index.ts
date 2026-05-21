/**
 * Project transformations + DataEngineerAgent /suggest endpoint.
 *
 * Routes:
 *   POST /api/projects/:id/agents/data-engineer/suggest
 *     Runs the agent — it inspects raw tables and writes "proposed" rows into
 *     project_transformations. Returns the new proposal ids.
 *
 *   GET  /api/projects/:id/transformations
 *     List all proposals in this project (any status).
 *
 *   POST /api/projects/:id/transformations/:tid/accept
 *     Flip status to "accepted" and execute the SQL against the project
 *     warehouse schema in one step. Returns the executed result.
 *
 *   POST /api/projects/:id/transformations/:tid/reject
 *   DELETE /api/projects/:id/transformations/:tid
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workspaces as workspacesTable,
  projectTransformations,
  masterPool,
  listRawTables,
  createProjectSchemas,
  rawSchema,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { runAgent } from "../../agents/shared/runner";
import { buildDataEngineerPrompt } from "../../agents/data-engineer/system-prompt";
import { DATA_ENGINEER_OPENAI_TOOLS } from "../../agents/data-engineer/tools";
import { applyTransformation, makeDataEngineerExecutor } from "../../agents/data-engineer/executor";

const router: IRouter = Router();

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

router.post("/projects/:id/agents/data-engineer/suggest", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const project = await loadProjectOr404(projectId, res);
  if (!project) return;

  // Make sure the project schemas exist — for legacy projects this is a no-op.
  try {
    await createProjectSchemas(projectId);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not provision project schemas" });
    return;
  }

  // Gather raw tables with full column info for the system prompt.
  const schema = rawSchema(projectId);
  const rawTables = await listRawTables(projectId);
  if (rawTables.length === 0) {
    res.status(400).json({ error: "No raw tables yet — ingest data via the Connect tab before asking the agent." });
    return;
  }

  const enrichedRawTables = await Promise.all(rawTables.map(async (t) => {
    const cols = await masterPool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
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

  const systemPrompt = buildDataEngineerPrompt({
    projectId,
    projectName: project.name,
    projectDescription: project.description ?? null,
    rawTables: enrichedRawTables,
  });

  const userMessage = [
    `The raw schema has been populated. Run the suggestion pass now:`,
    `1. Call inspect_raw_table on each table you want to learn more about (focus on ones whose columns are ambiguous from the names alone).`,
    `2. Propose up to 5 high-value transformations via propose_transformation. Mix of cleansing, joins, aggregations, and views.`,
    `3. Do NOT call apply_transformation — the user reviews proposals before they execute.`,
    `4. Stop after the proposals are recorded.`,
  ].join("\n");

  try {
    const result = await runAgent({
      systemPrompt,
      userMessage,
      tools: DATA_ENGINEER_OPENAI_TOOLS,
      executeTool: makeDataEngineerExecutor(projectId, req.log),
      maxIterations: 8,
    });

    // Fetch the proposals that landed during this run.
    const proposed = await db
      .select()
      .from(projectTransformations)
      .where(and(
        eq(projectTransformations.projectId, projectId),
        eq(projectTransformations.status, "proposed"),
      ))
      .orderBy(desc(projectTransformations.createdAt))
      .limit(20);

    res.json({
      iterations: result.iterations,
      toolCalls: result.toolCallsByName,
      finalText: result.finalText,
      proposedCount: result.toolCallsByName["propose_transformation"] ?? 0,
      proposals: proposed,
    });
  } catch (err: unknown) {
    req.log.error({ err, projectId }, "data-engineer suggest failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Agent run failed" });
  }
});

router.get("/projects/:id/transformations", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const rows = await db
    .select()
    .from(projectTransformations)
    .where(eq(projectTransformations.projectId, projectId))
    .orderBy(desc(projectTransformations.createdAt));
  res.json({ transformations: rows });
});

router.post("/projects/:id/transformations/:tid/accept", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const tid = parseId(req.params.tid as string);
  if (projectId === null || tid === null) { res.status(400).json({ error: "Invalid id" }); return; }

  // First flip status to accepted, then apply. If apply fails the status stays
  // "accepted" with appliedAt null so the UI can show "accepted, failed to
  // run" and offer retry.
  await db
    .update(projectTransformations)
    .set({ status: "accepted" })
    .where(and(eq(projectTransformations.id, tid), eq(projectTransformations.projectId, projectId)));

  const result = await applyTransformation(projectId, tid);
  if ("error" in result) {
    req.log.warn({ projectId, tid, err: result.error }, "transformation apply failed");
    res.status(400).json({ ...result, status: "accepted" });
    return;
  }
  if (result.dependenciesApplied?.length) {
    req.log.info({ projectId, tid, dependenciesApplied: result.dependenciesApplied }, "auto-applied upstream deps");
  }
  res.json(result);
});

router.post("/projects/:id/transformations/:tid/reject", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const tid = parseId(req.params.tid as string);
  if (projectId === null || tid === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .update(projectTransformations)
    .set({ status: "rejected" })
    .where(and(eq(projectTransformations.id, tid), eq(projectTransformations.projectId, projectId)));
  res.json({ ok: true });
});

router.delete("/projects/:id/transformations/:tid", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  const tid = parseId(req.params.tid as string);
  if (projectId === null || tid === null) { res.status(400).json({ error: "Invalid id" }); return; }
  await db
    .delete(projectTransformations)
    .where(and(eq(projectTransformations.id, tid), eq(projectTransformations.projectId, projectId)));
  res.status(204).send();
});

export default router;
