import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();
const SIGNALS_DIR = path.resolve("signals_live");

const SYMBOL_FILE = {
  BTC: "BTC_USD.json",
  ETH: "ETH_USD.json",
  SOL: "SOL_USD.json",
  BNB: "BNB_USD.json",
  EUR_USD: "EUR_USD.json",
  XAU_USD: "XAU_USD.json",
  EURUSD: "EUR_USD.json",
  XAUUSD: "XAU_USD.json",
};

function loadSignal(symbol) {
  try {
    const file = SYMBOL_FILE[symbol];
    if (!file) return null;
    const filePath = path.join(SIGNALS_DIR, file);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return {
      signal:     data.signal?.action     ?? "NEUTRAL",
      confidence: data.signal?.confidence ?? 0,
      reason:     data.signal?.reason     ?? "",
      stopPrice:  data.signal?.stopPrice  ?? null,
      direction:  data.signal?.direction  ?? 0,
      _source:    "Donchian-ATR",
      timestamp:  data.meta?.asOf ? new Date(data.meta.asOf).getTime() : Date.now(),
      indicators: data.indicators ?? {},
      price:      data.price ?? {},
    };
  } catch (e) {
    return null;
  }
}

// GET /api/candles/:symbol
router.get("/:symbol", (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const analysis = loadSignal(symbol);
  res.json({
    symbol,
    current: null,
    candles: [],
    analysis,
    indicators: analysis?.indicators ?? {},
  });
});

export default router;
