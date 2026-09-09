import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';
import { CONFIG } from '../src/config/index.js';

import {
  MTF_SYMBOLS,
  MTF_TIMEFRAMES,
  analyzeTimeframe,
  buildSummary,
  normalizeCandles,
} from '../src/strategy/mtf/analysis_core.js';

import { queueTwelveDataRequest } from '../src/services/twelve_data_rate_limiter.js';

const OUTPUT_DIR = path.resolve(
  process.env.MTF_ANALYSIS_DIR || path.join('signals_live', 'analysis')
);

const API_KEY =
  CONFIG.twelveKey ??
  process.env.TWELVE_DATA_API_KEY ??
  process.env.TWELVE_DATA_KEY ??
  process.env.TWELVE_API_KEY;

const REQUEST_GAP_MS = Math.max(
  0,
  Number(process.env.MTF_REQUEST_GAP_MS ?? 0)
);

const REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.MTF_REQUEST_TIMEOUT_MS ?? 20_000)
);

const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function outputPath(symbol, timeframe) {
  return path.join(OUTPUT_DIR, `${symbol.key}_${timeframe}.json`);
}

function summaryPath(symbol) {
  return path.join(OUTPUT_DIR, `${symbol.key}_summary.json`);
}

function manifestPath() {
  return path.join(OUTPUT_DIR, '_manifest.json');
}

function isRateLimited(error) {
  return Boolean(
    error?.rateLimited ||
    error?.status === 429 ||
    error?.statusCode === 429 ||
    /credit|limit|rate|429|too many requests/i.test(String(error?.message || ''))
  );
}

