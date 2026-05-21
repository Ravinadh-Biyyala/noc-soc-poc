import { Router, type IRouter, type Request, type Response } from "express";
import { google } from "googleapis";
import { db, pool } from "@workspace/db";
import { datasets, type DatasetColumn } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getValidToken } from "../auth";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response): number | null {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated. Please connect your Google account first." });
    return null;
  }
  return userId;
}

function makeAuthClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function toSnakeCase(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "col_$1") || "col"
  );
}

function inferType(samples: string[]): { type: DatasetColumn["type"]; pgType: DatasetColumn["pgType"] } {
  const nonEmpty = samples.filter((s) => s !== "" && s !== null && s !== undefined);
  if (nonEmpty.length === 0) return { type: "string", pgType: "TEXT" };

  const allNumeric = nonEmpty.every((v) => !isNaN(Number(v)));
  if (allNumeric) return { type: "number", pgType: "NUMERIC" };

  const allDate = nonEmpty.every((v) => !isNaN(Date.parse(v)));
  if (allDate) return { type: "date", pgType: "TIMESTAMPTZ" };

  const boolVals = new Set(["true", "false", "yes", "no", "1", "0"]);
  const allBool = nonEmpty.every((v) => boolVals.has(v.toLowerCase()));
  if (allBool) return { type: "boolean", pgType: "BOOLEAN" };

  return { type: "string", pgType: "TEXT" };
}

interface SheetSyncResult {
  datasetId: number;
  table: string;
  rowCount: number;
  columns: { name: string; originalName: string; type: string }[];
  /** First 5 data rows as raw string arrays (one array per row, values match columnNames order) */
  sampleRows: string[][];
  columnNames: string[];
  fileName: string;
  sheetName: string;
}

