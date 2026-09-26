import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFxGoldResearchState,
  runFxGoldResearchRefresh
} from '../src/strategy/fx_gold/research_refresh.js';

const silentLog = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dependencies({ delayMs = 0 } = {}) {
  return {
    apiKey: 'test-only-key',
    wholeRefreshTimeoutMs: 10_000,
    fetchHistory: async (symbol, timeframe) => {
      if (delayMs) await sleep(delayMs);
      return {
        csvPath: `/tmp/${symbol.prefix}_${timeframe.outputSuffix}.csv`,
        rows: 2,
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-01T01:00:00Z'
      };
    },
    runPythonWalkForward: async () => {}
  };
}

test('permits two independent scoped refreshes and rejects a third at capacity', async () => {
  const first = runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'single', symbol: 'EUR_USD', timeframe: '1h' },
    dependencies: dependencies({ delayMs: 80 })
  });
  await sleep(10);

  const second = runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'single', symbol: 'XAU_USD', timeframe: '1h' },
    dependencies: dependencies({ delayMs: 80 })
  });
  await sleep(10);

  assert.equal(getFxGoldResearchState().activeCount, 2);
  assert.equal(getFxGoldResearchState().maxConcurrentRefreshes, 2);

  const third = await runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'single', symbol: 'EUR_USD', timeframe: '4h' },
    dependencies: dependencies()
  });

  assert.equal(third.skipped, true);
  assert.equal(third.reason, 'capacity-reached');
  assert.equal(third.outcome, 'skipped_capacity_reached');

  await Promise.all([first, second]);
  assert.equal(getFxGoldResearchState().activeCount, 0);
});

test('same scope is already-running; full scope conflicts with any active scope', async () => {
  const active = runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'single', symbol: 'EUR_USD', timeframe: '1day' },
    dependencies: dependencies({ delayMs: 80 })
  });
  await sleep(10);

  const same = await runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'single', symbol: 'EUR_USD', timeframe: '1d' },
    dependencies: dependencies()
  });
  assert.equal(same.reason, 'already-running');

  const full = await runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'full' },
    dependencies: dependencies()
  });
  assert.equal(full.reason, 'scope-conflict');
  assert.equal(full.outcome, 'skipped_scope_conflict');

  await active;
  assert.equal(getFxGoldResearchState().activeCount, 0);
});

test('whole-refresh deadline retains completed work and releases capacity', async () => {
  let calls = 0;
  const result = await runFxGoldResearchRefresh({
    log: silentLog,
    scope: { mode: 'full' },
    dependencies: {
      apiKey: 'test-only-key',
      wholeRefreshTimeoutMs: 30,
      fetchHistory: async (symbol, timeframe) => {
        calls += 1;
        return {
          csvPath: `/tmp/${symbol.prefix}_${timeframe.outputSuffix}.csv`,
          rows: 2,
          start: '2026-01-01T00:00:00Z',
          end: '2026-01-01T01:00:00Z'
        };
      },
      runPythonWalkForward: async () => {
        if (calls === 1) await sleep(40);
      }
    }
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.outcome, 'timed_out');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(getFxGoldResearchState().activeCount, 0);
});
