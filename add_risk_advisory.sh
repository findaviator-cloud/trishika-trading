#!/usr/bin/env bash
# ============================================================
# Adds transparent risk-advisory + position-sizing guidance to
# crypto signals, and fixes the missing backtest-spec.md reference
# with a real, verified evidence document.
#
# SAFE / ADDITIVE ONLY:
#  - No existing fields are removed or changed
#  - No live signal is silently blocked
#  - Creates a git safety tag before touching anything
# ============================================================
set -e

echo "=== Add Risk Advisory + Position Sizing Guidance ==="

if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
  echo "ERROR: Run this from inside the trishika-trading folder (where server.js lives)."
  exit 1
fi

if [ -d ".git" ]; then
  TAG="pre-risk-advisory-$(date +%Y%m%d-%H%M%S)"
  git add -A
  git commit -m "Snapshot before adding risk advisory + position sizing guidance" --allow-empty -q
  git tag "$TAG"
  echo "✔ Safety checkpoint created: git tag '$TAG'"
  echo "  (Agar kuch galat ho jaye to: git reset --hard $TAG)"
fi

# ------------------------------------------------------------
# 1) New file: src/strategy/risk_advisory.js
# ------------------------------------------------------------
mkdir -p src/strategy
cat > src/strategy/risk_advisory.js << 'EOF'
/**
 * risk_advisory.js
 *
 * Transparent, evidence-based per-symbol risk notes surfaced alongside
 * live signals. INFORMATIONAL ONLY — does not block, filter, or modify
 * any entry/exit signal produced by donchian.js. AUTOMATION_ALLOWED is
 * false everywhere in this repo; sizing decisions remain human-in-the-loop.
 *
 * Source of evidence: out-of-sample walk-forward backtests stored at
 *   data/backtest-results/walkforward-crypto-results.json
 *   data/backtest-results/risk-adjusted-crypto-metrics.json
 * (period: Feb 2025 - Aug 2026, EXIT_REALIZATION mode, compounded returns)
 *
 * See docs/EVIDENCE_NOTES.md for the full verified numbers and for
 * why some in-code comments referencing a "backtest-spec.md" file
 * could not be located in this repository.
 */

export const SYMBOL_RISK_PROFILE = {
  BTC: {
    level: 'FAVORABLE',
    sharpe: 0.65,
    cagrPct: 22.1,
    maxDrawdownPct: -17.1,
    note: 'EMA-confirmed (variant B) OOS evidence is the strongest in this ' +
          'system: Sharpe 0.65, CAGR ~22%, max drawdown -17%. Baseline ' +
          '(variant A, no EMA filter) is much weaker (Sharpe 0.20, near-flat ' +
          'return) — the EMA confirmation materially matters for BTC.',
    suggestedMaxRiskPct: 1.0,
  },
  ETH: {
    level: 'CAUTION',
    sharpe: 0.60,
    cagrPct: 25.4,
    maxDrawdownPct: -39.4,
    note: 'Total OOS return is the best of the four symbols (~30-39%), but ' +
          'max drawdown is severe (-38% to -39%). A documented tail-risk ' +
          'event (large missed reversal trade) was observed in backtesting. ' +
          'Position size conservatively; this is a high-return, high-pain profile.',
    suggestedMaxRiskPct: 0.5,
  },
  SOL: {
    level: 'UNFAVORABLE',
    sharpe: -0.03,
    cagrPct: -14.2,
    maxDrawdownPct: -47.8,
    note: 'OOS backtest evidence does NOT support trading this symbol with ' +
          'the current strategy: both baseline and EMA-confirmed variants ' +
          'lost money (-14% to -20% total return) with the worst drawdown ' +
          'of any tracked symbol (-38% to -48%). EMA confirmation is already ' +
          'suppressed for SOL in the UI for this reason. Signals are still ' +
          'generated (this tool never blocks signals), but sizing at or near ' +
          'zero risk is the evidence-backed choice until this improves.',
    suggestedMaxRiskPct: 0,
  },
  BNB: {
    level: 'CAUTION',
    sharpe: 0.25,
    cagrPct: 3.6,
    maxDrawdownPct: -27.7,
    note: 'Cost-fragile: the EMA-confirmed variant is only modestly positive ' +
          '(CAGR ~3.6%) and the baseline variant loses money outright. ' +
          'Returns can flip negative under realistic slippage/fee assumptions. ' +
          'Use tight risk limits if trading this symbol at all.',
    suggestedMaxRiskPct: 0.5,
  },
};

const DEFAULT_PROFILE = {
  level: 'INSUFFICIENT_EVIDENCE',
  sharpe: null,
  cagrPct: null,
  maxDrawdownPct: null,
  note: 'No verified out-of-sample backtest evidence is available for this ' +
        'symbol in this repository. Treat any live signal as unvalidated.',
  suggestedMaxRiskPct: 0,
};

