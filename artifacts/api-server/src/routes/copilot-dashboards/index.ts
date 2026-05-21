import { Router, type IRouter, type Request, type Response } from "express";
import { db, copilotDashboards } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET /copilot-dashboards
router.get("/copilot-dashboards", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(copilotDashboards)
    .orderBy(desc(copilotDashboards.createdAt));
  res.json(rows);
});

// POST /copilot-dashboards
router.post("/copilot-dashboards", async (req: Request, res: Response) => {
  const body = req.body as { title?: unknown; route?: unknown; config?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const route = typeof body.route === "string" ? body.route.trim() : "";
  const config = body.config;

  if (!title || !route || !config) {
    res.status(400).json({ error: "title, route, and config are required" });
    return;
  }

  try {
    const [row] = await db
      .insert(copilotDashboards)
      .values({ title, route, config })
      .onConflictDoUpdate({
        target: copilotDashboards.route,
        set: { title, config, updatedAt: new Date() },
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create copilot dashboard");
    res.status(500).json({ error: String(err) });
  }
});

// PUT /copilot-dashboards/:id — update config (layout edits, Tidy)
router.put("/copilot-dashboards/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = req.body as { config?: unknown; title?: unknown };
  if (!body.config && !body.title) {
    res.status(400).json({ error: "config or title is required" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.config) updates.config = body.config;
  if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();

  const [row] = await db
    .update(copilotDashboards)
    .set(updates as any)
    .where(eq(copilotDashboards.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Dashboard not found" }); return; }
  res.json(row);
});

// DELETE /copilot-dashboards/:id
router.delete("/copilot-dashboards/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(copilotDashboards).where(eq(copilotDashboards.id, id));
  res.status(204).send();
});

export default router;
