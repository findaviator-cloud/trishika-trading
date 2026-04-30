import { WebSocket } from "ws";
import { CONFIG, WS_TYPES, BINANCE_TO_SYMBOL, TWELVE_TO_SYMBOL } from "../config/index.js";
import { computeIndicators } from "../indicators/index.js";
import { writeDonchianSignal } from "../strategy/live_signal_writer.js";

export class CandleEngine {
  constructor(symbol, candleMs = null) {
    this.symbol = symbol; this.candleMs = candleMs || CONFIG.candleMs;
    this.candles = []; this.currentCandle = null; this.lastAnalysis = null;
    this.analysisTime = 0; this.analyzing = false;
    this.subscribers = new Set(); this.source = "binance";
  }
  onTick(price, qty, time) {
    const bucketTime = Math.floor(time / this.candleMs) * this.candleMs;
    if (!this.currentCandle || this.currentCandle.time !== bucketTime) {
      if (this.currentCandle) {
        this.candles.push({ ...this.currentCandle });
        if (this.candles.length > CONFIG.maxCandles) this.candles.shift();
        this.broadcast({ type: WS_TYPES.CANDLE_CLOSED, candle: this.currentCandle, symbol: this.symbol });
        writeDonchianSignal(this.symbol, this.candles);
      }
      this.currentCandle = { time: bucketTime, open: price, high: price, low: price, close: price, volume: qty };
    } else {
      this.currentCandle.high   = Math.max(this.currentCandle.high, price);
      this.currentCandle.low    = Math.min(this.currentCandle.low, price);
      this.currentCandle.close  = price;
      this.currentCandle.volume += qty;
    }
    this.broadcast({ type: WS_TYPES.TICK, candle: this.currentCandle, symbol: this.symbol });
  }
  getIndicators() { return computeIndicators(this.candles); }
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.subscribers) { if (ws.readyState === WebSocket.OPEN) ws.send(data); }
  }
  subscribe(ws)   { this.subscribers.add(ws); }
  unsubscribe(ws) { this.subscribers.delete(ws); }
}

export function connectBinance(engines, log) {
  const streams = Object.values(CONFIG.symbols).map(s => `${s}@trade`).join("/");
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  ws.on("open",  () => log.info("Binance WS connected"));
  ws.on("close", () => { log.warn("Binance WS closed — reconnecting in 3s..."); setTimeout(() => connectBinance(engines, log), 3000); });
  ws.on("error", (e) => log.error("Binance WS:", e.message));
  ws.on("message", (raw) => {
    try {
      const { data } = JSON.parse(raw);
      if (!data || data.e !== "trade") return;
      const sym = BINANCE_TO_SYMBOL[data.s.toLowerCase()];
      if (sym && engines[sym]) engines[sym].onTick(parseFloat(data.p), parseFloat(data.q), data.T);
    } catch(e) { log.error("Binance parse:", e.message); }
  });
}

export function connectTwelveData(engines, log) {
  if (!CONFIG.twelveKey) { log.warn("Twelve Data key missing — Gold & EURUSD disabled"); return; }
  const ws = new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey=" + CONFIG.twelveKey);
  ws.on("open", () => {
    log.info("Twelve Data WS connected");
    const symbols = Object.values(CONFIG.forexSymbols);
    ws.send(JSON.stringify({ action:"subscribe", params:{ symbols: symbols.join(",") } }));
    log.info(`Twelve Data → subscribed: ${symbols.join(", ")}`);
  });
  ws.on("close", () => { log.warn("Twelve Data WS closed — reconnecting in 5s..."); setTimeout(() => connectTwelveData(engines, log), 5000); });
  ws.on("error", (e) => log.error("Twelve Data WS:", e.message));
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.event === "heartbeat") return;
      if (msg.event === "subscribe-status") { log.info("Twelve Data subscribed:", JSON.stringify(msg)); return; }
      if (msg.event === "price" && msg.price) {
        const sym = TWELVE_TO_SYMBOL[msg.symbol];
        if (sym && engines[sym]) engines[sym].onTick(parseFloat(msg.price), 1, msg.timestamp ? msg.timestamp * 1000 : Date.now());
      }
    } catch(e) { log.error("Twelve Data parse:", e.message); }
  });
}