/**
 * Returns the risk advisory object for a symbol. Always returns a value
 * (falls back to DEFAULT_PROFILE) so callers never need a null check.
 */
export function getRiskAdvisory(symbol) {
  const key = String(symbol || '').toUpperCase();
  const profile = SYMBOL_RISK_PROFILE[key] || DEFAULT_PROFILE;
  return { symbol: key, ...profile };
}

/**
 * Generic, account-size-agnostic position sizing formula. This tool does
 * not know the user's capital and does not execute trades (automationAllowed
 * is always false) — so this returns the FORMULA and inputs to apply it,
 * not a computed share/contract count.
 */
export function getPositionSizingGuidance() {
  return {
    formula: 'position_size = (account_equity * risk_pct) / abs(entry_price - stopPrice)',
    note:
      'This system does not know your account size and never places trades ' +
      'automatically. Pick risk_pct using the riskAdvisory.suggestedMaxRiskPct ' +
      'for this symbol (or lower), then apply the formula yourself with your ' +
      'own account_equity and the entry/stopPrice from this signal.',
    example: {
      account_equity: 100000,
      risk_pct: 0.01,
      entry_price: 100,
      stopPrice: 98,
      result_position_size: '(100000 * 0.01) / abs(100 - 98) = 500 units',
    },
  };
}
EOF
echo "✔ Created src/strategy/risk_advisory.js"

# ------------------------------------------------------------
# 2) Patch src/routes/crypto.js — additive fields only
# ------------------------------------------------------------
cat > src/routes/crypto.js << 'EOF'
import express from "express";
import fs      from "fs";
import path    from "path";
import { getRiskAdvisory, getPositionSizingGuidance } from "../strategy/risk_advisory.js";

const router = express.Router();

const SIGNALS_DIR = path.resolve("signals_live");

const SYMBOL_FILE = {
  BTC: "BTC_USD.json",
  ETH: "ETH_USD.json",
  SOL: "SOL_USD.json",
  BNB: "BNB_USD.json",
};

// GET /api/crypto/signal?symbol=BTC
router.get("/signal", (req, res) => {
  const symbol = (req.query.symbol || "BTC").toUpperCase();
  const file   = SYMBOL_FILE[symbol];

  if (!file) {
    return res.status(404).json({ error: `Unknown symbol: ${symbol}` });
  }

  const filePath = path.join(SIGNALS_DIR, file);
  const riskAdvisory = getRiskAdvisory(symbol);
  const positionSizingGuidance = getPositionSizingGuidance();

  if (!fs.existsSync(filePath)) {
    return res.json({
      signal:     "NEUTRAL",
      confidence: 0,
      reason:     "Signal not yet generated — waiting for first closed candle",
      _source:    "Pending",
      symbol,
      emaConfirmation: "N/A",
      emaConfirmationNote: "EMA(200) signal confirmation is not yet available.",
      ema200Daily: null,
      automationAllowed: false,
      riskAdvisory,
      positionSizingGuidance,
    });
  }

  try {
    const raw    = fs.readFileSync(filePath, "utf8");
    const data   = JSON.parse(raw);
    const signal = data.signal ?? {};

    return res.json({
      signal:     signal.action     ?? "NEUTRAL",
      confidence: signal.confidence ?? 0,
      reason:     signal.reason     ?? "",
      stopPrice:  signal.stopPrice  ?? null,
      direction:  signal.direction  ?? 0,
      _source:    "Donchian-ATR",
      asOf:       data.meta?.asOf   ?? null,
      indicators: data.indicators   ?? {},
      price:      data.price        ?? {},

      // Informational-only completed-1D EMA(200) context. These fields
      // are serialized by live_signal_writer.js; legacy signal files safely
      // degrade to N/A/null without changing signal or execution behavior.
      emaConfirmation: signal.emaConfirmation ?? "N/A",
      emaConfirmationNote: signal.emaConfirmationNote ?? null,
      ema200Daily: signal.ema200Daily ?? null,
      automationAllowed: false,

      // Evidence-based risk notes + sizing formula. Informational only —
      // never blocks or modifies the signal above. See
      // src/strategy/risk_advisory.js and docs/EVIDENCE_NOTES.md.
      riskAdvisory,
      positionSizingGuidance,
    });
  } catch (err) {
    console.error("[CRYPTO ROUTE]", err.message);
    return res.status(500).json({ error: "Failed to read signal file" });
  }
});

export default router;
EOF
echo "✔ Updated src/routes/crypto.js (additive fields: riskAdvisory, positionSizingGuidance)"

# ------------------------------------------------------------
# 3) New doc: docs/EVIDENCE_NOTES.md
# ------------------------------------------------------------
mkdir -p docs
cat > docs/EVIDENCE_NOTES.md << 'EOF'
# Evidence Notes (verified 2026-09-21)

