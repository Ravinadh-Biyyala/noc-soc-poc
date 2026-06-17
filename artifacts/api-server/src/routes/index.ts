import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import dashboardRouter from "./dashboard";
import uploadRouter from "./upload";
import workspacesRouter from "./workspaces";
import settingsRouter from "./settings";
import connectorsRouter from "./connectors";
import datasetsRouter from "./datasets";
import userDashboardsRouter from "./user-dashboards";
import googleSheetsRouter from "./google-sheets";
import postgresRouter from "./postgres";
import copilotDashboardsRouter from "./copilot-dashboards";
import sectionPinnedChartsRouter from "./section-pinned-charts";
import projectAgentsRouter from "./project-agents";
import projectIngestRouter from "./project-ingest";
import salesforceRouter from "./salesforce";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(dashboardRouter);
router.use(uploadRouter);
router.use(workspacesRouter);
router.use(settingsRouter);
router.use(connectorsRouter);
router.use(datasetsRouter);
router.use(userDashboardsRouter);
router.use(googleSheetsRouter);
router.use(postgresRouter);
router.use(copilotDashboardsRouter);
router.use(sectionPinnedChartsRouter);
router.use(projectAgentsRouter);
router.use(projectIngestRouter);
router.use(salesforceRouter);

export default router;
