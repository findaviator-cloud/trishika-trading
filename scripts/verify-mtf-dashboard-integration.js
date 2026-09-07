import fs from 'fs';
import path from 'path';

const requiredFiles = [
  'src/routes/mtf.js',
  'src/strategy/mtf/scheduler.js',
  'scripts/generate-crypto-forex-mtf-analysis.js',
  'src/routes/index.js',
  'server.js',
  'public/index.html'
];

let failures = 0;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failures += 1;
  console.log(`FAIL: ${message}`);
}

for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    pass(`exists ${file}`);
  } else {
    fail(`missing ${file}`);
  }
}

function includesAll(file, snippets) {
  const source = fs.readFileSync(file, 'utf8');
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      fail(`${file} missing expected text: ${snippet}`);
    } else {
      pass(`${file} contains: ${snippet}`);
    }
  }
}

if (fs.existsSync('src/routes/index.js')) {
  includesAll('src/routes/index.js', [
    'import mtfRouter from "./mtf.js";',
    'router.use("/mtf", mtfRouter);'
  ]);
}

if (fs.existsSync('server.js')) {
  includesAll('server.js', [
    "import { startMtfResearchScheduler } from './src/strategy/mtf/scheduler.js';",
    'startMtfResearchScheduler(log);',
    "process.env.ENABLE_ANGEL_ONE_WS === 'true'"
  ]);
}

if (fs.existsSync('public/index.html')) {
  includesAll('public/index.html', [
    'id="mtfResearchBody"',
    "fetch('/api/mtf')",
    'RESEARCH ONLY — EXECUTION DISABLED'
  ]);
}

const forbidden = [
  'placeOrder',
  'routeOrder',
  'openPosition',
  'closePosition',
  'paperTradeCreated',
  'create-crypto-4h-shadow-paper-trade'
];

for (const file of [
  'src/routes/mtf.js',
  'src/strategy/mtf/scheduler.js'
]) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');

  for (const word of forbidden) {
    if (source.includes(word)) {
      fail(`${file} contains forbidden trading reference: ${word}`);
    }
  }
}

const analysisDir = path.resolve('signals_live', 'analysis');
const symbols = [
  'BTC_USD',
  'ETH_USD',
  'SOL_USD',
  'BNB_USD',
  'EUR_USD',
  'XAU_USD'
];

for (const symbol of symbols) {
  const file = path.join(analysisDir, `${symbol}_summary.json`);

  if (!fs.existsSync(file)) {
    console.log(`INFO: Snapshot not yet present: ${file}`);
    continue;
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (data.meta?.tier !== 'RESEARCH') {
      fail(`${symbol} summary tier is not RESEARCH`);
    }

    if (data.meta?.analysisOnly !== true) {
      fail(`${symbol} summary analysisOnly is not true`);
    }

    if (data.meta?.executionAllowed !== false) {
      fail(`${symbol} summary executionAllowed is not false`);
    }

    if (data.meta?.tier === 'RESEARCH' &&
        data.meta?.analysisOnly === true &&
        data.meta?.executionAllowed === false) {
      pass(`${symbol} summary has research-only safety flags`);
    }
  } catch (error) {
    fail(`${symbol} summary invalid JSON: ${error.message}`);
  }
}

console.log('');
console.log(`MTF DASHBOARD INTEGRATION AUDIT | failures=${failures}`);

if (failures > 0) {
  process.exitCode = 1;
}
