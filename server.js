import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './src/routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json());
app.use('/api', routes);

// Serve static frontend from ./public
app.use(express.static(path.join(__dirname, 'public')));

import { refreshDailyETH, refreshDailySOL } from './src/strategy/live_signal_writer.js';
import { runMonitorCycle } from './src/strategy/monitor.js';

app.listen(port, () => {
  console.log(`🚀 SERVER: http://localhost:${port}`);
  console.log(`📡 Signal: http://localhost:${port}/api/signal?symbol=BTC`);

  // Daily ETH signal refresh — runs immediately then every hour
  // Uses nested setTimeout to avoid overlap if fetch takes longer than interval
  const DAILY_REFRESH_MS = 60 * 60 * 1000; // 1 hour
  async function scheduleDailyRefresh() {
    await refreshDailyETH();
    await refreshDailySOL();
    setTimeout(scheduleDailyRefresh, DAILY_REFRESH_MS);
  }
  scheduleDailyRefresh().catch(e => console.error('[SCHEDULER]', e.message));

  const MONITOR_MS = 5 * 60 * 1000;
  function scheduleMonitor() {
    runMonitorCycle();
    setTimeout(scheduleMonitor, MONITOR_MS);
  }
  scheduleMonitor();
});
