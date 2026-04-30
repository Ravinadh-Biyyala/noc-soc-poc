import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { datasets } from "./datasets";

export const preparedDatasets = pgTable("prepared_datasets", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  baseDatasetId: integer("base_dataset_id")
    .notNull()
    .references(() => datasets.id, { onDelete: "cascade" }),
  joinIds: jsonb("join_ids").notNull().default([]),
  status: text("status").notNull().default("active"),
  /** Materialized output schema: ordered list of column names produced by chaining base + joins. */
  columns: jsonb("columns").notNull().default([]),
  /** Capped sample (first 100 joined rows) for previews and metric prompting. */
  sampleRows: jsonb("sample_rows").notNull().default([]),
  /** Total row count of the materialized join. */
  rowCount: integer("row_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PreparedDataset = typeof preparedDatasets.$inferSelect;
