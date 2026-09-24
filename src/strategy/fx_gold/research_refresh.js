import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { fetchTwelveDataJson } from '../../services/twelve_data_rate_limiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

const dataDir = path.join(projectRoot, 'data');
const reportsDir = path.join(projectRoot, 'reports');
const pythonRunner = path.join(projectRoot, 'scripts', 'run_fx_gold_walkforward.py');

const SYMBOLS = Object.freeze([
  { asset: 'EUR_USD', providerSymbol: 'EUR/USD', prefix: 'EURUSD' },
  { asset: 'XAU_USD', providerSymbol: 'XAU/USD', prefix: 'XAUUSD' }
]);

const TIMEFRAMES = Object.freeze([
  {
    key: '1h',
    twelveInterval: '1h',
    outputSuffix: '1h',
    defaultLookbackDays: 730
  },
  {
    key: '4h',
    twelveInterval: '4h',
    outputSuffix: '4h',
    defaultLookbackDays: 730
  },
  {
    key: '1day',
    twelveInterval: '1day',
    outputSuffix: '1d',
    defaultLookbackDays: 1825
  }
]);

let running = false;
let lastRunAtUtc = null;
let lastSuccessAtUtc = null;
let lastError = null;
let currentRunStartedAtUtc = null;
let lastOutcome = 'never_run';

function safety() {
  return {
    researchOnly: true,
    approvedForTrading: false,
    brokerConnectivityAllowed: false,
    websocketAllowed: false,
    ordersAllowed: false,
    executionAllowed: false,
    humanReviewRequired: true
  };
}

function getApiKey() {
  return (
    process.env.TWELVE_DATA_API_KEY ||
    process.env.TWELVE_DATA_KEY ||
    process.env.TWELVE_API_KEY ||
    null
  );
}

function getLookbackDays(timeframe) {
  const name = timeframe.key === '1h'
    ? 'FX_GOLD_RESEARCH_LOOKBACK_DAYS_1H'
    : timeframe.key === '4h'
      ? 'FX_GOLD_RESEARCH_LOOKBACK_DAYS_4H'
      : 'FX_GOLD_RESEARCH_LOOKBACK_DAYS_1D';

  const configured = Number(process.env[name]);

  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : timeframe.defaultLookbackDays;
}

function makeSafeNAReturn(asset, timeframe, reason, reasonCode = 'REFRESH_FAILED') {
  return {
    version: 2,
    research_only: true,
    safety: safety(),
    asset,
    symbol: asset === 'EUR_USD' ? 'EUR/USD' : 'XAU/USD',
    timeframe,
    status: 'INSUFFICIENT_DATA',
    oos_only: true,
    provenance: {
      provider: 'TWELVE_DATA',
      providerSymbol: asset === 'EUR_USD' ? 'EUR/USD' : 'XAU/USD',
      sourceGranularity: timeframe,
      barConstruction: 'provider_native',
      notNativeTwelveData: false
    },
    data_quality: {
      passed: false,
      reasonCodes: [reasonCode],
      sourceRows: 0,
      usableRows: 0,
      invalidRowsDropped: 0,
      duplicateRowsDropped: 0,
      largeGapCount: 0,
      expectedInterval: null
    },
    eligibility: {
      eligible: false,
      status: 'INSUFFICIENT_DATA',
      reasonCodes: [reasonCode],
      candidateFolds: 0,
      validCompletedFolds: 0,
      minimumRequiredFolds: 8,
      warmupRequired: true,
      warmupPass: false,
      closedOosTrades: 0,
      minimumRequiredClosedOosTrades: 30,
      dataQualityPass: false
    },
    metrics: {
      total_trades: null,
      win_rate_pct: null,
      total_return_pct: null,
      sharpe_ratio: null,
      max_drawdown_pct: null,
      profit_factor: null,
      average_trade_pct: null,
      long: {
        trades: null,
        win_rate_pct: null,
        total_return_pct: null,
        average_trade_pct: null
      },
      short: {
        trades: null,
        win_rate_pct: null,
        total_return_pct: null,
        average_trade_pct: null
      }
    },
    advisory: {
      level: 'N/A',
      status: 'INSUFFICIENT_DATA',
      message: reason
    },
    warnings: [
      'Historical walk-forward simulation is research only; it is not a prediction or trading recommendation.',
      'Crypto metrics are not used as a fallback for EUR/USD or XAU/USD.',
      'A successful data download does not itself make OOS metrics eligible.'
    ],
    generated_at_utc: new Date().toISOString()
  };
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents, 'utf8');
  fs.renameSync(temporary, filePath);
}

