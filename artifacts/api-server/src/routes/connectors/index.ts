import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

// Lazy-load the Replit SDK — it is only available inside Replit deployments.
// On Windows local dev (or any non-Replit host) the package is not installed,
// so we fall back to 503 responses rather than crashing the whole server.
let _connectors: any = null;
let _sdkAttempted = false;

async function getConnectors(): Promise<any | null> {
  if (_sdkAttempted) return _connectors;
  _sdkAttempted = true;
  try {
    const mod = await import("@replit/connectors-sdk" as string);
    _connectors = new mod.ReplitConnectors();
  } catch {
    _connectors = null;
  }
  return _connectors;
}

function unavailable(res: Response) {
  res.status(503).json({
    error: "Google Sheets connector is only available inside Replit deployments.",
  });
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owners?: { displayName?: string }[];
}

router.get(
  "/connectors/google-sheets/files",
  async (req: Request, res: Response) => {
    const connectors = await getConnectors();
    if (!connectors) { unavailable(res); return; }

    try {
      const q = String(req.query.q ?? "")
        .trim()
        .slice(0, 80)
        .replace(/[^\p{L}\p{N} ._-]/gu, "");
      const driveQuery = [
        "mimeType='application/vnd.google-apps.spreadsheet'",
        "trashed=false",
        ...(q ? [`name contains '${q}'`] : []),
      ].join(" and ");

      const params = new URLSearchParams({
        q: driveQuery,
        fields: "files(id,name,modifiedTime,owners(displayName))",
        pageSize: "50",
        orderBy: "modifiedTime desc",
        spaces: "drive",
      });

      const resp = await connectors.proxy(
        "google-drive",
        `/drive/v3/files?${params.toString()}`,
        { method: "GET" },
      );

      if (!resp.ok) {
        const text = await resp.text();
        req.log.warn({ status: resp.status, body: text.slice(0, 500) }, "drive list failed");
        res.status(resp.status).json({ error: `Google Drive returned ${resp.status}` });
        return;
      }

      const data = (await resp.json()) as { files?: DriveFile[] };
      res.json({ files: data.files ?? [] });
    } catch (err: unknown) {
      req.log.error({ err }, "google sheets list error");
      res.status(500).json({ error: "Could not list spreadsheets" });
    }
  },
);

router.get(
  "/connectors/google-sheets/download",
  async (req: Request, res: Response) => {
    const connectors = await getConnectors();
    if (!connectors) { unavailable(res); return; }

    try {
      const fileId = String(req.query.fileId ?? "").trim();
      if (!fileId) {
        res.status(400).json({ error: "fileId is required" });
        return;
      }

      const path = `/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`;
      const resp = await connectors.proxy("google-drive", path, { method: "GET" });

      if (!resp.ok) {
        const text = await resp.text();
        req.log.warn({ status: resp.status, body: text.slice(0, 500), fileId }, "drive export failed");
        res.status(resp.status).json({ error: `Google Drive export failed (${resp.status})` });
        return;
      }

      const upstreamType = resp.headers.get("content-type") ?? "";
      if (!upstreamType.toLowerCase().includes("spreadsheet")) {
        const text = await resp.text();
        req.log.warn({ upstreamType, body: text.slice(0, 500), fileId }, "drive export returned non-xlsx body");
        res.status(502).json({
          error: "Google Drive returned an unexpected response — the sheet may be too large to export.",
        });
        return;
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (err: unknown) {
      req.log.error({ err }, "google sheets download error");
      res.status(500).json({ error: "Could not import spreadsheet" });
    }
  },
);

export default router;
