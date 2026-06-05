import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workspaces as workspacesTable,
  datasets as datasetsTable,
  projectDataSources,
  projectMetrics,
  projectRelationshipLinks,
  projectSemanticModels,
  projectTransformations,
  userDashboards,
  dashboardCharts,
  sectionPinnedCharts,
  createProjectSchemas,
  dropProjectSchemas,
  dropLegacyProjectDatabase,
  countWarehouseTables,
} from "@workspace/db";
import { eq, desc, like, inArray } from "drizzle-orm";
import {
  CreateWorkspaceBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const VALID_STATUSES = new Set(["draft", "active", "archived"]);

function serialize(w: typeof workspacesTable.$inferSelect) {
  return {
    id: w.id,
    name: w.name,
    packId: w.packId,
    description: w.description,
    ownerName: w.ownerName,
    status: w.status,
    readinessScore: w.readinessScore,
    fileCount: w.fileCount,
    dashboardCount: w.dashboardCount,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

router.get("/workspaces", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(workspacesTable)
    .orderBy(desc(workspacesTable.updatedAt));
  res.json(rows.map(serialize));
});

router.post("/workspaces", async (req: Request, res: Response) => {
  const body = CreateWorkspaceBody.parse(req.body);
  const [row] = await db
    .insert(workspacesTable)
    .values({
      name: body.name,
      packId: body.packId,
      description: body.description ?? null,
    })
    .returning();

  // Provision the per-project Postgres schemas (proj_{id}_raw and
  // proj_{id}_warehouse) inside the master DB. Idempotent — safe to retry.
  try {
    await createProjectSchemas(row.id);
  } catch (err) {
    req.log.warn({ workspaceId: row.id, err }, "Failed to provision project schemas");
  }

  req.log.info({ workspaceId: row.id, name: row.name, packId: row.packId }, "Workspace created");
  res.status(201).json(serialize(row));
});

router.get("/workspaces/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const [row] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(serialize(row));
});

router.patch("/workspaces/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof workspacesTable.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (typeof body.name === "string" && body.name.trim())           updates.name        = body.name.trim().slice(0, 255);
  if (typeof body.description === "string")                         updates.description = body.description.slice(0, 1000);
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) updates.status = body.status;
  if (typeof body.packId === "string" && body.packId.trim())        updates.packId      = body.packId.trim().slice(0, 100);
  if (typeof body.ownerName === "string" && body.ownerName.trim())  updates.ownerName   = body.ownerName.trim().slice(0, 255);

  const [updated] = await db
    .update(workspacesTable)
    .set(updates)
    .where(eq(workspacesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  req.log.info({ workspaceId: id }, "Workspace updated");
  res.json(serialize(updated));
});

router.delete("/workspaces/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const [existing] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }

  // Cascade-delete everything tied to this project: dashboards + their charts,
  // pinned charts, datasets, and the data-modeling artefacts (transformations,
  // semantic models, metrics, relationship links, data sources). Each step is
  // best-effort so a single missing table can't strip the rest.
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { req.log.warn({ workspaceId: id, step: label, err }, "cascade delete step failed"); }
  };

  // Dashboards live in user_dashboards with a flat_table_name like proj_{id}_dash_*.
  await step("dashboard_charts", async () => {
    const dashes = await db
      .select({ dashId: userDashboards.id })
      .from(userDashboards)
      .where(like(userDashboards.flatTableName, `proj_${id}_dash_%`));
    const dashIds = dashes.map((d) => d.dashId);
    if (dashIds.length) await db.delete(dashboardCharts).where(inArray(dashboardCharts.dashboardId, dashIds));
    await db.delete(userDashboards).where(like(userDashboards.flatTableName, `proj_${id}_dash_%`));
  });
  // Charts pinned from the Copilot are keyed by the project's route.
  await step("section_pinned_charts", () =>
    db.delete(sectionPinnedCharts).where(like(sectionPinnedCharts.sectionRoute, `/projects/${id}/%`)));
  // Data + modeling artefacts (all keyed by project_id).
  await step("datasets", () => db.delete(datasetsTable).where(eq(datasetsTable.projectId, id)));
  await step("project_transformations", () => db.delete(projectTransformations).where(eq(projectTransformations.projectId, id)));
  await step("project_semantic_models", () => db.delete(projectSemanticModels).where(eq(projectSemanticModels.projectId, id)));
  await step("project_metrics", () => db.delete(projectMetrics).where(eq(projectMetrics.projectId, id)));
  await step("project_relationship_links", () => db.delete(projectRelationshipLinks).where(eq(projectRelationshipLinks.projectId, id)));
  await step("project_data_sources", () => db.delete(projectDataSources).where(eq(projectDataSources.projectId, id)));

  // Finally remove the workspace row itself.
  await db.delete(workspacesTable).where(eq(workspacesTable.id, id));

  // Drop the per-project Postgres schemas (current architecture) and the legacy
  // per-project database (old architecture), if present. DROP IF EXISTS-safe.
  await step("drop_schemas", () => dropProjectSchemas(id));
  await step("drop_legacy_db", () => dropLegacyProjectDatabase(id));

  req.log.info({ workspaceId: id }, "Workspace deleted (cascade)");
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Projects-feature endpoints (built on top of the workspaces table).
//
// The Projects UI uses workspaces.id as the project id. These endpoints expose
// project-scoped state (warehouse readiness, etc.) that the new UI needs.
// ---------------------------------------------------------------------------

router.get("/projects/:id/warehouse-status", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  try {
    const tableCount = await countWarehouseTables(id);
    res.json({ tableCount });
  } catch (err) {
    req.log.warn({ projectId: id, err }, "Failed to count warehouse tables");
    res.json({ tableCount: 0 });
  }
});

export default router;
