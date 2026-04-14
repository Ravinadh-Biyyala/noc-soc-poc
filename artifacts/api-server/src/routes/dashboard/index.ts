import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { getClientConfig, getDataForSection } from "../../config/index.js";

const router: IRouter = Router();

const legacySectionIds = new Set(["executive", "sales", "products", "renewals", "claims", "geography"]);

router.get("/config", (_req: Request, res: Response) => {
  res.json(getClientConfig());
});

router.get("/dashboard/:sectionId", async (req: Request<{ sectionId: string }>, res: Response, next: NextFunction) => {
  const { sectionId } = req.params;
  if (legacySectionIds.has(sectionId)) {
    next();
    return;
  }
  const data = await getDataForSection(sectionId);
  if (!data || Object.keys(data).length === 0) {
    res.status(404).json({ error: `Section '${sectionId}' not found` });
    return;
  }
  res.json(data);
});

const legacySectionMap: Record<string, string> = {
  executive: "executive",
  sales: "sales",
  products: "products",
  renewals: "renewals",
  claims: "claims",
};

for (const [legacyPath, sectionId] of Object.entries(legacySectionMap)) {
  router.get(`/dashboard/${legacyPath}`, async (_req: Request, res: Response) => {
    const data = await getDataForSection(sectionId);
    if (!data || Object.keys(data).length === 0) {
      res.status(404).json({ error: `Section '${sectionId}' not available for current tenant` });
      return;
    }
    res.json(data);
  });
}

router.get("/dashboard/geography", async (_req: Request, res: Response) => {
  const execData = await getDataForSection("executive");
  if (execData?.geography) {
    res.json(execData.geography);
    return;
  }
  res.status(404).json({ error: "Geography data not available for current tenant" });
});

export default router;
