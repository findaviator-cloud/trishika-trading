import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { CONFIG } from '../config/index.js';

let logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log
};

const LOGIN_URL =
  'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword';

const TOKEN_REFRESH_URL =
  'https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens';

const HISTORICAL_CANDLE_URL =
  'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData';

const FEED_URL = 'wss://smartapisocket.angelone.in/smart-stream';

const ENABLED = () => process.env.ENABLE_ANGEL_ONE_WS === 'true';

const HISTORY_ENABLED = () =>
  ENABLED() && process.env.ANGEL_ONE_HISTORICAL_ENABLED === 'true';

const ONE_SECOND_MS = 1_000;
const DEFAULT_HISTORY_GAP_MS = 1_000;
const DEFAULT_BASE_RECONNECT_MS = 120_000;
const DEFAULT_MAX_RECONNECT_MS = 900_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 1_800_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

const safeNumber = (value, fallback, minimum = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
};

const config = () => ({
  historyGapMs: safeNumber(
    process.env.ANGEL_ONE_HISTORY_GAP_MS,
    DEFAULT_HISTORY_GAP_MS,
    ONE_SECOND_MS
  ),
  baseReconnectMs: safeNumber(
    process.env.ANGEL_ONE_WS_BASE_RECONNECT_MS,
    DEFAULT_BASE_RECONNECT_MS,
    ONE_SECOND_MS
  ),
  maxReconnectMs: safeNumber(
    process.env.ANGEL_ONE_WS_MAX_RECONNECT_MS,
    DEFAULT_MAX_RECONNECT_MS,
    ONE_SECOND_MS
  ),
  maxFailures: Math.floor(
    safeNumber(
      process.env.ANGEL_ONE_WS_MAX_FAILURES,
      DEFAULT_MAX_FAILURES,
      1
    )
  ),
  circuitCooldownMs: safeNumber(
    process.env.ANGEL_ONE_WS_CIRCUIT_COOLDOWN_MS,
    DEFAULT_CIRCUIT_COOLDOWN_MS,
    ONE_SECOND_MS
  ),
  requestTimeoutMs: safeNumber(
    process.env.ANGEL_ONE_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    5_000
  )
});

const tokenState = {
  jwt: null,
  feed: null,
  refresh: null,
  expiresAtMs: 0,
  clientId: null
};

const runtime = {
  status: 'DISABLED',
  connected: false,
  connecting: false,
  loginInFlight: false,
  reconnectAttempt: 0,
  reconnectScheduled: false,
  reconnectAtMs: 0,
  cooldownUntilMs: 0,
  consecutiveFailures: 0,
  subscribedSymbolCount: 0,
  lastConnectedAtUtc: null,
  lastDisconnectedAtUtc: null,
  lastFailureAtUtc: null,
  lastFailureMessage: null,
  lastCloseCode: null,
  lastHistoryRequestAtUtc: null,
  lastHistoryFailureAtUtc: null,
  lastHistoryFailureMessage: null,
  historyQueued: 0,
  historyActive: false
};

let activeSocket = null;
let socketStartPromise = null;
let loginPromise = null;
let reconnectTimer = null;
let periodicRefreshTimer = null;
let historyLastStartMs = 0;
let historyDrainActive = false;
const historyQueue = [];

export const ANGEL_MARKET_DATA_INSTRUMENTS = Object.freeze([
  Object.freeze({
    key: 'NIFTY',
    display: 'NIFTY',
    exchange: 'NSE',
    exchangeType: 1,
    symbolToken: '99926000',
    historicalVerified: true,
    marketDataOnly: true,
    approvedForTrading: false,
    executionAllowed: false
  }),
  Object.freeze({
    key: 'BANKNIFTY',
    display: 'BANKNIFTY',
    exchange: 'NSE',
    exchangeType: 1,
    symbolToken: '99926009',
    historicalVerified: false,
    marketDataOnly: true,
    approvedForTrading: false,
    executionAllowed: false
  }),
  Object.freeze({
    key: 'SENSEX',
    display: 'SENSEX',
    exchange: 'BSE',
    exchangeType: 3,
    symbolToken: '99919000',
    historicalVerified: false,
    marketDataOnly: true,
    approvedForTrading: false,
    executionAllowed: false
  })
]);

