'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const files = [
  'dashboard/lib/nifty-mtf-admission-guard.cjs',
  'dashboard/routes/nifty-mtf-refresh-status.cjs',
  'scripts/run-nifty-mtf-admission-guard-regression.cjs',
  'scripts/run-nifty-mtf-refresh-status-api-self-test.cjs'
];

for (const relative of files) {
  const fullPath = path.join(ROOT, relative);

  assert.equal(
    fs.existsSync(fullPath),
    true,
    `Missing required file: ${relative}`
  );
}

const routePath = path.join(
  ROOT,
  'dashboard/routes/nifty-mtf-refresh-status.cjs'
);

const routeSource = fs.readFileSync(routePath, 'utf8');

assert.match(routeSource, /req\.method\s*!==\s*'GET'/);
assert.match(routeSource, /Cache-Control':\s*'no-store'/);
assert.match(
  routeSource,
  /artifactPath:\s*CANONICAL_ARTIFACT_PATH/
);

assert.doesNotMatch(routeSource, /req\.(body|query)/i);
assert.doesNotMatch(routeSource, /URLSearchParams/i);

const syntheticPath = path.join(
  ROOT,
  'admission/fixtures/approved-synthetic.json'
);

const canonicalPath = path.join(
  ROOT,
  'admission/canonical/nifty-admission.json'
);

assert.notEqual(
  path.resolve(syntheticPath),
  path.resolve(canonicalPath)
);

const synthetic = JSON.parse(
  fs.readFileSync(syntheticPath, 'utf8')
);

assert.equal(
  synthetic.sourceKind,
  'SYNTHETIC_REGRESSION_FIXTURE'
);

assert.equal(synthetic.readinessOnly, true);
assert.equal(synthetic.approvedForTrading, false);

process.stdout.write(
  'PASS: static admission-guard contract verification\n'
);
