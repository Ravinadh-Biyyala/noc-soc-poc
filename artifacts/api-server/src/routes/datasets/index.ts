import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import { db, datasets, datasetColumns, datasetRows, workspaces } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  classifyColumns,
  scoreReadiness,
  type ColumnClassification,
} from "../../lib/dataset-engine";
import { parseWorkbookBuffer } from "../../lib/parse-workbook";
import { UpdateDatasetColumnBody } from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 60 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// Translate raw multer errors into friendly JSON.
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `File too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed" });
      return;
    }
    next();
  });
}

function serializeDataset(d: typeof datasets.$inferSelect) {
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    fileName: d.fileName,
    sheetName: d.sheetName,
    byteSize: d.byteSize,
    rowCount: d.rowCount,
    returnedRowCount: d.returnedRowCount,
    truncated: d.truncated,
    readinessScore: d.readinessScore,
    issueCount: Array.isArray(d.issues) ? d.issues.length : 0,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeColumn(c: typeof datasetColumns.$inferSelect) {
  return {
    id: c.id,
    datasetId: c.datasetId,
    ordinal: c.ordinal,
    name: c.name,
    rawType: c.rawType,
    semanticType: c.semanticType,
    businessMeaning: c.businessMeaning,
    uniqueCount: c.uniqueCount,
    nullCount: c.nullCount,
    sample: Array.isArray(c.sample) ? c.sample : [],
    stats: (c.stats as { min?: number; max?: number; mean?: number } | null) ?? null,
    overriddenSemantic: c.overriddenSemantic,
    overriddenMeaning: c.overriddenMeaning,
  };
}

// Drizzle transaction handle (any writer that exposes the same query API as
// `db`). We accept either to keep helpers usable both inside and outside a
// transaction.
type DbWriter = typeof db;

// Re-derive a workspace's overall readiness as the average of its dataset
// readiness scores. Bumps fileCount + updatedAt at the same time so the
// workspace cards on the list page stay in sync.
async function refreshWorkspaceAggregates(
  workspaceId: number,
  writer: DbWriter = db,
): Promise<void> {
  const all = await writer
    .select({ score: datasets.readinessScore })
    .from(datasets)
    .where(eq(datasets.workspaceId, workspaceId));
  const fileCount = all.length;
  const readiness = fileCount === 0
    ? 0
    : Math.round(all.reduce((sum, d) => sum + d.score, 0) / fileCount);
  await writer
    .update(workspaces)
    .set({ fileCount, readinessScore: readiness, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

// Persist a freshly-parsed sheet as a dataset + columns + rows blob. Writes
// go through `writer` so we can compose this inside a transaction.
async function persistDataset(
  writer: DbWriter,
  opts: {
    workspaceId: number;
    fileName: string;
    byteSize: number;
    sheetName: string;
    rowCount: number;
    returnedRowCount: number;
    truncated: boolean;
    rows: Record<string, unknown>[];
    classifications: ColumnClassification[];
    readinessScore: number;
    issues: ReturnType<typeof scoreReadiness>["issues"];
  },
) {
  const [datasetRow] = await writer
    .insert(datasets)
    .values({
      workspaceId: opts.workspaceId,
      fileName: opts.fileName,
      byteSize: opts.byteSize,
      sheetName: opts.sheetName,
      rowCount: opts.rowCount,
      returnedRowCount: opts.returnedRowCount,
      truncated: opts.truncated,
      readinessScore: opts.readinessScore,
      issues: opts.issues,
    })
    .returning();

  if (opts.classifications.length > 0) {
    await writer.insert(datasetColumns).values(
      opts.classifications.map((c) => ({
        datasetId: datasetRow.id,
        ordinal: c.ordinal,
        name: c.name,
        rawType: c.rawType,
        semanticType: c.semanticType,
        businessMeaning: c.businessMeaning,
        uniqueCount: c.uniqueCount,
        nullCount: c.nullCount,
        sample: c.sample,
        stats: c.stats ?? null,
      })),
    );
  }

  await writer.insert(datasetRows).values({
    datasetId: datasetRow.id,
    rows: opts.rows,
  });

  return datasetRow;
}

// POST /api/workspaces/:id/datasets
// Multipart file upload, scoped to a workspace. Each non-empty sheet becomes
// a dataset row; the response returns the list of dataset summaries created.
router.post(
  "/workspaces/:id/datasets",
  handleUpload,
  async (req: Request, res: Response) => {
    try {
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
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const parsed = parseWorkbookBuffer(req.file.buffer);
      if (parsed.sheets.length === 0) {
        res.status(400).json({ error: "No data found in the uploaded file" });
        return;
      }

      // Persist every sheet + the workspace aggregate refresh inside a single
      // transaction. If any sheet fails (oversized JSONB, constraint, etc.)
      // we roll back the whole upload so the workspace never ends up with a
      // partially-imported file or stale aggregates.
      const file = req.file;
      const created = await db.transaction(async (tx) => {
        const out: ReturnType<typeof serializeDataset>[] = [];
        for (const sheet of parsed.sheets) {
          const classifications = classifyColumns(sheet.rows, sheet.columnNames);
          const { score, issues } = scoreReadiness(sheet.rows, classifications);
          const ds = await persistDataset(tx as unknown as DbWriter, {
            workspaceId,
            fileName: file.originalname,
            byteSize: file.size,
            sheetName: sheet.name,
            rowCount: sheet.rowCount,
            returnedRowCount: sheet.returnedRowCount,
            truncated: sheet.truncated,
            rows: sheet.rows,
            classifications,
            readinessScore: score,
            issues,
          });
          out.push(serializeDataset(ds));
        }
        await refreshWorkspaceAggregates(workspaceId, tx as unknown as DbWriter);
        return out;
      });

      res.status(201).json({ datasets: created });
    } catch (err: any) {
      req.log.error({ err }, "Workspace dataset upload error");
      res.status(500).json({ error: "Failed to parse file: " + (err.message || "Unknown error") });
    }
  },
);

// GET /api/workspaces/:id/datasets
router.get("/workspaces/:id/datasets", async (req: Request, res: Response) => {
  const workspaceId = Number(req.params.id);
  if (!Number.isFinite(workspaceId)) {
    res.status(400).json({ error: "Invalid workspace id" });
    return;
  }
  const rows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.workspaceId, workspaceId))
    .orderBy(desc(datasets.createdAt));
  res.json(rows.map(serializeDataset));
});

// GET /api/datasets/:datasetId — full detail incl. columns, sample rows, issues
router.get("/datasets/:datasetId", async (req: Request, res: Response) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isFinite(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id" });
    return;
  }
  const [ds] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
  if (!ds) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }
  const cols = await db
    .select()
    .from(datasetColumns)
    .where(eq(datasetColumns.datasetId, datasetId))
    .orderBy(datasetColumns.ordinal);
  const [rowsRow] = await db
    .select()
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, datasetId))
    .limit(1);
  const allRows = (rowsRow?.rows as Record<string, unknown>[] | undefined) ?? [];
  res.json({
    ...serializeDataset(ds),
    issues: Array.isArray(ds.issues) ? ds.issues : [],
    columns: cols.map(serializeColumn),
    sampleRows: allRows.slice(0, 20),
  });
});

// PATCH /api/datasets/:datasetId/columns/:columnId
// Apply user overrides for semantic type and/or business meaning, then
// recompute the dataset's readiness score with the new classifications.
router.patch(
  "/datasets/:datasetId/columns/:columnId",
  async (req: Request, res: Response) => {
    const datasetId = Number(req.params.datasetId);
    const columnId = Number(req.params.columnId);
    if (!Number.isFinite(datasetId) || !Number.isFinite(columnId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = UpdateDatasetColumnBody.parse(req.body);
    const [col] = await db
      .select()
      .from(datasetColumns)
      .where(and(eq(datasetColumns.id, columnId), eq(datasetColumns.datasetId, datasetId)))
      .limit(1);
    if (!col) {
      res.status(404).json({ error: "Column not found" });
      return;
    }

    await db
      .update(datasetColumns)
      .set({
        ...(body.semanticType !== undefined
          ? { semanticType: body.semanticType, overriddenSemantic: true }
          : {}),
        ...(body.businessMeaning !== undefined
          ? { businessMeaning: body.businessMeaning, overriddenMeaning: true }
          : {}),
      })
      .where(eq(datasetColumns.id, columnId));

    // Recompute readiness with the (possibly overridden) classifications and
    // the persisted rows.
    const allCols = await db
      .select()
      .from(datasetColumns)
      .where(eq(datasetColumns.datasetId, datasetId))
      .orderBy(datasetColumns.ordinal);
    const [rowsRow] = await db
      .select()
      .from(datasetRows)
      .where(eq(datasetRows.datasetId, datasetId))
      .limit(1);
    const allRows = (rowsRow?.rows as Record<string, unknown>[] | undefined) ?? [];

    const reClassifications: ColumnClassification[] = allCols.map((c) => ({
      name: c.name,
      ordinal: c.ordinal,
      rawType: c.rawType as ColumnClassification["rawType"],
      semanticType: c.semanticType as ColumnClassification["semanticType"],
      businessMeaning: c.businessMeaning ?? "",
      uniqueCount: c.uniqueCount,
      nullCount: c.nullCount,
      sample: Array.isArray(c.sample) ? c.sample : [],
      stats: (c.stats as ColumnClassification["stats"]) ?? undefined,
    }));
    const { score, issues } = scoreReadiness(allRows, reClassifications);

    await db
      .update(datasets)
      .set({ readinessScore: score, issues, updatedAt: new Date() })
      .where(eq(datasets.id, datasetId));

    const [ds] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
    if (ds) await refreshWorkspaceAggregates(ds.workspaceId);

    res.json({
      ...serializeDataset(ds!),
      issues,
      columns: allCols.map((c) =>
        serializeColumn(c.id === columnId ? { ...c, ...inferOverrideFlags(body, c) } : c),
      ),
      sampleRows: allRows.slice(0, 20),
    });
  },
);

function inferOverrideFlags(
  body: { semanticType?: string; businessMeaning?: string | null },
  col: typeof datasetColumns.$inferSelect,
): Partial<typeof datasetColumns.$inferSelect> {
  return {
    ...(body.semanticType !== undefined
      ? { semanticType: body.semanticType, overriddenSemantic: true }
      : {}),
    ...(body.businessMeaning !== undefined
      ? { businessMeaning: body.businessMeaning, overriddenMeaning: true }
      : {}),
  };
}

// DELETE /api/datasets/:datasetId
router.delete("/datasets/:datasetId", async (req: Request, res: Response) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isFinite(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id" });
    return;
  }
  const [ds] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
  if (!ds) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }
  await db.delete(datasets).where(eq(datasets.id, datasetId));
  await refreshWorkspaceAggregates(ds.workspaceId);
  res.status(204).end();
});

export default router;

// Suppress unused-symbol lint while keeping the helper expressive.
void sql;
