import express from "express";
import cryptoRouter from "./crypto.js";
import indiaRouter from "./india.js";
import forexRouter from "./forex.js";
import candlesRouter from "./candles.js";
import historyRouter from "./history.js";
import mtfRouter from "./mtf.js";

const router = express.Router();

router.use("/crypto", cryptoRouter);
router.use("/india", indiaRouter);
router.use("/forex", forexRouter);
router.use("/candles", candlesRouter);
router.use("/history", historyRouter);
router.use("/mtf", mtfRouter);

export default router;
