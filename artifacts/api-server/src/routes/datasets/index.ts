import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool, datasets as datasetsTable } from "@workspace/db";
import type { DatasetColumn } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function serializeDataset(d: typeof datasetsTable.$inferSelect) {
  return {
    id: d.id,
    workspaceId: d.projectId,
    fileName: d.fileName,
    sheetName: d.sheetName,
    tableName: d.tableName,
    rowCount: d.rowCount,
    columns: (d.columnSchema as DatasetColumn[]).map((c) => ({
      name: c.originalName,
      type: c.type,
    })),
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/datasets", async (req: Request, res: Response) => {
  const wid = req.query.workspaceId ? parseInt(String(req.query.workspaceId), 10) : null;
  const rows = await db
    .select()
    .from(datasetsTable)
    .where(wid !== null && Number.isFinite(wid) ? eq(datasetsTable.projectId, wid) : undefined)
    .orderBy(desc(datasetsTable.createdAt));
  res.json(rows.map(serializeDataset));
});

router.get("/datasets/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dataset ID" }); return; }
  const [row] = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }

  const cols = row.columnSchema as DatasetColumn[];
  // Return first 100 rows as preview
  const client = await pool.connect();
  let sampleRows: Record<string, unknown>[] = [];
  try {
    const result = await client.query(
      `SELECT * FROM "${row.tableName}" LIMIT 100`
    );
    // Re-map pg column names back to original names
    const nameMap = new Map(cols.map((c) => [c.pgName, c.originalName]));
    sampleRows = result.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === "_row_id") continue;
        out[nameMap.get(k) ?? k] = v;
      }
      return out;
    });
  } finally {
    client.release();
  }

  res.json({
    ...serializeDataset(row),
    columns: cols.map((c) => ({
      name: c.originalName,
      pgName: c.pgName,
      type: c.type,
      nullCount: c.nullCount,
      uniqueCount: c.uniqueCount,
      min: c.min,
      max: c.max,
      mean: c.mean,
    })),
    sampleRows,
  });
});

// NL-to-SQL query endpoint
router.post("/datasets/:id/query", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dataset ID" }); return; }
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (question.length < 3 || question.length > 1000) {
    res.status(400).json({ error: "question must be between 3 and 1000 characters" });
    return;
  }

  const [dataset] = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.id, id))
    .limit(1);

  if (!dataset) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }

  const cols = dataset.columnSchema as DatasetColumn[];
  const schemaDescription = cols
    .map((c) => `  "${c.pgName}" ${c.pgType}  -- original: "${c.originalName}"`)
    .join("\n");

  const systemPrompt = `You are a PostgreSQL expert. Given a table schema, write a single read-only SELECT query to answer the user's question.

Rules:
1. Return ONLY the SQL query — no explanation, no markdown, no code block fences.
2. Use only the exact column names listed in the schema (the pg names, not original names).
3. Always include a LIMIT clause of at most 1000 rows.
4. Only use SELECT statements — no INSERT, UPDATE, DELETE, DROP, CREATE, or any DDL/DML.
5. The table name is "${dataset.tableName}" — use it exactly as given with double quotes.

Table schema:
CREATE TABLE "${dataset.tableName}" (
  _row_id SERIAL PRIMARY KEY,
${schemaDescription}
);`;

  req.log.info({ datasetId: id, question }, "NL-to-SQL query started");
  const t0 = Date.now();

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    max_completion_tokens: 512,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
  });

  const rawSql = (response.choices[0]?.message?.content ?? "").trim();

  // Safety: reject anything that isn't a SELECT
  const firstWord = rawSql.replace(/^\s*\/\*[\s\S]*?\*\/\s*/g, "").trim().split(/\s+/)[0]?.toUpperCase();
  if (firstWord !== "SELECT") {
    req.log.warn({ rawSql }, "NL-to-SQL rejected non-SELECT query");
    res.status(400).json({ error: "Only SELECT queries are allowed" });
    return;
  }

  // Extra guard: must reference our table, not others
  if (!rawSql.includes(dataset.tableName)) {
    req.log.warn({ rawSql, tableName: dataset.tableName }, "NL-to-SQL query references wrong table");
    res.status(400).json({ error: "Query must reference the correct dataset table" });
    return;
  }

  const client = await pool.connect();
  let results: Record<string, unknown>[] = [];
  let columns: string[] = [];
  try {
    // 2-second statement timeout for safety
    await client.query("SET statement_timeout = 2000");
    const result = await client.query(rawSql);
    columns = result.fields.map((f: { name: string }) => f.name);
    // Re-map pg column names to original names for display
    const nameMap = new Map(cols.map((c) => [c.pgName, c.originalName]));
    results = result.rows.map((r: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === "_row_id") continue;
        out[nameMap.get(k) ?? k] = v;
      }
      return out;
    });
    columns = columns
      .filter((c) => c !== "_row_id")
      .map((c) => nameMap.get(c) ?? c);
  } finally {
    client.release();
  }

  req.log.info(
    { datasetId: id, durationMs: Date.now() - t0, resultRows: results.length },
    "NL-to-SQL query complete"
  );

  res.json({ question, sql: rawSql, columns, results });
});

router.delete("/datasets/:id", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid dataset ID" }); return; }
  const [dataset] = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.id, id))
    .limit(1);

  if (!dataset) {
    res.status(404).json({ error: "Dataset not found" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS "${dataset.tableName}"`);
  } finally {
    client.release();
  }

  await db.delete(datasetsTable).where(eq(datasetsTable.id, id));
  req.log.info({ datasetId: id, tableName: dataset.tableName }, "Dataset deleted");
  res.status(204).send();
});

export default router;
