const byId = (id) => document.getElementById(id);

function text(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function stateClass(value) {
  const normalized = text(value).toUpperCase();

  if (
    normalized.includes('FAIL') ||
    normalized.includes('BLOCK') ||
    normalized.includes('STALE') ||
    normalized.includes('REVIEW') ||
    normalized === 'FALSE'
  ) return 'bad';

  if (normalized.includes('PASS') || normalized.includes('OK') || normalized.includes('TRUE')) return 'good';
  return 'neutral';
}

function setState(id, value) {
  const node = byId(id);
  node.textContent = text(value);
  node.className = `status-value ${stateClass(value)}`;
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderDetails(id, entries) {
  const target = byId(id);
  target.replaceChildren();

  for (const [label, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = formatValue(value);
    target.append(dt, dd);
  }
}

function shortHash(value) {
  if (!value) return '—';
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-12)}` : value;
}

function renderInventory(inventory) {
  const wrap = byId('provenance-table-wrap');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const row = document.createElement('tr');

  ['Artifact', 'Present', 'Bytes', 'SHA-256'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    row.append(th);
  });

  head.append(row);
  table.append(head);

  const body = document.createElement('tbody');

  for (const item of inventory ?? []) {
    const tr = document.createElement('tr');
    const values = [
      item.filename ?? item.name,
      item.present ? 'YES' : 'NO',
      item.bytes ?? '—',
      shortHash(item.sha256)
    ];

    values.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = text(value);
      tr.append(td);
    });

    body.append(tr);
  }

  table.append(body);
  wrap.replaceChildren(table);
}

async function getJson(endpoint) {
  const response = await fetch(endpoint, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message ?? `Request failed: ${response.status}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function showError(error) {
  const panel = byId('error-panel');
  panel.hidden = false;
  byId('error-message').textContent = error.message;
  byId('error-details').textContent = JSON.stringify(error.payload ?? {}, null, 2);

  byId('critical-banner').classList.add('blocked');
  byId('critical-banner').innerHTML = '<strong>ARTIFACT INTEGRITY BLOCKED</strong><span>Dashboard is fail-closed. Run the offline validation suite and correct artifact integrity before relying on any display.</span>';
}

async function main() {
  try {
    const [health, status, daily, intraday, governance, manifest, admission, niftyMtf] = await Promise.all([
      getJson('/api/health'),
      getJson('/api/status'),
      getJson('/api/daily'),
      getJson('/api/intraday'),
      getJson('/api/governance'),
      getJson('/api/manifest'),
      getJson('/api/admission'),
      getJson('/api/nifty-mtf')
    ]);

    byId('generated-at').textContent = `Validated artifact read: ${text(status.generatedAtUtc)}`;

    byId('critical-banner').innerHTML = `
      <strong>RESEARCH ONLY</strong>
      <span>${text(status.display?.warning)}</span>
    `;

    setState('suite-status', status.overall?.status);
    setState('daily-status', status.dailyReference?.regression);
    setState('intraday-status', intraday.regression?.result);
    setState('eligibility-status', intraday.decision);

    setState('reconciliation-gate', intraday.referenceGate);
    setState('freshness-gate', intraday.freshnessGate);
    setState('structural-gate', intraday.structuralGate);
    setState('fixture-decision', intraday.decision);

    byId('hard-block-reason').textContent = text(intraday.hardBlock?.reason);
    renderDetails('hard-block-details', [
      ['Dashboard classification', intraday.classification],
      ['Current intraday use', intraday.currentIntradayUse],
      ['Eligible current intraday context', intraday.eligibleCurrentIntradayContext],
      ['Eligibility audit decision', intraday.hardBlock?.eligibilityAuditDecision],
      ['Dashboard policy engine', governance.policy?.eligibilityPolicyEngine],
      ['Dashboard eligibility recomputation', governance.policy?.dashboardEligibilityRecomputation]
    ]);

    renderDetails('daily-details', [
      ['Classification', daily.classification],
      ['Status', daily.status],
      ['Coverage start', daily.coverage?.firstDate],
      ['Coverage end', daily.coverage?.lastDate],
      ['Normalized rows', daily.rows],
      ['Duplicate dates', daily.duplicateDates],
      ['Allowed use', daily.allowedUse]
    ]);

    renderDetails('intraday-details', [
      ['Classification', intraday.classification],
      ['Status', intraday.status],
      ['Data end (Asia/Kolkata)', intraday.dataEndIndia],
      ['Volume status', intraday.volumeStatus],
      ['Allowed use', intraday.allowedUse],
      ['Raw-fixture SHA-256', intraday.provenance?.rawFixture?.sha256]
    ]);

    renderDetails('reconciliation-details', [
      ['Result', intraday.reconciliation?.summary?.result],
      ['Compared', intraday.reconciliation?.summary?.compared],
      ['Pass', intraday.reconciliation?.summary?.pass],
      ['Review', intraday.reconciliation?.summary?.review],
      ['Mean absolute difference', intraday.reconciliation?.summary?.meanAbsoluteDifference],
      ['Max absolute difference', intraday.reconciliation?.summary?.maxAbsoluteDifference]
    ]);

    renderDetails('regression-details', [
      ['Dashboard integrity', health.integrity],
      ['Daily regression', daily.regression?.result],
      ['Daily scenarios', `${text(daily.regression?.scenariosPassed)}/${text(daily.regression?.scenariosTotal)}`],
      ['Daily differences', daily.regression?.differences],
      ['Intraday fixture regression', intraday.regression?.result],
      ['Intraday scenarios', `${text(intraday.regression?.scenariosPassed)}/${text(intraday.regression?.scenariosTotal)}`],
      ['Intraday differences', intraday.regression?.differences],
      ['Governance suite', governance.currentState?.suite]
    ]);

    setState('broker-status', status.safety?.brokerConnectivityAllowed === false ? 'DISABLED' : 'REVIEW');
    setState('websocket-status', status.safety?.websocketAllowed === false ? 'DISABLED' : 'REVIEW');
    setState('execution-status', status.safety?.executionAllowed === false ? 'DISABLED' : 'REVIEW');
    setState('review-status', status.safety?.humanReviewRequired === true ? 'REQUIRED' : 'REVIEW');

    setState('nifty-mtf-1d-status', niftyMtf.summary?.timeframes?.['1d']?.status);
    setState('nifty-mtf-1h-status', niftyMtf.summary?.timeframes?.['1h']?.status);
    setState('nifty-mtf-4h-status', niftyMtf.summary?.timeframes?.['4h']?.status);
    setState(
      'nifty-mtf-admission-status',
      `${text(niftyMtf.summary?.admission?.decision)} / ${text(niftyMtf.summary?.admission?.terminalReason)}`
    );

    renderDetails('nifty-mtf-details', [
      ['Phase', niftyMtf.phase],
      ['Overall status', niftyMtf.summary?.status],
      ['Official daily bias', niftyMtf.daily?.signal?.bias],
      ['Official daily price', niftyMtf.daily?.price],
      ['Daily coverage start', niftyMtf.daily?.source?.coverageStart],
      ['Daily coverage end', niftyMtf.daily?.source?.coverageEnd],
      ['Daily rows', niftyMtf.daily?.source?.rows],
      ['1H current snapshot generated', niftyMtf.summary?.timeframes?.['1h']?.currentSnapshotGenerated],
      ['4H current snapshot generated', niftyMtf.summary?.timeframes?.['4h']?.currentSnapshotGenerated],
      ['1H blocked reason', niftyMtf.summary?.timeframes?.['1h']?.reason],
      ['Admission decision', niftyMtf.summary?.admission?.decision],
      ['Admission terminal reason', niftyMtf.summary?.admission?.terminalReason],
      ['Approved for research source', niftyMtf.summary?.admission?.approvedForResearchSource],
      ['Approved for trading', niftyMtf.summary?.admission?.approvedForTrading]
    ]);

    setState('admission-decision', admission.decision);
    setState('admission-terminal-reason', admission.decisionPrecedence?.terminalReason);
    setState('admission-research-approved', admission.approvedForResearchSource);
    setState('admission-trading-approved', admission.approvedForTrading);

    renderDetails(
      'admission-gates',
      Object.entries(admission.gates ?? {}).map(([name, value]) => [
        name,
        value?.result ?? value
      ])
    );

    renderDetails(
      'admission-boundary',
      Object.entries(admission.executionBoundary ?? {})
    );

    renderDetails('admission-provenance', [
      ['Candidate path', admission.provenance?.candidate?.path],
      ['Candidate SHA-256', admission.provenance?.candidate?.sha256],
      ['Candidate profile path', admission.provenance?.candidateProfile?.path],
      ['Candidate profile SHA-256', admission.provenance?.candidateProfile?.sha256],
      ['Policy path', admission.provenance?.policy?.path],
      ['Policy SHA-256', admission.provenance?.policy?.sha256],
      ['Independent reference path', admission.provenance?.independentReference?.path],
      ['Independent reference SHA-256', admission.provenance?.independentReference?.sha256]
    ]);

    renderInventory(manifest.artifactInventory);
  } catch (error) {
    showError(error);
  }
}

main();
