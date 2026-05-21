/**
 * Project-scoped data ingestion.
 *
 * All endpoints mount under /api/projects/:id/ingest/* and write the ingested
 * tables into the project's OWN Postgres database (created by
 * createProjectDatabase). Tables land in the "raw" schema.
 *
 * Three sources are supported, mirroring the source-picker cards in the UI:
 *   - Upload   — XLSX / CSV multi-file picker. Reuses the parsing helpers from
 *                routes/upload but writes via the project pool.
 *   - Postgres — user supplies host/port/db/user/password; server lists tables;
 *                user picks which to import. Reuses the connect+copy logic
 *                from routes/postgres but the destination is the project DB.
 *   - Sheets   — Replit Google Sheets connector picker; downloads as XLSX and
 *                runs it through the same upload pipeline.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import pg from "pg";
import {
  db,
  datasets as datasetsTable,
  masterPool,
  listRawTables,
  createProjectSchemas,
  rawSchema,
  quoteIdent,
} from "@workspace/db";
import type { DatasetColumn } from "@workspace/db";

/**
 * Auto-provision the project's raw + warehouse schemas if they don't yet exist.
 * Workspaces created before the schema-per-project feature shipped won't have
 * them; createProjectSchemas is idempotent so this is safe on every ingest.
 */
async function ensureProjectDb(projectId: number, log: Request["log"]): Promise<void> {
  try {
    const { created } = await createProjectSchemas(projectId);
    if (created) log.info({ projectId }, "Project schemas auto-provisioned on first ingest");
  } catch (err) {
    log.error({ err, projectId }, "Failed to auto-provision project schemas");
    throw err;
  }
}

const { Client } = pg;

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST },
});

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isSafeIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

function toPgName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^([^a-z])/, "col_$1")
    .slice(0, 60);
  return sanitized || "col_unknown";
}

function detectColumnType(values: unknown[]): DatasetColumn["type"] {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "string";
  let numCount = 0;
  let dateCount = 0;
  let boolCount = 0;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)|^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/;
  for (const v of nonNull.slice(0, 100)) {
    if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "")) numCount++;
    else if (typeof v === "boolean") boolCount++;
    else if (v instanceof Date || (typeof v === "string" && DATE_RE.test(v.trim()))) dateCount++;
  }
  const total = Math.min(nonNull.length, 100);
  if (numCount / total > 0.8) return "number";
  if (dateCount / total > 0.8) return "date";
  if (boolCount / total > 0.8) return "boolean";
  return "string";
}

function toPgType(type: DatasetColumn["type"]): DatasetColumn["pgType"] {
  switch (type) {
    case "number":  return "NUMERIC";
    case "date":    return "TIMESTAMPTZ";
    case "boolean": return "BOOLEAN";
    default:        return "TEXT";
  }
}

interface AnalyzedSheet {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: DatasetColumn["type"]; nullCount: number; uniqueCount: number }>;
  rows: Record<string, unknown>[];
}

