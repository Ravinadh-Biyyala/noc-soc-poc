import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  preparedDatasets,
  joins,
  datasets,
  datasetColumns,
  datasetRows,
  workspaces,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { CreatePreparedDatasetBody } from "@workspace/api-zod";
import {
  performJoin,
  type DatasetForJoin,
  type JoinType,
} from "../../lib/join-engine";

const router: IRouter = Router();

const SAMPLE_CAP = 100;

interface LineageStep {
  joinId: number;
  leftFile: string;
  rightFile: string;
  leftColumn: string;
  rightColumn: string;
  joinType: string;
}

async function buildLineage(
  baseDatasetId: number,
  joinIds: number[],
  workspaceId: number,
): Promise<{ baseFile: string; steps: LineageStep[] }> {
  const refIds = [baseDatasetId];
  const usedJoins = joinIds.length > 0
    ? await db
        .select()
        .from(joins)
        .where(
          and(eq(joins.workspaceId, workspaceId), inArray(joins.id, joinIds)),
        )
    : [];
  for (const j of usedJoins) {
    refIds.push(j.leftDatasetId, j.rightDatasetId);
  }
  const dsRows = refIds.length > 0
    ? await db.select().from(datasets).where(inArray(datasets.id, refIds))
    : [];
  const nameById = new Map(dsRows.map((d) => [d.id, d.fileName]));
  const base = nameById.get(baseDatasetId) ?? "unknown";
  const stepMap = new Map(usedJoins.map((j) => [j.id, j]));
  const steps: LineageStep[] = [];
  for (const id of joinIds) {
    const j = stepMap.get(id);
    if (!j) continue;
    steps.push({
      joinId: j.id,
      leftFile: nameById.get(j.leftDatasetId) ?? "?",
      rightFile: nameById.get(j.rightDatasetId) ?? "?",
      leftColumn: j.leftColumn,
      rightColumn: j.rightColumn,
      joinType: j.joinType,
    });
  }
  return { baseFile: base, steps };
}

function serialize(row: typeof preparedDatasets.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    baseDatasetId: row.baseDatasetId,
    joinIds: Array.isArray(row.joinIds) ? (row.joinIds as number[]) : [],
    status: row.status,
    columns: Array.isArray(row.columns) ? (row.columns as string[]) : [],
    sampleRows: Array.isArray(row.sampleRows)
      ? (row.sampleRows as Record<string, unknown>[])
      : [],
    rowCount: row.rowCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Load every dataset in the given set as a DatasetForJoin (rows + columns).
 * Returns a map keyed by dataset id.
 */
async function loadDatasetMap(
  dsIds: number[],
): Promise<Map<number, DatasetForJoin>> {
  if (dsIds.length === 0) return new Map();
  const dsRows = await db
    .select()
    .from(datasets)
    .where(inArray(datasets.id, dsIds));
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
    rowsById.set(
      r.datasetId,
      Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : [],
    );
  }
  const colsById = new Map<number, typeof cols>();
  for (const c of cols) {
    let bucket = colsById.get(c.datasetId);
    if (!bucket) {
      bucket = [];
      colsById.set(c.datasetId, bucket);
    }
    bucket.push(c);
  }
  const out = new Map<number, DatasetForJoin>();
  for (const d of dsRows) {
    out.set(d.id, {
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
    });
  }
  return out;
}

/**
 * Materialize a join chain starting from baseDatasetId and applying each
 * join in order. Each join must connect the current accumulator (a synthetic
 * DatasetForJoin built from the running join output) to one side of the
 * stored join definition. Returns the final columns + rows.
 *
 * Throws if any join cannot be applied to the current chain (e.g. neither
 * side of the join is reachable from the running accumulator).
 */
function materializeChain(
  baseId: number,
  joinDefs: { id: number; leftDatasetId: number; rightDatasetId: number; leftColumn: string; rightColumn: string; joinType: string }[],
  dsMap: Map<number, DatasetForJoin>,
): { columns: string[]; rows: Record<string, unknown>[] } {
  const base = dsMap.get(baseId);
  if (!base) throw new Error(`Base dataset ${baseId} not loaded`);

  let acc: DatasetForJoin = {
    id: base.id,
    name: base.name,
    rowCount: base.rows.length,
    columns: base.columns.map((c) => ({ name: c.name })),
    rows: base.rows.map((r) => ({ ...r })),
  };
  const includedDatasetIds = new Set<number>([baseId]);

  for (const j of joinDefs) {
    const leftLoaded = includedDatasetIds.has(j.leftDatasetId);
    const rightLoaded = includedDatasetIds.has(j.rightDatasetId);

    let nextDsId: number;
    let leftCol: string;
    let rightCol: string;
    if (leftLoaded && !rightLoaded) {
      nextDsId = j.rightDatasetId;
      leftCol = j.leftColumn;
      rightCol = j.rightColumn;
    } else if (rightLoaded && !leftLoaded) {
      // Swap: the chained side is on the right of the stored join.
      nextDsId = j.leftDatasetId;
      leftCol = j.rightColumn;
      rightCol = j.leftColumn;
    } else if (leftLoaded && rightLoaded) {
      // Both sides already part of the accumulator — skip this join (no-op).
      continue;
    } else {
      throw new Error(
        `Join ${j.id} cannot be applied: neither side is reachable from the base dataset chain`,
      );
    }

    const next = dsMap.get(nextDsId);
    if (!next) throw new Error(`Dataset ${nextDsId} not loaded for join ${j.id}`);

    // Confirm the chained column exists on the accumulator.
    if (!acc.columns.some((c) => c.name === leftCol)) {
      throw new Error(
        `Join ${j.id} references column "${leftCol}" which is not present in the chained dataset`,
      );
    }

    const out = performJoin(acc, next, {
      leftColumn: leftCol,
      rightColumn: rightCol,
      joinType: j.joinType as JoinType,
    });
    acc = {
      id: -1,
      name: acc.name,
      rowCount: out.rows.length,
      columns: out.columns.map((c) => ({ name: c })),
      rows: out.rows,
    };
    includedDatasetIds.add(nextDsId);
  }

  return {
    columns: acc.columns.map((c) => c.name),
    rows: acc.rows,
  };
}