export const ANGEL_TOKEN_TO_SYMBOL = Object.freeze(
  Object.fromEntries(
    ANGEL_MARKET_DATA_INSTRUMENTS.map((instrument) => [
      instrument.symbolToken,
      instrument.key
    ])
  )
);

export function setAngelLogger(nextLogger) {
  if (nextLogger && typeof nextLogger === 'object') {
    logger = {
      ...logger,
      ...nextLogger
    };
  }
}

function nowUtc() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCredentials() {
  return Boolean(
    CONFIG.angelApiKey &&
    CONFIG.angelClientId &&
    CONFIG.angelPin &&
    CONFIG.angelTotpSecret
  );
}

function hasUsableSession() {
  return Boolean(
    tokenState.jwt &&
    tokenState.feed &&
    tokenState.clientId &&
    tokenState.expiresAtMs > Date.now() + TOKEN_REFRESH_SKEW_MS
  );
}

function clearTokenState() {
  tokenState.jwt = null;
  tokenState.feed = null;
  tokenState.refresh = null;
  tokenState.expiresAtMs = 0;
  tokenState.clientId = null;
}

function closeSocket(reason = 'connector reset') {
  if (!activeSocket) return;

  const socket = activeSocket;
  activeSocket = null;

  try {
    socket.removeAllListeners();
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, reason.slice(0, 120));
    }
  } catch {
    // Best effort only.
  }
}

function resetReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  runtime.reconnectScheduled = false;
  runtime.reconnectAtMs = 0;
}

function setCooldown(reason, minimumCooldownMs = null) {
  const settings = config();
  const cooldownMs = Math.max(
    settings.circuitCooldownMs,
    minimumCooldownMs || 0
  );

  runtime.cooldownUntilMs = Math.max(
    runtime.cooldownUntilMs,
    Date.now() + cooldownMs
  );
  runtime.status = 'COOLDOWN';
  runtime.lastFailureAtUtc = nowUtc();
  runtime.lastFailureMessage = reason;
  resetReconnectTimer();
  closeSocket('cooldown');

  logger.warn(
    `[ANGEL/MARKET_DATA] Cooldown active for ${Math.ceil(
      cooldownMs / 60_000
    )} minute(s): ${reason}`
  );
}

function recordFailure(error, context, { rateLimited = false } = {}) {
  const message = String(error?.message || error || 'Unknown Angel One error');
  runtime.connected = false;
  runtime.connecting = false;
  runtime.lastFailureAtUtc = nowUtc();
  runtime.lastFailureMessage = `${context}: ${message}`;
  runtime.consecutiveFailures += 1;
  runtime.status = 'ERROR';

  if (rateLimited || /\b429\b|rate.?limit|too many requests/i.test(message)) {
    setCooldown(`${context}: rate limited`, 30 * 60_000);
    return;
  }

  if (runtime.consecutiveFailures >= config().maxFailures) {
    setCooldown(
      `${context}: circuit breaker after ${runtime.consecutiveFailures} consecutive failures`
    );
  }
}

function markConnected() {
  runtime.status = 'CONNECTED';
  runtime.connected = true;
  runtime.connecting = false;
  runtime.reconnectAttempt = 0;
  runtime.consecutiveFailures = 0;
  runtime.lastConnectedAtUtc = nowUtc();
  resetReconnectTimer();
}

function getNextReconnectDelayMs() {
  const settings = config();
  const exponent = Math.max(0, runtime.reconnectAttempt);
  const raw = Math.min(
    settings.maxReconnectMs,
    settings.baseReconnectMs * 2 ** exponent
  );
  const jitter = Math.floor(raw * Math.random() * 0.2);
  return Math.min(settings.maxReconnectMs, raw + jitter);
}

function isCooldownActive() {
  return runtime.cooldownUntilMs > Date.now();
}

function canUseMarketData() {
  return ENABLED() && hasCredentials() && !isCooldownActive();
}

