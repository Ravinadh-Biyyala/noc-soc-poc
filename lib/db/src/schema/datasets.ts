import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export interface DatasetColumn {
  originalName: string;
  pgName: string;   // sanitized PostgreSQL column name
  type: "number" | "string" | "date" | "boolean" | "mixed";
  pgType: "NUMERIC" | "TEXT" | "TIMESTAMPTZ" | "BOOLEAN";
  nullCount: number;
  uniqueCount: number;
  min?: number;
  max?: number;
  mean?: number;
}

export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  sheetName: text("sheet_name").notNull(),
  tableName: text("table_name").notNull().unique(),
  columnSchema: jsonb("column_schema").$type<DatasetColumn[]>().notNull(),
  rowCount: integer("row_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Dataset = typeof datasets.$inferSelect;
