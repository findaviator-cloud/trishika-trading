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
    });
  }

  try {
    const raw    = fs.readFileSync(filePath, "utf8");
    const data   = JSON.parse(raw);
    return res.json({
      signal:     data.signal?.action     ?? "NEUTRAL",
      confidence: data.signal?.confidence ?? 0,
      reason:     data.signal?.reason     ?? "",
      stopPrice:  data.signal?.stopPrice  ?? null,
      direction:  data.signal?.direction  ?? 0,
      _source:    "Donchian-ATR",
      asOf:       data.meta?.asOf         ?? null,
      indicators: data.indicators         ?? {},
      price:      data.price              ?? {},
    });
  } catch (err) {
    console.error("[CRYPTO ROUTE]", err.message);
    return res.status(500).json({ error: "Failed to read signal file" });
  }
});

export default router;
