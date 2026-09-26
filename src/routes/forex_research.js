import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  getFxGoldResearchState,
  runFxGoldResearchRefresh
} from '../strategy/fx_gold/research_refresh.js';
import {
  getFxGoldResearchSchedulerState
} from '../strategy/fx_gold/research_scheduler.js';
import {
  getTwelveDataRateLimiterState
} from '../services/twelve_data_rate_limiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const reportsDir = path.join(projectRoot, 'reports');

const router = express.Router();

const SYMBOLS = Object.freeze({
  EUR_USD: 'EURUSD',
  XAU_USD: 'XAUUSD'
});

const TIMEFRAMES = Object.freeze({
  '1h': '1h',
  '4h': '4h',
  '1day': '1d',
  '1d': '1d'
});

function meta() {
  return {
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };
}

function normalizeSymbol(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace('/', '_')
    .replace('-', '_');
}

function normalizeTimeframe(value) {
  return String(value ?? '1h').trim().toLowerCase();
}

function reportPath(symbol, timeframe) {
  return path.join(
    reportsDir,
    `${SYMBOLS[symbol]}_${TIMEFRAMES[timeframe]}_walkforward.json`
  );
}

function readReport(symbol, timeframe) {
  const filePath = reportPath(symbol, timeframe);

  if (!fs.existsSync(filePath)) {
    return {
      available: false,
      error: 'FX/Gold walk-forward research report is not available yet.',
      report: null
    };
  }

  try {
    const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    return {
      available: true,
      error: null,
      report
    };
  } catch {
    return {
      available: false,
      error: 'FX/Gold walk-forward research report could not be read.',
      report: null
    };
  }
}

function safeSecretMatch(provided, configured) {
  if (!provided || !configured) return false;

  const left = Buffer.from(String(provided).trim());
  const right = Buffer.from(String(configured).trim());

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function hasOwnQuery(req, name) {
  return Object.prototype.hasOwnProperty.call(req.query ?? {}, name);
}

function getSingleQueryValue(req, name) {
  const value = req.query?.[name];

  if (
    Array.isArray(value) ||
    value === null ||
    typeof value === 'object'
  ) {
    return { ok: false, value: null };
  }

  return {
    ok: typeof value === 'string',
    value: typeof value === 'string' ? value : null
  };
}

function parseRefreshScope(req) {
  const hasSymbol = hasOwnQuery(req, 'symbol');
  const hasTimeframe = hasOwnQuery(req, 'timeframe');

  if (!hasSymbol && !hasTimeframe) {
    return {
      ok: true,
      scope: { mode: 'full' }
    };
  }

  if (!hasSymbol || !hasTimeframe) {
    return {
      ok: false,
      error: 'Provide both supported query parameters symbol and timeframe, or provide neither for a full refresh.'
    };
  }

  const rawSymbol = getSingleQueryValue(req, 'symbol');
  const rawTimeframe = getSingleQueryValue(req, 'timeframe');

  if (!rawSymbol.ok || !rawTimeframe.ok) {
    return {
      ok: false,
      error: 'symbol and timeframe must each be a single non-empty string.'
    };
  }

  const symbol = normalizeSymbol(rawSymbol.value);
  const requestedTimeframe = String(rawTimeframe.value).trim().toLowerCase();
  const timeframe = requestedTimeframe === '1d' ? '1day' : requestedTimeframe;

  if (!symbol || !timeframe || !SYMBOLS[symbol] || !TIMEFRAMES[timeframe]) {
    return {
      ok: false,
      error: 'Unsupported refresh scope.'
    };
  }

  return {
    ok: true,
    scope: {
      mode: 'single',
      symbol,
      timeframe
    }
  };
}

router.get('/research', (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol || req.query.pair || 'EUR_USD');
  const timeframe = normalizeTimeframe(req.query.timeframe || '1h');

  if (!SYMBOLS[symbol]) {
    return res.status(404).json({
      error: `Unknown Forex/Gold symbol: ${symbol}`,
      supportedSymbols: Object.keys(SYMBOLS),
      meta: meta()
    });
  }

  if (!TIMEFRAMES[timeframe]) {
    return res.status(400).json({
      error: `Unsupported timeframe: ${timeframe}`,
      supportedTimeframes: ['1h', '4h', '1day'],
      meta: meta()
    });
  }

  const result = readReport(symbol, timeframe);

  return res.json({
    symbol,
    timeframe: timeframe === '1d' ? '1day' : timeframe,
    available: result.available,
    error: result.error,
    report: result.report,
    research: getFxGoldResearchState(),
    scheduler: getFxGoldResearchSchedulerState(),
    providerRateLimiter: getTwelveDataRateLimiterState(),
    meta: meta()
  });
});

router.get('/research/status', (_req, res) => {
  const reports = [];

  for (const symbol of Object.keys(SYMBOLS)) {
    for (const timeframe of ['1h', '4h', '1day']) {
      const result = readReport(symbol, timeframe);

      reports.push({
        symbol,
        timeframe,
        available: result.available,
        status: result.report?.status ?? 'NOT_AVAILABLE',
        generatedAtUtc: result.report?.generated_at_utc ?? null,
        error: result.error
      });
    }
  }

  return res.json({
    reports,
    research: getFxGoldResearchState(),
    scheduler: getFxGoldResearchSchedulerState(),
    providerRateLimiter: getTwelveDataRateLimiterState(),
    meta: meta()
  });
});

router.post('/research/refresh', async (req, res) => {
  const configuredSecret = process.env.FOREX_RESEARCH_REFRESH_SECRET;
  const providedSecret = req.get('x-forex-research-refresh-secret');

  if (!configuredSecret) {
    return res.status(503).json({
      ok: false,
      error: 'Forex research refresh is not configured on this server.',
      meta: meta()
    });
  }

  if (!safeSecretMatch(providedSecret, configuredSecret)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      meta: meta()
    });
  }

  const state = getFxGoldResearchState();

  if (state.running) {
    return res.status(409).json({
      ok: false,
      error: 'FX/Gold research refresh is already running.',
      research: state,
      meta: meta()
    });
  }

  const parsedScope = parseRefreshScope(req);

  if (!parsedScope.ok) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_REFRESH_SCOPE',
      message: parsedScope.error,
      allowedSymbols: Object.keys(SYMBOLS),
      allowedTimeframes: ['1h', '4h', '1day'],
      meta: meta()
    });
  }

  const result = await runFxGoldResearchRefresh({
    log: console,
    scope: parsedScope.scope
  });

  return res.status(result.ok ? 200 : result.partial ? 207 : 502).json({
    ok: result.ok,
    partial: Boolean(result.partial),
    scope: result.scope,
    result,
    research: getFxGoldResearchState(),
    scheduler: getFxGoldResearchSchedulerState(),
    providerRateLimiter: getTwelveDataRateLimiterState(),
    meta: meta()
  });
});

export default router;
