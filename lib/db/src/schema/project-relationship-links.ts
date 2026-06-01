import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/**
 * Join relationships discovered by the auto-mode Data Merging agent when it
 * decides NOT to materialise a flat table (e.g. an N:N or fan-out join that
 * would explode rows). Each row is one edge between two cleaned warehouse
 * tables; the downstream analysis agents read these to join on the fly.
 */
export const projectRelationshipLinks = pgTable("project_relationship_links", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  fromTable: text("from_table").notNull(),
  fromColumn: text("from_column").notNull(),
  toTable: text("to_table").notNull(),
  toColumn: text("to_column").notNull(),
  cardinality: varchar("cardinality", { length: 16 }).notNull().default("N:1"),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectRelationshipLink = typeof projectRelationshipLinks.$inferSelect;
export type InsertProjectRelationshipLink = typeof projectRelationshipLinks.$inferInsert;
