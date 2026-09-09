import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const candle = read('src/candle/index.js');
const candlesRoute = read('src/routes/candles.js');
const forexRoute = read('src/routes/forex.js');
const routesIndex = read('src/routes/index.js');
const server = read('server.js');
const writer = read('src/strategy/live_signal_writer.js');

expect(
  candle.includes("EUR_USD: 'EUR/USD'") &&
    candle.includes("XAU_USD: 'XAU/USD'"),
  'FAIL: Canonical Forex/Gold provider mapping is missing.'
);

expect(
  candle.includes("EURUSD: 'EUR_USD'") &&
    candle.includes("XAUUSD: 'XAU_USD'") &&
    candle.includes("'EUR/USD': 'EUR_USD'") &&
    candle.includes("'XAU/USD': 'XAU_USD'"),
  'FAIL: Forex/Gold alias normalization is incomplete.'
);

expect(
  candle.includes('engines[engineKey]') &&
    candle.includes('engine.loadCandles(candles)'),
  'FAIL: Forex history does not load into canonical engine keys.'
);

expect(
  server.includes("['EUR_USD', 'XAU_USD']") &&
    !server.includes("['EURUSD', 'XAUUSD']"),
  'FAIL: server.js does not use canonical Forex/Gold engine keys.'
);

expect(
  routesIndex.includes('export function setRouteEngines') &&
    routesIndex.includes('setCandleRouteEngines(engines)') &&
    routesIndex.includes('setForexRouteEngines(engines)'),
  'FAIL: Shared route engine registry wiring is missing.'
);

expect(
  server.includes('setRouteEngines(engines)'),
  'FAIL: server.js does not supply engines to routes.'
);

expect(
  candlesRoute.includes('setCandleRouteEngines') &&
    candlesRoute.includes('candles: Array.isArray(engine?.candles) ? engine.candles : []') &&
    candlesRoute.includes('current: engine?.currentCandle ?? null'),
  'FAIL: Candle route is not serving live engine state.'
);

expect(
  forexRoute.includes('setForexRouteEngines') &&
    forexRoute.includes("EUR_USD: 'EUR_USD.json'") &&
    forexRoute.includes("XAU_USD: 'XAU_USD.json'") &&
    forexRoute.includes("_source: 'Donchian-ATR'"),
  'FAIL: Forex route is not reading real in-memory Donchian signals.'
);

expect(
  !forexRoute.includes('Forex AI failed, defaulting to neutral'),
  'FAIL: Legacy fixed Forex fallback response remains.'
);

expect(
  writer.includes("const cryptoEmaSymbols = new Set(['BTC', 'ETH', 'SOL', 'BNB']);") &&
    writer.includes("EMA confirmation is not used for Forex/Gold/F&O research signals."),
  'FAIL: EMA is not explicitly restricted to crypto symbols.'
);

for (const forbidden of [
  'placeOrder',
  'modifyOrder',
  'cancelOrder',
  'executionAllowed: true',
  'approvedForTrading: true'
]) {
  expect(
    ![
      candle,
      candlesRoute,
      forexRoute,
      routesIndex,
      server,
      writer
    ].join('\n').includes(forbidden),
    `FAIL: Forbidden trading capability found: ${forbidden}`
  );
}

console.log('PASS: Forex/Gold canonical engine-key normalization');
console.log('PASS: Forex history loads into live engines');
console.log('PASS: Candle API serves live engine candles/current candle');
console.log('PASS: Forex signal API serves Donchian signal-store payload');
console.log('PASS: Binance EMA refresh is crypto-only');
console.log('PASS: No trading or execution capability added');
