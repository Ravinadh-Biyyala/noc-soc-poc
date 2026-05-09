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
      const q = String(req.query.q ?? "").trim();
      const escaped = q.replace(/['\\]/g, "\\$&");
      const driveQuery = [
        "mimeType='application/vnd.google-apps.spreadsheet'",
        "trashed=false",
        ...(escaped ? [`name contains '${escaped}'`] : []),
      ].join(" and ");

      const params = new URLSearchParams({
        q: driveQuery,
        fields: "files(id,name,modifiedTime,owners(displayName))",
        pageSize: "50",
        orderBy: "modifiedTime desc",
        spaces: "drive",
      });

      const resp = await connectors.proxy(
        "google-sheet",
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
      const msg = err instanceof Error ? err.message : "Failed to list files";
      req.log.error({ err }, "google sheets list error");
      res.status(500).json({ error: msg });
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

      const resp = await connectors.proxy("google-sheet", path, {
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

      const buf = Buffer.from(await resp.arrayBuffer());
      res.setHeader("Content-Type", XLSX_MIME);
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to download";
      req.log.error({ err }, "google sheets download error");
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
