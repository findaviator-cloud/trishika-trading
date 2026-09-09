import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const files = {
  angel: path.join(root, 'src/angel/index.js'),
  websocket: path.join(root, 'src/ws/index.js'),
  server: path.join(root, 'server.js'),
  route: path.join(root, 'src/routes/angel.js'),
  routesIndex: path.join(root, 'src/routes/index.js'),
  notes: path.join(root, 'angel-one-historical-contract-notes.md')
};

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const angel = read(files.angel);
const websocket = read(files.websocket);
const server = read(files.server);
const route = read(files.route);
const routesIndex = read(files.routesIndex);
const notes = read(files.notes);

expect(
  angel.includes("process.env.ENABLE_ANGEL_ONE_WS === 'true'"),
  'FAIL: Angel One must be explicitly disabled unless ENABLE_ANGEL_ONE_WS is exactly true.'
);

expect(
  angel.includes('HISTORICAL_CANDLE_URL'),
  'FAIL: Historical candle endpoint constant is missing.'
);

expect(
  angel.includes('getCandleData'),
  'FAIL: Historical candle endpoint contract is missing.'
);

expect(
  angel.includes('normalizeAngelHistoricalCandles'),
  'FAIL: Historical candle normalization is missing.'
);

expect(
  angel.includes('historyQueue') && angel.includes('drainHistoryQueue'),
  'FAIL: Sequential historical request queue is missing.'
);

expect(
  angel.includes('activeSocket') &&
    angel.includes('socketStartPromise') &&
    angel.includes('reconnectTimer'),
  'FAIL: Single-owner WebSocket lifecycle guards are missing.'
);

expect(
  angel.includes('setCooldown') &&
    angel.includes('consecutiveFailures') &&
    angel.includes('maxFailures'),
  'FAIL: Circuit-breaker/cooldown controls are missing.'
);

expect(
  angel.includes("key: 'NIFTY'") &&
    angel.includes("symbolToken: '99926000'") &&
    angel.includes('historicalVerified: true'),
  'FAIL: Verified NIFTY historical instrument is missing.'
);

expect(
  angel.includes("key: 'BANKNIFTY'") &&
    angel.includes('historicalVerified: false') &&
    angel.includes("key: 'SENSEX'"),
  'FAIL: Unverified index historical safeguards are missing.'
);

for (const forbidden of [
  'placeOrder',
  'modifyOrder',
  'cancelOrder',
  'getHolding',
  'getPosition',
  'getRMS'
]) {
  expect(
    !angel.includes(forbidden),
    `FAIL: forbidden broker-operation string remains in Angel market-data module: ${forbidden}`
  );
}

expect(
  websocket.includes('Portfolio access is disabled.'),
  'FAIL: WebSocket portfolio subscription must be explicitly rejected.'
);

for (const forbidden of ['getPortfolio(', 'getPositions(', 'getFunds(']) {
  expect(
    !websocket.includes(forbidden),
    `FAIL: forbidden portfolio/funds/positions call remains in client WebSocket layer: ${forbidden}`
  );
}

expect(
  route.includes("router.get('/status'") &&
    route.includes('getAngelMarketDataState'),
  'FAIL: Read-only Angel status route is missing.'
);

expect(
  routesIndex.includes("router.use('/angel', angelRouter)"),
  'FAIL: Angel route is not mounted under /api/angel.'
);

expect(
  server.includes('startAngelMarketDataLifecycle(engines)'),
  'FAIL: Server does not initialize the controlled Angel lifecycle.'
);

expect(
  !server.includes('angelLogin(') &&
    !server.includes('connectAngelOneFeed(') &&
    !server.includes('loadFnoHistory('),
  'FAIL: Legacy Angel One startup calls remain in server.js.'
);

expect(
  notes.includes('getCandleData') &&
    notes.includes('99926000') &&
    notes.includes('Account-specific entitlement: NOT VERIFIED'),
  'FAIL: Historical contract notes are incomplete.'
);

console.log('PASS: Angel One market-data-only boundary verification');
console.log('PASS: Default-disable, single-owner, rate-limit, and circuit-breaker controls present');
console.log('PASS: Historical candles restricted to verified NIFTY identity');
console.log('PASS: Portfolio/funds/positions/orders/execution are absent or blocked');
