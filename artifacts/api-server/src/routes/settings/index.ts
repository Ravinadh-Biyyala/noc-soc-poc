import { Router, type IRouter, type Request, type Response } from "express";
import { db, settings as settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { invalidateSystemPromptCache } from "../../config/prompt-builder.js";

// Single-row settings keyed by user id. There is no auth layer yet, so all
// requests share the "default" row. Once auth ships, swap this for the
// authenticated user's id and the `unique` constraint on `userId` will keep
// settings keyed per user automatically.
const DEFAULT_USER_ID = "default";

const router: IRouter = Router();

function serialize(s: typeof settingsTable.$inferSelect) {
  return {
    id: s.id,
    userId: s.userId,
    organizationName: s.organizationName,
    profileName: s.profileName,
    profileEmail: s.profileEmail,
    timezone: s.timezone,
    theme: s.theme,
    fileSizeLimitMb: s.fileSizeLimitMb,
    defaultPackId: s.defaultPackId,
    aiTone: s.aiTone,
    aiModel: s.aiModel,
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function getOrCreate() {
  const [existing] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.userId, DEFAULT_USER_ID))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(settingsTable)
    .values({ userId: DEFAULT_USER_ID })
    .returning();
  return created;
}

router.get("/settings", async (_req: Request, res: Response) => {
  const row = await getOrCreate();
  res.json(serialize(row));
});

router.patch("/settings", async (req: Request, res: Response) => {
  const body = UpdateSettingsBody.parse(req.body);
  await getOrCreate();
  const [updated] = await db
    .update(settingsTable)
    .set({
      ...(body.organizationName !== undefined ? { organizationName: body.organizationName } : {}),
      ...(body.profileName !== undefined ? { profileName: body.profileName } : {}),
      ...(body.profileEmail !== undefined ? { profileEmail: body.profileEmail } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.fileSizeLimitMb !== undefined ? { fileSizeLimitMb: body.fileSizeLimitMb } : {}),
      ...(body.defaultPackId !== undefined ? { defaultPackId: body.defaultPackId } : {}),
      ...(body.aiTone !== undefined ? { aiTone: body.aiTone } : {}),
      ...(body.aiModel !== undefined ? { aiModel: body.aiModel } : {}),
      updatedAt: new Date(),
    })
    .where(eq(settingsTable.userId, DEFAULT_USER_ID))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }

  // AI behaviour may have changed — invalidate the cached system prompt
  invalidateSystemPromptCache();
  res.json(serialize(updated));
});

export default router;
