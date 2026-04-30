import { Router, type IRouter, type Request, type Response } from "express";
import { db, settings as settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";

const DEFAULT_USER_ID = "default";

const router: IRouter = Router();

function serialize(s: typeof settingsTable.$inferSelect) {
  return {
    id: s.id,
    userId: s.userId,
    profileName: s.profileName,
    profileEmail: s.profileEmail,
    timezone: s.timezone,
    theme: s.theme,
    defaultPackId: s.defaultPackId,
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
      ...(body.profileName !== undefined ? { profileName: body.profileName } : {}),
      ...(body.profileEmail !== undefined ? { profileEmail: body.profileEmail } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.defaultPackId !== undefined ? { defaultPackId: body.defaultPackId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(settingsTable.userId, DEFAULT_USER_ID))
    .returning();
  res.json(serialize(updated));
});

export default router;
