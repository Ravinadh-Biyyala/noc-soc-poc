import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().default("default"),
  profileName: text("profile_name"),
  profileEmail: text("profile_email"),
  timezone: text("timezone").notNull().default("UTC"),
  theme: text("theme").notNull().default("light"),
  defaultPackId: text("default_pack_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
