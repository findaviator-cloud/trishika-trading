import { runFxGoldResearchRefresh } from './research_refresh.js';

let timer = null;
let running = false;
let nextRunAtUtc = null;
let lastAttemptAtUtc = null;
let lastCompletedAtUtc = null;
let lastOutcome = 'never_scheduled';
let lastSkipReason = null;
let lastError = null;

const AUTO_ENABLED =
  process.env.FX_GOLD_RESEARCH_AUTO_REFRESH_ENABLED === 'true';

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

function targetDelayMs() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  const currentMinutes =
    Number(parts.hour) * 60 + Number(parts.minute);

  const targetMinutes = 3 * 60 + 30;

  const minutesUntil = currentMinutes < targetMinutes
    ? targetMinutes - currentMinutes
    : (24 * 60 - currentMinutes + targetMinutes);

  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  return Math.max(
    30_000,
    minutesUntil * 60_000 - seconds * 1_000 - milliseconds
  );
}

function scheduleNext(log) {
  const delay = targetDelayMs();
  nextRunAtUtc = new Date(Date.now() + delay).toISOString();

  timer = setTimeout(async () => {
    running = true;
    lastAttemptAtUtc = new Date().toISOString();
    lastSkipReason = null;
    lastError = null;

    try {
      const result = await runFxGoldResearchRefresh(log);

      if (result?.skipped) {
        lastOutcome = result.outcome || 'skipped';
        lastSkipReason = result.reason || 'unknown';
      } else if (result?.ok) {
        lastOutcome = 'completed';
        lastCompletedAtUtc = new Date().toISOString();
      } else if (result?.partial) {
        lastOutcome = 'partial_failure';
      } else {
        lastOutcome = result?.outcome || 'failed';
        lastError = result?.error || null;
      }
    } catch (error) {
      lastOutcome = 'failed';
      lastError = error.message;
      log?.error?.(`[FX_GOLD] Scheduled refresh failed: ${error.message}`);
    } finally {
      running = false;
      scheduleNext(log);
    }
  }, delay);
}

export function startFxGoldResearchScheduler(log = console) {
  if (!AUTO_ENABLED) {
    lastOutcome = 'disabled';

    log?.info?.(
      '[FX_GOLD] Auto-refresh disabled. ' +
      'Set FX_GOLD_RESEARCH_AUTO_REFRESH_ENABLED=true in Render to enable.'
    );

    return () => {};
  }

  if (timer) {
    return () => {};
  }

  scheduleNext(log);

  log?.info?.(
    `[FX_GOLD] Auto-refresh enabled; next run scheduled for ${nextRunAtUtc} ` +
    '(target: 03:30 IST daily).'
  );

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    running = false;
    nextRunAtUtc = null;
    lastOutcome = 'stopped';
  };
}

export function getFxGoldResearchSchedulerState() {
  return {
    automaticRefreshEnabled: AUTO_ENABLED,
    running,
    nextRunAtUtc,
    lastAttemptAtUtc,
    lastCompletedAtUtc,
    lastOutcome,
    lastSkipReason,
    lastError,
    scheduleTarget: '03:30 IST daily',
    tier: 'RESEARCH',
    analysisOnly: true,
    safety: safety()
  };
}
