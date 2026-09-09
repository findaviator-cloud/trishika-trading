import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  runMtfResearchRefresh,
  getMtfSchedulerState
} from '../strategy/mtf/scheduler.js';
import {
  getTwelveDataRateLimiterState
} from '../services/twelve_data_rate_limiter.js';

const router = express.Router();

const ANALYSIS_DIR = path.resolve(
  process.env.MTF_ANALYSIS_DIR || path.join('signals_live', 'analysis')
);

const SYMBOLS = Object.freeze([
  'BTC_USD',
  'ETH_USD',
  'SOL_USD',
  'BNB_USD',
  'EUR_USD',
  'XAU_USD'
]);

const STALE_AFTER_MS = Math.max(
  60_000,
  Number(process.env.MTF_SNAPSHOT_STALE_AFTER_MS || 6 * 60 * 60 * 1000)
);

function researchMeta() {
  return {
    tier: 'RESEARCH',
    analysisOnly: true,
    executionAllowed: false
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readManifest() {
  const filePath = path.join(ANALYSIS_DIR, '_manifest.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function snapshotFreshness(generatedAtUtc) {
  const generatedAtMs = Date.parse(generatedAtUtc || '');

  if (!Number.isFinite(generatedAtMs)) {
    return {
      generatedAtUtc: generatedAtUtc ?? null,
      ageMs: null,
      stale: true
    };
  }

  const ageMs = Math.max(0, Date.now() - generatedAtMs);

  return {
    generatedAtUtc,
    ageMs,
    stale: ageMs > STALE_AFTER_MS
  };
}

function safeSummary(symbol) {
  const filePath = path.join(ANALYSIS_DIR, `${symbol}_summary.json`);

  if (!fs.existsSync(filePath)) {
    return {
      symbol,
      available: false,
      error: 'MTF snapshot is not available yet.',
      freshness: {
        generatedAtUtc: null,
        ageMs: null,
        stale: true
      },
      meta: researchMeta()
    };
  }

  try {
    const snapshot = readJson(filePath);
    const freshness = snapshotFreshness(snapshot.meta?.generatedAtUtc);

    return {
      symbol,
      available: true,
      freshness,
      meta: {
        key: snapshot.meta?.key ?? symbol,
        market: snapshot.meta?.market ?? null,
        generatedAtUtc: snapshot.meta?.generatedAtUtc ?? null,
        dataQuality: snapshot.meta?.dataQuality ?? 'NA',
        tier: snapshot.meta?.tier ?? 'RESEARCH',
        analysisOnly: snapshot.meta?.analysisOnly === true,
        executionAllowed: false
      },
      summary: {
        alignment: snapshot.summary?.alignment ?? 'NEUTRAL',
        longBiasCount: snapshot.summary?.longBiasCount ?? 0,
        shortBiasCount: snapshot.summary?.shortBiasCount ?? 0,
        neutralCount: snapshot.summary?.neutralCount ?? 0,
        reason: snapshot.summary?.reason ?? ''
      },
      timeframes: {
        '1h': snapshot.timeframes?.['1h'] ?? null,
        '4h': snapshot.timeframes?.['4h'] ?? null,
        '1d': snapshot.timeframes?.['1d'] ?? null
      }
    };
  } catch {
    return {
      symbol,
      available: false,
      error: 'MTF snapshot could not be read.',
      freshness: {
        generatedAtUtc: null,
        ageMs: null,
        stale: true
      },
      meta: researchMeta()
    };
  }
}

function normalizeSymbol(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace('/', '_')
    .replace('-', '_');
}

function timingSafeSecretMatch(provided, configured) {
  if (!provided || !configured) {
    return false;
  }

  const providedBuffer = Buffer.from(String(provided));
  const configuredBuffer = Buffer.from(String(configured));

  return (
    providedBuffer.length === configuredBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, configuredBuffer)
  );
}

router.get('/status', (_req, res) => {
  const manifest = readManifest();
  const symbols = SYMBOLS.map(safeSummary);

  return res.json({
    meta: {
      ...researchMeta(),
      updatedAtUtc: new Date().toISOString(),
      analysisDir: ANALYSIS_DIR,
      snapshotStaleAfterMs: STALE_AFTER_MS
    },
    scheduler: getMtfSchedulerState(),
    providerRateLimiter: getTwelveDataRateLimiterState(),
    lastRefresh: manifest?.refresh ?? {
      status: 'NOT_RUN',
      partial: false,
      completedCount: 0,
      failedCount: 0
    },
    manifestMeta: manifest?.meta ?? null,
    symbols: symbols.map((item) => ({
      symbol: item.symbol,
      available: item.available,
      freshness: item.freshness,
      dataQuality: item.meta?.dataQuality ?? 'NA',
      error: item.error ?? null
    }))
  });
});

router.post('/refresh', async (req, res) => {
  const configuredSecret = process.env.MTF_REFRESH_SECRET;
  const providedSecret = req.get('x-mtf-refresh-secret');

  if (!configuredSecret) {
    console.error('[MTF] Refresh rejected: MTF_REFRESH_SECRET is not configured.');

    return res.status(503).json({
      ok: false,
      error: 'MTF refresh is not configured on this server.',
      meta: researchMeta()
    });
  }

  if (!timingSafeSecretMatch(providedSecret, configuredSecret)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      meta: researchMeta()
    });
  }

  const before = getMtfSchedulerState();

  if (before.running) {
    return res.status(409).json({
      ok: false,
      error: 'MTF refresh is already running.',
      scheduler: before,
      meta: researchMeta()
    });
  }

  const startedAtUtc = new Date().toISOString();
  console.log(`[MTF] Protected manual refresh requested at ${startedAtUtc}`);

  try {
    const result = await runMtfResearchRefresh(console);

    if (result.skipped) {
      return res.status(409).json({
        ok: false,
        error: 'MTF refresh is already running.',
        result,
        scheduler: getMtfSchedulerState(),
        meta: researchMeta()
      });
    }

    const manifest = readManifest();
    const refresh = manifest?.refresh ?? null;
    const totalFailure = result.code !== 0 || refresh?.status === 'FAILED';

    return res.status(totalFailure ? 502 : 200).json({
      ok: !totalFailure,
      partial: refresh?.status === 'PARTIAL',
      message: totalFailure
        ? 'MTF refresh process did not complete successfully.'
        : refresh?.status === 'PARTIAL'
          ? 'MTF refresh completed partially; successful snapshots were preserved.'
          : 'MTF refresh completed.',
      startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      result,
      refresh,
      scheduler: getMtfSchedulerState(),
      providerRateLimiter: getTwelveDataRateLimiterState(),
      meta: researchMeta()
    });
  } catch (error) {
    console.error('[MTF] Protected manual refresh failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'MTF refresh failed.',
      detail: error.message,
      scheduler: getMtfSchedulerState(),
      providerRateLimiter: getTwelveDataRateLimiterState(),
      meta: researchMeta()
    });
  }
});

router.get('/', (_req, res) => {
  const snapshots = SYMBOLS.map(safeSummary);

  res.json({
    meta: {
      ...researchMeta(),
      source: 'generated-snapshots-only',
      updatedAtUtc: new Date().toISOString(),
      analysisDir: ANALYSIS_DIR
    },
    symbols: snapshots
  });
});

router.get('/:symbol', (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);

  if (!SYMBOLS.includes(symbol)) {
    return res.status(404).json({
      error: `Unknown MTF symbol: ${symbol}`,
      supportedSymbols: SYMBOLS,
      meta: researchMeta()
    });
  }

  return res.json(safeSummary(symbol));
});

export default router;
