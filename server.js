import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './src/routes/index.js';
import {
  CandleEngine,
  connectBinance,
  connectTwelveData,
  loadForexHistory
} from './src/candle/index.js';
import {
  startAngelMarketDataLifecycle,
  setAngelLogger
} from './src/angel/index.js';
import { registerWebSocket } from './src/ws/index.js';
import {
  refreshDailyETH,
  refreshDailySOL
} from './src/strategy/live_signal_writer.js';
import { runMonitorCycle } from './src/strategy/monitor.js';
import { startMtfResearchScheduler } from './src/strategy/mtf/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

const log = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log
};

setAngelLogger(log);

app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));

const engines = {};

for (const symbol of ['BTC', 'ETH', 'SOL', 'BNB']) {
  engines[symbol] = new CandleEngine(symbol);
  engines[symbol].source = 'twelvedata';
}

for (const symbol of ['EURUSD', 'XAUUSD']) {
  engines[symbol] = new CandleEngine(symbol);
  engines[symbol].source = 'twelvedata';
}

for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
  engines[symbol] = new CandleEngine(symbol);
  engines[symbol].source = 'angelone';
}

server.listen(port, async () => {
  log.info(`🚀 SERVER: http://localhost:${port}`);
  log.info(`📡 Signal: http://localhost:${port}/api/signal?symbol=BTC`);

  registerWebSocket(server, engines, log);

  connectBinance(engines, log);
  connectTwelveData(engines, log);
  await loadForexHistory(engines, log);

  startAngelMarketDataLifecycle(engines);

  log.info(
    '[ANGEL/MARKET_DATA] Research-only connector initialized. ' +
      'No portfolio, positions, funds, order, or execution action is started.'
  );

  startMtfResearchScheduler(log);

  const DAILY_REFRESH_MS = 60 * 60 * 1_000;
  const DAILY_INITIAL_DELAY_MS = 75 * 1_000;

  async function scheduleDailyRefresh() {
    try {
      await refreshDailyETH();
      await refreshDailySOL();
    } catch (error) {
      log.error('[SCHEDULER] Daily crypto refresh failed:', error.message);
    } finally {
      setTimeout(scheduleDailyRefresh, DAILY_REFRESH_MS);
    }
  }

  setTimeout(() => {
    void scheduleDailyRefresh();
  }, DAILY_INITIAL_DELAY_MS);

  const MONITOR_MS = 5 * 60 * 1_000;

  function scheduleMonitor() {
    Promise.resolve(runMonitorCycle())
      .catch((error) => {
        log.error('[MONITOR] Cycle failed:', error.message);
      })
      .finally(() => {
        setTimeout(scheduleMonitor, MONITOR_MS);
      });
  }

  scheduleMonitor();
});
