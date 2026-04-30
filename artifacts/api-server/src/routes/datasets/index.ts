import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import { db, datasets, datasetColumns, datasetRows, workspaces } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import {
  classifyColumns,
  scoreReadiness,
  mergeIssueStatuses,
  applyStatusToScore,
  suggestKpis,
  type ColumnClassification,
  type DatasetIssue,
  type IssueStatus,
} from "../../lib/dataset-engine";
import { parseWorkbookBuffer } from "../../lib/parse-workbook";
import { UpdateDatasetColumnBody, UpdateDatasetIssueBody } from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

type Writer =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function getIssues(d: typeof datasets.$inferSelect): DatasetIssue[] {
  return Array.isArray(d.issues) ? (d.issues as DatasetIssue[]) : [];
}

function activeIssueCount(issues: DatasetIssue[]): number {
  return issues.filter((i) => i.status !== "ignored" && i.status !== "resolved").length;
}

function serializeDataset(d: typeof datasets.$inferSelect) {
  const issues = getIssues(d);
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
    issueCount: activeIssueCount(issues),
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

function classificationsFromColumns(
  cols: (typeof datasetColumns.$inferSelect)[],
): ColumnClassification[] {
  return cols.map((c) => ({
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
}

async function refreshWorkspaceAggregates(
  workspaceId: number,
  writer: Writer = db,
): Promise<void> {
  const all = await writer
    .select({ score: datasets.readinessScore })
    .from(datasets)
    .where(eq(datasets.workspaceId, workspaceId));
  const fileCount = all.length;
  const readiness =
    fileCount === 0
      ? 0
      : Math.round(all.reduce((sum, d) => sum + d.score, 0) / fileCount);
  await writer
    .update(workspaces)
    .set({ fileCount, readinessScore: readiness, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

async function persistDataset(
  writer: Writer,
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
    issues: DatasetIssue[];
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

      const file = req.file;
      const created = await db.transaction(async (tx) => {
        const out: ReturnType<typeof serializeDataset>[] = [];
        for (const sheet of parsed.sheets) {
          const classifications = classifyColumns(sheet.rows, sheet.columnNames);
          const { score, issues } = scoreReadiness(sheet.rows, classifications);
          const ds = await persistDataset(tx, {
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
        await refreshWorkspaceAggregates(workspaceId, tx);
        return out;
      });

      res.status(201).json({ datasets: created });
    } catch (err: any) {
      req.log.error({ err }, "Workspace dataset upload error");
      res.status(500).json({ error: "Failed to parse file: " + (err.message || "Unknown error") });
    }
  },
);

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
  const classifications = classificationsFromColumns(cols);
  res.json({
    ...serializeDataset(ds),
    issues: getIssues(ds),
    columns: cols.map(serializeColumn),
    sampleRows: allRows.slice(0, 20),
    suggestedKpis: suggestKpis(classifications, ds.rowCount),
  });
});

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

    const result = await db.transaction(async (tx) => {
      await tx
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

      const allCols = await tx
        .select()
        .from(datasetColumns)
        .where(eq(datasetColumns.datasetId, datasetId))
        .orderBy(datasetColumns.ordinal);
      const [rowsRow] = await tx
        .select()
        .from(datasetRows)
        .where(eq(datasetRows.datasetId, datasetId))
        .limit(1);
      const allRows = (rowsRow?.rows as Record<string, unknown>[] | undefined) ?? [];

      const reClassifications = classificationsFromColumns(allCols);
      const { score: rawScore, issues: freshIssues } = scoreReadiness(allRows, reClassifications);
      const [prev] = await tx.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
      const merged = mergeIssueStatuses(freshIssues, getIssues(prev!));
      const adjusted = applyStatusToScore(rawScore, merged);

      await tx
        .update(datasets)
        .set({ readinessScore: adjusted, issues: merged, updatedAt: new Date() })
        .where(eq(datasets.id, datasetId));

      const [ds] = await tx.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
      await refreshWorkspaceAggregates(ds!.workspaceId, tx);
      return { ds: ds!, allCols, allRows, merged, classifications: reClassifications };
    });

    res.json({
      ...serializeDataset(result.ds),
      issues: result.merged,
      columns: result.allCols.map(serializeColumn),
      sampleRows: result.allRows.slice(0, 20),
      suggestedKpis: suggestKpis(result.classifications, result.ds.rowCount),
    });
  },
);

router.patch(
  "/datasets/:datasetId/issues/:issueId",
  async (req: Request, res: Response) => {
    const datasetId = Number(req.params.datasetId);
    const issueId = String(req.params.issueId);
    if (!Number.isFinite(datasetId)) {
      res.status(400).json({ error: "Invalid dataset id" });
      return;
    }
    const body = UpdateDatasetIssueBody.parse(req.body);
    const status = body.status as IssueStatus;

    const result = await db.transaction(async (tx) => {
      const [ds] = await tx.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
      if (!ds) return null;
      const issues = getIssues(ds);
      const idx = issues.findIndex((i) => i.id === issueId);
      if (idx < 0) return { notFoundIssue: true };
      const next = issues.slice();
      next[idx] = { ...next[idx], status };

      const cols = await tx
        .select()
        .from(datasetColumns)
        .where(eq(datasetColumns.datasetId, datasetId))
        .orderBy(datasetColumns.ordinal);
      const [rowsRow] = await tx
        .select()
        .from(datasetRows)
        .where(eq(datasetRows.datasetId, datasetId))
        .limit(1);
      const allRows = (rowsRow?.rows as Record<string, unknown>[] | undefined) ?? [];
      const classifications = classificationsFromColumns(cols);
      const { score: rawScore } = scoreReadiness(allRows, classifications);
      const adjusted = applyStatusToScore(rawScore, next);

      await tx
        .update(datasets)
        .set({ readinessScore: adjusted, issues: next, updatedAt: new Date() })
        .where(eq(datasets.id, datasetId));
      const [updated] = await tx.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
      await refreshWorkspaceAggregates(updated!.workspaceId, tx);
      return { ds: updated!, cols, allRows, issues: next, classifications };
    });

    if (!result) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }
    if ("notFoundIssue" in result) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json({
      ...serializeDataset(result.ds),
      issues: result.issues,
      columns: result.cols.map(serializeColumn),
      sampleRows: result.allRows.slice(0, 20),
      suggestedKpis: suggestKpis(result.classifications, result.ds.rowCount),
    });
  },
);

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