function scheduleReconnect(engines, reason) {
  if (!ENABLED()) {
    runtime.status = 'DISABLED';
    return;
  }

  if (isCooldownActive()) {
    runtime.status = 'COOLDOWN';
    return;
  }

  if (runtime.reconnectScheduled || runtime.connected || runtime.connecting) {
    return;
  }

  const delayMs = getNextReconnectDelayMs();
  runtime.reconnectAttempt += 1;
  runtime.reconnectScheduled = true;
  runtime.reconnectAtMs = Date.now() + delayMs;
  runtime.status = 'RECONNECT_SCHEDULED';

  logger.warn(
    `[ANGEL/MARKET_DATA] Reconnect scheduled in ${Math.ceil(
      delayMs / 1_000
    )}s: ${reason}`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    runtime.reconnectScheduled = false;
    runtime.reconnectAtMs = 0;
    void startAngelMarketData(engines);
  }, delayMs);
}

async function safeJson(response, context) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${context}: empty response (HTTP ${response.status})`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${context}: invalid JSON (HTTP ${response.status}, body=${text.slice(0, 180)})`
    );
  }
}

function generateTotp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(secret || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');

  if (!normalized) {
    throw new Error('TOTP secret is empty.');
  }

  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  const counter = Math.floor(Date.now() / 1_000 / 30);
  const counterBuffer = Buffer.alloc(8);
  let cursor = counter;

  for (let index = 7; index >= 0; index -= 1) {
    counterBuffer[index] = cursor & 0xff;
    cursor = Math.floor(cursor / 256);
  }

  const digest = createHmac('sha1', Buffer.from(bytes))
    .update(counterBuffer)
    .digest();

  const offset = digest[19] & 0x0f;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000;

  return String(code).padStart(6, '0');
}

