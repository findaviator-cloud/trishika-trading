import express from "express";
import cryptoRouter from "./crypto.js";
import indiaRouter from "./india.js";
import forexRouter from "./forex.js";

const router = express.Router();

router.use("/crypto", cryptoRouter);
router.use("/india", indiaRouter);
router.use("/forex", forexRouter);

export default router;
