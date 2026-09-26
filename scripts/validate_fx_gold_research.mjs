import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = process.cwd();

const required = [
  'src/strategy/fx_gold/research_refresh.js',
  'src/strategy/fx_gold/research_scheduler.js',
  'src/routes/forex_research.js',
  'scripts/run_fx_gold_walkforward.py',
  'config/fx_gold_walkforward.json'
];

let failures = 0;

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function ok(message) {
  console.log(`OK ${message}`);
}

for (const relative of required) {
  const full = path.join(root, relative);

  if (!fs.existsSync(full)) {
    fail(`missing: ${relative}`);
  } else {
    ok(`exists: ${relative}`);
  }
}

let config;

try {
  config = JSON.parse(
    fs.readFileSync(path.join(root, 'config/fx_gold_walkforward.json'), 'utf8')
  );

  if (!config?.assets?.EUR_USD || !config?.assets?.XAU_USD) {
    throw new Error('EUR_USD/XAU_USD configuration missing');
  }

  if (
    config?.eligibility?.minimum_completed_folds !== 8 ||
    config?.eligibility?.minimum_closed_oos_trades !== 30
  ) {
    throw new Error('Golden Rule thresholds must be 8 valid folds and 30 closed OOS trades');
  }

  ok('config: assets and Golden Rule thresholds present');
} catch (error) {
  fail(`config: ${error.message}`);
}

for (const relative of [
  'src/strategy/fx_gold/research_refresh.js',
  'src/strategy/fx_gold/research_scheduler.js',
  'src/routes/forex_research.js'
]) {
  try {
    await import(pathToFileURL(path.join(root, relative)).href);
    ok(`import: ${relative}`);
  } catch (error) {
    fail(`import: ${relative}: ${error.message}`);
  }
}

try {
  const sources = {
    refresh: fs.readFileSync(
      path.join(root, 'src/strategy/fx_gold/research_refresh.js'),
      'utf8'
    ),
    scheduler: fs.readFileSync(
      path.join(root, 'src/strategy/fx_gold/research_scheduler.js'),
      'utf8'
    ),
    route: fs.readFileSync(
      path.join(root, 'src/routes/forex_research.js'),
      'utf8'
    ),
    fetcher: fs.readFileSync(
      path.join(root, 'scripts/fetch_twelvedata_ohlc.py'),
      'utf8'
    ),
    runner: fs.readFileSync(
      path.join(root, 'scripts/run_fx_gold_walkforward.py'),
      'utf8'
    )
  };

  const tokens = [
    [sources.refresh, "key: '4h'"],
    [sources.refresh, "twelveInterval: '4h'"],
    [sources.refresh, "FX_GOLD_RESEARCH_LOOKBACK_DAYS_4H"],
    [sources.scheduler, "03:30 IST"],
    [sources.scheduler, "lastSkipReason"],
    [sources.route, "'4h': '4h'"],
    [sources.route, "['1h', '4h', '1day']"],
    [sources.fetcher, '"4h": "4h"'],
    [sources.runner, 'choices=["1h", "4h", "1day", "1d"]'],
    [sources.runner, 'math.sqrt(6.0 * 252.0)'],
    [sources.runner, '"DATA_QUALITY_FAILED"'],
    [sources.runner, '"INSUFFICIENT_WARMUP"'],
    [sources.runner, '"INSUFFICIENT_FOLDS"'],
    [sources.runner, '"INSUFFICIENT_TRADES"'],
    [sources.runner, '"researchOnly"'],
    [sources.runner, '"humanReviewRequired"'],
    [sources.runner, '"provider": "TWELVE_DATA"'],
    [sources.refresh, "const MAX_CONCURRENT_REFRESHES = 2"],
    [sources.refresh, "const activeRefreshes = new Map()"],
    [sources.refresh, "function scopesConflict(left, right)"],
    [sources.refresh, "'scope-conflict'"],
    [sources.refresh, "reason: 'capacity-reached'"],
    [sources.refresh, "activeRefreshes.delete(key)"],
    [sources.route, "result.reason === 'capacity-reached'"],
  ];

  for (const [source, token] of tokens) {
    if (!source.includes(token)) {
      throw new Error(`Required contract token missing: ${token}`);
    }
  }

  ok('native 4h, Golden Rule, provenance, safety, and scheduler-state contract');
} catch (error) {
  fail(`contract: ${error.message}`);
}

for (const relative of [
  'reports/EURUSD_1h_walkforward.json',
  'reports/EURUSD_4h_walkforward.json',
  'reports/EURUSD_1d_walkforward.json',
  'reports/XAUUSD_1h_walkforward.json',
  'reports/XAUUSD_4h_walkforward.json',
  'reports/XAUUSD_1d_walkforward.json'
]) {
  try {
    const report = JSON.parse(
      fs.readFileSync(path.join(root, relative), 'utf8')
    );

    if (report.status !== 'INSUFFICIENT_DATA') {
      throw new Error('placeholder status must be INSUFFICIENT_DATA');
    }

    if (report?.eligibility?.eligible !== false) {
      throw new Error('placeholder eligibility must be false');
    }

    if (report?.safety?.researchOnly !== true) {
      throw new Error('placeholder researchOnly must be true');
    }

    if (report?.safety?.executionAllowed !== false) {
      throw new Error('placeholder executionAllowed must be false');
    }

    if (report?.provenance?.provider !== 'TWELVE_DATA') {
      throw new Error('placeholder provider must be TWELVE_DATA');
    }

    ok(`placeholder report contract: ${relative}`);
  } catch (error) {
    fail(`placeholder report: ${relative}: ${error.message}`);
  }
}

if (failures) {
  process.exit(1);
}

console.log('FX/Gold Node research validation passed.');
