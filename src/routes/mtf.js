import express from 'express';
import fs from 'fs';
import path from 'path';
import { runMtfResearchRefresh, getMtfSchedulerState } from '../strategy/mtf/scheduler.js';

const router = express.Router();
const ANALYSIS_DIR = path.resolve('signals_live', 'analysis');

const SYMBOLS = Object.freeze([
  'BTC_USD',
  'ETH_USD',
  'SOL_USD',
  'BNB_USD',
  'EUR_USD',
  'XAU_USD'
]);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function safeSummary(symbol) {
  const filePath = path.join(ANALYSIS_DIR, `${symbol}_summary.json`);

  if (!fs.existsSync(filePath)) {
    return {
      symbol,
      available: false,
      error: 'MTF snapshot is not available yet.',
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    };
  }

  try {
    const snapshot = readJson(filePath);

    return {
      symbol,
      available: true,
      meta: {
        key: snapshot.meta?.key ?? symbol,
        market: snapshot.meta?.market ?? null,
        generatedAtUtc: snapshot.meta?.generatedAtUtc ?? null,
        dataQuality: snapshot.meta?.dataQuality ?? 'NA',
        tier: snapshot.meta?.tier ?? 'RESEARCH',
        analysisOnly: snapshot.meta?.analysisOnly === true,
        executionAllowed: snapshot.meta?.executionAllowed === false ? false : false
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
  } catch (error) {
    return {
      symbol,
      available: false,
      error: 'MTF snapshot could not be read.',
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
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


router.post('/refresh', async (req, res) => {
  const configuredSecret = process.env.MTF_REFRESH_SECRET;
  const providedSecret = req.get('x-mtf-refresh-secret');

  if (!configuredSecret) {
    console.error('[MTF] Refresh rejected: MTF_REFRESH_SECRET is not configured.');

    return res.status(503).json({
      ok: false,
      error: 'MTF refresh is not configured on this server.',
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    });
  }

  if (!providedSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    });
  }

  const before = getMtfSchedulerState();

  if (before.running) {
    return res.status(409).json({
      ok: false,
      error: 'MTF refresh is already running.',
      scheduler: before
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
        meta: {
          tier: 'RESEARCH',
          analysisOnly: true,
          executionAllowed: false
        }
      });
    }

    const status = result.code === 0 ? 200 : 502;

    return res.status(status).json({
      ok: result.code === 0,
      message: result.code === 0
        ? 'MTF refresh completed.'
        : 'MTF refresh process did not complete successfully.',
      startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      result,
      scheduler: getMtfSchedulerState(),
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    });
  } catch (error) {
    console.error('[MTF] Protected manual refresh failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'MTF refresh failed.',
      detail: error.message,
      scheduler: getMtfSchedulerState(),
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    });
  }
});

router.get('/', (_req, res) => {
  const snapshots = SYMBOLS.map(safeSummary);

  res.json({
    meta: {
      tier: 'RESEARCH',
      analysisOnly: true,
      executionAllowed: false,
      source: 'generated-snapshots-only',
      updatedAtUtc: new Date().toISOString()
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
      meta: {
        tier: 'RESEARCH',
        analysisOnly: true,
        executionAllowed: false
      }
    });
  }

  return res.json(safeSummary(symbol));
});

export default router;
