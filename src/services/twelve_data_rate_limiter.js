import https from 'https';

const MIN_GAP_MS = Math.max(
  15_000,
  Number(process.env.TWELVE_DATA_MIN_GAP_MS || 15_000)
);

const WINDOW_MS = 60_000;

const MAX_REQUESTS_PER_WINDOW = Math.min(
  4,
  Math.max(1, Number(process.env.TWELVE_DATA_MAX_REQUESTS_PER_MINUTE || 4))
);

const RATE_LIMIT_COOLDOWN_MS = Math.max(
  65_000,
  Number(process.env.TWELVE_DATA_RATE_LIMIT_COOLDOWN_MS || 65_000)
);

const queue = [];
const requestTimes = [];

let active = false;
let lastStartMs = 0;
let cooldownUntilMs = 0;
let lastRateLimitAtUtc = null;
let lastRateLimitMessage = null;
let lastRequestAtUtc = null;
let lastFailureAtUtc = null;
let lastFailureMessage = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneWindow(nowMs) {
  while (requestTimes.length && nowMs - requestTimes[0] >= WINDOW_MS) {
    requestTimes.shift();
  }
}

function isRateLimitError(error) {
  return Boolean(
    error?.rateLimited ||
    error?.statusCode === 429 ||
    error?.status === 429 ||
    /credit|limit|rate|429|too many requests/i.test(String(error?.message || ''))
  );
}

function recordRateLimit(error) {
  const nowMs = Date.now();
  cooldownUntilMs = Math.max(cooldownUntilMs, nowMs + RATE_LIMIT_COOLDOWN_MS);
  lastRateLimitAtUtc = new Date(nowMs).toISOString();
  lastRateLimitMessage = String(error?.message || 'Twelve Data rate limit reached');
}

function nextAllowedDelay(nowMs) {
  pruneWindow(nowMs);

  const cooldownDelay = Math.max(0, cooldownUntilMs - nowMs);
  const gapDelay = Math.max(0, lastStartMs + MIN_GAP_MS - nowMs);

  if (requestTimes.length < MAX_REQUESTS_PER_WINDOW) {
    return Math.max(cooldownDelay, gapDelay);
  }

  const windowDelay = Math.max(0, requestTimes[0] + WINDOW_MS - nowMs);
  return Math.max(cooldownDelay, gapDelay, windowDelay);
}

async function drain() {
  if (active) return;

  active = true;

  try {
    while (queue.length) {
      const job = queue.shift();
      const delay = nextAllowedDelay(Date.now());

      if (delay > 0) {
        await sleep(delay);
      }

      const startedAt = Date.now();
      pruneWindow(startedAt);
      lastStartMs = startedAt;
      lastRequestAtUtc = new Date(startedAt).toISOString();
      requestTimes.push(startedAt);

      try {
        const value = await job.run();
        job.resolve(value);
      } catch (error) {
        lastFailureAtUtc = new Date().toISOString();
        lastFailureMessage = String(error?.message || error);

        if (isRateLimitError(error)) {
          recordRateLimit(error);
        }

        job.reject(error);
      }
    }
  } finally {
    active = false;

    if (queue.length) {
      void drain();
    }
  }
}

export function queueTwelveDataRequest(run) {
  if (typeof run !== 'function') {
    return Promise.reject(new Error('queueTwelveDataRequest requires a function.'));
  }

  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });

    void drain().catch((error) => {
      lastFailureAtUtc = new Date().toISOString();
      lastFailureMessage = String(error?.message || error);
      console.error('[TWELVE/RATE_LIMITER] Queue drain failure:', lastFailureMessage);
    });
  });
}

export function fetchTwelveDataJson(url, timeoutMs = 15_000) {
  return queueTwelveDataRequest(() => new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs }, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('error', reject);

      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (response.statusCode && response.statusCode >= 400) {
            const error = new Error(
              parsed?.message || `Twelve Data HTTP ${response.statusCode}`
            );
            error.statusCode = response.statusCode;
            error.rateLimited = response.statusCode === 429 || isRateLimitError(error);
            reject(error);
            return;
          }

          if (parsed?.status && parsed.status !== 'ok') {
            const error = new Error(
              `Twelve Data error: ${parsed.message || parsed.code || parsed.status}`
            );
            error.rateLimited = isRateLimitError(error);
            reject(error);
            return;
          }

          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);

    request.on('timeout', () => {
      request.destroy(new Error('Twelve Data fetch timeout'));
    });
  }));
}

export function getTwelveDataRateLimiterState() {
  const nowMs = Date.now();
  pruneWindow(nowMs);

  return {
    queued: queue.length,
    active,
    minGapMs: MIN_GAP_MS,
    maxRequestsPerRollingMinute: MAX_REQUESTS_PER_WINDOW,
    requestsInCurrentWindow: requestTimes.length,
    cooldownActive: cooldownUntilMs > nowMs,
    cooldownUntilUtc: cooldownUntilMs ? new Date(cooldownUntilMs).toISOString() : null,
    lastRequestAtUtc,
    lastRateLimitAtUtc,
    lastRateLimitMessage,
    lastFailureAtUtc,
    lastFailureMessage
  };
}
