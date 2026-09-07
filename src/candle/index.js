import { WebSocket } from "ws";
import { CONFIG, WS_TYPES, TWELVE_TO_SYMBOL } from "../config/index.js";
import { writeDonchianSignal } from "../strategy/live_signal_writer.js";
import { fetchTwelveDataJson } from "../services/twelve_data_rate_limiter.js";

// ── Twelve Data REST fetch (hourly candles; globally rate-limited) ─────────────
async function fetchTwelveHourly(symbol, limit = 200) {
  const key = CONFIG.twelveKey;

  if (!key) {
    throw new Error('Twelve Data key is not configured.');
  }

  const sym = encodeURIComponent(symbol);
  const url =
    `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1h&outputsize=${limit}&apikey=${key}`;

  const parsed = await fetchTwelveDataJson(url);

  if (!Array.isArray(parsed.values)) {
    throw new Error('Twelve Data response did not contain candle values.');
  }

  return parsed.values.reverse().map((r) => ({
    time: new Date(r.datetime).getTime(),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: 0
  }));
}

export class CandleEngine {
  constructor(symbol, candleMs = null) {
    this.symbol = symbol;
    this.candleMs = candleMs || CONFIG.candleMs;
    this.candles = [];
    this.currentCandle = null;
    this.lastAnalysis = null;
    this.analysisTime = 0;
    this.analyzing = false;
    this.subscribers = new Set();
    this.source = "twelvedata";
  }

  onTick(price, qty, time) {
    const bucketTime = Math.floor(time / this.candleMs) * this.candleMs;

    if (!this.currentCandle || this.currentCandle.time !== bucketTime) {
      if (this.currentCandle) {
        this.candles.push({ ...this.currentCandle });

        if (this.candles.length > CONFIG.maxCandles) {
          this.candles.shift();
        }

        this.broadcast({
          type: WS_TYPES.CANDLE_CLOSED,
          candle: this.currentCandle,
          symbol: this.symbol
        });

        writeDonchianSignal(this.symbol, this.candles);
      }

      this.currentCandle = {
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: qty
      };
    } else {
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
      this.currentCandle.volume += qty;
    }

    this.broadcast({
      type: WS_TYPES.TICK,
      candle: this.currentCandle,
      symbol: this.symbol
    });
  }

  loadCandles(candles) {
    this.candles = candles.slice(-CONFIG.maxCandles);

    if (this.candles.length > 0) {
      writeDonchianSignal(this.symbol, this.candles);
    }
  }

  getIndicators() {
    return null;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);

    for (const ws of this.subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  subscribe(ws) {
    this.subscribers.add(ws);
  }

  unsubscribe(ws) {
    this.subscribers.delete(ws);
  }
}

// ── Crypto polling via Twelve Data REST (globally rate-limited) ───────────────
const CRYPTO_SYMBOLS = {
  BTC: "BTC/USD",
  ETH: "ETH/USD",
  SOL: "SOL/USD",
  BNB: "BNB/USD"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectBinance(engines, log) {
  log.info("Crypto → using Twelve Data REST (Binance blocked on Render)");

  async function pollCrypto() {
    for (const [sym, tdSym] of Object.entries(CRYPTO_SYMBOLS)) {
      try {
        const candles = await fetchTwelveHourly(tdSym, 200);

        if (engines[sym]) {
          engines[sym].loadCandles(candles);
          const last = candles[candles.length - 1];
          log.info(`[CRYPTO] ${sym} updated — last close: ${last.close}`);
        }
      } catch (error) {
        log.error(`[CRYPTO] ${sym} fetch failed:`, error.message);
      }
    }

    await sleep(15 * 60 * 1000);
    pollCrypto().catch((error) => {
      log.error('[CRYPTO] Poll loop failed:', error.message);
    });
  }

  pollCrypto().catch((error) => {
    log.error('[CRYPTO] Initial poll failed:', error.message);
  });
}

// ── Twelve Data WebSocket (Forex + Gold) ─────────────────────────────────────
export async function loadForexHistory(engines, log) {
  const FOREX_MAP = {
    EUR_USD: "EUR/USD",
    XAU_USD: "XAU/USD"
  };

  for (const [sym, tdSym] of Object.entries(FOREX_MAP)) {
    try {
      const candles = await fetchTwelveHourly(tdSym, 200);

      if (engines[sym]) {
        engines[sym].loadCandles(candles);
        const last = candles[candles.length - 1];
        log.info(
          `[FOREX] ${sym} history loaded — ${candles.length} candles, last close: ${last.close}`
        );
      }
    } catch (error) {
      log.error(`[FOREX] ${sym} history load failed:`, error.message);
    }
  }
}

export function connectTwelveData(engines, log) {
  if (!CONFIG.twelveKey) {
    log.warn("Twelve Data key missing — Forex & Gold disabled");
    return;
  }

  const ws = new WebSocket(
    "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + CONFIG.twelveKey
  );

  ws.on("open", () => {
    log.info("Twelve Data WS connected");
    const symbols = Object.values(CONFIG.forexSymbols);
    ws.send(JSON.stringify({
      action: "subscribe",
      params: { symbols: symbols.join(",") }
    }));
    log.info(`Twelve Data → subscribed: ${symbols.join(", ")}`);
  });

  ws.on("close", () => {
    log.warn("Twelve Data WS closed — reconnecting in 60s...");
    setTimeout(() => connectTwelveData(engines, log), 60000);
  });

  ws.on("error", (error) => {
    log.error("Twelve Data WS:", error.message);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.event === "heartbeat") return;

      if (msg.event === "subscribe-status") {
        log.info("Twelve Data subscribed:", JSON.stringify(msg));
        return;
      }

      if (msg.event === "price" && msg.price) {
        const sym = TWELVE_TO_SYMBOL[msg.symbol];

        if (sym && engines[sym]) {
          engines[sym].onTick(
            parseFloat(msg.price),
            1,
            msg.timestamp ? msg.timestamp * 1000 : Date.now()
          );
        }
      }
    } catch (error) {
      log.error("Twelve Data parse:", error.message);
    }
  });
}
