import express from "express";
import { getHistory } from "../strategy/signal_store.js";

const router = express.Router();

// GET /api/history — last 24 hours ke saare signals
router.get("/", (req, res) => {
  const history = getHistory();
  const sorted = [...history].sort((a, b) => b.ts - a.ts);
  res.json({
    count: sorted.length,
    window: "24h",
    signals: sorted
  });
});

// GET /api/history/summary — symbol wise summary
router.get("/summary", (req, res) => {
  const history = getHistory();
  const summary = {};
  for (const s of history) {
    if (!summary[s.symbol]) summary[s.symbol] = { LONG: 0, SHORT: 0, last: null };
    summary[s.symbol][s.action]++;
    if (!summary[s.symbol].last || s.ts > summary[s.symbol].last.ts) {
      summary[s.symbol].last = s;
    }
  }
  res.json({ summary, total: history.length });
});

export default router;