## Why this file exists

Several files in this repo (`src/strategy/ema_confirmation.js`,
`scripts/backtest-baseline-4h.js`, and a deleted `.v1-before-handover`
file) reference a `backtest-spec.md` document with detailed section
numbers (e.g. "Sections 3, 9-13, 15") as the source of evidence for
per-symbol trading decisions. **That file does not exist anywhere in
this repository.** It may have been lost, never committed, or kept
outside version control.

This document is a substitute: it records the actual, verifiable
numbers pulled directly from the JSON result files that DO exist in
this repo, so the evidence behind the code's per-symbol decisions is
traceable to real data instead of a missing document.

## Verified out-of-sample results

Source: `data/backtest-results/risk-adjusted-crypto-metrics.json`,
mode `EXIT_REALIZATION`, period ~Feb 2025 - Aug 2026 (~1.5 years),
compounded returns.

| Symbol | Variant | Trades | Win Rate | Total Return | CAGR | Sharpe | Max Drawdown |
|---|---|---|---|---|---|---|---|
| BTC | A (baseline) | 59 | 20.3% | +0.46% | +0.31% | 0.20 | -25.6% |
| BTC | B (EMA-confirmed) | 33 | 18.2% | +34.0% | +22.1% | 0.65 | -17.1% |
| ETH | A | 65 | 21.5% | +30.4% | +19.9% | 0.55 | -37.8% |
| ETH | B | 37 | 16.2% | +38.8% | +25.4% | 0.60 | -39.4% |
| SOL | A | 63 | 23.8% | -14.3% | -9.5% | 0.12 | -38.1% |
| SOL | B | 38 | 21.1% | -20.1% | -14.2% | -0.03 | -47.8% |
| BNB | A | 63 | 23.8% | -19.5% | -14.1% | -0.09 | -42.3% |
| BNB | B | 38 | 23.7% | +5.1% | +3.6% | 0.25 | -27.7% |

This directly supports the existing `SOL: enabled: false` suppression
in `ema_confirmation.js` (both SOL variants lose money) and the "cost
fragile" note on BNB (baseline variant loses money outright).

## NIFTY (India F&O)

Source: `reports/nifty-daily-donchian-baseline.json` +
`docs/NIFTY_DAILY_OOS_FEASIBILITY_BLOCKER.md` (already in repo).

Only 10 completed trades exist in the frozen sample (Feb 2024 - Sep
2026), 3 wins, compounded return -11.6%. The repo's own blocker doc
correctly states this sample is too small to be split into in-sample
/ out-of-sample and treated as validation. **Status: insufficient
evidence, not validated — treat as research-only.**

## BANKNIFTY and SENSEX

No backtest file, baseline report, or historical validation of any
kind exists for these two symbols anywhere in this repository as of
this writing. They currently only produce live signals with **zero**
historical validation. Treat any signal for these two symbols as
completely unvalidated until a backtest equivalent to the NIFTY one
is built.

## Caveat on timeframes

The `donchian.js` header comment claims the strategy is
"production-validated on BTCUSDT/ETHUSDT/SOLUSDT/BNBUSDT 1h", while
the walk-forward OOS results above were computed on 4H data
(`data/backtest-results/walkforward-crypto-results.json` covers 4H
variants A/B). These are not guaranteed to behave identically. This
document does not claim the 1H live signal has been directly
backtested — only that the 4H OOS evidence above is the most
concrete, verifiable evidence found in this repository for each
symbol's underlying trading logic.
EOF
echo "✔ Created docs/EVIDENCE_NOTES.md"

# ------------------------------------------------------------
# 4) Syntax-check the new/changed JS files (catch typos before deploy)
# ------------------------------------------------------------
echo ""
echo "--- Syntax check ---"
node --check src/strategy/risk_advisory.js && echo "  OK: risk_advisory.js"
node --check src/routes/crypto.js && echo "  OK: crypto.js"

echo ""
echo "--- git diff summary ---"
git add -A
git status

echo ""
echo "=== NEXT STEPS ==="
echo "1) Review the diff if you want:"
echo "     git diff --cached --stat"
echo ""
echo "2) Commit + push:"
echo "     git commit -m 'feat: add evidence-based risk advisory + position sizing guidance to crypto signals'"
echo "     git push origin main"
echo ""
echo "3) After Render redeploys, verify with:"
echo "     curl -s 'https://trishika-trading.onrender.com/api/crypto/signal?symbol=SOL' | python3 -m json.tool"
echo "   -> look for the new 'riskAdvisory' and 'positionSizingGuidance' fields"
echo ""
echo "NOTE: This does NOT change any existing signal/entry/exit behavior."
echo "It only ADDS informational fields. Nothing was hard-blocked or removed."
