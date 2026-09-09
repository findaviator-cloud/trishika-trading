function scenariosFromSnapshot(snapshot) {
  if (Array.isArray(snapshot.scenarios)) return snapshot.scenarios;
  if (Array.isArray(snapshot.snapshotScenarios)) return snapshot.snapshotScenarios;
  return [];
}

export function dailyRoute(artifacts) {
  const daily = artifacts.manifest.officialDailyReference;
  const regression = artifacts.dailyRegression;
  const snapshots = artifacts.dailySnapshots;

  return {
    classification: 'OFFICIAL_DAILY_REFERENCE_RESEARCH',
    allowedUse: 'INDEPENDENT_1D_REFERENCE_RESEARCH_WITHIN_ACTUAL_COVERAGE',
    status: daily.status,
    coverage: daily.coverage,
    rows: daily.outputRows,
    duplicateDates: daily.duplicateDates,
    regression: {
      result: regression.summary?.result ?? daily.regression,
      scenariosPassed: regression.summary?.scenariosPassed ?? null,
      scenariosTotal: regression.summary?.scenariosTotal ?? null,
      differences: regression.summary?.differences ?? null
    },
    snapshotScenarios: scenariosFromSnapshot(snapshots),
    integrity: {
      normalizedCsv: daily.files?.normalized ?? null,
      snapshots: daily.files?.snapshots ?? null,
      regressionAudit: daily.files?.regressionAudit ?? null
    }
  };
}
