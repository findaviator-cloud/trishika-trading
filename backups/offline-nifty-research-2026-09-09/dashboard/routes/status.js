export function statusRoute(artifacts) {
  return {
    generatedAtUtc: artifacts.status.generatedAtUtc ?? null,
    overall: artifacts.status.overall,
    safety: artifacts.status.safety,
    dailyReference: artifacts.status.dailyReference,
    intradayFixture: artifacts.status.intradayFixture,
    display: {
      mode: 'OFFLINE_RESEARCH_ONLY',
      tradingApproved: false,
      currentIntradayContextApproved: false,
      warning: 'PASS validates offline controls and deterministic artifacts. It does not approve trading, broker access, or current intraday use.'
    }
  };
}
