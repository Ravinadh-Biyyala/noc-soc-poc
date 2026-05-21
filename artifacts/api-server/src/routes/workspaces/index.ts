import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workspaces as workspacesTable,
  createProjectSchemas,
  dropProjectSchemas,
  countWarehouseTables,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
  await db.delete(workspacesTable).where(eq(workspacesTable.id, id));

  // Best-effort cleanup of per-project schemas. If the row was a legacy
  // workspace these schemas may not exist; DROP IF EXISTS in the helper makes
  // this safe.
  try {
    await dropProjectSchemas(id);
  } catch (err) {
    req.log.warn({ workspaceId: id, err }, "Failed to drop project schemas");
  }

  req.log.info({ workspaceId: id }, "Workspace deleted");
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
