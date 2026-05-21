import { Router, type IRouter, type Request, type Response } from "express";
import { google } from "googleapis";
import { db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI,
  );
}

export async function getValidToken(userId: number): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  const nowMs = Date.now();
  // Refresh if token expires within 60 seconds
  if (user.tokenExpiry && user.tokenExpiry > nowMs + 60_000) {
    return user.accessToken!;
  }

  const oauth2Client = makeOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: user.refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();

  await db
    .update(users)
    .set({
      accessToken: credentials.access_token ?? user.accessToken,
      tokenExpiry: credentials.expiry_date ?? user.tokenExpiry,
    })
    .where(eq(users.id, userId));

  return credentials.access_token!;
}

router.get("/auth", (_req: Request, res: Response) => {
  const oauth2Client = makeOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  res.redirect(url);
});

router.get("/auth/callback", async (req: Request, res: Response) => {
  const code = String(req.query.code ?? "").trim();
  if (!code) {
    res.status(400).send("Missing code parameter");
    return;
  }

  try {
    const oauth2Client = makeOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email;
    if (!email) {
      res.status(400).send("Could not retrieve email from Google");
      return;
    }

    const [upserted] = await db
      .insert(users)
      .values({
        email,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiry: tokens.expiry_date ?? null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          accessToken: tokens.access_token ?? null,
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
          tokenExpiry: tokens.expiry_date ?? null,
        },
      })
      .returning({ id: users.id });

    req.session.userId = upserted.id;

    const frontendOrigin =
      process.env.CORS_ORIGIN ??
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
    res.redirect(`${frontendOrigin}/?google_connected=1`);
  } catch (err: unknown) {
    req.log.error({ err }, "OAuth callback error");
    res.status(500).send("Authentication failed. Please try again.");
  }
});

router.get("/auth/status", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) {
    res.json({ authenticated: false });
    return;
  }
  try {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, email: user.email });
  } catch {
    res.json({ authenticated: false });
  }
});

router.get("/auth/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
