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
import { startMtfResearchScheduler } from './src/strategy/mtf/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;
const ANGEL_ONE_WS_ENABLED = process.env.ENABLE_ANGEL_ONE_WS === 'true';

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
const FNO_SYMS = ['NIFTY','BANKNIFTY','SENSEX'];
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

  // Angel One/F&O remains disabled unless explicitly enabled.
  if (ANGEL_ONE_WS_ENABLED) {
    const angelOk = await angelLogin();
    if (angelOk) connectAngelOneFeed(engines, log);
    if (angelOk) await loadFnoHistory(engines, log);

    setInterval(async () => {
      log.info("Angel One → re-logging in...");
      const ok = await angelLogin();
      if (ok) connectAngelOneFeed(engines, log);
    }, 5 * 60 * 60 * 1000);
  } else {
    log.info('Angel One login skipped — ENABLE_ANGEL_ONE_WS is not true.');
  }

  // MTF snapshots are research-only; no execution path is connected.
  startMtfResearchScheduler(log);

  // Daily ETH/SOL refresh is delayed after startup to avoid Twelve Data credit bursts.
  const DAILY_REFRESH_MS = 60 * 60 * 1000;
  const DAILY_INITIAL_DELAY_MS = 75 * 1000;
  async function scheduleDailyRefresh() {
    await refreshDailyETH();
    await refreshDailySOL();
    setTimeout(scheduleDailyRefresh, DAILY_REFRESH_MS);
  }
  setTimeout(() => {
    scheduleDailyRefresh().catch((error) => log.error('[SCHEDULER]', error.message));
  }, DAILY_INITIAL_DELAY_MS);

  // Monitor cycle
  const MONITOR_MS = 5 * 60 * 1000;
  function scheduleMonitor() {
    runMonitorCycle();
    setTimeout(scheduleMonitor, MONITOR_MS);
  }
  scheduleMonitor();
});
