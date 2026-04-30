import express from "express";

const router = express.Router();

// India signal endpoint: GET /api/india/signal?symbol=NIFTY
router.get("/signal", (req, res) => {
  const symbol = req.query.symbol || "NIFTY";

  res.json({
    signal: "NEUTRAL",
    confidence: 50,
    reason: "India AI failed, defaulting to neutral",
    agent: "System",
    _source: "Fallback",
    indicators: {
      symbol,
      regime: "RANGING",
      overallTrend: "MIXED",
      rsi: 50,
      emaFast: 100,
      emaSlow: 100,
      atr: 1,
      atrRegimeOK: true,
      volFilter: true,
      igsGrade: "B",
      igsAction: "CAUTION",
      rrRatio: 1.2,
      session: "ACTIVE",
      price: 50000,
    },
  });
});

export default router;
