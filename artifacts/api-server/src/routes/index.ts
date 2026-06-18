import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lokiPinsRouter from "./loki-pins";
import lokiGeoipRouter from "./loki-geoip";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lokiPinsRouter);
router.use(lokiGeoipRouter);

export default router;
