import express from "express";

const router = express.Router();

// Forex signal endpoint: GET /api/forex/signal?symbol=EURUSD
router.get("/signal", (req, res) => {
  const symbol = req.query.symbol || "EURUSD";

  res.json({
    signal: "NEUTRAL",
    confidence: 50,
    reason: "Forex AI failed, defaulting to neutral",
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
      price: 1.0,
    },
  });
});

export default router;
