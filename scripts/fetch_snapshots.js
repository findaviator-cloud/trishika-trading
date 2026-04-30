// scripts/fetch_snapshots.js
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twelvedata from "twelvedata";
import { RSI, EMA, ATR } from "technicalindicators";

const TD_API_KEY = process.env.TWELVEDATA_API_KEY;
if (!TD_API_KEY) {
  console.error("Missing TWELVEDATA_API_KEY in .env");
  process.exit(1);
}

const client = twelvedata({ key: TD_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  symbols: ["BTC/USD", "ETH/USD", "EUR/USD", "XAU/USD"],
  interval: "15min",
  outputsize: 100,
  outDir: path.join(__dirname, "..", "signals_live")
};

if (!fs.existsSync(CONFIG.outDir)) {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
}

async function fetchCandles(symbol) {
  try {
    const data = await client.timeSeries({
      symbol,
      interval: CONFIG.interval,
      outputsize: CONFIG.outputsize
    });

    const values = Array.isArray(data) ? data : (data.values || []);
    if (!Array.isArray(values) || values.length === 0) {
      console.error(`No data returned for ${symbol}`);
      return null;
    }

    const candles = values.slice().reverse().map(c => ({
      time: c.datetime,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume || 0)
    }));

    return candles;
  } catch (e) {
    console.error(`Error fetching ${symbol}:`, e.message);
    return null;
  }
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

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
    meta: { symbol: "", timeframe: CONFIG.interval, asOf: new Date().toISOString() },
    price: { last: lastPrice, changePct, atr },
    indicators: { rsi, ema20, ema50, trendScore, regime }
  };
}

async function run() {
  for (const symbol of CONFIG.symbols) {
    console.log(`Processing ${symbol}...`);
    const candles = await fetchCandles(symbol);
    if (!candles) continue;

    const snapshot = calculateIndicators(candles);
    snapshot.meta.symbol = symbol;

    const fileName = `${symbol.replace("/", "_")}.json`;
    fs.writeFileSync(path.join(CONFIG.outDir, fileName), JSON.stringify(snapshot, null, 2));
    console.log(`Saved ${fileName}`);
  }
}

run();