function requestHeaders({ includeAuthorization = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': process.env.ANGEL_ONE_CLIENT_LOCAL_IP || '127.0.0.1',
    'X-ClientPublicIP': process.env.ANGEL_ONE_CLIENT_PUBLIC_IP || '127.0.0.1',
    'X-MACAddress': process.env.ANGEL_ONE_MAC_ADDRESS || '00:00:00:00:00:00',
    'X-PrivateKey': CONFIG.angelApiKey
  };

  if (includeAuthorization && tokenState.jwt) {
    headers.Authorization = `Bearer ${tokenState.jwt}`;
  }

  return headers;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function loginOrRefresh() {
  if (!ENABLED()) {
    runtime.status = 'DISABLED';
    return false;
  }

  if (!hasCredentials()) {
    runtime.status = 'CREDENTIALS_MISSING';
    runtime.lastFailureAtUtc = nowUtc();
    runtime.lastFailureMessage = 'Angel One credentials are incomplete.';
    return false;
  }

  if (isCooldownActive()) {
    runtime.status = 'COOLDOWN';
    return false;
  }

  if (hasUsableSession()) {
    return true;
  }

  if (loginPromise) {
    return loginPromise;
  }

  runtime.loginInFlight = true;
  runtime.status = 'AUTHENTICATING';

  loginPromise = (async () => {
    const timeoutMs = config().requestTimeoutMs;

    try {
      if (tokenState.refresh && tokenState.jwt) {
        const refreshed = await fetchWithTimeout(
          TOKEN_REFRESH_URL,
          {
            method: 'POST',
            headers: requestHeaders({ includeAuthorization: true }),
            body: JSON.stringify({ refreshToken: tokenState.refresh })
          },
          timeoutMs
        );

        const payload = await safeJson(refreshed, 'Angel One token refresh');

        if (refreshed.ok && payload?.data?.jwtToken && payload?.data?.feedToken) {
          tokenState.jwt = payload.data.jwtToken;
          tokenState.feed = payload.data.feedToken;
          tokenState.expiresAtMs = Date.now() + 6 * 60 * 60 * 1_000;
          runtime.loginInFlight = false;
          logger.info('[ANGEL/MARKET_DATA] Token refresh successful.');
          return true;
        }

        clearTokenState();
      }

      const totp = generateTotp(CONFIG.angelTotpSecret);

      const response = await fetchWithTimeout(
        LOGIN_URL,
        {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({
            clientcode: CONFIG.angelClientId,
            password: CONFIG.angelPin,
            totp
          })
        },
        timeoutMs
      );

      const payload = await safeJson(response, 'Angel One login');

      if (!response.ok || !payload?.data?.jwtToken || !payload?.data?.feedToken) {
        const error = new Error(
          payload?.message || `Angel One login failed (HTTP ${response.status})`
        );
        error.status = response.status;
        throw error;
      }

      tokenState.jwt = payload.data.jwtToken;
      tokenState.feed = payload.data.feedToken;
      tokenState.refresh = payload.data.refreshToken || null;
      tokenState.clientId = CONFIG.angelClientId;
      tokenState.expiresAtMs = Date.now() + 6 * 60 * 60 * 1_000;

      runtime.loginInFlight = false;
      logger.info('[ANGEL/MARKET_DATA] Login successful.');
      return true;
    } catch (error) {
      runtime.loginInFlight = false;
      const status = Number(error?.status || 0);
      recordFailure(error, 'authentication', {
        rateLimited: status === 429
      });
      clearTokenState();
      return false;
    } finally {
      runtime.loginInFlight = false;
      loginPromise = null;
    }
  })();

  return loginPromise;
}

function subscribeSocket(socket) {
  const byExchange = new Map();

  for (const instrument of ANGEL_MARKET_DATA_INSTRUMENTS) {
    const tokens = byExchange.get(instrument.exchangeType) || [];
    tokens.push(instrument.symbolToken);
    byExchange.set(instrument.exchangeType, tokens);
  }

  const tokenList = [...byExchange.entries()].map(([exchangeType, tokens]) => ({
    exchangeType,
    tokens
  }));

  socket.send(
    JSON.stringify({
      correlationID: 'trishika-market-data',
      action: 1,
      params: {
        mode: 1,
        tokenList
      }
    })
  );

  runtime.subscribedSymbolCount = ANGEL_MARKET_DATA_INSTRUMENTS.length;

  logger.info(
    `[ANGEL/MARKET_DATA] Subscribed to ${runtime.subscribedSymbolCount} configured market-data instrument(s).`
  );
}

function handleTick(raw, engines) {
  if (!Buffer.isBuffer(raw)) {
    return;
  }

  if (raw.length < 47) {
    return;
  }

  const token = raw
    .subarray(2, 27)
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();

  const symbol = ANGEL_TOKEN_TO_SYMBOL[token];

  if (!symbol || !engines?.[symbol]) {
    return;
  }

  const rawPrice = raw.readUInt32LE(43);
  const price = rawPrice / 100;

  if (!Number.isFinite(price) || price <= 0) {
    return;
  }

  engines[symbol].onTick(price, 1, Date.now());
}

function openSocket(engines) {
  if (!canUseMarketData()) {
    return Promise.resolve(false);
  }

  if (
    activeSocket &&
    (activeSocket.readyState === WebSocket.OPEN ||
      activeSocket.readyState === WebSocket.CONNECTING)
  ) {
    return Promise.resolve(true);
  }

  if (socketStartPromise) {
    return socketStartPromise;
  }

  runtime.connecting = true;
  runtime.status = 'CONNECTING';

  socketStartPromise = new Promise((resolve) => {
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      socketStartPromise = null;
      resolve(value);
    };

    const socket = new WebSocket(FEED_URL, {
      headers: {
        Authorization: tokenState.jwt,
        'x-api-key': CONFIG.angelApiKey,
        'x-client-code': tokenState.clientId,
        'x-feed-token': tokenState.feed
      }
    });

    activeSocket = socket;

    socket.on('open', () => {
      if (activeSocket !== socket) {
        socket.close(1000, 'superseded');
        settle(false);
        return;
      }

      try {
        subscribeSocket(socket);
        markConnected();
        settle(true);
      } catch (error) {
        recordFailure(error, 'socket subscribe');
        settle(false);
        closeSocket('subscribe failure');
        scheduleReconnect(engines, 'subscription failure');
      }
    });

    socket.on('message', (raw) => {
      try {
        handleTick(raw, engines);
      } catch (error) {
        logger.warn(
          `[ANGEL/MARKET_DATA] Tick parse failed: ${String(error?.message || error)}`
        );
      }
    });

    socket.on('unexpected-response', (_request, response) => {
      const status = response?.statusCode || 0;
      const error = new Error(`Angel One WebSocket rejected (HTTP ${status})`);
      error.status = status;
      recordFailure(error, 'socket handshake', { rateLimited: status === 429 });
    });

    socket.on('error', (error) => {
      const status = Number(error?.statusCode || error?.status || 0);
      recordFailure(error, 'socket error', { rateLimited: status === 429 });
      settle(false);
    });

    socket.on('close', (code) => {
      if (activeSocket === socket) {
        activeSocket = null;
      }

      runtime.connected = false;
      runtime.connecting = false;
      runtime.lastDisconnectedAtUtc = nowUtc();
      runtime.lastCloseCode = code;
      runtime.subscribedSymbolCount = 0;

      if (!settled) {
        settle(false);
      }

      if (!ENABLED()) {
        runtime.status = 'DISABLED';
        return;
      }

      if (isCooldownActive()) {
        runtime.status = 'COOLDOWN';
        return;
      }

      scheduleReconnect(engines, `socket closed (${code})`);
    });
  });

  return socketStartPromise;
}