function analyzeSheet(sheet: XLSX.WorkSheet, sheetName: string): AnalyzedSheet {
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (jsonData.length === 0) {
    return { name: sheetName, rowCount: 0, columns: [], rows: [] };
  }
  const colNames = Object.keys(jsonData[0]);
  const columns = colNames.map((name) => {
    const values = jsonData.map((row) => row[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    return {
      name,
      type: detectColumnType(values),
      uniqueCount: new Set(nonNull.map(String)).size,
      nullCount: values.length - nonNull.length,
    };
  });
  return { name: sheetName, rowCount: jsonData.length, columns, rows: jsonData };
}

/**
 * Sanitize a sheet name into a Postgres table identifier. Project tables live
 * in the "raw" schema so the table name itself can be human-readable.
 */
function makeRawTableName(fileBase: string, sheetName: string, existingNames: Set<string>): string {
  const base = `${fileBase}_${sheetName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 50) || "sheet";
  let candidate = base;
  let suffix = 2;
  while (existingNames.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  existingNames.add(candidate);
  return candidate;
}

async function persistSheetToProjectDb(
  projectId: number,
  sheet: AnalyzedSheet,
  fileName: string,
  desiredTableName: string,
  log: Request["log"],
): Promise<{ tableName: string; datasetId: number; rowCount: number; columnCount: number }> {
  // Build column schema with deduplicated pg names
  const usedPgNames = new Set<string>(["_row_id"]);
  const colSchema: DatasetColumn[] = sheet.columns.map((c) => {
    let pgName = toPgName(c.name);
    let candidate = pgName;
    let i = 2;
    while (usedPgNames.has(candidate)) candidate = `${pgName}_${i++}`;
    usedPgNames.add(candidate);
    return {
      originalName: c.name,
      pgName: candidate,
      type: c.type,
      pgType: toPgType(c.type),
      nullCount: c.nullCount,
      uniqueCount: c.uniqueCount,
    };
  });

  const schema = rawSchema(projectId);
  const targetQualified = `${quoteIdent(schema)}.${quoteIdent(desiredTableName)}`;
  const client = await masterPool.connect();
  const colDefs = colSchema.map((c) => `  ${quoteIdent(c.pgName)} ${c.pgType}`).join(",\n");
  const createSql = `CREATE TABLE ${targetQualified} (\n  _row_id SERIAL PRIMARY KEY,\n${colDefs}\n)`;

  try {
    await client.query(`DROP TABLE IF EXISTS ${targetQualified}`);
    await client.query(createSql);

    if (sheet.rows.length > 0) {
      const batchSize = Math.max(1, Math.floor(60_000 / Math.max(colSchema.length, 1)));
      const pgNames = colSchema.map((c) => quoteIdent(c.pgName)).join(", ");

      for (let i = 0; i < sheet.rows.length; i += batchSize) {
        const batch = sheet.rows.slice(i, i + batchSize);
        const placeholders: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const rowPlaceholders = colSchema.map((c) => {
            const raw = row[c.originalName];
            let val: unknown = raw === undefined || raw === "" ? null : raw;
            if (c.pgType === "TIMESTAMPTZ" && val !== null && !(val instanceof Date)) {
              const d = new Date(String(val));
              val = isNaN(d.getTime()) ? null : d;
            }
            values.push(val);
            return `$${paramIdx++}`;
          });
          placeholders.push(`(${rowPlaceholders.join(", ")})`);
        }

        await client.query(
          `INSERT INTO ${targetQualified} (${pgNames}) VALUES ${placeholders.join(", ")}`,
          values,
        );
      }
    }
    log.info({ projectId, tableName: desiredTableName, rows: sheet.rows.length }, "Sheet persisted to project schema");
  } catch (err) {
    await client.query(`DROP TABLE IF EXISTS ${targetQualified}`).catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Register in the master datasets table so existing UIs (raw browser, agent
  // dataset list) can discover the new table. Fully-qualified name now refers
  // to the per-project schema in the master DB.
  const fullyQualified = `${schema}.${desiredTableName}`;
  const [meta] = await db
    .insert(datasetsTable)
    .values({
      workspaceId: projectId,
      fileName,
      sheetName: sheet.name,
      tableName: fullyQualified,
      columnSchema: colSchema,
      rowCount: sheet.rows.length,
    })
    .returning();

  return { tableName: desiredTableName, datasetId: meta.id, rowCount: sheet.rows.length, columnCount: colSchema.length };
}

// ─── Upload ────────────────────────────────────────────────────────────────

function handleMultiUpload(req: Request, res: Response, next: NextFunction): void {
  upload.array("files", MAX_FILES_PER_REQUEST)(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `File too large. Max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB per file.` });
        return;
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        res.status(413).json({ error: `Too many files. Max ${MAX_FILES_PER_REQUEST} per request.` });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed" });
      return;
    }
    next();
  });
}

router.post("/projects/:id/ingest/upload", handleMultiUpload, async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No files uploaded. Use the 'files' field name." });
    return;
  }

  try {
    await ensureProjectDb(projectId, req.log);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not provision project database" });
    return;
  }

  const existingNames = new Set<string>((await listRawTables(projectId).catch(() => [])).map((t) => t.tableName));
  const imported: Array<{
    fileName: string;
    sheetName: string;
    tableName: string;
    datasetId: number;
    rowCount: number;
    columnCount: number;
  }> = [];

  try {
    for (const file of files) {
      const fileBase = file.originalname.replace(/\.[^.]+$/, "");
      const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
      for (const sheetName of workbook.SheetNames) {
        const analyzed = analyzeSheet(workbook.Sheets[sheetName], sheetName);
        if (analyzed.rowCount === 0) continue;
        const tableName = makeRawTableName(fileBase, sheetName, existingNames);
        const result = await persistSheetToProjectDb(projectId, analyzed, file.originalname, tableName, req.log);
        imported.push({
          fileName: file.originalname,
          sheetName,
          tableName: result.tableName,
          datasetId: result.datasetId,
          rowCount: result.rowCount,
          columnCount: result.columnCount,
        });
      }
    }
    res.status(201).json({ imported });
  } catch (err: unknown) {
    req.log.error({ err, projectId }, "Upload ingest failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// ─── Postgres source ──────────────────────────────────────────────────────

interface PostgresConnInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "require" | "prefer";
}

function readPgConn(body: unknown): PostgresConnInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const host = String(b.host ?? "").trim();
  const port = parseInt(String(b.port ?? "5432"), 10) || 5432;
  const database = String(b.database ?? "").trim();
  const user = String(b.user ?? b.username ?? "").trim();
  const password = String(b.password ?? "");
  const sslRaw = String(b.ssl ?? "prefer");
  const ssl = (["disable", "require", "prefer"].includes(sslRaw) ? sslRaw : "prefer") as PostgresConnInput["ssl"];
  if (!host || !database || !user) return { error: "host, database, and user are required" };
  return { host, port, database, user, password, ssl };
}

function makeSourceClient(cfg: PostgresConnInput) {
  return new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl === "disable" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
}

/** POST /api/projects/:id/ingest/postgres/tables — connect, return table list. */
router.post("/projects/:id/ingest/postgres/tables", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const cfg = readPgConn(req.body);
  if ("error" in cfg) { res.status(400).json({ error: cfg.error }); return; }

  const client = makeSourceClient(cfg);
  try {
    await client.connect();
    const result = await client.query(`
      SELECT table_schema AS schema, table_name AS table
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);
    res.json({ ok: true, tables: result.rows as Array<{ schema: string; table: string }> });
  } catch (err: unknown) {
    req.log.warn({ err }, "source pg connect failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Connection failed" });
  } finally {
    await client.end().catch(() => {});
  }
});

