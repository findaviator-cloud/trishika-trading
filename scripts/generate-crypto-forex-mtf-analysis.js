import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';
import { CONFIG } from '../src/config/index.js';

import {
  MTF_SYMBOLS,
  MTF_TIMEFRAMES,
  analyzeTimeframe,
  buildSummary,
  normalizeCandles,
} from '../src/strategy/mtf/analysis_core.js';
import { fetchTwelveDataCandles } from '../src/strategy/mtf/twelve_data_client.js';

const OUTPUT_DIR = path.resolve('signals_live', 'analysis');
const API_KEY = CONFIG.twelveKey ?? process.env.TWELVE_DATA_API_KEY ?? process.env.TWELVE_DATA_KEY ?? process.env.TWELVE_API_KEY;
const REQUEST_GAP_MS = Number(process.env.MTF_REQUEST_GAP_MS ?? 1_000);
const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function outputPath(symbol, timeframe) {
  return path.join(OUTPUT_DIR, `${symbol.key}_${timeframe}.json`);
}

function summaryPath(symbol) {
  return path.join(OUTPUT_DIR, `${symbol.key}_summary.json`);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function freshEnough(filePath, timeframe) {
  if (FORCE) return false;

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const existing = JSON.parse(raw);
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

async function generateSymbol(symbol) {
  const snapshots = {};

  for (const timeframe of MTF_TIMEFRAMES) {
    const filePath = outputPath(symbol, timeframe.key);

    if (await freshEnough(filePath, timeframe.key)) {
      snapshots[timeframe.key] = JSON.parse(await fs.readFile(filePath, 'utf8'));
      console.log(`[MTF] ${symbol.key}/${timeframe.key} cached`);
      continue;
    }

    const response = await fetchTwelveDataCandles({
      symbol: symbol.providerSymbol,
      interval: timeframe.providerInterval,
      outputsize: timeframe.outputSize,
      apiKey: API_KEY,
      retries: 1,
    });

    const candles = normalizeCandles(response.values);
    const snapshot = analyzeTimeframe({
      symbol,
      timeframe: timeframe.key,
      candles,
      source: response.source,
    });

    await writeJson(filePath, snapshot);
    snapshots[timeframe.key] = snapshot;

    console.log(
      `[MTF] ${symbol.key}/${timeframe.key} ` +
      `${snapshot.signal.bias} quality=${snapshot.meta.dataQuality}`,
    );

    await sleep(REQUEST_GAP_MS);
  }

  const summary = buildSummary({ symbol, snapshots });
  await writeJson(summaryPath(symbol), summary);

  console.log(
    `[MTF] ${symbol.key}/summary ${summary.summary.alignment} ` +
    `quality=${summary.meta.dataQuality}`,
  );
}

async function main() {
  if (!API_KEY) {
    throw new Error(
      'TWELVE_DATA_KEY or TWELVE_API_KEY is required. No requests were sent.',
    );
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(
    `[MTF] Starting analysis-only refresh: ${MTF_SYMBOLS.length} symbols × ` +
    `${MTF_TIMEFRAMES.length} timeframes. executionAllowed=false`,
  );

  const failures = [];

  for (const symbol of MTF_SYMBOLS) {
    try {
      await generateSymbol(symbol);
    } catch (error) {
      failures.push({ symbol: symbol.key, message: error.message });
      console.error(`[MTF] ${symbol.key} failed: ${error.message}`);
    }
  }

  const manifest = {
    meta: {
      generatedAtUtc: new Date().toISOString(),
      markets: ['CRYPTO', 'FOREX'],
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false,
    },
    symbols: MTF_SYMBOLS.map((symbol) => symbol.key),
    failures,
  };

  await writeJson(path.join(OUTPUT_DIR, '_manifest.json'), manifest);

  if (failures.length) {
    process.exitCode = 1;
    console.error(`[MTF] Finished with ${failures.length} failed symbol(s).`);
  } else {
    console.log('[MTF] Complete: all analysis snapshots written.');
  }
}

main().catch((error) => {
  console.error(`[MTF] Fatal: ${error.message}`);
  process.exitCode = 1;
});
