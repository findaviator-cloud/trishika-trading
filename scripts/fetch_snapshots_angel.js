
// scripts/fetch_snapshots_angel.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { RSI, EMA, ATR } = require("technicalindicators");

const CONFIG = {
  symbols: ["NSE:NIFTY50-INDEX", "NSE:BANKNIFTY-INDEX"], // adjust
  interval: "FIFTEEN_MINUTE",
  outDir: path.join(__dirname, "..", "signals_live")
};

if (!fs.existsSync(CONFIG.outDir)) {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
}

// TODO: implement SmartAPI login + token fetch using API key, client code, TOTP
async function getAngelSession() {
  throw new Error("Implement SmartAPI login: generate session token with TOTP here");
}

async function fetchCandlesAngel(symbol, session) {
  // TODO: call SmartAPI historical endpoint with session.authToken
  // normalize to [{ time, open, high, low, close, volume }, ...] oldest->newest
  return [];
}

function buildSnapshotFromCandles(symbol, candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);

  const rsi = RSI.calculate({ period: 14, values: closes }).at(-1);
  const ema20 = EMA.calculate({ period: 20, values: closes }).at(-1);
  const ema50 = EMA.calculate({ period: 50, values: closes }).at(-1);
  const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).at(-1);

  const lastPrice = closes.at(-1);
  const prevPrice = closes.at(-2);
  const distEma20 = ((lastPrice - ema20) / ema20) * 100;
  const changePct = ((lastPrice - prevPrice) / prevPrice) * 100;

  let trendScore = 0;
  if (lastPrice > ema20 && ema20 > ema50) trendScore = 0.8;
  if (lastPrice < ema20 && ema20 < ema50) trendScore = -0.8;

  let regime = "Ranging";
  if (Math.abs(distEma20) > 0.3) regime = "Trending";
  if ((atr / lastPrice * 100) > 0.5) regime += "-HighVol";

  return {
    meta: { symbol, timeframe: CONFIG.interval, asOf: new Date().toISOString(), source: "angel" },
    price: { last: lastPrice, changePct, atr },
    indicators: { rsi, ema20, ema50, trendScore, regime }
  };
}

async function run() {
  const session = await getAngelSession(); // fill this in
  for (const symbol of CONFIG.symbols) {
    console.log("Processing", symbol, "...");
    const candles = await fetchCandlesAngel(symbol, session);
    if (!candles || candles.length === 0) continue;
    const snapshot = buildSnapshotFromCandles(symbol, candles);
    const fileName = symbol.replace(/[:\/]/g, "_") + ".json";
    fs.writeFileSync(path.join(CONFIG.outDir, fileName), JSON.stringify(snapshot, null, 2));
    console.log("Saved", fileName);
  }
}

run().catch(console.error);