export async function startAngelMarketData(engines) {
  if (!ENABLED()) {
    runtime.status = 'DISABLED';
    return {
      ok: false,
      skipped: true,
      reason: 'ENABLE_ANGEL_ONE_WS is not true.'
    };
  }

  if (!hasCredentials()) {
    runtime.status = 'CREDENTIALS_MISSING';
    return {
      ok: false,
      skipped: true,
      reason: 'Angel One credentials are incomplete.'
    };
  }

  if (isCooldownActive()) {
    runtime.status = 'COOLDOWN';
    return {
      ok: false,
      skipped: true,
      reason: 'Angel One connector is in cooldown.'
    };
  }

  const authenticated = await loginOrRefresh();

  if (!authenticated) {
    scheduleReconnect(engines, 'authentication failed');
    return {
      ok: false,
      skipped: false,
      reason: 'Angel One authentication failed.'
    };
  }

  const connected = await openSocket(engines);

  return {
    ok: connected,
    skipped: false,
    reason: connected ? null : 'Angel One WebSocket did not connect.'
  };
}

export function stopAngelMarketData() {
  resetReconnectTimer();

  if (periodicRefreshTimer) {
    clearInterval(periodicRefreshTimer);
    periodicRefreshTimer = null;
  }

  closeSocket('operator stop');
  clearTokenState();

  runtime.status = 'STOPPED';
  runtime.connected = false;
  runtime.connecting = false;
  runtime.subscribedSymbolCount = 0;
}

export function startAngelMarketDataLifecycle(engines) {
  if (!ENABLED()) {
    runtime.status = 'DISABLED';
    logger.info(
      '[ANGEL/MARKET_DATA] Disabled; ENABLE_ANGEL_ONE_WS is not exactly true.'
    );
    return;
  }

  void startAngelMarketData(engines);

  if (!periodicRefreshTimer) {
    periodicRefreshTimer = setInterval(() => {
      if (!ENABLED() || isCooldownActive()) {
        return;
      }

      if (runtime.connected || runtime.connecting || runtime.reconnectScheduled) {
        return;
      }

      void startAngelMarketData(engines);
    }, 5 * 60_000);
  }
}

function publicInstrument(instrument) {
  return {
    key: instrument.key,
    display: instrument.display,
    exchange: instrument.exchange,
    exchangeType: instrument.exchangeType,
    symbolToken: instrument.symbolToken,
    historicalVerified: instrument.historicalVerified,
    marketDataOnly: true,
    approvedForTrading: false,
    executionAllowed: false
  };
}