interface PostgresImportBody extends PostgresConnInput {
  tables: Array<{ schema: string; table: string }>;
}

router.post("/projects/:id/ingest/postgres/import", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const cfg = readPgConn(req.body);
  if ("error" in cfg) { res.status(400).json({ error: cfg.error }); return; }

  const tables = ((req.body as PostgresImportBody)?.tables ?? []) as Array<{ schema: string; table: string }>;
  if (!Array.isArray(tables) || tables.length === 0) {
    res.status(400).json({ error: "tables must be a non-empty array" });
    return;
  }
  for (const t of tables) {
    if (!isSafeIdentifier(t.schema) || !isSafeIdentifier(t.table)) {
      res.status(400).json({ error: `Invalid table name: ${t.schema}.${t.table}` });
      return;
    }
  }

  try {
    await ensureProjectDb(projectId, req.log);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not provision project database" });
    return;
  }

  const src = makeSourceClient(cfg);
  const imported: Array<{ tableName: string; datasetId: number; rowCount: number }> = [];

  try {
    await src.connect();
    const existingNames = new Set<string>((await listRawTables(projectId).catch(() => [])).map((t) => t.tableName));

    for (const { schema, table } of tables) {
      const colResult = await src.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table],
      );
      const srcCols = colResult.rows as Array<{ column_name: string; data_type: string }>;
      if (srcCols.length === 0) continue;

      const usedPgNames = new Set<string>(["_row_id"]);
      const colSchema: DatasetColumn[] = srcCols.map((c) => {
        let pgName = toPgName(c.column_name);
        let cand = pgName;
        let i = 2;
        while (usedPgNames.has(cand)) cand = `${pgName}_${i++}`;
        usedPgNames.add(cand);
        const pgType: DatasetColumn["pgType"] = (() => {
          const t = c.data_type.toLowerCase();
          if (t.includes("int") || t.includes("numeric") || t.includes("decimal") || t.includes("float") || t.includes("real") || t.includes("double") || t === "serial" || t === "bigserial") return "NUMERIC";
          if (t.includes("bool")) return "BOOLEAN";
          if (t.includes("date") || t.includes("timestamp")) return "TIMESTAMPTZ";
          return "TEXT";
        })();
        const type: DatasetColumn["type"] = pgType === "NUMERIC" ? "number" : pgType === "BOOLEAN" ? "boolean" : pgType === "TIMESTAMPTZ" ? "date" : "string";
        return { originalName: c.column_name, pgName: cand, type, pgType, nullCount: 0, uniqueCount: 0 };
      });

      const rowResult = await src.query(`SELECT * FROM "${schema}"."${table}"`);
      const sourceRows = rowResult.rows as Record<string, unknown>[];

      const tableName = makeRawTableName(schema, table, existingNames);
      const colDefs = colSchema.map((c) => `${quoteIdent(c.pgName)} ${c.pgType}`).join(", ");
      const destQualified = `${quoteIdent(rawSchema(projectId))}.${quoteIdent(tableName)}`;
      const destClient = await masterPool.connect();
      try {
        await destClient.query(`DROP TABLE IF EXISTS ${destQualified}`);
        await destClient.query(`CREATE TABLE ${destQualified} (_row_id SERIAL PRIMARY KEY, ${colDefs})`);
        const BATCH = 500;
        const colNames = colSchema.map((c) => quoteIdent(c.pgName)).join(", ");
        for (let offset = 0; offset < sourceRows.length; offset += BATCH) {
          const batch = sourceRows.slice(offset, offset + BATCH);
          if (batch.length === 0) continue;
          const placeholders: string[] = [];
          const values: unknown[] = [];
          let paramIdx = 1;
          for (const row of batch) {
            const rp = colSchema.map(() => `$${paramIdx++}`);
            placeholders.push(`(${rp.join(", ")})`);
            for (const c of colSchema) values.push(row[c.originalName] ?? null);
          }
          await destClient.query(
            `INSERT INTO ${destQualified} (${colNames}) VALUES ${placeholders.join(", ")}`,
            values,
          );
        }
      } finally {
        destClient.release();
      }

      const fullyQualified = `${rawSchema(projectId)}.${tableName}`;
      const [meta] = await db
        .insert(datasetsTable)
        .values({
          workspaceId: projectId,
          fileName: table,
          sheetName: schema,
          tableName: fullyQualified,
          columnSchema: colSchema,
          rowCount: sourceRows.length,
        })
        .returning();
      imported.push({ tableName, datasetId: meta.id, rowCount: sourceRows.length });
    }
    res.status(201).json({ imported });
  } catch (err: unknown) {
    req.log.error({ err, projectId }, "Postgres import failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  } finally {
    await src.end().catch(() => {});
  }
});

