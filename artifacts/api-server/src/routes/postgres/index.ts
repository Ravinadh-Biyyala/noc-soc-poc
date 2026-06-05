import { Router, type IRouter, type Request, type Response } from "express";
import { Client } from "pg";
import { db, pool } from "@workspace/db";
import { datasets } from "@workspace/db";
import type { DatasetColumn } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { randomUUID } from "node:crypto";
import type { PgConnConfig } from "../../types/session";

const router: IRouter = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

function makeClient(cfg: PgConnConfig): Client {
  return new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl === "disable" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
}

function requireConn(req: Request, res: Response): PgConnConfig | null {
  const conn = req.session.pgConn;
  if (!conn) {
    res.status(401).json({ error: "No Postgres connection in session. Connect first via POST /api/postgres/connect." });
    return null;
  }
  return conn;
}

/** Reject names with anything other than letters, digits, underscores. */
function isSafeIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/** Convert a Postgres column type string to the DatasetColumn pgType */
function mapPgType(dataType: string): DatasetColumn["pgType"] {
  const t = dataType.toLowerCase();
  if (t.includes("int") || t === "serial" || t === "bigserial") return "NUMERIC";
  if (t.includes("numeric") || t.includes("decimal") || t.includes("float") ||
      t.includes("real") || t.includes("double")) return "NUMERIC";
  if (t.includes("bool")) return "BOOLEAN";
  if (t.includes("date") || t.includes("timestamp")) return "TIMESTAMPTZ";
  return "TEXT";
}

function mapType(dataType: string): DatasetColumn["type"] {
  const pg = mapPgType(dataType);
  if (pg === "NUMERIC") return "number";
  if (pg === "BOOLEAN") return "boolean";
  if (pg === "TIMESTAMPTZ") return "date";
  return "string";
}

/** Convert any string to a safe snake_case Postgres identifier */
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

// ── POST /postgres/connect ────────────────────────────────────────────────────

router.post("/postgres/connect", async (req: Request, res: Response) => {
  const body = req.body as {
    host?: unknown; port?: unknown; database?: unknown;
    username?: unknown; password?: unknown; ssl?: unknown;
  };

  const host = String(body.host ?? "").trim();
  const port = parseInt(String(body.port ?? "5432"), 10) || 5432;
  const database = String(body.database ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const ssl = (["require", "prefer", "disable"].includes(String(body.ssl ?? ""))
    ? String(body.ssl)
    : "prefer") as PgConnConfig["ssl"];

  if (!host || !database || !username) {
    res.status(400).json({ error: "host, database, and username are required" });
    return;
  }

  const cfg: PgConnConfig = { host, port, database, username, password, ssl };
  const client = makeClient(cfg);

  try {
    await client.connect();
    const result = await client.query(
      `SELECT count(*)::int AS cnt
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog','information_schema')
         AND table_type = 'BASE TABLE'`
    );
    const tableCount: number = (result.rows[0] as { cnt: number }).cnt ?? 0;

    req.session.pgConn = cfg;
    req.session.save(() => {});

    req.log.info({ host, database, tableCount }, "Postgres connection established");
    res.json({ ok: true, database, tableCount });
  } catch (err: unknown) {
    req.log.warn({ err }, "Postgres connect failed");
    const msg = err instanceof Error ? err.message : "Connection failed";
    res.status(400).json({ error: msg });
  } finally {
    client.end().catch(() => {});
  }
});

// ── GET /postgres/tables ──────────────────────────────────────────────────────

router.get("/postgres/tables", async (req: Request, res: Response) => {
  const cfg = requireConn(req, res);
  if (!cfg) return;

  const client = makeClient(cfg);
  try {
    await client.connect();
    const result = await client.query(`
      SELECT table_schema AS schema, table_name AS table
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);
    res.json({ tables: result.rows as { schema: string; table: string }[] });
  } catch (err: unknown) {
    req.log.error({ err }, "postgres list tables error");
    res.status(500).json({ error: "Could not list tables" });
  } finally {
    client.end().catch(() => {});
  }
});

// ── GET /postgres/tables/:schema/:table/preview ───────────────────────────────

router.get("/postgres/tables/:schema/:table/preview", async (req: Request, res: Response) => {
  const cfg = requireConn(req, res);
  if (!cfg) return;

  const schema = req.params.schema as string;
  const table = req.params.table as string;

  if (!isSafeIdentifier(schema) || !isSafeIdentifier(table)) {
    res.status(400).json({ error: "Invalid schema or table name" });
    return;
  }

  const client = makeClient(cfg);
  try {
    await client.connect();

    const colResult = await client.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table]
    );
    const columns = (colResult.rows as { column_name: string; data_type: string; is_nullable: string }[])
      .map((r) => ({ name: r.column_name, type: r.data_type }));

    const rowResult = await client.query(`SELECT * FROM "${schema}"."${table}" LIMIT 20`);
    res.json({ columns, rows: rowResult.rows });
  } catch (err: unknown) {
    req.log.error({ err }, "postgres preview error");
    res.status(500).json({ error: "Could not preview table" });
  } finally {
    client.end().catch(() => {});
  }
});

// ── POST /postgres/recommendations ───────────────────────────────────────────

router.post("/postgres/recommendations", async (req: Request, res: Response) => {
  const body = req.body as {
    tables?: { schema: string; table: string; columns: { name: string; type: string }[] }[];
  };

  if (!Array.isArray(body.tables) || body.tables.length < 1) {
    res.status(400).json({ error: "tables array is required" });
    return;
  }

  const tableDescriptions = body.tables
    .map((t) => {
      const cols = t.columns.map((c) => `  ${c.name} (${c.type})`).join("\n");
      return `Table: ${t.schema}.${t.table}\nColumns:\n${cols}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a data analyst. Analyze the given PostgreSQL table schemas and return ONLY valid JSON (no markdown) with:
{
  "joinRecommendations": [
    { "leftTable": "schema.table", "leftCol": "col", "rightTable": "schema.table", "rightCol": "col", "confidence": "high|medium|low", "reason": "short reason" }
  ],
  "analysisIdeas": [
    { "title": "short title", "question": "plain English question", "chartType": "bar|line|pie|scatter|kpi|table" }
  ]
}
Rules:
- joinRecommendations: find matching column names/types that suggest a foreign key (e.g. owner_id, customer_id, id). If only 1 table, leave array empty.
- analysisIdeas: exactly 5 items that would be interesting to visualize given these tables. Focus on metrics, trends, and comparisons.
- chartType: bar for comparisons, line for trends, pie for distributions, scatter for correlations, kpi for single values, table for detail rows.`;

  try {
    const aiResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Tables:\n\n${tableDescriptions}` },
      ],
      response_format: { type: "json_object" },
    });

    const raw = (aiResponse.choices[0]?.message?.content ?? "{}").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err: unknown) {
    req.log.error({ err }, "postgres recommendations error");
    res.status(500).json({ error: "Could not generate recommendations" });
  }
});

