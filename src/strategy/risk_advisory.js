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
