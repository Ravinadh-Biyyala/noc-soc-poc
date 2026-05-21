import { pgTable, serial, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export interface ChartConfig {
  xKey?: string;
  yKey?: string | string[];
  data: Record<string, unknown>[];
  sql?: string;
  question?: string;
  subtitle?: string;
}

export const userDashboards = pgTable("user_dashboards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  flatTableName: text("flat_table_name").notNull().unique(),
  sourceDatasetIds: jsonb("source_dataset_ids").$type<number[]>().notNull(),
  rowCount: integer("row_count").notNull().default(0),
  status: text("status").notNull().default("ready"),
  agentLog: text("agent_log"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dashboardCharts = pgTable("dashboard_charts", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id")
    .references(() => userDashboards.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  chartType: text("chart_type").notNull(),
  config: jsonb("config").$type<ChartConfig>().notNull(),
  position: integer("position").notNull().default(0),
  colSpan: integer("col_span").default(1),
  hidden: boolean("hidden").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserDashboard = typeof userDashboards.$inferSelect;
export type DashboardChart = typeof dashboardCharts.$inferSelect;
