import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

/**
 * Salesforce integration for the Reports tab.
 *
 * OAuth 2.0 web-server flow with PKCE against the "GenBI Local" connected app
 * (salesforce/force-app/main/default/connectedApps/GenBI_Local.connectedApp-meta.xml).
 * The connected app is configured with an optional consumer secret, so only the
 * consumer key (SF_CLIENT_ID) is needed here. Tokens are cached on disk so the
 * connection survives dev-server restarts.
 */

const router: IRouter = Router();

const SF_LOGIN_URL = (process.env.SF_LOGIN_URL ?? "https://login.salesforce.com").replace(/\/$/, "");
const SF_CLIENT_ID = process.env.SF_CLIENT_ID ?? "";
const SF_CALLBACK_URL = process.env.SF_CALLBACK_URL ?? "http://localhost:8080/api/salesforce/oauth/callback";
const APP_URL = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const SF_API_VERSION = process.env.SF_API_VERSION ?? "v64.0";
const TOKEN_FILE = path.resolve(process.cwd(), ".salesforce-tokens.json");

interface SfTokens {
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  issuedAt: number;
}

let tokens: SfTokens | null = loadTokens();
/** state -> PKCE code_verifier for in-flight authorizations */
const pendingAuth = new Map<string, string>();

function loadTokens(): SfTokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as SfTokens;
  } catch {
    return null;
  }
}

function saveTokens(next: SfTokens | null): void {
  tokens = next;
  try {
    if (next) fs.writeFileSync(TOKEN_FILE, JSON.stringify(next, null, 2));
    else fs.rmSync(TOKEN_FILE, { force: true });
  } catch (err) {
    logger.warn({ err }, "Could not persist Salesforce tokens");
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function exchangeToken(params: Record<string, string>): Promise<SfTokens> {
  const res = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) {
    throw new Error(body.error_description ?? body.error ?? `Token endpoint returned ${res.status}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? tokens?.refreshToken,
    instanceUrl: body.instance_url,
    issuedAt: Date.now(),
  };
}

async function refreshAccessToken(): Promise<boolean> {
  if (!tokens?.refreshToken) return false;
  try {
    const next = await exchangeToken({
      grant_type: "refresh_token",
      client_id: SF_CLIENT_ID,
      refresh_token: tokens.refreshToken,
    });
    saveTokens(next);
    return true;
  } catch (err) {
    logger.warn({ err }, "Salesforce token refresh failed");
    saveTokens(null);
    return false;
  }
}

/** GET against the Salesforce REST API, retrying once through a token refresh on 401. */
async function sfApiGet(pathname: string): Promise<unknown> {
  if (!tokens) throw Object.assign(new Error("Not connected to Salesforce"), { status: 401 });
  const call = () =>
    fetch(`${tokens!.instanceUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${tokens!.accessToken}` },
    });
  let res = await call();
  if (res.status === 401 && (await refreshAccessToken())) {
    res = await call();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Array<{ message?: string }> | null;
    const message = body?.[0]?.message ?? `Salesforce returned ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status === 401 ? 401 : 502 });
  }
  return res.json();
}

// ── auth ──────────────────────────────────────────────────────────────────────

router.get("/salesforce/auth/status", (_req: Request, res: Response) => {
  res.json({
    configured: Boolean(SF_CLIENT_ID),
    connected: Boolean(tokens),
    instanceUrl: tokens?.instanceUrl ?? null,
  });
});

router.get("/salesforce/auth/login", (_req: Request, res: Response) => {
  if (!SF_CLIENT_ID) {
    res.status(500).json({ error: "SF_CLIENT_ID is not configured in .env" });
    return;
  }
  const verifier = b64url(crypto.randomBytes(64));
  const state = b64url(crypto.randomBytes(24));
  pendingAuth.set(state, verifier);
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

  const url = new URL(`${SF_LOGIN_URL}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", SF_CLIENT_ID);
  url.searchParams.set("redirect_uri", SF_CALLBACK_URL);
  url.searchParams.set("scope", "api refresh_token");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

router.get("/salesforce/oauth/callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description: errorDescription } = req.query as Record<string, string | undefined>;
  const fail = (message: string) =>
    res.redirect(`${APP_URL}/reports?sf_error=${encodeURIComponent(message)}`);

  if (error) {
    fail(errorDescription ?? error);
    return;
  }
  const verifier = state ? pendingAuth.get(state) : undefined;
  if (state) pendingAuth.delete(state);
  if (!code || !verifier) {
    fail("Authorization state expired — try connecting again.");
    return;
  }
  try {
    const next = await exchangeToken({
      grant_type: "authorization_code",
      client_id: SF_CLIENT_ID,
      redirect_uri: SF_CALLBACK_URL,
      code,
      code_verifier: verifier,
    });
    saveTokens(next);
    res.redirect(`${APP_URL}/reports?sf_connected=1`);
  } catch (err) {
    logger.error({ err }, "Salesforce OAuth code exchange failed");
    fail(err instanceof Error ? err.message : "Token exchange failed");
  }
});

router.post("/salesforce/auth/logout", (_req: Request, res: Response) => {
  saveTokens(null);
  res.json({ ok: true });
});

// ── DCR report ────────────────────────────────────────────────────────────────

const DCR_COLUMNS: Array<{ name: string; label: string }> = [
  { name: "Name", label: "DCR Name" },
  { name: "Change_Status__c", label: "Change Status" },
  { name: "Change_Source__c", label: "Change Source" },
  { name: "DCR_Prioritization__c", label: "Prioritization" },
  { name: "Application_Submission_Status__c", label: "Submission Status" },
  { name: "DCR_Submitter_Name__c", label: "Submitter" },
  { name: "Requester_Name__c", label: "Requester" },
  { name: "Requester_Company__c", label: "Requester Company" },
  { name: "Target_Contact_Name__c", label: "Target Contact" },
  { name: "Target_Company__c", label: "Target Company" },
  { name: "Approver__c", label: "Approver" },
  { name: "Date_of_Approval__c", label: "Date of Approval" },
  { name: "CreatedDate", label: "Created" },
  { name: "LastModifiedDate", label: "Last Modified" },
];

router.get("/salesforce/reports/dcr", async (_req: Request, res: Response) => {
  const soql =
    `SELECT Id, ${DCR_COLUMNS.map((c) => c.name).join(", ")} ` +
    `FROM DCR__c ORDER BY LastModifiedDate DESC LIMIT 500`;
  try {
    const data = (await sfApiGet(
      `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    )) as { totalSize: number; records: Array<Record<string, unknown>> };
    const records = data.records.map(({ attributes: _attributes, ...fields }) => fields);
    res.json({
      columns: DCR_COLUMNS,
      records,
      totalSize: data.totalSize,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    res.status(status).json({ error: err instanceof Error ? err.message : "Salesforce query failed" });
  }
});

export default router;
