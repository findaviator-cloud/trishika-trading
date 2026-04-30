import crypto from "crypto";
import { WebSocketServer } from "ws";
import { ROUTES, WS_TYPES, CONFIG } from "../config/index.js";
import { getPortfolio, getPositions, getFunds, angelToken } from "../angel/index.js";

export function registerWebSocket(server, engines, log) {
  const wss = new WebSocketServer({ server, path: ROUTES.WS });
  const portfolioSubscribers = new Set();

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
          const sym = msg.symbol.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
          if (!engines[sym]) { ws.send(JSON.stringify({ type:WS_TYPES.ERROR, message:`Unknown symbol: ${sym}`, available:Object.keys(engines) })); return; }
          if (subscribedSymbol && engines[subscribedSymbol]) engines[subscribedSymbol].unsubscribe(ws);
          subscribedSymbol = sym;
          engines[sym].subscribe(ws);
          log.info(`WS ${ws.id} → ${sym}`);
          const eng = engines[sym];
          ws.send(JSON.stringify({ type:WS_TYPES.INIT, symbol:sym, candles:eng.candles.slice(-100), current:eng.currentCandle, analysis:eng.lastAnalysis, symbols:Object.keys(engines), candleMs:eng.candleMs, source:eng.source, isForex:eng.source==="twelvedata", isFno:eng.source==="angelone", angelConnected:!!angelToken.jwt, aiMode:CONFIG.groqKey?"Groq ⚡ + Local queue":"Local queue only" }));
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

// return removedwss;
}
