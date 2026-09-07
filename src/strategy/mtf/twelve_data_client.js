const BASE_URL = 'https://api.twelvedata.com/time_series';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchTwelveDataCandles({
  symbol,
  interval,
  outputsize,
  apiKey,
  timeoutMs = 20_000,
  retries = 1,
}) {
  if (!apiKey) throw new Error('TWELVE_DATA_KEY is not configured.');

  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    apikey: apiKey,
    format: 'JSON',
    timezone: 'UTC',
  });

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${BASE_URL}?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message ?? `HTTP ${response.status}`;
        const retryAfter = Number(response.headers.get('retry-after'));
        const error = new Error(`Twelve Data ${message}`);
        error.status = response.status;
        error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
        throw error;
      }

      if (payload?.status === 'error' || !Array.isArray(payload?.values)) {
        throw new Error(`Twelve Data ${payload?.message ?? 'response missing values'}`);
      }

      return {
        source: {
          provider: 'TWELVE_DATA',
          symbol,
          interval,
          fetchedAtUtc: new Date().toISOString(),
        },
        values: payload.values,
      };
    } catch (error) {
      lastError = error;
      const rateLimited = error?.status === 429;

      // Do not retry provider throttling inside this run. A retry can consume
      // more limited credits and turn one rejected request into a burst.
      // The next controlled scheduled run may retry after its rate window.
      if (rateLimited) break;

      const retryDelay = error?.retryAfterMs ?? 1_500;
      if (attempt < retries) {
        await sleep(retryDelay);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('Twelve Data request failed.');
}
