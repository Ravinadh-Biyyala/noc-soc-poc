import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { overviewData } from "./data/overview";
import { claimsData } from "./data/claims";
import { policyData } from "./data/policies";
import { predictiveData } from "./data/predictive";
import { sentimentData } from "./data/sentiment";
import { edaData } from "./data/eda";
import { brokerData } from "./data/brokers";
import { revenueData } from "./data/revenue";

const router: IRouter = Router();

router.get("/dashboard/overview", (_req: Request, res: Response) => {
  res.json(overviewData);
});

router.get("/dashboard/claims", (_req: Request, res: Response) => {
  res.json(claimsData);
});

router.get("/dashboard/policies", (_req: Request, res: Response) => {
  res.json(policyData);
});

router.get("/dashboard/predictive", (_req: Request, res: Response) => {
  res.json(predictiveData);
});

router.get("/dashboard/sentiment", (_req: Request, res: Response) => {
  res.json(sentimentData);
});

router.get("/dashboard/eda", (_req: Request, res: Response) => {
  res.json(edaData);
});

router.get("/dashboard/brokers", (_req: Request, res: Response) => {
  res.json(brokerData);
});

router.get("/dashboard/revenue", (_req: Request, res: Response) => {
  res.json(revenueData);
});

export default router;
