import { Router, type IRouter, type Request, type Response } from "express";
import { db, workspaces as workspacesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateWorkspaceBody,
  GetWorkspaceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

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
  res.status(201).json(serialize(row));
});

router.get("/workspaces/:id", async (req: Request, res: Response) => {
  const { id } = GetWorkspaceParams.parse({ id: Number(req.params.id) });
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

export default router;