function errorInfo(error) {
  return {
    message: String(error?.message || error || 'Unknown error'),
    rateLimited: isRateLimited(error),
    status: error?.status ?? error?.statusCode ?? null
  };
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const tempName = `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const tempPath = path.join(directory, tempName);
  const body = `${JSON.stringify(value, null, 2)}\n`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, body, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function freshEnough(filePath, timeframe) {
  if (FORCE) return false;

  try {
    const existing = await readJson(filePath);
    const generatedAt = Date.parse(existing?.meta?.generatedAtUtc ?? '');
    if (!Number.isFinite(generatedAt)) return false;

    const ttlMs = timeframe === '1h'
      ? 55 * 60_000
      : timeframe === '4h'
        ? 3 * 60 * 60_000
        : 20 * 60 * 60_000;

    return Date.now() - generatedAt < ttlMs;
  } catch {
    return false;
  }
}

async function fetchTwelveDataCandles({ symbol, interval, outputsize }) {
  if (!API_KEY) {
    throw new Error('TWELVE_DATA_API_KEY is not configured.');
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    apikey: API_KEY,
    format: 'JSON',
    timezone: 'UTC'
  });

  return queueTwelveDataRequest(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://api.twelvedata.com/time_series?${params.toString()}`,
        {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        }
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = new Error(payload?.message || `Twelve Data HTTP ${response.status}`);
        error.status = response.status;
        error.rateLimited = response.status === 429 || isRateLimited(error);
        throw error;
      }

      if (payload?.status === 'error' || !Array.isArray(payload?.values)) {
        const error = new Error(
          `Twelve Data ${payload?.message || 'response missing values'}`
        );
        error.rateLimited = isRateLimited(error);
        throw error;
      }

      return {
        source: {
          provider: 'TWELVE_DATA',
          symbol,
          interval,
          fetchedAtUtc: new Date().toISOString()
        },
        values: payload.values
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

async function generateSymbol(symbol) {
  const snapshots = {};
  const timeframes = [];

  for (const timeframe of MTF_TIMEFRAMES) {
    const filePath = outputPath(symbol, timeframe.key);

    if (await freshEnough(filePath, timeframe.key)) {
      const cached = await readJson(filePath);
      snapshots[timeframe.key] = cached;
      timeframes.push({
        timeframe: timeframe.key,
        status: 'CACHED',
        dataQuality: cached?.meta?.dataQuality ?? 'NA'
      });
      console.log(`[MTF] ${symbol.key}/${timeframe.key} cached`);
      continue;
    }

    const response = await fetchTwelveDataCandles({
      symbol: symbol.providerSymbol,
      interval: timeframe.providerInterval,
      outputsize: timeframe.outputSize
    });

    const candles = normalizeCandles(response.values);
    const snapshot = analyzeTimeframe({
      symbol,
      timeframe: timeframe.key,
      candles,
      source: response.source
    });

    await writeJsonAtomic(filePath, snapshot);
    snapshots[timeframe.key] = snapshot;
    timeframes.push({
      timeframe: timeframe.key,
      status: 'GENERATED',
      dataQuality: snapshot.meta?.dataQuality ?? 'NA'
    });

    console.log(
      `[MTF] ${symbol.key}/${timeframe.key} ` +
      `${snapshot.signal.bias} quality=${snapshot.meta.dataQuality}`
    );

    if (REQUEST_GAP_MS > 0) {
      await sleep(REQUEST_GAP_MS);
    }
  }

  const summary = buildSummary({ symbol, snapshots });
  await writeJsonAtomic(summaryPath(symbol), summary);

  console.log(
    `[MTF] ${symbol.key}/summary ${summary.summary.alignment} ` +
    `quality=${summary.meta.dataQuality}`
  );

  return {
    symbol: symbol.key,
    status: 'COMPLETE',
    timeframes,
    generatedAtUtc: summary.meta?.generatedAtUtc ?? new Date().toISOString(),
    dataQuality: summary.meta?.dataQuality ?? 'NA'
  };
}

async function main() {
  if (!API_KEY) {
    throw new Error(
      'TWELVE_DATA_API_KEY, TWELVE_DATA_KEY, or TWELVE_API_KEY is required. No requests were sent.'
    );
  }

  const startedAtUtc = new Date().toISOString();

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(
    `[MTF] Starting analysis-only refresh: ${MTF_SYMBOLS.length} symbols × ` +
    `${MTF_TIMEFRAMES.length} timeframes. executionAllowed=false`
  );

  const completedSymbols = [];
  const failedSymbols = [];

  for (const symbol of MTF_SYMBOLS) {
    try {
      completedSymbols.push(await generateSymbol(symbol));
    } catch (error) {
      const failure = {
        symbol: symbol.key,
        ...errorInfo(error),
        failedAtUtc: new Date().toISOString()
      };

      failedSymbols.push(failure);
      console.error(`[MTF] ${symbol.key} failed: ${failure.message}`);

      // Shared limiter installs a global cooldown after rate-limit failures.
      // Continue so later queued requests can proceed after the safe cooldown.
    }
  }

  const manifest = {
    meta: {
      startedAtUtc,
      generatedAtUtc: new Date().toISOString(),
      outputDir: OUTPUT_DIR,
      markets: ['CRYPTO', 'FOREX'],
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false
    },
    refresh: {
      status: failedSymbols.length === 0
        ? 'COMPLETE'
        : completedSymbols.length > 0
          ? 'PARTIAL'
          : 'FAILED',
      partial: failedSymbols.length > 0 && completedSymbols.length > 0,
      completedCount: completedSymbols.length,
      failedCount: failedSymbols.length
    },
    symbols: MTF_SYMBOLS.map((symbol) => symbol.key),
    completedSymbols,
    failedSymbols,
    failures: failedSymbols
  };

  await writeJsonAtomic(manifestPath(), manifest);

  if (failedSymbols.length === 0) {
    console.log('[MTF] Complete: all analysis snapshots written.');
    return;
  }

  if (completedSymbols.length > 0) {
    console.warn(
      `[MTF] Partial refresh complete: ${completedSymbols.length} completed, ` +
      `${failedSymbols.length} failed. Successful snapshots were preserved.`
    );
    return;
  }

  console.error('[MTF] Refresh failed: no symbol snapshot completed.');
  process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`[MTF] Fatal: ${error.message}`);
  process.exitCode = 1;
});
