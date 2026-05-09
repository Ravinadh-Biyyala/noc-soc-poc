import { Router, type IRouter, type Request, type Response } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

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
    try {
      // Aggressively sanitize: keep only chars that are safe inside a Drive
      // `name contains 'X'` literal — letters, digits, spaces, dot, dash,
      // underscore. This rules out the special chars (', \, parens, etc.)
      // that could break out of the quoted literal or its enclosing group.
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
        req.log.warn(
          { status: resp.status, body: text.slice(0, 500) },
          "drive list failed",
        );
        res
          .status(resp.status)
          .json({ error: `Google Drive returned ${resp.status}` });
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
    try {
      const fileId = String(req.query.fileId ?? "").trim();
      if (!fileId) {
        res.status(400).json({ error: "fileId is required" });
        return;
      }

      const path = `/drive/v3/files/${encodeURIComponent(
        fileId,
      )}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`;

      const resp = await connectors.proxy("google-drive", path, {
        method: "GET",
      });

      if (!resp.ok) {
        const text = await resp.text();
        req.log.warn(
          { status: resp.status, body: text.slice(0, 500), fileId },
          "drive export failed",
        );
        res
          .status(resp.status)
          .json({ error: `Google Drive export failed (${resp.status})` });
        return;
      }

      // Trust-but-verify: Drive's export endpoint should hand us the xlsx
      // mime we asked for, but pass through whatever it actually returned
      // so the client never gets a mislabeled body. (E.g. a sheet larger
      // than the export size limit returns a JSON error doc with 200 OK.)
      const upstreamType = resp.headers.get("content-type") ?? "";
      if (!upstreamType.toLowerCase().includes("spreadsheet")) {
        const text = await resp.text();
        req.log.warn(
          { upstreamType, body: text.slice(0, 500), fileId },
          "drive export returned non-xlsx body",
        );
        res.status(502).json({
          error:
            "Google Drive returned an unexpected response — the sheet may be too large to export.",
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
