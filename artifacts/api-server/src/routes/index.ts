import { Router, type IRouter } from "express";
import healthRouter from "./health";
import snapProfileRouter from "./snap-profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(snapProfileRouter);

export default router;
