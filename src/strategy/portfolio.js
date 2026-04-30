/**
 * portfolio.js
 * Portfolio-level position and risk gate for Trishika Trading.
 */

export const PORTFOLIO_CONFIG = {
  max_open_positions:      1,      // phase 1: one position at a time
  max_total_open_risk_pct: 0.005,  // 0.5% aggregate — matches per-trade risk_pct
  // Phase 2: max_open_positions: 2, max_total_open_risk_pct: 0.01
};

const open_positions = new Map();

export function portfolioGate({ symbol, risk_pct, equity }) {
  const cfg             = PORTFOLIO_CONFIG;
  const position_count  = open_positions.size;
  const new_trade_risk  = equity * risk_pct;
  const total_open_risk = [...open_positions.values()]
    .reduce((sum, p) => sum + p.entry_risk_amt, 0);
  const projected_risk     = total_open_risk + new_trade_risk;
  const projected_risk_pct = equity > 0 ? projected_risk / equity : 0;

  const payload = {
    symbol,
    attempted_risk_pct:      +risk_pct.toFixed(4),
    new_trade_risk_amt:      +new_trade_risk.toFixed(4),
    current_open_positions:  position_count,
    current_open_risk_amt:   +total_open_risk.toFixed(4),
    current_open_risk_pct:   +(equity > 0 ? total_open_risk / equity : 0).toFixed(4),
    projected_open_risk_amt: +projected_risk.toFixed(4),
    projected_open_risk_pct: +projected_risk_pct.toFixed(4),
    max_open_positions:      cfg.max_open_positions,
    max_total_open_risk_pct: cfg.max_total_open_risk_pct,
    open_symbols:            [...open_positions.keys()],
    equity,
  };

  if (open_positions.has(symbol)) {
    return { allowed: true, reason: 'SYMBOL_ALREADY_OPEN', payload };
  }

  if (position_count >= cfg.max_open_positions) {
    return {
      allowed: false,
      reason: `Position count limit: ${position_count}/${cfg.max_open_positions} open`,
      payload,
    };
  }

  if (projected_risk_pct > cfg.max_total_open_risk_pct) {
    return {
      allowed: false,
      reason: `Aggregate risk limit: projected ${(projected_risk_pct * 100).toFixed(3)}% > cap ${(cfg.max_total_open_risk_pct * 100).toFixed(3)}%`,
      payload,
    };
  }

  return { allowed: true, reason: null, payload };
}

export function openPosition({ symbol, direction, entry_price, risk_pct, equity, ts }) {
  open_positions.set(symbol, {
    symbol, direction, entry_price, risk_pct,
    entry_risk_amt:  equity * risk_pct,
    equity_at_entry: equity,
    ts,
  });
}

export function closePosition(symbol) {
  const pos = open_positions.get(symbol) ?? null;
  open_positions.delete(symbol);
  return pos;
}

export function portfolioSnapshot(equity) {
  const positions       = [...open_positions.values()];
  const total_open_risk = positions.reduce((s, p) => s + p.entry_risk_amt, 0);
  return {
    open_position_count:     positions.length,
    open_symbols:            positions.map(p => p.symbol),
    portfolio_open_risk_amt: +total_open_risk.toFixed(4),
    portfolio_open_risk_pct: +(equity > 0 ? total_open_risk / equity : 0).toFixed(4),
    portfolio_gate_result:   positions.length >= PORTFOLIO_CONFIG.max_open_positions
      ? 'BLOCKED' : 'OPEN',
    max_open_positions:      PORTFOLIO_CONFIG.max_open_positions,
    max_total_open_risk_pct: PORTFOLIO_CONFIG.max_total_open_risk_pct,
  };
}
