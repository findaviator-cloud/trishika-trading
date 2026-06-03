import crypto from "crypto";
import { getSignal, getAllSignals } from "../strategy/signal_store.js";
import { WebSocketServer } from "ws";
import { ROUTES, WS_TYPES, CONFIG } from "../config/index.js";
import { getPortfolio, getPositions, getFunds, angelToken } from "../angel/index.js";


const SYMBOL_FILE = {
  BTC: "BTC_USD.json",
  ETH: "ETH_USD.json",
  SOL: "SOL_USD.json",
  BNB: "BNB_USD.json",
  EUR_USD: "EUR_USD.json",
  XAU_USD: "XAU_USD.json",
  NIFTY: "NIFTY.json",
  BANKNIFTY: "BANKNIFTY.json",
  RELIANCE: "RELIANCE.json",
  TCS: "TCS.json",
  INFY: "INFY.json",
  HDFCBANK: "HDFCBANK.json",
  ICICIBANK: "ICICIBANK.json",
  SBIN: "SBIN.json",
  BHARTIARTL: "BHARTIARTL.json",
  ITC: "ITC.json",
  WIPRO: "WIPRO.json",
  HCLTECH: "HCLTECH.json",
  AXISBANK: "AXISBANK.json",
  KOTAKBANK: "KOTAKBANK.json",
  LT: "LT.json",
  ONGC: "ONGC.json",
  TATAMOTORS: "TATAMOTORS.json",
  BAJFINANCE: "BAJFINANCE.json",
  MARUTI: "MARUTI.json",
  ADANIENT: "ADANIENT.json",
};

function loadSignal(symbol) {
  try {
    const file = SYMBOL_FILE[symbol];
    if (!file) return null;
    const data = getSignal(file);
    if (!data) return null;
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

export function registerWebSocket(server, engines, log) {
  const wss = new WebSocketServer({ server, path: ROUTES.WS });
  const portfolioSubscribers = new Set();
  // Broadcast analysis updates every 30s to all engine subscribers
  setInterval(() => {
    const allAnalysis = {};
    for (const s of Object.keys(engines)) {
      const a = loadSignal(s);
      if (a) allAnalysis[s] = a;
    }
    const bulkMsg = JSON.stringify({ type: "bulk_analysis", allAnalysis });
    for (const [sym, eng] of Object.entries(engines)) {
      for (const ws of eng.subscribers) {
        if (ws.readyState === 1) ws.send(bulkMsg);
      }
    }
  }, 30000);

  setInterval(async () => {
    if (portfolioSubscribers.size === 0 || !angelToken.jwt) return;
    try {
      const [positions, funds] = await Promise.all([getPositions(), getFunds()]);
      const payload = JSON.stringify({ type:WS_TYPES.PORTFOLIO, positions:positions||[], funds:funds||{}, timestamp:Date.now() });
      for (const ws of portfolioSubscribers) { if (ws.readyState === 1) ws.send(payload); }
    } catch(e) { log.error("Portfolio broadcast error:", e.message); }
  }, 120000);

  wss.on("connection", (ws) => {
    let subscribedSymbol = null;
    ws.id = crypto.randomUUID().slice(0, 8);
    log.info(`WS connected: ${ws.id}`);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") return;

        if (msg.type === WS_TYPES.SUBSCRIBE) {
          if (typeof msg.symbol !== "string") { ws.send(JSON.stringify({ type:WS_TYPES.ERROR, message:"symbol must be a string" })); return; }
          const sym = msg.symbol.toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 10);
          if (!engines[sym]) { ws.send(JSON.stringify({ type:WS_TYPES.ERROR, message:`Unknown symbol: ${sym}`, available:Object.keys(engines) })); return; }
          if (subscribedSymbol && engines[subscribedSymbol]) engines[subscribedSymbol].unsubscribe(ws);
          subscribedSymbol = sym;
          engines[sym].subscribe(ws);
          log.info(`WS ${ws.id} → ${sym}`);
          const eng = engines[sym];
          const analysis = loadSignal(sym);
          const allAnalysis = {};
          for (const s of Object.keys(engines)) {
            const a = loadSignal(s);
            if (a) allAnalysis[s] = a;
          }
          ws.send(JSON.stringify({ type:WS_TYPES.INIT, symbol:sym, candles:eng.candles.slice(-100), current:eng.currentCandle, analysis, allAnalysis, symbols:Object.keys(engines), candleMs:eng.candleMs, source:eng.source, isForex:eng.source==="twelvedata", isFno:eng.source==="angelone", angelConnected:!!angelToken.jwt, aiMode:CONFIG.groqKey?"Groq ⚡ + Local queue":"Local queue only" }));
        }

        if (msg.type === "subscribe_portfolio") {
          portfolioSubscribers.add(ws);
          if (angelToken.jwt) {
            Promise.all([getPortfolio(), getPositions(), getFunds()]).then(([holdings, positions, funds]) => {
              ws.send(JSON.stringify({ type:WS_TYPES.PORTFOLIO, holdings:holdings||[], positions:positions||[], funds:funds||{}, timestamp:Date.now() }));
            }).catch(e => log.error("Portfolio initial fetch:", e.message));
          } else {
            ws.send(JSON.stringify({ type:WS_TYPES.PORTFOLIO, error:"Angel One not connected", holdings:[], positions:[], funds:{} }));
          }
        }
      } catch(e) {
        log.error(`WS ${ws.id} msg error:`, e.message);
        ws.send(JSON.stringify({ type:WS_TYPES.ERROR, message:"Invalid message format" }));
      }
    });

    ws.on("close", () => {
      if (subscribedSymbol && engines[subscribedSymbol]) engines[subscribedSymbol].unsubscribe(ws);
      portfolioSubscribers.delete(ws);
      log.info(`WS disconnected: ${ws.id}`);
    });

    ws.on("error", (e) => log.error(`WS ${ws.id}:`, e.message));
  });

  return wss;
}