// ─── Google Sheets source (real OAuth via /auth flow) ─────────────────────

import { google } from "googleapis";
import { getValidToken } from "../auth";

function makeGoogleAuth(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function requireGoogleAuth(req: Request, res: Response): number | null {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({
      error: "Not signed in with Google.",
      action: "google-signin",
      authUrl: "/auth",
    });
    return null;
  }
  return userId;
}

router.get("/projects/:id/ingest/google-sheets/files", async (req: Request, res: Response) => {
  const userId = requireGoogleAuth(req, res);
  if (userId === null) return;

  try {
    const token = await getValidToken(userId);
    const drive = google.drive({ version: "v3", auth: makeGoogleAuth(token) });
    const q = String(req.query.q ?? "").trim().slice(0, 80).replace(/[^\p{L}\p{N} ._-]/gu, "");
    const driveQuery = [
      "mimeType='application/vnd.google-apps.spreadsheet'",
      "trashed=false",
      ...(q ? [`name contains '${q}'`] : []),
    ].join(" and ");

    const result = await drive.files.list({
      q: driveQuery,
      fields: "files(id,name,modifiedTime,owners(displayName))",
      pageSize: 50,
      orderBy: "modifiedTime desc",
      spaces: "drive",
    });
    res.json({ files: result.data.files ?? [] });
  } catch (err: unknown) {
    req.log.error({ err }, "sheets list failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not list spreadsheets" });
  }
});

