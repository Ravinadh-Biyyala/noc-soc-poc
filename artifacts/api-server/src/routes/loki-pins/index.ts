// Pinned Loki visuals — CRUD over the dedicated `loki` Postgres database.
// Served by Express directly (NOT proxied to Python: `/api/loki-pins` does not
// match the `/^\/api\/loki(\/|$)/` proxy filter). Each row stores the chart spec
// plus the query metadata (logql/kind/since/transform) so the frontend can
// Refresh a pin by re-running its query.

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { ensureLokiSchema, lokiQuery } from "../../lib/loki-db.js";

const router: IRouter = Router();

interface PinRow {
  id: string;
  title: string;
  type: string;
  x_key: string;
  y_key: string;
  colors: string[] | null;
  summary: string | null;
  logql: string | null;
  kind: string | null;
  since: string | null;
  transform: string | null;
  data: unknown;
  created_at: Date;
  updated_at: Date;
}

// camelCase shape the frontend expects.
function toPin(r: PinRow) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    xKey: r.x_key,
    yKey: r.y_key,
    colors: r.colors ?? undefined,
    summary: r.summary ?? undefined,
    logql: r.logql ?? undefined,
    kind: r.kind ?? undefined,
    since: r.since ?? undefined,
    transform: r.transform ?? undefined,
    data: Array.isArray(r.data) ? r.data : [],
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

async function guard(res: Response): Promise<boolean> {
  try {
    await ensureLokiSchema();
    return true;
  } catch (err) {
    (res.req as unknown as { log?: { error: Function } }).log?.error({ err }, "loki db unavailable");
    res.status(503).json({ error: "Loki metadata database unavailable. Is Postgres running and LOKI_DATABASE_URL set?" });
    return false;
  }
}

router.get("/loki-pins", async (_req: Request, res: Response) => {
  if (!(await guard(res))) return;
  const { rows } = await lokiQuery<PinRow>("SELECT * FROM pinned_visuals ORDER BY created_at DESC");
  res.json(rows.map(toPin));
});

router.post("/loki-pins", async (req: Request, res: Response) => {
  if (!(await guard(res))) return;
  const b = req.body ?? {};
  if (!b.title || !b.type || !b.xKey || !b.yKey) {
    res.status(400).json({ error: "title, type, xKey, yKey are required" });
    return;
  }
  const id = randomUUID();
  const { rows } = await lokiQuery<PinRow>(
    `INSERT INTO pinned_visuals (id, title, type, x_key, y_key, colors, summary, logql, kind, since, transform, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      id, b.title, b.type, b.xKey, b.yKey,
      b.colors ? JSON.stringify(b.colors) : null,
      b.summary ?? null, b.logql ?? null, b.kind ?? null, b.since ?? null, b.transform ?? null,
      JSON.stringify(Array.isArray(b.data) ? b.data : []),
    ],
  );
  res.status(201).json(toPin(rows[0]));
});

// Refresh: update the data snapshot (and optionally the chart spec).
router.put("/loki-pins/:id", async (req: Request, res: Response) => {
  if (!(await guard(res))) return;
  const b = req.body ?? {};
  const { rows } = await lokiQuery<PinRow>(
    `UPDATE pinned_visuals
        SET data = COALESCE($2, data),
            title = COALESCE($3, title),
            type = COALESCE($4, type),
            x_key = COALESCE($5, x_key),
            y_key = COALESCE($6, y_key),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      req.params.id,
      b.data !== undefined ? JSON.stringify(b.data) : null,
      b.title ?? null, b.type ?? null, b.xKey ?? null, b.yKey ?? null,
    ],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Pin not found" });
    return;
  }
  res.json(toPin(rows[0]));
});

router.delete("/loki-pins/:id", async (req: Request, res: Response) => {
  if (!(await guard(res))) return;
  await lokiQuery("DELETE FROM pinned_visuals WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

export default router;
