import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import dashboardRouter from "./dashboard";
import uploadRouter from "./upload";
import workspacesRouter from "./workspaces";
import settingsRouter from "./settings";
import datasetsRouter from "./datasets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(dashboardRouter);
router.use(uploadRouter);
router.use(workspacesRouter);
router.use(settingsRouter);
router.use(datasetsRouter);

export default router;
