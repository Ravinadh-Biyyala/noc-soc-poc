import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { preparedDatasets } from "./prepared-datasets";

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  preparedDatasetId: integer("prepared_dataset_id").references(
    () => preparedDatasets.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  description: text("description"),
  formula: text("formula").notNull(),
  format: text("format").notNull().default("number"),
  status: text("status").notNull().default("ai_suggested"),
  owner: text("owner").notNull().default("You"),
  source: text("source").notNull().default("ai"),
  auditLog: jsonb("audit_log").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Metric = typeof metrics.$inferSelect;