router.get(
  "/workspaces/:id/prepared-datasets",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.id);
    if (!Number.isFinite(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace id" });
      return;
    }
    const rows = await db
      .select()
      .from(preparedDatasets)
      .where(eq(preparedDatasets.workspaceId, workspaceId))
      .orderBy(desc(preparedDatasets.createdAt));
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const ids = Array.isArray(r.joinIds) ? (r.joinIds as number[]) : [];
        const lineage = await buildLineage(r.baseDatasetId, ids, workspaceId);
        return { ...serialize(r), lineage };
      }),
    );
    res.json(enriched);
  },
);

router.post(
  "/workspaces/:id/prepared-datasets",
  async (req: Request, res: Response) => {
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
    const body = CreatePreparedDatasetBody.parse(req.body);
    const joinIds = (body.joinIds ?? []) as number[];

    // Workspace integrity: base dataset must belong to this workspace.
    const [baseDs] = await db
      .select()
      .from(datasets)
      .where(
        and(
          eq(datasets.id, body.baseDatasetId),
          eq(datasets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!baseDs) {
      res
        .status(400)
        .json({ error: "baseDatasetId does not belong to this workspace" });
      return;
    }

    // Workspace integrity: every join must belong to this workspace and be accepted.
    const joinDefs = joinIds.length
      ? await db
          .select()
          .from(joins)
          .where(
            and(eq(joins.workspaceId, workspaceId), inArray(joins.id, joinIds)),
          )
      : [];
    if (joinDefs.length !== joinIds.length) {
      res.status(400).json({
        error:
          "One or more joinIds do not belong to this workspace or were not found",
      });
      return;
    }
    const notAccepted = joinDefs.find((j) => j.status !== "accepted");
    if (notAccepted) {
      res.status(400).json({
        error: `Join ${notAccepted.id} is "${notAccepted.status}", only accepted joins can be used`,
      });
      return;
    }
    // Preserve user-supplied join order in joinDefs for chaining.
    const orderedJoins = joinIds
      .map((id) => joinDefs.find((j) => j.id === id))
      .filter((j): j is (typeof joinDefs)[number] => Boolean(j));

    // Materialize the join chain to capture columns + sample rows.
    const refDsIds = new Set<number>([body.baseDatasetId]);
    for (const j of orderedJoins) {
      refDsIds.add(j.leftDatasetId);
      refDsIds.add(j.rightDatasetId);
    }
    let materializedColumns: string[] = [];
    let materializedSample: Record<string, unknown>[] = [];
    let materializedRowCount = 0;
    try {
      const dsMap = await loadDatasetMap([...refDsIds]);
      const out = materializeChain(body.baseDatasetId, orderedJoins, dsMap);
      materializedColumns = out.columns;
      materializedRowCount = out.rows.length;
      materializedSample = out.rows.slice(0, SAMPLE_CAP);
    } catch (err: any) {
      req.log.error(
        { err, baseDatasetId: body.baseDatasetId, joinIds },
        "Failed to materialize prepared dataset",
      );
      res
        .status(400)
        .json({ error: `Failed to materialize join chain: ${err.message}` });
      return;
    }

    const [created] = await db
      .insert(preparedDatasets)
      .values({
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        baseDatasetId: body.baseDatasetId,
        joinIds,
        columns: materializedColumns,
        sampleRows: materializedSample,
        rowCount: materializedRowCount,
      })
      .returning();
    const lineage = await buildLineage(
      created.baseDatasetId,
      joinIds,
      workspaceId,
    );
    res.status(201).json({ ...serialize(created), lineage });
  },
);

router.get(
  "/workspaces/:workspaceId/prepared-datasets/:preparedDatasetId",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.workspaceId);
    const id = Number(req.params.preparedDatasetId);
    if (!Number.isFinite(workspaceId) || !Number.isFinite(id)) {
      res
        .status(400)
        .json({ error: "Invalid workspace or prepared dataset id" });
      return;
    }
    const [row] = await db
      .select()
      .from(preparedDatasets)
      .where(
        and(
          eq(preparedDatasets.id, id),
          eq(preparedDatasets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Prepared dataset not found" });
      return;
    }
    const lineage = await buildLineage(
      row.baseDatasetId,
      Array.isArray(row.joinIds) ? (row.joinIds as number[]) : [],
      workspaceId,
    );
    res.json({ ...serialize(row), lineage });
  },
);

router.delete(
  "/workspaces/:workspaceId/prepared-datasets/:preparedDatasetId",
  async (req: Request, res: Response) => {
    const workspaceId = Number(req.params.workspaceId);
    const id = Number(req.params.preparedDatasetId);
    if (!Number.isFinite(workspaceId) || !Number.isFinite(id)) {
      res
        .status(400)
        .json({ error: "Invalid workspace or prepared dataset id" });
      return;
    }
    const result = await db
      .delete(preparedDatasets)
      .where(
        and(
          eq(preparedDatasets.id, id),
          eq(preparedDatasets.workspaceId, workspaceId),
        ),
      )
      .returning({ id: preparedDatasets.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Prepared dataset not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
