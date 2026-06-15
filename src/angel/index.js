import { WebSocket } from "ws";
import { createHmac } from "crypto";
import { CONFIG } from "../config/index.js";

let _log = { info: console.log, warn: console.warn, error: console.error, debug: console.log };
export function setAngelLogger(log) { _log = log; }

export const angelToken = { jwt:null, feed:null, refresh:null, expiresAt:0, clientId:null };

async function safeJson(res, ctx) {
  try {
    const text = await res.text();
    if (!text || text.trim() === "") { _log.debug(`${ctx} → empty response (status ${res.status})`); return null; }
    try { return JSON.parse(text); } catch(e) { _log.debug(`${ctx} → invalid JSON (status ${res.status}): ${text.slice(0,200)}`); return null; }
  } catch(e) { _log.debug(`${ctx} → body read failed: ${e.message}`); return null; }
}

function generateTOTP(secret) {
  try {
    const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const s = secret.toUpperCase().replace(/[\s=]/g, "");
    let bits = 0, val = 0;
    const keyBytes = [];
    for (const c of s) {
      const idx = base32.indexOf(c);
      if (idx === -1) continue;
      val = (val << 5) | idx; bits += 5;
      if (bits >= 8) { keyBytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    const counter = Math.floor(Date.now() / 1000 / 30);
    const counterBuf = Buffer.alloc(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) { counterBuf[i] = c & 0xff; c = Math.floor(c / 256); }
    const hmac = createHmac("sha1", Buffer.from(keyBytes));
    hmac.update(counterBuf);
    const arr  = hmac.digest();
    const off  = arr[19] & 0xf;
    const code = ((arr[off] & 0x7f) << 24 | arr[off+1] << 16 | arr[off+2] << 8 | arr[off+3]) % 1000000;
    return String(code).padStart(6, "0");
  } catch(err) { _log.error("TOTP failed:", err.message); return null; }
}

export async function angelLogin() {
  if (!CONFIG.angelApiKey || !CONFIG.angelClientId || !CONFIG.angelPin || !CONFIG.angelTotpSecret) {
    _log.warn("Angel One credentials incomplete — skipping login"); return false;
  }
  try {
    const totp = generateTOTP(CONFIG.angelTotpSecret);
    if (!totp) throw new Error("TOTP generation failed");
    _log.info(`Angel One → logging in as ${CONFIG.angelClientId}...`);
    const res = await fetch("https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Accept":"application/json", "X-UserType":"USER", "X-SourceID":"WEB", "X-ClientLocalIP":"127.0.0.1", "X-ClientPublicIP":"127.0.0.1", "X-MACAddress":"00:00:00:00:00:00", "X-PrivateKey":CONFIG.angelApiKey },
      body: JSON.stringify({ clientcode: CONFIG.angelClientId, password: CONFIG.angelPin, totp }),
    });
    const d = await safeJson(res, "Angel One login");
    if (!d?.data?.jwtToken) { _log.error("Angel One login failed:", d?.message || "no token"); return false; }
    angelToken.jwt = d.data.jwtToken; angelToken.feed = d.data.feedToken;
    angelToken.refresh = d.data.refreshToken; angelToken.clientId = CONFIG.angelClientId;
    angelToken.expiresAt = Date.now() + 6 * 60 * 60 * 1000;
    _log.info("Angel One → login successful ✅"); return true;
  } catch(err) { _log.error("Angel One login error:", err.message); return false; }
}

export async function refreshAngelToken() {
  if (!angelToken.refresh) return false;
  try {
    const res = await fetch("https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Accept":"application/json", "X-PrivateKey":CONFIG.angelApiKey, "Authorization":`Bearer ${angelToken.jwt}` },
      body: JSON.stringify({ refreshToken: angelToken.refresh }),
    });
    const d = await safeJson(res, "Angel One refresh");
    if (d?.data?.jwtToken) { angelToken.jwt = d.data.jwtToken; angelToken.feed = d.data.feedToken; angelToken.expiresAt = Date.now() + 6*60*60*1000; _log.info("Angel One → token refreshed ✅"); return true; }
    return false;
  } catch(err) { _log.error("Angel One token refresh failed:", err.message); return false; }
}

const HEADERS = () => ({ "Authorization":`Bearer ${angelToken.jwt}`, "X-PrivateKey":CONFIG.angelApiKey, "Accept":"application/json", "X-UserType":"USER", "X-SourceID":"WEB" });

