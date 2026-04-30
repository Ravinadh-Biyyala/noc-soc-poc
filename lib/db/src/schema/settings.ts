import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  // userId is hardcoded to "default" while there is no auth layer; once auth
  // ships this should be the authenticated user's id (one row per user is
  // already enforced by the unique constraint).
  userId: text("user_id").notNull().unique().default("default"),
  // Organization
  organizationName: text("organization_name"),
  profileName: text("profile_name"),
  profileEmail: text("profile_email"),
  timezone: text("timezone").notNull().default("UTC"),
  // Theme
  theme: text("theme").notNull().default("light"),
  // File limits
  fileSizeLimitMb: integer("file_size_limit_mb").notNull().default(60),
  // Readiness gating threshold (0-100). Files below this score block
  // "Continue to Join Studio" unless the user uses the soft override.
  readinessThreshold: integer("readiness_threshold").notNull().default(60),
  // Domain packs
  defaultPackId: text("default_pack_id"),
  // AI behaviour
  aiTone: text("ai_tone").notNull().default("balanced"),
  aiModel: text("ai_model").notNull().default("gpt-4.1-mini"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
