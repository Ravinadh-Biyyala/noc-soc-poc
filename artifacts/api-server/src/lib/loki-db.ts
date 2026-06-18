// Dedicated Postgres connection for the Loki app's own metadata (pinned
// visuals). Lives in a SEPARATE database named `loki`, created automatically on
// first use. Uses node-postgres directly (no Drizzle) — the schema is one table.

import pg from "pg";
import { logger } from "./logger.js";

const { Pool, Client } = pg;

const DEFAULT_URL = "postgresql://postgres:postgres@localhost:5432/loki";

// Prefer an explicit LOKI_DATABASE_URL. Otherwise reuse DATABASE_URL's
// server/credentials but target a `loki` database (so no extra config is needed
// when a Postgres is already configured). Fall back to a localhost default.
function resolveLokiUrl(): string {
  if (process.env.LOKI_DATABASE_URL) return process.env.LOKI_DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/loki$1");
  return DEFAULT_URL;
}

const LOKI_DATABASE_URL = resolveLokiUrl();

let pool: pg.Pool | null = null;
let ensurePromise: Promise<void> | null = null;

function dbNameFromUrl(url: string): string {
  const m = url.match(/\/([^/?]+)(\?|$)/);
  return m ? decodeURIComponent(m[1]) : "loki";
}

// Quote a Postgres identifier (the db name can't be parameterized in CREATE DATABASE).
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function createDatabaseIfMissing(): Promise<void> {
  const dbName = dbNameFromUrl(LOKI_DATABASE_URL);
  // Connect to the `postgres` maintenance DB on the same server.
  const maintenanceUrl = LOKI_DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const client = new Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
      logger.info({ dbName }, "created loki database");
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function doEnsure(): Promise<void> {
  await createDatabaseIfMissing();
  pool = new Pool({
    connectionString: LOKI_DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pinned_visuals (
      id          text PRIMARY KEY,
      title       text NOT NULL,
      type        text NOT NULL,
      x_key       text NOT NULL,
      y_key       text NOT NULL,
      colors      jsonb,
      summary     text,
      logql       text,
      kind        text,
      since       text,
      transform   text,
      data        jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  logger.info("loki pinned_visuals table ready");
}

/** Idempotent: create the `loki` DB + `pinned_visuals` table once. Memoized so
 *  concurrent requests share one initialization; a failure clears the memo so a
 *  later request can retry. */
export function ensureLokiSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsure().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export async function lokiQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  await ensureLokiSchema();
  if (!pool) throw new Error("loki pool not initialized");
  return pool.query<T>(text, params as never[]);
}
