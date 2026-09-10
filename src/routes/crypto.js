import express from "express";
import fs      from "fs";
import path    from "path";

const router = express.Router();

const SIGNALS_DIR = path.resolve("signals_live");

const SYMBOL_FILE = {
  BTC: "BTC_USD.json",
  ETH: "ETH_USD.json",
  SOL: "SOL_USD.json",
  BNB: "BNB_USD.json",
};

// GET /api/crypto/signal?symbol=BTC
router.get("/signal", (req, res) => {
  const symbol = (req.query.symbol || "BTC").toUpperCase();
  const file   = SYMBOL_FILE[symbol];

  if (!file) {
    return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
  }

  const filePath = path.join(SIGNALS_DIR, file);

  if (!fs.existsSync(filePath)) {
    return res.json({
      signal:     "NEUTRAL",
      confidence: 0,
      reason:     "Signal not yet generated — waiting for first closed candle",
      _source:    "Pending",
      symbol,
      emaConfirmation: "N/A",
      emaConfirmationNote: "EMA(200) signal confirmation is not yet available.",
      ema200Daily: null,
      automationAllowed: false,
    });
  }

  try {
    const raw    = fs.readFileSync(filePath, "utf8");
    const data   = JSON.parse(raw);
    const signal = data.signal ?? {};

    return res.json({
      signal:     signal.action     ?? "NEUTRAL",
      confidence: signal.confidence ?? 0,
      reason:     signal.reason     ?? "",
      stopPrice:  signal.stopPrice  ?? null,
      direction:  signal.direction  ?? 0,
      _source:    "Donchian-ATR",
      asOf:       data.meta?.asOf   ?? null,
      indicators: data.indicators   ?? {},
      price:      data.price        ?? {},

      // Informational-only completed-1D EMA(200) context. These fields
      // are serialized by live_signal_writer.js; legacy signal files safely
      // degrade to N/A/null without changing signal or execution behavior.
      emaConfirmation: signal.emaConfirmation ?? "N/A",
      emaConfirmationNote: signal.emaConfirmationNote ?? null,
      ema200Daily: signal.ema200Daily ?? null,
      automationAllowed: false,
    });
  } catch (err) {
    console.error("[CRYPTO ROUTE]", err.message);
    return res.status(500).json({ error: "Failed to read signal file" });
  }
});

export default router;