export function getAngelMarketDataState() {
  const nowMs = Date.now();

  return {
    meta: {
      tier: 'RESEARCH',
      marketDataOnly: true,
      analysisOnly: true,
      executionAllowed: false,
      approvedForTrading: false,
      ordersAllowed: false,
      portfolioAccessAllowed: false,
      positionsAccessAllowed: false,
      fundsAccessAllowed: false
    },
    enabled: ENABLED(),
    historicalEnabled: HISTORY_ENABLED(),
    credentialsConfigured: hasCredentials(),
    status: runtime.status,
    connected: runtime.connected,
    connecting: runtime.connecting,
    loginInFlight: runtime.loginInFlight,
    reconnectAttempt: runtime.reconnectAttempt,
    reconnectScheduled: runtime.reconnectScheduled,
    reconnectAtUtc: runtime.reconnectAtMs
      ? new Date(runtime.reconnectAtMs).toISOString()
      : null,
    cooldownActive: runtime.cooldownUntilMs > nowMs,
    cooldownUntilUtc: runtime.cooldownUntilMs
      ? new Date(runtime.cooldownUntilMs).toISOString()
      : null,
    consecutiveFailures: runtime.consecutiveFailures,
    subscribedSymbolCount: runtime.subscribedSymbolCount,
    lastConnectedAtUtc: runtime.lastConnectedAtUtc,
    lastDisconnectedAtUtc: runtime.lastDisconnectedAtUtc,
    lastCloseCode: runtime.lastCloseCode,
    lastFailureAtUtc: runtime.lastFailureAtUtc,
    lastFailureMessage: runtime.lastFailureMessage,
    history: {
      queued: historyQueue.length,
      active: runtime.historyActive,
      gapMs: config().historyGapMs,
      lastRequestAtUtc: runtime.lastHistoryRequestAtUtc,
      lastFailureAtUtc: runtime.lastHistoryFailureAtUtc,
      lastFailureMessage: runtime.lastHistoryFailureMessage
    },
    instruments: ANGEL_MARKET_DATA_INSTRUMENTS.map(publicInstrument)
  };
}

