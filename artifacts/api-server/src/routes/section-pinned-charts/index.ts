import { Router, type IRouter, type Request, type Response } from "express";
import { db, sectionPinnedCharts } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

// GET /section-pinned-charts?section=<route>
// Returns all pinned charts, optionally filtered by sectionRoute
router.get("/section-pinned-charts", async (req: Request, res: Response) => {
  const section = req.query.section as string | undefined;
  const rows = section
    ? await db
        .select()
        .from(sectionPinnedCharts)
        .where(eq(sectionPinnedCharts.sectionRoute, section))
        .orderBy(asc(sectionPinnedCharts.createdAt))
    : await db
        .select()
        .from(sectionPinnedCharts)
        .orderBy(asc(sectionPinnedCharts.createdAt));
  res.json(rows);
});

// POST /section-pinned-charts
router.post("/section-pinned-charts", async (req: Request, res: Response) => {
  const body = req.body as { sectionRoute?: unknown; config?: unknown };
  const sectionRoute = typeof body.sectionRoute === "string" ? body.sectionRoute.trim() : "";
  const config = body.config;

  if (!sectionRoute || !config) {
    res.status(400).json({ error: "sectionRoute and config are required" });
    return;
  }

  const [row] = await db
    .insert(sectionPinnedCharts)
    .values({ sectionRoute, config })
    .returning();

  res.status(201).json(row);
});

// DELETE /section-pinned-charts/:id
router.delete("/section-pinned-charts/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.delete(sectionPinnedCharts).where(eq(sectionPinnedCharts.id, id));
  res.status(204).send();
});

export default router;