export async function getPortfolio() {
  if (!angelToken.jwt) return null;
  try { const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding", { headers: HEADERS() }); const d = await safeJson(res, "Angel One portfolio"); return d ? d.data || [] : []; } catch(err) { return []; }
}
export async function getPositions() {
  if (!angelToken.jwt) return null;
  try { const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition", { headers: HEADERS() }); const d = await safeJson(res, "Angel One positions"); return d ? d.data || [] : []; } catch(err) { return []; }
}
export async function getFunds() {
  if (!angelToken.jwt) return null;
  try { const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getRMS", { headers: HEADERS() }); const d = await safeJson(res, "Angel One funds"); return d ? d.data || null : null; } catch(err) { return null; }
}

export const FNO_SYMBOLS = [
  { symbol:"NIFTY",      token:"99926000", exchange:"NSE" },
  { symbol:"BANKNIFTY",  token:"99926009", exchange:"NSE" },
  { symbol:"RELIANCE",   token:"2885",     exchange:"NSE" },
  { symbol:"TCS",        token:"11536",    exchange:"NSE" },
  { symbol:"INFY",       token:"1594",     exchange:"NSE" },
  { symbol:"HDFCBANK",   token:"1333",     exchange:"NSE" },
  { symbol:"ICICIBANK",  token:"4963",     exchange:"NSE" },
  { symbol:"SBIN",       token:"3045",     exchange:"NSE" },
  { symbol:"BHARTIARTL", token:"10604",    exchange:"NSE" },
  { symbol:"ITC",        token:"1660",     exchange:"NSE" },
  { symbol:"WIPRO",      token:"3787",     exchange:"NSE" },
  { symbol:"HCLTECH",    token:"7229",     exchange:"NSE" },
  { symbol:"AXISBANK",   token:"5900",     exchange:"NSE" },
  { symbol:"KOTAKBANK",  token:"1922",     exchange:"NSE" },
  { symbol:"LT",         token:"11483",    exchange:"NSE" },
  { symbol:"ONGC",       token:"2475",     exchange:"NSE" },
  { symbol:"TATAMOTORS", token:"3456",     exchange:"NSE" },
  { symbol:"BAJFINANCE", token:"317",      exchange:"NSE" },
  { symbol:"MARUTI",     token:"10999",    exchange:"NSE" },
  { symbol:"ADANIENT",   token:"25",       exchange:"NSE" },
];

export const ANGEL_TOKEN_TO_SYMBOL = Object.freeze(Object.fromEntries(FNO_SYMBOLS.map(s => [s.token, s.symbol])));

export async function loadFnoHistory(engines, log) {
  const FNO_SYMS = Object.keys(engines).filter(s => engines[s].source === "angelone");
  log.info(`[FNO] Loading history for ${FNO_SYMS.length} symbols via yahoo-finance2...`);

  const YAHOO_MAP = {
    "NIFTY":      "^NSEI",
    "BANKNIFTY":  "^NSEBANK",
    "RELIANCE":   "RELIANCE.NS",
    "TCS":        "TCS.NS",
    "INFY":       "INFY.NS",
    "HDFCBANK":   "HDFCBANK.NS",
    "ICICIBANK":  "ICICIBANK.NS",
    "SBIN":       "SBIN.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "ITC":        "ITC.NS",
    "WIPRO":      "WIPRO.NS",
    "HCLTECH":    "HCLTECH.NS",
    "AXISBANK":   "AXISBANK.NS",
    "KOTAKBANK":  "KOTAKBANK.NS",
    "LT":         "LT.NS",
    "ONGC":       "ONGC.NS",
    "TATAMOTORS": "TATAMOTORS.NS",
    "BAJFINANCE": "BAJFINANCE.NS",
    "MARUTI":     "MARUTI.NS",
    "ADANIENT":   "ADANIENT.NS",
  };

  let yf;
  try {
    const mod = await import("yahoo-finance2");
    yf = new mod.default();
  } catch(e) {
    log.error("[FNO] yahoo-finance2 import failed:", e.message);
    return;
  }

  const period1 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const sym of FNO_SYMS) {
    try {
      const ticker = YAHOO_MAP[sym];
      if (!ticker) { log.warn(`[FNO] ${sym} — no ticker, skipping`); continue; }
      const result = await yf.chart(ticker, { period1, interval: "1h" });
      const quotes = result?.quotes ?? [];
      if (quotes.length === 0) { log.warn(`[FNO] ${sym} — empty data`); continue; }
      const candles = quotes
        .filter(q => q.open != null && q.close != null)
        .map(q => ({
          time:   new Date(q.date).getTime(),
          open:   q.open,
          high:   q.high,
          low:    q.low,
          close:  q.close,
          volume: q.volume ?? 0,
        }));
      engines[sym].loadCandles(candles);
      log.info(`[FNO] ${sym} history loaded — ${candles.length} candles`);
      await new Promise(r => setTimeout(r, 500));
    } catch(err) {
      log.error(`[FNO] ${sym} history failed:`, err.message.slice(0, 100));
    }
  }
}

export function connectAngelOneFeed(engines, log) {
  if (!angelToken.jwt || !angelToken.feed) { log.warn("Angel One not logged in — feed not started"); return; }
  const ws = new WebSocket("wss://smartapisocket.angelone.in/smart-stream", {
    headers: { "Authorization":angelToken.jwt, "x-api-key":CONFIG.angelApiKey, "x-client-code":angelToken.clientId, "x-feed-token":angelToken.feed }
  });
  ws.on("open", () => {
    log.info("Angel One feed WS connected ✅");
    ws.send(JSON.stringify({ correlationID:"trishika_fno", action:1, params:{ mode:1, tokenList:[{ exchangeType:1, tokens:FNO_SYMBOLS.map(s=>s.token) }] } }));
    log.info(`Angel One → subscribed to ${FNO_SYMBOLS.length} F&O symbols`);
  });
  ws.on("message", (raw) => {
    try {
      if (raw instanceof Buffer) {
        if (raw.length < 48) return;
        const token = raw.slice(2, 27).toString("utf8").replace(/\0/g, "").trim();
        const ltp = raw.readUInt32BE(47) / 100;
        const sym   = ANGEL_TOKEN_TO_SYMBOL[token];
        if (sym && engines[sym]) engines[sym].onTick(Number(ltp), 1, Date.now());
        return;
      }
      const msg = JSON.parse(raw.toString());
      if (msg.type === "heartbeat") { ws.send(JSON.stringify({ heartbeat:"pong" })); return; }
    } catch(e) { log.error("Angel One feed parse:", e.message); }
  });
  ws.on("close", () => { log.warn("Angel One feed WS closed — reconnecting in 5s..."); setTimeout(() => connectAngelOneFeed(engines, log), 30000); });
  ws.on("error", (e) => log.error("Angel One feed WS:", e.message));
}
