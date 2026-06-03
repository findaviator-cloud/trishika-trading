import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './src/routes/index.js';
import { CandleEngine, connectBinance, connectTwelveData, loadForexHistory } from './src/candle/index.js';
import { connectAngelOneFeed, angelLogin, loadFnoHistory } from './src/angel/index.js';
import { registerWebSocket } from './src/ws/index.js';
import { refreshDailyETH, refreshDailySOL } from './src/strategy/live_signal_writer.js';
import { runMonitorCycle } from './src/strategy/monitor.js';
import { CONFIG } from './src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));

const log = { info: console.log, warn: console.warn, error: console.error, debug: console.log };

// ── Engines setup ─────────────────────────────────────────────────────────────
const engines = {};

// Crypto engines (Twelve Data)
for (const sym of ['BTC', 'ETH', 'SOL', 'BNB']) {
  engines[sym] = new CandleEngine(sym);
  engines[sym].source = 'twelvedata';
}

// Forex/Gold engines (Twelve Data)
for (const sym of ['EUR_USD', 'XAU_USD']) {
  engines[sym] = new CandleEngine(sym);
  engines[sym].source = 'twelvedata';
}

// India F&O engines (Angel One)
const FNO_SYMS = ['NIFTY','BANKNIFTY','RELIANCE','TCS','INFY','HDFCBANK',
                  'ICICIBANK','SBIN','BHARTIARTL','ITC','WIPRO','HCLTECH',
                  'AXISBANK','KOTAKBANK','LT','ONGC','TATAMOTORS',
                  'BAJFINANCE','MARUTI','ADANIENT'];
for (const sym of FNO_SYMS) {
  engines[sym] = new CandleEngine(sym);
  engines[sym].source = 'angelone';
}

// ── Start server ──────────────────────────────────────────────────────────────
server.listen(port, async () => {
  log.info(`🚀 SERVER: http://localhost:${port}`);
  log.info(`📡 Signal: http://localhost:${port}/api/signal?symbol=BTC`);

  // WebSocket
  registerWebSocket(server, engines, log);

  // Binance WebSocket (Twelve Data REST)
  connectBinance(engines, log);

  // Twelve Data WebSocket
  connectTwelveData(engines, log);
  // Forex/Gold historical candles load
  await loadForexHistory(engines, log);

  // Angel One login + feed
  const angelOk = await angelLogin();
  if (angelOk) connectAngelOneFeed(engines, log);
  if (angelOk) await loadFnoHistory(engines, log);

  // Auto re-login every 5 hours
  setInterval(async () => {
    log.info("Angel One → re-logging in...");
    const ok = await angelLogin();
    if (ok) connectAngelOneFeed(engines, log);
  }, 5 * 60 * 60 * 1000);

  // Daily ETH/SOL refresh
  const DAILY_REFRESH_MS = 60 * 60 * 1000;
  async function scheduleDailyRefresh() {
    await refreshDailyETH();
    await refreshDailySOL();
    setTimeout(scheduleDailyRefresh, DAILY_REFRESH_MS);
  }
  scheduleDailyRefresh().catch(e => log.error('[SCHEDULER]', e.message));

  // Monitor cycle
  const MONITOR_MS = 5 * 60 * 1000;
  function scheduleMonitor() {
    runMonitorCycle();
    setTimeout(scheduleMonitor, MONITOR_MS);
  }
  scheduleMonitor();
});
