export function governanceRoute(artifacts, inventory) {
  const manifest = artifacts.manifest;
  const status = artifacts.status;
  const eligibility = artifacts.eligibility;
  const governance = artifacts.governanceRegression;

  return {
    generatedAtUtc: new Date().toISOString(),
    policy: {
      researchOnly: manifest.safety?.researchOnly,
      executionAllowed: manifest.safety?.executionAllowed,
      brokerConnectivityAllowed: manifest.safety?.brokerConnectivityAllowed,
      websocketAllowed: manifest.safety?.websocketAllowed,
      humanReviewRequired: manifest.safety?.humanReviewRequired,
      dashboardRole: 'READ_ONLY_ARTIFACT_PRESENTATION',
      eligibilityPolicyEngine: 'EXTERNAL_GENERATED_AUDITS_ONLY',
      dashboardEligibilityRecomputation: false
    },
    currentState: {
      suite: status.overall?.status ?? null,
      reconciliation: status.intradayFixture?.referenceGate ?? null,
      freshness: status.intradayFixture?.freshnessGate ?? null,
      currentEligibility: status.intradayFixture?.eligibleCurrentIntradayContext ?? null,
      decision: status.intradayFixture?.decision ?? null
    },
    governanceRegression: {
      summary: governance.summary ?? null,
      checks: governance.checks ?? null
    },
    sourceSeparation: manifest.sourceSeparation ?? null,
    eligibilityAudit: {
      decision: eligibility.decision ?? null,
      currentIntradayUse: eligibility.sourceClassification?.currentIntradayUse ?? null,
      gates: eligibility.gates ?? null,
      provenance: eligibility.provenance ?? null
    },
    artifacts: inventory
  };
}
