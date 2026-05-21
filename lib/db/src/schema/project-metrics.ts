import { pgTable, serial, text, integer, jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export type MetricStatus = "proposed" | "applied" | "rejected";

export const projectMetrics = pgTable("project_metrics", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  metricName: varchar("metric_name", { length: 128 }).notNull(),
  description: text("description"),
  sqlFormula: text("sql_formula").notNull(),
  dependsOnTables: jsonb("depends_on_tables").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 32 }).notNull().default("proposed"),
  agentRationale: text("agent_rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectMetric = typeof projectMetrics.$inferSelect;
export type InsertProjectMetric = typeof projectMetrics.$inferInsert;
