import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  joins,
  datasets,
  datasetColumns,
  datasetRows,
  workspaces,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  CreateJoinBody,
  UpdateJoinBody,
  PreviewJoinBody,
} from "@workspace/api-zod";
import {
  suggestJoins,
  performJoin,
  type DatasetForJoin,
  type JoinType,
} from "../../lib/join-engine";

const router: IRouter = Router();

function serializeJoin(j: typeof joins.$inferSelect) {
  return {
    id: j.id,
    workspaceId: j.workspaceId,
    leftDatasetId: j.leftDatasetId,
    rightDatasetId: j.rightDatasetId,
    leftColumn: j.leftColumn,
    rightColumn: j.rightColumn,
    joinType: j.joinType,
    status: j.status,
    confidence: j.confidence,
    matchRate: j.matchRate,
    unmatchedCount: j.unmatchedCount,
    source: j.source,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

async function loadDatasetsForJoin(
  workspaceId: number,
  ids?: number[],
): Promise<DatasetForJoin[]> {
  const dsRows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.workspaceId, workspaceId));
  const filteredDs = ids ? dsRows.filter((d) => ids.includes(d.id)) : dsRows;
  if (filteredDs.length === 0) return [];

  const dsIds = filteredDs.map((d) => d.id);
  const cols = await db
    .select()
    .from(datasetColumns)
    .where(inArray(datasetColumns.datasetId, dsIds));
  const rowsRows = await db
    .select()
    .from(datasetRows)
    .where(inArray(datasetRows.datasetId, dsIds));

  const rowsById = new Map<number, Record<string, unknown>[]>();
  for (const r of rowsRows) {
    rowsById.set(r.datasetId, Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : []);
  }
  const colsById = new Map<number, typeof cols>();
  for (const c of cols) {
    let bucket = colsById.get(c.datasetId);
    if (!bucket) { bucket = []; colsById.set(c.datasetId, bucket); }
    bucket.push(c);
  }

  return filteredDs.map((d) => ({
    id: d.id,
    name: d.fileName.replace(/\.(csv|xlsx|xls)$/i, ""),
    rowCount: d.rowCount,
    columns: (colsById.get(d.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => ({
        name: c.name,
        semanticType: c.semanticType,
        uniqueCount: c.uniqueCount,
      })),
    rows: rowsById.get(d.id) ?? [],
  }));
}

router.get(
  "/workspaces/:id/joins/suggestions",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.id);
    if (!Number.isFinite(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }
    try {
      const ds = await loadDatasetsForJoin(workspaceId);
      const suggestions = suggestJoins(ds);
      const accepted = await db
        .select()
        .from(joins)
        .where(
          and(eq(joins.workspaceId, workspaceId), eq(joins.status, "accepted")),
        );
      const acceptedKeys = new Set(
        accepted.map((j) =>
          [`${j.leftDatasetId}.${j.leftColumn}`, `${j.rightDatasetId}.${j.rightColumn}`].sort().join("|"),
        ),
      );
      const filtered = suggestions.filter((s) => {
        const key = [`${s.leftDatasetId}.${s.leftColumn}`, `${s.rightDatasetId}.${s.rightColumn}`].sort().join("|");
        return !acceptedKeys.has(key);
      });
      res.json({ suggestions: filtered });
    } catch (err: any) {
      req.log.error({ err }, "Failed to compute join suggestions");
      res.status(500).json({ error: "Failed to compute suggestions" });
    }
  },
);

router.get("/workspaces/:id/joins", async (req: Request, res: Response) => {
  const workspaceId = Number(req.params.id);
  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return;
  }
  const rows = await db
    .select()
    .from(joins)
    .where(eq(joins.workspaceId, workspaceId))
    .orderBy(desc(joins.createdAt));
  res.json(rows.map(serializeJoin));
});

router.post("/workspaces/:id/joins", async (req: Request, res: Response) => {
  const workspaceId = Number(req.params.id);
  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return;
  }
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const body = CreateJoinBody.parse(req.body);
  // Workspace integrity: both datasets must belong to this workspace.
  const owned = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(
      and(
        eq(datasets.workspaceId, workspaceId),
        inArray(datasets.id, [body.leftDatasetId, body.rightDatasetId]),
      ),
    );
  if (owned.length !== 2 || body.leftDatasetId === body.rightDatasetId) {
    res.status(400).json({
      error:
        "leftDatasetId and rightDatasetId must be distinct datasets in this workspace",
    });
    return;
  }
  const [created] = await db
    .insert(joins)
    .values({
      workspaceId,
      leftDatasetId: body.leftDatasetId,
      rightDatasetId: body.rightDatasetId,
      leftColumn: body.leftColumn,
      rightColumn: body.rightColumn,
      joinType: body.joinType,
      status: body.status ?? "accepted",
      confidence: body.confidence ?? 0,
      matchRate: body.matchRate ?? 0,
      unmatchedCount: body.unmatchedCount ?? 0,
      source: body.source ?? "ai",
    })
    .returning();
  res.status(201).json(serializeJoin(created));
});

router.patch("/joins/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid join id" });
    return;
  }
  const body = UpdateJoinBody.parse(req.body);
  const [existing] = await db.select().from(joins).where(eq(joins.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Join not found" });
    return;
  }
  const [updated] = await db
    .update(joins)
    .set({
      ...(body.joinType !== undefined ? { joinType: body.joinType } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.leftColumn !== undefined ? { leftColumn: body.leftColumn } : {}),
      ...(body.rightColumn !== undefined ? { rightColumn: body.rightColumn } : {}),
      updatedAt: new Date(),
    })
    .where(eq(joins.id, id))
    .returning();
  res.json(serializeJoin(updated));
});

router.delete("/joins/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid join id" });
    return;
  }
  await db.delete(joins).where(eq(joins.id, id));
  res.status(204).end();
});

router.post(
  "/workspaces/:id/joins/preview",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.id);
    if (!Number.isFinite(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }
    const body = PreviewJoinBody.parse(req.body);
    try {
      const ds = await loadDatasetsForJoin(workspaceId, [
        body.leftDatasetId,
        body.rightDatasetId,
      ]);
      const left = ds.find((d) => d.id === body.leftDatasetId);
      const right = ds.find((d) => d.id === body.rightDatasetId);
      if (!left || !right) {
        res.status(404).json({ error: "Datasets not found in workspace" });
        return;
      }
      const out = performJoin(left, right, {
        leftColumn: body.leftColumn,
        rightColumn: body.rightColumn,
        joinType: body.joinType as JoinType,
      });
      res.json({
        columns: out.columns,
        rows: out.rows.slice(0, 25),
        totalRows: out.rows.length,
      });
    } catch (err: any) {
      req.log.error({ err }, "Failed to preview join");
      res.status(500).json({ error: "Failed to preview join" });
    }
  },
);

export default router;
