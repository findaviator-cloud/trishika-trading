import { WebSocket } from 'ws';
import { CONFIG, WS_TYPES, TWELVE_TO_SYMBOL } from '../config/index.js';
import { writeDonchianSignal } from '../strategy/live_signal_writer.js';
import { fetchTwelveDataJson } from '../services/twelve_data_rate_limiter.js';

export const FOREX_ENGINE_KEYS = Object.freeze({
  EUR_USD: 'EUR/USD',
  XAU_USD: 'XAU/USD'
});

export function normalizeLiveSymbol(value) {
  const raw = String(value ?? '').trim().toUpperCase();

  const aliases = {
    EURUSD: 'EUR_USD',
    EUR_USD: 'EUR_USD',
    'EUR/USD': 'EUR_USD',
    XAUUSD: 'XAU_USD',
    XAU_USD: 'XAU_USD',
    'XAU/USD': 'XAU_USD'
  };

  return aliases[raw] ?? raw.replace(/[^A-Z0-9_]/g, '');
}

async function fetchTwelveHourly(symbol, limit = 200) {
  const key = CONFIG.twelveKey;

  if (!key) {
    throw new Error('Twelve Data key is not configured.');
  }

  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=1h&outputsize=${limit}&apikey=${key}`;

  const parsed = await fetchTwelveDataJson(url);

  if (!Array.isArray(parsed.values)) {
    throw new Error('Twelve Data response did not contain candle values.');
  }

  const candles = parsed.values
    .map((row) => ({
      time: Date.parse(row.datetime),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: 0
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((left, right) => left.time - right.time);

  if (!candles.length) {
    throw new Error('Twelve Data response did not contain usable hourly candles.');
  }

  return candles;
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
    this.source = 'twelvedata';
  }

  onTick(price, qty, time) {
    const numericPrice = Number(price);
    const numericQty = Number(qty);
    const numericTime = Number(time);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isFinite(numericTime)
    ) {
      return;
    }

    const bucketTime =
      Math.floor(numericTime / this.candleMs) * this.candleMs;

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
        open: numericPrice,
        high: numericPrice,
        low: numericPrice,
        close: numericPrice,
        volume: Number.isFinite(numericQty) ? numericQty : 0
      };
    } else {
      this.currentCandle.high = Math.max(
        this.currentCandle.high,
        numericPrice
      );
      this.currentCandle.low = Math.min(
        this.currentCandle.low,
        numericPrice
      );
      this.currentCandle.close = numericPrice;
      this.currentCandle.volume += Number.isFinite(numericQty)
        ? numericQty
        : 0;
    }

    this.broadcast({
      type: WS_TYPES.TICK,
      candle: this.currentCandle,
      symbol: this.symbol
    });
  }

  loadCandles(candles) {
    const normalized = Array.isArray(candles)
      ? candles
          .filter(
            (candle) =>
              Number.isFinite(candle?.time) &&
              Number.isFinite(candle?.open) &&
              Number.isFinite(candle?.high) &&
              Number.isFinite(candle?.low) &&
              Number.isFinite(candle?.close)
          )
          .sort((left, right) => left.time - right.time)
      : [];

    this.candles = normalized.slice(-CONFIG.maxCandles);

    if (this.candles.length > 0) {
      writeDonchianSignal(this.symbol, this.candles);
    }
  }

  getIndicators() {
    return null;
  }

  broadcast(message) {
    const data = JSON.stringify(message);

    for (const socket of this.subscribers) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    }
  }

  subscribe(socket) {
    this.subscribers.add(socket);
  }

  unsubscribe(socket) {
    this.subscribers.delete(socket);
  }
}

const CRYPTO_SYMBOLS = Object.freeze({
  BTC: 'BTC/USD',
  ETH: 'ETH/USD',
  SOL: 'SOL/USD',
  BNB: 'BNB/USD'
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectBinance(engines, log) {
  log.info('Crypto → using Twelve Data REST (Binance blocked on Render)');

  async function pollCrypto() {
    for (const [symbol, providerSymbol] of Object.entries(CRYPTO_SYMBOLS)) {
      try {
        const candles = await fetchTwelveHourly(providerSymbol, 200);
        const engine = engines[symbol];

        if (!engine) continue;

        engine.loadCandles(candles);

        const last = candles.at(-1);
        log.info(`[CRYPTO] ${symbol} updated — last close: ${last.close}`);
      } catch (error) {
        log.error(`[CRYPTO] ${symbol} fetch failed:`, error.message);
      }
    }

    await sleep(15 * 60_000);

    void pollCrypto().catch((error) => {
      log.error('[CRYPTO] Poll loop failed:', error.message);
    });
  }

  void pollCrypto().catch((error) => {
    log.error('[CRYPTO] Initial poll failed:', error.message);
  });
}

export async function loadForexHistory(engines, log) {
  for (const [engineKey, providerSymbol] of Object.entries(FOREX_ENGINE_KEYS)) {
    try {
      const candles = await fetchTwelveHourly(providerSymbol, 200);
      const engine = engines[engineKey];

      if (!engine) {
        log.warn(
          `[FOREX] ${engineKey} engine is missing; history was not loaded.`
        );
        continue;
      }

      engine.loadCandles(candles);

      const last = candles.at(-1);

      log.info(
        `[FOREX] ${engineKey} history loaded — ${candles.length} candles, ` +
          `last close: ${last.close}`
      );
    } catch (error) {
      log.error(
        `[FOREX] ${engineKey} history load failed:`,
        error.message
      );
    }
  }
}

export function connectTwelveData(engines, log) {
  if (!CONFIG.twelveKey) {
    log.warn('Twelve Data key missing — Forex & Gold disabled');
    return;
  }

  const socket = new WebSocket(
    `wss://ws.twelvedata.com/v1/quotes/price?apikey=${CONFIG.twelveKey}`
  );

  socket.on('open', () => {
    log.info('Twelve Data WS connected');

    const symbols = Object.values(CONFIG.forexSymbols);

    socket.send(
      JSON.stringify({
        action: 'subscribe',
        params: { symbols: symbols.join(',') }
      })
    );

    log.info(`Twelve Data → subscribed: ${symbols.join(', ')}`);
  });

  socket.on('close', () => {
    log.warn('Twelve Data WS closed — reconnecting in 60s...');
    setTimeout(() => connectTwelveData(engines, log), 60_000);
  });

  socket.on('error', (error) => {
    log.error('Twelve Data WS:', error.message);
  });

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw);

      if (message.event === 'heartbeat') return;

      if (message.event === 'subscribe-status') {
        log.info('Twelve Data subscribed:', JSON.stringify(message));
        return;
      }

      if (message.event !== 'price' || !message.price) {
        return;
      }

      const mapped =
        TWELVE_TO_SYMBOL[message.symbol] ??
        normalizeLiveSymbol(message.symbol);

      const engineKey = normalizeLiveSymbol(mapped);
      const engine = engines[engineKey];

      if (!engine) return;

      engine.onTick(
        Number(message.price),
        1,
        message.timestamp ? Number(message.timestamp) * 1_000 : Date.now()
      );
    } catch (error) {
      log.error('Twelve Data parse:', error.message);
    }
  });
}
