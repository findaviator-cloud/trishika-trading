import "dotenv/config";
import "dotenv/config";

export const WS_TYPES = Object.freeze({ SUBSCRIBE:"subscribe", INIT:"init", TICK:"tick", CANDLE_CLOSED:"candle_closed", ANALYSIS:"analysis", PORTFOLIO:"portfolio", ERROR:"error" });
export const SIGNAL = Object.freeze({ LONG:"LONG", SHORT:"SHORT", NEUTRAL:"NEUTRAL" });
export const ACTION = Object.freeze({ ENTER:"ENTER", WAIT:"WAIT", EXIT:"EXIT" });
export const RISK   = Object.freeze({ LOW:"LOW", MEDIUM:"MEDIUM", HIGH:"HIGH" });
export const ROUTES = Object.freeze({ HEALTH:"/api/health", CANDLES:"/api/candles/:symbol", ANALYSIS:"/api/analysis/:symbol", PORTFOLIO:"/api/portfolio", POSITIONS:"/api/positions", FUNDS:"/api/funds", WS:"/ws" });

export const CONFIG = Object.freeze({
  port:             process.env.PORT            || 3000,
  groqKey:          process.env.GROQ_API_KEY    || null,
  groqModel:        process.env.GROQ_MODEL      || "llama-3.3-70b-versatile",
  ollamaUrl:        process.env.OLLAMA_URL      || "http://localhost:11434/api/generate",
  candleMs:         parseInt(process.env.CANDLE_MS   || "1200000"),
  maxCandles:       parseInt(process.env.MAX_CANDLES || "200"),
  analysisInterval: parseInt(process.env.ANALYSIS_MS || "1200000"),
  rateLimit:        parseInt(process.env.RATE_LIMIT  || "30"),
  allowedOrigin:    process.env.ALLOWED_ORIGIN || "*",
  twelveKey:        process.env.TWELVE_DATA_KEY || null,
  forexCandleMs:    1200000,
  angelApiKey:      process.env.ANGEL_API_KEY    || null,
  angelClientId:    process.env.ANGEL_CLIENT_ID  || null,
  angelPin:         process.env.ANGEL_PIN        || null,
  angelTotpSecret:  process.env.ANGEL_TOTP_SECRET|| null,
  fnoCandleMs:      1200000,
  useGroq:          process.env.USE_GROQ !== "false",
});

export const TWELVE_TO_SYMBOL  = Object.freeze(Object.fromEntries(Object.entries(CONFIG.forexSymbols || {}).map(([s,t])=>[t,s])));

export function validateEnv(log) {
  if (!CONFIG.groqKey)    log.warn("GROQ_API_KEY not set — local models only");
  if (!CONFIG.twelveKey)  log.warn("TWELVE_DATA_KEY not set — Gold & EURUSD disabled");
  else                    log.info("Twelve Data → enabled");
  if (CONFIG.angelApiKey) log.info("Angel One → credentials loaded");
  else                    log.warn("Angel One credentials not set — F&O disabled");
}
export const BINANCE_TO_SYMBOL = Object.freeze(
  Object.fromEntries(
    Object.entries(CONFIG.symbols || {}).map(([s, b]) => [b, s])
  )
);
