import https from 'https';

const MIN_GAP_MS = Math.max(8500, Number(process.env.TWELVE_DATA_MIN_GAP_MS || 9500));
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = Math.min(
  7,
  Math.max(1, Number(process.env.TWELVE_DATA_MAX_REQUESTS_PER_MINUTE || 7))
);

const queue = [];
const requestTimes = [];
let active = false;
let lastStartMs = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneWindow(nowMs) {
  while (requestTimes.length && nowMs - requestTimes[0] >= WINDOW_MS) {
    requestTimes.shift();
  }
}

function nextAllowedDelay(nowMs) {
  pruneWindow(nowMs);

  const gapDelay = Math.max(0, lastStartMs + MIN_GAP_MS - nowMs);

  if (requestTimes.length < MAX_REQUESTS_PER_WINDOW) {
    return gapDelay;
  }

  const windowDelay = Math.max(0, requestTimes[0] + WINDOW_MS - nowMs);
  return Math.max(gapDelay, windowDelay);
}

async function drain() {
  if (active) return;
  active = true;

  while (queue.length) {
    const job = queue.shift();
    const delay = nextAllowedDelay(Date.now());

    if (delay > 0) {
      await sleep(delay);
    }

    const startedAt = Date.now();
    pruneWindow(startedAt);
    lastStartMs = startedAt;
    requestTimes.push(startedAt);

    try {
      const value = await job.run();
      job.resolve(value);
    } catch (error) {
      job.reject(error);
    }
  }

  active = false;
}

export function queueTwelveDataRequest(run) {
  if (typeof run !== 'function') {
    return Promise.reject(new Error('queueTwelveDataRequest requires a function.'));
  }

  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    drain().catch((error) => {
      console.error('[TWELVE/RATE_LIMITER] Queue drain failure:', error.message);
    });
  });
}

export function fetchTwelveDataJson(url, timeoutMs = 15000) {
  return queueTwelveDataRequest(() => new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs }, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          if (response.statusCode && response.statusCode >= 400) {
            const error = new Error(
              parsed?.message || `Twelve Data HTTP ${response.statusCode}`
            );
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          if (parsed?.status && parsed.status !== 'ok') {
            const error = new Error(
              `Twelve Data error: ${parsed.message || parsed.code || parsed.status}`
            );

            if (/credit|limit|rate|429/i.test(error.message)) {
              error.rateLimited = true;
            }

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
  pruneWindow(Date.now());

  return {
    queued: queue.length,
    active,
    minGapMs: MIN_GAP_MS,
    maxRequestsPerRollingMinute: MAX_REQUESTS_PER_WINDOW,
    requestsInCurrentWindow: requestTimes.length
  };
}
