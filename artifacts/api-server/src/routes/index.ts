import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openaiRouter from "./openai";
import dashboardRouter from "./dashboard";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openaiRouter);
router.use(dashboardRouter);
router.use(uploadRouter);

export default router;
