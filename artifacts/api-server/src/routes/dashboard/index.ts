import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { executiveData } from "./data/executive";
import { salesData } from "./data/sales";
import { productData } from "./data/products";
import { renewalsData } from "./data/renewals";
import { claimsData } from "./data/claims";
import { geographyData } from "./data/geography";

const router: IRouter = Router();

router.get("/dashboard/executive", (_req: Request, res: Response) => {
  res.json(executiveData);
});

router.get("/dashboard/sales", (_req: Request, res: Response) => {
  res.json(salesData);
});

router.get("/dashboard/products", (_req: Request, res: Response) => {
  res.json(productData);
});

router.get("/dashboard/renewals", (_req: Request, res: Response) => {
  res.json(renewalsData);
});

router.get("/dashboard/claims", (_req: Request, res: Response) => {
  res.json(claimsData);
});

router.get("/dashboard/geography", (_req: Request, res: Response) => {
  res.json(geographyData);
});

export default router;