function normalizeDateTime(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty date-time string.`);
  }

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value.trim())) {
    throw new Error(`${fieldName} must use yyyy-MM-dd HH:mm format.`);
  }

  return value.trim();
}

function normalizeHistoricalRow(row) {
  if (!Array.isArray(row) || row.length < 6) {
    throw new Error('Angel One historical candle row is malformed.');
  }

  const [timestamp, open, high, low, close, volume] = row;
  const time = Date.parse(timestamp);

  const candle = {
    time,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume)
  };

  if (
    !Number.isFinite(candle.time) ||
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close) ||
    !Number.isFinite(candle.volume)
  ) {
    throw new Error('Angel One historical candle has non-finite values.');
  }

  if (
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.high < candle.low
  ) {
    throw new Error('Angel One historical candle has invalid OHLC values.');
  }

  return candle;
}

export function normalizeAngelHistoricalCandles(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Angel One historical response data must be an array.');
  }

  const deduplicated = new Map();

  for (const row of rows) {
    const candle = normalizeHistoricalRow(row);
    deduplicated.set(candle.time, candle);
  }

  const candles = [...deduplicated.values()].sort((left, right) => left.time - right.time);

  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].time <= candles[index - 1].time) {
      throw new Error('Angel One candles must have increasing timestamps.');
    }
  }

  return candles;
}

function getInstrument(key) {
  const normalizedKey = String(key || '').trim().toUpperCase();
  return ANGEL_MARKET_DATA_INSTRUMENTS.find(
    (instrument) => instrument.key === normalizedKey
  );
}

function enqueueHistory(run) {
  return new Promise((resolve, reject) => {
    historyQueue.push({ run, resolve, reject });
    runtime.historyQueued = historyQueue.length;
    void drainHistoryQueue();
  });
}

async function drainHistoryQueue() {
  if (historyDrainActive) return;

  historyDrainActive = true;
  runtime.historyActive = true;

  try {
    while (historyQueue.length) {
      const job = historyQueue.shift();
      runtime.historyQueued = historyQueue.length;

      const gapMs = config().historyGapMs;
      const delayMs = Math.max(
        0,
        historyLastStartMs + gapMs - Date.now()
      );

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      historyLastStartMs = Date.now();
      runtime.lastHistoryRequestAtUtc = nowUtc();

      try {
        job.resolve(await job.run());
      } catch (error) {
        runtime.lastHistoryFailureAtUtc = nowUtc();
        runtime.lastHistoryFailureMessage = String(error?.message || error);
        job.reject(error);
      }
    }
  } finally {
    historyDrainActive = false;
    runtime.historyActive = false;
    runtime.historyQueued = historyQueue.length;

    if (historyQueue.length) {
      void drainHistoryQueue();
    }
  }
}

export async function fetchAngelHistoricalCandles({
  instrumentKey = 'NIFTY',
  interval = 'ONE_HOUR',
  fromdate,
  todate
}) {
  if (!HISTORY_ENABLED()) {
    throw new Error(
      'Angel One historical candles are disabled. Set ENABLE_ANGEL_ONE_WS=true and ANGEL_ONE_HISTORICAL_ENABLED=true only after controlled verification.'
    );
  }

  const instrument = getInstrument(instrumentKey);

  if (!instrument) {
    throw new Error(`Unknown Angel One instrument: ${instrumentKey}`);
  }

  if (!instrument.historicalVerified) {
    throw new Error(
      `${instrument.key} historical token/segment is not verified; request blocked.`
    );
  }

  const allowedIntervals = new Set([
    'ONE_MINUTE',
    'THREE_MINUTE',
    'FIVE_MINUTE',
    'TEN_MINUTE',
    'FIFTEEN_MINUTE',
    'THIRTY_MINUTE',
    'ONE_HOUR',
    'ONE_DAY'
  ]);

  if (!allowedIntervals.has(interval)) {
    throw new Error(`Unsupported Angel One interval: ${interval}`);
  }

  const normalizedFrom = normalizeDateTime(fromdate, 'fromdate');
  const normalizedTo = normalizeDateTime(todate, 'todate');

  return enqueueHistory(async () => {
    if (isCooldownActive()) {
      throw new Error('Angel One connector is in cooldown.');
    }

    const authenticated = await loginOrRefresh();

    if (!authenticated || !tokenState.jwt) {
      throw new Error('Angel One historical request requires an authenticated session.');
    }

    const response = await fetchWithTimeout(
      HISTORICAL_CANDLE_URL,
      {
        method: 'POST',
        headers: requestHeaders({ includeAuthorization: true }),
        body: JSON.stringify({
          exchange: instrument.exchange,
          symboltoken: instrument.symbolToken,
          interval,
          fromdate: normalizedFrom,
          todate: normalizedTo
        })
      },
      config().requestTimeoutMs
    );

    const payload = await safeJson(response, 'Angel One historical candles');

    if (!response.ok || payload?.status !== true || !Array.isArray(payload?.data)) {
      const error = new Error(
        payload?.message ||
          payload?.errorcode ||
          `Angel One historical request failed (HTTP ${response.status})`
      );
      error.status = response.status;
      throw error;
    }

    return {
      meta: {
        provider: 'ANGEL_ONE',
        marketDataOnly: true,
        analysisOnly: true,
        executionAllowed: false,
        approvedForTrading: false,
        instrument: publicInstrument(instrument),
        interval,
        fromdate: normalizedFrom,
        todate: normalizedTo,
        fetchedAtUtc: nowUtc()
      },
      candles: normalizeAngelHistoricalCandles(payload.data)
    };
  }).catch((error) => {
    const status = Number(error?.status || 0);
    if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(String(error?.message || ''))) {
      setCooldown('historical candles: rate limited', 30 * 60_000);
    }

    throw error;
  });
}

export async function loadAngelHistoricalCandles(engines, {
  instrumentKey = 'NIFTY',
  interval = 'ONE_HOUR',
  fromdate,
  todate
} = {}) {
  const result = await fetchAngelHistoricalCandles({
    instrumentKey,
    interval,
    fromdate,
    todate
  });

  const key = String(instrumentKey).toUpperCase();

  if (engines?.[key] && Array.isArray(result.candles) && result.candles.length) {
    engines[key].loadCandles(result.candles);
  }

  return result;
}
