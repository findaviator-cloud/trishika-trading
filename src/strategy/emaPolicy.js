export const RESEARCH_PAPER_TIER = "RESEARCH";
export const RESEARCH_EXECUTION_ALLOWED = false;

export const EMA200_DAILY_POLICY = Object.freeze({
  BTC: Object.freeze({
    enabled: true,
    validationMode: "RESEARCH_PAPER_VALIDATION",
    rationale:
      "Daily EMA(200) confirmation enabled. Research/paper validation only.",
  }),

  ETH: Object.freeze({
    enabled: false,
    validationMode: "RESEARCH_PAPER_VALIDATION",
    rationale:
      "Daily EMA(200) confirmation disabled. Baseline-only research/paper validation pending further review.",
  }),

  SOL: Object.freeze({
    enabled: false,
    validationMode: "RESEARCH_PAPER_VALIDATION",
    rationale:
      "Daily EMA(200) confirmation disabled. Backtest evidence does not support this filter; baseline-only research/paper validation.",
  }),

  BNB: Object.freeze({
    enabled: true,
    validationMode: "RESEARCH_PAPER_VALIDATION",
    rationale:
      "Daily EMA(200) confirmation enabled. Use strict cost/slippage stress review; research/paper validation only.",
  }),
});

export function normalizeEmaPolicySymbol(symbol) {
  return String(symbol ?? "")
    .toUpperCase()
    .replace(/USD$|USDT$|[-_/ ]/g, "");
}

export function getEma200DailyPolicy(symbol) {
  const normalized = normalizeEmaPolicySymbol(symbol);

  return (
    EMA200_DAILY_POLICY[normalized] ??
    Object.freeze({
      enabled: false,
      validationMode: "RESEARCH_PAPER_VALIDATION",
      rationale:
        "Daily EMA(200) confirmation disabled by default. Research/paper validation only.",
    })
  );
}

export function buildEmaResearchMetadata(symbol, ema200Daily, price) {
  const policy = getEma200DailyPolicy(symbol);
  const safePrice = Number(price);
  const safeEma = Number(ema200Daily);

  const hasEmaValue = Number.isFinite(safeEma);
  const hasPrice = Number.isFinite(safePrice);

  const marketSide =
    hasEmaValue && hasPrice
      ? safePrice >= safeEma
        ? "ABOVE_EMA200"
        : "BELOW_EMA200"
      : "EMA_UNAVAILABLE";

  return Object.freeze({
    emaConfirmation: policy.enabled ? "ENABLED" : "DISABLED",
    emaConfirmationEnabled: policy.enabled,
    emaConfirmationNote: policy.rationale,
    ema200Daily: hasEmaValue ? safeEma : null,
    ema200DailyState: marketSide,
    validationMode: policy.validationMode,
    tier: RESEARCH_PAPER_TIER,
    analysisOnly: true,
    executionAllowed: RESEARCH_EXECUTION_ALLOWED,
  });
}
