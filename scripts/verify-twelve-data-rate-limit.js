import fs from 'fs';

const files = [
  'src/services/twelve_data_rate_limiter.js',
  'src/candle/index.js',
  'src/strategy/live_signal_writer.js',
  'src/strategy/monitor.js',
  'server.js'
];

let failures = 0;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failures += 1;
  console.log(`FAIL: ${message}`);
}

for (const file of files) {
  if (fs.existsSync(file)) {
    pass(`exists ${file}`);
  } else {
    fail(`missing ${file}`);
  }
}

const limiter = fs.readFileSync('src/services/twelve_data_rate_limiter.js', 'utf8');
const candle = fs.readFileSync('src/candle/index.js', 'utf8');
const writer = fs.readFileSync('src/strategy/live_signal_writer.js', 'utf8');
const monitor = fs.readFileSync('src/strategy/monitor.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

for (const marker of [
  'MAX_REQUESTS_PER_WINDOW',
  'MIN_GAP_MS',
  'queueTwelveDataRequest',
  'fetchTwelveDataJson'
]) {
  if (limiter.includes(marker)) pass(`limiter marker present: ${marker}`);
  else fail(`limiter marker missing: ${marker}`);
}

for (const [file, source] of [
  ['src/candle/index.js', candle],
  ['src/strategy/live_signal_writer.js', writer]
]) {
  if (source.includes("fetchTwelveDataJson")) {
    pass(`${file} uses shared Twelve Data limiter`);
  } else {
    fail(`${file} does not use shared Twelve Data limiter`);
  }

  if (source.includes("import https")) {
    fail(`${file} still directly imports https for Twelve Data REST`);
  }
}

if (server.includes('const DAILY_INITIAL_DELAY_MS = 75 * 1000;')) {
  pass('server delays initial daily refresh by 75 seconds');
} else {
  fail('server initial daily refresh delay marker missing');
}

const prohibitedMonitorTerms = [
  'routeOrder(',
  'portfolioGate(',
  'openPosition(',
  'closePosition(',
  'paperEquitySnapshot(',
  "from './execution.js'",
  "from './portfolio.js'"
];

for (const term of prohibitedMonitorTerms) {
  if (monitor.includes(term)) {
    fail(`monitor still contains prohibited execution/portfolio reference: ${term}`);
  }
}

if (monitor.includes("executionAllowed: false")) {
  pass('monitor explicitly records executionAllowed=false');
} else {
  fail('monitor research-only marker missing');
}

console.log('');
console.log(`TWELVE DATA RATE-LIMIT + RESEARCH SAFETY AUDIT | failures=${failures}`);

if (failures > 0) {
  process.exitCode = 1;
}
