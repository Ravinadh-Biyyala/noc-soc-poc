import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export type TransformationKind = "cleanse" | "join" | "aggregate" | "view" | "rename";
export type TransformationStatus = "proposed" | "accepted" | "applied" | "rejected";

export const projectTransformations = pgTable("project_transformations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sourceTables: jsonb("source_tables").$type<string[]>().notNull().default([]),
  sql: text("sql").notNull(),
  targetTableName: text("target_table_name").notNull(),
  status: text("status").notNull().default("proposed"),
  agentRationale: text("agent_rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

export type ProjectTransformation = typeof projectTransformations.$inferSelect;
export type InsertProjectTransformation = typeof projectTransformations.$inferInsert;