async function syncSheetCore(
  userId: number,
  spreadsheetId: string,
  sheetName: string,
  tableName: string,
): Promise<SheetSyncResult> {
  const token = await getValidToken(userId);
  const sheetsApi = google.sheets({ version: "v4", auth: makeAuthClient(token) });
  const driveApi = google.drive({ version: "v3", auth: makeAuthClient(token) });

  const metaResp = await driveApi.files.get({ fileId: spreadsheetId, fields: "name" });
  const fileName = metaResp.data.name ?? spreadsheetId;

  const valuesResp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: sheetName });
  const allRows = valuesResp.data.values ?? [];
  if (allRows.length < 1) throw new Error(`Sheet "${sheetName}" is empty`);

  const rawHeaders = allRows[0] as string[];
  const dataRows = allRows.slice(1) as string[][];

  // Deduplicate and sanitize column names
  const seenNames = new Map<string, number>();
  const pgNames = rawHeaders.map((h) => {
    const base = toSnakeCase(String(h || "col"));
    const count = seenNames.get(base) ?? 0;
    seenNames.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });

  // Infer column types from first 100 data rows
  const sampleForInference = dataRows.slice(0, 100);
  const columnSchema: DatasetColumn[] = pgNames.map((pgName, i) => {
    const samples = sampleForInference.map((row) => String(row[i] ?? ""));
    const { type, pgType } = inferType(samples);
    const values = sampleForInference.map((row) => row[i] ?? "").filter((v) => v !== "");
    const uniqueCount = new Set(values).size;
    const nullCount = sampleForInference.filter((row) => !row[i] || row[i] === "").length;

    const col: DatasetColumn = {
      originalName: rawHeaders[i] ?? pgName,
      pgName,
      type,
      pgType,
      nullCount,
      uniqueCount,
    };

    if (type === "number") {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        col.min = Math.min(...nums);
        col.max = Math.max(...nums);
        col.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }

    return col;
  });

  const colDefs = columnSchema.map((c) => `"${c.pgName}" ${c.pgType}`).join(", ");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS "${tableName}"`);
    await client.query(`CREATE TABLE "${tableName}" (${colDefs})`);

    const BATCH = 500;
    for (let start = 0; start < dataRows.length; start += BATCH) {
      const batch = dataRows.slice(start, start + BATCH);
      if (batch.length === 0) continue;

      const placeholders: string[] = [];
      const params: (string | null)[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        const rowPlaceholders = pgNames.map(() => `$${paramIdx++}`).join(", ");
        placeholders.push(`(${rowPlaceholders})`);
        for (let i = 0; i < pgNames.length; i++) {
          const raw = row[i];
          params.push(raw === undefined || raw === "" ? null : String(raw));
        }
      }

      const colList = pgNames.map((n) => `"${n}"`).join(", ");
      await client.query(
        `INSERT INTO "${tableName}" (${colList}) VALUES ${placeholders.join(", ")}`,
        params,
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const rowCount = dataRows.length;
  const existing = await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.tableName, tableName));

  let datasetId: number;
  if (existing.length > 0) {
    await db
      .update(datasets)
      .set({ fileName, sheetName, columnSchema, rowCount })
      .where(eq(datasets.tableName, tableName));
    datasetId = existing[0].id;
  } else {
    const [inserted] = await db
      .insert(datasets)
      .values({ fileName, sheetName, tableName, columnSchema, rowCount })
      .returning({ id: datasets.id });
    datasetId = inserted.id;
  }

  return {
    datasetId,
    table: tableName,
    rowCount,
    columns: columnSchema.map((c) => ({ name: c.pgName, originalName: c.originalName, type: c.type })),
    sampleRows: dataRows.slice(0, 5),
    columnNames: rawHeaders,
    fileName,
    sheetName,
  };
}

// ── List spreadsheets from Drive ──────────────────────────────────────────────

router.get("/sheets", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  try {
    const token = await getValidToken(userId);
    const drive = google.drive({ version: "v3", auth: makeAuthClient(token) });

    const q = String(req.query.q ?? "")
      .trim()
      .slice(0, 80)
      .replace(/[^\p{L}\p{N} ._-]/gu, "");
    const driveQuery = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      "trashed=false",
      ...(q ? [`name contains '${q}'`] : []),
    ].join(" and ");

    const resp = await drive.files.list({
      q: driveQuery,
      fields: "files(id,name,modifiedTime)",
      pageSize: 50,
      orderBy: "modifiedTime desc",
      spaces: "drive",
    });

    res.json({ files: resp.data.files ?? [] });
  } catch (err: unknown) {
    req.log.error({ err }, "google sheets list error");
    res.status(500).json({ error: "Could not list spreadsheets" });
  }
});

// ── Get tabs for a spreadsheet ────────────────────────────────────────────────

router.get("/sheets/:spreadsheetId/tabs", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const spreadsheetId = String(req.params.spreadsheetId ?? "").trim();
  if (!spreadsheetId) {
    res.status(400).json({ error: "spreadsheetId is required" });
    return;
  }

  try {
    const token = await getValidToken(userId);
    const sheets = google.sheets({ version: "v4", auth: makeAuthClient(token) });
    const resp = await sheets.spreadsheets.get({ spreadsheetId });

    const tabs = ((resp.data.sheets as any[]) ?? []).map((s: any) => ({
      sheetId: s.properties?.sheetId as number | undefined,
      title: s.properties?.title as string | undefined,
    }));

    res.json({ tabs });
  } catch (err: unknown) {
    req.log.error({ err }, "tabs fetch error");
    res.status(500).json({ error: "Could not fetch sheet tabs" });
  }
});

// ── Sync a single sheet ───────────────────────────────────────────────────────

router.post("/sync", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { spreadsheetId, sheetName } = req.body as { spreadsheetId?: string; sheetName?: string };
  if (!spreadsheetId || !sheetName) {
    res.status(400).json({ error: "spreadsheetId and sheetName are required" });
    return;
  }

  try {
    const tableName = `gs_${toSnakeCase(sheetName)}`;
    const result = await syncSheetCore(userId, spreadsheetId, sheetName, tableName);
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, "sync error");
    res.status(500).json({ error: "Sync failed. Please try again." });
  }
});

// ── Sync multiple sheets (batch) ──────────────────────────────────────────────

router.post("/sync/batch", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { sheets } = req.body as {
    sheets?: Array<{ spreadsheetId: string; sheetName: string }>;
  };

  if (!Array.isArray(sheets) || sheets.length === 0) {
    res.status(400).json({ error: "sheets array is required and must not be empty" });
    return;
  }
  if (sheets.length > 10) {
    res.status(400).json({ error: "Maximum 10 sheets per batch" });
    return;
  }

  const results: SheetSyncResult[] = [];

  for (const { spreadsheetId, sheetName } of sheets) {
    if (!spreadsheetId || !sheetName) {
      res.status(400).json({ error: "Each sheet must have spreadsheetId and sheetName" });
      return;
    }
    // Use spreadsheet ID suffix + sheet name for unique table names across files
    const idSuffix = spreadsheetId.slice(-8).replace(/[^a-z0-9]/gi, "").toLowerCase();
    const tableName = `gs_${idSuffix}_${toSnakeCase(sheetName)}`.slice(0, 63);

    try {
      const result = await syncSheetCore(userId, spreadsheetId, sheetName, tableName);
      results.push(result);
    } catch (err: unknown) {
      req.log.error({ err, spreadsheetId, sheetName }, "batch sync error for sheet");
      res.status(500).json({
        error: `Failed to sync "${sheetName}": ${err instanceof Error ? err.message : "Unknown error"}`,
      });
      return;
    }
  }

  res.json({ results });
});

// ── List synced Google Sheets datasets ────────────────────────────────────────

router.get("/sheets/datasets", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const rawIds = String(req.query.ids ?? "");
  const ids = rawIds
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (ids.length === 0) {
    res.status(400).json({ error: "ids query param is required (comma-separated dataset IDs)" });
    return;
  }

  try {
    const rows = await db.select().from(datasets).where(inArray(datasets.id, ids));
    res.json({ datasets: rows });
  } catch (err: unknown) {
    req.log.error({ err }, "sheets datasets list error");
    res.status(500).json({ error: "Could not load datasets" });
  }
});

// ── Preview rows for a synced dataset ─────────────────────────────────────────

router.get("/sheets/datasets/:id/preview", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const id = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Valid numeric id is required" });
    return;
  }

  try {
    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
    if (!dataset) {
      res.status(404).json({ error: "Dataset not found" });
      return;
    }

    const client = await pool.connect();
    try {
      // tableName is generated internally (gs_* prefix) — safe to embed directly
      const result = await client.query(`SELECT * FROM "${dataset.tableName}" LIMIT 20`);
      res.json({
        columns: (dataset.columnSchema ?? []).map((c) => ({
          name: c.pgName,
          originalName: c.originalName,
          type: c.type,
          pgType: c.pgType,
        })),
        rows: result.rows,
        rowCount: dataset.rowCount ?? 0,
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    req.log.error({ err }, "sheets dataset preview error");
    res.status(500).json({ error: "Could not preview dataset" });
  }
});

// ── AI analysis recommendations for synced sheets ─────────────────────────────

router.post("/sheets/recommendations", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { datasets: inputDatasets } = req.body as {
    datasets?: { id: number; fileName: string; sheetName: string; columns: { name: string; type: string }[] }[];
  };

  if (!Array.isArray(inputDatasets) || inputDatasets.length === 0) {
    res.status(400).json({ error: "datasets array is required" });
    return;
  }

  const tableDescriptions = inputDatasets
    .map((d) => {
      const cols = d.columns.map((c) => `  ${c.name} (${c.type})`).join("\n");
      return `Sheet: ${d.fileName} / ${d.sheetName}\nColumns:\n${cols}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a data analyst. Analyze the given spreadsheet schemas and return ONLY valid JSON (no markdown) with:
{
  "joinRecommendations": [
    { "leftTable": "fileName/sheetName", "leftCol": "col", "rightTable": "fileName/sheetName", "rightCol": "col", "confidence": "high|medium|low", "reason": "short reason" }
  ],
  "analysisIdeas": [
    { "title": "short title", "question": "plain English question", "chartType": "bar|line|pie|scatter|kpi|table" }
  ]
}
Rules:
- joinRecommendations: find matching column names/types that suggest a foreign key. If only 1 sheet, leave array empty.
- analysisIdeas: exactly 5 items that would be interesting to visualize. Focus on metrics, trends, comparisons.
- chartType: bar for comparisons, line for trends, pie for distributions, scatter for correlations, kpi for single values, table for detail rows.`;

  try {
    const aiResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Sheets:\n\n${tableDescriptions}` },
      ],
      response_format: { type: "json_object" },
    });

    const raw = (aiResponse.choices[0]?.message?.content ?? "{}").trim();
    res.json(JSON.parse(raw));
  } catch (err: unknown) {
    req.log.error({ err }, "sheets recommendations error");
    res.status(500).json({ error: "Could not generate recommendations" });
  }
});

export default router;
