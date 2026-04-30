import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  sheetName: text("sheet_name").notNull(),
  byteSize: integer("byte_size").notNull().default(0),
  rowCount: integer("row_count").notNull().default(0),
  returnedRowCount: integer("returned_row_count").notNull().default(0),
  truncated: boolean("truncated").notNull().default(false),
  readinessScore: integer("readiness_score").notNull().default(0),
  issues: jsonb("issues").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const datasetColumns = pgTable("dataset_columns", {
  id: serial("id").primaryKey(),
  datasetId: integer("dataset_id")
    .notNull()
    .references(() => datasets.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  name: text("name").notNull(),
  // Detected raw type from XLSX parsing (number/string/date/boolean/mixed).
  rawType: text("raw_type").notNull().default("string"),
  // Inferred semantic type (date/currency/percent/id/category/measure/text).
  semanticType: text("semantic_type").notNull().default("text"),
  // Inferred business meaning, e.g. "Order date", "Revenue", "Customer id".
  businessMeaning: text("business_meaning"),
  uniqueCount: integer("unique_count").notNull().default(0),
  nullCount: integer("null_count").notNull().default(0),
  sample: jsonb("sample").notNull().default([]),
  stats: jsonb("stats"),
  // Whether the user has overridden the inferred values.
  overriddenSemantic: boolean("overridden_semantic").notNull().default(false),
  overriddenMeaning: boolean("overridden_meaning").notNull().default(false),
});

export const datasetRows = pgTable("dataset_rows", {
  datasetId: integer("dataset_id")
    .primaryKey()
    .references(() => datasets.id, { onDelete: "cascade" }),
  rows: jsonb("rows").notNull().default([]),
});

export type Dataset = typeof datasets.$inferSelect;
export type DatasetColumn = typeof datasetColumns.$inferSelect;
export type DatasetRows = typeof datasetRows.$inferSelect;
