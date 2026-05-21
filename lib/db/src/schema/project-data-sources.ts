import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export type DataSourceKind = "upload" | "postgres" | "google-sheets";

export interface PostgresCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEncrypted: string;
  passwordIv: string;
  passwordAuthTag: string;
  sslMode?: "disable" | "require" | "prefer";
}

export interface GoogleSheetsCredentials {
  fileId: string;
  fileName: string;
}

export const projectDataSources = pgTable("project_data_sources", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  config: jsonb("config").$type<PostgresCredentials | GoogleSheetsCredentials | Record<string, unknown>>().notNull(),
  lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectDataSource = typeof projectDataSources.$inferSelect;
export type InsertProjectDataSource = typeof projectDataSources.$inferInsert;