// ── POST /postgres/import ─────────────────────────────────────────────────────

router.post("/postgres/import", async (req: Request, res: Response) => {
  const cfg = requireConn(req, res);
  if (!cfg) return;

  const body = req.body as {
    tables?: { schema: string; table: string }[];
    workspaceId?: unknown;
  };

  if (!Array.isArray(body.tables) || body.tables.length === 0) {
    res.status(400).json({ error: "tables must be a non-empty array" });
    return;
  }

  for (const t of body.tables) {
    if (!isSafeIdentifier(t.schema) || !isSafeIdentifier(t.table)) {
      res.status(400).json({ error: `Invalid table name: ${t.schema}.${t.table}` });
      return;
    }
  }

  const workspaceId =
    typeof body.workspaceId === "number" && Number.isFinite(body.workspaceId)
      ? body.workspaceId
      : null;

  const srcClient = makeClient(cfg);
  const datasetIds: number[] = [];

  try {
    await srcClient.connect();
    req.log.info({ tables: body.tables }, "Starting Postgres import");

    for (const { schema, table } of body.tables) {
      // 1. Get column schema from source DB
      const colResult = await srcClient.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );
      const srcCols = colResult.rows as { column_name: string; data_type: string }[];

      if (srcCols.length === 0) {
        req.log.warn({ schema, table }, "No columns found — skipping");
        continue;
      }

      // 2. Build sanitized column mapping
      const usedNames = new Set<string>(["_row_id"]);
      const colSchema: DatasetColumn[] = srcCols.map((c) => {
        let pgName = toSnakeCase(c.column_name);
        if (usedNames.has(pgName)) pgName = pgName + "_1";
        usedNames.add(pgName);
        return {
          originalName: c.column_name,
          pgName,
          type: mapType(c.data_type),
          pgType: mapPgType(c.data_type),
          nullCount: 0,
          uniqueCount: 0,
        };
      });

      // 3. Fetch all rows from source
      const rowResult = await srcClient.query(`SELECT * FROM "${schema}"."${table}"`);
      const sourceRows = rowResult.rows as Record<string, unknown>[];

      // 4. Create destination table in app's DB
      const destTableName = `ds_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const colDefs = colSchema
        .map((c) => `"${c.pgName}" ${c.pgType}`)
        .join(", ");

      const appClient = await pool.connect();
      try {
        await appClient.query(
          `CREATE TABLE "${destTableName}" (_row_id SERIAL PRIMARY KEY, ${colDefs})`
        );

        // 5. Batch insert (500 rows per batch)
        const BATCH = 500;
        const colNames = colSchema.map((c) => `"${c.pgName}"`).join(", ");
        for (let offset = 0; offset < sourceRows.length; offset += BATCH) {
          const batch = sourceRows.slice(offset, offset + BATCH);
          if (batch.length === 0) continue;

          const placeholders: string[] = [];
          const values: unknown[] = [];
          let paramIdx = 1;

          for (const row of batch) {
            const rowPlaceholders = colSchema.map(() => `$${paramIdx++}`);
            placeholders.push(`(${rowPlaceholders.join(", ")})`);
            for (const c of colSchema) {
              const raw = row[c.originalName];
              values.push(raw === undefined ? null : raw);
            }
          }

          await appClient.query(
            `INSERT INTO "${destTableName}" (${colNames}) VALUES ${placeholders.join(", ")}`,
            values
          );
        }

        // 6. Register in datasets table
        const [dataset] = await db
          .insert(datasets)
          .values({
            projectId: workspaceId ?? undefined,
            fileName: table,
            sheetName: schema,
            tableName: destTableName,
            columnSchema: colSchema,
            rowCount: sourceRows.length,
          })
          .returning();

        datasetIds.push(dataset.id);
        req.log.info(
          { destTableName, rowCount: sourceRows.length, datasetId: dataset.id },
          `Imported ${schema}.${table}`
        );
      } finally {
        appClient.release();
      }
    }

    res.status(201).json({ datasetIds });
  } catch (err: unknown) {
    req.log.error({ err }, "postgres import error");
    res.status(500).json({ error: "Import failed", detail: err instanceof Error ? err.message : String(err) });
  } finally {
    srcClient.end().catch(() => {});
  }
});

export default router;
