function scenariosFromSnapshot(snapshot) {
  if (Array.isArray(snapshot.scenarios)) return snapshot.scenarios;
  if (Array.isArray(snapshot.snapshotScenarios)) return snapshot.snapshotScenarios;
  return [];
}

export function intradayRoute(artifacts) {
  const minute = artifacts.manifest.thirdPartyMinuteFixture;
  const statusMinute = artifacts.status.intradayFixture;
  const reconciliation = artifacts.reconciliation;
  const eligibility = artifacts.eligibility;
  const regression = artifacts.intradayRegression;

  return {
    classification: 'FROZEN_STALE_UNTRUSTED_HISTORICAL_FIXTURE',
    allowedUse: 'HISTORICAL_PIPELINE_VALIDATION_FIXTURE_ONLY',
    status: minute.status,
    structuralGate: minute.structuralGate,
    referenceGate: minute.referenceGate,
    freshnessGate: minute.freshnessGate,
    currentIntradayUse: minute.currentIntradayUse,
    eligibleCurrentIntradayContext: minute.eligibleCurrentIntradayContext,
    decision: minute.decision,
    dataEndUtc: minute.dataEndUtc,
    dataEndIndia: minute.dataEndIndia,
    volumeStatus: minute.volumeStatus,
    provenance: {
      rawFixture: minute.files?.rawFixture ?? null,
      inputAudit: minute.files?.inputAudit ?? null
    },
    reconciliation: {
      summary: reconciliation.summary ?? minute.reconciliation,
      diagnostics: reconciliation.diagnostics ?? null,
      mismatches: reconciliation.mismatches ?? null
    },
    hardBlock: {
      blocked: statusMinute.eligibleCurrentIntradayContext === false,
      reason: (
        'Current intraday context is blocked because the frozen third-party fixture has ' +
        'reference reconciliation FAIL/REVIEW and freshness FAIL/STALE. Dashboard policy is display-only.'
      ),
      eligibilityAuditDecision: eligibility.decision ?? minute.decision,
      eligibilityAudit: {
        sourceClassification: eligibility.sourceClassification ?? null,
        gates: eligibility.gates ?? null,
        evidence: eligibility.evidence ?? null
      }
    },
    regression: {
      result: regression.summary?.result ?? minute.regression,
      scenariosPassed: regression.summary?.scenariosPassed ?? null,
      scenariosTotal: regression.summary?.scenariosTotal ?? null,
      differences: regression.summary?.differences ?? null
    },
    snapshotScenarios: scenariosFromSnapshot(artifacts.intradaySnapshots)
  };
}