function normalizeCandles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const byTime = new Map();

  for (const item of values) {
    const time = new Date(item.datetime);
    const open = Number(item.open);
    const high = Number(item.high);
    const low = Number(item.low);
    const close = Number(item.close);
    const volume = Number(item.volume ?? 0);

    const valid = (
      Number.isFinite(time.getTime()) &&
      Number.isFinite(open) && open > 0 &&
      Number.isFinite(high) && high > 0 &&
      Number.isFinite(low) && low > 0 &&
      Number.isFinite(close) && close > 0 &&
      high >= low &&
      high >= open &&
      high >= close &&
      low <= open &&
      low <= close
    );

    if (!valid) continue;

    byTime.set(time.toISOString(), {
      time: time.toISOString().replace('.000Z', 'Z'),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0
    });
  }

  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function csvFromRows(rows) {
  const lines = ['time,open,high,low,close,volume'];

  for (const row of rows) {
    lines.push([
      row.time,
      row.open,
      row.high,
      row.low,
      row.close,
      row.volume
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
}

async function fetchHistory(symbol, timeframe, apiKey) {
  const now = new Date();
  const start = new Date(
    now.getTime() - getLookbackDays(timeframe) * 24 * 60 * 60 * 1000
  );

  const params = new URLSearchParams({
    symbol: symbol.providerSymbol,
    interval: timeframe.twelveInterval,
    start_date: start.toISOString().slice(0, 19).replace('T', ' '),
    end_date: now.toISOString().slice(0, 19).replace('T', ' '),
    timezone: 'UTC',
    order: 'ASC',
    apikey: apiKey
  });

  const url = `https://api.twelvedata.com/time_series?${params.toString()}`;
  const payload = await fetchTwelveDataJson(url);
  const rows = normalizeCandles(payload?.values);

  if (!rows.length) {
    throw new Error(
      `${symbol.asset} ${timeframe.key}: provider returned no valid OHLC rows`
    );
  }

  const csvPath = path.join(
    dataDir,
    `${symbol.prefix}_${timeframe.outputSuffix}.csv`
  );

  atomicWrite(csvPath, csvFromRows(rows));

  return {
    csvPath,
    rows: rows.length,
    start: rows[0].time,
    end: rows.at(-1).time
  };
}

function runPythonWalkForward(asset, timeframe, csvPath, reportPath, timeoutMs, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON_BIN || 'python3',
      [
        pythonRunner,
        '--asset', asset,
        '--timeframe', timeframe.key,
        '--csv', csvPath,
        '--output', reportPath
      ],
      {
        cwd: projectRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (stdout.trim()) {
        log?.info?.(`[FX_GOLD/WFO] ${stdout.trim()}`);
      }

      if (stderr.trim()) {
        log?.warn?.(`[FX_GOLD/WFO] ${stderr.trim()}`);
      }

      if (timedOut) {
        reject(new Error(`${asset} ${timeframe.key}: WFO subprocess timed out`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `${asset} ${timeframe.key}: WFO subprocess failed ` +
            `(code=${code}, signal=${signal ?? 'none'})`
          )
        );
        return;
      }

      resolve();
    });
  });
}

function reportPathFor(symbol, timeframe) {
  return path.join(
    reportsDir,
    `${symbol.prefix}_${timeframe.outputSuffix}_walkforward.json`
  );
}

export function getFxGoldResearchState() {
  return {
    running,
    lastRunAtUtc,
    lastSuccessAtUtc,
    currentRunStartedAtUtc,
    lastError,
    lastOutcome,
    tier: 'RESEARCH',
    analysisOnly: true,
    safety: safety()
  };
}

export async function runFxGoldResearchRefresh(log = console) {
  if (running) {
    return {
      skipped: true,
      reason: 'already-running',
      outcome: 'skipped_already_running'
    };
  }

  const apiKey = getApiKey();

  if (!apiKey) {
    const message = 'TWELVE_DATA_API_KEY is not configured; FX/Gold research refresh skipped.';
    lastError = message;
    lastOutcome = 'skipped_missing_api_key';
    log?.warn?.(`[FX_GOLD] ${message}`);

    return {
      skipped: true,
      reason: 'missing-api-key',
      outcome: 'skipped_missing_api_key'
    };
  }

  running = true;
  currentRunStartedAtUtc = new Date().toISOString();
  lastError = null;
  lastOutcome = 'running';

  const timeoutMinutes = Math.max(
    1,
    Number(process.env.FX_GOLD_RESEARCH_WFO_TIMEOUT_MINUTES || 15)
  );

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const results = [];
  let failures = 0;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    for (const symbol of SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        const reportPath = reportPathFor(symbol, timeframe);

        try {
          const downloaded = await fetchHistory(symbol, timeframe, apiKey);

          await runPythonWalkForward(
            symbol.asset,
            timeframe,
            downloaded.csvPath,
            reportPath,
            timeoutMs,
            log
          );

          results.push({
            asset: symbol.asset,
            timeframe: timeframe.key,
            ok: true,
            rows: downloaded.rows,
            coverage: {
              start: downloaded.start,
              end: downloaded.end
            }
          });
        } catch (error) {
          failures += 1;
          const message = `${symbol.asset} ${timeframe.key}: ${error.message}`;

          log?.warn?.(`[FX_GOLD] ${message}`);

          if (!fs.existsSync(reportPath)) {
            atomicWrite(
              reportPath,
              `${JSON.stringify(
                makeSafeNAReturn(
                  symbol.asset,
                  timeframe.key,
                  'Historical provider data or walk-forward computation is not available yet.',
                  'REFRESH_FAILED'
                ),
                null,
                2
              )}\n`
            );
          }

          results.push({
            asset: symbol.asset,
            timeframe: timeframe.key,
            ok: false,
            error: message
          });
        }
      }
    }

    lastRunAtUtc = new Date().toISOString();

    if (failures === 0) {
      lastSuccessAtUtc = lastRunAtUtc;
      lastOutcome = 'completed';
      log?.info?.('[FX_GOLD] Historical refresh and OOS walk-forward reports completed.');
    } else {
      lastOutcome = 'partial_failure';
      lastError = `${failures} FX/Gold research job(s) failed. Existing reports were preserved.`;
      log?.warn?.(`[FX_GOLD] ${lastError}`);
    }

    return {
      skipped: false,
      ok: failures === 0,
      partial: failures > 0,
      outcome: lastOutcome,
      results
    };
  } catch (error) {
    lastRunAtUtc = new Date().toISOString();
    lastError = error.message;
    lastOutcome = 'failed';
    log?.error?.(`[FX_GOLD] Refresh failed: ${error.message}`);

    return {
      skipped: false,
      ok: false,
      partial: false,
      outcome: 'failed',
      error: error.message,
      results
    };
  } finally {
    running = false;
    currentRunStartedAtUtc = null;
  }
}
