import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import booksRouter from "./books";
import readerRouter from "./reader";
import genresRouter from "./genres";
import cyclesRouter from "./cycles";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(booksRouter);
router.use(readerRouter);
router.use(genresRouter);
router.use(cyclesRouter);
router.use(adminRouter);

export default router;
