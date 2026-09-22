#!/usr/bin/env bash
# ============================================================
# Adds crypto (BTC/ETH/SOL/BNB) to the same Twelve Data WebSocket
# that forex (EUR/USD, XAU/USD) already uses — so crypto gets live
# real-time price ticks too, instead of only refreshing every 15
# minutes via REST polling.
#
# SAFE / ADDITIVE:
#  - REST polling for crypto (pollCrypto, every 15 min) is UNCHANGED
#    and keeps running as a backup / full-candle refresh.
#  - Forex behavior is UNCHANGED.
#  - Creates a git safety tag before touching anything.
# ============================================================
set -e

echo "=== Add Live WS Ticks for Crypto (matching Forex) ==="

if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
  echo "ERROR: Run this from inside the trishika-trading folder (where server.js lives)."
  exit 1
fi

if [ -d ".git" ]; then
  TAG="pre-crypto-ws-ticks-$(date +%Y%m%d-%H%M%S)"
  git add -A
  git commit -m "Snapshot before adding crypto WS ticks" --allow-empty -q
  git tag "$TAG"
  echo "✔ Safety checkpoint created: git tag '$TAG'"
  echo "  (Agar kuch galat ho jaye to: git reset --hard $TAG)"
fi

TARGET_CONFIG="src/config/index.js"
TARGET_CANDLE="src/candle/index.js"

if [ ! -f "$TARGET_CONFIG" ] || [ ! -f "$TARGET_CANDLE" ]; then
  echo "ERROR: Expected files not found ($TARGET_CONFIG / $TARGET_CANDLE). Are you in the right repo?"
  exit 1
fi

# ------------------------------------------------------------
# 1) Replace src/config/index.js (adds cryptoTwelveSymbols +
#    extends TWELVE_TO_SYMBOL reverse map)
# ------------------------------------------------------------
cat > "$TARGET_CONFIG" << 'EOF'
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
  twelveKey:        process.env.TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_KEY || null,
  forexCandleMs:    1200000,
  angelApiKey:      process.env.ANGEL_API_KEY    || null,
  angelClientId:    process.env.ANGEL_CLIENT_ID  || null,
  angelPin:         process.env.ANGEL_PIN        || null,
  angelTotpSecret:  process.env.ANGEL_TOTP_SECRET|| null,
  fnoCandleMs:      1200000,
  useGroq:          process.env.USE_GROQ !== "false",
  symbols: {
    BTC: "btcusdt",
    ETH: "ethusdt",
    SOL: "solusdt",
    BNB: "bnbusdt",
  },
  forexSymbols: {
    EUR_USD: "EUR/USD",
    XAU_USD: "XAU/USD",
  },
  // Crypto pairs in Twelve Data's live-tick WS format, so crypto gets the
  // same real-time WebSocket price ticks that forex already had
  // (previously crypto only refreshed every 15 minutes via REST polling).
  cryptoTwelveSymbols: {
    BTC: "BTC/USD",
    ETH: "ETH/USD",
    SOL: "SOL/USD",
    BNB: "BNB/USD",
  },
});

export const BINANCE_TO_SYMBOL = Object.freeze(
  Object.fromEntries(
    Object.entries(CONFIG.symbols).map(([s, b]) => [b, s])
  )
);

// Extended to cover BOTH forex and crypto Twelve Data pairs, so incoming
// WebSocket price ticks for either group map back to the correct engine key.
export const TWELVE_TO_SYMBOL = Object.freeze(
  Object.fromEntries(
    Object.entries({ ...CONFIG.forexSymbols, ...CONFIG.cryptoTwelveSymbols }).map(
      ([s, t]) => [t, s]
    )
  )
);

export function validateEnv(log) {
  if (!CONFIG.groqKey)    log.warn("GROQ_API_KEY not set — local models only");
  if (!CONFIG.twelveKey)  log.warn("TWELVE_DATA_API_KEY not set — Gold & EURUSD disabled");
  else                    log.info("Twelve Data → enabled");
  if (CONFIG.angelApiKey) log.info("Angel One → credentials loaded");
  else                    log.warn("Angel One credentials not set — F&O disabled");
}
EOF
echo "✔ Updated $TARGET_CONFIG"

# ------------------------------------------------------------
# 2) Patch src/candle/index.js — extend the WS subscribe list only
# ------------------------------------------------------------
python3 - "$TARGET_CANDLE" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = """  socket.on('open', () => {
    log.info('Twelve Data WS connected');

    const symbols = Object.values(CONFIG.forexSymbols);

    socket.send(
      JSON.stringify({
        action: 'subscribe',
        params: { symbols: symbols.join(',') }
      })
    );

    log.info(`Twelve Data \u2192 subscribed: ${symbols.join(', ')}`);
  });"""

new = """  socket.on('open', () => {
    log.info('Twelve Data WS connected');

    // Forex + crypto both subscribed here now, so crypto gets the same
    // real-time WS price ticks forex already had (previously crypto only
    // refreshed every 15 minutes via REST polling in connectBinance/pollCrypto).
    const symbols = [
      ...Object.values(CONFIG.forexSymbols),
      ...Object.values(CONFIG.cryptoTwelveSymbols)
    ];

    socket.send(
      JSON.stringify({
        action: 'subscribe',
        params: { symbols: symbols.join(',') }
      })
    );

    log.info(`Twelve Data \u2192 subscribed: ${symbols.join(', ')}`);
  });"""

if old not in content:
    print("ERROR: expected block not found in " + path + " — file may already be patched, or has diverged.")
    sys.exit(1)

content = content.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: patched " + path)
PYEOF

echo "✔ Updated $TARGET_CANDLE"

# ------------------------------------------------------------
# 3) Syntax check
# ------------------------------------------------------------
echo ""
echo "--- Syntax check ---"
node --check "$TARGET_CONFIG" && echo "  OK: $TARGET_CONFIG"
node --check "$TARGET_CANDLE" && echo "  OK: $TARGET_CANDLE"

echo ""
echo "--- git diff summary ---"
git add -A
git status

echo ""
echo "=== NEXT STEPS ==="
echo "1) Commit + push:"
echo "     git commit -m 'feat: give crypto live WS price ticks, matching forex (was 15min REST-only)'"
echo "     git push origin main"
echo ""
echo "2) After Render redeploys, check the boot logs for this line:"
echo "     Twelve Data → subscribed: EUR/USD, XAU/USD, BTC/USD, ETH/USD, SOL/USD, BNB/USD"
echo "   (previously it only listed EUR/USD, XAU/USD)"
echo ""
echo "3) Verify live price updates:"
echo "     curl -s 'https://trishika-trading.onrender.com/api/crypto/signal?symbol=BTC' | python3 -m json.tool"
echo "   Run it twice, ~1 minute apart — 'price.last' and 'asOf' should now change between"
echo "   calls even outside the old 15-minute REST poll window."
echo ""
echo "NOTE: This does not remove the existing 15-min REST poll for crypto — that stays as"
echo "a backup/full-candle-reload mechanism, same as before. It only ADDS live WS ticks"
echo "on top, exactly mirroring how forex already worked."
