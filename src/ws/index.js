import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { getSignal, getAllSignals } from '../strategy/signal_store.js';
import { ROUTES, CONFIG } from '../config/index.js';

const WSTYPES = Object.freeze({
  SUBSCRIBE: 'subscribe',
  INIT: 'init',
  ERROR: 'error'
});
import { getAngelMarketDataState } from '../angel/index.js';

const SYMBOL_FILE = {
  BTC: 'BTCUSD.json',
  ETH: 'ETHUSD.json',
  SOL: 'SOLUSD.json',
  BNB: 'BNBUSD.json',
  EURUSD: 'EURUSD.json',
  XAUUSD: 'XAUUSD.json',
  NIFTY: 'NIFTY.json',
  BANKNIFTY: 'BANKNIFTY.json',
  SENSEX: 'SENSEX.json'
};

function loadSignal(symbol) {
  try {
    const file = SYMBOL_FILE[symbol];

    if (!file) return null;

    const data = getSignal(file);

    if (!data) return null;

    return {
      signal: data.signal?.action ?? 'NEUTRAL',
      confidence: data.signal?.confidence ?? 0,
      reason: data.signal?.reason ?? '',
      stopPrice: data.signal?.stopPrice ?? null,
      direction: data.signal?.direction ?? 0,
      source: 'Donchian-ATR',
      timestamp: data.meta?.asOf
        ? new Date(data.meta.asOf).getTime()
        : Date.now(),
      indicators: data.indicators ?? {},
      price: data.price ?? null
    };
  } catch {
    return null;
  }
}

function isIndiaMarketHours() {
  const now = new Date();
  const weekday = now.getUTCDay();
  const istHour = (now.getUTCHours() + 5.5) % 24;

  return weekday >= 1 && weekday <= 5 && istHour >= 9 && istHour < 15.5;
}

export function registerWebSocket(server, engines, log) {
  const wss = new WebSocketServer({
    server,
    path: ROUTES.WS
  });

  let lastBulkMessage = null;

  setInterval(() => {
    if (!isIndiaMarketHours()) return;

    const allAnalysis = {};

    for (const symbol of Object.keys(engines)) {
      const analysis = loadSignal(symbol);
      if (analysis) allAnalysis[symbol] = analysis;
    }

    const bulkMessage = JSON.stringify({
      type: 'bulk-analysis',
      allAnalysis
    });

    if (bulkMessage === lastBulkMessage) return;

    lastBulkMessage = bulkMessage;

    for (const engine of Object.values(engines)) {
      for (const socket of engine.subscribers) {
        if (socket.readyState === 1) {
          socket.send(bulkMessage);
        }
      }
    }
  }, 60_000);

  wss.on('connection', (socket) => {
    let subscribedSymbol = null;

    socket.id = crypto.randomUUID().slice(0, 8);
    log.info(`WS connected: ${socket.id}`);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        if (
          typeof message !== 'object' ||
          message === null ||
          typeof message.type !== 'string'
        ) {
          return;
        }

        if (message.type === WSTYPES.SUBSCRIBE) {
          if (typeof message.symbol !== 'string') {
            socket.send(
              JSON.stringify({
                type: WSTYPES.ERROR,
                message: 'symbol must be a string'
              })
            );
            return;
          }

          const symbol = message.symbol
            .toUpperCase()
            .replace(/[^A-Z]/g, '')
            .slice(0, 10);

          if (!engines[symbol]) {
            socket.send(
              JSON.stringify({
                type: WSTYPES.ERROR,
                message: `Unknown symbol: ${symbol}`,
                available: Object.keys(engines)
              })
            );
            return;
          }

          if (subscribedSymbol) {
            engines[subscribedSymbol].unsubscribe(socket);
          }

          subscribedSymbol = symbol;
          engines[symbol].subscribe(socket);
          log.info(`WS ${socket.id} → ${symbol}`);

          const engine = engines[symbol];
          const allAnalysis = getAllSignals();
          const angel = getAngelMarketDataState();

          socket.send(
            JSON.stringify({
              type: WSTYPES.INIT,
              symbol,
              candles: engine.candles.slice(-100),
              current: engine.currentCandle,
              analysis: loadSignal(symbol),
              allAnalysis,
              symbols: Object.keys(engines),
              candleMs: engine.candleMs,
              source: engine.source,
              isForex: engine.source === 'twelvedata',
              isFno: engine.source === 'angelone',
              angelMarketData: {
                enabled: angel.enabled,
                connected: angel.connected,
                status: angel.status,
                marketDataOnly: true,
                executionAllowed: false
              },
              aiMode: CONFIG.groqKey ? 'Groq' : 'Local queue only'
            })
          );

          return;
        }

        if (message.type === 'subscribe-portfolio') {
          socket.send(
            JSON.stringify({
              type: WSTYPES.ERROR,
              message:
                'Portfolio access is disabled. Angel One is configured for research market data only.'
            })
          );
        }
      } catch (error) {
        log.error(`WS ${socket.id} message error:`, error.message);
        socket.send(
          JSON.stringify({
            type: WSTYPES.ERROR,
            message: 'Invalid message format'
          })
        );
      }
    });

    socket.on('close', () => {
      if (subscribedSymbol) {
        engines[subscribedSymbol].unsubscribe(socket);
      }

      log.info(`WS disconnected: ${socket.id}`);
    });

    socket.on('error', (error) => {
      log.error(`WS ${socket.id}:`, error.message);
    });
  });

  return wss;
}
