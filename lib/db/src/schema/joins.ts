import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  real,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { datasets } from "./datasets";

export const joins = pgTable("joins", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  leftDatasetId: integer("left_dataset_id")
    .notNull()
    .references(() => datasets.id, { onDelete: "cascade" }),
  rightDatasetId: integer("right_dataset_id")
    .notNull()
    .references(() => datasets.id, { onDelete: "cascade" }),
  leftColumn: text("left_column").notNull(),
  rightColumn: text("right_column").notNull(),
  joinType: text("join_type").notNull().default("inner"),
  status: text("status").notNull().default("accepted"),
  confidence: real("confidence").notNull().default(0),
  matchRate: real("match_rate").notNull().default(0),
  unmatchedCount: integer("unmatched_count").notNull().default(0),
  source: text("source").notNull().default("ai"),
  options: jsonb("options").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Join = typeof joins.$inferSelect;