router.post("/projects/:id/ingest/google-sheets/import", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const userId = requireGoogleAuth(req, res);
  if (userId === null) return;

  const fileId = String((req.body as { fileId?: string })?.fileId ?? "").trim();
  const fileName = String((req.body as { fileName?: string })?.fileName ?? "google_sheet").trim();
  if (!fileId) { res.status(400).json({ error: "fileId is required" }); return; }

  try {
    await ensureProjectDb(projectId, req.log);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not provision project database" });
    return;
  }

  try {
    const token = await getValidToken(userId);
    const auth = makeGoogleAuth(token);
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    // Fetch the spreadsheet metadata so we know each sheet's name.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: "sheets(properties(title))" });
    const sheetTitles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => !!t);

    if (sheetTitles.length === 0) {
      res.status(400).json({ error: "Spreadsheet has no readable sheets" });
      return;
    }

    // Use the Drive file name if the caller didn't pass one
    let resolvedFileName = fileName;
    if (!resolvedFileName || resolvedFileName === "google_sheet") {
      try {
        const driveMeta = await drive.files.get({ fileId, fields: "name" });
        resolvedFileName = driveMeta.data.name ?? fileName;
      } catch { /* keep fallback */ }
    }

    const existingNames = new Set<string>((await listRawTables(projectId).catch(() => [])).map((t) => t.tableName));
    const imported: Array<{ sheetName: string; tableName: string; datasetId: number; rowCount: number }> = [];

    for (const sheetTitle of sheetTitles) {
      const valuesResp = await sheets.spreadsheets.values.get({
        spreadsheetId: fileId,
        range: sheetTitle,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });
      const rows = (valuesResp.data.values ?? []) as unknown[][];
      if (rows.length < 2) continue;

      // Convert the array-of-arrays into the analyzeSheet shape (XLSX worksheet
      // representation) so we can reuse the same persistence pipeline.
      const headers = rows[0].map((h) => String(h ?? ""));
      const data = rows.slice(1).map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => { obj[h || `col_${i}`] = row[i] ?? null; });
        return obj;
      });
      // Mock a XLSX.WorkSheet by using the array-of-objects directly.
      const aoaSheet = XLSX.utils.json_to_sheet(data, { header: headers });
      const analyzed = analyzeSheet(aoaSheet, sheetTitle);
      if (analyzed.rowCount === 0) continue;

      const tableName = makeRawTableName(resolvedFileName, sheetTitle, existingNames);
      const result = await persistSheetToProjectDb(projectId, analyzed, resolvedFileName, tableName, req.log);
      imported.push({ sheetName: sheetTitle, tableName: result.tableName, datasetId: result.datasetId, rowCount: result.rowCount });
    }

    res.status(201).json({ imported });
  } catch (err: unknown) {
    req.log.error({ err, projectId }, "Sheets import failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// ─── Introspection ────────────────────────────────────────────────────────

router.get("/projects/:id/raw-tables", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    await ensureProjectDb(projectId, req.log);
    const rows = await listRawTables(projectId);
    res.json({ tables: rows });
  } catch (err: unknown) {
    req.log.warn({ err, projectId }, "list raw tables failed");
    res.json({ tables: [] });
  }
});

router.get("/projects/:id/raw-tables/:tableName/preview", async (req: Request, res: Response) => {
  const projectId = parseId(req.params.id as string);
  if (projectId === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const tableName = req.params.tableName as string;
  if (!isSafeIdentifier(tableName)) { res.status(400).json({ error: "Invalid table name" }); return; }
  try {
    const qualified = `${quoteIdent(rawSchema(projectId))}.${quoteIdent(tableName)}`;
    const result = await masterPool.query(`SELECT * FROM ${qualified} LIMIT 30`);
    res.json({ rows: result.rows, fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) });
  } catch (err: unknown) {
    req.log.warn({ err, projectId, tableName }, "preview failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Preview failed" });
  }
});

export default router;
